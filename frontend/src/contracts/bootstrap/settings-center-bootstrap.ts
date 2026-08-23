import type {
	SettingsCenterApi,
	SettingsCenterSettings,
} from "../settings-center-settings";

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
	"r2AccountId",
	"bucket",
	"customDomain",
	"accessKey",
	"secretKey",
	"showSecret",
	"hideSecret",
	"primaryCredentialsConfigured",
	"backupCredentialsConfigured",
	"credentialsConfiguredHint",
	"replaceCredentialsHint",
	"connectionStatus",
	"backupConnectionStatus",
	"connectionPending",
	"testingConnection",
	"connected",
	"connectionFailed",
	"connectionStale",
	"lastTested",
	"testPrimaryConnection",
	"testBackupConnection",
	"imageHostFailureConfiguration",
	"imageHostFailureAuthentication",
	"imageHostFailureAuthorization",
	"imageHostFailureNetwork",
	"imageHostFailureTimeout",
	"imageHostFailureProvider",
	"imageHostFailureInvalidResponse",
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
	"uploadFormatRequired",
	"closeImageFeedback",
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
			primaryCredentialsConfigured: boolean;
			backupCredentialsConfigured: boolean;
		}>;
	}>;
	settings: SettingsCenterSettings;
	defaultSettings: SettingsCenterSettings;
	strings: Readonly<Record<SettingsCenterStringKey, string>>;
}>;

function parseSettingsStringFields(
	root: Record<string, unknown>,
	section: "general" | "images" | "markdown",
	fields: Readonly<Record<string, number>>,
): Record<string, unknown> {
	const value = parseObject(
		root[section],
		`settings-center-${section}-settings-invalid`,
	);
	for (const [key, maximumLength] of Object.entries(fields)) {
		const field = value[key];
		if (typeof field !== "string" || utf8ByteLength(field) > maximumLength)
			throw new Error(`settings-center-${section}-${key}-invalid`);
	}
	return value;
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function assertExactKeys(
	value: Record<string, unknown>,
	expected: ReadonlyArray<string>,
	code: string,
): void {
	const actual = Object.keys(value);
	if (
		actual.length !== expected.length ||
		expected.some(
			(key) => !Object.prototype.hasOwnProperty.call(value, key),
		)
	) {
		throw new Error(code);
	}
}

function assertEnumFields(
	value: Record<string, unknown>,
	section: string,
	fields: Readonly<Record<string, ReadonlyArray<string>>>,
): void {
	for (const [key, allowed] of Object.entries(fields)) {
		if (!allowed.includes(value[key] as string))
			throw new Error(`settings-center-${section}-${key}-invalid`);
	}
}

function assertSettingsDomain(value: unknown, code: string): void {
	if (value === "") return;
	if (typeof value !== "string") throw new Error(code);
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.port ||
			url.search ||
			url.hash ||
			(url.pathname !== "" && url.pathname !== "/")
		) {
			throw new Error(code);
		}
	} catch {
		throw new Error(code);
	}
}

const IMAGE_FILE_NAME_RULE_VARIABLES = new Set([
	"year",
	"month",
	"day",
	"date",
	"time",
	"post_id",
	"md5",
	"uuid",
	"name",
	"ext",
]);

function assertImageAccountId(value: unknown): void {
	if (
		typeof value !== "string" ||
		value.length > 64 ||
		(value !== "" && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(value))
	) {
		throw new Error("settings-center-images-accountId-invalid");
	}
}

