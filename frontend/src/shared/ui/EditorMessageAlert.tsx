import { createElement, useRef } from '@wordpress/element';

import { Check, X } from '../../generated/lucide-icons';

export type EditorMessageAlertType =
  | 'error'
  | 'info'
  | 'success'
  | 'warning';

export type EditorMessageAlertDensity = 'compact' | 'standard';

type Props = Readonly<{
  closeLabel: string;
  density?: EditorMessageAlertDensity;
  message: string;
  messageId?: string;
  onDismiss: () => void;
  onFocusChange?: (focused: boolean) => void;
  type: EditorMessageAlertType;
}>;

function MessageIcon({ type }: Readonly<{ type: EditorMessageAlertType }>) {
  if ('success' === type) {
    return <Check size={13} strokeWidth={3} />;
  }
  if ('error' === type) {
    return <X size={12} strokeWidth={2.5} />;
  }
  return <span>{'info' === type ? 'i' : '!'}</span>;
}

export function EditorMessageAlert({
  closeLabel,
  density = 'standard',
  message,
  messageId,
  onDismiss,
  onFocusChange,
  type
}: Props) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <div
      className={`easymde-editor-message-alert is-${type} is-${density}`}
      role={'warning' === type || 'error' === type ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <span
        className="easymde-editor-message-alert__icon"
        aria-hidden="true"
      >
        <MessageIcon type={type} />
      </span>
      <span
        id={messageId}
        className="easymde-editor-message-alert__message"
      >
        {message}
      </span>
      <button
        type="button"
        className="easymde-editor-message-alert__close"
        aria-label={closeLabel}
        title={closeLabel}
        onFocus={(event) => {
          if (!returnFocusRef.current) {
            returnFocusRef.current =
              event.relatedTarget instanceof HTMLElement
                ? event.relatedTarget
                : null;
          }
          onFocusChange?.(true);
        }}
        onBlur={() => onFocusChange?.(false)}
        onClick={() => {
          onDismiss();
          returnFocusRef.current?.focus();
        }}
      >
        <X size={21} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </div>
  );
}
