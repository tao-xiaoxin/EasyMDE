import {
  createElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { CSSProperties } from 'react';

import type {
  PreviewEditMap,
  PreviewFeatures,
  PreviewRequestPort,
  PreviewRequestState,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import {
  DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED
} from '../model/preview-window-model';
import {
  createPreviewRequestSession,
  type PreviewRequestSession
} from '../model/create-preview-request-session';
import {
  previewEnhancementFailureCode,
  type PreviewEnhancementPort
} from '../ports/preview-enhancement-port';
import type { PreviewScrollPort, PreviewScrollSnapshot } from '../ports/preview-scroll-port';
import {
  SafePreviewHtmlSink,
  type SafePreviewHtmlSinkCommit,
  type SafePreviewHtmlSinkMaterializeCommit,
  type SafePreviewHtmlSinkWindowCommit
} from './SafePreviewHtmlSink';
import {
  createPreviewWindowRepository,
  fullMaterializedNodes,
  PreviewWindowDomError,
  previewWindowBlockIndexForNode,
  validatePreviewWindowMarkup,
  validatePreviewWindowRepository,
  viewportForCanvas,
  VISUAL_BLOCK_ATTRIBUTE,
  PREVIEW_WINDOW_SPACER_ATTRIBUTE,
  windowNodes,
  type PreviewWindowNodeRepository
} from './preview-window-dom';

function previewFailureCode(error: unknown): string {
  return error instanceof PreviewWindowDomError
    ? error.message
    : previewEnhancementFailureCode(error);
}

function previewNeedsWindow(editMap: PreviewEditMap | null): boolean {
  return (editMap?.blocks.length ?? 0) > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
}

type PreviewMessages = Readonly<{
  empty: string;
  error: string;
}>;

type PreviewHtmlState = Readonly<{
  codeTheme: string;
  editMap: PreviewEditMap | null;
  features: PreviewFeatures;
  generation: number;
  html: SafePreviewHtml;
  htmlRevision: number;
  kind: 'html';
  paperPlaceholder?: true;
  phase: 'committing' | 'enhancing' | 'failed' | 'loading' | 'ready';
  signature: string;
  materializeCommit: SafePreviewHtmlSinkMaterializeCommit | null;
  stagedCommit: SafePreviewHtmlSinkCommit | null;
  windowedCommit: SafePreviewHtmlSinkWindowCommit | null;
  windowedFailure?: boolean;
}>;

type PreviewStatusState = Readonly<{
  generation: number;
  kind: 'empty' | 'error' | 'loading';
}>;

type PreviewSurfaceState = PreviewHtmlState | PreviewStatusState;

export type PreviewSurfaceStagingScheduler = Readonly<{
  now?: () => number;
  yield: () => Promise<void>;
}>;

const PREVIEW_STAGING_SLICE_BUDGET_MS = 8;
const PREVIEW_STAGING_DOM_APPEND_MAX_NODES = 32;
const PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS = 32;

type PreviewEnhancementCandidate = Readonly<{
  codeTheme: string;
  editMap: PreviewEditMap | null;
  features: PreviewFeatures;
  generation: number;
  serverHtml: SafePreviewHtml;
  signature: string;
  sourceNodes: ReadonlyArray<Node>;
  surface: HTMLElement;
}>;

export type PreviewSurfaceStatus = 'empty' | 'error' | 'loading' | 'ready';

const VISUAL_MARKDOWN_SOURCE_ATTRIBUTE =
  'data-easymde-visual-markdown-source';

type VisualBlockMarker = Readonly<{
  id: string;
  marker: Comment;
}>;

type PendingMaterialization = Readonly<{
  key: number;
  promise: Promise<boolean>;
  resolve: (completed: boolean) => void;
  revision: number;
}>;

type MutablePreviewWindowCommit = {
  key: number;
  nodes: Node[];
  revision: number;
};

export type PreviewSurfaceRuntime = Readonly<{
  materialize: () => Promise<boolean>;
  prepareWindowBlockAdoption: (
    node: HTMLElement
  ) => (() => boolean) | null;
  session: PreviewRequestSession;
  surface: HTMLElement;
}>;

type PreviewSurfaceOwnerProps = Readonly<{
  className?: string;
  contentEditable?: boolean;
  emptyMode?: 'message' | 'paper';
  enhancementPort: PreviewEnhancementPort;
  featureOverrides?: PreviewFeatures;
  initial: Readonly<{
    codeTheme?: string;
    editMap?: PreviewEditMap;
    features: PreviewFeatures;
    html: SafePreviewHtml;
    signature: string;
  }>;
  initialRevision: number;
  label?: string;
  messages: PreviewMessages;
  onDiagnostic?: (code: string) => void;
  onHtmlChange?: (html: SafePreviewHtml) => void;
  onWindowReady?: () => void;
  onSnapshotReady?: (
    html: SafePreviewHtml,
    signature: string,
    editMap: PreviewEditMap | null
  ) => void;
  onDispose?: (runtime: PreviewSurfaceRuntime) => void;
  onReady: (runtime: PreviewSurfaceRuntime) => void;
  onStatusChange?: (status: PreviewSurfaceStatus) => void;
  port: PreviewRequestPort;
  scrollPort: PreviewScrollPort;
  role?: string;
  spellCheck?: boolean;
  materializeScheduler?: PreviewSurfaceStagingScheduler;
  stagingScheduler?: PreviewSurfaceStagingScheduler;
  style?: CSSProperties;
  windowed?: boolean;
}>;

function initialState(props: PreviewSurfaceOwnerProps): PreviewSurfaceState {
  const features = {
    ...props.initial.features,
    ...props.featureOverrides
  };
  if (!props.initial.html.trim()) {
    if ('paper' === props.emptyMode) {
      return {
        codeTheme: props.initial.codeTheme ?? '',
        editMap: props.initial.editMap ?? null,
        features,
        generation: 0,
        html: props.initial.html,
        htmlRevision: 0,
        kind: 'html',
        paperPlaceholder: true,
        phase: 'enhancing',
        signature: props.initial.signature,
        materializeCommit: null,
        stagedCommit: null,
        windowedCommit: null
      };
    }
    return { generation: 0, kind: 'loading' };
  }
  return {
    codeTheme: props.initial.codeTheme ?? '',
    editMap: props.initial.editMap ?? null,
    features,
    generation: 0,
    html: props.initial.html,
    htmlRevision: 0,
    kind: 'html',
    phase: 'enhancing',
    signature: props.initial.signature,
    materializeCommit: null,
    stagedCommit: null,
    windowedCommit: null
  };
}

function hasExactSurfaceChildren(
  surface: HTMLElement,
  nodes: ReadonlyArray<Node>
): boolean {
  if (surface.childNodes.length !== nodes.length) return false;
  return nodes.every((node, index) => surface.childNodes[index] === node);
}

function surfaceStatus(state: PreviewSurfaceState): PreviewSurfaceStatus {
  if ('html' !== state.kind) {
    return state.kind;
  }
  return 'ready' === state.phase ? 'ready' : 'failed' === state.phase ? 'error' : 'loading';
}

function previewScrollCanvas(surface: HTMLElement): HTMLElement {
  const canvas = surface.parentElement;
  if (!canvas?.classList.contains('easymde-immersive-preview-canvas')) {
    throw new Error('preview-scroll-canvas-missing');
  }
  return canvas;
}

function createEnhancementCandidate(
  activeSurface: HTMLElement,
  html: SafePreviewHtml,
  layoutParticipating: boolean,
  preparedSourceNodes?: ReadonlyArray<Node>
): Readonly<{ sourceNodes: ReadonlyArray<Node>; surface: HTMLElement }> {
  const documentRef = activeSurface.ownerDocument;
  let sourceNodes: ReadonlyArray<Node>;
  if (preparedSourceNodes) {
    sourceNodes = preparedSourceNodes;
  } else {
    const template = documentRef.createElement('template');
    template.innerHTML = html;
    sourceNodes = Array.from(template.content.childNodes);
  }
  const candidate = documentRef.createElement('div');
  candidate.className = activeSurface.className;
  candidate.style.cssText = activeSurface.style.cssText;
  candidate.setAttribute('aria-hidden', 'true');
  candidate.setAttribute('inert', '');
  candidate.dataset.easymdePreviewStaging = '1';
  candidate.style.position = 'fixed';
  candidate.style.insetInlineStart = '-100000px';
  candidate.style.top = '0';
  candidate.style.width = `${Math.max(
    1,
    activeSurface.getBoundingClientRect().width
  )}px`;
  candidate.style.maxWidth = 'none';
  candidate.style.visibility = 'hidden';
  candidate.style.pointerEvents = 'none';
  if (layoutParticipating) {
    previewScrollCanvas(activeSurface).append(candidate);
  } else {
    candidate.style.display = 'none';
  }
  return {
    sourceNodes,
    surface: candidate
  };
}

function defaultPreviewSurfaceStagingScheduler(
  documentRef: Document
): PreviewSurfaceStagingScheduler {
  const windowRef = documentRef.defaultView;
  return {
    now: () => windowRef?.performance?.now() ?? Date.now(),
    yield: () => new Promise<void>((resolve) => {
      if (windowRef?.requestAnimationFrame) {
        windowRef.requestAnimationFrame(() => resolve());
        return;
      }
      if (windowRef) {
        windowRef.setTimeout(resolve, 0);
        return;
      }
      setTimeout(resolve, 0);
    })
  };
}

function stagingTime(
  scheduler: PreviewSurfaceStagingScheduler,
  documentRef: Document
): number {
  return scheduler.now?.()
    ?? documentRef.defaultView?.performance?.now()
    ?? Date.now();
}

async function populateEnhancementCandidate(
  candidate: PreviewEnhancementCandidate,
  scheduler: PreviewSurfaceStagingScheduler,
  isCurrent: () => boolean,
  signal: AbortSignal
): Promise<boolean> {
  const documentRef = candidate.surface.ownerDocument;
  let sliceStartedAt = stagingTime(scheduler, documentRef);
  let index = 0;
  while (index < candidate.sourceNodes.length) {
    const batch = documentRef.createDocumentFragment();
    let batchSize = 0;
    do {
      if (signal.aborted || !isCurrent()) return false;
      const node = candidate.sourceNodes[index];
      if (!node) throw new Error('preview-staging-node-missing');
      batch.append(node);
      index += 1;
      batchSize += 1;
    } while (
      index < candidate.sourceNodes.length
      && batchSize < PREVIEW_STAGING_DOM_APPEND_MAX_NODES
      && stagingTime(scheduler, documentRef) - sliceStartedAt
        < PREVIEW_STAGING_SLICE_BUDGET_MS
    );
    candidate.surface.append(batch);
    if (
      index < candidate.sourceNodes.length
      && stagingTime(scheduler, documentRef) - sliceStartedAt
        >= PREVIEW_STAGING_SLICE_BUDGET_MS
    ) {
      await scheduler.yield();
      if (signal.aborted || !isCurrent()) return false;
      sliceStartedAt = stagingTime(scheduler, documentRef);
    }
  }
  return !signal.aborted && isCurrent();
}

function discardEnhancementCandidate(
  candidate: PreviewEnhancementCandidate | null
): void {
  candidate?.surface.remove();
}

function capturePreviewBlockMarkers(
  surface: HTMLElement,
  editMap: PreviewEditMap,
  scheduler: PreviewSurfaceStagingScheduler,
  isCurrent: () => boolean,
  signal: AbortSignal
): ReadonlyArray<VisualBlockMarker> | null
  | Promise<ReadonlyArray<VisualBlockMarker> | null> {
  validatePreviewWindowMarkup(surface, editMap);
  const markers: VisualBlockMarker[] = [];
  const documentRef = surface.ownerDocument;
  const stale = (): null => {
    removePreviewBlockMarkers(markers);
    return null;
  };
  const capture = async (): Promise<ReadonlyArray<VisualBlockMarker> | null> => {
    let sliceStartedAt = stagingTime(scheduler, documentRef);
    try {
      for (let blockIndex = 0; blockIndex < editMap.blocks.length; blockIndex += 1) {
        if (signal.aborted || !isCurrent()) return stale();
        const block = editMap.blocks[blockIndex];
        const root = surface.children[blockIndex];
        if (!block || !(root instanceof HTMLElement)) {
          throw new Error('preview-window-block-map-marker-mismatch');
        }
        const marker = documentRef.createComment(
          `easymde-visual-block:${block.id}`
        );
        root.before(marker);
        markers.push({ id: block.id, marker });
        if (
          blockIndex + 1 < editMap.blocks.length
          && stagingTime(scheduler, documentRef) - sliceStartedAt
            >= PREVIEW_STAGING_SLICE_BUDGET_MS
        ) {
          await scheduler.yield();
          if (signal.aborted || !isCurrent()) return stale();
          sliceStartedAt = stagingTime(scheduler, documentRef);
        }
      }
      return markers;
    } catch (error) {
      removePreviewBlockMarkers(markers);
      throw error;
    }
  };
  return capture();
}

function removePreviewBlockMarkers(
  markers: ReadonlyArray<VisualBlockMarker>
): void {
  for (const { marker } of markers) marker.remove();
}

function annotateEnhancedPreviewBlocks(
  markers: ReadonlyArray<VisualBlockMarker>,
  scheduler: PreviewSurfaceStagingScheduler,
  isCurrent: () => boolean,
  signal: AbortSignal
): boolean | Promise<boolean> {
  const documentRef = markers[0]?.marker.ownerDocument;
  if (!documentRef) {
    removePreviewBlockMarkers(markers);
    return !signal.aborted && isCurrent();
  }
  const annotate = async (): Promise<boolean> => {
    let sliceStartedAt = stagingTime(scheduler, documentRef);
    try {
      for (let index = 0; index < markers.length; index += 1) {
        if (signal.aborted || !isCurrent()) return false;
        const entry = markers[index];
        const target = entry?.marker.nextElementSibling;
        if (!entry || !(target instanceof HTMLElement)) {
          throw new Error('preview-window-block-map-marker-mismatch');
        }
        target.setAttribute(VISUAL_BLOCK_ATTRIBUTE, entry.id);
        if (
          index + 1 < markers.length
          && stagingTime(scheduler, documentRef) - sliceStartedAt
            >= PREVIEW_STAGING_SLICE_BUDGET_MS
        ) {
          await scheduler.yield();
          if (signal.aborted || !isCurrent()) return false;
          sliceStartedAt = stagingTime(scheduler, documentRef);
        }
      }
      return !signal.aborted && isCurrent();
    } finally {
      removePreviewBlockMarkers(markers);
    }
  };
  return annotate();
}

type VisualMarkdownSourceMarker = Readonly<{
  kind: 'math' | 'mermaid';
  marker: Comment;
  source: string;
}>;

function captureVisualMarkdownSources(
  surface: HTMLElement
): ReadonlyArray<VisualMarkdownSourceMarker> {
  const sources: VisualMarkdownSourceMarker[] = [];
  for (const node of surface.querySelectorAll<HTMLElement>('.easymde-math')) {
    if (node.closest('pre > code')) continue;
    const marker = surface.ownerDocument.createComment(
      'easymde-visual-markdown-source'
    );
    node.before(marker);
    sources.push({ kind: 'math', marker, source: node.textContent ?? '' });
  }
  for (const node of surface.querySelectorAll<HTMLElement>(
    'pre > code.language-mermaid'
  )) {
    const block = node.parentElement;
    if (!block) throw new Error('preview-enhancement-visual-source-missing');
    const marker = surface.ownerDocument.createComment(
      'easymde-visual-markdown-source'
    );
    block.before(marker);
    sources.push({ kind: 'mermaid', marker, source: node.textContent ?? '' });
  }
  return sources;
}

function removeVisualMarkdownSourceMarkers(
  sources: ReadonlyArray<VisualMarkdownSourceMarker>
): void {
  for (const { marker } of sources) marker.remove();
}

function annotateEnhancedVisualSources(
  sources: ReturnType<typeof captureVisualMarkdownSources>
): void {
  try {
    for (const { kind, marker, source } of sources) {
      const output = marker.nextElementSibling;
      const target = 'math' === kind
        ? output?.matches('.easymde-math') ? output : null
        : output?.matches('.easymde-mermaid')
          ? output
          : output?.matches('pre')
            ? output.querySelector(':scope > code.language-mermaid')
            : null;
      if (!target) {
        throw new Error('preview-enhancement-visual-source-missing');
      }
      target.setAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE, source);
    }
  } finally {
    removeVisualMarkdownSourceMarkers(sources);
  }
}

export function PreviewSurfaceOwner(props: PreviewSurfaceOwnerProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const scrollSnapshotRef = useRef<PreviewScrollSnapshot | null>(null);
  const generationRef = useRef(0);
  const enhancementCandidateRef =
    useRef<PreviewEnhancementCandidate | null>(null);
  const committedEnhancementCandidateRef =
    useRef<PreviewEnhancementCandidate | null>(null);
  const previewWindowRepositoryRef =
    useRef<PreviewWindowNodeRepository | null>(null);
  const pendingWindowCommitRef =
    useRef<MutablePreviewWindowCommit | null>(null);
  const windowCommitKeyRef = useRef(0);
  const windowCommitPendingRef = useRef(false);
  const windowStyleEpochRef = useRef(0);
  const windowWidthEpochRef = useRef(0);
  const windowStyleSignatureRef = useRef('');
  const windowWidthRef = useRef<number | null>(null);
  const materializeCommitKeyRef = useRef(0);
  const materializePendingRef = useRef<PendingMaterialization | null>(null);
  const materializationPendingRef = useRef(false);
  const materializedOverrideRef = useRef(false);
  const ownerActiveRef = useRef(false);
  const prepareWindowBlockAdoptionRef = useRef<
    (node: HTMLElement) => (() => boolean) | null
  >(() => null);
  const materializeRef = useRef<() => Promise<boolean>>(() =>
    Promise.resolve(false)
  );
  const scheduleWindowRef = useRef<() => void>(() => undefined);
  const windowedRef = useRef(Boolean(props.windowed));
  windowedRef.current = Boolean(props.windowed);
  const layoutSyncedGenerationRef = useRef<number | null>(null);
  const emptyModeRef = useRef(props.emptyMode);
  emptyModeRef.current = props.emptyMode;
  const [state, setState] = useState<PreviewSurfaceState>(() => initialState(props));
  const stateRef = useRef<PreviewSurfaceState>(state);
  stateRef.current = state;
  const windowStyleSignature = `${props.className ?? ''}:${JSON.stringify(
    props.style ?? {}
  )}`;
  if (windowStyleSignatureRef.current !== windowStyleSignature) {
    windowStyleSignatureRef.current = windowStyleSignature;
    windowStyleEpochRef.current += 1;
  }

  const discardPendingWork = useCallback(() => {
    const pendingMaterialization = materializePendingRef.current;
    if (pendingMaterialization) {
      materializePendingRef.current = null;
      materializationPendingRef.current = false;
      pendingMaterialization.resolve(false);
    }
    materializedOverrideRef.current = false;
    pendingWindowCommitRef.current = null;
    windowCommitPendingRef.current = false;
    discardEnhancementCandidate(enhancementCandidateRef.current);
    enhancementCandidateRef.current = null;
  }, []);

  const discardStaging = useCallback(() => {
    discardPendingWork();
    discardEnhancementCandidate(committedEnhancementCandidateRef.current);
    committedEnhancementCandidateRef.current = null;
    previewWindowRepositoryRef.current = null;
  }, [discardPendingWork]);

  const onStagedCommit = useCallback((revision: number) => {
    windowCommitPendingRef.current = false;
    if (pendingWindowCommitRef.current?.revision === revision) {
      pendingWindowCommitRef.current = null;
    }
    const repository = previewWindowRepositoryRef.current;
    if (repository && repository.context.revision !== revision) {
      previewWindowRepositoryRef.current = null;
    }
    const candidate = committedEnhancementCandidateRef.current;
    if (candidate?.generation === revision) {
      candidate.surface.remove();
      committedEnhancementCandidateRef.current = null;
    }
    const finish = () => {
      if (!ownerActiveRef.current || generationRef.current !== revision) return;
      setState((current) =>
        'html' === current.kind
        && current.generation === revision
        && 'committing' === current.phase
        && (
          current.stagedCommit?.revision === revision
          || current.windowedCommit?.revision === revision
        )
          ? { ...current, phase: 'ready', stagedCommit: null }
          : current
      );
      scheduleWindowRef.current();
    };
    const fail = (error: unknown) => {
      if (!ownerActiveRef.current || generationRef.current !== revision) return;
      props.onDiagnostic?.(previewFailureCode(error));
      previewWindowRepositoryRef.current = null;
      setState((current) =>
        'html' === current.kind
        && current.generation === revision
        && 'committing' === current.phase
          ? {
              ...current,
              phase: 'failed',
              signature: '',
              stagedCommit: null,
              windowedCommit: null,
              windowedFailure: true
            }
          : current
      );
    };
    const current = stateRef.current;
    if (
      windowedRef.current
      && 'html' === current.kind
      && 'committing' === current.phase
      && previewNeedsWindow(current.editMap)
    ) {
      const surface = surfaceRef.current;
      if (!surface) throw new Error('preview-surface-missing');
      const scheduler = props.stagingScheduler
        ?? defaultPreviewSurfaceStagingScheduler(surface.ownerDocument);
      void scheduler.yield().then(finish, fail);
      return;
    }
    finish();
  }, [props.onDiagnostic, props.stagingScheduler]);

  const onMaterializeComplete = useCallback((
    revision: number,
    key: number
  ) => {
    const pending = materializePendingRef.current;
    if (
      !ownerActiveRef.current
      || !pending
      || pending.revision !== revision
      || pending.key !== key
    ) return;
    materializePendingRef.current = null;
    materializationPendingRef.current = false;
    pending.resolve(true);
    setState((current) =>
      'html' === current.kind
      && current.generation === revision
      && current.materializeCommit?.key === key
        ? {
            ...current,
            materializeCommit: null,
            stagedCommit: null,
            windowedCommit: null
          }
        : current
    );
  }, []);

  const onMaterializeFailure = useCallback((
    revision: number,
    key: number,
    error: unknown
  ) => {
    const pending = materializePendingRef.current;
    if (
      !ownerActiveRef.current
      || !pending
      || pending.revision !== revision
      || pending.key !== key
    ) return;
    materializePendingRef.current = null;
    materializationPendingRef.current = false;
    materializedOverrideRef.current = false;
    windowCommitPendingRef.current = false;
    previewWindowRepositoryRef.current = null;
    pending.resolve(false);
    props.onDiagnostic?.(previewFailureCode(error));
    setState((current) =>
      'html' === current.kind
      && current.generation === revision
      && current.materializeCommit?.key === key
        ? {
            ...current,
            materializeCommit: null,
            phase: 'failed',
            signature: '',
            stagedCommit: null,
            windowedCommit: null,
            windowedFailure: true
          }
        : current
    );
  }, [props.onDiagnostic]);

  const materialize = useCallback((): Promise<boolean> => {
    if (!ownerActiveRef.current) return Promise.resolve(false);
    const repository = previewWindowRepositoryRef.current;
    if (!repository) return Promise.resolve(true);
    try {
      validatePreviewWindowRepository(repository);
    } catch (error) {
      props.onDiagnostic?.(previewFailureCode(error));
      return Promise.resolve(false);
    }
    const surface = surfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    const nodes = fullMaterializedNodes(repository);
    if (hasExactSurfaceChildren(surface, nodes)) {
      materializedOverrideRef.current = true;
      return Promise.resolve(true);
    }
    const pending = materializePendingRef.current;
    if (pending?.revision === repository.context.revision) {
      return pending.promise;
    }
    if (pending) {
      materializePendingRef.current = null;
      pending.resolve(false);
    }
    const key = ++materializeCommitKeyRef.current;
    let resolveMaterialization!: (completed: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolveMaterialization = resolve;
    });
    materializePendingRef.current = {
      key,
      promise,
      resolve: resolveMaterialization,
      revision: repository.context.revision
    };
    materializationPendingRef.current = true;
    materializedOverrideRef.current = true;
    windowCommitPendingRef.current = false;
    const materializeCommit: SafePreviewHtmlSinkMaterializeCommit = {
      key,
      nodes,
      revision: repository.context.revision
    };
    setState((current) =>
      'html' === current.kind
      && 'ready' === current.phase
      && current.htmlRevision === repository.context.revision
        ? {
            ...current,
            materializeCommit,
            stagedCommit: null,
            windowedCommit: null
          }
        : current
    );
    return promise;
  }, [props.onDiagnostic]);
  materializeRef.current = materialize;

  const prepareWindowBlockAdoption = (
    node: HTMLElement
  ): (() => boolean) | null => {
    if (!ownerActiveRef.current || !windowedRef.current) return null;
    const surface = surfaceRef.current;
    const repository = previewWindowRepositoryRef.current;
    const current = stateRef.current;
    if (
      !surface?.isConnected
      || !repository
      || 'html' !== current.kind
      || 'ready' !== current.phase
      || current.generation !== repository.context.revision
      || current.htmlRevision !== repository.context.revision
      || current.signature !== repository.context.signature
      || current.editMap?.signature !== repository.context.signature
      || current.editMap?.blocks.length !== repository.nodes.length
      || generationRef.current !== repository.context.revision
      || materializationPendingRef.current
      || !(node instanceof HTMLElement)
      || node.ownerDocument !== surface.ownerDocument
      || node.parentNode !== surface
      || node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
    ) return null;

    try {
      validatePreviewWindowRepository(repository);
    } catch {
      return null;
    }

    const id = node.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
    if (!id) return null;
    const index = repository.indexById.get(id);
    if (undefined === index) return null;
    const block = repository.blocks[index];
    if (
      !block
      || block.index !== index
      || block.map.id !== id
      || repository.indexById.size !== repository.nodes.length
      || repository.blocks.some(
        (entry) => repository.indexById.get(entry.map.id) !== entry.index
      )
    ) return null;

    const mountedIndices = new Set<number>();
    let previousIndex = -1;
    const expectedChildren = Array.from(surface.children);
    for (const child of Array.from(surface.children)) {
      if (child.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)) continue;
      const childId = child.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
      if (!childId) return null;
      const childIndex = repository.indexById.get(childId);
      if (undefined === childIndex || mountedIndices.has(childIndex)) {
        return null;
      }
      if (childIndex <= previousIndex) return null;
      previousIndex = childIndex;
      mountedIndices.add(childIndex);
      if (child !== node && repository.nodes[childIndex] !== child) {
        return null;
      }
    }
    if (!mountedIndices.has(index)) return null;

    const previousNode = repository.nodes[index];
    if (!previousNode) return null;
    const pendingCommit = windowCommitPendingRef.current
      ? pendingWindowCommitRef.current
      : null;
    const pendingNodeIndex = pendingCommit?.nodes.indexOf(previousNode) ?? -1;
    if (
      windowCommitPendingRef.current
      && (
        !pendingCommit
        || pendingCommit.revision !== repository.context.revision
        || pendingNodeIndex < 0
      )
    ) return null;
    const expectedContext = repository.context;
    return () => {
      if (!ownerActiveRef.current || !windowedRef.current) return false;
      const currentSurface = surfaceRef.current;
      const currentRepository = previewWindowRepositoryRef.current;
      const currentState = stateRef.current;
      if (
        currentSurface !== surface
        || !surface.isConnected
        || currentRepository !== repository
        || 'html' !== currentState.kind
        || 'ready' !== currentState.phase
        || currentState.generation !== expectedContext.revision
        || currentState.htmlRevision !== expectedContext.revision
        || currentState.signature !== expectedContext.signature
        || currentState.editMap?.signature !== expectedContext.signature
        || currentState.editMap?.blocks.length !== repository.nodes.length
        || generationRef.current !== expectedContext.revision
        || repository.context !== expectedContext
        || materializationPendingRef.current
        || (
          pendingCommit
          && pendingWindowCommitRef.current !== pendingCommit
        )
        || node.ownerDocument !== surface.ownerDocument
        || node.parentNode !== surface
        || node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== id
        || node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
        || expectedChildren.length !== surface.children.length
        || expectedChildren.some(
          (expectedChild, childIndex) => surface.children[childIndex] !== expectedChild
        )
      ) return false;

      try {
        validatePreviewWindowRepository(repository);
      } catch {
        return false;
      }

      const currentBlock = repository.blocks[index];
      if (
        !currentBlock
        || currentBlock.index !== index
        || currentBlock.map.id !== id
        || repository.indexById.get(id) !== index
      ) return false;
      if (currentBlock.node === node && repository.nodes[index] === node) {
        return true;
      }
      if (
        currentBlock.node !== previousNode
        || repository.nodes[index] !== previousNode
      ) return false;

      const previousNodes = repository.nodes;
      const previousBlocks = repository.blocks;
      const mutablePendingNodes = pendingCommit?.nodes;
      const previousPendingNode = mutablePendingNodes?.[pendingNodeIndex];
      const nextNodes = [...repository.nodes];
      nextNodes[index] = node;
      const nextBlocks = repository.blocks.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, node } : entry
      );
      repository.nodes = nextNodes;
      repository.blocks = nextBlocks;
      if (mutablePendingNodes) mutablePendingNodes[pendingNodeIndex] = node;
      try {
        validatePreviewWindowRepository(repository);
      } catch {
        repository.nodes = previousNodes;
        repository.blocks = previousBlocks;
        if (mutablePendingNodes && previousPendingNode) {
          mutablePendingNodes[pendingNodeIndex] = previousPendingNode;
        }
        return false;
      }
      return true;
    };
  };
  prepareWindowBlockAdoptionRef.current = prepareWindowBlockAdoption;

  useLayoutEffect(() => {
    const pending = materializePendingRef.current;
    if (!pending) return;
    if (
      'html' === state.kind
      && state.generation === pending.revision
      && state.materializeCommit?.key === pending.key
    ) return;
    materializePendingRef.current = null;
    materializationPendingRef.current = false;
    materializedOverrideRef.current = false;
    pending.resolve(false);
  }, [state]);

  function captureScroll(): void {
    if (surfaceRef.current) {
      scrollSnapshotRef.current = props.scrollPort.capture(
        previewScrollCanvas(surfaceRef.current)
      );
    }
  }

  function publishRequestState(requestState: PreviewRequestState): void {
    const generation = ++generationRef.current;
    captureScroll();
    discardPendingWork();

    if ('loading' === requestState.kind) {
      setState((current) =>
        'html' === current.kind
          ? {
              ...current,
              generation,
              phase: 'loading',
              signature: '',
              materializeCommit: null,
              stagedCommit: null,
              windowedCommit: null,
            }
          : 'paper' === emptyModeRef.current
            ? {
                codeTheme: requestState.request.codeTheme,
                editMap: null,
                features: {},
                generation,
                html: '' as SafePreviewHtml,
                htmlRevision: generation,
                kind: 'html',
                paperPlaceholder: true,
                phase: 'loading',
                signature: '',
                materializeCommit: null,
                stagedCommit: null,
                windowedCommit: null
              }
          : { generation, kind: 'loading' }
      );
      return;
    }
    if ('empty' === requestState.kind) {
      setState(
        'paper' === emptyModeRef.current
          ? {
              codeTheme: requestState.request.codeTheme,
              editMap: null,
              features: {},
              generation,
              // The empty string is the only HTML value that is intrinsically
              // safe without invoking the server renderer.
              html: '' as SafePreviewHtml,
              htmlRevision: generation,
              kind: 'html',
              paperPlaceholder: true,
              phase: 'ready',
              signature: requestState.request.signature,
              materializeCommit: null,
              stagedCommit: null,
              windowedCommit: null
            }
          : { generation, kind: 'empty' }
      );
      return;
    }
    if ('error' === requestState.kind) {
      setState((current) =>
        'paper' === emptyModeRef.current && 'html' === current.kind
          ? {
              ...current,
              generation,
              phase: 'failed',
              signature: '',
              materializeCommit: null,
              stagedCommit: null,
              windowedCommit: null,
              ...(windowedRef.current ? { windowedFailure: true } : {})
            }
          : { generation, kind: 'error' }
      );
      return;
    }
    const activeSurface = surfaceRef.current;
    if (!activeSurface) throw new Error('preview-surface-missing');
    const features = {
      ...requestState.response.features,
      ...props.featureOverrides
    };
    const failCandidate = (error: unknown) => {
      if (!ownerActiveRef.current || generationRef.current !== generation) return;
      props.onDiagnostic?.(previewFailureCode(error));
      setState((current) => {
        const previousHtml = 'html' === current.kind ? current : null;
        return {
          codeTheme: requestState.request.codeTheme,
          editMap: null,
          features,
          generation,
          html: previousHtml?.html ?? ('' as SafePreviewHtml),
          htmlRevision: previousHtml?.htmlRevision ?? 0,
          kind: 'html',
          phase: 'failed',
          signature: '',
          materializeCommit: null,
          stagedCommit: null,
          windowedCommit: null,
          ...(windowedRef.current ? { windowedFailure: true } : {})
        };
      });
    };
    const stageCandidate = () => {
      if (!ownerActiveRef.current || generationRef.current !== generation) return;
      let candidateMarkup: Readonly<{
        sourceNodes: ReadonlyArray<Node>;
        surface: HTMLElement;
      }>;
      try {
        candidateMarkup = createEnhancementCandidate(
          activeSurface,
          requestState.response.html,
          !windowedRef.current,
          requestState.response.preparedMarkup?.sourceNodes
        );
      } catch (error) {
        failCandidate(error);
        return;
      }
      enhancementCandidateRef.current = {
        codeTheme: requestState.request.codeTheme,
        editMap: requestState.response.editMap ?? null,
        features,
        generation,
        serverHtml: requestState.response.html,
        signature: requestState.request.signature,
        sourceNodes: candidateMarkup.sourceNodes,
        surface: candidateMarkup.surface
      };
      setState((current) => {
        const previousHtml = 'html' === current.kind ? current : null;
        return {
          codeTheme: requestState.request.codeTheme,
          editMap: requestState.response.editMap ?? null,
          features,
          generation,
          html: previousHtml?.html ?? ('' as SafePreviewHtml),
          htmlRevision: previousHtml?.htmlRevision ?? 0,
          kind: 'html',
          phase: 'enhancing',
          signature: '',
          materializeCommit: null,
          stagedCommit: null,
          windowedCommit: null,
        };
      });
    };
    if (
      windowedRef.current
      && previewNeedsWindow(requestState.response.editMap ?? null)
    ) {
      const scheduler = props.stagingScheduler
        ?? defaultPreviewSurfaceStagingScheduler(activeSurface.ownerDocument);
      void scheduler.yield().then(stageCandidate, failCandidate);
      return;
    }
    stageCandidate();
  }

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    ownerActiveRef.current = true;
    const session = createPreviewRequestSession({
      initialRevision: props.initialRevision,
      onState: publishRequestState,
      port: props.port
    });
    const runtime = {
      materialize: () => materializeRef.current(),
      prepareWindowBlockAdoption: (node: HTMLElement) =>
        prepareWindowBlockAdoptionRef.current(node),
      session,
      surface
    };
    try {
      props.onReady(runtime);
    } catch (error) {
      ownerActiveRef.current = false;
      session.destroy();
      throw error;
    }
    return () => {
      ownerActiveRef.current = false;
      discardStaging();
      props.onDispose?.(runtime);
      session.destroy();
    };
  }, [discardStaging]);

  useLayoutEffect(() => {
    setState((current) => {
      if ('paper' === props.emptyMode) {
        if ('empty' === current.kind) {
          return {
            codeTheme: props.initial.codeTheme ?? '',
            editMap: props.initial.editMap ?? null,
            features: {},
            generation: current.generation,
            html: '' as SafePreviewHtml,
            htmlRevision: current.generation,
            kind: 'html',
            paperPlaceholder: true,
            phase: 'ready',
            signature: '',
            materializeCommit: null,
            stagedCommit: null,
            windowedCommit: null
          };
        }
        if ('loading' === current.kind) {
          return {
            codeTheme: props.initial.codeTheme ?? '',
            editMap: props.initial.editMap ?? null,
            features: {},
            generation: current.generation,
            html: '' as SafePreviewHtml,
            htmlRevision: current.generation,
            kind: 'html',
            paperPlaceholder: true,
            phase: 'loading',
            signature: '',
            materializeCommit: null,
            stagedCommit: null,
            windowedCommit: null
          };
        }
        return current;
      }
      if ('html' !== current.kind || !current.paperPlaceholder) {
        return current;
      }
      if ('ready' === current.phase) {
        return { generation: current.generation, kind: 'empty' };
      }
      if ('failed' === current.phase) {
        return { generation: current.generation, kind: 'error' };
      }
      return { generation: current.generation, kind: 'loading' };
    });
  }, [props.emptyMode, props.initial.codeTheme]);

  const readyHtml =
    'html' === state.kind && 'ready' === state.phase ? state : null;
  useLayoutEffect(() => {
    if (!readyHtml) return;
    props.onHtmlChange?.(readyHtml.html);
    props.onSnapshotReady?.(
      readyHtml.html,
      readyHtml.signature,
      readyHtml.editMap
    );
  }, [
    readyHtml?.html,
    readyHtml?.htmlRevision,
    readyHtml?.signature,
    props.onHtmlChange,
    props.onSnapshotReady
  ]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const snapshot = scrollSnapshotRef.current;
    if (surface && snapshot) {
      scrollSnapshotRef.current = null;
      props.scrollPort.restore(previewScrollCanvas(surface), snapshot);
    }
  }, [state]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.easymdePreviewSignature = 'html' === state.kind && 'ready' === state.phase ? state.signature : '';
  }, [state]);

  useLayoutEffect(() => {
    props.onStatusChange?.(surfaceStatus(state));
  }, [state, props.onStatusChange]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || 'html' !== state.kind || 'enhancing' !== state.phase) return;
    const generation = state.generation;
    let candidate = enhancementCandidateRef.current;
    if (!candidate && 0 === generation) {
      const candidateMarkup = createEnhancementCandidate(
        surface,
        state.html,
        !windowedRef.current
      );
      candidate = {
        codeTheme: state.codeTheme,
        editMap: state.editMap,
        features: state.features,
        generation,
        serverHtml: state.html,
        signature: state.signature,
        sourceNodes: candidateMarkup.sourceNodes,
        surface: candidateMarkup.surface
      };
      enhancementCandidateRef.current = candidate;
    }
    if (!candidate || candidate.generation !== generation) return;
    const activeCandidate = candidate;
    const candidateSurface = activeCandidate.surface;
    const controller = new AbortController();
    let active = true;
    if (generationRef.current !== generation) return;
    let visualSources: ReadonlyArray<VisualMarkdownSourceMarker> = [];
    let blockMarkers: ReadonlyArray<VisualBlockMarker> = [];
    const isCurrent = () => active && generationRef.current === generation;

    const failEnhancement = (error: unknown) => {
      if (!isCurrent()) return;
      removeVisualMarkdownSourceMarkers(visualSources);
      removePreviewBlockMarkers(blockMarkers);
      candidateSurface.remove();
      props.onDiagnostic?.(previewFailureCode(error));
      enhancementCandidateRef.current = null;
      previewWindowRepositoryRef.current = null;
      setState((current) =>
        'html' === current.kind && current.generation === generation
          ? {
              ...current,
              html: activeCandidate.serverHtml,
              htmlRevision: generation,
              phase: 'failed',
              signature: '',
              materializeCommit: null,
              stagedCommit: null,
              windowedCommit: null,
              ...(windowedRef.current ? { windowedFailure: true } : {})
            }
          : current
      );
    };

    const runEnhancement = async (): Promise<void> => {
      try {
        const scheduler = props.stagingScheduler
          ?? defaultPreviewSurfaceStagingScheduler(
            candidateSurface.ownerDocument
          );
        if (!await populateEnhancementCandidate(
          activeCandidate,
          scheduler,
          isCurrent,
          controller.signal
        )) {
          candidateSurface.remove();
          return;
        }
        if (!isCurrent()) return;
        if (activeCandidate.editMap) {
          const markerCapture = capturePreviewBlockMarkers(
            candidateSurface,
            activeCandidate.editMap,
            scheduler,
            isCurrent,
            controller.signal
          );
          const capturedMarkers = markerCapture instanceof Promise
            ? await markerCapture
            : markerCapture;
          if (!capturedMarkers) {
            candidateSurface.remove();
            return;
          }
          blockMarkers = capturedMarkers;
        }
        visualSources = captureVisualMarkdownSources(candidateSurface);
        await props.enhancementPort.enhance(
          candidateSurface,
          activeCandidate.features,
          isCurrent,
          { codeTheme: activeCandidate.codeTheme, signal: controller.signal }
        );
        if (!isCurrent()) return;
        try {
          if (blockMarkers.length > 0) {
            const annotation = annotateEnhancedPreviewBlocks(
              blockMarkers,
              scheduler,
              isCurrent,
              controller.signal
            );
            const annotated = annotation instanceof Promise
              ? await annotation
              : annotation;
            if (!annotated) {
              candidateSurface.remove();
              return;
            }
          }
          annotateEnhancedVisualSources(visualSources);
        } catch (error) {
          failEnhancement(error);
          return;
        }
        if (
          activeCandidate.sourceNodes.length
            > PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS
          || blockMarkers.length > PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS
        ) {
          await scheduler.yield();
          if (!isCurrent() || controller.signal.aborted) {
            candidateSurface.remove();
            return;
          }
        }
        const largeWindow = windowedRef.current
          && previewNeedsWindow(activeCandidate.editMap);
        const enhancedHtml = largeWindow
          ? activeCandidate.serverHtml
          : candidateSurface.innerHTML as SafePreviewHtml;
        if (largeWindow) {
          await scheduler.yield();
          if (!isCurrent() || controller.signal.aborted) {
            candidateSurface.remove();
            return;
          }
        }
        let repository: PreviewWindowNodeRepository | null = null;
        let windowedCommit: MutablePreviewWindowCommit | null = null;
        let stagedCommit: SafePreviewHtmlSinkCommit | null = null;
        if (windowedRef.current && previewNeedsWindow(activeCandidate.editMap)) {
          if (!activeCandidate.editMap) {
            throw new Error('preview-window-edit-map-missing');
          }
          previewWindowRepositoryRef.current = createPreviewWindowRepository(
            candidateSurface,
            activeCandidate.editMap,
            {
              revision: generation,
              signature: activeCandidate.signature,
              styleEpoch: windowStyleEpochRef.current,
              widthEpoch: windowWidthEpochRef.current
            }
          );
          repository = previewWindowRepositoryRef.current;
          await scheduler.yield();
          if (!isCurrent() || controller.signal.aborted) {
            previewWindowRepositoryRef.current = null;
            candidateSurface.remove();
            return;
          }
          const initialWindow = repository.model.getWindow({
            context: repository.context,
            pinnedIndices: [],
            viewport: viewportForCanvas(previewScrollCanvas(surface))
          });
          windowedCommit = {
            key: ++windowCommitKeyRef.current,
            nodes: [...windowNodes(repository, initialWindow)],
            revision: generation
          };
          windowCommitPendingRef.current = true;
          pendingWindowCommitRef.current = windowedCommit;
        } else {
          stagedCommit = {
            nodes: Array.from(candidateSurface.childNodes),
            revision: generation
          };
        }
        enhancementCandidateRef.current = null;
        committedEnhancementCandidateRef.current = activeCandidate;
        setState((current) =>
          'html' === current.kind && current.generation === generation
            ? {
                ...current,
                html: enhancedHtml,
                htmlRevision: generation,
                phase: 'committing',
                signature: activeCandidate.signature,
                materializeCommit: null,
                stagedCommit,
                windowedCommit,
              }
            : current
        );
      } catch (error) {
        failEnhancement(error);
      }
    };

    void runEnhancement();
    return () => {
      active = false;
      controller.abort();
      removeVisualMarkdownSourceMarkers(visualSources);
      removePreviewBlockMarkers(blockMarkers);
      if (committedEnhancementCandidateRef.current?.generation !== generation) {
        candidateSurface.remove();
      }
    };
  }, [
    state,
    props.enhancementPort,
    props.featureOverrides,
    props.stagingScheduler
  ]);

  const windowedEditing = Boolean(
    props.windowed
    && ('html' !== state.kind || previewNeedsWindow(state.editMap))
  );
  useLayoutEffect(() => {
    if (!windowedEditing) {
      materializedOverrideRef.current = false;
      void materializeRef.current();
      return;
    }
    const surface = surfaceRef.current;
    if (
      !surface
      || 'html' !== state.kind
      || 'ready' !== state.phase
    ) {
      return;
    }
    let repository = previewWindowRepositoryRef.current;
    if (repository && repository.context.revision !== state.generation) {
      previewWindowRepositoryRef.current = null;
      windowCommitPendingRef.current = false;
      repository = null;
    }
    if (!repository) {
      if (!state.editMap) {
        props.onDiagnostic?.('preview-window-edit-map-missing');
        setState((current) =>
          'html' === current.kind && current.generation === state.generation
            ? {
                ...current,
                phase: 'failed',
                signature: '',
                materializeCommit: null,
                stagedCommit: null,
                windowedCommit: null,
                windowedFailure: true
              }
            : current
        );
        return;
      }
      try {
        repository = createPreviewWindowRepository(
          surface,
          state.editMap,
          {
            revision: state.generation,
            signature: state.signature,
            styleEpoch: windowStyleEpochRef.current,
            widthEpoch: windowWidthEpochRef.current
          }
        );
      } catch (error) {
        props.onDiagnostic?.(previewFailureCode(error));
        setState((current) =>
          'html' === current.kind && current.generation === state.generation
            ? {
                ...current,
                phase: 'failed',
                signature: '',
                materializeCommit: null,
                stagedCommit: null,
                windowedCommit: null,
                windowedFailure: true
              }
            : current
        );
        return;
      }
      previewWindowRepositoryRef.current = repository;
    }

    const activeRepository = repository;
    const canvas = previewScrollCanvas(surface);
    const documentRef = surface.ownerDocument;
    const windowRef = documentRef.defaultView;
    let frame: number | null = null;
    let disposed = false;
    if (
      activeRepository.context.styleEpoch !== windowStyleEpochRef.current
      || activeRepository.context.widthEpoch !== windowWidthEpochRef.current
    ) {
      activeRepository.context = activeRepository.model.resetEpochs(
        activeRepository.context,
        {
          styleEpoch: windowStyleEpochRef.current,
          widthEpoch: windowWidthEpochRef.current
        }
      );
    }
    windowWidthRef.current = surface.getBoundingClientRect().width;

    const cancelFrame = () => {
      if (null === frame) return;
      if (windowRef?.cancelAnimationFrame) {
        windowRef.cancelAnimationFrame(frame);
      } else {
        windowRef?.clearTimeout(frame);
      }
      frame = null;
    };

    const pinnedIndices = (): readonly number[] => {
      const pins = new Set<number>();
      const selection = documentRef.getSelection?.();
      const selectionIndex = previewWindowBlockIndexForNode(
        activeRepository,
        surface,
        selection?.anchorNode ?? null
      );
      if (null !== selectionIndex) pins.add(selectionIndex);
      const focusIndex = previewWindowBlockIndexForNode(
        activeRepository,
        surface,
        selection?.focusNode ?? null
      );
      if (null !== focusIndex) pins.add(focusIndex);
      const activeIndex = previewWindowBlockIndexForNode(
        activeRepository,
        surface,
        documentRef.activeElement
      );
      if (null !== activeIndex) pins.add(activeIndex);
      if (
        selection?.isCollapsed
        && selection.anchorNode === surface
        && selection.focusNode === surface
        && selection.anchorOffset === selection.focusOffset
      ) {
        if (0 === selection.anchorOffset) pins.add(0);
        if (
          selection.anchorOffset === surface.childNodes.length
          && activeRepository.nodes.length > 0
        ) {
          pins.add(activeRepository.nodes.length - 1);
        }
      }
      return [...pins].sort((left, right) => left - right);
    };

    const commitWindow = () => {
      frame = null;
      if (
        disposed
        || windowCommitPendingRef.current
        || materializationPendingRef.current
        || materializedOverrideRef.current
      ) return;
      activeRepository.model.assertCurrent(activeRepository.context);
      const mountedIndices: number[] = [];
      for (const child of Array.from(surface.children)) {
        const index = previewWindowBlockIndexForNode(
          activeRepository,
          surface,
          child
        );
        if (null !== index) mountedIndices.push(index);
      }
      const anchorIndex = mountedIndices[0] ?? 0;
      let anchorCorrection = 0;
      for (const index of mountedIndices) {
        const node = activeRepository.nodes[index];
        if (!node) continue;
        const height = node.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) continue;
        const update = activeRepository.model.updateMeasuredHeight({
          anchorIndex,
          context: activeRepository.context,
          index,
          measuredHeight: height
        });
        anchorCorrection += update.anchorCorrection;
      }
      if (0 !== anchorCorrection) canvas.scrollTop += anchorCorrection;
      const result = activeRepository.model.getWindow({
        context: activeRepository.context,
        pinnedIndices: pinnedIndices(),
        viewport: viewportForCanvas(canvas)
      });
      const commit: MutablePreviewWindowCommit = {
        key: ++windowCommitKeyRef.current,
        nodes: [...windowNodes(activeRepository, result)],
        revision: activeRepository.context.revision
      };
      if (
        commit.nodes.length === surface.childNodes.length
        && commit.nodes.every((node, index) => surface.childNodes[index] === node)
      ) {
        props.onWindowReady?.();
        return;
      }
      windowCommitPendingRef.current = true;
      pendingWindowCommitRef.current = commit;
      setState((current) =>
        'html' === current.kind
        && current.generation === activeRepository.context.revision
        && 'ready' === current.phase
          ? { ...current, windowedCommit: commit }
          : current
      );
    };

    const scheduleWindow = () => {
      if (
        disposed
        || null !== frame
        || materializationPendingRef.current
        || materializedOverrideRef.current
      ) return;
      if (windowRef?.requestAnimationFrame) {
        frame = windowRef.requestAnimationFrame(commitWindow);
        return;
      }
      frame = windowRef
        ? windowRef.setTimeout(commitWindow, 0) as unknown as number
        : setTimeout(commitWindow, 0) as unknown as number;
    };

    scheduleWindowRef.current = scheduleWindow;

    const onSelectionChange = () => scheduleWindow();
    const onResize = () => {
      const width = surface.getBoundingClientRect().width;
      const previousWidth = windowWidthRef.current;
      if (
        Number.isFinite(width)
        && width > 0
        && null !== previousWidth
        && Math.abs(width - previousWidth) >= 0.5
      ) {
        windowWidthRef.current = width;
        windowWidthEpochRef.current += 1;
        activeRepository.context = activeRepository.model.resetEpochs(
          activeRepository.context,
          {
            styleEpoch: windowStyleEpochRef.current,
            widthEpoch: windowWidthEpochRef.current
          }
        );
      }
      scheduleWindow();
    };
    const resizeObserverConstructor = windowRef?.ResizeObserver;
    const resizeObserver = resizeObserverConstructor
      ? new resizeObserverConstructor(onResize)
      : null;
    canvas.addEventListener('scroll', scheduleWindow, { passive: true });
    documentRef.addEventListener('selectionchange', onSelectionChange);
    windowRef?.addEventListener('resize', onResize);
    resizeObserver?.observe(canvas);
    resizeObserver?.observe(surface);
    scheduleWindow();

    return () => {
      disposed = true;
      cancelFrame();
      resizeObserver?.disconnect();
      if (scheduleWindowRef.current === scheduleWindow) {
        scheduleWindowRef.current = () => undefined;
      }
      canvas.removeEventListener('scroll', scheduleWindow);
      documentRef.removeEventListener('selectionchange', onSelectionChange);
      windowRef?.removeEventListener('resize', onResize);
    };
  }, [
    state.kind,
    state.generation,
    readyHtml?.editMap,
    readyHtml?.phase,
    readyHtml?.signature,
    windowedEditing,
    materialize,
    props.className,
    props.onDiagnostic,
    props.onWindowReady,
    props.style
  ]);

  useLayoutEffect(() => {
    if (
      'html' !== state.kind
      || 'ready' !== state.phase
      || layoutSyncedGenerationRef.current === state.generation
    ) {
      return;
    }
    const surface = surfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    if (!surface.querySelector('pre > code.hljs')) return;
    layoutSyncedGenerationRef.current = state.generation;
    try {
      props.enhancementPort.syncCodeFrameBackgrounds(surface);
    } catch (error) {
      props.onDiagnostic?.(previewEnhancementFailureCode(error));
    }
  }, [state, props.enhancementPort, props.onDiagnostic]);

  const busy = 'loading' === state.kind || (
    'html' === state.kind
    && ['committing', 'enhancing', 'loading'].includes(state.phase)
  );
  const failed = 'html' === state.kind && 'failed' === state.phase;
  const effectiveContentEditable = props.contentEditable
    && !('html' === state.kind && state.windowedFailure);

  return (
    <SafePreviewHtmlSink
      ariaBusy={busy}
      error={failed}
      html={'html' === state.kind ? state.html : null}
      htmlRevision={'html' === state.kind ? state.htmlRevision : state.generation}
      materializeCommit={'html' === state.kind ? state.materializeCommit : null}
      {...(props.materializeScheduler
        ? { materializeScheduler: props.materializeScheduler }
        : {})}
      onMaterializeComplete={onMaterializeComplete}
      onMaterializeFailure={onMaterializeFailure}
      onStagedCommit={onStagedCommit}
      refreshing={busy}
      surfaceRef={surfaceRef}
      stagedCommit={'html' === state.kind ? state.stagedCommit : null}
      {...('empty' === state.kind
        ? {
            statusClassName: 'easymde-preview-empty',
            statusMessage: props.messages.empty
          }
        : {})}
      {...('error' === state.kind
        ? {
            statusClassName: 'easymde-preview-error',
            statusMessage: props.messages.error
          }
        : {})}
      {...(undefined !== props.contentEditable
        ? { contentEditable: effectiveContentEditable }
        : {})}
      {...(props.label ? { label: props.label } : {})}
      {...(props.role ? { role: props.role } : {})}
      {...(undefined !== props.spellCheck
        ? { spellCheck: props.spellCheck }
        : {})}
      {...(props.className ? { className: props.className } : {})}
      {...(props.style ? { style: props.style } : {})}
      windowedCommit={'html' === state.kind ? state.windowedCommit : null}
    />
  );
}

declare global {
  interface HTMLElement {
    easymdePreviewSignature?: string;
  }
}
