import { parseMediaPickerBootstrap } from '../contracts/bootstrap/media-picker-bootstrap';
import type { MediaPickerDocumentPort } from '../contracts/ports/media-picker-port';
import {
  type MediaPickerResult,
  openMediaPickerSession
} from '../features/media-picker/media-picker-session';
import { createWordPressMediaFramePort } from '../integrations/wordpress/media/wordpress-media-frame';

export type MediaPickerOpenOptions = Readonly<{
  document: MediaPickerDocumentPort;
  media: unknown;
}>;

export type AdminEditorMediaPickerBridge = Readonly<{
  open: (options: MediaPickerOpenOptions) => Promise<MediaPickerResult>;
}>;

function validDocumentPort(value: unknown): value is MediaPickerDocumentPort {
  if (!value || 'object' !== typeof value) {
    return false;
  }
  const port = value as Partial<MediaPickerDocumentPort>;

  return 'function' === typeof port.applyTextChange
    && 'function' === typeof port.focus
    && 'function' === typeof port.getSnapshot;
}

export function createAdminEditorMediaPickerBridge(
  value: unknown
): AdminEditorMediaPickerBridge {
  const strings = parseMediaPickerBootstrap(value);
  let activeOperation: Promise<MediaPickerResult> | null = null;

  return {
    open(options: MediaPickerOpenOptions): Promise<MediaPickerResult> {
      if (activeOperation) {
        return activeOperation;
      }
      if (!options || !validDocumentPort(options.document)) {
        return Promise.reject(new Error('media-picker-document-port-invalid'));
      }

      const operation = openMediaPickerSession({
        document: options.document,
        frame: createWordPressMediaFramePort(options.media),
        strings
      });
      activeOperation = operation;
      const clearOperation = () => {
        if (activeOperation === operation) {
          activeOperation = null;
        }
      };
      operation.then(clearOperation, clearOperation);

      return operation;
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactMediaPicker?: Readonly<{
      prepare: typeof createAdminEditorMediaPickerBridge;
    }>;
  }
}

window.EasyMDEReactMediaPicker = {
  prepare: createAdminEditorMediaPickerBridge
};
