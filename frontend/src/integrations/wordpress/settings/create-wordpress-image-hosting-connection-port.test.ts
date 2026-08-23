import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsCenterApi } from "../../../contracts/settings-center-settings";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../../test/settings-center-settings-fixture";
import { createWordPressImageHostingConnectionPort } from "./create-wordpress-image-hosting-connection-port";

const api: SettingsCenterApi = {
	actionNonce: "settings-action",
	imageHostingActionNonce: "image-hosting-action",
	imageHostingConnectionUrl: "/wp-json/easymde/v1/image-hosting/connection",
	nonce: "wp-rest",
	settingsUrl: "/wp-json/easymde/v1/settings",
};

beforeEach(() => {
	Object.defineProperty(window, "location", {
		configurable: true,
		value: new URL("https://example.test/wp-admin/admin.php?page=easymde"),
	});
});

describe("createWordPressImageHostingConnectionPort", () => {
	it("posts only the target through the protected same-origin boundary", async () => {
		const fetchLike = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
				JSON.stringify({
					service: "cloudflare-r2",
					status: "connected",
					target: "primary",
					testedAt: "2026-08-23T08:00:00Z",
				}),
				{ status: 200 },
			),
		);
		const port = createWordPressImageHostingConnectionPort(api, fetchLike);
		const controller = new AbortController();

		await expect(
			port.testConnection({
				settings: SETTINGS_CENTER_TEST_SETTINGS.images,
				signal: controller.signal,
				target: "primary",
			}),
		).resolves.toEqual({ testedAt: "2026-08-23T08:00:00Z" });

		expect(fetchLike).toHaveBeenCalledTimes(1);
		const [url, init] = fetchLike.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://example.test/wp-json/easymde/v1/image-hosting/connection",
		);
		expect(init?.body).toBe(JSON.stringify({ target: "primary" }));
		expect(init?.headers).toMatchObject({
			"X-EasyMDE-Image-Hosting-Nonce": "image-hosting-action",
			"X-WP-Nonce": "wp-rest",
		});
		expect(String(init?.body)).not.toContain("secretKey");
	});

	it("rejects a mismatched or malformed response", async () => {
		const port = createWordPressImageHostingConnectionPort(
			api,
			async () =>
				new Response(
					JSON.stringify({
						service: "cloudflare-r2",
						status: "connected",
						target: "backup",
						testedAt: "not-a-date",
					}),
					{ status: 200 },
				),
		);

		await expect(
			port.testConnection({
				settings: SETTINGS_CENTER_TEST_SETTINGS.images,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).rejects.toThrow("settings-center-image-connection-response-invalid");
	});

	it("rejects cross-origin endpoints before any request", () => {
		expect(() =>
			createWordPressImageHostingConnectionPort({
				...api,
				imageHostingConnectionUrl: "https://provider.example.test/probe",
			}),
		).toThrow("settings-center-image-connection-transport-invalid");
	});
});
