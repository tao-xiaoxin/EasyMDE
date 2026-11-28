import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import {
  declaration,
  installClipboardTestEnvironment
} from './wechat-clipboard-test-fixtures';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { collectPreparedSignatures, preparedDimensionGeometrySignature } from './wechat-fidelity-signature';
import {
  createMarkup,
  createMarkupSynchronously
} from './wechat-portable-serialization';
import {
  applySvgMarkerProjection,
  planSvgMarkerProjection,
  type WechatSvgCloneIdentity,
  type WechatSvgMarkerProjectionOptions
} from './wechat-svg-marker-projection';

const SVG_DEFAULTS: Readonly<Record<string, string>> = {
  color: 'rgb(17, 34, 51)',
  display: 'inline',
  fill: 'rgb(17, 34, 51)',
  'fill-opacity': '1',
  'fill-rule': 'nonzero',
  'marker-end': 'none',
  'marker-mid': 'none',
  'marker-start': 'none',
  'mix-blend-mode': 'normal',
  opacity: '1',
  overflow: 'hidden',
  'paint-order': 'normal',
  'shape-rendering': 'auto',
  stroke: 'none',
  'stroke-dasharray': 'none',
  'stroke-dashoffset': '0',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  'stroke-opacity': '1',
  'stroke-width': '1px',
  'transform-box': 'view-box',
  'transform-origin': '0px 0px',
  transform: 'none',
  visibility: 'visible'
};

const SVG_FRESHNESS_CASES = {
  'mix-blend-mode': { changed: 'multiply', initial: 'normal' },
  'stroke-miterlimit': { changed: '9', initial: '4' },
  'transform-box': { changed: 'fill-box', initial: 'view-box' },
  visibility: { changed: 'hidden', initial: 'visible' }
} as const;

function markerRuntime(
  override?: (element: Element, pseudoElement?: string) => CSSStyleDeclaration | null
): BrowserWechatClipboardRuntime {
  return {
    blob: Blob,
    clipboardItem: null,
    document,
    getComputedStyle: (element, pseudoElement) => {
      const custom = override?.(element, pseudoElement);
      if (custom) return custom;
      if (pseudoElement) return declaration({ content: 'none', display: 'none' });
      if (element.closest('svg')) {
        const markerEnd = element.localName.toLowerCase() === 'line' ? 'url(#arrow)' : 'none';
        return declaration({
          ...SVG_DEFAULTS,
          'marker-end': markerEnd,
          stroke: element.localName.toLowerCase() === 'line' ? 'rgb(17, 34, 51)' : 'none',
          'stroke-width': element.localName.toLowerCase() === 'line' ? '1px' : '1px'
        });
      }
      if ('INPUT' === element.tagName) {
        return declaration({
          appearance: 'none',
          display: 'inline-block',
          height: '16px',
          position: 'static',
          width: '16px'
        });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    },
    getSelection: () => window.getSelection(),
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: vi.fn(),
    write: null
  };
}

function markerPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = [
    '<div class="easymde-mermaid">',
    '<svg id="flow" viewBox="0 0 40 20">',
    '<defs><marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
    '<path d="M 0,0 V 4 L6,2 Z"></path></marker></defs>',
    '<line id="edge" x1="2" y1="10" x2="30" y2="10" marker-end="url(#arrow)"></line>',
    '</svg></div>'
  ].join('');
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Flow' });
  return preview;
}

function projectedViewportAfter(element: Element | null): SVGSVGElement | null {
  const sibling = element?.nextElementSibling ?? null;
  if (sibling instanceof SVGSVGElement) return sibling;
  const nested = sibling?.querySelector('svg') ?? null;
  return nested instanceof SVGSVGElement ? nested : null;
}

function renderedHolder(markup: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  return holder;
}

