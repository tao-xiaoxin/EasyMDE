import { markdownLanguage } from "@codemirror/lang-markdown";

import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";

export type EditorSourceLinkSelection = Readonly<{
	end: number;
	start: number;
}>;

export type EditorSourceLinkCandidate = Readonly<{
	blockFrom: number;
	blockTo: number;
	from: number;
	kind: "autolink" | "link";
	reference: boolean;
	source: string;
	to: number;
}>;

export type EditorSourceLinkUnavailableCode =
	| "editor-source-link-block-index-stale"
	| "editor-source-link-block-index-unavailable"
	| "editor-source-link-selection-invalid";

export type EditorSourceLinkResolution =
	| Readonly<{ status: "candidate"; candidate: EditorSourceLinkCandidate }>
	| Readonly<{ status: "none" }>
	| Readonly<{
			code: EditorSourceLinkUnavailableCode;
			status: "unavailable";
	  }>;

export type FindEditorSourceLinkInput = Readonly<{
	blockIndex?: EditorMarkdownBlockIndex | null | undefined;
	selection: EditorSourceLinkSelection;
	source: string;
}>;

type ParsedMarkdownNode = Readonly<{
	ancestors: ReadonlyArray<string>;
	from: number;
	name: string;
	to: number;
}>;

const BLOCKED_ANCESTORS = new Set([
	"CodeBlock",
	"FencedCode",
	"Image",
	"InlineCode",
]);

const BLOCKED_URL_ANCESTORS = new Set([
	"Autolink",
	"CodeBlock",
	"FencedCode",
	"Image",
	"InlineCode",
	"Link",
	"LinkReference",
]);

function parsedNodes(source: string): ReadonlyArray<ParsedMarkdownNode> {
	const nodes: ParsedMarkdownNode[] = [];
	const ancestors: string[] = [];
	const tree = markdownLanguage.parser.parse(source);
	tree.iterate({
		enter(node) {
			nodes.push({
				ancestors: [...ancestors],
				from: node.from,
				name: node.name,
				to: node.to,
			});
			ancestors.push(node.name);
		},
		leave() {
			ancestors.pop();
		},
	});
	return nodes;
}

function descendants(
	node: ParsedMarkdownNode,
	nodes: ReadonlyArray<ParsedMarkdownNode>,
): ReadonlyArray<ParsedMarkdownNode> {
	return nodes.filter(
		(candidate) =>
			candidate !== node &&
			candidate.from >= node.from &&
			candidate.to <= node.to,
	);
}

function malformedContinuation(
	blockSource: string,
	node: ParsedMarkdownNode,
	nodes: ReadonlyArray<ParsedMarkdownNode>,
): boolean {
	const nextNode = nodes.find((candidate) => candidate.from === node.to);
	if ("URL" === nextNode?.name || "LinkTitle" === nextNode?.name) {
		return true;
	}
	const next = blockSource[node.to];
	return "(" === next || "[" === next;
}

function sourceNodeIsFootnote(
	blockSource: string,
	node: ParsedMarkdownNode,
	nodeChildren: ReadonlyArray<ParsedMarkdownNode>,
): boolean {
	if (nodeChildren.some((child) => "URL" === child.name)) return false;
	return blockSource.slice(node.from, node.to).startsWith("[^");
}

function validAutolink(
	blockSource: string,
	node: ParsedMarkdownNode,
	nodeChildren: ReadonlyArray<ParsedMarkdownNode>,
): boolean {
	return (
		"<" === blockSource[node.from] &&
		">" === blockSource[node.to - 1] &&
		nodeChildren.some((child) => "URL" === child.name)
	);
}

function validInlineLink(
	blockSource: string,
	node: ParsedMarkdownNode,
	nodeChildren: ReadonlyArray<ParsedMarkdownNode>,
): boolean {
	return (
		"[" === blockSource[node.from] &&
		")" === blockSource[node.to - 1] &&
		nodeChildren.some((child) => "URL" === child.name)
	);
}

