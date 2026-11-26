import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";

import {
	createSimpleBoldWrapEdit,
	planSourceBoldSelection,
} from "./editor-context-menu-bold";
import { collectBoldAstData } from "./editor-context-menu-bold-ast";
import type { EditorSelection } from "./editor-context-menu-rules";
import { parseBoldMarkdown } from "./editor-markdown-bold-parser";
import { DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE } from "./editor-markdown-link-primitives";
import { analyzeLeagueInlineBlock } from "./editor-markdown-league-inline";

/**
 * Stage 4 Round 23 PHP `extract_math()` parity. Every expectation below was
 * verified against live PHP 8.3.37 / League CommonMark 2.8.2
 * `MarkdownRenderer::render()`; `null` means the action fails closed.
 */
function toggleFirst(doc: string, needle = "word"): string | null {
	const start = doc.indexOf(needle);
	if (start < 0) throw new Error(`substring-not-found:${needle}`);
	const selection: EditorSelection = { direction: "none", end: start + needle.length, start };
	const plan = planSourceBoldSelection(doc, selection, {});
	if ("edit" === plan.kind) return plan.edit.value;
	if ("unavailable" === plan.kind) return null;
	return createSimpleBoldWrapEdit(doc, selection, {})?.value ?? null;
}

function toggleLast(doc: string, needle = "word"): string | null {
	const start = doc.lastIndexOf(needle);
	if (start < 0) throw new Error(`substring-not-found:${needle}`);
	const selection: EditorSelection = { direction: "none", end: start + needle.length, start };
	const plan = planSourceBoldSelection(doc, selection, {});
	if ("edit" === plan.kind) return plan.edit.value;
	if ("unavailable" === plan.kind) return null;
	return createSimpleBoldWrapEdit(doc, selection, {})?.value ?? null;
}

describe("editor-context-menu-bold PHP math parity (Stage 4 Round 23)", () => {
	it("grounds block-math gating in parsed leaf containers (R23B #1)", () => {
		// Block math starting inside HTML/comment blocks fails closed (PHP strips `**word**`).
		expect(toggleLast("<!--\n\n$$\nx\n-->\n$$\n\n**word**")).toBeNull();
		expect(toggleLast("<pre>\n\n$$\nx\n</pre>\n$$\n\n**word**")).toBeNull();
		// Multi-line block math breaking out of its starting paragraph fails closed
		// (PHP renders the indented line as `<pre><code>**bold**</code></pre>`).
		expect(toggleLast("$$\nx\n1.  item\n$$\n\n    **bold**", "bold")).toBeNull();
		expect(toggleLast("$$\nx\n\n- item\n$$\n\n    **word**")).toBeNull();
		// Reclassifying top-level paragraphs still fail closed after re-parse.
		expect(toggleLast("[word]\n\n$$x$$[word]: /url")).toBeNull();
		expect(toggleLast("$$x$$~~~\n# word\n~~~")).toBeNull();
		expect(toggleLast("lead $$x$$    **word**")).toBeNull();
		// Standalone and harmless top-level block math keep working.
		expect(toggleLast("$$\nx\n$$\n\n**word**")).toBe("$$\nx\n$$\n\nword");
		expect(toggleLast("$$\nx\n$$\r\n\r\n**word**")).toBe("$$\nx\n$$\r\n\r\nword");
		expect(toggleLast("> $$\n> x\n> $$\n\n**word**")).toBe("> $$\n> x\n> $$\n\nword");
		expect(toggleLast("para\n\n$$\nx = y\n$$\n\nmore **word**")).toBe(
			"para\n\n$$\nx = y\n$$\n\nmore word",
		);
		expect(toggleLast("a_$$x$$_b **word**")).toBe("a_$$x$$_b word");
	});

	it("fails closed on math containers straddled by document-wide raw backtick spans (R23A #1 + R23B #2)", () => {
		for (const doc of [
			"`\n\n**$x**y$ word**\n\n`",
			"`\n\n**lead $$x$$ word**\n\n`",
			"Para 1 `\n\nPara 2 $a**b$ word**\n\nPara 3 `",
			"Para 1 lone ` tick.\n\nPara 2 $a**b$ word** and ` tick.",
			"Para 1 `\n\n**$$x$$ word**\n\nPara 3 `",
			"`\n\n$x$ **word**\n\n`",
		]) {
			expect(toggleLast(doc)).toBeNull();
		}
		// Straddled containers without math syntax and non-straddled math containers keep working.
		expect(toggleLast("`\n\n**word**\n\n`")).toBe("`\n\nword\n\n`");
		expect(toggleLast("`code` and $x$\n\n**$x**y$ word**")).toBe(
			"`code` and $x$\n\n**$x**y$** word",
		);
	});

	it("rejects cross-leaf and document-reclassifying inline math (R23A #2)", () => {
		// `\(...\)` spanning a blank line is one PHP formula: never rewrite its TeX.
		expect(toggleLast("\\(a\n\n**word!** \\)", "word!")).toBeNull();
		expect(toggleLast("\\(a\n\nword \\)")).toBeNull();
		// `$...$` spanning a table cell pipe.
		expect(toggleLast("| $a | b$ word |\n| --- | --- |")).toBeNull();
		expect(toggleLast("| $a | **word** b$ |\n| --- | --- |")).toBeNull();
		// Inline math escaping a comment block into a paragraph.
		expect(toggleLast("<!--\n\\(a\n-->\n\\)\n\n**word**")).toBeNull();
		// Inline math inside a link reference definition.
		expect(toggleLast('[a]: /u "$x$"\n\n[a] **word**')).toBeNull();
		// Inline math confined to one leaf or to a non-leaf block keeps working
		// (PHP keeps `<!-- ... -->` a comment and renders `<p><strong>word</strong></p>`).
		expect(toggleLast("<!-- $a --> b$ -->\n\n**word**")).toBe("<!-- $a --> b$ -->\n\nword");
		expect(toggleLast("<!-- costs $5 to $10 -->\n\nHello **world**", "world")).toBe(
			"<!-- costs $5 to $10 -->\n\nHello world",
		);
		expect(toggleLast("<div>\n\\(x\\)\n</div>\n\n**word**")).toBe("<div>\n\\(x\\)\n</div>\n\nword");
		expect(toggleLast("\\(a\nb\\) **word**")).toBe("\\(a\nb\\) word");
		expect(toggleLast("\\(a\nb\\) word")).toBe("\\(a\nb\\) **word**");
		expect(toggleLast("> \\(a\n> b\\) **word**")).toBe("> \\(a\n> b\\) word");
		expect(toggleLast("| $a$ | **word** |\n| --- | --- |")).toBe("| $a$ | word |\n| --- | --- |");
	});

	it("carries League nested and outer emphasis spans through math-hidden strong overrides (R23B #3)", () => {
		expect(toggleLast("**$x**y$ a *b mid c* d**", "mid")).toBe(
			"**$x**y$ a** ***b** mid **c*** **d**",
		);
		expect(toggleLast("**$x**y$ a ~~b mid c~~ d**", "mid")).toBe(
			"**$x**y$ a** ~~**b** mid **c**~~ **d**",
		);
		expect(toggleLast("***$x**y$abc***", "b")).toBe("_**$x**y$a**b**c**_");
		// CRLF: projected League spans convert to original offsets in one place.
		expect(toggleLast("Intro\r\n**$x**y$ a *b\r\nmid c* d**", "mid")).toBe(
			"Intro\r\n**$x**y$ a** ***b**\r\nmid **c*** **d**",
		);
		expect(toggleLast("Intro\r\n**$x**y$ a ~~b\r\nmid c~~ d**", "mid")).toBe(
			"Intro\r\n**$x**y$ a** ~~**b**\r\nmid **c**~~ **d**",
		);
		expect(toggleLast("Intro\r\n\r\n***$x**y$a\r\nbc***", "b")).toBe(
			"Intro\r\n\r\n_**$x**y$a**\r\nb**c**_",
		);
	});

	it("exposes League emphasis and strikethrough delimiter bounds", () => {
		const analysis = analyzeLeagueInlineBlock("**$x**y$ a *b mid c* ~~d~~**");
		expect(analysis.strongSpans).toEqual([
			{ closeMark: "**", from: 0, innerFrom: 2, innerTo: 26, openMark: "**", to: 28 },
		]);
		expect(analysis.emphSpans).toEqual([{ from: 11, innerFrom: 12, innerTo: 19, to: 20 }]);
		expect(analysis.strikeSpans).toEqual([{ from: 21, innerFrom: 23, innerTo: 24, to: 26 }]);
		expect(analyzeLeagueInlineBlock("***abc***").emphSpans).toEqual([
			{ from: 0, innerFrom: 1, innerTo: 8, to: 9 },
		]);
	});
});

