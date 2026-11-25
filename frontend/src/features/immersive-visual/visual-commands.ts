import {
	baseKeymap,
	chainCommands,
	createParagraphNear,
	exitCode,
	lift,
	liftEmptyBlock,
	newlineInCode,
	selectAll,
	setBlockType,
	splitBlock,
	toggleMark,
	wrapIn,
} from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
	Fragment,
	type MarkType,
	type NodeType,
	type Node as ProseMirrorNode,
} from "prosemirror-model";
import {
	liftListItem,
	sinkListItem,
	splitListItem,
	wrapInList,
} from "prosemirror-schema-list";
import {
	type Command,
	type EditorState,
	type Plugin,
	TextSelection,
	type Transaction,
} from "prosemirror-state";
import { goToNextCell, isInTable } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type { VisualToolbarCommandResult } from "../../contracts/visual-editor";
import {
	createBoundaryKeyBindings,
	findInnermostDepth,
	indentInCodeBlockOnTab,
	isSelectionInCodeBlock,
	LIST_ITEM_TYPES,
	LIST_TYPES,
	outdentInCodeBlockOnShiftTab,
} from "./visual-boundary-commands";
import {
	createInternalLinkBoundaryKey,
	normalizeHeadingLevel,
	sanitizeBulletMarker,
	visualEditorSchema,
} from "./visual-schema";

const NODES = visualEditorSchema.nodes;
const MARKS = visualEditorSchema.marks;

const HORIZONTAL_RULE_LINE_PATTERN =
	/^[ \t]*(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * History commands injected by the host. The production visual editor binds
 * these to the canonical document's single history owner; standalone callers
 * fall back to `prosemirror-history`.
 */
export type VisualHistoryCommands = Readonly<{ redo: Command; undo: Command }>;

const DEFAULT_HISTORY_COMMANDS: VisualHistoryCommands = { redo, undo };

function canReplaceBlock(
	state: EditorState,
	nodes: ReadonlyArray<ProseMirrorNode>,
): boolean {
	const { $from } = state.selection;
	if ($from.depth < 1) return false;
	const parent = $from.node($from.depth - 1);
	const index = $from.index($from.depth - 1);
	return parent.canReplace(
		index,
		index + 1,
		Fragment.from(nodes as ProseMirrorNode[]),
	);
}

const insertHardBreakCommand: Command = (state, dispatch) => {
	if (isSelectionInCodeBlock(state)) {
		return newlineInCode(state, dispatch);
	}
	const { $from } = state.selection;
	if (
		$from.parent.type === NODES.heading ||
		!$from.parent.canReplaceWith($from.index(), $from.index(), NODES.hard_break)
	) {
		return false;
	}
	if (dispatch) {
		dispatch(
			state.tr.replaceSelectionWith(NODES.hard_break.create()).scrollIntoView(),
		);
	}
	return true;
};

const convertFenceLineOnEnter: Command = (state, dispatch) => {
	const { selection } = state;
	if (!selection.empty || selection.$from.parent.type !== NODES.paragraph) {
		return false;
	}
	const match = /^(```|~~~)([a-zA-Z0-9_+#.-]*)[ \t]*$/.exec(
		selection.$from.parent.textContent,
	);
	if (!match) {
		return false;
	}
	const language = (match[2] ?? "").trim();
	// The typed fence character is preserved (`~~~` stays a tilde fence).
	const codeBlock = NODES.code_block.create({
		language,
		info: language,
		fenceChar: match[1] === "~~~" ? "~" : "`",
		fenceLength: 3,
	});
	if (!canReplaceBlock(state, [codeBlock])) return false;
	if (dispatch) {
		const blockFrom = selection.$from.before(selection.$from.depth);
		const blockTo = selection.$from.after(selection.$from.depth);
		const tr = state.tr.replaceWith(blockFrom, blockTo, codeBlock);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
		dispatch(tr.scrollIntoView());
	}
	return true;
};

const convertHorizontalRuleOnEnter: Command = (state, dispatch) => {
	const { selection } = state;
	const { $from } = selection;
	if (
		!selection.empty ||
		$from.parent.type !== NODES.paragraph ||
		isInTable(state) ||
		$from.parent.childCount !== 1 ||
		!$from.parent.firstChild?.isText ||
		!HORIZONTAL_RULE_LINE_PATTERN.test($from.parent.textContent)
	) {
		return false;
	}
	const hr = NODES.horizontal_rule.create();
	const paragraph = NODES.paragraph.create();
	if (!canReplaceBlock(state, [hr, paragraph])) return false;
	if (dispatch) {
		const blockFrom = $from.before($from.depth);
		const tr = state.tr.replaceWith(blockFrom, $from.after($from.depth), [
			hr,
			paragraph,
		]);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + hr.nodeSize + 1));
		dispatch(tr.scrollIntoView());
	}
	return true;
};

