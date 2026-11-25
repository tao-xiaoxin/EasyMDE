import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	createMathNewlineSentinelForNode,
	createPreservingRoundTripGuard,
	joinSerializedBlocks,
	type MarkdownRoundTripGuard,
	type MarkdownSerializers,
	type ReferencePreserveResolver,
	restoreMathNewlineSentinel,
	serializeList,
} from "./markdown-block-preservation";
import {
	chooseTitleQuoteDelimiter,
	escapeCodeSpanTableContent,
	escapeInlineMarkdownText,
	escapeParagraphTableDelimiters,
	escapeRawTablePipes,
	formatQuotedTitle,
	formatReferenceLinkClose,
	isShortcutLinkHijackChar,
} from "./markdown-escape";
import {
	formatLinkDestination,
	serializeImageNode,
} from "./markdown-image-serialization";
import type {
	ParsedVisualDocument,
	ReferenceLinkOrigin,
} from "./markdown-parser";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";
import {
	reconcileTableAlignComment,
	type TableAlignSnapshot,
} from "./table-alignment-codec";
import {
	isValidTableTextAlign,
	normalizeHeadingLevel,
	sanitizeFenceChar,
	sanitizeFenceLength,
	type TableTextAlign,
} from "./visual-schema";

export type { MarkdownRoundTripGuard } from "./markdown-block-preservation";

type InlineSerializeOptions = Readonly<{
	inHeading?: boolean;
	inTableCell?: boolean;
	mathNewlineToken?: string | null;
	resolveReferences?: ReferencePreserveResolver | null;
}>;

const MARK_PRIORITY: Readonly<Record<string, number>> = {
	link: 0,
	strike: 1,
	strong: 2,
	em: 3,
	code: 4,
};

const EMPHASIS_MARK_NAMES: ReadonlySet<string> = new Set([
	"strong",
	"em",
	"strike",
]);

type InlinePiece = Readonly<{
	linkOrigin: ReferenceLinkOrigin | null;
	node: ProseMirrorNode;
}>;

type ActiveMarkEntry = Readonly<{
	linkOrigin: ReferenceLinkOrigin | null;
	mark: Mark;
}>;

type MarkSpan = {
	end: number;
	key: string;
	linkOrigin: ReferenceLinkOrigin | null;
	mark: Mark;
	start: number;
};

function markKey(mark: Mark): string {
	return `${mark.type.name}:${JSON.stringify(mark.attrs)}`;
}

function sameActiveMark(
	left: ActiveMarkEntry,
	right: ActiveMarkEntry,
): boolean {
	return (
		left.mark.eq(right.mark) &&
		(left.mark.type.name !== "link" || left.linkOrigin === right.linkOrigin)
	);
}

function createEffectiveMarkKeyFn(): (
	mark: Mark,
	linkOrigin: ReferenceLinkOrigin | null,
) => string {
	const originIds = new Map<ReferenceLinkOrigin, number>();
	return (mark, linkOrigin) => {
		if (mark.type.name === "link" && linkOrigin !== null) {
			let id = originIds.get(linkOrigin);
			if (id === undefined) {
				id = originIds.size + 1;
				originIds.set(linkOrigin, id);
			}
			return `link-ref:${id}:${JSON.stringify(mark.attrs)}`;
		}
		return markKey(mark);
	};
}

/**
 * Compute the contiguous child range of every mark so the serializer can nest
 * marks by span (longest-running mark outermost) instead of a fixed order,
 * while keeping adjacent reference/inline link marks with distinct origins
 * strictly separate.
 */
