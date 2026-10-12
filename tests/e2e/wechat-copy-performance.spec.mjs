import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";

// Playwright tracing, video, and screenshots add browser work to the measured
// Copy window. This case owns its private timing collection instead.
test.use({
	screenshot: "off",
	trace: "off",
	video: "off",
});

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const expectedOrigin = "http://localhost:8093";
const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || "wp";
const adminUser = requiredEnvironment("WORDPRESS_ADMIN_USER");
const adminPassword = requiredEnvironment("WORDPRESS_ADMIN_PASSWORD");
const canonicalMarkdown = readFileSync(
	join(repositoryRoot, "docs/examples/markdown-full-capability-test.md"),
	"utf8",
);
const canonicalMarkdownLength = canonicalMarkdown.length;
const canonicalMarkdownSha256 = createHash("sha256")
	.update(canonicalMarkdown, "utf8")
	.digest("hex");
const expectedCanonicalMarkdownSha256 =
	"ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb";
const canonicalImage = readFileSync(
	join(repositoryRoot, "docs/assets/easymde-logo-rounded.png"),
);
const canonicalImageSource =
	"https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png";
const previewSelector =
	'.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
const sourceSelector = "#easymde-source";
const expectedArticleTheme = "phycat-cherry";
const expectedCodeTheme = "phycat-code";
const evidenceDirectoryEnvironment = "EASYMDE_E2E_PERFORMANCE_EVIDENCE_DIR";
const expectedServerManifestSha256 =
	"22aecc55ac42dd38c59c2cd2e2d780c63c2d388b46601d6d108e2feaadb6e35f";
const expectedDtdEditorFile = "assets/admin-editor-DtdAzZEp.js";
const expectedDtdEditorSha256 =
	"ea27ce3d296b044dd23a3c5846dfeadeeba09e8171bc2bcf83d565d03fcc5fd0";
const candidateFrontendBuildRoot = join(
	repositoryRoot,
	".cache/easymde-frontend-production-check",
);
const candidateLoaderBuildRoot = join(
	repositoryRoot,
	".cache/easymde-admin-editor-loader-production-check",
);
const candidateSourceEntries = {
	loader: "frontend/src/entrypoints/admin-editor-loader.ts",
	main: "frontend/src/entrypoints/admin-editor.tsx",
	worker:
		"frontend/src/integrations/browser/wechat/wechat-png-encoder.worker.ts",
};
const candidateApprovedAssetPrefixes = [
	"/wp-content/plugins/easymde/assets/build/",
	"/wp-content/plugins/easymde/assets/build/admin-editor-loader/",
];
const copyTimingStages = new Map([
	["easymde.wechat.copy.candidate.capture", "copy-candidate-capture"],
	["easymde.wechat.copy.candidate.geometry", "copy-candidate-geometry"],
	[
		"easymde.wechat.copy.candidate.rasterization",
		"copy-candidate-rasterization",
	],
	["easymde.wechat.copy.connected-plain-text", "copy-connected-plain-text"],
	["easymde.wechat.copy.final-geometry", "copy-final-geometry"],
	["easymde.wechat.copy.final-raw-context-refresh", "copy-final-raw-context"],
	["easymde.wechat.copy.final-source-freshness", "copy-final-source-freshness"],
	["easymde.wechat.copy.finalize-markup", "copy-finalize-markup"],
	["easymde.wechat.copy.outer-html", "copy-outer-html"],
	["easymde.wechat.copy.replacement", "copy-replacement"],
	["easymde.wechat.rasterizer.canvas-draw-encode", "rasterizer-canvas-encode"],
	["easymde.wechat.rasterizer.decode-wait", "rasterizer-decode-wait"],
	["easymde.wechat.rasterizer.digest-wait", "rasterizer-digest-wait"],
	["easymde.wechat.rasterizer.file", "rasterizer-file"],
	["easymde.wechat.rasterizer.geometry-cleanup", "rasterizer-geometry-cleanup"],
	["easymde.wechat.rasterizer.serialize-svg", "rasterizer-serialize-svg"],
	["easymde.wechat.rasterizer.uri-generation", "rasterizer-uri-generation"],
]);

const timingDetailModes = new Set(["async", "sync"]);
const timingDetailTerminals = new Set(["error", "success"]);
const timingDetailKinds = new Set(["math", "mermaid"]);
const genericTraceStageByName = new Map([
	["RunTask", "main-task"],
	["ThreadControllerImpl::RunTask", "main-task"],
	["RecalculateStyles", "main-style"],
	["UpdateLayoutTree", "main-layout"],
	["Layout", "main-layout"],
	["LayoutInvalidationTracking", "main-layout"],
	["PrePaint", "main-paint"],
	["Paint", "main-paint"],
	["UpdateLayerTree", "main-paint"],
	["CompositeLayers", "main-composite"],
]);
const traceBeginMarker = "easymde.wechat.performance.begin";
const traceClickMarker = "easymde.wechat.performance.click";
const traceEndMarker = "easymde.wechat.performance.end";
const uploadPathSuffix = "/image-hosting/upload";
const performanceModeEnvironment = "EASYMDE_E2E_PERFORMANCE_MODE";
const performanceModeDefinitions = Object.freeze({
	immersivePreview: Object.freeze({
		editingMode: "live-preview",
		immersive: true,
		immersiveMode: "preview",
	}),
	immersiveSource: Object.freeze({
		editingMode: "live-preview",
		immersive: true,
		immersiveMode: "source",
	}),
	immersiveSplit: Object.freeze({
		editingMode: "live-preview",
		immersive: true,
		immersiveMode: "split",
	}),
	ordinaryPreview: Object.freeze({
		editingMode: "preview",
		immersive: false,
		immersiveMode: null,
	}),
	ordinarySource: Object.freeze({
		editingMode: "source",
		immersive: false,
		immersiveMode: null,
	}),
	ordinarySplit: Object.freeze({
		editingMode: "live-preview",
		immersive: false,
		immersiveMode: null,
	}),
});
const performanceModeExpectations = Object.freeze({
	immersivePreview: Object.freeze({
		previewPresentation: "preview",
		previewVisible: true,
		sourceVisible: false,
	}),
	immersiveSource: Object.freeze({
		previewPresentation: "split",
		previewVisible: false,
		sourceVisible: true,
	}),
	immersiveSplit: Object.freeze({
		previewPresentation: "split",
		previewVisible: true,
		sourceVisible: true,
	}),
	ordinaryPreview: Object.freeze({
		previewPresentation: "split",
		previewVisible: true,
		sourceVisible: false,
	}),
	ordinarySource: Object.freeze({
		previewPresentation: "split",
		previewVisible: false,
		sourceVisible: true,
	}),
	ordinarySplit: Object.freeze({
		previewPresentation: "split",
		previewVisible: true,
		sourceVisible: true,
	}),
});

if (
	canonicalMarkdownLength !== 9254 ||
	canonicalMarkdownSha256 !== expectedCanonicalMarkdownSha256
) {
	throw new Error("wechat-copy-performance-canonical-markdown-mismatch");
}

function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value?.trim()) {
		throw new Error(
			`wechat-copy-performance-env-${name.toLowerCase().replaceAll("_", "-")}-missing`,
		);
	}
	return value;
}

function selectedPerformanceMode() {
	const configured = process.env[performanceModeEnvironment]?.trim();
	const mode = configured || "ordinarySplit";
	if (!Object.hasOwn(performanceModeDefinitions, mode)) {
		throw new Error("wechat-copy-performance-mode-invalid");
	}
	return mode;
}

const configuredPerformanceMode = selectedPerformanceMode();

