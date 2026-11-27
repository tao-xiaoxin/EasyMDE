import { isLeagueUnicodeWhitespaceCode } from "../../shared/markdown/markdown-char-codes";

export const BIT_STRONG = 1;
export const BIT_EMPHASIS = 2;
export const BIT_STRIKETHROUGH = 4;

export const MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK = 1_000;

const UNICODE_PUNCTUATION_CHAR = /^[\p{P}\p{S}]/u;

export type DelimiterNode = {
	canClose: boolean;
	canOpen: boolean;
	char: "*" | "_" | "~";
	consumedStart: number;
	index: number;
	length: number;
	next: DelimiterNode | null;
	origLength: number;
	prev: DelimiterNode | null;
	start: number;
};

export type DelimiterStackState = {
	head: DelimiterNode | null;
	nextIndex: number;
	tail: DelimiterNode | null;
};

export type DelimiterResolvedKind = "emph" | "strike" | "strong";

export type DelimiterMatchCallback = (
	kind: DelimiterResolvedKind,
	openDelimFrom: number,
	openDelimTo: number,
	spanFrom: number,
	spanTo: number,
	closeDelimFrom: number,
	closeDelimTo: number,
) => void;

type InlineMaskDiffs = Readonly<{
	emph: Int32Array;
	strike: Int32Array;
	strong: Int32Array;
}>;

export function prevCodePointChar(text: string, offset: number): string {
	if (offset <= 0) return "\n";
	const prev = text.charCodeAt(offset - 1);
	if (prev >= 0xdc00 && prev <= 0xdfff && offset >= 2) {
		const high = text.charCodeAt(offset - 2);
		if (high >= 0xd800 && high <= 0xdbff) {
			return String.fromCodePoint(text.codePointAt(offset - 2) ?? 10);
		}
	}
	return text[offset - 1] ?? "\n";
}

export function nextCodePointChar(text: string, offset: number): string {
	if (offset >= text.length) return "\n";
	return String.fromCodePoint(text.codePointAt(offset) ?? 10);
}

export function determineCanOpenOrClose(
	charBefore: string,
	charAfter: string,
	ch: "*" | "_" | "~",
): Readonly<{ canClose: boolean; canOpen: boolean }> {
	const afterWs = isLeagueUnicodeWhitespaceCode(charAfter.codePointAt(0) ?? 10);
	const afterPunct = UNICODE_PUNCTUATION_CHAR.test(charAfter);
	const beforeWs = isLeagueUnicodeWhitespaceCode(
		charBefore.codePointAt(0) ?? 10,
	);
	const beforePunct = UNICODE_PUNCTUATION_CHAR.test(charBefore);
	const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
	const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
	if ("_" === ch) {
		return {
			canClose: rightFlanking && (!leftFlanking || afterPunct),
			canOpen: leftFlanking && (!rightFlanking || beforePunct),
		};
	}
	return { canClose: rightFlanking, canOpen: leftFlanking };
}

export function createMaskDiffs(size: number): InlineMaskDiffs {
	return {
		emph: new Int32Array(size + 1),
		strike: new Int32Array(size + 1),
		strong: new Int32Array(size + 1),
	};
}

export function addDiffRange(diff: Int32Array, from: number, to: number): void {
	const start = Math.max(0, from);
	const end = Math.min(diff.length - 1, to);
	if (start >= end) return;
	diff[start] = (diff[start] ?? 0) + 1;
	diff[end] = (diff[end] ?? 0) - 1;
}

export function applyMaskDiffs(
	masks: Uint8Array,
	diffs: InlineMaskDiffs,
): void {
	let strongActive = 0;
	let emphActive = 0;
	let strikeActive = 0;
	for (let i = 0; i < masks.length; i += 1) {
		strongActive += diffs.strong[i] ?? 0;
		emphActive += diffs.emph[i] ?? 0;
		strikeActive += diffs.strike[i] ?? 0;
		const bits =
			(strongActive > 0 ? BIT_STRONG : 0) |
			(emphActive > 0 ? BIT_EMPHASIS : 0) |
			(strikeActive > 0 ? BIT_STRIKETHROUGH : 0);
		if (0 !== bits) masks[i] = (masks[i] ?? 0) | bits;
	}
}

export function createDelimiterStack(): DelimiterStackState {
	return { head: null, nextIndex: 0, tail: null };
}

