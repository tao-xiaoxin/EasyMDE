import { expect, test } from '@playwright/test';
import {
  browserMonitors,
  createPhasedPreviewOperationTracker,
  expectCaretAfterImage,
  expectLiveSelection,
  expectNativeTail,
  expectSource,
  expectWindowedSmokeCheckpoint,
  holdFormalPreview,
  isSubsequence,
  openVisual,
  readPublicEditorState,
  readSettledSource,
  registerVisualEditingHooks
} from '../helpers/visual-editing-helpers.mjs';
import {
  RICH_EMPTY_ROWS,
  RICH_TRAILING_ENDINGS,
  commitRichDeletion,
  commitRichTableDeletion,
  createRichDeletionModel,
  createRichFixtureBuilder,
  expectedRichDeletionStep,
  openWindowedVisual,
  richDeletionObservationMatches,
  richWindowedFixture,
  richWindowedForwardGroups,
  windowedMarkdown
} from '../helpers/visual-rich-fixture-helpers.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

registerVisualEditingHooks();

test('windowed rich starting blocks retain exact source through mixed position history', async ({ page }) => {
  const blocks = [
    '# Heading', '', 'Opening paragraph.', '', '- outer item', '  - inner item', '',
    '> quoted paragraph', '', '[linked words](https://example.com)', '',
    '| left | right |', '| --- | --- |', '| cell | value |', '',
    '~~~python', 'value = 123', '~~~', ''
  ].join('\n');
  const initial = blocks + '\n' + Array.from({ length: 170 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const targets = [
    { selector: 'h1', needle: 'Heading' }, { selector: 'p', needle: 'Opening paragraph.' },
    { selector: 'ul > li', needle: 'outer item' }, { selector: 'blockquote p', needle: 'quoted paragraph' },
    { selector: 'a', needle: 'linked words' }, { selector: 'td', needle: 'cell' }, { selector: 'pre code', needle: 'value = 123' }
  ];
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''],
        [initial],
        ...targets.flatMap(({ needle }) => {
          const sourcePoint = initial.indexOf(needle) + 1;
          const edited = initial.slice(0, sourcePoint) + 'X' + initial.slice(sourcePoint);
          return [[edited], [initial], [edited], [initial]];
        })
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect.poll(async () => await visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  for (const { selector, needle } of targets) {
    const target = visual.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    const point = await target.evaluate(element => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text;
      while (walker.nextNode()) {
        if (walker.currentNode instanceof Text && walker.currentNode.data.trim()) { text = walker.currentNode; break; }
      }
      if (!text) throw new Error('windowed-rich-initial-body-missing');
      const range = element.ownerDocument.createRange(); range.setStart(text, 0); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    const sourcePoint = initial.indexOf(needle) + 1;
    expect(sourcePoint > 0 && initial.indexOf(needle, sourcePoint) === -1).toBe(true);
    const edited = initial.slice(0, sourcePoint) + 'X' + initial.slice(sourcePoint);
    await page.keyboard.type('X');
    expect(failures, `first input ${selector}`).toEqual([]);
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-X`, { selector }, 2);
    await page.keyboard.press('Control+z');
    expect(failures, `undo ${selector}`).toEqual([]);
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Undo`, { selector }, 1);
    await page.keyboard.press('Control+Shift+z');
    expect(failures, `redo ${selector}`).toEqual([]);
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Redo`, { selector }, 2);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    expect(failures, `backspace ${selector}`).toEqual([]);
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Backspace`, { selector }, 1);
    expect(failures, `mixed history ${selector}`).toEqual([]);
  }
  await previewRead.prove({ visual });
});

test('rich windowed document crosses the rendering threshold, empties and restores exactly', async ({ page }) => {
  test.setTimeout(600_000);
  const fixture = richWindowedFixture();
  const { initial } = fixture;
  const deletionModel = createRichDeletionModel(fixture);
  const deletionForward = richWindowedForwardGroups(fixture);
  const deletionReverse = deletionForward.slice().reverse().map((group) => [...group]);
  const emptyGroup = [...RICH_EMPTY_ROWS];
  const typedXGroup = ['X', 'X ', 'X  ', 'X\n', 'X\n\n', ' X', '  X', '\nX', '\n\nX'];
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'delete', groups: deletionForward },
    { id: 'empty-continuation', groups: [emptyGroup, typedXGroup, emptyGroup] },
    { id: 'undo-restore', groups: deletionReverse }
  ]);
  const { failures, source, visual, browserMonitor } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  previewRead.enterPhase('delete');
  // Fail fast: a blocked Backspace must not spin the bounded loop for minutes.
  // Only classified monitor codes are reported; no console text or content.
  const RICH_ZERO_PROGRESS_BACKSPACE_LIMIT = 3;
  let consecutiveZeroProgressBackspaces = 0;
  const expectNoUnapprovedBrowserErrors = (label) => {
    const browserErrors = browserMonitor.summary().issues
      .filter((issue) => /^(?:console-error:|page-error$|unhandled-rejection$)/u.test(issue));
    if (browserErrors.length !== 0) {
      expect(browserErrors, `${label} must not record an unapproved console, page, or rejection error`).toEqual([]);
    }
  };
  let emptied = false;
  let deletionKeys = 0;
  let tableDeleted = false;
  let noSpacerObserved = false;
  let firstNoSpacerAt = null;
  let lastSpacerAt = null;
  let headerCellsEmptied = false;
  let emptyHeaderCellsObserved = false;
  let firstEmptyHeaderAt = null;
  const RICH_BACKSPACE_PACING_MS = 110;
  const pressBackspacePaced = async () => {
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(RICH_BACKSPACE_PACING_MS);
  };
  const readRichStepSnapshot = (checkSpacers, includeTable) => page.evaluate(({ checkSpacers: wantSpacers, includeTable: wantTable }) => {
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const field = document.querySelector('#easymde-source');
    const value = field instanceof HTMLTextAreaElement ? field.value : null;
    const native = getSelection();
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const liveSelection = !!surface
      && !!native?.anchorNode?.isConnected
      && !!native.focusNode?.isConnected
      && surface.contains(native.anchorNode)
      && surface.contains(native.focusNode);
    const contenteditable = surface?.getAttribute('contenteditable') ?? null;
    let position = null;
    if (surface && native && range) {
      let block = native.anchorNode;
      while (block && block.parentNode !== surface) block = block.parentNode;
      if (block && block.parentNode !== surface) block = null;
      let textOffset = native.anchorNode === surface ? 0 : null;
      if (block && native.anchorNode && block.contains(native.anchorNode)) {
        const prefix = surface.ownerDocument.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        textOffset = prefix.toString().length;
      }
      position = {
        connected: liveSelection,
        collapsed: native.isCollapsed === true,
        focused: surface.ownerDocument.activeElement === surface,
        editable: surface.isContentEditable,
        blockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        blockTag: block?.tagName ?? null,
        blockLength: block?.textContent.length ?? null,
        textOffset
      };
    }
    let table = null;
    if (wantTable && value !== null) {
      const tables = surface?.querySelectorAll('table') ?? [];
      if (tables.length === 1) {
        const tableNode = tables[0];
        const lines = [];
        let offset = 0;
        while (offset <= value.length) {
          const next = value.indexOf('\n', offset);
          const end = next < 0 ? value.length : next;
          lines.push({ start: offset, end, text: value.slice(offset, end).replace(/\r$/u, '') });
          if (next < 0) break;
          offset = next + 1;
        }
        const isTableLine = (line) => /^ {0,3}\|/u.test(line.text);
        const cells = (line) => {
          const text = line.text.trim();
          if (!text.startsWith('|') || !text.endsWith('|')) return null;
          return text.slice(1, -1).split('|').map((cell) => cell.trim());
        };
        const blocks = [];
        for (let index = 0; index < lines.length;) {
          if (!isTableLine(lines[index])) { index += 1; continue; }
          let end = index + 1;
          while (end < lines.length && isTableLine(lines[end])) end += 1;
          blocks.push(lines.slice(index, end)); index = end;
        }
        const valid = blocks.filter((block) => block.length >= 3
          && cells(block[0]) && cells(block[1])?.every((cell) => /^:?-+:?$/u.test(cell))
          && block.slice(2).every((line) => cells(line)));
        if (valid.length === 1) {
          const block = valid[0], header = cells(block[0]), dataRows = block.slice(2).map(cells);
          const sourceColumnCount = header.length;
          const sourceRowsValid = block.slice(2).every((line) => cells(line)?.length === sourceColumnCount);
          const sourceCellsAllEmpty = header.every((cell) => cell === '')
            && dataRows.every((row) => row.every((cell) => cell === ''));
          const rows = [...tableNode.rows];
          const headerRows = tableNode.tHead
            ? [...tableNode.tHead.rows]
            : rows.filter((row) => row.cells.length && row.cells[0] instanceof HTMLTableCellElement && row.cells[0].tagName === 'TH');
          const bodyRows = tableNode.tBodies.length
            ? [...tableNode.tBodies].flatMap((body) => [...body.rows])
            : rows.slice(headerRows.length);
          const headerCells = headerRows.flatMap((row) => [...row.cells]);
          const bodyCells = bodyRows.flatMap((row) => [...row.cells]);
          const rowCellCounts = rows.map((row) => row.cells.length);
          const domColumnCount = headerCells.length / Math.max(1, headerRows.length);
          const caretInsideTable = !!range && native?.isCollapsed === true && !!native.anchorNode
            && tableNode.contains(native.anchorNode) && tableNode.contains(native.focusNode);
          const emptyCell = (cell) => cell.textContent.trim() === '';
          table = {
            tableCount: tables.length,
            sourceStart: block[0].start,
            sourceEnd: block.at(-1).end,
            sourceRowCount: block.length,
            sourceColumnCount,
            sourceRowsValid,
            sourceCellsAllEmpty,
            domRowCount: headerRows.length + bodyRows.length,
            domColumnCount,
            domRowCellCounts: rowCellCounts,
            domShapeMatchesSource: headerRows.length === 1 && bodyRows.length === dataRows.length
              && Number.isSafeInteger(domColumnCount)
              && domColumnCount === sourceColumnCount && rowCellCounts.every((count) => count === sourceColumnCount),
            headerCellCount: headerCells.length,
            dataCellCount: bodyCells.length,
            emptyHeaderCellCount: headerCells.filter(emptyCell).length,
            emptyDataCellCount: bodyCells.filter(emptyCell).length,
            emptyHeaderCells: headerCells.length > 0 && headerCells.every(emptyCell),
            emptyDataCells: bodyCells.length > 0 && bodyCells.every(emptyCell),
            cellsAllEmpty: headerCells.length > 0 && bodyCells.length > 0
              && headerCells.every(emptyCell) && bodyCells.every(emptyCell),
            caretInsideTable
          };
        }
      }
    }
    const spacerCount = wantSpacers
      ? (surface?.querySelectorAll('[data-easymde-preview-window-spacer]').length ?? 0)
      : null;
    return { value, position, contenteditable, liveSelection, spacerCount, table };
  }, { checkSpacers, includeTable });
  let currentSnapshot = null;
  for (; deletionKeys < initial.length * 2 + 200; deletionKeys += 1) {
    const beforeSnapshot = currentSnapshot
      ?? await readRichStepSnapshot(false, !tableDeleted);
    const tableBefore = tableDeleted ? null : beforeSnapshot.table;
    if (tableBefore && !tableBefore.sourceRowsValid) throw new Error(`rich-deletion-table-source-invalid:${deletionKeys}`);
    if (tableBefore?.cellsAllEmpty) {
      expect({ sourceCellsAllEmpty: tableBefore.sourceCellsAllEmpty,
        domShapeMatchesSource: tableBefore.domShapeMatchesSource,
        emptyHeaderCells: tableBefore.emptyHeaderCells, emptyDataCells: tableBefore.emptyDataCells,
        caretInsideTable: tableBefore.caretInsideTable }).toEqual({ sourceCellsAllEmpty: true,
        domShapeMatchesSource: true, emptyHeaderCells: true, emptyDataCells: true, caretInsideTable: true });
      const beforeTableDelete = await source.inputValue();
      const tableLocator = visual.locator('table').first();
      await tableLocator.scrollIntoViewIfNeeded();
      await tableLocator.click({ button: 'right' });
      expect((await source.inputValue()) === beforeTableDelete,
        'opening the real table context menu must not change source').toBe(true);
      const tableSubmenu = page.locator('[data-easymde-context-menu-item="table"]').last();
      await expect(tableSubmenu).toBeVisible();
      await tableSubmenu.click();
      const deleteTable = page.locator('[data-easymde-context-menu-item="delete-table"]').last();
      await expect(deleteTable).toBeEnabled();
      await deleteTable.click();
      await page.waitForTimeout(RICH_BACKSPACE_PACING_MS);
      expect(failures, `rich deletion ${deletionKeys} table menu`).toEqual([]);
      expectNoUnapprovedBrowserErrors(`rich deletion ${deletionKeys} table menu`);
      consecutiveZeroProgressBackspaces = 0;
      const afterTableDelete = await source.inputValue();
      const expectedTableDelete = beforeTableDelete.slice(0, tableBefore.sourceStart)
        + beforeTableDelete.slice(tableBefore.sourceEnd);
      expect(afterTableDelete === expectedTableDelete,
        'delete-table must remove exactly the independently identified table interval').toBe(true);
      expect(beforeTableDelete.slice(0, tableBefore.sourceStart)
        === expectedTableDelete.slice(0, tableBefore.sourceStart),
      'delete-table must preserve every byte before the table').toBe(true);
      expect(beforeTableDelete.slice(tableBefore.sourceEnd)
        === expectedTableDelete.slice(tableBefore.sourceStart),
      'delete-table must preserve every byte after the table').toBe(true);
      expect(await visual.locator('table').count()).toBe(0);
      await expectLiveSelection(visual);
      commitRichTableDeletion(deletionModel, afterTableDelete);
      tableDeleted = true;
      currentSnapshot = null;
      continue;
    }
    const step = expectedRichDeletionStep(deletionModel);
    const before = beforeSnapshot.value ?? await source.inputValue();
    const beforePosition = beforeSnapshot.position;
    const beforeMatch = richDeletionObservationMatches(step, { source: before, caret: beforePosition }, 'before');
    if (!beforeMatch.sourceExact || !beforeMatch.caretExact) {
      expect(beforeMatch).toEqual({ sourceExact: true, caretExact: true });
    }
    await pressBackspacePaced();
    if (failures.length !== 0) {
      expect(failures, `rich deletion ${deletionKeys}`).toEqual([]);
    }
    expectNoUnapprovedBrowserErrors(`rich deletion ${deletionKeys}`);
    const checkSpacers = deletionKeys % 16 === 0;
    const afterSnapshot = await readRichStepSnapshot(checkSpacers, !tableDeleted);
    currentSnapshot = afterSnapshot;
    if (afterSnapshot.contenteditable !== 'true' || !afterSnapshot.liveSelection) {
      await expectLiveSelection(visual);
    }
    const value = afterSnapshot.value ?? await source.inputValue();
    const afterPosition = afterSnapshot.position;
    if (value === before) {
      consecutiveZeroProgressBackspaces += 1;
      if (consecutiveZeroProgressBackspaces >= RICH_ZERO_PROGRESS_BACKSPACE_LIMIT) {
        const caretMoved = JSON.stringify(afterPosition) !== JSON.stringify(beforePosition);
        throw new Error(`rich-deletion-zero-progress-backspace-bound:key=${deletionKeys}`
          + `:consecutive=${consecutiveZeroProgressBackspaces}:sourceLength=${value.length}`
          + `:caretMoved=${caretMoved}:blockTag=${afterPosition?.blockTag ?? 'none'}`);
      }
    } else {
      consecutiveZeroProgressBackspaces = 0;
    }
    const afterMatch = richDeletionObservationMatches(step, { source: value, caret: afterPosition }, 'after');
    if (!afterMatch.sourceExact || !afterMatch.caretExact) {
      expect(afterMatch).toEqual({ sourceExact: true, caretExact: true });
    }
    commitRichDeletion(deletionModel, step, value);
    const tableAfter = tableDeleted ? null : afterSnapshot.table;
    if (tableBefore) {
      if (tableAfter === null) {
        expect(tableAfter !== null, `rich deletion ${deletionKeys} must retain the translated table structure`).toBe(true);
      }
      if (tableAfter) {
        const rowsOk = tableAfter.domRowCount === tableBefore.domRowCount;
        const columnsOk = tableAfter.domColumnCount === tableBefore.domColumnCount;
        const rowCellsOk = tableAfter.domRowCellCounts.length === tableBefore.domRowCellCounts.length
          && tableAfter.domRowCellCounts.every((count, index) => count === tableBefore.domRowCellCounts[index]);
        const headerCellsOk = tableAfter.headerCellCount === tableBefore.headerCellCount;
        const dataCellsOk = tableAfter.dataCellCount === tableBefore.dataCellCount;
        const headerEmptinessMonotonic = tableAfter.emptyHeaderCellCount >= tableBefore.emptyHeaderCellCount;
        const dataEmptinessMonotonic = tableAfter.emptyDataCellCount >= tableBefore.emptyDataCellCount;
        const sourceShapeMatches = tableAfter.domShapeMatchesSource && tableAfter.sourceRowsValid;
        if (
          !rowsOk || !columnsOk || !rowCellsOk || !headerCellsOk || !dataCellsOk
          || !headerEmptinessMonotonic || !dataEmptinessMonotonic || !sourceShapeMatches
        ) {
          expect({
            rows: rowsOk, columns: columnsOk, rowCells: rowCellsOk,
            headerCells: headerCellsOk, dataCells: dataCellsOk,
            headerEmptinessMonotonic, dataEmptinessMonotonic, sourceShapeMatches
          }).toEqual({
            rows: true, columns: true, rowCells: true, headerCells: true, dataCells: true,
            headerEmptinessMonotonic: true, dataEmptinessMonotonic: true, sourceShapeMatches: true
          });
        }
        if ((tableBefore.caretInsideTable || tableAfter.cellsAllEmpty) && !tableAfter.caretInsideTable) {
          expect(tableAfter.caretInsideTable,
            `rich deletion ${deletionKeys} must keep the native caret inside the table until whole-table deletion`).toBe(true);
        }
        if (tableAfter.emptyHeaderCellCount > 0) {
          emptyHeaderCellsObserved = true;
          firstEmptyHeaderAt ??= deletionKeys;
        }
        if (tableAfter.emptyHeaderCells) {
          headerCellsEmptied = true;
        }
      }
    }
    if (checkSpacers) {
      const spacerCount = afterSnapshot.spacerCount ?? 0;
      if (spacerCount === 0) {
        noSpacerObserved = true;
        firstNoSpacerAt ??= deletionKeys;
      } else {
        lastSpacerAt = deletionKeys;
      }
    }
    if (/^[^\S\r\n]*\.[^\S\r\n]*$/mu.test(value)) {
      expect(/^[^\S\r\n]*\.[^\S\r\n]*$/mu.test(value),
        `rich deletion ${deletionKeys} must not leave an invisible punctuation row`).toBe(false);
    }
    if (value.trimEnd().length > 9 && !value.startsWith('# Head')) {
      expect(value.startsWith('# Head')).toBe(true);
    }
    if (value.trim() === '') {
      emptied = true;
      deletionKeys += 1;
      break;
    }
  }
  expect(tableDeleted, 'The terminal table is deleted through the real context-menu owner').toBe(true);
  expect(emptied, 'actual Backspace reaches empty document').toBe(true);
  await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const beforeExtraEmptySource = await source.inputValue();
  expect(beforeExtraEmptySource.trim(), 'Deletion must stop at a whitespace-empty representation').toBe('');
  const beforeExtraOwner = await readPublicEditorState(page);
  const beforeExtraEmptyDom = await page.evaluateHandle(() => {
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const p0 = surface?.firstElementChild ?? null;
    return { surface, children: surface ? Array.from(surface.childNodes) : [],
      p0, br: p0?.firstChild instanceof HTMLBRElement ? p0.firstChild : null,
      p0Children: p0 ? Array.from(p0.childNodes) : [] };
  });
  let afterExtraEmptySource;
  let emptyTransition = null;
  try {
    await pressBackspacePaced();
    afterExtraEmptySource = await source.inputValue();
    expect(afterExtraEmptySource.trim(), 'The extra Backspace must leave an empty representation').toBe('');
    expect(failures, 'The extra Backspace must not emit a pageerror').toEqual([]);
    const afterExtraOwner = await readPublicEditorState(page);
    const sourceChangingClear = beforeExtraEmptySource !== afterExtraEmptySource;
    if (sourceChangingClear) {
      expect(beforeExtraEmptySource !== '', 'A source-changing empty clear must start from a non-empty representation').toBe(true);
      expect(afterExtraEmptySource === '', 'A source-changing empty clear must finish at the canonical empty string').toBe(true);
    } else {
      expect(beforeExtraEmptySource === '', 'A source-neutral Backspace must be a true source-zero no-op').toBe(true);
      expect(afterExtraEmptySource === '').toBe(true);
      expect(afterExtraOwner.nativeAnchor, 'A source-zero no-op must not move the native anchor')
        .toEqual(beforeExtraOwner.nativeAnchor);
      expect(afterExtraOwner.nativeFocus, 'A source-zero no-op must not move the native focus')
        .toEqual(beforeExtraOwner.nativeFocus);
    }
    expect({ effectiveEditable: afterExtraOwner.effectiveEditable, nativeConnected: afterExtraOwner.nativeConnected,
      nativeCollapsed: afterExtraOwner.nativeCollapsed, lock: afterExtraOwner.lock,
      session: afterExtraOwner.session }).toMatchObject({ effectiveEditable: true, nativeConnected: true,
      nativeCollapsed: true, lock: 'false', session: 'ready' });
    const emptyState = await visual.evaluate((surface, before) => {
      const native = surface.ownerDocument.getSelection();
      const directChildren = Array.from(surface.childNodes);
      const directParagraphs = Array.from(surface.querySelectorAll(':scope > p'));
      const paragraph = directParagraphs[0] ?? null;
      const directBrs = paragraph ? Array.from(paragraph.querySelectorAll(':scope > br')) : [];
      const br = directBrs[0] ?? null;
      const extraNodeCount = directChildren.filter((node) => node !== paragraph).length
        + (paragraph ? Array.from(paragraph.childNodes).filter((node) => node !== br).length : 0);
      return {
        surfaceSame: surface === before.surface,
        surfaceConnected: surface.isConnected,
        directPCount: directParagraphs.length,
        directBrCount: directBrs.length,
        solePBr: directChildren.length === 1 && directParagraphs.length === 1
          && paragraph?.childNodes.length === 1 && directBrs.length === 1,
        extraNodeCount,
        spacerCount: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
        p0Same: paragraph === before.p0,
        brSame: br === before.br,
        anchorConnected: !!native?.anchorNode?.isConnected,
        focusConnected: !!native?.focusNode?.isConnected,
        inside: !!native?.anchorNode && !!native.focusNode
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        collapsed: native?.isCollapsed ?? false,
        focused: surface.ownerDocument.activeElement === surface,
        contenteditable: surface.getAttribute('contenteditable'),
        effectiveEditable: surface.isContentEditable,
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
        session: surface.ownerDocument.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status'),
        failure: surface.ownerDocument.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null
      };
    }, beforeExtraEmptyDom);
    expect(emptyState).toMatchObject({ surfaceSame: true, surfaceConnected: true,
      directPCount: 1, directBrCount: 1, solePBr: true, extraNodeCount: 0, spacerCount: 0,
      anchorConnected: true, focusConnected: true, inside: true, collapsed: true,
      focused: true, contenteditable: 'true', effectiveEditable: true, lock: 'false', session: 'ready', failure: null });
    if (!sourceChangingClear) expect(emptyState).toMatchObject({ p0Same: true, brSame: true });
    emptyTransition = { sourceChangingClear,
      beforeLength: beforeExtraEmptySource.length, afterLength: afterExtraEmptySource.length,
      beforeWasEmptyString: beforeExtraEmptySource === '', afterWasEmptyString: afterExtraEmptySource === '',
      p0IdentityPreserved: emptyState.p0Same, brIdentityPreserved: emptyState.brSame,
      directPCount: emptyState.directPCount, directBrCount: emptyState.directBrCount,
      solePBr: emptyState.solePBr, extraNodeCount: emptyState.extraNodeCount, spacerCount: emptyState.spacerCount,
      nativeConnected: afterExtraOwner.nativeConnected, nativeCollapsed: afterExtraOwner.nativeCollapsed };
    previewRead.enterPhase('empty-continuation');
    await page.keyboard.type('X');
    await expect.poll(async () => (await source.inputValue()).trim()).toBe('X');
    await page.keyboard.press('Control+z');
    await expectSource(source, afterExtraEmptySource);
    expect(failures, 'Undo after the empty continuation must not emit an error').toEqual([]);
    await expectLiveSelection(visual);
  } finally {
    await beforeExtraEmptyDom.dispose();
  }
  previewRead.enterPhase('undo-restore');
  let restored = false;
  let undoKeys = 0;
  const readRichUndoSnapshot = () => page.evaluate(() => {
    const field = document.querySelector('#easymde-source');
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const native = surface?.ownerDocument.getSelection();
    const liveSelection = !!surface
      && !!native?.anchorNode?.isConnected
      && !!native.focusNode?.isConnected
      && surface.contains(native.anchorNode)
      && surface.contains(native.focusNode);
    return {
      value: field instanceof HTMLTextAreaElement ? field.value : null,
      editable: surface?.getAttribute('contenteditable') === 'true',
      liveSelection
    };
  });
  for (; undoKeys < initial.length * 2 + 200; undoKeys += 1) {
    await page.keyboard.press('Control+z');
    if (failures.length !== 0) {
      expect(failures, `rich restoration ${undoKeys}`).toEqual([]);
    }
    const undoSnapshot = await readRichUndoSnapshot();
    if (!undoSnapshot.editable || !undoSnapshot.liveSelection) {
      await expectLiveSelection(visual);
    }
    const undoValue = undoSnapshot.value ?? await source.inputValue();
    if (undoValue === initial) {
      restored = true;
      undoKeys += 1;
      break;
    }
  }
  expect(restored, 'all Markdown is restored without source assignment').toBe(true);
  await previewRead.prove({ visual });
  await test.info().attach('windowed-threshold-history', {
    body: JSON.stringify({ deletionKeys, undoKeys, noSpacerObserved, firstNoSpacerAt, lastSpacerAt,
      emptyHeaderCellsObserved, headerCellsEmptied, firstEmptyHeaderAt,
      emptyTransition, postExtraUndoExact: true, exactRestoration: restored }),
    contentType: 'application/json'
  });
});

