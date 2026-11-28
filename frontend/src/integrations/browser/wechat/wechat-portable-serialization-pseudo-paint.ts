import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import {
	applyWechatInlinePseudoPaintBatch,
	assembleWechatInlinePseudoPaintSource,
	bindWechatInlinePseudoPaint,
	planWechatInlinePseudoPaint,
	type WechatInlinePseudoPaintCapabilities,
	type WechatInlinePseudoPaintCssCapabilities,
	type WechatInlinePseudoPaintRawCapture,
	type WechatInlinePseudoPaintReadiness,
} from "./wechat-inline-pseudo-paint";

export function inlinePseudoPaintCapabilities(
	runtime: BrowserWechatClipboardRuntime,
	source: Element,
	computed: CSSStyleDeclaration | null,
	getComputedStyle: BrowserWechatClipboardRuntime["getComputedStyle"],
): WechatInlinePseudoPaintCapabilities {
	const windowCss = runtime.document.defaultView?.CSS as
		| { supports?: (property: string, value: string) => boolean }
		| undefined;
	const globalCss = (
		globalThis as typeof globalThis & {
			CSS?: { supports?: (property: string, value: string) => boolean };
		}
	).CSS;
	const css: WechatInlinePseudoPaintCssCapabilities = {
		getComputedStyle: (element, pseudoElement) =>
			pseudoElement
				? getComputedStyle(element, pseudoElement)
				: element === source && computed
					? computed
					: getComputedStyle(element),
		supports: (property, value) => {
			const supports = windowCss?.supports ?? globalCss?.supports;
			if ("function" !== typeof supports)
				throw new Error(
					"wechat-inline-pseudo-paint-css-supports-unavailable",
				);
			return supports.call(windowCss ?? globalCss, property, value);
		},
	};
	return {
		animations: {
			inspectAnimations: (root) => {
				const getAnimations = (
					root as Element & {
						getAnimations?: (
							options?: { subtree?: boolean },
						) => readonly Animation[];
					}
				).getAnimations;
				if ("function" !== typeof getAnimations)
					throw new Error("wechat-inline-pseudo-paint-animations-unavailable");
				return getAnimations
					.call(root, { subtree: true })
					.filter((animation) => {
						const candidate = animation as Animation & {
							animationName?: unknown;
							transitionProperty?: unknown;
						};
						return (
							("string" === typeof candidate.transitionProperty &&
								candidate.transitionProperty.trim() !== "") ||
							("string" === typeof candidate.animationName &&
								candidate.animationName.trim().toLowerCase() !== "none")
						);
					})
					.map((animation) => {
						const candidate = animation as Animation & {
							animationName?: unknown;
							pending?: unknown;
							transitionProperty?: unknown;
						};
						const timing = animation.effect?.getComputedTiming?.();
						const isCssAnimation =
							"string" === typeof candidate.animationName &&
							candidate.animationName.trim().toLowerCase() !== "none";
						return {
							endTime:
								typeof timing?.endTime === "number"
									? timing.endTime
									: Number.NaN,
							kind: isCssAnimation
								? ("css-animation" as const)
								: ("css-transition" as const),
							pending: true === candidate.pending,
							playState: animation.playState,
							transitionProperty:
								"string" === typeof candidate.transitionProperty
									? candidate.transitionProperty
									: null,
						};
					});
			},
		},
		css,
	};
}

function resolvedInlinePseudoPaintOwner(originalClone: Element): Element {
	let current = originalClone;
	const visited = new Set<Element>();
	while (true) {
		if (visited.has(current))
			throw new Error("wechat-inline-pseudo-paint-binding");
		visited.add(current);
		const replacement = WECHAT_STRUCTURE_REPLACEMENTS.get(current);
		if (!replacement) return current;
		if (replacement === current)
			throw new Error("wechat-inline-pseudo-paint-binding");
		current = replacement;
	}
}

function inlinePseudoPaintMarkerFor(
	evidence: {
		source: Element;
	},
	cloneIdentity: ReadonlyMap<Element, Element>,
	cloneRoot: HTMLElement,
): Readonly<{
	clone: Element;
	generatedMarker: HTMLSpanElement;
	parent: Element;
}> {
	const originalClone = cloneIdentity.get(evidence.source);
	if (!originalClone)
		throw new Error("wechat-inline-pseudo-paint-clone-missing");
	const parent = resolvedInlinePseudoPaintOwner(originalClone);
	if (!cloneRoot.contains(parent))
		throw new Error("wechat-inline-pseudo-paint-final-owner-missing");
	const markers = Array.from(parent.querySelectorAll("*")).filter(
		(element): element is HTMLSpanElement => {
			const record = GENERATED_PSEUDO_CLONE_OWNERS.get(element);
			return (
				element instanceof HTMLSpanElement &&
				record?.owner === originalClone &&
				"::before" === record.pseudo
			);
		},
	);
	if (1 !== markers.length)
		throw new Error("wechat-inline-pseudo-paint-marker-missing");
	const generatedMarker = markers[0];
	if (!generatedMarker || generatedMarker.parentElement !== parent)
		throw new Error("wechat-inline-pseudo-paint-marker-missing");
	return { clone: originalClone, generatedMarker, parent };
}

export function applyInlinePseudoPaint(
	preview: HTMLElement,
	finalized: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	readiness: WechatInlinePseudoPaintReadiness | null,
	captures: readonly WechatInlinePseudoPaintRawCapture[],
	omittedSources: ReadonlySet<Element>,
	cloneIdentity: ReadonlyMap<Element, Element>,
): void {
	if (!captures.length) return;
	if (!readiness)
		throw new Error("wechat-inline-pseudo-paint-readiness-missing");
	const admittedCaptures = captures.filter(
		(raw) =>
			![...omittedSources].some(
				(omitted) => omitted === raw.source || omitted.contains(raw.source),
			),
	);
	if (!admittedCaptures.length) return;
	const source = assembleWechatInlinePseudoPaintSource(
		{
			capabilities: inlinePseudoPaintCapabilities(
				runtime,
				preview,
				null,
				runtime.getComputedStyle,
			),
			readiness,
			source: preview,
		},
		admittedCaptures,
	);
	const plan = planWechatInlinePseudoPaint(source);
	const batch = bindWechatInlinePseudoPaint(
		source,
		plan,
		finalized,
		(evidence) =>
			inlinePseudoPaintMarkerFor(evidence, cloneIdentity, finalized),
	);
	applyWechatInlinePseudoPaintBatch(batch);
}
