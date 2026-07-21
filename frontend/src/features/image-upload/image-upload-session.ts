import type {
  ImageUploadDocumentPort,
  ImageUploadDocumentSnapshot,
  ImageUploadPort,
  ImageUploadSelection
} from '../../contracts/ports/image-upload-port';

export type ImageUploadSource = 'drop' | 'paste';

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

export type ImageUploadStatus = Readonly<{
  message: string;
  type: 'error' | 'info' | 'success';
}>;

type CreateImageUploadSessionOptions = Readonly<{
  document: ImageUploadDocumentPort;
  enabled: boolean;
  maxBytes: number;
  onDiagnostic: (code: string) => void;
  onStatus: (status: ImageUploadStatus) => void;
  postId: number;
  strings: ImageUploadStrings;
  target: HTMLElement;
  upload: ImageUploadPort;
}>;

function validSelection(selection: ImageUploadSelection, value: string): boolean {
  return Number.isInteger(selection.start)
    && Number.isInteger(selection.end)
    && selection.start >= 0
    && selection.end >= selection.start
    && selection.end <= value.length
    && ['backward', 'forward', 'none'].includes(selection.direction);
}

function documentSnapshot(document: ImageUploadDocumentPort): ImageUploadDocumentSnapshot {
  const snapshot = document.getSnapshot();
  if (!snapshot || 'string' !== typeof snapshot.value || !validSelection(snapshot.selection, snapshot.value)) {
    throw new Error('image-upload-document-snapshot-invalid');
  }
  return snapshot;
}

function firstImageFile(transfer: DataTransfer | null): File | null {
  for (const item of Array.from(transfer?.items ?? [])) {
    if ('file' !== item.kind || (item.type && !/^image\//i.test(item.type))) {
      continue;
    }
    const file = item.getAsFile();
    if (file && /^image\//i.test(file.type || item.type)) {
      return file;
    }
  }
  return Array.from(transfer?.files ?? []).find((file) => /^image\//i.test(file.type)) ?? null;
}

function hasImageFile(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => 'file' === item.kind && /^image\//i.test(item.type)
  ) || Array.from(transfer?.files ?? []).some((file) => /^image\//i.test(file.type));
}

function defaultAltFromFile(file: File, fallback: string): string {
  if (!file.name) {
    return fallback;
  }
  return file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

function escapeAltText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function imageMarkdown(url: string, alt: string): string {
  return `![${escapeAltText(alt)}](${url.replace(/\)/g, '%29')})`;
}

function rebaseSelection(
  initial: ImageUploadDocumentSnapshot,
  currentValue: string
): ImageUploadSelection {
  if (currentValue === initial.value) {
    return initial.selection;
  }
  const suffix = initial.value.slice(initial.selection.end);
  if (suffix) {
    const index = currentValue.lastIndexOf(suffix);
    if (-1 !== index) {
      return { direction: initial.selection.direction, end: index, start: index };
    }
  }
  const prefix = initial.value.slice(0, initial.selection.start);
  if (prefix) {
    const index = currentValue.indexOf(prefix);
    if (-1 !== index) {
      const position = index + prefix.length;
      return { direction: initial.selection.direction, end: position, start: position };
    }
  }
  const position = Math.max(0, Math.min(initial.selection.start, currentValue.length));
  return { direction: initial.selection.direction, end: position, start: position };
}

function statusMessage(strings: ImageUploadStrings, source: ImageUploadSource, state: string): string {
  const key = `${source}${state}` as keyof ImageUploadStrings;
  return strings[key];
}

export function createImageUploadSession({
  document,
  enabled,
  maxBytes,
  onDiagnostic,
  onStatus,
  postId,
  strings,
  target,
  upload
}: CreateImageUploadSessionOptions): () => void {
  let active = true;

  const handleFile = async (
    event: ClipboardEvent | DragEvent,
    file: File,
    source: ImageUploadSource
  ): Promise<void> => {
    event.preventDefault();
    const dropTransfer = 'drop' === source ? (event as DragEvent).dataTransfer : null;
    if (dropTransfer) {
      dropTransfer.dropEffect = 'copy';
    }
    if (file.size > maxBytes) {
      onStatus({ message: statusMessage(strings, source, 'TooLarge'), type: 'error' });
      return;
    }

    let initial: ImageUploadDocumentSnapshot;
    try {
      initial = documentSnapshot(document);
    } catch {
      onDiagnostic('image-upload-document-snapshot-invalid');
      onStatus({ message: statusMessage(strings, source, 'Failed'), type: 'error' });
      return;
    }

    onStatus({ message: statusMessage(strings, source, 'Uploading'), type: 'info' });
    try {
      const result = await upload.upload({
        altText: defaultAltFromFile(file, strings.defaultAlt),
        file,
        postId
      });
      if (!active) {
        onDiagnostic('image-upload-completed-after-teardown');
        return;
      }
      if ('failed' === result.status) {
        onStatus({ message: statusMessage(strings, source, 'Failed'), type: 'error' });
        return;
      }

      const current = documentSnapshot(document);
      const selection = rebaseSelection(initial, current.value);
      const markdown = imageMarkdown(result.url, result.alt || strings.defaultAlt);
      const cursor = selection.start + markdown.length;
      document.applyTextChange({
        selection: { direction: selection.direction, end: cursor, start: cursor },
        value: current.value.slice(0, selection.start) + markdown + current.value.slice(selection.end)
      });
      document.focus();
      onStatus({ message: statusMessage(strings, source, 'Uploaded'), type: 'success' });
    } catch {
      if (active) {
        onDiagnostic('image-upload-operation-failed');
        onStatus({ message: statusMessage(strings, source, 'Failed'), type: 'error' });
      }
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    if (!enabled) {
      return;
    }
    const file = firstImageFile(event.clipboardData);
    if (file) {
      void handleFile(event, file, 'paste');
    }
  };
  const onDragOver = (event: DragEvent) => {
    if (!enabled || !hasImageFile(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (event: DragEvent) => {
    if (!enabled) {
      return;
    }
    const file = firstImageFile(event.dataTransfer);
    if (file) {
      void handleFile(event, file, 'drop');
    }
  };

  target.addEventListener('paste', onPaste);
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    target.removeEventListener('paste', onPaste);
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