for (const imageKind of ['inline', 'linked', 'reference']) {
for (const timing of imageKind === 'inline' ? ['ready', 'held', 'rapid'] : ['ready', 'held']) {
test(`windowed ${imageKind} image deletion after a terminal diagram preserves structural semantics (${timing} Preview)`, async ({ page }) => {
  test.setTimeout(45_000);
  const holdPreview = timing !== 'ready';
  const { initial, image } = richWindowedFixture(imageKind);
  const { failures, source, visual } = await openVisual(page, initial);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  const held = [];
  const handlerFailures = [];
  let releasingPreview = false;
  const isAborted = (entry) => entry.aborted || entry.request.failure()?.errorText === 'net::ERR_ABORTED';
  const onRequestFailed = (request) => {
    const entry = held.find((candidate) => candidate.request === request);
    if (entry && request.failure()?.errorText === 'net::ERR_ABORTED') {
      browserMonitors.get(page)?.expectPreviewCancellation(request, 'supersede');
      entry.aborted = true;
      entry.release();
    }
  };
  page.on('requestfailed', onRequestFailed);
  if (holdPreview) {
    await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
      if (releasingPreview) return route.continue();
      const request = route.request();
      const payload = request.postDataJSON();
      if (typeof payload.markdown !== 'string' || payload.markdown.includes('```mermaid')) return route.continue();
      if (held.length >= 4) {
        handlerFailures.push('image-preview-read-bound-exceeded');
        return route.abort('aborted');
      }
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const entry = { request, markdown: payload.markdown, ready: false, aborted: false, release };
      held.push(entry);
      try {
        const response = await route.fetch({ timeout: 10_000, maxRetries: 0, maxRedirects: 0 });
        if (response.status() !== 200) throw new Error('image-preview-php-failed');
        entry.ready = true;
        await gate;
        if (isAborted(entry)) await route.abort('aborted');
        else await route.fulfill({ response });
      } catch {
        if (!isAborted(entry)) handlerFailures.push('image-preview-handler-failed');
        try { await route.abort('aborted'); }
        catch { if (!isAborted(entry)) handlerFailures.push('image-preview-abort-failed'); }
      }
    });
  }
  if (timing === 'rapid') {
    await visual.evaluate((surface) => {
      let deletions = 0;
      surface.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'deleteContentBackward' || ++deletions !== 2) return;
        const image = surface.querySelector('img[alt="dot"]');
        const native = surface.ownerDocument.getSelection();
        window.__rapidImageCaret = {
          imageMounted: !!image?.isConnected,
          parentEnd: !!image?.parentNode && native?.anchorNode === image.parentNode
            && native.anchorOffset === Array.from(image.parentNode.childNodes).indexOf(image) + 1,
          collapsed: native?.isCollapsed ?? false,
          focused: surface.ownerDocument.activeElement === surface
        };
      }, { capture: true });
    });
  }
  try {
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    const afterDiagram = timing === 'rapid'
      ? initial.slice(0, initial.lastIndexOf('\n```mermaid\n'))
      : await source.inputValue();
    expect(initial.slice(0, afterDiagram.length) === afterDiagram).toBe(true);
    expect(!afterDiagram.includes('```mermaid') && afterDiagram.includes(image)).toBe(true);
    if (timing === 'held') {
      await expect.poll(() => held.some((entry) => entry.ready && !isAborted(entry)
        && entry.markdown === afterDiagram), { timeout: 12_000 }).toBe(true);
    } else if (timing === 'ready') {
      await expect(visual.locator('.easymde-mermaid')).toHaveCount(0);
      await expect(visual).toHaveAttribute('data-easymde-preview-phase', 'ready');
    }
    if (timing !== 'rapid') await expectCaretAfterImage(visual, 'dot');
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    if (timing === 'rapid') {
      expect(await page.evaluate(() => window.__rapidImageCaret ?? null),
        'the immediately following key must start at the correct mounted image edge').toEqual({
        imageMounted: true, parentEnd: true, collapsed: true, focused: true
      });
    }
    expect(await source.inputValue() === afterDiagram.replace(image, ''),
      'the image node must be removed as a whole without editing hidden syntax').toBe(true);
    await expectLiveSelection(visual);
  } finally {
    releasingPreview = true;
    for (const entry of held) entry.release();
    if (holdPreview) await page.unrouteAll({ behavior: 'wait' });
    page.off('requestfailed', onRequestFailed);
    expect(handlerFailures).toEqual([]);
  }
});
}
}

