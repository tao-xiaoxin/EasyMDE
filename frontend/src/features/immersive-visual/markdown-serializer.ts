import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import {
	isValidTableTextAlign,
	isValidVisualImageScale,
	normalizeHeadingLevel,
	sanitizeFenceChar,
	sanitizeFenceLength,
	type TableTextAlign,
} from "./visual-schema";

export type MarkdownRoundTripGuard = Readonly<{
	initialDoc: ProseMirrorNode;
	initialMarkdown: string;
	isUnmodified: (doc: ProseMirrorNode) => boolean;
	serialize: (doc: ProseMirrorNode) => string;
}>;

const MARK_ORDER: ReadonlyArray<string> = [
	"link",
	"strike",
	"strong",
	"em",
	"code",
];

function markRank(markName: string): number {
	const index = MARK_ORDER.indexOf(markName);
	return index >= 0 ? index : MARK_ORDER.length;
}

function sortMarksForSerialization(marks: readonly Mark[]): Mark[] {
	return [...marks].sort(
		(left, right) => markRank(left.type.name) - markRank(right.type.name),
	);
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
	const body = inTableCell ? content.replace(/\|/g, "\\|") : content;
	const tickCount = longestCharRun(body, "`") + 1;
	const fence = "`".repeat(tickCount);
	const needsSpacePadding =
		body.startsWith("`") ||
		body.endsWith("`") ||
		(body.startsWith(" ") && body.endsWith(" ") && body.trim().length > 0);
	return needsSpacePadding ? `${fence} ${body} ${fence}` : `${fence}${body}${fence}`;
}

