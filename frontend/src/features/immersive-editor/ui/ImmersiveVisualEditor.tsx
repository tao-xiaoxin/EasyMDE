import {
  useCallback,
  useLayoutEffect,
  useRef
} from '@wordpress/element';

import type { ToolbarCommand } from '../../../contracts/bootstrap/toolbar-bootstrap';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import type { PreviewSurfaceStatus } from '../../live-preview/ui/PreviewSurfaceOwner';
import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChange,
  placeVisualCaretFromSourceOffset,
  prepareVisualTaskListMarkers,
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

export type VisualPreviewSnapshot = Readonly<{
  revision: number;
  signature: string;
}>;

type Props = Readonly<{
  documentSession: EditorDocumentSession;
  imageUploadEnabled: boolean;
  onCanonicalDocumentChange: () => void;
  onDiagnostic: (code: string) => void;
  onDispose: (runtime: ImmersiveVisualEditorRuntime) => void;
  onFailure: (code: string) => void;
  onMarkdownChange: () => void;
  onPendingChange: (pending: boolean) => void;
  onReady: (runtime: ImmersiveVisualEditorRuntime) => void;
  onTransferFailure: () => void;
  pending: boolean;
  previewSnapshot: VisualPreviewSnapshot;
  previewStatus: PreviewSurfaceStatus;
  requestPreview: (markdown: string) => string;
  surface: HTMLElement;
}>;

type PendingMarkdownTransfer = Readonly<{
  markdown: string;
  phase: 'rendering' | 'requesting';
  selection: Readonly<{
    direction: 'none';
    end: number;
    start: number;
  }>;
  signature: string;
}>;

function hasImageFile(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => 'file' === item.kind && /^image\//i.test(item.type)
  ) || Array.from(transfer?.files ?? []).some(
    (file) => /^image\//i.test(file.type)
  );
}

function visualEditorFailureCode(error: unknown, fallback: string): string {
  return error instanceof Error
    && /^visual-editor-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : fallback;
}

