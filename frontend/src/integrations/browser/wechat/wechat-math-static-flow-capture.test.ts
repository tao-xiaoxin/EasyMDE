import { describe, expect, it, vi } from 'vitest';

import { declaration } from './wechat-clipboard-test-fixtures';
import {
  createWechatMathStaticFlowSourceCapture,
  type WechatMathStaticFlowBaseRuntime
} from './wechat-math-static-flow-capture';
import {
  GEOMETRY_QUANTUM,
  applyWechatMathStaticFlow,
  collectWechatMathLiveTopology,
  evaluateWechatMathSourceAdmission,
  captureWechatMathStaticFlowSnapshot,
  planWechatMathStaticFlow,
  type WechatMathStaticFlowGate,
  type WechatMathStaticFlowRect,
  type WechatMathStaticFlowRuntime
} from './wechat-math-static-flow';

const SAFE_STYLE: Readonly<Record<string, string>> = {
  'animation-name': 'none',
  'backdrop-filter': 'none',
  'background-image': 'none',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-right-width': '0px',
  'border-top-width': '0px',
  'box-shadow': 'none',
  'box-sizing': 'content-box',
  clear: 'none',
  clip: 'auto',
  'clip-path': 'none',
  contain: 'none',
  'container-type': 'normal',
  'content-visibility': 'visible',
  display: 'block',
  filter: 'none',
  float: 'none',
  'inset-block-end': 'auto',
  'inset-block-start': 'auto',
  'inset-inline-end': 'auto',
  'inset-inline-start': 'auto',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'margin-right': '0px',
  'margin-top': '0px',
  mask: 'none',
  'mix-blend-mode': 'normal',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'padding-right': '0px',
  'padding-top': '0px',
  perspective: 'none',
  position: 'static',
  rotate: 'none',
  scale: 'none',
  transform: 'none',
  'transition-duration': '0s',
  translate: 'none',
  'will-change': 'auto',
  'writing-mode': 'horizontal-tb',
  'z-index': 'auto'
};

function rect(left: number, top: number, width: number, height: number): WechatMathStaticFlowRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width
  };
}

function createSvgFixture() {
  const sourceRoot = document.createElement('div');
  sourceRoot.className = 'katex-html';
  const table = document.createElement('span');
  table.className = 'vlist-t';
  const tableRow = document.createElement('span');
  tableRow.className = 'vlist-r';
  const group = document.createElement('span');
  group.className = 'vlist';
  const row = document.createElement('span');
  row.className = 'base';
  const pstrut = document.createElement('span');
  pstrut.className = 'pstrut';
  const holder = document.createElement('span');
  holder.className = 'svg-align';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;

  sourceRoot.append(table);
  table.append(tableRow);
  tableRow.append(group);
  group.append(row);
  holder.append(svg);
  row.append(pstrut, holder);

  const cloneRoot = sourceRoot.cloneNode(true) as HTMLElement;
  const identities = new Map<Element, Element>();
  const pair = (s: Element, c: Element): void => {
    identities.set(s, c);
    for (let i = 0; i < s.children.length; i += 1) {
      const sc = s.children[i];
      const cc = c.children[i];
      if (sc && cc) pair(sc, cc);
    }
  };
  pair(sourceRoot, cloneRoot);

  return {
    cloneRoot,
    group,
    holder,
    identities,
    pstrut,
    row,
    sourceRoot,
    svg,
    table,
    tableRow
  };
}

function svgRuntime(
  fixture: ReturnType<typeof createSvgFixture>,
  customSvgStyles?: Record<string, string>
): WechatMathStaticFlowBaseRuntime {
  return {
    getAnimations: () => [],
    getComputedStyle: (el, pseudo) => {
      if (pseudo) return declaration({ content: 'none' });
      if (el === fixture.group) return declaration({ ...SAFE_STYLE, display: 'table-cell', position: 'relative' });
      if (el === fixture.row) {
        return declaration({
          ...SAFE_STYLE,
          bottom: 'auto',
          display: 'block',
          height: '0px',
          left: 'auto',
          position: 'relative',
          right: 'auto',
          top: '-7px'
        });
      }
      if (el === fixture.pstrut) {
        return declaration({
          ...SAFE_STYLE,
          display: 'inline-block',
          height: '7px',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          width: '0px'
        });
      }
      if (el === fixture.holder) {
        return declaration({
          ...SAFE_STYLE,
          display: 'inline-block',
          height: '12px',
          position: 'static',
          'vertical-align': 'baseline',
          width: '12px'
        });
      }
      if (el === fixture.svg) {
        return declaration({
          ...SAFE_STYLE,
          bottom: 'auto',
          display: 'block',
          height: '12px',
          'inset-block-end': 'auto',
          'inset-block-start': 'auto',
          'inset-inline-end': 'auto',
          'inset-inline-start': 'auto',
          left: 'auto',
          position: 'absolute',
          right: 'auto',
          top: 'auto',
          width: '12px',
          ...customSvgStyles
        });
      }
      return declaration(SAFE_STYLE);
    }
  };
}

function setupSvgTypedOm(fixture: ReturnType<typeof createSvgFixture>): void {
  Object.defineProperty(fixture.row, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (prop: string) => {
        if (prop === 'top') return { unit: 'px', value: -7 };
        if (prop === 'height' || prop === 'block-size') return { unit: 'px', value: 0 };
        return { value: 'auto' };
      }
    })
  });
  Object.defineProperty(fixture.pstrut, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (prop: string) => (prop === 'height' ? { unit: 'px', value: 7 } : { value: 'auto' })
    })
  });
  Object.defineProperty(fixture.holder, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (prop: string) => {
        if (prop === 'width' || prop === 'inline-size') return { unit: 'px', value: 12 };
        if (prop === 'height' || prop === 'block-size') return { unit: 'px', value: 12 };
        return { value: 'auto' };
      }
    })
  });
  Object.defineProperty(fixture.svg, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (prop: string) => {
        if (prop === 'width' || prop === 'inline-size') return { unit: 'px', value: 12 };
        if (prop === 'height' || prop === 'block-size') return { unit: 'px', value: 12 };
        return { value: 'auto' };
      }
    })
  });
}

