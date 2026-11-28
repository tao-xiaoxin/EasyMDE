import { expect } from '@playwright/test';
import { resolve } from 'node:path';
import { capturePreviewStructureDiagnostics } from "./page-diagnostics.mjs";
import { finitePreviewAnimationsProbeEnabled } from "./environment.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { multipartFileBytes } from "./native-payload-export.mjs";
import { waitForVisibleSelector } from "./page-diagnostics.mjs";

export async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await waitForVisibleSelector(page, '#easymde-editor', 'easymde-editor-unavailable');
}

export async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  try {
    await page.locator('.easymde-source-react .cm-content').fill(markdown);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(() => preview.evaluate((root) => (
      typeof root.easymdePreviewSignature === 'string'
        ? root.easymdePreviewSignature
        : ''
    ))).toMatch(new RegExp(`:${markdown.length}$`, 'u'));
    if (expectedText) await expect(preview).toContainText(expectedText);
    await waitForPreviewVisualReadiness(page);
  } catch (error) {
    if (!page.isClosed()) {
      await capturePreviewStructureDiagnostics(
        page,
        'preview-fill-failed'
      );
    }
    throw error;
  }
}

export async function waitForPreviewVisualReadiness(page) {
  await page.evaluate(async () => {
    try {
      if (document.fonts?.ready) await document.fonts.ready;
    } catch {
      throw new Error('wechat-preview-font-readiness-failed');
    }
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-sink-unavailable');
    }
    const images = Array.from(preview.querySelectorAll('img'));
    await Promise.all(images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve, reject) => {
          const onLoad = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            reject(new Error('wechat-preview-image-load-failed'));
          };
          image.addEventListener('load', onLoad, { once: true });
          image.addEventListener('error', onError, { once: true });
        });
      }
      if (typeof image.decode === 'function') {
        try {
          await image.decode();
        } catch {
          throw new Error('wechat-preview-image-decode-failed');
        }
      }
    }));
    globalThis.__easymdeWechatReadiness = {
      fontsReady: true,
      imageCount: images.length,
      imagesComplete: images.every((image) => image.complete),
      imagesDecoded: true
    };
  });
}

export function previewResponseForMarkdown(page, markdown) {
  return page.waitForResponse((response) => {
    const request = response.request();
    if (
      request.method() !== 'POST'
      || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
    ) return false;
    try {
      return request.postDataJSON()?.markdown === markdown;
    } catch {
      return false;
    }
  });
}

export async function assertAcceptedMathPreview(page, response) {
  expect(response.status()).toBe(200);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  if (typeof payload.html !== 'string') {
    throw new Error('wechat-preview-response-html-unavailable');
  }
  const responseRoots = await page.evaluate((html) => {
    const preview = new DOMParser().parseFromString(html, 'text/html');
    return {
      block: preview.querySelectorAll('.easymde-math-block').length,
      inline: preview.querySelectorAll('.easymde-math-inline').length,
      total: preview.querySelectorAll('.easymde-math').length
    };
  }, payload.html);
  expect(responseRoots).toEqual({ block: 1, inline: 2, total: 3 });
}

