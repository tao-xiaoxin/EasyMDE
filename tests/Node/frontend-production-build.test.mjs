import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";

import {
	compareAdminEditorLoaderProductionBuilds,
	compareCodeCopyProductionBuilds,
	compareEditorBlockIndexWorkerProductionBuilds,
	compareFrontendBootstrapProductionBuilds,
	compareFrontendEnhancementsProductionBuilds,
	compareFrontendMermaidProductionBuilds,
	compareFrontendProductionBuilds,
	compareMediaPickerProductionBuilds,
	compareSettingsProductionBuilds,
	validateAdminEditorLoaderProductionBuild,
	validateCodeCopyProductionBuild,
	validateEditorBlockIndexWorkerProductionBuild,
	validateFrontendBootstrapProductionBuild,
	validateFrontendEnhancementsProductionBuild,
	validateFrontendMermaidProductionBuild,
	validateFrontendProductionBuild,
	validateMediaPickerProductionBuild,
	validateSettingsProductionBuild,
} from "../../scripts/verify-frontend-build.mjs";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outputRoot = join(repoRoot, ".cache/easymde-frontend-production-check");
const settingsOutputRoot = join(
	repoRoot,
	".cache/easymde-settings-production-check",
);
const committedSettingsOutputRoot = join(
	repoRoot,
	"assets/build/settings-center",
);
const settingsSourceEntry = "frontend/src/entrypoints/settings-center.tsx";
const committedOutputRoot = join(repoRoot, "assets/build");
const sourceEntry = "frontend/src/entrypoints/admin-editor.tsx";
const wechatPngEncoderWorkerSource =
	"frontend/src/integrations/browser/wechat/wechat-png-encoder.worker.ts";
const wechatPngEncoderWorkerPattern =
	/^assets\/wechat-png-encoder-[a-zA-Z0-9_-]+\.js$/;
