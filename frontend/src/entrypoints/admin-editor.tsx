import { createElement, createRoot } from '@wordpress/element';
import {
  EDITOR_STYLESHEET_SCOPE,
  type EditorStylesheetScopeLease
} from '../shared/css/editor-stylesheet-scope';

import { EditorRoot, type EditorRootProps } from '../app/editor/EditorRoot';
import { EditorRootErrorBoundary } from '../app/editor/EditorRootErrorBoundary';
import {
  parseEditorRootBootstrap,
  type EditorRootBootstrap
} from '../contracts/bootstrap/editor-root-bootstrap';
import type { WordPressApiFetch } from '../integrations/wordpress/preview/create-wordpress-preview-port';
import { createBrowserScrollSync } from '../integrations/browser/editor-layout/create-browser-scroll-sync';
import { createBrowserEditorImagePixels } from '../integrations/browser/image-copy/create-browser-editor-image-pixels';
import {
  createBrowserEditorBlockIndexWorker,
  type CreateBrowserEditorBlockIndexWorkerOptions
} from '../integrations/browser/editor-context-menu/create-browser-editor-block-index-worker';
import { createBrowserToolbarShortcuts } from '../integrations/browser/keyboard/create-browser-toolbar-shortcuts';
import { createBrowserLocalDraftStorage } from '../integrations/browser/local-drafts/browser-local-draft-storage';
import { createBrowserImmersivePreferencesPort } from '../integrations/browser/immersive-preferences/browser-immersive-preferences';
import { createBrowserImmersiveEnvironment } from '../integrations/browser/immersive/create-browser-immersive-environment';
import type {
  WechatClipboardPort,
  WechatClipboardResult
} from '../contracts/ports/wechat-clipboard-port';
import {
  WechatVisualRasterizationError,
  type WechatVisualRasterizationPort
} from '../contracts/ports/wechat-visual-rasterization-port';
import { createBrowserPreviewScroll } from '../integrations/browser/preview/create-browser-preview-scroll';
import type {
  BrowserWechatClipboardPort,
  BrowserWechatClipboardRuntime,
  PrestartedModernClipboardWrite
} from '../integrations/browser/wechat/create-browser-wechat-clipboard';
import { createBrowserWechatPngEncoder } from '../integrations/browser/wechat/create-browser-wechat-png-encoder';
import type { BrowserWechatVisualRasterizerRuntime } from '../integrations/browser/wechat/create-browser-wechat-visual-rasterizer';
import wechatPngEncoderWorkerUrl from '../integrations/browser/wechat/wechat-png-encoder.worker.ts?worker&url';
import { rememberPreviewWidthValue } from '../integrations/browser/wechat/wechat-preview-width-store';
import { createGeneratedContentExportSession } from '../features/generated-content-export/generated-content-export-session';
import {
  createBrowserPreviewEnhancementPort,
  createWindowPreviewEnhancementRuntime
} from '../integrations/preview-runtime/browser-preview-enhancement';
import { createWordPressAppearancePort } from '../integrations/wordpress/appearance/create-wordpress-appearance-port';
import { createWordPressFontControlsPort } from '../integrations/wordpress/appearance/create-wordpress-font-controls-port';
import { createWordPressImageUploadPort } from '../integrations/wordpress/media/wordpress-image-upload';
import { createWordPressRemoteImageImportPort } from '../integrations/wordpress/media/wordpress-remote-image-import';
import { createWordPressMediaFramePort } from '../integrations/wordpress/media/wordpress-media-frame';
import { createWordPressNativeSubmissionPort } from '../integrations/wordpress/native-form/wordpress-native-submission';
import { createWordPressNativePublishPort } from '../integrations/wordpress/native-form/create-wordpress-native-publish-port';
import { createWordPressPreviewPort } from '../integrations/wordpress/preview/create-wordpress-preview-port';
import { createWordPressRevisionPort } from '../integrations/wordpress/revisions/create-wordpress-revision-port';
import { createWordPressEditorSessionPort } from '../integrations/wordpress/session/create-wordpress-editor-session-port';
import { createWordPressImmersiveI18nPort } from '../integrations/wordpress/i18n/create-wordpress-immersive-i18n-port';
import {
  clipboardItem,
  collectAdminEditorDomFields,
  createAdminEditorClipboardPort,
  createExternalCommandExecutor,
  createNativePublisher,
  createRevisionRestorer,
  createSimplifiedFormattingParser,
  createWechatPngEncoderRuntime,
  currentPostId,
  localStorage,
  platform,
  requiredElement
} from './admin-editor-browser-adapters';
import {
  disposeStylesheetLeases,
  normalizeCleanupError,
  prepareInitialEditorStylesheets,
  runCleanupSteps,
  scopeBaseEditorStylesheet,
  startupFailureCode,
  type InitialStylesheetPreparation,
  type PreparedInitialStylesheets
} from './admin-editor-stylesheets';

