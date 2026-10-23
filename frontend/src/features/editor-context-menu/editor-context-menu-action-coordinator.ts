import type { EditorContextMenuBootstrapStrings } from "../../contracts/bootstrap/editor-root-bootstrap";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type { EditorImagePixelsPort } from "../../contracts/ports/editor-image-pixels-port";
import type { RemoteImageUploadMode } from "../../contracts/bootstrap/image-upload-bootstrap";
import type { PreviewResponse } from "../../contracts/ports/preview-request";
import type { RemoteImageImportPort } from "../../contracts/ports/remote-image-import-port";
import type { GeneratedContentExportSession } from "../generated-content-export/generated-content-export-session";
import type {
  EditorContextMenuActionContext,
  EditorContextMenuFeatureProps
} from "./EditorContextMenuFeature";
import type { SimplifiedFormattingDomParser } from "./editor-simplified-formatting";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import type {
  EditorContextSnapshot,
  EditorSelection,
  MarkdownBlock
} from "./editor-context-menu-rules";
import {
  createEditorContextMenuOperationOwner,
  type EditorContextMenuActionOperation
} from "./editor-context-menu-operation";
import {
  editorContextSelectionFitsRange,
  blockRangeWithTrailingTerminator,
  type EditorTextEdit
} from "./editor-context-menu-text-edit";
import { isEditorContextCurrent } from "./editor-context-menu-rules";
import type { VisualCanonicalChangeRequest } from "../immersive-editor/ui/ImmersiveVisualEditor";
import { runCodeContextMenuAction } from "./editor-context-menu-code-actions";
import { runGeneratedContextMenuAction } from "./editor-context-menu-generated-actions";
import { runImageContextMenuAction } from "./editor-context-menu-image-actions";
import { runTableContextMenuAction } from "./editor-context-menu-table-actions";
import { runTextContextMenuAction } from "./editor-context-menu-text-actions";

export type EditorContextMenuCurrentContext = Readonly<{
  revision?: number;
  selection: EditorSelection;
  surfaceGeneration?: number;
  surfaceIdentity?: object;
  surface: EditorContextSnapshot["surface"];
  value: string;
}>;

export type EditorContextMenuActionDocument = Readonly<{
  applyTextChange: (
    change: Readonly<{
      changes: NonNullable<EditorTextEdit["changes"]>;
      selection: EditorSelection;
      value: string;
    }>
  ) => void;
  getBlockIndex: (
    surface: EditorContextSnapshot["surface"]
  ) => EditorMarkdownBlockIndex | null | undefined;
  getCurrentContext: (
    surface: EditorContextSnapshot["surface"]
  ) => EditorContextMenuCurrentContext;
  getSelection: () => EditorSelection;
  getValue: () => string;
  isEditable: () => boolean;
  revealPosition: (position: number) => void;
  subscribe: (listener: () => void) => () => void;
  subscribeSelection: (listener: () => void) => () => void;
}>;

export type EditorContextMenuActionVisual = Readonly<{
  applyCanonicalChange: (
    captured: EditorContextSnapshot,
    change: VisualCanonicalChangeRequest["change"]
  ) => boolean;
  executeCommand: (
    command: ToolbarCommand,
    options: Readonly<{ requestPreviewTransfer: boolean }>
  ) => "failed" | "handled" | "unavailable";
  isEditable: () => boolean;
}>;

export type EditorContextMenuCodeCandidatePreview =
  | Readonly<{ response: PreviewResponse; signature: string; status: "available" }>
  | Readonly<{
      code: "editor-code-projection-candidate-unavailable";
      status: "unavailable";
    }>;

/**
 * The complete, declared capability surface Root lends to the context-menu
 * action coordinator. It contains no React setters, Root prop bag, or
 * reference collection: every entry is one named operation whose owner stays
 * in Root/App, and the coordinator cannot reach a second document, history,
 * render, or upload authority through it.
 */
export type EditorContextMenuActionCapabilities = Readonly<{
  clipboard?: EditorClipboardPort;
  contextMenuStrings?: EditorContextMenuBootstrapStrings;
  document: EditorContextMenuActionDocument | null;
  generated: Readonly<{
    exportSession?: GeneratedContentExportSession;
    prepareSourceNavigation: (
      expected: Readonly<{ revision: number; value: string }>,
      validateSource: () => boolean
    ) => boolean;
  }>;
  isActive: () => boolean;
  media: Readonly<{
    imagePixels?: EditorImagePixelsPort;
    imageUpload: Readonly<{
      postId: number;
      remoteImageUploadMode: RemoteImageUploadMode;
    }>;
    openInsertion: (
      captured: EditorContextSnapshot,
      block: MarkdownBlock,
      direction: "above" | "below"
    ) => void;
    remoteImageImport: RemoteImageImportPort;
    requestTableInsertion: (
      captured: EditorContextSnapshot,
      direction: "above" | "below"
    ) => void;
  }>;
  preview: Readonly<{
    render: (markdown: string, signal: AbortSignal) => Promise<PreviewResponse>;
    renderCodeIndentationCandidate: (
      markdown: string,
      signal: AbortSignal
    ) => Promise<EditorContextMenuCodeCandidatePreview>;
  }>;
  report: (code: string, fallback?: string) => void;
  simplifiedFormattingParser?: SimplifiedFormattingDomParser;
  toolbar: Readonly<{
    commands: ReadonlyArray<ToolbarCommand>;
    execute: (commandId: string) => boolean;
  }>;
  visual: EditorContextMenuActionVisual;
}>;

