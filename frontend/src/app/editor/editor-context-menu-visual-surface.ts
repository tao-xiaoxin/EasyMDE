import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type { EditorImagePixelsPort } from '../../contracts/ports/editor-image-pixels-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type {
  EditorContextMenuActionContext,
  EditorContextMenuGeneratedContext,
  EditorContextMenuPreparedSelection,
  EditorContextMenuSurface,
  EditorContextMenuSurfaceSnapshot
} from '../../features/editor-context-menu/EditorContextMenuFeature';
import {
  type EditorCodeContentQueryBinding,
  type EditorCodeContentQuerySession,
  editorCodeContentReadinessBlocksMenu
} from '../../features/editor-context-menu/editor-code-content-query';
import { findMarkdownBlock } from '../../features/editor-context-menu/editor-context-menu-rules';
import {
  blockRangeWithTrailingTerminator,
  editorContextSelectionFitsRange
} from '../../features/editor-context-menu/editor-context-menu-text-edit';
import type { EditorMarkdownBlockIndex } from '../../features/editor-context-menu/editor-markdown-block-index';
import type {
  PreviewImageTargetLease,
  PreviewImageTargetPinLease,
  PreviewSurfaceRuntime
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import {
  editorCodeContentActionContext,
  generatedMathMlAvailable,
  generatedRootAtTarget,
  imageActionContext,
  isPreviewSelectionUnavailable,
  leaseForVisualImage,
  nativeVisualSelectionRoute,
  preparedImageTargetIndex,
  sameGeneratedContentSelection,
  supportsEditorPngClipboard,
  visualImageSlotIdentity
} from './editor-context-menu-helpers';
import type {
  ContextMenuBlockIndexFailure,
  EditorRootProps,
  ImmersiveVisualEditorRuntime,
  PendingImageTargetPin,
  SharedRef
} from './editor-root-types';

export type CreateVisualContextMenuSurfaceDeps = Readonly<{
  contextMenuBlockIndexFailureRef: SharedRef<ContextMenuBlockIndexFailure | null>;
  documentSession: EditorDocumentSession;
  editorClipboardPort: EditorClipboardPort | undefined;
  editorCodeContentQuery: EditorCodeContentQuerySession;
  editorImagePixelsPort: EditorImagePixelsPort | undefined;
  hasBlockIndexPort: boolean;
  hasGeneratedContentExport: boolean;
  imageUpload: EditorRootProps['imageUpload'];
  pendingImageTargetPinRef: SharedRef<PendingImageTargetPin | null>;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  releasePendingImageTargetPin: () => void;
  requestContextMenuBlockIndex: (
    owner: object,
    generation: number,
    revision: number,
    source: string
  ) => EditorMarkdownBlockIndex | null;
  runtime: ImmersiveVisualEditorRuntime;
  subscribeContextMenuBlockIndex: (listener: () => void) => () => void;
  subscribeContextMenuReadiness: (listener: () => void) => () => void;
  visualEditorGeneration: number;
  visualEditorSurface: HTMLElement;
}>;

export function createVisualContextMenuSurface(
  deps: CreateVisualContextMenuSurfaceDeps
): EditorContextMenuSurface {
  const {
    contextMenuBlockIndexFailureRef,
    documentSession,
    editorClipboardPort,
    editorCodeContentQuery,
    editorImagePixelsPort,
    hasBlockIndexPort,
    hasGeneratedContentExport,
    imageUpload,
    pendingImageTargetPinRef,
    previewRuntimeRef,
    releasePendingImageTargetPin,
    requestContextMenuBlockIndex,
    runtime,
    subscribeContextMenuBlockIndex,
    subscribeContextMenuReadiness,
    visualEditorGeneration,
    visualEditorSurface
  } = deps;

  const previewSurface = previewRuntimeRef.current?.surface;
  const boundaryElement =
    visualEditorSurface.closest<HTMLElement>('.easymde-workspace')
    ?? previewSurface?.closest<HTMLElement>('.easymde-workspace')
    ?? previewSurface?.parentElement
    ?? visualEditorSurface;

  return {
    canUploadImage: (image) =>
      imageUpload.enabled
      && 'off' !== imageUpload.remoteImageUploadMode
      && /^https?:\/\//iu.test(image.destination),
    boundaryElement,
    element: visualEditorSurface,
    // The visual owner settles the native input it has already accepted from
    // the user before this demand reads a document. A gesture that arrives
    // inside the owner's input debounce would otherwise capture the
    // pre-input source. The runtime performs only that existing flush plus
    // its own eligibility checks; it maps no target, requests no render, and
    // inserts nothing.
    prepareDemand: () => runtime.prepareContextMenuDemand(),
    // A demand can outlive the element it was anchored to: a ProseMirror
    // transaction may redraw or replace the unified visual surface's node
    // view DOM while the demand still waits for readiness. The runtime issues
    // a lease bound to the captured element and the document revision at
    // capture, so a replayed demand resolves only that same connected element
    // - never a reused ordinal, a coordinate, or a retired element.
    captureTarget: (target) => runtime.captureContextMenuTarget(target),
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
      // A demand authenticated without the asynchronous inventory (the
      // certified structural HR gap) has no block to read code content from.
      // Starting a query with a null index would leave it permanently
      // pending and gate the generic menu, so it simply carries no code
      // context until the index arrives.
      const codeContext =
        null === blockIndex
          ? null
          : editorCodeContentActionContext(
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
          ? { href: link.href }
          : null;
      let imageContext: EditorContextMenuActionContext['image'] | null = null;
      const hitImage =
        target instanceof HTMLImageElement ? target : target?.closest('img');
      // A ProseMirror separator hack is not an article image target.
      const imageElement = hitImage?.classList.contains('ProseMirror-separator')
        ? null
        : hitImage;
      let imageTargetProvenDifferent = false;
      // Image actions belong to the pointer target alone. A selection left
      // behind by an earlier image interaction must never turn another block,
      // or another image, into the image target this menu would act on, so
      // the hit image has to map onto the same source image range first.
      if (
        runtime
        && blockIndex
        && imageElement instanceof HTMLImageElement
        && runtime.surface.contains(imageElement)
      ) {
        const prepared = preparedImageTargetIndex(
          snapshot.value,
          revision,
          blockIndex,
          snapshot.selection
        );
        const lease = prepared
          ? leaseForVisualImage(
              runtime,
              prepared.index,
              prepared.image,
              imageElement
            )
          : null;
        if (prepared && lease) {
          imageContext = imageActionContext(
            editorImagePixelsPort,
            lease,
            prepared.image
          );
        } else if (prepared) {
          // A ProseMirror node-view redraw on the unified visual surface can
          // leave the hit image element unmappable while its source range is
          // unchanged. The pinned
          // selection-derived target is a recovery for that same source
          // image only: the hit element must occupy the same visual block
          // and image slot as the mounted lease. A different slot means the
          // pointer image and the prepared selection image are different
          // source images, so the menu must not borrow the selection's
          // lease and must not offer commands that would act on it.
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
          const mounted = reusablePendingImage?.pin.getLease() ?? null;
          const hitSlot = visualImageSlotIdentity(imageElement);
          if (reusablePendingImage && mounted && hitSlot) {
            const mountedSlot = visualImageSlotIdentity(mounted.root);
            imageTargetProvenDifferent = Boolean(
              !mountedSlot
                || mountedSlot.blockId !== hitSlot.blockId
                || mountedSlot.ordinal !== hitSlot.ordinal
                || mounted.target.original.start !== prepared.image.start
                || mounted.target.original.end !== prepared.image.end
            );
          }
          if (
            reusablePendingImage
            && mounted
            && hitSlot
            && mounted.target.blockId === hitSlot.blockId
            && mounted.target.ordinal === hitSlot.ordinal
            && mounted.target.original.start === prepared.image.start
            && mounted.target.original.end === prepared.image.end
          ) {
            const pin = reusablePendingImage.pin;
            const pinnedLease: PreviewImageTargetLease = {
              ...mounted,
              release: () => {
                mounted.release();
                pin.release();
                if (pendingImageTargetPinRef.current?.pin === pin) {
                  pendingImageTargetPinRef.current = null;
                }
              }
            };
            imageContext = imageActionContext(
              editorImagePixelsPort,
              pinnedLease,
              prepared.image
            );
            reusablePendingImage.context = imageContext;
          }
        }
        if (!imageContext && prepared) {
          // The unified ProseMirror visual surface may have redrawn the image
          // node view, retiring the lease that belonged to the previous DOM
          // image while the canonical image range is unchanged. Rebuild a
          // selection pin against the current runtime and accept it only
          // when its mounted slot is the pointer slot. This keeps repeated
          // scale actions and a second image after a node-view redraw
          // actionable without borrowing a sibling image lease.
          let pin: PreviewImageTargetPinLease | null = null;
          try {
            pin = runtime.prepareImageTargetBySelection({
              index: prepared.index,
              selection: {
                end: prepared.image.end,
                start: prepared.image.start
              }
            });
            const mounted = pin?.getLease() ?? null;
            const hitSlot = visualImageSlotIdentity(imageElement);
            const mountedSlot = mounted
              ? visualImageSlotIdentity(mounted.root)
              : null;
            if (
              mounted
              && hitSlot
              && mountedSlot
              && (mountedSlot.blockId !== hitSlot.blockId
                || mountedSlot.ordinal !== hitSlot.ordinal
                || mounted.target.original.start !== prepared.image.start
                || mounted.target.original.end !== prepared.image.end)
            ) {
              imageTargetProvenDifferent = true;
            }
            if (
              pin
              && mounted
              && hitSlot
              && mountedSlot
              && hitSlot.blockId === mountedSlot.blockId
              && hitSlot.ordinal === mountedSlot.ordinal
              && mounted.target.original.start === prepared.image.start
              && mounted.target.original.end === prepared.image.end
            ) {
              const ownedPin = pin;
              const pinnedLease: PreviewImageTargetLease = {
                ...mounted,
                release: () => {
                  mounted.release();
                  ownedPin.release();
                }
              };
              imageContext = imageActionContext(
                editorImagePixelsPort,
                pinnedLease,
                prepared.image
              );
              pin = null;
            }
          } catch (error) {
            if (!isPreviewSelectionUnavailable(error)) throw error;
          } finally {
            pin?.release();
          }
        }
        if (!imageContext && !imageTargetProvenDifferent) {
          // The pointer target is a rendered Markdown image, so image
          // commands are expected to resolve for it when the source range
          // itself cannot be recovered. A deliberate non-empty selection
          // naming a different image is a valid text-selection gesture; in
          // that case `prepared` is present but the pointer lease is
          // intentionally rejected, and the generic menu remains correct.
          // Only the no-source-match case is a stale Preview target and
          // must fail explicitly instead of silently degrading.
          //
          // Any deliberate text range is the other valid case without a
          // source match: one non-collapsed range whose endpoints are
          // connected inside this runtime's surface and whose selected text
          // is non-blank, whether or not it intersects the pointed image.
          // Such a range is not a stale pointer target, so `prepared` is
          // null by definition and the generic menu remains correct.
          // Anything else - a collapsed caret, a foreign or detached range,
          // or an image-node range with no selected text - stays an explicit
          // stale-image failure.
          const nativeSelection =
            runtime.surface.ownerDocument.defaultView?.getSelection();
          // An image-node selection (`selectNode(img)`) selects no text at
          // all. A mixed range always contains text besides the image, so
          // requiring non-blank selected text keeps the pointer-image stale
          // case - where the retired `<img>` node range survives - failing
          // exactly as before, while a real text+image range is admitted.
          const deliberateNativeSelection = Boolean(
            nativeSelection
              && 1 === nativeSelection.rangeCount
              && !nativeSelection.isCollapsed
              && nativeSelection.anchorNode?.isConnected
              && nativeSelection.focusNode?.isConnected
              && runtime.surface.contains(nativeSelection.anchorNode)
              && runtime.surface.contains(nativeSelection.focusNode)
              && '' !== nativeSelection.getRangeAt(0).toString().trim()
          );
          // Preserve a real user text range even when the pointed image is
          // outside it. The click must not publish the old range as the IMG
          // target, but it also must not turn a valid preserved selection
          // into the retired-image stale failure. An image-node selection or
          // a detached/foreign range has no such text and still fails the
          // stale proof above. No second selection state is stored here.
          if (!deliberateNativeSelection) {
            throw new Error('editor-context-menu-image-stale');
          }
        }
      }
      const baseContext = (
        extra: Partial<EditorContextMenuActionContext> = {}
      ) => {
        if (!linkContext && !imageContext && !codeContext && !extra.generated)
          return null;
        return {
          ...extra,
          ...(codeContext ? { code: codeContext } : {}),
          ...(imageContext ? { image: imageContext } : {}),
          ...(linkContext ? { link: linkContext } : {})
        };
      };
      if (
        !runtime
        || !hasGeneratedContentExport
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
      if (
        !editorContextSelectionFitsRange(
          snapshot.selection,
          lease.target.original.fullRange
        )
      ) {
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
        canCopyImage: supportsEditorPngClipboard(editorClipboardPort),
        canCopyMathMl:
          'math' === kind && generatedMathMlAvailable(generatedTarget.root),
        canUseSource: Boolean(lease.isCurrent?.()),
        code: {
          canCopyBlock: Boolean(lease.isCurrent?.()),
          canIndentBlock: codeContext?.canIndentBlock === true,
          canIndentSelection: codeContext?.canIndentSelection === true
        },
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
      // A visual Preview transfer invalidates the edit map the owner needs to
      // prepare a thematic-break or block selection, so a demand that arrives
      // mid-transfer is not ready yet. Two states describe that window: the
      // owner's own transfer flag, and the published surface phase, which is
      // `loading` until the accepted Preview for the pending source is
      // installed. Both must keep the demand pending, because a demand can
      // arrive while the surface is still `loading` and before the owner's
      // transfer state is observable through this surface. This reads live
      // owner state, not a render value: the demand is kept alive by the
      // readiness subscription and rebuilt from the same target once the
      // matching Preview is accepted, instead of throwing out of preparation
      // and surfacing as a generic menu-open failure.
      // A trusted local edit advanced the canonical document without a
      // render. The accepted edit map belongs to the previous document, so
      // this demand cannot use it - but refusing would make the pointer
      // gesture unavailable until the user manually left and re-entered the
      // mode. Request the formal Preview for the canonical source here and
      // keep the demand parked; readiness notifies again when that render is
      // accepted and the same gesture is rebuilt against the new map.
      if (runtime.needsAcceptedPreviewRefresh?.()) {
        runtime.refreshAcceptedPreview?.();
        return { status: 'pending' };
      }
      if (runtime.isTransferPending()) {
        return { status: 'pending' };
      }
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
          && failure.owner === runtime
          && failure.generation === visualEditorGeneration
          && failure.revision === snapshot.revision
          && failure.source === snapshot.value
        ) {
          return { code: failure.code, status: 'unavailable' };
        }
        if (!blockIndex) {
          const nativeSelection =
            runtime.surface.ownerDocument.defaultView?.getSelection();
          const nativeRange =
            nativeSelection?.rangeCount === 1
              ? nativeSelection.getRangeAt(0)
              : null;
          const nativeOffset = nativeSelection?.anchorOffset ?? -1;
          const rootGapBesideHr = Boolean(
            nativeSelection?.isCollapsed
              && nativeRange?.collapsed
              && nativeSelection.anchorNode === runtime.surface
              && nativeSelection.focusNode === runtime.surface
              && nativeSelection.anchorOffset === nativeSelection.focusOffset
              && Number.isInteger(nativeOffset)
              && nativeOffset >= 0
              && nativeOffset <= runtime.surface.childNodes.length
              && (runtime.surface.childNodes[nativeOffset]
                instanceof HTMLHRElement
                || runtime.surface.childNodes[nativeOffset - 1]
                  instanceof HTMLHRElement)
          );
          // The shared structural resolver authenticates an accepted HR from
          // the Preview edit map/Windowed ledger. It does not need the
          // asynchronous context-menu block index, so an HR demand must
          // reach that resolver on its first activation rather than waiting
          // for an unrelated inventory build.
          if (!rootGapBesideHr) return { status: 'pending' };
        }
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
      )
        return codeReadiness;
      return { status: 'ready' };
    },
    ...(hasBlockIndexPort
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
    prepare: (
      target,
      blockIndex,
      point,
      activation = 'keyboard',
      preparedSelection?: EditorContextMenuPreparedSelection
    ) => {
      const generated =
        generatedRootAtTarget(target ?? null, 'math')
        ?? generatedRootAtTarget(target ?? null, 'mermaid');
      if (generated) {
        const revision = documentSession.document.getRevision?.();
        const identity = runtime.getGeneratedPreviewIdentity();
        if (undefined === revision) return false;
        if (identity?.sourceRevision !== revision) return false;
        if (!runtime.surface.contains(generated.root)) return false;
        const nativeSelection =
          runtime.surface.ownerDocument.defaultView?.getSelection();
        const route = nativeVisualSelectionRoute(
          runtime.surface,
          nativeSelection
        );
        if ('boundary' === route || 'invalid' === route) return false;
        const prepared = documentSession.document.getSelection();
        if (
          'collapsed' === route
          && preparedSelection
          && preparedSelection.revision === revision
          && preparedSelection.surfaceGeneration === visualEditorGeneration
          && preparedSelection.selection.direction === prepared.direction
          && preparedSelection.selection.start === prepared.start
          && preparedSelection.selection.end === prepared.end
        ) {
          return true;
        }
        if ('inside' === route) {
          const selectionInsideRoot = Boolean(
            nativeSelection?.anchorNode
              && nativeSelection.focusNode
              && generated.root.contains(nativeSelection.anchorNode)
              && generated.root.contains(nativeSelection.focusNode)
          );
          if (!selectionInsideRoot) {
            // A deliberate selection inside the surface but outside the hit
            // root carries user intent the editable surface cannot
            // represent, so it is preserved instead of being rebound to the
            // generated root.
            return (
              runtime.prepareContextMenuSelection?.(target, point, activation)
              ?? runtime.prepareMediaSelection()
            );
          }
        }
        // A collapsed caret, a foreign range, or no range at all is not a
        // deliberate in-surface selection: the pointer target is then the
        // only generated-content source this surface has. A rendered formula
        // or diagram cannot own a caret at all, so map the hit root onto its
        // own source range and let the menu own that context.
        const kind = generated.root.matches('.easymde-math')
          ? 'math'
          : 'mermaid';
        const lease = blockIndex
          ? runtime.prepareGeneratedContentTarget?.({
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
            })
          : null;
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
      }
      if (target?.closest('pre')) {
        if (
          !(
            runtime.prepareContextMenuSelection?.(target, point, activation)
            ?? runtime.prepareMediaSelection()
          )
        )
          return false;
        // The Visual owner maps a whole code fence onto its complete source
        // line range, trailing line terminator included, while every other
        // owner reads the parser-owned block range that stops before that
        // terminator. Narrowing the canonical selection here keeps one
        // identical code range for the menu context, the code content read,
        // and the code block commands.
        const value = documentSession.document.getValue();
        const selection = documentSession.document.getSelection();
        const block = findMarkdownBlock(
          value,
          selection.start,
          blockIndex ?? undefined
        );
        if (
          block
          && 'code' === block.kind
          && selection.start >= block.start
          && selection.start < block.end
          && selection.end > block.end
          && selection.end
            <= blockRangeWithTrailingTerminator(value, {
              from: block.start,
              to: block.end
            }).to
        ) {
          documentSession.document.applyTextChange({
            selection: {
              direction: selection.direction,
              end: block.end,
              start: selection.start
            },
            value
          });
        }
        return true;
      }
      return (
        runtime.prepareContextMenuSelection?.(target, point, activation)
        ?? runtime.prepareMediaSelection()
      );
    },
    restoreFocus: () => {
      if (runtime.surface.isConnected)
        runtime.surface.focus({ preventScroll: true });
    },
    subscribeReadiness: subscribeContextMenuReadiness,
    subscribeSnapshot: documentSession.document.subscribe,
    subscribeSelection: documentSession.document.subscribeSelection
  };
}
