import type {
  PreparedScrollSyncBinding,
  ScrollSyncPort
} from '../../../contracts/ports/scroll-sync-port';

type ScrollSyncRuntime = Pick<Window, 'clearTimeout' | 'setTimeout'>;

type ScrollSurfaceMetrics = Readonly<{
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}>;

type ScrollSurfaceState = {
  expectedScrollTop: number | null;
  metrics: ScrollSurfaceMetrics | null;
};

const LAYOUT_SHIFT_TOLERANCE_PX = 2;
const ECHO_TOLERANCE_PX = 1;

function hasScrollSurface(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement
    && 'function' === typeof value.addEventListener
    && 'function' === typeof value.removeEventListener;
}

function scrollableHeight(surface: HTMLElement): number {
  return Math.max(1, surface.scrollHeight - surface.clientHeight);
}

function readScrollMetrics(surface: HTMLElement): ScrollSurfaceMetrics {
  return {
    clientHeight: surface.clientHeight,
    scrollHeight: surface.scrollHeight,
    scrollTop: surface.scrollTop
  };
}

/**
 * Detects scroll events caused by layout rather than the user: CSS scroll
 * anchoring after content above the viewport grows or collapses, unchanged
 * offsets during a resize, and browser clamping after content shrinks.
 */
function isLayoutInducedScroll(previous: ScrollSurfaceMetrics, next: ScrollSurfaceMetrics): boolean {
  const heightDelta = next.scrollHeight - previous.scrollHeight;
  const clientDelta = next.clientHeight - previous.clientHeight;
  if (0 === heightDelta && 0 === clientDelta) return false;

  const scrollDelta = next.scrollTop - previous.scrollTop;
  if (0 === scrollDelta) return true;

  const nextMax = Math.max(0, next.scrollHeight - next.clientHeight);
  if (
    next.scrollTop <= nextMax + LAYOUT_SHIFT_TOLERANCE_PX
    && previous.scrollTop > nextMax
    && scrollDelta < 0
  ) {
    return true;
  }

  if (0 === heightDelta) return false;
  return Math.sign(scrollDelta) === Math.sign(heightDelta)
    && Math.abs(scrollDelta) <= Math.abs(heightDelta) + LAYOUT_SHIFT_TOLERANCE_PX;
}

function isDelayedEcho(
  state: ScrollSurfaceState,
  previous: ScrollSurfaceMetrics,
  next: ScrollSurfaceMetrics
): boolean {
  return null !== state.expectedScrollTop
    && Math.abs(next.scrollTop - state.expectedScrollTop) <= ECHO_TOLERANCE_PX
    && next.scrollHeight === previous.scrollHeight
    && next.clientHeight === previous.clientHeight;
}

export function createBrowserScrollSync(runtime: ScrollSyncRuntime): ScrollSyncPort {
  return {
    prepareBinding(options): PreparedScrollSyncBinding {
      const { preview, source } = options;
      if (!hasScrollSurface(source) || !hasScrollSurface(preview) || source === preview) {
        throw new Error('scroll-sync-surfaces-invalid');
      }

      let activated = false;
      let active = false;
      let locked = false;
      let unlockTimer: number | null = null;
      const sourceState: ScrollSurfaceState = { expectedScrollTop: null, metrics: null };
      const previewState: ScrollSurfaceState = { expectedScrollTop: null, metrics: null };
      const unlockLater = () => {
        if (null !== unlockTimer) runtime.clearTimeout(unlockTimer);
        unlockTimer = runtime.setTimeout(() => {
          unlockTimer = null;
          if (active) locked = false;
        }, 30);
      };
      const sync = (
        from: HTMLElement,
        to: HTMLElement,
        fromState: ScrollSurfaceState,
        toState: ScrollSurfaceState
      ) => {
        if (!active) return;
        const next = readScrollMetrics(from);
        const previous = fromState.metrics;
        fromState.metrics = next;

        if (locked) {
          if (null !== previous && isDelayedEcho(fromState, previous, next)) {
            fromState.expectedScrollTop = null;
          }
          return;
        }

        if (null !== previous) {
          if (isLayoutInducedScroll(previous, next)) {
            fromState.expectedScrollTop = null;
            return;
          }
          if (isDelayedEcho(fromState, previous, next)) {
            fromState.expectedScrollTop = null;
            return;
          }
        }

        fromState.expectedScrollTop = null;
        locked = true;
        to.scrollTop = (next.scrollTop / scrollableHeight(from)) * scrollableHeight(to);
        const toMetrics = readScrollMetrics(to);
        toState.metrics = toMetrics;
        toState.expectedScrollTop = toMetrics.scrollTop;
        unlockLater();
      };
      const onSourceScroll = () => sync(source, preview, sourceState, previewState);
      const onPreviewScroll = () => sync(preview, source, previewState, sourceState);

      return {
        activate(): void {
          if (activated) throw new Error('scroll-sync-binding-already-activated');
          activated = true;
          active = true;
          sourceState.expectedScrollTop = null;
          sourceState.metrics = readScrollMetrics(source);
          previewState.expectedScrollTop = null;
          previewState.metrics = readScrollMetrics(preview);
          source.addEventListener('scroll', onSourceScroll);
          try {
            preview.addEventListener('scroll', onPreviewScroll);
          } catch (error) {
            source.removeEventListener('scroll', onSourceScroll);
            active = false;
            throw error;
          }
        },
        dispose(): void {
          if (!active) return;
          active = false;
          source.removeEventListener('scroll', onSourceScroll);
          preview.removeEventListener('scroll', onPreviewScroll);
          if (null !== unlockTimer) {
            runtime.clearTimeout(unlockTimer);
            unlockTimer = null;
          }
        }
      };
    }
  };
}
