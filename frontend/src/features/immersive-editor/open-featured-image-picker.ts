import type { NativeFeaturedImage } from '../../contracts/ports/native-publish-port';
import type { MediaPickerFramePort } from '../../contracts/ports/media-picker-port';

function featuredImage(value: unknown): NativeFeaturedImage {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('featured-image-attachment-invalid');
  }
  const attachment = value as Record<string, unknown>;
  const id = Number(attachment.id);
  const url = 'string' === typeof attachment.url ? attachment.url.trim() : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !url) {
    throw new Error('featured-image-attachment-invalid');
  }
  const alt =
    'string' === typeof attachment.alt && attachment.alt.trim()
      ? attachment.alt.trim()
      : 'string' === typeof attachment.title
        ? attachment.title.trim()
        : '';
  return { alt, id, url };
}

export function openFeaturedImagePicker(
  frame: MediaPickerFramePort | null,
  title: string
): Promise<NativeFeaturedImage | null> {
  if (!frame) return Promise.reject(new Error('featured-image-picker-unavailable'));

  return new Promise((resolve, reject) => {
    let selection: NativeFeaturedImage | null = null;
    let failure: unknown = null;
    let selected = false;
    try {
      frame.open({
        title,
        onSelect(value) {
          if (selected) return;
          selected = true;
          try {
            selection = featuredImage(value);
          } catch (error) {
            failure = error;
          }
        },
        onError(error) {
          if (!failure) failure = error;
        },
        onClose() {
          if (failure) reject(failure);
          else resolve(selection);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
