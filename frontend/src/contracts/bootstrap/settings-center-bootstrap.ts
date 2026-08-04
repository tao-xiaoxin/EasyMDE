import type { SettingsCenterApi, SettingsCenterSettings } from '../settings-center-settings';
export const SETTINGS_CENTER_STRING_KEYS = [
  'brandName', 'settingsCenter', 'settingsNavigation', 'helpTitle', 'helpDescription',
  'openDocumentation', 'closeSettingsCenter', 'searchSettings', 'searchSettingsPlaceholder',
  'clearSearch', 'searchPageTitle', 'searchPageDescription', 'searchResults',
  'searchResultCount', 'noSearchResults', 'noSearchResultsDescription', 'general', 'shortcuts', 'images', 'ai',
  'markdown', 'sync', 'transfer', 'about', 'generalDescription', 'shortcutsDescription',
  'imagesDescription', 'aiDescription', 'markdownDescription', 'syncDescription',
  'transferDescription', 'transferPageTitle', 'aboutDescription', 'sectionPending', 'sectionPendingDescription',
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
  'customShortcutSuggestionsDescription', 'saveSettings', 'savingSettings',
  'settingsSaved', 'settingsSaveFailed', 'settingsUnsavedChanges',
  'imageHostService', 'selectImageHostService', 'cloudflareR2', 'aliyunOss',
  'tencentCloudCos', 'customUpload', 'bucket', 'customDomain', 'accessKey', 'secretKey',
  'showSecret', 'hideSecret', 'fileNameRule', 'fileNameRuleDescription',
  'commonFileNameTemplates', 'selectTemplateToFillRule', 'fileNamePresetDate',
  'fileNamePresetMd5', 'fileNamePresetYearMonth', 'fileNamePresetOriginal',
  'fileNamePresetArticle', 'fileNamePresetTime', 'availableVariables', 'yearVariable',
  'monthVariable', 'dayVariable', 'fullDateVariable', 'uploadTimeVariable',
  'postIdVariable', 'fileMd5Variable', 'uuidVariable', 'originalNameVariable',
  'extensionVariable', 'insertFileNameVariable', 'examplePreview', 'enterFileNameRule',
  'connectionStatus', 'pendingTest', 'testConnection',
  'backupImageHost',
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
  'imageFeaturedPlaceholder', 'imageFeaturedPlaceholderDescription',
  'compressLargeImagesRecommendation',
  'aiServiceConfiguration', 'aiProvider', 'openAi', 'azureOpenAi', 'anthropic',
  'customAiService', 'aiEndpoint', 'apiKey', 'aiApiKey', 'defaultModel',
  'showAiApiKey', 'hideAiApiKey', 'aiConnectionStatus',
  'aiConnectionTesting', 'aiConnectionSuccess',
  'aiAutocomplete', 'aiAutocompleteDescription', 'restoreAutocompleteDefaults',
  'enableAiAutocomplete', 'enableAiAutocompleteDescription', 'completionTrigger',
  'completionTriggerDescription', 'completionTriggerTab', 'completionTriggerShortcut',
  'completionTriggerAuto', 'completionTiming', 'completionTimingDescription',
  'completionTimingRealtime', 'completionTimingPause', 'completionTimingManual',
  'minimumTriggerChars', 'minimumTriggerCharsDescription', 'suggestionCount',
  'suggestionCountDescription', 'contextLines', 'contextLinesDescription',
  'displayPosition', 'displayPositionDescription', 'displayPositionBelow',
  'displayPositionInline', 'displayPositionSide', 'autoInsertSingle',
  'autoInsertSingleDescription', 'completeCodeBlocks', 'completeCodeBlocksDescription',
  'writingAssistance', 'assistantSidebar', 'assistantSidebarDescription',
  'titleOptimization', 'titleOptimizationDescription', 'summaryGeneration',
  'summaryGenerationDescription', 'tonePolish', 'tonePolishDescription',
  'outlineGeneration', 'outlineGenerationDescription', 'continuationSuggestions',
  'continuationSuggestionsDescription', 'generationPreferences', 'thinkingDepth',
  'thinkingDepthOff', 'thinkingDepthStandard', 'thinkingDepthDeep', 'writingTone',
  'writingToneGeneral', 'writingToneProfessional', 'writingToneRelaxed',
  'writingToneConcise', 'outputLanguage', 'includeContext', 'readMetadata',
  'saveLastPrompt', 'promptManagement', 'promptManagementDescription',
  'importPrompts', 'createPrompt', 'allPromptCategories', 'promptCategoryWriting',
  'promptCategoryPolish', 'promptCategorySummary', 'promptCategoryTranslation',
  'promptCategoryCustom', 'promptNameHeader', 'promptContentPreview', 'actions',
  'editPrompt', 'duplicatePrompt', 'deletePrompt', 'promptCopySuffix',
  'promptCategoryEmpty', 'promptPaginationSummary', 'previousPromptPage', 'nextPromptPage', 'promptItemsPerPage10',
  'promptItemsPerPage20', 'promptItemsPerPage50', 'promptPageSize', 'jumpTo',
  'jumpToPromptPage', 'jump', 'createPromptTitle', 'editPromptTitle',
  'promptEditorDescription', 'closePromptEditor', 'promptName', 'requiredField',
  'promptNamePlaceholder', 'promptCategory', 'promptContent', 'promptContentHelp',
  'promptContentPlaceholder', 'promptNameAndContentRequired', 'promptNameRequired',
  'promptContentRequired', 'cancel', 'savePrompt', 'deletePromptTitle',
  'deletePromptConfirmation', 'confirmDelete', 'promptCreated', 'promptSaved',
  'promptDuplicated', 'promptDeleted',
  'closePromptFeedback', 'defaultPromptTitleName', 'defaultPromptTitleContent',
  'defaultPromptPolishName', 'defaultPromptPolishContent', 'defaultPromptSummaryName',
  'defaultPromptSummaryContent', 'promptImportJsonOnly', 'promptImportMustBeArray',
  'promptImportEmpty', 'promptImportInvalidItem', 'promptImportSuccess',
  'promptImportUnknownError', 'promptPageInvalid', 'markdownEditorSettings',
  'markdownLivePreview', 'livePreviewDescription', 'wordWrap',
  'wordWrapDescription', 'markdownLineNumbersDescription', 'fixedToolbar',
  'fixedToolbarDescription', 'editorTheme', 'automaticFollowSystem', 'light', 'dark',
  'editorFontSize', 'editorFont', 'systemDefault', 'monospaceFont', 'sourceHanSans',
  'markdownParsingRendering', 'githubFlavor', 'githubFlavorDescription',
  'smartPunctuation', 'smartPunctuationDescription', 'tableAlignment',
  'autoAlignByContent', 'alignLeft', 'alignCenter', 'codeBlockTheme',
  'lightCodeTheme', 'darkCodeTheme', 'followEditor', 'codeBlockLineNumbers',
  'show', 'hide', 'taskLists', 'taskListsDescription', 'emoji', 'emojiDescription',
  'mathSupport', 'mathSupportDescription', 'htmlRendering', 'htmlRenderingDescription',
  'markdownExtensions', 'tableExtension', 'tableExtensionDescription', 'footnotes',
  'footnotesDescription', 'definitionLists', 'definitionListsDescription',
  'tocDirectory', 'tocDirectoryDescription', 'imageSizeSyntax',
  'imageSizeSyntaxDescription', 'otherSettings', 'pasteAsMarkdown',
  'pasteAsMarkdownDescription', 'defaultLineEnding', 'unorderedListMarker',
  'orderedListStart', 'blockquoteIndentStyle', 'standardBlockquote', 'spacedBlockquote',
  'syncBrowserExtensionConnection', 'syncConnectedBadge', 'syncExtensionDescription',
  'syncCheckConnection', 'syncOpenExtensionSettings', 'syncExtensionVersion',
  'syncExtensionVersionValue', 'syncCurrentBrowser', 'syncCurrentBrowserValue',
  'syncConnectedDevice', 'syncConnectedDeviceValue', 'syncLastHeartbeat', 'syncJustNow',
  'syncPlatformStatus', 'syncPlatformStatusDescription', 'syncCheckAllStatus',
  'syncRecentSync', 'syncLoggedIn', 'syncLoginExpired', 'syncUnauthorized',
  'syncCheckStatus', 'syncReauthorize', 'syncAuthorize', 'syncMoreActions',
  'syncPrivacyHint', 'syncNotification', 'syncNotificationDescription',
  'syncSendTestMessage', 'syncEnableNotifications', 'syncEnableNotificationsDescription',
  'syncNotificationTrigger', 'syncNotificationTiming', 'syncMessageTemplate',
  'syncMessageTemplateDescription', 'syncTemplateType',
  'syncTemplatePlatformDetailsDescription', 'syncExamplePreview',
  'syncExamplePreviewDescription', 'syncTemplatePreviewTitle',
  'syncTemplatePreviewBody', 'syncBrowserNotification',
  'syncBrowserNotificationDescription', 'syncEmailNotification',
  'syncEmailNotificationDescription', 'syncCustomWebhook', 'syncCustomWebhookDescription',
  'syncWebhookPlaceholder',
  'syncGroupBotNotifications', 'syncGroupBotNotificationsDescription',
  'syncDingTalk', 'syncDingTalkDescription', 'syncFeishu', 'syncFeishuDescription',
  'syncWeCom', 'syncWeComDescription', 'syncIncludeDetails',
  'syncIncludeDetailsDescription', 'syncNotificationPrivacy', 'syncAllResults',
  'syncFailedOrPartial', 'syncOnlyAllFailed', 'syncAfterEachArticle', 'syncAfterBatch',
  'syncTemplateCompact', 'syncTemplatePlatformDetails', 'syncTemplateFailureAlert',
  'syncTemplateCustom', 'syncHistory', 'syncHistoryDescription', 'syncFilterPlatform',
  'syncAllPlatforms', 'syncFilterStatus', 'syncAllStatuses', 'syncRefresh',
  'syncArticleTitle', 'syncTargetPlatforms', 'syncStatus', 'syncTime', 'syncActions',
  'syncHistorySummary', 'syncPreviousPage', 'syncNextPage', 'syncItemsPerPage',
  'syncItemsPerPage10', 'syncItemsPerPage20', 'syncItemsPerPage50',
  'syncJumpToPage', 'syncSynced', 'syncSyncing', 'syncPartialFailure', 'syncFailed',
  'syncPending', 'syncRetry', 'syncCancel', 'syncViewDetails', 'syncStartNow',
  'syncPlatformChecked', 'syncStatusesChecked', 'syncHistoryRefreshed',
  'syncTestMessageSent', 'syncExtensionSettingsNotice', 'closeSyncFeedback',
  'syncExtensionDialogTitle', 'syncExtensionDialogDescription',
  'syncAuthorizedPlatforms', 'syncExtensionCredentialsPrivacy',
  'syncRecheckConnection', 'closeSyncOperationDialog',
  'syncPlatformDialogTitle', 'syncPlatformDialogDescription',
  'syncCheckCurrentAuthorization', 'syncReauthorizePlatform',
  'syncViewPlatformHistory', 'syncRevokeAuthorization', 'syncPlatformRevoked',
  'syncHistoryDetailTitle', 'syncHistoryDetailDescription', 'syncOverallStatus',
  'syncResultSummary', 'syncTargetSuccess', 'syncTargetFailure',
  'syncPlatformResults', 'syncTargetPlatformCount',
  'syncTargetSuccessDescription', 'syncTargetFailureDescription',
  'syncTargetSyncingDescription', 'syncTargetPendingDescription',
  'syncViewArticle', 'syncArticleLinkPending', 'syncFailureReason',
  'syncRetryFailedPlatforms', 'closeSyncHistoryDetail',
  'transferExportConfiguration', 'transferExportConfigurationDescription',
  'transferFileName', 'transferExportFileName', 'transferImportConfiguration',
  'transferImportConfigurationDescription', 'transferChooseConfigurationFile',
  'transferConfirmImport', 'transferImportInstructions', 'transferImportOverwriteNotice',
  'transferImportCompatibilityNotice', 'transferImportScopeNotice',
  'transferConfigurationManagement', 'transferConfigurationManagementDescription',
  'transferResetCurrentConfiguration', 'transferResetCurrentConfigurationDescription',
  'transferClearLocalCache', 'transferClearLocalCacheDescription',
  'transferOpenConfigurationDirectory', 'transferOpenConfigurationDirectoryDescription',
  'transferViewConfigurationStatus', 'transferViewConfigurationStatusDescription',
  'transferCloseOperationDialog', 'transferConfigurationDirectory',
  'transferConfigurationStatusCheck', 'transferLocalStateChangeDescription',
  'transferConfigurationDirectoryDescription', 'transferConfigurationStatusDescription',
  'transferClose', 'transferResetWarning', 'transferClearCacheWarning',
  'transferConfirmReset', 'transferConfirmClear', 'transferIntegrationPendingNotice',
  'transferFileSelectedNotice', 'closeTransferFeedback',
  'transferStorageLocationDescription', 'transferStorageLocationValue',
  'transferCopyStorageLocation', 'transferStorageLocationCopied',
  'transferStorageLocationCopyFailed', 'transferChecksSummary',
  'transferChecksPassed', 'transferCheckBootstrap', 'transferCheckBootstrapReady',
  'transferCheckRuntimeAssets', 'transferCheckRuntimeAssetsReady',
  'transferCheckImageDraft', 'transferCheckImageDraftReady',
  'transferCheckImageDraftIncomplete', 'transferCheckAiDraft',
  'transferCheckAiDraftReady', 'transferCheckAiDraftIncomplete',
  'transferCheckPersistence', 'transferCheckPersistencePending', 'transferCheckPersistenceReady',
  'transferCheckPersistenceUnavailable', 'transferExportSuccess', 'transferExportFailed',
  'transferImportInvalid', 'transferImportApplied', 'transferResetApplied',
  'transferLocalCacheCleared', 'transferLocalCacheClearFailed',
  'transferOperationUnavailable',
  'aboutVersionInformation', 'aboutCurrentVersion', 'aboutCurrentVersionValue',
  'aboutCheckUpdates', 'aboutRenderEngine', 'aboutRenderEngineValue',
  'aboutCompatibleVersion', 'aboutCompatibleVersionValue', 'aboutPhpRequirement',
  'aboutPhpRequirementValue', 'aboutLastUpdated', 'aboutLastUpdatedValue',
  'aboutConfigurationStatus', 'aboutStatusNormal', 'aboutCoreCapabilities',
  'aboutMarkdownPreview', 'aboutCodeHighlighting', 'aboutImageUpload',
  'aboutAiAssistance', 'aboutShortcutWorkflow', 'aboutConfigurationMigration',
  'aboutResourcesSupport', 'aboutOfficialDocumentation', 'aboutChangelog',
  'aboutIssueFeedback', 'aboutGithubRepository', 'aboutSecurityPolicy',
  'aboutOpenSourceLicense', 'aboutSupportNote', 'aboutPluginIntroduction',
  'aboutPluginIntroductionDescription', 'aboutTagMarkdown', 'aboutTagLivePreview',
  'aboutTagImages', 'aboutTagAi', 'aboutTagShortcuts', 'aboutHelpDialogTitle',
  'aboutHelpDialogDescription', 'aboutChangelogDescription', 'aboutCloseOperationDialog',
  'aboutClose', 'aboutOpenFullDocumentation', 'aboutHelpQuickStart',
  'aboutHelpQuickStartDescription', 'aboutHelpEditorWorkflow',
  'aboutHelpEditorWorkflowDescription', 'aboutHelpConfigurationMigration',
  'aboutHelpConfigurationMigrationDescription', 'aboutCurrentVersionBadge',
  'aboutVersion018Date', 'aboutVersion018ChangeReact', 'aboutVersion018ChangeEditor',
  'aboutVersion018ChangeNative', 'aboutVersion017', 'aboutVersion017Date',
  'aboutVersion017ChangeToolbar', 'aboutVersion017ChangeShortcuts',
  'aboutActionPendingNotice', 'closeAboutFeedback'
] as const;

