import { isSvgElement, isTaskListCheckbox } from "./wechat-clone-metadata";
import { splitCssDeclarations } from "./wechat-css-list";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { pseudoContent } from "./wechat-pseudo-content";
import {
	CONTENT_BOX_PROMOTED_PROPERTIES,
	CONTENT_BOX_REPLACED_ELEMENTS,
	COPY_STYLE_PROPERTIES,
	DEFAULT_STYLE_VALUES,
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
	fontWithoutZeroLineHeight,
	shouldOmitZeroLineHeight,
} from "./wechat-task-checkbox-style";
import {
	isInsideTable,
	type WechatTreePredicateCache,
} from "./wechat-tree-predicates";

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
	semanticMarginValueForEligibleStyle,
	semanticPaddingSignature,
	semanticPaddingValue,
	semanticTransformOriginSignature,
	signatureStyleProperties,
	transportableTransformOriginSemantics,
} from "./wechat-style-policy-semantics";

const ORDINARY_DIMENSION_PROPERTY_SET: ReadonlySet<string> = new Set(
	ORDINARY_DIMENSION_PROPERTIES,
);
export const SEMANTIC_MARGIN_PROPERTY_SET: ReadonlySet<string> = new Set(
	SEMANTIC_MARGIN_PROPERTIES,
);
const NOOP_BACKGROUND_SHORTHAND_TOKENS: ReadonlySet<string> = new Set([
	"transparent",
	"none",
	"repeat",
	"scroll",
	"0%",
	"0px",
	"0",
	"/",
	"auto",
	"padding-box",
	"border-box",
]);
const DEFAULT_BACKGROUND_POSITION_VALUES: ReadonlySet<string> = new Set([
	"0% 0%",
	"0px 0px",
	"0 0",
]);
const DEFAULT_BACKGROUND_REPEAT_VALUES: ReadonlySet<string> = new Set([
	"repeat",
	"repeat repeat",
]);
const DEFAULT_BACKGROUND_SIZE_VALUES: ReadonlySet<string> = new Set([
	"auto",
	"auto auto",
]);
const BORDER_PRUNE_EXCLUDED_TAGS: ReadonlySet<string> = new Set([
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"colgroup",
	"col",
	"hr",
	"blockquote",
	"input",
	"fieldset",
	"button",
	"textarea",
	"select",
	"iframe",
]);
type BorderSide = "top" | "right" | "bottom" | "left";

/**
 * Per-element memoized cache for computed-style pruning reads across the
 * property loop of a single element snapshot. Construct once per
 * `(source, computed, pseudoElement, root)` context and discard after its
 * declaration loop completes.
 */
export type WechatElementStylePruningCache = {
	readonly borderPruneEligible: boolean;
	borderlessSides?: Partial<Record<BorderSide, boolean>>;
	hasPaintedBackgroundImage?: boolean;
	readonly localName: string;
	nonTableBorderModel?: boolean;
	readonly taskListCheckbox: boolean;
};

const BORDER_EDGE_SIDE_BY_PROPERTY: ReadonlyMap<string, BorderSide> = new Map([
	["border-top-width", "top"],
	["border-top-style", "top"],
	["border-top-color", "top"],
	["border-right-width", "right"],
	["border-right-style", "right"],
	["border-right-color", "right"],
	["border-bottom-width", "bottom"],
	["border-bottom-style", "bottom"],
	["border-bottom-color", "bottom"],
	["border-left-width", "left"],
	["border-left-style", "left"],
	["border-left-color", "left"],
]);
const TABLE_DISPLAY_VALUES: ReadonlySet<string> = new Set([
	"table",
	"inline-table",
	"table-caption",
	"table-cell",
	"table-column",
	"table-column-group",
	"table-footer-group",
	"table-header-group",
	"table-row",
	"table-row-group",
]);
const OVERFLOW_PROPERTIES: ReadonlySet<string> = new Set([
	"overflow",
	"overflow-x",
	"overflow-y",
]);
const TASK_CHECKBOX_PRESERVED_DEFAULT_PROPERTIES: ReadonlySet<string> = new Set(
	["position", "transform"],
);
const SVG_PRESENTATION_ATTRIBUTE_OVERRIDE_PROPERTIES: ReadonlySet<string> =
	new Set([
		"clip-path",
		"filter",
		"marker-end",
		"marker-mid",
		"marker-start",
		"mask",
		"paint-order",
		"transform",
		"vector-effect",
	]);

