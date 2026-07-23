import type {
  RevisionPort,
  RevisionPreview,
  RevisionSummary
} from '../../../contracts/ports/revision-port';
import {
  isPreviewFeatureKey,
  type SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import type { WordPressApiFetch } from '../preview/create-wordpress-preview-port';
import { wordpressEndpoint } from '../shared/wordpress-endpoint';

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value))
    throw new Error(code);
  return value as Record<string, unknown>;
}

function summary(value: unknown, siteUrl: string): RevisionSummary {
  const item = record(value, 'revision-list-response-invalid');
  if (
    !Number.isSafeInteger(item.id) ||
    Number(item.id) <= 0 ||
    'string' !== typeof item.title ||
    'string' !== typeof item.date ||
    'string' !== typeof item.date_label ||
    'string' !== typeof item.restore_url ||
    !['auto', 'manual'].includes(String(item.type))
  )
    throw new Error('revision-list-response-invalid');
  const restoreUrl = wordpressEndpoint(
    item.restore_url,
    siteUrl,
    'revision-restore-url-invalid'
  ).toString();
  return {
    date: item.date,
    dateLabel: item.date_label,
    id: Number(item.id),
    restoreUrl,
    title: item.title,
    type: item.type as RevisionSummary['type']
  };
}

function preview(value: unknown): RevisionPreview {
  const item = record(value, 'revision-preview-response-invalid');
  const featuresValue = record(
    item.features,
    'revision-preview-response-invalid'
  );
  if (
    !Number.isSafeInteger(item.id) ||
    Number(item.id) <= 0 ||
    'string' !== typeof item.html
  ) {
    throw new Error('revision-preview-response-invalid');
  }
  const features: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(featuresValue)) {
    if (!isPreviewFeatureKey(key) || 'boolean' !== typeof enabled) {
      throw new Error('revision-preview-response-invalid');
    }
    features[key] = enabled;
  }
  return { features, html: item.html as SafePreviewHtml, id: Number(item.id) };
}

export function createWordPressRevisionPort(
  options: Readonly<{
    apiFetch: WordPressApiFetch;
    baseUrl: string;
    nonce: string;
    postId: number;
    siteUrl: string;
  }>
): RevisionPort {
  if (
    'function' !== typeof options.apiFetch ||
    !options.nonce ||
    !Number.isSafeInteger(options.postId) ||
    options.postId <= 0
  ) {
    throw new Error('revision-transport-unavailable');
  }
  const base = wordpressEndpoint(
    options.baseUrl,
    options.siteUrl,
    'revision-url-invalid'
  );
  if (!base.pathname.endsWith('/')) throw new Error('revision-url-invalid');
  const endpoint = wordpressEndpoint(
    `${base.toString()}${options.postId}/revisions`,
    options.siteUrl,
    'revision-url-invalid'
  ).toString();
  const request = (url: string, signal: AbortSignal) =>
    options.apiFetch({
      headers: { 'X-WP-Nonce': options.nonce },
      method: 'GET',
      signal,
      url
    });

  return {
    async get(revisionId, signal) {
      if (!Number.isSafeInteger(revisionId) || revisionId <= 0)
        throw new Error('revision-id-invalid');
      return preview(await request(`${endpoint}/${revisionId}`, signal));
    },
    async list(signal) {
      const response = record(
        await request(endpoint, signal),
        'revision-list-response-invalid'
      );
      if (!Array.isArray(response.revisions))
        throw new Error('revision-list-response-invalid');
      return response.revisions.map((item) => summary(item, options.siteUrl));
    }
  };
}