export type EditorContextMenuActionSession = Readonly<{
  actionContext?: EditorContextMenuActionContext;
  applyEdit: (edit: EditorTextEdit | null) => boolean;
  beginOperation: () => EditorContextMenuActionOperation;
  capabilities: EditorContextMenuActionCapabilities;
  captured: EditorContextSnapshot;
  clipboard: EditorClipboardPort;
  currentBlockIndex: () => EditorMarkdownBlockIndex | null | undefined;
  document: EditorContextMenuActionDocument;
  ensureCurrent: (context?: EditorContextSnapshot) => boolean;
  ensureSelectionFitsTarget: (
    range: Readonly<{ from: number; to: number }>
  ) => boolean;
  ensureSourceEditable: () => boolean;
  finishOperation: (operation: EditorContextMenuActionOperation) => void;
  isCurrent: (context?: EditorContextSnapshot) => boolean;
  readValue: () => string;
  report: (code: string, fallback?: string) => void;
}>;

export type EditorContextMenuActionHandler = Readonly<{
  handle: (id: string, session: EditorContextMenuActionSession) => Promise<void> | void;
  owns: (
    id: string,
    actionContext: EditorContextMenuActionContext | undefined,
    capabilities: EditorContextMenuActionCapabilities
  ) => boolean;
}>;

const ACTION_HANDLERS: ReadonlyArray<EditorContextMenuActionHandler> = [
  {
    handle: runTextContextMenuAction,
    owns: (id, _actionContext, capabilities) =>
      [
        "bold",
        "copy",
        "copy-as-html",
        "copy-as-markdown",
        "copy-link-address",
        "copy-simplified-formatting",
        "cut",
        "delete-thematic-break",
        "insert-image-above",
        "insert-image-below",
        "insert-paragraph-above",
        "insert-paragraph-above-code",
        "insert-paragraph-above-table",
        "insert-paragraph-below",
        "insert-paragraph-below-code",
        "insert-paragraph-below-table",
        "insert-table-above",
        "insert-table-below",
        "paste",
        "paste-plain-text"
      ].includes(id)
      || capabilities.toolbar.commands.some(
        (command) =>
          command.id === id
          && "heading-menu" === command.surface
          && "heading" === command.action
      )
  },
  {
    handle: runGeneratedContextMenuAction,
    owns: (id, actionContext) =>
      ("copy-code-block" === id && Boolean(actionContext?.generated))
      || [
        "copy-generated-image",
        "copy-generated-mathml",
        "copy-generated-source",
        "delete-generated-content",
        "edit-generated-content",
        "insert-paragraph-above-generated",
        "insert-paragraph-below-generated"
      ].includes(id)
  },
  {
    handle: runCodeContextMenuAction,
    owns: (id) => [
      "copy-code-block",
      "copy-code-content",
      "delete-code-block",
      "indent-code-block",
      "indent-selected-code"
    ].includes(id)
  },
  {
    handle: runTableContextMenuAction,
    owns: (id) => [
      "align-center",
      "align-left",
      "align-right",
      "copy-table",
      "delete-column",
      "delete-row",
      "delete-table",
      "format-table-source",
      "insert-column-left",
      "insert-column-right",
      "insert-row-above",
      "insert-row-below"
    ].includes(id)
  },
  {
    handle: runImageContextMenuAction,
    owns: (id) =>
      "copy-image" === id
      || "delete-image" === id
      || "upload-image" === id
      || /^image-scale-(25|33|50|67|100|150|200)$/u.test(id)
  }
];

export type EditorContextMenuActionCoordinator = Readonly<{
  dispose: () => void;
  onAction: EditorContextMenuFeatureProps["onAction"];
  recheckOwner: (
    isCurrent: (captured: EditorContextSnapshot) => boolean
  ) => void;
}>;

