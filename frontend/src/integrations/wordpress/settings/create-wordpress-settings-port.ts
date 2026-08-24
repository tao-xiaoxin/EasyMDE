import { parseSettingsCenterSettings } from "../../../contracts/bootstrap/settings-center-bootstrap";
import type {
	SettingsCenterApi,
	SettingsCenterSettings,
} from "../../../contracts/settings-center-settings";

export type SettingsCenterSettingsPort = Readonly<{
	get(signal: AbortSignal): Promise<SettingsCenterSettingsResult>;
	save(
		settings: SettingsCenterSettings,
		signal: AbortSignal,
		options?: Readonly<{ resetSecrets?: boolean }>,
	): Promise<SettingsCenterSettingsResult>;
}>;

export type SettingsCredentialStatus = Readonly<{
	primaryConfigured: boolean;
	backupConfigured: boolean;
}>;

export type SettingsCenterSettingsResult = Readonly<{
	settings: SettingsCenterSettings;
	credentialStatus: SettingsCredentialStatus;
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
): Promise<SettingsCenterSettingsResult> {
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

	const responsePayload = payload as Record<string, unknown>;
	const credentialStatus = responsePayload.credentialStatus;
	if (
		!credentialStatus ||
		typeof credentialStatus !== "object" ||
		Array.isArray(credentialStatus)
	) {
		throw new Error(`settings-center-${errorPrefix}-response-invalid`);
	}
	const status = credentialStatus as Record<string, unknown>;
	if (
		Object.keys(status).length !== 2 ||
		typeof status.primaryConfigured !== "boolean" ||
		typeof status.backupConfigured !== "boolean"
	) {
		throw new Error(`settings-center-${errorPrefix}-response-invalid`);
	}

	return {
		settings: parseResponseSettings(
			responsePayload.settings,
			`settings-center-${errorPrefix}-response-invalid`,
		),
		credentialStatus: {
			primaryConfigured: status.primaryConfigured,
			backupConfigured: status.backupConfigured,
		},
	};
}

export function createWordPressSettingsPort(
	api: Pick<SettingsCenterApi, "actionNonce" | "nonce" | "settingsUrl">,
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
