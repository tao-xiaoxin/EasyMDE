import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(
	path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const frontendSrcRoot = path.join(repoRoot, "frontend", "src");

const MAX_PRODUCTION_FILE_LINES = 1200;
const MAX_ZERO_JSX_TSX_LINES = 400;

/**
 * Explicit monotonic line-count ceilings for pre-existing production files
 * exceeding 1,200 lines. These files may only shrink over time and must never
 * grow past their recorded ceiling. Once shrunk below 1,200 lines (or removed),
 * cleanup PRs can delete their entry from this map.
 */
const LEGACY_LARGE_FILE_LINE_CEILINGS = {
	"frontend/src/app/editor/EditorRoot.tsx": 6395,
	"frontend/src/app/settings/ImagesSettingsPage.tsx": 1712,
	"frontend/src/app/settings/SettingsCenterRoot.tsx": 1426,
	"frontend/src/features/immersive-editor/ui/ImmersiveVisualEditor.tsx": 34829,
	"frontend/src/features/immersive-editor/ui/WindowedImmersiveVisualEditor.tsx": 20999,
	"frontend/src/features/immersive-editor/visual-markdown.ts": 16524,
	"frontend/src/features/live-preview/ui/PreviewSurfaceOwner.tsx": 6821,
	"frontend/src/integrations/browser/wechat/create-browser-wechat-clipboard.ts": 3474,
};

/**
 * Pre-existing zero-JSX multi-thousand-line `.tsx` controllers slated for
 * replacement under ADR-002. No new `.tsx` file over 400 lines may omit JSX.
 */
const LEGACY_ZERO_JSX_LARGE_TSX_ALLOWLIST = new Set([
	"frontend/src/features/immersive-editor/ui/ImmersiveVisualEditor.tsx",
	"frontend/src/features/immersive-editor/ui/WindowedImmersiveVisualEditor.tsx",
]);

/**
 * Single pre-existing type-only import of `ImmersiveStrings` from
 * `immersive-editor-ui-types.ts` pending extraction into `contracts/`.
 * No component or runtime import from `immersive-editor/ui/` is permitted.
 */
const LEGACY_EDITOR_CONTEXT_MENU_IMMERSIVE_UI_IMPORTS = new Set([
	"frontend/src/features/editor-context-menu/ui/EditorTableDialog.tsx -> frontend/src/features/immersive-editor/ui/immersive-editor-ui-types",
]);

function toPosixRepoPath(absolutePath) {
	return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function walkProductionSourceFiles(dir) {
	const results = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkProductionSourceFiles(fullPath));
			continue;
		}
		if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
		) {
			results.push(fullPath);
		}
	}
	return results.sort();
}

function countLines(source) {
	if (source.length === 0) return 0;
	const normalized = source.replace(/\r\n/g, "\n");
	const parts = normalized.split("\n");
	return normalized.endsWith("\n") ? parts.length - 1 : parts.length;
}

function stripCommentsAndStrings(code) {
	let output = "";
	let index = 0;
	const length = code.length;
	while (index < length) {
		const ch = code[index];
		const next = code[index + 1];
		if (ch === "/" && next === "/") {
			index += 2;
			while (index < length && code[index] !== "\n") index += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			index += 2;
			while (index < length && !(code[index] === "*" && code[index + 1] === "/")) {
				if (code[index] === "\n") output += "\n";
				index += 1;
			}
			index += 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const quote = ch;
			output += " ";
			index += 1;
			while (index < length && code[index] !== quote) {
				if (code[index] === "\\") {
					index += 2;
				} else {
					if (code[index] === "\n") output += "\n";
					index += 1;
				}
			}
			index += 1;
			continue;
		}
		if (ch === "`") {
			output += " ";
			index += 1;
			while (index < length && code[index] !== "`") {
				if (code[index] === "\\") {
					index += 2;
				} else {
					if (code[index] === "\n") output += "\n";
					index += 1;
				}
			}
			index += 1;
			continue;
		}
		output += ch;
		index += 1;
	}
	return output;
}

function stripCommentsOnly(code) {
	let output = "";
	let index = 0;
	const length = code.length;
	while (index < length) {
		const ch = code[index];
		const next = code[index + 1];
		if (ch === "/" && next === "/") {
			index += 2;
			while (index < length && code[index] !== "\n") index += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			index += 2;
			while (index < length && !(code[index] === "*" && code[index + 1] === "/")) {
				if (code[index] === "\n") output += "\n";
				index += 1;
			}
			index += 2;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			output += ch;
			index += 1;
			while (index < length && code[index] !== quote) {
				if (code[index] === "\\") {
					output += code.slice(index, index + 2);
					index += 2;
				} else {
					output += code[index];
					index += 1;
				}
			}
			if (index < length) {
				output += code[index];
				index += 1;
			}
			continue;
		}
		output += ch;
		index += 1;
	}
	return output;
}

