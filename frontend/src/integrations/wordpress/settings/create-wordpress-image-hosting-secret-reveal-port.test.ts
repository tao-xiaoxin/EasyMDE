import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsCenterApi } from "../../../contracts/settings-center-settings";
import { createWordPressImageHostingSecretRevealPort } from "./create-wordpress-image-hosting-secret-reveal-port";

const api: SettingsCenterApi = {
	actionNonce: "settings-action",
	imageHostingVerificationActionNonce: "image-hosting-action",
	imageHostingVerificationUrl: "/wp-json/easymde/v1/image-hosting/verification",
	imageHostingSecretRevealActionNonce: "image-hosting-secret-reveal-action",
	imageHostingSecretRevealUrl: "/wp-json/easymde/v1/image-hosting/secret",
	nonce: "wp-rest",
	settingsUrl: "/wp-json/easymde/v1/settings",
};

beforeEach(() => {
	Object.defineProperty(window, "location", {
		configurable: true,
		value: new URL("https://example.test/wp-admin/admin.php?page=easymde"),
	});
});

describe("createWordPressImageHostingSecretRevealPort", () => {
	it("reveals one configured secret through the dedicated protected boundary", async () => {
		const fetchLike = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						field: "accessKey",
						target: "primary",
						value: "synthetic-revealed-value",
					}),
					{ status: 200 },
				),
		);
		const port = createWordPressImageHostingSecretRevealPort(api, fetchLike);

		await expect(
			port.revealSecret({
				field: "accessKey",
				revision: 7,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).resolves.toEqual({ value: "synthetic-revealed-value" });
		const [url, init] = fetchLike.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://example.test/wp-json/easymde/v1/image-hosting/secret",
		);
		expect(JSON.parse(String(init?.body))).toEqual({
			field: "accessKey",
			revision: 7,
			target: "primary",
		});
		expect(init?.headers).toMatchObject({
			"X-EasyMDE-Image-Hosting-Secret-Nonce":
				"image-hosting-secret-reveal-action",
			"X-WP-Nonce": "wp-rest",
		});
	});

	it.each([
		{ field: "secretKey", target: "primary", value: "synthetic" },
		{ field: "accessKey", target: "backup", value: "synthetic", extra: true },
		{ field: "accessKey", target: "primary", value: "" },
		{ field: "accessKey", target: "primary", value: "界".repeat(86) },
	])("rejects a mismatched, extra, or empty response", async (payload) => {
		const port = createWordPressImageHostingSecretRevealPort(
			api,
			async () => new Response(JSON.stringify(payload), { status: 200 }),
		);
		await expect(
			port.revealSecret({
				field: "accessKey",
				revision: 7,
				signal: new AbortController().signal,
				target: "primary",
			}),
		).rejects.toThrow("settings-center-image-secret-response-invalid");
	});

	it("rejects a cross-origin reveal endpoint before requesting", () => {
		expect(() =>
			createWordPressImageHostingSecretRevealPort({
				...api,
				imageHostingSecretRevealUrl: "https://provider.example.test/secret",
			}),
		).toThrow("settings-center-image-secret-transport-invalid");
	});
});
