// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import {
	blobText,
	computedStyle,
	declaration,
	deferred,
	installClipboardTestEnvironment,
	pngOptions,
	prepareClipboard,
} from "./wechat-clipboard-test-fixtures";

type StyleValues = Readonly<Record<string, string>>;

const tableStyles: StyleValues = {
	display: "block",
	"animation-name": "none",
	width: "335px",
	"table-layout": "auto",
	"border-collapse": "collapse",
	"border-spacing": "2px",
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"border-top-style": "none",
	"border-right-style": "none",
	"border-bottom-style": "none",
	"border-left-style": "none",
	"border-top-width": "0px",
	"border-right-width": "0px",
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-radius": "0px",
	"border-top-left-radius": "0px",
	"border-top-right-radius": "0px",
	"border-bottom-right-radius": "0px",
	"border-bottom-left-radius": "0px",
	"box-shadow": "none",
	"padding-top": "0px",
	"padding-right": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
	"margin-top": "0px",
	"margin-right": "0px",
	"margin-bottom": "0px",
	"margin-left": "0px",
	"overflow-x": "visible",
	"overflow-y": "visible",
};

const groupStyles: StyleValues = {
	display: "contents",
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"border-top-style": "none",
	"border-right-style": "none",
	"border-bottom-style": "none",
	"border-left-style": "none",
	"border-top-width": "0px",
	"border-right-width": "0px",
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-radius": "0px",
	"border-top-left-radius": "0px",
	"border-top-right-radius": "0px",
	"border-bottom-right-radius": "0px",
	"border-bottom-left-radius": "0px",
	"box-shadow": "none",
	"padding-top": "0px",
	"padding-right": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
};

const pseudoStyles: StyleValues = {
	content: '""',
	"animation-name": "none",
	display: "table-caption",
	width: "335px",
	height: "0px",
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"border-top-style": "none",
	"border-right-style": "none",
	"border-bottom-style": "none",
	"border-left-style": "none",
	"border-top-width": "0px",
	"border-right-width": "0px",
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-radius": "0px",
	"border-top-left-radius": "0px",
	"border-top-right-radius": "0px",
	"border-bottom-right-radius": "0px",
	"border-bottom-left-radius": "0px",
	"box-shadow": "none",
	"padding-top": "0px",
	"padding-right": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
	"margin-top": "0px",
	"margin-right": "0px",
	"margin-bottom": "0px",
	"margin-left": "0px",
};

function style(values: StyleValues): CSSStyleDeclaration {
	return declaration(values);
}

function rect(width: number, height: number): DOMRect {
	return {
		bottom: height,
		height,
		left: 0,
		right: width,
		top: 0,
		width,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} as DOMRect;
}

function tablePreview(): HTMLElement {
	const preview = document.createElement("article");
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	preview.innerHTML =
		'<div class="theme"><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table></div>';
	Object.defineProperty(preview, "innerText", {
		configurable: true,
		value: "Name Status\nEasyMDE Ready",
	});
	const table = preview.querySelector("table");
	if (!table) throw new Error("table missing");
	const tableRect = rect(335, 133);
	Object.defineProperty(table, "getBoundingClientRect", {
		configurable: true,
		value: () => tableRect,
	});
	Object.defineProperty(table.parentElement, "getBoundingClientRect", {
		configurable: true,
		value: () => tableRect,
	});
	table.querySelectorAll("tr").forEach((row) => {
		let right = 0;
		Array.from(row.children).forEach((cell) => {
			right += 111.6666666667;
			Object.defineProperty(cell, "getBoundingClientRect", {
				configurable: true,
				value: () => {
					const width = 111.6666666667;
					return { ...rect(width, 33), left: right - width, right };
				},
			});
		});
	});
	document.body.append(preview);
	return preview;
}

function runtimeFor(
	preview: HTMLElement,
	write: (items: unknown[]) => Promise<void>,
	overrides: Partial<Parameters<typeof createBrowserWechatClipboard>[0]> = {},
) {
	const table = preview.querySelector("table");
	if (!table) throw new Error("table missing");
	const cells = Array.from(table.querySelectorAll("th, td"));
	const widthRule = document.createElement("style");
	widthRule.setAttribute("data-table-grid-test", "");
	widthRule.textContent = ".theme table::before{width:100cqi}";
	document.head.append(widthRule);
	const styleSheets = widthRule.sheet ? [widthRule.sheet] : [];
	const runtimeDocument = Object.create(document) as Document;
	Object.defineProperty(runtimeDocument, "styleSheets", {
		configurable: true,
		value: styleSheets,
	});
	return {
		blob: Blob,
		clipboardItem: class {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		},
		document: runtimeDocument,
		getComputedStyle: (element: Element, pseudoElement?: string) => {
			if (pseudoElement) return style(pseudoStyles);
			if (element === table) return style(tableStyles);
			if (element.parentElement === table) return style(groupStyles);
			if (element.tagName === "TR") return style({ display: "table-row" });
			if (cells.includes(element)) return style({ display: "table-cell" });
			return style({ display: "block", width: "335px" });
		},
		getSelection: window.getSelection.bind(window),
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write,
		...overrides,
	};
}

