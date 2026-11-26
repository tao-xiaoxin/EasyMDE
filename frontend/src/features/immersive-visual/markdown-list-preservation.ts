import type { Node as ProseMirrorNode } from "prosemirror-model";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	listAttrsCompatible,
	prefixAtDepth,
	tryStripAllLinesAtDepth,
} from "./markdown-container-preservation";
import {
	type BlockSerializer,
	isLooseList,
	isNestedList,
	type PartialTitleRefDefPredicate,
	restoreMathNewlineSentinel,
	serializeListItemAt,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	nodesSemanticallyEqual,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type ParsedEnvReferences,
	type ParsedVisualBlockSource,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import {
	firstLine,
	matchListMarker,
	measureIndentColumns,
	stripUpToIndentColumns,
} from "./markdown-prescanner-containers";

/**
 * Granular list-item untouched-source preservation (at top level and inside
 * blockquotes), including first-ordered-marker alignment and safe left-shifting
 * of indented sibling items when a preceding item shrinks after edit or refdef
 * invalidation. Shared by both liveness analysis and final list serialization.
 */

const LIST_ITEM_START = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLANK_LINE = /^[ \t]*$/;
const BLANK_BEFORE_NESTED_LIST =
	/\n[ \t]*\n[ \t]+(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const ORDERED_FIRST_LINE = /^([ \t]*)(\d{1,9})([.)])([ \t]*)(.*)$/;

type ListItemSlices = Readonly<{
	items: ReadonlyArray<string>;
	/** `separators[i]` precedes item `i`; `separators[0]` is always empty. */
	separators: ReadonlyArray<string>;
	tail: string;
}>;

function contentIndentOf(match: RegExpExecArray): number {
	const spacing = match[3] ?? "";
	const width =
		spacing.length === 0 || spacing.length > 4 || spacing.includes("\t")
			? 1
			: spacing.length;
	return (match[1]?.length ?? 0) + (match[2]?.length ?? 0) + width;
}

function splitListItemSlices(raw: string): ListItemSlices | null {
	const lines = raw.split("\n");
	const starts: number[] = [];
	let contentIndent = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const match = LIST_ITEM_START.exec(lines[i] ?? "");
		if (
			match &&
			(contentIndent < 0 || (match[1]?.length ?? 0) < contentIndent)
		) {
			starts.push(i);
			contentIndent = contentIndentOf(match);
		} else if (i === 0) {
			return null;
		}
	}
	const items: string[] = [];
	const separators: string[] = [""];
	let tail = "";
	for (let k = 0; k < starts.length; k += 1) {
		const start = starts[k] ?? 0;
		const end = starts[k + 1] ?? lines.length;
		let last = end - 1;
		while (last > start && BLANK_LINE.test(lines[last] ?? "")) {
			last -= 1;
		}
		items.push(lines.slice(start, last + 1).join("\n"));
		const gap = lines.slice(last + 1, end);
		if (k + 1 < starts.length) {
			separators.push(`\n${gap.map((line) => `${line}\n`).join("")}`);
		} else if (gap.length > 0) {
			tail = `\n${gap.join("\n")}`;
		}
	}
	return { items, separators, tail };
}

/**
 * The single list of `markdown` once re-parsed at blockquote `depth`: the
 * text is re-prefixed with `depth` clean quote markers (physical newlines
 * masked by `mathNewlineToken` stay unprefixed, like
 * `emitWithMathSentinelAtDepth`) and exactly `depth` single-child
 * blockquotes must wrap one list, so tabs after the marker expand from the
 * real emitted column.
 */
function parseListAtDepth(
	markdown: string,
	depth: number,
	envReferences?: ParsedEnvReferences,
	mathNewlineToken?: string,
): ProseMirrorNode | null {
	const prefixed = prefixAtDepth(markdown, depth);
	const text =
		mathNewlineToken !== undefined
			? restoreMathNewlineSentinel(prefixed, mathNewlineToken)
			: prefixed;
	let node: ProseMirrorNode | null = parseMarkdownWithBlockSources(
		text,
		envReferences,
	).doc;
	for (let level = 0; level <= depth; level += 1) {
		if (node?.childCount !== 1) return null;
		node = node.firstChild;
		if (level < depth && node?.type.name !== "blockquote") return null;
	}
	return node;
}

