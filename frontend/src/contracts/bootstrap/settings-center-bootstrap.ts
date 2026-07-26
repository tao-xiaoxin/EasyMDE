export const SETTINGS_CENTER_STRING_KEYS = [
  'brandName', 'settingsCenter', 'settingsNavigation', 'helpTitle', 'helpDescription',
  'openDocumentation', 'closeSettingsCenter', 'searchSettings', 'searchSettingsPlaceholder',
  'clearSearch', 'searchPageTitle', 'searchPageDescription', 'noSearchResults', 'noSearchResultsDescription', 'general', 'shortcuts', 'images', 'ai',
  'markdown', 'sync', 'transfer', 'about', 'generalDescription', 'shortcutsDescription',
  'imagesDescription', 'aiDescription', 'markdownDescription', 'syncDescription',
  'transferDescription', 'aboutDescription', 'sectionPending', 'sectionPendingDescription',
  'basePreferences', 'editorBehavior', 'documentDefaults', 'interfaceLanguage',
  'defaultEditingMode', 'autoFocusEditor', 'autoFocusEditorDescription', 'showLineNumbers',
  'showLineNumbersDescription', 'syntaxHighlight', 'syntaxHighlightDescription',
  'statusBarDisplay', 'autoSave', 'autoSaveDescription', 'autoSaveInterval', 'syncScroll',
  'syncScrollDescription', 'cleanPastedContent', 'cleanPastedContentDescription',
  'smartListRecognition', 'smartListRecognitionDescription', 'defaultCategory',
  'defaultVisibility', 'openPreviewAfterPublish', 'openPreviewAfterPublishDescription',
  'summaryMode', 'summaryModeDescription', 'featuredImagePlaceholder',
  'featuredImagePlaceholderDescription', 'simplifiedChinese', 'traditionalChinese', 'english',
  'livePreview', 'sourceEditing', 'previewOnly', 'wordsAndReadingTime', 'wordsOnly',
  'hiddenStatusBar', 'seconds30', 'seconds60', 'minutes2', 'minutes5',
  'noAutomaticCategory', 'currentCategory', 'publicVisibility', 'privateVisibility',
  'passwordProtected', 'summary55', 'summary100', 'manualSummary',
  'commonShortcuts', 'headingAndFormatting', 'shortcutBehavior',
  'restoreDefaultShortcuts', 'shortcutFunction', 'windowsLinux', 'macOS',
  'saveArticle', 'bold', 'italic', 'insertLink', 'insertImage', 'openAiAssistant',
  'headingOne', 'headingTwo', 'quote', 'unorderedList', 'orderedList',
  'showShortcutHints', 'showShortcutHintsDescription', 'detectShortcutConflicts',
  'detectShortcutConflictsDescription', 'customShortcutSuggestions',
  'customShortcutSuggestionsDescription',
  'imageHostService', 'selectImageHostService', 'cloudflareR2', 'aliyunOss',
  'tencentCloudCos', 'customUpload', 'bucket', 'customDomain', 'accessKey', 'secretKey',
  'showSecret', 'hideSecret', 'fileNameRule', 'fileNameRuleDescription',
  'commonFileNameTemplates', 'selectTemplateToFillRule', 'fileNamePresetDate',
  'fileNamePresetMd5', 'fileNamePresetYearMonth', 'fileNamePresetOriginal',
  'fileNamePresetArticle', 'fileNamePresetTime', 'availableVariables', 'yearVariable',
  'monthVariable', 'dayVariable', 'fullDateVariable', 'uploadTimeVariable',
  'postIdVariable', 'fileMd5Variable', 'uuidVariable', 'originalNameVariable',
  'extensionVariable', 'insertFileNameVariable', 'examplePreview', 'enterFileNameRule',
  'connectionStatus', 'pendingTest', 'testConnection', 'backupImageHost',
  'backupImageHostDescription',
  'enableBackupImageHost', 'enableBackupImageHostDescription', 'backupImageHostService',
  'qiniuKodo', 'backupBucket', 'backupDomain', 'backupAccessKey', 'backupSecretKey',
  'showBackupAccessKey', 'hideBackupAccessKey', 'showBackupSecretKey',
  'hideBackupSecretKey', 'keepSameObjectPath', 'keepSameObjectPathDescription',
  'backupFailureHandling', 'backupFailureHandlingDescription',
  'returnPrimaryUrlOnBackupFailure', 'failEntireUpload', 'backupConnectionStatus',
  'testBackupConnection', 'uploadBehavior', 'insertMarkdownAfterUpload',
  'compressImages', 'compressImagesDescription', 'preserveOriginalFileName',
  'preserveOriginalFileNameDescription', 'copyImageUrl', 'copyImageUrlDescription',
  'retryFailedUpload', 'doNotRetry', 'retryOnce', 'retryTwice', 'retryThreeTimes',
  'maximumImageSize', 'originalImageSize', 'imageSize1920', 'imageSize2560',
  'imageSize3840', 'allowedUploadFormats', 'allowedUploadFormatsDescription',
  'uploadFormatJpg', 'uploadFormatPng', 'uploadFormatWebp', 'uploadFormatGif',
  'allowUploadJpg', 'allowUploadPng', 'allowUploadWebp', 'allowUploadGif',
  'uploadFormatSeparator',
  'defaultInsertion', 'defaultInsertFormat', 'markdownImage',
  'htmlImage', 'urlOnly', 'altTextSource', 'useFileName', 'leaveEmpty',
  'fillOnUpload', 'imageTitleField', 'doNotInsert', 'currentAllowedUploads',
  'compressLargeImagesRecommendation'
] as const;