function isNoopTransparentBackgroundShorthand(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (
		!normalized ||
		normalized.includes("url(") ||
		normalized.includes("gradient(")
	) {
		return false;
	}
	let hasTransparentColor = false;
	const withoutTransparentRgba = normalized
		.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)/g, () => {
			hasTransparentColor = true;
			return " transparent ";
		})
		.replace(/rgba?\(\s*0\s+0\s+0\s*\/\s*0(?:\.0+)?%?\s*\)/g, () => {
			hasTransparentColor = true;
			return " transparent ";
		});
	if (withoutTransparentRgba.includes(",")) return false;
	const tokens = withoutTransparentRgba.trim().split(/\s+/);
	if (!tokens.length) return false;
	for (const token of tokens) {
		if ("transparent" === token) hasTransparentColor = true;
		if (!NOOP_BACKGROUND_SHORTHAND_TOKENS.has(token)) return false;
	}
	return hasTransparentColor;
}

function hasPaintedBackgroundImage(computed: CSSStyleDeclaration): boolean {
	const backgroundImage = computed
		.getPropertyValue("background-image")
		.trim()
		.toLowerCase();
	if (backgroundImage && "none" !== backgroundImage) return true;
	const background = computed
		.getPropertyValue("background")
		.trim()
		.toLowerCase();
	return (
		Boolean(background) &&
		(background.includes("url(") ||
			background.includes("gradient(") ||
			WECHAT_GRADIENT_FUNCTION.test(background))
	);
}

function resolveHasPaintedBackgroundImage(
	computed: CSSStyleDeclaration,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	if (undefined !== pruningCache?.hasPaintedBackgroundImage) {
		return pruningCache.hasPaintedBackgroundImage;
	}
	const painted = hasPaintedBackgroundImage(computed);
	if (pruningCache) pruningCache.hasPaintedBackgroundImage = painted;
	return painted;
}

function isBorderPruneEligible(
	source: Element,
	pseudoElement: boolean,
	root: boolean,
	localName: string,
): boolean {
	if (root || pseudoElement) return false;
	if (BORDER_PRUNE_EXCLUDED_TAGS.has(localName)) return false;
	return !isTaskListCheckbox(source);
}

function shouldOmitDefaultBackgroundProperty(
	property: string,
	value: string,
	computed: CSSStyleDeclaration | undefined,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	if (!property.startsWith("background")) return false;
	if ("background" === property) {
		return isNoopTransparentBackgroundShorthand(value);
	}
	const normalized = value.trim().toLowerCase();
	if ("background-image" === property) {
		return (
			"none" === normalized &&
			(!computed || !resolveHasPaintedBackgroundImage(computed, pruningCache))
		);
	}
	if (!computed) return false;
	if ("background-position" === property) {
		return (
			DEFAULT_BACKGROUND_POSITION_VALUES.has(normalized) &&
			!resolveHasPaintedBackgroundImage(computed, pruningCache)
		);
	}
	if ("background-repeat" === property) {
		return (
			DEFAULT_BACKGROUND_REPEAT_VALUES.has(normalized) &&
			!resolveHasPaintedBackgroundImage(computed, pruningCache)
		);
	}
	if ("background-size" === property) {
		return (
			DEFAULT_BACKGROUND_SIZE_VALUES.has(normalized) &&
			!resolveHasPaintedBackgroundImage(computed, pruningCache)
		);
	}
	return false;
}

function isBorderSideBorderless(
	side: BorderSide,
	computed: CSSStyleDeclaration,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	const cached = pruningCache?.borderlessSides?.[side];
	if (undefined !== cached) return cached;
	const edgeStyle = computed
		.getPropertyValue(`border-${side}-style`)
		.trim()
		.toLowerCase();
	let borderless = false;
	if ("none" === edgeStyle) {
		const edgeWidth = computed
			.getPropertyValue(`border-${side}-width`)
			.trim()
			.toLowerCase();
		borderless = "0px" === edgeWidth || "0" === edgeWidth;
	}
	if (pruningCache) {
		if (!pruningCache.borderlessSides) pruningCache.borderlessSides = {};
		pruningCache.borderlessSides[side] = borderless;
	}
	return borderless;
}

function shouldOmitBorderlessProperty(
	property: string,
	value: string,
	source: Element,
	pseudoElement: boolean,
	root: boolean,
	localName: string,
	computed: CSSStyleDeclaration | undefined,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	if ("border-radius" === property) {
		if ("0px" !== value && "0" !== value) return false;
		return pruningCache
			? pruningCache.borderPruneEligible
			: isBorderPruneEligible(source, pseudoElement, root, localName);
	}
	if (!computed || !property.startsWith("border-")) return false;
	const side = BORDER_EDGE_SIDE_BY_PROPERTY.get(property);
	if (!side) return false;
	const eligible = pruningCache
		? pruningCache.borderPruneEligible
		: isBorderPruneEligible(source, pseudoElement, root, localName);
	if (!eligible) return false;
	return isBorderSideBorderless(side, computed, pruningCache);
}

