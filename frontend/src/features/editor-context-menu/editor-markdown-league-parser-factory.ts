import {
	type BlockContext,
	type BlockParser,
	GFM,
	type MarkdownParser,
	parser as commonmarkParser,
} from "@lezer/markdown";

import {
	installLinearInlineResolver,
	MAX_LEZER_INLINE_DEPTH,
} from "./editor-markdown-inline-markers";
import {
	parseLinearHardBreak,
	parseLinearHtmlTag,
	parseLinearInlineCode,
	parseLinearLeagueHtmlTag,
} from "./editor-markdown-inline-scanners";
import { applyLeagueBlockRules } from "./editor-markdown-league-block-rules";
import { parseLinearGfmAutolink } from "./editor-markdown-linear-autolink-parser";
import {
	createLinearLinkEndParser,
	parseLinearImage,
	parseLinearLink,
} from "./editor-markdown-linear-link-parser";
import { createLeagueLinkReferenceLeafParser } from "./editor-markdown-reference-leaf-parser";

/**
 * Matches PHP `EasyMDE\Content\MarkdownRenderer::MAX_NESTING_LEVEL` (League
 * CommonMark 2.8.2 `max_nesting_level = 100`).
 */
export const MAX_LEAGUE_BLOCK_NESTING_DEPTH = MAX_LEZER_INLINE_DEPTH;

export type LinearLeagueMarkdownParserOptions = Readonly<{
	/**
	 * Block-nesting overflow policy:
	 * - `"cap"` (default, worker/index): stops opening nested blocks past
	 *   League `max_nesting_level = 100` (`cx.depth > 100`) so deeply nested
	 *   lines stay O(N) while preserving valid inner text/math/links.
	 * - `"fail-closed"` (bold verification): delegates `cx.depth > maxBlockDepth`
	 *   to `onOverNestedBlock(cx)` so unverifiable regions bail cleanly.
	 */
	blockNesting?:
		| Readonly<{ maxDepth?: number; mode: "cap" }>
		| Readonly<{
				maxDepth: number;
				mode: "fail-closed";
				onOverNested: (cx: BlockContext) => boolean;
		  }>;
	/** Inline HTML tag grammar (`"league"` for PHP parity, `"lezer"` for AST parity). */
	htmlTagDialect: "league" | "lezer";
	/** Callback notified when inline resolution flattens depth `> 100` subtrees. */
	onExceededInlineDepth?: (from: number, to: number) => void;
	/** Callback notified when a failed next-line reference title leaves an unverifiable range. */
	onLinkReferenceUnverifiableRange?: (from: number, to: number) => void;
	/** Rejects unescaped `(` inside `(...)` link titles per CommonMark §6.3 / League. */
	rejectUnescapedOpenParenInTitle?: boolean;
}>;

const BASE_GFM_PARSER: MarkdownParser = commonmarkParser.configure(GFM);

/**
 * Builds one private, worker-safe, DOM-free `@lezer/markdown` GFM parser
 * configured with League CommonMark 2.8.2 block rules, League CommonMark §4.7
 * `LinkReference` leaf parsing, strictly O(N) linear inline scanners/resolver,
 * and bounded block nesting. Never imports `@codemirror/lang-markdown` or
 * `@codemirror/view` and never mutates shared `@lezer/markdown` prototypes.
 */
export function createLinearLeagueMarkdownParser(
	options: LinearLeagueMarkdownParserOptions,
): MarkdownParser {
	const blockNesting = options.blockNesting ?? {
		maxDepth: MAX_LEAGUE_BLOCK_NESTING_DEPTH,
		mode: "cap",
	};
	const parseLinkEnd = createLinearLinkEndParser({
		...(options.onExceededInlineDepth
			? { onExceededDepth: options.onExceededInlineDepth }
			: {}),
		...(undefined !== options.rejectUnescapedOpenParenInTitle
			? {
					rejectUnescapedOpenParenInTitle:
						options.rejectUnescapedOpenParenInTitle,
				}
			: {}),
	});

	const maxContainerDepth =
		"cap" === blockNesting.mode
			? (blockNesting.maxDepth ?? MAX_LEAGUE_BLOCK_NESTING_DEPTH)
			: undefined;

	const parseBlock: BlockParser[] = [
		{
			name: "LinkReference",
			leaf(_cx, leaf) {
				return createLeagueLinkReferenceLeafParser(
					leaf,
					options.onLinkReferenceUnverifiableRange,
					maxContainerDepth,
				);
			},
		},
	];

	if ("fail-closed" === blockNesting.mode) {
		const { maxDepth, onOverNested } = blockNesting;
		parseBlock.push({
			name: "BlockNestingGuard",
			before: "IndentedCode",
			parse(cx) {
				if (cx.depth > maxDepth) {
					return onOverNested(cx);
				}
				return false;
			},
		});
	}

	const configured = BASE_GFM_PARSER.configure({
		remove: ["Autolink"],
		parseBlock,
		parseInline: [
			{ name: "InlineCode", parse: parseLinearInlineCode },
			{
				name: "HTMLTag",
				parse:
					"league" === options.htmlTagDialect
						? parseLinearLeagueHtmlTag
						: parseLinearHtmlTag,
			},
			{ name: "HardBreak", parse: parseLinearHardBreak },
			{ name: "Link", parse: parseLinearLink },
			{ name: "Image", parse: parseLinearImage },
			{ name: "LinkEnd", parse: parseLinkEnd },
			{ name: "Autolink", parse: parseLinearGfmAutolink },
		],
	});

	const withBlockRules = applyLeagueBlockRules(
		configured,
		undefined !== maxContainerDepth ? { maxContainerDepth } : undefined,
	);

	return installLinearInlineResolver(
		withBlockRules,
		options.onExceededInlineDepth,
	);
}
