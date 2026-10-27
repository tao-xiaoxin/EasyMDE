import type {
	EditorMarkdownImageRange,
	EditorMarkdownLinkCandidate,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	originalRange,
	type NewlineProjection,
	type SourceRange,
} from "./editor-markdown-source-projection";

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

/** CommonMark reference labels match after whitespace collapse and case folding. */
function normalizedLinkLabel(value: string): string {
	return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function bracketLabelContent(value: string): string {
	return value.startsWith("[") && value.endsWith("]")
		? value.slice(1, -1)
		: value;
}

function directChildIndex(
	children: ReadonlyArray<ReadonlyArray<number>>,
	nodes: ReadonlyArray<Readonly<{ name: string }>>,
	parentIndex: number,
	name: string,
): number | null {
	for (const childIndex of children[parentIndex] ?? []) {
		if (name === nodes[childIndex]?.name) return childIndex;
	}
	return null;
}

/**
 * Derives the link constructs that the formal CommonMark renderer actually
 * creates. Matching the rendered document is the point: the innermost link
 * wins over its enclosing link, an autolink or bare URL inside a created link
 * label stays literal text, and an unresolved reference contributes no link
 * while leaving its inner autolinks active.
 *
 * The caller owns the parser tree; this projection never parses the source a
 * second time.
 */
export function projectedLinkNodes(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
): ReadonlyArray<ParserLinkNode> {
	const ancestorsAt: string[][] = nodes.map(() => []);
	const children: number[][] = nodes.map(() => []);
	const urlDescendants = new Uint8Array(nodes.length);
	const namesAt = new Map<number, number>();
	const definedLabels = new Set<string>();
	const open: number[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		while (open.length > 0) {
			const parentIndex = open[open.length - 1] ?? -1;
			const parent = nodes[parentIndex];
			if (parent && parent.from <= node.from && node.to <= parent.to) break;
			open.pop();
		}
		const parentIndex = open[open.length - 1];
		if (undefined !== parentIndex) children[parentIndex]?.push(index);
		ancestorsAt[index] = open.flatMap((ancestorIndex) => {
			const name = nodes[ancestorIndex]?.name;
			return name ? [name] : [];
		});
		if ("URL" === node.name) {
			for (const ancestorIndex of open) urlDescendants[ancestorIndex] = 1;
			namesAt.set(node.from, (namesAt.get(node.from) ?? 0) | URL_NODE_NAME_BIT);
		} else if ("LinkTitle" === node.name) {
			namesAt.set(
				node.from,
				(namesAt.get(node.from) ?? 0) | LINK_TITLE_NODE_NAME_BIT,
			);
		}
		open.push(index);
	}
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if ("LinkReference" !== node?.name) continue;
		if (ancestorsAt[index]?.some((ancestor) => LINK_BLOCKED_ANCESTORS[ancestor]))
			continue;
		const labelIndex = directChildIndex(children, nodes, index, "LinkLabel");
		const label = nodes[labelIndex ?? -1];
		if (label) {
			definedLabels.add(
				normalizedLinkLabel(
					bracketLabelContent(text.slice(label.from, label.to)),
				),
			);
		}
	}
	const created = new Uint8Array(nodes.length);
	const referenceLinks = new Uint8Array(nodes.length);
	const frames: Array<{ hasCreatedChild: boolean; index: number }> = [];
	const closeFrame = (): void => {
		const frame = frames.pop();
		if (!frame) return;
		const frameNode = nodes[frame.index];
		if ("Link" === frameNode?.name && frame.hasCreatedChild) {
			created[frame.index] = 0;
		}
		const propagated = frame.hasCreatedChild || 0 !== created[frame.index];
		const parent = frames[frames.length - 1];
		if (parent && propagated) parent.hasCreatedChild = true;
	};
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		while (frames.length > 0) {
			const frame = frames[frames.length - 1];
			if (!frame) break;
			const frameNode = nodes[frame.index];
			if (frameNode && frameNode.from <= node.from && node.to <= frameNode.to)
				break;
			closeFrame();
		}
		if ("Link" === node.name) {
			const hasUrl = 1 === urlDescendants[index];
			if ("[" === text[node.from] && ")" === text[node.to - 1] && hasUrl) {
				created[index] = 1;
			} else if (!(!hasUrl && "[^" === text.slice(node.from, node.from + 2))) {
				const malformed =
					0 !== (namesAt.get(node.to) ?? 0) ||
					"(" === text[node.to] ||
					"[" === text[node.to];
				if (!malformed) {
					const labelIndex = directChildIndex(
						children,
						nodes,
						index,
						"LinkLabel",
					);
					const label = nodes[labelIndex ?? -1];
					const labelText = label
						? text.slice(label.from + 1, label.to - 1)
						: "";
					const rawLabel =
						0 < labelText.length
							? labelText
							: text.slice(node.from + 1, (label?.from ?? node.to) - 1);
					if (definedLabels.has(normalizedLinkLabel(rawLabel))) {
						created[index] = 1;
						referenceLinks[index] = 1;
					}
				}
			}
		}
		frames.push({ hasCreatedChild: false, index });
	}
	while (frames.length > 0) closeFrame();
	const createdLinkDepth = new Uint16Array(nodes.length);
	{
		const stack: Array<{ created: boolean; from: number; to: number }> = [];
		let depth = 0;
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			if (!node) break;
			while (stack.length > 0) {
				const top = stack[stack.length - 1];
				if (top && top.from <= node.from && node.to <= top.to) break;
				stack.pop();
				if (top?.created) depth -= 1;
			}
			createdLinkDepth[index] = depth;
			const isCreated = "Link" === node.name && 0 !== created[index];
			if (isCreated) depth += 1;
			stack.push({ created: isCreated, from: node.from, to: node.to });
		}
	}
	const projected: ParserLinkNode[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		if (ancestorsAt[index]?.some((ancestor) => LINK_BLOCKED_ANCESTORS[ancestor]))
			continue;
		const hasUrl = 1 === urlDescendants[index];
		if ("Link" === node.name) {
			if (0 === created[index]) continue;
			projected.push({
				from: node.from,
				kind: "link",
				reference: 0 !== referenceLinks[index],
				to: node.to,
			});
			continue;
		}
		if (0 !== createdLinkDepth[index]) continue;
		if ("Autolink" === node.name) {
			if (
				ancestorsAt[index]?.some((ancestor) =>
					LINK_BLOCKED_INLINE_ANCESTORS[ancestor],
				)
			)
				continue;
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
			if (
				ancestorsAt[index]?.some((ancestor) =>
					LINK_BLOCKED_INLINE_ANCESTORS[ancestor],
				)
			)
				continue;
			projected.push({
				from: node.from,
				kind: "link",
				reference: false,
				to: node.to,
			});
		}
	}
	return projected;
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
