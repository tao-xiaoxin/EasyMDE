import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { MediaPickerFramePort } from '../../../contracts/ports/media-picker-port';
import { X } from '../../../generated/lucide-icons';

type WordPressMediaPickerDialogProps = Readonly<{
  closeLabel: string;
  frame: MediaPickerFramePort;
  label: string;
  onAttachError: (error: unknown) => void;
  onCancel: () => void;
}>;

function focusable(root: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], area[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden);
}

function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if ('Tab' !== event.key) return;
  const controls = focusable(event.currentTarget);
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = event.currentTarget.ownerDocument.activeElement;
  if (!first || !last) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function WordPressMediaPickerDialog({
  closeLabel,
  frame,
  label,
  onAttachError,
  onCancel
}: WordPressMediaPickerDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reportedErrorRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    const attachFrame = frame.attachFrame;
    if (!iframe || !attachFrame || !frame.frameUrl) {
      const error = new Error('wordpress-media-frame-unavailable');
      if (!reportedErrorRef.current) {
        reportedErrorRef.current = true;
        onAttachError(error);
      }
      return;
    }

    try {
      const detach = attachFrame(iframe);
      closeRef.current?.focus();
      return () => detach();
    } catch (error) {
      if (!reportedErrorRef.current) {
        reportedErrorRef.current = true;
        onAttachError(error);
      }
    }
    return undefined;
  }, [frame, onAttachError]);

  return (
    <div
      className="easymde-media-picker-backdrop"
      data-easymde-media-picker="1"
    >
      <div
        ref={dialogRef}
        className="easymde-media-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-busy={!loaded}
        onKeyDown={(event) => {
          trapFocus(event);
          if ('Escape' === event.key) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <header className="easymde-media-picker-header">
          <h2>{label}</h2>
          <button
            ref={closeRef}
            type="button"
            className="easymde-media-picker-close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onCancel}
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </header>
        <div className="easymde-media-picker-frame-wrap">
          <iframe
            ref={iframeRef}
            title={label}
            src={frame.frameUrl ?? 'about:blank'}
            className="easymde-media-picker-frame"
            onLoad={() => setLoaded(true)}
          />
          {!loaded ? (
            <span className="easymde-media-picker-loading" aria-hidden="true" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
