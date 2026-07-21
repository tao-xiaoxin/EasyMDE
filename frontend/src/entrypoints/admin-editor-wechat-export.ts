import { parseWechatExportBootstrap } from '../contracts/bootstrap/wechat-export-bootstrap';
import {
  createWechatExportSession,
  type WechatExportSession,
  type WechatExportStatus
} from '../features/wechat-export/wechat-export-session';
import {
  createBrowserWechatClipboard,
  type BrowserWechatClipboardRuntime,
  type ClipboardItemConstructor
} from '../integrations/browser/wechat/create-browser-wechat-clipboard';

export type WechatExportActivateOptions = Readonly<{
  getPreview: () => HTMLElement | null;
  onDiagnostic: (code: string) => void;
  onStatus: (status: WechatExportStatus) => void;
}>;

export type AdminEditorWechatExportBridge = Readonly<{
  activate: (options: WechatExportActivateOptions) => WechatExportSession;
}>;

export function createAdminEditorWechatExportBridge(
  value: unknown,
  runtime: BrowserWechatClipboardRuntime
): AdminEditorWechatExportBridge {
  const bootstrap = parseWechatExportBootstrap(value);
  const clipboard = createBrowserWechatClipboard(runtime);
  return {
    activate(options) {
      if (
        !options
        || 'function' !== typeof options.getPreview
        || 'function' !== typeof options.onDiagnostic
        || 'function' !== typeof options.onStatus
      ) {
        throw new Error('wechat-export-activation-invalid');
      }
      return createWechatExportSession({
        clipboard,
        enabled: bootstrap.enabled,
        getPreview: options.getPreview,
        onDiagnostic: options.onDiagnostic,
        onStatus: options.onStatus,
        strings: bootstrap.strings
      });
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactWechatExport?: Readonly<{
      prepare: (value: unknown) => AdminEditorWechatExportBridge;
    }>;
  }
}

window.EasyMDEReactWechatExport = {
  prepare(value) {
    const clipboard = window.navigator.clipboard;
    const write = clipboard && 'function' === typeof clipboard.write
      ? clipboard.write.bind(clipboard)
      : null;
    return createAdminEditorWechatExportBridge(value, {
      blob: window.Blob,
      clipboardItem: (window.ClipboardItem ?? null) as ClipboardItemConstructor | null,
      document: window.document,
      getComputedStyle: window.getComputedStyle.bind(window),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: window.pageXOffset, y: window.pageYOffset }),
      scrollTo: window.scrollTo.bind(window),
      write: write as ((items: unknown[]) => Promise<void>) | null
    });
  }
};
