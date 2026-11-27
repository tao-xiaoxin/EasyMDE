import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import type { EditorSelection } from "./editor-context-menu-rules";
import {
	blockRangeWithTrailingTerminator,
	editorContextSelectionFitsRange
} from "./editor-context-menu-text-edit";
import { formatMarkdownTableSource } from "./editor-markdown-table-format";
import {
	editMarkdownTable,
	setMarkdownTableAlignment
} from "./editor-markdown-table-mutation";
import {
	type MarkdownTableOperation,
	prepareMarkdownTable,
	type PreparedMarkdownTable,
	tableSelectionAt
} from "./editor-markdown-table";

export type EditorTableActionPreflight =
	| Readonly<{
			prepared: PreparedMarkdownTable;
			status: "ready";
	  }>
	| Readonly<{
			code: "editor-context-menu-table-unavailable";
			status: "unavailable";
	  }>
	| Readonly<{
			code: "editor-context-menu-selection-outside-target";
			status: "outside-selection";
	  }>;

/**
 * The one authenticated table gate for every synchronous table action.
 *
 * It parses the table once, binds the exact source and parser-owned bounds,
 * and returns both the public metadata and the prepared context. Edit, copy,
 * format, and alignment then consume that same prepared context; no operation
 * parses the table again.
 */
export function prepareEditorTableAction(
	value: string,
	selection: EditorSelection,
	blockIndex?: EditorMarkdownBlockIndex
): EditorTableActionPreflight {
	const prepared = prepareMarkdownTable(value, selection.start, blockIndex);
	if (!prepared) {
		return {
			code: "editor-context-menu-table-unavailable",
			status: "unavailable"
		};
	}
	if (
		!editorContextSelectionFitsRange(
			selection,
			blockRangeWithTrailingTerminator(value, {
				from: prepared.context.tableStart,
				to: prepared.context.tableEnd
			})
		)
	) {
		return {
			code: "editor-context-menu-selection-outside-target",
			status: "outside-selection"
		};
	}
	return { prepared, status: "ready" };
}

export async function runTableContextMenuAction(
	id: string,
	session: EditorContextMenuActionSession
): Promise<void> {
	const { capabilities, captured, report } = session;
	const strings = capabilities.contextMenuStrings;
	if (!session.ensureCurrent()) return;
	const blockIndex = session.currentBlockIndex();
	if (null === blockIndex) {
		report(
			"editor-context-menu-block-index-unavailable",
			strings?.unsupported
		);
		return;
	}
	const value = session.readValue();
	const preflight = prepareEditorTableAction(
		value,
		captured.selection,
		blockIndex ?? undefined
	);
	if ("unavailable" === preflight.status) {
		report(preflight.code, strings?.unsupported);
		return;
	}
	if ("outside-selection" === preflight.status) {
		report(preflight.code, strings?.statusActionFailed);
		return;
	}
	const { prepared } = preflight;

	const tableOperationIds: Readonly<Record<string, MarkdownTableOperation["type"]>> = {
		"delete-column": "delete-column",
		"delete-row": "delete-row",
		"delete-table": "delete-table",
		"insert-column-left": "insert-column-left",
		"insert-column-right": "insert-column-right",
		"insert-row-above": "insert-row-above",
		"insert-row-below": "insert-row-below"
	};
	const operationType = tableOperationIds[id];
	if (operationType) {
		session.applyEdit(
			editMarkdownTable(
				value,
				captured.selection.start,
				{ type: operationType },
				blockIndex ?? undefined,
				prepared
			)
		);
		return;
	}

	if ("copy-table" === id) {
		const edit = editMarkdownTable(
			value,
			captured.selection.start,
			{ type: "copy-table" },
			blockIndex ?? undefined,
			prepared
		);
		if (!edit?.copiedText) {
			report(
				"editor-context-menu-table-unavailable",
				strings?.unsupported
			);
			return;
		}
		const result = await session.clipboard.write(edit.copiedText);
		if ("written" !== result.status) {
			report(result.code, strings?.statusClipboardUnavailable);
		}
		return;
	}

	if ("format-table-source" === id) {
		const edit = formatMarkdownTableSource(
			value,
			captured.selection,
			blockIndex ?? undefined,
			prepared
		);
		if (!edit) {
			report(
				"editor-context-menu-table-format-unavailable",
				strings?.unsupported
			);
			return;
		}
		session.applyEdit(edit);
		return;
	}

	if (["align-left", "align-center", "align-right"].includes(id)) {
		const edit = setMarkdownTableAlignment(
			value,
			captured.selection.start,
			{
				alignment: id.slice("align-".length) as "left" | "center" | "right",
				selection: tableSelectionAt(
					value,
					captured.selection,
					blockIndex ?? undefined,
					prepared
				) ?? { kind: "whole-table" }
			},
			captured.selection,
			blockIndex ?? undefined,
			prepared
		);
		if ("status" in edit) {
			report(edit.code, strings?.unsupported);
			return;
		}
		session.applyEdit(edit);
		return;
	}
}
