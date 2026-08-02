import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  '[contenteditable="true"]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(boundary: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(
    boundary.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((element) => !element.closest('[hidden], [inert]'));
}

function isolateBoundary(boundary: HTMLElement): () => void {
  const changed: Array<HTMLElement> = [];
  let branch: HTMLElement = boundary;

  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      if (!sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        changed.push(sibling);
      }
    }
    if (parent === boundary.ownerDocument.body) break;
    branch = parent;
  }

  return () => {
    for (const element of changed) element.removeAttribute('inert');
  };
}

export function createBrowserImmersiveEnvironment(
  documentRef: Document,
  faviconHref: string
): ImmersiveEnvironmentPort {
  const faviconUrl = new URL(faviconHref, documentRef.baseURI).toString();

  return {
    activeElement() {
      return documentRef.activeElement instanceof HTMLElement
        ? documentRef.activeElement
        : null;
    },
    activateFavicon() {
      const favicon = documentRef.createElement('link');
      favicon.dataset.easymdeImmersiveFavicon = 'true';
      favicon.href = faviconUrl;
      favicon.rel = 'icon';
      favicon.type = 'image/png';
      documentRef.head.append(favicon);
      return () => favicon.remove();
    },
    activateFocusBoundary(boundary) {
      if (!boundary.isConnected || boundary.ownerDocument !== documentRef) {
        throw new Error('immersive-focus-boundary-invalid');
      }
      const restoreIsolation = isolateBoundary(boundary);
      const handleKeyDown = (event: KeyboardEvent) => {
        if ('Tab' !== event.key || event.defaultPrevented || event.isComposing) {
          return;
        }
        const controls = focusableElements(boundary);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) return;
        const active = documentRef.activeElement;
        if (active instanceof HTMLElement && active.closest('.media-modal')) {
          return;
        }
        if (!boundary.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      };
      documentRef.addEventListener('keydown', handleKeyDown);
      return () => {
        documentRef.removeEventListener('keydown', handleKeyDown);
        restoreIsolation();
      };
    },
    hasOpenToolbarPopover() {
      return (
        null !==
        documentRef.querySelector('.easymde-toolbar-popover:not([hidden])')
      );
    },
    now() {
      const browserWindow = documentRef.defaultView;
      if (!browserWindow) {
        throw new Error('immersive-window-unavailable');
      }
      return browserWindow.Date.now();
    },
    schedule(callback, delay) {
      const timer = documentRef.defaultView?.setTimeout(callback, delay);
      if (undefined === timer) {
        throw new Error('immersive-window-unavailable');
      }
      return () => documentRef.defaultView?.clearTimeout(timer);
    },
    subscribeResize(listener) {
      const browserWindow = documentRef.defaultView;
      if (!browserWindow) throw new Error('immersive-window-unavailable');
      browserWindow.addEventListener('resize', listener);
      browserWindow.visualViewport?.addEventListener('resize', listener);
      return () => {
        browserWindow.removeEventListener('resize', listener);
        browserWindow.visualViewport?.removeEventListener('resize', listener);
      };
    },
    observePreviewLayout(surface, listener) {
      const browserWindow = documentRef.defaultView;
      if (!browserWindow) throw new Error('immersive-window-unavailable');
      if (surface.ownerDocument !== documentRef) {
        throw new Error('immersive-preview-surface-invalid');
      }

      const cleanups: Array<() => void> = [];
      let active = true;
      const mediaCleanups = new Map<HTMLImageElement | HTMLVideoElement, () => void>();
      const observedResizeElements = new Set<Element>();
      const observeMedia = (media: HTMLImageElement | HTMLVideoElement) => {
        if (!active || mediaCleanups.has(media)) return;
        const events = 'VIDEO' === media.tagName
          ? ['load', 'error', 'loadedmetadata', 'loadeddata', 'canplay', 'resize']
          : ['load', 'error'];
        events.forEach((event) => {
          media.addEventListener(event, listener);
        });
        mediaCleanups.set(media, () => {
          events.forEach((event) => {
            media.removeEventListener(event, listener);
          });
        });
      };
      const unobserveMedia = (media: HTMLImageElement | HTMLVideoElement) => {
        mediaCleanups.get(media)?.();
        mediaCleanups.delete(media);
      };
      const resizeObserverConstructor = browserWindow.ResizeObserver;
      const resizeObserver = resizeObserverConstructor
        ? new resizeObserverConstructor(() => listener())
        : null;
      const observeResizeElement = (element: Element) => {
        if (!resizeObserver || observedResizeElements.has(element)) return;
        resizeObserver.observe(element);
        observedResizeElements.add(element);
      };
      const unobserveResizeElement = (element: Element) => {
        if (!resizeObserver || !observedResizeElements.has(element)) return;
        resizeObserver.unobserve(element);
        observedResizeElements.delete(element);
      };
      const reconcileObservedNodes = (notify: boolean) => {
        if (!active) return;
        const currentMedia = new Set(
          surface.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')
        );
        mediaCleanups.forEach((_, media) => {
          if (!currentMedia.has(media)) unobserveMedia(media);
        });
        currentMedia.forEach(observeMedia);

        const currentResizeElements = new Set<Element>([
          surface,
          ...surface.querySelectorAll<HTMLElement>('img, video, svg, foreignObject')
        ]);
        observedResizeElements.forEach((element) => {
          if (!currentResizeElements.has(element)) {
            unobserveResizeElement(element);
          }
        });
        currentResizeElements.forEach(observeResizeElement);
        if (notify) listener();
      };
      if (resizeObserver) {
        reconcileObservedNodes(false);
        cleanups.push(() => resizeObserver.disconnect());
      } else {
        surface
          .querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')
          .forEach(observeMedia);
      }
      cleanups.push(() => {
        mediaCleanups.forEach((cleanup) => {
          cleanup();
        });
        mediaCleanups.clear();
        observedResizeElements.clear();
      });

      const fonts = documentRef.fonts;
      if (fonts) {
        fonts.addEventListener('loadingdone', listener);
        fonts.addEventListener('loadingerror', listener);
        cleanups.push(() => {
          fonts.removeEventListener('loadingdone', listener);
          fonts.removeEventListener('loadingerror', listener);
        });
      }

      const mutationObserverConstructor = browserWindow.MutationObserver;
      const mutationObserver = mutationObserverConstructor
        ? new mutationObserverConstructor(() => reconcileObservedNodes(true))
        : null;
      if (mutationObserver) {
        mutationObserver.observe(surface, { childList: true, subtree: true });
        cleanups.push(() => mutationObserver.disconnect());
      }

      return () => {
        active = false;
        cleanups.forEach((cleanup) => {
          cleanup();
        });
      };
    },
    subscribeKeydown(listener) {
      documentRef.addEventListener('keydown', listener);
      return () => documentRef.removeEventListener('keydown', listener);
    }
  };
}
