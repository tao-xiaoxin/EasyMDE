import {
  Fragment,
  createElement,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react';

import { resolveLocalDraftLocale } from '../../../contracts/bootstrap/local-drafts-bootstrap';

type OrdinaryStatusDocument = Readonly<{
  getValue: () => string;
  subscribe: (listener: () => void) => () => void;
}>;

type OrdinaryEditorStatus = Readonly<{
  document: OrdinaryStatusDocument;
  lastEdited: string;
  locale: string;
  wordCountTemplate: string;
}>;

type EditorWorkspaceProps = Readonly<{
  direction: 'ltr' | 'rtl';
  mode?: string;
  onLayoutChange?: () => void;
  ordinaryStatus?: OrdinaryEditorStatus;
  statusBarMode?: string;
  preview: ReactNode;
  splitResizable?: boolean;
  splitResizeLabel?: string;
  source: ReactNode;
}>;

const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

function writingCharacterCount(markdown: string): number {
  return markdown.length;
}

function formatCount(template: string, count: string): string {
  return template.replace(/%%|%(?:1\$)?s/g, (placeholder) =>
    '%%' === placeholder ? '%' : count
  );
}

function clampSplit(value: number): number {
  return Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, value));
}

/**
 * Owns the ordinary editor's fixed Source/Preview composition.
 *
 * WordPress remains responsible for publishing and revisions outside this
 * Root. The two surfaces deliberately stay mounted in their historical order
 * so CodeMirror, Preview and synchronized scrolling keep one stable lifecycle.
 */
export function EditorWorkspace({
  direction,
  mode = 'live-preview',
  onLayoutChange,
  ordinaryStatus,
  statusBarMode = 'words-reading-time',
  preview,
  splitResizable = false,
  splitResizeLabel = '',
  source
}: EditorWorkspaceProps) {
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const releaseDragRef = useRef<(() => void) | null>(null);
  const statusDocument = ordinaryStatus?.document;
  const [characterCount, setCharacterCount] = useState(() =>
    statusDocument ? writingCharacterCount(statusDocument.getValue()) : 0
  );
  const previousSplitRef = useRef(split);

  useEffect(
    () => () => {
      releaseDragRef.current?.();
    },
    []
  );

  useEffect(() => {
    if (!statusDocument) return undefined;
    const publish = () =>
      setCharacterCount(
        writingCharacterCount(statusDocument.getValue())
      );
    publish();
    return statusDocument.subscribe(publish);
  }, [statusDocument]);

  useEffect(() => {
    if (!splitResizable || previousSplitRef.current === split) return;
    previousSplitRef.current = split;
    onLayoutChange?.();
  }, [onLayoutChange, split, splitResizable]);

  const startResize = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    releaseDragRef.current?.();
    const documentRef = event.currentTarget.ownerDocument;
    const startX = event.clientX;
    const startSplit = split;
    const width = workspaceRef.current?.offsetWidth ?? 0;
    if (width <= 0) throw new Error('immersive-split-workspace-width-unavailable');
    const previousCursor = documentRef.body.style.cursor;
    const previousSelection = documentRef.body.style.userSelect;
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const physicalDelta = ((moveEvent.clientX - startX) / width) * 100;
      const logicalDelta = 'rtl' === direction ? -physicalDelta : physicalDelta;
      setSplit(clampSplit(startSplit + logicalDelta));
    };
    const release = () => {
      documentRef.removeEventListener('mousemove', onMove);
      documentRef.removeEventListener('mouseup', release);
      documentRef.body.style.cursor = previousCursor;
      documentRef.body.style.userSelect = previousSelection;
      releaseDragRef.current = null;
    };
    releaseDragRef.current = release;
    documentRef.body.style.cursor = 'col-resize';
    documentRef.body.style.userSelect = 'none';
    documentRef.addEventListener('mousemove', onMove);
    documentRef.addEventListener('mouseup', release);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    const physicalStep =
      'ArrowLeft' === event.key ? -1 : 'ArrowRight' === event.key ? 1 : 0;
    if (physicalStep) {
      event.preventDefault();
      const logicalStep = 'rtl' === direction ? -physicalStep : physicalStep;
      setSplit((current) => clampSplit(current + logicalStep));
    } else if ('Home' === event.key) {
      event.preventDefault();
      setSplit(DEFAULT_SPLIT);
    }
  };

  const style = splitResizable
    ? ({
        '--easymde-split-end': String(100 - split),
        '--easymde-split-start': String(split)
      } as CSSProperties)
    : undefined;

  const workspace = (
    <div
      ref={workspaceRef}
      className={`easymde-workspace is-mode-${mode}${splitResizable ? ' is-split-resizable' : ''}`}
      data-easymde-layout-owner="react"
      dir={direction}
      style={style}
    >
      {source}
      {splitResizable ? (
        <hr
          className="easymde-immersive-pane-divider"
          aria-label={splitResizeLabel}
          aria-orientation="vertical"
          aria-valuemin={MIN_SPLIT}
          aria-valuemax={MAX_SPLIT}
          aria-valuenow={Math.round(split)}
          tabIndex={0}
          onKeyDown={resizeWithKeyboard}
          onMouseDown={startResize}
        />
      ) : null}
      {preview}
    </div>
  );

  const count = ordinaryStatus
    ? new Intl.NumberFormat(
        resolveLocalDraftLocale(ordinaryStatus.locale)
      ).format(characterCount)
    : '';

  return (
    <Fragment>
      {workspace}
      {ordinaryStatus && 'hidden' !== statusBarMode ? (
        <footer className="easymde-editor-status-bar">
          {'words' === statusBarMode ? (
            <span className="easymde-editor-word-count">
              {formatCount(ordinaryStatus.wordCountTemplate, count)}
            </span>
          ) : (
            <Fragment>
              <span className="easymde-editor-word-count">
                {formatCount(ordinaryStatus.wordCountTemplate, count)}
              </span>
              <span className="easymde-editor-last-edited">
                {ordinaryStatus.lastEdited}
              </span>
            </Fragment>
          )}
        </footer>
      ) : null}
    </Fragment>
  );
}
