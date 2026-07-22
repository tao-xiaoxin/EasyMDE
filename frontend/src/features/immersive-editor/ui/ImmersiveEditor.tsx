import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  Check,
  Clock3,
  Columns2,
  Eye,
  History,
  ListTree,
  Maximize,
  PenLine,
  Send,
  Table2,
  X
} from '../../../generated/lucide-icons';
import type {
  RevisionPort,
  RevisionPreview,
  RevisionSummary
} from '../../../contracts/ports/revision-port';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import { SafePreviewHtmlSink } from '../../live-preview/ui/SafePreviewHtmlSink';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import {
  extractOutline,
  getDocumentStats,
  tableMarkdown,
  type ImmersiveViewMode
} from '../immersive-editor';

export type ImmersiveStrings = Readonly<{
  cancel: string;
  characters: string;
  edit: string;
  exit: string;
  hideOutline: string;
  history: string;
  historyEmpty: string;
  historyError: string;
  historyLoading: string;
  immersive: string;
  insert: string;
  minutes: string;
  noHeadings: string;
  outline: string;
  preview: string;
  publish: string;
  readingTime: string;
  restore: string;
  restoreConfirm: string;
  saved: string;
  showOutline: string;
  split: string;
  table: string;
  tableColumns: string;
  tableRows: string;
  title: string;
  unsaved: string;
  viewModes: string;
  wechat: string;
  words: string;
}>;

type Props = Readonly<{
  documentSession: EditorDocumentSession;
  environment: ImmersiveEnvironmentPort;
  revisionPort: RevisionPort | null;
  restoreRevision: (restoreUrl: string) => void;
  styleControls: ReactNode;
  toolbar: ReactNode;
  onCopyWechat: () => void;
  onExit: () => void;
  onFailure: (code: string) => void;
  onPublish: () => void;
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
      label={strings.table}
      onClose={onClose}
    >
      <h2>
        <Table2 size={18} />
        {strings.table}
      </h2>
      <p className="easymde-immersive-table-size">
        {activeRows} × {activeColumns}
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
            max="12"
            value={columns}
            onChange={(event) =>
              setColumns(
                Math.max(1, Math.min(12, Number(event.target.value) || 1))
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
          {strings.insert}
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
  const surfaceRef = useRef<HTMLElement>(null);

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
    restoreRevision(selected.restoreUrl);
  };

  return (
    <Modal
      closeLabel={strings.cancel}
      environment={environment}
      label={strings.history}
      onClose={onClose}
    >
      <h2>
        <History size={18} />
        {strings.history}
      </h2>
      <div className="easymde-immersive-history-body">
        <div className="easymde-immersive-history-list">
          {failed ? <p role="alert">{strings.historyError}</p> : null}
          {!failed && null === items ? (
            <p role="status">{strings.historyLoading}</p>
          ) : null}
          {items && !items.length ? <p>{strings.historyEmpty}</p> : null}
          {items?.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected?.id === item.id ? 'is-selected' : ''}
              onClick={() => setSelected(item)}
            >
              <Clock3 size={14} />
              <span>{item.dateLabel}</span>
            </button>
          ))}
        </div>
        <div className="easymde-immersive-history-preview">
          {preview ? (
            <SafePreviewHtmlSink
              className="easymde-preview easymde-immersive-revision-preview"
              html={preview.html}
              surfaceRef={surfaceRef}
            />
          ) : null}
        </div>
      </div>
      <div className="easymde-immersive-modal-actions">
        {confirming ? <p role="alert">{strings.restoreConfirm}</p> : null}
        <button type="button" onClick={onClose}>
          {strings.cancel}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!selected}
          onClick={restore}
        >
          {strings.restore}
        </button>
      </div>
    </Modal>
  );
}

