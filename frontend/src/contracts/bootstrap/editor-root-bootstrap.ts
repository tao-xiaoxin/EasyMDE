import {
  isPreviewFeatureKey,
  type PreviewFeatures,
  type SafePreviewHtml
} from '../ports/preview-request';
import {
  parseDocumentSourceBootstrap,
  type DocumentSourceBootstrap
} from './document-source-bootstrap';
import {
  parseToolbarBootstrap,
  type ToolbarBootstrap
} from './toolbar-bootstrap';

export type EditorRootPreviewBootstrap = Readonly<{
  codeTheme: string;
  customCssId: string;
  features: PreviewFeatures;
  html: SafePreviewHtml;
  markdownTheme: string;
  messages: Readonly<{
    empty: string;
    error: string;
    rendering: string;
  }>;
  postId: number;
  signature: string;
}>;

export type EditorRootBootstrap = Readonly<{
  schemaVersion: 1;
  document: DocumentSourceBootstrap;
  labels: Readonly<{
    preview: string;
    source: string;
    toolbar: string;
  }>;
  preview: EditorRootPreviewBootstrap;
  toolbar: ToolbarBootstrap;
}>;

export class EditorRootBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'EditorRootBootstrapError';
    this.code = code;
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new EditorRootBootstrapError(code);
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  code: string,
  options: Readonly<{ allowEmpty?: boolean; maxLength?: number }> = {}
): string {
  const maxLength = options.maxLength ?? 512;
  if (
    'string' !== typeof value
    || value.length > maxLength
    || (!options.allowEmpty && '' === value.trim())
  ) {
    throw new EditorRootBootstrapError(code);
  }
  return value;
}

function identifier(value: unknown, code: string, allowEmpty = false): string {
  const id = boundedString(value, code, { allowEmpty, maxLength: 200 });
  if (id && !/^[a-z0-9_-]+$/i.test(id)) {
    throw new EditorRootBootstrapError(code);
  }
  return id;
}

function unboundedString(value: unknown, code: string, allowEmpty = false): string {
  if ('string' !== typeof value || (!allowEmpty && '' === value.trim())) {
    throw new EditorRootBootstrapError(code);
  }
  return value;
}

function parseFeatures(value: unknown): PreviewFeatures {
  const source = objectValue(value, 'editor-root-preview-invalid');
  const entries = Object.entries(source);
  const features: Record<string, boolean> = {};
  for (const [key, enabled] of entries) {
    if (
      !isPreviewFeatureKey(key)
      || !/^[a-z0-9_-]{1,64}$/i.test(key)
      || 'boolean' !== typeof enabled
    ) {
      throw new EditorRootBootstrapError('editor-root-preview-invalid');
    }
    features[key] = enabled;
  }
  return features;
}

function parsePreview(value: unknown): EditorRootPreviewBootstrap {
  const preview = objectValue(value, 'editor-root-preview-invalid');
  const messages = objectValue(preview.messages, 'editor-root-preview-invalid');
  if (!Number.isInteger(preview.postId) || Number(preview.postId) < 0) {
    throw new EditorRootBootstrapError('editor-root-preview-invalid');
  }

  return {
    codeTheme: identifier(preview.codeTheme, 'editor-root-preview-invalid'),
    customCssId: identifier(preview.customCssId, 'editor-root-preview-invalid', true),
    features: parseFeatures(preview.features),
    html: unboundedString(preview.html, 'editor-root-preview-invalid', true) as SafePreviewHtml,
    markdownTheme: identifier(preview.markdownTheme, 'editor-root-preview-invalid'),
    messages: {
      empty: boundedString(messages.empty, 'editor-root-preview-invalid'),
      error: boundedString(messages.error, 'editor-root-preview-invalid'),
      rendering: boundedString(messages.rendering, 'editor-root-preview-invalid')
    },
    postId: Number(preview.postId),
    signature: boundedString(preview.signature, 'editor-root-preview-invalid', {
      allowEmpty: true,
      maxLength: 256
    })
  };
}

export function parseEditorRootBootstrap(value: unknown): EditorRootBootstrap {
  const bootstrap = objectValue(value, 'editor-root-bootstrap-invalid');
  if (1 !== bootstrap.schemaVersion) {
    throw new EditorRootBootstrapError('editor-root-schema-unsupported');
  }
  const labels = objectValue(bootstrap.strings, 'editor-root-label-invalid');
  let document: DocumentSourceBootstrap;
  let toolbar: ToolbarBootstrap;

  try {
    document = parseDocumentSourceBootstrap(bootstrap.document);
  } catch {
    throw new EditorRootBootstrapError('editor-root-document-invalid');
  }
  try {
    toolbar = parseToolbarBootstrap(bootstrap.toolbar);
  } catch {
    throw new EditorRootBootstrapError('editor-root-toolbar-invalid');
  }

  return {
    schemaVersion: 1,
    document,
    labels: {
      preview: boundedString(labels.preview, 'editor-root-label-invalid'),
      source: boundedString(labels.source, 'editor-root-label-invalid'),
      toolbar: boundedString(labels.toolbar, 'editor-root-label-invalid')
    },
    preview: parsePreview(bootstrap.preview),
    toolbar
  };
}
