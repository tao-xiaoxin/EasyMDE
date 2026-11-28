import { createWordPressFixture } from './wechat-wordpress-fixture.mjs';
import { test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrivateAdapter } from "./wechat-task-context/private-adapter.mjs";
import { canonicalMarkdown } from "./wechat-task-context/environment.mjs";
import {
  localDiagnosticsEnabled,
  requiredEnvironment,
  validateLocalDiagnosticPrerequisites,
  wpCli,
  wpPath
} from "./wechat-task-context/local-diagnostics.mjs";
import { runCdpGeometryCase, runStageBReadyGeometryCase } from "./wechat-task-context/stage-b-case.mjs";
import { runSourceOnlyCase } from "./wechat-task-context/source-only-case.mjs";
import { waitForVisibleSelector } from "./wechat-task-context/editor-session.mjs";
import { runVisibleTaskOwnerScenario } from './wechat-task-context/visible-task-owner-scenario.mjs';
import { runHiddenTaskOwnerScenario } from './wechat-task-context/hidden-task-owner-scenario.mjs';

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off'
});

if (localDiagnosticsEnabled) {
  // The configured credentials are loaded by Playwright's config and remain
  // in the process environment. They are deliberately never copied to diagnostics.
  requiredEnvironment('WORDPRESS_ADMIN_USER');
  requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
}
const {
  testSlug,
  createOwnedUser,
  createOwnedPost,
  cleanupOwnedRecords,
  login
} = createWordPressFixture({
  prefix: 'wechat-task-context',
  wpPath,
  wpCli: wpCli ?? '',
  slugPrefix: 'wechat-context',
  userPrefix: (slug) => `easymde-${slug}`,
  randomPassword: true,
  postTitlePrefix: 'WeChat task context',
  postContent: '<p>Owned WeChat task context post.</p>',
  markdown: canonicalMarkdown,
  postMeta: ({ markdownTheme = 'default' }) => ({
    _easymde_markdown_theme: markdownTheme
  }),
  postIdField: 'wechatTaskContextPostId',
  userIdField: 'wechatTaskContextUserId',
  loginWaitForVisibleSelector: waitForVisibleSelector
});

let privateRoot;
let privateAdapterCode;

test.describe('WeChat task context on the live WordPress editor', () => {
  test.skip(!localDiagnosticsEnabled, 'wechat-task-context-local-diagnostics-disabled');

  test.beforeAll(async ({ baseURL }) => {
    validateLocalDiagnosticPrerequisites(baseURL);
    privateRoot = await mkdtemp(join(tmpdir(), 'easymde-wechat-task-context-'));
    privateAdapterCode = await buildPrivateAdapter(privateRoot);
  });

  test.afterAll(async () => {
    if (privateRoot) await rm(privateRoot, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page: _page }, testInfo) => {
    testInfo.wechatTaskContextUser = createOwnedUser(testSlug(testInfo));
    testInfo.wechatTaskContextUserId = testInfo.wechatTaskContextUser.id;
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    cleanupOwnedRecords(testInfo);
  });

  test('phycat-sky visible 335 completes the real static task-owner Clipboard write', async ({ page, baseURL }, testInfo) => {
    await runVisibleTaskOwnerScenario({ baseURL, createOwnedPost, login, page, privateAdapterCode, test, testInfo, testSlug });
  });

  test('phycat-sky immersive hidden nominal335 actual335.5 completes the hidden static task-owner write', async ({ page, baseURL }, testInfo) => {
    await runHiddenTaskOwnerScenario({ baseURL, createOwnedPost, login, page, privateAdapterCode, test, testInfo, testSlug });
  });

  for (const scenario of [
    {
      name: 'CDP Core float(default) nominal335',
      surface: 'ordinary-visible',
      themeId: 'default'
    },
    {
      name: 'Bloom translation(bloom-petal) nominal335 actual335.5',
      surface: 'immersive-hidden',
      themeId: 'bloom-petal'
    }
  ]) {
    test(scenario.name, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const outcome = await runCdpGeometryCase(page, baseURL, testInfo, scenario, {
          createOwnedPost,
          login,
          privateAdapterCode,
          testSlug
        });
      if (outcome.unavailableCode) {
        testInfo.annotations.push({
          description: outcome.unavailableCode,
          type: 'unverified'
        });
        test.skip(true, outcome.unavailableCode);
      }
    });
  }

  test.describe('StageB ready task geometry', () => {
    for (const scenario of [
      {
        expectedReference: 'source',
        name: 'StageB ready task geometry Core default',
        surface: 'ordinary-visible',
        themeId: 'default'
      },
      {
        expectedReference: 'source',
        name: 'StageB ready task geometry Bloom bloom-petal',
        surface: 'ordinary-visible',
        themeId: 'bloom-petal'
      }
    ]) {
      test(scenario.name, async ({ page, baseURL }, testInfo) => {
        test.setTimeout(120_000);
        const outcome = await runStageBReadyGeometryCase(page, baseURL, testInfo, scenario, {
          createOwnedPost,
          login,
          privateAdapterCode,
          testSlug
        });
        if (outcome.unavailableCode) {
          testInfo.annotations.push({
            description: outcome.unavailableCode,
            type: 'unverified'
          });
          test.skip(true, outcome.unavailableCode);
        }
      });
    }
  });
});

test.describe('Source-only CDP capability', () => {
  test.skip(!localDiagnosticsEnabled, 'wechat-task-context-local-diagnostics-disabled');

  test.beforeAll(async ({ baseURL }) => {
    validateLocalDiagnosticPrerequisites(baseURL);
  });

  test.beforeEach(async ({ page: _page }, testInfo) => {
    testInfo.wechatTaskContextUser = createOwnedUser(testSlug(testInfo));
    testInfo.wechatTaskContextUserId = testInfo.wechatTaskContextUser.id;
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    cleanupOwnedRecords(testInfo);
  });

  for (const scenario of [
    { name: 'Source-only CDP capability Core default canonical', themeId: 'default' },
    { name: 'Source-only CDP capability Bloom bloom-petal canonical', themeId: 'bloom-petal' }
  ]) {
    test(scenario.name, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const unavailableCode = await runSourceOnlyCase(page, baseURL, testInfo, scenario, {
        createOwnedPost,
        login,
        testSlug
      });
      if (unavailableCode) {
        testInfo.annotations.push({ description: unavailableCode, type: 'unverified' });
        test.skip(true, unavailableCode);
      }
    });
  }
});
