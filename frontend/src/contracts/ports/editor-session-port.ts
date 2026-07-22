export type EditorSessionStatus =
  | 'authentication-required'
  | 'capability-lost'
  | 'connection-lost'
  | 'locked'
  | 'nonce-expired'
  | 'ready';

export type EditorSessionSnapshot = Readonly<{ status: EditorSessionStatus }>;
export type EditorSessionOperation = 'authenticated' | 'post-read' | 'post-write';

export interface EditorSessionPort {
  getSnapshot(): EditorSessionSnapshot;
  subscribe(listener: () => void): () => void;
}

export function protectedEditorOperationError(
  snapshot: EditorSessionSnapshot,
  operation: EditorSessionOperation
): Error | null {
  if (
    'ready' === snapshot.status
    || ('locked' === snapshot.status && 'post-write' !== operation)
    || ('capability-lost' === snapshot.status && 'authenticated' === operation)
  ) {
    return null;
  }
  return new Error(`editor-session-${snapshot.status}`);
}
