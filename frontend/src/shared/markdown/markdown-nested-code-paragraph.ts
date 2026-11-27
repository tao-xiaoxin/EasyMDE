import { markdownLanguage } from "@codemirror/lang-markdown";
import { advanceMarkdownColumns } from "./markdown-char-codes";
import {
	lineBoundsAt,
	lineIndexAtOffset,
	markdownLineStarts,
} from "./markdown-line-model";
import {
	projectedOffsetAt,
	projectNewlines,
} from "./markdown-source-projection";

export type NestedCodeParagraphRelative = "after" | "before";

export type NestedCodeParagraphSelection = Readonly<{ direction: "none"; end: number; start: number }>;
export type NestedCodeParagraphRange = Readonly<{ from: number; to: number }>;
export type NestedCodeParagraphEdit = Readonly<{
	changes: Readonly<{ from: number; insert: string; to: number }>;
	selection: NestedCodeParagraphSelection;
	value: string;
}>;
export type NestedCodeContainerAncestor = Readonly<{
	from: number;
	kind: "blockquote" | "list-item";
	to: number;
}>;
export type DescribedNestedCodeNode = Readonly<{
	ancestors: ReadonlyArray<NestedCodeContainerAncestor>;
	blockquoteDepth: number;
	closeLine: number;
	codeInfo: string;
	expectedContentColumn: number;
	expectedPrefix: string;
	from: number;
	kind: "fenced" | "indented";
	openLine: number;
	outermostContainer: NestedCodeParagraphRange;
	to: number;
}>;

type ParsedContainerAncestor =
	| Readonly<{ firstQuoteMark: NestedCodeParagraphRange | null; from: number; kind: "blockquote"; to: number }>
	| Readonly<{ from: number; kind: "list-item"; listMark: NestedCodeParagraphRange | null; to: number }>;

type ParsedNestedCodeNode = Readonly<{
	ancestors: ReadonlyArray<ParsedContainerAncestor>;
	codeInfo: string;
	from: number;
	kind: "fenced" | "indented";
	outermostContainer: NestedCodeParagraphRange;
	to: number;
}>;

type CodeBlockVerificationSignature = Readonly<{
	ancestorKinds: ReadonlyArray<"blockquote" | "list-item">;
	codeInfo: string;
	codeMarks: ReadonlyArray<string>;
	codeTexts: ReadonlyArray<string>;
	kind: "fenced" | "indented";
	lineCount: number;
}>;

type ContainerVerificationSnapshot = Readonly<{
	blockquoteCount: number;
	bulletListCount: number;
	codeBlocks: ReadonlyArray<CodeBlockVerificationSignature>;
	listItemCount: number;
	orderedListCount: number;
}>;

type InsertionCandidate = Readonly<{
	originalCaretDelta: number;
	originalInsert: string;
	sliceCaretDelta: number;
	sliceInsert: string;
	sliceInsertPoint: number;
}>;

const TYPED_PROBE_WORD = "NEWPARA";

function detectDocumentNewline(value: string): string {
	for (let index = 0; index < value.length; index += 1) {
		const ch = value[index];
		if (ch === "\r") {
			return value[index + 1] === "\n" ? "\r\n" : "\r";
		}
		if (ch === "\n") {
			return "\n";
		}
	}
	return "\n";
}

function offsetForColumnOnLine(
	text: string,
	lineStart: number,
	lineEnd: number,
	targetColumn: number,
): number | null {
	let column = 0;
	for (let index = lineStart; index < lineEnd; index += 1) {
		if (column === targetColumn) return index;
		const nextColumn =
			text[index] === "\t" ? column + 4 - (column % 4) : column + 1;
		if (nextColumn > targetColumn) {
			// Target column lands strictly inside a tab character.
			return null;
		}
		column = nextColumn;
	}
	return column === targetColumn ? lineEnd : null;
}