type WordPressHooks = Readonly<{
  addAction: (
    hook: string,
    namespace: string,
    callback: (...args: ReadonlyArray<unknown>) => void
  ) => void;
  removeAction: (hook: string, namespace: string) => void;
}>;

type ApiFetchRuntime = WordPressApiFetch &
  Readonly<{
    nonceMiddleware?: { nonce?: unknown };
  }>;

type WordPressEditorRuntime = Readonly<{
  apiFetch: ApiFetchRuntime;
  hooks: WordPressHooks;
}>;

type WechatClipboardModule = Readonly<{
  createBrowserWechatClipboard: (
    runtime: BrowserWechatClipboardRuntime
  ) => BrowserWechatClipboardPort;
}>;

type WechatVisualRasterizerModule = Readonly<{
  createBrowserWechatVisualRasterizer: (
    runtime: BrowserWechatVisualRasterizerRuntime
  ) => WechatVisualRasterizationPort;
}>;

type AdminEditorBrowserRuntime = Readonly<{
  document: Document;
  failureMessage: string;
  loadWechatClipboard?: () => Promise<WechatClipboardModule>;
  loadWechatVisualRasterizer?: () => Promise<WechatVisualRasterizerModule>;
  onStartupFailure: (code: string) => void;
  window: Window;
  wordpress: WordPressEditorRuntime;
}>;

export type AdminEditorStartRuntime = Readonly<{
  bootstrap: unknown;
  document: Document;
  failureMessage: string;
  onStartupFailure: (code: string) => void;
  window: Window;
  wordpress: WordPressEditorRuntime;
}>;

function wechatBackgroundPreparationAbortError(): Error {
  const error = new Error('wechat-background-preparation-cancelled');
  error.name = 'AbortError';
  return error;
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  createAbortError: () => Error
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError());
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

const WECHAT_CLIPBOARD_CHUNK_LOAD_TIMEOUT_MS = 60_000;
const COLD_COPY_REFRESH_ONLY_ATTRIBUTES: readonly string[] = [
  'aria-busy',
  'data-easymde-preview-accepted',
  'data-easymde-preview-refreshing'
];

type ColdCopyFreshnessGuard = Readonly<{
  dispose: () => void;
  isCurrent: () => boolean;
  onStale: (listener: () => void) => () => void;
}>;

function snapshotColdCopyState(
  preview: HTMLElement
): Readonly<{ checkboxes: string; innerHtml: string; rootOuterHtml: string }> {
  const rootClone = preview.cloneNode(false) as HTMLElement;
  for (const attribute of COLD_COPY_REFRESH_ONLY_ATTRIBUTES) {
    rootClone.removeAttribute(attribute);
  }
  const checkboxes = Array.from(preview.querySelectorAll('input'))
    .map((input) => ((input as HTMLInputElement).checked ? '1' : '0'))
    .join(',');
  return {
    checkboxes,
    innerHtml: preview.innerHTML,
    rootOuterHtml: rootClone.outerHTML
  };
}

function createColdCopyFreshnessGuard(
  preview: HTMLElement
): ColdCopyFreshnessGuard {
  const MutationObserverConstructor =
    preview.ownerDocument.defaultView?.MutationObserver ??
    globalThis.MutationObserver;
  if ('function' !== typeof MutationObserverConstructor) {
    throw new Error('wechat-copy-freshness-observer-unavailable');
  }
  let disposed = false;
  let mutatedDuringChunkLoad = false;
  let staleListener: (() => void) | null = null;
  const markMutated = (): void => {
    if (mutatedDuringChunkLoad) return;
    mutatedDuringChunkLoad = true;
    const listener = staleListener;
    staleListener = null;
    listener?.();
  };
  const recordMutations = (records: readonly MutationRecord[]): void => {
    const hasMeaningful = records.some(
      (record) =>
        !(
          'attributes' === record.type &&
          record.target === preview &&
          'string' === typeof record.attributeName &&
          COLD_COPY_REFRESH_ONLY_ATTRIBUTES.includes(record.attributeName)
        )
    );
    if (hasMeaningful) markMutated();
  };
  const observer = new MutationObserverConstructor(recordMutations);
  let initial: ReturnType<typeof snapshotColdCopyState>;
  try {
    observer.observe(preview, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    initial = snapshotColdCopyState(preview);
    recordMutations(observer.takeRecords());
  } catch (error: unknown) {
    observer.disconnect();
    throw error;
  }
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      staleListener = null;
      observer.disconnect();
    },
    isCurrent(): boolean {
      if (!disposed) recordMutations(observer.takeRecords());
      if (mutatedDuringChunkLoad || !preview.isConnected) return false;
      const current = snapshotColdCopyState(preview);
      return (
        current.innerHtml === initial.innerHtml &&
        current.rootOuterHtml === initial.rootOuterHtml &&
        current.checkboxes === initial.checkboxes
      );
    },
    onStale(listener): () => void {
      if (mutatedDuringChunkLoad) {
        listener();
        return () => undefined;
      }
      if (disposed) return () => undefined;
      staleListener = listener;
      return () => {
        if (staleListener === listener) staleListener = null;
      };
    }
  };
}

