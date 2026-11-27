import {
	collectBoldableSegments,
	type SourceBoldSegment,
	type SourceResolvedLinkSpan,
	type SourceShorthandReferenceLink,
	type SourceStrongSpan,
} from "./editor-context-menu-bold-segments";
import {
	type InlineContentRunCollector,
	planVerifiedContainerUnboldReplacements,
	type UnboldContainerGroup,
	withShorthandReferenceEdits,
} from "./editor-context-menu-bold-unbold";
import {
	type BoldVerifyContext,
	verifyPlainWrapPlan,
} from "./editor-context-menu-bold-verify";
import type { EditorSelection } from "./editor-context-menu-rules";
import {
	assertEditorSelection,
	createTextEdit,
	type EditorTextEdit,
} from "./editor-context-menu-text-edit";
import {
	appendAll,
	firstRangeEndingAfter,
	type SourceRange,
	subtractSortedRanges,
} from "../../shared/markdown/markdown-source-projection";
import {
	collectShorthandReferencePreservationEdits,
	deduplicateAndValidateReplacements,
	type PlannedBoldReplacement,
} from "./editor-context-menu-bold-edits";
import { DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE } from "./editor-markdown-link-primitives";
import type { ReferenceLabelCaseFoldProfile } from "./reference-label-normalization";

export type SourceBoldOptions = Readonly<{
	prefix?: string;
	referenceLabelCaseFoldProfile?: ReferenceLabelCaseFoldProfile;
	suffix?: string;
}>;

export type SourceBoldPlan =
	| Readonly<{ kind: "delegate-toolbar" }>
	| Readonly<{ kind: "unavailable" }>
	| Readonly<{ edit: EditorTextEdit; kind: "edit" }>;

type UnwrapTarget = Readonly<{
	innerFrom: number;
	innerTo: number;
	outerFrom: number;
	outerTo: number;
}>;

type PlainBoldPiece = Readonly<{
	containerFrom: number;
	containerTo: number;
	from: number;
	kind: "plain";
	to: number;
}>;

type BoldPiece =
	| PlainBoldPiece
	| Readonly<{
			from: number;
			kind: "wrapped";
			span?: SourceStrongSpan;
			to: number;
			unwrap: UnwrapTarget;
	  }>
	| Readonly<{
			enclosing: SourceStrongSpan;
			from: number;
			kind: "enclosed";
			to: number;
	  }>;

const MAX_CONTAINER_FALLBACK_VERIFICATIONS = 16;

function hasUnescapedDelimiterOutsideCode(
	inner: string,
	delimiter: string,
): boolean {
	let index = 0;
	while (index < inner.length) {
		const ch = inner[index];
		if ("\\" === ch) {
			index += 2;
			continue;
		}
		if ("`" === ch) {
			let runLen = 0;
			while (index + runLen < inner.length && "`" === inner[index + runLen]) {
				runLen += 1;
			}
			const fence = "`".repeat(runLen);
			let close = inner.indexOf(fence, index + runLen);
			while (close >= 0) {
				if ("`" !== inner[close - 1] && "`" !== inner[close + runLen]) break;
				close = inner.indexOf(fence, close + 1);
			}
			index = close >= 0 ? close + runLen : index + runLen;
			continue;
		}
		if (inner.startsWith(delimiter, index)) return true;
		index += 1;
	}
	return false;
}

function isSingleWrappedSpan(
	text: string,
	prefix: string,
	suffix: string,
): boolean {
	if (0 === prefix.length || 0 === suffix.length) return false;
	if (!text.startsWith(prefix) || !text.endsWith(suffix)) return false;
	if (text.length <= prefix.length + suffix.length) return false;
	const inner = text.slice(prefix.length, text.length - suffix.length);
	if (/^[ \t\r\n]*$/u.test(inner)) return false;
	return prefix === suffix
		? !hasUnescapedDelimiterOutsideCode(inner, prefix)
		: !hasUnescapedDelimiterOutsideCode(inner, prefix) &&
				!hasUnescapedDelimiterOutsideCode(inner, suffix);
}