function collectNestedCodeNodes(text: string): ParsedNestedCodeNode[] {
	const tree = markdownLanguage.parser.parse(text);
	const results: ParsedNestedCodeNode[] = [];
	const containerStack: Array<
		| { firstQuoteMark: NestedCodeParagraphRange | null; from: number; kind: "blockquote"; to: number }
		| { from: number; kind: "list-item"; listMark: NestedCodeParagraphRange | null; to: number }
	> = [];
	const outerStack: NestedCodeParagraphRange[] = [];
	const activeCodeStack: Array<Omit<ParsedNestedCodeNode, "codeInfo"> & { codeInfo: string }> = [];

	tree.iterate({
		enter(node) {
			if (
				node.name === "Blockquote" ||
				node.name === "BulletList" ||
				node.name === "OrderedList"
			) {
				outerStack.push({ from: node.from, to: node.to });
			}
			if (node.name === "Blockquote") {
				containerStack.push({ firstQuoteMark: null, from: node.from, kind: "blockquote", to: node.to });
				return;
			}
			if (node.name === "ListItem") {
				containerStack.push({ from: node.from, kind: "list-item", listMark: null, to: node.to });
				return;
			}
			if (node.name === "QuoteMark") {
				const top = containerStack[containerStack.length - 1];
				if (top?.kind === "blockquote" && top.firstQuoteMark === null) {
					top.firstQuoteMark = { from: node.from, to: node.to };
				}
				return;
			}
			if (node.name === "ListMark") {
				const top = containerStack[containerStack.length - 1];
				if (top?.kind === "list-item" && top.listMark === null) {
					top.listMark = { from: node.from, to: node.to };
				}
				return;
			}
			if (node.name === "FencedCode" || node.name === "CodeBlock") {
				const outermost = outerStack[0];
				if (containerStack.length > 0 && outermost) {
					activeCodeStack.push({
						ancestors: containerStack.map((entry) => ({ ...entry })),
						codeInfo: "",
						from: node.from,
						kind: node.name === "FencedCode" ? "fenced" : "indented",
						outermostContainer: outermost,
						to: node.to,
					});
				}
				return;
			}
			if (node.name === "CodeInfo") {
				const active = activeCodeStack[activeCodeStack.length - 1];
				if (active) active.codeInfo = text.slice(node.from, node.to);
			}
		},
		leave(node) {
			if (node.name === "FencedCode" || node.name === "CodeBlock") {
				const finished = activeCodeStack.pop();
				if (finished) results.push(finished);
			}
			if (node.name === "Blockquote" || node.name === "ListItem") {
				containerStack.pop();
			}
			if (
				node.name === "Blockquote" ||
				node.name === "BulletList" ||
				node.name === "OrderedList"
			) {
				outerStack.pop();
			}
		},
	});

	return results;
}

function resolveContinuationPrefix(
	text: string,
	starts: ReadonlyArray<number>,
	ancestors: ReadonlyArray<ParsedContainerAncestor>,
): Readonly<{ contentColumn: number; prefix: string }> | null {
	let currentColumn = 0;
	const parts: string[] = [];

	for (const ancestor of ancestors) {
		if (ancestor.kind === "blockquote") {
			const quoteMark = ancestor.firstQuoteMark;
			if (!quoteMark) return null;
			const line = lineBoundsAt(text, starts, quoteMark.from);
			const quoteColumn = advanceMarkdownColumns(
				text.slice(line.start, quoteMark.from),
				0,
			);
			const leadingSpaces = Math.max(0, quoteColumn - currentColumn);
			const afterQuoteChar =
				quoteMark.to < line.end ? text[quoteMark.to] : undefined;
			parts.push(`${" ".repeat(leadingSpaces)}> `);
			currentColumn =
				afterQuoteChar === " " || afterQuoteChar === "\t"
					? quoteColumn + 2
					: quoteColumn + 1;
			continue;
		}

		const listMark = ancestor.listMark;
		if (!listMark) return null;
		const line = lineBoundsAt(text, starts, listMark.from);
		const markEndColumn = advanceMarkdownColumns(
			text.slice(line.start, listMark.to),
			0,
		);
		let firstNonWhitespace = listMark.to;
		while (
			firstNonWhitespace < line.end &&
			(text[firstNonWhitespace] === " " || text[firstNonWhitespace] === "\t")
		) {
			firstNonWhitespace += 1;
		}
		let contentColumn: number;
		if (firstNonWhitespace >= line.end) {
			contentColumn = markEndColumn + 1;
		} else {
			const firstContentColumn = advanceMarkdownColumns(
				text.slice(listMark.to, firstNonWhitespace),
				markEndColumn,
			);
			const spacingColumns = firstContentColumn - markEndColumn;
			if (spacingColumns < 1) return null;
			// CommonMark §5.2: >= 5 columns after the marker begins an indented
			// code block whose list-item content column is marker_end + 1.
			contentColumn =
				spacingColumns >= 5 ? markEndColumn + 1 : firstContentColumn;
		}
		const indentWidth = contentColumn - currentColumn;
		if (indentWidth <= 0) return null;
		parts.push(" ".repeat(indentWidth));
		currentColumn = contentColumn;
	}

	const prefix = parts.join("");
	if (prefix.length === 0) return null;
	return { contentColumn: currentColumn, prefix };
}

