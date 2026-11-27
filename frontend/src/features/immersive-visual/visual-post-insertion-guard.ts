import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import {
	createMarkdownRoundTripGuard,
	type MarkdownRoundTripGuard,
} from "./markdown-serializer";
import type { VisualSourceIndex } from "./visual-source-index";

function isListNode(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "bullet_list" ||
		node.type.name === "ordered_list" ||
		node.type.name === "task_list"
	);
}

function hasEmptyParagraphDescendant(node: ProseMirrorNode): boolean {
	let found = false;
	node.descendants((descendant) => {
		if (found) return false;
		if (descendant.type.name === "paragraph" && descendant.childCount === 0) {
			found = true;
			return false;
		}
		return true;
	});
	return found;
}

type ListItemBridgePair = Readonly<{
	liveItem: ProseMirrorNode;
	parsedItem: ProseMirrorNode;
}>;

type ListProjectionBridge = Readonly<{
	itemPairs: ReadonlyArray<ListItemBridgePair>;
	liveList: ProseMirrorNode;
	parsedList: ProseMirrorNode;
}>;

type ReconciledListBlock = Readonly<{
	baselineNode: ProseMirrorNode;
	bridge: ListProjectionBridge;
}>;

function reconcileListBlockForGuard(
	liveList: ProseMirrorNode,
	raw: string,
): ReconciledListBlock | null {
	const reparsedDoc = parseMarkdownWithBlockSources(raw).doc;
	const reparsedList =
		reparsedDoc.childCount === 1 ? reparsedDoc.firstChild : null;
	if (
		!reparsedList ||
		reparsedList.type !== liveList.type ||
		reparsedList.childCount !== liveList.childCount
	) {
		return null;
	}

	const baselineItems: ProseMirrorNode[] = [];
	const itemPairs: ListItemBridgePair[] = [];
	for (let j = 0; j < liveList.childCount; j += 1) {
		const liveItem = liveList.child(j);
		const reparsedItem = reparsedList.child(j);
		if (liveItem.eq(reparsedItem)) {
			baselineItems.push(liveItem);
		} else {
			baselineItems.push(reparsedItem);
			itemPairs.push({ liveItem, parsedItem: reparsedItem });
		}
	}
	if (itemPairs.length === 0) {
		return null;
	}

	const parsedList = reparsedList.type.create(
		reparsedList.attrs,
		baselineItems,
	);
	return {
		baselineNode: parsedList,
		bridge: {
			itemPairs,
			liveList,
			parsedList,
		},
	};
}

function findBridgedItem(
	item: ProseMirrorNode,
	bridges: ReadonlyArray<ListProjectionBridge>,
): ProseMirrorNode | null {
	for (const bridge of bridges) {
		for (const pair of bridge.itemPairs) {
			if (item === pair.liveItem) {
				return pair.parsedItem;
			}
		}
	}
	for (const bridge of bridges) {
		for (const pair of bridge.itemPairs) {
			if (item.eq(pair.liveItem)) {
				return pair.parsedItem;
			}
		}
	}
	return null;
}

function projectListChildThroughBridges(
	child: ProseMirrorNode,
	bridges: ReadonlyArray<ListProjectionBridge>,
): ProseMirrorNode {
	for (const bridge of bridges) {
		if (child === bridge.liveList) {
			return bridge.parsedList;
		}
	}
	for (const bridge of bridges) {
		if (child.eq(bridge.liveList)) {
			return bridge.parsedList;
		}
	}
	if (!isListNode(child)) {
		return child;
	}

	const matchingBridges = bridges.filter(
		(bridge) => bridge.liveList.type === child.type,
	);
	if (matchingBridges.length === 0) {
		return child;
	}

	let listChanged = false;
	const mappedItems: ProseMirrorNode[] = [];
	for (let j = 0; j < child.childCount; j += 1) {
		const item = child.child(j);
		const mapped = findBridgedItem(item, matchingBridges);
		if (mapped) {
			mappedItems.push(mapped);
			listChanged = true;
		} else {
			mappedItems.push(item);
		}
	}
	return listChanged ? child.type.create(child.attrs, mappedItems) : child;
}

function projectDocThroughListBridges(
	doc: ProseMirrorNode,
	bridges: ReadonlyArray<ListProjectionBridge>,
): ProseMirrorNode {
	let changed = false;
	const mappedChildren: ProseMirrorNode[] = [];
	for (let i = 0; i < doc.childCount; i += 1) {
		const child = doc.child(i);
		const projected = projectListChildThroughBridges(child, bridges);
		if (projected !== child) {
			changed = true;
		}
		mappedChildren.push(projected);
	}
	return changed ? doc.type.create(doc.attrs, mappedChildren) : doc;
}

