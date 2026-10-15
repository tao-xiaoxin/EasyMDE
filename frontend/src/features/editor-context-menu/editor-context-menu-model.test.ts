import { describe, expect, it } from 'vitest';

import {
  createEditorContextMenuModel,
  type EditorContextMenuLabels
} from './editor-context-menu-model';

const labels: EditorContextMenuLabels = {
  alignCenter: 'Align center',
  alignLeft: 'Align left',
  alignRight: 'Align right',
  alignment: 'Alignment',
  ariaLabel: 'Editor context menu',
  bold: 'Bold',
  codeBlock: 'Code block',
  copy: 'Copy',
  copyAsHtml: 'Copy as HTML code',
  copyAsMarkdown: 'Copy as Markdown',
  copyCodeContent: 'Copy Code Block Content',
  indentCodeBlock: 'Adjust Code Block Indentation',
  indentSelectedCode: 'Adjust Selected Code Indentation',
  copyDiagramSource: 'Copy code',
  copyGeneratedImage: 'Copy as image',
  copyGeneratedMathMl: 'Copy MathML',
  copyImage: 'Copy image',
  copyLinkAddress: 'Copy link address',
  copyPasteAs: 'Copy / Paste as',
  copyMathSource: 'Copy TeX',
  copySimplifiedFormatting: 'Copy with simplified formatting',
  copyTable: 'Copy table',
  formatTableSource: 'Format Table Source',
  cut: 'Cut',
  deleteCodeBlock: 'Delete code block',
  deleteColumn: 'Delete column',
  deleteGeneratedContent: 'Delete',
  deleteImage: 'Delete image',
  deleteRow: 'Delete row',
  deleteTable: 'Delete table',
  deleteThematicBreak: 'Delete horizontal rule',
  diagramBlock: 'Diagram',
  editGeneratedContent: 'Edit',
  image: 'Image',
  imageScale: 'Image scale',
  insert: 'Insert',
  insertAbove: 'Insert paragraph above',
  insertBelow: 'Insert paragraph below',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  insertParagraphAboveGenerated: 'Insert paragraph above',
  insertParagraphBelowGenerated: 'Insert paragraph below',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  mathBlock: 'Formula',
  openLink: 'Open link',
  paste: 'Paste',
  pastePlainText: 'Paste as plain text',
  saveGeneratedImage: 'Save as image',
  table: 'Table',
  unsupported: 'Unsupported for this selection.',
  uploadImage: 'Upload image',
  copyCodeBlock: 'Copy code block',
  insertCodeAbove: 'Insert paragraph above code block',
  insertCodeBelow: 'Insert paragraph below code block',
  insertParagraphAboveTable: 'Insert paragraph above table',
  insertParagraphBelowTable: 'Insert paragraph below table'
};

function context(overrides: Partial<Parameters<typeof createEditorContextMenuModel>[0]> = {}) {
  return {
    block: 'paragraph' as const,
    clipboard: { status: 'unknown' as const },
    hasSelection: false,
    labels,
    readOnly: false,
    ...overrides
  };
}