function snapshotContainerStructure(text: string): ContainerVerificationSnapshot {
	const starts = markdownLineStarts(text);
	const tree = markdownLanguage.parser.parse(text);
	let blockquoteCount = 0;
	let bulletListCount = 0;
	let orderedListCount = 0;
	let listItemCount = 0;
	const containerKinds: Array<"blockquote" | "list-item"> = [];
	const codeBlocks: CodeBlockVerificationSignature[] = [];
	const activeCodeStack: Array<{
		ancestorKinds: ReadonlyArray<"blockquote" | "list-item">;
		codeInfo: string;
		codeMarks: string[];
		codeTexts: string[];
		from: number;
		kind: "fenced" | "indented";
		to: number;
	}> = [];

	tree.iterate({
		enter(node) {
			if (node.name === "Blockquote") {
				blockquoteCount += 1;
				containerKinds.push("blockquote");
				return;
			}
			if (node.name === "BulletList") {
				bulletListCount += 1;
				return;
			}
			if (node.name === "OrderedList") {
				orderedListCount += 1;
				return;
			}
			if (node.name === "ListItem") {
				listItemCount += 1;
				containerKinds.push("list-item");
				return;
			}
			if (node.name === "FencedCode" || node.name === "CodeBlock") {
				activeCodeStack.push({
					ancestorKinds: [...containerKinds],
					codeInfo: "",
					codeMarks: [],
					codeTexts: [],
					from: node.from,
					kind: node.name === "FencedCode" ? "fenced" : "indented",
					to: node.to,
				});
				return;
			}
			const active = activeCodeStack[activeCodeStack.length - 1];
			if (!active) return;
			if (node.name === "CodeMark") {
				active.codeMarks.push(text.slice(node.from, node.to));
			} else if (node.name === "CodeInfo") {
				active.codeInfo = text.slice(node.from, node.to);
			} else if (node.name === "CodeText") {
				active.codeTexts.push(text.slice(node.from, node.to));
			}
		},
		leave(node) {
			if (node.name === "Blockquote" || node.name === "ListItem") {
				containerKinds.pop();
				return;
			}
			if (node.name === "FencedCode" || node.name === "CodeBlock") {
				const finished = activeCodeStack.pop();
				if (!finished) return;
				const startLine = lineIndexAtOffset(starts, finished.from);
				const endLine = lineIndexAtOffset(
					starts,
					Math.max(finished.from, finished.to - 1),
				);
				codeBlocks.push({
					ancestorKinds: finished.ancestorKinds,
					codeInfo: finished.codeInfo,
					codeMarks: finished.codeMarks,
					codeTexts: finished.codeTexts,
					kind: finished.kind,
					lineCount: endLine - startLine + 1,
				});
			}
		},
	});

	return {
		blockquoteCount,
		bulletListCount,
		codeBlocks,
		listItemCount,
		orderedListCount,
	};
}

