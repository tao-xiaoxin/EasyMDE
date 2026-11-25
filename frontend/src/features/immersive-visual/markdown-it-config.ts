import MarkdownIt from "markdown-it";
import { decodeCommonMarkTitle } from "../../shared/image-scale-title";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
	type ReferenceDefinitionState,
} from "../../shared/markdown/php-commonmark-reference-def";
import {
	RAW_IMAGE_TITLE_META_KEY,
	RAW_LINK_TITLE_META_KEY,
	readRawMetaString,
} from "./markdown-parser-inline";
import {
	isCommonMarkBlankLine,
	type PreScanResult,
	restoreProtectedInlineSentinels,
} from "./markdown-prescanner";

export const RAW_REFERENCE_SOURCE_META_KEY = "easymdeRawReferenceSource";

type InternalRulerEntry<TRule> = Readonly<{
	alt: string[];
	fn: TRule;
	name: string;
}>;

type InternalRuler<TRule> = Readonly<{
	__rules__?: ReadonlyArray<InternalRulerEntry<TRule>>;
}>;

type ReferenceEnv = {
	preScan?: Pick<
		PreScanResult,
		"protectedBlocks" | "protectedInlines" | "sentinel" | "tableAlignMarkers"
	>;
	references?: Record<string, { href: string; title: string }>;
};

function isInlineSpaceOrLf(code: number): boolean {
	return code === 0x20 || code === 0x09 || code === 0x0a;
}

type InlineRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["inline"]["ruler"]["at"]
>[1];
type BlockRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["block"]["ruler"]["at"]
>[1];
type InlineRuleState = Parameters<InlineRuleFn>[0];
type BlockRuleState = Parameters<BlockRuleFn>[0];

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