const embeddedNamespaceUrls = new Set([
	"http://www.w3.org/1998/Math/MathML",
	"http://www.w3.org/2000/svg",
	"http://www.w3.org/1999/xhtml",
]);
const httpUrlPattern = /https?:\/\/[A-Za-z0-9._~:/?#\x5B\x5D@!$&'*+,;=%-]+/gi;
const localDevelopmentTokenPattern = /localhost|127\.0\.0\.1/gi;
const adminEditorLoaderOutputRoot = join(
	repoRoot,
	".cache/easymde-admin-editor-loader-production-check",
);
const committedAdminEditorLoaderOutputRoot = join(
	repoRoot,
	"assets/build/admin-editor-loader",
);
const adminEditorLoaderSourceEntry =
	"frontend/src/entrypoints/admin-editor-loader.ts";
const codeCopyOutputRoot = join(
	repoRoot,
	".cache/easymde-code-copy-production-check",
);
const committedCodeCopyOutputRoot = join(repoRoot, "assets/build/code-copy");
const codeCopySourceEntry = "frontend/src/entrypoints/frontend-code-copy.ts";
const enhancementsOutputRoot = join(
	repoRoot,
	".cache/easymde-frontend-enhancements-production-check",
);
const committedEnhancementsOutputRoot = join(
	repoRoot,
	"assets/build/frontend-enhancements",
);
const bootstrapOutputRoot = join(
	repoRoot,
	".cache/easymde-frontend-bootstrap-production-check",
);
const committedBootstrapOutputRoot = join(
	repoRoot,
	"assets/build/frontend-bootstrap",
);
const mermaidOutputRoot = join(
	repoRoot,
	".cache/easymde-frontend-mermaid-production-check",
);
const committedMermaidOutputRoot = join(
	repoRoot,
	"assets/build/frontend-mermaid",
);
const mediaPickerOutputRoot = join(
	repoRoot,
	".cache/easymde-media-picker-production-check",
);
const committedMediaPickerOutputRoot = join(
	repoRoot,
	"assets/build/media-picker",
);
const mediaPickerSourceEntry =
	"frontend/src/entrypoints/media-picker-bridge.ts";
const editorBlockIndexWorkerOutputRoot = join(
	repoRoot,
	".cache/easymde-editor-block-index-worker-production-check",
);
const committedEditorBlockIndexWorkerOutputRoot = join(
	repoRoot,
	"assets/build/editor-block-index-worker",
);
const editorBlockIndexWorkerSourceEntry =
	"frontend/src/entrypoints/editor-block-index-worker.ts";
let buildResult;

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function stripApprovedVendorTokens(source) {
	return source
		.replaceAll("(see https://prosemirror.net/docs/guide/#generatable)", "")
		.replaceAll("(?:localhost|${this.get_ipv6_url_host().source}", "")
		.replaceAll("`http://${", "`");
}

function findUnexpectedHttpUrls(source) {
	return (source.match(httpUrlPattern) ?? []).filter(
		(url) => !embeddedNamespaceUrls.has(url),
	);
}

function findUnexpectedLocalDevelopmentTokens(source) {
	return source.match(localDevelopmentTokenPattern) ?? [];
}

before(() => {
	buildResult = spawnSync("npm", ["run", "check:frontend-production"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
});

test("URL policy allows only exact embedded MathML, SVG, and XHTML namespaces", () => {
	assert.deepEqual(
		findUnexpectedHttpUrls(
			`${[...embeddedNamespaceUrls].join(" ")} http://www.w3.org/2000/svg`,
		),
		[],
	);

	for (const [label, url] of [
		["unapproved HTTPS remote", "https://cdn.example.test/runtime.js"],
		["localhost development URL", "http://localhost:5173/@vite/client"],
		[
			"MathML namespace with suffix",
			"http://www.w3.org/1998/Math/MathML#suffix",
		],
		[
			"MathML namespace with query",
			"http://www.w3.org/1998/Math/MathML?query=1",
		],
		["SVG namespace with suffix", "http://www.w3.org/2000/svg#suffix"],
		["SVG namespace with query", "http://www.w3.org/2000/svg?query=1"],
		["XHTML namespace with suffix", "http://www.w3.org/1999/xhtml#suffix"],
		["XHTML namespace with query", "http://www.w3.org/1999/xhtml?query=1"],
		["lookalike MathML host", "http://www.w3.org.example/1998/Math/MathML"],
	]) {
		assert.deepEqual(findUnexpectedHttpUrls(url), [url], label);
	}

	for (const [label, token] of [
		["bare localhost development token", "localhost"],
		["bare loopback development token", "127.0.0.1"],
	]) {
		assert.deepEqual(
			findUnexpectedLocalDevelopmentTokens(token),
			[token],
			label,
		);
	}
});

test("root package exposes the production frontend build and includes it in the frontend gate", () => {
	const packageJson = readJson(join(repoRoot, "package.json"));
	const packageLock = readJson(join(repoRoot, "package-lock.json"));

	assert.equal(
		packageJson.scripts["build:frontend"],
		"vite build --config frontend/vite.production.config.ts && vite build --config frontend/vite.admin-editor-loader.config.ts && vite build --config frontend/vite.code-copy.config.ts && vite build --config frontend/vite.enhancements.config.ts && vite build --config frontend/vite.bootstrap.config.ts && vite build --config frontend/vite.mermaid.config.ts && vite build --config frontend/vite.settings.config.ts && vite build --config frontend/vite.media-picker.config.ts && vite build --config frontend/vite.editor-block-index-worker.config.ts && node scripts/verify-frontend-build.mjs --production",
	);
	assert.equal(
		packageJson.scripts["check:frontend-production"],
		"vite build --mode easymde-check --config frontend/vite.production.config.ts && vite build --mode easymde-check --config frontend/vite.admin-editor-loader.config.ts && vite build --mode easymde-check --config frontend/vite.code-copy.config.ts && vite build --mode easymde-check --config frontend/vite.enhancements.config.ts && vite build --mode easymde-check --config frontend/vite.bootstrap.config.ts && vite build --mode easymde-check --config frontend/vite.mermaid.config.ts && vite build --mode easymde-check --config frontend/vite.settings.config.ts && vite build --mode easymde-check --config frontend/vite.media-picker.config.ts && vite build --mode easymde-check --config frontend/vite.editor-block-index-worker.config.ts && node scripts/verify-frontend-build.mjs --production-check",
	);
	assert.equal(
		packageJson.scripts["frontend:check"],
		"npm run icons:check && npm run lint:frontend && npm run typecheck:frontend && npm run test:frontend && npm run build:frontend-contract && npm run check:frontend-production",
	);
	assert.equal(packageJson.dependencies.mermaid, "10.9.6");
	assert.equal(packageLock.packages[""].dependencies.mermaid, "10.9.6");
	assert.equal(packageLock.packages["node_modules/mermaid"].version, "10.9.6");
});

test("production build emits a separate self-contained TypeScript code-copy entry", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	assert.equal(existsSync(codeCopyOutputRoot), true);

	const viteManifest = readJson(join(codeCopyOutputRoot, "manifest.json"));
	const wordpressManifest = readJson(
		join(codeCopyOutputRoot, "wordpress-manifest.json"),
	);
	const viteEntry = viteManifest[codeCopySourceEntry];
	const wordpressEntry = wordpressManifest.entries[codeCopySourceEntry];

	assert.equal(wordpressManifest.schemaVersion, 1);
	assert.equal(viteEntry.isEntry, true);
	assert.match(
		viteEntry.file,
		/^assets\/frontend-code-copy-[a-zA-Z0-9_-]+\.js$/,
	);
	assert.equal(wordpressEntry.handle, "easymde-code-copy");
	assert.equal(wordpressEntry.file, viteEntry.file);
	assert.equal(
		wordpressEntry.asset,
		viteEntry.file.replace(/\.js$/, ".asset.php"),
	);
	assert.deepEqual(wordpressEntry.dependencies, []);
	assert.deepEqual(wordpressEntry.resources, []);

	const script = readFileSync(join(codeCopyOutputRoot, viteEntry.file), "utf8");
	assert.match(script, /easymde-code-copy__button/);
	assert.doesNotMatch(
		script,
		/wp\.element|@wordpress\/element|react(?:-dom)?/i,
	);
	assert.doesNotMatch(script, /EasyMDECodeCopy/);
	assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
	validateCodeCopyProductionBuild(codeCopyOutputRoot);
});

test("production build emits one independent WordPress settings-center React entry", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	assert.equal(existsSync(settingsOutputRoot), true);

	const viteManifest = readJson(join(settingsOutputRoot, "manifest.json"));
	const wordpressManifest = readJson(
		join(settingsOutputRoot, "wordpress-manifest.json"),
	);
	const viteEntry = viteManifest[settingsSourceEntry];
	const wordpressEntry = wordpressManifest.entries[settingsSourceEntry];

	assert.equal(wordpressManifest.schemaVersion, 1);
	assert.equal(viteEntry.isEntry, true);
	assert.match(viteEntry.file, /^assets\/settings-center-[a-zA-Z0-9_-]+\.js$/);
	assert.equal(wordpressEntry.handle, "easymde-admin-settings-center");
	assert.equal(wordpressEntry.file, viteEntry.file);
	assert.equal(
		wordpressEntry.asset,
		viteEntry.file.replace(/\.js$/, ".asset.php"),
	);
	assert.deepEqual(wordpressEntry.dependencies, ["wp-element"]);
	assert.deepEqual(wordpressEntry.resources, []);

	const script = readFileSync(join(settingsOutputRoot, viteEntry.file), "utf8");
	assert.match(script, /wp\.element/);
	assert.match(script, /EasyMDESettingsCenterBootstrap/);
	assert.doesNotMatch(
		script,
		/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/,
	);
	assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
	validateSettingsProductionBuild(settingsOutputRoot);
});

test("production build emits an independent WordPress media picker bridge entry", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	assert.equal(existsSync(mediaPickerOutputRoot), true);

	const viteManifest = readJson(join(mediaPickerOutputRoot, "manifest.json"));
	const wordpressManifest = readJson(
		join(mediaPickerOutputRoot, "wordpress-manifest.json"),
	);
	const viteEntry = viteManifest[mediaPickerSourceEntry];
	const wordpressEntry = wordpressManifest.entries[mediaPickerSourceEntry];

	assert.equal(wordpressManifest.schemaVersion, 1);
	assert.equal(viteEntry.isEntry, true);
	assert.match(
		viteEntry.file,
		/^assets\/media-picker-bridge-[a-zA-Z0-9_-]+\.js$/,
	);
	assert.equal(wordpressEntry.handle, "easymde-media-picker-bridge");
	assert.equal(wordpressEntry.file, viteEntry.file);
	assert.equal(
		wordpressEntry.asset,
		viteEntry.file.replace(/\.js$/, ".asset.php"),
	);
	assert.deepEqual(wordpressEntry.dependencies, ["media-editor"]);
	assert.deepEqual(wordpressEntry.resources, []);

	const script = readFileSync(
		join(mediaPickerOutputRoot, viteEntry.file),
		"utf8",
	);
	assert.match(script, /easymde-media-picker-connect/);
	assert.doesNotMatch(script, /wp-api-fetch|wp\.element|react(?:-dom)?/i);
	assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
	validateMediaPickerProductionBuild(mediaPickerOutputRoot);
});

