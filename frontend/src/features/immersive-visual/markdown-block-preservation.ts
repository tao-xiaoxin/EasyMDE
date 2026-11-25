import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	type BlockSerializer,
	isLooseList,
	isNestedList,
	joinSerializedBlocks,
	LEADING_FOUR_COLUMN_INDENT,
	nodeCanLazilyContinue,
	nodePreventsFollowingIndentedCode,
	PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE,
	refDefContinuationMode,
	serializeListItemAt,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	extractReferenceDefinitionLabels,
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	type ParsedVisualSharedGroup,
	parseMarkdownWithBlockSources,
	type ReferenceLinkOrigin,
} from "./markdown-parser";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";

export {
	type BlockSerializer,
	createMathNewlineSentinelForNode,
	joinSerializedBlocks,
	needsTightRefDefContinuation,
	refDefContinuationMode,
	restoreMathNewlineSentinel,
	serializeList,
} from "./markdown-list-serialization";

/**
 * Untouched-source preservation for the immersive visual editor.
 *
 * The visual editor is an in-memory projection of canonical Markdown. When a
 * legitimate edit is synchronized back, every block (and every list item of an
 * edited top-level list) that the user did not touch keeps its exact original
 * bytes, including blank-line separators. Only edited nodes are regenerated.
 *
 * Block/inline serialization is injected by `markdown-serializer.ts`, keeping
 * the dependency direction one-way (serializer -> preservation).
 */

export type ReferenceLinkResolver = (mark: Mark) => ReferenceLinkOrigin | null;

export type MarkdownRoundTripGuard = Readonly<{
	initialDoc: ProseMirrorNode;
	initialMarkdown: string;
	isUnmodified: (doc: ProseMirrorNode) => boolean;
	serialize: (doc: ProseMirrorNode) => string;
}>;

export type MarkdownSerializers = Readonly<{
	serializeBlock: BlockSerializer;
	serializeBlockWithRefs?: (
		node: ProseMirrorNode,
		resolveReferenceLink: ReferenceLinkResolver | null,
		mathNewlineToken?: string,
	) => string;
	serializeDoc: (doc: ProseMirrorNode) => string;
}>;

// ---------------------------------------------------------------------------
// List-item granular preservation
// ---------------------------------------------------------------------------

type ListItemSlices = Readonly<{
	items: ReadonlyArray<string>;
	/** `separators[i]` precedes item `i`; `separators[0]` is always empty. */
	separators: ReadonlyArray<string>;
	tail: string;
}>;

const LIST_ITEM_START = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLANK_LINE = /^[ \t]*$/;
const BLANK_BEFORE_NESTED_LIST =
	/\n[ \t]*\n[ \t]+(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

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
): boolean {
	const doc = parseMarkdownWithBlockSources(slice).doc;
	const list = doc.childCount === 1 ? doc.firstChild : null;
	return (
		list !== null &&
		list.type === listNode.type &&
		list.childCount === 1 &&
		list.child(0).eq(listNode.child(index))
	);
}

const verifiedSliceCache = new WeakMap<
	ParsedVisualBlockSource,
	ListItemSlices | null
>();

/** Item slices proven to re-parse to exactly the baseline item nodes. */
function verifiedListItemSlices(
	block: ParsedVisualBlockSource,
): ListItemSlices | null {
	const cached = verifiedSliceCache.get(block);
	if (cached !== undefined) return cached;
	let result: ListItemSlices | null = null;
	if (block.raw !== null && isNestedList(block.node)) {
		const slices = splitListItemSlices(block.raw);
		if (
			slices &&
			slices.items.length === block.node.childCount &&
			slices.items.every((slice, i) => sliceParsesToItem(slice, block.node, i))
		) {
			result = slices;
		}
	}
	verifiedSliceCache.set(block, result);
	return result;
}

