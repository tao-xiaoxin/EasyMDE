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

export const IMAGE_UPLOAD_EXTENSIONS = [
	"webp",
	"png",
	"jpg",
	"jpeg",
	"jfif",
	"gif",
] as const;

export type ImageUploadExtension = (typeof IMAGE_UPLOAD_EXTENSIONS)[number];
export type ImageUploadFormat = ImageUploadExtension;

export type ImageUploadFormats = Readonly<
	Record<ImageUploadExtension, boolean>
>;

export const DEFAULT_IMAGE_UPLOAD_FORMATS: ImageUploadFormats = Object.freeze({
	webp: true,
	png: true,
	jpg: true,
	jpeg: true,
	jfif: true,
	gif: true,
});

export type RemoteImageUploadMode = "both" | "visual" | "source" | "off";
export type ImageHostProvider =
	| "cloudflare-r2"
	| "qiniu-kodo"
	| "aliyun-oss"
	| "tencent-cos";

export const DEFAULT_IMAGE_STORAGE_PATH = "{year}/{month}";
export const DEFAULT_IMAGE_FILE_NAME_RULE = "{md5}";

export type LegacyImageObjectKeySplit = Readonly<{
	storagePath: string;
	fileNameRule: string;
}>;

const LEGACY_IMAGE_UPLOAD_EXTENSIONS = ["jpg", "png", "webp", "gif"] as const;
const LEGACY_EXTENSION_PLACEHOLDER = ".{ext}";

function exactObjectKeys(
	value: Record<string, unknown>,
	keys: ReadonlyArray<string>,
): boolean {
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === keys.length &&
		keys.every(
			// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
			(key) => Object.prototype.hasOwnProperty.call(value, key),
		)
	);
}

/**
 * Convert the historical four-key upload map at the transfer boundary. The
 * old `jpg` switch represented all three JPEG filename aliases.
 */
export function migrateLegacyImageUploadFormats(
	value: unknown,
): ImageUploadFormats {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("settings-center-images-upload-formats-invalid");
	}
	const formats = value as Record<string, unknown>;
	if (exactObjectKeys(formats, IMAGE_UPLOAD_EXTENSIONS)) {
		for (const extension of IMAGE_UPLOAD_EXTENSIONS) {
			if (typeof formats[extension] !== "boolean") {
				throw new Error(
					`settings-center-images-upload-format-${extension}-invalid`,
				);
			}
		}
		return {
			webp: formats.webp as boolean,
			png: formats.png as boolean,
			jpg: formats.jpg as boolean,
			jpeg: formats.jpeg as boolean,
			jfif: formats.jfif as boolean,
			gif: formats.gif as boolean,
		};
	}
	if (!exactObjectKeys(formats, LEGACY_IMAGE_UPLOAD_EXTENSIONS)) {
		throw new Error("settings-center-images-upload-formats-invalid");
	}
	for (const extension of LEGACY_IMAGE_UPLOAD_EXTENSIONS) {
		if (typeof formats[extension] !== "boolean") {
			throw new Error(
				`settings-center-images-upload-format-${extension}-invalid`,
			);
		}
	}
	return {
		webp: formats.webp as boolean,
		png: formats.png as boolean,
		jpg: formats.jpg as boolean,
		jpeg: formats.jpg as boolean,
		jfif: formats.jpg as boolean,
		gif: formats.gif as boolean,
	};
}

export function splitLegacyImageFileNameRule(
	value: string,
): LegacyImageObjectKeySplit {
	if (typeof value !== "string") {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
	const separator = value.lastIndexOf("/");
	const storagePath = separator < 0 ? "" : value.slice(0, separator);
	const fileNameRule = separator < 0 ? value : value.slice(separator + 1);
	return {
		storagePath,
		fileNameRule: stripLegacyImageFileNameRule(fileNameRule),
	};
}

export function stripLegacyImageFileNameRule(value: string): string {
	if (
		typeof value !== "string" ||
		value.includes("/") ||
		!value.endsWith(LEGACY_EXTENSION_PLACEHOLDER) ||
		value.split("{ext}").length - 1 !== 1
	) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
	const stem = value.slice(0, -LEGACY_EXTENSION_PLACEHOLDER.length);
	if (!stem) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
	return stem;
}

const IMAGE_PREVIEW_VALUES: Readonly<Record<string, string>> = {
	"{year}": "2026",
	"{month}": "07",
	"{day}": "13",
	"{date}": "20260713",
	"{time}": "153042",
	"{post_id}": "128",
	"{md5}": "a8f4c2d1",
	"{uuid}": "a8f4c2d1",
	"{name}": "easymde-image",
};

function expandImagePreviewValue(value: string): string {
	return value.replace(/\{(?:year|month|day|date|time|post_id|md5|uuid|name)\}/g, (token) => {
		const replacement = IMAGE_PREVIEW_VALUES[token];
		if (!replacement) throw new Error("settings-center-image-preview-token-invalid");
		return replacement;
	});
}

export function buildImageObjectKeyPreview(
	storagePath: string,
	fileNameRule: string,
	uploadFormats: ImageUploadFormats,
): string {
	const extension = IMAGE_UPLOAD_EXTENSIONS.find((candidate) => {
		if (typeof uploadFormats[candidate] !== "boolean") {
			throw new Error("settings-center-images-upload-formats-invalid");
		}
		return uploadFormats[candidate];
	});
	if (!extension) {
		throw new Error("settings-center-images-upload-formats-empty");
	}
	const expandedPath = expandImagePreviewValue(storagePath);
	const expandedStem = expandImagePreviewValue(fileNameRule);
	return [expandedPath, `${expandedStem}.${extension}`]
		.filter((value) => value !== "")
		.join("/");
}

export type ImageSettings = Readonly<{
	imageHostingEnabled: boolean;
	wechatPngExportEnabled: boolean;
	service: ImageHostProvider;
	endpoint: string;
	bucket: string;
	domain: string;
	accessKey: string;
	secretKey: string;
	storagePath: string;
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
