import { parseSettingsCenterSettings } from "../../../contracts/bootstrap/settings-center-bootstrap";
import type {
	SettingsCenterApi,
	SettingsCenterSettings,
} from "../../../contracts/settings-center-settings";

export type SettingsCenterSettingsPort = Readonly<{
	get(signal: AbortSignal): Promise<SettingsCenterSettings>;
	save(
		settings: SettingsCenterSettings,
		signal: AbortSignal,
		options?: Readonly<{ resetSecrets?: boolean }>,
	): Promise<SettingsCenterSettings>;
}>;

type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof Error && error.name === "AbortError") ||
		(typeof DOMException !== "undefined" &&
			error instanceof DOMException &&
			error.name === "AbortError")
	);
}

function parseResponseSettings(
	value: unknown,
	code: string,
): SettingsCenterSettings {
	try {
		return parseSettingsCenterSettings(value);
	} catch {
		throw new Error(code);
	}
}

async function requestSettings(
	endpoint: URL,
	actionNonce: string,
	nonce: string,
	fetchLike: FetchLike,
	signal: AbortSignal,
	init: RequestInit,
	errorPrefix: "get" | "save",
): Promise<SettingsCenterSettings> {
	let response: Response;
	try {
		response = await fetchLike(endpoint, {
			...init,
			credentials: "same-origin",
			headers: {
				...(init.headers ?? {}),
				"X-WP-Nonce": nonce,
				"X-EasyMDE-Settings-Nonce": actionNonce,
			},
			signal,
		});
	} catch (error) {
		if (signal.aborted || isAbortError(error)) throw error;
		throw new Error(`settings-center-${errorPrefix}-network-failed`);
	}

	if (!response.ok) {
		if ("save" === errorPrefix && response.status === 409) {
			throw new Error("settings-center-save-conflict");
		}
		throw new Error(`settings-center-${errorPrefix}-rejected`);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		if (signal.aborted || isAbortError(error)) throw error;
		throw new Error(`settings-center-${errorPrefix}-response-invalid`);
	}
	if (signal.aborted) {
		throw signal.reason ?? new Error(`settings-center-${errorPrefix}-aborted`);
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error(`settings-center-${errorPrefix}-response-invalid`);
	}

	return parseResponseSettings(
		(payload as Record<string, unknown>).settings,
		`settings-center-${errorPrefix}-response-invalid`,
	);
}

export function createWordPressSettingsPort(
	api: SettingsCenterApi,
	fetchLike: FetchLike = window.fetch.bind(window),
): SettingsCenterSettingsPort {
	let endpoint: URL;
	try {
		endpoint = new URL(api.settingsUrl, window.location.href);
	} catch {
		throw new Error("settings-center-api-url-invalid");
	}
	if (
		endpoint.origin !== window.location.origin ||
		!api.nonce ||
		!api.actionNonce
	) {
		throw new Error("settings-center-api-transport-invalid");
	}

	return {
		get(signal) {
			return requestSettings(
				endpoint,
				api.actionNonce,
				api.nonce,
				fetchLike,
				signal,
				{
					method: "GET",
				},
				"get",
			);
		},
		save(settings, signal, options) {
			const requestPayload = options?.resetSecrets
				? { settings, resetSecrets: true }
				: { settings };
			return requestSettings(
				endpoint,
				api.actionNonce,
				api.nonce,
				fetchLike,
				signal,
				{
					body: JSON.stringify(requestPayload),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
				"save",
			);
		},
	};
}
