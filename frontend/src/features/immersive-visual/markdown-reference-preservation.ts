import type MarkdownIt from "markdown-it";
import { COMMONMARK_ESCAPABLE_PUNCTUATION } from "../../shared/image-scale-title";
import {
	buildRawReferenceLinkMeta,
	decodeTitleKeepingInlineMathSentinels,
	findFirstLinkOpenToken,
	PENDING_PARTIAL_TITLE_LABEL_META_KEY,
	RAW_IMAGE_TITLE_META_KEY,
	RAW_LINK_TITLE_META_KEY,
	RAW_REFERENCE_LINK_META_KEY,
	readRawMetaString,
	type TitleDecodePreScan,
} from "./markdown-parser-inline";
import { restoreProtectedInlineSentinels } from "./markdown-prescanner";
import {
	firstLine,
	measureIndentColumns,
	stripUpToIndentColumns,
} from "./markdown-prescanner-containers";
import { startsParagraphInterruptingBlock } from "./markdown-prescanner-tables";

type InlineRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["inline"]["ruler"]["at"]
>[1];
type BlockRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["block"]["ruler"]["at"]
>[1];
type InlineRuleState = Parameters<InlineRuleFn>[0];
type BlockRuleState = Parameters<BlockRuleFn>[0];

export type EasyMdeBlockEnv = {
	listIndentStack?: number[] | undefined;
	preScan?: {
		protectedBlocks?: ReadonlyMap<string, unknown>;
		protectedInlines?: ReadonlyMap<string, unknown>;
		sentinel?: string;
		tableAlignMarkers?: ReadonlyMap<string, string>;
	};
	references?: Record<string, { href: string; title: string }>;
	tableAlignMarkers?: ReadonlyMap<string, string>;
};

type LazyAfterReferenceDeps = Readonly<{
	getKnownReferenceLabels: (
		refs: Record<string, { href: string; title: string }>,
	) => Set<string>;
	hasReferenceLabelMeta: (meta: unknown) => boolean;
	lheadingRule: BlockRuleFn | null;
	paragraphRule: BlockRuleFn | null;
	runReferenceRule: BlockRuleFn;
	tableRule: BlockRuleFn | null;
}>;

/**
 * Computes the column indentation of `line` relative to the deepest enclosing
 * open ancestor list item in the current blockquote frame (`<= sCount[line]`),
 * or `0` if none matches. Mirrors PHP `League\CommonMark` closing unmatched
 * inner lists before testing block starts on lazy continuations.
 */
export function getLazyListRelativeIndent(
	state: BlockRuleState,
	line: number,
): number {
	const s = state.sCount[line] ?? 0;
	const stack = (state.env as EasyMdeBlockEnv).listIndentStack;
	if (stack && stack.length > 0) {
		for (let idx = stack.length - 1; idx >= 0; idx -= 1) {
			const ancestorIndent = stack[idx] ?? 0;
			if (ancestorIndent <= s) {
				return s - ancestorIndent;
			}
		}
	}
	return state.listIndent >= 0 && s >= state.listIndent
		? s - state.listIndent
		: s;
}

function isInlineSpaceOrLf(code: number): boolean {
	return code === 0x20 || code === 0x09 || code === 0x0a;
}

export function hasReferenceLabelMeta(meta: unknown): boolean {
	return (
		meta !== null &&
		typeof meta === "object" &&
		typeof (meta as { label?: unknown }).label === "string"
	);
}

/**
 * Extracts the raw (pre-unescape) inner title slice of a matched inline link
 * or image token from `state.src` so PHP-equivalent two-pass decoding runs
 * directly on the raw Markdown title without double-decoding `markdown-it`'s
 * HTML5/Windows-1252 entity output.
 */
function extractRawInlineTitle(
	state: InlineRuleState,
	bracketPos: number,
	endPos: number,
	disableNested: boolean,
): string | null {
	const labelEnd = state.md.helpers.parseLinkLabel(
		state,
		bracketPos,
		disableNested,
	);
	if (labelEnd < 0) {
		return null;
	}
	let pos = labelEnd + 1;
	if (pos >= endPos || state.src.charCodeAt(pos) !== 40) {
		return null;
	}
	pos += 1;
	while (pos < endPos && isInlineSpaceOrLf(state.src.charCodeAt(pos))) {
		pos += 1;
	}
	if (pos >= endPos) {
		return null;
	}
	const destRes = state.md.helpers.parseLinkDestination(state.src, pos, endPos);
	if (destRes.ok) {
		const href = state.md.normalizeLink(destRes.str);
		if (state.md.validateLink(href)) {
			pos = destRes.pos;
		}
	}
	const afterDest = pos;
	while (pos < endPos && isInlineSpaceOrLf(state.src.charCodeAt(pos))) {
		pos += 1;
	}
	if (pos >= endPos || pos === afterDest) {
		return null;
	}
	const titleStart = pos;
	const titleRes = state.md.helpers.parseLinkTitle(state.src, pos, endPos);
	if (!titleRes.ok || titleRes.pos < titleStart + 2) {
		return null;
	}
	let closePos = titleRes.pos;
	while (
		closePos < endPos &&
		isInlineSpaceOrLf(state.src.charCodeAt(closePos))
	) {
		closePos += 1;
	}
	if (closePos >= endPos || state.src.charCodeAt(closePos) !== 41) {
		return null;
	}
	return state.src.slice(titleStart + 1, titleRes.pos - 1);
}

