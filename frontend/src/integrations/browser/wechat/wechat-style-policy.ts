import { isSvgElement, isTaskListCheckbox } from "./wechat-clone-metadata";
import { splitCssDeclarations } from "./wechat-css-list";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { pseudoContent } from "./wechat-pseudo-content";
import {
	CONTENT_BOX_PROMOTED_PROPERTIES,
	COPY_STYLE_PROPERTIES,
	hasOnlySafeDataImageUrls,
	MAX_DATA_IMAGE_LENGTH,
	ORDINARY_DIMENSION_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
	PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES,
	SAFE_DATA_IMAGE,
	SAFE_DISPLAY_VALUES,
	SEMANTIC_MARGIN_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	SVG_STYLE_PROPERTIES,
	TASK_LIST_CHECKBOX_STYLE_PROPERTIES,
	TRANSIENT_ATTRIBUTE,
	UNSAFE_STYLE_VALUE,
	UNSAFE_URL,
	URL_ATTRIBUTES,
	uniqueStyleProperties,
	WECHAT_DARKMODE_GRADIENT_EXEMPTION,
	WECHAT_GRADIENT_FUNCTION,
	WECHAT_IGNORE_DARKMODE_ATTRIBUTE,
} from "./wechat-style-policy-catalog";
import {
	contentBoxDimensionValue,
	isContentBoxPercentageProjectionCandidate,
	supportsSpecialLayout,
} from "./wechat-style-policy-content-box";
import {
	rootExportComputedStyle,
	semanticMarginSource,
	semanticMarginValueForEligibleStyle,
	semanticPaddingValueForEligibleStyle,
	transportableTransformOriginSemantics,
} from "./wechat-style-policy-semantics";
import {
	createElementStylePruningCache,
	shouldPruneDefaultStyle,
	type WechatElementStylePruningCache,
} from "./wechat-style-pruning";
import {
	fontWithoutZeroLineHeight,
	shouldOmitZeroLineHeight,
} from "./wechat-task-checkbox-style";
import type { WechatTreePredicateCache } from "./wechat-tree-predicates";

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
	WECHAT_DARKMODE_GRADIENT_EXEMPTION,
	WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE,
	WECHAT_GRADIENT_FUNCTION,
	WECHAT_IGNORE_DARKMODE_ATTRIBUTE,
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
	buildPaddingCascadeIndex,
	type PaddingCascadeIndex,
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
export {
	createElementStylePruningCache,
	type WechatElementStylePruningCache,
} from "./wechat-style-pruning";

const ORDINARY_DIMENSION_PROPERTY_SET: ReadonlySet<string> = new Set(
	ORDINARY_DIMENSION_PROPERTIES,
);
const SEMANTIC_MARGIN_PROPERTY_SET: ReadonlySet<string> = new Set(
	SEMANTIC_MARGIN_PROPERTIES,
);

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
	specialLayout?: boolean,
): string {
	if ("font" === property)
		return fontWithoutZeroLineHeight(
			source,
			value,
			pseudoElement,
			taskCheckboxPseudoHasTextContent(pseudoElement, computedContent),
		);
	if (
		"box-sizing" === property &&
		!(specialLayout ?? supportsSpecialLayout(source)) &&
		"content-box" === value.trim().toLowerCase()
	)
		return "border-box";
	if (ORDINARY_DIMENSION_PROPERTY_SET.has(property)) {
		return contentBoxDimensionValue(
			property,
			value,
			source,
			computed,
			specialLayout,
		);
	}
	if ("text-align" !== property) return value;
	const normalized = value.trim().toLowerCase();
	if ("start" === normalized)
		return "rtl" === sourceDirection(source, computed) ? "right" : "left";
	if ("end" === normalized)
		return "rtl" === sourceDirection(source, computed) ? "left" : "right";
	return value;
}

