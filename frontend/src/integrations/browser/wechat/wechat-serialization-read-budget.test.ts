import {
	describe,
	expect,
	it,
	vi,
} from "vitest";

import type { SerializationYield } from "./wechat-clipboard-runtime";
import {
	declaration,
	mockStyleRuntime as mockRuntime,
} from "./wechat-clipboard-test-fixtures";
import {
	collectPreparedSignatures,
	collectPreparedSignaturesWithYield,
} from "./wechat-fidelity-signature";
import {
	createNativeVisualCaptureClone,
	nativeVisualStyleDeclarations,
} from "./wechat-png-conversion";
import type { WechatPngConversionContext } from "./wechat-png-conversion-policy";
import { styleDeclarations } from "./wechat-pseudo-elements";
import { createWechatTreePredicateCache } from "./wechat-tree-predicates";

describe("WeChat serialization yield and read budgets", () => {
	it("checks shouldYield once per element in styleDeclarations, nativeVisualStyleDeclarations, and preparedLayoutSignatureWithYield", async () => {
		const preview = document.createElement("article");
		preview.innerHTML = "<p>One</p><p>Two</p>";
		const p = preview.querySelector("p") as HTMLElement;
		const measured = declaration({
			display: "block",
			color: "rgb(10, 20, 30)",
			position: "static",
			"max-height": "none",
		});
		const runtime = mockRuntime((_el, pseudo) =>
			pseudo ? declaration({ content: "none" }) : measured,
		);

		const styleShouldYield = vi.fn(() => false);
		const styleYield = Object.assign(
			vi.fn(async () => undefined),
			{ shouldYield: styleShouldYield },
		) as SerializationYield;
		await styleDeclarations(p, measured, false, false, runtime, new Map(), styleYield);
		expect(styleShouldYield).toHaveBeenCalledTimes(1);

		const nativeShouldYield = vi.fn(() => false);
		const nativeYield = Object.assign(
			vi.fn(async () => undefined),
			{ shouldYield: nativeShouldYield },
		) as SerializationYield;
		const nativeDecls = await nativeVisualStyleDeclarations(
			p,
			measured,
			runtime,
			new Map(),
			nativeYield,
		);
		expect(nativeShouldYield).toHaveBeenCalledTimes(1);
		// Native PNG capture keeps default values (`omitDefaultValues = false`).
		expect(nativeDecls).toContain("position:static");
		expect(nativeDecls).toContain("max-height:none");

		// createNativeVisualCaptureClone still strips transient attributes from every descendant.
		const captureSource = document.createElement("div");
		captureSource.setAttribute("data-temp", "1");
		captureSource.innerHTML = '<span data-child="2" aria-label="x">Text</span>';
		const pngContext: WechatPngConversionContext = {
			captureBoundary: captureSource,
			imageUploadPort: { upload: vi.fn() },
			maxBytes: 1024,
			mermaidSnapshots: new Map(),
			postId: 1,
			rasterizationPort: { rasterize: vi.fn() },
			scale: 1,
			signal: new AbortController().signal,
			state: { uploadsMayRemain: false },
		};
		const captured = await createNativeVisualCaptureClone(
			captureSource,
			runtime,
			new Map(),
			null,
			pngContext,
		);
		expect(captured.element.hasAttribute("data-temp")).toBe(false);
		expect(
			captured.element.querySelector("span")?.hasAttribute("data-child"),
		).toBe(false);
		expect(
			captured.element.querySelector("span")?.hasAttribute("aria-label"),
		).toBe(false);

		const sigShouldYield = vi.fn(() => false);
		const sigYield = Object.assign(
			vi.fn(async () => undefined),
			{ shouldYield: sigShouldYield },
		) as SerializationYield;
		const syncSignature = collectPreparedSignatures({ preview, runtime, includeDimension: false }).layout;
		const asyncSignature = (await collectPreparedSignaturesWithYield({
			preview,
			runtime,
			yieldToBrowser: sigYield,
			includeDimension: false,
		})).layout;
		expect(asyncSignature).toBe(syncSignature);
		// 3 elements in `preview` (`article`, `p`, `p`) -> 1 shouldYield check per element.
		expect(sigShouldYield).toHaveBeenCalledTimes(3);
	});

	it("caches per-element pruning computed-style queries across styleDeclarations and passes svg predicates through native visual capture", async () => {
		const paragraph = document.createElement("p");
		const rawComputed = declaration({
			background:
				"rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box",
			"background-image": "none",
			"background-position": "0% 0%",
			"background-repeat": "repeat",
			"background-size": "auto",
			"border-top-width": "0px",
			"border-top-style": "none",
			"border-top-color": "rgb(34, 34, 34)",
			"border-right-width": "0px",
			"border-right-style": "none",
			"border-right-color": "rgb(34, 34, 34)",
			"border-bottom-width": "2px",
			"border-bottom-style": "solid",
			"border-bottom-color": "rgb(200, 10, 20)",
			"border-left-width": "0px",
			"border-left-style": "none",
			"border-left-color": "rgb(34, 34, 34)",
			"border-collapse": "separate",
			"border-spacing": "0px",
			display: "block",
			color: "rgb(34, 34, 34)",
		});
		const readCounts = new Map<string, number>();
		const trackedComputed = {
			getPropertyValue: (property: string): string => {
				readCounts.set(property, (readCounts.get(property) ?? 0) + 1);
				return rawComputed.getPropertyValue(property);
			},
		} as unknown as CSSStyleDeclaration;

		const declarations = await styleDeclarations(
			paragraph,
			trackedComputed,
			false,
			false,
			mockRuntime(() => trackedComputed),
			new Map(),
		);
		expect(declarations).toContain("border-bottom-width:2px");
		expect(declarations).toContain("border-bottom-style:solid");
		expect(declarations).toContain("border-bottom-color:rgb(200, 10, 20)");
		expect(
			declarations.some((entry) => entry.startsWith("border-top-")),
		).toBe(false);
		expect(
			declarations.some((entry) => entry.startsWith("background")),
		).toBe(false);
		expect(
			declarations.some((entry) => entry.startsWith("border-collapse:")),
		).toBe(false);
		expect(
			declarations.some((entry) => entry.startsWith("border-spacing:")),
		).toBe(false);
		// Each side style/width is read at most once by pruning (+1 for the main property loop).
		expect(readCounts.get("border-top-style")).toBe(2);
		expect(readCounts.get("border-top-width")).toBe(2);
		// Bordered bottom edge short-circuits before reading border-bottom-width in pruning.
		expect(readCounts.get("border-bottom-style")).toBe(2);
		expect(readCounts.get("border-bottom-width")).toBe(1);
		// Background image/shorthand pruning reads once across all 4 background sub-properties (+1 main loop).
		expect(readCounts.get("background-image")).toBe(2);
		expect(readCounts.get("background")).toBe(2);
		// Table display check runs at most once across border-collapse and border-spacing (+1 main loop).
		expect(readCounts.get("display")).toBe(2);

		// nativeVisualStyleDeclarations reuses the pass-local tree predicate cache once per element
		// rather than walking ancestors on every CSS property inside keepStyle.
		const container = document.createElement("div");
		container.className = "easymde-math-inline";
		const katex = document.createElement("span");
		katex.className = "katex";
		const leaf = document.createElement("span");
		katex.append(leaf);
		container.append(katex);
		const predicates = createWechatTreePredicateCache();
		const isSvgSpy = vi.spyOn(predicates, "isSvgElement");
		const specialSpy = vi.spyOn(predicates, "supportsSpecialLayout");
		const nativeMeasured = declaration({
			display: "inline-block",
			color: "rgb(10, 20, 30)",
			position: "relative",
			"vertical-align": "baseline",
		});
		const nativeDecls = await nativeVisualStyleDeclarations(
			leaf,
			nativeMeasured,
			mockRuntime(() => nativeMeasured),
			new Map(),
			null,
			predicates,
		);
		expect(nativeDecls).toContain("display:inline-block");
		expect(nativeDecls).toContain("position:relative");
		expect(isSvgSpy).toHaveBeenCalledTimes(1);
		expect(specialSpy).toHaveBeenCalledTimes(1);
	});
});
