import { decodeHTMLStrict } from "entities";

/**
 * Canonical image-scale title grammar shared across source editing, context
 * menu actions, and immersive visual parsing/serialization. Mirrors PHP
 * `EasyMDE\Content\MarkdownRenderer::parse_image_scale_title()` 1:1.
 */
export const IMAGE_SCALE_PERCENTAGES = [
	25, 33, 50, 67, 100, 150, 200,
] as const;

export type ImageScalePercentage = (typeof IMAGE_SCALE_PERCENTAGES)[number];

export const TERMINAL_IMAGE_SCALE_MARKER = /\{width=[^{}]*\}$/u;
export const VALID_IMAGE_SCALE_MARKER =
	/^\{width=(25|33|50|67|100|150|200)%\}$/u;
export const REPEATED_TERMINAL_IMAGE_SCALE_MARKER =
	/\{width=[^{}]*\}[ \t]*$/u;

export type ParsedImageScaleTitleContract =
	| Readonly<{ status: "none" }>
	| Readonly<{ status: "invalid" }>
	| Readonly<{
			markerLength: number;
			markerOffset: number;
			scale: ImageScalePercentage;
			status: "valid";
			title: string | null;
	  }>;

// CommonMark §2.4 32-character ASCII punctuation class and §6.2 strict HTML5
// entity pattern matching PHP `League\CommonMark\Util\RegexHelper`.
export const COMMONMARK_ESCAPABLE_PUNCTUATION =
	/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/u;
const COMMONMARK_ESCAPED_PUNCTUATION =
	/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/gu;
const COMMONMARK_HTML_ENTITY =
	/&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/giu;
const NORMALIZED_TITLE_BLANK_LINE = /\n[ \t]*\n/u;

/**
 * Unescapes CommonMark §2.4 backslash-escaped ASCII punctuation without
 * decoding HTML entities.
 */
export function unescapeCommonMarkAsciiPunctuation(value: string): string {
	return value.includes("\\")
		? value.replace(COMMONMARK_ESCAPED_PUNCTUATION, "$1")
		: value;
}

function isAsciiWhitespace(character: string | undefined): boolean {
	return (
		" " === character ||
		"\t" === character ||
		"\r" === character ||
		"\n" === character
	);
}

/**
 * Reports whether a raw Markdown title body contains a blank line, which
 * terminates a link/image title under CommonMark §6.3.
 */
export function hasMarkdownTitleBlankLine(title: string): boolean {
	if (!title.includes("\n") && !title.includes("\r")) {
		return false;
	}
	return NORMALIZED_TITLE_BLANK_LINE.test(title.replace(/\r\n|\r/gu, "\n"));
}

/**
 * Decodes one CommonMark §6.2 HTML entity matching PHP
 * `League\CommonMark\Util\Html5EntityDecoder::decode()` plus WordPress
 * `wp_kses_no_null()` NUL stripping before `MarkdownRenderer::parse_image_scale_title()`.
 *
 * Numeric references decode directly as Unicode scalar values in planes 0–2
 * (`1..0x2FFFF`, excluding surrogates, without browser Windows-1252 remapping
 * for `0x80..0x9F`). Out-of-range, surrogate, single-digit `&#0;`, and hex
 * zero (`&#x0;`, `&#x00;`, ...) references map to `U+FFFD`. Zero-padded decimal
 * zero references (`&#00;`, `&#000;`, ...) pass PHP `empty($number)` as `false`
 * in `Html5EntityDecoder::fromDecimal()`, decode to NUL (`"\x00"`), and are
 * stripped to `""` by WordPress `wp_kses_no_null()`. Named entities use strict
 * HTML5 entity decoding.
 */