function sliceParsesToItem(
	slice: string,
	listNode: ProseMirrorNode,
	index: number,
	depth: number,
	envReferences?: ParsedEnvReferences,
): boolean {
	const list = parseListAtDepth(slice, depth, envReferences);
	return (
		list !== null &&
		list.type === listNode.type &&
		list.childCount === 1 &&
		nodesSemanticallyEqual(list.child(0), listNode.child(index))
	);
}

const verifiedSliceCache = new WeakMap<
	ParsedVisualBlockSource,
	ListItemSlices | null
>();

/** Item slices proven to re-parse to exactly the baseline item nodes. */
function verifiedListItemSlices(
	block: ParsedVisualBlockSource,
	depth: number,
	envReferences?: ParsedEnvReferences,
	rawOverride?: string,
): ListItemSlices | null {
	const cached = verifiedSliceCache.get(block);
	if (cached !== undefined) return cached;
	let result: ListItemSlices | null = null;
	const raw = rawOverride ?? block.raw;
	if (raw !== null && isNestedList(block.node)) {
		const slices = splitListItemSlices(raw);
		if (
			slices &&
			slices.items.length === block.node.childCount &&
			slices.items.every((slice, i) =>
				sliceParsesToItem(slice, block.node, i, depth, envReferences),
			)
		) {
			result = slices;
		}
	}
	verifiedSliceCache.set(block, result);
	return result;
}

/**
 * A reused raw item that becomes the first item of an ordered list defines
 * the CommonMark start number. When its digits differ from the projected
 * `order`, return candidate rewrites (keeping indent, delimiter, and body
 * bytes as far as possible) in preference order. Each candidate must still be
 * validated in list context; an empty result means "serialize the item".
 * Content indents come from the PHP `matchListMarker()` primitive measured at
 * the real emitted `itemStartColumn` (`2 * depth`), so continuation lines
 * shift by exactly the content-indent delta even when a tab after the marker
 * crosses a different tab stop.
 */
function alignFirstOrderedMarker(
	listNode: ProseMirrorNode,
	raw: string,
	itemStartColumn: number,
): ReadonlyArray<string> {
	if (listNode.type.name !== "ordered_list") return [raw];
	const order: unknown = listNode.attrs.order;
	const expected =
		typeof order === "number" && Number.isInteger(order) && order >= 0
			? order
			: 1;
	const lines = raw.split("\n");
	const match = ORDERED_FIRST_LINE.exec(lines[0] ?? "");
	if (!match?.[2]) return [];
	if (Number(match[2]) === expected) return [raw];
	const indent = match[1] ?? "";
	const delimiter = match[3] ?? ".";
	const spacing = match[4] ?? "";
	const content = match[5] ?? "";
	const digits = String(expected);
	const head = `${indent}${digits}${delimiter}`;
	const rewrittenHead = `${head}${spacing}${content}`;
	const oldContentIndent = listItemContentIndent(lines[0] ?? "", itemStartColumn);
	const delta =
		listItemContentIndent(rewrittenHead, itemStartColumn) - oldContentIndent;
	if (delta === 0) return [[rewrittenHead, ...lines.slice(1)].join("\n")];
	const candidates: string[] = [];

	const shifted = lines.slice(1).map((line) => {
		if (line.trim().length === 0) return line;
		const width = measureIndentColumns(line, itemStartColumn);
		if (width < oldContentIndent) return line;
		const body = stripUpToIndentColumns(line, width, itemStartColumn);
		return `${" ".repeat(Math.max(0, width + delta))}${body}`;
	});
	candidates.push([rewrittenHead, ...shifted].join("\n"));

	const spacingWidth = spacing.length;
	const paddedWidth = spacingWidth - (digits.length - match[2].length);
	if (
		content.length > 0 &&
		!spacing.includes("\t") &&
		spacingWidth <= 4 &&
		paddedWidth >= 1 &&
		paddedWidth <= 4
	) {
		candidates.push(
			[`${head}${" ".repeat(paddedWidth)}${content}`, ...lines.slice(1)].join(
				"\n",
			),
		);
	}
	return candidates;
}

