import { type Element, InlineContext } from "@lezer/markdown";

import { isLezerSpaceCode } from "../../shared/markdown/markdown-char-codes";
import {
	asInternalInlineContext,
	isInlineDelimiterPart,
	type LezerInlineDelimiter,
	resolveInlineMarkersLinear,
	setElementDepth,
} from "./editor-markdown-inline-markers";

/**
 * Strictly O(N) amortized worker-safe replacements for `@lezer/markdown`'s
 * `Link`, `Image`, and `LinkEnd` inline parsers.
 *
 * Maintains per-`InlineContext` stacks of open `LinkStart`/`ImageStart`
 * indices (`openIndices`, `openLinkIndices`) plus forward delimiter sentinels
 * (`lastCloseAngle`, `lastCloseParen`, cached unescaped quote/paren title
 * closes, and an exact O(runLen) two-pass `bareUrlEnd` lookup table for long
 * non-whitespace runs) so nested links, unmatched brackets, and unclosed
 * destinations/titles never degrade quadratically while preserving 1:1
 * `@lezer/markdown` AST output.
 */

type CloseScanCache = {
	closeAt: number;
	scannedFrom: number;
};

type LinearLinkState = {
	bareUrlEnd: Int32Array | null;
	bareUrlRunEnd: number;
	bareUrlRunStart: number;
	closeDoubleQuote: CloseScanCache;
	closeParenTitle: CloseScanCache;
	closeSingleQuote: CloseScanCache;
	lastCloseAngle: number;
	lastCloseParen: number;
	openIndices: number[];
	openLinkIndices: number[];
};

type OffsetRange = Readonly<{
	from: number;
	to: number;
}>;

type LinearLinkTail = Readonly<{
	dest: OffsetRange | null;
	endPos: number;
	label: OffsetRange | null;
	parenClosePos: number;
	title: OffsetRange | null;
}>;

const LINEAR_LINK_STATE_SYMBOL = Symbol("easymdeLinearLinkState");
const NOOP_EXCEEDED_DEPTH = (_from: number, _to: number): void => {};
const BARE_URL_FAST_SCAN_LIMIT = 32;

type InlineContextWithLinkState = InlineContext & {
	[LINEAR_LINK_STATE_SYMBOL]?: LinearLinkState;
};

function peekLinearLinkState(cx: InlineContext): LinearLinkState | undefined {
	return (cx as InlineContextWithLinkState)[LINEAR_LINK_STATE_SYMBOL];
}

function getLinearLinkState(cx: InlineContext): LinearLinkState {
	const target = cx as InlineContextWithLinkState;
	let state = target[LINEAR_LINK_STATE_SYMBOL];
	if (!state) {
		state = {
			bareUrlEnd: null,
			bareUrlRunEnd: -1,
			bareUrlRunStart: -1,
			closeDoubleQuote: { closeAt: -1, scannedFrom: -1 },
			closeParenTitle: { closeAt: -1, scannedFrom: -1 },
			closeSingleQuote: { closeAt: -1, scannedFrom: -1 },
			lastCloseAngle: -2,
			lastCloseParen: -2,
			openIndices: [],
			openLinkIndices: [],
		};
		target[LINEAR_LINK_STATE_SYMBOL] = state;
	}
	return state;
}

function getLastCloseAngle(text: string, state: LinearLinkState): number {
	if (-2 === state.lastCloseAngle) {
		state.lastCloseAngle = text.lastIndexOf(">");
	}
	return state.lastCloseAngle;
}

function getLastCloseParen(text: string, state: LinearLinkState): number {
	if (-2 === state.lastCloseParen) {
		state.lastCloseParen = text.lastIndexOf(")");
	}
	return state.lastCloseParen;
}

