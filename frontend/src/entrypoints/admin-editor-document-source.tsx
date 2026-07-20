import { createElement, createRoot } from '@wordpress/element';

import { DocumentSourceErrorBoundary } from '../app/editor/DocumentSourceErrorBoundary';
import { parseDocumentSourceBootstrap } from '../contracts/bootstrap/document-source-bootstrap';
import {
  EditorDocumentSource,
  type EditorDocumentSession
} from '../features/document-source/ui/EditorDocumentSource';

export class DocumentSourceBridgeError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'DocumentSourceBridgeError';
    this.code = code;
  }
}

export type DocumentSourceMountOptions = Readonly<{
  container: HTMLElement;
  onFailure: () => void;
  onReady: (session: EditorDocumentSession) => void;
  submissionField: HTMLTextAreaElement;
  titleField: HTMLInputElement;
}>;

export type AdminEditorDocumentSourceBridge = Readonly<{
  mount: (options: DocumentSourceMountOptions) => () => void;
}>;

function validateMountOptions(options: DocumentSourceMountOptions): void {
  if (!(options.container instanceof HTMLElement) || options.container.childNodes.length) {
    throw new DocumentSourceBridgeError('invalid-container');
  }
  if (!(options.submissionField instanceof HTMLTextAreaElement)) {
    throw new DocumentSourceBridgeError('invalid-submission-field');
  }
  if (!(options.titleField instanceof HTMLInputElement)) {
    throw new DocumentSourceBridgeError('invalid-title-field');
  }
  if ('function' !== typeof options.onFailure || 'function' !== typeof options.onReady) {
    throw new DocumentSourceBridgeError('invalid-callback');
  }
}

export function createAdminEditorDocumentSourceBridge(
  value: unknown
): AdminEditorDocumentSourceBridge {
  const bootstrap = parseDocumentSourceBootstrap(value);

  return {
    mount(options: DocumentSourceMountOptions): () => void {
      validateMountOptions(options);
      const root = createRoot(options.container);
      let active = true;

      root.render(
        <DocumentSourceErrorBoundary onFailure={options.onFailure}>
          <EditorDocumentSource
            editorLabel={bootstrap.editorLabel}
            onReady={options.onReady}
            submissionField={options.submissionField}
            titleField={options.titleField}
          />
        </DocumentSourceErrorBoundary>
      );

      return () => {
        if (!active) {
          return;
        }
        active = false;
        root.unmount();
      };
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactDocumentSource?: Readonly<{
      prepare: typeof createAdminEditorDocumentSourceBridge;
    }>;
  }
}

window.EasyMDEReactDocumentSource = {
  prepare: createAdminEditorDocumentSourceBridge
};
