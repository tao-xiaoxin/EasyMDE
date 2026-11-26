import type { SourceRange } from "../../shared/markdown/markdown-source-projection";
import { hasMultibyteCodeUnit } from "../../shared/markdown/markdown-char-codes";
import {
	type AngleScanCache,
	getLastAt,
	getLastCloseAngle,
	LEAGUE_HTML_ASCII_DIALECT,
	LEAGUE_HTML_MULTIBYTE_DIALECT,
	matchAngleEmailAutolinkAt,
	matchLeagueAngleUriAt,
	matchLeagueHtmlInlineAt,
} from "../../shared/markdown/markdown-html-scanners";
import {
	addBacktickRunToBuckets,
	type BacktickRunBucket,
} from "../../shared/markdown/markdown-backtick-scanners";

/**
 * Stage 2 of the single-pass League CommonMark 2.8.2 inline model: strictly
 * O(N), non-overlapping per-parser pre-scans (`BacktickParser`,
 * `AutolinkParser`, `HtmlInlineParser`) consumed by the Stage 3 cursor walk in
 * `editor-markdown-league-inline.ts`.
 */

export const MAX_LEAGUE_BACKTICKS = 1_000;

export function preScanLeagueBackticks(text: string): Readonly<{
	closerBucketsBySize: Map<number, BacktickRunBucket>;
	openers: SourceRange[];
}> {
	const openers: SourceRange[] = [];
	const closerBucketsBySize = new Map<number, BacktickRunBucket>();
	let i = text.indexOf("`");
	if (i < 0) return { closerBucketsBySize, openers };
	const len = text.length;
	while (i >= 0) {
		const start = i;
		i += 1;
		while (i < len && 96 === text.charCodeAt(i)) i += 1;
		openers.push({ from: start, to: i });
		// Mirror `BacktickParser::findMatchingTicks()` (`/`{1,1000}/m`): slice
		// maximal runs into left-to-right chunks of at most 1,000 backticks.
		let chunkPos = start;
		let remaining = i - start;
		while (remaining > 0) {
			const chunkLen =
				remaining > MAX_LEAGUE_BACKTICKS ? MAX_LEAGUE_BACKTICKS : remaining;
			addBacktickRunToBuckets(closerBucketsBySize, chunkLen, chunkPos);
			chunkPos += chunkLen;
			remaining -= chunkLen;
		}
		i = text.indexOf("`", i);
	}
	return { closerBucketsBySize, openers };
}

export function preScanLeagueAngleAutolinks(
	text: string,
	cache: AngleScanCache,
): SourceRange[] {
	const matches: SourceRange[] = [];
	const len = text.length;
	let pos = text.indexOf("<");
	while (pos >= 0 && pos + 1 < len) {
		const afterStart = pos + 1;
		if (getLastCloseAngle(text, cache) <= afterStart) break;
		const emailEnd = matchAngleEmailAutolinkAt(
			text,
			afterStart,
			len,
			getLastAt(text, cache),
		);
		const end =
			emailEnd >= 0 ? emailEnd : matchLeagueAngleUriAt(text, afterStart, len);
		if (end > pos) {
			matches.push({ from: pos, to: end });
			pos = text.indexOf("<", end);
		} else {
			pos = text.indexOf("<", afterStart);
		}
	}
	return matches;
}

export function preScanLeagueHtmlInline(
	text: string,
	cache: AngleScanCache,
): SourceRange[] {
	const matches: SourceRange[] = [];
	const len = text.length;
	let pos = text.indexOf("<");
	if (pos < 0 || pos + 1 >= len || getLastCloseAngle(text, cache) <= pos + 1) {
		return matches;
	}
	const dialect = hasMultibyteCodeUnit(text)
		? LEAGUE_HTML_MULTIBYTE_DIALECT
		: LEAGUE_HTML_ASCII_DIALECT;
	while (pos >= 0 && pos + 1 < len) {
		const afterStart = pos + 1;
		if (getLastCloseAngle(text, cache) <= afterStart) break;
		const end = matchLeagueHtmlInlineAt(text, afterStart, len, cache, dialect);
		if (end > pos) {
			matches.push({ from: pos, to: end });
			pos = text.indexOf("<", end);
		} else {
			pos = text.indexOf("<", afterStart);
		}
	}
	return matches;
}

export function advanceRangeCursor(
	ranges: ReadonlyArray<SourceRange>,
	idx: number,
	pos: number,
): number {
	let cursor = idx;
	while (cursor < ranges.length && (ranges[cursor]?.from ?? -1) < pos) {
		cursor += 1;
	}
	return cursor;
}
