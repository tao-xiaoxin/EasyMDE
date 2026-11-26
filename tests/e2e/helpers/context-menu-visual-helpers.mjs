import { expect } from '@playwright/test';
import {
  anyMenuItem,
  assertSourceExactValue,
  assertSourceFixtureExact,
  closeMenu,
  contextMenuDiagnosticKey,
  expandOpenTableMenuViewport,
  expectMenuItemState,
  getImmersiveStrings,
  imageScaleSource,
  imageSourceAlt,
  menuSelector,
  occurrenceOffset,
  openRootSubmenu,
  openSourceMenu,
  openSourceMenuWithDiagnostics,
  openVisibleSubmenu,
  placeSourceCaret,
  privacySafeFailureCode,
  readContextMenuDiagnostics,
  replaceVisualSourceOccurrence,
  rootItem,
  rootMenu,
  selectSourceText,
  startContextMenuDiagnostics,
  stopContextMenuDiagnostics,
  visualHistoryDiagnosticKey,
  waitForSourceExactValue
} from './context-menu-helpers.mjs';

async function recordVisualInteractionDiagnostic(page, phase, target, point = null) {
  const targetMetadata = await readVisualTargetMetadata(target);
  const selection = await page.evaluate(() => {
    const current = globalThis.getSelection?.();
    const canvas = document.querySelector('.easymde-immersive-preview-canvas');
    return {
      collapsed: current?.isCollapsed ?? null,
      length: current ? current.toString().length : null,
      scrollTop: canvas?.scrollTop ?? null
    };
  });
  const pointHit = point
    ? await page.evaluate(({ x, y }) => {
      const boundsOf = (element) => {
        if (!(element instanceof Element)) return null;
        const rect = element.getBoundingClientRect();
        return {
          bottom: Math.round(rect.bottom * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          width: Math.round(rect.width * 100) / 100
        };
      };
      const describe = (element) => element instanceof Element
        ? {
            bounds: boundsOf(element),
            className: 'string' === typeof element.className
              ? element.className.slice(0, 160)
              : '',
            connected: element.isConnected,
            tag: element.tagName
          }
        : null;
      const hit = document.elementFromPoint(x, y);
      return {
        element: describe(hit),
        list: describe(hit?.closest?.('ul,ol')),
        listItem: describe(hit?.closest?.('li'))
      };
    }, point)
    : null;
  await page.evaluate(({
    key,
    currentPhase,
    currentPoint,
    currentPointHit,
    currentSelection,
    currentTarget
  }) => {
    const state = globalThis[key];
    if (!state) return;
    state.targetMetadata = currentTarget;
    state.interactionSteps.push({
      phase: currentPhase,
      point: currentPoint,
      pointHit: currentPointHit,
      selection: currentSelection,
      target: currentTarget
    });
  }, {
    currentPhase: phase,
    currentPoint: point,
    currentPointHit: pointHit,
    currentSelection: selection,
    currentTarget: targetMetadata,
    key: contextMenuDiagnosticKey
  });
}

export async function enterImmersive(page) {
  const strings = await getImmersiveStrings(page);
  await page.getByRole('button', { name: strings.enter, exact: true }).click();
  await expect(page.locator('.easymde-editor.is-immersive')).toBeVisible();
  return strings;
}

export async function enterFullVisual(page) {
  const strings = await enterImmersive(page);
  await page.getByRole('button', { name: strings.preview, exact: true }).last().click();
  await expect(page.getByText(strings.previewContentLoaded)).toBeVisible();
  await page.getByRole('button', { name: strings.previewUnlockEdit, exact: true }).click();
  const visualEditor = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
  return { strings, visualEditor };
}

/**
 * ADR-002 retired the Windowed Visual owner, its spacers, and its 160-block
 * mount cap: one ProseMirror host keeps every top-level block of a long
 * document live and editable. `minimumBlocks` proves the document really is
 * long (the size that used to engage windowing).
 */
export async function expectUnifiedVisualSurface(visualEditor, minimumBlocks = 0) {
  await expect(visualEditor).toHaveAttribute('data-easymde-prosemirror-host', '1');
  await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
  await expect(visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  if (minimumBlocks > 0) {
    await expect.poll(
      () => visualEditor.locator(':scope > *').count(),
      { message: 'the long document should keep every top-level block live' }
    ).toBeGreaterThan(minimumBlocks);
  }
}

export async function selectVisualText(visualEditor, value, occurrence = 0) {
  await visualEditor.evaluate((surface, selectionTarget) => {
    const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let seen = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      let from = 0;
      while (from <= node.data.length) {
        const match = node.data.indexOf(selectionTarget.value, from);
        if (match < 0) break;
        if (seen === selectionTarget.occurrence) {
          const range = surface.ownerDocument.createRange();
          range.setStart(node, match);
          range.setEnd(node, match + selectionTarget.value.length);
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (!selection) throw new Error('visual-selection-unavailable');
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        seen += 1;
        from = match + Math.max(1, selectionTarget.value.length);
      }
    }
    throw new Error('visual-text-missing');
  }, { occurrence, value });
}

async function selectVisualElement(element) {
  await element.evaluate((target) => {
    const range = target instanceof HTMLImageElement
      ? (() => {
          const next = target.ownerDocument.createRange();
          next.selectNode(target);
          return next;
        })()
      : (() => {
          const next = target.ownerDocument.createRange();
          next.selectNodeContents(target);
          return next;
        })();
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function placeVisualCaret(element) {
  await element.evaluate((target) => {
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

export async function prepareVisualTarget(visualEditor, element) {
  await element.scrollIntoViewIfNeeded();
  await expect(element).toBeVisible();
  await expect.poll(
    () => element.evaluate((target) => {
      const rect = target.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < (target.ownerDocument.defaultView?.innerHeight ?? 0);
    })
  ).toBe(true);
  await visualEditor.focus();
  await expect.poll(
    () => visualEditor.evaluate((surface) => surface.ownerDocument.activeElement === surface)
  ).toBe(true);
}

async function visibleVisualSelectionPoint(visualEditor, expectedText) {
  return visualEditor.evaluate((surface, text) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.toString() !== text) {
      throw new Error('visual-text-selection-not-preserved');
    }
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find((candidate) =>
      candidate.width > 0
      && candidate.height > 0
      && candidate.bottom > 0
      && candidate.top < (surface.ownerDocument.defaultView?.innerHeight ?? 0)
    );
    if (!rect) throw new Error('visual-text-selection-rect-unavailable');
    return {
      bounds: {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      },
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, expectedText);
}

async function visibleVisualRangePoint(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
      throw new Error('visual-range-selection-not-preserved');
    }
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find((candidate) =>
      candidate.width > 0
      && candidate.height > 0
      && candidate.bottom > 0
      && candidate.top < (surface.ownerDocument.defaultView?.innerHeight ?? 0)
    );
    if (!rect) throw new Error('visual-range-selection-rect-unavailable');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function selectVisualCrossBlockRange(visualEditor, startText, endText) {
  await visualEditor.evaluate((surface, target) => {
    const textNodes = [];
    const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const find = (value, from = 0) => {
      for (let index = from; index < textNodes.length; index += 1) {
        const node = textNodes[index];
        const offset = node.data.indexOf(value);
        if (offset >= 0) return { index, node, offset };
      }
      return null;
    };
    const start = find(target.start);
    const end = find(target.end, (start?.index ?? 0) + 1);
    if (!start || !end) throw new Error('visual-cross-block-selection-text-missing');
    const range = surface.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + target.end.length);
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  }, { end: endText, start: startText });
}

export async function readVisualActionState(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const inside = (node) => Boolean(node && surface.contains(node));
    const selectionElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement ?? null;
    return {
      activeElementIsSurface: surface.ownerDocument.activeElement === surface,
      anchorConnected: Boolean(selection?.anchorNode?.isConnected),
      anchorInsideSurface: inside(selection?.anchorNode),
      selectionInsideCodeBlock: Boolean(
        selectionElement?.closest('pre')
        && surface.contains(selectionElement.closest('pre'))
      ),
      contentEditable: surface.getAttribute('contenteditable'),
      errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
      focusConnected: Boolean(selection?.focusNode?.isConnected),
      focusInsideSurface: inside(selection?.focusNode),
      nativeRangeCount: selection?.rangeCount ?? 0,
      selectedTextLength: selection ? selection.toString().length : 0,
      selectionCollapsed: Boolean(selection?.isCollapsed),
      surfaceConnected: surface.isConnected,
      rangeCollapsed: Boolean(range?.collapsed)
    };
  });
}

export function assertVisualActionState(state, phase) {
  if (!state.activeElementIsSurface
    || state.contentEditable !== 'true'
    || state.errorCode !== null
    || !state.surfaceConnected
    || !state.anchorConnected
    || !state.focusConnected
    || !state.anchorInsideSurface
    || !state.focusInsideSurface
    || state.nativeRangeCount !== 1) {
    throw new Error(`editor-context-menu-visual-action-selection-failed:${phase}`);
  }
}

export async function readVisualEscapeSelectionState(target, expectedSource) {
  return target.evaluate((paragraph, expected) => {
    const surface = paragraph.closest(
      'article[data-easymde-prosemirror-host="1"][contenteditable="true"], [data-easymde-preview-html-sink][role="textbox"]'
    );
    if (!surface) throw new Error('visual-escape-surface-missing');
    const native = surface.ownerDocument.defaultView?.getSelection();
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const boundary = (node, offset) => {
      const insideTarget = Boolean(node && paragraph.contains(node));
      let targetOffset = null;
      if (insideTarget) {
        const prefix = paragraph.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph);
        prefix.setEnd(node, offset);
        targetOffset = prefix.toString().length;
      }
      return {
        connected: Boolean(node?.isConnected),
        insideSurface: Boolean(node && surface.contains(node)),
        insideTarget,
        nodeType: node?.nodeType ?? null,
        targetOffset
      };
    };
    // Read the existing document owner; this observer never dispatches an edit
    // or places/restores the native selection.
    const root = document.querySelector('#easymde-editor-root');
    const key = root && Object.getOwnPropertyNames(root).find((name) => name.startsWith('__reactContainer$'));
    const queue = [root?.[key]?.stateNode?.current?.child];
    const owners = new Set();
    while (queue.length) {
      const fiber = queue.pop();
      if (!fiber) continue;
      for (const owner of [fiber.memoizedProps?.documentSession?.document, fiber.memoizedProps?.ordinaryStatus?.document]) {
        if (owner) owners.add(owner);
      }
      queue.push(fiber.child, fiber.sibling);
    }
    const owner = [...owners][0];
    const rect = paragraph.getBoundingClientRect();
    return {
      native: {
        anchor: boundary(native?.anchorNode, native?.anchorOffset),
        focus: boundary(native?.focusNode, native?.focusOffset),
        backward: Boolean(range && !native.isCollapsed
          && native.anchorNode === range.endContainer && native.anchorOffset === range.endOffset),
        collapsed: native?.isCollapsed ?? true,
        rangeCount: native?.rangeCount ?? 0,
        selectedUnits: native?.toString().length ?? 0
      },
      canonical: {
        ownerCount: owners.size,
        revision: owner?.getRevision(),
        history: owner?.getHistoryState(),
        selection: owner?.getSelection(),
        sourceExact: owner?.getValue() === expected
          && document.querySelector('#easymde-source')?.value === expected
      },
      activeSurface: document.activeElement === surface,
      activeMenuItem: Boolean(document.activeElement?.closest('[data-easymde-context-menu-item]')),
      contentEditable: surface.getAttribute('contenteditable'),
      lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
      error: surface.getAttribute('data-easymde-preview-error'),
      geometry: {
        width: rect.width,
        height: rect.height,
        inViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
      }
    };
  }, expectedSource);
}

export async function readVisualPreviewAcceptanceState(visualEditor) {
  if (0 === await visualEditor.count()) {
    return {
      accepted: null,
      ariaBusy: null,
      domHash: null,
      domLength: null,
      error: null,
      phase: null,
      refreshing: null
    };
  }
  return visualEditor.evaluate((surface) => {
    let hash = 2166136261;
    const html = surface.innerHTML;
    for (let index = 0; index < html.length; index += 1) {
      hash ^= html.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    if (surface.matches('[data-easymde-prosemirror-host="1"]')) {
      // ADR-002: the unlocked ProseMirror surface projects the canonical
      // document synchronously and never carries the formal Preview sink's
      // acceptance attributes. Its readiness is the live, connected, editable
      // host with rendered content and no reported visual failure.
      const failure = surface.ownerDocument
        .querySelector('[data-easymde-visual-failure]')
        ?.getAttribute('data-easymde-visual-failure') ?? null;
      const ready = surface.isConnected
        && 'true' === surface.getAttribute('contenteditable')
        && html.length > 0
        && null === failure;
      return {
        accepted: ready ? '1' : null,
        ariaBusy: ready ? 'false' : 'true',
        domHash: (hash >>> 0).toString(16),
        domLength: html.length,
        error: failure,
        phase: ready ? 'prosemirror-ready' : 'prosemirror-pending',
        refreshing: null
      };
    }
    return {
      accepted: surface.getAttribute('data-easymde-preview-accepted'),
      ariaBusy: surface.getAttribute('aria-busy'),
      domHash: (hash >>> 0).toString(16),
      domLength: html.length,
      error: surface.getAttribute('data-easymde-preview-error'),
      phase: surface.getAttribute('data-easymde-preview-phase'),
      refreshing: surface.getAttribute('data-easymde-preview-refreshing')
    };
  });
}

export async function readSettingsFullShortcutState(page, visualEditor, source, phase) {
  const visual = await visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const describe = (node) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const top = element?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote');
      return {
        bAncestor: Boolean(element?.closest('b')),
        connected: Boolean(node?.isConnected),
        insideStrong: Boolean(element?.closest('strong')),
        protected: Boolean(element?.closest('.easymde-toc,.footnotes-sep,.footnotes,.easymde-math[data-easymde-rendered],.easymde-mermaid')),
        tag: top?.tagName ?? element?.tagName ?? null
      };
    };
    return {
      anchor: describe(selection?.anchorNode),
      focus: describe(selection?.focusNode),
      selectedTextLength: selection?.toString().length ?? 0,
      surfaceConnected: surface.isConnected
    };
  });
  const sourceState = await source.evaluate((field) => {
    let hash = 2166136261;
    const value = 'value' in field && 'string' === typeof field.value ? field.value : '';
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return { hash: (hash >>> 0).toString(16), length: value.length };
  });
  return {
    phase,
    source: sourceState,
    toolbarErrorPresent: await page.locator('#easymde-editor [role="alert"]').count() > 0,
    visual
  };
}

export async function waitForVisualPreviewAccepted(
  visualEditor,
  phase,
  previousDomHash = null,
  diagnosticsPage = null
) {
  try {
    await expect.poll(
      () => readVisualPreviewAcceptanceState(visualEditor),
      { message: `Visual Preview should be formally accepted before history: ${phase}` }
    ).toMatchObject({ accepted: '1', ariaBusy: 'false', error: null, refreshing: null });
  } catch (error) {
    const state = await readVisualPreviewAcceptanceState(visualEditor);
    const failureLocator = diagnosticsPage?.locator('[data-easymde-visual-failure]') ?? null;
    const visualFailure = failureLocator && await failureLocator.count() > 0
      ? await failureLocator.first().getAttribute('data-easymde-visual-failure')
      : null;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
      `[preview-acceptance-state] ${JSON.stringify({ phase, state, visualFailure })}`,
      { cause: error }
    );
  }
  if (previousDomHash !== null) {
    await expect.poll(
      () => readVisualPreviewAcceptanceState(visualEditor).then((state) => state.domHash),
      { message: `Visual Preview DOM should advance before history: ${phase}` }
    ).not.toBe(previousDomHash);
  }
  return readVisualPreviewAcceptanceState(visualEditor);
}

async function openVisualActionMenu(page, visualEditor, target, selectText, occurrence = 0) {
  await prepareVisualTarget(visualEditor, target);
  await selectVisualText(visualEditor, selectText, occurrence);
  const before = await readVisualActionState(visualEditor);
  assertVisualActionState(before, 'before-menu');
  const point = await visibleVisualSelectionPoint(visualEditor, selectText);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
  return before;
}

async function selectVisualTextAcrossNodes(surface, expectedText, occurrence = 0) {
  await surface.evaluate((target, selectionTarget) => {
    const nodes = [];
    const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      nodes.push({ end: text.length + node.data.length, node, start: text.length });
      text += node.data;
    }
    let from = 0;
    let matchStart = -1;
    for (let index = 0; index <= selectionTarget.occurrence; index += 1) {
      matchStart = text.indexOf(selectionTarget.value, from);
      if (matchStart < 0) throw new Error('visual-text-missing');
      from = matchStart + Math.max(1, selectionTarget.value.length);
    }
    const matchEnd = matchStart + selectionTarget.value.length;
    const startNode = nodes.find(({ end, start }) => matchStart >= start && matchStart < end);
    const endNode = nodes.find(({ end, start }) => matchEnd > start && matchEnd <= end);
    if (!startNode || !endNode) throw new Error('visual-text-range-node-missing');
    const range = target.ownerDocument.createRange();
    range.setStart(startNode.node, matchStart - startNode.start);
    range.setEnd(endNode.node, matchEnd - endNode.start);
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  }, { occurrence, value: expectedText });
}

