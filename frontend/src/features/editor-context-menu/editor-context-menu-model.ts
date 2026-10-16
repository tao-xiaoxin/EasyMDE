import type { EditorClipboardState } from '../../contracts/ports/editor-clipboard-port';
import type {
  MarkdownBlockKind,
  TableSelection
} from './editor-context-menu-rules';

export type EditorContextMenuActionItem = Readonly<{
  checked?: boolean;
  disabled: boolean;
  id: string;
  kind: 'item';
  label: string;
  shortcut?: string;
}>;

export type EditorContextMenuSubmenuItem = Readonly<{
  children: ReadonlyArray<EditorContextMenuItem>;
  disabled?: boolean;
  id: string;
  kind: 'submenu';
  label: string;
  shortcut?: string;
}>;

export type EditorContextMenuItem = EditorContextMenuActionItem | EditorContextMenuSubmenuItem;

export type EditorContextMenuModel = Readonly<{
  items: ReadonlyArray<EditorContextMenuItem>;
}>;

export type EditorContextMenuHeadingLevel = Readonly<{
  id: string;
  label: string;
  level: number;
}>;

/**
 * Heading data prepared from the existing toolbar heading command owner. The
 * level items keep the toolbar command ids so a chosen level dispatches through
 * the same Markdown heading command as the toolbar.
 */
export type EditorContextMenuHeadingContext = Readonly<{
  currentLevel: number | null;
  label: string;
  levels: ReadonlyArray<EditorContextMenuHeadingLevel>;
}>;

export type EditorContextMenuLabels = Readonly<{
  alignCenter: string;
  alignLeft: string;
  alignRight: string;
  alignment: string;
  ariaLabel: string;
  bold: string;
  codeBlock: string;
  copy: string;
  copyAsHtml: string;
  copyAsMarkdown: string;
  copyCodeBlock: string;
  copyCodeContent: string;
  indentCodeBlock: string;
  indentSelectedCode: string;
  copyDiagramSource: string;
  copyGeneratedImage: string;
  copyGeneratedMathMl: string;
  copyImage: string;
  copyLinkAddress: string;
  copyPasteAs: string;
  copyMathSource: string;
  copySimplifiedFormatting: string;
  copyTable: string;
  formatTableSource: string;
  cut: string;
  deleteCodeBlock: string;
  deleteColumn: string;
  deleteGeneratedContent: string;
  deleteImage: string;
  deleteRow: string;
  deleteTable: string;
  deleteThematicBreak: string;
  diagramBlock: string;
  editGeneratedContent: string;
  image: string;
  imageScale: string;
  insert: string;
  insertAbove: string;
  insertBelow: string;
  insertCodeAbove: string;
  insertCodeBelow: string;
  insertImageAbove: string;
  insertImageBelow: string;
  insertColumnLeft: string;
  insertColumnRight: string;
  insertParagraphAboveGenerated: string;
  insertParagraphAboveTable: string;
  insertParagraphBelowGenerated: string;
  insertParagraphBelowTable: string;
  insertTableAbove: string;
  insertTableBelow: string;
  insertRowAbove: string;
  insertRowBelow: string;
  mathBlock: string;
  paste: string;
  pastePlainText: string;
  table: string;
  unsupported: string;
  uploadImage: string;
}>;

export type EditorContextMenuModelContext = Readonly<{
  block: MarkdownBlockKind;
  clipboard: EditorClipboardState;
  canInsertRelative?: boolean;
  canCopySimplified?: boolean;
  code?: Readonly<{
    canCopyContent: boolean;
    canIndentBlock?: boolean;
    canIndentSelection?: boolean;
    info?: string;
    target?: Readonly<{ from: number; to: number }>;
  }>;
  generated?: Readonly<{
    canCopyImage: boolean;
    canCopyMathMl: boolean;
    canUseSource: boolean;
    code?: Readonly<{
      canCopyBlock?: boolean;
      canIndentBlock?: boolean;
      canIndentSelection?: boolean;
    }>;
    kind: 'math' | 'mermaid';
  }>;
  heading?: EditorContextMenuHeadingContext;
  hasSelection: boolean;
  imageShortcut?: string;
  image?: Readonly<{
    canCopyImage?: boolean;
    scale: number | null;
    uploadDisabled: boolean;
  }>;
  labels: EditorContextMenuLabels;
  link?: Readonly<{
    href: string;
  }>;
  readOnly: boolean;
  shortcut?: string;
  tableAlignmentAvailable?: boolean;
  tableSelection?: TableSelection;
}>;

