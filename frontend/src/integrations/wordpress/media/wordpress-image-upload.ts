import type { ImageUploadOwner } from '../../../contracts/bootstrap/image-upload-bootstrap';
import type {
  ImageUploadFailureDiagnostic,
  ImageUploadPort,
  ImageUploadResult,
  ImageUploadTransportCategory
} from '../../../contracts/ports/image-upload-port';
import {
  IMAGE_UPLOAD_EXTENSIONS,
  type ImageUploadExtension
} from '../../../contracts/settings-center-settings';
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

const IMAGE_HOSTING_NONCE_ERROR_CODE = 'easymde_rest_invalid_image_hosting_nonce';
const IMAGE_HOSTING_UPLOAD_ERROR_CODE = 'easymde_image_hosting_upload_failed';
let nextImageUploadOperationId = 0;

function uploadFileName(file: File): string {
  const match = file.name.match(/^(.*)\.([^.]+)$/);
  if (match && IMAGE_UPLOAD_EXTENSIONS.includes(match[2]?.toLowerCase() as ImageUploadExtension)) {
    return `${match[1]}.${match[2]?.toLowerCase()}`;
  }
  const extensions: Readonly<Record<string, ImageUploadExtension>> = {
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/jfif': 'jfif',
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

function isImageHostingNonceError(error: unknown): boolean {
  return Boolean(
    error &&
      'object' === typeof error &&
      IMAGE_HOSTING_NONCE_ERROR_CODE === (error as { code?: unknown }).code
  );
}

function isImageHostingUploadError(error: unknown): boolean {
  return Boolean(
    error &&
      'object' === typeof error &&
      IMAGE_HOSTING_UPLOAD_ERROR_CODE === (error as { code?: unknown }).code
  );
}

function imageUploadNow(): number {
  const value = globalThis.performance?.now?.();
  return 'number' === typeof value && Number.isFinite(value) ? value : Date.now();
}

function nextImageUploadId(): number {
  nextImageUploadOperationId =
    nextImageUploadOperationId >= Number.MAX_SAFE_INTEGER ? 1 : nextImageUploadOperationId + 1;
  return nextImageUploadOperationId;
}

function responseStatus(error: unknown): number | null {
  if (!error || 'object' !== typeof error || Array.isArray(error)) return null;
  const response = error as { data?: unknown; status?: unknown };
  const candidates = [
    response.status,
    response.data && 'object' === typeof response.data && !Array.isArray(response.data)
      ? (response.data as { status?: unknown }).status
      : undefined
  ];
  for (const value of candidates) {
    if ('number' === typeof value && Number.isInteger(value) && value >= 100 && value <= 599) {
      return value;
    }
  }
  return null;
}

function imageUploadTransportCategory(
  error: unknown,
  cancelled: boolean,
  status: number | null
): ImageUploadTransportCategory {
  if (cancelled) return 'abort';
  if (null !== status) return 'http';
  if (error instanceof Error) return 'network';
  return 'unknown';
}

function imageUploadDiagnostic(
  operationId: number,
  startedAt: number,
  error: unknown,
  signal: AbortSignal
): ImageUploadFailureDiagnostic {
  const cancelled = signal.aborted || isAbortError(error);
  const status = responseStatus(error);
  return {
    cancelled,
    durationMs: Math.max(0, Math.round(imageUploadNow() - startedAt)),
    operationId,
    status,
    transportCategory: imageUploadTransportCategory(error, cancelled, status)
  };
}

function logImageHostingFailure(
  code: string,
  diagnostic: ImageUploadFailureDiagnostic
): void {
  console.error('[EasyMDE] image-upload-failed', { code, ...diagnostic });
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
      const operationId = nextImageUploadId();
      const startedAt = imageUploadNow();
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
        const diagnostic = imageUploadDiagnostic(operationId, startedAt, error, signal);
        const code =
          'image-hosting' === uploadOwner && isImageHostingNonceError(error)
            ? IMAGE_HOSTING_NONCE_ERROR_CODE
            : 'image-hosting' === uploadOwner && isImageHostingUploadError(error)
              ? IMAGE_HOSTING_UPLOAD_ERROR_CODE
              : isAbortError(error)
                ? 'image-upload-cancelled'
                : 'image-upload-request-failed';
        if ('image-hosting' === uploadOwner) logImageHostingFailure(code, diagnostic);
        return {
          diagnostic,
          ...('image-hosting' === uploadOwner && isImageHostingNonceError(error)
            ? {
                code: IMAGE_HOSTING_NONCE_ERROR_CODE,
                sideEffects: 'none' as const
              }
            : 'image-hosting' === uploadOwner && isImageHostingUploadError(error)
              ? {
                  // The REST controller intentionally exposes this stable code
                  // for provider/runtime failures while redacting message/data.
                  // A failure may follow a partial primary or backup write.
                  code: IMAGE_HOSTING_UPLOAD_ERROR_CODE,
                  sideEffects: 'uploads-may-remain' as const
                }
              : {
                  code: isAbortError(error)
                    ? 'image-upload-cancelled'
                    : 'image-upload-request-failed'
                }),
          status: 'failed'
        };
      }
    }
  };
}