test("production build emits one local non-React editor block-index worker entry", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	assert.equal(existsSync(editorBlockIndexWorkerOutputRoot), true);

	const viteManifest = readJson(
		join(editorBlockIndexWorkerOutputRoot, "manifest.json"),
	);
	const wordpressManifest = readJson(
		join(editorBlockIndexWorkerOutputRoot, "wordpress-manifest.json"),
	);
	const viteEntry = viteManifest[editorBlockIndexWorkerSourceEntry];
	const wordpressEntry =
		wordpressManifest.entries[editorBlockIndexWorkerSourceEntry];

	assert.equal(wordpressManifest.schemaVersion, 1);
	assert.equal(viteEntry.isEntry, true);
	assert.match(
		viteEntry.file,
		/^assets\/editor-block-index-worker-[a-zA-Z0-9_-]+\.js$/,
	);
	assert.equal(wordpressEntry.handle, "easymde-editor-block-index-worker");
	assert.equal(wordpressEntry.file, viteEntry.file);
	assert.equal(
		wordpressEntry.asset,
		viteEntry.file.replace(/\.js$/, ".asset.php"),
	);
	assert.deepEqual(wordpressEntry.dependencies, []);
	assert.deepEqual(wordpressEntry.resources, []);

	const script = readFileSync(
		join(editorBlockIndexWorkerOutputRoot, viteEntry.file),
		"utf8",
	);
	assert.match(script, /createEditorMarkdownBlockIndex|editor-block-index/);
	assert.doesNotMatch(script, /wp\.element|react(?:-dom)?/i);
	assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
	validateEditorBlockIndexWorkerProductionBuild(
		editorBlockIndexWorkerOutputRoot,
	);
});

