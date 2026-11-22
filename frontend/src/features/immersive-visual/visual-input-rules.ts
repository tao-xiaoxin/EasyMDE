import {
	InputRule,
	inputRules,
	textblockTypeInputRule,
	wrappingInputRule,
} from "prosemirror-inputrules";
import type { MarkType, Node as ProseMirrorNode } from "prosemirror-model";
import {
	type EditorState,
	type Plugin,
	TextSelection,
} from "prosemirror-state";
import { visualEditorSchema } from "./visual-schema";

function createHeadingRule(): InputRule {
	return textblockTypeInputRule(
		/^(#{1,6})\s$/,
		visualEditorSchema.nodes.heading,
		(match) => ({ level: (match[1] ?? "#").length }),
	);
}

function createBlockquoteRule(): InputRule {
	return wrappingInputRule(/^\s*>\s$/, visualEditorSchema.nodes.blockquote);
}

function createBulletListRule(): InputRule {
	return wrappingInputRule(
		/^\s*([-+*])\s$/,
		visualEditorSchema.nodes.bullet_list,
	);
}

function createOrderedListRule(): InputRule {
	return wrappingInputRule(
		/^(\d+)\.\s$/,
		visualEditorSchema.nodes.ordered_list,
		(match) => ({ order: Number.parseInt(match[1] ?? "1", 10) || 1 }),
		(match, node) =>
			node.childCount +
				(typeof node.attrs.order === "number" ? node.attrs.order : 1) ===
			(Number.parseInt(match[1] ?? "1", 10) || 1),
	);
}

function createDirectTaskListRule(): InputRule {
	return new InputRule(
		/^\s*[-+*]\s\[([ xX])\]\s$/,
		(
			state: EditorState,
			match: RegExpMatchArray,
			start: number,
			end: number,
		) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type !== visualEditorSchema.nodes.paragraph) {
				return null;
			}
			const checked = (match[1] ?? " ").toLowerCase() === "x";
			const blockFrom = $start.before($start.depth);
			const blockTo = $start.after($start.depth);
			const remainingContent = $start.parent.content.cut(
				end - $start.start($start.depth),
			);
			const paragraph = visualEditorSchema.nodes.paragraph.create(
				null,
				remainingContent,
			);
			const taskItem = visualEditorSchema.nodes.task_item.create(
				{ checked },
				paragraph,
			);
			const taskList = visualEditorSchema.nodes.task_list.create(
				null,
				taskItem,
			);

			const tr = state.tr.replaceWith(blockFrom, blockTo, taskList);
			// Position inside task_list (+1) -> task_item (+1) -> paragraph (+1)
			const cursorPos = blockFrom + 3;
			tr.setSelection(TextSelection.create(tr.doc, cursorPos));
			return tr;
		},
	);
}

function createBulletItemToTaskListRule(): InputRule {
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
				$start.parent.type !== visualEditorSchema.nodes.paragraph ||
				$start.node($start.depth - 1).type !==
					visualEditorSchema.nodes.list_item ||
				$start.node($start.depth - 2).type !==
					visualEditorSchema.nodes.bullet_list ||
				$start.index($start.depth - 1) !== 0
			) {
				return null;
			}

			const bulletListDepth = $start.depth - 2;
			const bulletListNode = $start.node(bulletListDepth);
			const bulletListPos = $start.before(bulletListDepth);
			const bulletListEnd = $start.after(bulletListDepth);
			const currentItemIndex = $start.index(bulletListDepth);
			const checked = (match[1] ?? " ").toLowerCase() === "x";

			const remainingInline = $start.parent.content.cut(
				end - $start.start($start.depth),
			);
			const updatedParagraph = visualEditorSchema.nodes.paragraph.create(
				null,
				remainingInline,
			);

			const originalItem = bulletListNode.child(currentItemIndex);
			const updatedItemChildren: ProseMirrorNode[] = [updatedParagraph];
			for (let c = 1; c < originalItem.childCount; c += 1) {
				updatedItemChildren.push(originalItem.child(c));
			}
			const convertedTaskItem = visualEditorSchema.nodes.task_item.create(
				{ checked },
				updatedItemChildren,
			);

			const replacementBlocks: ProseMirrorNode[] = [];
			const beforeItems: ProseMirrorNode[] = [];
			const afterItems: ProseMirrorNode[] = [];
			for (let i = 0; i < bulletListNode.childCount; i += 1) {
				if (i < currentItemIndex) {
					beforeItems.push(bulletListNode.child(i));
				} else if (i > currentItemIndex) {
					afterItems.push(bulletListNode.child(i));
				}
			}

			let cursorOffset = bulletListPos;
			if (beforeItems.length > 0) {
				const beforeList = visualEditorSchema.nodes.bullet_list.create(
					null,
					beforeItems,
				);
				replacementBlocks.push(beforeList);
				cursorOffset += beforeList.nodeSize;
			}
			replacementBlocks.push(
				visualEditorSchema.nodes.task_list.create(null, convertedTaskItem),
			);
			if (afterItems.length > 0) {
				replacementBlocks.push(
					visualEditorSchema.nodes.bullet_list.create(null, afterItems),
				);
			}

			const tr = state.tr.replaceWith(
				bulletListPos,
				bulletListEnd,
				replacementBlocks,
			);
			tr.setSelection(TextSelection.create(tr.doc, cursorOffset + 3));
			return tr;
		},
	);
}

function createCodeFenceSpaceRule(): InputRule {
	return new InputRule(
		/^(?:```|~~~)([a-zA-Z0-9_+#.-]*)\s$/,
		(state: EditorState, match: RegExpMatchArray, start: number) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type !== visualEditorSchema.nodes.paragraph) {
				return null;
			}
			const language = (match[1] ?? "").trim();
			const blockFrom = $start.before($start.depth);
			const blockTo = $start.after($start.depth);
			// Typed `~~~` shortcuts intentionally normalize to backtick fences.
			const codeBlock = visualEditorSchema.nodes.code_block.create({
				language,
				info: language,
				fenceChar: "`",
				fenceLength: 3,
			});
			const tr = state.tr.replaceWith(blockFrom, blockTo, codeBlock);
			tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
			return tr;
		},
	);
}

function createHorizontalRuleRule(): InputRule {
	return new InputRule(
		/^(?:---|\*\*\*|___)\s$/,
		(state: EditorState, _match: RegExpMatchArray, start: number) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type !== visualEditorSchema.nodes.paragraph) {
				return null;
			}
			const blockFrom = $start.before($start.depth);
			const blockTo = $start.after($start.depth);
			const hrNode = visualEditorSchema.nodes.horizontal_rule.create();
			const nextParagraph = visualEditorSchema.nodes.paragraph.create();
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
	);
}

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
		) => {
			const fullMatch = match[0];
			const innerText = match[1];
			if (!fullMatch || !innerText || innerText.length === 0) {
				return null;
			}
			const leadingPrefixLen =
				fullMatch.length - innerText.length - delimiterLength * 2;
			const markFrom = start + Math.max(0, leadingPrefixLen);

			const $from = state.doc.resolve(markFrom);
			if (!$from.parent.type.allowsMarkType(markType)) {
				return null;
			}

			const existingMarks = $from
				.marks()
				.filter((mark) => !markType.excludes(mark.type));
			const appliedMarks = markType.create().addToSet(existingMarks);
			const markedText = visualEditorSchema.text(innerText, appliedMarks);

			const tr = state.tr.replaceWith(markFrom, end, markedText);
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
