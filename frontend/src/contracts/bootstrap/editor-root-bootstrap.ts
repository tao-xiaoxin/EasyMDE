import {
  isPreviewFeatureKey,
  type PreviewFeatures,
  type SafePreviewHtml
} from '../ports/preview-request';
import type { NativePublishCategory } from '../ports/native-publish-port';
import type {
  GeneralSettings,
  MarkdownSettings,
  SummaryMode
} from '../settings-center-settings';
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
  }>;
  postId: number;
  signature: string;
}>;

export type EditorRootWordPressBootstrap = Readonly<{
  customCssUrl: string;
  isNewPost: boolean;
  nonce: string;
  previewUrl: string;
  publishCategories: ReadonlyArray<NativePublishCategory>;
  revisionsUrl: string;
}>;

export type EditorRootSettingsBootstrap = Readonly<{
  general: GeneralSettings;
  markdown: Pick<MarkdownSettings, 'wordWrap'>;
}>;

export type EditorRootBootstrap = Readonly<{
  appearance: AppearanceBootstrap;
  schemaVersion: 2;
  document: DocumentSourceBootstrap;
  fonts: FontControlsBootstrap;
  imageUpload: ImageUploadBootstrap;
  settings: EditorRootSettingsBootstrap;
  immersiveStrings: Readonly<{
    autoSave: string;
    autoSaveDescription: string;
    autoSaveEnabled: string;
    articleOutline: string;
    cancel: string;
    close: string;
    column: string;
    edit: string;
    editMode: string;
    editorSettings: string;
    enter: string;
    expand: string;
    exit: string;
    hideOutline: string;
    history: string;
    historyEmpty: string;
    historyError: string;
    historyLoading: string;
    historyAll: string;
    historyVersions: string;
    immersive: string;
    insert: string;
    insertTable: string;
    line: string;
    manualSave: string;
    moreActions: string;
    markdown: string;
    noHeadings: string;
    outline: string;
    outlineDescription: string;
    preview: string;
    previewChangesRecorded: string;
    previewContentLoaded: string;
    previewEditable: string;
    previewEditorLabel: string;
    previewLockReadOnly: string;
    previewReadOnly: string;
    previewUnlockEdit: string;
    previewMode: string;
    publish: string;
    restore: string;
    restoreConfirm: string;
    restoreThisVersion: string;
    resizeOutline: string;
    resizeSplit: string;
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
    wechatCopied: string;
    wordCount: string;
    wordCountDescription: string;
    addTags: string;
    categories: string;
    categoriesDescription: string;
    categoriesSelected: string;
    closePublish: string;
    collapse: string;
    continueAddingTags: string;
    excerpt: string;
    excerptPlaceholder: string;
    featuredImage: string;
    imageRecommendation: string;
    imageRequirements: string;
    noWriteBeforeSubmit: string;
    openAfterPublish: string;
    openAfterPublishDescription: string;
    openAfterUpdate: string;
    password: string;
    passwordPlaceholder: string;
    passwordRequired: string;
    preparingPublish: string;
    private: string;
    privateDescription: string;
    public: string;
    publishDescription: string;
    publishFailed: string;
    publishLoadingPreview: string;
    publishOptions: string;
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
      error: boundedString(messages.error, 'editor-root-preview-invalid')
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
  if ('boolean' !== typeof wordpress.isNewPost) {
    throw new EditorRootBootstrapError('editor-root-wordpress-invalid');
  }
  return {
    customCssUrl: boundedString(
      wordpress.customCssUrl,
      'editor-root-wordpress-invalid',
      {
        maxLength: 4096
      }
    ),
    isNewPost: wordpress.isNewPost,
    nonce: boundedString(wordpress.nonce, 'editor-root-wordpress-invalid'),
    publishCategories: parsePublishCategories(wordpress.publishCategories),
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

function parsePublishCategories(
  value: unknown,
  depth = 0
): ReadonlyArray<NativePublishCategory> {
  if (!Array.isArray(value) || value.length > 5000 || depth > 32) {
    throw new EditorRootBootstrapError('editor-root-wordpress-invalid');
  }
  return value.map((candidate) => {
    const category = objectValue(candidate, 'editor-root-wordpress-invalid');
    return {
      children: parsePublishCategories(category.children, depth + 1),
      id: boundedString(category.id, 'editor-root-wordpress-invalid', {
        maxLength: 32
      }),
      label: boundedString(category.label, 'editor-root-wordpress-invalid', {
        maxLength: 256
      })
    };
  });
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
  let settings: EditorRootSettingsBootstrap;
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
    const settingsValue = objectValue(
      bootstrap.settings,
      'editor-root-settings-invalid'
    );
    const general = objectValue(
      settingsValue.general,
      'editor-root-settings-invalid'
    );
    const markdown = objectValue(
      settingsValue.markdown,
      'editor-root-settings-invalid'
    );
    const stringFields = [
      'interfaceLanguage',
      'editingMode',
      'statusBarMode',
      'autoSaveInterval',
      'publishVisibility',
      'summaryMode'
    ] as const;
    const booleanFields = [
      'autoFocusEditor',
      'showLineNumbers',
      'syntaxHighlight',
      'autoSave',
      'syncScroll',
      'openPreviewAfterPublish',
      'featuredImagePlaceholder'
    ] as const;
    const allowedValues: Readonly<Record<string, ReadonlySet<string>>> = {
      autoSaveInterval: new Set(['30', '60', '120', '300']),
      editingMode: new Set(['live-preview', 'source', 'preview']),
      interfaceLanguage: new Set(['zh-CN', 'zh-TW', 'en-US']),
      publishVisibility: new Set(['public', 'private', 'password']),
      statusBarMode: new Set(['words-reading-time', 'words', 'hidden']),
      summaryMode: new Set(['auto-55', 'auto-100', 'manual'])
    };
    const removedGeneralFields = [
      'cleanPastedContent',
      'smartListRecognition',
      'defaultCategory'
    ] as const;
    if (
      removedGeneralFields.some((key) =>
        // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
        Object.prototype.hasOwnProperty.call(general, key)
      ) ||
      stringFields.some((key) => 'string' !== typeof general[key]) ||
      booleanFields.some((key) => 'boolean' !== typeof general[key]) ||
      'boolean' !== typeof markdown.wordWrap ||
      stringFields.some(
        (key) => !allowedValues[key]?.has(general[key] as string)
      )
    ) {
      throw new Error('editor-root-settings-invalid');
    }
    settings = {
      general: {
        autoFocusEditor: general.autoFocusEditor as boolean,
        autoSave: general.autoSave as boolean,
        autoSaveInterval: general.autoSaveInterval as string,
        editingMode: general.editingMode as string,
        featuredImagePlaceholder: general.featuredImagePlaceholder as boolean,
        interfaceLanguage: general.interfaceLanguage as string,
        openPreviewAfterPublish: general.openPreviewAfterPublish as boolean,
        publishVisibility: general.publishVisibility as string,
        showLineNumbers: general.showLineNumbers as boolean,
        statusBarMode: general.statusBarMode as string,
        summaryMode: general.summaryMode as SummaryMode,
        syncScroll: general.syncScroll as boolean,
        syntaxHighlight: general.syntaxHighlight as boolean
      } satisfies GeneralSettings,
      markdown: { wordWrap: markdown.wordWrap }
    };
  } catch {
    throw new EditorRootBootstrapError('editor-root-settings-invalid');
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
    settings,
    immersiveStrings: Object.fromEntries(
      [
        'autoSave',
        'autoSaveDescription',
        'autoSaveEnabled',
        'articleOutline',
        'cancel',
        'close',
        'column',
        'edit',
        'editMode',
        'editorSettings',
        'enter',
        'expand',
        'exit',
        'hideOutline',
        'history',
        'historyEmpty',
        'historyError',
        'historyLoading',
        'historyAll',
        'historyVersions',
        'immersive',
        'insert',
        'insertTable',
        'line',
        'manualSave',
        'moreActions',
        'markdown',
        'noHeadings',
        'outline',
        'outlineDescription',
        'preview',
        'previewChangesRecorded',
        'previewContentLoaded',
        'previewEditable',
        'previewEditorLabel',
        'previewLockReadOnly',
        'previewReadOnly',
        'previewUnlockEdit',
        'previewMode',
        'publish',
        'restore',
        'restoreConfirm',
        'restoreThisVersion',
        'resizeOutline',
        'resizeSplit',
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
        'wechatCopied',
        'wordCount',
        'wordCountDescription',
        'addTags',
        'categories',
        'categoriesDescription',
        'categoriesSelected',
        'closePublish',
        'collapse',
        'continueAddingTags',
        'excerpt',
        'excerptPlaceholder',
        'featuredImage',
        'imageRecommendation',
        'imageRequirements',
        'noWriteBeforeSubmit',
        'openAfterPublish',
        'openAfterPublishDescription',
        'openAfterUpdate',
        'password',
        'passwordPlaceholder',
        'passwordRequired',
        'preparingPublish',
        'private',
        'privateDescription',
        'public',
        'publishDescription',
        'publishFailed',
        'publishLoadingPreview',
        'publishOptions',
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
