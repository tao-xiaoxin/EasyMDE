import {
	CODE_FRAME_HEADER_CLONES,
	CODE_FRAME_PSEUDO_CLONES,
	hasVisualRasterizationAncestor,
	isKaTeXVisualNode,
	isSvgElement,
	isTaskListCheckbox,
	THEME_HEADING_SUFFIX_CLONES,
	THEME_IMAGE_CLONES,
	visualRasterizationKind,
	WECHAT_PNG_GENERATED_IMAGES,
	WECHAT_PNG_VISUAL_CLONES,
} from "./wechat-clone-metadata";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { pseudoContent } from "./wechat-pseudo-content";
import {
	taskCheckboxFontWithoutZeroLineHeight,
	taskCheckboxLineHeightIsZero,
} from "./wechat-task-checkbox-style";

export const COPY_STYLE_PROPERTIES = [
	"display",
	"flex-direction",
	"flex-wrap",
	"flex-flow",
	"justify-content",
	"align-items",
	"align-content",
	"align-self",
	"order",
	"flex",
	"flex-grow",
	"flex-shrink",
	"flex-basis",
	"gap",
	"column-gap",
	"row-gap",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-radius",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"border-left-style",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"border-collapse",
	"border-spacing",
	"border-radius",
	"background",
	"background-color",
	"background-image",
	"background-position",
	"background-repeat",
	"background-size",
	"container-type",
	"color",
	"font",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"line-height",
	"letter-spacing",
	"word-spacing",
	"font-variant",
	"font-stretch",
	"text-align",
	"text-decoration",
	"text-transform",
	"text-indent",
	"text-shadow",
	"white-space",
	"word-break",
	"overflow-wrap",
	"vertical-align",
	"list-style-type",
	"list-style-position",
	"box-shadow",
	"opacity",
	"tab-size",
] as const;

export const SVG_STYLE_PROPERTIES = [
	"fill",
	"fill-opacity",
	"fill-rule",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"stroke-opacity",
	"stroke-dasharray",
	"stroke-dashoffset",
	"marker-start",
	"marker-mid",
	"marker-end",
	"visibility",
	"transform-box",
	"clip-path",
	"clip-rule",
	"mask",
	"filter",
	"paint-order",
	"vector-effect",
	"shape-rendering",
	"mix-blend-mode",
	"text-rendering",
	"stop-color",
	"stop-opacity",
	"dominant-baseline",
	"text-anchor",
] as const;

export const SPECIAL_LAYOUT_PROPERTIES = [
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
	"overflow",
	"overflow-x",
	"overflow-y",
	"box-sizing",
	"transform",
	"transform-origin",
	"z-index",
] as const;

export const ORDINARY_LAYOUT_PROPERTIES = [
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
	"overflow",
	"overflow-x",
	"overflow-y",
	"box-sizing",
	"float",
	"clear",
	"transform",
	"transform-origin",
	"z-index",
] as const;

export const ORDINARY_DIMENSION_PROPERTIES = [
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
] as const;

export const SEMANTIC_MARGIN_PROPERTIES = [
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
] as const;
const SEMANTIC_PADDING_PROPERTIES = ["padding-left", "padding-right"] as const;
const PORTABLE_PADDING_TOKENS: Readonly<
	Record<(typeof SEMANTIC_PADDING_PROPERTIES)[number], string>
> = {
	"padding-left": "--easymde-portable-padding-left",
	"padding-right": "--easymde-portable-padding-right",
};
const PORTABLE_PADDING_PERCENTAGE = /^(?:0|(?:\d+(?:\.\d*)?|\.\d+))%$/u;
const PORTABLE_PADDING_CASCADE_PROPERTIES = new Set([
	"padding",
	"padding-left",
	"padding-right",
	"padding-inline",
	"padding-inline-start",
	"padding-inline-end",
]);

type PortablePaddingTransportDecision = Readonly<{
	signature: string;
	value: string | null;
}>;

