import { describe, expect, it, vi } from "vitest";

import { declaration } from "./wechat-clipboard-test-fixtures";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { ordinaryDimensionSemanticsSignature } from "./wechat-fidelity-signature";
import {
	appendPortableStyleDeclaration,
	COPY_STYLE_PROPERTIES,
	createStyleDeclarationContext,
	portableStyleProperties,
	semanticTransformOriginSignature,
	semanticPaddingValue,
	transportableTransformOriginSemantics,
} from "./wechat-style-policy";
import {
	styleDeclarations,
	styleDeclarationsSynchronously,
} from "./wechat-pseudo-elements";

function style(values: Record<string, string>): CSSStyleDeclaration {
	return declaration(values);
}

function dimensionSemantics(
	transformOrigin: string,
): WechatDimensionSemanticsContext {
	const computed = style({
		"box-sizing": "border-box",
		height: "3px",
		"margin-bottom": "0px",
		"margin-left": "0px",
		"margin-right": "0px",
		"margin-top": "0px",
		"transform-origin": transformOrigin,
		width: "100px",
	});
	return {
		cleanup: vi.fn(),
		getComputedStyle: () => computed,
		getFormattingOwnerDisplay: () => null,
		getRootComputedStyle: () => computed,
		getSourceComputedStyle: () => computed,
		rasterizesVisualRoots: false,
		refresh: vi.fn(),
	};
}

function runtime(measured: CSSStyleDeclaration): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: () => measured,
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write: null,
	};
}

function transformOriginDeclaration(
	declarations: readonly string[],
): string | undefined {
	return declarations.find((declaration) =>
		declaration.startsWith("transform-origin:"),
	);
}

async function serializeTransformOrigin(
	rawTransformOrigin: string,
	measuredTransformOrigin = "327.5px 1.5px",
): Promise<
	Readonly<{ modern: string | undefined; legacy: string | undefined }>
> {
	const source = document.createElement("hr");
	const measured = style({
		display: "block",
		height: "3px",
		position: "static",
		transform: "matrix(0.8, 0, 0, 1, 0, 0)",
		"transform-origin": measuredTransformOrigin,
		width: "655px",
	});
	const semantics = dimensionSemantics(rawTransformOrigin);
	const modern = await styleDeclarations(
		source,
		measured,
		false,
		false,
		runtime(measured),
		new Map(),
		null,
		undefined,
		semantics,
	);
	const legacy = styleDeclarationsSynchronously(
		source,
		measured,
		false,
		false,
		runtime(measured),
		semantics,
	);
	if (null === legacy)
		throw new Error(
			"wechat-style-policy-test-legacy-style-serialization-failed",
		);
	return {
		legacy: transformOriginDeclaration(legacy),
		modern: transformOriginDeclaration(modern),
	};
}

