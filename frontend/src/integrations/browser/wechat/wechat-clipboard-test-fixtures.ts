import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

import type {
  WechatClipboardCopyOptions,
  WechatClipboardPreparationOptions
} from '../../../contracts/ports/wechat-clipboard-port';
import type { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';


export function readyPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', 'true');
  preview.innerHTML =
    '<p id="private-id" class="theme-class" data-easymde-rendered="1">Rendered</p><script>bad()</script><style>.bad{}</style>';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Rendered' });
  return preview;
}
export function computedStyle(element: Element, pseudoElement?: string): CSSStyleDeclaration {
  if (pseudoElement) return { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
  return window.getComputedStyle(element);
}

export function declaration(values: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (property: string) => values[property] ?? '' } as unknown as CSSStyleDeclaration;
}



const safeMermaidComputedStyleMap = (): Readonly<{ get: (property: string) => Readonly<{ value: string }> }> => ({
  get: (property) => ({
    value:
      {
        'block-size': 'auto',
        height: 'auto',
        'max-block-size': 'none',
        'max-height': 'none',
        'min-block-size': 'auto',
        'min-height': 'auto'
      }[property] ?? 'auto'
  })
});

export function setMermaidComputedStyleMap(source: Element, overrides: Record<string, string> = {}): void {
  Object.defineProperty(source, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (property: string) => ({
        ...safeMermaidComputedStyleMap().get(property),
        ...(property in overrides ? { value: overrides[property] } : {})
      })
    })
  });
}

export function mdmdtNormalPngDataUrl(): string {
  const css = readFileSync(join(process.cwd(), 'assets/themes/article/mdmdt.css'), 'utf8');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while (true) {
    match = rulePattern.exec(css);
    if (null === match) break;
    const selectorText = match[1];
    const ruleText = match[2];
    if (undefined === selectorText || undefined === ruleText) continue;
    const selectors = selectorText.split(',').map((selector) => selector.trim());
    if (!selectors.includes('.easymde-rendered-content.easymde-markdown-theme-mdmdt p a::before')) continue;
    const dataUrl = /background-image:\s*url\(["'](data:image\/png;base64,[^"']+)["']\)/u.exec(ruleText)?.[1];
    if (dataUrl) return dataUrl;
  }
  throw new Error('Mdmdt normal PNG data URI missing');
}

export async function blobText(value: Blob | PromiseLike<Blob>): Promise<string> {
  return (await value).text();
}

export function codeRows(code: Element | null): HTMLElement | null {
  if (!code) return null;
  return (
    [...code.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        'SPAN' === child.tagName &&
        (child.getAttribute('style') ?? '').includes('display:block!important') &&
        (child.getAttribute('style') ?? '').includes('width:max-content!important')
    ) ?? null
  );
}

export function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

export function installHiddenImageProbe(): Readonly<{
  capture: () => HTMLImageElement | null;
  dispatch: (type: 'error' | 'load') => void;
  restore: () => void;
  setReady: (ready: boolean) => void;
  workspace: HTMLElement;
  preview: HTMLElement;
}> {
  let cloneImageReady = false;
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = '<p>Image readiness</p><img loading="lazy" src="https://example.test/ready.png">';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image readiness' });
  const sourceImage = preview.querySelector('img');
  if (!sourceImage) throw new Error('hidden probe source image missing');
  Object.defineProperties(sourceImage, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 64 },
    naturalHeight: { configurable: true, value: 32 }
  });
  const workspace = document.createElement('div');
  workspace.className = 'workspace-shell';
  workspace.append(preview);
  document.body.append(workspace);
  let lastClone: HTMLImageElement | null = null;
  const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
  const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
  const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
  const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: HTMLElement) {
      if (this.classList.contains('workspace-shell')) {
        return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
      }
      return (
        originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
      );
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') ? cloneImageReady : true;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 64 : 0;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 32 : 0;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn(async () => undefined)
  });

  return {
    capture: () => {
      lastClone = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img');
      return lastClone;
    },
    dispatch: (type) => {
      const image = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img') ?? lastClone;
      if (!image) throw new Error('hidden probe clone image missing');
      lastClone = image;
      image.dispatchEvent(new Event(type));
    },
    restore: () => {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight)
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
      workspace.remove();
    },
    setReady: (ready) => {
      cloneImageReady = ready;
    },
    workspace,
    preview
  };
}

export function prepareClipboard(
  clipboard: ReturnType<typeof createBrowserWechatClipboard>,
  preview: HTMLElement,
  options?: WechatClipboardPreparationOptions
): Promise<void> {
  const prepare = clipboard.prepare;
  if (!prepare) throw new Error('clipboard preparation is unavailable');
  return prepare(preview, options);
}

export function pngOptions(
  rasterize: NonNullable<WechatClipboardCopyOptions['visualRasterizationPort']>,
  upload: NonNullable<WechatClipboardCopyOptions['imageUploadPort']>,
  overrides: Partial<WechatClipboardCopyOptions> = {}
): WechatClipboardCopyOptions {
  return {
    imageUploadPort: upload,
    maxBytes: 1024,
    pngConversionEnabled: true,
    postId: 17,
    signal: new AbortController().signal,
    visualRasterizationPort: rasterize,
    ...overrides
  };
}


export function installClipboardTestEnvironment(): void {
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  const originalComputedStyleMap = Object.getOwnPropertyDescriptor(Element.prototype, 'computedStyleMap');
  const originalGetAnimations = Object.getOwnPropertyDescriptor(document, 'getAnimations');

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'computedStyleMap', {
      configurable: true,
      value: safeMermaidComputedStyleMap
    });
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: () => [] });
  });

  afterEach(() => {
    document.querySelectorAll('.easymde-copy-sandbox').forEach((element) => {
      element.remove();
    });
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    if (originalComputedStyleMap) {
      Object.defineProperty(Element.prototype, 'computedStyleMap', originalComputedStyleMap);
    } else {
      delete (Element.prototype as unknown as { computedStyleMap?: unknown }).computedStyleMap;
    }
    if (originalGetAnimations) {
      Object.defineProperty(document, 'getAnimations', originalGetAnimations);
    } else {
      delete (document as unknown as { getAnimations?: unknown }).getAnimations;
    }
  });
}