function action(
  id: string,
  label: string,
  disabled: boolean,
  shortcut?: string,
  checked?: boolean
): EditorContextMenuActionItem {
  return {
    disabled,
    id,
    kind: 'item',
    label,
    ...(undefined === shortcut ? {} : { shortcut }),
    ...(undefined === checked ? {} : { checked })
  };
}

function submenu(
  id: string,
  label: string,
  children: ReadonlyArray<EditorContextMenuItem>,
  disabled = false
): EditorContextMenuSubmenuItem {
  return {
    children,
    disabled,
    id,
    kind: 'submenu',
    label
  };
}

function readableClipboard(state: EditorClipboardState): boolean {
  return 'available' === state.status;
}

function canInsertRelative(
  context: EditorContextMenuModelContext,
  canEdit: boolean
): boolean {
  return canEdit
    && 'unavailable' !== context.block
    && context.canInsertRelative !== false;
}

function isMermaidCodeBlock(context: EditorContextMenuModelContext): boolean {
  const info = context.code?.info?.trim().toLowerCase();
  return Boolean(info && info.split(/\s+/u)[0] === 'mermaid');
}

function headingItems(
  context: EditorContextMenuModelContext,
  canEdit: boolean
): EditorContextMenuSubmenuItem | null {
  const { heading } = context;
  if (!heading || 0 === heading.levels.length) return null;
  return submenu(
    'heading-level',
    heading.label,
    heading.levels.map((level) =>
      action(
        level.id,
        level.label,
        !canEdit,
        undefined,
        heading.currentLevel === level.level
      )
    )
  );
}

function tableItems(
  context: EditorContextMenuModelContext,
  canEdit: boolean
): EditorContextMenuSubmenuItem {
  const { labels, tableSelection } = context;
  // Mounting this submenu already proves the selection starts inside a table.
  // A mixed multi-row selection still owns a deterministic anchor - its first
  // row and column - so block-scoped and anchor-scoped operations stay
  // available, while the operations whose target row, column, or alignment
  // cannot be proven from that anchor stay disabled.
  const tableOperationAvailable = canEdit
    && context.tableAlignmentAvailable !== false
    && Boolean(tableSelection)
    && tableSelection?.tableAlignmentAvailable !== false;
  const anchoredOperationAvailable = tableOperationAvailable
    && 'ambiguous' !== tableSelection?.kind;
  const alignmentDisabled = !anchoredOperationAvailable;
  const canDeleteRow = anchoredOperationAvailable
    && tableSelection?.canDeleteRow === true;
  const canDeleteColumn = anchoredOperationAvailable
    && tableSelection?.canDeleteColumn === true;
  const canFormatSource = anchoredOperationAvailable;
  return submenu('table', labels.table, [
    action('insert-row-above', labels.insertRowAbove, !tableOperationAvailable),
    action('insert-row-below', labels.insertRowBelow, !tableOperationAvailable),
    action('insert-column-left', labels.insertColumnLeft, !tableOperationAvailable),
    action('insert-column-right', labels.insertColumnRight, !tableOperationAvailable),
    action('delete-row', labels.deleteRow, !canDeleteRow),
    action('delete-column', labels.deleteColumn, !canDeleteColumn),
    action('copy-table', labels.copyTable, !tableOperationAvailable),
    action('format-table-source', labels.formatTableSource, !canFormatSource),
    action('delete-table', labels.deleteTable, !tableOperationAvailable),
    action('insert-paragraph-above-table', labels.insertParagraphAboveTable, !tableOperationAvailable),
    action('insert-paragraph-below-table', labels.insertParagraphBelowTable, !tableOperationAvailable),
    submenu('table-alignment', labels.alignment, [
      action('align-left', labels.alignLeft, alignmentDisabled),
      action('align-center', labels.alignCenter, alignmentDisabled),
      action('align-right', labels.alignRight, alignmentDisabled)
    ], alignmentDisabled)
  ]);
}

