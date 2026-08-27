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
export function parseUploadedImageResult(value: unknown): ImageUploadResult {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('image-upload-response-invalid');
  }
  const response = value as Record<string, unknown>;
  const responseKeys = Object.keys(response);
  if (
    4 !== responseKeys.length ||
    !['alt', 'backup', 'title', 'url'].every((key) =>
      responseKeys.includes(key)
    )
  ) {
    throw new Error('image-upload-response-invalid');
  }
  if (
    'string' !== typeof response.url ||
    '' === response.url.trim() ||
    response.url.length > 2048 ||
    'string' !== typeof response.alt ||
    response.alt.length > 4096 ||
    'string' !== typeof response.title ||
    response.title.length > 4096
  ) {
    throw new Error('image-upload-response-invalid');
  }
  let url: URL;
  try {
    url = new URL(response.url);
  } catch {
    throw new Error('image-upload-response-invalid');
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
    throw new Error('image-upload-response-invalid');
  }
  const backup = response.backup;
  if (!backup || 'object' !== typeof backup || Array.isArray(backup)) {
    throw new Error('image-upload-response-invalid');
  }
  const backupResult = backup as Record<string, unknown>;
  const backupKeys = Object.keys(backupResult);
  if (
    !['disabled', 'uploaded'].includes(String(backupResult.status))
  ) {
    throw new Error('image-upload-response-invalid');
  }
  if (1 !== backupKeys.length || 'status' !== backupKeys[0]) {
    throw new Error('image-upload-response-invalid');
  }
  return {
    alt: response.alt,
    status: 'uploaded',
    title: response.title,
    url: response.url
  };
}

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
  siteUrl
}: CreateWordPressImageUploadPortOptions): ImageUploadPort {
  if ('function' !== typeof apiFetch || 'function' !== typeof formData) {
    throw new Error('image-upload-wordpress-runtime-unavailable');
  }
  const request = apiFetch as ApiFetch;
  const FormDataConstructor = formData as typeof FormData;
  const uploadUrl = wordpressEndpoint(
    endpoint,
    siteUrl,
    'image-upload-url-invalid'
  ).toString();
  if (!actionNonce || '' === actionNonce.trim()) {
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
        return parseUploadedImageResult(
          await request({
            body,
            headers: {
              'X-WP-Nonce': nonce,
              'X-EasyMDE-Image-Hosting-Nonce': actionNonce
            },
            method: 'POST',
            signal,
            url: uploadUrl
          })
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
