import {
  Fragment,
  createElement,
  flushSync,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { CSSProperties } from 'react';
import { MoreHorizontal } from '../../generated/lucide-icons';

import type { DocumentSourceBootstrap } from '../../contracts/bootstrap/document-source-bootstrap';
import type {
  EditorRootLocalDraftsBootstrap,
  EditorRootPreviewBootstrap,
  EditorRootSettingsBootstrap,
  EditorContextMenuBootstrapStrings
} from '../../contracts/bootstrap/editor-root-bootstrap';
import type {
  AppearanceBootstrap,
  AppearanceState
} from '../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../contracts/bootstrap/font-controls-bootstrap';
import type { ImageUploadBootstrap } from '../../contracts/bootstrap/image-upload-bootstrap';
import type { EditorLayoutBootstrap } from '../../contracts/bootstrap/editor-layout-bootstrap';
import type { MediaPickerBootstrap } from '../../contracts/bootstrap/media-picker-bootstrap';
import type {
  ToolbarBootstrap,
  ToolbarCommand
} from '../../contracts/bootstrap/toolbar-bootstrap';
import type { WechatExportBootstrap } from '../../contracts/bootstrap/wechat-export-bootstrap';
import type { AppearancePort } from '../../contracts/ports/appearance-port';
import type { FontControlsPort } from '../../contracts/ports/font-controls-port';
import type { ImageUploadPort } from '../../contracts/ports/image-upload-port';
import type { RemoteImageImportPort } from '../../contracts/ports/remote-image-import-port';
import type { ImmersiveEnvironmentPort } from '../../contracts/ports/immersive-environment-port';
import type {
  ImmersivePreferencesPort,
  ImmersivePreferencesReadResult
} from '../../contracts/ports/immersive-preferences-port';
import {
  protectedEditorOperationError,
  type EditorSessionOperation,
  type EditorSessionPort
} from '../../contracts/ports/editor-session-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type { NativeSubmissionPort } from '../../contracts/ports/native-submission-port';
import type {
  NativeFeaturedImage,
  NativePublishDraft,
  NativePublishPort,
  NativePublishSnapshot
} from '../../contracts/ports/native-publish-port';
import type {
  MediaPickerDocumentPort,
  MediaPickerDocumentSnapshot,
  MediaPickerFramePort
} from '../../contracts/ports/media-picker-port';
import type {
  PreviewCodeBodyMap,
  PreviewCodeProjection,
  PreviewEditMap,
  PreviewCodeProjectionEntry,
  PreviewRequest,
  PreviewRequestPort,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { RevisionPort } from '../../contracts/ports/revision-port';
import type { ScrollSyncPort } from '../../contracts/ports/scroll-sync-port';
import type { ToolbarShortcutsPort } from '../../contracts/ports/toolbar-shortcuts-port';
import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type {
  EditorImagePixelsLease,
  EditorImagePixelsPort
} from '../../contracts/ports/editor-image-pixels-port';
import type { EditorLinkPort } from '../../contracts/ports/editor-link-port';
import type {
  EditorMarkdownBlockIndexData,
  EditorMarkdownImageIndexData,
  EditorMarkdownBlockIndexPort
} from '../../contracts/ports/editor-block-index-port';
import type {
  WechatClipboardCopyOptions,
  WechatClipboardPort
} from '../../contracts/ports/wechat-clipboard-port';
import type { WechatVisualRasterizationPort } from '../../contracts/ports/wechat-visual-rasterization-port';
import { buildFontStack } from '../../domain/font-stack';
import { formatKeyboardShortcut } from '../../shared/keyboard/keyboard-shortcut';
import {
  isMarkdownTerminalWhitespaceSuffix,
  markdownLineStarts
} from '../../shared/markdown/markdown-line-model';
import {
  AppearanceControls,
  type AppearanceNotification,
  type AppearanceControlsSession
} from '../../features/appearance/ui/AppearanceControls';
import {
  EditorDocumentSource,
  type EditorDocumentSession
} from '../../features/document-source/ui/EditorDocumentSource';
import {
  FontControls,
  type FontControlsSession
} from '../../features/font-controls/ui/FontControls';
import {
  OrdinaryEditorSettings,
  type OrdinaryEditorSettingsSession
} from '../../features/editor-settings/ui/OrdinaryEditorSettings';
import {
  createImageUploadSession,
  createRemoteImageImportCoordinator,
  type ImageUploadStatus
} from '../../features/image-upload/image-upload-session';
import { EditorWorkspace } from '../../features/editor-layout/ui/EditorWorkspace';
import { useEditorSession } from '../../features/editor-session/use-editor-session';
import {
  type PreparedCodeTheme,
  previewEnhancementFailureCode,
  type PreviewEnhancementPort
} from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../../features/live-preview/ports/preview-scroll-port';
import {
  PreviewSurfaceOwner,
  type PreviewAcceptedWindowSnapshot,
  type PreviewImageTargetLease,
  type PreviewImageTargetPinLease,
  type PreviewSurfaceRuntime,
  type PreviewSourceSelection,
  type PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { PreviewWindowDomError } from '../../features/live-preview/ui/preview-window-dom';
import { openMediaPickerSession } from '../../features/media-picker/media-picker-session';
import { WordPressMediaPickerDialog } from '../../features/media-picker/ui/WordPressMediaPickerDialog';
import {
  createLocalDraftSession,
  type LocalDraftSession,
  type LocalDraftSessionStatus
} from '../../features/local-drafts/local-draft-session';
import {
  createToolbarCommandSession,
  type ToolbarCommandPlan
} from '../../features/toolbar/toolbar-command-session';
import {
  EditorContextMenuFeature,
  type EditorContextMenuActionContext,
  type EditorContextMenuGeneratedContext,
  type EditorContextMenuSurface,
  type EditorContextMenuSurfaceSnapshot
} from '../../features/editor-context-menu/EditorContextMenuFeature';
import { EditorTableDialog } from '../../features/editor-context-menu/ui/EditorTableDialog';
import {
  editorContextSelectionFitsRange,
  isEditorContextCurrent,
  findMarkdownBlock,
  findMarkdownTable,
  tableSelectionAt,
  type EditorContextSnapshot
} from '../../features/editor-context-menu/editor-context-menu-rules';
import {
  deleteThematicBreak,
  editMarkdownTable,
  formatMarkdownTableSource,
  insertParagraphRelative,
  setMarkdownTableAlignment,
  type MarkdownTableOperation
} from '../../features/editor-context-menu/editor-context-menu-rules';
import {
  createImageScaleReplacement,
  createMarkdownImageDestinationReplacement,
  findMarkdownImageAt,
  parseMarkdownImageScale,
  type MarkdownImageScaleMatch
} from '../../features/image-scale/image-scale-contract';
import { tableMarkdown } from '../../features/immersive-editor/immersive-editor';
import { cutEditorSelection } from '../../features/editor-context-menu/editor-context-menu-clipboard';
import {
  EditorToolbar,
  type EditorToolbarSession,
  type ToolbarPlatform
} from '../../features/toolbar/ui/EditorToolbar';
import {
  createWechatExportSession,
  type WechatExportStatus
} from '../../features/wechat-export/wechat-export-session';
import {
  ImmersiveEditor,
  ImmersiveToggleIcon
} from '../../features/immersive-editor/ui/ImmersiveEditor';
import { ImmersivePreviewSurface } from '../../features/immersive-editor/ui/ImmersivePreviewSurface';
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from '../../features/live-preview/model/preview-window-model';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime,
  type VisualCanonicalChangeRequest,
  type VisualToolbarCommandResult,
  type VisualPreviewSnapshot
} from '../../features/immersive-editor/ui/ImmersiveVisualEditor';
import { WindowedImmersiveVisualEditor } from '../../features/immersive-editor/ui/WindowedImmersiveVisualEditor';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import { openFeaturedImagePicker } from '../../features/immersive-editor/open-featured-image-picker';
import {
  EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS,
  EditorMessageAlert
} from '../../shared/ui/EditorMessageAlert';
import type { EditorMessageAlertType } from '../../shared/ui/EditorMessageAlert';
import {
  createEditorContextMenuBlockIndexCache,
  type EditorContextMenuBlockIndexCache
} from '../../features/editor-context-menu/editor-context-menu-block-index-cache';
import type {
  EditorMarkdownBlockIndex,
  EditorCodeContentTarget,
  EditorCodeContentReadResult
} from '../../features/editor-context-menu/editor-markdown-block-index';
import {
  findEditorCodeContentTarget,
  readEditorCodeContent
} from '../../features/editor-context-menu/editor-markdown-block-index';
import {
  createEditorCodeContentQuery,
  editorCodeContentReadinessBlocksMenu,
  type EditorCodeContentQueryBinding,
  type EditorCodeContentQuerySession,
  type EditorCodeContentQueryState
} from '../../features/editor-context-menu/editor-code-content-query';
import {
  canIndentEditorCode,
  indentEditorCode
} from '../../features/editor-context-menu/editor-code-indentation';
import {
  encodeEditorCodeProjection,
  type EditorCodeProjectionContentLineRange
} from '../../features/editor-context-menu/editor-code-projection';
import {
  createEditorSourceLinkQuery,
  type EditorSourceLinkQueryBinding,
  type EditorSourceLinkQuerySession,
  type EditorSourceLinkQueryState
} from '../../features/editor-context-menu/editor-source-link-query';
import {
  createSimplifiedFormattingPayload,
  type SimplifiedFormattingDomParser
} from '../../features/editor-context-menu/editor-simplified-formatting';
import type { GeneratedContentExportSession } from '../../features/generated-content-export/generated-content-export-session';
import {
  hydrateGeneratedImageTargetIndex,
  type GeneratedImageTargetIndex
} from '../../features/generated-content-export/generated-image-target';
import { createBrowserEditorImageHydrationScheduler } from '../../integrations/browser/editor-context-menu/create-browser-editor-image-hydration-scheduler';

type EditorStatus = Readonly<{
  id: string;
  message: string;
  owner: 'editor' | 'local-draft';
  type: EditorMessageAlertType;
}>;

function isCancelledVisualTransferFailure(code: string): boolean {
  return [
    'visual-editor-canonical-document-changed',
    'visual-editor-markdown-paste-document-stale',
    'visual-editor-markdown-paste-selection-stale',
    'visual-editor-markdown-paste-superseded',
    'visual-editor-native-preview-document-stale',
    'visual-editor-native-preview-stale'
  ].includes(code);
}

type VisualCanonicalChangeContext = Readonly<{
  revision?: number;
  selection: EditorContextSnapshot['selection'];
  surface: EditorContextSnapshot['surface'];
  value: string;
}>;

type ApplyVisualCanonicalChange = (
  captured: VisualCanonicalChangeContext,
  change: VisualCanonicalChangeRequest['change']
) => boolean;

type ContextMenuOperation = Readonly<{
  captured: EditorContextSnapshot;
  cleanup: () => void;
  controller: AbortController;
}>;

type NativeVisualSelectionRoute =
  | 'boundary'
  | 'collapsed'
  | 'foreign'
  | 'inside'
  | 'invalid'
  | 'none';

function nativeVisualSelectionRoute(
  surface: HTMLElement,
  selection: Selection | null | undefined
): NativeVisualSelectionRoute {
  if (!selection || 0 === selection.rangeCount) return 'none';
  if (
    1 !== selection.rangeCount
    || !selection.anchorNode
    || !selection.focusNode
    || !selection.anchorNode.isConnected
    || !selection.focusNode.isConnected
  ) return 'invalid';
  let range: Range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    return 'invalid';
  }
  if (selection.isCollapsed) return 'collapsed';
  const anchorInside = surface.contains(selection.anchorNode);
  const focusInside = surface.contains(selection.focusNode);
  if (anchorInside && focusInside) return 'inside';
  if (anchorInside !== focusInside) return 'boundary';
  try {
    return range.intersectsNode(surface) ? 'boundary' : 'foreign';
  } catch {
    return 'invalid';
  }
}

function editorCodeContentActionContext(
  state: EditorCodeContentQueryState,
  source?: string,
  selection?: EditorContextSnapshot['selection']
): EditorContextMenuActionContext['code'] | null {
  if ('ready' !== state.status) return null;
  if (
    source
    && selection
    && !editorContextSelectionFitsRange(selection, {
      from: state.target.from,
      to: state.target.to
    })
  ) return null;
  const projectionEntry =
    'available' === state.codeProjection?.status
      ? state.codeProjection.entries.find(
          (entry): entry is Extract<PreviewCodeProjectionEntry, { status: 'available' }> =>
            entry.kind === state.target.kind
            && entry.startLine === state.target.lineStart
            && entry.endLine === state.target.lineEnd
            && 'available' === entry.status
        )
      : undefined;
  const canIndentBlock = Boolean(
    projectionEntry
      && 'fenced' === projectionEntry.kind
      && canIndentEditorCode('', projectionEntry.info)
  );
  let canIndentSelection = false;
  if (
    canIndentBlock
    && source
    && selection
    && selection.start < selection.end
    && projectionEntry
  ) {
    const starts = markdownLineStarts(source);
    const selectedRows = projectionEntry.rows.filter((row) => {
      const lineStart = starts[row.sourceLine] ?? -1;
      const lineEnd = starts[row.sourceLine + 1] ?? source.length;
      return (
        lineStart >= 0
        && selection.start < lineEnd
        && selection.end > lineStart
      );
    });
    canIndentSelection = selectedRows.length > 0;
  }
  return {
    canCopyContent: state.content.length > 0,
    canIndentBlock,
    canIndentSelection,
    codeMap: state.codeMap,
    content: state.content,
    ...(state.codeProjection ? { codeProjection: state.codeProjection } : {}),
    requestSignature: state.requestSignature,
    target: state.target
  };
}

function editorSourceLinkActionContext(
  state: EditorSourceLinkQueryState,
  canOpen: boolean
): EditorContextMenuActionContext['link'] | null {
  if ('ready' !== state.status) return null;
  return { canOpen, href: state.href };
}

function editorCodeProjectionEntry(
  code: NonNullable<EditorContextMenuActionContext['code']>
): Extract<PreviewCodeProjectionEntry, { status: 'available' }> | null {
  const projection = code.codeProjection;
  if ('available' !== projection?.status || !code.target) {
    return null;
  }
  return projection.entries.find(
    (entry): entry is Extract<PreviewCodeProjectionEntry, { status: 'available' }> =>
      'available' === entry.status
      && entry.kind === code.target?.kind
      && entry.startLine === code.target?.lineStart
      && entry.endLine === code.target?.lineEnd
  ) ?? null;
}

function editorCodeContentLineRange(
  code: NonNullable<EditorContextMenuActionContext['code']>,
  source: string,
  selection: EditorContextSnapshot['selection'],
  selected: boolean
): EditorCodeProjectionContentLineRange | null {
  const entry = editorCodeProjectionEntry(code);
  if (!entry) return null;
  const contentLines = code.content?.split(/\r\n|\r|\n/u) ?? [];
  if (
    contentLines.length > 1
    && '' === contentLines[contentLines.length - 1]
  ) contentLines.pop();
  if (!contentLines.length) return null;
  if (!selected) return { end: contentLines.length, start: 0 };
  const starts = markdownLineStarts(source);
  const rows = entry.rows.filter((row) => {
    const lineStart = starts[row.sourceLine] ?? -1;
    const lineEnd = starts[row.sourceLine + 1] ?? source.length;
    return (
      lineStart >= 0
      && selection.start < lineEnd
      && selection.end > lineStart
      && row.contentLine >= 0
      && row.contentLine < contentLines.length
    );
  });
  if (!rows.length || selection.start >= selection.end) return null;
  return {
    end: Math.max(...rows.map((row) => row.contentLine)) + 1,
    start: Math.min(...rows.map((row) => row.contentLine))
  };
}

function rebaseEditorCodeBodyMap(
  codeMap: PreviewCodeBodyMap,
  lineOffset: number
): PreviewCodeBodyMap {
  if ('unavailable' === codeMap.status) return codeMap;
  return {
    ...codeMap,
    entries: codeMap.entries.map((entry) => ({
      ...entry,
      endLine: entry.endLine + lineOffset,
      startLine: entry.startLine + lineOffset
    }))
  };
}

function rebaseEditorCodeProjection(
  projection: PreviewCodeProjection,
  lineOffset: number
): PreviewCodeProjection {
  if ('unavailable' === projection.status) return projection;
  return {
    ...projection,
    entries: projection.entries.map((entry) => ({
      ...entry,
      endLine: entry.endLine + lineOffset,
      ...( 'available' === entry.status
        ? {
            rows: entry.rows.map((row) => ({
              ...row,
              sourceLine: row.sourceLine + lineOffset
            }))
          }
        : {}),
      startLine: entry.startLine + lineOffset
    }))
  };
}

function candidateEditorCodeTarget(
  source: string,
  selection: EditorContextSnapshot['selection'],
  original: NonNullable<EditorContextMenuActionContext['code']>['target'],
  changes: Readonly<{ from: number; insert: string; to: number }>
): EditorCodeContentTarget | null {
  if (!original) return null;
  const delta = changes.insert.length - (changes.to - changes.from);
  const ownerEnd = original.ownerEnd + delta;
  if (
    original.ownerFrom < 0
    || ownerEnd <= original.ownerFrom
    || ownerEnd > source.length
    || selection.start < original.ownerFrom
    || selection.end > ownerEnd
  ) return null;
  const ownerSource = source.slice(original.ownerFrom, ownerEnd);
  const target = findEditorCodeContentTarget(ownerSource, {
    end: selection.end - original.ownerFrom,
    start: selection.start - original.ownerFrom
  });
  if ('unavailable' === target.status) return null;
  return {
    ...target.target,
    bodyFrom: target.target.bodyFrom + original.ownerFrom,
    bodyTo: target.target.bodyTo + original.ownerFrom,
    from: target.target.from + original.ownerFrom,
    ownerEnd,
    ownerFrom: original.ownerFrom,
    ownerLineEnd: target.target.ownerLineEnd + original.ownerLineStart,
    ownerLineStart: original.ownerLineStart,
    to: target.target.to + original.ownerFrom,
    lineEnd: target.target.lineEnd + original.ownerLineStart,
    lineStart: target.target.lineStart + original.ownerLineStart
  };
}

function sameCandidateEditorCodeTarget(
  candidate: EditorCodeContentTarget,
  original: NonNullable<EditorContextMenuActionContext['code']>['target'],
  changes: Readonly<{ from: number; insert: string; to: number }>
): boolean {
  if (!original) return false;
  const delta = changes.insert.length - (changes.to - changes.from);
  return candidate.kind === original.kind
    && candidate.ownerFrom === original.ownerFrom
    && candidate.ownerEnd === original.ownerEnd + delta
    && candidate.from === original.from
    && candidate.to === original.to + delta
    && candidate.bodyFrom === original.bodyFrom
    && candidate.bodyTo === original.bodyTo + delta
    && candidate.lineStart === original.lineStart
    && candidate.lineEnd === original.lineEnd
    && candidate.ownerLineStart === original.ownerLineStart
    && candidate.ownerLineEnd === original.ownerLineEnd;
}

function sameCandidateProjectionEntry(
  candidate: Extract<PreviewCodeProjectionEntry, { status: 'available' }>,
  original: Extract<PreviewCodeProjectionEntry, { status: 'available' }>
): boolean {
  if (
    candidate.kind !== original.kind
    || candidate.startLine !== original.startLine
    || candidate.endLine !== original.endLine
  ) return false;
  if ('fenced' !== candidate.kind || 'fenced' !== original.kind) return true;
  return candidate.info === original.info
    && candidate.fenceOffset === original.fenceOffset;
}

type EditorCodeIndentationCandidateValidation =
  | Readonly<{ status: 'available' }>
  | Readonly<{
      code:
        | 'editor-code-projection-candidate-stale'
        | 'editor-code-projection-candidate-unavailable';
      status: 'unavailable';
    }>;

function validateEditorCodeIndentationCandidate(input: Readonly<{
  candidateSource: string;
  changes: Readonly<{ from: number; insert: string; to: number }>;
  contentLineRange: EditorCodeProjectionContentLineRange;
  desiredSemanticBody: string;
  originalProjectionEntry: Extract<PreviewCodeProjectionEntry, { status: 'available' }>;
  originalTarget: EditorCodeContentTarget;
  response: PreviewResponse;
  selection: EditorContextSnapshot['selection'];
  signature: string;
}>): EditorCodeIndentationCandidateValidation {
  const responseCodeMap = input.response.codeMap;
  const responseProjection = input.response.codeProjection;
  if (!responseCodeMap || !responseProjection) {
    return {
      code: 'editor-code-projection-candidate-unavailable',
      status: 'unavailable'
    };
  }
  if (
    responseCodeMap.signature !== input.signature
    || responseProjection.signature !== input.signature
  ) {
    return {
      code: 'editor-code-projection-candidate-stale',
      status: 'unavailable'
    };
  }
  if (
    'available' !== responseCodeMap.status
    || 'available' !== responseProjection.status
  ) {
    return {
      code: 'editor-code-projection-candidate-unavailable',
      status: 'unavailable'
    };
  }

  const candidateTarget = candidateEditorCodeTarget(
    input.candidateSource,
    input.selection,
    input.originalTarget,
    input.changes
  );
  if (
    !candidateTarget
    || !sameCandidateEditorCodeTarget(
      candidateTarget,
      input.originalTarget,
      input.changes
    )
  ) {
    return {
      code: 'editor-code-projection-candidate-stale',
      status: 'unavailable'
    };
  }

  const codeMap = rebaseEditorCodeBodyMap(
    responseCodeMap,
    candidateTarget.ownerLineStart
  );
  const projection = rebaseEditorCodeProjection(
    responseProjection,
    candidateTarget.ownerLineStart
  );
  if ('available' !== codeMap.status || 'available' !== projection.status) {
    return {
      code: 'editor-code-projection-candidate-unavailable',
      status: 'unavailable'
    };
  }
  const codeMapMatches = codeMap.entries.filter(
    (entry) =>
      entry.kind === candidateTarget.kind
      && entry.startLine === candidateTarget.lineStart
      && entry.endLine === candidateTarget.lineEnd
      && 'available' === entry.status
  );
  const projectionMatches = projection.entries.filter(
    (entry): entry is Extract<PreviewCodeProjectionEntry, { status: 'available' }> =>
      entry.kind === candidateTarget.kind
      && entry.startLine === candidateTarget.lineStart
      && entry.endLine === candidateTarget.lineEnd
      && 'available' === entry.status
  );
  if (1 !== codeMapMatches.length || 1 !== projectionMatches.length) {
    return {
      code: 'editor-code-projection-candidate-stale',
      status: 'unavailable'
    };
  }
  const candidateProjectionEntry = projectionMatches[0];
  if (
    !candidateProjectionEntry
    || !sameCandidateProjectionEntry(
      candidateProjectionEntry,
      input.originalProjectionEntry
    )
  ) {
    return {
      code: 'editor-code-projection-candidate-stale',
      status: 'unavailable'
    };
  }

  const read: EditorCodeContentReadResult = readEditorCodeContent(
    input.candidateSource,
    input.selection,
    undefined,
    {
      codeMap,
      signature: input.signature,
      source: input.candidateSource
    }
  );
  if ('unavailable' === read.status || read.content !== input.desiredSemanticBody) {
    return {
      code: 'editor-code-projection-candidate-stale',
      status: 'unavailable'
    };
  }

  const encoded = encodeEditorCodeProjection({
    codeMap,
    contentLineRange: input.contentLineRange,
    desiredSemanticBody: input.desiredSemanticBody,
    projection,
    selection: input.selection,
    signature: input.signature,
    source: input.candidateSource,
    target: {
      endLine: candidateTarget.lineEnd,
      kind: candidateTarget.kind,
      startLine: candidateTarget.lineStart
    }
  });
  if ('unavailable' === encoded.status || !encoded.noop) {
    return {
      code: 'editor-code-projection-candidate-stale',
      status: 'unavailable'
    };
  }
  return { status: 'available' };
}

type PendingGeneratedContentPin = {
  pin: NonNullable<
    ReturnType<
      PreviewSurfaceRuntime['prepareGeneratedContentTargetForSelection']
    >
  >;
  mode: 'immersive' | 'ordinary';
  revision: number;
  runtime: PreviewSurfaceRuntime;
  selection: Readonly<{ end: number; start: number }>;
  source: string;
  context: EditorContextMenuGeneratedContext | null;
  readinessCancel: (() => void) | null;
};

type GeneratedContentReadinessKey = Readonly<{
  mode: PendingGeneratedContentPin['mode'];
  revision: number;
  runtime: PreviewSurfaceRuntime;
  selection: Readonly<{ end: number; start: number }>;
  source: string;
}>;

type GeneratedContentReadinessFailure = Readonly<{
  code: 'editor-context-menu-generated-content-unavailable';
  key: GeneratedContentReadinessKey;
}>;

const GENERATED_CONTENT_READINESS_TIMEOUT_MS = 10_000;

function generatedContentReadinessKey(
  pending: Pick<
    PendingGeneratedContentPin,
    'mode' | 'revision' | 'runtime' | 'selection' | 'source'
  >
): GeneratedContentReadinessKey {
  return {
    mode: pending.mode,
    revision: pending.revision,
    runtime: pending.runtime,
    selection: pending.selection,
    source: pending.source
  };
}

function sameGeneratedContentReadinessKey(
  left: GeneratedContentReadinessKey,
  right: GeneratedContentReadinessKey
): boolean {
  return (
    left.mode === right.mode
    && left.revision === right.revision
    && left.runtime === right.runtime
    && left.source === right.source
    && left.selection.start === right.selection.start
    && left.selection.end === right.selection.end
  );
}

type PendingImageTargetPin = {
  context: EditorContextMenuActionContext['image'] | null;
  match: MarkdownImageScaleMatch;
  pin: PreviewImageTargetPinLease;
  revision: number;
  runtime: ImageLeaseRuntime;
  selection: Readonly<{ end: number; start: number }>;
  source: string;
};

type VisualPreviewWindowRequest = Readonly<{
  revision: number;
  signature: string;
}>;

export function isVisualPreviewWindowRequestCurrent(
  request: VisualPreviewWindowRequest | null,
  snapshot: Pick<VisualPreviewSnapshot, 'revision' | 'signature'> | null,
  status: PreviewSurfaceStatus,
  active: boolean
): boolean {
  return Boolean(
    active
      && request
      && snapshot
      && 'ready' === status
      && snapshot.revision === request.revision
      && snapshot.signature === request.signature
  );
}

export function visualPreviewSourceHasEditableMap(
  snapshot: Pick<VisualPreviewSnapshot, 'editMap'> | null,
  sourceMarkdown: string | null
): boolean {
  return Boolean(
    snapshot?.editMap
      || (null !== sourceMarkdown
        && isMarkdownTerminalWhitespaceSuffix(sourceMarkdown))
  );
}

export function focusVisualPreviewRuntime(
  runtime: ImmersiveVisualEditorRuntime | null,
  activeElement: () => HTMLElement | null,
  onFailure: (code: string) => void
): boolean {
  const surface = runtime?.surface;
  if (!surface?.isConnected || !surface.isContentEditable) {
    onFailure('visual-editor-focus-surface-unavailable');
    return false;
  }
  surface.focus({ preventScroll: true });
  if (activeElement() === surface) return true;
  onFailure('visual-editor-focus-surface-failed');
  return false;
}

export type EditorRootProps = Readonly<{
  appearance: AppearanceBootstrap;
  appearancePort: AppearancePort;
  document: DocumentSourceBootstrap;
  enhancementPort: PreviewEnhancementPort;
  executeExternalCommand: (
    commandId: string,
    session: EditorDocumentSession
  ) => unknown;
  fontControlsPort: FontControlsPort;
  fonts: FontControlsBootstrap;
  imageUpload: Pick<
    ImageUploadBootstrap,
    | 'allowedExtensions'
    | 'allowedMimeTypes'
    | 'autoUploadPastedImages'
    | 'enabled'
    | 'insertion'
    | 'maxBytes'
    | 'postId'
    | 'remoteImageUploadMode'
    | 'strings'
  >;
  imageUploadPort: ImageUploadPort;
  remoteImageImportPort: RemoteImageImportPort;
  isNewPost: boolean;
  immersiveEnvironment: ImmersiveEnvironmentPort;
  immersiveI18n: Parameters<typeof ImmersiveEditor>[0]['i18n'];
  immersivePreferencesPort: ImmersivePreferencesPort;
  immersiveStrings: Parameters<typeof ImmersiveEditor>[0]['strings'];
  layout: EditorLayoutBootstrap;
  localDrafts: EditorRootLocalDraftsBootstrap;
  localDraftStorage: LocalDraftStoragePort;
  labels: Readonly<{
    preview: string;
    source: string;
    toolbar: string;
  }>;
  mediaPicker: MediaPickerBootstrap;
  mediaPickerFailureMessage: string;
  mediaPickerFrame: MediaPickerFramePort | null;
  nativeSubmissionPort: NativeSubmissionPort;
  nativePublishPort: NativePublishPort;
  onDocumentOwnerChange: (owned: boolean) => void;
  onFailure: (code: string) => void;
  platform: ToolbarPlatform;
  publishPost: (session: EditorDocumentSession) => boolean;
  prepareToolbarShortcuts: (
    surfaces: Readonly<{
      editorRoot: HTMLElement;
      isOwnedTarget?: (target: Element) => boolean;
      source: HTMLElement;
    }>
  ) => ToolbarShortcutsPort;
  preview: EditorRootPreviewBootstrap;
  previewPort: PreviewRequestPort;
  revisionPort: RevisionPort | null;
  restoreRevision: (restoreUrl: string) => void;
  scrollPort: PreviewScrollPort;
  scrollSyncPort: ScrollSyncPort;
  sessionPort: EditorSessionPort;
  settings: EditorRootSettingsBootstrap;
  submissionField: HTMLTextAreaElement;
  titleField: HTMLInputElement | null;
  toolbar: ToolbarBootstrap;
  wechatClipboard: WechatClipboardPort;
  wechatExport: WechatExportBootstrap;
  wechatVisualRasterizationPort?: WechatVisualRasterizationPort | null;
  contextMenuStrings?: EditorContextMenuBootstrapStrings;
  editorClipboardPort?: EditorClipboardPort;
  editorImagePixelsPort?: EditorImagePixelsPort;
  editorBlockIndexPort?: EditorMarkdownBlockIndexPort;
  editorLinkPort?: EditorLinkPort;
  generatedContentExportSession?: GeneratedContentExportSession;
  simplifiedFormattingParser?: SimplifiedFormattingDomParser;
}>;

type ActiveToolbarProps = Readonly<{
  editorRoot: HTMLElement;
  executeVisualCommand?: (
    command: ToolbarCommand,
    plan?: () => ToolbarCommandPlan | null
  ) => VisualToolbarCommandResult;
  executeExternalCommand: EditorRootProps['executeExternalCommand'];
  isOwnedShortcutTarget?: (target: Element) => boolean;
  platform: ToolbarPlatform;
  prepareToolbarShortcuts: EditorRootProps['prepareToolbarShortcuts'];
  onPopoverOpen: (focusTarget?: HTMLElement) => void;
  onExecuteCommandReady?: (
    execute: ((commandId: string) => void) | null
  ) => void;
  onReady: (session: EditorToolbarSession) => void;
  session: EditorDocumentSession;
  toolbar: ToolbarBootstrap;
  variant?: 'default' | 'immersive';
}>;

type RootExportCommandsProps = Readonly<{
  executeCommand: (commandId: string) => void;
  platform: ToolbarPlatform;
  toolbar: ToolbarBootstrap;
}>;

const WECHAT_ICON_PATHS = [
  'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
  'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
  'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
] as const;
const WECHAT_PREPARATION_DEBOUNCE_MS = 180;

function immersiveModeFromEditingMode(editingMode: string): ImmersiveViewMode {
  switch (editingMode) {
    case 'live-preview':
      return 'split';
    case 'source':
      return 'source';
    case 'preview':
      return 'preview';
    default:
      throw new Error('editor-root-immersive-editing-mode-invalid');
  }
}

function WechatIcon() {
  return (
    <span className="easymde-wechat-glyph" aria-hidden="true">
      <svg viewBox="0 0 40 40" focusable="false" aria-hidden="true">
        {WECHAT_ICON_PATHS.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    </span>
  );
}

function RootExportCommands({
  executeCommand,
  platform,
  toolbar
}: RootExportCommandsProps) {
  const commands = toolbar.commands.filter(
    (command) => 'main' === command.surface && 'export' === command.group
  );
  if (!commands.length) {
    return null;
  }

  return (
    <Fragment>
      {commands.map((command) => {
        const shortcut = formatKeyboardShortcut(
          toolbar.shortcuts[command.id]?.[platform] ?? ''
        );
        const title = shortcut
          ? `${command.label} (${shortcut})`
          : command.label;
        return (
          <button
            key={command.id}
            type="button"
            className={`easymde-toolbar-button easymde-toolbar-button-compact${'copyWechat' === command.action ? ' easymde-toolbar-copy-action' : ''}`}
            data-easymde-command={command.id}
            aria-label={command.label}
            title={title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand(command.id)}
          >
            {'copyWechat' === command.action ? (
              <WechatIcon />
            ) : (
              <span
                className={`dashicons dashicons-${command.icon}`}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
      <span className="easymde-toolbar-divider" aria-hidden="true" />
    </Fragment>
  );
}

function ActiveToolbar({
  editorRoot,
  executeVisualCommand,
  executeExternalCommand,
  isOwnedShortcutTarget,
  platform,
  prepareToolbarShortcuts,
  onPopoverOpen,
  onExecuteCommandReady,
  onReady,
  session,
  toolbar,
  variant = 'default'
}: ActiveToolbarProps) {
  const [canUndo, setCanUndo] = useState(() => session.document.canUndo());
  const commandSessionRef = useRef<ReturnType<
    typeof createToolbarCommandSession
  > | null>(null);
  if (!commandSessionRef.current) {
    commandSessionRef.current = createToolbarCommandSession({
      commands: toolbar.commands,
      document: {
        applyTextChange: session.document.applyTextChange,
        focus: session.document.focus,
        getSnapshot: () => ({
          selection: session.document.getSelection(),
          value: session.document.getValue()
        })
      },
      executeExternalCommand: (commandId) =>
        executeExternalCommand(commandId, session),
      linkText: toolbar.linkText
    });
  }
  const commandSession = commandSessionRef.current;
  const executeCommand = useCallback(
    (commandId: string) => {
      if (executeVisualCommand) {
        const command = toolbar.commands.find(({ id }) => id === commandId);
        if (!command) throw new Error('visual-toolbar-command-missing');
        if (
          'unsupported'
          !== executeVisualCommand(command, () =>
            commandSession.plan(commandId)
          )
        )
          return;
      }
      if (commandSession.owns(commandId)) {
        commandSession.execute(commandId);
        return;
      }
      executeExternalCommand(commandId, session);
    },
    [
      commandSession,
      executeExternalCommand,
      executeVisualCommand,
      session,
      toolbar.commands
    ]
  );

  useEffect(() => {
    const binding = prepareToolbarShortcuts({
      editorRoot,
      ...(isOwnedShortcutTarget
        ? { isOwnedTarget: isOwnedShortcutTarget }
        : {}),
      source: session.document.getInputElement()
    }).prepareBinding(executeCommand);
    binding.activate();

    return () => binding.dispose();
  }, [
    executeCommand,
    editorRoot,
    isOwnedShortcutTarget,
    prepareToolbarShortcuts
  ]);

  useEffect(() => {
    onExecuteCommandReady?.(executeCommand);
    return () => onExecuteCommandReady?.(null);
  }, [executeCommand, onExecuteCommandReady]);

  useEffect(() => () => commandSession.dispose(), [commandSession]);
  useEffect(
    () =>
      session.document.subscribe(() => {
        setCanUndo(session.document.canUndo());
      }),
    [session]
  );
  return (
    <EditorToolbar
      bootstrap={toolbar}
      canUndo={canUndo}
      platform={platform}
      executeCommand={executeCommand}
      onPopoverOpen={onPopoverOpen}
      onReady={onReady}
      undo={session.document.undo}
      variant={variant}
    />
  );
}

function previewRequest(
  markdown: string,
  preview: EditorRootPreviewBootstrap,
  appearance: AppearanceState,
  revision: number
): PreviewRequest {
  return {
    markdown,
    postId: preview.postId,
    markdownTheme: appearance.markdownTheme,
    codeTheme: appearance.codeTheme,
    customCssId: appearance.customCssId,
    signature: `${revision}:${markdown.length}`
  };
}

export function schedulePreviewWithDocumentEndPin(
  runtime: Pick<
    PreviewSurfaceRuntime,
    'prepareDocumentEndWindowPin' | 'session'
  >,
  request: PreviewRequest,
  onHistoryPendingChange?: (pending: boolean) => void,
  onHistorySelectionRestored?: () => void,
  sourceSelection?: PreviewSourceSelection
): Readonly<{
  onSelectionRestored: () => void;
  release: () => void;
  signature: string;
}> {
  onHistoryPendingChange?.(true);
  let lease: ReturnType<
    PreviewSurfaceRuntime['prepareDocumentEndWindowPin']
  > | null = null;
  try {
    lease = runtime.prepareDocumentEndWindowPin(
      request.signature,
      sourceSelection
    );
    runtime.session.schedule(request, true);
  } catch (error) {
    try {
      lease?.release();
    } finally {
      onHistoryPendingChange?.(false);
    }
    throw error;
  }
  if (!lease) throw new Error('preview-document-end-pin-not-prepared');
  let released = false;
  let selectionRestored = false;
  return {
    onSelectionRestored: () => {
      if (released || selectionRestored) return;
      selectionRestored = true;
      onHistorySelectionRestored?.();
    },
    release: () => {
      if (released) return;
      released = true;
      try {
        lease?.release();
      } finally {
        onHistoryPendingChange?.(false);
      }
    },
    signature: request.signature
  };
}

export function visualPreviewUsesWindowedOwner(
  needsWindow: boolean,
  historyOwnerPending: boolean,
  editing: boolean,
  requested: boolean
): boolean {
  return (needsWindow || historyOwnerPending) && (editing || requested);
}

export function visualPreviewSurfaceUsesWindowedOwner(
  needsWindow: boolean,
  historyOwnerPending: boolean,
  previewPending: boolean,
  editing: boolean,
  requested: boolean
): boolean {
  return (
    (needsWindow || historyOwnerPending || previewPending)
    && (editing || requested)
  );
}

export function visualPreviewSurfaceWindowedForVisibility(
  currentWindowed: boolean,
  previewVisible: boolean,
  needsWindow: boolean
): boolean {
  return currentWindowed || (!previewVisible && needsWindow);
}

export function scheduleVisualWindowedHistoryBranchRelease(
  isDocumentEndHistoryPending: () => boolean,
  hasRedo: () => boolean,
  release: () => void,
  enqueue: (callback: () => void) => void = queueMicrotask
): void {
  enqueue(() => {
    if (!isDocumentEndHistoryPending() && !hasRedo()) release();
  });
}

function previewScrollCanvas(surface: HTMLElement): HTMLElement {
  const canvas = surface.parentElement;
  if (!canvas?.classList.contains('easymde-immersive-preview-canvas')) {
    throw new Error('preview-scroll-canvas-missing');
  }
  return canvas;
}

function documentPort(
  session: EditorDocumentSession,
  isActive: () => boolean
): MediaPickerDocumentPort {
  return {
    applyTextChange: (change) => {
      if (!isActive()) {
        throw new Error('editor-root-document-session-inactive');
      }
      session.document.applyTextChange(change);
    },
    focus: () => {
      if (isActive()) {
        session.document.focus();
      }
    },
    getSnapshot: () => {
      if (!isActive()) {
        throw new Error('editor-root-document-session-inactive');
      }
      return {
        selection: session.document.getSelection(),
        value: session.document.getValue()
      };
    }
  };
}

function visualMediaPickerDocument(
  session: EditorDocumentSession,
  expected: VisualCanonicalChangeContext,
  isActive: () => boolean,
  focus: () => void,
  apply: ApplyVisualCanonicalChange
): MediaPickerDocumentPort {
  const currentSnapshot = (): MediaPickerDocumentSnapshot => {
    if (!isActive()) {
      throw new Error('editor-root-document-session-inactive');
    }
    return {
      selection: session.document.getSelection(),
      value: session.document.getValue()
    };
  };

  return {
    applyTextChange: (change) => {
      if (!isActive()) {
        throw new Error('editor-root-document-session-inactive');
      }
      const { end, start } = expected.selection;
      const suffixLength = expected.value.length - end;
      const suffixStart = change.value.length - suffixLength;
      if (
        suffixStart < start
        || change.value.slice(0, start) !== expected.value.slice(0, start)
        || change.value.slice(suffixStart) !== expected.value.slice(end)
      ) {
        throw new Error('media-picker-document-stale');
      }
      if (
        !apply(expected, {
          changes: {
            from: start,
            insert: change.value.slice(start, suffixStart),
            to: end
          },
          selection: change.selection,
          value: change.value
        })
      ) {
        throw new Error('media-picker-visual-canonical-change-failed');
      }
    },
    focus: () => {
      if (isActive()) focus();
    },
    getSnapshot: currentSnapshot
  };
}

function mediaPickerFailureCode(error: unknown): string {
  return error instanceof Error
    && /^media-picker-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : 'media-picker-operation-failed';
}

const CONTEXT_MENU_ERROR_CODES = new Set([
  'editor-context-menu-context-stale',
  'editor-context-menu-image-stale',
  'editor-context-menu-html-copy-failed',
  'editor-context-menu-image-upload-failed',
  'editor-context-menu-clipboard-deferred-unsupported'
]);

function contextMenuErrorCode(error: unknown, fallback: string): string {
  return error instanceof Error
    && (CONTEXT_MENU_ERROR_CODES.has(error.message)
      || /^editor-simplified-formatting-[a-z0-9-]+$/u.test(error.message))
    ? error.message
    : fallback;
}

function editorBlockIndexFailureCode(error: unknown): string {
  return error instanceof Error
    && /^editor-block-index-[a-z0-9-]+$/u.test(error.message)
    ? error.message
    : 'editor-context-menu-block-index-failed';
}

async function editorBlockIndexFromData(
  source: string,
  data: EditorMarkdownBlockIndexData,
  revision: number,
  signal: AbortSignal,
  deadline: number,
  scheduler: Readonly<{
    now: () => number;
    yield: () => Promise<void>;
  }>
): Promise<EditorMarkdownBlockIndex> {
  if (data.length !== source.length) {
    throw new Error('editor-block-index-result-invalid');
  }
  const index = { ...data, source };
  if (!isPreparedImageIndex(index)) {
    throw new Error('editor-block-index-image-data-required');
  }
  const preparedImageIndex = await hydrateGeneratedImageTargetIndex({
    blocks: index.blocks,
    deadline,
    imageIndex: index,
    now: scheduler.now,
    revision,
    signal,
    source,
    yield: scheduler.yield
  });
  return {
    ...index,
    preparedImageTargetIndex: preparedImageIndex
  } as EditorMarkdownBlockIndex;
}

function generatedRootAtTarget(
  target: Element | null,
  kind: 'math' | 'mermaid'
): Readonly<{ ordinal: number; root: HTMLElement }> | null {
  if (!target) return null;
  const selector = 'math' === kind ? '.easymde-math' : '.easymde-mermaid';
  const root = target.closest(selector);
  const block = root?.closest<HTMLElement>('[data-easymde-visual-block-id]');
  if (!(root instanceof HTMLElement) || !block) return null;
  const roots = (
    block.matches(selector)
      ? [block, ...Array.from(block.querySelectorAll<HTMLElement>(selector))]
      : Array.from(block.querySelectorAll<HTMLElement>(selector))
  )
    .filter(
      (candidate) =>
        candidate.closest('[data-easymde-visual-block-id]') === block
    )
    .filter(
      (candidate) =>
        candidate === block
        || candidate.parentElement?.closest(selector) === null
    );
  const ordinal = roots.indexOf(root);
  return ordinal < 0 ? null : { ordinal, root };
}

function generatedMathMlAvailable(root: Element): boolean {
  const katex = root.matches('.katex')
    ? root
    : root.querySelector(':scope > .katex, :scope > .katex-display > .katex');
  return Boolean(katex?.querySelector(':scope > .katex-mathml > math'));
}

function sameGeneratedContentSelection(
  left: Readonly<{ end: number; start: number }>,
  right: Readonly<{ end: number; start: number }>
): boolean {
  return left.start === right.start && left.end === right.end;
}

type EditorMarkdownBlockIndexWithImages = EditorMarkdownBlockIndex &
  EditorMarkdownImageIndexData;

type EditorMarkdownBlockIndexWithPreparedImages =
  EditorMarkdownBlockIndexWithImages &
    Readonly<{
      preparedImageTargetIndex: GeneratedImageTargetIndex;
    }>;

function isPreparedImageIndex(
  blockIndex: EditorMarkdownBlockIndex | null | undefined
): blockIndex is EditorMarkdownBlockIndexWithImages {
  return Boolean(
    blockIndex
      && Array.isArray(
        (blockIndex as Partial<EditorMarkdownBlockIndexWithImages>).imageBlocks
      )
      && Array.isArray(
        (blockIndex as Partial<EditorMarkdownBlockIndexWithImages>).imageRanges
      )
  );
}

function preparedImageMatch(
  index: GeneratedImageTargetIndex,
  selection: Readonly<{ end: number; start: number }>
): MarkdownImageScaleMatch | null {
  let low = 0;
  let high = index.blocks.length - 1;
  let blockPosition = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const block = index.blocks[middle];
    if (!block) break;
    if (selection.start < block.from) {
      high = middle - 1;
    } else if (selection.start >= block.to) {
      low = middle + 1;
    } else {
      blockPosition = middle;
      break;
    }
  }
  if (blockPosition < 0) return null;
  const blockImages = index.blockImages[blockPosition];
  if (!blockImages || 'unavailable' === blockImages.status) return null;
  const images = blockImages.images;
  low = 0;
  high = images.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const image = images[middle];
    if (!image) break;
    if (image.start <= selection.start) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const image = candidate < 0 ? undefined : images[candidate];
  if (!image) return null;
  const collapsed =
    selection.start === selection.end
    && selection.start > image.start
    && selection.start < image.end;
  const ranged =
    selection.start !== selection.end
    && image.start <= selection.start
    && image.end >= selection.end;
  return collapsed || ranged ? image : null;
}

function preparedImageTargetIndex(
  source: string,
  revision: number | undefined,
  blockIndex: EditorMarkdownBlockIndex | null | undefined,
  selection: Readonly<{ end: number; start: number }>
): Readonly<{
  image: MarkdownImageScaleMatch;
  index: GeneratedImageTargetIndex;
}> | null {
  if (
    undefined === revision
    || !blockIndex
    || blockIndex.source !== source
    || blockIndex.length !== source.length
    || !isPreparedImageIndex(blockIndex)
    || !('preparedImageTargetIndex' in blockIndex)
  )
    return null;
  const index = (blockIndex as EditorMarkdownBlockIndexWithPreparedImages)
    .preparedImageTargetIndex;
  if (index.revision !== revision || index.source !== source) return null;
  const image = preparedImageMatch(index, selection);
  return image ? { image, index } : null;
}

type ImageLeaseRuntime = Pick<
  PreviewSurfaceRuntime,
  'prepareImageTarget' | 'prepareImageTargetBySelection' | 'surface'
>;

function leaseForVisualImage(
  runtime: ImageLeaseRuntime | null,
  index: GeneratedImageTargetIndex,
  selected: MarkdownImageScaleMatch,
  element: HTMLImageElement | null
): PreviewImageTargetLease | null {
  if (!runtime?.surface.isConnected || !element) return null;
  const lease = runtime.prepareImageTarget({
    element,
    index,
    selection: { end: selected.end, start: selected.start }
  });
  if (
    !lease
    || lease.target.original.start !== selected.start
    || lease.target.original.end !== selected.end
  ) {
    lease?.release();
    return null;
  }
  return lease;
}

function imageActionContext(
  port: EditorImagePixelsPort | undefined,
  lease: PreviewImageTargetLease | null,
  match: MarkdownImageScaleMatch
): EditorContextMenuActionContext['image'] | null {
  if (!lease) return { canCopyImage: false, match };
  const pixelLease: EditorImagePixelsLease = {
    image: lease.root,
    isCurrent: lease.isCurrent
  };
  let canCopyImage = false;
  try {
    canCopyImage = Boolean(port?.supports() && port.canExtract(pixelLease));
  } catch {
    canCopyImage = false;
  }
  return { canCopyImage, lease, match };
}

function isPreviewSelectionUnavailable(error: unknown): boolean {
  return (
    error instanceof PreviewWindowDomError
    && (error.message === 'preview-window-selection-block-unavailable'
      || error.message === 'preview-window-selection-map-invalid'
      || error.message === 'preview-window-selection-range-invalid')
  );
}

function supportsEditorPngClipboard(
  port: EditorClipboardPort | undefined
): boolean {
  try {
    return (
      Boolean(port?.writeImageDeferred) && port?.supportsPngWrite?.() === true
    );
  } catch {
    return false;
  }
}

function supportsEditorRichClipboard(
  port: EditorClipboardPort | undefined
): boolean {
  try {
    return (
      Boolean(port?.writeRichDeferred)
      && (undefined === port?.supportsRichWrite
        || port.supportsRichWrite() === true)
    );
  } catch {
    return false;
  }
}

function articleMarkupProfile(
  bootstrap: AppearanceBootstrap,
  state: AppearanceState
): string {
  if ('custom' === state.markdownTheme) return bootstrap.customMarkupProfile;
  const theme = bootstrap.articleThemes.find(
    ({ id }) => id === state.markdownTheme
  );
  if (!theme) {
    throw new Error('appearance-article-theme-markup-profile-missing');
  }
  return theme.markupProfile;
}

export function EditorRoot(props: EditorRootProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contextMenuPortalOwnerRef = useRef<HTMLElement | null>(null);
  const registerContextMenuPortalOwner = useCallback(
    (element: HTMLElement | null): void => {
      contextMenuPortalOwnerRef.current = element;
    },
    []
  );
  const isOwnedShortcutTarget = useCallback((target: Element): boolean => {
    const owner = contextMenuPortalOwnerRef.current;
    return Boolean(owner?.isConnected && owner.contains(target));
  }, []);
  const immersiveToggleRef = useRef<HTMLButtonElement>(null);
  const restoreImmersiveFocusRef = useRef(false);
  const appearanceSessionRef = useRef<AppearanceControlsSession | null>(null);
  const fontControlsSessionRef = useRef<FontControlsSession | null>(null);
  const ordinarySettingsSessionRef =
    useRef<OrdinaryEditorSettingsSession | null>(null);
  const toolbarSessionRef = useRef<EditorToolbarSession | null>(null);
  const contextMenuExecutorRef = useRef<((commandId: string) => void) | null>(
    null
  );
  const contextMenuOperationRef = useRef<ContextMenuOperation | null>(null);
  const editorCodeContentQueryRef =
    useRef<EditorCodeContentQuerySession | null>(null);
  const editorCodeContentQuerySequenceRef = useRef(0);
  const editorCodeContentFailureRef = useRef<string | null>(null);
  const editorCodeIndentationCandidateSequenceRef = useRef(0);
  const editorSourceLinkQueryRef =
    useRef<EditorSourceLinkQuerySession | null>(null);
  const editorSourceLinkQuerySequenceRef = useRef(0);
  const pendingGeneratedContentPinRef =
    useRef<PendingGeneratedContentPin | null>(null);
  const pendingImageTargetPinRef = useRef<PendingImageTargetPin | null>(null);
  const generatedContentReadinessFailureRef =
    useRef<GeneratedContentReadinessFailure | null>(null);
  const contextMenuReadinessListenersRef = useRef(new Set<() => void>());
  const contextMenuBlockIndexCacheRef =
    useRef<EditorContextMenuBlockIndexCache | null>(null);
  const contextMenuBlockIndexFailureRef = useRef<Readonly<{
    code: string;
    generation: number;
    owner: object;
    revision: number;
    source: string;
  }> | null>(null);
  if (!contextMenuBlockIndexCacheRef.current) {
    const cacheClock = createBrowserEditorImageHydrationScheduler(
      props.submissionField.ownerDocument,
      new AbortController().signal
    );
    contextMenuBlockIndexCacheRef.current =
      createEditorContextMenuBlockIndexCache({
        now: cacheClock.now
      });
  }
  const releasePendingGeneratedContentPin = useCallback(
    (preserveFailure = false) => {
      const pending = pendingGeneratedContentPinRef.current;
      pendingGeneratedContentPinRef.current = null;
      if (!preserveFailure) generatedContentReadinessFailureRef.current = null;
      pending?.readinessCancel?.();
      if (pending) {
        pending.readinessCancel = null;
      }
      pending?.pin.release();
    },
    []
  );
  const releasePendingImageTargetPin = useCallback(() => {
    const pending = pendingImageTargetPinRef.current;
    pendingImageTargetPinRef.current = null;
    pending?.pin.release();
  }, []);
  const releasePendingContextResources = useCallback(
    (reason?: 'cancelled' | 'unavailable') => {
      editorCodeContentQueryRef.current?.cancel();
      editorSourceLinkQueryRef.current?.cancel();
      releasePendingGeneratedContentPin(
        'cancelled' === reason || 'unavailable' === reason
      );
      releasePendingImageTargetPin();
    },
    [releasePendingGeneratedContentPin, releasePendingImageTargetPin]
  );
  const subscribeContextMenuReadiness = useCallback(
    (listener: () => void): (() => void) => {
      contextMenuReadinessListenersRef.current.add(listener);
      return () => contextMenuReadinessListenersRef.current.delete(listener);
    },
    []
  );
  const notifyContextMenuReadiness = useCallback(() => {
    for (const listener of contextMenuReadinessListenersRef.current) listener();
  }, []);
  const previewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const visualEditorRuntimeRef = useRef<ImmersiveVisualEditorRuntime | null>(
    null
  );
  const lastVisualFailureRef = useRef<string | null>(null);
  const applyVisualCanonicalChangeRef =
    useRef<ApplyVisualCanonicalChange | null>(null);
  const acceptedWindowSnapshotKeyRef = useRef<number | null>(null);
  const scheduledPreviewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const scheduledWechatPreparationRef = useRef<(() => void) | null>(null);
  const wechatBackgroundPreparationRef = useRef<{
    controller: AbortController;
  } | null>(null);
  const previewRevisionRef = useRef(0);
  const previewAppearanceRef = useRef(props.appearance.state);
  const previewRefreshPendingRef = useRef(false);
  const codeThemePreparationRef = useRef<{
    controller: AbortController;
    generation: number;
    owner: 'appearance' | 'visual-unlock';
    prepared: PreparedCodeTheme | null;
    sourceMarkdown?: string;
  } | null>(null);
  const codeThemePreparationGenerationRef = useRef(0);
  const codeThemeFrameSyncPendingRef = useRef<string | null>(null);
  const syncedVisualCodeFramesRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
  const codeThemeExplicitRef = useRef(props.appearance.codeThemeExplicit);
  const localDraftSessionRef = useRef<LocalDraftSession | null>(null);
  const mediaOperationRef = useRef<Promise<unknown> | null>(null);
  const featuredImageOperationRef =
    useRef<Promise<NativeFeaturedImage | null> | null>(null);
  const imageUploadOperationSequenceRef = useRef(0);
  const rootActiveRef = useRef(true);
  const scheduleGeneratedContentReadiness = useCallback(
    (pending: PendingGeneratedContentPin): void => {
      const key = generatedContentReadinessKey(pending);
      const deadline =
        props.immersiveEnvironment.now()
        + GENERATED_CONTENT_READINESS_TIMEOUT_MS;
      const arm = (delay: number): void => {
        pending.readinessCancel = props.immersiveEnvironment.schedule(
          () => {
            if (
              !rootActiveRef.current
              || pendingGeneratedContentPinRef.current !== pending
            )
              return;
            const remaining = deadline - props.immersiveEnvironment.now();
            if (remaining > 0) {
              arm(remaining);
              return;
            }
            pendingGeneratedContentPinRef.current = null;
            pending.readinessCancel = null;
            pending.pin.release();
            generatedContentReadinessFailureRef.current = {
              code: 'editor-context-menu-generated-content-unavailable',
              key
            };
            notifyContextMenuReadiness();
          },
          Math.max(0, delay)
        );
      };
      arm(GENERATED_CONTENT_READINESS_TIMEOUT_MS);
    },
    [notifyContextMenuReadiness, props.immersiveEnvironment]
  );
  const initialSubmissionStateRef = useRef({
    ...props.appearance.state,
    codeThemeExplicit: props.appearance.codeThemeExplicit,
    ...props.fonts.state
  });
  const submissionStateRef = useRef(initialSubmissionStateRef.current);
  const [documentSession, setDocumentSession] =
    useState<EditorDocumentSession | null>(null);
  const [immersivePreferences, setImmersivePreferences] =
    useState<ImmersivePreferencesReadResult>(() =>
      props.immersivePreferencesPort.read()
    );
  const [draftCandidate, setDraftCandidate] = useState(false);
  const [draftUnreadable, setDraftUnreadable] = useState(false);
  const [editorStatusState, setEditorStatusState] = useState<{
    focused: boolean;
    status: EditorStatus | null;
  }>({ focused: false, status: null });
  const editorStatus = editorStatusState.status;
  const editorStatusFocused = editorStatusState.focused;
  const editorStatusTimerRef = useRef<{
    deadline: number | null;
    remaining: number;
    status: EditorStatus | null;
  }>({
    deadline: null,
    remaining: EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS,
    status: null
  });
  const [previewRuntimeGeneration, setPreviewRuntimeGeneration] = useState(0);
  const [
    acceptedWindowSnapshotGeneration,
    setAcceptedWindowSnapshotGeneration
  ] = useState(0);
  const [previewRefreshRevision, setPreviewRefreshRevision] = useState(0);
  const [previewSurfaceStatus, setPreviewSurfaceStatus] =
    useState<PreviewSurfaceStatus>('loading');
  const previewSurfaceStatusRef = useRef(previewSurfaceStatus);
  previewSurfaceStatusRef.current = previewSurfaceStatus;
  const [visualPreviewSnapshot, setVisualPreviewSnapshot] = useState<
    | (VisualPreviewSnapshot & {
        editMap: PreviewEditMap | null;
        html: SafePreviewHtml;
      })
    | null
  >(null);
  const visualPreviewSnapshotRef = useRef(visualPreviewSnapshot);
  visualPreviewSnapshotRef.current = visualPreviewSnapshot;
  const [visualPreviewEditing, setVisualPreviewEditing] = useState(false);
  const [visualPreviewWindowRequested, setVisualPreviewWindowRequested] =
    useState(false);
  const visualPreviewWindowRequestedRef = useRef(false);
  const visualPreviewSurfaceWindowedRef = useRef(false);
  const visualPreviewWindowUnlockRef =
    useRef<VisualPreviewWindowRequest | null>(null);
  const visualPreviewLockingRef = useRef(false);
  const [visualPreviewUnlocking, setVisualPreviewUnlocking] = useState(false);
  const visualPreviewUnlockingRef = useRef(visualPreviewUnlocking);
  visualPreviewUnlockingRef.current = visualPreviewUnlocking;
  const [visualPreviewPending, setVisualPreviewPending] = useState(false);
  const [visualDocumentEndHistoryPending, setVisualDocumentEndHistoryPending] =
    useState(false);
  const visualDocumentEndHistoryPendingRef = useRef(false);
  visualDocumentEndHistoryPendingRef.current = visualDocumentEndHistoryPending;
  const [visualWindowedHistoryBranchHeld, setVisualWindowedHistoryBranchHeld] =
    useState(false);
  const [visualEditorSurface, setVisualEditorSurface] =
    useState<HTMLElement | null>(null);
  const [visualEditorGeneration, setVisualEditorGeneration] = useState(0);
  const visualPreviewEditingRef = useRef(visualPreviewEditing);
  visualPreviewEditingRef.current = visualPreviewEditing;
  const [visualPreviewChanged, setVisualPreviewChanged] = useState(false);
  const [appearanceSnapshot, setAppearanceSnapshot] = useState(() => ({
    customCss: props.appearance.customCss,
    state: props.appearance.state
  }));
  const appearanceSnapshotRef = useRef(appearanceSnapshot);
  const appearanceState = appearanceSnapshot.state;
  const [codeThemeExplicit, setCodeThemeExplicit] = useState(
    props.appearance.codeThemeExplicit
  );
  const [renderedCodeTheme, setRenderedCodeTheme] = useState(
    props.appearance.state.codeTheme
  );
  const currentAppearance = useMemo<AppearanceBootstrap>(
    () => ({
      ...props.appearance,
      ...appearanceSnapshot,
      codeThemeExplicit
    }),
    [appearanceSnapshot, codeThemeExplicit, props.appearance]
  );
  const [fontState, setFontState] = useState(props.fonts.state);
  const currentFonts = useMemo<FontControlsBootstrap>(
    () => ({ ...props.fonts, state: fontState }),
    [fontState, props.fonts]
  );
  const [immersive, setImmersive] = useState(false);
  const [mediaPickerDialog, setMediaPickerDialog] = useState<
    'media' | 'featured' | null
  >(null);
  const [contextMenuTableRequest, setContextMenuTableRequest] =
    useState<EditorContextSnapshot | null>(null);
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;
  const [immersiveMode, setImmersiveMode] = useState<ImmersiveViewMode>(() =>
    immersiveModeFromEditingMode(props.settings.general.editingMode)
  );
  const immersiveModeRef = useRef(immersiveMode);
  immersiveModeRef.current = immersiveMode;
  const previousWechatLayoutRef = useRef({ immersive, mode: immersiveMode });
  const localDraftsEnabled =
    props.settings.general.autoSave && props.localDrafts.enabled;
  const scrollSyncEnabled = props.settings.general.syncScroll;
  const visualPreviewHasEditableMap = visualPreviewSourceHasEditableMap(
    visualPreviewSnapshot,
    documentSession?.document.getValue() ?? null
  );
  const visualPreviewNeedsWindow =
    (visualPreviewSnapshot?.editMap?.blocks.length ?? 0)
    > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
  const previewVisible = immersive
    ? 'source' !== immersiveMode
    : 'source' !== props.settings.general.editingMode;
  const visualPreviewWindowed = visualPreviewUsesWindowedOwner(
    visualPreviewNeedsWindow,
    visualDocumentEndHistoryPending || visualWindowedHistoryBranchHeld,
    visualPreviewEditing,
    visualPreviewWindowRequested
  ) || (
    visualPreviewWindowRequestedRef.current
    && visualPreviewEditing
  );
  const currentVisualPreviewSurfaceWindowed =
    visualPreviewSurfaceUsesWindowedOwner(
      visualPreviewNeedsWindow,
      visualDocumentEndHistoryPending || visualWindowedHistoryBranchHeld,
      visualPreviewPending,
      visualPreviewEditing,
      visualPreviewWindowRequested
    );
  const visualPreviewSurfaceWindowed =
    visualPreviewSurfaceWindowedForVisibility(
      currentVisualPreviewSurfaceWindowed
        || (
          visualPreviewWindowRequestedRef.current
          && visualPreviewEditing
        )
        || (!previewVisible && visualPreviewSurfaceWindowedRef.current),
      previewVisible,
      visualPreviewNeedsWindow
    );
  visualPreviewSurfaceWindowedRef.current = visualPreviewSurfaceWindowed;
  useEffect(() => {
    if ('failed' === immersivePreferences.status) {
      props.onFailure(immersivePreferences.code);
    }
  }, [immersivePreferences, props.onFailure]);
  const [cursorPosition, setCursorPosition] = useState({ column: 1, line: 1 });
  const sessionSnapshot = useEditorSession(props.sessionPort);
  const publishEditorStatus = useCallback(
    (nextStatus: EditorStatus) =>
      setEditorStatusState((currentState) => {
        const next =
          'error' === currentState.status?.type
          && currentState.status.id !== nextStatus.id
          && 'error' !== nextStatus.type
            ? currentState.status
            : nextStatus;
        return next === currentState.status
          ? currentState
          : { ...currentState, status: next };
      }),
    []
  );
  const setImageUploadStatus = useCallback(
    (status: ImageUploadStatus) => {
      publishEditorStatus({
        ...status,
        id: status.operationId,
        owner: 'editor'
      });
    },
    [publishEditorStatus]
  );
  const nextImageUploadOperationId = useCallback(
    () => `image-upload-${++imageUploadOperationSequenceRef.current}`,
    []
  );
  const setWechatStatus = useCallback(
    (status: WechatExportStatus) => {
      publishEditorStatus({
        ...status,
        id: 'wechat-export',
        owner: 'editor'
      });
    },
    [publishEditorStatus]
  );
  const setLocalDraftStatus = useCallback(
    (status: LocalDraftSessionStatus) => {
      if (immersiveRef.current && 'saved' === status.code) return;
      publishEditorStatus({
        ...status,
        id: 'local-draft',
        owner: 'local-draft'
      });
    },
    [publishEditorStatus]
  );
  useEffect(() => {
    const timerState = editorStatusTimerRef.current;
    if (!editorStatus) {
      timerState.deadline = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      timerState.status = null;
      return undefined;
    }
    if (timerState.status !== editorStatus) {
      timerState.deadline = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      timerState.status = editorStatus;
    }
    if (editorStatusFocused) return undefined;

    const scheduledStatus = editorStatus;
    const delay = timerState.remaining;
    timerState.deadline = props.immersiveEnvironment.now() + delay;
    const cancel = props.immersiveEnvironment.schedule(() => {
      timerState.deadline = null;
      timerState.remaining = 0;
      setEditorStatusState((currentState) =>
        currentState.status === scheduledStatus
          ? { focused: false, status: null }
          : currentState
      );
    }, delay);
    return () => {
      cancel();
      if (
        timerState.status === scheduledStatus
        && null !== timerState.deadline
      ) {
        timerState.remaining = Math.max(
          0,
          timerState.deadline - props.immersiveEnvironment.now()
        );
        timerState.deadline = null;
      }
    };
  }, [editorStatus, editorStatusFocused, props.immersiveEnvironment]);
  const setAppearanceNotification = useCallback(
    (notification: AppearanceNotification) =>
      publishEditorStatus({ ...notification, owner: 'editor' }),
    [publishEditorStatus]
  );
  const dismissAppearanceNotification = useCallback(
    (id: AppearanceNotification['id']) => {
      setEditorStatusState((currentState) =>
        id === currentState.status?.id
          ? { focused: false, status: null }
          : currentState
      );
    },
    []
  );
  const protectedOperationError = useCallback(
    (operation: EditorSessionOperation) => {
      const error = protectedEditorOperationError(
        props.sessionPort.getSnapshot(),
        operation
      );
      if (error) props.onFailure(error.message);
      return error;
    },
    [props.onFailure, props.sessionPort]
  );
  const handleDocumentReady = useCallback((session: EditorDocumentSession) => {
    session.registerSubmissionState(initialSubmissionStateRef.current);
    setDocumentSession(session);
  }, []);

  useLayoutEffect(() => {
    if (!documentSession) return;
    props.onDocumentOwnerChange(true);
    return () => props.onDocumentOwnerChange(false);
  }, [documentSession, props.onDocumentOwnerChange]);
  useEffect(
    () => () => props.enhancementPort.dispose?.(),
    [props.enhancementPort]
  );
  useEffect(
    () => () => props.generatedContentExportSession?.dispose(),
    [props.generatedContentExportSession]
  );
  useEffect(() => () => props.appearancePort.dispose(), [props.appearancePort]);
  const handlePreviewReady = useCallback(
    (runtime: PreviewSurfaceRuntime) => {
      previewRuntimeRef.current = runtime;
      acceptedWindowSnapshotKeyRef.current = null;
      setAcceptedWindowSnapshotGeneration((generation) => generation + 1);
      setPreviewRuntimeGeneration((generation) => generation + 1);
      notifyContextMenuReadiness();
    },
    [notifyContextMenuReadiness]
  );
  const handlePreviewImageReadinessChange = useCallback(() => {
    notifyContextMenuReadiness();
  }, [notifyContextMenuReadiness]);
  const prepareVisualWindowBlockAdoption = useCallback(
    (node: HTMLElement): (() => boolean) | null => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) return null;
      return runtime.prepareWindowBlockAdoption(node);
    },
    []
  );
  const getAcceptedWindowSnapshot = useCallback(
    (): PreviewAcceptedWindowSnapshot | null =>
      previewRuntimeRef.current?.getAcceptedWindowSnapshot() ?? null,
    []
  );
  const clearScheduledWechatPreparation = useCallback(() => {
    scheduledWechatPreparationRef.current?.();
    scheduledWechatPreparationRef.current = null;
  }, []);
  const cancelWechatBackgroundPreparation = useCallback(() => {
    clearScheduledWechatPreparation();
    const preparation = wechatBackgroundPreparationRef.current;
    wechatBackgroundPreparationRef.current = null;
    preparation?.controller.abort();
  }, [clearScheduledWechatPreparation]);
  const prepareWechatPreview = useCallback(
    (surface: HTMLElement | null) => {
      const prepare = props.wechatClipboard.prepare;
      if (
        !rootActiveRef.current
        || visualPreviewEditingRef.current
        || visualPreviewWindowRequestedRef.current
        || visualPreviewUnlockingRef.current
        || visualPreviewLockingRef.current
        || 'ready' !== previewSurfaceStatusRef.current
        || !props.wechatExport.enabled
        || !surface
        || !prepare
      )
        return;
      let preparation = wechatBackgroundPreparationRef.current;
      if (!preparation) {
        preparation = { controller: new AbortController() };
        wechatBackgroundPreparationRef.current = preparation;
      }
      if (preparation.controller.signal.aborted) return;
      // Preparation runs in the background so the compatibility copy path is
      // ready when requested. Its result is reported by the actual copy
      // operation; opening or editing a Preview is not a copy failure.
      const currentPreparation = preparation;
      void prepare(surface, {
        background: true,
        signal: currentPreparation.controller.signal
      })
        .catch(() => undefined)
        .finally(() => {
          if (wechatBackgroundPreparationRef.current === currentPreparation) {
            wechatBackgroundPreparationRef.current = null;
          }
        });
    },
    [props.wechatClipboard, props.wechatExport.enabled]
  );
  const scheduleWechatPreviewPreparation = useCallback(
    (surface: HTMLElement | null) => {
      const prepare = props.wechatClipboard.prepare;
      if (!props.wechatExport.enabled || !surface || !prepare) return;
      clearScheduledWechatPreparation();
      const cancel = props.immersiveEnvironment.schedule(() => {
        scheduledWechatPreparationRef.current = null;
        prepareWechatPreview(surface);
      }, WECHAT_PREPARATION_DEBOUNCE_MS);
      scheduledWechatPreparationRef.current = cancel;
    },
    [
      clearScheduledWechatPreparation,
      prepareWechatPreview,
      props.immersiveEnvironment,
      props.wechatClipboard,
      props.wechatExport.enabled
    ]
  );
  const scheduleCurrentWechatPreviewPreparation = useCallback(() => {
    if (visualPreviewEditingRef.current) return;
    const surface = visualPreviewEditingRef.current
      ? visualEditorRuntimeRef.current?.surface
      : previewRuntimeRef.current?.surface;
    scheduleWechatPreviewPreparation(surface ?? null);
  }, [scheduleWechatPreviewPreparation]);
  useEffect(() => {
    if (!props.wechatExport.enabled || !props.wechatClipboard.prepare) {
      return undefined;
    }
    const unsubscribe = props.immersiveEnvironment.subscribeResize(
      scheduleCurrentWechatPreviewPreparation
    );
    return unsubscribe;
  }, [
    props.immersiveEnvironment,
    props.wechatClipboard,
    props.wechatExport.enabled,
    scheduleCurrentWechatPreviewPreparation
  ]);
  useEffect(() => {
    if (!props.wechatExport.enabled || !props.wechatClipboard.prepare) {
      return undefined;
    }
    const surface =
      visualEditorSurface ?? previewRuntimeRef.current?.surface ?? null;
    if (!surface) return undefined;
    return props.immersiveEnvironment.observePreviewLayout(
      surface,
      scheduleCurrentWechatPreviewPreparation
    );
  }, [
    previewRuntimeGeneration,
    visualEditorSurface,
    props.immersiveEnvironment,
    props.wechatClipboard,
    props.wechatExport.enabled,
    scheduleCurrentWechatPreviewPreparation
  ]);
  useEffect(() => {
    const previous = previousWechatLayoutRef.current;
    if (previous.immersive === immersive && previous.mode === immersiveMode) {
      return;
    }
    previousWechatLayoutRef.current = { immersive, mode: immersiveMode };
    scheduleCurrentWechatPreviewPreparation();
  }, [immersive, immersiveMode, scheduleCurrentWechatPreviewPreparation]);
  useEffect(() => {
    notifyContextMenuReadiness();
  }, [immersive, notifyContextMenuReadiness]);
  const cancelVisualPreviewWindowUnlock = useCallback(() => {
    if (!visualPreviewWindowUnlockRef.current) return;
    visualPreviewWindowUnlockRef.current = null;
    visualPreviewWindowRequestedRef.current = false;
    if (rootActiveRef.current) {
      setVisualPreviewWindowRequested(false);
      setVisualPreviewUnlocking(false);
    }
  }, []);
  const handlePreviewDispose = useCallback(
    (runtime: PreviewSurfaceRuntime) => {
      cancelWechatBackgroundPreparation();
      cancelVisualPreviewWindowUnlock();
      releasePendingContextResources();
      notifyContextMenuReadiness();
      if (rootActiveRef.current) {
        visualDocumentEndHistoryPendingRef.current = false;
        setVisualDocumentEndHistoryPending(false);
        setVisualWindowedHistoryBranchHeld(false);
      }
      if (previewRuntimeRef.current === runtime) {
        previewRuntimeRef.current = null;
        acceptedWindowSnapshotKeyRef.current = null;
        setAcceptedWindowSnapshotGeneration((generation) => generation + 1);
        setPreviewRuntimeGeneration((generation) => generation + 1);
      }
      if (scheduledPreviewRuntimeRef.current === runtime) {
        scheduledPreviewRuntimeRef.current = null;
      }
    },
    [
      cancelWechatBackgroundPreparation,
      cancelVisualPreviewWindowUnlock,
      notifyContextMenuReadiness,
      releasePendingContextResources
    ]
  );
  const cancelVisualUnlockPreparation = useCallback(() => {
    const preparation = codeThemePreparationRef.current;
    if ('visual-unlock' !== preparation?.owner) return;
    preparation.controller.abort();
    preparation.prepared?.cancel();
    codeThemePreparationRef.current = null;
    if (rootActiveRef.current) setVisualPreviewUnlocking(false);
  }, []);
  const handlePreviewSnapshotReady = useCallback(
    (
      html: SafePreviewHtml,
      signature: string,
      editMap: PreviewEditMap | null
    ) => {
      cancelVisualPreviewWindowUnlock();
      cancelVisualUnlockPreparation();
      setVisualPreviewSnapshot((current) => ({
        editMap,
        html,
        revision: (current?.revision ?? 0) + 1,
        signature
      }));
      notifyContextMenuReadiness();
      // A source edit can produce several Preview snapshots in one typing
      // burst. Defer the expensive export walk until the surface is stable so
      // ordinary editing does not serialize the whole article on every render.
      scheduleCurrentWechatPreviewPreparation();
    },
    [
      cancelVisualPreviewWindowUnlock,
      cancelVisualUnlockPreparation,
      notifyContextMenuReadiness,
      scheduleCurrentWechatPreviewPreparation
    ]
  );
  const handlePreviewStatusChange = useCallback(
    (status: PreviewSurfaceStatus) => {
      if ('ready' !== status) {
        cancelWechatBackgroundPreparation();
        cancelVisualPreviewWindowUnlock();
        cancelVisualUnlockPreparation();
      }
      setPreviewSurfaceStatus(status);
      if ('ready' === status) previewRefreshPendingRef.current = false;
      if ('empty' === status) setVisualPreviewSnapshot(null);
    },
    [
      cancelWechatBackgroundPreparation,
      cancelVisualPreviewWindowUnlock,
      cancelVisualUnlockPreparation
    ]
  );
  const handleVisualEditorReady = useCallback(
    (runtime: ImmersiveVisualEditorRuntime) => {
      visualEditorRuntimeRef.current = runtime;
      setVisualEditorSurface(runtime.surface);
      setVisualEditorGeneration((generation) => generation + 1);
      cancelWechatBackgroundPreparation();
    },
    [cancelWechatBackgroundPreparation]
  );
  const handleVisualEditorDispose = useCallback(
    (runtime: ImmersiveVisualEditorRuntime) => {
      cancelWechatBackgroundPreparation();
      if (visualEditorRuntimeRef.current === runtime) {
        visualEditorRuntimeRef.current = null;
        if (rootActiveRef.current) {
          setVisualEditorSurface(null);
          setVisualEditorGeneration((generation) => generation + 1);
        }
      }
    },
    [cancelWechatBackgroundPreparation]
  );
  useEffect(() => {
    const operation = contextMenuOperationRef.current;
    if (!operation || !documentSession) return;
    const revision = documentSession.document.getRevision?.();
    const current = {
      ...(undefined === revision ? {} : { revision }),
      selection: documentSession.document.getSelection(),
      ...('source' === operation.captured.surface
        ? { surfaceIdentity: documentSession }
        : visualEditorRuntimeRef.current
          ? {
              surfaceGeneration: visualEditorGeneration,
              surfaceIdentity: visualEditorRuntimeRef.current
            }
          : {}),
      surface: operation.captured.surface,
      value: documentSession.document.getValue()
    };
    if (!isEditorContextCurrent(operation.captured, current)) {
      operation.controller.abort();
    }
  }, [documentSession, visualEditorGeneration, visualEditorSurface]);
  const focusVisualPreview = useCallback(() => {
    return focusVisualPreviewRuntime(
      visualEditorRuntimeRef.current,
      props.immersiveEnvironment.activeElement,
      props.onFailure
    );
  }, [props.immersiveEnvironment, props.onFailure]);
  const closeForToolbar = useCallback((focusTarget?: HTMLElement) => {
    appearanceSessionRef.current?.close();
    fontControlsSessionRef.current?.close();
    ordinarySettingsSessionRef.current?.close(focusTarget);
  }, []);
  const schedulePreviewMarkdown = useCallback(
    (markdown: string, immediate = false): string => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) {
        throw new Error('preview-runtime-unavailable');
      }
      const revision = ++previewRevisionRef.current;
      const request = previewRequest(
        markdown,
        props.preview,
        previewAppearanceRef.current,
        revision
      );
      runtime.session.schedule(request, immediate);
      return request.signature;
    },
    [props.preview]
  );
  const schedulePreview = useCallback(
    (immediate = false) => {
      schedulePreviewMarkdown(
        documentSession?.document.getValue() ?? props.submissionField.value,
        immediate
      );
    },
    [documentSession, props.submissionField, schedulePreviewMarkdown]
  );
  const handleVisualFailure = useCallback(
    (code: string) => {
      lastVisualFailureRef.current = code;
      rootRef.current?.setAttribute('data-easymde-visual-failure', code);
      props.onFailure(code);
    },
    [props.onFailure]
  );
  const handleVisualMarkdownChange = useCallback(() => {
    lastVisualFailureRef.current = null;
    rootRef.current?.removeAttribute('data-easymde-visual-failure');
    if (
      rootActiveRef.current
      && !visualDocumentEndHistoryPendingRef.current
      && documentSession?.document.getHistoryState().redoDepth === 0
    ) {
      scheduleVisualWindowedHistoryBranchRelease(
        () => visualDocumentEndHistoryPendingRef.current,
        () => (documentSession?.document.getHistoryState().redoDepth ?? 0) > 0,
        () => {
          if (rootActiveRef.current) setVisualWindowedHistoryBranchHeld(false);
        }
      );
    }
    const surface = previewRuntimeRef.current?.surface;
    if (surface) {
      const codeFrames = Array.from(
        surface.querySelectorAll<HTMLElement>('pre > code.hljs')
      );
      if (
        codeFrames.some((code) => !syncedVisualCodeFramesRef.current.has(code))
      ) {
        try {
          props.enhancementPort.syncCodeFrameBackgrounds(surface);
          for (const code of codeFrames) {
            syncedVisualCodeFramesRef.current.add(code);
          }
        } catch (error) {
          props.onFailure(previewEnhancementFailureCode(error));
        }
      }
    }
    setVisualPreviewChanged(true);
  }, [documentSession, props.enhancementPort, props.onFailure]);
  const handleVisualPendingChange = useCallback(
    (pending: boolean) => {
      if (!rootActiveRef.current) return;
      setVisualPreviewPending(pending);
      if (
        !pending
        && !visualDocumentEndHistoryPendingRef.current
        && documentSession?.document.getHistoryState().redoDepth === 0
      ) {
        setVisualWindowedHistoryBranchHeld(false);
      }
    },
    [documentSession]
  );
  const handleVisualPreviewRequest = useCallback(
    (markdown: string) => schedulePreviewMarkdown(markdown, true),
    [schedulePreviewMarkdown]
  );
  const handleVisualPreviewAtDocumentEnd = useCallback(
    (markdown: string, sourceSelection?: PreviewSourceSelection) => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) {
        throw new Error('preview-runtime-unavailable');
      }
      if (!documentSession) {
        throw new Error('editor-document-session-unavailable');
      }
      const revision = ++previewRevisionRef.current;
      const request = previewRequest(
        markdown,
        props.preview,
        previewAppearanceRef.current,
        revision
      );
      return schedulePreviewWithDocumentEndPin(
        runtime,
        request,
        (pending) => {
          if (rootActiveRef.current) {
            visualDocumentEndHistoryPendingRef.current = pending;
            setVisualDocumentEndHistoryPending(pending);
          }
        },
        () => {
          if (rootActiveRef.current) {
            setVisualWindowedHistoryBranchHeld(
              documentSession.document.getHistoryState().redoDepth > 0
            );
          }
        },
        sourceSelection
      );
    },
    [documentSession, props.preview]
  );
  const leaveVisualPreview = useCallback(() => {
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    )
      return false;
    lastVisualFailureRef.current = null;
    visualPreviewWindowRequestedRef.current = false;
    setVisualPreviewWindowRequested(false);
    visualPreviewEditingRef.current = false;
    setVisualPreviewEditing(false);
    setVisualPreviewUnlocking(false);
    setVisualPreviewPending(false);
    visualDocumentEndHistoryPendingRef.current = false;
    setVisualDocumentEndHistoryPending(false);
    setVisualWindowedHistoryBranchHeld(false);
    setVisualPreviewChanged(false);
    previewRefreshPendingRef.current = true;
    setPreviewRefreshRevision((revision) => revision + 1);
    return true;
  }, []);
  const handlePreviewWindowReady = useCallback(() => {
    const accepted = getAcceptedWindowSnapshot();
    if (accepted && accepted.key !== acceptedWindowSnapshotKeyRef.current) {
      acceptedWindowSnapshotKeyRef.current = accepted.key;
      setAcceptedWindowSnapshotGeneration((generation) => generation + 1);
    }
    notifyContextMenuReadiness();
    const request = visualPreviewWindowUnlockRef.current;
    const snapshot = visualPreviewSnapshotRef.current;
    if (
      !rootActiveRef.current
      || visualPreviewLockingRef.current
      || !visualPreviewWindowRequestedRef.current
      || !request
    )
      return;
    if (
      !isVisualPreviewWindowRequestCurrent(
        request,
        snapshot,
        previewSurfaceStatusRef.current,
        rootActiveRef.current
      )
    ) {
      cancelVisualPreviewWindowUnlock();
      return;
    }
    cancelVisualPreviewWindowUnlock();
    cancelWechatBackgroundPreparation();
    visualPreviewEditingRef.current = true;
    setVisualPreviewEditing(true);
  }, [
    cancelWechatBackgroundPreparation,
    cancelVisualPreviewWindowUnlock,
    getAcceptedWindowSnapshot,
    notifyContextMenuReadiness
  ]);
  const handleVisualCanonicalDocumentChange = useCallback(() => {
    lastVisualFailureRef.current = null;
    leaveVisualPreview();
    props.onFailure('visual-editor-canonical-document-changed');
  }, [leaveVisualPreview, props.onFailure]);
  const requestVisualPreviewUnlock = useCallback(() => {
    const snapshot = visualPreviewSnapshotRef.current;
    if (
      !rootActiveRef.current
      || !immersiveRef.current
      || 'preview' !== immersiveModeRef.current
      || 'ready' !== previewSurfaceStatusRef.current
      || visualPreviewEditingRef.current
      || visualPreviewWindowRequestedRef.current
      || codeThemePreparationRef.current
      || !snapshot
      || !documentSession
    )
      return;
    const hasEditableMap = visualPreviewSourceHasEditableMap(
      snapshot,
      documentSession.document.getValue()
    );
    if (!hasEditableMap) return;
    flushSync(() => setVisualPreviewUnlocking(true));
    const snapshotRevision = snapshot.revision;
    const snapshotSignature = snapshot.signature;
    const sourceMarkdown = documentSession.document.getValue();
    const windowed =
      (snapshot.editMap?.blocks.length ?? 0)
      > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
    const enableVisualPreview = () => {
      setPreviewSurfaceStatus('ready');
      setVisualPreviewChanged(false);
      setVisualPreviewPending(false);
      if (windowed) {
        visualPreviewWindowUnlockRef.current = {
          revision: snapshotRevision,
          signature: snapshotSignature
        };
        visualPreviewWindowRequestedRef.current = true;
        setVisualPreviewWindowRequested(true);
        return;
      }
      setVisualPreviewUnlocking(false);
      visualPreviewEditingRef.current = true;
      setVisualPreviewEditing(true);
    };
    // A code-free Preview does not load code resources. Prepare them before
    // handing the surface to local visual editing so its first PRE is framed
    // on the mutation that creates it, including in a non-empty document.
    const controller = new AbortController();
    const generation = ++codeThemePreparationGenerationRef.current;
    const preparation = {
      controller,
      generation,
      owner: 'visual-unlock' as const,
      prepared: null as PreparedCodeTheme | null,
      sourceMarkdown
    };
    codeThemePreparationRef.current = preparation;
    cancelWechatBackgroundPreparation();
    const isCurrent = () =>
      rootActiveRef.current
      && codeThemePreparationRef.current === preparation
      && !controller.signal.aborted
      && immersiveRef.current
      && 'preview' === immersiveModeRef.current
      && 'ready' === previewSurfaceStatusRef.current
      && !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
      && visualPreviewSnapshotRef.current?.revision === snapshotRevision
      && visualPreviewSnapshotRef.current?.signature === snapshotSignature
      && documentSession.document.getValue() === sourceMarkdown;
    const clearPreparation = () => {
      if (codeThemePreparationRef.current === preparation) {
        codeThemePreparationRef.current = null;
      }
    };

    void (async () => {
      let prepared: PreparedCodeTheme;
      try {
        prepared = await props.enhancementPort.prepareCodeTheme({
          codeTheme: previewAppearanceRef.current.codeTheme,
          signal: controller.signal
        });
      } catch (error: unknown) {
        const current = isCurrent();
        clearPreparation();
        if (current) {
          setVisualPreviewUnlocking(false);
          props.onFailure(previewEnhancementFailureCode(error));
        }
        return;
      }
      preparation.prepared = prepared;
      if (!isCurrent()) {
        prepared.cancel();
        clearPreparation();
        return;
      }
      try {
        prepared.commit();
      } catch (error: unknown) {
        const current = isCurrent();
        prepared.cancel();
        clearPreparation();
        if (current) {
          setVisualPreviewUnlocking(false);
          props.onFailure(previewEnhancementFailureCode(error));
        }
        return;
      }
      if (!isCurrent()) {
        clearPreparation();
        return;
      }
      clearPreparation();
      enableVisualPreview();
    })();
  }, [
    cancelWechatBackgroundPreparation,
    documentSession,
    props.enhancementPort,
    props.onFailure
  ]);
  const prepareVisualSource = useCallback(() => {
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    ) {
      cancelVisualUnlockPreparation();
      return true;
    }
    if (!visualPreviewEditingRef.current) return true;
    const runtime = visualEditorRuntimeRef.current;
    if (!runtime) throw new Error('visual-editor-runtime-unavailable');
    return runtime.prepareToolbarFallback();
  }, [cancelVisualUnlockPreparation]);
  const prepareSourceMutation = useCallback(() => {
    if (!prepareVisualSource()) return false;
    leaveVisualPreview();
    return true;
  }, [leaveVisualPreview, prepareVisualSource]);
  const prepareGeneratedSourceNavigation = useCallback(
    (
      expected: Readonly<{ revision: number; value: string }>,
      validateSource: () => boolean
    ) => {
      let prepared = false;
      flushSync(() => {
        const runtime = visualEditorRuntimeRef.current;
        if (!runtime) throw new Error('visual-editor-runtime-unavailable');
        prepared = runtime.prepareSourceNavigation(expected);
        if (!prepared || !validateSource()) {
          prepared = false;
          return;
        }
        leaveVisualPreview();
        if (immersiveRef.current && 'preview' === immersiveModeRef.current) {
          setImmersiveMode('source');
        }
      });
      return prepared;
    },
    [leaveVisualPreview]
  );
  const prepareSourceMutationWithPreview = useCallback(async () => {
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    )
      return true;
    if (!prepareVisualSource()) return false;
    const previewRuntime = previewRuntimeRef.current;
    if (!previewRuntime) throw new Error('preview-runtime-unavailable');
    const holdWindow =
      visualPreviewEditingRef.current && visualPreviewNeedsWindow;
    if (holdWindow) {
      flushSync(() => {
        visualPreviewLockingRef.current = true;
        visualPreviewWindowUnlockRef.current = null;
        visualPreviewWindowRequestedRef.current = true;
        setVisualPreviewWindowRequested(true);
        visualPreviewEditingRef.current = false;
        setVisualPreviewEditing(false);
      });
      const previewWindow = previewRuntime.surface.ownerDocument.defaultView;
      await new Promise<void>((resolve) => {
        if (!previewWindow) {
          setTimeout(resolve, 0);
          return;
        }
        previewWindow.requestAnimationFrame(() => {
          previewWindow.requestAnimationFrame(() => resolve());
        });
      });
    }
    if (!(await previewRuntime.materialize())) {
      visualPreviewLockingRef.current = false;
      leaveVisualPreview();
      return false;
    }
    visualPreviewLockingRef.current = false;
    leaveVisualPreview();
    return true;
  }, [leaveVisualPreview, prepareVisualSource, visualPreviewNeedsWindow]);
  const appearancePort = useMemo<AppearancePort>(
    () => ({
      applyState: async (state, codeThemeExplicit) => {
        const previousState = previewAppearanceRef.current;
        const codeThemeChanged = previousState.codeTheme !== state.codeTheme;
        const markupChanged =
          articleMarkupProfile(props.appearance, previousState)
          !== articleMarkupProfile(props.appearance, state);
        const visualPreviewWasEditing = visualPreviewEditingRef.current;
        if (
          visualPreviewWasEditing
          && !(await prepareSourceMutationWithPreview())
        ) {
          throw new Error('visual-editor-source-sync-failed');
        }
        if (codeThemeChanged && visualPreviewWindowUnlockRef.current) {
          cancelVisualPreviewWindowUnlock();
        }
        cancelVisualUnlockPreparation();
        codeThemePreparationRef.current?.controller.abort();
        codeThemePreparationRef.current?.prepared?.cancel();
        props.appearancePort.cancelPendingApply();
        const controller = new AbortController();
        const generation = ++codeThemePreparationGenerationRef.current;
        const preparation = {
          controller,
          generation,
          owner: 'appearance' as const,
          prepared: null as PreparedCodeTheme | null
        };
        codeThemePreparationRef.current = preparation;
        if (codeThemeChanged) {
          try {
            preparation.prepared = await props.enhancementPort.prepareCodeTheme(
              {
                codeTheme: state.codeTheme,
                signal: controller.signal
              }
            );
          } catch (error: unknown) {
            if (
              !controller.signal.aborted
              && codeThemePreparationRef.current?.generation === generation
              && rootActiveRef.current
            ) {
              props.onFailure(previewEnhancementFailureCode(error));
            }
            if (codeThemePreparationRef.current?.generation === generation) {
              codeThemePreparationRef.current = null;
            }
            return false;
          }
          if (
            controller.signal.aborted
            || codeThemePreparationRef.current?.generation !== generation
            || !rootActiveRef.current
          ) {
            preparation.prepared.cancel();
            return false;
          }
        }
        let applied: boolean;
        try {
          applied = await props.appearancePort.applyState(
            state,
            codeThemeExplicit
          );
        } catch {
          preparation.prepared?.cancel();
          if (codeThemePreparationRef.current?.generation === generation) {
            codeThemePreparationRef.current = null;
          }
          if (rootActiveRef.current) {
            props.onFailure('react-editor-appearance-failed');
          }
          return false;
        }
        if (
          !applied
          || controller.signal.aborted
          || codeThemePreparationRef.current?.generation !== generation
          || !rootActiveRef.current
        ) {
          preparation.prepared?.cancel();
          if (codeThemePreparationRef.current?.generation === generation) {
            codeThemePreparationRef.current = null;
          }
          return false;
        }
        preparation.prepared?.commit();
        codeThemePreparationRef.current = null;
        if (codeThemeChanged) {
          codeThemeFrameSyncPendingRef.current = state.codeTheme;
          setRenderedCodeTheme(state.codeTheme);
        }
        codeThemeExplicitRef.current = codeThemeExplicit;
        setCodeThemeExplicit(codeThemeExplicit);
        const nextSnapshot = { ...appearanceSnapshotRef.current, state };
        appearanceSnapshotRef.current = nextSnapshot;
        setAppearanceSnapshot(nextSnapshot);
        appearanceSessionRef.current?.replaceSnapshot(
          nextSnapshot,
          codeThemeExplicit
        );
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state,
          codeThemeExplicit
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
        previewAppearanceRef.current = state;
        const defaults = props.appearance.articleThemes.find(
          ({ id }) => id === state.markdownTheme
        )?.fontDefaults;
        if (defaults) {
          fontControlsSessionRef.current?.replaceState(defaults);
        }
        if (markupChanged || visualPreviewWasEditing) {
          previewRefreshPendingRef.current = true;
          schedulePreview(true);
        } else {
          scheduleCurrentWechatPreviewPreparation();
        }
        return true;
      },
      cancelPendingApply: () => {
        cancelVisualPreviewWindowUnlock();
        cancelVisualUnlockPreparation();
        codeThemePreparationRef.current?.controller.abort();
        codeThemePreparationRef.current?.prepared?.cancel();
        codeThemePreparationRef.current = null;
        props.appearancePort.cancelPendingApply();
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        fontControlsSessionRef.current?.close();
        ordinarySettingsSessionRef.current?.close();
        props.appearancePort.closeOtherPopovers();
      },
      dispose: () => undefined,
      previewCustomCss: (css, signal) =>
        props.appearancePort.previewCustomCss(css, signal),
      saveCustomCss: async (input) => {
        const sessionError = protectedOperationError('authenticated');
        if (sessionError) throw sessionError;
        const visualPreviewWasEditing = visualPreviewEditingRef.current;
        if (
          visualPreviewWasEditing
          && !(await prepareSourceMutationWithPreview())
        ) {
          throw new Error('visual-editor-source-sync-failed');
        }
        const result = await props.appearancePort.saveCustomCss(input);
        if ('saved' === result.status) {
          // The server mutation and local theme activation are separate
          // operations. Publish the authoritative saved library immediately;
          // AppearanceControls applies the selected theme exactly once through
          // applyState, which commits preview and submission state only after
          // its stylesheet has loaded.
          if (rootActiveRef.current) {
            const nextSnapshot = {
              ...appearanceSnapshotRef.current,
              customCss: result.snapshot.customCss
            };
            appearanceSnapshotRef.current = nextSnapshot;
            setAppearanceSnapshot(nextSnapshot);
            appearanceSessionRef.current?.replaceSnapshot(
              nextSnapshot,
              codeThemeExplicitRef.current
            );
          }
        }
        return result;
      }
    }),
    [
      cancelVisualPreviewWindowUnlock,
      cancelVisualUnlockPreparation,
      documentSession,
      props.appearance.articleThemes,
      props.appearancePort,
      prepareSourceMutation,
      protectedOperationError,
      scheduleCurrentWechatPreviewPreparation,
      schedulePreview
    ]
  );
  const fontControlsPort = useMemo<FontControlsPort>(
    () => ({
      applyState: (state) => {
        props.fontControlsPort.applyState(state);
        setFontState(state);
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
        scheduleWechatPreviewPreparation(
          visualEditorRuntimeRef.current?.surface
            ?? previewRuntimeRef.current?.surface
            ?? null
        );
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        appearanceSessionRef.current?.close();
        ordinarySettingsSessionRef.current?.close();
        props.fontControlsPort.closeOtherPopovers();
      }
    }),
    [documentSession, props.fontControlsPort, scheduleWechatPreviewPreparation]
  );
  const handleAppearanceReady = useCallback(
    (session: AppearanceControlsSession) => {
      appearanceSessionRef.current = session;
    },
    []
  );
  const handleFontControlsReady = useCallback(
    (session: FontControlsSession) => {
      fontControlsSessionRef.current = session;
    },
    []
  );
  const handleOrdinarySettingsReady = useCallback(
    (session: OrdinaryEditorSettingsSession) => {
      ordinarySettingsSessionRef.current = session;
    },
    []
  );
  const handleToolbarReady = useCallback((session: EditorToolbarSession) => {
    toolbarSessionRef.current = session;
  }, []);
  const handleToolbarExecutorReady = useCallback(
    (execute: ((commandId: string) => void) | null) => {
      contextMenuExecutorRef.current = execute;
    },
    []
  );
  const closeMediaPickerDialog = useCallback(() => {
    props.mediaPickerFrame?.cancel?.();
    setMediaPickerDialog(null);
  }, [props.mediaPickerFrame]);
  const handleMediaPickerAttachError = useCallback(
    (error: unknown) => {
      props.mediaPickerFrame?.cancel?.();
      setMediaPickerDialog(null);
      if (!rootActiveRef.current) return;
      props.onFailure(mediaPickerFailureCode(error));
      publishEditorStatus({
        id: 'media-picker',
        message: props.mediaPickerFailureMessage,
        owner: 'editor',
        type: 'error'
      });
    },
    [
      props.mediaPickerFailureMessage,
      props.mediaPickerFrame,
      props.onFailure,
      publishEditorStatus
    ]
  );
  const openMediaPicker = useCallback(
    (
      session: EditorDocumentSession,
      pickerDocument?: MediaPickerDocumentPort
    ) => {
      if (mediaOperationRef.current) {
        return mediaOperationRef.current;
      }
      const sessionError = protectedOperationError('authenticated');
      const frame = props.mediaPickerFrame;
      const frameAvailable = Boolean(frame?.attachFrame && frame.frameUrl);
      const operation = sessionError
        ? Promise.reject(sessionError)
        : !frameAvailable
          ? Promise.reject(new Error('media-picker-unavailable'))
          : openMediaPickerSession({
              document:
                pickerDocument
                ?? documentPort(session, () => rootActiveRef.current),
              frame,
              strings: props.mediaPicker
            });
      mediaOperationRef.current = operation;
      if (!sessionError && frameAvailable) {
        setMediaPickerDialog('media');
      }
      void operation
        .catch((error: unknown) => {
          if (!rootActiveRef.current) {
            return;
          }
          props.onFailure(mediaPickerFailureCode(error));
          publishEditorStatus({
            id: 'media-picker',
            message: props.mediaPickerFailureMessage,
            owner: 'editor',
            type: 'error'
          });
        })
        .finally(() => {
          if (mediaOperationRef.current === operation) {
            mediaOperationRef.current = null;
          }
          setMediaPickerDialog(null);
        });
      return operation;
    },
    [
      props.mediaPicker,
      props.mediaPickerFailureMessage,
      props.mediaPickerFrame,
      props.onFailure,
      protectedOperationError,
      publishEditorStatus
    ]
  );
  const imageUploadPort = useMemo<ImageUploadPort>(
    () => ({
      upload: (request) => {
        const sessionError = protectedOperationError('post-write');
        return sessionError
          ? Promise.resolve({ code: sessionError.message, status: 'failed' })
          : props.imageUploadPort.upload(request);
      }
    }),
    [props.imageUploadPort, protectedOperationError]
  );
  const wechatSession = useMemo(() => {
    const copyOptions: WechatClipboardCopyOptions = {
      ...(props.wechatVisualRasterizationPort
        ? { visualRasterizationPort: props.wechatVisualRasterizationPort }
        : {}),
      imageUploadPort,
      maxBytes: props.imageUpload.maxBytes,
      pngConversionEnabled: props.wechatExport.pngConversionEnabled,
      postId: props.imageUpload.postId,
      resolvePreview: async () => {
        if (
          visualPreviewEditingRef.current
          || visualPreviewWindowRequestedRef.current
        ) {
          if (!prepareVisualSource()) return null;
          const previewRuntime = previewRuntimeRef.current;
          if (!previewRuntime || !(await previewRuntime.materialize())) {
            return null;
          }
          leaveVisualPreview();
        }
        const surface = previewRuntimeRef.current?.surface ?? null;
        return surface?.querySelector('[data-easymde-preview-window-spacer]')
          ? null
          : surface;
      }
    };
    return createWechatExportSession({
      clipboard: props.wechatClipboard,
      copyOptions,
      enabled: props.wechatExport.enabled,
      getPreview: () =>
        visualEditorRuntimeRef.current?.surface
        ?? previewRuntimeRef.current?.surface
        ?? null,
      onDiagnostic: props.onFailure,
      onStatus: setWechatStatus,
      strings: props.wechatExport.strings
    });
  }, [
    imageUploadPort,
    leaveVisualPreview,
    prepareVisualSource,
    props.imageUpload.maxBytes,
    props.imageUpload.postId,
    props.onFailure,
    props.wechatClipboard,
    props.wechatExport,
    props.wechatVisualRasterizationPort,
    setWechatStatus
  ]);
  const remoteImageImportPort = useMemo<RemoteImageImportPort>(
    () => ({
      import: (request) => {
        const sessionError = protectedOperationError('post-write');
        return sessionError
          ? Promise.resolve({ code: sessionError.message, status: 'failed' })
          : props.remoteImageImportPort.import(request);
      }
    }),
    [props.remoteImageImportPort, protectedOperationError]
  );
  const remoteImageImportCoordinator = useMemo(() => {
    if (!documentSession) return null;
    return createRemoteImageImportCoordinator({
      document: documentPort(documentSession, () => rootActiveRef.current),
      insertion: props.imageUpload.insertion,
      onDiagnostic: props.onFailure,
      postId: props.imageUpload.postId,
      remoteImageImport: remoteImageImportPort
    });
  }, [
    documentSession,
    props.imageUpload.insertion,
    props.imageUpload.postId,
    props.onFailure,
    remoteImageImportPort
  ]);
  useEffect(
    () => () => remoteImageImportCoordinator?.destroy(),
    [remoteImageImportCoordinator]
  );
  const previewPort = useMemo<PreviewRequestPort>(
    () => ({
      render: (request, signal) => {
        const sessionError = protectedOperationError('post-read');
        return sessionError
          ? Promise.reject(sessionError)
          : props.previewPort.render(request, signal);
      }
    }),
    [props.previewPort, protectedOperationError]
  );
  const editorCodeContentQuery = useMemo(
    () =>
      createEditorCodeContentQuery({
        isCurrent: (binding: EditorCodeContentQueryBinding): boolean => {
          if (!documentSession) return false;
          if (binding.source !== documentSession.document.getValue()) return false;
          if (
            !Object.is(
              binding.revision,
              documentSession.document.getRevision?.()
            )
          ) {
            return false;
          }
          const selection = documentSession.document.getSelection();
          if (
            selection.start !== binding.selection.start
            || selection.end !== binding.selection.end
            || selection.direction !== binding.selection.direction
          ) {
            return false;
          }
          if ('source' === binding.surface) {
            return binding.generation === 0
              && binding.menuIdentity === documentSession;
          }
          const runtime = visualEditorRuntimeRef.current;
          return binding.generation === visualEditorGeneration
            && binding.menuIdentity === runtime;
        },
        notify: notifyContextMenuReadiness,
        onUnavailable: (binding, code) => {
          if ('editor-code-content-map-unavailable' === code) return;
          const key = [
            binding.surface,
            binding.generation,
            binding.revision ?? '',
            binding.selection.start,
            binding.selection.end,
            binding.source.length,
            code
          ].join(':');
          if (editorCodeContentFailureRef.current === key) return;
          editorCodeContentFailureRef.current = key;
          props.onFailure(code);
        },
        previewPort,
        requestFactory: ({ binding, markdown, target }) => {
          const defaultArticleTheme = props.appearance.articleThemes.find(
            ({ id }) => 'default' === id
          );
          if (
            !defaultArticleTheme
            || !props.appearance.codeThemes.some(
              ({ id }) => id === defaultArticleTheme.defaultCodeTheme
            )
          ) {
            throw new Error('editor-code-content-default-profile-unavailable');
          }
          return {
            codeTheme: defaultArticleTheme.defaultCodeTheme,
            customCssId: '',
            markdown,
            markdownTheme: defaultArticleTheme.id,
            postId: props.preview.postId,
            signature:
              `editor-code-content:${++editorCodeContentQuerySequenceRef.current}`
                + `:${binding.surface}:${target.kind}:${target.ownerLineStart}`
                + `:${target.ownerLineEnd}:${markdown.length}`
          };
        }
      }),
    [
      documentSession,
      props.onFailure,
      notifyContextMenuReadiness,
      previewPort,
      props.appearance.articleThemes,
      props.appearance.codeThemes,
      props.preview.postId,
      visualEditorGeneration
    ]
  );
  useEffect(() => {
    editorCodeContentQueryRef.current = editorCodeContentQuery;
    return () => {
      if (editorCodeContentQueryRef.current === editorCodeContentQuery) {
        editorCodeContentQueryRef.current = null;
      }
      editorCodeContentQuery.dispose();
    };
  }, [editorCodeContentQuery]);
  const editorSourceLinkQuery = useMemo<EditorSourceLinkQuerySession | null>(
    () => {
      if (!props.simplifiedFormattingParser) return null;
      return createEditorSourceLinkQuery({
        isCurrent: (binding: EditorSourceLinkQueryBinding): boolean => {
          if (!documentSession) return false;
          if (binding.menuIdentity !== documentSession) return false;
          if (binding.source !== documentSession.document.getValue()) {
            return false;
          }
          if (
            !Object.is(
              binding.revision,
              documentSession.document.getRevision?.()
            )
          ) {
            return false;
          }
          const selection = documentSession.document.getSelection();
          return selection.start === binding.selection.start
            && selection.end === binding.selection.end
            && selection.direction === binding.selection.direction;
        },
        notify: notifyContextMenuReadiness,
        parser: props.simplifiedFormattingParser,
        previewPort,
        requestFactory: ({ binding, candidate, markdown }) => {
          const defaultArticleTheme = props.appearance.articleThemes.find(
            ({ id }) => 'default' === id
          );
          if (
            !defaultArticleTheme
            || !props.appearance.codeThemes.some(
              ({ id }) => id === defaultArticleTheme.defaultCodeTheme
            )
          ) {
            throw new Error('editor-source-link-default-profile-unavailable');
          }
          return {
            codeTheme: defaultArticleTheme.defaultCodeTheme,
            customCssId: '',
            markdown,
            markdownTheme: defaultArticleTheme.id,
            postId: props.preview.postId,
            signature:
              `editor-source-link:${++editorSourceLinkQuerySequenceRef.current}`
                + `:${binding.revision ?? 'none'}:${candidate.kind}`
                + `:${candidate.from}:${candidate.to}:${markdown.length}`
          };
        }
      });
    },
    [
      documentSession,
      notifyContextMenuReadiness,
      previewPort,
      props.appearance.articleThemes,
      props.appearance.codeThemes,
      props.preview.postId,
      props.simplifiedFormattingParser
    ]
  );
  useEffect(() => {
    editorSourceLinkQueryRef.current = editorSourceLinkQuery;
    return () => {
      if (editorSourceLinkQueryRef.current === editorSourceLinkQuery) {
        editorSourceLinkQueryRef.current = null;
      }
      editorSourceLinkQuery?.dispose();
    };
  }, [editorSourceLinkQuery]);
  const revisionPort = useMemo<RevisionPort | null>(() => {
    const port = props.revisionPort;
    return port
      ? {
          get: (revisionId, signal) => {
            const sessionError = protectedOperationError('post-read');
            return sessionError
              ? Promise.reject(sessionError)
              : port.get(revisionId, signal);
          },
          list: (signal) => {
            const sessionError = protectedOperationError('post-read');
            return sessionError
              ? Promise.reject(sessionError)
              : port.list(signal);
          }
        }
      : null;
  }, [props.revisionPort, protectedOperationError]);
  const restoreRevision = useCallback(
    (restoreUrl: string) => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) throw sessionError;
      props.restoreRevision(restoreUrl);
    },
    [props.restoreRevision, protectedOperationError]
  );
  const executeRootExternalCommand = useCallback(
    (commandId: string, session: EditorDocumentSession) => {
      if (
        'image'
        === props.toolbar.commands.find((command) => command.id === commandId)
          ?.action
      ) {
        const runtime = visualPreviewEditingRef.current
          ? visualEditorRuntimeRef.current
          : null;
        const revision = session.document.getRevision?.();
        const visualContext: VisualCanonicalChangeContext | null =
          runtime && documentSession === session
            ? {
                ...(undefined === revision ? {} : { revision }),
                selection: session.document.getSelection(),
                surface: 'visual',
                value: session.document.getValue()
              }
            : null;
        const pickerDocument =
          visualContext && applyVisualCanonicalChangeRef.current
            ? visualMediaPickerDocument(
                session,
                visualContext,
                () => rootActiveRef.current,
                () => runtime?.surface.focus(),
                applyVisualCanonicalChangeRef.current
              )
            : undefined;
        void openMediaPicker(session, pickerDocument);
        return true;
      }
      if (
        'copyWechat'
        === props.toolbar.commands.find((command) => command.id === commandId)
          ?.action
      ) {
        void wechatSession.copy();
        return true;
      }
      return props.executeExternalCommand(commandId, session);
    },
    [
      openMediaPicker,
      props.executeExternalCommand,
      props.toolbar.commands,
      wechatSession
    ]
  );
  const reportContextMenuFailure = useCallback(
    (code: string, message?: string) => {
      props.onFailure(code);
      if (message) {
        publishEditorStatus({
          id: `context-menu-${code}`,
          message,
          owner: 'editor',
          type: 'error'
        });
      }
    },
    [props.onFailure, publishEditorStatus]
  );
  const reportVisualToolbarFailure = useCallback(() => {
    const message = props.contextMenuStrings?.statusActionFailed;
    if (!message) return;
    publishEditorStatus({
      id: 'visual-toolbar-command-failed',
      message,
      owner: 'editor',
      type: 'error'
    });
  }, [props.contextMenuStrings?.statusActionFailed, publishEditorStatus]);
  const reportVisualCanonicalChangeFailure = useCallback(() => {
    const message = props.contextMenuStrings?.statusActionFailed;
    if (!message) return;
    publishEditorStatus({
      id: 'context-menu-visual-canonical-change-failed',
      message,
      owner: 'editor',
      type: 'error'
    });
  }, [props.contextMenuStrings?.statusActionFailed, publishEditorStatus]);
  const reportVisualTransferFailure = useCallback(
    (code: string | null) => {
      if (!code || isCancelledVisualTransferFailure(code)) return;
      const message = props.contextMenuStrings?.statusActionFailed;
      if (!message) return;
      publishEditorStatus({
        id: 'visual-transfer-failed',
        message,
        owner: 'editor',
        type: 'error'
      });
    },
    [props.contextMenuStrings?.statusActionFailed, publishEditorStatus]
  );
  const handleVisualTransferFailure = useCallback(() => {
    const code = lastVisualFailureRef.current;
    lastVisualFailureRef.current = null;
    reportVisualTransferFailure(code);
    leaveVisualPreview();
  }, [leaveVisualPreview, reportVisualTransferFailure]);
  const applyVisualCanonicalChange = useCallback(
    (
      captured: VisualCanonicalChangeContext,
      change: VisualCanonicalChangeRequest['change']
    ): boolean => {
      if ('visual' !== captured.surface) return false;
      const runtime = visualEditorRuntimeRef.current;
      if (!runtime || undefined === captured.revision) {
        reportVisualCanonicalChangeFailure();
        return false;
      }
      const result = runtime.applyCanonicalChange({
        change,
        expected: {
          revision: captured.revision,
          selection: captured.selection,
          value: captured.value
        }
      });
      if ('handled' !== result) {
        reportVisualCanonicalChangeFailure();
        return false;
      }
      return true;
    },
    [reportVisualCanonicalChangeFailure]
  );
  applyVisualCanonicalChangeRef.current = applyVisualCanonicalChange;
  const handleContextMenuAction = useCallback(
    async (
      id: string,
      captured: EditorContextSnapshot,
      actionContext?: EditorContextMenuActionContext
    ): Promise<void> => {
      const clipboard = props.editorClipboardPort;
      if (!documentSession || !clipboard) {
        reportContextMenuFailure(
          'editor-context-menu-owner-unavailable',
          props.contextMenuStrings?.statusActionFailed
        );
        return;
      }
      const currentContext = (context: EditorContextSnapshot = captured) => {
        const revision = documentSession.document.getRevision?.();
        return {
          ...(undefined === revision ? {} : { revision }),
          selection: documentSession.document.getSelection(),
          ...('source' === context.surface
            ? { surfaceIdentity: documentSession }
            : visualEditorRuntimeRef.current
              ? {
                  surfaceGeneration: visualEditorGeneration,
                  surfaceIdentity: visualEditorRuntimeRef.current
                }
              : {}),
          surface: context.surface,
          value: documentSession.document.getValue()
        };
      };
      const ensureCurrent = (
        context: EditorContextSnapshot = captured
      ): boolean => {
        if (isCurrent(context)) return true;
        reportContextMenuFailure(
          'editor-context-menu-context-stale',
          props.contextMenuStrings?.statusActionFailed
        );
        return false;
      };
      const ensureSelectionFitsTarget = (
        range: Readonly<{ from: number; to: number }>
      ): boolean => {
        if (editorContextSelectionFitsRange(captured.selection, range)) {
          return true;
        }
        reportContextMenuFailure(
          'editor-context-menu-selection-outside-target',
          props.contextMenuStrings?.statusActionFailed
        );
        return false;
      };
      const isCurrent = (context: EditorContextSnapshot = captured): boolean =>
        isEditorContextCurrent(context, currentContext(context));
      const currentBlockIndex = ():
        | EditorMarkdownBlockIndex
        | null
        | undefined => {
        if (!props.editorBlockIndexPort) return undefined;
        const revision = documentSession.document.getRevision?.();
        const owner =
          'source' === captured.surface
            ? documentSession
            : visualEditorRuntimeRef.current;
        if (undefined === revision || !owner) return null;
        const index = contextMenuBlockIndexCacheRef.current?.peek({
          generation:
            'source' === captured.surface ? 0 : visualEditorGeneration,
          owner,
          revision
        });
        return index && index.source === documentSession.document.getValue()
          ? index
          : null;
      };
      const tableActionContext = (
        value: string,
        blockIndex: EditorMarkdownBlockIndex | null | undefined
      ) => {
        const table = findMarkdownTable(value, captured.selection.start, blockIndex ?? undefined);
        if (!table) {
          reportContextMenuFailure(
            'editor-context-menu-table-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return null;
        }
        if (!ensureSelectionFitsTarget({ from: table.tableStart, to: table.tableEnd })) {
          return null;
        }
        return table;
      };
      const beginOperation = (
        context: EditorContextSnapshot
      ): ContextMenuOperation => {
        const previous = contextMenuOperationRef.current;
        previous?.controller.abort();
        previous?.cleanup();
        const controller = new AbortController();
        const check = (): void => {
          if (!isCurrent(context)) controller.abort();
        };
        const unsubscribeDocument = documentSession.document.subscribe(check);
        const unsubscribeSelection =
          documentSession.document.subscribeSelection(check);
        const operation: ContextMenuOperation = {
          captured: context,
          cleanup: () => {
            unsubscribeDocument();
            unsubscribeSelection();
            if (contextMenuOperationRef.current === operation) {
              contextMenuOperationRef.current = null;
            }
          },
          controller
        };
        contextMenuOperationRef.current = operation;
        check();
        return operation;
      };
      const finishOperation = (operation: ContextMenuOperation): void => {
        if (contextMenuOperationRef.current === operation) operation.cleanup();
      };
      const sourceMutationContext = (): EditorContextSnapshot => {
        if ('source' === captured.surface) return captured;
        const { surfaceGeneration: _surfaceGeneration, ...sourceCaptured } =
          captured;
        return {
          ...sourceCaptured,
          surface: 'source',
          surfaceIdentity: documentSession
        };
      };
      const applyEdit = (
        edit: Readonly<{
          changes?: Readonly<{ from: number; insert: string; to: number }>;
          selectionFallback?: 'caret' | 'reflow-caret';
          selection: Readonly<{
            direction: 'backward' | 'forward' | 'none';
            end: number;
            start: number;
          }>;
          value: string;
        }> | null
      ): boolean => {
        if (!edit) {
          reportContextMenuFailure(
            'editor-context-menu-edit-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return false;
        }
        if (!edit.changes) {
          if (edit.value === documentSession.document.getValue()) return true;
          reportContextMenuFailure(
            'editor-context-menu-edit-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return false;
        }
        if ('visual' === captured.surface) {
          return applyVisualCanonicalChange(captured, {
            changes: edit.changes,
            selection: edit.selection,
            ...(edit.selectionFallback
              ? { selectionFallback: edit.selectionFallback }
              : {}),
            value: edit.value
          });
        }
        documentSession.document.applyTextChange({
          changes: edit.changes,
          selection: edit.selection,
          value: edit.value
        });
        return true;
      };
      if (
        ('source' === captured.surface
          && !documentSession.document.isEditable())
        || ('visual' === captured.surface
          && !visualEditorRuntimeRef.current?.isEditable())
      ) {
        reportContextMenuFailure(
          'editor-context-menu-surface-read-only',
          props.contextMenuStrings?.statusActionFailed
        );
        return;
      }
      if ('bold' === id) {
        if (!ensureCurrent()) return;
        if ('visual' === captured.surface) {
          const command = props.toolbar.commands.find(({ id: commandId }) =>
            commandId === 'bold'
          );
          const runtime = visualEditorRuntimeRef.current;
          if (!command || !runtime) {
            reportContextMenuFailure(
              'editor-context-menu-command-unavailable',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          if (captured.selection.start !== captured.selection.end) {
            const blockIndex = currentBlockIndex();
            const block = findMarkdownBlock(
              captured.value,
              captured.selection.start,
              blockIndex ?? undefined
            );
            const selectionSpansBlocks = !block || !editorContextSelectionFitsRange(
              captured.selection,
              { from: block.start, to: block.end }
            );
            if (selectionSpansBlocks) {
              const prefix = command.prefix ?? '';
              const suffix = command.suffix ?? '';
              const selected = captured.value.slice(
                captured.selection.start,
                captured.selection.end
              );
              const nextValue =
                captured.value.slice(0, captured.selection.start)
                + prefix
                + selected
                + suffix
                + captured.value.slice(captured.selection.end);
              if (applyVisualCanonicalChange(captured, {
                changes: {
                  from: captured.selection.start,
                  insert: `${prefix}${selected}${suffix}`,
                  to: captured.selection.end
                },
                selection: {
                  direction: 'none',
                  end: captured.selection.start
                    + prefix.length
                    + selected.length
                    + suffix.length,
                  start: captured.selection.start
                    + prefix.length
                    + selected.length
                    + suffix.length
                },
                selectionFallback: 'caret',
                value: nextValue
              })) return;
              return;
            }
          }
          const result = runtime.executeCommand(command, {
            requestPreviewTransfer: true
          });
          if ('handled' === result) return;
          if ('unsupported' === result && captured.selection.start !== captured.selection.end) {
            const blockIndex = currentBlockIndex();
            const block = findMarkdownBlock(
              captured.value,
              captured.selection.start,
              blockIndex ?? undefined
            );
            const selectionSpansBlocks = !block || !editorContextSelectionFitsRange(
              captured.selection,
              { from: block.start, to: block.end }
            );
            if (selectionSpansBlocks) {
              const prefix = command.prefix ?? '';
              const suffix = command.suffix ?? '';
              const selected = captured.value.slice(
                captured.selection.start,
                captured.selection.end
              );
              const nextValue =
                captured.value.slice(0, captured.selection.start)
                + prefix
                + selected
                + suffix
                + captured.value.slice(captured.selection.end);
              if (applyVisualCanonicalChange(captured, {
                changes: {
                  from: captured.selection.start,
                  insert: `${prefix}${selected}${suffix}`,
                  to: captured.selection.end
                },
                selection: {
                  direction: 'none',
                  end: captured.selection.start
                    + prefix.length
                    + selected.length
                    + suffix.length,
                  start: captured.selection.start
                    + prefix.length
                    + selected.length
                    + suffix.length
                },
                selectionFallback: 'caret',
                value: nextValue
              })) return;
            }
          }
          reportContextMenuFailure(
            'editor-context-menu-command-failed',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        if (!contextMenuExecutorRef.current) {
          reportContextMenuFailure(
            'editor-context-menu-command-unavailable',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        contextMenuExecutorRef.current('bold');
        return;
      }
      if (['copy', 'copy-as-markdown'].includes(id)) {
        if (!ensureCurrent()) return;
        const text = captured.value.slice(
          captured.selection.start,
          captured.selection.end
        );
        const result = await clipboard.write(text);
        if ('written' !== result.status) {
          reportContextMenuFailure(
            result.code,
            props.contextMenuStrings?.statusClipboardUnavailable
          );
        }
        return;
      }
      if ('copy-as-html' === id) {
        if (!ensureCurrent()) return;
        if (!clipboard.writeDeferred) {
          reportContextMenuFailure(
            'editor-context-menu-clipboard-deferred-unsupported',
            props.contextMenuStrings?.statusClipboardUnavailable
          );
          return;
        }
        const markdown = captured.value.slice(
          captured.selection.start,
          captured.selection.end
        );
        const operation = beginOperation(captured);
        const controller = operation.controller;
        try {
          const renderedHtml = previewPort
            .render(
              previewRequest(
                markdown,
                props.preview,
                previewAppearanceRef.current,
                ++previewRevisionRef.current
              ),
              controller.signal
            )
            .then((response) => response.html);
          const writePromise = clipboard.writeDeferred(renderedHtml, {
            signal: controller.signal
          });
          const [, result] = await Promise.all([renderedHtml, writePromise]);
          if (!ensureCurrent()) return;
          if ('written' !== result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusClipboardUnavailable
            );
          }
        } catch (error) {
          reportContextMenuFailure(
            contextMenuErrorCode(error, 'editor-context-menu-html-copy-failed'),
            props.contextMenuStrings?.statusActionFailed
          );
        } finally {
          finishOperation(operation);
        }
        return;
      }
      if ('copy-simplified-formatting' === id) {
        if (!ensureCurrent()) return;
        if (!clipboard.writeRichDeferred || !props.simplifiedFormattingParser) {
          reportContextMenuFailure(
            'editor-context-menu-rich-clipboard-unsupported',
            props.contextMenuStrings?.statusClipboardUnavailable
          );
          return;
        }
        const markdown = captured.value.slice(
          captured.selection.start,
          captured.selection.end
        );
        const operation = beginOperation(captured);
        const controller = operation.controller;
        const payload = previewPort
          .render(
            previewRequest(
              markdown,
              props.preview,
              previewAppearanceRef.current,
              ++previewRevisionRef.current
            ),
            controller.signal
          )
          .then((response) => {
            if (controller.signal.aborted || !isCurrent(captured)) {
              throw new Error('editor-context-menu-context-stale');
            }
            const converted = createSimplifiedFormattingPayload(response.html, {
              parser:
                props.simplifiedFormattingParser as SimplifiedFormattingDomParser
            });
            if ('failed' === converted.status) throw new Error(converted.code);
            return converted.payload;
          });
        void payload.catch(() => undefined);
        try {
          const result = await clipboard.writeRichDeferred(payload, {
            signal: controller.signal
          });
          if (!ensureCurrent()) return;
          if ('written' !== result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusClipboardUnavailable
            );
          }
        } catch (error) {
          reportContextMenuFailure(
            contextMenuErrorCode(error, 'editor-context-menu-rich-copy-failed'),
            props.contextMenuStrings?.statusActionFailed
          );
        } finally {
          finishOperation(operation);
        }
        return;
      }
      if (
        (
          'copy-code-block' === id
          && Boolean(actionContext?.generated)
        )
        || [
          'copy-generated-image',
          'copy-generated-mathml',
          'copy-generated-source',
          'save-generated-image',
          'edit-generated-content',
          'insert-paragraph-above-generated',
          'insert-paragraph-below-generated',
          'delete-generated-content'
        ].includes(id)
      ) {
        const generated = actionContext?.generated;
        if (!generated?.lease.isCurrent?.()) {
          reportContextMenuFailure(
            'generated-content-export-lease-stale',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        if (!ensureCurrent()) return;
        const original = generated.lease.target.original;
        const sourceBeforeTransfer = documentSession.document.getValue();
        const sourceMatchesOriginal = (source: string): boolean =>
          original.fullRange.from >= 0
          && original.fullRange.to > original.fullRange.from
          && original.fullRange.to <= source.length
          && source.slice(original.fullRange.from, original.fullRange.to)
            === original.full;
        if (!sourceMatchesOriginal(sourceBeforeTransfer)) {
          reportContextMenuFailure(
            'generated-content-export-source-stale',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        if (!ensureSelectionFitsTarget(original.fullRange)) return;
        if ('copy-code-block' === id) {
          const result = await clipboard.write(generated.lease.target.original.full);
          if (!ensureCurrent()) return;
          if ('written' !== result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusClipboardUnavailable
            );
          }
          return;
        }
        if ('copy-generated-source' === id) {
          const result = await clipboard.write(
            generated.lease.target.original.body
          );
          if (!ensureCurrent()) return;
          if ('written' !== result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusClipboardUnavailable
            );
          }
          return;
        }
        if (
          'copy-generated-image' === id
          || 'copy-generated-mathml' === id
          || 'save-generated-image' === id
        ) {
          if (!ensureCurrent()) return;
          const exportSession = props.generatedContentExportSession;
          if (!exportSession) {
            reportContextMenuFailure(
              'generated-content-export-unsupported',
              props.contextMenuStrings?.unsupported
            );
            return;
          }
          const request = {
            identity: generated.identity,
            lease: generated.lease,
            mode: generated.mode,
            validateLease: generated.validateLease
          };
          const result =
            'copy-generated-image' === id
              ? await exportSession.copyAsImage(request)
              : 'copy-generated-mathml' === id
                ? await exportSession.copyMathMl(request)
                : await exportSession.saveAsImage({
                    ...request,
                    filename: generated.filename
                  });
          if ('failed' === result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusActionFailed
            );
          }
          return;
        }
        if ('edit-generated-content' === id) {
          if ('visual' === captured.surface) {
            const capturedRevision = captured.revision;
            if (
              'number' !== typeof capturedRevision
              || !Number.isSafeInteger(capturedRevision)
            ) {
              reportContextMenuFailure(
                'generated-content-export-source-stale',
                props.contextMenuStrings?.statusActionFailed
              );
              return;
            }
            const expectedRevision = capturedRevision;
            if (
              !prepareGeneratedSourceNavigation(
                { revision: expectedRevision, value: captured.value },
                () => {
                  const source = documentSession.document.getValue();
                  return (
                    source === captured.value && sourceMatchesOriginal(source)
                  );
                }
              )
            ) {
              reportContextMenuFailure(
                'editor-context-menu-visual-selection-unavailable',
                props.contextMenuStrings?.statusActionFailed
              );
              return;
            }
          }
          const sourceAfterTransfer = documentSession.document.getValue();
          if (
            sourceAfterTransfer !== captured.value
            || sourceAfterTransfer.slice(
              original.fullRange.from,
              original.fullRange.to
            ) !== original.full
          ) {
            reportContextMenuFailure(
              'generated-content-export-source-stale',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          documentSession.document.revealPosition(
            generated.lease.target.original.fullRange.from
          );
          return;
        }
        if (
          'insert-paragraph-above-generated' === id
          || 'insert-paragraph-below-generated' === id
        ) {
          if (!ensureCurrent()) return;
          if (!generated.lease.isCurrent?.()) {
            reportContextMenuFailure(
              'generated-content-export-lease-stale',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          const value = documentSession.document.getValue();
          const position = generated.lease.target.original.fullRange.from;
          const blockIndex = currentBlockIndex();
          if (null === blockIndex) {
            reportContextMenuFailure(
              'editor-context-menu-block-index-unavailable',
              props.contextMenuStrings?.unsupported
            );
            return;
          }
          const edit = insertParagraphRelative(
            value,
            { direction: 'none', end: position, start: position },
            'insert-paragraph-above-generated' === id ? 'before' : 'after',
            blockIndex
          );
          applyEdit(edit);
          return;
        }
        if ('delete-generated-content' === id) {
          if (!ensureCurrent()) return;
          if (!generated.lease.isCurrent?.()) {
            reportContextMenuFailure(
              'generated-content-export-lease-stale',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          const value = documentSession.document.getValue();
          const range = generated.lease.target.original.fullRange;
          if (
            range.from < 0
            || range.to <= range.from
            || range.to > value.length
            || value.slice(range.from, range.to)
              !== generated.lease.target.original.full
          ) {
            reportContextMenuFailure(
              'generated-content-export-source-stale',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          applyEdit({
            changes: { from: range.from, insert: '', to: range.to },
            selection: {
              direction: 'none',
              end: range.from,
              start: range.from
            },
            value: value.slice(0, range.from) + value.slice(range.to)
          });
          return;
        }
      }
      if ('cut' === id) {
        if (!ensureCurrent()) return;
        if ('visual' === captured.surface) {
          const operation = beginOperation(captured);
          try {
            const result = await clipboard.write(
              captured.value.slice(
                captured.selection.start,
                captured.selection.end
              ),
              { signal: operation.controller.signal }
            );
            if ('written' !== result.status) {
              if (!operation.controller.signal.aborted) {
                reportContextMenuFailure(
                  result.code,
                  props.contextMenuStrings?.statusActionFailed
                );
              }
              return;
            }
            if (operation.controller.signal.aborted || !ensureCurrent()) return;
            finishOperation(operation);
            const value = documentSession.document.getValue();
            applyVisualCanonicalChange(captured, {
              changes: {
                from: captured.selection.start,
                insert: '',
                to: captured.selection.end
              },
              selection: {
                direction: 'none',
                end: captured.selection.start,
                start: captured.selection.start
              },
              value:
                value.slice(0, captured.selection.start)
                + value.slice(captured.selection.end)
            });
          } finally {
            finishOperation(operation);
          }
          return;
        }
        const mutationContext = sourceMutationContext();
        const operation = beginOperation(mutationContext);
        try {
          const result = await cutEditorSelection({
            captured: mutationContext,
            clipboard,
            deleteSelection: () => {
              const value = documentSession.document.getValue();
              const position = captured.selection.start;
              documentSession.document.applyTextChange({
                changes: {
                  from: captured.selection.start,
                  insert: '',
                  to: captured.selection.end
                },
                selection: {
                  direction: 'none',
                  end: position,
                  start: position
                },
                value:
                  value.slice(0, captured.selection.start)
                  + value.slice(captured.selection.end)
              });
            },
            getCurrentContext: () => currentContext(mutationContext),
            signal: operation.controller.signal
          });
          if ('cut' !== result.status && !operation.controller.signal.aborted) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusActionFailed
            );
          }
        } finally {
          finishOperation(operation);
        }
        return;
      }
      if (['paste', 'paste-plain-text'].includes(id)) {
        if (!ensureCurrent()) return;
        const operation = beginOperation(captured);
        try {
          const result = await clipboard.read({
            signal: operation.controller.signal
          });
          if (operation.controller.signal.aborted || !ensureCurrent()) return;
          if ('available' !== result.status) {
            reportContextMenuFailure(
              'code' in result
                ? result.code
                : 'editor-context-menu-clipboard-empty',
              props.contextMenuStrings?.statusClipboardUnavailable
            );
            return;
          }
          finishOperation(operation);
          if ('visual' === captured.surface) {
            const value = documentSession.document.getValue();
            applyVisualCanonicalChange(captured, {
              changes: {
                from: captured.selection.start,
                insert: result.text,
                to: captured.selection.end
              },
              selection: {
                direction: 'none',
                end: captured.selection.start + result.text.length,
                start: captured.selection.start + result.text.length
              },
              value:
                value.slice(0, captured.selection.start)
                + result.text
                + value.slice(captured.selection.end)
            });
            return;
          }
          const value = documentSession.document.getValue();
          const nextValue =
            value.slice(0, captured.selection.start)
            + result.text
            + value.slice(captured.selection.end);
          const position = captured.selection.start + result.text.length;
          documentSession.document.applyTextChange({
            changes: {
              from: captured.selection.start,
              insert: result.text,
              to: captured.selection.end
            },
            selection: { direction: 'none', end: position, start: position },
            value: nextValue
          });
        } finally {
          finishOperation(operation);
        }
        return;
      }
      if (
        [
          'insert-paragraph-above',
          'insert-paragraph-below',
          'insert-paragraph-above-code',
          'insert-paragraph-below-code',
          'insert-paragraph-above-table',
          'insert-paragraph-below-table'
        ].includes(id)
      ) {
        if (!ensureCurrent()) return;
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        const block = findMarkdownBlock(
          value,
          captured.selection.start,
          blockIndex ?? undefined
        );
        const codeTarget = actionContext?.code?.target;
        const codeRelative = id.includes('-code');
        const targetRange = codeRelative
          ? codeTarget
            ? { from: codeTarget.from, to: codeTarget.to }
            : null
          : block
            ? { from: block.start, to: block.end }
            : null;
        if (!targetRange) {
          reportContextMenuFailure(
            'editor-context-menu-block-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        if (!ensureSelectionFitsTarget(targetRange)) return;
        const edit = insertParagraphRelative(
          value,
          captured.selection,
          id.includes('above') ? 'before' : 'after',
          blockIndex,
          codeRelative ? codeTarget : undefined
        );
        applyEdit(edit);
        return;
      }
      if (['indent-code-block', 'indent-selected-code'].includes(id)) {
        if (!ensureCurrent()) return;
        const code = actionContext?.code;
        const selected = 'indent-selected-code' === id;
        if (
          !code
          || (selected
            ? code.canIndentSelection !== true
            : code.canIndentBlock !== true)
          || !code.codeMap
          || !code.codeProjection
          || !code.target
          || !code.content
        ) {
          reportContextMenuFailure(
            'editor-code-projection-target-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const projectionEntry = editorCodeProjectionEntry(code);
        const contentLineRange = editorCodeContentLineRange(
          code,
          captured.value,
          captured.selection,
          selected
        );
        if (!projectionEntry || !contentLineRange) {
          reportContextMenuFailure(
            'editor-code-projection-target-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const operation = beginOperation(captured);
        try {
          const indentation = await indentEditorCode({
            content: code.content,
            info: 'fenced' === projectionEntry.kind
              ? projectionEntry.info
              : '',
            language: '',
            lineRange: {
              endLine: contentLineRange.end,
              startLine: contentLineRange.start
            },
            signal: operation.controller.signal
          });
          if (operation.controller.signal.aborted || !ensureCurrent()) return;
          if ('unavailable' === indentation.status) {
            reportContextMenuFailure(
              indentation.code,
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          const encoded = encodeEditorCodeProjection({
            codeMap: code.codeMap,
            contentLineRange,
            desiredSemanticBody: indentation.content,
            projection: code.codeProjection,
            selection: captured.selection,
            signature: code.requestSignature ?? '',
            source: captured.value,
            target: {
              endLine: code.target.lineEnd,
              kind: code.target.kind,
              startLine: code.target.lineStart
            }
          });
          if ('unavailable' === encoded.status) {
            reportContextMenuFailure(
              encoded.code,
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          if (encoded.noop || !encoded.changes) return;
          const nextValue =
            captured.value.slice(0, encoded.changes.from)
            + encoded.changes.insert
            + captured.value.slice(encoded.changes.to);
          const candidateTarget = candidateEditorCodeTarget(
            nextValue,
            encoded.selection,
            code.target,
            encoded.changes
          );
          if (
            !candidateTarget
            || !sameCandidateEditorCodeTarget(
              candidateTarget,
              code.target,
              encoded.changes
            )
          ) {
            reportContextMenuFailure(
              'editor-code-projection-candidate-stale',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          const defaultArticleTheme = props.appearance.articleThemes.find(
            ({ id: themeId }) => 'default' === themeId
          );
          if (
            !defaultArticleTheme
            || !props.appearance.codeThemes.some(
              ({ id: themeId }) =>
                themeId === defaultArticleTheme.defaultCodeTheme
            )
          ) {
            reportContextMenuFailure(
              'editor-code-projection-candidate-unavailable',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          const candidateRequest: PreviewRequest = {
            codeTheme: defaultArticleTheme.defaultCodeTheme,
            customCssId: '',
            markdown: nextValue.slice(
              candidateTarget.ownerFrom,
              candidateTarget.ownerEnd
            ),
            markdownTheme: defaultArticleTheme.id,
            postId: props.preview.postId,
            signature:
              `editor-code-indent-candidate:${++editorCodeIndentationCandidateSequenceRef.current}`
          };
          let candidateResponse: PreviewResponse;
          try {
            candidateResponse = await previewPort.render(
              candidateRequest,
              operation.controller.signal
            );
          } catch {
            if (!rootActiveRef.current) return;
            if (operation.controller.signal.aborted && !isCurrent()) {
              reportContextMenuFailure(
                'editor-code-projection-candidate-stale',
                props.contextMenuStrings?.statusActionFailed
              );
            } else if (!operation.controller.signal.aborted) {
              reportContextMenuFailure(
                'editor-code-projection-candidate-unavailable',
                props.contextMenuStrings?.statusActionFailed
              );
            }
            return;
          }
          if (operation.controller.signal.aborted) {
            if (rootActiveRef.current && !isCurrent()) {
              reportContextMenuFailure(
                'editor-code-projection-candidate-stale',
                props.contextMenuStrings?.statusActionFailed
              );
            }
            return;
          }
          if (!ensureCurrent()) return;
          let candidateValidation: EditorCodeIndentationCandidateValidation;
          try {
            candidateValidation = validateEditorCodeIndentationCandidate({
              candidateSource: nextValue,
              changes: encoded.changes,
              contentLineRange,
              desiredSemanticBody: indentation.content,
              originalProjectionEntry: projectionEntry,
              originalTarget: code.target,
              response: candidateResponse,
              selection: encoded.selection,
              signature: candidateRequest.signature
            });
          } catch {
            reportContextMenuFailure(
              'editor-code-projection-candidate-unavailable',
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          if ('unavailable' === candidateValidation.status) {
            reportContextMenuFailure(
              candidateValidation.code,
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          if (!ensureCurrent()) return;
          finishOperation(operation);
          applyEdit({
            changes: encoded.changes,
            selection: encoded.selection,
            ...(captured.surface === 'visual'
              ? { selectionFallback: 'reflow-caret' as const }
              : {}),
            value: nextValue
          });
        } finally {
          finishOperation(operation);
        }
        return;
      }
      if (['copy-code-block', 'copy-code-content', 'delete-code-block'].includes(id)) {
        if (!ensureCurrent()) return;
        const value = documentSession.document.getValue();
        const codeTarget = actionContext?.code?.target;
        const codeBlock = findMarkdownBlock(
          value,
          captured.selection.start,
          currentBlockIndex() ?? undefined
        );
        const targetRange = codeTarget
          ? { from: codeTarget.from, to: codeTarget.to }
          : codeBlock
            ? { from: codeBlock.start, to: codeBlock.end }
            : null;
        if (!targetRange) {
          reportContextMenuFailure(
            'editor-context-menu-code-block-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        if (!ensureSelectionFitsTarget(targetRange)) return;
        if ('copy-code-content' === id) {
          const code = actionContext?.code;
          if (!code?.canCopyContent || !code.content) {
            reportContextMenuFailure(
              'editor-code-content-map-unavailable',
              props.contextMenuStrings?.unsupported
            );
            return;
          }
          const operation = beginOperation(captured);
          try {
            const result = await clipboard.write(code.content, {
              signal: operation.controller.signal
            });
            if (operation.controller.signal.aborted || !ensureCurrent()) return;
            if ('written' !== result.status) {
              reportContextMenuFailure(
                result.code,
                props.contextMenuStrings?.statusClipboardUnavailable
              );
            }
          } finally {
            finishOperation(operation);
          }
          return;
        }
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const block =
          undefined === blockIndex
            ? findMarkdownBlock(value, captured.selection.start)
            : findMarkdownBlock(value, captured.selection.start, blockIndex);
        if ('code' !== block?.kind && !codeTarget) {
          reportContextMenuFailure(
            'editor-context-menu-code-block-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        if ('copy-code-block' === id) {
          const result = await clipboard.write(
            value.slice(
              codeTarget?.from ?? block?.start ?? 0,
              codeTarget?.to ?? block?.end ?? 0
            )
          );
          if ('written' !== result.status)
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusClipboardUnavailable
            );
          return;
        }
        const blockStart = codeTarget?.from ?? block?.start;
        const blockEnd = codeTarget?.to ?? block?.end;
        if (undefined === blockStart || undefined === blockEnd) {
          reportContextMenuFailure(
            'editor-context-menu-code-block-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const nextValue = value.slice(0, blockStart) + value.slice(blockEnd);
        applyEdit({
          changes: { from: blockStart, insert: '', to: blockEnd },
          selection: {
            direction: 'none',
            end: blockStart,
            start: blockStart
          },
          value: nextValue
        });
        return;
      }
      if ('insert-table' === id) {
        if (!ensureCurrent()) return;
        setContextMenuTableRequest(captured);
        return;
      }
      if ('insert-image' === id) {
        if (!ensureCurrent()) return;
        const runtime =
          'visual' === captured.surface ? visualEditorRuntimeRef.current : null;
        const apply =
          'visual' === captured.surface
            ? applyVisualCanonicalChangeRef.current
            : null;
        if ('visual' === captured.surface && (!runtime || !apply)) {
          reportContextMenuFailure(
            'editor-context-menu-visual-selection-unavailable',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        const visualCaptured = 'visual' === captured.surface ? captured : null;
        const pickerDocument =
          runtime && apply && visualCaptured
            ? visualMediaPickerDocument(
                documentSession,
                visualCaptured,
                () => rootActiveRef.current,
                () => runtime.surface.focus(),
                apply
              )
            : undefined;
        void openMediaPicker(documentSession, pickerDocument);
        return;
      }
      if ('delete-thematic-break' === id) {
        if (!ensureCurrent()) return;
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        const block = findMarkdownBlock(
          value,
          captured.selection.start,
          blockIndex ?? undefined
        );
        if ('thematic-break' !== block?.kind) {
          reportContextMenuFailure(
            'editor-context-menu-thematic-break-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        if (!ensureSelectionFitsTarget({ from: block.start, to: block.end })) return;
        applyEdit(deleteThematicBreak(value, captured.selection, blockIndex ?? undefined));
        return;
      }
      const tableOperationIds = new Set([
        'insert-row-above',
        'insert-row-below',
        'insert-column-left',
        'insert-column-right',
        'delete-row',
        'delete-column',
        'delete-table'
      ]);
      if (tableOperationIds.has(id)) {
        if (!ensureCurrent()) return;
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        if (!tableActionContext(value, blockIndex)) return;
        const edit = editMarkdownTable(
          value,
          captured.selection.start,
          { type: id as MarkdownTableOperation['type'] },
          blockIndex
        );
        applyEdit(edit);
        return;
      }
      if ('copy-table' === id) {
        if (!ensureCurrent()) return;
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        if (!tableActionContext(value, blockIndex)) return;
        const edit = editMarkdownTable(
          value,
          captured.selection.start,
          { type: 'copy-table' },
          blockIndex
        );
        if (!edit?.copiedText) {
          reportContextMenuFailure(
            'editor-context-menu-table-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const result = await clipboard.write(edit.copiedText);
        if ('written' !== result.status) {
          reportContextMenuFailure(
            result.code,
            props.contextMenuStrings?.statusClipboardUnavailable
          );
        }
        return;
      }
      if ('format-table-source' === id) {
        if (!ensureCurrent()) return;
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        if (!tableActionContext(value, blockIndex)) return;
        const edit = formatMarkdownTableSource(
          value,
          captured.selection,
          blockIndex
        );
        if (!edit) {
          reportContextMenuFailure(
            'editor-context-menu-table-format-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        applyEdit(edit);
        return;
      }
      if (['align-left', 'align-center', 'align-right'].includes(id)) {
        if (!ensureCurrent()) return;
        const blockIndex = currentBlockIndex();
        if (null === blockIndex) {
          reportContextMenuFailure(
            'editor-context-menu-block-index-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        if (!tableActionContext(value, blockIndex)) return;
        const edit = setMarkdownTableAlignment(
          value,
          captured.selection.start,
          {
            alignment: id.slice('align-'.length) as 'left' | 'center' | 'right',
            selection: tableSelectionAt(
              value,
              captured.selection,
              blockIndex
            ) ?? { kind: 'whole-table' }
          },
          captured.selection,
          blockIndex
        );
        if ('status' in edit) {
          reportContextMenuFailure(
            edit.code,
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        applyEdit(edit);
        return;
      }
      if (/^image-scale-(25|33|50|67|100|150|200)$/u.test(id)) {
        if (!ensureCurrent()) return;
        const image = findMarkdownImageAt(
          captured.value,
          captured.selection.start,
          captured.selection.end
        );
        if (!image) {
          reportContextMenuFailure(
            'editor-context-menu-image-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const replacement = createImageScaleReplacement(
          captured.value,
          image,
          Number(id.slice('image-scale-'.length)) as
            | 25
            | 33
            | 50
            | 67
            | 100
            | 150
            | 200
        );
        const value = documentSession.document.getValue();
        const nextValue =
          value.slice(0, replacement.from)
          + replacement.insert
          + value.slice(replacement.to);
        applyEdit({
          changes: replacement,
          selection: {
            direction: 'none',
            end: replacement.from + replacement.insert.length,
            start: replacement.from + replacement.insert.length
          },
          value: nextValue
        });
        return;
      }
      if ('copy-image' === id) {
        const imageContext = actionContext?.image;
        const imagePixels = props.editorImagePixelsPort;
        if (
          !imageContext?.canCopyImage
          || !imageContext.lease
          || !imagePixels
          || !clipboard.writeImageDeferred
        ) {
          reportContextMenuFailure(
            'editor-context-menu-image-copy-unsupported',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        if (!ensureCurrent() || !imageContext.lease.isCurrent()) {
          reportContextMenuFailure(
            'editor-context-menu-image-stale',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        const operation = beginOperation(captured);
        const controller = operation.controller;
        let extractionFailure: string | null = null;
        const imageLease: EditorImagePixelsLease = {
          image: imageContext.lease.root,
          isCurrent: imageContext.lease.isCurrent
        };
        const png = Promise.resolve()
          .then(() =>
            imagePixels.extractPng({
              lease: imageLease,
              signal: controller.signal
            })
          )
          .then((result) => {
            if ('failed' === result.status) {
              extractionFailure = result.code;
              throw new Error(result.code);
            }
            return result.blob;
          });
        void png.catch(() => undefined);
        try {
          // Start the native deferred Clipboard operation during the original click.
          const result = await clipboard.writeImageDeferred(png, {
            signal: controller.signal
          });
          if (!ensureCurrent() || !imageContext.lease.isCurrent()) return;
          if ('written' !== result.status) {
            controller.abort();
            reportContextMenuFailure(
              extractionFailure ?? result.code,
              props.contextMenuStrings?.statusClipboardUnavailable
            );
          }
        } catch (error) {
          const wasAborted = controller.signal.aborted;
          controller.abort();
          if (!wasAborted) {
            const code =
              extractionFailure
              ?? (error instanceof Error
              && /^editor-image-pixels-[a-z0-9-]+$/u.test(error.message)
                ? error.message
                : 'editor-context-menu-image-copy-failed');
            reportContextMenuFailure(
              code,
              props.contextMenuStrings?.statusActionFailed
            );
          }
        } finally {
          if (controller.signal.aborted || extractionFailure)
            controller.abort();
          finishOperation(operation);
        }
        return;
      }
      if ('delete-image' === id) {
        if (!ensureCurrent()) return;
        const image = findMarkdownImageAt(
          captured.value,
          captured.selection.start,
          captured.selection.end
        );
        if (!image) {
          reportContextMenuFailure(
            'editor-context-menu-image-unavailable',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const value = documentSession.document.getValue();
        const current = parseMarkdownImageScale(value, image.start);
        if (!current || current.raw !== image.raw) {
          reportContextMenuFailure(
            'editor-context-menu-image-stale',
            props.contextMenuStrings?.statusActionFailed
          );
          return;
        }
        const nextValue =
          value.slice(0, current.start) + value.slice(current.end);
        applyEdit({
          changes: { from: current.start, insert: '', to: current.end },
          selection: {
            direction: 'none',
            end: current.start,
            start: current.start
          },
          value: nextValue
        });
        return;
      }
      if ('open-link' === id || 'copy-link-address' === id) {
        if (!actionContext?.link || !ensureCurrent()) return;
        if ('open-link' === id) {
          const result = props.editorLinkPort?.open(
            actionContext.link.href
          ) ?? {
            code: 'editor-link-open-failed',
            status: 'failed' as const
          };
          if ('failed' === result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusActionFailed
            );
          }
          return;
        }
        const result = await clipboard.write(actionContext.link.href);
        if (!ensureCurrent()) return;
        if ('written' !== result.status) {
          reportContextMenuFailure(
            result.code,
            props.contextMenuStrings?.statusClipboardUnavailable
          );
        }
        return;
      }
      if ('upload-image' === id) {
        if (!ensureCurrent()) return;
        const image = findMarkdownImageAt(
          captured.value,
          captured.selection.start,
          captured.selection.end
        );
        if (
          !image
          || !/^https?:\/\//iu.test(image.destination)
          || 'off' === props.imageUpload.remoteImageUploadMode
        ) {
          reportContextMenuFailure(
            'editor-context-menu-image-upload-unsupported',
            props.contextMenuStrings?.unsupported
          );
          return;
        }
        const operation = beginOperation(captured);
        const controller = operation.controller;
        try {
          const result = await remoteImageImportPort.import({
            altText: image.alt,
            postId: props.imageUpload.postId,
            signal: controller.signal,
            url: image.destination
          });
          if ('failed' === result.status) {
            reportContextMenuFailure(
              result.code,
              props.contextMenuStrings?.statusActionFailed
            );
            return;
          }
          if (controller.signal.aborted || !ensureCurrent()) return;
          const current = documentSession.document.getValue();
          const parsed = parseMarkdownImageScale(current, image.start);
          if (!parsed) throw new Error('editor-context-menu-image-stale');
          const replacement = createMarkdownImageDestinationReplacement(
            current,
            parsed,
            result.url
          );
          if (!replacement) return;
          const nextValue =
            current.slice(0, replacement.from)
            + replacement.insert
            + current.slice(replacement.to);
          applyEdit({
            changes: replacement,
            selection: {
              direction: 'none',
              end: replacement.from + replacement.insert.length,
              start: replacement.from + replacement.insert.length
            },
            value: nextValue
          });
        } catch (error) {
          if (!controller.signal.aborted) {
            reportContextMenuFailure(
              contextMenuErrorCode(
                error,
                'editor-context-menu-image-upload-failed'
              ),
              props.contextMenuStrings?.statusActionFailed
            );
          }
        } finally {
          finishOperation(operation);
        }
        return;
      }
      reportContextMenuFailure(
        'editor-context-menu-action-unavailable',
        props.contextMenuStrings?.unsupported
      );
    },
    [
      applyVisualCanonicalChange,
      documentSession,
      props.contextMenuStrings,
      props.editorClipboardPort,
      props.editorImagePixelsPort,
      props.editorLinkPort,
      props.generatedContentExportSession,
      props.imageUpload.postId,
      props.imageUpload.remoteImageUploadMode,
      props.preview,
      props.simplifiedFormattingParser,
      openMediaPicker,
      previewPort,
      reportContextMenuFailure,
      prepareSourceMutation,
      prepareGeneratedSourceNavigation,
      remoteImageImportPort,
      visualEditorGeneration
    ]
  );
  const insertContextMenuTable = useCallback(
    (rows: number, columns: number): void => {
      const request = contextMenuTableRequest;
      if (!request || !documentSession) {
        setContextMenuTableRequest(null);
        reportContextMenuFailure(
          'editor-context-menu-table-dialog-stale',
          props.contextMenuStrings?.statusActionFailed
        );
        return;
      }
      const revision = documentSession.document.getRevision?.();
      const current = {
        ...(undefined === revision ? {} : { revision }),
        selection: documentSession.document.getSelection(),
        ...('source' === request.surface
          ? { surfaceIdentity: documentSession }
          : visualEditorRuntimeRef.current
            ? {
                surfaceGeneration: visualEditorGeneration,
                surfaceIdentity: visualEditorRuntimeRef.current
              }
            : {}),
        surface: request.surface,
        value: documentSession.document.getValue()
      };
      if (!isEditorContextCurrent(request, current)) {
        setContextMenuTableRequest(null);
        reportContextMenuFailure(
          'editor-context-menu-context-stale',
          props.contextMenuStrings?.statusActionFailed
        );
        return;
      }
      const insertion = tableMarkdown(rows, columns);
      const value = documentSession.document.getValue();
      const nextValue =
        value.slice(0, request.selection.start)
        + insertion
        + value.slice(request.selection.end);
      const caret = request.selection.start + insertion.length;
      let applied: boolean;
      if ('visual' === request.surface) {
        applied = applyVisualCanonicalChange(request, {
          changes: {
            from: request.selection.start,
            insert: insertion,
            to: request.selection.end
          },
          selection: { direction: 'none', end: caret, start: caret },
          value: nextValue
        });
      } else {
        documentSession.document.applyTextChange({
          changes: {
            from: request.selection.start,
            insert: insertion,
            to: request.selection.end
          },
          selection: { direction: 'none', end: caret, start: caret },
          value: nextValue
        });
        applied = true;
      }
      if (!applied) {
        setContextMenuTableRequest(null);
        return;
      }
      setContextMenuTableRequest(null);
      if ('source' === request.surface) documentSession.document.focus();
    },
    [
      contextMenuTableRequest,
      documentSession,
      applyVisualCanonicalChange,
      props.contextMenuStrings,
      reportContextMenuFailure,
      visualEditorGeneration
    ]
  );
  const publish = useCallback(
    (draft: NativePublishDraft, original: NativePublishSnapshot): boolean => {
      if (!documentSession)
        throw new Error('immersive-publish-session-unavailable');
      const sessionError = protectedOperationError('post-write');
      if (sessionError) return false;
      try {
        props.nativePublishPort.apply(draft);
      } catch {
        props.onFailure('immersive-publish-native-owner-unavailable');
        return false;
      }
      if (true !== props.publishPost(documentSession)) {
        try {
          props.nativePublishPort.apply(original);
        } catch {
          props.onFailure('immersive-publish-native-restore-unavailable');
          return false;
        }
        props.onFailure('immersive-publish-command-unavailable');
        return false;
      }
      return true;
    },
    [
      documentSession,
      props.nativePublishPort,
      props.immersiveStrings.publishFailed,
      props.onFailure,
      props.publishPost,
      protectedOperationError
    ]
  );
  const selectFeaturedImage = useCallback(() => {
    if (featuredImageOperationRef.current) {
      return featuredImageOperationRef.current;
    }
    const sessionError = protectedOperationError('authenticated');
    const frame = props.mediaPickerFrame;
    const frameAvailable = Boolean(frame?.attachFrame && frame.frameUrl);
    const operation = sessionError
      ? Promise.reject(sessionError)
      : !frameAvailable
        ? Promise.reject(new Error('featured-image-picker-unavailable'))
        : openFeaturedImagePicker(
            frame,
            props.immersiveStrings.selectFeaturedImage
          );
    if (!sessionError && frameAvailable) {
      setMediaPickerDialog('featured');
    }
    const reported = operation.catch((error: unknown) => {
      props.onFailure(
        error instanceof Error
          && /^featured-image-[a-z0-9-]+$/.test(error.message)
          ? error.message
          : 'featured-image-picker-failed'
      );
      return null;
    });
    featuredImageOperationRef.current = reported;
    void reported.finally(() => {
      if (featuredImageOperationRef.current === reported) {
        featuredImageOperationRef.current = null;
      }
      setMediaPickerDialog(null);
    });
    return reported;
  }, [
    props.immersiveStrings.selectFeaturedImage,
    props.mediaPickerFrame,
    props.onFailure,
    protectedOperationError
  ]);
  const enterImmersive = useCallback(() => {
    closeForToolbar();
    toolbarSessionRef.current?.closePopovers();
    restoreImmersiveFocusRef.current = true;
    const preferences = props.immersivePreferencesPort.read();
    setImmersivePreferences(preferences);
    setEditorStatusState((currentState) => ({
      focused: false,
      status:
        'local-draft' === currentState.status?.owner
        && 'error' !== currentState.status.type
          ? null
          : currentState.status
    }));
    immersiveRef.current = true;
    setImmersive(true);
  }, [closeForToolbar, props.immersivePreferencesPort]);
  const exitImmersive = useCallback(() => {
    cancelVisualUnlockPreparation();
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    ) {
      immersiveRef.current = false;
      setImmersive(false);
      return;
    }
    void prepareSourceMutationWithPreview().then((prepared) => {
      if (!prepared || !rootActiveRef.current) return;
      immersiveRef.current = false;
      setImmersive(false);
    });
  }, [cancelVisualUnlockPreparation, prepareSourceMutationWithPreview]);
  const changeImmersiveMode = useCallback(
    (mode: ImmersiveViewMode) => {
      if (mode === immersiveModeRef.current) return;
      cancelVisualUnlockPreparation();
      if (
        !visualPreviewEditingRef.current
        && !visualPreviewWindowRequestedRef.current
      ) {
        setImmersiveMode(mode);
        return;
      }
      void prepareSourceMutationWithPreview().then((prepared) => {
        if (!prepared || !rootActiveRef.current) return;
        setImmersiveMode(mode);
      });
    },
    [cancelVisualUnlockPreparation, prepareSourceMutationWithPreview]
  );
  const copyWechatFromImmersive = useCallback(async () => {
    return 'copied' === (await wechatSession.copy()).status;
  }, [wechatSession]);

  useEffect(() => {
    if (immersive || !restoreImmersiveFocusRef.current) return;
    restoreImmersiveFocusRef.current = false;
    immersiveToggleRef.current?.focus();
  }, [immersive]);

  useLayoutEffect(() => {
    if (codeThemeFrameSyncPendingRef.current !== renderedCodeTheme) return;
    codeThemeFrameSyncPendingRef.current = null;
    const surface = previewRuntimeRef.current?.surface;
    if (!surface) {
      props.onFailure('preview-enhancement-runtime-unavailable');
      return;
    }
    try {
      props.enhancementPort.syncCodeFrameBackgrounds(surface);
      scheduleCurrentWechatPreviewPreparation();
    } catch (error) {
      props.onFailure(previewEnhancementFailureCode(error));
    }
  }, [
    props.enhancementPort,
    props.onFailure,
    renderedCodeTheme,
    scheduleCurrentWechatPreviewPreparation
  ]);

  useLayoutEffect(() => {
    if (!immersive || !documentSession || !rootRef.current) return;
    const releaseFocusBoundary =
      props.immersiveEnvironment.activateFocusBoundary(rootRef.current);
    documentSession.document.focus();
    return releaseFocusBoundary;
  }, [documentSession, immersive, props.immersiveEnvironment]);
  const activeArticleTheme = props.appearance.articleThemes.find(
    ({ id }) => id === appearanceState.markdownTheme
  );
  const previewFontStack = buildFontStack(
    props.fonts.options,
    fontState,
    activeArticleTheme?.usesThemeFontFamily
      ? 'var(--easymde-theme-font-family, sans-serif)'
      : ''
  );
  const usesCrimsonThemeDefaults =
    'crimson-focus' === appearanceState.markdownTheme
    && 'theme-default' === fontState.serifFont
    && Boolean(previewFontStack);
  const previewClassName = [
    'easymde-preview',
    'easymde-rendered-content',
    'easymde-code-mac',
    `easymde-markdown-theme-${appearanceState.markdownTheme}`,
    `easymde-code-theme-${renderedCodeTheme}`,
    visualPreviewEditing ? 'easymde-immersive-visual-editor' : '',
    'custom' === appearanceState.markdownTheme
      ? 'easymde-custom-css-active'
      : '',
    previewFontStack ? 'easymde-font-overrides' : '',
    usesCrimsonThemeDefaults ? 'easymde-theme-default-fonts' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const previewStyle = {
    ...(previewFontStack
      ? {
          '--easymde-content-font-family': previewFontStack
        }
      : {})
  } as CSSProperties;
  useEffect(() => {
    rootActiveRef.current = true;
    return () => {
      rootActiveRef.current = false;
      const operation = contextMenuOperationRef.current;
      operation?.controller.abort();
      operation?.cleanup();
      visualPreviewWindowUnlockRef.current = null;
      codeThemePreparationRef.current?.controller.abort();
      codeThemePreparationRef.current?.prepared?.cancel();
      codeThemePreparationRef.current = null;
      releasePendingContextResources();
      props.appearancePort.cancelPendingApply();
    };
  }, [props.appearancePort, releasePendingContextResources]);

  useEffect(
    () => () => {
      props.mediaPickerFrame?.cancel?.();
    },
    [props.mediaPickerFrame]
  );

  useEffect(() => () => wechatSession.dispose(), [wechatSession]);
  useEffect(
    () => () => cancelWechatBackgroundPreparation(),
    [
      cancelWechatBackgroundPreparation,
      props.wechatClipboard,
      props.wechatExport.enabled
    ]
  );

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    return props.sessionPort.subscribeBeforeAutosave(() => {
      if (codeThemePreparationRef.current) return 'blocked';
      if (visualPreviewEditingRef.current) {
        const runtime = visualEditorRuntimeRef.current;
        if (!runtime) throw new Error('visual-editor-runtime-unavailable');
        if (!runtime.prepareToolbarFallback()) return 'blocked';
      }
      documentSession.document.flush();
      return 'continue';
    });
  }, [documentSession, props.sessionPort]);

  useEffect(() => {
    if (!documentSession || !remoteImageImportCoordinator) {
      return;
    }
    return props.nativeSubmissionPort.subscribeBeforeSubmit(() => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) return 'blocked';
      if (codeThemePreparationRef.current) {
        props.onFailure('editor-appearance-pending');
        return 'blocked';
      }
      if (visualPreviewEditingRef.current && !prepareSourceMutation()) {
        return 'blocked';
      }
      documentSession.document.flush();
      return 'continue';
    });
  }, [
    documentSession,
    prepareSourceMutation,
    props.nativeSubmissionPort,
    props.onFailure,
    protectedOperationError
  ]);

  useLayoutEffect(() => {
    if (
      !documentSession
      || !props.isNewPost
      || 'preview' === props.settings.general.editingMode
    )
      return;
    documentSession.document.focus();
  }, [documentSession, props.settings.general.editingMode, props.isNewPost]);

  useEffect(() => {
    if (!documentSession || !remoteImageImportCoordinator) {
      return;
    }
    const canonicalDocument = documentPort(
      documentSession,
      () => rootActiveRef.current
    );
    if (visualPreviewEditing && !visualEditorSurface) {
      return;
    }
    const visualRuntime = visualPreviewEditing
      ? visualEditorRuntimeRef.current
      : null;
    return createImageUploadSession({
      allowedExtensions: props.imageUpload.allowedExtensions,
      allowedMimeTypes: props.imageUpload.allowedMimeTypes,
      autoUploadPastedImages: props.imageUpload.autoUploadPastedImages,
      document: visualRuntime
        ? {
            applyTextChange: (change) => {
              canonicalDocument.applyTextChange(change);
              leaveVisualPreview();
            },
            focus: canonicalDocument.focus,
            getSnapshot: () => {
              if (!visualRuntime.prepareMediaSelection()) {
                throw new Error('visual-editor-selection-map-failed');
              }
              return canonicalDocument.getSnapshot();
            }
          }
        : canonicalDocument,
      enabled: props.imageUpload.enabled,
      insertion: props.imageUpload.insertion,
      maxBytes: props.imageUpload.maxBytes,
      nextOperationId: nextImageUploadOperationId,
      onDiagnostic: props.onFailure,
      onStatus: setImageUploadStatus,
      postId: props.imageUpload.postId,
      remoteImageImportCoordinator,
      remoteImageUploadMode: props.imageUpload.remoteImageUploadMode,
      surface: visualRuntime ? 'visual' : 'source',
      strings: props.imageUpload.strings,
      target: visualEditorSurface ?? documentSession.document.getInputElement(),
      upload: imageUploadPort
    });
  }, [
    documentSession,
    previewRuntimeGeneration,
    props.imageUpload,
    imageUploadPort,
    leaveVisualPreview,
    nextImageUploadOperationId,
    props.onFailure,
    setImageUploadStatus,
    remoteImageImportCoordinator,
    visualEditorSurface,
    visualPreviewEditing
  ]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    const session = createLocalDraftSession({
      delayMs: Number(props.settings.general.autoSaveInterval) * 1000,
      document: {
        applyTextChange: documentSession.document.applyTextChange,
        focus: documentSession.document.focus,
        getValue: documentSession.document.getValue
      },
      enabled: localDraftsEnabled,
      onCandidate: setDraftCandidate,
      onDiagnostic: props.onFailure,
      onUnreadable: setDraftUnreadable,
      onStatus: setLocalDraftStatus,
      savedFingerprint: props.localDrafts.savedFingerprint,
      storage: props.localDraftStorage,
      strings: props.localDrafts.strings
    });
    localDraftSessionRef.current = session;
    const schedule = () => session.schedule();
    const unsubscribeDocument = documentSession.document.subscribe(schedule);
    session.reconcileSavedDraft();

    return () => {
      unsubscribeDocument();
      if (localDraftSessionRef.current === session) {
        localDraftSessionRef.current = null;
      }
      session.dispose();
    };
  }, [
    documentSession,
    props.localDraftStorage,
    props.localDrafts,
    props.settings.general.autoSaveInterval,
    localDraftsEnabled,
    props.onFailure,
    setLocalDraftStatus
  ]);
  useEffect(() => {
    if (!documentSession) return undefined;
    const update = () =>
      setCursorPosition(documentSession.document.getCursorPosition());
    update();
    const unsubscribeDocument = documentSession.document.subscribe(() => {
      update();
      const preparation = codeThemePreparationRef.current;
      if (
        'visual-unlock' === preparation?.owner
        && preparation.sourceMarkdown !== documentSession.document.getValue()
      ) {
        cancelVisualUnlockPreparation();
      }
    });
    const unsubscribeSelection =
      documentSession.document.subscribeSelection(update);
    return () => {
      unsubscribeDocument();
      unsubscribeSelection();
    };
  }, [cancelVisualUnlockPreparation, documentSession]);

  useEffect(() => {
    const previewRuntime = previewRuntimeRef.current;
    if (!documentSession || !previewRuntime || !scrollSyncEnabled) {
      return;
    }
    const binding = props.scrollSyncPort.prepareBinding({
      preview: previewScrollCanvas(previewRuntime.surface),
      source: documentSession.document.getScrollElement()
    });
    binding.activate();
    return () => binding.dispose();
  }, [
    documentSession,
    immersive,
    immersiveMode,
    previewRuntimeGeneration,
    props.scrollSyncPort,
    scrollSyncEnabled
  ]);

  useLayoutEffect(() => {
    const runtime = previewRuntimeRef.current;
    if (!runtime || !documentSession || visualPreviewEditing) return;
    // CodeMirror is the canonical document source. The hidden WordPress
    // field remains synchronized for submission, but its bridge input event
    // must not be a second Preview trigger: a late bridge event can race an
    // immediate theme transition and submit two different Markdown values.
    const unsubscribeDocument = documentSession.document.subscribe(() => {
      schedulePreview(false);
    });
    if (scheduledPreviewRuntimeRef.current !== runtime) {
      scheduledPreviewRuntimeRef.current = runtime;
      schedulePreview(true);
    }

    return unsubscribeDocument;
  }, [
    documentSession,
    previewRuntimeGeneration,
    schedulePreview,
    visualPreviewEditing
  ]);

  useLayoutEffect(() => {
    if (
      0 === previewRefreshRevision
      || visualPreviewEditing
      || !previewRuntimeRef.current
    ) {
      return;
    }
    setPreviewRefreshRevision(0);
    schedulePreview(true);
  }, [
    previewRefreshRevision,
    previewRuntimeGeneration,
    schedulePreview,
    visualPreviewEditing
  ]);

  const contextMenuBlockIndexCache = contextMenuBlockIndexCacheRef.current;
  if (!contextMenuBlockIndexCache) {
    throw new Error('editor-context-menu-block-index-cache-unavailable');
  }
  const requestContextMenuBlockIndex = useCallback(
    (
      owner: object,
      generation: number,
      revision: number,
      source: string
    ): EditorMarkdownBlockIndex | null => {
      const cached = contextMenuBlockIndexCache.peek({
        generation,
        owner,
        revision
      });
      if (cached?.source === source) {
        contextMenuBlockIndexFailureRef.current = null;
        return cached;
      }
      if (cached && cached.source !== source)
        contextMenuBlockIndexCache.invalidate(owner);
      const port = props.editorBlockIndexPort;
      const session = documentSession;
      if (!port || !session) return null;
      const scheduled = contextMenuBlockIndexCache.schedule({
        build: async (signal, { deadline }) => {
          const scheduler = createBrowserEditorImageHydrationScheduler(
            session.document.getInputElement().ownerDocument,
            signal
          );
          return editorBlockIndexFromData(
            source,
            await port.build({ generation, revision, source }, signal),
            revision,
            signal,
            deadline,
            scheduler
          );
        },
        generation,
        onFailure: (error) => {
          const code = editorBlockIndexFailureCode(error);
          contextMenuBlockIndexFailureRef.current = {
            code,
            generation,
            owner,
            revision,
            source
          };
          props.onFailure(code);
          notifyContextMenuReadiness();
        },
        owner,
        revision,
        timeoutMs: 10_000
      });
      if (scheduled) contextMenuBlockIndexFailureRef.current = null;
      return null;
    },
    [
      contextMenuBlockIndexCache,
      documentSession,
      notifyContextMenuReadiness,
      props.editorBlockIndexPort,
      props.onFailure
    ]
  );
  const subscribeContextMenuBlockIndex = useCallback(
    (listener: () => void): (() => void) =>
      contextMenuBlockIndexCache.subscribe(listener),
    [contextMenuBlockIndexCache]
  );
  useEffect(
    () => () => {
      contextMenuBlockIndexCache.dispose();
      releasePendingContextResources();
    },
    [contextMenuBlockIndexCache, releasePendingContextResources]
  );
  useEffect(() => {
    if (!documentSession) return undefined;
    return documentSession.document.subscribe(() => {
      contextMenuBlockIndexFailureRef.current = null;
      contextMenuBlockIndexCache.invalidate(documentSession);
      editorCodeContentQueryRef.current?.cancel();
      editorSourceLinkQueryRef.current?.cancel();
      const runtime = visualEditorRuntimeRef.current;
      if (runtime) contextMenuBlockIndexCache.invalidate(runtime);
    });
  }, [contextMenuBlockIndexCache, documentSession]);

  const contextMenuWorkspace =
    rootRef.current?.querySelector<HTMLElement>('.easymde-workspace') ?? null;
  const contextMenuSource = useMemo<EditorContextMenuSurface | null>(() => {
    if (!documentSession) return null;
    const element = documentSession.document.getInputElement();
    const boundaryElement = documentSession.document.getScrollElement();
    return {
      canUploadImage: (image) =>
        props.imageUpload.enabled
        && 'off' !== props.imageUpload.remoteImageUploadMode
        && /^https?:\/\//iu.test(image.destination),
      boundaryElement: contextMenuWorkspace ?? boundaryElement,
      element,
      getActionContext: (_target, snapshot, blockIndex) => {
        const linkBinding: EditorSourceLinkQueryBinding = {
          menuIdentity: documentSession,
          ...(undefined === snapshot.revision
            ? {}
            : { revision: snapshot.revision }),
          selection: snapshot.selection,
          source: snapshot.value
        };
        const linkState = editorSourceLinkQuery && undefined !== blockIndex
          ? editorSourceLinkQuery.ensure({ binding: linkBinding, blockIndex })
          : { status: 'none' as const };
        const linkContext = editorSourceLinkActionContext(
          linkState,
          Boolean(props.editorLinkPort)
        );
        const codeBinding: EditorCodeContentQueryBinding = {
          generation: 0,
          menuIdentity: documentSession,
          ...(undefined === snapshot.revision
            ? {}
            : { revision: snapshot.revision }),
          selection: snapshot.selection,
          source: snapshot.value,
          surface: 'source'
        };
        const codeContext = editorCodeContentActionContext(
          editorCodeContentQuery.ensure({
            binding: codeBinding,
            ...(undefined === blockIndex ? {} : { blockIndex })
          }),
          snapshot.value,
          snapshot.selection
        );
        let imageContext: EditorContextMenuActionContext['image'] | null = null;
        const prepared = preparedImageTargetIndex(
          snapshot.value,
          snapshot.revision,
          blockIndex,
          snapshot.selection
        );
        const imageRuntime = previewRuntimeRef.current;
        if (prepared) releasePendingGeneratedContentPin();
        const pendingImage = pendingImageTargetPinRef.current;
        const reusablePendingImage =
          pendingImage
          && imageRuntime
          && pendingImage.runtime === imageRuntime
          && pendingImage.revision === snapshot.revision
          && pendingImage.source === snapshot.value
          && sameGeneratedContentSelection(
            pendingImage.selection,
            snapshot.selection
          )
          && prepared
          && pendingImage.match.start === prepared.image.start
          && pendingImage.match.end === prepared.image.end
          && pendingImage.pin.isCurrent()
            ? pendingImage
            : null;
        if (pendingImage && !reusablePendingImage)
          releasePendingImageTargetPin();
        if (prepared) {
          imageContext = imageActionContext(
            props.editorImagePixelsPort,
            null,
            prepared.image
          );
          if (imageRuntime?.surface.isConnected) {
            let resource = reusablePendingImage;
            let pin = resource?.pin ?? null;
            try {
              const existingLease = resource?.context?.lease;
              if (
                resource
                && existingLease
                && typeof existingLease.release === 'function'
                && pin?.isCurrent()
                && existingLease.isCurrent()
              ) {
                const currentLease = existingLease as PreviewImageTargetLease;
                imageContext = imageActionContext(
                  props.editorImagePixelsPort,
                  currentLease,
                  prepared.image
                );
                resource.context = imageContext;
              } else {
                if (resource?.context) resource.context = null;
                if (!pin) {
                  pin = imageRuntime.prepareImageTargetBySelection({
                    index: prepared.index,
                    selection: {
                      end: prepared.image.end,
                      start: prepared.image.start
                    }
                  });
                  if (pin) {
                    resource = {
                      context: null,
                      match: prepared.image,
                      pin,
                      revision: prepared.index.revision,
                      runtime: imageRuntime,
                      selection: {
                        end: snapshot.selection.end,
                        start: snapshot.selection.start
                      },
                      source: snapshot.value
                    };
                    pendingImageTargetPinRef.current = resource;
                  }
                }
                const mounted = pin?.getLease() ?? null;
                if (pin && resource && mounted) {
                  if (
                    mounted.target.original.start !== prepared.image.start
                    || mounted.target.original.end !== prepared.image.end
                  ) {
                    pin.release();
                    pendingImageTargetPinRef.current = null;
                  } else {
                    const lease: PreviewImageTargetLease = {
                      ...mounted,
                      release: () => {
                        mounted.release();
                        pin?.release();
                        if (pendingImageTargetPinRef.current?.pin === pin) {
                          pendingImageTargetPinRef.current = null;
                        }
                      }
                    };
                    imageContext = imageActionContext(
                      props.editorImagePixelsPort,
                      lease,
                      prepared.image
                    );
                    resource.context = imageContext;
                  }
                } else if (pin?.isCurrent()) {
                  imageContext = imageActionContext(
                    props.editorImagePixelsPort,
                    null,
                    prepared.image
                  );
                }
              }
            } catch (error) {
              if (!isPreviewSelectionUnavailable(error)) throw error;
            }
          }
        }
        let generatedContext: EditorContextMenuGeneratedContext | null = null;
        const runtime = previewRuntimeRef.current;
        const mode = immersiveRef.current
          ? ('immersive' as const)
          : ('ordinary' as const);
        const generatedReadinessKey =
          runtime && undefined !== snapshot.revision
            ? {
                mode,
                revision: snapshot.revision,
                runtime,
                selection: snapshot.selection,
                source: snapshot.value
              }
            : null;
        const generatedReadinessFailure =
          generatedContentReadinessFailureRef.current;
        const generatedReadinessUnavailable = Boolean(
          generatedReadinessKey
            && generatedReadinessFailure
            && sameGeneratedContentReadinessKey(
              generatedReadinessFailure.key,
              generatedReadinessKey
            )
        );
        if (generatedReadinessFailure && !generatedReadinessUnavailable) {
          generatedContentReadinessFailureRef.current = null;
        }
        const pending = pendingGeneratedContentPinRef.current;
        const reusablePending =
          pending
          && runtime
          && pending.runtime === runtime
          && pending.revision === snapshot.revision
          && pending.source === snapshot.value
          && pending.mode === mode
          && sameGeneratedContentSelection(
            pending.selection,
            snapshot.selection
          )
          && pending.pin.isCurrent()
            ? pending
            : null;
        if (pending && !reusablePending) releasePendingGeneratedContentPin();
        if (
          !imageContext
          && runtime
          && props.generatedContentExportSession
          && blockIndex
          && undefined !== snapshot.revision
          && !generatedReadinessUnavailable
        ) {
          let resource = reusablePending;
          let pin = resource?.pin ?? null;
          if (resource?.context && pin?.isCurrent()) {
            generatedContext = resource.context;
          } else {
            if (pin && !pin.isCurrent()) {
              releasePendingGeneratedContentPin();
              resource = null;
              pin = null;
            }
            if (!pin) {
              try {
                pin = runtime.prepareGeneratedContentTargetForSelection({
                  index: {
                    blocks: blockIndex.blocks,
                    length: blockIndex.length,
                    mathSpans: blockIndex.mathSpans,
                    revision: snapshot.revision,
                    source: blockIndex.source
                  },
                  selection: snapshot.selection
                });
              } catch (error) {
                // A caret can legitimately land on a source line that has no
                // editable Preview block (for example after the final
                // rendered block). Generated-content actions are optional
                // context; keep the generic menu available and let the model
                // omit only the unsafe generated actions.
                if (!isPreviewSelectionUnavailable(error)) throw error;
                pin = null;
              }
              if (pin) {
                resource = {
                  context: null,
                  pin,
                  mode,
                  revision: snapshot.revision,
                  runtime,
                  selection: {
                    end: snapshot.selection.end,
                    start: snapshot.selection.start
                  },
                  source: snapshot.value,
                  readinessCancel: null
                };
                pendingGeneratedContentPinRef.current = resource;
                scheduleGeneratedContentReadiness(resource);
              }
            }
            const generatedLease = pin?.getLease() ?? null;
            if (pin && generatedLease && resource) {
              if (!editorContextSelectionFitsRange(
                snapshot.selection,
                generatedLease.target.original.fullRange
              )) {
                generatedLease.release();
                resource.readinessCancel?.();
                resource.readinessCancel = null;
                pin.release();
                if (pendingGeneratedContentPinRef.current?.pin === pin) {
                  pendingGeneratedContentPinRef.current = null;
                }
              } else {
                resource.readinessCancel?.();
                resource.readinessCancel = null;
              if (
                generatedContentReadinessFailureRef.current
                && generatedReadinessKey
                && sameGeneratedContentReadinessKey(
                  generatedContentReadinessFailureRef.current.key,
                  generatedReadinessKey
                )
              ) {
                generatedContentReadinessFailureRef.current = null;
              }
              const lease = {
                ...generatedLease,
                release: () => {
                  generatedLease.release();
                  resource?.readinessCancel?.();
                  if (resource) {
                    resource.readinessCancel = null;
                  }
                  pin?.release();
                  if (pendingGeneratedContentPinRef.current?.pin === pin) {
                    pendingGeneratedContentPinRef.current = null;
                  }
                }
              };
              const kind = generatedLease.target.kind;
              const identity = () => {
                const current = runtime.getGeneratedPreviewIdentity();
                return current
                  ? {
                      acceptedPreview: {
                        revision: current.revision,
                        signature: current.signature
                      },
                      mode: immersiveRef.current
                        ? ('immersive' as const)
                        : ('ordinary' as const),
                      sourceRevision: current.sourceRevision
                    }
                  : null;
              };
              generatedContext = {
                canCopyImage: supportsEditorPngClipboard(
                  props.editorClipboardPort
                ),
                canCopyMathMl:
                  'math' === kind
                  && generatedMathMlAvailable(generatedLease.root),
                canSaveImage: true,
                canUseSource: Boolean(lease.isCurrent?.()),
                code: {
                  canCopyBlock: Boolean(lease.isCurrent?.()),
                  canIndentBlock: codeContext?.canIndentBlock === true,
                  canIndentSelection: codeContext?.canIndentSelection === true
                },
                filename: `easymde-${kind}-${generatedLease.target.ordinal + 1}.png`,
                identity,
                kind,
                lease,
                mode,
                validateLease: (candidate, current) =>
                  candidate === lease
                  && lease.isCurrent?.() === true
                  && current.mode === mode
              };
              resource.context = generatedContext;
              }
            } else if (pin && !pin.isCurrent()) {
              releasePendingGeneratedContentPin();
            }
          }
        }
        if (!linkContext && !imageContext && !generatedContext && !codeContext) {
          return null;
        }
        return {
          ...(codeContext ? { code: codeContext } : {}),
          ...(generatedContext ? { generated: generatedContext } : {}),
          ...(linkContext ? { link: linkContext } : {}),
          ...(imageContext ? { image: imageContext } : {})
        };
      },
      getContextReadiness: (_target, snapshot, blockIndex, actionContext) => {
        if (props.editorBlockIndexPort) {
          if (undefined === snapshot.revision) {
            return {
              code: 'editor-context-menu-revision-unavailable',
              status: 'unavailable'
            };
          }
          const failure = contextMenuBlockIndexFailureRef.current;
          if (
            failure
            && failure.owner === documentSession
            && failure.generation === 0
            && failure.revision === snapshot.revision
            && failure.source === snapshot.value
          ) {
            return { code: failure.code, status: 'unavailable' };
          }
          if (!blockIndex) return { status: 'pending' };
        }
        const codeReadiness = editorCodeContentQuery.readiness({
          generation: 0,
          menuIdentity: documentSession,
          ...(undefined === snapshot.revision
            ? {}
            : { revision: snapshot.revision }),
          selection: snapshot.selection,
          source: snapshot.value,
          surface: 'source'
        });
        const contextBlock = findMarkdownBlock(
          snapshot.value,
          snapshot.selection.start,
          blockIndex ?? undefined
        );
        const selectionFitsCodeBlock = Boolean(
          contextBlock
          && 'code' === contextBlock.kind
          && editorContextSelectionFitsRange(snapshot.selection, {
            from: contextBlock.start,
            to: contextBlock.end
          })
        );
        if (
          editorCodeContentReadinessBlocksMenu(codeReadiness)
          && !selectionFitsCodeBlock
        ) return codeReadiness;
        if (editorSourceLinkQuery && undefined !== blockIndex) {
          const linkReadiness = editorSourceLinkQuery.readiness({
            menuIdentity: documentSession,
            ...(undefined === snapshot.revision
              ? {}
              : { revision: snapshot.revision }),
            selection: snapshot.selection,
            source: snapshot.value
          });
          if ('pending' === linkReadiness.status) return linkReadiness;
          if ('unavailable' === linkReadiness.status) return linkReadiness;
        }
        const runtime = previewRuntimeRef.current;
        const mode = immersiveRef.current
          ? ('immersive' as const)
          : ('ordinary' as const);
        const generatedReadinessFailure =
          generatedContentReadinessFailureRef.current;
        if (
          props.generatedContentExportSession
          && runtime
          && undefined !== snapshot.revision
          && generatedReadinessFailure
          && sameGeneratedContentReadinessKey(generatedReadinessFailure.key, {
            mode,
            revision: snapshot.revision,
            runtime,
            selection: snapshot.selection,
            source: snapshot.value
          })
        ) {
          return {
            code: generatedReadinessFailure.code,
            status: 'unavailable'
          };
        }
        const pendingGenerated = pendingGeneratedContentPinRef.current;
        if (
          props.generatedContentExportSession
          && runtime
          && pendingGenerated
          && !actionContext?.generated
          && pendingGenerated.runtime === runtime
          && pendingGenerated.revision === snapshot.revision
          && pendingGenerated.source === snapshot.value
          && pendingGenerated.mode === mode
          && sameGeneratedContentSelection(
            pendingGenerated.selection,
            snapshot.selection
          )
          && pendingGenerated.pin.isCurrent()
        ) {
          return { status: 'pending' };
        }
        return { status: 'ready' };
      },
      ...(props.editorBlockIndexPort
        ? {
            getBlockIndex: ({ value }: EditorContextMenuSurfaceSnapshot) => {
              const revision = documentSession.document.getRevision?.();
              return undefined === revision
                ? null
                : requestContextMenuBlockIndex(
                    documentSession,
                    0,
                    revision,
                    value
                  );
            },
            subscribeBlockIndex: subscribeContextMenuBlockIndex
          }
        : {}),
      getSnapshot: () => {
        const revision = documentSession.document.getRevision?.();
        return {
          ...(undefined === revision ? {} : { revision }),
          selection: documentSession.document.getSelection(),
          value: documentSession.document.getValue()
        };
      },
      identity: documentSession,
      isEditable: documentSession.document.isEditable,
      kind: 'source',
      releasePending: releasePendingContextResources,
      restoreFocus: documentSession.document.focus,
      subscribeReadiness: subscribeContextMenuReadiness,
      subscribeSnapshot: documentSession.document.subscribe,
      subscribeSelection: documentSession.document.subscribeSelection
    };
  }, [
    contextMenuBlockIndexCache,
    contextMenuWorkspace,
    documentSession,
    editorCodeContentQuery,
    editorSourceLinkQuery,
    previewRuntimeGeneration,
    props.editorClipboardPort,
    props.editorBlockIndexPort,
    props.editorImagePixelsPort,
    props.editorLinkPort,
    props.generatedContentExportSession,
    props.imageUpload,
    requestContextMenuBlockIndex,
    scheduleGeneratedContentReadiness,
    subscribeContextMenuBlockIndex,
    subscribeContextMenuReadiness,
    releasePendingContextResources
  ]);
  const contextMenuVisual = useMemo<EditorContextMenuSurface | null>(() => {
    if (!documentSession || !visualPreviewEditing || !visualEditorSurface)
      return null;
    const runtime = visualEditorRuntimeRef.current;
    if (!runtime) return null;
    const previewSurface = previewRuntimeRef.current?.surface;
    const boundaryElement =
      contextMenuWorkspace
      ?? previewSurface?.parentElement
      ?? visualEditorSurface;
    return {
      canUploadImage: (image) =>
        props.imageUpload.enabled
        && 'off' !== props.imageUpload.remoteImageUploadMode
        && /^https?:\/\//iu.test(image.destination),
      boundaryElement,
      element: visualEditorSurface,
      getActionContext: (target, snapshot, blockIndex) => {
        const revision = documentSession.document.getRevision?.();
        const codeBinding: EditorCodeContentQueryBinding = {
          generation: visualEditorGeneration,
          menuIdentity: runtime,
          ...(undefined === revision ? {} : { revision }),
          selection: snapshot.selection,
          source: snapshot.value,
          surface: 'visual'
        };
        const codeContext = editorCodeContentActionContext(
          editorCodeContentQuery.ensure({
            binding: codeBinding,
            ...(undefined === blockIndex ? {} : { blockIndex })
          }),
          snapshot.value,
          snapshot.selection
        );
        const generatedTarget =
          generatedRootAtTarget(target, 'math')
          ?? generatedRootAtTarget(target, 'mermaid');
        const link = target?.closest('a');
        const linkContext =
          link instanceof HTMLAnchorElement
          && visualEditorSurface.contains(link)
          && link.href
            ? {
                canOpen: Boolean(props.editorLinkPort),
                href: link.href
              }
            : null;
        let imageContext: EditorContextMenuActionContext['image'] | null = null;
        const imageElement =
          target instanceof HTMLImageElement ? target : target?.closest('img');
        if (runtime && blockIndex) {
          const prepared = preparedImageTargetIndex(
            snapshot.value,
            revision,
            blockIndex,
            snapshot.selection
          );
          if (prepared) {
            imageContext = imageActionContext(
              props.editorImagePixelsPort,
              null,
              prepared.image
            );
            const pendingImage = pendingImageTargetPinRef.current;
            const reusablePendingImage =
              pendingImage
              && pendingImage.runtime === runtime
              && pendingImage.revision === revision
              && pendingImage.source === snapshot.value
              && sameGeneratedContentSelection(
                pendingImage.selection,
                snapshot.selection
              )
              && pendingImage.match.start === prepared.image.start
              && pendingImage.match.end === prepared.image.end
              && pendingImage.pin.isCurrent()
                ? pendingImage
                : null;
            if (pendingImage && !reusablePendingImage)
              releasePendingImageTargetPin();
            if (imageElement instanceof HTMLImageElement) {
              imageContext = imageActionContext(
                props.editorImagePixelsPort,
                leaseForVisualImage(
                  runtime,
                  prepared.index,
                  prepared.image,
                  imageElement
                ),
                prepared.image
              );
            } else {
              let resource = reusablePendingImage;
              let pin = resource?.pin ?? null;
              const existingLease = resource?.context?.lease;
              if (
                resource
                && existingLease
                && typeof existingLease.release === 'function'
                && pin?.isCurrent()
                && existingLease.isCurrent()
              ) {
                const currentLease = existingLease as PreviewImageTargetLease;
                imageContext = imageActionContext(
                  props.editorImagePixelsPort,
                  currentLease,
                  prepared.image
                );
                resource.context = imageContext;
              } else {
                if (resource?.context) resource.context = null;
                try {
                  if (!pin) {
                    pin = runtime.prepareImageTargetBySelection({
                      index: prepared.index,
                      selection: {
                        end: prepared.image.end,
                        start: prepared.image.start
                      }
                    });
                    if (pin) {
                      resource = {
                        context: null,
                        match: prepared.image,
                        pin,
                        revision: prepared.index.revision,
                        runtime,
                        selection: {
                          end: snapshot.selection.end,
                          start: snapshot.selection.start
                        },
                        source: snapshot.value
                      };
                      pendingImageTargetPinRef.current = resource;
                    }
                  }
                  const mounted = pin?.getLease() ?? null;
                  if (pin && resource && mounted) {
                    if (
                      mounted.target.original.start !== prepared.image.start
                      || mounted.target.original.end !== prepared.image.end
                    ) {
                      pin.release();
                      pendingImageTargetPinRef.current = null;
                    } else {
                      const lease: PreviewImageTargetLease = {
                        ...mounted,
                        release: () => {
                          mounted.release();
                          pin?.release();
                          if (pendingImageTargetPinRef.current?.pin === pin) {
                            pendingImageTargetPinRef.current = null;
                          }
                        }
                      };
                      imageContext = imageActionContext(
                        props.editorImagePixelsPort,
                        lease,
                        prepared.image
                      );
                      resource.context = imageContext;
                    }
                  } else if (pin?.isCurrent()) {
                    imageContext = imageActionContext(
                      props.editorImagePixelsPort,
                      null,
                      prepared.image
                    );
                  }
                } catch (error) {
                  if (!isPreviewSelectionUnavailable(error)) throw error;
                }
              }
            }
          }
        }
        const baseContext = (
          extra: Partial<EditorContextMenuActionContext> = {}
        ) => {
          if (!linkContext && !imageContext && !codeContext && !extra.generated) return null;
          return {
            ...extra,
            ...(codeContext ? { code: codeContext } : {}),
            ...(imageContext ? { image: imageContext } : {}),
            ...(linkContext ? { link: linkContext } : {})
          };
        };
        if (
          !runtime
          || !props.generatedContentExportSession
          || !generatedTarget
          || !blockIndex
          || undefined === revision
        ) {
          return baseContext();
        }
        const kind = generatedTarget.root.matches('.easymde-math')
          ? 'math'
          : generatedTarget.root.matches('.easymde-mermaid')
            ? 'mermaid'
            : null;
        if (!kind) return baseContext();
        const index = { ...blockIndex, revision };
        const lease = runtime.prepareGeneratedContentTarget({
          element: generatedTarget.root,
          index,
          kind,
          ordinal: generatedTarget.ordinal
        });
        if (!lease) return baseContext();
        if (!editorContextSelectionFitsRange(
          snapshot.selection,
          lease.target.original.fullRange
        )) {
          lease.release();
          return baseContext();
        }
        const identity = () => {
          const current = runtime.getGeneratedPreviewIdentity();
          return current
            ? {
                acceptedPreview: {
                  revision: current.revision,
                  signature: current.signature
                },
                mode: 'immersive' as const,
                sourceRevision: current.sourceRevision
              }
            : null;
        };
        const generated: EditorContextMenuGeneratedContext = {
          canCopyImage: supportsEditorPngClipboard(props.editorClipboardPort),
          canCopyMathMl:
            'math' === kind && generatedMathMlAvailable(generatedTarget.root),
          canSaveImage: true,
          canUseSource: Boolean(lease.isCurrent?.()),
          code: {
            canCopyBlock: Boolean(lease.isCurrent?.()),
            canIndentBlock: codeContext?.canIndentBlock === true,
            canIndentSelection: codeContext?.canIndentSelection === true
          },
          filename: `easymde-${kind}-${generatedTarget.ordinal + 1}.png`,
          identity,
          kind,
          lease,
          mode: 'immersive',
          validateLease: (candidate, current) =>
            candidate === lease
            && lease.isCurrent?.() === true
            && current.mode === 'immersive'
        };
        return baseContext({ generated });
      },
      getContextReadiness: (_target, snapshot, blockIndex) => {
        if (props.editorBlockIndexPort) {
          if (undefined === snapshot.revision) {
            return {
              code: 'editor-context-menu-revision-unavailable',
              status: 'unavailable'
            };
          }
          const failure = contextMenuBlockIndexFailureRef.current;
          if (
            failure
            && failure.owner === runtime
            && failure.generation === visualEditorGeneration
            && failure.revision === snapshot.revision
            && failure.source === snapshot.value
          ) {
            return { code: failure.code, status: 'unavailable' };
          }
          if (!blockIndex) return { status: 'pending' };
        }
        const revision = documentSession.document.getRevision?.();
        const codeReadiness = editorCodeContentQuery.readiness({
          generation: visualEditorGeneration,
          menuIdentity: runtime,
          ...(undefined === revision ? {} : { revision }),
          selection: snapshot.selection,
          source: snapshot.value,
          surface: 'visual'
        });
        const contextBlock = findMarkdownBlock(
          snapshot.value,
          snapshot.selection.start,
          blockIndex ?? undefined
        );
        const selectionFitsCodeBlock = Boolean(
          contextBlock
          && 'code' === contextBlock.kind
          && editorContextSelectionFitsRange(snapshot.selection, {
            from: contextBlock.start,
            to: contextBlock.end
          })
        );
        if (
          editorCodeContentReadinessBlocksMenu(codeReadiness)
          && !selectionFitsCodeBlock
        ) return codeReadiness;
        return { status: 'ready' };
      },
      ...(props.editorBlockIndexPort
        ? {
            getBlockIndex: ({ value }: EditorContextMenuSurfaceSnapshot) => {
              const revision = documentSession.document.getRevision?.();
              return undefined === revision
                ? null
                : requestContextMenuBlockIndex(
                    runtime,
                    visualEditorGeneration,
                    revision,
                    value
                  );
            },
            subscribeBlockIndex: subscribeContextMenuBlockIndex
          }
        : {}),
      getSnapshot: () => {
        const revision = documentSession.document.getRevision?.();
        return {
          ...(undefined === revision ? {} : { revision }),
          selection: documentSession.document.getSelection(),
          value: documentSession.document.getValue()
        };
      },
      identity: runtime,
      isEditable: runtime.isEditable,
      kind: 'visual',
      generation: visualEditorGeneration,
      prepare: (target, blockIndex) => {
        const generated =
          generatedRootAtTarget(target ?? null, 'math')
          ?? generatedRootAtTarget(target ?? null, 'mermaid');
        if (generated) {
          const revision = documentSession.document.getRevision?.();
          const identity = runtime.getGeneratedPreviewIdentity();
          if (!(
            undefined !== revision
              && identity?.sourceRevision === revision
              && runtime.surface.contains(generated.root)
          )) return false;
          const nativeSelection =
            runtime.surface.ownerDocument.defaultView?.getSelection();
          switch (nativeVisualSelectionRoute(runtime.surface, nativeSelection)) {
            case 'boundary':
            case 'invalid':
              return false;
            case 'inside':
              {
                if (
                  !nativeSelection?.anchorNode
                  || !nativeSelection.focusNode
                  || !generated.root.contains(nativeSelection.anchorNode)
                  || !generated.root.contains(nativeSelection.focusNode)
                ) {
                  return runtime.prepareContextMenuSelection?.(target)
                    ?? runtime.prepareMediaSelection();
                }
                const revision = documentSession.document.getRevision?.();
                if (!blockIndex || undefined === revision) {
                  return runtime.prepareContextMenuSelection?.(target)
                    ?? runtime.prepareMediaSelection();
                }
                const kind = generated.root.matches('.easymde-math')
                  ? 'math'
                  : 'mermaid';
                const lease = runtime.prepareGeneratedContentTarget?.({
                  element: generated.root,
                  index: {
                    blocks: blockIndex.blocks,
                    length: blockIndex.length,
                    mathSpans: blockIndex.mathSpans,
                    revision,
                    source: blockIndex.source
                  },
                  kind,
                  ordinal: generated.ordinal
                });
                const range = lease?.target.original.fullRange;
                if (lease && range) {
                  documentSession.document.applyTextChange({
                    selection: {
                      direction: 'none',
                      end: range.to,
                      start: range.from
                    },
                    value: documentSession.document.getValue()
                  });
                  lease.release();
                  return true;
                }
                lease?.release();
                return runtime.prepareContextMenuSelection?.(target)
                  ?? runtime.prepareMediaSelection();
              }
            case 'collapsed':
            case 'foreign':
            case 'none':
              return true;
          }
        }
        if (target?.closest('pre')) {
          return runtime.prepareContextMenuSelection?.(target)
            ?? runtime.prepareMediaSelection();
        }
        return runtime.prepareContextMenuSelection?.(target)
          ?? runtime.prepareMediaSelection();
      },
      restoreFocus: () => {
        if (runtime.surface.isConnected)
          runtime.surface.focus({ preventScroll: true });
      },
      subscribeReadiness: subscribeContextMenuReadiness,
      subscribeSnapshot: documentSession.document.subscribe,
      subscribeSelection: documentSession.document.subscribeSelection
    };
  }, [
    documentSession,
    contextMenuWorkspace,
    editorCodeContentQuery,
    previewRuntimeGeneration,
    props.editorClipboardPort,
    props.imageUpload,
    props.editorBlockIndexPort,
    props.editorImagePixelsPort,
    props.editorLinkPort,
    props.generatedContentExportSession,
    requestContextMenuBlockIndex,
    subscribeContextMenuBlockIndex,
    releasePendingGeneratedContentPin,
    releasePendingImageTargetPin,
    visualEditorGeneration,
    visualEditorSurface,
    visualPreviewEditing
  ]);

  const getVisualGeneratedPreviewIdentity = useCallback(
    () => previewRuntimeRef.current?.getGeneratedPreviewIdentity() ?? null,
    []
  );
  const prepareVisualGeneratedContentTarget = useCallback<
    PreviewSurfaceRuntime['prepareGeneratedContentTarget']
  >(
    (request) =>
      previewRuntimeRef.current?.prepareGeneratedContentTarget(request) ?? null,
    []
  );
  const prepareVisualImageTarget = useCallback<
    PreviewSurfaceRuntime['prepareImageTarget']
  >(
    (request) => previewRuntimeRef.current?.prepareImageTarget(request) ?? null,
    []
  );
  const prepareVisualImageTargetBySelection = useCallback<
    PreviewSurfaceRuntime['prepareImageTargetBySelection']
  >(
    (request) =>
      previewRuntimeRef.current?.prepareImageTargetBySelection(request) ?? null,
    []
  );

  return (
    <div
      ref={rootRef}
      className={`easymde-editor${immersive ? ' is-immersive' : ''}${immersive ? ` is-immersive-${immersiveMode}` : ''}`}
      data-easymde-editor-owner="react"
      data-easymde-session-status={sessionSnapshot.status}
    >
      {immersive && documentSession ? (
        <ImmersiveEditor
          documentSession={documentSession}
          environment={props.immersiveEnvironment}
          generalSettings={props.settings.general}
          immersivePreferencesPort={props.immersivePreferencesPort}
          i18n={props.immersiveI18n}
          initialPreferences={
            'loaded' === immersivePreferences.status
              ? immersivePreferences.preferences
              : null
          }
          visualPreviewEditable={
            visualPreviewEditing
            && Boolean(visualEditorRuntimeRef.current?.surface.isConnected)
          }
          focusVisualPreview={focusVisualPreview}
          mode={immersiveMode}
          direction={props.layout.direction}
          onCopyWechat={copyWechatFromImmersive}
          onExit={exitImmersive}
          onFailure={props.onFailure}
          onBeforeSourceMutation={prepareSourceMutation}
          onConfirmPublish={publish}
          onSelectFeaturedImage={selectFeaturedImage}
          readPublishSnapshot={props.nativePublishPort.read}
          onViewModeChange={changeImmersiveMode}
          revisionPort={revisionPort}
          restoreRevision={restoreRevision}
          styleControls={
            <Fragment>
              <AppearanceControls
                bootstrap={currentAppearance}
                messageAlertTimer={props.immersiveEnvironment}
                onFailure={() =>
                  props.onFailure('react-editor-appearance-failed')
                }
                onNotification={setAppearanceNotification}
                onNotificationDismiss={dismissAppearanceNotification}
                onReady={handleAppearanceReady}
                port={appearancePort}
                immersiveLabel={props.immersiveStrings.theme}
                immersiveTitle={props.immersiveStrings.themeSettings}
                variant="immersive"
              />
              <FontControls
                bootstrap={currentFonts}
                onFailure={() => props.onFailure('react-editor-fonts-failed')}
                onReady={handleFontControlsReady}
                port={fontControlsPort}
                variant="immersive"
              />
            </Fragment>
          }
          toolbar={
            <div
              className="easymde-toolbar"
              role="toolbar"
              aria-label={props.labels.toolbar}
            >
              <div className="easymde-toolbar-section easymde-toolbar-section-main">
                <ActiveToolbar
                  editorRoot={rootRef.current as HTMLElement}
                  {...(visualPreviewEditing
                    ? {
                        executeVisualCommand: (
                          command: ToolbarCommand,
                          plan?: () => ToolbarCommandPlan | null
                        ) => {
                          const runtime = visualEditorRuntimeRef.current;
                          if (!runtime) {
                            throw new Error(
                              'visual-editor-runtime-unavailable'
                            );
                          }
                          const result = runtime.executeCommand(command);
                          if ('handled' === result) return result;
                          if ('unsupported' !== result) {
                            reportVisualToolbarFailure();
                            return result;
                          }
                          if ('image' !== command.action) {
                            if (!runtime.prepareMediaSelection()) {
                              reportVisualToolbarFailure();
                              return 'blocked';
                            }
                            const planned = plan?.();
                            const revision =
                              documentSession.document.getRevision?.();
                            if (planned && undefined !== revision) {
                              const canonicalResult =
                                runtime.applyCanonicalChange({
                                  change: planned.change,
                                  expected: {
                                    revision,
                                    selection: planned.expected.selection,
                                    value: planned.expected.value
                                  }
                                });
                              if ('handled' === canonicalResult) {
                                return canonicalResult;
                              }
                              reportVisualToolbarFailure();
                              return canonicalResult;
                            }
                          }
                          const prepared =
                            'image' === command.action
                              ? runtime.prepareMediaSelection()
                              : runtime.prepareToolbarFallback();
                          if (!prepared) {
                            reportVisualToolbarFailure();
                            return 'blocked';
                          }
                          if ('image' === command.action) return 'unsupported';
                          leaveVisualPreview();
                          return 'unsupported';
                        }
                      }
                    : {})}
                  executeExternalCommand={executeRootExternalCommand}
                  isOwnedShortcutTarget={isOwnedShortcutTarget}
                  onExecuteCommandReady={handleToolbarExecutorReady}
                  platform={props.platform}
                  prepareToolbarShortcuts={props.prepareToolbarShortcuts}
                  onPopoverOpen={closeForToolbar}
                  onReady={handleToolbarReady}
                  session={documentSession}
                  toolbar={props.toolbar}
                  variant="immersive"
                />
              </div>
            </div>
          }
          strings={props.immersiveStrings}
        />
      ) : null}
      {!immersive ? (
        <div
          className="easymde-toolbar"
          role="toolbar"
          aria-label={props.labels.toolbar}
        >
          <div className="easymde-toolbar-section easymde-toolbar-section-main">
            {documentSession && rootRef.current ? (
              <Fragment>
                <ActiveToolbar
                  editorRoot={rootRef.current}
                  executeExternalCommand={executeRootExternalCommand}
                  isOwnedShortcutTarget={isOwnedShortcutTarget}
                  onExecuteCommandReady={handleToolbarExecutorReady}
                  platform={props.platform}
                  prepareToolbarShortcuts={props.prepareToolbarShortcuts}
                  onPopoverOpen={closeForToolbar}
                  onReady={handleToolbarReady}
                  session={documentSession}
                  toolbar={props.toolbar}
                />
              </Fragment>
            ) : null}
          </div>
          <div className="easymde-toolbar-section easymde-toolbar-section-secondary">
            {documentSession ? (
              <RootExportCommands
                executeCommand={(commandId) =>
                  executeRootExternalCommand(commandId, documentSession)
                }
                platform={props.platform}
                toolbar={props.toolbar}
              />
            ) : null}
            <button
              ref={immersiveToggleRef}
              type="button"
              className="easymde-toolbar-button easymde-toolbar-button-compact easymde-toolbar-immersive-toggle"
              aria-label={props.immersiveStrings.enter}
              aria-pressed="false"
              title={props.immersiveStrings.enter}
              onMouseDown={(event) => event.preventDefault()}
              onClick={enterImmersive}
            >
              <ImmersiveToggleIcon />
            </button>
            <OrdinaryEditorSettings
              appearance={currentAppearance}
              appearancePort={appearancePort}
              fonts={currentFonts}
              fontControlsPort={fontControlsPort}
              label={props.immersiveStrings.editorSettings}
              messageAlertTimer={props.immersiveEnvironment}
              onAppearanceReady={handleAppearanceReady}
              onFailure={props.onFailure}
              onNotification={setAppearanceNotification}
              onNotificationDismiss={dismissAppearanceNotification}
              onFontControlsReady={handleFontControlsReady}
              onOpen={() => {
                toolbarSessionRef.current?.closePopovers();
                props.appearancePort.closeOtherPopovers();
                props.fontControlsPort.closeOtherPopovers();
              }}
              onReady={handleOrdinarySettingsReady}
            />
          </div>
        </div>
      ) : null}
      {editorStatus ? (
        <div className="easymde-editor-message-alert-host">
          <EditorMessageAlert
            closeLabel={props.immersiveStrings.close}
            message={editorStatus.message}
            onDismiss={() => {
              setEditorStatusState((currentState) => ({
                focused: false,
                status:
                  currentState.status === editorStatus
                    ? null
                    : currentState.status
              }));
            }}
            onFocusChange={(focused) => {
              setEditorStatusState((currentState) =>
                currentState.focused === focused
                  ? currentState
                  : { ...currentState, focused }
              );
            }}
            type={editorStatus.type}
          />
        </div>
      ) : null}
      {!immersive && draftCandidate ? (
        <div className="easymde-draft-notice">
          <span>{props.localDrafts.strings.available}</span>
          <button
            type="button"
            className="button button-small"
            onClick={() => localDraftSessionRef.current?.restore()}
          >
            {props.localDrafts.strings.restore}
          </button>
          <button
            type="button"
            className="button button-small"
            onClick={() => localDraftSessionRef.current?.discard()}
          >
            {props.localDrafts.strings.discard}
          </button>
        </div>
      ) : null}
      {!immersive && draftUnreadable ? (
        <div className="easymde-draft-notice">
          <button
            type="button"
            className="button button-small"
            onClick={() => localDraftSessionRef.current?.discard()}
          >
            {props.localDrafts.strings.discard}
          </button>
        </div>
      ) : null}
      <EditorWorkspace
        direction={props.layout.direction}
        {...(!immersive ? { mode: props.settings.general.editingMode } : {})}
        onLayoutChange={scheduleCurrentWechatPreviewPreparation}
        statusBarMode={props.settings.general.statusBarMode}
        {...(!immersive && documentSession
          ? {
              ordinaryStatus: {
                document: documentSession.document,
                lastEdited: props.layout.status.lastEdited,
                locale: props.localDrafts.locale,
                wordCountTemplate: props.layout.status.wordCount
              }
            }
          : {})}
        splitResizable={immersive && 'split' === immersiveMode}
        splitResizeLabel={props.immersiveStrings.resizeSplit}
        source={
          <section
            className="easymde-pane easymde-pane-source"
            data-easymde-document-owner="react"
          >
            {immersive ? (
              <header className="easymde-pane-header">
                <span>{props.immersiveStrings.markdown.toUpperCase()}</span>
                <span
                  className="easymde-immersive-more-actions"
                  aria-hidden="true"
                  title={props.immersiveStrings.moreActions}
                >
                  <MoreHorizontal size={14} strokeWidth={2} />
                </span>
              </header>
            ) : null}
            <div className="easymde-source easymde-source-react">
              <EditorDocumentSource
                editorLabel={props.document.editorLabel}
                settings={props.settings}
                onReady={handleDocumentReady}
                submissionField={props.submissionField}
                titleField={props.titleField}
              />
            </div>
            {immersive ? (
              <footer className="easymde-immersive-statusbar">
                <span>
                  {`${props.immersiveStrings.line} ${cursorPosition.line}, ${props.immersiveStrings.column} ${cursorPosition.column}`}
                </span>
                <span>
                  {props.immersiveStrings.markdown}
                  {localDraftsEnabled ? (
                    <span className="easymde-immersive-autosave-state">
                      <span aria-hidden="true" />
                      {props.immersiveStrings.autoSaveEnabled}
                    </span>
                  ) : null}
                </span>
              </footer>
            ) : null}
          </section>
        }
        preview={
          <ImmersivePreviewSurface
            active={immersive && 'preview' === immersiveMode}
            canEdit={
              'ready' === previewSurfaceStatus
              && null !== visualPreviewSnapshot
              && visualPreviewHasEditableMap
              && null !== documentSession
            }
            changed={visualPreviewChanged}
            editable={visualPreviewEditing}
            hasSnapshot={null !== visualPreviewSnapshot}
            ordinaryLabel={immersive ? props.labels.preview : null}
            unlocking={visualPreviewUnlocking}
            onToggleEditable={() => {
              if (visualPreviewEditing) {
                void prepareSourceMutationWithPreview();
                return;
              }
              requestVisualPreviewUnlock();
            }}
            status={previewSurfaceStatus}
            statusMessages={{
              empty: props.preview.messages.empty,
              error: props.preview.messages.error,
              loading: props.preview.messages.loading
            }}
            strings={props.immersiveStrings}
          >
            <PreviewSurfaceOwner
              className={previewClassName}
              emptyMode={
                immersive && 'preview' === immersiveMode ? 'paper' : 'message'
              }
              enhancementPort={props.enhancementPort}
              initial={{
                codeTheme: props.appearance.state.codeTheme,
                features: props.preview.features,
                html: props.preview.html,
                signature: props.preview.signature
              }}
              initialRevision={0}
              messages={props.preview.messages}
              onDiagnostic={props.onFailure}
              onDispose={handlePreviewDispose}
              onImageReadinessChange={handlePreviewImageReadinessChange}
              onReady={handlePreviewReady}
              onSnapshotReady={handlePreviewSnapshotReady}
              onStatusChange={handlePreviewStatusChange}
              onWindowReady={handlePreviewWindowReady}
              port={previewPort}
              currentSourceSnapshot={() => {
                if (!documentSession) return null;
                const revision = documentSession.document.getRevision?.();
                return undefined === revision
                  ? null
                  : {
                      revision,
                      value: documentSession.document.getValue()
                    };
              }}
              scrollPort={props.scrollPort}
              sourceRevision={documentSession?.document.getRevision?.() ?? 0}
              style={previewStyle}
              {...(visualPreviewEditing
                ? {
                    contentEditable: true,
                    label: props.immersiveStrings.previewEditorLabel,
                    role: 'textbox',
                    spellCheck: true
                  }
                : {})}
              windowed={visualPreviewSurfaceWindowed}
            />
            {visualPreviewEditing
            && visualPreviewSnapshot
            && documentSession
            && previewRuntimeRef.current ? (
              visualPreviewWindowed && visualPreviewSnapshot.editMap ? (
                <WindowedImmersiveVisualEditor
                  documentSession={documentSession}
                  editMap={visualPreviewSnapshot.editMap}
                  imageUploadEnabled={props.imageUpload.enabled}
                  imagePasteUploadEnabled={
                    props.imageUpload.autoUploadPastedImages
                  }
                  onCanonicalDocumentChange={
                    handleVisualCanonicalDocumentChange
                  }
                  onDiagnostic={props.onFailure}
                  onDispose={handleVisualEditorDispose}
                  onFailure={handleVisualFailure}
                  onMarkdownChange={handleVisualMarkdownChange}
                  onPendingChange={handleVisualPendingChange}
                  onReady={handleVisualEditorReady}
                  onTransferFailure={handleVisualTransferFailure}
                  pending={visualPreviewPending}
                  previewSnapshot={visualPreviewSnapshot}
                  previewStatus={previewSurfaceStatus}
                  acceptedWindowSnapshotGeneration={
                    acceptedWindowSnapshotGeneration
                  }
                  getAcceptedWindowSnapshot={getAcceptedWindowSnapshot}
                  getGeneratedPreviewIdentity={
                    getVisualGeneratedPreviewIdentity
                  }
                  prepareGeneratedContentTarget={
                    prepareVisualGeneratedContentTarget
                  }
                  prepareImageTarget={prepareVisualImageTarget}
                  prepareImageTargetBySelection={
                    prepareVisualImageTargetBySelection
                  }
                  prepareWindowBlockAdoption={prepareVisualWindowBlockAdoption}
                  requestPreview={handleVisualPreviewRequest}
                  requestPreviewAtDocumentEnd={handleVisualPreviewAtDocumentEnd}
                  surface={previewRuntimeRef.current.surface}
                />
              ) : (
                <ImmersiveVisualEditor
                  documentSession={documentSession}
                  imageUploadEnabled={props.imageUpload.enabled}
                  imagePasteUploadEnabled={
                    props.imageUpload.autoUploadPastedImages
                  }
                  onCanonicalDocumentChange={
                    handleVisualCanonicalDocumentChange
                  }
                  onDiagnostic={props.onFailure}
                  onDispose={handleVisualEditorDispose}
                  onFailure={handleVisualFailure}
                  onMarkdownChange={handleVisualMarkdownChange}
                  onPendingChange={handleVisualPendingChange}
                  onReady={handleVisualEditorReady}
                  onTransferFailure={handleVisualTransferFailure}
                  pending={visualPreviewPending}
                  previewSnapshot={visualPreviewSnapshot}
                  previewStatus={previewSurfaceStatus}
                  getGeneratedPreviewIdentity={
                    getVisualGeneratedPreviewIdentity
                  }
                  prepareGeneratedContentTarget={
                    prepareVisualGeneratedContentTarget
                  }
                  prepareImageTarget={prepareVisualImageTarget}
                  prepareImageTargetBySelection={
                    prepareVisualImageTargetBySelection
                  }
                  requestPreview={handleVisualPreviewRequest}
                  surface={previewRuntimeRef.current.surface}
                />
              )
            ) : null}
          </ImmersivePreviewSurface>
        }
      />
      {props.contextMenuStrings && props.editorClipboardPort ? (
        <EditorContextMenuFeature
          clipboard={props.editorClipboardPort}
          canCopySimplified={Boolean(
            props.simplifiedFormattingParser
              && supportsEditorRichClipboard(props.editorClipboardPort)
          )}
          direction={props.layout.direction}
          imageShortcut={formatKeyboardShortcut(
            props.toolbar.shortcuts.image?.[props.platform] ?? ''
          )}
          labels={props.contextMenuStrings}
          onAction={handleContextMenuAction}
          onFailure={(code) =>
            reportContextMenuFailure(
              code,
              props.contextMenuStrings?.statusActionFailed
            )
          }
          onPortalOwnerChange={registerContextMenuPortalOwner}
          shortcut={formatKeyboardShortcut(
            props.toolbar.shortcuts.bold?.[props.platform] ?? ''
          )}
          source={contextMenuSource}
          visual={contextMenuVisual}
        />
      ) : null}
      {contextMenuTableRequest ? (
        <EditorTableDialog
          environment={props.immersiveEnvironment}
          strings={props.immersiveStrings}
          onClose={() => setContextMenuTableRequest(null)}
          onInsert={insertContextMenuTable}
        />
      ) : null}
      {mediaPickerDialog && props.mediaPickerFrame ? (
        <WordPressMediaPickerDialog
          closeLabel={props.immersiveStrings.close}
          frame={props.mediaPickerFrame}
          label={
            'featured' === mediaPickerDialog
              ? props.immersiveStrings.selectFeaturedImage
              : props.mediaPicker.insertMedia
          }
          onAttachError={handleMediaPickerAttachError}
          onCancel={closeMediaPickerDialog}
        />
      ) : null}
    </div>
  );
}
