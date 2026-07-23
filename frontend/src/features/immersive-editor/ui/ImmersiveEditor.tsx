import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type {
  NativeFeaturedImage,
  NativePublishDraft,
  NativePublishSnapshot
} from '../../../contracts/ports/native-publish-port';
import {
  ChevronDown,
  Clock,
  Info,
  RotateCcw,
  Save,
  Table,
  X
} from '../../../generated/lucide-icons';
import type {
  RevisionPort,
  RevisionPreview,
  RevisionSummary
} from '../../../contracts/ports/revision-port';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type {
  ImmersivePreferences,
  ImmersivePreferencesPort
} from '../../../contracts/ports/immersive-preferences-port';
import { SafePreviewHtmlSink } from '../../live-preview/ui/SafePreviewHtmlSink';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import {
  extractOutline,
  getDocumentStats,
  tableMarkdown,
  type ImmersiveViewMode
} from '../immersive-editor';
import { ImmersiveHeader } from './ImmersiveHeader';
import { ImmersiveOutline } from './ImmersiveOutline';
import { ImmersivePublishDialog } from './ImmersivePublishDialog';
import { ImmersiveToolbar } from './ImmersiveToolbar';
import type {
  ImmersiveSettings,
  ImmersiveStrings
} from './immersive-editor-ui-types';

export type { ImmersiveStrings } from './immersive-editor-ui-types';

type Props = Readonly<{
  documentSession: EditorDocumentSession;
  environment: ImmersiveEnvironmentPort;
  immersivePreferencesPort: ImmersivePreferencesPort;
  initialPreferences?: ImmersivePreferences | null;
  revisionPort: RevisionPort | null;
  restoreRevision: (restoreUrl: string) => void;
  styleControls: ReactNode;
  toolbar: ReactNode;
  onCopyWechat: () => Promise<boolean>;
  onExit: () => void;
  onFailure: (code: string) => void;
  localDraftsEnabled: boolean;
  mode: ImmersiveViewMode;
  scrollSyncEnabled: boolean;
  onLocalDraftsEnabledChange: (enabled: boolean) => void;
  readPublishSnapshot: () => NativePublishSnapshot;
  onConfirmPublish: (
    draft: NativePublishDraft,
    original: NativePublishSnapshot
  ) => boolean;
  onSelectFeaturedImage: () => Promise<NativeFeaturedImage | null>;
  onScrollSyncEnabledChange: (enabled: boolean) => void;
  onViewModeChange: (mode: ImmersiveViewMode) => void;
  strings: ImmersiveStrings;
}>;

