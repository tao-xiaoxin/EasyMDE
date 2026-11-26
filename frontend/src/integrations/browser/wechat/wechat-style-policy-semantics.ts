import { splitSelectorList } from "../../../shared/css/selector-list";
import { isSvgElement } from "./wechat-clone-metadata";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
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
	supportsSpecialLayout,
} from "./wechat-style-policy-content-box";

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

function relevantPaddingRuleProperty(property: string): boolean {
	return PORTABLE_PADDING_CASCADE_PROPERTIES.has(property);
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

function replaceNestingAmpersand(
	selector: string,
	replacement: string,
): string | null {
	let result = "";
	let replaced = false;
	let quote: '"' | "'" | null = null;
	let bracketDepth = 0;
	let escaped = false;
	for (let index = 0; index < selector.length; index += 1) {
		const ch = selector[index] ?? "";
		if (escaped) {
			result += ch;
			escaped = false;
			continue;
		}
		if ("\\" === ch) {
			result += ch;
			escaped = true;
			continue;
		}
		if (quote) {
			if (quote === ch) quote = null;
			result += ch;
			continue;
		}
		if ('"' === ch || "'" === ch) {
			quote = ch;
			result += ch;
			continue;
		}
		if ("[" === ch) {
			bracketDepth += 1;
			result += ch;
			continue;
		}
		if ("]" === ch) {
			bracketDepth = Math.max(0, bracketDepth - 1);
			result += ch;
			continue;
		}
		if (0 === bracketDepth && "&" === ch) {
			result += replacement;
			replaced = true;
			continue;
		}
		result += ch;
	}
	return replaced ? result : null;
}

function expandNestedSelectorList(
	parentSelectorText: string,
	childSelectorText: string,
): string | null {
	const parentSelectors = splitSelectorList(parentSelectorText);
	const childSelectors = splitSelectorList(childSelectorText);
	if (!parentSelectors?.length || !childSelectors?.length) return null;
	const parentGroup = `:is(${parentSelectors.join(", ")})`;
	const expanded: string[] = [];
	for (const child of childSelectors) {
		const substituted = replaceNestingAmpersand(child, parentGroup);
		expanded.push(substituted ?? `${parentGroup} ${child}`);
	}
	return expanded.join(", ");
}

function isCssIdentChar(ch: string): boolean {
	if (!ch) return false;
	const code = ch.charCodeAt(0);
	return (
		(code >= 0x61 && code <= 0x7a) ||
		(code >= 0x41 && code <= 0x5a) ||
		(code >= 0x30 && code <= 0x39) ||
		0x5f === code ||
		0x2d === code ||
		code >= 0x80
	);
}

function matchesAsciiCaseInsensitiveAt(
	input: string,
	index: number,
	asciiLowerTarget: string,
): boolean {
	if (index + asciiLowerTarget.length > input.length) return false;
	for (let offset = 0; offset < asciiLowerTarget.length; offset += 1) {
		const code = input.charCodeAt(index + offset);
		const lowered = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
		if (lowered !== asciiLowerTarget.charCodeAt(offset)) return false;
	}
	return true;
}

/**
 * Detects selectors whose DOM `matches()` / `closest()` semantics diverge from
 * document stylesheet matching (`:scope`, escaped pseudo-classes, and top-level
 * `&` which binds to `:root` in a stylesheet but to the receiver element in
 * DOM selector APIs).
 */
function selectorHasScopeOrTopLevelNesting(
	selector: string,
	rejectAmpersand: boolean,
): boolean {
	let quote: '"' | "'" | null = null;
	let bracketDepth = 0;
	let escaped = false;
	let inPseudoIdent = false;
	for (let index = 0; index < selector.length; index += 1) {
		const ch = selector[index] ?? "";
		if (escaped) {
			escaped = false;
			continue;
		}
		if ("\\" === ch) {
			if (!quote && 0 === bracketDepth && inPseudoIdent) {
				// Fail closed on CSS escapes inside pseudo-class names (e.g. `:\73 cope`).
				return true;
			}
			escaped = true;
			continue;
		}
		if (quote) {
			if (quote === ch) quote = null;
			continue;
		}
		if ('"' === ch || "'" === ch) {
			quote = ch;
			inPseudoIdent = false;
			continue;
		}
		if ("[" === ch) {
			bracketDepth += 1;
			inPseudoIdent = false;
			continue;
		}
		if ("]" === ch) {
			bracketDepth = Math.max(0, bracketDepth - 1);
			inPseudoIdent = false;
			continue;
		}
		if (bracketDepth > 0) continue;
		if (rejectAmpersand && "&" === ch) {
			return true;
		}
		if (":" === ch) {
			if (
				matchesAsciiCaseInsensitiveAt(selector, index, ":scope") &&
				!isCssIdentChar(selector[index + 6] ?? "")
			) {
				return true;
			}
			inPseudoIdent = true;
			continue;
		}
		if (inPseudoIdent && !isCssIdentChar(ch)) {
			inPseudoIdent = false;
		}
	}
	return false;
}

function selectorMatchesSourceConservatively(
	source: Element,
	selectorText: string,
): boolean {
	if (selectorHasScopeOrTopLevelNesting(selectorText, false)) {
		return true;
	}
	try {
		return source.matches(selectorText);
	} catch {
		return true;
	}
}

function selectorUsesSiblingOrNegatedNesting(selector: string): boolean {
	if (selectorHasScopeOrTopLevelNesting(selector, false)) {
		return true;
	}
	let quote: '"' | "'" | null = null;
	let bracketDepth = 0;
	let escaped = false;
	let notParenDepth = 0;
	const notDepthStack: number[] = [];
	let parenDepth = 0;
	for (let index = 0; index < selector.length; index += 1) {
		const ch = selector[index] ?? "";
		if (escaped) {
			escaped = false;
			continue;
		}
		if ("\\" === ch) {
			escaped = true;
			continue;
		}
		if (quote) {
			if (quote === ch) quote = null;
			continue;
		}
		if ('"' === ch || "'" === ch) {
			quote = ch;
			continue;
		}
		if ("[" === ch) {
			bracketDepth += 1;
			continue;
		}
		if ("]" === ch) {
			bracketDepth = Math.max(0, bracketDepth - 1);
			continue;
		}
		if (bracketDepth > 0) continue;
		if ("+" === ch || "~" === ch) {
			return true;
		}
		if (":" === ch) {
			if (matchesAsciiCaseInsensitiveAt(selector, index, ":has(")) return true;
			if (matchesAsciiCaseInsensitiveAt(selector, index, ":not(")) {
				notDepthStack.push(parenDepth + 1);
			}
		}
		if ("(" === ch) {
			parenDepth += 1;
			if (notDepthStack[notDepthStack.length - 1] === parenDepth) {
				notParenDepth += 1;
			}
			continue;
		}
		if (")" === ch) {
			if (notDepthStack[notDepthStack.length - 1] === parenDepth) {
				notDepthStack.pop();
				notParenDepth = Math.max(0, notParenDepth - 1);
			}
			parenDepth = Math.max(0, parenDepth - 1);
			continue;
		}
		if ("&" === ch && notParenDepth > 0) {
			return true;
		}
	}
	return false;
}

function isRuleKind(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
	constructorName: string,
	tagName: string,
): boolean {
	const ctor =
		defaultView && constructorName in defaultView
			? (defaultView as unknown as Record<string, unknown>)[constructorName]
			: undefined;
	return (
		("function" === typeof ctor && rule instanceof (ctor as new () => CSSRule)) ||
		tagName === Object.prototype.toString.call(rule)
	);
}

function isTransparentNestedGroupingRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSGroupingRule {
	if (
		(defaultView?.CSSMediaRule && rule instanceof defaultView.CSSMediaRule) ||
		("undefined" !== typeof CSSMediaRule && rule instanceof CSSMediaRule)
	) {
		return true;
	}
	if (
		(defaultView?.CSSSupportsRule &&
			rule instanceof defaultView.CSSSupportsRule) ||
		("undefined" !== typeof CSSSupportsRule && rule instanceof CSSSupportsRule)
	) {
		return true;
	}
	return isRuleKind(
		rule,
		defaultView,
		"CSSLayerBlockRule",
		"[object CSSLayerBlockRule]",
	);
}

function isSkippableNestedNonSelectorRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): boolean {
	if (
		(defaultView?.CSSFontFaceRule &&
			rule instanceof defaultView.CSSFontFaceRule) ||
		(defaultView?.CSSRule && defaultView.CSSRule.FONT_FACE_RULE === rule.type)
	) {
		return true;
	}
	if (
		(defaultView?.CSSKeyframesRule &&
			rule instanceof defaultView.CSSKeyframesRule) ||
		(defaultView?.CSSRule && defaultView.CSSRule.KEYFRAMES_RULE === rule.type)
	) {
		return true;
	}
	if (
		isRuleKind(
			rule,
			defaultView,
			"CSSViewTransitionRule",
			"[object CSSViewTransitionRule]",
		)
	) {
		return true;
	}
	return isRuleKind(
		rule,
		defaultView,
		"CSSLayerStatementRule",
		"[object CSSLayerStatementRule]",
	);
}

