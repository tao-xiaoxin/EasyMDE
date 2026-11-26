import {
	appendAll,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import type {
	SourceNestedInlineSpan,
	SourceOuterEmphasisSpan,
	SourceStrongSpan,
} from "./editor-context-menu-bold-segments";
import {
	type BoldVerifyContext,
	verifyFullUnboldPlan,
} from "./editor-context-menu-bold-verify";
import {
	collectShorthandReferencePreservationEdits,
	type PlannedBoldReplacement,
} from "./editor-context-menu-bold-edits";
import type { SourceShorthandReferenceLink } from "./editor-markdown-link-primitives";
import type { ReferenceLabelCaseFoldProfile } from "./reference-label-normalization";

const MAX_OUTER_EMPHASIS_UPGRADE_ATTEMPTS = 8;

export type InlineContentRunCollector = (
	from: number,
	to: number,
) => ReadonlyArray<Readonly<{ from: number; to: number }>>;

export type UnboldContainerGroup = {
	containerFrom: number;
	containerTo: number;
	enclosedBySpan: Map<SourceStrongSpan, SourceRange[]>;
	wrappedEdits: PlannedBoldReplacement[];
	wrappedTargets: SourceRange[];
};

type EnclosedSpanUnboldPlan = Readonly<{
	asteriskEdits: ReadonlyArray<PlannedBoldReplacement>;
	boldRuns: ReadonlyArray<SourceRange>;
	enclosing: SourceStrongSpan;
	hasAlternatives: boolean;
	hasNonAsteriskDelimiter: boolean;
	pieces: ReadonlyArray<SourceRange>;
	primaryEdits: ReadonlyArray<PlannedBoldReplacement>;
}>;

export function withShorthandReferenceEdits(
	value: string,
	base: ReadonlyArray<PlannedBoldReplacement>,
	shorthandLinks: ReadonlyArray<SourceShorthandReferenceLink>,
	profile: ReferenceLabelCaseFoldProfile | undefined,
): PlannedBoldReplacement[] {
	const preserved = collectShorthandReferencePreservationEdits(
		value,
		base,
		shorthandLinks,
		profile,
	);
	return preserved.length > 0 ? [...base, ...preserved] : [...base];
}

function splitRemainingAcrossNestedInlineSpans(
	rawRanges: ReadonlyArray<SourceRange>,
	nestedSpans: ReadonlyArray<SourceNestedInlineSpan>,
): SourceRange[] {
	if (0 === nestedSpans.length) return [...rawRanges];
	let current = [...rawRanges];
	for (const nested of nestedSpans) {
		const next: SourceRange[] = [];
		for (const range of current) {
			if (range.to <= nested.from || range.from >= nested.to) {
				next.push(range);
				continue;
			}
			if (range.from <= nested.from && range.to >= nested.to) {
				next.push(range);
				continue;
			}
			if (range.from >= nested.openTo && range.to <= nested.closeFrom) {
				next.push(range);
				continue;
			}
			if (range.from < nested.from) {
				next.push({ from: range.from, to: Math.min(range.to, nested.from) });
			}
			const innerFrom = Math.max(range.from, nested.openTo);
			const innerTo = Math.min(range.to, nested.closeFrom);
			if (innerFrom < innerTo) next.push({ from: innerFrom, to: innerTo });
			if (range.to > nested.to) {
				next.push({ from: Math.max(range.from, nested.to), to: range.to });
			}
		}
		current = next;
	}
	return current;
}

function buildPartialUnwrapReplacements(
	enclosing: SourceStrongSpan,
	boldRuns: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	openMark: string,
	closeMark: string,
): PlannedBoldReplacement[] {
	const replacements: PlannedBoldReplacement[] = [];
	const firstRun = boldRuns[0];
	const lastRun = boldRuns[boldRuns.length - 1];
	if (!firstRun || !lastRun) {
		replacements.push({ from: enclosing.from, insert: "", to: enclosing.innerFrom });
		replacements.push({ from: enclosing.innerTo, insert: "", to: enclosing.to });
		return replacements;
	}

	if (firstRun.from === enclosing.innerFrom) {
		if (openMark !== enclosing.openMark) {
			replacements.push({ from: enclosing.from, insert: openMark, to: enclosing.innerFrom });
		}
	} else {
		replacements.push({ from: enclosing.from, insert: "", to: enclosing.innerFrom });
		replacements.push({ from: firstRun.from, insert: openMark, to: firstRun.from });
	}

	for (let index = 0; index < boldRuns.length; index += 1) {
		const run = boldRuns[index];
		if (!run) continue;
		if (index > 0) {
			replacements.push({ from: run.from, insert: openMark, to: run.from });
		}
		if (index < boldRuns.length - 1 || run.to < enclosing.innerTo) {
			replacements.push({ from: run.to, insert: closeMark, to: run.to });
		}
	}

	if (lastRun.to === enclosing.innerTo) {
		if (closeMark !== enclosing.closeMark) {
			replacements.push({ from: enclosing.innerTo, insert: closeMark, to: enclosing.to });
		}
	} else {
		replacements.push({ from: enclosing.innerTo, insert: "", to: enclosing.to });
	}

	return replacements;
}

function withOuterEmphasisUpgrade(
	baseReplacements: ReadonlyArray<PlannedBoldReplacement>,
	outer: SourceOuterEmphasisSpan,
	nextDelimiter: string,
): PlannedBoldReplacement[] {
	return [
		{ from: outer.from, insert: nextDelimiter, to: outer.openTo },
		...baseReplacements,
		{ from: outer.closeFrom, insert: nextDelimiter, to: outer.to },
	];
}

function computeEnclosedRemainingBoldRuns(
	enclosing: SourceStrongSpan,
	pieces: ReadonlyArray<SourceRange>,
	collectInlineContentRuns: InlineContentRunCollector,
): SourceRange[] {
	const rawRemaining: SourceRange[] = [];
	let cursor = enclosing.innerFrom;
	for (const piece of pieces) {
		if (piece.from > cursor) rawRemaining.push({ from: cursor, to: piece.from });
		cursor = Math.max(cursor, piece.to);
	}
	if (cursor < enclosing.innerTo) {
		rawRemaining.push({ from: cursor, to: enclosing.innerTo });
	}
	const splitRemaining = splitRemainingAcrossNestedInlineSpans(
		rawRemaining,
		enclosing.nestedInlineSpans,
	);
	const boldRuns: SourceRange[] = [];
	for (const range of splitRemaining) {
		for (const run of collectInlineContentRuns(range.from, range.to)) {
			boldRuns.push(run);
		}
	}
	return boldRuns;
}

function hasEnclosedFallbackAlternatives(
	enclosing: SourceStrongSpan,
	boldRuns: ReadonlyArray<SourceRange>,
): boolean {
	if (0 === boldRuns.length) return false;
	if ("**" !== enclosing.openMark || "**" !== enclosing.closeMark) return true;
	return enclosing.outerEmphasisSpans.some(
		(outer) => "*" === outer.openMark && "*" === outer.closeMark,
	);
}

function resolveFallbackEditsForEnclosedSpan(
	value: string,
	containerFrom: number,
	containerTo: number,
	plan: EnclosedSpanUnboldPlan,
	shorthandLinks: ReadonlyArray<SourceShorthandReferenceLink>,
	verifyContext: BoldVerifyContext,
	budget: { remaining: number },
	reserveVerifications: number,
	includePrimary: boolean,
): Readonly<{
	base: ReadonlyArray<PlannedBoldReplacement>;
	withRefs: PlannedBoldReplacement[];
}> | null {
	const tryCandidate = (
		base: ReadonlyArray<PlannedBoldReplacement>,
	): Readonly<{
		base: ReadonlyArray<PlannedBoldReplacement>;
		withRefs: PlannedBoldReplacement[];
	}> | null => {
		if (budget.remaining <= reserveVerifications) return null;
		budget.remaining -= 1;
		const withRefs = withShorthandReferenceEdits(
			value,
			base,
			shorthandLinks,
			verifyContext.referenceLabelCaseFoldProfile,
		);
		return verifyFullUnboldPlan(
			value,
			containerFrom,
			containerTo,
			plan.pieces,
			withRefs,
			verifyContext,
		)
			? { base, withRefs }
			: null;
	};

	if (includePrimary) {
		const verifiedPrimary = tryCandidate(plan.primaryEdits);
		if (verifiedPrimary) return verifiedPrimary;
	}

	const { asteriskEdits, enclosing } = plan;
	if (plan.hasNonAsteriskDelimiter) {
		const verifiedAsterisk = tryCandidate(asteriskEdits);
		if (verifiedAsterisk) return verifiedAsterisk;
	}

	// CommonMark §6.2 Rule 9/10: when `**` sits inside an active `*...*`
	// emphasis (e.g. `***one two three***`), intraword `**` splits can collide
	// with the outer `*`. Try upgrading the enclosing `*...*` to `_..._`.
	let upgradeAttempts = 0;
	for (
		let index = enclosing.outerEmphasisSpans.length - 1;
		index >= 0 &&
		upgradeAttempts < MAX_OUTER_EMPHASIS_UPGRADE_ATTEMPTS &&
		budget.remaining > reserveVerifications;
		index -= 1
	) {
		const outer = enclosing.outerEmphasisSpans[index];
		if ("*" !== outer?.openMark || "*" !== outer.closeMark) continue;
		upgradeAttempts += 1;
		const verifiedUpgraded = tryCandidate(
			withOuterEmphasisUpgrade(asteriskEdits, outer, "_"),
		);
		if (verifiedUpgraded) return verifiedUpgraded;
	}

	return null;
}

function collectUniqueContainerOuterEmphases(
	enclosedPlans: ReadonlyArray<EnclosedSpanUnboldPlan>,
	existingBase: ReadonlyArray<PlannedBoldReplacement>,
): SourceOuterEmphasisSpan[] {
	const seen = new Set<string>();
	const unique: SourceOuterEmphasisSpan[] = [];
	for (const plan of enclosedPlans) {
		for (let i = plan.enclosing.outerEmphasisSpans.length - 1; i >= 0; i -= 1) {
			const outer = plan.enclosing.outerEmphasisSpans[i];
			if ("*" !== outer?.openMark || "*" !== outer.closeMark) continue;
			const key = `${outer.from}:${outer.to}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const overlapsExisting = existingBase.some(
				(edit) =>
					(edit.from < outer.openTo && edit.to > outer.from) ||
					(edit.from < outer.to && edit.to > outer.closeFrom),
			);
			if (!overlapsExisting) unique.push(outer);
		}
	}
	unique.sort(
		(left, right) =>
			left.to - left.from - (right.to - right.from) || left.from - right.from,
	);
	return unique;
}

/**
 * Verifies all wrapped and partial-enclosed unbold edits for one leaf
 * container together in one `verifyFullUnboldPlan` pass, falling back to
 * delimiter switches / outer `*...*` upgrades under one shared container
 * verification budget only when the combined primary plan fails.
 */
export function planVerifiedContainerUnboldReplacements(
	value: string,
	group: UnboldContainerGroup,
	collectInlineContentRuns: InlineContentRunCollector,
	shorthandLinks: ReadonlyArray<SourceShorthandReferenceLink>,
	verifyContext: BoldVerifyContext,
	maxFallbackVerifications: number,
): PlannedBoldReplacement[] | null {
	const profile = verifyContext.referenceLabelCaseFoldProfile;
	const enclosedPlans: EnclosedSpanUnboldPlan[] = [];
	const allTargets: SourceRange[] = [...group.wrappedTargets];
	const allPrimaryBase: PlannedBoldReplacement[] = [...group.wrappedEdits];

	for (const [enclosing, spanPieces] of group.enclosedBySpan) {
		if (0 === spanPieces.length) continue;
		const boldRuns = computeEnclosedRemainingBoldRuns(
			enclosing,
			spanPieces,
			collectInlineContentRuns,
		);
		const primaryEdits = buildPartialUnwrapReplacements(
			enclosing,
			boldRuns,
			enclosing.openMark,
			enclosing.closeMark,
		);
		const hasNonAsteriskDelimiter =
			boldRuns.length > 0 &&
			("**" !== enclosing.openMark || "**" !== enclosing.closeMark);
		const asteriskEdits = hasNonAsteriskDelimiter
			? buildPartialUnwrapReplacements(enclosing, boldRuns, "**", "**")
			: primaryEdits;
		enclosedPlans.push({
			asteriskEdits,
			boldRuns,
			enclosing,
			hasAlternatives: hasEnclosedFallbackAlternatives(enclosing, boldRuns),
			hasNonAsteriskDelimiter,
			pieces: spanPieces,
			primaryEdits,
		});
		appendAll(allTargets, spanPieces);
		appendAll(allPrimaryBase, primaryEdits);
	}

	const verifyCombinedBase = (
		base: ReadonlyArray<PlannedBoldReplacement>,
	): PlannedBoldReplacement[] | null => {
		const withRefs = withShorthandReferenceEdits(
			value,
			base,
			shorthandLinks,
			profile,
		);
		return verifyFullUnboldPlan(
			value,
			group.containerFrom,
			group.containerTo,
			allTargets,
			withRefs,
			verifyContext,
		)
			? withRefs
			: null;
	};

	const verifiedPrimary = verifyCombinedBase(allPrimaryBase);
	if (verifiedPrimary) return verifiedPrimary;

	if (!enclosedPlans.some((plan) => plan.hasAlternatives)) return null;

	const budget = { remaining: maxFallbackVerifications };
	if (0 === group.wrappedEdits.length && 1 === enclosedPlans.length) {
		const onlyPlan = enclosedPlans[0];
		if (!onlyPlan) return null;
		const resolved = resolveFallbackEditsForEnclosedSpan(
			value,
			group.containerFrom,
			group.containerTo,
			onlyPlan,
			shorthandLinks,
			verifyContext,
			budget,
			0,
			false,
		);
		return resolved ? resolved.withRefs : null;
	}

	// Step 1 (fast path): switch all non-`**` enclosed spans to `**` together
	// in one combined verification before falling back to per-span search.
	const hasAnyNonAsterisk = enclosedPlans.some(
		(plan) => plan.hasNonAsteriskDelimiter,
	);
	let triedCombinedAsterisk = false;
	if (hasAnyNonAsterisk && budget.remaining > 0) {
		triedCombinedAsterisk = true;
		budget.remaining -= 1;
		const combinedAsteriskBase: PlannedBoldReplacement[] = [...group.wrappedEdits];
		for (const plan of enclosedPlans) {
			appendAll(combinedAsteriskBase, plan.asteriskEdits);
		}
		const verifiedAsterisk = verifyCombinedBase(combinedAsteriskBase);
		if (verifiedAsterisk) return verifiedAsterisk;
	}

	// Step 2: resolve per-span fallbacks within the shared container budget.
	const resolvedBase: PlannedBoldReplacement[] = [...group.wrappedEdits];
	let matchesPrimary = true;
	let matchesAsterisk = true;
	for (const plan of enclosedPlans) {
		if (!plan.hasAlternatives) {
			appendAll(resolvedBase, plan.primaryEdits);
			continue;
		}
		const resolved = resolveFallbackEditsForEnclosedSpan(
			value,
			group.containerFrom,
			group.containerTo,
			plan,
			shorthandLinks,
			verifyContext,
			budget,
			1,
			true,
		);
		if (!resolved) return null;
		if (resolved.base !== plan.primaryEdits) matchesPrimary = false;
		if (resolved.base !== plan.asteriskEdits) matchesAsterisk = false;
		appendAll(resolvedBase, resolved.base);
	}

	if (!matchesPrimary && !(triedCombinedAsterisk && matchesAsterisk)) {
		if (budget.remaining <= 0) return null;
		budget.remaining -= 1;
		const verifiedCombined = verifyCombinedBase(resolvedBase);
		if (verifiedCombined) return verifiedCombined;
	}

	// Step 3: if individual spans succeeded with `**` but their combined edits
	// collide with a shared enclosing `*...*` (e.g. `*__ab__ __cd__*`), try
	// upgrading unique enclosing `*...*` spans on the combined `resolvedBase`.
	const outerCandidates = collectUniqueContainerOuterEmphases(
		enclosedPlans,
		resolvedBase,
	);
	let upgradeAttempts = 0;
	for (const outer of outerCandidates) {
		if (
			upgradeAttempts >= MAX_OUTER_EMPHASIS_UPGRADE_ATTEMPTS ||
			budget.remaining <= 0
		) {
			break;
		}
		upgradeAttempts += 1;
		budget.remaining -= 1;
		const verifiedUpgraded = verifyCombinedBase(
			withOuterEmphasisUpgrade(resolvedBase, outer, "_"),
		);
		if (verifiedUpgraded) return verifiedUpgraded;
	}

	return null;
}
