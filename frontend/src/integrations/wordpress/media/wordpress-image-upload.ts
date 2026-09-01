import type { ImageUploadOwner } from '../../../contracts/bootstrap/image-upload-bootstrap';
import type {
  ImageUploadPort,
  ImageUploadResult
} from '../../../contracts/ports/image-upload-port';
import { wordpressEndpoint } from '../shared/wordpress-endpoint';

type ApiFetch = (
  options: Readonly<{
    body: FormData;
    headers: Readonly<Record<string, string>>;
    method: 'POST';
    signal: AbortSignal;
    url: string;
  }>
) => Promise<unknown>;

type CreateWordPressImageUploadPortOptions = Readonly<{
  actionNonce: string;
  apiFetch: unknown;
  endpoint: string;
  formData: unknown;
  nonce: string;
  siteUrl: string;
  uploadOwner: ImageUploadOwner;
}>;

function uploadFileName(file: File): string {
  if (/\.(?:gif|jpe?g|png|webp)$/i.test(file.name)) {
    return file.name;
  }
  const extensions: Readonly<Record<string, string>> = {
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  return `${file.name || 'pasted-image'}.${extensions[file.type.toLowerCase()] ?? 'png'}`;
}
function hasExplicitUrlPort(value: string): boolean {
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0] ?? '';
  if (authority.startsWith('[')) {
    return authority.slice(authority.indexOf(']') + 1).startsWith(':');
  }
  return authority.includes(':');
}

function invalidResponse(): never {
  throw new Error('image-upload-response-invalid');
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlyArray<string>
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key))
  );
}

function responseString(
  value: unknown,
  maxLength: number,
  requireNonEmpty = false
): string {
  if (
    'string' !== typeof value ||
    value.length > maxLength ||
    (requireNonEmpty && '' === value.trim())
  ) {
    return invalidResponse();
  }
  return value;
}

function responseUrl(value: unknown): string {
  const responseUrlValue = responseString(value, 2048, true);
  let url: URL;
  try {
    url = new URL(responseUrlValue);
  } catch {
    return invalidResponse();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    '' !== url.username ||
    '' !== url.password ||
    '' !== url.port ||
    hasExplicitUrlPort(responseUrlValue) ||
    '' !== url.search ||
    '' !== url.hash
  ) {
    return invalidResponse();
  }
  return responseUrlValue;
}

function mediaResponseUrl(value: unknown): string {
  const responseUrlValue = responseString(value, 4096, true);
  let url: URL;
  try {
    url = new URL(responseUrlValue);
  } catch {
    return invalidResponse();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    '' !== url.username ||
    '' !== url.password ||
    '' === url.hostname
  ) {
    return invalidResponse();
  }
  return responseUrlValue;
}

export function parseMediaUploadResult(
  value: unknown
): ImageUploadResult {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    return invalidResponse();
  }
  const response = value as Record<string, unknown>;
  if (!exactKeys(response, ['id', 'url', 'alt', 'filename', 'title'])) {
    return invalidResponse();
  }
  if (!Number.isSafeInteger(response.id) || (response.id as number) < 1) {
    return invalidResponse();
  }
  const url = mediaResponseUrl(response.url);
  const alt = responseString(response.alt, 4096);
  responseString(response.filename, 512, true);
  const title = responseString(response.title, 4096);
  return {
    alt,
    status: 'uploaded',
    title,
    url
  };
}

export function parseImageHostingUploadResult(value: unknown): ImageUploadResult {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    return invalidResponse();
  }
  const response = value as Record<string, unknown>;
  if (!exactKeys(response, ['url', 'alt', 'title', 'backup'])) {
    return invalidResponse();
  }
  const url = responseUrl(response.url);
  const alt = responseString(response.alt, 4096);
  const title = responseString(response.title, 4096);
  const backup = response.backup;
  if (!backup || 'object' !== typeof backup || Array.isArray(backup)) {
    return invalidResponse();
  }
  const backupResult = backup as Record<string, unknown>;
  if (
    !exactKeys(backupResult, ['status']) ||
    'string' !== typeof backupResult.status ||
    !['disabled', 'uploaded'].includes(backupResult.status)
  ) {
    return invalidResponse();
  }
  return {
    alt,
    status: 'uploaded',
    title,
    url
  };
}

export const parseUploadedImageResult = parseImageHostingUploadResult;

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      'object' === typeof error &&
      'AbortError' === (error as { name?: unknown }).name
  );
}

export function createWordPressImageUploadPort({
  actionNonce,
  apiFetch,
  endpoint,
  formData,
  nonce,
  siteUrl,
  uploadOwner
}: CreateWordPressImageUploadPortOptions): ImageUploadPort {
  if ('function' !== typeof apiFetch || 'function' !== typeof formData) {
    throw new Error('image-upload-wordpress-runtime-unavailable');
  }
  if (!['media', 'image-hosting'].includes(uploadOwner)) {
    throw new Error('image-upload-owner-invalid');
  }
  const request = apiFetch as ApiFetch;
  const FormDataConstructor = formData as typeof FormData;
  const uploadUrl = wordpressEndpoint(
    endpoint,
    siteUrl,
    'image-upload-url-invalid'
  ).toString();
  if (
    'image-hosting' === uploadOwner &&
    (!actionNonce || '' === actionNonce.trim())
  ) {
    throw new Error('image-upload-action-nonce-invalid');
  }

  return {
    async upload({
      altText,
      file,
      postId,
      signal
    }): Promise<ImageUploadResult> {
      const body = new FormDataConstructor();
      body.append('file', file, uploadFileName(file));
      body.append('post_id', String(postId));
      body.append('alt_text', altText);
      try {
        const result = await request({
          body,
          headers:
            'media' === uploadOwner
              ? {
                  'X-WP-Nonce': nonce
                }
              : {
                  'X-EasyMDE-Image-Hosting-Nonce': actionNonce,
                  'X-WP-Nonce': nonce
                },
          method: 'POST',
          signal,
          url: uploadUrl
        });
        return (
          'media' === uploadOwner
            ? parseMediaUploadResult(result)
            : parseImageHostingUploadResult(result)
        );
      } catch (error) {
        if (
          error instanceof Error &&
          'image-upload-response-invalid' === error.message
        ) {
          throw error;
        }
        return {
          code: isAbortError(error)
            ? 'image-upload-cancelled'
            : 'image-upload-request-failed',
          status: 'failed'
        };
      }
    }
  };
}
