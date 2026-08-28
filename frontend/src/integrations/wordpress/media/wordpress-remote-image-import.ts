import type {
  RemoteImageImportPort,
  RemoteImageImportRequest,
  RemoteImageImportResult,
} from '../../../contracts/ports/remote-image-import-port';
import { wordpressEndpoint } from '../shared/wordpress-endpoint';

type ApiFetch = (
  options: Readonly<{
    data: Readonly<{ alt_text: string; post_id: number; url: string }>;
    headers: Readonly<Record<string, string>>;
    method: 'POST';
    signal: AbortSignal;
    url: string;
  }>,
) => Promise<unknown>;

type Options = Readonly<{
  actionNonce: string;
  apiFetch: unknown;
  endpoint: string;
  nonce: string;
  siteUrl: string;
}>;

function isAbortError(error: unknown): boolean {
  return Boolean(error && 'object' === typeof error && 'AbortError' === (error as { name?: unknown }).name);
}

function hasExplicitUrlPort(value: string): boolean {
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0] ?? '';
  if (authority.startsWith('[')) {
    return authority.slice(authority.indexOf(']') + 1).startsWith(':');
  }
  return authority.includes(':');
}

function invalidResponse(): never {
  throw new Error('remote-image-import-response-invalid');
}

function parseRemoteImageImportResult(value: unknown): RemoteImageImportResult {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    return invalidResponse();
  }
  const response = value as Record<string, unknown>;
  const expectedKeys = 'imported' === response.status
    ? ['alt', 'backup', 'status', 'title', 'url']
    : 'unchanged' === response.status
      ? ['alt', 'status', 'title', 'url']
      : [];
  const responseKeys = Object.keys(response);
  if (
    responseKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !responseKeys.includes(key)) ||
    'string' !== typeof response.url ||
    '' === response.url.trim() ||
    response.url.length > 2048 ||
    'string' !== typeof response.alt ||
    response.alt.length > 4096 ||
    'string' !== typeof response.title ||
    response.title.length > 4096
  ) {
    return invalidResponse();
  }
  let url: URL;
  try {
    url = new URL(response.url);
  } catch {
    return invalidResponse();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    '' !== url.username ||
    '' !== url.password ||
    '' !== url.port ||
    hasExplicitUrlPort(response.url) ||
    '' !== url.search ||
    '' !== url.hash
  ) {
    return invalidResponse();
  }
  if ('unchanged' === response.status) {
    return {
      alt: response.alt,
      status: 'unchanged',
      title: response.title,
      url: response.url,
    };
  }
  const backup = response.backup;
  if (!backup || 'object' !== typeof backup || Array.isArray(backup)) {
    return invalidResponse();
  }
  const backupResult = backup as Record<string, unknown>;
  const backupKeys = Object.keys(backupResult);
  if (
    1 !== backupKeys.length ||
    'status' !== backupKeys[0] ||
    !['disabled', 'uploaded'].includes(backupResult.status as string)
  ) {
    return invalidResponse();
  }
  return {
    alt: response.alt,
    backup: { status: backupResult.status as 'disabled' | 'uploaded' },
    status: 'imported',
    title: response.title,
    url: response.url,
  };
}

export function createWordPressRemoteImageImportPort({
  actionNonce,
  apiFetch,
  endpoint,
  nonce,
  siteUrl,
}: Options): RemoteImageImportPort {
  if ('function' !== typeof apiFetch) {
    throw new Error('remote-image-import-wordpress-runtime-unavailable');
  }
  if (!actionNonce || '' === actionNonce.trim()) {
    throw new Error('image-upload-action-nonce-invalid');
  }
  const request = apiFetch as ApiFetch;
  const importUrl = wordpressEndpoint(endpoint, siteUrl, 'remote-image-import-url-invalid').toString();

  return {
    async import({ altText, postId, signal, url }: RemoteImageImportRequest) {
      try {
        const result = parseRemoteImageImportResult(
          await request({
            data: { alt_text: altText, post_id: postId, url },
            headers: {
              'X-EasyMDE-Image-Hosting-Nonce': actionNonce,
              'X-WP-Nonce': nonce,
            },
            method: 'POST',
            signal,
            url: importUrl,
          }),
        );
        if ('unchanged' === result.status && result.url !== url) {
          return invalidResponse();
        }
        return result;
      } catch (error) {
        if (error instanceof Error && 'remote-image-import-response-invalid' === error.message) {
          throw error;
        }
        return {
          code: isAbortError(error) ? 'remote-image-import-cancelled' : 'remote-image-import-request-failed',
          status: 'failed',
        };
      }
    },
  };
}
