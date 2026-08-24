import { describe, expect, it } from "vitest";
import {
	SETTINGS_CENTER_DEFAULT_SETTINGS,
	SETTINGS_CENTER_TEST_SETTINGS,
} from "../../test/settings-center-settings-fixture";
import {
	parseSettingsCenterBootstrap,
	parseSettingsCenterSettings,
	SETTINGS_CENTER_STRING_KEYS,
} from "./settings-center-bootstrap";

function bootstrap(noSearchResults = 'No settings related to "%s" were found') {
	return {
		schemaVersion: 2,
		closeUrl: "/wp-admin/options-general.php",
		api: {
			settingsUrl: "/wp-json/easymde/v1/settings",
			actionNonce: "test-action-nonce",
			imageHostingActionNonce: "test-image-hosting-action-nonce",
			imageHostingConnectionUrl: "/wp-json/easymde/v1/image-hosting/connection",
			nonce: "test-nonce",
		},
		assets: {
			brandMarkUrl: "/plugin/brand.png",
			headerIllustrationUrl: "/plugin/header.png",
			searchEmptyIllustrationUrl: "/plugin/search-empty.png",
		},
		links: {
			projectUrl: "https://github.com/tao-xiaoxin/EasyMDE",
			documentationUrl: "https://github.com/tao-xiaoxin/EasyMDE#readme",
			releasesUrl: "https://github.com/tao-xiaoxin/EasyMDE/releases",
			issuesUrl: "https://github.com/tao-xiaoxin/EasyMDE/issues",
			securityUrl: "https://github.com/tao-xiaoxin/EasyMDE/security/policy",
			licenseUrl: "https://github.com/tao-xiaoxin/EasyMDE/blob/main/LICENSE",
		},
		drafts: {
			images: {
				domain: "https://img.example.test",
				backupDomain: "https://backup.example.test",
				primaryCredentialsConfigured: false,
				backupCredentialsConfigured: false,
			},
		},
		settings: SETTINGS_CENTER_TEST_SETTINGS,
		defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
		strings: {
			...Object.fromEntries(
				SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
			),
			searchPageDescription: 'Only settings matching "%s" are shown.',
			searchResultCount: "%s items",
			insertFileNameVariable: "Insert %s variable",
			currentAllowedUploads: "Currently allowed uploads: %s.",
			editPrompt: "Edit %s",
			duplicatePrompt: "Duplicate %s",
			deletePrompt: "Delete %s",
			transferFileSelectedNotice: "Selected %s",
			transferChecksSummary: "%s key configuration items checked",
			transferChecksPassed: "%s items passed",
			lastTested: "Last tested: %s",
			noSearchResults,
		},
	};
}

type MutableSettingsRecord = Record<string, unknown> & {
	general: Record<string, unknown>;
	images: Record<string, unknown>;
	markdown: Record<string, unknown>;
};

