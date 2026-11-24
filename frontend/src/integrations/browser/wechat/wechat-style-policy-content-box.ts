import {
	CODE_FRAME_HEADER_CLONES,
	CODE_FRAME_PSEUDO_CLONES,
	hasVisualRasterizationAncestor,
	isKaTeXVisualNode,
	THEME_HEADING_SUFFIX_CLONES,
	THEME_IMAGE_CLONES,
	visualRasterizationKind,
	WECHAT_PNG_GENERATED_IMAGES,
	WECHAT_PNG_VISUAL_CLONES,
} from "./wechat-clone-metadata";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	CONTENT_BOX_DIMENSION_KEYWORDS,
	CONTENT_BOX_DIMENSION_PROPERTIES,
	CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS,
	CONTENT_BOX_PERCENTAGE_TOKEN,
	CONTENT_BOX_PIXEL_TOKEN,
	CONTENT_BOX_REPLACED_ELEMENTS,
} from "./wechat-style-policy-catalog";

export function finitePixelValue(value: string): number | null {
	const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
}

export function hasSpecialLayoutAncestor(source: Element): boolean {
	let current = source.parentElement;
	while (current) {
		if (
			current.matches(
				"svg, math, .katex, .easymde-math-block, .easymde-math-inline",
			)
		) {
			return true;
		}
		current = current.parentElement;
	}
	return false;
}

export function supportsSpecialLayout(source: Element): boolean {
	return Boolean(
		source.closest(
			"svg, math, .katex, .easymde-math-block, .easymde-math-inline",
		),
	);
}

export function cssomProjectedDimensionValue(
	property: string,
	semantic: string,
	extra: number,
	source: Element,
): string {
	const declaration = source.ownerDocument.createElement("div").style;
	const projected = `calc(${semantic} + ${extra}px)`;
	declaration.setProperty(property, projected);
	const normalized = declaration.getPropertyValue(property).trim();
	if (!normalized) throw new Error("wechat-invalid-content-box-dimension");
	return normalized;
}

export function isContentBoxTransportableDimension(
	property: (typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number],
	value: string,
): boolean {
	const normalized = value.trim().toLowerCase();
	if (CONTENT_BOX_DIMENSION_KEYWORDS[property].has(normalized)) return true;
	if (null !== contentBoxFinitePixelValue(normalized)) return true;
	const percentage = CONTENT_BOX_PERCENTAGE_TOKEN.exec(normalized);
	if (!percentage) return false;
	const parsed = Number.parseFloat(percentage[0].slice(0, -1));
	return Number.isFinite(parsed) && parsed >= 0;
}