function assertProjectedMarker(holder: HTMLElement): void {
  const edge = holder.querySelector('svg#flow > line#edge');
  if (!edge) throw new Error('wechat-svg-marker-integration-edge-missing');
  expect(edge.getAttribute('marker-end')).toBe('none');
  const projected = projectedViewportAfter(edge);
  if (!projected) throw new Error('wechat-svg-marker-integration-viewport-missing');
  expect(projected.getAttribute('viewBox')).toBe('0 0 6 4');
  expect(projected.getAttribute('width')).toBe('6');
  expect(projected.getAttribute('height')).toBe('4');
  expect(projected.querySelector('path')?.getAttribute('d')).toBe('M 0,0 V 4 L6,2 Z');
  expect(holder.querySelector('marker#arrow')).toBeNull();
}

function identityMap(sourceRoot: Element, cloneRoot: Element): Map<Element, Element> {
  const sources = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const clones = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
  const identity = new Map<Element, Element>();
  sources.forEach((source, index) => {
    const clone = clones[index];
    if (clone) identity.set(source, clone);
  });
  return identity;
}

function identityFromMap(identity: Map<Element, Element>): (source: Element) => WechatSvgCloneIdentity | null {
  return (source) => {
    const clone = identity.get(source);
    return clone ? { clone, state: 'present' } : null;
  };
}

function projectionOptions(sourceSvg: SVGSVGElement, cloneSvg: SVGSVGElement): WechatSvgMarkerProjectionOptions {
  return {
    cloneIdentityFor: identityFromMap(identityMap(sourceSvg, cloneSvg)),
    cloneSvg,
    getComputedStyle: (element) => {
      const computed = markerRuntime().getComputedStyle(element);
      return computed;
    },
    sourceSvg
  };
}

