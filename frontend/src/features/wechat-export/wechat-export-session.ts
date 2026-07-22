import type {
  WechatClipboardPort,
  WechatClipboardResult
} from '../../contracts/ports/wechat-clipboard-port';
import type { WechatExportStrings } from '../../contracts/bootstrap/wechat-export-bootstrap';

export type WechatExportStatus = Readonly<{
  message: string;
  type: 'error' | 'success';
}>;

export type WechatExportSession = Readonly<{
  copy: () => Promise<WechatClipboardResult | Readonly<{
    code: 'wechat-export-disabled' | 'wechat-export-inactive';
    status: 'failed';
  }>>;
  dispose: () => void;
}>;

type CreateWechatExportSessionOptions = Readonly<{
  clipboard: WechatClipboardPort;
  enabled: boolean;
  getPreview: () => HTMLElement | null;
  onDiagnostic: (code: string) => void;
  onStatus: (status: WechatExportStatus) => void;
  strings: WechatExportStrings;
}>;

export function createWechatExportSession({
  clipboard,
  enabled,
  getPreview,
  onDiagnostic,
  onStatus,
  strings
}: CreateWechatExportSessionOptions): WechatExportSession {
  let active = true;
  let pending: ReturnType<WechatExportSession['copy']> | null = null;

  return {
    copy() {
      if (!active) {
        return Promise.resolve({ code: 'wechat-export-inactive', status: 'failed' });
      }
      if (!enabled) {
        return Promise.resolve({ code: 'wechat-export-disabled', status: 'failed' });
      }
      const preview = getPreview();
      if (!preview) {
        onDiagnostic('wechat-preview-unavailable');
        onStatus({ message: strings.failed, type: 'error' });
        return Promise.resolve({ code: 'wechat-preview-unavailable', status: 'failed' });
      }
      if (pending) {
        return pending;
      }

      const operation = clipboard.copy(preview).catch((): WechatClipboardResult => ({
        code: 'wechat-copy-failed',
        status: 'failed'
      }));
      pending = operation.then((result) => {
        if (!active) {
          onDiagnostic('wechat-export-completed-after-teardown');
          return result;
        }
        if ('failed' === result.status) {
          onDiagnostic(result.code);
          onStatus({
            message: 'wechat-clipboard-unsupported' === result.code ? strings.unsupported : strings.failed,
            type: 'error'
          });
          return result;
        }
        onStatus({ message: strings.success, type: 'success' });
        return result;
      }).finally(() => {
        pending = null;
      });
      return pending;
    },
    dispose() {
      active = false;
    }
  };
}
