import type {
	BlockContext,
	Element,
	LeafBlock,
	LeafBlockParser,
	Line,
} from "@lezer/markdown";

import {
	hasOddPrecedingBackslashes,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import {
	isAsciiAlnumCode,
	isAsciiDigitCode,
	isCommonMarkWhitespaceCode,
	isLezerSpaceCode,
} from "../../shared/markdown/markdown-char-codes";
import {
	advanceCodePoint,
	isAsciiPunctCode,
	scanLinkDestinationRange,
} from "../../shared/markdown/markdown-link-destination";
import { getLineDepth } from "./editor-markdown-league-block-rules";
import {
	MAX_LINK_LABEL_CODE_POINTS,
	skipSpaceOrTab,
} from "./editor-markdown-link-primitives";

enum RefStage {
	Failed = -1,
	Label = 0,
	Destination = 1,
	StartTitleSameLine = 2,
	StartTitleNextLine = 3,
	Title = 4,
	Complete = 5,
	AbsorbRemainder = 6,
}

type ValidRefSnapshot = Readonly<{
	colonRange: SourceRange;
	endOffset: number;
	labelRange: SourceRange;
	titleRange: SourceRange | null;
	urlRange: SourceRange;
}>;

type InternalLeafBlock = LeafBlock & {
	content: string;
	marks: Element[];
	start: number;
};

type InternalRefBlockContext = BlockContext & {
	block: { type: number };
};

function asInternalLeafBlock(leaf: LeafBlock): InternalLeafBlock {
	return leaf as InternalLeafBlock;
}

function isAsciiHexDigitCode(code: number): boolean {
	return (
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 70) ||
		(code >= 97 && code <= 102)
	);
}

/**
 * Matches League 2.8.2 `LinkParserHelper::parsePartialLinkTitle` +
 * `RegexHelper::unescape` followed by `ReferenceParser::parseTitle`'s
 * `substr($title, -1) === $this->titleDelimiter` check when a line reached EOL
 * without an unescaped closing delimiter:
 * - trailing backslash-escaped delimiter (`\"`, `\'`, `\)`); or
 * - trailing HTML5 entity (`RegexHelper::PARTIAL_ENTITY`) that decodes to the
 *   active delimiter (`&quot;`, `&QUOT;`, `&apos;`, `&rpar;`, `&#34;`,
 *   `&#x22;`, `&#39;`, `&#x27;`, `&#41;`, `&#x29;`, including backslash-escaped
 *   punctuation such as `\&quot;`, `&\#34;`, or `&quot\;`).
 */
function endsWithUnescapedTitleDelimiter(
	lineText: string,
	scanStart: number,
	lineLen: number,
	delimiter: number,
	lastTokenWasEscapedDelim: boolean,
): boolean {
	if (lastTokenWasEscapedDelim) return true;
	if (lineLen <= scanStart || 59 /* ; */ !== lineText.charCodeAt(lineLen - 1)) {
		return false;
	}
	let cursor = lineLen - 1;
	if (hasOddPrecedingBackslashes(lineText, cursor, scanStart)) {
		cursor -= 1;
	}
	const bodyEnd = cursor;
	const minBodyStart = Math.max(scanStart, bodyEnd - 32);
	while (cursor > minBodyStart && isAsciiAlnumCode(lineText.charCodeAt(cursor - 1))) {
		cursor -= 1;
	}
	const bodyStart = cursor;
	const bodyLen = bodyEnd - bodyStart;
	if (0 === bodyLen || cursor <= scanStart) return false;

	const isNumeric = 35 /* # */ === lineText.charCodeAt(cursor - 1);
	if (isNumeric) {
		cursor -= 1;
		if (hasOddPrecedingBackslashes(lineText, cursor, scanStart)) {
			cursor -= 1;
		}
	}
	if (cursor <= scanStart || 38 /* & */ !== lineText.charCodeAt(cursor - 1)) {
		return false;
	}

	if (isNumeric) {
		const first = lineText.charCodeAt(bodyStart);
		if (120 /* x */ === first || 88 /* X */ === first) {
			const hexLen = bodyLen - 1;
			if (hexLen < 1 || hexLen > 6) return false;
			let value = 0;
			for (let i = bodyStart + 1; i < bodyEnd; i += 1) {
				const code = lineText.charCodeAt(i);
				if (!isAsciiHexDigitCode(code)) return false;
				const digit =
					code <= 57 ? code - 48 : code <= 70 ? code - 55 : code - 87;
				value = value * 16 + digit;
			}
			return value === delimiter;
		}
		if (bodyLen > 7) return false;
		let value = 0;
		for (let i = bodyStart; i < bodyEnd; i += 1) {
			const code = lineText.charCodeAt(i);
			if (!isAsciiDigitCode(code)) return false;
			value = value * 10 + (code - 48);
		}
		return value === delimiter;
	}

	if (4 !== bodyLen) return false;
	const name = lineText.slice(bodyStart, bodyEnd);
	if (34 /* " */ === delimiter) return "quot" === name || "QUOT" === name;
	if (39 /* ' */ === delimiter) return "apos" === name;
	if (41 /* ) */ === delimiter) return "rpar" === name;
	return false;
}