test("production build emits an ESM WordPress editor React entry with dynamic chunks and PNG worker resource", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	assert.equal(existsSync(outputRoot), true);

	const viteManifest = readJson(join(outputRoot, "manifest.json"));
	const wordpressManifest = readJson(
		join(outputRoot, "wordpress-manifest.json"),
	);
	const viteEntry = viteManifest[sourceEntry];
	const wordpressEntry = wordpressManifest.entries[sourceEntry];

	assert.equal(wordpressManifest.schemaVersion, 1);
	assert.equal(viteEntry.isEntry, true);
	assert.match(viteEntry.file, /^assets\/admin-editor-[a-zA-Z0-9_-]+\.js$/);
	assert.equal(wordpressEntry.handle, "easymde-admin-editor-toolbar");
	assert.equal(wordpressEntry.file, viteEntry.file);
	assert.equal(
		wordpressEntry.asset,
		viteEntry.file.replace(/\.js$/, ".asset.php"),
	);
	assert.equal(wordpressEntry.moduleFormat, "esm");
	assert.deepEqual(wordpressEntry.dependencies, [
		"wp-api-fetch",
		"wp-element",
		"wp-hooks",
		"wp-i18n",
	]);
	const workerManifest = viteManifest[wechatPngEncoderWorkerSource];
	assert.equal(workerManifest.isEntry, false);
	assert.equal(workerManifest.src, wechatPngEncoderWorkerSource);
	assert.match(workerManifest.file, wechatPngEncoderWorkerPattern);
	assert.deepEqual(wordpressEntry.resources, [workerManifest.file]);
	assert.equal(existsSync(join(outputRoot, workerManifest.file)), true);
	assert.equal(viteEntry.css, undefined);
	assert.ok(
		Array.isArray(viteEntry.dynamicImports) &&
			viteEntry.dynamicImports.length > 0,
	);
	assert.ok(
		viteEntry.dynamicImports.includes(
			"frontend/src/integrations/browser/wechat/create-browser-wechat-clipboard.ts",
		),
	);
	assert.ok(
		viteEntry.dynamicImports.includes(
			"frontend/src/integrations/browser/wechat/create-browser-wechat-visual-rasterizer.ts",
		),
	);
	assert.ok(
		viteEntry.dynamicImports.includes(
			"frontend/src/features/immersive-editor/ui/ImmersivePublishDialog.tsx",
		),
	);
	assert.ok(
		viteEntry.dynamicImports.includes(
			"frontend/src/features/appearance/ui/ImmersiveCustomCssDialog.tsx",
		),
	);
	assert.ok(
		Array.isArray(wordpressEntry.chunks) && wordpressEntry.chunks.length > 0,
	);
	for (const chunk of wordpressEntry.chunks) {
		assert.match(chunk, /^assets\/admin-editor-chunk-[a-zA-Z0-9_-]+\.js$/);
		assert.equal(existsSync(join(outputRoot, chunk)), true);
	}
	const directStaticImports = viteEntry.imports ?? [];
	assert.ok(
		directStaticImports.length <= 3,
		`Expected admin-editor entry to statically import at most 3 chunks, got ${directStaticImports.length}.`,
	);
	const staticImportKeys = new Set();
	const pendingStaticImports = [...directStaticImports];
	while (pendingStaticImports.length > 0) {
		const importKey = pendingStaticImports.pop();
		if (typeof importKey !== "string" || staticImportKeys.has(importKey)) {
			continue;
		}
		staticImportKeys.add(importKey);
		const importedRecord = viteManifest[importKey];
		if (Array.isArray(importedRecord?.imports)) {
			pendingStaticImports.push(...importedRecord.imports);
		}
	}
	assert.ok(
		staticImportKeys.size <= 3,
		`Expected admin-editor initial static chunk graph to load at most 3 shared chunks, got ${staticImportKeys.size}.`,
	);

	const script = readFileSync(join(outputRoot, viteEntry.file), "utf8");
	const entryStaticCode = [
		script,
		...(viteEntry.imports ?? [])
			.map((key) => viteManifest[key]?.file)
			.filter((file) => typeof file === "string")
			.map((file) => readFileSync(join(outputRoot, file), "utf8")),
	].join("\n");
	const css = readFileSync(
		join(repoRoot, "assets/css/admin/toolbar.css"),
		"utf8",
	);
	const metadata = readFileSync(join(outputRoot, wordpressEntry.asset), "utf8");

	assert.match(entryStaticCode, /wp\.element/);
	assert.match(entryStaticCode, /wp\.i18n/);
	assert.doesNotMatch(entryStaticCode, /tannin|pluralForms|setLocaleData/);
	assert.match(script, /EasyMDEAdminEditorStart/);
	assert.doesNotMatch(
		entryStaticCode,
		/EasyMDEReactToolbar|EasyMDEReactDocumentSource/,
	);
	assert.match(entryStaticCode, /cm-editor/);
	assert.match(script, /import\(\s*[`"']\.\/admin-editor-chunk-/);

	const workerBasenamePattern = new RegExp(
		basename(workerManifest.file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	);
	let workerReferenced = false;
	for (const file of [viteEntry.file, ...wordpressEntry.chunks]) {
		const code = readFileSync(join(outputRoot, file), "utf8");
		if (workerBasenamePattern.test(code)) {
			workerReferenced = true;
		}
		assert.doesNotMatch(
			code,
			/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/,
		);
		assert.doesNotMatch(code, /\bresolveEditorBlockIndexWorkerUrl\b/);
		const sanitizedCode = stripApprovedVendorTokens(code);
		assert.deepEqual(findUnexpectedHttpUrls(sanitizedCode), []);
		assert.deepEqual(findUnexpectedLocalDevelopmentTokens(sanitizedCode), []);
		assert.doesNotMatch(code, /frontend\/src|sourceMappingURL=/);
		assert.equal(
			code.includes(".at("),
			false,
			`production editor bundle (${file}) must not contain Array.prototype.at`,
		);
		assert.doesNotMatch(code, /Object\.hasOwn\(/);
		assert.doesNotMatch(code, /\.replaceAll\(/);
	}
	assert.equal(
		workerReferenced,
		true,
		`Expected built admin-editor entry or chunks to reference ${workerManifest.file}.`,
	);
	assert.match(
		css,
		/\.easymde-react-toolbar-contents\s*\{[^}]*display:\s*contents;/s,
	);
	for (const dependency of [
		"wp-api-fetch",
		"wp-element",
		"wp-hooks",
		"wp-i18n",
	]) {
		assert.match(metadata, new RegExp(`'${dependency}'`));
	}
	assert.equal(
		readdirSync(outputRoot).some((name) => name.endsWith(".map")),
		false,
	);
	assert.equal(
		readdirSync(join(outputRoot, "assets")).some((name) =>
			name.endsWith(".map"),
		),
		false,
	);
	validateFrontendProductionBuild(outputRoot);
});

test("production build emits a head loader for the editor entry", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	assert.equal(existsSync(adminEditorLoaderOutputRoot), true);

	const viteManifest = readJson(
		join(adminEditorLoaderOutputRoot, "manifest.json"),
	);
	const wordpressManifest = readJson(
		join(adminEditorLoaderOutputRoot, "wordpress-manifest.json"),
	);
	const viteEntry = viteManifest[adminEditorLoaderSourceEntry];
	const wordpressEntry =
		wordpressManifest.entries[adminEditorLoaderSourceEntry];

	assert.equal(wordpressManifest.schemaVersion, 1);
	assert.equal(viteEntry.isEntry, true);
	assert.match(
		viteEntry.file,
		/^assets\/admin-editor-loader-[a-zA-Z0-9_-]+\.js$/,
	);
	assert.equal(wordpressEntry.handle, "easymde-admin-editor-toolbar");
	assert.equal(wordpressEntry.file, viteEntry.file);
	assert.equal(
		wordpressEntry.asset,
		viteEntry.file.replace(/\.js$/, ".asset.php"),
	);
	assert.deepEqual(wordpressEntry.dependencies, [
		"wp-api-fetch",
		"wp-element",
		"wp-hooks",
		"wp-i18n",
	]);
	assert.deepEqual(wordpressEntry.resources, []);

	const script = readFileSync(
		join(adminEditorLoaderOutputRoot, viteEntry.file),
		"utf8",
	);
	assert.match(script, /\.type=[`"']module[`"']/);
	assert.match(script, /fetch[Pp]riority|fetchpriority/);
	assert.match(script, /MutationObserver/);
	assert.match(script, /pagehide/);
	assert.match(script, /EasyMDEAdminEditorLoaderBootstrap/);
	assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
	validateAdminEditorLoaderProductionBuild(adminEditorLoaderOutputRoot);
});

test("production build emits shared enhancement, bootstrap, and Mermaid entries", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	for (const [root, entryKey, handle, validator] of [
		[
			enhancementsOutputRoot,
			"frontend/src/entrypoints/frontend-enhancements.ts",
			"easymde-enhancements",
			validateFrontendEnhancementsProductionBuild,
		],
		[
			bootstrapOutputRoot,
			"frontend/src/entrypoints/frontend-bootstrap.ts",
			"easymde-frontend",
			validateFrontendBootstrapProductionBuild,
		],
		[
			mermaidOutputRoot,
			"frontend/src/entrypoints/frontend-mermaid-runtime.ts",
			"easymde-mermaid",
			validateFrontendMermaidProductionBuild,
		],
		[
			settingsOutputRoot,
			settingsSourceEntry,
			"easymde-admin-settings-center",
			validateSettingsProductionBuild,
		],
	]) {
		const viteManifest = readJson(join(root, "manifest.json"));
		const wordpressManifest = readJson(join(root, "wordpress-manifest.json"));
		const viteEntry = viteManifest[entryKey];
		const wordpressEntry = wordpressManifest.entries[entryKey];

		assert.equal(viteEntry.isEntry, true);
		assert.equal(viteEntry.dynamicImports, undefined);
		assert.equal(wordpressEntry.handle, handle);
		assert.equal(wordpressEntry.file, viteEntry.file);
		assert.equal(
			wordpressEntry.asset,
			viteEntry.file.replace(/\.js$/, ".asset.php"),
		);
		assert.deepEqual(
			wordpressEntry.dependencies,
			entryKey === settingsSourceEntry ? ["wp-element"] : [],
		);
		assert.deepEqual(wordpressEntry.resources, []);
		validator(root);
	}

	const mermaidManifest = readJson(join(mermaidOutputRoot, "manifest.json"));
	const mermaidScript = readFileSync(
		join(
			mermaidOutputRoot,
			mermaidManifest["frontend/src/entrypoints/frontend-mermaid-runtime.ts"]
				.file,
		),
		"utf8",
	);
	const enhancementsManifest = readJson(
		join(enhancementsOutputRoot, "manifest.json"),
	);
	const enhancementsScript = readFileSync(
		join(
			enhancementsOutputRoot,
			enhancementsManifest["frontend/src/entrypoints/frontend-enhancements.ts"]
				.file,
		),
		"utf8",
	);
	assert.match(mermaidScript, /\.mermaid=/);
	assert.match(mermaidScript, /startOnLoad/);
	assert.match(enhancementsScript, /securityLevel:[`"']strict[`"']/);
	assert.doesNotMatch(
		mermaidScript,
		/assets\/vendor\/mermaid\/mermaid\.min\.js/,
	);
	assert.match(
		readFileSync(
			join(repoRoot, "frontend/src/entrypoints/frontend-bootstrap.ts"),
			"utf8",
		),
		/readyState/,
	);
});

test("Frontend enhancements validation rejects a weakened Mermaid security level", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	const weakenedRoot = mkdtempSync(
		join(tmpdir(), "easymde-enhancements-weakened-"),
	);
	const manifest = readJson(join(enhancementsOutputRoot, "manifest.json"));
	const scriptPath = join(
		weakenedRoot,
		manifest["frontend/src/entrypoints/frontend-enhancements.ts"].file,
	);
	cpSync(enhancementsOutputRoot, weakenedRoot, { recursive: true });

	try {
		const script = readFileSync(scriptPath, "utf8");
		const weakenedScript = script.replace(
			/securityLevel:[`"']strict[`"']/,
			'securityLevel:"loose"',
		);
		assert.notEqual(weakenedScript, script);
		writeFileSync(scriptPath, weakenedScript);
		assert.throws(
			() => validateFrontendEnhancementsProductionBuild(weakenedRoot),
			/Built script does not reference the Mermaid strict security level/,
		);
	} finally {
		rmSync(weakenedRoot, { recursive: true, force: true });
	}
});

test("production comparison rejects stale or omitted committed runtime artifacts", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	const generatedRoot = mkdtempSync(
		join(tmpdir(), "easymde-frontend-generated-"),
	);
	const committedRoot = mkdtempSync(
		join(tmpdir(), "easymde-frontend-committed-"),
	);
	cpSync(outputRoot, generatedRoot, { recursive: true });
	cpSync(outputRoot, committedRoot, { recursive: true });

	try {
		const manifest = readJson(join(committedRoot, "manifest.json"));
		const entry = manifest[sourceEntry];
		appendFileSync(join(committedRoot, entry.file), "\nstale runtime\n");
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/Committed production frontend artifact is stale/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(outputRoot, committedRoot, { recursive: true });
		rmSync(join(committedRoot, entry.file), { force: true });
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/Built script is missing|missing, stale, or unexpected/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(outputRoot, committedRoot, { recursive: true });
		const wordpressManifest = readJson(
			join(committedRoot, "wordpress-manifest.json"),
		);
		const firstChunk = wordpressManifest.entries[sourceEntry].chunks[0];
		appendFileSync(join(committedRoot, firstChunk), "\nstale chunk\n");
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/Committed production frontend artifact is stale/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(outputRoot, committedRoot, { recursive: true });
		rmSync(join(committedRoot, firstChunk), { force: true });
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/Built chunk is missing|missing, stale, or unexpected/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(outputRoot, committedRoot, { recursive: true });
		writeFileSync(
			join(committedRoot, "assets/admin-editor-chunk-orphan.js"),
			"export {};\n",
		);
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/missing, stale, or unexpected/,
		);
	} finally {
		rmSync(generatedRoot, { recursive: true, force: true });
		rmSync(committedRoot, { recursive: true, force: true });
	}
});

test("production comparison rejects stale, missing, or unowned PNG worker artifacts", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	const generatedRoot = mkdtempSync(
		join(tmpdir(), "easymde-worker-generated-"),
	);
	const committedRoot = mkdtempSync(
		join(tmpdir(), "easymde-worker-committed-"),
	);
	cpSync(outputRoot, generatedRoot, { recursive: true });
	cpSync(outputRoot, committedRoot, { recursive: true });

	try {
		const generatedManifest = readJson(join(generatedRoot, "manifest.json"));
		const worker = generatedManifest[wechatPngEncoderWorkerSource];
		appendFileSync(
			join(committedRoot, worker.file),
			"\nstale worker runtime\n",
		);
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/Committed production frontend artifact is stale/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(outputRoot, committedRoot, { recursive: true });
		rmSync(join(committedRoot, worker.file), { force: true });
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/Built resource is missing|missing, stale, or unexpected/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(outputRoot, committedRoot, { recursive: true });
		writeFileSync(
			join(committedRoot, "assets/unowned-worker.js"),
			"self.onmessage = () => {};\n",
		);
		assert.throws(
			() => compareFrontendProductionBuilds(generatedRoot, committedRoot),
			/missing, stale, or unexpected/,
		);
	} finally {
		rmSync(generatedRoot, { recursive: true, force: true });
		rmSync(committedRoot, { recursive: true, force: true });
	}
});

