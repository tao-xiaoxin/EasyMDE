import { describe, expect, it, vi } from "vitest";
import type { RemoteImageUploadMode } from "../../contracts/bootstrap/image-upload-bootstrap";
import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { runImageContextMenuAction } from "./editor-context-menu-image-actions";

function createImageScaleSession(
	value: string,
	selectionStart = 2,
	selectionEnd = 2,
	options?: Readonly<{
		readValue?: () => string;
		remoteImageUploadMode?: RemoteImageUploadMode;
	}>,
): Readonly<{
	applyEdit: ReturnType<typeof vi.fn>;
	importImage: ReturnType<typeof vi.fn>;
	report: ReturnType<typeof vi.fn>;
	session: EditorContextMenuActionSession;
}> {
	const applyEdit = vi.fn(() => true);
	const report = vi.fn();
	const importImage = vi.fn(async () => ({
		code: "remote-image-import-unsupported",
		status: "failed" as const,
	}));
	const readCurrentValue = options?.readValue ?? (() => value);
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
			value: readCurrentValue(),
		}),
		getSelection: () => selection,
		getValue: readCurrentValue,
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
				remoteImageUploadMode: options?.remoteImageUploadMode ?? "off",
			},
			openInsertion: vi.fn(),
			remoteImageImport: {
				import: importImage,
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
		readValue: readCurrentValue,
		report,
	};
	return { applyEdit, importImage, report, session };
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
		["blockquote invalid multiline marker", '> ![A](/x.png "Caption\n> {width=50%}")'],
		["blockquote valid multiline scaled title", '> ![A](/x.png "Caption\n> Line2 {width=50%}")'],
		["blockquote multiline unscaled title", '> ![A](/x.png "Caption\n> Line2")'],
	])(
		"reports cleanly without throwing or mutating on incompatible title (%s)",
		async (_label, markdown) => {
			const selectionStart = markdown.indexOf("![") + 2;
			const { applyEdit, report, session } = createImageScaleSession(
				markdown,
				selectionStart,
				selectionStart,
			);
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

	it("reports cleanly without rejecting for delete-image and upload-image on invalid width markers", async () => {
		const invalidImage = '![A](https://example.com/x.png "{width=51%}")';

		const deleteCase = createImageScaleSession(invalidImage, 2, 2);
		await expect(
			runImageContextMenuAction("delete-image", deleteCase.session),
		).resolves.toBeUndefined();
		expect(deleteCase.report).toHaveBeenCalledTimes(1);
		expect(deleteCase.report).toHaveBeenCalledWith(
			"editor-context-menu-image-stale",
			"Action failed",
		);
		expect(deleteCase.applyEdit).not.toHaveBeenCalled();

		for (const remoteImageUploadMode of ["off", "source", "both"] as const) {
			const uploadCase = createImageScaleSession(invalidImage, 2, 2, {
				remoteImageUploadMode,
			});
			await expect(
				runImageContextMenuAction("upload-image", uploadCase.session),
			).resolves.toBeUndefined();
			expect(uploadCase.report).toHaveBeenCalledTimes(1);
			expect(uploadCase.report).toHaveBeenCalledWith(
				"editor-context-menu-image-upload-failed",
				"Action failed",
			);
			expect(uploadCase.importImage).not.toHaveBeenCalled();
			expect(uploadCase.applyEdit).not.toHaveBeenCalled();
		}
	});

	it("handles parseMarkdownImageScale exceptions safely when live value drifts during delete-image", async () => {
		const captured = 'prefix ![A](https://example.com/x.png "{width=50%}")';
		const selectionStart = captured.indexOf("![") + 2;

		const driftedInvalid = createImageScaleSession(
			captured,
			selectionStart,
			selectionStart,
			{
				readValue: () => 'prefix ![A](https://example.com/x.png "{width=51%}")',
			},
		);
		await expect(
			runImageContextMenuAction("delete-image", driftedInvalid.session),
		).resolves.toBeUndefined();
		expect(driftedInvalid.report).toHaveBeenCalledTimes(1);
		expect(driftedInvalid.report).toHaveBeenCalledWith(
			"editor-context-menu-image-stale",
			"Action failed",
		);
		expect(driftedInvalid.applyEdit).not.toHaveBeenCalled();

		const driftedTruncated = createImageScaleSession(
			captured,
			selectionStart,
			selectionStart,
			{
				readValue: () => "short",
			},
		);
		await expect(
			runImageContextMenuAction("delete-image", driftedTruncated.session),
		).resolves.toBeUndefined();
		expect(driftedTruncated.report).toHaveBeenCalledTimes(1);
		expect(driftedTruncated.report).toHaveBeenCalledWith(
			"editor-context-menu-image-stale",
			"Action failed",
		);
		expect(driftedTruncated.applyEdit).not.toHaveBeenCalled();
	});

	it("reports unavailable codes when no image exists at the selection and still deletes valid images", async () => {
		const scaleMissing = createImageScaleSession("plain text", 2, 2);
		await runImageContextMenuAction("image-scale-50", scaleMissing.session);
		expect(scaleMissing.report).toHaveBeenCalledWith(
			"editor-context-menu-image-unavailable",
			"Unsupported",
		);

		const deleteMissing = createImageScaleSession("plain text", 2, 2);
		await runImageContextMenuAction("delete-image", deleteMissing.session);
		expect(deleteMissing.report).toHaveBeenCalledWith(
			"editor-context-menu-image-unavailable",
			"Unsupported",
		);

		const uploadMissing = createImageScaleSession("plain text", 2, 2, {
			remoteImageUploadMode: "source",
		});
		await runImageContextMenuAction("upload-image", uploadMissing.session);
		expect(uploadMissing.report).toHaveBeenCalledWith(
			"editor-context-menu-image-upload-unsupported",
			"Unsupported",
		);

		const validDelete = createImageScaleSession(
			'before ![A](https://example.com/x.png "{width=50%}") after',
			10,
			10,
		);
		await runImageContextMenuAction("delete-image", validDelete.session);
		expect(validDelete.report).not.toHaveBeenCalled();
		expect(validDelete.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: "before  after",
			}),
		);
	});
});