/**
 * Matches `@lezer/markdown`'s `SetextHeadingParser` underline check:
 * `line.depth >= cx.depth`, `line.indent < line.baseIndent + 4`, and
 * `line.text` from `line.pos` is `=+` or `-+` followed only by whitespace.
 */
function isSetextUnderlineLine(cx: BlockContext, line: Line): boolean {
	if (getLineDepth(line) < cx.depth || line.indent >= line.baseIndent + 4) return false;
	const next = line.next;
	if (45 /* - */ !== next && 61 /* = */ !== next) return false;
	let pos = line.pos + 1;
	const len = line.text.length;
	while (pos < len && line.text.charCodeAt(pos) === next) pos += 1;
	while (pos < len) {
		if (isLezerSpaceCode(line.text.charCodeAt(pos))) pos += 1;
		else return false;
	}
	return true;
}

/**
 * Incremental O(N) CommonMark §4.7 `LinkReference` leaf block parser matching
 * `League\CommonMark\Reference\ReferenceParser` + `LinkParserHelper` 2.8.2.
 */
class LeagueLinkReferenceParser implements LeafBlockParser {
	private colonRange: SourceRange | null = null;
	private enteredTitleAfterValidSnapshot = false;
	private labelCodePoints = 0;
	private labelHasNonWs = false;
	private labelRange: SourceRange | null = null;
	private labelStartOffset = 0;
	private readonly maxContainerDepth: number | undefined;
	private readonly onUnverifiableRange: ((from: number, to: number) => void) | undefined;
	private stage: RefStage = RefStage.Label;
	private start: number;
	private titleDelimiter = 0;
	private titleRange: SourceRange | null = null;
	private titleStartOffset = -1;
	private urlRange: SourceRange | null = null;
	private validSnapshot: ValidRefSnapshot | null = null;

	constructor(
		leaf: LeafBlock,
		onUnverifiableRange?: (from: number, to: number) => void,
		maxContainerDepth?: number,
	) {
		this.start = leaf.start;
		this.onUnverifiableRange = onUnverifiableRange;
		this.maxContainerDepth = maxContainerDepth;
		this.feedLine(leaf.content, 1, 0);
	}

	private isLazyRefStartAtMaxDepth(cx: BlockContext, line: Line): boolean {
		if (
			undefined === this.maxContainerDepth ||
			cx.depth <= this.maxContainerDepth ||
			getLineDepth(line) >= cx.depth ||
			91 /* [ */ !== line.next
		) {
			return false;
		}
		const blockType =
			cx.parser.nodeSet.types[(cx as InternalRefBlockContext).block.type]?.name;
		return "Blockquote" === blockType || "ListItem" === blockType;
	}

	private shouldAbsorbContinuationAtMaxDepth(
		cx: BlockContext,
		line: Line,
	): boolean {
		return (
			undefined !== this.maxContainerDepth &&
			cx.depth >= this.maxContainerDepth &&
			!(91 /* [ */ === line.next && line.indent < line.baseIndent + 4)
		);
	}