describe('createEditorContextMenuModel', () => {
  it('keeps Cut and Copy disabled for a collapsed selection', () => {
    const model = createEditorContextMenuModel(context());
    expect(model.items.find((item) => item.id === 'bold')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'copy')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'cut')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'paste')?.disabled).toBe(true);
  });

  it('enables selected text and readable Clipboard actions', () => {
    const model = createEditorContextMenuModel(context({
      clipboard: { status: 'available' },
      hasSelection: true
    }));
    const copyPaste = model.items.find((item) => item.id === 'copy-paste-as');
    if (copyPaste?.kind !== 'submenu') throw new Error('copy-paste-submenu-missing');

    expect(model.items.find((item) => item.id === 'copy')?.disabled).toBe(false);
    expect(model.items.find((item) => item.id === 'cut')?.disabled).toBe(false);
    expect(model.items.find((item) => item.id === 'paste')?.disabled).toBe(false);
    expect(copyPaste.children.find((item) => item.id === 'paste-plain-text')?.disabled).toBe(false);
    expect(copyPaste.children.map((item) => item.id)).toEqual([
      'copy-as-markdown',
      'copy-as-html',
      'copy-simplified-formatting',
      'paste-plain-text'
    ]);
  });

  it('gates simplified formatting copy on a validated semantic selection', () => {
    const unavailable = createEditorContextMenuModel(context({
      canCopySimplified: false,
      hasSelection: true
    }));
    const unavailableCopyPaste = unavailable.items.find((item) => item.id === 'copy-paste-as');
    if (unavailableCopyPaste?.kind !== 'submenu') throw new Error('copy-paste-submenu-missing');
    expect(unavailableCopyPaste.children.find((item) => item.id === 'copy-simplified-formatting')?.disabled).toBe(true);

    const available = createEditorContextMenuModel(context({
      canCopySimplified: true,
      hasSelection: true,
      readOnly: true
    }));
    const availableCopyPaste = available.items.find((item) => item.id === 'copy-paste-as');
    if (availableCopyPaste?.kind !== 'submenu') throw new Error('copy-paste-submenu-missing');
    expect(availableCopyPaste.children.find((item) => item.id === 'copy-simplified-formatting')?.disabled).toBe(false);
  });

  it('keeps non-mutating copy actions enabled on a read-only selected surface', () => {
    const model = createEditorContextMenuModel(context({
      hasSelection: true,
      readOnly: true
    }));
    expect(model.items.find((item) => item.id === 'copy')?.disabled).toBe(false);
    const copyPaste = model.items.find((item) => item.id === 'copy-paste-as');
    if (copyPaste?.kind !== 'submenu') throw new Error('copy-paste-submenu-missing');
    expect(copyPaste.children.find((item) => item.id === 'copy-as-markdown')?.disabled).toBe(false);
    expect(model.items.find((item) => item.id === 'cut')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'bold')?.disabled).toBe(true);
  });

  it('gates relative paragraph insertion on an available structural block', () => {
    const unavailable = createEditorContextMenuModel(context({
      block: 'unavailable',
      image: { scale: null, uploadDisabled: false }
    }));
    const unavailableInsert = unavailable.items.find((item) => item.id === 'insert');
    if (unavailableInsert?.kind !== 'submenu') throw new Error('insert-submenu-missing');
    expect(unavailableInsert.children.find((item) => item.id === 'insert-paragraph-above')?.disabled).toBe(true);
    expect(unavailableInsert.children.find((item) => item.id === 'insert-paragraph-below')?.disabled).toBe(true);
    expect(unavailableInsert.children.find((item) => item.id === 'insert-table')?.disabled).toBe(false);
    expect(unavailableInsert.children.find((item) => item.id === 'insert-image')?.disabled).toBe(false);

    const math = createEditorContextMenuModel(context({ block: 'math' }));
    const mathInsert = math.items.find((item) => item.id === 'insert');
    if (mathInsert?.kind !== 'submenu') throw new Error('insert-submenu-missing');
    expect(mathInsert.children.find((item) => item.id === 'insert-paragraph-above')?.disabled).toBe(false);
    expect(mathInsert.children.find((item) => item.id === 'insert-paragraph-below')?.disabled).toBe(false);

    const explicitlyUnavailable = createEditorContextMenuModel(context({
      canInsertRelative: false
    }));
    const explicitInsert = explicitlyUnavailable.items.find((item) => item.id === 'insert');
    if (explicitInsert?.kind !== 'submenu') throw new Error('insert-submenu-missing');
    expect(explicitInsert.children.find((item) => item.id === 'insert-paragraph-above')?.disabled).toBe(true);
    expect(explicitInsert.children.find((item) => item.id === 'insert-paragraph-below')?.disabled).toBe(true);
  });

  it('includes the requested Table submenu and table-adjacent paragraph actions', () => {
    const model = createEditorContextMenuModel(context({ block: 'table' }));
    const table = model.items.find((item) => item.id === 'table');
    expect(table?.kind).toBe('submenu');
    if (table?.kind !== 'submenu') throw new Error('table-submenu-missing');

    expect(table.children.map((item) => item.id)).toEqual([
      'insert-row-above',
      'insert-row-below',
      'insert-column-left',
      'insert-column-right',
      'delete-row',
      'delete-column',
      'copy-table',
      'format-table-source',
      'delete-table',
      'insert-paragraph-above-table',
      'insert-paragraph-below-table',
      'table-alignment'
    ]);
  });

  it('disables deletion when the captured table selection cannot execute that mutation', () => {
    const headerCell = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: {
        canDeleteColumn: true,
        canDeleteRow: false,
        column: 0,
        columnCount: 2,
        kind: 'column',
        rowIndex: 0
      }
    }));
    const headerTable = headerCell.items.find((item) => item.id === 'table');
    if (headerTable?.kind !== 'submenu') throw new Error('table-submenu-missing');
    expect(headerTable.children.find((item) => item.id === 'delete-row')?.disabled).toBe(true);
    expect(headerTable.children.find((item) => item.id === 'delete-column')?.disabled).toBe(false);

    const uniqueColumn = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: {
        canDeleteColumn: false,
        canDeleteRow: true,
        column: 0,
        columnCount: 1,
        kind: 'column',
        rowIndex: 2
      }
    }));
    const uniqueColumnTable = uniqueColumn.items.find((item) => item.id === 'table');
    if (uniqueColumnTable?.kind !== 'submenu') throw new Error('table-submenu-missing');
    expect(uniqueColumnTable.children.find((item) => item.id === 'delete-row')?.disabled).toBe(false);
    expect(uniqueColumnTable.children.find((item) => item.id === 'delete-column')?.disabled).toBe(true);

    const dataRow = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: {
        canDeleteColumn: false,
        canDeleteRow: true,
        columnCount: 2,
        kind: 'row',
        row: 2,
        rowIndex: 2
      }
    }));
    const dataRowTable = dataRow.items.find((item) => item.id === 'table');
    if (dataRowTable?.kind !== 'submenu') throw new Error('table-submenu-missing');
    expect(dataRowTable.children.find((item) => item.id === 'delete-row')?.disabled).toBe(false);
    expect(dataRowTable.children.find((item) => item.id === 'delete-column')?.disabled).toBe(true);

    const wholeTable = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: {
        canDeleteColumn: false,
        canDeleteRow: false,
        columnCount: 2,
        kind: 'whole-table'
      }
    }));
    const wholeTableItems = wholeTable.items.find((item) => item.id === 'table');
    if (wholeTableItems?.kind !== 'submenu') throw new Error('table-submenu-missing');
    expect(wholeTableItems.children.find((item) => item.id === 'delete-row')?.disabled).toBe(true);
    expect(wholeTableItems.children.find((item) => item.id === 'delete-column')?.disabled).toBe(true);

    const ambiguous = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: { canDeleteColumn: false, canDeleteRow: false, kind: 'ambiguous' }
    }));
    const ambiguousItems = ambiguous.items.find((item) => item.id === 'table');
    if (ambiguousItems?.kind !== 'submenu') throw new Error('table-submenu-missing');
    expect(ambiguousItems.children.find((item) => item.id === 'delete-row')?.disabled).toBe(true);
    expect(ambiguousItems.children.find((item) => item.id === 'delete-column')?.disabled).toBe(true);
    expect(ambiguousItems.children.find((item) => item.id === 'format-table-source')?.disabled).toBe(true);

    const invalidAnnotation = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: {
        columnCount: 2,
        kind: 'whole-table',
        tableAlignmentAvailable: false
      }
    }));
    const invalidAnnotationItems = invalidAnnotation.items.find((item) => item.id === 'table');
    if (invalidAnnotationItems?.kind !== 'submenu') throw new Error('table-submenu-missing');
    expect(invalidAnnotationItems.children.find((item) => item.id === 'format-table-source')?.disabled).toBe(true);
  });

  it('exposes whole-table, row, and column alignment states when annotation support is available', () => {
    const model = createEditorContextMenuModel(context({
      block: 'table',
      tableSelection: { columnCount: 2, kind: 'row', row: 2 }
    }));
    const table = model.items.find((item) => item.id === 'table');
    if (table?.kind !== 'submenu') throw new Error('table-submenu-missing');
    const alignment = table.children.find((item) => item.id === 'table-alignment');
    if (alignment?.kind !== 'submenu') throw new Error('alignment-submenu-missing');

    expect(alignment.children.map((item) => [item.id, item.disabled])).toEqual([
      ['align-left', false],
      ['align-center', false],
      ['align-right', false]
    ]);
  });

  it('disables every table-owned operation when the annotation owner is invalid without disabling generic actions', () => {
    const model = createEditorContextMenuModel(context({
      block: 'table',
      clipboard: { status: 'available' },
      hasSelection: true,
      tableSelection: {
        canDeleteColumn: true,
        canDeleteRow: true,
        column: 0,
        columnCount: 2,
        kind: 'column',
        rowIndex: 2,
        tableAlignmentAvailable: false
      }
    }));
    const table = model.items.find((item) => item.id === 'table');
    if (table?.kind !== 'submenu') throw new Error('table-submenu-missing');
    for (const id of [
      'insert-row-above',
      'insert-row-below',
      'insert-column-left',
      'insert-column-right',
      'delete-row',
      'delete-column',
      'copy-table',
      'format-table-source',
      'delete-table',
      'insert-paragraph-above-table',
      'insert-paragraph-below-table'
    ]) {
      expect(table.children.find((item) => item.id === id)?.disabled).toBe(true);
    }
    expect(model.items.find((item) => item.id === 'copy')?.disabled).toBe(false);
    const insert = model.items.find((item) => item.id === 'insert');
    if (insert?.kind !== 'submenu') throw new Error('insert-submenu-missing');
    expect(insert.children.find((item) => item.id === 'insert-table')?.disabled).toBe(false);
  });

  it('only exposes thematic-break deletion for a parser-owned thematic-break block', () => {
    expect(createEditorContextMenuModel(context({ block: 'thematic-break' })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'delete-thematic-break', disabled: false })
      ])
    );
    expect(
      createEditorContextMenuModel(context()).items.some(
        (item) => item.id === 'delete-thematic-break'
      )
    ).toBe(false);
    expect(
      createEditorContextMenuModel(context({ block: 'heading' })).items.some(
        (item) => item.id === 'delete-thematic-break'
      )
    ).toBe(false);
  });

  it('keeps row alignment disabled when the annotation owner is unavailable', () => {
    const model = createEditorContextMenuModel(context({
      block: 'table',
      tableAlignmentAvailable: false,
      tableSelection: { columnCount: 2, kind: 'row', row: 2 }
    }));
    const table = model.items.find((item) => item.id === 'table');
    if (table?.kind !== 'submenu') throw new Error('table-submenu-missing');
    const alignment = table.children.find((item) => item.id === 'table-alignment');
    if (alignment?.kind !== 'submenu') throw new Error('alignment-submenu-missing');
    expect(alignment.disabled).toBe(true);
    expect(alignment.children.every((item) => item.disabled)).toBe(true);
  });

  it('keeps Upload Image outside the seven-value scale submenu', () => {
    const model = createEditorContextMenuModel(context({
      hasSelection: true,
      image: { canCopyImage: true, scale: 100, uploadDisabled: false }
    }));
    const scale = model.items.find((item) => item.id === 'image-scale');
    if (scale?.kind !== 'submenu') throw new Error('image-scale-submenu-missing');
    expect(scale.children.map((item) => item.id)).toEqual([
      'image-scale-25', 'image-scale-33', 'image-scale-50', 'image-scale-67',
      'image-scale-100', 'image-scale-150', 'image-scale-200'
    ]);
    expect(model.items.find((item) => item.id === 'upload-image')?.disabled).toBe(false);
    expect(model.items.find((item) => item.id === 'copy-image')?.disabled).toBe(false);
  });

  it('projects an image shortcut only onto the insert-image action', () => {
    const model = createEditorContextMenuModel(context({ imageShortcut: 'Ctrl-Alt-I' }));
    const insert = model.items.find((item) => item.id === 'insert');
    if (insert?.kind !== 'submenu') throw new Error('insert-submenu-missing');
    expect(insert.children.find((item) => item.id === 'insert-image')).toMatchObject({
      shortcut: 'Ctrl-Alt-I'
    });
    expect(insert.children.find((item) => item.id === 'insert-table')).not.toHaveProperty('shortcut');
  });

  it('disables image scale and upload actions on a read-only surface', () => {
    const model = createEditorContextMenuModel(context({
      image: { scale: 100, uploadDisabled: false },
      readOnly: true
    }));
    const scale = model.items.find((item) => item.id === 'image-scale');
    if (scale?.kind !== 'submenu') throw new Error('image-scale-submenu-missing');
    expect(scale.children.every((item) => item.disabled)).toBe(true);
    expect(model.items.find((item) => item.id === 'upload-image')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'delete-image')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'copy-image')?.disabled).toBe(true);
  });

  it('includes code-block copy, content copy, adjacent insertion, and delete actions', () => {
    const model = createEditorContextMenuModel(context({
      block: 'code',
      code: { canCopyContent: true }
    }));
    const code = model.items.find((item) => item.id === 'code-block');
    expect(code?.kind).toBe('submenu');
    if (code?.kind !== 'submenu') throw new Error('code-submenu-missing');
    expect(code.children.map((item) => item.id)).toEqual([
      'copy-code-block',
      'copy-code-content',
      'indent-code-block',
      'indent-selected-code',
      'insert-paragraph-above-code',
      'insert-paragraph-below-code',
      'delete-code-block'
    ]);
    expect(code.children.find((item) => item.id === 'copy-code-content')?.disabled).toBe(false);
    expect(code.children.find((item) => item.id === 'indent-code-block')?.disabled).toBe(true);
    expect(code.children.find((item) => item.id === 'indent-selected-code')?.disabled).toBe(true);
    const unsupported = createEditorContextMenuModel(context({ block: 'code' }));
    const unsupportedCode = unsupported.items.find((item) => item.id === 'code-block');
    if (unsupportedCode?.kind !== 'submenu') throw new Error('code-submenu-missing');
    expect(unsupportedCode.children.map((item) => item.id)).toEqual([
      'copy-code-block',
      'indent-code-block',
      'indent-selected-code',
      'insert-paragraph-above-code',
      'insert-paragraph-below-code',
      'delete-code-block'
    ]);

    const supported = createEditorContextMenuModel(context({
      block: 'code',
      code: {
        canCopyContent: true,
        canIndentBlock: true,
        canIndentSelection: true
      }
    }));
    const supportedCode = supported.items.find((item) => item.id === 'code-block');
    if (supportedCode?.kind !== 'submenu') throw new Error('code-submenu-missing');
    expect(supportedCode.children.find((item) => item.id === 'indent-code-block')?.disabled).toBe(false);
    expect(supportedCode.children.find((item) => item.id === 'indent-selected-code')?.disabled).toBe(false);

    const nested = createEditorContextMenuModel(context({
      block: 'quote',
      code: { canCopyContent: true }
    }));
    const nestedCode = nested.items.find((item) => item.id === 'code-block');
    if (nestedCode?.kind !== 'submenu') throw new Error('nested-code-submenu-missing');
    expect(nestedCode.children.map((item) => item.id)).toEqual([
      'copy-code-content',
      'indent-code-block',
      'indent-selected-code'
    ]);

    const nestedSupported = createEditorContextMenuModel(context({
      block: 'quote',
      code: {
        canCopyContent: true,
        canIndentBlock: true,
        canIndentSelection: true
      }
    }));
    const nestedSupportedCode = nestedSupported.items.find(
      (item) => item.id === 'code-block'
    );
    if (nestedSupportedCode?.kind !== 'submenu') {
      throw new Error('nested-supported-code-submenu-missing');
    }
    expect(nestedSupportedCode.children.find(
      (item) => item.id === 'indent-code-block'
    )?.disabled).toBe(false);
    expect(nestedSupportedCode.children.find(
      (item) => item.id === 'indent-selected-code'
    )?.disabled).toBe(false);
  });

  it('adds link actions only for a captured target and keeps copy independent of open capability', () => {
    const model = createEditorContextMenuModel(context({
      link: { canOpen: false }
    }));
    expect(model.items.find((item) => item.id === 'open-link')?.disabled).toBe(true);
    expect(model.items.find((item) => item.id === 'copy-link-address')?.disabled).toBe(false);

    const withoutLink = createEditorContextMenuModel(context());
    expect(withoutLink.items.some((item) => item.id === 'open-link')).toBe(false);
    expect(withoutLink.items.some((item) => item.id === 'copy-link-address')).toBe(false);
  });

  it('keeps generated export capabilities separate from source mutation validity', () => {
    const model = createEditorContextMenuModel(context({
      block: 'code',
      generated: {
        canCopyImage: true,
        canCopyMathMl: true,
        canSaveImage: true,
        canUseSource: false,
        code: {
          canCopyBlock: false,
          canIndentBlock: false,
          canIndentSelection: false
        },
        kind: 'math'
      }
    }));
    expect(model.items.filter((item) => item.id === 'code-block')).toHaveLength(0);
    const generated = model.items.find((item) => item.id === 'generated-content');
    if (generated?.kind !== 'submenu') throw new Error('generated-submenu-missing');
    expect(generated.children.map((item) => item.id)).toEqual([
      'edit-generated-content',
      'copy-generated',
      'code-block',
      'save-generated-image',
      'insert-paragraph-above-generated',
      'insert-paragraph-below-generated',
      'delete-generated-content'
    ]);
    expect(generated.children.find((item) => item.id === 'edit-generated-content')?.disabled).toBe(true);
    expect(generated.children.find((item) => item.id === 'insert-paragraph-above-generated')?.disabled).toBe(true);
    expect(generated.children.find((item) => item.id === 'delete-generated-content')?.disabled).toBe(true);
    expect(generated.children.find((item) => item.id === 'save-generated-image')?.disabled).toBe(false);
    const copyGenerated = generated.children.find((item) => item.id === 'copy-generated');
    if (copyGenerated?.kind !== 'submenu') throw new Error('generated-copy-submenu-missing');
    expect(copyGenerated.children.map((item) => item.id)).toEqual([
      'copy-generated-image',
      'copy-generated-source',
      'copy-generated-mathml'
    ]);
    expect(copyGenerated.children.find((item) => item.id === 'copy-generated-image')?.disabled).toBe(false);
    expect(copyGenerated.children.find((item) => item.id === 'copy-generated-source')?.disabled).toBe(true);
    expect(copyGenerated.children.find((item) => item.id === 'copy-generated-mathml')?.disabled).toBe(false);
    const code = generated.children.find((item) => item.id === 'code-block');
    if (code?.kind !== 'submenu') throw new Error('generated-code-submenu-missing');
    expect(code.children.map((item) => item.id)).toEqual([
      'copy-code-block',
      'indent-code-block',
      'indent-selected-code'
    ]);
    expect(code.children.every((item) => item.disabled)).toBe(true);
  });

  it('omits MathML and preserves source gating for diagram generated content', () => {
    const model = createEditorContextMenuModel(context({
      block: 'code',
      generated: {
        canCopyImage: false,
        canCopyMathMl: true,
        canSaveImage: false,
        canUseSource: true,
        code: {
          canCopyBlock: true,
          canIndentBlock: false,
          canIndentSelection: false
        },
        kind: 'mermaid'
      }
    }));
    expect(model.items.filter((item) => item.id === 'code-block')).toHaveLength(0);
    const generated = model.items.find((item) => item.id === 'generated-content');
    if (generated?.kind !== 'submenu') throw new Error('generated-submenu-missing');
    expect(generated.label).toBe('Diagram');
    const copyGenerated = generated.children.find((item) => item.id === 'copy-generated');
    if (copyGenerated?.kind !== 'submenu') throw new Error('generated-copy-submenu-missing');
    expect(copyGenerated.children.map((item) => item.id)).toEqual([
      'copy-generated-image',
      'copy-generated-source'
    ]);
    expect(copyGenerated.children.find((item) => item.id === 'copy-generated-image')?.disabled).toBe(true);
    expect(copyGenerated.children.find((item) => item.id === 'copy-generated-source')?.disabled).toBe(false);
    const code = generated.children.find((item) => item.id === 'code-block');
    if (code?.kind !== 'submenu') throw new Error('generated-code-submenu-missing');
    expect(code.children.find((item) => item.id === 'copy-code-block')?.disabled).toBe(false);
    expect(code.children.find((item) => item.id === 'indent-code-block')?.disabled).toBe(true);
    expect(code.children.find((item) => item.id === 'indent-selected-code')?.disabled).toBe(true);
    expect(generated.children.find((item) => item.id === 'edit-generated-content')?.disabled).toBe(false);
    expect(generated.children.find((item) => item.id === 'save-generated-image')?.disabled).toBe(true);
  });
});
