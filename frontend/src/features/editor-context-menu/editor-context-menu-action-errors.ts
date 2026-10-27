/**
 * Privacy-safe action error mapping. Editor owner codes are already stable
 * operation identifiers; exception messages and document content never cross
 * this boundary.
 */
export function contextMenuActionErrorCode(
	error: unknown,
	fallback: string
): string {
	if (!(error instanceof Error)) return fallback;
	return /^editor-(?:block-index|code-content|image-pixels|source-link|context-menu)-[a-z0-9-]+$/u.test(
		error.message
	)
		? error.message
		: fallback;
}
