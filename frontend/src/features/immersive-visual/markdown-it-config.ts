import MarkdownIt from "markdown-it";
import { decodeCommonMarkTitle } from "../../shared/image-scale-title";
import { RAW_IMAGE_TITLE_META_KEY } from "./markdown-parser-inline";

type InternalRulerEntry<TRule> = Readonly<{
	alt: string[];
	fn: TRule;
	name: string;
}>;

type InternalRuler<TRule> = Readonly<{
	__rules__?: ReadonlyArray<InternalRulerEntry<TRule>>;
}>;

function isInlineSpaceOrLf(code: number): boolean {
	return code === 0x20 || code === 0x09 || code === 0x0a;
}

type InlineRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["inline"]["ruler"]["at"]
>[1];
type BlockRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["block"]["ruler"]["at"]
>[1];
type InlineImageRuleState = Parameters<InlineRuleFn>[0];
type BlockRuleState = Parameters<BlockRuleFn>[0];

/**
 * Extracts the raw (pre-unescape) inner title slice of a matched inline image
 * token from `state.src` so PHP-equivalent two-pass decoding runs directly on
 * the raw Markdown title without double-decoding `markdown-it`'s output.
 */
function extractRawInlineImageTitle(
	state: InlineImageRuleState,
	startPos: number,
	endPos: number,
): string | null {
	const labelEnd = state.md.helpers.parseLinkLabel(state, startPos + 1, false);
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
	const titleRes = state.md.helpers.parseLinkTitle(state.src, pos, endPos);
	if (!titleRes.ok || titleRes.pos < pos + 2) {
		return null;
	}
	return state.src.slice(pos + 1, titleRes.pos - 1);
}

