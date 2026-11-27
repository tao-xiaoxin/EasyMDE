import { afterEach } from 'vitest';

import type {
  WechatClipboardCopyOptions,
  WechatClipboardPreparationOptions
} from '../../../contracts/ports/wechat-clipboard-port';
import type { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

export function readyPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', 'true');
  preview.innerHTML = '<p id="private-id" class="theme-class" data-easymde-rendered="1">Rendered</p><script>bad()</script><style>.bad{}</style>';
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

export async function blobText(value: Blob | PromiseLike<Blob>): Promise<string> {
  return (await value).text();
}

export function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
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

export function registerWechatClipboardCleanup(): void {
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

  afterEach(() => {
    document.querySelectorAll('.easymde-copy-sandbox').forEach((element) => {
      element.remove();
    });
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });
}
