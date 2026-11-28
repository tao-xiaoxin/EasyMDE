import { describe, expect, it, vi } from "vitest";

import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import {
	computedStyle,
	installClipboardTestEnvironment,
} from "./wechat-clipboard-test-fixtures";
import * as preparation from "./wechat-prepared-payload";

describe("createBrowserWechatClipboard", () => {
	installClipboardTestEnvironment();

	it("rejects CSSOM changed after serialization before the transaction baseline", async () => {
		const css = document.createElement("style");
		css.textContent = ".race-source p { color: rgb(255, 0, 0); }";
		document.head.append(css);
		const preview = document.createElement("article");
		preview.className = "race-source";
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<p>Synthetic colour race</p>";
		document.body.append(preview);
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Synthetic colour race",
		});

		let mutated = false;
		const actual = preparation.preparedClipboardPayloadAfterWrite;
		vi.spyOn(
			preparation,
			"preparedClipboardPayloadAfterWrite",
		).mockImplementation(async (...args) => {
			const prepared = await actual(...args);
			void prepared.promise.then(() => {
				mutated = true;
				css.textContent = ".race-source p { color: rgb(0, 0, 255); }";
			});
			return prepared;
		});

		const writes: unknown[] = [];
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: async (items) => {
				writes.push(items);
				const item = items[0] as ClipboardItemStub;
				await item.payload["text/html"];
				await item.payload["text/plain"];
			},
		});

		try {
			const result = await clipboard.copy(preview);
			const paragraph = preview.querySelector("p");
			if (!paragraph) throw new Error("fidelity baseline paragraph missing");
			expect(writes).toHaveLength(1);
			expect(mutated).toBe(true);
			expect(window.getComputedStyle(paragraph).color).toBe("rgb(0, 0, 255)");
			expect(result).toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
		} finally {
			preview.remove();
			css.remove();
		}
	});

	it("rejects CSSOM changed after the final signature and before its publication", async () => {
		const css = document.createElement("style");
		css.textContent = ".final-race-source p { color: rgb(255, 0, 0); }";
		document.head.append(css);
		const preview = document.createElement("article");
		preview.className = "final-race-source";
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<p>Synthetic final colour race</p>";
		document.body.append(preview);
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Synthetic final colour race",
		});

		let mutated = false;
		const actual = preparation.preparedClipboardPayloadAfterWrite;
		vi.spyOn(
			preparation,
			"preparedClipboardPayloadAfterWrite",
		).mockImplementation(async (...args) => {
			const wrappedArgs = [...args] as Parameters<
				typeof preparation.preparedClipboardPayloadAfterWrite
			>;
			const publishSignature = wrappedArgs[12];
			if (publishSignature) {
				wrappedArgs[12] = (signature) => {
					mutated = true;
					css.textContent = ".final-race-source p { color: rgb(0, 0, 255); }";
					publishSignature(signature);
				};
			}
			return actual(...wrappedArgs);
		});

		const writes: unknown[] = [];
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: async (items) => {
				writes.push(items);
				const item = items[0] as ClipboardItemStub;
				await item.payload["text/html"];
				await item.payload["text/plain"];
			},
		});

		try {
			const result = await clipboard.copy(preview);
			expect(writes).toHaveLength(1);
			expect(mutated).toBe(true);
			expect(result).toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
		} finally {
			preview.remove();
			css.remove();
		}
	});
});
