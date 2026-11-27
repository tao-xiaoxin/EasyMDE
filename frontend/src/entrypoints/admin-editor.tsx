import { createElement, createRoot } from '@wordpress/element';

import { EditorRoot, type EditorRootProps } from '../app/editor/EditorRoot';
import { EditorRootErrorBoundary } from '../app/editor/EditorRootErrorBoundary';
import {
  parseEditorRootBootstrap,
  type EditorRootBootstrap
} from '../contracts/bootstrap/editor-root-bootstrap';
import type { WordPressApiFetch } from '../integrations/wordpress/preview/create-wordpress-preview-port';
import { createBrowserScrollSync } from '../integrations/browser/editor-layout/create-browser-scroll-sync';
import {
  createBrowserClipboardReadPermissionQuery,
  createBrowserEditorClipboard
} from '../integrations/browser/clipboard/create-browser-editor-clipboard';
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
import type { BrowserWechatVisualRasterizerRuntime } from '../integrations/browser/wechat/create-browser-wechat-visual-rasterizer';
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
  const windowRef = runtime.window;
  const rootElement = requiredElement(
    documentRef,
    '#easymde-editor-root',
    (element): element is HTMLElement => element instanceof HTMLElement,
    'react-editor-root-unavailable'
  );
  if (rootElement.childNodes.length)
    throw new Error('react-editor-root-not-empty');

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
  const nativeEditor =
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
  const root = createRoot(rootElement);
  let active = true;
  const onFailure = (code: string) => console.error(`[EasyMDE] ${code}`);
  const enhancementPort = createBrowserPreviewEnhancementPort(
    bootstrap.previewEnhancement,
    { documentRef, runtime: createWindowPreviewEnhancementRuntime(windowRef) }
  );
  const apiFetch = runtime.wordpress.apiFetch;
  const mediaPickerFrame = bootstrap.mediaPicker.canUseMedia
    ? createWordPressMediaFramePort({
        frameUrl: bootstrap.mediaPicker.frameUrl,
        window: windowRef
      })
    : null;
  const browserClipboard = windowRef.navigator.clipboard;
  const deferredClipboardItem = (windowRef as Window & { ClipboardItem?: unknown }).ClipboardItem;
  const supportsPngWrite = (): boolean => {
    if (
      !browserClipboard
      || 'function' !== typeof browserClipboard.write
      || 'function' !== typeof deferredClipboardItem
    ) return false;
    const ClipboardItem = deferredClipboardItem as ClipboardItemConstructorWithSupport;
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
    const ClipboardItem = deferredClipboardItem as ClipboardItemConstructorWithSupport;
    if ('function' !== typeof ClipboardItem.supports) return false;
    try {
      return true === ClipboardItem.supports('text/html')
        && true === ClipboardItem.supports('text/plain');
    } catch {
      return false;
    }
  };
  const queryReadPermission = createBrowserClipboardReadPermissionQuery(
    windowRef.navigator
  );
  const editorClipboardPort = createBrowserEditorClipboard(
    browserClipboard
      ? {
          ...(queryReadPermission ? { queryReadPermission } : {}),
          readText: () => browserClipboard.readText(),
          supportsPngWrite,
          supportsRichWrite,
          ...('function' === typeof deferredClipboardItem
            ? {
                writeDeferred: (text: Promise<string>) => {
                  const ClipboardItem = deferredClipboardItem as DeferredClipboardItemConstructor;
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
                  const ClipboardItem = deferredClipboardItem as DeferredClipboardItemConstructor;
                  const item = new ClipboardItem({ 'image/png': image });
                  return browserClipboard.write([item] as ClipboardItems);
                },
                writeRichDeferred: (payload) => {
                  const ClipboardItem = deferredClipboardItem as DeferredClipboardItemConstructor;
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
  const editorImagePixelsPort = createBrowserEditorImagePixels({
    clearTimeout: (handle) => windowRef.clearTimeout(handle as number),
    document: documentRef,
    setTimeout: (callback, delayMs) => windowRef.setTimeout(callback, delayMs)
  });
  const browserWorker = (windowRef as Window & { Worker?: unknown }).Worker;
  const editorBlockIndexPort = createBrowserEditorBlockIndexWorker({
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
  const wechatVisualRasterizer = createLazyBrowserWechatVisualRasterizer(
    {
      blob: Blob,
      document: documentRef,
      file: File,
      image: Image,
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
    appearancePort: createWordPressAppearancePort({
      apiFetch,
      assetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
      bootstrap: bootstrap.appearance,
      customCssUrl: bootstrap.wordpress.customCssUrl,
      document: documentRef,
      fields: appearanceFields,
      nonce: bootstrap.wordpress.nonce,
      siteUrl: windowRef.location.href
    }),
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
        target.origin !== windowRef.location.origin ||
        target.username ||
        target.password
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
        blob: Blob,
        clipboardItem: clipboardItem(windowRef),
        document: documentRef,
        fetch: (input, init) => windowRef.fetch(input, init),
        getComputedStyle: (element, pseudoElement) => windowRef.getComputedStyle(element, pseudoElement),
        getSelection: () => windowRef.getSelection(),
        pageOffset: () => ({ x: windowRef.scrollX, y: windowRef.scrollY }),
        scrollTo: (x, y) => windowRef.scrollTo(x, y),
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
        const Parser = (windowRef as Window & {
          DOMParser?: new () => DOMParser;
        }).DOMParser;
        if ('function' !== typeof Parser) {
          throw new Error('editor-simplified-formatting-parser-unavailable');
        }
        return new Parser().parseFromString(source, mimeType);
      }
    }
  };

  root.render(
    <EditorRootErrorBoundary
      failureMessage={runtime.failureMessage}
      onFailure={onFailure}
    >
      <EditorRoot {...props} />
    </EditorRootErrorBoundary>
  );

  return () => {
    if (!active) return;
    active = false;
    mediaPickerFrame?.dispose?.();
    root.unmount();
    editorBlockIndexPort.dispose();
    editorClipboardPort.dispose();
    editorImagePixelsPort.dispose();
    nativeEditor?.classList.remove('easymde-native-editor-hidden');
  };
}

declare global {
  interface Window {
    EasyMDEAdminEditorStart?: (runtime: AdminEditorStartRuntime) => () => void;
    EasyMDEEditorRootBootstrap?: unknown;
  }
}

export function startAdminEditor(runtime: AdminEditorStartRuntime): () => void {
  if (!runtime.wordpress.apiFetch || !runtime.wordpress.hooks) {
    throw new Error('react-editor-wordpress-runtime-unavailable');
  }

  return mountAdminEditor(runtime.bootstrap, {
    document: runtime.document,
    failureMessage: runtime.failureMessage,
    window: runtime.window,
    wordpress: runtime.wordpress
  });
}

if (import.meta.env.MODE !== 'test') {
  window.EasyMDEAdminEditorStart = startAdminEditor;
}