function resolveUnwrapTarget(
	value: string,
	segment: Readonly<{ from: number; to: number }>,
	prefix: string,
	suffix: string,
): UnwrapTarget | null {
	const selected = value.slice(segment.from, segment.to);
	const lefts: Array<Readonly<{ innerFrom: number; outerFrom: number }>> = [];
	if (selected.startsWith(prefix)) {
		lefts.push({
			innerFrom: segment.from + prefix.length,
			outerFrom: segment.from,
		});
	}
	if (
		segment.from >= prefix.length &&
		value.slice(segment.from - prefix.length, segment.from) === prefix
	) {
		lefts.push({
			innerFrom: segment.from,
			outerFrom: segment.from - prefix.length,
		});
	}

	const rights: Array<Readonly<{ innerTo: number; outerTo: number }>> = [];
	if (selected.endsWith(suffix)) {
		rights.push({ innerTo: segment.to - suffix.length, outerTo: segment.to });
	}
	if (
		segment.to + suffix.length <= value.length &&
		value.slice(segment.to, segment.to + suffix.length) === suffix
	) {
		rights.push({ innerTo: segment.to, outerTo: segment.to + suffix.length });
	}

	for (const left of lefts) {
		for (const right of rights) {
			if (left.innerFrom >= right.innerTo) continue;
			if (
				isSingleWrappedSpan(
					value.slice(left.outerFrom, right.outerTo),
					prefix,
					suffix,
				)
			) {
				return { ...left, ...right };
			}
		}
	}
	return null;
}

function selectOutermostStrongSpans(
	strongSpans: ReadonlyArray<SourceStrongSpan>,
): SourceStrongSpan[] {
	const outermost: SourceStrongSpan[] = [];
	let currentEnd = -1;
	for (const span of strongSpans) {
		if (0 === span.openMark.length || 0 === span.closeMark.length) continue;
		if (span.from < currentEnd) continue;
		outermost.push(span);
		currentEnd = span.to;
	}
	return outermost;
}

function collectGapPlainRuns(
	gapFrom: number,
	gapTo: number,
	resolvedLinks: ReadonlyArray<SourceResolvedLinkSpan>,
	collectInlineContentRuns: InlineContentRunCollector,
): ReadonlyArray<Readonly<{ from: number; to: number }>> {
	if (gapFrom >= gapTo) return [];
	if (0 === resolvedLinks.length) return collectInlineContentRuns(gapFrom, gapTo);
	const excluded: SourceRange[] = [];
	for (let i = firstRangeEndingAfter(resolvedLinks, gapFrom); i < resolvedLinks.length; i += 1) {
		const link = resolvedLinks[i];
		if (!link || link.from >= gapTo) break;
		if (link.from >= gapFrom && link.to <= gapTo) continue;
		if (link.from < link.labelFrom) excluded.push({ from: link.from, to: link.labelFrom });
		if (link.labelTo < link.to) excluded.push({ from: link.labelTo, to: link.to });
	}
	if (0 === excluded.length) return collectInlineContentRuns(gapFrom, gapTo);
	const runs: Array<Readonly<{ from: number; to: number }>> = [];
	for (const open of subtractSortedRanges(gapFrom, gapTo, excluded)) {
		appendAll(runs, collectInlineContentRuns(open.from, open.to));
	}
	return runs;
}

