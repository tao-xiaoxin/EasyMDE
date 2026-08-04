export type GeneralSettings = Readonly<{
  interfaceLanguage: string;
  editingMode: string;
  autoFocusEditor: boolean;
  showLineNumbers: boolean;
  syntaxHighlight: boolean;
  statusBarMode: string;
  autoSave: boolean;
  autoSaveInterval: string;
  syncScroll: boolean;
  cleanPastedContent: boolean;
  smartListRecognition: boolean;
  defaultCategory: string;
  publishVisibility: string;
  openPreviewAfterPublish: boolean;
  summaryMode: string;
  featuredImagePlaceholder: boolean;
}>;

export type ImageUploadFormat = 'jpg' | 'png' | 'webp' | 'gif';

export type ImageSettings = Readonly<{
  service: string;
  bucket: string;
  domain: string;
  accessKey: string;
  secretKey: string;
  fileNameRule: string;
  backupEnabled: boolean;
  backupService: string;
  backupBucket: string;
  backupDomain: string;
  backupAccessKey: string;
  backupSecretKey: string;
  backupSameObjectKey: boolean;
  backupFailureMode: string;
  insertMarkdown: boolean;
  compressImages: boolean;
  preserveFileName: boolean;
  copyUrl: boolean;
  retryCount: string;
  maxImageSize: string;
  uploadFormats: Readonly<Record<ImageUploadFormat, boolean>>;
  insertFormat: string;
  altSource: string;
  captionMode: string;
  featuredPlaceholder: boolean;
}>;

export type MarkdownSettings = Readonly<{
  livePreview: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  fixedToolbar: boolean;
  editorTheme: string;
  editorFontSize: string;
  editorFont: string;
  githubFlavor: boolean;
  smartPunctuation: boolean;
  tableAlignment: string;
  codeTheme: string;
  codeLineNumbers: string;
  taskLists: boolean;
  emoji: boolean;
  math: boolean;
  htmlRendering: boolean;
  tableExtension: boolean;
  footnotes: boolean;
  definitionLists: boolean;
  toc: boolean;
  imageSizeSyntax: boolean;
  pasteAsMarkdown: boolean;
  lineEnding: string;
  unorderedMarker: string;
  orderedStart: string;
  blockquoteStyle: string;
}>;

export type ShortcutId =
  | 'save'
  | 'bold'
  | 'italic'
  | 'link'
  | 'image'
  | 'heading-one'
  | 'heading-two'
  | 'quote'
  | 'unordered-list'
  | 'ordered-list';

export type ShortcutValue = Readonly<{ windows: string; mac: string }>;
export type ShortcutValues = Readonly<Record<ShortcutId, ShortcutValue>>;

export type ShortcutsSettings = Readonly<{
  values: ShortcutValues;
  showHints: boolean;
  detectConflicts: boolean;
  showSuggestions: boolean;
}>;

export type SettingsCenterSettings = Readonly<{
  revision: number;
  general: GeneralSettings;
  images: ImageSettings;
  markdown: MarkdownSettings;
  shortcuts: ShortcutsSettings;
}>;

export type SettingsCenterApi = Readonly<{
  settingsUrl: string;
  nonce: string;
}>;
