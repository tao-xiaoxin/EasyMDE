import {
	baseKeymap,
	chainCommands,
	createParagraphNear,
	deleteSelection,
	exitCode,
	joinBackward,
	joinForward,
	lift,
	liftEmptyBlock,
	newlineInCode,
	selectAll,
	selectNodeBackward,
	selectNodeForward,
	setBlockType,
	splitBlock,
	toggleMark,
	wrapIn,
} from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import {
	liftListItem,
	sinkListItem,
	splitListItem,
	wrapInList,
} from "prosemirror-schema-list";
import {
	type Command,
	type EditorState,
	NodeSelection,
	type Plugin,
	TextSelection,
	type Transaction,
} from "prosemirror-state";
import { goToNextCell, isInTable } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type { VisualToolbarCommandResult } from "../../contracts/visual-editor";
import { normalizeHeadingLevel, visualEditorSchema } from "./visual-schema";

const LIST_ITEM_TYPES: ReadonlyArray<NodeType> = [
	visualEditorSchema.nodes.list_item,
	visualEditorSchema.nodes.task_item,
];

function findAncestorDepth(state: EditorState, nodeType: NodeType): number | null {
	const { $from } = state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		if ($from.node(depth).type === nodeType) {
			return depth;
		}
	}
	return null;
}

function isSelectionInCodeBlock(state: EditorState): boolean {
	return state.selection.$from.parent.type === visualEditorSchema.nodes.code_block;
}

function insertHardBreakCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
	if (isSelectionInCodeBlock(state)) {
		return newlineInCode(state, dispatch);
	}
	const { $from } = state.selection;
	if (!$from.parent.canReplaceWith($from.index(), $from.index(), visualEditorSchema.nodes.hard_break)) {
		return false;
	}
	if (dispatch) {
		dispatch(
			state.tr.replaceSelectionWith(visualEditorSchema.nodes.hard_break.create()).scrollIntoView(),
		);
	}
	return true;
}

function convertFenceLineOnEnter(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	const { selection } = state;
	if (!selection.empty || selection.$from.parent.type !== visualEditorSchema.nodes.paragraph) {
		return false;
	}
	const match = /^(```|~~~)([a-zA-Z0-9_+#.-]*)[ \t]*$/.exec(selection.$from.parent.textContent);
	if (!match) {
		return false;
	}
	const language = (match[2] ?? "").trim();
	if (dispatch) {
		const blockFrom = selection.$from.before(selection.$from.depth);
		const blockTo = selection.$from.after(selection.$from.depth);
		// Typed `~~~` shortcuts normalize to backtick fences matching EasyMDE's rule.
		const codeBlock = visualEditorSchema.nodes.code_block.create({
			language,
			info: language,
			fenceChar: "`",
			fenceLength: 3,
		});
		const tr = state.tr.replaceWith(blockFrom, blockTo, codeBlock);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
		dispatch(tr.scrollIntoView());
	}
	return true;
}

function insertHardBreakInTableOnEnter(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return isInTable(state) ? insertHardBreakCommand(state, dispatch) : false;
}

function exitHeadingOnEnter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
	const { $from, $to } = state.selection;
	if ($from.parent.type !== visualEditorSchema.nodes.heading) {
		return false;
	}
	if ($from.sameParent($to) && $to.parentOffset === $from.parent.content.size) {
		if (dispatch) {
			const afterHeading = $from.after($from.depth);
			const tr = state.tr.insert(afterHeading, visualEditorSchema.nodes.paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, afterHeading + 1));
			dispatch(tr.scrollIntoView());
		}
		return true;
	}
	return splitBlock(state, dispatch);
}

function convertEmptyCodeBlockOnBackspace(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	const { selection } = state;
	const { $from } = selection;
	if (
		!selection.empty ||
		$from.parent.type !== visualEditorSchema.nodes.code_block ||
		$from.parent.content.size > 0 ||
		$from.parentOffset !== 0
	) {
		return false;
	}
	return setBlockType(visualEditorSchema.nodes.paragraph)(state, dispatch);
}

