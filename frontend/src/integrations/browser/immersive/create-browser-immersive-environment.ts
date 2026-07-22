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
  documentRef: Document
): ImmersiveEnvironmentPort {
  return {
    activeElement() {
      return documentRef.activeElement instanceof HTMLElement
        ? documentRef.activeElement
        : null;
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
    subscribeKeydown(listener) {
      documentRef.addEventListener('keydown', listener);
      return () => documentRef.removeEventListener('keydown', listener);
    }
  };
}