describe("transform-origin portable style semantics", () => {
	it.each([
		["50% 50%", "50% 50%"],
		["left top", "left top"],
		["25% 10px", "25% 10px"],
		["120px 40px", "120px 40px"],
	])(
		"preserves the raw %s origin instead of the measured pixels",
		async (raw, expected) => {
			await expect(serializeTransformOrigin(raw)).resolves.toEqual({
				legacy: `transform-origin:${expected}`,
				modern: `transform-origin:${expected}`,
			});
		},
	);

	it("keeps modern and legacy style serialization identical for an explicit pixel origin", async () => {
		await expect(serializeTransformOrigin("120px 40px")).resolves.toEqual({
			legacy: "transform-origin:120px 40px",
			modern: "transform-origin:120px 40px",
		});
	});

	it("keeps measured pixels when the raw origin grammar is not transportable", async () => {
		await expect(
			serializeTransformOrigin("calc(50% + 1px) 50%"),
		).resolves.toEqual({
			legacy: "transform-origin:327.5px 1.5px",
			modern: "transform-origin:327.5px 1.5px",
		});
	});

	it("distinguishes raw semantics with the same resolved center used value", () => {
		const source = document.createElement("hr");
		const percentageSignature = ordinaryDimensionSemanticsSignature(
			source,
			dimensionSemantics("50% 50%"),
		);
		const keywordSignature = ordinaryDimensionSemanticsSignature(
			source,
			dimensionSemantics("center center"),
		);
		expect(percentageSignature).not.toBe(keywordSignature);
		expect(
			semanticTransformOriginSignature(
				source,
				style({ "transform-origin": "50% 50%" }),
			),
		).toBe("transform-origin=50% 50%");
		expect(
			semanticTransformOriginSignature(
				source,
				style({ "transform-origin": "center center" }),
			),
		).toBe("transform-origin=center center");
	});

	it("does not transport transform-origin semantics from special layout nodes", () => {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		expect(transportableTransformOriginSemantics("50% 50%")).toBe("50% 50%");
		expect(
			semanticTransformOriginSignature(
				svg,
				style({ "transform-origin": "50% 50%" }),
			),
		).toBe("");
	});

	it("uses the measured value when no raw dimension context is available", () => {
		const source = document.createElement("hr");
		const measured = style({ "transform-origin": "327.5px 1.5px" });
		const declarations: string[] = [];
		appendPortableStyleDeclaration(
			createStyleDeclarationContext(source, measured, false, false, null),
			"transform-origin",
			"327.5px 1.5px",
			"327.5px 1.5px",
			declarations,
		);
		expect(declarations).toContain("transform-origin:327.5px 1.5px");
	});
});

