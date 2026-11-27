import type {
	EditorMarkdownImageRange,
	EditorMarkdownLinkCandidate,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	originalRange,
	type NewlineProjection,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import {
	normalizeMarkdownReferenceLabel,
	type ReferenceLabelCaseFoldProfile,
} from "./reference-label-normalization";

export type MarkdownSyntaxNode = Readonly<{
	from: number;
	name: string;
	to: number;
}>;

export type ParserLinkNode = Readonly<{
	from: number;
	kind: "autolink" | "link";
	reference: boolean;
	to: number;
}>;

const LINK_BLOCKED_ANCESTORS: Readonly<Record<string, true>> = {
	CodeBlock: true,
	FencedCode: true,
	Image: true,
	InlineCode: true,
};

const LINK_BLOCKED_INLINE_ANCESTORS: Readonly<Record<string, true>> = {
	Autolink: true,
	CodeBlock: true,
	FencedCode: true,
	Image: true,
	InlineCode: true,
	LinkReference: true,
};

const URL_NODE_NAME_BIT = 1;
const LINK_TITLE_NODE_NAME_BIT = 2;
const BLOCKED_ANCESTOR_BIT = 1;
const BLOCKED_INLINE_ANCESTOR_BIT = 2;

function bracketLabelContent(value: string): string {
	return value.startsWith("[") && value.endsWith("]")
		? value.slice(1, -1)
		: value;
}

function directChildIndex(
	children: ReadonlyArray<ReadonlyArray<number> | undefined>,
	nodes: ReadonlyArray<Readonly<{ name: string }>>,
	parentIndex: number,
	name: string,
): number | null {
	const childList = children[parentIndex];
	if (!childList) return null;
	for (const childIndex of childList) {
		if (name === nodes[childIndex]?.name) return childIndex;
	}
	return null;
}

function markdownSyntaxStructure(
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
) {
	const blockedAncestorMask = new Uint8Array(nodes.length);
	const children: Array<number[] | undefined> = new Array(nodes.length);
	const urlDescendants = new Uint8Array(nodes.length);
	const namesAt = new Map<number, number>();
	const open: number[] = [];
	let blockedDepth = 0;
	let blockedInlineDepth = 0;
	const popOpen = (): void => {
		const closedIndex = open.pop();
		if (undefined === closedIndex) return;
		const closedName = nodes[closedIndex]?.name ?? "";
		if (LINK_BLOCKED_ANCESTORS[closedName]) blockedDepth -= 1;
		if (LINK_BLOCKED_INLINE_ANCESTORS[closedName]) blockedInlineDepth -= 1;
		const parentIndex = open[open.length - 1];
		if (
			undefined !== parentIndex &&
			(1 === urlDescendants[closedIndex] || "URL" === closedName)
		) {
			urlDescendants[parentIndex] = 1;
		}
	};
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		while (open.length > 0) {
			const parentIndex = open[open.length - 1] ?? -1;
			const parent = nodes[parentIndex];
			if (parent && parent.from <= node.from && node.to <= parent.to) break;
			popOpen();
		}
		const parentIndex = open[open.length - 1];
		if (undefined !== parentIndex) {
			const parentName = nodes[parentIndex]?.name;
			if ("Link" === parentName || "LinkReference" === parentName) {
				let list = children[parentIndex];
				if (!list) {
					list = [];
					children[parentIndex] = list;
				}
				list.push(index);
			}
		}
		blockedAncestorMask[index] =
			(blockedDepth > 0 ? BLOCKED_ANCESTOR_BIT : 0) |
			(blockedInlineDepth > 0 ? BLOCKED_INLINE_ANCESTOR_BIT : 0);
		if ("URL" === node.name) {
			namesAt.set(node.from, (namesAt.get(node.from) ?? 0) | URL_NODE_NAME_BIT);
		} else if ("LinkTitle" === node.name) {
			namesAt.set(
				node.from,
				(namesAt.get(node.from) ?? 0) | LINK_TITLE_NODE_NAME_BIT,
			);
		}
		if (LINK_BLOCKED_ANCESTORS[node.name]) blockedDepth += 1;
		if (LINK_BLOCKED_INLINE_ANCESTORS[node.name]) blockedInlineDepth += 1;
		open.push(index);
	}
	while (open.length > 0) popOpen();
	return { blockedAncestorMask, children, namesAt, urlDescendants };
}

