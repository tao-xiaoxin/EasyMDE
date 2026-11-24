import { describe, expect, it, vi } from "vitest";
import {
	type FrontendEnhancementWindow,
	renderMermaidContent,
} from "../../../integrations/preview-runtime/frontend-enhancement-runtime";
import {
	ensureMermaidInitialized,
	sanitizeMermaidSvg,
} from "./mermaid-svg-sanitizer";

function createEnhancementWindow(): FrontendEnhancementWindow {
	const windowRef = Object.create(window) as FrontendEnhancementWindow;
	Object.defineProperty(windowRef, "mermaid", {
		configurable: true,
		writable: true,
		value: undefined,
	});
	return windowRef;
}

describe("mermaid-svg-sanitizer shared initialization and SVG parsing", () => {
	it("initializes Mermaid once with gantt width and root-scoped tracking CSS and never re-initializes after formal Preview", async () => {
		const initialize = vi.fn();
		const render = vi.fn(async (id: string) => ({
			svg: `<svg id="${id}" aria-roledescription="gantt" viewBox="0 0 1200 268"><rect width="1200" height="268"/></svg>`,
		}));
		const sharedMermaid = { initialize, render };
		const windowRef = createEnhancementWindow();
		windowRef.mermaid = sharedMermaid;

		const root = document.createElement("article");
		root.innerHTML =
			'<pre><code class="language-mermaid">gantt\n  title Plan</code></pre>';

		await renderMermaidContent(root, { features: { mermaid: true } }, windowRef);
		ensureMermaidInitialized(sharedMermaid);

		expect(initialize).toHaveBeenCalledTimes(1);
		const config = initialize.mock.calls[0]?.[0];
		expect(config?.securityLevel).toBe("strict");
		expect(config?.gantt).toEqual({ useMaxWidth: true, useWidth: 1200 });
		const rootRule = config?.themeCSS.match(/&\s*\{[^}]*\}/u)?.[0] ?? "";
		expect(rootRule).toMatch(/letter-spacing:\s*normal;/u);
		expect(rootRule).toMatch(/word-spacing:\s*normal;/u);
		expect(config?.themeCSS.replace(rootRule, "")).not.toMatch(
			/(?:letter|word)-spacing:/u,
		);
	});

	it("prevents formal Preview from re-initializing Mermaid after visual mode initializes it first", async () => {
		const initialize = vi.fn();
		const render = vi.fn(async (id: string) => ({
			svg: `<svg id="${id}" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`,
		}));
		const sharedMermaid = { initialize, render };
		const windowRef = createEnhancementWindow();
		windowRef.mermaid = sharedMermaid;

		ensureMermaidInitialized(sharedMermaid);

		const root = document.createElement("article");
		root.innerHTML =
			'<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>';
		await renderMermaidContent(root, { features: { mermaid: true } }, windowRef);

		expect(initialize).toHaveBeenCalledTimes(1);
		const config = initialize.mock.calls[0]?.[0];
		expect(config?.securityLevel).toBe("strict");
		expect(config?.gantt).toEqual({ useMaxWidth: true, useWidth: 1200 });
		const rootRule = config?.themeCSS.match(/&\s*\{[^}]*\}/u)?.[0] ?? "";
		expect(rootRule).toMatch(/letter-spacing:\s*normal;/u);
		expect(rootRule).toMatch(/word-spacing:\s*normal;/u);
		expect(config?.themeCSS.replace(rootRule, "")).not.toMatch(
			/(?:letter|word)-spacing:/u,
		);
	});

	it("returns a real SVGSVGElement even when input SVG markup omits xmlns", () => {
		const sanitized = sanitizeMermaidSvg(
			'<svg aria-roledescription="gantt" viewBox="0 0 1200 268"><rect width="1200" height="268"/></svg>',
			document,
			"scope-gantt",
		);
		expect(sanitized).not.toBeNull();
		expect(sanitized instanceof SVGSVGElement).toBe(true);
		expect(sanitized?.namespaceURI).toBe("http://www.w3.org/2000/svg");
		expect(sanitized?.getAttribute("viewBox")).toBe("0 0 1200 268");
	});
});