export async function openVisualCodeActionMenu(page, visualEditor, target, selectText) {
  await prepareVisualTarget(visualEditor, target);
  await selectVisualTextAcrossNodes(target, selectText);
  const before = await readVisualActionState(visualEditor);
  assertVisualActionState(before, 'before-code-menu');
  const point = await visibleVisualSelectionPoint(visualEditor, selectText);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
  return before;
}

function visualHistoryDigest(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function startVisualHistoryDiagnostics(page) {
  const previewRequests = [];
  const previewResponses = [];
  const consoleCodes = new Set();
  const readRevisionSignature = (request) => {
    const body = request.postData() ?? '';
    let payload = null;
    if (body.trim().startsWith('{')) {
      try {
        const value = JSON.parse(body);
        if (value && 'object' === typeof value && !Array.isArray(value)) payload = value;
      } catch {
        payload = null;
      }
    }
    if (!payload) {
      const parameters = new URLSearchParams(body);
      payload = {
        revision: parameters.get('revision'),
        signature: parameters.get('signature')
      };
    }
    const rawRevision = payload?.revision;
    const revision = Number(rawRevision);
    return {
      revision: rawRevision !== null
        && undefined !== rawRevision
        && '' !== rawRevision
        && Number.isSafeInteger(revision)
        ? revision
        : null,
      signature: 'string' === typeof payload?.signature
        ? { hash: visualHistoryDigest(payload.signature), length: payload.signature.length }
        : null
    };
  };
  const onRequest = (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.endsWith('/wp-json/easymde/v1/preview')) return;
    previewRequests.push({
      at: Math.round(performance.now() * 100) / 100,
      ...readRevisionSignature(request)
    });
  };
  const onResponse = (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.endsWith('/wp-json/easymde/v1/preview')) return;
    previewResponses.push({
      at: Math.round(performance.now() * 100) / 100,
      status: response.status()
    });
  };
  const onConsole = (message) => {
    if ('error' !== message.type()) return;
    const match = message.text().match(/^\[EasyMDE\]\s+([a-z0-9-]+)$/u);
    if (match) consoleCodes.add(match[1]);
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('console', onConsole);
  await page.evaluate((key) => {
    const previous = globalThis[key];
    previous?.stop?.();
    const keyEvents = [];
    const timeline = [];
    const digest = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    };
    const previewState = () => {
      const preview = document.querySelector(
        'article[data-easymde-prosemirror-host="1"][contenteditable="true"], [data-easymde-preview-html-sink="1"][contenteditable="true"]'
      ) ?? document.querySelector('[data-easymde-preview-html-sink="1"]');
      if (!(preview instanceof Element)) return null;
      return {
        accepted: preview.getAttribute('data-easymde-preview-accepted'),
        ariaBusy: preview.getAttribute('aria-busy'),
        error: preview.getAttribute('data-easymde-preview-error'),
        refreshing: preview.getAttribute('data-easymde-preview-refreshing')
      };
    };
    const recordTimeline = () => {
      const state = previewState();
      if (!state) return;
      const previousState = timeline[timeline.length - 1]?.state;
      if (JSON.stringify(previousState) === JSON.stringify(state)) return;
      timeline.push({
        at: Math.round(performance.now() * 100) / 100,
        state
      });
    };
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey || ['Control', 'Meta', 'Shift', 'z', 'Z'].includes(event.key))) return;
      const target = event.target instanceof Element ? event.target : null;
      keyEvents.push({
        at: Math.round(performance.now() * 100) / 100,
        ctrl: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
        key: event.key,
        meta: event.metaKey,
        shift: event.shiftKey,
        targetClass: target && 'string' === typeof target.className
          ? target.className.slice(0, 120)
          : '',
        targetTag: target?.tagName ?? ''
      });
    };
    const observer = new MutationObserver(recordTimeline);
    document.addEventListener('keydown', onKeyDown, true);
    observer.observe(document.documentElement, {
      attributeFilter: [
        'aria-busy',
        'data-easymde-preview-accepted',
        'data-easymde-preview-error',
        'data-easymde-preview-refreshing'
      ],
      attributes: true,
      subtree: true
    });
    recordTimeline();
    globalThis[key] = {
      snapshot() {
        const source = document.querySelector('#easymde-source');
        const visual = document.querySelector(
          'article[data-easymde-prosemirror-host="1"][contenteditable="true"], [data-easymde-preview-html-sink="1"][contenteditable="true"]'
        );
        const selection = visual?.ownerDocument.defaultView?.getSelection() ?? null;
        const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
        const selectionNode = (node) => {
          const element = node instanceof Element ? node : node?.parentElement;
          let block = element ?? null;
          while (block && visual && block.parentElement !== visual) block = block.parentElement;
          const index = block && visual ? Array.prototype.indexOf.call(visual.children, block) : -1;
          return {
            blockId: index >= 0 ? `pm-block-${index}` : null,
            connected: Boolean(node?.isConnected),
            tag: element?.tagName ?? null
          };
        };
        const sourceValue = source instanceof HTMLTextAreaElement ? source.value : '';
        return {
          source: {
            hash: digest(sourceValue),
            length: sourceValue.length,
            selectionEnd: source instanceof HTMLTextAreaElement ? source.selectionEnd : null,
            selectionStart: source instanceof HTMLTextAreaElement ? source.selectionStart : null
          },
          visual: visual instanceof Element ? {
            active: visual.ownerDocument.activeElement === visual,
            ariaBusy: visual.getAttribute('aria-busy'),
            ariaReadonly: visual.getAttribute('aria-readonly'),
            contentEditable: visual.getAttribute('contenteditable'),
            error: visual.getAttribute('data-easymde-preview-error'),
            focusNodeConnected: Boolean(selection?.focusNode?.isConnected),
            focusNode: selectionNode(selection?.focusNode),
            focusOffset: selection?.focusOffset ?? null,
            anchorNode: selectionNode(selection?.anchorNode),
            anchorOffset: selection?.anchorOffset ?? null,
            rangeCollapsed: Boolean(range?.collapsed),
            rangeCount: selection?.rangeCount ?? 0,
            selectedTextLength: selection?.toString().length ?? 0,
            selectionDirection: 'string' === typeof selection?.direction ? selection.direction : null
          } : null,
          preview: previewState(),
          keyEvents: [...keyEvents],
          timeline: [...timeline]
        };
      },
      stop() {
        observer.disconnect();
        document.removeEventListener('keydown', onKeyDown, true);
        delete globalThis[key];
      }
    };
  }, visualHistoryDiagnosticKey);
  return {
    async snapshot() {
      return page.evaluate((key) => globalThis[key]?.snapshot?.() ?? null, visualHistoryDiagnosticKey).then((dom) => ({
        dom,
        consoleCodes: [...consoleCodes].sort(),
        previewRequests: [...previewRequests],
        previewResponses: [...previewResponses]
      }));
    },
    async stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('console', onConsole);
      await page.evaluate((key) => globalThis[key]?.stop?.(), visualHistoryDiagnosticKey);
    }
  };
}