function convertHeadingToParagraphOnBackspace(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	const { selection } = state;
	if (
		!selection.empty ||
		selection.$from.parent.type !== visualEditorSchema.nodes.heading ||
		selection.$from.parentOffset !== 0
	) {
		return false;
	}
	return setBlockType(visualEditorSchema.nodes.paragraph)(state, dispatch);
}

function liftEmptyListOrQuoteOnBackspace(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	const { selection } = state;
	const { $from } = selection;
	if (!selection.empty || $from.parentOffset !== 0) {
		return false;
	}
	const itemDepth =
		findAncestorDepth(state, visualEditorSchema.nodes.task_item) ??
		findAncestorDepth(state, visualEditorSchema.nodes.list_item);
	if (itemDepth !== null && $from.index(itemDepth) === 0) {
		return liftListItem(LIST_ITEM_TYPES)(state, dispatch);
	}
	const quoteDepth = findAncestorDepth(state, visualEditorSchema.nodes.blockquote);
	if (quoteDepth !== null && $from.index(quoteDepth) === 0 && $from.parent.content.size === 0) {
		return lift(state, dispatch);
	}
	return false;
}

function selectAtomicBlockBackward(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	const { selection } = state;
	const { $from } = selection;
	if (!selection.empty || $from.parentOffset !== 0 || $from.depth < 1) {
		return false;
	}
	const blockBeforePos = $from.before($from.depth);
	const prevNode = state.doc.resolve(blockBeforePos).nodeBefore;
	if (
		!prevNode ||
		(prevNode.type !== visualEditorSchema.nodes.horizontal_rule &&
			prevNode.type !== visualEditorSchema.nodes.protected_block)
	) {
		return false;
	}
	if (dispatch) {
		const prevStart = blockBeforePos - prevNode.nodeSize;
		dispatch(state.tr.setSelection(NodeSelection.create(state.doc, prevStart)).scrollIntoView());
	}
	return true;
}

function preventDeleteAtEndOfCodeBlock(state: EditorState): boolean {
	const { selection } = state;
	return (
		selection.empty &&
		selection.$from.parent.type === visualEditorSchema.nodes.code_block &&
		selection.$from.parentOffset === selection.$from.parent.content.size
	);
}

function insertSpacesInCodeBlockOnTab(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	if (!isSelectionInCodeBlock(state)) {
		return false;
	}
	if (dispatch) {
		dispatch(state.tr.insertText("  ").scrollIntoView());
	}
	return true;
}

function toggleInlineMark(view: EditorView, markType: MarkType): VisualToolbarCommandResult {
	if (isSelectionInCodeBlock(view.state)) {
		return "blocked";
	}
	return toggleMark(markType)(view.state, view.dispatch) ? "handled" : "blocked";
}

function toggleBlockquoteCommand(view: EditorView): VisualToolbarCommandResult {
	const isQuoted = findAncestorDepth(view.state, visualEditorSchema.nodes.blockquote) !== null;
	const applied = isQuoted
		? lift(view.state, view.dispatch)
		: wrapIn(visualEditorSchema.nodes.blockquote)(view.state, view.dispatch);
	return applied ? "handled" : "blocked";
}

function convertListType(
	state: EditorState,
	listDepth: number,
	targetListType: NodeType,
	dispatch: (tr: Transaction) => void,
): boolean {
	const listPos = state.selection.$from.before(listDepth);
	const listEnd = state.selection.$from.after(listDepth);
	const listNode = state.doc.nodeAt(listPos);
	if (!listNode) {
		return false;
	}
	const targetItemType =
		targetListType === visualEditorSchema.nodes.task_list
			? visualEditorSchema.nodes.task_item
			: visualEditorSchema.nodes.list_item;

	const newItems: ProseMirrorNode[] = [];
	for (let i = 0; i < listNode.childCount; i += 1) {
		const item = listNode.child(i);
		const attrs =
			targetItemType === visualEditorSchema.nodes.task_item
				? { checked: Boolean(item.attrs.checked) }
				: null;
		newItems.push(targetItemType.create(attrs, item.content));
	}
	dispatch(state.tr.replaceWith(listPos, listEnd, targetListType.create(null, newItems)).scrollIntoView());
	return true;
}

