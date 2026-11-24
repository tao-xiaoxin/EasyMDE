import { describe, expect, it } from "vitest";
import {
	decodeCommonMarkTitle,
	hasMarkdownTitleBlankLine,
	parseEffectiveImageScaleTitle,
	parseImageScaleTitleContract,
	stripTrailingReservedScaleMarkers,
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
});
