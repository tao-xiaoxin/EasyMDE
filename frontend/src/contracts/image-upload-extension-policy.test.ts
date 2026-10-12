import { describe, expect, it } from "vitest";

import {
	DEFAULT_IMAGE_FILE_NAME_RULE,
	DEFAULT_IMAGE_UPLOAD_FORMATS,
	IMAGE_UPLOAD_EXTENSIONS,
	buildImageObjectKeyPreview,
	migrateLegacyImageUploadFormats,
	splitLegacyImageFileNameRule,
	type ImageUploadExtension,
} from "./settings-center-settings";
import { parseSettingsCenterSettings } from "./bootstrap/settings-center-bootstrap";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../test/settings-center-settings-fixture";

function canonicalSettings() {
	return {
		...SETTINGS_CENTER_TEST_SETTINGS,
		images: {
			...SETTINGS_CENTER_TEST_SETTINGS.images,
			fileNameRule: "{md5}",
			uploadFormats: {
				webp: true,
				png: true,
				jpg: true,
				jpeg: true,
				jfif: true,
				gif: true,
			},
		},
	};
}

describe("image upload extension policy", () => {
	it("uses the suffix-free stem and ordered six-extension defaults", () => {
		expect(DEFAULT_IMAGE_FILE_NAME_RULE).toBe("{md5}");
		expect(IMAGE_UPLOAD_EXTENSIONS).toEqual([
			"webp",
			"png",
			"jpg",
			"jpeg",
			"jfif",
			"gif",
		]);
		expect(DEFAULT_IMAGE_UPLOAD_FORMATS).toEqual({
			webp: true,
			png: true,
			jpg: true,
			jpeg: true,
			jfif: true,
			gif: true,
		});
	});

	it("parses only the canonical six-key format map and rejects ext placeholders", () => {
		const settings = canonicalSettings();
		expect(parseSettingsCenterSettings(settings).images.fileNameRule).toBe("{md5}");
		expect(Object.keys(parseSettingsCenterSettings(settings).images.uploadFormats)).toEqual(
			IMAGE_UPLOAD_EXTENSIONS,
		);

		const withExt = structuredClone(settings) as typeof settings;
		withExt.images.fileNameRule = "{md5}.{ext}";
		expect(() => parseSettingsCenterSettings(withExt)).toThrow(
			"settings-center-images-fileNameRule-invalid",
		);

		const legacyMap = structuredClone(settings) as unknown as {
			images: Record<string, unknown>;
		};
		legacyMap.images.uploadFormats = {
			jpg: true,
			png: true,
			webp: true,
			gif: true,
		};
		expect(() => parseSettingsCenterSettings(legacyMap)).toThrow(
			"settings-center-images-upload-formats-invalid",
		);
	});

	it("maps the legacy jpg setting to independent jpg, jpeg, and jfif aliases", () => {
		expect(
			migrateLegacyImageUploadFormats({
				jpg: false,
				png: true,
				webp: false,
				gif: true,
			}),
		).toEqual({
				webp: false,
				png: true,
				jpg: false,
				jpeg: false,
				jfif: false,
				gif: true,
			});
	});

	it("removes exactly one terminal legacy extension placeholder", () => {
		expect(
			splitLegacyImageFileNameRule("legacy/{year}/{month}/{md5}.{ext}"),
		).toEqual({ storagePath: "legacy/{year}/{month}", fileNameRule: "{md5}" });
	});

	it.each([
		"legacy/{ext}/{md5}",
		"legacy/{md5}{ext}",
		"legacy/{md5}.{ext}.{ext}",
		"legacy/.{ext}",
	])("rejects an unrepresentable legacy extension placeholder: %s", (value) => {
		expect(() => splitLegacyImageFileNameRule(value)).toThrow(
			"settings-center-images-fileNameRule-invalid",
		);
	});

	it("uses the first enabled extension for the deterministic preview", () => {
		expect(
			buildImageObjectKeyPreview(
				"{year}/{month}",
				"{md5}",
				DEFAULT_IMAGE_UPLOAD_FORMATS,
			),
		).toBe("2026/07/a8f4c2d1.webp");

		const formats: Record<ImageUploadExtension, boolean> = {
			webp: false,
			png: false,
			jpg: false,
			jpeg: true,
			jfif: true,
			gif: true,
		};
		expect(buildImageObjectKeyPreview("", "{md5}", formats)).toBe(
			"a8f4c2d1.jpeg",
		);
	});
});
