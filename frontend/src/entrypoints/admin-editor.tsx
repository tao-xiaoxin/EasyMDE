import { createElement, createRoot } from '@wordpress/element';
import {
  createEditorStylesheetReadiness,
  EDITOR_STYLESHEET_SCOPE,
  scopeEditorStyleElement,
  scopeEditorStylesheet,
  scopeEditorStylesheetLink,
  type EditorStylesheetElement,
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
import { createBrowserEditorClipboard } from '../integrations/browser/clipboard/create-browser-editor-clipboard';
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
  BrowserWechatClipboardRuntime,
  ClipboardItemConstructor
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
import {
  createWordPressAppearancePort,
  resolveAppearanceArticleThemeUrl
} from '../integrations/wordpress/appearance/create-wordpress-appearance-port';
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

type AdminEditorBrowserRuntime = Readonly<{
  document: Document;
  failureMessage: string;
  onStartupFailure: (code: string) => void;
  window: Window;
  wordpress: WordPressEditorRuntime;
}>;

type DeferredClipboardItemConstructor = new (
  payload: Record<string, Blob | PromiseLike<Blob>>
) => unknown;

type ClipboardItemConstructorWithSupport = DeferredClipboardItemConstructor & {
  supports?: (type: string) => boolean;
};

export type AdminEditorStartRuntime = Readonly<{
  bootstrap: unknown;
  document: Document;
  failureMessage: string;
  onStartupFailure: (code: string) => void;
  window: Window;
  wordpress: WordPressEditorRuntime;
}>;

function requiredElement<T extends Element>(
  documentRef: Document,
  selector: string,
  guard: (element: Element) => element is T,
  code: string
): T {
  const element = documentRef.querySelector(selector);
  if (!element || !guard(element)) throw new Error(code);
  return element;
}

function currentPostId(documentRef: Document, fallback: number): number {
  const value = Number(
    documentRef.querySelector<HTMLInputElement>('#post_ID')?.value
  );
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function platform(windowRef: Window): 'mac' | 'win' {
  return /Mac|iPhone|iPad|iPod/i.test(windowRef.navigator.platform)
    ? 'mac'
    : 'win';
}

function createExternalCommandExecutor(
  bootstrap: EditorRootBootstrap,
  documentRef: Document
): EditorRootProps['executeExternalCommand'] {
  return (commandId) => {
    const command = bootstrap.toolbar.commands.find(
      ({ id }) => id === commandId
    );
    if ('savePost' !== command?.action) return false;
    const candidate =
      documentRef.querySelector<HTMLElement>('#save-post') ??
      documentRef.querySelector<HTMLElement>('#publish');
    if (!candidate || candidate.matches(':disabled, [aria-disabled="true"]'))
      return false;
    candidate.click();
    return true;
  };
}

function createNativePublisher(
  documentRef: Document
): EditorRootProps['publishPost'] {
  const completed = (event: Event | null): boolean =>
    null !== event && !event.defaultPrevented;

  return () => {
    const candidate = documentRef.querySelector<HTMLElement>('#publish');
    if (!candidate || candidate.matches(':disabled, [aria-disabled="true"]'))
      return false;
    const form = candidate.closest('form');
    if (!(form instanceof HTMLFormElement)) return false;

    let clickEvent: MouseEvent | null = null;
    let submitEvent: SubmitEvent | null = null;
    const captureClick = (event: MouseEvent) => {
      clickEvent = event;
    };
    const captureSubmit = (event: SubmitEvent) => {
      submitEvent = event;
    };
    candidate.addEventListener('click', captureClick, { once: true });
    form.addEventListener('submit', captureSubmit, { once: true });
    try {
      candidate.click();
    } finally {
      candidate.removeEventListener('click', captureClick);
      form.removeEventListener('submit', captureSubmit);
    }
    return completed(clickEvent) && completed(submitEvent);
  };
}

function clipboardItem(windowRef: Window): ClipboardItemConstructor | null {
  const value = (windowRef as Window & { ClipboardItem?: unknown })
    .ClipboardItem;
  return 'function' === typeof value
    ? (value as ClipboardItemConstructor)
    : null;
}

function localStorage(windowRef: Window): Storage | null {
  try {
    return windowRef.localStorage;
  } catch {
    return null;
  }
}

type PreparedInitialStylesheets = {
  provisional: () => void;
  commit: () => void;
  release: () => void;
  rollback: () => void;
};

type InitialStylesheetPreparation = Readonly<{
  cancel: () => void;
  run: (
    onReady: (prepared: PreparedInitialStylesheets) => void,
    onError: (error: Error) => void
  ) => () => void;
}>;

function startupFailureCode(error: unknown): string {
  return error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
    ? error.message
    : 'react-editor-startup-failed';
}

function normalizeCleanupError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('react-editor-startup-rollback-failed');
}

function runCleanupSteps(
  steps: ReadonlyArray<() => void>
): Error | null {
  let failure: Error | null = null;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failure ??= normalizeCleanupError(error);
    }
  }
  return failure;
}

