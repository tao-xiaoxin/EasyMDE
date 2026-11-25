import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	RAW_REFERENCE_SOURCE_META_KEY,
	visualMarkdownItParser,
} from "./markdown-it-config";
import {
	type MarkdownToken,
	mapInlineTokens,
	readRawMetaString,
	tokenAttrString,
} from "./markdown-parser-inline";
import {
	markPreservedTaskParagraphs,
	stripTaskPrefix,
	type TaskParagraphContext,
} from "./markdown-parser-task";
import {
	isCommonMarkBlankLine,
	type PreScanResult,
	prescanMarkdown,
	readBlockquotePrefix,
	restoreProtectedInlineSentinels,
	stripBlockquoteDepth,
} from "./markdown-prescanner";
import {
	parseTableAlignComment,
	resolveTableAlignments,
	type TableAlignSnapshot,
	validateTableAlignEntries,
} from "./table-alignment-codec";
import {
	isValidTableTextAlign,
	normalizeHeadingLevel,
	sanitizeBulletMarker,
	type TableTextAlign,
	visualEditorSchema,
} from "./visual-schema";

export {
	extractReferenceDefinitionLabels,
	inspectReferenceDefinitionBlock,
	type ReferenceDefinitionBlockInfo,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-it-config";
export {
	type ParsedImageScaleTitle,
	parseImageScaleTitle,
} from "./markdown-parser-inline";
export { type PreScanResult, prescanMarkdown } from "./markdown-prescanner";

export type ParsedVisualBlockSource = Readonly<{
	node: ProseMirrorNode;
	raw: string | null;
	separatorBefore: string;
}>;

export type ParsedVisualDocument = Readonly<{
	blocks: ReadonlyArray<ParsedVisualBlockSource>;
	doc: ProseMirrorNode;
	leadingPrefix: string;
	lineEnding: "\n" | "\r\n";
	trailingSuffix: string;
}>;

type BlockMapContext = TaskParagraphContext;

function parseCellAlignmentFromToken(token: MarkdownToken): TableTextAlign {
	const match = /text-align\s*:\s*(left|center|right)/i.exec(
		tokenAttrString(token, "style") ?? "",
	);
	const normalized = match?.[1]?.toLowerCase() ?? null;
	return isValidTableTextAlign(normalized) ? normalized : null;
}

function readCellAlignment(node: ProseMirrorNode | undefined): TableTextAlign {
	const align = node?.attrs.textAlign;
	return isValidTableTextAlign(align) ? align : null;
}

function ensureListItemChildren(
	blocks: ReadonlyArray<ProseMirrorNode>,
): ProseMirrorNode[] {
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
	const rawRows: ProseMirrorNode[] = [];
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
				inlineToken?.type === "inline"
					? mapInlineTokens(inlineToken.children, preScan, true)
					: [];
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
			rawRows.push(visualEditorSchema.nodes.table_row.create(null, cells));
		}
		i = rowClose;
	}

	if (rawRows.length === 0) {
		rawRows.push(
			visualEditorSchema.nodes.table_row.create(null, [
				visualEditorSchema.nodes.table_header.create(
					null,
					visualEditorSchema.nodes.paragraph.create(),
				),
			]),
		);
	}

	let columnCount = 0;
	for (const rowNode of rawRows) {
		columnCount = Math.max(columnCount, rowNode.childCount);
	}
	const headerRow = rawRows[0];
	const baseColumnAlignments: TableTextAlign[] = [];
	for (let column = 0; column < columnCount; column += 1) {
		baseColumnAlignments.push(
			readCellAlignment(headerRow?.child(column) ?? undefined),
		);
	}

	const snapshot: TableAlignSnapshot = {
		baseAlignments: baseColumnAlignments,
		cellAlignments: rawRows.map((rowNode) => {
			const cells: TableTextAlign[] = [];
			for (let column = 0; column < columnCount; column += 1) {
				cells.push(readCellAlignment(rowNode.child(column)));
			}
			return cells;
		}),
		columnCount,
		rowCount: rawRows.length,
	};
	const entries = parseTableAlignComment(alignAnnotation);
	const validAnnotation =
		entries !== null && validateTableAlignEntries(entries, snapshot);
	const resolved = validAnnotation
		? resolveTableAlignments(entries, snapshot)
		: null;

	const finalRows = resolved
		? rawRows.map((rowNode, rowIndex) => {
				const cells: ProseMirrorNode[] = [];
				for (let column = 0; column < rowNode.childCount; column += 1) {
					const cell = rowNode.child(column);
					cells.push(
						cell.type.create(
							{
								...cell.attrs,
								textAlign: resolved[rowIndex]?.[column] ?? cell.attrs.textAlign,
							},
							cell.content,
						),
					);
				}
				return rowNode.type.create(rowNode.attrs, cells);
			})
		: rawRows;

	return visualEditorSchema.nodes.table.create(
		{
			alignAnnotation: validAnnotation ? alignAnnotation : null,
			columnAlignments: baseColumnAlignments,
		},
		finalRows,
	);
}

