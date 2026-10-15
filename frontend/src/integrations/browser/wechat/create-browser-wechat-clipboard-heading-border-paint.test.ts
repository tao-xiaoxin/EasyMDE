import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  dispatchSuccessfulLegacyCopy,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

type HeadingCase =
  | 'triangle'
  | 'rule'
  | 'absolute'
  | 'zero-size'
  | 'transparent-border'
  | 'opacity-zero'
  | 'hidden'
  | 'special-layout'
  | 'authored';

/** Shapes that must reach the generated U+2060 heading transport. */
const PROTECTED_CLASSES: readonly HeadingCase[] = ['triangle', 'rule'];

/**
 * Every exclusion keeps the existing serialization path: a surviving
 * decoration still carries a plain ASCII space and never the generated-shape
 * transport.
 */
const EXCLUDED_CLASSES: readonly HeadingCase[] = [
  'absolute',
  'zero-size',
  'transparent-border',
  'opacity-zero',
  'hidden',
  'special-layout',
  'authored'
];

const HEADING_CASES: readonly HeadingCase[] = [...PROTECTED_CLASSES, ...EXCLUDED_CLASSES];

const HEADING_TEXT: Readonly<Record<HeadingCase, string>> = {
  triangle: 'Triangle',
  rule: 'Rule',
  absolute: 'Absolute',
  'zero-size': 'Zero size',
  'transparent-border': 'No paint',
  'opacity-zero': 'Transparent',
  hidden: 'Hidden',
  'special-layout': 'Special',
  authored: 'Authored'
};

const SOURCE_TEXT = HEADING_CASES.map((className) => HEADING_TEXT[className]).join('\n');

function headingCaseFor(element: Element): HeadingCase | null {
  const className = [...element.classList][0] as HeadingCase | undefined;
  return className && className in HEADING_TEXT ? className : null;
}

function buildPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = HEADING_CASES.map((className) => {
    const heading = `<h2 class="${className}">${HEADING_TEXT[className]}</h2>`;
    // Special-layout exclusion is an ancestor contract, so the fixture keeps
    // the heading inside the math scope.
    return 'special-layout' === className ? `<div class="katex">${heading}</div>` : heading;
  }).join('');
  Object.defineProperty(preview, 'innerText', { configurable: true, value: SOURCE_TEXT });
  preview.querySelectorAll<HTMLElement>('h2').forEach((heading) => {
    const rect = { bottom: 40, height: 40, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0 };
    Object.defineProperty(heading, 'getBoundingClientRect', { configurable: true, value: () => rect });
  });
  return preview;
}

/**
 * Mirrors the measured `orange-heart` `h2::after` shape: a whitespace-only
 * generated box with a transparent right edge and a visible bottom triangle
 * edge. Only the tested exclusion changes per case.
 */
function styleFor() {
  return (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
    if (!pseudoElement) return declaration({ display: 'block', visibility: 'visible' });
    if ('::after' !== pseudoElement || 'H2' !== element.tagName) return declaration({ content: 'none' });
    const className = headingCaseFor(element);
    if (!className) return declaration({ content: 'none' });
    // The authored fixture keeps real text content, so it never has a
    // generated pseudo layer.
    if ('authored' === className) return declaration({ content: 'none' });
    const box =
      'zero-size' === className
        ? { height: '0px', width: '0px' }
        : PROTECTED_CLASSES.includes(className)
          ? { height: '36px', width: '20px' }
          : { height: '20px', width: '20px' };
    return declaration({
      'border-bottom-color': 'transparent-border' === className ? 'rgba(0, 0, 0, 0)' : 'rgb(239, 235, 233)',
      'border-bottom-style': 'solid',
      'border-bottom-width': '36px',
      'border-left-style': 'none',
      'border-left-width': '0px',
      'border-right-color': 'rgba(0, 0, 0, 0)',
      'border-right-style': 'solid',
      'border-right-width': '20px',
      'border-top-style': 'none',
      'border-top-width': '0px',
      content: '" "',
      display: 'block',
      opacity: 'opacity-zero' === className ? '0' : '1',
      position: 'absolute' === className ? 'absolute' : 'static',
      visibility: 'hidden' === className ? 'hidden' : 'visible',
      ...box
    });
  };
}

class ClipboardItemStub {
  constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
}

function modernClipboard(writes: unknown[]) {
  return createBrowserWechatClipboard({
    blob: Blob,
    clipboardItem: ClipboardItemStub,
    document,
    getComputedStyle: styleFor(),
    getSelection: window.getSelection.bind(window),
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: vi.fn(),
    write: async (items) => {
      writes.push(items);
    }
  });
}

