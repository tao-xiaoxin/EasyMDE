import type { EditorMarkdownBlockIndexData } from '../../contracts/ports/editor-block-index-port';
import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type {
  EditorImagePixelsLease,
  EditorImagePixelsPort
} from '../../contracts/ports/editor-image-pixels-port';
import type { PreviewCodeProjectionEntry } from '../../contracts/ports/preview-request';
import type { EditorContextMenuActionContext } from '../../features/editor-context-menu/EditorContextMenuFeature';
import type { EditorCodeContentQueryState } from '../../features/editor-context-menu/editor-code-content-query';
import { canIndentEditorCode } from '../../features/editor-context-menu/editor-code-indentation';
import type { EditorContextSnapshot } from '../../features/editor-context-menu/editor-context-menu-rules';
import {
  blockRangeWithTrailingTerminator,
  editorContextSelectionFitsRange
} from '../../features/editor-context-menu/editor-context-menu-text-edit';
import type { EditorMarkdownBlockIndex } from '../../features/editor-context-menu/editor-markdown-block-index';
import type { EditorSourceLinkQueryState } from '../../features/editor-context-menu/editor-source-link-query';
import {
  type GeneratedImageTargetIndex,
  hydrateGeneratedImageTargetIndex
} from '../../features/generated-content-export/generated-image-target';
import type { MarkdownImageScaleMatch } from '../../features/image-scale/image-scale-contract';
import type { PreviewImageTargetLease } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { PreviewWindowDomError } from '../../features/live-preview/ui/preview-window-dom';
import { markdownLineStarts } from '../../shared/markdown/markdown-line-model';
import type {
  EditorMarkdownBlockIndexWithImages,
  EditorMarkdownBlockIndexWithPreparedImages,
  GeneratedContentReadinessKey,
  ImageLeaseRuntime,
  NativeVisualSelectionRoute,
  PendingGeneratedContentPin
} from './editor-root-types';

export const GENERATED_CONTENT_READINESS_TIMEOUT_MS = 10_000;

export function nativeVisualSelectionRoute(
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
  )
    return 'invalid';
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

export function editorCodeContentActionContext(
  state: EditorCodeContentQueryState,
  source?: string,
  selection?: EditorContextSnapshot['selection']
): EditorContextMenuActionContext['code'] | null {
  if ('ready' !== state.status) return null;
  if (
    source
    && selection
    && !editorContextSelectionFitsRange(
      selection,
      blockRangeWithTrailingTerminator(source, {
        from: state.target.from,
        to: state.target.to
      })
    )
  )
    return null;
  const projectionEntry =
    'available' === state.codeProjection?.status
      ? state.codeProjection.entries.find(
          (
            entry
          ): entry is Extract<
            PreviewCodeProjectionEntry,
            { status: 'available' }
          > =>
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
    ...(projectionEntry?.kind === 'fenced'
      ? { info: projectionEntry.info }
      : {}),
    requestSignature: state.requestSignature,
    target: state.target
  };
}

export function editorSourceLinkActionContext(
  state: EditorSourceLinkQueryState
): EditorContextMenuActionContext['link'] | null {
  if ('ready' !== state.status) return null;
  return { href: state.href };
}

export function generatedContentReadinessKey(
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

export function sameGeneratedContentReadinessKey(
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

export function editorBlockIndexFailureCode(error: unknown): string {
  return error instanceof Error
    && /^editor-block-index-[a-z0-9-]+$/u.test(error.message)
    ? error.message
    : 'editor-context-menu-block-index-failed';
}

export async function editorBlockIndexFromData(
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

export function generatedRootAtTarget(
  target: Element | null,
  kind: 'math' | 'mermaid'
): Readonly<{ ordinal: number; root: HTMLElement }> | null {
  if (!target) return null;
  const selector = 'math' === kind ? '.easymde-math' : '.easymde-mermaid';
  const root = target.closest(selector);
  if (!(root instanceof HTMLElement)) return null;
  const block = root.closest<HTMLElement>('[data-easymde-visual-block-id]');
  if (block) {
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
  const proseMirrorSurface = root.closest<HTMLElement>(
    '.easymde-prosemirror-editor'
  );
  if (!proseMirrorSurface) return null;
  const roots = Array.from(
    proseMirrorSurface.querySelectorAll<HTMLElement>(selector)
  ).filter(
    (candidate) => candidate.parentElement?.closest(selector) === null
  );
  const ordinal = roots.indexOf(root);
  return ordinal < 0 ? null : { ordinal, root };
}

/**
 * The pointer image's rendered identity: the visual block it belongs to and
 * its image slot inside that block.
 */
export function visualImageSlotIdentity(
  image: HTMLImageElement
): Readonly<{ blockId: string; ordinal: number }> | null {
  const block = image.closest<HTMLElement>('[data-easymde-visual-block-id]');
  const blockId = block?.getAttribute('data-easymde-visual-block-id');
  if (block && blockId) {
    const images = Array.from(block.querySelectorAll('img')).filter(
      (candidate) => candidate.closest('[data-easymde-visual-block-id]') === block
    );
    const ordinal = images.indexOf(image);
    return ordinal < 0 ? null : { blockId, ordinal };
  }
  const proseMirrorSurface = image.closest<HTMLElement>(
    '.easymde-prosemirror-editor'
  );
  if (!proseMirrorSurface) return null;
  const ordinal = Array.from(proseMirrorSurface.querySelectorAll('img')).indexOf(
    image
  );
  return ordinal < 0 ? null : { blockId: 'pm-block-0', ordinal };
}

export function generatedMathMlAvailable(root: Element): boolean {
  const katex = root.matches('.katex')
    ? root
    : root.querySelector(':scope > .katex, :scope > .katex-display > .katex');
  return Boolean(katex?.querySelector(':scope > .katex-mathml > math'));
}

export function sameGeneratedContentSelection(
  left: Readonly<{ end: number; start: number }>,
  right: Readonly<{ end: number; start: number }>
): boolean {
  return left.start === right.start && left.end === right.end;
}

export function isPreparedImageIndex(
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

export function preparedImageMatch(
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

export function preparedImageTargetIndex(
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

export function leaseForVisualImage(
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

export function imageActionContext(
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

export function isPreviewSelectionUnavailable(error: unknown): boolean {
  return (
    error instanceof PreviewWindowDomError
    && (error.message === 'preview-window-selection-block-unavailable'
      || error.message === 'preview-window-selection-map-invalid'
      || error.message === 'preview-window-selection-range-invalid')
  );
}

export function supportsEditorPngClipboard(
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

export function supportsEditorRichClipboard(
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
