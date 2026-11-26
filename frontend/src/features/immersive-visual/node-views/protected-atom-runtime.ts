import type {
	VisualGeneratedRuntimePort,
	VisualRuntimeFeature,
	VisualRuntimeState,
} from "../../../contracts/visual-editor";
import { normalizeMathTex } from "../../../shared/markdown/normalize-math-tex";

/**
 * Pure runtime types, TeX/Mermaid source extractors, unified window/custom
 * runtime provider, and standalone fallback port for protected visual atoms.
 */

export type KatexRenderOptions = Readonly<{
	displayMode: boolean;
	strict: string;
	throwOnError: boolean;
}>;
export type KatexRuntime = Readonly<{
	render: (
		tex: string,
		element: HTMLElement,
		options: KatexRenderOptions,
	) => void;
}>;
export type MermaidRenderResult = Readonly<{ svg: string }>;
export type MermaidRuntime = Readonly<{
	initialize?: (options: Record<string, unknown>) => void;
	render: (
		id: string,
		source: string,
	) => Promise<MermaidRenderResult> | MermaidRenderResult;
}>;
export type ProtectedAtomRuntimeProvider = Readonly<{
	getKatex?: () => KatexRuntime | null | undefined;
	getMermaid?: () => MermaidRuntime | null | undefined;
	readCachedMermaidSvg?: (source: string, renderId: string) => string | null;
	writeCachedMermaidSvg?: (
		source: string,
		renderId: string,
		svg: string,
	) => void;
}>;

export type ResolvedRuntimeProvider = Readonly<{
	getKatex: () => KatexRuntime | null;
	getMermaid: () => MermaidRuntime | null;
	readCachedMermaidSvg: (source: string, renderId: string) => string | null;
	writeCachedMermaidSvg: (
		source: string,
		renderId: string,
		svg: string,
	) => void;
}>;

export type RuntimeProviderOptions = Readonly<{
	getKatex?: () => KatexRuntime | null | undefined;
	getMermaid?: () => MermaidRuntime | null | undefined;
	runtimeProvider?: ProtectedAtomRuntimeProvider;
}>;

type ProtectedEnhancementWindow = Window & {
	EasyMDEMermaidRenderer?: Readonly<{
		readCachedSvg?: (source: string, renderId: string) => string | null;
		writeCachedSvg?: (source: string, renderId: string, svg: string) => void;
	}>;
	katex?: KatexRuntime;
	mermaid?: MermaidRuntime;
};

export function extractBlockMathTex(rawMarkdown: string): string {
	const trimmed = rawMarkdown.trim();
	const fenced =
		trimmed.length >= 4 &&
		((trimmed.startsWith("$$") && trimmed.endsWith("$$")) ||
			(trimmed.startsWith("\\[") && trimmed.endsWith("\\]")));
	return fenced ? trimmed.slice(2, -2).trim() : trimmed;
}

