import type {
  PreviewCodeProjection,
  PreviewCodeBodyMap,
  PreviewRequest,
  PreviewRequestPort
} from '../../contracts/ports/preview-request';
import {
  findEditorCodeContentTarget,
  readEditorCodeContent,
  type EditorCodeBodyMap,
  type EditorCodeContentReadResult,
  type EditorCodeContentSelection,
  type EditorCodeContentTarget
} from './editor-code-content-target';
import type { EditorMarkdownBlockIndex } from './editor-markdown-block-index';

export const MAX_EDITOR_CODE_CONTENT_QUERY_BYTES = 1_048_576;

export type EditorCodeContentQueryBinding = Readonly<{
  generation: number;
  menuIdentity: object;
  revision?: number;
  selection: EditorCodeContentSelection & Readonly<{ direction?: 'backward' | 'forward' | 'none' }>;
  source: string;
  surface: 'source' | 'visual';
}>;

export type EditorCodeContentQueryState =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'pending' }>
  | Readonly<{
      codeMap: PreviewCodeBodyMap;
      content: string;
      codeProjection?: PreviewCodeProjection;
      requestSignature: string;
      status: 'ready';
      target: EditorCodeContentTarget;
    }>
  | Readonly<{
      code: string;
      status: 'unavailable';
    }>;

export type EditorCodeContentQueryRequestFactory = (input: Readonly<{
  binding: EditorCodeContentQueryBinding;
  markdown: string;
  target: EditorCodeContentTarget;
}>) => PreviewRequest;

export type EditorCodeContentQueryOptions = Readonly<{
  isCurrent: (binding: EditorCodeContentQueryBinding) => boolean;
  notify: () => void;
  onUnavailable?: (binding: EditorCodeContentQueryBinding, code: string) => void;
  previewPort: PreviewRequestPort;
  requestFactory: EditorCodeContentQueryRequestFactory;
}>;

export type EditorCodeContentQuerySession = Readonly<{
  cancel: (binding?: EditorCodeContentQueryBinding) => void;
  dispose: () => void;
  ensure: (input: Readonly<{
    binding: EditorCodeContentQueryBinding;
    blockIndex?: EditorMarkdownBlockIndex | null;
  }>) => EditorCodeContentQueryState;
  peek: (binding: EditorCodeContentQueryBinding) => EditorCodeContentQueryState;
  readiness: (binding: EditorCodeContentQueryBinding) => EditorCodeContentQueryState;
  subscribe: (listener: () => void) => () => void;
}>;

/**
 * Code-content discovery is an optional context for the shared menu. An
 * ambiguous selection cannot safely expose code-only actions, but it must not
 * block generic Clipboard/formatting actions for the same selection.
 */
export function editorCodeContentReadinessBlocksMenu(
  state: EditorCodeContentQueryState
): state is Extract<EditorCodeContentQueryState, { status: 'pending' | 'unavailable' }> {
  return state.status === 'pending'
    || (
      state.status === 'unavailable'
      && state.code !== 'editor-code-content-selection-ambiguous'
    );
}

type ActiveQuery = {
  binding: EditorCodeContentQueryBinding;
  blockIndex?: EditorMarkdownBlockIndex;
  controller: AbortController;
  state: EditorCodeContentQueryState;
  target: EditorCodeContentTarget | null;
  waitingForBlockIndex: boolean;
};

function sameSelection(
  left: EditorCodeContentQueryBinding['selection'],
  right: EditorCodeContentQueryBinding['selection']
): boolean {
  return left.start === right.start
    && left.end === right.end
    && left.direction === right.direction;
}

function sameBinding(
  left: EditorCodeContentQueryBinding,
  right: EditorCodeContentQueryBinding
): boolean {
  return left.generation === right.generation
    && Object.is(left.menuIdentity, right.menuIdentity)
    && Object.is(left.revision, right.revision)
    && left.source === right.source
    && left.surface === right.surface
    && sameSelection(left.selection, right.selection);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) index += 1;
    bytes += codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function unavailable(code: string): EditorCodeContentQueryState {
  return { code, status: 'unavailable' };
}

