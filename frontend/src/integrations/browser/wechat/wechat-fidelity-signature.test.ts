import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	createSerializationYield,
	type BrowserWechatClipboardRuntime,
} from "./wechat-clipboard-runtime";
import {
	computedStyle,
	installClipboardTestEnvironment,
} from "./wechat-clipboard-test-fixtures";
import { createDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	normalizeSignatureStyleValue,
	preparedDimensionGeometrySignature,
	preparedDimensionGeometrySignatureWithYield,
	preparedDimensionSemanticsSignature,
	preparedLayoutSignature,
	preparedLayoutSignatureWithYield,
	preparedPseudoStyleSignature,
	preparedRootExportStyleSignature,
} from "./wechat-fidelity-signature";
import { headingAfterPseudoFlowFreshnessSignature } from "./wechat-heading-pseudo-flow";
import { captureWechatInlinePseudoPaintInput } from "./wechat-inline-pseudo-paint";

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
				if (pseudoElement) {
					return {
						getPropertyValue: (property: string) =>
							"content" === property
								? standard.getPropertyValue(property) || "none"
								: standard.getPropertyValue(property),
					} as CSSStyleDeclaration;
				}
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

	describe("inline pseudo paint raw-key auxiliary term", () => {
		type Values = Record<string, string>;
		type StylePair = Readonly<{
			owner: CSSStyleDeclaration;
			pseudo: CSSStyleDeclaration;
		}>;
		let cssSupportsCalls: Array<readonly [string, string]>;

		beforeEach(() => {
			cssSupportsCalls = [];
			vi.stubGlobal("CSS", {
				supports: (property: string, value: string): boolean => {
					cssSupportsCalls.push([property, value]);
					return "-webkit-mask-mode" !== property;
				},
			});
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		const maskedSvg = (color = "#000000"): string => {
			const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1H15V15H1Z" fill="${color}"/></svg>`;
			return `url("data:image/svg+xml;utf8,${encodeURIComponent(source)}")`;
		};

		const styleWithDefaults = (values: Values): CSSStyleDeclaration =>
			({
				getPropertyValue: (property: string): string =>
					values[property] ?? "none",
			}) as unknown as CSSStyleDeclaration;

		const circlePseudo = (overrides: Values = {}): CSSStyleDeclaration =>
			styleWithDefaults({
				content: '""',
				display: "inline-block",
				position: "static",
				float: "none",
				transform: "none",
				"writing-mode": "horizontal-tb",
				"box-sizing": "content-box",
				width: "10px",
				height: "10px",
				"min-width": "10px",
				"max-width": "10px",
				"min-height": "10px",
				"max-height": "10px",
				"padding-top": "0px",
				"padding-right": "0px",
				"padding-bottom": "0px",
				"padding-left": "0px",
				"border-top-width": "1px",
				"border-right-width": "1px",
				"border-bottom-width": "1px",
				"border-left-width": "1px",
				"border-top-style": "solid",
				"border-right-style": "solid",
				"border-bottom-style": "solid",
				"border-left-style": "solid",
				"border-top-color": "rgb(52, 152, 219)",
				"border-right-color": "rgb(52, 152, 219)",
				"border-bottom-color": "rgb(52, 152, 219)",
				"border-left-color": "rgb(52, 152, 219)",
				"border-top-left-radius": "100%",
				"border-top-right-radius": "100%",
				"border-bottom-right-radius": "100%",
				"border-bottom-left-radius": "100%",
				"background-color": "rgb(52, 152, 219)",
				"background-image": "none",
				...overrides,
			});

		const maskPseudo = (overrides: Values = {}): CSSStyleDeclaration =>
			styleWithDefaults({
				content: '""',
				display: "inline-block",
				position: "static",
				float: "none",
				transform: "none",
				"writing-mode": "horizontal-tb",
				"box-sizing": "content-box",
				width: "16px",
				height: "16px",
				"min-width": "16px",
				"max-width": "16px",
				"min-height": "16px",
				"max-height": "16px",
				"padding-top": "0px",
				"padding-right": "0px",
				"padding-bottom": "0px",
				"padding-left": "0px",
				"border-top-width": "0px",
				"border-right-width": "0px",
				"border-bottom-width": "0px",
				"border-left-width": "0px",
				"border-top-style": "none",
				"border-right-style": "none",
				"border-bottom-style": "none",
				"border-left-style": "none",
				"border-top-left-radius": "0px",
				"border-top-right-radius": "0px",
				"border-bottom-right-radius": "0px",
				"border-bottom-left-radius": "0px",
				"background-color": "rgba(0, 0, 0, 0)",
				"background-image": "none",
				mask: maskedSvg(),
				"mask-image": maskedSvg(),
				"mask-mode": "match-source",
				"mask-size": "contain",
				"mask-repeat": "no-repeat",
				"mask-position": "50% 50%",
				"mask-composite": "add",
				"mask-origin": "border-box",
				"mask-clip": "border-box",
				"-webkit-mask": maskedSvg(),
				"-webkit-mask-image": maskedSvg(),
				"-webkit-mask-mode": "",
				"-webkit-mask-size": "contain",
				"-webkit-mask-repeat": "no-repeat",
				"-webkit-mask-position": "50% 50%",
				"-webkit-mask-composite": "add",
				"-webkit-mask-origin": "border-box",
				"-webkit-mask-clip": "border-box",
				...overrides,
			});

		const ownerStyle = (display: "block" | "inline"): CSSStyleDeclaration =>
			styleWithDefaults({
				display,
				position: "static",
				float: "none",
				transform: "none",
				"writing-mode": "horizontal-tb",
				"background-image": "none",
			});

		const fixture = (
			family: "circle" | "mask",
			options: Readonly<{
				pseudo?: Values;
				width?: number;
				height?: number;
				tag?: "a" | "div" | "h3" | "h4" | "p";
			}> = {},
		) => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			const source = document.createElement(
				options.tag ?? ("mask" === family ? "a" : "h4"),
			);
			source.textContent = "Private proof";
			if ("A" === source.tagName) source.setAttribute("href", "/private-proof");
			preview.append(source);
			preview.getBoundingClientRect = () =>
				({
					bottom: 23,
					height: 23,
					left: 0,
					right: 335,
					top: 0,
					width: 335,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect;
			source.getBoundingClientRect = () =>
				({
					bottom: options.height ?? 23,
					height: options.height ?? 23,
					left: 0,
					right: options.width ?? 335,
					top: 0,
					width: options.width ?? 335,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect;
			const styles = new Map<Element, StylePair>();
			styles.set(preview, {
				owner: ownerStyle("block"),
				pseudo: styleWithDefaults({ content: "none" }),
			});
			styles.set(source, {
				owner: ownerStyle("mask" === family ? "inline" : "block"),
				pseudo:
					"mask" === family
						? maskPseudo(options.pseudo)
						: circlePseudo(options.pseudo),
			});
			const runtime: BrowserWechatClipboardRuntime = {
				blob: Blob,
				clipboardItem: null,
				document,
				getComputedStyle: (element, pseudoElement) => {
					const pair = styles.get(element);
					if (!pair) return styleWithDefaults({ content: "none" });
					if (pseudoElement === "::before") return pair.pseudo;
					if (pseudoElement === "::after") {
						return styleWithDefaults({ content: "none" });
					}
					return pair.owner;
				},
				getSelection: () => null,
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: async () => {},
			};
			return { preview, runtime, source, styles } as {
				preview: HTMLElement;
				runtime: BrowserWechatClipboardRuntime;
				source: HTMLElement;
				styles: Map<Element, StylePair>;
			};
		};

		const expectedTerm = (fixtureValue: ReturnType<typeof fixture>): string => {
			const raw = captureWechatInlinePseudoPaintInput(fixtureValue.source, {
				getComputedStyle: fixtureValue.runtime.getComputedStyle,
				supports: (property, value) => CSS.supports(property, value),
			});
			if (!raw) throw new Error("inline pseudo paint fixture unavailable");
			return `${raw.family}:${raw.rawKey}`;
		};

		const allSinkSignatures = async (
			fixtureValue: ReturnType<typeof fixture>,
		): Promise<
			Readonly<{
				geometry: string;
				geometryYield: string;
				layout: string;
				layoutDimension: string;
				layoutYield: string;
				layoutYieldDimension: string;
				semantics: string;
			}>
		> => {
			const layoutYield = createSerializationYield(fixtureValue.runtime, true);
			const geometryYield = createSerializationYield(
				fixtureValue.runtime,
				true,
			);
			if (!layoutYield || !geometryYield) throw new Error("yield unavailable");
			const layoutDimension = { value: "" };
			const layoutYieldDimension = { value: "" };
			const layout = preparedLayoutSignature(
				fixtureValue.preview,
				fixtureValue.runtime,
				fixtureValue.preview,
				null,
				layoutDimension,
			);
			const geometry = preparedDimensionGeometrySignature(
				fixtureValue.preview,
				fixtureValue.runtime,
				null,
			);
			const semantics = preparedDimensionSemanticsSignature(
				fixtureValue.preview,
				fixtureValue.runtime,
				null,
			);
			const layoutYielded = await preparedLayoutSignatureWithYield(
				fixtureValue.preview,
				fixtureValue.runtime,
				layoutYield,
				undefined,
				fixtureValue.preview,
				null,
				layoutYieldDimension,
			);
			const geometryYielded = await preparedDimensionGeometrySignatureWithYield(
				fixtureValue.preview,
				fixtureValue.runtime,
				geometryYield,
				undefined,
				null,
			);
			return {
				geometry,
				geometryYield: geometryYielded,
				layout,
				layoutDimension: layoutDimension.value,
				layoutYield: layoutYielded,
				layoutYieldDimension: layoutYieldDimension.value,
				semantics,
			};
		};

		it.each(["h3", "p", "div"] as const)(
			"classifies an XHTML <%s> owner without an arbitrary tag policy",
			async (tag) => {
				const value = fixture("circle", { tag });
				const term = expectedTerm(value);
				const signatures = await allSinkSignatures(value);
				for (const signature of Object.values(signatures)) {
					expect(signature).toContain(term);
				}
				expect(signatures.layoutDimension).toContain(term);
				expect(signatures.layoutYieldDimension).toContain(term);
				expect(signatures.layoutDimension).toBe(
					signatures.layoutYieldDimension,
				);
			},
		);

		it("excludes a foreign-namespace div before the HTML raw reader", async () => {
			const value = fixture("circle");
			const foreign = document.createElementNS("urn:easymde:test", "div");
			foreign.textContent = value.source.textContent;
			foreign.getBoundingClientRect = value.source.getBoundingClientRect;
			const stylePair = value.styles.get(value.source);
			if (!stylePair) throw new Error("fixture styles unavailable");
			value.styles.set(foreign, stylePair);
			value.preview.replaceChildren(foreign);
			cssSupportsCalls = [];
			const signatures = await allSinkSignatures({
				...value,
				source: foreign as unknown as HTMLElement,
			});
			for (const signature of Object.values(signatures)) {
				expect(signature).not.toContain(
					"easymde-inline-pseudo-paint-source-v1",
				);
			}
			expect(cssSupportsCalls).toEqual([]);
		});

		it.each(["circle", "mask"] as const)(
			"includes the complete tagged raw key in every auxiliary sink for %s",
			async (family) => {
				const value = fixture(family);
				const term = expectedTerm(value);
				const signatures = await allSinkSignatures(value);
				for (const signature of Object.values(signatures)) {
					expect(signature).toContain(term);
				}
				expect(signatures.layout).toBe(signatures.layoutYield);
				expect(signatures.geometry).toBe(signatures.geometryYield);
				expect(cssSupportsCalls).toContainEqual([
					"-webkit-mask-mode",
					"initial",
				]);
				expect(cssSupportsCalls.every(([, value]) => "initial" === value)).toBe(
					true,
				);
			},
		);

		it("keeps equal geometry but invalidates every sink when circle paint changes", async () => {
			const baseline = fixture("circle");
			const changed = fixture("circle", {
				pseudo: { "background-color": "rgb(231, 76, 60)" },
			});
			const baselineTerm = expectedTerm(baseline);
			const changedTerm = expectedTerm(changed);
			expect(changedTerm).not.toBe(baselineTerm);
			const before = await allSinkSignatures(baseline);
			const after = await allSinkSignatures(changed);
			Object.keys(before).forEach((key) => {
				const name = key as keyof typeof before;
				expect(before[name]).not.toBe(after[name]);
				expect(before[name]).toContain(baselineTerm);
				expect(after[name]).toContain(changedTerm);
			});
			expect(baseline.source.getBoundingClientRect().width).toBe(
				changed.source.getBoundingClientRect().width,
			);
			expect(baseline.source.getBoundingClientRect().height).toBe(
				changed.source.getBoundingClientRect().height,
			);
		});

		it("keeps equal geometry but invalidates every sink when mask source changes", async () => {
			const baseline = fixture("mask");
			const changedImage = maskedSvg("#112233");
			const changed = fixture("mask", {
				pseudo: {
					mask: changedImage,
					"mask-image": changedImage,
					"-webkit-mask": changedImage,
					"-webkit-mask-image": changedImage,
				},
			});
			const baselineTerm = expectedTerm(baseline);
			const changedTerm = expectedTerm(changed);
			expect(changedTerm).not.toBe(baselineTerm);
			const before = await allSinkSignatures(baseline);
			const after = await allSinkSignatures(changed);
			Object.keys(before).forEach((key) => {
				const name = key as keyof typeof before;
				expect(before[name]).not.toBe(after[name]);
				expect(before[name]).toContain(baselineTerm);
				expect(after[name]).toContain(changedTerm);
			});
			expect(baseline.source.getBoundingClientRect().width).toBe(
				changed.source.getBoundingClientRect().width,
			);
			expect(baseline.source.getBoundingClientRect().height).toBe(
				changed.source.getBoundingClientRect().height,
			);
		});

		it("records an observed unsupported alias state without inventing a value", async () => {
			const value = fixture("mask");
			const raw = captureWechatInlinePseudoPaintInput(value.source, {
				getComputedStyle: value.runtime.getComputedStyle,
				supports: (property, aliasValue) => CSS.supports(property, aliasValue),
			});
			if (!raw) throw new Error("mask raw capture unavailable");
			expect(raw.pseudoStyle["-webkit-mask-mode"]).toEqual({
				support: "unsupported",
				value: null,
			});
			expect(raw.rawKey).toContain('"-webkit-mask-mode","unsupported",null');
			expect(cssSupportsCalls).toContainEqual(["-webkit-mask-mode", "initial"]);
			expect(cssSupportsCalls.every(([, value]) => "initial" === value)).toBe(
				true,
			);
		});

		it.each(["circle", "mask"] as const)(
			"keeps hidden zero geometry as a valid raw key in every sink for %s",
			async (family) => {
				const value = fixture(family, { width: 0, height: 0 });
				const term = expectedTerm(value);
				const signatures = await allSinkSignatures(value);
				for (const signature of Object.values(signatures)) {
					expect(signature).toContain(term);
				}
			},
		);

		it("treats a selector-matched anchor with content:none as a genuine noncandidate", async () => {
			const value = fixture("mask", { pseudo: { content: "none" } });
			const signatures = await allSinkSignatures(value);
			for (const signature of Object.values(signatures)) {
				expect(signature).not.toContain(
					"easymde-inline-pseudo-paint-source-v1",
				);
			}
		});

		it("leaves genuine noncandidates empty in every sink", async () => {
			const preview = document.createElement("article");
			const source = document.createElement("p");
			source.textContent = "Ordinary text";
			preview.append(source);
			const runtime: BrowserWechatClipboardRuntime = {
				blob: Blob,
				clipboardItem: null,
				document,
				getComputedStyle: () => styleWithDefaults({ content: '"literal"' }),
				getSelection: () => null,
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: async () => {},
			};
			const signatures = await allSinkSignatures({
				preview,
				runtime,
				source,
				styles: new Map(),
			});
			for (const signature of Object.values(signatures)) {
				expect(signature).not.toContain(
					"easymde-inline-pseudo-paint-source-v1",
				);
			}
		});

		it("fails an empty pseudo content value instead of inventing content:none", () => {
			const value = fixture("circle", { pseudo: { content: "" } });
			expect(() =>
				preparedLayoutSignature(value.preview, value.runtime),
			).toThrow(/wechat-inline-pseudo-paint-style/u);
			expect(() =>
				preparedDimensionGeometrySignature(value.preview, value.runtime, null),
			).toThrow(/wechat-inline-pseudo-paint-style/u);
			expect(() =>
				preparedDimensionSemanticsSignature(value.preview, value.runtime, null),
			).toThrow(/wechat-inline-pseudo-paint-style/u);
		});

		it("propagates unreadable raw fields from every sink without a fallback", async () => {
			const value = fixture("circle", {
				pseudo: { "border-top-color": "" },
			});
			const layoutYield = createSerializationYield(value.runtime, true);
			const geometryYield = createSerializationYield(value.runtime, true);
			if (!layoutYield || !geometryYield) throw new Error("yield unavailable");
			expect(() =>
				preparedLayoutSignature(value.preview, value.runtime),
			).toThrow(/wechat-inline-pseudo-paint-style/u);
			expect(() =>
				preparedDimensionGeometrySignature(value.preview, value.runtime, null),
			).toThrow(/wechat-inline-pseudo-paint-style/u);
			expect(() =>
				preparedDimensionSemanticsSignature(value.preview, value.runtime, null),
			).toThrow(/wechat-inline-pseudo-paint-style/u);
			await expect(
				preparedLayoutSignatureWithYield(
					value.preview,
					value.runtime,
					layoutYield,
				),
			).rejects.toThrow(/wechat-inline-pseudo-paint-style/u);
			await expect(
				preparedDimensionGeometrySignatureWithYield(
					value.preview,
					value.runtime,
					geometryYield,
					undefined,
					null,
				),
			).rejects.toThrow(/wechat-inline-pseudo-paint-style/u);
		});

		it("performs no parser, animation, or readiness work while generating raw-key signatures", async () => {
			const value = fixture("mask");
			const getAnimations = vi.spyOn(document, "getAnimations");
			const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
			const term = expectedTerm(value);
			parse.mockClear();
			const signatures = await allSinkSignatures(value);
			for (const signature of Object.values(signatures)) {
				expect(signature).toContain(term);
			}
			expect(parse).not.toHaveBeenCalled();
			expect(getAnimations).not.toHaveBeenCalled();
		});
	});

	describe("heading after pseudo flow freshness signature", () => {
		type HeadingFixtureOptions = Readonly<{
			after?: Record<string, string>;
			heading?: Record<string, string>;
			parent?: Record<string, string>;
			typed?: Record<string, unknown> | null;
			wrapInContents?: boolean;
		}>;

		const styleDecl = (values: Record<string, string>): CSSStyleDeclaration =>
			({
				getPropertyValue: (property: string): string => values[property] ?? "",
			}) as unknown as CSSStyleDeclaration;

		const createHeadingFixture = (options: HeadingFixtureOptions = {}) => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			const heading = document.createElement("h2");
			heading.textContent = "Section heading";
			const contentsWrapper = options.wrapInContents
				? document.createElement("div")
				: null;
			if (contentsWrapper) {
				contentsWrapper.setAttribute("data-contents-wrapper", "1");
				contentsWrapper.append(heading);
				preview.append(contentsWrapper);
			} else {
				preview.append(heading);
			}

			const fixedRect = (): DOMRect =>
				({
					bottom: 42,
					height: 42,
					left: 0,
					right: 400,
					top: 0,
					width: 400,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect;
			preview.getBoundingClientRect = fixedRect;
			heading.getBoundingClientRect = fixedRect;
			if (contentsWrapper) contentsWrapper.getBoundingClientRect = fixedRect;

			const typedStyles: Record<string, unknown> = {
				height: { value: "auto" },
				"block-size": { value: "auto" },
				"min-height": { value: "auto" },
				"min-block-size": { value: "auto" },
				"max-height": { value: "none" },
				"max-block-size": { value: "none" },
				"writing-mode": { value: "horizontal-tb" },
				"aspect-ratio": { value: "auto" },
				"container-type": { value: "normal" },
				...(options.typed ?? {}),
			};
			const computedStyleMapSpy = vi.fn(() => ({
				get: (property: string) => typedStyles[property],
			}));
			Object.defineProperty(heading, "computedStyleMap", {
				configurable: true,
				value: options.typed === null ? undefined : computedStyleMapSpy,
			});

			const headingStyle = styleDecl({
				display: "block",
				position: "relative",
				float: "none",
				transform: "none",
				overflow: "visible",
				visibility: "visible",
				opacity: "1",
				"writing-mode": "horizontal-tb",
				contain: "none",
				"container-type": "normal",
				"content-visibility": "visible",
				"aspect-ratio": "auto",
				...options.heading,
			});
			const afterStyle = styleDecl({
				content: '""',
				display: "block",
				position: "absolute",
				visibility: "visible",
				opacity: "1",
				...options.after,
			});
			const parentStyle = styleDecl({
				display: "block",
				visibility: "visible",
				"writing-mode": "horizontal-tb",
				...options.parent,
			});
			const contentsStyle = styleDecl({
				display: "contents",
				visibility: "visible",
			});
			const nonePseudo = styleDecl({ content: "none" });

			const runtime: BrowserWechatClipboardRuntime = {
				blob: Blob,
				clipboardItem: null,
				document,
				getComputedStyle: (element, pseudoElement) => {
					if (element === heading && "::after" === pseudoElement) {
						return afterStyle;
					}
					if (pseudoElement) return nonePseudo;
					if (element === heading) return headingStyle;
					if (contentsWrapper && element === contentsWrapper) {
						return contentsStyle;
					}
					return parentStyle;
				},
				getSelection: () => null,
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: async () => {},
			};

			return { computedStyleMapSpy, heading, preview, runtime };
		};

		const collectHeadingSignatures = async (
			fixtureValue: ReturnType<typeof createHeadingFixture>,
		) => {
			const layoutYield = createSerializationYield(fixtureValue.runtime, true);
			const geometryYield = createSerializationYield(
				fixtureValue.runtime,
				true,
			);
			if (!layoutYield || !geometryYield) throw new Error("yield unavailable");
			const layoutDimension = { value: "" };
			const layoutYieldDimension = { value: "" };
			const layout = preparedLayoutSignature(
				fixtureValue.preview,
				fixtureValue.runtime,
				fixtureValue.preview,
				null,
				layoutDimension,
			);
			const layoutYielded = await preparedLayoutSignatureWithYield(
				fixtureValue.preview,
				fixtureValue.runtime,
				layoutYield,
				undefined,
				fixtureValue.preview,
				null,
				layoutYieldDimension,
			);
			const geometry = preparedDimensionGeometrySignature(
				fixtureValue.preview,
				fixtureValue.runtime,
				null,
			);
			const geometryYielded = await preparedDimensionGeometrySignatureWithYield(
				fixtureValue.preview,
				fixtureValue.runtime,
				geometryYield,
				undefined,
				null,
			);
			const semantics = preparedDimensionSemanticsSignature(
				fixtureValue.preview,
				fixtureValue.runtime,
				null,
			);
			return {
				geometry,
				geometryYield: geometryYielded,
				layout,
				layoutDimension: layoutDimension.value,
				layoutYield: layoutYielded,
				layoutYieldDimension: layoutYieldDimension.value,
				semantics,
			};
		};

		it.each<Readonly<{ name: string; override: HeadingFixtureOptions }>>([
			{
				name: "CSSOM aspect-ratio",
				override: { heading: { "aspect-ratio": "4 / 1" } },
			},
			{
				name: "CSSOM contain: size",
				override: { heading: { contain: "size" } },
			},
			{
				name: "CSSOM container-type: size",
				override: { heading: { "container-type": "size" } },
			},
			{
				name: "CSSOM content-visibility: auto",
				override: { heading: { "content-visibility": "auto" } },
			},
			{
				name: "CSSOM writing-mode",
				override: { heading: { "writing-mode": "vertical-rl" } },
			},
			{
				name: "formatting-parent writing-mode through display: contents",
				override: { parent: { "writing-mode": "vertical-rl" } },
			},
			{
				name: "formatting-parent display through display: contents",
				override: { parent: { display: "grid" } },
			},
			{
				name: "Typed OM min-height",
				override: { typed: { "min-height": { value: 80, unit: "px" } } },
			},
			{
				name: "Typed OM container-type: size",
				override: { typed: { "container-type": { value: "size" } } },
			},
			{
				name: "Typed OM aspect-ratio",
				override: { typed: { "aspect-ratio": { toString: () => "4 / 1" } } },
			},
			{
				name: "Typed OM availability",
				override: { typed: null },
			},
		])(
			"invalidates every fidelity signature sink when $name changes at equal geometry",
			async ({ override }) => {
				const baseline = createHeadingFixture({ wrapInContents: true });
				const mutated = createHeadingFixture({
					...override,
					wrapInContents: true,
				});

				expect(baseline.heading.getBoundingClientRect().width).toBe(
					mutated.heading.getBoundingClientRect().width,
				);
				expect(baseline.heading.getBoundingClientRect().height).toBe(
					mutated.heading.getBoundingClientRect().height,
				);

				const before = await collectHeadingSignatures(baseline);
				const after = await collectHeadingSignatures(mutated);

				expect(before.layout).toBe(before.layoutYield);
				expect(before.layoutDimension).toBe(before.layoutYieldDimension);
				expect(before.geometry).toBe(before.geometryYield);
				expect(after.layout).toBe(after.layoutYield);
				expect(after.layoutDimension).toBe(after.layoutYieldDimension);
				expect(after.geometry).toBe(after.geometryYield);

				for (const key of Object.keys(before) as Array<keyof typeof before>) {
					expect(after[key]).not.toBe(before[key]);
				}
			},
		);

		it("short-circuits without reading computedStyleMap unless h1-h4 has an empty absolute ::after", () => {
			const noPseudo = createHeadingFixture({ after: { content: "none" } });
			expect(
				headingAfterPseudoFlowFreshnessSignature(
					noPseudo.heading,
					noPseudo.runtime,
				),
			).toBe("");
			expect(noPseudo.computedStyleMapSpy).not.toHaveBeenCalled();

			const staticPseudo = createHeadingFixture({
				after: { content: '""', position: "static" },
			});
			expect(
				headingAfterPseudoFlowFreshnessSignature(
					staticPseudo.heading,
					staticPseudo.runtime,
				),
			).toBe("");
			expect(staticPseudo.computedStyleMapSpy).not.toHaveBeenCalled();

			const textPseudo = createHeadingFixture({
				after: { content: '"§"', position: "absolute" },
			});
			expect(
				headingAfterPseudoFlowFreshnessSignature(
					textPseudo.heading,
					textPseudo.runtime,
				),
			).toBe("");
			expect(textPseudo.computedStyleMapSpy).not.toHaveBeenCalled();
		});
	});
});
