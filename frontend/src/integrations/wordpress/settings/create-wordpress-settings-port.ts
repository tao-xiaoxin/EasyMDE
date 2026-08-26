import { parseSettingsCenterSettings } from "../../../contracts/bootstrap/settings-center-bootstrap";
import type {
	SettingsCenterApi,
	SettingsCenterSettings,
} from "../../../contracts/settings-center-settings";
import { canonicalizeKeyboardShortcut } from "../../../shared/keyboard/keyboard-shortcut";

export type SettingsShortcutConflict = Readonly<{
	platform: "windows" | "mac";
	shortcut: string;
	bindings: ReadonlyArray<
		Readonly<{
			id: string;
			label: string;
			editable: boolean;
		}>
	>;
}>;

export class SettingsShortcutConflictError extends Error {
	readonly conflict: SettingsShortcutConflict;

	constructor(conflict: SettingsShortcutConflict) {
		super("easymde_settings_shortcut_conflict");
		this.name = "SettingsShortcutConflictError";
		this.conflict = conflict;
	}
}

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

async function readRestErrorPayload(
	response: Response,
	signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		if (signal.aborted || isAbortError(error)) throw error;
		return null;
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	return payload as Record<string, unknown>;
}

function parseShortcutConflict(
	value: unknown,
): SettingsShortcutConflict | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const detail = value as Record<string, unknown>;
	if (
		("windows" !== detail.platform && "mac" !== detail.platform) ||
		typeof detail.shortcut !== "string" ||
		!Array.isArray(detail.bindings) ||
		detail.bindings.length < 2
	) {
		return null;
	}
	const keyboardPlatform = "mac" === detail.platform ? "mac" : "win";
	if (
		!detail.shortcut ||
		canonicalizeKeyboardShortcut(detail.shortcut, keyboardPlatform) !==
			detail.shortcut
	) {
		return null;
	}
	const bindings: Array<{
		id: string;
		label: string;
		editable: boolean;
	}> = [];
	const bindingIds = new Set<string>();
	for (const bindingValue of detail.bindings) {
		if (
			!bindingValue ||
			typeof bindingValue !== "object" ||
			Array.isArray(bindingValue)
		) {
			return null;
		}
		const binding = bindingValue as Record<string, unknown>;
		if (
			typeof binding.id !== "string" ||
			!binding.id ||
			bindingIds.has(binding.id) ||
			typeof binding.label !== "string" ||
			!binding.label ||
			typeof binding.editable !== "boolean"
		) {
			return null;
		}
		bindingIds.add(binding.id);
		bindings.push({
			id: binding.id,
			label: binding.label,
			editable: binding.editable,
		});
	}
	return {
		platform: detail.platform,
		shortcut: detail.shortcut,
		bindings,
	};
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
		if ("save" === errorPrefix) {
			const errorPayload = await readRestErrorPayload(response, signal);
			if (errorPayload?.code === "easymde_settings_shortcut_conflict") {
				const conflict = parseShortcutConflict(errorPayload.data);
				if (!conflict) {
					throw new Error("settings-center-save-response-invalid");
				}
				throw new SettingsShortcutConflictError(conflict);
			}
			if (response.status === 409) {
				throw new Error("settings-center-save-conflict");
			}
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