/**
 * Whether `markdown` (with physical math newlines possibly masked by
 * `mathNewlineToken`) re-parses at blockquote `depth` to semantically the
 * single edited list node.
 */
function listMarkdownParsesTo(
	markdown: string,
	listNode: ProseMirrorNode,
	depth: number,
	envReferences?: ParsedEnvReferences,
	mathNewlineToken?: string,
): boolean {
	const list = parseListAtDepth(markdown, depth, envReferences, mathNewlineToken);
	return list !== null && nodesSemanticallyEqual(list, listNode);
}

export type PreparedListPreservation = Readonly<{
	hasIndentedTrailingItem: boolean;
	innerRaw: string;
	itemLeadCols: ReadonlyArray<number>;
	/**
	 * Column at which every item line of the list is emitted: preserved lists
	 * at blockquote `depth` are re-prefixed with `"> ".repeat(depth)`
	 * (`emitWithMathSentinelAtDepth`), so the depth-stripped item text starts
	 * at column `2 * depth`.
	 */
	itemStartColumn: number;
	matched: ReadonlyArray<number>;
	orig: ProseMirrorNode;
	paired: ReadonlyArray<number>;
	slices: ListItemSlices;
}>;

type AuthoritativeListResolution = Readonly<{
	firstEmittedSlice: string | null;
	/**
	 * Per-item reusability with `allowShift = true` (base reuse and genuinely
	 * failing left-shifts) BEFORE any whole-list `allowShift = false` fallback
	 * disables shiftable items. Item 0 is intrinsically reusable whenever a
	 * first-marker candidate re-parses to it in isolation, even if the whole
	 * list does not validate yet (a trailing fallback item may still block it).
	 */
	intrinsicItemReusable: ReadonlyArray<boolean>;
	itemReusable: boolean[];
	needsFirstOrderedValidation: boolean;
	output: string | null;
}>;

/**
 * PHP CommonMark §5.2 content indentation of a single serialized list item
 * whose first line is emitted at `startColumn` (tabs expand from there).
 */
function listItemContentIndent(itemText: string, startColumn: number): number {
	const marker = matchListMarker(firstLine(itemText), startColumn);
	return marker !== null ? marker.contentIndent : 0;
}

function hasMultilineMathInSlice(rawSlice: string): boolean {
	if (
		!rawSlice.includes("\n") ||
		(!rawSlice.includes("$") &&
			!rawSlice.includes("\\(") &&
			!rawSlice.includes("\\["))
	) {
		return false;
	}
	const ranges = scanPhpMarkdownMathRanges(rawSlice);
	for (let i = 0; i < ranges.length; i += 1) {
		const range = ranges[i];
		if (!range) continue;
		const nl = rawSlice.indexOf("\n", range.from);
		if (nl !== -1 && nl < range.to) return true;
	}
	return false;
}

/**
 * Safely left-shifts a reused indented sibling list item by `leadCols` spaces
 * so an invalidated or canonicalized predecessor cannot swallow it. Returns
 * `null` when any non-empty continuation line has fewer leading spaces, when
 * multiline math continuation bytes would be altered, when marker content
 * column shifts unevenly (e.g. a tab after the marker), or when the shifted
 * slice does not re-parse to the exact item node.
 */
function tryLeftShiftReusableItem(
	rawSlice: string,
	leadCols: number,
	startColumn: number,
	listNode: ProseMirrorNode,
	itemIdx: number,
	envReferences?: ParsedEnvReferences,
): string | null {
	if (leadCols <= 0) return rawSlice;
	if (hasMultilineMathInSlice(rawSlice)) return null;
	const prefix = " ".repeat(leadCols);
	const lines = rawSlice.split("\n");
	const shiftedLines: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (BLANK_LINE.test(line)) {
			shiftedLines.push(line.startsWith(prefix) ? line.slice(leadCols) : "");
			continue;
		}
		if (!line.startsWith(prefix)) return null;
		shiftedLines.push(line.slice(leadCols));
	}
	const beforeIndent = listItemContentIndent(lines[0] ?? "", startColumn);
	const afterIndent = listItemContentIndent(shiftedLines[0] ?? "", startColumn);
	if (
		beforeIndent <= 0 ||
		afterIndent <= 0 ||
		beforeIndent - afterIndent !== leadCols
	) {
		return null;
	}
	const shifted = shiftedLines.join("\n");
	return sliceParsesToItem(
		shifted,
		listNode,
		itemIdx,
		startColumn / 2,
		envReferences,
	)
		? shifted
		: null;
}