export function contentBoxFinitePixelValue(value: string): number | null {
	const pixel = CONTENT_BOX_PIXEL_TOKEN.exec(value.trim().toLowerCase());
	if (!pixel) return null;
	const parsed = Number.parseFloat(pixel[0]);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isContentBoxPercentageDimension(value: string): boolean {
	const match = CONTENT_BOX_PERCENTAGE_TOKEN.exec(value.trim().toLowerCase());
	if (!match) return false;
	const parsed = Number.parseFloat(match[0].slice(0, -1));
	return Number.isFinite(parsed) && parsed >= 0;
}

export function hasExcludedContentBoxParent(
	source: Element,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): boolean {
	const formattingOwnerDisplay =
		dimensionSemantics?.getFormattingOwnerDisplay(source);
	return Boolean(
		formattingOwnerDisplay &&
			CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS.has(formattingOwnerDisplay),
	);
}

export function contentBoxEdgeSum(
	computed: CSSStyleDeclaration,
	properties: readonly string[],
): number | null {
	const values = properties.map((property) =>
		contentBoxFinitePixelValue(computed.getPropertyValue(property)),
	);
	if (values.some((value) => null === value || value < 0)) return null;
	return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function isContentBoxPercentageProjectionCandidate(
	source: Element,
	semanticComputed: CSSStyleDeclaration | null,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	pseudoElement: boolean,
	root: boolean,
): boolean {
	if (root || pseudoElement || !semanticComputed) return false;
	const documentNamespace = source.ownerDocument.documentElement?.namespaceURI;
	if (!documentNamespace || documentNamespace !== source.namespaceURI)
		return false;
	if (CONTENT_BOX_REPLACED_ELEMENTS.has(source.localName.toLowerCase()))
		return false;

	const display = semanticComputed
		.getPropertyValue("display")
		.trim()
		.toLowerCase();
	const position = semanticComputed
		.getPropertyValue("position")
		.trim()
		.toLowerCase();
	const float = semanticComputed.getPropertyValue("float").trim().toLowerCase();
	if (
		"block" !== display ||
		!["static", "relative"].includes(position) ||
		"none" !== float
	)
		return false;
	if (
		"content-box" !==
		semanticComputed.getPropertyValue("box-sizing").trim().toLowerCase()
	)
		return false;

	const rawDimensions = CONTENT_BOX_DIMENSION_PROPERTIES.map((property) =>
		semanticComputed.getPropertyValue(property).trim(),
	);
	if (
		!rawDimensions.every((value, index) =>
			isContentBoxTransportableDimension(
				CONTENT_BOX_DIMENSION_PROPERTIES[
					index
				] as (typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number],
				value,
			),
		)
	)
		return false;

	const horizontalPercentage = rawDimensions
		.slice(0, 3)
		.some(isContentBoxPercentageDimension);
	const verticalPercentage = rawDimensions
		.slice(3)
		.some(isContentBoxPercentageDimension);
	const horizontalEdges = contentBoxEdgeSum(semanticComputed, [
		"padding-left",
		"padding-right",
		"border-left-width",
		"border-right-width",
	]);
	const verticalEdges = contentBoxEdgeSum(semanticComputed, [
		"padding-top",
		"padding-bottom",
		"border-top-width",
		"border-bottom-width",
	]);
	const hasPositivePercentageEdge = Boolean(
		(horizontalPercentage && null !== horizontalEdges && horizontalEdges > 0) ||
			(verticalPercentage && null !== verticalEdges && verticalEdges > 0),
	);
	if (!hasPositivePercentageEdge) return false;
	if (
		source.closest("svg, math, pre, code, table") ||
		visualRasterizationKind(source) ||
		hasVisualRasterizationAncestor(source) ||
		isKaTeXVisualNode(source) ||
		hasExcludedContentBoxParent(source, dimensionSemantics)
	)
		return false;
	return !(
		WECHAT_PNG_GENERATED_IMAGES.has(source) ||
		WECHAT_PNG_VISUAL_CLONES.has(source) ||
		THEME_IMAGE_CLONES.has(source) ||
		CODE_FRAME_PSEUDO_CLONES.has(source) ||
		CODE_FRAME_HEADER_CLONES.has(source) ||
		THEME_HEADING_SUFFIX_CLONES.has(source)
	);
}

export function contentBoxDimensionValue(
	property: string,
	value: string,
	source: Element,
	computed: CSSStyleDeclaration,
): string {
	if (
		supportsSpecialLayout(source) ||
		![
			"width",
			"min-width",
			"max-width",
			"height",
			"min-height",
			"max-height",
		].includes(property) ||
		"content-box" !==
			computed.getPropertyValue("box-sizing").trim().toLowerCase()
	)
		return value;

	const dimension = finitePixelValue(value);
	const horizontal = property.endsWith("width");
	const extraProperties = horizontal
		? [
				"padding-left",
				"padding-right",
				"border-left-width",
				"border-right-width",
			]
		: [
				"padding-top",
				"padding-bottom",
				"border-top-width",
				"border-bottom-width",
			];
	const extra = extraProperties.reduce(
		(total, extraProperty) =>
			total + (finitePixelValue(computed.getPropertyValue(extraProperty)) ?? 0),
		0,
	);
	if (null === dimension) {
		const semantic = value.trim();
		if (!extra || "auto" === semantic || "none" === semantic) return value;
		if (/%|(?:^|\s)calc\(/i.test(semantic)) {
			return cssomProjectedDimensionValue(property, semantic, extra, source);
		}
		return value;
	}
	return `${dimension + extra}px`;
}
