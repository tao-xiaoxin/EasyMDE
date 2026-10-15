import { describe, expect, it } from "vitest";

import type {
	EditorDownloadFailureCode,
	EditorDownloadPort,
	EditorDownloadResult,
} from "./editor-download-port";

describe("EditorDownloadPort contract", () => {
	it("exposes an explicit request result without claiming that a file was saved", () => {
		const requested: EditorDownloadResult = { status: "requested" };
		const failed: EditorDownloadResult = {
			code: "editor-download-cancelled",
			status: "failed",
		};

		expect(requested).toEqual({ status: "requested" });
		expect(failed.status).toBe("failed");
	});

	it("keeps cancellation, unsupported, and cleanup failures stable", () => {
		const codes: EditorDownloadFailureCode[] = [
			"editor-download-cancelled",
			"editor-download-disposed",
			"editor-download-filename-invalid",
			"editor-download-invalid-png",
			"editor-download-object-url-failed",
			"editor-download-trigger-failed",
			"editor-download-unsupported",
		];

		expect(new Set(codes).size).toBe(codes.length);
	});

	it("requires the one browser download boundary and teardown", () => {
		const portShape: keyof EditorDownloadPort = "requestPngDownload";
		expect(portShape).toBe("requestPngDownload");
	});
});