type CollectedListItem = Readonly<{
	children: ProseMirrorNode[];
	range: Readonly<{ end: number; start: number }> | null;
}>;

type MappedListEntry = Readonly<{
	node: ProseMirrorNode;
	origRange: Readonly<{ end: number; start: number }> | null;
}>;

function collectListItems(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	context: BlockMapContext,
): CollectedListItem[] {
	const items: CollectedListItem[] = [];
	for (let i = startIndex + 1; i < endIndex; i += 1) {
		if (tokens[i]?.type !== "list_item_open") {
			continue;
		}
		const itemClose = findMatchingCloseIndex(
			tokens,
			i,
			"list_item_open",
			"list_item_close",
		);
		items.push({
			children: mapBlockTokens(tokens, i + 1, itemClose, context),
			range: resolveOriginalRangeFromTokenMap(tokens[i]?.map, context.preScan),
		});
		i = itemClose;
	}
	return items;
}

function trimmedBlockMapEnd(
	map: [number, number] | null | undefined,
	quoteDepth: number,
	preScan: PreScanResult,
): number | null {
	if (!map || map.length < 2) return null;
	let end = map[1];
	while (end > map[0]) {
		const range = preScan.outputLineRanges[end - 1];
		if (!range || range.end - range.start !== 1) break;
		const raw = preScan.rawLines[range.start] ?? "";
		const rest = quoteDepth > 0 ? stripBlockquoteDepth(raw, quoteDepth) : raw;
		if (rest === null || !isCommonMarkBlankLine(rest)) break;
		end -= 1;
	}
	return end;
}

/**
 * Reports whether a CommonMark list is tight via direct paragraph visibility
 * (`hidden === true`) and blank-line gaps between consecutive direct items or
 * direct child blocks (keeping loose lists without direct paragraphs, such as
 * `- > a\n\n  > b`, marked `tight: false`).
 */
function isTightListRange(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	preScan: PreScanResult,
): boolean {
	const startOut = tokens[startIndex]?.map?.[0];
	const startOrig =
		startOut !== undefined ? preScan.outputLineRanges[startOut]?.start : null;
	const quoteDepth =
		startOrig != null
			? readBlockquotePrefix(preScan.rawLines[startOrig] ?? "").depth
			: 0;
	let prevItemEnd: number | null = null;
	for (let i = startIndex + 1; i < endIndex; i += 1) {
		const item = tokens[i];
		if (item?.type !== "list_item_open") continue;
		const itemClose = findMatchingCloseIndex(
			tokens,
			i,
			"list_item_open",
			"list_item_close",
		);
		const itemStart = item.map?.[0] ?? null;
		if (prevItemEnd !== null && itemStart !== null && itemStart > prevItemEnd) {
			return false;
		}
		let prevChildEnd: number | null = null;
		for (let j = i + 1; j < itemClose; j += 1) {
			const child = tokens[j];
			if (!child) continue;
			if (child.type === "paragraph_open" && child.hidden !== true) return false;
			const childStart = child.map?.[0] ?? null;
			const childEnd = trimmedBlockMapEnd(child.map, quoteDepth, preScan);
			if (
				prevChildEnd !== null &&
				childStart !== null &&
				childStart > prevChildEnd
			) {
				return false;
			}
			if (childEnd !== null) prevChildEnd = childEnd;
			if (child.nesting === 1) {
				for (let depth = 1; depth > 0 && j + 1 < itemClose; ) {
					j += 1;
					depth += tokens[j]?.nesting ?? 0;
				}
			}
		}
		prevItemEnd =
			prevChildEnd ?? trimmedBlockMapEnd(item.map, quoteDepth, preScan);
		i = itemClose;
	}
	return true;
}

function combineItemRanges(
	items: ReadonlyArray<CollectedListItem>,
): Readonly<{ end: number; start: number }> | null {
	let start = Number.POSITIVE_INFINITY;
	let end = -1;
	for (const item of items) {
		if (!item.range) {
			return null;
		}
		start = Math.min(start, item.range.start);
		end = Math.max(end, item.range.end);
	}
	return Number.isFinite(start) && end > start ? { end, start } : null;
}