const TABLE_DIMENSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if ('Tab' !== event.key) return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden);
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
    ref.current
      ?.querySelector<HTMLElement>('[data-autofocus], button, input')
      ?.focus();
    return () => previous?.focus();
  }, [environment]);
  return (
    <div className="easymde-immersive-modal-backdrop">
      <div
        ref={ref}
        className="easymde-immersive-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={trapFocus}
      >
        <button
          type="button"
          className="easymde-immersive-modal-close"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

function TableDialog({
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
  const [hovered, setHovered] = useState<Readonly<{
    rows: number;
    columns: number;
  }> | null>(null);
  const activeRows = hovered?.rows ?? rows;
  const activeColumns = hovered?.columns ?? columns;
  return (
    <Modal
      closeLabel={strings.cancel}
      environment={environment}
      label={strings.insertTable}
      onClose={onClose}
    >
      <div className="easymde-immersive-table-title">
        <Table size={15} />
        <strong>{strings.insertTable}</strong>
      </div>
      <div className="easymde-immersive-table-picker">
        <p className="easymde-immersive-table-size">
          {activeRows} {strings.line} × {activeColumns} {strings.column}
        </p>
        <fieldset
          className="easymde-immersive-table-grid"
          aria-label={strings.table}
          onMouseLeave={() => setHovered(null)}
        >
          {TABLE_DIMENSIONS.map((row) =>
            TABLE_DIMENSIONS.map((column) => (
              <button
                key={`${row}-${column}`}
                type="button"
                className={
                  row <= activeRows && column <= activeColumns ? 'is-active' : ''
                }
                aria-label={`${row} × ${column}`}
                onFocus={() => setHovered({ rows: row, columns: column })}
                onMouseEnter={() => setHovered({ rows: row, columns: column })}
                onClick={() => onInsert(row, column)}
              />
            ))
          )}
        </fieldset>
      </div>
      <div className="easymde-immersive-table-inputs">
        <label>
          {strings.tableRows}
          <input
            data-autofocus
            type="number"
            min="1"
            max="20"
            value={rows}
            onChange={(event) =>
              setRows(
                Math.max(1, Math.min(20, Number(event.target.value) || 1))
              )
            }
          />
        </label>
        <span aria-hidden="true">×</span>
        <label>
          {strings.tableColumns}
          <input
            type="number"
            min="1"
            max="20"
            value={columns}
            onChange={(event) =>
              setColumns(
                Math.max(1, Math.min(20, Number(event.target.value) || 1))
              )
            }
          />
        </label>
      </div>
      <div className="easymde-immersive-modal-actions">
        <button type="button" onClick={onClose}>
          {strings.cancel}
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => onInsert(rows, columns)}
        >
          {strings.insertTable}
        </button>
      </div>
    </Modal>
  );
}

function HistoryDialog({
  dirty,
  environment,
  onFailure,
  port,
  restoreRevision,
  strings,
  onClose
}: Readonly<{
  dirty: boolean;
  environment: ImmersiveEnvironmentPort;
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
        setSelected(revisions[0] ?? null);
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
    if (!selected) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    setPreview(null);
    setConfirming(false);
    void port
      .get(selected.id, controller.signal)
      .then(setPreview)
      .catch(() => {
        if (!controller.signal.aborted) {
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
  const selectedLabel =
    'manual' === selected?.type ? strings.manualSave : strings.autoSave;
  const filteredCount = filteredItems?.length ?? 0;
  const historyCount =
    1 === filteredCount
      ? strings.historyCountSingular
      : strings.historyCount.replace('%s', String(filteredCount));

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
              <select value={filter} aria-label={strings.historyAll} onChange={(event) => setFilter(event.currentTarget.value as typeof filter)}>
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

export function ImmersiveEditor({
  documentSession,
  environment,
  immersivePreferencesPort,
  initialPreferences = null,
  revisionPort,
  restoreRevision,
  styleControls,
  toolbar,
  localDraftsEnabled,
  mode,
  scrollSyncEnabled,
  onCopyWechat,
  onExit,
  onFailure,
  onLocalDraftsEnabledChange,
  readPublishSnapshot,
  onConfirmPublish,
  onSelectFeaturedImage,
  onScrollSyncEnabledChange,
  onViewModeChange,
  strings
}: Props) {
  const [markdown, setMarkdown] = useState(() =>
    documentSession.document.getValue()
  );
  const [title, setTitle] = useState(
    () => documentSession.title.getSnapshot().value
  );
  const [dirty, setDirty] = useState(() => documentSession.getSnapshot().dirty);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [activeOutline, setActiveOutline] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [wechatCopied, setWechatCopied] = useState(false);
  const [publishSnapshot, setPublishSnapshot] =
    useState<NativePublishSnapshot | null>(null);
  const [initialSettings] = useState<ImmersiveSettings>(() => ({
    autoSave: localDraftsEnabled,
    outline: true,
    splitPreview: true,
    syncScroll: scrollSyncEnabled,
    wordCount: true,
    ...(initialPreferences ?? {})
  }));
  const [settings, setSettings] = useState(initialSettings);
  const restoredOwnerSettingsRef = useRef(false);

  useEffect(() => {
    if (!wechatCopied) return undefined;
    return environment.schedule(() => setWechatCopied(false), 2000);
  }, [environment, wechatCopied]);

  useEffect(() => {
    if (restoredOwnerSettingsRef.current) return;
    restoredOwnerSettingsRef.current = true;
    if (initialSettings.autoSave !== localDraftsEnabled) {
      onLocalDraftsEnabledChange(initialSettings.autoSave);
    }
    if (initialSettings.syncScroll !== scrollSyncEnabled) {
      onScrollSyncEnabledChange(initialSettings.syncScroll);
    }
  }, [
    initialSettings,
    localDraftsEnabled,
    onLocalDraftsEnabledChange,
    onScrollSyncEnabledChange,
    scrollSyncEnabled
  ]);

  useEffect(
    () =>
      documentSession.document.subscribe(() =>
        setMarkdown(documentSession.document.getValue())
      ),
    [documentSession]
  );
  useEffect(
    () =>
      documentSession.subscribe(() =>
        setDirty(documentSession.getSnapshot().dirty)
      ),
    [documentSession]
  );
  useEffect(
    () =>
      documentSession.title.subscribe(() =>
        setTitle(documentSession.title.getSnapshot().value)
      ),
    [documentSession]
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ('Escape' !== event.key || event.isComposing) return;
      if (environment.hasOpenToolbarPopover()) return;
      event.preventDefault();
      if (tableOpen) setTableOpen(false);
      else if (historyOpen) setHistoryOpen(false);
      else if (publishSnapshot) setPublishSnapshot(null);
      else onExit();
    };
    return environment.subscribeKeydown(handleKeyDown);
  }, [environment, historyOpen, onExit, publishSnapshot, tableOpen]);

  const stats = useMemo(() => getDocumentStats(markdown), [markdown]);
  const outline = useMemo(() => extractOutline(markdown), [markdown]);
  const changeMode = (next: ImmersiveViewMode) => {
    onViewModeChange(next);
  };
  const changeSettings = (next: ImmersiveSettings) => {
    setSettings(next);
    const result = immersivePreferencesPort.write(next);
    if ('unavailable' === result.status) onFailure(result.code);
    if (next.autoSave !== settings.autoSave) {
      onLocalDraftsEnabledChange(next.autoSave);
    }
    if (next.syncScroll !== settings.syncScroll) {
      onScrollSyncEnabledChange(next.syncScroll);
    }
    if (!next.splitPreview && 'split' === mode) {
      changeMode('source');
    }
  };
  const changeTitle = (value: string) => {
    setTitle(value);
    documentSession.title.setValue(value);
  };
  const insertTable = (rows: number, columns: number) => {
    const snapshot = {
      selection: documentSession.document.getSelection(),
      value: documentSession.document.getValue()
    };
    const markdownTable = tableMarkdown(rows, columns);
    const start = snapshot.selection.start;
    const end = snapshot.selection.end;
    const value =
      snapshot.value.slice(0, start) +
      markdownTable +
      snapshot.value.slice(end);
    const caret = start + markdownTable.length;
    documentSession.document.applyTextChange({
      value,
      selection: { direction: 'none', start: caret, end: caret }
    });
    setTableOpen(false);
    documentSession.document.focus();
  };
  const copyWechat = () => {
    void onCopyWechat().then((success) => {
      if (success) setWechatCopied(true);
    });
  };

  return (
    <section
      className={`easymde-immersive-shell is-${mode}`}
      aria-label={strings.immersive}
    >
      {tableOpen ? (
        <TableDialog
          environment={environment}
          strings={strings}
          onClose={() => setTableOpen(false)}
          onInsert={insertTable}
        />
      ) : null}
      {historyOpen && revisionPort ? (
        <HistoryDialog
          dirty={dirty}
          environment={environment}
          onFailure={onFailure}
          port={revisionPort}
          restoreRevision={restoreRevision}
          strings={strings}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {publishSnapshot ? (
        <ImmersivePublishDialog
          environment={environment}
          snapshot={publishSnapshot}
          strings={strings}
          onClose={() => setPublishSnapshot(null)}
          onConfirm={onConfirmPublish}
          onSelectFeaturedImage={onSelectFeaturedImage}
        />
      ) : null}
      <ImmersiveHeader
        dirty={dirty}
        mode={mode}
        showStats={settings.wordCount}
        stats={stats}
        strings={strings}
        title={title}
        onModeChange={changeMode}
        onPublish={() => setPublishSnapshot(readPublishSnapshot())}
        onTitleChange={changeTitle}
      />
      <ImmersiveToolbar
        historyAvailable={null !== revisionPort}
        mode={mode}
        settings={settings}
        strings={strings}
        styleControls={styleControls}
        toolbar={toolbar}
        wechatCopied={wechatCopied}
        onCopyWechat={copyWechat}
        onExit={onExit}
        onHistory={() => setHistoryOpen(true)}
        onModeChange={changeMode}
        onSettingsChange={changeSettings}
        onTable={() => setTableOpen(true)}
      />
      {settings.outline ? (
        <ImmersiveOutline
          activeIndex={activeOutline}
          items={outline}
          open={outlineOpen}
          strings={strings}
          onOpenChange={setOutlineOpen}
          onSelect={(item) => {
            setActiveOutline(item.index);
            documentSession.document.revealPosition(item.position);
          }}
        />
      ) : null}
    </section>
  );
}

export function ImmersiveToggleIcon() {
  return (
    <span
      className="dashicons dashicons-fullscreen-alt"
      aria-hidden="true"
    />
  );
}
