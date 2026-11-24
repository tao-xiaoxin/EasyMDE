import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type { ImmersiveI18nPort } from '../../../contracts/ports/immersive-i18n-port';
import type {
  RevisionPort,
  RevisionPreview,
  RevisionSummary
} from '../../../contracts/ports/revision-port';
import {
  ChevronDown,
  Clock,
  Info,
  RotateCcw,
  Save,
  X
} from '../../../generated/lucide-icons';
import { trapFocus } from '../../editor-context-menu/ui/EditorTableDialog';
import { SafePreviewHtmlSink } from '../../live-preview/ui/SafePreviewHtmlSink';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

/** Revision history modal for the immersive editor; WordPress owns restore. */
export function ImmersiveHistoryDialog({
  dirty,
  environment,
  i18n,
  onFailure,
  port,
  restoreRevision,
  strings,
  onClose
}: Readonly<{
  dirty: boolean;
  environment: ImmersiveEnvironmentPort;
  i18n: ImmersiveI18nPort;
  onFailure: (code: string) => void;
  port: RevisionPort;
  restoreRevision: (url: string) => void;
  strings: ImmersiveStrings;
  onClose: () => void;
}>) {
  const [items, setItems] = useState<ReadonlyArray<RevisionSummary> | null>(
    null
  );
  const [selected, setSelected] = useState<RevisionSummary | null>(null);
  const [preview, setPreview] = useState<RevisionPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'auto' | 'manual'>('all');
  const surfaceRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    const previous = environment.activeElement();
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus();
  }, [environment]);

  useEffect(() => {
    const controller = new AbortController();
    void port
      .list(controller.signal)
      .then((revisions) => {
        setItems(revisions);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          onFailure('revision-list-failed');
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [onFailure, port]);

  useEffect(() => {
    if (null === items) return;

    const nextItems = items.filter(
      (item) => 'all' === filter || item.type === filter
    );
    setSelected((current) => {
      const retained = current
        ? nextItems.find((item) => item.id === current.id)
        : undefined;
      return retained ?? nextItems[0] ?? null;
    });
  }, [filter, items]);

  useEffect(() => {
    const requestId = ++previewRequestRef.current;
    if (!selected) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    setPreview(null);
    setConfirming(false);
    void port
      .get(selected.id, controller.signal)
      .then((result) => {
        if (
          !controller.signal.aborted &&
          requestId === previewRequestRef.current
        ) {
          setPreview(result);
        }
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          requestId === previewRequestRef.current
        ) {
          onFailure('revision-preview-failed');
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [onFailure, port, selected]);

  const restore = () => {
    if (!selected) return;
    if (dirty && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      setRestoreFailed(false);
      restoreRevision(selected.restoreUrl);
    } catch {
      onFailure('revision-restore-failed');
      setRestoreFailed(true);
    }
  };

  const filteredItems = items?.filter(
    (item) => 'all' === filter || item.type === filter
  );
  const changeFilter = (nextFilter: typeof filter) => {
    setFilter(nextFilter);
  };
  const selectedLabel =
    'manual' === selected?.type ? strings.manualSave : strings.autoSave;
  const filteredCount = filteredItems?.length ?? 0;
  const historyCount = i18n.revisions(filteredCount);

  return (
    <div className="easymde-history-backdrop">
      <button type="button" className="easymde-history-backdrop-dismiss" tabIndex={-1} aria-label={strings.cancel} onClick={onClose} />
      <div
        ref={dialogRef}
        className="easymde-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={strings.historyVersions}
        onKeyDown={(event) => {
          trapFocus(event);
          if ('Escape' === event.key) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <aside className="easymde-history-sidebar">
          <header>
            <span>{strings.historyVersions}<Info size={13} strokeWidth={2} /></span>
            <button type="button" aria-label={strings.cancel} onClick={onClose}><X size={14} /></button>
          </header>
          <div className="easymde-history-filter">
            <span>{historyCount}</span>
            <label>
              <select value={filter} aria-label={strings.historyAll} onChange={(event) => changeFilter(event.currentTarget.value as typeof filter)}>
                <option value="all">{strings.historyAll}</option>
                <option value="auto">{strings.autoSave}</option>
                <option value="manual">{strings.manualSave}</option>
              </select>
              <ChevronDown size={10} strokeWidth={2.5} />
            </label>
          </div>
          <div className="easymde-history-rule" />
          <div className="easymde-history-list">
            {failed ? <p role="alert">{strings.historyError}</p> : null}
            {!failed && null === items ? <p role="status">{strings.historyLoading}</p> : null}
            {items && !items.length ? <p>{strings.historyEmpty}</p> : null}
            {filteredItems?.map((item) => {
              const manual = 'manual' === item.type;
              return (
                <button key={item.id} type="button" className={selected?.id === item.id ? 'is-selected' : ''} onClick={() => setSelected(item)}>
                  <span>{manual ? <Save size={11} strokeWidth={2.5} /> : <Clock size={11} strokeWidth={2} />}<strong>{manual ? strings.manualSave : strings.autoSave}</strong></span>
                  <time dateTime={item.date}>{item.dateLabel}</time>
                </button>
              );
            })}
          </div>
        </aside>
        <section className="easymde-history-content">
          <header>
            <div><strong>{selectedLabel}</strong><time dateTime={selected?.date}>{selected?.dateLabel}</time></div>
            <button type="button" disabled={!selected} onClick={restore}><RotateCcw size={12} strokeWidth={2.5} />{strings.restoreThisVersion}</button>
          </header>
          {confirming ? <p className="easymde-history-confirm" role="alert">{strings.restoreConfirm}</p> : null}
          {restoreFailed ? <p className="easymde-history-confirm" role="alert">{strings.historyError}</p> : null}
          <div className="easymde-immersive-history-preview">
            {preview ? <SafePreviewHtmlSink className="easymde-preview easymde-immersive-revision-preview" html={preview.html} surfaceRef={surfaceRef} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
