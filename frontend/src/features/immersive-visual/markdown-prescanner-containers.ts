import {
	advanceMarkdownColumns,
	isAtMostOneCodePointLeft,
} from "../../shared/markdown/markdown-char-codes";

/**
 * Unified container-frame stack (`quote` / `list`), League CommonMark 2.8.2
 * tab-aware column peeling, and prose-line container classification for the
 * Immersive Visual prescanner and serializer.
 */

export const ATX_HEADING = /^#{1,6}(?:[ \t]+.*|[ \t]*)$/;
export const THEMATIC_BREAK =
	/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
export const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;

const LIST_MARKER_TOKEN = /^(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;

export type ListContainerMarker = "-" | "+" | "*" | "." | ")";

export type ContainerFrame =
	| Readonly<{ kind: "quote" }>
	| Readonly<{
			contentIndent: number;
			empty?: boolean;
			kind: "list";
			marker: ListContainerMarker;
	  }>;

type MatchedContainerLine = Readonly<{
	body: string;
	col: number;
	exitedContainer: boolean;
	matchedCount: number;
	prefix: string;
}>;

type PeeledContainerLine = Readonly<{
	body: string;
	col: number;
	frames: ContainerFrame[];
	matchedCount: number;
	normalizedPrefix: string;
	prefix: string;
}>;

type MatchedListMarker = Readonly<{
	marker: ListContainerMarker;
	markerEndCol: number;
	markerEndPos: number;
	markerText: string;
	orderedNumber: number | null;
}>;

type ContainerBlockStep = Readonly<{
	body: string;
	col: number;
	continues: boolean;
	isBlank: boolean;
}>;

export type ClassifiedLineContainers = Readonly<{
	blockFrames: ReadonlyArray<ContainerFrame>;
	body: string;
	bodyContent: string;
	col: number;
	inParagraph: boolean;
	isBlankInContainer: boolean;
	matchedCount: number;
	normalizedPrefix: string;
	paragraphContinues: boolean;
	prefix: string;
	proseFrames: ReadonlyArray<ContainerFrame>;
	relIndent: number;
}>;

/** CommonMark §2.2 blank line: empty or ASCII space (`0x20`) / tab (`0x09`) only. */
export function isMarkdownBlankLine(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (32 !== code && 9 !== code) return false;
	}
	return true;
}

/** CommonMark blank text: empty or ASCII space, tab, CR, or LF only (excludes NBSP). */
export function isMarkdownBlankText(text: string): boolean {
	return /^[ \t\r\n]*$/.test(text);
}

/** Strips leading CommonMark ASCII spaces (`0x20`) and tabs (`0x09`) only. */
export function stripLeadingAsciiSpaceTab(text: string): string {
	let i = 0;
	while (
		i < text.length &&
		(32 === text.charCodeAt(i) || 9 === text.charCodeAt(i))
	) {
		i += 1;
	}
	return i === 0 ? text : text.slice(i);
}

/** Strips trailing CommonMark ASCII spaces (`0x20`) and tabs (`0x09`) only. */
export function stripTrailingAsciiSpaceTab(text: string): string {
	let end = text.length;
	while (
		end > 0 &&
		(32 === text.charCodeAt(end - 1) || 9 === text.charCodeAt(end - 1))
	) {
		end -= 1;
	}
	return end === text.length ? text : text.slice(0, end);
}

/** Trims leading and trailing CommonMark ASCII spaces (`0x20`) and tabs (`0x09`). */
export function trimAsciiSpaceTab(text: string): string {
	return stripTrailingAsciiSpaceTab(stripLeadingAsciiSpaceTab(text));
}

export function leadingColumnsFrom(text: string, startCol = 0): number {
	let col = startCol;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charCodeAt(i);
		if (32 === ch) col += 1;
		else if (9 === ch) col += 4 - (col % 4);
		else break;
	}
	return col - startCol;
}

/**
 * Expands column-dependent leading tabs (when `col % 4 !== 0` and total leading
 * indentation is `<= 3` columns before non-whitespace content) into their exact
 * column-equivalent spaces relative to `col`, preserving space-only indents and
 * `>= 4`-column indented lines verbatim.
 */
