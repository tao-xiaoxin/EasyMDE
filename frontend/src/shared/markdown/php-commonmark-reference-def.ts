import {
	COMMONMARK_ESCAPABLE_PUNCTUATION,
	decodeCommonMarkTitle,
} from "../image-scale-title";

/**
 * Incremental CommonMark §4.7 link reference definition state machine
 * mirroring PHP `League\CommonMark\Reference\ReferenceParser` and
 * `League\CommonMark\Util\LinkParserHelper`.
 */

export type ReferenceDefinitionState =
	| "start-definition"
	| "label"
	| "destination"
	| "start-title"
	| "title"
	| "paragraph";

export type ParagraphReferenceParser = {
	labelBuffer: string;
	labelCodePoints: number;
	labelHasNonWhitespace: boolean;
	onReferenceLabel?: (rawLabel: string) => void;
	referenceValid: boolean;
	state: ReferenceDefinitionState;
	titleDelimiter: '"' | "'" | ")" | null;
};

export function createParagraphReferenceParser(
	onReferenceLabel?: (rawLabel: string) => void,
): ParagraphReferenceParser {
	return {
		labelBuffer: "",
		labelCodePoints: 0,
		labelHasNonWhitespace: false,
		...(onReferenceLabel ? { onReferenceLabel } : {}),
		referenceValid: false,
		state: "start-definition",
		titleDelimiter: null,
	};
}

function isSpaceOrTab(character: string | undefined): boolean {
	return " " === character || "\t" === character;
}

function skipSpacesAndTabs(line: string, start: number): number {
	let pos = start;
	while (pos < line.length && isSpaceOrTab(line[pos])) pos += 1;
	return pos;
}

function isPhpWhitespace(character: string | undefined): boolean {
	return (
		" " === character ||
		"\t" === character ||
		"\n" === character ||
		"\r" === character ||
		"\x0b" === character ||
		"\x0c" === character
	);
}

function parseReferenceDestinationEnd(line: string, start: number): number {
	const len = line.length;
	if (start >= len) return -1;
	if ("<" === line[start]) {
		let pos = start + 1;
		while (pos < len) {
			const ch = line[pos];
			if ("\\" === ch) {
				if (pos + 1 >= len) return -1;
				pos += 2;
				continue;
			}
			if ("<" === ch || "\u0000" === ch) return -1;
			if (">" === ch) return pos + 1;
			pos += 1;
		}
		return -1;
	}
	let pos = start;
	let openParens = 0;
	while (pos < len) {
		const ch = line[pos];
		if (
			"\\" === ch &&
			pos + 1 < len &&
			COMMONMARK_ESCAPABLE_PUNCTUATION.test(line[pos + 1] ?? "")
		) {
			pos += 2;
			continue;
		}
		if ("(" === ch) {
			openParens += 1;
			if (openParens > 32) return -1;
			pos += 1;
			continue;
		}
		if (")" === ch) {
			if (openParens < 1) break;
			openParens -= 1;
			pos += 1;
			continue;
		}
		if (line.charCodeAt(pos) <= 0x20 && isPhpWhitespace(ch)) break;
		pos += 1;
	}
	if (0 !== openParens || pos === start) return -1;
	return pos;
}

function parseReferenceLabelStep(
	parser: ParagraphReferenceParser,
	line: string,
	start: number,
): number {
	const len = line.length;
	let pos = skipSpacesAndTabs(line, start);
	const chunkStart = pos;
	while (pos < len) {
		const ch = line[pos];
		if ("[" === ch || "]" === ch) break;
		if ("\\" === ch) {
			parser.labelHasNonWhitespace = true;
			parser.labelCodePoints += 1;
			pos += 1;
			if (pos < len) {
				const nextCode = line.charCodeAt(pos);
				pos +=
					nextCode >= 0xd800 && nextCode <= 0xdbff && pos + 1 < len ? 2 : 1;
				parser.labelCodePoints += 1;
			}
			continue;
		}
		const code = line.charCodeAt(pos);
		if (
			0x20 !== code &&
			0x09 !== code &&
			0x0a !== code &&
			0x0d !== code &&
			0x00 !== code &&
			0x0b !== code
		) {
			parser.labelHasNonWhitespace = true;
		}
		pos += code >= 0xd800 && code <= 0xdbff && pos + 1 < len ? 2 : 1;
		parser.labelCodePoints += 1;
	}
	if (parser.onReferenceLabel && pos > chunkStart) {
		parser.labelBuffer += line.slice(chunkStart, pos);
	}
	if (pos >= len) {
		parser.labelCodePoints += 1;
		if (parser.onReferenceLabel) parser.labelBuffer += "\n";
		return len;
	}
	if ("]" !== line[pos] || ":" !== line[pos + 1]) return -1;
	if (parser.labelCodePoints > 999 || !parser.labelHasNonWhitespace) return -1;
	pos = skipSpacesAndTabs(line, pos + 2);
	parser.state = "destination";
	return pos;
}