const insertHardBreakInTableOnEnter: Command = (state, dispatch) => {
	return isInTable(state) ? insertHardBreakCommand(state, dispatch) : false;
};

const exitHeadingOnEnter: Command = (state, dispatch) => {
	const { $from, $to } = state.selection;
	if ($from.parent.type !== NODES.heading) {
		return false;
	}
	if ($from.sameParent($to) && $to.parentOffset === $from.parent.content.size) {
		if (dispatch) {
			const afterHeading = $from.after($from.depth);
			const tr = state.tr.insert(afterHeading, NODES.paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, afterHeading + 1));
			dispatch(tr.scrollIntoView());
		}
		return true;
	}
	return splitBlock(state, dispatch);
};

function toggleInlineMark(
	view: EditorView,
	markType: MarkType,
): VisualToolbarCommandResult {
	if (isSelectionInCodeBlock(view.state)) {
		return "blocked";
	}
	return toggleMark(markType)(view.state, view.dispatch)
		? "handled"
		: "blocked";
}

function toggleBlockquoteCommand(view: EditorView): VisualToolbarCommandResult {
	const isQuoted = findInnermostDepth(view.state, [NODES.blockquote]) !== null;
	const applied = isQuoted
		? lift(view.state, view.dispatch)
		: wrapIn(NODES.blockquote)(view.state, view.dispatch);
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
		targetListType === NODES.task_list ? NODES.task_item : NODES.list_item;
	const targetListAttrs =
		targetListType === NODES.bullet_list || targetListType === NODES.task_list
			? { marker: sanitizeBulletMarker(listNode.attrs.marker) }
			: null;

	const newItems: ProseMirrorNode[] = [];
	for (let i = 0; i < listNode.childCount; i += 1) {
		const item = listNode.child(i);
		const attrs =
			targetItemType === NODES.task_item
				? { checked: Boolean(item.attrs.checked) }
				: null;
		newItems.push(targetItemType.create(attrs, item.content));
	}
	const { from, to } = state.selection;
	const tr = state.tr.replaceWith(
		listPos,
		listEnd,
		targetListType.create(targetListAttrs, newItems),
	);
	try {
		tr.setSelection(
			TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)),
		);
	} catch {
		// Keep ProseMirror's mapped selection.
	}
	dispatch(tr.scrollIntoView());
	return true;
}

function toggleListCommand(
	view: EditorView,
	targetListType: NodeType,
): VisualToolbarCommandResult {
	const { state } = view;
	if (isInTable(state)) return "blocked";
	const listDepth = findInnermostDepth(state, LIST_TYPES);
	if (listDepth !== null) {
		if (state.selection.$from.node(listDepth).type === targetListType) {
			return liftListItem(LIST_ITEM_TYPES)(state, view.dispatch)
				? "handled"
				: "blocked";
		}
		return convertListType(state, listDepth, targetListType, view.dispatch)
			? "handled"
			: "blocked";
	}

	if (targetListType === NODES.task_list) {
		const { $from } = state.selection;
		if ($from.depth < 1 || !$from.parent.isTextblock) {
			return "blocked";
		}
		const blockFrom = $from.before($from.depth);
		const blockTo = $from.after($from.depth);
		const paragraph = NODES.paragraph.create(
			null,
			$from.parent.isTextblock ? $from.parent.content : undefined,
		);
		const taskList = NODES.task_list.create(
			null,
			NODES.task_item.create({ checked: false }, paragraph),
		);
		if (!canReplaceBlock(state, [taskList])) return "blocked";
		const tr = state.tr.replaceWith(blockFrom, blockTo, taskList);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + 3));
		view.dispatch(tr.scrollIntoView());
		return "handled";
	}

	return wrapInList(targetListType)(state, view.dispatch)
		? "handled"
		: "blocked";
}