describe("editor-context-menu-bold unified math block-skeleton & League overrides (Stage 4 Round 24)", () => {
	it("rejects pre-edit in-leaf, nested, and combined math block reclassifications (R24B #1)", () => {
		// Paragraph / SetextHeading -> LinkReference
		expect(toggleLast('[ref]: /ok "$a"b$"\n\n[ref]', "ref")).toBeNull();
		expect(toggleFirst("[foo]: /$a b$\n\n[foo]", "foo")).toBeNull();
		expect(toggleLast("[word]: <\\(a\nb\\)>\n\n[word]")).toBeNull();
		expect(toggleLast("[foo]: /$a b$\n===\n\n[foo]", "foo")).toBeNull();
		expect(toggleLast("[foo]: /$a b$\n---\n\n[foo]", "foo")).toBeNull();

		// Paragraph -> GFM Table (top-level and nested in Blockquote)
		expect(toggleLast("| a | $x|y$ |\n| --- | --- |\n| foo | bar |", "foo")).toBeNull();
		expect(toggleLast("| a | \\(x\ny\\) |\n| --- | --- |\n| foo | bar |", "foo")).toBeNull();
		expect(toggleLast("> | a | $x|y$ |\n> | --- | --- |\n> | one | two |", "one | two")).toBeNull();

		// Paragraph -> FencedCode (top-level, Blockquote, BulletList)
		expect(toggleLast("``` $a`b$\n**word**")).toBeNull();
		expect(toggleLast("> ``` $a`b$\n> **word**")).toBeNull();
		expect(toggleLast("- ``` $a`b$\n  **word**")).toBeNull();

		// Paragraph -> Type-7 HTMLBlock (top-level and Blockquote)
		expect(toggleLast('<span a="$x"y$">\n**word**')).toBeNull();
		expect(toggleLast('<span a="$x"y$"/>\n**word**')).toBeNull();
		expect(toggleLast('> <span a="$x"y$">\n> **word**')).toBeNull();
		expect(toggleLast('> <span a="$x"y$"/>\n> **word**')).toBeNull();

		// Nested Blockquote / BulletList non-leaf inline math
		expect(toggleLast("> <!-- $a -->$\n> **word**")).toBeNull();
		expect(toggleLast("- <!-- $a -->$\n  **word**")).toBeNull();
		expect(toggleLast("> <script>$a</script>$\n> **word**")).toBeNull();
		expect(toggleLast("- <script>$a</script>$\n  **word**")).toBeNull();
		expect(toggleLast("> <? $a ?>$\n> **word**")).toBeNull();

		// Combined block + inline math pass
		expect(toggleFirst("[word]\n\nlead $$x$$[word]: /$a b$", "word")).toBeNull();
	});

	it("rejects post-edit inline-math block-opener exposures without false positives (R24B #2)", () => {
		// Unbolding exposes block openers hidden behind inline math
		expect(toggleFirst("**```** $a`b$\nword", "```")).toBeNull();
		expect(toggleFirst("**[foo]**: /$a b$\n\n[foo]", "[foo]")).toBeNull();
		expect(toggleFirst('**<span** a="$x"y$">\nword', "<span")).toBeNull();
		expect(toggleFirst("**|** a | $x|y$ |\n| --- | --- |\n| foo | bar |", "|")).toBeNull();
		expect(toggleFirst("**| a** | $x|y$ |\n| --- | --- |\n| foo | bar |", "| a")).toBeNull();
		expect(toggleFirst("> **```** $a`b$\n> word", "```")).toBeNull();
		expect(toggleFirst("- **```** $a`b$\n  word", "```")).toBeNull();

		// Safe non-reclassifying edits remain allowed (no false positives)
		expect(toggleLast("# > $a$ **word**")).toBe("# > $a$ word");
		expect(toggleLast("**$x**y$ word**")).toBe("**$x**y$** word");
		// PHP substitutes `$x$` -> `EASYMDE_MATH_0_TOKEN`, making `__word__`
		// intraword literal text, so toggling Bold wraps `word` with `**word**`.
		expect(toggleLast("Lead $x$__word__")).toBe("Lead $x$__**word**__");
		expect(toggleLast("<!-- costs $5 to $10 -->\n\n**word**")).toBe(
			"<!-- costs $5 to $10 -->\n\nword",
		);
		expect(toggleLast('<span a="$x$"/>\n\n**word**')).toBe('<span a="$x$"/>\n\nword');
		expect(toggleLast("> $$\n> x\n> $$\n\n**word**")).toBe("> $$\n> x\n> $$\n\nword");
		expect(toggleLast("a_$$x$$_b **word**")).toBe("a_$$x$$_b word");
	});

	it("mirrors PHP MarkdownCodeRegionScanner::block_ranges() precondition (R24A #1)", () => {
		// No backtick, tilde, or top-level 4-space/tab line: PHP extracts `$$x\n**word**$$`
		// as one block formula even though Lezer sees a quoted IndentedCode block.
		expect(toggleLast(">     $$x\n**word**$$")).toBeNull();
		expect(toggleLast(">     $$x\r\n**word**$$")).toBeNull();
	});

	it("overrides Lezer nested/outer emphasis frames whenever math tokens are present (R24A #2 + R24B #3)", () => {
		expect(toggleLast("**~~$x~~y$ word c~~**")).toBe("~~**$x~~y$** word **c**~~");
		expect(toggleLast("**a _b mid $c_ $ d_ e**", "mid")).toBe(
			"**a** _**b** mid **$c_ $ d**_ **e**",
		);
		expect(toggleLast("**a ~~b mid $c~~$ d~~ e**", "mid")).toBe(
			"**a** ~~**b** mid **$c~~$ d**~~ **e**",
		);
		expect(toggleLast("***abc**$a* $*", "b")).toBe("_**a**b**c**$a* $_");

		// CRLF parity for all four math-corrupted nested/outer emphasis overrides
		expect(toggleLast("Intro\r\n**~~$x~~y$\r\nword c~~**")).toBe(
			"Intro\r\n~~**$x~~y$**\r\nword **c**~~",
		);
		expect(toggleLast("Intro\r\n**a _b\r\nmid $c_ $ d_ e**", "mid")).toBe(
			"Intro\r\n**a** _**b**\r\nmid **$c_ $ d**_ **e**",
		);
		expect(toggleLast("Intro\r\n**a ~~b\r\nmid $c~~$ d~~ e**", "mid")).toBe(
			"Intro\r\n**a** ~~**b**\r\nmid **$c~~$ d**~~ **e**",
		);
		expect(toggleLast("Intro\r\n\r\n***a\r\nbc**$a* $*", "b")).toBe(
			"Intro\r\n\r\n_**a**\r\nb**c**$a* $_",
		);
	});

	it("scales linearly in leagueStrongOverride on large math paragraphs (R24A #3 + R24B #3)", () => {
		// Codex 202 KB repro
		const codexPrefix = `${"**x** ".repeat(350)}${"$$m$$ "}`.repeat(96);
		const codexDoc = `${codexPrefix}**$x**y$ word**`;
		const codexStart = performance.now();
		const codexOut = toggleLast(codexDoc);
		const codexMs = performance.now() - codexStart;
		expect(codexOut).toBe(`${codexPrefix}**$x**y$** word`);
		expect(codexMs).toBeLessThan(3000);

		// Gemini k=64 (12,800 strong spans) repro
		const geminiPrefix = `${"**x** ".repeat(200)}${"$$m$$ "}`.repeat(64);
		const geminiDoc = `${geminiPrefix}**$x**y$ word**`;
		const geminiStart = performance.now();
		const geminiOut = toggleLast(geminiDoc);
		const geminiMs = performance.now() - geminiStart;
		expect(geminiOut).toBe(`${geminiPrefix}**$x**y$** word`);
		expect(geminiMs).toBeLessThan(1500);
	});
});