function placeSurfaceCaretAtEnd(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const range = surface.ownerDocument.createRange();
  range.selectNodeContents(surface);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function ensureEmptyVisualParagraph(
  surface: HTMLElement,
  sourceMarkdown: string
): void {
  if (sourceMarkdown || surface.hasChildNodes()) return;
  const paragraph = surface.ownerDocument.createElement('p');
  paragraph.append(surface.ownerDocument.createElement('br'));
  surface.append(paragraph);
  placeSurfaceCaretAtEnd(paragraph);
}

export function ImmersiveVisualEditor({
  documentSession,
  imageUploadEnabled,
  onCanonicalDocumentChange,
  onDiagnostic,
  onDispose,
  onFailure,
  onMarkdownChange,
  onPendingChange,
  onReady,
  onTransferFailure,
  pending,
  previewSnapshot,
  previewStatus,
  requestPreview,
  surface
}: Props) {
  const sourceMarkdownRef = useRef<string | null>(null);
  const visualMarkdownRef = useRef<string | null>(null);
  const acceptedHtmlRef = useRef<string | null>(null);
  const externalChangeReportedRef = useRef(false);
  const pendingTransferRef = useRef<PendingMarkdownTransfer | null>(null);
  const restoreFocusRef = useRef(false);
  const selfWriteRef = useRef(false);
  const readOnlySnapshotRef =
    useRef<VisualMarkdownReadOnlySnapshot | null>(null);

  const captureSnapshot = useCallback((sourceMarkdown: string) => {
    prepareVisualTaskListMarkers(surface);
    ensureEmptyVisualParagraph(surface, sourceMarkdown);
    protectVisualMarkdownReadOnlyRegions(surface);
    readOnlySnapshotRef.current =
      captureVisualMarkdownReadOnlySnapshot(surface);
    sourceMarkdownRef.current = sourceMarkdown;
    visualMarkdownRef.current = serializeVisualMarkdown(surface);
    acceptedHtmlRef.current = surface.innerHTML;
  }, [surface]);

  const restoreAcceptedSnapshot = useCallback(() => {
    if (null === acceptedHtmlRef.current) return;
    surface.innerHTML = acceptedHtmlRef.current;
    captureSnapshot(sourceMarkdownRef.current ?? '');
  }, [captureSnapshot, surface]);

  const applyDocumentChange = useCallback((
    change: Parameters<
      EditorDocumentSession['document']['applyTextChange']
    >[0]
  ) => {
    selfWriteRef.current = true;
    try {
      documentSession.document.applyTextChange(change);
    } finally {
      selfWriteRef.current = false;
    }
  }, [documentSession]);

  const failPendingTransfer = useCallback((code: string) => {
    if (!pendingTransferRef.current) {
      onFailure(code);
      return;
    }
    pendingTransferRef.current = null;
    onPendingChange(false);
    onFailure(code);
    onTransferFailure();
  }, [onFailure, onPendingChange, onTransferFailure]);

  const synchronizeMarkdown = useCallback((): boolean => {
    try {
      if (pendingTransferRef.current) return false;
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
      const selection = visualSelectionSourceRange(
        surface,
        sourceMarkdown,
        baselineVisualMarkdown
      );
      const value = mergeVisualMarkdownChange(
        sourceMarkdown,
        baselineVisualMarkdown,
        editedVisualMarkdown
      );
      applyDocumentChange({ selection, value });
      sourceMarkdownRef.current = value;
      visualMarkdownRef.current = editedVisualMarkdown;
      acceptedHtmlRef.current = surface.innerHTML;
      if (value !== sourceMarkdown) onMarkdownChange();
      return true;
    } catch (error) {
      restoreAcceptedSnapshot();
      onFailure(
        error instanceof Error
          ? error.message
          : 'visual-editor-markdown-sync-failed'
      );
      return false;
    }
  }, [
    applyDocumentChange,
    onFailure,
    onMarkdownChange,
    restoreAcceptedSnapshot,
    surface
  ]);

  const requestMarkdownTransfer = useCallback((value: string) => {
    if (!value || pendingTransferRef.current) return;
    if (!synchronizeMarkdown()) return;
    const sourceMarkdown = sourceMarkdownRef.current;
    const baselineVisualMarkdown = visualMarkdownRef.current;
    if (null === sourceMarkdown || null === baselineVisualMarkdown) {
      throw new Error('visual-editor-markdown-snapshot-missing');
    }
    try {
      const currentSelection = visualSelectionSourceRange(
        surface,
        sourceMarkdown,
        baselineVisualMarkdown
      );
      const markdown =
        sourceMarkdown.slice(0, currentSelection.start)
        + value
        + sourceMarkdown.slice(currentSelection.end);
      const caret = currentSelection.start + value.length;
      const selection = {
        direction: 'none' as const,
        end: caret,
        start: caret
      };
      applyDocumentChange({ selection, value: markdown });
      onMarkdownChange();
      pendingTransferRef.current = {
        markdown,
        phase: 'requesting',
        selection,
        signature: ''
      };
      onPendingChange(true);
      const signature = requestPreview(markdown);
      pendingTransferRef.current = {
        markdown,
        phase: 'rendering',
        selection,
        signature
      };
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message
          : 'visual-editor-markdown-paste-failed';
      if (pendingTransferRef.current) {
        failPendingTransfer(code);
      } else {
        onFailure(code);
      }
    }
  }, [
    applyDocumentChange,
    failPendingTransfer,
    onFailure,
    onMarkdownChange,
    onPendingChange,
    requestPreview,
    surface,
    synchronizeMarkdown
  ]);

  useLayoutEffect(() => {
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      surface.focus();
    }
  }, [pending, surface]);

  useLayoutEffect(() =>
    documentSession.document.subscribe(() => {
      if (
        selfWriteRef.current
        || externalChangeReportedRef.current
        || documentSession.document.getValue() === sourceMarkdownRef.current
      ) {
        return;
      }
      externalChangeReportedRef.current = true;
      onCanonicalDocumentChange();
    }), [documentSession, onCanonicalDocumentChange]);

  useLayoutEffect(() => {
    const pending = pendingTransferRef.current;
    if ('error' === previewStatus && pending) {
      failPendingTransfer('visual-editor-markdown-paste-render-failed');
    }
  }, [
    failPendingTransfer,
    previewStatus
  ]);

  useLayoutEffect(() => {
    if ('ready' !== previewStatus) return;
    const pending = pendingTransferRef.current;
    if (!pending) {
      captureSnapshot(documentSession.document.getValue());
      return;
    }
    if (pending.signature !== previewSnapshot.signature) {
      failPendingTransfer('visual-editor-markdown-paste-superseded');
      return;
    }
    let selectionDiagnostic: string | null = null;
    try {
      if (documentSession.document.getValue() !== pending.markdown) {
        throw new Error('visual-editor-markdown-paste-document-stale');
      }
      const visualMarkdown = serializeVisualMarkdown(surface);
      try {
        placeVisualCaretFromSourceOffset(
          surface,
          pending.markdown,
          visualMarkdown,
          pending.selection.start
        );
      } catch (error) {
        selectionDiagnostic = visualEditorFailureCode(
          error,
          'visual-editor-selection-restore-failed'
        );
        placeSurfaceCaretAtEnd(surface);
      }
      pendingTransferRef.current = null;
      captureSnapshot(pending.markdown);
      restoreFocusRef.current = true;
      onPendingChange(false);
    } catch (error) {
      failPendingTransfer(visualEditorFailureCode(
        error,
        'visual-editor-markdown-paste-commit-failed'
      ));
      return;
    }
    if (selectionDiagnostic) onDiagnostic(selectionDiagnostic);
  }, [
    captureSnapshot,
    documentSession,
    failPendingTransfer,
    onDiagnostic,
    onPendingChange,
    previewSnapshot,
    previewStatus,
    surface
  ]);

  useLayoutEffect(() => {
    captureSnapshot(documentSession.document.getValue());
    surface.focus();
    let active = true;
    let composing = false;
    let compositionCommitScheduled = false;

    const commitVisualInput = () => {
      if (!active || pendingTransferRef.current) return;
      applyVisualInlineShortcut(surface);
      synchronizeMarkdown();
    };

    const handleDrop = (event: DragEvent) => {
      if (hasImageFile(event.dataTransfer)) {
        if (!imageUploadEnabled) event.preventDefault();
        return;
      }
      event.preventDefault();
      requestMarkdownTransfer(event.dataTransfer?.getData('text/plain') ?? '');
    };
    const handleCompositionStart = () => {
      composing = true;
      compositionCommitScheduled = false;
    };
    const handleCompositionEnd = () => {
      composing = false;
      if (compositionCommitScheduled) return;
      compositionCommitScheduled = true;
      queueMicrotask(() => {
        compositionCommitScheduled = false;
        commitVisualInput();
      });
    };
    const handleInput = (event: InputEvent) => {
      if (
        pendingTransferRef.current
        || composing
        || event.isComposing
        || compositionCommitScheduled
      ) {
        return;
      }
      commitVisualInput();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pendingTransferRef.current) {
        event.preventDefault();
        return;
      }
      if (composing || event.isComposing) return;
      if (applyVisualBlockShortcut(surface, event)) {
        synchronizeMarkdown();
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (hasImageFile(event.clipboardData)) {
        if (!imageUploadEnabled) event.preventDefault();
        return;
      }
      event.preventDefault();
      requestMarkdownTransfer(
        event.clipboardData?.getData('text/plain') ?? ''
      );
    };
    surface.addEventListener('compositionstart', handleCompositionStart);
    surface.addEventListener('compositionend', handleCompositionEnd);
    surface.addEventListener('drop', handleDrop);
    surface.addEventListener('input', handleInput);
    surface.addEventListener('keydown', handleKeyDown);
    surface.addEventListener('paste', handlePaste);

    const runtime: ImmersiveVisualEditorRuntime = {
      executeCommand(command) {
        if (pendingTransferRef.current) return false;
        if (!applyVisualToolbarCommand(surface, command)) return false;
        synchronizeMarkdown();
        surface.focus();
        return true;
      },
      prepareToolbarFallback() {
        const pending = pendingTransferRef.current;
        if (!pending) return synchronizeMarkdown();
        try {
          applyDocumentChange({
            selection: pending.selection,
            value: pending.markdown
          });
          pendingTransferRef.current = null;
          onPendingChange(false);
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
    return () => {
      active = false;
      onDispose(runtime);
      surface.removeEventListener('compositionstart', handleCompositionStart);
      surface.removeEventListener('compositionend', handleCompositionEnd);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('input', handleInput);
      surface.removeEventListener('keydown', handleKeyDown);
      surface.removeEventListener('paste', handlePaste);
      onPendingChange(false);
    };
  }, [
    captureSnapshot,
    applyDocumentChange,
    documentSession,
    imageUploadEnabled,
    onDispose,
    onFailure,
    onPendingChange,
    onReady,
    requestMarkdownTransfer,
    surface,
    synchronizeMarkdown
  ]);

  return null;
}
