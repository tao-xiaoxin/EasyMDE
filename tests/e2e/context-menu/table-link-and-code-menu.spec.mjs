import { expect, test } from '@playwright/test';
import {
  anyMenuItem,
  assertSourceExactValue,
  closeMenu,
  expectMenuItemState,
  expectSourceSelection,
  loadCanonicalFixture,
  loginAndOpenNewPost,
  menuSelector,
  occurrenceOffset,
  openRootSubmenu,
  openSourceNativeMenu,
  readContextMenuDiagnostics,
  readPrivacySafeSourceState,
  replaceSourceWithNativeInput,
  rootItem,
  selectSourceRange,
  selectSourceText,
  startContextMenuDiagnostics,
  startSourceTransactionProbe,
  stopContextMenuDiagnostics,
  waitForSourceExactValue
} from '../helpers/context-menu-helpers.mjs';
import {
  assertClipboardTextExact,
  fencedBlockSource,
  readGeneratedExportSnapshot,
  readNativeClipboardText,
  startGeneratedExportMutationProbe,
  startSourceMediaConsoleProbe
} from '../helpers/context-menu-media-export-helpers.mjs';
import {
  applySourceTableAlignment,
  assertVisualActionState,
  enterFullVisual,
  enterImmersive,
  expectUnifiedVisualSurface,
  openVisualCodeActionMenu,
  openVisualMenu,
  readSourceSelectionRange,
  readVisualActionState,
  readVisualPreviewAcceptanceState,
  waitForVisualPreviewAccepted
} from '../helpers/context-menu-visual-helpers.mjs';

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
  trace: 'off',
  video: 'off'
});

