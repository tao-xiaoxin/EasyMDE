import type { SettingsCenterSettings } from '../contracts/settings-center-settings';

export const SETTINGS_CENTER_TEST_SETTINGS: SettingsCenterSettings = {
  revision: 0,
  general: {
    interfaceLanguage: 'en-US',
    editingMode: 'live-preview',
    autoFocusEditor: false,
    showLineNumbers: true,
    syntaxHighlight: true,
    statusBarMode: 'words-reading-time',
    autoSave: true,
    autoSaveInterval: '60',
    syncScroll: true,
    publishVisibility: 'public',
    openPreviewAfterPublish: true,
    summaryMode: 'auto-55',
    featuredImagePlaceholder: true
  },
  images: {
    service: 'cloudflare-r2',
    endpoint:
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    region: '',
    bucket: 'easymde-assets',
    domain: '',
    fallbackDomain: '',
    accessKey: '',
    secretKey: '',
    fileNameRule: '{date}/{uuid}.{ext}',
    backupEnabled: true,
    backupService: 'qiniu-kodo',
    backupEndpoint: '',
    backupRegion: '',
    backupBucket: 'easymde-backup',
    backupDomain: '',
    backupAccessKey: '',
    backupSecretKey: '',
    backupSameObjectKey: true,
    backupFailureMode: 'return-primary-url',
    insertMarkdown: true,
    compressImages: true,
    preserveFileName: false,
    copyUrl: false,
    retryCount: 'none',
    maxImageSize: '2560',
    uploadFormats: { jpg: true, png: true, webp: true, gif: true },
    insertFormat: 'markdown',
    altSource: 'filename',
    captionMode: 'none',
    featuredPlaceholder: true
  },
  markdown: {
    wordWrap: true,
    lineNumbers: false,
    editorTheme: 'system',
    githubFlavor: true,
    smartPunctuation: true,
    tableAlignment: 'auto',
    codeLineNumbers: 'show',
    htmlRendering: false,
    pasteAsMarkdown: true,
    lineEnding: 'system',
    unorderedMarker: '-',
    orderedStart: '1',
    blockquoteStyle: 'standard'
  },
  shortcuts: {
    values: {
      save: { windows: 'Ctrl+S', mac: 'Cmd+S' },
      bold: { windows: 'Ctrl+B', mac: 'Cmd+B' },
      italic: { windows: 'Ctrl+I', mac: 'Cmd+I' },
      link: { windows: 'Ctrl+K', mac: 'Cmd+K' },
      image: { windows: 'Ctrl+Shift+I', mac: 'Cmd+Ctrl+I' },
      'heading-one': { windows: 'Ctrl+1', mac: 'Cmd+1' },
      'heading-two': { windows: 'Ctrl+2', mac: 'Cmd+2' },
      quote: { windows: 'Ctrl+Shift+Q', mac: 'Cmd+Option+Q' },
      'unordered-list': { windows: 'Ctrl+Shift+U', mac: 'Cmd+Shift+U' },
      'ordered-list': { windows: 'Ctrl+Shift+O', mac: 'Cmd+Shift+O' }
    },
    showHints: true,
    detectConflicts: true,
    showSuggestions: true
  }
};
export const SETTINGS_CENTER_DEFAULT_SETTINGS: SettingsCenterSettings = {
  ...SETTINGS_CENTER_TEST_SETTINGS,
  revision: 0,
  general: {
    ...SETTINGS_CENTER_TEST_SETTINGS.general,
    autoFocusEditor: true
  }
};
