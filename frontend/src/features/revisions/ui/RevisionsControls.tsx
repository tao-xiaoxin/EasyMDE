import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { KeyboardEvent } from 'react';

import type { RevisionsBootstrap } from '../../../contracts/bootstrap/revisions-bootstrap';
import type {
  RevisionsPort,
  RevisionPreview,
  RevisionSummary,
  RevisionType
} from '../../../contracts/ports/revisions-port';
import { previewEnhancementFailureCode, type PreviewEnhancementPort } from '../../live-preview/ports/preview-enhancement-port';
import { SafePreviewHtmlSink } from '../../live-preview/ui/SafePreviewHtmlSink';

export type RevisionsControlsSession = Readonly<{ close: (restoreFocus?: boolean) => void }>;

type Filter = 'all' | RevisionType;
type PreviewState =
  | Readonly<{ kind: 'empty' | 'error' | 'loading' }>
  | Readonly<{ detail: RevisionPreview; kind: 'html'; phase: 'enhancing' | 'failed' | 'ready' }>;

type RevisionsControlsProps = Readonly<{
  bootstrap: RevisionsBootstrap;
  codeTheme: string;
  enhancementPort: PreviewEnhancementPort;
  isDirty: () => boolean;
  onDiagnostic: (code: string) => void;
  onOpen: () => void;
  onReady?: (session: RevisionsControlsSession) => void;
  port: RevisionsPort;
}>;

function failureCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^revisions-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : fallback;
}

