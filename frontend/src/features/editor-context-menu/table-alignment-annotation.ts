export type TableAlignmentAnnotationValue = 'center' | 'left' | 'right';
export type TableAlignmentAnnotationBaseValue = TableAlignmentAnnotationValue | null;

export type TableAlignmentAnnotationEntry =
  | readonly [row: number, alignment: TableAlignmentAnnotationValue]
  | readonly [row: number, column: number, alignment: TableAlignmentAnnotationValue];

export type TableAlignmentAnnotationAction =
  | Readonly<{ alignment: TableAlignmentAnnotationValue; type: 'set-whole' }>
  | Readonly<{ alignment: TableAlignmentAnnotationValue; row: number; type: 'set-row' }>
  | Readonly<{ alignment: TableAlignmentAnnotationValue; column: number; type: 'set-column' }>
  | Readonly<{ alignment: TableAlignmentAnnotationBaseValue; column: number; type: 'insert-column' }>
  | Readonly<{ column: number; type: 'delete-column' }>
  | Readonly<{ row: number; type: 'insert-row' }>
  | Readonly<{ row: number; type: 'delete-row' }>;

export type TableAlignmentAnnotationContext = Readonly<{
  baseAlignments: ReadonlyArray<TableAlignmentAnnotationBaseValue>;
  columnCount: number;
  /** Trusted parser-owned comment range immediately before the table, when available. */
  ownedPrefixRange?: Readonly<{ from: number; to: number }>;
  /** Logical rows: 0 is the header and 1 is the first body row. */
  rowCount: number;
  source: string;
  tableEnd: number;
  tableStart: number;
}>;

export type TableAlignmentAnnotationErrorCode =
  | 'table-alignment-annotation-action-invalid'
  | 'table-alignment-annotation-context-invalid'
  | 'table-alignment-annotation-entry-invalid'
  | 'table-alignment-annotation-entry-order-invalid'
  | 'table-alignment-annotation-entry-redundant'
  | 'table-alignment-annotation-marker-invalid'
  | 'table-alignment-annotation-marker-orphan'
  | 'table-alignment-annotation-marker-too-large';

export type TableAlignmentAnnotation = Readonly<{
  entries: ReadonlyArray<TableAlignmentAnnotationEntry>;
  from: number;
  to: number;
}>;

export type TableAlignmentAnnotationReadResult =
  | Readonly<{ annotation: null; status: 'absent' }>
  | Readonly<{ code: TableAlignmentAnnotationErrorCode; status: 'invalid' }>
  | Readonly<{ annotation: TableAlignmentAnnotation; status: 'valid' }>;

export type TableAlignmentAnnotationMutationResult =
  | Readonly<{
      baseAlignments: ReadonlyArray<TableAlignmentAnnotationBaseValue>;
      changes: Readonly<{ from: number; insert: string; to: number }> | null;
      columnCount: number;
      entries: ReadonlyArray<TableAlignmentAnnotationEntry>;
      rowCount: number;
      status: 'changed' | 'unchanged';
      value: string;
    }>
  | Readonly<{
      changes: null;
      code: TableAlignmentAnnotationErrorCode;
      status: 'invalid';
      value: string;
    }>;

const MARKER_PREFIX = '<!-- easymde-table-align:v1 ';
const MARKER_SUFFIX = ' -->';
const MAX_MARKER_LENGTH = 4096;
const MAX_ENTRIES = 1000;

function validAlignment(value: unknown): value is TableAlignmentAnnotationValue {
  return 'left' === value || 'center' === value || 'right' === value;
}

function validBaseAlignment(value: unknown): value is TableAlignmentAnnotationBaseValue {
  return null === value || validAlignment(value);
}

function validNonNegativeInteger(value: unknown): value is number {
  return 'number' === typeof value && Number.isSafeInteger(value) && value >= 0;
}

function compareEntries(
  left: TableAlignmentAnnotationEntry,
  right: TableAlignmentAnnotationEntry
): number {
  const rowDelta = left[0] - right[0];
  if (rowDelta !== 0) return rowDelta;
  const leftColumn = 3 === left.length ? left[1] : -1;
  const rightColumn = 3 === right.length ? right[1] : -1;
  return leftColumn - rightColumn;
}

