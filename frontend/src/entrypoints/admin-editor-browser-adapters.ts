import type { EditorRootProps } from '../app/editor/EditorRoot';
import type { EditorRootBootstrap } from '../contracts/bootstrap/editor-root-bootstrap';
import {
  createBrowserClipboardReadPermissionQuery,
  createBrowserEditorClipboard
} from '../integrations/browser/clipboard/create-browser-editor-clipboard';
import type { ClipboardItemConstructor } from '../integrations/browser/wechat/create-browser-wechat-clipboard';

type DeferredClipboardItemConstructor = new (
  payload: Record<string, Blob | PromiseLike<Blob>>
) => unknown;

type ClipboardItemConstructorWithSupport = DeferredClipboardItemConstructor & {
  supports?: (type: string) => boolean;
};

export type AdminEditorDomFields = Readonly<{
  appearanceFields: {
    codeTheme: HTMLInputElement;
    codeThemeExplicit: HTMLInputElement;
    customCssId: HTMLInputElement;
    markdownTheme: HTMLInputElement;
  };
  enabledField: HTMLInputElement;
  fontFields: {
    appleFont: HTMLInputElement;
    customFont: HTMLInputElement;
    serifFont: HTMLInputElement;
    windowsFont: HTMLInputElement;
  };
  form: HTMLFormElement;
  nativeContentField: HTMLTextAreaElement | null;
  nativeEditor: HTMLElement | null;
  submissionField: HTMLTextAreaElement;
  titleField: HTMLInputElement | null;
}>;

export function requiredElement<T extends Element>(
  documentRef: Document,
  selector: string,
  guard: (element: Element) => element is T,
  code: string
): T {
  const element = documentRef.querySelector(selector);
  if (!element || !guard(element)) throw new Error(code);
  return element;
}

export function currentPostId(documentRef: Document, fallback: number): number {
  const value = Number(
    documentRef.querySelector<HTMLInputElement>('#post_ID')?.value
  );
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function platform(windowRef: Window): 'mac' | 'win' {
  return /Mac|iPhone|iPad|iPod/i.test(windowRef.navigator.platform)
    ? 'mac'
    : 'win';
}

export function clipboardItem(windowRef: Window): ClipboardItemConstructor | null {
  const value = (windowRef as Window & { ClipboardItem?: unknown })
    .ClipboardItem;
  return 'function' === typeof value
    ? (value as ClipboardItemConstructor)
    : null;
}

export function localStorage(windowRef: Window): Storage | null {
  try {
    return windowRef.localStorage;
  } catch {
    return null;
  }
}

export function createExternalCommandExecutor(
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

export function createNativePublisher(
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

export function collectAdminEditorDomFields(
  documentRef: Document
): AdminEditorDomFields {
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

  return {
    appearanceFields,
    enabledField,
    fontFields,
    form,
    nativeContentField,
    nativeEditor,
    submissionField,
    titleField
  };
}

export function createWechatPngEncoderRuntime(
  windowRef: Window,
  workerUrl: string
): {
  createImageBitmap?: typeof globalThis.createImageBitmap;
  offscreenCanvas?: typeof globalThis.OffscreenCanvas;
  worker?: typeof globalThis.Worker;
  workerUrl: string;
} {
  const browserCapabilities = windowRef as unknown as {
    createImageBitmap?: typeof globalThis.createImageBitmap;
    OffscreenCanvas?: typeof globalThis.OffscreenCanvas;
    Worker?: typeof globalThis.Worker;
  };
  return {
    ...(browserCapabilities.createImageBitmap
      ? { createImageBitmap: browserCapabilities.createImageBitmap }
      : {}),
    ...(browserCapabilities.OffscreenCanvas
      ? { offscreenCanvas: browserCapabilities.OffscreenCanvas }
      : {}),
    ...(browserCapabilities.Worker
      ? { worker: browserCapabilities.Worker }
      : {}),
    workerUrl
  };
}

export function createAdminEditorClipboardPort(
  windowRef: Window
): ReturnType<typeof createBrowserEditorClipboard> {
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
  const queryReadPermission = createBrowserClipboardReadPermissionQuery(
    windowRef.navigator
  );
  return createBrowserEditorClipboard(
    browserClipboard
      ? {
          ...(queryReadPermission ? { queryReadPermission } : {}),
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
}

export function createRevisionRestorer(
  windowRef: Window
): EditorRootProps['restoreRevision'] {
  return (restoreUrl) => {
    const target = new URL(restoreUrl, windowRef.location.href);
    if (
      target.origin !== windowRef.location.origin
      || target.username
      || target.password
    ) {
      throw new Error('revision-restore-url-invalid');
    }
    windowRef.location.assign(target.href);
  };
}

export function createSimplifiedFormattingParser(
  windowRef: Window
): NonNullable<EditorRootProps['simplifiedFormattingParser']> {
  return {
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
  };
}
