import type { MutableRefObject } from 'react';

import type {
  AppearanceBootstrap,
  AppearanceState
} from '../../contracts/bootstrap/appearance-bootstrap';
import type { DocumentSourceBootstrap } from '../../contracts/bootstrap/document-source-bootstrap';
import type { EditorLayoutBootstrap } from '../../contracts/bootstrap/editor-layout-bootstrap';
import type {
  EditorContextMenuBootstrapStrings,
  EditorRootLocalDraftsBootstrap,
  EditorRootPreviewBootstrap,
  EditorRootSettingsBootstrap
} from '../../contracts/bootstrap/editor-root-bootstrap';
import type {
  FontControlsBootstrap,
  FontControlsState
} from '../../contracts/bootstrap/font-controls-bootstrap';
import type { ImageUploadBootstrap } from '../../contracts/bootstrap/image-upload-bootstrap';
import type { MediaPickerBootstrap } from '../../contracts/bootstrap/media-picker-bootstrap';
import type { ToolbarBootstrap } from '../../contracts/bootstrap/toolbar-bootstrap';
import type { WechatExportBootstrap } from '../../contracts/bootstrap/wechat-export-bootstrap';
import type { AppearancePort } from '../../contracts/ports/appearance-port';
import type {
  EditorMarkdownBlockIndexPort,
  EditorMarkdownImageIndexData,
  ReferenceLabelCaseFoldProfile
} from '../../contracts/ports/editor-block-index-port';
import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type { EditorImagePixelsPort } from '../../contracts/ports/editor-image-pixels-port';
import type { EditorSessionPort } from '../../contracts/ports/editor-session-port';
import type { FontControlsPort } from '../../contracts/ports/font-controls-port';
import type { ImageUploadPort } from '../../contracts/ports/image-upload-port';
import type { ImmersiveEnvironmentPort } from '../../contracts/ports/immersive-environment-port';
import type { ImmersivePreferencesPort } from '../../contracts/ports/immersive-preferences-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type { MediaPickerFramePort } from '../../contracts/ports/media-picker-port';
import type { NativePublishPort } from '../../contracts/ports/native-publish-port';
import type { NativeSubmissionPort } from '../../contracts/ports/native-submission-port';
import type {
  PreviewEditMap,
  PreviewRequestPort,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { RemoteImageImportPort } from '../../contracts/ports/remote-image-import-port';
import type { RevisionPort } from '../../contracts/ports/revision-port';
import type { ScrollSyncPort } from '../../contracts/ports/scroll-sync-port';
import type { ToolbarShortcutsPort } from '../../contracts/ports/toolbar-shortcuts-port';
import type { WechatClipboardPort } from '../../contracts/ports/wechat-clipboard-port';
import type { WechatVisualRasterizationPort } from '../../contracts/ports/wechat-visual-rasterization-port';
import type {
  ImmersiveVisualEditorRuntime,
  VisualCanonicalChangeRequest,
  VisualToolbarCommandResult
} from '../../contracts/visual-editor';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type {
  EditorContextMenuActionContext,
  EditorContextMenuGeneratedContext
} from '../../features/editor-context-menu/EditorContextMenuFeature';
import type { EditorContextSnapshot } from '../../features/editor-context-menu/editor-context-menu-rules';
import type { EditorMarkdownBlockIndex } from '../../features/editor-context-menu/editor-markdown-block-index';
import type { SimplifiedFormattingDomParser } from '../../features/editor-context-menu/editor-simplified-formatting';
import type { GeneratedContentExportSession } from '../../features/generated-content-export/generated-content-export-session';
import type { GeneratedImageTargetIndex } from '../../features/generated-content-export/generated-image-target';
import type { MarkdownImageScaleMatch } from '../../features/image-scale/image-scale-contract';
import type { ImmersiveEditor } from '../../features/immersive-editor/ui/ImmersiveEditor';
import type {
  PreparedCodeTheme,
  PreviewEnhancementPort
} from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../../features/live-preview/ports/preview-scroll-port';
import type {
  PreviewImageTargetPinLease,
  PreviewSurfaceRuntime
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import type { ToolbarPlatform } from '../../features/toolbar/ui/EditorToolbar';
import type { EditorMessageAlertType } from '../../shared/ui/EditorMessageAlert';

export type {
  ImmersiveVisualEditorRuntime,
  VisualCanonicalChangeRequest,
  VisualToolbarCommandResult
};

export type EditorRootProps = Readonly<{
  referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile;
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
  generatedContentExportSession?: GeneratedContentExportSession;
  simplifiedFormattingParser?: SimplifiedFormattingDomParser;
}>;

export type EditorStatus = Readonly<{
  id: string;
  message: string;
  owner: 'editor' | 'local-draft';
  type: EditorMessageAlertType;
}>;

export type EditorStatusState = Readonly<{
  focused: boolean;
  status: EditorStatus | null;
}>;

export type EditorSubmissionState = AppearanceState &
  FontControlsState &
  Readonly<{
    codeThemeExplicit: boolean;
  }>;

export type CodeThemePreparation = {
  controller: AbortController;
  generation: number;
  owner: 'appearance' | 'visual-unlock';
  prepared: PreparedCodeTheme | null;
  sourceMarkdown?: string;
};

export type VisualCanonicalChangeContext = Readonly<{
  revision?: number;
  selection: EditorContextSnapshot['selection'];
  surface: EditorContextSnapshot['surface'];
  value: string;
}>;

export type ContextMenuTableRequest = EditorContextSnapshot &
  Readonly<{
    insertionDirection: 'above' | 'below';
  }>;

export type ApplyVisualCanonicalChange = (
  captured: VisualCanonicalChangeContext,
  change: VisualCanonicalChangeRequest['change']
) => boolean;

export type NativeVisualSelectionRoute =
  | 'boundary'
  | 'collapsed'
  | 'foreign'
  | 'inside'
  | 'invalid'
  | 'none';

export type PendingGeneratedContentPin = {
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

export type GeneratedContentReadinessKey = Readonly<{
  mode: PendingGeneratedContentPin['mode'];
  revision: number;
  runtime: PreviewSurfaceRuntime;
  selection: Readonly<{ end: number; start: number }>;
  source: string;
}>;

export type GeneratedContentReadinessFailure = Readonly<{
  code: 'editor-context-menu-generated-content-unavailable';
  key: GeneratedContentReadinessKey;
}>;

export type ImageLeaseRuntime = Pick<
  PreviewSurfaceRuntime,
  'prepareImageTarget' | 'prepareImageTargetBySelection' | 'surface'
>;

export type PendingImageTargetPin = {
  context: EditorContextMenuActionContext['image'] | null;
  match: MarkdownImageScaleMatch;
  pin: PreviewImageTargetPinLease;
  revision: number;
  runtime: ImageLeaseRuntime;
  selection: Readonly<{ end: number; start: number }>;
  source: string;
};

export type EditorVisualPreviewSnapshot = Readonly<{
  editMap: PreviewEditMap | null;
  html: SafePreviewHtml;
  revision: number;
  signature: string;
}>;

export type EditorMarkdownBlockIndexWithImages = EditorMarkdownBlockIndex &
  EditorMarkdownImageIndexData;

export type EditorMarkdownBlockIndexWithPreparedImages =
  EditorMarkdownBlockIndexWithImages &
    Readonly<{
      preparedImageTargetIndex: GeneratedImageTargetIndex;
    }>;

export type ContextMenuBlockIndexFailure = Readonly<{
  code: string;
  generation: number;
  owner: object;
  revision: number;
  source: string;
}>;

export type LayoutScrollRestoreEntry = Readonly<{
  layout: string;
  restore: () => void;
}>;

export type SharedRef<T> = MutableRefObject<T>;
