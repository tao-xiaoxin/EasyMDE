import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';

export function createBrowserImmersiveEnvironment(
  documentRef: Document
): ImmersiveEnvironmentPort {
  return {
    activeElement() {
      return documentRef.activeElement instanceof HTMLElement
        ? documentRef.activeElement
        : null;
    },
    hasOpenToolbarPopover() {
      return (
        null !==
        documentRef.querySelector('.easymde-toolbar-popover:not([hidden])')
      );
    },
    subscribeKeydown(listener) {
      documentRef.addEventListener('keydown', listener);
      return () => documentRef.removeEventListener('keydown', listener);
    }
  };
}
