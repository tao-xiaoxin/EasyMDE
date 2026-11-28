import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const phycatSkyCss = readFileSync(
  resolve(process.cwd(), 'assets/themes/article/phycat-sky.css'),
  'utf8'
);

import {
  declaration,
  declaredStylePixels,
  declaredStyleValue
} from './wechat-clipboard-test-fixtures';
import {
  TASK_LIST_CHECKBOX_CLONES,
  TASK_LIST_CHECKBOX_PSEUDO_CLONES
} from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime, SerializationYield } from './wechat-clipboard-runtime';
import {
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
  type TaskCheckboxCaptionOwnerIdentity
} from './wechat-task-caption';
import type { TaskCheckboxGeometryLease } from './wechat-task-geometry';
import { taskCheckboxStaticPaintExpectationFor } from './wechat-task-paint';
import type { WechatPngConversionContext } from './wechat-png-conversion-policy';
import {
  assertTaskCheckboxStaticFlowAllocations,
  normalizeTaskCheckboxStaticFlow,
  normalizeTaskCheckboxStaticFlowSynchronously
} from './wechat-task-static-flow';

// The direct cases below drive the owner module itself, so they own the
// projected declaration of every recorded layer instead of the Clipboard path.
const DIRECT_OWNER_PROJECTION = [
  'appearance:none',
  'border-bottom-width:0px',
  'border-left-width:0px',
  'border-right-width:0px',
  'border-top-width:0px',
  'box-sizing:border-box',
  'display:inline-block',
  'height:20px',
  'left:-22px',
  'padding-bottom:0px',
  'padding-left:0px',
  'padding-right:0px',
  'padding-top:0px',
  'position:absolute',
  'top:3px',
  'width:20px'
].join(';');

type DirectStaticFlowOwner = Readonly<{
  layoutInput: HTMLInputElement;
  layoutParent: HTMLElement;
  owner: HTMLElement;
  sourceInput: HTMLInputElement;
}>;

type DirectStaticFlowCase = Readonly<{
  owners: readonly DirectStaticFlowOwner[];
  root: HTMLElement;
  runtime: BrowserWechatClipboardRuntime;
  visited: Element[];
}>;

type DirectStaticFlowOptions = Readonly<{
  ancestorRotate?: string;
  ancestorScale?: string;
  ancestorTransform?: string;
  ancestorTranslate?: string;
  layoutParentPaddingLeft?: string;
  layoutParentPaddingTop?: string;
  layoutParentPosition?: 'relative' | 'static';
  ownerZIndex?: string;
}>;

