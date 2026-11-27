import { splitSelectorList } from "../../../shared/css/selector-list";
import {
	isCssKeyframesRule,
	isCssLayerBlockRule,
	isCssMediaRule,
	isCssNestedDeclarationsRule,
	isCssStyleRule,
	isCssSupportsRule,
	isSkippableNonSelectorRule,
	isTransparentNestedGroupingRule,
} from "./wechat-cssom-rule-guards";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	expandNestedSelectorList,
	selectorHasScopeOrTopLevelNesting,
	selectorMatchesSourceConservatively,
	selectorUsesSiblingOrNegatedNesting,
	sourceOrAncestorMatchesConservatively,
} from "./wechat-padding-selector-guards";

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

export type CompiledNestedPaddingGuard = Readonly<{
	closestSelectors: readonly string[];
	matchesSelector?: string;
}>;

export type PaddingCascadeIndex = Readonly<{
	entries: readonly PaddingCascadeRuleEntry[];
	nestedGuards: readonly CompiledNestedPaddingGuard[];
	paddingKeyframeNames: ReadonlySet<string>;
	unreadableStyleSheet: boolean;
}>;

export const PORTABLE_PADDING_TOKENS: Readonly<
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
					const subSelectors = splitSelectorList(arg) ?? arg.split(",");
					let maxArgSpecificity: readonly [number, number, number] = [0, 0, 0];
					for (const rawSub of subSelectors) {
						const sub = rawSub.trim();
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

function isAsciiHexDigit(code: number): boolean {
	return (
		(code >= 0x30 && code <= 0x39) ||
		(code >= 0x41 && code <= 0x46) ||
		(code >= 0x61 && code <= 0x66)
	);
}

function isCssWhitespaceCode(code: number): boolean {
	return (
		0x20 === code ||
		0x09 === code ||
		0x0a === code ||
		0x0c === code ||
		0x0d === code
	);
}

function consumeCssEscape(
	input: string,
	backslashIndex: number,
): Readonly<{ char: string; nextIndex: number }> | null {
	const after = backslashIndex + 1;
	if (after >= input.length) return null;
	const firstCode = input.charCodeAt(after);
	if (0x0a === firstCode || 0x0c === firstCode || 0x0d === firstCode) {
		return null;
	}
	if (isAsciiHexDigit(firstCode)) {
		let end = after + 1;
		const limit = Math.min(input.length, after + 6);
		while (end < limit && isAsciiHexDigit(input.charCodeAt(end))) {
			end += 1;
		}
		const codePoint = Number.parseInt(input.slice(after, end), 16);
		if (end < input.length) {
			const wsCode = input.charCodeAt(end);
			if (0x0d === wsCode && end + 1 < input.length && 0x0a === input.charCodeAt(end + 1)) {
				end += 2;
			} else if (isCssWhitespaceCode(wsCode)) {
				end += 1;
			}
		}
		const decoded =
			0 === codePoint ||
			codePoint > 0x10ffff ||
			(codePoint >= 0xd800 && codePoint <= 0xdfff)
				? "\uFFFD"
				: String.fromCodePoint(codePoint);
		return { char: decoded, nextIndex: end };
	}
	const codePoint = input.codePointAt(after) ?? firstCode;
	const char = String.fromCodePoint(codePoint);
	return { char, nextIndex: after + char.length };
}

/**
 * Parses a CSS `animation-name` serialized value list (CSS Syntax Level 3),
 * decoding CSS escapes in both `<custom-ident>` (e.g. `pad\,override`,
 * `\70 ad\,override`) and quoted `<string>` names while skipping only unquoted
 * `none` keywords. Returns `null` on malformed input so callers fail closed.
 */
function parseCssAnimationNameList(raw: string): readonly string[] | null {
	const names: string[] = [];
	let index = 0;
	const skipWhitespace = (): void => {
		while (index < raw.length && isCssWhitespaceCode(raw.charCodeAt(index))) {
			index += 1;
		}
	};
	while (true) {
		skipWhitespace();
		if (index >= raw.length) return null;
		const startCh = raw[index] ?? "";
		if ("," === startCh) return null;
		if ('"' === startCh || "'" === startCh) {
			const quote = startCh;
			index += 1;
			let decoded = "";
			let closed = false;
			while (index < raw.length) {
				const ch = raw[index] ?? "";
				if (ch === quote) {
					index += 1;
					closed = true;
					break;
				}
				if ("\\" === ch) {
					const escaped = consumeCssEscape(raw, index);
					if (!escaped) return null;
					decoded += escaped.char;
					index = escaped.nextIndex;
					continue;
				}
				const code = ch.charCodeAt(0);
				if (0x0a === code || 0x0c === code || 0x0d === code) return null;
				decoded += ch;
				index += 1;
			}
			if (!closed) return null;
			names.push(decoded);
		} else {
			let decoded = "";
			let hadEscape = false;
			while (index < raw.length) {
				const ch = raw[index] ?? "";
				const code = ch.charCodeAt(0);
				if ("," === ch || isCssWhitespaceCode(code)) break;
				if ('"' === ch || "'" === ch) return null;
				if ("\\" === ch) {
					const escaped = consumeCssEscape(raw, index);
					if (!escaped) return null;
					decoded += escaped.char;
					index = escaped.nextIndex;
					hadEscape = true;
					continue;
				}
				decoded += ch;
				index += 1;
			}
			if (!decoded) return null;
			if (hadEscape || "none" !== decoded.toLowerCase()) {
				names.push(decoded);
			}
		}
		skipWhitespace();
		if (index >= raw.length) break;
		if ("," !== raw[index]) return null;
		index += 1;
	}
	return names;
}

function recordPaddingKeyframesRule(
	rule: CSSKeyframesRule,
	property: SemanticPaddingProperty,
	outKeyframeNames: Set<string>,
): boolean {
	const tokenName = PORTABLE_PADDING_TOKENS[property];
	try {
		let affectsPadding = false;
		for (const frame of Array.from(rule.cssRules)) {
			const frameStyle = (frame as CSSRule & { style?: CSSStyleDeclaration })
				.style;
			if (!frameStyle || "function" !== typeof frameStyle.getPropertyValue) {
				return true;
			}
			if (
				styleAffectsPadding(frameStyle, property) ||
				frameStyle.getPropertyValue("all").trim() !== "" ||
				frameStyle.getPropertyValue(tokenName).trim() !== ""
			) {
				affectsPadding = true;
			}
		}
		if (!affectsPadding) return false;
		if ("string" !== typeof rule.name) return true;
		outKeyframeNames.add(rule.name);
		return false;
	} catch {
		return true;
	}
}

function elementUsesAnimatedPaddingKeyframes(
	source: Element,
	semanticStyle: CSSStyleDeclaration | null,
	paddingKeyframeNames: ReadonlySet<string>,
): boolean {
	if (0 === paddingKeyframeNames.size) return false;
	const animationNames = [
		semanticStyle?.getPropertyValue("animation-name").trim() ?? "",
		source.ownerDocument.defaultView
			?.getComputedStyle(source)
			?.getPropertyValue("animation-name")
			.trim() ?? "",
	].filter(Boolean);
	// Fail closed if animation-name cannot be inspected so padding animations never silently bypass effective pixels.
	if (0 === animationNames.length) return true;
	for (const rawList of animationNames) {
		const parsed = parseCssAnimationNameList(rawList);
		if (null === parsed) return true;
		for (const name of parsed) {
			if (paddingKeyframeNames.has(name)) {
				return true;
			}
		}
	}
	return false;
}

function compileNestedPaddingGuards(
	rules: CSSRuleList,
	property: SemanticPaddingProperty,
	defaultView: (Window & typeof globalThis) | null | undefined,
	parentSelectorText: string,
	ancestorClosestSelectors: readonly string[],
	ancestorUnsafe: boolean,
	outGuards: CompiledNestedPaddingGuard[],
	outKeyframeNames: Set<string>,
): boolean {
	try {
		for (const rule of Array.from(rules)) {
			if (isCssStyleRule(rule, defaultView)) {
				const expanded = expandNestedSelectorList(
					parentSelectorText,
					rule.selectorText,
				);
				if (!expanded) return true;
				const childUnsafe =
					ancestorUnsafe ||
					selectorUsesSiblingOrNegatedNesting(rule.selectorText) ||
					selectorHasScopeOrTopLevelNesting(expanded, false);
				const nextClosestSelectors = childUnsafe
					? ancestorClosestSelectors
					: [...ancestorClosestSelectors, expanded];
				if (styleAffectsPadding(rule.style, property)) {
					if (childUnsafe) return true;
					outGuards.push({ closestSelectors: nextClosestSelectors });
				}
				if (
					rule.cssRules &&
					rule.cssRules.length > 0 &&
					compileNestedPaddingGuards(
						rule.cssRules,
						property,
						defaultView,
						expanded,
						nextClosestSelectors,
						childUnsafe,
						outGuards,
						outKeyframeNames,
					)
				) {
					return true;
				}
				continue;
			}
			if (isCssNestedDeclarationsRule(rule, defaultView)) {
				const style = rule.style;
				if (!style || "function" !== typeof style.getPropertyValue) return true;
				if (styleAffectsPadding(style, property)) {
					if (
						ancestorUnsafe ||
						selectorHasScopeOrTopLevelNesting(parentSelectorText, false)
					) {
						return true;
					}
					outGuards.push({
						closestSelectors: ancestorClosestSelectors,
						matchesSelector: parentSelectorText,
					});
				}
				continue;
			}
			if (isTransparentNestedGroupingRule(rule, defaultView)) {
				const childRules = rule.cssRules;
				if (
					childRules.length > 0 &&
					compileNestedPaddingGuards(
						childRules,
						property,
						defaultView,
						parentSelectorText,
						ancestorClosestSelectors,
						ancestorUnsafe,
						outGuards,
						outKeyframeNames,
					)
				) {
					return true;
				}
				continue;
			}
			if (isCssKeyframesRule(rule, defaultView)) {
				if (recordPaddingKeyframesRule(rule, property, outKeyframeNames)) {
					return true;
				}
				continue;
			}
			if (isSkippableNonSelectorRule(rule, defaultView)) {
				continue;
			}
			// Fail closed on scope-rebinding or unrecognized nested rules
			// (e.g. CSSScopeRule `@scope`, CSSContainerRule, CSSStartingStyleRule).
			return true;
		}
	} catch {
		return true;
	}
	return false;
}

function nestedPaddingGuardMatchesSource(
	source: Element,
	guard: CompiledNestedPaddingGuard,
): boolean {
	for (let index = 0; index < guard.closestSelectors.length; index += 1) {
		const selector = guard.closestSelectors[index];
		if (
			selector &&
			sourceOrAncestorMatchesConservatively(source, selector, 0 === index)
		) {
			return true;
		}
	}
	if (
		guard.matchesSelector &&
		selectorMatchesSourceConservatively(source, guard.matchesSelector)
	) {
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
	const nestedGuards: CompiledNestedPaddingGuard[] = [];
	const paddingKeyframeNames = new Set<string>();
	let order = 0;
	let unreadableStyleSheet = false;

	const walk = (rules: CSSRuleList, inLayer = false): void => {
		for (const rule of Array.from(rules)) {
			if (unreadableStyleSheet) return;
			const currentOrder = order;
			order += 1;

			if (isCssMediaRule(rule, defaultView)) {
				const matches =
					defaultView?.matchMedia(rule.conditionText).matches ?? true;
				if (matches) {
					walk(rule.cssRules, inLayer);
				}
				continue;
			}
			if (isCssSupportsRule(rule, defaultView)) {
				const supports = defaultView?.CSS?.supports(rule.conditionText) ?? true;
				if (supports) {
					walk(rule.cssRules, inLayer);
				}
				continue;
			}
			if (isCssLayerBlockRule(rule, defaultView)) {
				walk(rule.cssRules, true);
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
			if (!isCssStyleRule(rule, defaultView)) {
				if (isCssKeyframesRule(rule, defaultView)) {
					if (recordPaddingKeyframesRule(rule, property, paddingKeyframeNames)) {
						unreadableStyleSheet = true;
						return;
					}
					continue;
				}
				if (isSkippableNonSelectorRule(rule, defaultView)) {
					continue;
				}
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

			const selectors = splitSelectorList(rule.selectorText);
			if (
				!selectors ||
				selectors.some((selector) =>
					selectorHasScopeOrTopLevelNesting(selector, true),
				)
			) {
				unreadableStyleSheet = true;
				return;
			}
			if (rule.cssRules && rule.cssRules.length > 0) {
				if (
					compileNestedPaddingGuards(
						rule.cssRules,
						property,
						defaultView,
						rule.selectorText,
						[rule.selectorText],
						false,
						nestedGuards,
						paddingKeyframeNames,
					)
				) {
					unreadableStyleSheet = true;
					return;
				}
			}
			if (!styleAffectsPadding(rule.style, property)) {
				continue;
			}
			const compiledSelectors: CompiledPaddingSelector[] = selectors.map(
				(selector) => ({
					selector,
					specificity: selectorSpecificity(selector),
				}),
			);
			const value = rule.style.getPropertyValue(property).trim();
			const usesToken = value.includes(tokenPattern);
			const layeredPortable = inLayer && usesToken;
			const isPortable = !inLayer && usesToken;
			const important =
				!isPortable &&
				!layeredPortable &&
				styleHasImportantPadding(rule.style, property);
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
		return {
			entries: [],
			nestedGuards: [],
			paddingKeyframeNames: new Set(),
			unreadableStyleSheet: true,
		};
	}
	return {
		entries,
		nestedGuards,
		paddingKeyframeNames,
		unreadableStyleSheet: false,
	};
}

function getPaddingCascadeIndex(
	document: Document,
	property: SemanticPaddingProperty,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): PaddingCascadeIndex {
	if (!dimensionSemantics) {
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
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): PortablePaddingTransportDecision {
	const token =
		semanticStyle?.getPropertyValue(PORTABLE_PADDING_TOKENS[property]).trim() ??
		"";
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
	if (
		index.unreadableStyleSheet ||
		index.nestedGuards.some((guard) =>
			nestedPaddingGuardMatchesSource(source, guard),
		)
	) {
		return {
			signature: `state=effective;reason=stylesheet-unreadable;token=${token};effective=${effective}`,
			value: null,
		};
	}
	if (
		elementUsesAnimatedPaddingKeyframes(
			source,
			semanticStyle,
			index.paddingKeyframeNames,
		)
	) {
		return {
			signature: `state=effective;reason=animated;token=${token};effective=${effective}`,
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
