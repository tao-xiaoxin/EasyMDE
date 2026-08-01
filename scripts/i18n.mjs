import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const textDomain = "easymde";
const potPath = "languages/easymde.pot";
const zhPoPath = "languages/easymde-zh_CN.po";
const zhMoPath = "languages/easymde-zh_CN.mo";
const zhJsPath = "languages/easymde-zh_CN-easymde-admin-editor-toolbar.json";
const jsSourceFiles = [
	"frontend/src/integrations/wordpress/i18n/create-wordpress-immersive-i18n-port.ts",
];
const phpSourceRoots = ["easymde.php", "includes", "src", "templates"];
const gettextKeywords = [
	"__:1",
	"_e:1",
	"_x:1,2c",
	"_ex:1,2c",
	"_n:1,2",
	"_nx:1,2,4c",
	"esc_html__:1",
	"esc_html_e:1",
	"esc_html_x:1,2c",
	"esc_attr__:1",
	"esc_attr_e:1",
	"esc_attr_x:1,2c",
	"source_label:1",
];

function fromRoot(root, path) {
	return join(root, path);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || defaultRoot,
		encoding: options.encoding || "utf8",
		stdio: options.stdio || "pipe",
	});

	if (0 !== result.status) {
		const detail = [result.stderr, result.stdout]
			.filter(Boolean)
			.join("\n")
			.trim();
		throw new Error(`${command} failed${detail ? `:\n${detail}` : "."}`);
	}

	return result;
}

function requireCommand(command) {
	const result = spawnSync(command, ["--version"], {
		encoding: "utf8",
		stdio: "pipe",
	});

	if (0 !== result.status) {
		throw new Error(
			`Missing required command: ${command}. Install GNU gettext before running EasyMDE i18n commands.`,
		);
	}
}

