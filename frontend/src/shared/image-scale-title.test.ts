import { describe, expect, it } from "vitest";
import {
	COMMONMARK_ESCAPABLE_PUNCTUATION,
	decodeCommonMarkTitle,
	decodeWpKsesRenderedTitle,
	hasMarkdownTitleBlankLine,
	parseEffectiveImageScaleTitle,
	parseImageScaleTitleContract,
	stripTrailingReservedScaleMarkers,
	unescapeCommonMarkAsciiPunctuation,
} from "./image-scale-title";

describe("shared image-scale title grammar", () => {
	it("decodes CommonMark escapes then strict HTML5 entities to match PHP RegexHelper::unescape 1:1", () => {
		expect(decodeCommonMarkTitle(String.raw`\&amp;`)).toBe("&");
		expect(decodeCommonMarkTitle(String.raw`\\&amp;`)).toBe("\\&");
		expect(decodeCommonMarkTitle(String.raw`Caption {width=33%}\&#32;`)).toBe(
			"Caption {width=33%} ",
		);
		expect(decodeCommonMarkTitle("&#32;")).toBe(" ");
		expect(decodeCommonMarkTitle("&Tab;")).toBe("\t");
		expect(decodeCommonMarkTitle("&NewLine;")).toBe("\n");
		expect(decodeCommonMarkTitle("&#10;")).toBe("\n");
		expect(decodeCommonMarkTitle("&#13;")).toBe("\r");
		expect(decodeCommonMarkTitle("&#123;width=33%&#125;")).toBe("{width=33%}");
		expect(decodeCommonMarkTitle(String.raw`\{width=33%\}`)).toBe("{width=33%}");
		expect(decodeCommonMarkTitle(String.raw`Caption \{width=33%\}`)).toBe(
			"Caption {width=33%}",
		);
		expect(decodeCommonMarkTitle("Caption &notanentity; &amp")).toBe(
			"Caption &notanentity; &amp",
		);
		expect(decodeCommonMarkTitle("Caption &#0; &#x0;")).toBe(
			"Caption \uFFFD \uFFFD",
		);
		expect(decodeCommonMarkTitle(String.raw`Caption\&#32;{width=50%}`)).toBe(
			"Caption {width=50%}",
		);
		expect(
			decodeCommonMarkTitle(String.raw`Caption \&#123;width=50%&#125;`),
		).toBe("Caption {width=50%}");
		expect(decodeCommonMarkTitle("Caption &amp;#123;width=50%&#125;")).toBe(
			"Caption &#123;width=50%}",
		);
		expect(
			decodeCommonMarkTitle(
				String.raw`Caption {width=33%}\&NewLine; {width=67%}`,
			),
		).toBe("Caption {width=33%}\n {width=67%}");
	});

	it("matches PHP League\\CommonMark\\Util\\Html5EntityDecoder numeric entity decoding rules", () => {
		// PHP mb_decode_numericentity decodes 0x80..0x9F to literal C1 code points,
		// NOT Windows-1252 remapped characters like `€` (U+20AC) or `Ÿ` (U+0178).
		expect(decodeCommonMarkTitle("&#128;")).toBe("\u0080");
		expect(decodeCommonMarkTitle("&#x80;")).toBe("\u0080");
		expect(decodeCommonMarkTitle("&#X80;")).toBe("\u0080");
		expect(decodeCommonMarkTitle("&#159;")).toBe("\u009F");
		expect(decodeCommonMarkTitle("&#x9f;")).toBe("\u009F");
		expect(decodeCommonMarkTitle("&#128;")).not.toBe("€");
		expect(decodeCommonMarkTitle("&#159;")).not.toBe("Ÿ");

		// Plane 0–2 bounds (1..0x2FFFF), zero, >0x2FFFF, and surrogates.
		expect(decodeCommonMarkTitle("&#0;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#x0;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#x00;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#x000;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#X00;")).toBe("\uFFFD");
		// Zero-padded decimal zeros (&#00;, &#000;, ... up to 7 digits):
		// PHP Html5EntityDecoder::fromDecimal() sees empty("00") === false -> NUL,
		// which WordPress wp_kses_no_null() strips to "" before scale parsing.
		expect(decodeCommonMarkTitle("&#00;")).toBe("");
		expect(decodeCommonMarkTitle("&#000;")).toBe("");
		expect(decodeCommonMarkTitle("&#0000000;")).toBe("");
		// 8 decimal digits exceed CommonMark §6.2 entity grammar (1..7 digits).
		expect(decodeCommonMarkTitle("&#00000000;")).toBe("&#00000000;");
		// Non-zero zero-padded decimal entities still decode normally.
		expect(decodeCommonMarkTitle("&#01;")).toBe("\u0001");
		expect(decodeCommonMarkTitle("&#0032;")).toBe(" ");
		expect(decodeCommonMarkTitle("a&#000;b")).toBe("ab");
		expect(decodeCommonMarkTitle("&#x2FFFF;")).toBe(
			String.fromCodePoint(0x2ffff),
		);
		expect(decodeCommonMarkTitle("&#x30000;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#x10FFFF;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#xD7FF;")).toBe("\uD7FF");
		expect(decodeCommonMarkTitle("&#xD800;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#xDFFF;")).toBe("\uFFFD");
		expect(decodeCommonMarkTitle("&#xE000;")).toBe("\uE000");

		// PHP MarkdownRenderer::render() + WordPress wp_kses_no_null() parity for
		// zero-padded decimal zero vs single-digit and hex zero scale titles.
		expect(parseEffectiveImageScaleTitle("&#0;{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("&#x00;{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("&#x000;{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("&#00;{width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 0,
			scale: 50,
			status: "valid",
			title: null,
		});
		expect(parseEffectiveImageScaleTitle("&#000;{width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 0,
			scale: 50,
			status: "valid",
			title: null,
		});
		expect(parseEffectiveImageScaleTitle("&#0000000;{width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 0,
			scale: 50,
			status: "valid",
			title: null,
		});
		expect(parseEffectiveImageScaleTitle("&#00000000;{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("a&#000;b")).toEqual({
			status: "none",
		});
		expect(parseEffectiveImageScaleTitle("Caption&#000;{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("Caption &#000; {width=50%}")).toEqual(
			{
				markerLength: 11,
				markerOffset: 9,
				scale: 50,
				status: "valid",
				title: "Caption ",
			},
		);
		expect(
			parseEffectiveImageScaleTitle("Caption {width=33%}&#00; {width=50%}"),
		).toEqual({
			status: "invalid",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption {width=33%}&#00;"),
		).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 33,
			status: "valid",
			title: "Caption",
		});

		// Standard numeric and named entities continue to match PHP 1:1.
		expect(decodeCommonMarkTitle("&#32;")).toBe(" ");
		expect(decodeCommonMarkTitle("&#10;")).toBe("\n");
		expect(decodeCommonMarkTitle("&#13;")).toBe("\r");
		expect(decodeCommonMarkTitle("&NewLine;")).toBe("\n");
		expect(decodeCommonMarkTitle("&amp;")).toBe("&");
		expect(parseEffectiveImageScaleTitle("&#128; {width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 2,
			scale: 50,
			status: "valid",
			title: "\u0080",
		});
	});

	it("unescapes all 32 CommonMark §2.4 ASCII punctuation characters without decoding entities", () => {
		const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
		expect(punctuation).toHaveLength(32);
		for (const ch of punctuation) {
			expect(COMMONMARK_ESCAPABLE_PUNCTUATION.test(ch), ch).toBe(true);
			expect(unescapeCommonMarkAsciiPunctuation(`\\${ch}`), ch).toBe(ch);
		}
		expect(unescapeCommonMarkAsciiPunctuation(String.raw`/foo\/bar\?x\=1&amp;`)).toBe(
			"/foo/bar?x=1&amp;",
		);
		expect(unescapeCommonMarkAsciiPunctuation(String.raw`\a\0\ `)).toBe(
			String.raw`\a\0\ `,
		);
	});

	it("detects blank lines inside Markdown titles per CommonMark §6.3", () => {
		expect(hasMarkdownTitleBlankLine("Line1\n\nLine2")).toBe(true);
		expect(hasMarkdownTitleBlankLine("Line1\r\n \t \r\nLine2")).toBe(true);
		expect(hasMarkdownTitleBlankLine("Line1\r\rLine2")).toBe(true);
		expect(hasMarkdownTitleBlankLine("Line1\nLine2")).toBe(false);
		expect(hasMarkdownTitleBlankLine("Line1\r\nLine2")).toBe(false);
		expect(hasMarkdownTitleBlankLine("Caption\r\n {width=50%}")).toBe(false);
		expect(hasMarkdownTitleBlankLine("Line1&#10;&#10;Line2")).toBe(false);
	});

	it("evaluates effective titles with exact PHP league/commonmark and DOMDocument parity", () => {
		expect(
			parseEffectiveImageScaleTitle(String.raw`Caption {width=33%}\&#32;`),
		).toEqual({ status: "none" });
		expect(
			parseEffectiveImageScaleTitle(
				String.raw`Caption {width=33%}\&#32; {width=100%}`,
			),
		).toEqual({ status: "invalid" });

		expect(
			parseEffectiveImageScaleTitle("Caption {width=33%}&NewLine; {width=67%}"),
		).toEqual({
			markerLength: 11,
			markerOffset: 21,
			scale: 67,
			status: "valid",
			title: "Caption {width=33%}\n",
		});

		expect(parseEffectiveImageScaleTitle("Caption&#10;{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption&NewLine;{width=50%}"),
		).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("Caption&#13;{width=50%}")).toEqual({
			status: "invalid",
		});

		expect(parseEffectiveImageScaleTitle("Caption\n {width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("Caption\r\n {width=50%}")).toEqual({
			status: "invalid",
		});

		expect(parseEffectiveImageScaleTitle("Caption&#10; {width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 9,
			scale: 50,
			status: "valid",
			title: "Caption\n",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption\n  Line2 {width=50%}"),
		).toEqual({
			markerLength: 11,
			markerOffset: 14,
			scale: 50,
			status: "valid",
			title: "Caption\nLine2",
		});
	});

	it("parses terminal image-scale markers with PHP parity", () => {
		expect(parseImageScaleTitleContract("Caption")).toEqual({ status: "none" });
		expect(parseImageScaleTitleContract("Caption {width=33%} ")).toEqual({
			status: "none",
		});
		expect(parseImageScaleTitleContract("{width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 0,
			scale: 50,
			status: "valid",
			title: null,
		});
		expect(parseImageScaleTitleContract(" {width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 1,
			scale: 50,
			status: "valid",
			title: "",
		});
		expect(parseImageScaleTitleContract("Photo {width=67%}")).toEqual({
			markerLength: 11,
			markerOffset: 6,
			scale: 67,
			status: "valid",
			title: "Photo",
		});
		expect(parseImageScaleTitleContract("Photo {width=51%}")).toEqual({
			status: "invalid",
		});
		expect(parseImageScaleTitleContract("Photo{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(
			parseImageScaleTitleContract("Photo {width=33%} {width=50%}"),
		).toEqual({ status: "invalid" });
		expect(
			parseImageScaleTitleContract("Photo {width=33%} \t {width=50%}"),
		).toEqual({ status: "invalid" });
	});

	it("strips trailing reserved markers without mutating trailing whitespace or nonterminal text", () => {
		// Unscaled (`stripWhitespacePaddedTrailingMarker === false`):
		expect(stripTrailingReservedScaleMarkers("Caption {width=33%} ", false)).toBe(
			"Caption {width=33%} ",
		);
		expect(
			stripTrailingReservedScaleMarkers("Caption {width=33%}\n", false),
		).toBe("Caption {width=33%}\n");
		expect(stripTrailingReservedScaleMarkers("Caption   ", false)).toBe(
			"Caption   ",
		);
		expect(stripTrailingReservedScaleMarkers("Photo {width=42%}", false)).toBe(
			"Photo",
		);
		expect(
			stripTrailingReservedScaleMarkers("Photo {width=50%} {width=67%}", false),
		).toBe("Photo");
		expect(
			stripTrailingReservedScaleMarkers(
				"Syntax {width=33%} example {width=42%}",
				false,
			),
		).toBe("Syntax {width=33%} example");

		// Scaled (`stripWhitespacePaddedTrailingMarker === true`):
		expect(stripTrailingReservedScaleMarkers("Caption   ", true)).toBe(
			"Caption   ",
		);
		expect(stripTrailingReservedScaleMarkers("See {width=foo}", true)).toBe(
			"See",
		);
		expect(stripTrailingReservedScaleMarkers("Caption {width=33%} ", true)).toBe(
			"Caption",
		);
		expect(
			stripTrailingReservedScaleMarkers("Caption {width=33%}\n", true),
		).toBe("Caption");
		expect(
			stripTrailingReservedScaleMarkers(
				"Syntax {width=33%} example {width=42%}  ",
				true,
			),
		).toBe("Syntax {width=33%} example");
	});

	it("projects titles through WP Core wp_kses_no_null() and wp_kses_normalize_entities() parity", () => {
		// Direct decodeWpKsesRenderedTitle checks.
		expect(decodeWpKsesRenderedTitle("Caption {width=50%}\x01\x07\x1F")).toBe(
			"Caption {width=50%}",
		);
		expect(decodeWpKsesRenderedTitle("Keep\t\n\rControls\x0B\x0C")).toBe(
			"Keep\t\n\rControls",
		);
		expect(decodeWpKsesRenderedTitle("Caption &#123;width=50%&#125;")).toBe(
			"Caption {width=50%}",
		);
		expect(
			decodeWpKsesRenderedTitle("Caption &#00000123;width=50%&#00000125;"),
		).toBe("Caption {width=50%}");
		expect(decodeWpKsesRenderedTitle("Caption &#x7b;width=50%&#x7d;")).toBe(
			"Caption {width=50%}",
		);
		expect(decodeWpKsesRenderedTitle("Caption &#x0000007b;width=50%&#x0000007d;")).toBe(
			"Caption {width=50%}",
		);
		// Single-digit zero entities return "" (PHP empty('0') === true), whereas
		// multi-zero entities fail valid_unicode(0) and stay literal.
		expect(decodeWpKsesRenderedTitle("Caption {width=50%}&#0;")).toBe(
			"Caption {width=50%}",
		);
		expect(decodeWpKsesRenderedTitle("Caption {width=50%}&#x0;")).toBe(
			"Caption {width=50%}",
		);
		expect(decodeWpKsesRenderedTitle("Caption {width=50%}&#X0;")).toBe(
			"Caption {width=50%}",
		);
		expect(decodeWpKsesRenderedTitle("Caption {width=50%}&#00;")).toBe(
			"Caption {width=50%}&#00;",
		);
		expect(decodeWpKsesRenderedTitle("Caption {width=50%}&#x00;")).toBe(
			"Caption {width=50%}&#x00;",
		);
		// Out-of-range / disallowed code points stay literal.
		expect(decodeWpKsesRenderedTitle("&#1; &#xD800; &#xFFFE; &#xFFFF; &#1114112;")).toBe(
			"&#1; &#xD800; &#xFFFE; &#xFFFF; &#1114112;",
		);
		expect(decodeWpKsesRenderedTitle("&#1114111;")).toBe(
			String.fromCodePoint(0x10ffff),
		);
		// Already double-escaped &amp;#123; is NOT decoded further.
		expect(decodeWpKsesRenderedTitle("Caption &amp;#123;width=50%&amp;#125;")).toBe(
			"Caption &amp;#123;width=50%&amp;#125;",
		);

		// Effective scale parsing matches real PHP MarkdownRenderer::render() + WP KSES.
		expect(parseEffectiveImageScaleTitle("Caption {width=50%}&#1;")).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(parseEffectiveImageScaleTitle("Caption {width=51%}&#1;")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("Caption {width=50&#1;%}")).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(parseEffectiveImageScaleTitle("Caption {width=50%}\x07")).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption &amp;#123;width=50%&amp;#125;"),
		).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption &amp;#123;width=51%&amp;#125;"),
		).toEqual({
			status: "invalid",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption &#00000123;width=50%&#00000125;"),
		).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption {width=50%}&amp;#0;"),
		).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption {width=50%}&amp;#x0;"),
		).toEqual({
			markerLength: 11,
			markerOffset: 8,
			scale: 50,
			status: "valid",
			title: "Caption",
		});
		expect(
			parseEffectiveImageScaleTitle("Caption {width=50%}&amp;#00;"),
		).toEqual({
			status: "none",
		});
		expect(
			parseEffectiveImageScaleTitle(
				"Caption &amp;amp;#123;width=50%&amp;amp;#125;",
			),
		).toEqual({
			status: "none",
		});
	});

	it("normalizes raw Markdown U+0000 to U+FFFD per CommonMark §2.3 before entity decoding while keeping entity-decoded &#000; NUL stripping (Track A #7)", () => {
		expect(decodeCommonMarkTitle("\u0000{width=50%}")).toBe(
			"\uFFFD{width=50%}",
		);
		expect(decodeCommonMarkTitle("{width=50%}\u0000")).toBe(
			"{width=50%}\uFFFD",
		);
		expect(decodeCommonMarkTitle("Caption \u0000{width=50%}")).toBe(
			"Caption \uFFFD{width=50%}",
		);
		expect(decodeCommonMarkTitle("&#000;{width=50%}")).toBe("{width=50%}");

		// Matches PHP MarkdownRenderer::render() + WP KSES:
		// raw NUL becomes U+FFFD before scale parsing -> invalid/none, while
		// entity-decoded `&#000;` produces NUL after §2.3 -> stripped by wp_kses_no_null.
		expect(parseEffectiveImageScaleTitle("\u0000{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("{width=50%}\u0000")).toEqual({
			status: "none",
		});
		expect(parseEffectiveImageScaleTitle("Caption \u0000{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("{width=50\u0000%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("\\\u0000{width=50%}")).toEqual({
			status: "invalid",
		});
		expect(parseEffectiveImageScaleTitle("\u0000 {width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 2,
			scale: 50,
			status: "valid",
			title: "\uFFFD",
		});
		expect(parseEffectiveImageScaleTitle("&#000;{width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 0,
			scale: 50,
			status: "valid",
			title: null,
		});
		expect(parseEffectiveImageScaleTitle("&#00;{width=50%}")).toEqual({
			markerLength: 11,
			markerOffset: 0,
			scale: 50,
			status: "valid",
			title: null,
		});
	});
});
