import type { SyntaxNode, Tree } from "@lezer/common";

import {
	lineStartBefore,
	hasQuoteMarkBeforeOnLine,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import {
	hasLeagueTaskMarkerPrefix,
	normalizeBoldReferenceLabel,
	stripQuoteMarksFromSlice,
} from "./editor-markdown-link-primitives";
import { computeLeagueListItemGeometry } from "./editor-markdown-league-block-rules";
import {
	isTableDelimiterLine,
	parseTableRowCells,
} from "./editor-markdown-table";
import {
	canonicalizeUnsupportedReferenceLabel,
	type ReferenceLabelCaseFoldProfile,
} from "./reference-label-normalization";

/**
 * Single Lezer Markdown tree walk for context-menu Bold: collects leaf
 * containers, code/link/autolink/quote structure, reference definitions, and
 * Lezer strong/emphasis frames, all in projected-text coordinates (callers
 * convert to original offsets once, when materializing strong spans).
 */

/**
 * League list-opener padding facts for a `ListItem` whose opener line hosts
 * the start of a leaf container. Editing that line's remainder across the
 * single-codepoint threshold changes League's effective `ListItem` padding
 * (`ListBlockStartParser::calculateListMarkerPadding()`), which re-indents
 * every following line of the item.
 */
export type ListOpenerPaddingGuard = Readonly<{
	colAfterMark: number;
	contentCol: number;
	lineEnd: number;
	markTo: number;
}>;

/** Authoritative document-level host facts for one leaf container. */
export type ContainerHostInfo = Readonly<{
	blockContextPrefix?: string;
	hasExternalTaskMarker: boolean;
	isListItemParagraph?: boolean;
	isNonParagraphHost: boolean;
	listOpenerGuards?: ReadonlyArray<ListOpenerPaddingGuard>;
}>;

export type SourceNestedInlineSpan = Readonly<{
	closeFrom: number;
	from: number;
	kind: "emphasis" | "link" | "strikethrough";
	openTo: number;
	to: number;
}>;
/** A `SourceNestedInlineSpan` still in projected-text coordinates. */
export type ProjectedNestedInlineSpan = SourceNestedInlineSpan;
/** Delimited emphasis bounds in projected coordinates; `null` marks are unresolved. */
export type ProjectedEmphasisFrame = Readonly<{
	closeFrom: number | null;
	from: number;
	openTo: number | null;
	to: number;
}>;

type LeafKind = "atx" | "paragraph" | "setext" | "table-row" | "task";
export type LeafContainer = Readonly<{
	blockContextPrefix?: string;
	from: number;
	/** Projected-coordinate list-opener padding guards (see `ListOpenerPaddingGuard`). */
	listOpenerGuards?: ReadonlyArray<ListOpenerPaddingGuard>;
	inlineFrom: number;
	inTable: boolean;
	isListItemParagraph: boolean;
	isNonParagraphHost: boolean;
	/** Plain paragraph nested only inside `Blockquote` containers. */
	isQuoteOnlyParagraph: boolean;
	sliceFrom: number;
	sliceTo: number;
	taskMarkerLength: number;
	to: number;
}>;
type MutableLeafFrame = {
	closingMarkFrom: number | null;
	from: number;
	isListItemParagraph: boolean;
	isNonParagraphHost: boolean;
	isQuoteOnlyParagraph: boolean;
	kind: LeafKind;
	openingMarkTo: number | null;
	setextMarkFrom: number | null;
	to: number;
};
type MutableNestedInlineFrame = {
	closeFrom: number | null;
	from: number;
	kind: "emphasis" | "strikethrough";
	openTo: number | null;
	to: number;
};
type MutableOuterEmphasisFrame = {
	closeFrom: number | null;
	from: number;
	openTo: number | null;
	to: number;
};
type MutableStrongFrame = {
	from: number;
	marks: SourceRange[];
	nestedInlineSpans: ProjectedNestedInlineSpan[];
	outerEmphases: MutableOuterEmphasisFrame[];
	to: number;
};
export type ProjectedStrongSpan = Readonly<{
	closeMark: string;
	from: number;
	innerFrom: number;
	innerTo: number;
	nestedInlineSpans: ReadonlyArray<ProjectedNestedInlineSpan>;
	openMark: string;
	outerEmphases: ReadonlyArray<ProjectedEmphasisFrame>;
	to: number;
}>;
export type RawLinkReferenceRecord = Readonly<{
	fold17Key: string | null;
	from: number;
	isNonAscii: boolean;
	key: string;
	to: number;
}>;
const EXCLUDED_BLOCK_NODES: ReadonlySet<string> = new Set([
	"CodeBlock",
	"CommentBlock",
	"FencedCode",
	"HorizontalRule",
	"HTMLBlock",
	"LinkReference",
	"ProcessingInstructionBlock",
]);
const LEAF_KIND_BY_NODE: Readonly<Record<string, LeafKind>> = {
	ATXHeading1: "atx",
	ATXHeading2: "atx",
	ATXHeading3: "atx",
	ATXHeading4: "atx",
	ATXHeading5: "atx",
	ATXHeading6: "atx",
	Paragraph: "paragraph",
	SetextHeading1: "setext",
	SetextHeading2: "setext",
	TableHeader: "table-row",
	TableRow: "table-row",
	Task: "task",
};
/**
 * Synthetic list opener with League content indent `contentIndent` (2..17):
 * `-` + spaces up to 5 columns, `1000. `..`100000000.    ` up to 14, then
 * `1..3` marker-offset spaces. Every opener has a multi-character remainder.
 */
function buildSyntheticListOpener(contentIndent: number): string {
	const cols = Math.min(17, Math.max(2, contentIndent));
	if (cols <= 5) return `-${" ".repeat(cols - 1)}`;
	const markerOffset = Math.max(0, cols - 14);
	const remaining = cols - markerOffset;
	const digits = Math.min(9, remaining - 2);
	const spaces = remaining - digits - 1;
	return `${" ".repeat(markerOffset)}1${"0".repeat(digits - 1)}.${" ".repeat(spaces)}`;
}

/**
 * Builds the minimal enclosing `ListItem` / `Blockquote` prefix needed so
 * `verifySliceEdit` parses a leaf slice with exact enclosing indentation
 * context in `O(leafLength)` time. Each earlier-line `ListItem` ancestor is
 * emitted on its OWN blank-separated line under the accumulated outer
 * container prefix, so outer padding never merges with an inner opener into
 * an `IndentedCode` run.
 */
function buildListBlockContextPrefix(
	text: string,
	leafNode: SyntaxNode,
	resolvedSliceFrom: number,
): string | undefined {
	const ancestors: SyntaxNode[] = [];
	let hasListItem = false;
	for (
		let parent = leafNode.parent;
		null !== parent && "Document" !== parent.name;
		parent = parent.parent
	) {
		if ("ListItem" === parent.name) {
			hasListItem = true;
			ancestors.push(parent);
		} else if ("Blockquote" === parent.name) {
			ancestors.push(parent);
		}
	}
	if (!hasListItem) return undefined;
	ancestors.reverse();
	const leafLineStart = lineStartBefore(text, leafNode.from);
	const sameLinePrefix =
		resolvedSliceFrom > leafLineStart
			? text.slice(leafLineStart, resolvedSliceFrom)
			: "";
	let lastEarlierListIdx = -1;
	for (let i = 0; i < ancestors.length; i += 1) {
		const anc = ancestors[i];
		if (
			anc &&
			"ListItem" === anc.name &&
			lineStartBefore(text, anc.from) < leafLineStart
		) {
			lastEarlierListIdx = i;
		}
	}
	if (lastEarlierListIdx < 0) {
		return sameLinePrefix.length > 0 ? sameLinePrefix : undefined;
	}
	let prefix = "";
	let linePrefix = "";
	const indents: number[] = [];
	for (let i = 0; i <= lastEarlierListIdx; i += 1) {
		const anc = ancestors[i];
		if (!anc) continue;
		if ("Blockquote" === anc.name) {
			indents.push(0);
			linePrefix += "> ";
			continue;
		}
		const geometry = computeLeagueListItemGeometry(text, anc);
		const indent = geometry
			? Math.max(
					2,
					geometry.contentCol -
						computeAncestorBaseColumn(text, geometry.lineStart, ancestors, indents),
				)
			: 2;
		indents.push(indent);
		prefix += `${linePrefix}${buildSyntheticListOpener(indent)}xx\n${linePrefix.trimEnd()}\n`;
		linePrefix += " ".repeat(indent);
	}
	return `${prefix}${sameLinePrefix}`;
}

/**
 * Absolute League column at which the container content of `ancestors[n]`
 * (`n = indents.length`) starts on the line at `lineStart`, derived purely
 * from the enclosing chain `ancestors[0..n-1]`: every `ListItem` consumes its
 * League content indent (`indents[k]`), and every `Blockquote` consumes
 * `0..3` columns of indentation, `>`, and ONE optional column of space or
 * partial tab. Never trusts `item.from`, which `@lezer/markdown`
 * `Line.findColumn()` advances past a tab straddling the base column.
 */
function computeAncestorBaseColumn(
	text: string,
	lineStart: number,
	ancestors: ReadonlyArray<SyntaxNode>,
	indents: ReadonlyArray<number>,
): number {
	let col = 0;
	let pos = lineStart;
	let charCol = 0;
	for (let k = 0; k < indents.length; k += 1) {
		if ("Blockquote" !== ancestors[k]?.name) {
			col += indents[k] ?? 0;
			continue;
		}
		// Skip characters wholly consumed by enclosing containers, then the
		// `0..3` indentation columns (including any partial-tab remainder).
		for (; pos < text.length; pos += 1) {
			const code = text.charCodeAt(pos);
			if (10 === code || 13 === code) break;
			const width = 9 === code ? 4 - (charCol % 4) : 1;
			if (charCol + width > col && 32 !== code && 9 !== code) break;
			charCol += width;
		}
		if (62 !== text.charCodeAt(pos)) return col;
		pos += 1;
		charCol += 1;
		col = charCol;
		const next = text.charCodeAt(pos);
		if (32 === next) {
			pos += 1;
			charCol += 1;
			col += 1;
		} else if (9 === next) {
			col += 1;
		}
	}
	return col;
}

/**
 * Collects padding guards for every `ListItem` ancestor whose opener line is
 * the leaf's first line, when any non-blank document content follows that
 * line (`lastNonBlankOffset`; single-line `-  a` documents cannot be
 * re-indented).
 */
function collectListOpenerGuards(
	text: string,
	leafNode: SyntaxNode,
	lastNonBlankOffset: number,
): ReadonlyArray<ListOpenerPaddingGuard> | undefined {
	const leafLineStart = lineStartBefore(text, leafNode.from);
	const guards: ListOpenerPaddingGuard[] = [];
	for (
		let parent = leafNode.parent;
		null !== parent && "Document" !== parent.name;
		parent = parent.parent
	) {
		if ("ListItem" !== parent.name) continue;
		// Outer ancestors never start after an inner one: stop at earlier lines.
		if (lineStartBefore(text, parent.from) < leafLineStart) break;
		const geometry = computeLeagueListItemGeometry(text, parent);
		if (!geometry) continue;
		if (geometry.lineEnd >= lastNonBlankOffset) break;
		guards.push({
			colAfterMark: geometry.colAfterMark,
			contentCol: geometry.contentCol,
			lineEnd: geometry.lineEnd,
			markTo: geometry.markTo,
		});
	}
	return guards.length > 0 ? guards : undefined;
}

/** Offset of the last non-blank (space/tab/CR/LF) character, or `-1`. */
function findLastNonBlankOffset(text: string): number {
	let i = text.length - 1;
	for (; i >= 0; i -= 1) {
		const code = text.charCodeAt(i);
		if (32 !== code && 9 !== code && 10 !== code && 13 !== code) break;
	}
	return i;
}

function pushCompletedLeafContainer(
	text: string,
	leaf: MutableLeafFrame,
	leafNode: SyntaxNode,
	quoteMarks: ReadonlyArray<SourceRange>,
	containers: LeafContainer[],
	lastNonBlankOffset: number,
): void {
	if ("table-row" === leaf.kind) {
		const rowText = text.slice(leaf.from, leaf.to);
		if (isTableDelimiterLine(rowText)) return;
		const cells = parseTableRowCells(rowText);
		if (!cells) {
			containers.push({
				from: leaf.from,
				inlineFrom: leaf.from,
				inTable: true,
				isListItemParagraph: false,
				isNonParagraphHost: true,
				isQuoteOnlyParagraph: false,
				sliceFrom: leaf.from,
				sliceTo: leaf.to,
				taskMarkerLength: 0,
				to: leaf.to,
			});
			return;
		}
		for (const cell of cells) {
			const from = leaf.from + cell.start;
			const to = leaf.from + cell.end;
			if (from < to) {
				containers.push({
					from,
					inlineFrom: from,
					inTable: true,
					isListItemParagraph: false,
					isNonParagraphHost: true,
					isQuoteOnlyParagraph: false,
					sliceFrom: from,
					sliceTo: to,
					taskMarkerLength: 0,
					to,
				});
			}
		}
		return;
	}
	const listOpenerGuards = collectListOpenerGuards(text, leafNode, lastNonBlankOffset);
	const guardFields = listOpenerGuards ? { listOpenerGuards } : {};
	const resolvePrefix = (sliceFrom: number): string | undefined => {
		const resolvedFrom = hasQuoteMarkBeforeOnLine(text, sliceFrom, quoteMarks)
			? lineStartBefore(text, sliceFrom)
			: sliceFrom;
		return buildListBlockContextPrefix(text, leafNode, resolvedFrom);
	};
	if ("atx" === leaf.kind) {
		const from = leaf.openingMarkTo ?? leaf.from;
		const to = leaf.closingMarkFrom ?? leaf.to;
		if (from < to) {
			const sliceFrom = lineStartBefore(text, leaf.from);
			const blockContextPrefix = resolvePrefix(sliceFrom);
			containers.push({
				...(blockContextPrefix ? { blockContextPrefix } : {}),
				...guardFields,
				from,
				inlineFrom: from,
				inTable: false,
				isListItemParagraph: false,
				isNonParagraphHost: true,
				isQuoteOnlyParagraph: false,
				sliceFrom,
				sliceTo: leaf.to,
				taskMarkerLength: 0,
				to,
			});
		}
		return;
	}
	if ("task" === leaf.kind) {
		const from = leaf.openingMarkTo ?? leaf.from;
		if (from < leaf.to) {
			const taskMarkerLength = from > leaf.from ? from - leaf.from : 0;
			const sliceFrom = lineStartBefore(text, leaf.from);
			const blockContextPrefix = resolvePrefix(sliceFrom);
			containers.push({
				...(blockContextPrefix ? { blockContextPrefix } : {}),
				...guardFields,
				from,
				inlineFrom: leaf.from,
				inTable: false,
				isListItemParagraph: false,
				isNonParagraphHost: true,
				isQuoteOnlyParagraph: false,
				sliceFrom,
				sliceTo: leaf.to,
				taskMarkerLength,
				to: leaf.to,
			});
		}
		return;
	}
	const taskMarkerLength =
		"paragraph" === leaf.kind && null !== leaf.openingMarkTo
			? leaf.openingMarkTo - leaf.from
			: 0;
	const from =
		"paragraph" === leaf.kind ? (leaf.openingMarkTo ?? leaf.from) : leaf.from;
	const to =
		"setext" === leaf.kind && null !== leaf.setextMarkFrom
			? Math.max(from, lineStartBefore(text, leaf.setextMarkFrom) - 1)
			: leaf.to;
	if (from < to) {
		const sliceFrom =
			taskMarkerLength > 0 ? lineStartBefore(text, leaf.from) : from;
		const blockContextPrefix = resolvePrefix(sliceFrom);
		containers.push({
			...(blockContextPrefix ? { blockContextPrefix } : {}),
			...guardFields,
			from,
			inlineFrom: taskMarkerLength > 0 ? leaf.from : from,
			inTable: false,
			isListItemParagraph: leaf.isListItemParagraph,
			isNonParagraphHost: leaf.isNonParagraphHost,
			isQuoteOnlyParagraph: leaf.isQuoteOnlyParagraph,
			sliceFrom,
			sliceTo: to,
			taskMarkerLength,
			to,
		});
	}
}

function hasOnlyBlockquoteAncestors(node: SyntaxNode): boolean {
	let parent = node.parent;
	if ("Blockquote" !== parent?.name) return false;
	while (parent && "Document" !== parent.name) {
		if ("Blockquote" !== parent.name) return false;
		parent = parent.parent;
	}
	return true;
}

export function resolveContainerSliceRange(
	text: string,
	container: LeafContainer,
	quoteMarks: ReadonlyArray<SourceRange>,
): SourceRange {
	const sliceFrom =
		!container.inTable &&
		hasQuoteMarkBeforeOnLine(text, container.sliceFrom, quoteMarks)
			? lineStartBefore(text, container.sliceFrom)
			: container.sliceFrom;
	return { from: sliceFrom, to: container.sliceTo };
}

export function collectBoldAstData(
	text: string,
	tree: Tree,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile,
) {
	const codeBlockRanges: SourceRange[] = [];
	const inlineCodeRanges: SourceRange[] = [];
	const angleAutolinkRanges: SourceRange[] = [];
	const lezerUrlRanges: SourceRange[] = [];
	const rawLinkReferences: RawLinkReferenceRecord[] = [];
	const hardBreaks: SourceRange[] = [];
	const quoteMarks: SourceRange[] = [];
	const leafContainers: LeafContainer[] = [];
	const projectedStrongSpans: ProjectedStrongSpan[] = [];
	const leafStack: MutableLeafFrame[] = [];
	const strongStack: MutableStrongFrame[] = [];
	const nestedStack: MutableNestedInlineFrame[] = [];
	const outerEmphasisStack: MutableOuterEmphasisFrame[] = [];
	let autolinkDepth = 0;
	const lastNonBlankOffset = findLastNonBlankOffset(text);

	tree.iterate({
		enter: (node): boolean | undefined => {
			const { from, name, to } = node;
			if (EXCLUDED_BLOCK_NODES.has(name)) {
				if ("FencedCode" === name || "CodeBlock" === name) codeBlockRanges.push({ from, to });
				if ("LinkReference" === name) {
					const labelNode = node.node.getChild("LinkLabel");
					if (labelNode && null !== node.node.getChild("URL")) {
						const stripped = stripQuoteMarksFromSlice(
							text,
							labelNode.from + 1,
							labelNode.to - 1,
							labelNode,
						);
						if ("unsupported" === referenceLabelCaseFoldProfile) {
							const canonical = canonicalizeUnsupportedReferenceLabel(stripped);
							if (canonical) {
								rawLinkReferences.push({
									fold17Key: normalizeBoldReferenceLabel(stripped, 17),
									from,
									isNonAscii: canonical.hasNonAscii,
									key: canonical.key,
									to,
								});
							}
						} else {
							const key = normalizeBoldReferenceLabel(
								stripped,
								referenceLabelCaseFoldProfile,
							);
							if (null !== key) {
								rawLinkReferences.push({
									fold17Key: null,
									from,
									isNonAscii: false,
									key,
									to,
								});
							}
						}
					}
				}
				return false;
			}
			if ("TableDelimiter" === name) return false;
			if ("InlineCode" === name) {
				inlineCodeRanges.push({ from, to });
				return undefined;
			}
			if ("Autolink" === name) {
				autolinkDepth += 1;
				angleAutolinkRanges.push({ from, to });
				return undefined;
			}
			if ("URL" === name) {
				if (0 === autolinkDepth) lezerUrlRanges.push({ from, to });
				return undefined;
			}
			if ("HardBreak" === name) {
				hardBreaks.push({ from, to });
				return undefined;
			}
			if ("QuoteMark" === name) {
				quoteMarks.push({ from, to });
				return undefined;
			}
			if ("StrongEmphasis" === name) {
				strongStack.push({
					from,
					marks: [],
					nestedInlineSpans: [],
					outerEmphases: [...outerEmphasisStack],
					to,
				});
				return undefined;
			}
			if ("Emphasis" === name) {
				if (strongStack.length > 0) {
					nestedStack.push({ closeFrom: null, from, kind: "emphasis", openTo: null, to });
				} else {
					outerEmphasisStack.push({ closeFrom: null, from, openTo: null, to });
				}
				return undefined;
			}
			if (strongStack.length > 0 && "Strikethrough" === name) {
				nestedStack.push({ closeFrom: null, from, kind: "strikethrough", openTo: null, to });
				return undefined;
			}
			if ("EmphasisMark" === name) {
				const topOuter = outerEmphasisStack[outerEmphasisStack.length - 1];
				if (topOuter) {
					if (null === topOuter.openTo && from === topOuter.from) {
						topOuter.openTo = to;
					} else if (to === topOuter.to) {
						topOuter.closeFrom = from;
					}
				}
				const topNested = nestedStack[nestedStack.length - 1];
				if (topNested && "emphasis" === topNested.kind) {
					if (null === topNested.openTo && from === topNested.from) {
						topNested.openTo = to;
					} else if (to === topNested.to) {
						topNested.closeFrom = from;
					}
				}
				const top = strongStack[strongStack.length - 1];
				if (top && (from === top.from || to === top.to)) {
					top.marks.push({ from, to });
				}
				return undefined;
			}
			if ("StrikethroughMark" === name) {
				const topNested = nestedStack[nestedStack.length - 1];
				if (topNested && "strikethrough" === topNested.kind) {
					if (null === topNested.openTo && from === topNested.from) {
						topNested.openTo = to;
					} else if (to === topNested.to) {
						topNested.closeFrom = from;
					}
				}
				return undefined;
			}
			const currentLeaf = leafStack[leafStack.length - 1];
			if (currentLeaf) {
				if ("HeaderMark" === name) {
					if ("atx" === currentLeaf.kind) {
						if (null === currentLeaf.openingMarkTo && from === currentLeaf.from) {
							currentLeaf.openingMarkTo = to;
						} else if (to === currentLeaf.to) {
							currentLeaf.closingMarkFrom = from;
						}
					} else if ("setext" === currentLeaf.kind) {
						currentLeaf.setextMarkFrom = from;
					}
					return undefined;
				}
				if ("TaskMarker" === name && "task" === currentLeaf.kind) {
					currentLeaf.openingMarkTo ??= to;
					return undefined;
				}
			}
			const leafKind = LEAF_KIND_BY_NODE[name];
			if (leafKind) {
				const parentName = node.node.parent?.name;
				const openingMarkTo =
					"paragraph" === leafKind &&
					"ListItem" === parentName &&
					hasLeagueTaskMarkerPrefix(text, from, to)
						? from + 3
						: null;
				leafStack.push({
					closingMarkFrom: null,
					from,
					isListItemParagraph: "paragraph" === leafKind && "ListItem" === parentName,
					isNonParagraphHost: "paragraph" !== leafKind || "Document" !== parentName,
					isQuoteOnlyParagraph:
						"paragraph" === leafKind && null === openingMarkTo && hasOnlyBlockquoteAncestors(node.node),
					kind: leafKind,
					openingMarkTo,
					setextMarkFrom: null,
					to,
				});
			}
			return undefined;
		},
		leave: (node) => {
			const { name } = node;
			if ("Autolink" === name) {
				autolinkDepth = Math.max(0, autolinkDepth - 1);
				return;
			}
			const topOuter = outerEmphasisStack[outerEmphasisStack.length - 1];
			if (
				topOuter &&
				"Emphasis" === name &&
				topOuter.from === node.from &&
				topOuter.to === node.to
			) {
				outerEmphasisStack.pop();
				return;
			}
			const topNested = nestedStack[nestedStack.length - 1];
			if (
				topNested &&
				topNested.from === node.from &&
				topNested.to === node.to &&
				(("Emphasis" === name && "emphasis" === topNested.kind) ||
					("Strikethrough" === name && "strikethrough" === topNested.kind))
			) {
				nestedStack.pop();
				const outerStrong = strongStack[0];
				if (
					outerStrong &&
					null !== topNested.openTo &&
					null !== topNested.closeFrom &&
					topNested.openTo <= topNested.closeFrom
				) {
					outerStrong.nestedInlineSpans.push({
						closeFrom: topNested.closeFrom,
						from: topNested.from,
						kind: topNested.kind,
						openTo: topNested.openTo,
						to: topNested.to,
					});
				}
				return;
			}
			if ("StrongEmphasis" === name) {
				const frame = strongStack.pop();
				if (!frame || frame.marks.length < 2) return;
				const open = frame.marks[0];
				const close = frame.marks[frame.marks.length - 1];
				if (!open || !close || open.to >= close.from) return;
				projectedStrongSpans.push({
					closeMark: text.slice(close.from, close.to),
					from: frame.from,
					innerFrom: open.to,
					innerTo: close.from,
					nestedInlineSpans: frame.nestedInlineSpans,
					openMark: text.slice(open.from, open.to),
					outerEmphases: frame.outerEmphases,
					to: frame.to,
				});
				return;
			}
			const topLeaf = leafStack[leafStack.length - 1];
			if (
				topLeaf &&
				LEAF_KIND_BY_NODE[name] &&
				topLeaf.from === node.from &&
				topLeaf.to === node.to
			) {
				leafStack.pop();
				pushCompletedLeafContainer(
					text,
					topLeaf,
					node.node,
					quoteMarks,
					leafContainers,
					lastNonBlankOffset,
				);
			}
		},
	});

	return {
		angleAutolinkRanges, codeBlockRanges, hardBreaks, inlineCodeRanges,
		leafContainers, lezerUrlRanges, projectedStrongSpans, quoteMarks, rawLinkReferences,
	};
}
