import { createElement, createRoot } from '@wordpress/element';

import { PreviewSessionErrorBoundary } from '../app/editor/PreviewSessionErrorBoundary';
import type {
  PreviewFeatures,
  SafePreviewHtml
} from '../contracts/ports/preview-request';
import { isPreviewFeatureKey } from '../contracts/ports/preview-request';
import type { PreviewEnhancementPort } from '../features/live-preview/ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../features/live-preview/ports/preview-scroll-port';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceRuntime
} from '../features/live-preview/ui/PreviewSurfaceOwner';
import {
  createWordPressPreviewPort,
  type WordPressApiFetch
} from '../integrations/wordpress/preview/create-wordpress-preview-port';

type PreviewSessionBootstrap = Readonly<{ nonce: string; restUrl: string }>;
type PreviewSessionMountOptions = Readonly<{
  container: HTMLElement;
  enhancementPort: PreviewEnhancementPort;
  initial: Readonly<{
    features: PreviewFeatures;
    html: SafePreviewHtml;
    signature: string;
  }>;
  initialRevision: number;
  messages: Readonly<{
    empty: string;
    error: string;
    rendering: string;
  }>;
  onFailure: () => void;
  onReady: (runtime: PreviewSurfaceRuntime) => void;
  scrollPort: PreviewScrollPort;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && 'object' === typeof value && !Array.isArray(value);
}

function parseFeatures(value: unknown): PreviewFeatures {
  if (!isRecord(value)) throw new Error('preview-mount-options-invalid');
  const features: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!isPreviewFeatureKey(key) || 'boolean' !== typeof enabled) {
      throw new Error('preview-mount-options-invalid');
    }
    features[key] = enabled;
  }
  return features;
}

function parseMountOptions(value: unknown): PreviewSessionMountOptions {
  if (!isRecord(value)) throw new Error('preview-mount-options-invalid');
  if (!(value.container instanceof HTMLElement) || value.container.childNodes.length) {
    throw new Error('preview-container-invalid');
  }
  if (!isRecord(value.initial) || !isRecord(value.messages)) {
    throw new Error('preview-mount-options-invalid');
  }
  if (
    'string' !== typeof value.initial.html ||
    'string' !== typeof value.initial.signature ||
    !Number.isInteger(value.initialRevision) ||
    Number(value.initialRevision) < 0 ||
    'string' !== typeof value.messages.empty ||
    !value.messages.empty ||
    'string' !== typeof value.messages.error ||
    !value.messages.error ||
    'string' !== typeof value.messages.rendering ||
    !value.messages.rendering ||
    'function' !== typeof value.onFailure ||
    'function' !== typeof value.onReady ||
    !isRecord(value.enhancementPort) ||
    'function' !== typeof value.enhancementPort.enhance ||
    !isRecord(value.scrollPort) ||
    'function' !== typeof value.scrollPort.capture ||
    'function' !== typeof value.scrollPort.restore
  ) {
    throw new Error('preview-mount-options-invalid');
  }

  return {
    container: value.container,
    enhancementPort: value.enhancementPort as PreviewEnhancementPort,
    initial: {
      features: parseFeatures(value.initial.features),
      // The legacy owner reads this HTML from the PHP-rendered, sanitized Preview article.
      html: value.initial.html as SafePreviewHtml,
      signature: value.initial.signature
    },
    initialRevision: Number(value.initialRevision),
    messages: {
      empty: value.messages.empty,
      error: value.messages.error,
      rendering: value.messages.rendering
    },
    onFailure: value.onFailure as () => void,
    onReady: value.onReady as (runtime: PreviewSurfaceRuntime) => void,
    scrollPort: value.scrollPort as PreviewScrollPort
  };
}

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
    mount(value: unknown): () => void {
      const options = parseMountOptions(value);
      const root = createRoot(options.container);
      let active = true;
      root.render(
        <PreviewSessionErrorBoundary onFailure={options.onFailure}>
          <PreviewSurfaceOwner {...options} port={port} />
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