/**
 * Verifies raw baseline slices and aligns list items once so both liveness
 * analysis and final list serialization reuse one prepared plan.
 */
export function prepareListPreservation(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	depth: number,
	envReferences?: ParsedEnvReferences,
	rawOverride?: string,
): PreparedListPreservation | null {
	const orig = origBlock.node;
	if (!listAttrsCompatible(listNode, orig)) return null;
	const innerRaw =
		rawOverride !== undefined
			? rawOverride
			: origBlock.raw !== null
				? tryStripAllLinesAtDepth(origBlock.raw, depth)
				: null;
	if (innerRaw === null) return null;
	const slices = verifiedListItemSlices(
		origBlock,
		depth,
		envReferences,
		innerRaw,
	);
	if (!slices) return null;
	const matched = alignNodes(
		childrenOf(listNode),
		childrenOf(orig),
		structurallyEqual,
	);
	const paired = pairUnmatched(matched, orig.childCount);
	const itemStartColumn = 2 * Math.max(0, depth);
	const itemLeadCols = slices.items.map((slice) =>
		measureIndentColumns(firstLine(slice), itemStartColumn),
	);
	let hasIndentedTrailingItem = false;
	for (let idx = 1; idx < matched.length; idx += 1) {
		const matchedIdx = matched[idx] ?? -1;
		if (matchedIdx >= 0 && (itemLeadCols[matchedIdx] ?? 0) > 0) {
			hasIndentedTrailingItem = true;
			break;
		}
	}
	return {
		hasIndentedTrailingItem,
		innerRaw,
		itemLeadCols,
		itemStartColumn,
		matched,
		orig,
		paired,
		slices,
	};
}

/**
 * Single authoritative whole-list preservation and first-ordered-marker
 * validation shared by `computeIntactRefDefLabels` and
 * `serializeListPreservingItems`. `isReusableOrigItem(origIdx, itemIdx)`
 * gates base reuse of edited item `itemIdx` (matched to baseline `origIdx`).
 * Left-shift attempts and canonical item text are memoized per item for the
 * duration of one call, so repeated assemblies never re-parse or
 * re-serialize the same item.
 */