function expandColumnDependentLeadingTabs(body: string, col: number): string {
	if (col % 4 === 0 || body.length === 0) return body;
	let pos = 0;
	let curCol = col;
	let hasTab = false;
	while (pos < body.length) {
		const ch = body.charCodeAt(pos);
		if (32 === ch) {
			curCol += 1;
			pos += 1;
		} else if (9 === ch) {
			hasTab = true;
			curCol += 4 - (curCol % 4);
			pos += 1;
		} else {
			break;
		}
		if (curCol - col > 3) return body;
	}
	if (!hasTab || pos >= body.length) return body;
	return `${" ".repeat(curCol - col)}${body.slice(pos)}`;
}

export type StripContainerBlockOptions = Readonly<{
	expandContinuationTabs?: "all" | "last-only" | "none";
}>;

/**
 * Strips ONLY the outer container `frames` from lines `[start, end)`, keeping
 * space-based relative indentation intact, zeroing partial-indent blank
 * continuation lines, and expanding column-dependent leading tabs (`<= 3` cols
 * at `col % 4 !== 0`) so blocks remain valid if lifted to column 0 or reparsed.
 */
export function stripContainerBlockLines(
	rawLines: ReadonlyArray<string>,
	frames: ReadonlyArray<ContainerFrame>,
	start: number,
	end: number,
	firstLineBody: string,
	firstLineCol: number,
	options?: StripContainerBlockOptions,
): string[] {
	const expandContinuationTabs = options?.expandContinuationTabs ?? "none";
	const stripped: string[] = [
		expandColumnDependentLeadingTabs(firstLineBody, firstLineCol),
	];
	for (let k = start + 1; k < end; k += 1) {
		const matched = matchContainerFrames(rawLines[k] ?? "", frames);
		if (matched.exitedContainer && isMarkdownBlankLine(matched.body)) {
			stripped.push("");
			continue;
		}
		const shouldExpand =
			expandContinuationTabs === "all" ||
			(expandContinuationTabs === "last-only" && k === end - 1);
		stripped.push(
			shouldExpand
				? expandColumnDependentLeadingTabs(matched.body, matched.col)
				: matched.body,
		);
	}
	return stripped;
}

function skipUpToThreeIndentColumns(
	text: string,
	startCol: number,
): Readonly<{ col: number; pos: number }> {
	let pos = 0;
	let col = startCol;
	while (pos < text.length) {
		const ch = text.charCodeAt(pos);
		if (32 === ch) {
			if (col + 1 - startCol > 3) break;
			col += 1;
			pos += 1;
		} else if (9 === ch) {
			const nextCol = col + (4 - (col % 4));
			if (nextCol - startCol > 3) break;
			col = nextCol;
			pos += 1;
		} else {
			break;
		}
	}
	return { col, pos };
}

function consumeBlockquoteMarker(
	text: string,
	startCol: number,
): Readonly<{
	nextCol: number;
	nextPos: number;
	prefix: string;
	straddleSpaces: string;
}> | null {
	const indent = skipUpToThreeIndentColumns(text, startCol);
	let pos = indent.pos;
	let col = indent.col;
	if (pos >= text.length || 62 /* > */ !== text.charCodeAt(pos)) {
		return null;
	}
	pos += 1;
	col += 1;
	if (pos < text.length) {
		const after = text.charCodeAt(pos);
		if (32 === after) {
			pos += 1;
			col += 1;
		} else if (9 === after) {
			const tabStop = col + (4 - (col % 4));
			pos += 1;
			const consumed = col + 1;
			return {
				nextCol: consumed,
				nextPos: pos,
				prefix: `${text.slice(0, pos - 1)} `,
				straddleSpaces: " ".repeat(Math.max(0, tabStop - consumed)),
			};
		}
	}
	return {
		nextCol: col,
		nextPos: pos,
		prefix: text.slice(0, pos),
		straddleSpaces: "",
	};
}

