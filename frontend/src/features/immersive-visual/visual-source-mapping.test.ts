import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import { createVisualSourceIndex } from "./visual-source-index";
import {
	computeVisualSelectionToMarkdownSelection,
	findAtomSourceRange,
	resolveMarkdownSelectionToVisualSelection,
} from "./visual-source-mapping";

function selectRenderedSubstring(
	doc: ProseMirrorNode,
	markdown: string,
	substring: string,
	occurrence = 0,
): Readonly<{
	end: number;
	pmFrom: number;
	pmTo: number;
	slice: string;
	start: number;
}> {
	const paragraph = doc.firstChild;
	if (!paragraph) throw new Error("Expected first block in doc");
	const rendered = paragraph.textContent;
	let searchFrom = 0;
	let found = -1;
	for (let k = 0; k <= occurrence; k += 1) {
		found = rendered.indexOf(substring, searchFrom);
		if (found < 0) {
			throw new Error(
				`Substring ${JSON.stringify(substring)} (occurrence ${occurrence}) not found in ${JSON.stringify(rendered)}`,
			);
		}
		searchFrom = found + 1;
	}
	const pmFrom = 1 + found;
	const pmTo = pmFrom + substring.length;
	const mapped = computeVisualSelectionToMarkdownSelection(
		doc,
		TextSelection.create(doc, pmFrom, pmTo),
		markdown,
	);
	return {
		end: mapped.end,
		pmFrom,
		pmTo,
		slice: markdown.slice(mapped.start, mapped.end),
		start: mapped.start,
	};
}

function tableCellRange(
	doc: ProseMirrorNode,
	rowIndex: number,
	colIndex: number,
): Readonly<{ contentEnd: number; contentStart: number; text: string }> {
	let tableNode: ProseMirrorNode | null = null;
	let tablePos = -1;
	doc.forEach((child, offset) => {
		if (!tableNode && child.type.name === "table") {
			tableNode = child;
			tablePos = offset;
		}
	});
	if (!tableNode) throw new Error("Expected a table in doc");
	const table: ProseMirrorNode = tableNode;
	let rowOffset = 0;
	for (let r = 0; r < rowIndex; r += 1) {
		rowOffset += table.child(r).nodeSize;
	}
	const row = table.child(rowIndex);
	let cellOffset = 0;
	for (let c = 0; c < colIndex; c += 1) {
		cellOffset += row.child(c).nodeSize;
	}
	const cell = row.child(colIndex);
	const contentStart = tablePos + 1 + rowOffset + 1 + cellOffset + 2;
	const contentEnd = contentStart + (cell.firstChild?.content.size ?? 0);
	return { contentEnd, contentStart, text: cell.textContent };
}

