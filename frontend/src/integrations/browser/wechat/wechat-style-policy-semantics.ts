import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	buildPaddingCascadeIndex,
	evaluatePortablePaddingTransportDecision,
	type PaddingCascadeIndex,
	SEMANTIC_PADDING_PROPERTIES,
	type SemanticPaddingProperty,
} from "./wechat-padding-cascade";
import {
	CONTENT_BOX_PERCENTAGE_TOKEN,
	CONTENT_BOX_PIXEL_TOKEN,
	CSS_PERCENTAGE_TOKEN,
	SEMANTIC_MARGIN_PROPERTIES,
	SIGNATURE_ORDINARY_PROPERTIES,
	SIGNATURE_ORDINARY_PSEUDO_PROPERTIES,
	SIGNATURE_ORDINARY_ROOT_PROPERTIES,
	SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES,
	SIGNATURE_SPECIAL_PROPERTIES,
	SIGNATURE_SPECIAL_PSEUDO_PROPERTIES,
	SIGNATURE_SVG_PROPERTIES,
	SIGNATURE_SVG_PSEUDO_PROPERTIES,
	WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE,
} from "./wechat-style-policy-catalog";
import {
	hasSpecialLayoutAncestor,
	isSvgElement,
	supportsSpecialLayout,
	type WechatTreePredicateCache,
} from "./wechat-tree-predicates";

export { buildPaddingCascadeIndex, type PaddingCascadeIndex };

function isSemanticMathNode(source: Element): boolean {
	if ("math" === source.localName.toLowerCase()) return true;
	if (!source.hasAttribute("class")) return false;
	const classList = source.classList;
	return (
		classList.contains("katex") ||
		classList.contains("easymde-math-block") ||
		classList.contains("easymde-math-inline")
	);
}

export function semanticMarginSource(
	source: Element,
	computed: CSSStyleDeclaration,
	pseudoElement?: "::before" | "::after",
	predicates?: WechatTreePredicateCache,
): boolean {
	const specialNode = isSemanticMathNode(source);
	const hasSpecialAncestor = predicates
		? predicates.hasSpecialLayoutAncestor(source)
		: hasSpecialLayoutAncestor(source);
	if (pseudoElement) {
		const svg = predicates
			? predicates.isSvgElement(source)
			: isSvgElement(source);
		return (
			!svg &&
			!specialNode &&
			!hasSpecialAncestor &&
			["static", "relative"].includes(
				computed.getPropertyValue("position").trim().toLowerCase(),
			)
		);
	}
	if ("svg" === source.localName.toLowerCase()) {
		return !hasSpecialAncestor;
	}
	const svg = predicates
		? predicates.isSvgElement(source)
		: isSvgElement(source);
	return !svg && !specialNode && !hasSpecialAncestor;
}

export function semanticMarginValueForEligibleStyle(
	property: string,
	semanticStyle: CSSStyleDeclaration | null,
): string | null {
	const semantic = semanticStyle?.getPropertyValue(property).trim();
	if ("auto" === semantic) return semantic;
	if (!semantic) return null;
	const percentage = CSS_PERCENTAGE_TOKEN.exec(semantic);
	if (!percentage || !Number.isFinite(Number(percentage[0].slice(0, -1))))
		return null;
	return semantic;
}

export function semanticMarginValue(
	property: string,
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	pseudoElement?: "::before" | "::after",
	semanticComputed?: CSSStyleDeclaration | null,
	predicates?: WechatTreePredicateCache,
): string | null {
	if (
		!SEMANTIC_MARGIN_PROPERTIES.includes(
			property as (typeof SEMANTIC_MARGIN_PROPERTIES)[number],
		)
	) {
		return null;
	}
	if (
		!dimensionSemantics ||
		!semanticMarginSource(source, computed, pseudoElement, predicates)
	)
		return null;
	const semanticStyle =
		undefined !== semanticComputed
			? semanticComputed
			: dimensionSemantics.getComputedStyle(source, pseudoElement);
	return semanticMarginValueForEligibleStyle(property, semanticStyle);
}

export function semanticMarginSignature(
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	pseudoElement?: "::before" | "::after",
	semanticComputed?: CSSStyleDeclaration | null,
	predicates?: WechatTreePredicateCache,
): string {
	if (
		!dimensionSemantics ||
		!semanticMarginSource(source, computed, pseudoElement, predicates)
	)
		return "";
	const semantic =
		undefined !== semanticComputed
			? semanticComputed
			: dimensionSemantics.getComputedStyle(source, pseudoElement);
	if (!semantic) return "";
	return SEMANTIC_MARGIN_PROPERTIES.map(
		(property) => `${property}=${semantic.getPropertyValue(property).trim()}`,
	).join(";");
}

export function semanticPaddingValueForEligibleStyle(
	property: SemanticPaddingProperty,
	source: Element,
	semanticStyle: CSSStyleDeclaration | null,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): string | null {
	return evaluatePortablePaddingTransportDecision(
		source,
		property,
		semanticStyle,
		dimensionSemantics,
	).value;
}