function directStaticFlowCase(
  offsets: readonly Readonly<{ left: string; top: string }>[] = [{ left: '-22px', top: '3px' }],
  options: DirectStaticFlowOptions = {}
): DirectStaticFlowCase {
  const root = document.createElement('div');
  const styles = new Map<Element, CSSStyleDeclaration>();
  const visited: Element[] = [];
  const {
    ancestorRotate,
    ancestorScale,
    ancestorTransform,
    ancestorTranslate,
    layoutParentPaddingLeft = '0px',
    layoutParentPaddingTop = '0px',
    layoutParentPosition = ancestorTransform || ancestorRotate || ancestorScale || ancestorTranslate ? 'static' : 'relative',
    ownerZIndex
  } = options;
  const owners = offsets.map(({ left, top }) => {
    const layoutParent = document.createElement('li');
    const layoutAncestor =
      ancestorTransform || ancestorRotate || ancestorScale || ancestorTranslate ? document.createElement('div') : null;
    const layoutInput = document.createElement('input');
    layoutParent.append(layoutInput);
    const owner = document.createElement('span');
    owner.setAttribute(
      'style',
      [DIRECT_OWNER_PROJECTION, ownerZIndex ? `z-index:${ownerZIndex}` : ''].filter(Boolean).join(';')
    );
    // The production walk only normalizes owners the clone pipeline registered.
    TASK_LIST_CHECKBOX_CLONES.add(owner);
    const ownerSlot = document.createElement('div');
    ownerSlot.append(owner);
    root.append(ownerSlot);
    if (layoutAncestor) layoutAncestor.append(layoutParent);
    styles.set(
      layoutParent,
      declaration({
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        display: 'block',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': '0px',
        'padding-bottom': '0px',
        'padding-left': layoutParentPaddingLeft,
        'padding-right': '0px',
        'padding-top': layoutParentPaddingTop,
        position: layoutParentPosition,
        width: '300px',
        ...(ancestorTransform ? { transform: 'none' } : {}),
        ...(ancestorRotate ? { rotate: 'none' } : {}),
        ...(ancestorScale ? { scale: 'none' } : {}),
        ...(ancestorTranslate ? { translate: 'none' } : {})
      })
    );
    if (layoutAncestor) {
      styles.set(
        layoutAncestor,
        declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          display: 'block',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'static',
          transform: ancestorTransform ?? 'none',
          ...(ancestorRotate ? { rotate: ancestorRotate } : {}),
          ...(ancestorScale ? { scale: ancestorScale } : {}),
          ...(ancestorTranslate ? { translate: ancestorTranslate } : {}),
          width: '400px'
        })
      );
    }
    styles.set(
      layoutInput,
      declaration({
        appearance: 'none',
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        'box-sizing': 'border-box',
        display: 'inline-block',
        height: '20px',
        left,
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': '0px',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': '0px',
        position: 'absolute',
        top,
        width: '20px',
        'z-index': ownerZIndex ?? 'auto'
      })
    );
    return { layoutInput, layoutParent, owner, sourceInput: document.createElement('input') };
  });
  const sequence: TaskCheckboxCaptionOwnerIdentity[] = owners.map(({ layoutInput, owner, sourceInput }) => ({
    cloneOwner: owner,
    clonePath: [],
    layoutInput,
    layoutPath: [],
    sourceInput,
    sourcePath: []
  }));
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, sequence);
  return {
    owners,
    root,
    runtime: {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (!pseudoElement) visited.push(element);
        return styles.get(element) ?? declaration({});
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    },
    visited
  };
}

type RelativeOwnerAbsolutePseudoCase = Readonly<{
  marker: HTMLElement;
  owner: HTMLElement;
  root: HTMLElement;
  runtime: BrowserWechatClipboardRuntime;
}>;

type RelativeOwnerAbsolutePseudoOptions = Readonly<{
  beforePosition?: 'absolute' | 'static';
  beforeZIndex?: string;
  afterZIndex?: string;
  ownerZIndex?: string;
}>;