function listAttrsCompatible(
	next: ProseMirrorNode,
	orig: ProseMirrorNode,
): boolean {
	if (next.type !== orig.type) return false;
	for (const key of Object.keys(orig.attrs)) {
		if (key !== "tight" && next.attrs[key] !== orig.attrs[key]) return false;
	}
	return true;
}

/** Column reached after `text`, expanding tabs to 4-column stops. */
function advanceColumns(text: string, startColumn: number): number {
	let column = startColumn;
	for (const ch of text) {
		column = ch === "\t" ? column + 4 - (column % 4) : column + 1;
	}
	return column;
}

const ORDERED_FIRST_LINE = /^([ \t]*)(\d{1,9})([.)])([ \t]*)(.*)$/;

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

	// Original content column, in Markdown columns (4-column tab stops).
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

	// 1. Shift structural continuation lines (indented to at least the old
	// content column) by the width change. Lazy continuation lines indented
	// less than the content column keep their exact bytes.
	const shifted = lines.slice(1).map((line) => {
		if (line.trim().length === 0) return line;
		const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
		const width = advanceColumns(leading, 0);
		if (width < oldContentColumn) return line;
		return `${" ".repeat(Math.max(0, width + delta))}${line.slice(leading.length)}`;
	});
	candidates.push([firstLine, ...shifted].join("\n"));

	// 2. Keep every continuation byte and absorb the width change in the
	// marker spacing, so the content column itself does not move.
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

/** Whether `markdown` re-parses to exactly the single edited list node. */
function listMarkdownParsesTo(
	markdown: string,
	listNode: ProseMirrorNode,
): boolean {
	const doc = parseMarkdownWithBlockSources(markdown).doc;
	return (
		doc.childCount === 1 &&
		doc.firstChild !== null &&
		doc.firstChild.eq(listNode)
	);
}

/**
 * Serialize an edited top-level list, reusing every untouched item's exact
 * raw slice and original inter-item separators. Returns `null` when the
 * baseline list cannot be sliced safely (caller regenerates the whole list).
 */
function serializeListPreservingItems(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	serializeBlock: BlockSerializer,
): string | null {
	const orig = origBlock.node;
	if (!listAttrsCompatible(listNode, orig)) return null;
	const slices = verifiedListItemSlices(origBlock);
	if (!slices) return null;
	const newLen = listNode.childCount;
	const origLen = orig.childCount;
	const matched = alignNodes(
		childrenOf(listNode),
		childrenOf(orig),
		structurallyEqual,
	);
	const paired = pairUnmatched(matched, origLen);
	const loose = isLooseList(listNode);
	const defaultSeparator = slices.separators[1] ?? (loose ? "\n\n" : "\n");

	/** `firstRaw === null` serializes item 0 through the structural path. */
	const assemble = (firstRaw: string | null): string => {
		let output = "";
		for (let idx = 0; idx < newLen; idx += 1) {
			const matchedIdx = matched[idx] ?? -1;
			const pairedIdx = paired[idx] ?? -1;
			if (idx > 0) {
				const prevPaired = paired[idx - 1] ?? -1;
				output +=
					pairedIdx >= 0 && prevPaired >= 0 && pairedIdx === prevPaired + 1
						? (slices.separators[pairedIdx] ?? defaultSeparator)
						: defaultSeparator;
			}
			const reused =
				idx === 0
					? (firstRaw ?? undefined)
					: matchedIdx >= 0
						? slices.items[matchedIdx]
						: undefined;
			if (reused !== undefined) {
				output += reused;
				continue;
			}
			const pairedSlice = pairedIdx >= 0 ? slices.items[pairedIdx] : undefined;
			output += serializeListItemAt(
				listNode,
				idx,
				loose,
				serializeBlock,
				pairedSlice !== undefined && BLANK_BEFORE_NESTED_LIST.test(pairedSlice),
			);
		}
		if (newLen > 0 && (paired[newLen - 1] ?? -1) === origLen - 1) {
			output += slices.tail;
		}
		return output;
	};

	const firstMatched = newLen > 0 ? (matched[0] ?? -1) : -1;
	const firstReused =
		firstMatched >= 0 ? slices.items[firstMatched] : undefined;
	if (firstReused === undefined) return assemble(null);
	const candidates = alignFirstOrderedMarker(listNode, firstReused);
	if (candidates.length === 1 && candidates[0] === firstReused) {
		return assemble(firstReused);
	}
	// A rewritten first item is accepted only when the whole list re-parses
	// to the edited node; otherwise that item is regenerated structurally.
	for (const candidate of candidates) {
		const output = assemble(candidate);
		if (listMarkdownParsesTo(output, listNode)) return output;
	}
	return assemble(null);
}