export async function assertReadonlyMathProjection(
  surface,
  { editable, nonwindowed, ordinaryParagraphText }
) {
  if (editable) {
    await expect(surface).toHaveAttribute('contenteditable', 'true');
    await expect(surface.locator('.katex')).toHaveCount(3);
    await expect(surface.locator('.katex-error')).toHaveCount(0);
    // Single-line display math embedded inside a paragraph (`Display math: \[...\].`)
    // remains a protected inline atom in ProseMirror so the surrounding prose stays
    // editable on one line without write-back drift; formal Preview keeps 2 inline + 1 block.
    const protectedMath = surface.locator(
      '[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"], [data-easymde-protected-block][data-easymde-protected-kind="math"]'
    );
    await expect(protectedMath).toHaveCount(3);
    for (const root of await protectedMath.all()) {
      await expect(root).toHaveAttribute('contenteditable', 'false');
    }
    const ordinaryParagraph = surface.locator('p').filter({
      hasText: ordinaryParagraphText
    });
    await expect(ordinaryParagraph).toHaveCount(1);
    await expect(ordinaryParagraph).not.toHaveAttribute('contenteditable', 'false');
  } else {
    await expect(surface).toHaveAttribute('aria-busy', 'false');
    await expect(surface).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect(surface).not.toHaveAttribute('contenteditable', 'true');
    await expect(surface.locator('.easymde-math')).toHaveCount(3);
    await expect(surface.locator('.easymde-math-inline')).toHaveCount(2);
    await expect(surface.locator('.easymde-math-block')).toHaveCount(1);
    await expect(surface.locator('.katex')).toHaveCount(3);
    const ordinaryParagraph = surface.locator('p').filter({
      hasText: ordinaryParagraphText
    });
    await expect(ordinaryParagraph).toHaveCount(1);
  }
  if (nonwindowed) {
    await expect(surface.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  }
}

export async function setWechatMatrixStage(page, stage) {
  await page.evaluate((nextStage) => {
    const source = document.querySelector('#easymde-source');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const signature = preview?.easymdePreviewSignature;
    globalThis.__easymdeWechatMatrixStage = {
      ...nextStage,
      previewThemeClasses: preview
        ? [...preview.classList]
          .filter((className) => /easymde-(?:markdown|code)-theme-[a-z0-9_-]+$/iu.test(className))
          .sort()
        : [],
      previewAccepted: preview?.getAttribute('data-easymde-preview-accepted') ?? null,
      previewBusy: preview?.getAttribute('aria-busy') ?? null,
      previewError: preview?.getAttribute('data-easymde-preview-error') ?? null,
      previewRefreshing: preview?.getAttribute('data-easymde-preview-refreshing') ?? null,
      previewSignatureTail: typeof signature === 'string'
        ? signature.match(/:\d+$/u)?.[0] ?? null
        : null,
      sourceLength: source instanceof HTMLTextAreaElement ? source.value.length : null
    };
  }, stage);
}

export async function settlePreviewFiniteTransitions(page) {
  await page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof Element)) throw new Error('wechat-preview-transition-root-unavailable');
    const previewNodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const transitions = document.getAnimations()
      .filter((animation) => {
        const effect = animation.effect;
        const target = effect && 'target' in effect ? effect.target : null;
        const timing = effect && typeof effect.getComputedTiming === 'function'
          ? effect.getComputedTiming()
          : null;
        const currentTime = Number(animation.currentTime);
        const endTime = Number(timing?.endTime);
        return target instanceof Element
          && previewNodes.has(target)
          && animation.constructor?.name === 'CSSTransition'
          && Number.isFinite(currentTime)
          && Number.isFinite(endTime)
          && endTime > currentTime;
      });
    return Promise.all(transitions.map((animation) => animation.finished));
  });
}

export async function settleFinitePreviewAnimations(page, selector) {
  return page.evaluate(async (rootSelector) => {
    const preview = document.querySelector(rootSelector);
    if (!(preview instanceof Element)) {
      throw new Error('wechat-preview-finite-animation-root-unavailable');
    }
    const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const finiteAnimations = () => document.getAnimations().filter((animation) => {
      const effect = animation.effect;
      const target = effect && 'target' in effect ? effect.target : null;
      const owner = target instanceof Element
        ? target
        : target?.parentElement ?? target?.element ?? null;
      const timing = effect && typeof effect.getComputedTiming === 'function'
        ? effect.getComputedTiming()
        : null;
      const currentTime = Number(animation.currentTime);
      const endTime = Number(timing?.endTime);
      return owner instanceof Element
        && nodes.has(owner)
        && Number.isFinite(currentTime)
        && Number.isFinite(endTime)
        && endTime > currentTime
        && ['CSSAnimation', 'CSSTransition'].includes(animation.constructor?.name ?? '');
    });
    const animations = finiteAnimations();
    await Promise.all(animations.map((animation) => animation.finished));
    return finiteAnimations().length;
  }, selector);
}

