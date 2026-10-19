import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import { connectedPlainText } from './wechat-portable-serialization';

import {
  blobText,
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

const PLAIN_TEXT_MEDIA_ATTRIBUTES = ['src', 'srcset', 'poster'] as const;
type PlainTextMediaAttribute = (typeof PLAIN_TEXT_MEDIA_ATTRIBUTES)[number];
type MediaAttributeSnapshot = {
  element: Element;
  values: Record<PlainTextMediaAttribute, string | null>;
};

function snapshotMediaAttributes(root: ParentNode): MediaAttributeSnapshot[] {
  return Array.from(root.querySelectorAll('img, video, source')).map((element) => ({
    element,
    values: {
      src: element.getAttribute('src'),
      srcset: element.getAttribute('srcset'),
      poster: element.getAttribute('poster')
    }
  }));
}

function expectMediaAttributes(root: ParentNode, snapshots: readonly MediaAttributeSnapshot[]): void {
  const elements = Array.from(root.querySelectorAll('img, video, source'));
  expect(elements).toHaveLength(snapshots.length);
  snapshots.forEach((snapshot, index) => {
    const element = elements[index];
    expect(element).toBe(snapshot.element);
    PLAIN_TEXT_MEDIA_ATTRIBUTES.forEach((attribute) => {
      expect(element?.getAttribute(attribute)).toBe(snapshot.values[attribute]);
    });
  });
}

function expectMediaAttributeValues(root: ParentNode, snapshots: readonly MediaAttributeSnapshot[]): void {
  const elements = Array.from(root.querySelectorAll('img, video, source'));
  expect(elements).toHaveLength(snapshots.length);
  snapshots.forEach((snapshot, index) => {
    const element = elements[index];
    PLAIN_TEXT_MEDIA_ATTRIBUTES.forEach((attribute) => {
      expect(element?.getAttribute(attribute)).toBe(snapshot.values[attribute]);
    });
  });
}

function mediaAttributesAreRemoved(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll('img, video, source')).every((element) =>
    PLAIN_TEXT_MEDIA_ATTRIBUTES.every((attribute) => !element.hasAttribute(attribute))
  );
}

