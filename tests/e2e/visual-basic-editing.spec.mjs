import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

const firstRuntimeFailureObservations = new WeakMap();

test.afterEach(async ({ page }, result) => {
  if (result.status === result.expectedStatus || page.isClosed()) return;
  const firstRuntimeFailure = firstRuntimeFailureObservations.get(page);
  if (firstRuntimeFailure) console.log(JSON.stringify(await firstRuntimeFailure));
  const states = await page.evaluate(() => window.__easymdeTestEditabilityStates ?? []);
  await result.attach('editability-transitions', {
    body: JSON.stringify(states),
    contentType: 'application/json'
  });
  const firstFailure = await page.evaluate(() => {
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const native = document.getSelection();
    const input = document.querySelector('.easymde-source-react .cm-content');
    // Read only the installed CodeMirror view's scalar selection. Tile is the
    // current version's DOM link used by EditorView.findFromDOM().
    const canonical = input?.cmTile?.root?.view?.state?.selection?.main;
    const point = (node, offset) => ({
      connected: !!node?.isConnected,
      inside: !!node && !!surface?.contains(node),
      nodeType: node?.nodeType ?? null,
      parentTag: node?.parentElement?.tagName ?? null,
      offset,
      textLength: node instanceof Text ? node.length : null
    });
    return {
      phase: 'first-browser-failure-state',
      sourceLength: document.querySelector('#easymde-source')?.value.length ?? null,
      nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? null),
      nativeFocus: point(native?.focusNode, native?.focusOffset ?? null),
      nativeCollapsed: native?.isCollapsed ?? null,
      parkedCodeMirrorSelection: canonical ? { anchor: canonical.anchor, head: canonical.head } : null,
      editable: surface?.getAttribute('contenteditable') ?? null,
      effectiveEditable: surface?.isContentEditable ?? null,
      locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
      session: document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') ?? null,
      previewPhase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
      busy: surface?.getAttribute('aria-busy') ?? null
    };
  });
  console.log(JSON.stringify(firstFailure));
});