function toggleListCommand(view: EditorView, targetListType: NodeType): VisualToolbarCommandResult {
	const { state } = view;
	if (findAncestorDepth(state, targetListType) !== null) {
		return liftListItem(LIST_ITEM_TYPES)(state, view.dispatch) ? "handled" : "blocked";
	}

	const listTypes: ReadonlyArray<NodeType> = [
		visualEditorSchema.nodes.bullet_list,
		visualEditorSchema.nodes.ordered_list,
		visualEditorSchema.nodes.task_list,
	];
	for (const existingType of listTypes) {
		const depth = findAncestorDepth(state, existingType);
		if (depth !== null) {
			return convertListType(state, depth, targetListType, view.dispatch) ? "handled" : "blocked";
		}
	}

	if (targetListType === visualEditorSchema.nodes.task_list) {
		const { $from } = state.selection;
		if ($from.depth < 1) {
			return "blocked";
		}
		const blockFrom = $from.before($from.depth);
		const blockTo = $from.after($from.depth);
		const paragraph = visualEditorSchema.nodes.paragraph.create(
			null,
			$from.parent.isTextblock ? $from.parent.content : undefined,
		);
		const taskList = visualEditorSchema.nodes.task_list.create(
			null,
			visualEditorSchema.nodes.task_item.create({ checked: false }, paragraph),
		);
		const tr = state.tr.replaceWith(blockFrom, blockTo, taskList);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + 3));
		view.dispatch(tr.scrollIntoView());
		return "handled";
	}

	return wrapInList(targetListType)(state, view.dispatch) ? "handled" : "blocked";
}

function insertBlockAtSelection(
	view: EditorView,
	nodes: ReadonlyArray<ProseMirrorNode>,
	cursorOffset: number,
): VisualToolbarCommandResult {
	const { state } = view;
	const { $from, empty } = state.selection;
	const isEmptyTopParagraph =
		empty &&
		$from.depth === 1 &&
		$from.parent.type === visualEditorSchema.nodes.paragraph &&
		$from.parent.content.size === 0;

	const insertPos = isEmptyTopParagraph ? $from.before(1) : $from.after(1);
	const tr = isEmptyTopParagraph
		? state.tr.replaceWith($from.before(1), $from.after(1), nodes)
		: state.tr.insert(insertPos, nodes);
	tr.setSelection(TextSelection.create(tr.doc, insertPos + cursorOffset));
	view.dispatch(tr.scrollIntoView());
	return "handled";
}

function insertCodeBlockCommand(view: EditorView): VisualToolbarCommandResult {
	const { state } = view;
	const { from, to, empty, $from } = state.selection;
	const selectedText = empty ? "" : state.doc.textBetween(from, to, "\n");
	const codeBlock = visualEditorSchema.nodes.code_block.create(
		{ language: "", info: "", fenceChar: "`", fenceLength: 3 },
		selectedText.length > 0 ? visualEditorSchema.text(selectedText) : null,
	);

	if (empty && $from.parent.type === visualEditorSchema.nodes.paragraph && $from.parent.content.size === 0) {
		const blockFrom = $from.before($from.depth);
		const tr = state.tr.replaceWith(blockFrom, $from.after($from.depth), codeBlock);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
		view.dispatch(tr.scrollIntoView());
		return "handled";
	}

	const tr = state.tr.replaceSelectionWith(codeBlock);
	const cursorPos = Math.max(1, tr.selection.from - codeBlock.nodeSize + 1);
	if (cursorPos < tr.doc.content.size) {
		tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
	}
	view.dispatch(tr.scrollIntoView());
	return "handled";
}

function insertMathBlockCommand(view: EditorView): VisualToolbarCommandResult {
	const { from, to, empty } = view.state.selection;
	const formula = empty ? "E = mc^2" : view.state.doc.textBetween(from, to, "\n").trim() || "E = mc^2";
	const mathNode = visualEditorSchema.nodes.protected_block.create({
		kind: "math",
		rawMarkdown: `$$\n${formula}\n$$`,
	});
	return insertBlockAtSelection(
		view,
		[mathNode, visualEditorSchema.nodes.paragraph.create()],
		mathNode.nodeSize + 1,
	);
}