export function resolveAuthoritativeListPreservation(
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	serializeBlock: BlockSerializer,
	envReferences: ParsedEnvReferences | undefined,
	isReusableOrigItem: (origIdx: number, itemIdx: number) => boolean,
	isPartialTitleRefDef?: PartialTitleRefDefPredicate | null,
	mathNewlineToken?: string,
	buildOutput = true,
): AuthoritativeListResolution {
	const {
		hasIndentedTrailingItem,
		itemLeadCols,
		itemStartColumn,
		matched,
		orig,
		paired,
		slices,
	} = prepared;
	const newLen = listNode.childCount;
	const origLen = orig.childCount;
	const loose = isLooseList(listNode);
	const defaultSeparator = slices.separators[1] ?? (loose ? "\n\n" : "\n");
	const baseReusable = new Array<boolean>(newLen);
	for (let idx = 0; idx < newLen; idx += 1) {
		const matchedIdx = matched[idx] ?? -1;
		baseReusable[idx] = matchedIdx >= 0 && isReusableOrigItem(matchedIdx, idx);
	}
	const shiftCache = new Map<number, string | null>();
	const shiftItem = (idx: number, reused: string, leadCols: number) => {
		let shifted = shiftCache.get(idx);
		if (shifted === undefined) {
			shifted = tryLeftShiftReusableItem(
				reused,
				leadCols,
				itemStartColumn,
				listNode,
				idx,
				envReferences,
			);
			shiftCache.set(idx, shifted);
		}
		return shifted;
	};
	const canonicalCache = new Map<number, string>();
	const canonicalItem = (idx: number, pairedSlice: string | undefined) => {
		let text = canonicalCache.get(idx);
		if (text === undefined) {
			text = serializeListItemAt(
				listNode,
				idx,
				loose,
				serializeBlock,
				pairedSlice !== undefined && BLANK_BEFORE_NESTED_LIST.test(pairedSlice),
				mathNewlineToken,
				isPartialTitleRefDef,
			);
			canonicalCache.set(idx, text);
		}
		return text;
	};

	const assemble = (
		firstRaw: string | null,
		needOutput: boolean,
		allowShift: boolean,
	): Readonly<{
		effectiveReusable: boolean[];
		hasShiftedItem: boolean;
		output: string;
	}> => {
		const effectiveReusable = baseReusable.slice();
		if (firstRaw === null && newLen > 0) effectiveReusable[0] = false;
		const parts: string[] = [];
		let prevContentIndent = 0;
		let hasShiftedItem = false;
		for (let idx = 0; idx < newLen; idx += 1) {
			const matchedIdx = matched[idx] ?? -1;
			const pairedIdx = paired[idx] ?? -1;
			if (needOutput && idx > 0) {
				const prevPaired = paired[idx - 1] ?? -1;
				parts.push(
					pairedIdx >= 0 && prevPaired >= 0 && pairedIdx === prevPaired + 1
						? (slices.separators[pairedIdx] ?? defaultSeparator)
						: defaultSeparator,
				);
			}
			let reused =
				idx === 0
					? (firstRaw ?? undefined)
					: effectiveReusable[idx]
						? slices.items[matchedIdx]
						: undefined;
			if (idx > 0 && reused !== undefined && hasIndentedTrailingItem) {
				const leadCols = itemLeadCols[matchedIdx] ?? 0;
				if (
					leadCols > 0 &&
					prevContentIndent > 0 &&
					leadCols >= prevContentIndent
				) {
					const shifted = allowShift ? shiftItem(idx, reused, leadCols) : null;
					if (shifted !== null) {
						reused = shifted;
						hasShiftedItem = true;
					} else {
						reused = undefined;
						effectiveReusable[idx] = false;
					}
				}
			}
			const needNextIndent =
				hasIndentedTrailingItem &&
				idx + 1 < newLen &&
				effectiveReusable[idx + 1] === true &&
				(itemLeadCols[matched[idx + 1] ?? -1] ?? 0) > 0;
			if (reused !== undefined) {
				if (needOutput) parts.push(reused);
				if (needNextIndent) {
					prevContentIndent = listItemContentIndent(reused, itemStartColumn);
				}
				continue;
			}
			if (needOutput || needNextIndent) {
				const pairedSlice =
					pairedIdx >= 0 ? slices.items[pairedIdx] : undefined;
				const serializedItem = canonicalItem(idx, pairedSlice);
				if (needOutput) parts.push(serializedItem);
				if (needNextIndent) {
					prevContentIndent = listItemContentIndent(
						serializedItem,
						itemStartColumn,
					);
				}
			}
		}
		if (
			needOutput &&
			newLen > 0 &&
			(paired[newLen - 1] ?? -1) === origLen - 1
		) {
			parts.push(slices.tail);
		}
		return {
			effectiveReusable,
			hasShiftedItem,
			output: needOutput ? parts.join("") : "",
		};
	};

	const parsesTo = (markdown: string): boolean =>
		listMarkdownParsesTo(
			markdown,
			listNode,
			itemStartColumn / 2,
			envReferences,
			mathNewlineToken,
		);

	const finalizeDirect = (
		firstRaw: string | null,
	): AuthoritativeListResolution => {
		if (!buildOutput && !hasIndentedTrailingItem) {
			const effectiveReusable = baseReusable.slice();
			if (firstRaw === null && newLen > 0) effectiveReusable[0] = false;
			return {
				firstEmittedSlice: firstRaw,
				intrinsicItemReusable: effectiveReusable.slice(),
				itemReusable: effectiveReusable,
				needsFirstOrderedValidation: false,
				output: null,
			};
		}
		let assembled = assemble(firstRaw, buildOutput, true);
		const intrinsicItemReusable = assembled.effectiveReusable;
		if (assembled.hasShiftedItem) {
			// Shift results and canonical items are memoized, so building the
			// full text after a mask-only pass re-parses nothing.
			const full = buildOutput ? assembled : assemble(firstRaw, true, true);
			if (!parsesTo(full.output)) {
				assembled = assemble(firstRaw, buildOutput, false);
			}
		}
		return {
			firstEmittedSlice: firstRaw,
			intrinsicItemReusable,
			itemReusable: assembled.effectiveReusable,
			needsFirstOrderedValidation: false,
			output: buildOutput ? assembled.output : null,
		};
	};

	const firstMatched = newLen > 0 ? (matched[0] ?? -1) : -1;
	const firstReused =
		baseReusable[0] === true && firstMatched >= 0
			? slices.items[firstMatched]
			: undefined;
	if (firstReused === undefined) {
		return finalizeDirect(null);
	}
	const candidates = alignFirstOrderedMarker(
		listNode,
		firstReused,
		itemStartColumn,
	);
	if (candidates.length === 1 && candidates[0] === firstReused) {
		return finalizeDirect(firstReused);
	}
	// Masks of the first candidate that re-parses to item 0 in isolation but
	// fails whole-list validation: its trailing items (not item 0) decide
	// which items must stabilize before item 0 is retried.
	let locallyValid: Readonly<{
		fallback: ReadonlyArray<boolean>;
		intrinsic: ReadonlyArray<boolean>;
	}> | null = null;
	for (const candidate of candidates) {
		let assembled = assemble(candidate, true, true);
		const intrinsicItemReusable = assembled.effectiveReusable;
		if (parsesTo(assembled.output)) {
			return {
				firstEmittedSlice: candidate,
				intrinsicItemReusable,
				itemReusable: assembled.effectiveReusable,
				needsFirstOrderedValidation: true,
				output: buildOutput ? assembled.output : null,
			};
		}
		if (assembled.hasShiftedItem) {
			assembled = assemble(candidate, true, false);
			if (parsesTo(assembled.output)) {
				return {
					firstEmittedSlice: candidate,
					intrinsicItemReusable,
					itemReusable: assembled.effectiveReusable,
					needsFirstOrderedValidation: true,
					output: buildOutput ? assembled.output : null,
				};
			}
		}
		if (
			locallyValid === null &&
			sliceParsesToItem(
				candidate,
				listNode,
				0,
				itemStartColumn / 2,
				envReferences,
			)
		) {
			locallyValid = {
				fallback: assembled.effectiveReusable,
				intrinsic: intrinsicItemReusable,
			};
		}
	}
	if (locallyValid === null) return finalizeDirect(null);
	const intrinsic = locallyValid.intrinsic.slice();
	intrinsic[0] = true;
	const fallback = locallyValid.fallback.slice();
	fallback[0] = false;
	return {
		firstEmittedSlice: null,
		intrinsicItemReusable: intrinsic,
		itemReusable: fallback,
		needsFirstOrderedValidation: true,
		output: buildOutput ? finalizeDirect(null).output : null,
	};
}