function disposeStylesheetLeases(
  leases: ReadonlyArray<EditorStylesheetScopeLease>
): Error | null {
  let failure: Error | null = null;
  for (const lease of [...leases].reverse()) {
    try {
      lease.dispose();
    } catch (error) {
      failure ??= error instanceof Error
        ? error
        : new Error('editor-stylesheet-rollback-failed');
    }
  }
  return failure;
}

function editorStylesheetElement(
  value: Element | null,
  code: string
): EditorStylesheetElement {
  if (
    value instanceof HTMLLinkElement
    || value instanceof HTMLStyleElement
  ) return value;
  throw new Error(code);
}

function prepareInitialEditorStylesheets(
  bootstrap: EditorRootBootstrap,
  documentRef: Document
): InitialStylesheetPreparation {
  const base = editorStylesheetElement(
    documentRef.getElementById('easymde-content-css'),
    'editor-content-stylesheet-unavailable'
  );
  const article = requiredElement(
    documentRef,
    '#easymde-article-theme-css',
    (element): element is HTMLLinkElement => element instanceof HTMLLinkElement,
    'appearance-article-theme-link-unavailable'
  );
  const targetUrl = resolveAppearanceArticleThemeUrl(
    bootstrap.appearance,
    bootstrap.previewEnhancement.assetBaseUrl
  );
  const candidate = article.href === targetUrl
    ? null
    : article.cloneNode(false) as HTMLLinkElement;
  const originalId = article.id;
  const activeMedia = article.media;
  if (candidate) {
    candidate.removeAttribute('id');
    candidate.media = 'not all';
    candidate.href = targetUrl;
    article.after(candidate);
  }
  const owner = candidate ?? article;
  const gate = createEditorStylesheetReadiness([base, owner]);
  let candidateLease: EditorStylesheetScopeLease | null = null;
  let prepared: PreparedInitialStylesheets | null = null;
  let transferred = false;
  let cancelled = false;

  const disposeCandidateLease = (): void => {
    const lease = candidateLease;
    candidateLease = null;
    lease?.dispose();
  };

  const cleanupUnprepared = (): Error | null =>
    runCleanupSteps([
      disposeCandidateLease,
      () => candidate?.remove(),
      () => {
        article.id = originalId;
        article.media = activeMedia;
      }
    ]);

  const createPrepared = (): PreparedInitialStylesheets => {
    let phase: 'pending' | 'provisional' | 'committed' | 'closed' = 'pending';
    return {
      provisional: () => {
        if ('closed' === phase) return;
        if ('provisional' === phase || 'committed' === phase) return;
        try {
          if (candidate) {
            article.removeAttribute('id');
            candidate.id = originalId;
            candidate.media = activeMedia;
          }
          phase = 'provisional';
        } catch (error) {
          article.id = originalId;
          article.media = activeMedia;
          throw error;
        }
      },
      commit: () => {
        if ('closed' === phase || 'committed' === phase) return;
        if ('pending' === phase) {
          throw new Error('editor-stylesheet-provisional-required');
        }
        if (candidate) article.remove();
        phase = 'committed';
      },
      release: () => {
        if ('closed' === phase) return;
        if ('committed' !== phase) {
          throw new Error('editor-stylesheet-release-before-commit');
        }
        phase = 'closed';
        disposeCandidateLease();
      },
      rollback: () => {
        if ('closed' === phase) return;
        if ('committed' === phase) {
          phase = 'closed';
          disposeCandidateLease();
          return;
        }
        const failure = runCleanupSteps([
          disposeCandidateLease,
          () => candidate?.remove(),
          () => {
            article.id = originalId;
            article.media = activeMedia;
          }
        ]);
        phase = 'closed';
        if (failure) throw failure;
      }
    };
  };

  const rollbackPreparation = (): Error | null => {
    if (prepared) {
      try {
        if (transferred) prepared.release();
        else prepared.rollback();
      } catch (error) {
        return normalizeCleanupError(error);
      }
      return null;
    }
    return cleanupUnprepared();
  };

  const fail = (error: Error, onError: (error: Error) => void): void => {
    if (cancelled) return;
    cancelled = true;
    const cleanupFailure = rollbackPreparation();
    try {
      gate.cancel();
    } catch (cancelError) {
      onError(normalizeCleanupError(cancelError));
      return;
    }
    onError(cleanupFailure ?? error);
  };
  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      const cleanupFailure = rollbackPreparation();
      try {
        gate.cancel();
      } catch (error) {
        throw normalizeCleanupError(error);
      }
      if (cleanupFailure) throw cleanupFailure;
    },
    run: (onReady, onError) => gate.run((sheets) => {
      if (cancelled) return;
      try {
        if (candidate) {
          const sheet = sheets.get(candidate);
          if (!sheet) throw new Error('editor-article-stylesheet-unavailable');
          candidateLease = scopeEditorStylesheet(sheet, {
            rootSelector: EDITOR_STYLESHEET_SCOPE
          });
        }
        prepared = createPrepared();
        prepared.provisional();
        onReady(prepared);
        transferred = true;
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error('editor-stylesheet-startup-failed'),
          onError
        );
      }
    }, (error) => {
      if (cancelled) return;
      fail(error, onError);
    })
  };
}

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

