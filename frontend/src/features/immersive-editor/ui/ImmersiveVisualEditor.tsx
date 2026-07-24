import {
  createElement,
  useLayoutEffect,
  useRef
} from '@wordpress/element';
import type { CSSProperties } from 'react';

import type { ToolbarCommand } from '../../../contracts/bootstrap/toolbar-bootstrap';
import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { SafePreviewHtmlSink } from '../../live-preview/ui/SafePreviewHtmlSink';
import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChange,
  protectVisualMarkdownReadOnlyRegions,
  serializeVisualMarkdown,
  type VisualMarkdownReadOnlySnapshot,
  visualSelectionSourceRange
} from '../visual-markdown';

export type ImmersiveVisualEditorRuntime = Readonly<{
  executeCommand: (command: ToolbarCommand) => boolean;
  prepareToolbarFallback: () => boolean;
  surface: HTMLElement;
}>;

type Props = Readonly<{
  className: string;
  documentSession: EditorDocumentSession;
  html: SafePreviewHtml;
  label: string;
  imageUploadEnabled: boolean;
  onDispose: (runtime: ImmersiveVisualEditorRuntime) => void;
  onFailure: (code: string) => void;
  onMarkdownChange: () => void;
  onReady: (runtime: ImmersiveVisualEditorRuntime) => void;
  style: CSSProperties;
}>;

