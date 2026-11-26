// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
	executeModernCopyTransaction,
	type ModernClipboardRuntime,
	type ModernCopyTransaction,
} from "./wechat-clipboard-copy-transaction";
import { deferred } from "./wechat-clipboard-test-fixtures";
import { nativeVisualStyleProperties } from "./wechat-png-conversion";
import type { SerializedClipboardPayload } from "./wechat-portable-serialization";
import {
	COPY_STYLE_PROPERTIES,
	NATIVE_LAYOUT_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	SVG_STYLE_PROPERTIES,
} from "./wechat-style-policy";

function createModernRuntime(
	write: (items: unknown[]) => Promise<void>,
): ModernClipboardRuntime {
	class ClipboardItemStub {
		constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
	}
	return {
		blob: Blob,
		clipboardItem: ClipboardItemStub,
		document,
		getComputedStyle: window.getComputedStyle.bind(window),
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write,
	};
}

describe("executeModernCopyTransaction", () => {
	it("invokes assertBlobCurrent once for both htmlBlob and textBlob on payload resolution plus once on finalize", async () => {
		const payloadDeferred = deferred<SerializedClipboardPayload>();
		const assertBlobCurrent = vi.fn();
		const finalize = vi.fn(() => {
			assertBlobCurrent();
		});
		const cleanup = vi.fn();
		const finishTotal = vi.fn();
		let observedHtmlBlob: Promise<Blob> | null = null;
		let observedTextBlob: Promise<Blob> | null = null;

		const runtime = createModernRuntime(async (items) => {
			const item = items[0] as unknown as {
				payload: Record<string, Promise<Blob>>;
			};
			observedHtmlBlob = item.payload["text/html"] ?? null;
			observedTextBlob = item.payload["text/plain"] ?? null;
			const [htmlBlob, textBlob] = await Promise.all([
				observedHtmlBlob,
				observedTextBlob,
			]);
			expect(htmlBlob).toBeInstanceOf(Blob);
			expect(textBlob).toBeInstanceOf(Blob);
			expect(assertBlobCurrent).toHaveBeenCalledTimes(1);
		});

		const transaction: ModernCopyTransaction = {
			assertBlobCurrent,
			cleanup,
			defaultTimeoutMs: 5_000,
			finalize,
			finishTotal,
			onFailure: () => ({ code: "wechat-copy-failed", status: "failed" }),
			onSynchronousModernFailure: () => ({
				code: "wechat-copy-failed",
				status: "failed",
			}),
			payload: payloadDeferred.promise,
			preparationTimeoutCode: "wechat-clipboard-preparation-timeout",
			start: () => {
				payloadDeferred.resolve({ html: "<p>Hello</p>", text: "Hello" });
			},
		};

		const result = await executeModernCopyTransaction(
			runtime,
			{},
			() => false,
			transaction,
		);

		expect(result).toEqual({ method: "clipboard", status: "copied" });
		expect(assertBlobCurrent).toHaveBeenCalledTimes(2);
		expect(finalize).toHaveBeenCalledTimes(1);
		expect(finishTotal).toHaveBeenCalledWith("success");
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(observedHtmlBlob).not.toBeNull();
		expect(observedTextBlob).not.toBeNull();
	});

	it("rejects both htmlBlob and textBlob while invoking assertBlobCurrent once when validation throws", async () => {
		const payloadDeferred = deferred<SerializedClipboardPayload>();
		const assertBlobCurrent = vi.fn(() => {
			throw new Error("wechat-copy-stale");
		});
		const finalize = vi.fn();
		let htmlBlobPromise: Promise<Blob> | null = null;
		let textBlobPromise: Promise<Blob> | null = null;

		const runtime = createModernRuntime(async (items) => {
			const item = items[0] as unknown as {
				payload: Record<string, Promise<Blob>>;
			};
			htmlBlobPromise = item.payload["text/html"] ?? null;
			textBlobPromise = item.payload["text/plain"] ?? null;
			await Promise.all([htmlBlobPromise, textBlobPromise]);
		});

		const onFailure = vi.fn(() => ({
			code: "wechat-copy-failed" as const,
			status: "failed" as const,
		}));
		const transaction: ModernCopyTransaction = {
			assertBlobCurrent,
			cleanup: vi.fn(),
			defaultTimeoutMs: 5_000,
			finalize,
			finishTotal: vi.fn(),
			onFailure,
			onSynchronousModernFailure: () => ({
				code: "wechat-copy-failed",
				status: "failed",
			}),
			payload: payloadDeferred.promise,
			preparationTimeoutCode: "wechat-clipboard-preparation-timeout",
			start: () => {
				payloadDeferred.resolve({ html: "<p>Stale</p>", text: "Stale" });
			},
		};

		const result = await executeModernCopyTransaction(
			runtime,
			{},
			() => false,
			transaction,
		);

		expect(result).toEqual({ code: "wechat-copy-failed", status: "failed" });
		expect(assertBlobCurrent).toHaveBeenCalledTimes(1);
		expect(finalize).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
		await expect(htmlBlobPromise).rejects.toThrow("wechat-copy-stale");
		await expect(textBlobPromise).rejects.toThrow("wechat-copy-stale");
	});

	it("rejects both blobs immediately on abort without invoking assertBlobCurrent for a late payload", async () => {
		const controller = new AbortController();
		const payloadDeferred = deferred<SerializedClipboardPayload>();
		const assertBlobCurrent = vi.fn();
		let htmlBlobPromise: Promise<Blob> | null = null;
		let textBlobPromise: Promise<Blob> | null = null;

		const runtime = createModernRuntime(async (items) => {
			const item = items[0] as unknown as {
				payload: Record<string, Promise<Blob>>;
			};
			htmlBlobPromise = item.payload["text/html"] ?? null;
			textBlobPromise = item.payload["text/plain"] ?? null;
			await Promise.all([htmlBlobPromise, textBlobPromise]);
		});

		const transaction: ModernCopyTransaction = {
			assertBlobCurrent,
			cleanup: vi.fn(),
			defaultTimeoutMs: 5_000,
			finalize: vi.fn(),
			finishTotal: vi.fn(),
			onFailure: () => ({ code: "wechat-copy-failed", status: "failed" }),
			onSynchronousModernFailure: () => ({
				code: "wechat-copy-failed",
				status: "failed",
			}),
			payload: payloadDeferred.promise,
			preparationTimeoutCode: "wechat-clipboard-preparation-timeout",
			start: () => undefined,
		};

		const pendingCopy = executeModernCopyTransaction(
			runtime,
			{ signal: controller.signal },
			() => controller.signal.aborted,
			transaction,
		);
		controller.abort();

		const result = await pendingCopy;
		expect(result).toEqual({ code: "wechat-copy-failed", status: "failed" });
		await expect(htmlBlobPromise).rejects.toThrow("wechat-copy-cancelled");
		await expect(textBlobPromise).rejects.toThrow("wechat-copy-cancelled");

		payloadDeferred.resolve({ html: "<p>Late</p>", text: "Late" });
		await Promise.resolve();
		await Promise.resolve();
		expect(assertBlobCurrent).not.toHaveBeenCalled();
	});
});

