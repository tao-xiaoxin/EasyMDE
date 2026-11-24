import { describe, expect, it, vi } from "vitest";
import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { runImageContextMenuAction } from "./editor-context-menu-image-actions";

function createImageScaleSession(
	value: string,
	selectionStart = 2,
	selectionEnd = 2,
): Readonly<{
	applyEdit: ReturnType<typeof vi.fn>;
	report: ReturnType<typeof vi.fn>;
	session: EditorContextMenuActionSession;
}> {
	const applyEdit = vi.fn(() => true);
	const report = vi.fn();
	const selection = {
		direction: "none" as const,
		end: selectionEnd,
		start: selectionStart,
	};
	const captured = {
		direction: "ltr" as const,
		position: { x: 0, y: 0 },
		selection,
		surface: "source" as const,
		value,
	};
	const clipboard: EditorClipboardPort = {
		check: vi.fn(async () => ({ status: "empty" as const })),
		dispose: vi.fn(),
		getState: () => ({ status: "empty" as const }),
		read: vi.fn(async () => ({ status: "empty" as const })),
		subscribe: () => () => undefined,
		write: vi.fn(async () => ({ status: "written" as const })),
	};
	const documentPort: EditorContextMenuActionSession["document"] = {
		applyTextChange: vi.fn(),
		getBlockIndex: () => null,
		getCurrentContext: () => ({
			selection,
			surface: "source",
			value,
		}),
		getSelection: () => selection,
		getValue: () => value,
		isEditable: () => true,
		revealPosition: vi.fn(),
		subscribe: () => () => undefined,
		subscribeSelection: () => () => undefined,
	};
	const capabilities: EditorContextMenuActionSession["capabilities"] = {
		clipboard,
		contextMenuStrings: {
			statusActionFailed: "Action failed",
			unsupported: "Unsupported",
		} as NonNullable<
			EditorContextMenuActionSession["capabilities"]["contextMenuStrings"]
		>,
		document: documentPort,
		generated: {
			prepareSourceNavigation: () => false,
		},
		isActive: () => true,
		media: {
			imageUpload: {
				postId: 1,
				remoteImageUploadMode: "off",
			},
			openInsertion: vi.fn(),
			remoteImageImport: {
				import: vi.fn(async () => ({
					code: "remote-image-import-unsupported",
					status: "failed" as const,
				})),
			},
			requestTableInsertion: vi.fn(),
		},
		preview: {
			render: vi.fn(),
			renderCodeIndentationCandidate: vi.fn(),
		},
		report,
		toolbar: {
			commands: [],
			execute: () => false,
		},
		visual: {
			applyCanonicalChange: () => false,
			executeCommand: () => "unavailable",
			isEditable: () => false,
		},
	};
	const session: EditorContextMenuActionSession = {
		applyEdit,
		beginOperation: () => ({
			captured,
			cleanup: () => undefined,
			controller: new AbortController(),
			isCurrent: () => true,
		}),
		capabilities,
		captured,
		clipboard,
		currentBlockIndex: () => null,
		document: documentPort,
		ensureCurrent: () => true,
		ensureSelectionFitsTarget: () => true,
		ensureSourceEditable: () => true,
		finishOperation: vi.fn(),
		isCurrent: () => true,
		readValue: () => value,
		report,
	};
	return { applyEdit, report, session };
}

describe("editor-context-menu-image-actions", () => {
	it.each([
		["entity-encoded trailing space", '![A](/image.png "Caption {width=33%}&#32;")'],
		[
			"escaped ampersand entity trailing space",
			String.raw`![A](/image.png "Caption {width=33%}\&#32;")`,
		],
		["trailing space", '![A](/image.png "Caption {width=33%} ")'],
		["trailing newline", '![A](/image.png "Caption {width=33%}\n")'],
		["escaped valid marker", String.raw`![A](/image.png "Caption \{width=50%\}")`],
		["entity-encoded valid marker", '![A](/image.png "Caption &#123;width=50%&#125;")'],
		["escaped invalid marker", String.raw`![A](/image.png "Caption \{width=51%\}")`],
	])(
		"reports cleanly without throwing or mutating on incompatible title (%s)",
		async (_label, markdown) => {
			const { applyEdit, report, session } = createImageScaleSession(markdown);
			await expect(
				runImageContextMenuAction("image-scale-100", session),
			).resolves.toBeUndefined();
			expect(report).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith(
				"editor-context-menu-image-stale",
				"Action failed",
			);
			expect(applyEdit).not.toHaveBeenCalled();
		},
	);

	it("scales valid titles, entity-newline repeated titles, and empty quoted titles without reporting an error", async () => {
		const nonterminal = createImageScaleSession(
			'![A](/image.png "Syntax {width=33%} example")',
		);
		await runImageContextMenuAction("image-scale-50", nonterminal.session);
		expect(nonterminal.report).not.toHaveBeenCalled();
		expect(nonterminal.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: '![A](/image.png "Syntax {width=33%} example {width=50%}")',
			}),
		);

		const entityNewline = createImageScaleSession(
			'![A](/image.png "Caption {width=33%}&NewLine; {width=67%}")',
		);
		await runImageContextMenuAction("image-scale-100", entityNewline.session);
		expect(entityNewline.report).not.toHaveBeenCalled();
		expect(entityNewline.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: '![A](/image.png "Caption {width=33%}&NewLine; {width=100%}")',
			}),
		);

		const emptyQuoted = createImageScaleSession('![A](/image.png "")');
		await runImageContextMenuAction("image-scale-50", emptyQuoted.session);
		expect(emptyQuoted.report).not.toHaveBeenCalled();
		expect(emptyQuoted.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: '![A](/image.png "{width=50%}")',
			}),
		);
	});
});
