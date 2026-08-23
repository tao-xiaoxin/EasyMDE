import type { SettingsCenterApi } from "../../../contracts/settings-center-settings";
import type {
	ImageConnectionTarget,
	ImageConnectionTestPort,
} from "../../../contracts/ports/image-hosting-connection-port";

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

function parseConnectionResult(
	value: unknown,
	target: ImageConnectionTarget,
): Readonly<{ testedAt: string }> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("settings-center-image-connection-response-invalid");
	}
	const result = value as Record<string, unknown>;
	if (
		result.target !== target ||
		result.status !== "connected" ||
		typeof result.service !== "string" ||
		!result.service ||
		typeof result.testedAt !== "string" ||
		!result.testedAt ||
		Number.isNaN(Date.parse(result.testedAt))
	) {
		throw new Error("settings-center-image-connection-response-invalid");
	}
	return { testedAt: result.testedAt };
}

export function createWordPressImageHostingConnectionPort(
	api: SettingsCenterApi,
	fetchLike: FetchLike = window.fetch.bind(window),
): ImageConnectionTestPort {
	let endpoint: URL;
	try {
		endpoint = new URL(api.imageHostingConnectionUrl, window.location.href);
	} catch {
		throw new Error("settings-center-image-connection-url-invalid");
	}
	if (
		endpoint.origin !== window.location.origin ||
		!api.nonce ||
		!api.imageHostingActionNonce
	) {
		throw new Error("settings-center-image-connection-transport-invalid");
	}

	return {
		async testConnection({ target, signal }) {
			let response: Response;
			try {
				response = await fetchLike(endpoint, {
					body: JSON.stringify({ target }),
					credentials: "same-origin",
					headers: {
						"Content-Type": "application/json",
						"X-EasyMDE-Image-Hosting-Nonce":
							api.imageHostingActionNonce,
						"X-WP-Nonce": api.nonce,
					},
					method: "POST",
					signal,
				});
			} catch (error) {
				if (signal.aborted || isAbortError(error)) throw error;
				throw new Error("settings-center-image-connection-network-failed");
			}
			if (!response.ok) {
				throw new Error("settings-center-image-connection-rejected");
			}
			let payload: unknown;
			try {
				payload = await response.json();
			} catch (error) {
				if (signal.aborted || isAbortError(error)) throw error;
				throw new Error("settings-center-image-connection-response-invalid");
			}
			if (signal.aborted) {
				throw signal.reason ?? new Error("settings-center-image-connection-aborted");
			}
			return parseConnectionResult(payload, target);
		},
	};
}
