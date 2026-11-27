export function isCssIdentChar(ch: string): boolean {
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

export function matchesAsciiCaseInsensitiveAt(
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

export type CssSelectorTokenEvent = Readonly<{
	ch: string;
	index: number;
	inPseudoIdent: boolean;
	isPseudoEscape: boolean;
}>;

/**
 * Scans a CSS selector in a single pass, tracking backslash escapes, quoted
 * strings, attribute selector brackets `[...]`, and pseudo-class/element
 * identifier context. Invokes `onToken` only outside strings and attribute
 * brackets (plus on backslash escapes inside pseudo-class/element names so
 * callers can fail closed on escaped pseudo identifiers like `:\73 cope` or
 * `::\62 efore`). Returning `true` from `onToken` stops scanning early and
 * returns `true`.
 */
export function scanSelectorOutsideStringsAndAttributes(
	selector: string,
	onToken: (event: CssSelectorTokenEvent) => boolean | undefined,
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
				if (onToken({ ch, index, inPseudoIdent: true, isPseudoEscape: true })) {
					return true;
				}
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
		if (':' === ch) {
			inPseudoIdent = true;
			if (onToken({ ch, index, inPseudoIdent: true, isPseudoEscape: false })) {
				return true;
			}
			continue;
		}
		if (inPseudoIdent && !isCssIdentChar(ch)) {
			inPseudoIdent = false;
		}
		if (onToken({ ch, index, inPseudoIdent, isPseudoEscape: false })) {
			return true;
		}
	}
	return false;
}

export function replaceSelectorAmpersand(selector: string, replacement: string): string | null {
	let result = '';
	let lastSlice = 0;
	let replaced = false;
	scanSelectorOutsideStringsAndAttributes(selector, ({ ch, index, isPseudoEscape }) => {
		if (!isPseudoEscape && '&' === ch) {
			result += selector.slice(lastSlice, index) + replacement;
			lastSlice = index + 1;
			replaced = true;
		}
		return false;
	});
	if (!replaced) return null;
	return result + selector.slice(lastSlice);
}

/**
 * Checks whether a selector mentions `:before` or `::before` outside quoted
 * strings and attribute brackets, failing closed on CSS escapes inside
 * pseudo-class/element identifiers (e.g. `::\62 efore`).
 */
export function selectorHasPseudoBefore(selector: string): boolean {
	return scanSelectorOutsideStringsAndAttributes(selector, ({ ch, index, isPseudoEscape }) => {
		if (isPseudoEscape) return true;
		if (
			':' === ch &&
			matchesAsciiCaseInsensitiveAt(selector, index, ':before') &&
			!isCssIdentChar(selector[index + 7] ?? '')
		) {
			return true;
		}
		return false;
	});
}
