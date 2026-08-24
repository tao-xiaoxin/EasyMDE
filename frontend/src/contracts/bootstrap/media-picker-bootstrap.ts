import { parseImageUploadInsertion, type ImageUploadInsertion } from './image-upload-bootstrap';

export type MediaPickerBootstrap = Readonly<{
  defaultAlt: string;
  insertMedia: string;
  insertion: ImageUploadInsertion;
  placeholderAlt: string;
}>;

function stringValue(value: unknown): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > 512) {
    throw new Error('invalid-media-picker-string');
  }

  return value;
}

export function parseMediaPickerBootstrap(value: unknown): MediaPickerBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('invalid-media-picker-bootstrap');
  }
  const bootstrap = value as Record<string, unknown>;

  return {
    defaultAlt: stringValue(bootstrap.defaultAlt),
    insertMedia: stringValue(bootstrap.insertMedia),
    insertion: parseImageUploadInsertion(bootstrap.insertion),
    placeholderAlt: stringValue(bootstrap.placeholderAlt),
  };
}
