import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_EDITOR_CLIPBOARD_RICH_MAX_BYTES,
	type EditorClipboardPort,
	type EditorClipboardRichPayload,
} from "../../contracts/ports/editor-clipboard-port";
import type {
	PreviewResponse,
	SafePreviewHtml,
} from "../../contracts/ports/preview-request";
import { createBrowserEditorClipboard } from "../../integrations/browser/clipboard/create-browser-editor-clipboard";
import { createWordPressPreviewPort } from "../../integrations/wordpress/preview/create-wordpress-preview-port";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { runTextContextMenuAction } from "./editor-context-menu-text-actions";
import type { SimplifiedFormattingDomParser } from "./editor-simplified-formatting";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

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
		clipboard?: EditorClipboardPort;
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
	const clipboard: EditorClipboardPort = options?.clipboard ?? {
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

		it("does not write stale HTML to the OS clipboard when isCurrent flips false before preview resolves with the real clipboard adapter", async () => {
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				writeDeferred: async (textPromise) => {
					const html = await textPromise;
					osClipboardWrite(html);
				},
				writeText: vi.fn(),
			});
			let current = true;
			const fixture = createTextActionSession({
				clipboard,
				ensureCurrent: () => {
					if (!current) {
						fixture.session.report(
							"editor-context-menu-context-stale",
							"Action failed",
						);
						return false;
					}
					return true;
				},
				isCurrent: () => current,
				renderPreview: async () => {
					current = false;
					return createPreviewResponse("<p>Stale HTML</p>");
				},
			});

			await expect(
				runTextContextMenuAction("copy-as-html", fixture.session),
			).resolves.toBeUndefined();
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-context-menu-context-stale",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("immediately aborts preview and reports clipboard failure when real writeDeferred fails while preview is still pending", async () => {
			const pendingPreview = createDeferred<PreviewResponse>();
			let previewSignal: AbortSignal | null = null;
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				writeDeferred: vi.fn(async () => {
					throw new Error("permission denied");
				}),
				writeText: vi.fn(),
			});
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: (_markdown, signal) => {
					previewSignal = signal;
					return pendingPreview.promise;
				},
			});

			await expect(
				runTextContextMenuAction("copy-as-html", fixture.session),
			).resolves.toBeUndefined();
			expect(previewSignal).toBe(fixture.controller.signal);
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-clipboard-write-failed",
				"Clipboard unavailable",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);

			// Late abort rejection after immediate failure produces no unhandled rejection or extra report.
			pendingPreview.reject(new DOMException("Aborted", "AbortError"));
			await Promise.resolve();
			await Promise.resolve();
			expect(fixture.report).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("preserves preview error code and action-failed status when real writeDeferred catches preview failure", async () => {
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				writeDeferred: async (textPromise) => {
					const html = await textPromise;
					osClipboardWrite(html);
				},
				writeText: vi.fn(),
			});
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: async () => {
					throw new Error("editor-preview-http-500");
				},
			});

			await expect(
				runTextContextMenuAction("copy-as-html", fixture.session),
			).resolves.toBeUndefined();
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-preview-http-500",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("preserves real WordPress preview-response-invalid through the real preview and clipboard adapters with zero native writes", async () => {
			const apiFetch = vi.fn().mockResolvedValue({ html: 123 });
			const previewPort = createWordPressPreviewPort(
				apiFetch,
				"/wp-json/easymde/v1/preview",
				"nonce",
				"https://example.test/wp-admin/post.php",
			);
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				writeDeferred: async (textPromise) => {
					const html = await textPromise;
					osClipboardWrite(html);
				},
				writeText: vi.fn(),
			});
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: (markdown, signal) =>
					previewPort.render(
						{
							codeTheme: "github-dark",
							customCssId: "",
							markdown,
							markdownTheme: "default",
							postId: 1,
							signature: "sig-invalid-html",
						},
						signal,
					),
			});

			await expect(
				runTextContextMenuAction("copy-as-html", fixture.session),
			).resolves.toBeUndefined();
			expect(apiFetch).toHaveBeenCalledTimes(1);
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"preview-response-invalid",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();

			// Even when the underlying runtime resolves without awaiting the
			// deferred text promise, createBrowserEditorClipboard rejects the
			// false written status so preview-response-invalid is still reported.
			const swallowingNativeWrite = vi.fn();
			const swallowingClipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				writeDeferred: async (textPromise) => {
					void textPromise.then(swallowingNativeWrite, () => undefined);
				},
				writeText: vi.fn(),
			});
			const swallowingFixture = createTextActionSession({
				clipboard: swallowingClipboard,
				renderPreview: (markdown, signal) =>
					previewPort.render(
						{
							codeTheme: "github-dark",
							customCssId: "",
							markdown,
							markdownTheme: "default",
							postId: 1,
							signature: "sig-invalid-html-swallowing",
						},
						signal,
					),
			});

			await expect(
				runTextContextMenuAction("copy-as-html", swallowingFixture.session),
			).resolves.toBeUndefined();
			expect(swallowingNativeWrite).not.toHaveBeenCalled();
			expect(swallowingFixture.controller.signal.aborted).toBe(true);
			expect(swallowingFixture.report).toHaveBeenCalledTimes(1);
			expect(swallowingFixture.report).toHaveBeenCalledWith(
				"preview-response-invalid",
				"Action failed",
			);
			expect(swallowingFixture.finishOperation).toHaveBeenCalledTimes(1);
			swallowingClipboard.dispose();
		});

		it.each([
			"Secret server stack trace",
			"network failed",
			"preview-UpperCase",
			"preview-bad space",
		])(
			"rejects arbitrary preview error message %j and reports fallback code for copy-as-html",
			async (message) => {
				const osClipboardWrite = vi.fn();
				const clipboard = createBrowserEditorClipboard({
					readText: vi.fn(),
					writeDeferred: async (textPromise) => {
						const html = await textPromise;
						osClipboardWrite(html);
					},
					writeText: vi.fn(),
				});
				const fixture = createTextActionSession({
					clipboard,
					renderPreview: async () => {
						throw new Error(message);
					},
				});

				await expect(
					runTextContextMenuAction("copy-as-html", fixture.session),
				).resolves.toBeUndefined();
				expect(osClipboardWrite).not.toHaveBeenCalled();
				expect(fixture.controller.signal.aborted).toBe(true);
				expect(fixture.report).toHaveBeenCalledTimes(1);
				expect(fixture.report).toHaveBeenCalledWith(
					"editor-context-menu-html-copy-failed",
					"Action failed",
				);
				expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
				clipboard.dispose();
			},
		);
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

		it("reports preview HTTP 500 with statusActionFailed instead of rich-payload-failed through the real clipboard adapter", async () => {
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				supportsRichWrite: () => true,
				writeRichDeferred: async (
					payloadPromise: Promise<EditorClipboardRichPayload>,
				) => {
					const payload = await payloadPromise;
					osClipboardWrite(payload);
				},
				writeText: vi.fn(),
			});
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: async () => {
					throw new Error("editor-preview-http-500");
				},
				simplifiedFormattingParser: createDomParser(),
			});

			await expect(
				runTextContextMenuAction("copy-simplified-formatting", fixture.session),
			).resolves.toBeUndefined();
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-preview-http-500",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("reports editor-simplified-formatting-input-too-large with statusActionFailed for oversized preview HTML through the real clipboard adapter", async () => {
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				supportsRichWrite: () => true,
				writeRichDeferred: async (
					payloadPromise: Promise<EditorClipboardRichPayload>,
				) => {
					const payload = await payloadPromise;
					osClipboardWrite(payload);
				},
				writeText: vi.fn(),
			});
			const oversizedHtml = `<p>${"a".repeat(
				DEFAULT_EDITOR_CLIPBOARD_RICH_MAX_BYTES + 1,
			)}</p>`;
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: async () => createPreviewResponse(oversizedHtml),
				simplifiedFormattingParser: createDomParser(),
			});

			await expect(
				runTextContextMenuAction("copy-simplified-formatting", fixture.session),
			).resolves.toBeUndefined();
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-simplified-formatting-input-too-large",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("does not write stale rich HTML or misreport payload failure when isCurrent flips false with the real clipboard adapter", async () => {
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				supportsRichWrite: () => true,
				writeRichDeferred: async (
					payloadPromise: Promise<EditorClipboardRichPayload>,
				) => {
					const payload = await payloadPromise;
					osClipboardWrite(payload);
				},
				writeText: vi.fn(),
			});
			let current = true;
			const fixture = createTextActionSession({
				clipboard,
				ensureCurrent: () => {
					if (!current) {
						fixture.session.report(
							"editor-context-menu-context-stale",
							"Action failed",
						);
						return false;
					}
					return true;
				},
				isCurrent: () => current,
				renderPreview: async () => {
					current = false;
					return createPreviewResponse("<p><strong>stale</strong></p>");
				},
				simplifiedFormattingParser: createDomParser(),
			});

			await expect(
				runTextContextMenuAction("copy-simplified-formatting", fixture.session),
			).resolves.toBeUndefined();
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-context-menu-context-stale",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("immediately aborts preview and reports clipboard failure when real writeRichDeferred fails while preview is still pending", async () => {
			const pendingPreview = createDeferred<PreviewResponse>();
			let previewSignal: AbortSignal | null = null;
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				supportsRichWrite: () => true,
				writeRichDeferred: vi.fn(async () => {
					throw new Error("permission denied");
				}),
				writeText: vi.fn(),
			});
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: (_markdown, signal) => {
					previewSignal = signal;
					return pendingPreview.promise;
				},
				simplifiedFormattingParser: createDomParser(),
			});

			await expect(
				runTextContextMenuAction("copy-simplified-formatting", fixture.session),
			).resolves.toBeUndefined();
			expect(previewSignal).toBe(fixture.controller.signal);
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"editor-clipboard-write-failed",
				"Clipboard unavailable",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);

			pendingPreview.reject(new DOMException("Aborted", "AbortError"));
			await Promise.resolve();
			await Promise.resolve();
			expect(fixture.report).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it("preserves real WordPress preview-response-invalid through the real preview and clipboard adapters with zero native writes", async () => {
			const apiFetch = vi.fn().mockResolvedValue({ html: 123 });
			const previewPort = createWordPressPreviewPort(
				apiFetch,
				"/wp-json/easymde/v1/preview",
				"nonce",
				"https://example.test/wp-admin/post.php",
			);
			const osClipboardWrite = vi.fn();
			const clipboard = createBrowserEditorClipboard({
				readText: vi.fn(),
				supportsRichWrite: () => true,
				writeRichDeferred: async (
					payloadPromise: Promise<EditorClipboardRichPayload>,
				) => {
					const payload = await payloadPromise;
					osClipboardWrite(payload);
				},
				writeText: vi.fn(),
			});
			const fixture = createTextActionSession({
				clipboard,
				renderPreview: (markdown, signal) =>
					previewPort.render(
						{
							codeTheme: "github-dark",
							customCssId: "",
							markdown,
							markdownTheme: "default",
							postId: 1,
							signature: "sig-invalid-rich",
						},
						signal,
					),
				simplifiedFormattingParser: createDomParser(),
			});

			await expect(
				runTextContextMenuAction("copy-simplified-formatting", fixture.session),
			).resolves.toBeUndefined();
			expect(apiFetch).toHaveBeenCalledTimes(1);
			expect(osClipboardWrite).not.toHaveBeenCalled();
			expect(fixture.controller.signal.aborted).toBe(true);
			expect(fixture.report).toHaveBeenCalledTimes(1);
			expect(fixture.report).toHaveBeenCalledWith(
				"preview-response-invalid",
				"Action failed",
			);
			expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
			clipboard.dispose();
		});

		it.each([
			"Secret server stack trace",
			"network failed",
			"preview-UpperCase",
			"preview-bad space",
		])(
			"rejects arbitrary preview error message %j and reports fallback code for copy-simplified-formatting",
			async (message) => {
				const osClipboardWrite = vi.fn();
				const clipboard = createBrowserEditorClipboard({
					readText: vi.fn(),
					supportsRichWrite: () => true,
					writeRichDeferred: async (
						payloadPromise: Promise<EditorClipboardRichPayload>,
					) => {
						const payload = await payloadPromise;
						osClipboardWrite(payload);
					},
					writeText: vi.fn(),
				});
				const fixture = createTextActionSession({
					clipboard,
					renderPreview: async () => {
						throw new Error(message);
					},
					simplifiedFormattingParser: createDomParser(),
				});

				await expect(
					runTextContextMenuAction(
						"copy-simplified-formatting",
						fixture.session,
					),
				).resolves.toBeUndefined();
				expect(osClipboardWrite).not.toHaveBeenCalled();
				expect(fixture.controller.signal.aborted).toBe(true);
				expect(fixture.report).toHaveBeenCalledTimes(1);
				expect(fixture.report).toHaveBeenCalledWith(
					"editor-context-menu-rich-copy-failed",
					"Action failed",
				);
				expect(fixture.finishOperation).toHaveBeenCalledTimes(1);
				clipboard.dispose();
			},
		);
	});
});