function appendSegmentPieces(
	value: string,
	segment: SourceBoldSegment,
	strongSpans: ReadonlyArray<SourceStrongSpan>,
	strongSpanCursor: number,
	resolvedLinks: ReadonlyArray<SourceResolvedLinkSpan>,
	collectInlineContentRuns: InlineContentRunCollector,
	prefix: string,
	suffix: string,
	isStandardMarkdownStrong: boolean,
	pieces: BoldPiece[],
): void {
	if (!isStandardMarkdownStrong) {
		const directUnwrap = resolveUnwrapTarget(value, segment, prefix, suffix);
		if (directUnwrap) {
			pieces.push({
				from: segment.from,
				kind: "wrapped",
				to: segment.to,
				unwrap: directUnwrap,
			});
			return;
		}
	}
	const overlapping: SourceStrongSpan[] = [];
	for (let index = strongSpanCursor; index < strongSpans.length; index += 1) {
		const span = strongSpans[index];
		if (!span || span.from >= segment.to) break;
		if (span.to > segment.from) overlapping.push(span);
	}
	if (0 === overlapping.length) {
		pieces.push({
			containerFrom: segment.containerFrom,
			containerTo: segment.containerTo,
			from: segment.from,
			kind: "plain",
			to: segment.to,
		});
		return;
	}

	let cursor = segment.from;
	for (const span of overlapping) {
		if (span.from > cursor) {
			for (const plain of collectGapPlainRuns(
				cursor,
				Math.min(span.from, segment.to),
				resolvedLinks,
				collectInlineContentRuns,
			)) {
				pieces.push({
					containerFrom: segment.containerFrom,
					containerTo: segment.containerTo,
					from: plain.from,
					kind: "plain",
					to: plain.to,
				});
			}
		}
		if (segment.from <= span.innerFrom && segment.to >= span.innerTo) {
			pieces.push({
				from: Math.max(segment.from, span.from),
				kind: "wrapped",
				span,
				to: Math.min(segment.to, span.to),
				unwrap: {
					innerFrom: span.innerFrom,
					innerTo: span.innerTo,
					outerFrom: span.from,
					outerTo: span.to,
				},
			});
		} else {
			for (const enclosed of collectGapPlainRuns(
				Math.max(segment.from, span.innerFrom),
				Math.min(segment.to, span.innerTo),
				resolvedLinks,
				collectInlineContentRuns,
			)) {
				pieces.push({
					enclosing: span,
					from: enclosed.from,
					kind: "enclosed",
					to: enclosed.to,
				});
			}
		}
		cursor = Math.max(cursor, span.to);
	}
	if (cursor < segment.to) {
		for (const plain of collectGapPlainRuns(
			cursor,
			segment.to,
			resolvedLinks,
			collectInlineContentRuns,
		)) {
			pieces.push({
				containerFrom: segment.containerFrom,
				containerTo: segment.containerTo,
				from: plain.from,
				kind: "plain",
				to: plain.to,
			});
		}
	}
}

