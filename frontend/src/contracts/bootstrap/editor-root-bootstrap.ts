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
  parseFontControlsState,
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
  parseToolbarBootstrap,
  type ToolbarBootstrap
} from './toolbar-bootstrap';
import {
  parseWechatExportBootstrap,
  type WechatExportBootstrap
} from './wechat-export-bootstrap';

export type EditorRootLocalDraftsBootstrap = LocalDraftsBootstrap &
  Readonly<{
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

export type EditorRootWordPressBootstrap = Readonly<{
  customCssUrl: string;
  nonce: string;
  previewUrl: string;
  revisionsUrl: string;
}>;

export type EditorRootBootstrap = Readonly<{
  appearance: AppearanceBootstrap;
  schemaVersion: 2;
  document: DocumentSourceBootstrap;
  fonts: FontControlsBootstrap;
  imageUpload: ImageUploadBootstrap;
  immersiveStrings: Readonly<{
    autoSave: string;
    autoSaveDescription: string;
    autoSaveEnabled: string;
    cancel: string;
    characters: string;
    close: string;
    column: string;
    edit: string;
    editMode: string;
    editorSettings: string;
    enter: string;
    exit: string;
    hideOutline: string;
    history: string;
    historyEmpty: string;
    historyError: string;
    historyLoading: string;
    historyAll: string;
    historyCount: string;
    historyVersions: string;
    immersive: string;
    insert: string;
    insertTable: string;
    line: string;
    minutes: string;
    manualSave: string;
    moreActions: string;
    markdown: string;
    noHeadings: string;
    outline: string;
    outlineDescription: string;
    preview: string;
    previewMode: string;
    publish: string;
    readingTime: string;
    restore: string;
    restoreConfirm: string;
    restoreThisVersion: string;
    resizeOutline: string;
    saved: string;
    settings: string;
    showOutline: string;
    split: string;
    splitMode: string;
    splitPreview: string;
    splitPreviewDescription: string;
    syncScroll: string;
    syncScrollDescription: string;
    table: string;
    tableColumns: string;
    tableRows: string;
    theme: string;
    themeSettings: string;
    title: string;
    unsaved: string;
    viewModes: string;
    wechat: string;
    wordCount: string;
    wordCountDescription: string;
    words: string;
    addTags: string;
    categories: string;
    categoriesDescription: string;
    categoriesSelected: string;
    closePublish: string;
    continueAddingTags: string;
    excerpt: string;
    excerptPlaceholder: string;
    featuredImage: string;
    imageRecommendation: string;
    imageRequirements: string;
    noWriteBeforeSubmit: string;
    password: string;
    passwordPlaceholder: string;
    passwordRequired: string;
    preparingPublish: string;
    private: string;
    privateDescription: string;
    public: string;
    publishDescription: string;
    remove: string;
    removeTag: string;
    replace: string;
    selectFeaturedImage: string;
    sticky: string;
    tags: string;
    tagsDescription: string;
    updateArticle: string;
    updateDescription: string;
    updateExisting: string;
    visibility: string;
  }>;
  layout: EditorLayoutBootstrap;
  localDrafts: EditorRootLocalDraftsBootstrap;
  labels: Readonly<{
    mediaPickerFailure: string;
    preview: string;
    source: string;
    toolbar: string;
  }>;
  preview: EditorRootPreviewBootstrap;
  previewEnhancement: PreviewEnhancementBootstrap;
  mediaPicker: MediaPickerBootstrap;
  toolbar: ToolbarBootstrap;
  wechatExport: WechatExportBootstrap;
  wordpress: EditorRootWordPressBootstrap;
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
    'string' !== typeof value ||
    value.length > maxLength ||
    (!options.allowEmpty && '' === value.trim())
  ) {
    throw new EditorRootBootstrapError(code);
  }
  return value;
}