function shouldOmitNonTableBorderModel(
	property: string,
	value: string,
	source: Element,
	isSvg: boolean,
	computed: CSSStyleDeclaration | undefined,
	predicates: WechatTreePredicateCache | undefined,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	const isDefaultBorderModel =
		("border-collapse" === property &&
			"separate" === value.trim().toLowerCase()) ||
		("border-spacing" === property &&
			("0px" === value || "0px 0px" === value || "0" === value));
	if (!isDefaultBorderModel) return false;
	if (isSvg) return true;
	if (undefined !== pruningCache?.nonTableBorderModel) {
		return pruningCache.nonTableBorderModel;
	}
	const display = computed
		? computed.getPropertyValue("display").trim().toLowerCase()
		: "";
	let nonTable = !TABLE_DISPLAY_VALUES.has(display);
	if (nonTable) {
		const insideTable = predicates
			? predicates.isInsideTable(source)
			: isInsideTable(source);
		nonTable = !insideTable;
	}
	if (pruningCache) pruningCache.nonTableBorderModel = nonTable;
	return nonTable;
}

function preservesSvgPresentationAttributeOverride(
	property: string,
	source: Element,
	isSvg: boolean,
): boolean {
	if (!isSvg || !SVG_PRESENTATION_ATTRIBUTE_OVERRIDE_PROPERTIES.has(property)) {
		return false;
	}
	if (source.hasAttribute(property)) return true;
	return property.startsWith("marker-") && source.hasAttribute("marker");
}

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

export function keepStyle(
	property: string,
	value: string,
	source: Element,
	pseudoElement = false,
	root = false,
	sourceValue = value,
	omitDefaultValues = true,
	pseudoElementContent = "",
	svgElement?: boolean,
	computed?: CSSStyleDeclaration,
	predicates?: WechatTreePredicateCache,
	pruningCache?: WechatElementStylePruningCache,
): boolean {
	if (
		omitDefaultValues &&
		shouldOmitZeroLineHeight(
			source,
			property,
			value,
			pseudoElement,
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
	const isSvg = svgElement ?? isSvgElement(source);
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
	if (omitDefaultValues && !preservesInheritedDefault) {
		const localName = pruningCache
			? pruningCache.localName
			: source.localName.toLowerCase();
		if (
			("stop-color" === property || "stop-opacity" === property) &&
			"stop" !== localName
		) {
			return false;
		}
		if (
			property.startsWith("background") &&
			!(pruningCache
				? pruningCache.taskListCheckbox
				: isTaskListCheckbox(source)) &&
			shouldOmitDefaultBackgroundProperty(
				property,
				value,
				computed,
				pruningCache,
			)
		) {
			return false;
		}
		if (
			shouldOmitBorderlessProperty(
				property,
				value,
				source,
				pseudoElement,
				root,
				localName,
				computed,
				pruningCache,
			)
		) {
			return false;
		}
		if (
			shouldOmitNonTableBorderModel(
				property,
				value,
				source,
				isSvg,
				computed,
				predicates,
				pruningCache,
			)
		) {
			return false;
		}
		if (
			DEFAULT_STYLE_VALUES[property]?.has(value) &&
			!(
				OVERFLOW_PROPERTIES.has(property) &&
				(isSvg || CONTENT_BOX_REPLACED_ELEMENTS.has(localName))
			) &&
			!(
				TASK_CHECKBOX_PRESERVED_DEFAULT_PROPERTIES.has(property) &&
				(pruningCache
					? pruningCache.taskListCheckbox
					: isTaskListCheckbox(source))
			) &&
			!preservesSvgPresentationAttributeOverride(property, source, isSvg)
		) {
			return false;
		}
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
	const localName = source.localName.toLowerCase();
	const taskListCheckbox = isTaskListCheckbox(source);
	const taskCheckbox = !pseudoElement && taskListCheckbox;
	const pruningCache: WechatElementStylePruningCache = {
		borderPruneEligible:
			!root &&
			!pseudoElement &&
			!taskListCheckbox &&
			!BORDER_PRUNE_EXCLUDED_TAGS.has(localName),
		localName,
		taskListCheckbox,
	};
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
		keepStyle(
			property,
			normalizedValue,
			context.source,
			context.pseudoElement,
			context.root,
			value,
			!preserveRawContentBoxTuple,
			pseudoElementContent,
			context.svg,
			context.style,
			context.predicates,
			context.pruningCache,
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
