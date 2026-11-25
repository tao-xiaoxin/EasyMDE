import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	decodeCommonMarkTitle,
	decodeWpKsesRenderedTitle,
	type ImageScalePercentage,
	parseEffectiveImageScaleTitle,
	stripTrailingReservedScaleMarkers,
} from "../../shared/image-scale-title";
import {
	createMathNewlineSentinelForNode,
	createPreservingRoundTripGuard,
	joinSerializedBlocks,
	type MarkdownRoundTripGuard,
	type MarkdownSerializers,
	restoreMathNewlineSentinel,
	serializeList,
} from "./markdown-block-preservation";
import {
	escapeCodeSpanTableContent,
	escapeInlineMarkdownText,
	escapeTablePipes,
} from "./markdown-escape";
import type { ParsedVisualDocument } from "./markdown-parser";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";
import {
	reconcileTableAlignComment,
	type TableAlignSnapshot,
} from "./table-alignment-codec";
import {
	containsAsciiControlCharacter,
	isValidTableTextAlign,
	isValidVisualImageScale,
	normalizeHeadingLevel,
	sanitizeFenceChar,
	sanitizeFenceLength,
	stripAsciiControlCharacters,
	type TableTextAlign,
} from "./visual-schema";

export type { MarkdownRoundTripGuard } from "./markdown-block-preservation";

