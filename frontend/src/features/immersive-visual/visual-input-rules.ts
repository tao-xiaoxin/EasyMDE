import {
	InputRule,
	inputRules,
	textblockTypeInputRule,
	wrappingInputRule,
} from "prosemirror-inputrules";
import type {
	MarkType,
	NodeType,
	Node as ProseMirrorNode,
	ResolvedPos,
} from "prosemirror-model";
import {
	type EditorState,
	type Plugin,
	TextSelection,
} from "prosemirror-state";
import { sanitizeBulletMarker, visualEditorSchema } from "./visual-schema";

/**
 * A block input rule may only replace the whole paragraph when the parent's
 * content model accepts the target block. This rejects `table_cell` /
 * `table_header` (paragraph-only) and a non-paragraph first child inside
 * `list_item` / `task_item`, both of which would otherwise shatter the table or
 * the list instead of applying the shortcut.
 */
function canReplaceCurrentBlock(
	$start: ResolvedPos,
	targetType: NodeType,
): boolean {
	const depth = $start.depth;
	if (depth < 1) return false;
	return $start
		.node(depth - 1)
		.canReplaceWith(
			$start.index(depth - 1),
			$start.indexAfter(depth - 1),
			targetType,
		);
}

function canReplaceSiblingAt(
	$start: ResolvedPos,
	depth: number,
	index: number,
	targetType: NodeType,
): boolean {
	if (depth < 0 || depth > $start.depth) return false;
	return $start.node(depth).canReplaceWith(index, index + 1, targetType);
}

/**
 * Block shortcuts must consume the complete paragraph. Replacing a paragraph
 * that still holds text would silently delete the trailing content.
 */
function isWholeParagraph($start: ResolvedPos, end: number): boolean {
	return end === $start.end($start.depth);
}

function createHeadingRule(): InputRule {
	return textblockTypeInputRule(/^(#{1,6})\s$/, {
		getAttrs: (match: RegExpMatchArray) => ({
			level: (match[1] ?? "#").length,
		}),
		inCodeMark: false,
		nodeType: visualEditorSchema.nodes.heading,
	});
}

function createBlockquoteRule(): InputRule {
	return wrappingInputRule(/^\s*>\s$/, {
		inCodeMark: false,
		nodeType: visualEditorSchema.nodes.blockquote,
	});
}

function createBulletListRule(): InputRule {
	return wrappingInputRule(/^\s*([-+*])\s$/, {
		getAttrs: (match: RegExpMatchArray) => ({
			marker: sanitizeBulletMarker(match[1]),
		}),
		inCodeMark: false,
		joinPredicate: (match: RegExpMatchArray, node: ProseMirrorNode) =>
			sanitizeBulletMarker(node.attrs.marker) ===
			sanitizeBulletMarker(match[1]),
		nodeType: visualEditorSchema.nodes.bullet_list,
	});
}

function createOrderedListRule(): InputRule {
	return wrappingInputRule(/^(\d+)\.\s$/, {
		getAttrs: (match: RegExpMatchArray) => ({
			order: Number.parseInt(match[1] ?? "1", 10) || 1,
		}),
		inCodeMark: false,
		joinPredicate: (match: RegExpMatchArray, node: ProseMirrorNode) =>
			node.childCount +
				(typeof node.attrs.order === "number" ? node.attrs.order : 1) ===
			(Number.parseInt(match[1] ?? "1", 10) || 1),
		nodeType: visualEditorSchema.nodes.ordered_list,
	});
}

function createDirectTaskListRule(): InputRule {
	const taskListType = visualEditorSchema.nodes.task_list;
	const taskItemType = visualEditorSchema.nodes.task_item;
	const paragraphType = visualEditorSchema.nodes.paragraph;

	return new InputRule(
		/^\s*([-+*])\s\[([ xX])\]\s$/,
		(
			state: EditorState,
			match: RegExpMatchArray,
			start: number,
			end: number,
		) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type !== paragraphType) return null;
			if (!canReplaceCurrentBlock($start, taskListType)) return null;
			const marker = sanitizeBulletMarker(match[1]);
			const checked = (match[2] ?? " ").toLowerCase() === "x";
			const blockFrom = $start.before($start.depth);
			const blockTo = $start.after($start.depth);
			const remainingContent = $start.parent.content.cut(
				end - $start.start($start.depth),
			);
			const paragraph = paragraphType.create(null, remainingContent);
			const taskItem = taskItemType.create({ checked }, paragraph);
			const taskList = taskListType.create({ marker }, taskItem);

			const tr = state.tr.replaceWith(blockFrom, blockTo, taskList);
			// Position inside task_list (+1) -> task_item (+1) -> paragraph (+1)
			const cursorPos = blockFrom + 3;
			tr.setSelection(TextSelection.create(tr.doc, cursorPos));
			return tr;
		},
		{ inCodeMark: false },
	);
}

