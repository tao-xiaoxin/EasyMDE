import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it, vi } from "vitest";

import {
	createSimpleBoldWrapEdit,
	planSourceBoldSelection,
	type SourceBoldOptions,
} from "./editor-context-menu-bold";
import { collectBoldableSegments } from "./editor-context-menu-bold-segments";
import { planVerifiedContainerUnboldReplacements } from "./editor-context-menu-bold-unbold";
import {
	verifyFullUnboldPlan,
	verifyPlainWrapPlan,
} from "./editor-context-menu-bold-verify";
import type { EditorSelection } from "./editor-context-menu-rules";
import type { EditorTextEdit } from "./editor-context-menu-text-edit";
import {
	getBoldMarkdownUnverifiableRanges,
	parseBoldMarkdown,
} from "./editor-markdown-bold-parser";
import { analyzeLeagueInlineBlock } from "./editor-markdown-league-inline";

let fullUnboldVerifyCalls = 0;

vi.mock("./editor-context-menu-bold-verify", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./editor-context-menu-bold-verify")>();
	return {
		...actual,
		verifyFullUnboldPlan: (
			...args: Parameters<typeof actual.verifyFullUnboldPlan>
		) => {
			fullUnboldVerifyCalls += 1;
			return actual.verifyFullUnboldPlan(...args);
		},
	};
});

function shouldUseStructuredSourceBold(
	value: string,
	selection: EditorSelection,
	options: SourceBoldOptions = {},
): boolean {
	return (
		"delegate-toolbar" !== planSourceBoldSelection(value, selection, options).kind
	);
}

function toggleSourceBoldSelection(
	value: string,
	selection: EditorSelection,
	options: SourceBoldOptions = {},
): EditorTextEdit | null {
	const plan = planSourceBoldSelection(value, selection, options);
	if ("edit" === plan.kind) return plan.edit;
	if ("unavailable" === plan.kind) return null;
	return createSimpleBoldWrapEdit(value, selection, options);
}

function sel(
	start: number,
	end: number,
	direction: EditorSelection["direction"] = "forward",
): EditorSelection {
	return { direction, end, start };
}

function selectAll(value: string): EditorSelection {
	return sel(0, value.length);
}

function selectSubstring(value: string, text: string): EditorSelection {
	const start = value.indexOf(text);
	if (start < 0) throw new Error(`substring-not-found:${text}`);
	return sel(start, start + text.length);
}

