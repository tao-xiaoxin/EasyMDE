import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	decodeCommonMarkTitle,
	decodeWpKsesRenderedTitle,
	type ImageScalePercentage,
	parseEffectiveImageScaleTitle,
	stripTrailingReservedScaleMarkers,
} from "../../shared/image-scale-title";
import {
	chooseTitleQuoteDelimiter,
	escapeTablePipes,
	formatQuotedTitle,
	formatReferenceCloseForOrigin,
} from "./markdown-escape";
import type { ReferenceImageOrigin } from "./markdown-parser-inline";
import {
	containsAsciiControlCharacter,
	isValidVisualImageScale,
	stripAsciiControlCharacters,
} from "./visual-schema";

/**
 * Link destination and image node serialization helpers for the immersive
 * visual editor, including preserved partial-title reference images (`![r]`,
 * `![r][]`, `![alt][r]`) and scaled image titles.
 */

export function formatLinkDestination(
	href: string,
	inTableCell: boolean,
): string {
	const trimmed = href.trim();
	if (trimmed.length === 0) {
		return "";
	}
	let destination = trimmed;
	if (
		/[\s()<>]/.test(destination) ||
		containsAsciiControlCharacter(destination)
	) {
		// Angle-bracketed destinations may not contain raw `<`, `>` or spaces;
		// encode them so the wrapper stays valid CommonMark §6.3.
		const encoded = stripAsciiControlCharacters(destination)
			.replace(/</g, "%3C")
			.replace(/>/g, "%3E")
			.replace(/\s/g, "%20");
		destination = `<${encoded}>`;
	}
	return inTableCell ? escapeTablePipes(destination) : destination;
}

function formatImageAlt(
	alt: string,
	inTableCell: boolean,
	escapeOpenBracket = false,
): string {
	let escaped = alt
		.replace(/\r?\n/g, " ")
		.replace(/\\/g, "\\\\")
		.replace(/\]/g, "\\]");
	if (escapeOpenBracket) {
		escaped = escaped.replace(/\[/g, "\\[");
	}
	return inTableCell ? escapeTablePipes(escaped) : escaped;
}

function serializeScaledImageTitle(
	baseTitle: string,
	scale: ImageScalePercentage,
	inTableCell: boolean,
	mathNewlineToken: string | null,
	quoteChar: '"' | "'",
): string {
	const marker = `{width=${scale}%}`;
	const tryCandidate = (value: string): string | null => {
		const candidate = formatQuotedTitle(
			`${value} ${marker}`,
			inTableCell,
			mathNewlineToken,
			quoteChar,
		);
		const parsed = parseEffectiveImageScaleTitle(candidate);
		return parsed.status === "valid" && parsed.scale === scale
			? candidate
			: null;
	};
	if (baseTitle.length === 0) {
		return formatQuotedTitle(marker, inTableCell, mathNewlineToken, quoteChar);
	}
	const primary = tryCandidate(baseTitle);
	if (primary !== null) {
		return primary;
	}
	// Programmatic titles with backslash-escaped markers (such as
	// `"Caption \\{width=33%\\}"`) or WP KSES double-decoded numeric entities
	// (such as `"Caption &#123;width=51%&#125;"`) can still decode to a
	// conflicting marker in PHP; decode and strip before falling back to
	// scale-only so Visual serialization never emits PHP-invalid Markdown.
	let current = baseTitle;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const next = stripTrailingReservedScaleMarkers(
			decodeWpKsesRenderedTitle(decodeCommonMarkTitle(current)),
			true,
		);
		if (next.length === 0) {
			break;
		}
		const fallback = tryCandidate(next);
		if (fallback !== null) {
			return fallback;
		}
		if (next === current) {
			break;
		}
		current = next;
	}
	return formatQuotedTitle(marker, inTableCell, mathNewlineToken, quoteChar);
}

function serializeUnscaledImageTitle(
	rawTitle: string,
	inTableCell: boolean,
	mathNewlineToken: string | null,
	quoteChar: '"' | "'",
): string {
	if (rawTitle.length === 0) {
		return "";
	}
	const tryCandidate = (value: string): string | null => {
		const candidate = formatQuotedTitle(
			value,
			inTableCell,
			mathNewlineToken,
			quoteChar,
		);
		return parseEffectiveImageScaleTitle(candidate).status === "none"
			? candidate
			: null;
	};
	const primary = tryCandidate(rawTitle);
	if (primary !== null) {
		return primary;
	}
	const rawStripped = stripTrailingReservedScaleMarkers(rawTitle, false);
	if (rawStripped !== rawTitle && !rawStripped.endsWith("\\")) {
		if (rawStripped.length === 0) {
			return "";
		}
		const strippedCandidate = tryCandidate(rawStripped);
		if (strippedCandidate !== null) {
			return strippedCandidate;
		}
	}
	// Programmatic unscaled titles with backslash-escaped markers (such as
	// `"Caption \\{width=51%\\}"`) or WP KSES double-decoded numeric entities
	// can still decode to a PHP-invalid or spurious scale marker; decode and
	// strip trailing reserved markers before emitting.
	let current = rawTitle;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const next = stripTrailingReservedScaleMarkers(
			decodeWpKsesRenderedTitle(decodeCommonMarkTitle(current)),
			false,
		);
		if (next.length === 0) {
			return "";
		}
		const fallback = tryCandidate(next);
		if (fallback !== null) {
			return fallback;
		}
		if (next === current) {
			break;
		}
		current = next;
	}
	return "";
}

export function serializeImageNode(
	node: ProseMirrorNode,
	inTableCell: boolean,
	mathNewlineToken: string | null,
	referenceOrigin: ReferenceImageOrigin | null = null,
	nextCharMayHijackShortcut = false,
): string {
	const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
	const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
	const scale = isValidVisualImageScale(node.attrs.scale)
		? node.attrs.scale
		: null;
	const rawTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
	const normalizedTitle = rawTitle.length > 0 ? rawTitle : null;

	if (
		referenceOrigin !== null &&
		src === referenceOrigin.src &&
		normalizedTitle === referenceOrigin.title &&
		scale === referenceOrigin.scale
	) {
		const refAltText = formatImageAlt(alt, inTableCell, true);
		const refClose = formatReferenceCloseForOrigin(
			referenceOrigin,
			refAltText,
			inTableCell,
			nextCharMayHijackShortcut,
		);
		if (refClose !== null) {
			return `![${refAltText}${refClose}`;
		}
	}

	const altText = formatImageAlt(alt, inTableCell);
	const destination = formatLinkDestination(src, inTableCell);
	let titleSegment = "";
	if (scale !== null) {
		const rawStripped =
			rawTitle.length > 0
				? stripTrailingReservedScaleMarkers(rawTitle, true)
				: "";
		const baseTitle =
			rawStripped !== rawTitle && rawStripped.endsWith("\\")
				? rawTitle
				: rawStripped;
		const quoteChar = chooseTitleQuoteDelimiter(baseTitle);
		titleSegment = ` ${quoteChar}${serializeScaledImageTitle(baseTitle, scale, inTableCell, mathNewlineToken, quoteChar)}${quoteChar}`;
	} else if (rawTitle.length > 0) {
		const quoteChar = chooseTitleQuoteDelimiter(rawTitle);
		const serializedTitle = serializeUnscaledImageTitle(
			rawTitle,
			inTableCell,
			mathNewlineToken,
			quoteChar,
		);
		if (serializedTitle.length > 0) {
			titleSegment = ` ${quoteChar}${serializedTitle}${quoteChar}`;
		}
	}
	return `![${altText}](${destination}${titleSegment})`;
}
