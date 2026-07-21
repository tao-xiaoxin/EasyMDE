import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

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

type PreviewMessages = Readonly<{
  empty: string;
  error: string;
  rendering: string;
}>;

type PreviewHtmlState = Readonly<{
  codeTheme: string;
  features: PreviewFeatures;
  generation: number;
  html: SafePreviewHtml;
  kind: 'html';
  phase: 'enhancing' | 'failed' | 'loading' | 'ready';
  signature: string;
}>;

type PreviewStatusState = Readonly<{
  generation: number;
  kind: 'empty' | 'error' | 'loading';
}>;

type PreviewSurfaceState = PreviewHtmlState | PreviewStatusState;

export type PreviewSurfaceRuntime = Readonly<{
  session: PreviewRequestSession;
  surface: HTMLElement;
}>;

type PreviewSurfaceOwnerProps = Readonly<{
  enhancementPort: PreviewEnhancementPort;
  initial: Readonly<{
    codeTheme?: string;
    features: PreviewFeatures;
    html: SafePreviewHtml;
    signature: string;
  }>;
  initialRevision: number;
  messages: PreviewMessages;
  onDiagnostic?: (code: string) => void;
  onReady: (runtime: PreviewSurfaceRuntime) => void;
  port: PreviewRequestPort;
  scrollPort: PreviewScrollPort;
}>;

function initialState(props: PreviewSurfaceOwnerProps): PreviewSurfaceState {
  if (!props.initial.html.trim()) {
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

export function PreviewSurfaceOwner(props: PreviewSurfaceOwnerProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const scrollSnapshotRef = useRef<PreviewScrollSnapshot | null>(null);
  const generationRef = useRef(0);
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
          : { generation, kind: 'loading' }
      );
      return;
    }
    if ('empty' === requestState.kind || 'error' === requestState.kind) {
      setState({ generation, kind: requestState.kind });
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
    try {
      props.onReady({ session, surface });
    } catch (error) {
      session.destroy();
      throw error;
    }
    return () => session.destroy();
  }, []);

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
    const surface = surfaceRef.current;
    if (!surface || 'html' !== state.kind || 'enhancing' !== state.phase) return;
    const generation = state.generation;
    const controller = new AbortController();
    let active = true;

    if (generationRef.current !== generation) return;
    void props.enhancementPort.enhance(
      surface,
      state.features,
      () => active && generationRef.current === generation,
      { codeTheme: state.codeTheme, signal: controller.signal }
    ).then(
      () => {
        if (!active || generationRef.current !== generation) return;
        setState((current) =>
          'html' === current.kind && current.generation === generation
            ? { ...current, phase: 'ready' }
            : current
        );
      },
      (error) => {
        if (!active || generationRef.current !== generation) return;
        props.onDiagnostic?.(previewEnhancementFailureCode(error));
        setState((current) =>
          'html' === current.kind && current.generation === generation
            ? { ...current, phase: 'failed', signature: '' }
            : current
        );
      }
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [state, props.enhancementPort]);

  useEffect(() => () => props.enhancementPort.dispose?.(), [props.enhancementPort]);

  const busy = 'loading' === state.kind || ('html' === state.kind && ('enhancing' === state.phase || 'loading' === state.phase));
  const failed = 'html' === state.kind && 'failed' === state.phase;

  if ('html' === state.kind) {
    return (
      <article
        aria-busy={busy ? 'true' : 'false'}
        aria-live="polite"
        data-easymde-preview-error={failed ? '1' : undefined}
        data-easymde-preview-html-sink="1"
        data-easymde-preview-refreshing={busy ? '1' : undefined}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: This is the sole sink for PHP-rendered, server-sanitized Preview HTML.
        dangerouslySetInnerHTML={{ __html: state.html }}
        ref={surfaceRef}
      />
    );
  }

  return (
    <article
      aria-busy={busy ? 'true' : 'false'}
      aria-live="polite"
      data-easymde-preview-refreshing={busy ? '1' : undefined}
      ref={surfaceRef}
    >
      {'empty' === state.kind ? (
        <p className="easymde-preview-empty">{props.messages.empty}</p>
      ) : 'error' === state.kind ? (
        <p className="easymde-preview-error">{props.messages.error}</p>
      ) : (
        <p className="easymde-preview-pending" role="status">
          {props.messages.rendering}
        </p>
      )}
    </article>
  );
}

declare global {
  interface HTMLElement {
    easymdePreviewSignature?: string;
  }
}
