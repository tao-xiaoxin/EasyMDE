import { WechatVisualRasterizationError } from '../../../contracts/ports/wechat-visual-rasterization-port';

import type { BrowserWechatVisualRasterizerRuntime } from './create-browser-wechat-visual-rasterizer';
import type { FontAsset, FontAssetScope } from './wechat-managed-fonts';

type FontCacheEntry = {
  asset: FontAsset | null;
  promise: Promise<FontAsset>;
  signal: AbortSignal;
};

export type FontCache = Map<string, FontCacheEntry>;

const FONT_FETCH_TIMEOUT_MS = 5_000;
const MAX_FONT_BYTES = 512 * 1024;
const MAX_FONT_CACHE_ENTRIES = 32;
const FONT_MIME_TYPES = new Set([
  'application/font-woff',
  'application/font-woff2',
  'application/octet-stream',
  'application/vnd.ms-opentype',
  'application/x-font-opentype',
  'application/x-font-ttf',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2'
]);

export function containsUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || 0x7f === code;
  });
}

function managedFontPath(scope: FontAssetScope, pathname: string): boolean {
  if (!pathname.startsWith(scope.rootPath)) return false;
  const relative = pathname.slice(scope.rootPath.length);
  if ('katex' === scope.kind) {
    return /^[A-Za-z0-9._-]+\.(?:woff2?|ttf|otf)$/i.test(relative);
  }
  return /^(?:inter|inter-variable|jetbrains-mono|lora)\/[A-Za-z0-9._-]+\.(?:woff2?|ttf|otf)$/i.test(relative);
}

export function localFontUrl(
  value: string,
  baseUrl: string,
  document: Document,
  scope: FontAssetScope,
): string | null {
  if (!value || containsUnsafeControl(value) || value.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(value, baseUrl || document.baseURI);
  } catch {
    return null;
  }
  const origin = document.location?.origin;
  if (
    !origin
    || 'null' === origin
    || url.origin !== origin
    || !['http:', 'https:'].includes(url.protocol)
    || !managedFontPath(scope, url.pathname)
  ) {
    return null;
  }
  return url.href;
}

function fontFetch(runtime: BrowserWechatVisualRasterizerRuntime):
  ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null {
  if (runtime.fetch) return runtime.fetch;
  const windowRef = runtime.document.defaultView;
  return windowRef && 'function' === typeof windowRef.fetch
    ? windowRef.fetch.bind(windowRef)
    : null;
}

function fontMimeType(url: string): string | null {
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  if ('woff2' === extension) return 'font/woff2';
  if ('woff' === extension) return 'font/woff';
  if ('ttf' === extension) return 'font/ttf';
  if ('otf' === extension) return 'font/otf';
  return null;
}

function asciiHeader(bytes: Uint8Array, length: number): string {
  return String.fromCharCode(...bytes.slice(0, length));
}

function validFontSignature(bytes: Uint8Array, url: string): boolean {
  if (bytes.byteLength < 4) return false;
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  const header = asciiHeader(bytes, 4);
  if ('woff2' === extension) return 'wOF2' === header;
  if ('woff' === extension) return 'wOFF' === header;
  if ('ttf' === extension) {
    return '\u0000\u0001\u0000\u0000' === header || 'true' === header || 'typ1' === header;
  }
  if ('otf' === extension) return 'OTTO' === header || '\u0000\u0001\u0000\u0000' === header;
  return false;
}