for (const size of ['full', 'windowed']) {
for (const timing of ['normal', 'held']) {
test(`${size} reference image preserves its source while neighboring text is edited (${timing} Preview)`, async ({ page }) => {
  test.setTimeout(60_000);
  const definition = '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png\n\n';
  const paragraph = 'Opening ![dot][pic] tail.';
  const initial = definition + paragraph + '\n\n'
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const withX = initial.replace(paragraph, `${paragraph}X`);
  const minus1 = initial.replace(paragraph, paragraph.slice(0, -1));
  const minus2 = initial.replace(paragraph, paragraph.slice(0, -2));
  const continued = initial.replace(paragraph, `${paragraph.slice(0, -2)}Q`);
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], [withX], [initial], [withX], [initial],
        [minus1], [minus2], [continued], [minus2], [continued]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const previewGate = timing === 'held' ? await holdFormalPreview(page) : null;
  let previewGateClosed = false;
  try {
  const row = visual.locator('p').filter({ has: page.locator('img[alt="dot"]') });
  await row.click();
  expect(failures, 'reference-image pointer selection must succeed before editing').toEqual([]);
  await page.keyboard.press('End');
  expect(failures, 'reference-image End selection must succeed before editing').toEqual([]);
  const nativeBeforeInput = await row.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    const trailing = element.lastChild;
    return {
      anchorIsRow: selection?.anchorNode === element,
      anchorIsTrailingText: selection?.anchorNode === trailing && trailing instanceof Text,
      anchorOffset: selection?.anchorOffset ?? -1,
      trailingLength: trailing instanceof Text ? trailing.length : -1,
      collapsed: selection?.isCollapsed ?? false,
      focused: element.ownerDocument.activeElement?.contains(element) ?? false
    };
  });
  await page.keyboard.type('X');
  if (failures.length) console.log(JSON.stringify({ phase: 'reference-neighbor-native-point', size, ...nativeBeforeInput }));
  expect(failures).toEqual([]);
  await expectSource(source, initial.replace(paragraph, `${paragraph}X`));
  await page.keyboard.press('Control+z');
  expect(failures, 'reference-neighbor Undo must remain usable').toEqual([]);
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+z');
  expect(failures, 'reference-neighbor Redo must remain usable').toEqual([]);
  await expectSource(source, initial.replace(paragraph, `${paragraph}X`));
  if (previewGate) {
    await previewGate.waitFor(initial.replace(paragraph, `${paragraph}X`));
    await expect(visual).toHaveAttribute('data-easymde-preview-phase', 'loading');
  }
  await page.keyboard.press('Backspace');
  expect(failures, 'reference-neighbor Backspace immediately after Redo must succeed').toEqual([]);
  await expectSource(source, initial);
  await expectNativeTail(row, ' tail.');
  for (const removed of [1, 2]) {
    await page.keyboard.press('Backspace');
    expect(failures, `continued reference-neighbor Backspace ${removed}`).toEqual([]);
    await expectSource(source, initial.replace(paragraph, paragraph.slice(0, -removed)));
    await expectNativeTail(row, ' tail.'.slice(0, -removed));
  }
  await page.keyboard.type('Q');
  await expectSource(source, continued);
  await page.keyboard.press('Control+z');
  await expectSource(source, minus2);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  if (previewGate) { await previewGate.close(); previewGateClosed = true; }
  await previewRead.prove({ visual });
  } finally { if (previewGate && !previewGateClosed) await previewGate.close(); }
});
}
}