type RawReferenceParts = Readonly<{
	rawDestination: string | null;
	rawTitle: string | null;
}>;

export function extractRawReferenceParts(
	state: BlockRuleState,
	startLine: number,
	endLine: number,
): RawReferenceParts {
	const lines: string[] = [];
	for (let line = startLine; line < endLine; line += 1) {
		const lineStart = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
		const lineEnd = state.eMarks[line] ?? lineStart;
		lines.push(state.src.slice(lineStart, lineEnd));
	}
	const joined = lines.join("\n");
	if (joined.charCodeAt(0) !== 91) {
		return { rawDestination: null, rawTitle: null };
	}
	let pos = 1;
	while (pos < joined.length) {
		const ch = joined.charCodeAt(pos);
		if (ch === 91) {
			return { rawDestination: null, rawTitle: null };
		}
		if (ch === 93) {
			break;
		}
		if (ch === 92 && pos + 1 < joined.length) {
			pos += 2;
			continue;
		}
		pos += 1;
	}
	if (pos >= joined.length || joined.charCodeAt(pos + 1) !== 58) {
		return { rawDestination: null, rawTitle: null };
	}
	pos += 2;
	while (pos < joined.length && isInlineSpaceOrLf(joined.charCodeAt(pos))) {
		pos += 1;
	}
	const destStart = pos;
	const destRes = state.md.helpers.parseLinkDestination(
		joined,
		pos,
		joined.length,
	);
	if (!destRes.ok) {
		return { rawDestination: null, rawTitle: null };
	}
	const rawDestination = joined.slice(destStart, destRes.pos);
	pos = destRes.pos;
	const afterDest = pos;
	while (pos < joined.length && isInlineSpaceOrLf(joined.charCodeAt(pos))) {
		pos += 1;
	}
	if (pos >= joined.length || pos === afterDest) {
		return { rawDestination, rawTitle: null };
	}
	const titleRes = state.md.helpers.parseLinkTitle(joined, pos, joined.length);
	if (!titleRes.ok || titleRes.pos < pos + 2) {
		return { rawDestination, rawTitle: null };
	}
	return {
		rawDestination,
		rawTitle: joined.slice(pos + 1, titleRes.pos - 1),
	};
}

/**
 * Strips up to line 0's leading column indent from every line of `text`,
 * preserving relative continuation indentation while guaranteeing line 0
 * starts at column 0 (idempotent).
 */
export function dedentBlockToLineZero(text: string): string {
	const baseIndent = measureIndentColumns(firstLine(text));
	if (baseIndent <= 0) {
		return text;
	}
	return text
		.split("\n")
		.map((line) => stripUpToIndentColumns(line, baseIndent))
		.join("\n");
}

/**
 * Extracts the container-stripped canonical raw source lines of a
 * `reference_definition` while `markdown-it`'s block state still carries the
 * exact per-line container offsets (`bMarks`, `tShift`, `sCount`, `bsCount`,
 * `blkIndent`), dedenting cosmetic block-level indent to column 0.
 */
export function extractRawReferenceBlock(
	state: BlockRuleState,
	startLine: number,
	endLine: number,
): string {
	const lines: string[] = [];
	for (let line = startLine; line < endLine; line += 1) {
		const bMark = state.bMarks[line] ?? 0;
		const eMark = state.eMarks[line] ?? bMark;
		if (state.blkIndent === 0 && (state.bsCount[line] ?? 0) === 0) {
			lines.push(state.src.slice(bMark, eMark));
			continue;
		}
		const contentStart = bMark + (state.tShift[line] ?? 0);
		const relativeIndent = Math.max(
			0,
			(state.sCount[line] ?? 0) - state.blkIndent,
		);
		lines.push(
			`${" ".repeat(relativeIndent)}${state.src.slice(contentStart, eMark)}`,
		);
	}
	return dedentBlockToLineZero(lines.join("\n"));
}

/**
 * Computes the exact effective partial reference title accumulated by PHP
 * `League\CommonMark\Reference\ReferenceParser::parseStartTitle()` and
 * `parseTitle()` (via `LinkParserHelper::parsePartialLinkTitle()`) when a
 * title-less reference definition is immediately followed by paragraph,
 * Setext heading, or GFM table header lines starting with `"`, `'`, or `(`.
 */