function planVerifiedPlainWrapReplacements(
	value: string,
	plainPieces: ReadonlyArray<PlainBoldPiece>,
	prefix: string,
	suffix: string,
	isStandardMarkdownStrong: boolean,
	shorthandLinks: ReadonlyArray<SourceShorthandReferenceLink>,
	verifyContext: BoldVerifyContext,
): PlannedBoldReplacement[] {
	const toWrapEdits = (list: ReadonlyArray<PlainBoldPiece>): PlannedBoldReplacement[] =>
		list.map((piece) => ({ from: piece.from, insert: `${prefix}${value.slice(piece.from, piece.to)}${suffix}`, to: piece.to }));

	const profile = verifyContext.referenceLabelCaseFoldProfile;
	if (!isStandardMarkdownStrong) {
		const edits = toWrapEdits(plainPieces);
		return [...edits, ...collectShorthandReferencePreservationEdits(value, edits, shorthandLinks, profile)];
	}

	const byContainer = new Map<string, { containerFrom: number; containerTo: number; pieces: PlainBoldPiece[] }>();
	for (const piece of plainPieces) {
		const key = `${piece.containerFrom}:${piece.containerTo}`;
		const existing = byContainer.get(key);
		if (existing) existing.pieces.push(piece);
		else byContainer.set(key, { containerFrom: piece.containerFrom, containerTo: piece.containerTo, pieces: [piece] });
	}

	const replacements: PlannedBoldReplacement[] = [];
	for (const group of byContainer.values()) {
		const groupEdits = toWrapEdits(group.pieces);
		const groupExtra = collectShorthandReferencePreservationEdits(value, groupEdits, shorthandLinks, profile);
		if (verifyPlainWrapPlan(value, group.containerFrom, group.containerTo, group.pieces, prefix, suffix, verifyContext, groupExtra)) {
			appendAll(replacements, groupEdits);
			appendAll(replacements, groupExtra);
			continue;
		}
		if (
			group.pieces.length <= 1 ||
			group.pieces.length > MAX_CONTAINER_FALLBACK_VERIFICATIONS
		) {
			continue;
		}

		// Batch failed in a small container (e.g. a clamped punctuation fragment
		// next to a GFM autolink): retain only segments that verify cleanly in
		// context, keeping per-container fallback verifications strictly O(1).
		const accepted: PlainBoldPiece[] = [];
		for (const piece of group.pieces) {
			const candidate = [...accepted, piece];
			const candidateExtra = collectShorthandReferencePreservationEdits(value, toWrapEdits(candidate), shorthandLinks, profile);
			if (verifyPlainWrapPlan(value, group.containerFrom, group.containerTo, candidate, prefix, suffix, verifyContext, candidateExtra)) {
				accepted.push(piece);
			}
		}
		if (accepted.length > 0) {
			const acceptedEdits = toWrapEdits(accepted);
			appendAll(replacements, acceptedEdits);
			appendAll(replacements, collectShorthandReferencePreservationEdits(value, acceptedEdits, shorthandLinks, profile));
		}
	}
	return replacements;
}

function mapPositionThroughEdits(
	position: number,
	edits: ReadonlyArray<PlannedBoldReplacement>,
	mode: "unwrap" | "wrap",
	edge: "end" | "start",
	prefixLength: number,
): number {
	let delta = 0;
	for (const edit of edits) {
		const editDelta = edit.insert.length - (edit.to - edit.from);
		if (position < edit.from) break;
		if (position === edit.from) {
			if (edit.from === edit.to) {
				if (
					("start" === edge && "wrap" === mode) ||
					("end" === edge && ("unwrap" === mode || edit.excludeFromSelectionEnd))
				) {
					break;
				}
				delta += editDelta;
				continue;
			}
			if (("wrap" === mode && "start" === edge) || "unwrap" === mode) break;
			delta += editDelta;
			continue;
		}
		if (position >= edit.to) {
			delta += editDelta;
			continue;
		}
		if ("unwrap" === mode) {
			const unwrapPrefix = edit.unwrapPrefixLength ?? prefixLength;
			const inner = Math.max(
				0,
				Math.min(edit.insert.length, position - edit.from - unwrapPrefix),
			);
			return edit.from + delta + inner;
		}
		return position + delta + prefixLength;
	}
	return position + delta;
}

function applyPlannedReplacements(
	value: string,
	selection: EditorSelection,
	replacements: ReadonlyArray<PlannedBoldReplacement>,
	mode: "unwrap" | "wrap",
	prefixLength: number,
): EditorTextEdit | null {
	const sorted = deduplicateAndValidateReplacements(replacements);
	if (!sorted || 0 === sorted.length) return null;
	const firstEdit = sorted[0];
	const lastEdit = sorted[sorted.length - 1];
	if (!firstEdit || !lastEdit) return null;

	const changeFrom = firstEdit.from;
	const changeTo = lastEdit.to;
	const chunks: string[] = [];
	let cursor = changeFrom;
	for (const edit of sorted) {
		chunks.push(value.slice(cursor, edit.from), edit.insert);
		cursor = edit.to;
	}
	const nextValue =
		value.slice(0, changeFrom) + chunks.join("") + value.slice(changeTo);
	const mappedStart = mapPositionThroughEdits(
		selection.start,
		sorted,
		mode,
		"start",
		prefixLength,
	);
	const mappedEnd = mapPositionThroughEdits(
		selection.end,
		sorted,
		mode,
		"end",
		prefixLength,
	);
	const nextStart = Math.max(0, Math.min(nextValue.length, mappedStart));
	const nextEnd = Math.max(nextStart, Math.min(nextValue.length, mappedEnd));
	return createTextEdit(
		value,
		nextValue,
		{ direction: selection.direction, end: nextEnd, start: nextStart },
		changeFrom,
		changeTo,
	);
}

