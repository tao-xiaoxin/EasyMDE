import type {
  ImageUploadPort,
  ImageUploadResult
} from '../../../contracts/ports/image-upload-port';
import { wordpressEndpoint } from '../shared/wordpress-endpoint';

type ApiFetch = (options: Readonly<{
  body: FormData;
  headers: Readonly<Record<string, string>>;
  method: 'POST';
  url: string;
}>) => Promise<unknown>;

type CreateWordPressImageUploadPortOptions = Readonly<{
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
function uploadedResult(value: unknown): ImageUploadResult {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('image-upload-response-invalid');
  }
  const response = value as Record<string, unknown>;
  if (
    !Number.isInteger(response.id)
    || (response.id as number) <= 0
    || 'string' !== typeof response.url
    || '' === response.url.trim()
    || 'string' !== typeof response.alt
  ) {
    throw new Error('image-upload-response-invalid');
  }
  return { alt: response.alt, status: 'uploaded', url: response.url };
}

export function createWordPressImageUploadPort({
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
  const uploadUrl = wordpressEndpoint(endpoint, siteUrl, 'image-upload-url-invalid').toString();

  return {
    async upload({ altText, file, postId }): Promise<ImageUploadResult> {
      const body = new FormDataConstructor();
      body.append('file', file, uploadFileName(file));
      body.append('post_id', String(postId));
      body.append('alt_text', altText);
      try {
        return uploadedResult(await request({
          body,
          headers: { 'X-WP-Nonce': nonce },
          method: 'POST',
          url: uploadUrl
        }));
      } catch (error) {
        if (error instanceof Error && 'image-upload-response-invalid' === error.message) {
          throw error;
        }
        return { code: 'image-upload-request-failed', status: 'failed' };
      }
    }
  };
}
