import type { MediaPickerStrings } from '../../features/media-picker/media-picker-session';

function stringValue(value: unknown): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > 512) {
    throw new Error('invalid-media-picker-string');
  }

  return value;
}

export function parseMediaPickerBootstrap(value: unknown): MediaPickerStrings {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('invalid-media-picker-bootstrap');
  }
  const bootstrap = value as Record<string, unknown>;

  return {
    defaultAlt: stringValue(bootstrap.defaultAlt),
    insertMedia: stringValue(bootstrap.insertMedia),
    placeholderAlt: stringValue(bootstrap.placeholderAlt)
  };
}
