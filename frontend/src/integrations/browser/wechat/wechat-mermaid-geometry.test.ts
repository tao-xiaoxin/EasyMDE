import { describe, expect, it } from 'vitest';

import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { declaration, installClipboardTestEnvironment } from './wechat-clipboard-test-fixtures';
import {
  mermaidAdmissionSignature,
  mermaidEdgeValues,
  mermaidEdgeValuesAnyPositive,
  mermaidRootPaintIsSafe,
  mermaidSvgRectMagnification,
} from './wechat-mermaid-geometry';
import { computeMermaidLayoutMagnification } from './wechat-mermaid-paint-policy';

describe('mermaidAdmissionSignature', () => {
  installClipboardTestEnvironment();

  const fixture = (): Readonly<{
    preview: HTMLElement;
    root: HTMLElement;
    source: Record<string, string>;
    svg: SVGSVGElement;
    svgStyle: Record<string, string>;
  }> => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100%" height="auto" viewBox="0 0 350 726">' +
      '<rect width="350" height="726"></rect></svg></div>';
    const root = preview.querySelector<HTMLElement>('.easymde-mermaid');
    const svg = preview.querySelector<SVGSVGElement>('svg');
    if (!root || !svg) throw new Error('Mermaid admission fixture missing');
    Object.defineProperty(root, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            'block-size': 'auto',
            height: 'auto',
            'max-block-size': 'none',
            'max-height': 'none',
            'max-width': '100%',
            'min-block-size': 'auto',
            'min-height': 'auto'
          }[property] ?? 'auto'
        })
      })
    });
    Object.defineProperty(svg, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            height: 'auto',
            'margin-left': 'auto',
            'margin-right': 'auto',
            'max-height': 'none',
            'max-width': '350px',
            width: '100%'
          }[property] ?? 'none'
        })
      })
    });
    return {
      preview,
      root,
      source: {
        background: 'none',
        'background-color': 'rgb(248, 246, 239)',
        'background-image': 'none',
        'border-bottom-style': 'none',
        'border-bottom-width': '0px',
        'border-image-source': 'none',
        'border-left-style': 'none',
        'border-left-width': '0px',
        'border-radius': '12px',
        'border-right-style': 'none',
        'border-right-width': '0px',
        'border-top-style': 'none',
        'border-top-width': '0px',
        'box-shadow': 'none',
        'box-sizing': 'border-box',
        'clip-path': 'none',
        display: 'block',
        filter: 'none',
        float: 'none',
        height: 'auto',
        mask: 'none',
        'mask-image': 'none',
        'max-height': 'none',
        'max-width': '100%',
        opacity: '1',
        'outline-style': 'none',
        overflow: 'auto',
        'overflow-x': 'auto',
        'overflow-y': 'auto',
        'padding-bottom': '10px',
        'padding-left': '10px',
        'padding-right': '10px',
        'padding-top': '10px',
        position: 'static',
        top: 'auto',
        right: 'auto',
        bottom: 'auto',
        left: 'auto',
        transform: 'none',
        width: '940px'
      },
      svg,
      svgStyle: {
        'border-bottom-style': 'none',
        'border-bottom-width': '0px',
        'border-left-style': 'none',
        'border-left-width': '0px',
        'border-right-style': 'none',
        'border-right-width': '0px',
        'border-top-style': 'none',
        'border-top-width': '0px',
        display: 'block',
        height: 'auto',
        'margin-left': 'auto',
        'margin-right': 'auto',
        'max-height': 'none',
        'max-width': '350px',
        width: '350px'
      }
    };
  };

  const runtime = (
    root: HTMLElement,
    svg: SVGSVGElement,
    source: Record<string, string>,
    svgStyle: Record<string, string>,
    pseudoOwner?: Element
  ): BrowserWechatClipboardRuntime => ({
    blob: Blob,
    clipboardItem: null,
    document,
    getComputedStyle: (element, pseudoElement) => {
      if (pseudoElement) {
        return declaration({
          content:
            pseudoOwner === element && element.hasAttribute('data-pseudo-content')
              ? '"generated"'
              : 'none'
        });
      }
      if (element === root) return declaration(source);
      if (element === svg) return declaration(svgStyle);
      return declaration({ display: 'block' });
    },
    getSelection: window.getSelection.bind(window),
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: () => undefined,
    write: null
  });

  it('returns no signature for ordinary elements', () => {
    const { root, svg, source, svgStyle } = fixture();
    expect(mermaidAdmissionSignature(root.querySelector('rect') as Element, runtime(root, svg, source, svgStyle))).toBe('');
  });

  it.each([
    ['outline-style', 'dashed'],
    ['border-image-source', 'url(#paint)'],
    ['filter', 'blur(1px)'],
    ['clip-path', 'inset(0 1px)'],
    ['mask', 'url(#mask)'],
    ['mask-image', 'linear-gradient(red, blue)'],
    ['border-top-left-radius', '13px']
  ] as const)('changes on equal geometry for source %s', (property, value) => {
    const { root, svg, source, svgStyle } = fixture();
    const before = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
    if ('border-top-left-radius' === property) {
      source['border-radius'] = value;
      source[property] = value;
    } else {
      source[property] = value;
    }
    const after = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
    expect(after).not.toBe(before);
  });

  it('changes on equal geometry when SVG auto margins or dimensions change', () => {
    const { root, svg, source, svgStyle } = fixture();
    const before = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
    Object.defineProperty(svg, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value:
            'width' === property
              ? '351px'
              : 'height' === property
                ? 'auto'
                : 'max-width' === property
                  ? '351px'
                  : 'margin-left' === property
                    ? '0px'
                    : 'margin-right' === property
                      ? '0px'
                      : 'none'
        })
      })
    });
    svg.setAttribute('width', '351px');
    const after = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
    expect(after).not.toBe(before);
  });

  const changeInput = (
    label: string,
    mutate: (parts: Readonly<{
      preview: HTMLElement;
      root: HTMLElement;
      source: Record<string, string>;
      svg: SVGSVGElement;
      svgStyle: Record<string, string>;
    }>) => void
  ): readonly [string, (parts: Readonly<{
    preview: HTMLElement;
    root: HTMLElement;
    source: Record<string, string>;
    svg: SVGSVGElement;
    svgStyle: Record<string, string>;
  }>) => void] => [label, mutate];

  it.each([
    changeInput('source block-size', ({ root }) => {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: 'block-size' === property ? 'fixed' : 'auto' }) })
      });
    }),
    changeInput('source min-height', ({ root }) => {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: 'min-height' === property ? '10px' : 'auto' }) })
      });
    }),
    changeInput('source min-block-size', ({ root }) => {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: 'min-block-size' === property ? '10px' : 'auto' }) })
      });
    }),
    changeInput('source max-height', ({ root }) => {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: 'max-height' === property ? '10px' : 'none' }) })
      });
    }),
    changeInput('source max-block-size', ({ root }) => {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: 'max-block-size' === property ? '10px' : 'none' }) })
      });
    }),
    changeInput('source inline height', ({ root }) => root.style.setProperty('height', '10px')),
    changeInput('source height attribute', ({ root }) => root.setAttribute('height', '10px')),
    changeInput('source layout marker', ({ root }) => root.setAttribute('data-easymde-mermaid-layout', 'sequence')),
    changeInput('SVG aria role', ({ svg }) => svg.setAttribute('aria-roledescription', 'sequence')),
    changeInput('SVG transform attribute', ({ svg }) => svg.setAttribute('transform', 'scale(1)')),
    changeInput('SVG preserveAspectRatio', ({ svg }) => svg.setAttribute('preserveAspectRatio', 'none')),
    changeInput('SVG border radius', ({ svgStyle }) => {
      svgStyle['border-radius'] = '13px';
      svgStyle['border-top-left-radius'] = '13px';
    }),
    changeInput('SVG margin-top', ({ svgStyle }) => {
      svgStyle['margin-top'] = '1px';
    }),
    changeInput('SVG pseudo content', ({ svg }) => {
      svg.setAttribute('data-pseudo-content', '1');
    }),
    changeInput('document animation', ({ root }) => {
      const effect = { target: root } as unknown as KeyframeEffect;
      Object.defineProperty(document, 'getAnimations', {
        configurable: true,
        value: () => [{ effect }]
      });
    })
  ] as const)('changes the admission signature on equal geometry for %s', (_label, mutate) => {
    const parts = fixture();
    const before = mermaidAdmissionSignature(
      parts.root,
      runtime(parts.root, parts.svg, parts.source, parts.svgStyle, parts.svg)
    );
    mutate(parts);
    const afterRuntime = runtime(parts.root, parts.svg, parts.source, parts.svgStyle, parts.svg);
    const after = mermaidAdmissionSignature(
      parts.root,
      'source layout marker' === _label
        ? {
            ...afterRuntime,
            mermaidContentBoxes: {
              acquire: () => () => undefined,
              cleanup: () => undefined,
              get: (source) => source === parts.root ? { width: 130.5, height: 235.25 } : null,
              isCurrent: () => true,
              ready: Promise.resolve(),
              retain: () => undefined
            }
          }
        : afterRuntime
    );
    expect(after).not.toBe(before);
  });

  it('includes fractional native content-box dimensions for marked owners', () => {
    const { root, svg, source, svgStyle } = fixture();
    root.setAttribute('data-easymde-mermaid-layout', 'timeline');
    let height = 510.71875;
    const withContentBox = {
      ...runtime(root, svg, source, svgStyle),
      mermaidContentBoxes: {
        acquire: () => () => undefined,
        cleanup: () => undefined,
        get: (candidate: Element) => candidate === root ? { width: 481.5, height } : null,
        isCurrent: () => true,
        ready: Promise.resolve(),
        retain: () => undefined
      }
    };
    const before = mermaidAdmissionSignature(root, withContentBox);
    height = 510.734375;
    const after = mermaidAdmissionSignature(root, withContentBox);
    expect(before).toContain('content=481.5,510.71875');
    expect(after).not.toBe(before);
    expect(() => mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle))).toThrow(
      'wechat-png-rasterization-failed'
    );
  });

  it.each([
    ['clientWidth', -1],
    ['offsetHeight', Number.POSITIVE_INFINITY],
    ['scrollHeight', Number.NaN],
    ['scrollLeft', Number.NaN]
  ])('rejects an invalid %s when capturing marked-owner layout inputs', (property, value) => {
    const { root, svg, source, svgStyle } = fixture();
    root.setAttribute('data-easymde-mermaid-layout', 'timeline');
    Object.defineProperty(root, property, { configurable: true, value });
    expect(() => mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle), true)).toThrow(
      'wechat-png-rasterization-failed'
    );
  });

  it('retains a finite negative scroll offset for RTL layout inputs', () => {
    const { root, svg, source, svgStyle } = fixture();
    root.setAttribute('data-easymde-mermaid-layout', 'timeline');
    Object.defineProperty(root, 'scrollLeft', { configurable: true, value: -12 });
    expect(mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle), true)).toContain(',-12');
  });

  it('distinguishes unavailable TypedOM from an equal computed value', () => {
    const { root, svg, source, svgStyle } = fixture();
    const before = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
    Object.defineProperty(svg, 'computedStyleMap', { configurable: true, value: undefined });
    const after = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
    expect(after).not.toBe(before);
    expect(after).toContain('svg-typed=factory=unavailable');
  });

  it('preserves admission signature under uniform page scroll while changing on real relative displacement', () => {
    const { preview, root, svg, source, svgStyle } = fixture();
    document.body.append(preview);

    const baseSourceRect = {
      bottom: 746,
      height: 726,
      left: 10,
      right: 950,
      top: 20,
      width: 940
    };
    const baseSvgRect = {
      bottom: 746,
      height: 726,
      left: 305,
      right: 655,
      top: 20,
      width: 350
    };
    const basePreviewRect = {
      bottom: 800,
      height: 800,
      left: 0,
      right: 960,
      top: 0,
      width: 960
    };

    let scrollX = 0;
    let scrollY = 0;
    let relativeDeltaX = 0;

    const mockRect = (
      el: Element,
      rect: { bottom: number; height: number; left: number; right: number; top: number; width: number }
    ) => {
      Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          bottom: rect.bottom - scrollY,
          height: rect.height,
          left: rect.left - scrollX + (el === svg ? relativeDeltaX : 0),
          right: rect.right - scrollX + (el === svg ? relativeDeltaX : 0),
          top: rect.top - scrollY,
          width: rect.width
        })
      });
    };

    mockRect(preview, basePreviewRect);
    mockRect(root, baseSourceRect);
    mockRect(svg, baseSvgRect);

    try {
      const initial = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));

      // Scroll translation by non-integer amounts that introduce floating-point subtraction differences
      scrollX = 333.333333;
      scrollY = 777.777777;
      const scrolled = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
      expect(scrolled).toBe(initial);

      // Real relative displacement of SVG within source root changes the signature
      relativeDeltaX = 5;
      const displaced = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
      expect(displaced).not.toBe(initial);
    } finally {
      preview.remove();
    }
  });

  it('rejects unsafe background shorthands and box-shadow: transparent in mermaidRootPaintIsSafe', () => {
    const detachedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedSvg.setAttribute('viewBox', '0 0 200 100');
    detachedSvg.setAttribute('style', 'max-width: 200px; background: var(--danger)');

    // Even when a browser returns empty computed styles for detached nodes, inline background: var(--danger) is rejected.
    const emptyDetachedRuntime: BrowserWechatClipboardRuntime = {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: () => declaration({}),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: () => undefined,
      write: null,
    };
    expect(mermaidRootPaintIsSafe(detachedSvg, emptyDetachedRuntime, 200, 100, 200, 100)).toBe(false);

    const { root, svg, source, svgStyle } = fixture();
    expect(mermaidRootPaintIsSafe(root, runtime(root, svg, source, svgStyle), 200, 100, 200, 100)).toBe(true);

    for (const unsafeBackground of [
      'var(--danger)',
      'env(--danger)',
      'u\\72l(https://evil.example/bg.png)',
      'linear-gradient(red, blue)',
      'cross-fade("a.png", red)',
      'paint(worklet)',
    ]) {
      expect(
        mermaidRootPaintIsSafe(
          root,
          runtime(root, svg, { ...source, background: unsafeBackground }, svgStyle),
          200,
          100,
          200,
          100,
        ),
        unsafeBackground,
      ).toBe(false);
    }

    expect(
      mermaidRootPaintIsSafe(
        root,
        runtime(root, svg, { ...source, 'box-shadow': 'transparent' }, svgStyle),
        200,
        100,
        200,
        100,
      ),
    ).toBe(false);
  });

  it('prefers computed styles over benign inline styles for connected roots in mermaidRootPaintIsSafe', () => {
    const { preview, root, svg, source, svgStyle } = fixture();
    document.body.append(preview);
    try {
      const cases: ReadonlyArray<readonly [string, string, string]> = [
        ['box-shadow', 'none', '0 4px 12px rgba(0, 0, 0, 0.2)'],
        ['filter', 'none', 'blur(2px)'],
        ['clip-path', 'none', 'inset(0 1px)'],
        ['background-image', 'none', 'linear-gradient(red, blue)'],
        ['border-top-left-radius', '0px', '999px'],
      ];

      for (const [property, inlineValue, computedValue] of cases) {
        root.setAttribute('style', `${property}: ${inlineValue}`);
        expect(
          mermaidRootPaintIsSafe(
            root,
            runtime(root, svg, { ...source, [property]: computedValue }, svgStyle),
            200,
            100,
            200,
            100,
          ),
          `${property} computed=${computedValue} inline=${inlineValue}`,
        ).toBe(false);
      }
    } finally {
      preview.remove();
    }
  });

  it('fails closed on non-empty/non-none/non-normal ::before and ::after content in mermaidRootPaintIsSafe', () => {
    const { preview, root, svg, source, svgStyle } = fixture();
    document.body.append(preview);
    try {
      const makePseudoRuntime = (
        pseudoTarget: '::before' | '::after',
        contentValue: string,
      ): BrowserWechatClipboardRuntime => ({
        ...runtime(root, svg, source, svgStyle),
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) {
            return declaration({
              content: element === root && pseudoElement === pseudoTarget ? contentValue : 'none',
            });
          }
          if (element === root) return declaration(source);
          if (element === svg) return declaration(svgStyle);
          return declaration({ display: 'block' });
        },
      });

      for (const allowedContent of ['', 'none', 'NONE', 'normal', ' NORMAL ']) {
        expect(
          mermaidRootPaintIsSafe(root, makePseudoRuntime('::before', allowedContent), 200, 100, 200, 100),
          `allowed ::before content=${JSON.stringify(allowedContent)}`,
        ).toBe(true);
      }

      for (const unsafeContent of [
        'url(a.png)',
        'attr(data-x)',
        'counter(section)',
        'counters(item, ".")',
        'open-quote',
        '""',
        '"generated"',
      ]) {
        expect(
          mermaidRootPaintIsSafe(root, makePseudoRuntime('::before', unsafeContent), 200, 100, 200, 100),
          `unsafe ::before content=${unsafeContent}`,
        ).toBe(false);
        expect(
          mermaidRootPaintIsSafe(root, makePseudoRuntime('::after', unsafeContent), 200, 100, 200, 100),
          `unsafe ::after content=${unsafeContent}`,
        ).toBe(false);
      }
    } finally {
      preview.remove();
    }
  });

  it('computes exact centeredLeft and centeredRight for asymmetric left/right padding and border', () => {
    const { preview, root, svg, source, svgStyle } = fixture();
    source['padding-top'] = '10px';
    source['padding-right'] = '4px';
    source['padding-bottom'] = '6px';
    source['padding-left'] = '24px';
    source['border-top-style'] = 'solid';
    source['border-top-width'] = '3px';
    source['border-right-style'] = 'solid';
    source['border-right-width'] = '2px';
    source['border-bottom-style'] = 'solid';
    source['border-bottom-width'] = '5px';
    source['border-left-style'] = 'solid';
    source['border-left-width'] = '8px';

    const parsedSourceEdges = mermaidEdgeValues(declaration(source));
    expect(parsedSourceEdges).toEqual({
      borderBottom: 5,
      borderLeft: 8,
      borderRight: 2,
      borderTop: 3,
      paddingBottom: 6,
      paddingLeft: 24,
      paddingRight: 4,
      paddingTop: 10,
    });
    expect(parsedSourceEdges ? mermaidEdgeValuesAnyPositive(parsedSourceEdges) : false).toBe(true);
    const parsedSvgEdges = mermaidEdgeValues(declaration(svgStyle));
    expect(parsedSvgEdges).toEqual({
      borderBottom: 0,
      borderLeft: 0,
      borderRight: 0,
      borderTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
    });
    expect(parsedSvgEdges ? mermaidEdgeValuesAnyPositive(parsedSvgEdges) : true).toBe(false);

    let svgLeft = 152;
    let svgRight = 502;
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 350,
        height: 300,
        left: 100,
        right: 600,
        top: 50,
        width: 500,
      }),
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 343,
        height: 276,
        left: svgLeft,
        right: svgRight,
        top: 67,
        width: 350,
      }),
    });

    document.body.append(preview);
    try {
      // contentLeft = 100 + 24 + 8 = 132 => centeredLeft = 152 - 132 = 20
      // contentRight = 600 - 4 - 2 = 594 => centeredRight = 594 - 502 = 92
      // contentTop = 50 + 10 + 3 = 63 => topDelta = 67 - 63 = 4
      // contentWidth = 500 - 24 - 4 - 8 - 2 = 462, contentHeight = 300 - 10 - 6 - 3 - 5 = 276
      const offsetSignature = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
      expect(offsetSignature).toContain('content=462,276;');
      expect(offsetSignature).toContain('centered=20,92;');
      expect(offsetSignature).toContain('top=4;');
      expect(offsetSignature).toContain('svgEdges=0,0,0,0,0,0,0,0');

      // Truly centered SVG inside the asymmetric box: left = 132 + 56 = 188, right = 594 - 56 = 538
      svgLeft = 188;
      svgRight = 538;
      const centeredSignature = mermaidAdmissionSignature(root, runtime(root, svg, source, svgStyle));
      expect(centeredSignature).toContain('centered=56,56;');
    } finally {
      preview.remove();
    }
  });

  it('fails closed to 1 without throwing when getComputedStyle throws in computeMermaidLayoutMagnification', () => {
    const { preview, root, svg } = fixture();
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }),
    });
    document.body.append(preview);
    try {
      const viewBox = { height: 726, minX: 0, minY: 0, width: 350 };

      // Throws on source inside the transformOwner walk
      expect(
        computeMermaidLayoutMagnification(root, svg, viewBox, document, () => {
          throw new Error('computed-style-source-failed');
        }),
      ).toBe(1);

      // Succeeds on source, throws on an ancestor inside the transformOwner walk
      expect(
        computeMermaidLayoutMagnification(root, svg, viewBox, document, (element) => {
          if (element === preview) {
            throw new Error('computed-style-ancestor-failed');
          }
          return declaration({ transform: 'none' });
        }),
      ).toBe(1);

      // Succeeds in computeMermaidLayoutMagnification (1 source read), throws in mermaidSvgRectMagnification
      let sourceReads = 0;
      expect(
        computeMermaidLayoutMagnification(root, svg, viewBox, document, (element) => {
          if (element === root) {
            sourceReads += 1;
            if (sourceReads > 1) {
              throw new Error('computed-style-rect-magnification-source-failed');
            }
          }
          return declaration({ transform: 'none' });
        }),
      ).toBe(1);
      expect(sourceReads).toBe(2);
    } finally {
      preview.remove();
    }
  });

  it('fails closed to 1 without throwing when getScreenCTM throws NS_ERROR_FAILURE in computeMermaidLayoutMagnification', () => {
    const { preview, root, svg, source, svgStyle } = fixture();
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => {
        throw new Error('NS_ERROR_FAILURE');
      },
    });
    document.body.append(preview);
    try {
      const viewBox = { height: 726, minX: 0, minY: 0, width: 350 };
      let sourceReads = 0;
      const result = computeMermaidLayoutMagnification(root, svg, viewBox, document, (element) => {
        if (element === root) {
          sourceReads += 1;
          return declaration(source);
        }
        if (element === svg) {
          return declaration(svgStyle);
        }
        return declaration({ transform: 'none' });
      });
      expect(result).toBe(1);
      expect(sourceReads).toBe(1);
    } finally {
      preview.remove();
    }
  });

  it('reads getComputedStyle(source) at most once inside computeMermaidLayoutMagnification and returns 1 when source style is null', () => {
    const { preview, root, svg, source, svgStyle } = fixture();
    let ctmCalls = 0;
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => {
        ctmCalls += 1;
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      },
    });
    document.body.append(preview);
    try {
      const viewBox = { height: 726, minX: 0, minY: 0, width: 350 };

      // Null computed style on source fails closed immediately without reading getScreenCTM
      let nullSourceReads = 0;
      expect(
        computeMermaidLayoutMagnification(root, svg, viewBox, document, (element) => {
          if (element === root) {
            nullSourceReads += 1;
            return null;
          }
          return declaration({ transform: 'none' });
        }),
      ).toBe(1);
      expect(nullSourceReads).toBe(1);
      expect(ctmCalls).toBe(0);

      // Reaches getScreenCTM past the transformOwner walk and overflow checks with only one source style read
      let identityPathSourceReads = 0;
      expect(
        computeMermaidLayoutMagnification(root, svg, viewBox, document, (element) => {
          if (element === root) {
            identityPathSourceReads += 1;
            return declaration(source);
          }
          if (element === svg) {
            return declaration(svgStyle);
          }
          return declaration({ transform: 'none' });
        }),
      ).toBe(1);
      expect(identityPathSourceReads).toBe(1);
      expect(ctmCalls).toBe(1);

      // Overflow clipping bails out after a single source style read without reading getScreenCTM
      let clippedSourceReads = 0;
      expect(
        computeMermaidLayoutMagnification(root, svg, viewBox, document, (element) => {
          if (element === root) {
            clippedSourceReads += 1;
            return declaration({ ...source, overflow: 'hidden' });
          }
          return declaration({ transform: 'none' });
        }),
      ).toBe(1);
      expect(clippedSourceReads).toBe(1);
      expect(ctmCalls).toBe(1);
    } finally {
      preview.remove();
    }
  });

  it('handles empty border-*-style with border-*-width: medium consistently via mermaidEdgeValues in mermaidSvgRectMagnification', () => {
    const { preview, root, svg } = fixture();
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 76.9453125, width: 275 }),
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 56.9453125, width: 255 }),
    });

    const sourceStyles: Record<string, string> = {
      'border-bottom-style': '',
      'border-bottom-width': 'medium',
      'border-left-style': '',
      'border-left-width': 'medium',
      'border-right-style': '',
      'border-right-width': 'medium',
      'border-top-style': '',
      'border-top-width': 'medium',
      'padding-bottom': '10px',
      'padding-left': '10px',
      'padding-right': '10px',
      'padding-top': '10px',
      position: 'static',
      transform: 'none',
    };
    const svgStyles: Record<string, string> = {
      'border-bottom-style': '',
      'border-bottom-width': 'medium',
      'border-left-style': '',
      'border-left-width': 'medium',
      'border-right-style': '',
      'border-right-width': 'medium',
      'border-top-style': '',
      'border-top-width': 'medium',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'static',
      transform: 'none',
    };

    const getComputedStyle = (element: Element): CSSStyleDeclaration => {
      if (element === root) return declaration(sourceStyles);
      if (element === svg) return declaration(svgStyles);
      return declaration({ position: 'static', transform: 'none' });
    };

    document.body.append(preview);
    try {
      expect(mermaidEdgeValues(declaration(sourceStyles))).toEqual({
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
        borderTop: 0,
        paddingBottom: 10,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 10,
      });
      expect(mermaidEdgeValues(declaration(svgStyles))).toEqual({
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
        borderTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
      });

      const magnification = mermaidSvgRectMagnification(
        svg,
        root,
        { height: 268, width: 1200 },
        getComputedStyle,
      );
      expect(magnification).not.toBeNull();
      expect(magnification as number).toBeCloseTo(1200 / 255, 10);

      // Any positive SVG edge still rejects magnification via mermaidEdgeValuesAnyPositive.
      svgStyles['padding-left'] = '1px';
      expect(
        mermaidSvgRectMagnification(svg, root, { height: 268, width: 1200 }, getComputedStyle),
      ).toBeNull();
      svgStyles['padding-left'] = '0px';

      // Explicit solid border on source still rejects magnification.
      sourceStyles['border-left-style'] = 'solid';
      sourceStyles['border-left-width'] = '2px';
      expect(
        mermaidSvgRectMagnification(svg, root, { height: 268, width: 1200 }, getComputedStyle),
      ).toBeNull();
    } finally {
      preview.remove();
    }
  });
});
