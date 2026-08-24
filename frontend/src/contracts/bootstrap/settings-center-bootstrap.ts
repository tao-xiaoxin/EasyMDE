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
	"imageFallbackDomain",
	"imageFallbackDomainDescription",
	"cosBucketHint",
	"duplicateImageHostTitle",
	"duplicateImageHostDescription",
	"bucket",
	"customDomain",
	"accessKey",
	"secretKey",
	"showSecret",
	"hideSecret",
	"revealingSecret",
	"secretRevealFailed",
	"primaryCredentialsConfigured",
	"backupCredentialsConfigured",
	"uploadVerificationStatus",
	"backupVerificationStatus",
	"uploadVerificationPending",
	"verifyingUpload",
	"uploadVerified",
	"uploadVerificationFailed",
	"uploadVerificationStale",
	"lastVerified",
	"verifyPrimaryUpload",
	"verifyBackupUpload",
	"uploadVerificationSucceeded",
	"uploadVerificationSuccessDescription",
	"uploadVerificationFailureDescription",
	"uploadVerificationFailureHint",
	"insecureViewingDomainWarning",
	"uploadedObjectPath",
	"uploadedImageUrl",
	"closeImageFeedback",
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
	"uploadRetryCount",
	"uploadRetryCountDescription",
	"showBackupAccessKey",
	"hideBackupAccessKey",
	"showBackupSecretKey",
	"hideBackupSecretKey",
	"uploadBehavior",
	"compressImages",
	"compressImagesDescription",
	"maximumImageSize",
	"maximumImageSizeDescription",
	"maximumImageSizeSystemLimitExceeded",
	"imageTitleDisplay",
	"allowedUploadFormats",
	"allowedUploadFormatsDescription",
	"uploadFormatRequired",
	"uploadFormatJpg",
	"uploadFormatPng",
	"uploadFormatWebp",
	"uploadFormatGif",
	"allowUploadJpg",
	"allowUploadPng",
	"allowUploadWebp",
	"allowUploadGif",
	"uploadFormatSeparator",
	"useFileName",
	"leaveEmpty",
	"markdownEditorSettings",
	"wordWrap",
	"wordWrapDescription",
	"markdownLineNumbersDescription",
	"editorTheme",
	"automaticFollowSystem",
	"light",
	"dark",
	"markdownParsingRendering",
	"githubFlavor",
	"githubFlavorDescription",
	"smartPunctuation",
	"smartPunctuationDescription",
	"tableAlignment",
	"autoAlignByContent",
	"alignLeft",
	"alignCenter",
	"codeBlockLineNumbers",
	"show",
	"hide",
	"htmlRendering",
	"htmlRenderingDescription",
	"pasteAsMarkdown",
	"pasteAsMarkdownDescription",
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
	uploadLimits: Readonly<{ systemMaxBytes: number }>;
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
			// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
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

function hasExplicitUrlPort(value: string): boolean {
	const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0] ?? "";
	if (authority.startsWith("[")) {
		return authority.slice(authority.indexOf("]") + 1).startsWith(":");
	}
	return authority.includes(":");
}

