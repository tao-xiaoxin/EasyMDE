import { useEffect } from '@wordpress/element';

type ElementRef<T extends HTMLElement> = Readonly<{
  current: T | null;
}>;

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function formatSinglePlaceholder(template: string, value: string): string {
  return template.replace('%s', () => value);
}

export function useDialogFocusTrap(
  dialogRef: ElementRef<HTMLElement>,
  initialFocusRef: ElementRef<HTMLElement>
): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    const initialFocus = initialFocusRef.current;
    if (!dialog || !initialFocus) throw new Error('settings-center-dialog-focus-missing');
    const ownerDocument = dialog.ownerDocument;

    const focusableElements = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const activeElement = ownerDocument.activeElement;
      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    initialFocus.focus();
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [dialogRef, initialFocusRef]);
}
