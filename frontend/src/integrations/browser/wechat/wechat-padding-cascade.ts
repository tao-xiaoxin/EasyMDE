import { splitSelectorList } from "../../../shared/css/selector-list";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";

export const SEMANTIC_PADDING_PROPERTIES = [
	"padding-left",
	"padding-right",
] as const;

export type SemanticPaddingProperty =
	(typeof SEMANTIC_PADDING_PROPERTIES)[number];

export type PortablePaddingTransportDecision = Readonly<{
	signature: string;
	value: string | null;
}>;

export type CompiledPaddingSelector = Readonly<{
	selector: string;
	specificity: readonly [number, number, number];
}>;

export type PaddingCascadeRuleEntry = Readonly<{
	important: boolean;
	inLayer: boolean;
	isPortable: boolean;
	layeredPortable: boolean;
	order: number;
	selectors: readonly CompiledPaddingSelector[];
}>;

export type PaddingCascadeIndex = Readonly<{
	entries: readonly PaddingCascadeRuleEntry[];
	unreadableStyleSheet: boolean;
}>;

const PORTABLE_PADDING_TOKENS: Readonly<
	Record<SemanticPaddingProperty, string>
> = {
	"padding-left": "--easymde-portable-padding-left",
	"padding-right": "--easymde-portable-padding-right",
};

const PORTABLE_PADDING_PERCENTAGE = /^(?:0|(?:\d+(?:\.\d*)?|\.\d+))%$/u;

const PORTABLE_PADDING_CASCADE_PROPERTY_LIST = [
	"padding",
	"padding-left",
	"padding-right",
	"padding-inline",
	"padding-inline-start",
	"padding-inline-end",
] as const;

const PADDING_AFFECTING_PROPERTIES: Readonly<
	Record<SemanticPaddingProperty, readonly string[]>
> = {
	"padding-left": [
		"padding-left",
		"padding",
		"padding-inline",
		"padding-inline-start",
		"padding-inline-end",
	],
	"padding-right": [
		"padding-right",
		"padding",
		"padding-inline",
		"padding-inline-start",
		"padding-inline-end",
	],
};

type PaddingCascadeContextCache = {
	byProperty: Map<SemanticPaddingProperty, PaddingCascadeIndex>;
	document: Document;
	generation: number;
	sheets: readonly CSSStyleSheet[];
	viewportHeight: number;
	viewportWidth: number;
};

const PADDING_CASCADE_CACHE = new WeakMap<
	WechatDimensionSemanticsContext,
	PaddingCascadeContextCache
>();

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
	property: SemanticPaddingProperty,
): boolean {
	for (const candidate of PADDING_AFFECTING_PROPERTIES[property]) {
		if (style.getPropertyValue(candidate)?.trim()) return true;
	}
	return false;
}

function styleHasImportantPadding(
	style: CSSStyleDeclaration,
	property: SemanticPaddingProperty,
): boolean {
	if (style.getPropertyPriority(property)) return true;
	for (const candidate of PORTABLE_PADDING_CASCADE_PROPERTY_LIST) {
		if (style.getPropertyPriority(candidate)) return true;
	}
	return false;
}

function subtreeAffectsPadding(
	rules: CSSRuleList,
	property: SemanticPaddingProperty,
): boolean {
	try {
		for (const rule of Array.from(rules)) {
			if (
				"style" in rule &&
				rule.style &&
				typeof (rule.style as CSSStyleDeclaration).getPropertyValue ===
					"function"
			) {
				if (styleAffectsPadding(rule.style as CSSStyleDeclaration, property)) {
					return true;
				}
			}
			if (
				"cssRules" in rule &&
				(rule as { cssRules?: CSSRuleList }).cssRules
			) {
				const childRules = (rule as { cssRules: CSSRuleList }).cssRules;
				if (
					childRules.length > 0 &&
					subtreeAffectsPadding(childRules, property)
				) {
					return true;
				}
			}
		}
	} catch {
		return true;
	}
	return false;
}

function isNestedBlockquoteElement(source: Element): boolean {
	if ("blockquote" !== source.localName.toLowerCase()) return false;
	let ancestor = source.parentElement;
	while (ancestor) {
		if ("blockquote" === ancestor.localName.toLowerCase()) return true;
		ancestor = ancestor.parentElement;
	}
	return false;
}

function styleSheetListMatches(
	cachedSheets: readonly CSSStyleSheet[],
	currentSheets: StyleSheetList,
): boolean {
	if (cachedSheets.length !== currentSheets.length) return false;
	for (let index = 0; index < cachedSheets.length; index += 1) {
		if (cachedSheets[index] !== currentSheets[index]) return false;
	}
	return true;
}

