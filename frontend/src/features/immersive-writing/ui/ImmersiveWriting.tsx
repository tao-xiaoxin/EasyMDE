import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from '@wordpress/element';
import {
  Bold,
  Code,
  Code2,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minimize2,
  Quote,
  Strikethrough,
  Table,
  X
} from 'lucide-react';

import type { ImmersiveWritingBootstrap } from '../../../contracts/bootstrap/immersive-writing-bootstrap';
import type { ToolbarBootstrap } from '../../../contracts/bootstrap/toolbar-bootstrap';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import {
  calculateWritingStatistics,
  insertTableAtSelection,
  tableMarkdown
} from '../immersive-writing';

type ImmersiveWritingProps = Readonly<{
  bootstrap: ImmersiveWritingBootstrap;
  documentSession: EditorDocumentSession;
  executeCommand: (commandId: string) => void;
  onExit: () => void;
  toolbar: ToolbarBootstrap;
}>;

const COMMANDS = [
  ['bold', Bold, 2.5],
  ['italic', Italic, 2.5],
  ['strike', Strikethrough, 2],
  ['quote', Quote, 2],
  ['unorderedlist', List, 2],
  ['orderedlist', ListOrdered, 2],
  ['inlinecode', Code, 2],
  ['codefence', Code2, 2],
  ['link', Link2, 2],
  ['image', Image, 2]
] as const;

const GROUP_STARTS = new Set([3, 6, 8]);
const TABLE_GRID_COORDINATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden && null !== element.offsetParent);
}

type TableDialogProps = Readonly<{
  bootstrap: ImmersiveWritingBootstrap;
  onClose: () => void;
  onInsert: (rows: number, columns: number) => void;
}>;

