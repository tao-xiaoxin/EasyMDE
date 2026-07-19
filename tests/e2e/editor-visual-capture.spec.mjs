import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { validateEditorVisualManifest } from '../../scripts/editor-visual-contract.mjs';
import {
  runVisualCaptureLifecycle,
  validateReferenceCaptureRuntime
} from './editor-visual-capture-lifecycle.mjs';

const captureMode = process.env.EASYMDE_E2E_VISUAL_CAPTURE === '1';
const legacyReferenceMode = process.env.EASYMDE_E2E_LEGACY_REFERENCE === '1';
const visualEnvironment = process.env.EASYMDE_VISUAL_ENVIRONMENT;
const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminPassword = 'EasyMDE-visual-reference-pass-1!';
const captureUsername = 'easymde-visual-capture';
const captureDisplayName = 'EasyMDE Visual Capture';
const repoRoot = new URL('../..', import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
const fixturePath = 'tests/e2e/fixtures/editor-phase-0.json';
const fixtureSource = readFileSync(join(repoRoot, fixturePath));
const fixture = JSON.parse(fixtureSource);
const reference = readJson('tests/e2e/fixtures/editor-visual-reference.json');
const matrix = readJson('tests/e2e/fixtures/editor-visual-matrix.json');
const fixtureContractSha256 = createHash('sha256').update(fixtureSource).digest('hex');
const canonicalMarkdown = readFileSync(join(repoRoot, fixture.canonicalMarkdown), 'utf8');
const remoteFixtureImageUrl = 'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png';
const visualEnvironmentScript = join(repoRoot, 'scripts/editor-visual-environments.sh');

function runWp(args) {
  if (!wpPath) {
    throw new Error('EASYMDE_E2E_WP_PATH must point to the fixed Legacy Reference WordPress install.');
  }

  const result = spawnSync(
    wpCli,
    [...args, `--path=${wpPath}`, '--allow-root'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WP_CLI_CACHE_DIR: process.env.WP_CLI_CACHE_DIR || '/tmp/easymde-wp-cli-cache'
      }
    }
  );

  if (result.status !== 0) {
    throw new Error(`wp ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }

  return result.stdout.trim();
}

function readReferenceRuntime() {
  const result = spawnSync('bash', [visualEnvironmentScript, 'reference-runtime'], {
    encoding: 'utf8',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`Reference runtime identity failed\n${result.stdout}\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error('The fixed Reference runtime identity is not valid JSON.', { cause: error });
  }
}

async function login(page, user) {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(user.username);
  await page.locator('#user_pass').fill(user.password);
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

function safeSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'capture';
}

function canonicalMarkdownForSite(localImageUrl) {
  return canonicalMarkdown.replaceAll(remoteFixtureImageUrl, localImageUrl);
}

test.describe('EasyMDE fixed Legacy Reference visual capture', () => {
  test.skip(!captureMode, 'Run only through the explicit visual capture workflow.');
  test.skip(!legacyReferenceMode, 'Visual baseline capture requires the fixed Legacy Reference owner.');
  test.skip(visualEnvironment !== 'reference', 'Visual baseline capture must never run against the refactor environment.');

  test('captures the Phase 0 baseline and writes a privacy-safe manifest', async ({ browser, page }, testInfo) => {
    test.setTimeout(240_000);

    const captures = [];
    const runIdentity = process.env.EASYMDE_VISUAL_RUN_ID || `reference-${Date.now()}`;
    let artifactRoot = null;
    let captureRoot = null;
    const defaultViewport = { ...reference.runtime.viewport };
    const unexpectedExternalRequests = [];
    const expectedOrigin = new URL(
      process.env.EASYMDE_E2E_BASE_URL || 'http://127.0.0.1:8089'
    ).origin;
    let captureIndex = 0;

    if (!/^[A-Za-z0-9._-]+$/.test(runIdentity)) {
      throw new Error('EASYMDE_VISUAL_RUN_ID may contain only letters, numbers, dot, underscore, and hyphen.');
    }

    page.on('request', (request) => {
      const url = new URL(request.url());

      if (/^https?:$/.test(url.protocol) && url.origin !== expectedOrigin) {
        unexpectedExternalRequests.push(request.resourceType());
      }
    });

    function localFixtureImageUrl() {
      const attachmentId = runWp([
        'post',
        'list',
        '--post_type=attachment',
        '--name=easymde-visual-featured-image',
        '--format=ids'
      ]);

      if (!/^\d+$/.test(attachmentId)) {
        throw new Error('The seeded local visual fixture image is unavailable.');
      }

      return runWp(['post', 'get', attachmentId, '--field=guid']);
    }

    async function waitForCaptureReadiness(readiness) {
      if (readiness === 'success') {
        const preview = page.locator(
          '.easymde-immersive-workspace__preview:visible, #easymde-preview:visible'
        ).first();

        await expect(preview).toHaveAttribute('aria-busy', 'false');
        await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
        await expect(preview).not.toHaveAttribute('data-easymde-preview-enhancement-error', '1');
        await expect(preview.locator('.easymde-mermaid svg').first()).toBeVisible();
        await expect(preview.locator('.katex').first()).toBeVisible();
        await expect(preview.locator('pre code.hljs').first()).toBeVisible();
      }

      await page.evaluate(async () => {
        await document.fonts.ready;

        const renderedImages = Array.from(document.images).filter(
          (image) => image.getClientRects().length > 0
        );

        await Promise.all(renderedImages.map(async (image, index) => {
          const surface = image.closest('.easymde-immersive-workspace__preview')
            ? 'immersive-preview'
            : image.closest('#easymde-preview')
              ? 'normal-preview'
              : 'wordpress-admin';

          try {
            await image.decode();
          } catch {
            throw new Error(`Rendered image readiness failed in ${surface} at index ${index}.`);
          }

          if (image.naturalWidth === 0) {
            throw new Error(`Rendered image readiness failed in ${surface} at index ${index}.`);
          }
        }));
      });

      expect(unexpectedExternalRequests, 'Visual capture made a cross-origin browser request.').toEqual([]);
    }

    async function capture({
      component,
      state,
      locator = null,
      fullPage = false,
      zoom = 1,
      readiness = 'success'
    }) {
      await waitForCaptureReadiness(readiness);
      const viewport = page.viewportSize();
      const appearance = await page.evaluate(() => {
        const preview = document.querySelector('#easymde-preview, .easymde-immersive-workspace__preview');
        const root = document.querySelector('#easymde-editor');
        const classes = root ? Array.from(root.classList) : [];
        const article = classes.find((name) => name.startsWith('easymde-markdown-theme-')) || 'easymde-markdown-theme-default';
        const code = classes.find((name) => name.startsWith('easymde-code-theme-')) || 'easymde-code-theme-default';

        return {
          direction: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
          font: preview ? getComputedStyle(preview).fontFamily : 'system-ui',
          theme: `${article.replace('easymde-markdown-theme-', '')}/${code.replace('easymde-code-theme-', '')}`
        };
      });
      const file = `${String(++captureIndex).padStart(3, '0')}-${safeSlug(component)}-${safeSlug(state)}.png`;
      const relativeFile = `captures/${file}`;
      const path = join(captureRoot, file);

      if (locator) {
        await locator.screenshot({ path, animations: 'disabled' });
      } else {
        await page.screenshot({ path, fullPage, animations: 'disabled' });
      }

      expect(unexpectedExternalRequests, 'Visual capture made a cross-origin browser request.').toEqual([]);

      captures.push({
        referenceCommit: reference.referenceCommit,
        environment: visualEnvironment,
        fixture: fixture.identity,
        component,
        state,
        viewport,
        zoom,
        locale: reference.runtime.locale,
        direction: appearance.direction,
        theme: appearance.theme,
        font: appearance.font,
        browser: reference.runtime.browser,
        browserVersion: browser.version(),
        runIdentity,
        file: relativeFile
      });
    }

    async function captureButtons(container, componentPrefix) {
      const buttons = container.locator('button:visible');
      const count = await buttons.count();

      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const identity = await button.evaluate((node) => (
          node.getAttribute('aria-label')
          || node.getAttribute('title')
          || node.dataset.easymdeCommand
          || node.dataset.action
          || `button-${index + 1}`
        ));

        await capture({
          component: `${componentPrefix}-${safeSlug(identity)}`,
          state: 'every-toolbar-button',
          locator: button
        });

        const iconOnly = await button.evaluate((node) => node.innerText.trim() === '');
        if (iconOnly) {
          await capture({
            component: `${componentPrefix}-icon-${safeSlug(identity)}`,
            state: 'every-icon-only-button',
            locator: button
          });
        }
      }
    }

    await runVisualCaptureLifecycle(
      {
        account: {
          displayName: captureDisplayName,
          email: 'easymde-visual-capture@example.test',
          password: adminPassword,
          username: captureUsername
        },
        preflight: () => {
          validateReferenceCaptureRuntime(
            readReferenceRuntime(),
            {
              externalHttpBlocked: true,
              fixtureContractSha256,
              fixtureIdentity: fixture.identity,
              locale: reference.runtime.locale,
              phpVersion: reference.runtime.phpVersion,
              pluginVersion: reference.referenceRelease.pluginVersion,
              releaseSha256: reference.referenceRelease.sha256,
              sourceCommit: reference.referenceCommit,
              wordpressVersion: reference.runtime.wordpressVersion
            }
          );

          if (browser.version() !== reference.runtime.browserVersion) {
            throw new Error('browserVersion does not match the fixed Reference contract.');
          }
        },
        prepare: () => {
          artifactRoot = testInfo.outputPath('visual-evidence');
          captureRoot = join(artifactRoot, 'captures');
          mkdirSync(captureRoot, { recursive: true });
        },
        runWp
      },
      async (user) => {
        await page.clock.install({ time: new Date('2026-07-18T12:00:00Z') });
        await page.setViewportSize(defaultViewport);
        await login(page, user);
        await page.goto('/wp-admin/post-new.php');
        await expect(page.locator('#easymde-editor')).toHaveAttribute('data-easymde-shell-ready', '1');
        await page.locator('#title').fill('EasyMDE Phase 0 synthetic visual baseline');
        await page.locator('#easymde-source').fill(canonicalMarkdownForSite(localFixtureImageUrl()));
        await expect(page.locator('#easymde-preview')).toHaveAttribute('aria-busy', 'false');

        await capture({ component: 'editor-page', state: 'normal-editor', fullPage: true });
        await capture({ component: 'toolbar', state: 'toolbar', locator: page.locator('#easymde-toolbar') });
        await capture({ component: 'editor', state: 'source-and-preview', locator: page.locator('#easymde-editor') });
        await capture({ component: 'wordpress-admin', state: 'wordpress-native-surroundings', fullPage: true });
        await captureButtons(page.locator('#easymde-toolbar'), 'normal-toolbar');

        const normalButton = page.locator('#easymde-toolbar button:visible').first();
        await normalButton.hover();
        await capture({ component: 'toolbar-button', state: 'hover', locator: normalButton });
        await capture({ component: 'toolbar-tooltip', state: 'tooltip', locator: normalButton });
        await normalButton.focus();
        await capture({ component: 'toolbar-button', state: 'focus-visible', locator: normalButton });
        const buttonBox = await normalButton.boundingBox();
        if (!buttonBox) {
          throw new Error('Cannot capture the pressed toolbar button without a bounding box.');
        }
        await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
        await page.mouse.down();
        await capture({ component: 'toolbar-button', state: 'pressed', locator: normalButton });
        await page.mouse.up();

        await page.locator('.easymde-toolbar-popover-headings > button').click();
        const headingPanel = page.locator('.easymde-toolbar-popover-headings > .easymde-toolbar-popover');
        await expect(headingPanel).toBeVisible();
        await capture({ component: 'heading', state: 'heading-select', locator: headingPanel });
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Appearance' }).click();
        const appearancePanel = page.locator('.easymde-toolbar-popover-appearance-panel');
        await expect(appearancePanel).toBeVisible();
        await capture({ component: 'appearance', state: 'popover', locator: appearancePanel });
        await capture({ component: 'article-theme', state: 'article-theme-select', locator: appearancePanel.locator('.easymde-theme-select') });
        await capture({ component: 'code-theme', state: 'code-theme-select', locator: appearancePanel.locator('.easymde-code-theme-select') });
        await capture({ component: 'custom-css', state: 'custom-css-select', locator: appearancePanel.locator('.easymde-custom-css-toggle') });
        await capture({ component: 'article-theme', state: 'selected', locator: appearancePanel.locator('.easymde-theme-select') });
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Font', exact: true }).click();
        const fontPanel = page.locator('.easymde-toolbar-popover-font-panel');
        await expect(fontPanel).toBeVisible();
        await capture({ component: 'font', state: 'font-select', locator: fontPanel });
        await page.keyboard.press('Escape');

        await page.locator('#title').fill(fixture.syntheticValues.longTitle);
        await capture({ component: 'editor-page', state: 'long-title', fullPage: true });
        await page.locator('#title').fill('EasyMDE Phase 0 synthetic visual baseline');

        const siteMarkdown = canonicalMarkdownForSite(localFixtureImageUrl());
        await page.locator('#easymde-source').fill(`${siteMarkdown}\n\n${siteMarkdown}\n\n${siteMarkdown}`);
        await expect(page.locator('#easymde-preview')).toHaveAttribute('aria-busy', 'false');
        await capture({ component: 'editor', state: 'large-document', locator: page.locator('#easymde-editor') });

        await page.setViewportSize({ width: 720, height: 900 });
        await capture({ component: 'editor-page', state: 'narrow-viewport', fullPage: true });
        await page.setViewportSize(defaultViewport);

        await page.evaluate(() => {
          document.documentElement.dir = 'rtl';
        });
        await capture({ component: 'editor-page', state: 'rtl', fullPage: true });
        await page.evaluate(() => {
          document.documentElement.dir = 'ltr';
        });

        await page.evaluate(() => {
          document.documentElement.style.zoom = '2';
        });
        await capture({ component: 'editor-page', state: 'zoom-200', fullPage: true, zoom: 2 });
        await page.evaluate(() => {
          document.documentElement.style.zoom = '';
        });

        let releasePreview;
        await page.route('**/wp-json/easymde/v1/preview*', async (route) => {
          await new Promise((resolve) => {
            releasePreview = resolve;
          });
          await route.continue();
        });
        await page.locator('#easymde-source').fill(`${siteMarkdown}\n\nPreview loading state.`);
        await expect(page.locator('#easymde-preview')).toHaveAttribute('aria-busy', 'true');
        await expect.poll(() => typeof releasePreview).toBe('function');
        await capture({ component: 'preview', state: 'preview-loading', locator: page.locator('#easymde-preview'), readiness: 'loading' });
        await capture({ component: 'preview', state: 'loading', locator: page.locator('#easymde-preview'), readiness: 'loading' });
        releasePreview();
        await expect(page.locator('#easymde-preview')).toHaveAttribute('aria-busy', 'false');
        await page.unroute('**/wp-json/easymde/v1/preview*');

        await page.route('**/wp-json/easymde/v1/preview*', (route) => route.abort('failed'));
        await page.locator('#easymde-source').fill(`${siteMarkdown}\n\nPreview error state.`);
        await expect(page.locator('#easymde-preview')).toContainText('Preview failed');
        await capture({ component: 'preview', state: 'preview-error', locator: page.locator('#easymde-preview'), readiness: 'error' });
        await capture({ component: 'preview', state: 'error', locator: page.locator('#easymde-preview'), readiness: 'error' });
        await page.unroute('**/wp-json/easymde/v1/preview*');
        await page.locator('#easymde-source').fill(siteMarkdown);
        await expect(page.locator('#easymde-preview')).toHaveAttribute('aria-busy', 'false');

        const immersiveEntry = page.locator('.easymde-toolbar-immersive-toggle');
        await expect(immersiveEntry).toBeVisible();
        await capture({ component: 'immersive-entry', state: 'entry-default', locator: immersiveEntry });
        await immersiveEntry.hover();
        await capture({ component: 'immersive-entry', state: 'entry-hover', locator: immersiveEntry });
        await immersiveEntry.focus();
        await capture({ component: 'immersive-entry', state: 'entry-focus-visible', locator: immersiveEntry });
        await capture({ component: 'immersive-entry', state: 'entry-context', locator: page.locator('#easymde-toolbar') });
        await immersiveEntry.press('Enter');
        const workspace = page.locator('.easymde-immersive-workspace');
        await expect(workspace).toBeVisible();
        await capture({ component: 'immersive-workspace', state: 'entry-keyboard-activation', fullPage: true });
        await capture({ component: 'immersive-workspace', state: 'active-workspace', fullPage: true });
        await captureButtons(workspace.locator('.easymde-immersive-workspace__toolbar'), 'immersive-toolbar');

        await page.locator('[data-action="publish"]').click();
        const publishDialog = page.locator('.easymde-immersive-workspace__publish');
        await expect(publishDialog).toBeVisible();
        await capture({ component: 'publish', state: 'dialog', locator: publishDialog });
        await publishDialog.locator('[data-action="cancel-publish"]').last().click();

        await page.locator('[data-action="ai"]').click();
        const disabledButton = page.locator('[data-action="ai-settings"]');
        await expect(disabledButton).toBeDisabled();
        await capture({ component: 'ai-settings', state: 'disabled', locator: disabledButton });
        await page.locator('[data-action="close-ai"]').click();

        await page.locator('[data-action="statistics"]').click();
        const statusPanel = page.locator('[data-popover="statistics"]');
        await expect(statusPanel).toBeVisible();
        await capture({ component: 'statistics', state: 'status', locator: statusPanel });
        await page.keyboard.press('Escape');

        await page.locator('[data-action="exit"]').click();
        await expect(workspace).toHaveCount(0);
        await capture({ component: 'editor-page', state: 'normal-editor-after-exit', fullPage: true });

        const navigation = page.waitForNavigation({ waitUntil: 'load' });
        await page.locator('#save-post').click();
        await navigation;
        const notice = page.locator('#message, .notice-success').first();
        await expect(notice).toBeVisible();
        await capture({ component: 'wordpress-notice', state: 'notice', locator: notice });

        const manifest = validateEditorVisualManifest({ schemaVersion: 1, captures });
        const requiredStates = [
          ...matrix.fullPageStates,
          ...matrix.componentStates,
          ...matrix.immersiveReferenceStates,
        ];
        const capturedStates = new Set(captures.map((entry) => entry.state));

        for (const state of requiredStates) {
          expect(capturedStates.has(state), `Missing visual capture state: ${state}`).toBe(true);
        }

        expect(browser.version()).toBe(reference.runtime.browserVersion);
        writeFileSync(join(artifactRoot, 'editor-visual-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        await testInfo.attach('editor-visual-manifest', {
          path: join(artifactRoot, 'editor-visual-manifest.json'),
          contentType: 'application/json'
        });
        expect(basename(artifactRoot)).toBe('visual-evidence');
      }
    );
  });
});