function referenceLabelsFromStructure(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	structure: ReturnType<typeof markdownSyntaxStructure>,
	profile: ReferenceLabelCaseFoldProfile,
): Set<string> {
	const { blockedAncestorMask, children } = structure;
	const definedLabels = new Set<string>();
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if ("LinkReference" !== node?.name) continue;
		if (0 !== ((blockedAncestorMask[index] ?? 0) & BLOCKED_ANCESTOR_BIT))
			continue;
		const labelIndex = directChildIndex(children, nodes, index, "LinkLabel");
		const label = nodes[labelIndex ?? -1];
		if (label) {
			definedLabels.add(
				normalizeMarkdownReferenceLabel(
					bracketLabelContent(text.slice(label.from, label.to)),
					profile,
				),
			);
		}
	}
	return definedLabels;
}

/** Collect labels from the caller's existing parser tree. */
export function markdownReferenceLabels(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): ReadonlySet<string> {
	return referenceLabelsFromStructure(text, nodes, markdownSyntaxStructure(nodes), profile);
}

export type MarkdownReferenceDefinition = Readonly<{
	destination: string;
	title: string | null;
}>;

function referenceDefinitionQueryFromStructure(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	structure: ReturnType<typeof markdownSyntaxStructure>,
	profile: ReferenceLabelCaseFoldProfile,
): (label: string) => MarkdownReferenceDefinition | null {
	let definitions: Map<string, MarkdownReferenceDefinition> | null = null;
	return (label) => {
		if (!definitions) {
			const collected = new Map<string, MarkdownReferenceDefinition>();
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index];
				if (
					"LinkReference" !== node?.name ||
					0 !== ((structure.blockedAncestorMask[index] ?? 0) & BLOCKED_ANCESTOR_BIT)
				) {
					continue;
				}
				const labelNode =
					nodes[directChildIndex(structure.children, nodes, index, "LinkLabel") ?? -1];
				const url =
					nodes[directChildIndex(structure.children, nodes, index, "URL") ?? -1];
				const title =
					nodes[directChildIndex(structure.children, nodes, index, "LinkTitle") ?? -1];
				if (!labelNode || !url) {
					throw new Error("visual-editor-reference-definition-map-failed");
				}
				const key = normalizeMarkdownReferenceLabel(
					bracketLabelContent(text.slice(labelNode.from, labelNode.to)),
					profile,
				);
				if (!collected.has(key)) {
					collected.set(key, {
						destination: text.slice(url.from, url.to),
						title: title ? text.slice(title.from, title.to) : null,
					});
				}
			}
			definitions = collected;
		}
		if (0 === definitions.size) return null;
		const normalized = normalizeMarkdownReferenceLabel(label, profile);
		return definitions.get(normalized) ?? null;
	};
}

/** First active parser-owned definition, retaining its exact source tokens. */
export function markdownReferenceDefinitionQuery(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): (label: string) => MarkdownReferenceDefinition | null {
	return referenceDefinitionQueryFromStructure(
		text,
		nodes,
		markdownSyntaxStructure(nodes),
		profile,
	);
}

/** Bind each queried reference to the definition used by the formal Preview. */
export function markdownReferenceContextQuery(
	current: string,
	currentNodes: ReadonlyArray<MarkdownSyntaxNode>,
	formal: string,
	formalNodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): (label: string) => boolean {
	const currentDefinition = markdownReferenceDefinitionQuery(current, currentNodes, profile);
	const formalDefinition = markdownReferenceDefinitionQuery(formal, formalNodes, profile);
	return (label) => {
		const currentValue = currentDefinition(label);
		const formalValue = formalDefinition(label);
		if (!currentValue && !formalValue) return false;
		if (!currentValue || !formalValue || currentValue.destination !== formalValue.destination
			|| currentValue.title !== formalValue.title) {
			throw new Error("visual-editor-reference-context-stale");
		}
		return true;
	};
}

/**
 * Checks parser-owned direct children of an inline `Link` node (`LinkMark "]"`,
 * `LinkMark "("`, `URL`, optional `LinkTitle`, `LinkMark ")"`), handling
 * multiline blockquote destinations (`> [label](\n> https://example.org)`)
 * without misattributing bare URLs inside the link text to an empty `()` tail.
 */