function createLazyPortLoader<TModule, TPort>(
  loadModule: () => Promise<TModule>,
  createPort: (loaded: TModule) => TPort
): Readonly<{
  current: () => TPort | null;
  load: () => Promise<TPort>;
}> {
  let resolvedPort: TPort | null = null;
  let portPromise: Promise<TPort> | null = null;
  return {
    current: () => resolvedPort,
    load(): Promise<TPort> {
      if (resolvedPort) return Promise.resolve(resolvedPort);
      if (!portPromise) {
        let modulePromise: Promise<TModule>;
        try {
          modulePromise = loadModule();
        } catch (error: unknown) {
          return Promise.reject(error);
        }
        const pending = modulePromise
          .then((loaded) => {
            const port = createPort(loaded);
            resolvedPort = port;
            return port;
          })
          .catch((error: unknown) => {
            if (portPromise === pending) portPromise = null;
            throw error;
          });
        portPromise = pending;
      }
      return portPromise;
    }
  };
}

type ModernBrowserWechatClipboardRuntime = BrowserWechatClipboardRuntime &
  Readonly<{
    clipboardItem: NonNullable<BrowserWechatClipboardRuntime['clipboardItem']>;
    write: NonNullable<BrowserWechatClipboardRuntime['write']>;
  }>;

type ColdWechatChunkWaitResult =
  | Readonly<{ kind: 'loaded'; port: BrowserWechatClipboardPort }>
  | Readonly<{ kind: 'aborted' }>
  | Readonly<{ kind: 'stale' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'write-failed'; error: unknown }>
  | Readonly<{ kind: 'load-failed'; error: unknown }>;

function createPrestartedModernClipboardWrite(
  runtime: ModernBrowserWechatClipboardRuntime,
  options: Readonly<{
    coldFreshness: ColdCopyFreshnessGuard | null;
    deadlineMs: number;
  }>
): PrestartedModernClipboardWrite {
  let settled = false;
  let resolveHtml!: (blob: Blob) => void;
  let rejectHtml!: (error: unknown) => void;
  let resolveText!: (blob: Blob) => void;
  let rejectText!: (error: unknown) => void;
  const htmlBlob = new Promise<Blob>((resolve, reject) => {
    resolveHtml = resolve;
    rejectHtml = reject;
  });
  const textBlob = new Promise<Blob>((resolve, reject) => {
    resolveText = resolve;
    rejectText = reject;
  });
  void htmlBlob.catch(() => undefined);
  void textBlob.catch(() => undefined);

  const rejectBoth = (error: unknown): void => {
    if (settled) return;
    settled = true;
    rejectHtml(error);
    rejectText(error);
  };

  let writePromise: Promise<void>;
  try {
    const item = new runtime.clipboardItem({
      // Start the modern Clipboard write synchronously in the click task so
      // transient user activation survives a cold dynamic chunk import.
      'text/html': htmlBlob,
      'text/plain': textBlob
    });
    writePromise = Promise.resolve(runtime.write([item]));
  } catch (error: unknown) {
    rejectBoth(error);
    throw error;
  }
  void writePromise.catch(() => undefined);

  const coldFreshness = options.coldFreshness;
  return {
    bind(sourceHtmlBlob, sourceTextBlob): void {
      if (settled) {
        void sourceHtmlBlob.catch(() => undefined);
        void sourceTextBlob.catch(() => undefined);
        return;
      }
      settled = true;
      void sourceHtmlBlob.then(resolveHtml, rejectHtml);
      void sourceTextBlob.then(resolveText, rejectText);
    },
    deadlineMs: options.deadlineMs,
    ...(coldFreshness
      ? {
          disposeColdSourceFreshness: coldFreshness.dispose,
          isColdSourceFresh: coldFreshness.isCurrent
        }
      : {}),
    reject: rejectBoth,
    writePromise
  };
}

function waitForWechatClipboardChunk(
  portPromise: Promise<BrowserWechatClipboardPort>,
  writePromise: Promise<void>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  coldFreshness: ColdCopyFreshnessGuard | null
): Promise<ColdWechatChunkWaitResult> {
  if (signal?.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise<ColdWechatChunkWaitResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeStale: (() => void) | null = null;
    const onAbort = (): void => finish({ kind: 'aborted' });
    const finish = (result: ColdWechatChunkWaitResult): void => {
      if (settled) return;
      settled = true;
      if (null !== timer) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribeStale?.();
      unsubscribeStale = null;
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (coldFreshness) {
      unsubscribeStale = coldFreshness.onStale(() => finish({ kind: 'stale' }));
    }
    if (settled) return;
    timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    void portPromise.then(
      (port) => finish({ kind: 'loaded', port }),
      (error: unknown) => finish({ kind: 'load-failed', error })
    );
    void writePromise.then(
      () => undefined,
      (error: unknown) => finish({ kind: 'write-failed', error })
    );
  });
}

