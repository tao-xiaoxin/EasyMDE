import {
	compactUnmaskedSliceWithMap,
	firstRangeEndingAfter,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import {
	DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
	formatShorthandRawLabel,
	isValidCommonMarkLinkLabel,
	normalizeBoldReferenceLabel,
	scanBracketLabelRange,
	scanInlineLinkTail,
} from "./editor-markdown-link-primitives";
import {
	canonicalizeUnsupportedReferenceLabel,
	type ReferenceLabelCaseFoldProfile,
	type UnsupportedNonAsciiReferenceInfo,
} from "./reference-label-normalization";

export type CommonMarkResolvedBinding = Readonly<{
	closeBracketOffset: number;
	collapsedEmptyCloseOffset: number | null;
	form: "collapsed" | "full" | "inline" | "shortcut";
	from: number;
	key: string;
	kind: "image" | "link";
	labelFrom: number;
	labelTo: number;
	rawLabel: string;
	refFrom: number | null;
	refTo: number | null;
	to: number;
}>;

export type CommonMarkCloseBracketOutcome<TDelimiter = null> =
	| Readonly<{
			binding: CommonMarkResolvedBinding;
			kind: "matched";
			nextPos: number;
			openerDelimiter: TDelimiter;
	  }>
	| Readonly<{ kind: "none" }>
	| Readonly<{ kind: "unverifiable" }>;

export type CommonMarkBracketResolver<TDelimiter = null> = Readonly<{
	getBindings: () => CommonMarkResolvedBinding[];
	pushImageOpener: (from: number, openerDelimiter: TDelimiter) => void;
	pushLinkOpener: (from: number, openerDelimiter: TDelimiter) => void;
	resolveCloseBracket: (
		closePos: number,
	) => CommonMarkCloseBracketOutcome<TDelimiter>;
}>;

type BracketOpener<TDelimiter> = {
	active: boolean;
	from: number;
	kind: "image" | "link";
	labelFrom: number;
	openerDelimiter: TDelimiter;
};

type ReferenceLookupResult =
	| Readonly<{ key: string; kind: "match" }>
	| Readonly<{ kind: "none" }>
	| Readonly<{ kind: "unverifiable" }>;

export function stripQuoteMarksWithMap(
	text: string,
	rangeFrom: number,
	rangeTo: number,
	quoteMarks: ReadonlyArray<SourceRange> | undefined,
): Readonly<{
	cleanText: string;
	cleanToOrig: Int32Array | null;
}> {
	if (!quoteMarks || 0 === quoteMarks.length) {
		return { cleanText: text, cleanToOrig: null };
	}
	const firstMarkIdx = firstRangeEndingAfter(quoteMarks, rangeFrom);
	const firstMark = quoteMarks[firstMarkIdx];
	if (!firstMark || firstMark.from >= rangeTo) {
		return { cleanText: text, cleanToOrig: null };
	}
	const spanLen = rangeTo - rangeFrom;
	const skipped = new Uint8Array(spanLen);
	for (let i = firstMarkIdx; i < quoteMarks.length; i += 1) {
		const mark = quoteMarks[i];
		if (!mark || mark.from >= rangeTo) break;
		const start = Math.max(rangeFrom, mark.from);
		let end = Math.min(rangeTo, mark.to);
		if (end < rangeTo && (" " === text[end] || "\t" === text[end])) {
			end += 1;
		}
		skipped.fill(1, start - rangeFrom, end - rangeFrom);
	}
	const compacted = compactUnmaskedSliceWithMap(text.slice(rangeFrom, rangeTo), skipped);
	const cleanToOrig = compacted.indexMap;
	for (let i = 0; i < cleanToOrig.length; i += 1) {
		cleanToOrig[i] = (cleanToOrig[i] ?? 0) + rangeFrom;
	}
	return { cleanText: compacted.text, cleanToOrig };
}

function lookupReferenceLabel(
	raw: string,
	definedReferenceLabels: ReadonlySet<string>,
	profile: ReferenceLabelCaseFoldProfile,
	unsupportedNonAscii: UnsupportedNonAsciiReferenceInfo | undefined,
): ReferenceLookupResult {
	if ("unsupported" !== profile) {
		const normalized = normalizeBoldReferenceLabel(raw, profile);
		return null !== normalized && definedReferenceLabels.has(normalized)
			? { key: normalized, kind: "match" }
			: { kind: "none" };
	}
	const canonical = canonicalizeUnsupportedReferenceLabel(raw);
	if (!canonical) return { kind: "none" };
	const fold17Key = normalizeBoldReferenceLabel(raw, 17);
	if (null !== fold17Key && unsupportedNonAscii?.collidingFold17Keys.has(fold17Key)) {
		return { kind: "unverifiable" };
	}
	const hasExactMatch = canonical.hasNonAscii
		? true === unsupportedNonAscii?.exactLabels.has(canonical.key)
		: definedReferenceLabels.has(canonical.key);
	if (hasExactMatch) {
		return { key: canonical.key, kind: "match" };
	}
	if (
		null !== fold17Key &&
		(unsupportedNonAscii?.allFold17Keys.has(fold17Key) ||
			definedReferenceLabels.has(fold17Key))
	) {
		return { kind: "unverifiable" };
	}
	if (canonical.hasNonAscii && unsupportedNonAscii?.hasNonAsciiDefinitions) {
		return { kind: "unverifiable" };
	}
	return { kind: "none" };
}

/**
 * Creates an incremental CommonMark §6.5 / §6.6 bracket-stack resolver over
 * `text[rangeFrom, rangeTo)` used by the unified single-pass League inline
 * engine.
 */
export function createCommonMarkBracketResolver<TDelimiter = null>(
	text: string,
	rangeFrom: number,
	rangeTo: number,
	definedReferenceLabels: ReadonlySet<string>,
	profile: ReferenceLabelCaseFoldProfile = DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
	options: Readonly<{
		onUnverifiableReference?: () => void;
		unsupportedNonAscii?: UnsupportedNonAsciiReferenceInfo;
	}> = {},
): CommonMarkBracketResolver<TDelimiter> {
	let lastCloseParen = -2;
	const getLastCloseParen = (): number => {
		if (-2 === lastCloseParen) {
			let found = -1;
			for (let p = rangeTo - 1; p >= rangeFrom; p -= 1) {
				if (41 /* ) */ === text.charCodeAt(p)) {
					found = p;
					break;
				}
			}
			lastCloseParen = found;
		}
		return lastCloseParen;
	};

	const unsupportedNonAscii = options.unsupportedNonAscii;
	const hasAnyReferenceDefinitions =
		definedReferenceLabels.size > 0 ||
		(unsupportedNonAscii?.exactLabels.size ?? 0) > 0 ||
		(unsupportedNonAscii?.allFold17Keys.size ?? 0) > 0 ||
		true === unsupportedNonAscii?.hasNonAsciiDefinitions;

	const rawBindings: CommonMarkResolvedBinding[] = [];
	const openerStack: BracketOpener<TDelimiter>[] = [];
	const activeLinkOpeners: BracketOpener<TDelimiter>[] = [];
	const deactivateLinkOpeners = (): void => {
		while (activeLinkOpeners.length > 0) {
			const activeLink = activeLinkOpeners.pop();
			if (activeLink) activeLink.active = false;
		}
	};

	const recordBinding = (
		opener: BracketOpener<TDelimiter>,
		form: CommonMarkResolvedBinding["form"],
		closeBracket: number,
		end: number,
		key: string,
		rawLabel: string,
		collapsedEmptyCloseOffset: number | null,
		refFrom: number | null,
		refTo: number | null,
	): CommonMarkResolvedBinding => {
		const binding: CommonMarkResolvedBinding = {
			closeBracketOffset: closeBracket,
			collapsedEmptyCloseOffset,
			form,
			from: opener.from,
			key,
			kind: opener.kind,
			labelFrom: opener.labelFrom,
			labelTo: closeBracket,
			rawLabel,
			refFrom,
			refTo,
			to: end,
		};
		rawBindings.push(binding);
		if ("link" === opener.kind) deactivateLinkOpeners();
		return binding;
	};

	return {
		getBindings: () => {
			if (rawBindings.length > 1) {
				rawBindings.sort(
					(left, right) => left.from - right.from || right.to - left.to,
				);
			}
			return rawBindings;
		},
		pushImageOpener: (from: number, openerDelimiter: TDelimiter) => {
			openerStack.push({
				active: true,
				from,
				kind: "image",
				labelFrom: from + 2,
				openerDelimiter,
			});
		},
		pushLinkOpener: (from: number, openerDelimiter: TDelimiter) => {
			const linkOpener: BracketOpener<TDelimiter> = {
				active: true,
				from,
				kind: "link",
				labelFrom: from + 1,
				openerDelimiter,
			};
			openerStack.push(linkOpener);
			activeLinkOpeners.push(linkOpener);
		},
		resolveCloseBracket: (
			closePos: number,
		): CommonMarkCloseBracketOutcome<TDelimiter> => {
			const opener = openerStack.pop();
			if (
				opener &&
				"link" === opener.kind &&
				activeLinkOpeners[activeLinkOpeners.length - 1] === opener
			) {
				activeLinkOpeners.pop();
			}
			if (!opener?.active) return { kind: "none" };

			const afterClose = closePos + 1;
			if (afterClose < rangeTo && 40 /* ( */ === text.charCodeAt(afterClose)) {
				const inlineTail = scanInlineLinkTail(
					text,
					afterClose,
					rangeTo,
					getLastCloseParen(),
				);
				if (inlineTail) {
					const dest = inlineTail.dest
						? text.slice(inlineTail.dest.from, inlineTail.dest.to)
						: "";
					const title = inlineTail.title
						? text.slice(inlineTail.title.from, inlineTail.title.to)
						: "";
					const inlineKey = title
						? `inline:${dest}\0${title}`
						: `inline:${dest}`;
					const binding = recordBinding(
						opener,
						"inline",
						closePos,
						inlineTail.endPos,
						inlineKey,
						"",
						null,
						null,
						null,
					);
					return {
						binding,
						kind: "matched",
						nextPos: inlineTail.endPos,
						openerDelimiter: opener.openerDelimiter,
					};
				}
			}

			let blockedShortcutByFollowingBrackets = false;
			if (afterClose < rangeTo && 91 /* [ */ === text.charCodeAt(afterClose)) {
				const nextBracket = scanBracketLabelRange(text, afterClose, rangeTo);
				if (nextBracket) {
					blockedShortcutByFollowingBrackets = true;
					if (nextBracket.isEmpty) {
						if (
							hasAnyReferenceDefinitions &&
							isValidCommonMarkLinkLabel(text, opener.labelFrom, closePos)
						) {
							const rawInner = text.slice(opener.labelFrom, closePos);
							const lookup = lookupReferenceLabel(
								rawInner,
								definedReferenceLabels,
								profile,
								unsupportedNonAscii,
							);
							if ("unverifiable" === lookup.kind) {
								options.onUnverifiableReference?.();
								return { kind: "unverifiable" };
							}
							if ("match" === lookup.kind) {
								const nextPos = nextBracket.closeBracket + 1;
								const binding = recordBinding(
									opener,
									"collapsed",
									closePos,
									nextPos,
									`ref:${lookup.key}`,
									formatShorthandRawLabel(rawInner),
									nextBracket.closeBracket,
									afterClose,
									nextPos,
								);
								return {
									binding,
									kind: "matched",
									nextPos,
									openerDelimiter: opener.openerDelimiter,
								};
							}
						}
					} else if (hasAnyReferenceDefinitions && nextBracket.hasNonWs) {
						const refInner = text.slice(afterClose + 1, nextBracket.closeBracket);
						const lookup = lookupReferenceLabel(
							refInner,
							definedReferenceLabels,
							profile,
							unsupportedNonAscii,
						);
						if ("unverifiable" === lookup.kind) {
							options.onUnverifiableReference?.();
							return { kind: "unverifiable" };
						}
						if ("match" === lookup.kind) {
							const nextPos = nextBracket.closeBracket + 1;
							const binding = recordBinding(
								opener,
								"full",
								closePos,
								nextPos,
								`ref:${lookup.key}`,
								refInner,
								null,
								afterClose,
								nextPos,
							);
							return {
								binding,
								kind: "matched",
								nextPos,
								openerDelimiter: opener.openerDelimiter,
							};
						}
					}
				}
			}

			if (
				!blockedShortcutByFollowingBrackets &&
				hasAnyReferenceDefinitions &&
				isValidCommonMarkLinkLabel(text, opener.labelFrom, closePos)
			) {
				const rawInner = text.slice(opener.labelFrom, closePos);
				const lookup = lookupReferenceLabel(
					rawInner,
					definedReferenceLabels,
					profile,
					unsupportedNonAscii,
				);
				if ("unverifiable" === lookup.kind) {
					options.onUnverifiableReference?.();
					return { kind: "unverifiable" };
				}
				if ("match" === lookup.kind) {
					const binding = recordBinding(
						opener,
						"shortcut",
						closePos,
						afterClose,
						`ref:${lookup.key}`,
						formatShorthandRawLabel(rawInner),
						null,
						null,
						null,
					);
					return {
						binding,
						kind: "matched",
						nextPos: afterClose,
						openerDelimiter: opener.openerDelimiter,
					};
				}
			}

			return { kind: "none" };
		},
	};
}
