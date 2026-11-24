import {
  compareTableAlignmentEntries,
  isReservedTableAlignmentMarkerPrefix,
  isTableAlignmentMarkerBaseValue,
  isTableAlignmentSafeIndex,
  parseReservedTableAlignmentMarkerLine,
  serializeTableAlignmentMarker,
  type TableAlignmentMarkerBaseValue,
  type TableAlignmentMarkerEntry,
  type TableAlignmentMarkerErrorCode,
  type TableAlignmentMarkerValue,
  validateTableAlignmentEntries
} from '../../shared/table-alignment-marker';

export type TableAlignmentAnnotationValue = TableAlignmentMarkerValue;
export type TableAlignmentAnnotationBaseValue = TableAlignmentMarkerBaseValue;

export type TableAlignmentAnnotationEntry = TableAlignmentMarkerEntry;

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
  | TableAlignmentMarkerErrorCode
  | 'table-alignment-annotation-action-invalid'
  | 'table-alignment-annotation-context-invalid'
  | 'table-alignment-annotation-marker-orphan';

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
    || input.baseAlignments.some((alignment) => !isTableAlignmentMarkerBaseValue(alignment))
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

type MarkerCandidateResult =
  | Readonly<{ from: number; markerTo: number; rawEntries: ReadonlyArray<unknown> }>
  | Readonly<{ code: TableAlignmentAnnotationErrorCode }>
  | null;

function markerCandidate(
  source: string,
  tableStart: number
): MarkerCandidateResult {
  const separator = lineSeparatorBefore(source, tableStart);
  if (!separator) return null;
  let lineStart = separator.from;
  while (lineStart > 0 && '\n' !== source[lineStart - 1] && '\r' !== source[lineStart - 1]) {
    lineStart -= 1;
  }
  const rawLine = source.slice(lineStart, separator.from);
  const parsed = parseReservedTableAlignmentMarkerLine(rawLine);
  if (null === parsed) return null;
  if ('code' in parsed) return { code: parsed.code };
  return {
    from: lineStart + parsed.fromOffset,
    markerTo: lineStart + parsed.markerToOffset,
    rawEntries: parsed.rawEntries
  };
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
    if (/^[ \t]*$/u.test(rawLine)) {
      separator = lineSeparatorBefore(source, lineStart);
      continue;
    }
    return null !== isReservedTableAlignmentMarkerPrefix(rawLine);
  }
  return false;
}

function ownedMarkerCandidate(
  input: TableAlignmentAnnotationContext
): MarkerCandidateResult {
  const range = input.ownedPrefixRange;
  if (!range) return null;
  const rawText = input.source.slice(range.from, range.to);
  if (null === isReservedTableAlignmentMarkerPrefix(rawText)) return null;
  const separator = lineSeparatorBefore(input.source, input.tableStart);
  if (!separator || separator.from !== range.to) {
    return { code: 'table-alignment-annotation-marker-orphan' };
  }
  const parsed = parseReservedTableAlignmentMarkerLine(rawText);
  if (null === parsed) return null;
  if ('code' in parsed) return { code: parsed.code };
  return {
    from: range.from + parsed.fromOffset,
    markerTo: range.from + parsed.markerToOffset,
    rawEntries: parsed.rawEntries
  };
}

export function parseTableAlignmentAnnotation(
  input: TableAlignmentAnnotationContext
): TableAlignmentAnnotationReadResult {
  const contextError = validateContext(input);
  if (contextError) return { code: contextError, status: 'invalid' };
  if (input.tableStart === input.tableEnd) {
    return { code: 'table-alignment-annotation-marker-orphan', status: 'invalid' };
  }
  const candidate = input.ownedPrefixRange
    ? ownedMarkerCandidate(input)
    : markerCandidate(input.source, input.tableStart);
  if (null === candidate) {
    if (orphanMarkerBefore(input.source, input.tableStart)) {
      return { code: 'table-alignment-annotation-marker-orphan', status: 'invalid' };
    }
    return { annotation: null, status: 'absent' };
  }
  if ('code' in candidate) {
    return { code: candidate.code, status: 'invalid' };
  }
  const parsed = validateTableAlignmentEntries(candidate.rawEntries, input);
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

function newlineForInsertion(source: string, tableStart: number): string {
  const before = lineSeparatorBefore(source, tableStart);
  if (before) return before.text;
  const firstCrLf = source.indexOf('\r\n');
  if (firstCrLf >= 0) return '\r\n';
  const firstCr = source.indexOf('\r');
  if (firstCr >= 0) return '\r';
  return '\n';
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
    if (!isTableAlignmentSafeIndex(action.row) || action.row >= rowCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    next = next.filter((entry) => entry[0] !== action.row);
    if (baseAlignments.some((alignment) => alignment !== action.alignment)) {
      next.push([action.row, action.alignment]);
    }
  } else if ('set-column' === action.type) {
    if (!isTableAlignmentSafeIndex(action.column) || action.column >= columnCount) {
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
    if (!isTableAlignmentSafeIndex(action.column) || action.column > columnCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    baseAlignments.splice(action.column, 0, action.alignment);
    columnCount += 1;
    next = next.map((entry) => 3 === entry.length && entry[1] >= action.column
      ? [entry[0], entry[1] + 1, entry[2]] as const
      : entry);
  } else if ('delete-column' === action.type) {
    if (!isTableAlignmentSafeIndex(action.column) || action.column >= columnCount || columnCount <= 1) {
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
    if (!isTableAlignmentSafeIndex(action.row) || action.row > rowCount) {
      return { code: 'table-alignment-annotation-action-invalid' };
    }
    rowCount += 1;
    next = next.map((entry) => entry[0] >= action.row
      ? 2 === entry.length
        ? [entry[0] + 1, entry[1]] as const
        : [entry[0] + 1, entry[1], entry[2]] as const
      : entry);
  } else if ('delete-row' === action.type) {
    if (!isTableAlignmentSafeIndex(action.row) || action.row >= rowCount || rowCount <= 1) {
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

  next.sort(compareTableAlignmentEntries);
  const validated = validateTableAlignmentEntries(next, {
    baseAlignments,
    columnCount,
    rowCount
  });
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

  let marker = '';
  if (next.entries.length > 0) {
    const serialized = serializeTableAlignmentMarker(next.entries);
    if (null === serialized) {
      return {
        changes: null,
        code: 'table-alignment-annotation-marker-too-large',
        status: 'invalid',
        value: input.source
      };
    }
    marker = serialized;
  }
  let from: number;
  let to: number;
  let insert: string;
  if ('valid' === parsed.status) {
    from = parsed.annotation.from;
    to = parsed.annotation.to;
    if (0 === next.entries.length) {
      while (from > 0 && (' ' === input.source[from - 1] || '\t' === input.source[from - 1])) {
        from -= 1;
      }
      to = input.tableStart;
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