export type KeepStyleOptions = Readonly<{
	computed?: CSSStyleDeclaration | undefined;
	omitDefaultValues?: boolean | undefined;
	predicates?: WechatTreePredicateCache | undefined;
	pruningCache?: WechatElementStylePruningCache | undefined;
	pseudoElement?: boolean | undefined;
	pseudoElementContent?: string | undefined;
	root?: boolean | undefined;
	sourceValue?: string | undefined;
	svgElement?: boolean | undefined;
}>;

export function keepStyle(
	property: string,
	value: string,
	source: Element,
	options?: KeepStyleOptions,
): boolean {
	const computed = options?.computed;
	const omitDefaultValues = options?.omitDefaultValues ?? true;
	const predicates = options?.predicates;
	const pruningCache = options?.pruningCache;
	const pseudoElement = options?.pseudoElement ?? false;
	const pseudoElementContent = options?.pseudoElementContent ?? "";
	const root = options?.root ?? false;
	const sourceValue = options?.sourceValue ?? value;
	const svgElement = options?.svgElement;
	if (
		omitDefaultValues &&
		"line-height" === property &&
		shouldOmitZeroLineHeight(
			source,
			property,
			value,
			pseudoElement,
			taskCheckboxPseudoHasTextContent(pseudoElement, pseudoElementContent),
			{
				isSvg: svgElement,
				isTaskListCheckbox: pruningCache?.taskListCheckbox,
			},
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
	const isSvg =
		svgElement ??
		(predicates ? predicates.isSvgElement(source) : isSvgElement(source));
	if (UNSAFE_STYLE_VALUE.test(value)) {
		const svgFragmentUrl =
			isSvg && /^url\(\s*["']?#[a-z\d:_.-]+["']?\s*\)$/i.test(value);
		const safeDataImageStyle =
			("background" === property || "background-image" === property) &&
			hasOnlySafeDataImageUrls(value);
		if (!svgFragmentUrl && !safeDataImageStyle) return false;
	}
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
		shouldPruneDefaultStyle(property, value, source, {
			computed,
			isSvg,
			predicates,
			pruningCache,
			pseudoElement,
			root,
		})
	) {
		return false;
	}
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
	const attributes = clone.attributes;
	for (let index = attributes.length - 1; index >= 0; index -= 1) {
		const attribute = attributes[index];
		if (!attribute) continue;
		const name = attribute.name.toLowerCase();
		if (TRANSIENT_ATTRIBUTE.test(name)) {
			clone.removeAttribute(attribute.name);
			continue;
		}
		if (URL_ATTRIBUTES.has(name)) {
			const value = attribute.value.trim().replace(/\s+/g, "");
			const unsafeUrl =
				UNSAFE_URL.test(value) &&
				!(
					"data:" === value.slice(0, 5).toLowerCase() &&
					value.length <= MAX_DATA_IMAGE_LENGTH &&
					SAFE_DATA_IMAGE.test(value)
				);
			if (unsafeUrl) {
				clone.removeAttribute(attribute.name);
			}
			continue;
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
	predicates: WechatTreePredicateCache | undefined;
	promoteContentBoxBounds: boolean;
	pruningCache: WechatElementStylePruningCache;
	pseudoElement: boolean;
	pseudoElementContent: string;
	pseudoElementName: "::before" | "::after" | undefined;
	root: boolean;
	semanticComputed: CSSStyleDeclaration | null;
	semanticMarginComputed: CSSStyleDeclaration | null;
	semanticMarginEligible: boolean;
	semanticPaddingEligible: boolean;
	source: Element;
	specialLayout: boolean;
	style: CSSStyleDeclaration;
	svg: boolean;
	taskCheckbox: boolean;
}>;

const PORTABLE_ORDINARY_ROOT_PROPERTIES = COPY_STYLE_PROPERTIES;
const PORTABLE_ORDINARY_ROOT_PSEUDO_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	["width", "height"],
);
const PORTABLE_ORDINARY_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
);
const PORTABLE_ORDINARY_TASK_CHECKBOX_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	TASK_LIST_CHECKBOX_STYLE_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
);
const PORTABLE_SPECIAL_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
);
const PORTABLE_SVG_SPECIAL_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	SVG_STYLE_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
);
const PORTABLE_SVG_NON_STOP_SPECIAL_PROPERTIES =
	PORTABLE_SVG_SPECIAL_PROPERTIES.filter(
		(property) => "stop-color" !== property && "stop-opacity" !== property,
	);