function mapBulletListTokens(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	context: BlockMapContext,
): MappedListEntry[] {
	const items = collectListItems(tokens, startIndex, endIndex, context);
	if (items.length === 0) {
		return [];
	}

	const marker = sanitizeBulletMarker(tokens[startIndex]?.markup);
	const tight = isTightListRange(tokens, startIndex, endIndex, context.preScan);
	const lists: MappedListEntry[] = [];
	type ClassifiedItem = Readonly<{
		entry: CollectedListItem;
		task: ReturnType<typeof stripTaskPrefix>;
	}>;
	let currentGroup: ClassifiedItem[] = [];
	let currentIsTask: boolean | null = null;

	const flush = (): void => {
		if (currentGroup.length === 0 || currentIsTask === null) {
			return;
		}
		const listType = currentIsTask
			? visualEditorSchema.nodes.task_list
			: visualEditorSchema.nodes.bullet_list;
		const itemNodes = currentGroup.map(({ entry, task }) =>
			task
				? visualEditorSchema.nodes.task_item.create(
						{ checked: task.checked },
						ensureListItemChildren(
							markPreservedTaskParagraphs(task.children, context),
						),
					)
				: visualEditorSchema.nodes.list_item.create(
						null,
						ensureListItemChildren(
							markPreservedTaskParagraphs(entry.children, context),
						),
					),
		);
		lists.push({
			node: listType.create({ marker, tight }, itemNodes),
			origRange: combineItemRanges(currentGroup.map((item) => item.entry)),
		});
		currentGroup = [];
	};

	for (const entry of items) {
		const task = stripTaskPrefix(entry.children, context);
		const isTask = task !== null;
		if (currentIsTask !== null && isTask !== currentIsTask) {
			flush();
		}
		currentIsTask = isTask;
		currentGroup.push({ entry, task });
	}
	flush();
	return lists;
}

function mapCodeToken(
	token: MarkdownToken,
	preScan: PreScanResult,
): ProseMirrorNode {
	const isFence = token.type === "fence";
	const fenceChar = isFence && token.markup.startsWith("~") ? "~" : "`";
	const fenceLength =
		isFence && token.markup.length >= 3 ? token.markup.length : 3;
	const info = isFence
		? restoreProtectedInlineSentinels(token.info.trim(), preScan)
		: "";
	const language = info ? (info.split(/\s+/)[0] ?? "") : "";
	const content = restoreProtectedInlineSentinels(token.content, preScan);
	// Bijection with `serializeCodeBlock`: a body of only blank lines
	// (`"\n".repeat(k)`) is kept verbatim; any other body drops exactly the one
	// line terminator before the closing fence, so trailing blank lines survive.
	const pureNewlines = /^\n+$/.test(content);
	const rawContent = pureNewlines
		? content
		: content.endsWith("\n")
			? content.slice(0, -1)
			: content;

	if (language.toLowerCase() === "mermaid") {
		const fence = fenceChar.repeat(fenceLength);
		const rawMarkdown =
			rawContent.length === 0
				? `${fence}${info}\n${fence}`
				: pureNewlines
					? `${fence}${info}\n${rawContent}${fence}`
					: `${fence}${info}\n${rawContent}\n${fence}`;
		return visualEditorSchema.nodes.protected_block.create({
			kind: "mermaid",
			rawMarkdown,
		});
	}
	return visualEditorSchema.nodes.code_block.create(
		{ language, info, fenceChar, fenceLength },
		rawContent.length > 0 ? visualEditorSchema.text(rawContent) : null,
	);
}

type MappedBlockEntry = Readonly<{
	node: ProseMirrorNode;
	origRange: Readonly<{ end: number; start: number }> | null;
}>;

