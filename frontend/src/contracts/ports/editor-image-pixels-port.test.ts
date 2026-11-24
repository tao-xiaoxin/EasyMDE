import { describe, expect, it } from "vitest";

import {
	EDITOR_IMAGE_PIXELS_MAX_BYTES,
	EDITOR_IMAGE_PIXELS_MAX_DIMENSION,
	EDITOR_IMAGE_PIXELS_MAX_TOTAL_PIXELS,
	EDITOR_IMAGE_PIXELS_TIMEOUT_MS,
	type EditorImagePixelsFailureCode,
	type EditorImagePixelsPort,
	type EditorImagePixelsResult,
} from "./editor-image-pixels-port";

describe("EditorImagePixelsPort contract", () => {
	it("keeps the pixel and timeout budgets explicit", () => {
		expect(EDITOR_IMAGE_PIXELS_MAX_DIMENSION).toBe(4096);
		expect(EDITOR_IMAGE_PIXELS_MAX_TOTAL_PIXELS).toBe(16_000_000);
		expect(EDITOR_IMAGE_PIXELS_MAX_BYTES).toBe(16_777_216);
		expect(EDITOR_IMAGE_PIXELS_TIMEOUT_MS).toBe(10_000);
	});

	it("exposes capability, extraction, and teardown boundaries", () => {
		const methods: Array<keyof EditorImagePixelsPort> = [
			"supports",
			"canExtract",
			"extractPng",
			"dispose",
		];
		expect(new Set(methods).size).toBe(4);
	});

	it("keeps extraction and failure results explicit", () => {
		const extracted: EditorImagePixelsResult = {
			blob: new Blob(["png"], { type: "image/png" }),
			height: 40,
			pixelCount: 3_200,
			source: "https://example.test/image.png",
			status: "extracted",
			width: 80,
		};
		const failed: EditorImagePixelsResult = {
			code: "editor-image-pixels-lease-stale",
			status: "failed",
		};
		const codes: EditorImagePixelsFailureCode[] = [
			"editor-image-pixels-cancelled",
			"editor-image-pixels-lease-stale",
			"editor-image-pixels-tainted",
			"editor-image-pixels-timeout",
		];

		expect(extracted.status).toBe("extracted");
		expect(failed.status).toBe("failed");
		expect(new Set(codes).size).toBe(codes.length);
	});
});
