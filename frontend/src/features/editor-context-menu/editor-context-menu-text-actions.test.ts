import { describe, expect, it, vi } from "vitest";
import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type {
	PreviewResponse,
	SafePreviewHtml,
} from "../../contracts/ports/preview-request";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { runTextContextMenuAction } from "./editor-context-menu-text-actions";
import type { SimplifiedFormattingDomParser } from "./editor-simplified-formatting";

function createPreviewResponse(html: string): PreviewResponse {
	return {
		html: html as SafePreviewHtml,
		markdownTheme: "default",
		meta: {
			hasCode: false,
			hasMath: false,
			hasMermaid: false,
		},
		renderSignature: "sig",
	} as unknown as PreviewResponse;
}

function createDomParser(): SimplifiedFormattingDomParser {
	const native = new DOMParser();
	return {
		parseFromString: (source, mimeType) =>
			native.parseFromString(source, mimeType),
	};
}

function createTextActionSession(
	options?: Readonly<{
		controller?: AbortController;
		ensureCurrent?: () => boolean;
		isCurrent?: () => boolean;
		renderPreview?: (
			markdown: string,
			signal: AbortSignal,
		) => Promise<PreviewResponse>;
		selectionEnd?: number;
		selectionStart?: number;
		simplifiedFormattingParser?: SimplifiedFormattingDomParser;
		value?: string;
		writeDeferred?: EditorClipboardPort["writeDeferred"];
		writeRichDeferred?: EditorClipboardPort["writeRichDeferred"];
	}>,
): Readonly<{
	controller: AbortController;
	ensureCurrent: ReturnType<typeof vi.fn>;
	finishOperation: ReturnType<typeof vi.fn>;
	renderPreview: ReturnType<typeof vi.fn>;
	report: ReturnType<typeof vi.fn>;
	session: EditorContextMenuActionSession;
}> {
	const value = options?.value ?? "**hello** world";
	const selection = {
		direction: "forward" as const,
		end: options?.selectionEnd ?? value.length,
		start: options?.selectionStart ?? 0,
	};
	const controller = options?.controller ?? new AbortController();
	const finishOperation = vi.fn();
	const report = vi.fn();
	const ensureCurrent = vi.fn(options?.ensureCurrent ?? (() => true));
	const isCurrent = vi.fn(options?.isCurrent ?? (() => true));
	const renderPreview = vi.fn(
		options?.renderPreview
			?? (async () => createPreviewResponse("<p><strong>hello</strong></p>")),
	);
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
		...(options?.writeDeferred ? { writeDeferred: options.writeDeferred } : {}),
		...(options?.writeRichDeferred
			? { writeRichDeferred: options.writeRichDeferred }
			: {}),
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
			statusClipboardUnavailable: "Clipboard unavailable",
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
			render: renderPreview,
			renderCodeIndentationCandidate: vi.fn(),
		},
		report,
		...(options?.simplifiedFormattingParser
			? { simplifiedFormattingParser: options.simplifiedFormattingParser }
			: {}),
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
		applyEdit: vi.fn(() => true),
		beginOperation: () => ({
			captured,
			cleanup: () => undefined,
			controller,
			isCurrent,
		}),
		capabilities,
		captured,
		clipboard,
		currentBlockIndex: () => null,
		document: documentPort,
		ensureCurrent,
		ensureSelectionFitsTarget: () => true,
		ensureSourceEditable: () => true,
		finishOperation,
		isCurrent,
		readValue: () => value,
		report,
	};
	return {
		controller,
		ensureCurrent,
		finishOperation,
		renderPreview,
		report,
		session,
	};
}