function runWp(args) {
	if (!wpPath) throw new Error("wechat-copy-performance-wp-path-missing");
	const result = spawnSync(
		wpCli,
		[...args, `--path=${wpPath}`, "--allow-root"],
		{
			encoding: "utf8",
			env: {
				...process.env,
				WP_CLI_CACHE_DIR:
					process.env.WP_CLI_CACHE_DIR || "/tmp/easymde-wp-cli-cache",
			},
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error("wechat-copy-performance-wp-command-failed");
	}
	const output = result.stdout.trim();
	if (!output) throw new Error("wechat-copy-performance-wp-output-empty");
	return output;
}

function testSlug(testInfo) {
	return `wechat-performance-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function createOwnedUser(slug) {
	const username = `${adminUser}-${slug}`;
	const id = Number.parseInt(
		runWp([
			"user",
			"create",
			username,
			`${slug}@example.test`,
			"--role=administrator",
			`--user_pass=${adminPassword}`,
			"--porcelain",
		]),
		10,
	);
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new Error("wechat-copy-performance-user-id-invalid");
	}
	return { id, password: adminPassword, username };
}

function createOwnedPost(user, slug, testInfo) {
	const postId = Number.parseInt(
		runWp([
			"post",
			"create",
			`--post_author=${user.id}`,
			"--post_status=draft",
			"--post_type=post",
			`--post_title=WeChat performance ${slug}`,
			"--post_content=<p>Owned WeChat performance post.</p>",
			"--porcelain",
		]),
		10,
	);
	if (!Number.isSafeInteger(postId) || postId < 1) {
		throw new Error("wechat-copy-performance-post-id-invalid");
	}
	testInfo.wechatPerformancePostId = postId;
	runWp(["post", "meta", "update", String(postId), "_easymde_enabled", "1"]);
	runWp([
		"post",
		"meta",
		"update",
		String(postId),
		"_easymde_markdown",
		canonicalMarkdown,
	]);
	runWp([
		"post",
		"meta",
		"update",
		String(postId),
		"_easymde_markdown_theme",
		expectedArticleTheme,
	]);
	runWp([
		"post",
		"meta",
		"update",
		String(postId),
		"_easymde_code_theme",
		expectedCodeTheme,
	]);
	return postId;
}

function cleanupOwnedRecords(testInfo) {
	const postId = testInfo.wechatPerformancePostId;
	const userId = testInfo.wechatPerformanceUserId;
	let postDeleted = !Number.isSafeInteger(postId) || postId < 1;
	const failures = [];
	if (Number.isSafeInteger(postId) && postId > 0) {
		try {
			runWp(["post", "delete", String(postId), "--force"]);
			postDeleted = true;
		} catch {
			failures.push("post");
		}
	}
	if (postDeleted && Number.isSafeInteger(userId) && userId > 0) {
		try {
			runWp(["user", "delete", String(userId), "--yes"]);
		} catch {
			failures.push("user");
		}
	}
	if (failures.length > 0)
		throw new Error("wechat-copy-performance-cleanup-failed");
}

function readServerImageSettings() {
	let parsed;
	try {
		parsed = JSON.parse(
			runWp([
				"option",
				"get",
				"easymde_editor_settings",
				"--format=json",
				"--quiet",
			]),
		);
	} catch {
		throw new Error("wechat-copy-performance-settings-read-failed");
	}
	const images = parsed?.settings_center?.images;
	if (!images || typeof images !== "object" || Array.isArray(images)) {
		throw new Error("wechat-copy-performance-image-settings-unavailable");
	}
	const fields = {
		backupEnabled: images.backupEnabled,
		imageHostingEnabled: images.imageHostingEnabled,
		service: images.service,
		wechatPngExportEnabled: images.wechatPngExportEnabled,
	};
	if (
		fields.imageHostingEnabled !== true ||
		fields.wechatPngExportEnabled !== true ||
		fields.backupEnabled !== false ||
		fields.service !== "cloudflare-r2"
	) {
		throw new Error("wechat-copy-performance-r2-settings-mismatch");
	}
	return fields;
}

async function login(page, user) {
	await page.goto("/wp-login.php", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#loginform")).toBeVisible();
	await page.locator("#loginform").evaluate((form, credentials) => {
		const username = form.elements.namedItem("log");
		const password = form.elements.namedItem("pwd");
		const submit = form.elements.namedItem("wp-submit");
		if (
			!(username instanceof HTMLInputElement) ||
			!(password instanceof HTMLInputElement) ||
			!(submit instanceof HTMLInputElement)
		) {
			throw new Error("wechat-copy-performance-login-fields-unavailable");
		}
		username.value = credentials.username;
		password.value = credentials.password;
		form.requestSubmit(submit);
	}, user);
	await expect(page.locator("#wpadminbar")).toBeVisible();
	if (new URL(page.url()).origin !== expectedOrigin) {
		throw new Error("wechat-copy-performance-live-origin-invalid");
	}
}

async function assertCanonicalSource(page) {
	const matches = await page.locator(sourceSelector).evaluate(
		(element, expected) => {
			if (!(element instanceof HTMLTextAreaElement)) return false;
			const bytes = new TextEncoder().encode(element.value);
			return crypto.subtle.digest("SHA-256", bytes).then((digest) => {
				const hash = [...new Uint8Array(digest)]
					.map((byte) => byte.toString(16).padStart(2, "0"))
					.join("");
				return (
					element.value.length === expected.length && hash === expected.sha256
				);
			});
		},
		{
			length: canonicalMarkdownLength,
			sha256: expectedCanonicalMarkdownSha256,
		},
	);
	expect(matches).toBe(true);
}

async function waitForPreviewReady(
	page,
	{ requireImages, visible = true } = {},
) {
	const shouldRequireImages = requireImages ?? visible;
	const preview = page.locator(previewSelector);
	if (visible) await expect(preview).toBeVisible();
	else await expect(preview).toBeAttached();
	await expect(preview).toHaveAttribute("aria-busy", "false");
	await expect(preview).toHaveAttribute("data-easymde-preview-accepted", "1");
	await expect(preview).not.toHaveAttribute("data-easymde-preview-error", "1");
	await page.evaluate(
		async ({ requireImages: shouldRequireImages }) => {
			if (document.fonts?.ready) await document.fonts.ready;
			if (document.fonts?.status !== "loaded") {
				throw new Error("wechat-copy-performance-font-readiness-failed");
			}
			const root = document.querySelector(
				'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
			);
			if (!(root instanceof HTMLElement)) {
				throw new Error("wechat-copy-performance-preview-root-unavailable");
			}
			const images = [...root.querySelectorAll("img")];
			if (!shouldRequireImages) return;
			if (images.length < 1)
				throw new Error("wechat-copy-performance-preview-images-unavailable");
			await Promise.all(
				images.map(async (image) => {
					if (!image.complete) {
						await new Promise((resolve, reject) => {
							const onLoad = () => {
								image.removeEventListener("load", onLoad);
								image.removeEventListener("error", onError);
								resolve();
							};
							const onError = () => {
								image.removeEventListener("load", onLoad);
								image.removeEventListener("error", onError);
								reject(
									new Error("wechat-copy-performance-preview-image-failed"),
								);
							};
							image.addEventListener("load", onLoad, { once: true });
							image.addEventListener("error", onError, { once: true });
						});
					}
					if (typeof image.decode === "function") await image.decode();
					if (!Number.isFinite(image.naturalWidth) || image.naturalWidth < 1) {
						throw new Error(
							"wechat-copy-performance-preview-image-intrinsic-invalid",
						);
					}
				}),
			);
		},
		{ requireImages: shouldRequireImages },
	);
}

async function installPerformanceModeOverride(page, mode) {
	const definition = performanceModeDefinitions[mode];
	if (!definition || mode === "ordinarySplit") return;
	await page.addInitScript(
		({ editingMode }) => {
			let loaderBootstrap;
			Object.defineProperty(window, "EasyMDEAdminEditorLoaderBootstrap", {
				configurable: true,
				get: () => loaderBootstrap,
				set: (value) => {
					const editorBootstrap =
						value &&
						typeof value === "object" &&
						value.editorBootstrap &&
						typeof value.editorBootstrap === "object"
							? value.editorBootstrap
							: null;
					if (!editorBootstrap) {
						loaderBootstrap = value;
						return;
					}
					loaderBootstrap = {
						...value,
						editorBootstrap: {
							...editorBootstrap,
							settings: {
								...editorBootstrap.settings,
								general: {
									...editorBootstrap.settings?.general,
									editingMode,
								},
							},
						},
					};
				},
			});
		},
		{ editingMode: definition.editingMode },
	);
}

async function configurePerformanceMode(page, mode) {
	const definition = performanceModeDefinitions[mode];
	if (!definition) throw new Error("wechat-copy-performance-mode-invalid");
	await waitForPreviewReady(page, {
		visible: definition.immersive || definition.editingMode !== "source",
	});
	if (!definition.immersive) {
		if (definition.editingMode === "source") {
			await expect(
				page.locator(".easymde-source-react .cm-content"),
			).toBeVisible();
		} else if (definition.editingMode === "preview") {
			await expect(page.locator(".easymde-pane-source")).toBeHidden();
		}
		return;
	}

	const immersiveLabels = await page.evaluate(
		() => window.EasyMDEEditorRootBootstrap.strings.immersive,
	);
	await page.locator(".easymde-toolbar-immersive-toggle").click();
	await expect(
		page.getByRole("region", { name: immersiveLabels.immersive }),
	).toBeVisible();
	const immersivePreview = page.locator(
		'.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]',
	);
	if (definition.immersiveMode === "preview") {
		await page
			.getByRole("button", { name: immersiveLabels.previewMode, exact: true })
			.click();
		await expect(
			page.getByText(immersiveLabels.previewContentLoaded),
		).toBeVisible();
		await waitForPreviewReady(page);
		return;
	}
	if (definition.immersiveMode === "source") {
		await page
			.getByRole("button", { name: immersiveLabels.editMode, exact: true })
			.click();
		await expect(
			page.locator(".easymde-source-react .cm-content"),
		).toBeVisible();
		await expect(immersivePreview).toBeHidden();
		await waitForPreviewReady(page, { visible: false });
		return;
	}
	await expect(immersivePreview).toBeVisible();
	await waitForPreviewReady(page);
}

async function readPerformanceModeState(page) {
	return page.evaluate(() => {
		const bootstrap = window.EasyMDEEditorRootBootstrap;
		const editor = document.querySelector(".easymde-editor");
		const workspace = document.querySelector(".easymde-workspace");
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		const source = document.querySelector(".easymde-pane-source");
		if (!(editor instanceof HTMLElement)) {
			throw new Error("wechat-copy-performance-editor-owner-unavailable");
		}
		if (!(workspace instanceof HTMLElement)) {
			throw new Error("wechat-copy-performance-workspace-owner-unavailable");
		}
		if (!(preview instanceof HTMLElement) || !(source instanceof HTMLElement)) {
			throw new Error("wechat-copy-performance-surface-owner-unavailable");
		}
		const visible = (element) =>
			element instanceof HTMLElement && element.getClientRects().length > 0;
		const workspaceModeOwners = ["live-preview", "preview", "source"].filter(
			(mode) => workspace.classList.contains(`is-mode-${mode}`),
		);
		if (workspaceModeOwners.length !== 1) {
			throw new Error("wechat-copy-performance-workspace-mode-owner-invalid");
		}
		const immersiveModeOwners = ["split", "preview", "source"].filter((mode) =>
			editor.classList.contains(`is-immersive-${mode}`),
		);
		const immersive = editor.classList.contains("is-immersive");
		if (
			(immersive && immersiveModeOwners.length !== 1) ||
			(!immersive && immersiveModeOwners.length !== 0)
		) {
			throw new Error("wechat-copy-performance-immersive-mode-owner-invalid");
		}
		const immersiveMode = immersive ? immersiveModeOwners[0] : null;
		const workspaceMode = workspaceModeOwners[0];
		const editingMode = bootstrap?.settings?.general?.editingMode ?? null;
		const actualMode = immersive
			? `immersive${immersiveMode[0].toUpperCase()}${immersiveMode.slice(1)}`
			: {
					"live-preview": "ordinarySplit",
					preview: "ordinaryPreview",
					source: "ordinarySource",
				}[workspaceMode];
		if (!actualMode) {
			throw new Error("wechat-copy-performance-actual-mode-unavailable");
		}
		return {
			actualMode,
			editingMode,
			immersiveMode,
			previewPresentation:
				editor?.getAttribute("data-easymde-preview-presentation") ?? null,
			previewVisible: visible(preview),
			sourceVisible: visible(source),
			surface: immersiveMode ? "immersive" : "ordinary",
			workspaceMode,
		};
	});
}

async function readBrowserConfiguration(page) {
	return page.evaluate(() => {
		const bootstrap = window.EasyMDEEditorRootBootstrap;
		if (!bootstrap || typeof bootstrap !== "object") {
			throw new Error("wechat-copy-performance-editor-bootstrap-unavailable");
		}
		const articleTheme = document.querySelector(
			"#easymde-markdown-theme-field",
		);
		const codeTheme = document.querySelector("#easymde-code-theme-field");
		const codeThemeExplicit = document.querySelector(
			"#easymde-code-theme-explicit-field",
		);
		const articleStylesheet = document.querySelector(
			"#easymde-article-theme-css",
		);
		const codeStylesheet = document.querySelector(
			"#easymde-highlight-theme-css",
		);
		const editor = document.querySelector(".easymde-editor");
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		const imageUpload = bootstrap.imageUpload;
		const endpointPath =
			typeof imageUpload?.endpoint === "string"
				? new URL(imageUpload.endpoint, location.href).pathname
				: "";
		const visible = (element) =>
			element instanceof HTMLElement && element.getClientRects().length > 0;
		return {
			articleStylesheetReady:
				articleStylesheet instanceof HTMLLinkElement &&
				Boolean(articleStylesheet.sheet?.href),
			articleTheme:
				articleTheme instanceof HTMLInputElement ? articleTheme.value : null,
			codeStylesheetReady:
				codeStylesheet instanceof HTMLLinkElement &&
				Boolean(codeStylesheet.sheet?.href),
			codeTheme: codeTheme instanceof HTMLInputElement ? codeTheme.value : null,
			codeThemeExplicit:
				codeThemeExplicit instanceof HTMLInputElement
					? codeThemeExplicit.value
					: null,
			endpointIsImageHosting: endpointPath.endsWith("/image-hosting/upload"),
			imageUploadEnabled: imageUpload?.enabled === true,
			imageUploadOwner: imageUpload?.uploadOwner ?? null,
			pngConversionEnabled:
				bootstrap.wechatExport?.pngConversionEnabled === true,
			previewVisible: visible(preview),
			previewPresentation:
				editor?.getAttribute("data-easymde-preview-presentation") ?? null,
			sourceVisible: visible(document.querySelector(".easymde-pane-source")),
		};
	});
}

async function readServerBundleIdentity(page) {
	try {
		return await page.evaluate(
			async ({
				expectedDtdEditorFile: expectedFile,
				expectedManifestSha256,
				expectedScriptSha256,
			}) => {
				const loader = window.EasyMDEAdminEditorLoaderBootstrap;
				if (!loader || typeof loader.mainScriptUrl !== "string") {
					throw new Error(
						"wechat-copy-performance-loader-bootstrap-unavailable",
					);
				}
				const mainScriptUrl = new URL(
					loader.mainScriptUrl,
					window.location.href,
				);
				if (mainScriptUrl.origin !== window.location.origin) {
					throw new Error("wechat-copy-performance-main-script-origin-invalid");
				}
				const mainScriptPath = mainScriptUrl.pathname.split("/").pop() ?? "";
				const mainScriptElement = [...document.scripts].find((script) => {
					try {
						return (
							new URL(script.src, window.location.href).href ===
							mainScriptUrl.href
						);
					} catch {
						return false;
					}
				});
				if (!(mainScriptElement instanceof HTMLScriptElement)) {
					throw new Error(
						"wechat-copy-performance-main-script-element-unavailable",
					);
				}
				const marker = "/assets/";
				const markerIndex = mainScriptUrl.pathname.lastIndexOf(marker);
				if (markerIndex < 0)
					throw new Error("wechat-copy-performance-build-root-unavailable");
				const buildRootPath = mainScriptUrl.pathname.slice(0, markerIndex);
				const digest = async (bytes) => {
					const hash = await crypto.subtle.digest("SHA-256", bytes);
					return [...new Uint8Array(hash)]
						.map((byte) => byte.toString(16).padStart(2, "0"))
						.join("");
				};
				const manifestResponse = await fetch(
					new URL(`${buildRootPath}/manifest.json`, window.location.href),
					{ cache: "no-store", credentials: "same-origin" },
				);
				if (!manifestResponse.ok) {
					throw new Error(
						"wechat-copy-performance-server-manifest-request-failed",
					);
				}
				const manifestBytes = await manifestResponse.arrayBuffer();
				const manifestText = new TextDecoder().decode(manifestBytes);
				const manifest = JSON.parse(manifestText);
				const entry = manifest?.["frontend/src/entrypoints/admin-editor.tsx"];
				const manifestEntryMatches = entry?.file === expectedFile;
				if (!manifestEntryMatches) {
					throw new Error(
						"wechat-copy-performance-server-manifest-entry-mismatch",
					);
				}
				const scriptResponse = await fetch(
					new URL(`${buildRootPath}/${entry.file}`, window.location.href),
					{ cache: "no-store", credentials: "same-origin" },
				);
				if (!scriptResponse.ok) {
					throw new Error(
						"wechat-copy-performance-server-script-request-failed",
					);
				}
				const scriptBytes = await scriptResponse.arrayBuffer();
				const manifestSha256 = await digest(manifestBytes);
				const scriptSha256 = await digest(scriptBytes);
				return {
					documentScriptMatchesBootstrap: true,
					loadedScriptPathMatchesDtd:
						mainScriptPath === expectedFile.split("/").pop(),
					loadedScriptShaMatchesDtd: scriptSha256 === expectedScriptSha256,
					manifestEntryMatchesDtd: manifestEntryMatches,
					manifestShaMatchesExpected: manifestSha256 === expectedManifestSha256,
					serverManifestFetched: true,
				};
			},
			{
				expectedDtdEditorFile,
				expectedManifestSha256: expectedServerManifestSha256,
				expectedScriptSha256: expectedDtdEditorSha256,
			},
		);
	} catch {
		throw new Error(
			"wechat-copy-performance-server-bundle-identity-unavailable",
		);
	}
}

function readCandidateBuildIdentity() {
	const readManifest = (root, file, code) => {
		try {
			const bytes = readFileSync(join(root, file));
			return {
				bytes,
				value: JSON.parse(bytes.toString("utf8")),
			};
		} catch {
			throw new Error(code);
		}
	};
	const readAsset = (root, file, code) => {
		if (!/^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/u.test(file)) {
			throw new Error(code);
		}
		try {
			const body = readFileSync(join(root, file));
			return {
				body,
				file,
				sha256: createHash("sha256").update(body).digest("hex"),
			};
		} catch {
			throw new Error(code);
		}
	};
	const loaderManifest = readManifest(
		candidateLoaderBuildRoot,
		"manifest.json",
		"wechat-copy-candidate-loader-manifest-unavailable",
	);
	const loaderWordPressManifest = readManifest(
		candidateLoaderBuildRoot,
		"wordpress-manifest.json",
		"wechat-copy-candidate-loader-wordpress-manifest-unavailable",
	);
	const frontendManifest = readManifest(
		candidateFrontendBuildRoot,
		"manifest.json",
		"wechat-copy-candidate-frontend-manifest-unavailable",
	);
	const frontendWordPressManifest = readManifest(
		candidateFrontendBuildRoot,
		"wordpress-manifest.json",
		"wechat-copy-candidate-frontend-wordpress-manifest-unavailable",
	);
	const loaderEntry =
		loaderManifest.value?.[candidateSourceEntries.loader] ?? null;
	const loaderWordPressEntry =
		loaderWordPressManifest.value?.entries?.[candidateSourceEntries.loader] ??
		null;
	const mainEntry =
		frontendManifest.value?.[candidateSourceEntries.main] ?? null;
	const workerEntry =
		frontendManifest.value?.[candidateSourceEntries.worker] ?? null;
	const mainWordPressEntry =
		frontendWordPressManifest.value?.entries?.[candidateSourceEntries.main] ??
		null;
	if (
		Object.keys(loaderManifest.value ?? {}).length !== 1 ||
		!loaderEntry?.isEntry ||
		!/^assets\/admin-editor-loader-[A-Za-z0-9_-]+\.js$/u.test(
			loaderEntry.file ?? "",
		) ||
		loaderWordPressManifest.value?.schemaVersion !== 1 ||
		Object.keys(loaderWordPressManifest.value?.entries ?? {}).length !== 1 ||
		loaderWordPressEntry?.file !== loaderEntry.file ||
		JSON.stringify(loaderWordPressEntry?.resources ?? []) !== "[]"
	) {
		throw new Error("wechat-copy-candidate-loader-manifest-mismatch");
	}
	if (
		Object.keys(frontendManifest.value ?? {}).length !== 2 ||
		!mainEntry?.isEntry ||
		!/^assets\/admin-editor-[A-Za-z0-9_-]+\.js$/u.test(mainEntry.file ?? "") ||
		workerEntry?.isEntry !== false ||
		workerEntry.src !== candidateSourceEntries.worker ||
		!/^assets\/wechat-png-encoder-[A-Za-z0-9_-]+\.js$/u.test(
			workerEntry.file ?? "",
		) ||
		frontendWordPressManifest.value?.schemaVersion !== 1 ||
		Object.keys(frontendWordPressManifest.value?.entries ?? {}).length !== 1 ||
		mainWordPressEntry?.file !== mainEntry.file ||
		JSON.stringify(mainWordPressEntry?.resources ?? []) !==
			JSON.stringify([workerEntry.file])
	) {
		throw new Error("wechat-copy-candidate-frontend-manifest-mismatch");
	}
	const loader = readAsset(
		candidateLoaderBuildRoot,
		loaderEntry.file,
		"wechat-copy-candidate-loader-asset-unavailable",
	);
	const main = readAsset(
		candidateFrontendBuildRoot,
		mainEntry.file,
		"wechat-copy-candidate-main-asset-unavailable",
	);
	const worker = readAsset(
		candidateFrontendBuildRoot,
		workerEntry.file,
		"wechat-copy-candidate-worker-asset-unavailable",
	);
	const loaderCssAssets = (
		Array.isArray(loaderEntry.css) ? loaderEntry.css : []
	).map((file, index) =>
		readAsset(
			candidateLoaderBuildRoot,
			file,
			`wechat-copy-candidate-loader-css-${index}-asset-unavailable`,
		),
	);
	const frontendCssAssets = (
		Array.isArray(mainEntry.css) ? mainEntry.css : []
	).map((file, index) =>
		readAsset(
			candidateFrontendBuildRoot,
			file,
			`wechat-copy-candidate-frontend-css-${index}-asset-unavailable`,
		),
	);
	const cssAssets = [...loaderCssAssets, ...frontendCssAssets];
	return {
		assets: [
			{ kind: "loader", ...loader },
			{ kind: "main", ...main },
			{ kind: "worker", ...worker },
			...cssAssets.map((asset, index) => ({
				kind: `css-${index}`,
				...asset,
			})),
		],
		identity: {
			loader: {
				file: loader.file,
				fileSha256: loader.sha256,
				manifestSha256: createHash("sha256")
					.update(loaderManifest.bytes)
					.digest("hex"),
				wordpressManifestSha256: createHash("sha256")
					.update(loaderWordPressManifest.bytes)
					.digest("hex"),
			},
			frontend: {
				css: cssAssets.map(({ file, sha256 }) => ({ file, sha256 })),
				mainFile: main.file,
				mainFileSha256: main.sha256,
				workerFile: worker.file,
				workerFileSha256: worker.sha256,
				manifestSha256: createHash("sha256")
					.update(frontendManifest.bytes)
					.digest("hex"),
				wordpressManifestSha256: createHash("sha256")
					.update(frontendWordPressManifest.bytes)
					.digest("hex"),
			},
		},
	};
}

async function routeCandidateBuildAssets(page, build) {
	const seen = new Set();
	const observations = new Map();
	const approvedPath = (pathname) =>
		candidateApprovedAssetPrefixes.some((prefix) =>
			pathname.startsWith(prefix),
		);
	const assetMatches = (asset, pathname) =>
		approvedPath(pathname) &&
		(pathname.endsWith(`/${asset.file}`) ||
			(asset.kind === "loader" &&
				/(?:^|\/)admin-editor-loader-[A-Za-z0-9_-]+\.js$/u.test(pathname)) ||
			(asset.kind === "main" &&
				/(?:^|\/)admin-editor-(?!loader-)[A-Za-z0-9_-]+\.js$/u.test(pathname)));
	const matcher = (url) =>
		url.origin === expectedOrigin &&
		build.assets.some((asset) => assetMatches(asset, url.pathname));
	const handler = async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin !== expectedOrigin || !approvedPath(url.pathname)) {
			return route.continue();
		}
		const asset = build.assets.find((candidate) =>
			assetMatches(candidate, url.pathname),
		);
		if (!asset) return route.continue();
		if (request.method() !== "GET") {
			throw new Error("wechat-copy-candidate-asset-request-method-invalid");
		}
		const bodySha256 = createHash("sha256").update(asset.body).digest("hex");
		if (bodySha256 !== asset.sha256) {
			throw new Error("wechat-copy-candidate-asset-body-hash-mismatch");
		}
		seen.add(asset.kind);
		const previous = observations.get(asset.kind);
		observations.set(asset.kind, {
			bodySha256,
			expectedBodySha256: asset.sha256,
			kind: asset.kind,
			requestCount: (previous?.requestCount ?? 0) + 1,
		});
		await route.fulfill({
			body: asset.body,
			contentType: asset.file.endsWith(".css")
				? "text/css"
				: "application/javascript",
			status: 200,
		});
	};
	await page.route(matcher, handler);
	return {
		observed() {
			return [...seen].sort();
		},
		evidence() {
			return [...observations.values()].sort((left, right) =>
				left.kind.localeCompare(right.kind),
			);
		},
		async stop() {
			await page.unroute(matcher, handler);
		},
	};
}

async function readCandidateRuntimeIdentity(page) {
	return page.evaluate(() => {
		const loader = window.EasyMDEAdminEditorLoaderBootstrap;
		if (!loader || typeof loader.mainScriptUrl !== "string") {
			throw new Error("wechat-copy-candidate-loader-bootstrap-unavailable");
		}
		const mainUrl = new URL(loader.mainScriptUrl, window.location.href);
		const mainScriptLoaded = [...document.scripts].some((script) => {
			try {
				return (
					new URL(script.src, window.location.href).pathname ===
					mainUrl.pathname
				);
			} catch {
				return false;
			}
		});
		return {
			loaderBootstrapPresent: true,
			mainScriptLoaded,
		};
	});
}

function installPerformanceProbe(page) {
	return page.addInitScript(
		({
			beginMarker,
			clickMarker,
			copyTimingStageEntries,
			endMarker,
			timingDetailKindValues,
			timingDetailModeValues,
			timingDetailTerminalValues,
		}) => {
			const copyTimingStages = new Map(copyTimingStageEntries);
			const timingDetailModes = new Set(timingDetailModeValues);
			const timingDetailTerminals = new Set(timingDetailTerminalValues);
			const timingDetailKinds = new Set(timingDetailKindValues);
			const state = {
				active: false,
				clickAt: null,
				clickCountAtStart: 0,
				clicks: [],
				endAt: null,
				longTasks: [],
				measures: [],
				observerError: null,
				ownerChanges: [],
				rafs: [],
				status: [],
				statusSuccessAt: null,
				writes: [],
				writeCountAtStart: 0,
			};
			let nativeWrite = null;
			let originalWriteDescriptor = null;
			let clipboard = null;
			let measureObserver = null;
			let longTaskObserver = null;
			let statusObserver = null;
			let listenersInstalled = false;
			let handleClick = null;
			let handleVisibilityChange = null;
			let handleFocus = null;
			let handleBlur = null;
			let handleDomContentLoaded = null;
			let lastStatus = "";
			let earlyPhasePromise = Promise.resolve();
			let earlyPhaseResolve = null;

			const finite = (value) => Number.isFinite(value) && value >= 0;
			const captureOwner = (target = null) => {
				const ownerDocument = target?.ownerDocument ?? document;
				let topMatchesSelf = false;
				try {
					topMatchesSelf = window.top === window.self;
				} catch {
					state.observerError ??=
						"wechat-copy-performance-top-owner-unavailable";
				}
				return {
					activeElementIsTarget:
						target instanceof Element && document.activeElement === target,
					defaultViewMatches: ownerDocument.defaultView === window,
					documentHasFocus: document.hasFocus(),
					ownerDocumentMatches: ownerDocument === document,
					selfMatchesWindow: window.self === window,
					topMatchesSelf,
					visibilityState: document.visibilityState,
				};
			};
			const observeMeasureEntries = (entries) => {
				for (const entry of entries) {
					if (entry.entryType !== "measure") continue;
					if (!copyTimingStages.has(entry.name)) continue;
					if (!finite(entry.startTime) || !finite(entry.duration)) {
						state.observerError ??=
							"wechat-copy-performance-measure-timing-invalid";
						continue;
					}
					const detail = entry.detail;
					if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-invalid";
						continue;
					}
					const keys = Object.keys(detail).sort();
					const allowedKeys = ["candidate", "kind", "mode", "terminal"];
					if (keys.some((key) => !allowedKeys.includes(key))) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-keys-invalid";
						continue;
					}
					if (
						!timingDetailModes.has(detail.mode) ||
						!timingDetailTerminals.has(detail.terminal)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-enum-invalid";
						continue;
					}
					if (
						detail.kind !== undefined &&
						!timingDetailKinds.has(detail.kind)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-kind-invalid";
						continue;
					}
					if (
						detail.candidate !== undefined &&
						(!Number.isInteger(detail.candidate) ||
							detail.candidate < 0 ||
							detail.candidate > 31)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-candidate-invalid";
						continue;
					}
					state.measures.push({
						detail: {
							...(detail.kind === undefined ? {} : { kind: detail.kind }),
							mode: detail.mode,
							terminal: detail.terminal,
						},
						durationMs: entry.duration,
						name: entry.name,
						startMs: entry.startTime,
					});
				}
			};
			const observeLongTaskEntries = (entries) => {
				for (const entry of entries) {
					if (!finite(entry.startTime) || !finite(entry.duration)) {
						state.observerError ??=
							"wechat-copy-performance-longtask-timing-invalid";
						continue;
					}
					state.longTasks.push({
						durationMs: entry.duration,
						startMs: entry.startTime,
					});
				}
			};
			const drainObservers = () => {
				if (measureObserver)
					observeMeasureEntries(measureObserver.takeRecords());
				if (longTaskObserver)
					observeLongTaskEntries(longTaskObserver.takeRecords());
			};
			const emitOwnerChange = (stage) => {
				if (!state.active) return;
				const at = performance.now();
				if (!finite(at)) {
					state.observerError ??=
						"wechat-copy-performance-owner-change-timing-invalid";
					return;
				}
				state.ownerChanges.push({ at, state: captureOwner(), type: stage });
			};
			const observeStatus = () => {
				if (!state.active) return;
				const node = document.querySelector(
					'.easymde-editor > .easymde-editor-message-alert-host [role="status"],' +
						' .easymde-editor > .easymde-editor-message-alert-host [role="alert"]',
				);
				if (!(node instanceof HTMLElement)) return;
				const bootstrap = window.EasyMDEEditorRootBootstrap;
				const success = bootstrap?.wechatExport?.strings?.success;
				const failed = bootstrap?.wechatExport?.strings?.failed;
				const failedWithUploads =
					bootstrap?.wechatExport?.strings?.failedWithUploads;
				const unsupported = bootstrap?.wechatExport?.strings?.unsupported;
				const text = node.textContent ?? "";
				const code =
					text === success
						? "success"
						: text === failed ||
								text === failedWithUploads ||
								text === unsupported
							? "failed"
							: "other";
				const role = node.getAttribute("role") ?? "unknown";
				const key = `${role}:${code}`;
				if (key === lastStatus) return;
				lastStatus = key;
				const at = performance.now();
				state.status.push({ at, code });
				if (code === "success" && state.statusSuccessAt === null) {
					state.statusSuccessAt = at;
					state.endAt = at;
					performance.mark(endMarker);
				}
			};
			const scheduleEarlyPhases = () => {
				earlyPhasePromise = new Promise((resolve) => {
					earlyPhaseResolve = resolve;
				});
				let rafCount = 0;
				const nextRaf = () => {
					rafCount += 1;
					state.rafs.push({ at: performance.now(), index: rafCount });
					if (rafCount < 3) {
						requestAnimationFrame(nextRaf);
					} else if (earlyPhaseResolve) {
						earlyPhaseResolve();
						earlyPhaseResolve = null;
					}
				};
				requestAnimationFrame(nextRaf);
				setTimeout(() => {
					state.rafs.push({ at: performance.now(), index: 0 });
					if (rafCount >= 3 && earlyPhaseResolve) {
						earlyPhaseResolve();
						earlyPhaseResolve = null;
					}
				}, 0);
			};
			const attachStatusObserver = () => {
				if (statusObserver || !document.documentElement) return;
				statusObserver = new MutationObserver(observeStatus);
				statusObserver.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["class", "role"],
					characterData: true,
					childList: true,
					subtree: true,
				});
			};
			const install = () => {
				const supported = PerformanceObserver.supportedEntryTypes ?? [];
				if (!supported.includes("measure") || !supported.includes("longtask")) {
					state.observerError =
						"wechat-copy-performance-observer-type-unavailable";
				} else {
					try {
						measureObserver = new PerformanceObserver((list) =>
							observeMeasureEntries(list.getEntries()),
						);
						measureObserver.observe({ buffered: true, type: "measure" });
						longTaskObserver = new PerformanceObserver((list) =>
							observeLongTaskEntries(list.getEntries()),
						);
						longTaskObserver.observe({ buffered: true, type: "longtask" });
					} catch {
						state.observerError =
							"wechat-copy-performance-observer-install-failed";
					}
				}
				clipboard = navigator.clipboard;
				nativeWrite = clipboard?.write?.bind(clipboard) ?? null;
				if (!clipboard || !nativeWrite) {
					state.observerError ??=
						"wechat-copy-performance-native-clipboard-unavailable";
				} else {
					originalWriteDescriptor = Object.getOwnPropertyDescriptor(
						clipboard,
						"write",
					);
					Object.defineProperty(clipboard, "write", {
						configurable: true,
						enumerable: originalWriteDescriptor?.enumerable ?? false,
						writable: true,
						value: (items) => {
							const at = performance.now();
							const target = state.clicks.at(-1)?.target ?? null;
							const record = {
								activation: navigator.userActivation?.isActive === true,
								at,
								owner: captureOwner(target),
								itemCount: Array.isArray(items) ? items.length : null,
								nativeState: "pending",
								settledAt: null,
							};
							state.writes.push(record);
							const result = nativeWrite(items);
							Promise.resolve(result).then(
								() => {
									record.nativeState = "fulfilled";
									record.settledAt = performance.now();
								},
								() => {
									record.nativeState = "rejected";
									record.settledAt = performance.now();
								},
							);
							return result;
						},
					});
				}
				handleClick = (event) => {
					if (!state.active) return;
					const target =
						event.target instanceof Element
							? event.target.closest(".easymde-toolbar-copy-action")
							: null;
					if (!(target instanceof HTMLElement)) return;
					const at = performance.now();
					if (!finite(at)) {
						state.observerError ??=
							"wechat-copy-performance-click-timing-invalid";
						return;
					}
					if (state.clickAt === null) {
						state.clickAt = at;
						performance.mark(clickMarker);
						scheduleEarlyPhases();
					}
					state.clicks.push({ at, owner: captureOwner(target), target });
				};
				handleVisibilityChange = () => emitOwnerChange("visibilitychange");
				handleFocus = () => emitOwnerChange("focus");
				handleBlur = () => emitOwnerChange("blur");
				document.addEventListener("click", handleClick, true);
				document.addEventListener("visibilitychange", handleVisibilityChange);
				window.addEventListener("focus", handleFocus);
				window.addEventListener("blur", handleBlur);
				listenersInstalled = true;
				if (document.documentElement) {
					attachStatusObserver();
				} else {
					handleDomContentLoaded = () => {
						attachStatusObserver();
						observeStatus();
					};
					document.addEventListener(
						"DOMContentLoaded",
						handleDomContentLoaded,
						{
							once: true,
						},
					);
				}
			};
			install();

			globalThis.__easymdeWechatCopyPerformance = {
				async awaitEarlyPhases() {
					await earlyPhasePromise;
				},
				begin() {
					if (state.observerError) throw new Error(state.observerError);
					if (state.active)
						throw new Error("wechat-copy-performance-probe-already-active");
					state.active = true;
					state.clickAt = null;
					state.clicks = [];
					state.ownerChanges = [];
					state.rafs = [];
					state.status = [];
					state.statusSuccessAt = null;
					state.writes = [];
					state.clickCountAtStart = 0;
					state.writeCountAtStart = 0;
					performance.mark(beginMarker);
				},
				getState() {
					return {
						clickAt: state.clickAt,
						clickCount: state.clicks.length,
						endAt: state.endAt,
						observerError: state.observerError,
						ownerChanges: state.ownerChanges.map(
							({ at, state: ownerState, type }) => ({
								at,
								state: ownerState,
								type,
							}),
						),
						rafs: state.rafs.slice(),
						status: state.status.slice(),
						statusSuccessAt: state.statusSuccessAt,
						writeCount: state.writes.length,
						writes: state.writes.map((write) => ({ ...write })),
					};
				},
				end() {
					drainObservers();
					const endAt = performance.now();
					if (!finite(endAt))
						throw new Error("wechat-copy-performance-end-timing-invalid");
					state.endAt ??= endAt;
					if (state.statusSuccessAt === null) performance.mark(endMarker);
					state.active = false;
					return {
						clickAt: state.clickAt,
						clicks: state.clicks.map(({ at, owner }) => ({ at, owner })),
						endAt: state.endAt,
						longTasks: state.longTasks.slice(),
						measures: state.measures.slice(),
						observerError: state.observerError,
						ownerChanges: state.ownerChanges.map(
							({ at, state: ownerState, type }) => ({
								at,
								state: ownerState,
								type,
							}),
						),
						rafs: state.rafs.slice(),
						status: state.status.slice(),
						statusSuccessAt: state.statusSuccessAt,
						writes: state.writes.map((write) => ({ ...write })),
					};
				},
				stop() {
					drainObservers();
					state.active = false;
					if (measureObserver) measureObserver.disconnect();
					if (longTaskObserver) longTaskObserver.disconnect();
					if (statusObserver) statusObserver.disconnect();
					if (handleClick)
						document.removeEventListener("click", handleClick, true);
					if (handleVisibilityChange) {
						document.removeEventListener(
							"visibilitychange",
							handleVisibilityChange,
						);
					}
					if (handleFocus) window.removeEventListener("focus", handleFocus);
					if (handleBlur) window.removeEventListener("blur", handleBlur);
					if (handleDomContentLoaded) {
						document.removeEventListener(
							"DOMContentLoaded",
							handleDomContentLoaded,
						);
					}
					if (clipboard && nativeWrite) {
						if (originalWriteDescriptor) {
							Object.defineProperty(
								clipboard,
								"write",
								originalWriteDescriptor,
							);
						} else {
							delete clipboard.write;
						}
					}
					if (listenersInstalled) listenersInstalled = false;
					if (typeof performance.clearMarks === "function") {
						performance.clearMarks(beginMarker);
						performance.clearMarks(clickMarker);
						performance.clearMarks(endMarker);
					}
				},
			};
		},
		{
			beginMarker: traceBeginMarker,
			clickMarker: traceClickMarker,
			copyTimingStageEntries: [...copyTimingStages.entries()],
			endMarker: traceEndMarker,
			timingDetailKindValues: [...timingDetailKinds],
			timingDetailModeValues: [...timingDetailModes],
			timingDetailTerminalValues: [...timingDetailTerminals],
		},
	);
}

async function startTracing(context, page) {
	const cdp = await context.newCDPSession(page);
	try {
		await cdp.send("Tracing.start", {
			categories:
				"devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing",
			streamCompression: "none",
			streamFormat: "json",
			transferMode: "ReturnAsStream",
		});
	} catch {
		await cdp.detach().catch(() => undefined);
		throw new Error("wechat-copy-performance-tracing-start-failed");
	}
	return cdp;
}

async function withDeadline(operation, failureCode, timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(failureCode)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function stopTracing(cdp) {
	let completeHandler;
	let streamHandle = null;
	let operationError = null;
	let cleanupError = null;
	let traceEvents = null;
	const complete = new Promise((resolveComplete) => {
		completeHandler = (payload) => resolveComplete(payload);
		cdp.on("Tracing.tracingComplete", completeHandler);
	});
	try {
		await cdp.send("Tracing.end");
		const payload = await withDeadline(
			complete,
			"wechat-copy-performance-tracing-complete-timeout",
			15_000,
		);
		if (
			payload.dataLossOccurred === true ||
			typeof payload.stream !== "string"
		) {
			throw new Error("wechat-copy-performance-tracing-stream-invalid");
		}
		streamHandle = payload.stream;
		let raw = "";
		let eof = false;
		while (!eof) {
			const chunk = await cdp.send("IO.read", { handle: streamHandle });
			if (typeof chunk.data !== "string") {
				throw new Error("wechat-copy-performance-tracing-data-invalid");
			}
			raw += chunk.base64Encoded
				? Buffer.from(chunk.data, "base64").toString("utf8")
				: chunk.data;
			eof = chunk.eof === true;
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error("wechat-copy-performance-tracing-json-invalid");
		}
		if (!Array.isArray(parsed?.traceEvents)) {
			throw new Error("wechat-copy-performance-tracing-events-unavailable");
		}
		traceEvents = parsed.traceEvents;
	} catch (error) {
		operationError = error;
		throw error;
	} finally {
		if (streamHandle) {
			try {
				await cdp.send("IO.close", { handle: streamHandle });
			} catch {
				if (!operationError) {
					cleanupError = new Error(
						"wechat-copy-performance-tracing-stream-close-failed",
					);
				}
			}
		}
		if (completeHandler) cdp.off("Tracing.tracingComplete", completeHandler);
		try {
			await cdp.detach();
		} catch {
			if (!operationError) {
				cleanupError ??= new Error(
					"wechat-copy-performance-tracing-detach-failed",
				);
			}
		}
	}
	if (!operationError && cleanupError) throw cleanupError;
	return traceEvents;
}

function readTraceMarker(events, marker) {
	const matches = events
		.filter((event) => event && typeof event === "object")
		.filter((event) => {
			const data = event.args?.data;
			return (
				event.name === marker || data?.name === marker || data?.label === marker
			);
		})
		.map((event) => ({
			atMs: Number(event.ts) / 1000,
			pid: event.pid,
			tid: event.tid,
		}))
		.filter(({ atMs }) => Number.isFinite(atMs));
	return matches.length > 0 ? matches[0] : null;
}

function traceExclusiveDuration(event, events) {
	const start = Number(event.ts) / 1000;
	const duration = Number(event.dur) / 1000;
	const end = start + duration;
	if (![start, duration, end].every(Number.isFinite) || duration <= 0) return 0;
	const children = events
		.filter((candidate) => candidate !== event)
		.filter((candidate) => candidate.ph === "X")
		.filter(
			(candidate) => candidate.pid === event.pid && candidate.tid === event.tid,
		)
		.map((candidate) => ({
			end: Number(candidate.ts) / 1000 + Number(candidate.dur) / 1000,
			start: Number(candidate.ts) / 1000,
		}))
		.filter((candidate) => candidate.start >= start && candidate.end <= end)
		.filter((candidate) => candidate.end > candidate.start)
		.sort((left, right) => left.start - right.start);
	let covered = 0;
	let coveredStart = null;
	let coveredEnd = null;
	for (const child of children) {
		if (coveredStart === null) {
			coveredStart = child.start;
			coveredEnd = child.end;
		} else if (child.start <= coveredEnd) {
			coveredEnd = Math.max(coveredEnd, child.end);
		} else {
			covered += coveredEnd - coveredStart;
			coveredStart = child.start;
			coveredEnd = child.end;
		}
	}
	if (coveredStart !== null) covered += coveredEnd - coveredStart;
	return Math.max(0, duration - Math.min(duration, covered));
}

function summarizeTrace(events) {
	const clickMarker = readTraceMarker(events, traceClickMarker);
	const endMarker = readTraceMarker(events, traceEndMarker);
	if (
		!clickMarker ||
		!endMarker ||
		!Number.isFinite(clickMarker.pid) ||
		!Number.isFinite(clickMarker.tid) ||
		clickMarker.pid !== endMarker.pid ||
		clickMarker.tid !== endMarker.tid ||
		endMarker.atMs < clickMarker.atMs
	) {
		return {
			earlyFunctionAttribution: "unverified",
			reason: "trace-marker-owner-unavailable",
			records: [],
			status: "unverified",
		};
	}
	const clickAt = clickMarker.atMs;
	const endAt = endMarker.atMs;
	const rendererEvents = events.filter(
		(event) =>
			event &&
			typeof event === "object" &&
			event.pid === clickMarker.pid &&
			event.tid === clickMarker.tid,
	);
	const userTimingEvents = rendererEvents.filter((event) => {
		const data = event.args?.data;
		const symbol =
			typeof data?.name === "string"
				? data.name
				: typeof data?.label === "string"
					? data.label
					: event.name;
		return copyTimingStages.has(symbol);
	});
	const userTimingHit = userTimingEvents.length > 0;
	const records = rendererEvents
		.filter((event) => event.ph === "X")
		.map((event) => {
			const data = event.args?.data;
			const symbol =
				typeof data?.name === "string"
					? data.name
					: typeof data?.label === "string"
						? data.label
						: event.name;
			const capabilityStage = copyTimingStages.get(symbol);
			const genericStage = genericTraceStageByName.get(event.name);
			const stage = capabilityStage ?? genericStage;
			const startMs = Number(event.ts) / 1000;
			const durationMs = Number(event.dur) / 1000;
			if (
				!stage ||
				!Number.isFinite(startMs) ||
				!Number.isFinite(durationMs) ||
				durationMs <= 0
			) {
				return null;
			}
			const finishMs = startMs + durationMs;
			const overlapStart = Math.max(startMs, clickAt);
			const overlapEnd = Math.min(finishMs, endAt);
			if (!(overlapEnd > overlapStart)) return null;
			return {
				durationMs,
				layoutCount: 0,
				offsetMs: startMs - clickAt,
				selfTimeMs: traceExclusiveDuration(event, events),
				stage,
				attribution: capabilityStage
					? "user-timing-capability"
					: "non-attributed",
			};
		})
		.filter(Boolean);
	if (records.length === 0) {
		return {
			earlyFunctionAttribution: "unverified",
			reason: userTimingHit
				? "user-timing-duration-unavailable"
				: "known-dtd-symbol-not-observed",
			records: [],
			status: userTimingHit ? "verified" : "unverified",
		};
	}
	return {
		earlyFunctionAttribution: "unverified",
		records,
		status: userTimingHit ? "verified" : "unverified",
	};
}

function overlapRecords(entries, startMs, endMs) {
	return entries
		.map((entry) => {
			const finishMs = entry.startMs + entry.durationMs;
			const overlapStart = Math.max(entry.startMs, startMs);
			const overlapEnd = Math.min(finishMs, endMs);
			if (!(overlapEnd > overlapStart)) return null;
			return {
				durationMs: entry.durationMs,
				overlapDurationMs: overlapEnd - overlapStart,
				overlapOffsetMs: overlapStart - startMs,
				startMs: entry.startMs,
				stage: "longtask",
			};
		})
		.filter(Boolean);
}

function summarizePageTiming(sample) {
	if (
		!Number.isFinite(sample.clickAt) ||
		!Number.isFinite(sample.endAt) ||
		sample.endAt < sample.clickAt
	) {
		throw new Error("wechat-copy-performance-page-interval-invalid");
	}
	if (sample.observerError) throw new Error(sample.observerError);
	if (sample.clicks.length !== 1)
		throw new Error("wechat-copy-performance-click-count-invalid");
	const writes = sample.writes;
	if (writes.length !== 1)
		throw new Error("wechat-copy-performance-native-write-count-invalid");
	const [write] = writes;
	if (
		write.nativeState !== "fulfilled" ||
		write.itemCount !== 1 ||
		write.activation !== true
	) {
		throw new Error("wechat-copy-performance-native-write-state-invalid");
	}
	const clickState = sample.clicks[0].owner;
	if (
		clickState.ownerDocumentMatches !== true ||
		clickState.defaultViewMatches !== true ||
		clickState.selfMatchesWindow !== true ||
		clickState.topMatchesSelf !== true ||
		clickState.documentHasFocus !== true ||
		clickState.visibilityState !== "visible"
	) {
		throw new Error("wechat-copy-performance-click-owner-state-invalid");
	}
	if (!sample.status.some(({ code }) => code === "success")) {
		throw new Error("wechat-copy-performance-success-status-unavailable");
	}
	if (
		!Number.isFinite(sample.statusSuccessAt) ||
		sample.statusSuccessAt > sample.endAt
	) {
		throw new Error("wechat-copy-performance-copy-terminal-invalid");
	}
	if (!Number.isFinite(write.settledAt)) {
		throw new Error("wechat-copy-performance-native-write-settlement-invalid");
	}
	if (sample.rafs.filter(({ index }) => index > 0).length < 3) {
		throw new Error("wechat-copy-performance-raf-sequence-incomplete");
	}
	if (!sample.rafs.some(({ index }) => index === 0)) {
		throw new Error("wechat-copy-performance-zero-delay-task-unavailable");
	}
	const longTasks = overlapRecords(
		sample.longTasks,
		sample.clickAt,
		sample.statusSuccessAt,
	);
	const measures = sample.measures.map((measure) => ({
		detail: measure.detail,
		durationMs: measure.durationMs,
		offsetMs: measure.startMs - sample.clickAt,
		stage: copyTimingStages.get(measure.name),
	}));
	if (measures.length === 0)
		throw new Error("wechat-copy-performance-measures-unavailable");
	if (measures.some(({ stage }) => !stage)) {
		throw new Error("wechat-copy-performance-measure-stage-invalid");
	}
	const earlyStages = sample.rafs.map(({ at, index }) => ({
		durationMs: 0,
		layoutCount: 0,
		offsetMs: at - sample.clickAt,
		selfTimeMs: 0,
		stage: index === 0 ? "task-zero-delay" : `raf-${index}`,
	}));
	return {
		longTasks,
		measures,
		clickOwner: sample.clicks[0].owner,
		copyTerminalAt: sample.statusSuccessAt,
		notifications: sample.status,
		ownerChanges: sample.ownerChanges,
		ownerChangeStages: sample.ownerChanges.map(({ at, type }) => ({
			durationMs: 0,
			layoutCount: 0,
			offsetMs: at - sample.clickAt,
			selfTimeMs: 0,
			stage: `owner-${type}`,
		})),
		pageInterval: {
			durationMs: sample.statusSuccessAt - sample.clickAt,
			layoutCount: 0,
			offsetMs: 0,
			selfTimeMs: 0,
			stage: "copy-interval",
		},
		earlyStages,
		write: {
			activation: write.activation,
			at: write.at,
			nativeState: write.nativeState,
			owner: write.owner,
			settledAt: write.settledAt,
		},
	};
}

function privateEvidenceDirectory() {
	const configured = process.env[evidenceDirectoryEnvironment]?.trim();
	if (!configured) {
		throw new Error("wechat-copy-performance-evidence-directory-required");
	}
	if (!isAbsolute(configured)) {
		throw new Error("wechat-copy-performance-evidence-directory-not-absolute");
	}
	const target = resolve(configured);
	const tempRoot = resolve(tmpdir());
	const relation = relative(tempRoot, target);
	if (
		!relation ||
		relation === ".." ||
		relation.startsWith(`..${sep}`) ||
		isAbsolute(relation)
	) {
		throw new Error("wechat-copy-performance-evidence-directory-outside-temp");
	}
	return { target, tempRoot };
}

async function writePrivateEvidence(testInfo, records) {
	const configured = privateEvidenceDirectory();
	await mkdir(configured.target, { mode: 0o700, recursive: true });
	const realTempRoot = await realpath(configured.tempRoot);
	const realTarget = await realpath(configured.target);
	const relation = relative(realTempRoot, realTarget);
	if (
		!relation ||
		relation === ".." ||
		relation.startsWith(`..${sep}`) ||
		isAbsolute(relation) ||
		!(await stat(realTarget)).isDirectory()
	) {
		throw new Error(
			"wechat-copy-performance-evidence-directory-realpath-invalid",
		);
	}
	await chmod(realTarget, 0o700);
	const filePath = join(
		realTarget,
		`wechat-copy-performance-${testInfo.workerIndex}-${randomUUID().slice(0, 8)}.json`,
	);
	await writeFile(filePath, `${JSON.stringify(records)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(filePath, 0o600);
}

function stableFailureCode(error) {
	const message = error instanceof Error ? error.message : "";
	if (/^wechat-copy-performance-[a-z0-9-]+$/u.test(message)) return message;
	if (/timeout/iu.test(message)) return "wechat-copy-performance-timeout";
	return "wechat-copy-performance-assertion-failed";
}

async function readFailureSnapshot(page) {
	if (page.isClosed()) return { pageState: "closed" };
	try {
		return await page.evaluate(() => {
			const probe = globalThis.__easymdeWechatCopyPerformance;
			const state = probe?.getState?.();
			if (!state) return { pageState: "probe-unavailable" };
			return {
				clickCount: state.clickCount,
				ownerChanges: state.ownerChanges.map(
					({ at, state: ownerState, type }) => ({
						at,
						state: ownerState,
						type,
					}),
				),
				status: state.status.map(({ at, code }) => ({ at, code })),
				writeCount: state.writeCount,
				writes: state.writes.map(
					({ activation, at, nativeState, owner, settledAt }) => ({
						activation,
						at,
						nativeState,
						owner,
						settledAt,
					}),
				),
			};
		});
	} catch {
		return { pageState: "snapshot-unavailable" };
	}
}

function unavailableUploadFacts() {
	return {
		clock: "page-performance-upload-failure-facts",
		observedCount: 0,
		peakInFlight: 0,
		unsettledCount: 0,
		uploads: [],
		state: "unavailable",
	};
}

async function writeFailureSnapshot(
	testInfo,
	page,
	stage,
	code,
	uploadTimeline = null,
	uploadSnapshot = null,
) {
	await writePrivateEvidence(testInfo, {
		failure: {
			code,
			snapshot: await readFailureSnapshot(page),
			stage,
			uploadFacts:
				uploadSnapshot ??
				uploadTimeline?.failureFacts?.() ??
				unavailableUploadFacts(),
		},
	});
	testInfo.wechatPerformanceFailureSnapshotWritten = true;
}

async function waitForCopySuccess(page, testInfo, uploadTimeline = null) {
	let snapshotWritten = false;
	let snapshotError = false;
	let terminalCode = "pending";
	try {
		await expect
			.poll(
				async () => {
					const stateCode = await page.evaluate(() => {
						const probe = globalThis.__easymdeWechatCopyPerformance;
						const current = probe?.getState?.();
						if (!current) return "missing";
						if (current.status.some(({ code }) => code === "failed"))
							return "failed";
						if (current.status.some(({ code }) => code === "success"))
							return "success";
						return "pending";
					});
					terminalCode = stateCode;
					if (terminalCode === "failed" && !snapshotWritten) {
						try {
							await writeFailureSnapshot(
								testInfo,
								page,
								"copy-terminal",
								"wechat-copy-performance-copy-failed",
								uploadTimeline,
							);
						} catch {
							snapshotError = true;
						} finally {
							snapshotWritten = true;
						}
					}
					return terminalCode;
				},
				{ timeout: 120_000 },
			)
			.toMatch(/^(?:success|failed)$/u);
	} catch {
		if (!snapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"copy-terminal",
					terminalCode === "failed"
						? "wechat-copy-performance-copy-failed"
						: "wechat-copy-performance-copy-timeout",
					uploadTimeline,
				);
			} catch {
				snapshotError = true;
			} finally {
				snapshotWritten = true;
			}
		}
		throw new Error(
			snapshotError
				? "wechat-copy-performance-failure-snapshot-unavailable"
				: terminalCode === "failed"
					? "wechat-copy-performance-copy-failed"
					: "wechat-copy-performance-copy-timeout",
		);
	}
	if (terminalCode === "failed") {
		throw new Error(
			snapshotError
				? "wechat-copy-performance-failure-snapshot-unavailable"
				: "wechat-copy-performance-copy-failed",
		);
	}
}