describe("editor-context-menu-bold Stage 4 Round 25 parity (PHP 8.3.37 / League 2.8.2)", () => {
	it("rejects beforeTree vs afterTree block-skeleton and task-checkbox reclassifications (R25B #1)", () => {
		const rejected: ReadonlyArray<readonly [string, string, "first" | "last"]> = [
			['**<span** a="$x$"/>\nword', "<span", "first"],
			['**<span** a="$x$"/>\r\nword', "<span", "first"],
			["**<span**/>\nword", "<span", "first"],
			["**<span**/>\r\nword", "<span", "first"],
			["**<span**>\nword", "<span", "first"],
			["**</span**>\nword", "</span", "first"],
			["**<div>**\nword", "<div>", "first"],
			["**<!--**\nword", "<!--", "first"],
			["**<?**\nword", "<?", "first"],
			["> **<span**/>\n> word", "<span", "first"],
			["- **<span**/>\n  word", "<span", "first"],
			["**[a]**: /u", "[a]", "first"],
			["[a] **word**\n\n**[a]**: /u", "[a]", "last"],
			["**---**", "---", "first"],
			["**|** a | b |\n| --- | --- |", "|", "first"],
			["| a | b |\n| **---** | --- |", "---", "first"],
			["- **[x]** word", "[x]", "first"],
			["- **[X]** word", "[X]", "first"],
			["- **[ ]** word", "[ ]", "first"],
			["1. **[x]** word", "[x]", "first"],
			["> - **[x]** word", "[x]", "first"],
			["- a\n\n  **[x]** word", "[x]", "first"],
			["- **[x]**\r\nword", "[x]", "first"],
		];
		for (const [doc, needle, which] of rejected) {
			const selector = "first" === which ? toggleFirst : toggleLast;
			expect(selector(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}
		// Existing valid task item and heading edits remain allowed.
		expect(toggleLast("- [x] **word**")).toBe("- [x] word");
		expect(toggleLast("# **word**")).toBe("# word");
		expect(toggleLast("- **[x]**", "[x]")).toBe("- [x]");
	});

	it("enforces PHP math-span and raw math-delimiter count invariance (R25B #2)", () => {
		const rejected: ReadonlyArray<readonly [string, string]> = [
			["a \\\\**$x$**", "$x$"],
			["a \\\\**$x$** b $y$", "$x$"],
			["a \\\\$x$", "$x$"],
			["| a \\\\**$x$** | $y$ |\n| --- | --- |", "$x$"],
			["| a \\\\$5 | $10 |\n| --- | --- |", "$5"],
			["**a\\\\**[**b**\n\n**word**\\]", "a\\\\"],
			["**a\\\\**(**b**\n\n**word**\\)", "a\\\\"],
			["**a\\$**$x\n\n**word**$$", "a\\$"],
			["$$x\n\n**a\\$**$y", "a\\$"],
			["\\[x\n\n**a\\\\**]y", "a\\\\"],
			["\\(x\n\n**a\\\\**)y", "a\\\\"],
			["**a$**$$x\n\n**word**$$", "a$"],
			["**a\\\\**[**b**\r\n\r\n**word**\\]", "a\\\\"],
			["| a \\\\$5 | $10 |\r\n| --- | --- |", "$5"],
		];
		for (const [doc, needle] of rejected) {
			expect(toggleFirst(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}
		// Zero false positives on ordinary dollar / math edits.
		expect(toggleLast("costs $5", "$5")).toBe("costs **$5**");
		expect(toggleLast("**$x**y$ word**")).toBe("**$x**y$** word");
		expect(toggleLast("Lead $x$__word__")).toBe("Lead $x$__**word**__");
	});

	it("handles self-closing Type-7 tags (including pre/script/style/textarea) and Type-1 textarea blocks (R25B #3)", () => {
		const rejected: ReadonlyArray<readonly [string, string]> = [
			["<pre/>\n**word**", "word"],
			["<script/>\n**word**", "word"],
			["<style/>\n**word**", "word"],
			["<textarea/>\n**word**", "word"],
			["> <pre/>\n> **word**", "word"],
			["**<pre**/>\nword", "<pre"],
			["**<script**/>\nword", "<script"],
			["**<style**/>\nword", "<style"],
			["**<textarea**/>\nword", "<textarea"],
			['<pre a="1"/>\n\n**word**', "word"],
			['<textarea a="$x"y$"/>\n**word**', "word"],
			["a $$x$$\n<textarea>foo\n**word**", "word"],
			["<textarea>\n\n**word**", "word"],
			["<TEXTAREA>\n\n**word**", "word"],
			["<textarea>foo\n**word**", "word"],
			["para\n<textarea>foo\n**word**", "word"],
			["<textarea>$a</textarea>$\n\n**word**", "word"],
			["<pre/>\r\n**word**", "word"],
			["para\r\n<textarea>foo\r\n**word**", "word"],
		];
		for (const [doc, needle] of rejected) {
			expect(toggleFirst(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}
		// Closed Type-1 textarea and blank-line-separated Type-7 self-closing tags keep working.
		expect(toggleLast("<textarea>x</textarea>\n**word**")).toBe("<textarea>x</textarea>\nword");
		expect(toggleLast("<textarea>\nx\n</textarea>\n**word**")).toBe("<textarea>\nx\n</textarea>\nword");
		expect(toggleLast("<pre/>\n\n**word**")).toBe("<pre/>\n\nword");
		expect(toggleLast("<textarea/>\n\n**word**")).toBe("<textarea/>\n\nword");
	});

	it("fails closed on CommonMark §5.2 empty list item + blank line + indented code (R25A #1)", () => {
		for (const doc of [
			"-\n\n    **word** $x$",
			"-\r\n\r\n    **word** $x$",
			"1.\n\n    **word** $x$",
			"*\n\n    **word** $x$",
			"+\n\n    **word** $x$",
			"-   \n  \n    **word** $x$",
			"- a\n-\n\n    **word** $x$",
			"> -\n> \n>     **word** $x$",
			"> -\r\n> \r\n>     **word** $x$",
			"-\n\n\t**word** $x$",
			"-\n\n  \t**word** $x$",
			"  -\n\n    **word**",
			"- -\n\n      **word**",
		]) {
			expect(toggleLast(doc), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}
		// Non-code variants remain editable paragraphs matching PHP.
		expect(toggleLast("-\n\n  **word**")).toBe("-\n\n  word");
		expect(toggleLast("-\n    **word**")).toBe("-\n    word");
		expect(toggleLast("- -\n\n    **word**")).toBe("- -\n\n    word");
	});

	it("matches League 2.8.2 ReferenceParser same-line consecutive reference definitions (R25A #2)", () => {
		for (const doc of [
			"[a]\n\n[b]: /b [a]: **word**$$x$$",
			"[a]\r\n\r\n[b]: /b [a]: **word**$$x$$",
			"[a]\n\n[b]: /b [a]: **word**",
			"[a]\r\n\r\n[b]: /b [a]: **word**",
			"[a] [b] [c]\n\n[a]: /a [b]: /b [c]: **word**",
			"[a] [b]\n\n[b]: /b\n[a]: /a [c]: **word**",
		]) {
			expect(toggleLast(doc), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}
		// Failed title and non-ref trailing text stay editable Paragraphs matching PHP.
		expect(toggleLast('[a]\n\n[b]: /b "t" [a]: **word**')).toBe('[a]\n\n[b]: /b "t" [a]: word');
		expect(toggleLast("[a]\n\n[b]: /b foo **word**")).toBe("[a]\n\n[b]: /b foo word");
		// `[b]` is discarded while `[a]` is defined; following paragraph unbolds cleanly.
		const bothDoc = "[b] [a]\n\n[b]: /b [a]: /a\n**word**";
		expect(toggleLast(bothDoc)).toBe("[b] [a]\n\n[b]: /b [a]: /a\nword");
		// `[b]` is plain text (not a link), whereas `[a]` is a shorthand link preserved with `[a]`.
		expect(toggleFirst(bothDoc, "b")).toBe("[**b**] [a]\n\n[b]: /b [a]: /a\n**word**");
		expect(toggleFirst(bothDoc, "a")).toBe("[b] [**a**][a]\n\n[b]: /b [a]: /a\n**word**");
	});
});

describe("editor-context-menu-bold Stage 4 Round 26 root parity (PHP 8.3.37 / League 2.8.2)", () => {
	it("terminates empty ListItems on blank lines and mirrors League 2.8.2 single-char-remainder padding (R26B #1 + R26A #2)", () => {
		const rejected: ReadonlyArray<readonly [string, string]> = [
			["-\n\n    **word** $x$", "word"],
			["-\r\n\r\n    **word** $x$", "word"],
			["-  -\n\n      **word** $x$", "word"],
			["-  -\r\n\r\n      **word** $x$", "word"],
			["-  a\n\n      **word**", "word"],
			["-  a\r\n\r\n      **word**", "word"],
			["1.   x\n\n       **word**", "word"],
			["-\n\n  para\n\n    **word** $x$", "word"],
			["-\n\n  [a]: /u\n\n    word", "word"],
			["   >  - a\n   >\n   >    *\n   >\n>        word", "word"],
			["> -\n>\n>     $$\n\nhello **word** $$", "word"],
			["-  😀\n\n      **word**", "word"],
			["-\ta\n\n      **word**", "word"],
			["- \ta\n\n      **word**", "word"],
			["-\n  -\n\n      code", "code"],
		];
		for (const [doc, needle] of rejected) {
			expect(toggleLast(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}

		// Multi-char remainders, trailing space, non-task paragraphs, and controls stay editable.
		expect(toggleLast("-  ab\n\n      **word**")).toBe("-  ab\n\n      word");
		expect(toggleLast("-  a \n\n      **word**")).toBe("-  a \n\n      word");
		expect(toggleLast("-\n\n  [x] word", "[x] word")).toBe("-\n\n  **[x] word**");
		expect(toggleLast("-\n  a\n\n  b", "b")).toBe("-\n  a\n\n  **b**");
		expect(toggleLast("> -\n> a\n>\n> b", "b")).toBe("> -\n> a\n>\n> **b**");
		expect(toggleLast("-\n  -\n\n    code", "code")).toBe("-\n  -\n\n    **code**");
		expect(toggleLast("-  -\n    **word**")).toBe("-  -\n    word");
		expect(toggleLast("-  -\n     **word**")).toBe("-  -\n     word");

		// Shared `markdownLanguage.parser` must remain unmutated.
		const sharedTree = markdownLanguage.parser.parse("-\n\n    code");
		expect(sharedTree.topNode.lastChild?.name).toBe("BulletList");
	});

	it("uses unified League Types 1-7 HTMLBlock rules with PHP PCRE2 ASCII whitespace (R26B #2 + R26A #4)", () => {
		const rejected: ReadonlyArray<readonly [string, string, "first" | "last"]> = [
			['**<foo xml:lang="en">**\nword', '<foo xml:lang="en">', "first"],
			['**<foo xml:lang="en">**\n===', '<foo xml:lang="en">', "first"],
			['**<foo xml:lang="en">**\r\n===', '<foo xml:lang="en">', "first"],
			["<!doctype html\n**word**\n>", "word", "last"],
			["<![cdata[\nword\n]]>", "word", "last"],
			["para\n<textarea\f>\n**word**", "word", "last"],
			["para\n<textarea\v>\n**word**", "word", "last"],
			["<img a=x\f/>\n**word**", "word", "last"],
			["<img a=x\v/>\n**word**", "word", "last"],
			["<pre/>\n**word**", "word", "last"],
			["<textarea/>\n**word**", "word", "last"],
			["**<pre**/>\nword", "<pre", "first"],
			["**<textarea**/>\nword", "<textarea", "first"],
			["para\n<source>\n**word**", "word", "last"],
			["> <!doctype html\n> **word**\n> >", "word", "last"],
		];
		for (const [doc, needle, which] of rejected) {
			const selector = "first" === which ? toggleFirst : toggleLast;
			expect(selector(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}

		// Type-1 cross-tag closing (`</textarea>` closes `<pre>`/`<script>`/`<style>`),
		// underscore non-HTML tags, `<search>`, and NBSP non-ASCII whitespace.
		expect(
			toggleLast("<pre>\n</textarea>\n[ref]: https://example.com\n</pre>\n\n[ref]", "ref"),
		).toBe("<pre>\n</textarea>\n[ref]: https://example.com\n</pre>\n\n[**ref**][ref]");
		expect(toggleLast("<pre>\n</textarea>\n**word**")).toBe("<pre>\n</textarea>\nword");
		expect(toggleLast("<script>\n</textarea>\n**word**")).toBe("<script>\n</textarea>\nword");
		expect(toggleLast("<style>\n</textarea>\n**word**")).toBe("<style>\n</textarea>\nword");
		expect(toggleLast("<foo_bar>\n**word**")).toBe("<foo_bar>\nword");
		expect(toggleLast("</foo_bar>\n**word**")).toBe("</foo_bar>\nword");
		expect(toggleLast("para\n<search>\n**word**")).toBe("para\n<search>\nword");
		expect(toggleLast("para\n<script\u00a0>\n**word**")).toBe("para\n<script\u00a0>\nword");
	});

	it("preserves enclosing ListItem/Blockquote indentation context during slice verification (R26A #1)", () => {
		const rejected: ReadonlyArray<readonly [string, string]> = [
			["- a\n    **~~~**\n    next", "~~~"],
			["- a\r\n    **~~~**\r\n    next", "~~~"],
			["- a\n    **```**\n    next", "```"],
			["- a\n\n  b\n    **~~~**\n    next", "~~~"],
			["- a\r\n\r\n  b\r\n    **~~~**\r\n    next", "~~~"],
			["- a\n    **#** b", "#"],
			["- a\n    **>** b", ">"],
			["- a\n    **-** b", "-"],
			["- a\n    **---**", "---"],
			["> - a\n>     **~~~**\n>     next", "~~~"],
			["> - a\n>\n>   b\n>     **~~~**\n>     next", "~~~"],
			["- a\n  - b\n\n    c\n      **~~~**\n      next", "~~~"],
		];
		for (const [doc, needle] of rejected) {
			expect(toggleLast(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}

		// Positive controls inside indented list continuations keep working.
		expect(toggleLast("- a\n    **word**\n    next")).toBe("- a\n    word\n    next");
		expect(toggleLast("- a\n\n  b\n    **word**\n    next")).toBe("- a\n\n  b\n    word\n    next");
	});

	it("enforces inline HTML token invariance during slice verification (R26A #3)", () => {
		const rejected: ReadonlyArray<readonly [string, string]> = [
			["x <**word**>", "word"],
			["x <**word**>\r\nnext", "word"],
			["x <**a** href=1>", "a"],
			["x </**span**>", "span"],
			["x <**!--** comment -->", "!--"],
		];
		for (const [doc, needle] of rejected) {
			expect(toggleFirst(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}

		// Existing inline HTML outside the edited strong span stays editable.
		expect(toggleLast("<span>x</span> **word**")).toBe("<span>x</span> word");
	});
});

function crlf(doc: string): string {
	return doc.replace(/\n/g, "\r\n");
}

describe("editor-context-menu-bold Stage 4 Round 27 parity (PHP 8.3.37 / League 2.8.2)", () => {
	it("rejects list-opener edits that change League effective padding, including the plain-wrap fast path (R27A #1)", () => {
		const rejected: ReadonlyArray<readonly [string, string]> = [
			["-  **a**\n\n      word", "a"],
			["-  a\n\n      word", "a"],
			["-  a\n  ===", "a"],
			["1.   **x**\n\n       word", "x"],
			["1.   x\n\n       word", "x"],
			["> -  **a**\n> \n>       word", "a"],
			["> -  a\n> \n>       word", "a"],
			["- -  a\n\n        word", "a"],
			["- -  **a**\n\n        word", "a"],
			["-\ta\n\n      word", "a"],
			["-\t**a**\n\n      word", "a"],
		];
		for (const [lfDoc, needle] of rejected) {
			for (const doc of [lfDoc, crlf(lfDoc)]) {
				expect(toggleFirst(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
			}
		}

		// Single-line openers, 1-space markers, and multi-char remainders keep working.
		for (const [doc, needle, expected] of [
			["-  a", "a", "-  **a**"],
			["-  **a**", "a", "-  a"],
			["- a\n\n  word", "a", "- **a**\n\n  word"],
			["- **a**\n\n  word", "a", "- a\n\n  word"],
			["- a\r\n\r\n  word", "a", "- **a**\r\n\r\n  word"],
			["-  ab\n\n      word", "ab", "-  **ab**\n\n      word"],
			["-  **ab**\n\n      word", "ab", "-  ab\n\n      word"],
		] as const) {
			expect(toggleFirst(doc, needle), JSON.stringify(doc)).toBe(expected);
		}
	});

	it("emits enclosing list openers on separate lines and honours tab-straddled parent columns (R27B #1)", () => {
		const nestedPrefixes = [
			"-  ab\n\n   1234. c\n\n         d\n           ",
			"1. ab\n\n   1234. c\n\n         d\n           ",
			"-  ab\n\n     12. c\n\n         d\n           ",
		];
		const blockStarts = ["~~~", "# h", "> q", "---", "<div>"];
		for (const prefix of nestedPrefixes) {
			for (const marker of blockStarts) {
				const tail = "~~~" === marker ? "\n           next" : "";
				const lfDoc = `${prefix}**${marker}**${tail}`;
				for (const doc of [lfDoc, crlf(lfDoc)]) {
					expect(toggleLast(doc, marker), `expected null for ${JSON.stringify(doc)}`).toBeNull();
				}
			}
		}
		for (const lfDoc of [
			"-    1234. c\n\n           d\n             **~~~**\n             next",
			"-\t-\n      b\n        **~~~**\n        next",
			"1.\t-\n       b\n         **~~~**\n         next",
			"-\t-\n      b\n        **# h**",
			"-\t-\n      b\n        **> q**",
		]) {
			const marker = lfDoc.includes("~~~") ? "~~~" : lfDoc.includes("# h") ? "# h" : "> q";
			for (const doc of [lfDoc, crlf(lfDoc)]) {
				expect(toggleLast(doc, marker), `expected null for ${JSON.stringify(doc)}`).toBeNull();
			}
		}

		// Ordinary prose in the same deep contexts stays editable.
		expect(toggleLast("-  ab\n\n   1234. c\n\n         d\n           **word**\n           next")).toBe(
			"-  ab\n\n   1234. c\n\n         d\n           word\n           next",
		);
		expect(toggleLast("-\t-\n      b\n        **word**\n        next")).toBe(
			"-\t-\n      b\n        word\n        next",
		);
		expect(toggleLast("-\t-\r\n      b\r\n        **word**\r\n        next")).toBe(
			"-\t-\r\n      b\r\n        word\r\n        next",
		);
	});

	it("never lets same-container nested list markers interrupt a paragraph (R27B #2a)", () => {
		for (const lfDoc of [
			"1. ab\n   2. c\n\n       **word**",
			"1. ab\n   2) c\n\n       **word**",
			"1. ab\n   2. c\n\n       **word** $x$",
			"+ a\n  +\n\n      **word**",
		]) {
			for (const doc of [lfDoc, crlf(lfDoc)]) {
				expect(toggleLast(doc), `expected null for ${JSON.stringify(doc)}`).toBeNull();
			}
		}
		// Enclosing containers that close still start a new list (League parity).
		expect(toggleLast("1. ab\n2. c\n\n   **word**")).toBe("1. ab\n2. c\n\n   word");
		expect(toggleLast("> para\n2. c\n\n   **word**")).toBe("> para\n2. c\n\n   word");
		expect(toggleLast("1. ab\n   1. c\n\n      **word**")).toBe("1. ab\n   1. c\n\n      word");
		expect(toggleLast("- a\n  - b\n\n    **word**")).toBe("- a\n  - b\n\n    word");
	});

	it("hides PHP-stripped inline HTML so bare tag selections decline cleanly (R27B #3)", () => {
		for (const [doc, needle] of [
			['x <span title="foo"> y', '<span title="foo">'],
			['x <span title="foo"> y\r\nnext', '<span title="foo">'],
			["x <!-- foo --> y", "<!-- foo -->"],
			['x **<span title="foo">** y', '<span title="foo">'],
			["x **<!-- foo -->** y", "<!-- foo -->"],
		] as const) {
			expect(toggleFirst(doc, needle), `expected null for ${JSON.stringify(doc)}`).toBeNull();
		}
		// Visible prose adjacent to or spanning inline HTML keeps working.
		expect(toggleLast("<span>x</span> **word**")).toBe("<span>x</span> word");
		expect(toggleFirst("a <span>b</span> c", "a <span>b</span> c")).toBe("**a <span>b</span> c**");
		expect(toggleFirst("**a <span>b</span> c**", "a <span>b</span> c")).toBe("a <span>b</span> c");
		expect(toggleFirst("a <span>b</span> c\r\nnext", "a <span>b</span> c")).toBe(
			"**a <span>b</span> c**\r\nnext",
		);
		const analysis = analyzeLeagueInlineBlock('x <span title="foo"> y <!-- c -->');
		expect(analysis.htmlInlineRanges).toEqual([
			{ from: 2, to: 20 },
			{ from: 23, to: 33 },
		]);
	});
});

function expectToggles(
	cases: ReadonlyArray<readonly [doc: string, needle: string, expected: string | null]>,
	pick: "first" | "last",
): void {
	for (const [lfDoc, lfNeedle, lfExpected] of cases) {
		for (const toCrlf of [false, true]) {
			const doc = toCrlf ? crlf(lfDoc) : lfDoc;
			const needle = toCrlf ? crlf(lfNeedle) : lfNeedle;
			const expected = null === lfExpected || !toCrlf ? lfExpected : crlf(lfExpected);
			const actual = "first" === pick ? toggleFirst(doc, needle) : toggleLast(doc, needle);
			expect(actual, JSON.stringify(doc)).toBe(expected);
		}
	}
}

describe("editor-context-menu-bold Stage 4 Round 28 parity (PHP 8.3.37 / League 2.8.2)", () => {
	it("keeps ordinary multi-line list Bold/Unbold starting on the opener line (R28B #1)", () => {
		expectToggles(
			[
				["- hello\n  world", "hello\n  world", "- **hello\n  world**"],
				["- **hello\n  world**", "hello\n  world", "- hello\n  world"],
				["1. hello\n   world", "hello\n   world", "1. **hello\n   world**"],
				["1. **hello\n   world**", "hello\n   world", "1. hello\n   world"],
				["- [ ] hello\n  world", "hello\n  world", "- [ ] **hello\n  world**"],
				["- [ ] **hello\n  world**", "hello\n  world", "- [ ] hello\n  world"],
				["- > hello\n  > world", "hello\n  > world", "- > **hello\n  > world**"],
				["- > **hello\n  > world**", "hello\n  > world", "- > hello\n  > world"],
				["- hello\n  world\n  ===", "hello\n  world", "- **hello\n  world**\n  ==="],
				["- **hello\n  world**\n  ===", "hello\n  world", "- hello\n  world\n  ==="],
				["-  ab\n   cd\n\n   ef", "ab\n   cd", "-  **ab\n   cd**\n\n   ef"],
				["-  **ab\n   cd**\n\n   ef", "ab\n   cd", "-  ab\n   cd\n\n   ef"],
				// Multi-line edits that move line 1 across the padding threshold still fail closed.
				["-  **a\n   cd**\n\n  ef", "a\n   cd", null],
				["-  a\n   cd\n\n  ef", "a\n   cd", null],
				["-  a\n  cd\n\n  ef", "a\n  cd", null],
			],
			"first",
		);
	});

	it("derives nested list base columns from the ancestor chain for tab-straddled openers (R28A #1 + R28B #2)", () => {
		const unsafe: ReadonlyArray<readonly [string, string, null]> = [
			["- a\n\n\t-\n      b\n        **~~~**\n        next", "~~~", null],
			["-  ab\n\t-  cc\n\n       d\n          **~~~**\n          next", "~~~", null],
			["- ab\n\t- cc\n\n      d\n         **~~~**\n         next", "~~~", null],
			["1. ab\n\t-  cc\n\n       d\n          **~~~**\n          next", "~~~", null],
			["- ab\n\t-  cc\n\t\t-  dd\n\n           e\n              **~~~**\n              next", "~~~", null],
			["-  ab\n\t-  cc\n\n       d\n          **# h**\n          next", "# h", null],
			["-  ab\n\t-  cc\n\n       d\n          **> q**\n          next", "> q", null],
			["-  ab\n\t-  cc\n\n       d\n          **---**\n          next", "---", null],
			["-  ab\n\t-  cc\n\n       d\n          **<div>**\n          next", "<div>", null],
			["> -  ab\n>   \t-  cc\n>\n>          d\n>             **~~~**\n>             next", "~~~", null],
		];
		expectToggles(unsafe, "last");
		expectToggles(
			[
				["- a\n\n\t-\n      b\n        **word**\n        next", "word", "- a\n\n\t-\n      b\n        word\n        next"],
				["-  ab\n\t-  cc\n\n       d\n          **word**\n          next", "word", "-  ab\n\t-  cc\n\n       d\n          word\n          next"],
				["- ab\n\t- cc\n\n      d\n         **word**\n         next", "word", "- ab\n\t- cc\n\n      d\n         word\n         next"],
				["1. ab\n\t-  cc\n\n       d\n          **word**\n          next", "word", "1. ab\n\t-  cc\n\n       d\n          word\n          next"],
				[
					"- ab\n\t-  cc\n\t\t-  dd\n\n           e\n              **word**\n              next",
					"word",
					"- ab\n\t-  cc\n\t\t-  dd\n\n           e\n              word\n              next",
				],
			],
			"last",
		);
		// Blockquote ancestors: the synthetic prefix carries the exact League
		// relative indent (partial tab after `>` / inside the item column).
		const prefixOf = (doc: string): string | undefined => {
			const data = collectBoldAstData(doc, parseBoldMarkdown(doc), DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE);
			return data.leafContainers[data.leafContainers.length - 1]?.blockContextPrefix;
		};
		expect(prefixOf("> -  ab\n>   \t-  cc\n>\n>          d")).toBe("> -  xx\n>\n>    1000. xx\n>\n");
		expect(prefixOf("-  > -  ab\n   >   \t-  cc\n   >\n   >        d")).toBe(
			"-  xx\n\n   > -  xx\n   >\n   >    -  xx\n   >\n",
		);
		expect(prefixOf(">\t- ab\n>\t\t- cc\n>\n>\t\t  d")).toBe("> -   xx\n>\n>     -   xx\n>\n");
	});

	it("consumes one tab column for the optional space after `>` (R28A #2)", () => {
		expectToggles(
			[
				[">\t- a\n  > \t**---**", "---", null],
				[">\t- a\n> \t**~~~**\n> \tnext", "~~~", null],
				[">\t  **code**", "code", null],
				[">\t- a\n  > \t**word**", "word", ">\t- a\n  > \tword"],
				[">\t- a\n> \t**word**\n> \tnext", "word", ">\t- a\n> \tword\n> \tnext"],
				[">\t **code**", "code", ">\t code"],
				[">\t**code**", "code", ">\tcode"],
				["> **word**", "word", "> word"],
				["> - **word**", "word", "> - word"],
			],
			"last",
		);
	});
});

describe("editor-context-menu-bold Stage 4 Round 29 parity (PHP 8.3.37 / League 2.8.2)", () => {
	it("closes blockquotes on >=4-column indented `>` lines so indented code never defines references (R29B #1)", () => {
		expectToggles(
			[
				["> a\n>\n    > [ref]: /url\n\n[ref]", "ref", "> a\n>\n    > [ref]: /url\n\n[**ref**]"],
				["> a\n>\n\t> [ref]: /url\n\n[ref]", "ref", "> a\n>\n\t> [ref]: /url\n\n[**ref**]"],
				["> > a\n> >\n>\t  > [ref]: /url\n\n[ref]", "ref", "> > a\n> >\n>\t  > [ref]: /url\n\n[**ref**]"],
				// Positive controls: <=3 columns after base still continue the blockquote and define [ref].
				["> a\n>\n   > [ref]: /url\n\n[ref]", "ref", "> a\n>\n   > [ref]: /url\n\n[**ref**][ref]"],
				["> > a\n> >\n>\t > [ref]: /url\n\n[ref]", "ref", "> > a\n> >\n>\t > [ref]: /url\n\n[**ref**][ref]"],
			],
			"last",
		);
	});

	it("keeps ordinary Bold and Unbold round-tripping inside >=4-indent nested lists with 2-tree prefixed verification (R29B #2)", () => {
		expectToggles(
			[
				["- a\n  - b\n    - [x] word", "word", "- a\n  - b\n    - [x] **word**"],
				["- a\n  - b\n    - [x] **word**", "word", "- a\n  - b\n    - [x] word"],
				["- a\n  - b\n    - [x] a\n      **word**", "word", "- a\n  - b\n    - [x] a\n      word"],
				["- a\n  - b\n    - [x] a\n      word", "word", "- a\n  - b\n    - [x] a\n      **word**"],
				["10. a\n\n    > word", "word", "10. a\n\n    > **word**"],
				["10. a\n\n    > **word**", "word", "10. a\n\n    > word"],
				["- a\n  - b\n\n    > word", "word", "- a\n  - b\n\n    > **word**"],
				["- a\n  - b\n\n    > **word**", "word", "- a\n  - b\n\n    > word"],
				["100. a\n\n     > - b\n     >   **word**", "word", "100. a\n\n     > - b\n     >   word"],
				["100. a\n\n     > - b\n     >   word", "word", "100. a\n\n     > - b\n     >   **word**"],
				["10. a\n\n    [x] word", "word", "10. a\n\n    [x] **word**"],
				["10. a\n\n    [x] **word**", "word", "10. a\n\n    [x] word"],
				["10. a\n\n    # word", "word", "10. a\n\n    # **word**"],
				["10. a\n\n    # **word**", "word", "10. a\n\n    # word"],
				["- a\n  - b\n\n    # word", "word", "- a\n  - b\n\n    # **word**"],
				["- a\n  - b\n\n    # **word**", "word", "- a\n  - b\n\n    # word"],
				// Block/task reclassification inside >=4-indent nested lists still fails closed.
				["10. a\n\n    **[x]** word", "[x]", null],
				["10. a\n\n    **# word**", "# word", null],
				["10. a\n\n    **> word**", "> word", null],
				["10. a\n\n    **~~~**\n    next", "~~~", null],
				["10. a\n\n    a\n    **===**", "===", null],
				["10. a\n\n    **<div>**\n    next", "<div>", null],
			],
			"last",
		);
	});

	it("keeps prose Bold working in documents with self-contained multiline display math containing `=` or `---` lines", () => {
		expectToggles(
			[
				["$$\na\n=\nb\n$$\n\n**word**", "word", "$$\na\n=\nb\n$$\n\nword"],
				["$$\na\n=\nb\n$$\n\nword", "word", "$$\na\n=\nb\n$$\n\n**word**"],
				["$$\na\n---\nb\n$$\n\n**word**", "word", "$$\na\n---\nb\n$$\n\nword"],
				["$$\na\n\nb\n$$\n\nword", "word", "$$\na\n\nb\n$$\n\n**word**"],
				// Trailing prose attached without a blank line or escaping list still fails closed.
				["$$\na\n=\nb\n$$\ntrailing **word**", "word", null],
				["$$\nx\n1.  item\n$$\n\n    **bold**", "bold", null],
				// Selecting inside the display math itself remains unavailable.
				["$$\na\n=\nb\n$$\n\nword", "a", null],
			],
			"first",
		);

		const fullDoc = readFileSync(
			resolve(process.cwd(), "docs/examples/markdown-full-capability-test.md"),
			"utf8",
		);
		const target = "普通文本";
		const start = fullDoc.indexOf(target);
		expect(start).toBeGreaterThan(-1);
		expect(
			planSourceBoldSelection(fullDoc, {
				direction: "forward",
				end: start + target.length,
				start,
			}),
		).toEqual({ kind: "delegate-toolbar" });
		const mathToken = "\\text{Error Rate}";
		const mathStart = fullDoc.indexOf(mathToken);
		expect(mathStart).toBeGreaterThan(-1);
		expect(
			planSourceBoldSelection(fullDoc, {
				direction: "forward",
				end: mathStart + mathToken.length,
				start: mathStart,
			}),
		).toEqual({ kind: "unavailable" });
	});
});
