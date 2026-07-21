import type { RevisionsPort, RevisionSummary } from '../../../contracts/ports/revisions-port';
import type { PreviewFeatures, SafePreviewHtml } from '../../../contracts/ports/preview-request';
import { isPreviewFeatureKey } from '../../../contracts/ports/preview-request';
import type { WordPressApiFetch } from '../preview/create-wordpress-preview-port';

type RevisionsPortOptions = Readonly<{
  apiFetch: WordPressApiFetch;
  confirmNavigation: () => boolean;
  listUrl: string;
  navigate: (url: string) => void;
  nonce: string;
  revisionAdminUrl: string;
  siteUrl: string;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('revisions-response-invalid');
  }
  return value as Record<string, unknown>;
}

function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error('revisions-response-invalid');
  }
  return Number(value);
}

function endpoint(value: string, siteUrl: string, code: string): URL {
  let parsed: URL;
  let site: URL;
  try {
    parsed = new URL(value, siteUrl);
    site = new URL(siteUrl);
  } catch {
    throw new Error(code);
  }
  if (
    parsed.origin !== site.origin
    || parsed.username
    || parsed.password
    || parsed.hash
    || !/^https?:$/.test(parsed.protocol)
  ) {
    throw new Error(code);
  }
  return parsed;
}

function revisionDetailUrl(listUrl: URL, revisionId: number): string {
  const target = new URL(listUrl);
  const restRoute = target.searchParams.get('rest_route');
  if (null !== restRoute) {
    target.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}/${revisionId}`);
  } else {
    target.pathname = `${target.pathname.replace(/\/$/, '')}/${revisionId}`;
  }
  return target.toString();
}

function parseSummary(value: unknown): RevisionSummary {
  const source = record(value);
  if (
    'string' !== typeof source.date
    || source.date.length > 64
    || Number.isNaN(Date.parse(source.date))
    || 'string' !== typeof source.date_label
    || !source.date_label.trim()
    || source.date_label.length > 512
    || 'string' !== typeof source.title
    || source.title.length > 4096
    || ('auto' !== source.type && 'manual' !== source.type)
  ) {
    throw new Error('revisions-response-invalid');
  }
  return {
    date: source.date,
    dateLabel: source.date_label,
    id: positiveId(source.id),
    title: source.title,
    type: source.type
  };
}

function parseFeatures(value: unknown): PreviewFeatures {
  const source = record(value);
  const features: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(source)) {
    if (!isPreviewFeatureKey(key) || 'boolean' !== typeof enabled) {
      throw new Error('revisions-response-invalid');
    }
    features[key] = enabled;
  }
  return features;
}

export function createWordPressRevisionsPort(options: RevisionsPortOptions): RevisionsPort {
  if ('function' !== typeof options.apiFetch || 'function' !== typeof options.confirmNavigation || 'function' !== typeof options.navigate || !options.nonce) {
    throw new Error('revisions-transport-unavailable');
  }
  const listUrl = endpoint(options.listUrl, options.siteUrl, 'revisions-list-url-invalid');
  const revisionAdminUrl = endpoint(options.revisionAdminUrl, options.siteUrl, 'revisions-admin-url-invalid');

  return {
    confirmNavigation: options.confirmNavigation,
    async getRevision(revisionId, signal) {
      const id = positiveId(revisionId);
      const response = record(await options.apiFetch({
        headers: { 'X-WP-Nonce': options.nonce },
        method: 'GET',
        signal,
        url: revisionDetailUrl(listUrl, id)
      }));
      if ('string' !== typeof response.html) throw new Error('revisions-response-invalid');
      const responseId = positiveId(response.id);
      if (responseId !== id) throw new Error('revisions-response-invalid');
      return {
        features: parseFeatures(response.features),
        html: response.html as SafePreviewHtml,
        id: responseId
      };
    },
    async listRevisions(signal) {
      const response = record(await options.apiFetch({
        headers: { 'X-WP-Nonce': options.nonce },
        method: 'GET',
        signal,
        url: listUrl.toString()
      }));
      if (!Array.isArray(response.revisions) || response.revisions.length > 50) {
        throw new Error('revisions-response-invalid');
      }
      const seen = new Set<number>();
      return response.revisions.map((value) => {
        const revision = parseSummary(value);
        if (seen.has(revision.id)) throw new Error('revisions-response-invalid');
        seen.add(revision.id);
        return revision;
      });
    },
    openRevision(revisionId) {
      const target = new URL(revisionAdminUrl);
      target.searchParams.set('revision', String(positiveId(revisionId)));
      options.navigate(target.toString());
    }
  };
}
