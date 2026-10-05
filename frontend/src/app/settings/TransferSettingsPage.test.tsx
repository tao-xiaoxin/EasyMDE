import { describe, expect, it } from "vitest";

import { readImportedSettings } from "./TransferSettingsPage";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../test/settings-center-settings-fixture";

function configurationFile(schemaVersion: number, settings: unknown): File {
	return new File(
		[JSON.stringify({ schemaVersion, settings })],
		"settings.json",
		{ type: "application/json" },
	);
}

describe("readImportedSettings", () => {
	it("losslessly splits a legacy complete object key for schema 1 through 10", async () => {
		const legacySettings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as {
			images: Record<string, unknown>;
		};
		delete legacySettings.images.storagePath;
		legacySettings.images.fileNameRule = "legacy/{year}/{month}/{md5}.{ext}";

		const imported = await readImportedSettings(
			configurationFile(10, legacySettings),
		);

		expect(imported.images.storagePath).toBe("legacy/{year}/{month}");
		expect(imported.images.fileNameRule).toBe("{md5}.{ext}");
	});

	it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const)(
		"rejects a leading separator in a schema %s legacy complete key before splitting",
		async (schemaVersion) => {
			const legacySettings = structuredClone(
				SETTINGS_CENTER_TEST_SETTINGS,
			) as unknown as {
				images: Record<string, unknown>;
			};
			delete legacySettings.images.storagePath;
			legacySettings.images.fileNameRule = "/{name}.{ext}";

			await expect(
				readImportedSettings(configurationFile(schemaVersion, legacySettings)),
			).rejects.toThrow("settings-center-images-fileNameRule-invalid");
		},
	);

	it("rejects a legacy complete key without an extension variable", async () => {
		const legacySettings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as {
			images: Record<string, unknown>;
		};
		delete legacySettings.images.storagePath;
		legacySettings.images.fileNameRule = "legacy/{year}/image";

		await expect(
			readImportedSettings(configurationFile(1, legacySettings)),
		).rejects.toThrow("settings-center-images-fileNameRule-invalid");
	});

	it("uses the same combined validation for legacy schema 10 imports", async () => {
		const atLimit = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as {
			images: Record<string, unknown>;
		};
		delete atLimit.images.storagePath;
		atLimit.images.fileNameRule = `${"a".repeat(154)}/{ext}`;

		const imported = await readImportedSettings(configurationFile(10, atLimit));
		expect(imported.images.storagePath).toBe("a".repeat(154));
		expect(imported.images.fileNameRule).toBe("{ext}");

		const overLimit = structuredClone(atLimit);
		(overLimit.images as Record<string, unknown>).fileNameRule =
			`${"a".repeat(155)}/{ext}`;
		await expect(
			readImportedSettings(configurationFile(10, overLimit)),
		).rejects.toThrow("settings-center-images-fileNameRule-invalid");

		const extensionInDirectory = structuredClone(atLimit);
		(extensionInDirectory.images as Record<string, unknown>).fileNameRule =
			"{ext}/image";
		const directoryExtension = await readImportedSettings(
			configurationFile(10, extensionInDirectory),
		);
		expect(directoryExtension.images.storagePath).toBe("{ext}");
		expect(directoryExtension.images.fileNameRule).toBe("image");
	});

	it("requires strict split fields in schema 11", async () => {
		const invalidSettings = structuredClone(
			SETTINGS_CENTER_TEST_SETTINGS,
		) as unknown as {
			images: Record<string, unknown>;
		};
		delete invalidSettings.images.storagePath;

		await expect(
			readImportedSettings(configurationFile(11, invalidSettings)),
		).rejects.toThrow("settings-center-images-storagePath-invalid");
	});

	it("accepts the canonical schema 11 split fields", async () => {
		const imported = await readImportedSettings(
			configurationFile(11, SETTINGS_CENTER_TEST_SETTINGS),
		);

		expect(imported.images.storagePath).toBe("{year}/{month}");
		expect(imported.images.fileNameRule).toBe("{md5}.{ext}");
	});
});