function createLazyBrowserWechatClipboard(
  runtime: BrowserWechatClipboardRuntime,
  isActive: () => boolean,
  loadWechatClipboard: () => Promise<WechatClipboardModule> = () =>
    import('../integrations/browser/wechat/create-browser-wechat-clipboard')
): WechatClipboardPort {
  const loader = createLazyPortLoader(
    loadWechatClipboard,
    ({ createBrowserWechatClipboard }) => createBrowserWechatClipboard(runtime)
  );

  return {
    rememberPreviewWidth(preview): void {
      if (!isActive()) return;
      rememberPreviewWidthValue(preview);
      loader.current()?.rememberPreviewWidth?.(preview);
    },
    releasePrepared(preview): void {
      loader.current()?.releasePrepared?.(preview);
    },
    prepare(preview, options = {}): Promise<void> {
      if (!isActive()) return Promise.resolve();
      if (options.signal?.aborted) {
        return Promise.reject(wechatBackgroundPreparationAbortError());
      }
      const resolvedPort = loader.current();
      if (resolvedPort) {
        return resolvedPort.prepare
          ? resolvedPort.prepare(preview, options)
          : Promise.resolve();
      }
      return raceWithAbort(
        loader.load(),
        options.signal,
        wechatBackgroundPreparationAbortError
      ).then((port) => {
        if (!isActive()) return undefined;
        if (options.signal?.aborted) {
          throw wechatBackgroundPreparationAbortError();
        }
        return port.prepare ? port.prepare(preview, options) : undefined;
      });
    },
    copy(preview, options = {}): Promise<WechatClipboardResult> {
      const png = true === options.pngConversionEnabled;
      const pngFailed = (
        code:
          | 'wechat-png-clipboard-failed'
          | 'wechat-png-rasterization-cancelled'
          | 'wechat-png-transaction-timeout'
      ): WechatClipboardResult => ({ code, sideEffects: 'none', status: 'failed' });
      const cancelled = (): WechatClipboardResult =>
        png ? pngFailed('wechat-png-rasterization-cancelled') : { code: 'wechat-copy-cancelled', status: 'cancelled' };
      const failure = (): WechatClipboardResult =>
        png ? pngFailed('wechat-png-clipboard-failed') : { code: 'wechat-copy-failed', status: 'failed' };
      const stale = (): WechatClipboardResult =>
        png ? pngFailed('wechat-png-rasterization-cancelled') : { code: 'wechat-copy-failed', status: 'failed' };
      const timeout = (): WechatClipboardResult =>
        png ? pngFailed('wechat-png-transaction-timeout') : { code: 'wechat-copy-failed', status: 'failed' };
      const timeoutError = (): Error =>
        new Error(png ? 'wechat-png-transaction-timeout' : 'wechat-clipboard-preparation-timeout');

      if (options.signal?.aborted) return Promise.resolve(cancelled());
      if (!isActive()) return Promise.resolve(failure());
      const resolvedPort = loader.current();
      if (resolvedPort) return resolvedPort.copy(preview, options);
      if (options.isCurrent && !options.isCurrent()) {
        return Promise.resolve(stale());
      }
      if (!runtime.write || !runtime.clipboardItem) {
        void loader.load().catch(() => undefined);
        return Promise.resolve(failure());
      }

      const deadlineMs = Date.now() + WECHAT_CLIPBOARD_CHUNK_LOAD_TIMEOUT_MS;
      const requiresPreviewResolution = Boolean(
        options.resolvePreview &&
          (preview.classList.contains('easymde-preview-surface-hidden') ||
            preview.querySelector('[data-easymde-preview-window-spacer]'))
      );

      let coldFreshness: ColdCopyFreshnessGuard | null = null;
      if (!requiresPreviewResolution) {
        try {
          coldFreshness = createColdCopyFreshnessGuard(preview);
        } catch {
          return Promise.resolve(failure());
        }
      }

      let prestartedWrite: PrestartedModernClipboardWrite;
      try {
        prestartedWrite = createPrestartedModernClipboardWrite(
          {
            ...runtime,
            clipboardItem: runtime.clipboardItem,
            write: runtime.write
          },
          { coldFreshness, deadlineMs }
        );
      } catch {
        coldFreshness?.dispose();
        return Promise.resolve(failure());
      }

      const abortPrestarted = (
        error: unknown,
        result: WechatClipboardResult
      ): WechatClipboardResult => {
        coldFreshness?.dispose();
        prestartedWrite.reject(error);
        return result;
      };

      return waitForWechatClipboardChunk(
        loader.load(),
        prestartedWrite.writePromise,
        options.signal,
        Math.max(0, deadlineMs - Date.now()),
        coldFreshness
      ).then((outcome) => {
        if ('aborted' === outcome.kind || options.signal?.aborted) {
          return abortPrestarted(new Error('wechat-copy-cancelled'), cancelled());
        }
        if ('stale' === outcome.kind) {
          return abortPrestarted(new Error('wechat-copy-stale'), stale());
        }
        if ('timeout' === outcome.kind) {
          return abortPrestarted(timeoutError(), timeout());
        }
        if ('loaded' !== outcome.kind) {
          return abortPrestarted(outcome.error, failure());
        }
        if (!isActive()) {
          return abortPrestarted(new Error('wechat-copy-failed'), failure());
        }
        if (options.isCurrent && !options.isCurrent()) {
          return abortPrestarted(new Error('wechat-copy-cancelled'), stale());
        }
        if (coldFreshness && !coldFreshness.isCurrent()) {
          return abortPrestarted(new Error('wechat-copy-stale'), stale());
        }
        if (Date.now() >= deadlineMs) {
          return abortPrestarted(timeoutError(), timeout());
        }
        const port = outcome.port;
        if ('function' !== typeof port.copyWithPrestartedWrite) {
          return abortPrestarted(
            new Error('wechat-copy-prestarted-write-unsupported'),
            failure()
          );
        }
        try {
          return port
            .copyWithPrestartedWrite(preview, options, prestartedWrite)
            .finally(() => coldFreshness?.dispose());
        } catch (error: unknown) {
          return abortPrestarted(error, failure());
        }
      });
    }
  };
}