function insertBlockAtSelection(
	view: EditorView,
	nodes: ReadonlyArray<ProseMirrorNode>,
	cursorOffset: number,
): VisualToolbarCommandResult {
	const { state } = view;
	if (isInTable(state)) return "blocked";
	const { $from, empty } = state.selection;
	const isEmptyTopParagraph =
		empty &&
		$from.depth === 1 &&
		$from.parent.type === NODES.paragraph &&
		$from.parent.content.size === 0;

	const insertPos =
		$from.depth === 0
			? $from.pos
			: isEmptyTopParagraph
				? $from.before(1)
				: $from.after(1);
	const $insert = state.doc.resolve(insertPos);
	const fragment = Fragment.from(nodes as ProseMirrorNode[]);
	const index = $insert.index(0);
	if (
		!state.doc.canReplace(
			index,
			isEmptyTopParagraph ? index + 1 : index,
			fragment,
		)
	) {
		return "blocked";
	}
	const tr = isEmptyTopParagraph
		? state.tr.replaceWith($from.before(1), $from.after(1), nodes)
		: state.tr.insert(insertPos, nodes);
	tr.setSelection(TextSelection.create(tr.doc, insertPos + cursorOffset));
	view.dispatch(tr.scrollIntoView());
	return "handled";
}

function insertCodeBlockCommand(view: EditorView): VisualToolbarCommandResult {
	const { state } = view;
	if (isInTable(state)) return "blocked";
	const { from, to, empty, $from } = state.selection;
	const selectedText = empty ? "" : state.doc.textBetween(from, to, "\n");
	const codeBlock = NODES.code_block.create(
		{ language: "", info: "", fenceChar: "`", fenceLength: 3 },
		selectedText.length > 0 ? visualEditorSchema.text(selectedText) : null,
	);

	if (
		empty &&
		$from.parent.type === NODES.paragraph &&
		$from.parent.content.size === 0
	) {
		if (!canReplaceBlock(state, [codeBlock])) return "blocked";
		const blockFrom = $from.before($from.depth);
		const tr = state.tr.replaceWith(
			blockFrom,
			$from.after($from.depth),
			codeBlock,
		);
		tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
		view.dispatch(tr.scrollIntoView());
		return "handled";
	}

	if ($from.depth < 1) return "blocked";
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
	const formula = empty
		? "E = mc^2"
		: view.state.doc.textBetween(from, to, "\n").trim() || "E = mc^2";
	const mathNode = NODES.protected_block.create({
		kind: "math",
		rawMarkdown: `$$\n${formula}\n$$`,
	});
	return insertBlockAtSelection(
		view,
		[mathNode, NODES.paragraph.create()],
		mathNode.nodeSize + 1,
	);
}

function insertLinkCommand(
	view: EditorView,
	command: ToolbarCommand,
): VisualToolbarCommandResult {
	const { state } = view;
	if (isSelectionInCodeBlock(state)) {
		return "blocked";
	}
	const { from, to, empty } = state.selection;
	const linkMark = MARKS.link.create({
		boundaryKey: createInternalLinkBoundaryKey(),
		href: "https://",
		title: null,
	});
	if (!empty) {
		const hasLink = state.doc.rangeHasMark(from, to, MARKS.link);
		const tr = hasLink
			? state.tr.removeMark(from, to, MARKS.link)
			: state.tr.addMark(from, to, linkMark);
		view.dispatch(tr.scrollIntoView());
		return "handled";
	}
	const label = command.placeholder?.trim() || "link";
	const tr = state.tr.replaceSelectionWith(
		visualEditorSchema.text(label, [linkMark]),
		false,
	);
	// Derive the label range from the mapped caret: from a GapCursor at pos 0
	// the inserted text lands inside a new paragraph, not at `from`.
	const labelEnd = tr.selection.from;
	const labelStart = Math.max(1, labelEnd - label.length);
	tr.setSelection(TextSelection.create(tr.doc, labelStart, labelEnd));
	view.dispatch(tr.scrollIntoView());
	return "handled";
}

