import {
	DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
	normalizeBoldReferenceLabel,
	type SourceShorthandReferenceLink,
} from "./editor-markdown-link-primitives";
import {
	canonicalizeUnsupportedReferenceLabel,
	type ReferenceLabelCaseFoldProfile,
} from "./reference-label-normalization";

/**
 * One planned source replacement for context-menu Bold. `unwrapPrefixLength`
 * and `excludeFromSelectionEnd` steer selection mapping through the edit.
 */
export type PlannedBoldReplacement = Readonly<{
	excludeFromSelectionEnd?: boolean;
	from: number;
	insert: string;
	to: number;
	unwrapPrefixLength?: number;
}>;

function normalizeLabelForPreservation(
	raw: string,
	profile: ReferenceLabelCaseFoldProfile,
): string | null {
	return "unsupported" === profile
		? (canonicalizeUnsupportedReferenceLabel(raw)?.key ?? null)
		: normalizeBoldReferenceLabel(raw, profile);
}

/** Sorts, deduplicates exact-match edits, and rejects overlapping/inverted ranges. */
export function deduplicateAndValidateReplacements(
	replacements: ReadonlyArray<PlannedBoldReplacement>,
): PlannedBoldReplacement[] | null {
	if (0 === replacements.length) return [];
	if (1 === replacements.length) {
		const only = replacements[0];
		return only && only.from <= only.to ? [only] : null;
	}
	const sorted = [...replacements].sort((l, r) => l.from - r.from || l.to - r.to);
	const unique: PlannedBoldReplacement[] = [];
	for (const edit of sorted) {
		if (edit.from > edit.to) return null;
		const prev = unique[unique.length - 1];
		if (prev) {
			if (prev.from === edit.from && prev.to === edit.to && prev.insert === edit.insert) continue;
			if (edit.from < prev.to) return null;
		}
		unique.push(edit);
	}
	return unique;
}

/** Applies validated replacements to `slice` starting at `sliceOrigin`. */
export function applyReplacementsToSlice(
	slice: string,
	sliceOrigin: number,
	replacements: ReadonlyArray<PlannedBoldReplacement>,
): string | null {
	const sorted = deduplicateAndValidateReplacements(replacements);
	if (!sorted) return null;
	const chunks: string[] = [];
	let cursor = 0;
	for (const edit of sorted) {
		const localFrom = edit.from - sliceOrigin;
		const localTo = edit.to - sliceOrigin;
		if (localFrom < cursor || localTo > slice.length) return null;
		chunks.push(slice.slice(cursor, localFrom), edit.insert);
		cursor = localTo;
	}
	chunks.push(slice.slice(cursor));
	return chunks.join("");
}

/**
 * Returns preservation edits that convert modified shortcut (`[label]`) or
 * collapsed (`[label][]`) reference links into full reference links
 * (`[edited][label]`) whenever replacements inside the label change its
 * normalized reference key.
 */
export function collectShorthandReferencePreservationEdits(
	value: string,
	edits: ReadonlyArray<PlannedBoldReplacement>,
	shorthandLinks: ReadonlyArray<SourceShorthandReferenceLink>,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile = DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
): PlannedBoldReplacement[] {
	if (0 === shorthandLinks.length || 0 === edits.length) return [];
	const sortedEdits = deduplicateAndValidateReplacements(edits);
	if (!sortedEdits || 0 === sortedEdits.length) return [];
	const minEditFrom = sortedEdits[0]?.from ?? 0;
	const maxEditTo = sortedEdits[sortedEdits.length - 1]?.to ?? minEditFrom;
	let low = 0;
	let high = shorthandLinks.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((shorthandLinks[mid]?.labelTo ?? 0) < minEditFrom) low = mid + 1;
		else high = mid;
	}
	const preserved: PlannedBoldReplacement[] = [];
	let editCursor = 0;
	for (let i = low; i < shorthandLinks.length; i += 1) {
		const link = shorthandLinks[i];
		if (!link || link.labelFrom > maxEditTo) break;
		while (editCursor < sortedEdits.length && (sortedEdits[editCursor]?.from ?? 0) < link.labelFrom) {
			editCursor += 1;
		}
		let nextLabel = "";
		let cursor = link.labelFrom;
		let modified = false;
		while (editCursor < sortedEdits.length && (sortedEdits[editCursor]?.from ?? 0) <= link.labelTo) {
			const edit = sortedEdits[editCursor];
			editCursor += 1;
			if (!edit || edit.to > link.labelTo || (edit.from === edit.to && 0 === edit.insert.length)) {
				continue;
			}
			nextLabel += value.slice(cursor, edit.from) + edit.insert;
			cursor = edit.to;
			modified = true;
		}
		if (!modified) continue;
		nextLabel += value.slice(cursor, link.labelTo);
		const normalizedNext = normalizeLabelForPreservation(
			nextLabel.includes(">")
				? nextLabel.replace(/\r?\n(?:[ \t]{0,3}>[ \t]?)+/gu, "\n")
				: nextLabel,
			referenceLabelCaseFoldProfile,
		);
		if (null === normalizedNext || normalizedNext === link.normalizedLabel) continue;
		if (
			normalizeLabelForPreservation(link.rawLabel, referenceLabelCaseFoldProfile) !==
			link.normalizedLabel
		) {
			continue;
		}
		const insertAt = link.collapsedEmptyCloseOffset ?? link.closeBracketOffset + 1;
		preserved.push({
			excludeFromSelectionEnd: true,
			from: insertAt,
			insert: null !== link.collapsedEmptyCloseOffset ? link.rawLabel : `[${link.rawLabel}]`,
			to: insertAt,
		});
	}
	return preserved;
}
