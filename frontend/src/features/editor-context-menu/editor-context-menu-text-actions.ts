import { cutEditorSelection } from "./editor-context-menu-clipboard";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { contextMenuActionErrorCode } from "./editor-context-menu-action-errors";
import {
	deleteThematicBreak,
	findMarkdownBlock,
	insertParagraphRelative
} from "./editor-context-menu-rules";
import { editorContextSelectionFitsRange } from "./editor-context-menu-text-edit";
import { createSimplifiedFormattingPayload } from "./editor-simplified-formatting";

/**
 * Text, Clipboard, and block-insertion actions. The final canonical write stays
 * with the session's Root capability; this module only owns the action policy.
 */
export async function runTextContextMenuAction(
	id: string,
	session: EditorContextMenuActionSession
): Promise<void> {
	const {
		actionContext,
		capabilities,
		captured,
		ensureCurrent,
		ensureSelectionFitsTarget,
		report
	} = session;
	const strings = capabilities.contextMenuStrings;
	const clipboard = session.clipboard;

	if ("bold" === id) {
		if (!ensureCurrent()) return;
		if ("visual" === captured.surface) {
			const command = capabilities.toolbar.commands.find(
				({ id: commandId }) => commandId === "bold"
			);
			if (!command) {
				report(
					"editor-context-menu-command-unavailable",
					strings?.statusActionFailed
				);
				return;
			}
			if (captured.selection.start !== captured.selection.end) {
				const blockIndex = session.currentBlockIndex();
				const block = findMarkdownBlock(
					captured.value,
					captured.selection.start,
					blockIndex ?? undefined
				);
				const selectionSpansBlocks = !block || !editorContextSelectionFitsRange(
					captured.selection,
					{ from: block.start, to: block.end }
				);
				if (selectionSpansBlocks) {
					const prefix = command.prefix ?? "";
					const suffix = command.suffix ?? "";
					const selected = captured.value.slice(
						captured.selection.start,
						captured.selection.end
					);
					const nextValue =
						captured.value.slice(0, captured.selection.start)
						+ prefix
						+ selected
						+ suffix
						+ captured.value.slice(captured.selection.end);
					capabilities.visual.applyCanonicalChange(captured, {
						changes: {
							from: captured.selection.start,
							insert: `${prefix}${selected}${suffix}`,
							to: captured.selection.end
						},
						selection: {
							direction: "none",
							end: captured.selection.start
								+ prefix.length
								+ selected.length
								+ suffix.length,
							start: captured.selection.start
								+ prefix.length
								+ selected.length
								+ suffix.length
						},
						selectionFallback: "caret",
						value: nextValue
					});
					return;
				}
			}
			const result = capabilities.visual.executeCommand(command, {
				requestPreviewTransfer: true
			});
			if ("handled" === result) return;
			report(
				"unavailable" === result
					? "editor-context-menu-command-unavailable"
					: "editor-context-menu-command-failed",
				strings?.statusActionFailed
			);
			return;
		}
		if (!capabilities.toolbar.execute("bold")) {
			report(
				"editor-context-menu-command-unavailable",
				strings?.statusActionFailed
			);
		}
		return;
	}

	if (
		capabilities.toolbar.commands.some((command) =>
			command.id === id
			&& "heading-menu" === command.surface
			&& "heading" === command.action
		)
	) {
		if (!ensureCurrent()) return;
		if (!capabilities.toolbar.execute(id)) {
			report(
				"editor-context-menu-command-unavailable",
				strings?.statusActionFailed
			);
		}
		return;
	}

	if (["copy", "copy-as-markdown"].includes(id)) {
		if (!ensureCurrent()) return;
		const text = captured.value.slice(
			captured.selection.start,
			captured.selection.end
		);
		const result = await clipboard.write(text);
		if ("written" !== result.status) {
			report(result.code, strings?.statusClipboardUnavailable);
		}
		return;
	}

	if ("copy-as-html" === id) {
		if (!ensureCurrent()) return;
		if (!clipboard.writeDeferred) {
			report(
				"editor-context-menu-clipboard-deferred-unsupported",
				strings?.statusClipboardUnavailable
			);
			return;
		}
		const markdown = captured.value.slice(
			captured.selection.start,
			captured.selection.end
		);
		const operation = session.beginOperation();
		const controller = operation.controller;
		try {
			const renderedHtml = capabilities.preview
				.render(markdown, controller.signal)
				.then((response) => response.html);
			const writePromise = clipboard.writeDeferred(renderedHtml, {
				signal: controller.signal
			});
			const [, result] = await Promise.all([renderedHtml, writePromise]);
			if (!ensureCurrent()) return;
			if ("written" !== result.status) {
				report(result.code, strings?.statusClipboardUnavailable);
			}
		} catch (error) {
			report(
				contextMenuActionErrorCode(error, "editor-context-menu-html-copy-failed"),
				strings?.statusActionFailed
			);
		} finally {
			session.finishOperation(operation);
		}
		return;
	}

	if ("copy-simplified-formatting" === id) {
		if (!ensureCurrent()) return;
		if (!clipboard.writeRichDeferred || !capabilities.simplifiedFormattingParser) {
			report(
				"editor-context-menu-rich-clipboard-unsupported",
				strings?.statusClipboardUnavailable
			);
			return;
		}
		const markdown = captured.value.slice(
			captured.selection.start,
			captured.selection.end
		);
		const operation = session.beginOperation();
		const controller = operation.controller;
		const parser = capabilities.simplifiedFormattingParser;
		const payload = capabilities.preview
			.render(markdown, controller.signal)
			.then((response) => {
				if (controller.signal.aborted || !session.isCurrent(captured)) {
					throw new Error("editor-context-menu-context-stale");
				}
				const converted = createSimplifiedFormattingPayload(response.html, {
					parser
				});
				if ("failed" === converted.status) throw new Error(converted.code);
				return converted.payload;
			});
		void payload.catch(() => undefined);
		try {
			const result = await clipboard.writeRichDeferred(payload, {
				signal: controller.signal
			});
			if (!ensureCurrent()) return;
			if ("written" !== result.status) {
				report(result.code, strings?.statusClipboardUnavailable);
			}
		} catch (error) {
			report(
				contextMenuActionErrorCode(error, "editor-context-menu-rich-copy-failed"),
				strings?.statusActionFailed
			);
		} finally {
			session.finishOperation(operation);
		}
		return;
	}

	if ("cut" === id) {
		if (!ensureCurrent()) return;
		// Both surfaces share one cut transaction: the helper owns the
		// clipboard write and the staleness check, and the surface-aware
		// `applyEdit` owns the deletion, so neither branch rebuilds the edit.
		const operation = session.beginOperation();
		try {
			const result = await cutEditorSelection({
				captured,
				clipboard,
				deleteSelection: () => {
					const value = session.readValue();
					const position = captured.selection.start;
					const applied = session.applyEdit({
						changes: {
							from: captured.selection.start,
							insert: "",
							to: captured.selection.end
						},
						selection: {
							direction: "none",
							end: position,
							start: position
						},
						value:
							value.slice(0, captured.selection.start)
							+ value.slice(captured.selection.end)
					});
					if (!applied) throw new Error("editor-context-menu-edit-unavailable");
				},
				getCurrentContext: () =>
					session.document.getCurrentContext(captured.surface),
				signal: operation.controller.signal
			});
			if ("cut" !== result.status && !operation.controller.signal.aborted) {
				report(result.code, strings?.statusActionFailed);
			}
		} finally {
			session.finishOperation(operation);
		}
		return;
	}

	if (["paste", "paste-plain-text"].includes(id)) {
		if (!ensureCurrent()) return;
		const operation = session.beginOperation();
		try {
			const result = await clipboard.read({
				signal: operation.controller.signal
			});
			if (operation.controller.signal.aborted || !ensureCurrent()) return;
			if ("available" !== result.status) {
				report(
					"code" in result
						? result.code
						: "editor-context-menu-clipboard-empty",
					strings?.statusClipboardUnavailable
				);
				return;
			}
			session.finishOperation(operation);
			const value = session.readValue();
			// The migration below is the same canonical write for both
			// surfaces; only Root's capability decides how it lands.
			session.applyEdit({
				changes: {
					from: captured.selection.start,
					insert: result.text,
					to: captured.selection.end
				},
				selection: {
					direction: "none",
					end: captured.selection.start + result.text.length,
					start: captured.selection.start + result.text.length
				},
				value:
					value.slice(0, captured.selection.start)
					+ result.text
					+ value.slice(captured.selection.end)
			});
		} finally {
			session.finishOperation(operation);
		}
		return;
	}

	if (
		[
			"insert-paragraph-above",
			"insert-paragraph-below",
			"insert-paragraph-above-code",
			"insert-paragraph-below-code",
			"insert-paragraph-above-table",
			"insert-paragraph-below-table"
		].includes(id)
	) {
		if (!ensureCurrent()) return;
		const blockIndex = session.currentBlockIndex();
		if (null === blockIndex) {
			report(
				"editor-context-menu-block-index-unavailable",
				strings?.unsupported
			);
			return;
		}
		const value = session.readValue();
		const block = findMarkdownBlock(
			value,
			captured.selection.start,
			blockIndex ?? undefined
		);
		const codeTarget = actionContext?.code?.target;
		const codeRelative = id.includes("-code");
		const targetRange = codeRelative
			? codeTarget
				? { from: codeTarget.from, to: codeTarget.to }
				: null
			: block
				? { from: block.start, to: block.end }
				: null;
		if (!targetRange) {
			report(
				"editor-context-menu-block-unavailable",
				strings?.unsupported
			);
			return;
		}
		if (!ensureSelectionFitsTarget(targetRange)) return;
		session.applyEdit(
			insertParagraphRelative(
				value,
				captured.selection,
				id.includes("above") ? "before" : "after",
				blockIndex,
				codeRelative ? codeTarget : undefined
			)
		);
		return;
	}

	if ("insert-table-above" === id || "insert-table-below" === id) {
		if (!ensureCurrent()) return;
		capabilities.media.requestTableInsertion(
			captured,
			"insert-table-above" === id ? "above" : "below"
		);
		return;
	}

	if ("insert-image-above" === id || "insert-image-below" === id) {
		if (!ensureCurrent()) return;
		const value = session.readValue();
		const blockIndex = session.currentBlockIndex();
		const block = findMarkdownBlock(
			value,
			captured.selection.start,
			blockIndex ?? undefined
		);
		if (!block) {
			report(
				"editor-context-menu-insertion-target-unavailable",
				strings?.unsupported
			);
			return;
		}
		const direction = "insert-image-above" === id ? "above" : "below";
		capabilities.media.openInsertion(
			captured,
			block,
			direction
		);
		return;
	}

	if ("delete-thematic-break" === id) {
		if (!ensureCurrent()) return;
		const blockIndex = session.currentBlockIndex();
		if (null === blockIndex) {
			report(
				"editor-context-menu-block-index-unavailable",
				strings?.unsupported
			);
			return;
		}
		const value = session.readValue();
		const block = findMarkdownBlock(
			value,
			captured.selection.start,
			blockIndex ?? undefined
		);
		if ("thematic-break" !== block?.kind) {
			report(
				"editor-context-menu-thematic-break-unavailable",
				strings?.unsupported
			);
			return;
		}
		if (!ensureSelectionFitsTarget({ from: block.start, to: block.end })) return;
		session.applyEdit(
			deleteThematicBreak(value, captured.selection, blockIndex ?? undefined)
		);
		return;
	}

	if ("copy-link-address" === id) {
		if (!actionContext?.link || !ensureCurrent()) return;
		const result = await clipboard.write(actionContext.link.href);
		if (!ensureCurrent()) return;
		if ("written" !== result.status) {
			report(result.code, strings?.statusClipboardUnavailable);
		}
		return;
	}

	return;
}