function extractRawReferenceParts(
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
function extractRawReferenceBlock(
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

function hasReferenceLabelMeta(meta: unknown): boolean {
	return (
		meta !== null &&
		typeof meta === "object" &&
		typeof (meta as { label?: unknown }).label === "string"
	);
}

/**
 * Configures the feature-private `markdown-it` parser with PHP-parity rules:
 * raw inline link/image and reference title capture for two-pass decoding,
 * preservation of `reference_definition` tokens in the block token stream,
 * standalone block parsing for prescanned `TBLALIGN` sentinels (preserving
 * tight lists), and CommonMark §4.8 / §4.3 continuation-indent stripping.
 */
export function createVisualMarkdownItParser(): InstanceType<typeof MarkdownIt> {
	const parser = new MarkdownIt({
		html: false,
		linkify: false,
		breaks: false,
	});

	// Keep `reference_definition` tokens in the block stream with their exact
	// `token.map` and container nesting so the parser maps them to protected
	// blocks without duplicating CommonMark §4.7 parsing in the prescanner.
	parser.core.ruler.disable("strip_references");

	const inlineRules = (
		parser.inline.ruler as unknown as InternalRuler<InlineRuleFn>
	).__rules__;

	const originalImageRuleEntry = inlineRules?.find(
		(rule) => rule.name === "image",
	);

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
				if (
					imageToken?.type === "image" &&
					!hasReferenceLabelMeta(imageToken.meta)
				) {
					const rawTitle = extractRawInlineTitle(
						state,
						startPos + 1,
						state.pos,
						false,
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

	const originalLinkRuleEntry = inlineRules?.find(
		(rule) => rule.name === "link",
	);

	if (originalLinkRuleEntry) {
		const originalLinkRule = originalLinkRuleEntry.fn;
		parser.inline.ruler.before(
			"link",
			"easymde_link",
			(state, silent) => {
				const startPos = state.pos;
				const tokensBefore = state.tokens.length;
				const matched = originalLinkRule(state, silent);
				if (!matched || silent || state.tokens.length <= tokensBefore) {
					return matched;
				}
				const linkOpenToken = state.tokens[tokensBefore];
				if (
					linkOpenToken?.type === "link_open" &&
					!hasReferenceLabelMeta(linkOpenToken.meta)
				) {
					const rawTitle = extractRawInlineTitle(
						state,
						startPos,
						state.pos,
						true,
					);
					if (rawTitle !== null) {
						const meta: Record<string, unknown> =
							linkOpenToken.meta && typeof linkOpenToken.meta === "object"
								? (linkOpenToken.meta as Record<string, unknown>)
								: Object.create(null);
						meta[RAW_LINK_TITLE_META_KEY] = rawTitle;
						linkOpenToken.meta = meta;
					}
				}
				return true;
			},
			{ alt: [...originalLinkRuleEntry.alt] },
		);
		parser.inline.ruler.disable("link");
	}

	const knownReferenceLabelsByMap = new WeakMap<
		Record<string, { href: string; title: string }>,
		Set<string>
	>();
	const getKnownReferenceLabels = (
		refs: Record<string, { href: string; title: string }>,
	): Set<string> => {
		let known = knownReferenceLabelsByMap.get(refs);
		if (!known) {
			known = new Set(Object.keys(refs));
			knownReferenceLabelsByMap.set(refs, known);
		}
		return known;
	};

	const originalReferenceRuleEntry = (
		parser.block.ruler as unknown as InternalRuler<BlockRuleFn>
	).__rules__?.find((rule) => rule.name === "reference");

	if (originalReferenceRuleEntry) {
		const originalReferenceRule = originalReferenceRuleEntry.fn;
		parser.block.ruler.before(
			"reference",
			"easymde_reference",
			(state, startLine, endLine, silent) => {
				// PHP League\CommonMark keeps ParagraphParser open across link
				// reference definitions until a blank line or interrupting block,
				// so a 4-space/tab-indented consecutive refdef right after a
				// refdef at the same container level still parses as a refdef.
				const prevToken = state.tokens[state.tokens.length - 1];
				const followsRefDef =
					prevToken?.type === "reference_definition" &&
					prevToken.level === state.level &&
					prevToken.map?.[1] === startLine;
				const origSCount = state.sCount[startLine] ?? 0;
				const indentedAfterRefDef =
					followsRefDef && origSCount - state.blkIndent >= 4;
				if (!indentedAfterRefDef && origSCount - state.blkIndent >= 4) {
					return false;
				}
				const startPos =
					(state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
				if (state.src.charCodeAt(startPos) !== 0x5b) {
					return false;
				}
				const env = state.env as ReferenceEnv;
				const existingRefs = env.references;
				const knownLabels = existingRefs
					? getKnownReferenceLabels(existingRefs)
					: null;
				const tokensBefore = state.tokens.length;
				if (indentedAfterRefDef) {
					state.sCount[startLine] = state.blkIndent;
				}
				let matched: boolean;
				try {
					matched = originalReferenceRule(state, startLine, endLine, silent);
				} finally {
					if (indentedAfterRefDef) {
						state.sCount[startLine] = origSCount;
					}
				}
				if (!matched || silent || state.tokens.length <= tokensBefore) {
					return matched;
				}
				const refToken = state.tokens[state.tokens.length - 1];
				const preScan = env.preScan;
				const restoreSentinels = (text: string): string =>
					preScan ? restoreProtectedInlineSentinels(text, preScan) : text;
				if (refToken?.type === "reference_definition") {
					const meta: Record<string, unknown> =
						refToken.meta && typeof refToken.meta === "object"
							? (refToken.meta as Record<string, unknown>)
							: Object.create(null);
					meta[RAW_REFERENCE_SOURCE_META_KEY] = restoreSentinels(
						extractRawReferenceBlock(state, startLine, state.line),
					);
					refToken.meta = meta;
				}
				const label =
					refToken?.type === "reference_definition" &&
					hasReferenceLabelMeta(refToken.meta)
						? (refToken.meta as { label: string }).label
						: null;
				const refs = env.references;
				if (label !== null && refs) {
					const activeKnown = knownLabels ?? getKnownReferenceLabels(refs);
					const alreadyExisted = knownLabels !== null && activeKnown.has(label);
					activeKnown.add(label);
					const entry = refs[label];
					if (!alreadyExisted && entry) {
						const needsHrefRestore =
							preScan !== undefined && entry.href.includes(preScan.sentinel);
						const needsTitleDecode = entry.title.length > 0;
						if (needsHrefRestore || needsTitleDecode) {
							const parts = extractRawReferenceParts(
								state,
								startLine,
								state.line,
							);
							if (needsHrefRestore && parts.rawDestination !== null) {
								const restoredDest = restoreSentinels(parts.rawDestination);
								const unwrappedDest =
									restoredDest.startsWith("<") &&
									restoredDest.endsWith(">") &&
									restoredDest.length >= 2
										? restoredDest.slice(1, -1)
										: restoredDest;
								const normalizedHref = state.md.normalizeLink(
									decodeCommonMarkTitle(unwrappedDest),
								);
								entry.href = state.md.validateLink(normalizedHref)
									? normalizedHref
									: "";
							}
							if (needsTitleDecode && parts.rawTitle !== null) {
								entry.title = decodeCommonMarkTitle(
									restoreSentinels(parts.rawTitle)
										.replace(/\r\n|\r/gu, "\n")
										.replace(/\n[ \t]+/gu, "\n"),
								);
							}
						}
					}
				}
				return true;
			},
			{ alt: [...originalReferenceRuleEntry.alt] },
		);
		parser.block.ruler.disable("reference");
	}

	const originalCodeRuleEntry = (
		parser.block.ruler as unknown as InternalRuler<BlockRuleFn>
	).__rules__?.find((rule) => rule.name === "code");

	if (originalCodeRuleEntry) {
		const originalCodeRule = originalCodeRuleEntry.fn;
		parser.block.ruler.before(
			"code",
			"easymde_code",
			(state, startLine, endLine, silent) => {
				// PHP League\CommonMark keeps ParagraphParser open across link
				// reference definitions until a blank line or interrupting
				// block, so a 4-space continuation right after a refdef stays
				// a paragraph instead of becoming an indented code block.
				const prevToken = state.tokens[state.tokens.length - 1];
				if (
					prevToken?.type === "reference_definition" &&
					prevToken.level === state.level &&
					prevToken.map?.[1] === startLine
				) {
					return false;
				}
				return originalCodeRule(state, startLine, endLine, silent);
			},
			{ alt: [...originalCodeRuleEntry.alt] },
		);
		parser.block.ruler.disable("code");
	}

	parser.block.ruler.before(
		"lheading",
		"easymde_protected_block",
		(state, startLine, _endLine, silent) => {
			if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) {
				return false;
			}
			const blocks = (state.env as ReferenceEnv).preScan?.protectedBlocks;
			if (!blocks || blocks.size === 0) {
				return false;
			}
			const pos =
				(state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
			const max = state.eMarks[startLine] ?? pos;
			const lineText = state.src
				.slice(pos, max)
				.replace(/^[ \t]+|[ \t]+$/g, "");
			if (!blocks.has(lineText)) {
				return false;
			}
			if (silent) {
				return true;
			}
			const token = state.push("easymde_protected_block", "", 0);
			token.content = lineText;
			token.map = [startLine, startLine + 1];
			state.line = startLine + 1;
			return true;
		},
		{ alt: ["paragraph", "reference", "blockquote", "list"] },
	);

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

	// Strip paragraph/Setext continuation indentation per CommonMark §4.8.
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

/**
 * Exact PHP `League\CommonMark\Extension\TaskList\TaskListItemMarkerParser`
 * prefix: literal `[ ]`, `[x]`, or `[X]` followed by at least one character
 * other than ASCII space/tab (`Cursor::getNextNonSpaceCharacter() !== null`).
 */
export const TASK_LIST_MARKER_PATTERN = /^\[([ xX])\](?=[ \t]*[^ \t])/;

export const visualMarkdownItParser = createVisualMarkdownItParser();

export type ReferenceDefinitionBlockInfo = Readonly<{
	isRefDef: boolean;
	lastHasTitle: boolean;
	lastRaw: string;
}>;

/**
 * Reports whether `rawMarkdown` consists exclusively of CommonMark §4.7 link
 * reference definitions, whether its last definition already carries a title,
 * and the container-stripped raw source of that trailing definition.
 */
export function inspectReferenceDefinitionBlock(
	rawMarkdown: string,
): ReferenceDefinitionBlockInfo {
	if (/^[ \t\r\n]*$/.test(rawMarkdown) || !rawMarkdown.includes("]:")) {
		return { isRefDef: false, lastHasTitle: false, lastRaw: "" };
	}
	const tokens = visualMarkdownItParser.parse(rawMarkdown, {});
	if (
		tokens.length === 0 ||
		!tokens.every((token) => token.type === "reference_definition")
	) {
		return { isRefDef: false, lastHasTitle: false, lastRaw: "" };
	}
	const lastToken = tokens[tokens.length - 1];
	const lastRaw = lastToken
		? (readRawMetaString(lastToken, RAW_REFERENCE_SOURCE_META_KEY) ??
			rawMarkdown)
		: rawMarkdown;
	const refParser = createParagraphReferenceParser();
	for (const line of lastRaw.split("\n")) {
		advanceParagraphReferenceParser(refParser, line);
	}
	return {
		isRefDef: true,
		lastHasTitle: refParser.state !== "start-title",
		lastRaw,
	};
}

function readReferenceParserState(
	parser: ParagraphReferenceParser,
): ReferenceDefinitionState {
	return parser.state;
}

/**
 * Reports whether placing `followingMarkdown` directly on the next line after
 * a title-less CommonMark §4.7 reference definition (`lastRaw`) would cause
 * PHP `League\CommonMark`'s `ReferenceParser` to absorb one or more lines of
 * `followingMarkdown` as the definition's title.
 */
export function wouldReferenceDefinitionAbsorbFollowingBlock(
	lastRaw: string,
	followingMarkdown: string,
): boolean {
	if (lastRaw.length === 0 || followingMarkdown.length === 0) {
		return false;
	}
	const nl = followingMarkdown.indexOf("\n");
	const firstLine =
		nl === -1 ? followingMarkdown : followingMarkdown.slice(0, nl);
	if (!/^[ \t]*["'(]/.test(firstLine)) {
		return false;
	}
	const refParser = createParagraphReferenceParser();
	for (const line of lastRaw.split("\n")) {
		advanceParagraphReferenceParser(refParser, line);
	}
	if (readReferenceParserState(refParser) !== "start-title") {
		return false;
	}
	for (const line of followingMarkdown.split("\n")) {
		if (isCommonMarkBlankLine(line)) {
			break;
		}
		if (advanceParagraphReferenceParser(refParser, line)) {
			return true;
		}
		const nextState = readReferenceParserState(refParser);
		if (nextState === "paragraph" || nextState === "start-definition") {
			break;
		}
	}
	return false;
}

/**
 * Extracts original-cased labels when `rawMarkdown` consists exclusively of
 * CommonMark §4.7 link reference definitions (including multi-line definitions).
 */
export function extractReferenceDefinitionLabels(
	rawMarkdown: string,
): string[] | null {
	if (/^[ \t\r\n]*$/.test(rawMarkdown)) {
		return null;
	}
	const tokens = visualMarkdownItParser.parse(rawMarkdown, {});
	if (
		tokens.length === 0 ||
		!tokens.every((token) => token.type === "reference_definition")
	) {
		return null;
	}
	const labels: string[] = [];
	for (const token of tokens) {
		const rawSource = readRawMetaString(token, RAW_REFERENCE_SOURCE_META_KEY);
		const labelMatch =
			rawSource !== null
				? /^[ \t]*\[((?:\\.|[^\\\]])+)\]:/u.exec(rawSource)
				: null;
		if (labelMatch?.[1]) {
			labels.push(labelMatch[1].trim().replace(/\s+/gu, " "));
		} else {
			const fallbackLabel = readRawMetaString(token, "label");
			if (fallbackLabel) {
				labels.push(fallbackLabel);
			}
		}
	}
	return labels.length > 0 ? labels : null;
}
