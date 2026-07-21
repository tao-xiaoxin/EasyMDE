import { createElement, useLayoutEffect, useRef } from '@wordpress/element';

import {
  createCodeMirrorDocumentSession
} from '../adapters/code-mirror-document-session';
import {
  createNativeTitleSession,
  type NativeTitleSession
} from '../adapters/native-title-session';
import {
  createEditorDocumentSession,
  type EditorDocumentSession
} from '../editor-document-session';

export type { EditorDocumentSession } from '../editor-document-session';

type EditorDocumentSourceProps = Readonly<{
  editorLabel: string;
  onReady: (session: EditorDocumentSession) => void;
  submissionField: HTMLTextAreaElement;
  titleField: HTMLInputElement;
}>;

export function EditorDocumentSource({
  editorLabel,
  onReady,
  submissionField,
  titleField
}: EditorDocumentSourceProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!hostRef.current) {
      throw new Error('react-document-source-host-unavailable');
    }

    const documentSession = createCodeMirrorDocumentSession({
      container: hostRef.current,
      label: editorLabel,
      submissionField
    });
    let titleSession: NativeTitleSession;
    let editorSession: EditorDocumentSession;

    try {
      titleSession = createNativeTitleSession(titleField);
    } catch (error) {
      documentSession.destroy();
      throw error;
    }

    try {
      editorSession = createEditorDocumentSession(documentSession, titleSession);
    } catch (error) {
      titleSession.destroy();
      documentSession.destroy();
      throw error;
    }

    try {
      onReady(editorSession);
    } catch (error) {
      editorSession.destroy();
      throw error;
    }

    return () => {
      try {
        documentSession.flush();
      } finally {
        editorSession.destroy();
      }
    };
  }, [editorLabel, onReady, submissionField, titleField]);

  return (
    <div
      ref={hostRef}
      className="easymde-code-editor"
      data-easymde-react-document-source="ready"
    />
  );
}