function sameEntry(
  left: TableAlignmentAnnotationEntry,
  right: TableAlignmentAnnotationEntry
): boolean {
  return left.length === right.length
    && left[0] === right[0]
    && (2 === left.length || left[1] === right[1])
    && left[left.length - 1] === right[right.length - 1];
}

function validateContext(
  input: TableAlignmentAnnotationContext
): TableAlignmentAnnotationErrorCode | null {
  if (
    !Number.isSafeInteger(input.tableStart)
    || !Number.isSafeInteger(input.tableEnd)
    || input.tableStart < 0
    || input.tableEnd < input.tableStart
    || input.tableEnd > input.source.length
    || (input.tableStart > 0
      && '\n' !== input.source[input.tableStart - 1]
      && '\r' !== input.source[input.tableStart - 1])
    || !Number.isSafeInteger(input.rowCount)
    || input.rowCount < 1
    || !Number.isSafeInteger(input.columnCount)
    || input.columnCount < 1
    || input.baseAlignments.length !== input.columnCount
    || input.baseAlignments.some((alignment) => !validBaseAlignment(alignment))
    || (input.ownedPrefixRange !== undefined
      && (!Number.isSafeInteger(input.ownedPrefixRange.from)
        || !Number.isSafeInteger(input.ownedPrefixRange.to)
        || input.ownedPrefixRange.from < 0
        || input.ownedPrefixRange.from >= input.ownedPrefixRange.to
        || input.ownedPrefixRange.to > input.source.length
        || input.ownedPrefixRange.to > input.tableStart))
  ) return 'table-alignment-annotation-context-invalid';
  return null;
}

function lineSeparatorBefore(source: string, position: number): Readonly<{
  from: number;
  text: string;
}> | null {
  if (position >= 2 && '\r\n' === source.slice(position - 2, position)) {
    return { from: position - 2, text: '\r\n' };
  }
  if (position >= 1 && ('\n' === source[position - 1] || '\r' === source[position - 1])) {
    return { from: position - 1, text: source[position - 1] ?? '' };
  }
  return null;
}

function markerCandidate(
  source: string,
  tableStart: number
): Readonly<{ from: number; markerTo: number; text: string }> | null {
  const separator = lineSeparatorBefore(source, tableStart);
  if (!separator) return null;
  let lineStart = separator.from;
  while (lineStart > 0 && '\n' !== source[lineStart - 1] && '\r' !== source[lineStart - 1]) {
    lineStart -= 1;
  }
  const line = source.slice(lineStart, separator.from);
  const indentation = line.match(/^[ \t]*/u)?.[0] ?? '';
  if (indentation.includes('\t') || indentation.length > 3) return null;
  const leading = indentation.length;
  const trailing = line.match(/[ \t]*$/u)?.[0].length ?? 0;
  const from = lineStart + leading;
  const markerTo = separator.from - trailing;
  const text = source.slice(from, markerTo);
  if (!text.startsWith('<!-- easymde-table-align:')) return null;
  if (text.length > MAX_MARKER_LENGTH) {
    throw new Error('table-alignment-annotation-marker-too-large');
  }
  return { from, markerTo, text };
}

function orphanMarkerBefore(source: string, tableStart: number): boolean {
  let separator = lineSeparatorBefore(source, tableStart);
  if (!separator) return false;
  for (let depth = 0; depth < 32 && separator; depth += 1) {
    let lineStart = separator.from;
    while (lineStart > 0 && '\n' !== source[lineStart - 1] && '\r' !== source[lineStart - 1]) {
      lineStart -= 1;
    }
    const rawLine = source.slice(lineStart, separator.from);
    const indentation = rawLine.match(/^[ \t]*/u)?.[0] ?? '';
    if (indentation.includes('\t') || indentation.length > 3) return false;
    const line = rawLine.trim();
    if ('' !== line) return line.startsWith('<!-- easymde-table-align:');
    separator = lineSeparatorBefore(source, lineStart);
  }
  return false;
}