function computeMarkSpans(
	pieces: ReadonlyArray<InlinePiece>,
	effectiveMarkKey: (
		mark: Mark,
		linkOrigin: ReferenceLinkOrigin | null,
	) => string,
): MarkSpan[][] {
	const spans: MarkSpan[][] = [];
	for (let i = 0; i < pieces.length; i += 1) {
		spans.push([]);
	}
	const active = new Map<string, MarkSpan>();
	for (let i = 0; i < pieces.length; i += 1) {
		const piece = pieces[i];
		if (!piece) continue;
		const present = new Set<string>();
		for (const mark of piece.node.marks) {
			const linkOrigin = mark.type.name === "link" ? piece.linkOrigin : null;
			const key = effectiveMarkKey(mark, linkOrigin);
			present.add(key);
			let span = active.get(key);
			if (!span) {
				span = { end: i, key, linkOrigin, mark, start: i };
				active.set(key, span);
			}
			span.end = i;
			spans[i]?.push(span);
		}
		for (const key of [...active.keys()]) {
			if (!present.has(key)) {
				active.delete(key);
			}
		}
	}
	return spans;
}

function compareMarkSpans(left: MarkSpan, right: MarkSpan): number {
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.end !== right.end) {
		return right.end - left.end;
	}
	const priorityDiff =
		(MARK_PRIORITY[left.mark.type.name] ?? 5) -
		(MARK_PRIORITY[right.mark.type.name] ?? 5);
	if (priorityDiff !== 0) {
		return priorityDiff;
	}
	return left.key.localeCompare(right.key);
}

function longestCharRun(text: string, ch: string): number {
	let maxRun = 0;
	let current = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === ch) {
			current += 1;
			if (current > maxRun) {
				maxRun = current;
			}
		} else {
			current = 0;
		}
	}
	return maxRun;
}

function formatCodeSpan(content: string, inTableCell: boolean): string {
	const body = inTableCell ? escapeCodeSpanTableContent(content) : content;
	const tickCount = longestCharRun(body, "`") + 1;
	const fence = "`".repeat(tickCount);
	const needsSpacePadding =
		body.startsWith("`") ||
		body.endsWith("`") ||
		(body.startsWith(" ") && body.endsWith(" ") && body.trim().length > 0);
	return needsSpacePadding
		? `${fence} ${body} ${fence}`
		: `${fence}${body}${fence}`;
}

function markOpenSyntax(mark: Mark): string {
	switch (mark.type.name) {
		case "strong":
			return "**";
		case "em":
			return "*";
		case "strike":
			return "~~";
		case "link":
			return "[";
		default:
			return "";
	}
}

function markCloseSyntax(
	mark: Mark,
	inTableCell: boolean,
	mathNewlineToken: string | null,
): string {
	switch (mark.type.name) {
		case "strong":
			return "**";
		case "em":
			return "*";
		case "strike":
			return "~~";
		case "link": {
			const href = typeof mark.attrs.href === "string" ? mark.attrs.href : "";
			const rawTitle =
				typeof mark.attrs.title === "string" && mark.attrs.title.length > 0
					? mark.attrs.title
					: null;
			const destination = formatLinkDestination(href, inTableCell);
			const quoteChar =
				rawTitle === null ? '"' : chooseTitleQuoteDelimiter(rawTitle);
			const safeTitle =
				rawTitle === null
					? null
					: formatQuotedTitle(
							rawTitle,
							inTableCell,
							mathNewlineToken,
							quoteChar,
						);
			return safeTitle !== null
				? `](${destination} ${quoteChar}${safeTitle}${quoteChar})`
				: `](${destination})`;
		}
		default:
			return "";
	}
}

function collectInlinePieces(
	parent: ProseMirrorNode,
	endIndex: number,
	resolveReferences: ReferencePreserveResolver | null,
): InlinePiece[] {
	const pieces: InlinePiece[] = [];
	for (let i = 0; i < endIndex; i += 1) {
		const child = parent.child(i);
		let linkOrigin: ReferenceLinkOrigin | null = null;
		if (resolveReferences !== null && child.marks.length > 0) {
			const linkMark = child.marks.find((mark) => mark.type.name === "link");
			if (linkMark) {
				linkOrigin = resolveReferences.resolveLink(linkMark);
			}
		}
		pieces.push({ linkOrigin, node: child });
	}
	return pieces;
}

