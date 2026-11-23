import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(
	path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const phpSrcRoot = path.join(repoRoot, "src");

const MAX_PHP_PRODUCTION_FILE_LINES = 1200;

const ALLOWED_SRC_SUBDIRECTORIES = new Set([
	"Admin",
	"Content",
	"Frontend",
	"ImageHosting",
	"Rest",
	"Support",
	"Theme",
]);

function toPosixRepoPath(absolutePath) {
	return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function walkPhpSourceFiles(dir) {
	const results = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkPhpSourceFiles(fullPath));
			continue;
		}
		if (entry.name.endsWith(".php")) {
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

function stripPhpCommentsOnly(code) {
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
		if (ch === "#") {
			index += 1;
			while (index < length && code[index] !== "\n") index += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			index += 2;
			while (
				index < length &&
				!(code[index] === "*" && code[index + 1] === "/")
			) {
				if (code[index] === "\n") output += "\n";
				index += 1;
			}
			index += 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
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

const phpProductionFiles = walkPhpSourceFiles(phpSrcRoot);

test("all PHP production files under src/ respect the strict 1,200-line ceiling with zero legacy exemptions", () => {
	assert.ok(
		phpProductionFiles.length > 0,
		"Expected PHP production files under src/",
	);

	const violations = [];

	for (const filePath of phpProductionFiles) {
		const relPath = toPosixRepoPath(filePath);
		const lineCount = countLines(readFileSync(filePath, "utf8"));
		if (lineCount > MAX_PHP_PRODUCTION_FILE_LINES) {
			violations.push(
				`${relPath}: ${lineCount} lines exceeds strict ceiling of ${MAX_PHP_PRODUCTION_FILE_LINES} lines`,
			);
		}
	}

	assert.deepEqual(
		violations,
		[],
		`PHP production file-size ceiling violations:\n${violations.join("\n")}`,
	);
});

test("all PHP production files under src/ follow PSR-4 namespace, PascalCase filename, and ABSPATH guard invariants", () => {
	const violations = [];

	for (const filePath of phpProductionFiles) {
		const relPath = toPosixRepoPath(filePath);
		const relFromSrc = path.posix.relative("src", relPath);
		const dir = path.posix.dirname(relFromSrc);
		const baseName = path.posix.basename(relPath, ".php");
		const source = readFileSync(filePath, "utf8");
		const code = stripPhpCommentsOnly(source);

		if (dir === ".") {
			if (baseName !== "Plugin") {
				violations.push(
					`${relPath}: root src/ PHP file must be Plugin.php (found ${baseName}.php)`,
				);
			}
		} else {
			const topLevelDir = dir.split("/")[0];
			if (!ALLOWED_SRC_SUBDIRECTORIES.has(topLevelDir)) {
				violations.push(
					`${relPath}: unexpected src/ subdirectory "${topLevelDir}"`,
				);
			}
		}

		if (!/^[A-Z][A-Za-z0-9]*$/.test(baseName)) {
			violations.push(
				`${relPath}: filename "${baseName}.php" must be PascalCase`,
			);
		}

		const expectedNamespace =
			dir === "." ? "EasyMDE" : `EasyMDE\\${dir.split("/").join("\\")}`;
		const namespaceMatch = code.match(
			/^\s*namespace\s+([A-Za-z_][A-Za-z0-9_\\]*)\s*;/m,
		);
		if (!namespaceMatch) {
			violations.push(
				`${relPath}: missing namespace declaration (expected ${expectedNamespace})`,
			);
		} else if (namespaceMatch[1] !== expectedNamespace) {
			violations.push(
				`${relPath}: namespace "${namespaceMatch[1]}" does not match expected "${expectedNamespace}"`,
			);
		}

		const typeMatch = code.match(
			/(?:^|\s)(?:(?:final|abstract)\s+)*(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/m,
		);
		if (!typeMatch) {
			violations.push(
				`${relPath}: missing class, interface, or trait declaration matching "${baseName}"`,
			);
		} else if (typeMatch[1] !== baseName) {
			violations.push(
				`${relPath}: declared type "${typeMatch[1]}" does not match filename "${baseName}.php"`,
			);
		}

		if (
			!/if\s*\(\s*!\s*defined\(\s*['"]ABSPATH['"]\s*\)\s*\)\s*\{\s*(?:exit|die)\s*(?:\(\s*\))?\s*;\s*\}/s.test(
				code,
			)
		) {
			violations.push(
				`${relPath}: missing ABSPATH direct-access guard`,
			);
		}
	}

	assert.deepEqual(
		violations,
		[],
		`PHP namespace, naming, and ABSPATH guard violations:\n${violations.join("\n")}`,
	);
});

test("src/Support/ and src/Frontend/ never reference EasyMDE\\Admin\\ or EasyMDE\\Rest\\", () => {
	const protectedPrefixes = ["src/Support/", "src/Frontend/"];
	const forbiddenReferencePattern = /\\?EasyMDE\\(Admin|Rest)(?:\\|\b)/g;
	const violations = [];

	for (const filePath of phpProductionFiles) {
		const relPath = toPosixRepoPath(filePath);
		if (!protectedPrefixes.some((prefix) => relPath.startsWith(prefix))) {
			continue;
		}
		const source = readFileSync(filePath, "utf8");
		const code = stripPhpCommentsOnly(source);
		for (const match of code.matchAll(forbiddenReferencePattern)) {
			violations.push(
				`${relPath}: forbidden reference to "${match[0]}"`,
			);
		}
	}

	assert.deepEqual(
		violations,
		[],
		`PHP architectural boundary violations:\n${violations.join("\n")}`,
	);
});