function parseListContainerMarker(raw: string): ListContainerMarker {
	const last = raw.charCodeAt(raw.length - 1);
	if (43 /* + */ === last) return "+";
	if (42 /* * */ === last) return "*";
	if (46 /* . */ === last) return ".";
	if (41 /* ) */ === last) return ")";
	return "-";
}

function matchListMarkerAt(
	text: string,
	startCol: number,
): MatchedListMarker | null {
	const indent = skipUpToThreeIndentColumns(text, startCol);
	const match = LIST_MARKER_TOKEN.exec(text.slice(indent.pos));
	if (!match) return null;
	const markerEndPos = indent.pos + match[0].length;
	return {
		marker: parseListContainerMarker(match[0]),
		markerEndCol: indent.col + match[0].length,
		markerEndPos,
		markerText: text.slice(0, markerEndPos),
		orderedNumber: match[1] !== undefined ? Number(match[1]) : null,
	};
}

function consumeListIndent(
	text: string,
	startCol: number,
	requiredColumns: number,
): Readonly<{
	nextCol: number;
	nextPos: number;
	prefix: string;
	straddleSpaces: string;
}> | null {
	let pos = 0;
	let col = startCol;
	const targetCol = startCol + requiredColumns;
	while (pos < text.length && col < targetCol) {
		const ch = text.charCodeAt(pos);
		if (32 === ch) {
			col += 1;
			pos += 1;
		} else if (9 === ch) {
			const tabStop = col + (4 - (col % 4));
			pos += 1;
			if (tabStop > targetCol) {
				return {
					nextCol: targetCol,
					nextPos: pos,
					prefix: `${text.slice(0, pos - 1)}${" ".repeat(targetCol - col)}`,
					straddleSpaces: " ".repeat(tabStop - targetCol),
				};
			}
			col = tabStop;
		} else {
			return null;
		}
	}
	if (col < targetCol) {
		return null;
	}
	return {
		nextCol: col,
		nextPos: pos,
		prefix: text.slice(0, pos),
		straddleSpaces: "",
	};
}

function consumeOneListSpace(
	text: string,
	startCol: number,
): Readonly<{
	nextCol: number;
	nextPos: number;
	prefix: string;
	straddleSpaces: string;
}> {
	if (text.length === 0) {
		return { nextCol: startCol, nextPos: 0, prefix: "", straddleSpaces: "" };
	}
	const ch = text.charCodeAt(0);
	if (32 === ch) {
		return { nextCol: startCol + 1, nextPos: 1, prefix: " ", straddleSpaces: "" };
	}
	if (9 === ch) {
		const tabStop = startCol + (4 - (startCol % 4));
		const consumed = startCol + 1;
		return {
			nextCol: consumed,
			nextPos: 1,
			prefix: " ",
			straddleSpaces: " ".repeat(Math.max(0, tabStop - consumed)),
		};
	}
	return { nextCol: startCol, nextPos: 0, prefix: "", straddleSpaces: "" };
}

export function matchContainerFrames(
	line: string,
	frames: ReadonlyArray<ContainerFrame>,
): MatchedContainerLine {
	let cur = line;
	let col = 0;
	let prefix = "";
	let matchedCount = 0;
	for (const frame of frames) {
		const matched =
			frame.kind === "quote"
				? consumeBlockquoteMarker(cur, col)
				: consumeListIndent(cur, col, frame.contentIndent);
		if (!matched) break;
		prefix += matched.prefix;
		cur = `${matched.straddleSpaces}${cur.slice(matched.nextPos)}`;
		col = matched.nextCol;
		matchedCount += 1;
	}
	return {
		body: cur,
		col,
		exitedContainer: matchedCount < frames.length,
		matchedCount,
		prefix,
	};
}

/**
 * Retains container frames that survive a blank line after `matchedCount`
 * explicitly continued frames: non-empty list frames stay open across blank
 * lines, while empty list items (CommonMark §5.2) and unmatched blockquotes
 * close immediately.
 */
