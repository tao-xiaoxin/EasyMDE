import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryRoot } from "./environment.mjs";

export const candidateFrontendBuildRoot = join(
	repositoryRoot,
	".cache/easymde-frontend-production-check",
);
export const candidateLoaderBuildRoot = join(
	repositoryRoot,
	".cache/easymde-admin-editor-loader-production-check",
);
export const candidateSourceEntries = {
	loader: "frontend/src/entrypoints/admin-editor-loader.ts",
	main: "frontend/src/entrypoints/admin-editor.tsx",
	worker:
		"frontend/src/integrations/browser/wechat/wechat-png-encoder.worker.ts",
};
export const candidateApprovedAssetPrefixes = [
	"/wp-content/plugins/easymde/assets/build/",
	"/wp-content/plugins/easymde/assets/build/admin-editor-loader/",
];

export function readCurrentServerBundleIdentity() {
	const manifestPath = join(repositoryRoot, "assets/build/manifest.json");
	let manifestBytes;
	let manifest;
	try {
		manifestBytes = readFileSync(manifestPath);
		manifest = JSON.parse(manifestBytes.toString("utf8"));
	} catch {
		throw new Error(
			"wechat-copy-performance-current-artifact-manifest-unavailable",
		);
	}
	const entry = manifest?.["frontend/src/entrypoints/admin-editor.tsx"];
	if (
		!entry?.isEntry ||
		!/^assets\/admin-editor-[A-Za-z0-9_-]+\.js$/u.test(entry.file ?? "")
	) {
		throw new Error("wechat-copy-performance-current-artifact-entry-invalid");
	}
	let scriptBytes;
	try {
		scriptBytes = readFileSync(
			join(repositoryRoot, "assets/build", entry.file),
		);
	} catch {
		throw new Error("wechat-copy-performance-current-artifact-unavailable");
	}
	return {
		file: entry.file,
		manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
		scriptSha256: createHash("sha256").update(scriptBytes).digest("hex"),
	};
}

export function readServerImageSettings(runWp) {
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

export async function readServerBundleIdentity(page) {
	const currentArtifact = readCurrentServerBundleIdentity();
	try {
		return await page.evaluate(
			async ({
				expectedFile,
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
					artifactFile: expectedFile,
					artifactManifestSha256: expectedManifestSha256,
					artifactScriptSha256: expectedScriptSha256,
					documentScriptMatchesBootstrap: true,
					loadedScriptPathMatchesCurrentArtifact:
						mainScriptPath === expectedFile.split("/").pop(),
					loadedScriptShaMatchesCurrentArtifact:
						scriptSha256 === expectedScriptSha256,
					manifestEntryMatchesCurrentArtifact: manifestEntryMatches,
					manifestShaMatchesCurrentArtifact:
						manifestSha256 === expectedManifestSha256,
					serverManifestFetched: true,
				};
			},
			{
				expectedFile: currentArtifact.file,
				expectedManifestSha256: currentArtifact.manifestSha256,
				expectedScriptSha256: currentArtifact.scriptSha256,
			},
		);
	} catch {
		throw new Error(
			"wechat-copy-performance-server-bundle-identity-unavailable",
		);
	}
}

export function readCandidateBuildIdentity() {
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

export async function routeCandidateBuildAssets(page, build, origin) {
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
		url.origin === origin &&
		build.assets.some((asset) => assetMatches(asset, url.pathname));
	const handler = async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin !== origin || !approvedPath(url.pathname)) {
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

export async function readCandidateRuntimeIdentity(page) {
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