export async function runVisualMutationAction(
  page,
  visualEditor,
  source,
  markdown,
  {
    action,
    expected,
    label,
    occurrence = 0,
    pasteText = null,
    submenu,
    target,
    selectText,
    verifyHistory = true,
    resetFixture = true
  }
) {
  await assertSourceExactValue(source, markdown, `${label}-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  if (pasteText !== null) {
    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, pasteText);
  }
  await openVisualActionMenu(page, visualEditor, target, selectText, occurrence);
  if (submenu) await openRootSubmenu(page, submenu);
  if (submenu === 'copy-paste-as') await expectMenuItemState(page, action, 'enabled');
  if (!submenu) await expectMenuItemState(page, action, 'enabled');
  if (submenu) await anyMenuItem(page, action).click();
  else await rootItem(page, action).click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${label}-applied`);
  await expect.poll(
    () => readVisualActionState(visualEditor).then((state) => state.activeElementIsSurface)
  ).toBe(true);
  assertVisualActionState(await readVisualActionState(visualEditor), `${label}-applied`);
  if (!verifyHistory) {
    await waitForVisualPreviewAccepted(visualEditor, `${label}-applied`, previewBefore.domHash);
    if (!resetFixture) return;
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${label}-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${label}-fixture-reset`);
    return;
  }

  const historyStages = [];
  const historyProbe = await startVisualHistoryDiagnostics(page);
  try {
    historyStages.push({ phase: 'after-action', ...(await historyProbe.snapshot()) });
    let actionPreview;
    try {
      actionPreview = await waitForVisualPreviewAccepted(
        visualEditor,
        `${label}-applied`,
        previewBefore.domHash
      );
    } catch (error) {
      const diagnostic = await historyProbe.snapshot();
      throw new Error(
        `editor-context-menu-visual-history-preview-failed:${label}:` +
        `${JSON.stringify({ diagnostic, historyStages })}`,
        { cause: error }
      );
    }
    historyStages.push({ phase: 'before-undo', ...(await historyProbe.snapshot()) });
    await visualEditor.press('ControlOrMeta+z');
    try {
      await waitForSourceExactValue(source, markdown, `${label}-undo`);
      const undoPreview = await waitForVisualPreviewAccepted(
        visualEditor,
        `${label}-undo`,
        actionPreview.domHash
      );
      historyStages.push({ phase: 'after-undo', ...(await historyProbe.snapshot()) });
      assertVisualActionState(await readVisualActionState(visualEditor), `${label}-undo`);
      await visualEditor.press('ControlOrMeta+Shift+z');
      await waitForSourceExactValue(source, expected, `${label}-redo`);
      const redoPreview = await waitForVisualPreviewAccepted(
        visualEditor,
        `${label}-redo`,
        undoPreview.domHash
      );
      historyStages.push({ phase: 'after-redo', ...(await historyProbe.snapshot()) });
      assertVisualActionState(await readVisualActionState(visualEditor), `${label}-redo`);
      await visualEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, `${label}-reset`);
      await waitForVisualPreviewAccepted(visualEditor, `${label}-reset`, redoPreview.domHash);
    } catch (error) {
      const diagnostic = await historyProbe.snapshot();
      throw new Error(
        `editor-context-menu-visual-history-undo-failed:${label}:` +
        `${JSON.stringify({ diagnostic, historyStages })}`,
        { cause: error }
      );
    }
  } finally {
    await historyProbe?.stop();
  }
}

export async function readSourceSelectionRange(page) {
  return page.locator('#easymde-source').evaluate((field) => ({
    end: field.selectionEnd,
    start: field.selectionStart
  }));
}

async function openVisualCrossHeadingMenu(page, visualEditor, target) {
  await prepareVisualTarget(visualEditor, target);
  await selectVisualCrossBlockRange(
    visualEditor,
    '一级标题 Heading 1',
    '二级标题 Heading 2'
  );
  const before = await readVisualActionState(visualEditor);
  assertVisualActionState(before, 'cross-heading-before-menu');
  const point = await visibleVisualRangePoint(visualEditor);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
  return before;
}

async function runVisualCrossHeadingBold(page, visualEditor, source, markdown, suffix, verifyHistory = true) {
  await assertSourceExactValue(source, markdown, `${suffix}-cross-heading-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  await openVisualCrossHeadingMenu(
    page,
    visualEditor,
    visualEditor.locator('h1').first()
  );
  await expectMenuItemState(page, 'bold', 'enabled');
  const sourceSelection = await readSourceSelectionRange(page);
  if (!Number.isInteger(sourceSelection.start)
    || !Number.isInteger(sourceSelection.end)
    || sourceSelection.start < 0
    || sourceSelection.end <= sourceSelection.start
    || sourceSelection.end > markdown.length) {
    throw new Error(`${suffix}-cross-heading-source-selection-invalid`);
  }
  const boldCommand = await page.evaluate(() => {
    const command = window.EasyMDEEditorRootBootstrap.toolbar.commands.find(
      ({ id }) => id === 'bold'
    );
    if (!command || 'string' !== typeof command.prefix || 'string' !== typeof command.suffix) {
      throw new Error('visual-bold-toolbar-command-invalid');
    }
    return { prefix: command.prefix, suffix: command.suffix };
  });
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const crossHeadingBefore =
    `# 一级标题 Heading 1${newline}${newline}## 二级标题 Heading 2`;
  const crossHeadingAfter =
    `# ${boldCommand.prefix}一级标题 Heading 1${boldCommand.suffix}`
    + `${newline}${newline}`
    + `## ${boldCommand.prefix}二级标题 Heading 2${boldCommand.suffix}`;
  const expected = replaceVisualSourceOccurrence(
    markdown,
    crossHeadingBefore,
    crossHeadingAfter,
    0
  );
  const boldHeading1 = visualEditor.locator('h1', { hasText: '一级标题 Heading 1' }).first();
  const boldHeading2 = visualEditor.locator('h2', { hasText: '二级标题 Heading 2' }).first();
  await rootItem(page, 'bold').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${suffix}-cross-heading-bold-applied`);
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-cross-heading-bold-applied`
  );
  const actionPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-applied`,
    previewBefore.domHash,
    page
  );
  await expect(boldHeading1.locator('strong')).toHaveText('一级标题 Heading 1');
  await expect(boldHeading2.locator('strong')).toHaveText('二级标题 Heading 2');
  await expect(boldHeading1).not.toContainText('**');
  await expect(boldHeading2).not.toContainText('**');
  if (!verifyHistory) {
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${suffix}-cross-heading-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${suffix}-cross-heading-fixture-reset`);
    return;
  }

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-cross-heading-bold-undo`);
  const undoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-undo`,
    actionPreview.domHash,
    page
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-cross-heading-bold-undo`
  );
  await expect(boldHeading1.locator('strong')).toHaveCount(0);
  await expect(boldHeading2.locator('strong')).toHaveCount(0);
  await visualEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, expected, `${suffix}-cross-heading-bold-redo`);
  const redoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-redo`,
    undoPreview.domHash,
    page
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-cross-heading-bold-redo`
  );
  await expect(boldHeading1.locator('strong')).toHaveText('一级标题 Heading 1');
  await expect(boldHeading2.locator('strong')).toHaveText('二级标题 Heading 2');
  await expect(boldHeading1).not.toContainText('**');
  await expect(boldHeading2).not.toContainText('**');
  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-cross-heading-bold-reset`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-reset`,
    redoPreview.domHash,
    page
  );
  await expect(boldHeading1.locator('strong')).toHaveCount(0);
  await expect(boldHeading2.locator('strong')).toHaveCount(0);
}

async function runVisualImageScaleAction(
  page,
  visualEditor,
  source,
  markdown,
  occurrence,
  suffix,
  verifyHistory = true
) {
  const imageMarkdown = markdown.match(/!\[占位测试图片\]\([^\r\n]+\)/u)?.[0];
  if (!imageMarkdown) throw new Error(`${suffix}-visual-image-source-missing`);
  const expected = imageScaleSource(markdown, imageMarkdown, 50, occurrence);
  const image = visualEditor.getByAltText(imageSourceAlt, { exact: true }).nth(occurrence);
  await assertSourceExactValue(source, markdown, `${suffix}-visual-image-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, image, occurrence);
  }
  await openVisualMenu(page, visualEditor, image, true, null);
  await openRootSubmenu(page, 'image-scale');
  await expectMenuItemState(page, 'image-scale-50', 'enabled');
  await anyMenuItem(page, 'image-scale-50').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${suffix}-visual-image-applied`);
  await expect(
    visualEditor.getByAltText(imageSourceAlt, { exact: true }).nth(occurrence)
  ).toHaveAttribute('data-easymde-image-scale', '50');
  const actionPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-applied`,
    previewBefore.domHash
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-visual-image-applied`
  );
  if (!verifyHistory) {
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${suffix}-visual-image-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${suffix}-visual-image-fixture-reset`);
    return;
  }

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-image-undo`);
  const undoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-undo`,
    actionPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, expected, `${suffix}-visual-image-redo`);
  const redoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-redo`,
    undoPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-image-reset`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-reset`,
    redoPreview.domHash
  );
}

async function runVisualTableAlignmentAction(
  page,
  visualEditor,
  source,
  markdown,
  occurrence,
  suffix,
  verifyHistory = true
) {
  const tableSource = [
    '| 左对齐    |  居中 |    右对齐 |',
    '| :----- | :-: | -----: |',
    '| Apple  | 100 | $99.99 |',
    '| Banana | 200 | $12.50 |',
    '| Orange | 300 |  $8.88 |'
  ].join('\n');
  const tableStart = occurrenceOffset(markdown, tableSource, occurrence);
  const tableEnd = tableStart + tableSource.length;
  const target = visualEditor.locator('table').filter({ hasText: 'Apple' }).nth(occurrence);
  await assertSourceExactValue(source, markdown, `${suffix}-visual-table-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, target, occurrence);
  }
  await openVisualMenu(page, visualEditor, target, true, null);
  await openRootSubmenu(page, 'table');
  await openVisibleSubmenu(page, 'table-alignment');
  await expectMenuItemState(page, 'align-center', 'enabled');
  await anyMenuItem(page, 'align-center').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await expect.poll(
    () => source.evaluate((field, expected) => (
      'value' in field && field.value !== expected
    ), markdown),
    { message: `${suffix} Visual table alignment should change canonical Source` }
  ).toBe(true);
  const expected = await source.inputValue();
  if (!expected.startsWith(markdown.slice(0, tableStart))
    || !expected.endsWith(markdown.slice(tableEnd))
    || expected === markdown) {
    throw new Error(`${suffix}-visual-table-source-diff-invalid`);
  }
  const actionPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-applied`,
    previewBefore.domHash
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-visual-table-applied`
  );
  if (!verifyHistory) {
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${suffix}-visual-table-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${suffix}-visual-table-fixture-reset`);
    return;
  }

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-table-undo`);
  const undoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-undo`,
    actionPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, expected, `${suffix}-visual-table-redo`);
  const redoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-redo`,
    undoPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-table-reset`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-reset`,
    redoPreview.domHash
  );
}