function insertImageCommand(
	view: EditorView,
	command: ToolbarCommand,
): VisualToolbarCommandResult {
	const { state } = view;
	if (isSelectionInCodeBlock(state)) {
		return "blocked";
	}
	const { from, to, empty } = state.selection;
	const alt = empty
		? command.placeholder?.trim() || "image"
		: state.doc.textBetween(from, to, " ");
	const imageNode = NODES.image.create({
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
		NODES.table_header.create(null, NODES.paragraph.create()),
	);
	const bodyCells = [0, 1, 2].map(() =>
		NODES.table_cell.create(null, NODES.paragraph.create()),
	);
	const tableNode = NODES.table.create(null, [
		NODES.table_row.create(null, headerCells),
		NODES.table_row.create(null, bodyCells),
	]);
	// table (+1) -> row (+1) -> header (+1) -> paragraph (+1) = 4
	return insertBlockAtSelection(view, [tableNode], 4);
}

function insertHorizontalRuleCommand(
	view: EditorView,
): VisualToolbarCommandResult {
	const hrNode = NODES.horizontal_rule.create();
	return insertBlockAtSelection(
		view,
		[hrNode, NODES.paragraph.create()],
		hrNode.nodeSize + 1,
	);
}

function resolveWrapMark(command: ToolbarCommand): MarkType | null {
	const id = command.id.toLowerCase();
	const prefix = command.prefix ?? "";
	const suffix = command.suffix ?? "";
	if (id === "bold" || (prefix === "**" && suffix === "**")) {
		return MARKS.strong;
	}
	if (
		id === "italic" ||
		(prefix === "*" && suffix === "*") ||
		(prefix === "_" && suffix === "_")
	) {
		return MARKS.em;
	}
	if (
		id === "strike" ||
		id === "strikethrough" ||
		(prefix === "~~" && suffix === "~~")
	) {
		return MARKS.strike;
	}
	if (
		id === "inlinecode" ||
		id === "inline-code" ||
		(prefix === "`" && suffix === "`")
	) {
		return MARKS.code;
	}
	return null;
}

function setTextblockType(
	view: EditorView,
	nodeType: NodeType,
	attrs?: Record<string, unknown>,
): VisualToolbarCommandResult {
	if (setBlockType(nodeType, attrs)(view.state, view.dispatch))
		return "handled";
	const { $from, $to } = view.state.selection;
	const parent = $from.parent;
	return $from.sameParent($to) &&
		parent.isTextblock &&
		parent.hasMarkup(nodeType, attrs ?? parent.attrs)
		? "handled"
		: "blocked";
}

export function executeVisualToolbarCommand(
	view: EditorView,
	command: ToolbarCommand,
	history: VisualHistoryCommands = DEFAULT_HISTORY_COMMANDS,
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
		const level = normalizeHeadingLevel(
			Number.parseInt(headingActionMatch[1], 10),
		);
		return setTextblockType(view, NODES.heading, { level });
	}

	switch (action) {
		case "bold":
			return toggleInlineMark(view, MARKS.strong);
		case "italic":
			return toggleInlineMark(view, MARKS.em);
		case "strikethrough":
		case "strike":
			return toggleInlineMark(view, MARKS.strike);
		case "inlineCode":
			return toggleInlineMark(view, MARKS.code);
		case "heading": {
			const level = normalizeHeadingLevel(command.level ?? 2);
			return setTextblockType(view, NODES.heading, {
				level,
			});
		}
		case "paragraph":
			return setTextblockType(view, NODES.paragraph);
		case "quote":
			return toggleBlockquoteCommand(view);
		case "unorderedList":
			return toggleListCommand(view, NODES.bullet_list);
		case "orderedList":
			return toggleListCommand(view, NODES.ordered_list);
		case "taskList":
			return toggleListCommand(view, NODES.task_list);
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
			return history.undo(view.state, view.dispatch, view)
				? "handled"
				: "blocked";
		case "redo":
			return history.redo(view.state, view.dispatch, view)
				? "handled"
				: "blocked";
		default:
			return "unsupported";
	}
}

export function createVisualKeymapPlugins(
	history: VisualHistoryCommands = DEFAULT_HISTORY_COMMANDS,
): ReadonlyArray<Plugin> {
	const enterCommand: Command = chainCommands(
		convertFenceLineOnEnter,
		convertHorizontalRuleOnEnter,
		newlineInCode,
		insertHardBreakInTableOnEnter,
		splitListItem(NODES.task_item, { checked: false }),
		splitListItem(NODES.list_item),
		exitHeadingOnEnter,
		createParagraphNear,
		liftEmptyBlock,
		splitBlock,
	);

	const customBindings: Record<string, Command> = {
		"Mod-z": history.undo,
		"Mod-Shift-z": history.redo,
		"Mod-y": history.redo,
		"Mod-b": toggleMark(MARKS.strong),
		"Mod-i": toggleMark(MARKS.em),
		"Mod-`": (state, dispatch) =>
			!isSelectionInCodeBlock(state) && toggleMark(MARKS.code)(state, dispatch),
		"Mod-a": selectAll,
		"Mod-Enter": exitCode,
		"Shift-Enter": chainCommands(insertHardBreakCommand, exitHeadingOnEnter),
		Enter: enterCommand,
		...createBoundaryKeyBindings(),
		Tab: chainCommands(
			goToNextCell(1),
			indentInCodeBlockOnTab,
			sinkListItem(LIST_ITEM_TYPES),
		),
		"Shift-Tab": chainCommands(
			goToNextCell(-1),
			outdentInCodeBlockOnShiftTab,
			liftListItem(LIST_ITEM_TYPES),
		),
	};

	return [keymap(customBindings), keymap(baseKeymap)];
}