function createLazyBrowserWechatClipboard(
  runtime: BrowserWechatClipboardRuntime,
  isActive: () => boolean
): WechatClipboardPort {
  let resolvedPort: WechatClipboardPort | null = null;
  let portPromise: Promise<WechatClipboardPort> | null = null;
  const loadPort = (): Promise<WechatClipboardPort> => {
    if (resolvedPort) return Promise.resolve(resolvedPort);
    if (!portPromise) {
      portPromise = import(
        '../integrations/browser/wechat/create-browser-wechat-clipboard'
      ).then(
        ({ createBrowserWechatClipboard }) => {
          const port = createBrowserWechatClipboard(runtime);
          resolvedPort = port;
          return port;
        },
        (error: unknown) => {
          portPromise = null;
          throw error;
        }
      );
    }
    return portPromise;
  };

  return {
    rememberPreviewWidth(preview): void {
      if (!isActive()) return;
      rememberPreviewWidthValue(preview);
      resolvedPort?.rememberPreviewWidth?.(preview);
    },
    releasePrepared(preview): void {
      resolvedPort?.releasePrepared?.(preview);
    },
    prepare(preview, options = {}): Promise<void> {
      if (!isActive()) return Promise.resolve();
      if (options.signal?.aborted) {
        return Promise.reject(wechatBackgroundPreparationAbortError());
      }
      if (resolvedPort) {
        return resolvedPort.prepare
          ? resolvedPort.prepare(preview, options)
          : Promise.resolve();
      }
      return raceWithAbort(
        loadPort(),
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
      const failure = (): WechatClipboardResult =>
        true === options.pngConversionEnabled
          ? {
              code: 'wechat-png-clipboard-failed',
              sideEffects: 'none',
              status: 'failed'
            }
          : { code: 'wechat-copy-failed', status: 'failed' };
      if (!isActive() || options.signal?.aborted) {
        return Promise.resolve(failure());
      }
      if (resolvedPort) {
        return resolvedPort.copy(preview, options);
      }
      return loadPort().then(
        (port) => {
          if (!isActive() || options.signal?.aborted) {
            return failure();
          }
          return port.copy(preview, options);
        },
        () => failure()
      );
    }
  };
}

function createLazyBrowserWechatVisualRasterizer(
  runtime: BrowserWechatVisualRasterizerRuntime,
  isActive: () => boolean
): WechatVisualRasterizationPort {
  let resolvedPort: WechatVisualRasterizationPort | null = null;
  let portPromise: Promise<WechatVisualRasterizationPort> | null = null;
  const cancelledError = (): Error =>
    new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  const loadPort = (): Promise<WechatVisualRasterizationPort> => {
    if (resolvedPort) return Promise.resolve(resolvedPort);
    if (!portPromise) {
      portPromise = import(
        '../integrations/browser/wechat/create-browser-wechat-visual-rasterizer'
      ).then(
        ({ createBrowserWechatVisualRasterizer }) => {
          const port = createBrowserWechatVisualRasterizer(runtime);
          resolvedPort = port;
          return port;
        },
        (error: unknown) => {
          portPromise = null;
          throw error;
        }
      );
    }
    return portPromise;
  };

  return {
    rasterize(request) {
      if (!isActive() || request.signal.aborted) {
        return Promise.reject(cancelledError());
      }
      if (resolvedPort) {
        return resolvedPort.rasterize(request);
      }
      return raceWithAbort(loadPort(), request.signal, cancelledError).then(
        (port) => {
          if (!isActive() || request.signal.aborted) {
            throw cancelledError();
          }
          return port.rasterize(request);
        },
        (error: unknown) => {
          if (error instanceof WechatVisualRasterizationError) {
            throw error;
          }
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
  let editorClipboardPort: ReturnType<typeof createBrowserEditorClipboard> | null = null;
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
    const baseStylesheet = editorStylesheetElement(
      documentRef.getElementById('easymde-content-css'),
      'editor-content-stylesheet-unavailable'
    );
    baseStylesheetLeases.push(
      baseStylesheet instanceof HTMLLinkElement
        ? scopeEditorStylesheetLink(baseStylesheet, {
            rootSelector: EDITOR_STYLESHEET_SCOPE
          })
        : scopeEditorStyleElement(baseStylesheet, {
            rootSelector: EDITOR_STYLESHEET_SCOPE
          })
    );

    const form = requiredElement(
      documentRef,
      '#post',
      (element): element is HTMLFormElement => element instanceof HTMLFormElement,
      'native-form-unavailable'
    );
    const titleCandidate = documentRef.querySelector('#title');
    const titleField =
      titleCandidate instanceof HTMLInputElement ? titleCandidate : null;
    const submissionField = requiredElement(
      documentRef,
      '#easymde-source',
      (element): element is HTMLTextAreaElement =>
        element instanceof HTMLTextAreaElement,
      'native-markdown-field-unavailable'
    );
    const nativeEditorCandidate = documentRef.querySelector('#postdivrich');
    nativeEditor =
      nativeEditorCandidate instanceof HTMLElement ? nativeEditorCandidate : null;
    const nativeContentCandidate = documentRef.querySelector('#content');
    const nativeContentField =
      nativeContentCandidate instanceof HTMLTextAreaElement
        ? nativeContentCandidate
        : null;
    const input = (selector: string, code: string) =>
      requiredElement(
        documentRef,
        selector,
        (element): element is HTMLInputElement =>
          element instanceof HTMLInputElement,
        code
      );
    const appearanceFields = {
      codeTheme: input(
        '#easymde-code-theme-field',
        'appearance-native-fields-unavailable'
      ),
      codeThemeExplicit: input(
        '#easymde-code-theme-explicit-field',
        'appearance-native-fields-unavailable'
      ),
      customCssId: input(
        '#easymde-custom-css-id-field',
        'appearance-native-fields-unavailable'
      ),
      markdownTheme: input(
        '#easymde-markdown-theme-field',
        'appearance-native-fields-unavailable'
      )
    };
    const enabledField = input(
      '#easymde-enabled-field',
      'autosave-native-fields-unavailable'
    );
    const fontFields = {
      appleFont: input(
        '#easymde-apple-font-field',
        'font-controls-native-fields-unavailable'
      ),
      customFont: input(
        '#easymde-custom-font-field',
        'font-controls-native-fields-unavailable'
      ),
      serifFont: input(
        '#easymde-serif-font-field',
        'font-controls-native-fields-unavailable'
      ),
      windowsFont: input(
        '#easymde-windows-font-field',
        'font-controls-native-fields-unavailable'
      )
    };
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
    const browserCapabilities = windowRef as unknown as {
      createImageBitmap?: typeof globalThis.createImageBitmap;
      OffscreenCanvas?: typeof globalThis.OffscreenCanvas;
      Worker?: typeof globalThis.Worker;
    };
    const pngEncoderRuntime = {
      ...(browserCapabilities.createImageBitmap
        ? { createImageBitmap: browserCapabilities.createImageBitmap }
        : {}),
      ...(browserCapabilities.OffscreenCanvas
        ? { offscreenCanvas: browserCapabilities.OffscreenCanvas }
        : {}),
      ...(browserCapabilities.Worker
        ? { worker: browserCapabilities.Worker }
        : {}),
      workerUrl: wechatPngEncoderWorkerUrl
    };
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
    const browserClipboard = windowRef.navigator.clipboard;
    const deferredClipboardItem = (
      windowRef as Window & { ClipboardItem?: unknown }
    ).ClipboardItem;
    const supportsPngWrite = (): boolean => {
      if (
        !browserClipboard
        || 'function' !== typeof browserClipboard.write
        || 'function' !== typeof deferredClipboardItem
      ) return false;
      const ClipboardItem =
        deferredClipboardItem as ClipboardItemConstructorWithSupport;
      if ('function' !== typeof ClipboardItem.supports) return false;
      try {
        return true === ClipboardItem.supports('image/png');
      } catch {
        return false;
      }
    };
    const supportsRichWrite = (): boolean => {
      if (
        !browserClipboard
        || 'function' !== typeof browserClipboard.write
        || 'function' !== typeof deferredClipboardItem
      ) return false;
      const ClipboardItem =
        deferredClipboardItem as ClipboardItemConstructorWithSupport;
      if ('function' !== typeof ClipboardItem.supports) return false;
      try {
        return (
          true === ClipboardItem.supports('text/html')
          && true === ClipboardItem.supports('text/plain')
        );
      } catch {
        return false;
      }
    };
    editorClipboardPort = createBrowserEditorClipboard(
      browserClipboard
        ? {
            readText: () => browserClipboard.readText(),
            supportsPngWrite,
            supportsRichWrite,
            ...('function' === typeof deferredClipboardItem
              ? {
                  writeDeferred: (text: Promise<string>) => {
                    const ClipboardItem =
                      deferredClipboardItem as DeferredClipboardItemConstructor;
                    const plain = text.then(
                      (value) => new Blob([value], { type: 'text/plain' })
                    );
                    void plain.catch(() => undefined);
                    const item = new ClipboardItem({
                      'text/plain': plain
                    });
                    return browserClipboard.write([item] as ClipboardItems);
                  },
                  writeImageDeferred: (image: Promise<Blob>) => {
                    const ClipboardItem =
                      deferredClipboardItem as DeferredClipboardItemConstructor;
                    const item = new ClipboardItem({ 'image/png': image });
                    return browserClipboard.write([item] as ClipboardItems);
                  },
                  writeRichDeferred: (payload) => {
                    const ClipboardItem =
                      deferredClipboardItem as DeferredClipboardItemConstructor;
                    const html = payload.then(
                      (value) => new Blob([value.html], { type: 'text/html' })
                    );
                    const text = payload.then(
                      (value) => new Blob([value.text], { type: 'text/plain' })
                    );
                    void html.catch(() => undefined);
                    void text.catch(() => undefined);
                    const item = new ClipboardItem({
                      'text/html': html,
                      'text/plain': text
                    });
                    return browserClipboard.write([item] as ClipboardItems);
                  }
                }
              : {}),
            writeText: (text) => browserClipboard.writeText(text)
          }
        : null
    );
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
      () => active
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
      restoreRevision: (restoreUrl) => {
        const target = new URL(restoreUrl, windowRef.location.href);
        if (
          target.origin !== windowRef.location.origin
          || target.username
          || target.password
        ) {
          throw new Error('revision-restore-url-invalid');
        }
        windowRef.location.assign(target.href);
      },
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
        () => active
      ),
      wechatExport: bootstrap.wechatExport,
      wechatVisualRasterizationPort: wechatVisualRasterizer,
      simplifiedFormattingParser: {
        parseFromString: (source, mimeType) => {
          const Parser = (
            windowRef as Window & {
              DOMParser?: new () => DOMParser;
            }
          ).DOMParser;
          if ('function' !== typeof Parser) {
            throw new Error('editor-simplified-formatting-parser-unavailable');
          }
          return new Parser().parseFromString(source, mimeType);
        }
      }
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