export function pushDelimiterRun(
	stack: DelimiterStackState,
	char: "*" | "_" | "~",
	start: number,
	length: number,
	canOpen: boolean,
	canClose: boolean,
): DelimiterNode {
	const node: DelimiterNode = {
		canClose,
		canOpen,
		char,
		consumedStart: start,
		index: stack.nextIndex,
		length,
		next: null,
		origLength: length,
		prev: stack.tail,
		start,
	};
	stack.nextIndex += 1;
	if (null === stack.tail) stack.head = node;
	else stack.tail.next = node;
	stack.tail = node;
	return node;
}

function removeDelimiterNode(
	stack: DelimiterStackState,
	node: DelimiterNode,
): void {
	if (node.prev) node.prev.next = node.next;
	else stack.head = node.next;
	if (node.next) node.next.prev = node.prev;
	else stack.tail = node.prev;
	node.prev = null;
	node.next = null;
}

function getDelimiterUse(opener: DelimiterNode, closer: DelimiterNode): number {
	if ("~" === opener.char) {
		return opener.length <= 2 && opener.length === closer.length
			? opener.length
			: 0;
	}
	// CommonMark §6.2 Rules 9 & 10 ("multiple of 3" rule for internal runs).
	if (
		(opener.canClose || closer.canOpen) &&
		closer.origLength % 3 !== 0 &&
		(opener.origLength + closer.origLength) % 3 === 0
	) {
		return 0;
	}
	return opener.length >= 2 && closer.length >= 2 ? 2 : 1;
}

/**
 * Removes every delimiter node strictly above `stackBottom` (`null` clears the
 * entire stack) without emitting emphasis/strong spans (used for image alt
 * text where inner delimiters must not pair outside the image).
 */
export function removeDelimitersAbove(
	stack: DelimiterStackState,
	stackBottom: DelimiterNode | null,
): void {
	let remaining = null === stackBottom ? stack.head : stackBottom.next;
	while (null !== remaining) {
		const next = remaining.next;
		removeDelimiterNode(stack, remaining);
		remaining = next;
	}
}

/**
 * Resolves all emphasis/strong/strikethrough delimiters strictly above
 * `stackBottom` (`null` for the full segment stack) and removes all remaining
 * delimiters above `stackBottom`, matching League `DelimiterStack::processDelimiters`.
 */
export function processDelimiterListFrom(
	stack: DelimiterStackState,
	stackBottom: DelimiterNode | null,
	onMatch: DelimiterMatchCallback,
): void {
	let closer = null === stackBottom ? stack.head : stackBottom.next;
	if (null === closer) return;

	const minOpenerIndex = null === stackBottom ? 0 : stackBottom.index + 1;
	const openersBottom = new Map<string, number>();

	while (null !== closer) {
		if (!closer.canClose) {
			closer = closer.next;
			continue;
		}
		const cacheKey =
			"~" === closer.char
				? `~${closer.length}`
				: `${closer.char}-${closer.canOpen ? "o" : "x"}-${closer.origLength % 3}-${Math.min(2, closer.length)}`;
		const bottomIndex = openersBottom.get(cacheKey) ?? minOpenerIndex;
		let useDelims = 0;
		let potentialOpener = false;
		let opener = closer.prev;
		while (
			null !== opener &&
			opener !== stackBottom &&
			opener.index >= bottomIndex
		) {
			if (opener.canOpen && opener.char === closer.char) {
				potentialOpener = true;
				useDelims = getDelimiterUse(opener, closer);
				if (useDelims > 0) break;
			}
			opener = opener.prev;
		}
		if (0 === useDelims || null === opener) {
			openersBottom.set(cacheKey, closer.index);
			const next = closer.next;
			if (!potentialOpener && !closer.canOpen) {
				removeDelimiterNode(stack, closer);
			}
			closer = next;
			continue;
		}
		const kind: DelimiterResolvedKind =
			"~" === opener.char ? "strike" : 2 === useDelims ? "strong" : "emph";
		const openDelimTo = opener.start + opener.length;
		const openDelimFrom = openDelimTo - useDelims;
		const closeDelimFrom = closer.consumedStart;
		const closeDelimTo = closeDelimFrom + useDelims;
		onMatch(
			kind,
			openDelimFrom,
			openDelimTo,
			openDelimTo,
			closeDelimFrom,
			closeDelimFrom,
			closeDelimTo,
		);
		opener.length -= useDelims;
		closer.consumedStart = closeDelimTo;
		closer.length -= useDelims;
		let between = closer.prev;
		while (null !== between && between !== opener) {
			const prev = between.prev;
			removeDelimiterNode(stack, between);
			between = prev;
		}
		if (0 === opener.length) removeDelimiterNode(stack, opener);
		if (0 === closer.length) {
			const next = closer.next;
			removeDelimiterNode(stack, closer);
			closer = next;
		}
	}

	removeDelimitersAbove(stack, stackBottom);
}