test("enhancement and bootstrap comparisons reject stale committed artifacts", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	compareAdminEditorLoaderProductionBuilds(
		adminEditorLoaderOutputRoot,
		committedAdminEditorLoaderOutputRoot,
	);
	compareFrontendEnhancementsProductionBuilds(
		enhancementsOutputRoot,
		committedEnhancementsOutputRoot,
	);
	compareFrontendBootstrapProductionBuilds(
		bootstrapOutputRoot,
		committedBootstrapOutputRoot,
	);
	compareFrontendMermaidProductionBuilds(
		mermaidOutputRoot,
		committedMermaidOutputRoot,
	);
	compareMediaPickerProductionBuilds(
		mediaPickerOutputRoot,
		committedMediaPickerOutputRoot,
	);
	compareEditorBlockIndexWorkerProductionBuilds(
		editorBlockIndexWorkerOutputRoot,
		committedEditorBlockIndexWorkerOutputRoot,
	);
	compareSettingsProductionBuilds(
		settingsOutputRoot,
		committedSettingsOutputRoot,
	);
});

test("code-copy production comparison rejects stale or omitted committed runtime artifacts", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	const generatedRoot = mkdtempSync(
		join(tmpdir(), "easymde-code-copy-generated-"),
	);
	const committedRoot = mkdtempSync(
		join(tmpdir(), "easymde-code-copy-committed-"),
	);
	cpSync(codeCopyOutputRoot, generatedRoot, { recursive: true });
	cpSync(codeCopyOutputRoot, committedRoot, { recursive: true });

	try {
		const manifest = readJson(join(committedRoot, "manifest.json"));
		const entry = manifest[codeCopySourceEntry];
		appendFileSync(join(committedRoot, entry.file), "\nstale runtime\n");
		assert.throws(
			() => compareCodeCopyProductionBuilds(generatedRoot, committedRoot),
			/Committed code-copy production artifact is stale/,
		);

		rmSync(committedRoot, { recursive: true, force: true });
		cpSync(codeCopyOutputRoot, committedRoot, { recursive: true });
		rmSync(join(committedRoot, entry.file), { force: true });
		assert.throws(
			() => compareCodeCopyProductionBuilds(generatedRoot, committedRoot),
			/Built script is missing|missing, stale, or unexpected/,
		);
	} finally {
		rmSync(generatedRoot, { recursive: true, force: true });
		rmSync(committedRoot, { recursive: true, force: true });
	}
});

