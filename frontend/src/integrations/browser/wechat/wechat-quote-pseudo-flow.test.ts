// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { installClipboardTestEnvironment } from './wechat-clipboard-test-fixtures';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { WECHAT_STRUCTURE_REPLACEMENTS } from './wechat-clone-metadata';
import {
  preparedDimensionGeometrySignature,
  preparedLayoutSignature
} from './wechat-fidelity-signature';
import {
  createMarkup,
  createMarkupSynchronously,
  serializeClipboardPayloadSynchronously
} from './wechat-portable-serialization';
import {
  applyQuotePseudoFlow,
  assertQuotePseudoFlows,
  captureQuotePseudoFlowSnapshot,
  planQuotePseudoFlow,
  quotePseudoFlowFreshnessSignature,
  type QuotePseudoFlowCollector
} from './wechat-quote-pseudo-flow';

const OWNER_DEFAULTS: Readonly<Record<string, string>> = {
  'block-size': 'auto',
  'border-bottom-style': 'none',
  'border-bottom-width': '0px',
  'border-left-style': 'none',
  'border-left-width': '0px',
  'border-right-style': 'none',
  'border-right-width': '0px',
  'border-top-style': 'none',
  'border-top-width': '0px',
  direction: 'ltr',
  display: 'block',
  float: 'none',
  height: 'auto',
  'inline-size': 'auto',
  'margin-bottom': '20px',
  'margin-left': '0px',
  'margin-right': '0px',
  'margin-top': '20px',
  'max-block-size': 'none',
  'max-height': 'none',
  'max-inline-size': 'none',
  'max-width': 'none',
  'min-block-size': 'auto',
  'min-height': '0px',
  'min-inline-size': 'auto',
  'min-width': 'auto',
  overflow: 'visible',
  width: 'auto',
  'padding-bottom': '18px',
  'padding-left': '48px',
  'padding-right': '20px',
  'padding-top': '18px',
  position: 'relative',
  transform: 'none',
  visibility: 'visible',
  'writing-mode': 'horizontal-tb'
};

const PSEUDO_DEFAULTS: Readonly<Record<string, string>> = {
  bottom: 'auto',
  'border-bottom-style': 'none',
  'border-bottom-width': '0px',
  'border-left-style': 'none',
  'border-left-width': '0px',
  'border-right-style': 'none',
  'border-right-width': '0px',
  'border-top-style': 'none',
  'border-top-width': '0px',
  'box-sizing': 'content-box',
  content: '"✨"',
  'counter-increment': 'none',
  'counter-reset': 'none',
  'counter-set': 'none',
  display: 'block',
  filter: 'none',
  float: 'none',
  height: '20px',
  left: '16px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'margin-right': '0px',
  'margin-top': '0px',
  'mask': 'none',
  'mask-image': 'none',
  'max-height': 'none',
  'max-width': 'none',
  'min-block-size': 'auto',
  'min-height': '0px',
  'min-inline-size': 'auto',
  'min-width': '0px',
  'max-block-size': 'none',
  'max-inline-size': 'none',
  opacity: '1',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'padding-right': '0px',
  'padding-top': '0px',
  position: 'absolute',
  right: 'auto',
  top: '18px',
  transform: 'none',
  visibility: 'visible',
  width: '21.1016px',
  'writing-mode': 'horizontal-tb'
};

function style(values: Readonly<Record<string, string>>): CSSStyleDeclaration {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.trim().toLowerCase(), value])
  );
  return {
    getPropertyValue: (property: string) => normalized[property.trim().toLowerCase()] ?? ''
  } as unknown as CSSStyleDeclaration;
}

function runtimeFor(
  ownerOverrides: Readonly<Record<string, string>> = {},
  pseudoOverrides: Readonly<Record<string, string>> = {},
  afterOverrides: Readonly<Record<string, string>> = {},
  rawOwnerOverrides: Readonly<Record<string, string>> | null = null,
  rawPseudoOverrides: Readonly<Record<string, string>> | null = null
): BrowserWechatClipboardRuntime {
  const inRawHost = (element: Element): boolean =>
    element.closest('.easymde-wechat-raw-dimension-context') instanceof HTMLElement;
  return {
    blob: Blob,
    clipboardItem: null,
    document,
    getComputedStyle: (element: Element, pseudoElement?: string) => {
      if ('BLOCKQUOTE' === element.tagName) {
        if ('::before' === pseudoElement) {
          return style({
            ...PSEUDO_DEFAULTS,
            ...pseudoOverrides,
            ...(inRawHost(element) && rawPseudoOverrides ? rawPseudoOverrides : {})
          });
        }
        if ('::after' === pseudoElement) {
          return style({ content: 'none', display: 'none', visibility: 'visible', ...afterOverrides });
        }
        return style({
          ...OWNER_DEFAULTS,
          ...ownerOverrides,
          ...(inRawHost(element) && rawOwnerOverrides ? rawOwnerOverrides : {})
        });
      }
      if ('P' === element.tagName && !pseudoElement)
        return style({ display: 'block', 'margin-top': '10px' });
      return pseudoElement
        ? style({ content: 'none' })
        : style({ display: 'block' });
    },
    getSelection: () => window.getSelection(),
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: vi.fn(),
    write: null
  };
}

