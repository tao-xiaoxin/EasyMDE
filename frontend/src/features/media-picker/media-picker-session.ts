import type {
  MediaPickerDocumentPort,
  MediaPickerDocumentSnapshot,
  MediaPickerFramePort,
  MediaPickerSelection
} from '../../contracts/ports/media-picker-port';
import type { MediaPickerBootstrap } from '../../contracts/bootstrap/media-picker-bootstrap';

export type MediaPickerResult = 'cancelled' | 'inserted' | 'placeholder';

type OpenMediaPickerSessionOptions = Readonly<{
  document: MediaPickerDocumentPort;
  frame: MediaPickerFramePort | null;
  strings: MediaPickerBootstrap;
}>;

function validSelection(selection: MediaPickerSelection, value: string): boolean {
  return Number.isInteger(selection.start)
    && Number.isInteger(selection.end)
    && selection.start >= 0
    && selection.end >= selection.start
    && selection.end <= value.length
    && ['backward', 'forward', 'none'].includes(selection.direction);
}

function documentSnapshot(document: MediaPickerDocumentPort): MediaPickerDocumentSnapshot {
  const snapshot = document.getSnapshot();
  if (!snapshot || 'string' !== typeof snapshot.value || !validSelection(snapshot.selection, snapshot.value)) {
    throw new Error('media-picker-document-snapshot-invalid');
  }

  return snapshot;
}

function replacementSnapshot(
  snapshot: MediaPickerDocumentSnapshot,
  markdown: string
): MediaPickerDocumentSnapshot {
  const { end, start } = snapshot.selection;
  const cursor = start + markdown.length;

  return {
    selection: {
      direction: snapshot.selection.direction,
      end: cursor,
      start: cursor
    },
    value: snapshot.value.slice(0, start) + markdown + snapshot.value.slice(end)
  };
}

function attachmentMarkdown(value: unknown, defaultAlt: string): string {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('media-picker-attachment-invalid');
  }
  const attachment = value as Record<string, unknown>;
  if ('string' !== typeof attachment.url || '' === attachment.url.trim()) {
    throw new Error('media-picker-attachment-invalid');
  }
  const alt = 'string' === typeof attachment.alt && attachment.alt
    ? attachment.alt
    : 'string' === typeof attachment.title && attachment.title
      ? attachment.title
      : defaultAlt;

  return `![${alt}](${attachment.url})`;
}

export function openMediaPickerSession({
  document,
  frame,
  strings
}: OpenMediaPickerSessionOptions): Promise<MediaPickerResult> {
  let initial: MediaPickerDocumentSnapshot;
  try {
    initial = documentSnapshot(document);
  } catch (error) {
    document.focus();
    return Promise.reject(error);
  }

  if (!frame) {
    document.applyTextChange(replacementSnapshot(initial, `![${strings.placeholderAlt}]()`));
    document.focus();
    return Promise.resolve('placeholder');
  }

  return new Promise((resolve, reject) => {
    let failure: unknown = null;
    let inserted = false;
    let selected = false;

    const finish = () => {
      document.focus();
      if (failure) {
        reject(failure);
        return;
      }
      resolve(inserted ? 'inserted' : 'cancelled');
    };

    try {
      frame.open({
        onClose: finish,
        onError: (error) => {
          if (!failure) {
            failure = error;
          }
        },
        onSelect: (attachment) => {
          if (selected) {
            return;
          }
          selected = true;

          try {
            if (documentSnapshot(document).value !== initial.value) {
              throw new Error('media-picker-document-stale');
            }
            document.applyTextChange(
              replacementSnapshot(initial, attachmentMarkdown(attachment, strings.defaultAlt))
            );
            inserted = true;
          } catch (error) {
            failure = error;
          }
        },
        title: strings.insertMedia
      });
    } catch (error) {
      document.focus();
      reject(error);
    }
  });
}
