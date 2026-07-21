import {
  isPreviewFeatureKey,
  type PreviewFeatures,
  type SafePreviewHtml
} from '../ports/preview-request';
import {
  parseAppearanceBootstrap,
  type AppearanceBootstrap
} from './appearance-bootstrap';
import {
  parseDocumentSourceBootstrap,
  type DocumentSourceBootstrap
} from './document-source-bootstrap';
import {
  parseFontControlsBootstrap,
  type FontControlsBootstrap
} from './font-controls-bootstrap';
import {
  parseImageUploadBootstrap,
  type ImageUploadBootstrap
} from './image-upload-bootstrap';
import {
  parseEditorLayoutBootstrap,
  type EditorLayoutBootstrap
} from './editor-layout-bootstrap';
import {
  parseMediaPickerBootstrap,
  type MediaPickerBootstrap
} from './media-picker-bootstrap';
import {
  parseLocalDraftsBootstrap,
  type LocalDraftsBootstrap
} from './local-drafts-bootstrap';
import {
  parsePreviewEnhancementBootstrap,
  type PreviewEnhancementBootstrap
} from './preview-enhancement-bootstrap';
import {
  parsePublishingBootstrap,
  type PublishingBootstrap
} from './publishing-bootstrap';
import {
  parseRevisionsBootstrap,
  type RevisionsBootstrap
} from './revisions-bootstrap';
import {
  parseToolbarBootstrap,
  type ToolbarBootstrap
} from './toolbar-bootstrap';
import {
  parseWechatExportBootstrap,
  type WechatExportBootstrap
} from './wechat-export-bootstrap';

export type EditorRootLocalDraftsBootstrap = LocalDraftsBootstrap & Readonly<{
  savedFingerprint: string;
}>;

export type EditorRootPreviewBootstrap = Readonly<{
  features: PreviewFeatures;
  html: SafePreviewHtml;
  messages: Readonly<{
    empty: string;
    error: string;
    rendering: string;
  }>;
  postId: number;
  signature: string;
}>;

export type EditorRootBootstrap = Readonly<{
  appearance: AppearanceBootstrap;
  schemaVersion: 1;
  document: DocumentSourceBootstrap;
  fonts: FontControlsBootstrap;
  imageUpload: ImageUploadBootstrap;
  layout: EditorLayoutBootstrap;
  localDrafts: EditorRootLocalDraftsBootstrap;
  labels: Readonly<{
    preview: string;
    source: string;
    toolbar: string;
  }>;
  preview: EditorRootPreviewBootstrap;
  previewEnhancement: PreviewEnhancementBootstrap;
  publishing: PublishingBootstrap;
  revisions: RevisionsBootstrap;
  mediaPicker: MediaPickerBootstrap;
  toolbar: ToolbarBootstrap;
  wechatExport: WechatExportBootstrap;
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
    features: parseFeatures(preview.features),
    html: unboundedString(preview.html, 'editor-root-preview-invalid', true) as SafePreviewHtml,
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

function parseLocalDrafts(value: unknown): EditorRootLocalDraftsBootstrap {
  const localDrafts = objectValue(value, 'editor-root-local-drafts-invalid');
  const parsed = parseLocalDraftsBootstrap(localDrafts);
  return {
    ...parsed,
    savedFingerprint: boundedString(
      localDrafts.savedFingerprint,
      'editor-root-local-drafts-invalid',
      { allowEmpty: true, maxLength: 128 }
    )
  };
}

export function parseEditorRootBootstrap(value: unknown): EditorRootBootstrap {
  const bootstrap = objectValue(value, 'editor-root-bootstrap-invalid');
  if (1 !== bootstrap.schemaVersion) {
    throw new EditorRootBootstrapError('editor-root-schema-unsupported');
  }
  const labels = objectValue(bootstrap.strings, 'editor-root-label-invalid');
  let document: DocumentSourceBootstrap;
  let appearance: AppearanceBootstrap;
  let fonts: FontControlsBootstrap;
  let imageUpload: ImageUploadBootstrap;
  let layout: EditorLayoutBootstrap;
  let localDrafts: EditorRootLocalDraftsBootstrap;
  let mediaPicker: MediaPickerBootstrap;
  let previewEnhancement: PreviewEnhancementBootstrap;
  let publishing: PublishingBootstrap;
  let revisions: RevisionsBootstrap;
  let toolbar: ToolbarBootstrap;
  let wechatExport: WechatExportBootstrap;

  try {
    appearance = parseAppearanceBootstrap(bootstrap.appearance);
  } catch {
    throw new EditorRootBootstrapError('editor-root-appearance-invalid');
  }
  try {
    document = parseDocumentSourceBootstrap(bootstrap.document);
  } catch {
    throw new EditorRootBootstrapError('editor-root-document-invalid');
  }
  try {
    fonts = parseFontControlsBootstrap(bootstrap.fonts);
  } catch {
    throw new EditorRootBootstrapError('editor-root-fonts-invalid');
  }
  try {
    imageUpload = parseImageUploadBootstrap(bootstrap.imageUpload);
  } catch {
    throw new EditorRootBootstrapError('editor-root-image-upload-invalid');
  }
  try {
    layout = parseEditorLayoutBootstrap(bootstrap.layout);
  } catch {
    throw new EditorRootBootstrapError('editor-root-layout-invalid');
  }
  try {
    localDrafts = parseLocalDrafts(bootstrap.localDrafts);
  } catch {
    throw new EditorRootBootstrapError('editor-root-local-drafts-invalid');
  }
  try {
    mediaPicker = parseMediaPickerBootstrap(bootstrap.mediaPicker);
  } catch {
    throw new EditorRootBootstrapError('editor-root-media-picker-invalid');
  }
  try {
    previewEnhancement = parsePreviewEnhancementBootstrap(bootstrap.previewEnhancement);
  } catch {
    throw new EditorRootBootstrapError('editor-root-preview-enhancement-invalid');
  }
  try {
    publishing = parsePublishingBootstrap(bootstrap.publishing);
  } catch {
    throw new EditorRootBootstrapError('editor-root-publishing-invalid');
  }
  try {
    revisions = parseRevisionsBootstrap(bootstrap.revisions);
  } catch {
    throw new EditorRootBootstrapError('editor-root-revisions-invalid');
  }
  try {
    toolbar = parseToolbarBootstrap(bootstrap.toolbar);
  } catch {
    throw new EditorRootBootstrapError('editor-root-toolbar-invalid');
  }
  try {
    wechatExport = parseWechatExportBootstrap(bootstrap.wechatExport);
  } catch {
    throw new EditorRootBootstrapError('editor-root-wechat-export-invalid');
  }

  return {
    appearance,
    schemaVersion: 1,
    document,
    fonts,
    imageUpload,
    layout,
    localDrafts,
    labels: {
      preview: boundedString(labels.preview, 'editor-root-label-invalid'),
      source: boundedString(labels.source, 'editor-root-label-invalid'),
      toolbar: boundedString(labels.toolbar, 'editor-root-label-invalid')
    },
    preview: parsePreview(bootstrap.preview),
    previewEnhancement,
    publishing,
    revisions,
    mediaPicker,
    toolbar,
    wechatExport
  };
}