describe('createBrowserWechatClipboard SVG marker production integration', () => {
  installClipboardTestEnvironment();

  it('projects the same marker geometry in async and synchronous OFF paths without writing Source', async () => {
    const asyncPreview = markerPreview();
    const syncPreview = markerPreview();
    const asyncSource = asyncPreview.innerHTML;
    const syncSource = syncPreview.innerHTML;
    const runtime = markerRuntime();

    const asyncClone = await createMarkup(asyncPreview, runtime, new Map());
    const syncClone = createMarkupSynchronously(syncPreview, runtime);
    if (!syncClone) throw new Error('wechat-svg-marker-integration-sync-clone-missing');

    const asyncHolder = renderedHolder(asyncClone.outerHTML);
    const syncHolder = renderedHolder(syncClone.outerHTML);
    assertProjectedMarker(asyncHolder);
    assertProjectedMarker(syncHolder);
    expect(asyncHolder.innerHTML).toBe(syncHolder.innerHTML);
    expect(asyncPreview.innerHTML).toBe(asyncSource);
    expect(syncPreview.innerHTML).toBe(syncSource);
  });

  it('keeps identity after KaTeX, task ownership, SVG style removal, and foreignObject finalization', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<span class="katex"><span class="katex-html">x</span></span>',
      '<ul class="task-list"><li class="task-list-item"><section>',
      '<input class="easymde-task-checkbox" type="checkbox">Task',
      '</section></li></ul>',
      '<div class="easymde-mermaid"><svg id="flow" viewBox="0 0 40 20">',
      '<style>.edge{stroke:red}</style>',
      '<defs><marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
      '<path d="M 0,0 V 4 L6,2 Z"></path></marker></defs>',
      '<foreignObject x="2" y="2" width="8" height="6"><div>Label</div></foreignObject>',
      '<line id="edge" x1="2" y1="10" x2="30" y2="10" marker-end="url(#arrow)"></line>',
      '</svg></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'x Task Label' });
    const source = preview.innerHTML;

    const clone = await createMarkup(preview, markerRuntime(), new Map());
    const holder = renderedHolder(clone.outerHTML);
    assertProjectedMarker(holder);
    expect(holder.querySelector('style')).toBeNull();
    expect(holder.querySelector('foreignObject nobr')).not.toBeNull();
    expect(holder.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(preview.innerHTML).toBe(source);
  });

  it('projects markers inside a visibility:hidden group with visible children in async and sync paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="flow" viewBox="0 0 40 20">',
      '<defs><marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
      '<g visibility="hidden" transform="scale(2)"><path visibility="visible" d="M 0,0 V 4 L6,2 Z"></path></g>',
      '</marker></defs>',
      '<line id="edge" x1="2" y1="10" x2="30" y2="10" marker-end="url(#arrow)"></line>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Flow' });
    const runtime = markerRuntime((element) => {
      if ('g' === element.localName.toLowerCase()) return declaration({ ...SVG_DEFAULTS, visibility: 'hidden', transform: 'scale(2)' });
      if ('path' === element.localName.toLowerCase()) return declaration({ ...SVG_DEFAULTS, visibility: 'visible', fill: 'rgb(17, 34, 51)' });
      return null;
    });

    const asyncClone = await createMarkup(preview, runtime, new Map());
    const syncClone = createMarkupSynchronously(preview, runtime);
    if (!syncClone) throw new Error('sync-clone-missing');

    for (const clone of [asyncClone, syncClone]) {
      const holder = renderedHolder(clone.outerHTML);
      const edge = holder.querySelector('line#edge');
      expect(edge?.getAttribute('marker-end')).toBe('none');
      const projected = projectedViewportAfter(edge);
      expect(projected).not.toBeNull();
      const gNode = projected?.querySelector('g');
      expect(gNode).not.toBeNull();
      expect(gNode?.getAttribute('visibility')).toBe('hidden');
      expect(gNode?.getAttribute('transform')).toBe('scale(2)');
      const pathNode = gNode?.querySelector('path');
      expect(pathNode?.getAttribute('visibility')).toBe('visible');
      expect(pathNode?.getAttribute('d')).toBe('M 0,0 V 4 L6,2 Z');
    }
  });

  it('projects line markers with omitted coordinates defaulting to 0 in async and sync paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="flow" viewBox="0 0 40 20">',
      '<defs><marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
      '<path d="M 0,0 V 4 L6,2 Z"></path></marker></defs>',
      '<line id="edge" x2="30" marker-end="url(#arrow)"></line>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Flow' });
    const runtime = markerRuntime();

    const asyncClone = await createMarkup(preview, runtime, new Map());
    const syncClone = createMarkupSynchronously(preview, runtime);
    if (!syncClone) throw new Error('sync-clone-missing');

    for (const clone of [asyncClone, syncClone]) {
      const holder = renderedHolder(clone.outerHTML);
      const edge = holder.querySelector('line#edge');
      expect(edge?.getAttribute('marker-end')).toBe('none');
      const projected = projectedViewportAfter(edge);
      expect(projected).not.toBeNull();
      // x2=30, x1/y1/y2 default to 0 -> horizontal line of length 30 from (0,0) to (30,0)
      expect(projected?.getAttribute('viewBox')).toBe('0 0 6 4');
      expect(holder.querySelector('marker#arrow')).toBeNull();
    }
  });

  it('does not read marker styles inside PNG-owned roots while ordinary SVG still projects', () => {
    const sourceHolder = document.createElement('div');
    sourceHolder.innerHTML = [
      '<div class="easymde-mermaid"><svg id="png-svg"><line marker-end="url(#png-arrow)"></line></svg></div>',
      '<svg id="ordinary"><line id="ordinary-edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#arrow)"></line>',
      '<defs><marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
      '<path d="M 0,0 V 4 L6,2 Z"></path></marker></defs></svg>'
    ].join('');
    const cloneHolder = sourceHolder.cloneNode(true) as HTMLDivElement;
    const sourcePngSvg = sourceHolder.querySelector<SVGSVGElement>('#png-svg');
    const clonePngSvg = cloneHolder.querySelector<SVGSVGElement>('#png-svg');
    const sourceOrdinary = sourceHolder.querySelector<SVGSVGElement>('#ordinary');
    const cloneOrdinary = cloneHolder.querySelector<SVGSVGElement>('#ordinary');
    const sourcePngRoot = sourceHolder.querySelector('.easymde-mermaid');
    const clonePngRoot = cloneHolder.querySelector('.easymde-mermaid');
    if (!sourcePngSvg || !clonePngSvg || !sourceOrdinary || !cloneOrdinary || !sourcePngRoot || !clonePngRoot) {
      throw new Error('wechat-svg-marker-integration-png-fixture-missing');
    }
    const identity = identityFromMap(identityMap(sourceHolder, cloneHolder));
    const excludedRoots = new Set<Element>([sourcePngRoot, clonePngRoot]);
    let pngStyleReads = 0;
    const pngPlan = planSvgMarkerProjection({
      cloneIdentityFor: identity,
      cloneSvg: clonePngSvg,
      excludedRoots,
      getComputedStyle: () => {
        pngStyleReads += 1;
        throw new Error('wechat-svg-marker-integration-png-style-read');
      },
      sourceSvg: sourcePngSvg
    });
    expect(pngPlan.items).toEqual([]);
    expect(pngStyleReads).toBe(0);

    let ordinaryStyleReads = 0;
    const ordinaryPlan = planSvgMarkerProjection({
      cloneIdentityFor: identity,
      cloneSvg: cloneOrdinary,
      excludedRoots,
      getComputedStyle: (element) => {
        ordinaryStyleReads += 1;
        return markerRuntime().getComputedStyle(element);
      },
      sourceSvg: sourceOrdinary
    });
    expect(ordinaryPlan.items).toHaveLength(1);
    expect(ordinaryStyleReads).toBeGreaterThan(0);
  });

  it.each(Object.keys(SVG_FRESHNESS_CASES) as Array<keyof typeof SVG_FRESHNESS_CASES>)(
    'invalidates every shared SVG freshness sink when %s changes',
    (property) => {
      const preview = document.createElement('article');
      preview.innerHTML = '<svg><line x1="0" y1="0" x2="10" y2="0"></line></svg>';
      const svg = preview.querySelector('svg');
      if (!svg) throw new Error('wechat-svg-marker-integration-freshness-svg-missing');
      let changed = false;
      const runtime = markerRuntime((element, pseudoElement) => {
        if (pseudoElement || !element.closest('svg')) return null;
        const values = SVG_FRESHNESS_CASES[property];
        return declaration({
          ...SVG_DEFAULTS,
          [property]: changed ? values.changed : values.initial
        });
      });
      const initialLayout = collectPreparedSignatures({ preview, runtime, includeDimension: false }).layout;
      const initialGeometry = preparedDimensionGeometrySignature(preview, runtime, null);
      const initialSemantics = collectPreparedSignatures({ preview, runtime }).dimension;
      changed = true;
      expect.soft(collectPreparedSignatures({ preview, runtime, includeDimension: false }).layout, `${property}:layout`).not.toBe(initialLayout);
      expect.soft(
        preparedDimensionGeometrySignature(preview, runtime, null),
        `${property}:geometry`
      ).not.toBe(initialGeometry);
      expect.soft(
        collectPreparedSignatures({ preview, runtime }).dimension,
        `${property}:semantics`
      ).not.toBe(initialSemantics);
    }
  );

  it('fails a detached planned node explicitly, performs no Clipboard write, and leaves Source unchanged', async () => {
    const preview = markerPreview();
    const sourceSvg = preview.querySelector<SVGSVGElement>('svg#flow');
    if (!sourceSvg) throw new Error('wechat-svg-marker-integration-detached-source-missing');
    const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    const plan = planSvgMarkerProjection(projectionOptions(sourceSvg, cloneSvg));
    cloneSvg.querySelector('#edge')?.remove();
    const source = preview.innerHTML;
    expect(() => applySvgMarkerProjection(plan)).toThrowError(
      'wechat-svg-marker-projection-clone-element-detached'
    );

    const write = vi.fn(async () => undefined);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const controller = new AbortController();
    controller.abort();
    const clipboard = createBrowserWechatClipboard({
      ...markerRuntime(),
      clipboardItem: ClipboardItemStub,
      write
    });
    await expect(clipboard.copy(preview, { signal: controller.signal })).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(write).not.toHaveBeenCalled();
    expect(preview.innerHTML).toBe(source);
    expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
    expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
  });

  function nestedReferencePreview(contentMarkerAttribute = ''): HTMLElement {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="flow" viewBox="0 0 40 20">',
      '<defs>',
      '<marker id="nested" markerWidth="4" markerHeight="4" refX="0" refY="0" orient="auto">',
      '<path d="M 0,0 L 4,2"></path></marker>',
      '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
      `<line id="arrow-content" x1="0" y1="0" x2="6" y2="2"${contentMarkerAttribute}></line>`,
      '</marker>',
      '</defs>',
      '<line id="edge" x1="2" y1="10" x2="30" y2="10" marker-end="url(#arrow)"></line>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Flow' });
    return preview;
  }

  function nestedContainerReferencePreview(): HTMLElement {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="flow" viewBox="0 0 40 20">',
      '<defs>',
      '<marker id="nested" markerWidth="4" markerHeight="4" refX="0" refY="0" orient="auto">',
      '<path d="M 0,0 L 4,2"></path></marker>',
      '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">',
      '<g id="arrow-container" marker-end="url(#nested)">',
      '<line id="arrow-content" x1="0" y1="0" x2="6" y2="2"></line>',
      '</g>',
      '</marker>',
      '</defs>',
      '<line id="edge" x1="2" y1="10" x2="30" y2="10" marker-end="url(#arrow)"></line>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Flow' });
    return preview;
  }

  /**
   * A nested reference inside marker content has no presentational or
   * structural owner in the payload: the projected content drops every marker
   * declaration, so the copy must fail explicitly instead of losing it.
   */
  it('fails an effective nested marker reference inside marker content in async and synchronous paths', async () => {
    const contentLineOverride = (element: Element): CSSStyleDeclaration | null =>
      element.closest('marker') && 'line' === element.localName.toLowerCase()
        ? declaration({ ...SVG_DEFAULTS, 'marker-end': 'url("#nested")' })
        : null;
    // `marker-*` inherit, so the declaration on the <marker> element is the
    // effective value a browser reports for the shape that renders it.
    const cssRuntime = markerRuntime(contentLineOverride);
    const inheritedRuntime = markerRuntime((element) =>
      'marker' === element.localName.toLowerCase()
        ? declaration({ ...SVG_DEFAULTS, 'marker-end': 'url("#nested")' })
        : contentLineOverride(element)
    );

    for (const runtime of [cssRuntime, inheritedRuntime]) {
      const asyncPreview = nestedReferencePreview();
      const asyncSource = asyncPreview.innerHTML;
      await expect(createMarkup(asyncPreview, runtime, new Map())).rejects.toThrow(
        'wechat-svg-marker-projection-content-marker-reference-unsupported'
      );
      expect(asyncPreview.innerHTML).toBe(asyncSource);

      const syncPreview = nestedReferencePreview();
      const syncSource = syncPreview.innerHTML;
      expect(() => createMarkupSynchronously(syncPreview, runtime)).toThrowError(
        'wechat-svg-marker-projection-content-marker-reference-unsupported'
      );
      expect(syncPreview.innerHTML).toBe(syncSource);
    }
  });

  it('keeps content whose computed marker none overrides a raw marker URL in async and synchronous paths', async () => {
    const runtime = markerRuntime((element) =>
      element.closest('marker') && 'line' === element.localName.toLowerCase()
        ? declaration({ ...SVG_DEFAULTS, 'marker-end': 'none' })
        : null
    );
    const asyncPreview = nestedReferencePreview(' marker-end="url(#nested)"');
    const syncPreview = nestedReferencePreview(' marker-end="url(#nested)"');
    const asyncSource = asyncPreview.innerHTML;
    const syncSource = syncPreview.innerHTML;

    const asyncClone = await createMarkup(asyncPreview, runtime, new Map());
    const syncClone = createMarkupSynchronously(syncPreview, runtime);
    if (!syncClone) throw new Error('wechat-svg-marker-integration-sync-clone-missing');

    for (const clone of [asyncClone, syncClone]) {
      const holder = renderedHolder(clone.outerHTML);
      const edge = holder.querySelector('line#edge');
      if (!edge) throw new Error('wechat-svg-marker-integration-edge-missing');
      expect(edge.getAttribute('marker-end')).toBe('none');
      const projected = projectedViewportAfter(edge);
      expect(projected?.getAttribute('viewBox')).toBe('0 0 6 4');
      const projectedContent = projected?.querySelector('line');
      expect(projectedContent).not.toBeNull();
      expect(projectedContent?.getAttribute('marker-end')).toBeNull();
    }
    expect(asyncPreview.innerHTML).toBe(asyncSource);
    expect(syncPreview.innerHTML).toBe(syncSource);
  });

  it('keeps content when a container has a marker URL but child shape has computed none in async and sync paths', async () => {
    // Hidden container with marker-end URL; visible child line with computed none
    const runtime = markerRuntime((element) => {
      const id = element.getAttribute('id');
      if ('arrow-container' === id) {
        return declaration({
          ...SVG_DEFAULTS,
          visibility: 'hidden',
          'marker-end': 'url("#nested")'
        });
      }
      if ('arrow-content' === id) {
        return declaration({
          ...SVG_DEFAULTS,
          visibility: 'visible',
          'marker-start': 'none',
          'marker-mid': 'none',
          'marker-end': 'none'
        });
      }
      return null;
    });

    const asyncPreview = nestedContainerReferencePreview();
    const syncPreview = nestedContainerReferencePreview();
    const asyncSource = asyncPreview.innerHTML;
    const syncSource = syncPreview.innerHTML;

    const asyncClone = await createMarkup(asyncPreview, runtime, new Map());
    const syncClone = createMarkupSynchronously(syncPreview, runtime);
    if (!syncClone) throw new Error('wechat-svg-marker-integration-sync-clone-missing');

    for (const clone of [asyncClone, syncClone]) {
      const holder = renderedHolder(clone.outerHTML);
      const edge = holder.querySelector('line#edge');
      if (!edge) throw new Error('wechat-svg-marker-integration-edge-missing');
      expect(edge.getAttribute('marker-end')).toBe('none');
      const projected = projectedViewportAfter(edge);
      expect(projected?.getAttribute('viewBox')).toBe('0 0 6 4');
      const container = projected?.querySelector('g');
      expect(container).not.toBeNull();
      expect(container?.getAttribute('marker-end')).toBeNull();
      expect(container?.getAttribute('visibility')).toBe('hidden');
      const childLine = container?.querySelector('line');
      expect(childLine).not.toBeNull();
      expect(childLine?.getAttribute('marker-end')).toBeNull();
      expect(childLine?.getAttribute('visibility')).toBe('visible');
    }
    expect(asyncPreview.innerHTML).toBe(asyncSource);
    expect(syncPreview.innerHTML).toBe(syncSource);
  });

  it('fails when a marker child shape inherits a container marker URL in async and sync paths', async () => {
    // Container has marker URL; child does not override it, so child inherits
    const runtime = markerRuntime((element) => {
      const id = element.getAttribute('id');
      if ('arrow-container' === id || 'arrow-content' === id) {
        return declaration({
          ...SVG_DEFAULTS,
          'marker-end': 'url("#nested")'
        });
      }
      return null;
    });

    const asyncPreview = nestedContainerReferencePreview();
    const syncPreview = nestedContainerReferencePreview();
    const asyncSource = asyncPreview.innerHTML;
    const syncSource = syncPreview.innerHTML;

    await expect(createMarkup(asyncPreview, runtime, new Map())).rejects.toThrow(
      'wechat-svg-marker-projection-content-marker-reference-unsupported'
    );
    expect(asyncPreview.innerHTML).toBe(asyncSource);

    expect(() => createMarkupSynchronously(syncPreview, runtime)).toThrowError(
      'wechat-svg-marker-projection-content-marker-reference-unsupported'
    );
    expect(syncPreview.innerHTML).toBe(syncSource);
  });
});
