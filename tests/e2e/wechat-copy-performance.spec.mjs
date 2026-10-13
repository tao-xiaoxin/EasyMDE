import { createWordPressFixture } from './wechat-wordpress-fixture.mjs';
import { test } from "@playwright/test";
import { canonicalMarkdown } from "./wechat-copy-performance/environment.mjs";
import { expectedArticleTheme } from "./wechat-copy-performance/environment.mjs";
import { expectedCodeTheme } from "./wechat-copy-performance/environment.mjs";
import { localDiagnosticsEnabled } from "./wechat-copy-performance/environment.mjs";
import { localDiagnosticsEnvironment } from "./wechat-copy-performance/environment.mjs";
import { requiredEnvironment } from "./wechat-copy-performance/environment.mjs";
import { wpCli } from "./wechat-copy-performance/environment.mjs";
import { wpPath } from "./wechat-copy-performance/environment.mjs";
import { runPerformanceProfileScenario } from './wechat-copy-performance/profile-scenario.mjs';
import { runCandidateCaptureScenario } from './wechat-copy-performance/candidate-scenario.mjs';
import { runSourceDiagnosticScenario } from './wechat-copy-performance/source-diagnostic-scenario.mjs';

// The configured credentials are read here, in the spec, so importing a
// performance helper never requires live credentials.
const adminUser = localDiagnosticsEnabled
	? requiredEnvironment("WORDPRESS_ADMIN_USER")
	: null;
const adminPassword = localDiagnosticsEnabled
	? requiredEnvironment("WORDPRESS_ADMIN_PASSWORD")
	: null;

// Playwright tracing, video, and screenshots add browser work to the measured
// Copy window. This case owns its private timing collection instead.
test.use({
	screenshot: "off",
	trace: "off",
	video: "off",
});

const {
  runWp,
  testSlug,
  createOwnedUser,
  createOwnedPost,
  cleanupOwnedRecords,
  login
} = createWordPressFixture({
  prefix: 'wechat-copy-performance',
  wpPath,
  wpCli,
  slugPrefix: 'wechat-performance',
  userPrefix: (slug) => `${adminUser}-${slug}`,
  password: adminPassword,
  postType: 'post',
  postTitlePrefix: 'WeChat performance',
  postContent: '<p>Owned WeChat performance post.</p>',
  markdown: canonicalMarkdown,
  postMeta: {
    _easymde_markdown_theme: expectedArticleTheme,
    _easymde_code_theme: expectedCodeTheme
  },
  postIdField: 'wechatPerformancePostId',
  userIdField: 'wechatPerformanceUserId',
  cleanupStrict: true,
  cleanupFailureCode: 'wechat-copy-performance-cleanup-failed'
});

test.beforeEach(async ({ page: _page }, testInfo) => {
	test.skip(
		!localDiagnosticsEnabled,
		`${localDiagnosticsEnvironment}=1 is required for private local diagnostics`,
	);
	testInfo.wechatPerformanceUser = createOwnedUser(testSlug(testInfo));
	testInfo.wechatPerformanceUserId = testInfo.wechatPerformanceUser.id;
});

test.afterEach(async ({ page: _page }, testInfo) => {
	try {
		cleanupOwnedRecords(testInfo);
	} catch {
		const cleanupError = {
			message: "wechat-copy-performance-owned-cleanup-failed",
		};
		if (testInfo.errors.length > 0) {
			testInfo.errors.push(cleanupError);
			return;
		}
		throw new Error(cleanupError.message);
	}
});

test("profiles one selected Cherry/phycat-code Copy with real R2 PNG export @performance", async ({
	baseURL,
	context,
	page,
}, testInfo) => {
	await runPerformanceProfileScenario({ baseURL, context, createOwnedPost, login, page, runWp, test, testInfo, testSlug });
});

test("captures one ordinary Split Cherry rich Clipboard candidate @candidate", async ({
	baseURL,
	context,
	page,
}, testInfo) => {
	await runCandidateCaptureScenario({ baseURL, context, createOwnedPost, login, page, runWp, test, testInfo, testSlug });
});

test("diagnoses source-only Split Cherry scroll mutations without Copy @source-diagnostic", async ({
	baseURL,
	page,
}, testInfo) => {
	await runSourceDiagnosticScenario({ baseURL, createOwnedPost, login, page, runWp, test, testInfo, testSlug });
});