function markTableChanged(preview: HTMLElement): void {
	const table = preview.querySelector("table");
	if (!table) throw new Error("table missing");
	table.setAttribute("data-table-source-changed", "1");
}

function expectNoHiddenMeasurementLeases(): void {
	expect(
		document.querySelectorAll(".easymde-wechat-preview-measurement"),
	).toHaveLength(0);
}

function pendingWriteRuntime(
	workspace: HTMLElement,
	write: (items: unknown[]) => Promise<void>,
) {
	class ClipboardItemStub {
		constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
	}
	return {
		blob: Blob,
		clipboardItem: ClipboardItemStub,
		document,
		getComputedStyle: (element: Element, pseudoElement?: string) => {
			if ("::before" === pseudoElement || "::after" === pseudoElement)
				return computedStyle(element, pseudoElement);
			if (element === workspace)
				return style({ display: "none", width: "400px" });
			return style({ display: "block", width: "335px" });
		},
		getSelection: window.getSelection.bind(window),
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write,
	};
}

function hiddenPendingWritePreview(): Readonly<{
	preview: HTMLElement;
	workspace: HTMLElement;
}> {
	const workspace = document.createElement("div");
	workspace.className = "table-grid-test-workspace";
	const preview = document.createElement("article");
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	preview.innerHTML = "<p>Pending write</p>";
	Object.defineProperty(preview, "innerText", {
		configurable: true,
		value: "Pending write",
	});
	workspace.append(preview);
	document.body.append(workspace);
	return { preview, workspace };
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("WeChat native table grid transaction integration", () => {
	installClipboardTestEnvironment();

	afterEach(() => {
		document.head
			.querySelectorAll("style[data-table-grid-test]")
			.forEach((style) => {
				style.remove();
			});
		document.body
			.querySelectorAll(".table-grid-test-workspace")
			.forEach((workspace) => {
				workspace.remove();
			});
	});

	it("serializes a native table after the existing scroll section", async () => {
		const preview = tablePreview();
		let writes: unknown[] = [];
		const clipboard = createBrowserWechatClipboard(
			runtimeFor(preview, async (items) => {
				writes = items;
			}),
		);

		await prepareClipboard(clipboard, preview);
		await expect(clipboard.copy(preview)).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		const item = writes[0] as {
			payload: Record<string, Blob | PromiseLike<Blob>>;
		};
		const htmlBlob = item.payload["text/html"];
		if (!htmlBlob) throw new Error("clipboard html missing");
		const html = await blobText(htmlBlob);
		const holder = document.createElement("div");
		holder.innerHTML = html;
		const table = holder.querySelector("table");
		expect(table?.parentElement?.tagName).toBe("SECTION");
		expect(table?.getAttribute("style")).toContain("display:table!important");
		expect(table?.parentElement?.getAttribute("style")).toContain(
			"overflow-x:auto!important",
		);
	});

	it("rejects a source-table mutation after Blob delivery before write", async () => {
		const blobDelivered = deferred<void>();
		const releaseWrite = deferred<void>();
		const preview = tablePreview();
		const clipboard = createBrowserWechatClipboard(
			runtimeFor(preview, async (items) => {
				const item = items[0] as {
					payload: Record<string, Blob | PromiseLike<Blob>>;
				};
				await item.payload["text/html"];
				blobDelivered.resolve();
				await releaseWrite.promise;
			}),
		);

		const result = clipboard.copy(preview);
		await blobDelivered.promise;
		markTableChanged(preview);
		releaseWrite.resolve();
		await expect(result).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expectNoHiddenMeasurementLeases();
	});

	it("rejects a source-table mutation while the modern write is pending", async () => {
		const pending = deferred<void>();
		const preview = tablePreview();
		const clipboard = createBrowserWechatClipboard(
			runtimeFor(preview, async () => {
				await pending.promise;
			}),
		);

		const result = clipboard.copy(preview);
		await vi.waitFor(() =>
			expect(
				document.querySelectorAll(".easymde-wechat-preview-measurement").length,
			).toBe(0),
		);
		markTableChanged(preview);
		pending.resolve();
		await expect(result).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expectNoHiddenMeasurementLeases();
	});

	it("rejects an equal-geometry table rule change after Blob delivery", async () => {
		const blobDelivered = deferred<void>();
		const releaseWrite = deferred<void>();
		const preview = tablePreview();
		const clipboard = createBrowserWechatClipboard(
			runtimeFor(preview, async (items) => {
				const item = items[0] as {
					payload: Record<string, Blob | PromiseLike<Blob>>;
				};
				await item.payload["text/html"];
				blobDelivered.resolve();
				await releaseWrite.promise;
			}),
		);
		const authorRule = document
			.querySelector<HTMLStyleElement>("style[data-table-grid-test]")
			?.sheet?.cssRules.item(0);
		if (!(authorRule instanceof CSSStyleRule)) {
			throw new Error("table grid CSS rule missing");
		}

		const table = preview.querySelector("table");
		if (!table) throw new Error("table missing");
		const previewMarkup = preview.outerHTML;
		const tableWidth = table.getBoundingClientRect().width;
		const tableHeight = table.getBoundingClientRect().height;

		const result = clipboard.copy(preview);
		await blobDelivered.promise;
		authorRule.style.setProperty("width", "335px");
		expect(authorRule.style.getPropertyValue("width")).toBe("335px");
		expect(table.getBoundingClientRect().width).toBe(tableWidth);
		expect(table.getBoundingClientRect().height).toBe(tableHeight);
		expect(table.getAttribute("style")).toBeNull();
		expect(preview.outerHTML).toBe(previewMarkup);
		releaseWrite.resolve();
		await expect(result).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expectNoHiddenMeasurementLeases();
	});

	it.each([false, true] as const)(
		"cleans a hidden measurement promptly after aborting a pending PNG=%s write",
		async (pngConversionEnabled) => {
			const { preview, workspace } = hiddenPendingWritePreview();
			const controller = new AbortController();
			const blobsConsumed = deferred<void>();
			const releaseWrite = deferred<void>();
			const write = vi.fn(async (items: unknown[]) => {
				const item = items[0] as {
					payload: Record<string, Blob | PromiseLike<Blob>>;
				};
				const html = item.payload["text/html"];
				const text = item.payload["text/plain"];
				if (!html || !text) throw new Error("pending-write blobs missing");
				await Promise.all([html, text]);
				blobsConsumed.resolve(undefined);
				await releaseWrite.promise;
			});
			const clipboard = createBrowserWechatClipboard(
				pendingWriteRuntime(workspace, write),
			);
			const options = pngConversionEnabled
				? pngOptions(
						{
							rasterize: async () => {
								throw new Error("unexpected rasterization");
							},
						},
						{
							upload: async () => {
								throw new Error("unexpected upload");
							},
						},
						{ signal: controller.signal },
					)
				: { signal: controller.signal };
			let settled = false;
			const copy = clipboard.copy(preview, options).finally(() => {
				settled = true;
			});

			try {
				await blobsConsumed.promise;
				const host = document.querySelector(
					".easymde-wechat-preview-measurement",
				);
				expect(host).not.toBeNull();
				controller.abort();
				await delay(25);
				expect(settled).toBe(true);
				expect(host?.isConnected).toBe(false);
				await expect(copy).resolves.toEqual(
					pngConversionEnabled
						? {
								code: "wechat-png-rasterization-cancelled",
								sideEffects: "none",
								status: "failed",
							}
						: { code: "wechat-copy-failed", status: "failed" },
				);
				expect(write).toHaveBeenCalledOnce();
			} finally {
				releaseWrite.resolve(undefined);
				await copy.then(
					() => undefined,
					() => undefined,
				);
				controller.abort();
				workspace.remove();
			}
		},
	);

	it("releases the hidden measurement exactly once across repeated terminal copies", async () => {
		const preview = tablePreview();
		const clipboard = createBrowserWechatClipboard(
			runtimeFor(preview, async (items) => {
				const item = items[0] as {
					payload: Record<string, Blob | PromiseLike<Blob>>;
				};
				await item.payload["text/html"];
				throw new Error("modern-write-failed");
			}),
		);

		await expect(clipboard.copy(preview)).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expectNoHiddenMeasurementLeases();
		await expect(clipboard.copy(preview)).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expectNoHiddenMeasurementLeases();
	});
});
