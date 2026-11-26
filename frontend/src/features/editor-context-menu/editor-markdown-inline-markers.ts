import {
	Element,
	InlineContext,
	type DelimiterType,
	type MarkdownParser,
} from "@lezer/markdown";

export const MAX_LEZER_INLINE_DEPTH = 100;

type InternalInlineParserFn = (
	cx: InlineContext,
	next: number,
	pos: number,
) => number;

type InternalMarkdownParser = MarkdownParser & {
	inlineNames?: ReadonlyArray<string>;
	inlineParsers: ReadonlyArray<InternalInlineParserFn | null>;
};

function addTriggerChars(
	buckets: Array<InternalInlineParserFn[]>,
	codes: ReadonlyArray<number>,
	fn: InternalInlineParserFn,
): void {
	for (const code of codes) {
		buckets[code]?.push(fn);
	}
}

const KNOWN_INLINE_TRIGGER_CODES: Readonly<Record<string, ReadonlyArray<number>>> = {
	Emphasis: [42 /* * */, 95 /* _ */],
	Entity: [38 /* & */],
	Escape: [92 /* \ */],
	HardBreak: [32 /* space */, 92 /* \ */],
	HTMLTag: [60 /* < */],
	Image: [33 /* ! */],
	InlineCode: [96 /* ` */],
	Link: [91 /* [ */],
	LinkEnd: [93 /* ] */],
	Strikethrough: [126 /* ~ */],
};

function buildInlineDispatchTables(
	names: ReadonlyArray<string> | undefined,
	parsers: ReadonlyArray<InternalInlineParserFn | null>,
): Readonly<{
	noAt: ReadonlyArray<ReadonlyArray<InternalInlineParserFn> | null>;
	withAt: ReadonlyArray<ReadonlyArray<InternalInlineParserFn> | null>;
}> | null {
	if (!names || names.length !== parsers.length) return null;
	const noAtBuckets: Array<InternalInlineParserFn[]> = Array.from(
		{ length: 128 },
		() => [],
	);
	const withAtBuckets: Array<InternalInlineParserFn[]> = Array.from(
		{ length: 128 },
		() => [],
	);
	const emailStartCodes: number[] = [43 /* + */, 45 /* - */, 46 /* . */, 95 /* _ */];
	for (let c = 48; c <= 57; c += 1) emailStartCodes.push(c);
	for (let c = 65; c <= 90; c += 1) emailStartCodes.push(c);
	for (let c = 97; c <= 122; c += 1) emailStartCodes.push(c);

	for (let i = 0; i < parsers.length; i += 1) {
		const fn = parsers[i];
		if (!fn) continue;
		const name = names[i];
		if (!name) return null;
		if ("Autolink" === name) {
			addTriggerChars(noAtBuckets, [104 /* h */, 119 /* w */], fn);
			addTriggerChars(withAtBuckets, emailStartCodes, fn);
			continue;
		}
		const triggers = KNOWN_INLINE_TRIGGER_CODES[name];
		if (!triggers) return null;
		addTriggerChars(noAtBuckets, triggers, fn);
		addTriggerChars(withAtBuckets, triggers, fn);
	}
	return {
		noAt: noAtBuckets.map((list) => (list.length > 0 ? list : null)),
		withAt: withAtBuckets.map((list) => (list.length > 0 ? list : null)),
	};
}

type InlineContextConstructor = new (
	parser: MarkdownParser,
	text: string,
	offset: number,
) => InlineContext;

const InlineContextCtor = InlineContext as unknown as InlineContextConstructor;
const NOOP_EXCEEDED_DEPTH = (_from: number, _to: number): void => {};

const FLAT_GROUP_SYMBOL = Symbol("easymdeFlatElementGroup");
const ELEMENT_DEPTH_SYMBOL = Symbol("easymdeElementDepth");

type ElementWithDepth = Element & {
	[ELEMENT_DEPTH_SYMBOL]?: number;
};

export type LezerInlineDelimiter = {
	from: number;
	side: number;
	to: number;
	type: DelimiterType;
};

type InternalInlineContext = InlineContext & {
	parts: unknown[];
};

type FlatEltLink = {
	elt: Element;
	next: FlatEltLink | null;
};

type FlatElementGroup = {
	[FLAT_GROUP_SYMBOL]: true;
	depth: number;
	head: FlatEltLink | null;
	tail: FlatEltLink | null;
};