export type SettingsCenterStringKey = (typeof SETTINGS_CENTER_STRING_KEYS)[number];

export type SettingsCenterBootstrap = Readonly<{
  schemaVersion: 2;
  closeUrl: string;
  api: SettingsCenterApi;
  assets: Readonly<{
    brandMarkUrl: string;
    headerIllustrationUrl: string;
    searchEmptyIllustrationUrl: string;
  }>;
  drafts: Readonly<{
    images: Readonly<{
      domain: string;
      backupDomain: string;
    }>;
  }>;
  settings: SettingsCenterSettings;
  defaultSettings: SettingsCenterSettings;
  strings: Readonly<Record<SettingsCenterStringKey, string>>;
}>;

function parseSettingsStringFields(
  root: Record<string, unknown>,
  section: 'general' | 'images' | 'markdown',
  keys: ReadonlyArray<string>
): Record<string, unknown> {
  const value = parseObject(root[section], `settings-center-${section}-settings-invalid`);
  for (const key of keys) {
    if (typeof value[key] !== 'string') throw new Error(`settings-center-${section}-${key}-invalid`);
  }
  return value;
}

function parseSettingsBooleanFields(
  value: Record<string, unknown>,
  section: string,
  keys: ReadonlyArray<string>
): void {
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') throw new Error(`settings-center-${section}-${key}-invalid`);
  }
}


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

function parsePossiblyEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string') {
    throw new Error(code);
  }

  return value;
}

export function parseSettingsCenterSettings(value: unknown): SettingsCenterSettings {
  const root = parseObject(value, 'settings-center-settings-invalid');
  if (!Number.isInteger(root.revision) || (root.revision as number) < 0) {
    throw new Error('settings-center-revision-invalid');
  }

  const general = parseSettingsStringFields(root, 'general', [
    'interfaceLanguage', 'editingMode', 'statusBarMode', 'autoSaveInterval',
    'defaultCategory', 'publishVisibility', 'summaryMode'
  ]);
  parseSettingsBooleanFields(general, 'general', [
    'autoFocusEditor', 'showLineNumbers', 'syntaxHighlight', 'autoSave', 'syncScroll',
    'cleanPastedContent', 'smartListRecognition', 'openPreviewAfterPublish',
    'featuredImagePlaceholder'
  ]);

  const images = parseSettingsStringFields(root, 'images', [
    'service', 'bucket', 'domain', 'accessKey', 'secretKey', 'fileNameRule',
    'backupService', 'backupBucket', 'backupDomain', 'backupAccessKey', 'backupSecretKey',
    'backupFailureMode', 'insertFormat', 'altSource', 'captionMode'
  ]);
  parseSettingsBooleanFields(images, 'images', [
    'backupEnabled', 'backupSameObjectKey', 'insertMarkdown', 'compressImages',
    'preserveFileName', 'copyUrl', 'featuredPlaceholder'
  ]);
  const uploadFormats = parseObject(images.uploadFormats, 'settings-center-images-upload-formats-invalid');
  for (const format of ['jpg', 'png', 'webp', 'gif']) {
    if (typeof uploadFormats[format] !== 'boolean') {
      throw new Error(`settings-center-images-upload-format-${format}-invalid`);
    }
  }

  const markdown = parseSettingsStringFields(root, 'markdown', [
    'editorTheme', 'editorFontSize', 'editorFont', 'tableAlignment', 'codeTheme',
    'codeLineNumbers', 'lineEnding', 'unorderedMarker', 'orderedStart', 'blockquoteStyle'
  ]);
  parseSettingsBooleanFields(markdown, 'markdown', [
    'livePreview', 'wordWrap', 'lineNumbers', 'fixedToolbar', 'githubFlavor',
    'smartPunctuation', 'taskLists', 'emoji', 'math', 'htmlRendering', 'tableExtension',
    'footnotes', 'definitionLists', 'toc', 'imageSizeSyntax', 'pasteAsMarkdown'
  ]);

  const shortcuts = parseObject(root.shortcuts, 'settings-center-shortcuts-settings-invalid');
  parseSettingsBooleanFields(shortcuts, 'shortcuts', [
    'showHints', 'detectConflicts', 'showSuggestions'
  ]);
  const shortcutValues = parseObject(shortcuts.values, 'settings-center-shortcut-values-invalid');
  for (const id of [
    'save', 'bold', 'italic', 'link', 'image', 'heading-one', 'heading-two', 'quote',
    'unordered-list', 'ordered-list'
  ]) {
    const shortcut = parseObject(shortcutValues[id], `settings-center-shortcut-${id}-invalid`);
    if (typeof shortcut.windows !== 'string' || typeof shortcut.mac !== 'string') {
      throw new Error(`settings-center-shortcut-${id}-invalid`);
    }
  }

  return root as unknown as SettingsCenterSettings;
}