function dimensionSemanticsFor(
  rawOwner: Readonly<Record<string, string>> = {},
  rawPseudo: Readonly<Record<string, string>> = {}
) {
  return {
    cleanup: vi.fn(),
    getComputedStyle: (element: Element, pseudoElement?: string) => {
      if ('BLOCKQUOTE' === element.tagName && '::before' === pseudoElement) {
        return style({ ...PSEUDO_DEFAULTS, ...rawPseudo });
      }
      if ('BLOCKQUOTE' === element.tagName && !pseudoElement) {
        return style({ ...OWNER_DEFAULTS, ...rawOwner });
      }
      return null;
    },
    getFormattingOwnerDisplay: () => 'block',
    getRefreshGeneration: () => 1,
    getRootComputedStyle: () => null,
    getSourceComputedStyle: (element: Element) => runtimeFor().getComputedStyle(element),
    rasterizesVisualRoots: false,
    refresh: vi.fn()
  };
}

function quotePreview(markup = '<blockquote><p>Quote</p></blockquote>'): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = markup;
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Quote' });
  return preview;
}

function plan(
  owner: Readonly<Record<string, string>> = {},
  pseudo: Readonly<Record<string, string>> = {},
  after: Readonly<Record<string, string>> = {},
  dimensionSemantics: ReturnType<typeof dimensionSemanticsFor> | null = null
) {
  const preview = quotePreview();
  const source = preview.querySelector('blockquote');
  const clone = source?.cloneNode(true);
  if (!(source instanceof Element) || !(clone instanceof Element)) throw new Error('quote fixture missing');
  const runtime = runtimeFor(owner, pseudo, after);
  const marker = document.createElement('span');
  marker.textContent = '✨';
  marker.setAttribute('aria-hidden', 'true');
  return {
    plan: planQuotePseudoFlow({
      clone,
      dimensionSemantics,
      getComputedStyle: runtime.getComputedStyle,
      marker,
      pseudo: '::before',
      pseudoComputed: runtime.getComputedStyle(source, '::before'),
      source
    }),
    preview,
    runtime
  };
}