/**
 * Builds an updated round-trip guard after one or more atomic visual-node
 * insertions (such as inserting empty paragraphs inside blockquotes or list
 * items).
 *
 * Every top-level block keeps its exact post-insertion raw slice from `value`,
 * anchored to the live `nextDoc` child nodes. Every top-level list block
 * containing any empty visual paragraph descendant (including inside nested
 * blockquotes or sublists) is reconciled against its re-parsed Markdown list so
 * all untouched items across all lists project cleanly back to their
 * parser-verified equivalents when sibling items are edited later.
 */
export function buildPostInsertionRoundTripGuard(
	nextDoc: ProseMirrorNode,
	value: string,
	nextIndex: VisualSourceIndex,
): MarkdownRoundTripGuard {
	let monotonic = nextIndex.blocks.length === nextDoc.childCount;
	for (let i = 0; monotonic && i < nextIndex.blocks.length; i += 1) {
		const block = nextIndex.blocks[i];
		const previous = i > 0 ? nextIndex.blocks[i - 1] : undefined;
		if (
			!block ||
			block.mdStart < 0 ||
			block.mdEnd < block.mdStart ||
			block.mdEnd > nextIndex.text.length ||
			(previous && block.mdStart < previous.mdEnd)
		) {
			monotonic = false;
		}
	}
	if (!monotonic) {
		return createMarkdownRoundTripGuard(
			value,
			parseMarkdownWithBlockSources(value),
			nextDoc,
		);
	}

	const blocks: ParsedVisualBlockSource[] = [];
	const listBridges: ListProjectionBridge[] = [];

	for (let i = 0; i < nextDoc.childCount; i += 1) {
		const sourceBlock = nextIndex.blocks[i];
		const previousBlock = i > 0 ? nextIndex.blocks[i - 1] : undefined;
		const liveNode = nextDoc.child(i);
		if (!sourceBlock) continue;
		const rawSlice = nextIndex.text.slice(
			sourceBlock.mdStart,
			sourceBlock.mdEnd,
		);
		const isEmptyParagraph =
			liveNode.type.name === "paragraph" &&
			liveNode.childCount === 0 &&
			rawSlice.length === 0;
		const raw = isEmptyParagraph ? null : rawSlice;
		const separatorBefore =
			i === 0 || !previousBlock
				? ""
				: nextIndex.text.slice(previousBlock.mdEnd, sourceBlock.mdStart);

		let baselineNode: ProseMirrorNode = liveNode;
		if (
			raw !== null &&
			isListNode(liveNode) &&
			hasEmptyParagraphDescendant(liveNode)
		) {
			const reconciled = reconcileListBlockForGuard(liveNode, raw);
			if (reconciled) {
				baselineNode = reconciled.baselineNode;
				listBridges.push(reconciled.bridge);
			}
		}

		blocks.push({ node: baselineNode, raw, separatorBefore });
	}

	const baselineDoc =
		listBridges.length > 0
			? nextDoc.type.create(
					nextDoc.attrs,
					blocks.map((block) => block.node),
				)
			: nextDoc;
	const firstBlock = nextIndex.blocks[0];
	const lastBlock = nextIndex.blocks[nextIndex.blocks.length - 1];
	const updatedParsed: ParsedVisualDocument = {
		blocks,
		doc: baselineDoc,
		leadingPrefix: firstBlock
			? nextIndex.text.slice(0, firstBlock.mdStart)
			: "",
		lineEnding: value.includes("\r\n") ? "\r\n" : "\n",
		trailingSuffix: lastBlock ? nextIndex.text.slice(lastBlock.mdEnd) : "",
	};
	const baseGuard = createMarkdownRoundTripGuard(
		value,
		updatedParsed,
		baselineDoc,
	);
	if (listBridges.length === 0) {
		return baseGuard;
	}

	const isUnmodified = (doc: ProseMirrorNode): boolean =>
		doc === nextDoc || doc.eq(nextDoc);

	return {
		initialDoc: nextDoc,
		initialMarkdown: value,
		isUnmodified,
		serialize(doc: ProseMirrorNode): string {
			if (isUnmodified(doc)) return value;
			const projected = projectDocThroughListBridges(doc, listBridges);
			return baseGuard.serialize(projected);
		},
	};
}
