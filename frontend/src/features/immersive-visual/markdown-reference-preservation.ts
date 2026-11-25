import type MarkdownIt from "markdown-it";
import {
	buildRawReferenceLinkMeta,
	findFirstLinkOpenToken,
	RAW_IMAGE_TITLE_META_KEY,
	RAW_LINK_TITLE_META_KEY,
	RAW_REFERENCE_LINK_META_KEY,
} from "./markdown-parser-inline";

type InlineRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["inline"]["ruler"]["at"]
>[1];
type BlockRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["block"]["ruler"]["at"]
>[1];
type InlineRuleState = Parameters<InlineRuleFn>[0];
type BlockRuleState = Parameters<BlockRuleFn>[0];

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
export function extractRawInlineTitle(
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

export type RawReferenceParts = Readonly<{
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
 * Extracts the container-stripped raw source lines of a `reference_definition`
 * while `markdown-it`'s block state still carries the exact per-line container
 * offsets (`bMarks`, `tShift`, `sCount`, `bsCount`, `blkIndent`).
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
	return lines.join("\n");
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
