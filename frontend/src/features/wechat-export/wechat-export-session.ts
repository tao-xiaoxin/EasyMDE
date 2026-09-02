import type {
  WechatClipboardCopyOptions,
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
  copyOptions?: Omit<WechatClipboardCopyOptions, 'isCurrent' | 'signal'>;
}>;

export function createWechatExportSession({
  clipboard,
  enabled,
  getPreview,
  onDiagnostic,
  onStatus,
  strings,
  copyOptions = {}
}: CreateWechatExportSessionOptions): WechatExportSession {
  let active = true;
  let pending: ReturnType<WechatExportSession['copy']> | null = null;
  let operationSequence = 0;
  let operationController: AbortController | null = null;

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

      const sequence = ++operationSequence;
      const controller = new AbortController();
      operationController = controller;
      const operationOptions: WechatClipboardCopyOptions = {
        ...copyOptions,
        isCurrent: () => active && operationSequence === sequence && getPreview() === preview,
        signal: controller.signal
      };
      let operation: Promise<WechatClipboardResult>;
      try {
        operation = clipboard.copy(preview, operationOptions);
      } catch {
        operation = Promise.resolve({
          code: 'wechat-copy-failed',
          status: 'failed'
        });
      }
      operation = operation.catch((): WechatClipboardResult => ({
        code: 'wechat-copy-failed',
        status: 'failed'
      }));
      pending = operation.then((result) => {
        if (!active || operationSequence !== sequence) {
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
        if (operationController === controller) operationController = null;
        pending = null;
      });
      return pending;
    },
    dispose() {
      active = false;
      operationSequence += 1;
      operationController?.abort();
      operationController = null;
    }
  };
}