function serializeInlineContent(
	parent: ProseMirrorNode,
	options: InlineSerializeOptions = {},
): string {
	const inTableCell = options.inTableCell ?? false;
	const inHeading = options.inHeading ?? false;
	const mathNewlineToken = options.mathNewlineToken ?? null;
	const resolveReferences = options.resolveReferences ?? null;

	let endIndex = parent.childCount;
	// Outside a table cell a trailing break is unrepresentable, so it is
	// canonicalized away; inside a cell it serializes as `<br>`.
	while (
		!inTableCell &&
		endIndex > 0 &&
		parent.child(endIndex - 1).type.name === "hard_break"
	) {
		endIndex -= 1;
	}

	const pieces = collectInlinePieces(parent, endIndex, resolveReferences);
	const effectiveMarkKey = createEffectiveMarkKeyFn();
	const markSpans = computeMarkSpans(pieces, effectiveMarkKey);
	const markKeysAt = (index: number): Set<string> => {
		const set = new Set<string>();
		const spans = markSpans[index];
		if (!spans) return set;
		for (const span of spans) {
			set.add(span.key);
		}
		return set;
	};
	const sortedMarksAt = (index: number): ActiveMarkEntry[] =>
		[...(markSpans[index] ?? [])]
			.sort(compareMarkSpans)
			.map((span) => ({ linkOrigin: span.linkOrigin, mark: span.mark }));

	let output = "";
	const activeMarks: ActiveMarkEntry[] = [];
	const activeMarkOpenOffsets: number[] = [];

	const closeMarksTo = (
		targetDepth: number,
		nextCharMayHijackShortcut = false,
	): void => {
		while (activeMarks.length > targetDepth) {
			const popped = activeMarks.pop();
			const openOffset = activeMarkOpenOffsets.pop() ?? output.length;
			if (popped) {
				if (popped.mark.type.name === "link" && popped.linkOrigin !== null) {
					const href =
						typeof popped.mark.attrs.href === "string"
							? popped.mark.attrs.href
							: "";
					const title =
						typeof popped.mark.attrs.title === "string" &&
						popped.mark.attrs.title.length > 0
							? popped.mark.attrs.title
							: null;
					const refClose = formatReferenceLinkClose(
						href,
						title,
						popped.linkOrigin,
						output.slice(openOffset),
						inTableCell,
						activeMarks.length === targetDepth && nextCharMayHijackShortcut,
					);
					if (refClose !== null) {
						output += refClose;
						continue;
					}
				}
				output += markCloseSyntax(popped.mark, inTableCell, mathNewlineToken);
			}
		}
	};

	const syncMarks = (
		nextMarks: readonly ActiveMarkEntry[],
		nextLeafMayHijackShortcut = false,
	): void => {
		let sharedDepth = 0;
		while (
			sharedDepth < activeMarks.length &&
			sharedDepth < nextMarks.length &&
			sameActiveMark(
				activeMarks[sharedDepth] as ActiveMarkEntry,
				nextMarks[sharedDepth] as ActiveMarkEntry,
			)
		) {
			sharedDepth += 1;
		}
		const nextCharMayHijack =
			sharedDepth < nextMarks.length
				? nextMarks[sharedDepth]?.mark.type.name === "link"
				: nextLeafMayHijackShortcut;
		closeMarksTo(sharedDepth, nextCharMayHijack);
		for (let i = sharedDepth; i < nextMarks.length; i += 1) {
			const entry = nextMarks[i];
			if (entry) {
				output += markOpenSyntax(entry.mark);
				activeMarks.push(entry);
				activeMarkOpenOffsets.push(output.length);
			}
		}
	};

	const nextPieceMayHijackShortcutImage = (
		imageIndex: number,
		currentMarks: readonly ActiveMarkEntry[],
	): boolean => {
		const nextIndex = imageIndex + 1;
		if (nextIndex >= pieces.length) return false;
		const nextPiece = pieces[nextIndex];
		if (!nextPiece) return false;
		const nextNode = nextPiece.node;
		const nextHasCode =
			nextNode.isText && nextNode.marks.some((m) => m.type.name === "code");
		const nextMarks =
			nextNode.type.name === "image" || nextHasCode
				? sortedMarksAt(nextIndex).filter((e) => e.mark.type.name !== "code")
				: sortedMarksAt(nextIndex);
		let sharedDepth = 0;
		while (
			sharedDepth < currentMarks.length &&
			sharedDepth < nextMarks.length &&
			sameActiveMark(
				currentMarks[sharedDepth] as ActiveMarkEntry,
				nextMarks[sharedDepth] as ActiveMarkEntry,
			)
		) {
			sharedDepth += 1;
		}
		if (sharedDepth < currentMarks.length) {
			return false;
		}
		if (sharedDepth < nextMarks.length) {
			return nextMarks[sharedDepth]?.mark.type.name === "link";
		}
		if (nextNode.type.name === "protected_inline") {
			const raw =
				typeof nextNode.attrs.rawMarkdown === "string"
					? nextNode.attrs.rawMarkdown
					: "";
			return isShortcutLinkHijackChar(raw[0]);
		}
		if (nextNode.isText && !nextHasCode) {
			return isShortcutLinkHijackChar((nextNode.text ?? "")[0]);
		}
		return false;
	};

	for (let i = 0; i < pieces.length; i += 1) {
		const piece = pieces[i];
		if (!piece) continue;
		const child = piece.node;
		const spans = markSpans[i] ?? [];
		const sortedMarks = sortedMarksAt(i);
		const previousKeys = markKeysAt(i - 1);
		const nextKeys = markKeysAt(i + 1);

		if (child.type.name === "hard_break") {
			syncMarks(sortedMarks);
			output += inTableCell ? "<br>" : inHeading ? " " : "\\\n";
			continue;
		}

		if (child.type.name === "protected_inline") {
			const raw =
				typeof child.attrs.rawMarkdown === "string"
					? child.attrs.rawMarkdown
					: "";
			syncMarks(sortedMarks, isShortcutLinkHijackChar(raw[0]));
			const isInlineMath = child.attrs.kind === "math-inline";
			const encodedRaw =
				mathNewlineToken !== null && raw.includes("\n")
					? raw.split("\n").join(mathNewlineToken)
					: raw;
			if (inTableCell) {
				const cellRaw = isInlineMath ? raw : escapeRawTablePipes(raw);
				output +=
					mathNewlineToken !== null && cellRaw.includes("\n")
						? cellRaw.split("\n").join(mathNewlineToken)
						: cellRaw;
			} else {
				const continuationMatch =
					!inHeading &&
					child.attrs.kind === "raw-inline" &&
					child.attrs.continuationIndent === true &&
					wouldRawHtmlInterruptParagraph(raw)
						? /\n( {0,3})$/.exec(output)
						: null;
				const pad = continuationMatch
					? " ".repeat(4 - (continuationMatch[1]?.length ?? 0))
					: "";
				output += `${pad}${encodedRaw}`;
			}
			continue;
		}

		if (child.type.name === "image") {
			const imageMarks = sortedMarks.filter(
				(entry) => entry.mark.type.name !== "code",
			);
			syncMarks(imageMarks);
			const imageOrigin = resolveReferences?.resolveImage(child) ?? null;
			output += serializeImageNode(
				child,
				inTableCell,
				mathNewlineToken,
				imageOrigin,
				imageOrigin !== null && nextPieceMayHijackShortcutImage(i, imageMarks),
			);
			continue;
		}

		if (!child.isText) {
			continue;
		}

		const text = child.text ?? "";
		const hasCodeMark = sortedMarks.some(
			(entry) => entry.mark.type.name === "code",
		);
		if (hasCodeMark) {
			syncMarks(sortedMarks.filter((entry) => entry.mark.type.name !== "code"));
			output += formatCodeSpan(text, inTableCell);
			continue;
		}

		const isOpening = sortedMarks.some(
			(entry) =>
				EMPHASIS_MARK_NAMES.has(entry.mark.type.name) &&
				!previousKeys.has(effectiveMarkKey(entry.mark, entry.linkOrigin)),
		);
		const closesEmphasis = spans.some(
			(span) =>
				EMPHASIS_MARK_NAMES.has(span.mark.type.name) && !nextKeys.has(span.key),
		);

		let core = text;
		let leadingSpace = "";
		let trailingSpace = "";
		if (isOpening) {
			leadingSpace = /^[ \t]+/.exec(core)?.[0] ?? "";
			core = core.slice(leadingSpace.length);
		}
		if (closesEmphasis) {
			trailingSpace = /[ \t]+$/.exec(core)?.[0] ?? "";
			core = core.slice(0, core.length - trailingSpace.length);
		}

		if (core.length === 0) {
			const keptMarks: ActiveMarkEntry[] = [];
			for (let k = 0; k < sortedMarks.length; k += 1) {
				const entry = sortedMarks[k] as ActiveMarkEntry;
				const continues = nextKeys.has(
					effectiveMarkKey(entry.mark, entry.linkOrigin),
				);
				const allowed = EMPHASIS_MARK_NAMES.has(entry.mark.type.name)
					? activeMarks[k] !== undefined &&
						sameActiveMark(activeMarks[k] as ActiveMarkEntry, entry)
					: true;
				if (!continues || !allowed) {
					break;
				}
				keptMarks.push(entry);
			}
			syncMarks(keptMarks);
			output += escapeInlineMarkdownText(text, {
				atLineStart: output.length === 0 || output.endsWith("\n"),
				inHeading,
				inLinkLabel: keptMarks.some((entry) => entry.mark.type.name === "link"),
				inTableCell,
			});
			continue;
		}

		if (leadingSpace.length > 0) {
			let keepDepth = 0;
			while (
				keepDepth < activeMarks.length &&
				keepDepth < sortedMarks.length &&
				sameActiveMark(
					activeMarks[keepDepth] as ActiveMarkEntry,
					sortedMarks[keepDepth] as ActiveMarkEntry,
				)
			) {
				keepDepth += 1;
			}
			closeMarksTo(keepDepth);
			output += leadingSpace;
		}
		syncMarks(sortedMarks, isShortcutLinkHijackChar(core[0]));
		output += escapeInlineMarkdownText(core, {
			atLineStart: output.length === 0 || output.endsWith("\n"),
			inHeading,
			inLinkLabel: sortedMarks.some((entry) => entry.mark.type.name === "link"),
			inTableCell,
		});
		if (trailingSpace.length > 0) {
			let keepDepth = 0;
			while (
				keepDepth < activeMarks.length &&
				nextKeys.has(
					effectiveMarkKey(
						(activeMarks[keepDepth] as ActiveMarkEntry).mark,
						(activeMarks[keepDepth] as ActiveMarkEntry).linkOrigin,
					),
				)
			) {
				keepDepth += 1;
			}
			closeMarksTo(keepDepth);
			output += trailingSpace;
		}
	}

	closeMarksTo(0);
	return output;
}

