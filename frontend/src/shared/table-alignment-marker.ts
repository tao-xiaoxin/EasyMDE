import { utf8ByteLength } from "./utf8-byte-length";

/**
 * Single canonical TypeScript owner of the `<!-- easymde-table-align:v1 [...] -->`
 * marker grammar, mirroring PHP `EasyMDE\Content\TableAlignmentAnnotation`.
 */
export const TABLE_ALIGNMENT_MARKER_PREFIX = "<!-- easymde-table-align:v1 ";
export const TABLE_ALIGNMENT_MARKER_RESERVED_PREFIX =
	"<!-- easymde-table-align:";
export const TABLE_ALIGNMENT_MARKER_SUFFIX = " -->";
export const TABLE_ALIGNMENT_MAX_MARKER_BYTES = 4096;
export const TABLE_ALIGNMENT_MAX_ENTRIES = 1000;

export type TableAlignmentMarkerValue = "center" | "left" | "right";
export type TableAlignmentMarkerBaseValue = TableAlignmentMarkerValue | null;

export type TableAlignmentMarkerEntry =
	| readonly [row: number, alignment: TableAlignmentMarkerValue]
	| readonly [row: number, column: number, alignment: TableAlignmentMarkerValue];

export type TableAlignmentMarkerParseErrorCode =
	| "table-alignment-annotation-entry-invalid"
	| "table-alignment-annotation-marker-invalid"
	| "table-alignment-annotation-marker-too-large";

export type TableAlignmentMarkerValidationErrorCode =
	| "table-alignment-annotation-entry-invalid"
	| "table-alignment-annotation-entry-order-invalid"
	| "table-alignment-annotation-entry-redundant";

export type TableAlignmentMarkerErrorCode =
	| TableAlignmentMarkerParseErrorCode
	| TableAlignmentMarkerValidationErrorCode;

export type ParsedTableAlignmentMarkerLine =
	| Readonly<{
			fromOffset: number;
			markerToOffset: number;
			rawEntries: ReadonlyArray<unknown>;
			text: string;
	  }>
	| Readonly<{
			code: TableAlignmentMarkerParseErrorCode;
	  }>;

export type TableAlignmentValidationBounds = Readonly<{
	baseAlignments: ReadonlyArray<TableAlignmentMarkerBaseValue>;
	columnCount: number;
	rowCount: number;
}>;

export type ValidatedTableAlignmentEntries =
	| Readonly<{ entries: TableAlignmentMarkerEntry[] }>
	| Readonly<{ code: TableAlignmentMarkerValidationErrorCode }>;

export function isTableAlignmentMarkerValue(
	value: unknown,
): value is TableAlignmentMarkerValue {
	return "left" === value || "center" === value || "right" === value;
}

export function isTableAlignmentMarkerBaseValue(
	value: unknown,
): value is TableAlignmentMarkerBaseValue {
	return null === value || isTableAlignmentMarkerValue(value);
}

