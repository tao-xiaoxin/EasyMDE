import type { EditorSelection } from "./editor-context-menu-rules";

export type EditorTextChange = Readonly<{
	from: number;
	insert: string;
	to: number;
}>;

export type EditorTextEdit = Readonly<{
	changes?: EditorTextChange;
	copiedText?: string;
	selection: EditorSelection;
	selectionFallback?: "caret" | "reflow-caret";
	value: string;
}>;

export function assertEditorSelection(
	selection: EditorSelection,
	value: string,
): void {
	if (
		!Number.isInteger(selection.start) ||
		!Number.isInteger(selection.end) ||
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end > value.length ||
		!["backward", "forward", "none"].includes(selection.direction)
	) {
		throw new Error("editor-context-menu-selection-invalid");
	}
}

/**
 * A selection that touches a target only through the block's own trailing line
 * terminator still belongs to that block.
 *
 * Parser-owned block ranges stop before the terminator, while a Visual surface
 * maps a whole-line selection past it. One policy serves both the context-menu
 * action gate and the non-action code-context preparation, so the same
 * selection is never admitted by one caller and rejected by another.
 */
export function blockRangeWithTrailingTerminator(
	source: string,
	range: Readonly<{ from: number; to: number }>,
): Readonly<{ from: number; to: number }> {
	const rest = source.slice(range.to, range.to + 2);
	const terminator = rest.startsWith("\r\n")
		? 2
		: rest.startsWith("\n") || rest.startsWith("\r")
			? 1
			: 0;
	return 0 === terminator ? range : { from: range.from, to: range.to + terminator };
}

export function editorContextSelectionFitsRange(
	selection: EditorSelection,
	range: Readonly<{ from: number; to: number }>,
): boolean {
	if (
		!selection ||
		!range ||
		!Number.isSafeInteger(range.from) ||
		!Number.isSafeInteger(range.to) ||
		range.from < 0 ||
		range.to < range.from ||
		!Number.isSafeInteger(selection.start) ||
		!Number.isSafeInteger(selection.end) ||
		selection.start < 0 ||
		selection.end < selection.start ||
		!["backward", "forward", "none"].includes(selection.direction)
	)
		return false;
	if (selection.start === selection.end) return true;
	return range.from <= selection.start && selection.end <= range.to;
}

export function createTextEdit(
	currentValue: string,
	nextValue: string,
	selection: EditorSelection,
	from: number,
	to: number,
): EditorTextEdit {
	assertEditorSelection(selection, nextValue);
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 0 ||
		to < from ||
		to > currentValue.length
	) {
		throw new Error("editor-context-menu-change-range-invalid");
	}
	const prefix = currentValue.slice(0, from);
	const suffix = currentValue.slice(to);
	if (!nextValue.startsWith(prefix) || !nextValue.endsWith(suffix)) {
		throw new Error("editor-context-menu-change-range-mismatch");
	}
	const insertEnd = nextValue.length - suffix.length;
	return {
		changes: { from, insert: nextValue.slice(from, insertEnd), to },
		selection,
		value: nextValue,
	};
}