function insertLinkCommand(view: EditorView, command: ToolbarCommand): VisualToolbarCommandResult {
	const { state } = view;
	if (isSelectionInCodeBlock(state)) {
		return "blocked";
	}
	const { from, to, empty } = state.selection;
	const linkMark = visualEditorSchema.marks.link.create({ href: "https://", title: null });
	if (!empty) {
		const hasLink = state.doc.rangeHasMark(from, to, visualEditorSchema.marks.link);
		const tr = hasLink
			? state.tr.removeMark(from, to, visualEditorSchema.marks.link)
			: state.tr.addMark(from, to, linkMark);
		view.dispatch(tr.scrollIntoView());
		return "handled";
	}
	const label = command.placeholder?.trim() || "link";
	const tr = state.tr.replaceSelectionWith(visualEditorSchema.text(label, [linkMark]), false);
	tr.setSelection(TextSelection.create(tr.doc, from, from + label.length));
	view.dispatch(tr.scrollIntoView());
	return "handled";
}

function insertImageCommand(view: EditorView, command: ToolbarCommand): VisualToolbarCommandResult {
	const { state } = view;
	if (isSelectionInCodeBlock(state)) {
		return "blocked";
	}
	const { from, to, empty } = state.selection;
	const alt = empty ? command.placeholder?.trim() || "image" : state.doc.textBetween(from, to, " ");
	const imageNode = visualEditorSchema.nodes.image.create({
		src: command.prefix?.trim() || "https://",
		alt,
		title: null,
		scale: null,
	});
	view.dispatch(state.tr.replaceSelectionWith(imageNode).scrollIntoView());
	return "handled";
}

function insertTableCommand(view: EditorView): VisualToolbarCommandResult {
	const headerCells = [0, 1, 2].map(() =>
		visualEditorSchema.nodes.table_header.create(null, visualEditorSchema.nodes.paragraph.create()),
	);
	const bodyCells = [0, 1, 2].map(() =>
		visualEditorSchema.nodes.table_cell.create(null, visualEditorSchema.nodes.paragraph.create()),
	);
	const tableNode = visualEditorSchema.nodes.table.create(null, [
		visualEditorSchema.nodes.table_row.create(null, headerCells),
		visualEditorSchema.nodes.table_row.create(null, bodyCells),
	]);
	// table (+1) -> row (+1) -> header (+1) -> paragraph (+1) = 4
	return insertBlockAtSelection(view, [tableNode], 4);
}

function insertHorizontalRuleCommand(view: EditorView): VisualToolbarCommandResult {
	const hrNode = visualEditorSchema.nodes.horizontal_rule.create();
	return insertBlockAtSelection(
		view,
		[hrNode, visualEditorSchema.nodes.paragraph.create()],
		hrNode.nodeSize + 1,
	);
}

function resolveWrapMark(command: ToolbarCommand): MarkType | null {
	const id = command.id.toLowerCase();
	const prefix = command.prefix ?? "";
	const suffix = command.suffix ?? "";
	if (id === "bold" || (prefix === "**" && suffix === "**")) {
		return visualEditorSchema.marks.strong;
	}
	if (id === "italic" || (prefix === "*" && suffix === "*") || (prefix === "_" && suffix === "_")) {
		return visualEditorSchema.marks.em;
	}
	if (id === "strike" || id === "strikethrough" || (prefix === "~~" && suffix === "~~")) {
		return visualEditorSchema.marks.strike;
	}
	if (id === "inlinecode" || id === "inline-code" || (prefix === "`" && suffix === "`")) {
		return visualEditorSchema.marks.code;
	}
	return null;
}

