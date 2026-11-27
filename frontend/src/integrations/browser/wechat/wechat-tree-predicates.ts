import type { WechatVisualRasterizationKind } from "../../../contracts/ports/wechat-visual-rasterization-port";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const SVG_DEFINITION_TAGS = new Set([
	"clippath",
	"filter",
	"lineargradient",
	"marker",
	"mask",
	"pattern",
	"radialgradient",
	"symbol",
]);

function hasAncestorWithClass(source: Element, className: string): boolean {
	let current: Element | null = source;
	while (current) {
		if (current.hasAttribute("class") && current.classList.contains(className))
			return true;
		current = current.parentElement;
	}
	return false;
}

function hasAncestorWithLocalName(source: Element, localName: string): boolean {
	let current: Element | null = source;
	while (current) {
		if (localName === current.localName.toLowerCase()) return true;
		current = current.parentElement;
	}
	return false;
}

export function isSpecialLayoutElement(element: Element): boolean {
	const localName = element.localName.toLowerCase();
	if ("svg" === localName || "math" === localName) return true;
	if (!element.hasAttribute("class")) return false;
	const classList = element.classList;
	return (
		classList.contains("katex") ||
		classList.contains("easymde-math-block") ||
		classList.contains("easymde-math-inline")
	);
}

export function isSvgElement(source: Element): boolean {
	if (SVG_NAMESPACE === source.namespaceURI) return true;
	return hasAncestorWithLocalName(source, "svg");
}

export function isInsideTable(source: Element): boolean {
	return hasAncestorWithLocalName(source, "table");
}

export function isSvgDefinition(source: Element): boolean {
	const localName = source.localName.toLowerCase();
	return (
		"defs" === localName ||
		SVG_DEFINITION_TAGS.has(localName) ||
		hasAncestorWithLocalName(source, "defs")
	);
}

export function isKaTeXVisualNode(source: Element): boolean {
	// KaTeX's MathML and visual trees share a `.katex` ancestor. Only the
	// visual root and its descendants need the non-wrapping contract; applying
	// it to `.katex-mathml` would preserve the hidden fallback we remove later.
	return (
		(source.hasAttribute("class") && source.classList.contains("katex")) ||
		hasAncestorWithClass(source, "katex-html")
	);
}

export function visualRasterizationKind(
	source: Element,
): WechatVisualRasterizationKind | null {
	if (!source.hasAttribute("class")) return null;
	const classList = source.classList;
	if (classList.contains("easymde-mermaid") && source.querySelector("svg")) {
		return "mermaid";
	}
	if (
		(classList.contains("easymde-math") ||
			classList.contains("easymde-math-block") ||
			classList.contains("easymde-math-inline")) &&
		(classList.contains("katex") || Boolean(source.querySelector(".katex")))
	) {
		return "math";
	}
	return null;
}

export function hasVisualRasterizationAncestor(source: Element): boolean {
	let ancestor = source.parentElement;
	while (ancestor) {
		if (null !== visualRasterizationKind(ancestor)) return true;
		ancestor = ancestor.parentElement;
	}
	return false;
}

export function hasSpecialLayoutAncestor(source: Element): boolean {
	let current = source.parentElement;
	while (current) {
		if (isSpecialLayoutElement(current)) return true;
		current = current.parentElement;
	}
	return false;
}

export function supportsSpecialLayout(source: Element): boolean {
	let current: Element | null = source;
	while (current) {
		if (isSpecialLayoutElement(current)) return true;
		current = current.parentElement;
	}
	return false;
}

export function isMermaidSvgRoot(source: Element): boolean {
	return (
		"svg" === source.localName.toLowerCase() &&
		hasAncestorWithClass(source, "easymde-mermaid")
	);
}

export function isMermaidForeignObject(source: Element): boolean {
	return (
		"foreignobject" === source.localName.toLowerCase() &&
		hasAncestorWithClass(source, "easymde-mermaid")
	);
}

export type WechatTreePredicateCache = Readonly<{
	hasSpecialLayoutAncestor: (source: Element) => boolean;
	hasVisualRasterizationAncestor: (source: Element) => boolean;
	isInsideTable: (source: Element) => boolean;
	isKaTeXVisualNode: (source: Element) => boolean;
	isMermaidForeignObject: (source: Element) => boolean;
	isMermaidSvgRoot: (source: Element) => boolean;
	isSvgDefinition: (source: Element) => boolean;
	isSvgElement: (source: Element) => boolean;
	supportsSpecialLayout: (source: Element) => boolean;
	visualRasterizationKind: (source: Element) => WechatVisualRasterizationKind | null;
}>;

