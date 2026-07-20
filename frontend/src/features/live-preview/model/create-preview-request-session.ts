import type {
  PreviewRequest,
  PreviewRequestPort,
  PreviewRequestState
} from '../../../contracts/ports/preview-request';

export type PreviewRequestSession = Readonly<{
  destroy: () => void;
  isCurrent: (revision: number, signature: string) => boolean;
  schedule: (request: PreviewRequest, immediate?: boolean) => number;
}>;

type PreviewRequestSessionOptions = Readonly<{
  initialRevision: number;
  onState: (state: PreviewRequestState) => void;
  port: PreviewRequestPort;
}>;

export function createPreviewRequestSession({
  initialRevision,
  onState,
  port
}: PreviewRequestSessionOptions): PreviewRequestSession {
  let revision = initialRevision;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let destroyed = false;
  let currentSignature = '';

  function cancelCurrent(): void {
    if (null !== timer) {
      clearTimeout(timer);
      timer = null;
    }
    controller?.abort();
    controller = null;
  }

  return {
    isCurrent(candidateRevision, signature): boolean {
      return !destroyed && revision === candidateRevision && currentSignature === signature;
    },
    schedule(request, immediate = false): number {
      if (destroyed) {
        throw new Error('preview-session-destroyed');
      }

      cancelCurrent();
      const currentRevision = ++revision;
      currentSignature = request.signature;

      if (!request.markdown.trim()) {
        onState({ kind: 'empty', request, revision: currentRevision });
        return currentRevision;
      }

      onState({ kind: 'loading', request, revision: currentRevision });
      const run = async () => {
        timer = null;
        controller = new AbortController();
        const currentController = controller;

        try {
          const response = await port.render(request, currentController.signal);
          if (!destroyed && revision === currentRevision && controller === currentController) {
            onState({ kind: 'success', request, response, revision: currentRevision });
          }
        } catch (error) {
          if (
            !destroyed &&
            revision === currentRevision &&
            controller === currentController &&
            !(error instanceof DOMException && 'AbortError' === error.name)
          ) {
            onState({ kind: 'error', request, revision: currentRevision });
          }
        } finally {
          if (controller === currentController) {
            controller = null;
          }
        }
      };

      if (immediate) {
        void run();
      } else {
        timer = setTimeout(() => void run(), 180);
      }

      return currentRevision;
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      revision += 1;
      currentSignature = '';
      cancelCurrent();
    }
  };
}