function insertPlainText(editor: HTMLElement, value: string): void {
  if (!value) return;
  const selection = editor.ownerDocument.defaultView?.getSelection();
  const range =
    selection?.rangeCount
    && selection.anchorNode
    && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : editor.ownerDocument.createRange();
  if (!range) throw new Error('visual-editor-selection-unavailable');
  if (!selection?.anchorNode || !editor.contains(selection.anchorNode)) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  const fragment = editor.ownerDocument.createDocumentFragment();
  const lines = value.split(/\r\n|\r|\n/);
  let tail: Node | null = null;
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      tail = fragment.appendChild(editor.ownerDocument.createElement('br'));
    }
    if (line) {
      tail = fragment.appendChild(editor.ownerDocument.createTextNode(line));
    }
  }
  range.insertNode(fragment);
  if (tail && selection) {
    if (Node.TEXT_NODE === tail.nodeType) {
      range.setStart(tail, tail.textContent?.length ?? 0);
    } else {
      range.setStartAfter(tail);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function hasImageFile(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => 'file' === item.kind && /^image\//i.test(item.type)
  ) || Array.from(transfer?.files ?? []).some(
    (file) => /^image\//i.test(file.type)
  );
}

export function ImmersiveVisualEditor({
  className,
  documentSession,
  html,
  imageUploadEnabled,
  label,
  onDispose,
  onFailure,
  onMarkdownChange,
  onReady,
  style
}: Props) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const sourceMarkdownRef = useRef<string | null>(null);
  const visualMarkdownRef = useRef<string | null>(null);
  const acceptedHtmlRef = useRef<string | null>(null);
  const readOnlySnapshotRef =
    useRef<VisualMarkdownReadOnlySnapshot | null>(null);

  const synchronizeMarkdown = (): boolean => {
    const surface = surfaceRef.current;
    if (!surface) throw new Error('visual-editor-surface-missing');
    try {
      const readOnlySnapshot = readOnlySnapshotRef.current;
      if (null === readOnlySnapshot) {
        throw new Error('visual-editor-read-only-snapshot-missing');
      }
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
      const editedVisualMarkdown = serializeVisualMarkdown(surface);
      const sourceMarkdown = sourceMarkdownRef.current;
      const baselineVisualMarkdown = visualMarkdownRef.current;
      if (null === sourceMarkdown || null === baselineVisualMarkdown) {
        throw new Error('visual-editor-markdown-snapshot-missing');
      }
      const value = mergeVisualMarkdownChange(
        sourceMarkdown,
        baselineVisualMarkdown,
        editedVisualMarkdown
      );
      const caret = value.length;
      documentSession.document.applyTextChange({
        selection: { direction: 'none', end: caret, start: caret },
        value
      });
      sourceMarkdownRef.current = value;
      visualMarkdownRef.current = editedVisualMarkdown;
      acceptedHtmlRef.current = surface.innerHTML;
      onMarkdownChange();
      return true;
    } catch (error) {
      if (null !== acceptedHtmlRef.current) {
        surface.innerHTML = acceptedHtmlRef.current;
        protectVisualMarkdownReadOnlyRegions(surface);
        readOnlySnapshotRef.current =
          captureVisualMarkdownReadOnlySnapshot(surface);
      }
      onFailure(
        error instanceof Error
          ? error.message
          : 'visual-editor-markdown-sync-failed'
      );
      return false;
    }
  };

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) throw new Error('visual-editor-surface-missing');
    protectVisualMarkdownReadOnlyRegions(surface);
    readOnlySnapshotRef.current =
      captureVisualMarkdownReadOnlySnapshot(surface);
    sourceMarkdownRef.current = documentSession.document.getValue();
    visualMarkdownRef.current = serializeVisualMarkdown(surface);
    acceptedHtmlRef.current = surface.innerHTML;
    const runtime: ImmersiveVisualEditorRuntime = {
      executeCommand(command) {
        if (!applyVisualToolbarCommand(surface, command)) return false;
        synchronizeMarkdown();
        surface.focus();
        return true;
      },
      prepareToolbarFallback() {
        if (!synchronizeMarkdown()) return false;
        const sourceMarkdown = sourceMarkdownRef.current;
        const baselineVisualMarkdown = visualMarkdownRef.current;
        if (null === sourceMarkdown || null === baselineVisualMarkdown) {
          throw new Error('visual-editor-markdown-snapshot-missing');
        }
        try {
          documentSession.document.applyTextChange({
            selection: visualSelectionSourceRange(
              surface,
              sourceMarkdown,
              baselineVisualMarkdown
            ),
            value: sourceMarkdown
          });
          return true;
        } catch (error) {
          onFailure(
            error instanceof Error
              ? error.message
              : 'visual-editor-selection-map-failed'
          );
          return false;
        }
      },
      surface
    };
    onReady(runtime);
    return () => onDispose(runtime);
  }, [onDispose, onReady]);

  return (
    <SafePreviewHtmlSink
      className={`${className} easymde-immersive-visual-editor`}
      contentEditable
      html={html}
      label={label}
      onDrop={(event) => {
        if (hasImageFile(event.dataTransfer)) {
          if (!imageUploadEnabled) event.preventDefault();
          return;
        }
        event.preventDefault();
        insertPlainText(surfaceRef.current ?? event.currentTarget, event.dataTransfer.getData('text/plain'));
        applyVisualInlineShortcut(surfaceRef.current ?? event.currentTarget);
        synchronizeMarkdown();
      }}
      onInput={() => {
        const surface = surfaceRef.current;
        if (!surface) throw new Error('visual-editor-surface-missing');
        applyVisualInlineShortcut(surface);
        synchronizeMarkdown();
      }}
      onKeyDown={(event) => {
        const surface = surfaceRef.current;
        if (!surface) throw new Error('visual-editor-surface-missing');
        if (applyVisualBlockShortcut(surface, event.nativeEvent)) {
          synchronizeMarkdown();
        }
      }}
      onPaste={(event) => {
        if (hasImageFile(event.clipboardData)) {
          if (!imageUploadEnabled) event.preventDefault();
          return;
        }
        event.preventDefault();
        insertPlainText(surfaceRef.current ?? event.currentTarget, event.clipboardData.getData('text/plain'));
        applyVisualInlineShortcut(surfaceRef.current ?? event.currentTarget);
        synchronizeMarkdown();
      }}
      role="textbox"
      spellCheck
      style={style}
      surfaceRef={surfaceRef}
    />
  );
}
