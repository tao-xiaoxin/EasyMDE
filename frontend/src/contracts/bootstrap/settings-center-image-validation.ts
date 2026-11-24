import { utf8ByteLength } from "../../shared/utf8-byte-length";

const IMAGE_FILE_NAME_RULE_VARIABLES = new Set([
	"year",
	"month",
	"day",
	"date",
	"time",
	"post_id",
	"md5",
	"uuid",
	"name",
]);

const SUPPORTED_IMAGE_EXTENSION_SUFFIX = /\.(?:webp|png|jpg|jpeg|jfif|gif)$/i;

const LEGACY_IMAGE_FILE_NAME_RULE_VARIABLES = new Set([
	...IMAGE_FILE_NAME_RULE_VARIABLES,
	"ext",
]);

function hasExplicitUrlPort(value: string): boolean {
	const authority =
		value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0] ?? "";
	if (authority.startsWith("[")) {
		return authority.slice(authority.indexOf("]") + 1).startsWith(":");
	}
	return authority.includes(":");
}

export function assertSettingsDomain(value: unknown, code: string): void {
	if (value === "") return;
	if (typeof value !== "string") throw new Error(code);
	try {
		const url = new URL(value);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username ||
			url.password ||
			url.port ||
			hasExplicitUrlPort(value) ||
			url.search ||
			url.hash ||
			(url.pathname !== "" && url.pathname !== "/")
		) {
			throw new Error(code);
		}
	} catch {
		throw new Error(code);
	}
}

function assertR2Endpoint(value: unknown, code: string): void {
	if (value === "") return;
	if (
		typeof value !== "string" ||
		!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(
			value,
		)
	) {
		throw new Error(code);
	}
}

function assertOssEndpoint(value: unknown, code: string): void {
	if (value === "") return;
	if (
		typeof value !== "string" ||
		!/^https:\/\/oss-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.aliyuncs\.com$/.test(
			value,
		)
	) {
		throw new Error(code);
	}
}

function assertCosEndpoint(value: unknown, code: string): void {
	if (value === "") return;
	if (
		typeof value !== "string" ||
		!/^https:\/\/cos\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myqcloud\.com$/.test(
			value,
		)
	) {
		throw new Error(code);
	}
}

export function assertProviderSpecificFields(
	provider: unknown,
	endpoint: unknown,
	prefix: "" | "backup",
): void {
	const endpointKey = prefix ? "backupEndpoint" : "endpoint";
	const endpointCode = `settings-center-images-${endpointKey}-invalid`;
	if (provider === "cloudflare-r2") {
		assertR2Endpoint(endpoint, endpointCode);
		return;
	}
	if (provider === "aliyun-oss") {
		assertOssEndpoint(endpoint, endpointCode);
		return;
	}
	if (provider === "tencent-cos") {
		assertCosEndpoint(endpoint, endpointCode);
		return;
	}
	if (endpoint !== "") throw new Error(endpointCode);
}

export function assertImageStoragePath(value: unknown): void {
	if (typeof value !== "string" || value.length > 160) {
		throw new Error("settings-center-images-storagePath-invalid");
	}
	if (value === "") return;

	const variables = [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
		(match) => match[1] ?? "",
	);
	const literal = value.replace(/\{[A-Za-z0-9_]+\}/g, "");
	const hasControlCharacter = [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;

		return codePoint < 32 || codePoint === 127;
	});
	if (
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.split("/").some((segment) => segment === ".") ||
		value.includes("\\") ||
		value.includes("..") ||
		value.includes("//") ||
		hasControlCharacter ||
		value.includes("?") ||
		value.includes("#") ||
		variables.some(
			(variable) => !IMAGE_FILE_NAME_RULE_VARIABLES.has(variable),
		) ||
		!/^[A-Za-z0-9._/-]*$/.test(literal) ||
		literal.includes("{") ||
		literal.includes("}")
	) {
		throw new Error("settings-center-images-storagePath-invalid");
	}
}

export function assertImageFileNameRule(value: unknown): void {
	if (typeof value !== "string" || value.length === 0 || value.length > 160) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}

	const variables = [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
		(match) => match[1] ?? "",
	);
	const literal = value.replace(/\{[A-Za-z0-9_]+\}/g, "");
	const hasControlCharacter = [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;

		return codePoint < 32 || codePoint === 127;
	});
	if (
		value.includes("/") ||
		value.includes("\\") ||
		value.includes("..") ||
		value.includes("//") ||
		hasControlCharacter ||
		value.includes("?") ||
		value.includes("#") ||
		SUPPORTED_IMAGE_EXTENSION_SUFFIX.test(value) ||
		variables.some(
			(variable) => !IMAGE_FILE_NAME_RULE_VARIABLES.has(variable),
		) ||
		!/^[A-Za-z0-9._/-]*$/.test(literal) ||
		literal.includes("{") ||
		literal.includes("}")
	) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
}

function assertImageObjectKeyTemplate(value: unknown): void {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
	if (utf8ByteLength(value) > 160) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}

	const variables = [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
		(match) => match[1] ?? "",
	);
	const literal = value.replace(/\{[A-Za-z0-9_]+\}/g, "");
	const hasControlCharacter = [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;

		return codePoint < 32 || codePoint === 127;
	});
	if (
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.split("/").some((segment) => segment === ".") ||
		value.includes("\\") ||
		value.includes("..") ||
		value.includes("//") ||
		hasControlCharacter ||
		value.includes("?") ||
		value.includes("#") ||
		!value.endsWith(".{ext}") ||
		value.split("{ext}").length - 1 !== 1 ||
		value.slice(value.lastIndexOf("/") + 1, -6) === "" ||
		variables.some(
			(variable) => !LEGACY_IMAGE_FILE_NAME_RULE_VARIABLES.has(variable),
		) ||
		!/^[A-Za-z0-9._/-]*$/.test(literal) ||
		literal.includes("{") ||
		literal.includes("}")
	) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
}

export function assertLegacyImageObjectKeyTemplate(value: unknown): void {
	assertImageObjectKeyTemplate(value);
}

export function assertCombinedImageObjectKeyTemplate(
	storagePath: unknown,
	fileNameRule: unknown,
): void {
	if (typeof storagePath !== "string" || typeof fileNameRule !== "string") {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
	const combined =
		storagePath === "" ? fileNameRule : `${storagePath}/${fileNameRule}`;
	if (utf8ByteLength(`${combined}.webp`) > 160) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
	const variables = [...combined.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
		(match) => match[1] ?? "",
	);
	const literal = combined.replace(/\{[A-Za-z0-9_]+\}/g, "");
	const hasControlCharacter = [...combined].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});
	if (
		combined.startsWith("/") ||
		combined.endsWith("/") ||
		combined.split("/").some((segment) => segment === "." || segment === "..") ||
		combined.includes("\\") ||
		combined.includes("//") ||
		combined.includes("..") ||
		hasControlCharacter ||
		combined.includes("?") ||
		combined.includes("#") ||
		variables.some((variable) => !IMAGE_FILE_NAME_RULE_VARIABLES.has(variable)) ||
		!/^[A-Za-z0-9._/-]*$/.test(literal) ||
		literal.includes("{") ||
		literal.includes("}")
	) {
		throw new Error("settings-center-images-fileNameRule-invalid");
	}
}