test("production validation rejects remote URLs and absolute paths but allows site-relative URLs", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	for (const prohibited of [
		'const remote = "https://[::1]/runtime.js";',
		'const buildFile = "/srv/ci/workspace/runtime.js";',
		'const stylesheet = "url(/Users/builder/easymde/source.css)";',
	]) {
		const generatedRoot = mkdtempSync(
			join(tmpdir(), "easymde-frontend-unsafe-"),
		);
		cpSync(outputRoot, generatedRoot, { recursive: true });

		try {
			const manifest = readJson(join(generatedRoot, "manifest.json"));
			appendFileSync(
				join(generatedRoot, manifest[sourceEntry].file),
				`\n${prohibited}\n`,
			);
			assert.throws(
				() => validateFrontendProductionBuild(generatedRoot),
				/prohibited (?:remote runtime URL|absolute local path)/,
			);
		} finally {
			rmSync(generatedRoot, { recursive: true, force: true });
		}
	}

	for (const [prohibited, expectedError] of [
		[
			'const remote = "https://cdn.example.invalid/chunk.js";',
			/prohibited remote runtime URL/,
		],
		[
			'const internals = "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED";',
			/prohibited private React runtime/,
		],
		[
			'const source = "frontend/src/entrypoints/admin-editor.tsx";',
			/prohibited frontend source path/,
		],
		['const item = [1].at(-1);', /prohibited post-ES2020 \.at\(\) call/],
		[
			'const has = Object.hasOwn({}, "a");',
			/prohibited post-ES2020 Object\.hasOwn\(\) call/,
		],
		[
			'const normalized = "a b".replaceAll(" ", "-");',
			/prohibited post-ES2020 \.replaceAll\(\) call/,
		],
	]) {
		const generatedRoot = mkdtempSync(
			join(tmpdir(), "easymde-frontend-chunk-unsafe-"),
		);
		cpSync(outputRoot, generatedRoot, { recursive: true });

		try {
			const wordpressManifest = readJson(
				join(generatedRoot, "wordpress-manifest.json"),
			);
			const firstChunk = wordpressManifest.entries[sourceEntry].chunks[0];
			appendFileSync(join(generatedRoot, firstChunk), `\n${prohibited}\n`);
			assert.throws(
				() => validateFrontendProductionBuild(generatedRoot),
				expectedError,
			);
		} finally {
			rmSync(generatedRoot, { recursive: true, force: true });
		}
	}

	const generatedRoot = mkdtempSync(
		join(tmpdir(), "easymde-frontend-site-relative-"),
	);
	cpSync(outputRoot, generatedRoot, { recursive: true });

	try {
		const manifest = readJson(join(generatedRoot, "manifest.json"));
		appendFileSync(
			join(generatedRoot, manifest[sourceEntry].file),
			'\nconst previewPath = "/wp-json/easymde/v1/preview";\nconst stylesheet = "/wp-content/plugins/easymde/assets/frontend/code-frame.css";\n',
		);
		assert.doesNotThrow(() => validateFrontendProductionBuild(generatedRoot));
	} finally {
		rmSync(generatedRoot, { recursive: true, force: true });
	}
});

