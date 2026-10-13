import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import type { BrowserWechatVisualRasterizerRuntime } from './create-browser-wechat-visual-rasterizer';

export class ImageStub {
  crossOrigin = '';
  decode = vi.fn(async () => undefined);
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  source = '';
  shouldFail = false;

  constructor() {
    imageInstances.push(this);
  }

  set src(value: string) {
    this.source = value;
    imageEvents.push('image-src');
    activeEventLog?.push('image-src');
    if (this.shouldFail) this.onerror?.();
    else this.onload?.();
  }
}

export const imageInstances: ImageStub[] = [];
export const imageEvents: string[] = [];
let activeEventLog: string[] | null = null;

export function setActiveEventLog(events: string[] | null): void {
  activeEventLog = events;
}

function fontFixture(name: string): ArrayBuffer {
  const bytes = readFileSync(join(process.cwd(), 'assets/vendor/katex/fonts', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bundledFontFixture(path: string): ArrayBuffer {
  const bytes = readFileSync(join(process.cwd(), 'assets/vendor/fonts', path));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export const KATEX_BOLD_ITALIC_FONT = fontFixture('KaTeX_Main-BoldItalic.woff2');
export const KATEX_REGULAR_FONT = fontFixture('KaTeX_Main-Regular.woff2');
const INTER_REGULAR_FONT = bundledFontFixture('inter/inter-latin-400-normal.woff2');
const LORA_REGULAR_FONT = bundledFontFixture('lora/lora-latin-400-normal.woff2');
const JETBRAINS_REGULAR_FONT = bundledFontFixture('jetbrains-mono/jetbrains-mono-latin-400-normal.woff2');
let styleSheetsDescriptor: PropertyDescriptor | undefined;
let fontsDescriptor: PropertyDescriptor | undefined;
let fontFaceDescriptor: PropertyDescriptor | undefined;
let cryptoDescriptor: PropertyDescriptor | undefined;

export class FontFaceStub {
  load = vi.fn(async () => this);
}

export function runtime(
  overrides: Partial<BrowserWechatVisualRasterizerRuntime> = {},
): BrowserWechatVisualRasterizerRuntime {
  return {
    approvedAssetBaseUrl: `${document.location.origin}/wp-content/plugins/easymde/`,
    approvedKaTeXCssUrl: `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
    blob: Blob,
    document,
    file: File,
    image: ImageStub as unknown as typeof Image,
    xmlSerializer: XMLSerializer,
    ...overrides,
  };
}

export function installFontFaces(
  faces: ReadonlyArray<Readonly<Record<string, string>>>,
  stylesheetHref = `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
): void {
  styleSheetsDescriptor = Object.getOwnPropertyDescriptor(document, 'styleSheets');
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    value: [{
      cssRules: faces.map((face) => ({
        style: {
          getPropertyValue: (property: string) => face[property] ?? '',
        },
        type: 5,
      })),
      href: stylesheetHref,
    }],
  });
}

export function installDocumentFonts(value: unknown): void {
  fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value,
  });
}

export function fontResponse(value: ArrayBuffer = KATEX_REGULAR_FONT): Response {
  return new Response(value, {
    headers: { 'content-type': 'font/woff2' },
    status: 200,
  });
}

export function bundledFontResponse(input: RequestInfo | URL): Response {
  const value = String(input);
  if (value.includes('/fonts/lora/')) return fontResponse(LORA_REGULAR_FONT);
  if (value.includes('/fonts/jetbrains-mono/')) return fontResponse(JETBRAINS_REGULAR_FONT);
  return fontResponse(INTER_REGULAR_FONT);
}

export function serializedImage(): string {
  const source = imageInstances[imageInstances.length - 1]?.source ?? '';
  return decodeURIComponent(source.slice(source.indexOf(',') + 1));
}

export function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
  });
}

export function stubInlineBaselineLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const style = (this as Element & { style?: CSSStyleDeclaration }).style;
    if (this.classList.contains('easymde-math-inline')) {
      return {
        bottom: 122,
        height: 22,
        left: -100000,
        right: -99920,
        top: 100,
        width: 80,
      } as DOMRect;
    }
    if (
      'SPAN' === this.tagName
      && !this.classList.length
      && 'inline-block' === style?.display
      && '0px' === style?.width
    ) {
      return {
        bottom: 117,
        height: 0,
        left: -100000,
        right: -100000,
        top: 117,
        width: 0,
      } as DOMRect;
    }
    return {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    } as DOMRect;
  });
}

export function request(
  source: Element,
  kind: 'math' | 'mermaid' = 'mermaid',
  scale = 1,
  width = 20,
  height = 10,
  inlineParent?: Element,
  layoutMagnification?: number,
  mermaidCapture?: 'intrinsic-viewport' | 'responsive-viewport',
) {
  return {
    height,
    ...(inlineParent ? { inlineParent } : {}),
    kind,
    ...(layoutMagnification !== undefined ? { layoutMagnification } : {}),
    ...(mermaidCapture ? { mermaidCapture } : {}),
    maxPixels: 16_777_216,
    scale,
    signal: new AbortController().signal,
    source,
    width,
  } as const;
}

export function installWechatRasterizerTestHooks(): void {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    imageInstances.length = 0;
    imageEvents.length = 0;
    activeEventLog = null;
    if (styleSheetsDescriptor) {
      Object.defineProperty(document, 'styleSheets', styleSheetsDescriptor);
      styleSheetsDescriptor = undefined;
    } else {
      const target = document as unknown as { styleSheets?: unknown };
      delete target.styleSheets;
    }
    if (fontsDescriptor) {
      Object.defineProperty(document, 'fonts', fontsDescriptor);
      fontsDescriptor = undefined;
    } else {
      const target = document as unknown as { fonts?: unknown };
      delete target.fonts;
    }
    if (fontFaceDescriptor) {
      Object.defineProperty(window, 'FontFace', fontFaceDescriptor);
      fontFaceDescriptor = undefined;
    } else {
      const target = window as Window & { FontFace?: unknown };
      delete target.FontFace;
    }
    if (cryptoDescriptor) {
      Object.defineProperty(window, 'crypto', cryptoDescriptor);
      cryptoDescriptor = undefined;
    }
  });

  beforeEach(() => {
    cryptoDescriptor = Object.getOwnPropertyDescriptor(window, 'crypto');
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    fontFaceDescriptor = Object.getOwnPropertyDescriptor(window, 'FontFace');
    Object.defineProperty(window, 'FontFace', {
      configurable: true,
      value: FontFaceStub,
    });
  });
}
