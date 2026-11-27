import { describe, expect, it } from 'vitest';

import fixtureText from '../../../../tests/fixtures/table-alignment-annotation.json?raw';

import {
  applyTableAlignmentAnnotationAction,
  parseTableAlignmentAnnotation,
  type TableAlignmentAnnotationContext,
  type TableAlignmentAnnotationEntry
} from './table-alignment-annotation';

const table = '| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |';
const fixture = JSON.parse(fixtureText) as Readonly<{
  cases: ReadonlyArray<Readonly<{
    baseAlignments: ReadonlyArray<'center' | 'left' | 'right' | null>;
    columnCount: number;
    entries: ReadonlyArray<TableAlignmentAnnotationEntry>;
    newline: string;
    rowCount: number;
    source: string;
  }>>;
  invalidPayloads: ReadonlyArray<Readonly<{
    baseAlignments?: ReadonlyArray<'center' | 'left' | 'right' | null>;
    entries?: ReadonlyArray<TableAlignmentAnnotationEntry>;
    expectedStatus?: 'absent' | 'invalid';
    expectedCode?: string;
    id: string;
    marker?: string;
    ownedPrefix?: boolean;
  }>>;
  sequenceAlignments: ReadonlyArray<'center' | 'left' | 'right'>;
}>;

function context(
  source: string,
  overrides: Partial<TableAlignmentAnnotationContext> = {}
): TableAlignmentAnnotationContext {
  return {
    baseAlignments: ['left', 'right'],
    columnCount: 2,
    rowCount: 3,
    source,
    tableEnd: source.length,
    tableStart: source.indexOf('| A |'),
    ...overrides
  };
}

function marker(entries: ReadonlyArray<TableAlignmentAnnotationEntry>): string {
  return `<!-- easymde-table-align:v1 ${JSON.stringify(entries)} -->`;
}