describe("visual source mapping for escapes, inline code, marks, and entities", () => {
	it("maps escaped punctuation and literal backslashes to exact 2-byte source ranges", () => {
		const markdown = "普通转义 \\*星号\\* 与真实反斜杠 \\\\ 结束。";
		const doc = parseMarkdownToVisualDoc(markdown);
		expect(doc.textContent).toBe("普通转义 *星号* 与真实反斜杠 \\ 结束。");

		const escapedStars = selectRenderedSubstring(doc, markdown, "*星号*");
		expect(escapedStars.slice).toBe("\\*星号\\*");
		expect(
			markdown.slice(0, escapedStars.start) + markdown.slice(escapedStars.end),
		).toBe("普通转义  与真实反斜杠 \\\\ 结束。");

		const backslash = selectRenderedSubstring(doc, markdown, "\\");
		expect(backslash.slice).toBe("\\\\");
		expect(
			markdown.slice(0, backslash.start) + markdown.slice(backslash.end),
		).toBe("普通转义 \\*星号\\* 与真实反斜杠  结束。");

		expect(selectRenderedSubstring(doc, markdown, "*", 0).slice).toBe("\\*");
		expect(selectRenderedSubstring(doc, markdown, "*", 1).slice).toBe("\\*");
	});

	it("maps every CommonMark §2.4 ASCII punctuation escape to 2 bytes and non-punctuation backslashes to 1 byte", () => {
		const asciiPunct = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
		// Test each punctuation escape individually so `\(...\)` and `\[...\]`
		// are not paired into EasyMDE LaTeX math protected atoms.
		for (const ch of asciiPunct) {
			const markdown = `a \\${ch} b`;
			const doc = parseMarkdownToVisualDoc(markdown);
			expect(doc.textContent).toBe(`a ${ch} b`);
			const mapped = computeVisualSelectionToMarkdownSelection(
				doc,
				TextSelection.create(doc, 3, 4),
				markdown,
			);
			expect(markdown.slice(mapped.start, mapped.end)).toBe(`\\${ch}`);
		}

		// Backslash before non-ASCII-punctuation is a literal 1-byte backslash.
		const literalMd = "a \\x \\中 b";
		const literalDoc = parseMarkdownToVisualDoc(literalMd);
		expect(literalDoc.textContent).toBe("a \\x \\中 b");
		expect(selectRenderedSubstring(literalDoc, literalMd, "\\", 0).slice).toBe(
			"\\",
		);
		expect(selectRenderedSubstring(literalDoc, literalMd, "x").slice).toBe("x");
		expect(selectRenderedSubstring(literalDoc, literalMd, "\\", 1).slice).toBe(
			"\\",
		);
		expect(selectRenderedSubstring(literalDoc, literalMd, "中").slice).toBe(
			"中",
		);
	});

	it("maps repeated escapes (\\*\\*\\*, \\\\\\\\, \\\\\\*a\\\\\\*) without leaving orphan backslashes", () => {
		const starsMd = "\\*\\*\\*";
		const starsDoc = parseMarkdownToVisualDoc(starsMd);
		expect(starsDoc.textContent).toBe("***");
		expect(selectRenderedSubstring(starsDoc, starsMd, "*", 0).slice).toBe(
			"\\*",
		);
		expect(selectRenderedSubstring(starsDoc, starsMd, "*", 1).slice).toBe(
			"\\*",
		);
		expect(selectRenderedSubstring(starsDoc, starsMd, "*", 2).slice).toBe(
			"\\*",
		);
		expect(selectRenderedSubstring(starsDoc, starsMd, "***").slice).toBe(
			"\\*\\*\\*",
		);

		const slashesMd = "\\\\\\\\";
		const slashesDoc = parseMarkdownToVisualDoc(slashesMd);
		expect(slashesDoc.textContent).toBe("\\\\");
		const firstSlash = selectRenderedSubstring(slashesDoc, slashesMd, "\\", 0);
		const secondSlash = selectRenderedSubstring(slashesDoc, slashesMd, "\\", 1);
		expect(firstSlash).toMatchObject({ end: 2, slice: "\\\\", start: 0 });
		expect(secondSlash).toMatchObject({ end: 4, slice: "\\\\", start: 2 });
		expect(selectRenderedSubstring(slashesDoc, slashesMd, "\\\\").slice).toBe(
			"\\\\\\\\",
		);

		const mixedMd = "\\\\\\*a\\\\\\*";
		const mixedDoc = parseMarkdownToVisualDoc(mixedMd);
		expect(mixedDoc.textContent).toBe("\\*a\\*");
		const leadSlash = selectRenderedSubstring(mixedDoc, mixedMd, "\\", 0);
		expect(leadSlash.slice).toBe("\\\\");
		expect(
			mixedMd.slice(0, leadSlash.start) + mixedMd.slice(leadSlash.end),
		).toBe("\\*a\\\\\\*");
		expect(selectRenderedSubstring(mixedDoc, mixedMd, "*", 0).slice).toBe(
			"\\*",
		);
		expect(selectRenderedSubstring(mixedDoc, mixedMd, "a").slice).toBe("a");
		expect(selectRenderedSubstring(mixedDoc, mixedMd, "\\", 1).slice).toBe(
			"\\\\",
		);
		expect(selectRenderedSubstring(mixedDoc, mixedMd, "*", 1).slice).toBe(
			"\\*",
		);
		expect(selectRenderedSubstring(mixedDoc, mixedMd, "*a\\").slice).toBe(
			"\\*a\\\\",
		);
	});

	it("handles adjacent formatting delimiters + escapes without matching mark delimiters as literal text", () => {
		const boldAfter = "**bold**\\*";
		const boldAfterDoc = parseMarkdownToVisualDoc(boldAfter);
		expect(
			selectRenderedSubstring(boldAfterDoc, boldAfter, "bold"),
		).toMatchObject({ end: 6, slice: "bold", start: 2 });
		expect(selectRenderedSubstring(boldAfterDoc, boldAfter, "*")).toMatchObject(
			{ end: 10, slice: "\\*", start: 8 },
		);

		const emAfter = "*em*\\*";
		const emAfterDoc = parseMarkdownToVisualDoc(emAfter);
		expect(selectRenderedSubstring(emAfterDoc, emAfter, "em")).toMatchObject({
			end: 3,
			slice: "em",
			start: 1,
		});
		expect(selectRenderedSubstring(emAfterDoc, emAfter, "*")).toMatchObject({
			end: 6,
			slice: "\\*",
			start: 4,
		});

		const strikeAfter = "~~strike~~\\~";
		const strikeAfterDoc = parseMarkdownToVisualDoc(strikeAfter);
		expect(
			selectRenderedSubstring(strikeAfterDoc, strikeAfter, "strike"),
		).toMatchObject({ end: 8, slice: "strike", start: 2 });
		expect(
			selectRenderedSubstring(strikeAfterDoc, strikeAfter, "~"),
		).toMatchObject({ end: 12, slice: "\\~", start: 10 });

		const bothAfter = "***both***\\*";
		const bothAfterDoc = parseMarkdownToVisualDoc(bothAfter);
		expect(
			selectRenderedSubstring(bothAfterDoc, bothAfter, "both"),
		).toMatchObject({ end: 7, slice: "both", start: 3 });
		expect(selectRenderedSubstring(bothAfterDoc, bothAfter, "*")).toMatchObject(
			{ end: 12, slice: "\\*", start: 10 },
		);

		const beforeBold = "\\* **bold**";
		const beforeBoldDoc = parseMarkdownToVisualDoc(beforeBold);
		expect(
			selectRenderedSubstring(beforeBoldDoc, beforeBold, "*"),
		).toMatchObject({ end: 2, slice: "\\*", start: 0 });
		expect(
			selectRenderedSubstring(beforeBoldDoc, beforeBold, "bold"),
		).toMatchObject({ end: 9, slice: "bold", start: 5 });

		// Escaped punctuation immediately inside opening emphasis delimiters.
		const insideBold = "**\\*bold**";
		const insideBoldDoc = parseMarkdownToVisualDoc(insideBold);
		expect(
			selectRenderedSubstring(insideBoldDoc, insideBold, "*"),
		).toMatchObject({ end: 4, slice: "\\*", start: 2 });
		expect(
			selectRenderedSubstring(insideBoldDoc, insideBold, "*bold"),
		).toMatchObject({ end: 8, slice: "\\*bold", start: 2 });

		// Merged same-mark text node (`**a**__\_b__`).
		const mergedStrong = "**a**__\\_b__";
		const mergedStrongDoc = parseMarkdownToVisualDoc(mergedStrong);
		expect(mergedStrongDoc.textContent).toBe("a_b");
		expect(
			selectRenderedSubstring(mergedStrongDoc, mergedStrong, "_"),
		).toMatchObject({ end: 9, slice: "\\_", start: 7 });
		expect(
			selectRenderedSubstring(mergedStrongDoc, mergedStrong, "b"),
		).toMatchObject({ end: 10, slice: "b", start: 9 });
	});

	it("maps inline code spans with literal backslashes, space padding, and trailing escaped backticks", () => {
		const codeAndEscapedTick = "`a\\b` and `a`\\`";
		const doc = parseMarkdownToVisualDoc(codeAndEscapedTick);
		expect(doc.textContent).toBe("a\\b and a`");
		expect(
			selectRenderedSubstring(doc, codeAndEscapedTick, "\\"),
		).toMatchObject({ end: 3, slice: "\\", start: 2 });
		expect(
			selectRenderedSubstring(doc, codeAndEscapedTick, "a\\b"),
		).toMatchObject({ end: 4, slice: "a\\b", start: 1 });
		expect(selectRenderedSubstring(doc, codeAndEscapedTick, "`")).toMatchObject(
			{ end: 15, slice: "\\`", start: 13 },
		);

		// Double-backtick code span with CommonMark §6.1 single space stripping + trailing `\``.
		const doubleTicks = "`` `code` ``\\`";
		const doubleDoc = parseMarkdownToVisualDoc(doubleTicks);
		expect(doubleDoc.textContent).toBe("`code``");
		expect(
			selectRenderedSubstring(doubleDoc, doubleTicks, "`code`"),
		).toMatchObject({ end: 9, slice: "`code`", start: 3 });
		expect(
			selectRenderedSubstring(doubleDoc, doubleTicks, "`", 2),
		).toMatchObject({ end: 14, slice: "\\`", start: 12 });

		// All-space code span does NOT strip its spaces.
		const allSpaces = "`  `x";
		const allSpacesDoc = parseMarkdownToVisualDoc(allSpaces);
		expect(allSpacesDoc.textContent).toBe("  x");
		expect(
			selectRenderedSubstring(allSpacesDoc, allSpaces, "  "),
		).toMatchObject({ end: 3, slice: "  ", start: 1 });
		expect(selectRenderedSubstring(allSpacesDoc, allSpaces, "x")).toMatchObject(
			{ end: 5, slice: "x", start: 4 },
		);

		// Nested strong + code followed by escaped `*`.
		const strongCode = "**`a`**\\*";
		const strongCodeDoc = parseMarkdownToVisualDoc(strongCode);
		expect(
			selectRenderedSubstring(strongCodeDoc, strongCode, "a"),
		).toMatchObject({ end: 4, slice: "a", start: 3 });
		expect(
			selectRenderedSubstring(strongCodeDoc, strongCode, "*"),
		).toMatchObject({ end: 9, slice: "\\*", start: 7 });
	});

	it("maps table-cell escaped pipes outside and inside inline code spans", () => {
		const markdown = [
			"| a\\|b | `a\\|b` | `a\\\\|b` | a\\\\\\|b |",
			"| --- | --- | --- | --- |",
			"| **bold**\\* | `a`\\` | c | d |",
		].join("\n");
		const doc = parseMarkdownToVisualDoc(markdown);

		// Col 0: plain `a\|b`
		const c0 = tableCellRange(doc, 0, 0);
		expect(c0.text).toBe("a|b");
		const c0Pipe = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c0.contentStart + 1, c0.contentStart + 2),
			markdown,
		);
		expect(markdown.slice(c0Pipe.start, c0Pipe.end)).toBe("\\|");

		// Col 1: code `` `a\|b` ``
		const c1 = tableCellRange(doc, 0, 1);
		expect(c1.text).toBe("a|b");
		const c1Pipe = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c1.contentStart + 1, c1.contentStart + 2),
			markdown,
		);
		expect(markdown.slice(c1Pipe.start, c1Pipe.end)).toBe("\\|");
		const c1Full = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c1.contentStart, c1.contentEnd),
			markdown,
		);
		expect(markdown.slice(c1Full.start, c1Full.end)).toBe("a\\|b");

		// Col 2: code `` `a\\|b` `` -> literal `\` (1 byte) + escaped `\|` (2 bytes)
		const c2 = tableCellRange(doc, 0, 2);
		expect(c2.text).toBe("a\\|b");
		const c2Slash = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c2.contentStart + 1, c2.contentStart + 2),
			markdown,
		);
		const c2Pipe = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c2.contentStart + 2, c2.contentStart + 3),
			markdown,
		);
		expect(markdown.slice(c2Slash.start, c2Slash.end)).toBe("\\");
		expect(markdown.slice(c2Pipe.start, c2Pipe.end)).toBe("\\|");

		// Col 3: plain `a\\\|b` -> escaped `\\` (2 bytes) + escaped `\|` (2 bytes)
		const c3 = tableCellRange(doc, 0, 3);
		expect(c3.text).toBe("a\\|b");
		const c3Slash = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c3.contentStart + 1, c3.contentStart + 2),
			markdown,
		);
		const c3Pipe = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, c3.contentStart + 2, c3.contentStart + 3),
			markdown,
		);
		expect(markdown.slice(c3Slash.start, c3Slash.end)).toBe("\\\\");
		expect(markdown.slice(c3Pipe.start, c3Pipe.end)).toBe("\\|");

		// Row 1 Col 0: `**bold**\*` inside table cell
		const r1c0 = tableCellRange(doc, 1, 0);
		expect(r1c0.text).toBe("bold*");
		const r1c0Star = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, r1c0.contentStart + 4, r1c0.contentEnd),
			markdown,
		);
		expect(markdown.slice(r1c0Star.start, r1c0Star.end)).toBe("\\*");

		// Row 1 Col 1: `` `a`\` `` inside table cell
		const r1c1 = tableCellRange(doc, 1, 1);
		expect(r1c1.text).toBe("a`");
		const r1c1Tick = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, r1c1.contentStart + 1, r1c1.contentEnd),
			markdown,
		);
		expect(markdown.slice(r1c1Tick.start, r1c1Tick.end)).toBe("\\`");
	});

	it("handles links, autolinks, continuing emphasis across links, protected atoms, and HTML entities", () => {
		const linkMd = "[a\\]b](https://example.com)\\]";
		const linkDoc = parseMarkdownToVisualDoc(linkMd);
		expect(linkDoc.textContent).toBe("a]b]");
		expect(selectRenderedSubstring(linkDoc, linkMd, "]", 0).slice).toBe("\\]");
		expect(selectRenderedSubstring(linkDoc, linkMd, "]", 1).slice).toBe("\\]");

		const openBracketLink = "[\\[a](https://example.com)\\[";
		const openBracketDoc = parseMarkdownToVisualDoc(openBracketLink);
		expect(openBracketDoc.textContent).toBe("[a[");
		expect(
			selectRenderedSubstring(openBracketDoc, openBracketLink, "[", 0).slice,
		).toBe("\\[");
		expect(
			selectRenderedSubstring(openBracketDoc, openBracketLink, "[", 1).slice,
		).toBe("\\[");

		const adjLinks = "[**a**](https://a.test)[**\\*b**](https://b.test)";
		const adjDoc = parseMarkdownToVisualDoc(adjLinks);
		expect(adjDoc.textContent).toBe("a*b");
		expect(selectRenderedSubstring(adjDoc, adjLinks, "a").slice).toBe("a");
		expect(selectRenderedSubstring(adjDoc, adjLinks, "*").slice).toBe("\\*");
		expect(selectRenderedSubstring(adjDoc, adjLinks, "b").slice).toBe("b");

		const autolinkMd = "<https://example.com>\\>";
		const autolinkDoc = parseMarkdownToVisualDoc(autolinkMd);
		expect(autolinkDoc.textContent).toBe("https://example.com>");
		expect(
			selectRenderedSubstring(autolinkDoc, autolinkMd, "https://example.com")
				.slice,
		).toBe("https://example.com");
		expect(selectRenderedSubstring(autolinkDoc, autolinkMd, ">").slice).toBe(
			"\\>",
		);

		const mathBoldEscape = "**$x$**\\*";
		const mathBoldDoc = parseMarkdownToVisualDoc(mathBoldEscape);
		// doc(0) -> paragraph(1) -> protected_inline(1..2) -> text("*")(2..3)
		const trailingStar = computeVisualSelectionToMarkdownSelection(
			mathBoldDoc,
			TextSelection.create(mathBoldDoc, 2, 3),
			mathBoldEscape,
		);
		expect(mathBoldEscape.slice(trailingStar.start, trailingStar.end)).toBe(
			"\\*",
		);

		const entityMd = "&amp; &#65; &#x42; &copy; &#x1F600; &notanentity;";
		const entityDoc = parseMarkdownToVisualDoc(entityMd);
		expect(entityDoc.textContent).toBe("& A B © 😀 &notanentity;");
		expect(selectRenderedSubstring(entityDoc, entityMd, "&", 0).slice).toBe(
			"&amp;",
		);
		expect(selectRenderedSubstring(entityDoc, entityMd, "A").slice).toBe(
			"&#65;",
		);
		expect(selectRenderedSubstring(entityDoc, entityMd, "B").slice).toBe(
			"&#x42;",
		);
		expect(selectRenderedSubstring(entityDoc, entityMd, "©").slice).toBe(
			"&copy;",
		);
		expect(selectRenderedSubstring(entityDoc, entityMd, "😀").slice).toBe(
			"&#x1F600;",
		);
		expect(
			selectRenderedSubstring(entityDoc, entityMd, "&notanentity;").slice,
		).toBe("&notanentity;");
	});

	it("handles multiline blockquote continuations before formatting and escapes", () => {
		const markdown = "> hello\n> **bold**\\*\n> \\*star\\*";
		const doc = parseMarkdownToVisualDoc(markdown);
		const paragraph = doc.firstChild?.firstChild;
		if (!paragraph) throw new Error("Expected blockquote paragraph");
		const contentStart = 2; // doc(0) -> blockquote(1) -> paragraph(2)
		const text = paragraph.textContent;
		const boldStarOffset = text.indexOf("bold*") + 4;
		const star1Offset = text.indexOf("*star*");
		const star2Offset = star1Offset + 5;

		const boldStar = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(
				doc,
				contentStart + boldStarOffset,
				contentStart + boldStarOffset + 1,
			),
			markdown,
		);
		expect(markdown.slice(boldStar.start, boldStar.end)).toBe("\\*");

		const starSpan = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(
				doc,
				contentStart + star1Offset,
				contentStart + star2Offset + 1,
			),
			markdown,
		);
		expect(markdown.slice(starSpan.start, starSpan.end)).toBe("\\*star\\*");
	});

	it("round-trips carets and selections bidirectionally across 2-byte escape units", () => {
		const markdown = "a\\*b\\\\c";
		const doc = parseMarkdownToVisualDoc(markdown);
		expect(doc.textContent).toBe("a*b\\c");
		const index = createVisualSourceIndex(doc, markdown);

		// Expected canonical Markdown offsets for every PM caret 1..6:
		// pm=1 (|a) -> 0, pm=2 (a|*) -> 1, pm=3 (*|b) -> 3,
		// pm=4 (b|\) -> 4, pm=5 (\|c) -> 6, pm=6 (c|) -> 7
		const expectedOffsets = [0, 1, 3, 4, 6, 7];
		for (let i = 0; i < expectedOffsets.length; i += 1) {
			const pmPos = 1 + i;
			const mdCaret = computeVisualSelectionToMarkdownSelection(
				doc,
				TextSelection.create(doc, pmPos),
				markdown,
				index,
			);
			expect(mdCaret).toEqual({
				direction: "none",
				end: expectedOffsets[i],
				start: expectedOffsets[i],
			});
			const restored = resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				mdCaret,
				index,
			);
			expect(restored.empty).toBe(true);
			expect(restored.from).toBe(pmPos);
		}

		// A Markdown caret landing on EITHER byte of `\*` (offset 1 or 2) maps to pmPos 2 (before `*`).
		expect(
			resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				{ direction: "none", end: 1, start: 1 },
				index,
			).from,
		).toBe(2);
		expect(
			resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				{ direction: "none", end: 2, start: 2 },
				index,
			).from,
		).toBe(2);
		// Offset 3 (after `\*`) maps to pmPos 3 (after `*`).
		expect(
			resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				{ direction: "none", end: 3, start: 3 },
				index,
			).from,
		).toBe(3);

		// A Markdown caret landing on EITHER byte of `\\` (offset 4 or 5) maps to pmPos 4 (before `\`).
		expect(
			resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				{ direction: "none", end: 4, start: 4 },
				index,
			).from,
		).toBe(4);
		expect(
			resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				{ direction: "none", end: 5, start: 5 },
				index,
			).from,
		).toBe(4);

		// Selecting the full escape `[1, 3)` (`\*`), or either half `[1, 2)` / `[2, 3)`,
		// maps to the whole rendered `*` (`pm 2..3`) and round-trips to `[1, 3)`.
		for (const range of [
			{ end: 3, start: 1 },
			{ end: 2, start: 1 },
			{ end: 3, start: 2 },
		]) {
			const visual = resolveMarkdownSelectionToVisualSelection(
				doc,
				markdown,
				{ direction: "forward", ...range },
				index,
			);
			expect({ from: visual.from, to: visual.to }).toEqual({ from: 2, to: 3 });
			const back = computeVisualSelectionToMarkdownSelection(
				doc,
				visual,
				markdown,
				index,
			);
			expect(back).toEqual({ direction: "forward", end: 3, start: 1 });
		}

		// Backward range over `\*b\\` (`[1, 6)` -> PM anchor 5, head 2) round-trips direction and bounds.
		const backwardVisual = resolveMarkdownSelectionToVisualSelection(
			doc,
			markdown,
			{ direction: "backward", end: 6, start: 1 },
			index,
		);
		expect({
			anchor: backwardVisual.anchor,
			head: backwardVisual.head,
		}).toEqual({ anchor: 5, head: 2 });
		expect(
			computeVisualSelectionToMarkdownSelection(
				doc,
				backwardVisual,
				markdown,
				index,
			),
		).toEqual({ direction: "backward", end: 6, start: 1 });
	});

	it("matches CommonMark autolinks literally without decoding entities, stripping backslashes, or crossing >", () => {
		const entityAutolinkMd = "<https://example.test/?q=&amp;> amp; tail";
		const entityAutolinkDoc = parseMarkdownToVisualDoc(entityAutolinkMd);
		expect(entityAutolinkDoc.textContent).toBe(
			"https://example.test/?q=&amp; amp; tail",
		);
		const entityInside = selectRenderedSubstring(
			entityAutolinkDoc,
			entityAutolinkMd,
			"&amp;",
		);
		expect(entityInside).toMatchObject({
			end: 30,
			slice: "&amp;",
			start: 25,
		});
		expect(
			entityAutolinkMd.slice(0, entityInside.start) +
				entityAutolinkMd.slice(entityInside.end),
		).toBe("<https://example.test/?q=> amp; tail");
		expect(
			selectRenderedSubstring(entityAutolinkDoc, entityAutolinkMd, "amp;", 1),
		).toMatchObject({ end: 36, slice: "amp;", start: 32 });
		expect(
			selectRenderedSubstring(
				entityAutolinkDoc,
				entityAutolinkMd,
				"https://example.test/?q=&amp;",
			),
		).toMatchObject({
			end: 30,
			slice: "https://example.test/?q=&amp;",
			start: 1,
		});

		const backslashAutolinkMd = "<https://example.test/a\\&b> tail";
		const backslashAutolinkDoc = parseMarkdownToVisualDoc(backslashAutolinkMd);
		expect(backslashAutolinkDoc.textContent).toBe(
			"https://example.test/a\\&b tail",
		);
		expect(
			selectRenderedSubstring(backslashAutolinkDoc, backslashAutolinkMd, "\\"),
		).toMatchObject({ end: 24, slice: "\\", start: 23 });
		expect(
			selectRenderedSubstring(backslashAutolinkDoc, backslashAutolinkMd, "&"),
		).toMatchObject({ end: 25, slice: "&", start: 24 });
		expect(
			selectRenderedSubstring(
				backslashAutolinkDoc,
				backslashAutolinkMd,
				"a\\&b",
			),
		).toMatchObject({ end: 26, slice: "a\\&b", start: 22 });
		expect(
			selectRenderedSubstring(backslashAutolinkDoc, backslashAutolinkMd, "tail"),
		).toMatchObject({ end: 32, slice: "tail", start: 28 });

		const mailtoMd = "<mailto:user+tag@example.test>";
		const mailtoDoc = parseMarkdownToVisualDoc(mailtoMd);
		expect(mailtoDoc.textContent).toBe("mailto:user+tag@example.test");
		expect(
			selectRenderedSubstring(
				mailtoDoc,
				mailtoMd,
				"mailto:user+tag@example.test",
			),
		).toMatchObject({
			end: 29,
			slice: "mailto:user+tag@example.test",
			start: 1,
		});
		expect(
			selectRenderedSubstring(mailtoDoc, mailtoMd, "user+tag@example.test"),
		).toMatchObject({
			end: 29,
			slice: "user+tag@example.test",
			start: 8,
		});

		const emphasizedAutolinkMd = "**<https://example.test/?q=&amp;>** tail";
		const emphasizedAutolinkDoc =
			parseMarkdownToVisualDoc(emphasizedAutolinkMd);
		expect(
			selectRenderedSubstring(
				emphasizedAutolinkDoc,
				emphasizedAutolinkMd,
				"&amp;",
			),
		).toMatchObject({ end: 32, slice: "&amp;", start: 27 });
		expect(
			selectRenderedSubstring(
				emphasizedAutolinkDoc,
				emphasizedAutolinkMd,
				"tail",
			),
		).toMatchObject({ end: 40, slice: "tail", start: 36 });

		const regularEntityLinkMd = "[a &amp; b](https://example.test)";
		const regularEntityLinkDoc = parseMarkdownToVisualDoc(regularEntityLinkMd);
		expect(regularEntityLinkDoc.textContent).toBe("a & b");
		expect(
			selectRenderedSubstring(regularEntityLinkDoc, regularEntityLinkMd, "&"),
		).toMatchObject({ end: 8, slice: "&amp;", start: 3 });
		expect(
			selectRenderedSubstring(
				regularEntityLinkDoc,
				regularEntityLinkMd,
				"a & b",
			),
		).toMatchObject({ end: 10, slice: "a &amp; b", start: 1 });

		const regularEscapeLinkMd = "[a \\& b](https://example.test)";
		const regularEscapeLinkDoc = parseMarkdownToVisualDoc(regularEscapeLinkMd);
		expect(regularEscapeLinkDoc.textContent).toBe("a & b");
		expect(
			selectRenderedSubstring(regularEscapeLinkDoc, regularEscapeLinkMd, "&"),
		).toMatchObject({ end: 5, slice: "\\&", start: 3 });

		const bareEmailMd = "<user+tag@example.test> tail";
		const bareEmailDoc = parseMarkdownToVisualDoc(bareEmailMd);
		expect(bareEmailDoc.textContent).toBe("user+tag@example.test tail");
		expect(
			selectRenderedSubstring(bareEmailDoc, bareEmailMd, "user+tag@example.test"),
		).toMatchObject({ end: 22, slice: "user+tag@example.test", start: 1 });
		expect(
			selectRenderedSubstring(bareEmailDoc, bareEmailMd, "tail"),
		).toMatchObject({ end: 28, slice: "tail", start: 24 });

		const tableAutolinkMd = [
			"| <https://example.test/?q=&amp;> | <https://example.test/a\\|b> |",
			"| --- | --- |",
			"| x | y |",
		].join("\n");
		const tableAutolinkDoc = parseMarkdownToVisualDoc(tableAutolinkMd);
		const tc0 = tableCellRange(tableAutolinkDoc, 0, 0);
		expect(tc0.text).toBe("https://example.test/?q=&amp;");
		const tc0AmpOffset = tc0.text.indexOf("&amp;");
		const tc0Mapped = computeVisualSelectionToMarkdownSelection(
			tableAutolinkDoc,
			TextSelection.create(
				tableAutolinkDoc,
				tc0.contentStart + tc0AmpOffset,
				tc0.contentStart + tc0AmpOffset + 5,
			),
			tableAutolinkMd,
		);
		expect(tableAutolinkMd.slice(tc0Mapped.start, tc0Mapped.end)).toBe("&amp;");

		const tc1 = tableCellRange(tableAutolinkDoc, 0, 1);
		expect(tc1.text).toBe("https://example.test/a|b");
		const tc1PipeOffset = tc1.text.indexOf("|");
		const tc1Mapped = computeVisualSelectionToMarkdownSelection(
			tableAutolinkDoc,
			TextSelection.create(
				tableAutolinkDoc,
				tc1.contentStart + tc1PipeOffset,
				tc1.contentStart + tc1PipeOffset + 1,
			),
			tableAutolinkMd,
		);
		expect(tableAutolinkMd.slice(tc1Mapped.start, tc1Mapped.end)).toBe("\\|");
	});

	it("tracks lexical link boundaries across adjacent equal-URL autolinks and regular links with emphasis", () => {
		// Regression: `**<https://a.test>**<https://a.test>`
		const strongThenPlain = "**<https://a.test>**<https://a.test>";
		const strongThenPlainDoc = parseMarkdownToVisualDoc(strongThenPlain);
		expect(strongThenPlainDoc.textContent).toBe("https://a.testhttps://a.test");
		expect(
			selectRenderedSubstring(
				strongThenPlainDoc,
				strongThenPlain,
				"https://a.test",
				0,
			),
		).toMatchObject({ end: 17, slice: "https://a.test", start: 3 });
		expect(
			selectRenderedSubstring(
				strongThenPlainDoc,
				strongThenPlain,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 35, slice: "https://a.test", start: 21 });
		expect(
			selectRenderedSubstring(strongThenPlainDoc, strongThenPlain, "esthttp"),
		).toMatchObject({ end: 25, slice: "est>**<http", start: 14 });
		// Round-trip second autolink selection from Markdown back to ProseMirror.
		const restoredSecond = resolveMarkdownSelectionToVisualSelection(
			strongThenPlainDoc,
			strongThenPlain,
			{ direction: "forward", end: 35, start: 21 },
		);
		expect({ from: restoredSecond.from, to: restoredSecond.to }).toEqual({
			from: 15,
			to: 29,
		});

		// `<https://a.test>**<https://a.test>**`
		const plainThenStrong = "<https://a.test>**<https://a.test>**";
		const plainThenStrongDoc = parseMarkdownToVisualDoc(plainThenStrong);
		expect(plainThenStrongDoc.textContent).toBe("https://a.testhttps://a.test");
		expect(
			selectRenderedSubstring(
				plainThenStrongDoc,
				plainThenStrong,
				"https://a.test",
				0,
			),
		).toMatchObject({ end: 15, slice: "https://a.test", start: 1 });
		expect(
			selectRenderedSubstring(
				plainThenStrongDoc,
				plainThenStrong,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 33, slice: "https://a.test", start: 19 });
		expect(
			selectRenderedSubstring(plainThenStrongDoc, plainThenStrong, "esthttp"),
		).toMatchObject({ end: 23, slice: "est>**<http", start: 12 });

		// `<https://a.test><https://a.test>`
		const backToBack = "<https://a.test><https://a.test>";
		const backToBackDoc = parseMarkdownToVisualDoc(backToBack);
		expect(backToBackDoc.textContent).toBe("https://a.testhttps://a.test");
		expect(
			selectRenderedSubstring(backToBackDoc, backToBack, "https://a.test", 0),
		).toMatchObject({ end: 15, slice: "https://a.test", start: 1 });
		expect(
			selectRenderedSubstring(backToBackDoc, backToBack, "https://a.test", 1),
		).toMatchObject({ end: 31, slice: "https://a.test", start: 17 });
		expect(
			selectRenderedSubstring(backToBackDoc, backToBack, "esthttp"),
		).toMatchObject({ end: 21, slice: "est><http", start: 12 });

		// `*<https://a.test>*<https://a.test>` and `~~<https://a.test>~~<https://a.test>`
		const emThenPlain = "*<https://a.test>*<https://a.test>";
		const emThenPlainDoc = parseMarkdownToVisualDoc(emThenPlain);
		expect(
			selectRenderedSubstring(emThenPlainDoc, emThenPlain, "https://a.test", 1),
		).toMatchObject({ end: 33, slice: "https://a.test", start: 19 });
		expect(
			selectRenderedSubstring(emThenPlainDoc, emThenPlain, "esthttp"),
		).toMatchObject({ end: 23, slice: "est>*<http", start: 13 });

		const strikeThenPlain = "~~<https://a.test>~~<https://a.test>";
		const strikeThenPlainDoc = parseMarkdownToVisualDoc(strikeThenPlain);
		expect(
			selectRenderedSubstring(
				strikeThenPlainDoc,
				strikeThenPlain,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 35, slice: "https://a.test", start: 21 });
		expect(
			selectRenderedSubstring(strikeThenPlainDoc, strikeThenPlain, "esthttp"),
		).toMatchObject({ end: 25, slice: "est>~~<http", start: 14 });

		// Entities stay literal inside BOTH adjacent autolinks across emphasis boundary.
		const entityPair = "**<https://a.test/?q=&amp;>**<https://a.test/?q=&amp;>";
		const entityPairDoc = parseMarkdownToVisualDoc(entityPair);
		expect(entityPairDoc.textContent).toBe(
			"https://a.test/?q=&amp;https://a.test/?q=&amp;",
		);
		expect(
			selectRenderedSubstring(entityPairDoc, entityPair, "&amp;", 0),
		).toMatchObject({ end: 26, slice: "&amp;", start: 21 });
		expect(
			selectRenderedSubstring(entityPairDoc, entityPair, "&amp;", 1),
		).toMatchObject({ end: 53, slice: "&amp;", start: 48 });
		expect(
			selectRenderedSubstring(entityPairDoc, entityPair, "&amp;http"),
		).toMatchObject({ end: 34, slice: "&amp;>**<http", start: 21 });

		// Adjacent equal-URL regular links separated by emphasis opening/closing.
		const regPlainThenStrong = "[a](https://a.test)**[b](https://a.test)**";
		const regPlainThenStrongDoc = parseMarkdownToVisualDoc(regPlainThenStrong);
		expect(regPlainThenStrongDoc.textContent).toBe("ab");
		expect(
			selectRenderedSubstring(regPlainThenStrongDoc, regPlainThenStrong, "a"),
		).toMatchObject({ end: 2, slice: "a", start: 1 });
		expect(
			selectRenderedSubstring(regPlainThenStrongDoc, regPlainThenStrong, "b"),
		).toMatchObject({ end: 23, slice: "b", start: 22 });

		const regStrongThenPlain = "**[a](https://a.test)**[\\*b](https://a.test)";
		const regStrongThenPlainDoc = parseMarkdownToVisualDoc(regStrongThenPlain);
		expect(regStrongThenPlainDoc.textContent).toBe("a*b");
		expect(
			selectRenderedSubstring(regStrongThenPlainDoc, regStrongThenPlain, "a"),
		).toMatchObject({ end: 4, slice: "a", start: 3 });
		expect(
			selectRenderedSubstring(regStrongThenPlainDoc, regStrongThenPlain, "*"),
		).toMatchObject({ end: 26, slice: "\\*", start: 24 });
		expect(
			selectRenderedSubstring(regStrongThenPlainDoc, regStrongThenPlain, "b"),
		).toMatchObject({ end: 27, slice: "b", start: 26 });

		// Mixed autolink <-> regular link boundaries with equal URLs and emphasis.
		const autolinkToReg = "**<https://a.test>**[b &amp; c](https://a.test)";
		const autolinkToRegDoc = parseMarkdownToVisualDoc(autolinkToReg);
		expect(autolinkToRegDoc.textContent).toBe("https://a.testb & c");
		expect(
			selectRenderedSubstring(autolinkToRegDoc, autolinkToReg, "&"),
		).toMatchObject({ end: 28, slice: "&amp;", start: 23 });

		const regToAutolink =
			"[a](https://a.test/?q=&amp;)**<https://a.test/?q=&amp;>**";
		const regToAutolinkDoc = parseMarkdownToVisualDoc(regToAutolink);
		expect(regToAutolinkDoc.textContent).toBe("ahttps://a.test/?q=&amp;");
		expect(
			selectRenderedSubstring(regToAutolinkDoc, regToAutolink, "&amp;"),
		).toMatchObject({ end: 54, slice: "&amp;", start: 49 });

		// Continuing emphasis and merged identical-mark adjacent links.
		const mergedStrongAutolinks = "**<https://a.test>**__<https://a.test>__";
		const mergedStrongAutolinksDoc = parseMarkdownToVisualDoc(
			mergedStrongAutolinks,
		);
		expect(
			selectRenderedSubstring(
				mergedStrongAutolinksDoc,
				mergedStrongAutolinks,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 37, slice: "https://a.test", start: 23 });
		expect(
			selectRenderedSubstring(
				mergedStrongAutolinksDoc,
				mergedStrongAutolinks,
				"esthttp",
			),
		).toMatchObject({ end: 27, slice: "est>**__<http", start: 14 });

		const continuingEmCloseStrong = "***<https://a.test>**<https://a.test>*";
		const continuingEmCloseStrongDoc = parseMarkdownToVisualDoc(
			continuingEmCloseStrong,
		);
		expect(
			selectRenderedSubstring(
				continuingEmCloseStrongDoc,
				continuingEmCloseStrong,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 36, slice: "https://a.test", start: 22 });

		const continuingEmOpenStrong = "*<https://a.test>**<https://a.test>***";
		const continuingEmOpenStrongDoc = parseMarkdownToVisualDoc(
			continuingEmOpenStrong,
		);
		expect(
			selectRenderedSubstring(
				continuingEmOpenStrongDoc,
				continuingEmOpenStrong,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 34, slice: "https://a.test", start: 20 });

		const closeEmReopenStrong = "***<https://a.test>***__<https://a.test>__";
		const closeEmReopenStrongDoc =
			parseMarkdownToVisualDoc(closeEmReopenStrong);
		expect(
			selectRenderedSubstring(
				closeEmReopenStrongDoc,
				closeEmReopenStrong,
				"https://a.test",
				1,
			),
		).toMatchObject({ end: 39, slice: "https://a.test", start: 25 });

		const autolinkToBoldEscapedReg = "**<https://a.test>**[**\\*b**](https://a.test)";
		const autolinkToBoldEscapedRegDoc = parseMarkdownToVisualDoc(
			autolinkToBoldEscapedReg,
		);
		expect(autolinkToBoldEscapedRegDoc.textContent).toBe("https://a.test*b");
		expect(
			selectRenderedSubstring(
				autolinkToBoldEscapedRegDoc,
				autolinkToBoldEscapedReg,
				"*",
			),
		).toMatchObject({ end: 25, slice: "\\*", start: 23 });

		const nestedBracketLink = "[a[**b**]c](https://a.test)";
		const nestedBracketLinkDoc = parseMarkdownToVisualDoc(nestedBracketLink);
		expect(nestedBracketLinkDoc.textContent).toBe("a[b]c");
		expect(
			selectRenderedSubstring(nestedBracketLinkDoc, nestedBracketLink, "]c"),
		).toMatchObject({ end: 10, slice: "]c", start: 8 });
	});

	it("verifies lexical link boundaries for nested literal brackets, reference links, and adjacent equal-URL links", () => {
		// Regression (Round 3A #2): `[a[**b**][c][d]e](https://a.test)` must not
		// mistake the inner `]` at index 8 for a reference-link boundary.
		const nestedMultiBracket = "[a[**b**][c][d]e](https://a.test)";
		const nestedMultiBracketDoc = parseMarkdownToVisualDoc(nestedMultiBracket);
		expect(nestedMultiBracketDoc.textContent).toBe("a[b][c][d]e");
		const firstCloseBracket = selectRenderedSubstring(
			nestedMultiBracketDoc,
			nestedMultiBracket,
			"]",
			0,
		);
		expect(firstCloseBracket).toMatchObject({ end: 9, slice: "]", start: 8 });
		expect(
			nestedMultiBracket.slice(0, firstCloseBracket.start) +
				nestedMultiBracket.slice(firstCloseBracket.end),
		).toBe("[a[**b**[c][d]e](https://a.test)");
		expect(
			selectRenderedSubstring(nestedMultiBracketDoc, nestedMultiBracket, "[c]"),
		).toMatchObject({ end: 12, slice: "[c]", start: 9 });
		expect(
			selectRenderedSubstring(nestedMultiBracketDoc, nestedMultiBracket, "[d]"),
		).toMatchObject({ end: 15, slice: "[d]", start: 12 });
		expect(
			selectRenderedSubstring(nestedMultiBracketDoc, nestedMultiBracket, "e"),
		).toMatchObject({ end: 16, slice: "e", start: 15 });
		// Round-trip `[8, 9)` back to ProseMirror selection over first `]`.
		const restoredCloseBracket = resolveMarkdownSelectionToVisualSelection(
			nestedMultiBracketDoc,
			nestedMultiBracket,
			{ direction: "forward", end: 9, start: 8 },
		);
		expect({
			from: restoredCloseBracket.from,
			to: restoredCloseBracket.to,
		}).toEqual({ from: 4, to: 5 });

		// Same nested brackets without emphasis (`findNonCodeUnit` path).
		const plainNestedBrackets = "[a[b][c][d]e](https://a.test)";
		const plainNestedDoc = parseMarkdownToVisualDoc(plainNestedBrackets);
		expect(plainNestedDoc.textContent).toBe("a[b][c][d]e");
		expect(
			selectRenderedSubstring(plainNestedDoc, plainNestedBrackets, "]", 0),
		).toMatchObject({ end: 5, slice: "]", start: 4 });
		expect(
			selectRenderedSubstring(plainNestedDoc, plainNestedBrackets, "[c]"),
		).toMatchObject({ end: 8, slice: "[c]", start: 5 });
		expect(
			selectRenderedSubstring(plainNestedDoc, plainNestedBrackets, "[d]"),
		).toMatchObject({ end: 11, slice: "[d]", start: 8 });
		expect(
			selectRenderedSubstring(plainNestedDoc, plainNestedBrackets, "e"),
		).toMatchObject({ end: 12, slice: "e", start: 11 });

		// Reference link with nested literal brackets when definition is in another block.
		const nestedRefLink = "[a[**b**][c][d]e][ref]\n\n[ref]: https://a.test";
		const nestedRefDoc = parseMarkdownToVisualDoc(nestedRefLink);
		expect(nestedRefDoc.textContent).toBe("a[b][c][d]e");
		expect(
			selectRenderedSubstring(nestedRefDoc, nestedRefLink, "]", 0),
		).toMatchObject({ end: 9, slice: "]", start: 8 });
		expect(
			selectRenderedSubstring(nestedRefDoc, nestedRefLink, "[c]"),
		).toMatchObject({ end: 12, slice: "[c]", start: 9 });
		expect(
			selectRenderedSubstring(nestedRefDoc, nestedRefLink, "[d]"),
		).toMatchObject({ end: 15, slice: "[d]", start: 12 });
		expect(
			selectRenderedSubstring(nestedRefDoc, nestedRefLink, "e"),
		).toMatchObject({ end: 16, slice: "e", start: 15 });

		// Single link with nested brackets followed by a second equal-URL link.
		const nestedThenSecond = "[a[**b**]c](https://a.test)[d](https://a.test)";
		const nestedThenSecondDoc = parseMarkdownToVisualDoc(nestedThenSecond);
		expect(nestedThenSecondDoc.textContent).toBe("a[b]cd");
		expect(
			selectRenderedSubstring(nestedThenSecondDoc, nestedThenSecond, "]"),
		).toMatchObject({ end: 9, slice: "]", start: 8 });
		expect(
			selectRenderedSubstring(nestedThenSecondDoc, nestedThenSecond, "c"),
		).toMatchObject({ end: 10, slice: "c", start: 9 });
		expect(
			selectRenderedSubstring(nestedThenSecondDoc, nestedThenSecond, "d"),
		).toMatchObject({ end: 29, slice: "d", start: 28 });
		expect(
			selectRenderedSubstring(nestedThenSecondDoc, nestedThenSecond, "cd"),
		).toMatchObject({ end: 29, slice: "c](https://a.test)[d", start: 9 });

		// Nested `]` immediately before outer closing `]` followed by equal-URL link.
		const adjacentCloseBrackets = "[a[**b**]](https://a.test)[c](https://a.test)";
		const adjacentCloseDoc = parseMarkdownToVisualDoc(adjacentCloseBrackets);
		expect(adjacentCloseDoc.textContent).toBe("a[b]c");
		expect(
			selectRenderedSubstring(adjacentCloseDoc, adjacentCloseBrackets, "]"),
		).toMatchObject({ end: 9, slice: "]", start: 8 });
		expect(
			selectRenderedSubstring(adjacentCloseDoc, adjacentCloseBrackets, "c"),
		).toMatchObject({ end: 28, slice: "c", start: 27 });

		// Adjacent equal-URL reference links with nested brackets in link 1.
		const adjacentNestedRefs =
			"[a[**b**]c][ref][d][ref]\n\n[ref]: https://a.test";
		const adjacentNestedRefsDoc = parseMarkdownToVisualDoc(adjacentNestedRefs);
		expect(adjacentNestedRefsDoc.textContent).toBe("a[b]cd");
		expect(
			selectRenderedSubstring(adjacentNestedRefsDoc, adjacentNestedRefs, "]"),
		).toMatchObject({ end: 9, slice: "]", start: 8 });
		expect(
			selectRenderedSubstring(adjacentNestedRefsDoc, adjacentNestedRefs, "c"),
		).toMatchObject({ end: 10, slice: "c", start: 9 });
		expect(
			selectRenderedSubstring(adjacentNestedRefsDoc, adjacentNestedRefs, "d"),
		).toMatchObject({ end: 18, slice: "d", start: 17 });

		// Three consecutive equal-URL links where link 2 contains nested brackets.
		const tripleLinks =
			"[a](https://a.test)[b[c][d]e](https://a.test)[f](https://a.test)";
		const tripleDoc = parseMarkdownToVisualDoc(tripleLinks);
		expect(tripleDoc.textContent).toBe("ab[c][d]ef");
		expect(
			selectRenderedSubstring(tripleDoc, tripleLinks, "]", 0),
		).toMatchObject({ end: 24, slice: "]", start: 23 });
		expect(
			selectRenderedSubstring(tripleDoc, tripleLinks, "[d]"),
		).toMatchObject({ end: 27, slice: "[d]", start: 24 });
		expect(
			selectRenderedSubstring(tripleDoc, tripleLinks, "f"),
		).toMatchObject({ end: 47, slice: "f", start: 46 });

		// Code-span brackets and escaped brackets inside link followed by equal-URL link.
		const codeBracketLinks = "[a`[`b](https://a.test)[c](https://a.test)";
		const codeBracketDoc = parseMarkdownToVisualDoc(codeBracketLinks);
		expect(codeBracketDoc.textContent).toBe("a[bc");
		expect(
			selectRenderedSubstring(codeBracketDoc, codeBracketLinks, "["),
		).toMatchObject({ end: 4, slice: "[", start: 3 });
		expect(
			selectRenderedSubstring(codeBracketDoc, codeBracketLinks, "c"),
		).toMatchObject({ end: 25, slice: "c", start: 24 });

		const escapedBracketLinks = "[a\\]b](https://a.test)[c](https://a.test)";
		const escapedBracketDoc = parseMarkdownToVisualDoc(escapedBracketLinks);
		expect(escapedBracketDoc.textContent).toBe("a]bc");
		expect(
			selectRenderedSubstring(escapedBracketDoc, escapedBracketLinks, "]"),
		).toMatchObject({ end: 4, slice: "\\]", start: 2 });
		expect(
			selectRenderedSubstring(escapedBracketDoc, escapedBracketLinks, "c"),
		).toMatchObject({ end: 24, slice: "c", start: 23 });

		// Protected math atoms with unbalanced `[` or `]` inside link followed by equal-URL link.
		for (const [mathBracketLinks, expectedStart] of [
			["[a $[0, 1)$ b](https://a.test)[c](https://a.test)", 31],
			["[a $x]$ b](https://a.test)[c](https://a.test)", 27],
		] as const) {
			const mathBracketDoc = parseMarkdownToVisualDoc(mathBracketLinks);
			const paragraph = mathBracketDoc.firstChild;
			if (!paragraph) throw new Error("Expected paragraph");
			const pmEnd = 1 + paragraph.content.size;
			const mappedC = computeVisualSelectionToMarkdownSelection(
				mathBracketDoc,
				TextSelection.create(mathBracketDoc, pmEnd - 1, pmEnd),
				mathBracketLinks,
			);
			expect({
				end: mappedC.end,
				slice: mathBracketLinks.slice(mappedC.start, mappedC.end),
				start: mappedC.start,
			}).toMatchObject({ end: expectedStart + 1, slice: "c", start: expectedStart });
		}

		// Lazy Lezer parse: zero calls on non-link blocks, one call on a link block.
		const parseSpy = vi.spyOn(markdownLanguage.parser, "parse");
		try {
			const plainMd = "plain **bold** and `code` text";
			const plainDoc = parseMarkdownToVisualDoc(plainMd);
			selectRenderedSubstring(plainDoc, plainMd, "bold");
			expect(parseSpy).not.toHaveBeenCalled();

			const linkMd = "[a](https://a.test)[b](https://a.test)";
			const linkDoc = parseMarkdownToVisualDoc(linkMd);
			selectRenderedSubstring(linkDoc, linkMd, "b");
			expect(parseSpy).toHaveBeenCalledTimes(1);
		} finally {
			parseSpy.mockRestore();
		}
	});

	it("maps NodeSelection and atom ranges for multiline protected_inline atoms across container prefixes (R38B #1)", () => {
		const findInlineAtoms = (
			doc: ProseMirrorNode,
		): Array<Readonly<{ kind: string; pos: number }>> => {
			const atoms: Array<Readonly<{ kind: string; pos: number }>> = [];
			doc.descendants((node, pos) => {
				if (node.type.name === "protected_inline") {
					atoms.push({ kind: String(node.attrs.kind), pos });
				}
			});
			return atoms;
		};

		const cases: ReadonlyArray<
			Readonly<{
				expectedMath: Readonly<{ end: number; slice: string; start: number }>;
				expectedRaw: Readonly<{ end: number; slice: string; start: number }>;
				markdown: string;
			}>
		> = [
			{
				expectedMath: { end: 44, slice: "$z$", start: 41 },
				expectedRaw: {
					end: 36,
					slice: '<span\n>  title="$x$">text</span>',
					start: 4,
				},
				markdown: '> A <span\n>  title="$x$">text</span> and $z$',
			},
			{
				expectedMath: { end: 40, slice: "$z$", start: 37 },
				expectedRaw: {
					end: 36,
					slice: '<span\n>  title="$z$">text</span>',
					start: 4,
				},
				markdown: '> A <span\n>  title="$z$">text</span> $z$',
			},
			{
				expectedMath: { end: 24, slice: "$z$", start: 21 },
				expectedRaw: {
					end: 20,
					slice: "<!--\n> $z$\n> -->",
					start: 4,
				},
				markdown: "> A <!--\n> $z$\n> --> $z$",
			},
			{
				expectedMath: { end: 39, slice: "$z$", start: 36 },
				expectedRaw: {
					end: 35,
					slice: '<span\n  title="$z$">text</span>',
					start: 4,
				},
				markdown: '- A <span\n  title="$z$">text</span> $z$',
			},
			{
				expectedMath: { end: 44, slice: "$z$", start: 41 },
				expectedRaw: {
					end: 40,
					slice: '<span\n  >  title="$z$">text</span>',
					start: 6,
				},
				markdown: '- > A <span\n  >  title="$z$">text</span> $z$',
			},
			{
				expectedMath: { end: 46, slice: "$z$", start: 43 },
				expectedRaw: {
					end: 38,
					slice: '<span\n>\t  >title="$x$">text</span>',
					start: 4,
				},
				markdown: '> A <span\n>\t  >title="$x$">text</span> and $z$',
			},
		];

		for (const item of cases) {
			const doc = parseMarkdownToVisualDoc(item.markdown);
			const index = createVisualSourceIndex(doc, item.markdown);
			const atoms = findInlineAtoms(doc);
			expect(atoms.map((atom) => atom.kind)).toEqual([
				"raw-inline",
				"math-inline",
			]);
			const rawAtom = atoms[0];
			const mathAtom = atoms[1];
			if (!rawAtom || !mathAtom) throw new Error("Expected raw and math atoms");

			const rawSel = computeVisualSelectionToMarkdownSelection(
				doc,
				NodeSelection.create(doc, rawAtom.pos),
				item.markdown,
				index,
			);
			expect({
				end: rawSel.end,
				slice: item.markdown.slice(rawSel.start, rawSel.end),
				start: rawSel.start,
			}).toEqual(item.expectedRaw);
			expect(findAtomSourceRange(index, rawAtom.pos)).toEqual({
				end: item.expectedRaw.end,
				start: item.expectedRaw.start,
			});

			const mathSel = computeVisualSelectionToMarkdownSelection(
				doc,
				NodeSelection.create(doc, mathAtom.pos),
				item.markdown,
				index,
			);
			expect({
				end: mathSel.end,
				slice: item.markdown.slice(mathSel.start, mathSel.end),
				start: mathSel.start,
			}).toEqual(item.expectedMath);
			expect(findAtomSourceRange(index, mathAtom.pos)).toEqual({
				end: item.expectedMath.end,
				start: item.expectedMath.start,
			});
		}

		// Link containing a multiline raw-inline atom with `]` in attribute maps trailing text accurately.
		const linkWithMultilineRaw =
			'> [a <span\n>  title="]">b</span>](https://a.test)[c](https://a.test)';
		const linkDoc = parseMarkdownToVisualDoc(linkWithMultilineRaw);
		const bqPara = linkDoc.firstChild?.firstChild;
		if (!bqPara) throw new Error("Expected blockquote paragraph");
		const pmEnd = 2 + bqPara.content.size;
		const mappedC = computeVisualSelectionToMarkdownSelection(
			linkDoc,
			TextSelection.create(linkDoc, pmEnd - 1, pmEnd),
			linkWithMultilineRaw,
		);
		expect(linkWithMultilineRaw.slice(mappedC.start, mappedC.end)).toBe("c");
		expect(mappedC.start).toBe(linkWithMultilineRaw.indexOf("[c]") + 1);

		// R39B Polish #1: repeated `firstLine` inside code spans before a multiline atom scales linearly.
		for (const count of [500, 1000, 2000]) {
			const md = `${"`<span\nfoo` ".repeat(count)}<span\ntitle="$x$">text</span> and $z$`;
			const doc = parseMarkdownToVisualDoc(md);
			const t0 = performance.now();
			const idx = createVisualSourceIndex(doc, md);
			const atoms = findInlineAtoms(doc);
			const rawAtom = atoms.find((atom) => atom.kind === "raw-inline");
			expect(rawAtom).toBeDefined();
			const range = rawAtom ? findAtomSourceRange(idx, rawAtom.pos) : null;
			const elapsed = performance.now() - t0;
			expect(elapsed).toBeLessThan(100);
			expect(range).not.toBeNull();
			expect(range ? md.slice(range.start, range.end) : "").toBe(
				'<span\ntitle="$x$">text</span>',
			);
		}

		// R40A #4: repeated multiline atoms with ZERO backticks scale strictly linearly.
		const runZeroBacktickAtoms = (count: number): number => {
			const md = `Start${' <span\ntitle="x">body</span> '.repeat(count)}end`;
			const doc = parseMarkdownToVisualDoc(md);
			const t0 = performance.now();
			const idx = createVisualSourceIndex(doc, md);
			const elapsed = performance.now() - t0;
			const atoms = findInlineAtoms(doc);
			expect(atoms).toHaveLength(count);
			const lastAtom = atoms[atoms.length - 1];
			const lastRange = lastAtom ? findAtomSourceRange(idx, lastAtom.pos) : null;
			expect(lastRange ? md.slice(lastRange.start, lastRange.end) : "").toBe(
				'<span\ntitle="x">body</span>',
			);
			return elapsed;
		};
		const t2000 = runZeroBacktickAtoms(2000);
		const t4000 = runZeroBacktickAtoms(4000);
		expect(t4000).toBeLessThan(200);
		expect(t4000).toBeLessThan(Math.max(t2000 * 3.5, 40));
	});
});
