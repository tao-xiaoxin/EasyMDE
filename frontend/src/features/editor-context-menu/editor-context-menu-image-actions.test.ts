import { describe, expect, it, vi } from "vitest";
import type { RemoteImageUploadMode } from "../../contracts/bootstrap/image-upload-bootstrap";
import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type { RemoteImageImportResult } from "../../contracts/ports/remote-image-import-port";
import { parseMarkdownImageScale } from "../image-scale/image-scale-contract";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { runImageContextMenuAction } from "./editor-context-menu-image-actions";

function createImageScaleSession(
	value: string,
	selectionStart = 2,
	selectionEnd = 2,
	options?: Readonly<{
		actionContext?: EditorContextMenuActionSession["actionContext"];
		ensureCurrent?: () => boolean;
		importImage?: () => Promise<RemoteImageImportResult>;
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
	const importImage = vi.fn(
		options?.importImage
		?? (async (): Promise<RemoteImageImportResult> => ({
			code: "remote-image-import-unsupported",
			status: "failed",
		})),
	);
	const readCurrentValue = options?.readValue ?? (() => value);
	const ensureCurrent = options?.ensureCurrent ?? (() => true);
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
		...(options?.actionContext ? { actionContext: options.actionContext } : {}),
		applyEdit,
		beginOperation: () => ({
			captured,
			cleanup: () => undefined,
			controller: new AbortController(),
			isCurrent: ensureCurrent,
		}),
		capabilities,
		captured,
		clipboard,
		currentBlockIndex: () => null,
		document: documentPort,
		ensureCurrent,
		ensureSelectionFitsTarget: () => true,
		ensureSourceEditable: () => true,
		finishOperation: vi.fn(),
		isCurrent: ensureCurrent,
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

	it("uses menu-confirmed actionContext.image.match instead of rescanning nested title syntax or indented list items", async () => {
		const nestedTitle =
			'![outer](https://example.com/demo.png "contains ![inner](https://example.com/other.png) here")';
		const outerMatch = parseMarkdownImageScale(nestedTitle, 0);
		expect(outerMatch).not.toBeNull();
		if (!outerMatch) return;
		const caretInsideInner = nestedTitle.indexOf("inner") + 2;

		const deleteOuter = createImageScaleSession(
			nestedTitle,
			caretInsideInner,
			caretInsideInner,
			{
				actionContext: {
					image: { canCopyImage: false, match: outerMatch },
				},
			},
		);
		await runImageContextMenuAction("delete-image", deleteOuter.session);
		expect(deleteOuter.report).not.toHaveBeenCalled();
		expect(deleteOuter.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				changes: { from: 0, insert: "", to: nestedTitle.length },
				value: "",
			}),
		);

		const scaleOuter = createImageScaleSession(
			nestedTitle,
			caretInsideInner,
			caretInsideInner,
			{
				actionContext: {
					image: { canCopyImage: false, match: outerMatch },
				},
			},
		);
		await runImageContextMenuAction("image-scale-50", scaleOuter.session);
		expect(scaleOuter.report).not.toHaveBeenCalled();
		expect(scaleOuter.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value:
					'![outer](https://example.com/demo.png "contains ![inner](https://example.com/other.png) here {width=50%}")',
			}),
		);

		const uploadOuter = createImageScaleSession(
			nestedTitle,
			caretInsideInner,
			caretInsideInner,
			{
				actionContext: {
					image: { canCopyImage: false, match: outerMatch },
				},
				importImage: async () => ({
					alt: "outer",
					backup: { status: "disabled" },
					status: "imported",
					title: "",
					url: "https://cdn.example/demo.png",
				}),
				remoteImageUploadMode: "source",
			},
		);
		await runImageContextMenuAction("upload-image", uploadOuter.session);
		expect(uploadOuter.report).not.toHaveBeenCalled();
		expect(uploadOuter.importImage).toHaveBeenCalledWith(
			expect.objectContaining({
				altText: "outer",
				url: "https://example.com/demo.png",
			}),
		);
		expect(uploadOuter.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value:
					'![outer](https://cdn.example/demo.png "contains ![inner](https://example.com/other.png) here")',
			}),
		);

		const listIndented = "- item\n\n    ![x](https://example.com/demo.png)";
		const indentedStart = listIndented.indexOf("![x]");
		const indentedMatch = parseMarkdownImageScale(listIndented, indentedStart);
		expect(indentedMatch).not.toBeNull();
		if (!indentedMatch) return;

		const scaleIndented = createImageScaleSession(
			listIndented,
			indentedStart + 2,
			indentedStart + 2,
			{
				actionContext: {
					image: { canCopyImage: false, match: indentedMatch },
				},
			},
		);
		await runImageContextMenuAction("image-scale-50", scaleIndented.session);
		expect(scaleIndented.report).not.toHaveBeenCalled();
		expect(scaleIndented.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: '- item\n\n    ![x](https://example.com/demo.png "{width=50%}")',
			}),
		);

		const deleteIndented = createImageScaleSession(
			listIndented,
			indentedStart + 2,
			indentedStart + 2,
			{
				actionContext: {
					image: { canCopyImage: false, match: indentedMatch },
				},
			},
		);
		await runImageContextMenuAction("delete-image", deleteIndented.session);
		expect(deleteIndented.report).not.toHaveBeenCalled();
		expect(deleteIndented.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: "- item\n\n    ",
			}),
		);

		const uploadIndented = createImageScaleSession(
			listIndented,
			indentedStart + 2,
			indentedStart + 2,
			{
				actionContext: {
					image: { canCopyImage: false, match: indentedMatch },
				},
				importImage: async () => ({
					alt: "x",
					backup: { status: "disabled" },
					status: "imported",
					title: "",
					url: "https://cdn.example/indented.png",
				}),
				remoteImageUploadMode: "source",
			},
		);
		await runImageContextMenuAction("upload-image", uploadIndented.session);
		expect(uploadIndented.report).not.toHaveBeenCalled();
		expect(uploadIndented.applyEdit).toHaveBeenCalledWith(
			expect.objectContaining({
				value: "- item\n\n    ![x](https://cdn.example/indented.png)",
			}),
		);
	});

	it("reports stale without mutating when menu-confirmed match or live value drifts before scale, delete, or upload", async () => {
		const original = "![A](https://example.com/a.png)";
		const match = parseMarkdownImageScale(original, 0);
		expect(match).not.toBeNull();
		if (!match) return;

		for (const actionId of [
			"image-scale-50",
			"delete-image",
			"upload-image",
		] as const) {
			const drifted = createImageScaleSession(original, 2, 2, {
				actionContext: { image: { canCopyImage: false, match } },
				importImage: async () => ({
					alt: "A",
					backup: { status: "disabled" },
					status: "imported",
					title: "",
					url: "https://cdn.example/a.png",
				}),
				readValue: () => "![B](https://example.com/b.png)",
				remoteImageUploadMode: "source",
			});
			await runImageContextMenuAction(actionId, drifted.session);
			expect(drifted.report, actionId).toHaveBeenCalledWith(
				"editor-context-menu-image-stale",
				"Action failed",
			);
			expect(drifted.applyEdit, actionId).not.toHaveBeenCalled();
			expect(drifted.importImage, actionId).not.toHaveBeenCalled();
		}

		// Programmatic caller without actionContext still checks live value before scaling.
		const scaleDriftWithoutContext = createImageScaleSession(original, 2, 2, {
			readValue: () => "![B](https://example.com/b.png)",
		});
		await runImageContextMenuAction(
			"image-scale-50",
			scaleDriftWithoutContext.session,
		);
		expect(scaleDriftWithoutContext.report).toHaveBeenCalledWith(
			"editor-context-menu-image-stale",
			"Action failed",
		);
		expect(scaleDriftWithoutContext.applyEdit).not.toHaveBeenCalled();
	});

	it("rejects upload-image when an unrelated image replaces the captured image during upload", async () => {
		const original = "![A](https://example.com/a.png)";
		const match = parseMarkdownImageScale(original, 0);
		expect(match).not.toBeNull();
		if (!match) return;

		for (const [label, replacementLiveValue, withActionContext] of [
			[
				"unrelated image at same offset with confirmed match",
				"![B](https://example.com/b.png)",
				true,
			],
			[
				"unrelated image at same offset without actionContext",
				"![B](https://example.com/b.png)",
				false,
			],
			[
				"invalid width marker written at same offset during upload",
				'![A](https://example.com/a.png "{width=51%}")',
				true,
			],
			["truncated document during upload", "short", true],
		] as const) {
			let liveValue = original;
			const uploadCase = createImageScaleSession(original, 2, 2, {
				...(withActionContext
					? { actionContext: { image: { canCopyImage: false, match } } }
					: {}),
				importImage: async () => {
					liveValue = replacementLiveValue;
					return {
						alt: "A",
						backup: { status: "disabled" },
						status: "imported",
						title: "",
						url: "https://cdn.example/a-imported.png",
					};
				},
				readValue: () => liveValue,
				remoteImageUploadMode: "source",
			});
			await runImageContextMenuAction("upload-image", uploadCase.session);
			expect(uploadCase.importImage, label).toHaveBeenCalledTimes(1);
			expect(uploadCase.applyEdit, label).not.toHaveBeenCalled();
			expect(uploadCase.report, label).toHaveBeenCalledTimes(1);
			expect(uploadCase.report, label).toHaveBeenCalledWith(
				"editor-context-menu-image-stale",
				"Action failed",
			);
		}

		// Invalid returned destination URL still reports upload failure, not staleness.
		const invalidDestination = createImageScaleSession(original, 2, 2, {
			actionContext: { image: { canCopyImage: false, match } },
			importImage: async () => ({
				alt: "A",
				backup: { status: "disabled" },
				status: "imported",
				title: "",
				url: "https://cdn.example/bad\nurl.png",
			}),
			remoteImageUploadMode: "source",
		});
		await runImageContextMenuAction(
			"upload-image",
			invalidDestination.session,
		);
		expect(invalidDestination.applyEdit).not.toHaveBeenCalled();
		expect(invalidDestination.report).toHaveBeenCalledWith(
			"editor-context-menu-image-upload-failed",
			"Action failed",
		);
	});
});
