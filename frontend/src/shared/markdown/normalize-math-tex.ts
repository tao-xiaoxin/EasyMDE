/**
 * Normalize common TeX command escapes and single-backslash matrix row breaks.
 *
 * Mirrors PHP `EasyMDE\Content\MarkdownRenderer::normalize_math_tex()`
 * identically so both formal Preview (`frontend-enhancement-runtime`) and
 * unlocked visual editing render the exact same math output.
 */
export function normalizeMathTex(tex: string): string {
	if (!tex) return tex;

	const normalized = tex
		.replace(/(^|[^A-Za-z\\])(begin|end)(?=\s*\{)/g, "$1\\$2")
		.replace(/(^|[^A-Za-z\\])(frac|dfrac|tfrac|binom|sqrt)(?=\s*\{)/g, "$1\\$2")
		.replace(
			/(^|[^A-Za-z\\])(left|right)(?=\s*(?:[()[\]{}|.]|\\[{}]))/g,
			"$1\\$2",
		)
		.replace(
			/(^|[^A-Za-z\\])(log|ln|exp|lim|sin|cos|tan|cot|sec|csc|min|max|sup|inf)(?![A-Za-z])/g,
			"$1\\$2",
		)
		.replace(
			/(^|[^A-Za-z\\])(cdots|ldots|dots|vdots|ddots|cdot|times|div|pm|mp|leq|geq|neq|approx|infty)(?![A-Za-z])/g,
			"$1\\$2",
		);

	return normalized.replace(
		/\\begin\{([A-Za-z]*matrix|array)\}([\s\S]*?)\\end\{\1\}/g,
		(_match, environment: string, body: string) =>
			`\\begin{${environment}}${body.replace(/(^|[^\\])\\(?![\\A-Za-z{])/g, "$1\\\\")}\\end{${environment}}`,
	);
}