export type SettingsCenterStringKey = (typeof SETTINGS_CENTER_STRING_KEYS)[number];

export type SettingsCenterBootstrap = Readonly<{
  schemaVersion: 1;
  closeUrl: string;
  assets: Readonly<{
    brandMarkUrl: string;
    headerIllustrationUrl: string;
    searchEmptyIllustrationUrl: string;
  }>;
  strings: Readonly<Record<SettingsCenterStringKey, string>>;
}>;

function parseObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }

  return value as Record<string, unknown>;
}

function parseString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(code);
  }

  return value;
}

export function parseSettingsCenterBootstrap(value: unknown): SettingsCenterBootstrap {
  const root = parseObject(value, 'settings-center-bootstrap-invalid');
  if (root.schemaVersion !== 1) {
    throw new Error('settings-center-bootstrap-version-unsupported');
  }

  const assets = parseObject(root.assets, 'settings-center-assets-invalid');
  const sourceStrings = parseObject(root.strings, 'settings-center-strings-invalid');
  const strings = {} as Record<SettingsCenterStringKey, string>;

  for (const key of SETTINGS_CENTER_STRING_KEYS) {
    strings[key] = parseString(sourceStrings[key], `settings-center-string-${key}-invalid`);
  }
  if ((strings.noSearchResults.match(/%s/g) ?? []).length !== 1) {
    throw new Error('settings-center-search-template-invalid');
  }
  if ((strings.searchPageDescription.match(/%s/g) ?? []).length !== 1) {
    throw new Error('settings-center-search-description-template-invalid');
  }
  for (const key of ['insertFileNameVariable', 'currentAllowedUploads'] as const) {
    if ((strings[key].match(/%s/g) ?? []).length !== 1) {
      throw new Error(`settings-center-${key}-template-invalid`);
    }
  }

  return {
    schemaVersion: 1,
    closeUrl: parseString(root.closeUrl, 'settings-center-close-url-invalid'),
    assets: {
      brandMarkUrl: parseString(assets.brandMarkUrl, 'settings-center-brand-url-invalid'),
      headerIllustrationUrl: parseString(
        assets.headerIllustrationUrl,
        'settings-center-header-url-invalid'
      ),
      searchEmptyIllustrationUrl: parseString(
        assets.searchEmptyIllustrationUrl,
        'settings-center-search-empty-url-invalid'
      )
    },
    strings
  };
}
