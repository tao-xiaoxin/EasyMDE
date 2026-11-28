import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { collectFailureDiagnostics } from "./wechat-copy/page-diagnostics.mjs";
import { visibleSelectorDiagnosticsByPage } from "./wechat-copy/page-diagnostics.mjs";
import { waitForVisibleSelector } from "./wechat-copy/page-diagnostics.mjs";
import { createWordPressFixture } from './wechat-wordpress-fixture.mjs';
import { runLongTaskStopScenario } from './wechat-copy/long-task-stop-scenario.mjs';
import { runPrivatePixelEvidenceBoundaryScenario } from './wechat-copy/fixture-boundary-scenario.mjs';
import { runCopyModeScenario1 } from './wechat-copy/copy-modes-scenarios.mjs';
import { runCopyModeScenario2 } from './wechat-copy/copy-modes-scenarios.mjs';
import { runCopyModeScenario3 } from './wechat-copy/copy-modes-scenarios.mjs';
import { runCopyModeScenario4 } from './wechat-copy/copy-modes-scenarios.mjs';
import { runThemeProjectionScenario1 } from './wechat-copy/theme-projection-scenarios.mjs';
import { runThemeProjectionScenario2 } from './wechat-copy/theme-projection-scenarios.mjs';
import { runThemeProjectionScenario3 } from './wechat-copy/theme-projection-scenarios.mjs';
import { runThemeProjectionScenario4 } from './wechat-copy/theme-projection-scenarios.mjs';
import { runCopyModeScenario5 } from './wechat-copy/copy-modes-scenarios.mjs';
import { runThemeProjectionScenario5 } from './wechat-copy/theme-projection-scenarios.mjs';
import { runThemeProjectionScenario6 } from './wechat-copy/theme-projection-scenarios.mjs';
import { runCopyModeScenario6 } from './wechat-copy/copy-modes-scenarios.mjs';
import { runMermaidPngScenario1 } from './wechat-copy/mermaid-png-scenarios.mjs';
import { runMermaidPngScenario2 } from './wechat-copy/mermaid-png-scenarios.mjs';
import { runMermaidPngScenario3 } from './wechat-copy/mermaid-png-scenarios.mjs';
import { runMermaidPngScenario4 } from './wechat-copy/mermaid-png-scenarios.mjs';
import { runCopyFeedbackScenario1 } from './wechat-copy/copy-feedback-scenarios.mjs';
import { runCopyFeedbackScenario2 } from './wechat-copy/copy-feedback-scenarios.mjs';
import { runCopyFeedbackScenario3 } from './wechat-copy/copy-feedback-scenarios.mjs';
import { runTaskMarkerScenario1 } from './wechat-copy/task-marker-scenarios.mjs';
import { runTaskMarkerScenario2 } from './wechat-copy/task-marker-scenarios.mjs';
import { runTaskMarkerScenario3 } from './wechat-copy/task-marker-scenarios.mjs';

