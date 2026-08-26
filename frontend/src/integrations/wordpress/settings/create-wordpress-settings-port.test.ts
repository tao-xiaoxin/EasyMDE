import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_CENTER_TEST_SETTINGS } from "../../../test/settings-center-settings-fixture";
import {
	createWordPressSettingsPort,
	SettingsShortcutConflictError,
} from "./create-wordpress-settings-port";

const CREDENTIAL_STATUS = {
	primaryConfigured: true,
	backupConfigured: false,
} as const;

beforeEach(() => {
	vi.stubGlobal("window", {
		location: new URL("https://example.test/wp-admin/options.php"),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});
describe("createWordPressSettingsPort", () => {
	it("posts settings through the same-origin REST contract and returns the saved state", async () => {
		const fetchLike = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				expect(init?.method).toBe("POST");
				expect(init?.credentials).toBe("same-origin");
				expect(new Headers(init?.headers).get("X-WP-Nonce")).toBe("test-nonce");
				expect(new Headers(init?.headers).get("X-EasyMDE-Settings-Nonce")).toBe(
					"test-action-nonce",
				);
				expect(JSON.parse(String(init?.body))).toEqual({
					settings: SETTINGS_CENTER_TEST_SETTINGS,
				});
				return {
					ok: true,
					json: async () => ({
						settings: SETTINGS_CENTER_TEST_SETTINGS,
						credentialStatus: CREDENTIAL_STATUS,
					}),
				} as Response;
			},
		);
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			fetchLike,
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal),
		).resolves.toEqual({
			settings: SETTINGS_CENTER_TEST_SETTINGS,
			credentialStatus: CREDENTIAL_STATUS,
		});
		expect(fetchLike).toHaveBeenCalledOnce();
	});

	it("loads settings through the same-origin REST contract", async () => {
		const fetchLike = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				expect(init?.method).toBe("GET");
				expect(init?.credentials).toBe("same-origin");
				expect(new Headers(init?.headers).get("X-WP-Nonce")).toBe("test-nonce");
				expect(new Headers(init?.headers).get("X-EasyMDE-Settings-Nonce")).toBe(
					"test-action-nonce",
				);
				return {
					ok: true,
					json: async () => ({
						settings: SETTINGS_CENTER_TEST_SETTINGS,
						credentialStatus: CREDENTIAL_STATUS,
					}),
				} as Response;
			},
		);
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			fetchLike,
		);

		await expect(port.get(new AbortController().signal)).resolves.toEqual({
			settings: SETTINGS_CENTER_TEST_SETTINGS,
			credentialStatus: CREDENTIAL_STATUS,
		});
		expect(fetchLike).toHaveBeenCalledOnce();
	});

	it("preserves abort errors while loading settings", async () => {
		const abort = new DOMException("aborted", "AbortError");
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(async () => {
				throw abort;
			}),
		);

		await expect(port.get(new AbortController().signal)).rejects.toBe(abort);
	});
	it("sends an explicit secret reset request only when requested", async () => {
		const fetchLike = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				expect(JSON.parse(String(init?.body))).toEqual({
					settings: SETTINGS_CENTER_TEST_SETTINGS,
					resetSecrets: true,
				});
				return {
					ok: true,
					json: async () => ({
						settings: SETTINGS_CENTER_TEST_SETTINGS,
						credentialStatus: CREDENTIAL_STATUS,
					}),
				} as Response;
			},
		);
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			fetchLike,
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal, {
				resetSecrets: true,
			}),
		).resolves.toEqual({
			settings: SETTINGS_CENTER_TEST_SETTINGS,
			credentialStatus: CREDENTIAL_STATUS,
		});
	});

	it("rejects cross-origin endpoints before making a request", () => {
		expect(() =>
			createWordPressSettingsPort(
				{
					settingsUrl:
						"https://settings.example.test/wp-json/easymde/v1/settings",
					actionNonce: "test-action-nonce",
					nonce: "test-nonce",
				},
				vi.fn(),
			),
		).toThrow("settings-center-api-transport-invalid");
	});
	it("allows same-origin HTTP endpoints in the documented local environment", async () => {
		vi.stubGlobal("window", {
			location: new URL("http://example.test/wp-admin/options.php"),
		});
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: true,
						json: async () => ({
							settings: SETTINGS_CENTER_TEST_SETTINGS,
							credentialStatus: CREDENTIAL_STATUS,
						}),
					}) as Response,
			),
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal),
		).resolves.toEqual({
			settings: SETTINGS_CENTER_TEST_SETTINGS,
			credentialStatus: CREDENTIAL_STATUS,
		});
	});

	it("reports a failed server response instead of claiming persistence", async () => {
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: false,
						json: async () => ({ code: "easymde_settings_invalid_payload" }),
					}) as Response,
			),
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal),
		).rejects.toThrow("settings-center-save-rejected");
	});

	it("preserves validated shortcut conflict details returned by WordPress", async () => {
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: false,
						status: 409,
						json: async () => ({
							code: "easymde_settings_shortcut_conflict",
							data: {
								bindings: [
									{ editable: true, id: "bold", label: "Bold" },
									{ editable: false, id: "extension", label: "Extension" },
								],
								platform: "windows",
								shortcut: "Ctrl+B",
							},
						}),
					}) as Response,
			),
		);

		const error = await port
			.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal)
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(SettingsShortcutConflictError);
		expect(error).toMatchObject({
			conflict: {
				bindings: [
					{ editable: true, id: "bold", label: "Bold" },
					{ editable: false, id: "extension", label: "Extension" },
				],
				platform: "windows",
				shortcut: "Ctrl+B",
			},
			message: "easymde_settings_shortcut_conflict",
		});
	});

	it.each([
		["missing details", undefined],
		[
			"invalid platform",
			{
				bindings: [
					{ editable: true, id: "bold", label: "Bold" },
					{ editable: true, id: "italic", label: "Italic" },
				],
				platform: "linux",
				shortcut: "Ctrl+B",
			},
		],
		[
			"non-canonical shortcut",
			{
				bindings: [
					{ editable: true, id: "bold", label: "Bold" },
					{ editable: true, id: "italic", label: "Italic" },
				],
				platform: "windows",
				shortcut: "Shift+Ctrl+B",
			},
		],
		[
			"fewer than two bindings",
			{
				bindings: [{ editable: true, id: "bold", label: "Bold" }],
				platform: "windows",
				shortcut: "Ctrl+B",
			},
		],
		[
			"malformed binding",
			{
				bindings: [
					{ editable: true, id: "bold", label: "Bold" },
					{ editable: "false", id: "extension", label: "Extension" },
				],
				platform: "windows",
				shortcut: "Ctrl+B",
			},
		],
	])("rejects shortcut conflict responses with %s", async (_name, data) => {
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: false,
						status: 409,
						json: async () => ({
							code: "easymde_settings_shortcut_conflict",
							...(undefined === data ? {} : { data }),
						}),
					}) as Response,
			),
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal),
		).rejects.toThrow("settings-center-save-response-invalid");
	});

	it("returns a distinct conflict when the server rejects a stale revision", async () => {
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: false,
						status: 409,
						json: async () => ({ code: "easymde_settings_conflict" }),
					}) as Response,
			),
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal),
		).rejects.toThrow("settings-center-save-conflict");
	});

	it("rejects a malformed saved settings payload", async () => {
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: true,
						status: 200,
						json: async () => ({ settings: { revision: 1 } }),
					}) as Response,
			),
		);

		await expect(
			port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal),
		).rejects.toThrow("settings-center-save-response-invalid");
	});

	it("rejects a response without authoritative credential status", async () => {
		const port = createWordPressSettingsPort(
			{
				settingsUrl: "/wp-json/easymde/v1/settings",
				actionNonce: "test-action-nonce",
				nonce: "test-nonce",
			},
			vi.fn(
				async () =>
					({
						ok: true,
						status: 200,
						json: async () => ({ settings: SETTINGS_CENTER_TEST_SETTINGS }),
					}) as Response,
			),
		);

		await expect(port.get(new AbortController().signal)).rejects.toThrow(
			"settings-center-get-response-invalid",
		);
	});
});
