export const RESOURCE_LOAD_TIMEOUT_MS = 15_000;

export function resourceError(code: string): Error {
  return new Error(code);
}

export function getDocumentHead(documentRef: Document): HTMLHeadElement {
  const value = documentRef.head;
  if (!value) throw resourceError('preview-enhancement-document-head-missing');
  return value;
}

export function waitForResource(
  promise: Promise<void>,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(resourceError('preview-enhancement-resource-stale'));
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let abort: () => void;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
    };
    abort = () => finish(
      () => reject(resourceError('preview-enhancement-resource-stale'))
    );
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      () => finish(resolve),
      (error) => finish(() => reject(error))
    );
  });
}
