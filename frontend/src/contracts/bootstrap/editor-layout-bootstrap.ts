export type EditorLayoutBootstrap = Readonly<{
  direction: 'ltr' | 'rtl';
  status: Readonly<{
    lastEdited: string;
    wordCount: string;
  }>;
}>;

export class EditorLayoutBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'EditorLayoutBootstrapError';
    this.code = code;
  }
}

export function parseEditorLayoutBootstrap(value: unknown): EditorLayoutBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new EditorLayoutBootstrapError('editor-layout-bootstrap-invalid');
  }
  const bootstrap = value as Record<string, unknown>;
  const direction = bootstrap.direction;
  if ('ltr' !== direction && 'rtl' !== direction) {
    throw new EditorLayoutBootstrapError('editor-layout-direction-invalid');
  }
  const status = bootstrap.status;
  if (!status || 'object' !== typeof status || Array.isArray(status)) {
    throw new EditorLayoutBootstrapError('editor-layout-status-invalid');
  }
  const statusValue = status as Record<string, unknown>;
  if (
    'string' !== typeof statusValue.lastEdited
    || '' === statusValue.lastEdited.trim()
    || statusValue.lastEdited.length > 512
    || 'string' !== typeof statusValue.wordCount
    || statusValue.wordCount.length > 256
    || !/%(?:1\$)?s/.test(statusValue.wordCount)
  ) {
    throw new EditorLayoutBootstrapError('editor-layout-status-invalid');
  }
  return {
    direction,
    status: {
      lastEdited: statusValue.lastEdited,
      wordCount: statusValue.wordCount
    }
  };
}
