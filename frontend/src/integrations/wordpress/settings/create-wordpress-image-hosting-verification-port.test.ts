import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsCenterApi } from "../../../contracts/settings-center-settings";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../../test/settings-center-settings-fixture";
import { createWordPressImageHostingVerificationPort } from "./create-wordpress-image-hosting-verification-port";

const api: SettingsCenterApi = {
	actionNonce: "settings-action",
	imageHostingVerificationActionNonce: "image-hosting-action",
	imageHostingVerificationUrl: "/wp-json/easymde/v1/image-hosting/verification",
	imageHostingSecretRevealActionNonce: "image-hosting-secret-reveal-action",
	imageHostingSecretRevealUrl: "/wp-json/easymde/v1/image-hosting/secret",
	nonce: "wp-rest",
	settingsUrl: "/wp-json/easymde/v1/settings",
};

const validationPath = "20260824/验证图标-900150983cd24fb0d6963f7d28e17f72.png";
const validationUrl =
	"https://images.example.test/20260824/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87-900150983cd24fb0d6963f7d28e17f72.png";
const verificationSettings = {
	...SETTINGS_CENTER_TEST_SETTINGS.images,
	domain: "https://images.example.test",
};

beforeEach(() => {
	Object.defineProperty(window, "location", {
		configurable: true,
		value: new URL("https://example.test/wp-admin/admin.php?page=easymde"),
	});
});

describe("createWordPressImageHostingVerificationPort", () => {
	it("posts the exact current image draft, target, and revision through the protected same-origin boundary", async () => {
		const fetchLike = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						path: validationPath,
						status: "uploaded",
						target: "primary",
						url: validationUrl,
					}),
					{ status: 200 },
				),
		);
		const port = createWordPressImageHostingVerificationPort(api, fetchLike);
		const controller = new AbortController();

		await expect(
			port.verifyUpload({
				settings: verificationSettings,
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: controller.signal,
				target: "primary",
			}),
		).resolves.toEqual({
			path: validationPath,
			url: validationUrl,
		});

		expect(fetchLike).toHaveBeenCalledTimes(1);
		const [url, init] = fetchLike.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://example.test/wp-json/easymde/v1/image-hosting/verification",
		);
		expect(JSON.parse(String(init?.body))).toEqual({
			target: "primary",
			revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
			settings: verificationSettings,
		});
		expect(init?.headers).toMatchObject({
			"X-EasyMDE-Image-Hosting-Nonce": "image-hosting-action",
			"X-WP-Nonce": "wp-rest",
		});
		expect(String(init?.body)).toContain("secretKey");
	});

	it("rejects a mismatched or malformed response", async () => {
		const port = createWordPressImageHostingVerificationPort(
			api,
			async () =>
				new Response(
					JSON.stringify({
						path: validationPath,
						status: "uploaded",
						target: "backup",
						url: validationUrl,
					}),
					{ status: 200 },
				),
		);

		await expect(
			port.verifyUpload({
				settings: verificationSettings,
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).rejects.toThrow("settings-center-image-verification-response-invalid");
	});

	it("uses the primary viewing domain for a successful backup verification upload", async () => {
		const backupSettings = {
			...verificationSettings,
			backupDomain: "https://backup.example.test",
		};
		const fetchLike = vi.fn(async () =>
			new Response(
				JSON.stringify({
					path: validationPath,
					status: "uploaded",
					target: "backup",
					url: validationUrl,
				}),
				{ status: 200 },
			),
		);
		const port = createWordPressImageHostingVerificationPort(api, fetchLike);

		await expect(
			port.verifyUpload({
				settings: backupSettings,
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: new AbortController().signal,
				target: "backup",
			}),
		).resolves.toEqual({ path: validationPath, url: validationUrl });

		const backupUrl = validationUrl.replace(
			"images.example.test",
			"backup.example.test",
		);
		const rejectingPort = createWordPressImageHostingVerificationPort(
			api,
			async () =>
				new Response(
					JSON.stringify({
						path: validationPath,
						status: "uploaded",
						target: "backup",
						url: backupUrl,
					}),
					{ status: 200 },
				),
		);
		await expect(
			rejectingPort.verifyUpload({
				settings: backupSettings,
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: new AbortController().signal,
				target: "backup",
			}),
		).rejects.toThrow("settings-center-image-verification-response-invalid");
	});

	it("accepts an authoritative HTTP verification URL from the exact HTTP primary viewing domain", async () => {
		const httpUrl = validationUrl.replace("https://", "http://");
		const port = createWordPressImageHostingVerificationPort(api, async () =>
			new Response(
				JSON.stringify({
					path: validationPath,
					status: "uploaded",
					target: "primary",
					url: httpUrl,
				}),
				{ status: 200 },
			),
		);

		await expect(
			port.verifyUpload({
				settings: { ...verificationSettings, domain: "http://images.example.test" },
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).resolves.toEqual({ path: validationPath, url: httpUrl });
	});

	it("rejects successful-looking responses with extra keys", async () => {
		const port = createWordPressImageHostingVerificationPort(
			api,
			async () =>
				new Response(
					JSON.stringify({
						path: validationPath,
						status: "uploaded",
						target: "primary",
						url: validationUrl,
						secretKey: "must-not-cross-boundary",
					}),
					{ status: 200 },
				),
		);

		await expect(
			port.verifyUpload({
				settings: verificationSettings,
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).rejects.toThrow("settings-center-image-verification-response-invalid");
	});

	it.each([
		["/20260824/image.png", validationUrl],
		["20260824/../image.png", validationUrl],
		["20260824/image%2Fname.png", validationUrl],
		["界".repeat(342), validationUrl],
		["20260824/\uD800.png", validationUrl],
		[validationPath, "https://images.example.test/20260824/different.png"],
		[
			validationPath,
			validationUrl.replace("images.example.test", "other.example.test"),
		],
		[validationPath, validationUrl.replace("%E9", "%25E9")],
		[validationPath, `https://user:pass@images.example.test/${validationPath}`],
		[validationPath, `https://images.example.test:8443/${validationPath}`],
		[validationPath, `https://images.example.test:443/${validationPath}`],
		[validationPath, `http://images.example.test:80/${validationPath}`],
		[validationPath, `${validationUrl}?token=value`],
		[validationPath, `${validationUrl}#fragment`],
		[validationPath, validationUrl.replace("https://", "ftp://")],
	])("rejects an unsafe verification result path or URL", async (path, url) => {
		const port = createWordPressImageHostingVerificationPort(
			api,
			async () =>
				new Response(
					JSON.stringify({ path, status: "uploaded", target: "primary", url }),
					{ status: 200 },
				),
		);
		await expect(
			port.verifyUpload({
				settings: verificationSettings,
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).rejects.toThrow("settings-center-image-verification-response-invalid");
	});

	it("rejects cross-origin endpoints before any request", () => {
		expect(() =>
			createWordPressImageHostingVerificationPort({
				...api,
				imageHostingVerificationUrl: "https://provider.example.test/probe",
			}),
		).toThrow("settings-center-image-verification-transport-invalid");
	});
});