// DevTools snapshots can add browser tasks inside the click-to-pending window.
test.use({ trace: 'off', video: 'off' });

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or process environment.`);
  }
  return value;
}
const {
  cleanupOwnedRecords,
  createOwnedUser,
  login,
  testSlug
} = createWordPressFixture({
  cleanupPostTypes: 'post,page,attachment',
  cleanupReassignUserId: 1,
  loginWaitForVisibleSelector: waitForVisibleSelector,
  password: adminPassword,
  prefix: 'wechat-copy',
  randomPassword: false,
  slugPrefix: 'wechat',
  userIdField: 'wechatUserId',
  userPrefix: (slug) => `${adminUser}-${slug}-user`,
  wpCli,
  wpPath
});
test('rejects private pixel evidence symlink escapes before outside creation', async ({ baseURL: _baseURL }, testInfo) => {
	await runPrivatePixelEvidenceBoundaryScenario({ _baseURL, test, testInfo });
});


test('separates Long Tasks in the Copy stop frame from later tasks', async ({ baseURL, browser }, testInfo) => {
  await runLongTaskStopScenario({ baseURL, browser, testInfo });
});

test.describe('WeChat copy browser regressions', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    visibleSelectorDiagnosticsByPage.set(_page, testInfo);
    testInfo.wechatUser = createOwnedUser(testSlug(testInfo));
    testInfo.wechatUserId = testInfo.wechatUser.id;
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    try {
      if (testInfo.errors.length > 0 || testInfo.status !== testInfo.expectedStatus) {
        const diagnosticsPath = testInfo.outputPath('wechat-copy-failure-diagnostics.json');
        await writeFile(
          diagnosticsPath,
          JSON.stringify({
            ...(await collectFailureDiagnostics(_page)),
            bloomGantt: testInfo.wechatBloomGanttEvidence ?? null,
            finiteTransitionProbe: testInfo.wechatFiniteTransitionProbeCases ?? [],
            heartbeatRequests: testInfo.wechatHeartbeatRequests ?? [],
            visibleSelector: testInfo.wechatVisibleSelectorDiagnostics ?? []
          }, null, 2),
          'utf8'
        );
        await testInfo.attach('wechat-copy-failure-diagnostics.json', {
          contentType: 'application/json',
          path: diagnosticsPath
        });
      }
    } finally {
      try {
        cleanupOwnedRecords(testInfo);
      } finally {
        visibleSelectorDiagnosticsByPage.delete(_page);
      }
    }
  });

  test('keeps split math roots read-only across ordinary and nonwindowed immersive Preview', async ({
    baseURL,
    page
  }, testInfo) => {
    await runCopyModeScenario1({ baseURL, login, page, test, testInfo });
  });

  test('preserves full-capability Preview presentation through portable Source and cold Source entry', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyModeScenario2({ baseURL, context, login, page, test, testInfo });
  });

  test('keeps the PNG measurement lease through hidden Source appearance refresh', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyModeScenario3({ baseURL, context, login, page, test, testInfo });
  });

  test('keeps the native width projection fluid across independent destinations', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyModeScenario4({ baseURL, context, login, page, test, testInfo });
  });

  test('keeps theme-owned outer spacing across article/code projections and copy modes', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runThemeProjectionScenario1({ baseURL, context, login, page, test, testInfo });
  });

  test('verifies native Clipboard payload code fidelity across every registered code theme', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runThemeProjectionScenario2({ baseURL, context, login, page, test, testInfo });
  });

  test('verifies sorted code themes across rotating article families and all copy modes', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runThemeProjectionScenario3({ baseURL, context, login, page, test, testInfo });
  });

  test('verifies native Clipboard payload article fidelity across registered themes and family surfaces', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runThemeProjectionScenario4({ baseURL, context, login, page, test, testInfo });
  });

  test('causally settles finite PHYcat Preview animations before one immersive Copy', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyModeScenario5({ baseURL, context, login, page, test, testInfo });
  });

  test('preserves immediate native Copy after the original Inkwell to Animal theme transition', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runThemeProjectionScenario5({ baseURL, context, login, page, test, testInfo });
  });

  test('cancels ordinary and immersive Copy across article and code theme transitions', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runThemeProjectionScenario6({ baseURL, context, login, page, test, testInfo });
  });


  test('rasterizes current visual roots after immersive Source hides Preview', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyModeScenario6({ baseURL, context, login, page, test, testInfo });
  });

  test('keeps canonical Mermaid Gantt width and layout independent of preview width', async ({
    baseURL,
    page
  }, testInfo) => {
    await runMermaidPngScenario1({ baseURL, login, page, test, testInfo });
  });

  test('keeps full example Mermaid PNGs bounded in ordinary and immersive Copy', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runMermaidPngScenario2({ baseURL, context, login, page, test, testInfo });
  });

  test('copies Bloom decorated intrinsic Mermaid roles through real Copy at narrow, immersive, and wide widths', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runMermaidPngScenario3({ baseURL, context, login, page, test, testInfo });
  });

  test('copies neutral phycat-sky full-fixture responsive Mermaid roles at DPR1/2', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runMermaidPngScenario4({ baseURL, context, login, page, test, testInfo });
  });

  test('times out a loaded no-reply PNG worker without partial Clipboard or measurement owners', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyFeedbackScenario1({ baseURL, context, login, page, test, testInfo });
  });

  test('cold medium copy shows pending feedback, coalesces clicks, and preserves the source and Preview', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyFeedbackScenario2({ baseURL, context, login, page, test, testInfo });
  });

  test('warm full-capability copy keeps rich output and ordinary/immersive feedback stable', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runCopyFeedbackScenario3({ baseURL, context, login, page, test, testInfo });
  });

  test('preserves full-capability task marker geometry through Default ordinary Copy', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runTaskMarkerScenario1({ baseURL, context, login, page, test, testInfo });
  });

  test('runs task marker geometry negative oracle without Copy or upload', async ({
    baseURL,
    page
  }, testInfo) => {
    await runTaskMarkerScenario2({ baseURL, login, page, test, testInfo });
  });

  test('preserves full-capability task marker geometry through PHYcat Sky immersive Source Copy', async ({
    baseURL,
    context,
    page
  }, testInfo) => {
    await runTaskMarkerScenario3({ baseURL, context, login, page, test, testInfo });
  });
});