async function waitForNativeWriteFulfilled(
	page,
	testInfo,
	uploadTimeline = null,
) {
	let snapshotWritten = false;
	let terminalCode = "pending";
	try {
		await expect
			.poll(
				async () => {
					const state = await page.evaluate(() => {
						const current =
							globalThis.__easymdeWechatCopyPerformance?.getState?.();
						return current?.writes[0]?.nativeState ?? "pending";
					});
					terminalCode = state;
					if (state === "rejected" && !snapshotWritten) {
						try {
							await writeFailureSnapshot(
								testInfo,
								page,
								"native-write",
								"wechat-copy-performance-native-write-rejected",
								uploadTimeline,
							);
						} finally {
							snapshotWritten = true;
						}
					}
					return state;
				},
				{ timeout: 10_000 },
			)
			.toBe("fulfilled");
	} catch {
		if (!snapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"native-write",
					terminalCode === "rejected"
						? "wechat-copy-performance-native-write-rejected"
						: "wechat-copy-performance-native-write-timeout",
					uploadTimeline,
				);
			} finally {
				snapshotWritten = true;
			}
		}
		throw new Error(
			terminalCode === "rejected"
				? "wechat-copy-performance-native-write-rejected"
				: "wechat-copy-performance-native-write-timeout",
		);
	}
}

