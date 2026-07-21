import type {
  PreparedScrollSyncBinding,
  ScrollSyncPort
} from '../../../contracts/ports/scroll-sync-port';

type ScrollSyncRuntime = Pick<Window, 'clearTimeout' | 'setTimeout'>;

function hasScrollSurface(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement
    && 'function' === typeof value.addEventListener
    && 'function' === typeof value.removeEventListener;
}

function scrollableHeight(surface: HTMLElement): number {
  return Math.max(1, surface.scrollHeight - surface.clientHeight);
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
      const unlockLater = () => {
        if (null !== unlockTimer) runtime.clearTimeout(unlockTimer);
        unlockTimer = runtime.setTimeout(() => {
          unlockTimer = null;
          if (active) locked = false;
        }, 30);
      };
      const sync = (from: HTMLElement, to: HTMLElement) => {
        if (!active || locked) return;
        locked = true;
        to.scrollTop = (from.scrollTop / scrollableHeight(from)) * scrollableHeight(to);
        unlockLater();
      };
      const onSourceScroll = () => sync(source, preview);
      const onPreviewScroll = () => sync(preview, source);

      return {
        activate(): void {
          if (activated) throw new Error('scroll-sync-binding-already-activated');
          activated = true;
          active = true;
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
