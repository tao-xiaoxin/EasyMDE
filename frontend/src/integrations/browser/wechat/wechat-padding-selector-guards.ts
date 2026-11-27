import { splitSelectorList } from '../../../shared/css/selector-list';

function replaceNestingAmpersand(selector: string, replacement: string): string | null {
	let result = '';
	let replaced = false;
	let quote: '"' | "'" | null = null;
	let bracketDepth = 0;
	let escaped = false;
	for (let index = 0; index < selector.length; index += 1) {
		const ch = selector[index] ?? '';
		if (escaped) {
			result += ch;
			escaped = false;
			continue;
		}
		if ('\\' === ch) {
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
		if ('[' === ch) {
			bracketDepth += 1;
			result += ch;
			continue;
		}
		if (']' === ch) {
			bracketDepth = Math.max(0, bracketDepth - 1);
			result += ch;
			continue;
		}
		if (0 === bracketDepth && '&' === ch) {
			result += replacement;
			replaced = true;
			continue;
		}
		result += ch;
	}
	return replaced ? result : null;
}

export function expandNestedSelectorList(
	parentSelectorText: string,
	childSelectorText: string,
): string | null {
	const parentSelectors = splitSelectorList(parentSelectorText);
	const childSelectors = splitSelectorList(childSelectorText);
	if (!parentSelectors?.length || !childSelectors?.length) return null;
	const parentGroup = `:is(${parentSelectors.join(', ')})`;
	const expanded: string[] = [];
	for (const child of childSelectors) {
		const substituted = replaceNestingAmpersand(child, parentGroup);
		expanded.push(substituted ?? `${parentGroup} ${child}`);
	}
	return expanded.join(', ');
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
export function selectorHasScopeOrTopLevelNesting(
	selector: string,
	rejectAmpersand: boolean,
): boolean {
	let quote: '"' | "'" | null = null;
	let bracketDepth = 0;
	let escaped = false;
	let inPseudoIdent = false;
	for (let index = 0; index < selector.length; index += 1) {
		const ch = selector[index] ?? '';
		if (escaped) {
			escaped = false;
			continue;
		}
		if ('\\' === ch) {
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
		if ('[' === ch) {
			bracketDepth += 1;
			inPseudoIdent = false;
			continue;
		}
		if (']' === ch) {
			bracketDepth = Math.max(0, bracketDepth - 1);
			inPseudoIdent = false;
			continue;
		}
		if (bracketDepth > 0) continue;
		if (rejectAmpersand && '&' === ch) {
			return true;
		}
		if (':' === ch) {
			if (
				matchesAsciiCaseInsensitiveAt(selector, index, ':scope') &&
				!isCssIdentChar(selector[index + 6] ?? '')
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

export function selectorUsesSiblingOrNegatedNesting(selector: string): boolean {
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
		const ch = selector[index] ?? '';
		if (escaped) {
			escaped = false;
			continue;
		}
		if ('\\' === ch) {
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
		if ('[' === ch) {
			bracketDepth += 1;
			continue;
		}
		if (']' === ch) {
			bracketDepth = Math.max(0, bracketDepth - 1);
			continue;
		}
		if (bracketDepth > 0) continue;
		if ('+' === ch || '~' === ch) {
			return true;
		}
		if (':' === ch) {
			if (matchesAsciiCaseInsensitiveAt(selector, index, ':has(')) return true;
			if (matchesAsciiCaseInsensitiveAt(selector, index, ':not(')) {
				notDepthStack.push(parenDepth + 1);
			}
		}
		if ('(' === ch) {
			parenDepth += 1;
			if (notDepthStack[notDepthStack.length - 1] === parenDepth) {
				notParenDepth += 1;
			}
			continue;
		}
		if (')' === ch) {
			if (notDepthStack[notDepthStack.length - 1] === parenDepth) {
				notDepthStack.pop();
				notParenDepth = Math.max(0, notParenDepth - 1);
			}
			parenDepth = Math.max(0, parenDepth - 1);
			continue;
		}
		if ('&' === ch && notParenDepth > 0) {
			return true;
		}
	}
	return false;
}

export function selectorMatchesSourceConservatively(
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

export function sourceOrAncestorMatchesConservatively(
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

export function isCssRuleKind(
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
		('function' === typeof ctor && rule instanceof (ctor as new () => CSSRule)) ||
		tagName === Object.prototype.toString.call(rule)
	);
}

export function isTransparentNestedGroupingRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSGroupingRule {
	if (
		(defaultView?.CSSMediaRule && rule instanceof defaultView.CSSMediaRule) ||
		('undefined' !== typeof CSSMediaRule && rule instanceof CSSMediaRule)
	) {
		return true;
	}
	if (
		(defaultView?.CSSSupportsRule && rule instanceof defaultView.CSSSupportsRule) ||
		('undefined' !== typeof CSSSupportsRule && rule instanceof CSSSupportsRule)
	) {
		return true;
	}
	return isCssRuleKind(rule, defaultView, 'CSSLayerBlockRule', '[object CSSLayerBlockRule]');
}

export function isSkippableNestedNonSelectorRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): boolean {
	if (
		(defaultView?.CSSFontFaceRule && rule instanceof defaultView.CSSFontFaceRule) ||
		(defaultView?.CSSRule && defaultView.CSSRule.FONT_FACE_RULE === rule.type)
	) {
		return true;
	}
	if (
		(defaultView?.CSSKeyframesRule && rule instanceof defaultView.CSSKeyframesRule) ||
		(defaultView?.CSSRule && defaultView.CSSRule.KEYFRAMES_RULE === rule.type)
	) {
		return true;
	}
	if (isCssRuleKind(rule, defaultView, 'CSSViewTransitionRule', '[object CSSViewTransitionRule]')) {
		return true;
	}
	return isCssRuleKind(rule, defaultView, 'CSSLayerStatementRule', '[object CSSLayerStatementRule]');
}
