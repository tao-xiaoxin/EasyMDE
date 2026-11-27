import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';

// The capability fixture is the single canonical WeChat export source for the
// performance and task-context specs. The pinned identity below is the stored
// expectation; `canonicalMarkdownFixture` reads the checked-in document and
// fails fast when its length or digest no longer matches.
export const CANONICAL_MARKDOWN_PATH = 'docs/examples/markdown-full-capability-test.md';
export const CANONICAL_MARKDOWN_LENGTH = 9254;
export const CANONICAL_MARKDOWN_SHA256 =
	'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb';
export const CANONICAL_SOURCE_SELECTOR = '#easymde-source';

export function canonicalMarkdownFixture(repositoryRoot, failureCode) {
	const markdown = readFileSync(join(repositoryRoot, CANONICAL_MARKDOWN_PATH), 'utf8');
	const sha256 = createHash('sha256').update(markdown, 'utf8').digest('hex');
	if (markdown.length !== CANONICAL_MARKDOWN_LENGTH || sha256 !== CANONICAL_MARKDOWN_SHA256) {
		throw new Error(failureCode);
	}
	return { length: markdown.length, markdown, sha256 };
}

export async function assertCanonicalSourceText(
	page,
	{ expectedLength, expectedSha256, selector = CANONICAL_SOURCE_SELECTOR }
) {
	const matches = await page.locator(selector).evaluate(async (element, expected) => {
		if (!(element instanceof HTMLTextAreaElement)) return false;
		const bytes = new TextEncoder().encode(element.value);
		const digest = await crypto.subtle.digest('SHA-256', bytes);
		const hash = [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		return element.value.length === expected.length && hash === expected.sha256;
	}, { length: expectedLength, sha256: expectedSha256 });
	expect(matches).toBe(true);
}