function resolveOriginalRangeFromTokenMap(
	map: [number, number] | null | undefined,
	preScan: PreScanResult,
): Readonly<{ end: number; start: number }> | null {
	if (!map || map.length < 2) {
		return null;
	}
	const startLine = map[0];
	const endLine = map[1];
	if (
		!Number.isInteger(startLine) ||
		!Number.isInteger(endLine) ||
		startLine < 0 ||
		endLine <= startLine
	) {
		return null;
	}
	let origStart = Number.POSITIVE_INFINITY;
	let origEnd = -1;
	for (let lineIdx = startLine; lineIdx < endLine; lineIdx += 1) {
		const range = preScan.outputLineRanges[lineIdx];
		if (!range) {
			if (!isCommonMarkBlankLine(preScan.outputLines[lineIdx] ?? "")) {
				return null;
			}
			continue;
		}
		if (range.start < origStart) {
			origStart = range.start;
		}
		if (range.end > origEnd) {
			origEnd = range.end;
		}
	}
	if (!Number.isFinite(origStart) || origEnd <= origStart) {
		return null;
	}
	// markdown-it can include trailing blank lines in list/blockquote token maps;
	// trim trailing blank lines so the exact inter-block separator stays outside the block.
	while (
		origEnd > origStart &&
		isCommonMarkBlankLine(preScan.rawLines[origEnd - 1] ?? "")
	) {
		origEnd -= 1;
	}
	return origEnd > origStart ? { start: origStart, end: origEnd } : null;
}