function createMediaPlainTextFixture(): Readonly<{
  bodyChildren: readonly Element[];
  root: HTMLElement;
  rootMedia: MediaAttributeSnapshot[];
  source: HTMLElement;
  sourceMedia: MediaAttributeSnapshot[];
}> {
  const markup = [
    '<p>Before <img src="https://example.test/inline.png" srcset="" alt="inline">',
    '<video src="" poster="https://example.test/poster.jpg">',
    '<source src="https://example.test/movie.mp4" srcset="" poster="">',
    '</video> after</p>'
  ].join('');
  const root = document.createElement('article');
  root.innerHTML = markup;
  const source = document.createElement('article');
  source.setAttribute('data-easymde-preview-html-sink', '1');
  source.innerHTML = markup;
  Object.defineProperty(source, 'innerText', { configurable: true, value: 'Before  after' });
  Object.defineProperty(source, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 320 })
  });
  return {
    bodyChildren: Array.from(document.body.children),
    root,
    rootMedia: snapshotMediaAttributes(root),
    source,
    sourceMedia: snapshotMediaAttributes(source)
  };
}

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('preserves connected Preview block boundaries in text-only clipboard data', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>First paragraph</p><p>Second paragraph</p><ul><li>A</li><li>B</li></ul>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'First paragraph\n\nSecond paragraph\n\nA\nB'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const textBlob = item?.payload['text/plain'];
    if (!textBlob) throw new Error('clipboard text missing');
    expect(await blobText(textBlob)).toBe('First paragraph\n\nSecond paragraph\n\nA\nB');
  });

  it('measures modern plain text against the rendered Preview width', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Measured text</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Measured text' });
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 312 }) });
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let measuredWidth = '';
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        if ('fixed' === this.parentElement?.style.position) {
          measuredWidth = this.parentElement.style.width;
        }
        return this.textContent ?? '';
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(measuredWidth).toBe('312px');
      expect(writes).toHaveLength(1);
    } finally {
      if (originalInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      } else {
        delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      }
    }
  });

  it('reuses the last visible Preview width while the source mode hides Preview', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Hidden Preview text</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden Preview text' });
    let previewVisible = true;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: previewVisible ? 312 : 0 })
    });
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    const measuredWidths: string[] = [];
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        if ('fixed' === this.parentElement?.style.position) {
          measuredWidths.push(this.parentElement.style.width);
        }
        return this.textContent ?? '';
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    clipboard.rememberPreviewWidth?.(preview);
    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      previewVisible = false;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(measuredWidths).toEqual(['312px', '312px']);
      expect(writes).toHaveLength(2);
    } finally {
      if (originalInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      } else {
        delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      }
    }
  });

  it('restores raw media attributes after connected plaintext measurement and repeat', () => {
    const { bodyChildren, root, rootMedia, source, sourceMedia } = createMediaPlainTextFixture();
    const measurementConnected: boolean[] = [];
    const measurementMediaRemoved: boolean[] = [];
    Object.defineProperty(root, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        measurementConnected.push(this.parentElement?.style.position === 'fixed');
        measurementMediaRemoved.push(mediaAttributesAreRemoved(this));
        return 'Before  after';
      }
    });

    expect(connectedPlainText(root, source)).toBe('Before  after');
    expect(connectedPlainText(root, source)).toBe('Before  after');

    expect(measurementConnected).toEqual([true, true]);
    expect(measurementMediaRemoved).toEqual([true, true]);
    expectMediaAttributes(root, rootMedia);
    expectMediaAttributes(source, sourceMedia);
    expect(root.parentElement).not.toBeNull();
    expect(root.parentElement?.parentNode).toBeNull();
    expect(Array.from(document.body.children)).toEqual(bodyChildren);
  });

  it('restores media attributes and removes the host when innerText throws', () => {
    const { bodyChildren, root, rootMedia, source, sourceMedia } = createMediaPlainTextFixture();
    let measurementConnected = false;
    let measurementMediaRemoved = false;
    Object.defineProperty(root, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        measurementConnected = this.parentElement?.style.position === 'fixed';
        measurementMediaRemoved = mediaAttributesAreRemoved(this);
        throw new Error('plain-text-inner-text-failed');
      }
    });

    expect(() => connectedPlainText(root, source)).toThrow('plain-text-inner-text-failed');
    expect(measurementConnected).toBe(true);
    expect(measurementMediaRemoved).toBe(true);
    expectMediaAttributes(root, rootMedia);
    expectMediaAttributes(source, sourceMedia);
    expect(root.parentElement).not.toBeNull();
    expect(root.parentElement?.parentNode).toBeNull();
    expect(Array.from(document.body.children)).toEqual(bodyChildren);
  });

  it('restores media attributes and rethrows a preconnect width failure', () => {
    const { bodyChildren, root, rootMedia, source, sourceMedia } = createMediaPlainTextFixture();
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        throw new Error('plain-text-width-read-failed');
      }
    });

    expect(() => connectedPlainText(root, source)).toThrow('plain-text-width-read-failed');
    expectMediaAttributes(root, rootMedia);
    expectMediaAttributes(source, sourceMedia);
    expect(root.parentNode).toBeNull();
    expect(Array.from(document.body.children)).toEqual(bodyChildren);
  });

  it('preserves inline media layout and width with responsive bounds', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Before <img src="https://example.test/inline.png" alt="Inline"> after</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before  after' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (element instanceof HTMLImageElement && !pseudoElement) {
          return declaration({
            display: 'inline',
            'margin-left': '3px',
            'margin-right': '4px',
            'vertical-align': 'middle',
            width: '24px',
            height: '16px'
          });
        }
        return computedStyle(element, pseudoElement);
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
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const image = holder.querySelector('img');
    expect(image?.getAttribute('style')).toContain('display:inline');
    expect(image?.getAttribute('style')).toContain('margin-left:3px');
    expect(image?.getAttribute('style')).toContain('margin-right:4px');
    expect(image?.getAttribute('style')).toContain('width:24px');
    expect(image?.getAttribute('style')).toContain('max-width:100%');
    expect(image?.getAttribute('style')).toContain('height:auto');
    expect(image?.getAttribute('style')).not.toContain('display:block');
    expect(image?.getAttribute('style')).not.toContain('margin:0 auto');
  });

  it('does not serialize editor geometry into the pasted article', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Heading</h1><p>Portable content</p><table><tbody><tr><td>Cell</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Heading\nPortable content\nCell' });
    const values: Record<string, string> = {
      display: 'grid',
      position: 'fixed',
      float: 'left',
      background: 'url("https://unsafe.example")',
      overflow: 'hidden',
      width: '1024px',
      height: '640px',
      'background-color': 'rgb(250, 251, 252)',
      color: 'rgb(20, 21, 22)',
      'font-family': 'EasyMDE Inter',
      'font-size': '18px',
      'font-weight': '600',
      'line-height': '1.6',
      'text-align': 'left',
      'word-break': 'break-word',
      'overflow-wrap': 'anywhere'
    };
    const exportStyleContextAttribute = 'data-easymde-wechat-export-style-context';
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        element === preview || '1' === element.getAttribute(exportStyleContextAttribute)
          ? declaration(values)
          : declaration({ display: 'block' }),
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
    const html = await blobText(htmlBlob);
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await blobText(textBlob);
    expect(html).toContain('background-color:rgb(250, 251, 252)');
    expect(html).toContain('line-height:1.6');
    expect(html).not.toContain('display:grid');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('float:left');
    expect(html).not.toContain('overflow:hidden');
    expect(html).not.toContain('width:1024px');
    expect(html).not.toContain('unsafe.example');
    expect(html).not.toContain('height:640px');
    expect(text).toContain('Heading');
  });


  it('restores H2 suffix and code markers around connected plaintext with authored FEFF', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2><span class="prefix"></span><span class="content">Heading</span><span class="suffix"></span></h2>',
      '<p>Body \uFEFF authored</p>',
      '<p><img src="https://example.test/rollback.png" alt="rollback"><video src="https://example.test/rollback.mp4" poster="https://example.test/rollback.jpg"><source src="https://example.test/rollback-source.mp4" srcset="https://example.test/rollback-source-2.mp4 2x" poster="https://example.test/rollback-poster.jpg"></video></p>',
      '<pre><code><span>#</span><span>336699</span>\n#\uFEFFauthored</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceMedia = snapshotMediaAttributes(preview);
    const sourceText = 'Heading\nBody \uFEFF authored\n#336699\n#\uFEFFauthored';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('combined suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 200 })
    });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
        return declaration({
          'background-color': 'rgba(64, 184, 250, 1)',
          display: 'inline-block',
          height: '10px',
          opacity: '1',
          visibility: 'visible',
          width: '200px'
        });
      }
      if ('PRE' === element.tagName || 'CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre', visibility: 'visible' });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('combined marker payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe(sourceText);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expectMediaAttributeValues(modernHolder, sourceMedia);
    expect(modernHolder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
    expect(modernHolder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    expect(modernHolder.querySelector('pre > code')?.textContent).toContain('#\uFEFFauthored');
    expect(modernHolder.textContent).toContain('Body \uFEFF authored');

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
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    let measuredClone: HTMLElement | null = null;
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if (this !== preview && this.querySelector('pre > code') && this.querySelector('h2')) {
          measuredClone = this;
          throw new Error('combined-plain-text-measurement-failed');
        }
        return this.textContent ?? '';
      }
    });
    try {
      const throwing = createRuntime(ClipboardItemStub, async () => undefined);
      await expect(throwing.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const cloneAfterThrow = measuredClone as HTMLElement | null;
      expect(cloneAfterThrow).not.toBeNull();
      expectMediaAttributeValues(cloneAfterThrow as HTMLElement, sourceMedia);
      expect(cloneAfterThrow?.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
      expect(cloneAfterThrow?.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
      expect(cloneAfterThrow?.textContent).toContain('Body \uFEFF authored');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

});