export function portableStyleProperties(
	source: Element,
	pseudoElement: boolean,
	root: boolean,
	precomputed?: Readonly<{
		specialLayout?: boolean;
		svg?: boolean;
		taskCheckbox?: boolean;
	}>,
): readonly string[] {
	const taskCheckbox =
		precomputed?.taskCheckbox ?? (isTaskListCheckbox(source) && !pseudoElement);
	const svg = precomputed?.svg ?? isSvgElement(source);
	const specialLayout =
		precomputed?.specialLayout ?? supportsSpecialLayout(source);
	if (!taskCheckbox && !svg) {
		if (specialLayout) return PORTABLE_SPECIAL_PROPERTIES;
		if (!root) return PORTABLE_ORDINARY_PROPERTIES;
		return pseudoElement
			? PORTABLE_ORDINARY_ROOT_PSEUDO_PROPERTIES
			: PORTABLE_ORDINARY_ROOT_PROPERTIES;
	}
	const isStop = svg && "stop" === source.localName.toLowerCase();
	if (svg && specialLayout && !taskCheckbox) {
		return isStop
			? PORTABLE_SVG_SPECIAL_PROPERTIES
			: PORTABLE_SVG_NON_STOP_SPECIAL_PROPERTIES;
	}
	if (taskCheckbox && !svg && !specialLayout && !root) {
		return PORTABLE_ORDINARY_TASK_CHECKBOX_PROPERTIES;
	}
	const svgProperties = svg
		? isStop
			? SVG_STYLE_PROPERTIES
			: SVG_STYLE_PROPERTIES.filter(
					(property) =>
						"stop-color" !== property && "stop-opacity" !== property,
				)
		: [];
	return uniqueStyleProperties(
		COPY_STYLE_PROPERTIES,
		taskCheckbox ? TASK_LIST_CHECKBOX_STYLE_PROPERTIES : [],
		svgProperties,
		specialLayout
			? SPECIAL_LAYOUT_PROPERTIES
			: root
				? []
				: ORDINARY_LAYOUT_PROPERTIES,
		pseudoElement && root && !specialLayout ? ["width", "height"] : [],
	);
}

export function createStyleDeclarationContext(
	source: Element,
	computed: CSSStyleDeclaration,
	pseudoElement: boolean,
	root: boolean,
	dimensionSemantics?: WechatDimensionSemanticsContext | null,
	pseudoElementName?: "::before" | "::after",
	predicates?: WechatTreePredicateCache,
): PortableStyleDeclarationContext {
	const svg = predicates
		? predicates.isSvgElement(source)
		: isSvgElement(source);
	const specialLayout = predicates
		? predicates.supportsSpecialLayout(source)
		: supportsSpecialLayout(source);
	const pruningCache = createElementStylePruningCache(source, {
		pseudoElement,
		root,
	});
	const taskCheckbox = !pseudoElement && pruningCache.taskListCheckbox;
	const style =
		root && !pseudoElement
			? rootExportComputedStyle(source, computed, dimensionSemantics)
			: computed;
	const semanticComputed =
		!pseudoElement && !specialLayout
			? root
				? style
				: dimensionSemantics?.getComputedStyle(source)
			: null;
	const semanticMarginEligible = Boolean(
		dimensionSemantics &&
			semanticMarginSource(
				source,
				computed,
				pseudoElement ? pseudoElementName : undefined,
				predicates,
			),
	);
	const semanticMarginComputed = semanticMarginEligible
		? pseudoElement
			? (dimensionSemantics?.getComputedStyle(source, pseudoElementName) ??
				null)
			: (semanticComputed ??
				dimensionSemantics?.getComputedStyle(source) ??
				null)
		: null;
	const semanticPaddingEligible = !pseudoElement && semanticMarginEligible;
	const pseudoElementContent = pseudoElement
		? computed.getPropertyValue("content")
		: "";
	const promoteContentBoxBounds = isContentBoxPercentageProjectionCandidate(
		source,
		semanticComputed ?? null,
		dimensionSemantics ?? null,
		pseudoElement,
		root,
		predicates,
	);
	return {
		computed,
		dimensionSemantics: dimensionSemantics ?? null,
		predicates,
		promoteContentBoxBounds,
		pruningCache,
		pseudoElement,
		pseudoElementContent,
		pseudoElementName,
		root,
		semanticComputed: semanticComputed ?? null,
		semanticMarginComputed,
		semanticMarginEligible,
		semanticPaddingEligible,
		source,
		specialLayout,
		style,
		svg,
		taskCheckbox,
	};
}