function prefixBlockquote(text: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}

function serializeCodeBlock(node: ProseMirrorNode): string {
	const fenceChar = sanitizeFenceChar(node.attrs.fenceChar);
	const body = node.textContent;
	const minFenceLen = sanitizeFenceLength(node.attrs.fenceLength);
	const bodyMaxRun = longestCharRun(body, fenceChar);
	const fenceLength = Math.max(minFenceLen, bodyMaxRun + 1);
	const fence = fenceChar.repeat(fenceLength);
	const rawInfo =
		typeof node.attrs.info === "string" ? node.attrs.info.trim() : "";
	const rawLang =
		typeof node.attrs.language === "string" ? node.attrs.language.trim() : "";
	const info = rawInfo.length > 0 ? rawInfo : rawLang;

	if (body.length === 0) {
		return `${fence}${info}\n${fence}`;
	}
	return /^\n+$/.test(body)
		? `${fence}${info}\n${body}${fence}`
		: `${fence}${info}\n${body}\n${fence}`;
}

function formatAlignmentDelimiter(align: TableTextAlign): string {
	switch (align) {
		case "left":
			return ":---";
		case "center":
			return ":---:";
		case "right":
			return "---:";
		case null:
			return "---";
	}
}

function serializeTableCell(
	cellNode: ProseMirrorNode,
	mathNewlineToken: string | null,
	resolveReferences: ReferencePreserveResolver | null,
): string {
	const parts: string[] = [];
	for (let i = 0; i < cellNode.childCount; i += 1) {
		parts.push(
			serializeInlineContent(cellNode.child(i), {
				inTableCell: true,
				mathNewlineToken,
				resolveReferences,
			}),
		);
	}
	return parts.join("<br>").trim();
}