export async function ensureWindowedVisualTargetMounted(page, target, occurrence) {
  const canvas = page.locator('.easymde-immersive-preview-canvas');
  const startStep = occurrence > 0 ? 9 : 0;
  for (let step = startStep; step <= 20; step += 1) {
    if (await target.count() > 0) return;
    await canvas.evaluate((element, progress) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = maximum * progress;
      element.dispatchEvent(new Event('scroll'));
    }, Math.min(1, step / 20));
    await page.waitForTimeout(180);
  }
  await expect(target).toHaveCount(1);
}

export async function repeatAfterFormalPreview(page, strings, source, markdown, occurrence = 0) {
  await page.getByRole('button', { name: strings.previewLockReadOnly, exact: true }).click();
  const visualEditor = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(visualEditor).toHaveCount(0);
  const unlock = page.getByRole('button', { name: strings.previewUnlockEdit, exact: true });
  await expect(unlock).toBeEnabled();
  await unlock.click();
  const reentered = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(reentered).toHaveAttribute('contenteditable', 'true');
  const expected = replaceVisualSourceOccurrence(markdown, '普通文本', '**普通文本**', occurrence);
  const target = reentered.locator('p').filter({ hasText: '普通文本' }).nth(occurrence);
  await runVisualMutationAction(page, reentered, source, markdown, {
    action: 'bold',
    expected,
    label: 'formal-preview-repeat-bold',
    occurrence,
    target,
    selectText: '普通文本'
  });
  return reentered;
}