/**
 * Builds an exact O(1)-lookup table `bareUrlEnd` for the non-whitespace suffix
 * `[runStart, runEnd)` starting at `runStart = start`.
 *
 * Because `scanLinearUrlEnd` is only invoked after `(` or whitespace
 * (`skipLezerSpaceLocal(text, localStart + 1)`), and every later invocation in the same
 * `InlineContext` satisfies `nextStart >= start + 2` with `text[nextStart - 1] === "("`
 * and `text[nextStart - 2] === "]"`, the backslash-escape parity entering any
 * `nextStart` in `[runStart, runEnd)` is mathematically guaranteed to be
 * `false`. A forward pass records unescaped parenthesis prefix depths, and a
 * single backward pass finds for every index `i` the first `j >= i` where
 * relative depth reaches `-1` (an unescaped `)` at depth 0), or `runEnd`.
 */
function ensureBareUrlRunEnd(
	text: string,
	start: number,
	state: LinearLinkState,
): Int32Array {
	if (
		state.bareUrlEnd &&
		start >= state.bareUrlRunStart &&
		start < state.bareUrlRunEnd
	) {
		return state.bareUrlEnd;
	}
	let runEnd = start;
	while (runEnd < text.length && !isLezerSpaceCode(text.charCodeAt(runEnd))) {
		runEnd += 1;
	}
	const runLen = runEnd - start;
	const prefixDepth = new Int32Array(runLen + 1);
	let depth = 0;
	let minDepth = 0;
	let maxDepth = 0;
	let escaped = false;
	for (let i = 0; i < runLen; i += 1) {
		const ch = text.charCodeAt(start + i);
		if (escaped) {
			escaped = false;
		} else if (40 /* ( */ === ch) {
			depth += 1;
			if (depth > maxDepth) maxDepth = depth;
		} else if (41 /* ) */ === ch) {
			depth -= 1;
			if (depth < minDepth) minDepth = depth;
		} else if (92 /* \ */ === ch) {
			escaped = true;
		}
		prefixDepth[i + 1] = depth;
	}
	const shift = 1 - minDepth;
	const nextCloseAtDepth = new Int32Array(maxDepth - minDepth + 2);
	nextCloseAtDepth.fill(runEnd);
	const bareUrlEnd = new Int32Array(runLen);
	for (let i = runLen - 1; i >= 0; i -= 1) {
		const nextD = prefixDepth[i + 1] ?? 0;
		const curD = prefixDepth[i] ?? 0;
		if (nextD < curD) {
			nextCloseAtDepth[nextD + shift] = start + i;
		}
		bareUrlEnd[i] = nextCloseAtDepth[curD - 1 + shift] ?? runEnd;
	}
	state.bareUrlRunStart = start;
	state.bareUrlRunEnd = runEnd;
	state.bareUrlEnd = bareUrlEnd;
	return bareUrlEnd;
}

function findUnescapedCloseCached(
	text: string,
	start: number,
	targetCode: number,
	cache: CloseScanCache,
	rejectCode: number = -1,
): number {
	const scanStart = start + 1;
	if (
		rejectCode < 0 &&
		cache.scannedFrom >= 0 &&
		scanStart >= cache.scannedFrom &&
		(cache.closeAt < 0 || scanStart <= cache.closeAt)
	) {
		return cache.closeAt;
	}
	if (
		rejectCode >= 0 &&
		cache.scannedFrom >= 0 &&
		scanStart >= cache.scannedFrom &&
		cache.closeAt < 0
	) {
		return -1;
	}
	let closeAt = -1;
	let rejectedAt = -1;
	for (let pos = scanStart, escaped = false; pos < text.length; pos += 1) {
		const ch = text.charCodeAt(pos);
		if (escaped) {
			escaped = false;
		} else if (ch === targetCode) {
			closeAt = pos;
			break;
		} else if (ch === rejectCode) {
			rejectedAt = pos;
			break;
		} else if (92 /* \ */ === ch) {
			escaped = true;
		}
	}
	if (rejectedAt < 0) {
		cache.scannedFrom = scanStart;
		cache.closeAt = closeAt;
	}
	return closeAt;
}

/**
 * Returns the local end offset (`> start`) of a link destination starting at
 * `start`, or `-1` if no destination starts at `start`.
 */