	private buildReferenceElement(
		cx: BlockContext,
		endOffset: number,
		snapshot: ValidRefSnapshot | null,
		titleRange: SourceRange | null,
	): Element {
		const label = snapshot ? snapshot.labelRange : this.labelRange;
		const colon = snapshot ? snapshot.colonRange : this.colonRange;
		const url = snapshot ? snapshot.urlRange : this.urlRange;
		const children: Element[] = [];
		if (label) {
			children.push(
				cx.elt("LinkLabel", this.start + label.from, this.start + label.to),
			);
		}
		if (colon) {
			children.push(
				cx.elt("LinkMark", this.start + colon.from, this.start + colon.to),
			);
		}
		if (url) {
			children.push(
				cx.elt("URL", this.start + url.from, this.start + url.to),
			);
		}
		if (titleRange) {
			children.push(
				cx.elt(
					"LinkTitle",
					this.start + titleRange.from,
					this.start + titleRange.to,
				),
			);
		}
		const refFrom = this.start + (label ? label.from : 0);
		return cx.elt("LinkReference", refFrom, this.start + endOffset, children);
	}

	private emitReferenceElement(
		cx: BlockContext,
		leaf: LeafBlock,
		refElt: Element,
	): void {
		const internalLeaf = asInternalLeafBlock(leaf);
		const allMarks = internalLeaf.marks;
		if (allMarks.length > 0) {
			internalLeaf.marks = allMarks.filter(
				(mark) => mark.from >= refElt.from && mark.to <= refElt.to,
			);
		}
		cx.addLeafElement(leaf, refElt);
	}

	/**
	 * Matches League 2.8.2 when a lazy `[label]: url` line exits a depth-100
	 * container into depth-99 (`cx.depth > maxContainerDepth` and
	 * `getLineDepth(line) < cx.depth`): emit the completed reference and
	 * restart reference parsing in-place on `leaf` without closing the active
	 * container so a following block-level opener (e.g. `<div>`) still sees
	 * `lineDepth < cx.depth`.
	 */
	private emitAndRestartLazyRefInPlace(
		cx: BlockContext,
		line: Line,
		leaf: LeafBlock,
		endOffset: number,
		snapshot: ValidRefSnapshot | null,
		titleRange: SourceRange | null,
	): boolean {
		this.emitReferenceElement(
			cx,
			leaf,
			this.buildReferenceElement(cx, endOffset, snapshot, titleRange),
		);
		const internalLeaf = asInternalLeafBlock(leaf);
		const nextLeafStart = cx.lineStart - 1;
		internalLeaf.start = nextLeafStart;
		internalLeaf.content = "";
		internalLeaf.marks = [];
		this.start = nextLeafStart;
		this.colonRange = null;
		this.enteredTitleAfterValidSnapshot = false;
		this.labelCodePoints = 0;
		this.labelHasNonWs = false;
		this.labelRange = null;
		this.labelStartOffset = 1 + line.pos;
		this.stage = RefStage.Label;
		this.titleDelimiter = 0;
		this.titleRange = null;
		this.titleStartOffset = -1;
		this.urlRange = null;
		this.validSnapshot = null;
		this.feedLine(line.text, line.pos + 1, 1);
		return false;
	}

