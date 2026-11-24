import { describe, expect, it } from 'vitest';

import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { declaration, installClipboardTestEnvironment } from './wechat-clipboard-test-fixtures';
import { mermaidAdmissionSignature } from './wechat-mermaid-geometry';

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
});