export function retainFramesAcrossBlankLine(
	frames: ReadonlyArray<ContainerFrame>,
	matchedCount: number,
): ContainerFrame[] {
	let keep = matchedCount;
	while (keep > 0) {
		const prev = frames[keep - 1];
		if (prev?.kind === "list" && prev.empty) {
			keep -= 1;
		} else {
			break;
		}
	}
	while (keep < frames.length) {
		const next = frames[keep];
		if (next?.kind === "list" && !next.empty) {
			keep += 1;
		} else {
			break;
		}
	}
	return frames.slice(0, keep);
}

/**
 * Advances one line inside a multi-line container-scoped block (fenced code or
 * HTML block), reporting whether `frames` remain open and exposing the inner
 * body and column position.
 */
export function stepContainerBlockLine(
	line: string,
	frames: ReadonlyArray<ContainerFrame>,
): ContainerBlockStep {
	if (frames.length === 0) {
		return {
			body: line,
			col: 0,
			continues: true,
			isBlank: isMarkdownBlankLine(line),
		};
	}
	if (isMarkdownBlankLine(line)) {
		return {
			body: "",
			col: 0,
			continues: retainFramesAcrossBlankLine(frames, 0).length === frames.length,
			isBlank: true,
		};
	}
	const matched = matchContainerFrames(line, frames);
	if (matched.exitedContainer) {
		if (isMarkdownBlankLine(matched.body)) {
			return {
				body: "",
				col: matched.col,
				continues:
					retainFramesAcrossBlankLine(frames, matched.matchedCount).length ===
					frames.length,
				isBlank: true,
			};
		}
		return {
			body: matched.body,
			col: matched.col,
			continues: false,
			isBlank: false,
		};
	}
	return {
		body: matched.body,
		col: matched.col,
		continues: true,
		isBlank: isMarkdownBlankLine(matched.body),
	};
}

export function startsContainerQuote(body: string, col = 0): boolean {
	return consumeBlockquoteMarker(body, col) !== null;
}

export function isInterruptingListMarker(
	body: string,
	exitedContainer: boolean,
	col = 0,
): boolean {
	const marker = matchListMarkerAt(body, col);
	if (!marker) return false;
	const after = body.slice(marker.markerEndPos);
	const blank = isMarkdownBlankLine(after);
	return (
		exitedContainer ||
		(!blank && (marker.orderedNumber === null || marker.orderedNumber === 1))
	);
}

function isSingleCodepointNestedContainer(code: number): boolean {
	return (
		45 /* - */ === code ||
		43 /* + */ === code ||
		42 /* * */ === code ||
		62 /* > */ === code
	);
}

/**
 * Unified container-frame peeler matching `openFrames` from the front of
 * `line` (reusing `prematched` when already matched) and peeling any newly
 * opened `quote` or `list` markers using exact League CommonMark 2.8.2
 * tab-aware columns.
 */