export async function readPreviewFiniteAnimationEvidence(page) {
  return page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-animation-evidence-root-unavailable');
    }
    const nodeIds = new WeakMap();
    let nextNodeId = 1;
    const nodeId = (element) => {
      if (!element) return null;
      let id = nodeIds.get(element);
      if (!id) {
        id = nextNodeId;
        nextNodeId += 1;
        nodeIds.set(element, id);
      }
      return id;
    };
    const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const finiteNumber = (value) => Number.isFinite(value) ? value : null;
    const items = document.getAnimations()
      .map((animation) => {
        const effect = animation.effect;
        const target = effect && 'target' in effect ? effect.target : null;
        const owner = target instanceof Element
          ? target
          : target?.parentElement ?? target?.element ?? null;
        const timing = effect && typeof effect.getComputedTiming === 'function'
          ? effect.getComputedTiming()
          : null;
        const rawTiming = effect && typeof effect.getTiming === 'function'
          ? effect.getTiming()
          : null;
        const currentTime = Number(animation.currentTime);
        const endTime = Number(timing?.endTime);
        const duration = Number(rawTiming?.duration);
        const iterations = Number(rawTiming?.iterations);
        const type = animation.constructor?.name ?? 'unknown';
        return {
          animation,
          currentTime,
          duration,
          endTime,
          finite: Number.isFinite(currentTime)
            && Number.isFinite(endTime)
            && Number.isFinite(duration)
            && Number.isFinite(iterations)
            && endTime > currentTime,
          iterations,
          owner,
          pseudoOwner: Boolean(target && !(target instanceof Element)),
          target,
          type
        };
      })
      .filter(({ owner, finite, type }) => (
        owner instanceof Element
        && nodes.has(owner)
        && finite
        && ['CSSAnimation', 'CSSTransition'].includes(type)
      ));
    return {
      count: items.length,
      items: items.map(({ animation, currentTime, duration, endTime, iterations, owner, pseudoOwner, type }) => ({
        currentTimeMs: finiteNumber(currentTime),
        endTimeMs: finiteNumber(endTime),
        nodeId: nodeId(owner),
        playState: animation.playState,
        pseudoOwner,
        type
      }))
    };
  });
}

export async function settlePreviewFiniteAnimations(page) {
  if (!finitePreviewAnimationsProbeEnabled) return null;
  return page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-animation-settle-root-unavailable');
    }
    const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const animations = document.getAnimations().filter((animation) => {
      const effect = animation.effect;
      const target = effect && 'target' in effect ? effect.target : null;
      const owner = target instanceof Element
        ? target
        : target?.parentElement ?? target?.element ?? null;
      const timing = effect && typeof effect.getComputedTiming === 'function'
        ? effect.getComputedTiming()
        : null;
      const rawTiming = effect && typeof effect.getTiming === 'function'
        ? effect.getTiming()
        : null;
      const currentTime = Number(animation.currentTime);
      const endTime = Number(timing?.endTime);
      const duration = Number(rawTiming?.duration);
      const iterations = Number(rawTiming?.iterations);
      return owner instanceof Element
        && nodes.has(owner)
        && animation.constructor?.name === 'CSSAnimation'
        && Number.isFinite(currentTime)
        && Number.isFinite(endTime)
        && Number.isFinite(duration)
        && Number.isFinite(iterations)
        && endTime > currentTime;
    });
    return Promise.all(animations.map((animation) => animation.finished));
  });
}

export async function readRect(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: rect.width
    };
  });
}

export function expectRectStable(before, after, label) {
  for (const key of ['height', 'left', 'top', 'width']) {
    expect(
      Math.abs(before[key] - after[key]),
      `${label} ${key} changed`
    ).toBeLessThanOrEqual(0.5);
  }
}

export function assertFiniteProjectionNumber(value, label) {
  expect(Number.isFinite(value), `${label} must be finite`).toBe(true);
}

export async function installEditorBootstrapOverride(page, pngConversionEnabled) {
  await page.addInitScript(({ enabled }) => {
    let loaderBootstrap;
    Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
      configurable: true,
      get: () => loaderBootstrap,
      set: (value) => {
        const editorBootstrap = value
          && 'object' === typeof value
          && value.editorBootstrap
          && 'object' === typeof value.editorBootstrap
          ? value.editorBootstrap
          : null;
        if (!editorBootstrap) {
          loaderBootstrap = value;
          return;
        }
        const forceSource = '1' === window.sessionStorage.getItem(
          'easymde-e2e-source-presentation'
        );
        loaderBootstrap = {
          ...value,
          editorBootstrap: {
            ...editorBootstrap,
            settings: {
              ...editorBootstrap.settings,
              general: {
                ...editorBootstrap.settings?.general,
                ...(forceSource ? { editingMode: 'source' } : {})
              }
            },
            wechatExport: {
              ...editorBootstrap.wechatExport,
              pngConversionEnabled: enabled
            }
          }
        };
      }
    });
  }, { enabled: pngConversionEnabled });
}

