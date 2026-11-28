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
import { createBrowserPreviewScroll } from '../integrations/browser/preview/create-browser-preview-scroll';
import { createBrowserWechatPngEncoder } from '../integrations/browser/wechat/create-browser-wechat-png-encoder';
import wechatPngEncoderWorkerUrl from '../integrations/browser/wechat/wechat-png-encoder.worker.ts?worker&url';
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
  createLazyBrowserWechatClipboard,
  createLazyBrowserWechatVisualRasterizer,
  type WechatClipboardModule,
  type WechatVisualRasterizerModule
} from './admin-editor-lazy-wechat-ports';
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
