import type { Node as ProseMirrorNode } from "prosemirror-model";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	listAttrsCompatible,
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
	matchListMarker,
	measureIndentColumns,
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

function sliceParsesToItem(
	slice: string,
	listNode: ProseMirrorNode,
	index: number,
	envReferences?: ParsedEnvReferences,
): boolean {
	const doc = parseMarkdownWithBlockSources(slice, envReferences).doc;
	const list = doc.childCount === 1 ? doc.firstChild : null;
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
				sliceParsesToItem(slice, block.node, i, envReferences),
			)
		) {
			result = slices;
		}
	}
	verifiedSliceCache.set(block, result);
	return result;
}

/** Column reached after `text`, expanding tabs to 4-column stops. */
function advanceColumns(text: string, startColumn: number): number {
	let column = startColumn;
	for (const ch of text) {
		column = ch === "\t" ? column + 4 - (column % 4) : column + 1;
	}
	return column;
}

/**
 * A reused raw item that becomes the first item of an ordered list defines
 * the CommonMark start number. When its digits differ from the projected
 * `order`, return candidate rewrites (keeping indent, delimiter, and body
 * bytes as far as possible) in preference order. Each candidate must still be
 * validated in list context; an empty result means "serialize the item".
 */
function alignFirstOrderedMarker(
	listNode: ProseMirrorNode,
	raw: string,
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
	const delta = digits.length - match[2].length;
	const head = `${indent}${digits}${delimiter}`;
	const firstLine = `${head}${spacing}${content}`;
	if (delta === 0) return [[firstLine, ...lines.slice(1)].join("\n")];

	const markerEnd = advanceColumns(
		`${match[2]}${delimiter}`,
		advanceColumns(indent, 0),
	);
	const spacingWidth = advanceColumns(spacing, markerEnd) - markerEnd;
	const oldContentColumn =
		content.length > 0 && spacingWidth >= 1 && spacingWidth <= 4
			? markerEnd + spacingWidth
			: markerEnd + 1;
	const candidates: string[] = [];

	const shifted = lines.slice(1).map((line) => {
		if (line.trim().length === 0) return line;
		const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
		const width = advanceColumns(leading, 0);
		if (width < oldContentColumn) return line;
		return `${" ".repeat(Math.max(0, width + delta))}${line.slice(leading.length)}`;
	});
	candidates.push([firstLine, ...shifted].join("\n"));

	const paddedWidth = spacingWidth - delta;
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

/** Whether `markdown` re-parses to semantically the single edited list node. */
function listMarkdownParsesTo(
	markdown: string,
	listNode: ProseMirrorNode,
	envReferences?: ParsedEnvReferences,
): boolean {
	const doc = parseMarkdownWithBlockSources(markdown, envReferences).doc;
	return (
		doc.childCount === 1 &&
		doc.firstChild !== null &&
		nodesSemanticallyEqual(doc.firstChild, listNode)
	);
}

export type PreparedListPreservation = Readonly<{
	hasIndentedTrailingItem: boolean;
	innerRaw: string;
	itemLeadCols: ReadonlyArray<number>;
	matched: ReadonlyArray<number>;
	orig: ProseMirrorNode;
	paired: ReadonlyArray<number>;
	slices: ListItemSlices;
}>;

type AuthoritativeListResolution = Readonly<{
	firstEmittedSlice: string | null;
	itemReusable: boolean[];
	needsFirstOrderedValidation: boolean;
	output: string | null;
}>;

/** CommonMark §5.2 content indentation column of a single serialized list item. */
function listItemContentIndent(itemText: string): number {
	const nl = itemText.indexOf("\n");
	const firstLine = nl === -1 ? itemText : itemText.slice(0, nl);
	return matchListMarker(firstLine)?.contentIndent ?? 0;
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
	const beforeIndent = matchListMarker(lines[0] ?? "")?.contentIndent ?? 0;
	const afterIndent =
		matchListMarker(shiftedLines[0] ?? "")?.contentIndent ?? 0;
	if (
		beforeIndent <= 0 ||
		afterIndent <= 0 ||
		beforeIndent - afterIndent !== leadCols
	) {
		return null;
	}
	const shifted = shiftedLines.join("\n");
	return sliceParsesToItem(shifted, listNode, itemIdx, envReferences)
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
	const slices = verifiedListItemSlices(origBlock, envReferences, innerRaw);
	if (!slices) return null;
	const matched = alignNodes(
		childrenOf(listNode),
		childrenOf(orig),
		structurallyEqual,
	);
	const paired = pairUnmatched(matched, orig.childCount);
	const itemLeadCols = slices.items.map((slice) => {
		const nl = slice.indexOf("\n");
		return measureIndentColumns(nl === -1 ? slice : slice.slice(0, nl));
	});
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
		matched,
		orig,
		paired,
		slices,
	};
}