export async function runVisualActionMatrix(page, visualEditor, source, markdown, occurrence, suffix, group) {
  const targetFor = (selector, text) => {
    const matches = visualEditor.locator(selector).filter({ hasText: text });
    return occurrence > 0 ? matches : matches.first();
  };
  const categories = [
    {
      id: 'text',
      target: targetFor('p', '普通文本'),
      value: '普通文本'
    },
    {
      id: 'list',
      target: targetFor('li', '前端开发'),
      value: '前端开发'
    },
    {
      id: 'link',
      target: targetFor('a', 'OpenAI 官网'),
      value: 'OpenAI 官网'
    }
  ];
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, visualEditor.locator('h1').first(), 0);
  }
  for (const category of categories) {
    if (category.id !== group) continue;
    const actions = 'windowed' === suffix
      ? ['bold']
      : ['bold', 'cut', 'paste-plain-text'];
    for (const action of actions) {
      const replacement = `E2E ${category.id} paste`;
      const expected = 'bold' === action
        ? replaceVisualSourceOccurrence(markdown, category.value, `**${category.value}**`, occurrence)
        : 'cut' === action
          ? replaceVisualSourceOccurrence(markdown, category.value, '', occurrence)
          : replaceVisualSourceOccurrence(markdown, category.value, replacement, occurrence);
      await ensureWindowedVisualTargetMounted(page, category.target, occurrence);
      await runVisualMutationAction(page, visualEditor, source, markdown, {
        action,
        expected,
        label: `${suffix}-${category.id}-${action}`,
        occurrence,
        pasteText: 'paste-plain-text' === action ? replacement : null,
        submenu: 'paste-plain-text' === action ? 'copy-paste-as' : null,
        target: category.target,
        selectText: category.value,
        verifyHistory: true,
        resetFixture: true
      });
    }
  }
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, visualEditor.locator('h1').first(), 0);
  }
  if ('cross-heading' === group) {
    await runVisualCrossHeadingBold(page, visualEditor, source, markdown, suffix, true);
  }
  if ('image' === group) {
    await runVisualImageScaleAction(page, visualEditor, source, markdown, occurrence, suffix, true);
  }
  if ('table' === group) {
    await runVisualTableAlignmentAction(page, visualEditor, source, markdown, occurrence, suffix, true);
  }
}

async function visualElementCenterPoint(element) {
  return element.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    return {
      bounds: {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      },
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  });
}

