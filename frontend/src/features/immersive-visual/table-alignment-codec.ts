/**
 * Single TypeScript owner of the `<!-- easymde-table-align:v1 [...] -->`
 * grammar. Mirrors `src/Content/TableAlignmentAnnotation.php` exactly:
 * bounded payload, strictly ordered row/cell entries, an explicit row override
 * for every cell override, and no redundant row override.
 */
import type { TableTextAlign } from "./visual-schema";

export const TABLE_ALIGN_PREFIX = "<!-- easymde-table-align:v1 ";
export const TABLE_ALIGN_SUFFIX = " -->";

export type TableAlignAlignment = Exclude<TableTextAlign, null>;
export type TableAlignEntry =
	| readonly [number, TableAlignAlignment]
	| readonly [number, number, TableAlignAlignment];

export type TableAlignSnapshot = Readonly<{
	rowCount: number;
	columnCount: number;
	baseAlignments: ReadonlyArray<TableTextAlign>;
	cellAlignments: ReadonlyArray<ReadonlyArray<TableTextAlign>>;
}>;

const MAX_MARKER_LENGTH = 4096;
const MAX_ENTRIES = 1000;

function isAlignment(value: unknown): value is TableAlignAlignment {
	return value === "left" || value === "center" || value === "right";
}

function isSafeIndex(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isEntry(value: unknown): value is TableAlignEntry {
	if (!Array.isArray(value)) {
		return false;
	}
	if (value.length === 2) {
		return isSafeIndex(value[0]) && isAlignment(value[1]);
	}
	if (value.length === 3) {
		return (
			isSafeIndex(value[0]) && isSafeIndex(value[1]) && isAlignment(value[2])
		);
	}
	return false;
}

export function parseTableAlignComment(
	comment: string | null | undefined,
): TableAlignEntry[] | null {
	if (typeof comment !== "string") {
		return null;
	}
	if (
		comment.includes("\n") ||
		comment.includes("\r") ||
		comment.includes("\t")
	) {
		return null;
	}
	const trimmed = comment.trim();
	if (trimmed.length > MAX_MARKER_LENGTH) {
		return null;
	}
	if (
		!trimmed.startsWith(TABLE_ALIGN_PREFIX) ||
		!trimmed.endsWith(TABLE_ALIGN_SUFFIX)
	) {
		return null;
	}
	const payload = trimmed.slice(
		TABLE_ALIGN_PREFIX.length,
		trimmed.length - TABLE_ALIGN_SUFFIX.length,
	);
	let decoded: unknown;
	try {
		decoded = JSON.parse(payload) as unknown;
	} catch {
		return null;
	}
	if (!Array.isArray(decoded) || decoded.length > MAX_ENTRIES) {
		return null;
	}
	if (!decoded.every((entry) => isEntry(entry))) {
		return null;
	}
	return decoded as TableAlignEntry[];
}

function buildTableAlignComment(
	entries: ReadonlyArray<TableAlignEntry>,
): string | null {
	if (entries.length === 0 || entries.length > MAX_ENTRIES) {
		return null;
	}
	const comment = `${TABLE_ALIGN_PREFIX}${JSON.stringify(entries)}${TABLE_ALIGN_SUFFIX}`;
	return comment.length > MAX_MARKER_LENGTH ? null : comment;
}

function entryOrder(entry: TableAlignEntry): readonly [number, number] {
	return entry.length === 2 ? [entry[0], -1] : [entry[0], entry[1]];
}

function rowOverrideFor(
	entries: ReadonlyArray<TableAlignEntry>,
	row: number,
): TableAlignAlignment | null {
	for (const entry of entries) {
		if (entry.length === 2 && entry[0] === row) {
			return entry[1];
		}
	}
	return null;
}

export function validateTableAlignEntries(
	entries: ReadonlyArray<TableAlignEntry>,
	snapshot: TableAlignSnapshot,
): boolean {
	let previous: readonly [number, number] | null = null;
	for (const entry of entries) {
		const order = entryOrder(entry);
		if (order[0] >= snapshot.rowCount) {
			return false;
		}
		if (entry.length === 3 && entry[1] >= snapshot.columnCount) {
			return false;
		}
		if (
			previous !== null &&
			(order[0] < previous[0] ||
				(order[0] === previous[0] && order[1] <= previous[1]))
		) {
			return false;
		}
		previous = order;
	}

	for (const entry of entries) {
		const row = entry[0];
		const align = entry.length === 2 ? entry[1] : entry[2];
		if (entry.length === 2) {
			const hasDifferentBase = snapshot.baseAlignments.some(
				(base) => base !== align,
			);
			const hasCellException = entries.some(
				(candidate) => candidate.length === 3 && candidate[0] === row,
			);
			if (!hasDifferentBase && !hasCellException) {
				return false;
			}
			continue;
		}
		const rowAlignment = rowOverrideFor(entries, row);
		if (rowAlignment === null || rowAlignment === align) {
			return false;
		}
	}

	return true;
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
		if (!isAlignment(rowAlign)) {
			return null;
		}
		entries.push([row, rowAlign]);
		if (desired.every((align) => align === rowAlign)) {
			continue;
		}
		for (let column = 0; column < desired.length; column += 1) {
			const cellAlign = desired[column];
			if (cellAlign !== rowAlign && isAlignment(cellAlign)) {
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
		const preserved = buildTableAlignComment(storedEntries);
		if (preserved !== null) {
			return preserved;
		}
	}
	const derived = deriveTableAlignEntries(snapshot);
	return derived === null ? null : buildTableAlignComment(derived);
}