describe("nativeVisualStyleProperties", () => {
	it("returns exact expected property sets and reuses static arrays without reallocating", () => {
		const computed = {} as CSSStyleDeclaration;
		const ordinaryHtml = document.createElement("p");
		const specialHtml = document.createElement("span");
		specialHtml.className = "katex";
		const ordinarySvg = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"g",
		);
		const specialSvg = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"svg",
		);

		const expectedOrdinary = [
			...new Set([
				...COPY_STYLE_PROPERTIES,
				...ORDINARY_LAYOUT_PROPERTIES,
				...NATIVE_LAYOUT_PROPERTIES,
			]),
		];
		const expectedSpecial = [
			...new Set([
				...COPY_STYLE_PROPERTIES,
				...SPECIAL_LAYOUT_PROPERTIES,
				...NATIVE_LAYOUT_PROPERTIES,
			]),
		];
		const expectedSvgOrdinary = [
			...new Set([
				...COPY_STYLE_PROPERTIES,
				...SVG_STYLE_PROPERTIES,
				...ORDINARY_LAYOUT_PROPERTIES,
				...NATIVE_LAYOUT_PROPERTIES,
			]),
		];
		const expectedSvgSpecial = [
			...new Set([
				...COPY_STYLE_PROPERTIES,
				...SVG_STYLE_PROPERTIES,
				...SPECIAL_LAYOUT_PROPERTIES,
				...NATIVE_LAYOUT_PROPERTIES,
			]),
		];

		const firstOrdinary = nativeVisualStyleProperties(ordinaryHtml, computed);
		const secondOrdinary = nativeVisualStyleProperties(ordinaryHtml, computed);
		expect(firstOrdinary).toEqual(expectedOrdinary);
		expect(secondOrdinary).toBe(firstOrdinary);

		const firstSpecial = nativeVisualStyleProperties(specialHtml, computed);
		const secondSpecial = nativeVisualStyleProperties(specialHtml, computed);
		expect(firstSpecial).toEqual(expectedSpecial);
		expect(secondSpecial).toBe(firstSpecial);

		const firstSvgOrdinary = nativeVisualStyleProperties(ordinarySvg, computed);
		const secondSvgOrdinary = nativeVisualStyleProperties(
			ordinarySvg,
			computed,
		);
		expect(firstSvgOrdinary).toEqual(expectedSvgOrdinary);
		expect(secondSvgOrdinary).toBe(firstSvgOrdinary);

		const firstSvgSpecial = nativeVisualStyleProperties(specialSvg, computed);
		const secondSvgSpecial = nativeVisualStyleProperties(specialSvg, computed);
		expect(firstSvgSpecial).toEqual(expectedSvgSpecial);
		expect(secondSvgSpecial).toBe(firstSvgSpecial);
	});
});