async function clipboardHtml(preview: HTMLElement): Promise<Readonly<{ html: string; plainText: string }>> {
  const writes: unknown[] = [];
  const clipboard = modernClipboard(writes);
  Object.defineProperty(preview, 'innerText', { configurable: true, value: preview.innerText });
  await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
  const item = (writes[0] as ClipboardItemStub[])[0];
  const htmlBlob = item?.payload['text/html'];
  const textBlob = item?.payload['text/plain'];
  if (!htmlBlob || !textBlob) throw new Error('heading border paint payload missing');
  return { html: await blobText(htmlBlob), plainText: await blobText(textBlob) };
}

describe('createBrowserWechatClipboard heading border paint', () => {
  installClipboardTestEnvironment();

  it('protects generated whitespace-only heading-after shapes with a visible border edge', async () => {
    const preview = buildPreview();
    const sourceMarkup = preview.innerHTML;
    const { html, plainText } = await clipboardHtml(preview);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    // The clone drops the authoring `class` attribute, so identify each
    // heading by its retained text and generated marker.
    const markerByText = new Map<string, HTMLElement | null>();
    [...holder.querySelectorAll<HTMLElement>('h2')].forEach((heading) => {
      markerByText.set(
        (heading.textContent ?? '').replaceAll('\u2060', '').trim(),
        heading.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]')
      );
    });
    expect(markerByText.size).toBe(HEADING_CASES.length);
    PROTECTED_CLASSES.forEach((className) => {
      const marker = markerByText.get(HEADING_TEXT[className]);
      expect(marker, className).toBeDefined();
      // The existing finalize step converts the sole ASCII space of a
      // generated shape into the U+2060 transport, which is the only value
      // that survives the destination's whitespace normalization.
      expect(marker?.textContent, className).toBe('\u2060');
      const style = marker?.getAttribute('style') ?? '';
      expect(style, className).toContain('display:block');
      expect(style, className).toContain('width:20px');
      expect(style, className).toContain('height:36px');
      expect(style, className).toContain('border-bottom-width:36px');
      expect(style, className).toContain('border-bottom-style:solid');
      expect(style, className).toContain('border-bottom-color:rgb(239, 235, 233)');
      expect(style, className).toContain('border-right-width:20px');
      expect(style, className).toContain('border-right-style:solid');
      expect(style, className).toContain('border-right-color:rgba(0, 0, 0, 0)');
    });
    EXCLUDED_CLASSES.forEach((className) => {
      const marker = markerByText.get(HEADING_TEXT[className]);
      expect(marker?.textContent ?? ' ', className).toBe(' ');
    });
    expect(await (await Promise.resolve(plainText)).length).toBeGreaterThan(0);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('does not extend the generated transport to a root heading or an unpainted edge', async () => {
    const rootPreview = document.createElement('h1');
    rootPreview.setAttribute('data-easymde-preview-html-sink', '1');
    rootPreview.textContent = 'Root heading';
    Object.defineProperty(rootPreview, 'innerText', { configurable: true, value: 'Root heading' });
    const rootWrites: unknown[] = [];
    const rootClipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement
          ? declaration({
              content: '" "',
              display: 'block',
              height: '36px',
              opacity: '1',
              position: 'static',
              visibility: 'visible',
              width: '20px'
            })
          : declaration({ display: 'block', visibility: 'visible' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        rootWrites.push(items);
      }
    });
    await expect(rootClipboard.copy(rootPreview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const rootItem = (rootWrites[0] as ClipboardItemStub[])[0];
    const rootBlob = rootItem?.payload['text/html'];
    if (!rootBlob) throw new Error('root heading payload missing');
    const rootHolder = document.createElement('div');
    rootHolder.innerHTML = await blobText(rootBlob);
    expect(rootHolder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(rootHolder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).not.toBe('\u2060');

    const transparent = document.createElement('article');
    transparent.setAttribute('data-easymde-preview-html-sink', '1');
    transparent.innerHTML = `<h2 class="transparent-border">${HEADING_TEXT['transparent-border']}</h2>`;
    Object.defineProperty(transparent, 'innerText', { configurable: true, value: HEADING_TEXT['transparent-border'] });
    const { html } = await clipboardHtml(transparent);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(html).not.toContain('\u2060');
  });

  it('keeps modern and legacy Clipboard HTML identical for the generated border shape', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = `<h2 class="triangle">${HEADING_TEXT.triangle}</h2>`;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: HEADING_TEXT.triangle });
    const modernWrites: unknown[] = [];
    const modern = modernClipboard(modernWrites);
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    if (!modernHtmlBlob) throw new Error('modern heading payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(modernHtml).toContain('\u2060');

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: styleFor(),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });
});