function scanLinearUrlEnd(
	text: string,
	start: number,
	state: LinearLinkState,
): number {
	if (start >= text.length) return -1;
	if (60 /* < */ === text.charCodeAt(start)) {
		if (start >= getLastCloseAngle(text, state)) return -1;
		for (let pos = start + 1; pos < text.length; pos += 1) {
			const ch = text.charCodeAt(pos);
			if (62 /* > */ === ch) return pos + 1;
			if (60 /* < */ === ch || 10 /* \n */ === ch) return -1;
		}
		return -1;
	}

	if (
		state.bareUrlEnd &&
		start >= state.bareUrlRunStart &&
		start < state.bareUrlRunEnd
	) {
		const end = state.bareUrlEnd[start - state.bareUrlRunStart] ?? start;
		return end > start ? end : -1;
	}

	let depth = 0;
	let pos = start;
	const fastLimit = Math.min(text.length, start + BARE_URL_FAST_SCAN_LIMIT);
	for (let escaped = false; pos < fastLimit; pos += 1) {
		const ch = text.charCodeAt(pos);
		if (isLezerSpaceCode(ch)) {
			return pos > start ? pos : -1;
		}
		if (escaped) {
			escaped = false;
		} else if (40 /* ( */ === ch) {
			depth += 1;
		} else if (41 /* ) */ === ch) {
			if (0 === depth) {
				return pos > start ? pos : -1;
			}
			depth -= 1;
		} else if (92 /* \ */ === ch) {
			escaped = true;
		}
	}
	if (pos >= text.length) {
		return pos > start ? pos : -1;
	}
	const bareUrlEnd = ensureBareUrlRunEnd(text, start, state);
	const end = bareUrlEnd[start - state.bareUrlRunStart] ?? start;
	return end > start ? end : -1;
}

function scanLinearTitleEnd(
	text: string,
	start: number,
	state: LinearLinkState,
	rejectUnescapedOpenParenInTitle: boolean,
): number {
	if (start >= text.length) return -1;
	const quote = text.charCodeAt(start);
	let closeAt: number;
	if (39 /* ' */ === quote) {
		closeAt = findUnescapedCloseCached(text, start, 39, state.closeSingleQuote);
	} else if (34 /* " */ === quote) {
		closeAt = findUnescapedCloseCached(text, start, 34, state.closeDoubleQuote);
	} else if (40 /* ( */ === quote) {
		closeAt = findUnescapedCloseCached(
			text,
			start,
			41,
			state.closeParenTitle,
			rejectUnescapedOpenParenInTitle ? 40 : -1,
		);
	} else {
		return -1;
	}
	return closeAt >= 0 ? closeAt + 1 : -1;
}

/**
 * Parses a bracketed `[label]` tail after `]`. Intentionally honors
 * CommonMark §4.7 / League CommonMark's 999-character link-label cap
 * (scanning up to `start + 1 + 1000`, i.e., 999 label characters plus `]`).
 */
function scanLinearLabelEnd(text: string, start: number): number {
	const end = Math.min(text.length, start + 1 + 1000);
	for (let escaped = false, pos = start + 1; pos < end; pos += 1) {
		const ch = text.charCodeAt(pos);
		if (escaped) {
			escaped = false;
		} else if (93 /* ] */ === ch) {
			return pos + 1;
		} else if (91 /* [ */ === ch) {
			return -1;
		} else if (92 /* \ */ === ch) {
			escaped = true;
		}
	}
	return -1;
}

function skipLezerSpaceLocal(text: string, pos: number): number {
	while (pos < text.length && isLezerSpaceCode(text.charCodeAt(pos))) {
		pos += 1;
	}
	return pos;
}

