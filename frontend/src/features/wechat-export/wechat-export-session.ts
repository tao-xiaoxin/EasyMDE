import type {
  WechatClipboardCancellationCode,
  WechatClipboardCopyOptions,
  WechatClipboardPort,
  WechatClipboardResult
} from '../../contracts/ports/wechat-clipboard-port';
import type { WechatExportStrings } from '../../contracts/bootstrap/wechat-export-bootstrap';

export type WechatExportStatus = Readonly<{
  message: string;
  type: 'error' | 'success';
}>;

export type WechatExportCancellationReason = 'theme-change';
export type WechatExportDiagnosticLevel = 'error' | 'info';

export type WechatExportSession = Readonly<{
  copy: () => Promise<WechatClipboardResult | Readonly<{
    code: 'wechat-export-disabled' | 'wechat-export-inactive';
    status: 'failed';
  }>>;
  cancelPending: (reason: WechatExportCancellationReason) => void;
  dispose: () => void;
}>;

type CreateWechatExportSessionOptions = Readonly<{
  clipboard: WechatClipboardPort;
  enabled: boolean;
  getPreview: () => HTMLElement | null;
  onDiagnostic: (code: string, level?: WechatExportDiagnosticLevel) => void;
  onStatus: (status: WechatExportStatus) => void;
  strings: WechatExportStrings;
  copyOptions?: Omit<WechatClipboardCopyOptions, 'isCurrent' | 'signal'>;
}>;

function cancellationDiagnosticLevel(code: string): WechatExportDiagnosticLevel {
  return [
    'wechat-copy-cancelled',
    'wechat-copy-failed',
    'wechat-png-rasterization-cancelled'
  ].includes(code)
    ? 'info'
    : 'error';
}

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
  let pendingToken: object | null = null;
  let pendingState: {
    disposed: boolean;
    cancellation: WechatExportCancellationReason | null;
  } | null = null;
  let operationSequence = 0;
  let operationController: AbortController | null = null;

  return {
    copy() {
      if (!active) {
        return Promise.resolve({ code: 'wechat-export-inactive', status: 'failed' });
      }
      if (!enabled) {
        const result = { code: 'wechat-export-disabled' as const, status: 'failed' as const };
        onStatus({ message: strings.failed, type: 'error' });
        return Promise.resolve(result);
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
      const operationToken = {};
      const operationState = {
        cancellation: null as WechatExportCancellationReason | null,
        disposed: false
      };
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
      const tracked = operation.then((result) => {
        if (operationState.disposed || !active) {
          onDiagnostic('wechat-export-completed-after-teardown');
          return result;
        }
        if (operationState.cancellation) {
          if ('failed' === result.status || 'cancelled' === result.status) {
            onDiagnostic(result.code, cancellationDiagnosticLevel(result.code));
          }
          const sideEffects = 'failed' === result.status || 'cancelled' === result.status
            ? result.sideEffects
            : undefined;
          const cancellation: Readonly<{
            code: WechatClipboardCancellationCode;
            sideEffects?: 'none' | 'uploads-may-remain';
            status: 'cancelled';
          }> = {
            code: 'wechat-copy-cancelled',
            ...(sideEffects ? { sideEffects } : {}),
            status: 'cancelled'
          };
          return cancellation;
        }
        if (operationSequence !== sequence) {
          onDiagnostic('wechat-export-completed-after-teardown');
          return result;
        }
        if ('cancelled' === result.status) {
          onDiagnostic(result.code, 'info');
          return result;
        }
        if ('failed' === result.status) {
          onDiagnostic(result.code);
          onStatus({
            message: 'uploads-may-remain' === result.sideEffects
              ? strings.failedWithUploads
              : 'wechat-clipboard-unsupported' === result.code
                ? strings.unsupported
                : strings.failed,
            type: 'error'
          });
          return result;
        }
        onStatus({ message: strings.success, type: 'success' });
        return result;
      }).finally(() => {
        if (operationController === controller) operationController = null;
        if (pendingToken === operationToken) {
          pending = null;
          pendingToken = null;
          pendingState = null;
        }
      });
      pending = tracked;
      pendingToken = operationToken;
      pendingState = operationState;
      return tracked;
    },
    cancelPending(reason) {
      if (!active || !pendingState) return;
      pendingState.cancellation = reason;
      onDiagnostic(`wechat-export-cancelled-${reason}`, 'info');
      operationSequence += 1;
      operationController?.abort();
      operationController = null;
      pending = null;
      pendingToken = null;
      pendingState = null;
    },
    dispose() {
      active = false;
      if (pendingState) pendingState.disposed = true;
      operationSequence += 1;
      operationController?.abort();
      operationController = null;
      pending = null;
      pendingToken = null;
      pendingState = null;
    }
  };
}
