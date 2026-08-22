import type {
	SettingsCenterApi,
	SettingsCenterSettings,
} from "../settings-center-settings";

const SETTINGS_STRING_MAX_LENGTH = 512;
export const SETTINGS_CENTER_STRING_KEYS = [
	"brandName",
	"settingsCenter",
	"settingsNavigation",
	"helpTitle",
	"helpDescription",
	"openDocumentation",
	"closeSettingsCenter",
	"searchSettings",
	"searchSettingsPlaceholder",
	"clearSearch",
	"cancel",
	"searchPageTitle",
	"searchPageDescription",
	"searchResults",
	"searchResultCount",
	"noSearchResults",
	"noSearchResultsDescription",
	"general",
	"shortcuts",
	"images",
	"markdown",
	"transfer",
	"about",
	"generalDescription",
	"shortcutsDescription",
	"imagesDescription",
	"markdownDescription",
	"transferDescription",
	"transferPageTitle",
	"aboutDescription",
	"sectionPending",
	"sectionPendingDescription",
	"basePreferences",
	"editorBehavior",
	"documentDefaults",
	"interfaceLanguage",
	"defaultEditingMode",
	"autoFocusEditor",
	"autoFocusEditorDescription",
	"showLineNumbers",
	"showLineNumbersDescription",
	"syntaxHighlight",
	"syntaxHighlightDescription",
	"statusBarDisplay",
	"autoSave",
	"autoSaveDescription",
	"autoSaveInterval",
	"syncScroll",
	"syncScrollDescription",
	"cleanPastedContent",
	"cleanPastedContentDescription",
	"smartListRecognition",
	"smartListRecognitionDescription",
	"defaultCategory",
	"defaultVisibility",
	"openPreviewAfterPublish",
	"openPreviewAfterPublishDescription",
	"summaryMode",
	"summaryModeDescription",
	"featuredImagePlaceholder",
	"featuredImagePlaceholderDescription",
	"simplifiedChinese",
	"traditionalChinese",
	"english",
	"livePreview",
	"sourceEditing",
	"previewOnly",
	"wordsAndReadingTime",
	"wordsOnly",
	"hiddenStatusBar",
	"seconds30",
	"seconds60",
	"minutes2",
	"minutes5",
	"noAutomaticCategory",
	"currentCategory",
	"publicVisibility",
	"privateVisibility",
	"passwordProtected",
	"summary55",
	"summary100",
	"manualSummary",
	"commonShortcuts",
	"headingAndFormatting",
	"shortcutBehavior",
	"restoreDefaultShortcuts",
	"shortcutFunction",
	"windowsLinux",
	"macOS",
	"saveArticle",
	"bold",
	"italic",
	"insertLink",
	"insertImage",
	"headingOne",
	"headingTwo",
	"quote",
	"unorderedList",
	"orderedList",
	"showShortcutHints",
	"showShortcutHintsDescription",
	"detectShortcutConflicts",
	"detectShortcutConflictsDescription",
	"customShortcutSuggestions",
	"customShortcutSuggestionsDescription",
	"saveSettings",
	"savingSettings",
	"settingsSaved",
	"settingsSaveFailed",
	"settingsSaveNetworkFailed",
	"settingsSaveRejected",
	"settingsSaveInvalid",
	"settingsConflict",
	"reloadSettings",
	"settingsUnsavedChanges",
	"settingsUnavailable",
	"settingsUnavailableDescription",
	"imageHostService",
	"selectImageHostService",
	"cloudflareR2",
	"aliyunOss",
	"tencentCloudCos",
	"customUpload",
	"bucket",
	"customDomain",
	"accessKey",
	"secretKey",
	"showSecret",
	"hideSecret",
	"fileNameRule",
	"fileNameRuleDescription",
	"commonFileNameTemplates",
	"selectTemplateToFillRule",
	"fileNamePresetDate",
	"fileNamePresetMd5",
	"fileNamePresetYearMonth",
	"fileNamePresetOriginal",
	"fileNamePresetArticle",
	"fileNamePresetTime",
	"availableVariables",
	"yearVariable",
	"monthVariable",
	"dayVariable",
	"fullDateVariable",
	"uploadTimeVariable",
	"postIdVariable",
	"fileMd5Variable",
	"uuidVariable",
	"originalNameVariable",
	"extensionVariable",
	"insertFileNameVariable",
	"examplePreview",
	"enterFileNameRule",
	"backupImageHost",
	"backupImageHostDescription",
	"enableBackupImageHost",
	"enableBackupImageHostDescription",
	"backupImageHostService",
	"qiniuKodo",
	"backupBucket",
	"backupDomain",
	"backupAccessKey",
	"backupSecretKey",
	"showBackupAccessKey",
	"hideBackupAccessKey",
	"showBackupSecretKey",
	"hideBackupSecretKey",
	"keepSameObjectPath",
	"keepSameObjectPathDescription",
	"backupFailureHandling",
	"backupFailureHandlingDescription",
	"returnPrimaryUrlOnBackupFailure",
	"failEntireUpload",
	"uploadBehavior",
	"insertMarkdownAfterUpload",
	"compressImages",
	"compressImagesDescription",
	"preserveOriginalFileName",
	"preserveOriginalFileNameDescription",
	"copyImageUrl",
	"copyImageUrlDescription",
	"retryFailedUpload",
	"doNotRetry",
	"retryOnce",
	"retryTwice",
	"retryThreeTimes",
	"maximumImageSize",
	"originalImageSize",
	"imageSize1920",
	"imageSize2560",
	"imageSize3840",
	"allowedUploadFormats",
	"allowedUploadFormatsDescription",
	"uploadFormatJpg",
	"uploadFormatPng",
	"uploadFormatWebp",
	"uploadFormatGif",
	"allowUploadJpg",
	"allowUploadPng",
	"allowUploadWebp",
	"allowUploadGif",
	"uploadFormatSeparator",
	"defaultInsertion",
	"defaultInsertFormat",
	"markdownImage",
	"htmlImage",
	"urlOnly",
	"altTextSource",
	"useFileName",
	"leaveEmpty",
	"fillOnUpload",
	"imageTitleField",
	"doNotInsert",
	"currentAllowedUploads",
	"imageFeaturedPlaceholder",
	"imageFeaturedPlaceholderDescription",
	"compressLargeImagesRecommendation",
	"markdownEditorSettings",
	"markdownLivePreview",
	"livePreviewDescription",
	"wordWrap",
	"wordWrapDescription",
	"markdownLineNumbersDescription",
	"fixedToolbar",
	"fixedToolbarDescription",
	"editorTheme",
	"automaticFollowSystem",
	"light",
	"dark",
	"editorFontSize",
	"editorFont",
	"systemDefault",
	"monospaceFont",
	"sourceHanSans",
	"markdownParsingRendering",
	"githubFlavor",
	"githubFlavorDescription",
	"smartPunctuation",
	"smartPunctuationDescription",
	"tableAlignment",
	"autoAlignByContent",
	"alignLeft",
	"alignCenter",
	"codeBlockTheme",
	"lightCodeTheme",
	"darkCodeTheme",
	"followEditor",
	"codeBlockLineNumbers",
	"show",
	"hide",
	"taskLists",
	"taskListsDescription",
	"emoji",
	"emojiDescription",
	"mathSupport",
	"mathSupportDescription",
	"htmlRendering",
	"htmlRenderingDescription",
	"markdownExtensions",
	"tableExtension",
	"tableExtensionDescription",
	"footnotes",
	"footnotesDescription",
	"definitionLists",
	"definitionListsDescription",
	"tocDirectory",
	"tocDirectoryDescription",
	"imageSizeSyntax",
	"imageSizeSyntaxDescription",
	"otherSettings",
	"pasteAsMarkdown",
	"pasteAsMarkdownDescription",
	"defaultLineEnding",
	"unorderedListMarker",
	"orderedListStart",
	"blockquoteIndentStyle",
	"standardBlockquote",
	"spacedBlockquote",
	"transferExportConfiguration",
	"transferExportConfigurationDescription",
	"transferFileName",
	"transferExportFileName",
	"transferImportConfiguration",
	"transferImportConfigurationDescription",
	"transferChooseConfigurationFile",
	"transferConfirmImport",
	"transferImportInstructions",
	"transferImportOverwriteNotice",
	"transferImportCompatibilityNotice",
	"transferImportScopeNotice",
	"transferConfigurationManagement",
	"transferConfigurationManagementDescription",
	"transferResetCurrentConfiguration",
	"transferResetCurrentConfigurationDescription",
	"transferClearLocalCache",
	"transferClearLocalCacheDescription",
	"transferOpenConfigurationDirectory",
	"transferOpenConfigurationDirectoryDescription",
	"transferViewConfigurationStatus",
	"transferViewConfigurationStatusDescription",
	"transferCloseOperationDialog",
	"transferConfigurationDirectory",
	"transferConfigurationStatusCheck",
	"transferLocalStateChangeDescription",
	"transferConfigurationDirectoryDescription",
	"transferConfigurationStatusDescription",
	"transferClose",
	"transferResetWarning",
	"transferClearCacheWarning",
	"transferConfirmReset",
	"transferConfirmClear",
	"transferFileSelectedNotice",
	"closeTransferFeedback",
	"transferStorageLocationDescription",
	"transferStorageLocationValue",
	"transferCopyStorageLocation",
	"transferStorageLocationCopied",
	"transferStorageLocationCopyFailed",
	"transferChecksSummary",
	"transferChecksPassed",
	"transferCheckBootstrap",
	"transferCheckBootstrapReady",
	"transferCheckRuntimeAssets",
	"transferCheckRuntimeAssetsReady",
	"transferCheckImageDraft",
	"transferCheckImageDraftReady",
	"transferCheckImageDraftIncomplete",
	"transferCheckSettingsEndpoint",
	"transferCheckSettingsEndpointConfigured",
	"transferExportSuccess",
	"transferExportFailed",
	"transferExportNameInvalid",
	"transferImportInvalid",
	"transferImportApplied",
	"transferResetApplied",
	"transferLocalCacheCleared",
	"transferLocalCacheClearFailed",
	"transferOperationUnavailable",
	"transferUnavailableSettingsNotice",
	"aboutVersionInformation",
	"aboutCurrentVersion",
	"aboutCurrentVersionValue",
	"aboutCheckUpdates",
	"aboutRenderEngine",
	"aboutRenderEngineValue",
	"aboutCompatibleVersion",
	"aboutCompatibleVersionValue",
	"aboutPhpRequirement",
	"aboutPhpRequirementValue",
	"aboutCoreCapabilities",
	"aboutMarkdownPreview",
	"aboutCodeHighlighting",
	"aboutImageUpload",
	"aboutShortcutWorkflow",
	"aboutConfigurationMigration",
	"aboutResourcesSupport",
	"aboutOfficialDocumentation",
	"aboutChangelog",
	"aboutIssueFeedback",
	"aboutGithubRepository",
	"aboutSecurityPolicy",
	"aboutOpenSourceLicense",
	"aboutSupportNote",
	"aboutPluginIntroduction",
	"aboutPluginIntroductionDescription",
	"aboutTagMarkdown",
	"aboutTagLivePreview",
	"aboutTagImages",
	"aboutTagLocalAssets",
	"aboutTagShortcuts",
	"aboutHelpDialogTitle",
	"aboutHelpDialogDescription",
	"aboutChangelogDescription",
	"aboutCloseOperationDialog",
	"aboutClose",
	"aboutOpenFullDocumentation",
	"aboutHelpQuickStart",
	"aboutHelpQuickStartDescription",
	"aboutHelpEditorWorkflow",
	"aboutHelpEditorWorkflowDescription",
	"aboutHelpConfigurationMigration",
	"aboutHelpConfigurationMigrationDescription",
	"aboutCurrentVersionBadge",
	"aboutVersion018Date",
	"aboutVersion018ChangeReact",
	"aboutVersion018ChangeEditor",
	"aboutVersion018ChangeNative",
	"aboutVersion017",
	"aboutVersion017Date",
	"aboutVersion017ChangeToolbar",
	"aboutVersion017ChangeShortcuts",
] as const;

