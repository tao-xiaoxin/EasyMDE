export type BrowserEditorImageHydrationScheduler = Readonly<{
  now: () => number;
  yield: () => Promise<void>;
}>;

export function createBrowserEditorImageHydrationScheduler(
  documentRef: Document,
  signal: AbortSignal
): BrowserEditorImageHydrationScheduler {
  const windowRef = documentRef.defaultView;
  if (!windowRef) throw new Error('editor-image-hydration-scheduler-window-unavailable');
  return {
    now: () => windowRef.performance?.now() ?? Date.now(),
    yield: () => new Promise<void>((resolve) => {
      let settled = false;
      let timer: number | null = null;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (null !== timer) windowRef.clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => finish();
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      timer = windowRef.setTimeout(finish, 0);
    })
  };
}