describe('wechat quote pseudo flow', () => {
  installClipboardTestEnvironment();

  it('accepts only the matching horizontal max-width/max-inline-size pair', () => {
    const { plan: result, preview } = plan({ 'max-inline-size': '100%', 'max-width': '100%' });
    try {
      expect(result).toMatchObject({ width: 21.1016, height: 20 });
    } finally {
      preview.remove();
    }
  });

  it('treats a raw max-width change as admission even when the used width is auto', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      expect(() =>
        planQuotePseudoFlow({
          clone,
          dimensionSemantics: dimensionSemanticsFor({ 'max-width': '80px' }),
          getComputedStyle: runtime.getComputedStyle,
          marker,
          pseudo: '::before',
          pseudoComputed: runtime.getComputedStyle(source, '::before'),
          source
        })
      ).toThrow('wechat-quote-pseudo-owner-size-unsupported');
    } finally {
      preview.remove();
    }
  });

  it('rejects raw fixed height even when the used height reports auto', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      expect(() =>
        planQuotePseudoFlow({
          clone,
          dimensionSemantics: dimensionSemanticsFor({ height: '200px' }),
          getComputedStyle: runtime.getComputedStyle,
          marker,
          pseudo: '::before',
          pseudoComputed: runtime.getComputedStyle(source, '::before'),
          source
        })
      ).toThrow('wechat-quote-pseudo-height-unsupported');
    } finally {
      preview.remove();
    }
  });

  it('preserves percentage padding projections from the dimension context', () => {
    const preview = quotePreview('<blockquote><blockquote><p>Nested</p></blockquote></blockquote>');
    const source = preview.querySelector('blockquote blockquote');
    if (!(source instanceof Element)) throw new Error('nested quote source missing');
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      const result = planQuotePseudoFlow({
        clone,
        dimensionSemantics: dimensionSemanticsFor({
          height: 'auto',
          'max-height': 'none',
          'max-inline-size': 'none',
          'min-height': '0px',
          'min-inline-size': 'auto',
          'min-width': 'auto',
          width: 'auto',
          'padding-top': '9%',
          'padding-right': '5%',
          'padding-bottom': '9%',
          'padding-left': '5%'
        }),
        getComputedStyle: runtime.getComputedStyle,
        marker,
        pseudo: '::before',
        pseudoComputed: runtime.getComputedStyle(source, '::before'),
        source
      });
      expect(result?.carrierPadding).toEqual(['9%', '5%', '9%', '5%']);
    } finally {
      preview.remove();
    }
  });

  it('uses the frozen raw pseudo geometry rather than a delayed used-style change', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      const snapshot = captureQuotePseudoFlowSnapshot({
        clone,
        dimensionSemantics: dimensionSemanticsFor({}, { height: '24px', width: '30px' }),
        getComputedStyle: runtime.getComputedStyle,
        pseudo: '::before',
        pseudoComputed: runtime.getComputedStyle(source, '::before'),
        source
      });
      const frozen = snapshot.plan(marker);
      expect(frozen).toMatchObject({ height: 24, width: 30 });
    } finally {
      preview.remove();
    }
  });

  it('freezes the projected geometry before a delayed style mutation', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    let reads = 0;
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      const snapshot = captureQuotePseudoFlowSnapshot({
        clone,
        dimensionSemantics: null,
        getComputedStyle: (element, pseudoElement) => {
          if (element === source && '::before' === pseudoElement) {
            reads += 1;
            return style({
              ...PSEUDO_DEFAULTS,
              left: reads > 1 ? '80px' : '16px',
              width: reads > 1 ? '50px' : '21.1016px'
            });
          }
          return runtime.getComputedStyle(element, pseudoElement);
        },
        pseudo: '::before',
        pseudoComputed: runtime.getComputedStyle(source, '::before'),
        source
      });
      const frozen = snapshot.plan(marker);
      const mutated = style({ ...PSEUDO_DEFAULTS, left: '80px', width: '50px' });
      expect(mutated.getPropertyValue('width')).toBe('50px');
      expect(frozen).toMatchObject({ marginLeft: 16, width: 21.1016 });
    } finally {
      preview.remove();
    }
  });

  it('keeps every logical pseudo bound immutable after capture', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    const rawBefore: Record<string, string> = {
      'max-block-size': 'none',
      'max-inline-size': 'none',
      'min-block-size': 'auto',
      'min-inline-size': 'auto'
    };
    try {
      const snapshot = captureQuotePseudoFlowSnapshot({
        clone,
        dimensionSemantics: dimensionSemanticsFor({}, rawBefore),
        getComputedStyle: runtime.getComputedStyle,
        pseudo: '::before',
        pseudoComputed: runtime.getComputedStyle(source, '::before'),
        source
      });
      for (const [property, value] of [
        ['max-block-size', '10px'],
        ['max-inline-size', '10px'],
        ['min-block-size', '10px'],
        ['min-inline-size', '10px']
      ] as const) {
        rawBefore[property] = value;
      }
      expect(snapshot.plan(marker)).toMatchObject({ height: 20, width: 21.1016 });
    } finally {
      preview.remove();
    }
  });

  it('rejects raw percentage insets even when used offsets are normal pixels', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor({}, { left: '16px', top: '18px' });
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      expect(() =>
        planQuotePseudoFlow({
          clone,
          dimensionSemantics: dimensionSemanticsFor(
            {},
            {
              left: '50%',
              right: 'auto',
              top: '50%',
              bottom: 'auto'
            }
          ),
          getComputedStyle: runtime.getComputedStyle,
          marker,
          pseudo: '::before',
          pseudoComputed: runtime.getComputedStyle(source, '::before'),
          source
        })
      ).toThrow(/wechat-quote-pseudo-(?:left|top)-unsupported/u);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['responsive left', { left: '50%' }],
    ['responsive top', { top: '50%' }],
    ['left auto with right anchor', { left: 'auto', right: '24px' }],
    ['top auto with bottom anchor', { top: 'auto', bottom: '24px' }],
    ['left percentage with right anchor', { left: '25%', right: '24px' }]
  ])('rejects raw pseudo %s', (_label, rawPseudo) => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      expect(() =>
        planQuotePseudoFlow({
          clone,
          dimensionSemantics: dimensionSemanticsFor({}, rawPseudo),
          getComputedStyle: runtime.getComputedStyle,
          marker,
          pseudo: '::before',
          pseudoComputed: runtime.getComputedStyle(source, '::before'),
          source
        })
      ).toThrow();
    } finally {
      preview.remove();
    }
  });

  it('rejects the same responsive inset at both source widths instead of freezing used pixels', () => {
    for (const left of ['16px', '8px']) {
      const preview = quotePreview();
      const source = preview.querySelector('blockquote');
      if (!(source instanceof Element)) throw new Error('quote source missing');
      const runtime = runtimeFor({}, { left });
      const clone = source.cloneNode(true) as Element;
      const marker = document.createElement('span');
      marker.textContent = '✨';
      try {
        expect(() =>
          planQuotePseudoFlow({
            clone,
            dimensionSemantics: dimensionSemanticsFor({}, { left: '50%', top: '50%' }),
            getComputedStyle: runtime.getComputedStyle,
            marker,
            pseudo: '::before',
            pseudoComputed: runtime.getComputedStyle(source, '::before'),
            source
          })
        ).toThrow();
      } finally {
        preview.remove();
      }
    }
  });

  it('canonical quote freshness does not change when synchronous planning captures a snapshot', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    try {
      const layoutBefore = preparedLayoutSignature(preview, runtime);
      const geometryBefore = preparedDimensionGeometrySignature(preview, runtime, null);
      const clone = source.cloneNode(true) as Element;
      const marker = document.createElement('span');
      marker.textContent = '✨';
      const snapshot = captureQuotePseudoFlowSnapshot({
        clone,
        dimensionSemantics: null,
        getComputedStyle: runtime.getComputedStyle,
        pseudo: '::before',
        pseudoComputed: runtime.getComputedStyle(source, '::before'),
        source
      });
      expect(snapshot.plan(marker)).not.toBeNull();
      expect(preparedLayoutSignature(preview, runtime)).toBe(layoutBefore);
      expect(preparedDimensionGeometrySignature(preview, runtime, null)).toBe(geometryBefore);
    } finally {
      preview.remove();
    }
  });

  it('RED/GREEN carrier plan uses immutable measured geometry and zero-margin float', () => {
    const { plan: result, preview } = plan();
    try {
      expect(result).toMatchObject({
        carrierPadding: ['18px', '20px', '18px', '48px'],
        height: 20,
        marginBottom: -38,
        marginLeft: 16,
        marginRight: -37.101600000000005,
        marginTop: 18,
        width: 21.1016
      });
      expect(Object.isFrozen(result)).toBe(true);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['one-sided logical max-inline-size:100%', { 'max-inline-size': '100%' }],
    ['one-sided physical max-width:100%', { 'max-width': '100%' }],
    ['effective max-width 80px', { 'max-width': '80px', width: '80px' }],
    ['paired finite horizontal max', { 'max-inline-size': '80px', 'max-width': '80px' }],
    ['effective min-width 500px', { 'min-width': '500px' }],
    ['positive logical min-inline-size', { 'min-inline-size': '500px' }],
    ['fixed content-box height 200px', { height: '200px' }]
  ])('rejects owner %s', (_label, overrides) => {
    expect(() => plan(overrides)).toThrow();
  });

  it.each([
    ['percentage width', { width: '50%' }],
    ['percentage height', { height: '50%' }],
    ['min-width cap', { 'min-width': '300px' }],
    ['min-block-size cap', { 'min-block-size': '10px' }],
    ['min-inline-size cap', { 'min-inline-size': '10px' }],
    ['max-height cap', { 'max-height': '10px' }],
    ['max-block-size cap', { 'max-block-size': '10px' }],
    ['max-inline-size cap', { 'max-inline-size': '10px' }],
    ['empty min-block-size evidence', { 'min-block-size': '' }],
    ['empty min-inline-size evidence', { 'min-inline-size': '' }],
    ['empty max-block-size evidence', { 'max-block-size': '' }],
    ['empty max-inline-size evidence', { 'max-inline-size': '' }],
    ['zero width', { width: '0px' }],
    ['auto height', { height: 'auto' }],
    ['responsive viewport width', { width: '20vw' }],
    ['active empty border width', { 'border-left-style': 'solid', 'border-left-width': '' }]
  ])('rejects pseudo %s', (_label, overrides) => {
    expect(() => plan({}, overrides)).toThrow();
  });

  it.each([
    ['owner top empty width', { 'border-top-style': 'solid', 'border-top-width': '' }, {}],
    ['owner bottom empty width', { 'border-bottom-style': 'solid', 'border-bottom-width': '' }, {}]
  ])('rejects %s', (_label, ownerOverrides, pseudoOverrides) => {
    expect(() => plan(ownerOverrides, pseudoOverrides)).toThrow();
  });

  it.each([
    ['owner left empty width', { 'border-left-style': 'solid', 'border-left-width': '' }],
    ['owner right empty width', { 'border-right-style': 'solid', 'border-right-width': '' }]
  ])('rejects %s', (_label, ownerOverrides) => {
    expect(() => plan(ownerOverrides)).toThrow();
  });

  it('allows active none/hidden borders with measured zero width', () => {
    expect(plan({}, { 'border-left-style': 'none', 'border-left-width': '0px' }).plan).not.toBeNull();
    expect(plan({}, { 'border-left-style': 'hidden', 'border-left-width': '0px' }).plan).not.toBeNull();
  });

  it('rejects a delayed max-width mutation observed after synchronous admission', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    let reads = 0;
    const runtime = runtimeFor();
    const clone = source.cloneNode(true) as Element;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    try {
      expect(() =>
        planQuotePseudoFlow({
          clone,
          dimensionSemantics: null,
          getComputedStyle: (element, pseudoElement) => {
            if (element === source && !pseudoElement) {
              reads += 1;
              if (reads > 1) throw new Error('wechat-quote-pseudo-owner-read-repeated');
              return style({ ...OWNER_DEFAULTS, 'max-width': '80px' });
            }
            return runtime.getComputedStyle(element, pseudoElement);
          },
          marker,
          pseudo: '::before',
          pseudoComputed: runtime.getComputedStyle(source, '::before'),
          source
        })
      ).toThrow('wechat-quote-pseudo-owner-size-unsupported');
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['visibility:hidden', { visibility: 'hidden' }],
    ['masked paint', { 'mask-image': 'url(https://example.test/mask.svg)' }],
    ['filtered paint', { filter: 'blur(2px)' }],
    ['counter paint', { 'counter-increment': 'quotes 1' }],
    ['RTL owner', { direction: 'rtl' }]
  ])('rejects unsupported %s', (_label, overrides) => {
    const ownerOverride = 'direction' in overrides ? overrides : {};
    expect(() => plan(ownerOverride, overrides)).toThrow();
  });

  it('keeps the nonempty-text absolute requirement', () => {
    expect(() => plan({}, { content: '""' })).toThrow();
    expect(() => plan({}, { position: 'static' })).toThrow();
  });

  it('finalizes through SECTION identity and rejects text or font mutation', () => {
    const preview = quotePreview();
    const clone = preview.cloneNode(true) as HTMLElement;
    const source = preview.querySelector('blockquote');
    const cloneOwner = clone.querySelector('blockquote');
    if (!(source instanceof Element) || !(cloneOwner instanceof Element)) throw new Error('quote clone missing');
    const runtime = runtimeFor();
    const collector: QuotePseudoFlowCollector = { expectations: [] };
    cloneOwner.setAttribute('style', 'background-color:rgb(244, 250, 255);border-left-width:2px;border-left-style:solid;border-left-color:rgb(1, 2, 3)');
    const marker = document.createElement('span');
    marker.textContent = '✨';
    marker.setAttribute('style', 'font-size:20px;font-family:emoji');
    cloneOwner.insertBefore(marker, cloneOwner.firstChild);
    const planned = planQuotePseudoFlow({
      clone: cloneOwner,
      dimensionSemantics: null,
      getComputedStyle: runtime.getComputedStyle,
      marker,
      pseudo: '::before',
      pseudoComputed: runtime.getComputedStyle(source, '::before'),
      source
    });
    if (!planned) throw new Error('quote plan missing');
    applyQuotePseudoFlow(cloneOwner, marker, planned);
    const expectation = {
      carrier: cloneOwner.querySelector(':scope > section') as HTMLElement,
      marker,
      markerPaintSignature: planned.markerPaintSignature,
      markerText: planned.markerText,
      owner: cloneOwner,
      plan: planned
    };
    collector.expectations.push(expectation);
    const finalized = clone.ownerDocument.createElement('div');
    finalized.append(cloneOwner);
    const replacement = clone.ownerDocument.createElement('section');
    Array.from(cloneOwner.attributes).forEach((attribute) => {
      replacement.setAttribute(attribute.name, attribute.value);
    });
    while (cloneOwner.firstChild) replacement.appendChild(cloneOwner.firstChild);
    const carrier = expectation.carrier;
    finalized.append(replacement);
    WECHAT_STRUCTURE_REPLACEMENTS.set(cloneOwner, replacement);
    const record = { ...expectation, carrier };
    collector.expectations.splice(0, 1, record);
    replacement.setAttribute(
      'style',
      'background-color:rgb(244, 250, 255);border-left-width:2px;border-left-style:solid;border-left-color:rgb(1, 2, 3);padding-top:0px!important;padding-right:0px!important;padding-bottom:0px!important;padding-left:0px!important'
    );
    try {
      expect(() => assertQuotePseudoFlows(collector.expectations, finalized)).not.toThrow();
      const preservedStyle = replacement.getAttribute('style') ?? '';
      replacement.style.setProperty('background-color', 'rgb(9, 8, 7)', 'important');
      expect(() => assertQuotePseudoFlows(collector.expectations, finalized)).toThrow(
        'wechat-quote-pseudo-final-owner-paint-mismatch'
      );
      replacement.setAttribute('style', preservedStyle);
      marker.textContent = 'changed';
      expect(() => assertQuotePseudoFlows(collector.expectations, finalized)).toThrow(
        'wechat-quote-pseudo-final-marker-mismatch'
      );
    } finally {
      preview.remove();
    }
  });

  it('freshness includes the new owner/pseudo/after admission reads', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const first = quotePseudoFlowFreshnessSignature(source, runtimeFor());
    const second = quotePseudoFlowFreshnessSignature(
      source,
      runtimeFor({ 'max-inline-size': '80px' }, { 'max-width': '20px' }, { content: '"after"' })
    );
    try {
      expect(first).not.toBe(second);
    } finally {
      preview.remove();
    }
  });

  it('keeps an empty quote pseudo untouched while a sibling textual marker materializes', () => {
    const preview = quotePreview(
      '<blockquote id="empty"><p>Empty</p></blockquote><blockquote id="paint"><p>Paint</p></blockquote>'
    );
    const runtime = {
      ...runtimeFor(),
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if ('BLOCKQUOTE' === element.tagName && '::before' === pseudoElement) {
          return 'empty' === element.id
            ? style({ ...PSEUDO_DEFAULTS, content: '""' })
            : style(PSEUDO_DEFAULTS);
        }
        return runtimeFor().getComputedStyle(element, pseudoElement);
      }
    };
    const source = preview.innerHTML;
    try {
      const clone = createMarkupSynchronously(preview, runtime);
      if (!clone) throw new Error('quote serialization missing');
      const owners = Array.from(clone.querySelectorAll(':scope > section'));
      expect(owners).toHaveLength(2);
      const carriers = owners.filter((owner) => owner.querySelector(':scope > section'));
      expect(carriers).toHaveLength(1);
      const painted = carriers[0];
      const empty = owners.find((owner) => owner !== painted);
      expect(empty?.querySelector(':scope > span[aria-hidden="true"][style*="font-size:0"]')).not.toBeNull();
      expect(empty?.querySelector(':scope > section')).toBeNull();
      expect(painted?.querySelector(':scope > span[aria-hidden="true"]')).not.toBeNull();
      expect(painted?.querySelector(':scope > section')).not.toBeNull();
      expect(preview.innerHTML).toBe(source);
    } finally {
      preview.remove();
    }
  });

  it('binds nested quotes locally without an ordinal or theme selector', () => {
    const preview = quotePreview(
      '<blockquote id="outer"><blockquote id="inner"><p>Nested</p></blockquote></blockquote>'
    );
    const runtime = runtimeFor();
    const source = preview.innerHTML;
    try {
      const clone = createMarkupSynchronously(preview, runtime);
      if (!clone) throw new Error('nested quote serialization missing');
      const outer = clone.querySelector(':scope > section');
      const inner = outer?.querySelector(':scope > span[aria-hidden="true"] + section > section');
      expect(outer?.querySelector(':scope > span[aria-hidden="true"]')).not.toBeNull();
      expect(inner?.querySelector(':scope > span[aria-hidden="true"]')).not.toBeNull();
      expect(clone.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2);
      const nestedCarriers = [outer, inner]
        .map((owner) => owner?.querySelector(':scope > section'))
        .filter((carrier): carrier is Element => Boolean(carrier));
      expect(nestedCarriers).toHaveLength(2);
      expect(inner).not.toBeNull();
      expect(inner?.querySelector(':scope > span[aria-hidden="true"]')).not.toBeNull();
      expect(preview.innerHTML).toBe(source);
    } finally {
      preview.remove();
    }
  });

  it('does not reframe a non-absolute nonempty quote pseudo', () => {
    const preview = quotePreview();
    const runtime = runtimeFor({}, { position: 'relative' });
    try {
      const clone = createMarkupSynchronously(preview, runtime);
      if (!clone) throw new Error('quote serialization missing');
      const marker = clone.querySelector('span[aria-hidden="true"]');
      expect(marker?.getAttribute('style')).toContain('position:relative');
      expect(marker?.getAttribute('style')).not.toContain('float:left!important');
    } finally {
      preview.remove();
    }
  });

  it('keeps async and synchronous payload geometry identical', async () => {
    const preview = quotePreview();
    const runtime = runtimeFor();
    const source = preview.innerHTML;
    try {
      const syncPayload = serializeClipboardPayloadSynchronously(preview, runtime);
      const asyncClone = await createMarkup(preview, runtime, new Map());
      const asyncPayload = asyncClone.outerHTML;
      expect(syncPayload?.html).toBe(asyncPayload);
      expect(preview.innerHTML).toBe(source);
    } finally {
      preview.remove();
    }
  });

  it('exposes one stable installation per marker and leaves authored order intact', () => {
    const preview = quotePreview('<blockquote><p>One</p><p>Two</p></blockquote>');
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const runtime = runtimeFor();
    const cloneOwner = source.cloneNode(true) as HTMLElement;
    const marker = document.createElement('span');
    marker.textContent = '✨';
    marker.setAttribute('aria-hidden', 'true');
    cloneOwner.insertBefore(marker, cloneOwner.firstChild);
    const planned = planQuotePseudoFlow({
      clone: cloneOwner,
      dimensionSemantics: null,
      getComputedStyle: runtime.getComputedStyle,
      marker,
      pseudo: '::before',
      pseudoComputed: runtime.getComputedStyle(source, '::before'),
      source
    });
    if (!planned) throw new Error('quote plan missing');
    try {
      const collector: QuotePseudoFlowCollector = { expectations: [] };
      applyQuotePseudoFlow(cloneOwner, marker, planned, collector);
      const carrier = cloneOwner.querySelector(':scope > section');
      expect(collector.expectations).toHaveLength(1);
      expect(carrier?.querySelectorAll('p')).toHaveLength(2);
      expect(Array.from(carrier?.querySelectorAll('p') ?? []).map((element) => element.textContent)).toEqual([
        'One',
        'Two'
      ]);
      expect(marker.parentElement).toBe(cloneOwner);
      expect(cloneOwner.querySelectorAll(':scope > span[aria-hidden="true"]')).toHaveLength(1);
    } finally {
      preview.remove();
    }
  });

  it('detects a source mutation at final validation and keeps clone ownership intact', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    const cloneOwner = source.cloneNode(true) as Element;
    const runtime = runtimeFor();
    const marker = document.createElement('span');
    marker.textContent = '✨';
    marker.setAttribute('aria-hidden', 'true');
    cloneOwner.insertBefore(marker, cloneOwner.firstChild);
    const planned = planQuotePseudoFlow({
      clone: cloneOwner,
      dimensionSemantics: null,
      getComputedStyle: runtime.getComputedStyle,
      marker,
      pseudo: '::before',
      pseudoComputed: runtime.getComputedStyle(source, '::before'),
      source
    });
    if (!planned) throw new Error('quote plan missing');
    applyQuotePseudoFlow(cloneOwner, marker, planned);
    const finalized = cloneOwner.ownerDocument.createElement('div');
    finalized.append(cloneOwner);
    try {
      source.setAttribute('data-source-mutated', '1');
      expect(() => assertQuotePseudoFlows([{ carrier: cloneOwner.querySelector(':scope > section') as HTMLElement, marker, markerPaintSignature: planned.markerPaintSignature, markerText: planned.markerText, owner: cloneOwner, plan: planned }], finalized)).toThrow(
        'wechat-quote-pseudo-final-source-mismatch'
      );
      expect(cloneOwner.parentElement).toBe(finalized);
    } finally {
      source.removeAttribute('data-source-mutated');
      preview.remove();
    }
  });

  it('publishes nothing when the preparation signal is already cancelled', async () => {
    const preview = quotePreview();
    const runtime = runtimeFor();
    const controller = new AbortController();
    const source = preview.innerHTML;
    controller.abort();
    try {
      await expect(createMarkup(preview, runtime, new Map(), null, undefined, controller.signal)).rejects.toThrow(
        'wechat-background-preparation-cancelled'
      );
      expect(preview.innerHTML).toBe(source);
    } finally {
      preview.remove();
    }
  });

  it('rejects marker font mutation at final ownership validation', () => {
    const preview = quotePreview();
    const clone = preview.cloneNode(true) as HTMLElement;
    const source = preview.querySelector('blockquote');
    const cloneOwner = clone.querySelector('blockquote');
    if (!(source instanceof Element) || !(cloneOwner instanceof Element)) throw new Error('quote clone missing');
    const runtime = runtimeFor();
    const marker = document.createElement('span');
    marker.textContent = '✨';
    marker.setAttribute('style', 'font-size:20px;font-family:emoji');
    cloneOwner.insertBefore(marker, cloneOwner.firstChild);
    const planned = planQuotePseudoFlow({
      clone: cloneOwner,
      dimensionSemantics: null,
      getComputedStyle: runtime.getComputedStyle,
      marker,
      pseudo: '::before',
      pseudoComputed: runtime.getComputedStyle(source, '::before'),
      source
    });
    if (!planned) throw new Error('quote plan missing');
    applyQuotePseudoFlow(cloneOwner, marker, planned);
    const carrier = cloneOwner.querySelector(':scope > section') as HTMLElement;
    const finalized = clone.ownerDocument.createElement('div');
    const replacement = clone.ownerDocument.createElement('section');
    Array.from(cloneOwner.attributes).forEach((attribute) => {
      replacement.setAttribute(attribute.name, attribute.value);
    });
    while (cloneOwner.firstChild) replacement.appendChild(cloneOwner.firstChild);
    finalized.append(replacement);
    WECHAT_STRUCTURE_REPLACEMENTS.set(cloneOwner, replacement);
    replacement.setAttribute(
      'style',
      'padding-top:0px!important;padding-right:0px!important;padding-bottom:0px!important;padding-left:0px!important'
    );
    const expectation = {
      carrier,
      marker,
      markerPaintSignature: planned.markerPaintSignature,
      markerText: planned.markerText,
      owner: cloneOwner,
      plan: planned
    };
    try {
      expect(() => assertQuotePseudoFlows([expectation], finalized)).not.toThrow();
      marker.setAttribute(
        'style',
        `${marker.getAttribute('style') ?? ''};font-size:99px!important`
      );
      expect(() => assertQuotePseudoFlows([expectation], finalized)).toThrow(
        'wechat-quote-pseudo-final-marker-mismatch'
      );
    } finally {
      preview.remove();
    }
  });

  it('invalidates freshness when any owner, pseudo, or after admission input changes', () => {
    const preview = quotePreview();
    const source = preview.querySelector('blockquote');
    if (!(source instanceof Element)) throw new Error('quote source missing');
    try {
      const baseline = quotePseudoFlowFreshnessSignature(
        source,
        runtimeFor(),
        dimensionSemanticsFor()
      );
      const changedOwner = quotePseudoFlowFreshnessSignature(
        source,
        runtimeFor(),
        dimensionSemanticsFor({ width: '80px' })
      );
      const changedPseudo = quotePseudoFlowFreshnessSignature(
        source,
        runtimeFor({}, { 'max-width': '20px' }),
        dimensionSemanticsFor({}, { 'max-width': '20px' })
      );
      const changedAfter = quotePseudoFlowFreshnessSignature(
        source,
        runtimeFor({}, {}, { content: '"after"', display: 'block' }),
        dimensionSemanticsFor()
      );
      expect(baseline).not.toBe(changedOwner);
      expect(baseline).not.toBe(changedPseudo);
      expect(baseline).not.toBe(changedAfter);
      expect(changedOwner).not.toBe(changedPseudo);
      expect(changedOwner).not.toBe(changedAfter);
      expect(changedPseudo).not.toBe(changedAfter);
    } finally {
      preview.remove();
    }
  });

  it('normalizes marker min/max bounds after admission so the full projection can narrow', () => {
    const preview = quotePreview();
    const runtime = runtimeFor();
    const planSnapshot = planQuotePseudoFlow({
      clone: preview.querySelector('blockquote')?.cloneNode(true) as Element,
      dimensionSemantics: null,
      getComputedStyle: runtime.getComputedStyle,
      marker: (() => {
        const marker = document.createElement('span');
        marker.textContent = '✨';
        return marker;
      })(),
      pseudo: '::before',
      pseudoComputed: runtime.getComputedStyle(preview.querySelector('blockquote') as Element, '::before'),
      source: preview.querySelector('blockquote') as Element
    });
    try {
      expect(planSnapshot).not.toBeNull();
      const clone = createMarkupSynchronously(preview, runtime);
      if (!clone) throw new Error('quote serialization missing');
      const marker = clone.querySelector('span[aria-hidden="true"]');
      expect(marker?.getAttribute('style')).toContain('min-width:0!important');
      expect(marker?.getAttribute('style')).toContain('max-width:none!important');
      expect(marker?.getAttribute('style')).toContain('min-height:0!important');
      expect(marker?.getAttribute('style')).toContain('max-height:none!important');
    } finally {
      preview.remove();
    }
  });

  it('serializes a quote-only carrier after structure normalization in sync markup', () => {
    const preview = quotePreview();
    const runtime = runtimeFor();
    const source = preview.innerHTML;
    try {
      const clone = createMarkupSynchronously(preview, runtime);
      if (!clone) throw new Error('quote serialization missing');
      const owner = clone.matches('blockquote')
        ? clone
        : clone.querySelector('blockquote');
      const section = owner?.tagName === 'SECTION' ? owner : clone.querySelector('section');
      const marker = clone.querySelector('span[aria-hidden="true"]');
      const carrier = section?.querySelector(':scope > section');
      expect(marker).not.toBeNull();
      expect(marker?.getAttribute('style')).toContain('float:left');
      expect(carrier).not.toBeNull();
      expect(carrier?.getAttribute('style')).toContain('padding-top:18px!important');
      expect(carrier?.getAttribute('style')).toContain('padding-right:20px!important');
      expect(carrier?.getAttribute('style')).toContain('padding-bottom:18px!important');
      expect(carrier?.getAttribute('style')).toContain('padding-left:48px!important');
      expect(preview.innerHTML).toBe(source);
    } finally {
      preview.remove();
    }
  });
});
