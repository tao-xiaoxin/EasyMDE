import type {
  RemoteImageImportPort,
  RemoteImageImportRequest,
} from '../../../contracts/ports/remote-image-import-port';
import { wordpressEndpoint } from '../shared/wordpress-endpoint';
import { parseUploadedImageResult } from './wordpress-image-upload';

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
        return parseUploadedImageResult(
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
      } catch (error) {
        if (error instanceof Error && 'image-upload-response-invalid' === error.message) {
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