test.describe('Editor context menu production surfaces', () => {
  test('copies canonical Bash code content without fences in Source and Full Visual', async ({ page }) => {
    await loginAndOpenNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const codeBody = `${fencedBlockSource(markdown, 'bash')}\n`;
    const selectedText = 'echo "Hello, Markdown!"';
    const selectedStart = occurrenceOffset(markdown, selectedText);
    const selectedEnd = selectedStart + selectedText.length;
    const mutationProbe = await startGeneratedExportMutationProbe(page);
    const copyCodeContentLabel = await page.evaluate(() => (
      window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.copyCodeContent ?? ''
    ));
    if (!copyCodeContentLabel) throw new Error('bootstrap-copy-code-content-label-missing');

    try {
      await assertSourceExactValue(source, markdown, 'source-copy-code-content-before');
      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await expectSourceSelection(page, selectedStart, selectedEnd);
      const sourceProbe = await startSourceTransactionProbe(page);
      try {
        await openSourceNativeMenu(page, sourceEditor, selectedText);
        await openRootSubmenu(page, 'code-block');
        const sourceAction = anyMenuItem(page, 'copy-code-content').last();
        await expect(sourceAction).toContainText(copyCodeContentLabel);
        await expect(sourceAction).toBeEnabled();
        await sourceAction.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        assertClipboardTextExact(
          await readNativeClipboardText(page),
          codeBody,
          'source-copy-code-content'
        );
        await assertSourceExactValue(source, markdown, 'source-copy-code-content-after');
        await expectSourceSelection(page, selectedStart, selectedEnd);
        const sourceEvents = await sourceProbe.snapshot();
        if (sourceEvents?.count !== 0) {
          throw new Error(`editor-context-menu-copy-code-content-source-transaction:${sourceEvents.count}`);
        }
      } finally {
        await sourceProbe.stop();
      }

      const full = await enterFullVisual(page);
      await waitForVisualPreviewAccepted(full.visualEditor, 'full-copy-code-content-before');
      const visualTarget = full.visualEditor.locator('pre').filter({ hasText: selectedText }).first();
      const previewBefore = await readVisualPreviewAcceptanceState(full.visualEditor);
      const visualProbe = await startSourceTransactionProbe(page);
      try {
        const visualBefore = await openVisualCodeActionMenu(
          page,
          full.visualEditor,
          visualTarget,
          selectedText
        );
        await openRootSubmenu(page, 'code-block');
        const visualAction = anyMenuItem(page, 'copy-code-content').last();
        await expect(visualAction).toContainText(copyCodeContentLabel);
        await expect(visualAction).toBeEnabled();
        await visualAction.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        assertClipboardTextExact(
          await readNativeClipboardText(page),
          codeBody,
          'full-copy-code-content'
        );
        await assertSourceExactValue(source, markdown, 'full-copy-code-content-after');
        const visualAfter = await readVisualActionState(full.visualEditor);
        assertVisualActionState(visualAfter, 'full-copy-code-content-after');
        if (visualAfter.selectedTextLength !== visualBefore.selectedTextLength
          || visualAfter.nativeRangeCount !== visualBefore.nativeRangeCount) {
          throw new Error(
            `editor-context-menu-copy-code-content-visual-selection-drift:${JSON.stringify({
              after: {
                anchorConnected: visualAfter.anchorConnected,
                focusConnected: visualAfter.focusConnected,
                nativeRangeCount: visualAfter.nativeRangeCount,
                rangeCollapsed: visualAfter.rangeCollapsed,
                selectedTextLength: visualAfter.selectedTextLength,
                selectionCollapsed: visualAfter.selectionCollapsed
              },
              before: {
                anchorConnected: visualBefore.anchorConnected,
                focusConnected: visualBefore.focusConnected,
                nativeRangeCount: visualBefore.nativeRangeCount,
                rangeCollapsed: visualBefore.rangeCollapsed,
                selectedTextLength: visualBefore.selectedTextLength,
                selectionCollapsed: visualBefore.selectionCollapsed
              }
            })}`
          );
        }
        const previewAfter = await readVisualPreviewAcceptanceState(full.visualEditor);
        if (previewAfter.domHash !== previewBefore.domHash
          || previewAfter.domLength !== previewBefore.domLength) {
          throw new Error('editor-context-menu-copy-code-content-preview-drift');
        }
        const visualEvents = await visualProbe.snapshot();
        if (visualEvents?.count !== 0) {
          throw new Error(`editor-context-menu-copy-code-content-visual-transaction:${visualEvents.count}`);
        }
      } finally {
        await visualProbe.stop();
      }
      await mutationProbe.assertEmpty('copy-code-content');
    } finally {
      mutationProbe.stop();
    }
  });

  test('copies explicit and reference Link addresses from partial Source captions in ordinary and immersive split modes', async ({ page }) => {
    await loginAndOpenNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const explicitLink = '[OpenAI 官网](https://openai.com)';
    const referenceLink = '[GitHub][github-link]';
    const explicitStart = occurrenceOffset(markdown, explicitLink) + 1;
    const referenceStart = occurrenceOffset(markdown, referenceLink) + 1;
    const linkCases = [
      {
        id: 'explicit',
        selectionEnd: explicitStart + 'OpenAI'.length,
        selectionStart: explicitStart,
        selectedText: 'OpenAI',
        url: 'https://openai.com'
      },
      {
        id: 'reference',
        selectionEnd: referenceStart + 'Git'.length,
        selectionStart: referenceStart,
        selectedText: 'Git',
        url: 'https://github.com'
      }
    ];
    const mutationProbe = await startGeneratedExportMutationProbe(page);
    const runSourceLinkCase = async (mode, editor, linkCase) => {
      await assertSourceExactValue(source, markdown, `${mode}-${linkCase.id}-before`);
      await selectSourceRange(
        page,
        editor,
        markdown,
        linkCase.selectionStart,
        linkCase.selectionEnd
      );
      const before = await readGeneratedExportSnapshot(page);
      const sourceProbe = await startSourceTransactionProbe(page);
      try {
        await openSourceNativeMenu(page, editor, linkCase.selectedText);
        await expectMenuItemState(page, 'copy-link-address', 'enabled');
        await rootItem(page, 'copy-link-address').click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        assertClipboardTextExact(
          await readNativeClipboardText(page),
          linkCase.url,
          `${mode}-${linkCase.id}-copy-link-address`
        );
        await assertSourceExactValue(source, markdown, `${mode}-${linkCase.id}-after`);
        await expectSourceSelection(
          page,
          linkCase.selectionStart,
          linkCase.selectionEnd
        );
        const after = await readGeneratedExportSnapshot(page);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          throw new Error(`editor-context-menu-source-link-dom-drift:${mode}-${linkCase.id}`);
        }
        const sourceEvents = await sourceProbe.snapshot();
        if (sourceEvents?.count !== 0) {
          throw new Error(
            `editor-context-menu-source-link-transaction:${mode}-${linkCase.id}:${sourceEvents.count}`
          );
        }
      } finally {
        await sourceProbe.stop();
      }
      await mutationProbe.assertEmpty(`${mode}-${linkCase.id}`);
    };

    try {
      for (const linkCase of linkCases) {
        await runSourceLinkCase('ordinary-source', sourceEditor, linkCase);
      }

      const strings = await enterImmersive(page);
      await page.getByRole('button', { name: strings.split, exact: true }).last().click();
      await expect(page.locator('[data-easymde-editor-owner="react"].easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
      const splitSourceEditor = page.locator('.easymde-source-react .cm-content');
      for (const linkCase of linkCases) {
        await runSourceLinkCase('immersive-split-source', splitSourceEditor, linkCase);
      }
    } finally {
      mutationProbe.stop();
    }
  });

  test('repairs TS code indentation in Source and Full Visual while preserving code bytes and Undo', async ({ page }) => {
    await loginAndOpenNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const originalTsBody = fencedBlockSource(markdown, 'ts');
    const misformattedTsBody = originalTsBody.replace(/^[ \t]+/gmu, '');
    if (misformattedTsBody === originalTsBody) throw new Error('fixture-ts-indentation-missing');
    const misformattedMarkdown = markdown.replace(originalTsBody, misformattedTsBody);
    const codeStart = markdown.indexOf(originalTsBody);
    const codeEnd = codeStart + originalTsBody.length;
    const beforeCode = codeStart >= 0 ? markdown.slice(0, codeStart) : '';
    const afterCode = codeStart >= 0 ? markdown.slice(codeEnd) : '';
    if (codeStart < 0
      || `${beforeCode}${misformattedTsBody}${afterCode}` !== misformattedMarkdown) {
      throw new Error('fixture-ts-indentation-boundary-invalid');
    }
    const responseText = 'const response = await fetch(`/api/users/${id}`);';
    const responseLine = originalTsBody.split('\n').find((line) => line.includes(responseText));
    const misformattedResponseLine = misformattedTsBody
      .split('\n')
      .find((line) => line.includes(responseText));
    if (!responseLine || !misformattedResponseLine) {
      throw new Error('fixture-ts-response-line-missing');
    }
    const responseStart = misformattedMarkdown.indexOf(responseText);
    const endpointStart = misformattedMarkdown.indexOf('if (!response.ok)', responseStart);
    if (responseStart < 0 || endpointStart <= responseStart) {
      throw new Error('fixture-ts-selected-range-missing');
    }
    const selectedSourceText = misformattedMarkdown.slice(responseStart, endpointStart);
    const selectedExpected = misformattedMarkdown.replace(
      misformattedResponseLine,
      responseLine
    );
    const indentationLabels = await page.evaluate(() => ({
      block: window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.indentCodeBlock ?? '',
      selected: window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.indentSelectedCode ?? ''
    }));
    if (!indentationLabels.block || !indentationLabels.selected) {
      throw new Error('bootstrap-code-indentation-labels-missing');
    }
    const mutationProbe = await startGeneratedExportMutationProbe(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const assertIndentItems = async (mode, { selected }) => {
      const blockItem = anyMenuItem(page, 'indent-code-block').last();
      const selectedItem = anyMenuItem(page, 'indent-selected-code').last();
      await expect(blockItem).toContainText(indentationLabels.block);
      await expect(selectedItem).toContainText(indentationLabels.selected);
      if (selected) {
        await expect(blockItem).toBeEnabled();
        await expect(selectedItem).toBeEnabled();
      } else {
        await expect(blockItem).toBeDisabled();
        await expect(selectedItem).toBeDisabled();
      }
      await expect(anyMenuItem(page, 'copy-code-block').last()).toBeEnabled();
      if (mode.includes('bash')) {
        await closeMenu(page, `${mode}-indent-items`);
      }
    };
    const openCodeMenu = async (editor, selectedText) => {
      await openSourceNativeMenu(page, editor, selectedText);
      await openRootSubmenu(page, 'code-block');
    };
    const assertSourceSelectionLength = async (before, phase) => {
      const after = await readSourceSelectionRange(page);
      if (after.end <= after.start || after.end - after.start !== before.end - before.start) {
        throw new Error(`editor-context-menu-code-indent-selection-drift:${phase}`);
      }
      return after;
    };

    try {
      await assertSourceExactValue(source, markdown, 'code-indent-bash-before');
      await selectSourceText(page, sourceEditor, markdown, 'echo "Hello, Markdown!"');
      await openCodeMenu(sourceEditor, 'echo "Hello, Markdown!"');
      await assertIndentItems('ordinary-bash', { selected: false });
      await assertSourceExactValue(source, markdown, 'code-indent-bash-after');

      try {
        await replaceSourceWithNativeInput(
          page,
          sourceEditor,
          source,
          misformattedMarkdown,
          'code-indent-source-misformatted'
        );
      } catch (error) {
        throw new Error(
          `editor-context-menu-code-indent-preparation-failed:${JSON.stringify({
            consoleCodes: consoleProbe.codes(),
            source: await readPrivacySafeSourceState(source, misformattedMarkdown)
          })}`,
          { cause: error }
        );
      }
      await selectSourceRange(
        page,
        sourceEditor,
        misformattedMarkdown,
        responseStart,
        endpointStart
      );
      const selectedBefore = await readSourceSelectionRange(page);
      await openCodeMenu(sourceEditor, selectedSourceText);
      await assertIndentItems('ordinary-ts-selected', { selected: true });
      const selectedProbe = await startSourceTransactionProbe(page);
      try {
        await anyMenuItem(page, 'indent-selected-code').last().click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await waitForSourceExactValue(source, selectedExpected, 'code-indent-selected-applied');
        await assertSourceSelectionLength(selectedBefore, 'selected-applied');
      } finally {
        const selectedEvents = await selectedProbe.snapshot();
        if (selectedEvents?.count !== 1) {
          throw new Error(`editor-context-menu-code-indent-selected-transactions:${selectedEvents?.count ?? -1}`);
        }
        await selectedProbe.stop();
      }
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, misformattedMarkdown, 'code-indent-selected-undo');

      await replaceSourceWithNativeInput(
        page,
        sourceEditor,
        source,
        misformattedMarkdown,
        'code-indent-source-whole-before'
      );
      await selectSourceText(page, sourceEditor, misformattedMarkdown, responseText);
      const wholeBefore = await readSourceSelectionRange(page);
      await openCodeMenu(sourceEditor, responseText);
      await assertIndentItems('ordinary-ts-whole', { selected: true });
      const wholeProbe = await startSourceTransactionProbe(page);
      try {
        await anyMenuItem(page, 'indent-code-block').last().click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await waitForSourceExactValue(source, markdown, 'code-indent-whole-applied');
        await assertSourceSelectionLength(wholeBefore, 'whole-applied');
      } finally {
        const wholeEvents = await wholeProbe.snapshot();
        if (wholeEvents?.count !== 1) {
          throw new Error(`editor-context-menu-code-indent-whole-transactions:${wholeEvents?.count ?? -1}`);
        }
        await wholeProbe.stop();
      }
      await selectSourceText(page, sourceEditor, markdown, responseText);
      const repeatProbe = await startSourceTransactionProbe(page);
      try {
        await openCodeMenu(sourceEditor, responseText);
        await assertIndentItems('ordinary-ts-repeat', { selected: true });
        await anyMenuItem(page, 'indent-code-block').last().click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await assertSourceExactValue(source, markdown, 'code-indent-whole-repeat');
        const repeatEvents = await repeatProbe.snapshot();
        if (repeatEvents?.count !== 0) {
          throw new Error(`editor-context-menu-code-indent-repeat-transactions:${repeatEvents.count}`);
        }
      } finally {
        await repeatProbe.stop();
      }
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, misformattedMarkdown, 'code-indent-whole-undo');

      await replaceSourceWithNativeInput(
        page,
        sourceEditor,
        source,
        misformattedMarkdown,
        'code-indent-full-before'
      );
      const full = await enterFullVisual(page);
      const previewBefore = await waitForVisualPreviewAccepted(full.visualEditor, 'code-indent-full-before');
      const visualTarget = full.visualEditor.locator('pre').filter({ hasText: responseText }).first();
      const visualBefore = await openVisualCodeActionMenu(
        page,
        full.visualEditor,
        visualTarget,
        responseText
      );
      await openRootSubmenu(page, 'code-block');
      await assertIndentItems('full-ts-whole', { selected: true });
      await anyMenuItem(page, 'indent-code-block').last().click();
      await expect(page.locator(menuSelector)).toHaveCount(0);
      await waitForSourceExactValue(source, markdown, 'code-indent-full-applied');
      assertVisualActionState(visualBefore, 'code-indent-full-before');
      const fullAfter = await readVisualActionState(full.visualEditor);
      assertVisualActionState(fullAfter, 'code-indent-full-applied');
      const actionPreview = await waitForVisualPreviewAccepted(
        full.visualEditor,
        'code-indent-full-applied',
        previewBefore.domHash,
        page
      );
      await full.visualEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, misformattedMarkdown, 'code-indent-full-undo');
      await waitForVisualPreviewAccepted(full.visualEditor, 'code-indent-full-undo', actionPreview.domHash, page);
      assertVisualActionState(await readVisualActionState(full.visualEditor), 'code-indent-full-undo');

      const stableCodes = consoleProbe.codes();
      const unexpectedCodes = stableCodes.filter(
        (code) => code !== 'visual-editor-selection-restore-fallback'
      );
      if (unexpectedCodes.length > 0) {
        throw new Error(`editor-context-menu-code-indent-stable-error:${unexpectedCodes.join(',')}`);
      }
      expect(fullAfter.selectionInsideCodeBlock).toBe(true);
      await mutationProbe.assertEmpty('code-indent');
    } finally {
      consoleProbe.stop();
      mutationProbe.stop();
    }
  });

  test('applies Source table row, column, and whole-table alignment with last-action and one-Undo semantics', async ({ page }) => {
    await loginAndOpenNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const tableSource = [
      '| 左对齐    |  居中 |    右对齐 |',
      '| :----- | :-: | -----: |',
      '| Apple  | 100 | $99.99 |',
      '| Banana | 200 | $12.50 |',
      '| Orange | 300 |  $8.88 |'
    ].join('\n');
    const tableStart = markdown.indexOf(tableSource);
    if (tableStart < 0) throw new Error('fixture-alignment-table-missing');
    const tableEnd = tableStart + tableSource.length;
    const beforeTable = markdown.slice(0, tableStart);
    const afterTable = markdown.slice(tableEnd);
    const appleRow = '| Apple  | 100 | $99.99 |';
    const columnCell = '100';
    const marker = (alignment) =>
      `<!-- easymde-table-align:v1 ${JSON.stringify([[1, alignment]])} -->\n`;
    const withTable = (table, prefix = '') => `${beforeTable}${prefix}${table}${afterTable}`;
    const rowState = (alignment) => withTable(tableSource, marker(alignment));

    const rowLeft = rowState('left');
    await applySourceTableAlignment(
      page,
      { markdown, source, sourceEditor },
      appleRow,
      'left',
      rowLeft,
      { expandViewport: true }
    );
    const rowCenter = rowState('center');
    await applySourceTableAlignment(
      page,
      { markdown: rowLeft, source, sourceEditor },
      appleRow,
      'center',
      rowCenter
    );
    const rowRight = rowState('right');
    await applySourceTableAlignment(
      page,
      { markdown: rowCenter, source, sourceEditor },
      appleRow,
      'right',
      rowRight
    );

    const columnRightTable = tableSource.replace(
      '| :----- | :-: | -----: |',
      '| :----- | -: | -----: |'
    );
    const columnRight = withTable(columnRightTable, marker('right'));
    await applySourceTableAlignment(
      page,
      { markdown: rowRight, source, sourceEditor },
      columnCell,
      'right',
      columnRight
    );

    const wholeLeftTable = columnRightTable.replace(
      '| :----- | -: | -----: |',
      '| :----- | :- | :----- |'
    );
    const wholeLeft = withTable(wholeLeftTable);
    await applySourceTableAlignment(
      page,
      { markdown: columnRight, source, sourceEditor },
      columnRightTable,
      'left',
      wholeLeft
    );
    const wholeCenterTable = wholeLeftTable.replace(
      '| :----- | :- | :----- |',
      '| :-----: | :-: | :-----: |'
    );
    const wholeCenter = withTable(wholeCenterTable);
    await applySourceTableAlignment(
      page,
      { markdown: wholeLeft, source, sourceEditor },
      wholeLeftTable,
      'center',
      wholeCenter
    );

    await sourceEditor.press('ControlOrMeta+z');
    await expect(source).toHaveValue(wholeLeft);
    const finalValue = await source.inputValue();
    for (const row of [appleRow, '| Banana | 200 | $12.50 |', '| Orange | 300 |  $8.88 |']) {
      expect(finalValue).toContain(row);
    }
  });

  test('formats one selected Source table cell through the native menu without changing surrounding Markdown', async ({ page }) => {
    await loginAndOpenNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const tableSource = [
      '| 服务           | 地址                        |   状态  |  响应时间 |',
      '| ------------ | ------------------------- | :---: | ----: |',
      '| API Gateway  | `https://api.example.com` |  ✅ 正常 |  82ms |',
      '| Redis Cache  | `redis://127.0.0.1:6379`  |  ✅ 正常 |   4ms |',
      '| PostgreSQL   | `postgres://db:5432`      |  ✅ 正常 |  12ms |',
      '| Worker Queue | `amqp://rabbitmq:5672`    |   延迟  | 420ms |'
    ].join('\n');
    const formattedTable = [
      '| 服务           | 地址                        | 状态    | 响应时间  |',
      '| ------------ | ------------------------- | :---: | ----: |',
      '| API Gateway  | `https://api.example.com` | ✅ 正常  | 82ms  |',
      '| Redis Cache  | `redis://127.0.0.1:6379`  | ✅ 正常  | 4ms   |',
      '| PostgreSQL   | `postgres://db:5432`      | ✅ 正常  | 12ms  |',
      '| Worker Queue | `amqp://rabbitmq:5672`    | 延迟    | 420ms |'
    ].join('\n');
    const tableStart = markdown.indexOf(tableSource);
    if (tableStart < 0) throw new Error('fixture-format-table-source-missing');
    const tableEnd = tableStart + tableSource.length;
    const beforeTable = markdown.slice(0, tableStart);
    const afterTable = markdown.slice(tableEnd);
    const expectedDocument = `${beforeTable}${formattedTable}${afterTable}`;
    const selectedCell = '`https://api.example.com`';
    const formatLabel = await page.evaluate(() => (
      window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.formatTableSource ?? ''
    ));
    if (!formatLabel) throw new Error('bootstrap-format-table-source-label-missing');
    const stableCodes = [];
    const onConsole = (message) => {
      if ('error' !== message.type()) return;
      const match = message.text().match(/^\[EasyMDE\]\s+([a-z0-9-]+)$/u);
      if (match && !stableCodes.includes(match[1])) stableCodes.push(match[1]);
    };
    page.on('console', onConsole);

    const assertFormattedTable = async (expected, phase) => {
      const actual = await source.inputValue();
      const expectedOutside = `${beforeTable}${afterTable}`;
      if (!actual.startsWith(beforeTable)
        || !actual.endsWith(afterTable)
        || actual.slice(0, beforeTable.length) !== beforeTable
        || actual.slice(actual.length - afterTable.length) !== afterTable) {
        throw new Error(`editor-context-menu-format-table-outside-bytes-drift:${phase}`);
      }
      const actualTable = actual.slice(beforeTable.length, actual.length - afterTable.length);
      if (actualTable !== expected) {
        throw new Error(`editor-context-menu-format-table-value-drift:${phase}`);
      }
      if (actual.slice(0, beforeTable.length) + actual.slice(actual.length - afterTable.length)
        !== expectedOutside) {
        throw new Error(`editor-context-menu-format-table-outside-oracle-drift:${phase}`);
      }
      for (const cellMarkdown of [
        '`https://api.example.com`',
        '`redis://127.0.0.1:6379`',
        '`postgres://db:5432`',
        '`amqp://rabbitmq:5672`'
      ]) {
        if (!actualTable.includes(cellMarkdown)) {
          throw new Error(`editor-context-menu-format-table-cell-markdown-drift:${phase}`);
        }
      }
      if (!actualTable.includes('`https://api.example.com`')) {
        throw new Error(`editor-context-menu-format-table-escaped-cell-drift:${phase}`);
      }
      if ((actualTable.match(/\n/gu) ?? []).length !== (tableSource.match(/\n/gu) ?? []).length) {
        throw new Error(`editor-context-menu-format-table-separator-drift:${phase}`);
      }
    };

    try {
      await assertSourceExactValue(source, markdown, 'source-format-table-before');
      await selectSourceText(page, sourceEditor, markdown, selectedCell);
      await expectSourceSelection(
        page,
        markdown.indexOf(selectedCell),
        markdown.indexOf(selectedCell) + selectedCell.length
      );
      await openSourceNativeMenu(page, sourceEditor, selectedCell);
      await openRootSubmenu(page, 'table');
      const formatItem = anyMenuItem(page, 'format-table-source').last();
      await expect(formatItem).toContainText(formatLabel);
      await expect(formatItem).toBeEnabled();
      const firstTransactionProbe = await startSourceTransactionProbe(page);
      try {
        await formatItem.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        try {
          await waitForSourceExactValue(source, expectedDocument, 'source-format-table-applied');
        } catch (error) {
          const alerts = await page.locator(
            '.easymde-editor-message-alert-host [role="alert"]'
          ).evaluateAll((elements) => elements.map((element) => ({
            code: element.getAttribute('data-error-code')
              ?? element.getAttribute('data-easymde-error-code'),
            type: Array.from(element.classList)
              .find((className) => ['is-error', 'is-warning'].includes(className)) ?? null
          })));
          const preview = await page.locator('[data-easymde-preview-html-sink="1"]').last();
          const previewState = await preview.evaluate((element) => ({
            accepted: element.getAttribute('data-easymde-preview-accepted'),
            ariaBusy: element.getAttribute('aria-busy'),
            error: element.getAttribute('data-easymde-preview-error'),
            refreshing: element.getAttribute('data-easymde-preview-refreshing')
          }));
          throw new Error(
            `editor-context-menu-format-table-apply-failed:${JSON.stringify({
              alerts,
              menuCount: await page.locator(menuSelector).count(),
              preview: previewState,
              source: await readPrivacySafeSourceState(source, expectedDocument),
              stableCodes,
              transaction: await firstTransactionProbe.snapshot()
            })}`,
            { cause: error }
          );
        }
      } finally {
        await firstTransactionProbe.stop();
      }
      await assertFormattedTable(formattedTable, 'applied');
      await expect(page.locator('.easymde-editor-message-alert-host [role="alert"]'))
        .toHaveCount(0);

      await selectSourceText(page, sourceEditor, expectedDocument, selectedCell);
      const transactionProbe = await startSourceTransactionProbe(page);
      try {
        await openSourceNativeMenu(page, sourceEditor, selectedCell);
        await openRootSubmenu(page, 'table');
        const repeatFormatItem = anyMenuItem(page, 'format-table-source').last();
        await expect(repeatFormatItem).toContainText(formatLabel);
        await expect(repeatFormatItem).toBeEnabled();
        await repeatFormatItem.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await assertSourceExactValue(source, expectedDocument, 'source-format-table-repeat');
        const repeatEvents = await transactionProbe.snapshot();
        if (repeatEvents?.count !== 0) {
          throw new Error(`editor-context-menu-format-table-repeat-transaction:${repeatEvents.count}`);
        }
      } finally {
        await transactionProbe.stop();
      }
      await expect(page.locator('.easymde-editor-message-alert-host [role="alert"]'))
        .toHaveCount(0);
      if (stableCodes.length > 0) {
        throw new Error(`editor-context-menu-format-table-stable-error:${stableCodes.join(',')}`);
      }

      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'source-format-table-undo');
      await assertSourceExactValue(source, markdown, 'source-format-table-undo-exact');
    } finally {
      page.off('console', onConsole);
    }
  });

  test('windowed code deletion recovery', async ({ page }) => {
    await loginAndOpenNewPost(page);
    const leading = Array.from(
      { length: 220 },
      (_, index) => `windowed paragraph ${index}`
    ).join('\n\n');
    const fence = '~~~bash\necho windowed\n~~~';
    const trailing = '~~~js\nconst windowed = 1;\n~~~';
    const markdown = `${leading}\n\n${fence}\n\nwindowed middle\n\n${trailing}\n\nwindowed tail`;
    const fenceStart = markdown.indexOf(fence);
    if (fenceStart < 0) throw new Error('windowed-code-recovery-fence-offset-unavailable');
    // The structural owner removes exactly the fenced block offsets and never
    // consumes the blank-line separators on either side.
    const expected = `${markdown.slice(0, fenceStart)}${markdown.slice(fenceStart + fence.length)}`;
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'windowed-code-recovery-input');
    await waitForSourceExactValue(source, markdown, 'windowed-code-recovery-before');
    const full = await enterFullVisual(page);
    // ADR-002: the synthetic long source stays one unified, fully live surface.
    await expectUnifiedVisualSurface(full.visualEditor, 160);
    const canvas = page.locator('[data-easymde-editor-owner="react"] .easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const before = await waitForVisualPreviewAccepted(
      full.visualEditor,
      'windowed-code-recovery-before'
    );
    // The deleted fence is selected exactly as a browser selects a whole
    // direct-child block, which is the shape the structural owner resolves.
    const selectFence = () => full.visualEditor.locator('pre').first().evaluate(
      (element) => {
        const surface = element.parentElement;
        if (!surface) throw new Error('windowed-code-surface-unavailable');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-code-selection-unavailable');
        const index = Array.prototype.indexOf.call(surface.children, element);
        if (index < 0) throw new Error('windowed-code-index-unavailable');
        surface.focus();
        selection.removeAllRanges();
        selection.setBaseAndExtent(surface, index, surface, index + 1);
      }
    );
    const deletedFence = full.visualEditor.locator('pre').first();
    await expect(deletedFence).toBeVisible();
    await startContextMenuDiagnostics(page, 'windowed-code-recovery');
    try {
      await openVisualMenu(page, full.visualEditor, deletedFence, selectFence);
      await openRootSubmenu(page, 'code-block');
      await expectMenuItemState(page, 'delete-code-block', 'enabled');
      await anyMenuItem(page, 'delete-code-block').last().click();
      await expect(page.locator(menuSelector)).toHaveCount(0);
    } catch (error) {
      const diagnostic = await readContextMenuDiagnostics(
        page,
        'windowed-code-recovery',
        'delete',
        null,
        [],
        { expectedSource: markdown }
      );
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-diagnostic] ${JSON.stringify(diagnostic)}`,
        { cause: error }
      );
    } finally {
      await stopContextMenuDiagnostics(page);
    }
    await waitForSourceExactValue(source, expected, 'windowed-code-recovery-delete');
    const after = await waitForVisualPreviewAccepted(
      full.visualEditor,
      'windowed-code-recovery-delete',
      before.domHash
    );
    await full.visualEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, markdown, 'windowed-code-recovery-undo');
    await waitForVisualPreviewAccepted(
      full.visualEditor,
      'windowed-code-recovery-undo',
      after.domHash
    );
    // Recovery post-conditions: the unified surface stays editable, every
    // top-level block of the long document stays live (ADR-002 retired the
    // Windowed spacers and mount cap), and the menu opens on both the
    // restored area and an unaffected surviving code block.
    const recovery = await full.visualEditor.evaluate((editor) => ({
      blockCount: editor.children.length,
      contentEditable: editor.getAttribute('contenteditable'),
      prosemirrorHost: editor.getAttribute('data-easymde-prosemirror-host'),
      windowSpacers: editor.querySelectorAll(
        '[data-easymde-preview-window-spacer]'
      ).length
    }));
    expect(recovery.contentEditable).toBe('true');
    expect(recovery.prosemirrorHost).toBe('1');
    expect(recovery.blockCount).toBeGreaterThan(160);
    expect(recovery.windowSpacers).toBe(0);
    const restoredFence = full.visualEditor.locator('pre').first();
    await expect(restoredFence).toBeVisible();
    await startContextMenuDiagnostics(page, 'windowed-code-recovery-restored');
    try {
      await openVisualMenu(page, full.visualEditor, restoredFence, selectFence);
      await openRootSubmenu(page, 'code-block');
      await expectMenuItemState(page, 'delete-code-block', 'enabled');
      await closeMenu(
        page,
        'windowed-code-recovery-restored',
        { expectedSource: markdown, keepDiagnostics: true }
      );
    } catch (error) {
      const diagnostic = await readContextMenuDiagnostics(
        page,
        'windowed-code-recovery-restored',
        'restored',
        null,
        [],
        { expectedSource: markdown }
      );
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-diagnostic] ${JSON.stringify(diagnostic)}`,
        { cause: error }
      );
    } finally {
      await stopContextMenuDiagnostics(page);
    }
    const survivingFence = full.visualEditor.locator('pre').last();
    await expect(survivingFence).toBeVisible();
    await startContextMenuDiagnostics(page, 'windowed-code-recovery-surviving');
    try {
      await openVisualMenu(page, full.visualEditor, survivingFence, () => survivingFence.evaluate(
        (element) => {
          const surface = element.parentElement;
          if (!surface) throw new Error('windowed-code-surface-unavailable');
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (!selection) throw new Error('windowed-code-selection-unavailable');
          const index = Array.prototype.indexOf.call(surface.children, element);
          if (index < 0) throw new Error('windowed-code-index-unavailable');
          surface.focus();
          selection.removeAllRanges();
          selection.setBaseAndExtent(surface, index, surface, index + 1);
        }
      ));
      await openRootSubmenu(page, 'code-block');
      await expectMenuItemState(page, 'delete-code-block', 'enabled');
      await closeMenu(
        page,
        'windowed-code-recovery-surviving',
        { expectedSource: markdown, keepDiagnostics: true }
      );
    } catch (error) {
      const diagnostic = await readContextMenuDiagnostics(
        page,
        'windowed-code-recovery-surviving',
        'surviving',
        null,
        [],
        { expectedSource: markdown }
      );
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-diagnostic] ${JSON.stringify(diagnostic)}`,
        { cause: error }
      );
    } finally {
      await stopContextMenuDiagnostics(page);
    }
    await waitForSourceExactValue(source, markdown, 'windowed-code-recovery-final');
  });
});