function createBulletItemToTaskListRule(): InputRule {
	const taskListType = visualEditorSchema.nodes.task_list;
	const taskItemType = visualEditorSchema.nodes.task_item;
	const bulletListType = visualEditorSchema.nodes.bullet_list;
	const listItemType = visualEditorSchema.nodes.list_item;
	const paragraphType = visualEditorSchema.nodes.paragraph;

	return new InputRule(
		/^\[([ xX])\]\s$/,
		(
			state: EditorState,
			match: RegExpMatchArray,
			start: number,
			end: number,
		) => {
			const $start = state.doc.resolve(start);
			if (
				$start.depth < 3 ||
				$start.parent.type !== paragraphType ||
				$start.node($start.depth - 1).type !== listItemType ||
				$start.node($start.depth - 2).type !== bulletListType ||
				$start.index($start.depth - 1) !== 0
			) {
				return null;
			}

			const bulletListDepth = $start.depth - 2;
			const bulletListNode = $start.node(bulletListDepth);
			const bulletListPos = $start.before(bulletListDepth);
			const bulletListEnd = $start.after(bulletListDepth);
			const currentItemIndex = $start.index(bulletListDepth);
			if (
				!canReplaceSiblingAt(
					$start,
					bulletListDepth - 1,
					$start.index(bulletListDepth - 1),
					taskListType,
				)
			) {
				return null;
			}
			const checked = (match[1] ?? " ").toLowerCase() === "x";

			const remainingInline = $start.parent.content.cut(
				end - $start.start($start.depth),
			);
			const updatedParagraph = paragraphType.create(null, remainingInline);

			const originalItem = bulletListNode.child(currentItemIndex);
			const updatedItemChildren = [updatedParagraph];
			for (let child = 1; child < originalItem.childCount; child += 1) {
				updatedItemChildren.push(originalItem.child(child));
			}
			const convertedTaskItem = taskItemType.create(
				{ checked },
				updatedItemChildren,
			);

			const beforeItems: ProseMirrorNode[] = [];
			const afterItems: ProseMirrorNode[] = [];
			for (let index = 0; index < bulletListNode.childCount; index += 1) {
				if (index < currentItemIndex) {
					beforeItems.push(bulletListNode.child(index));
				} else if (index > currentItemIndex) {
					afterItems.push(bulletListNode.child(index));
				}
			}

			const marker = sanitizeBulletMarker(bulletListNode.attrs.marker);
			const replacementBlocks: ProseMirrorNode[] = [];
			let cursorOffset = bulletListPos;
			if (beforeItems.length > 0) {
				const beforeList = bulletListType.create({ marker }, beforeItems);
				replacementBlocks.push(beforeList);
				cursorOffset += beforeList.nodeSize;
			}
			replacementBlocks.push(
				taskListType.create({ marker }, convertedTaskItem),
			);
			if (afterItems.length > 0) {
				replacementBlocks.push(bulletListType.create({ marker }, afterItems));
			}

			const tr = state.tr.replaceWith(
				bulletListPos,
				bulletListEnd,
				replacementBlocks,
			);
			tr.setSelection(TextSelection.create(tr.doc, cursorOffset + 3));
			return tr;
		},
		{ inCodeMark: false },
	);
}

function createCodeFenceSpaceRule(): InputRule {
	const paragraphType = visualEditorSchema.nodes.paragraph;
	const codeBlockType = visualEditorSchema.nodes.code_block;

	return new InputRule(
		/^(```|~~~)([a-zA-Z0-9_+#.-]*)\s$/,
		(
			state: EditorState,
			match: RegExpMatchArray,
			start: number,
			end: number,
		) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type !== paragraphType) return null;
			if (!isWholeParagraph($start, end)) return null;
			if (!canReplaceCurrentBlock($start, codeBlockType)) return null;
			const language = (match[2] ?? "").trim();
			const blockFrom = $start.before($start.depth);
			const blockTo = $start.after($start.depth);
			const codeBlock = codeBlockType.create({
				fenceChar: match[1] === "~~~" ? "~" : "`",
				fenceLength: 3,
				info: language,
				language,
			});
			const tr = state.tr.replaceWith(blockFrom, blockTo, codeBlock);
			tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
			return tr;
		},
		{ inCodeMark: false },
	);
}