function escapeQuotedTitle(title: string): string {
	return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatLinkDestination(href: string): string {
	const trimmed = href.trim();
	if (trimmed.length === 0) {
		return "";
	}
	if (/[\s()]/.test(trimmed)) {
		return `<${trimmed}>`;
	}
	return trimmed;
}

function escapeImageAlt(alt: string): string {
	return alt.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeTableCellText(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
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

function markCloseSyntax(mark: Mark): string {
	switch (mark.type.name) {
		case "strong":
			return "**";
		case "em":
			return "*";
		case "strike":
			return "~~";
		case "link": {
			const href =
				typeof mark.attrs.href === "string" ? mark.attrs.href : "";
			const title =
				typeof mark.attrs.title === "string" && mark.attrs.title.length > 0
					? mark.attrs.title
					: null;
			const dest = formatLinkDestination(href);
			return title !== null
				? `](${dest} "${escapeQuotedTitle(title)}")`
				: `](${dest})`;
		}
		default:
			return "";
	}
}

function serializeImageNode(
	node: ProseMirrorNode,
	inTableCell: boolean,
): string {
	const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
	const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
	const baseTitle =
		typeof node.attrs.title === "string" && node.attrs.title.length > 0
			? node.attrs.title
			: null;
	const scale = isValidVisualImageScale(node.attrs.scale)
		? node.attrs.scale
		: null;

	let effectiveTitle: string | null = baseTitle;
	if (scale !== null) {
		effectiveTitle =
			baseTitle !== null
				? `${baseTitle} {width=${scale}%}`
				: `{width=${scale}%}`;
	}

	const altText = inTableCell
		? escapeImageAlt(alt).replace(/\|/g, "\\|")
		: escapeImageAlt(alt);
	const dest = formatLinkDestination(src);
	const titleSegment =
		effectiveTitle !== null ? ` "${escapeQuotedTitle(effectiveTitle)}"` : "";
	return `![${altText}](${dest}${titleSegment})`;
}

function serializeInlineContent(
	parent: ProseMirrorNode,
	inTableCell: boolean,
): string {
	let output = "";
	const activeMarks: Mark[] = [];

	const closeMarksTo = (targetDepth: number): void => {
		while (activeMarks.length > targetDepth) {
			const popped = activeMarks.pop();
			if (popped) {
				output += markCloseSyntax(popped);
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

	for (let i = 0; i < parent.childCount; i += 1) {
		const child = parent.child(i);

		if (child.type.name === "hard_break") {
			closeMarksTo(0);
			output += inTableCell ? "<br>" : "  \n";
			continue;
		}

		if (child.type.name === "protected_inline") {
			closeMarksTo(0);
			const raw =
				typeof child.attrs.rawMarkdown === "string"
					? child.attrs.rawMarkdown
					: "";
			output += inTableCell ? raw.replace(/\|/g, "\\|") : raw;
			continue;
		}

		const sortedMarks = sortMarksForSerialization(child.marks);
		const hasCodeMark = sortedMarks.some((mark) => mark.type.name === "code");

		if (child.type.name === "image") {
			const wrapperMarks = sortedMarks.filter(
				(mark) => mark.type.name !== "code",
			);
			syncMarks(wrapperMarks);
			output += serializeImageNode(child, inTableCell);
			continue;
		}

		if (child.isText) {
			const text = child.text ?? "";
			if (hasCodeMark) {
				const outerMarks = sortedMarks.filter(
					(mark) => mark.type.name !== "code",
				);
				syncMarks(outerMarks);
				output += formatCodeSpan(text, inTableCell);
			} else {
				const formattedText = inTableCell ? escapeTableCellText(text) : text;
				const leadingSpace =
					sortedMarks.length > 0 && activeMarks.length === 0
						? /^([ \t]+)/.exec(formattedText)?.[1] ?? ""
						: "";
				const trailingSpace =
					sortedMarks.length > 0 && i === parent.childCount - 1
						? /([ \t]+)$/.exec(formattedText.slice(leadingSpace.length))?.[1] ??
							""
						: "";
				const coreText = formattedText.slice(
					leadingSpace.length,
					formattedText.length - trailingSpace.length,
				);

				if (coreText.length === 0) {
					syncMarks([]);
					output += formattedText;
				} else {
					if (leadingSpace.length > 0) {
						syncMarks([]);
						output += leadingSpace;
					}
					syncMarks(sortedMarks);
					output += coreText;
					if (trailingSpace.length > 0) {
						closeMarksTo(0);
						output += trailingSpace;
					}
				}
			}
		}
	}

	closeMarksTo(0);
	return output;
}

function prefixMultiline(
	text: string,
	firstLinePrefix: string,
	continuationPrefix: string,
): string {
	const lines = text.split("\n");
	return lines
		.map((line, index) => {
			if (index === 0) {
				return line.length > 0
					? `${firstLinePrefix}${line}`
					: firstLinePrefix.trimEnd();
			}
			return line.length > 0 ? `${continuationPrefix}${line}` : "";
		})
		.join("\n");
}

function prefixBlockquote(text: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}

function isLooseList(listNode: ProseMirrorNode): boolean {
	for (let i = 0; i < listNode.childCount; i += 1) {
		const item = listNode.child(i);
		let nonListBlocks = 0;
		for (let j = 0; j < item.childCount; j += 1) {
			const childName = item.child(j).type.name;
			if (
				childName !== "bullet_list" &&
				childName !== "ordered_list" &&
				childName !== "task_list"
			) {
				nonListBlocks += 1;
			}
		}
		if (nonListBlocks > 1) {
			return true;
		}
	}
	return false;
}

function serializeListItemBody(itemNode: ProseMirrorNode): string {
	const parts: string[] = [];
	for (let i = 0; i < itemNode.childCount; i += 1) {
		const child = itemNode.child(i);
		const serialized = serializeBlockNode(child);
		const prev = i > 0 ? itemNode.child(i - 1) : null;
		const isNestedList =
			child.type.name === "bullet_list" ||
			child.type.name === "ordered_list" ||
			child.type.name === "task_list";
		if (i === 0) {
			parts.push(serialized);
		} else if (isNestedList && prev?.type.name === "paragraph") {
			parts.push(`\n${serialized}`);
		} else {
			parts.push(`\n\n${serialized}`);
		}
	}
	return parts.join("");
}

function serializeList(listNode: ProseMirrorNode): string {
	const loose = isLooseList(listNode);
	const separator = loose ? "\n\n" : "\n";
	const items: string[] = [];
	const startOrder =
		listNode.type.name === "ordered_list" &&
		typeof listNode.attrs.order === "number" &&
		Number.isInteger(listNode.attrs.order) &&
		listNode.attrs.order > 0
			? listNode.attrs.order
			: 1;

	for (let i = 0; i < listNode.childCount; i += 1) {
		const item = listNode.child(i);
		const body = serializeListItemBody(item);
		let prefix = "- ";
		let indent = "  ";
		if (listNode.type.name === "ordered_list") {
			prefix = `${startOrder + i}. `;
			indent = " ".repeat(prefix.length);
		} else if (listNode.type.name === "task_list") {
			prefix = item.attrs.checked ? "- [x] " : "- [ ] ";
			indent = "  ";
		}
		items.push(prefixMultiline(body, prefix, indent));
	}

	return items.join(separator);
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
	return `${fence}${info}\n${body}\n${fence}`;
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

function serializeTableCell(cellNode: ProseMirrorNode): string {
	const parts: string[] = [];
	for (let i = 0; i < cellNode.childCount; i += 1) {
		parts.push(serializeInlineContent(cellNode.child(i), true));
	}
	return parts.join("<br>").trim();
}

function serializeTable(tableNode: ProseMirrorNode): string {
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
			columnAlignments.push(isValidTableTextAlign(cellAlign) ? cellAlign : null);
		} else {
			columnAlignments.push(null);
		}
	}

	const formatRow = (rowNode: ProseMirrorNode): string => {
		const cells: string[] = [];
		for (let c = 0; c < columnCount; c += 1) {
			cells.push(
				c < rowNode.childCount ? serializeTableCell(rowNode.child(c)) : "",
			);
		}
		return `| ${cells.join(" | ")} |`;
	};

	const lines: string[] = [];
	const alignAnnotation =
		typeof tableNode.attrs.alignAnnotation === "string"
			? tableNode.attrs.alignAnnotation.trim()
			: "";
	if (alignAnnotation.length > 0) {
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

function serializeBlockNode(node: ProseMirrorNode): string {
	switch (node.type.name) {
		case "paragraph":
			return serializeInlineContent(node, false);
		case "heading": {
			const level = normalizeHeadingLevel(node.attrs.level);
			const content = serializeInlineContent(node, false);
			return content.length > 0
				? `${"#".repeat(level)} ${content}`
				: "#".repeat(level);
		}
		case "blockquote": {
			const innerBlocks: string[] = [];
			for (let i = 0; i < node.childCount; i += 1) {
				innerBlocks.push(serializeBlockNode(node.child(i)));
			}
			return prefixBlockquote(innerBlocks.join("\n\n"));
		}
		case "bullet_list":
		case "ordered_list":
		case "task_list":
			return serializeList(node);
		case "code_block":
			return serializeCodeBlock(node);
		case "horizontal_rule":
			return "---";
		case "table":
			return serializeTable(node);
		case "protected_block":
			return typeof node.attrs.rawMarkdown === "string"
				? node.attrs.rawMarkdown
				: "";
		default:
			return node.textContent;
	}
}

export function serializeVisualDocToMarkdown(doc: ProseMirrorNode): string {
	if (
		doc.childCount === 1 &&
		doc.firstChild?.type.name === "paragraph" &&
		doc.firstChild.childCount === 0
	) {
		return "";
	}

	const blocks: string[] = [];
	for (let i = 0; i < doc.childCount; i += 1) {
		blocks.push(serializeBlockNode(doc.child(i)));
	}
	return blocks.join("\n\n");
}

export function createMarkdownRoundTripGuard(
	initialMarkdown: string,
	initialDoc?: ProseMirrorNode,
): MarkdownRoundTripGuard {
	const baselineDoc = initialDoc ?? parseMarkdownToVisualDoc(initialMarkdown);

	const isUnmodified = (doc: ProseMirrorNode): boolean =>
		doc === baselineDoc || doc.eq(baselineDoc);

	return {
		initialDoc: baselineDoc,
		initialMarkdown,
		isUnmodified,
		serialize(doc: ProseMirrorNode): string {
			if (isUnmodified(doc)) {
				return initialMarkdown;
			}
			return serializeVisualDocToMarkdown(doc);
		},
	};
}