async function readVisualTargetMetadata(target) {
  let count;
  try {
    count = await target.count();
  } catch {
    return {
      bounds: null,
      className: '',
      connected: false,
      count: null,
      tag: 'UNKNOWN'
    };
  }
  if (0 === count) {
    return {
      bounds: null,
      className: '',
      connected: false,
      count,
      tag: 'MISSING'
    };
  }
  try {
    return {
      count,
      ...(await target.first().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          bounds: {
            bottom: Math.round(rect.bottom * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            top: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100
          },
          className: 'string' === typeof element.className
            ? element.className.slice(0, 160)
            : '',
          connected: element.isConnected,
          blockId: (() => {
            const surface = element.closest('[data-easymde-prosemirror-host="1"]');
            let block = element;
            while (block && surface && block.parentElement !== surface) block = block.parentElement;
            const index = block && surface ? Array.prototype.indexOf.call(surface.children, block) : -1;
            return index >= 0 ? `pm-block-${index}` : null;
          })(),
          tag: element.tagName,
          text: (element.textContent ?? '').slice(0, 120)
        };
      }))
    };
  } catch {
    return {
      bounds: null,
      className: '',
      connected: false,
      count,
      tag: 'UNKNOWN'
    };
  }
}

export async function scrollWindowedVisualToTop(page, visualEditor) {
  const canvas = page.locator('.easymde-immersive-preview-canvas');
  await canvas.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect.poll(
    () => canvas.evaluate((element) => element.scrollTop)
  ).toBe(0);
  // ADR-002: the unified ProseMirror surface keeps every block live, so the
  // document head — and with it the first fixture image pair — is mounted;
  // ProseMirror's zero-size cursor separators are not content images.
  await expect.poll(
    () => visualEditor.evaluate((surface, selector) =>
      Array.from(surface.querySelectorAll(selector))
        .slice(0, 2)
        .map((image) => image.getAttribute('alt')),
    visualContentImageSelector),
    { message: 'the fixture head should be the mounted window' }
  ).toEqual(['占位测试图片', '风景占位图']);
}

export async function visualImagePoint(image) {
  await expect.poll(
    () => image.evaluate((target) => {
      const rect = target.getBoundingClientRect();
      const view = target.ownerDocument.defaultView;
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < (view?.innerHeight ?? 0);
    })
  ).toBe(true);
  return image.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const view = target.ownerDocument.defaultView;
    const candidates = [
      [rect.left + 18, rect.bottom - 24],
      [rect.right - 18, rect.bottom - 24],
      [rect.left + 18, rect.top + 24],
      [rect.right - 18, rect.top + 24],
      [rect.left + 18, rect.top + rect.height / 2]
    ];
    for (const [x, y] of candidates) {
      if (y < 4 || y > (view?.innerHeight ?? 0) - 4) continue;
      // A point that is covered by an open menu or by the immersive header
      // would retarget the wrong element, so only a point whose topmost hit is
      // the image itself is usable.
      if (target.ownerDocument.elementFromPoint(x, y) !== target) continue;
      const surface = target.closest('[data-easymde-prosemirror-host="1"]');
      let block = target;
      while (block && surface && block.parentElement !== surface) block = block.parentElement;
      const blockIndex = block && surface ? Array.prototype.indexOf.call(surface.children, block) : -1;
      return {
        block: blockIndex >= 0 ? `pm-block-${blockIndex}` : null,
        label: target.getAttribute('alt'),
        x,
        y
      };
    }
    throw new Error('visual-image-pointer-point-unavailable');
  });
}

async function readVisualTextPoint(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const view = surface.ownerDocument.defaultView;
    const paragraphs = Array.from(surface.querySelectorAll('p')).filter(
      (paragraph) =>
        !paragraph.querySelector('img:not(.ProseMirror-separator)')
        && (paragraph.textContent ?? '').trim().length > 8
    );
    for (const paragraph of paragraphs) {
      const rect = paragraph.getBoundingClientRect();
      for (const y of [
        rect.top + rect.height / 2,
        rect.top + 6,
        rect.bottom - 6
      ]) {
        // The immersive header owns the top of the viewport.
        if (y < 80 || y > (view?.innerHeight ?? 0) - 8) continue;
        for (let x = rect.left + 24; x < rect.right - 24; x += 40) {
          const hit = surface.ownerDocument.elementFromPoint(x, y);
          if (!hit || !surface.contains(hit) || hit.closest('img')) continue;
          let block = hit;
          while (block && block.parentElement !== surface) block = block.parentElement;
          const blockIndex = block ? Array.prototype.indexOf.call(surface.children, block) : -1;
          return {
            block: blockIndex >= 0 ? `pm-block-${blockIndex}` : null,
            x,
            y
          };
        }
      }
    }
    return null;
  });
}

export async function clickVisualTextPoint(page, visualEditor) {
  const canvas = page.locator('.easymde-immersive-preview-canvas');
  // The images can fill the visible window; the user would scroll to reach a
  // passage, and no menu is open here, so a bounded scroll is safe.
  for (const delta of [0, 220, -220, 440, -440, 660, -660]) {
    if (0 !== delta) {
      await canvas.evaluate((element, offset) => {
        element.scrollTop += offset;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
      }, delta);
    }
    const point = await readVisualTextPoint(visualEditor);
    if (!point) continue;
    await page.mouse.click(point.x, point.y);
    return point;
  }
  throw new Error('visual-text-pointer-point-unavailable');
}

export async function readVisibleBand(page) {
  return page
    .locator('.easymde-immersive-preview-canvas')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: Math.min(rect.bottom, element.ownerDocument.defaultView?.innerHeight ?? 0),
        top: Math.max(rect.top, 0)
      };
    });
}

/**
 * Real content images on the unified ProseMirror surface. ProseMirror's
 * zero-size `img.ProseMirror-separator` cursor hacks are never content.
 */
export const visualContentImageSelector = 'img:not(.ProseMirror-separator)';

/**
 * ADR-002 retired the Windowed `[data-easymde-visual-block-id]` identities.
 * A block is addressed by its top-level position on the ProseMirror host,
 * `pm-block-<index>`, which is stable while the document structure is.
 */
export function visualBlockLocator(visualEditor, blockId) {
  const match = /^pm-block-(\d+)$/u.exec(blockId ?? '');
  if (!match) throw new Error(`visual-block-id-invalid:${blockId}`);
  return visualEditor.locator(':scope > *').nth(Number(match[1]));
}

export function visualBlockImage(visualEditor, blockId) {
  return visualBlockLocator(visualEditor, blockId).locator(visualContentImageSelector);
}

export async function readMountedVisualImages(visualEditor) {
  return visualEditor.evaluate((surface, selector) =>
    Array.from(surface.querySelectorAll(selector)).map((image) => {
      let block = image;
      while (block && block.parentElement !== surface) block = block.parentElement;
      const index = block ? Array.prototype.indexOf.call(surface.children, block) : -1;
      return {
        alt: image.getAttribute('alt'),
        block: index >= 0 ? `pm-block-${index}` : null
      };
    }),
  visualContentImageSelector);
}

export async function readVisualImageTargetState(visualEditor) {
  return visualEditor.evaluate((surface, selector) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const images = Array.from(surface.querySelectorAll(selector));
    const blockOf = (node) => {
      let block = node instanceof Element
        ? node
        : node?.parentElement ?? null;
      while (block && block.parentElement !== surface) block = block.parentElement;
      const index = block ? Array.prototype.indexOf.call(surface.children, block) : -1;
      return index >= 0 ? `pm-block-${index}` : null;
    };
    // ADR-002: the selected image itself carries the visible target ring
    // (ImageNodeView box-shadow), replacing the retired feedback overlay. The
    // painted ring is clipped by every overflow-clipping ancestor (the
    // immersive canvas) and the viewport, so report that visible box.
    const marker = surface.querySelector(
      'img[data-easymde-visual-image-selected="1"].easymde-visual-image-selected'
    );
    const view = surface.ownerDocument.defaultView;
    let markerRect = null;
    if (marker && 'none' !== view?.getComputedStyle(marker).boxShadow) {
      const rect = marker.getBoundingClientRect();
      let clipTop = 0;
      let clipBottom = view.innerHeight;
      let clipLeft = 0;
      let clipRight = view.innerWidth;
      for (let node = marker.parentElement; node; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if ('visible' === style.overflowY && 'visible' === style.overflowX) continue;
        const clip = node.getBoundingClientRect();
        clipTop = Math.max(clipTop, clip.top);
        clipBottom = Math.min(clipBottom, clip.bottom);
        clipLeft = Math.max(clipLeft, clip.left);
        clipRight = Math.min(clipRight, clip.right);
      }
      // A ring scrolled fully out of the band paints nothing; it collapses to
      // an empty box at the band edge instead of escaping over page chrome.
      const top = Math.min(Math.max(rect.top, clipTop), clipBottom);
      const bottom = Math.max(Math.min(rect.bottom, clipBottom), top);
      const left = Math.min(Math.max(rect.left, clipLeft), clipRight);
      const right = Math.max(Math.min(rect.right, clipRight), left);
      markerRect = {
        height: Math.round(bottom - top),
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(right - left)
      };
    }
    return {
      anchorBlock: blockOf(selection?.anchorNode ?? null),
      collapsed: Boolean(selection?.isCollapsed),
      imageBlocks: images.map((image) => blockOf(image)),
      markerBlock: marker && markerRect ? blockOf(marker) : null,
      markerRect,
      markerTop: markerRect ? markerRect.top : null,
      overlaps: range ? images.map((image) => range.intersectsNode(image)) : [],
      rangeCount: selection?.rangeCount ?? 0
    };
  }, visualContentImageSelector);
}

