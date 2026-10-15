import type {
  EditorClipboardFailureCode,
  EditorClipboardPort,
  EditorClipboardWriteResult
} from '../../contracts/ports/editor-clipboard-port';
import {
  isEditorContextCurrent,
  type EditorContextSnapshot,
  type EditorSelection
} from './editor-context-menu-rules';

export type EditorClipboardCutFailureCode =
  | EditorClipboardFailureCode
  | 'editor-context-menu-context-stale'
  | 'editor-context-menu-selection-empty';

export type EditorClipboardCutResult =
  | Readonly<{ status: 'cut' }>
  | Readonly<{
      code: EditorClipboardCutFailureCode;
      status: 'failed';
    }>;

type CutCurrentContext = Readonly<{
  revision?: number;
  selection: EditorSelection;
  surface: EditorContextSnapshot['surface'];
  value: string;
}>;

export type EditorClipboardCutOptions = Readonly<{
  captured: EditorContextSnapshot;
  clipboard: EditorClipboardPort;
  deleteSelection: () => void;
  getCurrentContext: () => CutCurrentContext;
  signal?: AbortSignal;
}>;

function failedWrite(result: EditorClipboardWriteResult): EditorClipboardCutResult {
  if ('failed' !== result.status) return { status: 'cut' };
  return { code: result.code, status: 'failed' };
}

export async function cutEditorSelection({
  captured,
  clipboard,
  deleteSelection,
  getCurrentContext,
  signal
}: EditorClipboardCutOptions): Promise<EditorClipboardCutResult> {
  if (captured.selection.start === captured.selection.end) {
    return {
      code: 'editor-context-menu-selection-empty',
      status: 'failed'
    };
  }
  const selectedText = captured.value.slice(captured.selection.start, captured.selection.end);
  const writeResult = await (signal
    ? clipboard.write(selectedText, { signal })
    : clipboard.write(selectedText));
  if ('written' !== writeResult.status) return failedWrite(writeResult);
  if (!isEditorContextCurrent(captured, getCurrentContext())) {
    return {
      code: 'editor-context-menu-context-stale',
      status: 'failed'
    };
  }
  deleteSelection();
  return { status: 'cut' };
}