describe('table alignment annotation', () => {
  it('uses the shared fixture for valid newline variants and invalid payloads', () => {
    for (const fixtureCase of fixture.cases) {
      const result = parseTableAlignmentAnnotation({
        baseAlignments: fixtureCase.baseAlignments,
        columnCount: fixtureCase.columnCount,
        rowCount: fixtureCase.rowCount,
        source: fixtureCase.source,
        tableEnd: fixtureCase.source.length,
        tableStart: fixtureCase.source.indexOf('| A |')
      });
      expect(result).toMatchObject({
        annotation: { entries: fixtureCase.entries },
        status: 'valid'
      });
    }

    for (const invalid of fixture.invalidPayloads) {
      const invalidMarker = invalid.marker ?? marker(invalid.entries ?? []);
      const source = 'orphan-marker' === invalid.id
        ? `${invalidMarker}\n\n${table}`
        : `${invalidMarker}\n${table}`;
      const result = parseTableAlignmentAnnotation(context(source, {
        ...(invalid.baseAlignments ? { baseAlignments: invalid.baseAlignments } : {}),
        ...(invalid.ownedPrefix
          ? { ownedPrefixRange: { from: 0, to: invalidMarker.length } }
          : {})
      }));
      expect(result.status, invalid.id).toBe(invalid.expectedStatus ?? 'invalid');
      if (invalid.expectedCode) {
        expect(result).toMatchObject({ code: invalid.expectedCode });
      }
    }
  });

  it('keeps row-column-row last-action semantics for every 3x3x3 alignment sequence', () => {
    for (const firstRow of fixture.sequenceAlignments) {
      for (const column of fixture.sequenceAlignments) {
        for (const lastRow of fixture.sequenceAlignments) {
          const first = applyTableAlignmentAnnotationAction({
            ...context(table),
            action: { alignment: firstRow, row: 1, type: 'set-row' }
          });
          if (!('baseAlignments' in first)) throw new Error('annotation-sequence-first-invalid');
          const second = applyTableAlignmentAnnotationAction({
            ...context(first.value, { baseAlignments: first.baseAlignments }),
            action: { alignment: column, column: 0, type: 'set-column' }
          });
          if (!('baseAlignments' in second)) throw new Error('annotation-sequence-second-invalid');
          const final = applyTableAlignmentAnnotationAction({
            ...context(second.value, { baseAlignments: second.baseAlignments }),
            action: { alignment: lastRow, row: 1, type: 'set-row' }
          });
          const finalBase = [column, 'right'] as const;
          const expectedEntries = finalBase.some((alignment) => alignment !== lastRow)
            ? [[1, lastRow] as const]
            : [];
          expect(final).toMatchObject({
            baseAlignments: finalBase,
            entries: expectedEntries,
            status: expect.stringMatching(/^(?:changed|unchanged)$/u)
          });
        }
      }
    }
  });

  it('reads an adjacent marker and inserts one with the source newline', () => {
    expect(parseTableAlignmentAnnotation(context(table))).toEqual({
      annotation: null,
      status: 'absent'
    });

    const result = applyTableAlignmentAnnotationAction({
      ...context(table),
      action: { alignment: 'center', row: 1, type: 'set-row' }
    });
    const expectedMarker = marker([[1, 'center']]);
    expect(result).toMatchObject({
      baseAlignments: ['left', 'right'],
      entries: [[1, 'center']],
      status: 'changed',
      value: `${expectedMarker}\n${table}`
    });
    expect(parseTableAlignmentAnnotation(context(result.value))).toMatchObject({
      annotation: { entries: [[1, 'center']] },
      status: 'valid'
    });
  });

  it('distinguishes implicit bare GFM alignment from explicit left alignment', () => {
    const bare = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const source = `${marker([[0, 'left']])}\n${bare}`;
    const parsed = parseTableAlignmentAnnotation(context(source, {
      baseAlignments: [null, null]
    }));
    expect(parsed).toMatchObject({
      annotation: { entries: [[0, 'left']] },
      status: 'valid'
    });
    const second = applyTableAlignmentAnnotationAction({
      ...context(source, { baseAlignments: [null, null] }),
      action: { alignment: 'left', row: 0, type: 'set-row' }
    });
    expect(second).toMatchObject({
      changes: null,
      status: 'unchanged',
      value: source
    });
  });

  it('rejects malformed, unsorted, out-of-bounds, and redundant entries', () => {
    const invalidMarkers = [
      '<!-- easymde-table-align:v1 nope -->',
      `${marker([[1, 0, 'center'], [1, 'center']])}`,
      `${marker([[1, 'center'], [1, 'right']])}`,
      `${marker([[4, 'center']])}`,
      `${marker([[1, 2, 'center']])}`,
      `${marker([[1, 0, 'center']])}`
    ];
    for (const invalid of invalidMarkers) {
      const source = `${invalid}\n${table}`;
      expect(parseTableAlignmentAnnotation(context(source)).status, invalid).toBe('invalid');
    }
  });

  it('makes row, column, and whole-table actions last-wins', () => {
    const source = `${marker([[1, 'center'], [2, 'center'], [2, 0, 'right']])}\n${table}`;
    const row = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { alignment: 'right', row: 1, type: 'set-row' }
    });
    expect(row).toMatchObject({ entries: [[1, 'right'], [2, 'center'], [2, 0, 'right']] });

    const rowClearsExceptions = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { alignment: 'center', row: 2, type: 'set-row' }
    });
    expect(rowClearsExceptions).toMatchObject({ entries: [[1, 'center'], [2, 'center']] });

    const column = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { alignment: 'right', column: 0, type: 'set-column' }
    });
    expect(column).toMatchObject({
      baseAlignments: ['right', 'right'],
      entries: [[1, 'center'], [1, 0, 'right'], [2, 'center'], [2, 0, 'right']]
    });

    const redundantSource = `${marker([[1, 'left']])}\n${table}`;
    const redundantRow = applyTableAlignmentAnnotationAction({
      ...context(redundantSource),
      action: { alignment: 'left', column: 1, type: 'set-column' }
    });
    expect(redundantRow).toMatchObject({
      baseAlignments: ['left', 'left'],
      entries: []
    });

    const preservedExceptionSource = `${marker([[1, 'left'], [1, 0, 'center']])}\n${table}`;
    const preservedException = applyTableAlignmentAnnotationAction({
      ...context(preservedExceptionSource),
      action: { alignment: 'left', column: 1, type: 'set-column' }
    });
    expect(preservedException).toMatchObject({
      baseAlignments: ['left', 'left'],
      entries: [[1, 'left'], [1, 0, 'center']]
    });

    const whole = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { alignment: 'center', type: 'set-whole' }
    });
    expect(whole).toMatchObject({
      baseAlignments: ['center', 'center'],
      entries: [],
      status: 'changed',
      value: table
    });
  });

  it('shifts row and column identities without rewriting the table', () => {
    const source = `${marker([[1, 'center'], [2, 'center'], [2, 0, 'right']])}\r\n${table.replaceAll('\n', '\r\n')}`;
    const insertedRow = applyTableAlignmentAnnotationAction({
      ...context(source, {
        rowCount: 3,
        tableEnd: source.length,
        tableStart: source.indexOf('| A |')
      }),
      action: { row: 1, type: 'insert-row' }
    });
    expect(insertedRow).toMatchObject({ entries: [[2, 'center'], [3, 'center'], [3, 0, 'right']] });

    const insertedColumn = applyTableAlignmentAnnotationAction({
      ...context(source, {
        baseAlignments: [null, 'right'],
        tableStart: source.indexOf('| A |'),
        tableEnd: source.length
      }),
      action: { alignment: null, column: 0, type: 'insert-column' }
    });
    expect(insertedColumn).toMatchObject({
      baseAlignments: [null, null, 'right'],
      columnCount: 3,
      entries: [[1, 'center'], [2, 'center'], [2, 1, 'right']]
    });
    expect(insertedColumn.value.endsWith(table.replaceAll('\n', '\r\n'))).toBe(true);

    const deletedRow = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { row: 1, type: 'delete-row' }
    });
    expect(deletedRow).toMatchObject({
      entries: [[1, 'center'], [1, 0, 'right']],
      rowCount: 2
    });

    const deletedColumn = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { column: 0, type: 'delete-column' }
    });
    expect(deletedColumn).toMatchObject({
      baseAlignments: ['right'],
      columnCount: 1,
      entries: [[1, 'center'], [2, 'center']]
    });

    const nullBaseDelete = applyTableAlignmentAnnotationAction({
      ...context(`${marker([[0, 'left'], [1, 'center'], [1, 0, 'right']])}\n${table}`, {
        baseAlignments: [null, null]
      }),
      action: { column: 1, type: 'delete-column' }
    });
    expect(nullBaseDelete).toMatchObject({
      baseAlignments: [null],
      columnCount: 1,
      entries: [[0, 'left'], [1, 'center'], [1, 0, 'right']]
    });

    const preservedOnColumnDelete = applyTableAlignmentAnnotationAction({
      ...context(`${marker([[1, 'left'], [1, 0, 'center']])}\n${table}`, {
        baseAlignments: ['left', 'right', 'left'],
        columnCount: 3
      }),
      action: { column: 1, type: 'delete-column' }
    });
    expect(preservedOnColumnDelete).toMatchObject({
      baseAlignments: ['left', 'left'],
      columnCount: 2,
      entries: [[1, 'left'], [1, 0, 'center']]
    });
  });

  it('preserves exact source bytes for no-op actions and all newline styles', () => {
    for (const newline of ['\n', '\r\n', '\r']) {
      const sourceTable = table.replaceAll('\n', newline);
      const inserted = applyTableAlignmentAnnotationAction({
        ...context(sourceTable, {
          tableStart: sourceTable.indexOf('| A |'),
          tableEnd: sourceTable.length
        }),
        action: { alignment: 'center', row: 1, type: 'set-row' }
      });
      expect(inserted.value.startsWith(`${marker([[1, 'center']])}${newline}`)).toBe(true);
      expect(inserted.value.endsWith(sourceTable)).toBe(true);

      const source = `${marker([[1, 'center']])}${newline}${sourceTable}`;
      const result = applyTableAlignmentAnnotationAction({
        ...context(source, {
          tableStart: source.indexOf('| A |'),
          tableEnd: source.length
        }),
        action: { alignment: 'center', row: 1, type: 'set-row' }
      });
      expect(result.status).toBe('unchanged');
      expect(result.value).toBe(source);
      expect(result.changes).toBeNull();

      const changed = applyTableAlignmentAnnotationAction({
        ...context(source, {
          tableStart: source.indexOf('| A |'),
          tableEnd: source.length
        }),
        action: { alignment: 'right', row: 1, type: 'set-row' }
      });
      expect(changed.value.slice(0, changed.changes?.from ?? 0)).toBe(
        source.slice(0, changed.changes?.from ?? 0)
      );
      expect(changed.value.slice((changed.changes?.from ?? 0) + (changed.changes?.insert.length ?? 0))).toBe(
        source.slice(changed.changes?.to ?? 0)
      );
    }
  });

  it('rejects an invalid action without changing the source', () => {
    const source = `${marker([[1, 'center']])}\n${table}`;
    const result = applyTableAlignmentAnnotationAction({
      ...context(source),
      action: { alignment: 'left', column: 9, type: 'set-column' }
    });
    expect(result).toMatchObject({
      changes: null,
      status: 'invalid',
      value: source
    });
  });
});
