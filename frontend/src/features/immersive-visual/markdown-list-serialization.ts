import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	inspectReferenceDefinitionBlock,
	type ReferenceDefinitionBlockInfo,
} from "./markdown-parser";
import { sanitizeBulletMarker } from "./visual-schema";

/**
 * List serialization for the immersive visual editor, including tight-list
 * preservation for `paragraph + horizontal_rule` (`***`), leading/adjacent
 * CommonMark §4.7 reference definitions, and task items whose checkbox
 * paragraph follows leading reference definitions.
 */

export type BlockSerializer = (node: ProseMirrorNode) => string;

const NON_REF_DEF_INFO: ReferenceDefinitionBlockInfo = {
	isRefDef: false,
	lastHasTitle: false,
};

const refDefInfoCache = new WeakMap<
	ProseMirrorNode,
	ReferenceDefinitionBlockInfo
>();

function inspectProtectedReferenceBlock(
	node: ProseMirrorNode,
): ReferenceDefinitionBlockInfo {
	if (node.type.name !== "protected_block" || node.attrs.kind !== "raw") {
		return NON_REF_DEF_INFO;
	}
	const cached = refDefInfoCache.get(node);
	if (cached !== undefined) {
		return cached;
	}
	const raw =
		typeof node.attrs.rawMarkdown === "string" ? node.attrs.rawMarkdown : "";
	const info = inspectReferenceDefinitionBlock(raw);
	refDefInfoCache.set(node, info);
	return info;
}

function prefixMultiline(
	text: string,
	firstLinePrefix: string,
	continuationPrefix: string,
): string {
	const lines = text.split("\n");
	return lines
		.map((line, index) => {
			if (index === 0) {
				return line.length > 0
					? `${firstLinePrefix}${line}`
					: firstLinePrefix.trimEnd();
			}
			return line.length > 0 ? `${continuationPrefix}${line}` : "";
		})
		.join("\n");
}

export function isNestedList(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "bullet_list" ||
		node.type.name === "ordered_list" ||
		node.type.name === "task_list"
	);
}

export function isLooseList(listNode: ProseMirrorNode): boolean {
	if (listNode.attrs.tight === false) {
		return true;
	}
	if (listNode.attrs.tight === true) {
		return false;
	}
	for (let i = 0; i < listNode.childCount; i += 1) {
		const item = listNode.child(i);
		let nonListBlocks = 0;
		for (let j = 0; j < item.childCount; j += 1) {
			if (!isNestedList(item.child(j))) {
				nonListBlocks += 1;
			}
		}
		if (nonListBlocks > 1) {
			return true;
		}
	}
	return false;
}

