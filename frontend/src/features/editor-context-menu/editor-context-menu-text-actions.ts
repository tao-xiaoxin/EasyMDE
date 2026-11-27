import type { EditorCodeContentTarget } from "./editor-code-content-target";
import {
	createSimpleBoldWrapEdit,
	planSourceBoldSelection
} from "./editor-context-menu-bold";
import { cutEditorSelection } from "./editor-context-menu-clipboard";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { contextMenuActionErrorCode } from "./editor-context-menu-action-errors";
import {
	deleteThematicBreak,
	type EditorSelection,
	findMarkdownBlock,
	insertParagraphRelative
} from "./editor-context-menu-rules";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import { createSimplifiedFormattingPayload } from "./editor-simplified-formatting";

export type InsertParagraphRelativeActionOptions = Readonly<{
	blockIndex: EditorMarkdownBlockIndex | undefined;
	codeTarget?: EditorCodeContentTarget;
	nestedCode?: boolean;
	relative: "after" | "before";
	selection: EditorSelection;
	targetRange: Readonly<{ from: number; to: number }>;
	value: string;
}>;

/**
 * Shared paragraph-insertion dispatcher for both text/code/table and
 * generated-content actions. Visual delegates to the Visual runtime first so
 * live empty paragraphs stay editable, falling back to canonical edit only
 * when the runtime reports `"unavailable"`.
 */
export function insertParagraphRelativeAction(
	session: EditorContextMenuActionSession,
	options: InsertParagraphRelativeActionOptions
): void {
	const { capabilities, captured, report } = session;
	const strings = capabilities.contextMenuStrings;
	if ("visual" === captured.surface) {
		const visualResult = capabilities.visual.insertParagraphRelative(
			captured,
			{
				...(options.nestedCode ? { nestedCode: true } : {}),
				relative: options.relative,
				targetRange: options.targetRange
			}
		);
		if ("handled" === visualResult) return;
		if ("failed" === visualResult) {
			report(
				"editor-context-menu-edit-unavailable",
				strings?.statusActionFailed
			);
			return;
		}
	}
	session.applyEdit(
		insertParagraphRelative(
			options.value,
			options.selection,
			options.relative,
			options.blockIndex,
			options.codeTarget
		)
	);
}

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
		const command = capabilities.toolbar.commands.find(
			({ id: commandId }) => commandId === "bold"
		);
		const boldOptions = {
			...(command?.prefix ? { prefix: command.prefix } : {}),
			...(undefined !== capabilities.referenceLabelCaseFoldProfile
				? {
						referenceLabelCaseFoldProfile:
							capabilities.referenceLabelCaseFoldProfile
					}
				: {}),
			...(command?.suffix ? { suffix: command.suffix } : {})
		};
		if ("visual" === captured.surface) {
			if (!command) {
				report(
					"editor-context-menu-command-unavailable",
					strings?.statusActionFailed
				);
				return;
			}
			if (captured.selection.start !== captured.selection.end) {
				const plan = planSourceBoldSelection(
					captured.value,
					captured.selection,
					boldOptions
				);
				if ("unavailable" === plan.kind) {
					report(
						"editor-context-menu-command-unavailable",
						strings?.statusActionFailed
					);
					return;
				}
				const edit =
					"edit" === plan.kind
						? plan.edit
						: createSimpleBoldWrapEdit(
								captured.value,
								captured.selection,
								boldOptions
							);
				if (!edit) {
					report(
						"editor-context-menu-command-unavailable",
						strings?.statusActionFailed
					);
					return;
				}
				session.applyEdit(edit);
				return;
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
		if (captured.selection.start !== captured.selection.end) {
			const value = session.readValue();
			const plan = planSourceBoldSelection(
				value,
				captured.selection,
				boldOptions
			);
			if ("unavailable" === plan.kind) {
				report(
					"editor-context-menu-command-unavailable",
					strings?.statusActionFailed
				);
				return;
			}
			if ("edit" === plan.kind) {
				session.applyEdit(plan.edit);
				return;
			}
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
		const relative = id.includes("above") ? "before" : "after";
		insertParagraphRelativeAction(session, {
			blockIndex,
			...(codeRelative && codeTarget ? { codeTarget } : {}),
			...(codeRelative ? { nestedCode: true } : {}),
			relative,
			selection: captured.selection,
			targetRange,
			value
		});
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
