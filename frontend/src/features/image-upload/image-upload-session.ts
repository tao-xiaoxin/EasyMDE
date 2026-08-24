import type {
  ImageUploadDocumentPort,
  ImageUploadDocumentSnapshot,
  ImageUploadPort,
  ImageUploadSelection,
} from '../../contracts/ports/image-upload-port';
import type {
  ImageUploadInsertion,
  ImageUploadMimeType,
  ImageUploadStrings,
} from '../../contracts/bootstrap/image-upload-bootstrap';
import { defaultImageAlt, imageInsertionText } from './image-insertion';

export type ImageUploadSource = 'drop' | 'paste';

export type ImageUploadStatus = Readonly<{
  message: string;
  operationId: string;
  type: 'error' | 'info' | 'success';
}>;

type CreateImageUploadSessionOptions = Readonly<{
  allowedMimeTypes: ReadonlyArray<ImageUploadMimeType>;
  document: ImageUploadDocumentPort;
  enabled: boolean;
  insertion: ImageUploadInsertion;
  insertAfterUpload: boolean;
  maxBytes: number;
  nextOperationId: () => string;
  onDiagnostic: (code: string) => void;
  onStatus: (status: ImageUploadStatus) => void;
  postId: number;
  strings: ImageUploadStrings;
  target: HTMLElement;
  upload: ImageUploadPort;
}>;

function imageMimeType(file: File): ImageUploadMimeType | null {
  const mimeType = file.type.toLowerCase();
  if ('image/jpg' === mimeType) return 'image/jpeg';
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
    return mimeType as ImageUploadMimeType;
  }
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  const extensionMimeTypes: Readonly<Record<string, ImageUploadMimeType>> = {
    gif: 'image/gif',
    jfif: 'image/jpeg',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return extension ? (extensionMimeTypes[extension] ?? null) : null;
}

function validSelection(selection: ImageUploadSelection, value: string): boolean {
  return (
    Number.isInteger(selection.start) &&
    Number.isInteger(selection.end) &&
    selection.start >= 0 &&
    selection.end >= selection.start &&
    selection.end <= value.length &&
    ['backward', 'forward', 'none'].includes(selection.direction)
  );
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
  return (
    Array.from(transfer?.items ?? []).some((item) => 'file' === item.kind && /^image\//i.test(item.type)) ||
    Array.from(transfer?.files ?? []).some((file) => /^image\//i.test(file.type))
  );
}

function rebaseSelection(initial: ImageUploadDocumentSnapshot, currentValue: string): ImageUploadSelection {
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
  allowedMimeTypes,
  document,
  enabled,
  insertion,
  insertAfterUpload,
  maxBytes,
  nextOperationId,
  onDiagnostic,
  onStatus,
  postId,
  strings,
  target,
  upload,
}: CreateImageUploadSessionOptions): () => void {
  let active = true;
  const activeUploads = new Set<AbortController>();

  const handleFile = async (
    event: ClipboardEvent | DragEvent,
    file: File,
    source: ImageUploadSource,
  ): Promise<void> => {
    const operationId = nextOperationId();
    const reportStatus = (message: string, type: ImageUploadStatus['type']) => onStatus({ message, operationId, type });
    const reportCompletion = () => {
      reportStatus(statusMessage(strings, source, 'Uploaded'), 'success');
    };
    event.preventDefault();
    const dropTransfer = 'drop' === source ? (event as DragEvent).dataTransfer : null;
    if (dropTransfer) {
      dropTransfer.dropEffect = 'copy';
    }
    if (file.size > maxBytes) {
      reportStatus(statusMessage(strings, source, 'TooLarge'), 'error');
      return;
    }
    const mimeType = imageMimeType(file);
    if (!mimeType || !allowedMimeTypes.includes(mimeType)) {
      reportStatus(statusMessage(strings, source, 'Failed'), 'error');
      return;
    }

    let initial: ImageUploadDocumentSnapshot | null = null;
    if (insertAfterUpload) {
      try {
        initial = documentSnapshot(document);
      } catch {
        onDiagnostic('image-upload-document-snapshot-invalid');
        reportStatus(statusMessage(strings, source, 'Failed'), 'error');
        return;
      }
    }

    reportStatus(statusMessage(strings, source, 'Uploading'), 'info');
    const controller = new AbortController();
    activeUploads.add(controller);
    try {
      const fileNameAlt = defaultImageAlt(file.name, strings.defaultAlt);
      const result = await upload.upload({
        altText: 'filename' === insertion.altSource ? fileNameAlt : '',
        file,
        postId,
        signal: controller.signal,
      });
      if (!active) {
        onDiagnostic('image-upload-completed-after-teardown');
        return;
      }
      if ('failed' === result.status) {
        reportStatus(statusMessage(strings, source, 'Failed'), 'error');
        return;
      }
      if (!insertAfterUpload) {
        reportCompletion();
        return;
      }
      if (!initial) {
        throw new Error('image-upload-document-snapshot-missing');
      }

      const current = documentSnapshot(document);
      const selection = rebaseSelection(initial, current.value);
      const inserted = imageInsertionText({
        defaultAlt: strings.defaultAlt,
        fileName: file.name,
        insertion,
        uploadedAlt: result.alt,
        uploadedTitle: result.title,
        url: result.url,
      });
      const cursor = selection.start + inserted.length;
      document.applyTextChange({
        selection: { direction: selection.direction, end: cursor, start: cursor },
        value: current.value.slice(0, selection.start) + inserted + current.value.slice(selection.end),
      });
      document.focus();
      reportCompletion();
    } catch {
      if (active) {
        onDiagnostic('image-upload-operation-failed');
        reportStatus(statusMessage(strings, source, 'Failed'), 'error');
      }
    } finally {
      activeUploads.delete(controller);
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
    for (const controller of activeUploads) {
      controller.abort();
    }
    activeUploads.clear();
    target.removeEventListener('paste', onPaste);
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
