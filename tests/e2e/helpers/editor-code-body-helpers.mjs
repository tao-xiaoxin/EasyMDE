import { expect } from '@playwright/test';

export const startNativeDeleteTargetRangeProbe = async (page) => {
  const key = '__easymdeNativeDeleteTargetRangeProbe';
  await page.evaluate((probeKey) => {
    if (window[probeKey]) throw new Error('native-delete-target-range-probe-already-active');
    const events = [];
    const record = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        'beforeinput' !== event.type
        || 'string' !== typeof event.inputType
        || !event.inputType.startsWith('delete')
        || !target?.closest('.easymde-immersive-visual-editor')
      ) return;
      const ranges = 'function' === typeof event.getTargetRanges
        ? Array.from(event.getTargetRanges())
        : null;
      events.push({
        targetRangeCount: ranges?.length ?? null,
        targetRangesCollapsed: ranges?.length
          ? ranges.every((range) => range.collapsed)
          : null
      });
    };
    document.addEventListener('beforeinput', record, true);
    window[probeKey] = {
      dispose: () => document.removeEventListener('beforeinput', record, true),
      events
    };
  }, key);
  return {
    dispose: () => page.evaluate((probeKey) => {
      const probe = window[probeKey];
      if (!probe) return;
      probe.dispose();
      delete window[probeKey];
    }, key),
    read: () => page.evaluate((probeKey) => (
      window[probeKey]?.events ?? []
    ), key)
  };
};

export const summarizeNativeDeleteTargetRanges = (events) => ({
  beforeInputCount: events.length,
  targetRangeCount: events.reduce((count, event) => (
    count + (event.targetRangeCount ?? 0)
  ), 0),
  targetRangesCollapsed: events.map((event) => event.targetRangesCollapsed)
});

export const readCodeBodyState = (visualEditor) => visualEditor.evaluate((surface) => {
  const pre = surface.querySelector('pre');
  const code = pre?.querySelector(':scope > code');
  if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
    throw new Error('immersive-code-body-state-unavailable');
  }
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchor = selection?.anchorNode ?? null;
  let codeOffset = null;
  if (selection && anchor && (anchor === code || code.contains(anchor))) {
    const range = surface.ownerDocument.createRange();
    range.selectNodeContents(code);
    range.setEnd(anchor, selection.anchorOffset);
    codeOffset = range.toString().length;
  }
  const style = getComputedStyle(surface);
  return {
    active: surface.ownerDocument.activeElement === surface,
    codeText: code.textContent,
    frame: {
      codeWidth: code.getBoundingClientRect().width,
      contentWidth: surface.clientWidth
        - Number.parseFloat(style.paddingLeft)
        - Number.parseFloat(style.paddingRight),
      preWidth: pre.getBoundingClientRect().width
    },
    selection: selection ? {
      anchorInsideCode: anchor === code || Boolean(
        anchor && code.contains(anchor)
      ),
      anchorName: anchor?.nodeName ?? null,
      anchorOffset: selection.anchorOffset,
      collapsed: selection.isCollapsed,
      codeOffset
    } : null
  };
});

export const expectCodeBodyFrame = (state) => {
  expect(Math.abs(state.frame.preWidth - state.frame.contentWidth))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(state.frame.codeWidth - state.frame.contentWidth))
    .toBeLessThanOrEqual(1);
};

export const expectCodeBodyCaret = (state, offset) => {
  expect(state.active).toBe(true);
  expect(state.selection?.collapsed).toBe(true);
  expect(state.selection?.anchorInsideCode).toBe(true);
  expect(state.selection?.anchorName).toBe('#text');
  expect(state.selection?.anchorOffset).toBe(offset);
};

export const clickCodeLine = async (page, code, lineIndex) => {
  const box = await code.boundingBox();
  if (!box) throw new Error('immersive-code-body-box-unavailable');
  const metrics = await code.evaluate((element) => {
    const style = getComputedStyle(element);
    const pixels = (value) => Number.parseFloat(value);
    const lineHeight = pixels(style.lineHeight);
    if (!Number.isFinite(lineHeight)) {
      throw new Error('immersive-code-body-line-height-unavailable');
    }
    return {
      borderBottom: pixels(style.borderBottomWidth),
      borderTop: pixels(style.borderTopWidth),
      lineHeight,
      paddingBottom: pixels(style.paddingBottom),
      paddingTop: pixels(style.paddingTop)
    };
  });
  const textTop = metrics.borderTop + metrics.paddingTop;
  const textBottom = box.height - metrics.borderBottom - metrics.paddingBottom;
  const y = Math.min(
    textTop + metrics.lineHeight * (lineIndex + 0.5),
    textBottom - 1
  );
  await page.mouse.click(box.x + 8, box.y + y);
  const afterClick = await code.evaluate((element, point) => {
    const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
    const selection = element.ownerDocument.defaultView?.getSelection();
    const anchor = selection?.anchorNode ?? null;
    let codeOffset = null;
    if (selection && anchor && (anchor === element || element.contains(anchor))) {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      range.setEnd(anchor, selection.anchorOffset);
      codeOffset = range.toString().length;
    }
    const lineRects = [];
    const walker = element.ownerDocument.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT
    );
    let documentOffset = 0;
    let node = walker.nextNode();
    while (node) {
      if (node instanceof Text) {
        for (let offset = 0; offset <= node.length; offset += 1) {
          const range = element.ownerDocument.createRange();
          range.setStart(node, offset);
          range.collapse(true);
          const rect = range.getBoundingClientRect();
          lineRects.push({
            documentOffset: documentOffset + offset,
            rect: {
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              top: rect.top
            }
          });
        }
        documentOffset += node.length;
      }
      node = walker.nextNode();
    }
    const style = getComputedStyle(element);
    return {
      codeText: element.textContent ?? '',
      hit: {
        insideCode: Boolean(hit && (hit === element || element.contains(hit))),
        className: hit instanceof Element ? hit.className : '',
        nodeName: hit?.nodeName ?? null
      },
      lineRects,
      selection: selection ? {
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection.anchorOffset,
        codeOffset,
        collapsed: selection.isCollapsed
      } : null,
      styles: {
        borderBottom: style.borderBottomWidth,
        borderTop: style.borderTopWidth,
        height: style.height,
        lineHeight: style.lineHeight,
        paddingBottom: style.paddingBottom,
        paddingTop: style.paddingTop,
        whiteSpace: style.whiteSpace
      }
    };
  }, { x: box.x + 8, y: box.y + y });
  return {
    box,
    click: { x: box.x + 8, y: box.y + y, localY: y },
    metrics,
    afterClick
  };
};

