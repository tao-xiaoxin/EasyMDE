export type SummaryMode = "auto-55" | "auto-100" | "manual";
export type StatusBarMode = "detailed" | "compact" | "hidden";

export type GeneralSettings = Readonly<{
	// Retained only for persisted/imported settings compatibility; WordPress owns the UI locale.
	interfaceLanguage: string;
	editingMode: string;
	showLineNumbers: boolean;
	statusBarMode: StatusBarMode;
	autoSave: boolean;
	autoSaveInterval: string;
	syncScroll: boolean;
	publishVisibility: string;
	openPreviewAfterPublish: boolean;
	applyEditorThemeToFrontend: boolean;
	showPublishedCodeCopyButton: boolean;
	summaryMode: SummaryMode;
}>;

export type ImageUploadFormat = "jpg" | "png" | "webp" | "gif";
export type RemoteImageUploadMode = "both" | "visual" | "source" | "off";
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
	compressImages: boolean;
	autoUploadPastedImages: boolean;
	remoteImageUploadMode: RemoteImageUploadMode;
	maxImageSizeMb: number;
	uploadFormats: Readonly<Record<ImageUploadFormat, boolean>>;
	titleDisplay: "filename" | "none";
}>;

export type MarkdownSettings = Readonly<{
	wordWrap: boolean;
	githubFlavor: boolean;
	smartPunctuation: boolean;
	tableAlignment: string;
	codeLineNumbers: string;
	pasteAsMarkdown: boolean;
}>;

export const SHORTCUT_IDS = [
	"save",
	"bold",
	"italic",
	"strikethrough",
	"paragraph",
	"link",
	"image",
	"heading-one",
	"heading-two",
	"heading-three",
	"heading-four",
	"heading-five",
	"heading-six",
	"quote",
	"unordered-list",
	"ordered-list",
	"inline-code",
	"code-fence",
	"math-block",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export type ShortcutValue = Readonly<{ windows: string; mac: string }>;
export type ShortcutValues = Readonly<Record<ShortcutId, ShortcutValue>>;

export type ShortcutsSettings = Readonly<{
	values: ShortcutValues;
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
