export type EditorLayoutBootstrap = Readonly<{
  direction: 'ltr' | 'rtl';
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
  const direction = (value as Record<string, unknown>).direction;
  if ('ltr' !== direction && 'rtl' !== direction) {
    throw new EditorLayoutBootstrapError('editor-layout-direction-invalid');
  }
  return { direction };
}