test("production frontend artifacts are eligible for version control", () => {
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
	const wordpressManifest = readJson(
		join(committedOutputRoot, "wordpress-manifest.json"),
	);
	const wordpressEntry = wordpressManifest.entries[sourceEntry];
	const adminEditorLoaderManifest = readJson(
		join(committedAdminEditorLoaderOutputRoot, "wordpress-manifest.json"),
	);
	const adminEditorLoaderEntry =
		adminEditorLoaderManifest.entries[adminEditorLoaderSourceEntry];
	const codeCopyWordpressManifest = readJson(
		join(committedCodeCopyOutputRoot, "wordpress-manifest.json"),
	);
	const codeCopyEntry = codeCopyWordpressManifest.entries[codeCopySourceEntry];
	const paths = [
		"assets/build/manifest.json",
		"assets/build/wordpress-manifest.json",
		`assets/build/${wordpressEntry.file}`,
		`assets/build/${wordpressEntry.asset}`,
		...wordpressEntry.chunks.map((chunk) => `assets/build/${chunk}`),
		`assets/build/${readJson(join(committedOutputRoot, "manifest.json"))[wechatPngEncoderWorkerSource].file}`,
		"assets/build/admin-editor-loader/manifest.json",
		"assets/build/admin-editor-loader/wordpress-manifest.json",
		`assets/build/admin-editor-loader/${readJson(join(committedAdminEditorLoaderOutputRoot, "manifest.json"))[adminEditorLoaderSourceEntry].file}`,
		`assets/build/admin-editor-loader/${adminEditorLoaderEntry.asset}`,
		"assets/build/code-copy/manifest.json",
		"assets/build/code-copy/wordpress-manifest.json",
		`assets/build/code-copy/${codeCopyEntry.file}`,
		`assets/build/code-copy/${codeCopyEntry.asset}`,
		"assets/build/settings-center/manifest.json",
		"assets/build/settings-center/wordpress-manifest.json",
		`assets/build/settings-center/${readJson(join(committedSettingsOutputRoot, "manifest.json"))[settingsSourceEntry].file}`,
		`assets/build/settings-center/${readJson(join(committedSettingsOutputRoot, "wordpress-manifest.json")).entries[settingsSourceEntry].asset}`,
		"assets/build/media-picker/manifest.json",
		"assets/build/media-picker/wordpress-manifest.json",
		`assets/build/media-picker/${readJson(join(committedMediaPickerOutputRoot, "manifest.json"))[mediaPickerSourceEntry].file}`,
		`assets/build/media-picker/${readJson(join(committedMediaPickerOutputRoot, "wordpress-manifest.json")).entries[mediaPickerSourceEntry].asset}`,
		"assets/build/editor-block-index-worker/manifest.json",
		"assets/build/editor-block-index-worker/wordpress-manifest.json",
		`assets/build/editor-block-index-worker/${readJson(join(committedEditorBlockIndexWorkerOutputRoot, "manifest.json"))[editorBlockIndexWorkerSourceEntry].file}`,
		`assets/build/editor-block-index-worker/${readJson(join(committedEditorBlockIndexWorkerOutputRoot, "wordpress-manifest.json")).entries[editorBlockIndexWorkerSourceEntry].asset}`,
	];
	const result = spawnSync("git", ["check-ignore", "--no-index", ...paths], {
		cwd: repoRoot,
		encoding: "utf8",
	});

	assert.equal(
		result.status,
		1,
		`production runtime artifacts must not match .gitignore:\n${result.stdout}${result.stderr}`,
	);
});