/**
 * Creates the one action coordinator for the Editor Root.
 *
 * `getCapabilities` is read once when an action starts, not during render.
 * Root implements those capabilities over its existing owners, so the
 * coordinator never receives a React setter, a Root props bag, or a universal
 * executor, and every final mutation still goes through Root's canonical
 * document/visual write.
 */
export function createEditorContextMenuActionCoordinator(input: Readonly<{
  getCapabilities: () => EditorContextMenuActionCapabilities;
}>): EditorContextMenuActionCoordinator {
  const operations = createEditorContextMenuOperationOwner({
    subscribeDocument: (listener) => input.getCapabilities().document?.subscribe(listener) ?? (() => undefined),
    subscribeSelection: (listener) =>
      input.getCapabilities().document?.subscribeSelection(listener) ?? (() => undefined)
  });

  const onAction: EditorContextMenuFeatureProps["onAction"] = async (
    id,
    captured,
    actionContext
  ) => {
    const capabilities = input.getCapabilities();
    const document = capabilities.document;
    const clipboard = capabilities.clipboard;
    if (!document || !clipboard) {
      capabilities.report("editor-context-menu-owner-unavailable");
      return;
    }
    const strings = capabilities.contextMenuStrings;
    const isCurrent = (context: EditorContextSnapshot = captured): boolean =>
      isEditorContextCurrent(context, document.getCurrentContext(context.surface));
    const report = (code: string, fallback?: string): void => {
      capabilities.report(code, fallback);
    };
    const ensureCurrent = (context: EditorContextSnapshot = captured): boolean => {
      if (isCurrent(context)) return true;
      report("editor-context-menu-context-stale", strings?.statusActionFailed);
      return false;
    };
    const ensureSelectionFitsTarget = (
      range: Readonly<{ from: number; to: number }>
    ): boolean => {
      if (
        editorContextSelectionFitsRange(
          captured.selection,
          blockRangeWithTrailingTerminator(captured.value, range)
        )
      ) {
        return true;
      }
      report(
        "editor-context-menu-selection-outside-target",
        strings?.statusActionFailed
      );
      return false;
    };
    const ensureSourceEditable = (): boolean => {
      if ("source" !== captured.surface) return true;
      if (document.isEditable()) return true;
      report(
        "editor-context-menu-surface-read-only",
        strings?.statusActionFailed
      );
      return false;
    };
    const applyEdit = (edit: EditorTextEdit | null): boolean => {
      if (!edit) {
        report(
          "editor-context-menu-edit-unavailable",
          strings?.unsupported
        );
        return false;
      }
      if (!edit.changes) {
        if (edit.value === document.getValue()) return true;
        report(
          "editor-context-menu-edit-unavailable",
          strings?.unsupported
        );
        return false;
      }
      if ("visual" === captured.surface) {
        return capabilities.visual.applyCanonicalChange(captured, {
          changes: edit.changes,
          selection: edit.selection,
          ...(edit.selectionFallback
            ? { selectionFallback: edit.selectionFallback }
            : {}),
          value: edit.value
        });
      }
      // The action gate ran before this mutation, but an awaited browser step
      // (a Clipboard write, an open dialog) can let the authoritative native
      // field become read-only or disabled in between. Re-check at the
      // mutation itself, so a read-only surface never gains a canonical write
      // it did not permit when the action started.
      if (!ensureSourceEditable()) return false;
      document.applyTextChange({
        changes: edit.changes,
        selection: edit.selection,
        value: edit.value
      });
      return true;
    };
    const beginOperation = (): EditorContextMenuActionOperation =>
      operations.begin(captured, () => isCurrent(captured));
    const currentBlockIndex = (): EditorMarkdownBlockIndex | null | undefined =>
      document.getBlockIndex(captured.surface);
    const session: EditorContextMenuActionSession = {
      ...(actionContext ? { actionContext } : {}),
      applyEdit,
      beginOperation,
      capabilities,
      captured,
      clipboard,
      currentBlockIndex,
      document,
      ensureCurrent,
      ensureSelectionFitsTarget,
      ensureSourceEditable,
      finishOperation: operations.finish,
      isCurrent,
      readValue: () => document.getValue(),
      report
    };
    const visualEditable =
      "visual" === captured.surface
        ? capabilities.visual.isEditable()
        : true;
    if (
      ("source" === captured.surface && !document.isEditable())
      || !visualEditable
    ) {
      report(
        "editor-context-menu-surface-read-only",
        strings?.statusActionFailed
      );
      return;
    }
    for (const handler of ACTION_HANDLERS) {
      if (!handler.owns(id, actionContext, capabilities)) continue;
      await handler.handle(id, session);
      return;
    }
    report(
      "editor-context-menu-action-unavailable",
      strings?.unsupported
    );
  };

  return {
    dispose: operations.dispose,
    onAction,
    recheckOwner: operations.recheck
  };
}
