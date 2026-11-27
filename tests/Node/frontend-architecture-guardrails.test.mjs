import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(
	path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const frontendSrcRoot = path.join(repoRoot, "frontend", "src");

const WARN_PRODUCTION_FILE_LINES = 1200;
const MAX_PRODUCTION_FILE_LINES = 1500;
const MAX_ZERO_JSX_TSX_LINES = 400;

/**
 * Explicit monotonic line-count ceilings for pre-existing production files
 * exceeding 1,500 lines. These files may only shrink over time and must never
 * grow past their recorded ceiling. Once shrunk below 1,500 lines (or removed),
 * cleanup PRs can delete their entry from this map.
 */
const LEGACY_LARGE_FILE_LINE_CEILINGS = {};

/**
 * Pre-existing zero-JSX multi-thousand-line `.tsx` controllers slated for
 * replacement under ADR-002. No new `.tsx` file over 400 lines may omit JSX.
 */
const LEGACY_ZERO_JSX_LARGE_TSX_ALLOWLIST = new Set();

/**
 * Pre-existing cross-feature UI import exemptions from `editor-context-menu/`
 * into `immersive-editor/ui/`. Cleared to zero; no runtime or type import from
 * `immersive-editor/ui/` is permitted.
 */
const LEGACY_EDITOR_CONTEXT_MENU_IMMERSIVE_UI_IMPORTS = new Set();

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
			!/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
			!/[-.]test-harness\.(ts|tsx)$/.test(entry.name)
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

function extractRelativeRuntimeImportTargets(relFile, source) {
	const code = stripCommentsOnly(source);
	const targets = [];
	// Match static value-bearing import/export statements, excluding `import type`
	// and `export type` declarations (which erase at runtime) and dynamic imports.
	const statementPattern =
		/(?:^|[;\n])\s*(import|export)\s+(?!type\b)([^;"']*?)\bfrom\s+["']([^"']+)["']|(?:^|[;\n])\s*import\s+["']([^"']+)["']/gu;
	for (const match of code.matchAll(statementPattern)) {
		const specifier = match[3] ?? match[4];
		if (!specifier || !specifier.startsWith(".")) continue;
		const clause = (match[2] ?? "").trim();
		// Skip named-only clauses where every binding is explicitly `type Foo`.
		if (clause.startsWith("{") && clause.endsWith("}")) {
			const bindings = clause
				.slice(1, -1)
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean);
			if (
				bindings.length > 0 &&
				bindings.every((part) => /^type\s+/u.test(part))
			) {
				continue;
			}
		}
		const resolved = path.posix.normalize(
			path.posix.join(path.posix.dirname(relFile), specifier),
		);
		targets.push({ resolved, specifier });
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

test("production frontend files respect the 1,500-line hard ceiling (1,200-line warning) and monotonic legacy ratchet", (t) => {
	const violations = [];
	const warnings = [];

	for (const filePath of productionFiles) {
		const relPath = toPosixRepoPath(filePath);
		const lineCount = countLines(readFileSync(filePath, "utf8"));
		// biome-ignore lint/suspicious/noPrototypeBuiltins: Keep ES2020 compatibility across all touched files.
		const ceiling = Object.prototype.hasOwnProperty.call(
			LEGACY_LARGE_FILE_LINE_CEILINGS,
			relPath,
		)
			? LEGACY_LARGE_FILE_LINE_CEILINGS[relPath]
			: MAX_PRODUCTION_FILE_LINES;

		if (lineCount > ceiling) {
			violations.push(
				`${relPath}: ${lineCount} lines exceeds hard ceiling of ${ceiling} lines`,
			);
		} else if (lineCount > WARN_PRODUCTION_FILE_LINES) {
			warnings.push(
				`${relPath}: ${lineCount} lines exceeds the ${WARN_PRODUCTION_FILE_LINES}-line warning threshold (hard ceiling: ${ceiling}). Agent action: review responsibilities, notify the user, and refactor or plan a focused modular split before reaching ${ceiling} lines.`,
			);
		}
	}

	for (const warning of warnings) {
		t.diagnostic(`[guardrail-warn] ${warning}`);
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

test("production frontend modules contain zero runtime circular dependencies", () => {
	const knownKeys = new Set(
		productionFiles.map((filePath) =>
			toPosixRepoPath(filePath).replace(/\.(ts|tsx)$/u, ""),
		),
	);
	const adjacency = new Map();

	for (const filePath of productionFiles) {
		const relPath = toPosixRepoPath(filePath);
		const key = relPath.replace(/\.(ts|tsx)$/u, "");
		const source = readFileSync(filePath, "utf8");
		const edges = [];
		for (const { resolved } of extractRelativeRuntimeImportTargets(
			relPath,
			source,
		)) {
			let target = resolved.replace(/\.(ts|tsx)$/u, "");
			if (!knownKeys.has(target) && knownKeys.has(`${target}/index`)) {
				target = `${target}/index`;
			}
			if (knownKeys.has(target)) {
				edges.push(target);
			}
		}
		adjacency.set(key, [...new Set(edges)]);
	}

	const visited = new Set();
	const active = new Set();
	const cycles = [];

	function visit(node, trail) {
		visited.add(node);
		active.add(node);
		for (const next of adjacency.get(node) ?? []) {
			if (active.has(next)) {
				cycles.push([...trail.slice(trail.indexOf(next)), next].join(" -> "));
			} else if (!visited.has(next)) {
				visit(next, [...trail, next]);
			}
		}
		active.delete(node);
	}

	for (const key of adjacency.keys()) {
		if (!visited.has(key)) {
			visit(key, [key]);
		}
	}

	assert.deepEqual(
		cycles,
		[],
		`Runtime circular import cycles detected:\n${cycles.join("\n")}`,
	);
});
