import type {
  PreviewRequest,
  PreviewRequestPort,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import { isPreviewFeatureKey } from '../../../contracts/ports/preview-request';

export type WordPressApiFetch = (options: Readonly<Record<string, unknown>>) => Promise<unknown>;

export class PreviewResponseError extends Error {
  public constructor() {
    super('preview-response-invalid');
    this.name = 'PreviewResponseError';
  }
}

function parseResponse(value: unknown): PreviewResponse {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new PreviewResponseError();
  }

  const response = value as Record<string, unknown>;
  if ('string' !== typeof response.html || !response.features || 'object' !== typeof response.features || Array.isArray(response.features)) {
    throw new PreviewResponseError();
  }

  const features: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(response.features)) {
    if (!isPreviewFeatureKey(key) || 'boolean' !== typeof enabled) {
      throw new PreviewResponseError();
    }
    features[key] = enabled;
  }

  // The protected Preview route returns only PHP-rendered, server-sanitized HTML.
  return { html: response.html as SafePreviewHtml, features };
}

export function createWordPressPreviewPort(
  apiFetch: WordPressApiFetch,
  restUrl: string,
  nonce: string
): PreviewRequestPort {
  if ('function' !== typeof apiFetch || !restUrl || !nonce) {
    throw new Error('preview-transport-unavailable');
  }

  return {
    async render(request: PreviewRequest, signal: AbortSignal): Promise<PreviewResponse> {
      const response = await apiFetch({
        url: restUrl,
        method: 'POST',
        headers: { 'X-WP-Nonce': nonce },
        data: {
          markdown: request.markdown,
          post_id: request.postId,
          markdown_theme: request.markdownTheme,
          code_theme: request.codeTheme,
          custom_css_id: request.customCssId
        },
        signal
      });

      return parseResponse(response);
    }
  };
}