function createLazyBrowserWechatVisualRasterizer(
  runtime: BrowserWechatVisualRasterizerRuntime,
  isActive: () => boolean,
  loadWechatVisualRasterizer: () => Promise<WechatVisualRasterizerModule> = () =>
    import(
      '../integrations/browser/wechat/create-browser-wechat-visual-rasterizer'
    )
): WechatVisualRasterizationPort {
  const loader = createLazyPortLoader(
    loadWechatVisualRasterizer,
    ({ createBrowserWechatVisualRasterizer }) =>
      createBrowserWechatVisualRasterizer(runtime)
  );
  const cancelledError = (): Error =>
    new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');

  return {
    rasterize(request) {
      if (!isActive() || request.signal.aborted) {
        return Promise.reject(cancelledError());
      }
      const resolvedPort = loader.current();
      if (resolvedPort) return resolvedPort.rasterize(request);
      return raceWithAbort(loader.load(), request.signal, cancelledError).then(
        (port) => {
          if (!isActive() || request.signal.aborted) throw cancelledError();
          return port.rasterize(request);
        },
        (error: unknown) => {
          if (error instanceof WechatVisualRasterizationError) throw error;
          throw new WechatVisualRasterizationError(
            'wechat-png-rasterization-unavailable'
          );
        }
      );
    }
  };
}

export function mountAdminEditor(
  value: unknown,
  runtime: AdminEditorBrowserRuntime
): () => void {
  const bootstrap = parseEditorRootBootstrap(value);
  const documentRef = runtime.document;
  const rootElement = requiredElement(
    documentRef,
    '#easymde-editor-root',
    (element): element is HTMLElement => element instanceof HTMLElement,
    'react-editor-root-unavailable'
  );
  if (rootElement.childNodes.length)
    throw new Error('react-editor-root-not-empty');

  let preparation: InitialStylesheetPreparation;
  try {
    preparation = prepareInitialEditorStylesheets(bootstrap, documentRef);
  } catch (error) {
    runtime.onStartupFailure(startupFailureCode(error));
    return () => undefined;
  }
  let active = true;
  let innerTeardown: (() => void) | null = null;
  let unsubscribe: () => void = () => undefined;
  const handleError = (error: Error): void => {
    if (!active) return;
    active = false;
    const cleanupFailure = runCleanupSteps([
      () => unsubscribe(),
      () => preparation.cancel(),
      () => {
        const teardown = innerTeardown;
        innerTeardown = null;
        teardown?.();
      }
    ]);
    runtime.onStartupFailure(startupFailureCode(cleanupFailure ?? error));
  };
  try {
    unsubscribe = preparation.run(
      (prepared) => {
        if (!active) return;
        innerTeardown = mountPreparedAdminEditor(
          bootstrap,
          runtime,
          prepared,
          rootElement
        );
      },
      handleError
    );
  } catch (error) {
    handleError(
      error instanceof Error
        ? error
        : new Error('react-editor-startup-failed')
    );
  }
  return () => {
    if (!active) return;
    active = false;
    const cleanupFailure = runCleanupSteps([
      () => unsubscribe(),
      () => preparation.cancel(),
      () => {
        const teardown = innerTeardown;
        innerTeardown = null;
        teardown?.();
      }
    ]);
    if (cleanupFailure) throw cleanupFailure;
  };
}

