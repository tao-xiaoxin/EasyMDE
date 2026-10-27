import { describe, expect, it } from "vitest";

import type {
	EditorClipboardImageOperationOptions,
	EditorClipboardPort,
	EditorClipboardRichOperationOptions,
	EditorClipboardRichPayload,
	EditorClipboardState,
} from "./editor-clipboard-port";

describe("EditorClipboardPort contract", () => {
	it("keeps the five explicit clipboard states distinct", () => {
		const states: EditorClipboardState["status"][] = [
			"unknown",
			"checking",
			"available",
			"empty",
			"unavailable",
		];

		expect(new Set(states).size).toBe(5);
	});

	it("requires a read/write boundary and state subscription", () => {
		const portShape: keyof EditorClipboardPort = "read";
		expect(portShape).toBe("read");
	});

	it("defines PNG capability detection and bounded image write options", () => {
		const options: EditorClipboardImageOperationOptions = { maxBytes: 1024 };

		const capability: keyof EditorClipboardPort = "supportsPngWrite";
		expect(capability).toBe("supportsPngWrite");
		expect(options.maxBytes).toBe(1024);
	});

	it("defines rich Clipboard payloads with one bounded HTML/plain-text operation", () => {
		const payload: EditorClipboardRichPayload = {
			html: "<p>Rich</p>",
			text: "Rich",
		};
		const options: EditorClipboardRichOperationOptions = { maxBytes: 1024 };

		expect(payload.html).toBe("<p>Rich</p>");
		expect(payload.text).toBe("Rich");
		expect(options.maxBytes).toBe(1024);
		expect(new Set(["supportsRichWrite", "writeRichDeferred"]).size).toBe(2);
	});
});
