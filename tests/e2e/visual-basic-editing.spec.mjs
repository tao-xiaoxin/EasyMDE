import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

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

async function readCurrentDocumentOwner(page, ownerObservation = null, fenceObservation = null) {
  return page.evaluate(({ ownerObservation, fenceObservation }) => {
    const root = document.querySelector('#easymde-editor-root');
    const keys = root ? Object.getOwnPropertyNames(root).filter((key) => key.startsWith('__reactContainer$')) : [];
    if (keys.length !== 1) throw new Error('test-document-owner-root-unavailable');
    const current = root[keys[0]]?.stateNode?.current;
    if (current?.tag !== 3) throw new Error('test-document-owner-current-unavailable');
    const owners = new Set();
    const diagnosticFibers = fenceObservation?.pendingProof ? [] : null;
    const pending = current.child ? [current.child] : [];
    let visited = 0;
    while (pending.length) {
      const fiber = pending.pop();
      if (++visited > 8192) throw new Error('test-document-owner-traversal-bound');
      diagnosticFibers?.push(fiber);
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
    if (ownerObservation) {
      if (!window.__shortBranchCausal) throw new Error('test-branch-diagnostic-observer-unavailable');
      const finalRedoStart = ownerObservation.boundary === 'before-final-redo' && ownerObservation.direction === 'redo'
        && Number.isInteger(ownerObservation.targetDepth) && history.redoDepth > 0
        && ownerObservation.targetDepth - history.undoDepth === 1;
      window.__shortBranchCausal.stage({ ...ownerObservation, finalRedoStart }, { selection, history });
    }
    let fenceSnapshot;
    if (fenceObservation) {
      const owned = fenceObservation.ownership;
      const surface = owned?.surface ?? document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      if (!surface) throw new Error('test-fence-continuation-surface-unavailable');
      const paragraphs = [...surface.querySelectorAll(':scope > p')].filter((p) => p.textContent === 'Z');
      const paragraph = paragraphs.length === 1 ? paragraphs[0] : null;
      const text = paragraph?.childNodes.length === 1 && paragraph.firstChild instanceof Text
        && paragraph.firstChild.data === 'Z' ? paragraph.firstChild : null;
      const native = surface.ownerDocument.getSelection();
      const nativeState = { paragraphCount: paragraphs.length, paragraphConnected: !!paragraph?.isConnected,
        surfaceConnected: surface.isConnected, editable: surface.isContentEditable,
        singleZText: !!text, collapsed: native?.isCollapsed === true,
        anchorIsCurrentZText: !!text && native?.anchorNode === text,
        focusIsCurrentZText: !!text && native?.focusNode === text,
        anchorConnectedInside: !!native?.anchorNode?.isConnected && surface.contains(native.anchorNode),
        focusConnectedInside: !!native?.focusNode?.isConnected && surface.contains(native.focusNode),
        anchorOffset: native?.anchorOffset ?? null, focusOffset: native?.focusOffset ?? null };
      let continuedState = null;
      if (owned) {
        const p = owned.paragraph, children = Array.from(surface.childNodes);
        const indexes = owned.following.map((node) => children.indexOf(node));
        continuedState = { sameParagraph: !!p && p.isConnected && p.parentNode === surface,
          independentZParagraph: !!p && p.childNodes.length === 1 && p.firstChild instanceof Text && p.firstChild.data === 'Z',
          nativeTextEnd: !!p && native?.isCollapsed === true && native.anchorNode === p.firstChild && native.focusNode === p.firstChild
            && native.anchorOffset === 1 && native.focusOffset === 1,
          followingIntact: owned.following.every((node) => node.isConnected && node.parentNode === surface)
            && indexes.every((index, at) => index >= 0 && (at === 0 || index > indexes[at - 1])),
          followingTailIntact: owned.following.length > 0 && children.at(-1) === owned.following.at(-1) };
      }
      let branchState = null;
      if (fenceObservation.nativeBranch) {
        const branchParagraphs = [...surface.querySelectorAll(':scope > p')].filter((p) => p.textContent === 'ZB');
        const branchParagraph = branchParagraphs.length === 1 ? branchParagraphs[0] : null;
        const branchText = branchParagraph?.childNodes.length === 1 && branchParagraph.firstChild instanceof Text
          && branchParagraph.firstChild.data === 'ZB' ? branchParagraph.firstChild : null;
        branchState = { paragraphCount: branchParagraphs.length, paragraphConnected: !!branchParagraph?.isConnected,
          paragraphDirect: !!branchParagraph && branchParagraph.parentNode === surface,
          paragraphEditable: !!branchParagraph && branchParagraph.isContentEditable,
          surfaceConnected: surface.isConnected, editable: surface.isContentEditable,
          singleZBText: !!branchText, collapsed: native?.isCollapsed === true,
          anchorIsCurrentZBText: !!branchText && native?.anchorNode === branchText,
          focusIsCurrentZBText: !!branchText && native?.focusNode === branchText,
          anchorIsCurrentZBParagraph: !!branchParagraph && native?.anchorNode === branchParagraph,
          focusIsCurrentZBParagraph: !!branchParagraph && native?.focusNode === branchParagraph,
          anchorConnectedInside: !!native?.anchorNode?.isConnected && surface.contains(native.anchorNode),
          focusConnectedInside: !!native?.focusNode?.isConnected && surface.contains(native.focusNode),
          anchorOffset: native?.anchorOffset ?? null, focusOffset: native?.focusOffset ?? null,
          anchor: { nodeType: native?.anchorNode?.nodeType ?? null,
            tag: native?.anchorNode instanceof Element ? native.anchorNode.tagName : null,
            parentTag: native?.anchorNode?.parentElement?.tagName ?? null,
            offset: native?.anchorOffset ?? null },
          focus: { nodeType: native?.focusNode?.nodeType ?? null,
            tag: native?.focusNode instanceof Element ? native.focusNode.tagName : null,
            parentTag: native?.focusNode?.parentElement?.tagName ?? null,
            offset: native?.focusOffset ?? null } };
      }
      let pendingProof = null;
      if (fenceObservation.pendingProof) {
        const value = owner.getValue();
        const revision = owner.getRevision();
        const refsFor = (fiber) => {
          const refs = []; let count = 0;
          for (let hook = fiber?.memoizedState; hook; hook = hook.next) {
            if (++count > 512) throw new Error('test-document-owner-hook-bound');
            const state = hook.memoizedState;
            if (state && Object.hasOwn(state, 'current')) refs.push(state.current);
          }
          return refs;
        };
        const sourceField = document.querySelector('#easymde-source');
        const editorRoots = diagnosticFibers.filter(({ memoizedProps: props }) => props?.submissionField === sourceField
          && typeof props.nativePublishPort?.read === 'function'
          && typeof props.immersiveStrings?.previewEditorLabel === 'string');
        const runtimes = new Set();
        for (const fiber of editorRoots) for (const ref of refsFor(fiber)) {
          if (ref?.surface === surface && typeof ref.isTransferPending === 'function'
            && typeof ref.isEditable === 'function') runtimes.add(ref);
        }
        const runtime = runtimes.size === 1 ? [...runtimes][0] : null;
        const fullFibers = diagnosticFibers.filter(({ memoizedProps: props }) => props?.surface === surface
          && props.documentSession?.document === owner
          && ['requestPreview', 'retainCompositionSurface', 'onReady'].every((key) => typeof props[key] === 'function'));
        const refs = fullFibers.length === 1 ? refsFor(fullFibers[0]) : [];
        const presentations = [...new Set(refs.filter((ref) => ref && typeof ref.owner === 'object' && ref.owner !== null
          && typeof ref.source === 'string' && typeof ref.visual === 'string' && Number.isInteger(ref.sourceRevision)
          && Array.isArray(ref.nodes) && Array.isArray(ref.metadata) && ref.nodes.length === ref.metadata.length))];
        const presentation = presentations.length === 1 ? presentations[0] : null;
        const transfers = [...new Set(refs.filter((ref) => ref && ['requesting', 'rendering'].includes(ref.phase)
          && ['history', 'native', 'paste'].includes(ref.spec?.kind)
          && typeof ref.spec?.expectation?.value === 'string'))];
        const transfer = transfers.length === 1 ? transfers[0] : null;
        const retained = transfer?.spec.retainedHistoryPresentation;
        const lease = transfer?.visualSelection;
        const nativePath = (node) => {
          if (node === surface) return [];
          if (!node || !surface.contains(node)) return null;
          const path = [];
          for (let current = node; current && current !== surface;) {
            const parent = current.parentNode;
            if (!parent) return null;
            const index = [...parent.childNodes]
              .filter((child) => child === current || !(child instanceof Text && child.data === ''))
              .indexOf(current);
            if (index < 0) return null;
            path.unshift(index); current = parent;
          }
          return path;
        };
        const matchesLease = (node, offset, boundary) => {
          const path = nativePath(node);
          return !!path && !!boundary && offset === boundary.offset && path.length === boundary.path.length
            && path.every((part, at) => part === boundary.path[at]);
        };
        const presentationNodesCurrent = !!presentation && presentation.nodes.length === surface.childNodes.length
          && presentation.nodes.every((node, at) => surface.childNodes[at] === node);
        pendingProof = {
          transferPending: runtime ? runtime.isTransferPending() : null,
          runtimeEditable: runtime ? runtime.isEditable() : null,
          transferKind: transfer?.spec.kind ?? null,
          transferPhase: transfer?.phase ?? null,
          expectationRevisionCurrent: transfer ? transfer.spec.expectation.revision === revision : null,
          expectationValueCurrent: transfer ? transfer.spec.expectation.value === value : null,
          retainedOwnedSameLedger: !!retained && !!presentation && retained.owned === presentation,
          retainedOwnerSameToken: !!retained && !!presentation && retained.owned?.owner === presentation.owner,
          presentationCurrent: !!presentation && presentation.sourceRevision === revision
            && presentation.source === value && presentationNodesCurrent,
          // A retained presentation is authenticated by the exact native
          // endpoints the transfer itself recorded, whether that presentation
          // is collapsed or a ranged view of the same retained span. The
          // canonical caret is a separate point and is never substituted here.
          nativeMatchesLease: !!lease && lease.backward === false
            && matchesLease(native.anchorNode, native.anchorOffset, lease.anchor)
            && matchesLease(native.focusNode, native.focusOffset, lease.focus)
        };
      }
      fenceSnapshot = { nativeState, continuedState, ...(branchState ? { branchState } : {}),
        ...(pendingProof ? { pendingProof } : {}) };
    }
    return {
      selection: { start: selection.start, end: selection.end, direction: selection.direction },
      history: { undoDepth: history.undoDepth, redoDepth: history.redoDepth },
      revision: owner.getRevision(),
      editable: owner.isEditable(),
      sourceInputConnected: owner.getInputElement().isConnected,
      ...(fenceSnapshot ? { fenceSnapshot } : {})
    };
  }, { ownerObservation, fenceObservation });
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
    let previewEvidence;
    if (expected.previewEvidence) {
      const props = windowed[0].memoizedProps;
      if (typeof props.getGeneratedPreviewIdentity !== 'function') throw new Error('test-windowed-reader-preview-getter-unavailable');
      const generated = props.getGeneratedPreviewIdentity();
      const certificate = props.getAcceptedWindowSnapshot();
      const children = [...surface.childNodes];
      const nodesCurrent = !!certificate && certificate.nodes.length === children.length
        && certificate.nodes.every((node, index) => node === children[index]);
      // The owner-local snapshot counter is NOT a publisher generation.
      previewEvidence = { ownerLocalRevision: props.previewSnapshot.revision,
        publisherGeneration: generated?.revision ?? null, publisherSourceRevision: generated?.sourceRevision ?? null,
        windowKey: certificate?.key ?? null, windowGeneration: certificate?.revision ?? null,
        windowSourceRevision: certificate?.sourceRevision ?? null, mapBlocks: props.editMap.blocks.length,
        nodesCurrent, formalCurrent: !!generated && !!certificate && nodesCurrent
          && generated.sourceRevision === owner.getRevision() && certificate.sourceRevision === owner.getRevision()
          && certificate.revision === generated.revision && certificate.signature === generated.signature
          && props.previewSnapshot.signature === generated.signature && props.editMap.signature === generated.signature
          && generated.editMap === props.editMap && certificate.editMap === props.editMap };
    }
    return { phase: surface.getAttribute('data-easymde-preview-phase'), runtimePending,
      pendingNativeAuthentication: runtimePending ? 'unverified-windowed-dom-lease' : 'not-pending',
      runtimeEditable: runtime.isEditable(), documentEditable: owner.isEditable(),
      documentSelection: { start: selection.start, end: selection.end, direction: selection.direction },
      documentHistory: { undoDepth: history.undoDepth, redoDepth: history.redoDepth }, revision: owner.getRevision(),
      ...(expected.expectedSource === undefined ? {} : { sourceMatchesExpected: owner.getValue() === expected.expectedSource }),
      ...(expected.previewEvidence ? { previewEvidence } : {}),
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

async function openVisual(page, markdown, pasteFrom, beforeFixture) {
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
  await beforeFixture?.();
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

const shortStageBlocks = [
  { kind: 'paragraph', source: '中文 abc aaa \\*文字\\*', body: [...'中文 abc aaa ', '\\*', '文', '字', '\\*'] },
  { kind: 'heading', source: '# Heading', body: [...'Heading'] },
  { kind: 'paragraph', source: 'Target paragraph here.', body: [...'Target paragraph here.'] },
  { kind: 'code', source: '~~~bash\necho hi\n~~~', body: [...'echo hi'] },
  { kind: 'paragraph', source: 'End.', body: [...'End.'] }
];
const shortStageInitial = shortStageBlocks.map((block) => block.source).join('\n\n');

function shortStageDeletionOracle(mode) {
  const values = new Map();
  const add = (value, rank) => values.set(value, Math.max(values.get(value) ?? -1, rank));
  if (mode !== 'full') {
    for (let end = shortStageInitial.length; end >= 0; end -= 1) add(shortStageInitial.slice(0, end), end);
  } else {
    // Independently declared EOF states: preceding blocks stay byte-for-byte
    // untouched. Only the current body's literal units and its empty-row
    // representation may disappear; arbitrary subsequences are not accepted.
    for (let index = shortStageBlocks.length - 1; index >= 0; index -= 1) {
      const block = shortStageBlocks[index];
      const prefix = shortStageBlocks.slice(0, index).map((item) => item.source).join('\n\n')
        + (index ? '\n\n' : '');
      for (let remaining = block.body.length; remaining >= 0; remaining -= 1) {
        const body = block.body.slice(0, remaining).join('');
        const source = block.kind === 'code' ? `~~~bash\n${body}\n~~~`
          : block.kind === 'heading' ? `# ${body}` : body;
        for (const ending of ['', '\n', '\n\n']) add(prefix + source + ending, index * 100 + remaining);
      }
      for (const empty of ['', ' ', '  ', '\n', '\n\n']) add(prefix + empty, index * 100);
    }
  }
  add('', 0);
  return values;
}

async function openShortStage(page, mode, initial, beforeFixture) {
  const opened = await openVisual(page, initial, undefined, beforeFixture);
  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  if (mode === 'split') await page.getByRole('button', { name: strings.split, exact: true }).last().click();
  if (mode === 'ordinary') await page.getByRole('button', { name: strings.exit, exact: true }).click();
  const surface = mode === 'full' ? opened.visual : page.locator('.easymde-source-react .cm-content');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute('contenteditable', 'true');
  if (mode === 'full') await expect(opened.visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  if (mode !== 'full') await surface.click();
  return { ...opened, surface, mode };
}

async function installBackgroundProbe(page) {
  const readCapabilities = () => page.evaluate(() => ({
    hooks: typeof window.wp?.hooks?.addAction === 'function'
      && typeof window.wp.hooks.removeAction === 'function'
      && typeof window.wp.hooks.doAction === 'function',
    jquery: typeof window.jQuery === 'function',
    heartbeatInterval: typeof window.wp?.heartbeat?.interval === 'function',
    postChanged: typeof window.wp?.autosave?.server?.postChanged === 'function',
    autosaveInterval: Number(window.autosaveL10n?.autosaveInterval) > 0
  }));
  let capabilities = await readCapabilities();
  const deadline = Date.now() + 15_000;
  while (Object.values(capabilities).some((value) => !value) && Date.now() < deadline) {
    await page.waitForTimeout(100);
    capabilities = await readCapabilities();
  }
  const missing = Object.entries(capabilities)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`background-core-api-missing:${missing.join(',')}`);
  return page.evaluate(() => {
    const readInterval = () => {
      const heartbeat = window.wp?.heartbeat;
      if (!heartbeat || 'function' !== typeof heartbeat.interval) return null;
      try {
        const value = heartbeat.interval();
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    };
    const readMinimalInterval = () => {
      const value = Number(window.heartbeatSettings?.minimalInterval);
      return Number.isFinite(value) && value > 0 && value <= 600 ? value : 0;
    };
    const readHeartbeat = () => {
      const heartbeat = window.wp?.heartbeat;
      let coreHasFocus = null, connectionError = null;
      try {
        if (heartbeat && 'function' === typeof heartbeat.hasFocus) {
          coreHasFocus = Boolean(heartbeat.hasFocus());
        }
      } catch { /* read-only observation */ }
      try {
        if (heartbeat && 'function' === typeof heartbeat.hasConnectionError) {
          connectionError = Boolean(heartbeat.hasConnectionError());
        }
      } catch { /* read-only observation */ }
      return {
        interval: readInterval(),
        minimalInterval: readMinimalInterval(),
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        coreHasFocus,
        connectionError
      };
    };
    const hooks = window.wp?.hooks;
    if (!hooks || 'function' !== typeof hooks.addAction
      || 'function' !== typeof hooks.removeAction) {
      throw new Error('background-hook-api-unavailable');
    }
    if (!window.jQuery) throw new Error('background-jquery-unavailable');
    const send = [], tick = [], autosave = [], autosaveAttempts = [], visibility = [], focus = [];
    let pendingSend = null, pendingAutosaveAttempt = null;
    const onSend = () => {
      const heartbeat = readHeartbeat();
      const entry = { ordinal: send.length + 1, at: performance.now(),
        visibility: heartbeat.visibility, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus };
      send.push(entry);
      pendingSend = entry;
    };
    const onTick = () => {
      const at = performance.now();
      const matched = pendingSend;
      tick.push({ ordinal: tick.length + 1, at,
        durationMs: matched === null ? null : Math.max(0, at - matched.at),
        sendOrdinal: matched?.ordinal ?? null,
        sendVisibility: matched?.visibility ?? null,
        sendDocumentHasFocus: matched?.documentHasFocus ?? null,
        sendCoreHasFocus: matched?.coreHasFocus ?? null,
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus() });
      pendingSend = null;
    };
    const onBeforeAutosave = (_event, data) => {
      const heartbeat = readHeartbeat();
      let postChanged = null, contentMatchesCurrent = null;
      try { postChanged = Boolean(window.wp?.autosave?.server?.postChanged?.()); }
      catch { /* read-only observation */ }
      try {
        const source = document.querySelector('#easymde-source')?.value ?? '';
        contentMatchesCurrent = typeof data?.content === 'string'
          && data.content === source;
      } catch { /* read-only observation */ }
      const entry = { ordinal: autosaveAttempts.length + 1, at: performance.now(),
        visibility: heartbeat.visibility, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus, postChanged, contentMatchesCurrent };
      autosaveAttempts.push(entry);
      pendingAutosaveAttempt = entry;
    };
    const onAfterAutosave = (_event, data) => {
      const matched = pendingAutosaveAttempt;
      autosave.push({ ordinal: autosave.length + 1, at: performance.now(),
        success: data?.success === true,
        status: document.visibilityState,
        attemptOrdinal: matched?.ordinal ?? null,
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus() });
      pendingAutosaveAttempt = null;
    };
    const onVisibility = () => {
      const heartbeat = readHeartbeat();
      visibility.push({ ordinal: visibility.length + 1, at: performance.now(),
        state: document.visibilityState, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    const onFocus = () => {
      const heartbeat = readHeartbeat();
      focus.push({ ordinal: focus.length + 1, at: performance.now(), type: 'focus',
        documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    const onBlur = () => {
      const heartbeat = readHeartbeat();
      focus.push({ ordinal: focus.length + 1, at: performance.now(), type: 'blur',
        documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    hooks.addAction('heartbeat.send', 'easymde-background-probe', onSend);
    hooks.addAction('heartbeat.tick', 'easymde-background-probe', onTick);
    window.jQuery(document).on('before-autosave.easymdeBackgroundProbe', onBeforeAutosave);
    window.jQuery(document).on('after-autosave.easymdeBackgroundProbe', onAfterAutosave);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const localDraftPolicy = () => {
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const general = bootstrap?.settings?.general;
      const drafts = bootstrap?.localDrafts;
      const interval = Number(general?.autoSaveInterval);
      const exposed = Number.isFinite(interval) && interval > 0;
      return { applicable: Boolean(general?.autoSave && drafts?.enabled && exposed),
        exposed, intervalSeconds: exposed ? interval : null };
    };
    const localDraftObservation = () => {
      const policy = localDraftPolicy();
      if (!policy.applicable) return { ...policy, storage: null };
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const drafts = bootstrap?.localDrafts;
      const field = Number(document.querySelector('#post_ID')?.value);
      const postId = Number.isSafeInteger(field) && field >= 0 ? field : Number(drafts?.postId);
      const identity = `${drafts?.siteKey}:${drafts?.userId}:${postId || 'new'}`;
      const key = `easymde:draft:v${drafts?.schemaVersion}:${identity}`;
      const source = document.querySelector('#easymde-source')?.value ?? '';
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
          return { ...policy, storage: { present: false, updatedAt: null,
            contentMatchesCurrent: false, invalid: false } };
        }
        const parsed = JSON.parse(raw);
        const content = typeof parsed?.content === 'string' ? parsed.content : null;
        const updatedAt = Number(parsed?.updatedAt);
        return { ...policy, storage: {
          present: true,
          updatedAt: Number.isInteger(updatedAt) && updatedAt > 0 ? updatedAt : null,
          contentMatchesCurrent: content !== null && content === source,
          invalid: content === null
        } };
      } catch {
        return { ...policy, storage: { present: false, updatedAt: null,
          contentMatchesCurrent: false, invalid: true } };
      }
    };
    window.__easymdeBackgroundProbe = {
      read: () => {
        const surface = document.querySelector('[data-easymde-preview-html-sink]');
        return {
          intervals: { heartbeat: readInterval(),
            autosave: Number(window.autosaveL10n?.autosaveInterval) || null,
            localDraft: localDraftPolicy() },
          heartbeat: readHeartbeat(),
          localDraft: localDraftObservation(),
          send: [...send], tick: [...tick], autosave: [...autosave],
          autosaveAttempts: [...autosaveAttempts], visibility: [...visibility],
          focus: [...focus],
          visibilityState: document.visibilityState,
          documentHasFocus: document.hasFocus(),
          postChanged: Boolean(window.wp?.autosave?.server?.postChanged?.()),
          sessionStatus: document.querySelector('[data-easymde-session-status]')
            ?.getAttribute('data-easymde-session-status') ?? null,
          surfaceEditable: Boolean(surface?.isContentEditable),
          lockPressed: document.querySelector('.easymde-immersive-preview-lock')
            ?.getAttribute('aria-pressed') ?? null
        };
      },
      cleanup: () => {
        hooks.removeAction('heartbeat.send', 'easymde-background-probe');
        hooks.removeAction('heartbeat.tick', 'easymde-background-probe');
        window.jQuery(document).off('before-autosave.easymdeBackgroundProbe');
        window.jQuery(document).off('after-autosave.easymdeBackgroundProbe');
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        delete window.__easymdeBackgroundProbe;
      }
    };
    return { heartbeat: readHeartbeat(),
      autosave: Number(window.autosaveL10n?.autosaveInterval) || null,
      localDraft: localDraftObservation() };
  });
}

async function startShortStageProbe(page, stage, allowedValues, { backgroundObservation = false, allowLocked = false, frames = null } = {}) {
  const healthFailures = [];
  let emptySeen = false;
  await page.exposeFunction('__shortStageSignal', (event) => {
    if (event.kind === 'empty') emptySeen = true;
    else if (event.kind === 'shortcut') console.log(JSON.stringify({ phase: 'short-stage-first-Redo-shortcut', ...event.shortcut }));
    else if (event.kind === 'visual-deviation') frames?.preserveFirstAnomaly(event.code);
    else { frames?.preserveFirstAnomaly(event.code); healthFailures.push(event.code); }
  });
  await page.evaluate(({ mode, allowed, backgroundObservation, allowLocked }) => {
    const root = document.querySelector('#easymde-editor-root');
    const key = Object.getOwnPropertyNames(root).find((name) => name.startsWith('__reactContainer$'));
    const pending = [root[key]?.stateNode?.current?.child], owners = new Set();
    while (pending.length) {
      const fiber = pending.pop();
      if (!fiber) continue;
      for (const owner of [fiber.memoizedProps?.documentSession?.document, fiber.memoizedProps?.ordinaryStatus?.document]) {
        if (owner) owners.add(owner);
      }
      pending.push(fiber.child, fiber.sibling);
    }
    if (owners.size !== 1) throw new Error('short-stage-owner-not-unique');
    const owner = [...owners][0], legal = new Set(allowed), rows = [], health = [];
    let recording = true, active = true, failure = null, ranks = null, previousRank = Infinity;
    const refuse = (code) => {
      if (failure) return;
      const native = getSelection();
      failure = { code, sourceLength: owner.getValue().length, revision: owner.getRevision(),
        history: owner.getHistoryState(), selection: owner.getSelection(),
        native: { anchorConnected: !!native?.anchorNode?.isConnected, focusConnected: !!native?.focusNode?.isConnected,
          anchorTag: native?.anchorNode?.nodeName, anchorOffset: native?.anchorOffset,
          focusTag: native?.focusNode?.nodeName, focusOffset: native?.focusOffset, collapsed: native?.isCollapsed } };
      void window.__shortStageSignal({ kind: 'failure', code });
    };
    // Source/native baselines stay private. Each of at most 16 quiet periods
    // retains first-2/last-30 scalar samples; every rAF/document notification is checked.
    let quiet = null, pauseBaseline = null, layoutObserver = null, firstDeviation = null;
    const periods = [];
    const keep = (first, last, value) => {
      if (first.length < 2) first.push(value);
      else { last.push(value); if (last.length > 30) last.shift(); }
    };
    const surfaceNow = () => mode === 'full'
      ? document.querySelector(allowLocked ? '[data-easymde-preview-html-sink]' : '[data-easymde-preview-html-sink][role="textbox"]')
      : document.querySelector('.easymde-source-react .cm-content');
    const rect = node => {
      const box = node?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
    const deviation = (code, sample) => {
      if (firstDeviation) return;
      firstDeviation = { code, period: quiet?.report.label ?? null, sample };
      void window.__shortStageSignal({ kind: 'visual-deviation', code });
    };
    const sampleQuiet = kind => {
      if (!quiet) {
        if (pauseBaseline) {
          const history = owner.getHistoryState();
          if (owner.getValue() !== pauseBaseline.value || document.querySelector('#easymde-source')?.value !== pauseBaseline.value
            || owner.getRevision() !== pauseBaseline.revision || history.undoDepth !== pauseBaseline.undoDepth
            || history.redoDepth !== pauseBaseline.redoDepth) refuse('short-stage-quiet-document-mutated');
        }
        return;
      }
      const { baseline, report } = quiet, surface = surfaceNow();
      const history = owner.getHistoryState();
      const sample = { kind, at: performance.now(), sourceLength: owner.getValue().length,
        revision: owner.getRevision(), undoDepth: history.undoDepth, redoDepth: history.redoDepth,
        sourceUnchanged: owner.getValue() === baseline.value && document.querySelector('#easymde-source')?.value === baseline.value,
        revisionUnchanged: owner.getRevision() === baseline.revision,
        historyDepthsUnchanged: history.undoDepth === baseline.undoDepth && history.redoDepth === baseline.redoDepth,
        surfaceSame: surface === baseline.surface, phase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null, focused: document.hasFocus(),
        visible: document.visibilityState === 'visible', editable: surface?.isContentEditable === true,
        lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        nodes: baseline.nodes.map(({ selector, node, box }) => {
          const live = surface?.querySelector(selector), current = rect(live);
          return { same: live === node, connected: node.isConnected, visible: Boolean(current && current.width > 0 && current.height > 0
            && current.y < innerHeight && current.y + current.height > 0), box: current,
            delta: box && current ? Math.max(...Object.keys(box).map(key => Math.abs(current[key] - box[key]))) : null };
        }),
        windowScroll: { x: window.scrollX, y: window.scrollY },
        ancestorScroll: baseline.scroll.map(item => ({ top: item.node.scrollTop, left: item.node.scrollLeft })),
        scrollSame: window.scrollX === baseline.windowX && window.scrollY === baseline.windowY
          && baseline.scroll.every(item => item.node.scrollTop === item.top && item.node.scrollLeft === item.left) };
      report.samples++; if (kind === 'raf') report.rafSamples++;
      report.sourceUnchanged &&= sample.sourceUnchanged;
      report.revisionUnchanged &&= sample.revisionUnchanged;
      report.historyDepthsUnchanged &&= sample.historyDepthsUnchanged;
      if (!sample.surfaceSame || sample.nodes.some(node => !node.same || !node.connected)) report.identityChangeSamples++;
      if (sample.nodes.some(node => node.delta === null || node.delta > 0)) report.geometryChangeSamples++;
      if (!sample.scrollSame) report.scrollChangeSamples++;
      report.maxGeometryDelta = Math.max(report.maxGeometryDelta, ...sample.nodes.map(node => node.delta ?? 0));
      keep(report.first, report.last, sample);
      if (!sample.sourceUnchanged || !sample.revisionUnchanged || !sample.historyDepthsUnchanged) refuse('short-stage-quiet-document-mutated');
      if (!sample.surfaceSame || sample.nodes.some(node => !node.same || !node.connected || node.delta === null || node.delta > 0) || !sample.scrollSame) {
        deviation('short-stage-quiet-visual-change', sample);
      }
    };
    const observeLayout = entries => {
      if (!quiet) return;
      for (const entry of entries) {
        if (entry.startTime < quiet.report.startedAt) continue;
        const sample = { at: entry.startTime, value: entry.value, recentInput: entry.hadRecentInput,
          editorSourceCount: (entry.sources ?? []).filter(source => source.node && root.contains(source.node)).length };
        quiet.report.layoutShiftCount++; quiet.report.layoutShiftValue += entry.value;
        keep(quiet.report.layoutFirst, quiet.report.layoutLast, sample);
        if (sample.editorSourceCount) deviation('short-stage-editor-layout-shift', sample);
      }
    };
    const layoutShiftSupported = backgroundObservation && Boolean(window.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift'));
    if (layoutShiftSupported) {
      layoutObserver = new PerformanceObserver(list => observeLayout(list.getEntries()));
      layoutObserver.observe({ type: 'layout-shift', buffered: false });
    }
    const endQuiet = () => {
      observeLayout(layoutObserver?.takeRecords() ?? []); sampleQuiet('end');
      if (quiet) {
        quiet.report.endedAt = performance.now(); quiet = null;
      }
      return { failure, firstDeviation, layoutShiftSupported, periods };
    };
    const beginQuiet = label => {
      endQuiet();
      if (periods.length >= 16) return refuse('short-stage-quiet-period-bound');
      const surface = surfaceNow(), history = owner.getHistoryState();
      pauseBaseline ??= { value: owner.getValue(), revision: owner.getRevision(), undoDepth: history.undoDepth, redoDepth: history.redoDepth };
      const nodes = ['h1', 'p'].map(selector => ({ selector, node: surface?.querySelector(selector) }))
        .filter(item => item.node && (() => { const box = rect(item.node); return box && box.width > 0 && box.height > 0
          && box.y < innerHeight && box.y + box.height > 0; })())
        .map(item => ({ ...item, box: rect(item.node) }));
      const scroll = [];
      let ancestor = surface;
      for (; ancestor && scroll.length < 16; ancestor = ancestor.parentElement) scroll.push({ node: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
      const report = { label, startedAt: performance.now(), endedAt: null, samples: 0, rafSamples: 0,
        visibleUntouchedNodeCount: nodes.length, sourceUnchanged: true, revisionUnchanged: true, historyDepthsUnchanged: true,
        baseline: { sourceLength: pauseBaseline.value.length, revision: pauseBaseline.revision,
          undoDepth: pauseBaseline.undoDepth, redoDepth: pauseBaseline.redoDepth }, scrollAncestorSamplingComplete: ancestor === null,
        identityChangeSamples: 0, geometryChangeSamples: 0, scrollChangeSamples: 0, maxGeometryDelta: 0,
        layoutShiftCount: 0, layoutShiftValue: 0, first: [], last: [], layoutFirst: [], layoutLast: [] };
      quiet = { baseline: { ...pauseBaseline, surface, nodes, scroll, windowX: window.scrollX, windowY: window.scrollY }, report };
      periods.push(report); sampleQuiet('begin');
    };
    const observe = () => {
      if (!recording || failure) return;
      sampleQuiet('document');
      const value = owner.getValue();
      if (!legal.has(value)) return refuse('short-stage-independent-source-oracle');
      if (ranks) {
        const rank = ranks.get(value);
        if (rank > previousRank) return refuse('short-stage-independent-deletion-order');
        previousRank = rank;
      }
      if (rows.length === 1024) return refuse('short-stage-canonical-observation-bound');
      rows.push({ value, history: owner.getHistoryState(), revision: owner.getRevision() });
      if (value === '') void window.__shortStageSignal({ kind: 'empty' });
    };
    const unsubscribe = owner.subscribe(observe);
    observe();
    const sample = () => {
      if (!active) return;
      const surface = surfaceNow();
      const native = getSelection();
      const state = { editable: owner.isEditable() && !!surface?.isContentEditable,
        lock: mode === 'full' ? document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') : null,
        nativeConnected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected,
        nativeInside: !!surface && !!native?.anchorNode && !!native?.focusNode
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        failure: !!document.querySelector('[data-easymde-visual-failure]') };
      const userLocked = allowLocked && state.lock === 'true';
      if ((!state.editable && !userLocked) || state.failure || mode === 'full' && state.lock !== 'false' && !userLocked) refuse('short-stage-lock-or-editability');
      if (!userLocked && (!state.nativeConnected || !state.nativeInside)) refuse('short-stage-native-selection-outside-owner');
      sampleQuiet('raf');
      if (health.length < 128 && JSON.stringify(health.at(-1)) !== JSON.stringify(state)) health.push(state);
      requestAnimationFrame(sample);
    };
    sample();
    let firstRedo = null;
    const onShortcut = (event) => {
      if (firstRedo || !(event.ctrlKey || event.metaKey) || event.code !== 'KeyZ' || !event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      firstRedo = { key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey,
        shift: event.shiftKey, alt: event.altKey, trusted: event.isTrusted,
        owner: target?.closest('.easymde-source-react .cm-content') ? 'Source'
          : target?.closest('[data-easymde-preview-html-sink][role="textbox"]') ? 'Visual' : 'outside',
        history: owner.getHistoryState(), selection: owner.getSelection(), revision: owner.getRevision() };
      void window.__shortStageSignal({ kind: 'shortcut', shortcut: firstRedo });
    };
    document.addEventListener('keydown', onShortcut, true);
    window.__shortStageProbe = {
      snapshot: () => ({ rows: [...rows], health: [...health], failure, firstRedo }),
      beginQuiet, endQuiet,
      resumeEditing: () => { const observation = endQuiet(); pauseBaseline = null; return observation; },
      beginDeletion: (entries) => {
        ranks = new Map(entries); previousRank = Infinity;
        legal.clear(); for (const value of ranks.keys()) legal.add(value);
        rows.length = 0; observe();
      },
      allow: (values) => { ranks = null; legal.clear(); for (const value of values) legal.add(value); },
      stopRecording: () => { recording = false; unsubscribe(); },
      stop: () => { endQuiet(); layoutObserver?.disconnect(); active = false; recording = false; unsubscribe(); document.removeEventListener('keydown', onShortcut, true); }
    };
  }, { mode: stage.mode, allowed: [...allowedValues], backgroundObservation, allowLocked });
  const onPopup = () => healthFailures.push('short-stage-popup');
  page.on('popup', onPopup);
  const guard = () => {
    frames?.guard();
    expect(stage.failures, 'short-stage continuous editor errors').toEqual([]);
    expect(healthFailures, 'short-stage continuous health monitor').toEqual([]);
  };
  return {
    guard,
    async beginQuiet(label) {
      guard(); frames?.stage(label);
      await page.evaluate(label => window.__shortStageProbe.beginQuiet(label), label);
      guard();
    },
    async endQuiet() {
      const observation = await page.evaluate(() => window.__shortStageProbe.endQuiet());
      expect(observation.failure, 'quiet period preserves source/revision/history depths').toBeNull();
      guard();
    },
    async resumeEditing() {
      const observation = await page.evaluate(() => window.__shortStageProbe.resumeEditing());
      expect(observation.failure, 'quiet periods preserve document before resumed editing').toBeNull();
      guard();
    },
    empty: () => emptySeen,
    press: async (key) => { guard(); await page.keyboard.press(key); guard(); },
    type: async (text) => {
      for (const character of text) { guard(); await page.keyboard.type(character); guard(); }
    },
    snapshot: () => page.evaluate(() => window.__shortStageProbe.snapshot()),
    freeze: () => page.evaluate(() => window.__shortStageProbe.stopRecording()),
    beginDeletion: (oracle) => page.evaluate((entries) => window.__shortStageProbe.beginDeletion(entries), [...oracle]),
    allow: (values) => page.evaluate((allowed) => window.__shortStageProbe.allow(allowed), [...values]),
    async stop() {
      page.off('popup', onPopup);
      let observation = null;
      try {
        if (backgroundObservation) {
          observation = await page.evaluate(() => window.__shortStageProbe.endQuiet());
          console.log(JSON.stringify({ phase: 'short-stage-background-scalar-evidence',
            sampling: 'every-rAF-and-document-notification; max-16-periods; first-2-last-30-per-period', ...observation }));
        }
      } finally { await page.evaluate(() => window.__shortStageProbe?.stop()); }
      if (backgroundObservation) {
        expect(observation.failure, 'quiet period document invariants survive cleanup').toBeNull();
        guard();
      }
    }
  };
}

async function startShortStageFrames(page, surface, { retainStages = false } = {}) {
  const require = createRequire(import.meta.url);
  const { PNG } = require(join(dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
  const box = await surface.boundingBox(), viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('short-stage-private-frame-region-unavailable');
  const clip = { x: Math.max(0, Math.ceil(box.x)), y: Math.max(0, Math.ceil(box.y)),
    right: Math.min(viewport.width, Math.floor(box.x + box.width)),
    bottom: Math.min(viewport.height, Math.floor(box.y + box.height)) };
  if (clip.right <= clip.x || clip.bottom <= clip.y) throw new Error('short-stage-private-frame-region-empty');
  if (retainStages) {
    const configured = test.info().project.use;
    const assets = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
      .map(entry => new URL(entry.name).pathname.split('/').at(-1))
      .filter(name => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
    console.log(JSON.stringify({ phase: 'short-stage-background-runtime', browserVersion: page.context().browser()?.version() ?? null,
      headless: configured.headless ?? true, channel: configured.channel ?? null,
      configuredBinary: configured.launchOptions?.executablePath?.split(/[\\/]/u).at(-1) ?? null,
      expectedAsset: process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD ?? null, assets }));
  }
  const cdp = await page.context().newCDPSession(page), first = [], tail = [], pendingAcks = new Set(), failures = [];
  let operation = 'before-actions', lifecycle = 'running', acceptingFrames = true, ackTotal = 0, ackSucceeded = 0;
  const stages = new Map();
  let anomaly = null;
  const stage = label => {
    operation = label;
    if (!retainStages || stages.has(label)) return;
    if (stages.size === 16) { recordFailure('stage-bound', new Error('stage-bound')); return; }
    stages.set(label, { received: 0, first: [], last: [] });
  };
  const recordFailure = (stage, error, ackOrdinal = null) => {
    const message = typeof error?.message === 'string' ? error.message : '';
    const code = message.includes('Target page, context or browser has been closed') ? 'cdp-target-closed'
      : /session closed/iu.test(message) ? 'cdp-session-closed' : 'frame-operation-rejected';
    const failure = { stage, lifecycle, operation, ackOrdinal, code,
      errorClass: typeof error?.name === 'string' && /^[A-Za-z]*Error$/u.test(error.name) ? error.name : 'UnknownError' };
    failures.push(failure);
    console.log(JSON.stringify({ phase: 'short-stage-frame-capture-failure', ...failure }));
  };
  stage(operation);
  const onFrame = (event) => {
    if (acceptingFrames) {
      const frame = { data: event.data, operation, timestamp: event.metadata.timestamp, ordinal: ackTotal + 1 };
      if (first.length < 2) first.push(frame);
      else { tail.push(frame); if (tail.length > 30) tail.shift(); }
      const period = stages.get(operation);
      if (period) {
        period.received++;
        if (!period.first.length) period.first.push(frame);
        else { period.last.push(frame); if (period.last.length > 2) period.last.shift(); }
      }
      if (anomaly?.awaitingAfter) { anomaly.after = frame; anomaly.awaitingAfter = false; }
    }
    const ordinal = ++ackTotal;
    let sending;
    try { sending = cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }); }
    catch (error) { recordFailure('ack', error, ordinal); return; }
    const ack = sending.then(() => { ackSucceeded += 1; }, (error) => { recordFailure('ack', error, ordinal); });
    pendingAcks.add(ack);
    void ack.then(() => { pendingAcks.delete(ack); }, () => { pendingAcks.delete(ack); });
  };
  cdp.on('Page.screencastFrame', onFrame);
  try { await cdp.send('Page.startScreencast', { format: 'png', maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 }); }
  catch (error) {
    lifecycle = 'setup-failed'; recordFailure('start-screencast', error);
    acceptingFrames = false; cdp.off('Page.screencastFrame', onFrame);
    await Promise.allSettled([...pendingAcks]);
    try { await cdp.detach(); } catch (detachError) { recordFailure('detach', detachError); }
    throw new Error('short-stage-compositor-start-failed');
  }
  return {
    stage,
    guard() { if (failures.length) throw new Error('short-stage-compositor-capture-failed'); },
    preserveFirstAnomaly(code) {
      if (!anomaly) anomaly = { code, operation, before: tail.at(-1) ?? first.at(-1) ?? null,
        after: null, awaitingAfter: true };
    },
    async stop(label) {
      lifecycle = 'stopping';
      const pendingAtStop = pendingAcks.size;
      try { await cdp.send('Page.stopScreencast'); }
      catch (error) { recordFailure('stop-screencast', error); }
      finally { acceptingFrames = false; cdp.off('Page.screencastFrame', onFrame); }
      await Promise.allSettled([...pendingAcks]);
      const pendingAtDetach = pendingAcks.size;
      try { await cdp.detach(); } catch (error) { recordFailure('detach', error); }
      lifecycle = 'stopped';
      const frames = [...new Set([...first, ...tail, ...[...stages.values()].flatMap(period => [...period.first, ...period.last]),
        ...[anomaly?.before, anomaly?.after].filter(Boolean)])].sort((left, right) => left.ordinal - right.ordinal), evidence = [];
      try {
        for (const [index, frame] of frames.entries()) {
          // Decode/crop only after actions and transport shutdown. Raw viewport frames never leave memory.
          const image = PNG.sync.read(Buffer.from(frame.data, 'base64'));
          const sx = image.width / viewport.width, sy = image.height / viewport.height;
          const x = Math.ceil(clip.x * sx), y = Math.ceil(clip.y * sy);
          const width = Math.floor(clip.right * sx) - x, height = Math.floor(clip.bottom * sy) - y;
          const cropped = new PNG({ width, height });
          PNG.bitblt(image, cropped, x, y, width, height, 0, 0);
          const path = test.info().outputPath(`${label}-article-frame-${index}.png`);
          await writeFile(path, PNG.sync.write(cropped));
          await test.info().attach(`${label}-article-frame-${index}`, { path, contentType: 'image/png' });
          evidence.push({ operation: frame.operation, ordinal: frame.ordinal, timestamp: frame.timestamp, width, height });
        }
      } catch (error) { recordFailure('crop-save-attach', error); }
      console.log(JSON.stringify({ phase: 'short-stage-private-compositor-evidence', label,
        sampling: retainStages ? 'continuous-ACK; first-2-last-30-global; max-16-stages-first-1-last-2; max-2-anomaly-neighbors; max-82-retained-frames'
          : 'first-2-last-30-limited-coverage', frameCount: frames.length, savedFrameCount: evidence.length,
        captureClip: clip,
        periods: [...stages].map(([label, period]) => ({ label, received: period.received,
          retained: period.first.length + period.last.length })),
        anomaly: anomaly ? { code: anomaly.code, operation: anomaly.operation, beforeOrdinal: anomaly.before?.ordinal ?? null,
          afterOrdinal: anomaly.after?.ordinal ?? null, capture: 'last-received-before-and-first-after-signal-not-onset-proof' } : null,
        ackAudit: { total: ackTotal, succeeded: ackSucceeded, rejected: failures.filter((failure) => failure.stage === 'ack').length,
          pendingAtStop, pendingAtDetach, pendingAfterCleanup: pendingAcks.size }, failures, frames: evidence }));
      if (failures.length) throw new Error('short-stage-compositor-capture-failed');
      expect(frames.length, 'bounded compositor evidence requires more than one real frame').toBeGreaterThan(1);
    }
  };
}

function shortStageHistoryLedger(rows, initial, allowed) {
  const ledger = new Map(), baseline = rows[0].history.undoDepth;
  for (const row of rows) {
    expect(allowed.has(row.value), 'each historical source was independently declared and verified').toBe(true);
    expect(row.history.undoDepth).toBeGreaterThanOrEqual(baseline);
    if (row.history.undoDepth === baseline) {
      expect(row.value === initial, 'fixture must remain a reachable history boundary').toBe(true);
    }
    ledger.set(row.history.undoDepth, row.value);
  }
  return { ledger, baseline, latest: rows.at(-1).history.undoDepth };
}

async function shortStageReplayHistory(page, stage, probe, history, direction, targetDepth, observationReferences = null, sourceContract = null) {
  const key = direction === 'undo' ? 'Control+z' : 'Control+Shift+Z';
  const bound = history.ledger.size * 3 + 16;
  const sourceUndo = sourceContract?.mode === 'source' && direction === 'undo';
  const sourceRedo = sourceContract?.mode === 'source' && direction === 'redo';
  const expectedRedo = sourceContract?.expectedRedo ?? null;
  for (let step = 0; step < bound; step += 1) {
    const before = await readCurrentDocumentOwner(page, observationReferences
      ? { phase: 'history', boundary: direction === 'redo' ? 'before-final-redo' : 'before-history-undo', direction, targetDepth, step, references: observationReferences } : null);
    if (sourceUndo) {
      if (before.history.undoDepth === targetDepth) return;
      const beforeExpected = history.ledger.get(before.history.undoDepth);
      expect(beforeExpected, 'source undo must begin at a declared fixture state').toBeDefined();
      await expectSource(stage.source, beforeExpected);
    } else if (sourceRedo) {
      if (expectedRedo.length === 0) {
        expect(before.history.redoDepth, 'source redo must exhaust the real redo stack').toBe(0);
        return;
      }
      expect(before.history.redoDepth, 'source redo must not issue an empty Redo').toBeGreaterThan(0);
    } else if (before.history.undoDepth === targetDepth) return;
    await probe.press(key);
    const after = await readCurrentDocumentOwner(page, observationReferences
      ? { phase: 'history', boundary: direction === 'redo' ? 'after-final-redo' : 'after-history-undo', direction, targetDepth, step } : null);
    console.log(JSON.stringify({ phase: 'short-stage-history-step', mode: stage.mode, direction, step,
      before, after }));
    if (sourceRedo) {
      expect(after.history.redoDepth).toBeLessThan(before.history.redoDepth);
      expect(after.history.undoDepth).toBeGreaterThan(before.history.undoDepth);
      const expectedSource = expectedRedo.pop();
      expect(expectedSource, 'source redo expectation must be unique').toBeDefined();
      await expectSource(stage.source, expectedSource);
    } else if (sourceUndo) {
      expect(after.history.undoDepth).toBeLessThan(before.history.undoDepth);
      const afterExpected = history.ledger.get(after.history.undoDepth);
      expect(afterExpected, 'source undo must land on a declared fixture state').toBeDefined();
      await expectSource(stage.source, afterExpected);
      const beforeExpected = history.ledger.get(before.history.undoDepth);
      if (after.history.redoDepth > before.history.redoDepth) {
        expectedRedo.push(beforeExpected);
      } else {
        expect(afterExpected, 'undo without redo growth must not drop a source mutation')
          .toBe(beforeExpected);
      }
    } else {
      expect(direction === 'undo' ? after.history.undoDepth <= before.history.undoDepth
        : after.history.undoDepth >= before.history.undoDepth).toBe(true);
      expect(history.ledger.has(after.history.undoDepth), 'natural history group must have a verified expected source').toBe(true);
      await expectSource(stage.source, history.ledger.get(after.history.undoDepth));
    }
    console.log(JSON.stringify({ phase: 'short-stage-history-exact', mode: stage.mode, direction, step,
      undoDepth: after.history.undoDepth, exact: true }));
  }
  throw new Error('short-stage-natural-history-progress-bound');
}

async function finishShortStageObservation(probe, frames, label, failed) {
  let firstCleanupError = null;
  for (const cleanup of [() => probe.stop(), () => frames.stop(label)]) {
    try { await cleanup(); }
    catch (error) {
      firstCleanupError ??= error;
      console.log(JSON.stringify({ phase: 'short-stage-evidence-cleanup-failure', label, errorClass: error.name,
        code: /^short-stage-[a-z-]+$/u.test(error.message ?? '') ? error.message : 'cleanup-operation-rejected' }));
    }
  }
  if (!failed && firstCleanupError) throw firstCleanupError;
}

for (const mode of ['ordinary', 'split', 'full']) {
for (const pacing of ['normal', 'burst']) {
  test(`[short-stage] ${mode} ${pacing} mixed lifecycle reaches source zero and replays natural history`, async ({ page }) => {
    const stage = await openShortStage(page, mode, shortStageInitial);
    const diagnosticModule = mode === 'full' && pacing === 'normal' ? process.env.EASYMDE_E2E_BRANCH_DIAGNOSTIC_MODULE : null;
    const branchDiagnostic = diagnosticModule ? await (await import(diagnosticModule)).start(page, {
      outputPath: test.info().outputPath('branch-causal-observation-v6.json')
    }) : null;
    const positions = [
      { selector: 'p', index: 0, needle: shortStageBlocks[0].source, offset: 1 },
      { selector: 'h1', index: 0, needle: 'Heading', offset: 2 },
      { selector: 'p', index: 1, needle: 'Target paragraph here.', offset: 7 },
      { selector: 'pre code', index: 0, needle: 'echo hi', offset: 2 },
      { selector: 'p', index: 2, needle: 'End.', offset: 1 }
    ];
    const oracle = shortStageDeletionOracle(mode);
    const entered = mode === 'full' ? 'Z\n\n  ' : 'Z\n';
    const continued = mode === 'full' ? 'Z\n\nXY' : 'Z\nXY';
    const shortened = mode === 'full' ? 'Z\n\nX' : 'Z\nX';
    const allowed = new Set([...oracle.keys(), 'Z', entered, continued, shortened]);
    for (const position of positions) {
      const offset = shortStageInitial.indexOf(position.needle) + position.offset;
      allowed.add(shortStageInitial.slice(0, offset) + 'V' + shortStageInitial.slice(offset));
    }
    const probe = await startShortStageProbe(page, stage, allowed);
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'whole-document-Backspace', failed = true;
    try {
      phase = 'real-mouse-and-arrow-positions'; frames.stage(phase);
      for (const position of positions) {
        const sourceOffset = shortStageInitial.indexOf(position.needle) + position.offset;
        probe.guard();
        if (mode === 'full') {
          await stage.visual.locator(position.selector).nth(position.index).click({ position: { x: 3, y: 3 } });
          await probe.press('Home');
          for (let index = 0; index < position.offset; index += 1) await probe.press('ArrowRight');
        } else {
          await stage.surface.click(); await probe.press('Control+Home');
          for (let index = 0; index < sourceOffset; index += 1) await probe.press('ArrowRight');
        }
        await probe.type('V');
        await expectSource(stage.source, shortStageInitial.slice(0, sourceOffset) + 'V' + shortStageInitial.slice(sourceOffset));
        await probe.press('Backspace'); await expectSource(stage.source, shortStageInitial);
      }
      await stage.surface.click(); await probe.press('Control+End');
      await probe.beginDeletion(oracle);
      phase = 'whole-document-Backspace';
      frames.stage(phase);
      let rank = Infinity, consumed = 0;
      const checkDeletionRows = async () => {
        const observation = await probe.snapshot();
        for (const row of observation.rows.slice(consumed)) {
          expect(oracle.has(row.value), 'EOF deletion must match a complete independently declared state').toBe(true);
          const next = oracle.get(row.value);
          expect(next, 'EOF deletion may not grow or reorder a preceding block').toBeLessThanOrEqual(rank);
          rank = next;
        }
        consumed = observation.rows.length;
        probe.guard();
      };
      for (let key = 0; key < shortStageInitial.length * 3 + 16 && !probe.empty(); key += 1) {
        await probe.press('Backspace');
        if (pacing === 'normal') await checkDeletionRows();
      }
      await expectSource(stage.source, '');
      await checkDeletionRows();
      phase = 'extra-Backspace-at-source-zero'; frames.stage(phase);
      const zero = await readCurrentDocumentOwner(page);
      for (let key = 0; key < 3; key += 1) await probe.press('Backspace');
      await expectSource(stage.source, '');
      const afterExtra = await readCurrentDocumentOwner(page);
      expect(afterExtra.history).toEqual(zero.history);
      expect(afterExtra.revision).toBe(zero.revision);
      expect(afterExtra.selection).toEqual(zero.selection);
      phase = 'empty-input-Enter-immediate-input'; frames.stage(phase);
      await probe.allow(new Set(['', 'Z', entered, continued, shortened]));
      await probe.type('Z');
      if (pacing === 'normal') await expectSource(stage.source, 'Z');
      await probe.press('Enter');
      if (pacing === 'normal') await expectSource(stage.source, entered);
      await probe.type('XY');
      await expectSource(stage.source, continued);
      await probe.press('Backspace');
      await expectSource(stage.source, shortened);
      const forward = await probe.snapshot();
      const history = shortStageHistoryLedger(forward.rows, shortStageInitial, allowed);
      await probe.freeze();
      phase = 'groupwise-Undo-full-exact'; frames.stage(phase);
      await shortStageReplayHistory(page, stage, probe, history, 'undo', history.baseline, branchDiagnostic ? {} : null);
      await expectSource(stage.source, shortStageInitial);
      phase = 'groupwise-Redo-full-exact'; frames.stage(phase);
      await shortStageReplayHistory(page, stage, probe, history, 'redo', history.latest,
        branchDiagnostic ? { continued, shortened, branched: continued + 'B' } : null);
      await expectSource(stage.source, shortened);
      phase = 'history-branch-and-continuation'; frames.stage(phase);
      await probe.press('Control+z');
      const branchPoint = await readCurrentDocumentOwner(page, branchDiagnostic ? { phase: 'branch', boundary: 'branch' } : null);
      expect(history.ledger.has(branchPoint.history.undoDepth)).toBe(true);
      const branchBefore = history.ledger.get(branchPoint.history.undoDepth);
      await expectSource(stage.source, branchBefore);
      const branch = branchBefore.slice(0, branchPoint.selection.start) + 'B' + branchBefore.slice(branchPoint.selection.end);
      await probe.type('B');
      await expectSource(stage.source, branch);
      expect((await readCurrentDocumentOwner(page)).history.redoDepth).toBe(0);
      await probe.press('Control+z'); await expectSource(stage.source, branchBefore);
      await probe.press('Control+Shift+Z'); await expectSource(stage.source, branch);
      await probe.press('Control+z'); await expectSource(stage.source, branchBefore);
      await shortStageReplayHistory(page, stage, probe, history, 'undo', history.baseline, branchDiagnostic ? {} : null);
      await expectSource(stage.source, shortStageInitial);
      phase = 'restored-middle-direct-continuation'; frames.stage(phase);
      const offset = shortStageInitial.indexOf('Target paragraph here.') + 1;
      if (mode === 'full') {
        await stage.visual.locator('p').nth(1).click({ position: { x: 3, y: 3 } });
        await probe.press('Home'); await probe.press('ArrowRight');
      } else {
        await stage.surface.click(); await probe.press('Control+Home');
        for (let index = 0; index < offset; index += 1) await probe.press('ArrowRight');
      }
      await probe.type('Q');
      await expectSource(stage.source, shortStageInitial.slice(0, offset) + 'Q' + shortStageInitial.slice(offset));
      await probe.press('Control+z'); await expectSource(stage.source, shortStageInitial);
      if (mode === 'full') await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      console.log(JSON.stringify({ phase: 'short-stage-lifecycle-complete', mode, pacing,
        trueSourceZero: true, naturalHistoryGroups: history.ledger.size - 1,
        final: await readCurrentDocumentOwner(page), health: forward.health, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-lifecycle-first-failure', mode, pacing, operation: phase,
        owner: await readCurrentDocumentOwner(page), failures: stage.failures,
        firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      if (branchDiagnostic) await branchDiagnostic.stop({ failed });
      await finishShortStageObservation(probe, frames, `short-${mode}-${pacing}`, failed);
    }
  });
}
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

test('a rejected secondary image gesture keeps the authored text range and the generic menu', async ({ page }) => {
  const image = '![test image](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const initial = `Para\n\n${image}\n\nfoo\n`;
  const { failures, source, visual } = await openVisual(page, initial);
  await expect.poll(() => visual.locator('img').evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
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
  await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  expect(failures).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  await expectSource(source, withSpace);
  await visual.locator('img').click({ button: 'right' });
  await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  expect(failures).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.type('Z');
  await expectSource(source, withSpace.replace('Para', 'PZa'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
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

test('windowed held PHP history keeps complete math range through release and replacement Undo', async ({ page }) => {
  // Same-P complete-math selection: fixed source [1,14], not a three-block range.
  const tail = '\n\nTarget.\n\nAfter.';
  const initial = 'Before\n$x$\nAfter' + tail + '\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const typed = initial.replace(tail, '\n\nTarget.V\n\nAfter.');
  const selection = { start: 1, end: 14, direction: 'forward' };
  const replaced = initial.slice(0, selection.start) + 'X' + initial.slice(selection.end);
  const { failures, source, visual } = await openVisual(page, initial);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null, phase = 'initial-formal-window', lastAtom = null;
  const checkpoint = async (expected, pending = false) => {
    await expectSource(source, expected);
    await expect.poll(async () => {
      lastAtom = await readWindowedSmokeState(visual, { expectedSource: expected, previewEvidence: true });
      return lastAtom.sourceMatchesExpected && lastAtom.runtimePending === pending
        && (pending || lastAtom.phase === 'ready' && lastAtom.previewEvidence.formalCurrent);
    }).toBe(true);
    expect(failures).toEqual([]);
    expect(lastAtom).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready', windowedControllerCount: 1, runtimeCount: 1 });
    expect(lastAtom.spacers).toBeGreaterThan(0);
    expect(lastAtom.previewEvidence.mapBlocks).toBeGreaterThan(160);
    return lastAtom;
  };
  const unchangedOwner = async (before) => {
    const after = await readCurrentDocumentOwner(page);
    expect(after).toMatchObject({ revision: before.revision, history: before.history, selection: before.selection, editable: true });
  };
  const nativeRange = async (measure = false) => visual.evaluate((surface, measure) => {
    const paragraphs = [...surface.querySelectorAll('p')].filter((p) => p.textContent.includes('Before') && p.textContent.includes('After'));
    if (paragraphs.length !== 1) throw new Error('test-windowed-math-paragraph-not-unique');
    const paragraph = paragraphs[0], maths = paragraph.querySelectorAll('.easymde-math[data-easymde-rendered]');
    if (maths.length !== 1) throw new Error('test-windowed-math-object-not-unique');
    const math = maths[0];
    const boundary = (needle, delta) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.easymde-math')) continue;
        const at = node.textContent.indexOf(needle);
        if (at >= 0) matches.push({ node, offset: at + delta });
      }
      if (matches.length !== 1) throw new Error('test-windowed-math-boundary-not-unique');
      return matches[0];
    };
    const start = boundary('Before', 1), end = boundary('After', 3);
    const point = ({ node, offset }) => {
      const range = document.createRange(); range.setStart(node, offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('test-windowed-math-boundary-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    };
    const native = getSelection(), range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const atom = document.createRange(); atom.selectNode(math);
    return { points: measure ? { start: point(start), end: point(end) } : null,
      proof: { anchorExact: native?.anchorNode === start.node && native.anchorOffset === start.offset,
        focusExact: native?.focusNode === end.node && native.focusOffset === end.offset,
        anchorOffset: native?.anchorOffset ?? null, focusOffset: native?.focusOffset ?? null,
        connected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected,
        focused: document.activeElement === surface,
        forward: !!range && !native.isCollapsed && range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset,
        wholeMath: !!range && range.compareBoundaryPoints(Range.START_TO_START, atom) <= 0
          && range.compareBoundaryPoints(Range.END_TO_END, atom) >= 0
          && !math.contains(native.anchorNode) && !math.contains(native.focusNode) } };
  }, measure);
  const expectNativeRange = async () => {
    expect((await nativeRange()).proof).toEqual({ anchorExact: true, focusExact: true, anchorOffset: 1, focusOffset: 4,
      connected: true, focused: true, forward: true, wholeMath: true });
  };
  try {
    const baseline = await checkpoint(initial);
    phase = 'real-V-input'; await visual.locator('p').filter({ hasText: 'Target.' }).first().click();
    await page.keyboard.press('End'); await page.keyboard.type('V'); await expectSource(source, typed);
    expect(failures).toEqual([]);
    const beforeLock = await readCurrentDocumentOwner(page);
    expect(beforeLock.revision).toBe(baseline.revision + 1);
    expect(beforeLock.history).toEqual({ undoDepth: baseline.documentHistory.undoDepth + 1, redoDepth: 0 });
    // Explicit user preparation: a newly accepted V Preview makes the later
    // real Undo use a formal history transfer, not an ordinary input debounce.
    const formalV = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === typed; } catch { return false; }
    }).then((response) => response, () => null);
    phase = 'explicit-user-lock-and-formal-V'; await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    expect(await sink.evaluate((surface) => surface.isContentEditable)).toBe(false);
    await unchangedOwner(beforeLock); await expectSource(source, typed); expect(failures).toEqual([]);
    const response = await formalV; expect(response, 'The explicit lock must receive the real V PHP response').not.toBeNull();
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(sink).toHaveAttribute('aria-busy', 'false');
    await unchangedOwner(beforeLock); await expectSource(source, typed);
    phase = 'explicit-user-unlock'; await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    const acceptedV = await checkpoint(typed); await unchangedOwner(beforeLock);
    expect(acceptedV.previewEvidence.publisherGeneration).toBeGreaterThan(baseline.previewEvidence.publisherGeneration);
    phase = 'real-Undo-base-held-PHP'; held = await holdFormalPreview(page);
    await visual.locator('p').filter({ hasText: 'Target.V' }).first().click(); await page.keyboard.press('End');
    await page.keyboard.press('Control+z'); await expectSource(source, initial);
    await held.waitFor(initial); // Exact request, real PHP200 fetched, fulfillment still gated.
    const beforeDrag = await checkpoint(initial, true);
    expect(beforeDrag.revision).toBe(beforeLock.revision + 1);
    expect(beforeDrag.documentHistory).toEqual({ undoDepth: baseline.documentHistory.undoDepth, redoDepth: 1 });
    phase = 'real-complete-math-pointer-drag'; const { points } = await nativeRange(true);
    await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
    try { await page.mouse.move(points.end.x, points.end.y, { steps: 16 }); } finally { await page.mouse.up(); }
    expect(failures).toEqual([]); await expectNativeRange();
    const dragged = await checkpoint(initial, true);
    expect(dragged.revision).toBe(beforeDrag.revision); expect(dragged.documentHistory).toEqual(beforeDrag.documentHistory);
    // Pending canonical publication is observed, not forced. The completed
    // accepted tree must preserve the original fixed native/source range.
    phase = 'release-real-PHP-and-preserve-range'; await held.close(); held = null;
    const accepted = await checkpoint(initial); await expectNativeRange();
    expect(accepted.revision).toBe(beforeDrag.revision); expect(accepted.documentHistory).toEqual(beforeDrag.documentHistory);
    expect(accepted.documentSelection).toEqual(selection);
    expect(accepted.previewEvidence.publisherGeneration).toBeGreaterThan(acceptedV.previewEvidence.publisherGeneration);
    expect(accepted.previewEvidence.windowKey).not.toBe(acceptedV.previewEvidence.windowKey);
    phase = 'real-X-replacement'; await page.keyboard.type('X');
    const changed = await checkpoint(replaced);
    expect(changed.revision).toBe(accepted.revision + 1);
    expect(changed.documentHistory).toEqual({ undoDepth: accepted.documentHistory.undoDepth + 1, redoDepth: 0 });
    expect(changed.documentSelection).toEqual({ start: 2, end: 2, direction: 'none' });
    expect(changed).toMatchObject({ nativeCollapsed: true, nativeAnchor: { connected: true, inside: true, parentTag: 'P', offset: 2 },
      nativeFocus: { connected: true, inside: true, parentTag: 'P', offset: 2 } });
    phase = 'real-Undo-replacement'; await page.keyboard.press('Control+z');
    const restored = await checkpoint(initial); await expectNativeRange();
    expect(restored.revision).toBe(changed.revision + 1);
    expect(restored.documentHistory).toEqual({ undoDepth: accepted.documentHistory.undoDepth, redoDepth: 1 });
    expect(restored.documentSelection).toEqual(selection);
    expect(failures).toEqual([]);
  } catch (error) {
    console.log(JSON.stringify({ phase: 'windowed-held-math-first-failure', operation: phase, state: lastAtom, failures }));
    throw error;
  } finally { if (held) await held.close(); }
});

for (const timing of ['held', 'accepted']) {
test(`windowed nested table ${timing} PHP history keeps Enter and atomic Backspace exact`, async ({ page }) => {
  const padding = '\n\n' + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const tableHead = '>   | Left | Right |\n>   | --- | --- |\n';
  const plainTable = tableHead + '>   | AB | CD |' + padding;
  const breakTable = tableHead + '>   | A<br>B | CD |' + padding;
  const baselineHead = '> - Before.\n>\n>   ```js\n>   retained();\n>   ```\n>\n>   After.\n>\n';
  const replacedHead = '> - BRfter.\n>\n';
  // Independent source fixtures, never derived from the current document or an edit map.
  const SourceFixture = { baseline: baselineHead + plainTable, replaced: replacedHead + plainTable,
    withBreak: replacedHead + breakTable };
  const cellCaret = (replacedHead + tableHead + '>   | A').length;
  const crossSelection = { start: '> - B'.length, end: baselineHead.indexOf('>   After.') + '>   A'.length, direction: 'forward' };
  const { failures, source, visual } = await openVisual(page, SourceFixture.baseline);
  const lock = page.locator('.easymde-immersive-preview-lock');
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const cell = visual.locator('blockquote li table tbody td').first();
  let held = null, retainedNodes = null, receipts = null, phase = 'formal-code-baseline', lastAtom = null;
  let expectedSource = SourceFixture.baseline;
  let firstMergeDiagnostic = null;
  let coldMergeDebug = null;
  let firstCaseError = null;
  const cleanupResults = [];
  const tableDiagnostics = { pendingInput: null, sourceNavigation: null, tableNative: null, tableAdmission: null };
  let diagnosticOrdinal = 0;
  const captureTableDiagnostic = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.length > 16384) return;
    diagnosticOrdinal++;
    const parse = (json) => {
      try { const data = JSON.parse(json); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
      catch { return null; }
    };
    const observe = () => ({ operation: phase, consoleOrdinal: diagnosticOrdinal, parsed: false });
    const pick = (observation, data, integers, booleans, enums = {}, nullable = false) => {
      if (!data) return;
      observation.parsed = true;
      let invalidFieldCount = 0;
      for (const field of integers) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        if (Number.isSafeInteger(data[field]) && data[field] >= -1) observation[field] = data[field];
        else invalidFieldCount++;
      }
      for (const field of booleans) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        if (typeof data[field] === 'boolean') observation[field] = data[field];
        else invalidFieldCount++;
      }
      for (const [field, values] of Object.entries(enums)) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        observation[field] = values.includes(data[field]) ? data[field] : 'unrecognized';
        if (observation[field] === 'unrecognized') invalidFieldCount++;
      }
      observation.invalidFieldCount = invalidFieldCount;
    };
    const inputTypes = ['insertText', 'insertReplacementText', 'insertLineBreak', 'insertParagraph', 'deleteByCut',
      'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'other'];
    const navigation = text.match(/visual-editor-window-source-navigation-dom-stale:([a-z0-9-]+)(?:$|;)/u);
    if (navigation) {
      if (tableDiagnostics.sourceNavigation) return;
      const reasons = ['capture-missing-row', 'capture-duplicate-row', 'capture-prior-binding',
        'mount-child-identity', 'mount-block-binding', 'mount-serialization', 'commit-block-binding',
        'commit-child-identity', 'commit-surrounding-block-stale', 'native-deletion-identity',
        'history-gap-child-identity', 'history-gap-presentation', 'history-gap-anchor',
        'pending-native-surrounding-stale', 'pending-table-cell-proof-missing', 'pending-table-cell-snapshot-missing',
        'pending-table-wrapper-stale', 'pending-table-structure-stale', 'pending-table-target-cell-stale',
        'pending-table-protected-placement-stale', 'pending-table-retained-detached', 'pending-table-retained-binding',
        'pending-table-surrounding-stale', 'composition-block-identity', 'history-text-replay', 'history-text-source',
        'history-text-block-binding', 'history-text-spelling', 'history-text-path'];
      tableDiagnostics.sourceNavigation = { operation: phase, consoleOrdinal: diagnosticOrdinal,
        reason: reasons.includes(navigation[1]) ? navigation[1] : 'unrecognized', reasonRecognized: reasons.includes(navigation[1]) };
      return;
    }
    const admission = text.match(/visual-editor-window-table-admission;(\{.*\})$/u);
    if (admission) {
      if (tableDiagnostics.tableAdmission) return;
      const observation = observe(), data = parse(admission[1]);
      tableDiagnostics.tableAdmission = observation;
      const tags = ['BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'SECTION', 'DIV', 'ARTICLE'];
      pick(observation, data,
        ['row', 'column', 'caret', 'tableFrom', 'tableTo', 'sourceCellFrom', 'sourceCellTo', 'local', 'absolute',
          'ownerStart', 'ownerEnd', 'projectionFrom', 'projectionTo', 'baselineLength', 'tableSourceLength'],
        ['nested', 'mapperReturned', 'projectionPresent'],
        { stage: ['lease', 'selection-bounds', 'parser-table', 'dom-cell-ordinal', 'source-cell', 'caret-in-cell',
          'table-caret-map-mismatch', 'capture', 'structure-target', 'owner-binding', 'caret-in-owner',
          'table-in-owner', 'cell-projection', 'cell-projection-bounds', 'nested-range'],
        ownerBlockTag: tags, tableRootTag: tags,
        errorCode: ['visual-editor-selection-map-failed', 'visual-editor-markdown-merge-ambiguous', 'other'] }, true);
      return;
    }
    const native = text.match(/visual-editor-window-table-native;(\{.*\})$/u);
    if (native) {
      if (tableDiagnostics.tableNative) return;
      const observation = observe(), data = parse(native[1]);
      tableDiagnostics.tableNative = observation;
      pick(observation, data,
        ['canonicalLength', 'sourceLength', 'liveCount', 'retainedCount', 'retainedMismatch', 'adjacentTexts',
          'expectedTexts', 'nativeRangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset', 'proofIndex'],
        ['active', 'externalChange', 'canonicalMatches', 'sourceMatches', 'revisionMatches', 'selectionMatches',
          'historyMatches', 'rootEqual', 'removedConnected', 'nativeCollapsed', 'anchorConnected', 'anchorEquivalent',
          'focusEquivalent', 'rejectedBeforeInput', 'pendingComposition', 'composing', 'isComposing', 'inputTypeMatches', 'restored'],
        { stage: ['input-context-rejected', 'epoch-rejected', 'outcome-root', 'outcome-retained-count', 'outcome-retained-identity',
          'outcome-range', 'outcome-collapsed', 'outcome-anchor', 'outcome-focus', 'rollback-source-diverged', 'rollback-restored'],
        capturedInputType: inputTypes, eventInputType: inputTypes });
      if (data && Object.hasOwn(data, 'adjacentTextIndexes')) {
        if (Array.isArray(data.adjacentTextIndexes) && data.adjacentTextIndexes.every((value) => Number.isSafeInteger(value) && value >= 0)) {
          observation.adjacentTextIndexCount = data.adjacentTextIndexes.length;
          observation.adjacentTextIndexes = data.adjacentTextIndexes.slice(0, 32);
          observation.adjacentTextIndexesTruncated = data.adjacentTextIndexes.length > 32;
        } else observation.invalidFieldCount++;
      }
      return;
    }
    const match = text.match(/visual-editor-window-(merge|pending-input):reason=([a-z0-9-]+);(\{.*\})$/u);
    if (!match || (match[1] === 'merge' ? firstMergeDiagnostic : tableDiagnostics.pendingInput)) return;
    const observation = observe(), data = parse(match[3]);
    if (match[1] === 'pending-input') {
      const reasons = ['lease-source', 'selection-bounds', 'canonical-deletion-unavailable', 'selection-deletion-not-cancelable',
        'canonical-lease-rejected', 'lease-selection-stale', 'lease-read-only', 'lease-gate-rejected',
        'lease-dom-mount-child-identity', 'lease-dom-mount-block-binding', 'lease-dom-mount-serialization',
        'lease-dom-read-only-snapshot-missing', 'lease-dom-read-only-region-mutated', 'lease-dom-unclassified',
        'pending-table-cell-unproved', 'row-serialization-failed', 'pending-table-source-epoch', 'pending-table-row-binding',
        'image-target-unproved', 'image-source-map-failed', 'target-probe-unavailable', 'restored-code-target-stale',
        'multiple-targets', 'target-range-mismatch', 'replacement-range-unsupported', 'restored-range-unowned',
        'shortcut-pre-root-missing', 'shortcut-serialization-empty', 'pending-code-deletion-rejected', 'unsupported-pending-input'];
      observation.reason = reasons.includes(match[2]) ? match[2] : 'unrecognized';
      observation.reasonRecognized = reasons.includes(match[2]);
      tableDiagnostics.pendingInput = observation;
      pick(observation, data,
        ['sourceLength', 'canonicalLength', 'mountedLength', 'leaseLength', 'transferLength', 'selectionStart', 'selectionEnd',
          'leaseStart', 'leaseEnd', 'undoDepth', 'redoDepth', 'leaseUndoDepth', 'leaseRedoDepth', 'rangeCount', 'anchorType',
          'anchorOffset', 'focusType', 'focusOffset', 'targetCount', 'targetStartType', 'targetStartOffset', 'targetEndType',
          'targetEndOffset', 'liveChildren', 'acceptedChildren'],
        ['eventAvailable', 'sourceMatchesLease', 'canonicalMatchesSource', 'canonicalMatchesLease', 'transferMatchesLease',
          'signatureMatches', 'focused', 'active', 'externalChange', 'pendingProp', 'anchorConnected', 'focusConnected',
          'targetStartConnected', 'targetEndConnected', 'childrenMatch'],
        { selectionDirection: ['none', 'forward', 'backward'], leaseDirection: ['none', 'forward', 'backward'], inputType: inputTypes });
      return;
    }
    const reasons = ['map-snapshot-mismatch', 'unmapped-normalized-boundary', 'source-visual-slice-mismatch',
      'unmapped-original-boundary', 'unclassified'];
    observation.reason = reasons.includes(match[2]) ? match[2] : 'unrecognized';
    firstMergeDiagnostic = observation;
    pick(observation, data,
      ['sourceStart', 'sourceEnd', 'baselineLength', 'editedLength', 'blockCount', 'canonicalLength', 'sourceLength',
        'mountedLength', 'rangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset'],
      ['structural', 'bodyInput', 'deletion', 'canonicalMatchesSource', 'mountedMatchesSource', 'leaseMatchesSource', 'focused'],
      { phase: ['unclassified', 'beforeinput-selection', 'commit-setup', 'commit-native-deletion-selection', 'commit-merge',
        'commit-selection', 'pending-code-merge', 'pending-code-selection', 'pending-native-serialization', 'pending-native-merge', 'pending-native-selection'] });
    if (data?.merge && typeof data.merge === 'object' && !Array.isArray(data.merge)) {
      observation.merge = {};
      for (const key of ['sourceLength', 'baselineLength', 'editedLength', 'visualStart', 'visualEnd', 'sourceStart', 'sourceEnd']) {
        if (Number.isSafeInteger(data.merge[key])) observation.merge[key] = data.merge[key];
      }
    }
  };
  const checkpoint = async (expected, pending, formal = false) => {
    expectedSource = expected;
    await expectSource(source, expected);
    await expect.poll(async () => {
      lastAtom = await readWindowedSmokeState(visual, { expectedSource: expected, previewEvidence: formal });
      return lastAtom.sourceMatchesExpected && (pending === undefined || lastAtom.runtimePending === pending)
        && (!formal || lastAtom.phase === 'ready' && lastAtom.previewEvidence.formalCurrent);
    }).toBe(true);
    expect(lastAtom).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready', windowedControllerCount: 1, runtimeCount: 1 });
    expect(lastAtom.spacers).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    return lastAtom;
  };
  const point = async (locator, text, offset) => locator.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), matches = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === target.text) matches.push(node);
    if (matches.length !== 1) throw new Error('test-table-text-boundary-not-unique');
    const range = document.createRange(); range.setStart(matches[0], target.offset); range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.height <= 0) throw new Error('test-table-text-boundary-not-visible');
    return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
  }, { text, offset });
  const nativeCell = async () => cell.evaluate((element) => {
    const native = getSelection(), inside = !!native?.anchorNode && element.contains(native.anchorNode)
      && !!native.focusNode && element.contains(native.focusNode);
    const prefix = document.createRange(); prefix.selectNodeContents(element);
    if (inside) prefix.setEnd(native.anchorNode, native.anchorOffset); else prefix.collapse(true);
    return { connected: element.isConnected, inside, collapsed: native?.isCollapsed === true,
      prefixText: prefix.toString(), prefixBreaks: prefix.cloneContents().querySelectorAll('br').length,
      breaks: element.querySelectorAll('br').length, atB0: native?.anchorNode instanceof Text
        && native.anchorNode.data === 'B' && native.anchorOffset === 0 && native.focusNode === native.anchorNode && native.focusOffset === 0 };
  });
  const acceptThroughUserLock = async (expected) => {
    const before = await readCurrentDocumentOwner(page);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === expected; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise;
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(sink).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint(expected, false, true);
    const after = await readCurrentDocumentOwner(page);
    expect(after).toMatchObject({ revision: before.revision, history: before.history });
    await expectSource(source, expected);
  };
  const expectEdit = async (expected, revision, undoDepth, redoDepth, caret) => {
    const state = await checkpoint(expected, timing === 'held' ? true : undefined);
    expect(state.revision).toBe(revision);
    expect(state.documentHistory).toEqual({ undoDepth, redoDepth });
    expect(state.documentSelection).toEqual({ start: caret, end: caret, direction: 'none' });
    return state;
  };
  // The shared observer retains refusal codes only; keep the first scalar payload locally, never raw console text.
  page.on('console', captureTableDiagnostic);
  try {
    await checkpoint(SourceFixture.baseline, false, true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(cell).toHaveText('AB');
    const before = visual.locator('blockquote li p').filter({ hasText: /^Before\.$/u });
    const after = visual.locator('blockquote li p').filter({ hasText: /^After\.$/u });
    const start = await point(before, 'Before.', 1), end = await point(after, 'After.', 1);
    phase = 'real-P-code-P-drag';
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    try { await page.mouse.move(end.x, end.y, { steps: 16 }); } finally { await page.mouse.up(); }
    const intent = await readWindowedSmokeState(visual, { selector: 'blockquote li p', index: 0, focusIndex: 1 });
    expect(intent).toMatchObject({ nativeCollapsed: false, nativeDirection: 'forward',
      nativeAnchor: { targetContains: true, bodyOffset: 1 }, nativeFocus: { targetContains: true, bodyOffset: 1 } });
    const debugModule = timing === 'held' ? process.env.EASYMDE_E2E_COLD_MERGE_DEBUG_MODULE : null;
    if (debugModule) coldMergeDebug = await (await import(debugModule)).start(page, {
      expectedBundle: process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD
    });
    phase = 'real-R-cross-replacement';
    try { await page.keyboard.type('R'); } finally { if (coldMergeDebug) await coldMergeDebug.close(); }
    if (coldMergeDebug) console.log(JSON.stringify({ phase: 'cold-merge-private-sample', state: coldMergeDebug.snapshot() }));
    await expectSource(source, SourceFixture.replaced);
    const replacement = await readCurrentDocumentOwner(page);
    expect(replacement.selection).toEqual({ start: 6, end: 6, direction: 'none' });
    phase = 'formal-R-user-lock'; await acceptThroughUserLock(SourceFixture.replaced);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(0);
    phase = 'real-Undo-formal-code-baseline'; await page.keyboard.press('Control+z');
    const baseline = await checkpoint(SourceFixture.baseline, false, true);
    expect(baseline.revision).toBe(replacement.revision + 1);
    expect(baseline.documentHistory).toEqual({ undoDepth: replacement.history.undoDepth - 1, redoDepth: 1 });
    expect(baseline.documentSelection).toEqual(crossSelection);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    retainedNodes = await visual.evaluateHandle((surface) => [...surface.childNodes]);
    held = await holdFormalPreview(page);
    phase = 'real-Redo-R-held-PHP'; await page.keyboard.press('Control+Shift+z');
    await expectSource(source, SourceFixture.replaced); await held.waitFor(SourceFixture.replaced);
    const pending = await checkpoint(SourceFixture.replaced, true);
    expect(pending.revision).toBe(baseline.revision + 1);
    expect(pending.documentHistory).toEqual({ undoDepth: baseline.documentHistory.undoDepth + 1, redoDepth: 0 });
    expect(await visual.evaluate((surface, nodes) => nodes.length === surface.childNodes.length
      && nodes.every((node, index) => node === surface.childNodes[index]), retainedNodes)).toBe(true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    if (timing === 'accepted') {
      phase = 'accept-real-Redo-R'; await held.close(); held = null;
      await checkpoint(SourceFixture.replaced, false, true);
      await expect(visual.locator('blockquote li pre code')).toHaveCount(0);
    }
    receipts = await visual.evaluateHandle((surface) => {
      const events = [];
      const observe = (event) => {
        const native = getSelection(), element = native?.anchorNode?.parentElement?.closest('td');
        events.push({ trusted: event.isTrusted, inputType: event.inputType, collapsed: native?.isCollapsed === true,
          row: element?.parentElement?.rowIndex ?? null, column: element?.cellIndex ?? null,
          offset: native?.anchorOffset ?? null, ranges: event.getTargetRanges().length });
      };
      surface.addEventListener('beforeinput', observe, true);
      return { events, dispose: () => surface.removeEventListener('beforeinput', observe, true) };
    });
    phase = 'real-TD1-pointer'; const tdPoint = await point(cell, 'AB', 1);
    await page.mouse.click(tdPoint.x, tdPoint.y);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true, prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    phase = 'real-table-Enter'; await page.keyboard.press('Enter');
    await expectEdit(SourceFixture.withBreak, baseline.revision + 2, baseline.documentHistory.undoDepth + 2, 0, cellCaret + 4);
    expect(await receipts.evaluate((observer) => observer.events.find((event) => event.inputType === 'insertParagraph')))
      .toEqual({ trusted: true, inputType: 'insertParagraph', collapsed: true, row: 1, column: 0, offset: 1, ranges: 1 });
    if (timing === 'held') {
      phase = 'real-break-PHP200-still-withheld'; await held.waitFor(SourceFixture.withBreak);
      await checkpoint(SourceFixture.withBreak, true);
    } else {
      phase = 'formal-break-user-lock'; await acceptThroughUserLock(SourceFixture.withBreak);
      // A toolbar lock can move native focus. Restore the legal point with a real B0 click.
      phase = 'real-accepted-B0-pointer'; const b0 = await point(cell, 'B', 0);
      await page.mouse.click(b0.x, b0.y);
      expect(await nativeCell()).toMatchObject({ atB0: true });
      await checkpoint(SourceFixture.withBreak, false, true);
    }
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true,
      prefixText: 'A', prefixBreaks: 1, breaks: 1 });
    phase = 'real-atomic-marker-Backspace'; await page.keyboard.press('Backspace');
    await expectEdit(SourceFixture.replaced, baseline.revision + 3, baseline.documentHistory.undoDepth + 3, 0, cellCaret);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true,
      prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    phase = 'real-Undo-marker-Backspace'; await page.keyboard.press('Control+z');
    await expectEdit(SourceFixture.withBreak, baseline.revision + 4, baseline.documentHistory.undoDepth + 2, 1, cellCaret + 4);
    phase = 'real-Redo-marker-Backspace'; await page.keyboard.press('Control+Shift+z');
    await expectEdit(SourceFixture.replaced, baseline.revision + 5, baseline.documentHistory.undoDepth + 3, 0, cellCaret);
    if (held) { phase = 'release-final-table-PHP'; await held.close(); held = null; }
    await checkpoint(SourceFixture.replaced, false, true);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true, prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    expect(failures).toEqual([]);
  } catch (error) {
    firstCaseError = error;
    // Direct page/owner reads never wait for a visual locator that failure teardown removed.
    const documentOwner = await readCurrentDocumentOwner(page)
      .then((owner) => ({ available: true, ...owner }), () => ({ available: false }));
    const snapshot = await page.evaluate((expected) => {
      const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      const field = document.querySelector('#easymde-source');
      const native = document.getSelection();
      const tags = ['P', 'TD', 'TH', 'SPAN', 'CODE', 'EM', 'STRONG', 'DEL', 'A', 'ARTICLE', 'DIV', 'SECTION', 'LI', 'BLOCKQUOTE'];
      const point = (node, offset) => ({ connected: !!node?.isConnected,
        inside: !!surface && !!node && surface.contains(node), nodeType: node?.nodeType ?? null, offset,
        parentTag: tags.includes(node?.parentElement?.tagName) ? node.parentElement.tagName : 'unrecognized',
        textLength: node instanceof Text ? node.length : null });
      const rect = surface?.getBoundingClientRect();
      const x = Math.max(0, rect?.left ?? 0), y = Math.max(0, rect?.top ?? 0);
      const right = Math.min(innerWidth, rect?.right ?? 0), bottom = Math.min(innerHeight, rect?.bottom ?? 0);
      return { available: true, visualOwnerPresent: !!surface,
        sourceLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        sourceMatchesExpected: field instanceof HTMLTextAreaElement ? field.value === expected : null,
        expectedLength: expected.length, nativeCollapsed: native?.isCollapsed ?? null,
        nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? null),
        nativeFocus: point(native?.focusNode, native?.focusOffset ?? null),
        editable: surface?.getAttribute('contenteditable') ?? null,
        effectiveEditable: surface?.isContentEditable ?? null,
        locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        session: document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') ?? null,
        previewPhase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null,
        screenshotClip: right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null };
    }, expectedSource).catch(() => ({ available: false }));
    const screenshot = { available: false, attached: false };
    if (snapshot.available && snapshot.visualOwnerPresent && snapshot.screenshotClip) {
      try {
        const body = await page.screenshot({ clip: snapshot.screenshotClip, timeout: 2000 });
        await test.info().attach('table-history-first-failure', { body, contentType: 'image/png' });
        screenshot.available = true; screenshot.attached = true;
      } catch { screenshot.step = 'failure-screenshot'; }
    }
    console.log(JSON.stringify({ phase: 'windowed-table-first-failure', timing, operation: phase,
      state: { observedAfterFailure: true, documentOwner, snapshot }, preErrorCheckpoint: lastAtom,
      failures, mergeDiagnostic: firstMergeDiagnostic, pendingInputDiagnostic: tableDiagnostics.pendingInput,
      sourceNavigationDiagnostic: tableDiagnostics.sourceNavigation, tableNativeDiagnostic: tableDiagnostics.tableNative,
      tableAdmissionDiagnostic: tableDiagnostics.tableAdmission, failureScreenshot: screenshot,
      coldMergeDebug: coldMergeDebug?.snapshot() ?? null }));
    throw error;
  } finally {
    const cleanup = async (step, operation) => {
      try { await operation(); cleanupResults.push({ step, completed: true }); }
      catch { cleanupResults.push({ step, completed: false }); }
    };
    // Release real withheld responses before any receipt/DOM-handle operation can fail.
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('console-listener-remove', () => page.off('console', captureTableDiagnostic));
    if (coldMergeDebug) await cleanup('cold-debugger-close', async () => {
      await coldMergeDebug.close();
      const state = coldMergeDebug.snapshot();
      if (!state.detached || (state.targetPauses > 0 && !state.resumed)) throw new Error('cold-merge-debug-cleanup-incomplete');
    });
    if (receipts) {
      await cleanup('receipt-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('receipt-handle-dispose', () => receipts.dispose());
    }
    if (retainedNodes) await cleanup('retained-handle-dispose', () => retainedNodes.dispose());
    const cleanupFailed = cleanupResults.some((result) => !result.completed);
    console.log(JSON.stringify({ phase: 'windowed-table-cleanup', timing, operation: phase,
      primaryErrorPresent: firstCaseError !== null, cleanupFailed, resources: cleanupResults }));
    if (cleanupFailed && firstCaseError === null) throw new Error('windowed-table-cleanup-failed');
  }
});
}

// Opt-in rich CODE acceptance; excluded from default registration and [short-stage].
if (process.env.EASYMDE_E2E_RICH_TABLE_CODE === 'complete') {
for (const timing of ['ready', 'held']) {
test(`[rich-table-code] windowed ${timing} fixed CODE Enter Backspace history and right-span continuation`, async ({ page }) => {
  const prefix = 'Lead.\n\n> - Keep.\n>\n>   | Left | Target | Right |\n>   | :--- | :---: | ---: |\n'
    + '>   | up | guard | end |\n>   | left | ';
  const suffix = ' | right |\n>   | down | guard | end |\n\nAfter.\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  // Each real-BR-separated segment uses inherited Turndown code spelling. A/B need one backtick each.
  const SourceFixture = { S0: prefix + 'L `AB` R' + suffix, S1: prefix + 'L `A`<br>`B` R' + suffix,
    S1T: prefix + 'L `A`<br>`TB` R' + suffix, ST: prefix + 'L `ATB` R' + suffix,
    SV: prefix.replace(/^Lead\./u, 'Lead.V') + 'L `AB` R' + suffix };
  // Independent diagnostic candidates only; none can replace an edit oracle.
  const sourceCandidates = { joinedS0: 'L `AB` R', adjacentOriginalCodeSpansWithoutBR: 'L `A``B` R',
    sameGlyphWiderDelimiter: 'L ``AB`` R', spacedSpans: 'L `A` `B` R' };
  const caret = { S0: (prefix + 'L `A').length, S1: (prefix + 'L `A`<br>`').length,
    S1T: (prefix + 'L `A`<br>`T').length, ST: (prefix + 'L `AT').length };
  const { failures, source, visual } = await openVisual(page, SourceFixture.S0);
  const surface = await visual.elementHandle();
  if (!surface) throw new Error('rich-code-surface-unavailable');
  const cell = visual.locator('blockquote li table tbody tr').nth(1).locator('td').nth(1);
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null, receipts = null, retainedNodes = null, phase = 'formal-S0', expectedKey = 'S0';
  let primaryError = null, lastObservation = null;
  const diagnostics = { merge: null, pending: null, admission: null, native: null, navigation: null };
  const observeDiagnostic = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text(); if (text.length > 16384) return;
    const match = text.match(/visual-editor-window-(merge|pending-input|table-admission|table-native|source-navigation-dom-stale)(?::reason=([a-z0-9-]+);|:([a-z0-9-]+)|;)(\{.*\})?$/u);
    if (!match) return;
    const family = { merge: 'merge', 'pending-input': 'pending', 'table-admission': 'admission',
      'table-native': 'native', 'source-navigation-dom-stale': 'navigation' }[match[1]];
    if (diagnostics[family]) return;
    const observation = { operation: phase, parsed: false };
    diagnostics[family] = observation;
    const reasons = ['pending-table-cell-unproved', 'pending-table-cell-proof-missing', 'pending-table-cell-snapshot-missing',
      'pending-table-wrapper-stale', 'pending-table-structure-stale', 'pending-table-target-cell-stale',
      'pending-table-protected-placement-stale', 'pending-table-retained-detached', 'pending-table-retained-binding',
      'pending-table-surrounding-stale', 'lease-source', 'selection-bounds', 'lease-selection-stale', 'lease-read-only',
      'lease-gate-rejected', 'lease-dom-mount-child-identity', 'lease-dom-mount-block-binding', 'lease-dom-mount-serialization',
      'map-snapshot-mismatch', 'unmapped-normalized-boundary', 'source-visual-slice-mismatch', 'unmapped-original-boundary', 'unclassified'];
    const reason = match[2] ?? match[3];
    if (reason) observation.reason = reasons.includes(reason) ? reason : 'unrecognized';
    if (!match[4]) return;
    let data; try { data = JSON.parse(match[4]); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    observation.parsed = true;
    for (const key of ['sourceLength', 'canonicalLength', 'mountedLength', 'leaseLength', 'transferLength', 'sourceStart', 'sourceEnd',
      'selectionStart', 'selectionEnd', 'leaseStart', 'leaseEnd', 'undoDepth', 'redoDepth', 'leaseUndoDepth', 'leaseRedoDepth',
      'rangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset', 'targetCount', 'targetStartType', 'targetStartOffset',
      'targetEndType', 'targetEndOffset', 'liveChildren', 'acceptedChildren', 'row', 'column', 'caret', 'tableFrom', 'tableTo',
      'sourceCellFrom', 'sourceCellTo', 'local', 'absolute', 'ownerStart', 'ownerEnd', 'projectionFrom', 'projectionTo',
      'baselineLength', 'editedLength', 'blockCount', 'tableSourceLength']) {
      if (data[key] === null || Number.isSafeInteger(data[key])) observation[key] = data[key];
    }
    for (const key of ['eventAvailable', 'sourceMatchesLease', 'canonicalMatchesSource', 'canonicalMatchesLease', 'transferMatchesLease',
      'signatureMatches', 'focused', 'active', 'externalChange', 'pendingProp', 'anchorConnected', 'focusConnected',
      'targetStartConnected', 'targetEndConnected', 'childrenMatch', 'nested', 'mapperReturned', 'projectionPresent',
      'canonicalMatches', 'sourceMatches', 'revisionMatches', 'selectionMatches', 'historyMatches', 'nativeCollapsed']) {
      if (data[key] === null || typeof data[key] === 'boolean') observation[key] = data[key];
    }
    const nativeStageSchemas = {
      'target-shape': { numbers: ['startOffset', 'endOffset', 'startChildCount', 'endChildCount'],
        booleans: ['sameContainer'], tags: ['targetStartTag', 'targetEndTag'] },
      'target-content-certified': { booleans: ['certified'] },
      'target-facing-certified': { booleans: ['certified'] },
      'clone-target-path': { booleans: ['startResolved', 'endResolved'] },
      'merge-single-delete': { numbers: ['editCount', 'from', 'to', 'insertLength'] },
      'canonical-facing': { numbers: ['caret', 'caretFacing'], booleans: ['facingMatches'] },
      'removed-resolution': { numbers: ['resolvedIndex'], tags: ['startTag', 'endTag'] },
      'removed-parent': { booleans: ['removedIsBR', 'removedParentIsCell', 'removedParentIsContainer'], tags: ['removedParentTag'] }
    };
    const stages = ['lease', 'selection-bounds', 'parser-table', 'dom-cell-ordinal', 'source-cell', 'caret-in-cell',
      'table-caret-map-mismatch', 'capture', 'structure-target', 'owner-binding', 'caret-in-owner', 'table-in-owner',
      'cell-projection', 'cell-projection-bounds', 'nested-range', 'input-context-rejected', 'epoch-rejected', 'outcome-root',
      'outcome-retained-count', 'outcome-retained-identity', 'outcome-range', 'outcome-collapsed', 'outcome-anchor', 'outcome-focus',
      'rollback-source-diverged', 'rollback-restored', ...Object.keys(nativeStageSchemas)];
    if (Object.hasOwn(data, 'stage')) observation.stage = data.stage === null ? null : stages.includes(data.stage) ? data.stage : 'unrecognized';
    if (Object.hasOwn(data, 'stageEvidence')) {
      const schema = Object.hasOwn(nativeStageSchemas, data.stage) ? nativeStageSchemas[data.stage] : null;
      const evidence = data.stageEvidence;
      if (evidence === null) observation.stageEvidence = null;
      else {
        observation.stageEvidenceSchemaKnown = !!schema && !!evidence && typeof evidence === 'object' && !Array.isArray(evidence);
        if (observation.stageEvidenceSchemaKnown) {
          const safe = {};
          for (const key of schema.numbers ?? []) if (Number.isSafeInteger(evidence[key])) safe[key] = evidence[key];
          for (const key of schema.booleans ?? []) if (typeof evidence[key] === 'boolean') safe[key] = evidence[key];
          for (const key of schema.tags ?? []) if (Object.hasOwn(evidence, key)) {
            safe[key] = evidence[key] === null ? null
              : ['TD', 'TH', 'CODE', 'BR', 'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'DEL', 'S', 'STRIKE', 'MARK', 'SUB', 'SUP', 'P', 'DIV'].includes(evidence[key])
                ? evidence[key] : 'unrecognized';
          }
          observation.stageEvidence = safe;
        }
      }
    }
    if (Object.hasOwn(data, 'inputType')) observation.inputType = ['insertText', 'insertParagraph', 'insertLineBreak',
      'deleteContentBackward', 'deleteContentForward', 'other'].includes(data.inputType) ? data.inputType : 'unrecognized';
    for (const key of ['selectionDirection', 'leaseDirection']) if (Object.hasOwn(data, key)) {
      observation[key] = ['none', 'forward', 'backward'].includes(data[key]) ? data[key] : 'unrecognized';
    }
    for (const key of ['ownerBlockTag', 'tableRootTag']) if (Object.hasOwn(data, key)) {
      observation[key] = ['BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'SECTION', 'DIV', 'ARTICLE'].includes(data[key]) ? data[key] : 'unrecognized';
    }
    if (Object.hasOwn(data, 'errorCode')) observation.errorCode = ['visual-editor-selection-map-failed', 'visual-editor-markdown-merge-ambiguous', 'other'].includes(data.errorCode) ? data.errorCode : 'unrecognized';
  };
  page.on('console', observeDiagnostic);
  const runtimeState = (key, formal = false) => readWindowedSmokeState(surface, { expectedSource: SourceFixture[key], previewEvidence: formal });
  const checkpoint = async (stage, key, pending, formal = false, point = null, renderRequired = true) => {
    phase = stage; expectedKey = key;
    await expectSource(source, SourceFixture[key]);
    await expect.poll(async () => {
      expect(failures).toEqual([]);
      const state = await runtimeState(key, formal);
      return state.sourceMatchesExpected && (pending === undefined || state.runtimePending === pending)
        && (!formal || state.phase === 'ready' && state.previewEvidence.formalCurrent);
    }).toBe(true);
    const state = await runtimeState(key, formal), owner = await readCurrentDocumentOwner(page);
    const render = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), key === 'SV' ? 'S0' : key) : null;
    lastObservation = { stage, fixedOracle: key, expectedLength: SourceFixture[key].length, sourceDocLength: state.sourceLength,
      owner, runtimePending: state.runtimePending, phase: state.phase, render,
      presentation: renderRequired ? 'render-checked' : 'history-presentation-observed-not-oracled' };
    console.log(JSON.stringify({ event: 'rich-code-checkpoint', timing, ...lastObservation }));
    expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready', windowedControllerCount: 1, runtimeCount: 1 });
    expect(state.spacers).toBeGreaterThan(0);
    if (render) {
      expect(render.current.guardCellsExact).toBe(true);
      if (!renderRequired) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true });
      if (renderRequired) expect(render.current).toMatchObject({ matchesExpectedText: true, matchesExpectedCodeGlyphs: true,
        expectedBreakCount: true, literalBrVisible: false });
      if (formal) expect(render.current.codeCount).toBe(key === 'S1' || key === 'S1T' ? 2 : 1);
      if (point) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true,
        nativeInsideCode: true, codeGlyphOffset: point === 'right-T' || point === 'middle-T' ? 2 : 1,
        prefixBreaks: point === 'middle' || point === 'middle-T' ? 0 : 1,
        ...(point === 'right' ? { atRightB0: true } : {}) });
    }
    expect(failures).toEqual([]);
    return { state, owner, render };
  };
  const acceptFixed = async (key) => {
    const before = await readCurrentDocumentOwner(page);
    await expectSource(source, SourceFixture[key]);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === SourceFixture[key]; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(page.locator('[data-easymde-preview-html-sink]')).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint('formal-' + key, key, false, true);
    expect(await readCurrentDocumentOwner(page)).toMatchObject({ revision: before.revision, history: before.history });
  };
  const clickCode = async (text, offset) => {
    const code = cell.locator('code').filter({ hasText: new RegExp('^' + text + '$', 'u') });
    const point = await code.evaluate((element, target) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === target.text) matches.push(node);
      if (matches.length !== 1) throw new Error('rich-code-boundary-unproved');
      const range = document.createRange(); range.setStart(matches[0], target.offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('rich-code-boundary-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    }, { text, offset });
    await page.mouse.click(point.x, point.y);
  };
  try {
    const loaded = await checkpoint('initial-formal-S0', 'S0', false, true);
    phase = 'loaded-unique-CODE-target';
    expect(SourceFixture.S0.length).toBe(2153);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody tr')).toHaveCount(3);
    await expect(cell).toHaveCount(1);
    const loadedTarget = await cell.evaluate((target) => {
      const table = target.closest('table'), rows = [...(table?.tBodies[0]?.rows ?? [])];
      const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
      const codes = target.querySelectorAll('code');
      return { targetOrdinalExact: rows[1]?.cells[1] === target,
        headersExact: [...(table?.tHead?.rows[0]?.cells ?? [])].map((node) => node.textContent).join('|') === 'Left|Target|Right',
        guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
          && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])),
        targetTextExact: target.innerText === 'L AB R', codeCount: codes.length,
        codeGlyphsExact: codes.length === 1 && codes[0].textContent === 'AB',
        noBreaks: target.querySelectorAll('br').length === 0 };
    });
    console.log(JSON.stringify({ event: 'rich-code-loaded-prerequisite', timing, sourceExact: loaded.state.sourceMatchesExpected,
      sourceLength: loaded.state.sourceLength, ...loadedTarget }));
    expect(loaded.state.sourceMatchesExpected).toBe(true);
    expect(loadedTarget).toEqual({ targetOrdinalExact: true, headersExact: true, guardCellsExact: true,
      targetTextExact: true, codeCount: 1, codeGlyphsExact: true, noBreaks: true });
    await visual.locator('p').filter({ hasText: /^Lead\.$/u }).first().click();
    await page.keyboard.press('End'); phase = 'real-Lead-V'; await page.keyboard.type('V');
    await expectSource(source, SourceFixture.SV); await acceptFixed('SV');
    await visual.locator('p').filter({ hasText: /^Lead\.V$/u }).first().click(); await page.keyboard.press('End');
    retainedNodes = await surface.evaluateHandle((root) => [...root.childNodes]);
    held = await holdFormalPreview(page);
    phase = 'real-Undo-V-held-S0'; await page.keyboard.press('Control+z');
    await expectSource(source, SourceFixture.S0); await held.waitFor(SourceFixture.S0);
    await checkpoint('real-S0-PHP200-withheld', 'S0', true);
    expect(await surface.evaluate((root, nodes) => root.childNodes.length === nodes.length
      && nodes.every((node, index) => root.childNodes[index] === node), retainedNodes)).toBe(true);
    if (timing === 'ready') { await held.close(); held = null; await checkpoint('released-formal-S0', 'S0', false, true); }
    receipts = await surface.evaluateHandle((root) => {
      let nativeEnter = null, nativeText = null, nativeBackspace = null;
      const events = [];
      const target = () => root.querySelector('blockquote li table tbody')?.rows[1]?.cells[1] ?? null;
      const privateShape = () => {
        const cell = target(), rows = [...(root.querySelector('blockquote li table')?.tBodies[0]?.rows ?? [])];
        const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
        return { available: !!cell, text: cell?.innerText ?? '', codeText: [...(cell?.querySelectorAll('code') ?? [])].map((node) => node.textContent).join(''),
          breaks: cell?.querySelectorAll('br').length ?? 0, codeCount: cell?.querySelectorAll('code').length ?? 0,
          guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
            && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])) };
      };
      const observe = (event) => {
        if (!(event.target instanceof Node) || !root.contains(event.target)) return;
        const inputTypes = ['insertParagraph', 'insertLineBreak', 'insertText', 'deleteContentBackward', 'historyUndo', 'historyRedo'];
        if (events.length < 32) events.push({ type: event.type, inputType: inputTypes.includes(event.inputType) ? event.inputType : 'unrecognized', trusted: event.isTrusted });
        if (event.type !== 'input') return;
        if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') && !nativeEnter) nativeEnter = { ...privateShape(), trusted: event.isTrusted };
        if (event.inputType === 'deleteContentBackward') nativeBackspace = { ...privateShape(), trusted: event.isTrusted };
        if (event.inputType === 'insertText' && target()?.contains(getSelection()?.anchorNode)) nativeText = { ...privateShape(), trusted: event.isTrusted };
      };
      document.addEventListener('beforeinput', observe, true); document.addEventListener('input', observe, true);
      return { safe: (kind) => {
        const current = privateShape(), cell = target(), native = getSelection(), anchor = native?.anchorNode;
        const expected = kind === 'S1T' ? { text: 'L A\nTB R', glyphs: 'ATB', breaks: 1 }
          : kind === 'S1' ? { text: 'L A\nB R', glyphs: 'AB', breaks: 1 }
          : kind === 'ST' ? { text: 'L ATB R', glyphs: 'ATB', breaks: 0 } : { text: 'L AB R', glyphs: 'AB', breaks: 0 };
        const scalar = (shape) => ({ available: shape.available, textLength: shape.text.length, codeTextLength: shape.codeText.length,
          breaks: shape.breaks, codeCount: shape.codeCount, matchesExpectedText: shape.text === expected.text,
          matchesExpectedCodeGlyphs: shape.codeText === expected.glyphs, expectedBreakCount: shape.breaks === expected.breaks,
          literalBrVisible: shape.text.includes('<br>'), guardCellsExact: shape.guardCellsExact });
        const inside = !!cell && !!anchor && cell.contains(anchor) && !!native?.focusNode && cell.contains(native.focusNode);
        let codeGlyphOffset = null, prefixBreaks = null;
        if (inside) {
          const range = document.createRange(); range.selectNodeContents(cell); range.setEnd(anchor, native.anchorOffset);
          const fragment = range.cloneContents();
          codeGlyphOffset = [...fragment.querySelectorAll('code')].reduce((sum, node) => sum + node.textContent.length, 0);
          prefixBreaks = fragment.querySelectorAll('br').length;
        }
        const comparison = kind === 'S1' ? nativeEnter : kind === 'S1T' || kind === 'ST' ? nativeText : nativeBackspace;
        const codeOf = (node) => (node instanceof Element ? node : node?.parentElement)?.closest('code') ?? null;
        const anchorCode = codeOf(anchor), focusCode = codeOf(native?.focusNode);
        const nativeInsideCode = !!anchorCode && !!cell?.contains(anchorCode) && anchorCode === focusCode;
        const sameCollapsedPoint = native?.isCollapsed === true && native.anchorNode === native.focusNode
          && native.anchorOffset === native.focusOffset;
        const domMatchesDeclaredS1 = kind === 'S1' && current.text === 'L A\nB R' && current.codeText === 'AB'
          && current.breaks === 1 && codeGlyphOffset === 1 && prefixBreaks === 1;
        const rightCodes = [...(cell?.querySelectorAll('code') ?? [])].filter((node) => node.parentElement === cell
          && node.textContent === 'B' && !node.querySelector('br'));
        const rightCode = rightCodes.length === 1 ? rightCodes[0] : null;
        const rightTexts = [];
        if (rightCode) {
          const walker = document.createTreeWalker(rightCode, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === 'B') rightTexts.push(node);
        }
        const rightText = rightTexts.length === 1 ? rightTexts[0] : null;
        const transparent = (node) => node instanceof Element && ['SPAN', 'EM', 'STRONG', 'B', 'I', 'S', 'DEL', 'MARK', 'SUB', 'SUP'].includes(node.tagName)
          && !node.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]');
        const proveRightStart = (node, offset) => {
          const proof = { kind: 'none', equivalent: false, withinRightCode: false, corridorForward: false,
            corridorNoText: false, corridorNoComment: false, corridorNoOpaque: false, rightTextReached: false };
          if (node instanceof Text && node.data === 'B' && offset === 0 && nativeInsideCode && inside) {
            return { ...proof, kind: 'text-zero', equivalent: true, withinRightCode: !!rightCode?.contains(node),
              corridorForward: true, corridorNoText: true, corridorNoComment: true, corridorNoOpaque: true,
              rightTextReached: node === rightText };
          }
          if (!rightCode || !rightText || !(node instanceof Element) || !rightCode.contains(node)
            || codeOf(node) !== rightCode || (node === rightCode ? offset !== 0 : !transparent(node))
            || rightCode.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]')) return proof;
          proof.withinRightCode = true;
          const point = document.createRange(), textStart = document.createRange();
          point.setStart(node, offset); point.collapse(true); textStart.setStart(rightText, 0); textStart.collapse(true);
          proof.corridorForward = point.compareBoundaryPoints(Range.START_TO_START, textStart) <= 0;
          proof.corridorNoText = true; proof.corridorNoComment = true; proof.corridorNoOpaque = true;
          // Inspect original nodes, not cloneContents' artificial empty Text at the B0 endpoint.
          // Requiring the entire CODE-start corridor also excludes hidden/protected ancestors before the point.
          const walker = document.createTreeWalker(rightCode, NodeFilter.SHOW_ALL);
          for (let part = walker.nextNode(); part; part = walker.nextNode()) {
            if (part === rightText) { proof.rightTextReached = true; break; }
            if (part.nodeType === Node.TEXT_NODE) proof.corridorNoText = false;
            else if (part.nodeType === Node.COMMENT_NODE) proof.corridorNoComment = false;
            else if (!transparent(part)) proof.corridorNoOpaque = false;
          }
          proof.equivalent = proof.corridorForward && proof.corridorNoText && proof.corridorNoComment
            && proof.corridorNoOpaque && proof.rightTextReached;
          proof.kind = proof.equivalent ? node === rightCode ? 'right-code-zero' : 'empty-phrasing-corridor' : 'none';
          return proof;
        };
        const anchorProof = proveRightStart(anchor, native?.anchorOffset ?? 0);
        const focusProof = proveRightStart(native?.focusNode, native?.focusOffset ?? 0);
        const semanticEquivalentRightStart = domMatchesDeclaredS1 && inside && nativeInsideCode && sameCollapsedPoint
          && anchorProof.equivalent && focusProof.equivalent;
        const rawPoint = (node, offset) => ({ nodeType: node?.nodeType ?? null,
          ownTag: node instanceof Element ? node.tagName : null, parentTag: node?.parentElement?.tagName ?? null,
          offset, connected: !!node?.isConnected });
        return { current: scalar(current), nativeEnter: nativeEnter ? { ...scalar(nativeEnter), trusted: nativeEnter.trusted } : null,
          currentTextEqualsNative: comparison ? current.text === comparison.text : null,
          currentCodeGlyphsEqualNative: comparison ? current.codeText === comparison.codeText : null,
          nativeConnected: !!anchor?.isConnected && !!native?.focusNode?.isConnected,
          nativeInsideCell: inside, nativeCollapsed: native?.isCollapsed === true,
          nativeInsideCode,
          codeGlyphOffset, prefixBreaks,
          nativeAnchor: rawPoint(anchor, native?.anchorOffset ?? 0), nativeFocus: rawPoint(native?.focusNode, native?.focusOffset ?? 0),
          atRightB0: semanticEquivalentRightStart, semanticEquivalentRightStart,
          rightStartProof: { sameCollapsedPoint, domMatchesDeclaredS1, rightCodeCandidateCount: rightCodes.length,
            rawTextB0: anchor instanceof Text && anchor.data === 'B' && native.anchorOffset === 0,
            anchor: anchorProof, focus: focusProof }, events: events.slice() };
      }, dispose: () => { document.removeEventListener('beforeinput', observe, true); document.removeEventListener('input', observe, true); } };
    });
    const base = await checkpoint('before-CODE-Enter', 'S0', timing === 'held');
    await clickCode('AB', 1);
    expect(await receipts.evaluate((observer) => observer.safe('S0'))).toMatchObject({ nativeConnected: true,
      nativeInsideCell: true, nativeCollapsed: true, nativeInsideCode: true, codeGlyphOffset: 1, prefixBreaks: 0 });
    const edit = async (stage, key, step, undoDelta, redoDepth, pending, formal = false, point = null, renderRequired = true) => {
      const state = await checkpoint(stage, key, pending, formal, point, renderRequired);
      expect(state.owner.revision).toBe(base.owner.revision + step);
      expect(state.owner.history).toEqual({ undoDepth: base.owner.history.undoDepth + undoDelta, redoDepth });
      expect(state.owner.selection).toEqual({ start: caret[key], end: caret[key], direction: 'none' });
      return state;
    };
    phase = 'real-CODE-Enter'; await page.keyboard.press('Enter');
    const entered = await edit('CODE-Enter', 'S1', 1, 1, 0, timing === 'held' ? true : undefined, false, 'right');
    expect(entered.render.nativeEnter).toMatchObject({ trusted: true, matchesExpectedText: true,
      matchesExpectedCodeGlyphs: true, expectedBreakCount: true, literalBrVisible: false });
    if (timing === 'held') {
      await held.waitFor(SourceFixture.S1); await checkpoint('real-S1-PHP200-still-withheld', 'S1', true, false, 'right');
    } else {
      await acceptFixed('S1'); await clickCode('B', 0);
      await edit('formal-S1-real-B0', 'S1', 1, 1, 0, false, true, 'right');
    }
    phase = 'real-CODE-immediate-Backspace'; await page.keyboard.press('Backspace');
    await edit('CODE-Backspace-fixed-S0', 'S0', 2, 2, 0, timing === 'held' ? true : undefined, false, 'middle');
    phase = 'real-Undo-CODE-Backspace'; await page.keyboard.press('Control+z');
    await edit('Undo-CODE-Backspace-fixed-S1', 'S1', 3, 1, 1, timing === 'held' ? true : undefined, false, null, false);
    phase = 'real-Redo-CODE-Backspace'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-CODE-Backspace-fixed-S0', 'S0', 4, 2, 0, timing === 'held' ? true : undefined, false, null, false);
    if (held) { await held.close(); held = null; }
    await edit('released-formal-S0', 'S0', 4, 2, 0, false, true, 'middle');
    phase = 'real-Undo-BS-to-S1'; await page.keyboard.press('Control+z');
    await edit('Undo-BS-formal-S1-right-point', 'S1', 5, 1, 1, false, true, 'right');
    phase = 'real-Undo-CODE-Enter'; await page.keyboard.press('Control+z');
    await edit('Undo-Enter-formal-S0', 'S0', 6, 0, 2, false, true, 'middle');
    phase = 'real-Redo-CODE-Enter'; await page.keyboard.press('Control+Shift+z');
    // No click/selection repair here: exercise the previously unverified Redo S1 native CODE boundary.
    await edit('Redo-Enter-formal-S1-right-point', 'S1', 7, 1, 1, false, true, 'right');
    phase = 'real-right-span-T'; await page.keyboard.type('T');
    await edit('right-span-fixed-S1T', 'S1T', 8, 2, 0, undefined, false, 'right-T');
    await acceptFixed('S1T'); await clickCode('TB', 1);
    await edit('formal-S1T-real-TB-point', 'S1T', 8, 2, 0, false, true, 'right-T');
    phase = 'real-Undo-right-span-T'; await page.keyboard.press('Control+z');
    await edit('Undo-right-T-formal-S1', 'S1', 9, 1, 1, false, true, 'right');
    phase = 'real-Undo-Enter-for-ST'; await page.keyboard.press('Control+z');
    await edit('restored-formal-S0-for-ST', 'S0', 10, 0, 2, false, true, 'middle');
    phase = 'real-original-span-T'; await page.keyboard.type('T');
    await edit('original-span-fixed-ST', 'ST', 11, 1, 0, undefined, false, 'middle-T');
    phase = 'real-Undo-original-span-T'; await page.keyboard.press('Control+z');
    await edit('final-formal-S0', 'S0', 12, 0, 1, false, true, 'middle');
    expect(failures).toEqual([]);
  } catch (error) {
    primaryError = error;
    const owner = await readCurrentDocumentOwner(page).then((value) => ({ available: true, ...value }), () => ({ available: false }));
    const current = await page.evaluate(({ expected, prefix, suffix, candidates }) => {
      const field = document.querySelector('#easymde-source'), active = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      // Actual strings stay private in this evaluation; emit exact-match booleans and a bounded enum only.
      const value = field instanceof HTMLTextAreaElement ? field.value : null;
      const outsideCellExact = value !== null && value.length >= prefix.length + suffix.length
        && value.startsWith(prefix) && value.endsWith(suffix);
      const target = outsideCellExact ? value.slice(prefix.length, value.length - suffix.length) : null;
      const candidateExact = Object.fromEntries(Object.entries(candidates).map(([kind, candidate]) => [kind, target !== null && target === candidate]));
      const classification = Object.keys(candidates).find((kind) => candidateExact[kind]) ?? 'other';
      return { available: true, sourceLength: value?.length ?? null,
        sourceExact: value === null ? null : value === expected, visualOwnerPresent: !!active,
        sourceClassification: { available: value !== null, outsideCellExact, targetExtractable: target !== null,
          classification, candidateExact },
        locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null };
    }, { expected: SourceFixture[expectedKey], prefix, suffix, candidates: sourceCandidates }).catch(() => ({ available: false }));
    const native = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), expectedKey)
      .then((value) => ({ available: true, ...value }), () => ({ available: false })) : { available: false };
    // Read once at failure: do not wait for Preview publication or repair the native caret.
    const finalFormal = await runtimeState(expectedKey, true).then((state) => ({ available: true,
      phase: state.phase, runtimePending: state.runtimePending, revision: state.revision, sourceLength: state.sourceLength,
      sourceMatchesFixedOracle: state.sourceMatchesExpected, formalCurrent: state.previewEvidence.formalCurrent,
      nodesCurrent: state.previewEvidence.nodesCurrent, publisherGeneration: state.previewEvidence.publisherGeneration,
      publisherSourceRevision: state.previewEvidence.publisherSourceRevision,
      windowGeneration: state.previewEvidence.windowGeneration, windowSourceRevision: state.previewEvidence.windowSourceRevision }),
    () => ({ available: false }));
    console.log(JSON.stringify({ event: 'rich-code-first-failure', timing, operation: phase, fixedOracle: expectedKey,
      owner, current, native, finalFormal, preErrorCheckpoint: lastObservation, failures, diagnostics }));
    throw error;
  } finally {
    const resources = [];
    const cleanup = async (step, action) => { try { await action(); resources.push({ step, completed: true }); }
      catch { resources.push({ step, completed: false }); } };
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('rich-console-remove', () => page.off('console', observeDiagnostic));
    if (receipts) { await cleanup('rich-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('rich-receipt-dispose', () => receipts.dispose()); }
    if (retainedNodes) await cleanup('rich-retained-dispose', () => retainedNodes.dispose());
    await cleanup('rich-surface-dispose', () => surface.dispose());
    const cleanupFailed = resources.some((value) => !value.completed);
    console.log(JSON.stringify({ event: 'rich-code-cleanup', timing, cleanupFailed, resources }));
    if (cleanupFailed && primaryError === null) throw new Error('rich-code-cleanup-failed');
  }
});
}
}

// Opt-in non-CODE rich cells. Keep the separately frozen CODE acceptance unchanged.
if (process.env.EASYMDE_E2E_RICH_TABLE_INLINE === 'complete') {
const richInlineHref = 'https://example.com/rich?q=1&v=2';
const richInlineCases = [
  { kind: 'A', selector: 'a', chain: ['A'], before: 'L [', after: `](${richInlineHref} "Keep") R`, linked: true },
  { kind: 'EM', selector: 'em', chain: ['EM'], before: 'L *', after: '* R', linked: false },
  { kind: 'STRONG', selector: 'strong', chain: ['STRONG'], before: 'L **', after: '** R', linked: false },
  { kind: 'DEL', selector: 'del, s, strike', chain: ['DEL'], before: 'L ~~', after: '~~ R', linked: false },
  { kind: 'NESTED', selector: 'em', chain: ['STRONG', 'A', 'DEL', 'EM'], before: 'L **[~~*',
    after: `*~~](${richInlineHref} "Keep")** R`, linked: true }
];
for (const inline of richInlineCases) {
for (const timing of ['ready', 'held']) {
test(`[rich-table-inline] windowed ${timing} fixed ${inline.kind} Enter Backspace history and right-span continuation`, async ({ page }) => {
  const prefix = 'Lead.\n\n> - Keep.\n>\n>   | Left | Target | Right |\n>   | :--- | :---: | ---: |\n'
    + '>   | up | guard | end |\n>   | left | ';
  const suffix = ' | right |\n>   | down | guard | end |\n\n'
    + 'After \\*literal\\* **outside** *emphasis* [keep](https://example.com/keep?q=1&v=2 "Guard").\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  // Fixed semantic contract: unlike CODE, these wrappers contain the real BR without splitting/normalizing tags.
  // Every oracle is built only from these declared fragments, never from native DOM or a PHP response.
  const bodies = { S0: 'AB', S1: 'A<br>B', S1T: 'A<br>TB', ST: 'ATB' };
  const targetSource = Object.fromEntries(Object.entries(bodies).map(([key, body]) => [key, inline.before + body + inline.after]));
  const SourceFixture = Object.fromEntries(Object.entries(targetSource).map(([key, value]) => [key, prefix + value + suffix]));
  SourceFixture.SV = prefix.replace(/^Lead\./u, 'Lead.V') + targetSource.S0 + suffix;
  const sourceMiddle = prefix.length + inline.before.length + 1;
  const caret = { S0: sourceMiddle, S1: sourceMiddle + 4, S1T: sourceMiddle + 5, ST: sourceMiddle + 1 };
  const { failures, source, visual } = await openVisual(page, SourceFixture.S0);
  const surface = await visual.elementHandle();
  if (!surface) throw new Error('rich-inline-surface-unavailable');
  const cell = visual.locator('blockquote li table tbody tr').nth(1).locator('td').nth(1);
  const lock = page.locator('.easymde-immersive-preview-lock');
  const browserErrors = { pageErrors: 0, popups: 0, dialogs: 0 };
  const onPageError = () => { browserErrors.pageErrors++; };
  const onPopup = () => { browserErrors.popups++; };
  const onDialog = (dialog) => { browserErrors.dialogs++; void dialog.dismiss().catch(() => {}); };
  page.on('pageerror', onPageError); page.on('popup', onPopup); page.on('dialog', onDialog);
  let phase = 'initial-formal-S0', expectedKey = 'S0', held = null, retainedNodes = null, receipts = null;
  let primaryError = null, lastObservation = null;
  const healthy = () => { expect(failures).toEqual([]); expect(browserErrors).toEqual({ pageErrors: 0, popups: 0, dialogs: 0 }); };
  const runtimeState = (key, formal = false) => readWindowedSmokeState(surface, { expectedSource: SourceFixture[key], previewEvidence: formal });
  const checkpoint = async (stage, key, pending, formal = false, point = false, renderRequired = true) => {
    phase = stage; expectedKey = key; healthy();
    await expectSource(source, SourceFixture[key]);
    await expect.poll(async () => {
      healthy(); const state = await runtimeState(key, formal);
      return state.sourceMatchesExpected && (pending === undefined || state.runtimePending === pending)
        && (!formal || state.phase === 'ready' && state.previewEvidence.formalCurrent);
    }).toBe(true);
    const state = await runtimeState(key, formal), owner = await readCurrentDocumentOwner(page);
    const render = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), key === 'SV' ? 'S0' : key) : null;
    lastObservation = { stage, fixedOracle: key, sourceExact: state.sourceMatchesExpected, sourceLength: state.sourceLength,
      owner, phase: state.phase, runtimePending: state.runtimePending,
      formal: formal ? { formalCurrent: state.previewEvidence.formalCurrent, nodesCurrent: state.previewEvidence.nodesCurrent,
        publisherGeneration: state.previewEvidence.publisherGeneration, publisherSourceRevision: state.previewEvidence.publisherSourceRevision,
        windowGeneration: state.previewEvidence.windowGeneration, windowSourceRevision: state.previewEvidence.windowSourceRevision } : null,
      presentation: renderRequired ? 'render-checked' : 'history-presentation-observed-not-oracled', render, browserErrors: { ...browserErrors } };
    console.log(JSON.stringify({ event: 'rich-inline-checkpoint', kind: inline.kind, timing, ...lastObservation }));
    expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true, contenteditable: 'true',
      lock: 'false', session: 'ready', windowedControllerCount: 1, runtimeCount: 1 });
    expect(state.spacers).toBeGreaterThan(0);
    if (render) {
      expect(render.current).toMatchObject({ available: true, tableUnique: true, targetUnique: true, headersExact: true,
        guardCellsExact: true, leafCount: 1, chainExact: true, linkAttributesExact: true, leafEditable: true, codeCount: 0 });
      if (renderRequired) expect(render.current).toMatchObject({ textExact: true, glyphsExact: true, breakCountExact: true,
        breakInsideLeaf: true, literalBrVisible: false });
      if (!renderRequired) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true });
      if (point) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeInsideLeaf: true,
        nativeCollapsed: true, semanticBeforeB: true, bodyGlyphPrefix: key === 'S1T' || key === 'ST' ? 2 : 1,
        prefixBreaks: key === 'S1' || key === 'S1T' ? 1 : 0 });
    }
    healthy(); return { state, owner, render };
  };
  const acceptFixed = async (key) => {
    const before = await readCurrentDocumentOwner(page); await expectSource(source, SourceFixture[key]);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === SourceFixture[key]; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(page.locator('[data-easymde-preview-html-sink]')).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint('formal-' + key, key, false, true);
    expect(await readCurrentDocumentOwner(page)).toMatchObject({ revision: before.revision, history: before.history });
  };
  const clickBeforeB = async () => {
    const point = await cell.evaluate((target, selector) => {
      const leaves = target.querySelectorAll(selector);
      if (leaves.length !== 1) throw new Error('rich-inline-pointer-leaf-not-unique');
      const walker = document.createTreeWalker(leaves[0], NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.data.length; index++) if (node.data[index] === 'B') matches.push({ node, offset: index });
      }
      if (matches.length !== 1) throw new Error('rich-inline-pointer-B-not-unique');
      const range = document.createRange(); range.setStart(matches[0].node, matches[0].offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('rich-inline-pointer-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    }, inline.selector);
    await page.mouse.click(point.x, point.y);
  };
  try {
    await checkpoint('initial-formal-S0', 'S0', false, true);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody tr')).toHaveCount(3);
    await expect(cell).toHaveCount(1);
    receipts = await surface.evaluateHandle((root, spec) => {
      const events = []; let nativeEnter = null, nativeText = null, nativeBackspace = null;
      let readyNavigationBaseline = null, rootInputEvents = 0, rootHistoryKeys = 0;
      const readReadyIdentity = () => {
        const container = document.querySelector('#easymde-editor-root');
        const keys = container ? Object.getOwnPropertyNames(container).filter((key) => key.startsWith('__reactContainer$')) : [];
        const current = keys.length === 1 ? container[keys[0]]?.stateNode?.current : null;
        if (current?.tag !== 3) throw new Error('rich-inline-ready-root-unavailable');
        const fibers = [], owners = new Set(), pending = current.child ? [current.child] : [];
        while (pending.length) {
          if (fibers.length >= 8192) throw new Error('rich-inline-ready-fiber-bound');
          const fiber = pending.pop(); fibers.push(fiber);
          for (const owner of [fiber.memoizedProps?.documentSession?.document, fiber.memoizedProps?.ordinaryStatus?.document]) if (owner) owners.add(owner);
          if (fiber.child) pending.push(fiber.child); if (fiber.sibling) pending.push(fiber.sibling);
        }
        if (owners.size !== 1) throw new Error('rich-inline-ready-owner-not-unique');
        const owner = owners.values().next().value;
        const controllers = fibers.filter(({ memoizedProps: props }) => props?.surface === root && props.documentSession?.document === owner
          && props.editMap?.version === 1 && ['getAcceptedWindowSnapshot', 'getAcceptedWindowRow', 'requestPreviewAtDocumentEnd',
            'prepareWindowBlockAdoption'].every((key) => typeof props[key] === 'function'));
        if (controllers.length !== 1) throw new Error('rich-inline-ready-controller-not-unique');
        const controller = controllers[0], props = controller.memoizedProps, sourceField = document.querySelector('#easymde-source');
        const editorRoots = fibers.filter(({ memoizedProps: entry }) => entry?.submissionField === sourceField
          && typeof entry.nativePublishPort?.read === 'function' && typeof entry.immersiveStrings?.previewEditorLabel === 'string');
        if (editorRoots.length !== 1) throw new Error('rich-inline-ready-editor-root-not-unique');
        const runtimes = new Set(); let hooks = 0;
        for (let hook = editorRoots[0].memoizedState; hook; hook = hook.next) {
          if (++hooks > 512) throw new Error('rich-inline-ready-hook-bound');
          const ref = hook.memoizedState, value = ref && Object.hasOwn(ref, 'current') ? ref.current : null;
          if (value?.surface === root && ['isEditable', 'isTransferPending', 'executeCommand', 'prepareContextMenuDemand']
            .every((key) => typeof value[key] === 'function')) runtimes.add(value);
        }
        if (runtimes.size !== 1) throw new Error('rich-inline-ready-runtime-not-unique');
        // The pinned Windowed owner declares these as its first two useRef slots; retain their identities too.
        const transferRef = controller.memoizedState?.memoizedState, leaseRef = controller.memoizedState?.next?.memoizedState;
        if (!transferRef || !leaseRef || !Object.hasOwn(transferRef, 'current') || !Object.hasOwn(leaseRef, 'current')) {
          throw new Error('rich-inline-ready-transfer-slots-unavailable');
        }
        const runtime = runtimes.values().next().value, value = owner.getValue(), revision = owner.getRevision();
        const selection = owner.getSelection(), history = owner.getHistoryState(), generated = props.getGeneratedPreviewIdentity();
        const accepted = props.getAcceptedWindowSnapshot(), nodes = [...root.childNodes];
        const nodesCurrent = !!accepted && accepted.nodes.length === nodes.length && accepted.nodes.every((node, index) => node === nodes[index]);
        const formalCurrent = !!generated && !!accepted && nodesCurrent && generated.sourceRevision === revision
          && accepted.sourceRevision === revision && accepted.revision === generated.revision && accepted.signature === generated.signature
          && props.previewSnapshot.signature === generated.signature && props.editMap.signature === generated.signature
          && generated.editMap === props.editMap && accepted.editMap === props.editMap;
        return { container, controller, owner, session: props.documentSession, runtime, surface: root, transferRef, leaseRef,
          transfer: transferRef.current, lease: leaseRef.current, value, revision, selectionJSON: JSON.stringify(selection),
          historyJSON: JSON.stringify(history), selection: { start: selection.start, end: selection.end, direction: selection.direction },
          history: { undoDepth: history.undoDepth, redoDepth: history.redoDepth }, nodes, nodesCurrent, formalCurrent,
          fieldMatchesOwner: sourceField instanceof HTMLTextAreaElement && sourceField.value === value,
          ready: root.getAttribute('data-easymde-preview-phase') === 'ready' && !runtime.isTransferPending()
            && document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') === 'ready'
            && root.isConnected && root.isContentEditable && runtime.isEditable() && owner.isEditable(),
          editMap: props.editMap, generatedRevision: generated?.revision, generatedSourceRevision: generated?.sourceRevision,
          generatedSignature: generated?.signature, generatedMap: generated?.editMap,
          acceptedKey: accepted?.key, acceptedRevision: accepted?.revision, acceptedSourceRevision: accepted?.sourceRevision,
          acceptedSignature: accepted?.signature, acceptedMap: accepted?.editMap, rootInputEvents, rootHistoryKeys };
      };
      const target = () => root.querySelector('blockquote li table tbody')?.rows[1]?.cells[1] ?? null;
      const shape = () => {
        const cell = target(), tables = root.querySelectorAll('blockquote li table'), table = tables.length === 1 ? tables[0] : null;
        const rows = [...(table?.tBodies[0]?.rows ?? [])], leaves = [...(cell?.querySelectorAll(spec.selector) ?? [])];
        const leaf = leaves.length === 1 ? leaves[0] : null, chain = [], links = [...(cell?.querySelectorAll('a') ?? [])];
        for (let node = leaf; node && node !== cell; node = node.parentElement) {
          if (node.tagName !== 'SPAN') chain.unshift(['S', 'STRIKE'].includes(node.tagName) ? 'DEL' : node.tagName);
        }
        const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
        return { available: !!cell, tableUnique: tables.length === 1, targetUnique: rows[1]?.cells[1] === cell,
          headersExact: [...(table?.tHead?.rows[0]?.cells ?? [])].map((node) => node.textContent).join('|') === 'Left|Target|Right',
          guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
            && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])),
          text: cell?.innerText ?? '', glyphs: leaf?.textContent ?? '', breaks: cell?.querySelectorAll('br').length ?? 0,
          leafBreaks: leaf?.querySelectorAll('br').length ?? 0, leafCount: leaves.length,
          chainExact: chain.length === spec.chain.length && chain.every((tag, index) => tag === spec.chain[index]),
          linkAttributesExact: spec.linked ? links.length === 1 && links[0].getAttribute('href') === spec.href
            && links[0].getAttribute('title') === 'Keep' : links.length === 0,
          leafEditable: leaf?.isContentEditable === true, codeCount: cell?.querySelectorAll('code').length ?? 0 };
      };
      const observe = (event) => {
        if (!(event.target instanceof Node) || !root.contains(event.target)) return;
        if (event.type === 'keydown') {
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) rootHistoryKeys++;
          return;
        }
        rootInputEvents++;
        const cell = target(), selection = getSelection();
        if (!cell?.contains(selection?.anchorNode)) return;
        const types = ['insertParagraph', 'insertLineBreak', 'deleteContentBackward', 'insertText', 'historyUndo', 'historyRedo'];
        if (events.length < 40) events.push({ type: event.type, inputType: types.includes(event.inputType) ? event.inputType : 'unrecognized',
          trusted: event.isTrusted, collapsed: selection?.isCollapsed === true });
        if (event.type !== 'input') return;
        if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') && !nativeEnter) nativeEnter = { ...shape(), trusted: event.isTrusted };
        if (event.inputType === 'deleteContentBackward') nativeBackspace = { ...shape(), trusted: event.isTrusted };
        if (event.inputType === 'insertText') nativeText = { ...shape(), trusted: event.isTrusted };
      };
      document.addEventListener('beforeinput', observe, true); document.addEventListener('input', observe, true); document.addEventListener('keydown', observe, true);
      return {
        captureReadyNavigation: (expectedSource) => {
          const before = readReadyIdentity(); readyNavigationBaseline = { ...before, expectedSource };
          return { ready: before.ready, sourceExact: before.value === expectedSource && before.fieldMatchesOwner,
            noTransfer: before.transfer === null, noLease: before.lease === null,
            formalCurrent: before.formalCurrent, nodesCurrent: before.nodesCurrent, revision: before.revision,
            selection: before.selection, history: before.history };
        },
        checkReadyNavigation: (targetCaret) => {
          if (!readyNavigationBaseline) throw new Error('rich-inline-ready-baseline-unavailable');
          const before = readyNavigationBaseline, after = readReadyIdentity();
          const retained = after.selectionJSON === before.selectionJSON;
          const alreadyTarget = after.selection.start === targetCaret && after.selection.end === targetCaret && after.selection.direction === 'none';
          return { readyBeforeAndAfter: before.ready && after.ready,
            sameOwner: after.owner === before.owner, sameSession: after.session === before.session,
            sameRuntime: after.runtime === before.runtime, sameSurface: after.surface === before.surface && after.container === before.container,
            sameWindowedOwner: after.controller === before.controller || after.controller === before.controller.alternate,
            sameTransferRef: after.transferRef === before.transferRef, sameLeaseRef: after.leaseRef === before.leaseRef,
            noTransfer: before.transfer === null && after.transfer === null, noLease: before.lease === null && after.lease === null,
            sourceExact: before.value === before.expectedSource && after.value === before.expectedSource,
            fieldMatchesOwner: before.fieldMatchesOwner && after.fieldMatchesOwner,
            revisionUnchanged: after.revision === before.revision, fullHistoryUnchanged: after.historyJSON === before.historyJSON,
            canonicalSelectionAllowed: alreadyTarget || retained,
            canonicalMode: alreadyTarget ? 'already-target' : retained ? 'retained-pre-navigation' : 'unproved',
            baselineCanonical: before.selection, currentCanonical: after.selection,
            formalCurrent: before.formalCurrent && after.formalCurrent, nodesCurrent: before.nodesCurrent && after.nodesCurrent,
            nodesUnchanged: after.nodes.length === before.nodes.length && after.nodes.every((node, index) => node === before.nodes[index]),
            formalIdentityUnchanged: after.editMap === before.editMap && after.generatedRevision === before.generatedRevision
              && after.generatedSourceRevision === before.generatedSourceRevision && after.generatedSignature === before.generatedSignature
              && after.generatedMap === before.generatedMap && after.acceptedKey === before.acceptedKey
              && after.acceptedRevision === before.acceptedRevision && after.acceptedSourceRevision === before.acceptedSourceRevision
              && after.acceptedSignature === before.acceptedSignature && after.acceptedMap === before.acceptedMap,
            noInputEvents: after.rootInputEvents === before.rootInputEvents, noHistoryKeys: after.rootHistoryKeys === before.rootHistoryKeys };
        },
        safe: (kind) => {
        const current = shape(), cell = target(), leaves = [...(cell?.querySelectorAll(spec.selector) ?? [])], leaf = leaves.length === 1 ? leaves[0] : null;
        const native = getSelection(), anchor = native?.anchorNode, focus = native?.focusNode;
        const glyphs = kind === 'S1T' || kind === 'ST' ? 'ATB' : 'AB';
        const breaks = kind === 'S1' || kind === 'S1T' ? 1 : 0;
        const expectedText = kind === 'S1T' ? 'L A\nTB R' : kind === 'S1' ? 'L A\nB R' : kind === 'ST' ? 'L ATB R' : 'L AB R';
        const scalar = (value) => ({ available: value.available, tableUnique: value.tableUnique, targetUnique: value.targetUnique,
          headersExact: value.headersExact, guardCellsExact: value.guardCellsExact, leafCount: value.leafCount, chainExact: value.chainExact,
          linkAttributesExact: value.linkAttributesExact, leafEditable: value.leafEditable, codeCount: value.codeCount,
          textLength: value.text.length, glyphLength: value.glyphs.length, breaks: value.breaks,
          textExact: value.text === expectedText, glyphsExact: value.glyphs === glyphs, breakCountExact: value.breaks === breaks,
          breakInsideLeaf: value.leafBreaks === value.breaks, literalBrVisible: value.text.includes('<br>') });
        const insideCell = !!cell && !!anchor && !!focus && cell.contains(anchor) && cell.contains(focus);
        const insideLeaf = !!leaf && !!anchor && !!focus && leaf.contains(anchor) && leaf.contains(focus);
        const sameCollapsedPoint = native?.isCollapsed === true && anchor === focus && native.anchorOffset === native.focusOffset;
        const bPoints = [];
        if (leaf) {
          const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (let offset = 0; offset < node.data.length; offset++) if (node.data[offset] === 'B') bPoints.push({ node, offset });
          }
        }
        const targetPoint = bPoints.length === 1 ? bPoints[0] : null;
        const transparent = (node) => node instanceof Element
          && ['A', 'EM', 'STRONG', 'B', 'I', 'DEL', 'S', 'STRIKE', 'SPAN', 'MARK', 'SUB', 'SUP'].includes(node.tagName)
          && !node.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]');
        let rank = 0, targetRank = null, anchorRank = null, focusRank = null;
        const record = (node, offset, value) => {
          if (targetPoint?.node === node && targetPoint.offset === offset) targetRank = value;
          if (anchor === node && native.anchorOffset === offset) anchorRank = value;
          if (focus === node && native.focusOffset === offset) focusRank = value;
        };
        const visit = (node) => {
          if (node instanceof Text) {
            for (let offset = 0; offset <= node.data.length; offset++) record(node, offset, rank + offset);
            rank += Math.max(1, node.data.length); return;
          }
          // BR/comment/opaque nodes carry a nonzero token: equivalence cannot cross any of them.
          if (!transparent(node)) { rank++; return; }
          record(node, 0, rank);
          [...node.childNodes].forEach((child, index) => { visit(child); record(node, index + 1, rank); });
        };
        if (leaf) visit(leaf);
        const forward = (node, offset) => {
          if (!targetPoint || !node || !leaf?.contains(node)) return false;
          const actual = document.createRange(), expected = document.createRange();
          actual.setStart(node, offset); actual.collapse(true); expected.setStart(targetPoint.node, targetPoint.offset); expected.collapse(true);
          return actual.compareBoundaryPoints(Range.START_TO_START, expected) <= 0;
        };
        const anchorForward = forward(anchor, native?.anchorOffset ?? 0), focusForward = forward(focus, native?.focusOffset ?? 0);
        const noObservableTokenBetween = targetRank !== null && anchorRank === targetRank && focusRank === targetRank;
        const semanticBeforeB = insideLeaf && sameCollapsedPoint && bPoints.length === 1 && anchorForward && focusForward && noObservableTokenBetween;
        let bodyGlyphPrefix = null, prefixBreaks = null;
        if (insideLeaf) {
          const range = document.createRange(); range.selectNodeContents(leaf); range.setEnd(anchor, native.anchorOffset);
          const fragment = range.cloneContents(); bodyGlyphPrefix = fragment.textContent.length; prefixBreaks = fragment.querySelectorAll('br').length;
        }
        const raw = (node, offset) => ({ nodeType: node?.nodeType ?? null, ownTag: node instanceof Element ? node.tagName : null,
          parentTag: node?.parentElement?.tagName ?? null, offset, connected: !!node?.isConnected });
        const comparison = kind === 'S1' ? nativeEnter : kind === 'S1T' || kind === 'ST' ? nativeText : nativeBackspace;
        return { current: scalar(current), nativeEnter: nativeEnter ? { ...scalar(nativeEnter), trusted: nativeEnter.trusted } : null,
          nativeText: nativeText ? { ...scalar(nativeText), trusted: nativeText.trusted } : null,
          nativeBackspace: nativeBackspace ? { ...scalar(nativeBackspace), trusted: nativeBackspace.trusted } : null,
          matchesNativeText: comparison ? current.text === comparison.text : null, matchesNativeGlyphs: comparison ? current.glyphs === comparison.glyphs : null,
          nativeConnected: !!anchor?.isConnected && !!focus?.isConnected, nativeInsideCell: insideCell, nativeInsideLeaf: insideLeaf,
          nativeCollapsed: native?.isCollapsed === true, nativeAnchor: raw(anchor, native?.anchorOffset ?? 0), nativeFocus: raw(focus, native?.focusOffset ?? 0),
          bodyGlyphPrefix, prefixBreaks, semanticBeforeB,
          boundaryProof: { leafUnique: leaves.length === 1, bTextUnique: bPoints.length === 1, sameCollapsedPoint,
            targetRank, anchorRank, focusRank, anchorForward, focusForward, noObservableTokenBetween,
            rawTextBeforeB: !!targetPoint && anchor === targetPoint.node && native.anchorOffset === targetPoint.offset }, events: events.slice() };
      }, dispose: () => { document.removeEventListener('beforeinput', observe, true); document.removeEventListener('input', observe, true);
        document.removeEventListener('keydown', observe, true); readyNavigationBaseline = null; } };
    }, { selector: inline.selector, chain: inline.chain, linked: inline.linked, href: richInlineHref });
    await checkpoint('loaded-unique-rich-target', 'S0', false, true);
    await visual.locator('p').filter({ hasText: /^Lead\.$/u }).first().click(); await page.keyboard.press('End');
    phase = 'real-Lead-V'; await page.keyboard.type('V'); await expectSource(source, SourceFixture.SV); await acceptFixed('SV');
    await visual.locator('p').filter({ hasText: /^Lead\.V$/u }).first().click(); await page.keyboard.press('End');
    retainedNodes = await surface.evaluateHandle((root) => [...root.childNodes]); held = await holdFormalPreview(page);
    phase = 'real-Undo-V-held-S0'; await page.keyboard.press('Control+z');
    await expectSource(source, SourceFixture.S0); await held.waitFor(SourceFixture.S0);
    await checkpoint('real-S0-PHP200-withheld', 'S0', true);
    expect(await surface.evaluate((root, nodes) => root.childNodes.length === nodes.length
      && nodes.every((node, index) => root.childNodes[index] === node), retainedNodes)).toBe(true);
    if (timing === 'ready') { await held.close(); held = null; await checkpoint('released-formal-S0', 'S0', false, true); }
    const base = await checkpoint('before-rich-Enter', 'S0', timing === 'held');
    if (timing === 'ready') {
      phase = 'capture-ready-pre-navigation';
      const before = await receipts.evaluate((observer, expected) => observer.captureReadyNavigation(expected), SourceFixture.S0);
      console.log(JSON.stringify({ event: 'rich-inline-ready-pre-navigation', kind: inline.kind, timing, before }));
      expect(before).toMatchObject({ ready: true, sourceExact: true, noTransfer: true, noLease: true, formalCurrent: true, nodesCurrent: true });
    }
    await clickBeforeB();
    await checkpoint('real-initial-before-B', 'S0', timing === 'held', timing === 'ready', true);
    expect(await readCurrentDocumentOwner(page)).toMatchObject({ revision: base.owner.revision, history: base.owner.history });
    if (timing === 'ready') {
      const evidence = await receipts.evaluate((observer, targetCaret) => ({ certificate: observer.checkReadyNavigation(targetCaret),
        native: observer.safe('S0') }), caret.S0);
      console.log(JSON.stringify({ event: 'rich-inline-ready-native-first', kind: inline.kind, timing, ...evidence }));
      expect(evidence.certificate).toMatchObject({ readyBeforeAndAfter: true, sameOwner: true, sameSession: true,
        sameRuntime: true, sameSurface: true, sameWindowedOwner: true, sameTransferRef: true, sameLeaseRef: true,
        noTransfer: true, noLease: true, sourceExact: true, fieldMatchesOwner: true, revisionUnchanged: true,
        fullHistoryUnchanged: true, canonicalSelectionAllowed: true, formalCurrent: true, nodesCurrent: true,
        nodesUnchanged: true, formalIdentityUnchanged: true, noInputEvents: true, noHistoryKeys: true });
      expect(evidence.native).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeInsideLeaf: true,
        nativeCollapsed: true, semanticBeforeB: true, bodyGlyphPrefix: 1, prefixBreaks: 0,
        current: { tableUnique: true, targetUnique: true, leafCount: 1, chainExact: true, linkAttributesExact: true,
          leafEditable: true, textExact: true, glyphsExact: true, breakCountExact: true, guardCellsExact: true } });
    } else {
      // Pending navigation retains its separate strict canonical target requirement.
      expect(await readCurrentDocumentOwner(page)).toMatchObject({ selection: { start: caret.S0, end: caret.S0, direction: 'none' } });
    }
    const edit = async (stage, key, step, undoDelta, redoDepth, pending, formal = false, point = true, renderRequired = true) => {
      const state = await checkpoint(stage, key, pending, formal, point, renderRequired);
      expect(state.owner.revision).toBe(base.owner.revision + step);
      expect(state.owner.history).toEqual({ undoDepth: base.owner.history.undoDepth + undoDelta, redoDepth });
      expect(state.owner.selection).toEqual({ start: caret[key], end: caret[key], direction: 'none' }); return state;
    };
    phase = 'real-rich-Enter'; await page.keyboard.press('Enter');
    const entered = await edit('rich-Enter-fixed-S1', 'S1', 1, 1, 0, timing === 'held' ? true : undefined);
    expect(entered.render.nativeEnter).toMatchObject({ trusted: true, textExact: true, glyphsExact: true, breakCountExact: true,
      breakInsideLeaf: true, chainExact: true, linkAttributesExact: true });
    if (timing === 'held') { await held.waitFor(SourceFixture.S1); await checkpoint('real-S1-PHP200-still-withheld', 'S1', true, false, true); }
    else { await acceptFixed('S1'); await clickBeforeB(); await edit('formal-S1-real-before-B', 'S1', 1, 1, 0, false, true); }
    phase = 'real-rich-Backspace'; await page.keyboard.press('Backspace');
    const deleted = await edit('rich-Backspace-fixed-S0', 'S0', 2, 2, 0, timing === 'held' ? true : undefined);
    expect(deleted.render.nativeBackspace).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      breakCountExact: true, chainExact: true, linkAttributesExact: true });
    phase = 'real-Undo-rich-Backspace'; await page.keyboard.press('Control+z');
    await edit('Undo-rich-Backspace-fixed-S1', 'S1', 3, 1, 1, timing === 'held' ? true : undefined, false, false, false);
    phase = 'real-Redo-rich-Backspace'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-rich-Backspace-fixed-S0', 'S0', 4, 2, 0, timing === 'held' ? true : undefined, false, false, false);
    if (held) { await held.close(); held = null; }
    await edit('released-formal-S0', 'S0', 4, 2, 0, false, true);
    phase = 'real-Undo-BS-to-S1'; await page.keyboard.press('Control+z');
    await edit('Undo-BS-formal-S1-before-B', 'S1', 5, 1, 1, false, true);
    phase = 'real-Undo-rich-Enter'; await page.keyboard.press('Control+z');
    await edit('Undo-Enter-formal-S0', 'S0', 6, 0, 2, false, true);
    phase = 'real-Redo-rich-Enter'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-Enter-formal-S1-before-B', 'S1', 7, 1, 1, false, true);
    // No pointer/selection repair between the proven history-restored point and this real input.
    phase = 'real-right-span-T'; await page.keyboard.type('T');
    const rightTyped = await edit('right-span-fixed-S1T', 'S1T', 8, 2, 0, undefined);
    expect(rightTyped.render.nativeText).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      chainExact: true, linkAttributesExact: true });
    await acceptFixed('S1T'); await clickBeforeB(); await edit('formal-S1T-real-before-B', 'S1T', 8, 2, 0, false, true);
    phase = 'real-Undo-right-span-T'; await page.keyboard.press('Control+z');
    await edit('Undo-right-T-formal-S1', 'S1', 9, 1, 1, false, true);
    phase = 'real-Undo-Enter-for-ST'; await page.keyboard.press('Control+z');
    await edit('restored-formal-S0-for-ST', 'S0', 10, 0, 2, false, true);
    phase = 'real-original-span-T'; await page.keyboard.type('T');
    const originalTyped = await edit('original-span-fixed-ST', 'ST', 11, 1, 0, undefined);
    expect(originalTyped.render.nativeText).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      chainExact: true, linkAttributesExact: true });
    phase = 'real-Undo-original-span-T'; await page.keyboard.press('Control+z');
    await edit('final-formal-S0', 'S0', 12, 0, 1, false, true); healthy();
  } catch (error) {
    primaryError = error;
    const owner = await readCurrentDocumentOwner(page).then((value) => ({ available: true, ...value }), () => ({ available: false }));
    const current = await page.evaluate(({ prefix, suffix, expected, variants }) => {
      const field = document.querySelector('#easymde-source'), value = field instanceof HTMLTextAreaElement ? field.value : null;
      const outsideCellExact = value !== null && value.length >= prefix.length + suffix.length && value.startsWith(prefix) && value.endsWith(suffix);
      const target = outsideCellExact ? value.slice(prefix.length, value.length - suffix.length) : null;
      return { available: value !== null, sourceLength: value?.length ?? null, sourceExact: value === expected, outsideCellExact,
        targetMatchesDeclared: Object.fromEntries(Object.entries(variants).map(([key, candidate]) => [key, target !== null && target === candidate])) };
    }, { prefix, suffix, expected: SourceFixture[expectedKey], variants: targetSource }).catch(() => ({ available: false }));
    const native = receipts ? await receipts.evaluate((observer, key) => observer.safe(key), expectedKey).catch(() => ({ available: false })) : null;
    const finalFormal = await runtimeState(expectedKey, true).then((state) => ({ available: true, phase: state.phase,
      runtimePending: state.runtimePending, revision: state.revision, sourceLength: state.sourceLength,
      formalCurrent: state.previewEvidence.formalCurrent, nodesCurrent: state.previewEvidence.nodesCurrent,
      publisherGeneration: state.previewEvidence.publisherGeneration, publisherSourceRevision: state.previewEvidence.publisherSourceRevision,
      windowGeneration: state.previewEvidence.windowGeneration, windowSourceRevision: state.previewEvidence.windowSourceRevision }), () => ({ available: false }));
    console.log(JSON.stringify({ event: 'rich-inline-first-failure', kind: inline.kind, timing, operation: phase, fixedOracle: expectedKey,
      owner, current, native, finalFormal, preErrorCheckpoint: lastObservation, failures, browserErrors }));
    throw error;
  } finally {
    const resources = [];
    const cleanup = async (step, action) => { try { await action(); resources.push({ step, completed: true }); }
      catch { resources.push({ step, completed: false }); } };
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('rich-inline-page-listeners-remove', () => { page.off('pageerror', onPageError); page.off('popup', onPopup); page.off('dialog', onDialog); });
    if (receipts) { await cleanup('rich-inline-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('rich-inline-receipt-dispose', () => receipts.dispose()); }
    if (retainedNodes) await cleanup('rich-inline-retained-dispose', () => retainedNodes.dispose());
    await cleanup('rich-inline-surface-dispose', () => surface.dispose());
    const cleanupFailed = resources.some((value) => !value.completed);
    console.log(JSON.stringify({ event: 'rich-inline-cleanup', kind: inline.kind, timing, cleanupFailed, resources }));
    if (cleanupFailed && primaryError === null) throw new Error('rich-inline-cleanup-failed');
  }
});
}
}
}

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