function extractRelativeImportTargets(relFile, source) {
	const code = stripCommentsOnly(source);
	const targets = [];
	const patterns = [
		/\b(?:import|export)\s+(?:type\s+)?(?:\*\s+as\s+[A-Za-z_$][\w$]*|\*|\{[^};"']*\}|[A-Za-z_$][\w$]*(?:\s*,\s*(?:\{[^};"']*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?)\s+from\s+["']([^"']+)["']/gu,
		/\bimport\s+["']([^"']+)["']/gu,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
	];
	for (const pattern of patterns) {
		for (const match of code.matchAll(pattern)) {
			const specifier = match[1];
			if (!specifier || !specifier.startsWith(".")) continue;
			const resolved = path.posix.normalize(
				path.posix.join(path.posix.dirname(relFile), specifier),
			);
			targets.push({ resolved, specifier });
		}
	}
	return targets;
}

function hasJsxOrCreateElement(rawSource) {
	const stripped = stripCommentsAndStrings(rawSource);
	const hasBareCreateElement = /(?<!\.)\bcreateElement\s*\(/.test(stripped);
	const hasReactCreateElement = /\bReact\.createElement\s*\(/.test(stripped);
	const hasClosingJsxTag = /<\/[A-Za-z][A-Za-z0-9._-]*\s*>|<\/>/.test(stripped);
	const importsReactCreateElement =
		/\bimport\s*\{[^}]*\bcreateElement\b[^}]*\}\s*from\s*["'](?:@wordpress\/element|react)["']/.test(
			stripCommentsOnly(rawSource),
		);
	const hasSelfClosingJsxTag =
		importsReactCreateElement && /\/>/.test(stripped);
	return (
		hasBareCreateElement ||
		hasReactCreateElement ||
		hasClosingJsxTag ||
		hasSelfClosingJsxTag
	);
}

const productionFiles = walkProductionSourceFiles(frontendSrcRoot);

test("contracts/ and domain/ never import from features/, integrations/, app/, or entrypoints/", () => {
	const forbiddenPrefixes = [
		"frontend/src/features/",
		"frontend/src/integrations/",
		"frontend/src/app/",
		"frontend/src/entrypoints/",
	];
	const violations = [];

	for (const filePath of productionFiles) {
		const relPath = toPosixRepoPath(filePath);
		if (
			!relPath.startsWith("frontend/src/contracts/") &&
			!relPath.startsWith("frontend/src/domain/")
		) {
			continue;
		}
		const source = readFileSync(filePath, "utf8");
		for (const { resolved, specifier } of extractRelativeImportTargets(
			relPath,
			source,
		)) {
			if (forbiddenPrefixes.some((prefix) => resolved.startsWith(prefix))) {
				violations.push(`${relPath} imports "${specifier}" -> ${resolved}`);
			}
		}
	}

	assert.deepEqual(
		violations,
		[],
		`Layering violations in contracts/ or domain/:\n${violations.join("\n")}`,
	);
});

test("shared/ never imports from features/, app/, or entrypoints/", () => {
	const forbiddenPrefixes = [
		"frontend/src/features/",
		"frontend/src/app/",
		"frontend/src/entrypoints/",
	];
	const violations = [];

	for (const filePath of productionFiles) {
		const relPath = toPosixRepoPath(filePath);
		if (!relPath.startsWith("frontend/src/shared/")) continue;
		const source = readFileSync(filePath, "utf8");
		for (const { resolved, specifier } of extractRelativeImportTargets(
			relPath,
			source,
		)) {
			if (forbiddenPrefixes.some((prefix) => resolved.startsWith(prefix))) {
				violations.push(`${relPath} imports "${specifier}" -> ${resolved}`);
			}
		}
	}

	assert.deepEqual(
		violations,
		[],
		`Layering violations in shared/:\n${violations.join("\n")}`,
	);
});

test("features/editor-context-menu/ never imports from features/immersive-editor/ui/", () => {
	const violations = [];

	for (const filePath of productionFiles) {
		const relPath = toPosixRepoPath(filePath);
		if (!relPath.startsWith("frontend/src/features/editor-context-menu/")) {
			continue;
		}
		const source = readFileSync(filePath, "utf8");
		for (const { resolved, specifier } of extractRelativeImportTargets(
			relPath,
			source,
		)) {
			if (!resolved.startsWith("frontend/src/features/immersive-editor/ui/")) {
				continue;
			}
			const edge = `${relPath} -> ${resolved}`;
			if (LEGACY_EDITOR_CONTEXT_MENU_IMMERSIVE_UI_IMPORTS.has(edge)) {
				continue;
			}
			violations.push(`${relPath} imports "${specifier}" -> ${resolved}`);
		}
	}

	assert.deepEqual(
		violations,
		[],
		`Forbidden cross-feature UI imports from editor-context-menu/ into immersive-editor/ui/:\n${violations.join("\n")}`,
	);
});

test("production frontend files respect the 1,200-line ceiling and monotonic legacy ratchet", () => {
	const violations = [];

	for (const filePath of productionFiles) {
		const relPath = toPosixRepoPath(filePath);
		const lineCount = countLines(readFileSync(filePath, "utf8"));
		const ceiling = Object.hasOwn(LEGACY_LARGE_FILE_LINE_CEILINGS, relPath)
			? LEGACY_LARGE_FILE_LINE_CEILINGS[relPath]
			: MAX_PRODUCTION_FILE_LINES;

		if (lineCount > ceiling) {
			violations.push(
				`${relPath}: ${lineCount} lines exceeds ceiling of ${ceiling} lines`,
			);
		}
	}

	assert.deepEqual(
		violations,
		[],
		`Frontend production file-size ratchet violations:\n${violations.join("\n")}`,
	);
});

test("no new .tsx file over 400 lines is a zero-JSX controller", () => {
	const violations = [];

	for (const filePath of productionFiles) {
		if (!filePath.endsWith(".tsx")) continue;
		const relPath = toPosixRepoPath(filePath);
		if (LEGACY_ZERO_JSX_LARGE_TSX_ALLOWLIST.has(relPath)) continue;

		const source = readFileSync(filePath, "utf8");
		const lineCount = countLines(source);
		if (lineCount <= MAX_ZERO_JSX_TSX_LINES) continue;

		if (!hasJsxOrCreateElement(source)) {
			violations.push(
				`${relPath}: ${lineCount} lines in a .tsx file without JSX or createElement()`,
			);
		}
	}

	assert.deepEqual(
		violations,
		[],
		`Zero-JSX large .tsx controller violations:\n${violations.join("\n")}`,
	);
});