describe("editor-context-menu-bold", () => {
	it("routes simple single-line inline selections to toolbar and structural/cross-block selections to structured bold", () => {
		const paragraph = "Hello world";
		expect(
			shouldUseStructuredSourceBold(paragraph, selectSubstring(paragraph, "world")),
		).toBe(false);

		expect(
			shouldUseStructuredSourceBold("Alpha\n\nBeta", selectAll("Alpha\n\nBeta")),
		).toBe(true);
		expect(
			shouldUseStructuredSourceBold("# Heading", selectAll("# Heading")),
		).toBe(true);
		expect(
			shouldUseStructuredSourceBold("# Heading", selectSubstring("# Heading", "Heading")),
		).toBe(false);
		expect(
			shouldUseStructuredSourceBold("| A | B |\n| --- | --- |\n| 1 | 2 |", selectSubstring("| A | B |\n| --- | --- |\n| 1 | 2 |", "A")),
		).toBe(true);
		expect(
			shouldUseStructuredSourceBold("Hello   world", sel(5, 8)),
		).toBe(true);
		expect(
			shouldUseStructuredSourceBold("Hello **world**", selectSubstring("Hello **world**", "**world**")),
		).toBe(true);
	});

	it("bolds cross-paragraph full and partial selections per block in one minimal edit", () => {
		const full = "Alpha paragraph\n\nBeta paragraph";
		const fullEdit = toggleSourceBoldSelection(full, selectAll(full));
		expect(fullEdit).not.toBeNull();
		expect(fullEdit?.value).toBe("**Alpha paragraph**\n\n**Beta paragraph**");
		expect(fullEdit?.changes).toEqual({
			from: 0,
			insert: "**Alpha paragraph**\n\n**Beta paragraph**",
			to: full.length,
		});

		const partial = "Hello world\n\nSecond paragraph";
		const partialSelection = selectSubstring(partial, "world\n\nSecond");
		const partialEdit = toggleSourceBoldSelection(partial, partialSelection);
		expect(partialEdit).not.toBeNull();
		expect(partialEdit?.value).toBe("Hello **world**\n\n**Second** paragraph");
		expect(partialEdit?.changes).toEqual({
			from: 6,
			insert: "**world**\n\n**Second**",
			to: 19,
		});
		const partialChange = partialEdit?.changes;
		if (!partialEdit || !partialChange) {
			throw new Error("partial-bold-edit-missing");
		}
		expect(
			partial.slice(0, partialChange.from) +
				partialChange.insert +
				partial.slice(partialChange.to),
		).toBe(partialEdit.value);
	});

	it("strips ATX heading prefixes/closing hashes and skips Setext underline lines", () => {
		const markdown = [
			"# Heading 1",
			"",
			"## Heading 2 ##",
			"",
			"### C# Notes",
			"",
			"Setext Title",
			"============",
			"",
			"Setext Subtitle",
			"---------------",
		].join("\n");
		const edit = toggleSourceBoldSelection(markdown, selectAll(markdown));
		expect(edit?.value).toBe(
			[
				"# **Heading 1**",
				"",
				"## **Heading 2** ##",
				"",
				"### **C# Notes**",
				"",
				"**Setext Title**",
				"============",
				"",
				"**Setext Subtitle**",
				"---------------",
			].join("\n"),
		);
	});

	it("strips list, ordered-list, task-list, and nested blockquote prefixes without corrupting nested non-boldable blocks", () => {
		const markdown = [
			"- Item one",
			"* Item two",
			"1. Ordered one",
			"2) Ordered two",
			"- [ ] Todo item",
			"- [x] Done item",
			"",
			"> Quoted paragraph",
			"> - [ ] Nested task",
			"> > Nested quote",
			"> # Quoted heading",
			"> ---",
			"> * * *",
			"> ```js",
			"> const keep = 1;",
			"> ```",
		].join("\n");
		const edit = toggleSourceBoldSelection(markdown, selectAll(markdown));
		expect(edit?.value).toBe(
			[
				"- **Item one**",
				"* **Item two**",
				"1. **Ordered one**",
				"2) **Ordered two**",
				"- [ ] **Todo item**",
				"- [x] **Done item**",
				"",
				"> **Quoted paragraph**",
				"> - [ ] **Nested task**",
				"> > **Nested quote**",
				"> # **Quoted heading**",
				"> ---",
				"> * * *",
				"> ```js",
				"> const keep = 1;",
				"> ```",
			].join("\n"),
		);
	});

	it("bolds mixed selections while skipping code fences, indented code, math blocks, HRs, and table delimiter rows/pipes", () => {
		const markdown = [
			"Intro paragraph",
			"",
			"```ts",
			"const x = 1;",
			"```",
			"",
			"    indented code line",
			"",
			"$$",
			"E = mc^2",
			"$$",
			"",
			"---",
			"",
			"<!-- easymde-table-align: 1:1=center -->",
			"| Col A | Col B |",
			"| --- | :---: |",
			"| Val 1 | Val 2 |",
			"",
			"Outro paragraph",
		].join("\n");
		const edit = toggleSourceBoldSelection(markdown, selectAll(markdown));
		expect(edit?.value).toBe(
			[
				"**Intro paragraph**",
				"",
				"```ts",
				"const x = 1;",
				"```",
				"",
				"    indented code line",
				"",
				"$$",
				"E = mc^2",
				"$$",
				"",
				"---",
				"",
				"<!-- easymde-table-align: 1:1=center -->",
				"| **Col A** | **Col B** |",
				"| --- | :---: |",
				"| **Val 1** | **Val 2** |",
				"",
				"**Outro paragraph**",
			].join("\n"),
		);
	});

	it("bolds partial selections inside table cells without crossing pipes", () => {
		const table = "| Hello world | Foo bar |\n| --- | --- |\n| Alpha | Beta |";
		const edit = toggleSourceBoldSelection(
			table,
			selectSubstring(table, "world | Foo"),
		);
		expect(edit?.value).toBe(
			"| Hello **world** | **Foo** bar |\n| --- | --- |\n| Alpha | Beta |",
		);
	});

	it("preserves CRLF line endings untouched", () => {
		const crlf = "# Heading 1\r\n\r\nParagraph 1\r\n\r\n```\r\ncode\r\n```\r\n\r\nParagraph 2";
		const edit = toggleSourceBoldSelection(crlf, selectAll(crlf));
		expect(edit?.value).toBe(
			"# **Heading 1**\r\n\r\n**Paragraph 1**\r\n\r\n```\r\ncode\r\n```\r\n\r\n**Paragraph 2**",
		);
		expect(edit?.value.replace(/\r\n/gu, "")).not.toContain("\n");
	});

	it("trims flanking horizontal whitespace, skips blank lines, and preserves backslash hard breaks", () => {
		const markdown = "  Alpha  \n\n   \n\n  Beta\t\n\nLine one\\\nLine two";
		const edit = toggleSourceBoldSelection(markdown, selectAll(markdown));
		expect(edit?.value).toBe(
			"  **Alpha**  \n\n   \n\n  **Beta**\t\n\n**Line one**\\\n**Line two**",
		);
	});

	it("toggles bold off cleanly when all segments are wrapped (inner or flanking) and avoids **** on mixed selections", () => {
		const original = "# Heading 1\n\nParagraph 1\n\n- Item 1";
		const bolded = toggleSourceBoldSelection(original, selectAll(original));
		if (!bolded) throw new Error("expected-bold-edit");
		expect(bolded.value).toBe("# **Heading 1**\n\n**Paragraph 1**\n\n- **Item 1**");

		const unbolded = toggleSourceBoldSelection(bolded.value, bolded.selection);
		expect(unbolded?.value).toBe(original);
		expect(unbolded?.selection).toEqual(selectAll(original));

		// Selecting strictly inside the flanking ** around a single line:
		const singleFlanked = "Hello **world**";
		const singleUnwrap = toggleSourceBoldSelection(
			singleFlanked,
			selectSubstring(singleFlanked, "world"),
		);
		expect(singleUnwrap?.value).toBe("Hello world");

		// Multi-block where delimiters flank the outer ends of the selection (`Alpha**\n\n**Beta`):
		const multiFlanked = "**Alpha**\n\n**Beta**";
		const multiFlankedUnwrap = toggleSourceBoldSelection(
			multiFlanked,
			sel(2, multiFlanked.length - 2),
		);
		expect(multiFlankedUnwrap?.value).toBe("Alpha\n\nBeta");

		// Mixed bold + plain: bolds only the plain segment without creating ****
		const mixed = "**Alpha**\n\nBeta";
		const mixedBold = toggleSourceBoldSelection(mixed, selectAll(mixed));
		expect(mixedBold?.value).toBe("**Alpha**\n\n**Beta**");

		// Multiple separate bold spans on one line must NOT unwrap outer pair into broken markdown;
		// instead it keeps existing bold spans intact and bolds only the plain text between them.
		const twoSpans = "**foo** and **bar**";
		const twoSpansBold = toggleSourceBoldSelection(twoSpans, selectAll(twoSpans));
		expect(twoSpansBold?.value).toBe("**foo** **and** **bar**");
		if (!twoSpansBold) throw new Error("expected-two-spans-bold-edit");
		const twoSpansUnbold = toggleSourceBoldSelection(
			twoSpansBold.value,
			twoSpansBold.selection,
		);
		expect(twoSpansUnbold?.value).toBe("foo and bar");

		// Mixed inline bold inside one paragraph: bolds only plain parts without ****
		const mixedInline = "plain **already** plain";
		const mixedInlineBold = toggleSourceBoldSelection(
			mixedInline,
			selectAll(mixedInline),
		);
		expect(mixedInlineBold?.value).toBe("**plain** **already** **plain**");
		if (!mixedInlineBold) throw new Error("expected-mixed-inline-bold-edit");
		expect(
			toggleSourceBoldSelection(mixedInlineBold.value, mixedInlineBold.selection)
				?.value,
		).toBe("plain already plain");

		// Mixed bold across paragraphs keeps already-bold paragraphs intact
		const mixedThree = "First\n\n**Already**\n\nLast";
		const mixedThreeBold = toggleSourceBoldSelection(
			mixedThree,
			selectAll(mixedThree),
		);
		expect(mixedThreeBold?.value).toBe("**First**\n\n**Already**\n\n**Last**");
	});

	it("never bolds nested indented code or nested math blocks inside blockquotes or lists", () => {
		const quoteIndentedCode = ">     echo hi";
		expect(
			planSourceBoldSelection(quoteIndentedCode, selectAll(quoteIndentedCode)),
		).toEqual({ kind: "unavailable" });

		const listIndentedCode = "- item\n\n      echo hi";
		const listEdit = toggleSourceBoldSelection(
			listIndentedCode,
			selectAll(listIndentedCode),
		);
		expect(listEdit?.value).toBe("- **item**\n\n      echo hi");

		const nestedListIndentedCode = "- item\n  - nested\n\n        indented";
		const nestedListEdit = toggleSourceBoldSelection(
			nestedListIndentedCode,
			selectAll(nestedListIndentedCode),
		);
		expect(nestedListEdit?.value).toBe(
			"- **item**\n  - **nested**\n\n        indented",
		);

		const quoteMixed = [
			"> _keep_",
			">",
			">     echo hi",
			">",
			"> $$",
			"> E = mc^2",
			"> $$",
			">",
			"> \\[a + b\\]",
			">",
			"> after",
		].join("\n");
		const quoteMixedEdit = toggleSourceBoldSelection(
			quoteMixed,
			selectAll(quoteMixed),
		);
		expect(quoteMixedEdit?.value).toBe(
			[
				"> **_keep_**",
				">",
				">     echo hi",
				">",
				"> $$",
				"> E = mc^2",
				"> $$",
				">",
				"> \\[a + b\\]",
				">",
				"> **after**",
			].join("\n"),
		);
	});

	it("keeps multiline inline code spans indivisible and never inserts ** inside backticks", () => {
		const multilineCode = "before `line one\nline two` after\n\nnext para";
		const fullEdit = toggleSourceBoldSelection(
			multilineCode,
			selectAll(multilineCode),
		);
		expect(fullEdit?.value).toBe(
			"**before `line one\nline two` after**\n\n**next para**",
		);

		// Strictly inside a multiline inline code span -> unavailable (never inserts **)
		const insideOnly = toggleSourceBoldSelection(
			multilineCode,
			selectSubstring(multilineCode, "line one\nline two"),
		);
		expect(insideOnly).toBeNull();

		// Starting inside the inline code span and crossing outside -> wraps only text outside code span
		const partialFromInside = toggleSourceBoldSelection(
			multilineCode,
			selectSubstring(multilineCode, "one\nline two` after"),
		);
		expect(partialFromInside?.value).toBe(
			"before `line one\nline two` **after**\n\nnext para",
		);

		// Multiline inline code inside blockquote stays intact
		const quotedCode = "> before `line 1\n> line 2` after";
		const quotedEdit = toggleSourceBoldSelection(
			quotedCode,
			selectAll(quotedCode),
		);
		expect(quotedEdit?.value).toBe("> **before `line 1\n> line 2` after**");
	});

	it("returns single-pass planSourceBoldSelection variants accurately", () => {
		expect(
			planSourceBoldSelection("Hello world", selectSubstring("Hello world", "world")),
		).toEqual({ kind: "delegate-toolbar" });
		expect(planSourceBoldSelection("---", selectAll("---"))).toEqual({
			kind: "unavailable",
		});
		const multi = planSourceBoldSelection("Alpha\n\nBeta", selectAll("Alpha\n\nBeta"));
		expect(multi.kind).toBe("edit");
		if ("edit" === multi.kind) {
			expect(multi.edit.value).toBe("**Alpha**\n\n**Beta**");
		}
	});

	it("returns null without mutating when selection spans only non-boldable blocks or whitespace", () => {
		const codeOnly = "```js\nconst a = 1;\n```";
		expect(toggleSourceBoldSelection(codeOnly, selectAll(codeOnly))).toBeNull();

		const hrOnly = "---";
		expect(toggleSourceBoldSelection(hrOnly, selectAll(hrOnly))).toBeNull();

		const mathOnly = "$$\nE = mc^2\n$$";
		expect(toggleSourceBoldSelection(mathOnly, selectAll(mathOnly))).toBeNull();

		const blankOnly = "   \n\n\t  ";
		expect(toggleSourceBoldSelection(blankOnly, selectAll(blankOnly))).toBeNull();

		const delimiterOnly = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(
			toggleSourceBoldSelection(
				delimiterOnly,
				selectSubstring(delimiterOnly, "| --- | --- |"),
			),
		).toBeNull();

		const setextUnderline = "Title\n=====";
		expect(
			toggleSourceBoldSelection(
				setextUnderline,
				selectSubstring(setextUnderline, "====="),
			),
		).toBeNull();
	});

	it("keeps angle-bracket autolinks and bare URLs indivisible so bold never corrupts URL destinations", () => {
		const autolink = "<https://example.test>";
		expect(
			planSourceBoldSelection(autolink, selectSubstring(autolink, "example")),
		).toEqual({ kind: "unavailable" });
		expect(
			planSourceBoldSelection(
				autolink,
				selectSubstring(autolink, "https://example.test"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(autolink, selectAll(autolink))?.value,
		).toBe("**<https://example.test>**");

		const emailAutolink = "<user@example.test>";
		expect(
			planSourceBoldSelection(emailAutolink, selectSubstring(emailAutolink, "user")),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(emailAutolink, selectAll(emailAutolink))?.value,
		).toBe("**<user@example.test>**");

		const surrounded = "before <https://example.test> after";
		expect(
			toggleSourceBoldSelection(surrounded, selectAll(surrounded))?.value,
		).toBe("**before <https://example.test> after**");
		expect(
			toggleSourceBoldSelection(
				surrounded,
				selectSubstring(surrounded, "before <https://example"),
			)?.value,
		).toBe("**before** <https://example.test> after");
		expect(
			toggleSourceBoldSelection(
				surrounded,
				selectSubstring(surrounded, "example.test> after"),
			)?.value,
		).toBe("before <https://example.test> **after**");

		const boldAutolink = "**<https://example.test>**";
		expect(
			planSourceBoldSelection(
				boldAutolink,
				selectSubstring(boldAutolink, "example"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				boldAutolink,
				selectSubstring(boldAutolink, "<https://example.test>"),
			)?.value,
		).toBe("<https://example.test>");

		const bareUrl = "https://example.test";
		expect(
			planSourceBoldSelection(bareUrl, selectSubstring(bareUrl, "example")),
		).toEqual({ kind: "unavailable" });
		expect(toggleSourceBoldSelection(bareUrl, selectAll(bareUrl))?.value).toBe(
			"**https://example.test**",
		);
	});

	it("splits multiline quoted and container StrongEmphasis cleanly on partial unbold without misplacing delimiters", () => {
		const quoted = "> **one\n> two**";
		const unboldTwo = toggleSourceBoldSelection(
			quoted,
			selectSubstring(quoted, "two"),
		);
		expect(unboldTwo?.value).toBe("> **one**\n> two");
		expect(
			unboldTwo?.value.slice(unboldTwo.selection.start, unboldTwo.selection.end),
		).toBe("two");

		const unboldOne = toggleSourceBoldSelection(
			quoted,
			selectSubstring(quoted, "one"),
		);
		expect(unboldOne?.value).toBe("> one\n> **two**");
		expect(
			unboldOne?.value.slice(unboldOne.selection.start, unboldOne.selection.end),
		).toBe("one");

		const threeLines = "> **one\n> two\n> three**";
		expect(
			toggleSourceBoldSelection(threeLines, selectSubstring(threeLines, "two"))
				?.value,
		).toBe("> **one**\n> two\n> **three**");

		const nestedQuote = "> > **one\n> > two**";
		expect(
			toggleSourceBoldSelection(nestedQuote, selectSubstring(nestedQuote, "two"))
				?.value,
		).toBe("> > **one**\n> > two");
		expect(
			toggleSourceBoldSelection(nestedQuote, selectSubstring(nestedQuote, "one"))
				?.value,
		).toBe("> > one\n> > **two**");

		const quotedCrlf = "> **one\r\n> two**";
		expect(
			toggleSourceBoldSelection(quotedCrlf, selectSubstring(quotedCrlf, "two"))
				?.value,
		).toBe("> **one**\r\n> two");
		expect(
			toggleSourceBoldSelection(quotedCrlf, selectSubstring(quotedCrlf, "one"))
				?.value,
		).toBe("> one\r\n> **two**");

		const hardBreak = "**one\\\ntwo**";
		expect(
			toggleSourceBoldSelection(hardBreak, selectSubstring(hardBreak, "two"))
				?.value,
		).toBe("**one**\\\ntwo");
		expect(
			toggleSourceBoldSelection(hardBreak, selectSubstring(hardBreak, "one"))
				?.value,
		).toBe("one\\\n**two**");

		const quotedMixedBefore = "> before\n> **two**";
		expect(
			toggleSourceBoldSelection(quotedMixedBefore, selectAll(quotedMixedBefore))
				?.value,
		).toBe("> **before**\n> **two**");

		const quotedMixedAfter = "> **one**\n> after";
		expect(
			toggleSourceBoldSelection(quotedMixedAfter, selectAll(quotedMixedAfter))
				?.value,
		).toBe("> **one**\n> **after**");
	});

	it("recognizes existing __ strong emphasis when toggling, mixing, or partially unbolding", () => {
		const underscoreBold = "__already__";
		const unwrapped = toggleSourceBoldSelection(
			underscoreBold,
			selectSubstring(underscoreBold, "already"),
		);
		expect(unwrapped?.value).toBe("already");
		expect(unwrapped?.selection).toEqual(sel(0, "already".length));

		const mixedParagraphs = "First\n\n__Already__\n\nLast";
		expect(
			toggleSourceBoldSelection(mixedParagraphs, selectAll(mixedParagraphs))
				?.value,
		).toBe("**First**\n\n__Already__\n\n**Last**");

		const partialUnderscore = "__one two__";
		expect(
			toggleSourceBoldSelection(
				partialUnderscore,
				selectSubstring(partialUnderscore, "two"),
			)?.value,
		).toBe("__one__ two");
		expect(
			toggleSourceBoldSelection(
				partialUnderscore,
				selectSubstring(partialUnderscore, "one"),
			)?.value,
		).toBe("one __two__");

		const quotedUnderscore = "> __one\n> two__";
		expect(
			toggleSourceBoldSelection(
				quotedUnderscore,
				selectSubstring(quotedUnderscore, "two"),
			)?.value,
		).toBe("> __one__\n> two");

		const mixedDelimiters = "**foo** and __bar__";
		const mixedBold = toggleSourceBoldSelection(
			mixedDelimiters,
			selectAll(mixedDelimiters),
		);
		expect(mixedBold?.value).toBe("**foo** **and** __bar__");
		if (!mixedBold) throw new Error("expected-mixed-delimiters-bold-edit");
		expect(
			toggleSourceBoldSelection(mixedBold.value, mixedBold.selection)?.value,
		).toBe("foo and bar");

		// Intraword underscores are not CommonMark StrongEmphasis and should still bold cleanly.
		const intraword = "foo__bar__baz";
		expect(
			toggleSourceBoldSelection(intraword, selectSubstring(intraword, "bar"))
				?.value,
		).toBe("foo__**bar**__baz");
	});

	it("scales linearly on 5,000 mixed-bold paragraphs without quadratic blowup", () => {
		const paragraphCount = 5_000;
		const paragraphs: string[] = [];
		const expected: string[] = [];
		for (let i = 0; i < paragraphCount; i += 1) {
			if (i % 2 === 0) {
				paragraphs.push(`**Bold ${i}**`);
				expected.push(`**Bold ${i}**`);
			} else {
				paragraphs.push(`Plain ${i}`);
				expected.push(`**Plain ${i}**`);
			}
		}
		const markdown = paragraphs.join("\n\n");
		const startedAt = performance.now();
		const edit = toggleSourceBoldSelection(markdown, selectAll(markdown));
		const elapsedMs = performance.now() - startedAt;

		expect(edit?.value).toBe(expected.join("\n\n"));
		expect(elapsedMs).toBeLessThan(2_000);
	});

	it("protects complete GFM extended autolink bare URLs including query strings and fragments", () => {
		const queryUrl = "https://example.test?q=alpha";
		expect(
			planSourceBoldSelection(queryUrl, selectSubstring(queryUrl, "alpha")),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(queryUrl, selectAll(queryUrl))?.value,
		).toBe("**https://example.test?q=alpha**");

		const fragmentUrl = "https://example.test#alpha";
		expect(
			planSourceBoldSelection(
				fragmentUrl,
				selectSubstring(fragmentUrl, "alpha"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(fragmentUrl, selectAll(fragmentUrl))?.value,
		).toBe("**https://example.test#alpha**");

		const pathQueryFrag = "http://example.test/a?q=alpha#frag";
		expect(
			planSourceBoldSelection(
				pathQueryFrag,
				selectSubstring(pathQueryFrag, "alpha"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			planSourceBoldSelection(
				pathQueryFrag,
				selectSubstring(pathQueryFrag, "frag"),
			),
		).toEqual({ kind: "unavailable" });

		const wwwQuery = "www.example.test?q=alpha";
		expect(
			planSourceBoldSelection(wwwQuery, selectSubstring(wwwQuery, "alpha")),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(wwwQuery, selectAll(wwwQuery))?.value,
		).toBe("**www.example.test?q=alpha**");

		const trailingPunct = "https://example.test?q=alpha.";
		expect(
			planSourceBoldSelection(
				trailingPunct,
				selectSubstring(trailingPunct, "alpha"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			planSourceBoldSelection(
				trailingPunct,
				selectSubstring(trailingPunct, "alpha."),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				trailingPunct,
				selectSubstring(trailingPunct, "alpha."),
			),
		).toBeNull();
		expect(
			planSourceBoldSelection(
				trailingPunct,
				selectSubstring(trailingPunct, "."),
			),
		).toEqual({ kind: "unavailable" });

		// Single-level www host, Unicode multi-level host, ftp://, punycode, IPv4, IPv6, basic auth, and port
		const wwwSingle = "www.example?q=alpha";
		expect(
			planSourceBoldSelection(wwwSingle, selectSubstring(wwwSingle, "alpha")),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(wwwSingle, selectSubstring(wwwSingle, "alpha")),
		).toBeNull();
		expect(planSourceBoldSelection(wwwSingle, selectAll(wwwSingle)).kind).toBe(
			"edit",
		);
		expect(toggleSourceBoldSelection(wwwSingle, selectAll(wwwSingle))?.value).toBe(
			"**www.example?q=alpha**",
		);

		const wwwUnicode = "www.例え.test?q=alpha";
		expect(
			planSourceBoldSelection(
				wwwUnicode,
				selectSubstring(wwwUnicode, "alpha"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				wwwUnicode,
				selectSubstring(wwwUnicode, "alpha"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(wwwUnicode, selectAll(wwwUnicode))?.value,
		).toBe("**www.例え.test?q=alpha**");

		const ftpUrl = "ftp://example.test/files/report.txt?v=1";
		expect(
			planSourceBoldSelection(ftpUrl, selectSubstring(ftpUrl, "report")),
		).toEqual({ kind: "unavailable" });

		const punycodeUrl = "http://xn--bcher-kva.example/path?k=val";
		expect(
			planSourceBoldSelection(punycodeUrl, selectSubstring(punycodeUrl, "val")),
		).toEqual({ kind: "unavailable" });

		const ipv4Url = "http://127.0.0.1:8080/api?q=beta";
		expect(
			planSourceBoldSelection(ipv4Url, selectSubstring(ipv4Url, "beta")),
		).toEqual({ kind: "unavailable" });

		const ipv6Url = "http://[::1]:8080/api?q=gamma";
		expect(
			planSourceBoldSelection(ipv6Url, selectSubstring(ipv6Url, "gamma")),
		).toEqual({ kind: "unavailable" });

		const authUrl = "https://user:pass@example.test/home";
		expect(
			planSourceBoldSelection(authUrl, selectSubstring(authUrl, "home")),
		).toEqual({ kind: "unavailable" });

		// Never delegate-toolbar when selection overlaps an indivisible bare URL or fails flanking
		expect(
			planSourceBoldSelection(queryUrl, selectAll(queryUrl)).kind,
		).toBe("edit");
		expect(
			planSourceBoldSelection("foo(bar)", selectSubstring("foo(bar)", "(bar)")),
		).toEqual({ kind: "unavailable" });
		expect(
			planSourceBoldSelection("hello,world", selectSubstring("hello,world", "hello,")),
		).toEqual({ kind: "unavailable" });

		const parenthesized = "(https://example.test?q=alpha)";
		expect(
			planSourceBoldSelection(
				parenthesized,
				selectSubstring(parenthesized, "alpha"),
			),
		).toEqual({ kind: "unavailable" });

		const entitySuffix = "https://example.test?a=1&amp;";
		expect(
			planSourceBoldSelection(
				entitySuffix,
				selectSubstring(entitySuffix, "a=1"),
			),
		).toEqual({ kind: "unavailable" });

		const boldedQueryUrl = "**https://example.test?q=alpha**";
		expect(
			planSourceBoldSelection(
				boldedQueryUrl,
				selectSubstring(boldedQueryUrl, "alpha"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				boldedQueryUrl,
				selectSubstring(boldedQueryUrl, "https://example.test?q=alpha"),
			)?.value,
		).toBe("https://example.test?q=alpha");

		const surrounded = "before https://example.test?q=alpha after";
		expect(
			toggleSourceBoldSelection(
				surrounded,
				selectSubstring(surrounded, "alpha after"),
			)?.value,
		).toBe("before https://example.test?q=alpha **after**");
	});

	it("rewrites intraword underscore partial unbold to valid ** delimiters with zero literal underscores", () => {
		const collectStrongTexts = (markdown: string): string[] => {
			const spans: string[] = [];
			markdownLanguage.parser.parse(markdown).iterate({
				enter(node) {
					if ("StrongEmphasis" === node.name) {
						spans.push(markdown.slice(node.from, node.to));
					}
				},
			});
			return spans;
		};

		const source = "__already__";
		const unboldMiddle = toggleSourceBoldSelection(
			source,
			selectSubstring(source, "read"),
		);
		expect(unboldMiddle?.value).toBe("**al**read**y**");
		expect(
			unboldMiddle?.value.slice(
				unboldMiddle.selection.start,
				unboldMiddle.selection.end,
			),
		).toBe("read");
		expect(unboldMiddle?.value).not.toContain("_");
		expect(collectStrongTexts(unboldMiddle?.value ?? "")).toEqual([
			"**al**",
			"**y**",
		]);

		const unboldPrefix = toggleSourceBoldSelection(
			source,
			selectSubstring(source, "al"),
		);
		expect(unboldPrefix?.value).toBe("al**ready**");
		expect(
			unboldPrefix?.value.slice(
				unboldPrefix.selection.start,
				unboldPrefix.selection.end,
			),
		).toBe("al");
		expect(collectStrongTexts(unboldPrefix?.value ?? "")).toEqual([
			"**ready**",
		]);

		const unboldSuffix = toggleSourceBoldSelection(
			source,
			selectSubstring(source, "y"),
		);
		expect(unboldSuffix?.value).toBe("**alread**y");
		expect(
			unboldSuffix?.value.slice(
				unboldSuffix.selection.start,
				unboldSuffix.selection.end,
			),
		).toBe("y");
		expect(collectStrongTexts(unboldSuffix?.value ?? "")).toEqual([
			"**alread**",
		]);

		const crossWordIntraword = "__one two__";
		expect(
			toggleSourceBoldSelection(
				crossWordIntraword,
				selectSubstring(crossWordIntraword, "e t"),
			)?.value,
		).toBe("**on**e t**wo**");
	});

	it("rebalances crossing nested emphasis on partial unbold and declines unresolvable flanking splits safely", () => {
		const quotedNested = "> **one *two\n> three* four**";
		const unboldTwo = toggleSourceBoldSelection(
			quotedNested,
			selectSubstring(quotedNested, "two"),
		);
		expect(unboldTwo?.value).toBe("> **one** *two\n> **three*** **four**");
		expect(
			unboldTwo?.value.slice(unboldTwo.selection.start, unboldTwo.selection.end),
		).toBe("two");

		const parsedValue = unboldTwo?.value ?? "";
		const strongTexts: string[] = [];
		const emphasisTexts: string[] = [];
		const syntaxMarkRanges: Array<{ from: number; to: number }> = [];
		markdownLanguage.parser.parse(parsedValue).iterate({
			enter(node) {
				if ("StrongEmphasis" === node.name) {
					strongTexts.push(parsedValue.slice(node.from, node.to));
				} else if ("Emphasis" === node.name) {
					emphasisTexts.push(parsedValue.slice(node.from, node.to));
				} else if ("EmphasisMark" === node.name || "QuoteMark" === node.name) {
					syntaxMarkRanges.push({ from: node.from, to: node.to });
				}
			},
		});
		expect(strongTexts).toEqual(["**one**", "**three**", "**four**"]);
		expect(emphasisTexts).toEqual(["*two\n> **three***"]);
		let visible = "";
		for (let i = 0; i < parsedValue.length; i += 1) {
			if (!syntaxMarkRanges.some((range) => i >= range.from && i < range.to)) {
				visible += parsedValue[i];
			}
		}
		expect(visible).toBe(" one two\n three four");
		expect(visible).not.toContain("*");

		const unboldThree = toggleSourceBoldSelection(
			quotedNested,
			selectSubstring(quotedNested, "three"),
		);
		expect(unboldThree?.value).toBe("> **one** ***two**\n> three* **four**");

		const inlineNested = "**one *two* three**";
		expect(
			toggleSourceBoldSelection(
				inlineNested,
				selectSubstring(inlineNested, "two"),
			)?.value,
		).toBe("**one** *two* **three**");

		const nestedStrike = "**one ~~two\nthree~~ four**";
		expect(
			toggleSourceBoldSelection(
				nestedStrike,
				selectSubstring(nestedStrike, "two"),
			)?.value,
		).toBe("**one** ~~two\n**three**~~ **four**");

		const nestedLink = "**[link](https://example.test) text**";
		expect(
			toggleSourceBoldSelection(
				nestedLink,
				selectSubstring(nestedLink, "link"),
			)?.value,
		).toBe("[link](https://example.test) **text**");

		// CommonMark forbids closing `**` between punctuation and word (`**foo!**bar`),
		// so the verifier must decline safely rather than exposing literal `**`.
		const unresolvableFlanking = "**foo!bar**";
		expect(
			planSourceBoldSelection(
				unresolvableFlanking,
				selectSubstring(unresolvableFlanking, "bar"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				unresolvableFlanking,
				selectSubstring(unresolvableFlanking, "bar"),
			),
		).toBeNull();

		// CommonMark §6.2 Rule 9/10: `***one two three***` selecting `e t` would
		// produce broken `***on**e t**wo three***` under strict CommonMark; upgrading
		// the outer `*...*` emphasis to `_..._` yields valid `_**on**e t**wo three**_`.
		const tripleEmphasis = "***one two three***";
		const unboldTripleMiddle = toggleSourceBoldSelection(
			tripleEmphasis,
			selectSubstring(tripleEmphasis, "e t"),
		);
		expect(unboldTripleMiddle?.value).toBe("_**on**e t**wo three**_");
		expect(
			unboldTripleMiddle?.value.slice(
				unboldTripleMiddle.selection.start,
				unboldTripleMiddle.selection.end,
			),
		).toBe("e t");

		// Intraword `a***one two three***b` selecting `e t` cannot upgrade outer `*`
		// to `_` (CommonMark forbids intraword `_`), so it must decline cleanly.
		const intrawordTriple = "a***one two three***b";
		expect(
			planSourceBoldSelection(
				intrawordTriple,
				selectSubstring(intrawordTriple, "e t"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				intrawordTriple,
				selectSubstring(intrawordTriple, "e t"),
			),
		).toBeNull();

		// Image inside a Link inside StrongEmphasis must not truncate the enclosing
		// Link's closing `]` onto the inner Image's `]`.
		const linkWithImage =
			"**[![alt](https://example.test/a.png) text](https://example.test)**";
		const unboldImageLinkText = toggleSourceBoldSelection(
			linkWithImage,
			selectSubstring(linkWithImage, "text"),
		);
		expect(unboldImageLinkText?.value).toBe(
			"[**![alt](https://example.test/a.png)** text](https://example.test)",
		);
	});

	it("scans adversarial URL prefixes in linear time without regex backtracking", () => {
		const repeatedLabels = `http://${"a.".repeat(3_000)}! word`;
		const startedAt = performance.now();
		const edit = toggleSourceBoldSelection(
			repeatedLabels,
			selectSubstring(repeatedLabels, "word"),
		);
		const elapsedMs = performance.now() - startedAt;

		expect(edit?.value).toBe(`http://${"a.".repeat(3_000)}! **word**`);
		expect(elapsedMs).toBeLessThan(1_000);
	});

	it("scans unmatched math openers in linear time without quadratic regex backtracking", () => {
		const prefix = "\\[ ".repeat(20_000);
		const markdown = `${prefix}word`;
		const selection = sel(prefix.length, markdown.length);

		const startedAt = performance.now();
		const edit = toggleSourceBoldSelection(markdown, selection);
		const elapsedMs = performance.now() - startedAt;

		expect(edit?.value).toBe(`${prefix}**word**`);
		expect(elapsedMs).toBeLessThan(1_000);
	});

	it("verifies full wrapped unbold in context and preserves valid full unbolds", () => {
		const conflictingEmphasis = "****one***two*";
		expect(
			planSourceBoldSelection(
				conflictingEmphasis,
				selectSubstring(conflictingEmphasis, "one"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				conflictingEmphasis,
				selectSubstring(conflictingEmphasis, "one"),
			),
		).toBeNull();

		const tripleBoldItalic = "***bold italic***";
		expect(
			toggleSourceBoldSelection(
				tripleBoldItalic,
				selectSubstring(tripleBoldItalic, "bold italic"),
			)?.value,
		).toBe("*bold italic*");

		const quotedTwoLines = "> **one**\n> **two**";
		expect(
			toggleSourceBoldSelection(quotedTwoLines, selectAll(quotedTwoLines))
				?.value,
		).toBe("> one\n> two");
	});

	it("never corrupts relative links or vacuously passes hidden link URL targets", () => {
		const relativeLink = "hello [link](foo) world";
		expect(
			planSourceBoldSelection(
				relativeLink,
				selectSubstring(relativeLink, "(foo)"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				relativeLink,
				selectSubstring(relativeLink, "(foo)"),
			),
		).toBeNull();

		const plainHttpLink = "hello [link](https://example.test) world";
		expect(
			planSourceBoldSelection(
				plainHttpLink,
				selectSubstring(plainHttpLink, "https://example.test"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				plainHttpLink,
				selectSubstring(plainHttpLink, "https://example.test"),
			),
		).toBeNull();

		const boldHttpLink = "**a [link](https://example.test) b**";
		expect(
			planSourceBoldSelection(
				boldHttpLink,
				selectSubstring(boldHttpLink, "https://example.test"),
			),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(
				boldHttpLink,
				selectSubstring(boldHttpLink, "https://example.test"),
			),
		).toBeNull();
	});

	it("scales linearly when bolding text in a 16,000-URL paragraph", () => {
		const tail = "https://example.test ".repeat(16_000);
		const markdown = `hello ${tail}`;
		const startedAt = performance.now();
		const edit = toggleSourceBoldSelection(markdown, sel(0, 5, "none"));
		const elapsedMs = performance.now() - startedAt;

		expect(edit?.value).toBe(`**hello** ${tail}`);
		expect(elapsedMs).toBeLessThan(1_000);
	});

	it("preserves shortcut and collapsed reference link resolution on bold and unbold", () => {
		const shortcut = "hello [link] world\n\n[link]: /foo";
		const shortcutPlan = planSourceBoldSelection(
			shortcut,
			selectSubstring(shortcut, "link"),
		);
		expect(shortcutPlan.kind).toBe("edit");
		const shortcutBold = toggleSourceBoldSelection(
			shortcut,
			selectSubstring(shortcut, "link"),
		);
		expect(shortcutBold?.value).toBe("hello [**link**][link] world\n\n[link]: /foo");
		expect(
			shortcutBold?.value.slice(
				shortcutBold.selection.start,
				shortcutBold.selection.end,
			),
		).toBe("**link**");

		const shortcutUnboldSource = "hello [**link**] world\n\n[**link**]: /foo";
		const shortcutUnbold = toggleSourceBoldSelection(
			shortcutUnboldSource,
			selectSubstring(shortcutUnboldSource, "link"),
		);
		expect(shortcutUnbold?.value).toBe(
			"hello [link][**link**] world\n\n[**link**]: /foo",
		);
		expect(
			shortcutUnbold?.value.slice(
				shortcutUnbold.selection.start,
				shortcutUnbold.selection.end,
			),
		).toBe("link");

		const normalizedShortcut = "hello [Link  Name] world\n\n[link name]: /foo";
		const normalizedBold = toggleSourceBoldSelection(
			normalizedShortcut,
			selectSubstring(normalizedShortcut, "Link  Name"),
		);
		expect(normalizedBold?.value).toBe(
			"hello [**Link  Name**][Link  Name] world\n\n[link name]: /foo",
		);
		expect(
			normalizedBold?.value.slice(
				normalizedBold.selection.start,
				normalizedBold.selection.end,
			),
		).toBe("**Link  Name**");

		const collapsed = "hello [link][] world\n\n[link]: /foo";
		expect(
			planSourceBoldSelection(collapsed, selectSubstring(collapsed, "link")).kind,
		).toBe("edit");
		const collapsedBold = toggleSourceBoldSelection(
			collapsed,
			selectSubstring(collapsed, "link"),
		);
		expect(collapsedBold?.value).toBe(
			"hello [**link**][link] world\n\n[link]: /foo",
		);
		expect(
			collapsedBold?.value.slice(
				collapsedBold.selection.start,
				collapsedBold.selection.end,
			),
		).toBe("**link**");

		const collapsedUnboldSource = "hello [**link**][] world\n\n[**link**]: /foo";
		const collapsedUnbold = toggleSourceBoldSelection(
			collapsedUnboldSource,
			selectSubstring(collapsedUnboldSource, "link"),
		);
		expect(collapsedUnbold?.value).toBe(
			"hello [link][**link**] world\n\n[**link**]: /foo",
		);
		expect(
			collapsedUnbold?.value.slice(
				collapsedUnbold.selection.start,
				collapsedUnbold.selection.end,
			),
		).toBe("link");

		// Unbolding outer ** around a shortcut link preserves [link] without redundant [link] suffix.
		const outerWrapped = "**[link]**\n\n[link]: /foo";
		const outerUnbold = toggleSourceBoldSelection(
			outerWrapped,
			selectSubstring(outerWrapped, "link"),
		);
		expect(outerUnbold?.value).toBe("[link]\n\n[link]: /foo");

		// Partial unbold inside an outer ** wrapping a shortcut link appends the original key.
		const partialOuter = "**[click here] text**\n\n[click here]: /foo";
		const partialOuterUnbold = toggleSourceBoldSelection(
			partialOuter,
			selectSubstring(partialOuter, "click"),
		);
		expect(partialOuterUnbold?.value).toBe(
			"[click **here**][click here] **text**\n\n[click here]: /foo",
		);
	});

	it("preserves full reference links, leaves undefined bracket text untouched, and blocks broken reference edits in verifier", () => {
		const fullRef = "hello [link][id] world\n\n[id]: /foo";
		const fullBold = toggleSourceBoldSelection(
			fullRef,
			selectSubstring(fullRef, "link"),
		);
		expect(fullBold?.value).toBe("hello [**link**][id] world\n\n[id]: /foo");
		const fullUnbold = toggleSourceBoldSelection(
			fullBold?.value ?? "",
			selectSubstring(fullBold?.value ?? "", "link"),
		);
		expect(fullUnbold?.value).toBe(fullRef);

		const undefinedBracket = "hello [plain] world";
		const undefinedBold = toggleSourceBoldSelection(
			undefinedBracket,
			selectSubstring(undefinedBracket, "plain"),
		);
		expect(undefinedBold?.value).toBe("hello [**plain**] world");

		// Verifier safeguard: wrapping inside a resolved shortcut link without preserving the key fails.
		const shortcut = "hello [link] world\n\n[link]: /foo";
		const linkStart = shortcut.indexOf("link");
		expect(
			verifyPlainWrapPlan(
				shortcut,
				0,
				18,
				[{ from: linkStart, to: linkStart + 4 }],
				"**",
				"**",
				{ definedReferenceLabels: new Set(["link"]) },
			),
		).toBe(false);
	});

	it("scales linearly on 16,000 trailing unmatched parens and bracket-terminated URLs after escaped or open brackets", () => {
		const parensDoc = `hello https://example.test/x${")".repeat(16_000)}`;
		const parensStart = performance.now();
		const parensEdit = toggleSourceBoldSelection(parensDoc, sel(0, 5, "none"));
		const parensMs = performance.now() - parensStart;
		expect(parensEdit?.value).toBe(
			`**hello** https://example.test/x${")".repeat(16_000)}`,
		);
		expect(parensMs).toBeLessThan(1_000);

		const escapedTail = "https://example.test/x] ".repeat(16_000);
		const escapedDoc = `hello \\[ ${escapedTail}`;
		const escapedStart = performance.now();
		const escapedEdit = toggleSourceBoldSelection(escapedDoc, sel(0, 5, "none"));
		const escapedMs = performance.now() - escapedStart;
		expect(escapedEdit?.value).toBe(`**hello** \\[ ${escapedTail}`);
		expect(escapedMs).toBeLessThan(1_000);

		const openBracketDoc = `hello [ ${escapedTail}`;
		const openStart = performance.now();
		const openEdit = toggleSourceBoldSelection(openBracketDoc, sel(0, 5, "none"));
		const openMs = performance.now() - openStart;
		expect(openEdit?.value).toBe(`**hello** [ ${escapedTail}`);
		expect(openMs).toBeLessThan(1_000);
	});

	it("strips blockquote container markers from multiline reference definitions and shorthand links", () => {
		const quotedDef = "hello [link name] world\n\n> [link\n> name]: /foo";
		const quotedDefBold = toggleSourceBoldSelection(
			quotedDef,
			selectSubstring(quotedDef, "name"),
		);
		expect(quotedDefBold?.value).toBe(
			"hello [link **name**][link name] world\n\n> [link\n> name]: /foo",
		);

		const quotedLink = "> hello [link\n> name] world\n\n[link name]: /foo";
		const quotedLinkBold = toggleSourceBoldSelection(
			quotedLink,
			selectSubstring(quotedLink, "name"),
		);
		expect(quotedLinkBold?.value).toBe(
			"> hello [link\n> **name**][link name] world\n\n[link name]: /foo",
		);

		const quotedCollapsed =
			"> hello [link\n> name][] world\n\n[link name]: /foo";
		const quotedCollapsedBold = toggleSourceBoldSelection(
			quotedCollapsed,
			selectSubstring(quotedCollapsed, "name"),
		);
		expect(quotedCollapsedBold?.value).toBe(
			"> hello [link\n> **name**][link name] world\n\n[link name]: /foo",
		);

		const nestedQuoted =
			"> > hello [link\n> > name] world\n\n> > [link\n> > name]: /foo";
		const nestedQuotedBold = toggleSourceBoldSelection(
			nestedQuoted,
			selectSubstring(nestedQuoted, "name"),
		);
		expect(nestedQuotedBold?.value).toBe(
			"> > hello [link\n> > **name**][link name] world\n\n> > [link\n> > name]: /foo",
		);

		const quotedFullRef =
			"> hello [link][ref\n> id] world\n\n> [ref\n> id]: /foo";
		const quotedFullRefBold = toggleSourceBoldSelection(
			quotedFullRef,
			selectSubstring(quotedFullRef, "link"),
		);
		expect(quotedFullRefBold?.value).toBe(
			"> hello [**link**][ref\n> id] world\n\n> [ref\n> id]: /foo",
		);
	});

	it("matches upstream @lezer/markdown bracket trimming on nested brackets inside link autolinks", () => {
		const sample = "hello [https://example.test/x[a[b]]( /foo) world";
		const dumpTree = (tree: ReturnType<typeof parseBoldMarkdown>): string[] => {
			const nodes: string[] = [];
			tree.iterate({
				enter(node) {
					nodes.push(`${node.name}:${node.from}-${node.to}`);
				},
			});
			return nodes;
		};
		expect(dumpTree(parseBoldMarkdown(sample))).toEqual(
			dumpTree(markdownLanguage.parser.parse(sample)),
		);
		for (const astSample of [
			"[text](<https://example.test/a b> \"title\") ![alt](/img.png 't') [ref][id] [empty]() []",
			"[![outer ![inner](/i.png)](/o.png)](/href) [[nested](/a)](/b) [a](u(1)(2))",
			`${"![a".repeat(50)}${"](u)".repeat(50)}`,
		]) {
			expect(dumpTree(parseBoldMarkdown(astSample))).toEqual(
				dumpTree(markdownLanguage.parser.parse(astSample)),
			);
		}
		expect(
			planSourceBoldSelection(sample, selectSubstring(sample, "foo")),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(sample, selectSubstring(sample, "foo")),
		).toBeNull();
	});

	it("preserves shorthand reference links on mixed wrapped and enclosed unbold selections", () => {
		const shortcut =
			"[**one** **two three**]\n\n[**one** **two three**]: /foo";
		const shortcutEdit = toggleSourceBoldSelection(
			shortcut,
			selectSubstring(shortcut, "one** **two"),
		);
		expect(shortcutEdit?.value).toBe(
			"[one two **three**][**one** **two three**]\n\n[**one** **two three**]: /foo",
		);

		const collapsed =
			"[**one** **two three**][]\n\n[**one** **two three**]: /foo";
		const collapsedEdit = toggleSourceBoldSelection(
			collapsed,
			selectSubstring(collapsed, "one** **two"),
		);
		expect(collapsedEdit?.value).toBe(
			"[one two **three**][**one** **two three**]\n\n[**one** **two three**]: /foo",
		);

		const leadingStrong =
			"**foo** [**one** **two three**]\n\n[**one** **two three**]: /foo";
		const leadingStrongEdit = toggleSourceBoldSelection(
			leadingStrong,
			selectSubstring(leadingStrong, "foo** [**one** **two"),
		);
		expect(leadingStrongEdit?.value).toBe(
			"foo [one two **three**][**one** **two three**]\n\n[**one** **two three**]: /foo",
		);
	});

	it("scales linearly across 4,000 paragraphs containing shorthand reference links", () => {
		const count = 4_000;
		const body = Array.from({ length: count }, () => "hello [link] world").join(
			"\n\n",
		);
		const markdown = `${body}\n\n[link]: /foo`;
		const startedAt = performance.now();
		const edit = toggleSourceBoldSelection(markdown, sel(0, body.length, "none"));
		const elapsedMs = performance.now() - startedAt;

		const expectedBody = Array.from(
			{ length: count },
			() => "**hello [link] world**",
		).join("\n\n");
		expect(edit?.value).toBe(`${expectedBody}\n\n[link]: /foo`);
		expect(elapsedMs).toBeLessThan(2_000);
	});

	it("preserves non-ASCII whitespace (NBSP, ideographic space) in multiline shorthand reference labels and rejects mismatched keys", () => {
		const nbspDoc =
			"[\u00A0link\nname\u00A0]\n\n[\u00A0link name\u00A0]: /foo\n[link name]: /bar";
		const nbspEdit = toggleSourceBoldSelection(
			nbspDoc,
			selectSubstring(nbspDoc, "name"),
		);
		expect(nbspEdit?.value).toBe(
			"[\u00A0link\n**name**\u00A0][\u00A0link name\u00A0]\n\n[\u00A0link name\u00A0]: /foo\n[link name]: /bar",
		);

		const nbspCollapsedDoc =
			"[\u00A0link\nname\u00A0][]\n\n[\u00A0link name\u00A0]: /foo\n[link name]: /bar";
		const nbspCollapsedEdit = toggleSourceBoldSelection(
			nbspCollapsedDoc,
			selectSubstring(nbspCollapsedDoc, "name"),
		);
		expect(nbspCollapsedEdit?.value).toBe(
			"[\u00A0link\n**name**\u00A0][\u00A0link name\u00A0]\n\n[\u00A0link name\u00A0]: /foo\n[link name]: /bar",
		);

		const cjkSpaceDoc =
			"[\u3000link\nname\u3000]\n\n[\u3000link name\u3000]: /foo\n[link name]: /bar";
		const cjkSpaceEdit = toggleSourceBoldSelection(
			cjkSpaceDoc,
			selectSubstring(cjkSpaceDoc, "name"),
		);
		expect(cjkSpaceEdit?.value).toBe(
			"[\u3000link\n**name**\u3000][\u3000link name\u3000]\n\n[\u3000link name\u3000]: /foo\n[link name]: /bar",
		);

		// Verifier rejects a preservation edit that resolves to a different defined reference key.
		const nameFrom = nbspDoc.indexOf("name");
		const closeAfter = nbspDoc.indexOf("]") + 1;
		const bothKeys = new Set(["\u00A0link name\u00A0", "link name"]);
		expect(
			verifyPlainWrapPlan(
				nbspDoc,
				0,
				closeAfter,
				[{ from: nameFrom, to: nameFrom + 4 }],
				"**",
				"**",
				{ definedReferenceLabels: bothKeys },
				[{ from: closeAfter, insert: "[link name]", to: closeAfter }],
			),
		).toBe(false);
		expect(
			verifyPlainWrapPlan(
				nbspDoc,
				0,
				closeAfter,
				[{ from: nameFrom, to: nameFrom + 4 }],
				"**",
				"**",
				{ definedReferenceLabels: bothKeys },
				[{ from: closeAfter, insert: "[\u00A0link name\u00A0]", to: closeAfter }],
			),
		).toBe(true);
	});

	it("scales linearly on 16,000 autolinks containing unclosed open brackets", () => {
		const tail = "https://example.test/[ ".repeat(16_000);
		const doc = `hello ${tail}`;
		const startedAt = performance.now();
		const edit = toggleSourceBoldSelection(doc, sel(0, 5, "none"));
		const elapsedMs = performance.now() - startedAt;
		expect(edit?.value).toBe(`**hello** ${tail}`);
		expect(elapsedMs).toBeLessThan(1_000);
	});

	it("preserves pure-wrapped and mixed wrapped+enclosed shorthand reference links in one container", () => {
		const pureBody = "[**link**] ".repeat(100).trimEnd();
		const pureDoc = `${pureBody}\n\n[**link**]: /foo`;
		const pureEdit = toggleSourceBoldSelection(
			pureDoc,
			sel(0, pureBody.length, "none"),
		);
		const expectedPureBody = "[link][**link**] ".repeat(100).trimEnd();
		expect(pureEdit?.value).toBe(`${expectedPureBody}\n\n[**link**]: /foo`);

		const mixedPrefix = "[**link**] ".repeat(50);
		const mixedDoc = `${mixedPrefix}[**one** **two three**]\n\n[**link**]: /foo\n[**one** **two three**]: /bar`;
		const mixedSelEnd = mixedDoc.indexOf(" three**]");
		const mixedEdit = toggleSourceBoldSelection(
			mixedDoc,
			sel(0, mixedSelEnd, "none"),
		);
		const expectedMixedPrefix = "[link][**link**] ".repeat(50);
		expect(mixedEdit?.value).toBe(
			`${expectedMixedPrefix}[one two **three**][**one** **two three**]\n\n[**link**]: /foo\n[**one** **two three**]: /bar`,
		);
	});

	it("honors the reported referenceLabelCaseFoldProfile and handles unsupported non-ASCII labels safely", () => {
		const cyrillicDoc = "[\u1C89link]\n\n[\u1C8Alink]: /foo";
		const linkSel = selectSubstring(cyrillicDoc, "link");

		// Default profile (14, matching PHP 8.1-8.3) does not fold U+1C89/U+1C8A.
		expect(toggleSourceBoldSelection(cyrillicDoc, linkSel)?.value).toBe(
			"[\u1C89**link**]\n\n[\u1C8Alink]: /foo",
		);
		expect(
			toggleSourceBoldSelection(cyrillicDoc, linkSel, {
				referenceLabelCaseFoldProfile: 14,
			})?.value,
		).toBe("[\u1C89**link**]\n\n[\u1C8Alink]: /foo");

		// Unicode 16 and 17 fold U+1C89 and U+1C8A together, preserving the /foo link.
		expect(
			toggleSourceBoldSelection(cyrillicDoc, linkSel, {
				referenceLabelCaseFoldProfile: 16,
			})?.value,
		).toBe("[\u1C89**link**][\u1C89link]\n\n[\u1C8Alink]: /foo");
		expect(
			toggleSourceBoldSelection(cyrillicDoc, linkSel, {
				referenceLabelCaseFoldProfile: 17,
			})?.value,
		).toBe("[\u1C89**link**][\u1C89link]\n\n[\u1C8Alink]: /foo");

		// Unsupported profile refuses unverifiable non-ASCII reference matches when non-ASCII
		// definitions exist, preserves provable exact matches, and still resolves pure ASCII.
		expect(
			planSourceBoldSelection(cyrillicDoc, linkSel, {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(cyrillicDoc, linkSel, {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toBeNull();
		const sharpSDoc = "[Stra\u00DFe]\n\n[STRASSE]: /target";
		expect(
			planSourceBoldSelection(sharpSDoc, selectSubstring(sharpSDoc, "Stra\u00DFe"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(sharpSDoc, selectSubstring(sharpSDoc, "Stra\u00DFe"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(sharpSDoc, selectSubstring(sharpSDoc, "Stra\u00DFe"), {
				referenceLabelCaseFoldProfile: 14,
			})?.value,
		).toBe("[**Stra\u00DFe**][Stra\u00DFe]\n\n[STRASSE]: /target");

		// Cross-ASCII folding (U+212A KELVIN SIGN -> "k") is unverifiable under "unsupported".
		const kelvinDoc = "[text][K](/start)\n\n[\u212A]: /kelvin";
		expect(
			planSourceBoldSelection(kelvinDoc, selectSubstring(kelvinDoc, "K"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(kelvinDoc, selectSubstring(kelvinDoc, "K"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toBeNull();
		const kelvinCollisionDoc = "[K]\n\n[\u212A]: /kelvin\n[K]: /ascii";
		expect(
			planSourceBoldSelection(kelvinCollisionDoc, selectSubstring(kelvinCollisionDoc, "K"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(kelvinCollisionDoc, selectSubstring(kelvinCollisionDoc, "K"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toBeNull();

		// ASCII reference labels still resolve cleanly under "unsupported".
		const asciiDoc = "[link]\n\n[LINK]: /foo";
		expect(
			toggleSourceBoldSelection(asciiDoc, selectSubstring(asciiDoc, "link"), {
				referenceLabelCaseFoldProfile: "unsupported",
			})?.value,
		).toBe("[**link**][link]\n\n[LINK]: /foo");

		// Provable exact non-ASCII reference matches preserve href under "unsupported".
		const exactCafeDoc = "[Caf\u00E9]\n\n[Caf\u00E9]: /cafe";
		expect(
			toggleSourceBoldSelection(exactCafeDoc, selectSubstring(exactCafeDoc, "Caf\u00E9"), {
				referenceLabelCaseFoldProfile: "unsupported",
			})?.value,
		).toBe("[**Caf\u00E9**][Caf\u00E9]\n\n[Caf\u00E9]: /cafe");
		const collapsedCafeDoc = "[Caf\u00E9][]\n\n[Caf\u00E9]: /cafe";
		expect(
			toggleSourceBoldSelection(collapsedCafeDoc, selectSubstring(collapsedCafeDoc, "Caf\u00E9"), {
				referenceLabelCaseFoldProfile: "unsupported",
			})?.value,
		).toBe("[**Caf\u00E9**][Caf\u00E9]\n\n[Caf\u00E9]: /cafe");
		const boldedCafeDoc = "[**Caf\u00E9**][Caf\u00E9]\n\n[Caf\u00E9]: /cafe";
		expect(
			toggleSourceBoldSelection(boldedCafeDoc, selectSubstring(boldedCafeDoc, "**Caf\u00E9**"), {
				referenceLabelCaseFoldProfile: "unsupported",
			})?.value,
		).toBe("[Caf\u00E9][Caf\u00E9]\n\n[Caf\u00E9]: /cafe");

		// Non-exact non-ASCII bracket label with non-ASCII definitions is unverifiable -> refused.
		const mixedCaseCafeDoc = "[caf\u00E9]\n\n[CAF\u00C9]: /cafe";
		expect(
			planSourceBoldSelection(mixedCaseCafeDoc, selectSubstring(mixedCaseCafeDoc, "caf\u00E9"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(mixedCaseCafeDoc, selectSubstring(mixedCaseCafeDoc, "caf\u00E9"), {
				referenceLabelCaseFoldProfile: "unsupported",
			}),
		).toBeNull();
		const separateParaCafeDoc = "Plain\n\n[caf\u00E9]\n\n[CAF\u00C9]: /cafe";
		expect(
			toggleSourceBoldSelection(
				separateParaCafeDoc,
				selectSubstring(separateParaCafeDoc, "Plain"),
				{ referenceLabelCaseFoldProfile: "unsupported" },
			)?.value,
		).toBe("**Plain**\n\n[caf\u00E9]\n\n[CAF\u00C9]: /cafe");

		// Zero non-ASCII definitions in the document -> non-ASCII bracket label is provably plain text.
		const asciiOnlyDefDoc = "[Caf\u00E9]\n\n[other]: /other";
		expect(
			toggleSourceBoldSelection(asciiOnlyDefDoc, selectSubstring(asciiOnlyDefDoc, "Caf\u00E9"), {
				referenceLabelCaseFoldProfile: "unsupported",
			})?.value,
		).toBe("[**Caf\u00E9**]\n\n[other]: /other");
	});

	it("resolves chained CommonMark 6.5 reference brackets without redirecting hrefs or creating duplicate links", () => {
		const doc =
			"[note][missing][**status**]\n\n[note]: /note\n[status]: /status\n[**status**]: /original";
		expect(
			planSourceBoldSelection(doc, selectSubstring(doc, "[**status**]")),
		).toEqual({ kind: "unavailable" });
		expect(
			toggleSourceBoldSelection(doc, selectSubstring(doc, "[**status**]")),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(doc, selectSubstring(doc, "status")),
		).toBeNull();

		// Visible link text "missing" bolds cleanly while keeping [**status**] key intact.
		expect(
			toggleSourceBoldSelection(doc, selectSubstring(doc, "missing"))?.value,
		).toBe(
			"[note][**missing**][**status**]\n\n[note]: /note\n[status]: /status\n[**status**]: /original",
		);
		// Unbound literal "[note]" bolds without appending a spurious "[note]" key.
		expect(
			toggleSourceBoldSelection(doc, selectSubstring(doc, "note"))?.value,
		).toBe(
			"[**note**][missing][**status**]\n\n[note]: /note\n[status]: /status\n[**status**]: /original",
		);
		// Wrapping the full line preserves [note]<a href="/original">missing</a> inside <strong>.
		expect(
			toggleSourceBoldSelection(
				doc,
				selectSubstring(doc, "[note][missing][**status**]"),
			)?.value,
		).toBe(
			"**[note][missing][**status**]**\n\n[note]: /note\n[status]: /status\n[**status**]: /original",
		);

		// Direct verifier safeguard rejects redirecting missing -> /status and spawning a second link.
		const lineEnd = "[note][missing][**status**]".length;
		const statusFrom = doc.indexOf("[**status**]");
		expect(
			verifyFullUnboldPlan(
				doc,
				0,
				lineEnd,
				[{ from: statusFrom + 3, to: statusFrom + 9 }],
				[{ from: statusFrom, insert: "[status][**status**]", to: lineEnd }],
				{
					definedReferenceLabels: new Set(["note", "status", "**status**"]),
					referenceLabelCaseFoldProfile: 14,
				},
			),
		).toBe(false);

		// CommonMark 6.5 bracket-stack corner cases.
		const defs = new Set(["a", "c", "d"]);
		expect(
			analyzeLeagueInlineBlock("[a][b][c][d]", {
				definedReferenceLabels: defs,
				referenceLabelCaseFoldProfile: 14,
			}).bindings.map((b) => ({
				form: b.form,
				from: b.from,
				key: b.key,
				kind: b.kind,
				to: b.to,
			})),
		).toEqual([
			{ form: "full", from: 3, key: "ref:c", kind: "link", to: 9 },
			{ form: "shortcut", from: 9, key: "ref:d", kind: "link", to: 12 },
		]);
		expect(
			analyzeLeagueInlineBlock("[a][b[c]]", {
				definedReferenceLabels: defs,
				referenceLabelCaseFoldProfile: 14,
			}).bindings.map((b) => b.key),
		).toEqual(["ref:a", "ref:c"]);
		expect(
			analyzeLeagueInlineBlock("[a][b[x]]", {
				definedReferenceLabels: defs,
				referenceLabelCaseFoldProfile: 14,
			}).bindings.map((b) => b.key),
		).toEqual(["ref:a"]);
		expect(
			analyzeLeagueInlineBlock("[a][   ]", {
				definedReferenceLabels: defs,
				referenceLabelCaseFoldProfile: 14,
			}).bindings,
		).toEqual([]);
		expect(
			analyzeLeagueInlineBlock("[![logo](/l.png)](/href) [[inner](/a)](/b)", {
				definedReferenceLabels: defs,
				referenceLabelCaseFoldProfile: 14,
			}).bindings.map((b) => `${b.kind}:${b.key}`),
		).toEqual(["link:inline:/href", "image:inline:/l.png", "link:inline:/a"]);
	});

	it("protects reference and inline images when bolding or unbolding surrounding prose", () => {
		const refImgDoc = "See ![**logo**].\n\n[**logo**]: /logo.png";
		const wrapped = toggleSourceBoldSelection(
			refImgDoc,
			selectSubstring(refImgDoc, "See ![**logo**]."),
		);
		expect(wrapped?.value).toBe("**See ![**logo**].**\n\n[**logo**]: /logo.png");

		// Unbolding the wrapped line (inner or outer selection) restores the original cleanly.
		const wrappedText = wrapped?.value ?? "";
		expect(
			toggleSourceBoldSelection(
				wrappedText,
				selectSubstring(wrappedText, "See ![**logo**]."),
			)?.value,
		).toBe(refImgDoc);
		expect(
			toggleSourceBoldSelection(
				wrappedText,
				selectSubstring(wrappedText, "**See ![**logo**].**"),
			)?.value,
		).toBe(refImgDoc);
		expect(
			toggleSourceBoldSelection(
				wrappedText,
				selectSubstring(wrappedText, "See"),
			)?.value,
		).toBe("See **![**logo**].**\n\n[**logo**]: /logo.png");

		// Partial overlap clamps outside the image; selecting only inside the image is unavailable.
		expect(
			toggleSourceBoldSelection(
				refImgDoc,
				selectSubstring(refImgDoc, "See ![**lo"),
			)?.value,
		).toBe("**See** ![**logo**].\n\n[**logo**]: /logo.png");
		expect(
			toggleSourceBoldSelection(refImgDoc, selectSubstring(refImgDoc, "logo")),
		).toBeNull();
		const plainImgDoc = "![logo]\n\n[logo]: /logo.png";
		expect(
			planSourceBoldSelection(plainImgDoc, selectSubstring(plainImgDoc, "logo")),
		).toEqual({ kind: "unavailable" });

		// Inline, full-reference, collapsed-reference, and image-inside-link forms.
		for (const sample of [
			"See ![**logo**](/logo.png).",
			"See ![**logo**][id].\n\n[id]: /logo.png",
			"See ![**logo**][].\n\n[**logo**]: /logo.png",
		]) {
			const firstLine = sample.split("\n")[0] ?? sample;
			const bolded = toggleSourceBoldSelection(
				sample,
				selectSubstring(sample, firstLine),
			);
			expect(bolded?.value).toBe(sample.replace(firstLine, `**${firstLine}**`));
			const unbolded = toggleSourceBoldSelection(
				bolded?.value ?? "",
				selectSubstring(bolded?.value ?? "", `**${firstLine}**`),
			);
			expect(unbolded?.value).toBe(sample);
		}

		const linkedImg = "[![**logo**](/logo.png)](/href)";
		expect(
			toggleSourceBoldSelection(linkedImg, selectAll(linkedImg))?.value,
		).toBe("**[![**logo**](/logo.png)](/href)**");
		expect(
			toggleSourceBoldSelection(linkedImg, selectSubstring(linkedImg, "logo")),
		).toBeNull();
	});

	it("scales linearly in the CommonMark bracket-stack resolver on 16,000 adversarial brackets", () => {
		const openBrackets = `${"[".repeat(16_000)} word`;
		const openStart = performance.now();
		const openEdit = toggleSourceBoldSelection(
			openBrackets,
			selectSubstring(openBrackets, "word"),
		);
		const openMs = performance.now() - openStart;
		expect(openEdit?.value).toBe(`${"[".repeat(16_000)} **word**`);
		expect(openMs).toBeLessThan(1_000);

		const repeatedPairs = `${"[a]".repeat(16_000)} word`;
		const pairsStart = performance.now();
		const pairsEdit = toggleSourceBoldSelection(
			repeatedPairs,
			selectSubstring(repeatedPairs, "word"),
		);
		const pairsMs = performance.now() - pairsStart;
		expect(pairsEdit?.value).toBe(`${"[a]".repeat(16_000)} **word**`);
		expect(pairsMs).toBeLessThan(1_000);

		const imageStackWithLinks = `${"![".repeat(8_000)}${"[a](/a) ".repeat(8_000)}${"]".repeat(8_000)}`;
		const imgStackStart = performance.now();
		const imgStackBindings = analyzeLeagueInlineBlock(imageStackWithLinks, {
			definedReferenceLabels: new Set(),
			referenceLabelCaseFoldProfile: 14,
		}).bindings;
		const imgStackFirstA = imageStackWithLinks.indexOf("[a](/a)") + 1;
		const imgStackEdit = toggleSourceBoldSelection(
			imageStackWithLinks,
			sel(imgStackFirstA, imgStackFirstA + 1, "none"),
		);
		const imgStackMs = performance.now() - imgStackStart;
		expect(imgStackBindings).toHaveLength(8_000);
		// Depth-8000 shortcut `![...]` nesting exceeds MAX_LEZER_INLINE_DEPTH (100) and cleanly declines.
		expect(imgStackEdit).toBeNull();
		expect(imgStackMs).toBeLessThan(2_000);

		const imageStack16k = `word ${"![".repeat(16_000)}${"[a](/a) ".repeat(16_000)}${"]".repeat(16_000)}`;
		const imgStack16kStart = performance.now();
		const imgStack16kFirstA = imageStack16k.indexOf("[a](/a)") + 1;
		const imgStack16kInnerEdit = toggleSourceBoldSelection(
			imageStack16k,
			sel(imgStack16kFirstA, imgStack16kFirstA + 1, "none"),
		);
		const imgStack16kOuterEdit = toggleSourceBoldSelection(
			imageStack16k,
			sel(0, 4, "none"),
		);
		const imgStack16kMs = performance.now() - imgStack16kStart;
		expect(imgStack16kInnerEdit).toBeNull();
		expect(imgStack16kOuterEdit?.value.startsWith("**word** ")).toBe(true);
		expect(imgStack16kMs).toBeLessThan(3_000);

		// Within MAX_LEZER_INLINE_DEPTH (depth 50), 8,000 inline links inside `![...]` still bold cleanly.
		const boundedImageStack = `${"![".repeat(50)}${"[a](/a) ".repeat(8_000)}${"]".repeat(50)}`;
		const boundedFirstA = boundedImageStack.indexOf("[a](/a)") + 1;
		expect(
			toggleSourceBoldSelection(
				boundedImageStack,
				sel(boundedFirstA, boundedFirstA + 1, "none"),
			)?.value.slice(boundedFirstA - 1, boundedFirstA + 10),
		).toBe("[**a**](/a)");

		const nestedImages = `word ${"![a".repeat(16_000)}${"](u)".repeat(16_000)}`;
		const nestedStart = performance.now();
		const nestedEdit = toggleSourceBoldSelection(
			nestedImages,
			selectSubstring(nestedImages, "word"),
		);
		const nestedMs = performance.now() - nestedStart;
		expect(nestedEdit?.value).toBe(`**word** ${"![a".repeat(16_000)}${"](u)".repeat(16_000)}`);
		expect(nestedMs).toBeLessThan(2_000);

		const siblingLinksAndCode = `${"[a](u) `c` ".repeat(4_000)}word`;
		const siblingStart = performance.now();
		const siblingEdit = toggleSourceBoldSelection(
			siblingLinksAndCode,
			selectSubstring(siblingLinksAndCode, "word"),
		);
		const siblingMs = performance.now() - siblingStart;
		expect(siblingEdit?.value).toBe(`${"[a](u) `c` ".repeat(4_000)}**word**`);
		expect(siblingMs).toBeLessThan(2_000);

		const multiContainerNoCloseParen = `${"[a](b\n\n".repeat(16_000)}word`;
		const multiStart = performance.now();
		const multiEdit = toggleSourceBoldSelection(
			multiContainerNoCloseParen,
			selectSubstring(multiContainerNoCloseParen, "word"),
		);
		const multiMs = performance.now() - multiStart;
		expect(multiEdit?.value).toBe(`${"[a](b\n\n".repeat(16_000)}**word**`);
		expect(multiMs).toBeLessThan(2_000);

		const unclosedHtmlComments = `${"<!--".repeat(8_000)}x> [a](b)`;
		const inlineUnclosedHtmlComments = `p ${unclosedHtmlComments}`;
		const htmlStart = performance.now();
		const htmlBindings = analyzeLeagueInlineBlock(unclosedHtmlComments, {
			definedReferenceLabels: new Set(),
			referenceLabelCaseFoldProfile: 14,
		}).bindings;
		const htmlEdit = toggleSourceBoldSelection(
			inlineUnclosedHtmlComments,
			selectSubstring(inlineUnclosedHtmlComments, "a"),
		);
		const htmlMs = performance.now() - htmlStart;
		expect(htmlBindings).toHaveLength(1);
		expect(htmlEdit?.value).toBe(`p ${"<!--".repeat(8_000)}x> [**a**](b)`);
		expect(htmlMs).toBeLessThan(1_000);
	});

	it("matches League CommonMark TaskListItemMarkerParser before inline bracket parsing", () => {
		for (const marker of ["[x]", "[X]", "[ ]"]) {
			const doc = `- ${marker}[guide](/start)\n\n[guide]: /reference`;
			expect(
				planSourceBoldSelection(doc, selectSubstring(doc, "](/start")),
			).toEqual({ kind: "unavailable" });
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "](/start")),
			).toBeNull();
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, marker)),
			).toBeNull();
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "guide"))?.value,
			).toBe(`- ${marker}[**guide**](/start)\n\n[guide]: /reference`);
		}

		// Quoted list item also consumes the task marker before link parsing.
		const quotedTask = "> - [x][guide](/start)\n\n[guide]: /reference";
		expect(
			toggleSourceBoldSelection(quotedTask, selectSubstring(quotedTask, "](/start")),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(quotedTask, selectSubstring(quotedTask, "guide"))?.value,
		).toBe("> - [x][**guide**](/start)\n\n[guide]: /reference");

		// Bare `- [x]` without trailing non-space text is NOT a task marker in League.
		const bareMarker = "- [x]";
		expect(
			toggleSourceBoldSelection(bareMarker, selectSubstring(bareMarker, "x"))?.value,
		).toBe("- [**x**]");
		const bareRefMarker = "- [x]\n\n[x]: /target";
		expect(
			toggleSourceBoldSelection(bareRefMarker, selectSubstring(bareRefMarker, "x"))?.value,
		).toBe("- [**x**][x]\n\n[x]: /target");

		// Second direct-child Paragraph of a ListItem DOES consume `[x]` in League TaskListItemMarkerParser.
		const secondPara = "- para1\n\n  [x][guide](/start)\n\n[guide]: /reference";
		expect(
			toggleSourceBoldSelection(secondPara, selectSubstring(secondPara, "](/start")),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(secondPara, selectSubstring(secondPara, "guide"))?.value,
		).toBe("- para1\n\n  [x][**guide**](/start)\n\n[guide]: /reference");

		// Paragraph inside a Blockquote child of a ListItem is NOT a direct ListItem child -> NOT a task marker.
		const quotedInList = "- > [x][guide](/start)\n\n[guide]: /reference";
		expect(
			toggleSourceBoldSelection(quotedInList, selectSubstring(quotedInList, "x"))?.value,
		).toBe("- > [**x**][guide](/start)\n\n[guide]: /reference");
		expect(
			toggleSourceBoldSelection(quotedInList, selectSubstring(quotedInList, "(/start)"))?.value,
		).toBe("- > [x][guide]**(/start)**\n\n[guide]: /reference");
	});

	it("matches upstream @lezer/markdown AST across emphasis, strikethrough, links, tables, and blockquotes at normal depths", () => {
		const dumpTree = (tree: ReturnType<typeof parseBoldMarkdown>): string[] => {
			const nodes: string[] = [];
			tree.iterate({
				enter(node) {
					nodes.push(`${node.name}:${node.from}-${node.to}`);
				},
			});
			return nodes;
		};
		const samples = [
			"*a* **b** ***c*** _d_ __e__ ___f___ ~~g~~",
			"foo*bar*baz foo**bar**baz foo_bar_baz _a_b_ *a**b* *a***b* ***a**b* ****a****",
			"a*b*c a**b**c a***b***c a****b****c **a *b* c** *a **b** c* ~~**a *b***~~",
			"[link *em* **strong** ~~del~~ `code`](https://example.com \"title\") ![img *alt*](/img.png 't')",
			"\\*escaped\\* `code *not em*` <https://example.com> https://example.com/a(b) www.example.com",
			"| *a* | **b** | ~~c~~ |\n| --- | --- | --- |\n| [d](/e) | `f` | _g_ |",
			"> *quoted **bold** and ~~strike~~*\n> with [link](/u) and **multi\n> line**",
			`${"*a ".repeat(40)}${" a*".repeat(40)}`,
			`${"~~a ".repeat(40)}${" a~~".repeat(40)}`,
			"[ref]: /url \"title\"\n\n[ref]",
			"[a]: /1\n[b]: /2\n\nbody",
		];
		for (const sample of samples) {
			expect(dumpTree(parseBoldMarkdown(sample))).toEqual(
				dumpTree(markdownLanguage.parser.parse(sample)),
			);
		}
	});

	it("handles deeply nested emphasis, strikethrough, links, and images without stack overflow and marks depth > 100 regions unverifiable", () => {
		const cases: ReadonlyArray<Readonly<[string, string, string, boolean]>> = [
			["link+em", `${"[a *b ".repeat(16_000)}${" c*](u)".repeat(16_000)}`, "b", true],
			["asterisk", `${"*a ".repeat(16_000)}${" a*".repeat(16_000)}`, "a", true],
			["underscore", `${"_a ".repeat(16_000)}${" a_".repeat(16_000)}`, "a", true],
			["strikethrough", `${"~~a ".repeat(16_000)}${" a~~".repeat(16_000)}`, "a", true],
			["images", `${"![a".repeat(16_000)}${"](u)".repeat(16_000)}`, "a", false],
		];
		for (const [_label, payload, innerChar, exceedsDelimiterBudget] of cases) {
			const sameParaDoc = `word ${payload}`;
			const startedSame = performance.now();
			const sameParaEdit = toggleSourceBoldSelection(
				sameParaDoc,
				sel(0, 4, "none"),
			);
			const sameParaMs = performance.now() - startedSame;
			if (exceedsDelimiterBudget) {
				// Wrapping `word` in the same paragraph would consume 2 slots of League's
				// 1,000-delimiter budget and shift downstream emphasis cutoffs.
				expect(sameParaEdit).toBeNull();
			} else {
				expect(sameParaEdit?.value.startsWith("**word** ")).toBe(true);
			}
			expect(sameParaMs).toBeLessThan(1_000);

			const sepParaDoc = `word\n\n${payload}`;
			const startedSep = performance.now();
			const outsideEdit = toggleSourceBoldSelection(
				sepParaDoc,
				sel(0, 4, "none"),
			);
			const elapsedMs = performance.now() - startedSep;
			expect(outsideEdit?.value.startsWith("**word**\n\n")).toBe(true);
			expect(elapsedMs).toBeLessThan(1_000);

			const tree = parseBoldMarkdown(sameParaDoc);
			expect(getBoldMarkdownUnverifiableRanges(tree).length).toBeGreaterThan(0);

			const innerIdx = sameParaDoc.indexOf(innerChar, 6);
			expect(
				toggleSourceBoldSelection(
					sameParaDoc,
					sel(innerIdx, innerIdx + 1, "none"),
				),
			).toBeNull();
		}
	});

	it("scales linearly on pathological failed inline link destinations, titles, and reference labels", () => {
		const pathological: ReadonlyArray<string> = [
			`word ${"[a](".repeat(16_000)})`,
			`word ${"[a](x".repeat(16_000)} y)`,
			`word ${"[a](u (".repeat(16_000)} y)`,
			`word ${"![a](x".repeat(16_000)} y)`,
			`word ${"[a](<x".repeat(16_000)}>`,
			`word ${"[a](u \"".repeat(16_000)} y)`,
			`word ${"[a](u '".repeat(16_000)} y)`,
			`word ${"[a][b".repeat(16_000)}]`,
			`word\n\n[x]: ${"(".repeat(16_000)}`,
			`word\n\n${"[".repeat(16_000)}`,
		];
		for (const doc of pathological) {
			const startedAt = performance.now();
			const edit = toggleSourceBoldSelection(doc, sel(0, 4, "none"));
			const elapsedMs = performance.now() - startedAt;
			expect(edit?.value.startsWith("**word**")).toBe(true);
			expect(elapsedMs).toBeLessThan(1_000);
		}
	});

	it("matches League CommonMark 2.8.2 LinkReference definition and inline link-tail parity", () => {
		// Escaped `>` inside `<...>` destination.
		const escapedAngle = "[x]\n\n[x]: <a\\>b>";
		expect(
			toggleSourceBoldSelection(escapedAngle, sel(1, 2, "none"))?.value,
		).toBe("[**x**][x]\n\n[x]: <a\\>b>");

		// 999 vs 1000 ASCII code point link reference label boundary.
		const k999 = "x".repeat(999);
		const doc999 = `[text][${k999}](/original)\n\n[${k999}]: /defined`;
		expect(toggleSourceBoldSelection(doc999, sel(7, 8, "none"))).toBeNull();

		const k1000 = "x".repeat(1000);
		const doc1000 = `[text][${k1000}](/original)\n\n[${k1000}]: /defined`;
		expect(toggleSourceBoldSelection(doc1000, sel(7, 8, "none"))?.value).toBe(
			`[text][**x**${k1000.slice(1)}](/original)\n\n[${k1000}]: /defined`,
		);

		// 999 vs 1000 astral Unicode code point link reference label boundary (`mb_strlen`).
		// At 999 code points (3,993 UTF-8 bytes), the shortcut link IS resolved by League,
		// so bolding `a` must decline because converting to `[**a**...][label]` would exceed
		// `LinkParserHelper::parseLinkLabel`'s 1,000-UTF-8-byte cap and break the link.
		const astral999 = `a${"😀".repeat(998)}`;
		const astralDoc999 = `[${astral999}]\n\n[${astral999}]: /defined`;
		expect(
			toggleSourceBoldSelection(astralDoc999, sel(1, 2, "none")),
		).toBeNull();

		const astral1000 = `a${"😀".repeat(999)}`;
		const astralDoc1000 = `[${astral1000}]\n\n[${astral1000}]: /defined`;
		expect(
			toggleSourceBoldSelection(astralDoc1000, sel(1, 2, "none"))?.value,
		).toBe(`[**a**${"😀".repeat(999)}]\n\n[${astral1000}]: /defined`);

		// Unbalanced bare destination is rejected (not a reference definition).
		const unbalancedDest = "[x]\n\n[x]: u(";
		expect(
			toggleSourceBoldSelection(unbalancedDest, sel(1, 2, "none"))?.value,
		).toBe("[**x**]\n\n[x]: u(");

		// Empty `< >` destination, multiline label, multiline title, consecutive defs, blockquote def.
		expect(
			toggleSourceBoldSelection("[x]\n\n[x]: <>", sel(1, 2, "none"))?.value,
		).toBe("[**x**][x]\n\n[x]: <>");
		expect(
			toggleSourceBoldSelection("[x]\n\n[\n x\n]: /u", sel(1, 2, "none"))?.value,
		).toBe("[**x**][x]\n\n[\n x\n]: /u");
		expect(
			toggleSourceBoldSelection("[x]\n\n[x]: /u\n\"t1\nt2\"", sel(1, 2, "none"))?.value,
		).toBe("[**x**][x]\n\n[x]: /u\n\"t1\nt2\"");
		expect(
			toggleSourceBoldSelection("[a] [b]\n\n[a]: /1\n[b]: /2\nbody", sel(5, 6, "none"))?.value,
		).toBe("[a] [**b**][b]\n\n[a]: /1\n[b]: /2\nbody");
		expect(
			toggleSourceBoldSelection("[x]\n\n> [x]: <a\\>b>", sel(1, 2, "none"))?.value,
		).toBe("[**x**][x]\n\n> [x]: <a\\>b>");

		// Invalid next-line title preserves valid destination definition and leaves trailing lines as paragraph.
		const invalidNextLine = "[a] [b]\n\n[a]: /1\n\"unclosed\n[b]: /2";
		expect(
			toggleSourceBoldSelection(invalidNextLine, sel(1, 2, "none"))?.value,
		).toBe("[**a**][a] [b]\n\n[a]: /1\n\"unclosed\n[b]: /2");
		expect(
			toggleSourceBoldSelection(invalidNextLine, sel(5, 6, "none"))?.value,
		).toBe("[a] [**b**]\n\n[a]: /1\n\"unclosed\n[b]: /2");

		// Invalid same-line trailing text rejects the entire reference definition.
		const invalidSameLine = "[x]\n\n[x]: /u \"t\" extra";
		expect(
			toggleSourceBoldSelection(invalidSameLine, sel(1, 2, "none"))?.value,
		).toBe("[**x**]\n\n[x]: /u \"t\" extra");

		// League 2.8.2 parity: `(...)` title with unescaped `(` is accepted in ref definitions
		// (`LinkParserHelper::parsePartialLinkTitle`) but rejected in inline links (`PARTIAL_LINK_TITLE`).
		expect(
			toggleSourceBoldSelection("[x]\n\n[x]: /u (a(b)", sel(1, 2, "none"))?.value,
		).toBe("[**x**][x]\n\n[x]: /u (a(b)");
		const inlineInvalidParenTitle = "[x](/u (a(b))";
		expect(
			toggleSourceBoldSelection(
				inlineInvalidParenTitle,
				selectSubstring(inlineInvalidParenTitle, "a"),
			)?.value,
		).toBe("[x](/u (**a**(b))");
	});

	it("matches upstream @lezer/markdown AST across autolink URLs, emails, brackets, entities, and depth-99 block nesting", () => {
		const dumpTree = (tree: ReturnType<typeof parseBoldMarkdown>): string[] => {
			const nodes: string[] = [];
			tree.iterate({
				enter(node) {
					nodes.push(`${node.name}:${node.from}-${node.to}`);
				},
			});
			return nodes;
		};
		const samples = [
			"www.example.com https://a.b.c:8080/path(1)?q=1&amp; www.a_b.c.d/x www.a.b_c.d/x",
			"https://example.com/a(b)) https://example.com/a&#34; https://example.com/a&#x2f; https://example.com/a&bad_;",
			"[www.x.y/z](u) [www.x.y/z?](u) [www.x.y/z[a]](u) [www.x.y/z[unclosed](u) www.x.y/z]plain",
			"user.name+tag-1@sub.example.com. a@b.c_ a@b.c- a@b..c mailto:user@example.com xmpp:user@example.com/res.1@x",
			`${"- ".repeat(49)}a`,
			`${"1. ".repeat(49)}a`,
			`${"> ".repeat(98)}a`,
		];
		for (const sample of samples) {
			expect(dumpTree(parseBoldMarkdown(sample))).toEqual(
				dumpTree(markdownLanguage.parser.parse(sample)),
			);
		}
	});

	it("scales linearly on adjacent link-wrapped URLs, long subdomains, and deeply nested lists/blockquotes", () => {
		const urlWorkloads: ReadonlyArray<string> = [
			`word ${"[www.x.y/z](u)".repeat(16_000)}`,
			`word www.${"a".repeat(16_000)}.b.c/z`,
			`word ${"[www.x.y/z[".repeat(16_000)} ]`,
		];
		for (const doc of urlWorkloads) {
			const startedAt = performance.now();
			const edit = toggleSourceBoldSelection(doc, sel(0, 4, "none"));
			const elapsedMs = performance.now() - startedAt;
			expect(edit?.value.startsWith("**word** ")).toBe(true);
			expect(elapsedMs).toBeLessThan(1_000);
		}

		const nestedBlockWorkloads: ReadonlyArray<string> = [
			`word\n\n${"- ".repeat(16_000)}a`,
			`word\n\n${"1. ".repeat(16_000)}a`,
			`word\n\n${"> ".repeat(16_000)}a`,
		];
		for (const doc of nestedBlockWorkloads) {
			const startedAt = performance.now();
			const outsideEdit = toggleSourceBoldSelection(doc, sel(0, 4, "none"));
			const elapsedMs = performance.now() - startedAt;
			expect(outsideEdit?.value.startsWith("**word**\n\n")).toBe(true);
			expect(elapsedMs).toBeLessThan(1_000);

			const tree = parseBoldMarkdown(doc);
			expect(getBoldMarkdownUnverifiableRanges(tree).length).toBeGreaterThan(0);
			expect(
				toggleSourceBoldSelection(doc, sel(doc.length - 1, doc.length, "none")),
			).toBeNull();
		}
	});

	it("enforces League 2.8.2 LinkParserHelper::parseLinkLabel 1,000-UTF-8-byte-token cap on full references only", () => {
		// 4-byte emoji: 250 * 4 = 1000 tokens (valid full ref), 251 * 4 = 1004 tokens (rejected full ref).
		const emoji250 = "😀".repeat(250);
		const fullEmoji250 = `[text][${emoji250}](/original)\n\n[${emoji250}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullEmoji250, selectSubstring(fullEmoji250, "original"))?.value,
		).toBe(`[text][${emoji250}](/**original**)\n\n[${emoji250}]: /defined`);

		const emoji251 = "😀".repeat(251);
		const fullEmoji251 = `[text][${emoji251}](/original)\n\n[${emoji251}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullEmoji251, selectSubstring(fullEmoji251, "original")),
		).toBeNull();

		// Shortcut and collapsed references allow up to 999 Unicode code points without the
		// 1,000-byte regex: labels <= 1,000 UTF-8 bytes preserve cleanly as `[**a**...][label]`,
		// while labels > 1,000 UTF-8 bytes still resolve as shorthand links and safely decline
		// bolding because a preserved second `[label]` would be rejected by League's `parseLinkLabel`.
		const emoji249Label = `a${"😀".repeat(249)}`; // 1 + 249 * 4 = 997 UTF-8 bytes <= 1000
		const collapsedEmoji249 = `[${emoji249Label}][]\n\n[${emoji249Label}]: /defined`;
		expect(
			toggleSourceBoldSelection(collapsedEmoji249, sel(1, 2, "none"))?.value,
		).toBe(`[**a**${"😀".repeat(249)}][${emoji249Label}]\n\n[${emoji249Label}]: /defined`);
		const shortcutEmoji249 = `[${emoji249Label}]\n\n[${emoji249Label}]: /defined`;
		expect(
			toggleSourceBoldSelection(shortcutEmoji249, sel(1, 2, "none"))?.value,
		).toBe(`[**a**${"😀".repeat(249)}][${emoji249Label}]\n\n[${emoji249Label}]: /defined`);

		const emoji250Label = `a${"😀".repeat(250)}`; // 1 + 250 * 4 = 1001 UTF-8 bytes > 1000
		const collapsedEmoji251 = `[${emoji250Label}][]\n\n[${emoji250Label}]: /defined`;
		expect(
			analyzeLeagueInlineBlock(`[${emoji250Label}][]`, {
				definedReferenceLabels: new Set([emoji250Label]),
				referenceLabelCaseFoldProfile: 14,
			}).bindings,
		).toHaveLength(1);
		expect(
			toggleSourceBoldSelection(collapsedEmoji251, sel(1, 2, "none")),
		).toBeNull();
		const shortcutEmoji251 = `[${emoji250Label}]\n\n[${emoji250Label}]: /defined`;
		expect(
			analyzeLeagueInlineBlock(`[${emoji250Label}]`, {
				definedReferenceLabels: new Set([emoji250Label]),
				referenceLabelCaseFoldProfile: 14,
			}).bindings,
		).toHaveLength(1);
		expect(
			toggleSourceBoldSelection(shortcutEmoji251, sel(1, 2, "none")),
		).toBeNull();

		// 2-byte é: 500 * 2 = 1000 tokens (valid), 501 * 2 = 1002 tokens (rejected).
		const e500 = "é".repeat(500);
		const fullE500 = `[text][${e500}](/original)\n\n[${e500}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullE500, selectSubstring(fullE500, "original"))?.value,
		).toBe(`[text][${e500}](/**original**)\n\n[${e500}]: /defined`);

		const e501 = "é".repeat(501);
		const fullE501 = `[text][${e501}](/original)\n\n[${e501}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullE501, selectSubstring(fullE501, "original")),
		).toBeNull();

		// Escaped multibyte `\😀`: `\.` eats `\` + 1st byte (1 token) + 3 remaining bytes = 4 tokens total.
		const escEmoji250 = "\\😀".repeat(250);
		const fullEscEmoji250 = `[text][${escEmoji250}](/original)\n\n[${escEmoji250}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullEscEmoji250, selectSubstring(fullEscEmoji250, "original"))?.value,
		).toBe(`[text][${escEmoji250}](/**original**)\n\n[${escEmoji250}]: /defined`);

		const escEmoji251 = "\\😀".repeat(251);
		const fullEscEmoji251 = `[text][${escEmoji251}](/original)\n\n[${escEmoji251}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullEscEmoji251, selectSubstring(fullEscEmoji251, "original")),
		).toBeNull();

		// Escaped ASCII `\a` is 1 token but 2 code points: 999 code points valid, 1000 rejected.
		const escA999 = `${"\\a".repeat(499)}a`;
		const fullEscA999 = `[text][${escA999}](/original)\n\n[${escA999}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullEscA999, selectSubstring(fullEscA999, "original"))?.value,
		).toBe(`[text][${escA999}](/**original**)\n\n[${escA999}]: /defined`);

		const escA1000 = "\\a".repeat(500);
		const fullEscA1000 = `[text][${escA1000}](/original)\n\n[${escA1000}]: /defined`;
		expect(
			toggleSourceBoldSelection(fullEscA1000, selectSubstring(fullEscA1000, "original")),
		).toBeNull();
	});

	it("matches League 2.8.2 LinkReference title unescaping, NUL normalization, failed next-line titles, Setext underlines, and leading label whitespace", () => {
		// Escaped closing delimiter & HTML5 entity closing delimiter in LinkReference titles.
		const validRefTitleCases: ReadonlyArray<string> = [
			`[x]\n\n[x]: /u "one\\"`,
			`[x]\n\n[x]: /u 'one\\'`,
			`[x]\n\n[x]: /u (one\\)`,
			`[x]\n\n[x]: /u "one&quot;`,
			`[x]\n\n[x]: /u "one&QUOT;`,
			`[x]\n\n[x]: /u "one&#34;`,
			`[x]\n\n[x]: /u "one&#x22;`,
			`[x]\n\n[x]: /u "one&#x0022;`,
			`[x]\n\n[x]: /u "one\\&quot;`,
			`[x]\n\n[x]: /u "one&quot\\;`,
			`[x]\n\n[x]: /u 'one&apos;`,
			`[x]\n\n[x]: /u 'one&#39;`,
			`[x]\n\n[x]: /u 'one&#x27;`,
			`[x]\n\n[x]: /u (one&rpar;`,
			`[x]\n\n[x]: /u (one&#41;`,
			`[x]\n\n[x]: /u (one&#x29;`,
			`[x]\n\n[x]: /u "a\0b"`,
			`[x]\n\n[x]: </u\0v>`,
			`[x]\n\n[x]: /u\0v`,
		];
		for (const doc of validRefTitleCases) {
			expect(toggleSourceBoldSelection(doc, sel(1, 2, "none"))?.value).toBe(
				`[**x**][x]${doc.slice(3)}`,
			);
		}

		// League normalizes `\0` to `\uFFFD` before inline link parsing too.
		const inlineNulTitle = `[x](/u "a\0b")`;
		expect(
			toggleSourceBoldSelection(inlineNulTitle, selectSubstring(inlineNulTitle, "a")),
		).toBeNull();
		const inlineNulDest = `[x](</u\0v>)`;
		expect(
			toggleSourceBoldSelection(inlineNulDest, selectSubstring(inlineNulDest, "v")),
		).toBeNull();

		// Failed next-line title mutates `<a title="...">` in League: preserve ref, decline edits on failed title, allow unrelated paragraphs.
		const failedNextLineTrailing = `[x]\n\n[x]: /u\n"some word" trailing\n\nunrelated`;
		expect(
			toggleSourceBoldSelection(failedNextLineTrailing, sel(1, 2, "none"))?.value,
		).toBe(`[**x**][x]\n\n[x]: /u\n"some word" trailing\n\nunrelated`);
		expect(
			toggleSourceBoldSelection(
				failedNextLineTrailing,
				selectSubstring(failedNextLineTrailing, "word"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				failedNextLineTrailing,
				selectSubstring(failedNextLineTrailing, "unrelated"),
			)?.value,
		).toBe(`[x]\n\n[x]: /u\n"some word" trailing\n\n**unrelated**`);

		const failedNextLineEof = `[x]\n\n[x]: /u\n"some word`;
		expect(
			toggleSourceBoldSelection(failedNextLineEof, sel(1, 2, "none"))?.value,
		).toBe(`[**x**][x]\n\n[x]: /u\n"some word`);
		expect(
			toggleSourceBoldSelection(
				failedNextLineEof,
				selectSubstring(failedNextLineEof, "word"),
			),
		).toBeNull();

		// Setext underline after valid LinkReference + unclosed title must not swallow LinkReference.
		const setextCases: ReadonlyArray<string> = [
			`[a]\n\n[a]: /u\n"unclosed\n===`,
			`[a]\n\n[a]: /u\n"unclosed\n---`,
			`[a]\n\n[a]: /u\n"line 1\n===\nline 2"`,
			`[a]\n\n> [a]: /u\n> "unclosed\n> ===`,
			`[a b]\n\n[a\nb]: /u\n"unclosed\n===`,
		];
		for (const doc of setextCases) {
			const labelEnd = doc.indexOf("]");
			const labelText = doc.slice(1, labelEnd);
			expect(toggleSourceBoldSelection(doc, sel(1, 2, "none"))?.value).toBe(
				`[**${doc[1]}**${labelText.slice(1)}][${labelText}]${doc.slice(labelEnd + 1)}`,
			);
			const unclosedIdx = doc.indexOf("unclosed");
			if (unclosedIdx >= 0) {
				expect(
					toggleSourceBoldSelection(doc, sel(unclosedIdx, unclosedIdx + 8, "none")),
				).toBeNull();
			}
		}

		// Leading whitespace on line 1 of RefStage.Label does not count toward the 999-code-point cap.
		const x999 = "x".repeat(999);
		const leadSpace999 = `[text][${x999}](/original)\n\n[ ${x999}]: /defined`;
		expect(
			toggleSourceBoldSelection(leadSpace999, selectSubstring(leadSpace999, "original"))?.value,
		).toBe(`[text][${x999}](/**original**)\n\n[ ${x999}]: /defined`);

		const lead1000Spaces = `[a]\n\n[${" ".repeat(1000)}a]: /u`;
		expect(
			toggleSourceBoldSelection(lead1000Spaces, sel(1, 2, "none"))?.value,
		).toBe(`[**a**][a]\n\n[${" ".repeat(1000)}a]: /u`);

		// Depth-101 shortcut Link/Image records unverifiable range even without `(...)` or `[label]` tail.
		const depth101Shortcut = `[${"*a ".repeat(100)}x${" a*".repeat(100)}]`;
		const depthTree = parseBoldMarkdown(depth101Shortcut);
		expect(getBoldMarkdownUnverifiableRanges(depthTree)).toEqual([
			{ from: 0, to: depth101Shortcut.length },
		]);
		expect(
			toggleSourceBoldSelection(depth101Shortcut, selectSubstring(depth101Shortcut, "x")),
		).toBeNull();
	});

	it("caches rejected URL and email domain scans linearly with exact upstream @lezer/markdown AST parity", () => {
		const dumpTree = (tree: ReturnType<typeof parseBoldMarkdown>): string[] => {
			const nodes: string[] = [];
			tree.iterate({
				enter(node) {
					nodes.push(`${node.name}:${node.from}-${node.to}`);
				},
			});
			return nodes;
		};

		const paritySamples: ReadonlyArray<string> = [
			"www.a.b_c.https://ok.com",
			"www.a_b.www.ok.com",
			"https://www.a_b.c",
			"www.www.a_b",
			"www.www.x_y.z",
			"a-www.www.a_b",
			"www.a_b.c-http://ok.com",
			"https://www.a_b/https://ok.com",
			"www.a..www.ok.com",
			"a+a+a@b.c_ a+a+a@b.c- mailto:a+a@b.c_ a+b@ok.com",
		];
		for (const sample of paritySamples) {
			expect(dumpTree(parseBoldMarkdown(sample))).toEqual(
				dumpTree(markdownLanguage.parser.parse(sample)),
			);
		}

		const linearWorkloads: ReadonlyArray<string> = [
			`word ${"www.".repeat(16_000)}x_y.z`,
			`word ${"www.".repeat(16_000)}a_b`,
			`word ${"www.".repeat(16_000)}a_b.c`,
			`word ${"a-www.".repeat(16_000)}a_b`,
			`word ${"a+".repeat(49)}@b.${"c.".repeat(16_000)}_`,
		];
		for (const doc of linearWorkloads) {
			const startedAt = performance.now();
			const edit = toggleSourceBoldSelection(doc, sel(0, 4, "none"));
			const elapsedMs = performance.now() - startedAt;
			expect(edit?.value.startsWith("**word** ")).toBe(true);
			expect(elapsedMs).toBeLessThan(1_000);
		}
	});

	it("fails closed to EOF on over-nested blocks at League max_nesting_level = 100 while keeping independent prefix prose editable", () => {
		// Lazy paragraph continuation lines after over-nested blockquotes and lists must not be corrupted.
		const lazyCases: ReadonlyArray<string> = [
			`${"> ".repeat(101)}[link](\n/destination)`,
			`${"- ".repeat(51)}[link](\n/destination)`,
			`${"1. ".repeat(51)}[link](\n/destination)`,
		];
		for (const doc of lazyCases) {
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "destination")),
			).toBeNull();
		}

		// Prose after an over-nested block fails closed to EOF, while independent prefix prose remains editable.
		const lazyWithNextPara = `${"> ".repeat(101)}[link](\n/destination)\n\nNext paragraph`;
		expect(
			toggleSourceBoldSelection(
				lazyWithNextPara,
				selectSubstring(lazyWithNextPara, "destination"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				lazyWithNextPara,
				selectSubstring(lazyWithNextPara, "Next paragraph"),
			),
		).toBeNull();

		const blankQuoteAfterOverflow = `${"> ".repeat(101)}[link](\n> \n/destination)`;
		expect(
			toggleSourceBoldSelection(
				blankQuoteAfterOverflow,
				selectSubstring(blankQuoteAfterOverflow, "destination"),
			),
		).toBeNull();

		const prefixBeforeOverflowCases: ReadonlyArray<string> = [
			`word\n\n${"> ".repeat(101)}[link](\n/destination)`,
			`word\n\n${"> ".repeat(100)}`,
		];
		for (const doc of prefixBeforeOverflowCases) {
			expect(toggleSourceBoldSelection(doc, sel(0, 4, "none"))?.value).toBe(
				`**word**${doc.slice(4)}`,
			);
		}

		// Controls at League max_nesting_level = 100 ceiling: 98 blockquotes / 49 nested lists
		// (`cx.depth === 99`, child Paragraph League depth === 99 < 100) still allow fenced code.
		const quote98Control = `[ref]\n\n${"> ".repeat(98)}\`\`\`\n${"> ".repeat(98)}[ref]: /u\n${"> ".repeat(98)}\`\`\``;
		expect(
			toggleSourceBoldSelection(quote98Control, selectSubstring(quote98Control, "ref"))?.value,
		).toBe(`[**ref**]${quote98Control.slice(5)}`);

		const quote98ParaFenceControl = `[ref]\n\n${"> ".repeat(98)}p\n${"> ".repeat(98)}\`\`\`\n${"> ".repeat(98)}\n${"> ".repeat(98)}[ref]: /u\n${"> ".repeat(98)}\`\`\``;
		expect(
			toggleSourceBoldSelection(
				quote98ParaFenceControl,
				selectSubstring(quote98ParaFenceControl, "ref"),
			)?.value,
		).toBe(`[**ref**]${quote98ParaFenceControl.slice(5)}`);

		const list49Control = `[ref]\n\n${"- ".repeat(49)}\`\`\`\n${"  ".repeat(49)}[ref]: /u\n${"  ".repeat(49)}\`\`\``;
		expect(
			toggleSourceBoldSelection(list49Control, selectSubstring(list49Control, "ref"))?.value,
		).toBe(`[**ref**]${list49Control.slice(5)}`);

		const list49ParaFenceControl = `[ref]\n\n${"- ".repeat(49)}p\n${"  ".repeat(49)}\`\`\`\n${"  ".repeat(49)}\n${"  ".repeat(49)}[ref]: /u\n${"  ".repeat(49)}\`\`\``;
		expect(
			toggleSourceBoldSelection(
				list49ParaFenceControl,
				selectSubstring(list49ParaFenceControl, "ref"),
			)?.value,
		).toBe(`[**ref**]${list49ParaFenceControl.slice(5)}`);

		// League refuses paragraph-interrupted block starts at League container depth 99
		// (`cx.depth === 100`: child Paragraph sits at depth 100 >= 100) and all block starts at >= 100.
		const leagueFalseFenceCases: ReadonlyArray<string> = [
			`[ref]\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}\`\`\`\n${"> ".repeat(99)}\n${"> ".repeat(99)}[ref]: /u\n${"> ".repeat(99)}\`\`\``,
			`[ref]\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}<!--\n${"> ".repeat(99)}\n${"> ".repeat(99)}[ref]: /u\n${"> ".repeat(99)}-->`,
			`[ref]\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}<pre>\n${"> ".repeat(99)}\n${"> ".repeat(99)}[ref]: /u\n${"> ".repeat(99)}</pre>`,
			`[ref]\n\n${"- ".repeat(49)}> p\n${"  ".repeat(49)}> \`\`\`\n${"  ".repeat(49)}> \n${"  ".repeat(49)}> [ref]: /u\n${"  ".repeat(49)}> \`\`\``,
			`[ref]\n\n${"> ".repeat(97)}- p\n${"> ".repeat(97)}  \`\`\`\n${"> ".repeat(97)}  \n${"> ".repeat(97)}  [ref]: /u\n${"> ".repeat(97)}  \`\`\``,
			`[ref]\n\n${"> ".repeat(100)}\`\`\`\n${"> ".repeat(100)}\n${"> ".repeat(100)}[ref]: /u\n${"> ".repeat(100)}\`\`\``,
			`[ref]\n\n${"> ".repeat(100)}\n${"> ".repeat(100)}\`\`\`\n${"> ".repeat(100)}\n${"> ".repeat(100)}[ref]: /u\n${"> ".repeat(100)}\`\`\``,
			`[ref]\n\n${"- ".repeat(50)}\`\`\`\n${"  ".repeat(50)}\n${"  ".repeat(50)}[ref]: /u\n${"  ".repeat(50)}\`\`\``,
		];
		for (const doc of leagueFalseFenceCases) {
			const tree = parseBoldMarkdown(doc);
			expect(getBoldMarkdownUnverifiableRanges(tree)).toEqual([
				{ from: 0, to: doc.length },
			]);
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "ref")),
			).toBeNull();
		}

		// Depth-99 (`cx.depth === 100`) paragraph-interrupted `~~~` math hazards (prefix and suffix)
		// fail closed globally because League refuses the `~~~` fence and leaks `$$` / `\[`.
		const depth99MathHazardCases: ReadonlyArray<string> = [
			`${"> ".repeat(99)}p\n${"> ".repeat(99)}~~~\n${"> ".repeat(99)}$$\n${"> ".repeat(99)}~~~\n\n$$\nx + y\n$$`,
			`$$\nx + y\n$$\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}~~~\n${"> ".repeat(99)}$$\n${"> ".repeat(99)}~~~`,
			`${"> ".repeat(99)}p\n${"> ".repeat(99)}~~~\n${"> ".repeat(99)}\\[\n${"> ".repeat(99)}~~~\n\n\\[\nx + y\n\\]`,
		];
		for (const doc of depth99MathHazardCases) {
			const tree = parseBoldMarkdown(doc);
			expect(getBoldMarkdownUnverifiableRanges(tree)).toEqual([
				{ from: 0, to: doc.length },
			]);
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "x + y")),
			).toBeNull();
		}

		// Depth-99 (`cx.depth === 100`) paragraph-interrupted ATXHeading, SetextHeading, and Table
		// fail closed inside the over-nested tail while keeping independent prefix prose editable.
		const depth99InterruptedBlockCases: ReadonlyArray<Readonly<[string, string]>> = [
			[`prefix\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}# heading`, "heading"],
			[`prefix\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}===`, "p"],
			[
				`prefix\n\n${"> ".repeat(99)}p\n${"> ".repeat(99)}| a | b |\n${"> ".repeat(99)}| --- | --- |\n${"> ".repeat(99)}| 1 | 2 |`,
				"a",
			],
		];
		for (const [doc, innerToken] of depth99InterruptedBlockCases) {
			expect(
				toggleSourceBoldSelection(doc, sel(0, 6, "none"))?.value,
			).toBe(`**prefix**${doc.slice(6)}`);
			const innerIdx = doc.lastIndexOf(innerToken);
			expect(
				toggleSourceBoldSelection(
					doc,
					sel(innerIdx, innerIdx + innerToken.length, "none"),
				),
			).toBeNull();
		}

		// Backward-reaching global hazards (`]:`, `$$`, `\[`, `\]`, `\(`, `\)`) after overflow fail closed globally,
		// including across blank lines, multiline HTML blocks, over-nested list continuations, and depth-0 list items.
		const globalRefHazardCases: ReadonlyArray<string> = [
			`[ref]\n\n${"> ".repeat(101)}[ref]: /u`,
			`[ref]\n\n${"- ".repeat(51)}[ref]: /u`,
			`[ref]\n\n${"> ".repeat(101)}# h\n${"> ".repeat(100)}[ref]: /u`,
			`[ref]\n\n${"> ".repeat(100)}> # h\n<!--\n\n[ref]: /u\n-->`,
			`[ref]\n\n${"> ".repeat(100)}> # h\n<pre>\n\n[ref]: /u\n</pre>`,
			`[ref]\n\n${"> ".repeat(100)}> # h\n<script>\n\n[ref]: /u\n</script>`,
			`[ref]\n\n${"- ".repeat(51)}a\n\n${" ".repeat(104)}[ref]: /u`,
			`[ref]\n\n${"- ".repeat(51)}<!--\n\n${" ".repeat(102)}[ref]: /u\n${" ".repeat(102)}-->`,
			`[ref]\n\n${"> ".repeat(101)}# h\n- a\n\n    [ref]: /u`,
		];
		for (const doc of globalRefHazardCases) {
			const tree = parseBoldMarkdown(doc);
			expect(getBoldMarkdownUnverifiableRanges(tree)).toEqual([
				{ from: 0, to: doc.length },
			]);
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "ref")),
			).toBeNull();
		}

		const globalMathHazardCases: ReadonlyArray<string> = [
			`${"> ".repeat(101)}\`\`\`\n${"> ".repeat(101)}$$\n${"> ".repeat(101)}\`\`\`\n\n$$\nx + y\n$$`,
			`${"- ".repeat(51)}\`\`\`\n${"- ".repeat(51)}$$\n${"- ".repeat(51)}\`\`\`\n\n$$\nx + y\n$$`,
			`${"> ".repeat(101)}~~~\n${"> ".repeat(101)}\\[\n${"> ".repeat(101)}~~~\n\n\\[\nx + y\n\\]`,
			`${"- ".repeat(51)}a\n\n${" ".repeat(104)}$$\n\nx + y\n\n$$`,
			`${"> ".repeat(101)}# h\n- a\n\n    $$\n\nx + y\n\n$$`,
		];
		for (const doc of globalMathHazardCases) {
			const tree = parseBoldMarkdown(doc);
			expect(getBoldMarkdownUnverifiableRanges(tree)).toEqual([
				{ from: 0, to: doc.length },
			]);
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "x + y")),
			).toBeNull();
		}

		// Swallowed multiline HTML blocks after overflow fail closed on inner text.
		const swallowedHtmlCases: ReadonlyArray<string> = [
			`${"- ".repeat(51)}<!--\n\n${" ".repeat(102)}hello\n${" ".repeat(102)}-->`,
			`${"> ".repeat(101)}# h\n<!--\n\nhello\n-->`,
			`${"> ".repeat(101)}# h\n<pre>\n\nhello\n</pre>`,
		];
		for (const doc of swallowedHtmlCases) {
			expect(
				toggleSourceBoldSelection(doc, selectSubstring(doc, "hello")),
			).toBeNull();
		}

		// Hazard-free 32,000-nested list still lets independent prefix prose edit linearly.
		const deepListDoc = `word\n\n${"- ".repeat(32_000)}a`;
		const startedAt = performance.now();
		const deepListEdit = toggleSourceBoldSelection(deepListDoc, sel(0, 4, "none"));
		const elapsedMs = performance.now() - startedAt;
		expect(deepListEdit?.value).toBe(`**word**\n\n${"- ".repeat(32_000)}a`);
		expect(elapsedMs).toBeLessThan(1_000);
	});

	it("matches upstream @lezer/markdown AST 1:1 across HTMLTag, HardBreak, and InlineCode edge cases", () => {
		const dumpTree = (tree: ReturnType<typeof parseBoldMarkdown>): string[] => {
			const nodes: string[] = [];
			tree.iterate({
				enter(node) {
					nodes.push(`${node.name}:${node.from}-${node.to}`);
				},
			});
			return nodes;
		};
		const samples: ReadonlyArray<string> = [
			"<https://example.com/a?b=1> <ab:c> <a:b> <ab:> <https://a<b<c> <HTTPS://EXAMPLE.COM/X>",
			"<user+tag.1@sub-1.example.com> <A@B> <a@-b.com> <a@b-.com> <a@b..c> <a@.b>",
			"<!--> <!---> <!----> <!-----> <!--a--> <!--a---> <!--a--b--> <!----a--> <!-- - --> <!-- <!--> <!--a\nb-->",
			"<?> <??> <?a?> <?php echo 1;\n?> <? unclosed",
			"<!DOCTYPE html> <!A> <!a> <!A\nb> <![CDATA[x]]> <![CDATA[]]> <![CDATA[a\nb]]> <![CDATA[unclosed",
			"</div> </ div > </div_1-2> </1a> < div> <a_1-2> <a b=c/> <a b=c/ > <a b=/> <a b='1' c=\"2\" d e=val /> <a b=\"1\"c=\"2\"> <a :x._-='1' _y=\"2\"> <a b=> <a b= '1'> <a\n b=\"c\nd\" / >",
			"line1\\\nline2  \nline3   \nline4 \nline5    text",
			"`a` ``a`b`` ```a`` ````a```` `unclosed ``unclosed `a` `b` `` `` ``` ```",
			"prefix `<tag>` <a title=\"`code`\">text</a>  \n*em* `a` <!-- c --> <?p?>",
		];
		for (const sample of samples) {
			expect(dumpTree(parseBoldMarkdown(sample))).toEqual(
				dumpTree(markdownLanguage.parser.parse(sample)),
			);
		}
	});

	it("scales linearly across pathological HTMLTag, HardBreak, and InlineCode inline inputs", () => {
		const workloads: ReadonlyArray<string> = [
			`word ${"<? ".repeat(16_000)}`,
			`word ${"<!-- ".repeat(16_000)}`,
			`word ${"<!-- ".repeat(16_000)}--a-->`,
			`word ${"<![CDATA[ ".repeat(8_000)}`,
			`word ${"<!A ".repeat(16_000)}`,
			`word ${"< ".repeat(16_000)}`,
			`word ${"<a b='".repeat(16_000)}>`,
			`word ${'<a b="'.repeat(16_000)}>`,
			`word ${"<https://a".repeat(8_000)}`,
			`word ${"<https://a".repeat(8_000)} >`,
			`word ${" ".repeat(32_000)}x`,
			`word ${Array.from({ length: 400 }, (_, i) => "`".repeat(i + 1)).join(" ")}`,
		];
		for (const doc of workloads) {
			const startedAt = performance.now();
			const edit = toggleSourceBoldSelection(doc, sel(0, 4, "none"));
			const elapsedMs = performance.now() - startedAt;
			expect(edit?.value.startsWith("**word** ")).toBe(true);
			expect(elapsedMs).toBeLessThan(1_000);
		}
	});

	it("enforces PHP MarkdownRenderer MAX_DELIMITERS_PER_LINE (1,000) before and after Bold edits", () => {
		const overUnbold = `${"*x* ".repeat(500)}**word**`;
		expect(
			toggleSourceBoldSelection(overUnbold, sel(2002, 2006, "none")),
		).toBeNull();

		const atLimitUnbold = `${"*x* ".repeat(499)}**word**`;
		expect(
			toggleSourceBoldSelection(atLimitUnbold, sel(1998, 2002, "none"))?.value,
		).toBe(`${"*x* ".repeat(499)}word`);

		const overWrap = `${"*x* ".repeat(500)}word`;
		expect(
			toggleSourceBoldSelection(overWrap, selectSubstring(overWrap, "word")),
		).toBeNull();

		const atLimitWrap = `${"*x* ".repeat(499)}word`;
		expect(
			toggleSourceBoldSelection(
				atLimitWrap,
				selectSubstring(atLimitWrap, "word"),
			)?.value,
		).toBe(`${"*x* ".repeat(499)}**word**`);

		const overPartialUnbold = `${"*x* ".repeat(500)}**one two**`;
		expect(
			toggleSourceBoldSelection(
				overPartialUnbold,
				selectSubstring(overPartialUnbold, "one"),
			),
		).toBeNull();

		const tildeCases: ReadonlyArray<string> = [
			`${"~x~ ".repeat(500)}**word**`,
			`p ${"~~~x~~~ ".repeat(500)}**word**`,
			`${"*_".repeat(500)} **word**`,
		];
		for (const doc of tildeCases) {
			const wordStart = doc.lastIndexOf("word");
			expect(
				toggleSourceBoldSelection(doc, sel(wordStart, wordStart + 4, "none")),
			).toBeNull();
		}

		const tightControl = `${"*_".repeat(499)} **word**`;
		const tightWordStart = tightControl.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(
				tightControl,
				sel(tightWordStart, tightWordStart + 4, "none"),
			)?.value,
		).toBe(`${"*_".repeat(499)} word`);

		// Delimiters inside link labels and image alt text DO consume the League stack budget.
		const linkLabelOver = `${"[*x*](/u) ".repeat(500)}**word**`;
		const imageAltOver = `${"![*x*](/u) ".repeat(500)}**word**`;
		expect(
			toggleSourceBoldSelection(
				linkLabelOver,
				sel(linkLabelOver.length - 6, linkLabelOver.length - 2, "none"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				imageAltOver,
				sel(imageAltOver.length - 6, imageAltOver.length - 2, "none"),
			),
		).toBeNull();

		// Delimiters inside inline code, link destinations, comments, and inline math do NOT push.
		const controlUnboldCases: ReadonlyArray<Readonly<[string, string]>> = [
			[`${"`*x*` ".repeat(600)}**word**`, `${"`*x*` ".repeat(600)}word`],
			[
				`${"[a](/u/*x*) ".repeat(600)}**word**`,
				`${"[a](/u/*x*) ".repeat(600)}word`,
			],
			[
				`p ${"<!-- *x* --> ".repeat(600)}**word**`,
				`p ${"<!-- *x* --> ".repeat(600)}word`,
			],
			[`${"$*x*$ ".repeat(600)}**word**`, `${"$*x*$ ".repeat(600)}word`],
		];
		for (const [doc, expected] of controlUnboldCases) {
			const wordStart = doc.lastIndexOf("word");
			expect(
				toggleSourceBoldSelection(doc, sel(wordStart, wordStart + 4, "none"))
					?.value,
			).toBe(expected);
		}

		// Fast-path plain wrap guard: 500 wrapped hard-break lines (= 1,000 delimiters)
		// succeed, while 501 wrapped hard-break lines (= 1,002 delimiters) fail closed.
		const lines500 = `${"word  \n".repeat(499)}word`;
		expect(toggleSourceBoldSelection(lines500, selectAll(lines500))?.value).toBe(
			`${"**word**  \n".repeat(499)}**word**`,
		);
		const lines501 = `${"word  \n".repeat(500)}word`;
		expect(toggleSourceBoldSelection(lines501, selectAll(lines501))).toBeNull();
	});

	it("bounds per-container plain-wrap fallback verifications to stay linear while preserving small-container fallback", () => {
		// Small container (<= 16 pieces): retains valid pieces when one piece fails verification.
		const smallMixed = "*italic*  \nword  \na.b";
		const smallEdit = toggleSourceBoldSelection(
			smallMixed,
			sel(0, smallMixed.length - 1, "none"),
		);
		expect(smallEdit?.value).toBe("***italic***  \n**word**  \na.b");

		// Large failing container (> 16 pieces): declines in O(1) verifications instead of O(K^2).
		const largeDoc = `*italic*  \n${"word  \n".repeat(400)}a.b`;
		const startedAt = performance.now();
		const largeEdit = toggleSourceBoldSelection(
			largeDoc,
			sel(0, largeDoc.length - 1, "none"),
		);
		const elapsedMs = performance.now() - startedAt;
		expect(largeEdit).toBeNull();
		expect(elapsedMs).toBeLessThan(1_000);
	});

	it("preserves HardBreak backslash in League delimiter budget for both wrap and unwrap", () => {
		const overUnwrap = `a${" *\\\n".repeat(1_000)}**word**`;
		const overUnwrapWord = overUnwrap.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(
				overUnwrap,
				sel(overUnwrapWord, overUnwrapWord + 4, "none"),
			),
		).toBeNull();

		const overWrap = `a${" *\\\n".repeat(1_000)}word`;
		const overWrapWord = overWrap.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(
				overWrap,
				sel(overWrapWord, overWrapWord + 4, "none"),
			),
		).toBeNull();

		const allowedUnwrap = `a${" *\\\n".repeat(998)}**word**`;
		const allowedUnwrapWord = allowedUnwrap.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(
				allowedUnwrap,
				sel(allowedUnwrapWord, allowedUnwrapWord + 4, "none"),
			)?.value,
		).toBe(`a${" *\\\n".repeat(998)}word`);

		const allowedWrap = `a${" *\\\n".repeat(998)}word`;
		const allowedWrapWord = allowedWrap.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(
				allowedWrap,
				sel(allowedWrapWord, allowedWrapWord + 4, "none"),
			)?.value,
		).toBe(`a${" *\\\n".repeat(998)}**word**`);
	});

	it("matches League 2.8.2 exact inline HTML, comment, backtick, and bare email opaque ranges for delimiter budget", () => {
		const prefix499 = "*x* ".repeat(499);
		const refusedCases: ReadonlyArray<Readonly<[string, string]>> = [
			[`${prefix499}< a title="*x*"> **word**`, "word"],
			[`${prefix499}< a title="*x*"> word`, "word"],
			[`${prefix499}<A title="*x*"> **word**`, "word"],
			[`${prefix499}<a TITLE="*x*"> **word**`, "word"],
			[`${prefix499}</ a *x*> **word**`, "word"],
			[`${prefix499}<a title="\`"> *x* \` **word**`, "word"],
			[`${prefix499}a_x_@example.com_ **word**`, "word"],
			[`${prefix499}\\_a_x_@example.com **word**`, "word"],
			[`${prefix499}<a title="*x*" / > **word**`, "word"],
			[`${prefix499}<a_b:*x*> **word**`, "word"],
			[`${prefix499}<${"a".repeat(33)}:*x*> **word**`, "word"],
			[`${prefix499}https://user_name@example.com_ **word**`, "word"],
			[`${prefix499}<a title="*x*" $y>$ **word**`, "word"],
			[`${prefix499}<!-- *x* $-->$ **word**`, "word"],
			[`${prefix499}<a $x$ title="*x*"> **word**`, "word"],
		];
		for (const [doc, target] of refusedCases) {
			const idx = doc.lastIndexOf(target);
			expect(
				toggleSourceBoldSelection(doc, sel(idx, idx + target.length, "none")),
			).toBeNull();
		}

		// Verify exact [2015, 2019) selection offsets on `< a title="*x*"> **word**`.
		const spaceAfterLtDoc = `${prefix499}< a title="*x*"> **word**`;
		expect(spaceAfterLtDoc.slice(2015, 2019)).toBe("word");
		expect(
			toggleSourceBoldSelection(spaceAfterLtDoc, sel(2015, 2019, "none")),
		).toBeNull();

		const allowedCases: ReadonlyArray<Readonly<[string, string, string]>> = [
			[
				`${prefix499}<!-- a -- *x* --> word`,
				"word",
				`${prefix499}<!-- a -- *x* --> **word**`,
			],
			[
				`${prefix499}<!-- a -- *x* --> **word**`,
				"word",
				`${prefix499}<!-- a -- *x* --> word`,
			],
			[
				`${prefix499}<a title="*x*"> **word**`,
				"word",
				`${prefix499}<a title="*x*"> word`,
			],
			[
				`${prefix499}<!doctype *x*> word`,
				"word",
				`${prefix499}<!doctype *x*> **word**`,
			],
			[
				`${prefix499}< a title="\`"> *x* \` **word**`,
				"word",
				`${prefix499}< a title="\`"> *x* \` word`,
			],
			[
				`${prefix499}a_x_@example.com **word**`,
				"word",
				`${prefix499}a_x_@example.com word`,
			],
			[
				`${prefix499}<a title="*x*" /> **word**`,
				"word",
				`${prefix499}<a title="*x*" /> word`,
			],
			[
				`${prefix499}<a\u00a0title="*x*"> **word**`,
				"word",
				`${prefix499}<a\u00a0title="*x*"> word`,
			],
			[
				`${prefix499}<ab:> **word**`,
				"word",
				`${prefix499}<ab:> word`,
			],
			[
				`${prefix499}<${"a".repeat(32)}:*x*> **word**`,
				"word",
				`${prefix499}<${"a".repeat(32)}:*x*> word`,
			],
			[
				`${prefix499}www.a_b@example.com **word**`,
				"word",
				`${prefix499}www.a_b@example.com word`,
			],
			[
				`${prefix499}< a title="$*x*$"> **word**`,
				"word",
				`${prefix499}< a title="$*x*$"> word`,
			],
			[
				`${prefix499}\`$*x*\`$ **word**`,
				"word",
				`${prefix499}\`$*x*\`$ word`,
			],
		];
		for (const [doc, target, expected] of allowedCases) {
			const idx = doc.lastIndexOf(target);
			expect(
				toggleSourceBoldSelection(doc, sel(idx, idx + target.length, "none"))
					?.value,
			).toBe(expected);
		}
	});

	it("verifies combined per-container enclosed and wrapped unbold in O(N) with a container-level fallback budget", () => {
		const hardBreak499 = Array(499).fill("**one  \ntwo**").join("  \n");
		fullUnboldVerifyCalls = 0;
		const hbStart = performance.now();
		const hbEdit = toggleSourceBoldSelection(
			hardBreak499,
			selectAll(hardBreak499),
		);
		const hbMs = performance.now() - hbStart;
		expect(hbEdit?.value).toBe(Array(499).fill("one  \ntwo").join("  \n"));
		expect(fullUnboldVerifyCalls).toBe(1);
		expect(hbMs).toBeLessThan(1_000);

		const spaces450 = "**a  \nb** ".repeat(450).trimEnd();
		fullUnboldVerifyCalls = 0;
		const spStart = performance.now();
		const spEdit = toggleSourceBoldSelection(spaces450, selectAll(spaces450));
		const spMs = performance.now() - spStart;
		expect(spEdit?.value).toBe("a  \nb ".repeat(450).trimEnd());
		expect(fullUnboldVerifyCalls).toBe(1);
		expect(spMs).toBeLessThan(1_000);

		const inlineCode499 = Array(499).fill("**a `c` b**").join(" ");
		const icStart = performance.now();
		const icEdit = toggleSourceBoldSelection(
			inlineCode499,
			selectAll(inlineCode499),
		);
		const icMs = performance.now() - icStart;
		expect(icEdit?.value).toBe(Array(499).fill("a `c` b").join(" "));
		expect(icMs).toBeLessThan(1_000);

		// Mixed wrapped + enclosed span needing `__ -> **` delimiter switch fallback in one container.
		const mixedUpgradeDoc = "__ab__ **cd**";
		const mixedFrom = mixedUpgradeDoc.indexOf("b");
		const mixedEdit = toggleSourceBoldSelection(
			mixedUpgradeDoc,
			sel(mixedFrom, mixedUpgradeDoc.length, "none"),
		);
		expect(mixedEdit?.value).toBe("**a**b cd");

		// Mixed wrapped + enclosed inside outer `*...*` emphasis needing fallback in one container.
		const mixedOuterEmphDoc = "*__ab__ **cd***";
		const mixedOuterFrom = mixedOuterEmphDoc.indexOf("b");
		const mixedOuterEdit = toggleSourceBoldSelection(
			mixedOuterEmphDoc,
			sel(mixedOuterFrom, mixedOuterEmphDoc.length - 1, "none"),
		);
		expect(mixedOuterEdit?.value).toBe("***a**b cd*");

		// Multi-span enclosed fallback inside shared outer `*...*` emphasis:
		// individual spans pass with `**` but collide when combined (`***a**b c**d***`),
		// requiring container-level outer `*...*` -> `_..._` upgrade.
		const multiSpanBothUnder = "*__ab__ __cd__*";
		expect(
			toggleSourceBoldSelection(
				multiSpanBothUnder,
				sel(4, 11, "none"),
			)?.value,
		).toBe("_**a**b c**d**_");

		const multiSpanMixed = "*__ab__ **cd***";
		expect(
			toggleSourceBoldSelection(
				multiSpanMixed,
				sel(4, 11, "none"),
			)?.value,
		).toBe("_**a**b c**d**_");

		// Adversarial multi-span fallback: deeply nested outer `*...*` emphases
		// around an enclosed `__ab__` span plus a wrapped `**alice**` before
		// `@example.com` (unbolding would synthesize a bare email autolink)
		// actively enters the fallback path and stays strictly bounded by the
		// shared container verification budget cap (1 primary + <= 16 fallbacks).
		const adversarialFallback = `${"*p ".repeat(20)}__ab__ **alice**@example.com${" q*".repeat(20)}`;
		const advFrom = adversarialFallback.indexOf("b__");
		const advTo = adversarialFallback.indexOf("@example.com");
		fullUnboldVerifyCalls = 0;
		const advStart = performance.now();
		const advEdit = toggleSourceBoldSelection(
			adversarialFallback,
			sel(advFrom, advTo, "none"),
		);
		const advMs = performance.now() - advStart;
		expect(advEdit).toBeNull();
		expect(fullUnboldVerifyCalls).toBeGreaterThan(1);
		expect(fullUnboldVerifyCalls).toBeLessThanOrEqual(17);
		expect(advMs).toBeLessThan(1_000);

		// Directly confirm the shared MAX_CONTAINER_FALLBACK_VERIFICATIONS = 16
		// budget hard-stops multi-span fallback across 30 enclosed spans.
		const manyParts = Array.from({ length: 30 }, () => "__ab__");
		const manyDoc = `${manyParts.join(" ")} ****x***y*`;
		const enclosedBySpan = new Map<
			import("./editor-context-menu-bold-segments").SourceStrongSpan,
			Array<Readonly<{ from: number; to: number }>>
		>();
		for (let i = 0; i < 30; i += 1) {
			const from = i * 7;
			enclosedBySpan.set(
				{
					closeMark: "__",
					containerFrom: 0,
					containerTo: manyDoc.length,
					from,
					innerFrom: from + 2,
					innerTo: from + 4,
					nestedInlineSpans: [],
					openMark: "__",
					outerEmphasisSpans: [],
					to: from + 6,
				},
				[{ from: from + 3, to: from + 4 }],
			);
		}
		const tailStart = manyDoc.indexOf("****x***y*");
		fullUnboldVerifyCalls = 0;
		const capped = planVerifiedContainerUnboldReplacements(
			manyDoc,
			{
				containerFrom: 0,
				containerTo: manyDoc.length,
				enclosedBySpan,
				wrappedEdits: [{ from: tailStart + 1, insert: "x", to: tailStart + 6 }],
				wrappedTargets: [{ from: tailStart + 4, to: tailStart + 5 }],
			},
			(from, to) => (from < to ? [{ from, to }] : []),
			[],
			{},
			16,
		);
		expect(capped).toBeNull();
		expect(fullUnboldVerifyCalls).toBeGreaterThanOrEqual(16);
		expect(fullUnboldVerifyCalls).toBeLessThanOrEqual(17);
	});

	it("preserves intraword emphasis/strong openersBottom parity, bare email autolink protection, and 4-stage League 2.8.2 parity", () => {
		// R19B #1: openersBottom >= bottomIndex intraword bold/unbold parity.
		expect(
			toggleSourceBoldSelection("foo**bar**baz", selectSubstring("foo**bar**baz", "bar"))
				?.value,
		).toBe("foobarbaz");
		expect(
			toggleSourceBoldSelection("foo**ab**baz", selectSubstring("foo**ab**baz", "a"))
				?.value,
		).toBe("fooa**b**baz");
		expect(
			toggleSourceBoldSelection(
				"*x**ab** **cd**y*",
				selectSubstring("*x**ab** **cd**y*", "b** **c"),
			)?.value,
		).toBe("*x**a**b c**d**y*");
		expect(
			toggleSourceBoldSelection(
				"*a**bc** **de***",
				selectSubstring("*a**bc** **de***", "c** **d"),
			)?.value,
		).toBe("*a**b**c d**e***");
		expect(
			toggleSourceBoldSelection("*a* xby", selectSubstring("*a* xby", "b"))
				?.value,
		).toBe("*a* x**b**y");
		expect(
			toggleSourceBoldSelection("[l](u) xby", selectSubstring("[l](u) xby", "b"))
				?.value,
		).toBe("[l](u) x**b**y");
		expect(
			toggleSourceBoldSelection("`c` xby", selectSubstring("`c` xby", "b"))
				?.value,
		).toBe("`c` x**b**y");

		// R19A #1: Bare email autolink semantic & selection protection.
		expect(
			toggleSourceBoldSelection(
				"Contact _alice@example.com.",
				selectSubstring("Contact _alice@example.com.", "alice"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				"Contact _**alice**@example.com.",
				selectSubstring("Contact _**alice**@example.com.", "alice"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				"Contact **foo**@example.com.",
				selectSubstring("Contact **foo**@example.com.", "foo"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				"Contact alice@example.com.",
				selectSubstring("Contact alice@example.com.", "alice@example.com"),
			)?.value,
		).toBe("Contact **alice@example.com**.");
		expect(
			toggleSourceBoldSelection(
				"Contact **alice@example.com**.",
				selectSubstring("Contact **alice@example.com**.", "alice@example.com"),
			)?.value,
		).toBe("Contact alice@example.com.");

		// R19A #2-#6 + R19B #2: Exact 4-stage League 2.8.2 & PHP 8.3 PCRE2 parity.
		const p499 = "*x* ".repeat(499);
		const blockedDocs = [
			`${p499}\\\`\`*x*\` y \` **word**`,
			`${p499}<a title="\`"> $*x*$ \` **word**`,
			`${p499}<a title="\`"> \\(*x*\\) \` **word**`,
			`${p499}$a[$](u/*y*) **word**`,
			`${p499}<!-- a -- [ -->](u/*y*) **word**`,
			`${p499}<!doctype [ >](u/*y*) **word**`,
			`${p499}<a\u0085b="[">](u/*y*) **word**`,
			`${p499}\\<a title="<b title='*x*'>"> **word**`,
			`a${" *\uFEFF".repeat(1000)} **word**`,
		];
		for (const doc of blockedDocs) {
			const idx = doc.lastIndexOf("word");
			expect(
				toggleSourceBoldSelection(doc, sel(idx, idx + 4, "none")),
			).toBeNull();
		}

		const allowedDocs = [
			`${p499}\` *x* ${"`".repeat(1001)} **word**`,
			`${p499}a_$x$ **word**`,
			`${p499}a_$x$_b **word**`,
			`${p499}a_\\(x\\)_b **word**`,
			`${p499}a_b_$x$@example.com **word**`,
			`${p499}https://example.com/$x$_a_b **word**`,
			`a${" *\u0085".repeat(1000)} **word**`,
			`a${" *\u180E".repeat(1000)} **word**`,
		];
		for (const doc of allowedDocs) {
			const idx = doc.lastIndexOf("word");
			const expected = `${doc.slice(0, idx - 2)}word`;
			expect(
				toggleSourceBoldSelection(doc, sel(idx, idx + 4, "none"))?.value,
			).toBe(expected);
		}
	});

	it("enforces Stage 4 Round 20 single-pass League 2.8.2 parity for math tokens, link tails, URL-vs-link order, case-sensitive HTML, and block math splits", () => {
		const p499 = "*x* ".repeat(499);
		const p499Strong = " **p**".repeat(499);

		// R20A #1: `<ab$x$:*y*>` expands to `<abEASYMDE_MATH_0_TOKEN:*y*>` in PHP (invalid URI scheme).
		const r20a1Doc = `Lead <ab$x$:*y*> target\nphrase${p499Strong}`;
		expect(
			toggleSourceBoldSelection(r20a1Doc, selectSubstring(r20a1Doc, "target\nphrase")),
		).toBeNull();

		// R20A #2: URL autolink swallows `]` inside `[a https://example.com/?q=x](u "*y*")`.
		const r20a2Doc = `Lead [a https://example.com/?q=x](u "*y*") target\nphrase${p499Strong}`;
		expect(
			toggleSourceBoldSelection(r20a2Doc, selectSubstring(r20a2Doc, "target\nphrase")),
		).toBeNull();

		// R20B #1.1: All 9 link-tail & full-reference cases where CloseBracket jumps past tail/ref.
		const r20b11Refused = [
			`${p499}[a](u "\`") *x* \` **word**`,
			`${p499}[a](\`u) *x* \` **word**`,
			`${p499}[a](u "<!--") *x* --> **word**`,
			`${p499}[a](u "<a title='") *x* '> **word**`,
			`${p499}[a](u "<?") *x* ?> **word**`,
			`${p499}[a](u "<![CDATA[") *x* ]]> **word**`,
			`${p499}[a](u "<!a") *x* > **word**`,
			`[\`]: /u\n\n${p499}[a][\`] *x* \` **word**`,
			`[<!--]: /u\n\n${p499}[a][<!--] *x* --> **word**`,
		];
		for (const doc of r20b11Refused) {
			const idx = doc.lastIndexOf("word");
			expect(
				toggleSourceBoldSelection(doc, sel(idx, idx + 4, "none")),
			).toBeNull();
		}

		// R20B #1.2: URL autolink consumes `[` in query before OpenBracket; 0 bogus resolvedLinkSpans.
		const r20b12Doc = `${p499}https://example.com/?a=[b x](u/*y*) **word**`;
		const r20b12Idx = r20b12Doc.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(r20b12Doc, sel(r20b12Idx, r20b12Idx + 4, "none")),
		).toBeNull();

		const urlWithBracketDoc = "https://example.com/?a=[b](u) word";
		const collectedUrlWithBracket = collectBoldableSegments(
			urlWithBracketDoc,
			selectAll(urlWithBracketDoc),
		);
		expect(collectedUrlWithBracket.resolvedLinkSpans).toEqual([]);
		expect(
			toggleSourceBoldSelection(
				urlWithBracketDoc,
				selectSubstring(urlWithBracketDoc, "word"),
			)?.value,
		).toBe("https://example.com/?a=[b](u) **word**");

		// R20B #1.3: Prefix-only URL pre-scan does not shadow the second URL after a link tail.
		const r20b13Doc = `${p499}[a](u '(https://a.com/x')(https://b.com/*x*a) **word**`;
		const r20b13Idx = r20b13Doc.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(r20b13Doc, sel(r20b13Idx, r20b13Idx + 4, "none"))
				?.value,
		).toBe(`${p499}[a](u '(https://a.com/x')(https://b.com/*x*a) word`);

		// R20B #1.4a: Case-sensitive League HTML rejects uppercase `<A title="**x"> ayb` bolding `y`.
		const r20b14aDoc = '<A title="**x"> ayb';
		expect(
			toggleSourceBoldSelection(r20b14aDoc, selectSubstring(r20b14aDoc, "y")),
		).toBeNull();

		// R20B #1.4b: Block math splits paragraph delimiter budgets & flanking (`a_$$x$$_b **word**`).
		const r20b14bDoc = `${p499}a_$$x$$_b **word**`;
		const r20b14bIdx = r20b14bDoc.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(r20b14bDoc, sel(r20b14bIdx, r20b14bIdx + 4, "none"))
				?.value,
		).toBe(`${p499}a_$$x$$_b word`);
	});

	it("enforces Stage 4 Round 21 single-pass token-space delimiter resolution, block-math reclassification, and TaskMarker predecessor parity", () => {
		// R21A #2 + R21B #1: Math-adjacent plain-wrap & token-space delimiter parity.
		// R22A #2: League token-space strong spans override math-blind Lezer, so
		// targets League does not see as strong wrap exactly as PHP 8.3 renders
		// (`Lead $x$__**word**__` -> `__<strong>word</strong>__`).
		expect(
			toggleSourceBoldSelection("word!$x$", selectSubstring("word!$x$", "word!")),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				"word!\\(x\\)",
				selectSubstring("word!\\(x\\)", "word!"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				"**word!**$x$",
				selectSubstring("**word!**$x$", "word!"),
			),
		).toBeNull();
		expect(
			toggleSourceBoldSelection(
				"Lead $a**b$ word**",
				selectSubstring("Lead $a**b$ word**", "word"),
			)?.value,
		).toBe("Lead $a**b$ **word****");
		expect(
			toggleSourceBoldSelection(
				"Lead $x$__word__",
				selectSubstring("Lead $x$__word__", "word"),
			)?.value,
		).toBe("Lead $x$__**word**__");
		expect(
			toggleSourceBoldSelection(
				"Lead __word__$x$",
				selectSubstring("Lead __word__$x$", "word"),
			)?.value,
		).toBe("Lead __**word**__$x$");
		expect(
			toggleSourceBoldSelection(
				"[a $x$__b__](https://e.com) word",
				selectSubstring("[a $x$__b__](https://e.com) word", "b"),
			)?.value,
		).toBe("[a $x$__**b**__](https://e.com) word");
		expect(
			toggleSourceBoldSelection(
				"[a $x**y$ b**](https://e.com) word",
				selectSubstring("[a $x**y$ b**](https://e.com) word", "b"),
			)?.value,
		).toBe("[a $x**y$ **b****](https://e.com) word");
		// Valid math-adjacent strong formatting still unbolds cleanly.
		expect(
			toggleSourceBoldSelection(
				"Lead $x$**word**",
				selectSubstring("Lead $x$**word**", "word"),
			)?.value,
		).toBe("Lead $x$word");

		// R21A #1: Block-math substitution block-boundary reclassification declines cleanly.
		const reclassifiedDocs = [
			"lead $$x$$    **word**",
			"lead $$x$$ \t**word**",
			"lead $$x$$ > **word**",
			"lead $$x$$ # **word**",
			"lead $$x$$ - **word**",
			"> lead $$x$$ **word**",
			"- lead $$x$$ **word**",
			"# lead $$x$$ **word**",
			"lead $$x$$ **word**\n---",
			"| lead $$x$$ **word** | b |\n| --- | --- |\n| c | d |",
		];
		for (const doc of reclassifiedDocs) {
			const idx = doc.lastIndexOf("word");
			expect(
				toggleSourceBoldSelection(doc, sel(idx, idx + 4, "none")),
			).toBeNull();
		}
		const plainThreeParaDoc = `${"*x* ".repeat(499)}a_$$x$$_b **word**`;
		const plainThreeParaIdx = plainThreeParaDoc.lastIndexOf("word");
		expect(
			toggleSourceBoldSelection(
				plainThreeParaDoc,
				sel(plainThreeParaIdx, plainThreeParaIdx + 4, "none"),
			)?.value,
		).toBe(`${"*x* ".repeat(499)}a_$$x$$_b word`);

		// R21A #3: TaskMarker preserves raw `]` predecessor context for URL autolinks and delimiters.
		const tmRefused499 = `- [x]https://example.com/?q=*z*x ${"**p** ".repeat(499)}word`;
		expect(
			toggleSourceBoldSelection(
				tmRefused499,
				selectSubstring(tmRefused499, "word"),
			),
		).toBeNull();

		const tmAllowed498 = `- [x]https://example.com/?q=*z*x ${"**p** ".repeat(498)}word`;
		expect(
			toggleSourceBoldSelection(
				tmAllowed498,
				selectSubstring(tmAllowed498, "word"),
			)?.value,
		).toBe(`- [x]https://example.com/?q=*z*x ${"**p** ".repeat(498)}**word**`);

		const tmSpaced499 = `- [x] https://example.com/?q=*z*x ${"**p** ".repeat(499)}word`;
		expect(
			toggleSourceBoldSelection(
				tmSpaced499,
				selectSubstring(tmSpaced499, "word"),
			)?.value,
		).toBe(`- [x] https://example.com/?q=*z*x ${"**p** ".repeat(499)}**word**`);

		expect(
			toggleSourceBoldSelection(
				"- [x]*word*",
				selectSubstring("- [x]*word*", "word"),
			)?.value,
		).toBe("- [x]***word***");
		expect(
			toggleSourceBoldSelection(
				"- [x]__word__",
				selectSubstring("- [x]__word__", "word"),
			)?.value,
		).toBe("- [x]word");
	});

	it("enforces Stage 4 Round 22 document-wide block-math fail-closed, authoritative container hosts, strong transitions, and stack-safe select-all", () => {
		const toggleWord = (doc: string, needle = "word", occurrence: "first" | "last" = "last"): string | null => {
			const idx = "first" === occurrence ? doc.indexOf(needle) : doc.lastIndexOf(needle);
			return toggleSourceBoldSelection(doc, sel(idx, idx + needle.length, "none"))?.value ?? null;
		};

		// R22A #1: non-standalone block-math substitution reclassifying blocks anywhere fails closed.
		expect(toggleWord("[word]\n\n$$x$$[word]: /url", "word", "first")).toBeNull();
		expect(toggleWord("[foo]\n\nlead $$x$$ [foo]: https://e.com", "foo", "first")).toBeNull();
		expect(toggleWord("$$x$$~~~\n# word\n~~~")).toBeNull();

		// R22A #1 + R22B #1: PHP raw-backtick scanning exposes block math Lezer hides in
		// `<a title="`">`; every non-paragraph host fails closed for wrap and unbold.
		const rawTick = '<a title="`"> ` $$x$$ ` ';
		for (const word of ["word", "**word**"]) {
			for (const doc of [
				`| ${rawTick}${word} | b |\n| --- | --- |\n| c | d |`,
				`${rawTick}${word}\n---`,
				`- ${rawTick}${word}`,
				`- a\n\n  ${rawTick}${word}`,
			]) {
				expect(toggleWord(doc)).toBeNull();
			}
		}
		// Plain paragraphs keep working (PHP: `<p>` `</p><div>$$x$$</div><p>` <strong>word</strong></p>`).
		expect(toggleWord(`${rawTick}word`)).toBe(`${rawTick}**word**`);
		expect(toggleWord(`${rawTick}**word**`)).toBe(`${rawTick}word`);
		expect(toggleWord("$$x$$\n\n**word**")).toBe("$$x$$\n\nword");

		// R22A #2: mapped League strong spans unbold across math-hidden `**`.
		const mathStrong = "**$x**y$ word**";
		expect(toggleWord(mathStrong)).toBe("**$x**y$** word");
		expect(toggleSourceBoldSelection(mathStrong, selectAll(mathStrong))?.value).toBe("$x**y$ word");
		// Strong transitions are mandatory: never nest `<strong>`, never unbold plain text.
		expect(verifyPlainWrapPlan("**word**", 0, 8, [{ from: 2, to: 6 }], "**", "**")).toBe(false);
		expect(
			verifyFullUnboldPlan("word", 0, 4, [{ from: 0, to: 4 }], [{ from: 0, insert: "word", to: 4 }]),
		).toBe(false);

		// R22A #3: document-scaled replacement arrays never overflow the call stack.
		const huge = Array(135_000).fill("x").join("\n\n");
		expect(huge.length).toBe(404_998);
		const startedAt = performance.now();
		const hugeEdit = toggleSourceBoldSelection(huge, selectAll(huge));
		const elapsedMs = performance.now() - startedAt;
		expect(hugeEdit?.value).toBe(Array(135_000).fill("**x**").join("\n\n"));
		expect(elapsedMs).toBeLessThan(30_000);
	});
});
