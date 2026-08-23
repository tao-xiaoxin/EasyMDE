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
			noSearchResults,
		},
	};
}

type MutableSettingsRecord = Record<string, unknown> & {
	general: Record<string, unknown>;
	images: Record<string, unknown>;
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