/**
 * Builds one minimal wrap edit around `[selection.start, selection.end]` for
 * simple single-line inline selections when the caller commits directly to
 * canonical Markdown (e.g. Visual context-menu Bold).
 */
export function createSimpleBoldWrapEdit(
	value: string,
	selection: EditorSelection,
	options: SourceBoldOptions = {},
): EditorTextEdit | null {
	assertEditorSelection(selection, value);
	if (selection.start === selection.end) return null;
	const prefix = options.prefix ?? "**";
	const suffix = options.suffix ?? "**";
	if (0 === prefix.length || 0 === suffix.length) return null;
	return applyPlannedReplacements(
		value,
		selection,
		[
			{
				from: selection.start,
				insert: `${prefix}${value.slice(selection.start, selection.end)}${suffix}`,
				to: selection.end,
			},
		],
		"wrap",
		prefix.length,
	);
}

/**
 * Single-pass planner for Source & Visual context-menu Bold:
 * - `"delegate-toolbar"` for empty or simple single-line plain-text selections;
 * - `"unavailable"` when the selection contains zero boldable inline segments;
 * - `"edit"` with one minimal, single-undoable CommonMark-valid `EditorTextEdit`.
 */
export function planSourceBoldSelection(
	value: string,
	selection: EditorSelection,
	options: SourceBoldOptions = {},
): SourceBoldPlan {
	assertEditorSelection(selection, value);
	if (selection.start === selection.end) return { kind: "delegate-toolbar" };
	const prefix = options.prefix ?? "**";
	const suffix = options.suffix ?? "**";
	if (0 === prefix.length || 0 === suffix.length) {
		return { kind: "unavailable" };
	}

	const referenceLabelCaseFoldProfile =
		options.referenceLabelCaseFoldProfile ??
		DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE;
	const collected = collectBoldableSegments(
		value,
		selection,
		referenceLabelCaseFoldProfile,
	);
	if (0 === collected.segments.length) return { kind: "unavailable" };

	const isStandardMarkdownStrong =
		("**" === prefix && "**" === suffix) ||
		("__" === prefix && "__" === suffix);
	const strongSpans = isStandardMarkdownStrong
		? selectOutermostStrongSpans(collected.strongSpans)
		: [];
	const pieces: BoldPiece[] = [];
	let strongSpanCursor = 0;
	for (const segment of collected.segments) {
		while (
			strongSpanCursor < strongSpans.length &&
			(strongSpans[strongSpanCursor]?.to ?? 0) <= segment.from
		) {
			strongSpanCursor += 1;
		}
		appendSegmentPieces(
			value,
			segment,
			strongSpans,
			strongSpanCursor,
			collected.resolvedLinkSpans,
			collected.collectInlineContentRuns,
			prefix,
			suffix,
			isStandardMarkdownStrong,
			pieces,
		);
	}
	if (0 === pieces.length) return { kind: "unavailable" };

	const verifyContext: BoldVerifyContext = {
		...(collected.parsedDocument ? { cachedBefore: collected.parsedDocument } : {}),
		definedReferenceLabels: collected.definedReferenceLabels,
		referenceLabelCaseFoldProfile,
		containerHostByStart: collected.containerHostByStart,
		...(collected.unsupportedNonAscii
			? { unsupportedNonAscii: collected.unsupportedNonAscii }
			: {}),
	};
	const singleSegment = 1 === collected.segments.length ? collected.segments[0] : undefined;
	const singlePiece = 1 === pieces.length ? pieces[0] : undefined;
	const selected = value.slice(selection.start, selection.end);
	const intersectsShorthandReferenceLink = collected.shorthandReferenceLinks.some(
		(link) => selection.start < link.to && selection.end > link.from,
	);
	if (
		singleSegment &&
		singlePiece &&
		"plain" === singlePiece.kind &&
		!collected.overlapsIndivisible &&
		!intersectsShorthandReferenceLink &&
		!singleSegment.inTable &&
		singleSegment.from === selection.start &&
		singleSegment.to === selection.end &&
		!/[\r\n]/u.test(selected) &&
		!/^[ \t]|[ \t]$/u.test(selected)
	) {
		if (
			!isStandardMarkdownStrong ||
			verifyPlainWrapPlan(value, singleSegment.containerFrom, singleSegment.containerTo, [singlePiece], prefix, suffix, verifyContext)
		) {
			return { kind: "delegate-toolbar" };
		}
		return { kind: "unavailable" };
	}

	const allBold = pieces.every((piece) => "plain" !== piece.kind);
	const replacements: PlannedBoldReplacement[] = [];

	if (allBold) {
		const unboldByContainer = new Map<string, UnboldContainerGroup>();
		const getContainerGroup = (
			containerFrom: number,
			containerTo: number,
		): UnboldContainerGroup => {
			const key = `${containerFrom}:${containerTo}`;
			let group = unboldByContainer.get(key);
			if (!group) {
				group = {
					containerFrom,
					containerTo,
					enclosedBySpan: new Map(),
					wrappedEdits: [],
					wrappedTargets: [],
				};
				unboldByContainer.set(key, group);
			}
			return group;
		};

		for (const piece of pieces) {
			if ("wrapped" === piece.kind) {
				const edit: PlannedBoldReplacement = {
					from: piece.unwrap.outerFrom,
					insert: value.slice(piece.unwrap.innerFrom, piece.unwrap.innerTo),
					to: piece.unwrap.outerTo,
					unwrapPrefixLength: piece.unwrap.innerFrom - piece.unwrap.outerFrom,
				};
				if (!isStandardMarkdownStrong || !piece.span) {
					appendAll(
						replacements,
						withShorthandReferenceEdits(
							value,
							[edit],
							collected.shorthandReferenceLinks,
							referenceLabelCaseFoldProfile,
						),
					);
					continue;
				}
				const group = getContainerGroup(
					piece.span.containerFrom,
					piece.span.containerTo,
				);
				group.wrappedTargets.push({
					from: piece.unwrap.innerFrom,
					to: piece.unwrap.innerTo,
				});
				group.wrappedEdits.push(edit);
			} else if ("enclosed" === piece.kind) {
				const group = getContainerGroup(
					piece.enclosing.containerFrom,
					piece.enclosing.containerTo,
				);
				const list = group.enclosedBySpan.get(piece.enclosing) ?? [];
				list.push({ from: piece.from, to: piece.to });
				group.enclosedBySpan.set(piece.enclosing, list);
			}
		}

		for (const group of unboldByContainer.values()) {
			const planned = planVerifiedContainerUnboldReplacements(
				value,
				group,
				collected.collectInlineContentRuns,
				collected.shorthandReferenceLinks,
				verifyContext,
				MAX_CONTAINER_FALLBACK_VERIFICATIONS,
			);
			if (null === planned) return { kind: "unavailable" };
			appendAll(replacements, planned);
		}
	} else {
		const plainPieces = pieces.filter((piece): piece is PlainBoldPiece => "plain" === piece.kind);
		appendAll(
			replacements,
			planVerifiedPlainWrapReplacements(
				value, plainPieces, prefix, suffix, isStandardMarkdownStrong, collected.shorthandReferenceLinks, verifyContext,
			),
		);
		if (0 === replacements.length) return { kind: "unavailable" };
	}

	const edit = applyPlannedReplacements(
		value,
		selection,
		replacements,
		allBold ? "unwrap" : "wrap",
		prefix.length,
	);
	return edit ? { edit, kind: "edit" } : { kind: "unavailable" };
}
