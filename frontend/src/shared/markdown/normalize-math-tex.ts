/**
 * Canonical DOM attribute storing raw or PHP-restored Markdown source on
 * rendered generated-content elements (math, Mermaid, protected visual atoms).
 */
export const VISUAL_MARKDOWN_SOURCE_ATTRIBUTE =
	"data-easymde-visual-markdown-source";

type MathTexNormalizationOptions = Readonly<{
	asciiWhitespaceOnly: boolean;
	matrixRowReplacement: string;
}>;

function normalizeMathTexWithOptions(
	tex: string,
	options: MathTexNormalizationOptions,
): string {
	if (!tex) return tex;

	const whitespaceNormalized = options.asciiWhitespaceOnly
		? tex
				.replace(/(^|[^A-Za-z\\])(begin|end)(?=[ \t\n\r\f\v]*\{)/g, "$1\\$2")
				.replace(
					/(^|[^A-Za-z\\])(frac|dfrac|tfrac|binom|sqrt)(?=[ \t\n\r\f\v]*\{)/g,
					"$1\\$2",
				)
				.replace(
					/(^|[^A-Za-z\\])(left|right)(?=[ \t\n\r\f\v]*(?:[()[\]{}|.]|\\[{}]))/g,
					"$1\\$2",
				)
		: tex
				.replace(/(^|[^A-Za-z\\])(begin|end)(?=\s*\{)/g, "$1\\$2")
				.replace(/(^|[^A-Za-z\\])(frac|dfrac|tfrac|binom|sqrt)(?=\s*\{)/g, "$1\\$2")
				.replace(
					/(^|[^A-Za-z\\])(left|right)(?=\s*(?:[()[\]{}|.]|\\[{}]))/g,
					"$1\\$2",
				);
	const normalized = whitespaceNormalized
		.replace(
			/(^|[^A-Za-z\\])(log|ln|exp|lim|sin|cos|tan|cot|sec|csc|min|max|sup|inf)(?![A-Za-z])/g,
			"$1\\$2",
		)
		.replace(
			/(^|[^A-Za-z\\])(cdots|ldots|dots|vdots|ddots|cdot|times|div|pm|mp|leq|geq|neq|approx|infty)(?![A-Za-z])/g,
			"$1\\$2",
		);

	const replacement = `$1${options.matrixRowReplacement}`;
	return normalized.replace(
		/\\begin\{([A-Za-z]*matrix|array)\}([\s\S]*?)\\end\{\1\}/g,
		(_match, environment: string, body: string) =>
			`\\begin{${environment}}${body.replace(/(^|[^\\])\\(?![\\A-Za-z{])/g, replacement)}\\end{${environment}}`,
	);
}

/**
 * Normalize common TeX command escapes and single-backslash matrix row breaks
 * for client-side KaTeX rendering (`frontend-enhancement-runtime` and
 * `protected-atom-runtime`).
 *
 * Emits 2 literal backslashes (`\\`) inside `*matrix`/`array` bodies for KaTeX;
 * PHP's `MarkdownRenderer::normalize_matrix_row_separators()` emits 4 literal
 * backslashes (`\\\\`), which is mirrored separately by
 * `normalizePhpRenderedMathTex()`.
 */
export function normalizeMathTex(tex: string): string {
	return normalizeMathTexWithOptions(tex, {
		asciiWhitespaceOnly: false,
		matrixRowReplacement: "\\\\",
	});
}

/** Normalizes CRLF and bare CR line endings to LF. */
export function normalizeLineEndingsToLf(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function isPhpTrimAsciiCode(code: number): boolean {
	return (
		32 === code ||
		9 === code ||
		10 === code ||
		13 === code ||
		0 === code ||
		11 === code
	);
}

function trimPhpAsciiWhitespace(value: string): string {
	let start = 0;
	let end = value.length;
	while (start < end && isPhpTrimAsciiCode(value.charCodeAt(start))) {
		start += 1;
	}
	while (end > start && isPhpTrimAsciiCode(value.charCodeAt(end - 1))) {
		end -= 1;
	}
	return start === 0 && end === value.length ? value : value.slice(start, end);
}

/**
 * Mirrors PHP `EasyMDE\Content\MarkdownRenderer::restore_math()` +
 * `normalize_math_tex()` 1:1: PHP ASCII `trim()` (`[ \t\n\r\0\v]`), non-`/u`
 * ASCII `\s` (`[ \t\n\r\f\v]`) command patterns, and 4 literal backslashes
 * (`\\\\`) for single-backslash sequences inside `*matrix`/`array`.
 */
function normalizePhpRenderedMathTex(tex: string): string {
	return normalizeMathTexWithOptions(
		trimPhpAsciiWhitespace(normalizeLineEndingsToLf(tex)),
		{
			asciiWhitespaceOnly: true,
			matrixRowReplacement: "\\\\\\\\",
		},
	);
}

/**
 * Exact 252 HTML 4.01 named entities preserved by WordPress
 * `wp_kses_normalize_entities()` (`$allowedentitynames` in `wp-includes/kses.php`)
 * AND PHP `htmlspecialchars(..., ENT_QUOTES, 'UTF-8', false)` (`ENT_HTML401`).
 * Deliberately excludes `apos`, which PHP `ENT_HTML401` escapes to `&amp;apos;`,
 * and excludes HTML5-only entities (such as `&rightarrow;`, `&colon;`, `&plus;`),
 * which `wp_kses_normalize_entities()` escapes to `&amp;...;`.
 */
const WP_HTML4_NAMED_ENTITIES: ReadonlyMap<string, number> = new Map<
	string,
	number
>([
	["nbsp", 160],
	["iexcl", 161],
	["cent", 162],
	["pound", 163],
	["curren", 164],
	["yen", 165],
	["brvbar", 166],
	["sect", 167],
	["uml", 168],
	["copy", 169],
	["ordf", 170],
	["laquo", 171],
	["not", 172],
	["shy", 173],
	["reg", 174],
	["macr", 175],
	["deg", 176],
	["plusmn", 177],
	["acute", 180],
	["micro", 181],
	["para", 182],
	["middot", 183],
	["cedil", 184],
	["ordm", 186],
	["raquo", 187],
	["iquest", 191],
	["Agrave", 192],
	["Aacute", 193],
	["Acirc", 194],
	["Atilde", 195],
	["Auml", 196],
	["Aring", 197],
	["AElig", 198],
	["Ccedil", 199],
	["Egrave", 200],
	["Eacute", 201],
	["Ecirc", 202],
	["Euml", 203],
	["Igrave", 204],
	["Iacute", 205],
	["Icirc", 206],
	["Iuml", 207],
	["ETH", 208],
	["Ntilde", 209],
	["Ograve", 210],
	["Oacute", 211],
	["Ocirc", 212],
	["Otilde", 213],
	["Ouml", 214],
	["times", 215],
	["Oslash", 216],
	["Ugrave", 217],
	["Uacute", 218],
	["Ucirc", 219],
	["Uuml", 220],
	["Yacute", 221],
	["THORN", 222],
	["szlig", 223],
	["agrave", 224],
	["aacute", 225],
	["acirc", 226],
	["atilde", 227],
	["auml", 228],
	["aring", 229],
	["aelig", 230],
	["ccedil", 231],
	["egrave", 232],
	["eacute", 233],
	["ecirc", 234],
	["euml", 235],
	["igrave", 236],
	["iacute", 237],
	["icirc", 238],
	["iuml", 239],
	["eth", 240],
	["ntilde", 241],
	["ograve", 242],
	["oacute", 243],
	["ocirc", 244],
	["otilde", 245],
	["ouml", 246],
	["divide", 247],
	["oslash", 248],
	["ugrave", 249],
	["uacute", 250],
	["ucirc", 251],
	["uuml", 252],
	["yacute", 253],
	["thorn", 254],
	["yuml", 255],
	["quot", 34],
	["amp", 38],
	["lt", 60],
	["gt", 62],
	["OElig", 338],
	["oelig", 339],
	["Scaron", 352],
	["scaron", 353],
	["Yuml", 376],
	["circ", 710],
	["tilde", 732],
	["ensp", 8194],
	["emsp", 8195],
	["thinsp", 8201],
	["zwnj", 8204],
	["zwj", 8205],
	["lrm", 8206],
	["rlm", 8207],
	["ndash", 8211],
	["mdash", 8212],
	["lsquo", 8216],
	["rsquo", 8217],
	["sbquo", 8218],
	["ldquo", 8220],
	["rdquo", 8221],
	["bdquo", 8222],
	["dagger", 8224],
	["Dagger", 8225],
	["permil", 8240],
	["lsaquo", 8249],
	["rsaquo", 8250],
	["euro", 8364],
	["fnof", 402],
	["Alpha", 913],
	["Beta", 914],
	["Gamma", 915],
	["Delta", 916],
	["Epsilon", 917],
	["Zeta", 918],
	["Eta", 919],
	["Theta", 920],
	["Iota", 921],
	["Kappa", 922],
	["Lambda", 923],
	["Mu", 924],
	["Nu", 925],
	["Xi", 926],
	["Omicron", 927],
	["Pi", 928],
	["Rho", 929],
	["Sigma", 931],
	["Tau", 932],
	["Upsilon", 933],
	["Phi", 934],
	["Chi", 935],
	["Psi", 936],
	["Omega", 937],
	["alpha", 945],
	["beta", 946],
	["gamma", 947],
	["delta", 948],
	["epsilon", 949],
	["zeta", 950],
	["eta", 951],
	["theta", 952],
	["iota", 953],
	["kappa", 954],
	["lambda", 955],
	["mu", 956],
	["nu", 957],
	["xi", 958],
	["omicron", 959],
	["pi", 960],
	["rho", 961],
	["sigmaf", 962],
	["sigma", 963],
	["tau", 964],
	["upsilon", 965],
	["phi", 966],
	["chi", 967],
	["psi", 968],
	["omega", 969],
	["thetasym", 977],
	["upsih", 978],
	["piv", 982],
	["bull", 8226],
	["hellip", 8230],
	["prime", 8242],
	["Prime", 8243],
	["oline", 8254],
	["frasl", 8260],
	["weierp", 8472],
	["image", 8465],
	["real", 8476],
	["trade", 8482],
	["alefsym", 8501],
	["larr", 8592],
	["uarr", 8593],
	["rarr", 8594],
	["darr", 8595],
	["harr", 8596],
	["crarr", 8629],
	["lArr", 8656],
	["uArr", 8657],
	["rArr", 8658],
	["dArr", 8659],
	["hArr", 8660],
	["forall", 8704],
	["part", 8706],
	["exist", 8707],
	["empty", 8709],
	["nabla", 8711],
	["isin", 8712],
	["notin", 8713],
	["ni", 8715],
	["prod", 8719],
	["sum", 8721],
	["minus", 8722],
	["lowast", 8727],
	["radic", 8730],
	["prop", 8733],
	["infin", 8734],
	["ang", 8736],
	["and", 8743],
	["or", 8744],
	["cap", 8745],
	["cup", 8746],
	["int", 8747],
	["sim", 8764],
	["cong", 8773],
	["asymp", 8776],
	["ne", 8800],
	["equiv", 8801],
	["le", 8804],
	["ge", 8805],
	["sub", 8834],
	["sup", 8835],
	["nsub", 8836],
	["sube", 8838],
	["supe", 8839],
	["oplus", 8853],
	["otimes", 8855],
	["perp", 8869],
	["sdot", 8901],
	["lceil", 8968],
	["rceil", 8969],
	["lfloor", 8970],
	["rfloor", 8971],
	["lang", 9001],
	["rang", 9002],
	["loz", 9674],
	["spades", 9824],
	["clubs", 9827],
	["hearts", 9829],
	["diams", 9830],
	["sup1", 185],
	["sup2", 178],
	["sup3", 179],
	["frac14", 188],
	["frac12", 189],
	["frac34", 190],
	["there4", 8756],
]);

/**
 * WHATWG HTML5 numeric character reference remapping table for `0x80..0x9F`
 * (Windows-1252). Older libxml2 `DOMDocument::loadHTML` emits Unicode C1 code
 * points (`\u0080..\u009F`), while HTML5 parsers (and direct `render()` HTML
 * parsed by browsers) remap `0x80..0x9F` through this table.
 */
const HTML5_C1_WINDOWS1252: ReadonlyArray<number> = [
	0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
	0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018,
	0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
	0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

type WpEntityMode = "wp67" | "wp68";

const HTML_DECODE_ENTITY_RE =
	/&(?:#([0-9]+)|#[Xx]([0-9A-Fa-f]+)|([A-Za-z]{2,8}[0-9]{0,2}));/g;

// Mirrors `wp_kses_no_null($content, array('slash_zero' => 'keep'))`.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Exact match for WordPress `wp_kses_no_null()` control-character stripping.
const WP_KSES_NO_NULL_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/** Mirrors WordPress `valid_unicode()` in `wp-includes/kses.php`. */
function isWpValidUnicode(code: number): boolean {
	return (
		0x09 === code ||
		0x0a === code ||
		0x0d === code ||
		(code >= 0x20 && code <= 0xd7ff) ||
		(code >= 0xe000 && code <= 0xfffd) ||
		(code >= 0x10000 && code <= 0x10ffff)
	);
}

/**
 * Exact pure mirror of WordPress `wp_kses_normalize_entities()` for both:
 * - `"wp67"` (WordPress 6.7): named entities run before numeric entities,
 *   `0*[0-9]{1,7}` / `0*[0-9A-Fa-f]{1,6}` match all-zero refs, and PHP
 *   `empty('0')` drops `&#0;`/`&#x0;`/`&#X0;` to `""`.
 * - `"wp68"` (WordPress 6.8–7.1.5): numeric entities (`0*[1-9][0-9]{0,6}` /
 *   `0*[1-9A-Fa-f][0-9A-Fa-f]{0,5}`) run before named entities so double-encoded
 *   numeric refs and all-zero refs stay verbatim.
 *
 * When `includeApos` is `false` (the `esc_html()` step), `apos` is treated as
 * disallowed to mirror PHP `htmlspecialchars(..., ENT_QUOTES | ENT_HTML401,
 * 'UTF-8', false)` re-escaping `&apos;` to `&amp;apos;`.
 */
function wpKsesNormalizeEntities(
	content: string,
	includeApos: boolean,
	mode: WpEntityMode,
): string {
	let out = content.replace(/&/g, "&amp;");
	const normalizeNamed = (input: string): string =>
		input.replace(/&amp;([A-Za-z]{2,8}[0-9]{0,2});/g, (_match, name: string) =>
			WP_HTML4_NAMED_ENTITIES.has(name) || (includeApos && "apos" === name)
				? `&${name};`
				: `&amp;${name};`,
		);
	const normalizeDec = (input: string): string =>
		input.replace(
			"wp67" === mode ? /&amp;#(0*[0-9]{1,7});/g : /&amp;#(0*[1-9][0-9]{0,6});/g,
			(_match, digits: string) => {
				if ("wp67" === mode && (!digits || "0" === digits)) return "";
				const code = Number.parseInt(digits, 10);
				if (isWpValidUnicode(code)) {
					return `&#${digits.replace(/^0+/, "").padStart(3, "0")};`;
				}
				return `&amp;#${digits};`;
			},
		);
	const normalizeHex = (input: string): string =>
		input.replace(
			"wp67" === mode
				? /&amp;#[Xx](0*[0-9A-Fa-f]{1,6});/g
				: /&amp;#[Xx](0*[1-9A-Fa-f][0-9A-Fa-f]{0,5});/g,
			(_match, hex: string) => {
				if ("wp67" === mode && (!hex || "0" === hex)) return "";
				const code = Number.parseInt(hex, 16);
				if (isWpValidUnicode(code)) {
					return `&#x${hex.replace(/^0+/, "")};`;
				}
				return `&amp;#x${hex};`;
			},
		);

	if ("wp67" === mode) {
		out = normalizeNamed(out);
		out = normalizeDec(out);
		out = normalizeHex(out);
	} else {
		out = normalizeDec(out);
		out = normalizeHex(out);
		out = normalizeNamed(out);
	}
	return out;
}

function wpEscHtmlAndKses(tex: string, mode: WpEntityMode): string {
	// Step 1: WordPress `esc_html()` -> `_wp_specialchars(..., ENT_QUOTES, 'UTF-8', false)`.
	const afterEscHtml = /[&<>"']/.test(tex)
		? wpKsesNormalizeEntities(tex, false, mode).replace(/[<>"']/g, (ch) => {
				if ("<" === ch) return "&lt;";
				if (">" === ch) return "&gt;";
				if ('"' === ch) return "&quot;";
				return "&#039;";
			})
		: tex;
	// Step 2: WordPress `wp_kses()` -> `wp_kses_no_null(..., ['slash_zero' => 'keep'])` + `wp_kses_normalize_entities()`.
	const afterNoNull = afterEscHtml.replace(WP_KSES_NO_NULL_CONTROL_RE, "");
	return wpKsesNormalizeEntities(afterNoNull, true, mode);
}

function decodeNormalizedWpHtmlEntities(
	normalizedHtml: string,
	html5Mode: boolean,
): Readonly<{ hasHtml5Difference: boolean; value: string }> {
	let hasHtml5Difference = false;
	const decoded = normalizedHtml.includes("&")
		? normalizedHtml.replace(
				HTML_DECODE_ENTITY_RE,
				(match, dec?: string, hex?: string, named?: string) => {
					if (undefined !== dec || undefined !== hex) {
						const code =
							undefined !== dec
								? Number.parseInt(dec, 10)
								: Number.parseInt(hex as string, 16);
						if (!isWpValidUnicode(code)) return match;
						if (code >= 0x80 && code <= 0x9f) {
							hasHtml5Difference = true;
							const mapped = html5Mode
								? (HTML5_C1_WINDOWS1252[code - 0x80] ?? code)
								: code;
							return String.fromCodePoint(mapped);
						}
						return String.fromCodePoint(code);
					}
					if (undefined !== named) {
						if ("lang" === named || "rang" === named) {
							hasHtml5Difference = true;
							const code = html5Mode
								? "lang" === named
									? 0x27e8
									: 0x27e9
								: "lang" === named
									? 0x2329
									: 0x232a;
							return String.fromCodePoint(code);
						}
						const code =
							"apos" === named ? 39 : WP_HTML4_NAMED_ENTITIES.get(named);
						return undefined !== code ? String.fromCodePoint(code) : match;
					}
					return match;
				},
			)
		: normalizedHtml;
	return { hasHtml5Difference, value: normalizeLineEndingsToLf(decoded) };
}

/**
 * Pure, worker-safe, zero-DOM model of the exact 3-step WordPress Preview math
 * text pipeline: `esc_html($tex)` -> `wp_kses` (`wp_kses_no_null` +
 * `wp_kses_normalize_entities`) -> `DOMDocument` / HTML5 `textContent`
 * decoding.
 */
export function decodeWpPreviewMathEntities(
	tex: string,
	options?: Readonly<{ mapC1ToWindows1252?: boolean; wpMode?: WpEntityMode }>,
): string {
	const mode = options?.wpMode ?? "wp68";
	const normalized = wpEscHtmlAndKses(tex, mode);
	return decodeNormalizedWpHtmlEntities(
		normalized,
		options?.mapC1ToWindows1252 ?? false,
	).value;
}

/**
 * Returns the distinct LF-normalized DOM `data-easymde-visual-markdown-source`
 * values accepted for a Markdown math span (typically 1–5 entries):
 * - raw LF-normalized Markdown source (ProseMirror protected atoms / fixtures);
 * - PHP `MarkdownRenderer::restore_math()` normalized TeX (`$$...$$` / `\(...\)`);
 * - WordPress 6.8–7.1.5 and 6.7 `esc_html` + `wp_kses` outputs after both
 *   libxml2 HTML4 and WHATWG HTML5 decoding (C1 Windows-1252 and `&lang;`/`&rang;`).
 */
// Fast-path check for TeX strings that contain neither HTML-significant
// characters nor control characters stripped by `wp_kses_no_null()`.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Exact match for WordPress `wp_kses_no_null()` control-character stripping.
const WP_PREVIEW_ENTITY_OR_CONTROL_RE = /[&<>"'\x00-\x08\x0B\x0C\x0E-\x1F]/;

export function mathSpanAcceptedDomSources(
	full: string,
	body: string,
	displayMode: boolean,
): ReadonlyArray<string> {
	const accepted: string[] = [];
	const add = (value: string): void => {
		if (!accepted.includes(value)) accepted.push(value);
	};
	add(normalizeLineEndingsToLf(full));
	const restoredTex = normalizePhpRenderedMathTex(body);
	const wrap = (tex: string): string =>
		displayMode ? `$$${tex}$$` : `\\(${tex}\\)`;
	add(wrap(restoredTex));

	if (!WP_PREVIEW_ENTITY_OR_CONTROL_RE.test(restoredTex)) {
		return accepted;
	}

	const addNormalizedHtml = (normalizedHtml: string): void => {
		const decodedLegacy = decodeNormalizedWpHtmlEntities(normalizedHtml, false);
		add(wrap(decodedLegacy.value));
		if (decodedLegacy.hasHtml5Difference) {
			const decodedHtml5 = decodeNormalizedWpHtmlEntities(normalizedHtml, true);
			add(wrap(decodedHtml5.value));
		}
	};

	const normalizedWp68 = wpEscHtmlAndKses(restoredTex, "wp68");
	addNormalizedHtml(normalizedWp68);
	const normalizedWp67 = wpEscHtmlAndKses(restoredTex, "wp67");
	if (normalizedWp67 !== normalizedWp68) {
		addNormalizedHtml(normalizedWp67);
	}
	return accepted;
}

/**
 * Verifies that a rendered math DOM element's
 * `data-easymde-visual-markdown-source` attribute matches a candidate Markdown
 * math span using the canonical `mathSpanAcceptedDomSources()` set.
 */
export function mathDomSourceMatchesSpan(
	domSource: string,
	full: string,
	body: string,
	displayMode: boolean,
): boolean {
	const domNorm = normalizeLineEndingsToLf(domSource);
	return mathSpanAcceptedDomSources(full, body, displayMode).includes(domNorm);
}