function ownedMarkerCandidate(
  input: TableAlignmentAnnotationContext
): Readonly<{ from: number; markerTo: number; text: string }> | null {
  const range = input.ownedPrefixRange;
  if (!range) return null;
  const text = input.source.slice(range.from, range.to);
  if (!text.trimStart().startsWith('<!-- easymde-table-align:')) return null;
  const separator = lineSeparatorBefore(input.source, input.tableStart);
  if (!separator || separator.from !== range.to) {
    throw new Error('table-alignment-annotation-marker-orphan');
  }
  const leading = text.match(/^[ \t]*/u)?.[0].length ?? 0;
  const trailing = text.match(/[ \t]*$/u)?.[0].length ?? 0;
  return {
    from: range.from + leading,
    markerTo: range.to - trailing,
    text: text.slice(leading, text.length - trailing)
  };
}

function parseEntries(
  raw: unknown,
  context: TableAlignmentAnnotationContext
): Readonly<{ code: TableAlignmentAnnotationErrorCode } | { entries: TableAlignmentAnnotationEntry[] }> {
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES) {
    return { code: 'table-alignment-annotation-entry-invalid' };
  }
  const entries: TableAlignmentAnnotationEntry[] = [];
  let previous: TableAlignmentAnnotationEntry | null = null;
  for (const candidate of raw) {
    if (!Array.isArray(candidate) || (2 !== candidate.length && 3 !== candidate.length)) {
      return { code: 'table-alignment-annotation-entry-invalid' };
    }
    const row = candidate[0];
    const column = 3 === candidate.length ? candidate[1] : null;
    const alignment = candidate[candidate.length - 1];
    if (
      !validNonNegativeInteger(row)
      || (null !== column && !validNonNegativeInteger(column))
      || !validAlignment(alignment)
      || row >= context.rowCount
      || (null !== column && column >= context.columnCount)
    ) return { code: 'table-alignment-annotation-entry-invalid' };
    const entry = 2 === candidate.length
      ? [row, alignment] as const
      : [row, column as number, alignment] as const;
    if (previous && compareEntries(previous, entry) >= 0) {
      return { code: 'table-alignment-annotation-entry-order-invalid' };
    }
    previous = entry;
    entries.push(entry);
  }

  for (const entry of entries) {
    const rowOverride = 2 === entry.length
      ? entry
      : entries.find((candidate) => 2 === candidate.length && candidate[0] === entry[0]);
    if (2 === entry.length) {
      const hasExceptions = entries.some(
        (candidate) => 3 === candidate.length && candidate[0] === entry[0]
      );
      if (!context.baseAlignments.some((base) => base !== entry[1]) && !hasExceptions) {
        return { code: 'table-alignment-annotation-entry-redundant' };
      }
    } else if (
      !rowOverride
      || rowOverride[1] === entry[2]
    ) return { code: 'table-alignment-annotation-entry-redundant' };
  }
  return { entries };
}

export function parseTableAlignmentAnnotation(
  input: TableAlignmentAnnotationContext
): TableAlignmentAnnotationReadResult {
  const contextError = validateContext(input);
  if (contextError) return { code: contextError, status: 'invalid' };
  if (input.tableStart === input.tableEnd) {
    return { code: 'table-alignment-annotation-marker-orphan', status: 'invalid' };
  }
  let candidate: Readonly<{ from: number; markerTo: number; text: string }> | null;
  try {
    candidate = input.ownedPrefixRange
      ? ownedMarkerCandidate(input)
      : markerCandidate(input.source, input.tableStart);
  } catch (error) {
    const code: TableAlignmentAnnotationErrorCode | null = error instanceof Error
      ? 'table-alignment-annotation-marker-orphan' === error.message
        ? error.message
        : 'table-alignment-annotation-marker-too-large' === error.message
          ? error.message
          : null
      : null;
    if (code) {
      return { code, status: 'invalid' };
    }
    throw error;
  }
  if (!candidate) {
    if (orphanMarkerBefore(input.source, input.tableStart)) {
      return { code: 'table-alignment-annotation-marker-orphan', status: 'invalid' };
    }
    return { annotation: null, status: 'absent' };
  }
  if (candidate.text.includes('\n') || candidate.text.includes('\r')) {
    return { code: 'table-alignment-annotation-marker-invalid', status: 'invalid' };
  }
  if (!candidate.text.startsWith(MARKER_PREFIX) || !candidate.text.endsWith(MARKER_SUFFIX)) {
    return { code: 'table-alignment-annotation-marker-invalid', status: 'invalid' };
  }
  const payload = candidate.text.slice(MARKER_PREFIX.length, -MARKER_SUFFIX.length);
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload) as unknown;
  } catch {
    return { code: 'table-alignment-annotation-marker-invalid', status: 'invalid' };
  }
  const parsed = parseEntries(decoded, input);
  if (!('entries' in parsed)) return { code: parsed.code, status: 'invalid' };
  return {
    annotation: {
      entries: parsed.entries,
      from: candidate.from,
      to: candidate.markerTo
    },
    status: 'valid'
  };
}