function decodeCommonMarkHtmlEntity(entity: string): string {
	if (!entity.startsWith("&#")) {
		return decodeHTMLStrict(entity);
	}
	const isHex = entity[2] === "x" || entity[2] === "X";
	const rawDigits = entity.slice(isHex ? 3 : 2, -1);
	const codePoint = Number.parseInt(rawDigits, isHex ? 16 : 10);
	// PHP `Html5EntityDecoder::fromDecimal()` checks `empty($number)`: `empty("0")`
	// is true (-> U+FFFD), whereas `empty("00")` / `empty("000")` is false, so
	// `mb_decode_numericentity` emits NUL (`"\x00"`), which WordPress
	// `wp_kses_no_null()` strips to `""` before `parse_image_scale_title()` runs.
	// `fromHex()` passes integer `hexdec($hex)` so `empty(0)` is always true.
	if (!isHex && codePoint === 0 && rawDigits.length >= 2) {
		return "";
	}
	if (
		!Number.isInteger(codePoint) ||
		codePoint <= 0 ||
		codePoint > 0x2ffff ||
		(codePoint >= 0xd800 && codePoint <= 0xdfff)
	) {
		return "\uFFFD";
	}
	return String.fromCodePoint(codePoint);
}

/**
 * Decodes CommonMark §2.3 NUL replacement, §2.4 backslash-escaped ASCII
 * punctuation, and §6.2 strict HTML5 entities in a raw Markdown title body,
 * mirroring PHP `League\CommonMark\Util\RegexHelper::unescape()` 1:1.
 */
export function decodeCommonMarkTitle(rawTitle: string): string {
	// CommonMark §2.3 replaces raw U+0000 characters in Markdown input with
	// U+FFFD before parsing and entity decoding. Entity-decoded zero-padded
	// decimal NULs (`&#00;`, `&#000;`, ...) are produced later and stripped by
	// WordPress `wp_kses_no_null()`.
	const normalized = rawTitle.includes("\u0000")
		? rawTitle.split("\u0000").join("\uFFFD")
		: rawTitle;
	const unescaped = unescapeCommonMarkAsciiPunctuation(normalized);
	if (!unescaped.includes("&")) {
		return unescaped;
	}
	return unescaped.replace(COMMONMARK_HTML_ENTITY, decodeCommonMarkHtmlEntity);
}

/**
 * Parses an image `title` value using the exact terminal-marker contract from
 * PHP `MarkdownRenderer::parse_image_scale_title()`.
 */
export function parseImageScaleTitleContract(
	title: string,
): ParsedImageScaleTitleContract {
	if (!title.includes("{width=")) {
		return { status: "none" };
	}
	const tailMatch = TERMINAL_IMAGE_SCALE_MARKER.exec(title);
	if (!tailMatch) {
		return { status: "none" };
	}
	const marker = tailMatch[0];
	const markerOffset = tailMatch.index;
	const validMatch = VALID_IMAGE_SCALE_MARKER.exec(marker);
	if (!validMatch?.[1]) {
		return { status: "invalid" };
	}
	const scale = Number(validMatch[1]) as ImageScalePercentage;
	if (0 === markerOffset) {
		return {
			markerLength: marker.length,
			markerOffset,
			scale,
			status: "valid",
			title: null,
		};
	}
	if (" " !== title[markerOffset - 1]) {
		return { status: "invalid" };
	}
	const remainingTitle = title.slice(0, markerOffset - 1);
	if (REPEATED_TERMINAL_IMAGE_SCALE_MARKER.test(remainingTitle)) {
		return { status: "invalid" };
	}
	return {
		markerLength: marker.length,
		markerOffset,
		scale,
		status: "valid",
		title: remainingTitle,
	};
}

/**
 * Mirrors WordPress Core's `valid_unicode()` predicate in `wp-includes/kses.php`.
 */
function isValidWpKsesUnicode(codePoint: number): boolean {
	return (
		codePoint === 0x9 ||
		codePoint === 0xa ||
		codePoint === 0xd ||
		(codePoint >= 0x20 && codePoint <= 0xd7ff) ||
		(codePoint >= 0xe000 && codePoint <= 0xfffd) ||
		(codePoint >= 0x10000 && codePoint <= 0x10ffff)
	);
}

/**
 * Projects a CommonMark-decoded image title through WordPress Core's
 * `wp_kses_no_null(..., ['slash_zero' => 'keep'])` +
 * `wp_kses_normalize_entities()` + `DOMDocument::loadHTML()` pipeline so
 * browser parsing and serialization match real WordPress
 * `MarkdownRenderer::render()` 1:1.
 */
