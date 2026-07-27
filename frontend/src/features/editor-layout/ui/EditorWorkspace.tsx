import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react';

type EditorWorkspaceProps = Readonly<{
  direction: 'ltr' | 'rtl';
  preview: ReactNode;
  splitResizable?: boolean;
  splitResizeLabel?: string;
  source: ReactNode;
}>;

const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

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
  preview,
  splitResizable = false,
  splitResizeLabel = '',
  source
}: EditorWorkspaceProps) {
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const releaseDragRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      releaseDragRef.current?.();
    },
    []
  );

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

  return (
    <div
      ref={workspaceRef}
      className={`easymde-workspace${splitResizable ? ' is-split-resizable' : ''}`}
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
}