for (const size of ['full', 'windowed']) {
test(`${size} Unicode reference resolution deletes only the formally rendered image and preserves history`, async ({ page }) => {
  const asset = '/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';
  const image = '![y][Stra\u00dfe]';
  const initial = `[a\u00a0b]: ${asset}#ghost\n\n[STRASSE]: ${asset}\n\n![x][a b] ${image}\n\n`
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const removed = initial.replace(image, '');
  const expected = initial.replace(image, `${image}X`);
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [removed], [initial], [expected]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('img')).toHaveCount(1);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const row = visual.locator('p').filter({ has: page.locator('img[alt="y"]') });
  await row.click();
  expect(failures, 'Unicode reference-image pointer selection must succeed before editing').toEqual([]);
  await page.keyboard.press('End');
  expect(failures, 'Unicode reference-image End selection must succeed before editing').toEqual([]);
  await expectCaretAfterImage(visual, 'y');
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expectSource(source, initial.replace(image, ''));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  // Full restores its DOM with the source; Windowed mounts the image again from
  // the pending Preview, so its caret proof is the immediate key's exact offset.
  if (size === 'full') await expectCaretAfterImage(visual, 'y');
  await page.keyboard.type('X');
  try { await expectSource(source, expected); }
  catch (error) {
    const actual = await source.inputValue();
    let firstMismatch = 0;
    while (firstMismatch < Math.min(actual.length, expected.length) && actual[firstMismatch] === expected[firstMismatch]) firstMismatch += 1;
    console.log(JSON.stringify({ phase: 'unicode-image-post-undo-input-mismatch', size,
      actualLength: actual.length, expectedLength: expected.length, firstMismatch,
      actualTypedOffset: actual.indexOf('X'), expectedTypedOffset: initial.indexOf(image) + image.length }));
    throw error;
  }
  await expect(visual.locator('img[alt="y"]')).toHaveCount(1);
  await expect(visual.locator('p').filter({ has: page.locator('img[alt="y"]') })).toContainText('X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
}

for (const size of ['full', 'windowed']) {
test(`${size} repeated rendered images delete the native target reference rather than an identical neighbor`, async ({ page }) => {
  const asset = '/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';
  const target = '![dot][second]';
  const initial = `[first]: ${asset}\n\n[second]: ${asset}\n\n![dot][first] ${target}\n\n`
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const removed = initial.replace(target, '');
  const continued = initial.replace(target, `${target}X`);
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [removed], [initial], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('img')).toHaveCount(2);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  await visual.locator('img').nth(1).click();
  expect(failures, 'second-image pointer selection must succeed').toEqual([]);
  await page.keyboard.press('End');
  expect(failures, 'second-image End selection must succeed').toEqual([]);
  await expectCaretAfterImage(visual, 'dot', 1);
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expectSource(source, initial.replace(target, ''));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  if (size === 'full') await expectCaretAfterImage(visual, 'dot', 1);
  // Do not click after Undo. The exact insertion proves history restored the
  // second reference's caret, including when its Windowed DOM is still pending.
  await page.keyboard.type('X');
  await expectSource(source, continued);
  await expect(visual.locator('img')).toHaveCount(2);
  await expect(visual.locator('p').filter({ has: page.locator('img') })).toContainText('X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
}

test('windowed document deletes rapidly at its end and keeps editing', async ({ page }) => {
  test.setTimeout(300_000);
  const tail = 'Tail one.\n\nTail two.\n\nTail three.\n\n';
  const initial = windowedMarkdown(tail);
  const rapidBuilder = createRichFixtureBuilder();
  rapidBuilder.block('paragraph', 'Head.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  for (let index = 0; index < 170; index += 1) {
    rapidBuilder.block('paragraph', `Filler ${index + 1}.`, 'P', { deletion: 'ascii-grapheme', plainText: true });
    rapidBuilder.separator();
  }
  rapidBuilder.block('paragraph', 'Tail one.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  rapidBuilder.block('paragraph', 'Tail two.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  rapidBuilder.block('paragraph', 'Tail three.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  const rapidFixture = rapidBuilder.build();
  const rapidForward = richWindowedForwardGroups(rapidFixture);
  const rapidReverse = rapidForward.slice().reverse().map((group) => [...group]);
  const rapidAllDeleteStates = [...new Set(rapidForward.flat())];
  const rapidWithZStates = [...new Set(rapidAllDeleteStates.flatMap((candidate) => {
    const trimmed = candidate.trimEnd();
    const withoutTrailingNewlines = candidate.replace(/\n+$/u, '');
    return [
      candidate + 'Z',
      ...RICH_TRAILING_ENDINGS.map((ending) => `${trimmed}Z${ending}`),
      ...RICH_TRAILING_ENDINGS.map((ending) => `${withoutTrailingNewlines}Z${ending}`)
    ];
  }))];
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'rapid-delete', groups: rapidForward },
    { id: 'type-z-and-undo', groups: [rapidAllDeleteStates, rapidWithZStates, rapidAllDeleteStates] },
    { id: 'undo-restore', groups: [rapidWithZStates, ...rapidReverse] }
  ]);
  const { failures, source, visual } = await openWindowedVisual(
    page,
    tail,
    previewRead.beforeFixture
  );
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  // Real state, not a timeout: the document end is now the mounted window.
  await expect(visual.locator('p').filter({ hasText: 'Tail three.' })).toBeVisible();
  previewRead.enterPhase('rapid-delete');
  for (let step = 0; step < 100; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `rapid deletion ${step}`).toEqual([]);
  }
  // Wait for the whole rapid burst to be translated into canonical Markdown.
  const after = await readSettledSource(source, 12);
  expect(failures, 'rapid end deletion').toEqual([]);
  // Deletions happen at the end of the last visible line; canonical trailing
  // blank lines and block separators are not content and may stay behind.
  expect(initial.trimEnd().startsWith(after.trimEnd())).toBe(true);
  const deleted = initial.trimEnd().length - after.trimEnd().length;
  expect(deleted).toBeGreaterThanOrEqual(90);
  await expectLiveSelection(visual);
  previewRead.enterPhase('type-z-and-undo');
  await page.keyboard.type('Z');
  await expect.poll(async () => (await source.inputValue()).trimEnd())
    .toBe(`${after.trimEnd()}Z`);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => await source.inputValue()).toBe(after);
  await expectLiveSelection(visual);
  previewRead.enterPhase('undo-restore');
  let restored = false;
  for (let step = 0; step < 140; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `rapid restoration ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await source.inputValue() === initial) {
      restored = true;
      break;
    }
  }
  expect(restored, 'rapid windowed deletion restores exact source').toBe(true);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

test('windowed document deletes stepwise at its end with undo restoring it', async ({ page }) => {
  test.setTimeout(300_000);
  const initial = windowedMarkdown('Tail one.\n\nTail two.\n\nTail three.\n\n');
  const { failures, source, visual } = await openWindowedVisual(
    page,
    'Tail one.\n\nTail two.\n\nTail three.\n\n'
  );
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('p').filter({ hasText: 'Tail three.' })).toBeVisible();
  let previous = initial;
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `windowed delete ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    const current = await readSettledSource(source);
    // Every deletion happens at the end of the visible line. Canonical
    // trailing blank lines and paragraph separators can stay behind, and a
    // renderer-only empty paragraph retires without source bytes, so compare
    // the content without its trailing blank lines. The document head must
    // stay intact: a caret jump would delete from the article start instead.
    expect(current.startsWith('Head.\n\nFiller 1.'), `windowed delete ${step}`).toBe(true);
    expect(previous.trimEnd().startsWith(current.trimEnd()), `windowed delete ${step}`).toBe(true);
    previous = current;
  }
  expect(initial.trimEnd().length - previous.trimEnd().length).toBeGreaterThanOrEqual(20);
  let restored = false;
  for (let step = 0; step < 50; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `windowed undo ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await readSettledSource(source) === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  await visual.locator('p').filter({ hasText: 'Tail three.' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Q');
  await expect.poll(async () => (await source.inputValue()).trimEnd(), { timeout: 15_000 })
    .toBe(`${initial.trimEnd()}Q`);
  expect(failures).toEqual([]);
});

test('windowed document deletes a trailing code fence and stays editable', async ({ page }) => {
  test.setTimeout(300_000);
  const tail = 'Tail.\n\n~~~bash\necho hi\n~~~\n\nEnd.\n\n';
  const initial = windowedMarkdown(tail);
  const { failures, source, visual } = await openWindowedVisual(page, tail);
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('p').filter({ hasText: 'End.' })).toBeVisible();
  let previous = initial;
  for (let step = 0; step < 26; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `fence delete ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    const current = await readSettledSource(source);
    // The caret leaves the raw document end while deleting a fence: the code
    // body's text is removed before its closing line. Every settled result is
    // still the previous Markdown with one contiguous range deleted.
    expect(isSubsequence(current, previous), `fence delete ${step}`).toBe(true);
    expect(current.startsWith('Head.\n\nFiller 1.'), `fence delete ${step}`).toBe(true);
    previous = current;
  }
  expect(previous.includes('echo hi')).toBe(false);
  // Settle the last translation fully before typing at the live caret.
  previous = await readSettledSource(source, 12);
  await page.keyboard.type('X');
  // The caret sits after the last visible character, which may itself be a
  // trailing space the Markdown line keeps. Exactly one character was
  // inserted, no existing content was rewritten.
  await expect.poll(async () => {
    const current = await source.inputValue();
    const before = previous.trimEnd();
    const after = current.trimEnd();
    return after.length === before.length + 1
      && after.includes('X')
      && isSubsequence(before, after)
      && isSubsequence(after.replace('X', ''), before);
  }).toBe(true);
  await expectLiveSelection(visual);
  let fenceRestored = false;
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `fence undo ${step}`).toEqual([]);
    if (await readSettledSource(source) === initial) {
      fenceRestored = true;
      break;
    }
  }
  expect(fenceRestored).toBe(true);
  expect(failures).toEqual([]);
});

