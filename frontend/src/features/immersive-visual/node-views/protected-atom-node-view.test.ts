import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type FrontendEnhancementWindow,
	renderMermaidContent,
} from "../../../integrations/preview-runtime/frontend-enhancement-runtime";
import { parseMarkdownToVisualDoc } from "../markdown-parser";
import { visualEditorSchema } from "../visual-schema";
import {
	createProtectedBlockNodeView,
	type MermaidRuntime,
	type ProtectedAtomNodeViewOptions,
} from "./protected-atom-node-view";

type TestVisualWindow = Window & {
	EasyMDEMermaidRenderer?: Readonly<{
		readCachedSvg?: (source: string, renderId: string) => string | null;
		writeCachedSvg?: (source: string, renderId: string, svg: string) => void;
	}>;
	mermaid?: MermaidRuntime;
};

const mountedViews: EditorView[] = [];

function flushAsync(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

function mountProtectedView(
	markdown: string,
	options: ProtectedAtomNodeViewOptions = {},
): EditorView {
	const host = document.createElement("div");
	host.className = "easymde-rendered-content";
	document.body.appendChild(host);

	const doc = parseMarkdownToVisualDoc(markdown);
	const view = new EditorView(host, {
		state: EditorState.create({ doc, schema: visualEditorSchema }),
		nodeViews: {
			protected_block: createProtectedBlockNodeView(options),
		},
	});
	mountedViews.push(view);
	return view;
}

afterEach(() => {
	for (const view of mountedViews.splice(0)) {
		const host = view.dom.parentElement;
		view.destroy();
		host?.remove();
	}
	const win = window as TestVisualWindow;
	delete win.mermaid;
	delete win.EasyMDEMermaidRenderer;
});

describe("ProtectedAtomNodeView Mermaid runtime parity and intrinsic layout", () => {
	it("initializes window.mermaid once with canonical Gantt/root-CSS config and stamps intrinsic layout on uncached Gantt renders", async () => {
		const initialize = vi.fn();
		const render = vi.fn(async (id: string) => ({
			svg:
				`<svg xmlns="http://www.w3.org/2000/svg" id="${id}" aria-roledescription="gantt" width="100%" height="268" viewBox="0 0 1200 268">` +
				'<rect width="1200" height="268"/></svg>',
		}));
		const sharedMermaid = { initialize, render };
		const win = window as TestVisualWindow;
		win.mermaid = sharedMermaid;

		const view = mountProtectedView(
			"```mermaid\ngantt\n  title Roadmap\n  section Core\n  Ship :a1, 2026-01-01, 10d\n```",
		);
		await flushAsync();

		expect(initialize).toHaveBeenCalledTimes(1);
		const config = initialize.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(config.securityLevel).toBe("strict");
		expect(config.gantt).toEqual({ useMaxWidth: true, useWidth: 1200 });
		const themeCss = String(config.themeCSS);
		const rootRule = themeCss.match(/&\s*\{[^}]*\}/u)?.[0] ?? "";
		expect(rootRule).toMatch(/letter-spacing:\s*normal;/u);
		expect(rootRule).toMatch(/word-spacing:\s*normal;/u);
		expect(themeCss.replace(rootRule, "")).not.toMatch(
			/(?:letter|word)-spacing:/u,
		);

		const container = view.dom.querySelector<HTMLElement>(".easymde-mermaid");
		const svg = container?.querySelector<SVGSVGElement>("svg");
		expect(container?.getAttribute("data-easymde-mermaid-layout")).toBe(
			"gantt",
		);
		expect(svg?.style.width).toBe("1200px");
		expect(svg?.style.height).toBe("auto");

		// Formal Preview rendering against the same runtime must not re-initialize it.
		const formalRoot = document.createElement("article");
		formalRoot.innerHTML =
			'<pre><code class="language-mermaid">gantt\n  title Second</code></pre>';
		const enhancementWindow = Object.create(
			window,
		) as FrontendEnhancementWindow;
		Object.defineProperty(enhancementWindow, "mermaid", {
			configurable: true,
			writable: true,
			value: sharedMermaid,
		});
		await renderMermaidContent(
			formalRoot,
			{ features: { mermaid: true } },
			enhancementWindow,
		);
		expect(initialize).toHaveBeenCalledTimes(1);
	});

	it("never re-initializes window.mermaid in visual mode when frontend-enhancement-runtime initialized it first", async () => {
		const initialize = vi.fn();
		const render = vi.fn(async (id: string) => ({
			svg:
				`<svg xmlns="http://www.w3.org/2000/svg" id="${id}" aria-roledescription="sequence" viewBox="-40.5 8.25 640.5 268.25">` +
				'<rect width="640.5" height="268.25"/></svg>',
		}));
		const sharedMermaid = { initialize, render };
		const enhancementWindow = Object.create(
			window,
		) as FrontendEnhancementWindow;
		Object.defineProperty(enhancementWindow, "mermaid", {
			configurable: true,
			writable: true,
			value: sharedMermaid,
		});

		const formalRoot = document.createElement("article");
		formalRoot.innerHTML =
			'<pre><code class="language-mermaid">sequenceDiagram\n  A-&gt;&gt;B: Ping</code></pre>';
		await renderMermaidContent(
			formalRoot,
			{ features: { mermaid: true } },
			enhancementWindow,
		);
		expect(initialize).toHaveBeenCalledTimes(1);

		const win = window as TestVisualWindow;
		win.mermaid = sharedMermaid;
		const view = mountProtectedView(
			"```mermaid\nsequenceDiagram\n  C->>D: Pong\n```",
		);
		await flushAsync();

		expect(initialize).toHaveBeenCalledTimes(1);
		const container = view.dom.querySelector<HTMLElement>(".easymde-mermaid");
		const svg = container?.querySelector<SVGSVGElement>("svg");
		expect(container?.getAttribute("data-easymde-mermaid-layout")).toBe(
			"sequence",
		);
		expect(svg?.style.width).toBe("640.5px");
		expect(svg?.style.height).toBe("auto");
	});

	it("stamps intrinsic Gantt layout and width on cached Mermaid renders and clears stale markers on diagram updates", async () => {
		const initialize = vi.fn();
		const render = vi.fn(async (id: string) => ({
			svg:
				`<svg xmlns="http://www.w3.org/2000/svg" id="${id}" aria-roledescription="flowchart" viewBox="0 0 320 180">` +
				'<rect width="320" height="180"/></svg>',
		}));
		const win = window as TestVisualWindow;
		win.mermaid = { initialize, render };
		win.EasyMDEMermaidRenderer = {
			readCachedSvg: vi.fn((source: string, renderId: string) =>
				source.startsWith("gantt")
					? `<svg id="${renderId}" aria-roledescription="gantt" width="100%" height="268" viewBox="0 0 1200 268"><rect width="1200" height="268"/></svg>`
					: null,
			),
		};

		const view = mountProtectedView(
			"```mermaid\ngantt\n  title Cached Plan\n```",
		);

		expect(render).not.toHaveBeenCalled();
		const container = view.dom.querySelector<HTMLElement>(".easymde-mermaid");
		const cachedSvg = container?.querySelector<SVGSVGElement>("svg");
		expect(container?.getAttribute("data-easymde-mermaid-layout")).toBe(
			"gantt",
		);
		expect(cachedSvg?.style.width).toBe("1200px");
		expect(cachedSvg?.style.height).toBe("auto");

		// Updating the card to a flowchart must remove the stale Gantt layout marker.
		const node = view.state.doc.firstChild;
		expect(node).not.toBeNull();
		if (node) {
			view.dispatch(
				view.state.tr.setNodeMarkup(0, undefined, {
					...node.attrs,
					rawMarkdown: "```mermaid\nflowchart TD\n  A --> B\n```",
				}),
			);
		}
		await flushAsync();

		expect(render).toHaveBeenCalledTimes(1);
		const updatedSvg = container?.querySelector<SVGSVGElement>("svg");
		expect(container?.hasAttribute("data-easymde-mermaid-layout")).toBe(false);
		expect(updatedSvg?.style.width).toBe("");
		expect(updatedSvg?.style.height).toBe("");
	});

	it("routes synchronous mermaid.initialize() failures into monospace fallback without poisoning later retries", async () => {
		let shouldFailInit = true;
		const initialize = vi.fn(() => {
			if (shouldFailInit) {
				shouldFailInit = false;
				throw new Error("transient-init-failure");
			}
		});
		const render = vi.fn(async (id: string) => ({
			svg:
				`<svg xmlns="http://www.w3.org/2000/svg" id="${id}" aria-roledescription="flowchart" viewBox="0 0 200 100">` +
				'<rect width="200" height="100"/></svg>',
		}));
		const win = window as TestVisualWindow;
		win.mermaid = { initialize, render };

		const view = mountProtectedView("```mermaid\nflowchart TD\n  A --> B\n```");
		await flushAsync();

		expect(initialize).toHaveBeenCalledTimes(1);
		expect(render).not.toHaveBeenCalled();
		const card = view.dom.querySelector<HTMLElement>(".easymde-protected-card");
		expect(card?.classList.contains("easymde-render-error")).toBe(true);

		const node = view.state.doc.firstChild;
		expect(node).not.toBeNull();
		if (node) {
			view.dispatch(
				view.state.tr.setNodeMarkup(0, undefined, {
					...node.attrs,
					rawMarkdown: "```mermaid\nflowchart TD\n  B --> C\n```",
				}),
			);
		}
		await flushAsync();

		expect(initialize).toHaveBeenCalledTimes(2);
		expect(render).toHaveBeenCalledTimes(1);
		expect(card?.classList.contains("easymde-render-error")).toBe(false);
		expect(card?.querySelector("svg")).not.toBeNull();
	});
});