/**
 * Single authoritative whole-list preservation and first-ordered-marker
 * validation shared by `computeIntactRefDefLabels` and
 * `serializeListPreservingItems`.
 */
export function resolveAuthoritativeListPreservation(
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	serializeBlock: BlockSerializer,
	envReferences: ParsedEnvReferences | undefined,
	isReusableOrigItem: (origIdx: number) => boolean,
	isPartialTitleRefDef?: PartialTitleRefDefPredicate | null,
	mathNewlineToken?: string,
	buildOutput = true,
): AuthoritativeListResolution {
	const {
		hasIndentedTrailingItem,
		itemLeadCols,
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
		baseReusable[idx] = matchedIdx >= 0 && isReusableOrigItem(matchedIdx);
	}

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
					const shifted = allowShift
						? tryLeftShiftReusableItem(
								reused,
								leadCols,
								listNode,
								idx,
								envReferences,
							)
						: null;
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
					prevContentIndent = listItemContentIndent(reused);
				}
				continue;
			}
			if (needOutput || needNextIndent) {
				const pairedSlice =
					pairedIdx >= 0 ? slices.items[pairedIdx] : undefined;
				const serializedItem = serializeListItemAt(
					listNode,
					idx,
					loose,
					serializeBlock,
					pairedSlice !== undefined &&
						BLANK_BEFORE_NESTED_LIST.test(pairedSlice),
					mathNewlineToken,
					isPartialTitleRefDef,
				);
				if (needOutput) parts.push(serializedItem);
				if (needNextIndent) {
					prevContentIndent = listItemContentIndent(serializedItem);
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

	const finalizeDirect = (
		firstRaw: string | null,
	): AuthoritativeListResolution => {
		if (!buildOutput && !hasIndentedTrailingItem) {
			const effectiveReusable = baseReusable.slice();
			if (firstRaw === null && newLen > 0) effectiveReusable[0] = false;
			return {
				firstEmittedSlice: firstRaw,
				itemReusable: effectiveReusable,
				needsFirstOrderedValidation: false,
				output: null,
			};
		}
		let assembled = assemble(firstRaw, buildOutput, true);
		if (assembled.hasShiftedItem) {
			const full = buildOutput ? assembled : assemble(firstRaw, true, true);
			const unmasked =
				mathNewlineToken !== undefined
					? restoreMathNewlineSentinel(full.output, mathNewlineToken)
					: full.output;
			if (!listMarkdownParsesTo(unmasked, listNode, envReferences)) {
				assembled = assemble(firstRaw, buildOutput, false);
			}
		}
		return {
			firstEmittedSlice: firstRaw,
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
	const candidates = alignFirstOrderedMarker(listNode, firstReused);
	if (candidates.length === 1 && candidates[0] === firstReused) {
		return finalizeDirect(firstReused);
	}
	for (const candidate of candidates) {
		let assembled = assemble(candidate, true, true);
		let unmasked =
			mathNewlineToken !== undefined
				? restoreMathNewlineSentinel(assembled.output, mathNewlineToken)
				: assembled.output;
		if (listMarkdownParsesTo(unmasked, listNode, envReferences)) {
			return {
				firstEmittedSlice: candidate,
				itemReusable: assembled.effectiveReusable,
				needsFirstOrderedValidation: true,
				output: buildOutput ? assembled.output : null,
			};
		}
		if (assembled.hasShiftedItem) {
			assembled = assemble(candidate, true, false);
			unmasked =
				mathNewlineToken !== undefined
					? restoreMathNewlineSentinel(assembled.output, mathNewlineToken)
					: assembled.output;
			if (listMarkdownParsesTo(unmasked, listNode, envReferences)) {
				return {
					firstEmittedSlice: candidate,
					itemReusable: assembled.effectiveReusable,
					needsFirstOrderedValidation: true,
					output: buildOutput ? assembled.output : null,
				};
			}
		}
	}
	return finalizeDirect(null);
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
	canReuseItem?: ((origItem: ProseMirrorNode) => boolean) | null,
	rawOverride?: string,
	mathNewlineToken?: string,
	preparedOverride?: PreparedListPreservation,
): string | null {
	const prepared =
		preparedOverride ??
		prepareListPreservation(listNode, origBlock, 0, envReferences, rawOverride);
	if (!prepared) return null;
	const isReusableOrigItem = (origIdx: number): boolean =>
		origIdx >= 0 &&
		(!canReuseItem || canReuseItem(prepared.orig.child(origIdx)));
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
