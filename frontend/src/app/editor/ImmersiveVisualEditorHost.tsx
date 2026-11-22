import { createElement } from '@wordpress/element';

import type { ReferenceLabelCaseFoldProfile } from '../../contracts/ports/editor-block-index-port';
import type {
  ImmersiveVisualEditorRuntime,
  ImmersiveWindowAcceptedSnapshot
} from '../../contracts/visual-editor';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import { ImmersiveVisualEditor } from '../../features/immersive-editor/ui/ImmersiveVisualEditor';
import { WindowedImmersiveVisualEditor } from '../../features/immersive-editor/ui/WindowedImmersiveVisualEditor';
import type {
  PreviewSourceSelection,
  PreviewSurfaceRuntime,
  PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import type { EditorVisualPreviewSnapshot } from './editor-root-types';

export type ImmersiveVisualEditorHostProps = Readonly<{
  acceptedWindowSnapshotGeneration: number;
  documentSession: EditorDocumentSession;
  getAcceptedReferenceSource: (
    request: Parameters<PreviewSurfaceRuntime['getAcceptedReferenceSource']>[0]
  ) => ReturnType<PreviewSurfaceRuntime['getAcceptedReferenceSource']>;
  getAcceptedWindowRow: (
    request: Parameters<PreviewSurfaceRuntime['getAcceptedWindowRow']>[0]
  ) => ReturnType<PreviewSurfaceRuntime['getAcceptedWindowRow']>;
  getAcceptedWindowSnapshot: () => ImmersiveWindowAcceptedSnapshot | null;
  getGeneratedPreviewIdentity: () => ReturnType<
    PreviewSurfaceRuntime['getGeneratedPreviewIdentity']
  >;
  imagePasteUploadEnabled: boolean;
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
  prepareGeneratedContentTarget: PreviewSurfaceRuntime['prepareGeneratedContentTarget'];
  prepareImageTarget: PreviewSurfaceRuntime['prepareImageTarget'];
  prepareImageTargetBySelection: PreviewSurfaceRuntime['prepareImageTargetBySelection'];
  prepareWindowBlockAdoption: (node: HTMLElement) => (() => boolean) | null;
  previewSnapshot: EditorVisualPreviewSnapshot;
  previewStatus: PreviewSurfaceStatus;
  referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile;
  requestPreview: (
    markdown: string,
    options?: Readonly<{ immediate?: boolean }>
  ) => string;
  requestPreviewAtDocumentEnd: (
    markdown: string,
    sourceSelection?: PreviewSourceSelection,
    options?: Readonly<{ immediate?: boolean }>
  ) => Readonly<{
    onSelectionRestored: () => void;
    release: () => void;
    signature: string;
  }>;
  resumeCanonicalSelectionOnOwnerTransfer: boolean;
  resumeCanonicalSelectionToken: number;
  retainCompositionSurface: () => Readonly<{ release: () => void }>;
  revealAcceptedWindowRow: (
    request: Parameters<PreviewSurfaceRuntime['revealAcceptedWindowRow']>[0]
  ) => ReturnType<PreviewSurfaceRuntime['revealAcceptedWindowRow']>;
  surface: HTMLElement;
  windowed: boolean;
}>;

/**
 * Single pluggable host seam for the immersive visual editor surface.
 * Switches between the windowed (>160-block) and full visual editor owners
 * without leaking visual-owner selection into EditorRoot.
 */
export function ImmersiveVisualEditorHost({
  acceptedWindowSnapshotGeneration,
  documentSession,
  getAcceptedReferenceSource,
  getAcceptedWindowRow,
  getAcceptedWindowSnapshot,
  getGeneratedPreviewIdentity,
  imagePasteUploadEnabled,
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
  prepareGeneratedContentTarget,
  prepareImageTarget,
  prepareImageTargetBySelection,
  prepareWindowBlockAdoption,
  previewSnapshot,
  previewStatus,
  referenceLabelCaseFoldProfile,
  requestPreview,
  requestPreviewAtDocumentEnd,
  resumeCanonicalSelectionOnOwnerTransfer,
  resumeCanonicalSelectionToken,
  retainCompositionSurface,
  revealAcceptedWindowRow,
  surface,
  windowed
}: ImmersiveVisualEditorHostProps) {
  if (windowed && previewSnapshot.editMap) {
    return (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={referenceLabelCaseFoldProfile}
        documentSession={documentSession}
        resumeCanonicalSelectionToken={resumeCanonicalSelectionToken}
        resumeCanonicalSelectionOnOwnerTransfer={
          resumeCanonicalSelectionOnOwnerTransfer
        }
        editMap={previewSnapshot.editMap}
        imageUploadEnabled={imageUploadEnabled}
        imagePasteUploadEnabled={imagePasteUploadEnabled}
        onCanonicalDocumentChange={onCanonicalDocumentChange}
        onDiagnostic={onDiagnostic}
        onDispose={onDispose}
        onFailure={onFailure}
        onMarkdownChange={onMarkdownChange}
        onPendingChange={onPendingChange}
        onReady={onReady}
        onTransferFailure={onTransferFailure}
        pending={pending}
        previewSnapshot={previewSnapshot}
        previewStatus={previewStatus}
        acceptedWindowSnapshotGeneration={acceptedWindowSnapshotGeneration}
        getAcceptedWindowSnapshot={getAcceptedWindowSnapshot}
        getAcceptedWindowRow={getAcceptedWindowRow}
        getAcceptedReferenceSource={getAcceptedReferenceSource}
        revealAcceptedWindowRow={revealAcceptedWindowRow}
        getGeneratedPreviewIdentity={getGeneratedPreviewIdentity}
        prepareGeneratedContentTarget={prepareGeneratedContentTarget}
        prepareImageTarget={prepareImageTarget}
        prepareImageTargetBySelection={prepareImageTargetBySelection}
        prepareWindowBlockAdoption={prepareWindowBlockAdoption}
        retainCompositionSurface={retainCompositionSurface}
        requestPreview={requestPreview}
        requestPreviewAtDocumentEnd={requestPreviewAtDocumentEnd}
        surface={surface}
      />
    );
  }

  return (
    <ImmersiveVisualEditor
      referenceLabelCaseFoldProfile={referenceLabelCaseFoldProfile}
      documentSession={documentSession}
      resumeCanonicalSelectionToken={resumeCanonicalSelectionToken}
      resumeCanonicalSelectionOnOwnerTransfer={
        resumeCanonicalSelectionOnOwnerTransfer
      }
      imageUploadEnabled={imageUploadEnabled}
      imagePasteUploadEnabled={imagePasteUploadEnabled}
      onCanonicalDocumentChange={onCanonicalDocumentChange}
      onDiagnostic={onDiagnostic}
      onDispose={onDispose}
      onFailure={onFailure}
      onMarkdownChange={onMarkdownChange}
      onPendingChange={onPendingChange}
      onReady={onReady}
      onTransferFailure={onTransferFailure}
      pending={pending}
      previewSnapshot={previewSnapshot}
      previewStatus={previewStatus}
      getGeneratedPreviewIdentity={getGeneratedPreviewIdentity}
      prepareGeneratedContentTarget={prepareGeneratedContentTarget}
      prepareImageTarget={prepareImageTarget}
      prepareImageTargetBySelection={prepareImageTargetBySelection}
      retainCompositionSurface={retainCompositionSurface}
      requestPreview={requestPreview}
      surface={surface}
    />
  );
}