	private emitValidAndSplitLeaf(
		cx: BlockContext,
		leaf: LeafBlock,
		failedTitleEnd?: number,
	): boolean {
		const snapshot = this.validSnapshot;
		if (!snapshot) return false;
		const refEnd = this.start + snapshot.endOffset;
		const paraStart = refEnd + 1;
		if (this.enteredTitleAfterValidSnapshot) {
			const unverifiableEnd = failedTitleEnd ?? this.start + leaf.content.length;
			if (paraStart < unverifiableEnd) {
				this.onUnverifiableRange?.(paraStart, unverifiableEnd);
			}
		}
		const refElt = this.buildReferenceElement(
			cx,
			snapshot.endOffset,
			snapshot,
			snapshot.titleRange,
		);
		if (snapshot.endOffset >= leaf.content.length) {
			this.emitReferenceElement(cx, leaf, refElt);
			this.stage = RefStage.Failed;
			this.validSnapshot = null;
			return true;
		}
		const internalLeaf = asInternalLeafBlock(leaf);
		const allMarks = internalLeaf.marks;
		const refMarks: Element[] = [];
		const paraMarks: Element[] = [];
		for (const mark of allMarks) {
			if (mark.from >= refElt.from && mark.to <= refEnd) refMarks.push(mark);
			else if (mark.from >= paraStart) paraMarks.push(mark);
		}
		internalLeaf.marks = refMarks;
		cx.addLeafElement(leaf, refElt);
		internalLeaf.start = paraStart;
		internalLeaf.content = internalLeaf.content.slice(snapshot.endOffset + 1);
		internalLeaf.marks = paraMarks;
		this.stage = RefStage.Failed;
		this.validSnapshot = null;
		return false;
	}