function codeItems(
  context: EditorContextMenuModelContext,
  canEdit: boolean
): EditorContextMenuSubmenuItem {
  const children: EditorContextMenuItem[] = [];
  const hasCodeBlock = 'code' === context.block || Boolean(context.code?.target);
  const canInsert = canInsertRelative(context, canEdit);
  if (hasCodeBlock && !context.hasSelection) {
    const canUseSelection = context.hasSelection;
    const canMutateSelection = canUseSelection && canEdit;
    const canPaste = canEdit && readableClipboard(context.clipboard);

    // A fenced/indented code block owns these general editing actions inside
    // its context submenu. Keeping them here avoids rendering a second copy
    // of the same actions at the root while retaining the ordinary selection
    // and Clipboard disabled semantics.
    children.push(
      action('bold', context.labels.bold, !canMutateSelection, context.shortcut),
      submenu('copy-paste-as', context.labels.copyPasteAs, [
        action('copy-as-markdown', context.labels.copyAsMarkdown, !canUseSelection),
        action('copy-as-html', context.labels.copyAsHtml, !canUseSelection),
        action(
          'copy-simplified-formatting',
          context.labels.copySimplifiedFormatting,
          !canUseSelection || context.canCopySimplified !== true
        ),
        action('paste-plain-text', context.labels.pastePlainText, !canPaste)
      ]),
      submenu('insert', context.labels.insert, [
        action('insert-table-above', context.labels.insertTableAbove, !canInsert),
        action('insert-table-below', context.labels.insertTableBelow, !canInsert),
        action(
          'insert-image-above',
          context.labels.insertImageAbove,
          !canInsert,
          context.imageShortcut
        ),
        action('insert-image-below', context.labels.insertImageBelow, !canInsert)
      ])
    );
    children.push(action('copy-code-block', context.labels.copyCodeBlock, false));
  }
  if (context.code?.canCopyContent === true) {
    children.push(action('copy-code-content', context.labels.copyCodeContent, false));
  }
  if ('code' === context.block || context.code) {
    children.push(
      action(
        'indent-code-block',
        context.labels.indentCodeBlock,
        !canEdit || context.code?.canIndentBlock !== true
      ),
      action(
        'indent-selected-code',
        context.labels.indentSelectedCode,
        !canEdit || context.code?.canIndentSelection !== true
      )
    );
  }
  if (hasCodeBlock) {
    children.push(
      action('insert-paragraph-above-code', context.labels.insertCodeAbove, !canEdit),
      action('insert-paragraph-below-code', context.labels.insertCodeBelow, !canEdit),
      action('delete-code-block', context.labels.deleteCodeBlock, !canEdit)
    );
  }
  return submenu('code-block', context.labels.codeBlock, children);
}

function generatedItems(
  context: EditorContextMenuModelContext,
  canEdit: boolean
): EditorContextMenuSubmenuItem {
  const generated = context.generated;
  if (!generated) throw new Error('editor-context-menu-generated-context-missing');

  const canMutate = canEdit && generated.canUseSource;
  const sourceLabel = 'math' === generated.kind
    ? context.labels.copyMathSource
    : context.labels.copyDiagramSource;
  const copyItems: EditorContextMenuItem[] = [
    action('copy-generated-image', context.labels.copyGeneratedImage, !generated.canCopyImage),
    action('copy-generated-source', sourceLabel, !generated.canUseSource)
  ];
  if ('math' === generated.kind) {
    copyItems.push(
      action('copy-generated-mathml', context.labels.copyGeneratedMathMl, !generated.canCopyMathMl)
    );
  }

  return submenu(
    'generated-content',
    'math' === generated.kind ? context.labels.mathBlock : context.labels.diagramBlock,
    [
      submenu('copy-generated', context.labels.copy, copyItems),
      action(
        'insert-paragraph-above-generated',
        context.labels.insertParagraphAboveGenerated,
        !canMutate
      ),
      action(
        'insert-paragraph-below-generated',
        context.labels.insertParagraphBelowGenerated,
        !canMutate
      ),
      action('delete-generated-content', context.labels.deleteGeneratedContent, !canMutate)
    ]
  );
}

