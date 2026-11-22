import MarkdownIt from "markdown-it";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	type PreScanResult,
	prescanMarkdown,
	TABLE_ALIGN_PREFIX,
	TABLE_ALIGN_SUFFIX,
} from "./markdown-prescanner";
import {
	isValidTableTextAlign,
	isValidVisualImageScale,
	normalizeHeadingLevel,
	type TableTextAlign,
	type VisualImageScale,
	visualEditorSchema,
} from "./visual-schema";

export { type PreScanResult, prescanMarkdown } from "./markdown-prescanner";

export type ParsedImageScaleTitle = Readonly<{
	scale: VisualImageScale | null;
	title: string | null;
}>;

const markdownItParser = new MarkdownIt({ html: false, linkify: false, breaks: false });

type MarkdownToken = ReturnType<typeof markdownItParser.parse>[number];

export function parseImageScaleTitle(rawTitle: string | null | undefined): ParsedImageScaleTitle {
	if (typeof rawTitle !== "string" || rawTitle.length === 0) {
		return { scale: null, title: null };
	}
	const markerStart = rawTitle.indexOf("{width=");
	if (markerStart < 0 || rawTitle.indexOf("{width=", markerStart + 1) >= 0) {
		return { scale: null, title: rawTitle };
	}
	const match = /^\{width=(25|33|50|67|100|150|200)%\}$/.exec(rawTitle.slice(markerStart));
	const parsedScale = match?.[1] ? Number(match[1]) : null;
	if (!isValidVisualImageScale(parsedScale)) {
		return { scale: null, title: rawTitle };
	}
	if (markerStart === 0) {
		return { scale: parsedScale, title: null };
	}
	if (rawTitle[markerStart - 1] !== " ") {
		return { scale: null, title: rawTitle };
	}
	const baseTitle = rawTitle.slice(0, markerStart - 1);
	return { scale: parsedScale, title: baseTitle.length > 0 ? baseTitle : null };
}

function tokenAttrString(token: MarkdownToken, name: string): string | null {
	const value = token.attrGet(name);
	return value === null ? null : String(value);
}

function parseCellAlignmentFromToken(token: MarkdownToken): TableTextAlign {
	const match = /text-align\s*:\s*(left|center|right)/i.exec(
		tokenAttrString(token, "style") ?? "",
	);
	const normalized = match?.[1]?.toLowerCase() ?? null;
	return isValidTableTextAlign(normalized) ? normalized : null;
}

function applyTableAlignmentAnnotation(
	rows: ProseMirrorNode[],
	annotationComment: string,
): ProseMirrorNode[] {
	if (
		!annotationComment.startsWith(TABLE_ALIGN_PREFIX) ||
		!annotationComment.endsWith(TABLE_ALIGN_SUFFIX)
	) {
		return rows;
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(
			annotationComment.slice(TABLE_ALIGN_PREFIX.length, -TABLE_ALIGN_SUFFIX.length),
		) as unknown;
	} catch {
		return rows;
	}
	if (!Array.isArray(decoded)) {
		return rows;
	}

	const rowOverrides = new Map<number, TableTextAlign>();
	const cellOverrides = new Map<string, TableTextAlign>();
	for (const entry of decoded) {
		if (!Array.isArray(entry)) {
			continue;
		}
		if (entry.length === 2 && typeof entry[0] === "number" && isValidTableTextAlign(entry[1])) {
			rowOverrides.set(entry[0], entry[1]);
		} else if (
			entry.length === 3 &&
			typeof entry[0] === "number" &&
			typeof entry[1] === "number" &&
			isValidTableTextAlign(entry[2])
		) {
			cellOverrides.set(`${entry[0]}:${entry[1]}`, entry[2]);
		}
	}
	if (rowOverrides.size === 0 && cellOverrides.size === 0) {
		return rows;
	}

	return rows.map((rowNode, rowIndex) => {
		const updatedCells: ProseMirrorNode[] = [];
		for (let colIndex = 0; colIndex < rowNode.childCount; colIndex += 1) {
			const cell = rowNode.child(colIndex);
			const override = cellOverrides.get(`${rowIndex}:${colIndex}`) ?? rowOverrides.get(rowIndex);
			updatedCells.push(
				override !== undefined
					? cell.type.create({ ...cell.attrs, textAlign: override }, cell.content)
					: cell,
			);
		}
		return rowNode.type.create(rowNode.attrs, updatedCells);
	});
}