export function decodeWpKsesRenderedTitle(commonMarkDecoded: string): string {
	let rendered = commonMarkDecoded.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Mirror WP wp_kses_no_null() control-character stripping.
		/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,
		"",
	);
	if (!rendered.includes("&#")) {
		return rendered;
	}
	rendered = rendered.replace(
		/&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));/g,
		(match, decDigits: string | undefined, hexDigits: string | undefined) => {
			if (decDigits !== undefined) {
				// PHP `wp_kses_normalize_entities2()` checks `empty($matches[1])`:
				// `empty("0")` is true (-> ""), whereas `empty("00")` is false.
				if (decDigits === "0") {
					return "";
				}
				const trimmed = decDigits.replace(/^0+/, "");
				if (trimmed.length === 0 || trimmed.length > 7) {
					return match;
				}
				const codePoint = Number.parseInt(trimmed, 10);
				return isValidWpKsesUnicode(codePoint)
					? String.fromCodePoint(codePoint)
					: match;
			}
			if (hexDigits !== undefined) {
				// PHP `wp_kses_normalize_entities3()` checks `empty($matches[1])`:
				// `empty("0")` is true (-> ""), whereas `empty("00")` is false.
				if (hexDigits === "0") {
					return "";
				}
				const trimmed = hexDigits.replace(/^0+/, "");
				if (trimmed.length === 0 || trimmed.length > 6) {
					return match;
				}
				const codePoint = Number.parseInt(trimmed, 16);
				return isValidWpKsesUnicode(codePoint)
					? String.fromCodePoint(codePoint)
					: match;
			}
			return match;
		},
	);
	return rendered;
}

/**
 * Evaluates a raw Markdown image title as PHP `MarkdownRenderer` will observe
 * it after CommonMark §2.2 / §4.8 line-ending normalization and continuation
 * indent stripping, followed by `RegexHelper::unescape()`, WordPress
 * `wp_kses_no_null(..., ['slash_zero' => 'keep'])` +
 * `wp_kses_normalize_entities()`, and `DOMDocument::loadHTML()`. HTML5 / libxml
 * `DOMDocument::loadHTML` preserves `\n` and `\r` verbatim inside `title`.
 */
export function parseEffectiveImageScaleTitle(
	rawTitle: string,
): ParsedImageScaleTitleContract {
	const normalizedSource = rawTitle
		.replace(/\r\n|\r/gu, "\n")
		.replace(/\n[ \t]+/gu, "\n");
	const decodedTitle = decodeWpKsesRenderedTitle(
		decodeCommonMarkTitle(normalizedSource),
	);
	return parseImageScaleTitleContract(decodedTitle);
}

/**
 * Strips trailing reserved `{width=...}` markers using a single linear
 * backwards-scanning pass (zero backtracking / zero ReDoS), preserving any
 * nonterminal `{width=...}` text.
 *
 * - When `stripWhitespacePaddedTrailingMarker` is `false` (no scale marker will
 *   be appended), untrimmed titles that do not end directly with a `{width=...}`
 *   token are returned verbatim untouched.
 * - When `stripWhitespacePaddedTrailingMarker` is `true` (a ` {width=N%}`
 *   suffix is about to be appended), trailing `[ \t\r\n]*` is scanned past only
 *   to detect an immediately preceding `{width=...}` marker; ordinary trailing
 *   whitespace without a marker is left untouched.
 */
export function stripTrailingReservedScaleMarkers(
	title: string,
	stripWhitespacePaddedTrailingMarker: boolean,
): string {
	let end = title.length;
	let probe = end;
	if (stripWhitespacePaddedTrailingMarker) {
		while (probe > 0 && isAsciiWhitespace(title[probe - 1])) {
			probe -= 1;
		}
	}

	while (probe >= 8 && "}" === title[probe - 1]) {
		let openBrace = -1;
		for (let scan = probe - 2; scan >= 0; scan -= 1) {
			const character = title[scan];
			if ("}" === character) {
				break;
			}
			if ("{" === character) {
				openBrace = scan;
				break;
			}
		}
		if (openBrace < 0 || !title.startsWith("{width=", openBrace)) {
			break;
		}
		end = openBrace;
		while (end > 0 && isAsciiWhitespace(title[end - 1])) {
			end -= 1;
		}
		probe = end;
	}

	return end === title.length ? title : title.slice(0, end);
}
