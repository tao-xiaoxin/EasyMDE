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

// Single-pass CommonMark §2.4 backslash-escaped ASCII punctuation + §6.2
// strict HTML5 entity scanner. Matching escapes and entities in one pass
// guarantees backslash-escaped ampersands (such as `\&amp;`) decode to literal
// `&amp;` rather than undergoing entity decoding.
const COMMONMARK_TITLE_TOKEN =
	/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])|(&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});)/giu;

function isAsciiWhitespace(character: string | undefined): boolean {
	return (
		" " === character ||
		"\t" === character ||
		"\r" === character ||
		"\n" === character
	);
}

/**
 * Decodes CommonMark §2.4 backslash-escaped ASCII punctuation and strict HTML5
 * entities in a raw Markdown title body without entity-decoding backslash-
 * escaped ampersands.
 */
export function decodeCommonMarkTitle(rawTitle: string): string {
	if (!rawTitle.includes("\\") && !rawTitle.includes("&")) {
		return rawTitle;
	}
	return rawTitle.replace(
		COMMONMARK_TITLE_TOKEN,
		(
			match: string,
			escapedChar: string | undefined,
			entity: string | undefined,
		): string => {
			if (undefined !== escapedChar) {
				return escapedChar;
			}
			if (undefined !== entity) {
				return decodeHTMLStrict(entity);
			}
			return match;
		},
	);
}

/**
 * Normalizes line breaks inside an HTML `title` attribute to single spaces,
 * matching attribute-value normalization when PHP reads
 * `$image->getAttribute('title')` in `MarkdownRenderer::restore_image_scale_markers()`.
 */
export function normalizeHtmlAttributeTitle(title: string): string {
	return title.replace(/\r\n|\r|\n/gu, " ");
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
 * Evaluates a raw Markdown image title as PHP `MarkdownRenderer` will observe
 * it after CommonMark unescaping, HTML5 entity decoding, paragraph continuation
 * line-indent stripping, and HTML attribute newline normalization.
 */
export function parseEffectiveImageScaleTitle(
	rawTitle: string,
): ParsedImageScaleTitleContract {
	const normalizedParsed = parseImageScaleTitleContract(
		normalizeHtmlAttributeTitle(decodeCommonMarkTitle(rawTitle)),
	);
	if ("invalid" === normalizedParsed.status) {
		return normalizedParsed;
	}
	if (/[\r\n]/u.test(rawTitle)) {
		// CommonMark §4.8 strips leading spaces/tabs on continuation lines of a
		// paragraph, so `"Caption\n {width=50%}"` arrives at PHP as
		// `"Caption\n{width=50%}"` (missing the required `' '` separator).
		const continuationParsed = parseImageScaleTitleContract(
			decodeCommonMarkTitle(
				rawTitle.replace(/(?:\r\n|\r|\n)[ \t]+/gu, "\n"),
			),
		);
		if ("invalid" === continuationParsed.status) {
			return continuationParsed;
		}
	}
	return normalizedParsed;
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