function hasOwnInlineDestinationUrl(
	text: string,
	children: ReadonlyArray<ReadonlyArray<number> | undefined>,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	linkIndex: number,
): boolean {
	const childList = children[linkIndex];
	if (!childList || childList.length < 4) return false;
	let cursor = childList.length - 1;
	const closeParen = nodes[childList[cursor] ?? -1];
	if (
		"LinkMark" !== closeParen?.name ||
		")" !== text[closeParen.from] ||
		closeParen.to !== closeParen.from + 1
	) {
		return false;
	}
	cursor -= 1;
	if ("LinkTitle" === nodes[childList[cursor] ?? -1]?.name) {
		cursor -= 1;
	}
	const urlNode = nodes[childList[cursor] ?? -1];
	if ("URL" !== urlNode?.name) return false;
	cursor -= 1;
	const openParen = nodes[childList[cursor] ?? -1];
	const closeBracket = nodes[childList[cursor - 1] ?? -1];
	return (
		"LinkMark" === openParen?.name &&
		"(" === text[openParen.from] &&
		openParen.to === openParen.from + 1 &&
		"LinkMark" === closeBracket?.name &&
		"]" === text[closeBracket.from] &&
		closeBracket.to === openParen.from
	);
}

export type ProjectedLinkNodesInspection = Readonly<{
	isReferenceDefined: (rawLabel: string) => boolean;
	links: ReadonlyArray<ParserLinkNode>;
	needsReferenceAwareReparse: boolean;
}>;

/**
 * Derives links that the formal CommonMark renderer creates from the caller's
 * existing parser tree, also reporting whether any uncreated `Link` frame
 * consumed a trailing `LinkLabel` or was revoked by a resolved inner `Link`
 * so callers can re-parse with exact reference knowledge without letting a
 * non-link outer bracket pair swallow trailing `[b]` or `[b](url)` syntax.
 */
export function inspectProjectedLinkNodes(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): ProjectedLinkNodesInspection {
	const structure = markdownSyntaxStructure(nodes);
	const { blockedAncestorMask, children, namesAt, urlDescendants } = structure;
	let definition: ReturnType<typeof referenceDefinitionQueryFromStructure> | null = null;
	const created = new Uint8Array(nodes.length);
	const referenceLinks = new Uint8Array(nodes.length);
	const frameIndices: number[] = [];
	const frameHasCreatedChild: number[] = [];
	let needsReferenceAwareReparse = false;
	const closeFrame = (): void => {
		const frameIndex = frameIndices.pop();
		const hasCreatedChild = frameHasCreatedChild.pop() ?? 0;
		if (undefined === frameIndex) return;
		const frameNode = nodes[frameIndex];
		if ("Link" === frameNode?.name) {
			if (0 !== hasCreatedChild) {
				created[frameIndex] = 0;
				needsReferenceAwareReparse = true;
			} else if (
				0 === created[frameIndex] &&
				null !== directChildIndex(children, nodes, frameIndex, "LinkLabel")
			) {
				needsReferenceAwareReparse = true;
			}
		}
		const propagated = 0 !== hasCreatedChild || 0 !== created[frameIndex];
		const parentTop = frameHasCreatedChild.length - 1;
		if (parentTop >= 0 && propagated) frameHasCreatedChild[parentTop] = 1;
	};
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		while (frameIndices.length > 0) {
			const frameIndex = frameIndices[frameIndices.length - 1] ?? -1;
			const frameNode = nodes[frameIndex];
			if (frameNode && frameNode.from <= node.from && node.to <= frameNode.to)
				break;
			closeFrame();
		}
		if ("Link" === node.name) {
			const hasOwnInlineUrl =
				"[" === text[node.from] &&
				")" === text[node.to - 1] &&
				hasOwnInlineDestinationUrl(text, children, nodes, index);
			const hasUrl = 1 === urlDescendants[index];
			if (hasOwnInlineUrl) {
				created[index] = 1;
			} else if (
				!(
					"[" === text[node.from] &&
					")" === text[node.to - 1] &&
					!hasOwnInlineUrl
				) &&
				(hasUrl || "[^" !== text.slice(node.from, node.from + 2))
			) {
				const labelIndex = directChildIndex(
					children,
					nodes,
					index,
					"LinkLabel",
				);
				const malformed =
					null === labelIndex &&
					(0 !== (namesAt.get(node.to) ?? 0) ||
						"(" === text[node.to] ||
						"[" === text[node.to]);
				if (!malformed) {
					const label = nodes[labelIndex ?? -1];
					const labelText = label
						? text.slice(label.from + 1, label.to - 1)
						: "";
					const rawLabel =
						0 < labelText.length
							? labelText
							: text.slice(node.from + 1, (label?.from ?? node.to) - 1);
					definition ??= referenceDefinitionQueryFromStructure(
						text,
						nodes,
						structure,
						profile,
					);
					if (definition(rawLabel)) {
						created[index] = 1;
						referenceLinks[index] = 1;
					}
				}
			}
		}
		frameIndices.push(index);
		frameHasCreatedChild.push(0);
	}
	while (frameIndices.length > 0) closeFrame();
	const projected: ParserLinkNode[] = [];
	let activeCreatedLinkTo = -1;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		const ancestorMask = blockedAncestorMask[index] ?? 0;
		if (0 !== (ancestorMask & BLOCKED_ANCESTOR_BIT)) continue;
		const hasUrl = 1 === urlDescendants[index];
		if ("Link" === node.name) {
			if (0 === created[index]) continue;
			if (node.to > activeCreatedLinkTo) activeCreatedLinkTo = node.to;
			projected.push({
				from: node.from,
				kind: "link",
				reference: 0 !== referenceLinks[index],
				to: node.to,
			});
			continue;
		}
		if (node.from < activeCreatedLinkTo && node.to <= activeCreatedLinkTo) {
			continue;
		}
		if ("Autolink" === node.name) {
			if (0 !== (ancestorMask & BLOCKED_INLINE_ANCESTOR_BIT)) continue;
			if ("<" === text[node.from] && ">" === text[node.to - 1] && hasUrl) {
				projected.push({
					from: node.from,
					kind: "autolink",
					reference: false,
					to: node.to,
				});
			}
			continue;
		}
		if ("URL" === node.name) {
			if (0 !== (ancestorMask & BLOCKED_INLINE_ANCESTOR_BIT)) continue;
			projected.push({
				from: node.from,
				kind: "link",
				reference: false,
				to: node.to,
			});
		}
	}
	const isReferenceDefined = (rawLabel: string): boolean => {
		definition ??= referenceDefinitionQueryFromStructure(
			text,
			nodes,
			structure,
			profile,
		);
		return null !== definition(rawLabel);
	};
	return {
		isReferenceDefined,
		links: projected,
		needsReferenceAwareReparse,
	};
}