function parseLinearLinkTail(
	cx: InlineContext,
	startPos: number,
	state: LinearLinkState,
	rejectUnescapedOpenParenInTitle: boolean,
): LinearLinkTail | null {
	const text = cx.text;
	const offset = cx.offset;
	const localStart = startPos - offset;
	if (localStart >= text.length) return null;
	const next = text.charCodeAt(localStart);
	if (40 /* ( */ === next && localStart < getLastCloseParen(text, state)) {
		let localPos = skipLezerSpaceLocal(text, localStart + 1);
		const destFromLocal = localPos;
		const destToLocal = scanLinearUrlEnd(text, localPos, state);
		let titleFromLocal = -1;
		let titleToLocal = -1;
		if (destToLocal > 0) {
			localPos = skipLezerSpaceLocal(text, destToLocal);
			if (localPos !== destToLocal) {
				const candidateTitleEnd = scanLinearTitleEnd(
					text,
					localPos,
					state,
					rejectUnescapedOpenParenInTitle,
				);
				if (candidateTitleEnd > 0) {
					titleFromLocal = localPos;
					titleToLocal = candidateTitleEnd;
					localPos = skipLezerSpaceLocal(text, candidateTitleEnd);
				}
			}
		}
		if (localPos < text.length && 41 /* ) */ === text.charCodeAt(localPos)) {
			const parenClosePos = localPos + offset;
			return {
				dest:
					destToLocal > 0
						? { from: destFromLocal + offset, to: destToLocal + offset }
						: null,
				endPos: parenClosePos + 1,
				label: null,
				parenClosePos,
				title:
					titleToLocal > 0
						? { from: titleFromLocal + offset, to: titleToLocal + offset }
						: null,
			};
		}
	} else if (91 /* [ */ === next) {
		const labelToLocal = scanLinearLabelEnd(text, localStart);
		if (labelToLocal > 0) {
			const endPos = labelToLocal + offset;
			return {
				dest: null,
				endPos,
				label: { from: startPos, to: endPos },
				parenClosePos: -1,
				title: null,
			};
		}
	}
	return null;
}

function finishLinearLink(
	cx: InlineContext,
	content: Element[],
	typeName: "Image" | "Link",
	start: number,
	startPos: number,
	state: LinearLinkState,
	contentMaxDepth: number,
	rejectUnescapedOpenParenInTitle: boolean,
): Element {
	content.unshift(
		cx.elt("LinkMark", start, start + ("Image" === typeName ? 2 : 1)),
	);
	content.push(cx.elt("LinkMark", startPos - 1, startPos));
	const tail = parseLinearLinkTail(
		cx,
		startPos,
		state,
		rejectUnescapedOpenParenInTitle,
	);
	let endPos = startPos;
	if (tail) {
		endPos = tail.endPos;
		if (tail.parenClosePos >= 0) {
			content.push(cx.elt("LinkMark", startPos, startPos + 1));
			if (tail.dest) content.push(cx.elt("URL", tail.dest.from, tail.dest.to));
			if (tail.title) {
				content.push(cx.elt("LinkTitle", tail.title.from, tail.title.to));
			}
			content.push(cx.elt("LinkMark", tail.parenClosePos, tail.endPos));
		} else if (tail.label) {
			content.push(cx.elt("LinkLabel", tail.label.from, tail.label.to));
		}
	}
	const linkEl = cx.elt(typeName, start, endPos, content);
	setElementDepth(linkEl, Math.max(1, contentMaxDepth) + 1);
	return linkEl;
}

/** O(1) amortized replacement for `InlineContext.hasOpenLink`. */
export function hasOpenLinearLink(cx: InlineContext): boolean {
	const state = peekLinearLinkState(cx);
	if (!state || 0 === state.openIndices.length) return false;
	const parts = asInternalInlineContext(cx).parts;
	const linkStart = InlineContext.linkStart;
	const imageStart = InlineContext.imageStart;
	while (state.openIndices.length > 0) {
		const idx = state.openIndices[state.openIndices.length - 1] ?? -1;
		if (idx >= 0 && idx < parts.length) {
			const part = parts[idx];
			if (
				isInlineDelimiterPart(part) &&
				(part.type === linkStart || part.type === imageStart)
			) {
				return true;
			}
		}
		state.openIndices.pop();
	}
	return false;
}