function splitTextWithProtectedInlines(
	text: string,
	activeMarks: readonly Mark[],
	preScan: PreScanResult,
	inTableCell: boolean,
): ProseMirrorNode[] {
	if (text.length === 0) {
		return [];
	}
	const result: ProseMirrorNode[] = [];
	const segments = inTableCell ? text.split("<br>") : [text];
	const tokenPattern = new RegExp(`${preScan.sentinel}INL(\\d+)END`, "g");

	for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
		if (segIdx > 0) {
			result.push(visualEditorSchema.nodes.hard_break.create());
		}
		const segment = segments[segIdx] ?? "";
		if (segment.length === 0) {
			continue;
		}
		tokenPattern.lastIndex = 0;
		let lastPos = 0;
		let match = tokenPattern.exec(segment);
		while (match !== null) {
			if (match.index > lastPos) {
				result.push(visualEditorSchema.text(segment.slice(lastPos, match.index), activeMarks));
			}
			const entry = preScan.protectedInlines.get(match[0]);
			result.push(
				entry
					? visualEditorSchema.nodes.protected_inline.create({
							kind: entry.kind,
							rawMarkdown: entry.rawMarkdown,
						})
					: visualEditorSchema.text(match[0], activeMarks),
			);
			lastPos = match.index + match[0].length;
			match = tokenPattern.exec(segment);
		}
		if (lastPos < segment.length) {
			result.push(visualEditorSchema.text(segment.slice(lastPos), activeMarks));
		}
	}

	return result;
}

function mapInlineTokens(
	tokens: ReadonlyArray<MarkdownToken> | null,
	preScan: PreScanResult,
	inTableCell: boolean,
): ProseMirrorNode[] {
	if (!tokens || tokens.length === 0) {
		return [];
	}
	const output: ProseMirrorNode[] = [];
	const markStack: Mark[] = [];

	const currentMarkSet = (): readonly Mark[] =>
		markStack.reduce<readonly Mark[]>((set, mark) => mark.addToSet(set), []);

	const popMark = (markName: string): void => {
		for (let i = markStack.length - 1; i >= 0; i -= 1) {
			if (markStack[i]?.type.name === markName) {
				markStack.splice(i, 1);
				return;
			}
		}
	};

	for (const token of tokens) {
		switch (token.type) {
			case "text":
				output.push(
					...splitTextWithProtectedInlines(token.content, currentMarkSet(), preScan, inTableCell),
				);
				break;
			case "code_inline":
				if (token.content.length > 0) {
					const codeMarks = visualEditorSchema.marks.code.create().addToSet(currentMarkSet());
					output.push(visualEditorSchema.text(token.content, codeMarks));
				}
				break;
			case "softbreak":
				output.push(visualEditorSchema.text("\n", currentMarkSet()));
				break;
			case "hardbreak":
				output.push(visualEditorSchema.nodes.hard_break.create());
				break;
			case "strong_open":
				markStack.push(visualEditorSchema.marks.strong.create());
				break;
			case "strong_close":
				popMark("strong");
				break;
			case "em_open":
				markStack.push(visualEditorSchema.marks.em.create());
				break;
			case "em_close":
				popMark("em");
				break;
			case "s_open":
				markStack.push(visualEditorSchema.marks.strike.create());
				break;
			case "s_close":
				popMark("strike");
				break;
			case "link_open": {
				const rawTitle = tokenAttrString(token, "title");
				markStack.push(
					visualEditorSchema.marks.link.create({
						href: tokenAttrString(token, "href") ?? "",
						title: rawTitle && rawTitle.length > 0 ? rawTitle : null,
					}),
				);
				break;
			}
			case "link_close":
				popMark("link");
				break;
			case "image": {
				const parsed = parseImageScaleTitle(tokenAttrString(token, "title"));
				const alt = token.children ? token.children.map((c) => c.content).join("") : token.content;
				output.push(
					visualEditorSchema.nodes.image.create(
						{
							src: tokenAttrString(token, "src") ?? "",
							alt,
							title: parsed.title,
							scale: parsed.scale,
						},
						null,
						currentMarkSet(),
					),
				);
				break;
			}
			default:
				if (token.content.length > 0) {
					output.push(
						...splitTextWithProtectedInlines(token.content, currentMarkSet(), preScan, inTableCell),
					);
				}
				break;
		}
	}

	return output;
}