export async function readMenuRect(page) {
  const menu = page.locator(menuSelector);
  if (0 === await menu.count()) return null;
  return menu.first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width)
    };
  });
}

export async function revealWindowedVisualBlock(page, blockId) {
  const match = /^pm-block-(\d+)$/u.exec(blockId ?? '');
  if (!match) throw new Error(`visual-block-id-invalid:${blockId}`);
  await page
    .locator('.easymde-immersive-preview-canvas')
    .evaluate((canvas, index) => {
      const surface = canvas.querySelector('[data-easymde-prosemirror-host="1"]');
      const block = surface?.children[index];
      if (!(block instanceof HTMLElement)) {
        throw new Error(`visual-block-unavailable:${index}`);
      }
      const offset =
        block.getBoundingClientRect().top - canvas.getBoundingClientRect().top;
      canvas.scrollTop += offset - 12;
      canvas.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, Number(match[1]));
}

export async function openVisualImageMenu(page, image) {
  // The point is computed immediately before the click and never scrolls the
  // unified ProseMirror visual surface: an intervening scroll would dismiss an
  // open menu and move the image out from under the stored coordinates while
  // the click stays where it was.
  const point = await visualImagePoint(image);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toHaveCount(1);
  await expect(rootMenu(page)).toBeVisible();
  return point;
}

export async function openVisualMenu(
  page,
  visualEditor,
  element,
  select = true,
  selectedText = null
) {
  await prepareVisualTarget(visualEditor, element);
  await recordVisualInteractionDiagnostic(page, 'after-prepare', element);
  if ('function' === typeof select) await select();
  else if (select) await selectVisualElement(element);
  await recordVisualInteractionDiagnostic(page, 'after-select', element);
  if (selectedText) {
    const point = await visibleVisualSelectionPoint(visualEditor, selectedText);
    await recordVisualInteractionDiagnostic(page, 'before-right-click', element, point);
    await page.mouse.click(point.x, point.y, { button: 'right' });
  } else {
    const point = await visualElementCenterPoint(element);
    await recordVisualInteractionDiagnostic(page, 'before-right-click', element, point);
    await page.mouse.click(point.x, point.y, { button: 'right' });
  }
  await recordVisualInteractionDiagnostic(page, 'after-right-click', element);
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
}

export async function runVisualThematicBreakDelete(
  page,
  { expected, label, markdown, select, source, target, visualEditor }
) {
  const before = await waitForVisualPreviewAccepted(
    visualEditor,
    `${label}-before`
  );
  await startContextMenuDiagnostics(page, label);
  try {
    await openVisualMenu(
      page,
      visualEditor,
      target,
      select ?? (() => target.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNode(element);
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('visual-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
      }))
    );
  } catch (error) {
    const diagnostic = await readContextMenuDiagnostics(
      page,
      label,
      'open',
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
  await expectMenuItemState(page, 'delete-thematic-break', 'enabled');
  await rootItem(page, 'delete-thematic-break').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${label}-delete`);
  const after = await waitForVisualPreviewAccepted(
    visualEditor,
    `${label}-delete`,
    before.domHash
  );

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${label}-undo`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${label}-undo`,
    after.domHash
  );
}

export async function assertVisualCategory(page, visualEditor, category) {
  const categoryId = category.id;
  if (!categoryId) throw new Error('visual-category-id-missing');
  const targetMetadata = await readVisualTargetMetadata(category.target);
  await startContextMenuDiagnostics(page, categoryId, targetMetadata);
  let failedStep = null;
  let phase = 'source-before';
  try {
    if (category.source && category.markdown) {
      await assertSourceFixtureExact(
        category.source,
        category.markdown,
        categoryId,
        'before'
      );
    }
    const select = category.selectText
      ? () => selectVisualText(visualEditor, category.selectText, category.occurrence ?? 0)
      : category.collapsed
        ? () => placeVisualCaret(category.target)
        : () => selectVisualElement(category.target);
    phase = 'open';
    await ensureWindowedVisualTargetMounted(page, category.target, category.occurrence ?? 0);
    await openVisualMenu(
      page,
      visualEditor,
      category.target,
      select,
      category.selectText ?? null
    );
    phase = 'root-items';
    for (const [id, state] of Object.entries(category.items ?? {})) {
      failedStep = id;
      await expectMenuItemState(page, id, state);
    }
    if (category.submenu) {
      failedStep = category.submenu;
      phase = 'submenu';
      await openRootSubmenu(page, category.submenu);
      for (const [id, state] of Object.entries(category.children ?? {})) {
        failedStep = id;
        await expectMenuItemState(page, id, state);
      }
      if (category.nestedSubmenu) {
        failedStep = category.nestedSubmenu;
        phase = 'nested-submenu';
        await openVisibleSubmenu(page, category.nestedSubmenu);
        for (const [id, state] of Object.entries(category.nestedChildren ?? {})) {
          failedStep = id;
          await expectMenuItemState(page, id, state);
        }
        for (const id of category.nestedAbsent ?? []) {
          failedStep = id;
          await expect(anyMenuItem(page, id)).toHaveCount(0);
        }
      }
    }
    phase = 'close';
    await closeMenu(page, categoryId, {
      expectedSource: category.markdown ?? null,
      keepDiagnostics: true
    });
    phase = 'source-after';
    if (category.source && category.markdown) {
      await assertSourceFixtureExact(
        category.source,
        category.markdown,
        categoryId,
        'after'
      );
    }
  } catch (error) {
    let diagnostic = null;
    let diagnosticCode = null;
    if (page.isClosed()) {
      diagnosticCode = 'visual-context-menu-diagnostic-page-closed';
    } else {
      try {
        diagnostic = await readContextMenuDiagnostics(
          page,
          categoryId,
          phase,
          failedStep,
          [],
          { expectedSource: category.markdown ?? null }
        );
      } catch {
        diagnosticCode = 'visual-context-menu-diagnostic-read-failed';
      }
    }
    throw new Error(
      `editor-context-menu-visual-category-failed:${categoryId}\n` +
      `failureCode:${privacySafeFailureCode(error)}\n` +
      `[editor-context-menu-visual-diagnostic] ${JSON.stringify({ diagnostic, diagnosticCode })}`
    );
  } finally {
    if (!page.isClosed()) await stopContextMenuDiagnostics(page);
  }
}

function visualCategoryMatrix(visualEditor, occurrence = 'first') {
  const target = (selector, text = null) => () => {
    const base = visualEditor.locator(selector);
    const filtered = text ? base.filter({ hasText: text }) : base;
    return 'last' === occurrence ? filtered.last() : filtered.first();
  };
  return [
    {
      collapsed: true,
      id: 'body',
      items: { bold: 'disabled', copy: 'disabled', insert: 'enabled' },
      targetFactory: target('p', '普通文本')
    },
    {
      id: 'text',
      items: { bold: 'enabled', copy: 'enabled' },
      selectText: '普通文本',
      targetFactory: target('p', '普通文本')
    },
    {
      id: 'heading',
      items: { bold: 'enabled', copy: 'enabled' },
      selectText: '一级标题 Heading 1',
      targetFactory: target('h1')
    },
    {
      id: 'link',
      items: { 'copy-link-address': 'enabled' },
      targetFactory: target('a', 'OpenAI 官网')
    },
    {
      id: 'image',
      children: {
        'image-scale-25': 'enabled',
        'image-scale-33': 'enabled',
        'image-scale-50': 'enabled',
        'image-scale-67': 'enabled',
        'image-scale-100': 'enabled',
        'image-scale-150': 'enabled',
        'image-scale-200': 'enabled'
      },
      items: { 'delete-image': 'enabled' },
      submenu: 'image-scale',
      targetFactory: target(visualContentImageSelector)
    },
    {
      id: 'table',
      children: { 'copy-table': 'enabled', 'delete-table': 'enabled' },
      items: { table: 'enabled' },
      submenu: 'table',
      targetFactory: target('table')
    },
    {
      id: 'list',
      items: { insert: 'enabled' },
      selectText: '前端开发',
      targetFactory: target('ul')
    },
    {
      id: 'code',
      children: { 'copy-code-block': 'enabled', 'delete-code-block': 'enabled' },
      items: { 'code-block': 'enabled' },
      submenu: 'code-block',
      targetFactory: target('pre')
    },
    {
      id: 'math',
      items: { 'generated-content': 'enabled' },
      targetFactory: target('.easymde-math')
    },
    {
      id: 'mermaid',
      items: { 'generated-content': 'enabled' },
      targetFactory: target('.easymde-mermaid')
    }
  ];
}

export async function assertVisualCategoryMatrix(
  page,
  visualEditor,
  occurrence = 'first',
  source = null,
  markdown = null
) {
  for (const category of visualCategoryMatrix(visualEditor, occurrence)) {
    const { targetFactory, ...rest } = category;
    await assertVisualCategory(page, visualEditor, {
      ...rest,
      markdown,
      source,
      target: targetFactory()
    });
  }
}

export async function assertSourceCategoryMatrix(
  page,
  { fixtureImageUrl, markdown, source, sourceEditor }
) {
  const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;
  const categories = [
    {
      collapsed: true,
      id: 'body',
      items: { bold: 'disabled', copy: 'disabled', cut: 'disabled', insert: 'enabled' },
      rootCount: 6,
      value: '普通文本'
    },
    {
      id: 'text',
      items: { bold: 'enabled', copy: 'enabled', insert: 'enabled' },
      selectText: '普通文本'
    },
    {
      id: 'heading',
      items: { bold: 'enabled', copy: 'enabled', insert: 'enabled' },
      selectText: '一级标题 Heading 1'
    },
    {
      id: 'link',
      items: { 'copy-link-address': 'enabled' },
      selectText: '[OpenAI 官网](https://openai.com)'
    },
    {
      children: {
        'image-scale-25': 'enabled',
        'image-scale-33': 'enabled',
        'image-scale-50': 'enabled',
        'image-scale-67': 'enabled',
        'image-scale-100': 'enabled',
        'image-scale-150': 'enabled',
        'image-scale-200': 'enabled'
      },
      id: 'image',
      items: {
        'copy-image': 'enabled',
        'delete-image': 'enabled',
        'image-scale': 'enabled'
      },
      selectText: imageMarkdown,
      submenu: 'image-scale'
    },
    {
      children: { 'copy-table': 'enabled', 'delete-table': 'enabled' },
      id: 'table',
      items: { table: 'enabled' },
      selectText: 'Apple',
      submenu: 'table'
    },
    {
      id: 'list',
      items: { bold: 'enabled', copy: 'enabled', insert: 'enabled' },
      selectText: '前端开发'
    },
    {
      children: { 'copy-code-block': 'enabled', 'delete-code-block': 'enabled' },
      id: 'code',
      items: { 'code-block': 'enabled' },
      selectText: 'echo "Hello, Markdown!"',
      submenu: 'code-block'
    },
    {
      children: {
        'copy-generated': 'enabled',
        'delete-generated-content': 'enabled',
        'insert-paragraph-above-generated': 'enabled',
        'insert-paragraph-below-generated': 'enabled'
      },
      id: 'math',
      items: { 'generated-content': 'enabled' },
      nestedChildren: {
        'copy-generated-image': 'enabled',
        'copy-generated-mathml': 'enabled',
        'copy-generated-source': 'enabled'
      },
      nestedSubmenu: 'copy-generated',
      selectText: '\\int_a^b f(x)\\,dx = F(b) - F(a)',
      submenu: 'generated-content'
    },
    {
      children: {
        'copy-generated': 'enabled',
        'delete-generated-content': 'enabled',
        'insert-paragraph-above-generated': 'enabled',
        'insert-paragraph-below-generated': 'enabled'
      },
      id: 'mermaid',
      items: { 'generated-content': 'enabled' },
      nestedAbsent: ['copy-generated-mathml'],
      nestedChildren: {
        'copy-generated-image': 'enabled',
        'copy-generated-source': 'enabled'
      },
      nestedSubmenu: 'copy-generated',
      selectText: 'flowchart TD',
      submenu: 'generated-content'
    }
  ];

  for (const category of categories) {
    await assertSourceFixtureExact(source, markdown, category.id, 'before');
    if (category.collapsed) {
      await placeSourceCaret(page, sourceEditor, markdown, category.value);
    } else if (category.selectText) {
      await selectSourceText(page, sourceEditor, markdown, category.selectText);
    } else {
      throw new Error(`source-category-selection-missing:${category.id}`);
    }
    await startContextMenuDiagnostics(page, category.id);
    await openSourceMenuWithDiagnostics(page, sourceEditor, category.id, markdown);
    if (category.rootCount) {
      await expect(rootMenu(page).locator('[data-easymde-context-menu-item]'))
        .toHaveCount(category.rootCount);
    }
    for (const [id, state] of Object.entries(category.items ?? {})) {
      await expectMenuItemState(page, id, state);
    }
    if (category.submenu) {
      await openRootSubmenu(page, category.submenu);
      for (const [id, state] of Object.entries(category.children ?? {})) {
        await expectMenuItemState(page, id, state);
      }
      if (category.nestedSubmenu) {
        await openVisibleSubmenu(page, category.nestedSubmenu);
        for (const [id, state] of Object.entries(category.nestedChildren ?? {})) {
          await expectMenuItemState(page, id, state);
        }
        for (const id of category.nestedAbsent ?? []) {
          await expect(anyMenuItem(page, id)).toHaveCount(0);
        }
      }
    }
    await assertSourceFixtureExact(source, markdown, category.id, 'before-close');
    await closeMenu(page, category.id, { expectedSource: markdown });
    await assertSourceFixtureExact(source, markdown, category.id, 'after');
  }
}

export async function applySourceTableAlignment(
  page,
  { markdown, source, sourceEditor },
  selectionText,
  alignment,
  expected,
  { expandViewport = false } = {}
) {
  await selectSourceText(page, sourceEditor, markdown, selectionText);
  if (expandViewport) {
    await startContextMenuDiagnostics(page, 'table-alignment-window-expand');
  }
  try {
    if (expandViewport) await openSourceMenuWithDiagnostics(
      page,
      sourceEditor,
      'table-alignment-window-expand'
    );
    else await openSourceMenu(page, sourceEditor);
    if (expandViewport) await expandOpenTableMenuViewport(page);
    await openRootSubmenu(page, 'table');
    await openVisibleSubmenu(page, 'table-alignment');
    await expectMenuItemState(page, `align-${alignment}`, 'enabled');
    await anyMenuItem(page, `align-${alignment}`).last().click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(source).toHaveValue(expected);
  } finally {
    if (expandViewport && !page.isClosed()) await stopContextMenuDiagnostics(page);
  }
}