	private feedLine(
		lineText: string,
		startPos: number,
		lineOffset: number,
	): "continue" | "complete" | "emit-previous" | "fail" {
		const lineLen = lineText.length;
		let pos = startPos;
		for (;;) {
			if (RefStage.Label === this.stage) {
				pos = skipSpaceOrTab(lineText, pos, lineLen);
				while (pos < lineLen) {
					const ch = lineText.charCodeAt(pos);
					if (92 /* \ */ === ch) {
						if (pos + 1 < lineLen) {
							this.labelCodePoints += 2;
							if (this.labelCodePoints > MAX_LINK_LABEL_CODE_POINTS) {
								this.stage = RefStage.Failed;
								return "fail";
							}
							this.labelHasNonWs = true;
							pos = advanceCodePoint(lineText, pos + 1, lineLen);
							continue;
						}
						this.labelCodePoints += 1;
						if (this.labelCodePoints > MAX_LINK_LABEL_CODE_POINTS) {
							this.stage = RefStage.Failed;
							return "fail";
						}
						this.labelHasNonWs = true;
						pos += 1;
						break;
					}
					if (91 /* [ */ === ch || 93 /* ] */ === ch) break;
					this.labelCodePoints += 1;
					if (this.labelCodePoints > MAX_LINK_LABEL_CODE_POINTS) {
						this.stage = RefStage.Failed;
						return "fail";
					}
					if (!isCommonMarkWhitespaceCode(ch)) this.labelHasNonWs = true;
					pos = advanceCodePoint(lineText, pos, lineLen);
				}
				if (pos === lineLen) {
					this.labelCodePoints += 1;
					if (this.labelCodePoints > MAX_LINK_LABEL_CODE_POINTS) {
						this.stage = RefStage.Failed;
						return "fail";
					}
					return "continue";
				}
				if (
					93 /* ] */ !== lineText.charCodeAt(pos) ||
					pos + 1 >= lineLen ||
					58 /* : */ !== lineText.charCodeAt(pos + 1) ||
					!this.labelHasNonWs
				) {
					this.stage = RefStage.Failed;
					return "fail";
				}
				this.labelRange = {
					from: this.labelStartOffset,
					to: lineOffset + pos + 1,
				};
				this.colonRange = {
					from: lineOffset + pos + 1,
					to: lineOffset + pos + 2,
				};
				pos = skipSpaceOrTab(lineText, pos + 2, lineLen);
				this.stage = RefStage.Destination;
				if (pos === lineLen) return "continue";
				continue;
			}

			if (RefStage.Destination === this.stage) {
				pos = skipSpaceOrTab(lineText, pos, lineLen);
				const dest = scanLinkDestinationRange(lineText, pos, lineLen);
				if (!dest) {
					this.stage = RefStage.Failed;
					return "fail";
				}
				this.urlRange = {
					from: lineOffset + dest.from,
					to: lineOffset + dest.to,
				};
				const afterDest = dest.to;
				pos = skipSpaceOrTab(lineText, afterDest, lineLen);
				if (pos === lineLen) {
					if (this.labelRange && this.colonRange) {
						this.validSnapshot = {
							colonRange: this.colonRange,
							endOffset: lineOffset + lineLen,
							labelRange: this.labelRange,
							titleRange: null,
							urlRange: this.urlRange,
						};
					}
					this.stage = RefStage.StartTitleNextLine;
					return "continue";
				}
				if (pos === afterDest) {
					this.stage = RefStage.Failed;
					return "fail";
				}
				this.stage = RefStage.StartTitleSameLine;
				continue;
			}

			if (
				RefStage.StartTitleSameLine === this.stage ||
				RefStage.StartTitleNextLine === this.stage
			) {
				pos = skipSpaceOrTab(lineText, pos, lineLen);
				if (pos === lineLen) {
					if (RefStage.StartTitleNextLine === this.stage) return "emit-previous";
					this.stage = RefStage.Failed;
					return "fail";
				}
				const ch = lineText.charCodeAt(pos);
				if (34 /* " */ === ch || 39 /* ' */ === ch || 40 /* ( */ === ch) {
					if (RefStage.StartTitleNextLine === this.stage) {
						this.enteredTitleAfterValidSnapshot = true;
					}
					this.titleDelimiter = 40 === ch ? 41 : ch;
					this.titleStartOffset = lineOffset + pos;
					this.stage = RefStage.Title;
					pos += 1;
					if (pos === lineLen) return "continue";
					continue;
				}
				if (RefStage.StartTitleNextLine === this.stage) {
					return "emit-previous";
				}
				// Mirror League `ReferenceParser::parseStartTitle()` (lines 256-260):
				// discard the unfinished same-line definition and retry
				// `START_DEFINITION` at the same cursor position on the same line.
				if (91 /* [ */ === ch) {
					this.colonRange = null;
					this.labelCodePoints = 0;
					this.labelHasNonWs = false;
					this.labelRange = null;
					this.labelStartOffset = lineOffset + pos;
					this.urlRange = null;
					this.stage = RefStage.Label;
					pos += 1;
					if (pos === lineLen) {
						this.labelCodePoints = 1;
						return "continue";
					}
					continue;
				}
				this.stage = RefStage.Failed;
				return "fail";
			}

			if (RefStage.Title === this.stage) {
				const scanStart = pos;
				let foundClose = false;
				let lastTokenWasEscapedDelim = false;
				while (pos < lineLen) {
					const ch = lineText.charCodeAt(pos);
					if (
						92 /* \ */ === ch &&
						pos + 1 < lineLen &&
						isAsciiPunctCode(lineText.charCodeAt(pos + 1))
					) {
						lastTokenWasEscapedDelim =
							lineText.charCodeAt(pos + 1) === this.titleDelimiter;
						pos += 2;
						continue;
					}
					lastTokenWasEscapedDelim = false;
					if (ch === this.titleDelimiter) {
						this.titleRange = {
							from: this.titleStartOffset,
							to: lineOffset + pos + 1,
						};
						pos += 1;
						foundClose = true;
						break;
					}
					pos += 1;
				}
				if (
					!foundClose &&
					endsWithUnescapedTitleDelimiter(
						lineText,
						scanStart,
						lineLen,
						this.titleDelimiter,
						lastTokenWasEscapedDelim,
					)
				) {
					this.titleRange = {
						from: this.titleStartOffset,
						to: lineOffset + lineLen,
					};
					foundClose = true;
				}
				if (!foundClose) return "continue";
				pos = skipSpaceOrTab(lineText, pos, lineLen);
				if (pos < lineLen) {
					this.stage = RefStage.Failed;
					return "fail";
				}
				this.stage = RefStage.Complete;
				return "complete";
			}

			return "fail";
		}
	}

	nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
		if (
			RefStage.Failed === this.stage ||
			RefStage.AbsorbRemainder === this.stage
		) {
			return false;
		}
		if (RefStage.Complete === this.stage) {
			if (
				this.isLazyRefStartAtMaxDepth(cx, line) &&
				this.labelRange &&
				this.colonRange &&
				this.urlRange
			) {
				return this.emitAndRestartLazyRefInPlace(
					cx,
					line,
					leaf,
					leaf.content.length,
					null,
					this.titleRange,
				);
			}
			if (
				this.shouldAbsorbContinuationAtMaxDepth(cx, line) &&
				this.labelRange &&
				this.colonRange &&
				this.urlRange
			) {
				this.validSnapshot = {
					colonRange: this.colonRange,
					endOffset: leaf.content.length,
					labelRange: this.labelRange,
					titleRange: this.titleRange,
					urlRange: this.urlRange,
				};
				this.stage = RefStage.AbsorbRemainder;
				return false;
			}
			this.emitReferenceElement(
				cx,
				leaf,
				this.buildReferenceElement(
					cx,
					leaf.content.length,
					null,
					this.titleRange,
				),
			);
			return true;
		}
		if (
			RefStage.Title === this.stage &&
			null !== this.validSnapshot &&
			(undefined === this.maxContainerDepth ||
				cx.depth < this.maxContainerDepth) &&
			isSetextUnderlineLine(cx, line)
		) {
			return this.emitValidAndSplitLeaf(cx, leaf);
		}
		const lineOffset = leaf.content.length + 1;
		const outcome = this.feedLine(line.text, line.basePos, lineOffset);
		if ("emit-previous" === outcome) {
			if (
				null !== this.validSnapshot &&
				this.validSnapshot.endOffset >= leaf.content.length
			) {
				if (this.isLazyRefStartAtMaxDepth(cx, line)) {
					return this.emitAndRestartLazyRefInPlace(
						cx,
						line,
						leaf,
						this.validSnapshot.endOffset,
						this.validSnapshot,
						this.validSnapshot.titleRange,
					);
				}
				if (this.shouldAbsorbContinuationAtMaxDepth(cx, line)) {
					this.stage = RefStage.AbsorbRemainder;
					return false;
				}
			}
			return this.emitValidAndSplitLeaf(cx, leaf);
		}
		if ("complete" === outcome) {
			if (
				undefined !== this.maxContainerDepth &&
				cx.depth >= this.maxContainerDepth
			) {
				return false;
			}
			const internalLeaf = asInternalLeafBlock(leaf);
			for (const mark of line.markers) internalLeaf.marks.push(mark);
			const endOffset = lineOffset + line.text.length;
			cx.nextLine();
			this.emitReferenceElement(
				cx,
				leaf,
				this.buildReferenceElement(cx, endOffset, null, this.titleRange),
			);
			return true;
		}
		if ("fail" === outcome) {
			if (
				null !== this.validSnapshot &&
				this.validSnapshot.endOffset >= leaf.content.length &&
				this.shouldAbsorbContinuationAtMaxDepth(cx, line)
			) {
				if (this.enteredTitleAfterValidSnapshot) {
					const paraStart = this.start + this.validSnapshot.endOffset + 1;
					const unverifiableEnd = cx.lineStart + line.text.length;
					if (paraStart < unverifiableEnd) {
						this.onUnverifiableRange?.(paraStart, unverifiableEnd);
					}
				}
				this.stage = RefStage.AbsorbRemainder;
				return false;
			}
			return this.emitValidAndSplitLeaf(cx, leaf, cx.lineStart + line.text.length);
		}
		return false;
	}

	finish(cx: BlockContext, leaf: LeafBlock): boolean {
		if (RefStage.Complete === this.stage) {
			this.emitReferenceElement(
				cx,
				leaf,
				this.buildReferenceElement(
					cx,
					leaf.content.length,
					null,
					this.titleRange,
				),
			);
			return true;
		}
		if (null !== this.validSnapshot) {
			return this.emitValidAndSplitLeaf(cx, leaf);
		}
		return false;
	}
}

export function createLeagueLinkReferenceLeafParser(
	leaf: LeafBlock,
	onUnverifiableRange?: (from: number, to: number) => void,
	maxContainerDepth?: number,
): LeafBlockParser | null {
	return 91 /* [ */ === leaf.content.charCodeAt(0)
		? new LeagueLinkReferenceParser(leaf, onUnverifiableRange, maxContainerDepth)
		: null;
}