function stripTaskPrefix(
	itemChildren: ReadonlyArray<ProseMirrorNode>,
): Readonly<{ checked: boolean; children: ProseMirrorNode[] }> | null {
	const firstBlock = itemChildren[0];
	if (!firstBlock || firstBlock.type !== visualEditorSchema.nodes.paragraph) {
		return null;
	}
	const firstInline = firstBlock.firstChild;
	if (!firstInline?.isText || firstInline.marks.length > 0) {
		return null;
	}
	const text = firstInline.text ?? "";
	const match = /^\[([ xX])\](?:[ \t]+|$)/.exec(text);
	if (!match?.[1]) {
		return null;
	}
	const remaining = text.slice(match[0].length);
	const inlines: ProseMirrorNode[] = remaining.length > 0 ? [visualEditorSchema.text(remaining)] : [];
	for (let i = 1; i < firstBlock.childCount; i += 1) {
		inlines.push(firstBlock.child(i));
	}
	return {
		checked: match[1].toLowerCase() === "x",
		children: [visualEditorSchema.nodes.paragraph.create(null, inlines), ...itemChildren.slice(1)],
	};
}

function ensureListItemChildren(blocks: ReadonlyArray<ProseMirrorNode>): ProseMirrorNode[] {
	const first = blocks[0];
	if (!first || first.type !== visualEditorSchema.nodes.paragraph) {
		return [visualEditorSchema.nodes.paragraph.create(), ...blocks];
	}
	return [...blocks];
}

function findMatchingCloseIndex(
	tokens: ReadonlyArray<MarkdownToken>,
	openIndex: number,
	openType: string,
	closeType: string,
): number {
	let depth = 0;
	for (let i = openIndex; i < tokens.length; i += 1) {
		const type = tokens[i]?.type;
		if (type === openType) {
			depth += 1;
		} else if (type === closeType) {
			depth -= 1;
			if (depth === 0) {
				return i;
			}
		}
	}
	return tokens.length - 1;
}

function mapTableTokens(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	preScan: PreScanResult,
	alignAnnotation: string | null,
): ProseMirrorNode {
	const rows: ProseMirrorNode[] = [];
	for (let i = startIndex + 1; i < endIndex; i += 1) {
		if (tokens[i]?.type !== "tr_open") {
			continue;
		}
		const rowClose = findMatchingCloseIndex(tokens, i, "tr_open", "tr_close");
		const cells: ProseMirrorNode[] = [];
		for (let j = i + 1; j < rowClose; j += 1) {
			const cellToken = tokens[j];
			if (cellToken?.type !== "th_open" && cellToken?.type !== "td_open") {
				continue;
			}
			const isHeader = cellToken.type === "th_open";
			const cellClose = findMatchingCloseIndex(
				tokens,
				j,
				cellToken.type,
				isHeader ? "th_close" : "td_close",
			);
			const inlineToken = tokens[j + 1];
			const inlineNodes =
				inlineToken?.type === "inline" ? mapInlineTokens(inlineToken.children, preScan, true) : [];
			const cellType = isHeader
				? visualEditorSchema.nodes.table_header
				: visualEditorSchema.nodes.table_cell;
			cells.push(
				cellType.create(
					{ textAlign: parseCellAlignmentFromToken(cellToken) },
					visualEditorSchema.nodes.paragraph.create(null, inlineNodes),
				),
			);
			j = cellClose;
		}
		if (cells.length > 0) {
			rows.push(visualEditorSchema.nodes.table_row.create(null, cells));
		}
		i = rowClose;
	}

	if (rows.length === 0) {
		rows.push(
			visualEditorSchema.nodes.table_row.create(null, [
				visualEditorSchema.nodes.table_header.create(null, visualEditorSchema.nodes.paragraph.create()),
			]),
		);
	}

	const headerRow = rows[0];
	const baseColumnAlignments: TableTextAlign[] = [];
	if (headerRow) {
		for (let c = 0; c < headerRow.childCount; c += 1) {
			const align = headerRow.child(c).attrs.textAlign;
			baseColumnAlignments.push(isValidTableTextAlign(align) ? align : null);
		}
	}

	const finalRows = alignAnnotation ? applyTableAlignmentAnnotation(rows, alignAnnotation) : rows;
	return visualEditorSchema.nodes.table.create(
		{ alignAnnotation, columnAlignments: alignAnnotation ? baseColumnAlignments : null },
		finalRows,
	);
}

