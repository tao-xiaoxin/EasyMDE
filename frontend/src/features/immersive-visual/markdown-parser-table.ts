import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	createTextBlockWithReferenceRuns,
	type InlineReferenceCollectors,
	type MarkdownToken,
	mapInlineTokens,
	tokenAttrString,
} from "./markdown-parser-inline";
import type { PreScanResult } from "./markdown-prescanner";
import {
	parseTableAlignComment,
	resolveTableAlignments,
	type TableAlignSnapshot,
	validateTableAlignEntries,
} from "./table-alignment-codec";
import {
	isValidTableTextAlign,
	type TableTextAlign,
	visualEditorSchema,
} from "./visual-schema";

/**
 * Feature-private GFM table token mapping (including `easymde-table-align:v1`
 * alignment resolution and inline reference-link/image preservation) for
 * `markdown-parser.ts`.
 */

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

function findMatchingTableCloseIndex(
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

export function mapTableTokens(
	tokens: ReadonlyArray<MarkdownToken>,
	startIndex: number,
	endIndex: number,
	preScan: PreScanResult,
	alignAnnotation: string | null,
	collectors?: InlineReferenceCollectors,
): ProseMirrorNode {
	const rawRows: ProseMirrorNode[] = [];
	for (let i = startIndex + 1; i < endIndex; i += 1) {
		if (tokens[i]?.type !== "tr_open") {
			continue;
		}
		const rowClose = findMatchingTableCloseIndex(
			tokens,
			i,
			"tr_open",
			"tr_close",
		);
		const cells: ProseMirrorNode[] = [];
		for (let j = i + 1; j < rowClose; j += 1) {
			const cellToken = tokens[j];
			if (cellToken?.type !== "th_open" && cellToken?.type !== "td_open") {
				continue;
			}
			const isHeader = cellToken.type === "th_open";
			const cellClose = findMatchingTableCloseIndex(
				tokens,
				j,
				cellToken.type,
				isHeader ? "th_close" : "td_close",
			);
			const inlineToken = tokens[j + 1];
			const inlineNodes =
				inlineToken?.type === "inline"
					? mapInlineTokens(inlineToken.children, preScan, true, collectors)
					: [];
			const cellType = isHeader
				? visualEditorSchema.nodes.table_header
				: visualEditorSchema.nodes.table_cell;
			cells.push(
				cellType.create(
					{ textAlign: parseCellAlignmentFromToken(cellToken) },
					createTextBlockWithReferenceRuns(
						visualEditorSchema.nodes.paragraph,
						null,
						inlineNodes,
						collectors,
					),
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