export type SettingsCenterStringKey =
	(typeof SETTINGS_CENTER_STRING_KEYS)[number];

export type SettingsCenterBootstrap = Readonly<{
	schemaVersion: 2;
	closeUrl: string;
	api: SettingsCenterApi;
	assets: Readonly<{
		brandMarkUrl: string;
		headerIllustrationUrl: string;
		searchEmptyIllustrationUrl: string;
	}>;
	links: Readonly<{
		projectUrl: string;
		documentationUrl: string;
		releasesUrl: string;
		issuesUrl: string;
		securityUrl: string;
		licenseUrl: string;
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
	section: "general" | "images" | "markdown",
	keys: ReadonlyArray<string>,
): Record<string, unknown> {
	const value = parseObject(
		root[section],
		`settings-center-${section}-settings-invalid`,
	);
	for (const key of keys) {
		const field = value[key];
		if (
			typeof field !== "string" ||
			field.length > SETTINGS_STRING_MAX_LENGTH
		)
			throw new Error(`settings-center-${section}-${key}-invalid`);
	}
	return value;
}

function parseSettingsBooleanFields(
	value: Record<string, unknown>,
	section: string,
	keys: ReadonlyArray<string>,
): void {
	for (const key of keys) {
		if (typeof value[key] !== "boolean")
			throw new Error(`settings-center-${section}-${key}-invalid`);
	}
}

function parseObject(value: unknown, code: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(code);
	}

	return value as Record<string, unknown>;
}