function collectListItems(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	preScan: PreScanResult,
): ProseMirrorNode[][] {
	const items: ProseMirrorNode[][] = [];
	for (let i = startIndex + 1; i < endIndex; i += 1) {
		if (tokens[i]?.type !== "list_item_open") {
			continue;
		}
		const itemClose = findMatchingCloseIndex(tokens, i, "list_item_open", "list_item_close");
		items.push(ensureListItemChildren(mapBlockTokens(tokens, i + 1, itemClose, preScan)));
		i = itemClose;
	}
	return items;
}

function mapBulletListTokens(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	preScan: PreScanResult,
): ProseMirrorNode[] {
	const itemBlocks = collectListItems(tokens, startIndex, endIndex, preScan);
	if (itemBlocks.length === 0) {
		return [];
	}

	const lists: ProseMirrorNode[] = [];
	let currentGroup: ProseMirrorNode[] = [];
	let currentIsTask: boolean | null = null;

	const flush = (): void => {
		if (currentGroup.length === 0 || currentIsTask === null) {
			return;
		}
		const listType = currentIsTask
			? visualEditorSchema.nodes.task_list
			: visualEditorSchema.nodes.bullet_list;
		lists.push(listType.create(null, currentGroup));
		currentGroup = [];
	};

	for (const children of itemBlocks) {
		const task = stripTaskPrefix(children);
		const isTask = task !== null;
		if (currentIsTask !== null && isTask !== currentIsTask) {
			flush();
		}
		currentIsTask = isTask;
		currentGroup.push(
			task
				? visualEditorSchema.nodes.task_item.create({ checked: task.checked }, task.children)
				: visualEditorSchema.nodes.list_item.create(null, children),
		);
	}
	flush();
	return lists;
}

function mapCodeToken(token: MarkdownToken): ProseMirrorNode {
	const isFence = token.type === "fence";
	const fenceChar = isFence && token.markup.startsWith("~") ? "~" : "`";
	const fenceLength = isFence && token.markup.length >= 3 ? token.markup.length : 3;
	const info = isFence ? token.info.trim() : "";
	const language = info ? (info.split(/\s+/)[0] ?? "") : "";
	const rawContent = token.content.endsWith("\n") ? token.content.slice(0, -1) : token.content;

	if (language.toLowerCase() === "mermaid") {
		const fence = fenceChar.repeat(fenceLength);
		const rawMarkdown =
			rawContent.length > 0 ? `${fence}${info}\n${rawContent}\n${fence}` : `${fence}${info}\n${fence}`;
		return visualEditorSchema.nodes.protected_block.create({ kind: "mermaid", rawMarkdown });
	}
	return visualEditorSchema.nodes.code_block.create(
		{ language, info, fenceChar, fenceLength },
		rawContent.length > 0 ? visualEditorSchema.text(rawContent) : null,
	);
}