function serializeEntries(entries: ReadonlyArray<TableAlignmentAnnotationEntry>): string {
  return `${MARKER_PREFIX}${JSON.stringify(entries)}${MARKER_SUFFIX}`;
}

function newlineForInsertion(source: string, tableStart: number): string {
  const before = lineSeparatorBefore(source, tableStart);
  if (before) return before.text;
  const firstCrLf = source.indexOf('\r\n');
  if (firstCrLf >= 0) return '\r\n';
  const firstCr = source.indexOf('\r');
  if (firstCr >= 0) return '\r';
  return '\n';
}

function entriesForState(
  baseAlignments: ReadonlyArray<TableAlignmentAnnotationBaseValue>,
  rowCount: number,
  columnCount: number,
  entries: ReadonlyArray<TableAlignmentAnnotationEntry>
): Readonly<{ code: TableAlignmentAnnotationErrorCode } | { entries: TableAlignmentAnnotationEntry[] }> {
  return parseEntries(entries, {
    baseAlignments,
    columnCount,
    rowCount,
    source: '',
    tableEnd: 0,
    tableStart: 0
  });
}

function removeRedundantRows(
  baseAlignments: ReadonlyArray<TableAlignmentAnnotationBaseValue>,
  entries: ReadonlyArray<TableAlignmentAnnotationEntry>
): TableAlignmentAnnotationEntry[] {
  const activeRows = new Set(
    entries
      .filter((entry): entry is readonly [number, TableAlignmentAnnotationValue] => 2 === entry.length)
      .filter((entry) => baseAlignments.some((base) => base !== entry[1])
        || entries.some((candidate) => 3 === candidate.length && candidate[0] === entry[0]))
      .map((entry) => entry[0])
  );
  return entries.filter((entry) => activeRows.has(entry[0]));
}

