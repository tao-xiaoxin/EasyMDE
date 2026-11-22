import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type { EditorImagePixelsPort } from '../../contracts/ports/editor-image-pixels-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type {
  EditorContextMenuActionContext,
  EditorContextMenuGeneratedContext,
  EditorContextMenuSurface,
  EditorContextMenuSurfaceSnapshot
} from '../../features/editor-context-menu/EditorContextMenuFeature';
import {
  type EditorCodeContentQueryBinding,
  type EditorCodeContentQuerySession,
  editorCodeContentReadinessBlocksMenu
} from '../../features/editor-context-menu/editor-code-content-query';
import { findMarkdownBlock } from '../../features/editor-context-menu/editor-context-menu-rules';
import { editorContextSelectionFitsRange } from '../../features/editor-context-menu/editor-context-menu-text-edit';
import type { EditorMarkdownBlockIndex } from '../../features/editor-context-menu/editor-markdown-block-index';
import type {
  EditorSourceLinkQueryBinding,
  EditorSourceLinkQuerySession
} from '../../features/editor-context-menu/editor-source-link-query';
import type {
  PreviewImageTargetLease,
  PreviewSurfaceRuntime
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import {
  editorCodeContentActionContext,
  editorSourceLinkActionContext,
  generatedMathMlAvailable,
  imageActionContext,
  isPreviewSelectionUnavailable,
  preparedImageTargetIndex,
  sameGeneratedContentReadinessKey,
  sameGeneratedContentSelection,
  supportsEditorPngClipboard
} from './editor-context-menu-helpers';
import type {
  ContextMenuBlockIndexFailure,
  EditorRootProps,
  GeneratedContentReadinessFailure,
  PendingGeneratedContentPin,
  PendingImageTargetPin,
  SharedRef
} from './editor-root-types';

export type CreateSourceContextMenuSurfaceDeps = Readonly<{
  contextMenuBlockIndexFailureRef: SharedRef<ContextMenuBlockIndexFailure | null>;
  contextMenuWorkspace: HTMLElement | null;
  documentSession: EditorDocumentSession;
  editorClipboardPort: EditorClipboardPort | undefined;
  editorCodeContentQuery: EditorCodeContentQuerySession;
  editorImagePixelsPort: EditorImagePixelsPort | undefined;
  editorSourceLinkQuery: EditorSourceLinkQuerySession | null;
  generatedContentReadinessFailureRef: SharedRef<GeneratedContentReadinessFailure | null>;
  hasBlockIndexPort: boolean;
  hasGeneratedContentExport: boolean;
  imageUpload: EditorRootProps['imageUpload'];
  immersiveRef: SharedRef<boolean>;
  pendingGeneratedContentPinRef: SharedRef<PendingGeneratedContentPin | null>;
  pendingImageTargetPinRef: SharedRef<PendingImageTargetPin | null>;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  releasePendingContextResources: (
    reason?: 'cancelled' | 'unavailable'
  ) => void;
  releasePendingGeneratedContentPin: (preserveFailure?: boolean) => void;
  releasePendingImageTargetPin: () => void;
  requestContextMenuBlockIndex: (
    owner: object,
    generation: number,
    revision: number,
    source: string
  ) => EditorMarkdownBlockIndex | null;
  scheduleGeneratedContentReadiness: (
    pending: PendingGeneratedContentPin
  ) => void;
  subscribeContextMenuBlockIndex: (listener: () => void) => () => void;
  subscribeContextMenuReadiness: (listener: () => void) => () => void;
}>;

export function createSourceContextMenuSurface(
  deps: CreateSourceContextMenuSurfaceDeps
): EditorContextMenuSurface {
  const {
    contextMenuBlockIndexFailureRef,
    contextMenuWorkspace,
    documentSession,
    editorClipboardPort,
    editorCodeContentQuery,
    editorImagePixelsPort,
    editorSourceLinkQuery,
    generatedContentReadinessFailureRef,
    hasBlockIndexPort,
    hasGeneratedContentExport,
    imageUpload,
    immersiveRef,
    pendingGeneratedContentPinRef,
    pendingImageTargetPinRef,
    previewRuntimeRef,
    releasePendingContextResources,
    releasePendingGeneratedContentPin,
    releasePendingImageTargetPin,
    requestContextMenuBlockIndex,
    scheduleGeneratedContentReadiness,
    subscribeContextMenuBlockIndex,
    subscribeContextMenuReadiness
  } = deps;

  const element = documentSession.document.getInputElement();
  const boundaryElement = documentSession.document.getScrollElement();

  return {
    canUploadImage: (image) =>
      imageUpload.enabled
      && 'off' !== imageUpload.remoteImageUploadMode
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
      const linkState =
        editorSourceLinkQuery && undefined !== blockIndex
          ? editorSourceLinkQuery.ensure({ binding: linkBinding, blockIndex })
          : { status: 'none' as const };
      const linkContext = editorSourceLinkActionContext(linkState);
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
      if (pendingImage && !reusablePendingImage) releasePendingImageTargetPin();
      if (prepared) {
        imageContext = imageActionContext(
          editorImagePixelsPort,
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
                editorImagePixelsPort,
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
                    editorImagePixelsPort,
                    lease,
                    prepared.image
                  );
                  resource.context = imageContext;
                }
              } else if (pin?.isCurrent()) {
                imageContext = imageActionContext(
                  editorImagePixelsPort,
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
        && sameGeneratedContentSelection(pending.selection, snapshot.selection)
        && pending.pin.isCurrent()
          ? pending
          : null;
      if (pending && !reusablePending) releasePendingGeneratedContentPin();
      if (
        !imageContext
        && runtime
        && hasGeneratedContentExport
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
            if (
              !editorContextSelectionFitsRange(
                snapshot.selection,
                generatedLease.target.original.fullRange
              )
            ) {
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
                canCopyImage: supportsEditorPngClipboard(editorClipboardPort),
                canCopyMathMl:
                  'math' === kind
                  && generatedMathMlAvailable(generatedLease.root),
                canUseSource: Boolean(lease.isCurrent?.()),
                code: {
                  canCopyBlock: Boolean(lease.isCurrent?.()),
                  canIndentBlock: codeContext?.canIndentBlock === true,
                  canIndentSelection: codeContext?.canIndentSelection === true
                },
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
      if (hasBlockIndexPort) {
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
      )
        return codeReadiness;
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
        hasGeneratedContentExport
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
        hasGeneratedContentExport
        && runtime
        && pendingGenerated
        // The demand's own generated context already owns this pending
        // resource, so it is not an inventory gap. The rule needs the
        // evaluated context to know that, and the structural pre-check
        // states no context at all (`undefined`).
        && undefined !== actionContext
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
    ...(hasBlockIndexPort
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
    // The source surface's snapshot *is* CodeMirror's canonical selection,
    // and CodeMirror moves that selection for the primary button only. A
    // pointer gesture therefore has to establish the pointed selection
    // before the demand snapshot is captured; a keyboard activation keeps
    // the user's current selection instead.
    preparePointerSelection: (position) =>
      documentSession.document.prepareContextMenuPointer(position),
    releasePending: releasePendingContextResources,
    restoreFocus: documentSession.document.focus,
    subscribeReadiness: subscribeContextMenuReadiness,
    subscribeSnapshot: documentSession.document.subscribe,
    subscribeSelection: documentSession.document.subscribeSelection
  };
}