/**
 * Derives links that the formal CommonMark renderer creates from the caller's
 * existing parser tree, including the existing nested-link ownership rules.
 */
export function projectedLinkNodes(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): ReadonlyArray<ParserLinkNode> {
	return inspectProjectedLinkNodes(text, nodes, profile).links;
}

/**
 * Maps prepared link nodes onto canonical source ranges. Candidates outside
 * editable paragraph-style blocks, inside math spans, or overlapping prepared
 * image ranges stay excluded so the menu never offers link actions there.
 */
export function linkCandidatesForBlocks(
	projection: NewlineProjection,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserLinkNode>,
	mathRanges: ReadonlyArray<SourceRange>,
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>,
): ReadonlyArray<EditorMarkdownLinkCandidate> {
	const candidates: EditorMarkdownLinkCandidate[] = [];
	let blockIndex = 0;
	let mathIndex = 0;
	let imageIndex = 0;
	const overlaps = (
		range: SourceRange,
		candidate: Readonly<{ from: number; to: number }> | undefined,
	): boolean =>
		Boolean(
			candidate && candidate.from < range.to && candidate.to > range.from,
		);
	for (const node of nodes) {
		const range = originalRange(projection, node);
		while (
			blockIndex < blocks.length &&
			(blocks[blockIndex]?.to ?? 0) <= range.from
		)
			blockIndex += 1;
		const block = blocks[blockIndex];
		if (!block?.editable || block.from > range.from || range.to > block.to)
			continue;
		if (["code", "math", "unavailable"].includes(block.kind)) continue;
		while (
			mathIndex < mathRanges.length &&
			(mathRanges[mathIndex]?.to ?? 0) <= range.from
		)
			mathIndex += 1;
		if (overlaps(range, mathRanges[mathIndex])) continue;
		while (
			imageIndex < imageRanges.length &&
			(imageRanges[imageIndex]?.to ?? 0) <= range.from
		)
			imageIndex += 1;
		if (overlaps(range, imageRanges[imageIndex])) continue;
		const previous = candidates[candidates.length - 1];
		if (previous && range.from < previous.to) {
			// CommonMark rendered ownership: nested link syntax inside a link
			// label is literal text, so the outer (earlier) link owns the range.
			if (range.from >= previous.from && range.to <= previous.to) continue;
			throw new Error("editor-context-menu-link-candidate-overlap");
		}
		candidates.push({
			blockFrom: block.from,
			blockTo: block.to,
			from: range.from,
			kind: node.kind,
			reference: node.reference,
			to: range.to,
		});
	}
	return candidates;
}