async function validateBrowserFont(
  dataUrl: string,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<void> {
  const FontFaceConstructor = runtime.document.defaultView?.FontFace ?? globalThis.FontFace;
  if ('function' !== typeof FontFaceConstructor) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  let face: FontFace;
  try {
    face = new FontFaceConstructor('EasyMDEEmbeddedFont', `url("${dataUrl}")`);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  let onAbort: (() => void) | null = null;
  let onTimeout: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const timedOut = new Promise<never>((_, reject) => {
    onTimeout = () => reject(new WechatVisualRasterizationError('wechat-png-font-failed'));
    if (timeoutSignal.aborted) {
      onTimeout();
      return;
    }
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  });
  try {
    await Promise.race([face.load(), cancelled, timedOut]);
  } catch (error: unknown) {
    if (error instanceof WechatVisualRasterizationError) throw error;
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (onTimeout) timeoutSignal.removeEventListener('abort', onTimeout);
  }
}

function base64Data(bytes: Uint8Array, document: Document): string {
  const encode = document.defaultView?.btoa ?? globalThis.btoa;
  if ('function' !== typeof encode) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  try {
    return encode(binary);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
}

async function readFontBody(
  response: Response,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body || 'function' !== typeof body.getReader) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let onAbort: (() => void) | null = null;
  let onTimeout: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const timedOut = new Promise<never>((_, reject) => {
    onTimeout = () => {
      void reader.cancel().catch(() => undefined);
      reject(new WechatVisualRasterizationError('wechat-png-font-failed'));
    };
    if (timeoutSignal.aborted) {
      onTimeout();
      return;
    }
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  });
  try {
    while (true) {
      if (signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      const result = await Promise.race([reader.read(), cancelled, timedOut]);
      if (result.done) break;
      const chunk = result.value;
      if (!chunk || !ArrayBuffer.isView(chunk)) {
        throw new WechatVisualRasterizationError('wechat-png-font-failed');
      }
      const bytes = chunk instanceof Uint8Array
        ? chunk
        : Uint8Array.from(chunk as unknown as ArrayLike<number>);
      total += bytes.byteLength;
      if (total > MAX_FONT_BYTES) {
        throw new WechatVisualRasterizationError('wechat-png-font-failed');
      }
      chunks.push(bytes);
    }
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
    }
    if (error instanceof WechatVisualRasterizationError) throw error;
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (onTimeout) timeoutSignal.removeEventListener('abort', onTimeout);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

async function fetchFontAsset(
  url: string,
  scope: FontAssetScope,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
): Promise<FontAsset> {
  const fetcher = fontFetch(runtime);
  if (!fetcher) throw new WechatVisualRasterizationError('wechat-png-font-failed');
  if (signal.aborted) {
    throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  }
  const controller = new AbortController();
  const timeoutController = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const request = Promise.resolve().then(() => fetcher(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: controller.signal,
  }));
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      timeoutController.abort();
      reject(new WechatVisualRasterizationError('wechat-png-font-failed'));
    }, FONT_FETCH_TIMEOUT_MS);
  });
  let onCancelled: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onCancelled = () => reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    if (signal.aborted) {
      onCancelled();
      return;
    }
    signal.addEventListener('abort', onCancelled, { once: true });
  });
  try {
    const response = await Promise.race([request, timeout, cancelled]);
    if (!response.ok) throw new WechatVisualRasterizationError('wechat-png-font-failed');
    const responseUrl = response.url || url;
    if (!localFontUrl(responseUrl, responseUrl, runtime.document, scope)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && (contentLength < 0 || contentLength > MAX_FONT_BYTES)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType && !FONT_MIME_TYPES.has(contentType)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const bytes = await readFontBody(response, signal, timeoutController.signal);
    const mimeType = fontMimeType(url);
    if (!mimeType || 0 === bytes.length || !validFontSignature(bytes, url)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const dataUrl = `data:${mimeType};base64,${base64Data(bytes, runtime.document)}`;
    await validateBrowserFont(dataUrl, runtime, signal, timeoutController.signal);
    return {
      dataUrl,
      size: bytes.byteLength,
    };
  } catch (error: unknown) {
    controller.abort();
    if (signal.aborted) {
      throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
    }
    if (error instanceof WechatVisualRasterizationError) throw error;
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (onCancelled) signal.removeEventListener('abort', onCancelled);
    if (null !== timer) clearTimeout(timer);
  }
}

export function cachedFontAsset(
  url: string,
  scope: FontAssetScope,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  cache: FontCache,
): Promise<FontAsset> {
  const existing = cache.get(url);
  if (existing?.asset) return Promise.resolve(existing.asset);
  if (existing?.signal === signal) return existing.promise;
  while (cache.size >= MAX_FONT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if ('string' !== typeof oldest) break;
    cache.delete(oldest);
  }
  const entry: FontCacheEntry = {
    asset: null,
    promise: Promise.resolve({ dataUrl: '', size: 0 }),
    signal,
  };
  const request = fetchFontAsset(url, scope, runtime, signal)
    .then((asset) => {
      entry.asset = asset;
      return asset;
    })
    .catch((error: unknown) => {
      if (cache.get(url) === entry) cache.delete(url);
      throw error;
    });
  entry.promise = request;
  cache.set(url, entry);
  return request;
}
