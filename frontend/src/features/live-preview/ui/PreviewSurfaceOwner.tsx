import {
  createElement,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { CSSProperties } from 'react';

import type {
  PreviewFeatures,
  PreviewRequestPort,
  PreviewRequestState,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import {
  createPreviewRequestSession,
  type PreviewRequestSession
} from '../model/create-preview-request-session';
import {
  previewEnhancementFailureCode,
  type PreviewEnhancementPort
} from '../ports/preview-enhancement-port';
import type { PreviewScrollPort, PreviewScrollSnapshot } from '../ports/preview-scroll-port';
import { SafePreviewHtmlSink } from './SafePreviewHtmlSink';

type PreviewMessages = Readonly<{
  empty: string;
  error: string;
}>;

type PreviewHtmlState = Readonly<{
  codeTheme: string;
  features: PreviewFeatures;
  generation: number;
  html: SafePreviewHtml;
  kind: 'html';
  paperPlaceholder?: true;
  phase: 'enhancing' | 'failed' | 'loading' | 'ready';
  signature: string;
}>;

type PreviewStatusState = Readonly<{
  generation: number;
  kind: 'empty' | 'error' | 'loading';
}>;

type PreviewSurfaceState = PreviewHtmlState | PreviewStatusState;

export type PreviewSurfaceStatus = 'empty' | 'error' | 'loading' | 'ready';

const VISUAL_MARKDOWN_SOURCE_ATTRIBUTE =
  'data-easymde-visual-markdown-source';

export type PreviewSurfaceRuntime = Readonly<{
  session: PreviewRequestSession;
  surface: HTMLElement;
}>;

type PreviewSurfaceOwnerProps = Readonly<{
  className?: string;
  contentEditable?: boolean;
  emptyMode?: 'message' | 'paper';
  enhancementPort: PreviewEnhancementPort;
  initial: Readonly<{
    codeTheme?: string;
    features: PreviewFeatures;
    html: SafePreviewHtml;
    signature: string;
  }>;
  initialRevision: number;
  label?: string;
  messages: PreviewMessages;
  onDiagnostic?: (code: string) => void;
  onHtmlChange?: (html: SafePreviewHtml) => void;
  onSnapshotReady?: (html: SafePreviewHtml, signature: string) => void;
  onDispose?: (runtime: PreviewSurfaceRuntime) => void;
  onReady: (runtime: PreviewSurfaceRuntime) => void;
  onStatusChange?: (status: PreviewSurfaceStatus) => void;
  port: PreviewRequestPort;
  scrollPort: PreviewScrollPort;
  role?: string;
  spellCheck?: boolean;
  style?: CSSProperties;
}>;

function initialState(props: PreviewSurfaceOwnerProps): PreviewSurfaceState {
  if (!props.initial.html.trim()) {
    if ('paper' === props.emptyMode) {
      return {
        codeTheme: props.initial.codeTheme ?? '',
        features: props.initial.features,
        generation: 0,
        html: props.initial.html,
        kind: 'html',
        paperPlaceholder: true,
        phase: 'enhancing',
        signature: props.initial.signature
      };
    }
    return { generation: 0, kind: 'loading' };
  }
  return {
    codeTheme: props.initial.codeTheme ?? '',
    features: props.initial.features,
    generation: 0,
    html: props.initial.html,
    kind: 'html',
    phase: 'enhancing',
    signature: props.initial.signature
  };
}

function surfaceStatus(state: PreviewSurfaceState): PreviewSurfaceStatus {
  if ('html' !== state.kind) {
    return state.kind;
  }
  return 'ready' === state.phase ? 'ready' : 'failed' === state.phase ? 'error' : 'loading';
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
  const emptyModeRef = useRef(props.emptyMode);
  emptyModeRef.current = props.emptyMode;
  const [state, setState] = useState<PreviewSurfaceState>(() => initialState(props));

  function captureScroll(): void {
    if (surfaceRef.current) {
      scrollSnapshotRef.current = props.scrollPort.capture(surfaceRef.current);
    }
  }

  function publishRequestState(requestState: PreviewRequestState): void {
    const generation = ++generationRef.current;
    captureScroll();

    if ('loading' === requestState.kind) {
      setState((current) =>
        'html' === current.kind
          ? { ...current, generation, phase: 'loading', signature: '' }
          : 'paper' === emptyModeRef.current
            ? {
                codeTheme: requestState.request.codeTheme,
                features: {},
                generation,
                html: '' as SafePreviewHtml,
                kind: 'html',
                paperPlaceholder: true,
                phase: 'loading',
                signature: ''
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
              features: {},
              generation,
              // The empty string is the only HTML value that is intrinsically
              // safe without invoking the server renderer.
              html: '' as SafePreviewHtml,
              kind: 'html',
              paperPlaceholder: true,
              phase: 'ready',
              signature: requestState.request.signature
            }
          : { generation, kind: 'empty' }
      );
      return;
    }
    if ('error' === requestState.kind) {
      setState((current) =>
        'paper' === emptyModeRef.current && 'html' === current.kind
          ? { ...current, generation, phase: 'failed', signature: '' }
          : { generation, kind: 'error' }
      );
      return;
    }
    setState({
      codeTheme: requestState.request.codeTheme,
      features: requestState.response.features,
      generation,
      html: requestState.response.html,
      kind: 'html',
      phase: 'enhancing',
      signature: requestState.request.signature
    });
  }

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    const session = createPreviewRequestSession({
      initialRevision: props.initialRevision,
      onState: publishRequestState,
      port: props.port
    });
    const runtime = { session, surface };
    try {
      props.onReady(runtime);
    } catch (error) {
      session.destroy();
      throw error;
    }
    return () => {
      props.onDispose?.(runtime);
      session.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    setState((current) => {
      if ('paper' === props.emptyMode) {
        if ('empty' === current.kind) {
          return {
            codeTheme: props.initial.codeTheme ?? '',
            features: {},
            generation: current.generation,
            html: '' as SafePreviewHtml,
            kind: 'html',
            paperPlaceholder: true,
            phase: 'ready',
            signature: ''
          };
        }
        if ('loading' === current.kind) {
          return {
            codeTheme: props.initial.codeTheme ?? '',
            features: {},
            generation: current.generation,
            html: '' as SafePreviewHtml,
            kind: 'html',
            paperPlaceholder: true,
            phase: 'loading',
            signature: ''
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

  useLayoutEffect(() => {
    if (
      'html' === state.kind
      && 'ready' === state.phase
    ) {
      const surface = surfaceRef.current;
      if (!surface) throw new Error('preview-surface-missing');
      const html = surface.innerHTML as SafePreviewHtml;
      props.onHtmlChange?.(html);
      props.onSnapshotReady?.(html, state.signature);
    }
  }, [state, props.onHtmlChange, props.onSnapshotReady]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const snapshot = scrollSnapshotRef.current;
    if (surface && snapshot) {
      scrollSnapshotRef.current = null;
      props.scrollPort.restore(surface, snapshot);
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
    const controller = new AbortController();
    let active = true;
    if (generationRef.current !== generation) return;
    const visualSources = captureVisualMarkdownSources(surface);

    const failEnhancement = (error: unknown) => {
      if (!active || generationRef.current !== generation) return;
      removeVisualMarkdownSourceMarkers(visualSources);
      props.onDiagnostic?.(previewEnhancementFailureCode(error));
      setState((current) =>
        'html' === current.kind && current.generation === generation
          ? { ...current, phase: 'failed', signature: '' }
          : current
      );
    };

    void props.enhancementPort.enhance(
      surface,
      state.features,
      () => active && generationRef.current === generation,
      { codeTheme: state.codeTheme, signal: controller.signal }
    ).then(
      () => {
        if (!active || generationRef.current !== generation) return;
        try {
          annotateEnhancedVisualSources(visualSources);
        } catch (error) {
          failEnhancement(error);
          return;
        }
        setState((current) =>
          'html' === current.kind && current.generation === generation
            ? { ...current, phase: 'ready' }
            : current
        );
      },
      failEnhancement
    );
    return () => {
      active = false;
      controller.abort();
      removeVisualMarkdownSourceMarkers(visualSources);
    };
  }, [state, props.enhancementPort]);

  const busy = 'loading' === state.kind || ('html' === state.kind && ('enhancing' === state.phase || 'loading' === state.phase));
  const failed = 'html' === state.kind && 'failed' === state.phase;

  return (
    <SafePreviewHtmlSink
      ariaBusy={busy}
      error={failed}
      html={'html' === state.kind ? state.html : null}
      refreshing={busy}
      surfaceRef={surfaceRef}
      {...(undefined !== props.contentEditable
        ? { contentEditable: props.contentEditable }
        : {})}
      {...(props.label ? { label: props.label } : {})}
      {...(props.role ? { role: props.role } : {})}
      {...(undefined !== props.spellCheck
        ? { spellCheck: props.spellCheck }
        : {})}
      {...(props.className ? { className: props.className } : {})}
      {...(props.style ? { style: props.style } : {})}
    >
      {'html' !== state.kind && 'empty' === state.kind ? (
        <p className="easymde-preview-empty">{props.messages.empty}</p>
      ) : 'html' !== state.kind && 'error' === state.kind ? (
        <p className="easymde-preview-error">{props.messages.error}</p>
      ) : null}
    </SafePreviewHtmlSink>
  );
}

declare global {
  interface HTMLElement {
    easymdePreviewSignature?: string;
  }
}