export const startContinuousBackspaceProbe = async (
  visualEditor,
  fence,
  finalBackspaceSequence = 2
) => {
  const key = '__easymdeOpenFenceContinuousBackspace';
  await visualEditor.evaluate((surface, { traceKey, marker, targetSequence }) => {
    if (window[traceKey]) throw new Error('continuous-backspace-probe-already-active');
    const events = [];
    const samples = [];
    let sequence = 0;
    const snapshot = () => {
      const code = surface.querySelector('pre > code');
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const source = document.querySelector('#easymde-source');
      const markdown = source instanceof HTMLTextAreaElement ? source.value : '';
      return {
        codeCount: surface.querySelectorAll('pre > code').length,
        preCount: surface.querySelectorAll('pre').length,
        selection: selection ? {
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideCode: Boolean(code && anchor && code.contains(anchor)),
          collapsed: selection.isCollapsed
        } : null,
        sourceFenceLineCount: markdown.split(/\r?\n/u).filter((line) => line === marker).length,
        sourceLength: markdown.length
      };
    };
    const record = (event) => {
      if ('keydown' === event.type) {
        if ('Backspace' !== event.key) return;
        sequence += 1;
      } else if (
        !['beforeinput', 'input'].includes(event.type)
        || 'deleteContentBackward' !== event.inputType
      ) {
        return;
      }
      events.push({
        defaultPrevented: event.defaultPrevented,
        inputType: event.inputType ?? null,
        key: 'keydown' === event.type ? event.key : null,
        phase: event.type,
        repeat: 'keydown' === event.type ? event.repeat : null,
        sequence
      });
      if ('keydown' !== event.type || targetSequence !== sequence) return;
      let frame = 0;
      const sample = () => {
        samples.push({ frame: ++frame, state: snapshot() });
        if (frame < 8) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      setTimeout(() => samples.push({ frame: '80ms', state: snapshot() }), 80);
      setTimeout(() => samples.push({ frame: '250ms', state: snapshot() }), 250);
    };
    for (const type of ['keydown', 'beforeinput', 'input']) {
      surface.addEventListener(type, record, true);
    }
    window[traceKey] = {
      dispose: () => {
        for (const type of ['keydown', 'beforeinput', 'input']) {
          surface.removeEventListener(type, record, true);
        }
      },
      events,
      samples,
      snapshot
    };
  }, { traceKey: key, marker: fence, targetSequence: finalBackspaceSequence });

  return {
    immediate: () => visualEditor.evaluate((surface, traceKey) => {
      const trace = window[traceKey];
      if (!trace) throw new Error('continuous-backspace-probe-missing');
      return trace.snapshot();
    }, key),
    finish: () => visualEditor.evaluate((surface, traceKey) => {
      const trace = window[traceKey];
      if (!trace) throw new Error('continuous-backspace-probe-missing');
      trace.dispose();
      delete window[traceKey];
      return { events: trace.events, final: trace.snapshot(), samples: trace.samples };
    }, key)
  };
};

export const completeHeldBackspaceSequence = async (page, probe, count) => {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.down('Backspace');
  }
  await page.keyboard.up('Backspace');
  const immediate = await probe.immediate();
  await page.waitForTimeout(300);
  return { immediate, trace: await probe.finish() };
};

export const expectHeldBackspaceCompletion = ({
  backspaceCount,
  failureCodes,
  finalSource,
  immediate,
  pageErrors,
  sourceBeforeFence,
  trace
}) => {
  const backspaces = trace.events.filter(({ phase, key }) => (
    'keydown' === phase && 'Backspace' === key
  ));
  expect(backspaces).toHaveLength(backspaceCount);
  expect(backspaces.map(({ repeat }) => repeat))
    .toEqual(Array.from({ length: backspaceCount }, (_, index) => 0 !== index));
  expect(trace.samples.filter(({ frame }) => Number.isInteger(frame))
    .map(({ frame }) => frame).sort((left, right) => left - right))
    .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(trace.samples.filter(({ frame }) => '80ms' === frame)).toHaveLength(1);
  expect(trace.samples.filter(({ frame }) => '250ms' === frame)).toHaveLength(1);
  expect(immediate).toMatchObject({ codeCount: 0, preCount: 0 });
  expect(trace.samples.every(({ state }) => (
    0 === state.codeCount && 0 === state.preCount
  ))).toBe(true);
  expect(trace.final).toMatchObject({ codeCount: 0, preCount: 0 });
  expect(finalSource).toBe(sourceBeforeFence);
  expect(failureCodes).toEqual([]);
  expect(pageErrors).toEqual([]);
};