function mapBlockTokensWithRanges(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	context: BlockMapContext,
): MappedBlockEntry[] {
	const { paragraphRawContents, preScan, referenceBlocks } = context;
	const entries: MappedBlockEntry[] = [];
	let pendingTableAlign: Readonly<{
		marker: string;
		origRange: Readonly<{ end: number; start: number }> | null;
	}> | null = null;

	const flushOrphanTableAlign = (): void => {
		if (pendingTableAlign !== null) {
			entries.push({
				node: visualEditorSchema.nodes.protected_block.create({
					kind: "raw",
					rawMarkdown: pendingTableAlign.marker,
				}),
				origRange: pendingTableAlign.origRange,
			});
			pendingTableAlign = null;
		}
	};

	for (let i = startIndex; i < endIndex; i += 1) {
		const token = tokens[i];
		if (!token) {
			continue;
		}

		if (token.type === "easymde_table_align") {
			const tableAlign = preScan.tableAlignMarkers.get(token.content);
			if (tableAlign !== undefined) {
				flushOrphanTableAlign();
				pendingTableAlign = {
					marker: tableAlign,
					origRange: resolveOriginalRangeFromTokenMap(token.map, preScan),
				};
				continue;
			}
		}

		if (token.type === "paragraph_open") {
			const closeIdx = findMatchingCloseIndex(
				tokens,
				i,
				"paragraph_open",
				"paragraph_close",
			);
			const inlineToken = tokens[i + 1];
			const trimmed =
				inlineToken?.type === "inline" ? inlineToken.content.trim() : "";
			const origRange = resolveOriginalRangeFromTokenMap(token.map, preScan);

			const tableAlign = preScan.tableAlignMarkers.get(trimmed);
			if (tableAlign !== undefined) {
				flushOrphanTableAlign();
				pendingTableAlign = { marker: tableAlign, origRange };
				i = closeIdx;
				continue;
			}
			flushOrphanTableAlign();

			const protectedEntry = preScan.protectedBlocks.get(trimmed);
			if (protectedEntry) {
				entries.push({
					node: visualEditorSchema.nodes.protected_block.create(protectedEntry),
					origRange,
				});
			} else if (/^\[TOC\]$/i.test(trimmed)) {
				entries.push({
					node: visualEditorSchema.nodes.protected_block.create({
						kind: "toc",
						rawMarkdown: trimmed,
					}),
					origRange,
				});
			} else {
				const rawContent =
					inlineToken?.type === "inline" ? inlineToken.content : "";
				const inlines =
					inlineToken?.type === "inline"
						? mapInlineTokens(inlineToken.children, preScan, false)
						: [];
				const paragraphNode = visualEditorSchema.nodes.paragraph.create(
					null,
					inlines,
				);
				paragraphRawContents.set(paragraphNode, rawContent);
				entries.push({
					node: paragraphNode,
					origRange,
				});
			}
			i = closeIdx;
			continue;
		}

		if (token.type === "table_open") {
			const closeIdx = findMatchingCloseIndex(
				tokens,
				i,
				"table_open",
				"table_close",
			);
			const annotation = pendingTableAlign;
			pendingTableAlign = null;
			const tableRange = resolveOriginalRangeFromTokenMap(token.map, preScan);
			const combinedRange =
				tableRange && annotation?.origRange
					? {
							start: Math.min(annotation.origRange.start, tableRange.start),
							end: Math.max(annotation.origRange.end, tableRange.end),
						}
					: tableRange;
			entries.push({
				node: mapTableTokens(
					tokens,
					i,
					closeIdx,
					preScan,
					annotation?.marker ?? null,
				),
				origRange: combinedRange,
			});
			i = closeIdx;
			continue;
		}

		flushOrphanTableAlign();
		const origRange = resolveOriginalRangeFromTokenMap(token.map, preScan);

		if (token.type === "easymde_protected_block") {
			const protectedEntry = preScan.protectedBlocks.get(token.content);
			if (protectedEntry) {
				entries.push({
					node: visualEditorSchema.nodes.protected_block.create(protectedEntry),
					origRange,
				});
			}
			continue;
		}

		if (token.type === "heading_open") {
			const closeIdx = findMatchingCloseIndex(
				tokens,
				i,
				"heading_open",
				"heading_close",
			);
			const level = normalizeHeadingLevel(
				Number.parseInt(token.tag.slice(1), 10),
			);
			const inlineToken = tokens[i + 1];
			const inlines =
				inlineToken?.type === "inline"
					? mapInlineTokens(inlineToken.children, preScan, false)
					: [];
			entries.push({
				node: visualEditorSchema.nodes.heading.create({ level }, inlines),
				origRange,
			});
			i = closeIdx;
		} else if (token.type === "blockquote_open") {
			const closeIdx = findMatchingCloseIndex(
				tokens,
				i,
				"blockquote_open",
				"blockquote_close",
			);
			const inner = mapBlockTokens(tokens, i + 1, closeIdx, context);
			entries.push({
				node: visualEditorSchema.nodes.blockquote.create(
					null,
					inner.length > 0
						? inner
						: [visualEditorSchema.nodes.paragraph.create()],
				),
				origRange,
			});
			i = closeIdx;
		} else if (token.type === "bullet_list_open") {
			const closeIdx = findMatchingCloseIndex(
				tokens,
				i,
				"bullet_list_open",
				"bullet_list_close",
			);
			const listEntries = mapBulletListTokens(tokens, i, closeIdx, context);
			// A mixed task/bullet list splits into several nodes; each keeps its
			// exact monotonic source range so an unrelated edit cannot duplicate it.
			for (const listEntry of listEntries) {
				entries.push(listEntry);
			}
			i = closeIdx;
		} else if (token.type === "ordered_list_open") {
			const closeIdx = findMatchingCloseIndex(
				tokens,
				i,
				"ordered_list_open",
				"ordered_list_close",
			);
			const parsedOrder = Number.parseInt(
				tokenAttrString(token, "start") ?? "1",
				10,
			);
			const order =
				Number.isInteger(parsedOrder) && parsedOrder >= 0 ? parsedOrder : 1;
			const delimiter = token.markup === ")" ? ")" : ".";
			const tight = isTightListRange(tokens, i, closeIdx, context.preScan);
			const collected = collectListItems(tokens, i, closeIdx, context);
			const items = collected.map((item) =>
				visualEditorSchema.nodes.list_item.create(
					null,
					ensureListItemChildren(
						markPreservedTaskParagraphs(item.children, context),
					),
				),
			);
			if (items.length > 0) {
				entries.push({
					node: visualEditorSchema.nodes.ordered_list.create(
						{ delimiter, order, tight },
						items,
					),
					origRange: origRange ?? combineItemRanges(collected),
				});
			}
			i = closeIdx;
		} else if (token.type === "reference_definition") {
			const readRefRaw = (
				refToken: MarkdownToken,
				refRange: Readonly<{ end: number; start: number }> | null,
			): string => {
				const metaRaw = readRawMetaString(
					refToken,
					RAW_REFERENCE_SOURCE_META_KEY,
				);
				if (metaRaw !== null) {
					return metaRaw;
				}
				return refRange
					? preScan.rawLines.slice(refRange.start, refRange.end).join("\n")
					: "";
			};
			let groupEndIdx = i;
			const groupStart = origRange?.start ?? -1;
			let groupEnd = origRange?.end ?? -1;
			const rawParts: string[] = [readRefRaw(token, origRange)];
			while (groupEndIdx + 1 < endIndex) {
				const nextToken = tokens[groupEndIdx + 1];
				if (nextToken?.type !== "reference_definition") {
					break;
				}
				const nextRange = resolveOriginalRangeFromTokenMap(
					nextToken.map,
					preScan,
				);
				if (!nextRange || groupStart < 0 || nextRange.start !== groupEnd) {
					break;
				}
				rawParts.push(readRefRaw(nextToken, nextRange));
				groupEnd = nextRange.end;
				groupEndIdx += 1;
			}
			const combinedRange =
				groupStart >= 0 && groupEnd > groupStart
					? { start: groupStart, end: groupEnd }
					: origRange;
			const refNode = visualEditorSchema.nodes.protected_block.create({
				kind: "raw",
				rawMarkdown: rawParts.join("\n"),
			});
			referenceBlocks.add(refNode);
			entries.push({
				node: refNode,
				origRange: combinedRange,
			});
			i = groupEndIdx;
		} else if (token.type === "fence" || token.type === "code_block") {
			entries.push({ node: mapCodeToken(token, preScan), origRange });
		} else if (token.type === "hr") {
			entries.push({
				node: visualEditorSchema.nodes.horizontal_rule.create(),
				origRange,
			});
		}
	}

	flushOrphanTableAlign();
	return entries;
}

