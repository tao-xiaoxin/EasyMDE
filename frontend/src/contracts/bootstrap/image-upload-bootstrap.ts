export type ImageUploadStrings = Readonly<{
  defaultAlt: string;
  dropFailed: string;
  dropTooLarge: string;
  dropUploaded: string;
  dropUploading: string;
  pasteFailed: string;
  pasteTooLarge: string;
  pasteUploaded: string;
  pasteUploading: string;
}>;

export type ImageUploadBootstrap = Readonly<{
  enabled: boolean;
  endpoint: string;
  maxBytes: number;
  nonce: string;
  postId: number;
  strings: ImageUploadStrings;
}>;

function stringValue(value: unknown, code: string): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > 512) {
    throw new Error(code);
  }
  return value;
}
function integerValue(value: unknown, minimum: number, code: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(code);
  }
  return value as number;
}

export function parseImageUploadBootstrap(value: unknown): ImageUploadBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('image-upload-bootstrap-invalid');
  }
  const bootstrap = value as Record<string, unknown>;
  const strings = bootstrap.strings;
  if (!strings || 'object' !== typeof strings || Array.isArray(strings)) {
    throw new Error('image-upload-strings-invalid');
  }
  const messages = strings as Record<string, unknown>;

  return {
    enabled: true === bootstrap.enabled,
    endpoint: stringValue(bootstrap.endpoint, 'image-upload-endpoint-invalid'),
    maxBytes: integerValue(bootstrap.maxBytes, 1, 'image-upload-max-bytes-invalid'),
    nonce: stringValue(bootstrap.nonce, 'image-upload-nonce-invalid'),
    postId: integerValue(bootstrap.postId, 0, 'image-upload-post-id-invalid'),
    strings: {
      defaultAlt: stringValue(messages.defaultAlt, 'image-upload-string-invalid'),
      dropFailed: stringValue(messages.dropFailed, 'image-upload-string-invalid'),
      dropTooLarge: stringValue(messages.dropTooLarge, 'image-upload-string-invalid'),
      dropUploaded: stringValue(messages.dropUploaded, 'image-upload-string-invalid'),
      dropUploading: stringValue(messages.dropUploading, 'image-upload-string-invalid'),
      pasteFailed: stringValue(messages.pasteFailed, 'image-upload-string-invalid'),
      pasteTooLarge: stringValue(messages.pasteTooLarge, 'image-upload-string-invalid'),
      pasteUploaded: stringValue(messages.pasteUploaded, 'image-upload-string-invalid'),
      pasteUploading: stringValue(messages.pasteUploading, 'image-upload-string-invalid')
    }
  };
}
