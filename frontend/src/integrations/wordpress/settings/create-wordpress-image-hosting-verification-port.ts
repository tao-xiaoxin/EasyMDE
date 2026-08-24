import type {
	ImageHostingTarget,
	ImageUploadVerificationPort,
} from "../../../contracts/ports/image-hosting-verification-port";
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

function hasExactKeys(
	value: Record<string, unknown>,
	keys: ReadonlyArray<string>,
): boolean {
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === keys.length &&
		keys.every((key) => actualKeys.includes(key))
	);
}

function isValidObjectKey(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		!value ||
		new TextEncoder().encode(value).length > 1024 ||
		value.startsWith("/") ||
		value.includes("\\") ||
		!/^[\p{L}\p{N}._/-]+$/u.test(value)
	) {
		return false;
	}

	return value
		.split("/")
		.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function encodedObjectKey(value: string): string {
	return value.split("/").map(encodeURIComponent).join("/");
}

function hasExplicitUrlPort(value: string): boolean {
	const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0] ?? "";
	if (authority.startsWith("[")) {
		return authority.slice(authority.indexOf("]") + 1).startsWith(":");
	}
	return authority.includes(":");
}

function parseUploadVerificationResult(
	value: unknown,
	target: ImageHostingTarget,
	viewingDomain: string,
): Readonly<{ path: string; url: string }> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("settings-center-image-verification-response-invalid");
	}
	const result = value as Record<string, unknown>;
	if (
		!hasExactKeys(result, ["target", "status", "path", "url"]) ||
		result.target !== target ||
		result.status !== "uploaded" ||
		!isValidObjectKey(result.path) ||
		typeof result.url !== "string" ||
		!result.url ||
		new TextEncoder().encode(result.url).length > 2048
	) {
		throw new Error("settings-center-image-verification-response-invalid");
	}
	let url: URL;
	try {
		url = new URL(result.url);
	} catch {
		throw new Error("settings-center-image-verification-response-invalid");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username !== "" ||
		url.password !== "" ||
		url.port !== "" ||
		hasExplicitUrlPort(result.url) ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error("settings-center-image-verification-response-invalid");
	}
	let expectedUrl: URL;
	try {
		expectedUrl = new URL(
			encodedObjectKey(result.path),
			`${viewingDomain.replace(/\/+$/, "")}/`,
		);
	} catch {
		throw new Error("settings-center-image-verification-response-invalid");
	}
	if (url.href !== expectedUrl.href) {
		throw new Error("settings-center-image-verification-response-invalid");
	}
	return { path: result.path as string, url: url.href };
}

export function createWordPressImageHostingVerificationPort(
	api: SettingsCenterApi,
	fetchLike: FetchLike = window.fetch.bind(window),
): ImageUploadVerificationPort {
	let endpoint: URL;
	try {
		endpoint = new URL(api.imageHostingVerificationUrl, window.location.href);
	} catch {
		throw new Error("settings-center-image-verification-url-invalid");
	}
	if (
		endpoint.origin !== window.location.origin ||
		!api.nonce ||
		!api.imageHostingVerificationActionNonce
	) {
		throw new Error("settings-center-image-verification-transport-invalid");
	}

	return {
		async verifyUpload({ target, settings, revision, signal }) {
			let response: Response;
			try {
				response = await fetchLike(endpoint, {
					body: JSON.stringify({ target, revision, settings }),
					credentials: "same-origin",
					headers: {
						"Content-Type": "application/json",
						"X-EasyMDE-Image-Hosting-Nonce":
							api.imageHostingVerificationActionNonce,
						"X-WP-Nonce": api.nonce,
					},
					method: "POST",
					signal,
				});
			} catch (error) {
				if (signal.aborted || isAbortError(error)) throw error;
				throw new Error("settings-center-image-verification-network-failed");
			}
			if (!response.ok) {
				throw new Error("settings-center-image-verification-rejected");
			}
			let payload: unknown;
			try {
				payload = await response.json();
			} catch (error) {
				if (signal.aborted || isAbortError(error)) throw error;
				throw new Error("settings-center-image-verification-response-invalid");
			}
			if (signal.aborted) {
				throw (
					signal.reason ??
					new Error("settings-center-image-verification-aborted")
				);
			}
			return parseUploadVerificationResult(
				payload,
				target,
				settings.domain,
			);
		},
	};
}