const shortFenceRepresentatives = [
  { marker: '```', language: 'bash', position: 'start', pacing: 'normal' },
  { marker: '````', language: '', position: 'start', pacing: 'burst' },
  { marker: '````', language: 'python', position: 'middle', pacing: 'normal' },
  { marker: '```', language: 'javascript', position: 'middle', pacing: 'burst' },
  { marker: '```', language: '', position: 'end', pacing: 'normal' },
  { marker: '````', language: 'bash', position: 'end', pacing: 'burst' },
  { marker: '~~~', language: 'python', position: 'start', pacing: 'normal' },
  { marker: '~~~~', language: '', position: 'start', pacing: 'burst' },
  { marker: '~~~~', language: 'bash', position: 'middle', pacing: 'normal' },
  { marker: '~~~', language: 'javascript', position: 'middle', pacing: 'burst' },
  { marker: '~~~', language: '', position: 'end', pacing: 'normal' },
  { marker: '~~~~', language: 'python', position: 'end', pacing: 'burst' }
];

function shortFenceFixture(position) {
  if (position === 'start') return 'Slot\n\n# Heading\n\nAfter.\n\n- keep item';
  if (position === 'middle') return '# Heading\n\nSlot\n\nAfter.\n\n- keep item';
  return '# Heading\n\nBefore.\n\n- keep item\n\nSlot\n\n';
}