function environment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test environment: ${name}`);
  return value;
}

async function expectSource(source, expected) {
  await expect.poll(async () => await source.inputValue() === expected, {
    message: 'Canonical Markdown must match exactly; document content is not logged'
  }).toBe(true);
}

async function readCurrentDocumentOwner(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#easymde-editor-root');
    const keys = root ? Object.getOwnPropertyNames(root).filter((key) => key.startsWith('__reactContainer$')) : [];
    if (keys.length !== 1) throw new Error('test-document-owner-root-unavailable');
    const current = root[keys[0]]?.stateNode?.current;
    if (current?.tag !== 3) throw new Error('test-document-owner-current-unavailable');
    const owners = new Set();
    const pending = current.child ? [current.child] : [];
    let visited = 0;
    while (pending.length) {
      const fiber = pending.pop();
      if (++visited > 8192) throw new Error('test-document-owner-traversal-bound');
      const props = fiber.memoizedProps;
      for (const owner of [props?.documentSession?.document, props?.ordinaryStatus?.document]) {
        if (owner) owners.add(owner);
      }
      if (fiber.sibling) pending.push(fiber.sibling);
      if (fiber.child) pending.push(fiber.child);
    }
    if (owners.size !== 1) throw new Error('test-document-owner-identity-unavailable');
    const owner = owners.values().next().value;
    for (const name of ['getSelection', 'getHistoryState', 'getRevision', 'isEditable', 'getInputElement']) {
      if (typeof owner[name] !== 'function') throw new Error('test-document-owner-getter-unavailable');
    }
    const selection = owner.getSelection();
    const history = owner.getHistoryState();
    return {
      selection: { start: selection.start, end: selection.end, direction: selection.direction },
      history: { undoDepth: history.undoDepth, redoDepth: history.redoDepth },
      revision: owner.getRevision(),
      editable: owner.isEditable(),
      sourceInputConnected: owner.getInputElement().isConnected
    };
  });
}

async function readFullCrossBlockState(visual, expected = {}) {
  return visual.evaluate((surface, target) => {
    const root = surface.ownerDocument.querySelector('#easymde-editor-root');
    const keys = root ? Object.getOwnPropertyNames(root).filter((key) => key.startsWith('__reactContainer$')) : [];
    if (keys.length !== 1) throw new Error('test-full-reader-root-unavailable');
    const current = root[keys[0]]?.stateNode?.current;
    if (current?.tag !== 3) throw new Error('test-full-reader-current-unavailable');
    const fibers = [];
    const owners = new Set();
    const pending = current.child ? [current.child] : [];
    while (pending.length) {
      if (fibers.length >= 8192) throw new Error('test-full-reader-traversal-bound');
      const fiber = pending.pop(); fibers.push(fiber);
      const props = fiber.memoizedProps;
      for (const owner of [props?.documentSession?.document, props?.ordinaryStatus?.document]) if (owner) owners.add(owner);
      if (fiber.child) pending.push(fiber.child);
      if (fiber.sibling) pending.push(fiber.sibling);
    }
    if (owners.size !== 1) throw new Error('test-full-reader-document-identity-unavailable');
    const documentOwner = owners.values().next().value;
    const fullFibers = fibers.filter(({ memoizedProps: props }) => props?.surface === surface
      && props.documentSession?.document === documentOwner
      && ['requestPreview', 'retainCompositionSurface', 'onReady'].every((key) => typeof props[key] === 'function'));
    if (fullFibers.length !== 1) throw new Error('test-full-reader-fiber-identity-unavailable');
    const refs = [];
    let hooks = 0;
    for (let hook = fullFibers[0].memoizedState; hook; hook = hook.next) {
      if (++hooks > 512) throw new Error('test-full-reader-hook-bound');
      const value = hook.memoizedState;
      if (value && Object.hasOwn(value, 'current')) refs.push(value.current);
    }
    const isOwned = (value) => value && typeof value.owner === 'object' && value.owner !== null
      && typeof value.source === 'string' && typeof value.visual === 'string'
      && Number.isInteger(value.sourceRevision) && Array.isArray(value.nodes) && Array.isArray(value.metadata)
      && value.nodes.length === value.metadata.length;
    const ownedValues = [...new Set(refs.filter(isOwned))];
    if (ownedValues.length !== 1) throw new Error('test-full-reader-owned-identity-unavailable');
    const owned = ownedValues[0];
    if (refs.filter((value) => value === owned.owner).length !== 1) throw new Error('test-full-reader-owner-token-unavailable');
    const transfers = [...new Set(refs.filter((value) => value
      && ['requesting', 'rendering'].includes(value.phase)
      && ['history', 'native', 'paste'].includes(value.spec?.kind)
      && ['plain', 'structural'].includes(value.spec?.presentation)
      && ['accepted-preview', 'paste-boundary', 'source'].includes(value.spec?.placement?.kind)
      && typeof value.spec?.expectation?.value === 'string' && value.spec.expectation.selection
      && Number.isInteger(value.previousPreview?.revision) && typeof value.previousPreview?.signature === 'string'
      && typeof value.signature === 'string' && Object.hasOwn(value, 'visualSelection')))];
    const transferCandidates = [...new Set(refs.filter((value) => value && value.spec && Object.hasOwn(value, 'phase')))];
    if (transferCandidates.length !== transfers.length) throw new Error('test-full-reader-transfer-shape-unavailable');
    if (transfers.length > 1) throw new Error('test-full-reader-transfer-identity-ambiguous');
    const transfer = transfers[0] ?? null;
    const native = surface.ownerDocument.getSelection();
    const path = (node) => {
      const result = [];
      for (let currentNode = node; currentNode && currentNode !== surface;) {
        const parent = currentNode.parentNode;
        if (!parent) return null;
        const index = [...parent.childNodes].filter((child) => child === currentNode || !(child instanceof Text && child.data === '')).indexOf(currentNode);
        if (index < 0) return null;
        result.unshift(index); currentNode = parent;
        if (currentNode === surface) return result;
      }
      return node === surface ? [] : null;
    };
    const sameBoundary = (node, offset, boundary) => {
      const actual = path(node);
      return !!actual && !!boundary && offset === boundary.offset
        && actual.length === boundary.path.length && actual.every((part, index) => part === boundary.path[index]);
    };
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const backward = !!native && !native.isCollapsed && !!range
      && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
    const nativeMatchesLease = !!transfer?.visualSelection && !!range
      && sameBoundary(native.anchorNode, native.anchorOffset, transfer.visualSelection.anchor)
      && sameBoundary(native.focusNode, native.focusOffset, transfer.visualSelection.focus)
      && backward === transfer.visualSelection.backward;
    const selection = documentOwner.getSelection();
    const history = documentOwner.getHistoryState();
    const revision = documentOwner.getRevision();
    const sameSelection = (left, right) => !!right && left.start === right.start && left.end === right.end && left.direction === right.direction;
    const expectation = transfer?.spec.expectation;
    const canonicalExact = !!expectation && expectation.value === documentOwner.getValue()
      && sameSelection(selection, expectation.selection)
      && (expectation.revision === undefined || expectation.revision === revision)
      && (!expectation.history || expectation.history.undoDepth === history.undoDepth && expectation.history.redoDepth === history.redoDepth);
    const retained = transfer?.spec.retainedHistoryPresentation;
    const retainedCurrent = !!retained && retained.owned === owned && Array.isArray(retained.readOnly)
      && refs.filter((value) => value === retained.readOnly).length === 1;
    const rows = [...surface.querySelectorAll(':scope > p')];
    const first = rows.find((row) => row.textContent?.startsWith('alpha'));
    const last = target.selected ? rows.find((row) => row.textContent?.startsWith('Yz')) : first;
    const endpoint = (node, offset, row, textOffset) => {
      if (!node?.isConnected || !row?.contains(node)) return false;
      const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(row); prefix.setEnd(node, offset);
      return prefix.toString().length === textOffset;
    };
    const reverse = target.selected && target.direction === 'backward';
    const listItems = target.list ? [...surface.querySelectorAll('li')] : [];
    const listElement = native?.anchorNode instanceof Element ? native.anchorNode : native?.anchorNode?.parentElement;
    const listItem = target.list ? listElement?.closest('li') : null;
    let listBodyOffset = null;
    if (listItem && surface.contains(listItem) && native?.anchorNode) {
      const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(listItem);
      prefix.setEnd(native.anchorNode, native.anchorOffset); listBodyOffset = prefix.toString().length;
    }
    const inlineCodePoint = (node, offset) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const code = element?.closest('code');
      if (!code || code.closest('pre') || !surface.contains(code) || !node?.isConnected) return null;
      const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(code); prefix.setEnd(node, offset);
      const codes = [...surface.querySelectorAll('code')].filter((candidate) => !candidate.closest('pre'));
      return { bodyOffset: prefix.toString().length, bodyLength: code.textContent.length, codeIndex: codes.indexOf(code) };
    };
    return {
      phase: transfer?.phase ?? 'ready', transferKind: transfer?.spec.kind ?? null,
      pendingCount: transfers.length, ownedCount: ownedValues.length, fullFiberCount: fullFibers.length,
      retainedCurrent, nativeMatchesLease, canonicalExact,
      ...(target.ownerProof ? {
        leaseExpectation: expectation ? { sourceLength: expectation.value.length,
          selection: { start: expectation.selection.start, end: expectation.selection.end, direction: expectation.selection.direction },
          revision: expectation.revision ?? null,
          history: expectation.history ? { undoDepth: expectation.history.undoDepth, redoDepth: expectation.history.redoDepth } : null } : null,
        ownerProof: { retainedPresent: !!retained, retainedOwnedEqCurrent: !!retained && retained.owned === owned,
          retainedOwnerEqCurrentToken: !!retained && retained.owned?.owner === owned.owner,
          retainedReadOnlyIsArray: !!retained && Array.isArray(retained.readOnly),
          readOnlyDirectRefCount: retained ? refs.filter((value) => value === retained.readOnly).length : null,
          ownedTopLevelNodesExact: owned.nodes.length === surface.childNodes.length
            && owned.nodes.every((node, index) => surface.childNodes[index] === node) },
        nativeEndpoints: {
          anchor: { path: path(native?.anchorNode), offset: native?.anchorOffset ?? null,
            nodeType: native?.anchorNode?.nodeType ?? null, tag: native?.anchorNode?.parentElement?.tagName ?? null },
          focus: { path: path(native?.focusNode), offset: native?.focusOffset ?? null,
            nodeType: native?.focusNode?.nodeType ?? null, tag: native?.focusNode?.parentElement?.tagName ?? null }
        }
      } : {}),
      expectedDocumentSelection: target.committed ? sameSelection(selection, target.committed) : null,
      documentSelection: { start: selection.start, end: selection.end, direction: selection.direction },
      documentHistory: { undoDepth: history.undoDepth, redoDepth: history.redoDepth }, documentRevision: revision,
      ...(target.paragraph ? { nativeParagraph: (() => {
        const element = native?.anchorNode instanceof Element ? native.anchorNode : native?.anchorNode?.parentElement;
        const paragraph = element?.closest('p');
        if (!paragraph || !surface.contains(paragraph) || !native?.anchorNode) return null;
        const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(paragraph);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        return { index: [...surface.querySelectorAll('p')].indexOf(paragraph),
          bodyOffset: prefix.toString().length, bodyLength: paragraph.textContent.length };
      })() } : {}),
      ...(target.inlineCode ? { nativeInlineCode: {
        anchor: inlineCodePoint(native?.anchorNode, native?.anchorOffset),
        focus: inlineCodePoint(native?.focusNode, native?.focusOffset)
      } } : {}),
      ...(target.list ? { nativeList: {
        itemCount: listItems.length, itemIndex: listItem ? listItems.indexOf(listItem) : null,
        bodyOffset: listBodyOffset, itemChildCount: listItem?.childNodes.length ?? null,
        itemChildren: listItem ? [...listItem.childNodes].map((node) => ({ nodeType: node.nodeType,
          tag: node instanceof Element ? node.tagName : null, textLength: node instanceof Text ? node.length : null })) : []
      } } : {}),
      anchorMatches: endpoint(native?.anchorNode, native?.anchorOffset, reverse ? last : first, reverse ? 1 : target.offset),
      focusMatches: endpoint(native?.focusNode, native?.focusOffset, reverse ? first : last,
        target.selected ? reverse ? target.offset : 1 : target.offset),
      direction: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
      collapsed: native?.isCollapsed ?? null,
      nativeConnected: !!native?.anchorNode?.isConnected && !!native.focusNode?.isConnected
        && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
      focused: surface.ownerDocument.activeElement === surface, editable: surface.isContentEditable && documentOwner.isEditable(),
      lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
      session: surface.ownerDocument.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status'),
      previewPhase: surface.getAttribute('data-easymde-preview-phase'), busy: surface.getAttribute('aria-busy')
    };
  }, expected);
}

// These four initial Windowed cases are bounded source/history smoke tests.
// A pending native representation is observed, never certified by Full rules.
async function readWindowedSmokeState(visual, target = {}) {
  return visual.evaluate((surface, expected) => {
    const root = surface.ownerDocument.querySelector('#easymde-editor-root');
    const keys = root ? Object.getOwnPropertyNames(root).filter(key => key.startsWith('__reactContainer$')) : [];
    if (keys.length !== 1) throw new Error('test-windowed-reader-root-unavailable');
    const current = root[keys[0]]?.stateNode?.current;
    if (current?.tag !== 3) throw new Error('test-windowed-reader-current-unavailable');
    const pending = current.child ? [current.child] : []; const fibers = []; const owners = new Set();
    while (pending.length) {
      if (fibers.length >= 8192) throw new Error('test-windowed-reader-traversal-bound');
      const fiber = pending.pop(); fibers.push(fiber); const props = fiber.memoizedProps;
      for (const owner of [props?.documentSession?.document, props?.ordinaryStatus?.document]) if (owner) owners.add(owner);
      if (fiber.child) pending.push(fiber.child); if (fiber.sibling) pending.push(fiber.sibling);
    }
    if (owners.size !== 1) throw new Error('test-windowed-reader-document-not-unique');
    const owner = owners.values().next().value;
    const windowed = fibers.filter(({memoizedProps: props}) => props?.surface === surface && props.documentSession?.document === owner
      && props.editMap?.version === 1 && ['getAcceptedWindowSnapshot','getAcceptedWindowRow','requestPreviewAtDocumentEnd',
        'prepareWindowBlockAdoption'].every(key => typeof props[key] === 'function'));
    if (windowed.length !== 1) throw new Error('test-windowed-reader-controller-not-unique');
    const sourceField = surface.ownerDocument.querySelector('#easymde-source');
    const editorRoots = fibers.filter(({memoizedProps: props}) => props?.submissionField === sourceField
      && typeof props.nativePublishPort?.read === 'function' && typeof props.immersiveStrings?.previewEditorLabel === 'string');
    if (editorRoots.length !== 1) throw new Error('test-windowed-reader-editor-root-not-unique');
    const runtimes = new Set(); let hooks = 0;
    for (let hook = editorRoots[0].memoizedState; hook; hook = hook.next) {
      if (++hooks > 512) throw new Error('test-windowed-reader-hook-bound');
      const value = hook.memoizedState;
      const runtime = value && Object.hasOwn(value, 'current') ? value.current : null;
      if (runtime?.surface === surface && ['isEditable','isTransferPending','executeCommand','prepareContextMenuDemand']
        .every(key => typeof runtime[key] === 'function')) runtimes.add(runtime);
    }
    if (runtimes.size !== 1) throw new Error('test-windowed-reader-runtime-not-unique');
    const runtime = runtimes.values().next().value;
    const native = surface.ownerDocument.getSelection(); const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const backward = !!native && !native.isCollapsed && !!range
      && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
    const point = (node, offset, selector, index) => {
      const target = selector ? surface.querySelectorAll(selector)[index ?? 0] : null;
      const code = expected.codeBoundary ? surface.querySelector('p code') : null;
      const previous = code?.previousSibling;
      let codeBodyOffset = null;
      if (node && code?.contains(node)) {
        const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(code); prefix.setEnd(node, offset);
        codeBodyOffset = prefix.toString().length;
      }
      let bodyOffset = null;
      if (node && target?.contains(node)) {
        const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(target); prefix.setEnd(node, offset);
        bodyOffset = prefix.toString().length;
      }
      return { connected: !!node?.isConnected, inside: !!node && surface.contains(node), nodeType: node?.nodeType ?? null,
        parentTag: node?.parentElement?.tagName ?? null, offset, targetContains: !!node && !!target?.contains(node),
        targetTag: target?.tagName ?? null, bodyOffset, bodyLength: target?.textContent.length ?? null,
        ...(expected.codeBoundary ? { inlineCode: { codePresent: !!code?.isConnected,
          insideCode: !!node && !!code?.contains(node), codeBodyOffset,
          sameOriginalCodeText: expected.originalCodeText ? node === expected.originalCodeText : null,
          isBeforeCodeText: node instanceof Text && node === previous,
          beforeCodeTextOffset: node === previous ? offset : null } } : {}) };
    };
    const selection = owner.getSelection(), history = owner.getHistoryState();
    const runtimePending = runtime.isTransferPending();
    return { phase: surface.getAttribute('data-easymde-preview-phase'), runtimePending,
      pendingNativeAuthentication: runtimePending ? 'unverified-windowed-dom-lease' : 'not-pending',
      runtimeEditable: runtime.isEditable(), documentEditable: owner.isEditable(),
      documentSelection: { start: selection.start, end: selection.end, direction: selection.direction },
      documentHistory: { undoDepth: history.undoDepth, redoDepth: history.redoDepth }, revision: owner.getRevision(),
      ...(expected.expectedSource === undefined ? {} : { sourceMatchesExpected: owner.getValue() === expected.expectedSource }),
      sourceLength: owner.getValue().length, windowedControllerCount: windowed.length, runtimeCount: runtimes.size,
      spacers: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
      effectiveEditable: surface.isContentEditable, contenteditable: surface.getAttribute('contenteditable'),
      lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
      session: surface.ownerDocument.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status'),
      focused: surface.ownerDocument.activeElement === surface, nativeCollapsed: native?.isCollapsed ?? null,
      nativeDirection: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
      nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? 0, expected.selector, expected.index),
      nativeFocus: point(native?.focusNode, native?.focusOffset ?? 0, expected.focusSelector ?? expected.selector, expected.focusIndex ?? expected.index)
    };
  }, target);
}

async function expectWindowedSmokeCheckpoint(visual, failures, stage, expectedSelection, target, nativeOffset, direction = 'none') {
  const state = await readWindowedSmokeState(visual, target);
  console.log(JSON.stringify({ phase: 'windowed-smoke-first-atom', stage, expectedSelection, state }));
  expect(failures).toEqual([]);
  expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
    contenteditable: 'true', lock: 'false', session: 'ready', focused: true,
    windowedControllerCount: 1, runtimeCount: 1, nativeAnchor: { connected: true, inside: true },
    nativeFocus: { connected: true, inside: true } });
  expect(state.spacers).toBeGreaterThan(0);
  if (target.expectedSource !== undefined) expect(state.sourceMatchesExpected).toBe(true);
  if (expectedSelection) expect(state.documentSelection).toEqual(expectedSelection);
  if (!state.runtimePending) expect(state).toMatchObject({ nativeDirection: direction, nativeCollapsed: direction === 'none',
    nativeAnchor: { targetContains: true, bodyOffset: nativeOffset },
    nativeFocus: { targetContains: true, bodyOffset: target.focusOffset ?? nativeOffset } });
  return state;
}

async function holdFormalPreview(page) {
  const entries = [];
  const errors = [];
  let releasing = false;
  const aborted = (entry) => entry.request.failure()?.errorText === 'net::ERR_ABORTED';
  const onFailure = (request) => {
    const entry = entries.find((candidate) => candidate.request === request);
    if (entry && aborted(entry)) entry.release();
  };
  page.on('requestfailed', onFailure);
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    if (releasing) return route.continue();
    if (entries.length >= 8) {
      errors.push('held-history-preview-bound-exceeded');
      return route.abort('aborted');
    }
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const entry = { request: route.request(), markdown: route.request().postDataJSON().markdown, fetched: false, release };
    entries.push(entry);
    try {
      const response = await route.fetch({ timeout: 10_000, maxRetries: 0, maxRedirects: 0 });
      if (response.status() !== 200) throw new Error('held-history-php-preview-failed');
      entry.fetched = true;
      await gate;
      if (aborted(entry)) await route.abort('aborted');
      else await route.fulfill({ response });
    } catch {
      if (!aborted(entry)) errors.push('held-history-preview-handler-failed');
      try { await route.abort('aborted'); }
      catch { if (!aborted(entry)) errors.push('held-history-preview-abort-failed'); }
    }
  });
  return {
    waitFor: async (markdown) => expect.poll(() => entries.some((entry) => entry.fetched
      && !aborted(entry) && entry.markdown === markdown), {
      timeout: 12_000, message: 'The real current PHP response must remain withheld'
    }).toBe(true),
    close: async () => {
      releasing = true;
      for (const entry of entries) entry.release();
      await page.unrouteAll({ behavior: 'wait' });
      page.off('requestfailed', onFailure);
      expect(errors).toEqual([]);
    }
  };
}

async function expectNativeTail(row, expected) {
  const state = await row.evaluate((element, tailText) => {
    const tail = element.lastChild;
    const selection = element.ownerDocument.getSelection();
    let atEnd = false;
    if (tail instanceof Text && selection?.isCollapsed && selection.anchorNode
      && element.contains(selection.anchorNode)) {
      const end = element.ownerDocument.createRange();
      end.setStart(tail, tail.length);
      end.collapse(true);
      const caret = element.ownerDocument.createRange();
      caret.setStart(selection.anchorNode, selection.anchorOffset);
      caret.collapse(true);
      const corridor = element.ownerDocument.createRange();
      const first = end.compareBoundaryPoints(Range.START_TO_START, caret) <= 0 ? end : caret;
      const last = first === end ? caret : end;
      corridor.setStart(first.startContainer, first.startOffset);
      corridor.setEnd(last.startContainer, last.startOffset);
      const fragment = corridor.cloneContents();
      atEnd = corridor.toString().length === 0
        && !fragment.querySelector('img,br,pre,table,svg,math,[contenteditable="false"]');
    }
    return { tailMatches: tail instanceof Text && tail.data === tailText, atEnd,
      collapsed: selection?.isCollapsed ?? false,
      focused: element.ownerDocument.activeElement?.contains(element) ?? false };
  }, expected);
  expect(state, 'Visible text and the native caret must follow each completed deletion').toEqual({
    tailMatches: true, atEnd: true, collapsed: true, focused: true
  });
}

async function openVisual(page, markdown, pasteFrom) {
  const failures = [];
  const recordFirstFailure = (code) => {
    if (firstRuntimeFailureObservations.has(page)) return;
    // Observe only the first runtime failure. This is the first Playwright
    // observation after the event, not a claim about an earlier DOM state.
    const observation = (async () => {
      const surface = await page.$('[data-easymde-preview-html-sink][role="textbox"]');
      if (!surface) throw new Error('test-first-refusal-surface-unavailable');
      try {
        const windowed = await surface.evaluate(node => !!node.querySelector('[data-easymde-preview-window-spacer]'));
        return windowed ? await readWindowedSmokeState(surface) : await readFullCrossBlockState(surface, { ownerProof: true });
      }
      finally { await surface.dispose(); }
    })()
      .then(state => ({ phase: 'first-refusal-observation', code, state }))
      .catch(() => ({ phase: 'first-refusal-observation-unavailable', code }));
    firstRuntimeFailureObservations.set(page, observation);
  };
  await page.exposeFunction('__easymdeReportRejection', () => {
    recordFirstFailure('browser-unhandled-rejection'); failures.push('browser-unhandled-rejection');
  });
  page.on('pageerror', () => { recordFirstFailure('browser-page-error'); failures.push('browser-page-error'); });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const code = text.match(/\[EasyMDE\]\s+([a-z0-9-]+)/u)?.[1];
    if (code) {
      if (failures.length === 0) console.log(JSON.stringify({ phase: 'editor-first-refusal', code }));
      recordFirstFailure(code);
      // This owner emits only the reviewed scalar refusal payload. Forward it
      // on failure without adding reads or observers to successful keystrokes.
      failures.push(code);
    } else if (text.startsWith('Failed to load resource:')) {
      const location = message.location().url;
      if (location.includes('/easymde/v1/') || location.includes('rest_route=%2Feasymde')
        || location.includes('/wp-content/plugins/') || location.includes('/admin-ajax.php')) {
        failures.push('editor-resource-load-failed');
      } else {
        console.log(JSON.stringify({ phase: 'browser-network-noise', category: 'unrelated-resource' }));
      }
    } else {
      failures.push('uncategorized-browser-console-error');
    }
  });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', () => { void window.__easymdeReportRejection(); });
    const states = [];
    window.__easymdeTestEditabilityStates = states;
    let previous = '';
    const sample = () => {
      const preview = document.querySelector('.easymde-pane-preview');
      if (!preview) return;
      const state = {
        editableSurfaces: preview.querySelectorAll('[contenteditable="true"]').length,
        locked: preview.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        failure: preview.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null
      };
      const identity = JSON.stringify(state);
      if (identity === previous) return;
      previous = identity;
      if (states.length === 256) states.shift();
      states.push({ ...state, elapsedMs: Math.round(performance.now()) });
    };
    const observer = new MutationObserver(sample);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['contenteditable', 'aria-pressed', 'data-easymde-visual-failure']
    });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  });
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(environment('WORDPRESS_ADMIN_USER'));
  await page.locator('#user_pass').fill(environment('WORDPRESS_ADMIN_PASSWORD'));
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();
  await page.goto('/wp-admin/post-new.php');
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  await expect(sourceEditor).toBeVisible();
  const runtimeBuilds = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname.split('/').at(-1))
    .filter((name) => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
  await test.info().attach('loaded-editor-build', { body: JSON.stringify(runtimeBuilds), contentType: 'application/json' });
  console.log(JSON.stringify({ phase: 'loaded-editor-build', files: runtimeBuilds }));
  const expectedBuild = process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD;
  if (expectedBuild) expect(runtimeBuilds, 'The browser must load the frozen production build').toEqual([expectedBuild]);
  await sourceEditor.click();
  // Fixture preparation only. All subsequent edits use keyboard/mouse actions.
  if (pasteFrom === undefined) {
    await page.keyboard.insertText(markdown);
  } else {
    // Fixture preparation only, through the real paste route: CRLF text is put
    // on the clipboard and pasted with the keyboard. The assertion below then
    // states the normalisation contract for that route (the browser hands the
    // editor the LF form), so a CRLF fixture can never be asserted verbatim.
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasteFrom);
    await page.keyboard.press('Control+v');
  }
  const source = page.locator('#easymde-source');
  await expectSource(source, markdown);
  const strings = await page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.strings.immersive
  );
  await page.getByRole('button', { name: strings.enter, exact: true }).click();
  await page.getByRole('button', { name: strings.preview, exact: true }).last().click();
  await expect(page.getByText(strings.previewContentLoaded)).toBeVisible();
  await page.getByRole('button', { name: strings.previewUnlockEdit, exact: true }).click();
  const visual = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(visual).toHaveAttribute('contenteditable', 'true');
  return { failures, source, visual };
}

async function readSettledSource(source, stableReads = 6) {
  let value = await source.inputValue();
  let stable = 0;
  for (let attempt = 0; attempt < 200 && stable < stableReads; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await source.inputValue();
    if (next === value) {
      stable += 1;
    } else {
      value = next;
      stable = 0;
    }
  }
  if (stable < stableReads) throw new Error('canonical-source-did-not-settle');
  return value;
}

function isSubsequence(candidate, source) {
  let index = 0;
  for (const character of source) {
    if (character === candidate[index]) index += 1;
    if (index === candidate.length) return true;
  }
  return index === candidate.length;
}

async function expectLiveSelection(visual) {
  await expect(visual).toHaveAttribute('contenteditable', 'true');
  expect(await visual.evaluate((surface) => {
    const selection = surface.ownerDocument.getSelection();
    return !!selection?.anchorNode?.isConnected
      && !!selection.focusNode?.isConnected
      && surface.contains(selection.anchorNode)
      && surface.contains(selection.focusNode);
  })).toBe(true);
}

async function expectCaretAfterImage(visual, alt, ordinal = 0) {
  const state = await visual.evaluate((surface, target) => {
    const image = Array.from(surface.querySelectorAll('img')).filter((candidate) => candidate.alt === target.alt)[target.ordinal];
    const native = surface.ownerDocument.getSelection();
    const root = (node) => {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element && element.parentElement !== surface) element = element.parentElement;
      return element;
    };
    const sameRow = !!image && root(image) === root(native?.anchorNode);
    let afterImage = false;
    if (image?.parentNode && native?.anchorNode && sameRow) {
      const edge = surface.ownerDocument.createRange();
      edge.setStart(image.parentNode, Array.from(image.parentNode.childNodes).indexOf(image) + 1);
      edge.collapse(true);
      const point = surface.ownerDocument.createRange();
      point.setStart(native.anchorNode, native.anchorOffset);
      point.collapse(true);
      const corridor = surface.ownerDocument.createRange();
      if (edge.compareBoundaryPoints(Range.START_TO_START, point) <= 0) {
        corridor.setStart(edge.startContainer, edge.startOffset);
        corridor.setEnd(point.startContainer, point.startOffset);
      } else {
        corridor.setStart(point.startContainer, point.startOffset);
        corridor.setEnd(edge.startContainer, edge.startOffset);
      }
      const fragment = corridor.cloneContents();
      afterImage = corridor.toString().length === 0
        && !fragment.querySelector('img,br,hr,pre,table,svg,math,[contenteditable="false"]');
    }
    return {
      imageMounted: !!image?.isConnected,
      sameRow,
      afterImage,
      nativeVoid: native?.anchorNode instanceof HTMLImageElement,
      collapsed: native?.isCollapsed ?? false,
      focused: surface.ownerDocument.activeElement === surface
    };
  }, { alt, ordinal });
  expect(state, 'native caret must remain at the canonical image-row end while Preview is pending').toEqual({
    imageMounted: true, sameRow: true, afterImage: true,
    nativeVoid: false, collapsed: true, focused: true
  });
}

test('nonempty paragraph join keeps source, selection and immediate undo editing consistent', async ({ page }) => {
  const initial = 'alpha\n\nbeta';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').last().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  // Force the normal history owner to flush pending input without a preview wait.
  await page.keyboard.press('Control+z');
  expect(failures).toEqual([]);
  await expectSource(source, initial);
  await expectLiveSelection(visual);
  await page.keyboard.type('X');
  await expectSource(source, 'alpha\n\nXbeta');
  expect(failures).toEqual([]);
});

for (const boundary of [
  { paragraphs: 2, text: 'Second.', source: 'Before.\n\nSecond' },
  { paragraphs: 1, text: 'Before.', source: 'Before' }
]) {
test(`first character deletion after empty join ${boundary.paragraphs} reaches canonical source`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, 'Before.\n\nSecond.\n\nTailXX');
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  let joined = false;
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    if (await visual.locator('p').count() === boundary.paragraphs
      && await visual.locator('p').last().textContent() === boundary.text) {
      joined = true;
      break;
    }
  }
  expect(joined).toBe(true);
  expect(await visual.locator('p').last().evaluate((paragraph) => {
    const selection = getSelection();
    if (!selection?.isCollapsed || !paragraph.contains(selection.anchorNode)) return false;
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(selection.anchorNode, selection.anchorOffset);
    return prefix.toString().length === paragraph.textContent.length;
  })).toBe(true);
  // The native end caret is already correct. No click, focus repair or Preview wait.
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expect(visual.locator('p').last()).toHaveText(boundary.text.slice(0, -1));
  await expect.poll(async () => (await source.inputValue()).trimEnd() === boundary.source).toBe(true);
  await expectLiveSelection(visual);
});
}

test('short mixed document can be deleted characterwise and restored by keyboard history', async ({ page }) => {
  const initial = '中文 abc aaa \\*文字\\*\n\n# Heading\n\nTarget paragraph here.\n\n~~~bash\necho hi\n~~~\n\nEnd.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  for (let step = 0; step < initial.length + 8; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `delete operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expect(visual).toHaveText('');
  await expect.poll(async () => (await source.inputValue()).trim().length).toBe(0);
  const emptySource = await source.inputValue();
  let restored = false;
  let undoSteps = 0;
  for (let step = 0; step < initial.length + 8; step += 1) {
    await page.keyboard.press('Control+z');
    undoSteps += 1;
    expect(failures, `undo operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await source.inputValue() === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  for (let step = 0; step < undoSteps; step += 1) {
    await page.keyboard.press('Control+Shift+z');
    expect(failures, `redo operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expectSource(source, emptySource);
  await page.keyboard.type('X');
  await expect.poll(async () => (await source.inputValue()).trim()).toBe('X');
  await page.keyboard.press('Control+z');
  await expectSource(source, emptySource);
  for (let step = 0; step < undoSteps; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `restoration operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expectSource(source, initial);
  await visual.locator('p').filter({ hasText: 'Target paragraph here.' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('X');
  await expectSource(source, initial.replace('Target paragraph here.', 'XTarget paragraph here.'));
  expect(failures).toEqual([]);
});

test('deleted-to-empty document accepts Enter continuation and restores exact history', async ({ page }) => {
  const initial = 'abc\n\n';
  const legalEmpty = '\n\n';
  const { failures, source, visual } = await openVisual(page, initial);
  let operationStage = 'delete-to-empty'; let latestAtom = null;
  const checkpoint = async (expected, caret, paragraphIndex, bodyOffset, bodyLength, ready = false) => {
    expect(failures).toEqual([]); await expectSource(source, expected);
    const state = await readFullCrossBlockState(visual, { paragraph: true, ownerProof: true,
      committed: { start: caret, end: caret, direction: 'none' } });
    latestAtom = { operationStage, expectedLength: expected.length, expectedCaret: caret, state };
    console.log(JSON.stringify({ phase: 'empty-Enter-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ nativeConnected: true, focused: true, editable: true, lock: 'false',
      session: 'ready', expectedDocumentSelection: true });
    if (ready || state.phase === 'ready') expect(state).toMatchObject({ phase: 'ready', collapsed: true,
      nativeParagraph: { index: paragraphIndex, bodyOffset, bodyLength } });
    else expect(state).toMatchObject({ phase: 'rendering', pendingCount: 1, retainedCurrent: true,
      nativeMatchesLease: true, canonicalExact: true });
    expect(failures).toEqual([]); return state;
  };
  const acceptedEmptyRepresentation = (value) => value === '' || value === legalEmpty;
  const readAcceptedEmpty = async () => {
    await expect.poll(async () => acceptedEmptyRepresentation(await source.inputValue())).toBe(true);
    const canonical = await source.inputValue();
    expect(canonical.trim().length, 'Empty representation must contain no document text').toBe(0);
    const owner = await readCurrentDocumentOwner(page);
    const state = await readFullCrossBlockState(visual, { paragraph: true, ownerProof: true,
      committed: { start: 0, end: 0, direction: 'none' } });
    latestAtom = { operationStage, canonicalLength: canonical.length, state, owner };
    expect(state).toMatchObject({ nativeConnected: true, collapsed: true, focused: true, editable: true,
      lock: 'false', session: 'ready', previewPhase: 'ready', busy: 'false', expectedDocumentSelection: true });
    expect(state.nativeEndpoints.anchor.nodeType, 'A valid native caret must have a connected anchor').not.toBeNull();
    expect(state.nativeEndpoints.focus.nodeType, 'A valid native caret must have a connected focus').not.toBeNull();
    if (state.nativeParagraph) expect(state.nativeParagraph.bodyOffset).toBe(state.nativeParagraph.bodyLength);
    expect(owner.editable).toBe(true);
    await expect(visual).toHaveAttribute('contenteditable', 'true');
    expect(failures).toEqual([]);
    return { canonical, owner, state };
  };
  try {
    await visual.locator('p').last().click(); await page.keyboard.press('Control+End');
    for (const [remaining, caret] of [['ab\n\n', 2], ['a\n\n', 1], [legalEmpty, 0]]) {
      await page.keyboard.press('Backspace'); await checkpoint(remaining, caret, 0, caret, caret);
    }
    operationStage = 'extra-empty-Backspace';
    const beforeExtraCanonical = await source.inputValue();
    const beforeExtraOwner = await readCurrentDocumentOwner(page);
    expect(beforeExtraCanonical).toBe(legalEmpty);
    await page.keyboard.press('Backspace');
    let acceptedEmpty = await readAcceptedEmpty();
    console.log(JSON.stringify({ phase: 'empty-representation-contract', press: 'first-extra-Backspace',
      beforeCanonical: beforeExtraCanonical, afterCanonical: acceptedEmpty.canonical,
      beforeHistory: beforeExtraOwner.history, afterHistory: acceptedEmpty.owner.history,
      beforeRevision: beforeExtraOwner.revision, afterRevision: acceptedEmpty.owner.revision,
      state: acceptedEmpty.state }));
    const zeroLengthBackspaceIssued = acceptedEmpty.canonical === '';
    if (zeroLengthBackspaceIssued) {
      operationStage = 'extra-empty-at-zero-Backspace';
      const beforeZeroOwner = acceptedEmpty.owner;
      const beforeZeroDom = await page.evaluateHandle(() => {
        const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
        const p0 = surface?.firstElementChild ?? null;
        return { surface, children: surface ? Array.from(surface.childNodes) : [],
          p0Tag: p0?.tagName ?? null, p0Children: p0 ? Array.from(p0.childNodes) : [] };
      });
      try {
        await page.keyboard.press('Backspace');
        const afterZero = await readAcceptedEmpty();
        expect(afterZero.canonical, 'Backspace at the zero-length empty representation must be an exact no-op').toBe('');
        expect(afterZero.owner.history, 'Backspace at zero length must not change history').toEqual(beforeZeroOwner.history);
        expect(afterZero.owner.revision, 'Backspace at zero length must not change revision').toBe(beforeZeroOwner.revision);
        expect(afterZero.owner.selection, 'Backspace at zero length must not move the document selection').toEqual(beforeZeroOwner.selection);
        expect(failures, 'Backspace at zero length must not emit a pageerror').toEqual([]);
        const sameDom = await page.evaluate((before) => {
          const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
          const p0 = surface?.firstElementChild ?? null;
          return { surface: !!surface && surface === before.surface && surface.isConnected,
            children: !!surface && surface.childNodes.length === before.children.length
              && Array.from(surface.childNodes).every((node, index) => node === before.children[index]),
            p0Tag: before.p0Tag === 'P' && p0?.tagName === 'P',
            p0Children: !!p0 && p0.childNodes.length === before.p0Children.length
              && Array.from(p0.childNodes).every((node, index) => node === before.p0Children[index]) };
        }, beforeZeroDom);
        expect(sameDom, 'Backspace at zero length must preserve the accepted P/BR DOM identities').toEqual({
          surface: true, children: true, p0Tag: true, p0Children: true
        });
        console.log(JSON.stringify({ phase: 'empty-representation-contract', press: 'zero-length-Backspace',
          beforeCanonical: acceptedEmpty.canonical, afterCanonical: afterZero.canonical,
          beforeHistory: beforeZeroOwner.history, afterHistory: afterZero.owner.history,
          beforeRevision: beforeZeroOwner.revision, afterRevision: afterZero.owner.revision,
          domIdentity: sameDom, state: afterZero.state }));
        acceptedEmpty = afterZero;
      } finally {
        await beforeZeroDom.dispose();
      }
    }
    const emptyRepresentation = acceptedEmpty.canonical;
    const typed = `Z${emptyRepresentation}`;
    const entered = `Z\n\n  ${emptyRepresentation}`;
    const continued = `Z\n\nXY${emptyRepresentation}`;
    const shortened = `Z\n\nX${emptyRepresentation}`;
    const branch = `Z\n\nXYB${emptyRepresentation}`;
    operationStage = 'empty-input-Z'; await page.keyboard.type('Z'); await checkpoint(typed, 1, 0, 1, 1);
    operationStage = 'Enter-after-Z'; await page.keyboard.press('Enter'); await checkpoint(entered, 3, 1, 0, 0);
    operationStage = 'immediate-XY'; await page.keyboard.type('XY'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'Backspace-Y'; await page.keyboard.press('Backspace'); await checkpoint(shortened, 4, 1, 1, 1);
    operationStage = 'EOF-Delete-noop';
    const beforeNoop = await readCurrentDocumentOwner(page);
    await page.keyboard.press('Delete'); await checkpoint(shortened, 4, 1, 1, 1);
    const afterNoop = await readCurrentDocumentOwner(page);
    expect(afterNoop.history).toEqual(beforeNoop.history); expect(afterNoop.revision).toBe(beforeNoop.revision);
    operationStage = 'Undo-Backspace-Y'; await page.keyboard.press('Control+z'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'Redo-Backspace-Y'; await page.keyboard.press('Control+Shift+z'); await checkpoint(shortened, 4, 1, 1, 1);
    operationStage = 'Undo-before-branch'; await page.keyboard.press('Control+z'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'branch-B'; await page.keyboard.type('B');
    const branched = await checkpoint(branch, 6, 1, 3, 3); expect(branched.documentHistory.redoDepth).toBe(0);
    operationStage = 'restore-original-history';
    let restored = false;
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press('Control+z'); expect(failures).toEqual([]); await expectLiveSelection(visual);
      if (await source.inputValue() === initial) { restored = true; break; }
    }
    expect(restored, 'Normal bounded history must restore the exact original Markdown').toBe(true);
    await expectSource(source, initial);
    operationStage = 'middle-continue-M'; await visual.locator('p').first().click();
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('M');
    await checkpoint('aMbc\n\n', 2, 0, 2, 4);
    await expect(visual).toHaveAttribute('aria-busy', 'false'); await checkpoint('aMbc\n\n', 2, 0, 2, 4, true);
  } catch (error) {
    console.log(JSON.stringify({ phase: 'empty-Enter-first-failure', operationStage, latestAtom, errors: failures }));
    throw error;
  }
});

test('explicit Preview lock rejects real keys across formal response and unlock resumes history', async ({ page }) => {
  const initial = 'Alpha.\n\nTarget.\n\nAfter.';
  const typed = 'Alpha.V\n\nTarget.\n\nAfter.';
  const resumed = 'Alpha.VX\n\nTarget.\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null; let operationStage = 'unlocked-input'; let latestAtom = null;
  const lockedCheckpoint = async (expectedOwner) => {
    const state = await sink.evaluate((surface) => {
      const root = surface.ownerDocument.querySelector('#easymde-editor-root');
      const keys = Object.getOwnPropertyNames(root).filter(key => key.startsWith('__reactContainer$'));
      if (keys.length !== 1) throw new Error('test-locked-preview-root-unavailable');
      const current = root[keys[0]]?.stateNode?.current;
      if (current?.tag !== 3) throw new Error('test-locked-preview-current-unavailable');
      const pending = current.child ? [current.child] : []; let visited = 0; let fullOwners = 0;
      const presentations = [];
      while (pending.length) {
        if (++visited > 8192) throw new Error('test-locked-preview-traversal-bound');
        const fiber = pending.pop(); const props = fiber.memoizedProps;
        if (props?.surface === surface && props.documentSession?.document
          && ['requestPreview','retainCompositionSurface','onReady'].every(key => typeof props[key] === 'function')) fullOwners += 1;
        if (props?.active === true && typeof props.onToggleEditable === 'function'
          && typeof props.editable === 'boolean' && typeof props.strings?.previewLockReadOnly === 'string') presentations.push(props.editable);
        if (fiber.child) pending.push(fiber.child); if (fiber.sibling) pending.push(fiber.sibling);
      }
      const active = surface.ownerDocument.activeElement;
      return { fullOwners, presentationCount: presentations.length, presentationEditable: presentations[0] ?? null,
        contenteditable: surface.getAttribute('contenteditable'), effectiveEditable: surface.isContentEditable,
        activeElementEditable: !!active?.isContentEditable,
        activeElementIsInput: !!active && ['INPUT','TEXTAREA'].includes(active.tagName),
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
        previewPhase: surface.getAttribute('data-easymde-preview-phase'), busy: surface.getAttribute('aria-busy') };
    });
    const owner = await readCurrentDocumentOwner(page);
    latestAtom = { operationStage, state, owner };
    console.log(JSON.stringify({ phase: 'user-lock-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ fullOwners: 0, presentationCount: 1, presentationEditable: false,
      effectiveEditable: false, lock: 'true' });
    expect(state.contenteditable).not.toBe('true');
    expect(owner.editable, 'Source edit permission remains independent of the user Preview lock').toBe(true);
    expect(owner.selection).toEqual(expectedOwner.selection); expect(owner.history).toEqual(expectedOwner.history);
    expect(owner.revision).toBe(expectedOwner.revision);
    expect(failures).toEqual([]); await expectSource(source, typed); return state;
  };
  const unlockedCheckpoint = async (expected, caret) => {
    expect(failures).toEqual([]); await expectSource(source, expected);
    const state = await readFullCrossBlockState(visual, { paragraph: true, ownerProof: true,
      committed: { start: caret, end: caret, direction: 'none' } });
    latestAtom = { operationStage, state }; console.log(JSON.stringify({ phase: 'user-unlock-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ expectedDocumentSelection: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (state.phase === 'ready') expect(state).toMatchObject({ collapsed: true,
      nativeParagraph: { index: 0, bodyOffset: caret, bodyLength: caret } });
    else expect(state).toMatchObject({ phase: 'rendering', pendingCount: 1, retainedCurrent: true,
      nativeMatchesLease: true, canonicalExact: true });
    return state;
  };
  try {
    await visual.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.type('V');
    await unlockedCheckpoint(typed, 7); const beforeLock = await readCurrentDocumentOwner(page);
    held = await holdFormalPreview(page); operationStage = 'user-click-lock'; await lock.click();
    await held.waitFor(typed); await lockedCheckpoint(beforeLock);
    operationStage = 'readonly-body-click'; await sink.locator('p').first().click();
    const readonly = await lockedCheckpoint(beforeLock);
    expect(readonly).toMatchObject({ activeElementEditable: false, activeElementIsInput: false });
    for (const [stage, key] of [['readonly-Q','Q'],['readonly-Backspace','Backspace'],['readonly-Enter','Enter']]) {
      operationStage = stage;
      if (key === 'Q') await page.keyboard.type('Q'); else await page.keyboard.press(key);
      await lockedCheckpoint(beforeLock);
    }
    operationStage = 'formal-response-while-locked'; await held.close(); held = null;
    await expect(sink).toHaveAttribute('aria-busy', 'false'); await lockedCheckpoint(beforeLock);
    operationStage = 'user-unlock-direct-X'; await lock.click(); await expect(visual).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.type('X'); await unlockedCheckpoint(resumed, 8);
    operationStage = 'Backspace-X'; await page.keyboard.press('Backspace'); await unlockedCheckpoint(typed, 7);
    operationStage = 'Undo-Backspace-X'; await page.keyboard.press('Control+z'); await unlockedCheckpoint(resumed, 8);
    operationStage = 'Redo-Backspace-X'; await page.keyboard.press('Control+Shift+z'); await unlockedCheckpoint(typed, 7);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    const final = await unlockedCheckpoint(typed, 7); expect(final.phase).toBe('ready');
  } catch (error) {
    console.log(JSON.stringify({ phase: 'user-lock-first-failure', operationStage, latestAtom, errors: failures }));
    throw error;
  } finally { if (held) await held.close(); }
});

test('cross-paragraph keyboard selection replaces exactly the selected source', async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, 'alpha\n\nbeta');
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+Shift+End');
  await page.keyboard.type('X');
  expect(failures).toEqual([]);
  await expectSource(source, 'alX');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await page.keyboard.press('Control+z');
  await expectSource(source, 'alpha\n\nbeta');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

for (const reverse of [false, true]) {
  test(`${reverse ? 'reverse' : 'forward'} mouse range preserves both unselected ends`, async ({ page }) => {
    const initial = 'Before.\n\nalpha\n\nbeta\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    const point = async (paragraph) => visual.locator('p').nth(paragraph).evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error('synthetic-text-node-missing');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    const first = await point(reverse ? 2 : 1);
    const last = await point(reverse ? 1 : 2);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.type('X');
    expect(failures).toEqual([]);
    await expectSource(source, 'Before.\n\nalXta\n\nAfter.');
    await expectLiveSelection(visual);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
  });
}

test('full cross-block forward mouse replacement preserves P-H2-P history and branching', async ({ page }) => {
  const initial = 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.';
  const replaced = 'Before.\n\nalphaMzeta\n\nAfter.';
  const branched = 'Before.\n\nalphaNzeta\n\nAfter.';
  const continued = 'Before.\n\nalphaNQzeta\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  let operationStage = 'select-forward-mouse';
  let expectedSource = initial;
  const point = async (index, offset) => visual.locator(':scope > p').nth(index).evaluate((row, position) => {
    if (!(row.firstChild instanceof Text)) throw new Error('cross-block-native-text-missing');
    const range = row.ownerDocument.createRange();
    range.setStart(row.firstChild, position);
    range.collapse(true);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  }, offset);
  let latestAtomicState = null;
  let firstAtomicFailure = null;
  const expectNative = async (rangeSelected, offset = 5, committed = true, requireReady = false) => {
    const expectedSelection = rangeSelected ? { start: 14, end: 30, direction: 'forward' }
      : { start: 9 + offset, end: 9 + offset, direction: 'none' };
    const state = await readFullCrossBlockState(visual, { selected: rangeSelected, offset, direction: 'forward',
      ownerProof: true, ...(committed ? { committed: expectedSelection } : {}) });
    latestAtomicState = { operationStage, expectedSelection: committed ? expectedSelection : null, state };
    console.log(JSON.stringify({ phase: 'PH2-assertion-first-atom', ...latestAtomicState }));
    try {
      expect(state).toMatchObject({ nativeConnected: true, focused: true, editable: true,
        lock: 'false', session: 'ready', ...(committed ? { expectedDocumentSelection: true } : {}) });
      if (requireReady || state.phase === 'ready') {
        expect(state, 'Ready native endpoints must retain their declared source-side meaning').toMatchObject({
          phase: 'ready', pendingCount: 0, anchorMatches: true, focusMatches: true,
          direction: rangeSelected ? 'forward' : 'none', collapsed: !rangeSelected
        });
      } else {
        // The real held-Redo contract proved this old native range is a valid
        // presentation only while this exact current lease owns the surface.
        expect(state, 'Only the current authenticated retained presentation may remain pending').toMatchObject({
          phase: 'rendering', pendingCount: 1, ownedCount: 1, fullFiberCount: 1,
          retainedCurrent: true, nativeMatchesLease: true, canonicalExact: true,
          ownerProof: { retainedPresent: true, retainedOwnedEqCurrent: true,
            retainedOwnerEqCurrentToken: true, retainedReadOnlyIsArray: true, ownedTopLevelNodesExact: true }
        });
      }
      expect(failures).toEqual([]);
    } catch (error) {
      firstAtomicFailure ??= latestAtomicState;
      throw error;
    }
  };
  const expectCommittedSelection = async (start, end = start, direction = 'none') => {
    const owner = await readCurrentDocumentOwner(page);
    expect(owner.selection, 'The active document owner must retain the committed source selection').toEqual({ start, end, direction });
    expect(owner.editable).toBe(true);
    return owner;
  };
  try {
  const first = await point(1, 5);
  const last = await point(2, 1);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 8 });
  await page.mouse.up();
  await expectNative(true, 5, false);
  // Selection-only native intent is not a canonical transaction. Read its
  // current owner separately; the first committed insertion is asserted below.
  const nativeIntentOwner = await readCurrentDocumentOwner(page);
  console.log(JSON.stringify({ phase: 'cross-block-native-intent',
    intendedSelection: { start: 14, end: 30, direction: 'forward' },
    committedSelection: nativeIntentOwner.selection }));
  operationStage = 'replace-M';
  expectedSource = replaced;
  await page.keyboard.type('M');
  await expectSource(source, replaced);
  await expectNative(false, 6);
  await expectCommittedSelection(15);
  operationStage = 'undo-range';
  expectedSource = initial;
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await expectNative(true);
  await expectCommittedSelection(14, 30, 'forward');
  operationStage = 'redo-M';
  expectedSource = replaced;
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, replaced);
  await expectNative(false, 6);
  await expectCommittedSelection(15);
  operationStage = 'undo-before-branch';
  expectedSource = initial;
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await expectNative(true);
  await expectCommittedSelection(14, 30, 'forward');
  operationStage = 'branch-N';
  expectedSource = branched;
  await page.keyboard.type('N');
  await expectSource(source, branched);
  await expectNative(false, 6);
  const branchOwner = await expectCommittedSelection(15);
  expect(branchOwner.history.redoDepth).toBe(0);
  operationStage = 'continue-Q';
  expectedSource = continued;
  await page.keyboard.type('Q');
  await expectSource(source, continued);
  await expectNative(false, 7);
  await expectCommittedSelection(16);
  await expect(visual.locator('h2')).toHaveCount(0);
  await expect(visual.locator(':scope > p').nth(1)).toHaveText('alphaNQzeta');
  await expectNative(false, 7, true, true);
  } catch (error) {
    console.log(JSON.stringify({ phase: 'cross-block-first-failure', operationStage,
      expectedLength: expectedSource.length, firstAtomicFailure, latestAtomicState, errors: failures }));
    throw error;
  }
});

for (const crossBlock of [
  {
    name: 'reverse mouse through nested quotes and ordered task lists',
    action: 'reverse-mouse',
    initial: 'Before.\n\nalphaX\n\n> outer quote\n> > inner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    positionEdited: 'Before.\n\nalphaX\n\n> outer quote\n> > inVner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    positionSelector: 'blockquote blockquote p',
    position: 'middle', positionOffset: 2, positionSourceOffset: 37,
    selectionEnd: 89,
    replaced: 'Before.\n\nalphaMzeta\n\nAfter.',
    branched: 'Before.\n\nalphaNzeta\n\nAfter.',
    continued: 'Before.\n\nalphaNQzeta\n\nAfter.'
  },
  {
    name: 'keyboard Shift through nested lists and a quote',
    action: 'keyboard',
    initial: 'Before.\n\nalphaX\n\n- item\n  - nested\n\n> quote\n\nYz',
    positionEdited: 'Before.\n\nalphaX\n\n- item\n  - nested\n\n> Vquote\n\nYz',
    positionSelector: 'blockquote p',
    position: 'start', positionOffset: 0, positionSourceOffset: 38,
    selectionEnd: 46,
    replaced: 'Before.\n\nalphaMz',
    branched: 'Before.\n\nalphaNz',
    continued: 'Before.\n\nalphaNQz'
  },
  {
    name: 'forward mouse through a heading and code',
    action: 'forward-mouse',
    initial: 'Before.\n\nalphaX\n\n### Bridge\n\n~~~js\nlet n = 1;\n~~~\n\nYzeta\n\nAfter.',
    positionEdited: 'Before.\n\nalphaX\n\n### Bridge\n\n~~~js\nlet n = 1;V\n~~~\n\nYzeta\n\nAfter.',
    positionSelector: 'pre code',
    position: 'end', positionOffset: 10, positionSourceOffset: 45,
    selectionEnd: 52,
    replaced: 'Before.\n\nalphaMzeta\n\nAfter.',
    branched: 'Before.\n\nalphaNzeta\n\nAfter.',
    continued: 'Before.\n\nalphaNQzeta\n\nAfter.'
  }
]) {
for (const transferTiming of crossBlock.action === 'reverse-mouse' ? ['normal', 'held-redo'] : ['normal']) {
test(`full cross-block ${crossBlock.name} preserves exact history and branching${transferTiming === 'held-redo' ? ' with held Redo response' : ''}`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, crossBlock.initial);
  let operationStage = `position-${crossBlock.position}`;
  let expectedSource = crossBlock.initial;
  let heldRedo;
  const direction = crossBlock.action === 'reverse-mouse' ? 'backward' : 'forward';
  const expectOwner = async (start, end = start, expectedDirection = 'none') => {
    const owner = await readCurrentDocumentOwner(page);
    expect(owner.selection, 'Committed selection must come from the active document owner').toEqual({ start, end, direction: expectedDirection });
    expect(owner.editable).toBe(true);
    expect(failures).toEqual([]);
    return owner;
  };
  const expectNative = async (selected, offset = 5, committed = true, requireReady = false) => {
    const expectedSelection = selected
      ? { start: 14, end: crossBlock.selectionEnd, direction }
      : { start: 9 + offset, end: 9 + offset, direction: 'none' };
    const state = await readFullCrossBlockState(visual, { selected, offset, direction,
      ...(committed ? { committed: expectedSelection } : {}) });
    expect(state, `Active owner and native permission at ${operationStage}`).toMatchObject({
      focused: true, editable: true, lock: 'false', session: 'ready', nativeConnected: true,
      ...(committed ? { expectedDocumentSelection: true } : {})
    });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Ready native semantic endpoints at ${operationStage}`).toMatchObject({
        phase: 'ready', anchorMatches: true, focusMatches: true,
        direction: selected ? direction : 'none', collapsed: !selected
      });
    } else {
      console.log(JSON.stringify({ phase: 'cross-block-retained-presentation', operationStage, state }));
      expect(state, `Only an authenticated retained presentation can differ at ${operationStage}`).toMatchObject({
        phase: 'rendering', pendingCount: 1, retainedCurrent: true,
        nativeMatchesLease: true, canonicalExact: true
      });
    }
    expect(failures).toEqual([]);
    return state;
  };
  const point = async (row, offset) => row.evaluate((element, position) => {
    if (!(element.firstChild instanceof Text)) throw new Error('cross-block-native-text-missing');
    const range = element.ownerDocument.createRange();
    range.setStart(element.firstChild, position);
    range.collapse(true);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  }, offset);
  try {
    await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
    const positionRow = visual.locator(crossBlock.positionSelector);
    await positionRow.click();
    await page.keyboard.press(crossBlock.position === 'end' ? 'End' : 'Home');
    if (crossBlock.position === 'middle') {
      for (let index = 0; index < crossBlock.positionOffset; index += 1) await page.keyboard.press('ArrowRight');
    }
    expectedSource = crossBlock.positionEdited;
    await page.keyboard.type('V');
    await expectSource(source, expectedSource);
    await expectOwner(crossBlock.positionSourceOffset + 1);
    await page.keyboard.press('Control+z');
    expectedSource = crossBlock.initial;
    await expectSource(source, expectedSource);
    await expectOwner(crossBlock.positionSourceOffset);

    operationStage = 'select-cross-block';
    const firstRow = visual.locator(':scope > p').filter({ hasText: /^alphaX$/u });
    const lastRow = visual.locator(':scope > p').filter({ hasText: /^Yz(?:eta)?$/u });
    if (crossBlock.action === 'keyboard') {
      await firstRow.click();
      await page.keyboard.press('Home');
      for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Control+Shift+End');
      await page.keyboard.press('Shift+ArrowLeft');
    } else {
      const first = await point(firstRow, 5);
      const last = await point(lastRow, 1);
      const start = direction === 'backward' ? last : first;
      const end = direction === 'backward' ? first : last;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    }
    await expectNative(true, 5, false);
    const nativeIntentOwner = await readCurrentDocumentOwner(page);
    console.log(JSON.stringify({ phase: 'cross-block-native-intent',
      intendedSelection: { start: 14, end: crossBlock.selectionEnd, direction },
      committedSelection: nativeIntentOwner.selection }));
    operationStage = 'replace-M'; expectedSource = crossBlock.replaced;
    await page.keyboard.type('M');
    await expectSource(source, expectedSource);
    await expectNative(false, 6); await expectOwner(15);
    operationStage = 'undo-range'; expectedSource = crossBlock.initial;
    await page.keyboard.press('Control+z');
    await expectSource(source, expectedSource);
    await expectNative(true); await expectOwner(14, crossBlock.selectionEnd, direction);
    if (transferTiming === 'held-redo') heldRedo = await holdFormalPreview(page);
    operationStage = 'redo-M'; expectedSource = crossBlock.replaced;
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    if (transferTiming === 'held-redo') {
      await expectOwner(15);
      await heldRedo.waitFor(expectedSource);
      const state = await expectNative(false, 6);
      expect(state).toMatchObject({ phase: 'rendering', retainedCurrent: true, nativeMatchesLease: true, canonicalExact: true });
      operationStage = 'held-redo-direct-R';
      expectedSource = 'Before.\n\nalphaMRzeta\n\nAfter.';
      await page.keyboard.type('R');
      expect(failures).toEqual([]);
      await expectSource(source, expectedSource); await expectOwner(16);
      await heldRedo.close(); heldRedo = null;
      await expect(visual).toHaveAttribute('aria-busy', 'false');
      await expect(visual.locator(':scope > p').filter({ hasText: /^alphaMRzeta$/u })).toHaveCount(1);
      await expectNative(false, 7, true, true);
      await expectSource(source, expectedSource); await expectOwner(16);
      console.log(JSON.stringify({ phase: 'permanent-held-redo-completed', exactSource: true,
        sourceLength: expectedSource.length, finalNativeOffset: 7, finalDocumentOffset: 16 }));
      return;
    }
    await expectNative(false, 6); await expectOwner(15);
    operationStage = 'undo-before-branch'; expectedSource = crossBlock.initial;
    await page.keyboard.press('Control+z');
    await expectSource(source, expectedSource);
    await expectNative(true); await expectOwner(14, crossBlock.selectionEnd, direction);
    operationStage = 'branch-N'; expectedSource = crossBlock.branched;
    await page.keyboard.type('N');
    await expectSource(source, expectedSource);
    await expectNative(false, 6);
    expect((await expectOwner(15)).history.redoDepth).toBe(0);
    operationStage = 'continue-Q'; expectedSource = crossBlock.continued;
    await page.keyboard.type('Q');
    await expectSource(source, expectedSource);
    await expectNative(false, 7); await expectOwner(16);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await expect(visual.locator('h1,h2,h3,pre,blockquote,ul,ol')).toHaveCount(0);
    await expect(visual.locator(':scope > p').filter({ hasText: /^alphaNQz(?:eta)?$/u })).toHaveCount(1);
    await expectNative(false, 7, true, true);
  } catch (error) {
    const actual = await source.inputValue();
    let firstMismatch = 0;
    while (firstMismatch < Math.min(actual.length, expectedSource.length)
      && actual[firstMismatch] === expectedSource[firstMismatch]) firstMismatch += 1;
    const owner = await readCurrentDocumentOwner(page).catch(() => ({ unavailable: 'test-document-owner-read-failed' }));
    console.log(JSON.stringify({ phase: 'cross-block-first-failure', caseName: crossBlock.name, operationStage,
      actualLength: actual.length, expectedLength: expectedSource.length,
      exactSource: actual === expectedSource, firstMismatch: actual === expectedSource ? null : firstMismatch, owner }));
    throw error;
  } finally { if (heldRedo) await heldRedo.close(); }
});
}
}

