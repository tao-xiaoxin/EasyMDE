export type GeneralSettings = Readonly<{
	// Retained only for persisted/imported settings compatibility; WordPress owns the UI locale.
	interfaceLanguage: string;
	editingMode: string;
	autoFocusEditor: boolean;
	showLineNumbers: boolean;
	syntaxHighlight: boolean;
	statusBarMode: string;
	autoSave: boolean;
	autoSaveInterval: string;
	syncScroll: boolean;
	publishVisibility: string;
	openPreviewAfterPublish: boolean;
	summaryMode: string;
	featuredImagePlaceholder: boolean;
}>;

export type ImageUploadFormat = "jpg" | "png" | "webp" | "gif";
export type ImageHostProvider =
	| "cloudflare-r2"
	| "qiniu-kodo"
	| "aliyun-oss"
	| "tencent-cos";

export type ImageSettings = Readonly<{
	service: ImageHostProvider;
	endpoint: string;
	bucket: string;
	domain: string;
	accessKey: string;
	secretKey: string;
	fileNameRule: string;
	uploadRetryCount: number;
	backupEnabled: boolean;
	backupService: ImageHostProvider;
	backupEndpoint: string;
	backupBucket: string;
	backupDomain: string;
	backupAccessKey: string;
	backupSecretKey: string;
	insertMarkdown: boolean;
	compressImages: boolean;
	preserveFileName: boolean;
	copyUrl: boolean;
	maxImageSize: string;
	uploadFormats: Readonly<Record<ImageUploadFormat, boolean>>;
	insertFormat: string;
	altSource: string;
	captionMode: string;
	featuredPlaceholder: boolean;
}>;

export type MarkdownSettings = Readonly<{
	wordWrap: boolean;
	lineNumbers: boolean;
	editorTheme: string;
	githubFlavor: boolean;
	smartPunctuation: boolean;
	tableAlignment: string;
	codeLineNumbers: string;
	htmlRendering: boolean;
	pasteAsMarkdown: boolean;
	lineEnding: string;
	unorderedMarker: string;
	orderedStart: string;
	blockquoteStyle: string;
}>;

export type ShortcutId =
	| "save"
	| "bold"
	| "italic"
	| "link"
	| "image"
	| "heading-one"
	| "heading-two"
	| "quote"
	| "unordered-list"
	| "ordered-list";

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
	actionNonce: string;
	imageHostingVerificationActionNonce: string;
	imageHostingVerificationUrl: string;
	imageHostingSecretRevealActionNonce: string;
	imageHostingSecretRevealUrl: string;
	settingsUrl: string;
	nonce: string;
}>;
