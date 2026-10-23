import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Table, X } from '../../../generated/lucide-icons';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type { ImmersiveStrings } from '../../immersive-editor/ui/immersive-editor-ui-types';

const TABLE_DIMENSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * True when a key event belongs to an in-progress IME composition. React's
 * synthetic KeyboardEvent does not expose `isComposing`, and Safari reports
 * composition keystrokes with `keyCode` 229 instead, so both native signals
 * are read rather than a single synthetic flag.
 */
function isComposingKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const native = event.nativeEvent;
  return true === native.isComposing || 229 === native.keyCode;
}

export function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if ('Tab' !== event.key) return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const activeElement = event.currentTarget.ownerDocument.activeElement;
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function Modal({
  children,
  closeLabel,
  environment,
  label,
  onClose
}: Readonly<{
  children: ReactNode;
  closeLabel: string;
  environment: ImmersiveEnvironmentPort;
  label: string;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = environment.activeElement();
    const root = ref.current;
    // `[data-autofocus]` is the dialog's declared initial focus. Falling back
    // to the first control would otherwise land on the close button, which
    // sits earlier in document order.
    const initial =
      root?.querySelector<HTMLElement>('[data-autofocus]')
      ?? root?.querySelector<HTMLElement>('button, input');
    initial?.focus();
    return () => {
      // Confirming a table moves focus to the edited surface before this
      // dialog unmounts, so restoring the opening control afterwards would
      // steal focus back. Only a close that still owns focus - Cancel, the
      // close button, Escape - returns it, and only when that owner is still
      // connected; the context menu that opened the dialog is often gone.
      const ownerDocument = root?.ownerDocument;
      const active = ownerDocument?.activeElement ?? null;
      const focusMovedOutside = Boolean(
        active
        && ownerDocument
        && active !== ownerDocument.body
        && active !== ownerDocument.documentElement
        && !(root?.contains(active))
      );
      if (focusMovedOutside) return;
      if (previous?.isConnected) previous.focus();
    };
  }, [environment]);
  return (
    <div className="easymde-immersive-modal-backdrop">
      <div
        ref={ref}
        className="easymde-immersive-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => {
          trapFocus(event);
          if ('Escape' !== event.key || isComposingKey(event) || event.defaultPrevented) return;
          // The dialog owns Escape while it is open: the immersive host must
          // not also dismiss the surrounding mode. The effect cleanup still
          // returns focus to the opening control when it is still connected.
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <button type="button" className="easymde-immersive-modal-close" onClick={onClose} aria-label={closeLabel}>
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function EditorTableDialog({
  environment,
  strings,
  onClose,
  onInsert
}: Readonly<{
  environment: ImmersiveEnvironmentPort;
  strings: ImmersiveStrings;
  onClose: () => void;
  onInsert: (rows: number, columns: number) => void;
}>) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [hovered, setHovered] = useState<Readonly<{ rows: number; columns: number }> | null>(null);
  const activeRows = hovered?.rows ?? rows;
  const activeColumns = hovered?.columns ?? columns;
  return (
    <Modal closeLabel={strings.cancel} environment={environment} label={strings.insertTable} onClose={onClose}>
      <div className="easymde-immersive-table-title"><Table size={15} /><strong>{strings.insertTable}</strong></div>
      <div className="easymde-immersive-table-picker">
        <p className="easymde-immersive-table-size">{activeRows} {strings.line} × {activeColumns} {strings.column}</p>
        <fieldset className="easymde-immersive-table-grid" aria-label={strings.table} onMouseLeave={() => setHovered(null)}>
          {TABLE_DIMENSIONS.map((row) => TABLE_DIMENSIONS.map((column) => (
            <button
              key={`${row}-${column}`}
              type="button"
              className={row <= activeRows && column <= activeColumns ? 'is-active' : ''}
              aria-label={`${row} × ${column}`}
              onFocus={() => setHovered({ rows: row, columns: column })}
              onMouseEnter={() => setHovered({ rows: row, columns: column })}
              onClick={() => onInsert(row, column)}
            />
          )))}
        </fieldset>
      </div>
      <div className="easymde-immersive-table-inputs">
        <label>{strings.tableRows}<input data-autofocus type="number" min="1" max="20" value={rows} onChange={(event) => setRows(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
        <span aria-hidden="true">×</span>
        <label>{strings.tableColumns}<input type="number" min="1" max="20" value={columns} onChange={(event) => setColumns(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
      </div>
      <div className="easymde-immersive-modal-actions">
        <button type="button" onClick={onClose}>{strings.cancel}</button>
        <button type="button" className="is-primary" onClick={() => onInsert(rows, columns)}>{strings.insertTable}</button>
      </div>
    </Modal>
  );
}
