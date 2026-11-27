import { THEME_IMAGE_FETCH_TIMEOUT_MS } from './wechat-background-images';
import { backgroundPreparationAbortError } from './wechat-clipboard-runtime';

export type MermaidContentBox = Readonly<{ width: number; height: number }>;

export type MermaidContentBoxLease = Readonly<{
  acquire: () => () => void;
  cleanup: () => void;
  get: (source: Element) => MermaidContentBox | null;
  isCurrent: () => boolean;
  ready: Promise<void>;
  retain: () => void;
}>;

const INTRINSIC_OWNER = '.easymde-mermaid[data-easymde-mermaid-layout]';

function intrinsicOwners(root: Element): Element[] {
  return [
    ...(root.matches(INTRINSIC_OWNER) ? [root] : []),
    ...root.querySelectorAll(INTRINSIC_OWNER)
  ];
}

export function createMermaidContentBoxLease(root: Element, signal?: AbortSignal): MermaidContentBoxLease {
  const owners = intrinsicOwners(root);
  const boxes = new Map<Element, MermaidContentBox>();
  let observedRoot: Element | null = root;
  let observer: ResizeObserver | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let ownerReleased = false;
  let activeHolds = 0;
  let closed = false;
  let stale = false;
  let settled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);

  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    if (error) rejectReady(error);
    else resolveReady();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    observer?.disconnect();
    observer = null;
    signal?.removeEventListener('abort', onAbort);
    observedRoot = null;
    owners.length = 0;
    boxes.clear();
    finish(backgroundPreparationAbortError());
  };
  const cleanup = (): void => {
    if (ownerReleased) return;
    ownerReleased = true;
    signal?.removeEventListener('abort', onAbort);
    if (activeHolds === 0) close();
  };
  const acquire = (): (() => void) => {
    if (closed) return () => undefined;
    activeHolds += 1;
    signal?.removeEventListener('abort', onAbort);
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      activeHolds = Math.max(0, activeHolds - 1);
      if (ownerReleased && activeHolds === 0) close();
    };
  };
  const onAbort = (): void => cleanup();
  const isCurrent = (): boolean => {
    if (closed || stale || !settled || !observedRoot || boxes.size !== owners.length) return false;
    const currentOwners = intrinsicOwners(observedRoot);
    return currentOwners.length === owners.length && owners.every((owner, index) => currentOwners[index] === owner);
  };
  const lease: MermaidContentBoxLease = {
    acquire,
    cleanup,
    get: (source) => isCurrent() ? boxes.get(source) ?? null : null,
    isCurrent,
    ready,
    retain: () => signal?.removeEventListener('abort', onAbort)
  };
  if (signal?.aborted) {
    cleanup();
    return lease;
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  if (!owners.length) {
    finish();
    return lease;
  }
  const Observer = root.ownerDocument.defaultView?.ResizeObserver;
  if (!Observer) {
    stale = true;
    finish(new Error('wechat-mermaid-content-box-unavailable'));
    return lease;
  }
  try {
    observer = new Observer((entries) => {
      if (closed || stale) return;
      for (const entry of entries) {
        if (!owners.includes(entry.target)) continue;
        const { width, height } = entry.contentRect;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          stale = true;
          finish(new Error('wechat-mermaid-content-box-unavailable'));
          return;
        }
        const previous = boxes.get(entry.target);
        if (previous && (previous.width !== width || previous.height !== height)) {
          stale = true;
          finish(new Error('wechat-copy-stale'));
          return;
        }
        if (!previous) boxes.set(entry.target, Object.freeze({ width, height }));
      }
      if (boxes.size === owners.length) finish();
    });
    owners.forEach((owner) => { observer?.observe(owner); });
    if (!settled) {
      timeout = setTimeout(() => {
        stale = true;
        finish(new Error('wechat-preview-measurement-resource-timeout'));
      }, THEME_IMAGE_FETCH_TIMEOUT_MS);
    }
  } catch {
    stale = true;
    observer?.disconnect();
    observer = null;
    finish(new Error('wechat-mermaid-content-box-unavailable'));
  }
  return lease;
}
