import { createElement, createRoot } from '@wordpress/element';

import { EditorRoot, type EditorRootProps } from '../app/editor/EditorRoot';
import { EditorRootErrorBoundary } from '../app/editor/EditorRootErrorBoundary';
import {
  parseEditorRootBootstrap,
  type EditorRootBootstrap
} from '../contracts/bootstrap/editor-root-bootstrap';
import type { WordPressApiFetch } from '../integrations/wordpress/preview/create-wordpress-preview-port';
import { createBrowserScrollSync } from '../integrations/browser/editor-layout/create-browser-scroll-sync';
import { createBrowserToolbarShortcuts } from '../integrations/browser/keyboard/create-browser-toolbar-shortcuts';
import { createBrowserLocalDraftStorage } from '../integrations/browser/local-drafts/browser-local-draft-storage';
import { createBrowserImmersivePreferencesPort } from '../integrations/browser/immersive-preferences/browser-immersive-preferences';
import { createBrowserImmersiveEnvironment } from '../integrations/browser/immersive/create-browser-immersive-environment';
import { createBrowserPreviewScroll } from '../integrations/browser/preview/create-browser-preview-scroll';
import {
  createBrowserWechatClipboard,
  type ClipboardItemConstructor
} from '../integrations/browser/wechat/create-browser-wechat-clipboard';
import {
  createBrowserPreviewEnhancementPort,
  createWindowPreviewEnhancementRuntime
} from '../integrations/preview-runtime/browser-preview-enhancement';
import { createWordPressAppearancePort } from '../integrations/wordpress/appearance/create-wordpress-appearance-port';
import { createWordPressFontControlsPort } from '../integrations/wordpress/appearance/create-wordpress-font-controls-port';
import { createWordPressImageUploadPort } from '../integrations/wordpress/media/wordpress-image-upload';
import { createWordPressMediaFramePort } from '../integrations/wordpress/media/wordpress-media-frame';
import { createWordPressNativeSubmissionPort } from '../integrations/wordpress/native-form/wordpress-native-submission';
import { createWordPressNativePublishPort } from '../integrations/wordpress/native-form/create-wordpress-native-publish-port';
import { createWordPressPreviewPort } from '../integrations/wordpress/preview/create-wordpress-preview-port';
import { createWordPressRevisionPort } from '../integrations/wordpress/revisions/create-wordpress-revision-port';
import { createWordPressEditorSessionPort } from '../integrations/wordpress/session/create-wordpress-editor-session-port';

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
  media?: unknown;
}>;

type AdminEditorBrowserRuntime = Readonly<{
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

function failureCode(error: unknown): string {
  return error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
    ? error.message
    : 'react-editor-startup-failed';
}

function showStartupFailure(
  root: HTMLElement,
  message: string,
  code: string
): void {
  root.replaceChildren();
  const notice = root.ownerDocument.createElement('div');
  notice.className = 'notice notice-error easymde-editor-startup-error';
  notice.setAttribute('role', 'alert');
  const paragraph = root.ownerDocument.createElement('p');
  paragraph.textContent = message;
  notice.append(paragraph);
  root.append(notice);
  console.error(`[EasyMDE] ${code}`);
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
  return () => {
    const candidate = documentRef.querySelector<HTMLElement>('#publish');
    if (!candidate || candidate.matches(':disabled, [aria-disabled="true"]'))
      return false;
    candidate.click();
    return true;
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
    customCssId: input(
      '#easymde-custom-css-id-field',
      'appearance-native-fields-unavailable'
    ),
    markdownTheme: input(
      '#easymde-markdown-theme-field',
      'appearance-native-fields-unavailable'
    )
  };
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
    enhancementPort,
    executeExternalCommand: createExternalCommandExecutor(
      bootstrap,
      documentRef
    ),
    fontControlsPort: createWordPressFontControlsPort(fontFields),
    fonts: bootstrap.fonts,
    imageUpload: { ...bootstrap.imageUpload, postId },
    imageUploadPort: createWordPressImageUploadPort({
      apiFetch,
      endpoint: bootstrap.imageUpload.endpoint,
      formData: FormData,
      nonce: bootstrap.imageUpload.nonce,
      siteUrl: windowRef.location.href
    }),
    immersiveEnvironment: createBrowserImmersiveEnvironment(documentRef),
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
    mediaPickerFrame: createWordPressMediaFramePort(runtime.wordpress.media),
    nativePublishPort: createWordPressNativePublishPort(documentRef),
    nativeSubmissionPort: createWordPressNativeSubmissionPort(form),
    onDocumentOwnerChange: (owned) => {
      nativeEditor?.classList.toggle('easymde-native-editor-hidden', owned);
    },
    onFailure,
    platform: platform(windowRef),
    publishPost: createNativePublisher(documentRef),
    prepareToolbarShortcuts: ({ editorRoot, source }) =>
      createBrowserToolbarShortcuts({
        commands: bootstrap.toolbar.commands,
        editorRoot,
        eventTarget: documentRef,
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
      document: documentRef,
      hooks: runtime.wordpress.hooks,
      namespace: 'easymde/editor-root'
    }),
    submissionField,
    titleField,
    toolbar: bootstrap.toolbar,
    wechatClipboard: createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: clipboardItem(windowRef),
      document: documentRef,
      getComputedStyle: (element) => windowRef.getComputedStyle(element),
      getSelection: () => windowRef.getSelection(),
      pageOffset: () => ({ x: windowRef.scrollX, y: windowRef.scrollY }),
      scrollTo: (x, y) => windowRef.scrollTo(x, y),
      write: windowRef.navigator.clipboard?.write
        ? (items) =>
            windowRef.navigator.clipboard.write(items as ClipboardItems)
        : null
    }),
    wechatExport: bootstrap.wechatExport
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
    root.unmount();
    nativeEditor?.classList.remove('easymde-native-editor-hidden');
  };
}

declare global {
  interface Window {
    EasyMDEEditorRootBootstrap?: unknown;
  }
}

function start(): void {
  const root = document.querySelector<HTMLElement>('#easymde-editor-root');
  const failureMessage = root?.dataset.failureMessage ?? '';
  try {
    const browserWindow = window as Window &
      Readonly<{
        wp?: Partial<WordPressEditorRuntime>;
      }>;
    const wordpress = browserWindow.wp;
    if (!wordpress?.apiFetch || !wordpress.hooks) {
      throw new Error('react-editor-wordpress-runtime-unavailable');
    }
    const unmount = mountAdminEditor(window.EasyMDEEditorRootBootstrap, {
      document,
      failureMessage,
      window,
      wordpress: {
        apiFetch: wordpress.apiFetch,
        hooks: wordpress.hooks,
        ...(wordpress.media ? { media: wordpress.media } : {})
      }
    });
    window.addEventListener('pagehide', unmount, { once: true });
  } catch (error) {
    if (root && failureMessage) {
      showStartupFailure(root, failureMessage, failureCode(error));
      return;
    }
    console.error(`[EasyMDE] ${failureCode(error)}`);
  }
}

start();
