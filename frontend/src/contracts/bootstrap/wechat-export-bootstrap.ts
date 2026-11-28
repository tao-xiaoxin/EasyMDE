import { localAssetUrl } from "./preview-enhancement-bootstrap";

export type WechatExportStrings = Readonly<{
	failed: string;
	failedWithUploads: string;
	success: string;
	unsupported: string;
}>;

export type WechatExportBootstrap = Readonly<{
	enabled: boolean;
	pngConversionEnabled: boolean;
	strings: WechatExportStrings;
	wechatMathAtlasContentVersion: string;
	wechatMathAtlasUrl: string;
}>;

function stringValue(value: unknown): string {
	if ("string" !== typeof value || "" === value.trim() || value.length > 512) {
		throw new Error("wechat-export-string-invalid");
	}
	return value;
}

function atlasContentVersionValue(value: unknown): string {
	if ("string" !== typeof value || !/^[a-f0-9]{16}$/.test(value)) {
		throw new Error("wechat-export-math-atlas-content-version-invalid");
	}
	return value;
}

function atlasUrlValue(
	value: unknown,
	assetBaseUrl: string,
	contentVersion: string,
): string {
	const url = new URL(
		localAssetUrl(value, assetBaseUrl, "wechat-export-math-atlas-url-invalid"),
	);
	const basePath = new URL(assetBaseUrl).pathname.replace(/\/$/, "");
	if (
		url.pathname !== `${basePath}/assets/math/easymde-katex-glyph-atlas.json` ||
		[...url.searchParams.keys()].some((key) => key !== "contentversion") ||
		url.searchParams.getAll("contentversion").length !== 1 ||
		url.searchParams.get("contentversion") !== contentVersion
	) {
		throw new Error("wechat-export-math-atlas-url-invalid");
	}
	return url.href;
}

export function parseWechatExportBootstrap(
	value: unknown,
	assetBaseUrl: unknown,
): WechatExportBootstrap {
	if (!value || "object" !== typeof value || Array.isArray(value)) {
		throw new Error("wechat-export-bootstrap-invalid");
	}
	const bootstrap = value as Record<string, unknown>;
	if (typeof assetBaseUrl !== "string" || "" === assetBaseUrl.trim()) {
		throw new Error("wechat-export-asset-base-url-invalid");
	}
	if (typeof bootstrap.enabled !== "boolean") {
		throw new Error("wechat-export-enabled-invalid");
	}
	if (typeof bootstrap.pngConversionEnabled !== "boolean") {
		throw new Error("wechat-export-png-conversion-invalid");
	}
	if (
		!bootstrap.strings ||
		"object" !== typeof bootstrap.strings ||
		Array.isArray(bootstrap.strings)
	) {
		throw new Error("wechat-export-strings-invalid");
	}
	const strings = bootstrap.strings as Record<string, unknown>;
	const wechatMathAtlasContentVersion = atlasContentVersionValue(
		bootstrap.wechatMathAtlasContentVersion,
	);
	return {
		enabled: bootstrap.enabled,
		pngConversionEnabled: bootstrap.pngConversionEnabled,
		strings: {
			failed: stringValue(strings.failed),
			failedWithUploads: stringValue(strings.failedWithUploads),
			success: stringValue(strings.success),
			unsupported: stringValue(strings.unsupported),
		},
		wechatMathAtlasContentVersion,
		wechatMathAtlasUrl: atlasUrlValue(
			bootstrap.wechatMathAtlasUrl,
			assetBaseUrl,
			wechatMathAtlasContentVersion,
		),
	};
}