// ---------------------------------------------------------------------------
// Document-level preservation
// ---------------------------------------------------------------------------

function isEmptyDoc(doc: ProseMirrorNode): boolean {
	return (
		doc.childCount === 1 &&
		doc.firstChild?.type.name === "paragraph" &&
		doc.firstChild.childCount === 0
	);
}

const BLANK_BLOCKQUOTE_LINE = /^[ \t]*(?:>[ \t]*)+$/;
const ATX_HEADING_FIRST_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;

function normalizeRefDefLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

function collectNodeRefDefLabels(node: ProseMirrorNode, out: Set<string>): void {
	const visit = (current: ProseMirrorNode): void => {
		if (
			current.type.name === "protected_block" &&
			current.attrs.kind === "raw" &&
			typeof current.attrs.rawMarkdown === "string"
		) {
			const labels = extractReferenceDefinitionLabels(current.attrs.rawMarkdown);
			if (labels) {
				for (const label of labels) {
					out.add(normalizeRefDefLabel(label));
				}
			}
		}
	};
	visit(node);
	if (node.childCount > 0) {
		node.descendants((descendant) => {
			visit(descendant);
			return true;
		});
	}
}

function wouldBeLazilyAbsorbedByPrevious(
	node: ProseMirrorNode,
	serialized: string,
): boolean {
	const name = node.type.name;
	if (name === "paragraph") {
		return true;
	}
	if (name === "heading") {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		return !ATX_HEADING_FIRST_LINE.test(firstLine);
	}
	if (name === "code_block") {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		return LEADING_FOUR_COLUMN_INDENT.test(firstLine);
	}
	if (name === "table") {
		return !serialized.startsWith("<!-- ");
	}
	if (name === "ordered_list" || name === "bullet_list" || name === "task_list") {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		return !PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE.test(firstLine);
	}
	if (name === "protected_block") {
		if (node.attrs.kind === "mermaid") {
			return false;
		}
		if (node.attrs.kind === "raw" && typeof node.attrs.rawMarkdown === "string") {
			const raw = node.attrs.rawMarkdown;
			const nl = raw.indexOf("\n");
			const firstLine = (nl === -1 ? raw : raw.slice(0, nl)).replace(
				/^[ \t]{0,3}/,
				"",
			);
			return !wouldRawHtmlInterruptParagraph(firstLine);
		}
		return true;
	}
	return false;
}

function endsWithBlankBlockquoteLine(text: string): boolean {
	const lastNewline = text.lastIndexOf("\n");
	const lastLine = lastNewline === -1 ? text : text.slice(lastNewline + 1);
	return BLANK_BLOCKQUOTE_LINE.test(lastLine);
}

