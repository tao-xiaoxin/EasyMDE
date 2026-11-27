import { describe, expect, it } from "vitest";

import {
	decodeWpPreviewMathEntities,
	mathDomSourceMatchesSpan,
	mathSpanAcceptedDomSources,
	normalizeMathTex,
	VISUAL_MARKDOWN_SOURCE_ATTRIBUTE,
} from "./normalize-math-tex";

describe("normalize-math-tex and pure WordPress Preview entity decoding (R33A #1, R33B #2)", () => {
	it("exports the canonical visual markdown source attribute", () => {
		expect(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE).toBe(
			"data-easymde-visual-markdown-source",
		);
	});

	it("keeps normalizeMathTex at 2 backslashes for KaTeX while matching live PHP 8.3.37 / WordPress 7.1.5 entities, matrices, NBSP, C1 numeric refs, and control chars without DOM/innerHTML", () => {
		expect(
			normalizeMathTex("\\begin{pmatrix}a \\, b \\\\ c & d\\end{pmatrix}"),
		).toBe("\\begin{pmatrix}a \\\\, b \\\\ c & d\\end{pmatrix}");

		// Every `domSource` below mirrors exact `MarkdownRenderer::render_preview()` +
		// browser HTML5 `textContent` output (and for C1 128..159, both libxml2
		// Unicode C1 and browser HTML5 Windows-1252 outputs).
		const cases: ReadonlyArray<
			Readonly<{
				body: string;
				displayMode: boolean;
				domSource: string;
				full: string;
				label: string;
			}>
		> = [
			{
				body: "\\text{&lt;&rightarrow;}",
				displayMode: false,
				domSource: "\\(\\text{<&rightarrow;}\\)",
				full: "$\\text{&lt;&rightarrow;}$",
				label: "mixed HTML4 &lt; + HTML5 &rightarrow;",
			},
			{
				body: "\\text{&lt;&colon;}",
				displayMode: false,
				domSource: "\\(\\text{<&colon;}\\)",
				full: "$\\text{&lt;&colon;}$",
				label: "mixed HTML4 &lt; + HTML5 &colon;",
			},
			{
				body: "\\text{&amp;&plus;}",
				displayMode: false,
				domSource: "\\(\\text{&&plus;}\\)",
				full: "$\\text{&amp;&plus;}$",
				label: "mixed HTML4 &amp; + HTML5 &plus;",
			},
			{
				body: "\\text{&lt;&CounterClockwiseContourIntegral;}",
				displayMode: false,
				domSource: "\\(\\text{<&CounterClockwiseContourIntegral;}\\)",
				full: "$\\text{&lt;&CounterClockwiseContourIntegral;}$",
				label: "mixed HTML4 &lt; + long HTML5 entity",
			},
			{
				body: "\\begin{matrix}a &lt; b \\text{&rightarrow;} c\\end{matrix}",
				displayMode: true,
				domSource:
					"$$\\begin{matrix}a < b \\text{&rightarrow;} c\\end{matrix}$$",
				full: "$$\\begin{matrix}a &lt; b \\text{&rightarrow;} c\\end{matrix}$$",
				label: "display matrix with mixed HTML4 + HTML5 entities",
			},
			{
				body: "\\text{&lt;&notanentity;}",
				displayMode: false,
				domSource: "\\(\\text{<&notanentity;}\\)",
				full: "$\\text{&lt;&notanentity;}$",
				label: "legacy semicolonless &not prefix does not corrupt &notanentity;",
			},
			{
				body: "\\text{&notanentity;}",
				displayMode: false,
				domSource: "\\(\\text{&notanentity;}\\)",
				full: "$\\text{&notanentity;}$",
				label: "standalone &notanentity; stays literal",
			},
			{
				body: "\\text{&apos;}",
				displayMode: false,
				domSource: "\\(\\text{&apos;}\\)",
				full: "$\\text{&apos;}$",
				label: "standalone &apos; escaped by PHP ENT_HTML401",
			},
			{
				body: "\\text{&lt;&apos;}",
				displayMode: false,
				domSource: "\\(\\text{<&apos;}\\)",
				full: "$\\text{&lt;&apos;}$",
				label: "mixed &lt; + &apos;",
			},
			{
				body: "\\text{&#X3C;}",
				displayMode: false,
				domSource: "\\(\\text{<}\\)",
				full: "$\\text{&#X3C;}$",
				label: "uppercase hex &#X3C;",
			},
			{
				body: "\\text{&lt;&#X3c;}",
				displayMode: false,
				domSource: "\\(\\text{<<}\\)",
				full: "$\\text{&lt;&#X3c;}$",
				label: "mixed &lt; + uppercase &#X3c;",
			},
			{
				body: "\\text{&#00060;}",
				displayMode: false,
				domSource: "\\(\\text{<}\\)",
				full: "$\\text{&#00060;}$",
				label: "leading zeros decimal &#00060;",
			},
			{
				body: "\\text{&#x0003c;}",
				displayMode: false,
				domSource: "\\(\\text{<}\\)",
				full: "$\\text{&#x0003c;}$",
				label: "leading zeros hex &#x0003c;",
			},
			{
				body: "\\text{&#x110000;}",
				displayMode: false,
				domSource: "\\(\\text{&#x110000;}\\)",
				full: "$\\text{&#x110000;}$",
				label: "out-of-range hex &#x110000;",
			},
			{
				body: "\\text{&#X110000;}",
				displayMode: false,
				domSource: "\\(\\text{&#x110000;}\\)",
				full: "$\\text{&#X110000;}$",
				label: "out-of-range uppercase &#X110000; lowercases x via wp_kses",
			},
			{
				body: "\\text{&#99999999;}",
				displayMode: false,
				domSource: "\\(\\text{&#99999999;}\\)",
				full: "$\\text{&#99999999;}$",
				label: "overlong decimal &#99999999;",
			},
			{
				body: "\\text{&#xD800;}",
				displayMode: false,
				domSource: "\\(\\text{&#xD800;}\\)",
				full: "$\\text{&#xD800;}$",
				label: "surrogate &#xD800;",
			},
			{
				body: "\\text{&#XD800;}",
				displayMode: false,
				domSource: "\\(\\text{&#xD800;}\\)",
				full: "$\\text{&#XD800;}$",
				label: "uppercase surrogate &#XD800; lowercases x via wp_kses",
			},
			{
				body: "\\text{&#0;}",
				displayMode: false,
				domSource: "\\(\\text{&#0;}\\)",
				full: "$\\text{&#0;}$",
				label: "zero decimal &#0;",
			},
			{
				body: "\\text{&#00;}",
				displayMode: false,
				domSource: "\\(\\text{&#00;}\\)",
				full: "$\\text{&#00;}$",
				label: "zero decimal &#00;",
			},
			{
				body: "\\text{&#x0;}",
				displayMode: false,
				domSource: "\\(\\text{&#x0;}\\)",
				full: "$\\text{&#x0;}$",
				label: "zero hex &#x0;",
			},
			{
				body: "\\text{&#X0;}",
				displayMode: false,
				domSource: "\\(\\text{&#X0;}\\)",
				full: "$\\text{&#X0;}$",
				label: "zero uppercase hex &#X0; preserves uppercase X",
			},
			{
				body: "\\text{&#1;}",
				displayMode: false,
				domSource: "\\(\\text{&#1;}\\)",
				full: "$\\text{&#1;}$",
				label: "invalid control numeric &#1;",
			},
			{
				body: "\\text{&#31;}",
				displayMode: false,
				domSource: "\\(\\text{&#31;}\\)",
				full: "$\\text{&#31;}$",
				label: "invalid control numeric &#31;",
			},
			{
				body: "\\text{&#xFFFE;}",
				displayMode: false,
				domSource: "\\(\\text{&#xFFFE;}\\)",
				full: "$\\text{&#xFFFE;}$",
				label: "non-character &#xFFFE;",
			},
			{
				body: "\\text{&#xFFFF;}",
				displayMode: false,
				domSource: "\\(\\text{&#xFFFF;}\\)",
				full: "$\\text{&#xFFFF;}$",
				label: "non-character &#xFFFF;",
			},
			{
				body: "\\text{&#9;}\\text{&#10;}\\text{&#13;}",
				displayMode: false,
				domSource: "\\(\\text{\t}\\text{\n}\\text{\n}\\)",
				full: "$\\text{&#9;}\\text{&#10;}\\text{&#13;}$",
				label: "valid whitespace numeric refs &#9;, &#10;, &#13;",
			},
			{
				body: "\\text{&#x10FFFF;}",
				displayMode: false,
				domSource: "\\(\\text{\u{10FFFF}}\\)",
				full: "$\\text{&#x10FFFF;}$",
				label: "max Unicode &#x10FFFF;",
			},
			{
				body: "\\text{&#01114111;}",
				displayMode: false,
				domSource: "\\(\\text{\u{10FFFF}}\\)",
				full: "$\\text{&#01114111;}$",
				label: "leading-zero max Unicode decimal &#01114111;",
			},
			{
				body: "\\text{&#128;}",
				displayMode: false,
				domSource: "\\(\\text{\u0080}\\)",
				full: "$\\text{&#128;}$",
				label: "C1 numeric &#128; (libxml2 Unicode C1)",
			},
			{
				body: "\\text{&#128;}",
				displayMode: false,
				domSource: "\\(\\text{\u20ac}\\)",
				full: "$\\text{&#128;}$",
				label: "C1 numeric &#128; (HTML5 Windows-1252 euro)",
			},
			{
				body: "\\text{&#x80;}",
				displayMode: false,
				domSource: "\\(\\text{\u0080}\\)",
				full: "$\\text{&#x80;}$",
				label: "C1 hex &#x80; (libxml2 Unicode C1)",
			},
			{
				body: "\\text{&#x80;}",
				displayMode: false,
				domSource: "\\(\\text{\u20ac}\\)",
				full: "$\\text{&#x80;}$",
				label: "C1 hex &#x80; (HTML5 Windows-1252 euro)",
			},
			{
				body: "\\text{&#159;}",
				displayMode: false,
				domSource: "\\(\\text{\u009f}\\)",
				full: "$\\text{&#159;}$",
				label: "C1 numeric &#159; (libxml2 Unicode C1)",
			},
			{
				body: "\\text{&#159;}",
				displayMode: false,
				domSource: "\\(\\text{\u0178}\\)",
				full: "$\\text{&#159;}$",
				label: "C1 numeric &#159; (HTML5 Windows-1252 Y-umlaut)",
			},
			{
				body: "a\u0000b",
				displayMode: false,
				domSource: "\\(ab\\)",
				full: "$a\u0000b$",
				label: "wp_kses_no_null strips literal NUL without &",
			},
			{
				body: "a\u000cb",
				displayMode: false,
				domSource: "\\(ab\\)",
				full: "$a\u000cb$",
				label: "wp_kses_no_null strips literal form-feed without &",
			},
			{
				body: "\u000c x \u000c",
				displayMode: false,
				domSource: "\\( x \\)",
				full: "$\u000c x \u000c$",
				label: "PHP trim keeps form-feed then wp_kses_no_null strips it",
			},
			{
				body: "\\text{&\u0000lt;}",
				displayMode: false,
				domSource: "\\(\\text{&lt;}\\)",
				full: "$\\text{&\u0000lt;}$",
				label: "NUL inside entity prevents decode before wp_kses_no_null strips it",
			},
			{
				body: "\\0 + \\\\00 + x",
				displayMode: false,
				domSource: "\\(\\0 + \\\\00 + x\\)",
				full: "$\\0 + \\\\00 + x$",
				label: "wp_kses keeps slash-zero sequences",
			},
			{
				body: "x + &amp;lt; + &amp;#X3c;",
				displayMode: false,
				domSource: "\\(x + &lt; + &#X3c;\\)",
				full: "$x + &amp;lt; + &amp;#X3c;$",
				label: "double-encoded named and hex entities",
			},
			{
				body: "\\text{&nbsp;&copy;&alpha;&rarr;&there4;}",
				displayMode: false,
				domSource: "\\(\\text{\u00a0\u00a9\u03b1\u2192\u2234}\\)",
				full: "$\\text{&nbsp;&copy;&alpha;&rarr;&there4;}$",
				label: "HTML4 named entities",
			},
			{
				body: "\\begin{pmatrix}a \\, b \\\\ c & d\\end{pmatrix}",
				displayMode: true,
				domSource: "$$\\begin{pmatrix}a \\\\\\\\, b \\\\ c & d\\end{pmatrix}$$",
				full: "$$\\begin{pmatrix}a \\, b \\\\ c & d\\end{pmatrix}$$",
				label: "4-backslash PHP matrix normalization",
			},
			{
				body: "frac\u00a0{1}{2}",
				displayMode: false,
				domSource: "\\(frac\u00a0{1}{2}\\)",
				full: "$frac\u00a0{1}{2}$",
				label: "NBSP before brace is not ASCII \\s in PHP",
			},
		];

		for (const item of cases) {
			expect(
				mathDomSourceMatchesSpan(
					item.domSource,
					item.full,
					item.body,
					item.displayMode,
				),
				item.label,
			).toBe(true);
		}
	});

	it("rejects mismatched math DOM sources strictly", () => {
		expect(mathDomSourceMatchesSpan("\\(y\\)", "$z$", "z", false)).toBe(false);
		expect(
			mathDomSourceMatchesSpan(
				"\\(\\text{<}\\)",
				"$\\text{&gt;}$",
				"\\text{&gt;}",
				false,
			),
		).toBe(false);
		expect(
			mathDomSourceMatchesSpan(
				"\\(\\text{<&rightarrow;}\\)",
				"$\\text{&lt;&leftarrow;}$",
				"\\text{&lt;&leftarrow;}",
				false,
			),
		).toBe(false);
		expect(
			mathDomSourceMatchesSpan(
				"\\(\\text{\u00ac}anentity;\\)",
				"$\\text{&lt;&notanentity;}$",
				"\\text{&lt;&notanentity;}",
				false,
			),
		).toBe(false);
		expect(
			mathDomSourceMatchesSpan(
				"\\(\\text{\u20ac}\\)",
				"$\\text{&#129;}$",
				"\\text{&#129;}",
				false,
			),
		).toBe(false);
		expect(decodeWpPreviewMathEntities("&lt;&rightarrow;&notanentity;")).toBe(
			"<&rightarrow;&notanentity;",
		);
		expect(
			decodeWpPreviewMathEntities("&#128;", { mapC1ToWindows1252: true }),
		).toBe("\u20ac");
		expect(
			decodeWpPreviewMathEntities("&#128;", { mapC1ToWindows1252: false }),
		).toBe("\u0080");
	});

	it("mirrors the exact 3-step esc_html -> wp_kses -> HTML decode pipeline for both WP 6.7 and WP 6.8–7.1.5 across all 4 entity classes (R34B #1)", () => {
		const dualVersionCases: ReadonlyArray<
			Readonly<{
				body: string;
				label: string;
				wp67: string;
				wp68: string;
				wp67Win1252?: string;
			}>
		> = [
			// Class 1: Double-encoded numeric entities
			{ body: "&amp;#60;", label: "double-encoded dec &amp;#60;", wp67: "<", wp68: "&#60;" },
			{ body: "&amp;#x3c;", label: "double-encoded hex &amp;#x3c;", wp67: "<", wp68: "&#x3c;" },
			{ body: "&amp;#X3c;", label: "double-encoded upper hex &amp;#X3c;", wp67: "<", wp68: "&#X3c;" },
			{
				body: "&amp;#128;",
				label: "double-encoded C1 &amp;#128;",
				wp67: "\u0080",
				wp67Win1252: "\u20ac",
				wp68: "&#128;",
			},
			{
				body: "&amp;#x10ffff;",
				label: "double-encoded max Unicode &amp;#x10ffff;",
				wp67: "\u{10ffff}",
				wp68: "&#x10ffff;",
			},
			{
				body: "&amp;#X110000;",
				label: "double-encoded out-of-range &amp;#X110000;",
				wp67: "&#x110000;",
				wp68: "&#X110000;",
			},
			{ body: "&amp;&amp;#60;", label: "double-amp &amp;&amp;#60;", wp67: "&<", wp68: "&&#60;" },
			// Class 2: Control chars inside numeric references
			{ body: "&#\x0060;", label: "NUL inside numeric &#\\060;", wp67: "<", wp68: "&#60;" },
			{ body: "&amp;\x00#60;", label: "NUL after &amp; in &amp;\\0#60;", wp67: "<", wp68: "&#60;" },
			{ body: "&\x00#60;", label: "NUL after & in &\\0#60;", wp67: "<", wp68: "&#60;" },
			{ body: "&#\x000;", label: "NUL inside zero ref &#\\00;", wp67: "", wp68: "&#0;" },
			// Class 3: All-zero multi-digit uppercase-X hex refs
			{ body: "&#X00;", label: "2-zero upper hex &#X00;", wp67: "&#x00;", wp68: "&#X00;" },
			{ body: "&#X000;", label: "3-zero upper hex &#X000;", wp67: "&#x000;", wp68: "&#X000;" },
			{ body: "&#X0000000;", label: "7-zero upper hex &#X0000000;", wp67: "&#x0000000;", wp68: "&#X0000000;" },
			{ body: "&#X00000000;", label: "8-zero upper hex &#X00000000;", wp67: "&#x00000000;", wp68: "&#X00000000;" },
			// Class 4: Single-zero numeric refs
			{ body: "&#0;", label: "single-zero dec &#0;", wp67: "", wp68: "&#0;" },
			{ body: "&#x0;", label: "single-zero hex &#x0;", wp67: "", wp68: "&#x0;" },
			{ body: "&#X0;", label: "single-zero upper hex &#X0;", wp67: "", wp68: "&#X0;" },
			{ body: "&amp;#0;", label: "double-encoded single-zero &amp;#0;", wp67: "", wp68: "&#0;" },
			{ body: "&amp;#x0;", label: "double-encoded single-zero &amp;#x0;", wp67: "", wp68: "&#x0;" },
			{ body: "&amp;#X0;", label: "double-encoded single-zero &amp;#X0;", wp67: "", wp68: "&#X0;" },
		];

		for (const item of dualVersionCases) {
			const full = `$${item.body}$`;
			expect(
				decodeWpPreviewMathEntities(item.body, { wpMode: "wp67" }),
				`${item.label} (wp67)`,
			).toBe(item.wp67);
			expect(
				decodeWpPreviewMathEntities(item.body, { wpMode: "wp68" }),
				`${item.label} (wp68)`,
			).toBe(item.wp68);
			expect(
				mathDomSourceMatchesSpan(`\\(${item.wp67}\\)`, full, item.body, false),
				`${item.label} matches wp67 DOM`,
			).toBe(true);
			expect(
				mathDomSourceMatchesSpan(`\\(${item.wp68}\\)`, full, item.body, false),
				`${item.label} matches wp68 DOM`,
			).toBe(true);
			if (undefined !== item.wp67Win1252) {
				expect(
					decodeWpPreviewMathEntities(item.body, {
						mapC1ToWindows1252: true,
						wpMode: "wp67",
					}),
					`${item.label} (wp67 Win1252)`,
				).toBe(item.wp67Win1252);
				expect(
					mathDomSourceMatchesSpan(
						`\\(${item.wp67Win1252}\\)`,
						full,
						item.body,
						false,
					),
					`${item.label} matches wp67 Win1252 DOM`,
				).toBe(true);
			}
		}

		// Negative mismatch guards: neither WP 6.7 nor WP 6.8 produces these outputs.
		expect(
			mathDomSourceMatchesSpan("\\(x + &#X3c;\\)", "$x + &amp;#60;$", "x + &amp;#60;", false),
		).toBe(false);
		expect(
			mathDomSourceMatchesSpan("\\(x + &#x00;\\)", "$x + &#X0;$", "x + &#X0;", false),
		).toBe(false);
		expect(
			mathDomSourceMatchesSpan("\\(x + &amp;#60;\\)", "$x + &#60;$", "x + &#60;", false),
		).toBe(false);
	});

	it("accepts both HTML4 (U+2329/U+232A) and HTML5 (U+27E8/U+27E9) decodings for &lang;/&rang; via mathSpanAcceptedDomSources (R35B #1)", () => {
		const body = "\\text{&lang;x&rang;}";
		const full = `$${body}$`;
		expect(decodeWpPreviewMathEntities(body, { mapC1ToWindows1252: false })).toBe(
			"\\text{\u2329x\u232a}",
		);
		expect(decodeWpPreviewMathEntities(body, { mapC1ToWindows1252: true })).toBe(
			"\\text{\u27e8x\u27e9}",
		);
		const accepted = mathSpanAcceptedDomSources(full, body, false);
		expect(accepted).toContain(full);
		expect(accepted).toContain("\\(\\text{\u2329x\u232a}\\)");
		expect(accepted).toContain("\\(\\text{\u27e8x\u27e9}\\)");
		expect(
			mathDomSourceMatchesSpan("\\(\\text{\u2329x\u232a}\\)", full, body, false),
		).toBe(true);
		expect(
			mathDomSourceMatchesSpan("\\(\\text{\u27e8x\u27e9}\\)", full, body, false),
		).toBe(true);
	});
});
