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
  applyVisualMarkdownEditIntent,
  createVisualMarkdownSourceIntervalMap,
  mergeVisualMarkdownChangeDetails,
  placeVisualCaretAtAcceptedPasteDocumentBoundary,
  placeVisualCaretFromSourceOffset,
  prepareVisualTaskListMarkers,
  protectVisualMarkdownReadOnlyRegions,
  serializeVisualMarkdown,
  type VisualMarkdownReadOnlySnapshot,
  type AcceptedPasteDocumentBoundary,
  type VisualMarkdownSourceIntervalMap,
  visualSelectionSourceRange
} from '../visual-markdown';

export type ImmersiveVisualEditorRuntime = Readonly<{
  executeCommand: (command: ToolbarCommand) => boolean;
  prepareMediaSelection: () => boolean;
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
  imagePasteUploadEnabled: boolean;
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
  acceptedDocumentBoundary: AcceptedPasteDocumentBoundary | null;
  markdown: string;
  phase: 'rendering' | 'requesting';
  selection: Readonly<{
    direction: 'none';
    end: number;
    start: number;
  }>;
  signature: string;
}>;

type VisualSelectionSourceRange = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

type SynchronizeMarkdownOptions = Readonly<{
  acceptedDocumentBoundary?: AcceptedPasteDocumentBoundary;
  mapSelectionWhenUnchanged?: boolean;
}>;

type CaptureSnapshotOptions = Readonly<{
  cacheSourceIntervalMap?: boolean;
}>;

const VISUAL_INPUT_DEBOUNCE_MS = 80;

type VisualSelectionMemory = Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
  sourceAnchor: number;
  sourceFocus: number;
  visualAnchor: number;
  visualFocus: number;
}>;

type VisualInputIntent = Readonly<{
  data: string | null;
  inputType: string;
  sourceSelection: Readonly<{ end: number; start: number }>;
  textData: string;
  textNode: Text;
  textSelection: Readonly<{ end: number; start: number }>;
  visualSelection: Readonly<{ end: number; start: number }>;
}>;

type PendingVisualIntent = Readonly<{
  memory: VisualSelectionMemory | null;
  result: NonNullable<ReturnType<typeof applyVisualMarkdownEditIntent>>;
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

function editableTextNode(surface: HTMLElement, node: Node): node is Text {
  if (!(node instanceof Text) || !surface.contains(node)) return false;
  let element = node.parentElement;
  while (element && element !== surface) {
    if ('false' === element.getAttribute('contenteditable')) return false;
    element = element.parentElement;
  }
  return true;
}

function currentTextSelection(surface: HTMLElement): Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
}> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (
    !selection
    || !anchorNode
    || !focusNode
    || !editableTextNode(surface, anchorNode)
    || !editableTextNode(surface, focusNode)
  ) {
    return null;
  }
  return {
    anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode,
    focusOffset: selection.focusOffset
  };
}

function selectionRange(
  anchor: number,
  focus: number
): Readonly<{ end: number; start: number }> {
  return { end: Math.max(anchor, focus), start: Math.min(anchor, focus) };
}

function selectionMemoryForCurrentSelection(
  surface: HTMLElement,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>
): VisualSelectionMemory | null {
  const current = currentTextSelection(surface);
  if (!current) return null;
  return {
    ...current,
    sourceAnchor: sourceSelection.start,
    sourceFocus: sourceSelection.end,
    visualAnchor: visualSelection.start,
    visualFocus: visualSelection.end
  };
}

const VISUAL_DIRECT_FORMATTING_TAGS = new Set([
  'A',
  'CODE',
  'DEL',
  'EM',
  'I',
  'MARK',
  'S',
  'STRONG',
  'SUB',
  'SUP',
  'U'
]);

function canUseIdentityVisualSelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  visualMarkdown: string,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>
): boolean {
  if (
    sourceMarkdown !== visualMarkdown
    || sourceSelection.start !== visualSelection.start
    || sourceSelection.end !== visualSelection.end
  ) {
    return false;
  }
  const current = currentTextSelection(surface);
  if (!current || current.anchorNode !== current.focusNode) return false;
  let element = current.anchorNode.parentElement;
  while (element && element !== surface) {
    if (VISUAL_DIRECT_FORMATTING_TAGS.has(element.tagName)) return false;
    if (
      !['DIV', 'P'].includes(element.tagName)
      || element.childNodes.length !== 1
      || element.firstChild !== current.anchorNode
    ) {
      return false;
    }
    element = element.parentElement;
  }
  return element === surface;
}

function mapSelectionFromMemory(
  memory: VisualSelectionMemory,
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  sourceLength: number,
  visualLength: number
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  if (
    memory.anchorNode !== current.anchorNode
    || memory.focusNode !== current.focusNode
  ) {
    return null;
  }
  const sourceAnchor =
    memory.sourceAnchor + current.anchorOffset - memory.anchorOffset;
  const sourceFocus =
    memory.sourceFocus + current.focusOffset - memory.focusOffset;
  const visualAnchor =
    memory.visualAnchor + current.anchorOffset - memory.anchorOffset;
  const visualFocus =
    memory.visualFocus + current.focusOffset - memory.focusOffset;
  if (
    sourceAnchor < 0
    || sourceFocus < 0
    || sourceAnchor > sourceLength
    || sourceFocus > sourceLength
    || visualAnchor < 0
    || visualFocus < 0
    || visualAnchor > visualLength
    || visualFocus > visualLength
  ) {
    return null;
  }
  return {
    source: selectionRange(sourceAnchor, sourceFocus),
    visual: selectionRange(visualAnchor, visualFocus)
  };
}

function uniqueTextProjection(
  node: Text,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  if (!node.data) return null;
  const visualOffset = baselineVisualMarkdown.indexOf(node.data);
  if (
    visualOffset < 0
    || visualOffset !== baselineVisualMarkdown.lastIndexOf(node.data)
  ) {
    return null;
  }
  const sourceStart = sourceIntervalMap.resolve(visualOffset);
  const sourceEnd = sourceIntervalMap.resolve(
    visualOffset + node.data.length
  );
  if (
    null === sourceStart
    || null === sourceEnd
    || sourceEnd - sourceStart !== node.data.length
  ) {
    return null;
  }
  return { sourceOffset: sourceStart, visualOffset };
}

function mapSelectionFromInterval(
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  const anchor = uniqueTextProjection(
    current.anchorNode,
    baselineVisualMarkdown,
    sourceIntervalMap
  );
  const focus = current.anchorNode === current.focusNode
    ? anchor
    : uniqueTextProjection(
        current.focusNode,
        baselineVisualMarkdown,
        sourceIntervalMap
      );
  if (!anchor || !focus) return null;
  const visualAnchor = anchor.visualOffset + current.anchorOffset;
  const visualFocus = focus.visualOffset + current.focusOffset;
  const sourceAnchor = anchor.sourceOffset + current.anchorOffset;
  const sourceFocus = focus.sourceOffset + current.focusOffset;
  return {
    source: selectionRange(sourceAnchor, sourceFocus),
    visual: selectionRange(visualAnchor, visualFocus)
  };
}