function relativeOwnerAbsolutePseudoCase(
  options: RelativeOwnerAbsolutePseudoOptions = {}
): RelativeOwnerAbsolutePseudoCase {
  const root = document.createElement('div');
  const layoutParent = document.createElement('li');
  const layoutInput = document.createElement('input');
  const owner = document.createElement('span');
  const marker = document.createElement('span');
  const styles = new Map<Element, CSSStyleDeclaration>();
  const pseudoStyles = new Map<string, CSSStyleDeclaration>();
  const { beforePosition = 'static', beforeZIndex, afterZIndex, ownerZIndex } = options;

  owner.setAttribute(
    'style',
    [
      'box-sizing:border-box',
      'display:inline-block',
      'height:20px',
      'left:0px',
      'position:relative',
      'top:0px',
      'width:20px',
      ...(ownerZIndex ? [`z-index:${ownerZIndex}`] : [])
    ].join(';')
  );
  marker.setAttribute(
    'style',
    [
      'box-sizing:border-box',
      'display:block',
      'height:12px',
      'left:auto',
      'position:absolute',
      'right:-15.6px',
      'top:auto',
      'bottom:0px',
      'width:8px',
      ...(afterZIndex ? [`z-index:${afterZIndex}`] : [])
    ].join(';')
  );
  marker.setAttribute('aria-hidden', 'true');
  owner.append(marker);
  root.append(owner);
  layoutParent.append(layoutInput);
  TASK_LIST_CHECKBOX_CLONES.add(owner);
  TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, '::after');
  styles.set(
    layoutParent,
    declaration({
      'border-bottom-width': '0px',
      'border-left-width': '0px',
      'border-right-width': '0px',
      'border-top-width': '0px',
      'box-sizing': 'border-box',
      display: 'block',
      height: '40px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'relative',
      width: '300px'
    })
  );
  styles.set(owner, declaration({ position: 'relative', 'z-index': ownerZIndex ?? 'auto' }));
  styles.set(
    layoutInput,
    declaration({
      'border-bottom-width': '0px',
      'border-left-width': '0px',
      'border-right-width': '0px',
      'border-top-width': '0px',
      'box-sizing': 'border-box',
      display: 'inline-block',
      height: '20px',
      left: '0px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'relative',
      top: '0px',
      width: '20px'
    })
  );
  pseudoStyles.set(
    `${layoutInput}:before`,
    declaration({
      content: 'none',
      position: beforePosition,
      ...(beforeZIndex ? { 'z-index': beforeZIndex } : {})
    })
  );
  pseudoStyles.set(
    `${layoutInput}:after`,
    declaration({
      bottom: '0px',
      'box-sizing': 'border-box',
      content: '""',
      display: 'block',
      height: '12px',
      left: 'auto',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      position: 'absolute',
      ...(afterZIndex ? { 'z-index': afterZIndex } : {}),
      right: '-15.6px',
      top: 'auto',
      width: '8px'
    })
  );
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [
    {
      cloneOwner: owner,
      clonePath: [],
      layoutInput,
      layoutPath: [],
      sourceInput: document.createElement('input'),
      sourcePath: []
    }
  ]);
  return {
    marker,
    owner,
    root,
    runtime: {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (pseudoElement) return pseudoStyles.get(`${element}:${pseudoElement.slice(2)}`) ?? declaration({});
        return styles.get(element) ?? declaration({});
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    }
  };
}

const conversionContext = (
  isCurrent: () => boolean,
  signal: AbortSignal = new AbortController().signal
): WechatPngConversionContext => ({
  captureBoundary: document.createElement('article'),
  imageUploadPort: {
    upload: async () => ({ code: 'wechat-test-upload-unavailable', status: 'failed' })
  },
  isCurrent,
  maxBytes: 1024,
  mermaidSnapshots: new Map(),
  postId: 17,
  rasterizationPort: {
    rasterize: async () => {
      throw new Error('wechat-test-rasterization-unavailable');
    }
  },
  scale: 1,
  signal,
  state: { uploadsMayRemain: false }
});