for (const fence of shortFenceRepresentatives) {
  test(`[short-stage] full ${fence.pacing} ${fence.position} fence ${fence.marker}${fence.language || '(no-language)'} lifecycle`, async ({ page }) => {
    const initial = shortFenceFixture(fence.position), opener = fence.marker + fence.language;
    const stage = await openShortStage(page, 'full', initial);
    const emptySlot = initial.replace('Slot', '');
    const literal = (text) => initial.replace('Slot', text.replace(/[`~]/gu, '\\$&'));
    // Full's existing shortcut contract canonicalises the visual fence family
    // to backticks. Source-owner cases below instead retain literal markers.
    const marker = '`'.repeat(fence.marker.length);
    const code = (body) => initial.replace('Slot', `${marker}${fence.language}\n${body}\n${marker}`);
    // At absolute start, the new fence's row domain and its following two-LF
    // separator occupy this fixed fixture slot. Preserve the following source
    // byte-for-byte; other positions retain their unverified existing oracle.
    const startSlot = 'Slot\n\n';
    if (fence.position === 'start') expect(initial.startsWith(startSlot)).toBe(true);
    const exited = fence.position === 'start'
      ? initial.slice(startSlot.length)
      : fence.position === 'end'
        ? initial.slice(0, initial.indexOf('Slot'))
        : initial.replace('Slot', '  ');
    const continued = initial.replace('Slot', 'Z');
    const continuedCaret = initial.indexOf('Slot') + 'Z'.length;
    const branched = initial.replace('Slot', 'ZB');
    const allowed = new Set([initial, emptySlot, exited, continued]);
    for (let end = 1; end <= opener.length; end += 1) allowed.add(literal(opener.slice(0, end)));
    for (const body of ['', 'a', 'ab', 'a\n', 'a\nx', 'a\nxy', 'a\nQ']) allowed.add(code(body));
    const probe = await startShortStageProbe(page, stage, allowed);
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'real-slot-selection', failed = true;
    let exitOwnership = null;
    const assertContinuedCaret = (point, owner) => {
      expect(owner.selection, `${point}: document caret must follow the fixed fixture Z, not a paragraph separator`).toEqual({
        start: continuedCaret, end: continuedCaret, direction: 'none'
      });
      if (point === 'after-final-Redo-before-B' && owner.fenceSnapshot?.pendingProof?.transferPending === true) {
        // The proven pre-B shape: the history transfer is still rendering over
        // the retained owned presentation, its canonical expectation names the
        // current revision and source, and the native presentation is exactly
        // the range that transfer recorded (collapsed or ranged). The retained
        // DOM is the old presentation, so the accepted Z Text is not required
        // until the transfer settles.
        const pendingProof = { ...owner.fenceSnapshot.pendingProof };
        delete pendingProof.presentationCurrent;
        expect(pendingProof, `${point}: pending history transfer must retain its own proved presentation and current canonical lease`).toEqual({
          transferPending: true,
          runtimeEditable: false,
          transferKind: 'history',
          transferPhase: 'rendering',
          expectationRevisionCurrent: true,
          expectationValueCurrent: true,
          retainedOwnedSameLedger: true,
          retainedOwnerSameToken: true,
          nativeMatchesLease: true
        });
        return;
      }
      expect(owner.fenceSnapshot.nativeState, `${point}: native caret must remain usable at the current Z paragraph Text1`).toEqual({
        paragraphCount: 1, paragraphConnected: true, surfaceConnected: true, editable: true,
        singleZText: true, collapsed: true, anchorIsCurrentZText: true, focusIsCurrentZText: true,
        anchorConnectedInside: true, focusConnectedInside: true, anchorOffset: 1, focusOffset: 1
      });
    };
    try {
      frames.stage(phase);
      await stage.visual.locator('p').filter({ hasText: /^Slot$/u }).click({ position: { x: 3, y: 3 } });
      await probe.press('Home'); await probe.press('Shift+End');
      phase = 'unfinished-opener-and-characterwise-clear'; frames.stage(phase);
      await probe.type(opener);
      if (fence.pacing === 'normal') await expectSource(stage.source, literal(opener));
      for (let key = 0; key < opener.length; key += 1) await probe.press('Backspace');
      await expectSource(stage.source, emptySlot);
      await expect(stage.visual.locator('pre')).toHaveCount(0);
      phase = 'Enter-immediate-body-delete-newline-replace'; frames.stage(phase);
      await probe.type(opener);
      if (fence.pacing === 'normal') await expectSource(stage.source, literal(opener));
      await probe.press('Enter'); await probe.type('ab');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('ab'));
      await probe.press('Backspace');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('a'));
      await probe.press('Enter'); await probe.type('xy');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('a\nxy'));
      await probe.press('Shift+ArrowLeft'); await probe.press('Shift+ArrowLeft');
      await probe.type('Q'); await expectSource(stage.source, code('a\nQ'));
      await expect.poll(() => stage.visual.locator('pre').evaluate((pre, language) => ({
        marker: pre.getAttribute('data-easymde-visual-fence'),
        language: pre.getAttribute('data-easymde-visual-fence-info'),
        body: pre.querySelector('code')?.textContent?.replace(/\n$/u, ''),
        languageClass: pre.querySelector('code')?.classList.contains(`language-${language}`)
      }), fence.language)).toMatchObject({ marker, language: fence.language, body: 'a\nQ', ...(fence.language ? { languageClass: true } : {}) });
      phase = 'clear-code-and-native-structure-exit'; frames.stage(phase);
      for (let key = 0; key < 3; key += 1) await probe.press('Shift+ArrowLeft');
      expect(await stage.visual.locator('pre code').evaluate((element) => {
        const native = getSelection();
        return !!native && element.contains(native.anchorNode) && element.contains(native.focusNode)
          && native.toString() === 'a\nQ';
      })).toBe(true);
      await probe.press('Backspace'); await expectSource(stage.source, code(''));
      if (fence.position === 'start' || fence.position === 'end') {
        exitOwnership = await stage.visual.evaluateHandle((surface) => {
          const pres = surface.querySelectorAll('pre');
          if (pres.length !== 1) throw new Error('short-stage-exit-pre-not-unique');
          const pre = pres[0]; let frame = pre;
          while (frame.parentNode && frame.parentNode !== surface) frame = frame.parentNode;
          if (frame.parentNode !== surface) throw new Error('short-stage-exit-frame-not-direct');
          const children = Array.from(surface.childNodes);
          const frameIndex = children.indexOf(frame);
          return { surface, pre, frame,
            prefix: children.slice(0, frameIndex),
            following: children.slice(frameIndex + 1),
            paragraphs: new Set(surface.querySelectorAll(':scope > p')), paragraph: null };
        });
      }
      await probe.press('Backspace'); await expectSource(stage.source, exited);
      if (exitOwnership) {
        const exitedState = await exitOwnership.evaluate((owned) => {
          const { surface } = owned, children = Array.from(surface.childNodes);
          const added = [...surface.querySelectorAll(':scope > p')].filter((p) => !owned.paragraphs.has(p));
          owned.paragraph = added.length === 1 ? added[0] : null;
          const p = owned.paragraph, native = surface.ownerDocument.getSelection();
          const prefixIndexes = owned.prefix.map((node) => children.indexOf(node));
          const indexes = owned.following.map((node) => children.indexOf(node));
          return { preRemoved: !surface.contains(owned.pre), frameRemoved: !surface.contains(owned.frame),
            preCount: surface.querySelectorAll('pre').length, newParagraphCount: added.length,
            soleBR: !!p && p.childNodes.length === 1 && p.firstChild instanceof HTMLBRElement,
            nativeP0: !!p && native?.isCollapsed === true && native.anchorNode === p && native.focusNode === p
              && native.anchorOffset === 0 && native.focusOffset === 0,
            editable: surface.isConnected && surface.isContentEditable,
            lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
            prefixIntact: owned.prefix.every((node, at) => node.isConnected && node.parentNode === surface
              && prefixIndexes[at] === at),
            followingIntact: owned.following.every((node) => node.isConnected && node.parentNode === surface)
              && indexes.every((index, at) => index >= 0 && (at === 0 || index > indexes[at - 1])),
            followingTailIntact: owned.following.length > 0
              ? children.at(-1) === owned.following.at(-1)
              : children.at(-1) === p };
        });
        expect(exitedState).toEqual({ preRemoved: true, frameRemoved: true, preCount: 0, newParagraphCount: 1,
          soleBR: true, nativeP0: true, editable: true, lock: 'false', prefixIntact: true,
          followingIntact: true, followingTailIntact: true });
      }
      await probe.type('Z'); await expectSource(stage.source, continued);
      const continuedSnapshot = await readCurrentDocumentOwner(page, null, { ownership: exitOwnership });
      assertContinuedCaret('after-Z', continuedSnapshot);
      if (exitOwnership) {
        const continuedState = continuedSnapshot.fenceSnapshot.continuedState;
        expect(continuedState).toEqual({ sameParagraph: true, independentZParagraph: true, nativeTextEnd: true,
          followingIntact: true, followingTailIntact: true });
      }
      await expect(stage.visual.locator('pre')).toHaveCount(0);
      const observation = await probe.snapshot();
      const history = shortStageHistoryLedger(observation.rows, initial, allowed);
      await probe.freeze();
      phase = 'natural-group-Undo-Redo-and-continued-editing'; frames.stage(phase);
      await shortStageReplayHistory(page, stage, probe, history, 'undo', history.baseline);
      await expectSource(stage.source, initial);
      await shortStageReplayHistory(page, stage, probe, history, 'redo', history.latest);
      await expectSource(stage.source, continued);
      // Continue directly at the native caret returned by the final history
      // group; do not click, focus or replace its selection from JavaScript.
      const caret = await readCurrentDocumentOwner(page, null, { ownership: exitOwnership, pendingProof: true });
      assertContinuedCaret('after-final-Redo-before-B', caret);
      await probe.type('B'); await expectSource(stage.source, branched);
      const committed = await readCurrentDocumentOwner(page, null,
        { ownership: exitOwnership, pendingProof: true, nativeBranch: true });
      expect(committed.selection, 'after-B-source-commit: canonical caret must follow the committed ZB').toEqual({
        start: continuedCaret + 1, end: continuedCaret + 1, direction: 'none'
      });
      const branchEndForm = (branch, side) => {
        if (!branch || branch.singleZBText !== true || branch.collapsed !== true) return null;
        if (branch[`${side}IsCurrentZBText`] === true && branch[`${side}Offset`] === 2) return 'text';
        if (branch[`${side}IsCurrentZBParagraph`] === true && branch[`${side}Offset`] === 1) return 'element';
        return null;
      };
      await expect.poll(async () => {
        const settling = await readCurrentDocumentOwner(page, null,
          { ownership: exitOwnership, pendingProof: true, nativeBranch: true });
        const branch = settling.fenceSnapshot.branchState;
        return settling.selection.start === continuedCaret + 1
          && settling.selection.end === continuedCaret + 1
          && settling.selection.direction === 'none'
          && branch.paragraphCount === 1 && branch.paragraphConnected === true
          && branch.paragraphDirect === true && branch.paragraphEditable === true
          && branch.surfaceConnected === true && branch.editable === true
          && branch.anchorConnectedInside === true && branch.focusConnectedInside === true
          && branchEndForm(branch, 'anchor') !== null
          && branchEndForm(branch, 'focus') !== null
          && settling.fenceSnapshot.pendingProof?.transferPending === false
          && settling.fenceSnapshot.pendingProof?.presentationCurrent === true;
      }, { message: 'B must commit and naturally settle into the current accepted ZB Text2', timeout: 15000 }).toBe(true);
      const accepted = await readCurrentDocumentOwner(page, null,
        { ownership: exitOwnership, pendingProof: true, nativeBranch: true });
      expect(accepted.selection, 'after-B-accepted: canonical caret must remain on the accepted ZB').toEqual({
        start: continuedCaret + 1, end: continuedCaret + 1, direction: 'none'
      });
      expect(accepted.fenceSnapshot.pendingProof?.transferPending,
        'after-B-accepted: the accepted read must not carry a pending transfer').toBe(false);
      expect(accepted.fenceSnapshot.pendingProof?.presentationCurrent,
        'after-B-accepted: the accepted presentation must be the current source').toBe(true);
      const acceptedBranch = accepted.fenceSnapshot.branchState;
      expect(acceptedBranch, `after-B-accepted: raw native/branch snapshot ${JSON.stringify(acceptedBranch)}`).toMatchObject({
        paragraphCount: 1, paragraphConnected: true, paragraphDirect: true, paragraphEditable: true,
        surfaceConnected: true, editable: true, singleZBText: true, collapsed: true,
        anchorConnectedInside: true, focusConnectedInside: true
      });
      expect(branchEndForm(acceptedBranch, 'anchor'),
        `after-B-accepted anchor: ${JSON.stringify(acceptedBranch)}`).not.toBeNull();
      expect(branchEndForm(acceptedBranch, 'focus'),
        `after-B-accepted focus: ${JSON.stringify(acceptedBranch)}`).not.toBeNull();
      await probe.press('Control+z'); await expectSource(stage.source, continued);
      await shortStageReplayHistory(page, stage, probe, history, 'undo', history.baseline);
      await expectSource(stage.source, initial);
      await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      console.log(JSON.stringify({ phase: 'short-stage-fence-complete', position: fence.position,
        pacing: fence.pacing, family: fence.marker[0] === '~' ? 'tilde' : 'backtick', markerLength: fence.marker.length,
        language: fence.language, naturalHistoryGroups: history.ledger.size - 1, sourceExact: true, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-fence-first-failure', operation: phase,
        position: fence.position, pacing: fence.pacing, markerLength: fence.marker.length,
        owner: await readCurrentDocumentOwner(page), failures: stage.failures,
        firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      try { await exitOwnership?.dispose(); } finally {
        await finishShortStageObservation(probe, frames,
          `short-fence-${fence.marker[0] === '~' ? 'tilde' : 'backtick'}-${fence.position}-${fence.pacing}`, failed);
      }
    }
  });
}

for (const sourceCase of [
  { mode: 'ordinary', marker: '````', language: 'bash' },
  { mode: 'ordinary', marker: '~~~', language: 'python' },
  { mode: 'split', marker: '```', language: 'javascript' },
  { mode: 'split', marker: '~~~~', language: '' }
]) {
  test(`[short-stage] ${sourceCase.mode} literal fence ${sourceCase.marker}${sourceCase.language || '(no-language)'} preserves syntax and natural history`, async ({ page }) => {
    const { mode, marker, language } = sourceCase;
    const initial = `  ${marker}${language}  \n  value = 1  \n  ${marker}\n\nAfter.\n\n- keep item\n`;
    const stage = await openShortStage(page, mode, initial);
    const point = initial.indexOf('value = 1');
    const typed = initial.slice(0, point) + 'X' + initial.slice(point);
    const closing = initial.indexOf(`  ${marker}`, initial.indexOf('\n') + 1) + 2;
    const shorterMarker = initial.slice(0, closing) + initial.slice(closing + 1);
    const newline = initial + '\n', unicode = newline + '中🙂';
    const allowed = new Set([initial, typed, shorterMarker, newline, newline + '中', unicode]);
    const probe = await startShortStageProbe(page, stage, allowed);
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'literal-fence-body-position', failed = true;
    try {
      frames.stage(phase);
      await stage.surface.click(); await probe.press('Control+Home');
      await probe.press('ArrowDown'); await probe.press('Home');
      const beforeX = await readCurrentDocumentOwner(page);
      expect(beforeX.selection, 'X: real keyboard caret must be the fixed body point').toEqual({
        start: point, end: point, direction: 'none'
      });
      await probe.type('X'); await expectSource(stage.source, typed);
      await probe.press('Backspace'); await expectSource(stage.source, initial);
      phase = 'literal-closing-marker-delete-and-retype'; frames.stage(phase);
      await probe.press('Control+Home'); await probe.press('ArrowDown'); await probe.press('ArrowDown');
      await probe.press('Home');
      const beforeClosingDelete = await readCurrentDocumentOwner(page);
      expect(beforeClosingDelete.selection,
        'closing marker: real keyboard caret must be the fixed marker start').toEqual({
        start: closing, end: closing, direction: 'none'
      });
      await probe.press('Delete'); await expectSource(stage.source, shorterMarker);
      await probe.type(marker[0]); await expectSource(stage.source, initial);
      phase = 'source-newline-Unicode-and-delete'; frames.stage(phase);
      await probe.press('Control+End'); await probe.press('Enter');
      await probe.type('中🙂'); await expectSource(stage.source, unicode);
      await probe.press('Backspace'); await expectSource(stage.source, newline + '中');
      await probe.press('Backspace'); await expectSource(stage.source, newline);
      const observation = await probe.snapshot();
      const history = shortStageHistoryLedger(observation.rows, initial, allowed);
      await probe.freeze();
      phase = 'source-natural-group-Undo-Redo'; frames.stage(phase);
      const sourceHistory = { mode: 'source', expectedRedo: [] };
      await shortStageReplayHistory(page, stage, probe, history, 'undo', history.baseline, null, sourceHistory);
      await expectSource(stage.source, initial);
      await shortStageReplayHistory(page, stage, probe, history, 'redo', null, null, sourceHistory);
      await expectSource(stage.source, newline);
      await probe.type('Q'); await expectSource(stage.source, newline + 'Q');
      await probe.press('Control+z'); await expectSource(stage.source, newline);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      console.log(JSON.stringify({ phase: 'short-stage-literal-fence-complete', mode,
        family: marker[0] === '~' ? 'tilde' : 'backtick', markerLength: marker.length, language,
        literalSyntaxExact: true, sourceOwnerOnly: true, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-literal-fence-first-failure', mode, operation: phase,
        owner: await readCurrentDocumentOwner(page), failures: stage.failures,
        firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      await finishShortStageObservation(probe, frames, `short-source-${mode}-${marker[0] === '~' ? 'tilde' : 'backtick'}`, failed);
    }
  });
}

test('[short-stage] full reverse P-H2-P mouse range keeps unselected ends and natural history', async ({ page }) => {
  const initial = 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.';
  const replaced = 'Before.\n\nalphaMzeta\n\nAfter.';
  const continued = 'Before.\n\nalphaMQzeta\n\nAfter.';
  const stage = await openShortStage(page, 'full', initial);
  const allowed = new Set([initial, replaced, continued]);
  const probe = await startShortStageProbe(page, stage, allowed);
  const frames = await startShortStageFrames(page, stage.surface);
  let phase = 'real-reverse-cross-block-drag', failed = true;
  try {
    frames.stage(phase);
    const point = (row, offset) => row.evaluate((paragraph, at) => {
      const text = paragraph.firstChild;
      if (!(text instanceof Text) || at >= text.length) throw new Error('short-stage-cross-block-point-unavailable');
      const range = paragraph.ownerDocument.createRange();
      range.setStart(text, at); range.setEnd(text, at + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 1, y: rect.y + rect.height / 2 };
    }, offset);
    const from = await point(stage.visual.locator('p').nth(2), 1);
    const to = await point(stage.visual.locator('p').nth(1), 5);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    probe.guard();
    const native = await stage.visual.evaluate((surface) => {
      const selection = getSelection(), paragraphs = surface.querySelectorAll('p');
      const offset = (paragraph, node, end) => {
        if (!node || !paragraph.contains(node)) return null;
        const prefix = paragraph.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph); prefix.setEnd(node, end);
        return prefix.toString().length;
      };
      const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
      return { backward: !!range && !selection.isCollapsed && range.endContainer === selection.anchorNode
        && range.endOffset === selection.anchorOffset,
        anchorOffset: offset(paragraphs[2], selection?.anchorNode, selection?.anchorOffset),
        focusOffset: offset(paragraphs[1], selection?.focusNode, selection?.focusOffset) };
    });
    expect(native).toEqual({ backward: true, anchorOffset: 1, focusOffset: 5 });
    phase = 'cross-block-replace-and-immediate-continue'; frames.stage(phase);
    await probe.type('M'); await expectSource(stage.source, replaced);
    await probe.type('Q'); await expectSource(stage.source, continued);
    const observation = await probe.snapshot();
    const history = shortStageHistoryLedger(observation.rows, initial, allowed);
    await probe.freeze();
    phase = 'cross-block-natural-Undo-Redo'; frames.stage(phase);
    await shortStageReplayHistory(page, stage, probe, history, 'undo', history.baseline);
    await expectSource(stage.source, initial);
    await shortStageReplayHistory(page, stage, probe, history, 'redo', history.latest);
    await expectSource(stage.source, continued);
    await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    probe.guard();
    console.log(JSON.stringify({ phase: 'short-stage-backward-cross-block-complete', native,
      sourceExact: true, owner: await readCurrentDocumentOwner(page) }));
    failed = false;
  } catch (error) {
    console.log(JSON.stringify({ phase: 'short-stage-backward-cross-block-first-failure', operation: phase,
      owner: await readCurrentDocumentOwner(page), firstObservation: (await probe.snapshot()).failure }));
    throw error;
  } finally {
    await finishShortStageObservation(probe, frames, 'short-backward-cross-block', failed);
  }
});

test('[short-stage-background] dirty article survives focus loss and natural autosave', async ({ page }) => {
  test.setTimeout(780_000);
  const initial = '# 背景\n\nAlpha 开始。\n\nBeta 结束。';
  const afterForeground = initial + '甲A';
  const afterReturn = afterForeground + '乙B';
  const afterDelete = afterForeground + '乙';
  const caseDeadline = Date.now() + 720_000;
  const boundedTimeout = (desired) => {
    const remaining = caseDeadline - Date.now();
    if (remaining <= 0) throw new Error('background-case-budget-exhausted');
    return Math.min(desired, remaining);
  };
  const coverage = {
    foregroundCycle: false, backgroundCycle: false, returnCycle: false,
    returnFocus: false, focusLost: false, autosaveSuccess: false,
    postChanged: null, sessionReady: false, intervals: null,
    localDraft: { applicable: null, intervalSeconds: null, saved: null,
      updatedAtAdvanced: false, contentMatchesCurrent: false }
  };
  const healthFailures = [];
  const onPopup = () => healthFailures.push('background-popup');
  page.on('popup', onPopup);
  let second = null;
  let stage = null;
  let stageProbe = null;
  let frames = null;
  let finalProbe = null;
  let primaryError = null;
  const disableFocusOverride = async (targetPage) => {
    const cdp = await targetPage.context().newCDPSession(targetPage);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    return cdp;
  };
  const focusOverrideSessions = [];
  const detachFocusOverrides = async () => {
    const failures = [];
    for (const cdp of focusOverrideSessions.splice(0)) {
      try { await cdp.detach(); }
      catch { failures.push('focus-override-detach'); }
    }
    if (failures.length) throw new Error(failures.join(','));
  };
  const readProbe = () => page.evaluate(() => window.__easymdeBackgroundProbe.read());
  const throwUncovered = (codes) => {
    throw new Error(`background-stage-uncovered:${[...new Set(codes)].join(',')}`);
  };
  const reportSafeCoverage = () => {
    const safe = { ...coverage };
    if (finalProbe) {
      safe.sendCount = finalProbe.send.length;
      safe.tickCount = finalProbe.tick.length;
      safe.autosaveCount = finalProbe.autosave.length;
    }
    console.log(JSON.stringify({
      phase: 'short-stage-background-coverage-finally',
      coverage: safe
    }));
  };
  try {
    await page.bringToFront();
    focusOverrideSessions.push(await disableFocusOverride(page));
    stage = await openShortStage(page, 'full', initial, () => installBackgroundProbe(page));
    frames = await startShortStageFrames(page, stage.surface, { retainStages: true });
    stageProbe = await startShortStageProbe(page, stage,
      [initial, initial + '甲', afterForeground, afterReturn, afterDelete], { backgroundObservation: true, frames });
    let localDraftUpdatedAtBaseline = null;
    const waitUntil = async (predicate, { message, timeout }) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await predicate()) return true;
        await page.waitForTimeout(Math.max(1, Math.min(250, deadline - Date.now())));
      }
      console.log(JSON.stringify({ phase: 'short-stage-background-wait-timeout', message }));
      return false;
    };
    const guard = async ({ focused = true } = {}) => {
      stageProbe.guard();
      if (healthFailures.length) throw new Error(`background-health:${healthFailures[0]}`);
      if (stage.failures.length) throw new Error(`background-stage-failure:${stage.failures[0]}`);
      const state = await readProbe();
      if (state.sessionStatus !== 'ready') {
        throw new Error(`background-session:${state.sessionStatus}`);
      }
      if (state.heartbeat.connectionError === true) {
        throw new Error('background-heartbeat-connection-error');
      }
      if (focused
        && (state.documentHasFocus !== true || state.heartbeat.coreHasFocus !== true)) {
        throw new Error('background-unexpected-focus-loss');
      }
      if (!focused
        && (state.documentHasFocus !== false || state.heartbeat.coreHasFocus !== false)) {
        throw new Error('background-expected-focus-loss-not-observed');
      }
      if (state.surfaceEditable !== true || state.lockPressed !== 'false') {
        throw new Error('background-unexpected-readonly-or-lock');
      }
      return state;
    };
    const installed = await guard();
    coverage.intervals = installed.intervals;
    coverage.localDraft = {
      applicable: installed.localDraft.applicable,
      intervalSeconds: installed.localDraft.intervalSeconds,
      saved: installed.localDraft.applicable ? false : null,
      updatedAtAdvanced: false,
      contentMatchesCurrent: false
    };
    localDraftUpdatedAtBaseline = installed.localDraft.storage?.updatedAt ?? null;
    const waitForCycle = async (phase, focused) => {
      const start = await guard({ focused });
      const interval = Math.max(Number(start.heartbeat.interval) || 0,
        Number(start.heartbeat.minimalInterval) || 0,
        focused ? 0 : 120);
      if (!(interval > 0)) return false;
      const baselineSendOrdinal = start.send.at(-1)?.ordinal ?? 0;
      const baselineTickOrdinal = start.tick.at(-1)?.ordinal ?? 0;
      const timeout = boundedTimeout(interval * 1000 * 2 + 20_000);
      await stageProbe.beginQuiet(`${phase}-heartbeat`);
      const observed = await waitUntil(async () => {
        await guard({ focused });
        const current = await readProbe();
        return current.tick.some((entry) => entry.ordinal > baselineTickOrdinal
          && entry.durationMs !== null
          && entry.sendOrdinal !== null
          && entry.sendOrdinal > baselineSendOrdinal
          && entry.sendDocumentHasFocus === focused
          && entry.sendCoreHasFocus === focused);
      }, { message: `${phase} natural heartbeat send→tick`, timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    const waitForAutosave = async () => {
      const start = await guard();
      const autosaveSeconds = Number(start.intervals.autosave);
      const heartbeatSeconds = Math.max(Number(start.heartbeat.interval) || 0,
        Number(start.heartbeat.minimalInterval) || 0);
      if (!(autosaveSeconds > 0) || !(heartbeatSeconds > 0)) return false;
      const timeout = boundedTimeout(
        (Math.max(autosaveSeconds, heartbeatSeconds) + heartbeatSeconds) * 1000 + 20_000);
      await stageProbe.beginQuiet('natural-autosave');
      const observed = await waitUntil(async () => {
        await guard();
        const current = await readProbe();
        return current.autosave.some((entry) => {
          if (entry.success !== true || entry.attemptOrdinal === null) return false;
          const attempt = current.autosaveAttempts.find(
            (candidate) => candidate.ordinal === entry.attemptOrdinal);
          return attempt?.postChanged === true
            && (attempt.contentMatchesCurrent === true || attempt.at >= dirtyAt);
        });
      }, { message: 'natural Core autosave success after post-dirty attempt', timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    const waitForLocalDraft = async () => {
      if (!coverage.localDraft.applicable) return true;
      const draftSeconds = Number(coverage.localDraft.intervalSeconds);
      if (!(draftSeconds > 0)) return false;
      const timeout = boundedTimeout(draftSeconds * 1000 + 20_000);
      await stageProbe.beginQuiet('local-draft-debounce');
      const observed = await waitUntil(async () => {
        await guard();
        const current = await readProbe();
        const storage = current.localDraft.storage;
        const advanced = storage?.present === true && storage.updatedAt !== null
          && (localDraftUpdatedAtBaseline === null
            || storage.updatedAt > localDraftUpdatedAtBaseline);
        coverage.localDraft.updatedAtAdvanced = advanced;
        coverage.localDraft.contentMatchesCurrent = storage?.contentMatchesCurrent === true;
        return advanced && coverage.localDraft.contentMatchesCurrent;
      }, { message: 'local draft debounce completion evidence', timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    await guard();
    await stage.visual.locator('p').last().click();
    await stageProbe.press('End');
    await guard();
    await stageProbe.type('甲A');
    await guard();
    await expectSource(stage.source, afterForeground);
    const dirtyProbe = await readProbe();
    coverage.postChanged = dirtyProbe.postChanged;
    const dirtyAt = await page.evaluate(() => performance.now());
    if (coverage.localDraft.applicable) {
      coverage.localDraft.saved = await waitForLocalDraft();
    }
    coverage.foregroundCycle = await waitForCycle('foreground', true);
    coverage.autosaveSuccess = await waitForAutosave();
    await guard();
    const blurBaseline = (await readProbe()).focus.filter(
      (entry) => entry.type === 'blur').at(-1)?.ordinal ?? 0;
    await stageProbe.beginQuiet('focus-out');
    second = await page.context().newPage();
    focusOverrideSessions.push(await disableFocusOverride(second));
    await second.goto('about:blank');
    await second.bringToFront();
    coverage.focusLost = await waitUntil(async () => {
      const current = await readProbe();
      return current.documentHasFocus === false
        && current.heartbeat.coreHasFocus === false
        && current.focus.some((entry) => entry.type === 'blur'
          && entry.ordinal > blurBaseline);
    }, { message: 'first page must lose real focus', timeout: boundedTimeout(15_000) });
    await stageProbe.endQuiet();
    if (!coverage.focusLost) throwUncovered(['focus-loss']);
    coverage.backgroundCycle = await waitForCycle('background', false);
    if (!coverage.backgroundCycle) throwUncovered(['background-heartbeat']);
    const focusBaseline = (await readProbe()).focus.filter(
      (entry) => entry.type === 'focus').at(-1)?.ordinal ?? 0;
    await stageProbe.beginQuiet('focus-return');
    await page.bringToFront();
    coverage.returnFocus = await waitUntil(async () => {
      const current = await readProbe();
      return current.documentHasFocus === true
        && current.heartbeat.coreHasFocus === true
        && current.focus.some((entry) => entry.type === 'focus'
          && entry.ordinal > focusBaseline);
    }, { message: 'first page must regain real focus', timeout: boundedTimeout(15_000) });
    await stageProbe.endQuiet();
    if (!coverage.returnFocus) throwUncovered(['return-focus']);
    coverage.returnCycle = await waitForCycle('return', true);
    if (!coverage.returnCycle) throwUncovered(['return-heartbeat']);
    const inputUnmet = [];
    if (coverage.postChanged !== true) inputUnmet.push('pre-save-dirty');
    if (!coverage.foregroundCycle) inputUnmet.push('foreground-heartbeat');
    if (coverage.localDraft.applicable === true && coverage.localDraft.saved !== true) {
      inputUnmet.push('local-draft-save');
    }
    if (!coverage.autosaveSuccess) inputUnmet.push('autosave-success');
    if (inputUnmet.length) throwUncovered(inputUnmet);
    await guard();
    frames.stage('post-cycle-native-editing');
    await stageProbe.resumeEditing();
    await stageProbe.type('乙B');
    await guard();
    await expectSource(stage.source, afterReturn);
    await guard();
    await stageProbe.press('Backspace');
    await guard();
    await expectSource(stage.source, afterDelete);
    await guard();
    await stageProbe.press('Control+z');
    await guard();
    await expectSource(stage.source, afterReturn);
    await guard();
    await stageProbe.press('Control+Shift+z');
    await guard();
    await expectSource(stage.source, afterDelete);
    expect(stage.failures).toEqual([]);
    finalProbe = await readProbe();
    coverage.sessionReady = finalProbe.sessionStatus === 'ready';
    const unmet = [];
    if (coverage.postChanged !== true) unmet.push('pre-save-dirty');
    if (!coverage.foregroundCycle) unmet.push('foreground-heartbeat');
    if (!coverage.focusLost) unmet.push('focus-loss');
    if (!coverage.backgroundCycle) unmet.push('background-heartbeat');
    if (!coverage.returnFocus) unmet.push('return-focus');
    if (!coverage.returnCycle) unmet.push('return-heartbeat');
    if (!coverage.autosaveSuccess) unmet.push('autosave-success');
    if (!coverage.sessionReady) unmet.push('session-ready');
    if (coverage.localDraft.applicable === true && coverage.localDraft.saved !== true) {
      unmet.push('local-draft-save');
    }
    if (unmet.length) throwUncovered(unmet);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    try { reportSafeCoverage(); } catch { cleanupFailures.push('coverage-report'); }
    try { page.off('popup', onPopup); } catch { cleanupFailures.push('popup-listener-off'); }
    try { await stageProbe?.stop(); } catch { cleanupFailures.push('stage-probe-stop'); }
    try { await frames?.stop('background-complete-observation'); } catch { cleanupFailures.push('compositor-stop'); }
    try { await page.evaluate(() => window.__easymdeBackgroundProbe?.cleanup()); }
    catch { cleanupFailures.push('background-probe-cleanup'); }
    try { await detachFocusOverrides(); }
    catch { cleanupFailures.push('focus-override-detach'); }
    if (second) {
      try { await second.close(); } catch { cleanupFailures.push('second-page-close'); }
    }
    if (cleanupFailures.length) {
      console.log(JSON.stringify({
        phase: 'short-stage-background-cleanup-failure',
        failures: cleanupFailures
      }));
      if (!primaryError) {
        throw new Error(`background-cleanup-failed:${cleanupFailures.join(',')}`);
      }
    }
  }
});

test('[short-stage-lock] active Preview lock survives natural cycles and resumes editing', async ({ page }) => {
  test.setTimeout(540_000);
  const initial = '# 锁\n\nAlpha 开始。\n\nBeta 结束。';
  const typed = initial + 'V';
  const resumed = typed + 'X';
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  const caseDeadline = Date.now() + 480_000;
  const boundedTimeout = (desired) => {
    const remaining = caseDeadline - Date.now();
    if (remaining <= 0) throw new Error('lock-case-budget-exhausted');
    return Math.min(desired, remaining);
  };
  let stage = null;
  let stageProbe = null, frames = null;
  let primaryError = null;
  const readProbe = () => page.evaluate(() => window.__easymdeBackgroundProbe.read());
  const waitUntil = async (predicate, { message, timeout }) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await page.waitForTimeout(Math.max(1, Math.min(250, deadline - Date.now())));
    }
    console.log(JSON.stringify({ phase: 'short-stage-lock-wait-timeout', message }));
    return false;
  };
  const guard = async ({ locked = false } = {}) => {
    stageProbe?.guard();
    if (stage.failures.length) throw new Error(`lock-stage-failure:${stage.failures[0]}`);
    const state = await readProbe();
    if (state.visibilityState !== 'visible') {
      throw new Error(`lock-stage-visibility:${state.visibilityState}`);
    }
    if (state.sessionStatus !== 'ready') {
      throw new Error(`lock-stage-session:${state.sessionStatus}`);
    }
    if (state.heartbeat.connectionError === true) {
      throw new Error('lock-stage-heartbeat-connection-error');
    }
    if (state.lockPressed !== (locked ? 'true' : 'false')) {
      throw new Error(`lock-stage-lock:${state.lockPressed}`);
    }
    if (locked ? state.surfaceEditable !== false : state.surfaceEditable !== true) {
      throw new Error(locked ? 'lock-stage-unexpected-editable' : 'lock-stage-unexpected-readonly');
    }
    return state;
  };
  const waitForCycle = async (label, locked) => {
    const start = await guard({ locked });
    const interval = Math.max(Number(start.heartbeat.interval) || 0,
      Number(start.heartbeat.minimalInterval) || 0);
    if (!(interval > 0)) throw new Error(`lock-stage-uncovered:${label}-interval`);
    const baselineSendOrdinal = start.send.at(-1)?.ordinal ?? 0;
    const baselineTickOrdinal = start.tick.at(-1)?.ordinal ?? 0;
    const timeout = boundedTimeout(interval * 1000 * 2 + 20_000);
    await stageProbe.beginQuiet(`${label}-heartbeat`);
    const covered = await waitUntil(async () => {
      await guard({ locked });
      const current = await readProbe();
      return current.tick.some((entry) => entry.ordinal > baselineTickOrdinal
        && entry.durationMs !== null
        && entry.sendOrdinal !== null
        && entry.sendOrdinal > baselineSendOrdinal
        && entry.sendVisibility === 'visible');
    }, { message: `${label} natural heartbeat`, timeout });
    await stageProbe.endQuiet();
    if (!covered) throw new Error(`lock-stage-uncovered:${label}-heartbeat`);
  };
  const waitForAutosave = async (dirtyAt) => {
    const start = await guard();
    const autosaveSeconds = Number(start.intervals.autosave);
    const heartbeatSeconds = Math.max(Number(start.heartbeat.interval) || 0,
      Number(start.heartbeat.minimalInterval) || 0);
    if (!(autosaveSeconds > 0) || !(heartbeatSeconds > 0)) {
      throw new Error('lock-stage-uncovered:pre-lock-autosave-interval');
    }
    const timeout = boundedTimeout(
      (Math.max(autosaveSeconds, heartbeatSeconds) + heartbeatSeconds) * 1000 + 20_000);
    await stageProbe.beginQuiet('pre-lock-autosave');
    const covered = await waitUntil(async () => {
      await guard();
      const current = await readProbe();
      return current.autosave.some((entry) => {
        if (entry.success !== true || entry.attemptOrdinal === null) return false;
        const attempt = current.autosaveAttempts.find(
          (candidate) => candidate.ordinal === entry.attemptOrdinal);
        return attempt?.postChanged === true
          && (attempt.contentMatchesCurrent === true || attempt.at >= dirtyAt);
      });
    }, { message: 'pre-lock natural autosave', timeout });
    await stageProbe.endQuiet();
    if (!covered) throw new Error('lock-stage-uncovered:pre-lock-autosave');
  };
  try {
    await page.bringToFront();
    stage = await openShortStage(page, 'full', initial, () => installBackgroundProbe(page));
    frames = await startShortStageFrames(page, stage.surface, { retainStages: true });
    stageProbe = await startShortStageProbe(page, stage, [initial, typed, resumed],
      { backgroundObservation: true, allowLocked: true, frames });
    await guard();
    await sink.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type('V');
    await guard();
    await expectSource(stage.source, typed);
    const dirtyAt = await page.evaluate(() => performance.now());
    await waitForAutosave(dirtyAt);
    await waitForCycle('pre-lock', false);
    await expectSource(stage.source, typed);
    const beforeLock = await readCurrentDocumentOwner(page);
    await guard();
    await stageProbe.beginQuiet('user-lock-toggle');
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const lockedSink = await sink.evaluate((surface) => ({
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable')
    }));
    expect(lockedSink.effectiveEditable, 'locked sink must be effectively read-only').toBe(false);
    expect(lockedSink.contenteditable).not.toBe('true');
    await guard({ locked: true });
    await sink.locator('p').last().click();
    await guard({ locked: true });
    await stageProbe.endQuiet();
    await waitForCycle('locked', true);
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const afterCycleSink = await sink.evaluate((surface) => ({
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable')
    }));
    expect(afterCycleSink.effectiveEditable, 'lock must survive a natural cycle').toBe(false);
    const afterCycle = await readCurrentDocumentOwner(page);
    expect(afterCycle.revision, 'natural cycle must not change revision while locked').toBe(beforeLock.revision);
    expect(afterCycle.history, 'natural cycle must not change history while locked').toEqual(beforeLock.history);
    await expectSource(stage.source, typed);
    await stageProbe.beginQuiet('locked-negative-inputs');
    for (const key of ['Q', 'Backspace', 'Enter']) {
      await guard({ locked: true });
      if (key === 'Q') await page.keyboard.type('Q');
      else await page.keyboard.press(key);
      await expectSource(stage.source, typed);
      const lockedOwner = await readCurrentDocumentOwner(page);
      expect(lockedOwner.revision, `${key}: locked revision must not change`).toBe(beforeLock.revision);
      expect(lockedOwner.history, `${key}: locked history must not change`).toEqual(beforeLock.history);
      await guard({ locked: true });
    }
    await stageProbe.endQuiet();
    expect(stage.failures).toEqual([]);
    await guard({ locked: true });
    await stageProbe.beginQuiet('user-unlock-toggle');
    await lock.click();
    await expect(sink).toHaveAttribute('contenteditable', 'true');
    await guard();
    await stageProbe.endQuiet();
    frames.stage('resumed-native-editing');
    await stageProbe.resumeEditing();
    await page.keyboard.type('X');
    await expectSource(stage.source, resumed);
    await guard();
    await page.keyboard.press('Control+z');
    await guard();
    await expectSource(stage.source, typed);
    await guard();
    await page.keyboard.press('Control+Shift+z');
    await guard();
    await expectSource(stage.source, resumed);
    await guard();
    expect(stage.failures).toEqual([]);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    try { await stageProbe?.stop(); } catch { cleanupFailures.push('stage-probe-stop'); }
    try { await frames?.stop('lock-complete-observation'); } catch { cleanupFailures.push('compositor-stop'); }
    try { await page.evaluate(() => window.__easymdeBackgroundProbe?.cleanup()); }
    catch { cleanupFailures.push('background-probe-cleanup'); }
    if (cleanupFailures.length) {
      console.log(JSON.stringify({
        phase: 'short-stage-lock-cleanup-failure',
        failures: cleanupFailures
      }));
      if (!primaryError) {
        throw new Error(`lock-cleanup-failed:${cleanupFailures.join(',')}`);
      }
    }
  }
});