export async function installControlledPngUploadRoute(page) {
  const bootstrap = await page.evaluate(() => ({
    endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
    owner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
  }));
  if (!bootstrap.endpoint || !['image-hosting', 'media'].includes(bootstrap.owner)) {
    throw new Error('wechat-source-png-upload-bootstrap-unavailable');
  }
  const uploadPath = new URL(bootstrap.endpoint, page.url()).pathname;
  const uploads = [];
  const pngs = [];
  const matcher = (url) => new URL(url).pathname === uploadPath;
  await page.route(matcher, async (route) => {
    const request = route.request();
    const index = uploads.push(request.method()) - 1;
    pngs.push(multipartFileBytes(request).toString('base64'));
    const url = `https://images.example.test/e2e/source-png-${index}.png`;
    const response = bootstrap.owner === 'image-hosting'
      ? { alt: '', backup: { status: 'disabled' }, title: '', url }
      : { alt: '', filename: `source-png-${index}.png`, id: 12_000 + index, title: '', url };
    await route.fulfill({
      body: JSON.stringify(response),
      contentType: 'application/json',
      status: 200
    });
  });
  return { matcher, pngs, uploads };
}

export async function assertSourcePresentation(page, preview, expectedPresentation = 'split') {
  const editor = page.locator('[data-easymde-editor-owner="react"]');
  await expect(editor).toHaveAttribute(
    'data-easymde-preview-presentation',
    expectedPresentation
  );
  await expect(preview).toHaveClass(
    new RegExp(`easymde-preview-presentation-${expectedPresentation}`)
  );
  await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-refreshing', '1');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
}

