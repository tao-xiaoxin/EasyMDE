import { describe, expect, it } from "vitest";
import {
	decodeCommonMarkTitle,
	normalizeHtmlAttributeTitle,
	parseImageScaleTitleContract,
	stripTrailingReservedScaleMarkers,
} from "./image-scale-title";

describe("shared image-scale title grammar", () => {
	it("decodes CommonMark escapes and strict HTML5 entities without double-decoding escaped ampersands", () => {
		expect(decodeCommonMarkTitle(String.raw`\&amp;`)).toBe("&amp;");
		expect(decodeCommonMarkTitle(String.raw`\\&amp;`)).toBe("\\&");
		expect(decodeCommonMarkTitle("&#32;")).toBe(" ");
		expect(decodeCommonMarkTitle("&Tab;")).toBe("\t");
		expect(decodeCommonMarkTitle("&#123;width=33%&#125;")).toBe("{width=33%}");
		expect(decodeCommonMarkTitle(String.raw`\{width=33%\}`)).toBe("{width=33%}");
		expect(decodeCommonMarkTitle(String.raw`Caption \{width=33%\}`)).toBe(
			"Caption {width=33%}",
		);
		expect(decodeCommonMarkTitle("Caption &notanentity; &amp")).toBe(
			"Caption &notanentity; &amp",
		);
	});

	it("normalizes CRLF, CR, and LF to spaces", () => {
		expect(normalizeHtmlAttributeTitle("a\r\nb\rc\nd")).toBe("a b c d");
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