function canInterruptPreviousInTightList(
	node: ProseMirrorNode,
	prev: ProseMirrorNode,
	serialized: string,
): boolean {
	const prevRef = inspectProtectedReferenceBlock(prev);
	if (prevRef.isRefDef) {
		if (serialized.length === 0) {
			return false;
		}
		if (!prevRef.lastHasTitle) {
			const nl = serialized.indexOf("\n");
			const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
			if (/^[ \t]*["'(]/.test(firstLine)) {
				return false;
			}
		}
		return true;
	}
	const name = node.type.name;
	if (prev.type.name === "table") {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		if (firstLine.includes("|")) return false;
		if (name === "table") return serialized.startsWith("<!-- ");
	}
	return (
		name === "table" ||
		name === "code_block" ||
		name === "blockquote" ||
		name === "heading" ||
		name === "horizontal_rule"
	);
}

function findLeadingRefTaskParagraphIndex(
	itemNode: ProseMirrorNode,
	startIndex: number,
): number {
	let index = startIndex;
	while (index < itemNode.childCount) {
		if (!inspectProtectedReferenceBlock(itemNode.child(index)).isRefDef) {
			break;
		}
		index += 1;
	}
	if (
		index > startIndex &&
		index < itemNode.childCount &&
		itemNode.child(index).type.name === "paragraph"
	) {
		return index;
	}
	return -1;
}

function serializeListItemBody(
	itemNode: ProseMirrorNode,
	loose: boolean,
	serializeBlock: BlockSerializer,
	blankBeforeNestedList: boolean,
	hasPhantomParagraph: boolean,
	deferredTaskParagraphIndex: number,
): string {
	const startIndex = hasPhantomParagraph ? 1 : 0;
	const parts: string[] = [];
	for (let i = startIndex; i < itemNode.childCount; i += 1) {
		const child = itemNode.child(i);
		const prev = i > startIndex ? itemNode.child(i - 1) : null;
		let serialized =
			!loose &&
			prev !== null &&
			child.type.name === "horizontal_rule" &&
			prev.type.name === "paragraph"
				? "***"
				: serializeBlock(child);
		if (i === deferredTaskParagraphIndex) {
			const taskMarker = itemNode.attrs.checked ? "[x]" : "[ ]";
			serialized =
				serialized.length > 0 ? `${taskMarker} ${serialized}` : taskMarker;
		}
		if (i === startIndex) {
			const startsWithInlineRef =
				hasPhantomParagraph &&
				inspectProtectedReferenceBlock(child).isRefDef &&
				!/^[ \t]/.test(serialized);
			parts.push(
				hasPhantomParagraph && !startsWithInlineRef
					? `\n${serialized}`
					: serialized,
			);
		} else if (
			isNestedList(child) &&
			prev !== null &&
			prev.type.name === "paragraph"
		) {
			parts.push(
				blankBeforeNestedList ? `\n\n${serialized}` : `\n${serialized}`,
			);
		} else if (
			!loose &&
			prev !== null &&
			canInterruptPreviousInTightList(child, prev, serialized)
		) {
			parts.push(`\n${serialized}`);
		} else {
			parts.push(`\n\n${serialized}`);
		}
	}
	return parts.join("");
}

export function serializeListItemAt(
	listNode: ProseMirrorNode,
	index: number,
	loose: boolean,
	serializeBlock: BlockSerializer,
	blankBeforeNestedList: boolean,
): string {
	const item = listNode.child(index);
	const firstChild = item.child(0);
	const hasPhantomParagraph =
		item.childCount > 1 &&
		firstChild.type.name === "paragraph" &&
		firstChild.childCount === 0;
	const deferredTaskParagraphIndex =
		listNode.type.name === "task_list" && hasPhantomParagraph
			? findLeadingRefTaskParagraphIndex(item, 1)
			: -1;
	const body = serializeListItemBody(
		item,
		loose,
		serializeBlock,
		blankBeforeNestedList,
		hasPhantomParagraph,
		deferredTaskParagraphIndex,
	);
	const bulletMarker = sanitizeBulletMarker(listNode.attrs.marker);
	let prefix = `${bulletMarker} `;
	let indent = "  ";
	if (listNode.type.name === "ordered_list") {
		const delimiter = listNode.attrs.delimiter === ")" ? ")" : ".";
		const order = listNode.attrs.order;
		const startOrder =
			typeof order === "number" && Number.isInteger(order) && order >= 0
				? order
				: 1;
		prefix = `${startOrder + index}${delimiter} `;
		indent = " ".repeat(prefix.length);
	} else if (
		listNode.type.name === "task_list" &&
		deferredTaskParagraphIndex < 0
	) {
		prefix = item.attrs.checked
			? `${bulletMarker} [x] `
			: `${bulletMarker} [ ] `;
	}
	return prefixMultiline(body, prefix, indent);
}

export function serializeList(
	listNode: ProseMirrorNode,
	serializeBlock: BlockSerializer,
): string {
	const loose = isLooseList(listNode);
	const items: string[] = [];
	for (let i = 0; i < listNode.childCount; i += 1) {
		items.push(serializeListItemAt(listNode, i, loose, serializeBlock, false));
	}
	return items.join(loose ? "\n\n" : "\n");
}