function mountPreparedAdminEditor(
  bootstrap: EditorRootBootstrap,
  runtime: AdminEditorBrowserRuntime,
  prepared: PreparedInitialStylesheets,
  rootElement: HTMLElement
): () => void {
  const documentRef = runtime.document;
  const windowRef = runtime.window;

  const baseStylesheetLeases: EditorStylesheetScopeLease[] = [];
  let root: ReturnType<typeof createRoot> | null = null;
  let mediaPickerFrame: ReturnType<typeof createWordPressMediaFramePort> | null = null;
  let enhancementPort: ReturnType<typeof createBrowserPreviewEnhancementPort> | null = null;
  let appearancePort: ReturnType<typeof createWordPressAppearancePort> | null = null;
  let editorBlockIndexPort: ReturnType<typeof createBrowserEditorBlockIndexWorker> | null = null;
  let editorClipboardPort: ReturnType<typeof createAdminEditorClipboardPort> | null = null;
  let editorImagePixelsPort: ReturnType<typeof createBrowserEditorImagePixels> | null = null;
  let appearanceDisposed = false;
  let appearanceDisposeFailure: Error | null = null;
  let nativeEditor: HTMLElement | null = null;
  const disposeAppearancePort = (): void => {
    if (appearanceDisposed) {
      if (appearanceDisposeFailure) throw appearanceDisposeFailure;
      return;
    }
    appearanceDisposed = true;
    try {
      appearancePort?.dispose();
    } catch (error) {
      appearanceDisposeFailure = normalizeCleanupError(error);
      throw appearanceDisposeFailure;
    }
  };
  try {
    baseStylesheetLeases.push(scopeBaseEditorStylesheet(documentRef));

    const domFields = collectAdminEditorDomFields(documentRef);
    const {
      appearanceFields,
      enabledField,
      fontFields,
      form,
      nativeContentField,
      submissionField,
      titleField
    } = domFields;
    nativeEditor = domFields.nativeEditor;

    const postId = currentPostId(documentRef, bootstrap.preview.postId);
    const draftStorage = createBrowserLocalDraftStorage({
      config: { ...bootstrap.localDrafts, postId },
      eventTarget: windowRef,
      now: () => Date.now(),
      storage: localStorage(windowRef)
    });
    root = createRoot(rootElement);
    let active = true;
    const onFailure = (code: string, level: 'error' | 'info' = 'error') => {
      const log = 'info' === level ? console.info : console.error;
      log(`[EasyMDE] ${code}`);
    };
    enhancementPort = createBrowserPreviewEnhancementPort(
      bootstrap.previewEnhancement,
      {
        documentRef,
        editorRootSelector: EDITOR_STYLESHEET_SCOPE,
        runtime: createWindowPreviewEnhancementRuntime(windowRef)
      }
    );
    const apiFetch = runtime.wordpress.apiFetch;
    mediaPickerFrame = bootstrap.mediaPicker.canUseMedia
      ? createWordPressMediaFramePort({
          frameUrl: bootstrap.mediaPicker.frameUrl,
          window: windowRef
        })
      : null;
    const pngEncoderRuntime = createWechatPngEncoderRuntime(
      windowRef,
      wechatPngEncoderWorkerUrl
    );
    if (!enhancementPort) {
      throw new Error('react-editor-enhancement-port-unavailable');
    }
    appearancePort = createWordPressAppearancePort({
      apiFetch,
      assetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
      bootstrap: bootstrap.appearance,
      customCssUrl: bootstrap.wordpress.customCssUrl,
      document: documentRef,
      editorRootSelector: EDITOR_STYLESHEET_SCOPE,
      fields: appearanceFields,
      nonce: bootstrap.wordpress.nonce,
      siteUrl: windowRef.location.href
    });
    const guardedAppearancePort = {
      ...appearancePort,
      dispose: disposeAppearancePort
    };
    editorClipboardPort = createAdminEditorClipboardPort(windowRef);
    editorImagePixelsPort = createBrowserEditorImagePixels({
      clearTimeout: (handle) => windowRef.clearTimeout(handle as number),
      document: documentRef,
      setTimeout: (callback, delayMs) => windowRef.setTimeout(callback, delayMs)
    });
    const browserWorker = (windowRef as Window & { Worker?: unknown }).Worker;
    editorBlockIndexPort = createBrowserEditorBlockIndexWorker({
      assetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
      referenceLabelCaseFoldProfile: bootstrap.referenceLabelCaseFoldProfile,
      location: {
        href: windowRef.location.href,
        origin: windowRef.location.origin
      },
      ...(typeof browserWorker === 'function'
        ? {
            Worker: browserWorker as NonNullable<
              CreateBrowserEditorBlockIndexWorkerOptions['Worker']
            >
          }
        : {}),
      workerUrl: bootstrap.editorBlockIndexWorkerUrl
    });
    const pngEncodingPort = createBrowserWechatPngEncoder(pngEncoderRuntime);
    const wechatVisualRasterizer = createLazyBrowserWechatVisualRasterizer(
      {
        approvedAssetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
        approvedKaTeXCssUrl: bootstrap.previewEnhancement.assets.katexCssUrl,
        blob: Blob,
        document: documentRef,
        file: File,
        image: Image,
        pngEncodingPort,
        xmlSerializer: XMLSerializer
      },
      () => active,
      runtime.loadWechatVisualRasterizer
    );
    const generatedContentExportSession = createGeneratedContentExportSession({
      clipboard: editorClipboardPort,
      rasterizer: wechatVisualRasterizer
    });
    const props: EditorRootProps = {
      appearance: bootstrap.appearance,
      appearancePort: guardedAppearancePort,
      document: bootstrap.document,
      referenceLabelCaseFoldProfile: bootstrap.referenceLabelCaseFoldProfile,
      contextMenuStrings: bootstrap.contextMenuStrings,
      editorBlockIndexPort,
      editorClipboardPort,
      editorImagePixelsPort,
      enhancementPort,
      executeExternalCommand: createExternalCommandExecutor(
        bootstrap,
        documentRef
      ),
      fontControlsPort: createWordPressFontControlsPort(fontFields),
      fonts: bootstrap.fonts,
      generatedContentExportSession,
      imageUpload: { ...bootstrap.imageUpload, postId },
      imageUploadPort: createWordPressImageUploadPort({
        actionNonce: bootstrap.imageUpload.actionNonce,
        apiFetch,
        endpoint: bootstrap.imageUpload.endpoint,
        formData: FormData,
        nonce: bootstrap.imageUpload.nonce,
        siteUrl: windowRef.location.href,
        uploadOwner: bootstrap.imageUpload.uploadOwner
      }),
      remoteImageImportPort: createWordPressRemoteImageImportPort({
        actionNonce: bootstrap.imageUpload.actionNonce,
        apiFetch,
        endpoint: bootstrap.imageUpload.importEndpoint,
        nonce: bootstrap.imageUpload.nonce,
        siteUrl: windowRef.location.href
      }),
      isNewPost: bootstrap.wordpress.isNewPost,
      immersiveEnvironment: createBrowserImmersiveEnvironment(
        documentRef,
        new URL(
          'assets/images/easymde-editor-icon.png',
          bootstrap.previewEnhancement.assetBaseUrl
        ).toString()
      ),
      immersiveI18n: createWordPressImmersiveI18nPort({
        locale: bootstrap.localDrafts.locale
      }),
      immersivePreferencesPort: createBrowserImmersivePreferencesPort({
        siteKey: bootstrap.localDrafts.siteKey,
        storage: localStorage(windowRef),
        userId: bootstrap.localDrafts.userId
      }),
      immersiveStrings: bootstrap.immersiveStrings,
      layout: bootstrap.layout,
      localDrafts: {
        ...bootstrap.localDrafts,
        savedFingerprint: draftStorage.fingerprint(submissionField.value)
      },
      localDraftStorage: draftStorage,
      labels: {
        preview: bootstrap.labels.preview,
        source: bootstrap.labels.source,
        toolbar: bootstrap.labels.toolbar
      },
      mediaPicker: bootstrap.mediaPicker,
      mediaPickerFailureMessage: bootstrap.labels.mediaPickerFailure,
      mediaPickerFrame,
      nativePublishPort: createWordPressNativePublishPort(
        documentRef,
        bootstrap.wordpress.publishCategories
      ),
      nativeSubmissionPort: createWordPressNativeSubmissionPort(form),
      onDocumentOwnerChange: (owned) => {
        nativeEditor?.classList.toggle('easymde-native-editor-hidden', owned);
      },
      onFailure,
      platform: platform(windowRef),
      publishPost: createNativePublisher(documentRef),
      prepareToolbarShortcuts: ({ editorRoot, isOwnedTarget, source }) =>
        createBrowserToolbarShortcuts({
          commands: bootstrap.toolbar.commands,
          editorRoot,
          eventTarget: documentRef,
          ...(isOwnedTarget ? { isOwnedTarget } : {}),
          platform: platform(windowRef),
          shortcuts: bootstrap.toolbar.shortcuts,
          source
        }),
      preview: { ...bootstrap.preview, postId },
      previewPort: createWordPressPreviewPort(
        apiFetch,
        bootstrap.wordpress.previewUrl,
        bootstrap.wordpress.nonce,
        windowRef.location.href
      ),
      revisionPort:
        postId > 0
          ? createWordPressRevisionPort({
              apiFetch,
              baseUrl: bootstrap.wordpress.revisionsUrl,
              nonce: bootstrap.wordpress.nonce,
              postId,
              siteUrl: windowRef.location.href
            })
          : null,
      restoreRevision: createRevisionRestorer(windowRef),
      scrollPort: createBrowserPreviewScroll(),
      scrollSyncPort: createBrowserScrollSync(windowRef),
      sessionPort: createWordPressEditorSessionPort({
        apiFetch,
        autosaveFields: {
          ...appearanceFields,
          ...fontFields,
          content: nativeContentField,
          enabled: enabledField,
          markdown: submissionField
        },
        document: documentRef,
        hooks: runtime.wordpress.hooks,
        namespace: 'easymde/editor-root'
      }),
      settings: bootstrap.settings,
      submissionField,
      titleField,
      toolbar: bootstrap.toolbar,
      wechatClipboard: createLazyBrowserWechatClipboard(
        {
          approvedAssetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
          approvedKaTeXCssUrl: bootstrap.previewEnhancement.assets.katexCssUrl,
          blob: Blob,
          clipboardItem: clipboardItem(windowRef),
          document: documentRef,
          fetch: (input, init) => windowRef.fetch(input, init),
          getComputedStyle: (element, pseudoElement) =>
            windowRef.getComputedStyle(element, pseudoElement),
          getSelection: () => windowRef.getSelection(),
          pageOffset: () => ({ x: windowRef.scrollX, y: windowRef.scrollY }),
          scrollTo: (x, y) => windowRef.scrollTo(x, y),
          wechatMathAtlasContentVersion:
            bootstrap.wechatExport.wechatMathAtlasContentVersion,
          wechatMathAtlasUrl: bootstrap.wechatExport.wechatMathAtlasUrl,
          write: windowRef.navigator.clipboard?.write
            ? (items) =>
                windowRef.navigator.clipboard.write(items as ClipboardItems)
            : null
        },
        () => active,
        runtime.loadWechatClipboard
      ),
      wechatExport: bootstrap.wechatExport,
      wechatVisualRasterizationPort: wechatVisualRasterizer,
      simplifiedFormattingParser: createSimplifiedFormattingParser(windowRef)
    };

    if (!root) throw new Error('react-editor-root-unavailable');
    root.render(
      <EditorRootErrorBoundary
        failureMessage={runtime.failureMessage}
        onFailure={onFailure}
      >
        <EditorRoot {...props} />
      </EditorRootErrorBoundary>
    );
    prepared.commit();

    return () => {
      if (!active) return;
      active = false;
      const cleanupFailure = runCleanupSteps([
        () => mediaPickerFrame?.dispose?.(),
        () => root?.unmount(),
        () => editorBlockIndexPort?.dispose(),
        () => editorClipboardPort?.dispose(),
        () => editorImagePixelsPort?.dispose(),
        () => disposeAppearancePort(),
        () => enhancementPort?.dispose?.(),
        () => prepared.release(),
        () => {
          const leaseFailure = disposeStylesheetLeases(baseStylesheetLeases);
          if (leaseFailure) throw leaseFailure;
        },
        () => nativeEditor?.classList.remove('easymde-native-editor-hidden')
      ]);
      if (cleanupFailure) throw cleanupFailure;
    };
  } catch (error) {
    const cleanupFailure = runCleanupSteps([
      () => root?.unmount(),
      () => editorBlockIndexPort?.dispose(),
      () => editorClipboardPort?.dispose(),
      () => editorImagePixelsPort?.dispose(),
      () => disposeAppearancePort(),
      () => mediaPickerFrame?.dispose?.(),
      () => enhancementPort?.dispose?.(),
      () => {
        const leaseFailure = disposeStylesheetLeases(baseStylesheetLeases);
        if (leaseFailure) throw leaseFailure;
      },
      () => nativeEditor?.classList.remove('easymde-native-editor-hidden'),
      () => prepared.rollback()
    ]);
    throw cleanupFailure ?? error;
  }
}

declare global {
  interface Window {
    EasyMDEAdminEditorStart?: (runtime: AdminEditorStartRuntime) => () => void;
    EasyMDEEditorRootBootstrap?: unknown;
  }
}

export function startAdminEditor(runtime: AdminEditorStartRuntime): () => void {
  if (!runtime.wordpress.apiFetch || !runtime.wordpress.hooks) {
    runtime.onStartupFailure('react-editor-wordpress-runtime-unavailable');
    return () => undefined;
  }

  return mountAdminEditor(runtime.bootstrap, {
    document: runtime.document,
    failureMessage: runtime.failureMessage,
    onStartupFailure: runtime.onStartupFailure,
    window: runtime.window,
    wordpress: runtime.wordpress
  });
}

if (import.meta.env.MODE !== 'test') {
  window.EasyMDEAdminEditorStart = startAdminEditor;
}