export function parseSettingsCenterBootstrap(value: unknown): SettingsCenterBootstrap {
  const root = parseObject(value, 'settings-center-bootstrap-invalid');
  if (root.schemaVersion !== 2) {
    throw new Error('settings-center-bootstrap-version-unsupported');
  }

  const assets = parseObject(root.assets, 'settings-center-assets-invalid');
  const drafts = parseObject(root.drafts, 'settings-center-drafts-invalid');
  const imageDraft = parseObject(drafts.images, 'settings-center-images-draft-invalid');
  const api = parseObject(root.api, 'settings-center-api-invalid');
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
  if ((strings.searchResultCount.match(/%s/g) ?? []).length !== 1) {
    throw new Error('settings-center-search-result-count-template-invalid');
  }
  for (const key of ['insertFileNameVariable', 'currentAllowedUploads'] as const) {
    if ((strings[key].match(/%s/g) ?? []).length !== 1) {
      throw new Error(`settings-center-${key}-template-invalid`);
    }
  }
  for (const key of [
    'transferFileSelectedNotice', 'transferChecksSummary', 'transferChecksPassed'
  ] as const) {
    if ((strings[key].match(/%s/g) ?? []).length !== 1) {
      throw new Error(`settings-center-${key}-template-invalid`);
    }
  }
  for (const key of [
    'editPrompt', 'duplicatePrompt', 'deletePrompt', 'promptCategoryEmpty',
    'deletePromptConfirmation', 'promptCreated', 'promptSaved', 'promptDuplicated',
    'promptDeleted', 'promptImportSuccess'
  ] as const) {
    if ((strings[key].match(/%s/g) ?? []).length !== 1) {
      throw new Error(`settings-center-${key}-template-invalid`);
    }
  }
  if (!['%1$s', '%2$s', '%3$s'].every((placeholder) =>
    strings.promptPaginationSummary.includes(placeholder))) {
    throw new Error('settings-center-promptPaginationSummary-template-invalid');
  }

  return {
    schemaVersion: 2,
    closeUrl: parseString(root.closeUrl, 'settings-center-close-url-invalid'),
    api: {
      settingsUrl: parseString(api.settingsUrl, 'settings-center-api-url-invalid'),
      nonce: parseString(api.nonce, 'settings-center-api-nonce-invalid')
    },
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
    drafts: {
      images: {
        domain: parsePossiblyEmptyString(imageDraft.domain, 'settings-center-images-domain-invalid'),
        backupDomain: parsePossiblyEmptyString(
          imageDraft.backupDomain,
          'settings-center-images-backup-domain-invalid'
        )
      }
    },
    settings: parseSettingsCenterSettings(root.settings),
    defaultSettings: parseSettingsCenterSettings(root.defaultSettings),
    strings
  };
}
