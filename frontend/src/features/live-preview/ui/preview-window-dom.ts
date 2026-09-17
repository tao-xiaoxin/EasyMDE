import type {
  PreviewEditMap,
  PreviewEditMapBlock
} from '../../../contracts/ports/preview-request';
import {
  createPreviewWindowModel,
  type PreviewWindowBlock,
  type PreviewWindowContext,
  type PreviewWindowResult,
  type PreviewWindowViewport
} from '../model/preview-window-model';

export const VISUAL_BLOCK_ATTRIBUTE = 'data-easymde-visual-block-id';
export const PREVIEW_WINDOW_SPACER_ATTRIBUTE =
  'data-easymde-preview-window-spacer';

type PreviewWindowRepositoryBlock = Readonly<{
  index: number;
  map: PreviewEditMapBlock;
  node: HTMLElement;
}>;

export type PreviewWindowNodeRepository = {
  blocks: ReadonlyArray<PreviewWindowRepositoryBlock>;
  context: PreviewWindowContext;
  indexById: ReadonlyMap<string, number>;
  model: ReturnType<typeof createPreviewWindowModel>;
  nodes: ReadonlyArray<HTMLElement>;
  spacers: Map<string, HTMLElement>;
};

export class PreviewWindowDomError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'PreviewWindowDomError';
  }
}

function fail(code: string): never {
  throw new PreviewWindowDomError(code);
}

function rootElements(surface: HTMLElement): HTMLElement[] {
  const roots: HTMLElement[] = [];
  for (const node of Array.from(surface.childNodes)) {
    if (node instanceof HTMLElement) {
      roots.push(node);
      continue;
    }
    if ('#text' === node.nodeName && (node.textContent ?? '').trim()) {
      fail('preview-window-root-text-invalid');
    }
    if (node.nodeType !== Node.COMMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
      fail('preview-window-root-node-invalid');
    }
  }
  return roots;
}

function validateBlockBinding(
  roots: readonly HTMLElement[],
  editMap: PreviewEditMap
): void {
  if (roots.length !== editMap.blocks.length) {
    fail('preview-window-block-map-count-mismatch');
  }
  const ids = new Set<string>();
  roots.forEach((root, index) => {
    const expected = editMap.blocks[index];
    if (!expected || root.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== expected.id) {
      fail('preview-window-block-map-marker-mismatch');
    }
    if (ids.has(expected.id)) fail('preview-window-block-map-duplicate');
    ids.add(expected.id);
  });
}

export function validatePreviewWindowMarkup(
  surface: HTMLElement,
  editMap: PreviewEditMap
): void {
  if (
    1 !== editMap.version
    || 'line' !== editMap.coordinate
  ) {
    fail('preview-window-edit-map-invalid');
  }
  validateBlockBinding(rootElements(surface), editMap);
}

export function createPreviewWindowRepository(
  surface: HTMLElement,
  editMap: PreviewEditMap,
  context: PreviewWindowContext
): PreviewWindowNodeRepository {
  if (
    1 !== editMap.version
    || 'line' !== editMap.coordinate
    || editMap.signature !== context.signature
  ) {
    fail('preview-window-edit-map-invalid');
  }
  const roots = rootElements(surface);
  validateBlockBinding(roots, editMap);
  const blocks: PreviewWindowBlock[] = editMap.blocks.map((map) => ({
    id: map.id,
    startLine: map.startLine,
    endLine: map.endLine,
    editable: map.editable,
    measuredHeight: 24
  }));
  const model = createPreviewWindowModel(blocks, context);
  const indexById = new Map<string, number>();
  editMap.blocks.forEach((block, index) => {
    indexById.set(block.id, index);
  });
  return {
    blocks: editMap.blocks.map((map, index) => ({
      index,
      map,
      node: roots[index] as HTMLElement
    })),
    context,
    indexById,
    model,
    nodes: roots,
    spacers: new Map()
  };
}

export function previewWindowBlockIndexForNode(
  repository: PreviewWindowNodeRepository,
  surface: HTMLElement,
  node: Node | null
): number | null {
  let current = node;
  while (current && current !== surface) {
    if (current instanceof HTMLElement) {
      const id = current.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
      if (id) return repository.indexById.get(id) ?? null;
    }
    current = current.parentNode;
  }
  return null;
}

export function validatePreviewWindowRepository(
  repository: PreviewWindowNodeRepository
): void {
  // The repository is detached after the staging candidate is removed, so
  // validate its node sequence without relying on a connected parent.
  if (repository.nodes.length !== repository.blocks.length) {
    fail('preview-window-repository-count-mismatch');
  }
  repository.blocks.forEach((block, index) => {
    if (repository.nodes[index] !== block.node) {
      fail('preview-window-repository-order-invalid');
    }
    if (block.node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.map.id) {
      fail('preview-window-block-map-marker-mismatch');
    }
  });
}

function spacerKey(
  range: PreviewWindowResult['layoutRuns'][number]['range'],
  height: number
): string {
  return `${range.start}:${range.end}:${height}`;
}

function createSpacer(
  documentRef: Document,
  range: PreviewWindowResult['layoutRuns'][number]['range'],
  height: number
): HTMLElement {
  const spacer = documentRef.createElement('div');
  spacer.setAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE, '1');
  spacer.setAttribute('data-easymde-preview-window-start', String(range.start));
  spacer.setAttribute('data-easymde-preview-window-end', String(range.end));
  spacer.setAttribute('aria-hidden', 'true');
  spacer.contentEditable = 'false';
  spacer.style.blockSize = `${Math.max(0, height)}px`;
  spacer.style.margin = '0';
  spacer.style.padding = '0';
  spacer.style.border = '0';
  return spacer;
}

function spacerFor(
  repository: PreviewWindowNodeRepository,
  range: PreviewWindowResult['layoutRuns'][number]['range'],
  height: number
): HTMLElement {
  const key = spacerKey(range, height);
  const existing = repository.spacers.get(key);
  if (existing) return existing;
  const documentRef = repository.nodes[0]?.ownerDocument;
  if (!documentRef) fail('preview-window-repository-empty');
  const spacer = createSpacer(documentRef, range, height);
  repository.spacers.set(key, spacer);
  return spacer;
}

export function windowNodes(
  repository: PreviewWindowNodeRepository,
  result: PreviewWindowResult
): ReadonlyArray<Node> {
  const nodes: Node[] = [];
  for (const run of result.layoutRuns) {
    if ('spacer' === run.kind) {
      nodes.push(spacerFor(repository, run.range, run.height));
      continue;
    }
    for (let index = run.range.start; index < run.range.end; index += 1) {
      const node = repository.nodes[index];
      if (!node) fail('preview-window-repository-order-invalid');
      nodes.push(node);
    }
  }
  return nodes;
}

export function fullMaterializedNodes(
  repository: PreviewWindowNodeRepository
): ReadonlyArray<Node> {
  return repository.nodes;
}

export function viewportForCanvas(canvas: HTMLElement): PreviewWindowViewport {
  const rect = canvas.getBoundingClientRect();
  const height = canvas.clientHeight > 0 ? canvas.clientHeight : rect.height;
  return {
    scrollTop: Math.max(0, canvas.scrollTop),
    height: Math.max(0, Number.isFinite(height) ? height : 0)
  };
}