export function parseLinearLink(
	cx: InlineContext,
	next: number,
	start: number,
): number {
	if (91 /* [ */ !== next) return -1;
	const internal = asInternalInlineContext(cx);
	const idx = internal.parts.length;
	const end = cx.addDelimiter(InlineContext.linkStart, start, start + 1, true, false);
	const state = getLinearLinkState(cx);
	state.openIndices.push(idx);
	state.openLinkIndices.push(idx);
	return end;
}

export function parseLinearImage(
	cx: InlineContext,
	next: number,
	start: number,
): number {
	if (33 /* ! */ !== next || 91 /* [ */ !== cx.char(start + 1)) return -1;
	const internal = asInternalInlineContext(cx);
	const idx = internal.parts.length;
	const end = cx.addDelimiter(InlineContext.imageStart, start, start + 2, true, false);
	const state = getLinearLinkState(cx);
	state.openIndices.push(idx);
	return end;
}

export function createLinearLinkEndParser(
	options: Readonly<{
		onExceededDepth?: (from: number, to: number) => void;
		rejectUnescapedOpenParenInTitle?: boolean;
	}> = {},
): (cx: InlineContext, next: number, start: number) => number {
	const onExceededDepth = options.onExceededDepth ?? NOOP_EXCEEDED_DEPTH;
	const rejectUnescapedOpenParenInTitle =
		options.rejectUnescapedOpenParenInTitle ?? false;
	return function parseLinkEnd(
		cx: InlineContext,
		next: number,
		start: number,
	): number {
		if (93 /* ] */ !== next) return -1;
		const state = peekLinearLinkState(cx);
		if (!state || 0 === state.openIndices.length) return -1;
		const internal = asInternalInlineContext(cx);
		const parts = internal.parts;
		const linkStart = InlineContext.linkStart;
		const imageStart = InlineContext.imageStart;

		let openerIdx = -1;
		let openerPart: LezerInlineDelimiter | null = null;
		while (state.openIndices.length > 0) {
			const candidateIdx = state.openIndices.pop() ?? -1;
			if (candidateIdx < 0 || candidateIdx >= parts.length) continue;
			const candidate = parts[candidateIdx];
			if (
				isInlineDelimiterPart(candidate) &&
				(candidate.type === linkStart || candidate.type === imageStart)
			) {
				openerIdx = candidateIdx;
				openerPart = candidate;
				break;
			}
		}
		if (!openerPart || openerIdx < 0) return -1;

		const isLink = openerPart.type === linkStart;
		const afterChar = cx.char(start + 1);
		if (
			0 === openerPart.side ||
			(cx.skipSpace(openerPart.to) === start &&
				40 !== afterChar &&
				91 !== afterChar)
		) {
			parts[openerIdx] = null;
			return -1;
		}

		if (isLink) {
			while (state.openLinkIndices.length > 0) {
				const linkIdx = state.openLinkIndices.pop() ?? -1;
				if (linkIdx < 0 || linkIdx >= openerIdx || linkIdx >= parts.length) {
					continue;
				}
				const candidate = parts[linkIdx];
				if (isInlineDelimiterPart(candidate) && candidate.type === linkStart) {
					candidate.side = 0;
				}
			}
		}

		const resolved = resolveInlineMarkersLinear(
			internal,
			openerIdx + 1,
			true,
			onExceededDepth,
		);
		if ("flat" === resolved.kind) {
			const tail = parseLinearLinkTail(
				cx,
				start + 1,
				state,
				rejectUnescapedOpenParenInTitle,
			);
			const tailEndPos = tail ? tail.endPos : start + 1;
			onExceededDepth(openerPart.from, tailEndPos);
			parts[openerIdx] = resolved.flatGroup;
			parts.length = openerIdx + 1;
			return tailEndPos;
		}
		parts.length = openerIdx;
		const link = finishLinearLink(
			cx,
			resolved.elements,
			isLink ? "Link" : "Image",
			openerPart.from,
			start + 1,
			state,
			resolved.maxDepth,
			rejectUnescapedOpenParenInTitle,
		);
		parts[openerIdx] = link;
		return link.to;
	};
}