function mapBlockTokens(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	context: BlockMapContext,
): ProseMirrorNode[] {
	return mapBlockTokensWithRanges(tokens, startIndex, endIndex, context).map(
		(entry) => entry.node,
	);
}

export function parseMarkdownWithBlockSources(
	markdown: string,
): ParsedVisualDocument {
	if (/^[ \t\r\n]*$/.test(markdown)) {
		return {
			blocks: [],
			doc: visualEditorSchema.nodes.doc.create(null, [
				visualEditorSchema.nodes.paragraph.create(),
			]),
			leadingPrefix: "",
			lineEnding: "\n",
			trailingSuffix: "",
		};
	}
	const preScan = prescanMarkdown(markdown);
	const env: Record<string, unknown> = {
		preScan,
		tableAlignMarkers: preScan.tableAlignMarkers,
	};
	const tokens = visualMarkdownItParser.parse(preScan.markdown, env);
	const context: BlockMapContext = {
		env,
		paragraphRawContents: new WeakMap<ProseMirrorNode, string>(),
		preScan,
		referenceBlocks: new WeakSet<ProseMirrorNode>(),
	};
	const mapped = mapBlockTokensWithRanges(tokens, 0, tokens.length, context);
	const doc = visualEditorSchema.nodes.doc.create(
		null,
		mapped.length > 0
			? mapped.map((entry) => entry.node)
			: [visualEditorSchema.nodes.paragraph.create()],
	);

	const rawLines = preScan.rawLines;
	const firstRange = mapped[0]?.origRange ?? null;
	const leadingPrefix =
		firstRange && firstRange.start > 0
			? `${rawLines.slice(0, firstRange.start).join("\n")}\n`
			: "";

	let lastKnownEnd = 0;
	let previousHadRange = false;
	let hasMonotonicRanges = mapped.length > 0;
	const blocks: ParsedVisualBlockSource[] = [];

	for (let idx = 0; idx < mapped.length; idx += 1) {
		const entry = mapped[idx];
		if (!entry) {
			continue;
		}
		const range = entry.origRange;
		if (range && range.start >= lastKnownEnd && range.end <= rawLines.length) {
			const raw = rawLines.slice(range.start, range.end).join("\n");
			const separatorBefore =
				idx === 0
					? ""
					: !previousHadRange
						? "\n\n"
						: range.start > lastKnownEnd
							? `\n${rawLines.slice(lastKnownEnd, range.start).join("\n")}\n`
							: "\n";
			blocks.push({ node: entry.node, raw, separatorBefore });
			lastKnownEnd = range.end;
			previousHadRange = true;
		} else {
			hasMonotonicRanges = false;
			previousHadRange = false;
			blocks.push({
				node: entry.node,
				raw: null,
				separatorBefore: idx === 0 ? "" : "\n\n",
			});
		}
	}

	const lastRange = mapped[mapped.length - 1]?.origRange ?? null;
	const trailingSuffix =
		hasMonotonicRanges && lastRange && lastRange.end < rawLines.length
			? `\n${rawLines.slice(lastRange.end).join("\n")}`
			: "";

	return {
		blocks,
		doc,
		leadingPrefix: hasMonotonicRanges ? leadingPrefix : "",
		lineEnding: preScan.lineEnding,
		trailingSuffix,
	};
}

export function parseMarkdownToVisualDoc(markdown: string): ProseMirrorNode {
	return parseMarkdownWithBlockSources(markdown).doc;
}

export function parseInlineMarkdownFragment(
	markdown: string,
): ProseMirrorNode[] {
	if (markdown.length === 0) {
		return [];
	}
	const preScan = prescanMarkdown(markdown);
	const tokens = visualMarkdownItParser.parseInline(preScan.markdown, {});
	return mapInlineTokens(tokens[0]?.children ?? null, preScan, false);
}
