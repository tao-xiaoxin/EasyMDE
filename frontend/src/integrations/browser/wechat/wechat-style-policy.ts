import { isSvgElement, isTaskListCheckbox } from "./wechat-clone-metadata";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { pseudoContent } from "./wechat-pseudo-content";
import {
	CONTENT_BOX_PROMOTED_PROPERTIES,
	COPY_STYLE_PROPERTIES,
	DEFAULT_STYLE_VALUES,
	hasOnlySafeDataImageUrls,
	MAX_DATA_IMAGE_LENGTH,
	ORDINARY_DIMENSION_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
	PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES,
	SAFE_DATA_IMAGE,
	SAFE_DISPLAY_VALUES,
	SPECIAL_LAYOUT_PROPERTIES,
	SVG_STYLE_PROPERTIES,
	TASK_LIST_CHECKBOX_STYLE_PROPERTIES,
	TRANSIENT_ATTRIBUTE,
	UNSAFE_STYLE_VALUE,
	UNSAFE_URL,
	URL_ATTRIBUTES,
} from "./wechat-style-policy-catalog";
import {
	contentBoxDimensionValue,
	isContentBoxPercentageProjectionCandidate,
	supportsSpecialLayout,
} from "./wechat-style-policy-content-box";
import {
	rootExportComputedStyle,
	semanticMarginSource,
	semanticMarginValue,
	semanticPaddingValue,
	transportableTransformOriginSemantics,
} from "./wechat-style-policy-semantics";
import {
	taskCheckboxFontWithoutZeroLineHeight,
	taskCheckboxLineHeightIsZero,
} from "./wechat-task-checkbox-style";

export { splitSelectorList } from "../../../shared/css/selector-list";
export {
	CONTENT_BOX_DIMENSION_KEYWORDS,
	CONTENT_BOX_DIMENSION_PROPERTIES,
	CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS,
	CONTENT_BOX_PERCENTAGE_TOKEN,
	CONTENT_BOX_PIXEL_TOKEN,
	CONTENT_BOX_PROMOTED_PROPERTIES,
	CONTENT_BOX_REPLACED_ELEMENTS,
	COPY_STYLE_PROPERTIES,
	CSS_PERCENTAGE_TOKEN,
	CSS_URL,
	DEFAULT_STYLE_VALUES,
	hasOnlySafeDataImageUrls,
	MAX_DATA_IMAGE_LENGTH,
	NATIVE_LAYOUT_PROPERTIES,
	ORDINARY_DIMENSION_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
	PREPARED_PSEUDO_ELEMENTS,
	PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES,
	ROOT_EXPORT_STYLE_PROPERTIES,
	SAFE_DATA_IMAGE,
	SAFE_DISPLAY_VALUES,
	SEMANTIC_MARGIN_PROPERTIES,
	SIGNATURE_ORDINARY_PROPERTIES,
	SIGNATURE_ORDINARY_PSEUDO_PROPERTIES,
	SIGNATURE_ORDINARY_ROOT_PROPERTIES,
	SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES,
	SIGNATURE_SPECIAL_PROPERTIES,
	SIGNATURE_SPECIAL_PSEUDO_PROPERTIES,
	SIGNATURE_SVG_PROPERTIES,
	SIGNATURE_SVG_PSEUDO_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	SVG_STYLE_PROPERTIES,
	TASK_LIST_CHECKBOX_STYLE_PROPERTIES,
	TRANSIENT_ATTRIBUTE,
	UNSAFE_STYLE_VALUE,
	UNSAFE_URL,
	URL_ATTRIBUTES,
	uniqueStyleProperties,
	WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE,
} from "./wechat-style-policy-catalog";
export {
	contentBoxDimensionValue,
	contentBoxEdgeSum,
	contentBoxFinitePixelValue,
	cssomProjectedDimensionValue,
	finitePixelValue,
	hasExcludedContentBoxParent,
	hasSpecialLayoutAncestor,
	isContentBoxPercentageDimension,
	isContentBoxPercentageProjectionCandidate,
	isContentBoxTransportableDimension,
	supportsSpecialLayout,
} from "./wechat-style-policy-content-box";
export {
	rootExportComputedStyle,
	semanticMarginSignature,
	semanticMarginSource,
	semanticMarginValue,
	semanticPaddingSignature,
	semanticPaddingValue,
	semanticTransformOriginSignature,
	signatureStyleProperties,
	transportableTransformOriginSemantics,
} from "./wechat-style-policy-semantics";

function taskCheckboxPseudoHasTextContent(
	pseudoElement: boolean,
	computedContent: string,
): boolean {
	if (!pseudoElement) return false;
	const content = pseudoContent(computedContent);
	return null !== content && "" !== content;
}