function applyAction(
  context: TableAlignmentAnnotationContext,
  entries: ReadonlyArray<TableAlignmentAnnotationEntry>,
  action: TableAlignmentAnnotationAction
): Readonly<{
  baseAlignments: TableAlignmentAnnotationBaseValue[];
  columnCount: number;
  entries: TableAlignmentAnnotationEntry[];
  rowCount: number;
}> | Readonly<{ code: TableAlignmentAnnotationErrorCode }> {
  let baseAlignments = [...context.baseAlignments];
  let columnCount = context.columnCount;
  let rowCount = context.rowCount;
  let next = [...entries];
  if ('set-whole' === action.type) {
    baseAlignments = Array.from({ length: columnCount }, () => action.alignment);
    next = [];
  } else if ('set-row' === action.type) {
    if (!validNonNegativeInteger(action.row) || action.row >= rowCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    next = next.filter((entry) => entry[0] !== action.row);
    if (baseAlignments.some((alignment) => alignment !== action.alignment)) {
      next.push([action.row, action.alignment]);
    }
  } else if ('set-column' === action.type) {
    if (!validNonNegativeInteger(action.column) || action.column >= columnCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    baseAlignments[action.column] = action.alignment;
    next = next.filter((entry) => !(3 === entry.length && entry[1] === action.column));
    for (const entry of next) {
      if (2 === entry.length && entry[1] !== action.alignment) {
        next.push([entry[0], action.column, action.alignment]);
      }
    }
    next = removeRedundantRows(baseAlignments, next);
  } else if ('insert-column' === action.type) {
    if (!validNonNegativeInteger(action.column) || action.column > columnCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    baseAlignments.splice(action.column, 0, action.alignment);
    columnCount += 1;
    next = next.map((entry) => 3 === entry.length && entry[1] >= action.column
      ? [entry[0], entry[1] + 1, entry[2]] as const
      : entry);
  } else if ('delete-column' === action.type) {
    if (!validNonNegativeInteger(action.column) || action.column >= columnCount || columnCount <= 1) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    baseAlignments.splice(action.column, 1);
    columnCount -= 1;
    next = next
      .filter((entry) => 2 === entry.length || entry[1] !== action.column)
      .map((entry) => 3 === entry.length && entry[1] > action.column
        ? [entry[0], entry[1] - 1, entry[2]] as const
        : entry);
    next = removeRedundantRows(baseAlignments, next);
  } else if ('insert-row' === action.type) {
    if (!validNonNegativeInteger(action.row) || action.row > rowCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    rowCount += 1;
    next = next.map((entry) => entry[0] >= action.row
      ? 2 === entry.length
        ? [entry[0] + 1, entry[1]] as const
        : [entry[0] + 1, entry[1], entry[2]] as const
      : entry);
  } else if ('delete-row' === action.type) {
    if (!validNonNegativeInteger(action.row) || action.row >= rowCount || rowCount <= 1) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    rowCount -= 1;
    next = next
      .filter((entry) => entry[0] !== action.row)
      .map((entry) => entry[0] > action.row
        ? 2 === entry.length
          ? [entry[0] - 1, entry[1]] as const
          : [entry[0] - 1, entry[1], entry[2]] as const
        : entry);
  }

  next.sort(compareEntries);
  const validated = entriesForState(baseAlignments, rowCount, columnCount, next);
  if (!('entries' in validated)) return { code: validated.code };
  return { baseAlignments, columnCount, entries: validated.entries, rowCount };
}

export function applyTableAlignmentAnnotationAction(
  input: TableAlignmentAnnotationContext & Readonly<{ action: TableAlignmentAnnotationAction }>
): TableAlignmentAnnotationMutationResult {
  const contextError = validateContext(input);
  if (contextError) return { changes: null, code: contextError, status: 'invalid', value: input.source };
  const parsed = parseTableAlignmentAnnotation(input);
  if ('invalid' === parsed.status) return { changes: null, code: parsed.code, status: 'invalid', value: input.source };
  const entries = 'valid' === parsed.status ? parsed.annotation.entries : [];
  const next = applyAction(input, entries, input.action);
  if ('code' in next) return { changes: null, code: next.code, status: 'invalid', value: input.source };
  const sameBase = next.baseAlignments.every((alignment, index) => alignment === input.baseAlignments[index]);
  const sameEntries = next.entries.length === entries.length
    && next.entries.every((entry, index) => sameEntry(entry, entries[index] as TableAlignmentAnnotationEntry));
  const sameDimensions = next.rowCount === input.rowCount && next.columnCount === input.columnCount;
  if (sameBase && sameEntries && sameDimensions) {
    return {
      baseAlignments: input.baseAlignments,
      changes: null,
      columnCount: input.columnCount,
      entries,
      rowCount: input.rowCount,
      status: 'unchanged',
      value: input.source
    };
  }

  if (sameEntries && 'valid' !== parsed.status) {
    return {
      baseAlignments: next.baseAlignments,
      changes: null,
      columnCount: next.columnCount,
      entries: next.entries,
      rowCount: next.rowCount,
      status: 'changed',
      value: input.source
    };
  }
  if (sameEntries && 'valid' === parsed.status && 'set-whole' !== input.action.type) {
    return {
      baseAlignments: next.baseAlignments,
      changes: null,
      columnCount: next.columnCount,
      entries: next.entries,
      rowCount: next.rowCount,
      status: 'changed',
      value: input.source
    };
  }

  const marker = 0 === next.entries.length ? '' : serializeEntries(next.entries);
  let from: number;
  let to: number;
  let insert: string;
  if ('valid' === parsed.status) {
    from = parsed.annotation.from;
    to = parsed.annotation.to;
    if (0 === next.entries.length) {
      to = input.tableStart;
      from = parsed.annotation.from;
    }
    insert = marker;
  } else {
    from = input.tableStart;
    to = input.tableStart;
    insert = `${marker}${newlineForInsertion(input.source, input.tableStart)}`;
  }
  const value = input.source.slice(0, from) + insert + input.source.slice(to);
  return {
    baseAlignments: next.baseAlignments,
    changes: { from, insert, to },
    columnCount: next.columnCount,
    entries: next.entries,
    rowCount: next.rowCount,
    status: 'changed',
    value
  };
}