export function createEditorContextMenuModel(
  context: EditorContextMenuModelContext
): EditorContextMenuModel {
  const canEdit = !context.readOnly;
  const codeBlockContext = !context.generated && (
    'code' === context.block || Boolean(context.code?.target)
  );
  const canInsert = canInsertRelative(context, canEdit);
  const canUseSelection = context.hasSelection;
  const canMutateSelection = context.hasSelection && canEdit;
  const canPaste = canEdit && readableClipboard(context.clipboard);
  const copyPaste = submenu('copy-paste-as', context.labels.copyPasteAs, [
    action('copy-as-markdown', context.labels.copyAsMarkdown, !canUseSelection),
    action('copy-as-html', context.labels.copyAsHtml, !canUseSelection),
    action(
      'copy-simplified-formatting',
      context.labels.copySimplifiedFormatting,
      !canUseSelection || context.canCopySimplified !== true
    ),
    action('paste-plain-text', context.labels.pastePlainText, !canPaste)
  ]);
  const items: EditorContextMenuItem[] = [];
  const generatedContext = Boolean(context.generated);
  const formulaContext = context.block === 'math' || generatedContext;
  if (!context.image && !codeBlockContext && !formulaContext) {
    items.push(action('bold', context.labels.bold, !canMutateSelection, context.shortcut));
  }
  items.push(
    action('cut', context.labels.cut, !canMutateSelection),
    action('copy', context.labels.copy, !canUseSelection),
    action('paste', context.labels.paste, !canPaste)
  );
  if (!context.image && !codeBlockContext) items.push(copyPaste);
  if (context.link) {
    items.push(action('copy-link-address', context.labels.copyLinkAddress, false));
  }
  const insert = submenu('insert', context.labels.insert, [
    action('insert-table-above', context.labels.insertTableAbove, !canInsert),
    action('insert-table-below', context.labels.insertTableBelow, !canInsert),
    action(
      'insert-image-above',
      context.labels.insertImageAbove,
      !canInsert,
      context.imageShortcut
    ),
    action('insert-image-below', context.labels.insertImageBelow, !canInsert),
    action('insert-paragraph-above', context.labels.insertAbove, !canInsert),
    action('insert-paragraph-below', context.labels.insertBelow, !canInsert)
  ]);
  if (!codeBlockContext) items.push(insert);
  if ('heading' === context.block) {
    const heading = headingItems(context, canEdit);
    if (heading) items.push(heading);
  }
  if (context.image) {
    items.push(submenu('image-scale', context.labels.imageScale, [
      ...[25, 33, 50, 67, 100, 150, 200].map((scale) =>
        action(`image-scale-${scale}`, `${scale}%`, !canEdit)
      )
    ]));
    items.push(action(
      'upload-image',
      context.labels.uploadImage,
      !canEdit || context.image.uploadDisabled
    ));
    items.push(action('delete-image', context.labels.deleteImage, !canEdit));
    items.push(action('copy-image', context.labels.copyImage, context.image.canCopyImage !== true));
  }
  if ('table' === context.block) items.push(tableItems(context, canEdit));
  if ('thematic-break' === context.block) {
    items.push(action(
      'delete-thematic-break',
      context.labels.deleteThematicBreak,
      !canEdit
    ));
  }
  if (
    !context.generated
    && !isMermaidCodeBlock(context)
    && (
      'code' === context.block
      || context.code?.canCopyContent === true
      || context.code?.canIndentBlock === true
      || context.code?.canIndentSelection === true
    )
  ) {
    items.push(codeItems(context, canEdit));
  }
  if (context.generated) items.push(generatedItems(context, canEdit));
  return { items };
}