function serializeDocPreservingUntouchedBlocks(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializers: MarkdownSerializers,
): string {
	if (isEmptyDoc(doc)) {
		return "";
	}
	const baselineBlocks = parsed.blocks;
	if (baselineBlocks.length === 0) {
		return serializers.serializeDoc(doc);
	}

	const newLen = doc.childCount;
	const origLen = baselineBlocks.length;
	const matchedOrigIndex = alignNodes(
		childrenOf(doc),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(matchedOrigIndex, origLen);
	// Original index whose separator semantics this output block inherits.
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);

	const keepLeadingPrefix = matchedOrigIndex[0] === 0;
	const parts: string[] = [];
	if (keepLeadingPrefix && parsed.leadingPrefix.length > 0) {
		parts.push(parsed.leadingPrefix);
	}
	const isIntactSharedGroupAt = (
		docIdx: number,
		group: ParsedVisualSharedGroup,
	): boolean => {
		const len = group.endIndex - group.startIndex;
		if (docIdx + len > newLen) return false;
		for (let offset = 0; offset < len; offset += 1) {
			if (matchedOrigIndex[docIdx + offset] !== group.startIndex + offset) {
				return false;
			}
		}
		return true;
	};
	const isTightRightNeighborIntact = (() => {
		const memo = new Map<number, boolean>();
		return (
			startDocIdx: number,
			startGroup: ParsedVisualSharedGroup,
		): boolean => {
			const cachedStart = memo.get(startGroup.startIndex);
			if (cachedStart !== undefined) {
				return cachedStart;
			}
			const chain: number[] = [];
			let curDocIdx = startDocIdx;
			let curGroup = startGroup;
			let intact = true;
			while (true) {
				const cached = memo.get(curGroup.startIndex);
				if (cached !== undefined) {
					intact = cached;
					break;
				}
				chain.push(curGroup.startIndex);
				const nextOrig = baselineBlocks[curGroup.endIndex];
				if (!nextOrig) {
					break;
				}
				const nextGroup =
					nextOrig.sharedGroup?.startIndex === curGroup.endIndex
						? nextOrig.sharedGroup
						: undefined;
				const nextSep = nextGroup
					? nextGroup.separatorBefore
					: nextOrig.separatorBefore;
				if (nextSep !== "\n") {
					break;
				}
				const afterDocIdx =
					curDocIdx + (curGroup.endIndex - curGroup.startIndex);
				if (
					afterDocIdx >= newLen ||
					matchedOrigIndex[afterDocIdx] !== curGroup.endIndex
				) {
					intact = false;
					break;
				}
				if (!nextGroup) {
					break;
				}
				if (!isIntactSharedGroupAt(afterDocIdx, nextGroup)) {
					intact = false;
					break;
				}
				curDocIdx = afterDocIdx;
				curGroup = nextGroup;
			}
			for (let k = 0; k < chain.length; k += 1) {
				const key = chain[k];
				if (key !== undefined) {
					memo.set(key, intact);
				}
			}
			return intact;
		};
	})();
	const intactRefDefLabels = new Set<string>();
	if (
		parsed.referenceLinks &&
		parsed.referenceLinks.size > 0 &&
		parsed.phpPartialTitleRefLabels &&
		parsed.phpPartialTitleRefLabels.size > 0 &&
		parsed.refDefLabelsByBlock &&
		parsed.refDefLabelsByBlock.size > 0 &&
		serializers.serializeBlockWithRefs
	) {
		const seenLabels = new Set<string>();
		for (let idx = 0; idx < newLen; idx += 1) {
			const origIdx = matchedOrigIndex[idx] ?? -1;
			if (origIdx < 0) {
				collectNodeRefDefLabels(doc.child(idx), seenLabels);
				continue;
			}
			const labels = parsed.refDefLabelsByBlock.get(origIdx);
			if (!labels) continue;
			for (const label of labels) {
				if (seenLabels.has(label)) continue;
				seenLabels.add(label);
				if (
					parsed.phpPartialTitleRefLabels.has(label) &&
					parsed.firstRefDefBlockByLabel?.get(label) === origIdx
				) {
					intactRefDefLabels.add(label);
				}
			}
		}
	}
	const resolveActiveRefLink: ReferenceLinkResolver | null =
		intactRefDefLabels.size > 0 &&
		parsed.referenceLinks &&
		serializers.serializeBlockWithRefs
			? (mark) => {
					const origin = parsed.referenceLinks?.get(mark);
					return origin && intactRefDefLabels.has(origin.normalizedLabel)
						? origin
						: null;
				}
			: null;
	const activeSerializeBlock: BlockSerializer =
		resolveActiveRefLink !== null && serializers.serializeBlockWithRefs
			? (node, mathNewlineToken) =>
					serializers.serializeBlockWithRefs?.(
						node,
						resolveActiveRefLink,
						mathNewlineToken,
					) ?? serializers.serializeBlock(node, mathNewlineToken)
			: serializers.serializeBlock;
	let prevBlockText = "";
	for (let idx = 0; idx < newLen; idx += 1) {
		const child = doc.child(idx);
		const origIdx = matchedOrigIndex[idx] ?? -1;
		const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
		const sharedGroup = origBlock?.sharedGroup;
		let intactGroup =
			sharedGroup &&
			origIdx === sharedGroup.startIndex &&
			isIntactSharedGroupAt(idx, sharedGroup) &&
			isTightRightNeighborIntact(idx, sharedGroup)
				? sharedGroup
				: undefined;
		let serialized: string | null = intactGroup
			? intactGroup.raw
			: origBlock && origBlock.raw !== null
				? origBlock.raw
				: null;
		if (intactGroup || (origBlock && !sharedGroup)) {
			effectiveOrigIndex[idx] = origIdx;
		} else if (!origBlock && isNestedList(child)) {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
			if (pairedBlock && pairedBlock.raw !== null) {
				serialized = serializeListPreservingItems(
					child,
					pairedBlock,
					activeSerializeBlock,
				);
				if (serialized !== null) effectiveOrigIndex[idx] = pairedIdx;
			}
		}
		const prevNode = idx > 0 ? doc.child(idx - 1) : null;
		const resolveJoin = (
			text: string,
			effIdx: number,
			groupSep?: string,
		): Readonly<{
			refDefMode: ReturnType<typeof refDefContinuationMode>;
			separator: string;
		}> => {
			const mode = prevNode
				? refDefContinuationMode(prevNode, child, text)
				: "none";
			if (!prevNode) return { refDefMode: mode, separator: "" };
			const prevEffIdx = effectiveOrigIndex[idx - 1] ?? -1;
			const inheritedSep =
				effIdx >= 0 && prevEffIdx >= 0 && effIdx === prevEffIdx + 1
					? (groupSep ?? baselineBlocks[effIdx]?.separatorBefore)
					: undefined;
			let sep = mode !== "none" ? "\n" : (inheritedSep ?? "\n\n");
			if (
				mode === "none" &&
				!/\n[ \t]*\n/.test(sep) &&
				(matchedOrigIndex[idx - 1] ?? -1) < 0 &&
				nodeCanLazilyContinue(prevNode) &&
				!endsWithBlankBlockquoteLine(prevBlockText) &&
				wouldBeLazilyAbsorbedByPrevious(child, text)
			) {
				sep = "\n\n";
			}
			return { refDefMode: mode, separator: sep };
		};
		let candidateText =
			serialized !== null ? serialized : activeSerializeBlock(child);
		let { refDefMode, separator } = resolveJoin(
			candidateText,
			effectiveOrigIndex[idx] ?? -1,
			intactGroup?.separatorBefore,
		);
		const isIndentedRisk = (text: string, sep: string): boolean =>
			child.type.name !== "code_block" &&
			LEADING_FOUR_COLUMN_INDENT.test(text) &&
			(sep !== "\n" ||
				!prevNode ||
				!nodePreventsFollowingIndentedCode(prevNode) ||
				endsWithBlankBlockquoteLine(prevBlockText));
		const brokenTightLeft =
			intactGroup !== undefined &&
			intactGroup.separatorBefore === "\n" &&
			(separator !== "\n" ||
				(effectiveOrigIndex[idx - 1] ?? -1) !== intactGroup.startIndex - 1);
		if (
			intactGroup &&
			(brokenTightLeft || isIndentedRisk(intactGroup.raw, separator))
		) {
			// A shared group whose tight left neighbor changed or whose 4-column
			// indent would now form indented code falls back to canonical blocks.
			intactGroup = undefined;
			serialized = null;
			effectiveOrigIndex[idx] = -1;
			candidateText = activeSerializeBlock(child);
			({ refDefMode, separator } = resolveJoin(candidateText, -1));
		}
		if (prevNode) parts.push(separator);
		let blockText = candidateText;
		if (
			!intactGroup &&
			serialized !== null &&
			isIndentedRisk(serialized, separator)
		) {
			// A blank-line separator or non-lazy predecessor (e.g. edited list item
			// ending in heading/code/HR/table) would turn the reused 4-column slice
			// into an indented code block. Protected blocks dedent only line 0 so
			// PHP preserves continuation-line formula indentation.
			blockText =
				child.type.name === "protected_block"
					? serialized.replace(/^[ \t]+/, "")
					: activeSerializeBlock(child);
		}
		const emittedBlockText =
			refDefMode === "indented" && !LEADING_FOUR_COLUMN_INDENT.test(blockText)
				? `    ${blockText}`
				: blockText;
		parts.push(emittedBlockText);
		prevBlockText = emittedBlockText;
		if (intactGroup) {
			const groupLen = intactGroup.endIndex - intactGroup.startIndex;
			for (let offset = 1; offset < groupLen; offset += 1) {
				effectiveOrigIndex[idx + offset] = intactGroup.startIndex + offset;
			}
			idx += groupLen - 1;
		}
	}
	let output = parts.join("");
	// A multi-block document replaced without any surviving baseline block must
	// not re-attach the stale trailing newlines; an in-place single-block edit
	// (`"Hello\n"` -> `"Hello!\n"`) still keeps its suffix.
	const keepTrailingSuffix =
		origLen === 1 || matchedOrigIndex.some((origIdx) => origIdx >= 0);
	if (output.length > 0 && keepTrailingSuffix) {
		output += parsed.trailingSuffix;
	}
	if (parsed.lineEnding === "\r\n") {
		output = output.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
	}
	return output;
}