describe('normalizeTaskCheckboxStaticFlow', () => {
  it('does not subtract layout-parent padding twice in the measured-geometry fallback', () => {
    const { owners, root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
      layoutParentPaddingLeft: '8px',
      layoutParentPaddingTop: '6px'
    });
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');

    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);

    // jsdom exposes zero-sized rectangles, so this exercises the inset fallback.
    // The containing-block offset already contains the layout-parent padding;
    // each axis must be removed exactly once.
    expect(declaredStylePixels(recorded.owner, 'margin-left')).toBeCloseTo(-30, 6);
    expect(declaredStylePixels(recorded.owner, 'margin-top')).toBeCloseTo(-3, 6);
  });

  it('rejects an ancestor transform instead of mixing transformed and layout planes', () => {
    const { root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
      ancestorTransform: 'matrix(1, 0, 0, 1, 12, 4)'
    });

    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime)).toThrow(
      'wechat-task-checkbox-static-flow-transform-unavailable'
    );
  });

  it.each([
    ['rotate', { ancestorRotate: '90deg' }],
    ['scale', { ancestorScale: '1.2' }],
    ['translate', { ancestorTranslate: '12px' }]
  ] as const)('rejects an ancestor %s property instead of mixing transformed and layout planes', (_name, options) => {
    const { root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
      ...options,
      layoutParentPosition: 'relative'
    });

    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime)).toThrow(
      'wechat-task-checkbox-static-flow-transform-unavailable'
    );
  });

  it('keeps valid measured coordinates when the content parent has zero height', () => {
    const { owners, root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }]);
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
        x: left,
        y: top
      }) as DOMRect;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this === recorded.layoutParent) return rect(10, 20, 300, 0);
        if (this === recorded.layoutInput) return rect(15, 26, 20, 20);
        return originalRect?.value?.call(this) ?? rect(0, 0, 0, 0);
      }
    });
    try {
      normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
      expect(declaredStylePixels(recorded.owner, 'margin-left')).toBeCloseTo(5, 6);
      expect(declaredStylePixels(recorded.owner, 'margin-top')).toBeCloseTo(6, 6);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it('projects an absolute owner z-index into a relative float using the real Phycat rule', () => {
    const style = document.createElement('style');
    style.textContent = phycatSkyCss;
    const preview = document.createElement('article');
    preview.className = 'easymde-rendered-content easymde-markdown-theme-phycat-sky';
    preview.innerHTML = '<ul><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"></li></ul>';
    document.head.append(style);
    document.body.append(preview);
    try {
      const taskRule = /\.task-list-item input\s*\{[^}]*z-index\s*:\s*([^;}]+)/u.exec(phycatSkyCss);
      expect(taskRule?.[1]?.trim()).toBe('1');
      const zIndex = taskRule?.[1]?.trim() ?? '';
      const { owners, root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
        ownerZIndex: zIndex
      });
      const [recorded] = owners;
      if (!recorded) throw new Error('direct static flow owner missing');
      normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
      expect(declaredStyleValue(recorded.owner, 'position')).toBe('relative');
      expect(declaredStyleValue(recorded.owner, 'z-index')).toBe('1');
      assertTaskCheckboxStaticFlowAllocations(recorded.owner);
    } finally {
      preview.remove();
      style.remove();
    }
  });

  it('projects z-index only for emitted absolute pseudo layers and reports missing registered markers', () => {
    const absent = relativeOwnerAbsolutePseudoCase({ beforePosition: 'absolute', beforeZIndex: '10' });
    // content:none has no output marker, so its authored z-index is irrelevant.
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(absent.root, absent.runtime)).not.toThrow();

    const emitted = relativeOwnerAbsolutePseudoCase({ afterZIndex: '2' });
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(emitted.root, emitted.runtime)).not.toThrow();
    expect(declaredStyleValue(emitted.marker, 'position')).toBe('relative');
    expect(declaredStyleValue(emitted.marker, 'z-index')).toBe('2');

    const missing = relativeOwnerAbsolutePseudoCase({ afterZIndex: '2' });
    taskCheckboxStaticPaintExpectationFor(missing.owner).pseudos.set('::after', {
      kind: 'text',
      properties: [],
      requiresText: false,
      svgPaintSignature: null
    });
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.delete(missing.marker);
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(missing.root, missing.runtime)).toThrow(
      'wechat-task-checkbox-static-owner-pseudo-missing'
    );
  });

  it('keeps a relative owner in flow while normalizing its absolute after pseudo from right and bottom insets', () => {
    const { marker, owner, root, runtime } = relativeOwnerAbsolutePseudoCase();

    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);

    expect(declaredStyleValue(owner, 'position')).toBe('relative');
    expect(declaredStyleValue(marker, 'position')).toBe('static');
    expect(declaredStyleValue(marker, 'float')).toBe('left');
    expect(declaredStylePixels(marker, 'width')).toBeCloseTo(8, 6);
    expect(declaredStylePixels(marker, 'height')).toBeCloseTo(12, 6);
    expect(declaredStylePixels(marker, 'margin-left')).toBeCloseTo(27.6, 6);
    expect(declaredStylePixels(marker, 'margin-top')).toBeCloseTo(8, 6);
    expect(declaredStylePixels(marker, 'margin-right')).toBeCloseTo(-35.6, 6);
    expect(declaredStylePixels(marker, 'margin-bottom')).toBeCloseTo(-20, 6);
    assertTaskCheckboxStaticFlowAllocations(owner);
  });

  it('preserves stacking for a relative owner and its absolute pseudo marker', () => {
    const { marker, owner, root, runtime } = relativeOwnerAbsolutePseudoCase({
      afterZIndex: '2',
      ownerZIndex: '4'
    });

    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);

    expect(declaredStyleValue(owner, 'position')).toBe('relative');
    expect(declaredStyleValue(owner, 'z-index')).toBe('4');
    expect(declaredStyleValue(marker, 'position')).toBe('relative');
    expect(declaredStyleValue(marker, 'z-index')).toBe('2');
    assertTaskCheckboxStaticFlowAllocations(owner);
  });

  it('normalizes the recorded owner sequence without querying the serialized root', () => {
    const { owners, root, runtime, visited } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const [first, second] = owners;
    if (!first || !second) throw new Error('direct static flow owners missing');
    // The inventory owns the sequence: a root-wide discovery lookup would throw.
    Object.defineProperty(root, 'querySelectorAll', {
      configurable: true,
      value: () => {
        throw new Error('wechat-test-root-query');
      }
    });
    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
    const visitedInputs = visited.filter(
      (element): element is HTMLInputElement => element instanceof HTMLInputElement
    );
    // Each owner reads its layout input several times, so the sequence is the
    // first-occurrence order of the recorded inventory.
    expect([...new Set(visitedInputs)]).toEqual([
      ...owners.map(({ layoutInput }) => layoutInput),
      ...owners.map(({ sourceInput }) => sourceInput)
    ]);
    expect(declaredStylePixels(first.owner, 'margin-left')).toBeCloseTo(-22, 6);
    expect(declaredStylePixels(first.owner, 'margin-top')).toBeCloseTo(3, 6);
    expect(declaredStylePixels(second.owner, 'margin-left')).toBeCloseTo(10, 6);
    expect(declaredStylePixels(second.owner, 'margin-top')).toBeCloseTo(30, 6);
    owners.forEach(({ owner }) => {
      expect(declaredStyleValue(owner, 'position')).toBe('static');
      expect(declaredStyleValue(owner, 'float')).toBe('left');
      assertTaskCheckboxStaticFlowAllocations(owner);
    });
  });

  it('rejects a recorded owner that is no longer part of the serialized root', () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    const known = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root)?.[0];
    if (!recorded || !known) throw new Error('direct static flow recording missing');
    const stranger = document.createElement('span');
    TASK_LIST_CHECKBOX_CLONES.add(stranger);
    TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [{ ...known, cloneOwner: stranger }]);
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime)).toThrow(
      'wechat-task-checkbox-static-flow-owner-missing'
    );
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('absolute');
  });

  it('skips a recorded owner that was never registered as a projected clone', () => {
    // A hidden source control returns before paint registration, so its owner
    // keeps the projected declarations and the terminal validation owns it.
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    const known = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root)?.[0];
    if (!recorded || !known) throw new Error('direct static flow recording missing');
    const unprojected = document.createElement('span');
    unprojected.setAttribute('style', DIRECT_OWNER_PROJECTION);
    root.append(unprojected);
    TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [known, { ...known, cloneOwner: unprojected }]);
    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('static');
    expect(declaredStyleValue(unprojected, 'position')).toBe('absolute');
    expect(unprojected.getAttribute('style')).toBe(DIRECT_OWNER_PROJECTION);
  });

  it('re-derives the recorded allocation from the final declarations', () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
    const { owner } = recorded;
    const allocation = owner.getAttribute('style') ?? '';
    assertTaskCheckboxStaticFlowAllocations(owner);
    // Later declarations win, so an overwritten allocation has to fail here.
    owner.setAttribute('style', `${allocation};margin-left:-18px!important`);
    expect(() => assertTaskCheckboxStaticFlowAllocations(owner)).toThrow(
      'wechat-task-checkbox-static-flow-allocation-mismatch'
    );
  });

  it('keeps the run synchronous while the serialization budget is unexhausted', async () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    const yields: number[] = [];
    const yieldToBrowser: SerializationYield = Object.assign(
      async (): Promise<void> => {
        yields.push(1);
      },
      { shouldYield: () => false }
    );
    await expect(normalizeTaskCheckboxStaticFlow(root, runtime, yieldToBrowser)).resolves.toBeUndefined();
    expect(yields).toHaveLength(0);
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('static');
  });

  it('suspends between owners only while the serialization budget is due', async () => {
    const { owners, root, runtime } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const allocatedAtYield: string[] = [];
    const yieldToBrowser: SerializationYield = Object.assign(
      async (): Promise<void> => {
        allocatedAtYield.push(owners.map(({ owner }) => declaredStyleValue(owner, 'position')).join(','));
      },
      { shouldYield: () => true }
    );
    await normalizeTaskCheckboxStaticFlow(root, runtime, yieldToBrowser);
    // The boundary runs after each owner, so the second owner is still
    // projected while the first boundary is observed.
    expect(allocatedAtYield).toEqual(['static,absolute', 'static,static']);
  });

  it('stops before the first owner when the caller is already aborted', async () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    const controller = new AbortController();
    controller.abort();
    await expect(normalizeTaskCheckboxStaticFlow(root, runtime, null, undefined, controller.signal)).rejects.toThrow(
      'wechat-background-preparation-cancelled'
    );
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('absolute');
  });

  it('stops before the next owner when the caller aborts during a boundary', async () => {
    const { owners, root, runtime } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const [first, second] = owners;
    if (!first || !second) throw new Error('direct static flow owners missing');
    const controller = new AbortController();
    const yieldToBrowser: SerializationYield = Object.assign(
      async (): Promise<void> => {
        controller.abort();
      },
      { shouldYield: () => true }
    );
    await expect(
      normalizeTaskCheckboxStaticFlow(root, runtime, yieldToBrowser, undefined, controller.signal)
    ).rejects.toThrow('wechat-background-preparation-cancelled');
    expect(declaredStyleValue(first.owner, 'position')).toBe('static');
    expect(declaredStyleValue(second.owner, 'position')).toBe('absolute');
  });

  it('stops when the conversion is no longer current', async () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    await expect(normalizeTaskCheckboxStaticFlow(root, runtime, null, conversionContext(() => false))).rejects.toThrow(
      'wechat-png-rasterization-cancelled'
    );
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('absolute');
  });

  it('checks conversion currentness around every owner', async () => {
    const { owners, root, runtime } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const [first, second] = owners;
    if (!first || !second) throw new Error('direct static flow owners missing');
    let checks = 0;
    // The first owner passes both of its boundary checks, so a stale conversion
    // has to stop the run before the second owner is normalized.
    await expect(
      normalizeTaskCheckboxStaticFlow(root, runtime, null, conversionContext(() => 3 > ++checks))
    ).rejects.toThrow('wechat-png-rasterization-cancelled');
    expect(declaredStyleValue(first.owner, 'position')).toBe('static');
    expect(declaredStyleValue(second.owner, 'position')).toBe('absolute');
  });
});

  it('fails explicitly when a geometry lease has no source measurement', () => {
    const { root, runtime } = directStaticFlowCase();
    const identity = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root)?.[0];
    if (!identity) throw new Error('static flow identity missing');
    const sourceInput = identity.layoutInput;
    sourceInput.classList.add('easymde-task-checkbox');
    sourceInput.setAttribute('type', 'checkbox');
    const sourceStyle = sourceInput.getAttribute('style');
    TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [{ ...identity, sourceInput }]);
    const geometryLease: TaskCheckboxGeometryLease = {
      cleanup: vi.fn(),
      isReady: () => true,
      measurementFor: () => null,
      ready: Promise.resolve(),
      root: document.createElement('div'),
      scopeRoot: document.createElement('div'),
      sourceGeometryReference: 'source',
      sourceMarkup: '',
      sourceFor: () => null,
      sourceRoot: document.createElement('div'),
      sourceWidthKey: null,
      wait: () => Promise.resolve()
    };

    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime, geometryLease)).toThrow(
      'wechat-task-checkbox-static-flow-measurement-missing'
    );
    expect(sourceInput.getAttribute('style')).toBe(sourceStyle);
  });