type InlineSerializeOptions = Readonly<{
	inHeading?: boolean;
	inTableCell?: boolean;
	mathNewlineToken?: string | null;
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

type MarkSpan = {
	end: number;
	mark: Mark;
	start: number;
};

function markKey(mark: Mark): string {
	return `${mark.type.name}:${JSON.stringify(mark.attrs)}`;
}

/**
 * Compute the contiguous child range of every mark so the serializer can nest
 * marks by span (longest-running mark outermost) instead of a fixed order.
 */
function computeMarkSpans(parent: ProseMirrorNode): MarkSpan[][] {
	const spans: MarkSpan[][] = [];
	for (let i = 0; i < parent.childCount; i += 1) {
		spans.push([]);
	}
	const active = new Map<string, MarkSpan>();
	for (let i = 0; i < parent.childCount; i += 1) {
		const child = parent.child(i);
		const present = new Set<string>();
		for (const mark of child.marks) {
			const key = markKey(mark);
			present.add(key);
			let span = active.get(key);
			if (!span) {
				span = { end: i, mark, start: i };
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
	return markKey(left.mark).localeCompare(markKey(right.mark));
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

function escapeQuotedTitle(title: string): string {
	return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatLinkDestination(href: string, inTableCell: boolean): string {
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

function formatImageAlt(alt: string, inTableCell: boolean): string {
	const escaped = alt
		.replace(/\r?\n/g, " ")
		.replace(/\\/g, "\\\\")
		.replace(/\]/g, "\\]");
	return inTableCell ? escapeTablePipes(escaped) : escaped;
}

const TITLE_ENTITY_TOKEN =
	/(&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});)/giu;

function protectTitleEntities(titleValue: string): string {
	return titleValue.includes("&")
		? titleValue.replace(
				TITLE_ENTITY_TOKEN,
				(_, token: string) => `&amp;${token.slice(1)}`,
			)
		: titleValue;
}

function encodeTitleLineBreaks(titleValue: string): string {
	return titleValue.replace(/\r/gu, "&#13;").replace(/\n/gu, "&#10;");
}

function formatQuotedTitle(titleValue: string, inTableCell: boolean): string {
	const encoded = encodeTitleLineBreaks(protectTitleEntities(titleValue));
	const escaped = escapeQuotedTitle(encoded);
	return inTableCell ? escapeTablePipes(escaped) : escaped;
}

function serializeScaledImageTitle(
	baseTitle: string,
	scale: ImageScalePercentage,
	inTableCell: boolean,
): string {
	const marker = `{width=${scale}%}`;
	const tryCandidate = (value: string): string | null => {
		const candidate = formatQuotedTitle(`${value} ${marker}`, inTableCell);
		const parsed = parseEffectiveImageScaleTitle(candidate);
		return parsed.status === "valid" && parsed.scale === scale
			? candidate
			: null;
	};
	if (baseTitle.length === 0) {
		return formatQuotedTitle(marker, inTableCell);
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
	return formatQuotedTitle(marker, inTableCell);
}

function serializeUnscaledImageTitle(
	rawTitle: string,
	inTableCell: boolean,
): string {
	if (rawTitle.length === 0) {
		return "";
	}
	const tryCandidate = (value: string): string | null => {
		const candidate = formatQuotedTitle(value, inTableCell);
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

function serializeImageNode(
	node: ProseMirrorNode,
	inTableCell: boolean,
): string {
	const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
	const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
	const scale = isValidVisualImageScale(node.attrs.scale)
		? node.attrs.scale
		: null;
	const rawTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";

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
		titleSegment = ` "${serializeScaledImageTitle(baseTitle, scale, inTableCell)}"`;
	} else if (rawTitle.length > 0) {
		const serializedTitle = serializeUnscaledImageTitle(rawTitle, inTableCell);
		if (serializedTitle.length > 0) {
			titleSegment = ` "${serializedTitle}"`;
		}
	}
	return `![${altText}](${destination}${titleSegment})`;
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

function markCloseSyntax(mark: Mark, inTableCell: boolean): string {
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
			const safeTitle =
				rawTitle === null ? null : formatQuotedTitle(rawTitle, inTableCell);
			return safeTitle !== null
				? `](${destination} "${safeTitle}")`
				: `](${destination})`;
		}
		default:
			return "";
	}
}

function serializeInlineContent(
	parent: ProseMirrorNode,
	options: InlineSerializeOptions = {},
): string {
	const inTableCell = options.inTableCell ?? false;
	const inHeading = options.inHeading ?? false;
	const mathNewlineToken = options.mathNewlineToken ?? null;
	const markSpans = computeMarkSpans(parent);
	const markKeysAt = (index: number): Set<string> => {
		const set = new Set<string>();
		const child =
			index >= 0 && index < parent.childCount ? parent.child(index) : null;
		for (const mark of child?.marks ?? []) {
			set.add(markKey(mark));
		}
		return set;
	};
	const sortedMarksAt = (index: number): Mark[] =>
		[...(markSpans[index] ?? [])]
			.sort(compareMarkSpans)
			.map((span) => span.mark);

	let output = "";
	const activeMarks: Mark[] = [];

	const closeMarksTo = (targetDepth: number): void => {
		while (activeMarks.length > targetDepth) {
			const popped = activeMarks.pop();
			if (popped) {
				output += markCloseSyntax(popped, inTableCell);
			}
		}
	};

	const syncMarks = (nextMarks: readonly Mark[]): void => {
		let sharedDepth = 0;
		while (
			sharedDepth < activeMarks.length &&
			sharedDepth < nextMarks.length &&
			activeMarks[sharedDepth]?.eq(nextMarks[sharedDepth] as Mark)
		) {
			sharedDepth += 1;
		}
		closeMarksTo(sharedDepth);
		for (let i = sharedDepth; i < nextMarks.length; i += 1) {
			const mark = nextMarks[i];
			if (mark) {
				output += markOpenSyntax(mark);
				activeMarks.push(mark);
			}
		}
	};

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

	for (let i = 0; i < endIndex; i += 1) {
		const child = parent.child(i);
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
			syncMarks(sortedMarks);
			const raw =
				typeof child.attrs.rawMarkdown === "string"
					? child.attrs.rawMarkdown
					: "";
			const isInlineMath = child.attrs.kind === "math-inline";
			const encodedRaw =
				isInlineMath && mathNewlineToken !== null && raw.includes("\n")
					? raw.split("\n").join(mathNewlineToken)
					: raw;
			if (inTableCell) {
				// PHP `MarkdownRenderer::extract_math()` extracts inline math
				// BEFORE CommonMark parses GFM tables, so pipes inside math
				// stay verbatim rather than turning `|` into KaTeX `\|` (`‖`).
				output += isInlineMath ? encodedRaw : escapeTablePipes(raw);
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
			syncMarks(sortedMarks.filter((mark) => mark.type.name !== "code"));
			output += serializeImageNode(child, inTableCell);
			continue;
		}

		if (!child.isText) {
			continue;
		}

		const text = child.text ?? "";
		const hasCodeMark = sortedMarks.some((mark) => mark.type.name === "code");
		if (hasCodeMark) {
			syncMarks(sortedMarks.filter((mark) => mark.type.name !== "code"));
			output += formatCodeSpan(text, inTableCell);
			continue;
		}

		// Only an opening emphasis delimiter must not be followed by a space;
		// link labels may legally start with whitespace.
		const isOpening = sortedMarks.some(
			(mark) =>
				EMPHASIS_MARK_NAMES.has(mark.type.name) &&
				!previousKeys.has(markKey(mark)),
		);
		const closesEmphasis = spans.some(
			(span) =>
				EMPHASIS_MARK_NAMES.has(span.mark.type.name) &&
				!nextKeys.has(markKey(span.mark)),
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
			// Whitespace-only runs never open or close emphasis next to the
			// space (`**a **`), but marks that continue into the next run stay
			// open: non-emphasis marks (links) always, emphasis only when it is
			// already active, so one outer span is never split in two.
			const keptMarks: Mark[] = [];
			for (let k = 0; k < sortedMarks.length; k += 1) {
				const mark = sortedMarks[k] as Mark;
				const continues = nextKeys.has(markKey(mark));
				const allowed = EMPHASIS_MARK_NAMES.has(mark.type.name)
					? activeMarks[k]?.eq(mark) === true
					: true;
				if (!continues || !allowed) {
					break;
				}
				keptMarks.push(mark);
			}
			syncMarks(keptMarks);
			output += escapeInlineMarkdownText(text, {
				atLineStart: output.length === 0 || output.endsWith("\n"),
				inHeading,
				inLinkLabel: keptMarks.some((mark) => mark.type.name === "link"),
				inTableCell,
			});
			continue;
		}

		if (leadingSpace.length > 0) {
			// Close only marks that do not continue into this run, so an
			// outer link or emphasis span is not split around the space.
			let keepDepth = 0;
			while (
				keepDepth < activeMarks.length &&
				keepDepth < sortedMarks.length &&
				activeMarks[keepDepth]?.eq(sortedMarks[keepDepth] as Mark)
			) {
				keepDepth += 1;
			}
			closeMarksTo(keepDepth);
			output += leadingSpace;
		}
		syncMarks(sortedMarks);
		output += escapeInlineMarkdownText(core, {
			atLineStart: output.length === 0 || output.endsWith("\n"),
			inHeading,
			inLinkLabel: sortedMarks.some((mark) => mark.type.name === "link"),
			inTableCell,
		});
		if (trailingSpace.length > 0) {
			let keepDepth = 0;
			while (
				keepDepth < activeMarks.length &&
				nextKeys.has(markKey(activeMarks[keepDepth] as Mark))
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
	// Bijection with `mapCodeToken`: a body of only blank lines already carries
	// its own terminators; any other body (including one ending in `\n` after
	// Enter) gains exactly one terminator before the closing fence.
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
): string {
	const parts: string[] = [];
	for (let i = 0; i < cellNode.childCount; i += 1) {
		parts.push(
			serializeInlineContent(cellNode.child(i), {
				inTableCell: true,
				mathNewlineToken,
			}),
		);
	}
	return parts.join("<br>").trim();
}

function serializeTable(
	tableNode: ProseMirrorNode,
	mathNewlineToken: string | null,
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
					? serializeTableCell(rowNode.child(c), mathNewlineToken)
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
): string {
	const childSerializer =
		mathNewlineToken !== null
			? (child: ProseMirrorNode): string =>
					serializeBlockNodeInternal(child, mathNewlineToken)
			: serializeBlockNode;
	switch (node.type.name) {
		case "paragraph":
			return serializeInlineContent(node, { mathNewlineToken });
		case "heading": {
			const level = normalizeHeadingLevel(node.attrs.level);
			const content = serializeInlineContent(node, {
				inHeading: true,
				mathNewlineToken,
			}).replace(/#+$/, (run) => run.replace(/#/g, "\\#"));
			return content.length > 0
				? `${"#".repeat(level)} ${content}`
				: "#".repeat(level);
		}
		case "blockquote":
			return prefixBlockquote(joinSerializedBlocks(node, childSerializer));
		case "bullet_list":
		case "ordered_list":
		case "task_list":
			return serializeList(
				node,
				childSerializer,
				mathNewlineToken ?? undefined,
			);
		case "code_block":
			return serializeCodeBlock(node);
		case "horizontal_rule":
			return "---";
		case "table":
			return serializeTable(node, mathNewlineToken);
		case "protected_block":
			return typeof node.attrs.rawMarkdown === "string"
				? node.attrs.rawMarkdown
				: "";
		default:
			return node.textContent;
	}
}

function serializeBlockNode(
	node: ProseMirrorNode,
	mathNewlineToken?: string,
): string {
	if (mathNewlineToken !== undefined) {
		return serializeBlockNodeInternal(node, mathNewlineToken);
	}
	const token = createMathNewlineSentinelForNode(node);
	if (token === null) {
		return serializeBlockNodeInternal(node, null);
	}
	return restoreMathNewlineSentinel(
		serializeBlockNodeInternal(node, token),
		token,
	);
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
	serializeDoc: serializeVisualDocToMarkdown,
};

/**
 * Round-trip guard: an unmodified document returns its exact original bytes,
 * and an edited one preserves every untouched block (and untouched list item
 * of an edited top-level list) byte-identically.
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
