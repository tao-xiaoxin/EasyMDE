import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react';

import {
  type EditorLayoutStrings,
  resolveEditorNumberLocale
} from '../../../contracts/bootstrap/editor-layout-bootstrap';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import {
  calculateWritingStatistics,
  parseEditorOutline
} from '../editor-insights';
import type { EditorOutlineEntry, WritingStatistics } from '../editor-insights';

export type EditorViewMode = 'edit' | 'preview' | 'split';

type EditorWorkspaceProps = Readonly<{
  direction: 'ltr' | 'rtl';
  documentSession: EditorDocumentSession | null;
  locale: string;
  onViewModeChange?: (mode: EditorViewMode) => void;
  preview: ReactNode;
  source: ReactNode;
  strings: EditorLayoutStrings;
}>;

type EditorInsightSnapshot = Readonly<{
  cursor: Readonly<{ column: number; line: number }>;
  dirty: boolean;
  markdown: string;
}>;

type EditorInsights = Readonly<{
  outline: ReadonlyArray<EditorOutlineEntry>;
  statistics: WritingStatistics;
}>;

const MIN_SOURCE_PERCENT = 30;
const MAX_SOURCE_PERCENT = 70;
const DEFAULT_SOURCE_PERCENT = 50;
const INSIGHT_UPDATE_DELAY_MS = 150;
const OUTLINE_PAGE_SIZE = 200;

function clampSourcePercent(value: number): number {
  return Math.max(MIN_SOURCE_PERCENT, Math.min(MAX_SOURCE_PERCENT, value));
}

function sessionSnapshot(session: EditorDocumentSession | null): EditorInsightSnapshot {
  return session
    ? {
      cursor: session.document.getCursorPosition(),
      dirty: session.getSnapshot().dirty,
      markdown: session.document.getSnapshot().value
    }
    : { cursor: { column: 1, line: 1 }, dirty: false, markdown: '' };
}

function deriveInsights(markdown: string): EditorInsights {
  return {
    outline: parseEditorOutline(markdown),
    statistics: calculateWritingStatistics(markdown)
  };
}

function formatCursorPosition(
  template: string,
  line: string,
  column: string
): string {
  return template.replace(/%%|%([12])\$s/g, (placeholder, index: string | undefined) => (
    '%%' === placeholder ? '%' : '1' === index ? line : column
  ));
}

function viewButton(
  mode: EditorViewMode,
  current: EditorViewMode,
  label: string,
  setMode: (mode: EditorViewMode) => void
) {
  return (
    <button
      type="button"
      className={mode === current ? 'is-active' : undefined}
      aria-label={label}
      aria-pressed={mode === current}
      onClick={() => setMode(mode)}
    >
      {label}
    </button>
  );
}