export function semanticPaddingValue(
	property: string,
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	semanticComputed?: CSSStyleDeclaration | null,
	predicates?: WechatTreePredicateCache,
): string | null {
	if (
		!SEMANTIC_PADDING_PROPERTIES.includes(property as SemanticPaddingProperty)
	) {
		return null;
	}
	if (
		!dimensionSemantics ||
		!semanticMarginSource(source, computed, undefined, predicates)
	) {
		return null;
	}
	const semanticStyle =
		semanticComputed ?? dimensionSemantics.getComputedStyle(source);
	return semanticPaddingValueForEligibleStyle(
		property as SemanticPaddingProperty,
		source,
		semanticStyle,
		dimensionSemantics,
	);
}

export function semanticPaddingSignature(
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	semanticComputed?: CSSStyleDeclaration | null,
	predicates?: WechatTreePredicateCache,
): string {
	if (
		!dimensionSemantics ||
		!semanticMarginSource(source, computed, undefined, predicates)
	)
		return "";
	const semanticStyle =
		semanticComputed ?? dimensionSemantics.getComputedStyle(source);
	const values = SEMANTIC_PADDING_PROPERTIES.map((property) => {
		const decision = evaluatePortablePaddingTransportDecision(
			source,
			property,
			semanticStyle,
			dimensionSemantics,
		);
		return `${property}=${decision.signature}`;
	});
	return values.some((value) => !value.endsWith("=")) ? values.join(";") : "";
}

const TRANSFORM_ORIGIN_HORIZONTAL_KEYWORDS = new Set(["left", "right"]);
const TRANSFORM_ORIGIN_VERTICAL_KEYWORDS = new Set(["top", "bottom"]);

/**
 * The raw style context reports `transform-origin` before it is resolved
 * against a layout box (`50% 50%` for the default center), while the measured
 * layout context resolves the same declaration into source pixels
 * (`327.5px 1.5px`). Transporting those pixels freezes the origin to the source
 * width, so a narrower paste target paints the scaled element outside its own
 * box. Only a bounded percentage, pixel, or axis-keyword token list is
 * transported verbatim; every other form, such as an unresolved `calc()`,
 * keeps the measured value instead of inventing semantics.
 */
export function transportableTransformOriginSemantics(
	value: string,
): string | null {
	const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!tokens.length || tokens.length > 3) return null;
	const zAxis = tokens[2];
	if (3 === tokens.length && (!zAxis || !CONTENT_BOX_PIXEL_TOKEN.test(zAxis)))
		return null;
	let horizontalKeywords = 0;
	let verticalKeywords = 0;
	for (const token of tokens.slice(0, 2)) {
		if (
			CONTENT_BOX_PERCENTAGE_TOKEN.test(token) ||
			CONTENT_BOX_PIXEL_TOKEN.test(token)
		)
			continue;
		if ("center" === token) continue;
		if (TRANSFORM_ORIGIN_HORIZONTAL_KEYWORDS.has(token)) {
			horizontalKeywords += 1;
			continue;
		}
		if (TRANSFORM_ORIGIN_VERTICAL_KEYWORDS.has(token)) {
			verticalKeywords += 1;
			continue;
		}
		return null;
	}
	return horizontalKeywords > 1 || verticalKeywords > 1
		? null
		: tokens.join(" ");
}

export function rootExportComputedStyle(
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics?: WechatDimensionSemanticsContext | null,
	pseudoElement?: string,
): CSSStyleDeclaration {
	if (source.hasAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE))
		return computed;
	return (
		dimensionSemantics?.getRootComputedStyle(source, pseudoElement) ?? computed
	);
}

export function signatureStyleProperties(
	source: Element,
	root = false,
	pseudoElement = false,
	predicates?: WechatTreePredicateCache,
): readonly string[] {
	const svg = predicates
		? predicates.isSvgElement(source)
		: isSvgElement(source);
	const special = predicates
		? predicates.supportsSpecialLayout(source)
		: supportsSpecialLayout(source);
	if (pseudoElement) {
		if (svg) return SIGNATURE_SVG_PSEUDO_PROPERTIES;
		if (special) return SIGNATURE_SPECIAL_PSEUDO_PROPERTIES;
		return root
			? SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES
			: SIGNATURE_ORDINARY_PSEUDO_PROPERTIES;
	}
	if (svg) return SIGNATURE_SVG_PROPERTIES;
	if (special) return SIGNATURE_SPECIAL_PROPERTIES;
	return root
		? SIGNATURE_ORDINARY_ROOT_PROPERTIES
		: SIGNATURE_ORDINARY_PROPERTIES;
}

export function semanticTransformOriginSignature(
	source: Element,
	rawComputed: CSSStyleDeclaration | null,
	predicates?: WechatTreePredicateCache,
): string {
	const special = predicates
		? predicates.supportsSpecialLayout(source)
		: supportsSpecialLayout(source);
	const svg = predicates
		? predicates.isSvgElement(source)
		: isSvgElement(source);
	if (!rawComputed || special || svg) return "";
	const semantic = transportableTransformOriginSemantics(
		rawComputed.getPropertyValue("transform-origin"),
	);
	return semantic ? `transform-origin=${semantic}` : "";
}