function rebaseCodeMap(
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

function currentBodyMap(
  source: string,
  signature: string,
  codeMap: PreviewCodeBodyMap,
  target: EditorCodeContentTarget
): EditorCodeBodyMap {
  return {
    codeMap: rebaseCodeMap(codeMap, target.ownerLineStart),
    signature,
    source
  };
}

function rebaseCodeProjection(
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

export function createEditorCodeContentQuery({
  isCurrent,
  notify,
  onUnavailable,
  previewPort,
  requestFactory
}: EditorCodeContentQueryOptions): EditorCodeContentQuerySession {
  let active: ActiveQuery | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (): void => {
    if (disposed) return;
    for (const listener of listeners) listener();
    notify();
  };

  const publishUnavailable = (
    query: ActiveQuery,
    code: string
  ): void => {
    query.state = unavailable(code);
    onUnavailable?.(query.binding, code);
    publish();
  };

  const clearActive = (candidate: ActiveQuery): void => {
    if (active !== candidate) return;
    candidate.controller.abort();
    active = null;
  };

  const currentAndLive = (candidate: ActiveQuery): boolean =>
    !disposed
    && active === candidate
    && !candidate.controller.signal.aborted
    && isCurrent(candidate.binding);

  const run = async (
    query: ActiveQuery,
    markdown: string
  ): Promise<void> => {
    let request: PreviewRequest;
    try {
      request = requestFactory({
        binding: query.binding,
        markdown,
        target: query.target as EditorCodeContentTarget
      });
    } catch {
      if (!currentAndLive(query)) return;
      publishUnavailable(query, 'editor-code-content-request-failed');
      return;
    }
    if (request.markdown !== markdown || !request.signature) {
      if (!currentAndLive(query)) return;
      publishUnavailable(query, 'editor-code-content-request-invalid');
      return;
    }

    let response: Awaited<ReturnType<PreviewRequestPort['render']>>;
    try {
      response = await previewPort.render(request, query.controller.signal);
    } catch {
      if (!currentAndLive(query)) return;
      publishUnavailable(query, 'editor-code-content-query-failed');
      return;
    }
    if (!currentAndLive(query)) {
      clearActive(query);
      return;
    }
    if (!response.codeMap) {
      publishUnavailable(query, 'editor-code-content-map-unavailable');
      return;
    }
    if (response.codeMap.signature !== request.signature) {
      publishUnavailable(query, 'editor-code-content-map-stale');
      return;
    }
    const read: EditorCodeContentReadResult = readEditorCodeContent(
      query.binding.source,
      query.binding.selection,
      query.blockIndex,
      currentBodyMap(
        query.binding.source,
        request.signature,
        response.codeMap,
        query.target as EditorCodeContentTarget
      )
    );
    if ('unavailable' === read.status) {
      publishUnavailable(query, read.code);
      return;
    }
    query.state = {
      codeMap: currentBodyMap(
        query.binding.source,
        request.signature,
        response.codeMap,
        query.target as EditorCodeContentTarget
      ).codeMap,
      content: read.content,
      ...(response.codeProjection
        && response.codeProjection.signature === request.signature
        ? {
            codeProjection: rebaseCodeProjection(
              response.codeProjection,
              (query.target as EditorCodeContentTarget).ownerLineStart
            )
          }
        : {}),
      requestSignature: request.signature,
      status: 'ready',
      target: read.target
    };
    publish();
  };

  const ensure: EditorCodeContentQuerySession['ensure'] = ({
    binding,
    blockIndex
  }) => {
    if (disposed) return unavailable('editor-code-content-query-disposed');
    if (
      active
      && sameBinding(active.binding, binding)
      && !(active.waitingForBlockIndex && null !== blockIndex && undefined !== blockIndex)
    ) return active.state;
    if (active) clearActive(active);
    if (null === blockIndex) {
      active = {
        binding,
        controller: new AbortController(),
        state: { status: 'pending' },
        target: null,
        waitingForBlockIndex: true
      };
      return active.state;
    }

    const targetResult = findEditorCodeContentTarget(
      binding.source,
      binding.selection,
      blockIndex
    );
    if (
      'unavailable' === targetResult.status
      || binding.selection.start < targetResult.target.from
      || binding.selection.end > targetResult.target.to
    ) {
      // Mixed coverage has no single code context. Classify it before asking
      // the renderer so an unrelated code read cannot gate the generic menu.
      const state = 'available' === targetResult.status
        || 'editor-code-content-selection-not-code' === targetResult.code
        || 'editor-code-content-selection-ambiguous' === targetResult.code
        ? { status: 'none' as const }
        : unavailable(targetResult.code);
      active = {
        binding,
        ...(undefined === blockIndex ? {} : { blockIndex }),
        controller: new AbortController(),
        state,
        target: null,
        waitingForBlockIndex: false
      };
      return state;
    }

    const markdown = binding.source.slice(
      targetResult.target.ownerFrom,
      targetResult.target.ownerEnd
    );
    if (utf8ByteLength(markdown) > MAX_EDITOR_CODE_CONTENT_QUERY_BYTES) {
      const state = unavailable('editor-code-content-query-too-large');
      active = {
        binding,
        ...(undefined === blockIndex ? {} : { blockIndex }),
        controller: new AbortController(),
        state,
        target: targetResult.target,
        waitingForBlockIndex: false
      };
      return state;
    }
    const query: ActiveQuery = {
      binding,
      ...(undefined === blockIndex ? {} : { blockIndex }),
      controller: new AbortController(),
      state: { status: 'pending' },
      target: targetResult.target,
      waitingForBlockIndex: false
    };
    active = query;
    void run(query, markdown);
    return query.state;
  };

  return {
    cancel(binding) {
      if (!active || (binding && !sameBinding(active.binding, binding))) return;
      clearActive(active);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) clearActive(active);
      listeners.clear();
    },
    ensure,
    peek(binding) {
      return active && sameBinding(active.binding, binding)
        ? active.state
        : { status: 'none' };
    },
    readiness(binding) {
      return active && sameBinding(active.binding, binding)
        ? active.state
        : { status: 'none' };
    },
    subscribe(listener) {
      if (disposed) throw new Error('editor-code-content-query-disposed');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