function rebindReferenceLinks(
	sourceDoc: ProseMirrorNode,
	targetDoc: ProseMirrorNode,
	sourceLinks: ReadonlyMap<Mark, ReferenceLinkOrigin>,
): Map<Mark, ReferenceLinkOrigin> {
	const rebound = new Map<Mark, ReferenceLinkOrigin>();
	const walk = (src: ProseMirrorNode, dst: ProseMirrorNode): void => {
		if (src.marks.length > 0 && src.marks.length === dst.marks.length) {
			for (let m = 0; m < src.marks.length; m += 1) {
				const srcMark = src.marks[m];
				const dstMark = dst.marks[m];
				if (srcMark && dstMark) {
					const origin = sourceLinks.get(srcMark);
					if (origin) rebound.set(dstMark, origin);
				}
			}
		}
		const count = Math.min(src.childCount, dst.childCount);
		for (let i = 0; i < count; i += 1) {
			walk(src.child(i), dst.child(i));
		}
	};
	walk(sourceDoc, targetDoc);
	return rebound;
}

/**
 * Rebind baseline blocks to the live (structurally equal) node objects so
 * identity anchoring recognizes untouched surviving blocks. List items are
 * covered transitively: list alignment reads children of the rebound list
 * node, which are the live item objects.
 */