type StreamNode = StreamEltNode | StreamFlatNode | StreamDelimNode;

type StreamEltNode = {
	depth: number;
	elt: Element;
	kind: "elt";
	next: StreamNode | null;
	prev: StreamNode | null;
};

type StreamFlatNode = {
	group: FlatElementGroup;
	kind: "flat";
	next: StreamNode | null;
	prev: StreamNode | null;
};

type StreamDelimNode = {
	bucketIdx: number;
	from: number;
	inOpenerList: boolean;
	isEmphasis: boolean;
	kind: "delim";
	next: StreamNode | null;
	openerNext: StreamDelimNode | null;
	openerPrev: StreamDelimNode | null;
	order: number;
	prev: StreamNode | null;
	side: number;
	to: number;
	type: DelimiterType;
};

type MarkerResolutionResult =
	| Readonly<{
			flatGroup: FlatElementGroup;
			kind: "flat";
			maxDepth: number;
	  }>
	| Readonly<{
			elements: Element[];
			kind: "elements";
			maxDepth: number;
	  }>;

export function asInternalInlineContext(
	cx: InlineContext,
): InternalInlineContext {
	return cx as InternalInlineContext;
}

function getElementDepth(elt: Element): number {
	return (elt as ElementWithDepth)[ELEMENT_DEPTH_SYMBOL] ?? 1;
}

export function setElementDepth(elt: Element, depth: number): void {
	(elt as ElementWithDepth)[ELEMENT_DEPTH_SYMBOL] = depth;
}

function isFlatElementGroup(value: unknown): value is FlatElementGroup {
	return (
		null !== value &&
		"object" === typeof value &&
		FLAT_GROUP_SYMBOL in value
	);
}

function createFlatGroup(depth: number): FlatElementGroup {
	return { [FLAT_GROUP_SYMBOL]: true, depth, head: null, tail: null };
}

function appendElementToFlatGroup(group: FlatElementGroup, elt: Element): void {
	const link: FlatEltLink = { elt, next: null };
	if (null === group.tail) {
		group.head = link;
		group.tail = link;
	} else {
		group.tail.next = link;
		group.tail = link;
	}
}

function appendFlatGroupToFlatGroup(
	target: FlatElementGroup,
	source: FlatElementGroup,
): void {
	if (null === source.head) return;
	if (null === target.tail) {
		target.head = source.head;
		target.tail = source.tail;
	} else {
		target.tail.next = source.head;
		target.tail = source.tail;
	}
	if (source.depth > target.depth) target.depth = source.depth;
}

function flattenGroupInto(group: FlatElementGroup, out: Element[]): void {
	let cur = group.head;
	while (null !== cur) {
		out.push(cur.elt);
		cur = cur.next;
	}
}

export function isInlineDelimiterPart(
	part: unknown,
): part is LezerInlineDelimiter {
	if (
		null === part ||
		"object" !== typeof part ||
		part instanceof Element ||
		isFlatElementGroup(part)
	) {
		return false;
	}
	const candidate = part as Partial<LezerInlineDelimiter>;
	return (
		null !== candidate.type &&
		"object" === typeof candidate.type &&
		"number" === typeof candidate.from &&
		"number" === typeof candidate.to &&
		"number" === typeof candidate.side
	);
}

/**
 * Strictly O(N) linear, depth-bounded inline delimiter resolver matching
 * `@lezer/markdown`'s `InlineContext.resolveMarkers` AST output for all
 * subtrees of depth `<= MAX_LEZER_INLINE_DEPTH` (100).
 *
 * Uses a doubly-linked stream plus 6 O(1) Rule-9/10 opener buckets per
 * emphasis delimiter type (and 1 O(1) opener stack per non-emphasis type).
 * Subtrees that would exceed `MAX_LEZER_INLINE_DEPTH` are flattened in O(1)
 * via a linked `FlatElementGroup` and reported through `onExceededDepth`.
 */