export function buildPaddingCascadeIndex(
	document: Document,
	property: SemanticPaddingProperty,
): PaddingCascadeIndex {
	const tokenName = PORTABLE_PADDING_TOKENS[property];
	const tokenPattern = `var(${tokenName})`;
	const defaultView = document.defaultView;
	const entries: PaddingCascadeRuleEntry[] = [];
	let order = 0;
	let unreadableStyleSheet = false;

	const walk = (rules: CSSRuleList, inLayer = false): void => {
		for (const rule of Array.from(rules)) {
			if (unreadableStyleSheet) return;
			const currentOrder = order;
			order += 1;

			if (
				(defaultView?.CSSMediaRule &&
					rule instanceof defaultView.CSSMediaRule) ||
				rule instanceof CSSMediaRule
			) {
				const matches =
					defaultView?.matchMedia(rule.conditionText).matches ?? true;
				if (matches) {
					walk(rule.cssRules, inLayer);
				}
				continue;
			}
			if (
				(defaultView?.CSSSupportsRule &&
					rule instanceof defaultView.CSSSupportsRule) ||
				rule instanceof CSSSupportsRule
			) {
				const supports = defaultView?.CSS?.supports(rule.conditionText) ?? true;
				if (supports) {
					walk(rule.cssRules, inLayer);
				}
				continue;
			}
			const isLayerRule =
				(defaultView?.CSSLayerBlockRule &&
					rule instanceof defaultView.CSSLayerBlockRule) ||
				("name" in rule && "cssRules" in rule && !("conditionText" in rule));
			if (isLayerRule) {
				walk((rule as CSSGroupingRule).cssRules, true);
				continue;
			}
			const isConditionalGroupRule =
				(defaultView?.CSSConditionRule &&
					rule instanceof defaultView.CSSConditionRule) ||
				"conditionText" in rule;
			if (isConditionalGroupRule && "cssRules" in rule) {
				unreadableStyleSheet = true;
				return;
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
					if (
						!importedSheet ||
						(importRule.href && importedSheet.cssRules.length === 0)
					) {
						unreadableStyleSheet = true;
						return;
					}
					const isLayeredImport = typeof importRule.layerName === "string";
					const supportsText = importRule.supportsText?.trim() ?? "";
					if (supportsText) {
						unreadableStyleSheet = true;
						return;
					}
					let importMatches = true;
					if (importRule.media?.mediaText) {
						importMatches =
							defaultView?.matchMedia(importRule.media.mediaText).matches ??
							true;
					}
					if (importMatches) {
						walk(importedSheet.cssRules, inLayer || isLayeredImport);
					}
				} catch {
					unreadableStyleSheet = true;
					return;
				}
				continue;
			}
			const isStyleRule =
				(defaultView?.CSSStyleRule &&
					rule instanceof defaultView.CSSStyleRule) ||
				rule instanceof CSSStyleRule;
			if (!isStyleRule) {
				if ("cssRules" in rule && (rule as { cssRules?: unknown }).cssRules) {
					unreadableStyleSheet = true;
					return;
				}
				if (
					"style" in rule &&
					rule.style &&
					typeof (rule.style as CSSStyleDeclaration).getPropertyValue ===
						"function" &&
					styleAffectsPadding(rule.style as CSSStyleDeclaration, property)
				) {
					unreadableStyleSheet = true;
					return;
				}
				continue;
			}

			const styleRule = rule as CSSStyleRule;
			if (styleRule.cssRules && styleRule.cssRules.length > 0) {
				if (subtreeAffectsPadding(styleRule.cssRules, property)) {
					unreadableStyleSheet = true;
					return;
				}
			}
			if (!styleAffectsPadding(styleRule.style, property)) {
				continue;
			}

			const selectors = splitSelectorList(styleRule.selectorText);
			if (!selectors) {
				unreadableStyleSheet = true;
				return;
			}
			const compiledSelectors: CompiledPaddingSelector[] = selectors.map(
				(selector) => ({
					selector,
					specificity: selectorSpecificity(selector),
				}),
			);
			const value = styleRule.style.getPropertyValue(property).trim();
			const usesToken = value.includes(tokenPattern);
			const layeredPortable = inLayer && usesToken;
			const isPortable = !inLayer && usesToken;
			const important =
				!isPortable &&
				!layeredPortable &&
				styleHasImportantPadding(styleRule.style, property);
			entries.push({
				important,
				inLayer,
				isPortable,
				layeredPortable,
				order: currentOrder,
				selectors: compiledSelectors,
			});
		}
	};

	for (const styleSheet of Array.from(document.styleSheets)) {
		if (unreadableStyleSheet) break;
		try {
			walk(styleSheet.cssRules, false);
		} catch {
			unreadableStyleSheet = true;
			break;
		}
	}

	if (unreadableStyleSheet) {
		return { entries: [], unreadableStyleSheet: true };
	}
	return { entries, unreadableStyleSheet: false };
}

