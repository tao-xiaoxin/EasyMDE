import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import { pseudoContent } from './wechat-pseudo-content';

import {
  blobText,
  declaration,
  dispatchSuccessfulLegacyCopy,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

type WhitespaceCase =
  | 'empty'
  | 'space'
  | 'multi-space'
  | 'tab'
  | 'nbsp'
  | 'newline'
  | 'authored';

/** Parsed `content` values that must reach the generated transport. */
const TRANSPORT_CASES: Readonly<Record<WhitespaceCase, string>> = {
  empty: '',
  space: ' ',
  'multi-space': '  ',
  tab: '\t',
  nbsp: '\u00a0',
  newline: '\n',
  authored: ' x '
};

/** Values as CSSOM serializes the quoted `content` declaration. */
const CSSOM_CONTENT_CASES: Readonly<Record<WhitespaceCase, string>> = {
  ...TRANSPORT_CASES,
  // CSSOM serializes `content: '\\9 '` as the quoted value below.
  tab: String.raw`\9 `,
  newline: String.raw`\a `
};

const TRANSPORTED_CASES: readonly WhitespaceCase[] = ['empty', 'space', 'multi-space', 'tab', 'nbsp'];

const HEADING_TEXT: Readonly<Record<WhitespaceCase, string>> = {
  empty: 'Empty',
  space: 'Space',
  'multi-space': 'Multi space',
  tab: 'Tab',
  nbsp: 'Nbsp',
  newline: 'Newline',
  authored: 'Authored'
};

// CSSOM `\a ` is a real authored newline after decoding. In jsdom that
// newline keeps connected measurement on the clone path, whose block text is
// intentionally used as the source fixture for this transport test.
const SOURCE_TEXT = 'Empty Space Multi space  Tab\tNbsp Newline\nAuthored x ';

function quoted(value: string): string {
  return `"${value.replace(/\n/gu, '\\a ')}"`;
}

function whitespaceCaseFor(element: Element): WhitespaceCase | null {
  const className = [...element.classList][0] as WhitespaceCase | undefined;
  return className && className in HEADING_TEXT ? className : null;
}

function buildPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = (Object.keys(HEADING_TEXT) as WhitespaceCase[])
    .map((name) => `<h2 class="${name}">${HEADING_TEXT[name]}</h2>`)
    .join('');
  Object.defineProperty(preview, 'innerText', { configurable: true, value: SOURCE_TEXT });
  return preview;
}

function styleFor() {
  return (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
    if (!pseudoElement) return declaration({ display: 'block', visibility: 'visible' });
    if ('::after' !== pseudoElement || 'H2' !== element.tagName) return declaration({ content: 'none' });
    const className = whitespaceCaseFor(element);
    if (!className) return declaration({ content: 'none' });
    return declaration({
      'border-bottom-color': 'rgb(239, 235, 233)',
      'border-bottom-style': 'solid',
      'border-bottom-width': '36px',
      'border-left-style': 'none',
      'border-left-width': '0px',
      'border-right-color': 'rgba(0, 0, 0, 0)',
      'border-right-style': 'solid',
      'border-right-width': '20px',
      'border-top-style': 'none',
      'border-top-width': '0px',
      content: quoted(CSSOM_CONTENT_CASES[className]),
      display: 'block',
      height: '36px',
      opacity: '1',
      position: 'static',
      visibility: 'visible',
      width: '20px'
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

async function payloadFor(preview: HTMLElement): Promise<Readonly<{ html: string; plainText: string }>> {
  const writes: unknown[] = [];
  const clipboard = modernClipboard(writes);
  await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
  const item = (writes[0] as ClipboardItemStub[])[0];
  const htmlBlob = item?.payload['text/html'];
  const textBlob = item?.payload['text/plain'];
  if (!htmlBlob || !textBlob) throw new Error('heading whitespace payload missing');
  return { html: await blobText(htmlBlob), plainText: await blobText(textBlob) };
}

function markerByHeadingText(holder: HTMLElement): Map<string, HTMLElement | null> {
  const map = new Map<string, HTMLElement | null>();
  [...holder.querySelectorAll<HTMLElement>('h2')].forEach((heading) => {
    map.set(
      (heading.textContent ?? '').replaceAll('\u2060', '').trim(),
      heading.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]')
    );
  });
  return map;
}

describe('createBrowserWechatClipboard heading whitespace transport', () => {
  installClipboardTestEnvironment();

  it('decodes CSSOM character escapes while preserving newline, authored text, and a literal backslash', () => {
    expect(pseudoContent(quoted(CSSOM_CONTENT_CASES.tab))).toBe('\t');
    expect(pseudoContent(quoted(String.raw`\000009 `))).toBe('\t');
    expect(pseudoContent(quoted(CSSOM_CONTENT_CASES.newline))).toBe('\n');
    expect(pseudoContent(quoted(CSSOM_CONTENT_CASES.authored))).toBe(' x ');
    expect(pseudoContent(quoted(String.raw`\22 `))).toBe('"');
    expect(pseudoContent(quoted(String.raw`\\9 `))).toBe(String.raw`\9 `);
  });

  it('transports the generated empty, space, multi-space, tab, and non-breaking-space suffixes', async () => {
    const preview = buildPreview();
    const sourceMarkup = preview.innerHTML;
    const { html, plainText } = await payloadFor(preview);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const markers = markerByHeadingText(holder);
    expect(markers.size).toBe(Object.keys(HEADING_TEXT).length);
    TRANSPORTED_CASES.forEach((name) => {
      const marker = markers.get(HEADING_TEXT[name]);
      expect(marker, name).toBeDefined();
      expect(marker?.textContent, name).toBe('\u2060');
      const style = marker?.getAttribute('style') ?? '';
      expect(style, name).toContain('width:20px');
      expect(style, name).toContain('height:36px');
      expect(style, name).toContain('border-bottom-width:36px');
      expect(style, name).toContain('border-bottom-color:rgb(239, 235, 233)');
    });
    // A newline and authored text stay on the existing path: their marker text
    // is never rewritten as generated decoration.
    (['newline', 'authored'] as const).forEach((name) => {
      expect(markers.get(HEADING_TEXT[name])?.textContent ?? ' ', name).not.toBe('\u2060');
    });
    expect(plainText).toBe(SOURCE_TEXT);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps modern and legacy Clipboard HTML identical for every transported whitespace value', async () => {
    const preview = buildPreview();
    const { html: modernHtml, plainText: modernText } = await payloadFor(preview);
    expect(modernHtml).toContain('\u2060');
    expect(modernText).toBe(SOURCE_TEXT);

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

  it('restores the parsed whitespace instead of the transport glyph during plain-text measurement', async () => {
    // A long non-breaking-space suffix makes a leaked transport glyph or a
    // collapsed character visible in the measured text length.
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = `<h2 class="nbsp">${HEADING_TEXT.nbsp}</h2>`;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '\u00a0\u00a0' });
    const { html, plainText } = await payloadFor(preview);
    expect(html).toContain('\u2060');
    // The connected measurement reads the restored parsed content, so the
    // restored non-breaking spaces survive as whitespace text and no transport
    // glyph leaks into the separate plain-text payload. Destination whitespace
    // collapsing may reduce the run, so assert restoration, not the exact run.
    expect(plainText).toContain('Nbsp ');
    expect(plainText).not.toContain('\u2060');
  });
});