function arrayElementsEqual<T>(
	left: ReadonlyArray<T>,
	right: ReadonlyArray<T>,
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function snapshotsMatch(
	before: ContainerVerificationSnapshot,
	after: ContainerVerificationSnapshot,
): boolean {
	if (
		before.blockquoteCount !== after.blockquoteCount ||
		before.bulletListCount !== after.bulletListCount ||
		before.orderedListCount !== after.orderedListCount ||
		before.listItemCount !== after.listItemCount ||
		before.codeBlocks.length !== after.codeBlocks.length ||
		before.codeBlocks.length === 0
	) {
		return false;
	}
	for (let index = 0; index < before.codeBlocks.length; index += 1) {
		const left = before.codeBlocks[index];
		const right = after.codeBlocks[index];
		if (
			!left ||
			!right ||
			left.kind !== right.kind ||
			left.codeInfo !== right.codeInfo ||
			left.lineCount !== right.lineCount ||
			!arrayElementsEqual(left.ancestorKinds, right.ancestorKinds) ||
			!arrayElementsEqual(left.codeMarks, right.codeMarks) ||
			!arrayElementsEqual(left.codeTexts, right.codeTexts)
		) {
			return false;
		}
	}
	return true;
}

function hasListItemStartingWithTwoBlankLines(text: string): boolean {
	const starts = markdownLineStarts(text);
	const tree = markdownLanguage.parser.parse(text);
	let blockquoteDepth = 0;
	let violates = false;
	const listItemStack: Array<{
		blockquoteDepth: number;
		from: number;
		listMark: NestedCodeParagraphRange | null;
		to: number;
	}> = [];

	tree.iterate({
		enter(node) {
			if (violates) return false;
			if (node.name === "Blockquote") {
				blockquoteDepth += 1;
				return undefined;
			}
			if (node.name === "ListItem") {
				listItemStack.push({
					blockquoteDepth,
					from: node.from,
					listMark: null,
					to: node.to,
				});
				return undefined;
			}
			if (node.name === "ListMark") {
				const top = listItemStack[listItemStack.length - 1];
				if (top && top.listMark === null) {
					top.listMark = { from: node.from, to: node.to };
				}
			}
			return undefined;
		},
		leave(node) {
			if (node.name === "Blockquote") {
				blockquoteDepth = Math.max(0, blockquoteDepth - 1);
				return;
			}
			if (node.name === "ListItem") {
				const item = listItemStack.pop();
				if (violates || !item?.listMark) return;
				const firstLine = lineBoundsAt(text, starts, item.listMark.from);
				if (text.slice(item.listMark.to, firstLine.end).trim().length > 0) {
					return;
				}
				const secondLineStart = starts[firstLine.index + 1];
				if (secondLineStart === undefined) return;
				const secondLine = lineBoundsAt(text, starts, secondLineStart);
				if (item.to <= secondLine.end) return;

				let rest = text.slice(secondLine.start, secondLine.end);
				for (let depth = 0; depth < item.blockquoteDepth; depth += 1) {
					const match = /^[ \t]*>[ \t]?/u.exec(rest);
					if (!match) break;
					rest = rest.slice(match[0].length);
				}
				if (rest.trim().length === 0) {
					// CommonMark §5.2: a list item can begin with at most one blank line.
					violates = true;
				}
			}
		},
	});

	return violates;
}

function verifyProbeInsideExpectedParagraph(
	typedContainer: string,
	probeFrom: number,
	probeTo: number,
	expectedAncestorKinds: ReadonlyArray<"blockquote" | "list-item">,
	expectedAncestorFroms?: ReadonlyArray<number>,
): boolean {
	if (typedContainer.slice(probeFrom, probeTo) !== TYPED_PROBE_WORD) {
		return false;
	}
	const tree = markdownLanguage.parser.parse(typedContainer);
	const containerKinds: Array<"blockquote" | "list-item"> = [];
	const containerFroms: number[] = [];
	let matchedParagraph = false;
	let overlappedForbidden = false;

	tree.iterate({
		enter(node) {
			if (node.name === "Blockquote") {
				containerKinds.push("blockquote");
				containerFroms.push(node.from);
				return;
			}
			if (node.name === "ListItem") {
				containerKinds.push("list-item");
				containerFroms.push(node.from);
				return;
			}
			if (
				node.name === "FencedCode" ||
				node.name === "CodeBlock" ||
				node.name === "CodeText" ||
				node.name === "InlineCode" ||
				node.name === "HTMLBlock" ||
				node.name === "CommentBlock"
			) {
				if (node.from < probeTo && node.to > probeFrom) {
					overlappedForbidden = true;
				}
				return;
			}
			if (
				node.name === "Paragraph" &&
				node.from <= probeFrom &&
				probeTo <= node.to &&
				arrayElementsEqual(containerKinds, expectedAncestorKinds) &&
				(!expectedAncestorFroms ||
					arrayElementsEqual(containerFroms, expectedAncestorFroms))
			) {
				matchedParagraph = true;
			}
		},
		leave(node) {
			if (node.name === "Blockquote" || node.name === "ListItem") {
				containerKinds.pop();
				containerFroms.pop();
			}
		},
	});

	return matchedParagraph && !overlappedForbidden;
}

/**
 * Describes every Lezer-parsed nested code block (`FencedCode` / `CodeBlock`)
 * with its container ancestor chain and CommonMark §5.2 continuation prefix.
 */
export function describeNestedCodeNodes(
	text: string,
	starts: ReadonlyArray<number>,
): DescribedNestedCodeNode[] {
	const described: DescribedNestedCodeNode[] = [];
	for (const node of collectNestedCodeNodes(text)) {
		const resolved = resolveContinuationPrefix(text, starts, node.ancestors);
		if (!resolved) continue;
		const blockquoteDepth = node.ancestors.filter(
			(a) => a.kind === "blockquote",
		).length;
		described.push({
			ancestors: node.ancestors.map(({ from, kind, to }) => ({ from, kind, to })),
			blockquoteDepth,
			closeLine: lineIndexAtOffset(starts, Math.max(node.from, node.to - 1)),
			codeInfo: node.codeInfo,
			expectedContentColumn: resolved.contentColumn,
			expectedPrefix: resolved.prefix,
			from: node.from,
			kind: node.kind,
			openLine: lineIndexAtOffset(starts, node.from),
			outermostContainer: node.outermostContainer,
			to: node.to,
		});
	}
	return described;
}

/**
 * Verifies that typing a probe word at `caretOffset` parses as a `Paragraph`
 * whose exact Lezer container ancestor chain (kinds and starting offsets)
 * matches `codeNode.ancestors` while preserving all container/code structure.
 */
export function verifyNestedCodeCaretProbe(
	text: string,
	starts: ReadonlyArray<number>,
	codeNode: DescribedNestedCodeNode,
	caretOffset: number,
	caretLineEnd: number,
): boolean {
	const outer = codeNode.outermostContainer;
	const verifyStart = lineBoundsAt(text, starts, outer.from).start;
	const verifyEnd = Math.max(
		caretLineEnd,
		lineBoundsAt(text, starts, Math.max(outer.from, outer.to - 1)).end,
	);
	if (caretOffset < verifyStart || caretOffset > verifyEnd) return false;
	const beforeSlice = text.slice(verifyStart, verifyEnd);
	const localCaret = caretOffset - verifyStart;
	const typedSlice = `${beforeSlice.slice(0, localCaret)}${TYPED_PROBE_WORD}${beforeSlice.slice(localCaret)}`;
	if (
		!snapshotsMatch(
			snapshotContainerStructure(beforeSlice),
			snapshotContainerStructure(typedSlice),
		)
	) {
		return false;
	}
	return verifyProbeInsideExpectedParagraph(
		typedSlice,
		localCaret,
		localCaret + TYPED_PROBE_WORD.length,
		codeNode.ancestors.map((a) => a.kind),
		codeNode.ancestors.map((a) => a.from - verifyStart),
	);
}

function verifyInsertionCandidate(
	beforeContainer: string,
	beforeSnap: ContainerVerificationSnapshot,
	verifyStart: number,
	candidate: InsertionCandidate,
	expectedAncestorKinds: ReadonlyArray<"blockquote" | "list-item">,
): boolean {
	const localInsert = candidate.sliceInsertPoint - verifyStart;
	const afterContainer =
		beforeContainer.slice(0, localInsert) +
		candidate.sliceInsert +
		beforeContainer.slice(localInsert);

	// 1. Empty-state structural verification (including CommonMark §5.2).
	if (
		hasListItemStartingWithTwoBlankLines(afterContainer) ||
		!snapshotsMatch(beforeSnap, snapshotContainerStructure(afterContainer))
	) {
		return false;
	}

	// 2. Typed-probe structural verification at the exact projected caret.
	const localCaret = localInsert + candidate.sliceCaretDelta;
	const typedContainer =
		afterContainer.slice(0, localCaret) +
		TYPED_PROBE_WORD +
		afterContainer.slice(localCaret);
	if (
		hasListItemStartingWithTwoBlankLines(typedContainer) ||
		!snapshotsMatch(beforeSnap, snapshotContainerStructure(typedContainer))
	) {
		return false;
	}
	return verifyProbeInsideExpectedParagraph(
		typedContainer,
		localCaret,
		localCaret + TYPED_PROBE_WORD.length,
		expectedAncestorKinds,
	);
}

/**
 * Canonical parser-owned builder for inserting an empty paragraph line above
 * or below a code block nested inside a blockquote or list container.
 *
 * Uses `@codemirror/lang-markdown`'s Lezer parser to identify the exact code
 * node (`FencedCode` vs `CodeBlock`) and container ancestor chain, computes
 * continuation indentation strictly from parsed container columns (never
 * copying list markers or regex-guessing fences inside code text), and
 * verifies both the empty state and a typed-probe insertion at the returned
 * caret against container/code invariants and CommonMark §5.2 before emitting
 * any edit.
 */
export function buildNestedCodeParagraphInsertion(
	value: string,
	targetRange: NestedCodeParagraphRange,
	relative: NestedCodeParagraphRelative,
	containerRange?: NestedCodeParagraphRange,
): NestedCodeParagraphEdit | null {
	if (
		!Number.isSafeInteger(targetRange.from) ||
		!Number.isSafeInteger(targetRange.to) ||
		targetRange.from < 0 ||
		targetRange.to < targetRange.from ||
		targetRange.to > value.length
	) {
		return null;
	}
	if (
		containerRange &&
		(!Number.isSafeInteger(containerRange.from) ||
			!Number.isSafeInteger(containerRange.to) ||
			containerRange.from < 0 ||
			containerRange.from > targetRange.from ||
			targetRange.to > containerRange.to ||
			containerRange.to > value.length)
	) {
		return null;
	}

	const newline = detectDocumentNewline(value);
	const projection = projectNewlines(value);
	const fullStarts = markdownLineStarts(projection.text);
	const projTargetFrom = projectedOffsetAt(projection, targetRange.from);
	const projTargetTo = projectedOffsetAt(projection, targetRange.to);

	let sliceOffset = 0;
	let sliceEnd = projection.text.length;
	if (containerRange) {
		const containerStartLine = lineBoundsAt(
			projection.text,
			fullStarts,
			projectedOffsetAt(projection, containerRange.from),
		);
		const projContainerTo = projectedOffsetAt(projection, containerRange.to);
		const containerEndLine = lineBoundsAt(
			projection.text,
			fullStarts,
			Math.max(containerStartLine.start, projContainerTo - 1),
		);
		sliceOffset = containerStartLine.start;
		sliceEnd = containerEndLine.end;
	}

	const sliceText = projection.text.slice(sliceOffset, sliceEnd);
	const sliceStarts = markdownLineStarts(sliceText);
	const sliceTargetFrom = projTargetFrom - sliceOffset;
	const sliceTargetTo = projTargetTo - sliceOffset;

	const candidates = collectNestedCodeNodes(sliceText).filter((candidate) => {
		const openLine = lineBoundsAt(sliceText, sliceStarts, candidate.from);
		const closeLine = lineBoundsAt(
			sliceText,
			sliceStarts,
			Math.max(candidate.from, candidate.to - 1),
		);
		return openLine.start <= sliceTargetFrom && sliceTargetTo <= closeLine.end;
	});
	if (candidates.length !== 1 || !candidates[0]) {
		return null;
	}
	const targetCode = candidates[0];

	const resolved = resolveContinuationPrefix(
		sliceText,
		sliceStarts,
		targetCode.ancestors,
	);
	if (!resolved) {
		return null;
	}

	const openLine = lineBoundsAt(sliceText, sliceStarts, targetCode.from);
	const closeLine = lineBoundsAt(
		sliceText,
		sliceStarts,
		Math.max(targetCode.from, targetCode.to - 1),
	);
	const hasListItemOnOpenLine = targetCode.ancestors.some(
		(ancestor) =>
			ancestor.kind === "list-item" &&
			ancestor.from >= openLine.start &&
			ancestor.from <= openLine.end,
	);
	const blankLine = resolved.prefix.replace(/[ \t]+$/u, "");
	let candidate: InsertionCandidate;

	if (relative === "before") {
		if (hasListItemOnOpenLine) {
			const splitOffset = offsetForColumnOnLine(
				sliceText,
				openLine.start,
				openLine.end,
				resolved.contentColumn,
			);
			if (
				splitOffset === null ||
				splitOffset <= openLine.start ||
				splitOffset > targetCode.from
			) {
				return null;
			}
			if (targetCode.kind === "indented") {
				candidate = {
					originalCaretDelta: 0,
					originalInsert: `${newline}${blankLine}${newline}${resolved.prefix}`,
					sliceCaretDelta: 0,
					sliceInsert: `\n${blankLine}\n${resolved.prefix}`,
					sliceInsertPoint: splitOffset,
				};
			} else {
				candidate = {
					originalCaretDelta: 0,
					originalInsert: `${newline}${resolved.prefix}`,
					sliceCaretDelta: 0,
					sliceInsert: `\n${resolved.prefix}`,
					sliceInsertPoint: splitOffset,
				};
			}
		} else if (targetCode.kind === "indented") {
			candidate = {
				originalCaretDelta: resolved.prefix.length,
				originalInsert: `${resolved.prefix}${newline}${blankLine}${newline}`,
				sliceCaretDelta: resolved.prefix.length,
				sliceInsert: `${resolved.prefix}\n${blankLine}\n`,
				sliceInsertPoint: openLine.start,
			};
		} else {
			candidate = {
				originalCaretDelta: resolved.prefix.length,
				originalInsert: `${resolved.prefix}${newline}`,
				sliceCaretDelta: resolved.prefix.length,
				sliceInsert: `${resolved.prefix}\n`,
				sliceInsertPoint: openLine.start,
			};
		}
	} else if (targetCode.kind === "indented") {
		const sliceInsert = `\n${blankLine}\n${resolved.prefix}`;
		const originalInsert = `${newline}${blankLine}${newline}${resolved.prefix}`;
		candidate = {
			originalCaretDelta: originalInsert.length,
			originalInsert,
			sliceCaretDelta: sliceInsert.length,
			sliceInsert,
			sliceInsertPoint: closeLine.end,
		};
	} else {
		const sliceInsert = `\n${resolved.prefix}`;
		const originalInsert = `${newline}${resolved.prefix}`;
		candidate = {
			originalCaretDelta: originalInsert.length,
			originalInsert,
			sliceCaretDelta: sliceInsert.length,
			sliceInsert,
			sliceInsertPoint: closeLine.end,
		};
	}

	const verifyStart = lineBoundsAt(
		sliceText,
		sliceStarts,
		targetCode.outermostContainer.from,
	).start;
	const verifyEnd = lineBoundsAt(
		sliceText,
		sliceStarts,
		Math.max(
			targetCode.outermostContainer.from,
			targetCode.outermostContainer.to - 1,
		),
	).end;
	const beforeContainer = sliceText.slice(verifyStart, verifyEnd);
	const beforeSnap = snapshotContainerStructure(beforeContainer);
	const expectedAncestorKinds = targetCode.ancestors.map(
		(ancestor) => ancestor.kind,
	);

	if (
		candidate.sliceInsertPoint < verifyStart ||
		candidate.sliceInsertPoint > verifyEnd ||
		!verifyInsertionCandidate(
			beforeContainer,
			beforeSnap,
			verifyStart,
			candidate,
			expectedAncestorKinds,
		)
	) {
		return null;
	}

	const originalInsertPoint =
		projection.originalOffsets[sliceOffset + candidate.sliceInsertPoint];
	if (originalInsertPoint === undefined) {
		return null;
	}
	const nextValue =
		value.slice(0, originalInsertPoint) +
		candidate.originalInsert +
		value.slice(originalInsertPoint);
	const caret = originalInsertPoint + candidate.originalCaretDelta;
	return {
		changes: {
			from: originalInsertPoint,
			insert: candidate.originalInsert,
			to: originalInsertPoint,
		},
		selection: { direction: "none", end: caret, start: caret },
		value: nextValue,
	};
}
