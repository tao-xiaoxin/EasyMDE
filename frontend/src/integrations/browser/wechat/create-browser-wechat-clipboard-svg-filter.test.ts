import { describe, expect, it, vi } from "vitest";

import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	blobText,
	declaration,
	declaredStyleValue,
	dispatchSuccessfulLegacyCopy,
	installClipboardTestEnvironment,
	prepareClipboard,
} from "./wechat-clipboard-test-fixtures";
import {
	createMarkup,
	createMarkupSynchronously,
} from "./wechat-portable-serialization";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function filterPreview(): HTMLElement {
	const preview = document.createElement("article");
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	preview.innerHTML = [
		'<div id="ordinary-html">ordinary</div>',
		'<svg id="diagram" viewBox="0 0 40 20">',
		'<defs><filter id="blur"><feGaussianBlur stdDeviation="1"></feGaussianBlur></filter></defs>',
		'<path id="bright" filter="url(#old)" d="M0 0H10"></path>',
		'<path id="none" filter="url(#old)" d="M0 1H10"></path>',
		'<path id="fragment" d="M0 2H10"></path>',
		'<path id="external" d="M0 3H10"></path>',
		'<foreignObject width="40" height="8"><div id="foreign-html">label</div></foreignObject>',
		"</svg>",
	].join("");
	Object.defineProperty(preview, "innerText", {
		configurable: true,
		value: "ordinary label",
	});
	return preview;
}

function filterRuntime(): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: (element, pseudoElement) => {
			if (pseudoElement)
				return declaration({ content: "none", display: "none" });
			const filter =
				element.id === "bright" || element.id === "foreign-html"
					? "brightness(1.2)"
					: element.id === "none"
						? "none"
						: element.id === "fragment"
							? "url(#blur)"
							: element.id === "external"
								? "url(https://external.test/filter.svg#blur)"
								: "none";
			if (element.namespaceURI === SVG_NAMESPACE) {
				return declaration({
					display: "inline",
					filter,
					fill: "none",
					stroke: "none",
				});
			}
			return declaration({ display: "block", filter });
		},
		getSelection: window.getSelection.bind(window),
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write: null,
	};
}

function assertPortableFilterProjection(holder: ParentNode): void {
	const bright = holder.querySelector("#bright");
	const none = holder.querySelector("#none");
	const fragment = holder.querySelector("#fragment");
	const external = holder.querySelector("#external");
	const ordinary =
		holder.querySelector("#ordinary-html") ??
		[...holder.querySelectorAll("section, div, p")].find(
			(element) => element.textContent?.trim() === "ordinary",
		) ??
		null;
	const foreignHtml = holder.querySelector("#foreign-html");
	if (!bright || !none || !fragment || !external || !ordinary || !foreignHtml) {
		throw new Error(
			`wechat-svg-filter-fixture-missing:${[
				!bright && "bright",
				!none && "none",
				!fragment && "fragment",
				!external && "external",
				!ordinary && "ordinary",
				!foreignHtml && "foreign-html",
			]
				.filter(Boolean)
				.join(",")}`,
		);
	}
	expect(bright.getAttribute("filter")).toBe("brightness(1.2)");
	expect(declaredStyleValue(bright, "filter")).toBe("");
	expect(none.getAttribute("filter")).toBe("none");
	expect(declaredStyleValue(none, "filter")).toBe("");
	expect(fragment.getAttribute("filter")).toBe("url(#blur)");
	expect(declaredStyleValue(fragment, "filter")).toBe("");
	expect(external.getAttribute("filter")).toBeNull();
	expect(declaredStyleValue(external, "filter")).toBe("");
	expect(ordinary.getAttribute("filter")).toBeNull();
	expect(declaredStyleValue(ordinary, "filter")).toBe("");
	expect(foreignHtml.namespaceURI).not.toBe(SVG_NAMESPACE);
	expect(foreignHtml.getAttribute("filter")).toBeNull();
	expect(declaredStyleValue(foreignHtml, "filter")).toBe("brightness(1.2)");
}

describe("createBrowserWechatClipboard SVG filter portability", () => {
	installClipboardTestEnvironment();

	it("rejects non-SVG and external filter promotion before the positive SVG path", async () => {
		const preview = filterPreview();
		const source = preview.innerHTML;
		const clone = await createMarkup(preview, filterRuntime(), new Map());
		assertPortableFilterProjection(clone);
		expect(preview.innerHTML).toBe(source);
	});

	it("promotes sanitized filters through async, sync, modern, and legacy serialization", async () => {
		const asyncPreview = filterPreview();
		const syncPreview = filterPreview();
		const asyncSource = asyncPreview.innerHTML;
		const syncSource = syncPreview.innerHTML;
		const runtime = filterRuntime();

		const asyncClone = await createMarkup(asyncPreview, runtime, new Map());
		const syncClone = createMarkupSynchronously(syncPreview, runtime);
		if (!syncClone) throw new Error("wechat-svg-filter-sync-clone-missing");
		assertPortableFilterProjection(asyncClone);
		assertPortableFilterProjection(syncClone);
		expect(asyncPreview.innerHTML).toBe(asyncSource);
		expect(syncPreview.innerHTML).toBe(syncSource);

		const apiPreview = filterPreview();
		const apiSource = apiPreview.innerHTML;
		const writes: unknown[] = [];
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const modern = createBrowserWechatClipboard({
			...runtime,
			clipboardItem: ClipboardItemStub,
			write: async (items) => {
				writes.push(items);
			},
		});
		await expect(modern.copy(apiPreview)).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		const item = (writes[0] as ClipboardItemStub[])[0];
		const htmlBlob = item?.payload["text/html"];
		if (!htmlBlob) throw new Error("wechat-svg-filter-modern-html-missing");
		const modernHtml = await blobText(htmlBlob);
		const modernHolder = document.createElement("div");
		modernHolder.innerHTML = modernHtml;
		assertPortableFilterProjection(modernHolder);

		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		let legacyHtml = "";
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn(() => {
				legacyHtml =
					document.querySelector(".easymde-copy-sandbox")?.innerHTML ?? "";
				dispatchSuccessfulLegacyCopy();
				return true;
			}),
		});
		try {
			const legacy = createBrowserWechatClipboard({
				...runtime,
				clipboardItem: null,
				write: null,
			});
			await prepareClipboard(legacy, apiPreview);
			await expect(legacy.copy(apiPreview)).resolves.toEqual({
				method: "legacy",
				status: "copied",
			});
		} finally {
			if (originalExecCommand)
				Object.defineProperty(document, "execCommand", originalExecCommand);
			else
				delete (document as unknown as { execCommand?: unknown }).execCommand;
		}
		expect(legacyHtml).toBe(modernHtml);
		const legacyHolder = document.createElement("div");
		legacyHolder.innerHTML = legacyHtml;
		assertPortableFilterProjection(legacyHolder);
		expect(apiPreview.innerHTML).toBe(apiSource);
	});
});