describe("responsive portable padding semantics", () => {
	function paddingSemantics(
		left: string,
		right: string,
	): WechatDimensionSemanticsContext {
		const raw = style({
			"--easymde-portable-padding-left": left,
			"--easymde-portable-padding-right": right,
			"padding-left": "48px",
			"padding-right": "20px",
			position: "static",
		});
		return {
			cleanup: vi.fn(),
			getComputedStyle: () => raw,
			getFormattingOwnerDisplay: () => null,
			getRootComputedStyle: () => raw,
			getSourceComputedStyle: () => raw,
			rasterizesVisualRoots: false,
			refresh: vi.fn(),
		};
	}

	function portableQuoteFixture(): Readonly<{
		cleanup: () => void;
		source: HTMLElement;
	}> {
		const stylesheet = document.createElement("style");
		stylesheet.textContent = `
      .easymde-rendered-content[class*="easymde-markdown-theme-phycat-"]:not(.easymde-custom-css-active) blockquote blockquote {
        --easymde-portable-padding-left: 9%;
        --easymde-portable-padding-right: 5%;
        padding-left: var(--easymde-portable-padding-left);
        padding-right: var(--easymde-portable-padding-right);
      }
    `;
		document.head.append(stylesheet);
		const root = document.createElement("article");
		root.className =
			"easymde-rendered-content easymde-markdown-theme-phycat-sky";
		const outer = document.createElement("blockquote");
		const source = document.createElement("blockquote");
		outer.append(source);
		root.append(outer);
		document.body.append(root);
		return {
			cleanup: () => {
				root.remove();
				stylesheet.remove();
			},
			source,
		};
	}

	it("transports authored percentage insets while measured pixels remain the source value", () => {
		const fixture = portableQuoteFixture();
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			const context = createStyleDeclarationContext(
				fixture.source,
				measured,
				false,
				false,
				semantics,
			);
			const declarations: string[] = [];

			appendPortableStyleDeclaration(
				context,
				"padding-left",
				"48px",
				"48px",
				declarations,
			);
			appendPortableStyleDeclaration(
				context,
				"padding-right",
				"20px",
				"20px",
				declarations,
			);

			expect(declarations).toContain("padding-left:9%");
			expect(declarations).toContain("padding-right:5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBe("9%");
		} finally {
			fixture.cleanup();
		}
	});

	it("rejects unsupported functions instead of freezing a false responsive value", () => {
		const fixture = portableQuoteFixture();
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("clamp(12px, 9%, 48px)", "5%");

			expect(() =>
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toThrow("wechat-invalid-portable-padding-padding-left");
		} finally {
			fixture.cleanup();
		}
	});

	it("falls back to effective padding when an inline or stylesheet override wins", () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `.easymde-rendered-content[class*="easymde-markdown-theme-phycat-"]:not(.easymde-custom-css-active) blockquote blockquote { padding-left: 18px !important; }`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
			fixture.source.style.setProperty("padding-right", "20px", "important");
			expect(
				semanticPaddingValue(
					"padding-right",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("does not restore percentage insets when an equal-specificity rule overrides base transport", () => {
		const fixture = portableQuoteFixture();
		const root = fixture.source.closest(".easymde-rendered-content") as HTMLElement;
		root.classList.add("extra");
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra blockquote blockquote {
				padding-left: 18px;
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			root.classList.remove("extra");
			fixture.cleanup();
		}
	});

	it("falls back to effective padding when an override uses functional pseudo-class selector list with commas", () => {
		const fixture = portableQuoteFixture();
		const root = fixture.source.closest(".easymde-rendered-content") as HTMLElement;
		root.classList.add("extra");
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content.easymde-markdown-theme-phycat-sky:is(.extra,.never) blockquote blockquote {
				padding-left: 18px;
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			root.classList.remove("extra");
			fixture.cleanup();
		}
	});

	it("falls back to effective padding when a nonmatching parent rule owns a nested important override", () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content {
				& blockquote blockquote {
					padding-left: 18px !important;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("keeps matching parent declarations when the same rule also owns nested rules", () => {
		const fixture = portableQuoteFixture();
		fixture.source.id = "parent-with-child";
		const override = document.createElement("style");
		override.textContent = `
			#parent-with-child {
				padding-left: 18px !important;
				& .never {
					color: red;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.source.removeAttribute("id");
			fixture.cleanup();
		}
	});

	it("walks nested child and grandchild rules before falling back", () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content {
				& blockquote {
					& blockquote {
						padding-left: 18px !important;
					}
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("uses the maximum specificity from the full nesting parent selector list", () => {
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra, #never {
				& blockquote blockquote {
					padding-left: 18px;
				}
			}
		`;
		document.head.append(override);
		const fixture = portableQuoteFixture();
		const root = fixture.source.closest(".easymde-rendered-content") as HTMLElement;
		root.classList.add("extra");
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			root.classList.remove("extra");
			fixture.cleanup();
			override.remove();
		}
	});

	it("conservatively rejects a nested rule whose intermediate selector does not match but descendant does", () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content {
				& .intermediate-never {
					& blockquote {
						padding-left: 18px !important;
					}
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({ padding: "18px 20px 18px 48px", position: "static" });
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("conservatively rejects nested source-order ambiguity", () => {
		const fixture = portableQuoteFixture();
		const root = fixture.source.closest(".easymde-rendered-content") as HTMLElement;
		root.classList.add("extra");
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra {
				& blockquote blockquote {
					padding-left: var(--easymde-portable-padding-left);
				}
				& blockquote blockquote {
					padding-left: 18px;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({ padding: "18px 20px 18px 48px", position: "static" });
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			root.classList.remove("extra");
			fixture.cleanup();
		}
	});

	it("conservatively rejects alternative-specificity ambiguity in nested child selectors", () => {
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra {
				& :is(.never, #highly-specific) {
					padding-left: 18px;
				}
			}
		`;
		document.head.append(override);
		const fixture = portableQuoteFixture();
		const root = fixture.source.closest(".easymde-rendered-content") as HTMLElement;
		root.classList.add("extra");
		try {
			const measured = style({ padding: "18px 20px 18px 48px", position: "static" });
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			root.classList.remove("extra");
			fixture.cleanup();
			override.remove();
		}
	});

	it("keeps base transport when a normal declaration is inside a cascade layer", () => {
		const fixture = portableQuoteFixture();
		fixture.source.id = "normal-layer-target";
		const override = document.createElement("style");
		override.textContent = `
			@layer override {
				#normal-layer-target {
					padding-left: 18px;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBe("9%");
		} finally {
			override.remove();
			fixture.source.removeAttribute("id");
			fixture.cleanup();
		}
	});

	it("conservatively rejects CSSNestedDeclarations rules appearing after a nested child rule", () => {
		const fixture = portableQuoteFixture();
		fixture.source.id = "nested-decl-target";
		const override = document.createElement("style");
		override.textContent = `
			#nested-decl-target {
				& p {
					color: red;
				}
				padding-left: 18px !important;
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.source.removeAttribute("id");
			fixture.cleanup();
		}
	});

	it("conservatively rejects CSSNestedDeclarations rules nested inside descendant rules", () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content {
				& p {
					color: red;
				}
				& blockquote blockquote {
					& span {
						color: blue;
					}
					padding-left: 18px !important;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("emits the effective pixel padding through synchronous and asynchronous declaration serializers", async () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `
			.easymde-rendered-content {
				& blockquote blockquote {
					padding-left: 18px !important;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				display: "block",
				padding: "18px 20px 18px 18px",
				"padding-left": "18px",
				"padding-right": "20px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			const modern = await styleDeclarations(
				fixture.source,
				measured,
				false,
				false,
				runtime(measured),
				new Map(),
				null,
				undefined,
				semantics,
			);
			const legacy = styleDeclarationsSynchronously(
				fixture.source,
				measured,
				false,
				false,
				runtime(measured),
				semantics,
			);
			if (!legacy) throw new Error("synchronous style serialization failed");
			expect(modern).toContain("padding-left:18px");
			expect(modern).not.toContain("padding-left:9%");
			expect(legacy).toContain("padding-left:18px");
			expect(legacy).not.toContain("padding-left:9%");
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("falls back to effective padding when an @layer rule with !important overrides base transport", () => {
		const fixture = portableQuoteFixture();
		fixture.source.id = "target";
		const override = document.createElement("style");
		override.textContent = `
			@layer override {
				#target {
					padding-left: 18px !important;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.source.removeAttribute("id");
			fixture.cleanup();
		}
	});

	it("conservatively uses computed padding for an unknown nested grouping rule", () => {
		const fixture = portableQuoteFixture();
		fixture.source.id = "unknown-group-target";
		const override = document.createElement("style");
		override.textContent = `
			@container (min-width: 1px) {
				#unknown-group-target {
					padding-left: 18px;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.source.removeAttribute("id");
			fixture.cleanup();
		}
	});

	it("conservatively uses computed padding when an import rule cannot be resolved", () => {
		const fixture = portableQuoteFixture();
		const override = document.createElement("style");
		override.textContent = `@import url("https://example.invalid/unavailable-cascade.css");`;
		document.head.append(override);
		try {
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const semantics = paddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			override.remove();
			fixture.cleanup();
		}
	});

	it("changes dimension freshness when token and effective semantics differ at equal used pixels", () => {
		const fixture = portableQuoteFixture();
		try {
			const first = paddingSemantics("9%", "5%");
			const second = paddingSemantics("9%", "5%");
			const measured = style({
				padding: "18px 20px 18px 48px",
				position: "static",
			});
			const firstSignature = ordinaryDimensionSemanticsSignature(
				fixture.source,
				first,
			);
			fixture.source.style.setProperty("padding-left", "18px");
			const secondSignature = ordinaryDimensionSemanticsSignature(
				fixture.source,
				second,
			);
			expect(firstSignature).not.toBe(secondSignature);
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					second,
					second.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			fixture.cleanup();
		}
	});
});

describe("portable style property catalog deduplication", () => {
	it("contains zero duplicate properties in COPY_STYLE_PROPERTIES", () => {
		expect(new Set(COPY_STYLE_PROPERTIES).size).toBe(
			COPY_STYLE_PROPERTIES.length,
		);
		for (const property of [
			"border-top-width",
			"border-right-width",
			"border-bottom-width",
			"border-left-width",
			"border-radius",
		]) {
			expect(
				COPY_STYLE_PROPERTIES.filter((entry) => entry === property),
			).toHaveLength(1);
		}
	});

	it("emits zero duplicate properties from portableStyleProperties across all combinations", () => {
		const ordinary = document.createElement("div");

		const taskItem = document.createElement("li");
		taskItem.className = "task-list-item";
		const taskCheckbox = document.createElement("input");
		taskCheckbox.type = "checkbox";
		taskItem.append(taskCheckbox);

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		const svgPath = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"path",
		);
		svg.append(svgPath);
		const detachedSvgPath = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"path",
		);

		const katex = document.createElement("span");
		katex.className = "katex";
		const katexChild = document.createElement("span");
		katex.append(katexChild);

		const math = document.createElementNS(
			"http://www.w3.org/1998/Math/MathML",
			"math",
		);

		const katexTaskItem = document.createElement("li");
		katexTaskItem.className = "task-list-item";
		const katexCheckbox = document.createElement("input");
		katexCheckbox.type = "checkbox";
		katexTaskItem.append(katexCheckbox);
		katex.append(katexTaskItem);

		const samples: ReadonlyArray<
			Readonly<{ element: Element; label: string }>
		> = [
			{ element: ordinary, label: "ordinary" },
			{ element: taskCheckbox, label: "task-checkbox" },
			{ element: svg, label: "svg" },
			{ element: svgPath, label: "svg-child" },
			{ element: detachedSvgPath, label: "detached-svg-child" },
			{ element: katex, label: "special-katex" },
			{ element: katexChild, label: "special-katex-child" },
			{ element: math, label: "special-math" },
			{ element: katexCheckbox, label: "special-task-checkbox" },
		];

		for (const { element, label } of samples) {
			for (const root of [false, true]) {
				for (const pseudoElement of [false, true]) {
					const properties = portableStyleProperties(
						element,
						pseudoElement,
						root,
					);
					const unique = new Set(properties);
					expect(
						unique.size,
						`${label} (root=${String(root)}, pseudo=${String(pseudoElement)})`,
					).toBe(properties.length);
				}
			}
		}

		expect(portableStyleProperties(ordinary, false, true)).not.toContain(
			"width",
		);
		expect(portableStyleProperties(ordinary, false, true)).not.toContain(
			"height",
		);
		expect(
			portableStyleProperties(ordinary, true, true).filter(
				(property) => "width" === property || "height" === property,
			),
		).toEqual(["width", "height"]);
		expect(
			portableStyleProperties(ordinary, true, false).filter(
				(property) => "width" === property || "height" === property,
			),
		).toEqual(["width", "height"]);
		expect(
			portableStyleProperties(katex, true, true).filter(
				(property) => "width" === property || "height" === property,
			),
		).toEqual(["width", "height"]);
	});

	it("emits border and pseudo dimension declarations once in modern and legacy serializers", async () => {
		const source = document.createElement("h2");
		const measured = style({
			"border-top-width": "2px",
			"border-right-width": "2px",
			"border-bottom-width": "2px",
			"border-left-width": "2px",
			"border-radius": "6px",
			content: '""',
			display: "block",
			height: "4px",
			width: "40px",
		});
		const modern = await styleDeclarations(
			source,
			measured,
			true,
			false,
			runtime(measured),
			new Map(),
		);
		const legacy = styleDeclarationsSynchronously(
			source,
			measured,
			true,
			false,
			runtime(measured),
		);
		if (null === legacy) {
			throw new Error("synchronous style serialization failed");
		}
		expect(legacy).toEqual(modern);
		for (const property of [
			"border-top-width",
			"border-right-width",
			"border-bottom-width",
			"border-left-width",
			"border-radius",
			"width",
			"height",
		]) {
			expect(
				modern.filter((entry) => entry.startsWith(`${property}:`)),
			).toHaveLength(1);
		}
	});
});