async function readClipboardShape(page) {
	return page.evaluate(async () => {
		if (
			!navigator.clipboard ||
			typeof navigator.clipboard.read !== "function"
		) {
			throw new Error(
				"wechat-copy-performance-native-clipboard-read-unavailable",
			);
		}
		const items = await navigator.clipboard.read();
		const typeCounts = items.map((item) =>
			Array.isArray(item.types) ? item.types.length : 0,
		);
		return { itemCount: items.length, typeCounts };
	});
}

function matchesUploadTarget(target) {
	try {
		return (
			target.method() === "POST" &&
			new URL(target.url()).pathname.endsWith(uploadPathSuffix)
		);
	} catch {
		return false;
	}
}

function readRequestTiming(request) {
	try {
		const timing = request.timing();
		return timing && typeof timing === "object" ? timing : null;
	} catch {
		return null;
	}
}

function timingEpoch(timing, key) {
	if (
		!timing ||
		!Number.isFinite(timing.startTime) ||
		timing.startTime <= 0 ||
		!Number.isFinite(timing[key]) ||
		timing[key] < 0
	)
		return null;
	return timing.startTime + timing[key];
}

function createUploadTimeline(page) {
	const records = new Map();
	let nextOrdinal = 1;
	let inFlight = 0;
	let peakInFlight = 0;
	let stopped = false;
	const updateRecordTiming = (record, request) => {
		const timing = readRequestTiming(request);
		const startEpoch = timingEpoch(timing, "requestStart");
		const responseEpoch = timingEpoch(timing, "responseStart");
		const settleEpoch = timingEpoch(timing, "responseEnd");
		if (record.startEpoch === null && startEpoch !== null)
			record.startEpoch = startEpoch;
		if (record.responseEpoch === null && responseEpoch !== null)
			record.responseEpoch = responseEpoch;
		return settleEpoch;
	};

	const onRequest = (request) => {
		if (!matchesUploadTarget(request) || records.has(request)) return;
		const record = {
			ordinal: nextOrdinal++,
			startEpoch: null,
			responseEpoch: null,
			settleEpoch: null,
			status: null,
			terminal: "pending",
		};
		records.set(request, record);
		updateRecordTiming(record, request);
		inFlight += 1;
		peakInFlight = Math.max(peakInFlight, inFlight);
	};

	const onResponse = (response) => {
		const request = response.request();
		const record = records.get(request);
		if (!record) return;
		updateRecordTiming(record, request);
		const status = response.status();
		if (Number.isInteger(status)) record.status = status;
	};

	const finalize = (request, terminal) => {
		const record = records.get(request);
		if (record?.terminal !== "pending") return;
		const settleEpoch = updateRecordTiming(record, request);
		if (settleEpoch !== null) record.settleEpoch = settleEpoch;
		record.terminal = terminal;
		inFlight = Math.max(0, inFlight - 1);
	};

	const onRequestFinished = (request) => finalize(request, "finished");
	const onRequestFailed = (request) => finalize(request, "failed");

	page.on("request", onRequest);
	page.on("response", onResponse);
	page.on("requestfinished", onRequestFinished);
	page.on("requestfailed", onRequestFailed);

	return {
		failureFacts() {
			return {
				clock: "page-performance-upload-failure-facts",
				observedCount: records.size,
				peakInFlight,
				unsettledCount: inFlight,
				uploads: [...records.values()]
					.sort((left, right) => left.ordinal - right.ordinal)
					.map((record) => ({
						ordinal: record.ordinal,
						startAvailable: record.startEpoch !== null,
						firstByteAvailable: record.responseEpoch !== null,
						settleAvailable: record.settleEpoch !== null,
						status: record.status,
						terminal: record.terminal,
					})),
			};
		},
		async snapshot(pageSample) {
			const pageTimeOrigin = await page.evaluate(() => performance.timeOrigin);
			if (!Number.isFinite(pageTimeOrigin)) {
				throw new Error("wechat-copy-performance-upload-clock-unavailable");
			}
			if (
				!Number.isFinite(pageSample.clickAt) ||
				!Number.isFinite(pageSample.statusSuccessAt) ||
				pageSample.statusSuccessAt < pageSample.clickAt
			) {
				throw new Error("wechat-copy-performance-upload-copy-window-invalid");
			}
			const toOffset = (epoch) =>
				epoch === null ? null : epoch - pageTimeOrigin - pageSample.clickAt;
			return {
				clock: "page-performance-offset-from-copy-click",
				copyWindowDurationMs: pageSample.statusSuccessAt - pageSample.clickAt,
				peakInFlight,
				unsettledCount: inFlight,
				uploads: [...records.values()]
					.sort((left, right) => left.ordinal - right.ordinal)
					.map((record) => {
						const startMs = toOffset(record.startEpoch);
						const firstByteMs = toOffset(record.responseEpoch);
						const settleMs = toOffset(record.settleEpoch);
						return {
							ordinal: record.ordinal,
							startMs,
							firstByteMs,
							settleMs,
							durationMs:
								startMs !== null && settleMs !== null
									? settleMs - startMs
									: null,
							status: record.status,
							terminal: record.terminal,
							peakInFlight,
							timing: [startMs, firstByteMs, settleMs].every(Number.isFinite)
								? "available"
								: "unavailable",
						};
					}),
			};
		},
		stop() {
			if (stopped) return;
			stopped = true;
			page.off("request", onRequest);
			page.off("response", onResponse);
			page.off("requestfinished", onRequestFinished);
			page.off("requestfailed", onRequestFailed);
		},
	};
}

function summarizeUploadTimeline(timeline) {
	if (timeline?.clock !== "page-performance-offset-from-copy-click")
		throw new Error("wechat-copy-performance-upload-clock-invalid");
	if (!Number.isFinite(timeline.copyWindowDurationMs))
		throw new Error("wechat-copy-performance-upload-copy-window-invalid");
	if (!Number.isInteger(timeline.peakInFlight) || timeline.peakInFlight < 1)
		throw new Error("wechat-copy-performance-r2-upload-unobserved");
	if (!Array.isArray(timeline.uploads) || timeline.uploads.length < 1)
		throw new Error("wechat-copy-performance-r2-upload-unobserved");
	if (timeline.unsettledCount !== 0)
		throw new Error("wechat-copy-performance-r2-upload-unsettled");
	const ordinals = timeline.uploads.map(({ ordinal }) => ordinal);
	if (
		ordinals.some((ordinal, index) => ordinal !== index + 1) ||
		new Set(ordinals).size !== ordinals.length
	)
		throw new Error("wechat-copy-performance-r2-upload-ordinal-invalid");
	for (const upload of timeline.uploads) {
		if (upload.timing !== "available")
			throw new Error("wechat-copy-performance-upload-timing-unavailable");
		if (
			upload.terminal !== "finished" ||
			!Number.isFinite(upload.startMs) ||
			!Number.isFinite(upload.firstByteMs) ||
			!Number.isFinite(upload.settleMs) ||
			!Number.isFinite(upload.durationMs) ||
			!Number.isInteger(upload.status) ||
			!Number.isInteger(upload.peakInFlight)
		)
			throw new Error("wechat-copy-performance-r2-upload-timing-invalid");
		if (
			upload.startMs < 0 ||
			upload.firstByteMs < upload.startMs ||
			upload.settleMs < upload.firstByteMs ||
			upload.settleMs > timeline.copyWindowDurationMs ||
			Math.abs(upload.durationMs - (upload.settleMs - upload.startMs)) > 0.001
		)
			throw new Error("wechat-copy-performance-r2-upload-window-invalid");
		if (upload.status < 200 || upload.status >= 300)
			throw new Error("wechat-copy-performance-r2-upload-http-failed");
	}
	return timeline;
}

async function writePrivateArtifact(testInfo, stem, bytes, extension = "png") {
	const configured = privateEvidenceDirectory();
	await mkdir(configured.target, { mode: 0o700, recursive: true });
	const realTempRoot = await realpath(configured.tempRoot);
	const realTarget = await realpath(configured.target);
	const relation = relative(realTempRoot, realTarget);
	if (
		!relation ||
		relation === ".." ||
		relation.startsWith(`..${sep}`) ||
		isAbsolute(relation) ||
		!(await stat(realTarget)).isDirectory()
	) {
		throw new Error("wechat-copy-candidate-evidence-directory-invalid");
	}
	await chmod(realTarget, 0o700);
	const fileName = `wechat-copy-candidate-${testInfo.workerIndex}-${stem}-${randomUUID().slice(0, 8)}.${extension}`;
	const filePath = join(realTarget, fileName);
	await writeFile(filePath, bytes, { mode: 0o600 });
	await chmod(filePath, 0o600);
	return fileName;
}