function serializeTable(
	tableNode: ProseMirrorNode,
	mathNewlineToken: string | null,
	resolveReferences: ReferencePreserveResolver | null,
): string {
	if (tableNode.childCount === 0) {
		return "";
	}

	let columnCount = 0;
	for (let r = 0; r < tableNode.childCount; r += 1) {
		columnCount = Math.max(columnCount, tableNode.child(r).childCount);
	}
	if (columnCount === 0) {
		return "";
	}

	const storedAlignments = Array.isArray(tableNode.attrs.columnAlignments)
		? tableNode.attrs.columnAlignments
		: null;
	const headerRow = tableNode.child(0);
	const columnAlignments: TableTextAlign[] = [];
	for (let c = 0; c < columnCount; c += 1) {
		if (storedAlignments && storedAlignments.length === columnCount) {
			const saved = storedAlignments[c];
			columnAlignments.push(isValidTableTextAlign(saved) ? saved : null);
		} else if (c < headerRow.childCount) {
			const cellAlign = headerRow.child(c).attrs.textAlign;
			columnAlignments.push(
				isValidTableTextAlign(cellAlign) ? cellAlign : null,
			);
		} else {
			columnAlignments.push(null);
		}
	}

	const snapshot: TableAlignSnapshot = {
		baseAlignments: columnAlignments,
		cellAlignments: [],
		columnCount,
		rowCount: tableNode.childCount,
	};
	const cellAlignments: TableTextAlign[][] = [];
	for (let r = 0; r < tableNode.childCount; r += 1) {
		const rowNode = tableNode.child(r);
		const rowAlignments: TableTextAlign[] = [];
		for (let c = 0; c < columnCount; c += 1) {
			const cellAlign =
				c < rowNode.childCount ? rowNode.child(c).attrs.textAlign : null;
			rowAlignments.push(isValidTableTextAlign(cellAlign) ? cellAlign : null);
		}
		cellAlignments.push(rowAlignments);
	}
	const fullSnapshot: TableAlignSnapshot = { ...snapshot, cellAlignments };
	const storedAnnotation =
		typeof tableNode.attrs.alignAnnotation === "string"
			? tableNode.attrs.alignAnnotation
			: null;
	const alignAnnotation = reconcileTableAlignComment(
		storedAnnotation,
		fullSnapshot,
	);

	const formatRow = (rowNode: ProseMirrorNode): string => {
		const cells: string[] = [];
		for (let c = 0; c < columnCount; c += 1) {
			cells.push(
				c < rowNode.childCount
					? serializeTableCell(
							rowNode.child(c),
							mathNewlineToken,
							resolveReferences,
						)
					: "",
			);
		}
		return `| ${cells.join(" | ")} |`;
	};

	const lines: string[] = [];
	if (alignAnnotation !== null) {
		lines.push(alignAnnotation);
	}

	lines.push(formatRow(headerRow));
	lines.push(
		`| ${columnAlignments.map(formatAlignmentDelimiter).join(" | ")} |`,
	);
	for (let r = 1; r < tableNode.childCount; r += 1) {
		lines.push(formatRow(tableNode.child(r)));
	}

	return lines.join("\n");
}