export function extractPhpPartialReferenceTitle(
	lines: ReadonlyArray<string>,
	preScan?: TitleDecodePreScan,
): string | null {
	if (lines.length === 0) {
		return null;
	}
	const firstLine = lines[0] ?? "";
	let pos = 0;
	while (
		pos < firstLine.length &&
		(firstLine.charCodeAt(pos) === 0x20 || firstLine.charCodeAt(pos) === 0x09)
	) {
		pos += 1;
	}
	const openChar = firstLine[pos];
	const endDelim: '"' | "'" | ")" | null =
		openChar === '"'
			? '"'
			: openChar === "'"
				? "'"
				: openChar === "("
					? ")"
					: null;
	if (endDelim === null) {
		return null;
	}

	let title = "";
	let lineIdx = 0;
	pos += 1;
	if (pos >= firstLine.length) {
		title += "\n";
		lineIdx = 1;
		pos = 0;
	}

	for (; lineIdx < lines.length; lineIdx += 1) {
		const line = lines[lineIdx] ?? "";
		let cursor = lineIdx === 0 ? pos : 0;
		const chunkStart = cursor;
		while (cursor < line.length) {
			const ch = line[cursor];
			if (
				ch === "\\" &&
				cursor + 1 < line.length &&
				COMMONMARK_ESCAPABLE_PUNCTUATION.test(line[cursor + 1] ?? "")
			) {
				cursor += 2;
				continue;
			}
			if (ch === endDelim) {
				cursor += 1;
				break;
			}
			if (ch === "\u0000") {
				break;
			}
			cursor += 1;
		}
		let decoded = decodeTitleKeepingInlineMathSentinels(
			line.slice(chunkStart, cursor),
			preScan,
		);
		let endDelimiterFound = false;
		if (decoded.endsWith(endDelim)) {
			endDelimiterFound = true;
			decoded = decoded.slice(0, -1);
		}
		title += decoded;
		if (!endDelimiterFound && cursor >= line.length) {
			title += "\n";
			continue;
		}
		break;
	}
	return preScan ? restoreProtectedInlineSentinels(title, preScan) : title;
}

type PartialTitleBlockEnv = {
	preScan?: TitleDecodePreScan;
	references?: Record<string, { href: string; title: string }>;
};

/**
 * Populates `env.references[label].title` with PHP `League\CommonMark`'s exact
 * partial title when `startLine..contentEndLine` immediately follows a
 * title-less `reference_definition` in the same container.
 */
export function applyPendingPartialReferenceTitle(
	state: BlockRuleState,
	startLine: number,
	contentEndLine: number,
): void {
	if (contentEndLine <= startLine) {
		return;
	}
	const prevToken = state.tokens[state.tokens.length - 1];
	if (
		prevToken?.type !== "reference_definition" ||
		prevToken.level !== state.level ||
		prevToken.map?.[1] !== startLine
	) {
		return;
	}
	const pendingLabel = readRawMetaString(
		prevToken,
		PENDING_PARTIAL_TITLE_LABEL_META_KEY,
	);
	if (pendingLabel === null) {
		return;
	}
	const env = state.env as PartialTitleBlockEnv;
	const entry = env.references?.[pendingLabel];
	if (!entry) {
		return;
	}
	const lines: string[] = [];
	for (let line = startLine; line < contentEndLine; line += 1) {
		const linePos = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
		const lineMax = state.eMarks[line] ?? linePos;
		lines.push(state.src.slice(linePos, lineMax));
	}
	const partialTitle = extractPhpPartialReferenceTitle(lines, env.preScan);
	if (partialTitle !== null && partialTitle.length > 0) {
		entry.title = partialTitle;
	}
}

function attachTokenReferenceOrTitleMeta(
	token: InlineRuleState["tokens"][number],
	state: InlineRuleState,
	bracketPos: number,
	disableNested: boolean,
	rawTitleKey: string,
): void {
	if (hasReferenceLabelMeta(token.meta)) {
		const refMeta = buildRawReferenceLinkMeta(
			state.src,
			bracketPos,
			state.md.helpers.parseLinkLabel(state, bracketPos, disableNested),
			state.pos,
			(token.meta as { label: string }).label,
		);
		if (refMeta !== null) {
			(token.meta as Record<string, unknown>)[RAW_REFERENCE_LINK_META_KEY] =
				refMeta;
		}
		return;
	}
	const rawTitle = extractRawInlineTitle(
		state,
		bracketPos,
		state.pos,
		disableNested,
	);
	if (rawTitle !== null) {
		const meta: Record<string, unknown> =
			token.meta && typeof token.meta === "object"
				? (token.meta as Record<string, unknown>)
				: Object.create(null);
		meta[rawTitleKey] = rawTitle;
		token.meta = meta;
	}
}