function parseProjectUrl(value: unknown, code: string): string {
	const url = parseString(value, code);
	try {
		const parsed = new URL(url);
		if (
			parsed.protocol !== "https:" ||
			parsed.hostname !== "github.com" ||
			!parsed.pathname.startsWith("/tao-xiaoxin/EasyMDE")
		) {
			throw new Error(code);
		}
	} catch {
		throw new Error(code);
	}
	return url;
}

function parseString(value: unknown, code: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(code);
	}

	return value;
}

function parsePossiblyEmptyString(value: unknown, code: string): string {
	if (typeof value !== "string") {
		throw new Error(code);
	}

	return value;
}

export function parseSettingsCenterSettings(
	value: unknown,
): SettingsCenterSettings {
	const root = parseObject(value, "settings-center-settings-invalid");
	if (!Number.isInteger(root.revision) || (root.revision as number) < 0) {
		throw new Error("settings-center-revision-invalid");
	}

	const general = parseSettingsStringFields(root, "general", [
		"interfaceLanguage",
		"editingMode",
		"statusBarMode",
		"autoSaveInterval",
		"defaultCategory",
		"publishVisibility",
		"summaryMode",
	]);
	parseSettingsBooleanFields(general, "general", [
		"autoFocusEditor",
		"showLineNumbers",
		"syntaxHighlight",
		"autoSave",
		"syncScroll",
		"cleanPastedContent",
		"smartListRecognition",
		"openPreviewAfterPublish",
		"featuredImagePlaceholder",
	]);

	const images = parseSettingsStringFields(root, "images", [
		"service",
		"bucket",
		"domain",
		"accessKey",
		"secretKey",
		"fileNameRule",
		"backupService",
		"backupBucket",
		"backupDomain",
		"backupAccessKey",
		"backupSecretKey",
		"backupFailureMode",
		"retryCount",
		"maxImageSize",
		"insertFormat",
		"altSource",
		"captionMode",
	]);
	parseSettingsBooleanFields(images, "images", [
		"backupEnabled",
		"backupSameObjectKey",
		"insertMarkdown",
		"compressImages",
		"preserveFileName",
		"copyUrl",
		"featuredPlaceholder",
	]);
	const uploadFormats = parseObject(
		images.uploadFormats,
		"settings-center-images-upload-formats-invalid",
	);
	for (const format of ["jpg", "png", "webp", "gif"]) {
		if (typeof uploadFormats[format] !== "boolean") {
			throw new Error(`settings-center-images-upload-format-${format}-invalid`);
		}
	}

	const markdown = parseSettingsStringFields(root, "markdown", [
		"editorTheme",
		"editorFontSize",
		"editorFont",
		"tableAlignment",
		"codeTheme",
		"codeLineNumbers",
		"lineEnding",
		"unorderedMarker",
		"orderedStart",
		"blockquoteStyle",
	]);
	parseSettingsBooleanFields(markdown, "markdown", [
		"livePreview",
		"wordWrap",
		"lineNumbers",
		"fixedToolbar",
		"githubFlavor",
		"smartPunctuation",
		"taskLists",
		"emoji",
		"math",
		"htmlRendering",
		"tableExtension",
		"footnotes",
		"definitionLists",
		"toc",
		"imageSizeSyntax",
		"pasteAsMarkdown",
	]);

	const shortcuts = parseObject(
		root.shortcuts,
		"settings-center-shortcuts-settings-invalid",
	);
	parseSettingsBooleanFields(shortcuts, "shortcuts", [
		"showHints",
		"detectConflicts",
		"showSuggestions",
	]);
	const shortcutValues = parseObject(
		shortcuts.values,
		"settings-center-shortcut-values-invalid",
	);
	for (const id of [
		"save",
		"bold",
		"italic",
		"link",
		"image",
		"heading-one",
		"heading-two",
		"quote",
		"unordered-list",
		"ordered-list",
	]) {
		const shortcut = parseObject(
			shortcutValues[id],
			`settings-center-shortcut-${id}-invalid`,
		);
		if (
			typeof shortcut.windows !== "string" ||
			typeof shortcut.mac !== "string"
		) {
			throw new Error(`settings-center-shortcut-${id}-invalid`);
		}
	}

	return root as unknown as SettingsCenterSettings;
}