export function ImmersiveEditor({
  documentSession,
  environment,
  revisionPort,
  restoreRevision,
  styleControls,
  toolbar,
  onCopyWechat,
  onExit,
  onFailure,
  onPublish,
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
  const [mode, setMode] = useState<ImmersiveViewMode>('source');
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [activeOutline, setActiveOutline] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
      else onExit();
    };
    return environment.subscribeKeydown(handleKeyDown);
  }, [environment, historyOpen, onExit, tableOpen]);

  const stats = useMemo(() => getDocumentStats(markdown), [markdown]);
  const outline = useMemo(() => extractOutline(markdown), [markdown]);
  const changeMode = (next: ImmersiveViewMode) => {
    setMode(next);
    onViewModeChange(next);
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
      <header className="easymde-immersive-header">
        <div className="easymde-immersive-brand">
          <span className="easymde-traffic-light is-red" />
          <span className="easymde-traffic-light is-yellow" />
          <span className="easymde-traffic-light is-green" />
          <PenLine size={15} strokeWidth={2.5} />
          <span className="easymde-immersive-brand-name">EasyMDE</span>
          <span
            className="easymde-immersive-brand-divider"
            aria-hidden="true"
          />
        </div>
        <div className="easymde-immersive-title-wrap">
          <input
            value={title}
            onChange={(event) => changeTitle(event.target.value)}
            aria-label={strings.title}
            placeholder={`${strings.title}…`}
          />
          <span
          className={`easymde-immersive-save-state${dirty ? ' is-dirty' : ''}`}
        >
          <Check size={13} />
          <span>{dirty ? strings.unsaved : strings.saved}</span>
          </span>
          <span className="easymde-immersive-stats">
            {stats.words} {strings.words}&nbsp;&nbsp; {stats.characters}{' '}
            {strings.characters}&nbsp;&nbsp; {strings.readingTime}{' '}
            {stats.minutes} {strings.minutes}
          </span>
        </div>
        <div className="easymde-immersive-header-actions">
          <fieldset className="easymde-immersive-view-switch">
            <legend className="screen-reader-text">{strings.viewModes}</legend>
            {(
              [
                ['source', strings.edit, PenLine],
                ['split', strings.split, Columns2],
                ['preview', strings.preview, Eye]
              ] as const
            ).map(([value, label, ModeIcon]) => (
              <button
                key={value}
                type="button"
                className={mode === value ? 'is-active' : ''}
                aria-pressed={mode === value}
                onClick={() => changeMode(value)}
                >
                  <ModeIcon size={13} />
                  <span>{label}</span>
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="easymde-immersive-publish"
            onClick={onPublish}
            >
              <Send size={16} />
              <span>{strings.publish}</span>
          </button>
          <button
            type="button"
            className="easymde-immersive-exit"
            onClick={onExit}
            aria-label={strings.exit}
            title={strings.exit}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="easymde-immersive-toolbar-row">
        <div className="easymde-immersive-formatting">
          {toolbar}
          <span
            className="easymde-immersive-toolbar-divider"
            aria-hidden="true"
          />
          <button
            type="button"
            className="easymde-immersive-table-trigger"
            onClick={() => setTableOpen(true)}
            aria-label={strings.table}
            title={strings.table}
          >
            <Table2 size={14} />
          </button>
        </div>
        <div className="easymde-immersive-secondary-actions">
          <button
            type="button"
            onClick={onCopyWechat}
            className="easymde-immersive-wechat"
          >
            <span className="easymde-immersive-wechat-dot" />
            {strings.wechat}
          </button>
          <button
            type="button"
            disabled={!revisionPort}
            onClick={() => setHistoryOpen(true)}
          >
            <History size={14} />
            {strings.history}
          </button>
          {styleControls}
        </div>
      </div>
      {outlineOpen ? (
        <aside
          className="easymde-immersive-outline"
          aria-label={strings.outline}
        >
          <div className="easymde-immersive-outline-title">
            <ListTree size={14} />
            {strings.outline}
            <button
              type="button"
              className="easymde-immersive-outline-close"
              onClick={() => setOutlineOpen(false)}
              aria-label={strings.hideOutline}
              title={strings.hideOutline}
            >
              <X size={14} />
            </button>
          </div>
          {outline.length ? (
            outline.map((item) => (
              <button
                key={`${item.position}-${item.index}`}
                type="button"
                className={`${activeOutline === item.index ? 'is-active ' : ''}is-level-${item.level}`}
                style={{
                  paddingInlineStart: `${12 + (item.level - 1) * 14}px`
                }}
                onClick={() => {
                  setActiveOutline(item.index);
                  documentSession.document.revealPosition(item.position);
                }}
              >
                <span
                  className={`easymde-immersive-outline-dot${item.level <= 2 ? ' is-section' : ''}`}
                >
                  {item.level <= 2 ? <ListTree size={13} /> : '—'}
                </span>
                {item.text}
              </button>
            ))
          ) : (
            <p className="easymde-immersive-outline-empty">
              {strings.noHeadings}
            </p>
          )}
          <button
            type="button"
            className="easymde-immersive-outline-collapse"
            onClick={() => setOutlineOpen(false)}
          >
            <span aria-hidden="true">«</span>
            {strings.hideOutline}
          </button>
        </aside>
      ) : (
        <button
          type="button"
          className="easymde-immersive-outline-show"
          onClick={() => setOutlineOpen(true)}
        >
          <ListTree size={14} />
          {strings.showOutline}
        </button>
      )}
    </section>
  );
}

export function ImmersiveToggleIcon() {
  return <Maximize size={14} strokeWidth={2} aria-hidden="true" />;
}