describe("editor-context-menu-text-actions", () => {
	describe("copy-as-html", () => {
		it("suppresses failure reporting when aborted and preview.render rejects with AbortError", async () => {
			const controller = new AbortController();
			const writeDeferred = vi.fn(
				async (_html: Promise<string>, opts?: { signal?: AbortSignal }) => {
					expect(opts?.signal).toBe(controller.signal);
					return {
						code: "editor-clipboard-cancelled" as const,
						status: "failed" as const,
					};
				},
			);
			const fixture = createTextActionSession({
				controller,
				renderPreview: async (_markdown, signal) => {
					controller.abort();
					expect(signal.aborted).toBe(true);
					throw new DOMException("Aborted", "AbortError");
				},
				writeDeferred,
			});

			await expect(
				runTextContextMenuAction("copy-as-html", fixture.session),
			).resolves.toBeUndefined();
			expect(fixture.report).not.toHaveBeenCalled();
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
		});

		it("suppresses failure reporting when aborted and writeDeferred resolves with a failed status", async () => {
			const controller = new AbortController();
			const ensureCurrentCalls = { count: 0 };
			const fixture = createTextActionSession({
				controller,
				ensureCurrent: () => {
					ensureCurrentCalls.count += 1;
					// Simulate coordinator's ensureCurrent reporting stale if called post-abort.
					if (ensureCurrentCalls.count > 1) {
						fixture.session.report(
							"editor-context-menu-context-stale",
							"Action failed",
						);
						return false;
					}
					return true;
				},
				renderPreview: async () => createPreviewResponse("<p>Rendered</p>"),
				writeDeferred: async (htmlPromise, opts) => {
					await htmlPromise;
					controller.abort();
					expect(opts?.signal?.aborted).toBe(true);
					return {
						code: "editor-clipboard-write-failed",
						status: "failed",
					};
				},
			});

			await expect(
				runTextContextMenuAction("copy-as-html", fixture.session),
			).resolves.toBeUndefined();
			expect(ensureCurrentCalls.count).toBe(1);
			expect(fixture.report).not.toHaveBeenCalled();
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
		});

		it("reports real non-aborted clipboard and preview failures normally without unhandled rejections", async () => {
			const clipboardFailure = createTextActionSession({
				renderPreview: async () => createPreviewResponse("<p>Rendered</p>"),
				writeDeferred: async (htmlPromise) => {
					await htmlPromise;
					return {
						code: "editor-clipboard-write-failed",
						status: "failed",
					};
				},
			});
			await runTextContextMenuAction("copy-as-html", clipboardFailure.session);
			expect(clipboardFailure.report).toHaveBeenCalledTimes(1);
			expect(clipboardFailure.report).toHaveBeenCalledWith(
				"editor-clipboard-write-failed",
				"Clipboard unavailable",
			);
			expect(clipboardFailure.finishOperation).toHaveBeenCalledTimes(1);

			const renderFailure = createTextActionSession({
				renderPreview: async () => {
					throw new Error("preview network failure");
				},
				writeDeferred: async (htmlPromise, opts) => {
					try {
						await htmlPromise;
					} catch {
						return {
							code: opts?.signal?.aborted
								? "editor-clipboard-cancelled"
								: "editor-clipboard-write-failed",
							status: "failed",
						};
					}
					return { status: "written" };
				},
			});
			await runTextContextMenuAction("copy-as-html", renderFailure.session);
			expect(renderFailure.controller.signal.aborted).toBe(true);
			expect(renderFailure.report).toHaveBeenCalledTimes(1);
			expect(renderFailure.report).toHaveBeenCalledWith(
				"editor-context-menu-html-copy-failed",
				"Action failed",
			);
			expect(renderFailure.finishOperation).toHaveBeenCalledTimes(1);

			// Synchronous throw from writeDeferred while renderPreview rejects on abort.
			const syncThrowController = new AbortController();
			const syncThrowCase = createTextActionSession({
				controller: syncThrowController,
				renderPreview: (_markdown, signal) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => reject(new DOMException("Aborted", "AbortError")),
							{ once: true },
						);
					}),
				writeDeferred: () => {
					throw new Error("sync clipboard error");
				},
			});
			await runTextContextMenuAction("copy-as-html", syncThrowCase.session);
			expect(syncThrowController.signal.aborted).toBe(true);
			expect(syncThrowCase.report).toHaveBeenCalledTimes(1);
			expect(syncThrowCase.report).toHaveBeenCalledWith(
				"editor-context-menu-html-copy-failed",
				"Action failed",
			);
			expect(syncThrowCase.finishOperation).toHaveBeenCalledTimes(1);
		});
	});

	describe("copy-simplified-formatting", () => {
		it("suppresses failure reporting when aborted and preview.render rejects with AbortError", async () => {
			const rejectingController = new AbortController();
			const rejectingCase = createTextActionSession({
				controller: rejectingController,
				renderPreview: async (_markdown, signal) => {
					rejectingController.abort();
					expect(signal.aborted).toBe(true);
					throw new DOMException("Aborted", "AbortError");
				},
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload) => {
					await payload;
					return { status: "written" };
				},
			});
			await expect(
				runTextContextMenuAction(
					"copy-simplified-formatting",
					rejectingCase.session,
				),
			).resolves.toBeUndefined();
			expect(rejectingCase.report).not.toHaveBeenCalled();
			expect(rejectingCase.finishOperation).toHaveBeenCalledTimes(1);

			const resolvingFailedController = new AbortController();
			const resolvingFailedCase = createTextActionSession({
				controller: resolvingFailedController,
				renderPreview: async () => {
					resolvingFailedController.abort();
					throw new DOMException("Aborted", "AbortError");
				},
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload) => {
					try {
						await payload;
					} catch {
						return {
							code: "editor-clipboard-cancelled",
							status: "failed",
						};
					}
					return { status: "written" };
				},
			});
			await expect(
				runTextContextMenuAction(
					"copy-simplified-formatting",
					resolvingFailedCase.session,
				),
			).resolves.toBeUndefined();
			expect(resolvingFailedCase.report).not.toHaveBeenCalled();
			expect(resolvingFailedCase.finishOperation).toHaveBeenCalledTimes(1);
		});

		it("suppresses failure reporting when aborted and payload conversion hits the stale/aborted throw guard", async () => {
			// Case 1: writeRichDeferred lets payload's editor-context-menu-context-stale throw propagate.
			const throwingController = new AbortController();
			const throwingCase = createTextActionSession({
				controller: throwingController,
				renderPreview: async () => {
					throwingController.abort();
					return createPreviewResponse("<p><strong>hello</strong></p>");
				},
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload) => {
					await payload;
					return { status: "written" };
				},
			});
			await expect(
				runTextContextMenuAction(
					"copy-simplified-formatting",
					throwingCase.session,
				),
			).resolves.toBeUndefined();
			expect(throwingCase.report).not.toHaveBeenCalled();
			expect(throwingCase.finishOperation).toHaveBeenCalledTimes(1);

			// Case 2: writeRichDeferred catches payload rejection and resolves { status: "failed" }.
			const resolvingController = new AbortController();
			const resolvingCase = createTextActionSession({
				controller: resolvingController,
				renderPreview: async () => {
					resolvingController.abort();
					return createPreviewResponse("<p><strong>hello</strong></p>");
				},
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload) => {
					try {
						await payload;
					} catch {
						return {
							code: "editor-clipboard-rich-payload-failed",
							status: "failed",
						};
					}
					return { status: "written" };
				},
			});
			await expect(
				runTextContextMenuAction(
					"copy-simplified-formatting",
					resolvingCase.session,
				),
			).resolves.toBeUndefined();
			expect(resolvingCase.report).not.toHaveBeenCalled();
			expect(resolvingCase.finishOperation).toHaveBeenCalledTimes(1);
		});

		it("suppresses failure reporting when aborted and writeRichDeferred resolves with a failed status", async () => {
			const controller = new AbortController();
			const ensureCurrentCalls = { count: 0 };
			const fixture = createTextActionSession({
				controller,
				ensureCurrent: () => {
					ensureCurrentCalls.count += 1;
					if (ensureCurrentCalls.count > 1) {
						fixture.session.report(
							"editor-context-menu-context-stale",
							"Action failed",
						);
						return false;
					}
					return true;
				},
				renderPreview: async () =>
					createPreviewResponse("<p><strong>hello</strong></p>"),
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload, opts) => {
					await payload;
					controller.abort();
					expect(opts?.signal?.aborted).toBe(true);
					return {
						code: "editor-clipboard-write-failed",
						status: "failed",
					};
				},
			});

			await expect(
				runTextContextMenuAction("copy-simplified-formatting", fixture.session),
			).resolves.toBeUndefined();
			expect(ensureCurrentCalls.count).toBe(1);
			expect(fixture.report).not.toHaveBeenCalled();
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
		});

		it("reports real non-aborted rich clipboard and conversion failures normally", async () => {
			const failedResultCase = createTextActionSession({
				renderPreview: async () =>
					createPreviewResponse("<p><strong>hello</strong></p>"),
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload) => {
					const resolved = await payload;
					expect(resolved.html).toContain("<strong>hello</strong>");
					return {
						code: "editor-clipboard-write-failed",
						status: "failed",
					};
				},
			});
			await runTextContextMenuAction(
				"copy-simplified-formatting",
				failedResultCase.session,
			);
			expect(failedResultCase.report).toHaveBeenCalledTimes(1);
			expect(failedResultCase.report).toHaveBeenCalledWith(
				"editor-clipboard-write-failed",
				"Clipboard unavailable",
			);
			expect(failedResultCase.finishOperation).toHaveBeenCalledTimes(1);

			const rejectedCase = createTextActionSession({
				renderPreview: async () =>
					createPreviewResponse("<p><strong>hello</strong></p>"),
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async () => {
					throw new Error("unexpected rich write error");
				},
			});
			await runTextContextMenuAction(
				"copy-simplified-formatting",
				rejectedCase.session,
			);
			expect(rejectedCase.report).toHaveBeenCalledTimes(1);
			expect(rejectedCase.report).toHaveBeenCalledWith(
				"editor-context-menu-rich-copy-failed",
				"Action failed",
			);
			expect(rejectedCase.finishOperation).toHaveBeenCalledTimes(1);

			// Non-aborted stale session still reports the stale context code when propagated.
			let current = true;
			const staleNonAbortedCase = createTextActionSession({
				ensureCurrent: () => current,
				isCurrent: () => current,
				renderPreview: async () => {
					current = false;
					return createPreviewResponse("<p><strong>hello</strong></p>");
				},
				simplifiedFormattingParser: createDomParser(),
				writeRichDeferred: async (payload) => {
					await payload;
					return { status: "written" };
				},
			});
			await runTextContextMenuAction(
				"copy-simplified-formatting",
				staleNonAbortedCase.session,
			);
			expect(staleNonAbortedCase.report).toHaveBeenCalledTimes(1);
			expect(staleNonAbortedCase.report).toHaveBeenCalledWith(
				"editor-context-menu-context-stale",
				"Action failed",
			);
			expect(staleNonAbortedCase.finishOperation).toHaveBeenCalledTimes(1);
		});
	});
});
