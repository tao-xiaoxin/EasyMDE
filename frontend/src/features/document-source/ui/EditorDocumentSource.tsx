import { createElement, useLayoutEffect, useRef } from '@wordpress/element';

import {
  createCodeMirrorDocumentSession,
  type CodeMirrorDocumentSession
} from '../adapters/code-mirror-document-session';
import {
  createNativeTitleSession,
  type NativeTitleSession
} from '../adapters/native-title-session';

export type EditorDocumentSession = Readonly<{
  document: CodeMirrorDocumentSession;
  title: NativeTitleSession;
}>;

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
    let titleSession: NativeTitleSession | null = null;

    try {
      titleSession = createNativeTitleSession(titleField);
      onReady({
        document: documentSession,
        title: titleSession
      });
    } catch (error) {
      titleSession?.destroy();
      documentSession.destroy();
      throw error;
    }

    return () => {
      try {
        documentSession.flush();
      } finally {
        titleSession.destroy();
        documentSession.destroy();
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