function assertSettingsDomain(value: unknown, code: string): void {
	if (value === "") return;
	if (typeof value !== "string") throw new Error(code);
	try {
		const url = new URL(value);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username ||
			url.password ||
			url.port ||
			hasExplicitUrlPort(value) ||
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

function assertR2Endpoint(value: unknown, code: string): void {
	if (value === "") return;
	if (
		typeof value !== "string" ||
		!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(
			value,
		)
	) {
		throw new Error(code);
	}
}

function assertOssEndpoint(value: unknown, code: string): void {
	if (value === "") return;
	if (
		typeof value !== "string" ||
		!/^https:\/\/oss-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.aliyuncs\.com$/.test(
			value,
		)
	) {
		throw new Error(code);
	}
}

function assertCosEndpoint(value: unknown, code: string): void {
	if (value === "") return;
	if (
		typeof value !== "string" ||
		!/^https:\/\/cos\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myqcloud\.com$/.test(
			value,
		)
	) {
		throw new Error(code);
	}
}

function assertProviderSpecificFields(
	provider: unknown,
	endpoint: unknown,
	prefix: "" | "backup",
): void {
	const endpointKey = prefix ? "backupEndpoint" : "endpoint";
	const endpointCode = `settings-center-images-${endpointKey}-invalid`;
	if (provider === "cloudflare-r2") {
		assertR2Endpoint(endpoint, endpointCode);
		return;
	}
	if (provider === "aliyun-oss") {
		assertOssEndpoint(endpoint, endpointCode);
		return;
	}
	if (provider === "tencent-cos") {
		assertCosEndpoint(endpoint, endpointCode);
		return;
	}
	if (endpoint !== "") throw new Error(endpointCode);
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
		publishVisibility: 16,
		summaryMode: 16,
	};
	const generalBooleans = [
		"autoFocusEditor",
		"showLineNumbers",
		"syntaxHighlight",
		"autoSave",
		"syncScroll",
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
		publishVisibility: ["public", "private", "password"],
		summaryMode: ["auto-55", "auto-100", "manual"],
	});

	const imageStrings = {
		service: 32,
		endpoint: 255,
		bucket: 128,
		domain: 255,
		accessKey: 255,
		secretKey: 255,
		fileNameRule: 160,
		backupService: 32,
		backupEndpoint: 255,
		backupBucket: 128,
		backupDomain: 255,
		backupAccessKey: 255,
		backupSecretKey: 255,
		titleDisplay: 16,
	};
	const imageBooleans = [
		"backupEnabled",
		"compressImages",
	];
	const images = parseSettingsStringFields(root, "images", imageStrings);
	parseSettingsBooleanFields(images, "images", imageBooleans);
	if (
		!Number.isInteger(images.maxImageSizeMb) ||
		(images.maxImageSizeMb as number) < 1 ||
		(images.maxImageSizeMb as number) > 10
	) {
		throw new Error("settings-center-images-maxImageSizeMb-invalid");
	}
	if (
		!Number.isInteger(images.uploadRetryCount) ||
		(images.uploadRetryCount as number) < 0 ||
		(images.uploadRetryCount as number) > 5
	) {
		throw new Error("settings-center-images-uploadRetryCount-invalid");
	}
	assertExactKeys(
		images,
		[
			...Object.keys(imageStrings),
			...imageBooleans,
			"maxImageSizeMb",
			"uploadRetryCount",
			"uploadFormats",
		],
		"settings-center-images-settings-invalid",
	);
	assertImageFileNameRule(images.fileNameRule);
	assertEnumFields(images, "images", {
		service: ["cloudflare-r2", "qiniu-kodo", "aliyun-oss", "tencent-cos"],
		backupService: ["cloudflare-r2", "qiniu-kodo", "aliyun-oss", "tencent-cos"],
		titleDisplay: ["none", "filename"],
	});
	assertSettingsDomain(images.domain, "settings-center-images-domain-invalid");
	assertSettingsDomain(
		images.backupDomain,
		"settings-center-images-backupDomain-invalid",
	);
	assertProviderSpecificFields(images.service, images.endpoint, "");
	assertProviderSpecificFields(
		images.backupService,
		images.backupEndpoint,
		"backup",
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
		tableAlignment: 16,
		codeLineNumbers: 16,
	};
	const markdownBooleans = [
		"wordWrap",
		"lineNumbers",
		"githubFlavor",
		"smartPunctuation",
		"htmlRendering",
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
		tableAlignment: ["auto", "left", "center"],
		codeLineNumbers: ["show", "hide"],
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
		"maximumImageSizeSystemLimitExceeded",
		"transferFileSelectedNotice",
		"transferChecksSummary",
		"transferChecksPassed",
		"lastVerified",
	] as const) {
		if ((strings[key].match(/%s/g) ?? []).length !== 1) {
			throw new Error(`settings-center-${key}-template-invalid`);
		}
	}
	return {
		schemaVersion: 2,
		closeUrl: parseString(root.closeUrl, "settings-center-close-url-invalid"),
		uploadLimits: {
			systemMaxBytes: (() => {
				const uploadLimits = parseObject(
					root.uploadLimits,
					"settings-center-system-max-upload-bytes-invalid",
				);
				assertExactKeys(
					uploadLimits,
					["systemMaxBytes"],
					"settings-center-upload-limits-invalid",
				);
				if (
					!Number.isInteger(uploadLimits.systemMaxBytes) ||
					(uploadLimits.systemMaxBytes as number) < 1
				) {
					throw new Error("settings-center-system-max-upload-bytes-invalid");
				}
				return uploadLimits.systemMaxBytes as number;
			})(),
		},
		api: {
			actionNonce: parseString(
				api.actionNonce,
				"settings-center-api-action-nonce-invalid",
			),
			imageHostingVerificationActionNonce: parseString(
				api.imageHostingVerificationActionNonce,
				"settings-center-image-hosting-action-nonce-invalid",
			),
			imageHostingVerificationUrl: parseString(
				api.imageHostingVerificationUrl,
				"settings-center-image-hosting-url-invalid",
			),
			imageHostingSecretRevealActionNonce: parseString(
				api.imageHostingSecretRevealActionNonce,
				"settings-center-image-hosting-secret-action-nonce-invalid",
			),
			imageHostingSecretRevealUrl: parseString(
				api.imageHostingSecretRevealUrl,
				"settings-center-image-hosting-secret-url-invalid",
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
				primaryCredentialsConfigured: imageDraft.primaryCredentialsConfigured,
				backupCredentialsConfigured: imageDraft.backupCredentialsConfigured,
			},
		},
		settings: parseSettingsCenterSettings(root.settings),
		defaultSettings: parseSettingsCenterSettings(root.defaultSettings),
		strings,
	};
}