function mapBlockTokens(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	preScan: PreScanResult,
): ProseMirrorNode[] {
	const blocks: ProseMirrorNode[] = [];
	let pendingTableAlign: string | null = null;

	const flushOrphanTableAlign = (): void => {
		if (pendingTableAlign !== null) {
			blocks.push(
				visualEditorSchema.nodes.protected_block.create({ kind: "raw", rawMarkdown: pendingTableAlign }),
			);
			pendingTableAlign = null;
		}
	};

	for (let i = startIndex; i < endIndex; i += 1) {
		const token = tokens[i];
		if (!token) {
			continue;
		}

		if (token.type === "paragraph_open") {
			const closeIdx = findMatchingCloseIndex(tokens, i, "paragraph_open", "paragraph_close");
			const inlineToken = tokens[i + 1];
			const trimmed = inlineToken?.type === "inline" ? inlineToken.content.trim() : "";

			const tableAlign = preScan.tableAlignMarkers.get(trimmed);
			if (tableAlign !== undefined) {
				flushOrphanTableAlign();
				pendingTableAlign = tableAlign;
				i = closeIdx;
				continue;
			}
			flushOrphanTableAlign();

			const protectedEntry = preScan.protectedBlocks.get(trimmed);
			if (protectedEntry) {
				blocks.push(visualEditorSchema.nodes.protected_block.create(protectedEntry));
			} else if (/^\[TOC\]$/i.test(trimmed)) {
				blocks.push(
					visualEditorSchema.nodes.protected_block.create({ kind: "toc", rawMarkdown: trimmed }),
				);
			} else {
				const inlines =
					inlineToken?.type === "inline" ? mapInlineTokens(inlineToken.children, preScan, false) : [];
				blocks.push(visualEditorSchema.nodes.paragraph.create(null, inlines));
			}
			i = closeIdx;
			continue;
		}

		if (token.type === "table_open") {
			const closeIdx = findMatchingCloseIndex(tokens, i, "table_open", "table_close");
			const annotation = pendingTableAlign;
			pendingTableAlign = null;
			blocks.push(mapTableTokens(tokens, i, closeIdx, preScan, annotation));
			i = closeIdx;
			continue;
		}

		flushOrphanTableAlign();

		if (token.type === "heading_open") {
			const closeIdx = findMatchingCloseIndex(tokens, i, "heading_open", "heading_close");
			const level = normalizeHeadingLevel(Number.parseInt(token.tag.slice(1), 10));
			const inlineToken = tokens[i + 1];
			const inlines =
				inlineToken?.type === "inline" ? mapInlineTokens(inlineToken.children, preScan, false) : [];
			blocks.push(visualEditorSchema.nodes.heading.create({ level }, inlines));
			i = closeIdx;
		} else if (token.type === "blockquote_open") {
			const closeIdx = findMatchingCloseIndex(tokens, i, "blockquote_open", "blockquote_close");
			const inner = mapBlockTokens(tokens, i + 1, closeIdx, preScan);
			blocks.push(
				visualEditorSchema.nodes.blockquote.create(
					null,
					inner.length > 0 ? inner : [visualEditorSchema.nodes.paragraph.create()],
				),
			);
			i = closeIdx;
		} else if (token.type === "bullet_list_open") {
			const closeIdx = findMatchingCloseIndex(tokens, i, "bullet_list_open", "bullet_list_close");
			blocks.push(...mapBulletListTokens(tokens, i, closeIdx, preScan));
			i = closeIdx;
		} else if (token.type === "ordered_list_open") {
			const closeIdx = findMatchingCloseIndex(tokens, i, "ordered_list_open", "ordered_list_close");
			const parsedOrder = Number.parseInt(tokenAttrString(token, "start") ?? "1", 10);
			const order = Number.isInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : 1;
			const items = collectListItems(tokens, i, closeIdx, preScan).map((children) =>
				visualEditorSchema.nodes.list_item.create(null, children),
			);
			if (items.length > 0) {
				blocks.push(visualEditorSchema.nodes.ordered_list.create({ order }, items));
			}
			i = closeIdx;
		} else if (token.type === "fence" || token.type === "code_block") {
			blocks.push(mapCodeToken(token));
		} else if (token.type === "hr") {
			blocks.push(visualEditorSchema.nodes.horizontal_rule.create());
		}
	}

	flushOrphanTableAlign();
	return blocks;
}

export function parseMarkdownToVisualDoc(markdown: string): ProseMirrorNode {
	if (markdown.trim().length === 0) {
		return visualEditorSchema.nodes.doc.create(null, [visualEditorSchema.nodes.paragraph.create()]);
	}
	const preScan = prescanMarkdown(markdown);
	const env: Record<string, unknown> =
		Object.keys(preScan.references).length > 0 ? { references: { ...preScan.references } } : {};
	const tokens = markdownItParser.parse(preScan.markdown, env);
	const blocks = mapBlockTokens(tokens, 0, tokens.length, preScan);
	return visualEditorSchema.nodes.doc.create(
		null,
		blocks.length > 0 ? blocks : [visualEditorSchema.nodes.paragraph.create()],
	);
}