export function isTableAlignmentSafeIndex(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

export function compareTableAlignmentEntries(
	left: TableAlignmentMarkerEntry,
	right: TableAlignmentMarkerEntry,
): number {
	const rowDelta = left[0] - right[0];
	if (0 !== rowDelta) {
		return rowDelta;
	}
	const leftColumn = 3 === left.length ? left[1] : -1;
	const rightColumn = 3 === right.length ? right[1] : -1;
	return leftColumn - rightColumn;
}

/**
 * Matches PHP `TableAlignmentAnnotation::is_reserved_marker()`:
 * `/^ {0,3}<!-- easymde-table-align:/D`.
 * Returns the leading ASCII space count (`0..3`), or `null` when the line
 * starts with a tab, 4+ spaces, non-ASCII whitespace (such as `\u00a0`), or
 * non-marker text.
 */
export function isReservedTableAlignmentMarkerPrefix(
	rawLine: string,
): number | null {
	const match = /^( {0,3})<!-- easymde-table-align:/u.exec(rawLine);
	return undefined !== match?.[1] ? match[1].length : null;
}

/**
 * Parses one reserved `<!-- easymde-table-align:...` line using the exact PHP
 * lexical rules: rejects `\r`, `\n`, and `\t` anywhere in the line, strips
 * only ASCII space `' '` at the ends (never `.trim()`), enforces the 4096
 * UTF-8 byte cap, checks exact v1 prefix/suffix, and decodes a bounded JSON
 * array (<= 1000 entries). Returns `null` when `rawLine` does not begin with
 * a reserved marker prefix.
 */
export function parseReservedTableAlignmentMarkerLine(
	rawLine: string,
): ParsedTableAlignmentMarkerLine | null {
	const leading = isReservedTableAlignmentMarkerPrefix(rawLine);
	if (null === leading) {
		return null;
	}
	if (
		rawLine.includes("\r") ||
		rawLine.includes("\n") ||
		rawLine.includes("\t")
	) {
		return { code: "table-alignment-annotation-marker-invalid" };
	}
	const trailing = rawLine.match(/ *$/u)?.[0].length ?? 0;
	const fromOffset = leading;
	const markerToOffset = rawLine.length - trailing;
	const text = rawLine.slice(fromOffset, markerToOffset);
	if (utf8ByteLength(text) > TABLE_ALIGNMENT_MAX_MARKER_BYTES) {
		return { code: "table-alignment-annotation-marker-too-large" };
	}
	if (
		text.length <
			TABLE_ALIGNMENT_MARKER_PREFIX.length +
				TABLE_ALIGNMENT_MARKER_SUFFIX.length ||
		!text.startsWith(TABLE_ALIGNMENT_MARKER_PREFIX) ||
		!text.endsWith(TABLE_ALIGNMENT_MARKER_SUFFIX)
	) {
		return { code: "table-alignment-annotation-marker-invalid" };
	}
	const payload = text.slice(
		TABLE_ALIGNMENT_MARKER_PREFIX.length,
		text.length - TABLE_ALIGNMENT_MARKER_SUFFIX.length,
	);
	let decoded: unknown;
	try {
		decoded = JSON.parse(payload) as unknown;
	} catch {
		return { code: "table-alignment-annotation-marker-invalid" };
	}
	if (!Array.isArray(decoded) || decoded.length > TABLE_ALIGNMENT_MAX_ENTRIES) {
		return { code: "table-alignment-annotation-entry-invalid" };
	}
	return {
		fromOffset,
		markerToOffset,
		rawEntries: decoded,
		text,
	};
}

function parseEntryTuple(candidate: unknown): TableAlignmentMarkerEntry | null {
	if (
		!Array.isArray(candidate) ||
		(2 !== candidate.length && 3 !== candidate.length)
	) {
		return null;
	}
	const row = candidate[0];
	const column = 3 === candidate.length ? candidate[1] : null;
	const alignment = candidate[candidate.length - 1];
	if (
		!isTableAlignmentSafeIndex(row) ||
		(null !== column && !isTableAlignmentSafeIndex(column)) ||
		!isTableAlignmentMarkerValue(alignment)
	) {
		return null;
	}
	return 2 === candidate.length
		? ([row, alignment] as const)
		: ([row, column as number, alignment] as const);
}

/**
 * Validates tuple shapes and safe non-negative integer coordinates without
 * checking table dimensions or redundancy.
 */
export function parseTableAlignmentEntryList(
	raw: ReadonlyArray<unknown>,
): TableAlignmentMarkerEntry[] | null {
	if (raw.length > TABLE_ALIGNMENT_MAX_ENTRIES) {
		return null;
	}
	const entries: TableAlignmentMarkerEntry[] = [];
	for (const candidate of raw) {
		const entry = parseEntryTuple(candidate);
		if (null === entry) {
			return null;
		}
		entries.push(entry);
	}
	return entries;
}

/**
 * Validates decoded alignment entries against table bounds and PHP semantic
 * invariants: safe non-negative integer coordinates, strict ordering, an
 * explicit row override for every cell override, and no redundant row/cell
 * overrides.
 */
export function validateTableAlignmentEntries(
	raw: unknown,
	bounds: TableAlignmentValidationBounds,
): ValidatedTableAlignmentEntries {
	if (!Array.isArray(raw) || raw.length > TABLE_ALIGNMENT_MAX_ENTRIES) {
		return { code: "table-alignment-annotation-entry-invalid" };
	}
	const entries: TableAlignmentMarkerEntry[] = [];
	const rowOverrides = new Map<number, TableAlignmentMarkerValue>();
	const rowsWithCellExceptions = new Set<number>();
	let previous: TableAlignmentMarkerEntry | null = null;

	for (const candidate of raw) {
		const entry = parseEntryTuple(candidate);
		if (
			null === entry ||
			entry[0] >= bounds.rowCount ||
			(3 === entry.length && entry[1] >= bounds.columnCount)
		) {
			return { code: "table-alignment-annotation-entry-invalid" };
		}
		if (null !== previous && compareTableAlignmentEntries(previous, entry) >= 0) {
			return { code: "table-alignment-annotation-entry-order-invalid" };
		}
		previous = entry;
		entries.push(entry);
		if (2 === entry.length) {
			rowOverrides.set(entry[0], entry[1]);
		} else {
			rowsWithCellExceptions.add(entry[0]);
		}
	}

	for (const entry of entries) {
		if (2 === entry.length) {
			const hasDifferentBase = bounds.baseAlignments.some(
				(base) => base !== entry[1],
			);
			const hasCellException = rowsWithCellExceptions.has(entry[0]);
			if (!hasDifferentBase && !hasCellException) {
				return { code: "table-alignment-annotation-entry-redundant" };
			}
			continue;
		}
		const rowOverride = rowOverrides.get(entry[0]);
		if (undefined === rowOverride || rowOverride === entry[2]) {
			return { code: "table-alignment-annotation-entry-redundant" };
		}
	}

	return { entries };
}

/**
 * Serializes non-empty entries into the canonical v1 comment marker, returning
 * `null` when empty, over the entry cap, or exceeding 4096 UTF-8 bytes.
 */
export function serializeTableAlignmentMarker(
	entries: ReadonlyArray<TableAlignmentMarkerEntry>,
): string | null {
	if (0 === entries.length || entries.length > TABLE_ALIGNMENT_MAX_ENTRIES) {
		return null;
	}
	const marker = `${TABLE_ALIGNMENT_MARKER_PREFIX}${JSON.stringify(entries)}${TABLE_ALIGNMENT_MARKER_SUFFIX}`;
	return utf8ByteLength(marker) > TABLE_ALIGNMENT_MAX_MARKER_BYTES
		? null
		: marker;
}