export function extractInlineMathTex(rawMarkdown: string): string {
	const trimmed = rawMarkdown.trim();
	if (
		trimmed.length >= 4 &&
		((trimmed.startsWith("\\(") && trimmed.endsWith("\\)")) ||
			(trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) ||
			(trimmed.startsWith("$$") && trimmed.endsWith("$$")))
	) {
		return trimmed.slice(2, -2).trim();
	}
	if (
		trimmed.startsWith("$") &&
		trimmed.endsWith("$") &&
		!trimmed.startsWith("$$") &&
		trimmed.length >= 2
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

export function extractMermaidSource(rawMarkdown: string): string {
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n").trim();
	if (normalized.length === 0) return "";
	const lines = normalized.split("\n");
	const opener = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid\b.*$/i.exec(lines[0] ?? "");
	if (!opener?.[1]) return normalized;
	const closerPattern =
		opener[1][0] === "~" ? /^ {0,3}(~{3,})[ \t]*$/ : /^ {0,3}(`{3,})[ \t]*$/;
	const closer =
		lines.length > 1 ? closerPattern.exec(lines[lines.length - 1] ?? "") : null;
	const hasCloser = Boolean(
		closer?.[1] && closer[1].length >= opener[1].length,
	);
	return lines
		.slice(1, hasCloser ? lines.length - 1 : lines.length)
		.join("\n")
		.trim();
}

export function createRuntimeProvider(
	doc: Document,
	options: RuntimeProviderOptions,
): ResolvedRuntimeProvider {
	const getWindow = (): ProtectedEnhancementWindow | null =>
		(doc.defaultView ??
			(typeof window !== "undefined" ? window : null)) as
			| ProtectedEnhancementWindow
			| null;
	const customKatex = options.runtimeProvider?.getKatex ?? options.getKatex;
	const customMermaid =
		options.runtimeProvider?.getMermaid ?? options.getMermaid;
	const useWindowCache =
		!customMermaid && !options.runtimeProvider?.readCachedMermaidSvg;

	return {
		getKatex() {
			const candidate = customKatex ? customKatex() : getWindow()?.katex;
			return candidate && typeof candidate.render === "function"
				? candidate
				: null;
		},
		getMermaid() {
			const candidate = customMermaid ? customMermaid() : getWindow()?.mermaid;
			return candidate && typeof candidate.render === "function"
				? candidate
				: null;
		},
		readCachedMermaidSvg(source, renderId) {
			if (options.runtimeProvider?.readCachedMermaidSvg) {
				return options.runtimeProvider.readCachedMermaidSvg(source, renderId);
			}
			return useWindowCache
				? (getWindow()?.EasyMDEMermaidRenderer?.readCachedSvg?.(
						source,
						renderId,
					) ?? null)
				: null;
		},
		writeCachedMermaidSvg(source, renderId, svg) {
			if (options.runtimeProvider?.writeCachedMermaidSvg) {
				options.runtimeProvider.writeCachedMermaidSvg(source, renderId, svg);
				return;
			}
			if (useWindowCache) {
				getWindow()?.EasyMDEMermaidRenderer?.writeCachedSvg?.(
					source,
					renderId,
					svg,
				);
			}
		},
	};
}

/**
 * Fallback runtime port when NodeViews are mounted standalone outside
 * `EditorRoot` (e.g. isolated unit tests without `useEditorVisualUnlock`).
 */
export function createStandaloneRuntimePort(
	provider: ResolvedRuntimeProvider,
): VisualGeneratedRuntimePort {
	const getState = (feature: VisualRuntimeFeature): VisualRuntimeState => {
		if (feature === "math") return provider.getKatex() ? "ready" : "idle";
		if (feature === "mermaid") return provider.getMermaid() ? "ready" : "idle";
		return "ready";
	};
	return {
		getState,
		request: getState,
		subscribe: () => () => undefined,
	};
}

export type MathRenderOutcome =
	| "empty"
	| "error"
	| "loading"
	| "rendered"
	| "unavailable";

export function renderMathWithRuntime(
	target: HTMLElement,
	displayMode: boolean,
	rawMarkdown: string,
	runtimePort: VisualGeneratedRuntimePort,
	provider: ResolvedRuntimeProvider,
): MathRenderOutcome {
	const rawTex = displayMode
		? extractBlockMathTex(rawMarkdown)
		: extractInlineMathTex(rawMarkdown);
	const tex = normalizeMathTex(rawTex);
	if (tex.length === 0) return "empty";
	const state = runtimePort.request("math");
	if (state === "loading") return "loading";
	const katex = state === "ready" ? provider.getKatex() : null;
	if (!katex) return "unavailable";
	target.replaceChildren();
	try {
		katex.render(tex, target, {
			displayMode,
			throwOnError: false,
			strict: "ignore",
		});
		return "rendered";
	} catch {
		return "error";
	}
}
