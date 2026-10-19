import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import { MATH_CLONE_ROLES, registerMathCloneRole } from './wechat-clone-metadata';
import { createDimensionSemanticsContext, type WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import {
  ordinaryDimensionSemanticsSignature,
  preparedDimensionGeometrySignature,
  preparedDimensionGeometrySignatureWithYield,
  preparedDimensionSemanticsSignature,
  preparedLayoutSignature,
  preparedLayoutSignatureWithYield
} from './wechat-fidelity-signature';

import {
  blobText,
  declaration,
  declaredStyleValue,
  dispatchSuccessfulLegacyCopy,
  installClipboardTestEnvironment,
  prepareClipboard,
  readyPreview,
  setMermaidComputedStyleMap
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('makes formula blocks horizontal-only scroll owners with automatic height', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">long formula</span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'long formula' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '88px',
            'max-height': '120px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'text-align': 'left'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const formulaStyle =
      [...holder.querySelectorAll('section')]
        .filter((element) => element.textContent?.includes('long formula'))
        .at(-1)
        ?.getAttribute('style') ?? '';
    const formulaLayoutStyle = holder.querySelector('section > span')?.getAttribute('style') ?? '';
    const formulaWrapperStyle = holder.querySelector('section > span > nobr')?.getAttribute('style') ?? '';
    const formulaVisualStyle = holder.querySelector('section > span > nobr > span')?.getAttribute('style') ?? '';
    expect(formulaWrapperStyle).toContain('display:block!important');
    // The KaTeX display layer spans the destination container so a short
    // formula keeps centering on the destination card.
    expect(formulaLayoutStyle).toContain('inline-size:100%!important');
    expect(formulaLayoutStyle).toContain('max-inline-size:100%!important');
    expect(formulaLayoutStyle).toContain('width:auto!important');
    expect(formulaLayoutStyle).toContain('box-sizing:border-box!important');
    expect(formulaLayoutStyle).toContain('text-align:center!important');
    expect(formulaLayoutStyle).not.toContain('width:max-content!important');
    expect(formulaLayoutStyle).not.toContain('min-width:max-content!important');
    // Every intrinsic layer below the display keeps `max-content` and is
    // centered with auto margins, so an over-wide formula stays reachable
    // through the outer scroll owner instead of inflating the display box.
    expect(formulaWrapperStyle).toContain('inline-size:max-content!important');
    expect(formulaWrapperStyle).toContain('max-inline-size:none!important');
    expect(formulaWrapperStyle).toContain('width:max-content!important');
    expect(formulaWrapperStyle).toContain('min-width:max-content!important');
    expect(formulaWrapperStyle).toContain('max-width:none!important');
    expect(formulaWrapperStyle).toContain('box-sizing:border-box!important');
    expect(formulaWrapperStyle).toContain('margin-left:auto!important');
    expect(formulaWrapperStyle).toContain('margin-right:auto!important');
    expect(formulaWrapperStyle).toContain('text-align:center!important');
    expect(formulaWrapperStyle).not.toContain('overflow-x:auto');
    expect(formulaVisualStyle).toContain('inline-size:max-content!important');
    expect(formulaVisualStyle).toContain('max-inline-size:none!important');
    expect(formulaVisualStyle).toContain('width:max-content!important');
    expect(formulaVisualStyle).toContain('min-width:max-content!important');
    expect(formulaVisualStyle).toContain('max-width:none!important');
    expect(formulaVisualStyle).toContain('box-sizing:border-box!important');
    expect(formulaVisualStyle).toContain('text-align:center!important');
    expect(formulaVisualStyle).not.toContain('overflow-x:auto');
    expect(formulaStyle).toContain('overflow-x:auto!important');
    expect(formulaStyle).toContain('overflow-y:hidden!important');
    expect(formulaStyle).toContain('height:auto!important');
    expect(formulaStyle).toContain('max-height:none!important');
    expect(formulaStyle).toContain('inline-size:100%!important');
    expect(formulaStyle).toContain('max-inline-size:100%!important');
    expect(formulaStyle).toContain('margin-left:auto!important');
    expect(formulaStyle).toContain('margin-right:auto!important');
    expect(formulaStyle).toContain('text-align:center!important');
    expect(holder.querySelectorAll('[style*="overflow-x:auto!important"]').length).toBe(1);
  });

  it('includes Mermaid admission semantics in ordinary and yielded layout signatures at equal geometry', async () => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100%" height="auto" viewBox="0 0 350 726">' +
      '<rect width="350" height="726"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid signature fixture missing');
    const rootRect = { bottom: 746, height: 746, left: 0, right: 940, top: 0, width: 940 };
    const svgRect = { bottom: 736, height: 726, left: 295, right: 645, top: 10, width: 350 };
    Object.defineProperty(root, 'getBoundingClientRect', { configurable: true, value: () => rootRect });
    Object.defineProperty(svg, 'getBoundingClientRect', { configurable: true, value: () => svgRect });
    setMermaidComputedStyleMap(root, { 'max-width': '100%' });
    setMermaidComputedStyleMap(svg, {
      height: 'auto',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-height': 'none',
      'max-width': '350px',
      width: '100%'
    });
    const sourceStyle: Record<string, string> = {
      background: 'none',
      'background-color': 'transparent',
      'background-image': 'none',
      'border-image-source': 'none',
      'box-sizing': 'border-box',
      display: 'block',
      filter: 'none',
      float: 'none',
      height: 'auto',
      'max-width': '100%',
      outline: 'none',
      'outline-style': 'none',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      position: 'static',
      transform: 'none',
      width: '940px'
    };
    const svgStyle: Record<string, string> = {
      display: 'block',
      height: 'auto',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-height': 'none',
      'max-width': '350px',
      width: '350px'
    };
    const runtime = {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if (element === root) return declaration(sourceStyle);
        if (element === svg) return declaration(svgStyle);
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    };
    const yieldToBrowser = Object.assign(async () => undefined, { shouldYield: () => false });
    for (const [property, value] of [
      ['outline-style', 'solid'],
      ['border-image-source', 'url(#paint)']
    ] as const) {
      const ordinaryBefore = preparedLayoutSignature(preview, runtime);
      const yieldedBefore = await preparedLayoutSignatureWithYield(
        preview,
        runtime,
        yieldToBrowser
      );
      const previous = sourceStyle[property] ?? '';
      sourceStyle[property] = value;
      expect(preparedLayoutSignature(preview, runtime), `ordinary ${property}`).not.toBe(ordinaryBefore);
      expect(await preparedLayoutSignatureWithYield(preview, runtime, yieldToBrowser), `yielded ${property}`).not.toBe(
        yieldedBefore
      );
      sourceStyle[property] = previous;
    }
  });

  it('skips Mermaid live-SVG reads in all PNG dimension freshness sinks', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100%" height="auto" viewBox="0 0 350 726">' +
      '<rect width="350" height="726"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid PNG read-count fixture missing');
    let svgReads = 0;
    const runtime = {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if (!pseudoElement && element === svg) svgReads += 1;
        if (pseudoElement) return declaration({ content: 'none' });
        if (element === root) {
          return declaration({ display: 'block', height: 'auto', 'max-width': '100%', width: '940px' });
        }
        if (element === svg) {
          return declaration({
            display: 'block',
            height: 'auto',
            'margin-left': 'auto',
            'margin-right': 'auto',
            'max-height': 'none',
            'max-width': '350px',
            width: '350px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    };
    const dimensionSemantics = createDimensionSemanticsContext(preview, preview, runtime, true);
    const yieldToBrowser = Object.assign(async () => undefined, { shouldYield: () => false });
    try {
      dimensionSemantics.refresh();
      svgReads = 0;
      await preparedDimensionGeometrySignatureWithYield(
        preview,
        runtime,
        yieldToBrowser,
        undefined,
        dimensionSemantics
      );
      expect(svgReads, 'yielded geometry').toBe(0);
      preparedDimensionGeometrySignature(preview, runtime, dimensionSemantics);
      expect(svgReads, 'sync geometry').toBe(0);
      preparedDimensionSemanticsSignature(preview, runtime, dimensionSemantics);
      expect(svgReads, 'semantics').toBe(0);
    } finally {
      dimensionSemantics.cleanup();
    }
  });

  it('keeps Mermaid admission invalidation in all ordinary dimension sinks', async () => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100%" height="auto" viewBox="0 0 350 726">' +
      '<rect width="350" height="726"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid ordinary sink fixture missing');
    setMermaidComputedStyleMap(root, { 'max-width': '100%' });
    setMermaidComputedStyleMap(svg, {
      height: 'auto',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-height': 'none',
      'max-width': '350px',
      width: '100%'
    });
    const sourceStyle: Record<string, string> = {
      background: 'none',
      'background-color': 'transparent',
      'background-image': 'none',
      'border-image-source': 'none',
      'box-sizing': 'border-box',
      display: 'block',
      filter: 'none',
      float: 'none',
      height: 'auto',
      'max-width': '100%',
      'outline-style': 'none',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      position: 'static',
      transform: 'none',
      width: '940px'
    };
    const svgStyle: Record<string, string> = {
      display: 'block',
      height: 'auto',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-height': 'none',
      'max-width': '350px',
      width: '350px'
    };
    const runtime = {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if (element === root) return declaration(sourceStyle);
        if (element === svg) return declaration(svgStyle);
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    };
    const dimensionSemantics = {
      cleanup: vi.fn(),
      getComputedStyle: runtime.getComputedStyle,
      getFormattingOwnerDisplay: () => 'block',
      getRootComputedStyle: runtime.getComputedStyle,
      getSourceComputedStyle: runtime.getComputedStyle,
      rasterizesVisualRoots: false,
      refresh: vi.fn()
    } satisfies WechatDimensionSemanticsContext;
    const yieldToBrowser = Object.assign(async () => undefined, { shouldYield: () => false });
    const sinks = [
      ['yielded geometry', async () =>
        preparedDimensionGeometrySignatureWithYield(preview, runtime, yieldToBrowser, undefined, dimensionSemantics)],
      ['sync geometry', async () => preparedDimensionGeometrySignature(preview, runtime, dimensionSemantics)],
      ['semantics', async () => preparedDimensionSemanticsSignature(preview, runtime, dimensionSemantics)]
    ] as const;
    for (const [property, value] of [
      ['outline-style', 'solid'],
      ['border-image-source', 'url(#paint)']
    ] as const) {
      const before = await Promise.all(sinks.map(async ([, read]) => read()));
      sourceStyle[property] = value;
      const after = await Promise.all(sinks.map(async ([, read]) => read()));
      after.forEach((signature, index) => {
        expect(signature, `${sinks[index]?.[0] ?? 'unknown'} ${property}`).not.toBe(before[index]);
      });
      sourceStyle[property] = property === 'outline-style' ? 'none' : 'none';
    }
  });

  it('releases only a proven auto-unbounded KaTeX HTML shell allocation', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord"><span class="pstrut"></span>134px matrix</span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '134px matrix' });
    const htmlShell = preview.querySelector('.katex-html');
    const pstrut = preview.querySelector('.pstrut');
    if (!htmlShell || !pstrut) throw new Error('math html shell fixture missing');
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            'block-size': 'auto',
            height: 'auto',
            'inline-size': 'auto',
            'max-block-size': 'none',
            'max-height': 'none',
            'max-inline-size': 'none',
            'max-width': 'none',
            'min-block-size': 'auto',
            'min-height': 'auto',
            'min-inline-size': 'auto',
            'min-width': 'auto',
            width: 'auto'
          }[property] ?? 'auto'
        })
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', overflow: 'auto', 'overflow-x': 'auto', 'overflow-y': 'auto' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            'writing-mode': 'horizontal-tb',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            clip: 'auto',
            'clip-path': 'none',
            transform: 'none',
            float: 'none',
            clear: 'none',
            contain: 'none',
            'container-type': 'normal'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const htmlShellStyle = holder.querySelector('section > span > nobr > span > span')?.getAttribute('style') ?? '';
    const internalPstrutStyles = Array.from(holder.querySelectorAll('[style*="height:45.7344px"]')).map(
      (element) => element.getAttribute('style') ?? ''
    );
    expect(htmlShellStyle).toContain('width:max-content!important');
    expect(htmlShellStyle).toContain('inline-size:max-content!important');
    expect(htmlShellStyle).not.toContain('width:416px');
    expect(htmlShellStyle).not.toContain('inline-size:416px');
    expect(internalPstrutStyles.length).toBeGreaterThan(0);
    expect(internalPstrutStyles.some((style) => style.includes('width:0px'))).toBe(true);
  });

  it('keeps the html shell allocation when author dimensions or Typed OM proof are unavailable', () => {
    const makeSource = (): { clone: Element; source: Element } => {
      const source = document.createElement('span');
      source.className = 'katex-html';
      const clone = source.cloneNode(true) as Element;
      return { clone, source };
    };
    const safeComputed = declaration({
      display: 'block',
      position: 'relative',
      width: '416px',
      'inline-size': '416px',
      'min-width': '0px',
      'max-width': 'none',
      'writing-mode': 'horizontal-tb',
      overflow: 'visible',
      'overflow-x': 'visible',
      'overflow-y': 'visible',
      clip: 'auto',
      'clip-path': 'none',
      transform: 'none',
      float: 'none',
      clear: 'none',
      contain: 'none',
      'container-type': 'normal'
    });
    const authored = makeSource();
    authored.source.setAttribute('style', 'width:240px');
    registerMathCloneRole(authored.source, authored.clone, safeComputed, () => declaration({ display: 'block' }));
    authored.clone.removeAttribute('class');
    expect(MATH_CLONE_ROLES.get(authored.clone)).toMatchObject({ role: 'html', canReleaseOuterAllocation: false });

    const unknown = makeSource();
    registerMathCloneRole(unknown.source, unknown.clone, safeComputed, () => declaration({ display: 'block' }));
    unknown.clone.removeAttribute('class');
    expect(MATH_CLONE_ROLES.get(unknown.clone)).toMatchObject({ role: 'html', canReleaseOuterAllocation: false });
  });

  it('includes every outer-allocation guard in the math shell freshness signature', () => {
    const parent = document.createElement('div');
    parent.className = 'formatting-owner';
    const source = document.createElement('span');
    source.className = 'katex-html';
    parent.append(source);
    let formattingOwnerDisplay = 'block';
    const sourceStyle = {
      'clip': 'auto',
      'clip-path': 'none',
      'clear': 'none',
      'contain': 'none',
      'container-type': 'normal',
      'display': 'block',
      'float': 'none',
      'overflow': 'visible',
      'overflow-x': 'visible',
      'overflow-y': 'visible',
      'position': 'relative',
      'transform': 'none',
      'writing-mode': 'horizontal-tb'
    };
    const dimensionSemantics = {
      getComputedStyle: () => declaration(sourceStyle),
      getFormattingOwnerDisplay: () => formattingOwnerDisplay,
      getRootComputedStyle: () => declaration(sourceStyle),
      getSourceComputedStyle: () => declaration(sourceStyle),
      rasterizesVisualRoots: false,
      refresh: vi.fn(),
      cleanup: vi.fn()
    } as unknown as WechatDimensionSemanticsContext;
    const initialSignature = ordinaryDimensionSemanticsSignature(source, dimensionSemantics);
    const guardChanges: ReadonlyArray<readonly [keyof typeof sourceStyle, string]> = [
      ['writing-mode', 'vertical-rl'],
      ['float', 'left'],
      ['clear', 'both'],
      ['clip', 'rect(0px, 10px, 10px, 0px)'],
      ['clip-path', 'inset(0px)'],
      ['contain', 'layout'],
      ['container-type', 'inline-size']
    ];
    for (const [property, value] of guardChanges) {
      const previous = sourceStyle[property];
      sourceStyle[property] = value;
      expect(ordinaryDimensionSemanticsSignature(source, dimensionSemantics), property).not.toBe(initialSignature);
      sourceStyle[property] = previous;
    }
    formattingOwnerDisplay = 'flex';
    expect(ordinaryDimensionSemanticsSignature(source, dimensionSemantics)).not.toBe(initialSignature);
  });

  it('invalidates freshness when the KaTeX width owner changes Typed OM semantics with the same used width', () => {
    const parent = document.createElement('span');
    parent.className = 'katex';
    const source = document.createElement('span');
    source.className = 'katex-html';
    parent.append(source);
    const usedStyle = declaration({
      'box-sizing': 'border-box',
      width: '416px',
      'min-width': '0px',
      'max-width': 'none',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      'margin-bottom': '0px',
      'transform-origin': '50% 50%'
    });
    const dimensionSemantics = {
      getComputedStyle: () => usedStyle,
      getFormattingOwnerDisplay: () => 'block',
      getRootComputedStyle: () => usedStyle,
      refresh: vi.fn(),
      cleanup: vi.fn()
    } as unknown as WechatDimensionSemanticsContext;
    const setTypedDimensions = (values: Readonly<Record<string, string>>): void => {
      Object.defineProperty(parent, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: values[property] ?? 'auto' }) })
      });
    };
    setTypedDimensions({
      width: 'auto',
      'inline-size': 'auto',
      'min-width': 'auto',
      'min-inline-size': 'auto',
      'max-width': 'none',
      'max-inline-size': 'none'
    });
    const autoSignature = ordinaryDimensionSemanticsSignature(parent, dimensionSemantics);
    setTypedDimensions({
      width: '416px',
      'inline-size': '416px',
      'min-width': '0px',
      'min-inline-size': '0px',
      'max-width': 'none',
      'max-inline-size': 'none'
    });
    const usedSignature = ordinaryDimensionSemanticsSignature(parent, dimensionSemantics);
    expect(autoSignature).not.toBe(usedSignature);
  });

  function productionMathShellFixture(): Readonly<{
    block: Element;
    display: Element;
    katex: Element;
    shell: Element;
  }> {
    const preview = document.createElement('div');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"></span></span></span></div>';
    const block = preview.querySelector('.easymde-math-block');
    const display = preview.querySelector('.katex-display');
    const katex = preview.querySelector('.katex');
    const shell = preview.querySelector('.katex-html');
    if (!block || !display || !katex || !shell) throw new Error('production math shell fixture missing');
    return { block, display, katex, shell };
  }

  function registerProductionMathShell(
    fixture: ReturnType<typeof productionMathShellFixture>,
    getComputedStyle: (element: Element) => CSSStyleDeclaration
  ): Element {
    Object.defineProperty(fixture.shell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: property.startsWith('max-') ? 'none' : 'auto'
        })
      })
    });
    const clone = fixture.shell.cloneNode(true) as Element;
    const computed = declaration({
      display: 'block',
      position: 'relative',
      'writing-mode': 'horizontal-tb',
      overflow: 'visible',
      'overflow-x': 'visible',
      'overflow-y': 'visible',
      clip: 'auto',
      'clip-path': 'none',
      transform: 'none',
      float: 'none',
      clear: 'none',
      contain: 'none',
      'container-type': 'normal'
    });
    registerMathCloneRole(fixture.shell, clone, computed, getComputedStyle, 'block');
    clone.removeAttribute('class');
    return clone;
  }

  it('keeps the html shell allocation for an absolute child in the production math wrapper hierarchy', () => {
    const fixture = productionMathShellFixture();
    const absoluteChild = document.createElement('span');
    fixture.shell.append(absoluteChild);
    const clone = registerProductionMathShell(fixture, (element) =>
      element === absoluteChild
        ? declaration({ position: 'absolute' })
        : declaration({ display: 'block', position: 'relative', transform: 'none' })
    );
    expect(MATH_CLONE_ROLES.get(clone)).toMatchObject({
      role: 'html',
      canReleaseOuterAllocation: false,
      outerAllocationDecision: { absoluteContainingBlockDependent: true }
    });
  });

  it.each([
    ['direct absolute child', false, '416px'],
    ['nested containing block', true, 'max-content']
  ] as const)(
    'uses the production math wrapper hierarchy for %s admission',
    async (_label, nestedContainingBlock, expectedWidth) => {
      const writes: unknown[] = [];
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html">' +
        (nestedContainingBlock
          ? '<span class="fixture-nested-containing-block"><span class="fixture-absolute-child">x</span></span>'
          : '<span class="fixture-absolute-child">x</span>') +
        '</span></span></span></div>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'wrapper admission' });
      const htmlShell = preview.querySelector('.katex-html');
      const absoluteChild = preview.querySelector('.fixture-absolute-child');
      const nested = preview.querySelector('.fixture-nested-containing-block');
      if (!htmlShell || !absoluteChild) throw new Error('production math wrapper fixture missing');
      Object.defineProperty(htmlShell, 'computedStyleMap', {
        configurable: true,
        value: () => ({
          get: (property: string) => ({
            value: property.startsWith('max-') ? 'none' : 'auto'
          })
        })
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({ content: 'none' });
          if (element === absoluteChild) return declaration({ display: 'inline', position: 'absolute' });
          if (element === nested) return declaration({ position: 'relative', transform: 'none' });
          if (element === htmlShell) {
            return declaration({
              clip: 'auto',
              'clip-path': 'none',
              clear: 'none',
              contain: 'none',
              'container-type': 'normal',
              display: 'block',
              float: 'none',
              overflow: 'visible',
              'overflow-x': 'visible',
              'overflow-y': 'visible',
              position: 'relative',
              transform: 'none',
              width: '416px',
              'writing-mode': 'horizontal-tb'
            });
          }
          if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
            return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
          }
          if ('SPAN' === element.tagName && element.closest('.katex')) {
            return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('wrapper admission html missing');
      const html = await blobText(htmlBlob);
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const visualRoot = holder.querySelector('section > span > nobr > span');
      const shell = holder.querySelector('section > span > nobr > span > span');
      if (!visualRoot || !shell) throw new Error(`wrapper admission shell missing: ${html}`);
      expect(declaredStyleValue(visualRoot, 'width')).toBe('max-content');
      expect(declaredStyleValue(shell, 'width')).toBe(expectedWidth);
    }
  );

  it('invalidates freshness when absolute-descendant containing-block dependence changes', () => {
    const fixture = productionMathShellFixture();
    const nestedContainingBlock = document.createElement('span');
    const absoluteChild = document.createElement('span');
    nestedContainingBlock.append(absoluteChild);
    fixture.shell.append(nestedContainingBlock);
    let nestedPosition = 'relative';
    const liveStyle = (element: Element): CSSStyleDeclaration => {
      if (element === absoluteChild) return declaration({ position: 'absolute' });
      if (element === nestedContainingBlock) return declaration({ position: nestedPosition, transform: 'none' });
      if (element === fixture.shell) {
        return declaration({
          clip: 'auto',
          'clip-path': 'none',
          clear: 'none',
          contain: 'none',
          'container-type': 'normal',
          display: 'block',
          float: 'none',
          overflow: 'visible',
          'overflow-x': 'visible',
          'overflow-y': 'visible',
          position: 'relative',
          transform: 'none',
          'writing-mode': 'horizontal-tb'
        });
      }
      return declaration({ display: 'block', position: 'relative', transform: 'none' });
    };
    const dimensionSemantics = {
      getComputedStyle: () => declaration({}),
      getFormattingOwnerDisplay: () => 'block',
      getRootComputedStyle: () => declaration({}),
      getSourceComputedStyle: liveStyle,
      rasterizesVisualRoots: false,
      refresh: vi.fn(),
      cleanup: vi.fn()
    } as unknown as WechatDimensionSemanticsContext;
    const before = ordinaryDimensionSemanticsSignature(fixture.shell, dimensionSemantics);
    nestedPosition = 'static';
    const after = ordinaryDimensionSemanticsSignature(fixture.shell, dimensionSemantics);
    expect(after).not.toBe(before);
    expect(after).toContain('absolute-containing-block-dependent=true');
  });

  it('releases the html shell when a nested containing block contains its absolute child', () => {
    const fixture = productionMathShellFixture();
    const nestedContainingBlock = document.createElement('span');
    const absoluteChild = document.createElement('span');
    nestedContainingBlock.append(absoluteChild);
    fixture.shell.append(nestedContainingBlock);
    const clone = registerProductionMathShell(fixture, (element) => {
      if (element === absoluteChild) return declaration({ position: 'absolute' });
      if (element === nestedContainingBlock) return declaration({ position: 'relative', transform: 'none' });
      return declaration({ display: 'block', position: 'relative', transform: 'none' });
    });
    expect(MATH_CLONE_ROLES.get(clone)).toMatchObject({
      role: 'html',
      canReleaseOuterAllocation: true,
      outerAllocationDecision: { absoluteContainingBlockDependent: false }
    });
  });

  it('rejects a contents parent when its formatting owner is a flex container', () => {
    const flexOwner = document.createElement('div');
    const contentsParent = document.createElement('span');
    const source = document.createElement('span');
    source.className = 'katex-html';
    contentsParent.append(source);
    flexOwner.append(contentsParent);
    Object.defineProperty(source, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({ value: property.startsWith('max-') ? 'none' : 'auto' })
      })
    });
    const clone = source.cloneNode(true) as Element;
    const sourceComputed = declaration({
      display: 'block',
      position: 'relative',
      'writing-mode': 'horizontal-tb',
      overflow: 'visible',
      'overflow-x': 'visible',
      'overflow-y': 'visible',
      clip: 'auto',
      'clip-path': 'none',
      transform: 'none',
      float: 'none',
      clear: 'none',
      contain: 'none',
      'container-type': 'normal'
    });
    const getComputedStyle = (element: Element): CSSStyleDeclaration => {
      if (element === contentsParent) return declaration({ display: 'contents', position: 'static', transform: 'none' });
      if (element === flexOwner) return declaration({ display: 'flex', position: 'static', transform: 'none' });
      return sourceComputed;
    };
    registerMathCloneRole(source, clone, sourceComputed, getComputedStyle, 'flex');
    clone.removeAttribute('class');
    expect(MATH_CLONE_ROLES.get(clone)).toMatchObject({ role: 'html', canReleaseOuterAllocation: false });
  });

  it('preserves KaTeX SVG geometry while normalizing non-math SVG media', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord"><span class="sqrt"><svg width="2400px" height="48px"></svg><span class="sqrt-line"></span></span></span></span></span></span></span></div>',
      '<svg id="diagram" width="100" height="40"></svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'sqrt formula' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', overflow: 'auto', 'overflow-x': 'auto', 'overflow-y': 'auto' });
        }
        if ('svg' === element.tagName.toLowerCase()) {
          return element.closest('.katex')
            ? declaration({
                display: 'block',
                position: 'absolute',
                width: '2400px',
                height: '48px',
                overflow: 'hidden'
              })
            : declaration({ display: 'inline-block', width: '100px', height: '40px' });
        }
        if (element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const katexSvgStyle = holder.querySelector('nobr svg')?.getAttribute('style') ?? '';
    const diagramStyle = holder.querySelector('svg#diagram')?.getAttribute('style') ?? '';
    expect(katexSvgStyle).toContain('width:2400px');
    expect(katexSvgStyle).toContain('height:48px');
    expect(katexSvgStyle).not.toContain('height:auto');
    expect(diagramStyle).toContain('height:auto');
    expect(diagramStyle).toContain('max-width:100%');
  });

  it('keeps complete Mermaid HTML labels visible in modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="easymde-mermaid">',
      '<svg width="220" height="360" viewBox="0 0 220 360">',
      '<foreignObject width="64" height="22" x="78" y="0"><div xmlns="http://www.w3.org/1999/xhtml"><span>用户请求</span></div></foreignObject>',
      '<foreignObject width="101.875" height="22" x="59" y="70"><div xmlns="http://www.w3.org/1999/xhtml"><span>是否命中缓存?</span></div></foreignObject>',
      '<foreignObject width="96" height="22" x="62" y="140"><div xmlns="http://www.w3.org/1999/xhtml"><span>返回缓存结果</span></div></foreignObject>',
      '<foreignObject width="72" height="22" x="74" y="210"><div xmlns="http://www.w3.org/1999/xhtml"><span>调用 API</span></div></foreignObject>',
      '</svg></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: '用户请求\n是否命中缓存?\n返回缓存结果\n调用 API'
    });

    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if (pseudoElement) return declaration({});
        if ('svg' === element.localName) {
          return declaration({
            display: 'block',
            width: '220px',
            height: '360px',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
          });
        }
        if ('foreignobject' === element.localName) {
          return declaration({
            display: 'block',
            width: element.getAttribute('width') ?? '64px',
            height: '22px',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
          });
        }
        if ('div' === element.localName || 'span' === element.localName) {
          return declaration({ display: 'block', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    };

    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(modernBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelectorAll('svg foreignObject')).toHaveLength(4);
    expect(modernHolder.querySelector('svg')?.getAttribute('style')).toContain('overflow:visible!important');
    expect(
      [...modernHolder.querySelectorAll('foreignObject')].every((element) => {
        const style = element.getAttribute('style') ?? '';
        return (
          style.includes('overflow:visible!important') &&
          style.includes('overflow-x:visible!important') &&
          style.includes('overflow-y:visible!important') &&
          style.includes('min-width:max-content!important') &&
          style.includes('max-width:none!important') &&
          style.includes('white-space:nowrap!important') &&
          style.includes('word-break:normal!important') &&
          style.includes('overflow-wrap:normal!important')
        );
      })
    ).toBe(true);
    const originalGeometry = [
      { width: 64, x: 78 },
      { width: 101.875, x: 59 },
      { width: 96, x: 62 },
      { width: 72, x: 74 }
    ];
    [...modernHolder.querySelectorAll('foreignObject')].forEach((element, index) => {
      const original = originalGeometry[index];
      if (!original) {
        throw new Error(`Missing Mermaid geometry fixture at index ${index}.`);
      }
      const width = Number.parseFloat(element.getAttribute('width') ?? '');
      const x = Number.parseFloat(element.getAttribute('x') ?? '');
      expect(width).toBeGreaterThanOrEqual(original.width * 1.5);
      expect(x + width / 2).toBeCloseTo(original.x + original.width / 2, 5);
      expect(element.firstElementChild?.getAttribute('style')).toContain('width:max-content!important');
    });
    expect(
      [...modernHolder.querySelectorAll('foreignObject')].every((element) => {
        const label = element.querySelector('nobr');
        return label?.textContent === element.textContent;
      })
    ).toBe(true);
    const visualText = modernHolder.textContent?.replaceAll('\u2060', '') ?? '';
    for (const label of ['用户请求', '是否命中缓存?', '返回缓存结果', '调用 API']) {
      expect(visualText).toContain(label);
    }
    expect(modernHtml).toContain('\u2060');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
  });

  it('keeps referenced anchors, SVG paint, supported math layout, and safe image URLs', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a href="#math-target">Jump to math</a></p>',
      '<h3 id="math-target">Formula</h3>',
      '<div class="katex"><span class="katex-mathml"><math><annotation>x + y</annotation></math></span><span class="katex-html"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span class="pstrut"></span>x + y</span></span></span></span></div>',
      '<svg id="diagram" viewBox="0 0 20 20"><defs><linearGradient id="gradient"><stop offset="0" stop-color="#fff"></stop></linearGradient><marker id="arrowhead"><path d="M0 0l4 2-4 2z"></path></marker></defs><path id="path" fill="url(#gradient)" marker-end="url(#arrowhead)" d="M0 0h20v20H0z"></path></svg>',
      '<p id="discard-me"><img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,AAAA 1x, javascript:bad 2x, https://example.test/image.png 2x" alt="inline image"></p>'
    ].join('');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('katex')) {
          return declaration({ display: 'inline', position: 'fixed', width: 'min-content' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          if (element.classList.contains('vlist-t')) {
            return declaration({ display: 'inline-table', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist-r')) {
            return declaration({ display: 'table-row', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist')) {
            return declaration({ display: 'table-cell', position: 'relative', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('pstrut')) {
            return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
          }
          return declaration({
            display: 'inline',
            position: 'relative',
            height: '1.2em',
            transform: 'translateY(1px)'
          });
        }
        if ('path' === element.tagName.toLowerCase()) {
          if ('path' === element.id) {
            return declaration({
              display: 'inline',
              fill: 'url(#gradient)',
              stroke: 'none',
              'marker-end': 'url("#arrowhead")'
            });
          }
          return declaration({
            display: 'inline',
            fill: 'rgb(0, 0, 0)',
            stroke: 'none',
            'marker-end': 'none'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    if (!textBlob) throw new Error('clipboard text missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const text = await blobText(textBlob);
    expect(holder.querySelector('a[href="#math-target"]')).not.toBeNull();
    expect(holder.querySelector('#math-target')).not.toBeNull();
    expect(holder.querySelector('#discard-me')).toBeNull();
    expect(holder.querySelector('svg#diagram')).not.toBeNull();
    expect(holder.querySelector('svg #gradient')).not.toBeNull();
    expect(holder.querySelector('svg #path')?.getAttribute('style')).toContain('fill:url(#gradient)');
    expect(holder.querySelector('svg#diagram > path#path')?.getAttribute('marker-end')).toBe('none');
    expect(holder.querySelector('svg#diagram > svg path[d="M0 0l4 2-4 2z"]')).not.toBeNull();
    expect(holder.querySelector('marker#arrowhead')).toBeNull();
    expect(holder.querySelector('.katex')).toBeNull();
    expect(holder.querySelector('math')).toBeNull();
    expect(holder.querySelector('nobr')).not.toBeNull();
    expect(holder.querySelector('nobr')?.getAttribute('style')).toContain('display:inline-block!important');
    expect(holder.querySelector('span[style*="display:inline-table"]')).not.toBeNull();
    expect(holder.querySelector('span[style*="height:45.7344px"]')?.textContent).toContain('\u2060');
    expect([...holder.querySelectorAll('section span')].some((element) => element.textContent?.includes('x + y'))).toBe(
      true
    );
    const visualFormulaNodes = [...holder.querySelectorAll('section span')].filter((element) =>
      element.textContent?.includes('x + y')
    );
    expect(
      visualFormulaNodes.some((element) => {
        const style = element.getAttribute('style') ?? '';
        return (
          style.includes('white-space:nowrap!important') &&
          style.includes('word-break:normal!important') &&
          style.includes('overflow-wrap:normal!important') &&
          style.includes('max-width:none!important')
        );
      })
    ).toBe(true);
    expect(text.match(/x \+ y/g)).toHaveLength(1);
    expect(holder.querySelector('section[style*="position:fixed"]')).toBeNull();
    expect(holder.querySelector('section span[style*="position:relative"]')).not.toBeNull();
    expect(holder.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull();
    expect(holder.querySelector('img[srcset*="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[srcset*="https://example.test/image.png"]')).not.toBeNull();
  });

  it('keeps safe srcset candidates that a data URL candidate directly precedes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,AAAA 1x,https://example.test/image.png 2x" alt="data candidate"></p>',
      '<p><img src="https://example.test/first.png" srcset="data:image/png;base64,AAAA 1x,javascript:bad 2x,https://example.test/image.png 2x,data:image/png;base64,BBBB 3x" alt="mixed candidates"></p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'candidate images' });
    const expectedSrcsetCandidates = [
      'data:image/png;base64,AAAA 1x, https://example.test/image.png 2x',
      'data:image/png;base64,AAAA 1x, https://example.test/image.png 2x, data:image/png;base64,BBBB 3x'
    ];
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element: Element, pseudoElement?: string) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', height: '40px', width: '200px' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    };

    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(modernBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect([...modernHolder.querySelectorAll('img')].map((image) => image.getAttribute('srcset'))).toEqual(
      expectedSrcsetCandidates
    );
    expect(modernHolder.innerHTML).not.toContain('javascript:');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
    const legacyHolder = document.createElement('div');
    legacyHolder.innerHTML = legacyHtml;
    expect([...legacyHolder.querySelectorAll('img')].map((image) => image.getAttribute('srcset'))).toEqual(
      expectedSrcsetCandidates
    );
  });


  it('preserves hidden SVG definitions referenced by visible shapes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="masked" viewBox="0 0 40 40">',
      '<defs style="display:none">',
      '<clipPath id="clip"><rect width="40" height="40"></rect></clipPath>',
      '<linearGradient id="gradient"><stop offset="0" stop-color="#fff"></stop><stop offset="1" stop-color="#000"></stop></linearGradient>',
      '</defs>',
      '<rect width="40" height="40" clip-path="url(#clip)" fill="url(#gradient)"></rect>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Masked shape' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DEFS' === element.tagName) return declaration({ display: 'none' });
        if ('SVG' === element.tagName) {
          return declaration({ display: 'block', width: '40px', height: '40px' });
        }
        if ('RECT' === element.tagName) {
          return declaration({ display: 'block', fill: 'url(#gradient)' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('svg#masked defs')).not.toBeNull();
    expect(holder.querySelector('svg #clip')).not.toBeNull();
    expect(holder.querySelector('svg #gradient')).not.toBeNull();
    expect(holder.querySelector('svg rect[clip-path="url(#clip)"]')).not.toBeNull();
    expect(holder.querySelector('svg rect[fill="url(#gradient)"]')).not.toBeNull();
  });

  it('preserves multi-row KaTeX matrix and cases layout', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const column = (first: string, second: string): string =>
      [
        '<span class="col-align-c"><span class="vlist-t vlist-t2">',
        `<span class="vlist-r"><span class="vlist"><span style="top:-2em"><span class="pstrut"></span><span class="mord">${first}</span></span></span></span>`,
        `<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">${second}</span></span></span></span>`,
        '</span></span>'
      ].join('');
    const row = (content: string): string =>
      [
        '<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">',
        content,
        '</span></span></span></span>'
      ].join('');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="katex"><span class="katex-mathml"><math><mtable><mtr><mtd>1</mtd></mtr></mtable></math></span><span class="katex-html"><span class="base"><span class="mord"><span class="mtable">',
      column('1', '4'),
      column('2', '5'),
      column('3', '6'),
      '</span></span></span></span></div>',
      '<div class="katex"><span class="katex-mathml"><math><mtable><mtr><mtd>x+y=10</mtd></mtr><mtr><mtd>2x-y=5</mtd></mtr></mtable></math></span><span class="katex-html"><span class="base"><span class="mord"><span class="vlist-t">',
      row('x + y = 10'),
      row('2x - y = 5'),
      '</span></span></span></span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '1 4 2 5 3 6\nx + y = 10\n2x - y = 5' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          if (element.classList.contains('vlist-t')) {
            return declaration({ display: 'inline-table', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist-r')) {
            return declaration({ display: 'table-row', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist')) {
            return declaration({ display: 'table-cell', position: 'relative', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('pstrut')) {
            return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
          }
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const visualText = (holder.textContent ?? '').replaceAll('\u2060', '').replace(/\s+/g, ' ');
    expect(holder.querySelectorAll('nobr')).toHaveLength(2);
    expect(holder.querySelectorAll('nobr[style*="display:inline-block!important"]')).toHaveLength(2);
    expect(holder.querySelector('math')).toBeNull();
    expect(holder.querySelectorAll('span[style*="display:inline-table"]').length).toBeGreaterThanOrEqual(4);
    expect(holder.querySelectorAll('span[style*="display:table-row"]').length).toBeGreaterThanOrEqual(8);
    expect(holder.querySelectorAll('span[style*="display:table-cell"]').length).toBeGreaterThanOrEqual(8);
    expect(holder.querySelectorAll('span[style*="height:45.7344px"]').length).toBeGreaterThanOrEqual(8);
    expect(visualText).toContain('142536');
    expect(visualText).toContain('x + y = 10');
    expect(visualText).toContain('2x - y = 5');
  });

});
