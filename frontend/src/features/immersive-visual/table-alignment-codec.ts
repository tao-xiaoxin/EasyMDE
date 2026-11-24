/**
 * Visual-editor adapter over the shared canonical
 * `<!-- easymde-table-align:v1 [...] -->` grammar in
 * `shared/table-alignment-marker.ts` (mirroring PHP
 * `src/Content/TableAlignmentAnnotation.php`).
 */
import {
	isTableAlignmentMarkerValue,
	parseReservedTableAlignmentMarkerLine,
	parseTableAlignmentEntryList,
	serializeTableAlignmentMarker,
	TABLE_ALIGNMENT_MARKER_PREFIX,
	TABLE_ALIGNMENT_MARKER_SUFFIX,
	type TableAlignmentMarkerEntry,
	type TableAlignmentMarkerValue,
	validateTableAlignmentEntries,
} from "../../shared/table-alignment-marker";
import type { TableTextAlign } from "./visual-schema";

export const TABLE_ALIGN_PREFIX = TABLE_ALIGNMENT_MARKER_PREFIX;
export const TABLE_ALIGN_SUFFIX = TABLE_ALIGNMENT_MARKER_SUFFIX;

export type TableAlignAlignment = TableAlignmentMarkerValue;
export type TableAlignEntry = TableAlignmentMarkerEntry;

export type TableAlignSnapshot = Readonly<{
	rowCount: number;
	columnCount: number;
	baseAlignments: ReadonlyArray<TableTextAlign>;
	cellAlignments: ReadonlyArray<ReadonlyArray<TableTextAlign>>;
}>;

export function parseTableAlignComment(
	comment: string | null | undefined,
): TableAlignEntry[] | null {
	if (typeof comment !== "string") {
		return null;
	}
	const parsed = parseReservedTableAlignmentMarkerLine(comment);
	if (null === parsed || "code" in parsed) {
		return null;
	}
	return parseTableAlignmentEntryList(parsed.rawEntries);
}

export function validateTableAlignEntries(
	entries: ReadonlyArray<TableAlignEntry>,
	snapshot: TableAlignSnapshot,
): boolean {
	return "entries" in validateTableAlignmentEntries(entries, snapshot);
}

export function resolveTableAlignments(
	entries: ReadonlyArray<TableAlignEntry>,
	snapshot: TableAlignSnapshot,
): TableTextAlign[][] {
	const resolved: TableTextAlign[][] = [];
	for (let row = 0; row < snapshot.rowCount; row += 1) {
		const cells: TableTextAlign[] = [];
		for (let column = 0; column < snapshot.columnCount; column += 1) {
			cells.push(snapshot.baseAlignments[column] ?? null);
		}
		resolved.push(cells);
	}
	for (const entry of entries) {
		if (entry.length !== 2) {
			continue;
		}
		const rowCells = resolved[entry[0]];
		if (!rowCells) {
			continue;
		}
		for (let column = 0; column < rowCells.length; column += 1) {
			rowCells[column] = entry[1];
		}
	}
	for (const entry of entries) {
		if (entry.length !== 3) {
			continue;
		}
		const rowCells = resolved[entry[0]];
		if (rowCells) {
			rowCells[entry[1]] = entry[2];
		}
	}
	return resolved;
}

function effectiveAlignment(
	cell: TableTextAlign | undefined,
	base: TableTextAlign | undefined,
): TableTextAlign {
	return cell ?? base ?? null;
}

function matchesSnapshot(
	resolved: ReadonlyArray<ReadonlyArray<TableTextAlign>>,
	snapshot: TableAlignSnapshot,
): boolean {
	for (let row = 0; row < snapshot.rowCount; row += 1) {
		for (let column = 0; column < snapshot.columnCount; column += 1) {
			const desired = effectiveAlignment(
				snapshot.cellAlignments[row]?.[column],
				snapshot.baseAlignments[column],
			);
			if ((resolved[row]?.[column] ?? null) !== desired) {
				return false;
			}
		}
	}
	return true;
}

function deriveTableAlignEntries(
	snapshot: TableAlignSnapshot,
): TableAlignEntry[] | null {
	const entries: TableAlignEntry[] = [];
	for (let row = 0; row < snapshot.rowCount; row += 1) {
		const desired: TableTextAlign[] = [];
		let differs = false;
		for (let column = 0; column < snapshot.columnCount; column += 1) {
			const base = snapshot.baseAlignments[column] ?? null;
			const effective = effectiveAlignment(
				snapshot.cellAlignments[row]?.[column],
				base,
			);
			desired.push(effective);
			if (effective !== base) {
				differs = true;
			}
		}
		if (!differs) {
			continue;
		}
		// CommonMark cannot express a cell that is explicitly cleared back to
		// "no alignment" while another cell in the same row is aligned: the PHP
		// grammar only accepts `left | center | right`. Omit instead of emitting
		// an annotation that PHP would reject.
		if (desired.some((align) => align === null)) {
			return null;
		}
		const candidateIndex = desired.findIndex(
			(align, column) => align !== (snapshot.baseAlignments[column] ?? null),
		);
		const rowAlign = desired[candidateIndex];
		if (!isTableAlignmentMarkerValue(rowAlign)) {
			return null;
		}
		entries.push([row, rowAlign]);
		if (desired.every((align) => align === rowAlign)) {
			continue;
		}
		for (let column = 0; column < desired.length; column += 1) {
			const cellAlign = desired[column];
			if (cellAlign !== rowAlign && isTableAlignmentMarkerValue(cellAlign)) {
				entries.push([row, column, cellAlign]);
			}
		}
	}
	return entries.length > 0 ? entries : null;
}

/**
 * Preserve a valid stored annotation verbatim (canonical JSON) when it still
 * describes the live table; otherwise derive a PHP-valid replacement, or omit
 * the annotation so PHP never throws on a redundant/out-of-bounds entry.
 */
export function reconcileTableAlignComment(
	storedComment: string | null,
	snapshot: TableAlignSnapshot,
): string | null {
	const storedEntries = parseTableAlignComment(storedComment);
	if (
		storedEntries &&
		validateTableAlignEntries(storedEntries, snapshot) &&
		matchesSnapshot(resolveTableAlignments(storedEntries, snapshot), snapshot)
	) {
		const preserved = serializeTableAlignmentMarker(storedEntries);
		if (preserved !== null) {
			return preserved;
		}
	}
	const derived = deriveTableAlignEntries(snapshot);
	return derived === null ? null : serializeTableAlignmentMarker(derived);
}