export function peelContainerFrames(
	line: string,
	openFrames: ReadonlyArray<ContainerFrame>,
	prematched?: MatchedContainerLine,
): PeeledContainerLine {
	const matched = prematched ?? matchContainerFrames(line, openFrames);
	const frames: ContainerFrame[] = [];
	const hasBody = !isMarkdownBlankLine(matched.body);
	for (let k = 0; k < matched.matchedCount; k += 1) {
		const frame = openFrames[k];
		if (!frame) break;
		if (frame.kind === "list" && frame.empty && hasBody) {
			frames.push({
				contentIndent: frame.contentIndent,
				kind: "list",
				marker: frame.marker,
			});
		} else {
			frames.push(frame);
		}
	}
	const matchedCount = frames.length;
	let cur = matched.body;
	let col = matched.col;
	let prefix = matched.prefix;
	let normalizedPrefix = matched.prefix;

	while (cur.length > 0) {
		const prevCol = col;
		const prevLen = cur.length;
		const trimmed = trimAsciiSpaceTab(cur);
		if (trimmed.length === 0) break;
		const relIndent = leadingColumnsFrom(cur, col);
		if (relIndent >= 4) break;
		if (ATX_HEADING.test(trimmed) || THEMATIC_BREAK.test(trimmed)) break;

		const quote = consumeBlockquoteMarker(cur, col);
		if (quote) {
			frames.push({ kind: "quote" });
			prefix += quote.prefix;
			normalizedPrefix += quote.prefix;
			cur = `${quote.straddleSpaces}${cur.slice(quote.nextPos)}`;
			col = quote.nextCol;
			if (col <= prevCol && cur.length >= prevLen) break;
			continue;
		}

		const marker = matchListMarkerAt(cur, col);
		if (!marker) break;

		const after = cur.slice(marker.markerEndPos);
		const blank = isMarkdownBlankLine(after);
		const wsText = /^[ \t]+/.exec(after)?.[0] ?? "";
		const markerEndCol = marker.markerEndCol;
		const contentCol = advanceMarkdownColumns(wsText, markerEndCol);
		const spacingCols = contentCol - markerEndCol;

		if (blank) {
			frames.push({
				contentIndent: markerEndCol - col + 1,
				empty: true,
				kind: "list",
				marker: marker.marker,
			});
			prefix += cur;
			normalizedPrefix += cur;
			col = advanceMarkdownColumns(cur, col);
			cur = "";
			break;
		}
		if (spacingCols >= 5) {
			const consumed = consumeOneListSpace(after, markerEndCol);
			frames.push({
				contentIndent: markerEndCol - col + 1,
				kind: "list",
				marker: marker.marker,
			});
			prefix += `${marker.markerText}${consumed.prefix}`;
			normalizedPrefix += `${marker.markerText}${consumed.prefix}`;
			cur = `${consumed.straddleSpaces}${after.slice(consumed.nextPos)}`;
			col = consumed.nextCol;
			break;
		}
		if (
			spacingCols >= 2 &&
			isAtMostOneCodePointLeft(after, wsText.length, after.length)
		) {
			frames.push({
				contentIndent: markerEndCol - col + 1,
				kind: "list",
				marker: marker.marker,
			});
			if (isSingleCodepointNestedContainer(after.charCodeAt(wsText.length))) {
				const consumed = consumeOneListSpace(after, markerEndCol);
				prefix += `${marker.markerText}${consumed.prefix}`;
				normalizedPrefix += `${marker.markerText}${consumed.prefix}`;
				cur = `${consumed.straddleSpaces}${after.slice(consumed.nextPos)}`;
				col = consumed.nextCol;
			} else {
				prefix += `${marker.markerText}${wsText}`;
				normalizedPrefix += `${marker.markerText} `;
				cur = after.slice(wsText.length);
				col = contentCol;
			}
			if (col <= prevCol && cur.length >= prevLen) break;
			continue;
		}
		frames.push({
			contentIndent: contentCol - col,
			kind: "list",
			marker: marker.marker,
		});
		prefix += `${marker.markerText}${wsText}`;
		normalizedPrefix += `${marker.markerText}${wsText}`;
		cur = after.slice(wsText.length);
		col = contentCol;
		if (col <= prevCol && cur.length >= prevLen) break;
	}

	return {
		body: cur,
		col,
		frames,
		matchedCount,
		normalizedPrefix,
		prefix,
	};
}

/**
 * Single-pass container classification for a non-blank line against the active
 * `openContainerFrames` stack and `paragraphOpen` state, matching `openFrames`
 * at most once and computing both block-level and prose-level container frames.
 */
function isHeadingOrThematicBreakStart(code: number): boolean {
	return 35 /* # */ === code || 42 /* * */ === code || 45 /* - */ === code || 95 /* _ */ === code;
}

function isSetextStart(code: number): boolean {
	return 61 /* = */ === code || 45 /* - */ === code;
}