function serializeBlockNodeInternal(
	node: ProseMirrorNode,
	mathNewlineToken: string | null,
	resolveReferences: ReferencePreserveResolver | null,
): string {
	const childSerializer =
		mathNewlineToken !== null || resolveReferences !== null
			? (child: ProseMirrorNode, nestedToken?: string): string =>
					serializeBlockNodeInternal(
						child,
						nestedToken ?? mathNewlineToken,
						resolveReferences,
					)
			: serializeBlockNode;
	switch (node.type.name) {
		case "paragraph":
			return escapeParagraphTableDelimiters(
				serializeInlineContent(node, {
					mathNewlineToken,
					resolveReferences,
				}),
				mathNewlineToken,
			);
		case "heading": {
			const level = normalizeHeadingLevel(node.attrs.level);
			const content = serializeInlineContent(node, {
				inHeading: true,
				mathNewlineToken,
				resolveReferences,
			}).replace(/#+$/, (run) => run.replace(/#/g, "\\#"));
			return content.length > 0
				? `${"#".repeat(level)} ${content}`
				: "#".repeat(level);
		}
		case "blockquote":
			return prefixBlockquote(
				joinSerializedBlocks(
					node,
					childSerializer,
					resolveReferences?.isPartialTitleRefDef ?? null,
				),
			);
		case "bullet_list":
		case "ordered_list":
		case "task_list":
			return serializeList(
				node,
				childSerializer,
				mathNewlineToken ?? undefined,
				resolveReferences?.isPartialTitleRefDef ?? null,
			);
		case "code_block":
			return serializeCodeBlock(node);
		case "horizontal_rule":
			return "---";
		case "table":
			return serializeTable(node, mathNewlineToken, resolveReferences);
		case "protected_block": {
			const raw =
				typeof node.attrs.rawMarkdown === "string"
					? node.attrs.rawMarkdown
					: "";
			if (
				mathNewlineToken === null ||
				node.attrs.kind !== "raw" ||
				!raw.includes("\n") ||
				!raw.includes("\\(")
			) {
				return raw;
			}
			const ranges = scanPhpMarkdownMathRanges(raw);
			if (ranges.length === 0) return raw;
			let masked = "";
			let cursor = 0;
			for (const range of ranges) {
				if (range.block || range.from < cursor) continue;
				if (range.from > cursor) masked += raw.slice(cursor, range.from);
				const piece = raw.slice(range.from, range.to);
				masked += piece.includes("\n")
					? piece.split("\n").join(mathNewlineToken)
					: piece;
				cursor = range.to;
			}
			if (cursor < raw.length) masked += raw.slice(cursor);
			return masked;
		}
		default:
			return node.textContent;
	}
}

function serializeBlockNodeWithRefs(
	node: ProseMirrorNode,
	resolveReferences: ReferencePreserveResolver | null,
	mathNewlineToken?: string,
): string {
	if (mathNewlineToken !== undefined) {
		return serializeBlockNodeInternal(
			node,
			mathNewlineToken,
			resolveReferences,
		);
	}
	const token = createMathNewlineSentinelForNode(node);
	if (token === null) {
		return serializeBlockNodeInternal(node, null, resolveReferences);
	}
	return restoreMathNewlineSentinel(
		serializeBlockNodeInternal(node, token, resolveReferences),
		token,
	);
}

function serializeBlockNode(
	node: ProseMirrorNode,
	mathNewlineToken?: string,
): string {
	return serializeBlockNodeWithRefs(node, null, mathNewlineToken);
}

export function serializeVisualDocToMarkdown(doc: ProseMirrorNode): string {
	if (
		doc.childCount === 1 &&
		doc.firstChild?.type.name === "paragraph" &&
		doc.firstChild.childCount === 0
	) {
		return "";
	}

	return joinSerializedBlocks(doc, serializeBlockNode);
}

const MARKDOWN_SERIALIZERS: MarkdownSerializers = {
	serializeBlock: serializeBlockNode,
	serializeBlockWithRefs: serializeBlockNodeWithRefs,
	serializeDoc: serializeVisualDocToMarkdown,
};

/**
 * Round-trip guard: an unmodified document returns its exact original bytes,
 * and an edited one preserves every untouched block (and untouched list item
 * of an edited top-level list or untouched child of an edited top-level
 * blockquote) byte-identically.
 */
export function createMarkdownRoundTripGuard(
	initialMarkdown: string,
	initialDocOrParsed?: ProseMirrorNode | ParsedVisualDocument,
	liveDoc?: ProseMirrorNode,
): MarkdownRoundTripGuard {
	return createPreservingRoundTripGuard(
		initialMarkdown,
		initialDocOrParsed,
		MARKDOWN_SERIALIZERS,
		liveDoc,
	);
}