function unboundedString(
  value: unknown,
  code: string,
  allowEmpty = false
): string {
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
      !isPreviewFeatureKey(key) ||
      !/^[a-z0-9_-]{1,64}$/i.test(key) ||
      'boolean' !== typeof enabled
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
    html: unboundedString(
      preview.html,
      'editor-root-preview-invalid',
      true
    ) as SafePreviewHtml,
    messages: {
      empty: boundedString(messages.empty, 'editor-root-preview-invalid'),
      error: boundedString(messages.error, 'editor-root-preview-invalid'),
      rendering: boundedString(
        messages.rendering,
        'editor-root-preview-invalid'
      )
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

function parseWordPress(value: unknown): EditorRootWordPressBootstrap {
  const wordpress = objectValue(value, 'editor-root-wordpress-invalid');
  return {
    customCssUrl: boundedString(
      wordpress.customCssUrl,
      'editor-root-wordpress-invalid',
      {
        maxLength: 4096
      }
    ),
    nonce: boundedString(wordpress.nonce, 'editor-root-wordpress-invalid'),
    previewUrl: boundedString(
      wordpress.previewUrl,
      'editor-root-wordpress-invalid',
      {
        maxLength: 4096
      }
    ),
    revisionsUrl: boundedString(
      wordpress.revisionsUrl,
      'editor-root-wordpress-invalid',
      { maxLength: 4096 }
    )
  };
}

export function parseEditorRootBootstrap(value: unknown): EditorRootBootstrap {
  const bootstrap = objectValue(value, 'editor-root-bootstrap-invalid');
  if (2 !== bootstrap.schemaVersion) {
    throw new EditorRootBootstrapError('editor-root-schema-unsupported');
  }
  const labels = objectValue(bootstrap.strings, 'editor-root-label-invalid');
  const immersive = objectValue(
    labels.immersive,
    'editor-root-immersive-label-invalid'
  );
  let document: DocumentSourceBootstrap;
  let appearance: AppearanceBootstrap;
  let fonts: FontControlsBootstrap;
  let imageUpload: ImageUploadBootstrap;
  let layout: EditorLayoutBootstrap;
  let localDrafts: EditorRootLocalDraftsBootstrap;
  let mediaPicker: MediaPickerBootstrap;
  let previewEnhancement: PreviewEnhancementBootstrap;
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
    for (const theme of appearance.articleThemes) {
      if (theme.fontDefaults) {
        parseFontControlsState(theme.fontDefaults, fonts.options);
      }
    }
  } catch {
    throw new EditorRootBootstrapError('editor-root-appearance-invalid');
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
    previewEnhancement = parsePreviewEnhancementBootstrap(
      bootstrap.previewEnhancement
    );
  } catch {
    throw new EditorRootBootstrapError(
      'editor-root-preview-enhancement-invalid'
    );
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
    schemaVersion: 2,
    document,
    fonts,
    imageUpload,
    immersiveStrings: Object.fromEntries(
      [
        'autoSave',
        'autoSaveDescription',
        'autoSaveEnabled',
        'cancel',
        'characters',
        'close',
        'column',
        'edit',
        'editMode',
        'editorSettings',
        'enter',
        'exit',
        'hideOutline',
        'history',
        'historyEmpty',
        'historyError',
        'historyLoading',
        'historyAll',
        'historyCount',
        'historyVersions',
        'immersive',
        'insert',
        'insertTable',
        'line',
        'minutes',
        'manualSave',
        'moreActions',
        'markdown',
        'noHeadings',
        'outline',
        'outlineDescription',
        'preview',
        'previewMode',
        'publish',
        'readingTime',
        'restore',
        'restoreConfirm',
        'restoreThisVersion',
        'resizeOutline',
        'saved',
        'settings',
        'showOutline',
        'split',
        'splitMode',
        'splitPreview',
        'splitPreviewDescription',
        'syncScroll',
        'syncScrollDescription',
        'table',
        'tableColumns',
        'tableRows',
        'theme',
        'themeSettings',
        'title',
        'unsaved',
        'viewModes',
        'wechat',
        'wordCount',
        'wordCountDescription',
        'words',
        'addTags',
        'categories',
        'categoriesDescription',
        'categoriesSelected',
        'closePublish',
        'continueAddingTags',
        'excerpt',
        'excerptPlaceholder',
        'featuredImage',
        'imageRecommendation',
        'imageRequirements',
        'noWriteBeforeSubmit',
        'password',
        'passwordPlaceholder',
        'passwordRequired',
        'preparingPublish',
        'private',
        'privateDescription',
        'public',
        'publishDescription',
        'remove',
        'removeTag',
        'replace',
        'selectFeaturedImage',
        'sticky',
        'tags',
        'tagsDescription',
        'updateArticle',
        'updateDescription',
        'updateExisting',
        'visibility'
      ].map((key) => [
        key,
        boundedString(immersive[key], 'editor-root-immersive-label-invalid')
      ])
    ) as EditorRootBootstrap['immersiveStrings'],
    layout,
    localDrafts,
    labels: {
      mediaPickerFailure: boundedString(
        labels.mediaPickerFailure,
        'editor-root-label-invalid'
      ),
      preview: boundedString(labels.preview, 'editor-root-label-invalid'),
      source: boundedString(labels.source, 'editor-root-label-invalid'),
      toolbar: boundedString(labels.toolbar, 'editor-root-label-invalid')
    },
    preview: parsePreview(bootstrap.preview),
    previewEnhancement,
    mediaPicker,
    toolbar,
    wechatExport,
    wordpress: parseWordPress(bootstrap.wordpress)
  };
}