export function portableStyleValue(
	property: string,
	value: string,
	source: Element,
	computed: CSSStyleDeclaration,
	pseudoElement = false,
	computedContent = "",
): string {
	if ("font" === property)
		return taskCheckboxFontWithoutZeroLineHeight(
			source,
			value,
			taskCheckboxPseudoHasTextContent(pseudoElement, computedContent),
		);
	if (
		"box-sizing" === property &&
		!supportsSpecialLayout(source) &&
		"content-box" === value.trim().toLowerCase()
	)
		return "border-box";
	if (
		[
			"width",
			"min-width",
			"max-width",
			"height",
			"min-height",
			"max-height",
		].includes(property)
	) {
		return contentBoxDimensionValue(property, value, source, computed);
	}
	if ("text-align" !== property) return value;
	const normalized = value.trim().toLowerCase();
	if ("start" === normalized)
		return "rtl" === sourceDirection(source, computed) ? "right" : "left";
	if ("end" === normalized)
		return "rtl" === sourceDirection(source, computed) ? "left" : "right";
	return value;
}

export function keepStyle(
	property: string,
	value: string,
	source: Element,
	pseudoElement = false,
	root = false,
	sourceValue = value,
	omitDefaultValues = true,
	pseudoElementContent = "",
): boolean {
	if (
		taskCheckboxLineHeightIsZero(
			source,
			property,
			value,
			taskCheckboxPseudoHasTextContent(pseudoElement, pseudoElementContent),
		)
	)
		return false;
	const isTransparentBorderColor =
		property.endsWith("-color") &&
		property.startsWith("border-") &&
		("rgba(0, 0, 0, 0)" === value || "transparent" === value);
	if (
		!value ||
		("rgba(0, 0, 0, 0)" === value &&
			"color" !== property &&
			!isTransparentBorderColor)
	)
		return false;
	if (
		root &&
		"display" === property &&
		!["block", "inline", "table"].includes(value)
	)
		return false;
	const svgFragmentUrl =
		Boolean(source.closest("svg")) &&
		/^url\(\s*["']?#[a-z\d:_.-]+["']?\s*\)$/i.test(value);
	const safeDataImageStyle =
		["background", "background-image"].includes(property) &&
		hasOnlySafeDataImageUrls(value);
	if (UNSAFE_STYLE_VALUE.test(value) && !svgFragmentUrl && !safeDataImageStyle)
		return false;
	if ("display" === property && true !== SAFE_DISPLAY_VALUES[value])
		return false;
	if (
		"container-type" === property &&
		!["normal", "size", "inline-size", "style"].includes(value)
	)
		return false;
	if (
		"float" === property &&
		!["none", "left", "right", "inline-start", "inline-end"].includes(value)
	)
		return false;
	if (
		"clear" === property &&
		!["none", "left", "right", "both", "inline-start", "inline-end"].includes(
			value,
		)
	)
		return false;
	if (
		"position" === property &&
		!["static", "relative", "absolute"].includes(value)
	)
		return false;
	const preservesInheritedDefault =
		PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES.has(property);
	if (
		omitDefaultValues &&
		!preservesInheritedDefault &&
		DEFAULT_STYLE_VALUES[property]?.has(value)
	)
		return false;
	if (pseudoElement && ["width", "height"].includes(property)) {
		const sourceMatch =
			/^(\d+(?:\.\d+)?)(?:px|em|rem|%|cqi|cqw|cqb|cqh|cqmin|cqmax)$/.exec(
				sourceValue,
			);
		const limit = "width" === property ? 320 : 120;
		if (!sourceMatch || Number(sourceMatch[1]) > limit) return false;
		const normalizedMatch =
			/^(\d+(?:\.\d+)?)(?:px|em|rem|%|cqi|cqw|cqb|cqh|cqmin|cqmax)$/.exec(
				value,
			);
		if (!normalizedMatch) return false;
	}
	return true;
}

export function portableStyleDeclaration(
	property: string,
	value: string,
	important = false,
): string {
	return `${property}:${value}${important || "overflow-wrap" === property ? "!important" : ""}`;
}

export function removeTransientAttributes(clone: Element): void {
	for (const attribute of Array.from(clone.attributes)) {
		const name = attribute.name.toLowerCase();
		const value = attribute.value.trim().replace(/\s+/g, "");
		const unsafeUrl =
			UNSAFE_URL.test(value) &&
			!(
				"data:" === value.slice(0, 5).toLowerCase() &&
				value.length <= MAX_DATA_IMAGE_LENGTH &&
				SAFE_DATA_IMAGE.test(value)
			);
		if (
			TRANSIENT_ATTRIBUTE.test(name) ||
			(URL_ATTRIBUTES.has(name) && unsafeUrl)
		) {
			clone.removeAttribute(attribute.name);
		}
		if ("srcset" === name) {
			const candidates: string[] = [];
			let remainder = attribute.value.trim();
			while (remainder) {
				const dataMatch =
					/^(data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+)(?:\s+([^,]+))?(?:,|$)/i.exec(
						remainder,
					);
				const separator = dataMatch ? -1 : remainder.indexOf(",");
				const candidate = (
					dataMatch
						? dataMatch[1] + (dataMatch[2] ? ` ${dataMatch[2].trim()}` : "")
						: separator < 0
							? remainder
							: remainder.slice(0, separator)
				).trim();
				const nextOffset = dataMatch
					? dataMatch[0].length
					: separator < 0
						? remainder.length
						: separator + 1;
				const candidateUrl = candidate.split(/\s+/, 1)[0] ?? "";
				if (
					"" !== candidateUrl &&
					(!UNSAFE_URL.test(candidateUrl) ||
						(SAFE_DATA_IMAGE.test(candidateUrl) &&
							candidateUrl.length <= MAX_DATA_IMAGE_LENGTH))
				) {
					candidates.push(candidate);
				}
				if (nextOffset >= remainder.length) break;
				remainder = remainder.slice(nextOffset).trim();
			}
			if (candidates.length)
				clone.setAttribute(attribute.name, candidates.join(", "));
			else clone.removeAttribute(attribute.name);
		}
	}
}

export function appendDeclarations(
	element: Element,
	declarations: string[],
	important = false,
): void {
	if (!declarations.length) return;
	const existing = element.getAttribute("style") ?? "";
	const normalized = important
		? declarations.map((declaration) =>
				declaration.endsWith("!important")
					? declaration
					: `${declaration}!important`,
			)
		: declarations;
	element.setAttribute(
		"style",
		[existing, ...normalized].filter(Boolean).join(";"),
	);
}

export function isHiddenPseudoPaint(computed: CSSStyleDeclaration): boolean {
	const display = computed.getPropertyValue("display").trim().toLowerCase();
	const visibility = computed
		.getPropertyValue("visibility")
		.trim()
		.toLowerCase();
	const contentVisibility = computed
		.getPropertyValue("content-visibility")
		.trim()
		.toLowerCase();
	const opacity = Number.parseFloat(computed.getPropertyValue("opacity"));
	return (
		"none" === display ||
		"hidden" === visibility ||
		"collapse" === visibility ||
		"hidden" === contentVisibility ||
		(Number.isFinite(opacity) && opacity <= 0)
	);
}

export function sourceDirection(
	source: Element,
	computed: CSSStyleDeclaration,
): "ltr" | "rtl" {
	const computedDirection = computed
		.getPropertyValue("direction")
		.trim()
		.toLowerCase();
	if ("rtl" === computedDirection) return "rtl";
	if ("ltr" === computedDirection) return "ltr";

	const declaredDirection = source
		.closest("[dir]")
		?.getAttribute("dir")
		?.trim()
		.toLowerCase();
	if ("rtl" === declaredDirection) return "rtl";
	if ("ltr" === declaredDirection) return "ltr";

	const documentDirection = source.ownerDocument.documentElement
		?.getAttribute("dir")
		?.trim()
		.toLowerCase();
	return "rtl" === documentDirection ? "rtl" : "ltr";
}

export function generatedBlockImageAlignment(
	image: Element,
	owner: Element,
): void {
	const imageStyle = (image as Element & { style?: CSSStyleDeclaration }).style;
	const ownerStyle = (owner as Element & { style?: CSSStyleDeclaration }).style;
	if (
		!imageStyle ||
		!ownerStyle ||
		"block" !== imageStyle.getPropertyValue("display").trim().toLowerCase()
	) {
		return;
	}
	const textAlign = ownerStyle
		.getPropertyValue("text-align")
		.trim()
		.toLowerCase();
	if ("center" === textAlign) {
		appendDeclarations(image, ["margin-left:auto", "margin-right:auto"], true);
	} else if ("right" === textAlign || "end" === textAlign) {
		appendDeclarations(image, ["margin-left:auto", "margin-right:0"], true);
	} else if ("left" === textAlign || "start" === textAlign) {
		appendDeclarations(image, ["margin-left:0", "margin-right:auto"], true);
	}
}

export type PortableStyleDeclarationContext = Readonly<{
	computed: CSSStyleDeclaration;
	dimensionSemantics: WechatDimensionSemanticsContext | null;
	promoteContentBoxBounds: boolean;
	pseudoElement: boolean;
	pseudoElementName: "::before" | "::after" | undefined;
	root: boolean;
	semanticComputed: CSSStyleDeclaration | null;
	semanticMarginComputed: CSSStyleDeclaration | null;
	source: Element;
	style: CSSStyleDeclaration;
}>;

export function portableStyleProperties(
	source: Element,
	pseudoElement: boolean,
	root: boolean,
): readonly string[] {
	return [
		...COPY_STYLE_PROPERTIES,
		...(isTaskListCheckbox(source) && !pseudoElement
			? TASK_LIST_CHECKBOX_STYLE_PROPERTIES
			: []),
		...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
		...(supportsSpecialLayout(source)
			? SPECIAL_LAYOUT_PROPERTIES
			: root
				? []
				: ORDINARY_LAYOUT_PROPERTIES),
		...(pseudoElement ? ["width", "height"] : []),
	];
}

export function createStyleDeclarationContext(
	source: Element,
	computed: CSSStyleDeclaration,
	pseudoElement: boolean,
	root: boolean,
	dimensionSemantics?: WechatDimensionSemanticsContext | null,
	pseudoElementName?: "::before" | "::after",
): PortableStyleDeclarationContext {
	const style =
		root && !pseudoElement
			? rootExportComputedStyle(source, computed, dimensionSemantics)
			: computed;
	const semanticComputed =
		!pseudoElement && !supportsSpecialLayout(source)
			? root
				? style
				: dimensionSemantics?.getComputedStyle(source)
			: null;
	const semanticMarginComputed =
		dimensionSemantics &&
		semanticMarginSource(
			source,
			computed,
			pseudoElement ? pseudoElementName : undefined,
		)
			? pseudoElement
				? dimensionSemantics.getComputedStyle(source, pseudoElementName)
				: (semanticComputed ?? dimensionSemantics.getComputedStyle(source))
			: null;
	const promoteContentBoxBounds = isContentBoxPercentageProjectionCandidate(
		source,
		semanticComputed ?? null,
		dimensionSemantics ?? null,
		pseudoElement,
		root,
	);
	return {
		computed,
		dimensionSemantics: dimensionSemantics ?? null,
		promoteContentBoxBounds,
		pseudoElement,
		pseudoElementName,
		root,
		semanticComputed: semanticComputed ?? null,
		semanticMarginComputed,
		source,
		style,
	};
}

export function appendPortableStyleDeclaration(
	context: PortableStyleDeclarationContext,
	property: string,
	value: string,
	materializedValue: string,
	declarations: string[],
): void {
	const semanticCandidate =
		context.semanticComputed?.getPropertyValue(property).trim() ?? "";
	const semanticMarginCandidate = semanticMarginValue(
		property,
		context.source,
		context.computed,
		context.dimensionSemantics,
		context.pseudoElement ? context.pseudoElementName : undefined,
		context.semanticMarginComputed,
	);
	const semanticPaddingCandidate = context.pseudoElement
		? null
		: semanticPaddingValue(
				property,
				context.source,
				context.computed,
				context.dimensionSemantics,
				context.semanticComputed,
			);
	const isOrdinaryDimension =
		!context.pseudoElement &&
		!supportsSpecialLayout(context.source) &&
		ORDINARY_DIMENSION_PROPERTIES.includes(
			property as (typeof ORDINARY_DIMENSION_PROPERTIES)[number],
		);
	const preserveRawContentBoxTuple =
		context.promoteContentBoxBounds &&
		("box-sizing" === property || isOrdinaryDimension);
	// Ordinary `transform-origin` transports the raw percentage/pixel/keyword
	// semantics when the raw context still exposes them, so the origin stays
	// relative to the paste target's own box instead of the source measurement
	// width. Explicit pixel origins keep their exact value.
	const semanticTransformOrigin =
		"transform-origin" === property
			? transportableTransformOriginSemantics(semanticCandidate)
			: null;
	const sourceValue =
		semanticTransformOrigin ??
		(preserveRawContentBoxTuple && semanticCandidate
			? semanticCandidate
			: (semanticPaddingCandidate ??
				semanticMarginCandidate ??
				(isOrdinaryDimension && semanticCandidate
					? semanticCandidate
					: materializedValue)));
	const pseudoElementContent = context.pseudoElement
		? context.computed.getPropertyValue("content")
		: "";
	const normalizedValue = preserveRawContentBoxTuple
		? sourceValue
		: portableStyleValue(
				property,
				sourceValue,
				context.source,
				context.style,
				context.pseudoElement,
				pseudoElementContent,
			);
	if (
		keepStyle(
			property,
			normalizedValue,
			context.source,
			context.pseudoElement,
			context.root,
			value,
			true,
			pseudoElementContent,
		)
	) {
		declarations.push(
			portableStyleDeclaration(
				property,
				normalizedValue,
				context.promoteContentBoxBounds &&
					CONTENT_BOX_PROMOTED_PROPERTIES.has(property),
			),
		);
	}
}
