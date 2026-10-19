import { describe, expect, it, vi } from "vitest";

import { createSerializationYield } from "./wechat-clipboard-runtime";
import {
	computedStyle,
	installClipboardTestEnvironment,
} from "./wechat-clipboard-test-fixtures";
import { createDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	normalizeSignatureStyleValue,
	preparedLayoutSignature,
	preparedLayoutSignatureWithYield,
	preparedPseudoStyleSignature,
	preparedRootExportStyleSignature,
} from "./wechat-fidelity-signature";

describe("wechat-fidelity-signature", () => {
	installClipboardTestEnvironment();

	describe("normalizeSignatureStyleValue", () => {
		it("normalizes 0 and 0px text-indent to canonical 0px", () => {
			expect(normalizeSignatureStyleValue("text-indent", "0")).toBe("0px");
			expect(normalizeSignatureStyleValue("text-indent", "0px")).toBe("0px");
			expect(normalizeSignatureStyleValue("text-indent", " 0px ")).toBe("0px");
			expect(normalizeSignatureStyleValue("text-indent", "0.0px")).toBe("0px");
			expect(normalizeSignatureStyleValue("text-indent", "-0px")).toBe("0px");
			expect(normalizeSignatureStyleValue("text-indent", "-0")).toBe("0px");
		});

		it("preserves nonzero text-indent changes without hiding mutations", () => {
			expect(normalizeSignatureStyleValue("text-indent", "4px")).toBe("4px");
			expect(normalizeSignatureStyleValue("text-indent", "-2px")).toBe("-2px");
			expect(normalizeSignatureStyleValue("text-indent", "2em")).toBe("2em");
			expect(normalizeSignatureStyleValue("text-indent", "10%")).toBe("10%");
			expect(normalizeSignatureStyleValue("text-indent", "0.5px")).toBe(
				"0.5px",
			);
		});

		it("leaves non-text-indent properties unnormalized", () => {
			expect(normalizeSignatureStyleValue("margin-top", "0")).toBe("0");
			expect(normalizeSignatureStyleValue("margin-top", "0px")).toBe("0px");
			expect(normalizeSignatureStyleValue("padding-left", "0")).toBe("0");
			expect(normalizeSignatureStyleValue("width", "auto")).toBe("auto");
		});
	});

	describe("layout signatures zero-unit normalization and nonzero negative cases", () => {
		const createRuntime = (textIndentByTag = new Map<string, string>()) => ({
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) => {
				const standard = computedStyle(element, pseudoElement);
				const override = textIndentByTag.get(element.tagName.toLowerCase());
				if (undefined !== override && !pseudoElement) {
					return {
						...standard,
						getPropertyValue: (prop: string) => {
							if ("text-indent" === prop) return override;
							return standard.getPropertyValue(prop);
						},
					} as unknown as CSSStyleDeclaration;
				}
				return standard;
			},
			getSelection: () => null,
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: async () => {},
		});

		it("treats 0 and 0px text-indent as semantically equivalent across sync and yield signatures", async () => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML =
				"<table><tbody><tr><td>Table</td></tr></tbody></table>";

			const runtimeZero = createRuntime(new Map([["table", "0"]]));
			const runtimeZeroPx = createRuntime(new Map([["table", "0px"]]));

			const yieldZero = createSerializationYield(runtimeZero, true);
			const yieldZeroPx = createSerializationYield(runtimeZeroPx, true);
			if (!yieldZero || !yieldZeroPx) throw new Error("yield unavailable");

			const dimZero = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZero,
			);
			const dimZeroPx = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZeroPx,
			);

			const syncZero = preparedLayoutSignature(
				preview,
				runtimeZero,
				preview,
				dimZero,
			);
			const syncZeroPx = preparedLayoutSignature(
				preview,
				runtimeZeroPx,
				preview,
				dimZeroPx,
			);
			expect(syncZero).toBe(syncZeroPx);

			const asyncZero = await preparedLayoutSignatureWithYield(
				preview,
				runtimeZero,
				yieldZero,
				undefined,
				preview,
				dimZero,
			);
			const asyncZeroPx = await preparedLayoutSignatureWithYield(
				preview,
				runtimeZeroPx,
				yieldZeroPx,
				undefined,
				preview,
				dimZeroPx,
			);
			expect(asyncZero).toBe(asyncZeroPx);
			expect(syncZero).toBe(asyncZero);
		});

		it("detects actual nonzero text-indent mutations as signature mismatches in negative case", async () => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML =
				"<table><tbody><tr><td>Table</td></tr></tbody></table>";

			const runtimeZero = createRuntime(new Map([["table", "0px"]]));
			const runtimeFour = createRuntime(new Map([["table", "4px"]]));

			const yieldZero = createSerializationYield(runtimeZero, true);
			const yieldFour = createSerializationYield(runtimeFour, true);
			if (!yieldZero || !yieldFour) throw new Error("yield unavailable");

			const dimZero = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZero,
			);
			const dimFour = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeFour,
			);

			const syncZero = preparedLayoutSignature(
				preview,
				runtimeZero,
				preview,
				dimZero,
			);
			const syncFour = preparedLayoutSignature(
				preview,
				runtimeFour,
				preview,
				dimFour,
			);
			expect(syncZero).not.toBe(syncFour);

			const asyncZero = await preparedLayoutSignatureWithYield(
				preview,
				runtimeZero,
				yieldZero,
				undefined,
				preview,
				dimZero,
			);
			const asyncFour = await preparedLayoutSignatureWithYield(
				preview,
				runtimeFour,
				yieldFour,
				undefined,
				preview,
				dimFour,
			);
			expect(asyncZero).not.toBe(asyncFour);
		});

		it("normalizes 0 vs 0px on root export style signature and preserves nonzero values", () => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");

			const runtimeZero = createRuntime(new Map([["article", "0"]]));
			const runtimeZeroPx = createRuntime(new Map([["article", "0px"]]));
			const runtimeNonzero = createRuntime(new Map([["article", "8px"]]));

			const dimZero = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZero,
			);
			const dimZeroPx = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZeroPx,
			);
			const dimNonzero = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeNonzero,
			);

			const sigZero = preparedRootExportStyleSignature(
				preview,
				runtimeZero,
				dimZero,
			);
			const sigZeroPx = preparedRootExportStyleSignature(
				preview,
				runtimeZeroPx,
				dimZeroPx,
			);
			const sigNonzero = preparedRootExportStyleSignature(
				preview,
				runtimeNonzero,
				dimNonzero,
			);

			expect(sigZero).toBe(sigZeroPx);
			expect(sigZero).toContain("text-indent=0px");
			expect(sigNonzero).toContain("text-indent=8px");
			expect(sigZero).not.toBe(sigNonzero);
		});

		it("normalizes 0 vs 0px on pseudo style signature and preserves nonzero values", () => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");

			const createPseudoRuntime = (indent: string) => ({
				...createRuntime(),
				getComputedStyle: (_element: Element, pseudoElement?: string) => {
					if ("::before" === pseudoElement) {
						return {
							getPropertyValue: (prop: string) => {
								if ("content" === prop) return '"marker"';
								if ("text-indent" === prop) return indent;
								return "";
							},
						} as unknown as CSSStyleDeclaration;
					}
					return {
						getPropertyValue: () => "",
					} as unknown as CSSStyleDeclaration;
				},
			});

			const runtimeZero = createPseudoRuntime("0");
			const runtimeZeroPx = createPseudoRuntime("0px");
			const runtimeNonzero = createPseudoRuntime("12px");

			const dimZero = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZero,
			);
			const dimZeroPx = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeZeroPx,
			);
			const dimNonzero = createDimensionSemanticsContext(
				preview,
				preview,
				runtimeNonzero,
			);

			const sigZero = preparedPseudoStyleSignature(
				preview,
				"::before",
				runtimeZero,
				false,
				dimZero,
			);
			const sigZeroPx = preparedPseudoStyleSignature(
				preview,
				"::before",
				runtimeZeroPx,
				false,
				dimZeroPx,
			);
			const sigNonzero = preparedPseudoStyleSignature(
				preview,
				"::before",
				runtimeNonzero,
				false,
				dimNonzero,
			);

			expect(sigZero).toBe(sigZeroPx);
			expect(sigZero).toContain("text-indent=0px");
			expect(sigNonzero).toContain("text-indent=12px");
			expect(sigZero).not.toBe(sigNonzero);
		});
	});
});
