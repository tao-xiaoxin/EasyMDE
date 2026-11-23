import { afterEach, beforeEach } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { SettingsCenterSettings } from "../../contracts/settings-center-settings";
import {
	SETTINGS_CENTER_DEFAULT_SETTINGS,
	SETTINGS_CENTER_TEST_SETTINGS,
} from "../../test/settings-center-settings-fixture";

export function bootstrap({
	configuredImageDomains = false,
	imageHostingEnabled = true,
}: {
	configuredImageDomains?: boolean;
	imageHostingEnabled?: boolean;
} = {}): SettingsCenterBootstrap {
	const settings = configuredImageDomains
		? {
				...SETTINGS_CENTER_TEST_SETTINGS,
				images: {
					...SETTINGS_CENTER_TEST_SETTINGS.images,
					domain: "https://img.example.test",
					backupDomain: "https://backup.example.test",
					imageHostingEnabled,
				},
			}
		: {
				...SETTINGS_CENTER_TEST_SETTINGS,
				images: {
					...SETTINGS_CENTER_TEST_SETTINGS.images,
					imageHostingEnabled,
				},
			};
	const defaultSettings: SettingsCenterSettings = {
		...SETTINGS_CENTER_DEFAULT_SETTINGS,
		images: {
			...SETTINGS_CENTER_DEFAULT_SETTINGS.images,
			imageHostingEnabled,
		},
	};
	return {
		schemaVersion: 4,
		closeUrl: "/wp-admin/options-general.php",
		uploadLimits: { systemMaxBytes: 5 * 1024 * 1024 },
		api: {
			settingsUrl: "/wp-json/easymde/v1/settings",
			actionNonce: "test-action-nonce",
			imageHostingVerificationActionNonce: "test-image-hosting-action-nonce",
			imageHostingVerificationUrl:
				"/wp-json/easymde/v1/image-hosting/verification",
			imageHostingSecretRevealActionNonce:
				"test-image-hosting-secret-reveal-action-nonce",
			imageHostingSecretRevealUrl: "/wp-json/easymde/v1/image-hosting/secret",
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
		reservedShortcuts: [],
		settings,
		defaultSettings,
		strings: {
			...Object.fromEntries(
				SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
			),
			editPrompt: "editPrompt %s",
			duplicatePrompt: "duplicatePrompt %s",
			deletePrompt: "deletePrompt %s",
			transferFileSelectedNotice: "transferFileSelectedNotice %s",
			recordShortcut: "Record %s shortcut",
			clearShortcut: "Clear %s shortcut",
			shortcutConflictInline: "Conflicts with %s.",
		} as unknown as SettingsCenterBootstrap["strings"],
	};
}

export function installSettingsCenterLocationLifecycle(): void {
	let originalLocation: Location;

	beforeEach(() => {
		originalLocation = window.location;
		Object.defineProperty(window, "location", {
			configurable: true,
			value: new URL("https://example.test/wp-admin/options.php"),
		});
	});

	afterEach(() => {
		Object.defineProperty(window, "location", {
			configurable: true,
			value: originalLocation,
		});
	});
}