export function executeVisualToolbarCommand(
	view: EditorView,
	command: ToolbarCommand,
): VisualToolbarCommandResult {
	if (!view.editable) {
		return "blocked";
	}

	const { action } = command;
	if (action === "wrap") {
		const markType = resolveWrapMark(command);
		return markType ? toggleInlineMark(view, markType) : "unsupported";
	}

	const headingActionMatch = /^heading([1-6])$/.exec(action);
	if (headingActionMatch?.[1]) {
		const level = normalizeHeadingLevel(Number.parseInt(headingActionMatch[1], 10));
		return setBlockType(visualEditorSchema.nodes.heading, { level })(view.state, view.dispatch)
			? "handled"
			: "blocked";
	}

	switch (action) {
		case "bold":
			return toggleInlineMark(view, visualEditorSchema.marks.strong);
		case "italic":
			return toggleInlineMark(view, visualEditorSchema.marks.em);
		case "strikethrough":
		case "strike":
			return toggleInlineMark(view, visualEditorSchema.marks.strike);
		case "inlineCode":
			return toggleInlineMark(view, visualEditorSchema.marks.code);
		case "heading": {
			const level = normalizeHeadingLevel(command.level ?? 2);
			return setBlockType(visualEditorSchema.nodes.heading, { level })(view.state, view.dispatch)
				? "handled"
				: "blocked";
		}
		case "paragraph":
			return setBlockType(visualEditorSchema.nodes.paragraph)(view.state, view.dispatch)
				? "handled"
				: "blocked";
		case "quote":
			return toggleBlockquoteCommand(view);
		case "unorderedList":
			return toggleListCommand(view, visualEditorSchema.nodes.bullet_list);
		case "orderedList":
			return toggleListCommand(view, visualEditorSchema.nodes.ordered_list);
		case "taskList":
			return toggleListCommand(view, visualEditorSchema.nodes.task_list);
		case "codeFence":
		case "codeBlock":
			return insertCodeBlockCommand(view);
		case "mathBlock":
			return insertMathBlockCommand(view);
		case "link":
			return insertLinkCommand(view, command);
		case "image":
			return insertImageCommand(view, command);
		case "table":
			return insertTableCommand(view);
		case "horizontalRule":
			return insertHorizontalRuleCommand(view);
		case "undo":
			return undo(view.state, view.dispatch) ? "handled" : "blocked";
		case "redo":
			return redo(view.state, view.dispatch) ? "handled" : "blocked";
		default:
			return "unsupported";
	}
}

export function createVisualKeymapPlugins(): ReadonlyArray<Plugin> {
	const enterCommand: Command = chainCommands(
		convertFenceLineOnEnter,
		newlineInCode,
		insertHardBreakInTableOnEnter,
		splitListItem(visualEditorSchema.nodes.task_item, { checked: false }),
		splitListItem(visualEditorSchema.nodes.list_item),
		exitHeadingOnEnter,
		createParagraphNear,
		liftEmptyBlock,
		splitBlock,
	);

	const backspaceCommand: Command = chainCommands(
		deleteSelection,
		convertEmptyCodeBlockOnBackspace,
		convertHeadingToParagraphOnBackspace,
		liftEmptyListOrQuoteOnBackspace,
		selectAtomicBlockBackward,
		joinBackward,
		selectNodeBackward,
	);

	const deleteCommand: Command = chainCommands(
		deleteSelection,
		preventDeleteAtEndOfCodeBlock,
		joinForward,
		selectNodeForward,
	);

	const customBindings: Record<string, Command> = {
		"Mod-z": undo,
		"Mod-Shift-z": redo,
		"Mod-y": redo,
		"Mod-b": toggleMark(visualEditorSchema.marks.strong),
		"Mod-i": toggleMark(visualEditorSchema.marks.em),
		"Mod-a": selectAll,
		"Mod-Enter": exitCode,
		"Shift-Enter": insertHardBreakCommand,
		Enter: enterCommand,
		Backspace: backspaceCommand,
		Delete: deleteCommand,
		"Mod-Delete": deleteCommand,
		Tab: chainCommands(goToNextCell(1), insertSpacesInCodeBlockOnTab, sinkListItem(LIST_ITEM_TYPES)),
		"Shift-Tab": chainCommands(goToNextCell(-1), liftListItem(LIST_ITEM_TYPES)),
	};

	return [keymap(customBindings), keymap(baseKeymap)];
}