export function resolveInlineMarkersLinear(
	cx: InternalInlineContext,
	fromIndex: number,
	collectFlatGroupOnly: false,
	onExceededDepth: (from: number, to: number) => void,
): Extract<MarkerResolutionResult, { kind: "elements" }>;
export function resolveInlineMarkersLinear(
	cx: InternalInlineContext,
	fromIndex: number,
	collectFlatGroupOnly: true,
	onExceededDepth: (from: number, to: number) => void,
): MarkerResolutionResult;
export function resolveInlineMarkersLinear(
	cx: InternalInlineContext,
	fromIndex: number,
	collectFlatGroupOnly: boolean,
	onExceededDepth: (from: number, to: number) => void,
): MarkerResolutionResult {
	const parts = cx.parts;
	if (fromIndex >= parts.length) {
		return { elements: [], kind: "elements", maxDepth: 0 };
	}

	let hasDelimiter = false;
	let hasFlatGroup = false;
	for (let i = fromIndex; i < parts.length; i += 1) {
		const part = parts[i];
		if (null === part || undefined === part || part instanceof Element) {
			continue;
		}
		if (isFlatElementGroup(part)) {
			hasFlatGroup = true;
		} else if (isInlineDelimiterPart(part) && part.type.resolve) {
			hasDelimiter = true;
			break;
		}
	}
	if (!hasDelimiter && !hasFlatGroup) {
		const elements: Element[] = [];
		let maxDepth = 0;
		for (let i = fromIndex; i < parts.length; i += 1) {
			const part = parts[i];
			if (part instanceof Element) {
				const depth = getElementDepth(part);
				if (depth > maxDepth) maxDepth = depth;
				elements.push(part);
			}
		}
		if (collectFlatGroupOnly && maxDepth >= MAX_LEZER_INLINE_DEPTH) {
			const combined = createFlatGroup(MAX_LEZER_INLINE_DEPTH);
			for (let i = 0; i < elements.length; i += 1) {
				const elt = elements[i];
				if (elt) appendElementToFlatGroup(combined, elt);
			}
			return { flatGroup: combined, kind: "flat", maxDepth };
		}
		return { elements, kind: "elements", maxDepth };
	}

	const stream: { head: StreamNode | null; tail: StreamNode | null } = {
		head: null,
		tail: null,
	};
	let order = 0;

	const appendStream = (node: StreamNode): void => {
		node.prev = stream.tail;
		node.next = null;
		if (null === stream.tail) stream.head = node;
		else stream.tail.next = node;
		stream.tail = node;
	};

	const removeStream = (node: StreamNode): void => {
		if (node.prev) node.prev.next = node.next;
		else stream.head = node.next;
		if (node.next) node.next.prev = node.prev;
		else stream.tail = node.prev;
		node.prev = null;
		node.next = null;
	};

	const insertBeforeStream = (target: StreamNode, node: StreamNode): void => {
		node.prev = target.prev;
		node.next = target;
		if (target.prev) target.prev.next = node;
		else stream.head = node;
		target.prev = node;
	};

	for (let i = fromIndex; i < parts.length; i += 1) {
		const part = parts[i];
		if (null === part || undefined === part) continue;
		if (isFlatElementGroup(part)) {
			appendStream({ group: part, kind: "flat", next: null, prev: null });
			continue;
		}
		if (part instanceof Element) {
			appendStream({
				depth: getElementDepth(part),
				elt: part,
				kind: "elt",
				next: null,
				prev: null,
			});
			continue;
		}
		if (isInlineDelimiterPart(part) && part.type.resolve) {
			appendStream({
				bucketIdx: -1,
				from: part.from,
				inOpenerList: false,
				isEmphasis: "Emphasis" === part.type.resolve,
				kind: "delim",
				next: null,
				openerNext: null,
				openerPrev: null,
				order,
				prev: null,
				side: part.side,
				to: part.to,
				type: part.type,
			});
			order += 1;
		}
	}

	const emphasisBuckets = new Map<DelimiterType, Array<StreamDelimNode | null>>();
	const genericOpeners = new Map<DelimiterType, StreamDelimNode | null>();

	const getEmphasisBuckets = (
		type: DelimiterType,
	): Array<StreamDelimNode | null> => {
		let buckets = emphasisBuckets.get(type);
		if (!buckets) {
			buckets = [null, null, null, null, null, null];
			emphasisBuckets.set(type, buckets);
		}
		return buckets;
	};

	const emphasisBucketIndex = (node: StreamDelimNode): number =>
		(0 !== (node.side & 2) ? 3 : 0) + ((node.to - node.from) % 3);

	const pushOpener = (node: StreamDelimNode): void => {
		if (0 === (node.side & 1) || node.inOpenerList) return;
		node.inOpenerList = true;
		if (node.isEmphasis) {
			const buckets = getEmphasisBuckets(node.type);
			const idx = emphasisBucketIndex(node);
			node.bucketIdx = idx;
			const top = buckets[idx] ?? null;
			node.openerPrev = top;
			node.openerNext = null;
			if (top) top.openerNext = node;
			buckets[idx] = node;
		} else {
			const top = genericOpeners.get(node.type) ?? null;
			node.openerPrev = top;
			node.openerNext = null;
			if (top) top.openerNext = node;
			genericOpeners.set(node.type, node);
		}
	};

	const unlinkOpener = (node: StreamDelimNode): void => {
		if (!node.inOpenerList) return;
		node.inOpenerList = false;
		if (node.openerPrev) node.openerPrev.openerNext = node.openerNext;
		if (node.openerNext) {
			node.openerNext.openerPrev = node.openerPrev;
		} else if (node.isEmphasis) {
			const buckets = emphasisBuckets.get(node.type);
			if (buckets && node.bucketIdx >= 0) {
				buckets[node.bucketIdx] = node.openerPrev;
			}
		} else {
			genericOpeners.set(node.type, node.openerPrev);
		}
		node.openerPrev = null;
		node.openerNext = null;
		node.bucketIdx = -1;
	};

	const findMatchingOpener = (close: StreamDelimNode): StreamDelimNode | null => {
		if (!close.isEmphasis) {
			return genericOpeners.get(close.type) ?? null;
		}
		const buckets = emphasisBuckets.get(close.type);
		if (!buckets) return null;
		const closeCanOpen = 0 !== (close.side & 1);
		const closeMod = (close.to - close.from) % 3;
		let best: StreamDelimNode | null = null;
		for (let b = 0; b < 6; b += 1) {
			const candidate = buckets[b];
			if (!candidate) continue;
			const openCanClose = b >= 3;
			if (closeCanOpen || openCanClose) {
				const openMod = b % 3;
				if (0 === (openMod + closeMod) % 3 && (0 !== openMod || 0 !== closeMod)) {
					continue;
				}
			}
			if (null === best || candidate.order > best.order) {
				best = candidate;
			}
		}
		return best;
	};

	let cursor: StreamNode | null = stream.head;
	while (null !== cursor) {
		if ("delim" !== cursor.kind) {
			cursor = cursor.next;
			continue;
		}
		if (0 === (cursor.side & 2)) {
			pushOpener(cursor);
			cursor = cursor.next;
			continue;
		}
		const open = findMatchingOpener(cursor);
		if (null === open) {
			pushOpener(cursor);
			cursor = cursor.next;
			continue;
		}

		const close = cursor;
		const emp = close.isEmphasis;
		let start = open.from;
		let end = close.to;
		let resolveName = close.type.resolve ?? "Emphasis";
		if (emp) {
			const size = Math.min(2, open.to - open.from, close.to - close.from);
			start = open.to - size;
			end = close.from + size;
			resolveName = 1 === size ? "Emphasis" : "StrongEmphasis";
		}

		let maxChildDepth = 0;
		let scan = open.next;
		while (null !== scan && scan !== close) {
			if ("elt" === scan.kind) {
				if (scan.depth > maxChildDepth) maxChildDepth = scan.depth;
			} else if ("flat" === scan.kind) {
				if (scan.group.depth > maxChildDepth) maxChildDepth = scan.group.depth;
			}
			scan = scan.next;
		}

		let replacement: StreamEltNode | StreamFlatNode;
		if (maxChildDepth >= MAX_LEZER_INLINE_DEPTH) {
			onExceededDepth(start, end);
			const flat = createFlatGroup(MAX_LEZER_INLINE_DEPTH);
			if (open.type.mark) {
				appendElementToFlatGroup(flat, cx.elt(open.type.mark, start, open.to));
			}
			let inner = open.next;
			while (null !== inner && inner !== close) {
				const nextInner = inner.next;
				if ("delim" === inner.kind) {
					unlinkOpener(inner);
				} else if ("elt" === inner.kind) {
					appendElementToFlatGroup(flat, inner.elt);
				} else {
					appendFlatGroupToFlatGroup(flat, inner.group);
				}
				removeStream(inner);
				inner = nextInner;
			}
			if (close.type.mark) {
				appendElementToFlatGroup(flat, cx.elt(close.type.mark, close.from, end));
			}
			replacement = { group: flat, kind: "flat", next: null, prev: null };
		} else {
			const content: Element[] = [];
			if (open.type.mark) {
				content.push(cx.elt(open.type.mark, start, open.to));
			}
			let inner = open.next;
			while (null !== inner && inner !== close) {
				const nextInner = inner.next;
				if ("delim" === inner.kind) {
					unlinkOpener(inner);
				} else if ("elt" === inner.kind) {
					content.push(inner.elt);
				}
				removeStream(inner);
				inner = nextInner;
			}
			if (close.type.mark) {
				content.push(cx.elt(close.type.mark, close.from, end));
			}
			const el = cx.elt(resolveName, start, end, content);
			const nextDepth = Math.max(1, maxChildDepth) + 1;
			setElementDepth(el, nextDepth);
			replacement = {
				depth: nextDepth,
				elt: el,
				kind: "elt",
				next: null,
				prev: null,
			};
		}

		unlinkOpener(open);
		if (emp && open.from !== start) {
			open.to = start;
			pushOpener(open);
		} else {
			removeStream(open);
		}

		if (emp && close.to !== end) {
			close.from = end;
			insertBeforeStream(close, replacement);
		} else {
			const nextCursor = close.next;
			insertBeforeStream(close, replacement);
			removeStream(close);
			cursor = nextCursor;
		}
	}

	let maxDepth = 0;
	for (
		let node: StreamNode | null = stream.head;
		null !== node;
		node = node.next
	) {
		if ("elt" === node.kind && node.depth > maxDepth) maxDepth = node.depth;
		else if ("flat" === node.kind && node.group.depth > maxDepth) {
			maxDepth = node.group.depth;
		}
	}

	if (collectFlatGroupOnly && maxDepth >= MAX_LEZER_INLINE_DEPTH) {
		const combined = createFlatGroup(MAX_LEZER_INLINE_DEPTH);
		for (
			let node: StreamNode | null = stream.head;
			null !== node;
			node = node.next
		) {
			if ("elt" === node.kind) appendElementToFlatGroup(combined, node.elt);
			else if ("flat" === node.kind) appendFlatGroupToFlatGroup(combined, node.group);
		}
		return { flatGroup: combined, kind: "flat", maxDepth };
	}

	const elements: Element[] = [];
	for (
		let node: StreamNode | null = stream.head;
		null !== node;
		node = node.next
	) {
		if ("elt" === node.kind) elements.push(node.elt);
		else if ("flat" === node.kind) flattenGroupInto(node.group, elements);
	}
	return { elements, kind: "elements", maxDepth };
}