function selectorSpecificity(
	selector: string,
): readonly [number, number, number] {
	const withoutStrings = selector.replace(/(["']).*?\1/gu, "");

	let ids = 0;
	let classes = 0;
	let elements = 0;

	// Extract functional pseudo-classes that take selector lists:
	// :not(), :is(), :has(), :where()
	// According to CSS Selectors Level 4, :not(), :is(), :has() take the specificity of their
	// most specific argument without adding any pseudo-class specificity.
	// :where() adds no specificity at all.
	let parsed = "";
	let index = 0;
	while (index < withoutStrings.length) {
		if (withoutStrings[index] === ":") {
			const match = withoutStrings
				.slice(index)
				.match(/^:(not|is|has|where)\(/iu);
			if (match) {
				const fnName = match[1]?.toLowerCase();
				let depth = 1;
				let argIndex = index + match[0].length;
				const argStart = argIndex;
				while (argIndex < withoutStrings.length && depth > 0) {
					if (withoutStrings[argIndex] === "(") depth += 1;
					else if (withoutStrings[argIndex] === ")") depth -= 1;
					argIndex += 1;
				}
				const arg = withoutStrings.slice(argStart, argIndex - 1);
				if (fnName && fnName !== "where") {
					const subSelectors: string[] = [];
					let subStart = 0;
					let subDepth = 0;
					for (let k = 0; k < arg.length; k += 1) {
						if (arg[k] === "(") subDepth += 1;
						else if (arg[k] === ")") subDepth -= 1;
						else if (arg[k] === "," && subDepth === 0) {
							subSelectors.push(arg.slice(subStart, k).trim());
							subStart = k + 1;
						}
					}
					subSelectors.push(arg.slice(subStart).trim());
					let maxArgSpecificity: readonly [number, number, number] = [0, 0, 0];
					for (const sub of subSelectors) {
						if (!sub) continue;
						const subSpec = selectorSpecificity(sub);
						if (compareSpecificity(subSpec, maxArgSpecificity) > 0) {
							maxArgSpecificity = subSpec;
						}
					}
					ids += maxArgSpecificity[0];
					classes += maxArgSpecificity[1];
					elements += maxArgSpecificity[2];
				}
				parsed += " ";
				index = argIndex;
				continue;
			}
		}
		parsed += withoutStrings[index];
		index += 1;
	}

	ids += (parsed.match(/#[a-zA-Z_][\w-]*/gu) ?? []).length;
	classes +=
		(parsed.match(/\.[a-zA-Z_][\w-]*/gu) ?? []).length +
		(parsed.match(/\[[^\]]*\]/gu) ?? []).length +
		(parsed.match(/:(?!:)[a-zA-Z_-][\w-]*/gu) ?? []).length;
	const pseudoElements = (parsed.match(/::[a-zA-Z_-][\w-]*/gu) ?? []).length;
	const withoutSelectors = parsed
		.replace(/#[a-zA-Z_][\w-]*/gu, " ")
		.replace(/\.[a-zA-Z_][\w-]*/gu, " ")
		.replace(/\[[^\]]*\]/gu, " ")
		.replace(/::?[a-zA-Z_-][\w-]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?/gu, " ")
		.replace(/[>+~*]/gu, " ");
	elements +=
		(withoutSelectors.match(/(?:^|[\s])([a-zA-Z][\w-]*)/gu) ?? []).length +
		pseudoElements;

	return [ids, classes, elements];
}

function splitSelectorList(selectorList: string): string[] | null {
	const selectors: string[] = [];
	let start = 0;
	let depth = 0;
	let quote: "\"" | "'" | null = null;
	let escaped = false;

	for (let index = 0; index < selectorList.length; index += 1) {
		const char = selectorList[index];

		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char as "\"" | "'";
			continue;
		}
		if (char === "(" || char === "[") {
			depth += 1;
			continue;
		}
		if (char === ")" || char === "]") {
			if (depth === 0) return null;
			depth -= 1;
			continue;
		}
		if (char === "," && depth === 0) {
			const candidate = selectorList.slice(start, index).trim();
			if (!candidate) return null;
			selectors.push(candidate);
			start = index + 1;
		}
	}
	if (escaped || quote || depth !== 0) return null;
	const finalSelector = selectorList.slice(start).trim();
	if (!finalSelector) return null;
	selectors.push(finalSelector);
	return selectors;
}

function compareSpecificity(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	for (let index = 0; index < left.length; index += 1) {
		const delta = (left[index] ?? 0) - (right[index] ?? 0);
		if (delta) return delta;
	}
	return 0;
}

function styleAffectsPadding(
	style: CSSStyleDeclaration,
	property: string,
): boolean {
	if (style.getPropertyValue(property)?.trim()) return true;
	return Array.from(PORTABLE_PADDING_CASCADE_PROPERTIES).some((candidate) => {
		return (
			relevantPaddingRuleProperty(candidate) &&
			Boolean(style.getPropertyValue(candidate)?.trim()) &&
			("padding" === candidate ||
				candidate === property ||
				candidate.startsWith("padding-inline"))
		);
	});
}

function subtreeAffectsPadding(
	rules: CSSRuleList,
	property: string,
): boolean {
	try {
		for (const rule of Array.from(rules)) {
			if (
				"style" in rule &&
				rule.style &&
				typeof (rule.style as CSSStyleDeclaration).getPropertyValue === "function"
			) {
				if (styleAffectsPadding(rule.style as CSSStyleDeclaration, property)) {
					return true;
				}
			}
			if ("cssRules" in rule && (rule as { cssRules?: CSSRuleList }).cssRules) {
				const childRules = (rule as { cssRules: CSSRuleList }).cssRules;
				if (childRules.length > 0 && subtreeAffectsPadding(childRules, property)) {
					return true;
				}
			}
		}
	} catch {
		return true;
	}
	return false;
}

function relevantPaddingRuleProperty(property: string): boolean {
	return PORTABLE_PADDING_CASCADE_PROPERTIES.has(property);
}

function portablePaddingTransportDecision(
	source: Element,
	property: (typeof SEMANTIC_PADDING_PROPERTIES)[number],
	semanticStyle: CSSStyleDeclaration | null,
	token: string,
): PortablePaddingTransportDecision {
	const effective = semanticStyle?.getPropertyValue(property).trim() ?? "";
	const nestedQuote = source.matches("blockquote blockquote");
	if (!token || "initial" === token) {
		return {
			signature: nestedQuote ? `state=none;effective=${effective}` : "",
			value: null,
		};
	}
	if (!PORTABLE_PADDING_PERCENTAGE.test(token)) {
		throw new Error(`wechat-invalid-portable-padding-${property}`);
	}

	const document = source.ownerDocument;
	const inlineStyle =
		source instanceof HTMLElement || source instanceof SVGElement
			? source.style
			: null;
	const inlineOverride = inlineStyle
		? Array.from(PORTABLE_PADDING_CASCADE_PROPERTIES).some((candidate) => {
				return Boolean(inlineStyle.getPropertyValue(candidate).trim());
			})
		: false;
	if (inlineOverride) {
		return {
			signature: `state=effective;reason=inline;token=${token};effective=${effective}`,
			value: null,
		};
	}

	const tokenName = PORTABLE_PADDING_TOKENS[property];
	const baseCandidates: Array<
		Readonly<{ order: number; specificity: readonly [number, number, number] }>
	> = [];
	const competitors: Array<
		Readonly<{
			important: boolean;
			inLayer: boolean;
			order: number;
			specificity: readonly [number, number, number];
		}>
	> = [];
	let order = 0;
	let unreadableStyleSheet = false;
	const walk = (rules: CSSRuleList, active: boolean, inLayer = false): void => {
		for (const rule of Array.from(rules)) {
			const currentOrder = order;
			order += 1;
			if (!active) continue;
			const defaultView = document.defaultView;
			if (
				(defaultView?.CSSMediaRule && rule instanceof defaultView.CSSMediaRule) ||
				rule instanceof CSSMediaRule
			) {
				const matches =
					defaultView?.matchMedia(rule.conditionText).matches ?? true;
				walk(rule.cssRules, matches, inLayer);
				continue;
			}
			if (
				(defaultView?.CSSSupportsRule &&
					rule instanceof defaultView.CSSSupportsRule) ||
				rule instanceof CSSSupportsRule
			) {
				const supports =
					defaultView?.CSS?.supports(rule.conditionText) ?? true;
				walk(rule.cssRules, supports, inLayer);
				continue;
			}
			const isLayerRule =
				(defaultView?.CSSLayerBlockRule &&
					rule instanceof defaultView.CSSLayerBlockRule) ||
				("name" in rule && "cssRules" in rule && !("conditionText" in rule));
			if (isLayerRule) {
				walk((rule as CSSGroupingRule).cssRules, active, true);
				continue;
			}
			const isConditionalGroupRule =
				(defaultView?.CSSConditionRule &&
					rule instanceof defaultView.CSSConditionRule) ||
				"conditionText" in rule;
			if (isConditionalGroupRule && "cssRules" in rule) {
				unreadableStyleSheet = true;
				continue;
			}
			const isImportRule =
				(defaultView?.CSSImportRule &&
					rule instanceof defaultView.CSSImportRule) ||
				("styleSheet" in rule && "href" in rule);
			if (isImportRule) {
				try {
					const importRule = rule as CSSImportRule & {
						layerName?: string | null;
						supportsText?: string | null;
					};
					const importedSheet = importRule.styleSheet;
					if (!importedSheet || (importRule.href && importedSheet.cssRules.length === 0)) {
						unreadableStyleSheet = true;
						continue;
					}
					const isLayeredImport = typeof importRule.layerName === "string";
					const supportsText = importRule.supportsText?.trim() ?? "";
					if (supportsText) {
						unreadableStyleSheet = true;
						continue;
					}
					let importMatches = true;
					if (importRule.media?.mediaText) {
						importMatches =
							defaultView?.matchMedia(importRule.media.mediaText).matches ??
							true;
					}
					if (importMatches) {
						walk(importedSheet.cssRules, active, inLayer || isLayeredImport);
					}
				} catch {
					unreadableStyleSheet = true;
				}
				continue;
			}
			if (!(rule instanceof CSSStyleRule)) {
				if ("cssRules" in rule && (rule as { cssRules?: unknown }).cssRules) {
					unreadableStyleSheet = true;
				}
				if (
					"style" in rule &&
					rule.style &&
					typeof (rule.style as CSSStyleDeclaration).getPropertyValue === "function" &&
					styleAffectsPadding(rule.style as CSSStyleDeclaration, property)
				) {
					unreadableStyleSheet = true;
				}
				continue;
			}
			const selectors = splitSelectorList(rule.selectorText);
			if (!selectors) {
				unreadableStyleSheet = true;
				continue;
			}
			let matchingSelector: string | undefined;
			let selectorListReadable = true;
			for (const candidate of selectors) {
				try {
					if (!source.matches(candidate)) continue;
					if (
						!matchingSelector ||
						compareSpecificity(
							selectorSpecificity(candidate),
							selectorSpecificity(matchingSelector),
						) > 0
					) {
						matchingSelector = candidate;
					}
				} catch {
					selectorListReadable = false;
					break;
				}
			}
			if (!selectorListReadable) {
				unreadableStyleSheet = true;
				continue;
			}
			if (rule.cssRules && rule.cssRules.length > 0) {
				if (subtreeAffectsPadding(rule.cssRules, property)) {
					unreadableStyleSheet = true;
				}
			}

			if (!matchingSelector) continue;
			const specificity = selectorSpecificity(matchingSelector);
			const value = rule.style.getPropertyValue(property).trim();
			const affectsSide = styleAffectsPadding(rule.style, property);
			if (!affectsSide) continue;
			if (inLayer && value.includes(`var(${tokenName})`)) {
				unreadableStyleSheet = true;
				continue;
			}
			const isPortable = !inLayer && value.includes(`var(${tokenName})`);
			if (isPortable) {
				baseCandidates.push({ order: currentOrder, specificity });
			} else {
				const isImportant =
					Boolean(rule.style.getPropertyPriority(property)) ||
					Array.from(PORTABLE_PADDING_CASCADE_PROPERTIES).some((candidate) =>
						Boolean(rule.style.getPropertyPriority(candidate)),
					);
				competitors.push({
					important: isImportant,
					inLayer,
					order: currentOrder,
					specificity,
				});
			}
		}
	};
	for (const styleSheet of Array.from(document.styleSheets)) {
		try {
			walk(styleSheet.cssRules, true);
		} catch {
			unreadableStyleSheet = true;
		}
	}
	if (unreadableStyleSheet || !baseCandidates.length) {
		return {
			signature: `state=effective;reason=${unreadableStyleSheet ? "stylesheet-unreadable" : "portable-rule-missing"};token=${token};effective=${effective}`,
			value: null,
		};
	}
	const base = [...baseCandidates].sort((left, right) => {
		const specificityOrder = compareSpecificity(
			right.specificity,
			left.specificity,
		);
		return specificityOrder || right.order - left.order;
	})[0];
	const outranked = competitors.some((candidate) => {
		if (candidate.important) return true;
		if (candidate.inLayer) return false;
		const specificityOrder = compareSpecificity(
			candidate.specificity,
			base?.specificity ?? [0, 0, 0],
		);
		return (
			specificityOrder > 0 ||
			(specificityOrder === 0 && candidate.order > (base?.order ?? -1))
		);
	});
	if (outranked) {
		return {
			signature: `state=effective;reason=override;token=${token};effective=${effective}`,
			value: null,
		};
	}
	return {
		signature: `state=token;token=${token};effective=${effective}`,
		value: token,
	};
}

export const NATIVE_LAYOUT_PROPERTIES = ["table-layout"] as const;

export const SAFE_DISPLAY_VALUES: Record<string, true> = {
	block: true,
	inline: true,
	"inline-block": true,
	"inline-table": true,
	"inline-flex": true,
	"flow-root": true,
	flex: true,
	"list-item": true,
	table: true,
	contents: true,
	"table-caption": true,
	"table-cell": true,
	"table-column": true,
	"table-column-group": true,
	"table-footer-group": true,
	"table-header-group": true,
	"table-row": true,
	"table-row-group": true,
};

export const TRANSIENT_ATTRIBUTE =
	/^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;

export const UNSAFE_STYLE_VALUE =
	/(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;

export const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;

export const URL_ATTRIBUTES = new Set([
	"action",
	"formaction",
	"href",
	"poster",
	"src",
	"xlink:href",
]);

export const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
	"align-content": new Set(["normal", "stretch"]),
	"align-items": new Set(["normal", "stretch"]),
	"align-self": new Set(["auto"]),
	"box-shadow": new Set(["none"]),
	"column-gap": new Set(["normal", "0px"]),
	"container-type": new Set(["normal"]),
	display: new Set(),
	"flex-basis": new Set(["auto"]),
	"flex-direction": new Set(["row"]),
	"flex-flow": new Set(["row nowrap"]),
	"flex-wrap": new Set(["nowrap"]),
	"flex-grow": new Set(["0"]),
	"flex-shrink": new Set(["1"]),
	"font-stretch": new Set(["100%"]),
	"font-variant": new Set(["normal"]),
	gap: new Set(["normal", "0px"]),
	"justify-content": new Set(["normal", "flex-start"]),
	"list-style-position": new Set(["outside"]),
	opacity: new Set(["1"]),
	order: new Set(["0"]),
	"row-gap": new Set(["normal", "0px"]),
	"tab-size": new Set(["8"]),
	"text-indent": new Set(["0px"]),
	"text-shadow": new Set(["none"]),
	"text-transform": new Set(["none"]),
	"vertical-align": new Set(["baseline"]),
	"white-space": new Set(["normal"]),
};

export const PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES = new Set([
	"font-style",
	"font-variant",
	"font-stretch",
	"letter-spacing",
	"text-transform",
	"white-space",
	"text-indent",
	"text-shadow",
	"tab-size",
	"list-style-position",
]);

export const PREPARED_PSEUDO_ELEMENTS = ["::before", "::after"] as const;

export function uniqueStyleProperties(
	...groups: ReadonlyArray<ReadonlyArray<string>>
): string[] {
	return [...new Set(groups.flat())];
}

export const ROOT_EXPORT_STYLE_PROPERTIES = new Set(
	uniqueStyleProperties(
		COPY_STYLE_PROPERTIES,
		ORDINARY_LAYOUT_PROPERTIES,
		SPECIAL_LAYOUT_PROPERTIES,
		SVG_STYLE_PROPERTIES,
		[
			"content",
			"direction",
			"box-sizing",
			"visibility",
			"content-visibility",
			"width",
			"height",
		],
	),
);

export function finitePixelValue(value: string): number | null {
	const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
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

export const CONTENT_BOX_DIMENSION_PROPERTIES = [
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
] as const;
export const CONTENT_BOX_PERCENTAGE_TOKEN =
	/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?%$/;
export const CONTENT_BOX_PIXEL_TOKEN =
	/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?px$/i;
export const CONTENT_BOX_DIMENSION_KEYWORDS: Readonly<
	Record<(typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number], ReadonlySet<string>>
> = {
	width: new Set(["auto"]),
	"min-width": new Set(["auto"]),
	"max-width": new Set(["none"]),
	height: new Set(["auto"]),
	"min-height": new Set(["auto"]),
	"max-height": new Set(["none"]),
};
export const CONTENT_BOX_REPLACED_ELEMENTS = new Set([
	"audio",
	"canvas",
	"embed",
	"iframe",
	"img",
	"input",
	"object",
	"picture",
	"select",
	"source",
	"textarea",
	"track",
	"video",
]);
export const CONTENT_BOX_PROMOTED_PROPERTIES = new Set([
	"box-sizing",
	"max-width",
]);
export const CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS = new Set([
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
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

export function semanticMarginSource(
	source: Element,
	computed: CSSStyleDeclaration,
	pseudoElement?: "::before" | "::after",
): boolean {
	const specialNode = source.matches(
		"math, .katex, .easymde-math-block, .easymde-math-inline",
	);
	if (pseudoElement) {
		return (
			!isSvgElement(source) &&
			!specialNode &&
			!hasSpecialLayoutAncestor(source) &&
			["static", "relative"].includes(
				computed.getPropertyValue("position").trim().toLowerCase(),
			)
		);
	}
	if ("svg" === source.localName.toLowerCase()) {
		return !hasSpecialLayoutAncestor(source);
	}
	return (
		!isSvgElement(source) && !specialNode && !hasSpecialLayoutAncestor(source)
	);
}

export function semanticMarginValue(
	property: string,
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	pseudoElement?: "::before" | "::after",
	semanticComputed?: CSSStyleDeclaration | null,
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
		!semanticMarginSource(source, computed, pseudoElement)
	)
		return null;
	const semanticStyle =
		undefined !== semanticComputed
			? semanticComputed
			: dimensionSemantics.getComputedStyle(source, pseudoElement);
	const semantic = semanticStyle?.getPropertyValue(property).trim();
	if ("auto" === semantic) return semantic;
	if (!semantic) return null;
	const percentage = CSS_PERCENTAGE_TOKEN.exec(semantic);
	if (!percentage || !Number.isFinite(Number(percentage[0].slice(0, -1))))
		return null;
	return semantic;
}

export function semanticMarginSignature(
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	pseudoElement?: "::before" | "::after",
	semanticComputed?: CSSStyleDeclaration | null,
): string {
	if (
		!dimensionSemantics ||
		!semanticMarginSource(source, computed, pseudoElement)
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

function semanticPaddingTransportDecision(
	property: string,
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	semanticComputed?: CSSStyleDeclaration | null,
): PortablePaddingTransportDecision {
	if (
		!SEMANTIC_PADDING_PROPERTIES.includes(
			property as (typeof SEMANTIC_PADDING_PROPERTIES)[number],
		)
	) {
		return { signature: "", value: null };
	}
	if (!dimensionSemantics || !semanticMarginSource(source, computed))
		return { signature: "", value: null };
	const semanticStyle =
		semanticComputed ?? dimensionSemantics.getComputedStyle(source);
	const tokenName =
		PORTABLE_PADDING_TOKENS[
			property as (typeof SEMANTIC_PADDING_PROPERTIES)[number]
		];
	const token = semanticStyle?.getPropertyValue(tokenName).trim() ?? "";
	return portablePaddingTransportDecision(
		source,
		property as (typeof SEMANTIC_PADDING_PROPERTIES)[number],
		semanticStyle,
		token,
	);
}

export function semanticPaddingValue(
	property: string,
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	semanticComputed?: CSSStyleDeclaration | null,
): string | null {
	return semanticPaddingTransportDecision(
		property,
		source,
		computed,
		dimensionSemantics,
		semanticComputed,
	).value;
}

export function semanticPaddingSignature(
	source: Element,
	computed: CSSStyleDeclaration,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	semanticComputed?: CSSStyleDeclaration | null,
): string {
	if (!dimensionSemantics || !semanticMarginSource(source, computed)) return "";
	const values = SEMANTIC_PADDING_PROPERTIES.map((property) => {
		const decision = semanticPaddingTransportDecision(
			property,
			source,
			computed,
			dimensionSemantics,
			semanticComputed,
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
): readonly string[] {
	const svg = isSvgElement(source);
	const special = supportsSpecialLayout(source);
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
): string {
	if (!rawComputed || supportsSpecialLayout(source) || isSvgElement(source))
		return "";
	const semantic = transportableTransformOriginSemantics(
		rawComputed.getPropertyValue("transform-origin"),
	);
	return semantic ? `transform-origin=${semantic}` : "";
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

export const CSS_PERCENTAGE_TOKEN =
	/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%$/;

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

export function supportsSpecialLayout(source: Element): boolean {
	return Boolean(
		source.closest(
			"svg, math, .katex, .easymde-math-block, .easymde-math-inline",
		),
	);
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

export const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

export const SAFE_DATA_IMAGE =
	/^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i;

export const MAX_DATA_IMAGE_LENGTH = 4_000_000;

export function hasOnlySafeDataImageUrls(value: string): boolean {
	const matches = [...value.matchAll(CSS_URL)];
	return (
		matches.length > 0 &&
		matches.every((match) =>
			SAFE_DATA_IMAGE.test((match[1] ?? match[2] ?? match[3] ?? "").trim()),
		)
	);
}

export const WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE =
	"data-easymde-wechat-export-style-context";

export const SIGNATURE_ORDINARY_ROOT_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	["direction", "position"],
);
export const SIGNATURE_ORDINARY_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
	["direction"],
);
export const SIGNATURE_SPECIAL_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	["direction"],
);
export const SIGNATURE_SVG_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	SVG_STYLE_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	["direction"],
);
export const SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_ORDINARY_ROOT_PROPERTIES,
	["content", "width", "height", "box-sizing"],
);
export const SIGNATURE_ORDINARY_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_ORDINARY_PROPERTIES,
	["content", "width", "height"],
);
export const SIGNATURE_SPECIAL_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_SPECIAL_PROPERTIES,
	["content", "width", "height"],
);
export const SIGNATURE_SVG_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_SVG_PROPERTIES,
	["content", "width", "height"],
);

export const TASK_LIST_CHECKBOX_STYLE_PROPERTIES = [
	"appearance",
	"-webkit-appearance",
	"-moz-appearance",
	"-ms-appearance",
	"accent-color",
] as const;