export function appendPortableStyleDeclaration(
	context: PortableStyleDeclarationContext,
	property: string,
	value: string,
	materializedValue: string,
	declarations: string[],
): void {
	const isOrdinaryDimension =
		!context.pseudoElement &&
		!context.specialLayout &&
		ORDINARY_DIMENSION_PROPERTY_SET.has(property);
	const preserveRawContentBoxTuple =
		context.promoteContentBoxBounds &&
		("box-sizing" === property || isOrdinaryDimension);
	const needsSemanticCandidate =
		"transform-origin" === property ||
		preserveRawContentBoxTuple ||
		isOrdinaryDimension;
	const semanticCandidate =
		needsSemanticCandidate && context.semanticComputed
			? context.semanticComputed.getPropertyValue(property).trim()
			: "";
	const semanticMarginCandidate =
		context.semanticMarginEligible && SEMANTIC_MARGIN_PROPERTY_SET.has(property)
			? semanticMarginValueForEligibleStyle(
					property,
					context.semanticMarginComputed,
				)
			: null;
	const semanticPaddingCandidate =
		context.semanticPaddingEligible &&
		("padding-left" === property || "padding-right" === property)
			? semanticPaddingValueForEligibleStyle(
					property,
					context.source,
					context.semanticMarginComputed,
					context.dimensionSemantics,
				)
			: null;
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
	const pseudoElementContent = context.pseudoElementContent;
	const normalizedValue = preserveRawContentBoxTuple
		? sourceValue
		: portableStyleValue(
				property,
				sourceValue,
				context.source,
				context.style,
				context.pseudoElement,
				pseudoElementContent,
				context.specialLayout,
			);
	if (
		keepStyle(property, normalizedValue, context.source, {
			computed: context.style,
			omitDefaultValues: !preserveRawContentBoxTuple,
			predicates: context.predicates,
			pruningCache: context.pruningCache,
			pseudoElement: context.pseudoElement,
			pseudoElementContent,
			root: context.root,
			sourceValue: value,
			svgElement: context.svg,
		})
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

export function hasFinalizedBackgroundGradient(styleText: string): boolean {
	if (!styleText || !/gradient\s*\(/i.test(styleText)) return false;
	let effectiveValue = "";
	let effectiveImportant = false;
	for (const declaration of splitCssDeclarations(styleText)) {
		if (
			"background" !== declaration.property &&
			"background-image" !== declaration.property
		) {
			continue;
		}
		if (effectiveImportant && !declaration.important) continue;
		effectiveValue = declaration.value;
		effectiveImportant = declaration.important;
	}
	return WECHAT_GRADIENT_FUNCTION.test(effectiveValue);
}

export function markWechatGradientDarkmodeExemptions(root: HTMLElement): void {
	const markIfGradient = (element: Element): void => {
		if (isSvgElement(element)) return;
		const style = element.getAttribute("style") ?? "";
		if (!hasFinalizedBackgroundGradient(style)) return;
		element.setAttribute(
			WECHAT_IGNORE_DARKMODE_ATTRIBUTE,
			WECHAT_DARKMODE_GRADIENT_EXEMPTION,
		);
	};
	markIfGradient(root);
	root.querySelectorAll("[style]").forEach(markIfGradient);
}
