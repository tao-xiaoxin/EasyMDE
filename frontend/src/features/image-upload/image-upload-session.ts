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
  RemoteImageUploadMode,
} from '../../contracts/bootstrap/image-upload-bootstrap';
import type { RemoteImageImportPort } from '../../contracts/ports/remote-image-import-port';
import { defaultImageAlt, imageInsertionText, imageMarkdownText } from './image-insertion';
import {
  type ImageUploadSurface,
  remoteImagePasteCandidate,
  type RemoteImagePasteCandidate,
} from './remote-image-paste';

export type ImageUploadSource = 'drop' | 'paste';

export type ImageUploadStatus = Readonly<{
  message: string;
  operationId: string;
  type: 'error' | 'info' | 'success';
}>;

type OwnedTextRange = Readonly<{
  baselineValue: string;
  end: number;
  start: number;
}>;

export type RemoteImageImportCoordinator = Readonly<{
  enqueue: (request: Readonly<{
    candidate: RemoteImagePasteCandidate;
    onFailed: () => void;
    onSucceeded: () => void;
    ownedRange: OwnedTextRange;
  }>) => void;
}>;

type CreateImageUploadSessionOptions = Readonly<{
  allowedMimeTypes: ReadonlyArray<ImageUploadMimeType>;
  autoUploadPastedImages: boolean;
  document: ImageUploadDocumentPort;
  enabled: boolean;
  insertion: ImageUploadInsertion;
  maxBytes: number;
  nextOperationId: () => string;
  onDiagnostic: (code: string) => void;
  onStatus: (status: ImageUploadStatus) => void;
  postId: number;
  remoteImageImportCoordinator: RemoteImageImportCoordinator;
  remoteImageUploadMode: RemoteImageUploadMode;
  surface: ImageUploadSurface;
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

function mapOwnedTextRange(owned: OwnedTextRange, currentValue: string): Readonly<{
  end: number;
  start: number;
}> | null {
  if (currentValue === owned.baselineValue) {
    return { end: owned.end, start: owned.start };
  }
  let changeStart = 0;
  while (
    changeStart < owned.baselineValue.length &&
    changeStart < currentValue.length &&
    owned.baselineValue[changeStart] === currentValue[changeStart]
  ) {
    changeStart += 1;
  }
  let unchangedSuffixLength = 0;
  const maximumSuffixLength = Math.min(
    owned.baselineValue.length - changeStart,
    currentValue.length - changeStart,
  );
  while (
    unchangedSuffixLength < maximumSuffixLength &&
    owned.baselineValue[owned.baselineValue.length - unchangedSuffixLength - 1] ===
      currentValue[currentValue.length - unchangedSuffixLength - 1]
  ) {
    unchangedSuffixLength += 1;
  }
  const baselineChangeEnd = owned.baselineValue.length - unchangedSuffixLength;
  if (baselineChangeEnd <= owned.start) {
    const delta = currentValue.length - owned.baselineValue.length;
    return { end: owned.end + delta, start: owned.start + delta };
  }
  if (changeStart >= owned.end) {
    return { end: owned.end, start: owned.start };
  }
  return null;
}

function statusMessage(strings: ImageUploadStrings, source: ImageUploadSource, state: string): string {
  const key = `${source}${state}` as keyof ImageUploadStrings;
  return strings[key];
}

export function remoteImageUploadEnabled(
  mode: RemoteImageUploadMode,
  surface: ImageUploadSurface,
): boolean {
  return 'both' === mode || surface === mode;
}

export function createRemoteImageImportCoordinator({
  document,
  insertion,
  onDiagnostic,
  postId,
  remoteImageImport,
}: Readonly<{
  document: ImageUploadDocumentPort;
  insertion: ImageUploadInsertion;
  onDiagnostic: (code: string) => void;
  postId: number;
  remoteImageImport: RemoteImageImportPort;
}>): RemoteImageImportCoordinator & Readonly<{ destroy: () => void }> {
  let active = true;
  type QueuedRemoteImport = Readonly<{
    controller: AbortController;
    run: () => Promise<void>;
  }>;
  const queue: QueuedRemoteImport[] = [];
  let running: QueuedRemoteImport | null = null;

  const replaceOwnedText = (owned: OwnedTextRange, text: string): boolean => {
    const current = documentSnapshot(document);
    const range = mapOwnedTextRange(owned, current.value);
    if (!range) return false;
    const delta = text.length - (range.end - range.start);
    const mapPosition = (position: number): number => {
      if (position <= range.start) return position;
      if (position >= range.end) return position + delta;
      return range.start + text.length;
    };
    document.applyTextChange({
      selection: {
        direction: current.selection.direction,
        end: mapPosition(current.selection.end),
        start: mapPosition(current.selection.start),
      },
      value: current.value.slice(0, range.start) + text + current.value.slice(range.end),
    });
    return true;
  };

  const runNext = (): void => {
    if (!active || running) return;
    const operation = queue.shift();
    if (!operation) return;
    running = operation;
    void operation.run().catch(() => {
      if (active) onDiagnostic('remote-image-import-queue-failed');
    }).finally(() => {
      if (running === operation) running = null;
      runNext();
    });
  };

  return {
    destroy: () => {
      if (!active) return;
      active = false;
      queue.length = 0;
      running?.controller.abort();
    },
    enqueue: ({ candidate, onFailed, onSucceeded, ownedRange }) => {
      if (!active) {
        onDiagnostic('remote-image-import-coordinator-inactive');
        onFailed();
        return;
      }
      const controller = new AbortController();
      queue.push({
        controller,
        run: async () => {
          try {
            const result = await remoteImageImport.import({
              altText: candidate.altText,
              postId,
              signal: controller.signal,
              url: candidate.url,
            });
            if (!active) {
              onDiagnostic('remote-image-import-completed-after-teardown');
              return;
            }
            if ('failed' === result.status) {
              onFailed();
              return;
            }
            const replaced = replaceOwnedText(ownedRange, imageMarkdownText({
              alt: result.alt,
              title: 'filename' === insertion.titleDisplay ? result.title : '',
              url: result.url,
            }));
            if (!replaced) {
              onDiagnostic('remote-image-import-owned-range-stale');
              onFailed();
              return;
            }
            onSucceeded();
          } catch {
            if (active) {
              onDiagnostic('remote-image-import-operation-failed');
              onFailed();
            }
          }
        },
      });
      runNext();
    },
  };
}

export function createImageUploadSession({
  allowedMimeTypes,
  autoUploadPastedImages,
  document,
  enabled,
  insertion,
  maxBytes,
  nextOperationId,
  onDiagnostic,
  onStatus,
  postId,
  remoteImageImportCoordinator,
  remoteImageUploadMode,
  surface,
  strings,
  target,
  upload,
}: CreateImageUploadSessionOptions): () => void {
  let active = true;
  const activeUploads = new Set<AbortController>();

  const applyInsertion = (
    initial: ImageUploadDocumentSnapshot,
    text: string,
  ): OwnedTextRange => {
    const current = documentSnapshot(document);
    const selection = rebaseSelection(initial, current.value);
    const cursor = selection.start + text.length;
    const value = current.value.slice(0, selection.start) + text + current.value.slice(selection.end);
    document.applyTextChange({
      selection: { direction: selection.direction, end: cursor, start: cursor },
      value,
    });
    document.focus();
    return { baselineValue: value, end: cursor, start: selection.start };
  };

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

    let initial: ImageUploadDocumentSnapshot;
    try {
      initial = documentSnapshot(document);
    } catch {
      onDiagnostic('image-upload-document-snapshot-invalid');
      reportStatus(statusMessage(strings, source, 'Failed'), 'error');
      return;
    }

    reportStatus(statusMessage(strings, source, 'Uploading'), 'info');
    const controller = new AbortController();
    activeUploads.add(controller);
    try {
      const fileNameAlt = defaultImageAlt(file.name, strings.defaultAlt);
      const result = await upload.upload({
        altText: fileNameAlt,
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
      const inserted = imageInsertionText({
        defaultAlt: strings.defaultAlt,
        fileName: file.name,
        insertion,
        url: result.url,
      });
      applyInsertion(initial, inserted);
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

  const handleRemoteImage = (
    event: ClipboardEvent,
    candidate: RemoteImagePasteCandidate,
  ): void => {
    let initial: ImageUploadDocumentSnapshot;
    try {
      initial = documentSnapshot(document);
    } catch {
      onDiagnostic('remote-image-import-document-snapshot-invalid');
      return;
    }

    const operationId = nextOperationId();
    const reportStatus = (message: string, type: ImageUploadStatus['type']) => onStatus({ message, operationId, type });
    let ownedRange: OwnedTextRange;
    try {
      ownedRange = applyInsertion(initial, candidate.fallbackText);
    } catch {
      onDiagnostic('remote-image-import-fallback-insertion-failed');
      return;
    }
    event.preventDefault();
    reportStatus(strings.pasteUploading, 'info');
    remoteImageImportCoordinator.enqueue({
      candidate,
      onFailed: () => reportStatus(strings.pasteFailed, 'error'),
      onSucceeded: () => reportStatus(strings.pasteUploaded, 'success'),
      ownedRange,
    });
  };

  const onPaste = (event: ClipboardEvent) => {
    const file = firstImageFile(event.clipboardData);
    if (!file) {
      if (hasImageFile(event.clipboardData)) {
        return;
      }
      if (
        enabled &&
        remoteImageUploadEnabled(remoteImageUploadMode, surface)
      ) {
        const candidate = remoteImagePasteCandidate(
          event.clipboardData,
          target.ownerDocument,
          surface,
        );
        if (candidate) {
          handleRemoteImage(event, candidate);
        }
      }
      return;
    }
    if (!enabled) {
      event.preventDefault();
      return;
    }
    if (!autoUploadPastedImages) {
      event.preventDefault();
      onStatus({
        message: strings.pasteUploadDisabled,
        operationId: nextOperationId(),
        type: 'info',
      });
      return;
    }
    void handleFile(event, file, 'paste');
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

  target.addEventListener('paste', onPaste, true);
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
    target.removeEventListener('paste', onPaste, true);
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
