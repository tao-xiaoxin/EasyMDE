import type { Tree } from "@lezer/common";

import {
	clampOutsideIndivisible,
	firstRangeEndingAfter,
	hasRangeOverlap,
	isContainedInSortedRanges,
	mergeRanges,
	originalOffsetAt,
	originalRange,
	projectedOffsetAt,
	projectNewlines,
	subtractSortedRanges,
	trimProjectedBounds,
	type NewlineProjection,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import {
	collectBoldAstData,
	type ContainerHostInfo,
	type LeafContainer,
	type ProjectedEmphasisFrame,
	type ProjectedNestedInlineSpan,
	type ProjectedStrongSpan,
	type RawLinkReferenceRecord,
	resolveContainerSliceRange,
	type SourceNestedInlineSpan,
} from "./editor-context-menu-bold-ast";
import type { EditorSelection } from "./editor-context-menu-rules";
import {
	getBoldMarkdownUnverifiableRanges,
	parseBoldMarkdown,
} from "./editor-markdown-bold-parser";
import {
	analyzeLeagueInlineBlock,
	type LeagueDelimitedSpan,
	type LeagueInlineBlockAnalysis,
} from "./editor-markdown-league-inline";
import { hasDocumentMathReclassification } from "./editor-markdown-league-math-tokens";
import {
	DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
	type SourceShorthandReferenceLink,
} from "./editor-markdown-link-primitives";
import {
	mathRanges,
	normalizeMathRanges,
	phpScansCodeBlocks,
	scanRawMarkdownInlineCodeRanges,
} from "./editor-markdown-math-preparation";
import type {
	ReferenceLabelCaseFoldProfile,
	UnsupportedNonAsciiReferenceInfo,
} from "./reference-label-normalization";

export type {
	ContainerHostInfo,
	SourceNestedInlineSpan,
} from "./editor-context-menu-bold-ast";
export type { SourceShorthandReferenceLink } from "./editor-markdown-link-primitives";

export type SourceBoldSegment = Readonly<{
	containerFrom: number;
	containerTo: number;
	from: number;
	inTable: boolean;
	to: number;
}>;

export type SourceOuterEmphasisSpan = Readonly<{
	closeFrom: number;
	closeMark: string;
	from: number;
	openMark: string;
	openTo: number;
	to: number;
}>;

export type SourceStrongSpan = Readonly<{
	closeMark: string;
	containerFrom: number;
	containerTo: number;
	from: number;
	innerFrom: number;
	innerTo: number;
	nestedInlineSpans: ReadonlyArray<SourceNestedInlineSpan>;
	openMark: string;
	outerEmphasisSpans: ReadonlyArray<SourceOuterEmphasisSpan>;
	to: number;
}>;

export type SourceResolvedLinkSpan = Readonly<{
	from: number;
	labelFrom: number;
	labelTo: number;
	to: number;
}>;

export type CollectedBoldSegments = Readonly<{
	collectInlineContentRuns: (from: number, to: number) => SourceRange[];
	/** Host facts for every leaf container overlapping the selection, keyed by slice start. */
	containerHostByStart: ReadonlyMap<number, ContainerHostInfo>;
	definedReferenceLabels: ReadonlySet<string>;
	overlapsIndivisible: boolean;
	parsedDocument?: Readonly<{ text: string; tree: Tree }>;
	resolvedLinkSpans: ReadonlyArray<SourceResolvedLinkSpan>;
	segments: ReadonlyArray<SourceBoldSegment>;
	shorthandReferenceLinks: ReadonlyArray<SourceShorthandReferenceLink>;
	strongSpans: ReadonlyArray<SourceStrongSpan>;
	unsupportedNonAscii?: UnsupportedNonAsciiReferenceInfo;
}>;

type ProjectedResolvedLink = Readonly<{
	from: number;
	labelFrom: number;
	labelTo: number;
	to: number;
}>;

const EMPTY_RANGES: ReadonlyArray<SourceRange> = [];
const EMPTY_REFERENCE_LABELS: ReadonlySet<string> = new Set();
const EMPTY_CONTAINER_HOSTS: ReadonlyMap<number, ContainerHostInfo> = new Map();
const EMPTY_COLLECTED_SEGMENTS: CollectedBoldSegments = {
	collectInlineContentRuns: () => [],
	containerHostByStart: EMPTY_CONTAINER_HOSTS,
	definedReferenceLabels: EMPTY_REFERENCE_LABELS,
	overlapsIndivisible: false,
	resolvedLinkSpans: [],
	segments: [],
	shorthandReferenceLinks: [],
	strongSpans: [],
};
// Links, autolinks, and PHP math (`$`, `\(`, `\[`) need the League inline
// model; plain prose containers keep their zero-cost fast path.
const CONTAINER_NEEDS_LEAGUE_INLINE = /[[@$]|\\\(|(?:https?|ftp):\/\/|www\./iu;
const CONTAINER_HAS_MATH_SYNTAX = /\$|\\[([]/u;

/** Lower-bound index of the first span in `spans` (sorted by `from`) with `from >= offset`. */
function firstSpanStartingAtOrAfter(
	spans: ReadonlyArray<ProjectedStrongSpan>,
	offset: number,
): number {
	let low = 0;
	let high = spans.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((spans[mid]?.from ?? 0) < offset) low = mid + 1;
		else high = mid;
	}
	return low;
}

/**
 * Whether a sorted, non-overlapping range overlaps `[from, to)` while crossing
 * either bound, so a container-local rescan cannot reproduce it.
 */
function isStraddledBySortedRange(
	ranges: ReadonlyArray<SourceRange>,
	from: number,
	to: number,
): boolean {
	const first = ranges[firstRangeEndingAfter(ranges, from)];
	if (undefined === first || first.from >= to) return false;
	if (first.from < from) return true;
	const last = ranges[firstRangeEndingAfter(ranges, to - 1)];
	return undefined !== last && last.from < to && last.to > to;
}

const EMPTY_EMPHASIS_FRAMES: ReadonlyArray<ProjectedEmphasisFrame> = [];

function toEmphasisFrame(span: LeagueDelimitedSpan): ProjectedEmphasisFrame {
	return { closeFrom: span.innerTo, from: span.from, openTo: span.innerFrom, to: span.to };
}

function compareDelimitedSpans(left: LeagueDelimitedSpan, right: LeagueDelimitedSpan): number {
	return left.from - right.from || right.to - left.to;
}

/**
 * Lezer is math-blind (`**$x**y$ word**`, `**~~$x~~y$ word c~~**`,
 * `***abc**$a* $*`). When a container has PHP math tokens, unconditionally
 * constructs `ProjectedStrongSpan[]` from League's authoritative strong,
 * emphasis, and strikethrough spans in `O(S log S)` time (returning `null`
 * only in the O(log L) empty case where neither League nor Lezer has any
 * strong span in `[from, to)`). Mirrors Lezer frames: every outermost strong
 * carries the emphasis/strikethrough spans nested anywhere inside it, and
 * every strong carries the emphasis spans enclosing it outside all strong
 * spans (outermost first).
 */
function leagueStrongOverride(
	sortedLezerStrong: ReadonlyArray<ProjectedStrongSpan>,
	league: LeagueInlineBlockAnalysis,
	from: number,
	to: number,
): ProjectedStrongSpan[] | null {
	const leagueStrong = league.strongSpans;
	if (0 === leagueStrong.length) {
		const firstLezer = sortedLezerStrong[firstSpanStartingAtOrAfter(sortedLezerStrong, from)];
		return !firstLezer || firstLezer.from >= to ? null : [];
	}

	const sortedStrong = [...leagueStrong].sort(compareDelimitedSpans);
	const outermostIndices: number[] = [];
	let maxStrongEnd = -1;
	for (let i = 0; i < sortedStrong.length; i += 1) {
		const span = sortedStrong[i];
		if (!span) continue;
		if (span.to > maxStrongEnd) {
			outermostIndices.push(i);
			maxStrongEnd = span.to;
		}
	}

	const nestedByStrong: ProjectedNestedInlineSpan[][] = sortedStrong.map(() => []);
	const topLevelEmphases: LeagueDelimitedSpan[] = [];
	if (league.emphSpans.length > 0) {
		const sortedEmph = [...league.emphSpans].sort(compareDelimitedSpans);
		let outerCursor = 0;
		for (const emph of sortedEmph) {
			while (
				outerCursor < outermostIndices.length &&
				(sortedStrong[outermostIndices[outerCursor] ?? -1]?.to ?? 0) <= emph.from
			) {
				outerCursor += 1;
			}
			const strongIdx = outermostIndices[outerCursor];
			const strong = undefined !== strongIdx ? sortedStrong[strongIdx] : undefined;
			if (
				undefined !== strongIdx &&
				strong &&
				strong.innerFrom <= emph.from &&
				emph.to <= strong.innerTo
			) {
				nestedByStrong[strongIdx]?.push({
					closeFrom: emph.innerTo,
					from: emph.from,
					kind: "emphasis",
					openTo: emph.innerFrom,
					to: emph.to,
				});
			} else if (!strong || !(strong.from <= emph.from && emph.to <= strong.to)) {
				topLevelEmphases.push(emph);
			}
		}
	}

	if (league.strikeSpans.length > 0) {
		const sortedStrike = [...league.strikeSpans].sort(compareDelimitedSpans);
		let outerCursor = 0;
		for (const strike of sortedStrike) {
			while (
				outerCursor < outermostIndices.length &&
				(sortedStrong[outermostIndices[outerCursor] ?? -1]?.to ?? 0) <= strike.from
			) {
				outerCursor += 1;
			}
			const strongIdx = outermostIndices[outerCursor];
			const strong = undefined !== strongIdx ? sortedStrong[strongIdx] : undefined;
			if (
				undefined !== strongIdx &&
				strong &&
				strong.innerFrom <= strike.from &&
				strike.to <= strong.innerTo
			) {
				nestedByStrong[strongIdx]?.push({
					closeFrom: strike.innerTo,
					from: strike.from,
					kind: "strikethrough",
					openTo: strike.innerFrom,
					to: strike.to,
				});
			}
		}
	}

	const activeEmphases: ProjectedEmphasisFrame[] = [];
	let emphCursor = 0;
	const result: ProjectedStrongSpan[] = new Array(sortedStrong.length);
	for (let i = 0; i < sortedStrong.length; i += 1) {
		const span = sortedStrong[i];
		if (!span) continue;
		while (
			emphCursor < topLevelEmphases.length &&
			(topLevelEmphases[emphCursor]?.from ?? 0) <= span.from
		) {
			const emph = topLevelEmphases[emphCursor];
			emphCursor += 1;
			if (emph && emph.to >= span.to) {
				while (
					activeEmphases.length > 0 &&
					(activeEmphases[activeEmphases.length - 1]?.to ?? 0) < emph.to
				) {
					activeEmphases.pop();
				}
				activeEmphases.push(toEmphasisFrame(emph));
			}
		}
		while (
			activeEmphases.length > 0 &&
			(activeEmphases[activeEmphases.length - 1]?.to ?? 0) < span.to
		) {
			activeEmphases.pop();
		}
		const nested = nestedByStrong[i] ?? [];
		if (nested.length > 1) {
			nested.sort((left, right) => left.from - right.from || right.to - left.to);
		}
		result[i] = {
			...span,
			nestedInlineSpans: nested,
			outerEmphases: activeEmphases.length > 0 ? [...activeEmphases] : EMPTY_EMPHASIS_FRAMES,
		};
	}
	return result;
}

function buildReferenceLabelTable(
	rawLinkReferences: ReadonlyArray<RawLinkReferenceRecord>,
	blockMathRanges: ReadonlyArray<SourceRange>,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile,
) {
	const definedReferenceLabels = new Set<string>();
	const exactNonAsciiReferenceLabels = new Set<string>();
	const allFold17Keys = new Set<string>();
	const collidingFold17Keys = new Set<string>();
	const fold17ExactOwner = new Map<string, string>();
	for (const ref of rawLinkReferences) {
		if (hasRangeOverlap(blockMathRanges, ref.from, ref.to)) continue;
		if (ref.isNonAscii) exactNonAsciiReferenceLabels.add(ref.key);
		else definedReferenceLabels.add(ref.key);
		if (null !== ref.fold17Key) {
			allFold17Keys.add(ref.fold17Key);
			const existing = fold17ExactOwner.get(ref.fold17Key);
			if (undefined === existing) fold17ExactOwner.set(ref.fold17Key, ref.key);
			else if (existing !== ref.key) collidingFold17Keys.add(ref.fold17Key);
		}
	}
	const unsupportedNonAscii: UnsupportedNonAsciiReferenceInfo | undefined =
		"unsupported" === referenceLabelCaseFoldProfile &&
		(definedReferenceLabels.size > 0 || exactNonAsciiReferenceLabels.size > 0)
			? {
					allFold17Keys,
					collidingFold17Keys,
					exactLabels: exactNonAsciiReferenceLabels,
					hasNonAsciiDefinitions: exactNonAsciiReferenceLabels.size > 0,
				}
			: undefined;
	return { definedReferenceLabels, unsupportedNonAscii };
}

function resolveContainerInlineStructures(
	text: string,
	projection: NewlineProjection,
	sortedLeafContainers: ReadonlyArray<LeafContainer>,
	sortedQuoteMarks: ReadonlyArray<SourceRange>,
	sortedLezerStrong: ReadonlyArray<ProjectedStrongSpan>,
	blockMathRanges: ReadonlyArray<SourceRange>,
	rawInlineCodeRanges: ReadonlyArray<SourceRange>,
	definedReferenceLabels: ReadonlySet<string>,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile,
	unsupportedNonAscii: UnsupportedNonAsciiReferenceInfo | undefined,
) {
	const resolvedImageRanges: SourceRange[] = [];
	const hiddenLinkTailRanges: SourceRange[] = [];
	const shorthandReferenceLinks: SourceShorthandReferenceLink[] = [];
	const unverifiableRanges: SourceRange[] = [];
	const extendedAutolinkRanges: SourceRange[] = [];
	const resolvedLinkSpans: SourceResolvedLinkSpan[] = [];
	const projectedResolvedLinks: ProjectedResolvedLink[] = [];
	const strongOverrideContainers: SourceRange[] = [];
	const leagueStrongSpans: ProjectedStrongSpan[] = [];

	for (const container of sortedLeafContainers) {
		if (isContainedInSortedRanges(container.inlineFrom, container.to, blockMathRanges)) {
			continue;
		}
		const hasBlockMath = hasRangeOverlap(
			blockMathRanges,
			container.inlineFrom,
			container.to,
		);
		const containerText = text.slice(container.inlineFrom, container.to);
		if (!hasBlockMath && !CONTAINER_NEEDS_LEAGUE_INLINE.test(containerText)) {
			continue;
		}
		// PHP pairs raw backticks across the whole document; a span crossing this
		// container hides or exposes its math in ways a local rescan cannot see.
		if (
			CONTAINER_HAS_MATH_SYNTAX.test(containerText) &&
			isStraddledBySortedRange(rawInlineCodeRanges, container.inlineFrom, container.to)
		) {
			unverifiableRanges.push({ from: container.inlineFrom, to: container.to });
			continue;
		}
		const league = analyzeLeagueInlineBlock(text, {
			definedReferenceLabels,
			isNonParagraphHost: container.isNonParagraphHost,
			quoteMarks: sortedQuoteMarks,
			rangeFrom: container.inlineFrom,
			rangeTo: container.to,
			referenceLabelCaseFoldProfile,
			skipBlockMathReclassificationCheck: true,
			taskMarkerLength: container.taskMarkerLength,
			...(unsupportedNonAscii ? { unsupportedNonAscii } : {}),
		});
		if (league.hasUnverifiableReferences) {
			unverifiableRanges.push({ from: container.inlineFrom, to: container.to });
			continue;
		}
		if (league.hasMathTokens) {
			const override = leagueStrongOverride(
				sortedLezerStrong, league, container.inlineFrom, container.to,
			);
			if (override) {
				strongOverrideContainers.push({ from: container.inlineFrom, to: container.to });
				for (const span of override) leagueStrongSpans.push(span);
			}
		}
		for (const autolink of league.gfmAutolinks) {
			extendedAutolinkRanges.push({ from: autolink.from, to: autolink.to });
		}
		let imageCoverEnd = -1;
		for (const binding of league.bindings) {
			if ("image" === binding.kind) {
				resolvedImageRanges.push({ from: binding.from, to: binding.to });
				if (binding.to > imageCoverEnd) imageCoverEnd = binding.to;
				continue;
			}
			if (binding.from < imageCoverEnd) continue;
			const origFrom = originalOffsetAt(projection, binding.from);
			const origLabelFrom = originalOffsetAt(projection, binding.labelFrom);
			const origLabelTo = originalOffsetAt(projection, binding.labelTo);
			const origTo = originalOffsetAt(projection, binding.to);
			resolvedLinkSpans.push({
				from: origFrom,
				labelFrom: origLabelFrom,
				labelTo: origLabelTo,
				to: origTo,
			});
			projectedResolvedLinks.push({
				from: binding.from,
				labelFrom: binding.labelFrom,
				labelTo: binding.labelTo,
				to: binding.to,
			});
			if (binding.closeBracketOffset + 1 < binding.to) {
				hiddenLinkTailRanges.push({
					from: binding.closeBracketOffset + 1,
					to: binding.to,
				});
			}
			if ("shortcut" === binding.form || "collapsed" === binding.form) {
				const emptyClose = binding.collapsedEmptyCloseOffset;
				shorthandReferenceLinks.push({
					closeBracketOffset: originalOffsetAt(projection, binding.closeBracketOffset),
					collapsedEmptyCloseOffset:
						null === emptyClose ? null : originalOffsetAt(projection, emptyClose),
					from: origFrom,
					labelFrom: origLabelFrom,
					labelTo: origLabelTo,
					normalizedLabel: binding.key.slice(4),
					rawLabel: binding.rawLabel,
					to: origTo,
				});
			}
		}
	}

	return {
		extendedAutolinkRanges,
		hiddenLinkTailRanges,
		projectedResolvedLinks,
		resolvedImageRanges,
		resolvedLinkSpans,
		shorthandReferenceLinks,
		strongSpans:
			0 === strongOverrideContainers.length
				? sortedLezerStrong
				: [
						...sortedLezerStrong.filter(
							(span) => !isContainedInSortedRanges(span.from, span.to, strongOverrideContainers),
						),
						...leagueStrongSpans,
					],
		unverifiableRanges,
	};
}

/**
 * Converts projected strong spans to original offsets in one place, attaching
 * resolved links nested inside each outermost strong span.
 */
function materializeStrongSpans(
	text: string,
	projection: NewlineProjection,
	projectedStrongSpans: ReadonlyArray<ProjectedStrongSpan>,
	excludedStrongHosts: ReadonlyArray<SourceRange>,
	projectedResolvedLinks: ReadonlyArray<ProjectedResolvedLink>,
	sortedLeafContainers: ReadonlyArray<LeafContainer>,
	sortedQuoteMarks: ReadonlyArray<SourceRange>,
): SourceStrongSpan[] {
	const toOriginal = (offset: number): number => originalOffsetAt(projection, offset);
	const filteredStrongSpans = projectedStrongSpans
		.filter((span) => !isContainedInSortedRanges(span.from, span.to, excludedStrongHosts))
		.sort((left, right) => left.from - right.from || right.to - left.to);

	const nestedLinksByStrong = new Map<ProjectedStrongSpan, ProjectedNestedInlineSpan[]>();
	if (projectedResolvedLinks.length > 0 && filteredStrongSpans.length > 0) {
		const outermostStrong: ProjectedStrongSpan[] = [];
		let coverEnd = -1;
		for (const span of filteredStrongSpans) {
			if (span.from < coverEnd) continue;
			outermostStrong.push(span);
			coverEnd = span.to;
		}
		let strongIdx = 0;
		for (const link of projectedResolvedLinks) {
			while (
				strongIdx < outermostStrong.length &&
				(outermostStrong[strongIdx]?.to ?? 0) <= link.from
			) {
				strongIdx += 1;
			}
			const host = outermostStrong[strongIdx];
			if (
				host &&
				host.from <= link.from &&
				link.to <= host.to &&
				link.labelFrom <= link.labelTo
			) {
				const links = nestedLinksByStrong.get(host) ?? [];
				links.push({
					closeFrom: link.labelTo,
					from: link.from,
					kind: "link",
					openTo: link.labelFrom,
					to: link.to,
				});
				nestedLinksByStrong.set(host, links);
			}
		}
	}

	return filteredStrongSpans.map((span) => {
		const container =
			sortedLeafContainers[
				firstRangeEndingAfter(sortedLeafContainers, span.from)
			];
		const matchesContainer =
			undefined !== container &&
			container.from <= span.from &&
			container.to >= span.to;
		const slice = matchesContainer
			? resolveContainerSliceRange(text, container, sortedQuoteMarks)
			: { from: span.from, to: span.to };
		const outerEmphasisSpans: SourceOuterEmphasisSpan[] = [];
		for (const outer of span.outerEmphases) {
			if (
				null === outer.openTo ||
				null === outer.closeFrom ||
				outer.openTo >= outer.closeFrom
			) {
				continue;
			}
			outerEmphasisSpans.push({
				closeFrom: toOriginal(outer.closeFrom),
				closeMark: text.slice(outer.closeFrom, outer.to),
				from: toOriginal(outer.from),
				openMark: text.slice(outer.from, outer.openTo),
				openTo: toOriginal(outer.openTo),
				to: toOriginal(outer.to),
			});
		}
		const nestedInlineSpans: SourceNestedInlineSpan[] = [];
		for (const nested of [...span.nestedInlineSpans, ...(nestedLinksByStrong.get(span) ?? [])]) {
			if (isContainedInSortedRanges(nested.from, nested.to, excludedStrongHosts)) continue;
			nestedInlineSpans.push({
				closeFrom: toOriginal(nested.closeFrom),
				from: toOriginal(nested.from),
				kind: nested.kind,
				openTo: toOriginal(nested.openTo),
				to: toOriginal(nested.to),
			});
		}
		nestedInlineSpans.sort((left, right) => left.from - right.from || right.to - left.to);
		return {
			closeMark: span.closeMark,
			containerFrom: toOriginal(slice.from),
			containerTo: toOriginal(slice.to),
			from: toOriginal(span.from),
			innerFrom: toOriginal(span.innerFrom),
			innerTo: toOriginal(span.innerTo),
			nestedInlineSpans,
			openMark: span.openMark,
			outerEmphasisSpans,
			to: toOriginal(span.to),
		};
	});
}

/** Returns `null` when PHP math substitution makes the whole document unverifiable. */
function parseBoldStructure(
	projection: NewlineProjection,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile,
) {
	const text = projection.text;
	const tree = parseBoldMarkdown(text);
	const parserUnverifiableRanges = getBoldMarkdownUnverifiableRanges(tree);
	const astData = collectBoldAstData(text, tree, referenceLabelCaseFoldProfile);
	const sortedLeafContainers = astData.leafContainers.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
	const sortedQuoteMarks = astData.quoteMarks.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
	// PHP `extract_math()` protects only fenced/indented code blocks (when
	// `MarkdownCodeRegionScanner::block_ranges()` precondition matches) and raw
	// HTML-blind backtick spans; Lezer's HTML-aware `InlineCode` must not decide.
	const codeBlockRanges = phpScansCodeBlocks(text)
		? mergeRanges(astData.codeBlockRanges)
		: EMPTY_RANGES;
	const rawInlineCodeRanges = scanRawMarkdownInlineCodeRanges(text, codeBlockRanges);
	const documentMathRanges = normalizeMathRanges(
		mathRanges(text, mergeRanges([...codeBlockRanges, ...rawInlineCodeRanges])),
	).ranges;
	if (
		documentMathRanges.length > 0 &&
		hasDocumentMathReclassification(
			text,
			tree,
			documentMathRanges,
			sortedLeafContainers,
			astData.rawLinkReferences,
		)
	) {
		return null;
	}
	const blockMathRanges = mergeRanges(documentMathRanges.filter((range) => range.block));
	const { definedReferenceLabels, unsupportedNonAscii } = buildReferenceLabelTable(
		astData.rawLinkReferences,
		blockMathRanges,
		referenceLabelCaseFoldProfile,
	);
	const sortedLezerStrong = astData.projectedStrongSpans.sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	const inlineStructures = resolveContainerInlineStructures(
		text, projection, sortedLeafContainers, sortedQuoteMarks, sortedLezerStrong, blockMathRanges,
		rawInlineCodeRanges, definedReferenceLabels, referenceLabelCaseFoldProfile, unsupportedNonAscii,
	);
	const mergedResolvedImages = mergeRanges(inlineStructures.resolvedImageRanges);
	const mergedHiddenLinkTails = mergeRanges(inlineStructures.hiddenLinkTailRanges);
	const excludedStrongHosts = mergeRanges([...mergedResolvedImages, ...mergedHiddenLinkTails]);
	const indivisibleRanges = mergeRanges([
		...astData.inlineCodeRanges,
		...astData.angleAutolinkRanges,
		...astData.lezerUrlRanges,
		...inlineStructures.extendedAutolinkRanges,
		...mergedResolvedImages,
		...mergedHiddenLinkTails,
	]);
	const strongSpans = materializeStrongSpans(
		text, projection, inlineStructures.strongSpans, excludedStrongHosts,
		inlineStructures.projectedResolvedLinks, sortedLeafContainers, sortedQuoteMarks,
	);

	return {
		blockMathRanges,
		definedReferenceLabels,
		hardBreaks: mergeRanges(astData.hardBreaks),
		hiddenLinkTailRanges: mergedHiddenLinkTails,
		indivisibleRanges,
		leafContainers: sortedLeafContainers,
		quoteMarks: sortedQuoteMarks,
		resolvedLinkSpans: inlineStructures.resolvedLinkSpans,
		shorthandReferenceLinks: inlineStructures.shorthandReferenceLinks,
		strongSpans,
		tree,
		unsupportedNonAscii,
		unverifiableRanges:
			parserUnverifiableRanges.length > 0
				? mergeRanges([
						...inlineStructures.unverifiableRanges,
						...parserUnverifiableRanges,
					])
				: inlineStructures.unverifiableRanges,
	};
}

/**
 * Extracts all CommonMark-valid boldable source segments overlapping
 * `selection` using the canonical Lezer Markdown parser and block-math ranges.
 */
export function collectBoldableSegments(
	value: string,
	selection: EditorSelection,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile = DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
): CollectedBoldSegments {
	const projection = projectNewlines(value);
	const selStart = projectedOffsetAt(projection, selection.start);
	const selEnd = projectedOffsetAt(projection, selection.end);
	if (selStart >= selEnd) return EMPTY_COLLECTED_SEGMENTS;

	const structure = parseBoldStructure(projection, referenceLabelCaseFoldProfile);
	if (!structure) return EMPTY_COLLECTED_SEGMENTS;
	if (hasRangeOverlap(structure.unverifiableRanges, selStart, selEnd)) {
		return {
			...EMPTY_COLLECTED_SEGMENTS,
			definedReferenceLabels: structure.definedReferenceLabels,
			...(structure.unsupportedNonAscii
				? { unsupportedNonAscii: structure.unsupportedNonAscii }
				: {}),
		};
	}
	const overlapsIndivisible = hasRangeOverlap(structure.indivisibleRanges, selStart, selEnd);
	const splitters = mergeRanges([...structure.blockMathRanges, ...structure.hardBreaks]);
	const segments: SourceBoldSegment[] = [];
	const containerHostByStart = new Map<number, ContainerHostInfo>();
	const firstContainer = firstRangeEndingAfter(structure.leafContainers, selStart);

	for (let index = firstContainer; index < structure.leafContainers.length; index += 1) {
		const container = structure.leafContainers[index];
		if (!container || container.from >= selEnd) break;
		const slice = resolveContainerSliceRange(projection.text, container, structure.quoteMarks);
		const containerFrom = originalOffsetAt(projection, slice.from);
		const containerTo = originalOffsetAt(projection, slice.to);
		if (
			container.isNonParagraphHost ||
			container.taskMarkerLength > 0 ||
			container.isListItemParagraph ||
			container.blockContextPrefix ||
			container.listOpenerGuards
		) {
			containerHostByStart.set(containerFrom, {
				...(container.blockContextPrefix
					? { blockContextPrefix: container.blockContextPrefix }
					: {}),
				...(container.listOpenerGuards
					? {
							listOpenerGuards: container.listOpenerGuards.map((guard) => ({
								colAfterMark: guard.colAfterMark,
								contentCol: guard.contentCol,
								lineEnd: originalOffsetAt(projection, guard.lineEnd),
								markTo: originalOffsetAt(projection, guard.markTo),
							})),
						}
					: {}),
				hasExternalTaskMarker: container.taskMarkerLength > 0,
				isListItemParagraph: container.isListItemParagraph,
				isNonParagraphHost: container.isNonParagraphHost,
			});
		}
		for (const run of subtractSortedRanges(container.from, container.to, splitters)) {
			const clippedFrom = Math.max(run.from, selStart);
			const clippedTo = Math.min(run.to, selEnd);
			if (clippedFrom >= clippedTo) continue;
			const safe = clampOutsideIndivisible({ from: clippedFrom, to: clippedTo }, structure.indivisibleRanges);
			if (!safe) continue;
			const trimmed = trimProjectedBounds(projection.text, safe.from, safe.to, structure.quoteMarks);
			if (!trimmed || isContainedInSortedRanges(trimmed.from, trimmed.to, structure.hiddenLinkTailRanges)) continue;
			const original = originalRange(projection, trimmed);
			if (original.from < original.to) {
				segments.push({ containerFrom, containerTo, from: original.from, inTable: container.inTable, to: original.to });
			}
		}
	}

	const noCrlfProjection = projection.text.length === value.length;
	const collectInlineContentRuns = (rawFrom: number, rawTo: number): SourceRange[] => {
		if (rawFrom >= rawTo) return [];
		if (noCrlfProjection && 0 === splitters.length && 0 === structure.quoteMarks.length) {
			const trimmed = trimProjectedBounds(value, rawFrom, rawTo, EMPTY_RANGES);
			return trimmed ? [trimmed] : [];
		}
		const projFrom = projectedOffsetAt(projection, rawFrom);
		const projTo = projectedOffsetAt(projection, rawTo);
		if (projFrom >= projTo) return [];
		const runs: SourceRange[] = [];
		for (const sub of subtractSortedRanges(projFrom, projTo, splitters)) {
			const trimmed = trimProjectedBounds(projection.text, sub.from, sub.to, structure.quoteMarks);
			if (!trimmed) continue;
			const original = originalRange(projection, trimmed);
			if (original.from < original.to) runs.push(original);
		}
		return runs;
	};

	return {
		collectInlineContentRuns,
		containerHostByStart,
		definedReferenceLabels: structure.definedReferenceLabels,
		overlapsIndivisible,
		parsedDocument: { text: projection.text, tree: structure.tree },
		resolvedLinkSpans: structure.resolvedLinkSpans,
		segments,
		shorthandReferenceLinks: structure.shorthandReferenceLinks,
		strongSpans: structure.strongSpans,
		...(structure.unsupportedNonAscii
			? { unsupportedNonAscii: structure.unsupportedNonAscii }
			: {}),
	};
}