describe('wechat math static-flow source capture', () => {
  it('freezes captured values against subsequent live DOM and style mutations', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    row.style.setProperty('top', '-7px');
    root.append(row);

    let liveTop = '-7px';
    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: (el, pseudo) => {
        if (pseudo) return declaration({ content: 'none' });
        return declaration({
          display: 'block',
          height: '0px',
          position: 'relative',
          top: el === row ? liveTop : '0px'
        });
      }
    };

    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (prop: string) => (prop === 'top' ? { unit: 'px', value: -7 } : { value: 'auto' })
      })
    });

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root, undefined, rect(0, 0, 100, 100));
    capture.observe(row, undefined, rect(0, 20, 50, 0));

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    const fingerprintBefore = sealed.sourceFingerprint;

    // Mutate live DOM and live computed style return
    liveTop = '500px';
    row.style.setProperty('top', '500px');
    row.setAttribute('class', 'mutated-class');

    // Frozen capturedRuntime returns pre-mutation values
    expect(sealed.capturedRuntime.getComputedStyle(row).getPropertyValue('top')).toBe('-7px');
    expect(sealed.capturedRuntime.getRect(row)).toEqual({
      bottom: 20,
      height: 0,
      left: 0,
      right: 50,
      top: 20,
      width: 50
    });
    expect(sealed.sourceFingerprint).toBe(fingerprintBefore);
  });

  it('performs at most one Typed OM read per relevant element across observe and seal', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    let typedReads = 0;
    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => {
        typedReads += 1;
        return {
          get: (prop: string) => (prop === 'top' ? { unit: 'px', value: -7 } : { value: 'auto' })
        };
      }
    });

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block', top: '-7px' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root, undefined, rect(0, 0, 100, 100));
    capture.observe(row, undefined, rect(0, 10, 50, 0));

    expect(typedReads).toBe(1);

    // Repeated observe does not re-read
    capture.observe(row, undefined, rect(0, 10, 50, 0));
    expect(typedReads).toBe(1);

    // seal() does not re-read
    const sealed = capture.seal();
    expect(typedReads).toBe(1);
    expect(sealed).not.toBeNull();
  });

  it('fails explicitly when an unobserved node is queried on capturedRuntime', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const unobserved = document.createElement('span');

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root, undefined, rect(0, 0, 100, 100));
    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    expect(() => sealed.capturedRuntime.getComputedStyle(unobserved)).toThrowError(
      'wechat-math-static-flow-node-unobserved'
    );
    expect(() => sealed.capturedRuntime.getRect(unobserved)).toThrowError(
      'wechat-math-static-flow-node-unobserved'
    );
    expect(() => sealed.capturedRuntime.getTypedStyleMap(unobserved)).toThrowError(
      'wechat-math-static-flow-node-unobserved'
    );
  });

  it('reuses the sourceFingerprint across ordinary scroll offsets and invalidates on real relative changes', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block', top: '-7px' })
    };

    // Run 1: un-scrolled at (0, 0)
    const capture1 = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
    capture1.observe(root, undefined, rect(0, 0, 200, 200));
    capture1.observe(row, undefined, rect(10, 20, 50, 0));
    const sealed1 = capture1.seal();
    if (!sealed1) throw new Error('seal failed');

    // Run 2: page scrolled down by 500px (both root and row shift by 500px)
    const capture2 = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
    capture2.observe(root, undefined, rect(0, 500, 200, 200));
    capture2.observe(row, undefined, rect(10, 520, 50, 0));
    const sealed2 = capture2.seal();
    if (!sealed2) throw new Error('seal failed');

    // Relative geometry is identical -> fingerprint reused!
    expect(sealed2.sourceFingerprint).toBe(sealed1.sourceFingerprint);

    // Run 3: real relative shift (row shifted by 5px relative to root)
    const capture3 = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
    capture3.observe(root, undefined, rect(0, 0, 200, 200));
    capture3.observe(row, undefined, rect(10, 25, 50, 0));
    const sealed3 = capture3.seal();
    if (!sealed3) throw new Error('seal failed');

    expect(sealed3.sourceFingerprint).not.toBe(sealed1.sourceFingerprint);
  });

  // 1P2: Uniform fractional translation must not leak double-subtraction noise into the fingerprint.
  it('canonicalizes root-relative subtraction noise under uniform fractional translation', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block', top: '-7px' })
    };

    const runCapture = (rootRect: WechatMathStaticFlowRect, rowRect: WechatMathStaticFlowRect) => {
      const capture = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
      capture.observe(root, undefined, rootRect);
      capture.observe(row, undefined, rowRect);
      const sealed = capture.seal();
      if (!sealed) throw new Error('seal failed');
      return sealed;
    };

    // Raw double subtraction is origin dependent: 110.2 - 100.1 = 10.100000000000009
    // while 610.2 - 600.1 = 10.100000000000023, and 120.3 - 100.1 differs from
    // 620.3 - 600.1 the same way.
    const atHundred = runCapture(rect(100.1, 100.1, 200, 200), rect(110.2, 120.3, 50, 0));
    const atSixHundred = runCapture(rect(600.1, 600.1, 200, 200), rect(610.2, 620.3, 50, 0));

    // capturedRuntime.getRect() preserves the exact raw viewport geometry:
    expect(atHundred.capturedRuntime.getRect(row).left).toBe(110.2);
    expect(atHundred.capturedRuntime.getRect(row).top).toBe(120.3);
    expect(atSixHundred.capturedRuntime.getRect(row).left).toBe(610.2);
    expect(atSixHundred.capturedRuntime.getRect(row).top).toBe(620.3);

    // But the serialized cache fingerprint normalizes low-bit noise and matches:
    expect(atSixHundred.sourceFingerprint).toBe(atHundred.sourceFingerprint);
  });

  it('invalidates sourceFingerprint on TypedOM or style mutations at equal used geometry', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    let transform = 'none';
    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block', top: '-7px', transform })
    };

    const runCapture = (): string => {
      const capture = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
      capture.observe(root, undefined, rect(0, 0, 100, 100));
      capture.observe(row, undefined, rect(0, 10, 50, 0));
      const sealed = capture.seal();
      if (!sealed) throw new Error('seal failed');
      return sealed.sourceFingerprint;
    };

    const baseline = runCapture();

    // Mutate computed style property at identical geometry
    transform = 'scale(1.1)';
    const withStyleMutation = runCapture();
    expect(withStyleMutation).not.toBe(baseline);

    transform = 'none';

    // Mutate Typed OM token at identical geometry
    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (prop: string) => (prop === 'top' ? { unit: 'px', value: -14 } : { value: 'auto' })
      })
    });
    const withTypedMutation = runCapture();
    expect(withTypedMutation).not.toBe(baseline);
  });

  it('performs zero R1 reads when disabled (ON path)', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    const pseudoSpy = vi.fn();
    const typedSpy = vi.fn();
    const animSpy = vi.fn();

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => {
        animSpy();
        return [];
      },
      getComputedStyle: (_el, pseudo) => {
        if (pseudo) pseudoSpy();
        return declaration({ display: 'block' });
      }
    };

    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => {
        typedSpy();
        return { get: () => ({ value: 'auto' }) };
      }
    });

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: false,
      runtime,
      sourceRoot: root
    });

    capture.observe(root);
    capture.observe(row);

    expect(pseudoSpy).toHaveBeenCalledTimes(0);
    expect(typedSpy).toHaveBeenCalledTimes(0);
    expect(animSpy).toHaveBeenCalledTimes(0);

    const sealed = capture.seal();
    expect(sealed).toBeNull();
  });

  it('feeds sealed capturedRuntime directly to the math static-flow snapshot and apply pipeline', () => {
    const sourceRoot = document.createElement('div');
    sourceRoot.className = 'katex-html';
    const table = document.createElement('span');
    table.className = 'vlist-t';
    const tableRow = document.createElement('span');
    tableRow.className = 'vlist-r';
    const group = document.createElement('span');
    group.className = 'vlist';
    const row = document.createElement('span');
    row.className = 'base';
    const pstrut = document.createElement('span');
    pstrut.className = 'pstrut';
    const mord = document.createElement('span');
    mord.className = 'mord';
    mord.textContent = 'x';

    sourceRoot.append(table);
    table.append(tableRow);
    tableRow.append(group);
    group.append(row);
    row.append(pstrut, mord);

    const cloneRoot = sourceRoot.cloneNode(true) as HTMLElement;
    const identities = new Map<Element, Element>();
    const pair = (s: Element, c: Element): void => {
      identities.set(s, c);
      for (let i = 0; i < s.children.length; i += 1) {
        const sc = s.children[i];
        const cc = c.children[i];
        if (sc && cc) pair(sc, cc);
      }
    };
    pair(sourceRoot, cloneRoot);

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: (el, pseudo) => {
        if (pseudo) return declaration({ content: 'none' });
        if (el === group) return declaration({ ...SAFE_STYLE, display: 'table-cell', position: 'relative' });
        if (el === row) return declaration({ ...SAFE_STYLE, bottom: 'auto', display: 'block', height: '0px', left: 'auto', position: 'relative', right: 'auto', top: '-7px' });
        if (el === pstrut) return declaration({ ...SAFE_STYLE, display: 'inline-block', height: '5px', width: '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
        return declaration(SAFE_STYLE);
      }
    };

    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (prop: string) => {
          if (prop === 'top') return { unit: 'px', value: -7 };
          if (prop === 'height' || prop === 'block-size') return { unit: 'px', value: 0 };
          return { value: 'auto' };
        }
      })
    });
    Object.defineProperty(pstrut, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (prop: string) => (prop === 'height' ? { unit: 'px', value: 5 } : { value: 'auto' })
      })
    });

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot
    });

    [sourceRoot, table, tableRow, group, row, pstrut, mord].forEach((el) => {
      const height = el === pstrut ? 5 : el === row ? 0 : 20;
      capture.observe(el, undefined, rect(0, 0, 50, height));
    });

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    const gate: WechatMathStaticFlowGate = {
      isCancelled: () => false,
      isCurrent: () => true
    };

    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => identities.get(s) ?? null,
      cloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live-sig',
      rawDimensionGeometrySignature: 'raw-sig',
      runtime: sealed.capturedRuntime,
      sourceRoot
    });

    const plan = planWechatMathStaticFlow(snapshot, { gate });
    expect(plan.rejectedGroups).toEqual([]);
    expect(plan.rowTransitions).toHaveLength(1);

    applyWechatMathStaticFlow(plan, { gate });

    const cloneRow = identities.get(row);
    expect(cloneRow?.getAttribute('style')).toContain('position:static!important');
    expect(cloneRow?.getAttribute('style')).toContain('margin-top:-7px!important');
    expect(cloneRow?.getAttribute('style')).toContain('margin-bottom:7px!important');
  });

  // 1P1: Direct full sealed SVG fixture test (1 row + 1 SVG) through plan and apply
  it('admits a full sealed SVG fixture (1 row + 1 SVG) and applies SVG and row static flow cleanly', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture);

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ].forEach((el) => {
      const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
      const width = el === fixture.pstrut ? 0 : 12;
      capture.observe(el, undefined, rect(0, 0, width, height));
    });

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    const gate: WechatMathStaticFlowGate = {
      isCancelled: () => false,
      isCurrent: () => true
    };

    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
      cloneRoot: fixture.cloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live-sig',
      rawDimensionGeometrySignature: 'raw-sig',
      runtime: sealed.capturedRuntime,
      sourceRoot: fixture.sourceRoot
    });

    const plan = planWechatMathStaticFlow(snapshot, { gate });
    expect(plan.rejectedGroups).toEqual([]);
    expect(plan.svgTransitions).toHaveLength(1);
    expect(plan.rowTransitions).toHaveLength(1);

    applyWechatMathStaticFlow(plan, { gate });

    const cloneSvg = fixture.identities.get(fixture.svg);
    const cloneRow = fixture.identities.get(fixture.row);

    expect(cloneSvg?.getAttribute('style')).toContain('position:static!important');
    expect(cloneSvg?.getAttribute('style')).toContain('top:auto!important');
    expect(cloneSvg?.getAttribute('style')).toContain('inset-block-start:auto!important');
    expect(cloneSvg?.getAttribute('style')).toContain('inset-inline-start:auto!important');

    expect(cloneRow?.getAttribute('style')).toContain('position:static!important');
    expect(cloneRow?.getAttribute('style')).toContain('margin-top:-7px!important');
    expect(cloneRow?.getAttribute('style')).toContain('margin-bottom:7px!important');
  });

  it('rejects an SVG whose logical insets are not auto with svg-inset reason', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture, { 'inset-block-start': '10px' });

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ].forEach((el) => {
      const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
      const width = el === fixture.pstrut ? 0 : 12;
      capture.observe(el, undefined, rect(0, 0, width, height));
    });

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    const gate: WechatMathStaticFlowGate = {
      isCancelled: () => false,
      isCurrent: () => true
    };

    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
      cloneRoot: fixture.cloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live-sig',
      rawDimensionGeometrySignature: 'raw-sig',
      runtime: sealed.capturedRuntime,
      sourceRoot: fixture.sourceRoot
    });

    const plan = planWechatMathStaticFlow(snapshot, { gate });
    expect(plan.rejectedGroups).toHaveLength(1);
    expect(plan.rejectedGroups[0]?.reason).toBe('svg-inset');
    expect(plan.svgTransitions).toHaveLength(0);
  });

  // 2P1: Exact canonical offsets around the planner's 1/64 px admission quantum.
  it('preserves planner admission across the 1/64 px quantum boundary with exact canonical offsets', () => {
    const runForOffset = (svgTopOffset: number) => {
      const fixture = createSvgFixture();
      setupSvgTypedOm(fixture);
      const runtime = svgRuntime(fixture);

      const capture = createWechatMathStaticFlowSourceCapture({
        enabled: true,
        runtime,
        sourceRoot: fixture.sourceRoot
      });

      [
        fixture.sourceRoot,
        fixture.table,
        fixture.tableRow,
        fixture.group,
        fixture.row,
        fixture.pstrut,
        fixture.holder
      ].forEach((el) => {
        const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
        const width = el === fixture.pstrut ? 0 : 12;
        capture.observe(el, undefined, rect(0, 0, width, height));
      });

      // SVG has top offset
      capture.observe(fixture.svg, undefined, rect(0, svgTopOffset, 12, 12));

      const sealed = capture.seal();
      if (!sealed) throw new Error('seal failed');

      const gate: WechatMathStaticFlowGate = {
        isCancelled: () => false,
        isCurrent: () => true
      };

      const snapshot = captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
        cloneRoot: fixture.cloneRoot,
        gate,
        liveSourceAdmissionSignature: 'live-sig',
        rawDimensionGeometrySignature: 'raw-sig',
        runtime: sealed.capturedRuntime,
        sourceRoot: fixture.sourceRoot
      });

      const plan = planWechatMathStaticFlow(snapshot, { gate });
      return { plan, relativeSvgTop: sealed.capturedRuntime.getRect(fixture.svg).top, sealed };
    };

    const cases = [
      { admitted: true, label: 'quantum minus 1e-4', offset: GEOMETRY_QUANTUM - 1e-4 },
      { admitted: true, label: 'fixture endpoint 0.0156', offset: 0.0156 },
      { admitted: true, label: 'exact quantum', offset: GEOMETRY_QUANTUM },
      { admitted: false, label: 'fixture endpoint 0.0157', offset: 0.0157 },
      { admitted: false, label: 'quantum plus 1e-4', offset: GEOMETRY_QUANTUM + 1e-4 }
    ] as const;
    const fingerprints = new Set<string>();

    for (const entry of cases) {
      const result = runForOffset(entry.offset);

      // Canonicalization keeps each offset exact and every fingerprint distinct.
      expect(result.relativeSvgTop, entry.label).toBe(entry.offset);
      expect(fingerprints.has(result.sealed.sourceFingerprint), entry.label).toBe(false);
      fingerprints.add(result.sealed.sourceFingerprint);

      if (entry.admitted) {
        expect(result.plan.rejectedGroups, entry.label).toEqual([]);
        expect(result.plan.svgTransitions, entry.label).toHaveLength(1);
      } else {
        expect(result.plan.rejectedGroups, entry.label).toHaveLength(1);
        expect(result.plan.rejectedGroups[0]?.reason, entry.label).toBe('svg-geometry');
        expect(result.plan.svgTransitions, entry.label).toHaveLength(0);
      }
    }
  });

  // 3P1: Authoritative animation reader required, explicit error throwing, and immutable frozen targets
  it('throws wechat-math-static-flow-animation-reader-missing when getAnimations is not a function', () => {
    const root = document.createElement('div');
    const runtime = {
      getComputedStyle: () => declaration({ display: 'block' })
    } as unknown as WechatMathStaticFlowBaseRuntime;

    expect(() =>
      createWechatMathStaticFlowSourceCapture({
        enabled: true,
        runtime,
        sourceRoot: root
      })
    ).toThrowError('wechat-math-static-flow-animation-reader-missing');
  });

  it('throws wechat-math-static-flow-animation-read-failed when getAnimations throws', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => {
        throw new Error('animation permission denied');
      },
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    expect(() => capture.observe(root)).toThrowError('wechat-math-static-flow-animation-read-failed');
  });

  it('throws wechat-math-static-flow-animation-read-failed when reading animation effect or target throws', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const throwingAnim = {
      get effect() {
        throw new Error('effect access denied');
      }
    } as unknown as Animation;

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [throwingAnim],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    expect(() => capture.observe(root)).toThrowError('wechat-math-static-flow-animation-read-failed');
  });

  it('throws wechat-math-static-flow-typed-om-read-failed when computedStyleMap throws', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => {
        throw new Error('computedStyleMap failed');
      }
    });

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root);
    expect(() => capture.observe(row)).toThrowError('wechat-math-static-flow-typed-om-read-failed');
  });

  it('throws wechat-math-static-flow-typed-om-read-failed when styleMap.get throws', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: () => {
          throw new Error('styleMap.get failed');
        }
      })
    });

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root);
    expect(() => capture.observe(row)).toThrowError('wechat-math-static-flow-typed-om-read-failed');
  });

  it('freezes animation targets so subsequent mutation of live Animation target does not alter captured runtime', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';
    root.append(row);

    const liveAnim = {
      effect: {
        target: null as Element | null
      }
    };

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [liveAnim as unknown as Animation],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root);
    capture.observe(row);
    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    // Mutate live animation target after seal
    liveAnim.effect.target = row;

    // The captured runtime's animations remain frozen with original target: null
    const capturedAnims = sealed.capturedRuntime.getAnimations();
    expect((capturedAnims[0]?.effect as KeyframeEffect | null)?.target).toBeNull();
    // And assigning to the frozen object throws in strict mode
    expect(() => {
      // @ts-expect-error mutating frozen object
      capturedAnims[0].effect.target = row;
    }).toThrow();
  });

  // 4P2: Reject post-seal observe, repeated seal idempotency, and immutable backing set
  it('rejects post-seal observe and updateCoordinateEpoch, returns identical sealed instance, and exposes immutable observedElements', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const row = document.createElement('span');
    row.className = 'base';

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    capture.observe(root);
    const sealed1 = capture.seal();
    if (!sealed1) throw new Error('seal failed');

    // Post-seal observe throws
    expect(() => capture.observe(row)).toThrowError('wechat-math-static-flow-observe-after-seal');

    // Post-seal updateCoordinateEpoch throws
    expect(() => capture.updateCoordinateEpoch()).toThrowError('wechat-math-static-flow-observe-after-seal');

    // Repeated seal returns the exact same object reference
    const sealed2 = capture.seal();
    expect(sealed2).toBe(sealed1);

    // observedElements is a frozen read-only set; mutation attempts throw
    expect(() => {
      // @ts-expect-error mutating read-only set
      sealed1.observedElements.add(row);
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error mutating read-only set
      sealed1.observedElements.delete(root);
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error mutating read-only set
      sealed1.observedElements.clear();
    }).toThrow(TypeError);

    expect(sealed1.observedElements.has(root)).toBe(true);
    expect(sealed1.observedElements.has(row)).toBe(false);
  });

  // 5P2: Preserves consistent relative coordinates across yielding page scroll via updateCoordinateEpoch
  it('preserves consistent relative coordinates across yielding page scroll via updateCoordinateEpoch', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const holder = document.createElement('span');
    holder.className = 'svg-align';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    holder.append(svg);
    root.append(holder);

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    // Slice 1: root is at viewport top: 100, holder is at viewport top: 120
    capture.observe(root, undefined, rect(50, 100, 200, 100));
    capture.observe(holder, undefined, rect(50, 120, 20, 20));

    // Yield occurs: page scrolls down by 100px.
    // In viewport coords, root is at 200, holder and SVG are at top: 220
    holder.getBoundingClientRect = () => ({
      bottom: 240,
      height: 20,
      left: 50,
      right: 70,
      top: 220,
      width: 20,
      x: 50,
      y: 220,
      toJSON: () => {}
    });
    capture.updateCoordinateEpoch(rect(50, 200, 200, 100));

    // Slice 2: observe SVG at viewport top: 220; co-samples holder once at epoch 1
    capture.observe(svg, undefined, rect(50, 220, 20, 20));

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    // Both holder and SVG share the co-sampled epoch 1 viewport top: 220
    expect(sealed.capturedRuntime.getRect(holder).top).toBe(220);
    expect(sealed.capturedRuntime.getRect(svg).top).toBe(220);
    expect(sealed.capturedRuntime.getRect(svg).left).toBe(50);
    expect(sealed.capturedRuntime.getRect(holder).left).toBe(50);
  });

  // 1P2 continuation: a fractional page yield between slices keeps one canonical origin.
  it('keeps canonical relative coordinates when a fractional scroll yields between slices', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const holder = document.createElement('span');
    holder.className = 'svg-align';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    holder.append(svg);
    root.append(holder);

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const runCapture = (resumedRootTop: number, resumedSvgTop: number) => {
      const capture = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
      capture.observe(root, undefined, rect(50, 100, 200, 100));
      capture.observe(holder, undefined, rect(50, 120.3, 20, 20));
      // The serializer yields mid-walk; resumed root is at resumedRootTop
      holder.getBoundingClientRect = () => ({
        bottom: resumedSvgTop + 20,
        height: 20,
        left: 50,
        right: 70,
        top: resumedSvgTop,
        width: 20,
        x: 50,
        y: resumedSvgTop,
        toJSON: () => {}
      });
      capture.updateCoordinateEpoch(rect(50, resumedRootTop, 200, 100));
      capture.observe(svg, undefined, rect(50, resumedSvgTop, 20, 20));
      const sealed = capture.seal();
      if (!sealed) throw new Error('seal failed');
      return sealed;
    };

    const first = runCapture(200.1, 220.4);
    const second = runCapture(600.1, 620.4);

    expect(first.capturedRuntime.getRect(holder).top).toBe(220.4);
    expect(first.capturedRuntime.getRect(svg).top).toBe(220.4);
    expect(second.capturedRuntime.getRect(holder).top).toBe(620.4);
    expect(second.capturedRuntime.getRect(svg).top).toBe(620.4);
    expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
  });

  // 6P2: Enabled seal requires the observed root and freezes the animation snapshot before sealing.
  it('requires an observed root before seal and never reads live animations from the sealed runtime', () => {
    const root = document.createElement('div');
    root.className = 'katex-html';
    const outside = document.createElement('p');

    const liveAnimations: Animation[] = [];
    const animationSpy = vi.fn(() => liveAnimations as readonly Animation[]);
    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: animationSpy,
      getComputedStyle: () => declaration({ display: 'block' })
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: root
    });

    // A non-relevant node must not trigger the animation read.
    capture.observe(outside, undefined, rect(0, 0, 10, 10));
    expect(animationSpy).toHaveBeenCalledTimes(0);

    // Sealing without the observed root fails explicitly and leaves the capture open.
    expect(() => capture.seal()).toThrowError('wechat-math-static-flow-root-unobserved');
    expect(animationSpy).toHaveBeenCalledTimes(0);

    // The mandatory root observation performs the single capture-time animation read.
    const liveAnim = { effect: { target: outside as Element | null } };
    liveAnimations.push(liveAnim as unknown as Animation);
    capture.observe(root, undefined, rect(0, 0, 100, 100));
    expect(animationSpy).toHaveBeenCalledTimes(1);

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');
    expect(animationSpy).toHaveBeenCalledTimes(1);

    // Live mutation after the capture read cannot alter the already captured descriptors.
    liveAnim.effect.target = root;

    const capturedAnimations = sealed.capturedRuntime.getAnimations();
    expect(sealed.capturedRuntime.getAnimations()).toBe(capturedAnimations);
    expect(Object.isFrozen(capturedAnimations)).toBe(true);
    expect((capturedAnimations[0]?.effect as KeyframeEffect | null)?.target).toBe(outside);
    expect(animationSpy).toHaveBeenCalledTimes(1);
  });

  // 7P1: Direct vs captured parity across Q ± 1e-10, Q ± 1e-7, Q + 4.9e-7, and compound offsets
  it('guarantees direct vs captured planner parity and distinct fingerprints at threshold boundaries', () => {
    const runPair = (svgLeftOffset: number, holderLeftOffset = 0) => {
      const fixture = createSvgFixture();
      setupSvgTypedOm(fixture);
      const baseRuntime = svgRuntime(fixture);

      // Direct runtime using live viewport coordinates
      const directRuntime: WechatMathStaticFlowBaseRuntime = {
        getAnimations: baseRuntime.getAnimations,
        getComputedStyle: baseRuntime.getComputedStyle
      };

      const capture = createWechatMathStaticFlowSourceCapture({
        enabled: true,
        runtime: directRuntime,
        sourceRoot: fixture.sourceRoot
      });

      const elements = [
        fixture.sourceRoot,
        fixture.table,
        fixture.tableRow,
        fixture.group,
        fixture.row,
        fixture.pstrut
      ];
      elements.forEach((el) => {
        const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
        const width = el === fixture.pstrut ? 0 : 12;
        capture.observe(el, undefined, rect(0, 0, width, height));
      });

      capture.observe(fixture.holder, undefined, rect(holderLeftOffset, 0, 12, 12));
      capture.observe(fixture.svg, undefined, rect(holderLeftOffset + svgLeftOffset, 0, 12, 12));

      const sealed = capture.seal();
      if (!sealed) throw new Error('seal failed');

      const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };

      // 1. Direct snapshot (evaluated independently using original runtime, not capturedRuntime)
      const liveRects = new Map<Element, WechatMathStaticFlowRect>([
        [fixture.sourceRoot, rect(0, 0, 100, 100)],
        [fixture.table, rect(0, 0, 0, 12)],
        [fixture.tableRow, rect(0, 0, 0, 12)],
        [fixture.group, rect(0, 0, 0, 12)],
        [fixture.row, rect(0, 0, 0, 0)],
        [fixture.pstrut, rect(0, 0, 0, 7)],
        [fixture.holder, rect(holderLeftOffset, 0, 12, 12)],
        [fixture.svg, rect(holderLeftOffset + svgLeftOffset, 0, 12, 12)]
      ]);

      const originalRuntime: WechatMathStaticFlowRuntime = {
        getAnimations: () => [],
        getComputedStyle: baseRuntime.getComputedStyle,
        getRect: (el) => liveRects.get(el) ?? rect(0, 0, 0, 0),
        getTypedStyleMap: (el) => {
          const factory = (el as Element & { computedStyleMap?: () => { get: (p: string) => unknown } }).computedStyleMap;
          return factory ? factory.call(el) : { get: () => ({ value: 'auto' }) };
        }
      };

      const directSnapshot = captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
        cloneRoot: fixture.cloneRoot,
        gate,
        liveSourceAdmissionSignature: 'live-sig',
        rawDimensionGeometrySignature: 'raw-sig',
        runtime: originalRuntime,
        sourceRoot: fixture.sourceRoot
      });
      const directPlan = planWechatMathStaticFlow(directSnapshot, { gate });

      // 2. Bound snapshot (using sealed.sourceAdmission without reevaluation)
      const boundSnapshot = captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
        cloneRoot: fixture.cloneRoot,
        gate,
        liveSourceAdmissionSignature: 'live-sig',
        rawDimensionGeometrySignature: 'raw-sig',
        runtime: sealed.capturedRuntime,
        sourceAdmission: sealed.sourceAdmission,
        sourceRoot: fixture.sourceRoot
      });
      const boundPlan = planWechatMathStaticFlow(boundSnapshot, { gate });

      return { boundPlan, directPlan, sealed };
    };

    const Q = GEOMETRY_QUANTUM;
    const testCases = [
      { admitted: true, holderLeft: 0, label: 'Q - 1e-7', offset: Q - 1e-7 },
      { admitted: true, holderLeft: 0, label: 'Q - 1e-10', offset: Q - 1e-10 },
      { admitted: true, holderLeft: 0, label: 'exact Q', offset: Q },
      { admitted: false, holderLeft: 0, label: 'Q + 1e-10', offset: Q + 1e-10 },
      { admitted: false, holderLeft: 0, label: 'Q + 1e-7', offset: Q + 1e-7 },
      { admitted: false, holderLeft: 0, label: 'Q + 4.9e-7', offset: Q + 4.9e-7 },
      { admitted: false, holderLeft: 5.1e-7, label: 'compound holder 5.1e-7 + Q + 9.8e-7', offset: Q + 9.8e-7 }
    ] as const;

    const fingerprintsByLabel = new Map<string, string>();

    for (const tc of testCases) {
      const { boundPlan, directPlan, sealed } = runPair(tc.offset, tc.holderLeft);

      // Parity between direct and bound plans is 100% exact:
      expect(boundPlan.rejectedGroups.map((g) => g.reason), `${tc.label} parity: rejected`).toEqual(
        directPlan.rejectedGroups.map((g) => g.reason)
      );
      expect(boundPlan.svgTransitions.length, `${tc.label} parity: svg count`).toBe(
        directPlan.svgTransitions.length
      );

      if (tc.admitted) {
        expect(boundPlan.rejectedGroups, `${tc.label} admitted`).toEqual([]);
        expect(boundPlan.svgTransitions, `${tc.label} admitted`).toHaveLength(1);
        expect(sealed.witness.groups[0]?.reason, `${tc.label} witness reason`).toBeNull();
      } else {
        expect(boundPlan.rejectedGroups, `${tc.label} rejected`).toHaveLength(1);
        expect(boundPlan.rejectedGroups[0]?.reason, `${tc.label} rejected`).toBe('svg-geometry');
        expect(boundPlan.svgTransitions, `${tc.label} rejected`).toHaveLength(0);
        expect(sealed.witness.groups[0]?.reason, `${tc.label} witness reason`).toBe('svg-geometry');
      }

      fingerprintsByLabel.set(tc.label, sealed.sourceFingerprint);
    }

    // Critical invariant: Q - 1e-7 and Q + 1e-7 MUST have different fingerprints!
    expect(fingerprintsByLabel.get('Q - 1e-7')).not.toBe(fingerprintsByLabel.get('Q + 1e-7'));
  });

  // 8P1: Witness membership records exact group reasons, row tops, and SVG relations
  it('seals with an immutable admission witness recording groups, rows, and SVG relations', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture);

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ].forEach((el) => {
      const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
      const width = el === fixture.pstrut ? 0 : 12;
      capture.observe(el, undefined, rect(0, 0, width, height));
    });

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    const witness = sealed.witness;
    expect(witness.version).toBe(1);
    expect(witness.orderedObserved.length).toBe(8);
    expect(witness.groups).toHaveLength(1);
    expect(witness.groups[0]?.reason).toBeNull();
    expect(witness.rows).toHaveLength(1);
    expect(witness.rows[0]?.rawTop).toBe('-7px');
    expect(witness.rows[0]?.top).toBe(-7);
    expect(witness.svg).toHaveLength(1);
    expect(witness.svg[0]?.svg).toContain('svg');
    expect(witness.svg[0]?.holder).toContain('svg-align');
  });

  // 9P1: Clone binding performs zero source DOM or style re-reads
  it('binds sealed source admission to clone tree without re-reading source geometry or styles', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture);

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ].forEach((el) => {
      const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
      const width = el === fixture.pstrut ? 0 : 12;
      capture.observe(el, undefined, rect(0, 0, width, height));
    });

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    // Instrument capturedRuntime with spies to verify zero re-reads during clone binding
    const styleSpy = vi.fn(sealed.capturedRuntime.getComputedStyle);
    const rectSpy = vi.fn(sealed.capturedRuntime.getRect);
    const animSpy = vi.fn(sealed.capturedRuntime.getAnimations);
    const typedSpy = vi.fn(sealed.capturedRuntime.getTypedStyleMap);

    const spiedRuntime: WechatMathStaticFlowRuntime = {
      getAnimations: animSpy,
      getComputedStyle: styleSpy,
      getRect: rectSpy,
      getTypedStyleMap: typedSpy
    };

    const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };

    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
      cloneRoot: fixture.cloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live-sig',
      rawDimensionGeometrySignature: 'raw-sig',
      runtime: spiedRuntime,
      sourceAdmission: sealed.sourceAdmission,
      sourceRoot: fixture.sourceRoot
    });

    expect(styleSpy).toHaveBeenCalledTimes(0);
    expect(rectSpy).toHaveBeenCalledTimes(0);
    expect(animSpy).toHaveBeenCalledTimes(0);
    expect(typedSpy).toHaveBeenCalledTimes(0);

    const plan = planWechatMathStaticFlow(snapshot, { gate });
    expect(plan.rejectedGroups).toEqual([]);
    expect(plan.svgTransitions).toHaveLength(1);
    expect(plan.rowTransitions).toHaveLength(1);

    applyWechatMathStaticFlow(plan, { gate });
    const cloneRow = fixture.identities.get(fixture.row);
    expect(cloneRow?.getAttribute('style')).toContain('margin-top:-7px!important');
  });

  // 10P1: Section clone root compatibility for normalizeStructure without plan rebuild
  it('supports section clone root when source root is div/article/blockquote', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture);

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ].forEach((el) => {
      const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
      const width = el === fixture.pstrut ? 0 : 12;
      capture.observe(el, undefined, rect(0, 0, width, height));
    });

    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    // Simulate normalizeStructure replacing div cloneRoot with section
    const sectionCloneRoot = document.createElement('section');
    for (const child of Array.from(fixture.cloneRoot.children)) {
      sectionCloneRoot.append(child);
    }
    const sectionIdentities = new Map(fixture.identities);
    sectionIdentities.set(fixture.sourceRoot, sectionCloneRoot);

    const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };

    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => sectionIdentities.get(s) ?? null,
      cloneRoot: sectionCloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live-sig',
      rawDimensionGeometrySignature: 'raw-sig',
      runtime: sealed.capturedRuntime,
      sourceAdmission: sealed.sourceAdmission,
      sourceRoot: fixture.sourceRoot
    });

    expect(snapshot.cloneRoot).toBe(sectionCloneRoot);
    const plan = planWechatMathStaticFlow(snapshot, { gate });
    expect(plan.cloneRoot).toBe(sectionCloneRoot);

    // Apply with finalized section root
    applyWechatMathStaticFlow(plan, { cloneRoot: sectionCloneRoot, gate });
    const cloneRow = sectionIdentities.get(fixture.row);
    expect(cloneRow?.getAttribute('style')).toContain('margin-top:-7px!important');
  });

  // 11P1: Raw large origin / Q ± ε parity
  it('preserves exact raw parity at large negative root origin across Q ± 1e-12', () => {
    const runForEpsilon = (eps: number) => {
      const fixture = createSvgFixture();
      setupSvgTypedOm(fixture);
      const baseRuntime = svgRuntime(fixture);

      const capture = createWechatMathStaticFlowSourceCapture({
        enabled: true,
        runtime: baseRuntime,
        sourceRoot: fixture.sourceRoot
      });

      const rootTop = -100000;
      const holderTop = 128.1;
      const svgTop = 128.1 + GEOMETRY_QUANTUM + eps;

      capture.observe(fixture.sourceRoot, undefined, rect(0, rootTop, 100, 100));
      capture.observe(fixture.table, undefined, rect(0, holderTop, 50, 50));
      capture.observe(fixture.tableRow, undefined, rect(0, holderTop, 50, 50));
      capture.observe(fixture.group, undefined, rect(0, holderTop, 50, 50));
      capture.observe(fixture.row, undefined, rect(0, holderTop, 50, 0));
      capture.observe(fixture.pstrut, undefined, rect(0, holderTop, 0, 7));
      capture.observe(fixture.holder, undefined, rect(0, holderTop, 12, 12));
      capture.observe(fixture.svg, undefined, rect(0, svgTop, 12, 12));

      const sealed = capture.seal();
      if (!sealed) throw new Error('seal failed');

      const liveRects = new Map<Element, WechatMathStaticFlowRect>([
        [fixture.sourceRoot, rect(0, rootTop, 100, 100)],
        [fixture.table, rect(0, holderTop, 50, 50)],
        [fixture.tableRow, rect(0, holderTop, 50, 50)],
        [fixture.group, rect(0, holderTop, 50, 50)],
        [fixture.row, rect(0, holderTop, 50, 0)],
        [fixture.pstrut, rect(0, holderTop, 0, 7)],
        [fixture.holder, rect(0, holderTop, 12, 12)],
        [fixture.svg, rect(0, svgTop, 12, 12)]
      ]);

      const directRuntime: WechatMathStaticFlowRuntime = {
        getAnimations: () => [],
        getComputedStyle: baseRuntime.getComputedStyle,
        getRect: (el) => liveRects.get(el) ?? rect(0, 0, 0, 0),
        getTypedStyleMap: (el) => {
          const factory = (el as Element & { computedStyleMap?: () => { get: (p: string) => unknown } }).computedStyleMap;
          return factory ? factory.call(el) : { get: () => ({ value: 'auto' }) };
        }
      };

      const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };

      const directSnapshot = captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
        cloneRoot: fixture.cloneRoot,
        gate,
        liveSourceAdmissionSignature: 'live',
        rawDimensionGeometrySignature: 'raw',
        runtime: directRuntime,
        sourceRoot: fixture.sourceRoot
      });
      const directPlan = planWechatMathStaticFlow(directSnapshot, { gate });

      const boundSnapshot = captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
        cloneRoot: fixture.cloneRoot,
        gate,
        liveSourceAdmissionSignature: 'live',
        rawDimensionGeometrySignature: 'raw',
        runtime: sealed.capturedRuntime,
        sourceAdmission: sealed.sourceAdmission,
        sourceRoot: fixture.sourceRoot
      });
      const boundPlan = planWechatMathStaticFlow(boundSnapshot, { gate });

      return { boundPlan, directPlan };
    };

    // +1e-12: raw delta exceeds Q -> both direct and captured reject with svg-geometry
    const plus = runForEpsilon(1e-12);
    expect(plus.directPlan.rejectedGroups[0]?.reason).toBe('svg-geometry');
    expect(plus.boundPlan.rejectedGroups[0]?.reason).toBe('svg-geometry');

    // -1e-12: raw delta within Q -> both direct and captured admit
    const minus = runForEpsilon(-1e-12);
    expect(minus.directPlan.rejectedGroups).toHaveLength(0);
    expect(minus.boundPlan.rejectedGroups).toHaveLength(0);
    expect(minus.boundPlan.svgTransitions).toHaveLength(1);
  });

  // 12P1: Split pair yield with co-sampling and zero seal/bind source getters
  it('co-samples holder across yield and performs zero live source DOM reads during seal and bind', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture);

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    // Epoch 0: observe root through holder
    capture.observe(fixture.sourceRoot, undefined, rect(50, 100, 200, 100));
    capture.observe(fixture.table, undefined, rect(50, 120, 50, 50));
    capture.observe(fixture.tableRow, undefined, rect(50, 120, 50, 50));
    capture.observe(fixture.group, undefined, rect(50, 120, 50, 50));
    capture.observe(fixture.row, undefined, rect(50, 120, 50, 0));
    capture.observe(fixture.pstrut, undefined, rect(50, 120, 0, 7));
    capture.observe(fixture.holder, undefined, rect(50, 120, 12, 12));

    // Yield occurs: epoch increments to 1. Holder live rect shifts to top 220
    let holderLiveReads = 0;
    fixture.holder.getBoundingClientRect = () => {
      holderLiveReads += 1;
      return {
        bottom: 232,
        height: 12,
        left: 50,
        right: 62,
        top: 220,
        width: 12,
        x: 50,
        y: 220,
        toJSON: () => {}
      };
    };
    capture.updateCoordinateEpoch(rect(50, 200, 200, 100));

    // Observe SVG at epoch 1: co-samples holder exactly once!
    capture.observe(fixture.svg, undefined, rect(50, 220, 12, 12));
    expect(holderLiveReads).toBe(1);

    // Trap all DOM reads on source elements
    const sourceElements = [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ];

    const forbiddenCalls: string[] = [];
    sourceElements.forEach((el) => {
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
        forbiddenCalls.push(`getBoundingClientRect on ${el.localName}`);
        return rect(0, 0, 0, 0) as DOMRect;
      });
      vi.spyOn(el, 'querySelectorAll').mockImplementation(() => {
        forbiddenCalls.push(`querySelectorAll on ${el.localName}`);
        return [] as unknown as NodeListOf<Element>;
      });
    });

    // seal() must perform zero live source DOM reads!
    const sealed = capture.seal();
    expect(forbiddenCalls).toHaveLength(0);
    expect(holderLiveReads).toBe(1);
    if (!sealed) throw new Error('seal failed');

    // bind must perform zero live source DOM reads!
    const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };
    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
      cloneRoot: fixture.cloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live',
      rawDimensionGeometrySignature: 'raw',
      runtime: sealed.capturedRuntime,
      sourceAdmission: sealed.sourceAdmission,
      sourceRoot: fixture.sourceRoot
    });
    expect(forbiddenCalls).toHaveLength(0);

    const plan = planWechatMathStaticFlow(snapshot, { gate });
    expect(plan.rejectedGroups).toHaveLength(0);
    expect(plan.svgTransitions).toHaveLength(1);
  });

  // 13P1: Trapped live DOM mutations after observe cannot affect sealed result or plan
  it('protects sealed evaluation against subsequent live DOM reparenting, class, child, and text mutations', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const runtime = svgRuntime(fixture);

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: fixture.sourceRoot
    });

    [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ].forEach((el) => {
      const height = el === fixture.pstrut ? 7 : el === fixture.row ? 0 : 12;
      const width = el === fixture.pstrut ? 0 : 12;
      capture.observe(el, undefined, rect(0, 0, width, height));
    });

    // Mutate live DOM in malicious/concurrent ways after observe:
    // 1. Mutate classes
    fixture.tableRow.className = 'mutated-vlist-r';
    fixture.group.className = 'mutated-vlist';
    // 2. Reparent/remove row
    fixture.row.remove();
    // 3. Add extra child to holder
    fixture.holder.append(document.createElement('span'));
    // 4. Add non-empty text node to holder
    fixture.holder.append(document.createTextNode('trailing text'));

    // seal() must evaluate from frozen topology and succeed!
    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    expect(sealed.witness.groups).toHaveLength(1);
    expect(sealed.witness.groups[0]?.reason).toBeNull();
    expect(sealed.witness.rows).toHaveLength(1);
    expect(sealed.witness.svg).toHaveLength(1);
  });

  it('binds from frozen source keys and pairing metadata after every source getter is poisoned', () => {
    const fixture = createSvgFixture();
    setupSvgTypedOm(fixture);
    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime: svgRuntime(fixture),
      sourceRoot: fixture.sourceRoot
    });
    const sourceElements = [
      fixture.sourceRoot,
      fixture.table,
      fixture.tableRow,
      fixture.group,
      fixture.row,
      fixture.pstrut,
      fixture.holder,
      fixture.svg
    ];
    sourceElements.forEach((element) => {
      capture.observe(element, undefined, rect(0, 0, element === fixture.pstrut ? 0 : 12, element === fixture.row ? 0 : 12));
    });
    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');

    const poison = (element: Element, property: string): void => {
      Object.defineProperty(element, property, {
        configurable: true,
        get: () => {
          throw new Error(`poisoned-source-${property}`);
        }
      });
    };
    sourceElements.forEach((element) => {
      ['children', 'childNodes', 'className', 'classList', 'localName', 'namespaceURI', 'parentElement'].forEach((property) => {
        poison(element, property);
      });
      poison(element, 'getBoundingClientRect');
      poison(element, 'contains');
      poison(element, 'querySelectorAll');
    });

    const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };
    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (source) => fixture.identities.get(source) ?? null,
      cloneRoot: fixture.cloneRoot,
      gate,
      liveSourceAdmissionSignature: 'live',
      rawDimensionGeometrySignature: 'raw',
      runtime: sealed.capturedRuntime,
      sourceAdmission: sealed.sourceAdmission,
      sourceRoot: fixture.sourceRoot
    });
    const plan = planWechatMathStaticFlow(snapshot, { gate });

    expect(plan.rejectedGroups).toHaveLength(0);
    expect(plan.svgTransitions).toHaveLength(1);
    expect(sealed.witness.groups[0]?.source).toContain('vlist');
  });

  it('fails capture explicitly when omitted fixed or pseudo descendants would bypass safety admission', () => {
    const run = (kind: 'fixed' | 'pseudo'): void => {
      const fixture = createSvgFixture();
      setupSvgTypedOm(fixture);
      const omitted = document.createElement('span');
      omitted.className = 'mord';
      fixture.row.append(omitted);
      const cloneRow = fixture.cloneRoot.querySelector('.base');
      if (!(cloneRow instanceof HTMLElement)) throw new Error('clone row missing');
      const omittedClone = document.createElement('span');
      omittedClone.className = 'mord';
      cloneRow.append(omittedClone);
      fixture.identities.set(omitted, omittedClone);
      const baseRuntime = svgRuntime(fixture);
      const runtime: WechatMathStaticFlowBaseRuntime = {
        getAnimations: baseRuntime.getAnimations,
        getComputedStyle: (element, pseudoElement) => {
          if (element === omitted && !pseudoElement && kind === 'fixed') {
            return declaration({ ...SAFE_STYLE, position: 'fixed' });
          }
          if (element === omitted && pseudoElement === '::before' && kind === 'pseudo') {
            return declaration({ content: '"generated"', position: 'static' });
          }
          return baseRuntime.getComputedStyle(element, pseudoElement);
        }
      };
      const direct = evaluateWechatMathSourceAdmission(fixture.sourceRoot, {
        getAnimations: runtime.getAnimations,
        getComputedStyle: runtime.getComputedStyle,
        getRect: () => rect(0, 0, 12, 12),
        getTypedStyleMap: (element) => ({
          get: (property: string) => {
            const styleMap = (element as Element & { computedStyleMap?: () => { get: (name: string) => unknown } }).computedStyleMap?.();
            return styleMap?.get(property) ?? { value: 'auto' };
          }
        })
      });
      expect(direct.groups.some((group) => group.reason === (kind === 'fixed' ? 'absolute-containing-block' : 'row-pseudo'))).toBe(true);

      const capture = createWechatMathStaticFlowSourceCapture({
        enabled: true,
        runtime,
        sourceRoot: fixture.sourceRoot
      });
      [
        fixture.sourceRoot,
        fixture.table,
        fixture.tableRow,
        fixture.group,
        fixture.row,
        fixture.pstrut,
        fixture.holder,
        fixture.svg
      ].forEach((element) => {
        capture.observe(element, undefined, rect(0, 0, element === fixture.pstrut ? 0 : 12, element === fixture.row ? 0 : 12));
      });
      expect(() => capture.seal()).toThrowError('wechat-math-static-flow-node-unobserved');
    };

    run('fixed');
    run('pseudo');
  });

  it('indexes nested KaTeX groups once with flat getNode operation counts', () => {
    const build = (levels: number): { elements: readonly Element[]; root: HTMLElement; count: number } => {
      const root = document.createElement('div');
      root.className = 'katex-html';
      let parent: Element = root;
      const all: Element[] = [root];
      for (let level = 0; level < levels; level += 1) {
        const table = document.createElement('span');
        table.className = 'vlist-t';
        const tableRow = document.createElement('span');
        tableRow.className = 'vlist-r';
        const group = document.createElement('span');
        group.className = 'vlist';
        const row = document.createElement('span');
        row.className = 'base';
        const pstrut = document.createElement('span');
        pstrut.className = 'pstrut';
        table.append(tableRow);
        tableRow.append(group);
        group.append(row);
        row.append(pstrut);
        parent.append(table);
        parent = row;
        all.push(table, tableRow, group, row, pstrut);
        Object.defineProperty(row, 'computedStyleMap', {
          configurable: true,
          value: () => ({
            get: (property: string) => {
              if (property === 'top') return { unit: 'px', value: -7 };
              if (property === 'height' || property === 'block-size') return { unit: 'px', value: 0 };
              return { value: 'auto' };
            }
          })
        });
        Object.defineProperty(pstrut, 'computedStyleMap', {
          configurable: true,
          value: () => ({
            get: (property: string) => (property === 'height' ? { unit: 'px', value: 7 } : { value: 'auto' })
          })
        });
      }
      return { count: all.length, elements: Object.freeze(all), root };
    };

    for (const levels of [20, 40, 80, 160]) {
      const { count, elements, root } = build(levels);
      const runtime: WechatMathStaticFlowRuntime = {
        getAnimations: () => [],
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({ content: 'none' });
          if (element.classList.contains('vlist')) return declaration({ ...SAFE_STYLE, display: 'table-cell', position: 'relative' });
          if (element.classList.contains('base')) return declaration({ ...SAFE_STYLE, bottom: 'auto', display: 'block', height: '0px', left: 'auto', position: 'relative', right: 'auto', top: '-7px' });
          if (element.classList.contains('pstrut')) return declaration({ ...SAFE_STYLE, display: 'inline-block', height: '7px', width: '0px' });
          return declaration(SAFE_STYLE);
        },
        getRect: () => rect(0, 0, 10, 10),
        getTypedStyleMap: (element) => ({
          get: (property: string) => {
            const styleMap = (element as Element & { computedStyleMap?: () => { get: (name: string) => unknown } }).computedStyleMap?.();
            return styleMap?.get(property) ?? { value: 'auto' };
          }
        })
      };
      const topology = collectWechatMathLiveTopology(root, runtime);
      let getNodeCalls = 0;
      const countedContext = {
        ...topology,
        getNode: (element: Element) => {
          getNodeCalls += 1;
          return topology.getNode(element);
        }
      };
      const admission = evaluateWechatMathSourceAdmission(countedContext);
      expect(admission.groups.filter((group) => group.reason === null)).toHaveLength(levels);
      expect(getNodeCalls).toBe(count);

      const cloneRoot = root.cloneNode(true) as HTMLElement;
      const identities = new Map<Element, Element>();
      const pair = (source: Element, clone: Element): void => {
        identities.set(source, clone);
        const sourceChildren = Array.from(source.children);
        const cloneChildren = Array.from(clone.children);
        if (sourceChildren.length !== cloneChildren.length) throw new Error('nested-pair-count');
        sourceChildren.forEach((sourceChild, index) => {
          const cloneChild = cloneChildren[index];
          if (!cloneChild) throw new Error('nested-pair-missing');
          pair(sourceChild, cloneChild);
        });
      };
      pair(root, cloneRoot);
      const capture = createWechatMathStaticFlowSourceCapture({ enabled: true, runtime, sourceRoot: root });
      elements.forEach((element) => {
        capture.observe(element, undefined, rect(0, 0, element.classList.contains('pstrut') ? 0 : 10, element.classList.contains('base') ? 0 : 10));
      });
      const sealed = capture.seal();
      if (!sealed) throw new Error('nested seal failed');
      let sourceNodeGets = 0;
      let topologyReads = 0;
      const countedSourceNodes = new Map(sealed.sourceAdmission.sourceNodes);
      const sourceNodeGet = countedSourceNodes.get.bind(countedSourceNodes);
      Object.defineProperty(countedSourceNodes, 'get', {
        configurable: true,
        value: (element: Element) => {
          sourceNodeGets += 1;
          return sourceNodeGet(element);
        }
      });
      const countedTopology = {
        ...sealed.sourceAdmission.topology,
        getNode: (element: Element) => {
          topologyReads += 1;
          return sealed.sourceAdmission.topology.getNode(element);
        }
      };
      const countedAdmission = {
        ...sealed.sourceAdmission,
        sourceNodes: countedSourceNodes,
        topology: countedTopology
      };
      const gate: WechatMathStaticFlowGate = { isCancelled: () => false, isCurrent: () => true };
      const snapshot = captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (source) => identities.get(source) ?? null,
        cloneRoot,
        gate,
        liveSourceAdmissionSignature: 'nested-live',
        rawDimensionGeometrySignature: 'nested-raw',
        runtime: sealed.capturedRuntime,
        sourceAdmission: countedAdmission,
        sourceRoot: root
      });
      expect(snapshot.groups).toHaveLength(levels);
      expect(topologyReads).toBe(0);
      expect(sourceNodeGets).toBeLessThan(count * 20);
    }
  });

  // 14P2: Flat 100-row 1304-node execution in linear time without quadratic rescans
  it('evaluates flat 100-row 1304-node math tree in linear time without quadratic subtree rescans', () => {
    const sourceRoot = document.createElement('div');
    sourceRoot.className = 'katex-html';
    const table = document.createElement('span');
    table.className = 'vlist-t';
    const tableRow = document.createElement('span');
    tableRow.className = 'vlist-r';
    const group = document.createElement('span');
    group.className = 'vlist';

    sourceRoot.append(table);
    table.append(tableRow);
    tableRow.append(group);

    const totalRows = 100;
    const allElements: Element[] = [sourceRoot, table, tableRow, group];

    for (let r = 0; r < totalRows; r += 1) {
      const row = document.createElement('span');
      row.className = 'base';
      const pstrut = document.createElement('span');
      pstrut.className = 'pstrut';
      row.append(pstrut);
      allElements.push(row, pstrut);

      // Add child spans to reach 1304 total elements
      const extraCount = 11;
      for (let c = 0; c < extraCount; c += 1) {
        const span = document.createElement('span');
        span.className = 'mord';
        row.append(span);
        allElements.push(span);
      }
      group.append(row);
    }
    expect(allElements.length).toBe(1304);

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: (el, pseudo) => {
        if (pseudo) return declaration({ content: 'none' });
        if (el === group) return declaration({ ...SAFE_STYLE, display: 'table-cell', position: 'relative' });
        if (el.classList.contains('base')) {
          return declaration({ ...SAFE_STYLE, bottom: 'auto', display: 'block', height: '0px', left: 'auto', position: 'relative', right: 'auto', top: '-7px' });
        }
        if (el.classList.contains('pstrut')) {
          return declaration({ ...SAFE_STYLE, display: 'inline-block', height: '7px', width: '0px' });
        }
        return declaration(SAFE_STYLE);
      }
    };

    allElements.forEach((el) => {
      if (el.classList.contains('base')) {
        Object.defineProperty(el, 'computedStyleMap', {
          configurable: true,
          value: () => ({
            get: (prop: string) => {
              if (prop === 'top') return { unit: 'px', value: -7 };
              if (prop === 'height' || prop === 'block-size') return { unit: 'px', value: 0 };
              return { value: 'auto' };
            }
          })
        });
      } else if (el.classList.contains('pstrut')) {
        Object.defineProperty(el, 'computedStyleMap', {
          configurable: true,
          value: () => ({
            get: (prop: string) => (prop === 'height' ? { unit: 'px', value: 7 } : { value: 'auto' })
          })
        });
      }
    });

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot
    });

    const start = performance.now();
    allElements.forEach((el) => {
      const height = el.classList.contains('pstrut') ? 7 : 0;
      capture.observe(el, undefined, rect(0, 0, 10, height));
    });

    const sealed = capture.seal();
    const duration = performance.now() - start;

    if (!sealed) throw new Error('seal failed');
    expect(sealed.witness.rows).toHaveLength(totalRows);
    expect(duration).toBeLessThan(1000); // Confirms linear execution well under quadratic timeout
  });

  // 15P1: External ancestry captured at observe time
  it('captures external ancestry above root at observe time so parent detachment does not invalidate group layout', () => {
    const parent = document.createElement('span');
    parent.className = 'vlist-r';
    const grandparent = document.createElement('span');
    grandparent.className = 'vlist-t';
    grandparent.append(parent);

    const group = document.createElement('span');
    group.className = 'vlist';
    parent.append(group);

    const row = document.createElement('span');
    row.className = 'base';
    const pstrut = document.createElement('span');
    pstrut.className = 'pstrut';
    row.append(pstrut);
    group.append(row);

    Object.defineProperty(row, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (prop: string) => {
          if (prop === 'top') return { unit: 'px', value: -7 };
          if (prop === 'height' || prop === 'block-size') return { unit: 'px', value: 0 };
          return { value: 'auto' };
        }
      })
    });
    Object.defineProperty(pstrut, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (prop: string) => (prop === 'height' ? { unit: 'px', value: 7 } : { value: 'auto' })
      })
    });

    const runtime: WechatMathStaticFlowBaseRuntime = {
      getAnimations: () => [],
      getComputedStyle: (el, pseudo) => {
        if (pseudo) return declaration({ content: 'none' });
        if (el === group) return declaration({ ...SAFE_STYLE, display: 'table-cell', position: 'relative' });
        if (el === row) return declaration({ ...SAFE_STYLE, bottom: 'auto', display: 'block', height: '0px', left: 'auto', position: 'relative', right: 'auto', top: '-7px' });
        if (el === pstrut) return declaration({ ...SAFE_STYLE, display: 'inline-block', height: '7px', width: '0px' });
        return declaration(SAFE_STYLE);
      }
    };

    const capture = createWechatMathStaticFlowSourceCapture({
      enabled: true,
      runtime,
      sourceRoot: group
    });

    capture.observe(group, undefined, rect(0, 0, 50, 50));
    capture.observe(row, undefined, rect(0, 0, 50, 0));
    capture.observe(pstrut, undefined, rect(0, 0, 0, 7));

    // Detach parent from grandparent after observe
    parent.remove();

    // Sealed admission still evaluates group successfully because external ancestry was frozen
    const sealed = capture.seal();
    if (!sealed) throw new Error('seal failed');
    expect(sealed.witness.groups).toHaveLength(1);
    expect(sealed.witness.groups[0]?.reason).toBeNull();
  });
});