export function RevisionsControls({
  bootstrap,
  codeTheme,
  enhancementPort,
  isDirty,
  onDiagnostic,
  onOpen,
  onReady,
  port
}: RevisionsControlsProps) {
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const activeRef = useRef(true);
  const listGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ReadonlyArray<RevisionSummary>>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [listState, setListState] = useState<'empty' | 'error' | 'loading' | 'ready'>('empty');
  const [selectedId, setSelectedId] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'empty' });

  const abortRequests = useCallback(() => {
    listGenerationRef.current += 1;
    detailGenerationRef.current += 1;
    listControllerRef.current?.abort();
    detailControllerRef.current?.abort();
    listControllerRef.current = null;
    detailControllerRef.current = null;
  }, []);

  const close = useCallback((restoreFocus = true) => {
    abortRequests();
    setOpen(false);
    setEntries([]);
    setSelectedId(0);
    setPreview({ kind: 'empty' });
    if (restoreFocus) openerRef.current?.focus();
  }, [abortRequests]);

  useEffect(() => {
    activeRef.current = true;
    onReady?.({ close });
    return () => {
      activeRef.current = false;
      abortRequests();
    };
  }, [abortRequests, close, onReady]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const loadPreview = useCallback((entry: RevisionSummary) => {
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++detailGenerationRef.current;
    detailControllerRef.current = controller;
    setSelectedId(entry.id);
    setPreview({ kind: 'loading' });
    void port.getRevision(entry.id, controller.signal).then(
      (detail) => {
        if (!activeRef.current || controller.signal.aborted || generation !== detailGenerationRef.current || detail.id !== entry.id) return;
        setPreview({ detail, kind: 'html', phase: 'enhancing' });
      },
      (error) => {
        if (!activeRef.current || controller.signal.aborted || generation !== detailGenerationRef.current) return;
        setPreview({ kind: 'error' });
        onDiagnostic(failureCode(error, 'revisions-preview-failed'));
      }
    );
  }, [onDiagnostic, port]);

  const openDialog = () => {
    if (!bootstrap.enabled) return;
    abortRequests();
    const controller = new AbortController();
    const generation = ++listGenerationRef.current;
    listControllerRef.current = controller;
    setOpen(true);
    setFilter('all');
    setEntries([]);
    setSelectedId(0);
    setListState('loading');
    setPreview({ kind: 'loading' });
    onOpen();
    void port.listRevisions(controller.signal).then(
      (revisions) => {
        if (!activeRef.current || controller.signal.aborted || generation !== listGenerationRef.current) return;
        setEntries(revisions);
        setListState(revisions.length ? 'ready' : 'empty');
        if (revisions[0]) loadPreview(revisions[0]);
        else setPreview({ kind: 'empty' });
      },
      (error) => {
        if (!activeRef.current || controller.signal.aborted || generation !== listGenerationRef.current) return;
        setListState('error');
        setPreview({ kind: 'error' });
        onDiagnostic(failureCode(error, 'revisions-list-failed'));
      }
    );
  };

  useLayoutEffect(() => {
    if ('html' !== preview.kind || 'enhancing' !== preview.phase) return;
    const surface = surfaceRef.current;
    if (!surface) throw new Error('revisions-preview-surface-missing');
    const revisionId = preview.detail.id;
    const controller = new AbortController();
    let active = true;
    void enhancementPort.enhance(
      surface,
      preview.detail.features,
      () => active && selectedId === revisionId,
      { codeTheme, signal: controller.signal }
    ).then(
      () => {
        if (!active || selectedId !== revisionId) return;
        setPreview((current) => 'html' === current.kind && current.detail.id === revisionId
          ? { ...current, phase: 'ready' }
          : current);
      },
      (error) => {
        if (!active || selectedId !== revisionId) return;
        setPreview((current) => 'html' === current.kind && current.detail.id === revisionId
          ? { ...current, phase: 'failed' }
          : current);
        onDiagnostic(previewEnhancementFailureCode(error));
      }
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [codeTheme, enhancementPort, onDiagnostic, preview, selectedId]);

  const filtered = useMemo(
    () => entries.filter((entry) => 'all' === filter || entry.type === filter),
    [entries, filter]
  );
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  const changeFilter = (next: Filter) => {
    setFilter(next);
    const nextEntries = entries.filter((entry) => 'all' === next || entry.type === next);
    if (nextEntries[0] && !nextEntries.some((entry) => entry.id === selectedId)) loadPreview(nextEntries[0]);
    if (!nextEntries.length) {
      detailControllerRef.current?.abort();
      detailGenerationRef.current += 1;
      setSelectedId(0);
      setPreview({ kind: 'empty' });
    }
  };

  const handleEntryKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    entryIndex: number
  ) => {
    let nextIndex: number;
    if ('ArrowDown' === event.key) nextIndex = (entryIndex + 1) % filtered.length;
    else if ('ArrowUp' === event.key) nextIndex = (entryIndex - 1 + filtered.length) % filtered.length;
    else if ('Home' === event.key) nextIndex = 0;
    else if ('End' === event.key) nextIndex = filtered.length - 1;
    else return;
    const entry = filtered[nextIndex];
    if (!entry) return;
    event.preventDefault();
    loadPreview(entry);
    dialogRef.current?.querySelector<HTMLElement>(`[data-revision-id="${entry.id}"]`)?.focus();
  };

  const restore = () => {
    if (!selected || 'html' !== preview.kind || 'ready' !== preview.phase) return;
    try {
      if (isDirty() && !port.confirmNavigation()) return;
      port.openRevision(selected.id);
    } catch (error) {
      onDiagnostic(failureCode(error, 'revisions-navigation-failed'));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ('Escape' === event.key) {
      event.preventDefault();
      close();
      return;
    }
    if ('Tab' !== event.key) return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), [href]'
    ) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const count = bootstrap.strings.count.replace('%d', String(filtered.length));
  return (
    <div className="easymde-revisions-owner">
      <button
        ref={openerRef}
        type="button"
        className="button easymde-revisions-open"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!bootstrap.enabled}
        onClick={openDialog}
      >
        {bootstrap.strings.open}
      </button>
      {open ? (
        <div className="easymde-revisions-backdrop">
          <section
            ref={dialogRef}
            className="easymde-revisions-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="easymde-revisions-title"
            onKeyDown={handleKeyDown}
          >
            <aside className="easymde-revisions-sidebar">
              <header>
                <div>
                  <h2 id="easymde-revisions-title">{bootstrap.strings.title}</h2>
                  <small>{bootstrap.strings.help}</small>
                </div>
                <button ref={closeRef} type="button" aria-label={bootstrap.strings.close} onClick={() => close()}>
                  <span className="dashicons dashicons-no-alt" aria-hidden="true" />
                </button>
              </header>
              <div className="easymde-revisions-summary">
                <span>{count}</span>
                <select aria-label={bootstrap.strings.filterAll} value={filter} onChange={(event) => changeFilter(event.currentTarget.value as Filter)}>
                  <option value="all">{bootstrap.strings.filterAll}</option>
                  <option value="auto">{bootstrap.strings.autoSave}</option>
                  <option value="manual">{bootstrap.strings.manualSave}</option>
                </select>
              </div>
              <div className="easymde-revisions-list" role="listbox" aria-label={bootstrap.strings.title} aria-busy={'loading' === listState}>
                {'loading' === listState ? <p role="status">{bootstrap.strings.loading}</p>
                  : 'error' === listState ? <p role="alert">{bootstrap.strings.failed}</p>
                  : !filtered.length ? <p>{bootstrap.strings.noRevisions}</p>
                  : filtered.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={selectedId === entry.id}
                      className={selectedId === entry.id ? 'is-active' : undefined}
                      data-revision-id={entry.id}
                      onClick={() => loadPreview(entry)}
                      onKeyDown={(event) => handleEntryKeyDown(event, index)}
                    >
                      <strong>{entry.title || bootstrap.strings.untitled}</strong>
                      <span>{'auto' === entry.type ? bootstrap.strings.autoSave : bootstrap.strings.manualSave}</span>
                      <time dateTime={entry.date}>{entry.dateLabel}</time>
                    </button>
                  ))}
              </div>
            </aside>
            <div className="easymde-revisions-detail">
              <header>
                <div>
                  <strong>{selected?.title || bootstrap.strings.title}</strong>
                  {selected ? <time dateTime={selected.date}>{selected.dateLabel}</time> : null}
                </div>
                <button type="button" className="button button-primary" disabled={'html' !== preview.kind || 'ready' !== preview.phase} onClick={restore}>
                  {bootstrap.strings.restore}
                </button>
              </header>
              <div className="easymde-revisions-preview">
                {'html' === preview.kind ? (
                  <SafePreviewHtmlSink
                    ariaBusy={'enhancing' === preview.phase}
                    className="easymde-preview-content"
                    error={'failed' === preview.phase}
                    html={preview.detail.html}
                    surfaceRef={surfaceRef}
                  />
                ) : (
                  <p role={'error' === preview.kind ? 'alert' : 'status'}>
                    {'loading' === preview.kind ? bootstrap.strings.loadingPreview
                      : 'error' === preview.kind ? bootstrap.strings.previewFailed
                      : bootstrap.strings.noRevisions}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
