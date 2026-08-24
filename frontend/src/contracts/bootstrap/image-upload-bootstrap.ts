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

export type ImageUploadMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type ImageUploadInsertion = Readonly<{
  altSource: 'filename' | 'empty' | 'upload';
  captionMode: 'none' | 'filename' | 'upload';
  format: 'markdown' | 'url';
}>;

export type ImageUploadBootstrap = Readonly<{
  actionNonce: string;
  allowedMimeTypes: ReadonlyArray<ImageUploadMimeType>;
  enabled: boolean;
  endpoint: string;
  insertAfterUpload: boolean;
  insertion: ImageUploadInsertion;
  maxBytes: number;
  nonce: string;
  postId: number;
  strings: ImageUploadStrings;
}>;

const IMAGE_UPLOAD_MIME_TYPES: ReadonlyArray<ImageUploadMimeType> = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

function mimeTypesValue(value: unknown): ReadonlyArray<ImageUploadMimeType> {
  if (
    !Array.isArray(value) ||
    value.some(
      (mimeType) => 'string' !== typeof mimeType || !IMAGE_UPLOAD_MIME_TYPES.includes(mimeType as ImageUploadMimeType),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('image-upload-mime-types-invalid');
  }
  return value as ReadonlyArray<ImageUploadMimeType>;
}

export function parseImageUploadInsertion(value: unknown): ImageUploadInsertion {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('image-upload-insertion-invalid');
  }
  const insertion = value as Record<string, unknown>;
  if (
    !['filename', 'empty', 'upload'].includes(String(insertion.altSource)) ||
    !['none', 'filename', 'upload'].includes(String(insertion.captionMode)) ||
    !['markdown', 'url'].includes(String(insertion.format))
  ) {
    throw new Error('image-upload-insertion-invalid');
  }
  return insertion as ImageUploadInsertion;
}

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
  const expectedKeys = [
    'actionNonce',
    'allowedMimeTypes',
    'enabled',
    'endpoint',
    'insertAfterUpload',
    'insertion',
    'maxBytes',
    'nonce',
    'postId',
    'strings'
  ];
  if (
    Object.keys(bootstrap).length !== expectedKeys.length ||
    expectedKeys.some(
      // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
      (key) => !Object.prototype.hasOwnProperty.call(bootstrap, key),
    )
  ) {
    throw new Error('image-upload-bootstrap-fields-invalid');
  }
  const strings = bootstrap.strings;
  if (!strings || 'object' !== typeof strings || Array.isArray(strings)) {
    throw new Error('image-upload-strings-invalid');
  }
  const messages = strings as Record<string, unknown>;
  if ('boolean' !== typeof bootstrap.insertAfterUpload) {
    throw new Error('image-upload-insert-after-upload-invalid');
  }
  const actionNonce = bootstrap.actionNonce;
  if ('string' !== typeof actionNonce || '' === actionNonce.trim()) {
    throw new Error('image-upload-action-nonce-invalid');
  }

  return {
    actionNonce: stringValue(actionNonce, 'image-upload-action-nonce-invalid'),
    allowedMimeTypes: mimeTypesValue(bootstrap.allowedMimeTypes),
    enabled: true === bootstrap.enabled,
    endpoint: stringValue(bootstrap.endpoint, 'image-upload-endpoint-invalid'),
    insertAfterUpload: bootstrap.insertAfterUpload,
    insertion: parseImageUploadInsertion(bootstrap.insertion),
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
      pasteUploading: stringValue(messages.pasteUploading, 'image-upload-string-invalid'),
    },
  };
}