function extractRawReferenceTitle(
	state: BlockRuleState,
	startLine: number,
	endLine: number,
): string | null {
	const lines: string[] = [];
	for (let line = startLine; line < endLine; line += 1) {
		const lineStart = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
		const lineEnd = state.eMarks[line] ?? lineStart;
		lines.push(state.src.slice(lineStart, lineEnd));
	}
	const joined = lines.join("\n");
	if (joined.charCodeAt(0) !== 91) {
		return null;
	}
	let pos = 1;
	while (pos < joined.length) {
		const ch = joined.charCodeAt(pos);
		if (ch === 91) {
			return null;
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
		return null;
	}
	pos += 2;
	while (pos < joined.length && isInlineSpaceOrLf(joined.charCodeAt(pos))) {
		pos += 1;
	}
	const destRes = state.md.helpers.parseLinkDestination(
		joined,
		pos,
		joined.length,
	);
	if (!destRes.ok) {
		return null;
	}
	pos = destRes.pos;
	const afterDest = pos;
	while (pos < joined.length && isInlineSpaceOrLf(joined.charCodeAt(pos))) {
		pos += 1;
	}
	if (pos >= joined.length || pos === afterDest) {
		return null;
	}
	const titleRes = state.md.helpers.parseLinkTitle(joined, pos, joined.length);
	if (!titleRes.ok || titleRes.pos < pos + 2) {
		return null;
	}
	return joined.slice(pos + 1, titleRes.pos - 1);
}

/**
 * Configures the feature-private `markdown-it` parser with PHP-parity rules:
 * raw inline/reference image title capture for two-pass decoding, standalone
 * block parsing for prescanned `TBLALIGN` sentinels (preserving tight lists),
 * and CommonMark §4.8 / §4.3 continuation-indent stripping.
 */
export function createVisualMarkdownItParser(): InstanceType<typeof MarkdownIt> {
	const parser = new MarkdownIt({
		html: false,
		linkify: false,
		breaks: false,
	});

	const originalImageRuleEntry = (
		parser.inline.ruler as unknown as InternalRuler<InlineRuleFn>
	).__rules__?.find((rule) => rule.name === "image");

	if (originalImageRuleEntry) {
		const originalImageRule = originalImageRuleEntry.fn;
		parser.inline.ruler.before(
			"image",
			"easymde_image",
			(state, silent) => {
				const startPos = state.pos;
				const tokensBefore = state.tokens.length;
				const matched = originalImageRule(state, silent);
				if (!matched || silent || state.tokens.length <= tokensBefore) {
					return matched;
				}
				const imageToken = state.tokens[state.tokens.length - 1];
				if (imageToken?.type === "image") {
					const rawTitle = extractRawInlineImageTitle(
						state,
						startPos,
						state.pos,
					);
					if (rawTitle !== null) {
						const meta: Record<string, unknown> =
							imageToken.meta && typeof imageToken.meta === "object"
								? (imageToken.meta as Record<string, unknown>)
								: Object.create(null);
						meta[RAW_IMAGE_TITLE_META_KEY] = rawTitle;
						imageToken.meta = meta;
					}
				}
				return true;
			},
			{ alt: [...originalImageRuleEntry.alt] },
		);
		parser.inline.ruler.disable("image");
	}

	const originalReferenceRuleEntry = (
		parser.block.ruler as unknown as InternalRuler<BlockRuleFn>
	).__rules__?.find((rule) => rule.name === "reference");

	if (originalReferenceRuleEntry) {
		const originalReferenceRule = originalReferenceRuleEntry.fn;
		parser.block.ruler.before(
			"reference",
			"easymde_reference",
			(state, startLine, endLine, silent) => {
				const existingRefs = (
					state.env as {
						references?: Record<string, { href: string; title: string }>;
					}
				).references;
				const existingKeys = existingRefs
					? new Set(Object.keys(existingRefs))
					: null;
				const tokensBefore = state.tokens.length;
				const matched = originalReferenceRule(state, startLine, endLine, silent);
				if (!matched || silent || state.tokens.length <= tokensBefore) {
					return matched;
				}
				const refToken = state.tokens[state.tokens.length - 1];
				const label =
					refToken?.type === "reference_definition" &&
					refToken.meta &&
					typeof refToken.meta === "object" &&
					typeof (refToken.meta as { label?: unknown }).label === "string"
						? (refToken.meta as { label: string }).label
						: null;
				const refs = (
					state.env as {
						references?: Record<string, { href: string; title: string }>;
					}
				).references;
				if (
					label !== null &&
					refs?.[label] &&
					!existingKeys?.has(label) &&
					refs[label].title.length > 0
				) {
					const rawTitle = extractRawReferenceTitle(
						state,
						startLine,
						state.line,
					);
					if (rawTitle !== null) {
						refs[label].title = decodeCommonMarkTitle(
							rawTitle.replace(/\r\n|\r/gu, "\n").replace(/\n[ \t]+/gu, "\n"),
						);
					}
				}
				return true;
			},
			{ alt: [...originalReferenceRuleEntry.alt] },
		);
		parser.block.ruler.disable("reference");
	}

	parser.block.ruler.before(
		"paragraph",
		"easymde_table_align",
		(state, startLine, _endLine, silent) => {
			if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) {
				return false;
			}
			const markers = (
				state.env as { tableAlignMarkers?: ReadonlyMap<string, string> }
			).tableAlignMarkers;
			if (!markers || markers.size === 0) {
				return false;
			}
			const pos =
				(state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
			const max = state.eMarks[startLine] ?? pos;
			const lineText = state.src.slice(pos, max).trim();
			if (!markers.has(lineText)) {
				return false;
			}
			if (silent) {
				return true;
			}
			const token = state.push("easymde_table_align", "", 0);
			token.content = lineText;
			token.map = [startLine, startLine + 1];
			state.line = startLine + 1;
			return true;
		},
		{ alt: ["paragraph", "reference", "blockquote", "list"] },
	);

	// CommonMark §4.8 / §4.3 strip leading spaces and tabs from continuation
	// lines of paragraphs and Setext headings before inline parsing; markdown-it
	// leaves them intact inside multiline link/image titles (`"Caption\n {width=50%}"`),
	// while HTML entities (`&#10; ` / `&NewLine; `) decode later during inline parsing.
	parser.core.ruler.before(
		"inline",
		"easymde_strip_continuation_indent",
		(state) => {
			for (let i = 0; i < state.tokens.length; i += 1) {
				const token = state.tokens[i];
				if (token?.type !== "inline" || !token.content.includes("\n")) {
					continue;
				}
				const prevType = state.tokens[i - 1]?.type;
				if (
					state.inlineMode ||
					prevType === "paragraph_open" ||
					prevType === "heading_open"
				) {
					token.content = token.content.replace(/\n[ \t]+/g, "\n");
				}
			}
		},
	);

	return parser;
}
