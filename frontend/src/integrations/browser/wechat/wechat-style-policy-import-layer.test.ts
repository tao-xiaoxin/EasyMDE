import { describe, expect, it, vi } from "vitest";

import { declaration } from "./wechat-clipboard-test-fixtures";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { semanticPaddingValue } from "./wechat-style-policy";

function style(values: Record<string, string>): CSSStyleDeclaration {
	return declaration(values);
}

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
		getRefreshGeneration: () => 1,
		getRootComputedStyle: () => raw,
		getSourceComputedStyle: () => raw,
		rasterizesVisualRoots: false,
		refresh: vi.fn(),
	};
}

function quoteFixture(): Readonly<{
	cleanup: () => void;
	source: HTMLElement;
}> {
	const root = document.createElement("article");
	root.className = "easymde-rendered-content easymde-markdown-theme-phycat-sky";
	const outer = document.createElement("blockquote");
	const source = document.createElement("blockquote");
	outer.append(source);
	root.append(outer);
	document.body.append(root);
	return {
		cleanup: () => root.remove(),
		source,
	};
}

function importRuleWithCss(css: string): Readonly<{
	cleanup: () => void;
	rule: CSSImportRule;
}> {
	const stylesheet = document.createElement("style");
	stylesheet.textContent = css;
	document.head.append(stylesheet);
	const rule = stylesheet.sheet?.cssRules[0];
	if (!(rule instanceof CSSImportRule)) {
		stylesheet.remove();
		throw new Error("wechat-style-policy-test-import-rule-missing");
	}
	return {
		cleanup: () => stylesheet.remove(),
		rule,
	};
}

function measuredQuotePadding(): CSSStyleDeclaration {
	return style({
		padding: "18px 20px 18px 48px",
		position: "static",
	});
}

describe("portable padding CSS import cascade", () => {
	it.each([
		["named layer", "layer(theme)", "theme"],
		["anonymous layer", "layer", ""],
	] as const)(
		"keeps a normal unlayered override over a more-specific portable token in a %s import",
		(_label, layerSyntax, layerName) => {
			const fixture = quoteFixture();
			fixture.source.closest("article")?.classList.add("extra");
			const imported = importRuleWithCss(
				`@import url("https://example.test/theme.css") ${layerSyntax};`,
			);
			if (imported.rule.layerName !== layerName) {
				imported.cleanup();
				fixture.cleanup();
				throw new Error("wechat-style-policy-test-wrong-cssom-layer");
			}
			const importedSheet = imported.rule.styleSheet;
			if (!importedSheet) {
				imported.cleanup();
				fixture.cleanup();
				throw new Error("wechat-style-policy-test-import-sheet-missing");
			}
			try {
				importedSheet.insertRule(
					".easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra blockquote blockquote { padding-left: var(--easymde-portable-padding-left); }",
					0,
				);
				const override = document.createElement("style");
				override.textContent = `
					.easymde-rendered-content.easymde-markdown-theme-phycat-sky blockquote blockquote {
						padding-left: 18px;
					}
				`;
				document.head.append(override);
				try {
					const measured = measuredQuotePadding();
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
				}
			} finally {
				imported.cleanup();
				fixture.cleanup();
			}
		},
	);

	it("keeps a more-specific imported portable token when the import is unlayered", () => {
		const fixture = quoteFixture();
		fixture.source.closest("article")?.classList.add("extra");
		const imported = importRuleWithCss(
			'@import url("https://example.test/theme.css");',
		);
		if (imported.rule.layerName !== null) {
			imported.cleanup();
			fixture.cleanup();
			throw new Error("wechat-style-policy-test-expected-unlayered-import");
		}
		const importedSheet = imported.rule.styleSheet;
		if (!importedSheet) {
			imported.cleanup();
			fixture.cleanup();
			throw new Error("wechat-style-policy-test-import-sheet-missing");
		}
		try {
			importedSheet.insertRule(
				".easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra blockquote blockquote { padding-left: var(--easymde-portable-padding-left); }",
				0,
			);
			const override = document.createElement("style");
			override.textContent = `
				.easymde-rendered-content.easymde-markdown-theme-phycat-sky blockquote blockquote {
					padding-left: 18px;
				}
			`;
			document.head.append(override);
			try {
				const measured = measuredQuotePadding();
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
			}
		} finally {
			imported.cleanup();
			fixture.cleanup();
		}
	});

	it("conservatively declines a parsed import with supports metadata", () => {
		const fixture = quoteFixture();
		const imported = importRuleWithCss(
			'@import url("https://example.test/theme.css") supports(display: grid);',
		);
		const importedSheet = imported.rule.styleSheet;
		if (!importedSheet) {
			imported.cleanup();
			fixture.cleanup();
			throw new Error("wechat-style-policy-test-import-sheet-missing");
		}
		try {
			expect(imported.rule.supportsText).toBe("display: grid");
			importedSheet.insertRule(
				'.easymde-rendered-content[class*="easymde-markdown-theme-phycat-"]:not(.easymde-custom-css-active) blockquote blockquote { padding-left: var(--easymde-portable-padding-left); }',
				0,
			);
			const measured = measuredQuotePadding();
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
			imported.cleanup();
			fixture.cleanup();
		}
	});

	it("conservatively declines a portable token declared in an earlier layer when overridden by a later layer", () => {
		const fixture = quoteFixture();
		fixture.source.closest("article")?.classList.add("extra");
		const override = document.createElement("style");
		override.textContent = `
			@layer earlier, later;
			@layer earlier {
				.easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra blockquote blockquote {
					padding-left: var(--easymde-portable-padding-left);
				}
			}
			@layer later {
				.easymde-rendered-content.easymde-markdown-theme-phycat-sky blockquote blockquote {
					padding-left: 18px;
				}
			}
		`;
		document.head.append(override);
		try {
			const measured = measuredQuotePadding();
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

	it("conservatively declines a portable token declared inside nested cascade layers", () => {
		const fixture = quoteFixture();
		fixture.source.closest("article")?.classList.add("extra");
		const override = document.createElement("style");
		override.textContent = `
			@layer outer {
				@layer inner {
					.easymde-rendered-content.easymde-markdown-theme-phycat-sky.extra blockquote blockquote {
						padding-left: var(--easymde-portable-padding-left);
					}
				}
			}
			.easymde-rendered-content.easymde-markdown-theme-phycat-sky blockquote blockquote {
				padding-left: 18px;
			}
		`;
		document.head.append(override);
		try {
			const measured = measuredQuotePadding();
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
});
