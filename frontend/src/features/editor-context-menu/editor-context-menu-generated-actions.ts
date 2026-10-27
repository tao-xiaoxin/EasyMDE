import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { insertParagraphRelative } from "./editor-context-menu-rules";

/**
 * Generated-content actions. Their lease is issued and released by the
 * context-menu feature; this owner only validates that lease and performs the
 * existing export/source-navigation policy.
 */
export async function runGeneratedContextMenuAction(
	id: string,
	session: EditorContextMenuActionSession
): Promise<void> {
	const { actionContext, capabilities, captured, report } = session;
	const generated = actionContext?.generated;
	if (!generated?.lease.isCurrent?.()) {
		report(
			"generated-content-export-lease-stale",
			capabilities.contextMenuStrings?.statusActionFailed
		);
		return;
	}
	if (!session.ensureCurrent()) return;
	const original = generated.lease.target.original;
	const sourceBeforeTransfer = session.readValue();
	const sourceMatchesOriginal = (source: string): boolean =>
		original.fullRange.from >= 0
		&& original.fullRange.to > original.fullRange.from
		&& original.fullRange.to <= source.length
		&& source.slice(original.fullRange.from, original.fullRange.to)
			=== original.full;
	if (!sourceMatchesOriginal(sourceBeforeTransfer)) {
		report(
			"generated-content-export-source-stale",
			capabilities.contextMenuStrings?.statusActionFailed
		);
		return;
	}
	if (!session.ensureSelectionFitsTarget(original.fullRange)) return;

	if ("copy-code-block" === id) {
		const result = await session.clipboard.write(
			generated.lease.target.original.full
		);
		if (!session.ensureCurrent()) return;
		if ("written" !== result.status) {
			report(
				result.code,
				capabilities.contextMenuStrings?.statusClipboardUnavailable
			);
		}
		return;
	}
	if ("copy-generated-source" === id) {
		const result = await session.clipboard.write(
			generated.lease.target.original.body
		);
		if (!session.ensureCurrent()) return;
		if ("written" !== result.status) {
			report(
				result.code,
				capabilities.contextMenuStrings?.statusClipboardUnavailable
			);
		}
		return;
	}
	if ("copy-generated-image" === id || "copy-generated-mathml" === id) {
		if (!session.ensureCurrent()) return;
		const exportSession = capabilities.generated.exportSession;
		if (!exportSession) {
			report(
				"generated-content-export-unsupported",
				capabilities.contextMenuStrings?.unsupported
			);
			return;
		}
		const request = {
			identity: generated.identity,
			lease: generated.lease,
			mode: generated.mode,
			validateLease: generated.validateLease
		};
		const result =
			"copy-generated-image" === id
				? await exportSession.copyAsImage(request)
				: await exportSession.copyMathMl(request);
		if ("failed" === result.status) {
			report(
				result.code,
				capabilities.contextMenuStrings?.statusActionFailed
			);
		}
		return;
	}
	if ("edit-generated-content" === id) {
		if ("visual" === captured.surface) {
			const capturedRevision = captured.revision;
			if (
				"number" !== typeof capturedRevision
				|| !Number.isSafeInteger(capturedRevision)
			) {
				report(
					"generated-content-export-source-stale",
					capabilities.contextMenuStrings?.statusActionFailed
				);
				return;
			}
			const expectedRevision = capturedRevision;
			if (
				!capabilities.generated.prepareSourceNavigation(
					{ revision: expectedRevision, value: captured.value },
					() => {
						const source = session.readValue();
						return (
							source === captured.value && sourceMatchesOriginal(source)
						);
					}
				)
			) {
				report(
					"editor-context-menu-visual-selection-unavailable",
					capabilities.contextMenuStrings?.statusActionFailed
				);
				return;
			}
		}
		const sourceAfterTransfer = session.readValue();
		if (
			sourceAfterTransfer !== captured.value
			|| sourceAfterTransfer.slice(
				original.fullRange.from,
				original.fullRange.to
			) !== original.full
		) {
			report(
				"generated-content-export-source-stale",
				capabilities.contextMenuStrings?.statusActionFailed
			);
			return;
		}
		session.document.revealPosition(original.fullRange.from);
		return;
	}
	if (
		"insert-paragraph-above-generated" === id
		|| "insert-paragraph-below-generated" === id
	) {
		if (!session.ensureCurrent()) return;
		if (!generated.lease.isCurrent?.()) {
			report(
				"generated-content-export-lease-stale",
				capabilities.contextMenuStrings?.statusActionFailed
			);
			return;
		}
		const value = session.readValue();
		const position = generated.lease.target.original.fullRange.from;
		const blockIndex = session.currentBlockIndex();
		if (null === blockIndex) {
			report(
				"editor-context-menu-block-index-unavailable",
				capabilities.contextMenuStrings?.unsupported
			);
			return;
		}
		const edit = insertParagraphRelative(
			value,
			{ direction: "none", end: position, start: position },
			"insert-paragraph-above-generated" === id ? "before" : "after",
			blockIndex
		);
		session.applyEdit(edit);
		return;
	}
	if ("delete-generated-content" === id) {
		if (!session.ensureCurrent()) return;
		if (!generated.lease.isCurrent?.()) {
			report(
				"generated-content-export-lease-stale",
				capabilities.contextMenuStrings?.statusActionFailed
			);
			return;
		}
		const value = session.readValue();
		const range = generated.lease.target.original.fullRange;
		if (
			range.from < 0
			|| range.to <= range.from
			|| range.to > value.length
			|| value.slice(range.from, range.to)
				!== generated.lease.target.original.full
		) {
			report(
				"generated-content-export-source-stale",
				capabilities.contextMenuStrings?.statusActionFailed
			);
			return;
		}
		session.applyEdit({
			changes: { from: range.from, insert: "", to: range.to },
			selection: {
				direction: "none",
				end: range.from,
				start: range.from
			},
			value: value.slice(0, range.from) + value.slice(range.to)
		});
	}
}