async function readCandidateSourceFingerprint(page) {
	return page.evaluate(async () => {
		const digest = async (value) => {
			const bytes = new TextEncoder().encode(value);
			const hash = await crypto.subtle.digest("SHA-256", bytes);
			return [...new Uint8Array(hash)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		};
		const source = document.querySelector("#easymde-source");
		if (!(source instanceof HTMLTextAreaElement)) {
			throw new Error("wechat-copy-candidate-source-unavailable");
		}
		const metadataIds = [
			"#easymde-enabled-field",
			"#easymde-markdown-theme-field",
			"#easymde-code-theme-field",
			"#easymde-code-theme-explicit-field",
		];
		const metadata = {};
		for (const selector of metadataIds) {
			const field = document.querySelector(selector);
			if (!(field instanceof HTMLInputElement)) {
				throw new Error("wechat-copy-candidate-source-metadata-unavailable");
			}
			metadata[selector] = {
				length: field.value.length,
				sha256: await digest(field.value),
			};
		}
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		if (!(preview instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-preview-sink-unavailable");
		}
		const previewStyle = getComputedStyle(preview);
		const contentWidth =
			preview.getBoundingClientRect().width -
			Number.parseFloat(previewStyle.borderLeftWidth) -
			Number.parseFloat(previewStyle.borderRightWidth) -
			Number.parseFloat(previewStyle.paddingLeft) -
			Number.parseFloat(previewStyle.paddingRight);
		if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
			throw new Error("wechat-copy-candidate-preview-content-width-invalid");
		}
		return {
			markdown: {
				length: source.value.length,
				sha256: await digest(source.value),
			},
			metadata,
			preview: {
				contentWidth,
				formControlCount: preview.querySelectorAll(
					"input,select,textarea,button,form",
				).length,
				inputChecked: [
					...preview.querySelectorAll('input[type="checkbox"]'),
				].map((input) => input.checked),
				markupSha256: await digest(preview.innerHTML),
				sinkSignature: {
					className: preview.className,
					dataDocumentOwner: preview.getAttribute(
						"data-easymde-document-owner",
					),
					dataEditorOwner: preview.getAttribute("data-easymde-editor-owner"),
					dataLayoutOwner: preview.getAttribute("data-easymde-layout-owner"),
					dataPreviewHtmlSink: preview.getAttribute(
						"data-easymde-preview-html-sink",
					),
					tagName: preview.tagName,
				},
			},
		};
	});
}

async function readCandidateSourceH3Ordinal(page) {
	return page.evaluate((selector) => {
		const root = document.querySelector(selector);
		const marker = root?.querySelector('input[type="checkbox"]');
		const task = marker?.closest("li");
		const h3s = root ? [...root.querySelectorAll("h3")] : [];
		if (!(root instanceof HTMLElement) || !(task instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-source-h3-task-unavailable");
		}
		const h3 = h3s
			.filter(
				(candidate) =>
					(candidate.compareDocumentPosition(task) &
						Node.DOCUMENT_POSITION_FOLLOWING) !==
					0,
			)
			.at(-1);
		const ordinal = h3 ? h3s.indexOf(h3) + 1 : 0;
		if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
			throw new Error("wechat-copy-candidate-source-h3-ordinal-unavailable");
		}
		return { h3Count: h3s.length, ordinal };
	}, previewSelector);
}

async function readCandidateSourceH3Sample(page, ordinal) {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
		throw new Error("wechat-copy-candidate-source-h3-ordinal-invalid");
	}
	return page.evaluate(
		(selection) => {
			const { ordinal, selector } = selection;
			const root = document.querySelector(selector);
			const canvas = document.querySelector(
				".easymde-immersive-preview-canvas",
			);
			if (!(root instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-source-h3-root-unavailable");
			}
			if (!(canvas instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-source-h3-canvas-unavailable");
			}
			const h3s = [...root.querySelectorAll("h3")];
			const h3 = h3s[ordinal - 1];
			if (!(h3 instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-source-h3-sample-unavailable");
			}
			const finiteRect = (value, code) => {
				const rect = value.getBoundingClientRect();
				const result = {
					height: rect.height,
					left: rect.left,
					top: rect.top,
					width: rect.width,
				};
				if (
					Object.values(result).some((entry) => !Number.isFinite(entry)) ||
					result.width <= 0 ||
					result.height <= 0
				) {
					throw new Error(code);
				}
				return result;
			};
			const finiteLength = (value, code) => {
				const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(value.trim());
				if (!match) throw new Error(code);
				const parsed = Number(match[1]);
				if (!Number.isFinite(parsed)) throw new Error(code);
				return parsed;
			};
			const cssLength = (value, code) => {
				const normalized = value.trim();
				const keywordValues = ["auto", "none", "normal"];
				if (keywordValues.includes(normalized)) {
					return { kind: "keyword", value: normalized };
				}
				const match =
					/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%|em|rem|vw|vh|vmin|vmax|ch|ex)$/u.exec(
						normalized,
					);
				if (!match) throw new Error(code);
				return {
					kind: "length",
					unit: match[2],
					value: Number(match[1]),
				};
			};
			const alpha = (value) => {
				if (value === "transparent") return 0;
				const match = value.match(/^rgba?\((.*)\)$/u);
				if (!match) return null;
				const parts = match[1].split(/[\s,/]+/u).filter(Boolean);
				if (parts.length === 3) return 1;
				if (parts.length !== 4) return null;
				const parsed = Number.parseFloat(parts[3]);
				return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
					? parsed
					: null;
			};
			const transformKind = (value) => {
				if (value === "none") return "none";
				if (value.startsWith("matrix3d(")) return "matrix3d";
				if (value.startsWith("matrix(")) return "matrix";
				return "other";
			};
			const rootRect = finiteRect(
				root,
				"wechat-copy-candidate-source-h3-root-geometry-invalid",
			);
			const rootStyle = getComputedStyle(root);
			const rootPadding = {
				bottom: finiteLength(
					rootStyle.paddingBottom,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
				left: finiteLength(
					rootStyle.paddingLeft,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
				right: finiteLength(
					rootStyle.paddingRight,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
				top: finiteLength(
					rootStyle.paddingTop,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
			};
			const rootContentOrigin = {
				left:
					rootRect.left +
					finiteLength(
						rootStyle.borderLeftWidth,
						"wechat-copy-candidate-source-h3-root-border-invalid",
					) +
					rootPadding.left,
				top:
					rootRect.top +
					finiteLength(
						rootStyle.borderTopWidth,
						"wechat-copy-candidate-source-h3-root-border-invalid",
					) +
					rootPadding.top,
			};
			const beforeStyle = getComputedStyle(h3, "::before");
			const beforeBackgroundAlpha = alpha(beforeStyle.backgroundColor);
			const before = {
				backgroundAlpha: beforeBackgroundAlpha,
				height: cssLength(
					beforeStyle.height,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
				left: cssLength(
					beforeStyle.left,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
				top: cssLength(
					beforeStyle.top,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
				measurement: "computed-style-only",
				transform: transformKind(beforeStyle.transform),
				width: cssLength(
					beforeStyle.width,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
			};
			if (!Number.isFinite(beforeBackgroundAlpha)) {
				throw new Error("wechat-copy-candidate-source-h3-before-alpha-invalid");
			}
			const range = document.createRange();
			range.selectNodeContents(h3);
			const textRange = finiteRect(
				range,
				"wechat-copy-candidate-source-h3-text-range-invalid",
			);
			const canvasRect = finiteRect(
				canvas,
				"wechat-copy-candidate-source-h3-canvas-geometry-invalid",
			);
			const h3Rect = finiteRect(
				h3,
				"wechat-copy-candidate-source-h3-geometry-invalid",
			);
			const visibleWidth =
				Math.min(
					h3Rect.left + h3Rect.width,
					canvasRect.left + canvasRect.width,
				) - Math.max(h3Rect.left, canvasRect.left);
			const visibleHeight =
				Math.min(
					h3Rect.top + h3Rect.height,
					canvasRect.top + canvasRect.height,
				) - Math.max(h3Rect.top, canvasRect.top);
			if (
				!Number.isFinite(visibleWidth) ||
				!Number.isFinite(visibleHeight) ||
				visibleWidth <= 0 ||
				visibleHeight <= 0
			) {
				throw new Error("wechat-copy-candidate-source-h3-not-visible");
			}
			return {
				before,
				h3Count: h3s.length,
				h3Rect,
				ordinal,
				rootContentOrigin,
				rootPadding,
				status: "available",
				textRangeKind: "h3-contents-range",
				textRange,
				viewportIntersection: { height: visibleHeight, width: visibleWidth },
			};
		},
		{ ordinal, selector: previewSelector },
	);
}

async function startCandidateSourceDiagnostic(page) {
	await page.evaluate(() => {
		const nativeSource = document.querySelector("#easymde-source");
		const cmContent = document.querySelector(
			".easymde-source-react .cm-content",
		);
		const cmScroller = document.querySelector(
			".easymde-source-react .cm-scroller",
		);
		const previewCanvas = document.querySelector(
			".easymde-immersive-preview-canvas",
		);
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		const metadataFields = [
			...document.querySelectorAll(
				"#easymde-enabled-field,#easymde-markdown-theme-field," +
					"#easymde-code-theme-field,#easymde-code-theme-explicit-field",
			),
		];
		if (
			!(nativeSource instanceof HTMLElement) ||
			!(cmContent instanceof HTMLElement) ||
			!(cmScroller instanceof HTMLElement) ||
			!(previewCanvas instanceof HTMLElement) ||
			!(preview instanceof HTMLElement) ||
			metadataFields.length !== 4 ||
			metadataFields.some((field) => !(field instanceof HTMLElement))
		) {
			throw new Error(
				"wechat-copy-candidate-source-diagnostic-target-unavailable",
			);
		}
		const mutationTypeNames = ["attributes", "characterData", "childList"];
		const eventTypeNames = ["input", "beforeinput", "change"];
		const makeMutationBucket = (fixedType) => ({
			addedNodes: 0,
			cmLineGapBuckets: {
				0: 0,
				"1-3": 0,
				"4-15": 0,
				"16-plus": 0,
				unavailable: 0,
			},
			fixedType,
			mutationTypeCounts: {
				attributes: 0,
				characterData: 0,
				childList: 0,
				other: 0,
			},
			removedNodes: 0,
			total: 0,
		});
		const makeEventBucket = () => ({
			beforeinput: 0,
			change: 0,
			input: 0,
		});
		const state = {
			events: {
				cmPresentation: makeEventBucket(),
				nativeSubmission: makeEventBucket(),
			},
			mutations: {
				cmPresentation: makeMutationBucket("cm-presentation"),
				metadata: makeMutationBucket("metadata"),
				nativeSubmission: makeMutationBucket("native-submission"),
				preview: makeMutationBucket("preview"),
			},
		};
		const observers = [];
		const listeners = [];
		const bucketFor = (owner) => state.mutations[owner];
		const cmLineGapBucket = () => {
			const lineRects = [...cmContent.querySelectorAll(".cm-line")]
				.map((line) => line.getBoundingClientRect())
				.filter(
					(rect) =>
						Number.isFinite(rect.top) &&
						Number.isFinite(rect.height) &&
						rect.height > 0,
				)
				.sort((left, right) => left.top - right.top);
			if (lineRects.length < 2) return "unavailable";
			const lineHeight = lineRects[0].height;
			let maximumGap = 0;
			for (let index = 1; index < lineRects.length; index += 1) {
				const gap = Math.max(
					0,
					Math.round(
						(lineRects[index].top - lineRects[index - 1].top) / lineHeight,
					) - 1,
				);
				maximumGap = Math.max(maximumGap, gap);
			}
			if (maximumGap === 0) return "0";
			if (maximumGap <= 3) return "1-3";
			if (maximumGap <= 15) return "4-15";
			return "16-plus";
		};
		const collectRecords = (owner, records) => {
			const bucket = bucketFor(owner);
			for (const record of records) {
				const mutationType = mutationTypeNames.includes(record.type)
					? record.type
					: "other";
				bucket.mutationTypeCounts[mutationType] += 1;
				bucket.total += 1;
				bucket.addedNodes += record.addedNodes?.length ?? 0;
				bucket.removedNodes += record.removedNodes?.length ?? 0;
				if (owner === "cmPresentation") {
					const gapBucket =
						record.type === "childList" ? cmLineGapBucket() : "unavailable";
					bucket.cmLineGapBuckets[gapBucket] += 1;
				}
			}
		};
		const watch = (node, owner) => {
			const observer = new MutationObserver((records) =>
				collectRecords(owner, records),
			);
			observer.observe(node, {
				attributes: true,
				characterData: true,
				childList: true,
				subtree: true,
			});
			observers.push({ observer, owner });
		};
		watch(nativeSource, "nativeSubmission");
		watch(cmContent, "cmPresentation");
		watch(preview, "preview");
		for (const field of metadataFields) watch(field, "metadata");
		const watchEvents = (node, owner) => {
			for (const type of eventTypeNames) {
				const listener = () => {
					state.events[owner][type] += 1;
				};
				node.addEventListener(type, listener, {
					capture: true,
					passive: true,
				});
				listeners.push({ listener, node, type });
			}
		};
		watchEvents(nativeSource, "nativeSubmission");
		watchEvents(cmContent, "cmPresentation");
		const consumePending = () => {
			for (const { observer, owner } of observers) {
				collectRecords(owner, observer.takeRecords());
			}
		};
		const readScroller = (element) => ({
			clientHeight: element.clientHeight,
			clientWidth: element.clientWidth,
			scrollHeight: element.scrollHeight,
			scrollLeft: element.scrollLeft,
			scrollTop: element.scrollTop,
			scrollWidth: element.scrollWidth,
		});
		const read = () => {
			consumePending();
			const scrollers = {
				cm: readScroller(cmScroller),
				preview: readScroller(previewCanvas),
			};
			if (
				Object.values(scrollers).some((scroller) =>
					Object.values(scroller).some((value) => !Number.isFinite(value)),
				)
			) {
				throw new Error(
					"wechat-copy-candidate-source-diagnostic-scroller-invalid",
				);
			}
			return {
				events: {
					cmPresentation: { ...state.events.cmPresentation },
					nativeSubmission: { ...state.events.nativeSubmission },
				},
				mutations: {
					cmPresentation: {
						...state.mutations.cmPresentation,
						cmLineGapBuckets: {
							...state.mutations.cmPresentation.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.cmPresentation.mutationTypeCounts,
						},
					},
					nativeSubmission: {
						...state.mutations.nativeSubmission,
						cmLineGapBuckets: {
							...state.mutations.nativeSubmission.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.nativeSubmission.mutationTypeCounts,
						},
					},
					metadata: {
						...state.mutations.metadata,
						cmLineGapBuckets: {
							...state.mutations.metadata.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.metadata.mutationTypeCounts,
						},
					},
					preview: {
						...state.mutations.preview,
						cmLineGapBuckets: {
							...state.mutations.preview.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.preview.mutationTypeCounts,
						},
					},
				},
				cmLineCount: cmContent.querySelectorAll(".cm-line").length,
				scrollers,
				window: {
					left: window.scrollX,
					top: window.scrollY,
				},
			};
		};
		globalThis.__easymdeWechatCopySourceDiagnostic = {
			read,
			stop() {
				consumePending();
				for (const { observer } of observers) observer.disconnect();
				for (const { listener, node, type } of listeners) {
					node.removeEventListener(type, listener, { capture: true });
				}
				delete globalThis.__easymdeWechatCopySourceDiagnostic;
			},
		};
	});
}

async function readCandidateSourceDiagnostic(page) {
	return page.evaluate(() => {
		const diagnostic = globalThis.__easymdeWechatCopySourceDiagnostic;
		if (!diagnostic)
			throw new Error("wechat-copy-candidate-source-diagnostic-unavailable");
		return diagnostic.read();
	});
}

async function stopCandidateSourceDiagnostic(page) {
	await page.evaluate(() =>
		globalThis.__easymdeWechatCopySourceDiagnostic?.stop(),
	);
}

async function readCandidateSourcePhase(page, phase) {
	const fingerprint = await readCandidateSourceFingerprint(page);
	const diagnostic = await readCandidateSourceDiagnostic(page);
	return { diagnostic, fingerprint, phase };
}

function candidateMutationDelta(before, after, owner) {
	const beforeTotal = before?.mutations?.[owner]?.total;
	const afterTotal = after?.mutations?.[owner]?.total;
	if (
		!Number.isSafeInteger(beforeTotal) ||
		!Number.isSafeInteger(afterTotal) ||
		afterTotal < beforeTotal
	) {
		throw new Error("wechat-copy-candidate-source-diagnostic-nonmonotonic");
	}
	return afterTotal - beforeTotal;
}

function assertCandidateCopyCMDelta(before, after) {
	const delta = candidateMutationDelta(before, after, "cmPresentation");
	if (delta !== 0) {
		throw new Error("wechat-copy-candidate-late-cm-mutation");
	}
	return delta;
}

function assertCandidateRestorePeer(diagnostic, expected) {
	if (
		diagnostic?.scrollers?.cm?.scrollLeft !== expected?.cmLeft ||
		diagnostic?.scrollers?.cm?.scrollTop !== expected?.cmTop ||
		diagnostic?.scrollers?.preview?.scrollLeft !== expected?.previewLeft ||
		diagnostic?.scrollers?.preview?.scrollTop !== expected?.previewTop ||
		diagnostic?.window?.left !== expected?.windowLeft ||
		diagnostic?.window?.top !== expected?.windowTop
	) {
		throw new Error("wechat-copy-candidate-source-restore-peer-mismatch");
	}
}

async function restoreCandidateSourceDiagnosticScroll(page, diagnostic) {
	const expected = {
		cmLeft: diagnostic?.scrollers?.cm?.scrollLeft,
		cmTop: diagnostic?.scrollers?.cm?.scrollTop,
		previewLeft: diagnostic?.scrollers?.preview?.scrollLeft,
		previewTop: diagnostic?.scrollers?.preview?.scrollTop,
		windowLeft: diagnostic?.window?.left,
		windowTop: diagnostic?.window?.top,
	};
	if (Object.values(expected).some((value) => !Number.isFinite(value))) {
		throw new Error("wechat-copy-candidate-source-scroll-baseline-invalid");
	}
	await page.evaluate((expected) => {
		const cm = document.querySelector(".easymde-source-react .cm-scroller");
		const preview = document.querySelector(".easymde-immersive-preview-canvas");
		if (!(cm instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-source-scroll-owner-unavailable");
		}
		cm.scrollLeft = expected.cmLeft;
		cm.scrollTop = expected.cmTop;
		preview.scrollLeft = expected.previewLeft;
		preview.scrollTop = expected.previewTop;
		window.scrollTo(expected.windowLeft, expected.windowTop);
	}, expected);
	const restored = await readCandidateSourceDiagnostic(page);
	assertCandidateRestorePeer(restored, expected);
	return { expected, restored };
}

function assertCandidateSourceTaskFingerprints(tasks, expected) {
	if (!Array.isArray(tasks) || tasks.length !== 19) {
		throw new Error(
			"wechat-copy-candidate-source-task-fingerprint-count-invalid",
		);
	}
	const expectedSerialized = JSON.stringify(expected);
	for (const task of tasks) {
		if (JSON.stringify(task?.fingerprint) !== expectedSerialized) {
			throw new Error("wechat-copy-candidate-source-task-fingerprint-changed");
		}
	}
}

function assertCandidateSourceFingerprintEqual(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error("wechat-copy-candidate-source-fingerprint-changed");
	}
}

function assertCandidateSourceBaseline(diagnostic) {
	for (const owner of ["nativeSubmission", "metadata", "preview"]) {
		if (diagnostic?.mutations?.[owner]?.total !== 0) {
			const codeOwner =
				owner === "nativeSubmission" ? "native-submission" : owner;
			throw new Error(`wechat-copy-candidate-${codeOwner}-mutation-detected`);
		}
	}
	for (const owner of ["nativeSubmission", "cmPresentation"]) {
		const events = diagnostic?.events?.[owner];
		if (!events || Object.values(events).some((count) => count !== 0)) {
			throw new Error("wechat-copy-candidate-source-input-event-detected");
		}
	}
}

async function waitForCandidateSourceStability(page, expected) {
	return page.evaluate(async (expected) => {
		const diagnostic = globalThis.__easymdeWechatCopySourceDiagnostic;
		if (!diagnostic) {
			throw new Error("wechat-copy-candidate-source-diagnostic-unavailable");
		}
		const frameLimit = 12;
		const requiredStableFrames = 3;
		const frames = [];
		let previous = null;
		let stableFrames = 0;
		const positionsEqual = (left, right) =>
			left.cmLeft === right.cmLeft &&
			left.cmTop === right.cmTop &&
			left.previewLeft === right.previewLeft &&
			left.previewTop === right.previewTop &&
			left.windowLeft === right.windowLeft &&
			left.windowTop === right.windowTop;
		const positionsMatchExpected = (positions) =>
			positions.cmLeft === expected.cmLeft &&
			positions.cmTop === expected.cmTop &&
			positions.previewLeft === expected.previewLeft &&
			positions.previewTop === expected.previewTop &&
			positions.windowLeft === expected.windowLeft &&
			positions.windowTop === expected.windowTop;
		for (let frame = 0; frame < frameLimit; frame += 1) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const sample = diagnostic.read();
			const positions = {
				cmLeft: sample.scrollers.cm.scrollLeft,
				cmTop: sample.scrollers.cm.scrollTop,
				previewLeft: sample.scrollers.preview.scrollLeft,
				previewTop: sample.scrollers.preview.scrollTop,
				windowLeft: sample.window.left,
				windowTop: sample.window.top,
			};
			if (
				Object.values(positions).some((value) => !Number.isFinite(value)) ||
				!Number.isSafeInteger(sample.cmLineCount) ||
				!Number.isSafeInteger(sample.mutations.cmPresentation.total) ||
				!positionsMatchExpected(positions)
			) {
				throw new Error(
					"wechat-copy-candidate-source-stability-position-invalid",
				);
			}
			const current = {
				cmLineCount: sample.cmLineCount,
				cmPresentationTotal: sample.mutations.cmPresentation.total,
				positions,
			};
			if (
				previous &&
				previous.cmLineCount === current.cmLineCount &&
				previous.cmPresentationTotal === current.cmPresentationTotal &&
				positionsEqual(previous.positions, current.positions)
			) {
				stableFrames += 1;
			} else {
				stableFrames = 1;
			}
			frames.push({ frame, ...current });
			previous = current;
			if (stableFrames >= requiredStableFrames) {
				return {
					frames: frames.slice(-requiredStableFrames),
					stableFrames,
				};
			}
		}
		throw new Error("wechat-copy-candidate-source-stability-timeout");
	}, expected);
}

async function captureCandidateTaskScreenshots(
	page,
	testInfo,
	{
		capture,
		markers,
		onMarker = null,
		onRestore = null,
		peer = null,
		scrollRootSelector,
		stem,
	},
) {
	const markerCount = await markers.count();
	if (markerCount !== 19) {
		throw new Error("wechat-copy-candidate-task-marker-count-invalid");
	}
	const scrollState = await page.evaluate(
		({ peerSelector, selector }) => {
			const root = document.querySelector(selector);
			if (!(root instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-task-scroll-root-unavailable");
			}
			const peerRoot = peerSelector
				? document.querySelector(peerSelector)
				: null;
			if (peerSelector && !(peerRoot instanceof HTMLElement)) {
				throw new Error(
					"wechat-copy-candidate-task-peer-scroll-root-unavailable",
				);
			}
			const values = {
				rootClientHeight: root.clientHeight,
				rootClientWidth: root.clientWidth,
				rootLeft: root.scrollLeft,
				rootScrollHeight: root.scrollHeight,
				rootScrollWidth: root.scrollWidth,
				rootTop: root.scrollTop,
				windowLeft: window.scrollX,
				windowTop: window.scrollY,
			};
			const peerState = peerRoot
				? {
						left: peerRoot.scrollLeft,
						top: peerRoot.scrollTop,
					}
				: null;
			if (
				Object.values(values).some((value) => !Number.isFinite(value)) ||
				values.rootClientWidth <= 0 ||
				values.rootClientHeight <= 0 ||
				(peerState &&
					Object.values(peerState).some((value) => !Number.isFinite(value)))
			) {
				throw new Error(
					"wechat-copy-candidate-task-scroll-root-geometry-invalid",
				);
			}
			return { ...values, peer: peerState, peerSelector };
		},
		{ peerSelector: peer?.selector ?? null, selector: scrollRootSelector },
	);
	const screenshots = [];
	let primaryError = null;
	try {
		for (let index = 0; index < markerCount; index += 1) {
			const marker = markers.nth(index);
			await marker.scrollIntoViewIfNeeded();
			const captureBox = await capture.boundingBox();
			const markerBox = await marker.boundingBox();
			const scrollMetrics = await page.evaluate((selector) => {
				const root = document.querySelector(selector);
				if (!(root instanceof HTMLElement)) {
					throw new Error("wechat-copy-candidate-task-scroll-root-unavailable");
				}
				return {
					clientHeight: root.clientHeight,
					clientWidth: root.clientWidth,
					maxLeft: Math.max(0, root.scrollWidth - root.clientWidth),
					maxTop: Math.max(0, root.scrollHeight - root.clientHeight),
					scrollLeft: root.scrollLeft,
					scrollTop: root.scrollTop,
				};
			}, scrollRootSelector);
			if (
				!captureBox ||
				!markerBox ||
				!Number.isFinite(captureBox.width) ||
				captureBox.width <= 0 ||
				!Number.isFinite(captureBox.height) ||
				captureBox.height <= 0 ||
				!Object.values(scrollMetrics).every(Number.isFinite) ||
				scrollMetrics.clientWidth <= 0 ||
				scrollMetrics.clientHeight <= 0 ||
				scrollMetrics.scrollLeft < 0 ||
				scrollMetrics.scrollLeft > scrollMetrics.maxLeft ||
				scrollMetrics.scrollTop < 0 ||
				scrollMetrics.scrollTop > scrollMetrics.maxTop
			) {
				throw new Error(
					"wechat-copy-candidate-task-screenshot-geometry-invalid",
				);
			}
			const visibleWidth =
				Math.min(
					markerBox.x + markerBox.width,
					captureBox.x + captureBox.width,
				) - Math.max(markerBox.x, captureBox.x);
			const visibleHeight =
				Math.min(
					markerBox.y + markerBox.height,
					captureBox.y + captureBox.height,
				) - Math.max(markerBox.y, captureBox.y);
			if (
				!Number.isFinite(visibleWidth) ||
				!Number.isFinite(visibleHeight) ||
				visibleWidth <= 0 ||
				visibleHeight <= 0
			) {
				throw new Error("wechat-copy-candidate-task-marker-not-visible");
			}
			const bytes = await capture.screenshot({
				animations: "allow",
				caret: "initial",
			});
			if (onMarker) {
				await onMarker({
					captureBox,
					index,
					markerBox,
					scrollMetrics,
					visibleHeight,
					visibleWidth,
				});
			}
			screenshots.push({
				captureHeight: captureBox.height,
				captureWidth: captureBox.width,
				file: await writePrivateArtifact(testInfo, `${stem}-${index}`, bytes),
				index,
				markerLeft: markerBox.x - captureBox.x,
				markerRight: markerBox.x + markerBox.width - captureBox.x,
				overhangLeft: Math.max(0, captureBox.x - markerBox.x),
				overhangRight: Math.max(
					0,
					markerBox.x + markerBox.width - captureBox.x - captureBox.width,
				),
				rootMaxScrollLeft: scrollMetrics.maxLeft,
				rootMaxScrollTop: scrollMetrics.maxTop,
				scrollLeft: scrollMetrics.scrollLeft,
				scrollTop: scrollMetrics.scrollTop,
				visibleHeight,
				visibleWidth,
			});
		}
	} catch (error) {
		primaryError = error;
	}
	let restoreError = null;
	let restoredState = null;
	try {
		restoredState = await page.evaluate(
			({ selector, state }) => {
				const root = document.querySelector(selector);
				if (!(root instanceof HTMLElement)) {
					throw new Error("wechat-copy-candidate-task-scroll-root-unavailable");
				}
				const peerRoot = state.peerSelector
					? document.querySelector(state.peerSelector)
					: null;
				if (state.peerSelector && !(peerRoot instanceof HTMLElement)) {
					throw new Error(
						"wechat-copy-candidate-task-peer-scroll-root-unavailable",
					);
				}
				if (peerRoot && state.peer) {
					peerRoot.scrollTop = state.peer.top;
					peerRoot.scrollLeft = state.peer.left;
				}
				root.scrollTop = state.rootTop;
				root.scrollLeft = state.rootLeft;
				window.scrollTo(state.windowLeft, state.windowTop);
				return {
					expected: {
						cmLeft: state.peer?.left ?? null,
						cmTop: state.peer?.top ?? null,
						previewLeft: state.rootLeft,
						previewTop: state.rootTop,
						windowLeft: state.windowLeft,
						windowTop: state.windowTop,
					},
					peer: peerRoot
						? {
								left: peerRoot.scrollLeft,
								top: peerRoot.scrollTop,
							}
						: null,
					rootLeft: root.scrollLeft,
					rootTop: root.scrollTop,
					windowLeft: window.scrollX,
					windowTop: window.scrollY,
				};
			},
			{ selector: scrollRootSelector, state: scrollState },
		);
		if (
			restoredState.rootLeft !== scrollState.rootLeft ||
			restoredState.rootTop !== scrollState.rootTop ||
			restoredState.windowLeft !== scrollState.windowLeft ||
			restoredState.windowTop !== scrollState.windowTop ||
			(scrollState.peer &&
				(restoredState.peer?.left !== scrollState.peer.left ||
					restoredState.peer?.top !== scrollState.peer.top))
		) {
			restoreError = new Error(
				scrollState.peer
					? "wechat-copy-candidate-task-peer-scroll-restore-failed"
					: "wechat-copy-candidate-task-scroll-restore-failed",
			);
		}
	} catch {
		restoreError = new Error(
			"wechat-copy-candidate-task-scroll-restore-failed",
		);
	}
	if (primaryError) {
		if (restoreError) testInfo.errors.push({ message: restoreError.message });
		throw primaryError;
	}
	if (restoreError) throw restoreError;
	if (onRestore) await onRestore({ restored: restoredState });
	return screenshots;
}

function readCandidatePostFingerprint(postId) {
	let entries;
	try {
		entries = JSON.parse(
			runWp(["post", "meta", "list", String(postId), "--format=json"]),
		);
	} catch {
		throw new Error("wechat-copy-candidate-post-metadata-unavailable");
	}
	if (!Array.isArray(entries)) {
		throw new Error("wechat-copy-candidate-post-metadata-invalid");
	}
	return entries
		.filter(
			(entry) =>
				typeof entry?.meta_key === "string" &&
				entry.meta_key.startsWith("_easymde_"),
		)
		.map((entry) => {
			const value = String(entry.meta_value ?? "");
			return {
				key: entry.meta_key,
				length: value.length,
				sha256: createHash("sha256").update(value, "utf8").digest("hex"),
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

async function readCandidateRichClipboard(page) {
	return page.evaluate(async () => {
		if (
			!navigator.clipboard ||
			typeof navigator.clipboard.read !== "function"
		) {
			throw new Error("wechat-copy-candidate-clipboard-read-unavailable");
		}
		const items = await navigator.clipboard.read();
		if (items.length !== 1) {
			throw new Error("wechat-copy-candidate-clipboard-item-count-invalid");
		}
		const [item] = items;
		if (
			!item.types.includes("text/html") ||
			!item.types.includes("text/plain")
		) {
			throw new Error("wechat-copy-candidate-rich-clipboard-types-invalid");
		}
		const html = await (await item.getType("text/html")).text();
		const plainText = await (await item.getType("text/plain")).text();
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const roles = [...parsed.querySelectorAll('[role="checkbox"]')];
		const owners = roles.filter((element) => element.closest("li"));
		const checkedTrue = owners.filter(
			(element) => element.getAttribute("aria-checked") === "true",
		).length;
		const checkedFalse = owners.filter(
			(element) => element.getAttribute("aria-checked") === "false",
		).length;
		const checkedStates = owners.map(
			(element) => element.getAttribute("aria-checked") === "true",
		);
		return {
			html,
			itemCount: items.length,
			hasHtml: true,
			hasPlainText: plainText.length > 0,
			markerType:
				owners.length === roles.length && roles.length > 0
					? "static-owner"
					: "other",
			roleCount: roles.length,
			ownerCount: owners.length,
			checkedTrue,
			checkedFalse,
			checkedStates,
			inputCount: parsed.querySelectorAll("input").length,
			formControlCount: parsed.querySelectorAll(
				"input,select,textarea,button,form",
			).length,
			allDisabled: owners.every(
				(element) => element.getAttribute("aria-disabled") === "true",
			),
		};
	});
}

async function readCandidateSerializedH3Sample(page, ordinal) {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
		throw new Error("wechat-copy-candidate-serialized-h3-ordinal-invalid");
	}
	return page.evaluate((selectedOrdinal) => {
		const mount = document.querySelector(
			'[data-easymde-candidate-render="serialized-output-mount"]',
		);
		const wrapper = mount?.firstElementChild;
		const root = wrapper?.firstElementChild;
		if (
			!(mount instanceof HTMLElement) ||
			!(wrapper instanceof HTMLElement) ||
			wrapper.dataset.easymdeCandidateRender !== "serialized-output" ||
			!(root instanceof HTMLElement)
		) {
			throw new Error("wechat-copy-candidate-serialized-h3-root-unavailable");
		}
		if (mount.children.length !== 1) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-mount-child-count-invalid",
			);
		}
		if (wrapper.children.length !== 1 || root.parentElement !== wrapper) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-export-root-child-count-invalid",
			);
		}
		const h3s = [...root.querySelectorAll("h3")];
		const h3 = h3s[selectedOrdinal - 1];
		if (!(h3 instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-serialized-h3-sample-unavailable");
		}
		const finiteRect = (value, code) => {
			const rect = value.getBoundingClientRect();
			const result = {
				height: rect.height,
				left: rect.left,
				top: rect.top,
				width: rect.width,
			};
			if (
				Object.values(result).some((entry) => !Number.isFinite(entry)) ||
				result.width <= 0 ||
				result.height <= 0
			) {
				throw new Error(code);
			}
			return result;
		};
		const finiteBox = (value, code) => {
			const rect = value.getBoundingClientRect();
			const result = {
				height: rect.height,
				left: rect.left,
				top: rect.top,
				width: rect.width,
			};
			if (
				Object.values(result).some((entry) => !Number.isFinite(entry)) ||
				result.width < 0 ||
				result.height < 0
			) {
				throw new Error(code);
			}
			return result;
		};
		const alpha = (value) => {
			if (value === "transparent") return 0;
			const match = value.match(/^rgba?\((.*)\)$/u);
			if (!match) return null;
			const parts = match[1].split(/[\s,/]+/u).filter(Boolean);
			if (parts.length === 3) return 1;
			if (parts.length !== 4) return null;
			const parsed = Number.parseFloat(parts[3]);
			return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
				? parsed
				: null;
		};
		const enumValue = (value, values) =>
			values.includes(value) ? value : "other";
		const finiteAlpha = (value, code) => {
			const parsed = Number(value);
			if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
				throw new Error(code);
			}
			return parsed;
		};
		const describeElement = (element, geometryCode) => {
			const style = getComputedStyle(element);
			const backgroundAlpha = alpha(style.backgroundColor);
			if (!Number.isFinite(backgroundAlpha)) {
				throw new Error("wechat-copy-candidate-serialized-h3-alpha-invalid");
			}
			return {
				backgroundAlpha,
				computedInlinePosition: {
					display: enumValue(style.display, [
						"block",
						"inline",
						"inline-block",
						"inline-flex",
						"none",
					]),
					position: enumValue(style.position, [
						"absolute",
						"fixed",
						"relative",
						"static",
						"sticky",
					]),
				},
				...finiteRect(element, geometryCode),
			};
		};
		const range = document.createRange();
		range.selectNodeContents(h3);
		const h3Rect = finiteRect(
			h3,
			"wechat-copy-candidate-serialized-h3-geometry-invalid",
		);
		const generated = [...h3.children].filter(
			(child) =>
				child instanceof HTMLSpanElement &&
				child.getAttribute("aria-hidden") === "true",
		);
		const generatedTextKinds = { other: 0, space: 0, wordJoiner: 0 };
		const generatedSpanNodes = generated.map((span) => {
			const value = span.textContent ?? "";
			let textKind = "other";
			if (value && [...value].every((character) => character === "\u2060")) {
				generatedTextKinds.wordJoiner += 1;
				textKind = "wordJoiner";
			} else if (value && /^\s+$/u.test(value)) {
				generatedTextKinds.space += 1;
				textKind = "space";
			}
			if (textKind === "other") generatedTextKinds.other += 1;
			const style = getComputedStyle(span);
			const actualBBox = finiteBox(
				span,
				"wechat-copy-candidate-serialized-h3-generated-span-bbox-invalid",
			);
			const inlineOffsets = [...span.getClientRects()].map((rect) => {
				const offset = {
					height: rect.height,
					left: rect.left - h3Rect.left,
					top: rect.top - h3Rect.top,
					width: rect.width,
				};
				if (
					Object.values(offset).some((entry) => !Number.isFinite(entry)) ||
					offset.width < 0 ||
					offset.height < 0
				) {
					throw new Error(
						"wechat-copy-candidate-serialized-h3-generated-span-inline-offset-invalid",
					);
				}
				return offset;
			});
			if (
				actualBBox.width > 0 &&
				actualBBox.height > 0 &&
				inlineOffsets.length === 0
			) {
				throw new Error(
					"wechat-copy-candidate-serialized-h3-generated-span-inline-offset-unavailable",
				);
			}
			return {
				actualBBox,
				inlineOffsets,
				backgroundAlpha: (() => {
					const value = alpha(style.backgroundColor);
					if (!Number.isFinite(value)) {
						throw new Error(
							"wechat-copy-candidate-serialized-h3-generated-span-background-alpha-invalid",
						);
					}
					return value;
				})(),
				opacity: finiteAlpha(
					style.opacity,
					"wechat-copy-candidate-serialized-h3-generated-span-opacity-invalid",
				),
				textKind,
			};
		});
		const mountRect = finiteRect(
			mount,
			"wechat-copy-candidate-serialized-h3-mount-geometry-invalid",
		);
		const mountClientClipRect = {
			height: mount.clientHeight,
			left: mountRect.left + mount.clientLeft,
			top: mountRect.top + mount.clientTop,
			width: mount.clientWidth,
		};
		if (
			Object.values(mountClientClipRect).some(
				(value) => !Number.isFinite(value),
			) ||
			mountClientClipRect.width <= 0 ||
			mountClientClipRect.height <= 0
		) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-mount-client-clip-invalid",
			);
		}
		const rootRect = finiteRect(
			root,
			"wechat-copy-candidate-serialized-h3-root-geometry-invalid",
		);
		const wrapperRect = finiteRect(
			wrapper,
			"wechat-copy-candidate-serialized-h3-wrapper-geometry-invalid",
		);
		const mountOverflowStyle = getComputedStyle(mount);
		const overflowValues = ["auto", "clip", "hidden", "scroll", "visible"];
		const mountOverflow = {
			overflow: enumValue(mountOverflowStyle.overflow, overflowValues),
			overflowX: enumValue(mountOverflowStyle.overflowX, overflowValues),
			overflowY: enumValue(mountOverflowStyle.overflowY, overflowValues),
		};
		const wrapperOverflowStyle = getComputedStyle(wrapper);
		const wrapperOverflow = {
			overflow: enumValue(wrapperOverflowStyle.overflow, overflowValues),
			overflowX: enumValue(wrapperOverflowStyle.overflowX, overflowValues),
			overflowY: enumValue(wrapperOverflowStyle.overflowY, overflowValues),
		};
		const rootOverflowStyle = getComputedStyle(root);
		const rootOverflow = {
			overflow: enumValue(rootOverflowStyle.overflow, overflowValues),
			overflowX: enumValue(rootOverflowStyle.overflowX, overflowValues),
			overflowY: enumValue(rootOverflowStyle.overflowY, overflowValues),
		};
		const rootClipAxes = {
			horizontal: rootOverflow.overflowX !== "visible",
			vertical: rootOverflow.overflowY !== "visible",
		};
		const rootClientClipRect = {
			height: root.clientHeight,
			left: rootRect.left + root.clientLeft,
			top: rootRect.top + root.clientTop,
			width: root.clientWidth,
		};
		const rootClipRect =
			rootClipAxes.horizontal || rootClipAxes.vertical
				? rootClientClipRect
				: null;
		if (
			rootClipRect &&
			(Object.values(rootClipRect).some((value) => !Number.isFinite(value)) ||
				rootClipRect.width <= 0 ||
				rootClipRect.height <= 0)
		) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-root-client-clip-invalid",
			);
		}
		return {
			directH3ChildCount: h3.children.length,
			generatedAriaHiddenSpanCount: generated.length,
			generatedAriaHiddenSpanState: generated.length ? "present" : "absent",
			generatedAriaHiddenSpans: generatedSpanNodes,
			generatedTextKinds,
			h3: describeElement(
				h3,
				"wechat-copy-candidate-serialized-h3-geometry-invalid",
			),
			h3Count: h3s.length,
			mountClientClipRect,
			mountOverflow,
			ordinal: selectedOrdinal,
			rootProvenance: "wrapper-first-element-child",
			rootRect,
			rootClipRect,
			rootClipAxes,
			rootClipState:
				rootClipRect === null
					? "unclipped-overflow-visible"
					: "computed-overflow-clip",
			rootOverflow,
			status: "available",
			textRangeKind: "h3-contents-range",
			textRange: finiteRect(
				range,
				"wechat-copy-candidate-serialized-h3-text-range-invalid",
			),
			wrapperChildElementCount: wrapper.children.length,
			wrapperOverflow,
			wrapperRect,
		};
	}, ordinal);
}

async function renderCandidateSerializedOutput(page, html) {
	const width = await page.locator(previewSelector).evaluate((element) => {
		const style = getComputedStyle(element);
		const value =
			element.getBoundingClientRect().width -
			Number.parseFloat(style.borderLeftWidth) -
			Number.parseFloat(style.borderRightWidth) -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(
				"wechat-copy-candidate-preview-content-width-unavailable",
			);
		}
		return value;
	});
	if (!Number.isFinite(width) || width <= 0) {
		throw new Error("wechat-copy-candidate-serialized-content-width-invalid");
	}
	const viewportHeight = await page
		.locator(".easymde-immersive-preview-canvas")
		.first()
		.evaluate((element) => {
			const value = element.clientHeight;
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error(
					"wechat-copy-candidate-preview-viewport-height-unavailable",
				);
			}
			return value;
		});
	await page.evaluate(
		({
			html: serializedHtml,
			height: serializedHeight,
			width: serializedWidth,
		}) => {
			document
				.querySelector(
					'[data-easymde-candidate-render="serialized-output-mount"]',
				)
				?.remove();
			const existing = document.querySelector(
				'[data-easymde-candidate-render="serialized-output"]',
			);
			existing?.remove();
			const mount = document.createElement("div");
			mount.dataset.easymdeCandidateRender = "serialized-output-mount";
			mount.style.cssText = [
				"background-color:#fff",
				`height:${serializedHeight}px`,
				`width:${serializedWidth}px`,
				"overflow:auto",
				"position:fixed",
				"left:0",
				"top:0",
				"z-index:2147483647",
				"pointer-events:none",
			].join(";");
			const root = document.createElement("div");
			root.dataset.easymdeCandidateRender = "serialized-output";
			root.innerHTML = serializedHtml;
			mount.append(root);
			document.body.append(mount);
		},
		{ html, height: viewportHeight, width },
	);
	const output = page.locator(
		'[data-easymde-candidate-render="serialized-output"] > *',
	);
	await expect(output).toHaveCount(1);
	await output.evaluate(async (element) => {
		if (document.fonts?.ready) await document.fonts.ready;
		const images = [...element.querySelectorAll("img")];
		await Promise.all(
			images.map(async (image) => {
				if (!image.complete) {
					await new Promise((resolve, reject) => {
						const onLoad = () => {
							image.removeEventListener("load", onLoad);
							image.removeEventListener("error", onError);
							resolve();
						};
						const onError = () => {
							image.removeEventListener("load", onLoad);
							image.removeEventListener("error", onError);
							reject(new Error("wechat-copy-candidate-output-image-failed"));
						};
						image.addEventListener("load", onLoad, { once: true });
						image.addEventListener("error", onError, { once: true });
					});
				}
				if (typeof image.decode === "function") await image.decode();
				if (image.naturalWidth < 1 || image.naturalHeight < 1) {
					throw new Error(
						"wechat-copy-candidate-output-image-intrinsic-invalid",
					);
				}
			}),
		);
	});
	const mount = page.locator(
		'[data-easymde-candidate-render="serialized-output-mount"]',
	);
	let measured = null;
	let parentWidth = width;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await mount.evaluate((element, nextWidth) => {
			element.style.width = `${nextWidth}px`;
		}, parentWidth);
		measured = await output.evaluate((element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			const contentWidth =
				rect.width -
				Number.parseFloat(style.borderLeftWidth) -
				Number.parseFloat(style.borderRightWidth) -
				Number.parseFloat(style.paddingLeft) -
				Number.parseFloat(style.paddingRight);
			return {
				contentWidth,
				height: rect.height,
				outsideEditor: element.closest(".easymde-editor") === null,
				width: rect.width,
			};
		});
		if (
			measured.outsideEditor === true &&
			Number.isFinite(measured.contentWidth) &&
			measured.contentWidth > 0 &&
			Number.isFinite(measured.width) &&
			measured.width > 0 &&
			Number.isFinite(measured.height) &&
			measured.height > 0 &&
			Math.abs(measured.contentWidth - width) <= 1 / 64
		) {
			return {
				mount,
				output,
				viewportHeight,
				width: parentWidth,
				contentWidth: measured.contentWidth,
			};
		}
		if (
			!Number.isFinite(measured.contentWidth) ||
			measured.contentWidth <= 0 ||
			!Number.isFinite(measured.width) ||
			measured.width <= 0 ||
			!Number.isFinite(measured.height) ||
			measured.height <= 0
		) {
			throw new Error("wechat-copy-candidate-serialized-geometry-invalid");
		}
		parentWidth += width - measured.contentWidth;
		if (!Number.isFinite(parentWidth) || parentWidth <= 0) {
			throw new Error("wechat-copy-candidate-serialized-parent-width-invalid");
		}
	}
	throw new Error("wechat-copy-candidate-serialized-content-width-invalid");
}

async function captureCandidateSerializedTaskScreenshots(
	page,
	testInfo,
	html,
	h3Ordinal = null,
) {
	let rendered = null;
	let screenshots = null;
	let h3Sample = null;
	let primaryError = null;
	try {
		rendered = await renderCandidateSerializedOutput(page, html);
		screenshots = await captureCandidateTaskScreenshots(page, testInfo, {
			capture: rendered.mount,
			markers: rendered.output.locator('[role="checkbox"]'),
			onMarker:
				h3Ordinal === null
					? null
					: async ({ index }) => {
							if (index === 0) {
								h3Sample = await readCandidateSerializedH3Sample(
									page,
									h3Ordinal,
								);
							}
						},
			scrollRootSelector:
				'[data-easymde-candidate-render="serialized-output-mount"]',
			stem: "serialized-output-task",
		});
	} catch (error) {
		primaryError = error;
	}
	let cleanupError = null;
	try {
		await page.evaluate(() => {
			document
				.querySelector(
					'[data-easymde-candidate-render="serialized-output-mount"]',
				)
				?.remove();
		});
	} catch {
		cleanupError = new Error("wechat-copy-candidate-output-cleanup-failed");
	}
	if (primaryError) {
		if (cleanupError) testInfo.errors.push({ message: cleanupError.message });
		throw primaryError;
	}
	if (cleanupError) throw cleanupError;
	if (h3Ordinal !== null && !h3Sample) {
		throw new Error("wechat-copy-candidate-serialized-h3-sample-unavailable");
	}
	return {
		screenshots,
		width: rendered.width,
		contentWidth: rendered.contentWidth,
		h3Sample,
		viewportHeight: rendered.viewportHeight,
	};
}

test.beforeEach(async ({ page: _page }, testInfo) => {
	testInfo.wechatPerformanceUser = createOwnedUser(testSlug(testInfo));
	testInfo.wechatPerformanceUserId = testInfo.wechatPerformanceUser.id;
});

test.afterEach(async ({ page: _page }, testInfo) => {
	try {
		cleanupOwnedRecords(testInfo);
	} catch {
		const cleanupError = {
			message: "wechat-copy-performance-owned-cleanup-failed",
		};
		if (testInfo.errors.length > 0) {
			testInfo.errors.push(cleanupError);
			return;
		}
		throw new Error(cleanupError.message);
	}
});

test("profiles one selected Cherry/phycat-code Copy with real R2 PNG export @performance", async ({
	context,
	page,
}, testInfo) => {
	test.setTimeout(180_000);
	privateEvidenceDirectory();
	let serverSettings = null;
	let postId = null;
	let cdp = null;
	let traceEvents = null;
	let primaryError = null;
	let cleanupError = null;
	let probeStopped = false;
	let uploadTimeline = null;
	let uploadSnapshot = null;

	try {
		uploadTimeline = createUploadTimeline(page);
		await installPerformanceProbe(page);
		serverSettings = readServerImageSettings();
		postId = createOwnedPost(
			testInfo.wechatPerformanceUser,
			testSlug(testInfo),
			testInfo,
		);
		await page.route(
			(url) => url === canonicalImageSource,
			(route) =>
				route.fulfill({
					body: canonicalImage,
					contentType: "image/png",
					status: 200,
				}),
		);
		await login(page, testInfo.wechatPerformanceUser);
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: expectedOrigin,
		});
		await page.setViewportSize({ height: 785, width: 1329 });
		await installPerformanceModeOverride(page, configuredPerformanceMode);
		await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
			waitUntil: "domcontentloaded",
		});
		await expect(page.locator("#easymde-editor")).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					height: window.innerHeight,
					width: window.innerWidth,
				})),
			)
			.toEqual({ height: 785, width: 1329 });
		await assertCanonicalSource(page);
		await configurePerformanceMode(page, configuredPerformanceMode);
		const modeState = await readPerformanceModeState(page);
		const expectedModeState =
			performanceModeExpectations[configuredPerformanceMode];
		expect(modeState.actualMode).toBe(configuredPerformanceMode);
		expect(modeState).toMatchObject(expectedModeState);
		const serverBundleIdentity = await readServerBundleIdentity(page);
		if (!Object.values(serverBundleIdentity).every(Boolean)) {
			throw new Error(
				"wechat-copy-performance-server-bundle-identity-mismatch",
			);
		}
		const browserConfiguration = await readBrowserConfiguration(page);
		expect(browserConfiguration).toMatchObject({
			articleStylesheetReady: true,
			articleTheme: expectedArticleTheme,
			codeStylesheetReady: true,
			codeTheme: expectedCodeTheme,
			codeThemeExplicit: "1",
			endpointIsImageHosting: true,
			imageUploadEnabled: true,
			imageUploadOwner: "image-hosting",
			pngConversionEnabled: true,
			previewPresentation: expectedModeState.previewPresentation,
			previewVisible: expectedModeState.previewVisible,
			sourceVisible: expectedModeState.sourceVisible,
		});
		expect(serverSettings).toEqual({
			backupEnabled: false,
			imageHostingEnabled: true,
			service: "cloudflare-r2",
			wechatPngExportEnabled: true,
		});

		cdp = await startTracing(context, page);
		await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.begin(),
		);
		let copyButton = page.locator(".easymde-toolbar-copy-action");
		if (modeState.surface === "immersive") {
			const wechatLabel = await page.evaluate(
				() => window.EasyMDEEditorRootBootstrap.strings.immersive.wechat,
			);
			copyButton = page.getByRole("button", {
				name: wechatLabel,
				exact: true,
			});
		}
		await expect(copyButton).toHaveCount(1);
		await expect(copyButton).toBeVisible();
		await copyButton.click();
		await waitForCopySuccess(page, testInfo, uploadTimeline);
		await waitForNativeWriteFulfilled(page, testInfo, uploadTimeline);
		await withDeadline(
			page.evaluate(() =>
				globalThis.__easymdeWechatCopyPerformance.awaitEarlyPhases(),
			),
			"wechat-copy-performance-early-phase-timeout",
			5_000,
		);
		const pageSample = await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.end(),
		);
		await page.evaluate(() => globalThis.__easymdeWechatCopyPerformance.stop());
		probeStopped = true;
		uploadSnapshot = await uploadTimeline.snapshot(pageSample);
		const pageTiming = summarizePageTiming(pageSample);
		const uploadEvidence = summarizeUploadTimeline(uploadSnapshot);
		traceEvents = await stopTracing(cdp);
		cdp = null;
		const traceTiming = summarizeTrace(traceEvents);
		const clipboardShape = await readClipboardShape(page);
		expect(clipboardShape.itemCount).toBe(1);
		expect(clipboardShape.typeCounts[0]).toBeGreaterThan(0);
		await writePrivateEvidence(testInfo, {
			clickOwner: pageTiming.clickOwner,
			copyTerminalAt: pageTiming.copyTerminalAt,
			longTasks: pageTiming.longTasks,
			measures: pageTiming.measures,
			notifications: pageTiming.notifications,
			ownerChanges: pageTiming.ownerChanges,
			ownerChangeStages: pageTiming.ownerChangeStages,
			pageInterval: pageTiming.pageInterval,
			earlyStages: pageTiming.earlyStages,
			uploads: uploadEvidence,
			serverBundleIdentity,
			earlyFunctionAttribution: traceTiming.earlyFunctionAttribution,
			traceReason: traceTiming.reason ?? null,
			traceStatus: traceTiming.status,
			traceUserTimingCapability:
				traceTiming.status === "verified" ? "observed" : "unobserved",
			trace: traceTiming.records,
			mode: {
				actual: modeState,
				requested: configuredPerformanceMode,
			},
			write: pageTiming.write,
		});
	} catch (error) {
		primaryError = error;
		if (!testInfo.wechatPerformanceFailureSnapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"test-terminal",
					stableFailureCode(error),
					uploadTimeline,
					uploadSnapshot,
				);
			} catch {
				cleanupError = new Error(
					"wechat-copy-performance-failure-snapshot-unavailable",
				);
			}
		}
		throw error;
	} finally {
		if (!probeStopped) {
			try {
				await page.evaluate(() =>
					globalThis.__easymdeWechatCopyPerformance?.stop(),
				);
			} catch {
				cleanupError = new Error(
					"wechat-copy-performance-probe-cleanup-failed",
				);
			}
		}
		if (cdp) {
			try {
				await stopTracing(cdp);
			} catch {
				cleanupError ??= new Error(
					"wechat-copy-performance-tracing-cleanup-failed",
				);
			}
		}
		if (uploadTimeline) {
			try {
				uploadTimeline.stop();
			} catch {
				cleanupError ??= new Error(
					"wechat-copy-performance-upload-listener-cleanup-failed",
				);
			}
		}
	}
	if (cleanupError && !primaryError) throw cleanupError;
});

