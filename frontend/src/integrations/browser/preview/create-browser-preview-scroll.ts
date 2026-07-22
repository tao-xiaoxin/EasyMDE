import type {
  PreviewScrollPort,
  PreviewScrollSnapshot
} from '../../../features/live-preview/ports/preview-scroll-port';

export function createBrowserPreviewScroll(): PreviewScrollPort {
  return {
    capture(surface): PreviewScrollSnapshot {
      const scrollable = Math.max(0, surface.scrollHeight - surface.clientHeight);
      return {
        left: surface.scrollLeft,
        ratio: scrollable ? surface.scrollTop / scrollable : 0,
        top: surface.scrollTop
      };
    },
    restore(surface, snapshot) {
      const scrollable = Math.max(0, surface.scrollHeight - surface.clientHeight);
      surface.scrollLeft = snapshot.left;
      surface.scrollTop = scrollable ? snapshot.ratio * scrollable : snapshot.top;
    }
  };
}