describe("parseSettingsCenterBootstrap", () => {
	it.each([
		[
			"an extra field",
			(settings: MutableSettingsRecord) => {
				settings.general.unexpected = true;
			},
		],
		[
			"an invalid enum",
			(settings: MutableSettingsRecord) => {
				settings.images.retryCount = "forever";
			},
		],
		[
			"no enabled upload format",
			(settings: MutableSettingsRecord) => {
				settings.images.uploadFormats = {
					jpg: false,
					png: false,
					webp: false,
					gif: false,
				};
			},
		],
	])(
		"rejects settings with %s before they reach the REST save",
		(_label, mutate) => {
			const settings = structuredClone(
				SETTINGS_CENTER_TEST_SETTINGS,
			) as unknown as MutableSettingsRecord;
			mutate(settings);
			expect(() => parseSettingsCenterSettings(settings)).toThrow();
		},
	);

	it("measures imported string limits as UTF-8 bytes like the REST contract", () => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images.bucket = "界".repeat(160);

		expect(() => parseSettingsCenterSettings(settings)).toThrow(
			"settings-center-images-bucket-invalid",
		);
	});

	it("accepts only the canonical Cloudflare R2 API endpoint shape", () => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images.endpoint = "https://api.example.test";
		expect(() => parseSettingsCenterSettings(settings)).toThrow(
			"settings-center-images-endpoint-invalid",
		);
	});

	it("accepts the same hyphenated R2 endpoint identity as PHP", () => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images.endpoint =
			"https://synthetic-account.r2.cloudflarestorage.com";
		expect(parseSettingsCenterSettings(settings).images.endpoint).toBe(
			settings.images.endpoint,
		);
	});

	it.each(["eu", "us", "fedramp"])(
		"accepts the official Cloudflare R2 %s jurisdiction endpoint",
		(jurisdiction) => {
			const settings = structuredClone(
				SETTINGS_CENTER_TEST_SETTINGS,
			) as unknown as MutableSettingsRecord;
			settings.images.endpoint = `https://synthetic-account.${jurisdiction}.r2.cloudflarestorage.com`;
			expect(parseSettingsCenterSettings(settings).images.endpoint).toBe(
				settings.images.endpoint,
			);
		},
	);

	it.each([
		"https://synthetic-account.unknown.r2.cloudflarestorage.com",
		"https://synthetic-account.eu.r2.cloudflarestorage.com:443",
		"https://synthetic-account.eu.r2.cloudflarestorage.com/path",
		"https://synthetic-account.eu.r2.cloudflarestorage.com/",
	])("rejects a noncanonical R2 endpoint: %s", (endpoint) => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images.endpoint = endpoint;
		expect(() => parseSettingsCenterSettings(settings)).toThrow(
			"settings-center-images-endpoint-invalid",
		);
	});

	it("rejects provider fields that do not belong to the selected service", () => {
		const qiniu = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		qiniu.images.service = "qiniu-kodo";
		qiniu.images.endpoint =
			"https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
		expect(() => parseSettingsCenterSettings(qiniu)).toThrow(
			"settings-center-images-endpoint-invalid",
		);

		const oss = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		oss.images.service = "aliyun-oss";
		oss.images.endpoint = "";
		oss.images.region = "cn-hangzhou";
		expect(parseSettingsCenterSettings(oss).images.region).toBe("cn-hangzhou");
	});

	it.each([
		["a removed upload destination", "destination", "remote"],
		["a removed R2 account ID", "accountId", "synthetic-account"],
	] as const)("rejects %s", (_label, key, value) => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images[key] = value;

		expect(() => parseSettingsCenterSettings(settings)).toThrow();
	});

	it.each([
		"cloudflare-r2",
		"qiniu-kodo",
		"aliyun-oss",
		"tencent-cos",
	] as const)(
		"accepts the implemented %s provider for primary and backup storage",
		(service) => {
			const settings = structuredClone(
				SETTINGS_CENTER_TEST_SETTINGS,
			) as unknown as MutableSettingsRecord;
			settings.images.service = service;
			settings.images.backupService = service;
			if (service !== "cloudflare-r2") {
				settings.images.endpoint = "";
			}
			expect(parseSettingsCenterSettings(settings).images.service).toBe(
				service,
			);
		},
	);

	it.each([
		["domain", "http://img.example.test"],
		["fallbackDomain", "http://fallback.example.test"],
		["endpoint", "http://api.example.test"],
		["backupDomain", "//backup.example.test"],
		["backupEndpoint", "//api.example.test"],
	] as const)("rejects a non-HTTPS %s", (key, value) => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images[key] = value;

		expect(() => parseSettingsCenterSettings(settings)).toThrow();
	});

	it("physically rejects the removed General settings fields", () => {
		for (const key of [
			"cleanPastedContent",
			"smartListRecognition",
			"defaultCategory",
		] as const) {
			const settings = structuredClone(
				SETTINGS_CENTER_TEST_SETTINGS,
			) as unknown as MutableSettingsRecord;
			settings.general[key] = true;
			expect(() => parseSettingsCenterSettings(settings)).toThrow(
				"settings-center-general-settings-invalid",
			);
		}
	});

	it.each([
		["../{name}.{ext}"],
		["/{date}/{uuid}.{ext}"],
		["{date}/{unknown}.{ext}"],
		["{date}/{uuid}"],
	] as const)("rejects an unsafe filename rule: %s", (fileNameRule) => {
		const settings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as MutableSettingsRecord;
		settings.images.fileNameRule = fileNameRule;

		expect(() => parseSettingsCenterSettings(settings)).toThrow(
			"settings-center-images-fileNameRule-invalid",
		);
	});

	it("does not admit AI strings into the settings bootstrap contract", () => {
		expect(
			SETTINGS_CENTER_STRING_KEYS.some(
				(key) => key.startsWith("ai") || key.includes("Ai"),
			),
		).toBe(false);
	});

	it("does not expose a second interface-language setting", () => {
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("interfaceLanguage");
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("simplifiedChinese");
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("traditionalChinese");
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("english");
	});

	it("does not expose strings for removed General settings", () => {
		expect(SETTINGS_CENTER_STRING_KEYS).not.toEqual(
			expect.arrayContaining([
				"cleanPastedContent",
				"cleanPastedContentDescription",
				"smartListRecognition",
				"smartListRecognitionDescription",
				"defaultCategory",
				"noAutomaticCategory",
				"currentCategory",
			]),
		);
	});

	it("does not expose removed Markdown settings strings", () => {
		expect(SETTINGS_CENTER_STRING_KEYS).not.toEqual(
			expect.arrayContaining([
				"editorFontSize",
				"editorFont",
				"systemDefault",
				"monospaceFont",
				"sourceHanSans",
				"codeBlockTheme",
				"lightCodeTheme",
				"darkCodeTheme",
				"followEditor",
				"tocDirectory",
				"tocDirectoryDescription",
				"codeTheme",
				"toc",
				"markdownLivePreview",
				"livePreviewDescription",
				"fixedToolbar",
				"fixedToolbarDescription",
				"taskLists",
				"taskListsDescription",
				"emoji",
				"emojiDescription",
				"mathSupport",
				"mathSupportDescription",
				"markdownExtensions",
				"tableExtension",
				"tableExtensionDescription",
				"footnotes",
				"footnotesDescription",
				"definitionLists",
				"definitionListsDescription",
				"imageSizeSyntax",
				"imageSizeSyntaxDescription",
			]),
		);
		expect(SETTINGS_CENTER_STRING_KEYS).toEqual(
			expect.arrayContaining(["livePreview", "general", "about"]),
		);
	});

	it("parses the Markdown settings contract without removed presentation fields", () => {
		expect(
			Object.keys(
				parseSettingsCenterSettings(SETTINGS_CENTER_TEST_SETTINGS).markdown,
			),
		).toEqual([
			"wordWrap",
			"lineNumbers",
			"editorTheme",
			"githubFlavor",
			"smartPunctuation",
			"tableAlignment",
			"codeLineNumbers",
			"htmlRendering",
			"pasteAsMarkdown",
			"lineEnding",
			"unorderedMarker",
			"orderedStart",
			"blockquoteStyle",
		]);
	});

	it.each([
		"editorFontSize",
		"editorFont",
		"codeTheme",
		"toc",
		"livePreview",
		"fixedToolbar",
		"taskLists",
		"emoji",
		"math",
		"tableExtension",
		"footnotes",
		"definitionLists",
		"imageSizeSyntax",
	])(
		"rejects the removed Markdown field %s as an exact-shape violation",
		(removedKey) => {
			const settings = structuredClone(
				SETTINGS_CENTER_TEST_SETTINGS,
			) as unknown as MutableSettingsRecord;
			for (const key of [
				"editorFontSize",
				"editorFont",
				"codeTheme",
				"toc",
				"livePreview",
				"fixedToolbar",
				"taskLists",
				"emoji",
				"math",
				"tableExtension",
				"footnotes",
				"definitionLists",
				"imageSizeSyntax",
			])
				delete settings.markdown[key];
			settings.markdown[removedKey] = [
				"toc",
				"livePreview",
				"fixedToolbar",
				"taskLists",
				"emoji",
				"math",
				"tableExtension",
				"footnotes",
				"definitionLists",
				"imageSizeSyntax",
			].includes(removedKey)
				? false
				: "removed";

			expect(() => parseSettingsCenterSettings(settings)).toThrow(
				"settings-center-markdown-settings-invalid",
			);
		},
	);

	it("declares the PHP-owned remote image-host interaction strings", () => {
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("uploadDestination");
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("wordpressMediaLibrary");
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("remoteImageHost");
		expect(SETTINGS_CENTER_STRING_KEYS).not.toContain("customUpload");
		expect(SETTINGS_CENTER_STRING_KEYS).toEqual(
			expect.arrayContaining([
				"r2ApiEndpoint",
				"providerRegion",
				"imageFallbackDomain",
				"duplicateImageHostTitle",
				"duplicateImageHostDescription",
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
			]),
		);
	});

	it.each(["Last tested", "%s %s"])(
		"rejects an invalid last-tested template: %s",
		(template) => {
			const value = bootstrap();
			value.strings.lastTested = template;
			expect(() => parseSettingsCenterBootstrap(value)).toThrow(
				"settings-center-lastTested-template-invalid",
			);
		},
	);

	it("accepts exactly one search-query placeholder", () => {
		expect(
			parseSettingsCenterBootstrap(bootstrap()).strings.noSearchResults,
		).toContain("%s");
	});

	it.each(["No matching settings found", "%s %s"])(
		"rejects an invalid search-query template: %s",
		(template) => {
			expect(() => parseSettingsCenterBootstrap(bootstrap(template))).toThrow(
				"settings-center-noSearchResults-template-invalid",
			);
		},
	);

	it.each(["Only matching settings are shown.", "%s %s"])(
		"rejects an invalid search-page description template: %s",
		(template) => {
			const value = bootstrap();
			value.strings.searchPageDescription = template;
			expect(() => parseSettingsCenterBootstrap(value)).toThrow(
				"settings-center-searchPageDescription-template-invalid",
			);
		},
	);

	it.each(["Items", "%s %s"])(
		"rejects an invalid search-result count template: %s",
		(template) => {
			const value = bootstrap();
			value.strings.searchResultCount = template;
			expect(() => parseSettingsCenterBootstrap(value)).toThrow(
				"settings-center-searchResultCount-template-invalid",
			);
		},
	);

	it.each([
		["insertFileNameVariable", "Insert variable"],
		["currentAllowedUploads", "%s %s"],
	] as const)("rejects an invalid Images template for %s", (key, template) => {
		const value = bootstrap();
		value.strings[key] = template;
		expect(() => parseSettingsCenterBootstrap(value)).toThrow(
			`settings-center-${key}-template-invalid`,
		);
	});

	it("rejects an invalid selected Transfer file template", () => {
		const value = bootstrap();
		value.strings.transferFileSelectedNotice = "Selected configuration file";
		expect(() => parseSettingsCenterBootstrap(value)).toThrow(
			"settings-center-transferFileSelectedNotice-template-invalid",
		);
	});

	it.each(["transferChecksSummary", "transferChecksPassed"] as const)(
		"rejects an invalid Transfer check template for %s",
		(key) => {
			const value = bootstrap();
			value.strings[key] = "Missing count";
			expect(() => parseSettingsCenterBootstrap(value)).toThrow(
				`settings-center-${key}-template-invalid`,
			);
		},
	);
	it("accepts empty optional image domains from the live defaults", () => {
		const value = bootstrap();
		value.drafts.images.domain = "";
		value.drafts.images.backupDomain = "";

		expect(parseSettingsCenterBootstrap(value).drafts.images).toEqual({
			domain: "",
			backupDomain: "",
			primaryCredentialsConfigured: false,
			backupCredentialsConfigured: false,
		});
	});
	it.each(["retryCount", "maxImageSize"] as const)(
		"rejects a missing image field: %s",
		(key) => {
			const value = bootstrap();
			value.settings = {
				...value.settings,
				images: { ...value.settings.images },
			};
			const images = value.settings.images as unknown as Record<
				string,
				unknown
			>;
			delete images[key];

			expect(() => parseSettingsCenterBootstrap(value)).toThrow(
				`settings-center-images-${key}-invalid`,
			);
		},
	);

	it.each(["retryCount", "maxImageSize"] as const)(
		"rejects a non-string image field: %s",
		(key) => {
			const value = bootstrap();
			value.settings = {
				...value.settings,
				images: { ...value.settings.images },
			};
			const images = value.settings.images as unknown as Record<
				string,
				unknown
			>;
			images[key] = 2560;

			expect(() => parseSettingsCenterBootstrap(value)).toThrow(
				`settings-center-images-${key}-invalid`,
			);
		},
	);

	it("rejects a missing ordered-list shortcut", () => {
		const value = bootstrap();
		const shortcutValues = {
			...value.settings.shortcuts.values,
		} as Record<string, unknown>;
		delete shortcutValues["ordered-list"];
		value.settings = {
			...value.settings,
			shortcuts: {
				...value.settings.shortcuts,
				values: shortcutValues as typeof value.settings.shortcuts.values,
			},
		};

		expect(() => parseSettingsCenterBootstrap(value)).toThrow(
			"settings-center-shortcut-ordered-list-invalid",
		);
	});
});