for (const listCase of [
  { name: 'star-list', initial: '* a\n* b\n', emptied: '* a\n* \n', removed: '* a\n', continued: '* aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0,
    bodySourceOffset: 6, removalStart: 4, removalEnd: 7, caret: 3 },
  { name: 'dash-list', initial: '- a\n- b\n', emptied: '- a\n- \n', removed: '- a\n', continued: '- aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0,
    bodySourceOffset: 6, removalStart: 4, removalEnd: 7, caret: 3 },
  { name: 'plus-list', initial: '+ a\n+ b\n', emptied: '+ a\n+ \n', removed: '+ a\n', continued: '+ aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0,
    bodySourceOffset: 6, removalStart: 4, removalEnd: 7, caret: 3 },
  { name: 'middle-space-list', initial: '- a\n-   \n- c\n', emptied: '- a\n-   \n- c\n',
    removed: '- a\n- c\n', continued: '- aZ\n- c\n',
    deleteCharacter: false, itemIndex: 1, itemCount: 3, removedItemCount: 2, precedingItemIndex: 0,
    bodySourceOffset: 6, removalStart: 4, removalEnd: 9, caret: 3 },
  // A CRLF-authored document (Windows line endings) cannot keep its CRLF once it
  // reaches the browser: the HTML input stream and the textarea API value both
  // transform \r\n to \n, and clipboard text/plain is normalised the same way on
  // paste. `pasteFrom` is real CRLF written to the clipboard; `openVisual` pastes
  // it and then asserts the LF form the editor actually receives, so this case
  // verifies the CRLF *input* route plus the empty-row behaviour of the LF
  // document it delivers. No user route can leave CRLF in #easymde-source.
  { name: 'pasted-CRLF-middle-space-list', pasteFrom: '- a\r\n-   \r\n- c\r\n',
    initial: '- a\n-   \n- c\n', emptied: '- a\n-   \n- c\n', removed: '- a\n- c\n', continued: '- aZ\n- c\n',
    deleteCharacter: false, itemIndex: 1, itemCount: 3, removedItemCount: 2, precedingItemIndex: 0,
    bodySourceOffset: 6, removalStart: 4, removalEnd: 9, caret: 3 },
  { name: 'quoted-list', initial: '> - a\n> - b\n', emptied: '> - a\n> - \n',
    removed: '> - a\n', continued: '> - aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0,
    bodySourceOffset: 10, removalStart: 6, removalEnd: 11, caret: 5 },
  { name: 'nested-list', initial: '- outer\n  - a\n  - b\n', emptied: '- outer\n  - a\n  - \n',
    removed: '- outer\n  - a\n', continued: '- outer\n  - aZ\n',
    deleteCharacter: true, itemIndex: 2, itemCount: 3, removedItemCount: 2, precedingItemIndex: 1,
    bodySourceOffset: 18, removalStart: 14, removalEnd: 19, caret: 13 }
]) {
test(`full ${listCase.name} Backspace preserves its empty body boundary and preceding caret`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, listCase.initial, listCase.pasteFrom);
  let operationStage = 'select-list-body';
  let expectedSource = listCase.initial;
  const traceStage = (stage) => {
    operationStage = stage;
    if (listCase.name === 'middle-space-list') console.log(JSON.stringify({ phase: 'list-await-stage', stage }));
  };
  const boundedRead = async (operation) => {
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('test-list-observation-timeout')), 3000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const sample = async (phase, caret = null) => {
    const state = await boundedRead(() => readFullCrossBlockState(visual, { list: true,
      ...(caret === null ? {} : { committed: { start: caret, end: caret, direction: 'none' } }) }));
    console.log(JSON.stringify({ phase, caseName: listCase.name, operationStage,
      sourceLength: (await source.inputValue()).length, state }));
    return state;
  };
  const expectListState = async (phase, caret, itemCount, itemIndex, bodyOffset, requireReady = false) => {
    const state = await sample(phase, caret);
    expect(state, `List owner and permission at ${operationStage}`).toMatchObject({ expectedDocumentSelection: true,
      nativeConnected: true, focused: true, editable: true, lock: 'false', session: 'ready' });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Ready list body at ${operationStage}`).toMatchObject({ phase: 'ready', collapsed: true,
        nativeList: { itemCount, itemIndex, bodyOffset } });
    } else {
      expect(state, `Only authenticated retained list presentation is editable at ${operationStage}`).toMatchObject({
        phase: 'rendering', pendingCount: 1, retainedCurrent: true, nativeMatchesLease: true, canonicalExact: true });
    }
    expect(failures).toEqual([]);
  };
  const expectSourceOrRefusal = async () => {
    await expect.poll(async () => failures.length ? 'refused'
      : await source.inputValue() === expectedSource ? 'matched' : 'pending').not.toBe('pending');
    expect(failures, 'The first list refusal ends this chain').toEqual([]);
    await expectSource(source, expectedSource);
  };
  try {
    // openVisual checks the complete literal fixture (and, for the pasted-CRLF
    // case, the normalised LF the paste route delivers) before any formal edit.
    // The mouse and End key select its real rendered body.
    traceStage('before-list-click');
    await visual.locator('li').nth(listCase.itemIndex).click({ timeout: 5000 });
    traceStage('after-list-click');
    traceStage('before-list-End');
    await page.keyboard.press('End');
    traceStage('after-list-End');
    if (listCase.deleteCharacter) {
      operationStage = 'delete-list-body-character'; expectedSource = listCase.emptied;
      await page.keyboard.press('Backspace');
      await expectSourceOrRefusal();
      await expectListState('list-body-emptied', listCase.bodySourceOffset,
        listCase.itemCount, listCase.itemIndex, 0);
    } else {
      traceStage('before-empty-native-sample');
      const intent = await sample('list-empty-native-intent');
      traceStage('after-empty-native-sample');
      expect(intent).toMatchObject({ phase: 'ready', collapsed: true, nativeConnected: true,
        editable: true, lock: 'false', session: 'ready',
        nativeList: { itemCount: listCase.itemCount, itemIndex: listCase.itemIndex, bodyOffset: 0 } });
      // Selection-only intent does not commit the canonical caret. This source
      // boundary is the declared row the following Backspace must remove.
      console.log(JSON.stringify({ phase: 'list-empty-intended-source-boundary', caseName: listCase.name,
        bodySourceOffset: listCase.bodySourceOffset, removalStart: listCase.removalStart, removalEnd: listCase.removalEnd }));
    }
    operationStage = 'remove-empty-list-row'; expectedSource = listCase.removed;
    await page.keyboard.press('Backspace');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-removed', listCase.caret,
      listCase.removedItemCount, listCase.precedingItemIndex, 1);
    operationStage = 'undo-empty-row-removal'; expectedSource = listCase.emptied;
    await page.keyboard.press('Control+z');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-restored', listCase.bodySourceOffset,
      listCase.itemCount, listCase.itemIndex, 0);
    operationStage = 'redo-empty-row-removal'; expectedSource = listCase.removed;
    await page.keyboard.press('Control+Shift+z');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-removed-again', listCase.caret,
      listCase.removedItemCount, listCase.precedingItemIndex, 1);
    operationStage = 'continue-at-preceding-row'; expectedSource = listCase.continued;
    await page.keyboard.type('Z');
    await expectSourceOrRefusal();
    await expectListState('list-continued-at-logical-caret', listCase.caret + 1,
      listCase.removedItemCount, listCase.precedingItemIndex, 2);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await expectListState('list-final-ready-caret', listCase.caret + 1,
      listCase.removedItemCount, listCase.precedingItemIndex, 2, true);
  } catch (error) {
    console.log(JSON.stringify({ phase: 'list-original-first-error', caseName: listCase.name, operationStage,
      errorName: error.name, pageClosed: page.isClosed() }));
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 });
        await sample('list-first-failure');
        console.log(JSON.stringify({ phase: 'list-first-source-result', caseName: listCase.name, operationStage,
          exactExpected: actual === expectedSource, actualLength: actual.length, expectedLength: expectedSource.length,
          retainedInitial: actual === listCase.initial, retainedEmptyItem: actual === listCase.emptied }));
      } catch {
        console.log(JSON.stringify({ phase: 'list-first-error-observation-unavailable', operationStage }));
      }
    }
    throw error;
  }
});
}

for (const inlineCase of [
  { name: 'single delimiter', initial: 'Before.\n\nLead `\\*` tail.\n\nAfter.',
    inserted: 'Before.\n\nLead `\\X*` tail.\n\nAfter.', deleted: 'Before.\n\nLead `\\` tail.\n\nAfter.',
    continued: 'Before.\n\nLead `\\Q*` tail.\n\nAfter.', sourcePoint: 16, initialBodyLength: 2 },
  { name: 'double delimiter', initial: 'Before.\n\nLead ``\\`*`` tail.\n\nAfter.',
    inserted: 'Before.\n\nLead ``\\X`*`` tail.\n\nAfter.', deleted: 'Before.\n\nLead ``\\*`` tail.\n\nAfter.',
    continued: 'Before.\n\nLead ``\\Q`*`` tail.\n\nAfter.', sourcePoint: 17, initialBodyLength: 3 }
]) {
for (const timing of inlineCase.name === 'single delimiter' ? ['held', 'normal'] : ['normal']) {
test(`full inline literal backslash ${inlineCase.name} preserves body input deletion and history${timing === 'held' ? ' held PHP Undo' : ''}`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, inlineCase.initial);
  let heldPreview = null;
  let operationStage = 'initial-inline-pointer';
  let expectedSource = inlineCase.initial;
  const assertPoint = async (bodyOffset, bodyLength, sourcePoint = null, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { inlineCode: true,
      ...(sourcePoint === null ? {} : { committed: { start: sourcePoint, end: sourcePoint, direction: 'none' } }) });
    if (state.phase !== 'ready') console.log(JSON.stringify({ phase: 'inline-pending-checkpoint',
      caseName: inlineCase.name, timing, operationStage, state }));
    expect(state, `Inline owner at ${operationStage}`).toMatchObject({
      nativeConnected: true, focused: true, editable: true, lock: 'false', session: 'ready',
      ...(sourcePoint === null ? {} : { expectedDocumentSelection: true })
    });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Inline body caret at ${operationStage}`).toMatchObject({ phase: 'ready', collapsed: true,
        nativeInlineCode: { anchor: { codeIndex: 0, bodyOffset, bodyLength }, focus: { codeIndex: 0, bodyOffset, bodyLength } } });
    } else {
      expect(state, `Only authenticated retained inline presentation is editable at ${operationStage}`).toMatchObject({
        phase: 'rendering', pendingCount: 1, retainedCurrent: true, nativeMatchesLease: true, canonicalExact: true });
    }
    expect(failures).toEqual([]);
    return state;
  };
  try {
    const code = visual.locator('p code');
    await expect(code).toHaveCount(1);
    const point = await code.evaluate((element) => {
      if (!(element.firstChild instanceof Text) || element.firstChild.length < 2) throw new Error('inline-backslash-native-body-unavailable');
      const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, 1); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    const intent = await assertPoint(1, inlineCase.initialBodyLength);
    console.log(JSON.stringify({ phase: 'inline-backslash-native-intent', caseName: inlineCase.name,
      intendedSourceOffset: inlineCase.sourcePoint, documentSelection: intent.documentSelection }));
    operationStage = 'insert-X'; expectedSource = inlineCase.inserted;
    await page.keyboard.type('X'); await expectSource(source, expectedSource);
    await assertPoint(2, inlineCase.initialBodyLength + 1, inlineCase.sourcePoint + 1);
    operationStage = 'Backspace-X'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Backspace'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength, inlineCase.sourcePoint);
    operationStage = 'Delete-following-body-character'; expectedSource = inlineCase.deleted;
    await page.keyboard.press('Delete'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength - 1, inlineCase.sourcePoint);
    if (timing === 'held') heldPreview = await holdFormalPreview(page);
    operationStage = 'undo-Delete'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Control+z'); await expectSource(source, expectedSource);
    if (heldPreview) {
      await heldPreview.waitFor(inlineCase.initial);
      console.log(JSON.stringify({ phase: 'inline-real-php-200-withheld', sourceLength: inlineCase.initial.length }));
    }
    await assertPoint(1, inlineCase.initialBodyLength, inlineCase.sourcePoint);
    if (timing === 'normal') {
    operationStage = 'redo-Delete'; expectedSource = inlineCase.deleted;
    await page.keyboard.press('Control+Shift+z'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength - 1, inlineCase.sourcePoint);
    operationStage = 'undo-before-continuing'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Control+z'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength, inlineCase.sourcePoint);
    }
    operationStage = 'continue-Q'; expectedSource = inlineCase.continued;
    await page.keyboard.type('Q'); expect(failures).toEqual([]); await expectSource(source, expectedSource);
    await assertPoint(2, inlineCase.initialBodyLength + 1, inlineCase.sourcePoint + 1);
    if (heldPreview) { await heldPreview.close(); heldPreview = null; }
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await assertPoint(2, inlineCase.initialBodyLength + 1, inlineCase.sourcePoint + 1, true);
    await expectSource(source, expectedSource);
    console.log(JSON.stringify({ phase: 'inline-final-ready', caseName: inlineCase.name, timing,
      sourceLength: expectedSource.length, documentOffset: inlineCase.sourcePoint + 1,
      codeBodyOffset: 2, codeBodyLength: inlineCase.initialBodyLength + 1, errors: failures.length }));
  } catch (error) {
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 });
        const state = await readFullCrossBlockState(visual, { inlineCode: true });
        console.log(JSON.stringify({ phase: 'inline-backslash-first-failure', caseName: inlineCase.name, operationStage,
          actualLength: actual.length, expectedLength: expectedSource.length, exactExpected: actual === expectedSource, state }));
      } catch { console.log(JSON.stringify({ phase: 'inline-backslash-observation-unavailable', operationStage })); }
    }
    throw error;
  } finally { if (heldPreview) await heldPreview.close(); }
});
}
}

for (const rapidCase of [
  { name: 'nested reverse range', direction: 'backward',
    initial: 'Before.\n\nalphaX\n\n> outer quote\n> > inner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    initialLength: 101, selectionEnd: 89,
    afterM: 'Before.\n\nalphaMzeta\n\nAfter.', afterMQ: 'Before.\n\nalphaMQzeta\n\nAfter.',
    afterB: 'Before.\n\nalphaBzeta\n\nAfter.', afterBC: 'Before.\n\nalphaBCzeta\n\nAfter.' },
  { name: 'P-H2-P forward range', direction: 'forward',
    initial: 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.', initialLength: 42, selectionEnd: 30,
    afterM: 'Before.\n\nalphaMzeta\n\nAfter.', afterMQ: 'Before.\n\nalphaMQzeta\n\nAfter.',
    afterB: 'Before.\n\nalphaBzeta\n\nAfter.', afterBC: 'Before.\n\nalphaBCzeta\n\nAfter.' }
]) {
test(`full rapid MQ ${rapidCase.name} preserves pending history and branching`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, rapidCase.initial);
  let operationStage = 'initial-range-pointer';
  let expectedSource = rapidCase.initial;
  let held;
  let eventsActive = false;
  const assertState = async (kind, committed = true, requireReady = false) => {
    const selected = kind === 'initial';
    const offset = kind === 'M' || kind === 'B' ? 6 : 7;
    const selection = selected ? { start: 14, end: rapidCase.selectionEnd, direction: rapidCase.direction }
      : { start: 9 + offset, end: 9 + offset, direction: 'none' };
    const state = await readFullCrossBlockState(visual, { selected, offset: selected ? 5 : offset,
      direction: rapidCase.direction, ...(committed ? { committed: selection } : {}) });
    expect(state).toMatchObject({ nativeConnected: true, focused: true, editable: true, lock: 'false', session: 'ready',
      ...(committed ? { expectedDocumentSelection: true } : {}) });
    if (requireReady || state.phase === 'ready') expect(state).toMatchObject({ phase: 'ready',
      anchorMatches: true, focusMatches: true, direction: selected ? rapidCase.direction : 'none', collapsed: !selected });
    else expect(state).toMatchObject({ phase: 'rendering', pendingCount: 1,
      retainedCurrent: true, nativeMatchesLease: true, canonicalExact: true });
    expect(failures).toEqual([]);
    return state;
  };
  const undoToInitial = async () => {
    const receipts = [];
    for (let step = 0; step < 2; step += 1) {
      await page.keyboard.press('Control+z');
      await expect.poll(async () => {
        if (failures.length) return 'refused';
        const value = await source.inputValue();
        return value === rapidCase.initial ? 'initial' : value === rapidCase.afterM ? 'M' : 'pending';
      }).not.toBe('pending');
      expect(failures).toEqual([]);
      const value = await source.inputValue();
      expect(value === rapidCase.initial || value === rapidCase.afterM).toBe(true);
      const kind = value === rapidCase.initial ? 'initial' : 'M'; receipts.push(kind);
      await assertState(kind);
      if (kind === 'initial') return receipts;
    }
    throw new Error('rapid-MQ-history-did-not-restore-initial');
  };
  try {
    expect(rapidCase.initial.length).toBe(rapidCase.initialLength);
    const first = visual.locator(':scope > p').filter({ hasText: /^alphaX$/u });
    const last = visual.locator(':scope > p').filter({ hasText: /^Yzeta$/u });
    const point = (row, offset) => row.evaluate((element, position) => {
      if (!(element.firstChild instanceof Text)) throw new Error('rapid-MQ-native-text-unavailable');
      const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, position); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    }, offset);
    const head = await point(first, 5), tail = await point(last, 1);
    const start = rapidCase.direction === 'backward' ? tail : head;
    const end = rapidCase.direction === 'backward' ? head : tail;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
    await assertState('initial', false);
    await visual.evaluate((surface) => {
      const events = [];
      const observe = (event) => {
        if (events.length < 4 && event.inputType === 'insertText') events.push({ type: event.type,
          trusted: event.isTrusted, dataLength: event.data?.length ?? 0 });
      };
      surface.addEventListener('beforeinput', observe, true); surface.addEventListener('input', observe, true);
      window.__rapidMQEvents = { events, dispose: () => {
        surface.removeEventListener('beforeinput', observe, true); surface.removeEventListener('input', observe, true);
      } };
    });
    eventsActive = true;
    operationStage = 'uninterrupted-MQ'; expectedSource = rapidCase.afterMQ;
    // One real keyboard call: no source/Preview read, timer or await between M and Q.
    await page.keyboard.type('MQ');
    await expectSource(source, expectedSource);
    await assertState('MQ');
    const events = await page.evaluate(() => window.__rapidMQEvents.events);
    expect(events.filter((event) => event.type === 'beforeinput')).toEqual([
      { type: 'beforeinput', trusted: true, dataLength: 1 }, { type: 'beforeinput', trusted: true, dataLength: 1 }
    ]);
    console.log(JSON.stringify({ phase: 'rapid-MQ-native-receipt', caseName: rapidCase.name,
      events, exactSource: true, sourceLength: rapidCase.afterMQ.length, documentOffset: 16 }));
    await page.evaluate(() => { window.__rapidMQEvents.dispose(); delete window.__rapidMQEvents; }); eventsActive = false;
    operationStage = 'undo-MQ';
    const undo = await undoToInitial(); expectedSource = rapidCase.initial;
    const redo = [...undo.slice(0, -1).reverse(), 'MQ'];
    for (const kind of redo) {
      if (kind === 'MQ') held = await holdFormalPreview(page);
      operationStage = `redo-${kind}`; expectedSource = kind === 'M' ? rapidCase.afterM : rapidCase.afterMQ;
      await page.keyboard.press('Control+Shift+z'); await expectSource(source, expectedSource); await assertState(kind);
    }
    await held.waitFor(rapidCase.afterMQ);
    const pendingState = await assertState('MQ');
    expect(pendingState).toMatchObject({ phase: 'rendering', retainedCurrent: true, nativeMatchesLease: true, canonicalExact: true });
    console.log(JSON.stringify({ phase: 'rapid-MQ-real-held-history', caseName: rapidCase.name, undoKeys: undo.length, state: pendingState }));
    operationStage = 'undo-before-branch'; await undoToInitial(); expectedSource = rapidCase.initial;
    operationStage = 'branch-B'; expectedSource = rapidCase.afterB;
    await page.keyboard.type('B'); await expectSource(source, expectedSource);
    const branch = await assertState('B'); expect(branch.documentHistory.redoDepth).toBe(0);
    operationStage = 'continue-C'; expectedSource = rapidCase.afterBC;
    await page.keyboard.type('C'); await expectSource(source, expectedSource); await assertState('BC');
    await held.close(); held = null;
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await assertState('BC', true, true); await expectSource(source, expectedSource);
  } catch (error) {
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 }); const state = await readFullCrossBlockState(visual);
        console.log(JSON.stringify({ phase: 'rapid-MQ-first-failure', caseName: rapidCase.name, operationStage,
          actualLength: actual.length, expectedLength: expectedSource.length, exactExpected: actual === expectedSource, state }));
      } catch { console.log(JSON.stringify({ phase: 'rapid-MQ-observation-unavailable', operationStage })); }
    }
    throw error;
  } finally {
    if (eventsActive && !page.isClosed()) await page.evaluate(() => { window.__rapidMQEvents?.dispose(); delete window.__rapidMQEvents; });
    if (held) await held.close();
  }
});
}

for (const wrapper of [
  { name: 'code', source: '`x`', selector: 'code' },
  { name: 'emphasis', source: '*x*', selector: 'em' },
  { name: 'strong', source: '**x**', selector: 'strong' },
  { name: 'strike', source: '~~x~~', selector: 'del' },
  { name: 'link', source: '[x](https://example.com)', selector: 'a' },
  { name: 'escaped emphasis', source: '*\\**', selector: 'em' },
  { name: 'entity strong', source: '**&amp;**', selector: 'strong' },
  { name: 'entity link', source: '[&amp;](https://example.com)', selector: 'a' },
  { name: 'space normalized code', source: '` Z `', selector: 'code' },
  { name: 'multi delimiter code', source: '`` ` ``', selector: 'code' }
]) {
for (const key of ['Backspace', 'Delete']) {
for (const position of ['end', 'middle']) {
  test(`deleting the final ${wrapper.name} character with ${key} retires only its inline syntax at ${position}`, async ({ page }) => {
    const initial = `Before.\n\n- Head.\n- Tail ${wrapper.source}${position === 'middle' ? '.suffix.' : ''}\n\nAfter.`;
    const expected = initial.replace(wrapper.source, '');
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator(`li ${wrapper.selector}`).click();
    if (position === 'end') {
      await page.keyboard.press('End');
    } else {
      await page.keyboard.press('Home');
      for (let index = 0; index < 'Tail '.length + 1; index += 1) await page.keyboard.press('ArrowRight');
    }
    if (key === 'Delete') await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(key);
    expect(failures).toEqual([]);
    await expectSource(source, expected);
    await expect(visual.locator(`li ${wrapper.selector}`)).toHaveCount(0);
    await expectLiveSelection(visual);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expected);
    await page.keyboard.type('Y');
    await expectSource(source, expected.replace('- Tail ', '- Tail Y'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}
}
}

test('native keyboard selections edit all-space inline code without changing adjacent text', async ({ page }) => {
  const initial = 'Lead` `tail.\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  const selectSpaces = async (count) => {
    await visual.locator('p').first().click();
    await page.keyboard.press('Home');
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowRight');
    for (let index = 0; index < count; index += 1) await page.keyboard.press('Shift+ArrowRight');
  };
  await selectSpaces(1);
  expect(await visual.evaluate((surface) => {
    const selection = getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    return range.startContainer === range.endContainer
      && range.startContainer.parentElement?.tagName === 'CODE'
      && range.startOffset === 0 && range.endOffset === 1
      && surface.contains(range.startContainer);
  }), 'native keys select exactly the blank code body').toBe(true);
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  const withoutCode = initial.replace('` `', '');
  await expectSource(source, withoutCode);
  await expectLiveSelection(visual);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+Z');
  await expectSource(source, withoutCode);
  await page.keyboard.type('X');
  await expectSource(source, withoutCode.replace('Leadtail.', 'LeadXtail.'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

for (const timing of ['normal', 'held']) {
test(`context formatting preserves an unrelated terminal source space through undo and immediate input (${timing} Preview)`, async ({ page }) => {
  const initial = 'Para\n\n---\n\nfoo\n';
  const { failures, source, visual } = await openVisual(page, initial);
  let release = () => {};
  let fetched = false;
  let first = true;
  const gate = new Promise((resolve) => { release = resolve; });
  if (timing === 'held') {
    await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      fetched = true;
      await gate;
      try {
        await route.fulfill({ response });
      } catch (error) {
        if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
      }
    });
  }
  try {
  await visual.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const withSpace = initial.replace('foo\n', 'foo \n');
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const point = await visual.evaluate((surface) => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !surface.contains(selection.anchorNode)) {
      throw new Error('context-range-unavailable');
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  // A trailing-space-only edit can reuse Preview until context preparation
  // requests fresh mapping, so wait for that actual request after the gesture.
  if (timing === 'held') await expect.poll(() => fetched).toBe(true);
  release();
  const bold = page.locator('[data-easymde-context-menu-item="bold"]').last();
  await expect(bold).toBeEnabled();
  await expectSource(source, withSpace);
  await bold.click();
  expect(failures).toEqual([]);
  await expectSource(source, withSpace.replace('Para', 'P**ar**a'));
  await page.keyboard.press('Control+z');
  await expectSource(source, withSpace);
  await page.keyboard.type('Z');
  await expectSource(source, withSpace.replace('Para', 'PZa'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  } finally {
    release();
    if (timing === 'held') await page.unrouteAll({ behavior: 'wait' });
  }
});
}

for (const fence of ['~~~', '```']) {
test(`ordinary and immersive split source preserve literal ${fence} fence edits and history`, async ({ page }) => {
  const initial = `${fence}bash\necho 1\n${fence}\n\nAfter.`;
  const { failures, source } = await openVisual(page, initial);
  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  await page.getByRole('button', { name: strings.split, exact: true }).last().click();
  for (const mode of ['immersive-split', 'ordinary']) {
    if (mode === 'ordinary') {
      await page.getByRole('button', { name: strings.exit, exact: true }).click();
    }
    const editor = page.locator('.easymde-source-react .cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Delete');
    await expectSource(source, initial.slice(1));
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    // Shifted character spelling emits the physical shortcut's uppercase key.
    // A lowercase Playwright chord can dispatch Ctrl+z to CodeMirror first.
    await page.keyboard.press('Control+Shift+Z');
    await expectSource(source, initial.slice(1));
    await page.keyboard.type(fence[0]);
    await expectSource(source, initial);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Q');
    await expectSource(source, initial + '\nQ');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
  }
});
}

test('a rejected secondary image gesture preserves authored text and continued editing after Preview adoption', async ({ page }) => {
  const image = '![test image](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const initial = `Para\n\n${image}\n\nfoo\n`;
  const { failures, source, visual } = await openVisual(page, initial);
  await expect.poll(() => visual.locator('img').evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  let release = () => {};
  let fetched = false;
  let first = true;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    fetched = true;
    await gate;
    try { await route.fulfill({ response }); }
    catch (error) { if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error; }
  });
  try {
    await visual.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    const withSpace = initial.replace('foo\n', 'foo \n');
    await expectSource(source, withSpace);
    await visual.locator('p').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const point = await visual.evaluate(() => {
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) throw new Error('authored-range-unavailable');
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(() => fetched).toBe(true);
    release();
    await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
    await page.keyboard.press('Escape');
    expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
    expect(failures).toEqual([]);
    await visual.locator('img').click({ button: 'right' });
    expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
    await expectSource(source, withSpace);
    // Existing image policy rejects a text range outside the hit image. There
    // is no second menu to cancel; Escape would leave immersive writing.
    await expect.poll(() => failures.length).toBe(1);
    expect(failures).toEqual(['editor-context-menu-image-stale']);
    await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
    await page.keyboard.type('Z');
    await expectSource(source, withSpace.replace('Para', 'PZa'));
    await expectLiveSelection(visual);
    expect(failures).toEqual(['editor-context-menu-image-stale']);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const size of ['full', 'windowed']) {
  test(`${size} rapid input preserves neighboring layout and captured compositor frames`, async ({ page, context }) => {
    const initial = '# Layout reference\n\nTarget paragraph here.\n\nNeighbor paragraph.\n\nAfter paragraph.'
      + (size === 'windowed' ? '\n\n' + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n') : '');
    const { failures, source, visual } = await openVisual(page, initial);
    expect(await visual.locator('[data-easymde-preview-window-spacer]').count() > 0).toBe(size === 'windowed');
    const target = visual.locator('p').filter({ hasText: /^Target paragraph here\.$/u });
    await target.click();
    await page.keyboard.press('End');
    const cdp = await context.newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', (event) => {
      if (frames.length < 32) frames.push(event.data);
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await visual.evaluate((surface) => {
      const heading = surface.querySelector('h1');
      const neighbor = [...surface.querySelectorAll('p')].find((node) => node.textContent === 'Neighbor paragraph.');
      const samples = [];
      let active = true;
      window.__visualLayoutSample = { samples, stop: () => { active = false; } };
      const sample = () => {
        const box = neighbor?.getBoundingClientRect();
        samples.push({
          connected: !!heading?.isConnected && !!neighbor?.isConnected,
          top: box?.top ?? null, height: box?.height ?? null,
          editable: surface.isContentEditable,
          selectionInside: surface.contains(getSelection()?.anchorNode)
        });
        if (active && samples.length < 180) requestAnimationFrame(sample);
      };
      sample();
    });
    try {
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
      await page.keyboard.type('0123456789XYZ');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      const edited = initial.replace('Target paragraph here.', 'Target paragraph here.0123456789');
      await expectSource(source, edited);
      await expectLiveSelection(visual);
      // Include the settled surface and its next painted frames in the observation.
      await expect(visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally {
      await cdp.send('Page.stopScreencast');
      await page.evaluate(() => window.__visualLayoutSample.stop());
    }
    const samples = await page.evaluate(() => window.__visualLayoutSample.samples);
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((sample) => sample.connected && sample.editable && sample.selectionInside)).toBe(true);
    expect(Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top))).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map((sample) => sample.height)) - Math.min(...samples.map((sample) => sample.height))).toBeLessThanOrEqual(1);
    expect(frames.length, 'actual compositor frames must be available for visual inspection').toBeGreaterThan(1);
    for (let index = 0; index < frames.length; index += 1) {
      const framePath = test.info().outputPath(`compositor-${index}.png`);
      await writeFile(framePath, Buffer.from(frames[index], 'base64'));
      await test.info().attach(`compositor-${index}`, { path: framePath, contentType: 'image/png' });
    }
    await test.info().attach('neighbor-layout-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    console.log(JSON.stringify({ phase: 'bounded-layout-evidence', size,
      frameCount: frames.length, sampleCount: samples.length,
      topSpan: Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top)),
      heightSpan: Math.max(...samples.map((sample) => sample.height)) - Math.min(...samples.map((sample) => sample.height)) }));
    expect(failures).toEqual([]);
    await cdp.detach();
  });
}

test('paragraph Enter commits a split and accepts immediate input', async ({ page }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  expect(failures).toEqual([]);
  await expectSource(source, 'Before.\n\nab\n\nXcdef\n\nAfter.');
  await expectLiveSelection(visual);
});

for (const command of ['delete', 'cut']) {
for (const timing of ['pending', 'settled']) {
  test(`code menu undo restores the input caret with ${timing} Preview (${command})`, async ({ page }) => {
    const initial = 'Before paragraph.\n\n~~~bash\necho one\n~~~\n\nAfter paragraph.';
    const fence = '~~~bash\necho one\n~~~';
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('pre code').click();
    await page.keyboard.press('End');
    const caret = await page.evaluate(() => {
      const selection = getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) throw new Error('code-caret-unavailable');
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { x: rect.x - 1, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(caret.x, caret.y, { button: 'right' });
    if (command === 'delete') {
      await page.locator('[data-easymde-context-menu-item="code-block"]').hover();
      await page.locator('[data-easymde-context-menu-item="delete-code-block"]').last().click();
    } else {
      await page.locator('[data-easymde-context-menu-item="cut"]').last().click();
    }
    await expectSource(source, initial.replace(fence, ''));
    await expect(visual.locator('pre')).toHaveCount(0);
    await expect(visual).toHaveAttribute('aria-busy', 'false');

    let release;
    let blocked = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    if (timing === 'pending') {
      await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
        || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
        blocked += 1;
        await gate;
        try {
          await route.continue();
        } catch (error) {
          // A superseding edit may abort the held obsolete Preview request.
          if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
        }
      });
    }
    try {
      await page.keyboard.press('Control+z');
      await expectSource(source, initial);
      if (timing === 'pending') {
        await expect.poll(() => blocked).toBeGreaterThan(0);
        await expect(visual).toHaveAttribute('aria-busy', 'true');
      } else {
        await expect(visual.locator('pre')).toHaveCount(1);
        await expect(visual).toHaveAttribute('aria-busy', 'false');
      }
      // Do not click or restore the caret after Undo: history owns this position.
      await page.keyboard.type('X');
      expect(failures).toEqual([]);
      release();
      await expectSource(source, initial.replace('echo one', 'echo oneX'));
      await expect(visual).toHaveAttribute('aria-busy', 'false');
      await expectLiveSelection(visual);
      expect(failures).toEqual([]);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
}

for (const block of [
  { name: 'paragraph', selector: 'p', markdown: 'abcdef\n\nAfter.' },
  { name: 'heading', selector: 'h1', markdown: '# abcdef\n\nAfter.' },
  { name: 'code body', selector: 'pre code', markdown: 'Before.\n\n~~~bash\nabcdef\n~~~\n\nAfter.' }
]) {
  test(`mixed character edits preserve untouched syntax in ${block.name}`, async ({ page }) => {
    const { failures, source, visual } = await openVisual(page, block.markdown);
    await visual.locator(block.selector).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('中A7!');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.type('Q');
    await expectSource(source, block.markdown.replace('abcdef', 'ab中Qdef'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

test('Chromium composition commits once and remains editable after history', async ({ page, context }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await visual.evaluate((surface) => {
    window.__easymdeTestCompositionEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
      surface.addEventListener(type, () => window.__easymdeTestCompositionEvents.push(type));
    }
  });
  const input = await context.newCDPSession(page);
  try {
    await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await input.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    await input.send('Input.insertText', { text: '你' });
    await expectSource(source, initial.replace('abcdef', 'ab你cdef'));
    const events = await page.evaluate(() => window.__easymdeTestCompositionEvents);
    expect(events.filter((event) => event === 'compositionstart')).toHaveLength(1);
    expect(events.filter((event) => event === 'compositionend')).toHaveLength(1);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.type('X');
    await expectSource(source, initial.replace('abcdef', 'abXcdef'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  } finally {
    await input.detach();
  }
});

test('plain paragraph middle input undo preserves its original visual caret', async ({ page }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await expectSource(source, initial.replace('abcdef', 'abXcdef'));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.type('Y');
  await expectSource(source, initial.replace('abcdef', 'abYcdef'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

test('incoming formal Preview preserves newer keyboard input during history transfer', async ({ page }) => {
  const initial = 'Before.\n\n~~~bash\necho one\n~~~\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('pre code').click();
  await page.keyboard.press('End');
  const caret = await page.evaluate(() => {
    const selection = getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) throw new Error('code-caret-unavailable');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x - 1, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(caret.x, caret.y, { button: 'right' });
  await page.locator('[data-easymde-context-menu-item="code-block"]').hover();
  await page.locator('[data-easymde-context-menu-item="delete-code-block"]').last().click();
  await expectSource(source, initial.replace('~~~bash\necho one\n~~~', ''));
  await expect(visual.locator('pre')).toHaveCount(0);
  await expect(visual).toHaveAttribute('aria-busy', 'false');
  let fetched = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let first = true;
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    fetched = true;
    try {
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
    } finally {
      await response.dispose();
    }
  });
  try {
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expect.poll(() => fetched).toBe(true);
    await page.keyboard.type('BC');
    // Deliver the actual older PHP response during newer keyboard input.
    release();
    await page.keyboard.type('DE');
    expect(failures).toEqual([]);
    await expectSource(source, initial.replace('echo one', 'echo oneBCDE'));
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.type('F');
    await expectSource(source, initial.replace('echo one', 'echo oneBCDEF'));
    await expectLiveSelection(visual);
    const completed = await source.inputValue();
    let undoSteps = 0;
    while (await source.inputValue() !== initial && undoSteps < 12) {
      await page.keyboard.press('Control+z');
      undoSteps += 1;
      expect(failures).toEqual([]);
    }
    await expectSource(source, initial);
    for (let step = 0; step < undoSteps; step += 1) await page.keyboard.press('Control+Shift+z');
    await expectSource(source, completed);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const character of ['👩🏽‍💻', 'e\u0301']) {
  test(`native character selection preserves Unicode ${character}`, async ({ page }) => {
    const initial = `Before.\n\nA${character}Z\n\nAfter.`;
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(character);
    await page.keyboard.press('Backspace');
    await expectSource(source, 'Before.\n\nAZ\n\nAfter.');
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

function windowedMarkdown(tail) {
  const filler = Array.from(
    { length: 170 },
    (_, index) => `Filler ${index + 1}.`
  ).join('\n\n');
  return `Head.\n\n${filler}\n\n${tail}`;
}

function richWindowedFixture(imageKind = 'inline') {
  const repeated = Array.from({ length: 12 }, () => 'Repeated paragraph.').join('\n\n');
  const filler = Array.from({ length: 154 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n');
  const inlineImage = '![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const image = imageKind === 'linked' ? `[${inlineImage}](https://example.com)`
    : imageKind === 'reference' ? '![dot][pic]' : inlineImage;
  const definition = imageKind === 'reference'
    ? '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png\n\n' : '';
  const tail = [
    '## Tail heading', '', '- outer', '  - inner', '  - inner two', '',
    '> quoted tail line', '', '```python', 'value = 1', '```', '',
    '~~~bash', 'echo one', '~~~', '', '| left | right |', '| --- | --- |', '| a | b |', '',
    'Math $x^2$ and [link](https://example.com).', '', image, '',
    '```mermaid', 'graph TD', '  A --> B', '```', ''
  ].join('\n');
  return { initial: `${definition}# Head\n\n${repeated}\n\n${filler}\n\n${tail}`, image };
}

async function openWindowedVisual(page, tail) {
  const opened = await openVisual(page, windowedMarkdown(tail));
  // More than 160 blocks: the editor mounts a windowed surface with spacers.
  await expect(opened.visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  return opened;
}

for (const key of ['Backspace', 'Delete']) {
test(`windowed inline code retirement keeps source and history usable with ${key}`, async ({ page }) => {
  const initial = 'Before.\n\nTail `x`.suffix.\n\nAfter.\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n');
  const { failures, source, visual } = await openVisual(page, initial);
  expect(await visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  await visual.locator('p code').click();
  await page.keyboard.press('Home');
  for (let index = 0; index < 'Tail '.length + 1; index += 1) await page.keyboard.press('ArrowRight');
  if (key === 'Delete') await page.keyboard.press('ArrowLeft');
  if (key === 'Delete') {
    // This exact keyboard navigation reaches the Text outside the opening
    // code mark, as the independent beforeinput/Undo contract probe proved.
    const outside = await expectWindowedSmokeCheckpoint(visual, failures, 'inline-Delete-outside-initial-intent', null,
      { selector: ':scope > p', index: 1, codeBoundary: true }, 5);
    expect(outside).toMatchObject({ runtimePending: false,
      nativeAnchor: { inlineCode: { codePresent: true, insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } },
      nativeFocus: { inlineCode: { codePresent: true, insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } } });
  }
  await page.keyboard.press(key);
  expect(failures).toEqual([]);
  const withoutCode = initial.replace('`x`', '');
  await expectSource(source, withoutCode);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-retired`, { start: 14, end: 14, direction: 'none' },
    { selector: ':scope > p', index: 1 }, 5);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  const originalCaret = key === 'Backspace' ? 16 : 14;
  const undone = await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-Undo`, { start: originalCaret, end: originalCaret, direction: 'none' },
    key === 'Backspace' ? { selector: 'p code' } : { selector: ':scope > p', index: 1, codeBoundary: true },
    key === 'Backspace' ? 1 : 5);
  if (key === 'Delete' && !undone.runtimePending) expect(undone).toMatchObject({
    nativeAnchor: { inlineCode: { insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } },
    nativeFocus: { inlineCode: { insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } } });
  await page.keyboard.press('Control+Shift+Z');
  await expectSource(source, withoutCode);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-Redo`, { start: 14, end: 14, direction: 'none' },
    { selector: ':scope > p', index: 1 }, 5);
  await page.keyboard.type('Y');
  await expectSource(source, withoutCode.replace('Tail ', 'Tail Y'));
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-continue-Y`, { start: 15, end: 15, direction: 'none' },
    { selector: ':scope > p', index: 1 }, 6);
  expect(failures).toEqual([]);
});
}

test('windowed inside CODE body-zero Delete restores its history and immediate code input', async ({ page }) => {
  // The inline code is the paragraph's first inline content. When a Text node
  // precedes the code, Chromium resolves the start-of-code boundary to that Text
  // node: a mouse click on the left part of the glyph, the ArrowLeft collapse of
  // a backward selection inside the code, and the same navigation in a plain
  // contenteditable host all land BEFORE the code (verified natively, without
  // this editor). Only a paragraph-initial code exposes a collapsed caret
  // genuinely inside the code body at offset 0, which is the state under test.
  const initial = 'Before.\n\n`x`Tail.suffix.\n\nAfter.\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n');
  const retired = initial.replace('`x`', '');
  const continued = initial.replace('`x`', '`Yx`');
  const { failures, source, visual } = await openVisual(page, initial);
  const code = visual.locator('p code');
  const originalText = await code.evaluateHandle(element => {
    if (!(element.firstChild instanceof Text) || element.firstChild.length !== 1) throw new Error('test-windowed-code-zero-original-text-missing');
    return element.firstChild;
  });
  const beforeNavigation = await readCurrentDocumentOwner(page);
  const target = { selector: 'p code', codeBoundary: true, originalCodeText: originalText, expectedSource: initial };
  const unchangedSetup = state => {
    expect(state.sourceLength).toBe(initial.length); expect(state.revision).toBe(beforeNavigation.revision);
    expect(state.documentHistory).toEqual(beforeNavigation.history);
    expect(state).toMatchObject({ runtimePending: false,
      nativeAnchor: { inlineCode: { codePresent: true, insideCode: true, sameOriginalCodeText: true } },
      nativeFocus: { inlineCode: { codePresent: true, insideCode: true, sameOriginalCodeText: true } } });
  };
  try {
  // Home from inside a paragraph-initial code lands inside the code body at
  // offset 0; one ArrowRight steps to offset 1 (body-one) so the selection stage
  // below still starts inside the code.
  await code.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  const atOne = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-body-one', null, target, 1);
  unchangedSetup(atOne);
  await page.keyboard.press('Shift+ArrowLeft');
  const selected = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-selected-x', null,
    { ...target, focusOffset: 0 }, 1, 'backward');
  unchangedSetup(selected);
  await page.keyboard.press('ArrowLeft');
  const initialNative = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-collapse-zero', null, target, 0);
  unchangedSetup(initialNative);
  // Pure navigation never synchronises the canonical document selection: it
  // stays where the document load parked it, so Delete must be gated on the
  // observed inside source position rather than on an internally synced caret.
  expect(initialNative.documentSelection, 'Navigation must not synchronize the canonical document selection')
    .toEqual(beforeNavigation.selection);
  await page.keyboard.press('Delete'); expect(failures).toEqual([]); await expectSource(source, retired);
  await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-retired', { start: 9, end: 9, direction: 'none' },
    { selector: ':scope > p', index: 1 }, 0);
  await page.keyboard.press('Control+z'); expect(failures).toEqual([]); await expectSource(source, initial);
  await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-Undo', { start: 10, end: 10, direction: 'none' },
    { selector: 'p code', codeBoundary: true }, 0);
  // No click, selection assignment or Preview wait follows Undo.
  await page.keyboard.type('Y'); expect(failures).toEqual([]); await expectSource(source, continued);
  const typed = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-immediate-Y', { start: 11, end: 11, direction: 'none' },
    { selector: 'p code', codeBoundary: true }, 1);
  expect(typed.documentHistory.redoDepth).toBe(0);
  await expect(visual).toHaveAttribute('aria-busy', 'false'); await expectSource(source, continued);
  const ready = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-final-ready', { start: 11, end: 11, direction: 'none' },
    { selector: 'p code', codeBoundary: true }, 1);
  expect(ready).toMatchObject({ runtimePending: false,
    nativeAnchor: { bodyLength: 2, inlineCode: { codePresent: true, insideCode: true, codeBodyOffset: 1 } },
    nativeFocus: { bodyLength: 2, inlineCode: { codePresent: true, insideCode: true, codeBodyOffset: 1 } } });
  expect(await code.evaluate(element => element.textContent === 'Yx')).toBe(true);
  } finally { await originalText.dispose(); }
});

test('windowed cross-row replacement keeps history and immediate pending input usable', async ({ page }) => {
  const initial = 'Alpha.\n\nBeta.\n\n~~~js\nvalue = 1;\n~~~\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const { failures, source, visual } = await openVisual(page, initial);
  await expect.poll(() => visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  let release;
  let fetched = 0;
  const responsesSettled = [];
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    let done;
    responsesSettled.push(new Promise((resolve) => { done = resolve; }));
    let response;
    try {
      response = await route.fetch();
      fetched += 1;
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
    } finally {
      await response?.dispose();
      done();
    }
  });
  try {
    const point = async (index) => visual.locator('p').nth(index).evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error('synthetic-text-node-missing');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    const first = await point(0);
    const last = await point(1);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 8 });
    await page.mouse.up();
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-forward-native-intent', null,
      { selector: 'p', index: 0, focusIndex: 1, focusOffset: 2 }, 2, 'forward');
    await page.keyboard.type('Q');
    const edited = initial.replace('Alpha.\n\nBeta.', 'AlQta.');
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Q', { start: 3, end: 3, direction: 'none' }, { selector: 'p' }, 3);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Undo', { start: 2, end: 10, direction: 'forward' },
      { selector: 'p', index: 0, focusIndex: 1, focusOffset: 2 }, 2, 'forward');
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Redo', { start: 3, end: 3, direction: 'none' }, { selector: 'p' }, 3);
    await page.keyboard.type('Z');
    expect(failures, 'immediate input after cross-row redo').toEqual([]);
    const continued = edited.replace('AlQta.', 'AlQZta.');
    await expectSource(source, continued);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-direct-Z', { start: 4, end: 4, direction: 'none' }, { selector: 'p' }, 4);
    await expect.poll(() => fetched).toBeGreaterThan(0);
    release();
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await visual.locator('pre code').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('X');
    const continuedCode = continued.replace('value = 1;', 'vXalue = 1;');
    await expectSource(source, continuedCode);
    const codeCaret = continuedCode.indexOf('vXalue = 1;') + 2;
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-code-direct-X', { start: codeCaret, end: codeCaret, direction: 'none' },
      { selector: 'pre code' }, 2);
    expect(failures).toEqual([]);
  } finally {
    release();
    await Promise.all(responsesSettled);
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('windowed rich starting blocks retain exact source through mixed position history', async ({ page }) => {
  const blocks = [
    '# Heading', '', 'Opening paragraph.', '', '- outer item', '  - inner item', '',
    '> quoted paragraph', '', '[linked words](https://example.com)', '',
    '| left | right |', '| --- | --- |', '| cell | value |', '',
    '~~~python', 'value = 123', '~~~', ''
  ].join('\n');
  const initial = blocks + '\n' + Array.from({ length: 170 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const { failures, source, visual } = await openVisual(page, initial);
  await expect.poll(async () => await visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  for (const { selector, needle } of [
    { selector: 'h1', needle: 'Heading' }, { selector: 'p', needle: 'Opening paragraph.' },
    { selector: 'ul > li', needle: 'outer item' }, { selector: 'blockquote p', needle: 'quoted paragraph' },
    { selector: 'a', needle: 'linked words' }, { selector: 'td', needle: 'cell' }, { selector: 'pre code', needle: 'value = 123' }
  ]) {
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
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-X`,
      { start: sourcePoint + 1, end: sourcePoint + 1, direction: 'none' }, { selector }, 2);
    await page.keyboard.press('Control+z');
    expect(failures, `undo ${selector}`).toEqual([]);
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Undo`,
      { start: sourcePoint, end: sourcePoint, direction: 'none' }, { selector }, 1);
    await page.keyboard.press('Control+Shift+z');
    expect(failures, `redo ${selector}`).toEqual([]);
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Redo`,
      { start: sourcePoint + 1, end: sourcePoint + 1, direction: 'none' }, { selector }, 2);
    await page.keyboard.press('Backspace');
    expect(failures, `backspace ${selector}`).toEqual([]);
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Backspace`,
      { start: sourcePoint, end: sourcePoint, direction: 'none' }, { selector }, 1);
    expect(failures, `mixed history ${selector}`).toEqual([]);
  }
});

test('rich windowed document crosses the rendering threshold, empties and restores exactly', async ({ page }) => {
  test.setTimeout(600_000);
  const { initial } = richWindowedFixture();
  const { failures, source, visual } = await openVisual(page, initial);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  let emptied = false;
  let deletionKeys = 0;
  let noSpacerObserved = false;
  let firstNoSpacerAt = null;
  let lastSpacerAt = null;
  for (; deletionKeys < initial.length * 2 + 200; deletionKeys += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `rich deletion ${deletionKeys}`).toEqual([]);
    await expectLiveSelection(visual);
    if (deletionKeys % 16 === 0) {
      const spacerCount = await visual.locator('[data-easymde-preview-window-spacer]').count();
      if (spacerCount === 0) {
        noSpacerObserved = true;
        firstNoSpacerAt ??= deletionKeys;
      } else {
        lastSpacerAt = deletionKeys;
      }
    }
    const value = await source.inputValue();
    expect(/^[^\S\r\n]*\.[^\S\r\n]*$/mu.test(value),
      `rich deletion ${deletionKeys} must not leave an invisible punctuation row`).toBe(false);
    if (value.trimEnd().length > 9) expect(value.startsWith('# Head')).toBe(true);
    if (value.trim() === '') {
      emptied = true;
      deletionKeys += 1;
      break;
    }
  }
  expect(emptied, 'actual Backspace reaches empty document').toBe(true);
  await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const beforeExtraEmptySource = await source.inputValue();
  expect(beforeExtraEmptySource.trim(), 'Deletion must stop at a whitespace-empty representation').toBe('');
  const beforeExtraOwner = await readCurrentDocumentOwner(page);
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
    await page.keyboard.press('Backspace');
    afterExtraEmptySource = await source.inputValue();
    expect(afterExtraEmptySource.trim(), 'The extra Backspace must leave an empty representation').toBe('');
    expect(failures, 'The extra Backspace must not emit a pageerror').toEqual([]);
    const afterExtraOwner = await readCurrentDocumentOwner(page);
    const sourceChangingClear = beforeExtraEmptySource !== afterExtraEmptySource;
    if (sourceChangingClear) {
      expect(beforeExtraEmptySource, 'A source-changing empty clear must start from a non-empty representation').not.toBe('');
      expect(afterExtraEmptySource, 'A source-changing empty clear must finish at the canonical empty string').toBe('');
      expect(afterExtraOwner.history).toEqual({
        undoDepth: beforeExtraOwner.history.undoDepth + 1,
        redoDepth: beforeExtraOwner.history.redoDepth
      });
      expect(afterExtraOwner.revision).toBe(beforeExtraOwner.revision + 1);
    } else {
      expect(beforeExtraEmptySource, 'A source-neutral Backspace must be a true source-zero no-op').toBe('');
      expect(afterExtraEmptySource).toBe('');
      expect(afterExtraOwner.history).toEqual(beforeExtraOwner.history);
      expect(afterExtraOwner.revision).toBe(beforeExtraOwner.revision);
    }
    expect(afterExtraOwner.selection).toEqual({ start: 0, end: 0, direction: 'none' });
    expect(afterExtraOwner.editable).toBe(true);
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
      historyUndoDelta: afterExtraOwner.history.undoDepth - beforeExtraOwner.history.undoDepth,
      historyRedoDelta: afterExtraOwner.history.redoDepth - beforeExtraOwner.history.redoDepth,
      revisionDelta: afterExtraOwner.revision - beforeExtraOwner.revision };
    await page.keyboard.type('X');
    await expect.poll(async () => (await source.inputValue()).trim()).toBe('X');
    await page.keyboard.press('Control+z');
    await expectSource(source, afterExtraEmptySource);
    expect(failures, 'Undo after the empty continuation must not emit an error').toEqual([]);
    await expectLiveSelection(visual);
  } finally {
    await beforeExtraEmptyDom.dispose();
  }
  let restored = false;
  let undoKeys = 0;
  for (; undoKeys < initial.length * 2 + 200; undoKeys += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `rich restoration ${undoKeys}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await source.inputValue() === initial) {
      restored = true;
      undoKeys += 1;
      break;
    }
  }
  expect(restored, 'all Markdown is restored without source assignment').toBe(true);
  await test.info().attach('windowed-threshold-history', {
    body: JSON.stringify({ deletionKeys, undoKeys, noSpacerObserved, firstNoSpacerAt, lastSpacerAt,
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
  const { failures, source, visual } = await openVisual(page, initial);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const previewGate = timing === 'held' ? await holdFormalPreview(page) : null;
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
  const continued = initial.replace(paragraph, `${paragraph.slice(0, -2)}Q`);
  await page.keyboard.type('Q');
  await expectSource(source, continued);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial.replace(paragraph, paragraph.slice(0, -2)));
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  } finally { await previewGate?.close(); }
});
}
}

for (const size of ['full', 'windowed']) {
test(`${size} Unicode reference resolution deletes only the formally rendered image and preserves history`, async ({ page }) => {
  const asset = '/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';
  const image = '![y][Stra\u00dfe]';
  const initial = `[a\u00a0b]: ${asset}#ghost\n\n[STRASSE]: ${asset}\n\n![x][a b] ${image}\n\n`
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const { failures, source, visual } = await openVisual(page, initial);
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
  const expected = initial.replace(image, `${image}X`);
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
});
}

for (const size of ['full', 'windowed']) {
test(`${size} repeated rendered images delete the native target reference rather than an identical neighbor`, async ({ page }) => {
  const asset = '/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';
  const target = '![dot][second]';
  const initial = `[first]: ${asset}\n\n[second]: ${asset}\n\n![dot][first] ${target}\n\n`
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const { failures, source, visual } = await openVisual(page, initial);
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
  await expectSource(source, initial.replace(target, `${target}X`));
  await expect(visual.locator('img')).toHaveCount(2);
  await expect(visual.locator('p').filter({ has: page.locator('img') })).toContainText('X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});
}

test('windowed document deletes rapidly at its end and keeps editing', async ({ page }) => {
  test.setTimeout(300_000);
  const initial = windowedMarkdown('Tail one.\n\nTail two.\n\nTail three.\n\n');
  const { failures, source, visual } = await openWindowedVisual(
    page,
    'Tail one.\n\nTail two.\n\nTail three.\n\n'
  );
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  // Real state, not a timeout: the document end is now the mounted window.
  await expect(visual.locator('p').filter({ hasText: 'Tail three.' })).toBeVisible();
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
  await page.keyboard.type('Z');
  await expect.poll(async () => (await source.inputValue()).trimEnd())
    .toBe(`${after.trimEnd()}Z`);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => await source.inputValue()).toBe(after);
  await expectLiveSelection(visual);
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
  const { failures, source, visual } = await openWindowedVisual(page, tail);
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
  await visual.locator('h2').filter({ hasText: 'Tail heading' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('Q');
  await expect.poll(async () => (await source.inputValue()).includes('## Tail headingQ'),
    { timeout: 15_000 }).toBe(true);
  expect(failures).toEqual([]);
});

for (const shortcut of [
  { marker: '~~~', language: 'python', position: 'start' },
  { marker: '```', language: 'javascript', position: 'end' },
  { marker: '~~~~', language: 'bash', position: 'middle' },
  { marker: '````', language: '', position: 'start' },
  { marker: '~~~', language: '', position: 'end' },
  { marker: '```', language: 'python', position: 'middle' }
]) {
  test(`fence creation and history at ${shortcut.position}: ${shortcut.marker}${shortcut.language}`, async ({ page }) => {
    const initial = 'Before.\n\nMiddle.\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    if (shortcut.position === 'start') {
      await visual.locator('p').first().click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Home');
    } else {
      await visual.locator('p').nth(shortcut.position === 'middle' ? 1 : 2).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type(shortcut.marker + shortcut.language);
    await page.keyboard.press('Enter');
    await page.keyboard.type('x = 1');
    expect(failures).toEqual([]);
    await expect(visual.locator('pre code')).toHaveText('x = 1\n');
    await expect.poll(async () => (await source.inputValue()).includes('x = 1')).toBe(true);
    const created = await source.inputValue();
    expect(new RegExp('(?:^|\\n)(?:`{3,}|~{3,})' + shortcut.language + '\\n').test(created)).toBe(true);
    let undoSteps = 0;
    while (await source.inputValue() !== initial && undoSteps < 40) {
      await page.keyboard.press('Control+z');
      undoSteps += 1;
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await expectSource(source, initial);
    for (let step = 0; step < undoSteps; step += 1) {
      await page.keyboard.press('Control+Shift+z');
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await expectSource(source, created);
    await page.keyboard.type('Z');
    await expectSource(source, created.replace('x = 1', 'x = 1Z'));
    expect(failures).toEqual([]);
  });
}

for (const fence of ['~~~', '```']) {
  test(`${fence} unfinished language shortcut erases without losing selection`, async ({ page }) => {
    const initial = 'Before.\n\nTarget paragraph here.\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const shortcut = `${fence}python`;
    await page.keyboard.type(shortcut);
    for (let index = 0; index < shortcut.length; index += 1) {
      await page.keyboard.press('Backspace');
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await page.keyboard.type('Replacement');
    await expect.poll(async () => (await source.inputValue()).includes('Replacement')).toBe(true);
    await expect(visual.locator('pre')).toHaveCount(0);
    expect(failures).toEqual([]);
  });

  test(`${fence} language shortcut creates code and accepts immediate typing`, async ({ page }) => {
    const { failures, source, visual } = await openVisual(page, 'Before.\n\nTarget paragraph here.\n\nAfter.');
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${fence}bash`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo 123');
    await expect(visual.locator('pre code')).toContainText('echo 123');
    await expectLiveSelection(visual);
    await expect.poll(async () => /(?:`{3,}|~{3,})bash\n(?:[^\n]*\n)*?echo 123/u.test(await source.inputValue())).toBe(true);
    expect(failures).toEqual([]);
    await page.keyboard.press('Control+z');
    await page.keyboard.type('new');
    await expect.poll(async () => (await source.inputValue()).includes('new')).toBe(true);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

test('native EOF Delete remains a no-op and preserves subsequent input and history', async ({ page }) => {
  const initial = 'Before.\n\nTarget paragraph here.\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.evaluate((surface) => {
    window.__nativeNoopEvents = [];
    for (const type of ['beforeinput', 'input']) surface.addEventListener(type, (event) => {
      if (event.inputType !== 'deleteContentForward') return;
      const ranges = event.getTargetRanges?.() ?? [];
      const target = ranges[0];
      window.__nativeNoopEvents.push({ type: event.type, prevented: event.defaultPrevented,
        trusted: event.isTrusted, targetCount: ranges.length,
        targetCollapsed: !!target && target.startContainer === target.endContainer && target.startOffset === target.endOffset });
    });
  });
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Delete');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const events = await page.evaluate(() => window.__nativeNoopEvents);
  expect(events, 'The proved zero-length deletion must complete without leaving a native input transaction open').toEqual([
    { type: 'beforeinput', prevented: true, trusted: true, targetCount: 1, targetCollapsed: true }
  ]);
  await expectSource(source, initial);
  await expectNativeTail(visual.locator('p').last(), 'After.');
  await page.keyboard.type('X');
  await expectSource(source, initial + 'X');
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, initial + 'X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

test('held same-source formal Preview preserves active Chromium composition and history', async ({ page, context }) => {
  test.setTimeout(60_000);
  const definition = '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png\n\n';
  const paragraph = 'Opening ![dot][pic] tail.';
  const initial = definition + paragraph + '\n\n';
  const { failures, source, visual } = await openVisual(page, initial);
  const gate = await holdFormalPreview(page);
  const input = await context.newCDPSession(page);
  let gateClosed = false;
  try {
    const row = visual.locator('p').filter({ has: page.locator('img[alt="dot"]') });
    await row.click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await expectSource(source, initial.replace(paragraph, paragraph + 'X'));
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, initial.replace(paragraph, paragraph + 'X'));
    await page.keyboard.press('Backspace');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
    await gate.waitFor(initial);
    await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await input.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    expect(failures, 'Active browser composition must remain accepted').toEqual([]);
    await expectSource(source, initial);
    const draft = await visual.evaluateHandle((surface) => {
      const native = surface.ownerDocument.getSelection();
      if (!(native?.anchorNode instanceof Text) || !surface.contains(native.anchorNode)) throw new Error('composition-native-draft-missing');
      return native.anchorNode;
    });
    try {
      const delivered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')
          && response.request().postDataJSON()?.markdown === initial && response.status() === 200;
      });
      await gate.close();
      gateClosed = true;
      await delivered;
      await expect.poll(() => visual.getAttribute('data-easymde-preview-phase')).not.toBe('loading');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const retained = await visual.evaluate((surface, node) => {
        const native = surface.ownerDocument.getSelection();
        return { connected: node.isConnected && surface.contains(node),
          draftRetained: node instanceof Text && node.data.endsWith('你'),
          nativeRetained: native?.anchorNode === node && native.focusNode === node,
          focused: surface.ownerDocument.activeElement === surface, editable: surface.isContentEditable };
      }, draft);
      expect(retained, 'The actual same-source PHP response must not replace an active native composition').toEqual({
        connected: true, draftRetained: true, nativeRetained: true, focused: true, editable: true
      });
      expect(failures).toEqual([]);
      await input.send('Input.insertText', { text: '你' });
      const committed = initial.replace(paragraph, paragraph + '你');
      await expectSource(source, committed);
      await page.keyboard.press('Control+z');
      await expectSource(source, initial);
      await page.keyboard.type('Q');
      await expectSource(source, initial.replace(paragraph, paragraph + 'Q'));
      await expectLiveSelection(visual);
      expect(failures).toEqual([]);
    } finally { await draft.dispose(); }
  } finally {
    if (!gateClosed) await gate.close();
    await input.detach();
  }
});