function pluginVersion(root) {
	const mainFile = readFileSync(fromRoot(root, "easymde.php"), "utf8");
	const header = mainFile
		.slice(0, 8192)
		.match(/\/\*\*[\s\S]*?^\s*\*\s*Plugin Name:\s*EasyMDE\s*$[\s\S]*?\*\//m);
	const match = header ? header[0].match(/^\s*\*\s*Version:\s*(.+)$/m) : null;

	if (!match) {
		throw new Error("Could not read plugin header Version from easymde.php.");
	}

	return match[1].trim();
}

function collectPhpFiles(root, path, files) {
	const absolute = fromRoot(root, path);

	if (!existsSync(absolute)) {
		return;
	}

	if (statSync(absolute).isFile()) {
		if (path.endsWith(".php")) {
			files.push(path);
		}
		return;
	}

	readdirSync(absolute)
		.sort()
		.forEach((entry) => {
			collectPhpFiles(root, join(path, entry), files);
		});
}

export function collectPhpSourceFiles(root = defaultRoot) {
	const files = [];

	phpSourceRoots.forEach((path) => collectPhpFiles(root, path, files));

	return files.sort();
}

function collectJsSourceFiles(root) {
	return jsSourceFiles.filter((path) => existsSync(fromRoot(root, path)));
}

function makeJsPot(root, output) {
	const sources = collectJsSourceFiles(root);
	if (!sources.length) return false;
	const result = run(
		"xgettext",
		[
			"--language=JavaScript",
			"--from-code=UTF-8",
			"--add-comments=translators:",
			"--keyword=_n:1,2",
			"-o",
			output,
			...sources,
		],
		{ cwd: root },
	);
	if (result.stderr.trim()) {
		throw new Error(
			`xgettext reported JavaScript warnings:\n${result.stderr.trim()}`,
		);
	}
	return true;
}

function potHeader(version) {
	return [
		"# Copyright (C) Tao Xiaoxin",
		"# This file is distributed under the Apache-2.0 license.",
		'msgid ""',
		'msgstr ""',
		`"Project-Id-Version: EasyMDE ${version}\\n"`,
		'"Report-Msgid-Bugs-To: https://github.com/tao-xiaoxin/EasyMDE/issues\\n"',
		'"MIME-Version: 1.0\\n"',
		'"Content-Type: text/plain; charset=UTF-8\\n"',
		'"Content-Transfer-Encoding: 8bit\\n"',
		`"X-Domain: ${textDomain}\\n"`,
		"",
	].join("\n");
}

function stripGeneratedPotHeader(content) {
	const headerStart = content.indexOf('msgid ""\nmsgstr ""\n');
	const bodyStart =
		-1 === headerStart ? -1 : content.indexOf("\n\n", headerStart);

	if (-1 === bodyStart) {
		throw new Error(
			"Could not separate the generated gettext header from POT messages.",
		);
	}

	return content.slice(bodyStart + 2).trim();
}

export function normalizePotSourceReferences(content) {
	return content.replace(/^#: .*$/gm, (reference) =>
		reference.replaceAll("\\", "/"),
	);
}

export function makePot(options = {}) {
	const root = options.root || defaultRoot;
	const output = options.output || fromRoot(root, potPath);
	const tempDir = mkdtempSync(join(tmpdir(), "easymde-pot-"));
	const bodyPath = join(tempDir, "messages.pot");
	const jsBodyPath = join(tempDir, "messages-js.pot");
	const mergedBodyPath = join(tempDir, "messages-merged.pot");
	const sources = collectPhpSourceFiles(root);

	try {
		requireCommand("xgettext");

		if (!sources.length) {
			throw new Error("No PHP source files found for POT generation.");
		}

		const result = run(
			"xgettext",
			[
				"--language=PHP",
				"--from-code=UTF-8",
				"--add-comments=translators:",
				...gettextKeywords.map((keyword) => `--keyword=${keyword}`),
				"-o",
				bodyPath,
				...sources,
			],
			{ cwd: root },
		);

		if (result.stderr.trim()) {
			throw new Error(`xgettext reported warnings:\n${result.stderr.trim()}`);
		}

		const catalogs = [bodyPath];
		if (makeJsPot(root, jsBodyPath)) {
			catalogs.push(jsBodyPath);
		}
		let mergedCatalog = catalogs[0];
		if (catalogs.length > 1) {
			requireCommand("msgcat");
			const merge = run(
				"msgcat",
				[
					"--force-po",
					"-o",
					mergedBodyPath,
					...catalogs,
				],
				{ cwd: root },
			);
			if (merge.stderr.trim()) {
				throw new Error(`msgcat reported warnings:\n${merge.stderr.trim()}`);
			}
			mergedCatalog = mergedBodyPath;
		}
		const body = normalizePotSourceReferences(
			stripGeneratedPotHeader(readFileSync(mergedCatalog, "utf8")),
		);
		if (!body) {
			throw new Error("POT generation produced no messages.");
		}

		writeFileSync(
			output,
			`${potHeader(pluginVersion(root))}\n${body}\n`,
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function decodePoQuoted(value) {
	return JSON.parse(value);
}

export function parsePoEntries(path) {
	const content = readFileSync(path, "utf8");
	const entries = [];
	let entry = {};
	let current = null;

	function ensureEntry() {
		if (!entry.msgstr) {
			entry.msgstr = {};
		}
	}

	function finishEntry() {
		if (Object.prototype.hasOwnProperty.call(entry, "msgid")) {
			entries.push(entry);
		}
		entry = {};
		current = null;
	}

	content.split(/\r?\n/).forEach((line) => {
		if ("" === line.trim()) {
			finishEntry();
			return;
		}

		if (line.startsWith("#")) {
			if (line.startsWith("#,")) {
				entry.flags = line
					.slice(2)
					.split(",")
					.map((flag) => flag.trim())
					.filter(Boolean);
			}
			return;
		}

		if (line.startsWith("msgctxt ")) {
			entry.msgctxt = decodePoQuoted(line.slice(8).trim());
			current = ["msgctxt"];
			return;
		}

		if (line.startsWith("msgid_plural ")) {
			entry.msgidPlural = decodePoQuoted(line.slice(13).trim());
			current = ["msgidPlural"];
			return;
		}

		if (line.startsWith("msgid ")) {
			entry.msgid = decodePoQuoted(line.slice(6).trim());
			current = ["msgid"];
			return;
		}

		if (line.startsWith("msgstr[")) {
			const match = line.match(/^msgstr\[(\d+)]\s+(.*)$/);
			if (!match) {
				throw new Error(`Could not parse PO plural string in ${path}: ${line}`);
			}
			ensureEntry();
			entry.msgstr[match[1]] = decodePoQuoted(match[2].trim());
			current = ["msgstr", match[1]];
			return;
		}

		if (line.startsWith("msgstr ")) {
			ensureEntry();
			entry.msgstr[0] = decodePoQuoted(line.slice(7).trim());
			current = ["msgstr", "0"];
			return;
		}

		if (line.startsWith('"') && current) {
			const value = decodePoQuoted(line.trim());
			if ("msgstr" === current[0]) {
				ensureEntry();
				entry.msgstr[current[1]] = (entry.msgstr[current[1]] || "") + value;
			} else {
				entry[current[0]] = (entry[current[0]] || "") + value;
			}
		}
	});

	finishEntry();

	return entries;
}

function entryKey(entry) {
	return `${entry.msgctxt || ""}\u0004${entry.msgid || ""}`;
}

function hasPoFlag(entry, flag) {
	return Array.isArray(entry.flags) && entry.flags.includes(flag);
}

function assertPoHeaders(entries) {
	const header = entries.find((entry) => "" === entry.msgid);
	const headerText = header && header.msgstr ? header.msgstr[0] || "" : "";
	const requiredHeaders = [
		"Language: zh_CN",
		"Content-Type: text/plain; charset=UTF-8",
		`X-Domain: ${textDomain}`,
	];

	requiredHeaders.forEach((required) => {
		if (!headerText.includes(required)) {
			throw new Error(
				`languages/easymde-zh_CN.po is missing header: ${required}`,
			);
		}
	});
}

function assertPoCoversPot(root) {
	const potEntries = parsePoEntries(fromRoot(root, potPath)).filter(
		(entry) => "" !== entry.msgid,
	);
	const poEntries = parsePoEntries(fromRoot(root, zhPoPath));
	const poByKey = new Map(poEntries.map((entry) => [entryKey(entry), entry]));
	const missing = [];
	const untranslated = [];
	const fuzzy = [];

	assertPoHeaders(poEntries);
	const pluralCount = Number(
		poHeaderValue(poEntries, "Plural-Forms").match(
			/(?:^|;\s*)nplurals=(\d+)/,
		)?.[1],
	);
	if (!Number.isInteger(pluralCount) || pluralCount < 1) {
		throw new Error(
			"languages/easymde-zh_CN.po has an invalid Plural-Forms nplurals value.",
		);
	}

	potEntries.forEach((potEntry) => {
		const poEntry = poByKey.get(entryKey(potEntry));

		if (!poEntry) {
			missing.push(potEntry.msgid);
			return;
		}

		if (hasPoFlag(poEntry, "fuzzy")) {
			fuzzy.push(potEntry.msgid);
			return;
		}

		if (potEntry.msgidPlural) {
			if (
				!poEntry.msgstr ||
				Array.from({ length: pluralCount }, (_, index) => index).some(
					(index) => !poEntry.msgstr[index],
				)
			) {
				untranslated.push(potEntry.msgid);
			}
			return;
		}

		if (!poEntry.msgstr || !poEntry.msgstr[0]) {
			untranslated.push(potEntry.msgid);
		}
	});

	if (missing.length || untranslated.length || fuzzy.length) {
		throw new Error(
			[
				"languages/easymde-zh_CN.po must cover all POT messages.",
				...missing.map((msgid) => `- missing: ${msgid}`),
				...fuzzy.map((msgid) => `- fuzzy: ${msgid}`),
				...untranslated.map((msgid) => `- untranslated: ${msgid}`),
			].join("\n"),
		);
	}
}

function assertFileExists(root, path) {
	if (!existsSync(fromRoot(root, path))) {
		throw new Error(`Missing required i18n file: ${path}`);
	}
}

function assertPotCurrent(root) {
	const tempDir = mkdtempSync(join(tmpdir(), "easymde-i18n-check-"));
	const tempPot = join(tempDir, "easymde.pot");

	try {
		makePot({ root, output: tempPot });

		const expected = readFileSync(tempPot, "utf8");
		const actual = readFileSync(fromRoot(root, potPath), "utf8");

		if (actual !== expected) {
			throw new Error(`${potPath} is out of date. Run npm run i18n:make-pot.`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

export function compileMo(options = {}) {
	const root = options.root || defaultRoot;
	const output = options.output || fromRoot(root, zhMoPath);

	requireCommand("msgfmt");
	run(
		"msgfmt",
		["--check", "--check-header", "-o", output, fromRoot(root, zhPoPath)],
		{ cwd: root },
	);
}

function poHeader(entries) {
	return entries.find((entry) => "" === entry.msgid)?.msgstr?.[0] || "";
}

function poHeaderValue(entries, name) {
	const match = poHeader(entries).match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
	if (!match?.[1]) throw new Error(`Missing PO header: ${name}`);
	return match[1].trim();
}

function jsPotEntries(root) {
	const tempDir = mkdtempSync(join(tmpdir(), "easymde-js-pot-"));
	const output = join(tempDir, "messages.pot");
	try {
		if (!makeJsPot(root, output)) return [];
		return parsePoEntries(output).filter((entry) => "" !== entry.msgid);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

export function compileJsCatalog(options = {}) {
	const root = options.root || defaultRoot;
	const output = options.output || fromRoot(root, zhJsPath);
	const sourceEntries = jsPotEntries(root);
	const poEntries = parsePoEntries(fromRoot(root, zhPoPath));
	const poByKey = new Map(poEntries.map((entry) => [entryKey(entry), entry]));
	const messages = {
		"": {
			domain: textDomain,
			lang: poHeaderValue(poEntries, "Language"),
			"plural-forms": poHeaderValue(poEntries, "Plural-Forms"),
		},
	};

	sourceEntries.forEach((sourceEntry) => {
		const translated = poByKey.get(entryKey(sourceEntry));
		const values = translated?.msgstr
			? Object.keys(translated.msgstr)
					.sort((left, right) => Number(left) - Number(right))
					.map((index) => translated.msgstr[index])
			: [];
		if (!values.length || values.some((value) => !value)) {
			throw new Error(`Missing JavaScript translation: ${sourceEntry.msgid}`);
		}
		messages[
			sourceEntry.msgctxt
				? `${sourceEntry.msgctxt}\u0004${sourceEntry.msgid}`
				: sourceEntry.msgid
		] = values;
	});

	const catalog = {
		"translation-revision-date": poHeaderValue(poEntries, "PO-Revision-Date"),
		generator: "EasyMDE i18n script",
		source: jsSourceFiles.join(","),
		domain: textDomain,
		locale_data: { [textDomain]: messages },
	};
	writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
}

function assertMoCurrent(root) {
	const tempDir = mkdtempSync(join(tmpdir(), "easymde-mo-check-"));
	const tempMo = join(tempDir, "easymde-zh_CN.mo");

	try {
		compileMo({ root, output: tempMo });

		const expected = readFileSync(tempMo);
		const actual = readFileSync(fromRoot(root, zhMoPath));

		if (!actual.length) {
			throw new Error(`${zhMoPath} is empty.`);
		}

		if (0 !== Buffer.compare(actual, expected)) {
			throw new Error(`${zhMoPath} is out of date. Run npm run i18n:compile.`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function assertJsCatalogCurrent(root) {
	const tempDir = mkdtempSync(join(tmpdir(), "easymde-js-i18n-check-"));
	const output = join(tempDir, "catalog.json");
	try {
		compileJsCatalog({ root, output });
		if (
			readFileSync(output, "utf8") !==
			readFileSync(fromRoot(root, zhJsPath), "utf8")
		) {
			throw new Error(`${zhJsPath} is out of date. Run npm run i18n:compile.`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

export function checkI18n(options = {}) {
	const root = options.root || defaultRoot;

	[potPath, zhPoPath, zhMoPath, zhJsPath].forEach((path) =>
		assertFileExists(root, path),
	);
	requireCommand("msgfmt");
	assertPotCurrent(root);
	run(
		"msgfmt",
		["--check", "--check-header", "-o", "/dev/null", fromRoot(root, zhPoPath)],
		{ cwd: root },
	);
	assertPoCoversPot(root);
	assertMoCurrent(root);
	assertJsCatalogCurrent(root);
}

function parseCliOptions(argv) {
	const options = {
		command: argv[0] || "check",
	};

	for (let index = 1; index < argv.length; index += 1) {
		if ("--root" === argv[index] && argv[index + 1]) {
			options.root = argv[index + 1];
			index += 1;
		}
	}

	return options;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const options = parseCliOptions(process.argv.slice(2));
		const root = options.root || defaultRoot;

		if ("make-pot" === options.command) {
			makePot({ root });
			console.log(`Updated ${relative(root, fromRoot(root, potPath))}`);
		} else if ("compile" === options.command) {
			compileMo({ root });
			compileJsCatalog({ root });
			console.log(
				`Compiled ${relative(root, fromRoot(root, zhMoPath))} and ${relative(
					root,
					fromRoot(root, zhJsPath),
				)}`,
			);
		} else if ("check" === options.command) {
			checkI18n({ root });
			console.log("EasyMDE i18n files are current.");
		} else {
			throw new Error(`Unknown i18n command: ${options.command}`);
		}
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