export function parseSettingsCenterBootstrap(
	value: unknown,
): SettingsCenterBootstrap {
	const root = parseObject(value, "settings-center-bootstrap-invalid");
	if (root.schemaVersion !== 2) {
		throw new Error("settings-center-bootstrap-version-unsupported");
	}

	const assets = parseObject(root.assets, "settings-center-assets-invalid");
	const links = parseObject(root.links, "settings-center-links-invalid");
	const drafts = parseObject(root.drafts, "settings-center-drafts-invalid");
	const imageDraft = parseObject(
		drafts.images,
		"settings-center-images-draft-invalid",
	);
	const api = parseObject(root.api, "settings-center-api-invalid");
	const sourceStrings = parseObject(
		root.strings,
		"settings-center-strings-invalid",
	);
	const strings = {} as Record<SettingsCenterStringKey, string>;

	for (const key of SETTINGS_CENTER_STRING_KEYS) {
		strings[key] = parseString(
			sourceStrings[key],
			`settings-center-string-${key}-invalid`,
		);
	}
	for (const key of [
		"noSearchResults",
		"searchPageDescription",
		"searchResultCount",
		"insertFileNameVariable",
		"currentAllowedUploads",
		"transferFileSelectedNotice",
		"transferChecksSummary",
		"transferChecksPassed",
	] as const) {
		if ((strings[key].match(/%s/g) ?? []).length !== 1) {
			throw new Error(`settings-center-${key}-template-invalid`);
		}
	}
	return {
		schemaVersion: 2,
		closeUrl: parseString(root.closeUrl, "settings-center-close-url-invalid"),
		api: {
			actionNonce: parseString(
				api.actionNonce,
				"settings-center-api-action-nonce-invalid",
			),
			settingsUrl: parseString(
				api.settingsUrl,
				"settings-center-api-url-invalid",
			),
			nonce: parseString(api.nonce, "settings-center-api-nonce-invalid"),
		},
		assets: {
			brandMarkUrl: parseString(
				assets.brandMarkUrl,
				"settings-center-brand-url-invalid",
			),
			headerIllustrationUrl: parseString(
				assets.headerIllustrationUrl,
				"settings-center-header-url-invalid",
			),
			searchEmptyIllustrationUrl: parseString(
				assets.searchEmptyIllustrationUrl,
				"settings-center-search-empty-url-invalid",
			),
		},
		links: {
			projectUrl: parseProjectUrl(
				links.projectUrl,
				"settings-center-project-url-invalid",
			),
			documentationUrl: parseProjectUrl(
				links.documentationUrl,
				"settings-center-documentation-url-invalid",
			),
			releasesUrl: parseProjectUrl(
				links.releasesUrl,
				"settings-center-releases-url-invalid",
			),
			issuesUrl: parseProjectUrl(
				links.issuesUrl,
				"settings-center-issues-url-invalid",
			),
			securityUrl: parseProjectUrl(
				links.securityUrl,
				"settings-center-security-url-invalid",
			),
			licenseUrl: parseProjectUrl(
				links.licenseUrl,
				"settings-center-license-url-invalid",
			),
		},
		drafts: {
			images: {
				domain: parsePossiblyEmptyString(
					imageDraft.domain,
					"settings-center-images-domain-invalid",
				),
				backupDomain: parsePossiblyEmptyString(
					imageDraft.backupDomain,
					"settings-center-images-backup-domain-invalid",
				),
			},
		},
		settings: parseSettingsCenterSettings(root.settings),
		defaultSettings: parseSettingsCenterSettings(root.defaultSettings),
		strings,
	};
}