test("captures one ordinary Split Cherry rich Clipboard candidate @candidate", async ({
	context,
	page,
}, testInfo) => {
	test.setTimeout(180_000);
	privateEvidenceDirectory();
	let candidateBuild = null;
	let routeState = null;
	let uploadTimeline = null;
	let uploadSnapshot = null;
	let postId = null;
	let sourceBefore = null;
	let postBefore = null;
	let mutationEvidence = null;
	let sourceDiagnosticStarted = false;
	let sourceDiagnosticBefore = null;
	let sourceCalibrationPhase = null;
	let sourceCalibrationStability = null;
	let sourceCalibrationCMDelta = null;
	let sourceShotsPhase = null;
	let sourceRestorePhase = null;
	let sourceStability = null;
	let copyBeginPhase = null;
	let copyEndPhase = null;
	let sourceFinalPhase = null;
	let selectedH3Ordinal = null;
	let sourceH3Sample = null;
	let serializedH3Sample = null;
	let serializedTaskScreenshots = null;
	const sourceTaskFingerprints = [];
	let probeStopped = false;
	let primaryError = null;
	const cleanupErrors = [];
	try {
		candidateBuild = readCandidateBuildIdentity();
		uploadTimeline = createUploadTimeline(page);
		await installPerformanceProbe(page);
		const serverSettings = readServerImageSettings();
		postId = createOwnedPost(
			testInfo.wechatPerformanceUser,
			testSlug(testInfo),
			testInfo,
		);
		postBefore = readCandidatePostFingerprint(postId);
		routeState = await routeCandidateBuildAssets(page, candidateBuild);
		await page.route(
			(url) => url === canonicalImageSource,
			(route) =>
				route.fulfill({
					body: canonicalImage,
					contentType: "image/png",
					status: 200,
				}),
		);
		await login(page, testInfo.wechatPerformanceUser);
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: expectedOrigin,
		});
		await page.setViewportSize({ height: 785, width: 1329 });
		await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
			waitUntil: "domcontentloaded",
		});
		await expect(page.locator("#easymde-editor")).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					height: window.innerHeight,
					width: window.innerWidth,
				})),
			)
			.toEqual({ height: 785, width: 1329 });
		await assertCanonicalSource(page);
		await waitForPreviewReady(page);
		const runtimeIdentity = await readCandidateRuntimeIdentity(page);
		expect(runtimeIdentity).toEqual({
			loaderBootstrapPresent: true,
			mainScriptLoaded: true,
		});
		const browserConfiguration = await readBrowserConfiguration(page);
		expect(browserConfiguration).toMatchObject({
			articleStylesheetReady: true,
			articleTheme: expectedArticleTheme,
			codeStylesheetReady: true,
			codeTheme: expectedCodeTheme,
			codeThemeExplicit: "1",
			endpointIsImageHosting: true,
			imageUploadEnabled: true,
			imageUploadOwner: "image-hosting",
			pngConversionEnabled: true,
			previewPresentation: "split",
			previewVisible: true,
			sourceVisible: true,
		});
		expect(serverSettings).toEqual({
			backupEnabled: false,
			imageHostingEnabled: true,
			service: "cloudflare-r2",
			wechatPngExportEnabled: true,
		});
		await page.mouse.move(0, 0);
		await startCandidateSourceDiagnostic(page);
		sourceDiagnosticStarted = true;
		sourceDiagnosticBefore = await readCandidateSourcePhase(
			page,
			"source-before",
		);
		assertCandidateSourceBaseline(sourceDiagnosticBefore.diagnostic);
		const sourceCalibrationBaseline =
			await readCandidateSourceFingerprint(page);
		await page.setViewportSize({ height: 785, width: 1329 });
		await waitForPreviewReady(page);
		await assertCanonicalSource(page);
		const restoredCalibrationScroll =
			await restoreCandidateSourceDiagnosticScroll(
				page,
				sourceDiagnosticBefore.diagnostic,
			);
		sourceCalibrationStability = await waitForCandidateSourceStability(
			page,
			restoredCalibrationScroll.expected,
		);
		sourceCalibrationPhase = await readCandidateSourcePhase(
			page,
			"source-calibration-restored",
		);
		assertCandidateSourceBaseline(sourceCalibrationPhase.diagnostic);
		sourceBefore = await readCandidateSourceFingerprint(page);
		assertCandidateSourceFingerprintEqual(
			sourceBefore,
			sourceCalibrationBaseline,
		);
		expect(readCandidatePostFingerprint(postId)).toEqual(postBefore);
		const routedBeforeCopy = routeState.observed();
		expect(routedBeforeCopy).toEqual(
			expect.arrayContaining(["loader", "main"]),
		);
		expect(sourceBefore.preview.inputChecked).toHaveLength(19);
		expect(sourceBefore.preview.formControlCount).toBe(19);
		expect(sourceBefore.preview.inputChecked.filter(Boolean)).toHaveLength(16);
		expect(
			sourceBefore.preview.inputChecked.filter((value) => !value),
		).toHaveLength(3);
		const markdownMeta = postBefore.find(
			({ key }) => key === "_easymde_markdown",
		);
		expect(markdownMeta).toMatchObject({
			length: canonicalMarkdownLength,
			sha256: expectedCanonicalMarkdownSha256,
		});
		const sourceScreenshot = await captureCandidateTaskScreenshots(
			page,
			testInfo,
			{
				capture: page.locator(".easymde-immersive-preview-canvas").first(),
				markers: page
					.locator(previewSelector)
					.locator('input[type="checkbox"]'),
				onMarker: async ({ index }) => {
					const phase = await readCandidateSourcePhase(page, "source-shots");
					assertCandidateSourceBaseline(phase.diagnostic);
					assertCandidateSourceFingerprintEqual(
						phase.fingerprint,
						sourceBefore,
					);
					if (index === 0) {
						const selection = await readCandidateSourceH3Ordinal(page);
						selectedH3Ordinal = selection.ordinal;
						sourceH3Sample = await readCandidateSourceH3Sample(
							page,
							selectedH3Ordinal,
						);
					}
					sourceTaskFingerprints.push({
						diagnostic: phase.diagnostic,
						fingerprint: phase.fingerprint,
						index,
					});
					if (index === 18) sourceShotsPhase = phase;
				},
				onRestore: async ({ restored }) => {
					const phase = await readCandidateSourcePhase(page, "restoration");
					assertCandidateRestorePeer(phase.diagnostic, restored.expected);
					sourceRestorePhase = { ...phase, restored };
				},
				peer: { selector: ".easymde-source-react .cm-scroller" },
				scrollRootSelector: ".easymde-immersive-preview-canvas",
				stem: "source-task",
			},
		);
		assertCandidateSourceTaskFingerprints(sourceTaskFingerprints, sourceBefore);
		if (
			!sourceCalibrationPhase ||
			!sourceShotsPhase ||
			!sourceRestorePhase ||
			!sourceH3Sample
		) {
			throw new Error("wechat-copy-candidate-source-phase-missing");
		}
		sourceCalibrationCMDelta = candidateMutationDelta(
			sourceDiagnosticBefore.diagnostic,
			sourceCalibrationPhase.diagnostic,
			"cmPresentation",
		);
		const sourceShotCMDelta = candidateMutationDelta(
			sourceCalibrationPhase.diagnostic,
			sourceShotsPhase.diagnostic,
			"cmPresentation",
		);
		const restorationCMDelta = candidateMutationDelta(
			sourceShotsPhase.diagnostic,
			sourceRestorePhase.diagnostic,
			"cmPresentation",
		);
		expect(sourceRestorePhase.fingerprint).toEqual(sourceBefore);
		sourceStability = await waitForCandidateSourceStability(
			page,
			sourceRestorePhase.restored.expected,
		);
		copyBeginPhase = await readCandidateSourcePhase(page, "copy-begin");
		assertCandidateSourceBaseline(copyBeginPhase.diagnostic);
		assertCandidateSourceFingerprintEqual(
			copyBeginPhase.fingerprint,
			sourceBefore,
		);

		await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.begin(),
		);
		const copyButton = page.locator(".easymde-toolbar-copy-action");
		await expect(copyButton).toHaveCount(1);
		await expect(copyButton).toBeVisible();
		await copyButton.click();
		await waitForCopySuccess(page, testInfo, uploadTimeline);
		await waitForNativeWriteFulfilled(page, testInfo, uploadTimeline);
		const pageSample = await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.end(),
		);
		await page.evaluate(() => globalThis.__easymdeWechatCopyPerformance.stop());
		probeStopped = true;
		copyEndPhase = await readCandidateSourcePhase(page, "copy-end");
		assertCandidateSourceBaseline(copyEndPhase.diagnostic);
		const copyEndCMDelta = assertCandidateCopyCMDelta(
			copyBeginPhase.diagnostic,
			copyEndPhase.diagnostic,
		);
		expect(copyEndPhase.fingerprint).toEqual(sourceBefore);
		expect(pageSample.clicks).toHaveLength(1);
		expect(pageSample.writes).toHaveLength(1);
		expect(pageSample.writes[0].nativeState).toBe("fulfilled");
		uploadSnapshot = await uploadTimeline.snapshot(pageSample);
		const uploadEvidence = summarizeUploadTimeline(uploadSnapshot);
		expect(uploadEvidence.peakInFlight).toBeLessThanOrEqual(3);
		const richClipboard = await readCandidateRichClipboard(page);
		expect(richClipboard).toMatchObject({
			itemCount: 1,
			hasHtml: true,
			hasPlainText: true,
			markerType: "static-owner",
			roleCount: 19,
			ownerCount: 19,
			checkedTrue: 16,
			checkedFalse: 3,
			checkedStates: sourceBefore.preview.inputChecked,
			inputCount: 0,
			formControlCount: 0,
			allDisabled: true,
		});
		expect(richClipboard.checkedStates).toEqual(
			sourceBefore.preview.inputChecked,
		);
		serializedTaskScreenshots = await captureCandidateSerializedTaskScreenshots(
			page,
			testInfo,
			richClipboard.html,
			selectedH3Ordinal,
		);
		serializedH3Sample = serializedTaskScreenshots.h3Sample;
		const sourceAfter = await readCandidateSourceFingerprint(page);
		const postAfter = readCandidatePostFingerprint(postId);
		expect(sourceAfter).toEqual(sourceBefore);
		expect(postAfter).toEqual(postBefore);
		sourceFinalPhase = await readCandidateSourcePhase(page, "final");
		assertCandidateSourceBaseline(sourceFinalPhase.diagnostic);
		assertCandidateSourceFingerprintEqual(
			sourceFinalPhase.fingerprint,
			sourceBefore,
		);
		const finalCMDelta = candidateMutationDelta(
			copyEndPhase.diagnostic,
			sourceFinalPhase.diagnostic,
			"cmPresentation",
		);
		expect(finalCMDelta).toBe(0);
		mutationEvidence = {
			copyBegin: copyBeginPhase,
			copyEnd: copyEndPhase,
			copyEndCMDelta,
			finalCMDelta,
			sourceCalibrationCMDelta,
			sourceCalibrationPhase,
			sourceCalibrationStability,
			restorationCMDelta,
			sourceBefore: sourceDiagnosticBefore,
			sourceFinal: sourceFinalPhase,
			sourceRestore: sourceRestorePhase,
			sourceShotCMDelta,
			sourceShots: sourceShotsPhase,
			stability: sourceStability,
			h3Diagnostic: {
				source: sourceH3Sample,
				serialized: serializedH3Sample,
				status: "diagnostic-only",
			},
			taskFingerprints: sourceTaskFingerprints,
		};
		const routedAfterCopy = routeState.observed();
		expect(routedAfterCopy).toEqual(
			expect.arrayContaining(["loader", "main", "worker"]),
		);
		await writePrivateEvidence(testInfo, {
			candidateStatus: "visual-candidate-only",
			nativeWeChatPassClaimed: false,
			build: candidateBuild.identity,
			runtime: runtimeIdentity,
			routedAssets: routedAfterCopy,
			routedAssetEvidence: routeState.evidence(),
			serverSettings,
			browserConfiguration,
			mutations: mutationEvidence,
			h3Diagnostic: {
				source: sourceH3Sample,
				serialized: serializedH3Sample,
				status: "diagnostic-only",
			},
			richClipboard: {
				itemCount: richClipboard.itemCount,
				hasHtml: richClipboard.hasHtml,
				hasPlainText: richClipboard.hasPlainText,
				markerType: richClipboard.markerType,
				roleCount: richClipboard.roleCount,
				ownerCount: richClipboard.ownerCount,
				checkedTrue: richClipboard.checkedTrue,
				checkedFalse: richClipboard.checkedFalse,
				checkedStates: richClipboard.checkedStates,
				inputCount: richClipboard.inputCount,
				formControlCount: richClipboard.formControlCount,
				allDisabled: richClipboard.allDisabled,
			},
			sourceBefore,
			sourceAfter,
			postBefore,
			postAfter,
			uploads: uploadEvidence,
			screenshots: {
				sourceTaskSections: sourceScreenshot,
				serializedOutputTaskSections: serializedTaskScreenshots.screenshots,
				sourceTaskIndices: sourceScreenshot.map(({ index }) => index),
				serializedOutputTaskIndices: serializedTaskScreenshots.screenshots.map(
					({ index }) => index,
				),
				sourceContentWidth: sourceBefore.preview.contentWidth,
				serializedOutputContentWidths: [serializedTaskScreenshots.contentWidth],
				serializedOutputWidths: [serializedTaskScreenshots.width],
			},
			paintReview: "unverified",
			nativeAcceptance: "unverified",
		});
	} catch (error) {
		primaryError = error;
		let sourceFailurePhase = { state: "unavailable" };
		try {
			if (!page.isClosed() && sourceDiagnosticStarted) {
				sourceFailurePhase = await readCandidateSourcePhase(page, "failure");
			}
		} catch {
			sourceFailurePhase = { state: "unavailable" };
		}
		try {
			await writePrivateEvidence(testInfo, {
				candidateStatus: "visual-candidate-failed",
				failureCode: stableFailureCode(error),
				mutations: {
					copyBegin: copyBeginPhase,
					copyEnd: copyEndPhase,
					sourceBefore: sourceDiagnosticBefore,
					sourceCalibrationCMDelta,
					sourceCalibrationPhase,
					sourceCalibrationStability,
					sourceFailure: sourceFailurePhase,
					sourceRestore: sourceRestorePhase,
					sourceShots: sourceShotsPhase,
					taskFingerprints: sourceTaskFingerprints,
				},
				h3Diagnostic: {
					source: sourceH3Sample,
					serialized: serializedH3Sample,
					status: "diagnostic-only",
				},
			});
		} catch {
			cleanupErrors.push(
				new Error("wechat-copy-candidate-source-failure-evidence-unavailable"),
			);
		}
		if (!testInfo.wechatPerformanceFailureSnapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"test-terminal",
					stableFailureCode(error),
					uploadTimeline,
					uploadSnapshot,
				);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-failure-snapshot-unavailable"),
				);
			}
		}
		throw error;
	} finally {
		if (sourceDiagnosticStarted) {
			try {
				await stopCandidateSourceDiagnostic(page);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-diagnostic-cleanup-failed"),
				);
			}
			sourceDiagnosticStarted = false;
		}
		if (!probeStopped) {
			try {
				await page.evaluate(() =>
					globalThis.__easymdeWechatCopyPerformance?.stop(),
				);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-probe-cleanup-failed"),
				);
			}
		}
		if (uploadTimeline) {
			try {
				uploadTimeline.stop();
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-upload-listener-cleanup-failed"),
				);
			}
		}
		if (routeState) {
			try {
				await routeState.stop();
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-asset-route-cleanup-failed"),
				);
			}
		}
		if (cleanupErrors.length && (primaryError || testInfo.errors.length > 0)) {
			testInfo.errors.push(
				...cleanupErrors.map(({ message }) => ({ message })),
			);
			cleanupErrors.length = 0;
		}
	}
	if (cleanupErrors.length && !primaryError) {
		testInfo.errors.push(...cleanupErrors.map(({ message }) => ({ message })));
		cleanupErrors.length = 0;
		throw new Error("wechat-copy-performance-candidate-cleanup-failed");
	}
});

