import { parseImageUploadInsertion, type ImageUploadInsertion } from './image-upload-bootstrap';

export type MediaPickerBootstrap = Readonly<{
  canUseMedia: boolean;
  defaultAlt: string;
  frameUrl: string;
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

function frameUrlValue(value: unknown, enabled: boolean): string {
  if ('string' !== typeof value || value.length > 4096 || (enabled && '' === value.trim())) {
    throw new Error('invalid-media-picker-frame-url');
  }
  return value;
}

export function parseMediaPickerBootstrap(value: unknown): MediaPickerBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('invalid-media-picker-bootstrap');
  }
  const bootstrap = value as Record<string, unknown>;
  if ('boolean' !== typeof bootstrap.canUseMedia) {
    throw new Error('invalid-media-picker-capability');
  }

  return {
    canUseMedia: bootstrap.canUseMedia,
    defaultAlt: stringValue(bootstrap.defaultAlt),
    frameUrl: frameUrlValue(bootstrap.frameUrl, bootstrap.canUseMedia),
    insertMedia: stringValue(bootstrap.insertMedia),
    insertion: parseImageUploadInsertion(bootstrap.insertion),
    placeholderAlt: stringValue(bootstrap.placeholderAlt)
  };
}