function getPaddingCascadeIndex(
	document: Document,
	property: SemanticPaddingProperty,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): PaddingCascadeIndex {
	if (!dimensionSemantics?.getRefreshGeneration) {
		return buildPaddingCascadeIndex(document, property);
	}
	const generation = dimensionSemantics.getRefreshGeneration();
	const currentSheets = document.styleSheets;
	const defaultView = document.defaultView;
	const viewportWidth = defaultView?.innerWidth ?? 0;
	const viewportHeight = defaultView?.innerHeight ?? 0;
	let cache = PADDING_CASCADE_CACHE.get(dimensionSemantics);
	if (
		!cache ||
		cache.generation !== generation ||
		cache.document !== document ||
		cache.viewportWidth !== viewportWidth ||
		cache.viewportHeight !== viewportHeight ||
		!styleSheetListMatches(cache.sheets, currentSheets)
	) {
		cache = {
			byProperty: new Map(),
			document,
			generation,
			sheets: Array.from(currentSheets),
			viewportHeight,
			viewportWidth,
		};
		PADDING_CASCADE_CACHE.set(dimensionSemantics, cache);
	}
	const cached = cache.byProperty.get(property);
	if (cached) return cached;
	const built = buildPaddingCascadeIndex(document, property);
	cache.byProperty.set(property, built);
	return built;
}

export function evaluatePortablePaddingTransportDecision(
	source: Element,
	property: SemanticPaddingProperty,
	semanticStyle: CSSStyleDeclaration | null,
	token: string,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): PortablePaddingTransportDecision {
	const effective = semanticStyle?.getPropertyValue(property).trim() ?? "";
	const nestedQuote = isNestedBlockquoteElement(source);
	if (!token || "initial" === token) {
		return {
			signature: nestedQuote ? `state=none;effective=${effective}` : "",
			value: null,
		};
	}
	if (!PORTABLE_PADDING_PERCENTAGE.test(token)) {
		throw new Error(`wechat-invalid-portable-padding-${property}`);
	}

	const inlineStyle =
		source instanceof HTMLElement || source instanceof SVGElement
			? source.style
			: null;
	if (inlineStyle) {
		for (const candidate of PORTABLE_PADDING_CASCADE_PROPERTY_LIST) {
			if (inlineStyle.getPropertyValue(candidate).trim()) {
				return {
					signature: `state=effective;reason=inline;token=${token};effective=${effective}`,
					value: null,
				};
			}
		}
	}

	const index = getPaddingCascadeIndex(
		source.ownerDocument,
		property,
		dimensionSemantics,
	);
	if (index.unreadableStyleSheet) {
		return {
			signature: `state=effective;reason=stylesheet-unreadable;token=${token};effective=${effective}`,
			value: null,
		};
	}

	let bestBase: Readonly<{
		order: number;
		specificity: readonly [number, number, number];
	}> | null = null;
	const competitors: Array<
		Readonly<{
			important: boolean;
			inLayer: boolean;
			order: number;
			specificity: readonly [number, number, number];
		}>
	> = [];

	for (const entry of index.entries) {
		let matchedSpecificity: readonly [number, number, number] | null = null;
		for (const candidate of entry.selectors) {
			try {
				if (!source.matches(candidate.selector)) continue;
				if (
					!matchedSpecificity ||
					compareSpecificity(candidate.specificity, matchedSpecificity) > 0
				) {
					matchedSpecificity = candidate.specificity;
				}
			} catch {
				return {
					signature: `state=effective;reason=stylesheet-unreadable;token=${token};effective=${effective}`,
					value: null,
				};
			}
		}
		if (!matchedSpecificity) continue;
		if (entry.layeredPortable) {
			return {
				signature: `state=effective;reason=stylesheet-unreadable;token=${token};effective=${effective}`,
				value: null,
			};
		}
		if (entry.isPortable) {
			if (
				!bestBase ||
				compareSpecificity(matchedSpecificity, bestBase.specificity) > 0 ||
				(compareSpecificity(matchedSpecificity, bestBase.specificity) === 0 &&
					entry.order > bestBase.order)
			) {
				bestBase = { order: entry.order, specificity: matchedSpecificity };
			}
		} else {
			competitors.push({
				important: entry.important,
				inLayer: entry.inLayer,
				order: entry.order,
				specificity: matchedSpecificity,
			});
		}
	}

	if (!bestBase) {
		return {
			signature: `state=effective;reason=portable-rule-missing;token=${token};effective=${effective}`,
			value: null,
		};
	}

	const outranked = competitors.some((candidate) => {
		if (candidate.important) return true;
		if (candidate.inLayer) return false;
		const specificityOrder = compareSpecificity(
			candidate.specificity,
			bestBase.specificity,
		);
		return (
			specificityOrder > 0 ||
			(specificityOrder === 0 && candidate.order > bestBase.order)
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