function assertImageFileNameRule(value: unknown): void {
	if (typeof value !== "string" || value.length === 0 || value.length > 160) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}

	const variables = [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
		(match) => match[1] ?? "",
	);
	const literal = value.replace(/\{[A-Za-z0-9_]+\}/g, "");
	const hasControlCharacter = [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;

		return codePoint < 32 || codePoint === 127;
	});
	if (
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.includes("\\") ||
		value.includes("..") ||
		value.includes("//") ||
		hasControlCharacter ||
		value.includes("?") ||
		value.includes("#") ||
		!variables.includes("ext") ||
		variables.some(
			(variable) => !IMAGE_FILE_NAME_RULE_VARIABLES.has(variable),
		) ||
		!/^[A-Za-z0-9._/-]*$/.test(literal) ||
		literal.includes("{") ||
		literal.includes("}")
	) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
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
	assertExactKeys(
		root,
		["revision", "general", "images", "markdown", "shortcuts"],
		"settings-center-settings-invalid",
	);
	if (!Number.isInteger(root.revision) || (root.revision as number) < 0) {
		throw new Error("settings-center-revision-invalid");
	}

	const generalStrings = {
		interfaceLanguage: 16,
		editingMode: 16,
		statusBarMode: 32,
		autoSaveInterval: 8,
		defaultCategory: 16,
		publishVisibility: 16,
		summaryMode: 16,
	};
	const generalBooleans = [
		"autoFocusEditor",
		"showLineNumbers",
		"syntaxHighlight",
		"autoSave",
		"syncScroll",
		"cleanPastedContent",
		"smartListRecognition",
		"openPreviewAfterPublish",
		"featuredImagePlaceholder",
	];
	const general = parseSettingsStringFields(root, "general", generalStrings);
	parseSettingsBooleanFields(general, "general", generalBooleans);
	assertExactKeys(
		general,
		[...Object.keys(generalStrings), ...generalBooleans],
		"settings-center-general-settings-invalid",
	);
	assertEnumFields(general, "general", {
		interfaceLanguage: ["zh-CN", "zh-TW", "en-US"],
		editingMode: ["live-preview", "source", "preview"],
		statusBarMode: ["words-reading-time", "words", "hidden"],
		autoSaveInterval: ["30", "60", "120", "300"],
		defaultCategory: ["none", "current"],
		publishVisibility: ["public", "private", "password"],
		summaryMode: ["auto-55", "auto-100", "manual"],
	});

	const imageStrings = {
		service: 32,
		accountId: 64,
		bucket: 128,
		domain: 255,
		accessKey: 255,
		secretKey: 255,
		fileNameRule: 160,
		backupService: 32,
		backupBucket: 128,
		backupDomain: 255,
		backupAccessKey: 255,
		backupSecretKey: 255,
		backupFailureMode: 32,
		retryCount: 16,
		maxImageSize: 16,
		insertFormat: 16,
		altSource: 16,
		captionMode: 16,
	};
	const imageBooleans = [
		"backupEnabled",
		"backupSameObjectKey",
		"insertMarkdown",
		"compressImages",
		"preserveFileName",
		"copyUrl",
		"featuredPlaceholder",
	];
	const images = parseSettingsStringFields(root, "images", imageStrings);
	parseSettingsBooleanFields(images, "images", imageBooleans);
	assertExactKeys(
		images,
		[...Object.keys(imageStrings), ...imageBooleans, "uploadFormats"],
		"settings-center-images-settings-invalid",
	);
	assertImageAccountId(images.accountId);
	assertImageFileNameRule(images.fileNameRule);
	assertEnumFields(images, "images", {
		service: ["cloudflare-r2"],
		backupService: ["qiniu-kodo"],
		backupFailureMode: ["return-primary-url"],
		retryCount: ["none"],
		maxImageSize: ["original", "1920", "2560", "3840"],
		insertFormat: ["markdown", "url"],
		altSource: ["filename", "empty"],
		captionMode: ["none", "filename"],
	});
	assertSettingsDomain(images.domain, "settings-center-images-domain-invalid");
	assertSettingsDomain(
		images.backupDomain,
		"settings-center-images-backupDomain-invalid",
	);
	const uploadFormats = parseObject(
		images.uploadFormats,
		"settings-center-images-upload-formats-invalid",
	);
	assertExactKeys(
		uploadFormats,
		["jpg", "png", "webp", "gif"],
		"settings-center-images-upload-formats-invalid",
	);
	for (const format of ["jpg", "png", "webp", "gif"]) {
		if (typeof uploadFormats[format] !== "boolean") {
			throw new Error(`settings-center-images-upload-format-${format}-invalid`);
		}
	}
	if (!["jpg", "png", "webp", "gif"].some((format) => uploadFormats[format])) {
		throw new Error("settings-center-images-upload-formats-empty");
	}

	const markdownStrings = {
		editorTheme: 16,
		editorFontSize: 16,
		editorFont: 32,
		tableAlignment: 16,
		codeTheme: 16,
		codeLineNumbers: 16,
		lineEnding: 16,
		unorderedMarker: 120,
		orderedStart: 120,
		blockquoteStyle: 16,
	};
	const markdownBooleans = [
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
	];
	const markdown = parseSettingsStringFields(root, "markdown", markdownStrings);
	parseSettingsBooleanFields(markdown, "markdown", markdownBooleans);
	assertExactKeys(
		markdown,
		[...Object.keys(markdownStrings), ...markdownBooleans],
		"settings-center-markdown-settings-invalid",
	);
	assertEnumFields(markdown, "markdown", {
		editorTheme: ["system", "light", "dark"],
		editorFontSize: ["12px", "13px", "14px", "15px", "16px", "18px"],
		editorFont: ["system", "monospace", "source-han-sans"],
		tableAlignment: ["auto", "left", "center"],
		codeTheme: ["light", "dark", "follow-editor"],
		codeLineNumbers: ["show", "hide"],
		lineEnding: ["system", "lf", "crlf"],
		blockquoteStyle: ["standard", "spaced"],
	});

	const shortcuts = parseObject(
		root.shortcuts,
		"settings-center-shortcuts-settings-invalid",
	);
	assertExactKeys(
		shortcuts,
		["values", "showHints", "detectConflicts", "showSuggestions"],
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
	const shortcutIds = [
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
	];
	for (const id of shortcutIds) {
		const shortcut = parseObject(
			shortcutValues[id],
			`settings-center-shortcut-${id}-invalid`,
		);
		assertExactKeys(
			shortcut,
			["windows", "mac"],
			`settings-center-shortcut-${id}-invalid`,
		);
		if (
			typeof shortcut.windows !== "string" ||
			utf8ByteLength(shortcut.windows) > 64 ||
			typeof shortcut.mac !== "string" ||
			utf8ByteLength(shortcut.mac) > 64
		) {
			throw new Error(`settings-center-shortcut-${id}-invalid`);
		}
	}
	assertExactKeys(
		shortcutValues,
		shortcutIds,
		"settings-center-shortcut-values-invalid",
	);

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
	assertExactKeys(
		imageDraft,
		[
			"domain",
			"backupDomain",
			"primaryCredentialsConfigured",
			"backupCredentialsConfigured",
		],
		"settings-center-images-draft-invalid",
	);
	if (
		typeof imageDraft.primaryCredentialsConfigured !== "boolean" ||
		typeof imageDraft.backupCredentialsConfigured !== "boolean"
	) {
		throw new Error("settings-center-images-credential-status-invalid");
	}
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
		"lastTested",
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
			imageHostingActionNonce: parseString(
				api.imageHostingActionNonce,
				"settings-center-image-hosting-action-nonce-invalid",
			),
			imageHostingConnectionUrl: parseString(
				api.imageHostingConnectionUrl,
				"settings-center-image-hosting-url-invalid",
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
				primaryCredentialsConfigured:
					imageDraft.primaryCredentialsConfigured,
				backupCredentialsConfigured:
					imageDraft.backupCredentialsConfigured,
			},
		},
		settings: parseSettingsCenterSettings(root.settings),
		defaultSettings: parseSettingsCenterSettings(root.defaultSettings),
		strings,
	};
}