function TableDialog({ bootstrap, onClose, onInsert }: TableDialogProps) {
  const { strings } = bootstrap;
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [hovered, setHovered] = useState<Readonly<{ columns: number; rows: number }> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    closeRef.current?.focus();
  }, []);

  const activeRows = hovered?.rows ?? rows;
  const activeColumns = hovered?.columns ?? columns;

  return (
    <div className="easymde-immersive-table-backdrop">
      <button
        type="button"
        className="easymde-immersive-table-dismiss"
        aria-label={strings.cancel}
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={(event) => {
          if ('Enter' === event.key || ' ' === event.key) {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div
        ref={dialogRef}
        className="easymde-immersive-table-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="easymde-immersive-table-title"
        onKeyDown={(event) => {
          if ('Tab' !== event.key || !dialogRef.current) return;
          const focusable = focusableElements(dialogRef.current);
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="easymde-immersive-table-header">
          <span className="easymde-immersive-table-title" id="easymde-immersive-table-title">
            <Table size={15} aria-hidden="true" />
            {strings.insertTable}
          </span>
          <button ref={closeRef} type="button" aria-label={strings.cancel} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="easymde-immersive-table-grid-section">
          <p>{strings.tableSize.replace('%1$s', String(activeRows)).replace('%2$s', String(activeColumns))}</p>
          <div className="easymde-immersive-table-grid">
            {TABLE_GRID_COORDINATES.map((row) => (
              <div key={`table-row-${row}`} className="easymde-immersive-table-grid-row">
                {TABLE_GRID_COORDINATES.map((column) => {
                  const selected = row <= activeRows && column <= activeColumns;
                  return (
                    <button
                      key={`table-cell-${row}-${column}`}
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      aria-label={strings.tableSize.replace('%1$s', String(row)).replace('%2$s', String(column))}
                      onMouseEnter={() => setHovered({ columns: column, rows: row })}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => onInsert(row, column)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="easymde-immersive-table-fields">
          <label>
            <span>{strings.rows}</span>
            <input type="number" min="1" max="20" value={rows} onChange={(event) => setRows(Math.max(1, Math.min(20, Number(event.currentTarget.value) || 1)))} />
          </label>
          <span aria-hidden="true">×</span>
          <label>
            <span>{strings.columns}</span>
            <input type="number" min="1" max="20" value={columns} onChange={(event) => setColumns(Math.max(1, Math.min(20, Number(event.currentTarget.value) || 1)))} />
          </label>
        </div>
        <footer className="easymde-immersive-table-footer">
          <button type="button" onClick={onClose}>{strings.cancel}</button>
          <button type="button" className="is-primary" onClick={() => onInsert(rows, columns)}>{strings.insertTable}</button>
        </footer>
      </div>
    </div>
  );
}

export function ImmersiveWriting({
  bootstrap,
  documentSession,
  executeCommand,
  onExit,
  toolbar
}: ImmersiveWritingProps) {
  const { strings } = bootstrap;
  const overlayRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const tableSelectionRef = useRef(documentSession.document.getSelection());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const documentSnapshot = useSyncExternalStore(
    documentSession.document.subscribe,
    documentSession.document.getSnapshot
  );
  const titleSnapshot = useSyncExternalStore(
    documentSession.title.subscribe,
    documentSession.title.getSnapshot
  );
  const stats = calculateWritingStatistics(documentSnapshot.value);

  const showToolbar = () => {
    setToolbarVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setToolbarVisible(false), 2500);
  };

  useLayoutEffect(() => {
    const host = editorHostRef.current;
    if (!host) throw new Error('immersive-writing-editor-host-unavailable');
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const transfer = documentSession.document.prepareSurfaceTransfer(host);
    transfer.activate();
    documentSession.document.focus();
    return () => {
      transfer.dispose();
      previousFocusRef.current?.focus();
    };
  }, [documentSession]);

  useLayoutEffect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const hadOpenClass = body.classList.contains('easymde-immersive-writing-open');
    body.style.overflow = 'hidden';
    body.classList.add('easymde-immersive-writing-open');
    return () => {
      body.style.overflow = previousOverflow;
      if (!hadOpenClass) {
        body.classList.remove('easymde-immersive-writing-open');
      }
    };
  }, []);

  useEffect(() => {
    showToolbar();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    title.style.height = 'auto';
    title.style.height = `${title.scrollHeight}px`;
  }, [titleSnapshot.value]);

  const closeTable = () => {
    setTableOpen(false);
    documentSession.document.focus();
  };

  const insertTable = (rows: number, columns: number) => {
    const markdown = tableMarkdown(rows, columns, strings.columns, strings.content);
    documentSession.document.applyTextChange(insertTableAtSelection(
      documentSession.document.getValue(),
      tableSelectionRef.current,
      markdown
    ));
    closeTable();
  };

  return (
    <div
      ref={overlayRef}
      className="easymde-immersive-writing"
      role="dialog"
      aria-modal="true"
      aria-label={strings.enter}
      data-toolbar-visible={toolbarVisible ? 'true' : 'false'}
      onMouseMove={showToolbar}
      onKeyDown={(event) => {
        if ('Escape' === event.key) {
          event.preventDefault();
          event.stopPropagation();
          if (tableOpen) closeTable();
          else onExit();
          return;
        }
        if ('Tab' !== event.key || tableOpen || !overlayRef.current) return;
        const focusable = focusableElements(overlayRef.current);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div
        className="easymde-immersive-toolbar"
        role="toolbar"
        aria-label={strings.enter}
        onMouseEnter={showToolbar}
        onFocusCapture={showToolbar}
      >
        <div className="easymde-immersive-toolbar-commands">
          {COMMANDS.map(([commandId, Icon, strokeWidth], index) => {
            const command = toolbar.commands.find(({ id }) => commandId === id);
            if (!command) throw new Error(`immersive-writing-command-missing-${commandId}`);
            return (
              <span
                key={commandId}
                className={`easymde-immersive-command-item${GROUP_STARTS.has(index) ? ' is-group-start' : ''}`}
              >
                {GROUP_STARTS.has(index) ? <span className="easymde-immersive-divider" aria-hidden="true" /> : null}
                <button
                  type="button"
                  aria-label={command.label}
                  title={command.label}
                  data-easymde-immersive-command={commandId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => executeCommand(commandId)}
                >
                  <Icon size={14} strokeWidth={strokeWidth} aria-hidden="true" />
                </button>
              </span>
            );
          })}
          <span className="easymde-immersive-command-item">
            <button
              type="button"
              aria-label={strings.table}
              title={strings.table}
              data-easymde-immersive-command="table"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                tableSelectionRef.current = documentSession.document.getSelection();
                setTableOpen(true);
              }}
            >
              <Table size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        </div>
        <button type="button" className="easymde-immersive-exit" aria-label={strings.exit} title={strings.exitHint} onClick={onExit}>
          <Minimize2 size={13} aria-hidden="true" />
          <span>{strings.exit}</span>
        </button>
      </div>
      <div className="easymde-immersive-scroll">
        <main className="easymde-immersive-column">
          <textarea
            ref={titleRef}
            className="easymde-immersive-title"
            rows={1}
            spellCheck={false}
            placeholder={strings.untitled}
            aria-label={strings.untitled}
            value={titleSnapshot.value}
            onChange={(event) => documentSession.title.setValue(event.currentTarget.value)}
          />
          <div className="easymde-immersive-title-divider" aria-hidden="true" />
          <div
            ref={editorHostRef}
            className="easymde-immersive-editor-host"
            data-empty={documentSnapshot.value ? 'false' : 'true'}
            data-placeholder={strings.startWriting}
          />
        </main>
      </div>
      <footer className="easymde-immersive-status">
        <span>{stats.words} {strings.words}</span>
        <span>{stats.characters} {strings.characters}</span>
        <span>{strings.minutes.replace('%s', String(stats.minutes))}</span>
        <span className="easymde-immersive-escape">· {strings.escapeExit}</span>
      </footer>
      {tableOpen ? <TableDialog bootstrap={bootstrap} onClose={closeTable} onInsert={insertTable} /> : null}
    </div>
  );
}