function parseReferenceTitleStep(
	parser: ParagraphReferenceParser,
	line: string,
	start: number,
): Readonly<{ cleared: boolean; nextPos: number }> {
	const endDelim = parser.titleDelimiter;
	if (null === endDelim) return { cleared: false, nextPos: -1 };
	const len = line.length;
	let pos = start;
	let closedByLiteral = false;
	while (pos < len) {
		const ch = line[pos];
		if (
			"\\" === ch &&
			pos + 1 < len &&
			COMMONMARK_ESCAPABLE_PUNCTUATION.test(line[pos + 1] ?? "")
		) {
			pos += 2;
			continue;
		}
		if (ch === endDelim) {
			pos += 1;
			closedByLiteral = true;
			break;
		}
		if ("\u0000" === ch) break;
		pos += 1;
	}
	let endDelimiterFound = closedByLiteral;
	if (!endDelimiterFound && pos === len && pos > start) {
		// Mirror League\CommonMark\Reference\ReferenceParser::parseTitle(), which
		// runs RegexHelper::unescape() before checking substr($title, -1) === $delim.
		const matched = line.slice(start, pos);
		if (matched.endsWith(`\\${endDelim}`) || matched.endsWith(";")) {
			const unescaped = decodeCommonMarkTitle(matched);
			if (unescaped.endsWith(endDelim)) endDelimiterFound = true;
		}
	}
	if (!endDelimiterFound && pos >= len) {
		return { cleared: false, nextPos: len };
	}
	pos = skipSpacesAndTabs(line, pos);
	if (pos < len) return { cleared: false, nextPos: -1 };
	parser.titleDelimiter = null;
	parser.state = "start-definition";
	return { cleared: true, nextPos: len };
}

/**
 * Feeds one container-stripped paragraph line into `parser`.
 *
 * Returns `true` when the line completed one or more valid CommonMark §4.7 link
 * reference definitions at EOL (clearing all buffered paragraph lines up through
 * this line out of paragraph inline content).
 */
export function advanceParagraphReferenceParser(
	parser: ParagraphReferenceParser,
	line: string,
): boolean {
	if ("paragraph" === parser.state) return false;
	const len = line.length;
	let pos = 0;
	let cleared = false;

	while (pos < len) {
		if ("start-definition" === parser.state) {
			pos = skipSpacesAndTabs(line, pos);
			if (pos >= len || "[" !== line[pos]) {
				parser.state = "paragraph";
				return cleared;
			}
			parser.state = "label";
			parser.labelBuffer = "";
			parser.labelCodePoints = 0;
			parser.labelHasNonWhitespace = false;
			parser.referenceValid = false;
			pos += 1;
			if (pos >= len) {
				parser.labelCodePoints += 1;
				if (parser.onReferenceLabel) parser.labelBuffer += "\n";
			}
			continue;
		}
		if ("label" === parser.state) {
			const nextPos = parseReferenceLabelStep(parser, line, pos);
			if (nextPos < 0) {
				parser.state = "paragraph";
				return cleared;
			}
			pos = nextPos;
			continue;
		}
		if ("destination" === parser.state) {
			pos = skipSpacesAndTabs(line, pos);
			const destEnd = parseReferenceDestinationEnd(line, pos);
			if (destEnd < 0) {
				parser.state = "paragraph";
				return cleared;
			}
			const afterWs = skipSpacesAndTabs(line, destEnd);
			if (afterWs >= len) {
				cleared = true;
				if (!parser.referenceValid) {
					parser.referenceValid = true;
					parser.onReferenceLabel?.(parser.labelBuffer);
				}
			} else if (afterWs === destEnd) {
				parser.state = "paragraph";
				return cleared;
			}
			pos = afterWs;
			parser.state = "start-title";
			continue;
		}
		if ("start-title" === parser.state) {
			pos = skipSpacesAndTabs(line, pos);
			if (pos >= len) {
				parser.referenceValid = false;
				parser.state = "start-definition";
				continue;
			}
			const ch = line[pos];
			if ('"' === ch || "'" === ch) {
				parser.titleDelimiter = ch;
				parser.state = "title";
				pos += 1;
			} else if ("(" === ch) {
				parser.titleDelimiter = ")";
				parser.state = "title";
				pos += 1;
			} else {
				parser.titleDelimiter = null;
				parser.referenceValid = false;
				parser.state = "start-definition";
			}
			continue;
		}
		const titleStep = parseReferenceTitleStep(parser, line, pos);
		if (titleStep.nextPos < 0) {
			parser.state = "paragraph";
			return cleared;
		}
		if (titleStep.cleared) {
			cleared = true;
			if (!parser.referenceValid) {
				parser.onReferenceLabel?.(parser.labelBuffer);
			}
			parser.referenceValid = false;
		}
		pos = titleStep.nextPos;
	}

	return cleared;
}