function rebindParsedToDoc(
	parsed: ParsedVisualDocument,
	doc: ProseMirrorNode,
): ParsedVisualDocument | null {
	if (doc === parsed.doc) return parsed;
	if (parsed.blocks.length !== doc.childCount || !doc.eq(parsed.doc)) {
		return null;
	}
	return {
		...parsed,
		doc,
		blocks: parsed.blocks.map((block, i) => ({ ...block, node: doc.child(i) })),
		...(parsed.referenceLinks && parsed.referenceLinks.size > 0
			? {
					referenceLinks: rebindReferenceLinks(
						parsed.doc,
						doc,
						parsed.referenceLinks,
					),
				}
			: {}),
	};
}

/**
 * `liveDoc` is the document actually kept alive in the editor view (for
 * example after an Undo/external reconcile that retained surviving child
 * nodes). When structurally equal to the baseline it becomes the identity
 * baseline, so later edits anchor surviving blocks by object identity.
 */
export function createPreservingRoundTripGuard(
	initialMarkdown: string,
	initialDocOrParsed: ProseMirrorNode | ParsedVisualDocument | undefined,
	serializers: MarkdownSerializers,
	liveDoc?: ProseMirrorNode,
): MarkdownRoundTripGuard {
	let parsed: ParsedVisualDocument | null = null;
	let baselineDoc: ProseMirrorNode;

	if (initialDocOrParsed && "blocks" in initialDocOrParsed) {
		parsed = initialDocOrParsed;
		baselineDoc = initialDocOrParsed.doc;
	} else {
		const computed = parseMarkdownWithBlockSources(initialMarkdown);
		baselineDoc = initialDocOrParsed ?? computed.doc;
		parsed =
			baselineDoc === computed.doc
				? computed
				: (rebindParsedToDoc(computed, baselineDoc) ??
					(baselineDoc.eq(computed.doc) ? computed : null));
	}
	if (liveDoc && liveDoc !== baselineDoc) {
		const rebound = parsed ? rebindParsedToDoc(parsed, liveDoc) : null;
		if (rebound) {
			parsed = rebound;
			baselineDoc = liveDoc;
		}
	}

	// ProseMirror nodes are immutable; caching serialized strings per node
	// avoids re-serializing untouched pasted or newly created blocks on every
	// subsequent keystroke without weakening baseline raw-slice preservation.
	const blockSerializationCache = new WeakMap<ProseMirrorNode, string>();
	const serializeBlockCached: BlockSerializer = (node, mathNewlineToken) => {
		if (mathNewlineToken !== undefined) {
			return serializers.serializeBlock(node, mathNewlineToken);
		}
		const cached = blockSerializationCache.get(node);
		if (cached !== undefined) {
			return cached;
		}
		const serialized = serializers.serializeBlock(node);
		blockSerializationCache.set(node, serialized);
		return serialized;
	};
	const cachedSerializers: MarkdownSerializers = {
		serializeBlock: serializeBlockCached,
		...(serializers.serializeBlockWithRefs
			? {
					serializeBlockWithRefs: (
						node,
						resolveReferenceLink,
						mathNewlineToken,
					) => {
						if (resolveReferenceLink === null) {
							return serializeBlockCached(node, mathNewlineToken);
						}
						return (
							serializers.serializeBlockWithRefs?.(
								node,
								resolveReferenceLink,
								mathNewlineToken,
							) ?? serializeBlockCached(node, mathNewlineToken)
						);
					},
				}
			: {}),
		serializeDoc(doc) {
			if (isEmptyDoc(doc)) {
				return "";
			}
			return joinSerializedBlocks(doc, serializeBlockCached);
		},
	};

	const isUnmodified = (doc: ProseMirrorNode): boolean =>
		doc === baselineDoc || doc.eq(baselineDoc);

	return {
		initialDoc: baselineDoc,
		initialMarkdown,
		isUnmodified,
		serialize(doc: ProseMirrorNode): string {
			if (isUnmodified(doc)) {
				return initialMarkdown;
			}
			if (parsed) {
				return serializeDocPreservingUntouchedBlocks(
					doc,
					parsed,
					cachedSerializers,
				);
			}
			return cachedSerializers.serializeDoc(doc);
		},
	};
}