export async function assertFullCapabilityPreview(preview) {
  const expectedMermaidCount = fullCapabilityMarkdown.match(/^```mermaid$/gmu)?.length ?? 0;
  await expect(preview.locator('table')).toHaveCount(4);
  await expect(preview.locator('pre code')).toHaveCount(8);
  await expect(preview.locator('.katex')).toHaveCount(14);
  await expect(preview.locator('.easymde-mermaid')).toHaveCount(expectedMermaidCount);
  await expect(preview.locator('img').first()).toBeAttached();
  await expect.poll(() => preview.evaluate((root) => ({
    accepted: root.getAttribute('data-easymde-preview-accepted'),
    busy: root.getAttribute('aria-busy'),
    horizontalOverflow: root.scrollWidth - root.clientWidth
  }))).toEqual({ accepted: '1', busy: 'false', horizontalOverflow: 0 });
}

export async function readAppearanceCatalog(page) {
  return page.evaluate(() => {
    const bootstrap = window.EasyMDEEditorRootBootstrap;
    const appearance = bootstrap.appearance;
    return {
      articleThemes: appearance.articleThemes.map(({ cssUrl, defaultCodeTheme, id, label }) => ({
        cssUrl,
        defaultCodeTheme,
        id,
        label
      })),
      codeThemes: appearance.codeThemes.map(({ cssUrl, id, label }) => ({
        cssUrl,
        id,
        label
      })),
      immersive: bootstrap.strings.immersive,
      labels: {
        articleTheme: appearance.strings.articleTheme,
        codeTheme: appearance.strings.codeTheme,
        editorSettings: bootstrap.strings.immersive.editorSettings
      },
      state: {
        codeTheme: document.querySelector('#easymde-code-theme-field')?.value ?? '',
        codeThemeExplicit: document.querySelector('#easymde-code-theme-explicit-field')?.value ?? '',
        markdownTheme: document.querySelector('#easymde-markdown-theme-field')?.value ?? ''
      }
    };
  });
}

export async function openOrdinaryAppearanceDialog(page, editorSettingsLabel) {
  await page.locator('.easymde-toolbar-section-secondary')
    .getByRole('button', { name: editorSettingsLabel, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: editorSettingsLabel, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function selectOrdinaryAppearanceTheme(page, dialog, label, themeLabel) {
  const select = dialog.getByRole('combobox', { name: label, exact: true });
  await select.click();
  const listbox = page.getByRole('listbox', { name: label, exact: true });
  await listbox.getByRole('option', { name: themeLabel, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

export async function openImmersiveAppearanceDialog(page, labels) {
  await page.getByRole('button', { name: labels.theme, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: labels.themeSettings, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function selectImmersiveAppearanceTheme(page, dialog, label, themeLabel) {
  await dialog.getByRole('button', { name: label, exact: true }).click();
  const listbox = page.getByRole('listbox', { name: label, exact: true });
  await listbox.getByRole('option', { name: themeLabel, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

export async function waitForArticleThemeStylesheet(page, theme) {
  await expect.poll(() => page.locator('#easymde-article-theme-css').evaluate(
    (link, expectedUrl) => (
      link instanceof HTMLLinkElement
      && link.href === expectedUrl
      && Boolean(link.sheet?.href)
    ),
    theme.cssUrl
  ), { message: `${theme.id} article stylesheet should finish loading` }).toBe(true);
  await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue(theme.id);
  await expect.poll(() => page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root, id) => (
    root.classList.contains(`easymde-markdown-theme-${id}`)
    && root.getAttribute('data-easymde-preview-accepted') === '1'
    && root.getAttribute('aria-busy') === 'false'
    && root.getAttribute('data-easymde-preview-refreshing') !== '1'
    && root.getAttribute('data-easymde-preview-error') !== '1'
  ), theme.id), {
    message: `${theme.id} article identity should be committed to the Preview root`
  }).toBe(true);
  await waitForPreviewVisualReadiness(page);
}

export async function waitForCodeThemeStylesheet(page, theme) {
  await expect.poll(() => page.locator('#easymde-highlight-theme-css').evaluate(
    (link, expectedUrl) => (
      link instanceof HTMLLinkElement
      && link.href === expectedUrl
      && Boolean(link.sheet?.href)
    ),
    theme.cssUrl
  ), { message: `${theme.id} code stylesheet should finish loading` }).toBe(true);
  await expect(page.locator('#easymde-code-theme-field')).toHaveValue(theme.id);
  await expect.poll(() => page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root, id) => (
    root.classList.contains(`easymde-code-theme-${id}`)
    && root.getAttribute('data-easymde-preview-accepted') === '1'
    && root.getAttribute('aria-busy') === 'false'
    && root.getAttribute('data-easymde-preview-refreshing') !== '1'
    && root.getAttribute('data-easymde-preview-error') !== '1'
  ), theme.id), {
    message: `${theme.id} code identity should be committed to the Preview root`
  }).toBe(true);
  await waitForPreviewVisualReadiness(page);
}

export async function waitForImmediateCopyThemeCommit(page, themeId) {
  await page.waitForFunction((expectedThemeId) => {
    const field = document.querySelector('#easymde-markdown-theme-field');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const copy = document.querySelector('.easymde-toolbar-copy-action');
    const ready = field instanceof HTMLInputElement
      && field.value === expectedThemeId
      && preview instanceof HTMLElement
      && preview.classList.contains(`easymde-markdown-theme-${expectedThemeId}`)
      && preview.getAttribute('data-easymde-preview-accepted') === '1'
      && preview.getAttribute('aria-busy') === 'false'
      && preview.getAttribute('data-easymde-preview-refreshing') !== '1'
      && preview.getAttribute('data-easymde-preview-error') !== '1'
      && copy instanceof HTMLButtonElement
      && copy.disabled === false
      && copy.getAttribute('aria-disabled') !== 'true'
      && copy.getAttribute('aria-busy') !== 'true';
    if (ready) globalThis.__easymdeImmediateCopySourceProbe?.markThemeCommit?.();
    return ready;
  }, themeId, { polling: 50, timeout: 5_000 });
}

export async function holdStylesheetRequest(page, expectedUrl) {
  const expected = new URL(expectedUrl);
  let release;
  let markSeen;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = new Promise((resolve) => { markSeen = resolve; });
  const observedRequests = [];
  const matcher = (url) => {
    try {
      const candidate = new URL(url);
      return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
    } catch {
      return false;
    }
  };
  const handler = async (route) => {
    const requestUrl = new URL(route.request().url());
    observedRequests.push({
      method: route.request().method(),
      pathname: requestUrl.pathname,
      queryKeys: [...requestUrl.searchParams.keys()].sort()
    });
    markSeen();
    await gate;
    await route.continue();
  };
  await page.route(matcher, handler);
  return {
    diagnostics: () => ({
      expectedPathname: expected.pathname,
      expectedQueryKeys: [...expected.searchParams.keys()].sort(),
      observedRequests: observedRequests.slice()
    }),
    dispose: () => page.unroute(matcher, handler),
    release: () => release(),
    waitForRequest: async (timeoutMs = 8_000) => {
      let timer;
      try {
        return await Promise.race([
          seen,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('wechat-theme-stylesheet-request-timeout')),
              timeoutMs
            );
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}

export async function readStylesheetOwnerState(page, selector, expectedUrl) {
  return page.locator(selector).evaluate((element, url) => {
    if (!(element instanceof HTMLLinkElement)) {
      throw new Error('wechat-theme-stylesheet-link-unavailable');
    }
    const href = new URL(element.href);
    const expected = new URL(url);
    return {
      hrefMatches: element.href === expected.href,
      hrefPathname: href.pathname,
      hrefQueryKeys: [...href.searchParams.keys()].sort(),
      id: element.id,
      media: element.media,
      owner: element.dataset.easymdeStylesheetOwner ?? null,
      sheetReady: Boolean(element.sheet?.href)
    };
  }, expectedUrl);
}
