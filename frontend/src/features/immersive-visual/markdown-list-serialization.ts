import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	htmlBlockLineCloses,
	matchHtmlBlockOpen,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	inspectReferenceDefinitionBlock,
	type ReferenceDefinitionBlockInfo,
	TASK_LIST_MARKER_PATTERN,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-it-config";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";
import { sanitizeBulletMarker } from "./visual-schema";

/**
 * List serialization for the immersive visual editor, including tight-list
 * preservation for `paragraph + horizontal_rule` (`***`), leaf blocks
 * (`heading`, `code_block`, `horizontal_rule`), leading/adjacent CommonMark
 * §4.7 reference definitions, literal `\[x]` escape preservation, and task
 * items whose checkbox paragraph follows leading reference definitions.
 */

export type BlockSerializer = (node: ProseMirrorNode) => string;
export type RefDefContinuationMode = "none" | "tight" | "indented";

/**
 * CommonMark §2.2 four-column leading indentation (four spaces, or 0-3 spaces
 * followed by a tab stop advancing to column 4).
 */
export const LEADING_FOUR_COLUMN_INDENT = /^(?: {4}| {0,3}\t)/;

const NON_REF_DEF_INFO: ReferenceDefinitionBlockInfo = {
	isRefDef: false,
	lastHasTitle: false,
	lastRaw: "",
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

function isClosedHtmlBlockTypes1To5(node: ProseMirrorNode): boolean {
	if (node.type.name !== "protected_block" || node.attrs.kind !== "raw") {
		return false;
	}
	const raw =
		typeof node.attrs.rawMarkdown === "string" ? node.attrs.rawMarkdown : "";
	if (raw.length === 0) {
		return false;
	}
	const lines = raw.split("\n");
	const firstLine = (lines[0] ?? "").replace(/^[ \t]{0,3}/, "");
	const htmlType = matchHtmlBlockOpen(firstLine, false);
	if (htmlType === null || htmlType === 6 || htmlType === 7) {
		return false;
	}
	const lastLine = lines[lines.length - 1] ?? "";
	return htmlBlockLineCloses(htmlType, lastLine);
}

function isStandaloneType7HtmlFirstLine(text: string): boolean {
	if (text.length === 0) {
		return false;
	}
	const nl = text.indexOf("\n");
	const firstLine = nl === -1 ? text : text.slice(0, nl);
	const trimmedLead = firstLine.replace(/^[ \t]+/, "");
	return matchHtmlBlockOpen(trimmedLead, true) === 7;
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
		if (
			!prevRef.lastHasTitle &&
			wouldReferenceDefinitionAbsorbFollowingBlock(prevRef.lastRaw, serialized)
		) {
			return false;
		}
		return true;
	}
	if (serialized.length > 0 && isClosedHtmlBlockTypes1To5(prev)) {
		return true;
	}
	if (
		(prev.type.name === "heading" ||
			prev.type.name === "code_block" ||
			prev.type.name === "horizontal_rule") &&
		serialized.length > 0
	) {
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

export function refDefContinuationMode(
	prev: ProseMirrorNode,
	next: ProseMirrorNode,
	serializedNext: string,
): RefDefContinuationMode {
	if (next.type.name !== "paragraph") {
		return "none";
	}
	if (!inspectProtectedReferenceBlock(prev).isRefDef) {
		return "none";
	}
	const first = next.firstChild;
	const hasContinuationIndent =
		first?.type.name === "protected_inline" &&
		first.attrs.kind === "raw-inline" &&
		first.attrs.continuationIndent === true;
	if (hasContinuationIndent) {
		const raw =
			typeof first.attrs.rawMarkdown === "string" ? first.attrs.rawMarkdown : "";
		if (
			wouldRawHtmlInterruptParagraph(raw) ||
			isStandaloneType7HtmlFirstLine(serializedNext)
		) {
			return "indented";
		}
	}
	if (isStandaloneType7HtmlFirstLine(serializedNext)) {
		return "tight";
	}
	return "none";
}

export function needsTightRefDefContinuation(
	prev: ProseMirrorNode,
	next: ProseMirrorNode,
	serializedNext = "",
): boolean {
	return refDefContinuationMode(prev, next, serializedNext) !== "none";
}

export function joinSerializedBlocks(
	container: ProseMirrorNode,
	serializeBlock: BlockSerializer,
): string {
	const parts: string[] = [];
	for (let i = 0; i < container.childCount; i += 1) {
		const child = container.child(i);
		const prev = i > 0 ? container.child(i - 1) : null;
		const serialized = serializeBlock(child);
		const mode =
			prev !== null ? refDefContinuationMode(prev, child, serialized) : "none";
		if (mode === "indented") {
			parts.push(
				LEADING_FOUR_COLUMN_INDENT.test(serialized)
					? `\n${serialized}`
					: `\n    ${serialized}`,
			);
		} else if (mode === "tight") {
			parts.push(`\n${serialized}`);
		} else if (i > 0) {
			parts.push(`\n\n${serialized}`);
		} else {
			parts.push(serialized);
		}
	}
	return parts.join("");
}

function escapeLiteralTaskPrefix(
	child: ProseMirrorNode,
	serialized: string,
): string {
	if (
		child.type.name !== "paragraph" ||
		child.attrs.preserveRawTaskPrefix === true ||
		!TASK_LIST_MARKER_PATTERN.test(serialized)
	) {
		return serialized;
	}
	if (child.firstChild?.marks.some((mark) => mark.type.name === "link")) {
		return `[&#${serialized.charCodeAt(1)};]${serialized.slice(3)}`;
	}
	return `\\${serialized}`;
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
	isTaskList: boolean,
	loose: boolean,
	serializeBlock: BlockSerializer,
	blankBeforeNestedList: boolean,
	hasPhantomParagraph: boolean,
	deferredTaskParagraphIndex: number,
): string {
	const startIndex = hasPhantomParagraph ? 1 : 0;
	const taskParagraphIndex = isTaskList
		? deferredTaskParagraphIndex >= 0
			? deferredTaskParagraphIndex
			: startIndex
		: -1;
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
		} else if (!isTaskList || i > taskParagraphIndex) {
			serialized = escapeLiteralTaskPrefix(child, serialized);
		}
		if (i === startIndex) {
			const startsWithInlineRaw =
				hasPhantomParagraph &&
				child.type.name === "protected_block" &&
				child.attrs.kind === "raw" &&
				serialized.length > 0 &&
				!/^[ \t\n]/.test(serialized);
			parts.push(
				hasPhantomParagraph && !startsWithInlineRaw
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
		} else {
			const refDefMode =
				prev !== null
					? refDefContinuationMode(prev, child, serialized)
					: "none";
			if (refDefMode === "indented") {
				parts.push(
					LEADING_FOUR_COLUMN_INDENT.test(serialized)
						? `\n${serialized}`
						: `\n    ${serialized}`,
				);
			} else if (refDefMode === "tight") {
				parts.push(`\n${serialized}`);
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
	const isTaskList = listNode.type.name === "task_list";
	const firstChild = item.child(0);
	const hasPhantomParagraph =
		item.childCount > 1 &&
		firstChild.type.name === "paragraph" &&
		firstChild.childCount === 0;
	const deferredTaskParagraphIndex =
		isTaskList && hasPhantomParagraph
			? findLeadingRefTaskParagraphIndex(item, 1)
			: -1;
	const body = serializeListItemBody(
		item,
		isTaskList,
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