export function attachImageReferenceOrTitleMeta(
	state: InlineRuleState,
	startPos: number,
): void {
	const imageToken = state.tokens[state.tokens.length - 1];
	if (imageToken?.type === "image") {
		attachTokenReferenceOrTitleMeta(
			imageToken,
			state,
			startPos + 1,
			false,
			RAW_IMAGE_TITLE_META_KEY,
		);
	}
}

export function attachLinkReferenceOrTitleMeta(
	state: InlineRuleState,
	startPos: number,
	tokensBefore: number,
): void {
	const linkOpenToken = findFirstLinkOpenToken(state.tokens, tokensBefore);
	if (linkOpenToken) {
		attachTokenReferenceOrTitleMeta(
			linkOpenToken,
			state,
			startPos,
			true,
			RAW_LINK_TITLE_META_KEY,
		);
	}
}

/**
 * Mirrors PHP `League\CommonMark` keeping `ParagraphParser` open inside a
 * blockquote or list item after extracting a reference definition: consumes
 * non-interrupting lazy continuation lines (`sCount < blkIndent`) before
 * `ParserBlock.tokenize`'s `sCount[line] < blkIndent` guard prematurely closes
 * the enclosing container, while leaving a trailing `< 4`-indented standalone
 * refdef (`> [a]: /a\n[b]: /b`) outside the blockquote when no lazy content
 * follows it.
 */
export function continueLazyAfterReference(
	state: BlockRuleState,
	endLine: number,
	deps: LazyAfterReferenceDeps,
): void {
	const {
		getKnownReferenceLabels,
		hasReferenceLabelMeta: checkReferenceLabelMeta,
		lheadingRule,
		paragraphRule,
		runReferenceRule,
		tableRule,
	} = deps;
	while (
		state.line < endLine &&
		!state.isEmpty(state.line) &&
		(state.sCount[state.line] ?? 0) < state.blkIndent
	) {
		const lazyLine = state.line;
		const lazySCount = state.sCount[lazyLine] ?? 0;
		const lp = (state.bMarks[lazyLine] ?? 0) + (state.tShift[lazyLine] ?? 0);
		const lm = state.eMarks[lazyLine] ?? lp;
		const blockEnv = state.env as EasyMdeBlockEnv;
		if (lazySCount >= 0) {
			const lazyTrimmed = state.src.slice(lp, lm);
			const lazyRelIndent = getLazyListRelativeIndent(state, lazyLine);
			const lazyStartCol = (state.bsCount[lazyLine] ?? 0) + lazySCount;
			if (
				startsParagraphInterruptingBlock(lazyTrimmed, lazyStartCol, {
					allowIndentedCode: false,
					relativeIndentColumns: lazyRelIndent,
				})
			) {
				break;
			}
			if (lazyRelIndent < 4) {
				const sentinelText = lazyTrimmed.replace(/^[ \t]+|[ \t]+$/g, "");
				if (
					blockEnv.preScan?.protectedBlocks?.has(sentinelText) ||
					blockEnv.tableAlignMarkers?.has(sentinelText)
				) {
					break;
				}
			}
		}
		if (tableRule?.(state, lazyLine, endLine, false)) {
			break;
		}
		const tokensBeforeLazyRef = state.tokens.length;
		const knownBeforeLazyRef = blockEnv.references
			? getKnownReferenceLabels(blockEnv.references)
			: null;
		const lazyRawIndent =
			lazySCount < 0
				? measureIndentColumns(
						state.src.slice(state.bMarks[lazyLine] ?? 0, lm),
						state.bsCount[lazyLine] ?? 0,
					)
				: 0;
		const prevKnownSize = knownBeforeLazyRef?.size ?? 0;
		if (runReferenceRule(state, lazyLine, endLine, false)) {
			if (
				lazySCount < 0 &&
				lazyRawIndent < 4 &&
				(state.line >= endLine || state.isEmpty(state.line))
			) {
				const addedToken = state.tokens[state.tokens.length - 1];
				const addedLabel =
					addedToken?.type === "reference_definition" &&
					checkReferenceLabelMeta(addedToken.meta)
						? (addedToken.meta as { label: string }).label
						: null;
				state.tokens.length = tokensBeforeLazyRef;
				if (
					addedLabel !== null &&
					blockEnv.references &&
					(knownBeforeLazyRef === null ||
						knownBeforeLazyRef.size > prevKnownSize)
				) {
					delete blockEnv.references[addedLabel];
					knownBeforeLazyRef?.delete(addedLabel);
				}
				state.line = lazyLine;
				break;
			}
			continue;
		}
		if (lheadingRule?.(state, lazyLine, endLine, false)) {
			break;
		}
		if (paragraphRule?.(state, lazyLine, endLine, false)) {
			break;
		}
		break;
	}
}
