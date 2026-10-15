import { describe, expect, it, vi } from "vitest";

import { createBrowserEditorClipboard } from "./create-browser-editor-clipboard";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("createBrowserEditorClipboard", () => {
	it("starts unknown, reports checking, then exposes readable text", async () => {
		const readText = vi.fn().mockResolvedValue("clipboard text");
		const clipboard = createBrowserEditorClipboard({
			readText,
			writeText: vi.fn(),
		});
		const states = [clipboard.getState().status];
		const unsubscribe = clipboard.subscribe(() =>
			states.push(clipboard.getState().status),
		);

		await expect(clipboard.check()).resolves.toEqual({
			status: "available",
			text: "clipboard text",
		});
		expect(states).toEqual(["unknown", "checking", "available"]);
		expect(readText).toHaveBeenCalledTimes(1);

		unsubscribe();
		clipboard.dispose();
	});

	it("distinguishes empty, unsupported, and rejected reads", async () => {
		const empty = createBrowserEditorClipboard({
			readText: vi.fn().mockResolvedValue(""),
			writeText: vi.fn(),
		});
		await expect(empty.read()).resolves.toEqual({ status: "empty" });
		expect(empty.getState()).toEqual({ status: "empty" });

		const unsupported = createBrowserEditorClipboard(null);
		await expect(unsupported.read()).resolves.toEqual({
			code: "editor-clipboard-unsupported",
			status: "unavailable",
		});
		expect(unsupported.getState()).toEqual({
			code: "editor-clipboard-unsupported",
			status: "unavailable",
		});

		const rejected = createBrowserEditorClipboard({
			readText: vi.fn().mockRejectedValue(new Error("permission denied")),
			writeText: vi.fn(),
		});
		await expect(rejected.read()).resolves.toEqual({
			code: "editor-clipboard-read-failed",
			status: "unavailable",
		});
	});

	it("reports write rejection without claiming a successful mutation", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("write denied"));
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeText,
		});

		await expect(clipboard.write("selected text")).resolves.toEqual({
			code: "editor-clipboard-write-failed",
			status: "failed",
		});
		expect(writeText).toHaveBeenCalledWith("selected text");
		expect(clipboard.getState().status).toBe("unknown");
	});

	it("does not turn a successful empty write into proof of readable Clipboard text", async () => {
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeText: vi.fn().mockResolvedValue(undefined),
		});

		await expect(clipboard.write("")).resolves.toEqual({ status: "written" });
		expect(clipboard.getState()).toEqual({ status: "unknown" });
	});

	it("starts a deferred write synchronously and resolves after the payload promise", async () => {
		let resolvePayload!: (value: string) => void;
		const payload = new Promise<string>((resolve) => {
			resolvePayload = resolve;
		});
		const writeDeferred = vi
			.fn()
			.mockImplementation(async (value: Promise<string>) => {
				expect(writeDeferred).toHaveBeenCalledOnce();
				expect(await value).toBe("<p>Rendered</p>");
			});
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeDeferred,
			writeText: vi.fn(),
		});

		const result = clipboard.writeDeferred?.(payload);
		expect(writeDeferred).toHaveBeenCalledOnce();
		resolvePayload("<p>Rendered</p>");
		await expect(result).resolves.toEqual({ status: "written" });
	});

	it("rejects the native deferred payload before late resolution after abort", async () => {
		const payload = deferred<string>();
		const nativePayloadConsumed = vi.fn();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeDeferred: vi.fn((value: Promise<string>) =>
				value.then((resolved) => {
					nativePayloadConsumed(resolved);
				}),
			),
			writeText: vi.fn(),
		});
		const controller = new AbortController();
		const result = clipboard.writeDeferred?.(payload.promise, {
			signal: controller.signal,
		});
		controller.abort();

		await expect(result).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});
		payload.resolve("late HTML");
		await Promise.resolve();
		expect(nativePayloadConsumed).not.toHaveBeenCalled();
	});

	it("rejects the native deferred payload before late resolution after disposal", async () => {
		const payload = deferred<string>();
		const nativePayloadConsumed = vi.fn();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeDeferred: vi.fn((value: Promise<string>) =>
				value.then((resolved) => {
					nativePayloadConsumed(resolved);
				}),
			),
			writeText: vi.fn(),
		});
		const result = clipboard.writeDeferred?.(payload.promise);
		clipboard.dispose();

		await expect(result).resolves.toEqual({
			code: "editor-clipboard-disposed",
			status: "failed",
		});
		payload.resolve("late HTML");
		await Promise.resolve();
		expect(nativePayloadConsumed).not.toHaveBeenCalled();
	});

	it("does not publish a late read after cancellation or disposal", async () => {
		const operation = deferred<string>();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn().mockReturnValue(operation.promise),
			writeText: vi.fn(),
		});
		const controller = new AbortController();
		const result = clipboard.read({ signal: controller.signal });
		controller.abort();
		operation.resolve("late clipboard text");

		await expect(result).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});
		expect(clipboard.getState().status).toBe("checking");

		clipboard.dispose();
		expect(clipboard.getState().status).toBe("unavailable");
	});

	it("detects PNG support from ClipboardItem.supports and starts the native write", async () => {
		const payload = deferred<Blob>();
		const writes: unknown[] = [];
		const nativeWrite = vi.fn((items: unknown[]) => {
			writes.push(items[0]);
			return Promise.resolve();
		});
		class ClipboardItemStub {
			static supports = vi.fn((type: string) => "image/png" === type);
			constructor(readonly payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		vi.stubGlobal("navigator", {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
				write: nativeWrite,
				writeText: vi.fn().mockResolvedValue(undefined),
			},
		});
		vi.stubGlobal("ClipboardItem", ClipboardItemStub);

		try {
			const clipboard = createBrowserEditorClipboard();
			if (!clipboard.supportsPngWrite || !clipboard.writeImageDeferred) {
				throw new Error("native-image-clipboard-fixture-missing");
			}
			expect(clipboard.supportsPngWrite()).toBe(true);
			const result = clipboard.writeImageDeferred(payload.promise);
			expect(nativeWrite).toHaveBeenCalledOnce();
			expect(writes[0]).toBeInstanceOf(ClipboardItemStub);
			payload.resolve(new Blob(["png"], { type: "image/png" }));
			await expect(result).resolves.toEqual({ status: "written" });
			expect(ClipboardItemStub.supports).toHaveBeenCalledWith("image/png");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("starts a PNG ClipboardItem write synchronously before the Blob resolves", async () => {
		const payload = deferred<Blob>();
		const nativePayloadConsumed = vi.fn();
		const writeImageDeferred = vi.fn((value: Promise<Blob>) =>
			value.then((blob) => {
				nativePayloadConsumed(blob);
			}),
		);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred,
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");

		const result = clipboard.writeImageDeferred(payload.promise);
		expect(writeImageDeferred).toHaveBeenCalledOnce();
		expect(nativePayloadConsumed).not.toHaveBeenCalled();

		payload.resolve(new Blob(["png"], { type: "image/png" }));
		await expect(result).resolves.toEqual({ status: "written" });
		expect(nativePayloadConsumed).toHaveBeenCalledOnce();
	});

	it("rejects empty, non-PNG, non-Blob, and oversized image payloads explicitly", async () => {
		const writeImageDeferred = vi.fn((value: Promise<Blob>) =>
			value.then(() => undefined),
		);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred,
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");

		await expect(
			clipboard.writeImageDeferred(
				Promise.resolve(new Blob([], { type: "image/png" })),
			),
		).resolves.toEqual({
			code: "editor-clipboard-image-invalid",
			status: "failed",
		});
		await expect(
			clipboard.writeImageDeferred(
				Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" })),
			),
		).resolves.toEqual({
			code: "editor-clipboard-image-invalid",
			status: "failed",
		});
		await expect(
			clipboard.writeImageDeferred(
				Promise.resolve("not-a-blob" as unknown as Blob),
			),
		).resolves.toEqual({
			code: "editor-clipboard-image-invalid",
			status: "failed",
		});
		await expect(
			clipboard.writeImageDeferred(
				Promise.resolve(new Blob(["1234"], { type: "image/png" })),
				{ maxBytes: 3 },
			),
		).resolves.toEqual({
			code: "editor-clipboard-image-too-large",
			status: "failed",
		});
	});

	it("reports payload rejection separately from native Clipboard rejection", async () => {
		const payload = deferred<Blob>();
		const writeImageDeferred = vi.fn((value: Promise<Blob>) =>
			value.then(() => undefined),
		);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred,
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");

		const payloadResult = clipboard.writeImageDeferred(payload.promise);
		expect(writeImageDeferred).toHaveBeenCalledOnce();
		payload.reject(new Error("image generation failed"));
		await expect(payloadResult).resolves.toEqual({
			code: "editor-clipboard-image-payload-failed",
			status: "failed",
		});

		const denied = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred: vi
				.fn()
				.mockRejectedValue(new Error("permission denied")),
			writeText: vi.fn(),
		});
		if (!denied.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");
		await expect(
			denied.writeImageDeferred(
				Promise.resolve(new Blob(["png"], { type: "image/png" })),
			),
		).resolves.toEqual({
			code: "editor-clipboard-write-failed",
			status: "failed",
		});
	});

	it("requires the runtime PNG capability and does not call an unsupported writer", async () => {
		const writeImageDeferred = vi.fn();
		const supportsPngWrite = vi.fn(() => false);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			supportsPngWrite,
			writeImageDeferred,
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");

		if (!clipboard.supportsPngWrite)
			throw new Error("clipboard-capability-fixture-missing");
		expect(clipboard.supportsPngWrite()).toBe(false);
		await expect(
			clipboard.writeImageDeferred(
				Promise.resolve(new Blob(["png"], { type: "image/png" })),
			),
		).resolves.toEqual({
			code: "editor-clipboard-unsupported",
			status: "failed",
		});
		expect(supportsPngWrite).toHaveBeenCalled();
		expect(writeImageDeferred).not.toHaveBeenCalled();
	});

	it("cancels before native setup and protects a late payload after abort", async () => {
		const before = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred: vi.fn(),
			writeText: vi.fn(),
		});
		if (!before.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");
		const beforeController = new AbortController();
		beforeController.abort();
		await expect(
			before.writeImageDeferred(
				Promise.resolve(new Blob(["png"], { type: "image/png" })),
				{
					signal: beforeController.signal,
				},
			),
		).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});

		const payload = deferred<Blob>();
		const nativePayloadConsumed = vi.fn();
		const nativePayloadRejected = vi.fn();
		const writeImageDeferred = vi.fn((value: Promise<Blob>) =>
			value
				.then(nativePayloadConsumed, nativePayloadRejected)
				.then(() => undefined),
		);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred,
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");
		const controller = new AbortController();
		const result = clipboard.writeImageDeferred(payload.promise, {
			signal: controller.signal,
		});
		expect(writeImageDeferred).toHaveBeenCalledOnce();
		controller.abort();
		await expect(result).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});
		payload.resolve(new Blob(["late"], { type: "image/png" }));
		await Promise.resolve();
		expect(nativePayloadConsumed).not.toHaveBeenCalled();
		expect(nativePayloadRejected).toHaveBeenCalledOnce();
	});

	it("protects a late rejected payload after disposal without an unhandled rejection", async () => {
		const payload = deferred<Blob>();
		const nativePayloadRejected = vi.fn();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred: vi.fn((value: Promise<Blob>) =>
				value.then(() => undefined, nativePayloadRejected),
			),
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");

		const result = clipboard.writeImageDeferred(payload.promise);
		clipboard.dispose();
		await expect(result).resolves.toEqual({
			code: "editor-clipboard-disposed",
			status: "failed",
		});
		payload.reject(new Error("late image generation failed"));
		await Promise.resolve();
		expect(nativePayloadRejected).toHaveBeenCalledOnce();
	});

	it("returns cancellation when a stale native write completes after abort", async () => {
		const nativeWrite = deferred<void>();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeImageDeferred: vi.fn((value: Promise<Blob>) => {
				void value.catch(() => undefined);
				return nativeWrite.promise;
			}),
			writeText: vi.fn(),
		});
		if (!clipboard.writeImageDeferred)
			throw new Error("image-clipboard-fixture-missing");
		const controller = new AbortController();
		const result = clipboard.writeImageDeferred(
			Promise.resolve(new Blob(["png"], { type: "image/png" })),
			{ signal: controller.signal },
		);
		controller.abort();
		nativeWrite.resolve();
		await expect(result).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});
	});

	it("detects rich support only when both MIME types are supported and starts both deferred payloads synchronously", async () => {
		const payload = deferred<{ html: string; text: string }>();
		const writes: ClipboardItemStub[] = [];
		const nativeWrite = vi.fn((items: unknown[]) => {
			writes.push(items[0] as ClipboardItemStub);
			return Promise.resolve();
		});
		class ClipboardItemStub {
			static supports = vi.fn(
				(type: string) => "text/html" === type || "text/plain" === type,
			);
			constructor(readonly payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		vi.stubGlobal("navigator", {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
				write: nativeWrite,
				writeText: vi.fn().mockResolvedValue(undefined),
			},
		});
		vi.stubGlobal("ClipboardItem", ClipboardItemStub);

		try {
			const clipboard = createBrowserEditorClipboard();
			if (!clipboard.supportsRichWrite || !clipboard.writeRichDeferred) {
				throw new Error("rich-clipboard-fixture-missing");
			}
			expect(clipboard.supportsRichWrite()).toBe(true);
			const result = clipboard.writeRichDeferred(payload.promise);
			expect(nativeWrite).toHaveBeenCalledOnce();
			expect(writes[0]?.payload["text/html"]).toBeInstanceOf(Promise);
			expect(writes[0]?.payload["text/plain"]).toBeInstanceOf(Promise);

			payload.resolve({ html: "<p>Rich</p>", text: "Rich" });
			await expect(result).resolves.toEqual({ status: "written" });
			await expect(writes[0]?.payload["text/html"]).resolves.toEqual(
				expect.objectContaining({ type: "text/html" }),
			);
			await expect(writes[0]?.payload["text/plain"]).resolves.toEqual(
				expect.objectContaining({ type: "text/plain" }),
			);
			expect(ClipboardItemStub.supports).toHaveBeenCalledWith("text/html");
			expect(ClipboardItemStub.supports).toHaveBeenCalledWith("text/plain");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("does not call a rich writer when either native MIME capability is denied", async () => {
		const writeRichDeferred = vi.fn();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			supportsRichWrite: vi.fn(() => false),
			writeRichDeferred,
			writeText: vi.fn(),
		});

		if (!clipboard.writeRichDeferred || !clipboard.supportsRichWrite) {
			throw new Error("rich-clipboard-fixture-missing");
		}
		expect(clipboard.supportsRichWrite()).toBe(false);
		await expect(
			clipboard.writeRichDeferred(
				Promise.resolve({ html: "<p>x</p>", text: "x" }),
			),
		).resolves.toEqual({
			code: "editor-clipboard-unsupported",
			status: "failed",
		});
		expect(writeRichDeferred).not.toHaveBeenCalled();
	});

	it("observes both derived MIME payloads when native rich setup throws", async () => {
		const payload = deferred<{ html: string; text: string }>();
		class ThrowingClipboardItem {
			static supports = vi.fn(() => true);

			constructor(_value: Record<string, Blob | PromiseLike<Blob>>) {
				throw new Error("native setup failed");
			}
		}
		vi.stubGlobal("navigator", {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
				write: vi.fn(),
				writeText: vi.fn().mockResolvedValue(undefined),
			},
		});
		vi.stubGlobal("ClipboardItem", ThrowingClipboardItem);

		try {
			const clipboard = createBrowserEditorClipboard();
			if (!clipboard.writeRichDeferred)
				throw new Error("rich-clipboard-fixture-missing");
			const result = clipboard.writeRichDeferred(payload.promise);
			await expect(result).resolves.toEqual({
				code: "editor-clipboard-write-failed",
				status: "failed",
			});
			payload.reject(new Error("late renderer failure"));
			await Promise.resolve();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("rejects empty, malformed, and per-MIME oversized rich payloads", async () => {
		const writeRichDeferred = vi.fn(
			(payload: Promise<{ html: string; text: string }>) =>
				payload.then(() => undefined),
		);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeRichDeferred,
			writeText: vi.fn(),
		});
		if (!clipboard.writeRichDeferred)
			throw new Error("rich-clipboard-fixture-missing");

		await expect(
			clipboard.writeRichDeferred(Promise.resolve({ html: "", text: "text" })),
		).resolves.toEqual({
			code: "editor-clipboard-rich-payload-invalid",
			status: "failed",
		});
		await expect(
			clipboard.writeRichDeferred(
				Promise.resolve({ html: "<p>é</p>", text: "text" }),
				{ maxBytes: 2 },
			),
		).resolves.toEqual({
			code: "editor-clipboard-rich-payload-too-large",
			status: "failed",
		});
		await expect(
			clipboard.writeRichDeferred(
				Promise.resolve({
					html: "<p>x</p>",
					text: "x",
					extra: "invalid",
				} as unknown as { html: string; text: string }),
			),
		).resolves.toEqual({
			code: "editor-clipboard-rich-payload-invalid",
			status: "failed",
		});
	});

	it("reports rich payload rejection and native denial without claiming success", async () => {
		const payload = deferred<{ html: string; text: string }>();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeRichDeferred: vi.fn(
				(value: Promise<{ html: string; text: string }>) =>
					value.then(() => undefined),
			),
			writeText: vi.fn(),
		});
		if (!clipboard.writeRichDeferred)
			throw new Error("rich-clipboard-fixture-missing");

		const payloadResult = clipboard.writeRichDeferred(payload.promise);
		payload.reject(new Error("renderer failed"));
		await expect(payloadResult).resolves.toEqual({
			code: "editor-clipboard-rich-payload-failed",
			status: "failed",
		});

		const denied = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeRichDeferred: vi
				.fn()
				.mockRejectedValue(new Error("permission denied")),
			writeText: vi.fn(),
		});
		if (!denied.writeRichDeferred)
			throw new Error("rich-clipboard-fixture-missing");
		await expect(
			denied.writeRichDeferred(
				Promise.resolve({ html: "<p>x</p>", text: "x" }),
			),
		).resolves.toEqual({
			code: "editor-clipboard-write-failed",
			status: "failed",
		});
	});

	it("cancels rich native consumption before a late payload resolves", async () => {
		const payload = deferred<{ html: string; text: string }>();
		const nativePayloadConsumed = vi.fn();
		const nativePayloadRejected = vi.fn();
		const nativeWrite = vi.fn(
			(value: Promise<{ html: string; text: string }>) =>
				value
					.then(nativePayloadConsumed, nativePayloadRejected)
					.then(() => undefined),
		);
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeRichDeferred: nativeWrite,
			writeText: vi.fn(),
		});
		if (!clipboard.writeRichDeferred)
			throw new Error("rich-clipboard-fixture-missing");

		const controller = new AbortController();
		const result = clipboard.writeRichDeferred(payload.promise, {
			signal: controller.signal,
		});
		expect(nativeWrite).toHaveBeenCalledOnce();
		controller.abort();
		await expect(result).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});
		payload.resolve({ html: "<p>late</p>", text: "late" });
		await Promise.resolve();
		expect(nativePayloadConsumed).not.toHaveBeenCalled();
		expect(nativePayloadRejected).toHaveBeenCalledOnce();
	});

	it("returns disposed for a rich write that completes after teardown", async () => {
		const nativeWrite = deferred<void>();
		const payload = deferred<{ html: string; text: string }>();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeRichDeferred: vi.fn(
				(value: Promise<{ html: string; text: string }>) => {
					void value.catch(() => undefined);
					return nativeWrite.promise;
				},
			),
			writeText: vi.fn(),
		});
		if (!clipboard.writeRichDeferred)
			throw new Error("rich-clipboard-fixture-missing");

		const result = clipboard.writeRichDeferred(payload.promise);
		clipboard.dispose();
		nativeWrite.resolve();
		await expect(result).resolves.toEqual({
			code: "editor-clipboard-disposed",
			status: "failed",
		});
		payload.resolve({ html: "<p>late</p>", text: "late" });
		await Promise.resolve();
	});

	it("returns cancellation when a stale rich native write completes after abort", async () => {
		const nativeWrite = deferred<void>();
		const clipboard = createBrowserEditorClipboard({
			readText: vi.fn(),
			writeRichDeferred: vi.fn(
				(value: Promise<{ html: string; text: string }>) => {
					void value.catch(() => undefined);
					return nativeWrite.promise;
				},
			),
			writeText: vi.fn(),
		});
		if (!clipboard.writeRichDeferred)
			throw new Error("rich-clipboard-fixture-missing");

		const controller = new AbortController();
		const result = clipboard.writeRichDeferred(
			Promise.resolve({ html: "<p>Rich</p>", text: "Rich" }),
			{ signal: controller.signal },
		);
		controller.abort();
		nativeWrite.resolve();
		await expect(result).resolves.toEqual({
			code: "editor-clipboard-cancelled",
			status: "failed",
		});
	});
});