function sourceOrAncestorMatchesConservatively(
	source: Element,
	selectorText: string,
	rejectAmpersand = true,
): boolean {
	if (selectorHasScopeOrTopLevelNesting(selectorText, rejectAmpersand)) {
		return true;
	}
	try {
		return null !== source.closest(selectorText);
	} catch {
		return true;
	}
}

function subtreeAffectsPadding(
	rules: CSSRuleList,
	property: string,
	source: Element,
	parentSelectorText: string,
	parentOrAncestorMatched: boolean,
): boolean {
	try {
		const defaultView = source.ownerDocument.defaultView;
		for (const rule of Array.from(rules)) {
			const isStyleRule =
				(defaultView?.CSSStyleRule &&
					rule instanceof defaultView.CSSStyleRule) ||
				("undefined" !== typeof CSSStyleRule && rule instanceof CSSStyleRule);
			if (isStyleRule) {
				const styleRule = rule as CSSStyleRule;
				const expanded = expandNestedSelectorList(
					parentSelectorText,
					styleRule.selectorText,
				);
				if (!expanded) return true;
				const childNeedsConservativeCheck =
					parentOrAncestorMatched ||
					selectorUsesSiblingOrNegatedNesting(styleRule.selectorText) ||
					sourceOrAncestorMatchesConservatively(source, expanded, false);
				if (
					styleAffectsPadding(styleRule.style, property) &&
					childNeedsConservativeCheck
				) {
					return true;
				}
				if (
					styleRule.cssRules &&
					styleRule.cssRules.length > 0 &&
					subtreeAffectsPadding(
						styleRule.cssRules,
						property,
						source,
						expanded,
						childNeedsConservativeCheck,
					)
				) {
					return true;
				}
				continue;
			}
			if (
				isRuleKind(
					rule,
					defaultView,
					"CSSNestedDeclarations",
					"[object CSSNestedDeclarations]",
				)
			) {
				const style = (rule as CSSRule & { style?: CSSStyleDeclaration }).style;
				if (!style || "function" !== typeof style.getPropertyValue) return true;
				if (
					styleAffectsPadding(style, property) &&
					(parentOrAncestorMatched ||
						selectorMatchesSourceConservatively(source, parentSelectorText))
				) {
					return true;
				}
				continue;
			}
			if (isTransparentNestedGroupingRule(rule, defaultView)) {
				const childRules = rule.cssRules;
				if (
					childRules.length > 0 &&
					subtreeAffectsPadding(
						childRules,
						property,
						source,
						parentSelectorText,
						parentOrAncestorMatched,
					)
				) {
					return true;
				}
				continue;
			}
			if (isSkippableNestedNonSelectorRule(rule, defaultView)) {
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

function isNestedBlockquoteElement(source: Element): boolean {
	if ("blockquote" !== source.localName.toLowerCase()) return false;
	let ancestor = source.parentElement;
	while (ancestor) {
		if ("blockquote" === ancestor.localName.toLowerCase()) return true;
		ancestor = ancestor.parentElement;
	}
	return false;
}

function portablePaddingTransportDecision(
	source: Element,
	property: (typeof SEMANTIC_PADDING_PROPERTIES)[number],
	semanticStyle: CSSStyleDeclaration | null,
	token: string,
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
				(defaultView?.CSSMediaRule &&
					rule instanceof defaultView.CSSMediaRule) ||
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
				const supports = defaultView?.CSS?.supports(rule.conditionText) ?? true;
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
					if (
						!importedSheet ||
						(importRule.href && importedSheet.cssRules.length === 0)
					) {
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
					typeof (rule.style as CSSStyleDeclaration).getPropertyValue ===
						"function" &&
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
				if (selectorHasScopeOrTopLevelNesting(candidate, true)) {
					selectorListReadable = false;
					break;
				}
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
				const parentOrAncestorMatched = sourceOrAncestorMatchesConservatively(
					source,
					rule.selectorText,
				);
				if (
					subtreeAffectsPadding(
						rule.cssRules,
						property,
						source,
						rule.selectorText,
						parentOrAncestorMatched,
					)
				) {
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
): boolean {
	const specialNode = isSemanticMathNode(source);
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

function semanticPaddingTransportDecisionForStyle(
	property: (typeof SEMANTIC_PADDING_PROPERTIES)[number],
	source: Element,
	semanticStyle: CSSStyleDeclaration | null,
): PortablePaddingTransportDecision {
	const tokenName = PORTABLE_PADDING_TOKENS[property];
	const token = semanticStyle?.getPropertyValue(tokenName).trim() ?? "";
	return portablePaddingTransportDecision(
		source,
		property,
		semanticStyle,
		token,
	);
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
	return semanticPaddingTransportDecisionForStyle(
		property as (typeof SEMANTIC_PADDING_PROPERTIES)[number],
		source,
		semanticStyle,
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
	const semanticStyle =
		semanticComputed ?? dimensionSemantics.getComputedStyle(source);
	const values = SEMANTIC_PADDING_PROPERTIES.map((property) => {
		const decision = semanticPaddingTransportDecisionForStyle(
			property,
			source,
			semanticStyle,
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