function memoizeSelfOrAncestor(
	cache: Map<Element, boolean>,
	element: Element,
	matchesSelf: (node: Element) => boolean,
): boolean {
	const direct = cache.get(element);
	if (undefined !== direct) return direct;
	const chain: Element[] = [];
	let current: Element | null = element;
	let found = false;
	while (current) {
		const cached = cache.get(current);
		if (undefined !== cached) {
			found = cached;
			break;
		}
		chain.push(current);
		if (matchesSelf(current)) {
			found = true;
			break;
		}
		current = current.parentElement;
	}
	for (const node of chain) cache.set(node, found);
	return found;
}

function memoizeStrictAncestor(
	cache: Map<Element, boolean>,
	element: Element,
	matchesAncestor: (node: Element) => boolean,
): boolean {
	const direct = cache.get(element);
	if (undefined !== direct) return direct;
	let current = element.parentElement;
	if (!current) {
		cache.set(element, false);
		return false;
	}
	const chain: Element[] = [element];
	let found = false;
	while (current) {
		if (matchesAncestor(current)) {
			found = true;
			break;
		}
		const cached = cache.get(current);
		if (undefined !== cached) {
			found = cached;
			break;
		}
		chain.push(current);
		current = current.parentElement;
	}
	for (const node of chain) cache.set(node, found);
	return found;
}

/**
 * Pass-local DOM tree predicate cache. Never retain across DOM mutations;
 * construct once per signature or serialization walk and discard when the
 * pass ends.
 */
export function createWechatTreePredicateCache(): WechatTreePredicateCache {
	const svgAncestorMap = new Map<Element, boolean>();
	const tableAncestorMap = new Map<Element, boolean>();
	const defsAncestorMap = new Map<Element, boolean>();
	const katexHtmlAncestorMap = new Map<Element, boolean>();
	const mermaidClassAncestorMap = new Map<Element, boolean>();
	const specialLayoutSelfMap = new Map<Element, boolean>();
	const specialLayoutAncestorMap = new Map<Element, boolean>();
	const visualKindMap = new Map<Element, WechatVisualRasterizationKind | null>();
	const visualAncestorMap = new Map<Element, boolean>();

	const isSpecialSelfCached = (element: Element): boolean => {
		const cached = specialLayoutSelfMap.get(element);
		if (undefined !== cached) return cached;
		const result = isSpecialLayoutElement(element);
		specialLayoutSelfMap.set(element, result);
		return result;
	};

	const getVisualKind = (
		element: Element,
	): WechatVisualRasterizationKind | null => {
		const cached = visualKindMap.get(element);
		if (undefined !== cached) return cached;
		const result = visualRasterizationKind(element);
		visualKindMap.set(element, result);
		return result;
	};

	const getHasSpecialLayoutAncestor = (element: Element): boolean =>
		memoizeStrictAncestor(
			specialLayoutAncestorMap,
			element,
			isSpecialSelfCached,
		);

	const getHasMermaidClass = (element: Element): boolean =>
		memoizeSelfOrAncestor(
			mermaidClassAncestorMap,
			element,
			(node) =>
				node.hasAttribute("class") &&
				node.classList.contains("easymde-mermaid"),
		);

	return {
		hasSpecialLayoutAncestor: getHasSpecialLayoutAncestor,
		hasVisualRasterizationAncestor: (element) =>
			memoizeStrictAncestor(
				visualAncestorMap,
				element,
				(node) => null !== getVisualKind(node),
			),
		isInsideTable: (element) =>
			memoizeSelfOrAncestor(
				tableAncestorMap,
				element,
				(node) => "table" === node.localName.toLowerCase(),
			),
		isKaTeXVisualNode: (element) =>
			(element.hasAttribute("class") && element.classList.contains("katex")) ||
			memoizeSelfOrAncestor(
				katexHtmlAncestorMap,
				element,
				(node) =>
					node.hasAttribute("class") && node.classList.contains("katex-html"),
			),
		isMermaidForeignObject: (element) =>
			"foreignobject" === element.localName.toLowerCase() &&
			getHasMermaidClass(element),
		isMermaidSvgRoot: (element) =>
			"svg" === element.localName.toLowerCase() && getHasMermaidClass(element),
		isSvgDefinition: (element) => {
			const localName = element.localName.toLowerCase();
			return (
				SVG_DEFINITION_TAGS.has(localName) ||
				memoizeSelfOrAncestor(
					defsAncestorMap,
					element,
					(node) => "defs" === node.localName.toLowerCase(),
				)
			);
		},
		isSvgElement: (element) => {
			if (SVG_NAMESPACE === element.namespaceURI) return true;
			return memoizeSelfOrAncestor(
				svgAncestorMap,
				element,
				(node) => "svg" === node.localName.toLowerCase(),
			);
		},
		supportsSpecialLayout: (element) =>
			isSpecialSelfCached(element) || getHasSpecialLayoutAncestor(element),
		visualRasterizationKind: getVisualKind,
	};
}
