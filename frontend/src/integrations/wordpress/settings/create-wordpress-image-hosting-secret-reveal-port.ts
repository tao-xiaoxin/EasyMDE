import type { ImageHostingSecretRevealPort } from "../../../contracts/ports/image-hosting-secret-reveal-port";
import type { SettingsCenterApi } from "../../../contracts/settings-center-settings";

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

export function createWordPressImageHostingSecretRevealPort(
	api: SettingsCenterApi,
	fetchLike: FetchLike = window.fetch.bind(window),
): ImageHostingSecretRevealPort {
	let endpoint: URL;
	try {
		endpoint = new URL(api.imageHostingSecretRevealUrl, window.location.href);
	} catch {
		throw new Error("settings-center-image-secret-url-invalid");
	}
	if (
		endpoint.origin !== window.location.origin ||
		!api.nonce ||
		!api.imageHostingSecretRevealActionNonce
	) {
		throw new Error("settings-center-image-secret-transport-invalid");
	}

	return {
		async revealSecret({ target, field, revision, signal }) {
			let response: Response;
			try {
				response = await fetchLike(endpoint, {
					body: JSON.stringify({ target, field, revision }),
					credentials: "same-origin",
					headers: {
						"Content-Type": "application/json",
						"X-EasyMDE-Image-Hosting-Secret-Nonce":
							api.imageHostingSecretRevealActionNonce,
						"X-WP-Nonce": api.nonce,
					},
					method: "POST",
					signal,
				});
			} catch (error) {
				if (signal.aborted || isAbortError(error)) throw error;
				throw new Error("settings-center-image-secret-network-failed");
			}
			if (!response.ok) {
				throw new Error("settings-center-image-secret-rejected");
			}
			let payload: unknown;
			try {
				payload = await response.json();
			} catch (error) {
				if (signal.aborted || isAbortError(error)) throw error;
				throw new Error("settings-center-image-secret-response-invalid");
			}
			if (signal.aborted) {
				throw (
					signal.reason ?? new Error("settings-center-image-secret-aborted")
				);
			}
			if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
				throw new Error("settings-center-image-secret-response-invalid");
			}
			const result = payload as Record<string, unknown>;
			const keys = Object.keys(result);
			if (
				keys.length !== 3 ||
				!["target", "field", "value"].every((key) => keys.includes(key)) ||
				result.target !== target ||
				result.field !== field ||
				typeof result.value !== "string" ||
				!result.value ||
				new TextEncoder().encode(result.value).length > 255
			) {
				throw new Error("settings-center-image-secret-response-invalid");
			}
			return { value: result.value };
		},
	};
}
