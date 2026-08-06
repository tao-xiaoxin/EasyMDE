import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { selectOrdinaryOption } from './helpers/ordinary-select.mjs';

const reportRoot = resolve(process.cwd(), 'test-results/theme-layout-audit');
const auditPhase = process.env.EASYMDE_THEME_AUDIT_PHASE || 'initial';
const postUrl = '/wp-admin/post.php?post=5&action=edit';
const screenshotViewport = { width: 1440, height: 960 };
const tolerance = 1.5;
const fullCapabilityMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const fullCapabilityImage = readFileSync(
  new URL('../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);
const expectedMermaidCount =
  fullCapabilityMarkdown.match(/^```mermaid$/gmu)?.length ?? 0;
if (expectedMermaidCount <= 0) {
  throw new Error('full-capability-mermaid-fixture-empty');
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or process environment.`);
  }
  return value;
}

function safeName(value) {
  return value.replaceAll(/[^a-z0-9-]+/giu, '-').replaceAll(/^-+|-+$/gu, '');
}

async function login(page) {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(requiredEnvironment('WORDPRESS_ADMIN_USER'));
  await page.locator('#user_pass').fill(requiredEnvironment('WORDPRESS_ADMIN_PASSWORD'));
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function waitForPreviewIdle(preview) {
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
}

async function waitForFullCapabilityPreview(preview) {
  await waitForPreviewIdle(preview);
  await expect(preview.locator('.easymde-mermaid svg')).toHaveCount(
    expectedMermaidCount
  );
  await expect(preview.locator('.easymde-mermaid svg').first()).toBeVisible();
}

async function chooseTheme(page, theme) {
  const labels = await page.evaluate(() => ({
    editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
    articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme
  }));
  const trigger = page.locator('.easymde-toolbar-section-secondary').getByRole('button', {
    name: labels.editorSettings,
    exact: true
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: labels.editorSettings });
  const select = dialog.getByRole('combobox', { name: labels.articleTheme, exact: true });
  await selectOrdinaryOption(page, select, theme.label);
  await expect(page.locator('.easymde-pane-preview article')).toHaveClass(
    new RegExp(`easymde-markdown-theme-${theme.id}`)
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

async function setMode(page, mode, labels) {
  const editor = page.locator('[data-easymde-editor-owner="react"]');
  if ('ordinary' === mode) {
    const immersive = page.getByRole('region', { name: labels.immersive, exact: true });
    if (await immersive.count()) {
      await page.getByRole('button', { name: labels.exit, exact: true }).click();
      await expect(immersive).toHaveCount(0);
    }
    return;
  }

  if (!await editor.evaluate((element) => element.classList.contains('is-immersive'))) {
    await page.getByRole('button', { name: labels.enter, exact: true }).click();
    await expect(editor).toHaveClass(/is-immersive/);
  }
  const buttonName = 'split' === mode ? labels.splitMode : labels.previewMode;
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await expect(editor).toHaveClass(new RegExp(`is-immersive-${'split' === mode ? 'split' : 'preview'}`));
}

async function scrollToMermaid(page, mode, index) {
  await page.locator('.easymde-pane-preview article').evaluate((root, args) => {
    const svg = root.querySelectorAll('.easymde-mermaid svg')[args.index];
    if (!(svg instanceof SVGElement)) throw new Error('audit-mermaid-svg-unavailable');
    const owner = root.closest('.easymde-immersive-preview-canvas');
    if (!(owner instanceof HTMLElement)) throw new Error('audit-scroll-owner-unavailable');
    const ownerBox = owner.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    owner.scrollTop += svgBox.top - ownerBox.top - 24;
  }, { mode, index });
}

function caseEvidence(root, { mode }) {
    const geometryTolerance = 1.5;
    const near = (first, second) => Math.abs(first - second) <= geometryTolerance;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const style = (element) => {
      const computed = getComputedStyle(element);
      return { overflowX: computed.overflowX, overflowY: computed.overflowY, display: computed.display };
    };
    const failure = (reason, selector, geometry = {}) => ({ reason, selector, geometry });
    const failures = [];
    const pane = root.closest('.easymde-pane-preview');
    const editor = root.closest('[data-easymde-editor-owner="react"]');
    const surface = root.closest('.easymde-immersive-preview-surface');
    const canvas = root.closest('.easymde-immersive-preview-canvas');
    const rootBox = box(root);
    const rootStyle = style(root);
    const pageWrappers = editor ? editor.querySelectorAll('.easymde-immersive-preview-page').length : -1;
    const canvases = editor ? editor.querySelectorAll('.easymde-immersive-preview-canvas').length : -1;
    const documentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const paneOverflow = pane instanceof HTMLElement ? pane.scrollWidth - pane.clientWidth : Number.NaN;
    const owner = canvas;

    if (!(pane instanceof HTMLElement)) failures.push(failure('preview-pane-unavailable', 'article'));
    if (!(owner instanceof HTMLElement)) failures.push(failure('expected-scroll-owner-unavailable', 'article'));
    if (documentOverflow > geometryTolerance) failures.push(failure('document-horizontal-overflow', 'html', { overflow: documentOverflow }));
    if (paneOverflow > geometryTolerance) failures.push(failure('pane-horizontal-overflow', '.easymde-pane-preview', { overflow: paneOverflow }));
    if (root.scrollWidth - root.clientWidth > geometryTolerance) failures.push(failure('article-horizontal-overflow', 'article', { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth }));
    if (1 !== canvases || 0 !== pageWrappers || !(canvas instanceof HTMLElement)) {
      failures.push(failure('preview-hierarchy-invalid', 'article', { mode, canvases, pageWrappers }));
    }
    if (rootStyle.overflowY !== 'visible') {
      failures.push(failure('article-must-not-scroll', 'article', { mode, overflowY: rootStyle.overflowY }));
    }
    if (canvas instanceof HTMLElement && !['auto', 'scroll'].includes(style(canvas).overflowY)) {
      failures.push(failure('canvas-must-scroll', '.easymde-immersive-preview-canvas', { mode, ...style(canvas) }));
    }
    if ('pure' === mode) {
      if (!near(Number.parseFloat(getComputedStyle(root).borderTopLeftRadius), 48)) failures.push(failure('pure-article-radius-invalid', 'article', { borderTopLeftRadius: getComputedStyle(root).borderTopLeftRadius }));
    }

    const verticalOwners = [];
    const verticalOwnerWalkStop =
      canvas instanceof HTMLElement ? canvas.parentElement : root.parentElement;
    for (
      let element = root;
      element instanceof HTMLElement && element !== verticalOwnerWalkStop;
      element = element.parentElement
    ) {
      const computed = getComputedStyle(element);
      if (element.scrollHeight > element.clientHeight + geometryTolerance && ['auto', 'scroll'].includes(computed.overflowY)) {
        verticalOwners.push({
          element,
          selector: element === root ? 'article' : element.className || element.tagName.toLowerCase(),
          box: box(element)
        });
      }
    }
    const ownerElement = owner instanceof HTMLElement ? owner : null;
    const unexpectedOwners = verticalOwners
      .filter(({ element }) => element !== ownerElement)
      .map(({ element: _element, ...evidence }) => evidence);
    const verticalOwnerEvidence = verticalOwners.map(
      ({ element: _element, ...evidence }) => evidence
    );
    if (unexpectedOwners.length) {
      failures.push(failure(
        'unexpected-nested-vertical-scroll-owner',
        'article',
        { unexpectedOwners, verticalOwners: verticalOwnerEvidence }
      ));
    }

    const keyElements = [
      ['heading', 'h1, h2, h3, h4, h5, h6'], ['paragraph', 'p'], ['blockquote', 'blockquote'],
      ['list-item', 'li'], ['task-item', '.task-list-item, .task-item, li:has(input[type="checkbox"])'], ['table-cell', 'th, td'],
      ['code-block', 'pre'], ['formula', '.katex, .easymde-math-block'], ['image', 'img'], ['details', 'details']
    ];
    for (const [kind, selector] of keyElements) {
      const element = root.querySelector(selector);
      if (!element) {
        failures.push(failure('fixture-element-missing', selector, { kind }));
        continue;
      }
      const rect = box(element);
      if (rect.width <= 0 || rect.height <= 0) failures.push(failure('non-positive-geometry', selector, { kind, ...rect }));
      if (rect.left < rootBox.left - geometryTolerance || rect.right > rootBox.right + geometryTolerance) {
        const localScroller = element.closest('pre, .table-container, .easymde-table-container, .easymde-mermaid');
        if (!localScroller || localScroller.scrollWidth <= localScroller.clientWidth + geometryTolerance) failures.push(failure('element-outside-article-horizontal-boundary', selector, { kind, element: rect, article: rootBox }));
      }
    }

    const mermaids = Array.from(root.querySelectorAll('.easymde-mermaid svg'));
    if (!mermaids.length) failures.push(failure('mermaid-svg-missing', '.easymde-mermaid svg'));
    const mermaid = mermaids.map((svg, index) => {
      const rect = box(svg);
      const viewBox = svg.getAttribute('viewBox') || '';
      const viewBoxParts = viewBox.trim().split(/[\s,]+/u).map(Number);
      const validViewBox = 4 === viewBoxParts.length && viewBoxParts.every(Number.isFinite) && viewBoxParts[2] > 0 && viewBoxParts[3] > 0;
      const labelProblems = Array.from(svg.querySelectorAll('foreignObject, .nodeLabel, .label, .messageText'))
        .map((label) => {
          const labelBox = box(label);
          const htmlChild = label.firstElementChild;
          return {
            selector: label.tagName.toLowerCase(),
            clipped: htmlChild instanceof HTMLElement && (htmlChild.scrollWidth > htmlChild.clientWidth + geometryTolerance || htmlChild.scrollHeight > htmlChild.clientHeight + geometryTolerance),
            outside: labelBox.left < rect.left - geometryTolerance || labelBox.right > rect.right + geometryTolerance || labelBox.top < rect.top - geometryTolerance || labelBox.bottom > rect.bottom + geometryTolerance,
            box: labelBox
          };
        });
      const contained = rect.left >= rootBox.left - geometryTolerance && rect.right <= rootBox.right + geometryTolerance;
      const positive = rect.width > 0 && rect.height > 0;
      if (!positive) failures.push(failure('mermaid-non-positive-geometry', `.easymde-mermaid svg:nth-of-type(${index + 1})`, rect));
      if (!validViewBox) failures.push(failure('mermaid-invalid-viewbox', `.easymde-mermaid svg:nth-of-type(${index + 1})`, { viewBox }));
      if (!contained) failures.push(failure('mermaid-horizontal-overflow', `.easymde-mermaid svg:nth-of-type(${index + 1})`, { svg: rect, article: rootBox }));
      if (labelProblems.some((problem) => problem.clipped || problem.outside)) failures.push(failure('mermaid-label-clipped', `.easymde-mermaid svg:nth-of-type(${index + 1})`, { labelProblems }));
      return { index, rect, viewBox, validViewBox, contained, positive, labelProblems };
    });

    if (ownerElement) {
      ownerElement.scrollTop = ownerElement.scrollHeight;
      const finalElement = root.lastElementChild;
      const finalBox = finalElement ? box(finalElement) : null;
      const ownerBox = box(ownerElement);
      if (!finalBox || finalBox.bottom > ownerBox.bottom + geometryTolerance || finalBox.top < ownerBox.top - ownerBox.height - geometryTolerance) {
        failures.push(failure('article-bottom-unreachable', 'article > :last-child', { finalBox, ownerBox, scrollTop: ownerElement.scrollTop, maxScrollTop: Math.max(0, ownerElement.scrollHeight - ownerElement.clientHeight) }));
      }
      ownerElement.scrollTop = 0;
    }

    return {
      mode, failures, root: { box: rootBox, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, style: rootStyle },
      canvas: canvas instanceof HTMLElement ? { box: box(canvas), scrollHeight: canvas.scrollHeight, clientHeight: canvas.clientHeight, style: style(canvas) } : null,
      surface: surface instanceof HTMLElement ? { box: box(surface), style: style(surface) } : null,
      wrappers: { canvases, pageWrappers }, documentOverflow, paneOverflow, verticalOwners: verticalOwnerEvidence, mermaid
    };
}

test('audits all registered article themes in ordinary, immersive split, and pure preview', async ({ page }) => {
  test.setTimeout(60 * 60_000);
  mkdirSync(reportRoot, { recursive: true });
  await page.setViewportSize(screenshotViewport);
  const browserErrors = [];
  page.on('console', (message) => {
    if ('error' === message.type()) browserErrors.push(`console:${message.text().slice(0, 300)}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`pageerror:${String(error.message).slice(0, 300)}`));

  await login(page);
  const postResponse = await page.goto(postUrl);
  if (!postResponse || !postResponse.ok()) {
    throw new Error(
      `theme-audit-post-unavailable:${postResponse?.status() ?? 'no-response'}`
    );
  }
  await expect(page.locator('[data-easymde-editor-owner="react"]')).toBeVisible();
  const preview = page.locator('.easymde-pane-preview article');
  await waitForPreviewIdle(preview);
  const fixtureImageUrl = new URL(
    '/easymde-e2e-fixtures/markdown-full-capability-image.png',
    page.url()
  ).href;
  await page.route(fixtureImageUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: fullCapabilityImage
  }));
  const localCapabilityMarkdown = fullCapabilityMarkdown.replace(
    /https:\/\/raw\.githubusercontent\.com\/tao-xiaoxin\/EasyMDE\/main\/docs\/assets\/easymde-logo-rounded\.png/g,
    fixtureImageUrl
  );
  await page.locator('.easymde-source-react .cm-content').fill(localCapabilityMarkdown);
  await expect(page.locator('#easymde-source')).toHaveValue(localCapabilityMarkdown);
  await waitForFullCapabilityPreview(preview);
  await expect.poll(() => preview.locator('img').evaluateAll(
    (images) => images.every(
      (image) => image instanceof HTMLImageElement
        && image.complete
        && image.naturalWidth > 0
        && image.naturalHeight > 0
    )
  ), {
    message: 'the local full-capability fixture images should load'
  }).toBe(true);
  const bootstrap = await page.evaluate(() => window.EasyMDEEditorRootBootstrap);
  const themes = bootstrap.appearance.articleThemes.map(({ id, label, cssUrl }) => ({ id, label, cssUrl }));
  expect(themes).toHaveLength(46);
  const labels = bootstrap.strings.immersive;
  const link = page.locator('#easymde-article-theme-css');
  const report = {
    phase: auditPhase,
    themes,
    cases: [],
    setupBrowserErrors: [...browserErrors],
    startedAt: new Date().toISOString()
  };

  try {
    for (const theme of themes) {
      for (const mode of ['ordinary', 'split', 'pure']) {
        const caseErrorStart = browserErrors.length;
        await setMode(page, mode, labels);
        if ('ordinary' === mode) {
          await chooseTheme(page, theme);
          await expect(link).toHaveAttribute('href', theme.cssUrl);
        }
        await waitForFullCapabilityPreview(preview);
        await expect(preview).toHaveClass(new RegExp(`easymde-markdown-theme-${theme.id}`));
        const evidence = await preview.evaluate(caseEvidence, { mode });
        const caseName = `${safeName(theme.id)}-${mode}`;
        const diagramIndex = mode === 'ordinary' ? 0 : 1;
        await scrollToMermaid(page, mode, diagramIndex);
        await page.screenshot({ path: resolve(reportRoot, `${auditPhase}-${caseName}.png`), fullPage: false });
        report.cases.push({
          theme: theme.id,
          mode,
          ...evidence,
          browserErrors: browserErrors.slice(caseErrorStart)
        });
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.caseCount = report.cases.length;
    report.failureCount =
      report.setupBrowserErrors.length
      + report.cases.reduce(
        (count, item) => count + item.failures.length + item.browserErrors.length,
        0
      );
    writeFileSync(resolve(reportRoot, `${auditPhase}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  }

  expect(report.cases).toHaveLength(themes.length * 3);
  const failures = report.cases.flatMap((item) => [
    ...item.failures.map((failure) => `${item.theme}/${item.mode}/${failure.reason}/${failure.selector}`),
    ...item.browserErrors.map((error) => `${item.theme}/${item.mode}/${error}`)
  ]);
  failures.unshift(...report.setupBrowserErrors.map((error) => `setup/${error}`));
  expect(failures, failures.join('\n')).toEqual([]);
});