export function classifyLineContainers(
	line: string,
	openContainerFrames: ReadonlyArray<ContainerFrame>,
	paragraphOpen: boolean,
): ClassifiedLineContainers {
	const matched = matchContainerFrames(line, openContainerFrames);
	if (isMarkdownBlankLine(matched.body)) {
		const retained = retainFramesAcrossBlankLine(
			openContainerFrames,
			matched.matchedCount,
		);
		return {
			blockFrames: retained,
			body: matched.body,
			bodyContent: "",
			col: matched.col,
			inParagraph: false,
			isBlankInContainer: true,
			matchedCount: matched.matchedCount,
			normalizedPrefix: matched.prefix,
			paragraphContinues: false,
			prefix: matched.prefix,
			proseFrames: retained,
			relIndent: 0,
		};
	}

	const openRelIndent = leadingColumnsFrom(matched.body, matched.col);
	const interruptsParagraph =
		paragraphOpen &&
		openRelIndent <= 3 &&
		(startsContainerQuote(matched.body, matched.col) ||
			isInterruptingListMarker(
				matched.body,
				matched.exitedContainer,
				matched.col,
			));

	if (paragraphOpen && !interruptsParagraph) {
		const bodyContent = stripLeadingAsciiSpaceTab(matched.body);
		const firstCode = bodyContent.charCodeAt(0);
		const survivingFrames = openContainerFrames.slice(0, matched.matchedCount);
		let closesParagraph = false;
		if (
			openRelIndent <= 3 &&
			(isHeadingOrThematicBreakStart(firstCode) || isSetextStart(firstCode))
		) {
			const trimmed = stripTrailingAsciiSpaceTab(bodyContent);
			closesParagraph =
				ATX_HEADING.test(trimmed) ||
				THEMATIC_BREAK.test(trimmed) ||
				(!matched.exitedContainer && SETEXT_UNDERLINE.test(trimmed));
		}
		return {
			blockFrames: survivingFrames,
			body: matched.body,
			bodyContent,
			col: matched.col,
			inParagraph: true,
			isBlankInContainer: false,
			matchedCount: matched.matchedCount,
			normalizedPrefix: matched.prefix,
			paragraphContinues: !closesParagraph,
			prefix: matched.prefix,
			proseFrames: closesParagraph ? survivingFrames : openContainerFrames,
			relIndent: openRelIndent,
		};
	}

	const peeled = peelContainerFrames(
		line,
		interruptsParagraph
			? openContainerFrames.slice(0, matched.matchedCount)
			: openContainerFrames,
		matched,
	);
	const bodyContent = stripLeadingAsciiSpaceTab(peeled.body);
	const trimmed = stripTrailingAsciiSpaceTab(bodyContent);
	const relIndent = leadingColumnsFrom(peeled.body, peeled.col);
	if (trimmed.length === 0) {
		const frames =
			peeled.frames.length === peeled.matchedCount
				? retainFramesAcrossBlankLine(openContainerFrames, peeled.matchedCount)
				: peeled.frames;
		return {
			blockFrames: peeled.frames,
			body: peeled.body,
			bodyContent,
			col: peeled.col,
			inParagraph: false,
			isBlankInContainer: false,
			matchedCount: peeled.matchedCount,
			normalizedPrefix: peeled.normalizedPrefix,
			paragraphContinues: false,
			prefix: peeled.prefix,
			proseFrames: frames,
			relIndent,
		};
	}
	const closesProse =
		relIndent >= 4 ||
		(relIndent <= 3 &&
			(ATX_HEADING.test(trimmed) || THEMATIC_BREAK.test(trimmed)));
	return {
		blockFrames: peeled.frames,
		body: peeled.body,
		bodyContent,
		col: peeled.col,
		inParagraph: false,
		isBlankInContainer: false,
		matchedCount: peeled.matchedCount,
		normalizedPrefix: peeled.normalizedPrefix,
		paragraphContinues: !closesProse,
		prefix: peeled.prefix,
		proseFrames: peeled.frames,
		relIndent,
	};
}

function formatContainerFrame(frame: ContainerFrame): string {
	return frame.kind === "quote" ? "quote" : `list:${frame.contentIndent}`;
}

export function formatContainerSignature(
	frames: ReadonlyArray<ContainerFrame>,
): string {
	return frames.map(formatContainerFrame).join("/");
}

export function appendContainerSignature(
	signature: string,
	frame: ContainerFrame,
): string {
	const segment = formatContainerFrame(frame);
	return signature.length > 0 ? `${signature}/${segment}` : segment;
}

export function standardContainerPrefix(
	frames: ReadonlyArray<ContainerFrame>,
): string {
	return frames
		.map((frame) =>
			frame.kind === "quote" ? "> " : " ".repeat(frame.contentIndent),
		)
		.join("");
}