function createHorizontalRuleRule(): InputRule {
	const paragraphType = visualEditorSchema.nodes.paragraph;
	const horizontalRuleType = visualEditorSchema.nodes.horizontal_rule;

	return new InputRule(
		/^(?:---|\*\*\*|___)\s$/,
		(
			state: EditorState,
			_match: RegExpMatchArray,
			start: number,
			end: number,
		) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type !== paragraphType) return null;
			if (!isWholeParagraph($start, end)) return null;
			if (!canReplaceCurrentBlock($start, horizontalRuleType)) return null;
			const blockFrom = $start.before($start.depth);
			const blockTo = $start.after($start.depth);
			const hrNode = horizontalRuleType.create();
			const nextParagraph = paragraphType.create();
			const tr = state.tr.replaceWith(blockFrom, blockTo, [
				hrNode,
				nextParagraph,
			]);
			// hrNode.nodeSize is 1, nextParagraph opens at blockFrom + 1, cursor inside at + 2.
			tr.setSelection(
				TextSelection.create(tr.doc, blockFrom + hrNode.nodeSize + 1),
			);
			return tr;
		},
		{ inCodeMark: false },
	);
}

/**
 * Applies the delimiter pair without rebuilding the matched text: the opening
 * delimiter is deleted, the closing delimiter is the keystroke that triggered
 * the rule (never inside the document), and the mark is added over the live
 * range. Links, nested marks, images, and protected inline atoms survive.
 */
function createInlineMarkRule(
	pattern: RegExp,
	markType: MarkType,
	delimiterLength: number,
): InputRule {
	return new InputRule(
		pattern,
		(
			state: EditorState,
			match: RegExpMatchArray,
			start: number,
			end: number,
			text: string,
		) => {
			const fullMatch = match[0];
			const innerText = match[1];
			if (!fullMatch || !innerText || innerText.length === 0) {
				return null;
			}
			const leadingPrefixLen =
				fullMatch.length - innerText.length - delimiterLength * 2;
			const contentFrom = start + Math.max(0, leadingPrefixLen);

			const $from = state.doc.resolve(contentFrom);
			if (!$from.parent.type.allowsMarkType(markType)) {
				return null;
			}

			// `prosemirror-inputrules` calls the handler before `text` is inserted:
			// `[replaceFrom, end]` is the (possibly non-empty) selection the text
			// replaces, and the closing delimiter may be partly or fully absent
			// from the document (`compositionend` passes `text === ""`).
			const replaceFrom = Math.max(
				start,
				start + fullMatch.length - text.length,
			);
			const closingInDocument = Math.max(0, delimiterLength - text.length);
			const insertPos = replaceFrom - closingInDocument;
			const insertedCore = text.slice(
				0,
				Math.max(0, text.length - delimiterLength),
			);
			const markedEnd = insertPos + insertedCore.length - delimiterLength;
			if (insertPos < contentFrom + delimiterLength) return null;
			if (markedEnd < contentFrom) return null;

			const tr = state.tr;
			if (insertedCore.length > 0) {
				const $insert = state.doc.resolve(insertPos);
				const marks =
					state.storedMarks ??
					(insertPos === end
						? $insert.marks()
						: ($insert.marksAcross(state.doc.resolve(end)) ?? $insert.marks()));
				tr.replaceWith(insertPos, end, state.schema.text(insertedCore, marks));
			} else if (insertPos < end) {
				tr.delete(insertPos, end);
			}
			tr.delete(contentFrom, contentFrom + delimiterLength);
			tr.addMark(contentFrom, markedEnd, markType.create());
			tr.setSelection(TextSelection.create(tr.doc, markedEnd));
			tr.removeStoredMark(markType);
			return tr;
		},
		{ inCode: false, inCodeMark: false },
	);
}

export function createVisualInputRulesPlugin(): Plugin {
	return inputRules({
		rules: [
			createHeadingRule(),
			createBlockquoteRule(),
			createDirectTaskListRule(),
			createBulletItemToTaskListRule(),
			createBulletListRule(),
			createOrderedListRule(),
			createCodeFenceSpaceRule(),
			createHorizontalRuleRule(),
			createInlineMarkRule(
				/(?:^|[^*\\])\*\*([^*\n]+)\*\*$/,
				visualEditorSchema.marks.strong,
				2,
			),
			createInlineMarkRule(
				/(?:^|[^*\\])\*([^*\n]+)\*$/,
				visualEditorSchema.marks.em,
				1,
			),
			createInlineMarkRule(
				/(?:^|[^~\\])~~([^~\n]+)~~$/,
				visualEditorSchema.marks.strike,
				2,
			),
			createInlineMarkRule(
				/(?:^|[^`\\])`([^`\n]+)`$/,
				visualEditorSchema.marks.code,
				1,
			),
		],
	});
}