test("diagnoses source-only Split Cherry scroll mutations without Copy @source-diagnostic", async ({
	page,
}, testInfo) => {
	test.setTimeout(180_000);
	privateEvidenceDirectory();
	let candidateBuild = null;
	let routeState = null;
	let canonicalImageRoute = null;
	let postId = null;
	let sourceBefore = null;
	let postBefore = null;
	let diagnosticBefore = null;
	const sourceTaskEvidence = [];
	let sourceAfterRestore = null;
	let diagnosticAfterRestore = null;
	let primaryError = null;
	let diagnosticStarted = false;
	const cleanupErrors = [];
	try {
		candidateBuild = readCandidateBuildIdentity();
		postId = createOwnedPost(
			testInfo.wechatPerformanceUser,
			testSlug(testInfo),
			testInfo,
		);
		postBefore = readCandidatePostFingerprint(postId);
		routeState = await routeCandidateBuildAssets(page, candidateBuild);
		canonicalImageRoute = (route) =>
			route.fulfill({
				body: canonicalImage,
				contentType: "image/png",
				status: 200,
			});
		await page.route(canonicalImageSource, canonicalImageRoute);
		await login(page, testInfo.wechatPerformanceUser);
		await page.setViewportSize({ height: 785, width: 1329 });
		await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
			waitUntil: "domcontentloaded",
		});
		await expect(page.locator("#easymde-editor")).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					height: window.innerHeight,
					width: window.innerWidth,
				})),
			)
			.toEqual({ height: 785, width: 1329 });
		await assertCanonicalSource(page);
		await waitForPreviewReady(page);
		const runtimeIdentity = await readCandidateRuntimeIdentity(page);
		expect(runtimeIdentity).toEqual({
			loaderBootstrapPresent: true,
			mainScriptLoaded: true,
		});
		const browserConfiguration = await readBrowserConfiguration(page);
		expect(browserConfiguration).toMatchObject({
			articleTheme: expectedArticleTheme,
			codeTheme: expectedCodeTheme,
			previewPresentation: "split",
			previewVisible: true,
			sourceVisible: true,
		});
		sourceBefore = await readCandidateSourceFingerprint(page);
		await startCandidateSourceDiagnostic(page);
		diagnosticStarted = true;
		diagnosticBefore = await readCandidateSourceDiagnostic(page);
		const sourceScreenshots = await captureCandidateTaskScreenshots(
			page,
			testInfo,
			{
				capture: page.locator(".easymde-immersive-preview-canvas").first(),
				markers: page
					.locator(previewSelector)
					.locator('input[type="checkbox"]'),
				onMarker: async ({
					captureBox,
					index,
					markerBox,
					scrollMetrics,
					visibleHeight,
					visibleWidth,
				}) => {
					const fingerprint = await readCandidateSourceFingerprint(page);
					const diagnostic = await readCandidateSourceDiagnostic(page);
					sourceTaskEvidence.push({
						capture: {
							height: captureBox.height,
							width: captureBox.width,
							visibleHeight,
							visibleWidth,
						},
						canonicalFingerprint: fingerprint,
						index,
						marker: {
							height: markerBox.height,
							width: markerBox.width,
						},
						scrollMetrics,
						diagnostic,
					});
				},
				peer: { selector: ".easymde-source-react .cm-scroller" },
				scrollRootSelector: ".easymde-immersive-preview-canvas",
				stem: "source-diagnostic-task",
			},
		);
		sourceAfterRestore = await readCandidateSourceFingerprint(page);
		diagnosticAfterRestore = await readCandidateSourceDiagnostic(page);
		expect(sourceAfterRestore).toEqual(sourceBefore);
		const postAfter = readCandidatePostFingerprint(postId);
		expect(postAfter).toEqual(postBefore);
		expect(sourceTaskEvidence).toHaveLength(19);
		await writePrivateEvidence(testInfo, {
			browserConfiguration,
			candidateBuild: candidateBuild.identity,
			copyAttempted: false,
			diagnosticStatus: "source-only-diagnostic",
			fullMutationGate: "not-evaluated",
			post: {
				before: postBefore,
				after: postAfter,
			},
			runtime: runtimeIdentity,
			screenshots: {
				files: sourceScreenshots,
				indices: sourceScreenshots.map(({ index }) => index),
			},
			source: {
				canonicalFingerprintAfterRestore: sourceAfterRestore,
				canonicalFingerprintBefore: sourceBefore,
				canonicalFingerprintPerTask: sourceTaskEvidence,
				beforeDiagnostic: diagnosticBefore,
				afterRestoreDiagnostic: diagnosticAfterRestore,
			},
			uploadAttempted: false,
		});
	} catch (error) {
		primaryError = error;
		let sourceAfterFailure = { state: "unavailable" };
		let diagnosticAfterFailure = { state: "unavailable" };
		let postAfterFailure = { state: "unavailable" };
		try {
			if (!page.isClosed()) {
				sourceAfterFailure = await readCandidateSourceFingerprint(page);
			}
		} catch {
			sourceAfterFailure = { state: "unavailable" };
		}
		try {
			if (!page.isClosed() && diagnosticStarted) {
				diagnosticAfterFailure = await readCandidateSourceDiagnostic(page);
			}
		} catch {
			diagnosticAfterFailure = { state: "unavailable" };
		}
		if (postId) {
			try {
				postAfterFailure = readCandidatePostFingerprint(postId);
			} catch {
				postAfterFailure = { state: "unavailable" };
			}
		}
		try {
			await writePrivateEvidence(testInfo, {
				copyAttempted: false,
				diagnosticStatus: "source-only-diagnostic-failed",
				failureCode: stableFailureCode(error),
				post: {
					afterFailure: postAfterFailure,
					before: postBefore,
				},
				source: {
					canonicalFingerprintAfterFailure: sourceAfterFailure,
					canonicalFingerprintBefore: sourceBefore,
					canonicalFingerprintPerTask: sourceTaskEvidence,
					beforeDiagnostic: diagnosticBefore,
					diagnosticAfterFailure,
				},
				uploadAttempted: false,
			});
		} catch {
			cleanupErrors.push(
				new Error(
					"wechat-copy-candidate-source-diagnostic-evidence-unavailable",
				),
			);
		}
		throw error;
	} finally {
		if (diagnosticStarted) {
			try {
				await stopCandidateSourceDiagnostic(page);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-diagnostic-cleanup-failed"),
				);
			}
		}
		if (canonicalImageRoute) {
			try {
				await page.unroute(canonicalImageSource, canonicalImageRoute);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-image-route-cleanup-failed"),
				);
			}
		}
		if (routeState) {
			try {
				await routeState.stop();
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-asset-route-cleanup-failed"),
				);
			}
		}
		if (cleanupErrors.length && (primaryError || testInfo.errors.length > 0)) {
			testInfo.errors.push(
				...cleanupErrors.map(({ message }) => ({ message })),
			);
			cleanupErrors.length = 0;
		}
	}
	if (cleanupErrors.length && !primaryError) {
		testInfo.errors.push(...cleanupErrors.map(({ message }) => ({ message })));
		cleanupErrors.length = 0;
		throw new Error("wechat-copy-performance-source-diagnostic-cleanup-failed");
	}
});