/**
 * Installs a strictly O(N) linear, depth-bounded `parseInline` method on a
 * private `MarkdownParser` instance (never mutating `MarkdownParser.prototype`
 * or shared `markdownLanguage.parser`), replacing `@lezer/markdown`'s
 * quadratic/recursive `InlineContext.resolveMarkers`.
 */
export function installLinearInlineResolver(
	parser: MarkdownParser,
	onExceededDepth: (from: number, to: number) => void = NOOP_EXCEEDED_DEPTH,
): MarkdownParser {
	const internal = parser as InternalMarkdownParser;
	const dispatch = buildInlineDispatchTables(
		internal.inlineNames,
		internal.inlineParsers,
	);
	internal.parseInline = function parseLinearInline(
		this: InternalMarkdownParser,
		text: string,
		offset: number,
	): Element[] {
		const cx = asInternalInlineContext(new InlineContextCtor(this, text, offset));
		const end = cx.end;
		if (dispatch) {
			const table = text.includes("@") ? dispatch.withAt : dispatch.noAt;
			outerFast: for (let pos = offset; pos < end; ) {
				const next = text.charCodeAt(pos - offset);
				if (next < 128) {
					const handlers = table[next];
					if (handlers) {
						for (let i = 0; i < handlers.length; i += 1) {
							const token = handlers[i];
							if (token) {
								const result = token(cx, next, pos);
								if (result >= 0) {
									pos = result;
									continue outerFast;
								}
							}
						}
					}
				}
				pos += 1;
			}
		} else {
			const parsers = this.inlineParsers;
			outer: for (let pos = offset; pos < end; ) {
				const next = cx.char(pos);
				for (let i = 0; i < parsers.length; i += 1) {
					const token = parsers[i];
					if (token) {
						const result = token(cx, next, pos);
						if (result >= 0) {
							pos = result;
							continue outer;
						}
					}
				}
				pos += 1;
			}
		}
		return resolveInlineMarkersLinear(cx, 0, false, onExceededDepth).elements;
	};
	return parser;
}