function candidateForNode(
	blockSource: string,
	node: ParsedMarkdownNode,
	nodes: ReadonlyArray<ParsedMarkdownNode>,
	blockFrom: number,
):
	| Readonly<{ candidate: EditorSourceLinkCandidate }>
	| Readonly<{ malformed: true }>
	| null {
	if (node.ancestors.some((ancestor) => BLOCKED_ANCESTORS.has(ancestor))) {
		return null;
	}
	const nodeChildren = descendants(node, nodes);
	if ("Autolink" === node.name) {
		return validAutolink(blockSource, node, nodeChildren)
			? {
					candidate: {
						blockFrom,
						blockTo: blockFrom + blockSource.length,
						from: blockFrom + node.from,
						kind: "autolink",
						reference: false,
						source: blockSource.slice(node.from, node.to),
						to: blockFrom + node.to,
					},
				}
			: { malformed: true };
	}
	if ("URL" === node.name) {
		if (
			node.ancestors.some((ancestor) => BLOCKED_URL_ANCESTORS.has(ancestor))
		) {
			return null;
		}
		return {
			candidate: {
				blockFrom,
				blockTo: blockFrom + blockSource.length,
				from: blockFrom + node.from,
				kind: "link",
				reference: false,
				source: blockSource.slice(node.from, node.to),
				to: blockFrom + node.to,
			},
		};
	}
	if ("Link" !== node.name) return null;

	if (validInlineLink(blockSource, node, nodeChildren)) {
		return {
			candidate: {
				blockFrom,
				blockTo: blockFrom + blockSource.length,
				from: blockFrom + node.from,
				kind: "link",
				reference: false,
				source: blockSource.slice(node.from, node.to),
				to: blockFrom + node.to,
			},
		};
	}

	if (sourceNodeIsFootnote(blockSource, node, nodeChildren)) return null;
	if (malformedContinuation(blockSource, node, nodes)) {
		return { malformed: true };
	}
	return {
		candidate: {
			blockFrom,
			blockTo: blockFrom + blockSource.length,
			from: blockFrom + node.from,
			kind: "link",
			reference: true,
			source: blockSource.slice(node.from, node.to),
			to: blockFrom + node.to,
		},
	};
}

function selectionIsValid(
	selection: EditorSourceLinkSelection,
	source: string,
): boolean {
	return (
		Number.isSafeInteger(selection.start) &&
		Number.isSafeInteger(selection.end) &&
		selection.start >= 0 &&
		selection.end >= selection.start &&
		selection.end <= source.length
	);
}

function containsSelection(
	node: ParsedMarkdownNode,
	selection: EditorSourceLinkSelection,
): boolean {
	if (selection.start === selection.end) {
		return selection.start > node.from && selection.start < node.to;
	}
	return node.from <= selection.start && selection.end <= node.to;
}

export function findEditorSourceLink({
	blockIndex,
	selection,
	source,
}: FindEditorSourceLinkInput): EditorSourceLinkResolution {
	if (!selectionIsValid(selection, source)) {
		return {
			code: "editor-source-link-selection-invalid",
			status: "unavailable",
		};
	}
	if (!blockIndex) {
		return {
			code: "editor-source-link-block-index-unavailable",
			status: "unavailable",
		};
	}
	if (blockIndex.source !== source || blockIndex.length !== source.length) {
		return {
			code: "editor-source-link-block-index-stale",
			status: "unavailable",
		};
	}
	const insideMath = blockIndex.mathSpans.some((span) =>
		selection.start === selection.end
			? span.from < selection.start && selection.start < span.to
			: span.from <= selection.start && selection.end <= span.to,
	);
	if (insideMath) return { status: "none" };
	const containingBlocks = blockIndex.blocks.filter(
		(block) => block.from <= selection.start && selection.end <= block.to,
	);
	if (1 !== containingBlocks.length) return { status: "none" };
	const block = containingBlocks[0];
	if (!block || ["code", "math", "unavailable"].includes(block.kind)) {
		return { status: "none" };
	}
	const blockSource = source.slice(block.from, block.to);
	if (
		!blockSource.includes("[") &&
		!blockSource.includes("<") &&
		!blockSource.includes(":") &&
		!blockSource.includes("@")
	) {
		return { status: "none" };
	}
	const localSelection = {
		end: selection.end - block.from,
		start: selection.start - block.from,
	};
	const nodes = parsedNodes(blockSource);
	const linkNodes = nodes.filter(
		(node) =>
			("Link" === node.name ||
				"Autolink" === node.name ||
				"URL" === node.name) &&
			containsSelection(node, localSelection),
	);
	if (0 === linkNodes.length) return { status: "none" };

	const candidates: EditorSourceLinkCandidate[] = [];
	for (const node of linkNodes) {
		const result = candidateForNode(blockSource, node, nodes, block.from);
		if (result && "malformed" in result) {
			// A partially typed link is ordinary editable Markdown. Link-specific
			// actions are unavailable, but the generic context menu must remain
			// usable for Copy/Cut/Paste and formatting.
			return { status: "none" };
		}
		if (result && "candidate" in result) candidates.push(result.candidate);
	}
	if (1 !== candidates.length) return { status: "none" };
	return {
		candidate: candidates[0] as EditorSourceLinkCandidate,
		status: "candidate",
	};
}
