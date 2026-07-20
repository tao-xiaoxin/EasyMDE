import { createElement, createRoot } from '@wordpress/element';

import { PreviewSessionErrorBoundary } from '../app/editor/PreviewSessionErrorBoundary';
import type { PreviewRequestState } from '../contracts/ports/preview-request';
import type { PreviewRequestSession } from '../features/live-preview/model/create-preview-request-session';
import { PreviewRequestSessionOwner } from '../features/live-preview/ui/PreviewRequestSessionOwner';
import {
  createWordPressPreviewPort,
  type WordPressApiFetch
} from '../integrations/wordpress/preview/create-wordpress-preview-port';

type PreviewSessionBootstrap = Readonly<{ nonce: string; restUrl: string }>;
type PreviewSessionMountOptions = Readonly<{
  container: HTMLElement;
  initialRevision: number;
  onFailure: () => void;
  onReady: (session: PreviewRequestSession) => void;
  onState: (state: PreviewRequestState) => void;
}>;

function parseBootstrap(value: unknown): PreviewSessionBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('preview-bootstrap-invalid');
  }
  const config = value as Record<string, unknown>;
  if ('string' !== typeof config.restUrl || !config.restUrl || 'string' !== typeof config.nonce || !config.nonce) {
    throw new Error('preview-bootstrap-invalid');
  }
  return { restUrl: config.restUrl, nonce: config.nonce };
}

export function createAdminEditorPreviewSessionBridge(
  value: unknown,
  apiFetch: WordPressApiFetch
) {
  const config = parseBootstrap(value);
  const port = createWordPressPreviewPort(apiFetch, config.restUrl, config.nonce);

  return {
    mount(options: PreviewSessionMountOptions): () => void {
      if (!(options.container instanceof HTMLElement) || options.container.childNodes.length) {
        throw new Error('preview-container-invalid');
      }
      const root = createRoot(options.container);
      let active = true;
      root.render(
        <PreviewSessionErrorBoundary onFailure={options.onFailure}>
          <PreviewRequestSessionOwner {...options} port={port} />
        </PreviewSessionErrorBoundary>
      );
      return () => {
        if (!active) return;
        active = false;
        root.unmount();
      };
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactPreviewSession?: Readonly<{
      prepare: (value: unknown) => ReturnType<typeof createAdminEditorPreviewSessionBridge>;
    }>;
    wp?: { apiFetch?: WordPressApiFetch };
  }
}

window.EasyMDEReactPreviewSession = {
  prepare(value: unknown) {
    if (!window.wp?.apiFetch) throw new Error('preview-transport-unavailable');
    return createAdminEditorPreviewSessionBridge(value, window.wp.apiFetch);
  }
};
