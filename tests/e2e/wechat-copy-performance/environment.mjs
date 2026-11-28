import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalMarkdownFixture } from '../wechat-canonical-fixture.mjs';

export const repositoryRoot = resolve(new URL("../../..", import.meta.url).pathname);
// The WeChat copy performance profile is verified against the dedicated local
// WordPress service, and the expected page origin is owned by the configured
// Playwright baseURL (EASYMDE_E2E_BASE_URL) rather than pinned to a literal
// port here: the scenarios derive it with expectedOriginFromBaseURL() from
// ../wechat-wordpress-fixture.mjs, so the login guard, the granted clipboard
// origin, and the candidate asset route all compare against the same origin the
// browser actually navigates to.
export const wpPath = process.env.EASYMDE_E2E_WP_PATH;
export const wpCli = process.env.EASYMDE_E2E_WP_CLI || "wp";
export const {
	length: canonicalMarkdownLength,
	markdown: canonicalMarkdown,
	sha256: canonicalMarkdownSha256,
} = canonicalMarkdownFixture(
	repositoryRoot,
	"wechat-copy-performance-canonical-markdown-mismatch",
);
export const canonicalImage = readFileSync(
	join(repositoryRoot, "docs/assets/easymde-logo-rounded.png"),
);
export const canonicalImageSource =
	"https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png";
export const previewSelector =
	'.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
export const sourceSelector = "#easymde-source";
export const expectedArticleTheme = "phycat-cherry";
export const expectedCodeTheme = "phycat-code";
export const evidenceDirectoryEnvironment = "EASYMDE_E2E_PERFORMANCE_EVIDENCE_DIR";
export const localDiagnosticsEnvironment = "EASYMDE_E2E_WECHAT_LOCAL_DIAGNOSTICS";
export const imageProviderEnvironment = "EASYMDE_E2E_WECHAT_IMAGE_PROVIDER";
export const supportedImageProviders = Object.freeze([
	"cloudflare-r2",
	"qiniu-kodo",
]);
export function expectedImageProviderFromSetting(value) {
	const configured = value?.trim() ?? "";
	const provider = configured || "cloudflare-r2";
	if (!supportedImageProviders.includes(provider)) {
		throw new Error("wechat-copy-performance-image-provider-invalid");
	}
	return provider;
}
export const expectedImageProvider = expectedImageProviderFromSetting(
	process.env[imageProviderEnvironment],
);

export function localDiagnosticsEnabledFromSetting(value) {
	const setting = value?.trim() ?? "";
	if (!["", "0", "1"].includes(setting)) {
		throw new Error("wechat-copy-performance-local-diagnostics-flag-invalid");
	}
	return setting === "1";
}
export const localDiagnosticsEnabled = localDiagnosticsEnabledFromSetting(
	process.env[localDiagnosticsEnvironment],
);

export function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value?.trim()) {
		throw new Error(
			`wechat-copy-performance-env-${name.toLowerCase().replaceAll("_", "-")}-missing`,
		);
	}
	return value;
}
