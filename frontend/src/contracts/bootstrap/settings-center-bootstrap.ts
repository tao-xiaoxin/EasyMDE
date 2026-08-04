export const SETTINGS_CENTER_STRING_KEYS = [
  'brandName', 'settingsCenter', 'settingsNavigation', 'helpTitle', 'helpDescription',
  'openDocumentation', 'closeSettingsCenter', 'searchSettings', 'searchSettingsPlaceholder',
  'clearSearch', 'searchPageTitle', 'searchPageDescription', 'searchResults',
  'searchResultCount', 'noSearchResults', 'noSearchResultsDescription', 'general', 'shortcuts', 'images', 'ai',
  'markdown', 'sync', 'transfer', 'about', 'generalDescription', 'shortcutsDescription',
  'imagesDescription', 'aiDescription', 'markdownDescription', 'syncDescription',
  'transferDescription', 'transferPageTitle', 'aboutDescription', 'sectionPending', 'sectionPendingDescription',
  'toolbarLayout', 'toolbarLayoutDescription', 'hybridIconToolbar',
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
  'saveArticle', 'saveSettings', 'bold', 'italic', 'insertLink', 'insertImage', 'openAiAssistant',
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
  'connectionStatus', 'pendingTest', 'testing', 'connected', 'lastTest', 'testConnection',
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
  'transferCheckPersistence', 'transferCheckPersistencePending',
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

export type SettingsCenterCommand = Readonly<{
  id: string;
  label: string;
  group: string;
  defaultShortcutWin: string;
  defaultShortcutMac: string;
}>;

export type SettingsCenterShortcut = Readonly<{
  win: string;
  mac: string;
}>;

export type SettingsCenterBootstrap = Readonly<{
  schemaVersion: 2;
  closeUrl: string;
  settings: Readonly<{
    optionKey: string;
    toolbarLayout: 'hybrid-icons';
    shortcuts: Readonly<Record<string, SettingsCenterShortcut>>;
  }>;
  commands: ReadonlyArray<SettingsCenterCommand>;
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

function parseStringValue(value: unknown, code: string): string {
  if (typeof value !== 'string') {
    throw new Error(code);
  }

  return value;
}

export function parseSettingsCenterBootstrap(value: unknown): SettingsCenterBootstrap {
  const root = parseObject(value, 'settings-center-bootstrap-invalid');
  if (root.schemaVersion !== 2) {
    throw new Error('settings-center-bootstrap-version-unsupported');
  }

  const assets = parseObject(root.assets, 'settings-center-assets-invalid');
  const settings = parseObject(root.settings, 'settings-center-settings-invalid');
  const sourceShortcuts = parseObject(settings.shortcuts, 'settings-center-shortcuts-invalid');
  const sourceCommands = root.commands;
  if (!Array.isArray(sourceCommands)) {
    throw new Error('settings-center-commands-invalid');
  }
  const commands = sourceCommands.map((value, index) => {
    const command = parseObject(value, `settings-center-command-${index}-invalid`);
    return {
      id: parseString(command.id, `settings-center-command-${index}-id-invalid`),
      label: parseString(command.label, `settings-center-command-${index}-label-invalid`),
      group: parseString(command.group, `settings-center-command-${index}-group-invalid`),
      defaultShortcutWin: parseStringValue(
        command.defaultShortcutWin,
        `settings-center-command-${index}-default-win-invalid`
      ),
      defaultShortcutMac: parseStringValue(
        command.defaultShortcutMac,
        `settings-center-command-${index}-default-mac-invalid`
      )
    };
  });
  const shortcuts: Record<string, SettingsCenterShortcut> = {};
  for (const [commandId, value] of Object.entries(sourceShortcuts)) {
    const shortcut = parseObject(value, `settings-center-shortcut-${commandId}-invalid`);
    shortcuts[commandId] = {
      win: parseStringValue(shortcut.win, `settings-center-shortcut-${commandId}-win-invalid`),
      mac: parseStringValue(shortcut.mac, `settings-center-shortcut-${commandId}-mac-invalid`)
    };
  }
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
  const toolbarLayout = parseString(settings.toolbarLayout, 'settings-center-toolbar-layout-invalid');
  if (toolbarLayout !== 'hybrid-icons') {
    throw new Error('settings-center-toolbar-layout-unsupported');
  }

  return {
    schemaVersion: 2,
    closeUrl: parseString(root.closeUrl, 'settings-center-close-url-invalid'),
    settings: {
      optionKey: parseString(settings.optionKey, 'settings-center-option-key-invalid'),
      toolbarLayout,
      shortcuts
    },
    commands,
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