export function EditorWorkspace({
  direction,
  documentSession,
  locale,
  onViewModeChange,
  preview,
  source,
  strings
}: EditorWorkspaceProps) {
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const pendingRevealOffset = useRef<number | null>(null);
  const [mode, setMode] = useState<EditorViewMode>('split');
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [sourcePercent, setSourcePercent] = useState(DEFAULT_SOURCE_PERCENT);
  const [snapshot, setSnapshot] = useState(() => sessionSnapshot(documentSession));
  const [insights, setInsights] = useState(() => deriveInsights(snapshot.markdown));
  const [visibleOutlineCount, setVisibleOutlineCount] = useState(OUTLINE_PAGE_SIZE);
  const changeMode = useCallback((nextMode: EditorViewMode) => {
    setMode(nextMode);
    onViewModeChange?.(nextMode);
  }, [onViewModeChange]);
  const closeOutline = useCallback(() => {
    setOutlineOpen(false);
    outlineToggleRef.current?.focus();
  }, []);

  useEffect(() => {
    const nextSnapshot = sessionSnapshot(documentSession);
    setSnapshot(nextSnapshot);
    setInsights(deriveInsights(nextSnapshot.markdown));
    setVisibleOutlineCount(OUTLINE_PAGE_SIZE);
    if (!documentSession) return;
    const publish = () => setSnapshot(sessionSnapshot(documentSession));
    const unsubscribeDocument = documentSession.document.subscribe(publish);
    const unsubscribeSelection = documentSession.document.subscribeSelection(publish);
    const unsubscribeDirty = documentSession.subscribe(publish);
    return () => {
      unsubscribeDocument();
      unsubscribeSelection();
      unsubscribeDirty();
    };
  }, [documentSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInsights(deriveInsights(snapshot.markdown));
      setVisibleOutlineCount(OUTLINE_PAGE_SIZE);
    }, INSIGHT_UPDATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot.markdown]);

  useEffect(() => {
    if ('preview' === mode || null === pendingRevealOffset.current) return;
    const offset = pendingRevealOffset.current;
    pendingRevealOffset.current = null;
    documentSession?.document.revealPosition(offset);
  }, [documentSession, mode]);

  const outline = insights.outline;
  const statistics = insights.statistics;
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(resolveEditorNumberLocale(locale)),
    [locale]
  );
  const cursorText = formatCursorPosition(
    strings.cursorPosition,
    numberFormatter.format(snapshot.cursor.line),
    numberFormatter.format(snapshot.cursor.column)
  );
  const resizeFromPointer = useCallback((clientX: number) => {
    const bounds = panesRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const position = 'rtl' === direction ? bounds.right - clientX : clientX - bounds.left;
    setSourcePercent(clampSourcePercent((position / bounds.width) * 100));
  }, [direction]);
  const handleDividerPointerDown = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
    if (0 !== event.button) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeFromPointer(event.clientX);
  }, [resizeFromPointer]);
  const handleDividerPointerMove = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    resizeFromPointer(event.clientX);
  }, [resizeFromPointer]);
  const handleDividerPointerUp = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);
  const handleDividerKeyDown = useCallback((event: KeyboardEvent<HTMLHRElement>) => {
    const deltas: Partial<Record<string, number>> = {
      ArrowLeft: 'rtl' === direction ? 2 : -2,
      ArrowRight: 'rtl' === direction ? -2 : 2
    };
    if ('Home' === event.key) {
      event.preventDefault();
      setSourcePercent(MIN_SOURCE_PERCENT);
      return;
    }
    if ('End' === event.key) {
      event.preventDefault();
      setSourcePercent(MAX_SOURCE_PERCENT);
      return;
    }
    const delta = deltas[event.key];
    if (undefined === delta) return;
    event.preventDefault();
    setSourcePercent((current) => clampSourcePercent(current + delta));
  }, [direction]);
  const paneStyles = {
    '--easymde-source-percent': `${sourcePercent}%`
  } as CSSProperties;

  return (
    <div
      className="easymde-layout-owner"
      data-easymde-layout-owner="react"
      dir={direction}
    >
      <div className="easymde-editor-context-bar">
        <button
          ref={outlineToggleRef}
          type="button"
          className="easymde-context-button"
          aria-controls="easymde-editor-outline"
          aria-expanded={outlineOpen}
          title={outlineOpen ? strings.closeOutline : strings.openOutline}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <span className="dashicons dashicons-list-view" aria-hidden="true" />
          {strings.outline}
        </button>
        <button
          type="button"
          className="easymde-context-button easymde-statistics-summary"
          aria-controls="easymde-editor-statistics"
          aria-expanded={statisticsOpen}
          aria-label={strings.statistics}
          onClick={() => setStatisticsOpen((open) => !open)}
        >
          <span><span>{strings.westernWords}</span> <b>{numberFormatter.format(statistics.words)}</b></span>
          <span><span>{strings.totalCharacters}</span> <b>{numberFormatter.format(statistics.characters)}</b></span>
          <span><span>{strings.readingTime}</span> <b>{numberFormatter.format(statistics.readMinutes)}</b></span>
        </button>
        <fieldset className="easymde-view-switch">
          <legend className="screen-reader-text">{strings.viewMode}</legend>
          {viewButton('edit', mode, strings.editMode, changeMode)}
          {viewButton('split', mode, strings.splitMode, changeMode)}
          {viewButton('preview', mode, strings.previewMode, changeMode)}
        </fieldset>
        {statisticsOpen ? (
          <section
            id="easymde-editor-statistics"
            className="easymde-statistics-panel"
            aria-label={strings.statistics}
          >
            <strong>{strings.statistics}</strong>
            <dl>
              <div><dt>{strings.readingTime}</dt><dd>{numberFormatter.format(statistics.readMinutes)}</dd></div>
              <div><dt>{strings.lines}</dt><dd>{numberFormatter.format(statistics.lines)}</dd></div>
              <div><dt>{strings.westernWords}</dt><dd>{numberFormatter.format(statistics.words)}</dd></div>
              <div><dt>{strings.cjkCharacters}</dt><dd>{numberFormatter.format(statistics.cjk)}</dd></div>
              <div><dt>{strings.totalCharacters}</dt><dd>{numberFormatter.format(statistics.characters)}</dd></div>
            </dl>
            <p>{strings.statisticsHelp}</p>
          </section>
        ) : null}
      </div>
      <div className={`easymde-react-workspace${outlineOpen ? ' has-outline' : ''}`}>
        {outlineOpen ? (
          <aside id="easymde-editor-outline" className="easymde-outline-panel">
            <header>
              <strong>{strings.outline}</strong>
              <button
                type="button"
                className="easymde-outline-close"
                aria-label={strings.closeOutline}
                onClick={closeOutline}
              >
                <span className="dashicons dashicons-no-alt" aria-hidden="true" />
              </button>
            </header>
            {outline.length ? (
              <nav aria-label={strings.outline}>
                <ol>
                  {outline.slice(0, visibleOutlineCount).map((entry) => (
                    <li key={entry.key} style={{ '--easymde-outline-depth': entry.depth } as CSSProperties}>
                      <button
                        type="button"
                        onClick={() => {
                          if ('preview' === mode) {
                            pendingRevealOffset.current = entry.offset;
                            changeMode('edit');
                            return;
                          }
                          documentSession?.document.revealPosition(entry.offset);
                        }}
                      >
                        {entry.text}
                      </button>
                    </li>
                  ))}
                </ol>
                {visibleOutlineCount < outline.length ? (
                  <button
                    type="button"
                    className="easymde-outline-show-more"
                    onClick={() => setVisibleOutlineCount((count) => count + OUTLINE_PAGE_SIZE)}
                  >
                    {strings.showMoreHeadings}
                  </button>
                ) : null}
              </nav>
            ) : <p className="easymde-outline-empty">{strings.noOutline}</p>}
          </aside>
        ) : null}
        <div
          ref={panesRef}
          className="easymde-editor-panes"
          data-view={mode}
          style={paneStyles}
        >
          <div className="easymde-editor-source-slot" hidden={'preview' === mode}>{source}</div>
          <hr
            className="easymde-pane-divider"
            aria-label={strings.resizePanes}
            aria-orientation="vertical"
            aria-valuemin={MIN_SOURCE_PERCENT}
            aria-valuemax={MAX_SOURCE_PERCENT}
            aria-valuenow={Math.round(sourcePercent)}
            hidden={'split' !== mode}
            tabIndex={'split' === mode ? 0 : -1}
            onKeyDown={handleDividerKeyDown}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            onPointerCancel={handleDividerPointerUp}
          />
          <div className="easymde-editor-preview-slot" hidden={'edit' === mode}>{preview}</div>
        </div>
      </div>
      <footer className="easymde-editor-status-bar">
        <span>{cursorText}</span>
        <span className={snapshot.dirty ? 'is-dirty' : 'is-saved'} aria-live="polite">
          <i aria-hidden="true" />
          {snapshot.dirty ? strings.unsaved : strings.saved}
        </span>
      </footer>
    </div>
  );
}