function codePointLengthBefore(text: Text, offset: number): number {
  if (offset <= 0) return 0;
  const codePoint = text.data.codePointAt(offset - 1);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function codePointLengthAfter(text: Text, offset: number): number {
  if (offset >= text.length) return 0;
  const codePoint = text.data.codePointAt(offset);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function replaceTextRange(
  value: string,
  range: Readonly<{ end: number; start: number }>,
  replacement: string
): string {
  return value.slice(0, range.start)
    + replacement
    + value.slice(range.end);
}

function visualInputIntent(
  surface: HTMLElement,
  event: InputEvent,
  memory: VisualSelectionMemory | null,
  sourceLength: number,
  visualLength: number,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap | null
): VisualInputIntent | null {
  const current = currentTextSelection(surface);
  if (!current) return null;
  const mapped = memory
    ? mapSelectionFromMemory(memory, current, sourceLength, visualLength)
    : null;
  const intervalMapped = mapped ?? (
    sourceIntervalMap
      ? mapSelectionFromInterval(
          current,
          baselineVisualMarkdown,
          sourceIntervalMap
        )
      : null
  );
  if (!intervalMapped) return null;

  const currentMapped = intervalMapped;

  let visualSelection = currentMapped.visual;
  let textSelection = selectionRange(
    current.anchorOffset,
    current.focusOffset
  );
  const targetRange = event.getTargetRanges?.()[0];
  if (
    targetRange
    && targetRange.startContainer === current.anchorNode
    && targetRange.endContainer === current.anchorNode
  ) {
    textSelection = selectionRange(
      targetRange.startOffset,
      targetRange.endOffset
    );
    const localSelectionStart = Math.min(
      current.anchorOffset,
      current.focusOffset
    );
    visualSelection = {
      end: currentMapped.visual.start
        + textSelection.end - localSelectionStart,
      start: currentMapped.visual.start
        + textSelection.start - localSelectionStart
    };
    const sourceStart = currentMapped.source.start
      + textSelection.start - localSelectionStart;
    const sourceEnd = currentMapped.source.start
      + textSelection.end - localSelectionStart;
    if (
      sourceStart < 0
      || sourceEnd < sourceStart
      || sourceEnd > sourceLength
    ) return null;
    return {
      data: event.data,
      inputType: event.inputType,
      sourceSelection: { end: sourceEnd, start: sourceStart },
      textData: current.anchorNode.data,
      textNode: current.anchorNode,
      textSelection,
      visualSelection
    };
  }

  if (
    'deleteContentBackward' === event.inputType
    && current.anchorOffset === current.focusOffset
  ) {
    const start = Math.max(
      0,
      current.anchorOffset - codePointLengthBefore(current.anchorNode, current.anchorOffset)
    );
    textSelection = { end: current.anchorOffset, start };
  } else if (
    'deleteContentForward' === event.inputType
    && current.anchorOffset === current.focusOffset
  ) {
    textSelection = {
      end: current.anchorOffset + codePointLengthAfter(current.anchorNode, current.anchorOffset),
      start: current.anchorOffset
    };
  } else if (
    [
      'deleteByCut',
      'insertFromComposition',
      'insertReplacementText',
      'insertText'
    ].includes(event.inputType)
  ) {
    textSelection = selectionRange(current.anchorOffset, current.focusOffset);
  } else if (
    [
      'deleteWordBackward',
      'deleteWordForward'
    ].includes(event.inputType)
  ) {
    return null;
  } else if ('insertLineBreak' !== event.inputType) {
    return null;
  }

  const localSelectionStart = Math.min(
    current.anchorOffset,
    current.focusOffset
  );
  visualSelection = {
    end: currentMapped.visual.start
      + textSelection.end - localSelectionStart,
    start: currentMapped.visual.start
      + textSelection.start - localSelectionStart
  };
  const sourceStart = currentMapped.source.start
    + textSelection.start - localSelectionStart;
  const sourceEnd = currentMapped.source.start
    + textSelection.end - localSelectionStart;
  if (
    sourceStart < 0
    || sourceEnd < sourceStart
    || sourceEnd > sourceLength
  ) return null;
  return {
    data: event.data,
    inputType: event.inputType,
    sourceSelection: { end: sourceEnd, start: sourceStart },
    textData: current.anchorNode.data,
    textNode: current.anchorNode,
    textSelection,
    visualSelection
  };
}

function collapsedVisualSelection(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  return Boolean(
    selection?.isCollapsed
    && selection.anchorNode
    && surface.contains(selection.anchorNode)
  );
}

export function ImmersiveVisualEditor({
  documentSession,
  imageUploadEnabled,
  imagePasteUploadEnabled,
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
  const acceptedPasteDocumentBoundaryRef =
    useRef<AcceptedPasteDocumentBoundary | null>(null);
  const lastSelectionRef = useRef<VisualSelectionSourceRange | null>(null);
  const visualInputPendingRef = useRef(false);
  const visualInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualSelectionMemoryRef = useRef<VisualSelectionMemory | null>(null);
  const visualSourceIntervalMapRef = useRef<VisualMarkdownSourceIntervalMap | null>(null);
  const pendingVisualIntentRef = useRef<VisualInputIntent | null>(null);
  const pendingVisualIntentResultRef = useRef<PendingVisualIntent | null>(null);
  const flushVisualInputRef = useRef<() => boolean>(() => true);
  const restoreFocusRef = useRef(false);
  const selfWriteRef = useRef(false);
  const readOnlySnapshotRef =
    useRef<VisualMarkdownReadOnlySnapshot | null>(null);

  const captureSnapshot = useCallback((
    sourceMarkdown: string,
    options: CaptureSnapshotOptions = {}
  ) => {
    prepareVisualTaskListMarkers(surface);
    ensureEmptyVisualParagraph(surface, sourceMarkdown);
    protectVisualMarkdownReadOnlyRegions(surface);
    readOnlySnapshotRef.current =
      captureVisualMarkdownReadOnlySnapshot(surface);
    acceptedPasteDocumentBoundaryRef.current = null;
    lastSelectionRef.current = null;
    visualSelectionMemoryRef.current = null;
    visualSourceIntervalMapRef.current = null;
    pendingVisualIntentRef.current = null;
    pendingVisualIntentResultRef.current = null;
    sourceMarkdownRef.current = sourceMarkdown;
    const visualMarkdown = serializeVisualMarkdown(surface);
    visualMarkdownRef.current = visualMarkdown;
    visualSourceIntervalMapRef.current = options.cacheSourceIntervalMap
      ? createVisualMarkdownSourceIntervalMap(sourceMarkdown, visualMarkdown)
      : null;
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
    acceptedPasteDocumentBoundaryRef.current = null;
    onPendingChange(false);
    onFailure(code);
    onTransferFailure();
  }, [onFailure, onPendingChange, onTransferFailure]);

  const synchronizeMarkdown = useCallback((
    options: SynchronizeMarkdownOptions = {}
  ): boolean => {
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
      if (editedVisualMarkdown === baselineVisualMarkdown) {
        if (options.mapSelectionWhenUnchanged) {
          const mappedSelection = visualSelectionSourceRange(
            surface,
            sourceMarkdown,
            baselineVisualMarkdown,
            editedVisualMarkdown,
            options.acceptedDocumentBoundary
              ? {
                  acceptedPasteDocumentBoundary:
                    options.acceptedDocumentBoundary
                }
              : {}
          );
          lastSelectionRef.current = mappedSelection;
          // CodeMirror owns the canonical selection used by delegated
          // Media operations. This same-value dispatch changes only that
          // selection; its document adapter does not write the document.
          applyDocumentChange({
            selection: mappedSelection,
            value: sourceMarkdown
          });
        }
        visualMarkdownRef.current = editedVisualMarkdown;
        acceptedHtmlRef.current = surface.innerHTML;
        return true;
      }
      const mergeResult = mergeVisualMarkdownChangeDetails(
        sourceMarkdown,
        baselineVisualMarkdown,
        editedVisualMarkdown
      );
      let selection: VisualSelectionSourceRange;
      const inferredEdit = collapsedVisualSelection(surface)
        && 1 === mergeResult.edits.length
        ? mergeResult.edits[0]
        : null;
      if (inferredEdit) {
        const caret = inferredEdit.start + inferredEdit.replacement.length;
        selection = {
          direction: 'none',
          end: caret,
          start: caret
        };
        lastSelectionRef.current = selection;
      } else {
        try {
          selection = visualSelectionSourceRange(
            surface,
            sourceMarkdown,
            baselineVisualMarkdown,
            editedVisualMarkdown
          );
          lastSelectionRef.current = selection;
        } catch (error) {
          if (
            error instanceof Error
            && 'visual-editor-selection-unavailable' === error.message
            && lastSelectionRef.current
          ) {
            selection = lastSelectionRef.current;
          } else {
            throw error;
          }
        }
      }
      const value = mergeResult.value;
      applyDocumentChange({ selection, value });
      sourceMarkdownRef.current = value;
      visualMarkdownRef.current = editedVisualMarkdown;
      visualSourceIntervalMapRef.current = null;
      acceptedHtmlRef.current = surface.innerHTML;
      visualSelectionMemoryRef.current =
        canUseIdentityVisualSelection(
          surface,
          value,
          editedVisualMarkdown,
          { end: selection.end, start: selection.start },
          { end: selection.end, start: selection.start }
        )
        && 'none' === selection.direction
        ? selectionMemoryForCurrentSelection(
            surface,
            { end: selection.end, start: selection.start },
            { end: selection.end, start: selection.start }
          )
        : null;
      if (value !== sourceMarkdown) {
        acceptedPasteDocumentBoundaryRef.current = null;
      }
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
    const hadPendingVisualInput = visualInputPendingRef.current;
    if (!flushVisualInputRef.current()) return;
    if (hadPendingVisualInput && !synchronizeMarkdown()) return;
    const sourceMarkdown = sourceMarkdownRef.current;
    const baselineVisualMarkdown = visualMarkdownRef.current;
    if (null === sourceMarkdown || null === baselineVisualMarkdown) {
      throw new Error('visual-editor-markdown-snapshot-missing');
    }
    try {
      let currentSelection: VisualSelectionSourceRange;
      const acceptedDocumentBoundary =
        acceptedPasteDocumentBoundaryRef.current ?? undefined;
      try {
        currentSelection = visualSelectionSourceRange(
          surface,
          sourceMarkdown,
          baselineVisualMarkdown,
          baselineVisualMarkdown,
          {
            ...(acceptedDocumentBoundary
              ? { acceptedPasteDocumentBoundary: acceptedDocumentBoundary }
              : {})
          }
        );
        lastSelectionRef.current = currentSelection;
      } catch (error) {
        if (
          error instanceof Error
          && 'visual-editor-selection-unavailable' === error.message
          && lastSelectionRef.current
        ) {
          currentSelection = lastSelectionRef.current;
        } else {
          throw error;
        }
      }
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
      const pasteDocumentBoundary =
        0 === caret
          ? 'start'
          : caret === markdown.length
            ? 'end'
            : null;
      applyDocumentChange({ selection, value: markdown });
      onMarkdownChange();
      pendingTransferRef.current = {
        acceptedDocumentBoundary: pasteDocumentBoundary,
        markdown,
        phase: 'requesting',
        selection,
        signature: ''
      };
      onPendingChange(true);
      const signature = requestPreview(markdown);
      pendingTransferRef.current = {
        acceptedDocumentBoundary: pasteDocumentBoundary,
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

  useLayoutEffect(() => {
    let active = true;
    const unsubscribe = documentSession.document.subscribe(() => {
      if (
        !active
        || selfWriteRef.current
        || externalChangeReportedRef.current
        || documentSession.document.getValue() === sourceMarkdownRef.current
      ) {
        return;
      }
      externalChangeReportedRef.current = true;
      onCanonicalDocumentChange();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [documentSession, onCanonicalDocumentChange]);

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
      try {
        if (pending.acceptedDocumentBoundary) {
          placeVisualCaretAtAcceptedPasteDocumentBoundary(
            surface,
            pending.acceptedDocumentBoundary
          );
        } else {
          const visualMarkdown = serializeVisualMarkdown(surface);
          placeVisualCaretFromSourceOffset(
            surface,
            pending.markdown,
            visualMarkdown,
            pending.selection.start
          );
        }
      } catch (error) {
        selectionDiagnostic = visualEditorFailureCode(
          error,
          'visual-editor-selection-restore-failed'
        );
        placeSurfaceCaretAtEnd(surface);
      }
      pendingTransferRef.current = null;
      captureSnapshot(pending.markdown, { cacheSourceIntervalMap: true });
      acceptedPasteDocumentBoundaryRef.current =
        pending.acceptedDocumentBoundary;
      lastSelectionRef.current = pending.selection;
      if (
        pending.acceptedDocumentBoundary
        && visualMarkdownRef.current
        && canUseIdentityVisualSelection(
          surface,
          pending.markdown,
          visualMarkdownRef.current,
          { end: pending.selection.end, start: pending.selection.start },
          {
            end: 'start' === pending.acceptedDocumentBoundary
              ? 0
              : visualMarkdownRef.current.length,
            start: 'start' === pending.acceptedDocumentBoundary
              ? 0
              : visualMarkdownRef.current.length
          }
        )
      ) {
        const visualOffset = 'start' === pending.acceptedDocumentBoundary
          ? 0
          : visualMarkdownRef.current.length;
        visualSelectionMemoryRef.current =
          selectionMemoryForCurrentSelection(
            surface,
            { end: pending.selection.end, start: pending.selection.start },
            { end: visualOffset, start: visualOffset }
          );
      }
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

    const commitPendingVisualIntent = (): boolean => {
      const pending = pendingVisualIntentResultRef.current;
      if (!pending) return false;
      pendingVisualIntentResultRef.current = null;
      if (
        !active
        || pendingTransferRef.current
        || externalChangeReportedRef.current
      ) {
        return false;
      }
      const previousSource = sourceMarkdownRef.current;
      applyDocumentChange({
        selection: pending.result.selection,
        value: pending.result.sourceMarkdown
      });
      sourceMarkdownRef.current = pending.result.sourceMarkdown;
      visualMarkdownRef.current = pending.result.visualMarkdown;
      visualSourceIntervalMapRef.current = null;
      acceptedHtmlRef.current = surface.innerHTML;
      acceptedPasteDocumentBoundaryRef.current = null;
      lastSelectionRef.current = pending.result.selection;
      visualSelectionMemoryRef.current = pending.memory;
      if (previousSource !== pending.result.sourceMarkdown) {
        onMarkdownChange();
      }
      return true;
    };

    const commitVisualInput = (): boolean => {
      if (
        !active
        || pendingTransferRef.current
        || externalChangeReportedRef.current
      ) {
        visualInputPendingRef.current = false;
        pendingVisualIntentResultRef.current = null;
        return false;
      }
      if (commitPendingVisualIntent()) {
        visualInputPendingRef.current = false;
        return true;
      }
      visualInputPendingRef.current = false;
      return synchronizeMarkdown();
    };
    const flushVisualInput = (): boolean => {
      const wasPending = visualInputPendingRef.current;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      if (!wasPending) return true;
      return commitVisualInput();
    };
    const scheduleVisualInput = (): void => {
      visualInputPendingRef.current = true;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
      }
      visualInputTimerRef.current = setTimeout(() => {
        visualInputTimerRef.current = null;
        commitVisualInput();
      }, VISUAL_INPUT_DEBOUNCE_MS);
    };
    flushVisualInputRef.current = flushVisualInput;

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
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
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
    const handleBeforeInput = (event: InputEvent) => {
      pendingVisualIntentRef.current = null;
      if (
        pendingTransferRef.current
        || composing
        || event.isComposing
      ) {
        return;
      }
      const memory = pendingVisualIntentResultRef.current?.memory
        ?? visualSelectionMemoryRef.current;
      const sourceIntervalMap = visualSourceIntervalMapRef.current;
      if (!memory && !sourceIntervalMap) return;
      const base = pendingVisualIntentResultRef.current?.result;
      const sourceMarkdown = base?.sourceMarkdown ?? sourceMarkdownRef.current;
      const visualMarkdown = base?.visualMarkdown ?? visualMarkdownRef.current;
      if (null === sourceMarkdown || null === visualMarkdown) return;
      pendingVisualIntentRef.current = visualInputIntent(
        surface,
        event,
        memory,
        sourceMarkdown.length,
        visualMarkdown.length,
        visualMarkdown,
        sourceIntervalMap
      );
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
      const shortcutApplied = applyVisualInlineShortcut(surface);
      const intent = pendingVisualIntentRef.current;
      pendingVisualIntentRef.current = null;
      if (!shortcutApplied && intent) {
        const base = pendingVisualIntentResultRef.current?.result;
        const sourceMarkdown = base?.sourceMarkdown ?? sourceMarkdownRef.current;
        const visualMarkdown = base?.visualMarkdown ?? visualMarkdownRef.current;
        if (null !== sourceMarkdown && null !== visualMarkdown) {
          const replacement =
            'insertLineBreak' === intent.inputType && null === intent.data
              ? '\n'
              : intent.data ?? '';
          const expectedText = replaceTextRange(
            intent.textData,
            intent.textSelection,
            replacement
          );
          if (intent.textNode.data === expectedText) {
            const result = applyVisualMarkdownEditIntent(
              sourceMarkdown,
              visualMarkdown,
              intent.sourceSelection,
              intent.visualSelection,
              intent.inputType,
              intent.data
            );
            if (result) {
              pendingVisualIntentResultRef.current = {
                memory: selectionMemoryForCurrentSelection(
                  surface,
                  {
                    end: result.selection.end,
                    start: result.selection.start
                  },
                  result.visualSelection
                ),
                result
              };
              scheduleVisualInput();
              return;
            }
          }
        }
      }
      if (pendingVisualIntentResultRef.current) {
        commitPendingVisualIntent();
      }
      scheduleVisualInput();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pendingTransferRef.current) {
        event.preventDefault();
        return;
      }
      if (composing || event.isComposing) return;
      if (!flushVisualInput()) return;
      if (applyVisualBlockShortcut(surface, event)) {
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        synchronizeMarkdown();
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (hasImageFile(event.clipboardData)) {
        if (!imageUploadEnabled || !imagePasteUploadEnabled) {
          event.preventDefault();
        }
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
    surface.addEventListener('beforeinput', handleBeforeInput);
    surface.addEventListener('input', handleInput);
    surface.addEventListener('keydown', handleKeyDown);
    surface.addEventListener('paste', handlePaste);

    const runtime: ImmersiveVisualEditorRuntime = {
      executeCommand(command) {
        if (pendingTransferRef.current) return false;
        if (!flushVisualInput()) return false;
        if (!applyVisualToolbarCommand(surface, command)) return false;
        synchronizeMarkdown();
        surface.focus();
        return true;
      },
      prepareMediaSelection() {
        if (!flushVisualInput()) return false;
        return synchronizeMarkdown({ mapSelectionWhenUnchanged: true });
      },
      prepareToolbarFallback() {
        if (!flushVisualInput()) return false;
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
      flushVisualInput();
      active = false;
      onDispose(runtime);
      surface.removeEventListener('compositionstart', handleCompositionStart);
      surface.removeEventListener('compositionend', handleCompositionEnd);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('beforeinput', handleBeforeInput);
      surface.removeEventListener('input', handleInput);
      surface.removeEventListener('keydown', handleKeyDown);
      surface.removeEventListener('paste', handlePaste);
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      visualInputPendingRef.current = false;
      flushVisualInputRef.current = () => true;
      onPendingChange(false);
    };
  }, [
    captureSnapshot,
    applyDocumentChange,
    documentSession,
    imageUploadEnabled,
    imagePasteUploadEnabled,
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