/**
 * Serialize an edited list (top-level or blockquote-nested), reusing every
 * untouched item's exact raw slice (unless invalidated by a deleted/shadowed
 * reference definition) and original inter-item separators. Returns `null`
 * when the baseline list cannot be sliced safely.
 */
export function serializeListPreservingItems(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	serializeBlock: BlockSerializer,
	envReferences?: ParsedEnvReferences,
	isPartialTitleRefDef?: PartialTitleRefDefPredicate | null,
	canReuseItem?:
		| ((origItem: ProseMirrorNode, itemIdx: number) => boolean)
		| null,
	rawOverride?: string,
	mathNewlineToken?: string,
	preparedOverride?: PreparedListPreservation,
	depth = 0,
): string | null {
	const prepared =
		preparedOverride ??
		prepareListPreservation(
			listNode,
			origBlock,
			depth,
			envReferences,
			rawOverride,
		);
	if (!prepared) return null;
	const isReusableOrigItem = (origIdx: number, itemIdx: number): boolean =>
		origIdx >= 0 &&
		(!canReuseItem || canReuseItem(prepared.orig.child(origIdx), itemIdx));
	return resolveAuthoritativeListPreservation(
		listNode,
		prepared,
		serializeBlock,
		envReferences,
		isReusableOrigItem,
		isPartialTitleRefDef,
		mathNewlineToken,
		true,
	).output;
}
