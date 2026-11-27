import { splitSelectorList } from '../../../shared/css/selector-list';
import {
	isCssIdentChar,
	matchesAsciiCaseInsensitiveAt,
	replaceSelectorAmpersand,
	scanSelectorOutsideStringsAndAttributes,
} from './wechat-css-selector-scanner';

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
		const substituted = replaceSelectorAmpersand(child, parentGroup);
		expanded.push(substituted ?? `${parentGroup} ${child}`);
	}
	return expanded.join(', ');
}

function isScopePseudoAt(selector: string, index: number): boolean {
	return (
		matchesAsciiCaseInsensitiveAt(selector, index, ':scope') &&
		!isCssIdentChar(selector[index + 6] ?? '')
	);
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
	return scanSelectorOutsideStringsAndAttributes(selector, ({ ch, index, isPseudoEscape }) => {
		if (isPseudoEscape) return true;
		if (rejectAmpersand && '&' === ch) return true;
		return ':' === ch && isScopePseudoAt(selector, index);
	});
}

export function selectorUsesSiblingOrNegatedNesting(selector: string): boolean {
	let notParenDepth = 0;
	const notDepthStack: number[] = [];
	let parenDepth = 0;
	return scanSelectorOutsideStringsAndAttributes(selector, ({ ch, index, isPseudoEscape }) => {
		if (isPseudoEscape) return true;
		if ('+' === ch || '~' === ch) return true;
		if (':' === ch) {
			if (isScopePseudoAt(selector, index)) return true;
			if (matchesAsciiCaseInsensitiveAt(selector, index, ':has(')) return true;
			if (matchesAsciiCaseInsensitiveAt(selector, index, ':not(')) {
				notDepthStack.push(parenDepth + 1);
			}
			return false;
		}
		if ('(' === ch) {
			parenDepth += 1;
			if (notDepthStack[notDepthStack.length - 1] === parenDepth) {
				notParenDepth += 1;
			}
			return false;
		}
		if (')' === ch) {
			if (notDepthStack[notDepthStack.length - 1] === parenDepth) {
				notDepthStack.pop();
				notParenDepth = Math.max(0, notParenDepth - 1);
			}
			parenDepth = Math.max(0, parenDepth - 1);
			return false;
		}
		return '&' === ch && notParenDepth > 0;
	});
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
