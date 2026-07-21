import { parseImageUploadBootstrap } from '../contracts/bootstrap/image-upload-bootstrap';
import type { ImageUploadDocumentPort } from '../contracts/ports/image-upload-port';
import {
  createImageUploadSession,
  type ImageUploadStatus
} from '../features/image-upload/image-upload-session';
import { createWordPressImageUploadPort } from '../integrations/wordpress/media/wordpress-image-upload';

export type ImageUploadActivateOptions = Readonly<{
  document: ImageUploadDocumentPort;
  onDiagnostic: (code: string) => void;
  onStatus: (status: ImageUploadStatus) => void;
  target: HTMLElement;
}>;

export type AdminEditorImageUploadBridge = Readonly<{
  activate: (options: ImageUploadActivateOptions) => () => void;
}>;

function validDocumentPort(value: unknown): value is ImageUploadDocumentPort {
  if (!value || 'object' !== typeof value) {
    return false;
  }
  const port = value as Partial<ImageUploadDocumentPort>;
  return 'function' === typeof port.applyTextChange
    && 'function' === typeof port.focus
    && 'function' === typeof port.getSnapshot;
}

export function createAdminEditorImageUploadBridge(
  value: unknown,
  runtime: Readonly<{ apiFetch: unknown; formData: unknown }>
): AdminEditorImageUploadBridge {
  const bootstrap = parseImageUploadBootstrap(value);
  const upload = createWordPressImageUploadPort({
    apiFetch: runtime.apiFetch,
    endpoint: bootstrap.endpoint,
    formData: runtime.formData,
    nonce: bootstrap.nonce
  });

  return {
    activate(options: ImageUploadActivateOptions): () => void {
      if (
        !options
        || !(options.target instanceof HTMLElement)
        || !validDocumentPort(options.document)
        || 'function' !== typeof options.onDiagnostic
        || 'function' !== typeof options.onStatus
      ) {
        throw new Error('image-upload-activation-invalid');
      }
      return createImageUploadSession({
        document: options.document,
        enabled: bootstrap.enabled,
        maxBytes: bootstrap.maxBytes,
        onDiagnostic: options.onDiagnostic,
        onStatus: options.onStatus,
        postId: bootstrap.postId,
        strings: bootstrap.strings,
        target: options.target,
        upload
      });
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactImageUpload?: Readonly<{
      prepare: (value: unknown) => AdminEditorImageUploadBridge;
    }>;
  }
}

window.EasyMDEReactImageUpload = {
  prepare: (value) => createAdminEditorImageUploadBridge(value, {
    apiFetch: (window as Window & { wp?: { apiFetch?: unknown } }).wp?.apiFetch,
    formData: window.FormData
  })
};
