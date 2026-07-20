export type DocumentSourceBootstrap = Readonly<{
  editorLabel: string;
}>;

export class DocumentSourceBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'DocumentSourceBootstrapError';
    this.code = code;
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new DocumentSourceBootstrapError(code);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if ('string' !== typeof value || '' === value.trim()) {
    throw new DocumentSourceBootstrapError(code);
  }

  return value;
}

export function parseDocumentSourceBootstrap(value: unknown): DocumentSourceBootstrap {
  const bootstrap = objectValue(value, 'invalid-bootstrap');
  const strings = objectValue(bootstrap.strings, 'invalid-strings');

  return {
    editorLabel: requiredString(strings.editorLabel, 'invalid-editor-label')
  };
}