test('windowed mixed document crosses block boundaries while deleting and stays editable', async ({ page }) => {
  test.setTimeout(300_000);
  const mixedBuilder = createRichFixtureBuilder();
  mixedBuilder.block('paragraph', 'Head.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  mixedBuilder.separator();
  for (let index = 0; index < 170; index += 1) {
    mixedBuilder.block('paragraph', `Filler ${index + 1}.`, 'P', { deletion: 'ascii-grapheme', plainText: true });
    mixedBuilder.separator();
  }
  mixedBuilder.block('heading', '## Tail heading', 'H2', { deletion: 'known-heading', headingPrefix: '## ' });
  mixedBuilder.separator();
  mixedBuilder.block('list', '- outer\n  - inner\n  - inner two', 'UL', { deletion: 'known-list' });
  mixedBuilder.separator();
  mixedBuilder.block('quote', '> quoted tail line', 'BLOCKQUOTE', { deletion: 'known-quote', quotePrefix: '> ' });
  mixedBuilder.separator();
  mixedBuilder.block('code', '```js\nconst tailValue = 1;\n```', 'PRE', { deletion: 'known-code-fence' });
  mixedBuilder.separator();
  mixedBuilder.block('table', '| left | right |\n| --- | --- |\n| a | b |', 'TABLE', { deletion: 'known-table-menu' });
  mixedBuilder.separator();
  mixedBuilder.block('mixed-paragraph',
    'MATHMIX $x^2$ [link](https://example.com) ![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png).',
    'P', { deletion: 'known-mixed-paragraph' });
  mixedBuilder.separator();
  mixedBuilder.block('atom', '~~~mermaid\ngraph TD\n  A --> B\n~~~', 'DIV', { deletion: 'known-whole-atom', atom: 'mermaid' });
  mixedBuilder.separator('\n');
  const mixedFixture = mixedBuilder.build();
  const tail = [
    '## Tail heading',
    '',
    '- outer',
    '  - inner',
    '  - inner two',
    '',
    '> quoted tail line',
    '',
    '```js',
    'const tailValue = 1;',
    '```',
    '',
    '| left | right |',
    '| --- | --- |',
    '| a | b |',
    '',
    'MATHMIX $x^2$ [link](https://example.com) ![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png).',
    '',
    '~~~mermaid',
    'graph TD',
    '  A --> B',
    '~~~',
    ''
  ].join('\n');
  const initial = windowedMarkdown(tail);
  expect(mixedFixture.initial === initial).toBe(true);
  const mixedGroupsByLength = new Map();
  const addMixedState = (candidate) => {
    const key = candidate.trimEnd().length;
    let bucket = mixedGroupsByLength.get(key);
    if (!bucket) {
      bucket = new Set();
      mixedGroupsByLength.set(key, bucket);
    }
    bucket.add(candidate);
  };
  for (const group of richWindowedForwardGroups(mixedFixture)) {
    for (const candidate of group) addMixedState(candidate);
  }
  for (let length = initial.length; length >= 0; length -= 1) {
    const raw = initial.slice(0, length);
    for (const ending of RICH_TRAILING_ENDINGS) addMixedState(raw + ending);
  }
  const mixedForward = [...mixedGroupsByLength.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, bucket]) => [...bucket]);
  const mixedReverse = mixedForward.slice().reverse().map((group) => [...group]);
  const mixedDeleteStates = [...new Set(mixedForward.flat())];
  const mixedWithZStates = [...new Set(mixedDeleteStates.flatMap((candidate) => {
    const trimmed = candidate.trimEnd();
    const variants = [
      candidate + 'Z',
      ...RICH_TRAILING_ENDINGS.map((ending) => `${trimmed}Z${ending}`)
    ];
    const tableMatch = trimmed.match(/(\|[^\n]*\|\n\| --- \| --- \|\n\|[^\n]*\|)$/u);
    if (tableMatch) {
      const tablePrefix = trimmed.slice(0, trimmed.length - tableMatch[1].length);
      const [headLine, dividerLine, bodyLine] = tableMatch[1].split('\n');
      const withCellZ = (line) => {
        const cells = line.slice(1, -1).split('|');
        const nextLines = [];
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
          const value = cells[cellIndex].trim();
          const replacements = value === '' ? [' Z ', ' Z', 'Z ', 'Z'] : [` ${value}Z `];
          for (const replacement of replacements) {
            const updated = [...cells];
            updated[cellIndex] = replacement;
            nextLines.push(`|${updated.join('|')}|`);
          }
        }
        return nextLines;
      };
      for (const nextHead of withCellZ(headLine)) {
        for (const ending of RICH_TRAILING_ENDINGS) {
          variants.push(`${tablePrefix}${nextHead}\n${dividerLine}\n${bodyLine}${ending}`);
        }
      }
      for (const nextBody of withCellZ(bodyLine)) {
        for (const ending of RICH_TRAILING_ENDINGS) {
          variants.push(`${tablePrefix}${headLine}\n${dividerLine}\n${nextBody}${ending}`);
        }
      }
    }
    if (trimmed.endsWith('\n```')) {
      const bodyPrefix = trimmed.slice(0, -4);
      for (const ending of RICH_TRAILING_ENDINGS) {
        variants.push(`${bodyPrefix}Z\n\`\`\`${ending}`);
      }
    }
    return variants;
  }))];
  const headingQ = initial.replace('## Tail heading', '## Tail headingQ');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'mixed-delete', groups: mixedForward },
    { id: 'type-z', groups: [mixedDeleteStates, mixedWithZStates] },
    { id: 'undo-restore', groups: [mixedWithZStates, ...mixedReverse] },
    { id: 'heading-q', groups: [[initial], [headingQ]] }
  ]);
  const { failures, source, visual } = await openWindowedVisual(page, tail, previewRead.beforeFixture);
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  // Real state, not a timeout: the document end is now the mounted window and
  // the owner has presented the caret after the trailing atomic block.
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  await expect.poll(() => visual.evaluate((surface) => {
    const selection = surface.ownerDocument.getSelection();
    return surface.lastElementChild?.nodeName === 'P'
      && selection?.anchorNode === surface.lastElementChild;
  })).toBe(true);
  expect(failures, 'mixed document opened').toEqual([]);
  previewRead.enterPhase('mixed-delete');
  for (let step = 0; step < 150; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `mixed delete ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  const after = await readSettledSource(source, 12);
  expect(failures, 'mixed deletion settled').toEqual([]);
  expect(initial.trimEnd().startsWith(after.trimEnd())).toBe(true);
  expect(after.startsWith('Head.\n\nFiller 1.')).toBe(true);
  // The deletion crossed the mermaid fence and the paragraph after the table.
  expect(after.includes('A --> B')).toBe(false);
  expect(after.includes('MATHMIX')).toBe(false);
  await expectLiveSelection(visual);
  previewRead.enterPhase('type-z');
  await page.keyboard.type('Z');
  await expect.poll(async () => {
    const current = (await source.inputValue()).trimEnd();
    const before = after.trimEnd();
    return current.length === before.length + 1
      && current.includes('Z')
      && isSubsequence(before, current)
      && isSubsequence(current.replace('Z', ''), before);
  }, { timeout: 15_000 }).toBe(true);
  expect(failures, 'mixed typing').toEqual([]);
  previewRead.enterPhase('undo-restore');
  let restored = false;
  for (let step = 0; step < 200; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `mixed undo ${step}`).toEqual([]);
    if (await readSettledSource(source) === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  previewRead.enterPhase('heading-q');
  await visual.locator('h2').filter({ hasText: 'Tail heading' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('Q');
  await expect.poll(async () => (await source.inputValue()).includes('## Tail headingQ'),
    { timeout: 15_000 }).toBe(true);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
