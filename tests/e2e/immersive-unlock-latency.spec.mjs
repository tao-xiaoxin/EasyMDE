import { expect, test } from '@playwright/test';

const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
const previewSinkSelector = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
const documentWritePath = /\/wp-admin\/post\.php$|\/wp-json\/wp\/v2\/(?:posts|pages)(?:\/\d+)?(?:\/autosaves?\/?$)?$/u;

test.use({ viewport: { width: 1440, height: 1000 } });

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in the root .env or process environment.`);
  return value;
}

function createPostRequestMonitor(page) {
  let enabled = false;
  let requests = [];

  page.on('request', (request) => {
    if (!enabled || 'POST' !== request.method()) return;
    const url = new URL(request.url());
    const isPreview = /\/wp-json\/easymde\/v1\/preview\/?$/u.test(url.pathname);
    const body = request.postData() ?? '';
    const isHeartbeat = url.searchParams.get('action') === 'heartbeat'
      || /(?:^|&)action=heartbeat(?:&|$)/u.test(body);
    requests.push({
      isDocumentWrite: documentWritePath.test(url.pathname)
        || (url.pathname.endsWith('/wp-admin/admin-ajax.php') && !isHeartbeat),
      isPreview
    });
  });

  return {
    start() {
      requests = [];
      enabled = true;
    },
    stop() {
      enabled = false;
      return {
        documentWrites: requests.filter(({ isDocumentWrite }) => isDocumentWrite).length,
        previewPosts: requests.filter(({ isPreview }) => isPreview).length
      };
    }
  };
}

async function login(page) {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(adminUser);
  await page.locator('#user_pass').fill(adminPassword);
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function openNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

async function fillMarkdownAndWaitForPreview(page, markdown, paragraphCount) {
  await page.locator('.easymde-source-react .cm-content').fill(markdown);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown, {
    timeout: 60_000
  });
  const preview = page.locator(previewSinkSelector);
  await expect(preview).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect(preview.locator('p')).toHaveCount(paragraphCount, {
    timeout: 60_000
  });
  return preview;
}

async function enterImmersivePreview(page) {
  const labels = await page.evaluate(() => {
    const strings = window.EasyMDEEditorRootBootstrap?.strings?.immersive;
    if (!strings) throw new Error('immersive-strings-unavailable');
    return {
      enter: strings.enter,
      preview: strings.preview,
      previewContentLoaded: strings.previewContentLoaded,
      previewEditorLabel: strings.previewEditorLabel,
      previewLockReadOnly: strings.previewLockReadOnly,
      previewUnlockEdit: strings.previewUnlockEdit,
      splitMode: strings.splitMode
    };
  });
  await page.getByRole('button', { name: labels.enter }).click();
  await page.getByRole('button', { name: labels.preview, exact: true }).click();
  await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
  await expect(page.getByRole('button', { name: labels.previewUnlockEdit })).toBeEnabled();
  return labels;
}

async function beginUnlockTiming(page, button, editorLabel) {
  await button.evaluate((target, accessibleLabel) => {
    const state = {
      clickAt: null,
      pendingAt: null,
      pendingFrameAt: null,
      editableAt: null,
      trustedClickCount: 0,
      frameId: null,
      pendingFrameId: null,
      pendingObserver: null,
      editableObserver: null,
      longTaskObserver: null,
      longTaskObserverSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
      longTasks: [],
      clickListener: null,
      focusListener: null
    };
    state.clickListener = (event) => {
      if (!(event.target instanceof Element)
        || event.target.closest('.easymde-immersive-preview-lock') !== target) return;
      state.trustedClickCount += event.isTrusted ? 1 : 0;
      if (state.clickAt === null) state.clickAt = performance.now();
    };
    const findEditableSurface = () => [...document.querySelectorAll('[role="textbox"]')]
      .find((element) => element.getAttribute('aria-label') === accessibleLabel);
    const captureEditableFocus = () => {
      if (state.clickAt === null) return false;
      const editor = findEditableSurface();
      if (!(editor instanceof HTMLElement)
        || !editor.isContentEditable
        || document.activeElement !== editor) return false;
      state.editableAt ??= performance.now();
      return true;
    };
    const observeEditableFocus = () => {
      if (captureEditableFocus()) return;
      const editor = findEditableSurface();
      if (!(editor instanceof HTMLElement)
        || !editor.isContentEditable
        || state.frameId !== null) return;
      state.frameId = requestAnimationFrame(() => {
        state.frameId = null;
        captureEditableFocus();
      });
    };
    const observePendingFrame = () => {
      if (state.pendingFrameAt !== null || state.pendingFrameId !== null) return;
      state.pendingFrameId = requestAnimationFrame((frameAt) => {
        state.pendingFrameId = null;
        const spinner = target.querySelector('.easymde-immersive-preview-unlock-spinner');
        const bounds = spinner?.getBoundingClientRect();
        const style = spinner ? getComputedStyle(spinner) : null;
        if (target.isConnected
          && target.getAttribute('aria-busy') === 'true'
          && target.disabled
          && bounds?.width > 0
          && bounds.height > 0
          && style?.visibility !== 'hidden'
          && style?.display !== 'none') {
          state.pendingFrameAt = frameAt;
        }
      });
    };
    state.focusListener = observeEditableFocus;
    document.addEventListener('click', state.clickListener, true);
    document.addEventListener('focusin', state.focusListener, true);
    state.pendingObserver = new MutationObserver((records) => {
      if (state.clickAt === null) return;
      for (const record of records) {
        if (record.attributeName === 'aria-busy' && record.oldValue !== 'true') {
          state.pendingAt ??= performance.now();
          observePendingFrame();
        }
      }
    });
    state.pendingObserver.observe(target, {
      attributeFilter: ['aria-busy'],
      attributeOldValue: true,
      attributes: true
    });
    state.editableObserver = new MutationObserver(observeEditableFocus);
    state.editableObserver.observe(document.body, {
      attributeFilter: ['contenteditable'],
      attributes: true,
      childList: true,
      subtree: true
    });
    if (state.longTaskObserverSupported) {
      state.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({ duration: entry.duration, startTime: entry.startTime });
        }
      });
      state.longTaskObserver.observe({ type: 'longtask' });
    }
    window.__easymdeUnlockTiming = state;
  }, editorLabel);
}

async function finishUnlockTiming(page, labels) {
  const editor = page.getByRole('textbox', { name: labels.previewEditorLabel });
  await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 60_000 });
  await expect(editor).toBeFocused({ timeout: 60_000 });
  const result = await page.evaluate(() => {
    const state = window.__easymdeUnlockTiming;
    if (state.clickAt === null || state.pendingAt === null || state.editableAt === null) {
      throw new Error('immersive-unlock-timing-mark-missing');
    }
    if (state.longTaskObserver) {
      for (const entry of state.longTaskObserver.takeRecords()) {
        state.longTasks.push({ duration: entry.duration, startTime: entry.startTime });
      }
    }
    const overlappingLongTasks = state.longTasks.filter((entry) =>
      entry.startTime < state.editableAt
      && entry.startTime + entry.duration > state.clickAt
    );
    const firstPendingFrameMs = state.pendingFrameAt === null
      ? null
      : state.pendingFrameAt - state.clickAt;
    const longTaskDurations = overlappingLongTasks.map(({ duration }) => duration);
    const result = {
      clickToEditableMs: state.editableAt - state.clickAt,
      clickToPendingFrameMs: firstPendingFrameMs,
      clickToPendingMutationMs: state.pendingAt - state.clickAt,
      longTaskCount: overlappingLongTasks.length,
      longTaskObserverSupported: state.longTaskObserverSupported,
      longTaskMaxMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
      longTasksAtLeast50ms: longTaskDurations.filter((duration) => duration >= 50).length,
      trustedClickCount: state.trustedClickCount
    };
    state.pendingObserver.disconnect();
    state.editableObserver.disconnect();
    state.longTaskObserver?.disconnect();
    document.removeEventListener('click', state.clickListener, true);
    document.removeEventListener('focusin', state.focusListener, true);
    if (state.frameId !== null) cancelAnimationFrame(state.frameId);
    if (state.pendingFrameId !== null) cancelAnimationFrame(state.pendingFrameId);
    return result;
  });
  return result;
}

async function waitForPendingFrame(page) {
  await page.waitForFunction(() =>
    window.__easymdeUnlockTiming?.pendingFrameAt !== null,
    null,
    { timeout: 5_000 }
  );
  return page.evaluate(() => {
    const state = window.__easymdeUnlockTiming;
    return state.pendingFrameAt - state.clickAt;
  });
}

async function stopUnlockTiming(page) {
  await page.evaluate(() => {
    const state = window.__easymdeUnlockTiming;
    if (!state) return;
    state.pendingObserver.disconnect();
    state.editableObserver.disconnect();
    state.longTaskObserver?.disconnect();
    document.removeEventListener('click', state.clickListener, true);
    document.removeEventListener('focusin', state.focusListener, true);
    if (state.frameId !== null) cancelAnimationFrame(state.frameId);
    if (state.pendingFrameId !== null) cancelAnimationFrame(state.pendingFrameId);
  });
}

async function activateUnlock(page, labels, requestMonitor, { doubleClick = false } = {}) {
  const button = page.getByRole('button', { name: labels.previewUnlockEdit });
  await expect(button).toBeEnabled();
  const scrollAnchorBefore = await readPreviewScrollAnchor(page);
  await beginUnlockTiming(page, button, labels.previewEditorLabel);
  requestMonitor.start();
  if (doubleClick) {
    const bounds = await button.boundingBox();
    if (!bounds) throw new Error('immersive-unlock-control-unavailable');
    await page.mouse.dblclick(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
  } else {
    await button.click();
  }
  const timing = await finishUnlockTiming(page, labels);
  const scrollAnchorAfter = await readPreviewScrollAnchor(page);
  const requests = requestMonitor.stop();
  return {
    ...timing,
    scrollAnchorDelta: previewAnchorDelta(scrollAnchorBefore, scrollAnchorAfter),
    ...requests
  };
}

async function lockPreview(page, labels) {
  await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
  await expect(page.getByRole('textbox', {
    name: labels.previewEditorLabel
  })).toHaveCount(0);
  const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
  await expect(unlock).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(previewSinkSelector)).toHaveAttribute('aria-busy', 'false', {
    timeout: 60_000
  });
}

function expectNoDocumentWrites(samples) {
  expect(samples.reduce((count, sample) => count + sample.previewPosts, 0)).toBe(0);
  expect(samples.reduce((count, sample) => count + sample.documentWrites, 0)).toBe(0);
}

async function attachTiming(testInfo, name, value) {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json'
  });
}

async function readPreviewScrollAnchor(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.easymde-immersive-preview-canvas');
    const firstParagraph = canvas?.querySelector('p');
    if (!(canvas instanceof HTMLElement) || !(firstParagraph instanceof HTMLElement)) {
      throw new Error('immersive-preview-scroll-anchor-unavailable');
    }
    const canvasBounds = canvas.getBoundingClientRect();
    const paragraphBounds = firstParagraph.getBoundingClientRect();
    return {
      firstParagraphTop: paragraphBounds.top - canvasBounds.top,
      scrollTop: canvas.scrollTop
    };
  });
}

function previewAnchorDelta(before, after) {
  return {
    firstParagraphTop: after.firstParagraphTop - before.firstParagraphTop,
    scrollTop: after.scrollTop - before.scrollTop
  };
}

test('cold short unlock reports pending before editable and ignores a physical double click', async ({ page }, testInfo) => {
  await login(page);
  await openNewPost(page);
  const markdown = Array.from(
    { length: 8 },
    (_, index) => `Synthetic short unlock paragraph ${index + 1}.`
  ).join('\n\n');
  await fillMarkdownAndWaitForPreview(page, markdown, 8);
  const labels = await enterImmersivePreview(page);
  expect(labels.previewUnlockEdit).toBe('解除锁定并编辑');

  const requestMonitor = createPostRequestMonitor(page);
  const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
  const scrollAnchorBefore = await readPreviewScrollAnchor(page);
  await beginUnlockTiming(page, unlock, labels.previewEditorLabel);
  requestMonitor.start();
  const bounds = await unlock.boundingBox();
  if (!bounds) throw new Error('immersive-unlock-control-unavailable');
  await page.mouse.dblclick(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await expect(unlock).toHaveAttribute('aria-busy', 'true');
  await expect(unlock).toBeDisabled();
  await expect(unlock).toHaveClass(/is-unlocking/u);
  await expect(unlock.locator('.easymde-immersive-preview-unlock-spinner')).toBeVisible();
  await expect(unlock).toHaveAccessibleName(labels.previewUnlockEdit);
  const accessibleBusyButton = page.getByRole('button', {
    name: labels.previewUnlockEdit,
    disabled: true
  });
  await expect(accessibleBusyButton).toHaveCount(1);
  await expect(accessibleBusyButton).toHaveAttribute('aria-busy', 'true');

  const timing = await finishUnlockTiming(page, labels);
  const scrollAnchorAfter = await readPreviewScrollAnchor(page);
  const requests = requestMonitor.stop();
  const sample = {
    ...timing,
    scrollAnchorDelta: previewAnchorDelta(scrollAnchorBefore, scrollAnchorAfter),
    ...requests
  };
  await attachTiming(testInfo, 'cold-short-unlock.json', sample);

  expect(sample.clickToPendingMutationMs).toBeLessThanOrEqual(100);
  expect(sample.clickToPendingFrameMs).not.toBeNull();
  expect(sample.clickToPendingFrameMs).toBeLessThanOrEqual(100);
  expect(sample.trustedClickCount).toBe(1);
  expect(Math.abs(sample.scrollAnchorDelta.scrollTop)).toBeLessThanOrEqual(1);
  expectNoDocumentWrites([sample]);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
});

test('warm short unlock 5-sample maximum stays within budget and does not write the document', async ({ page }, testInfo) => {
  await login(page);
  await openNewPost(page);
  const markdown = Array.from(
    { length: 8 },
    (_, index) => `Synthetic warm unlock paragraph ${index + 1}.`
  ).join('\n\n');
  await fillMarkdownAndWaitForPreview(page, markdown, 8);
  const labels = await enterImmersivePreview(page);
  const requestMonitor = createPostRequestMonitor(page);

  const warmup = await activateUnlock(page, labels, requestMonitor);
  await lockPreview(page, labels);
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    samples.push(await activateUnlock(page, labels, requestMonitor));
    if (index < 4) await lockPreview(page, labels);
  }

  const sampleMaximumMs = Math.max(...samples.map(({ clickToEditableMs }) => clickToEditableMs));
  const longTaskCount = samples.reduce((total, sample) => total + sample.longTaskCount, 0);
  const longTaskMaxMs = Math.max(...samples.map(({ longTaskMaxMs: duration }) => duration));
  await attachTiming(testInfo, 'warm-short-unlock.json', {
    longTaskCount,
    longTaskMaxMs,
    metric: '5-sample maximum',
    pendingFrameSamples: samples.filter(({ clickToPendingFrameMs }) => clickToPendingFrameMs !== null).length,
    sampleMaximumMs,
    samples,
    warmup
  });
  expect(samples.every(({ clickToPendingMutationMs }) => clickToPendingMutationMs <= 100)).toBe(true);
  expect(sampleMaximumMs).toBeLessThanOrEqual(200);
  expect(samples.every(({ scrollAnchorDelta }) => Math.abs(scrollAnchorDelta.scrollTop) <= 1)).toBe(true);
  expectNoDocumentWrites([warmup, ...samples]);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
});

test('warm windowed long unlock 5-sample maximum stays within budget and mounted block cap', async ({ page }, testInfo) => {
  await login(page);
  await openNewPost(page);
  const paragraphCount = 220;
  const markdown = Array.from(
    { length: paragraphCount },
    (_, index) => `Synthetic windowed unlock paragraph ${index + 1}.`
  ).join('\n\n');
  await fillMarkdownAndWaitForPreview(page, markdown, paragraphCount);
  const labels = await enterImmersivePreview(page);
  const requestMonitor = createPostRequestMonitor(page);

  const warmup = await activateUnlock(page, labels, requestMonitor);
  await lockPreview(page, labels);
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const sample = await activateUnlock(page, labels, requestMonitor);
    samples.push(sample);
    const editor = page.getByRole('textbox', { name: labels.previewEditorLabel });
    await expect(editor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(1);
    expect(await editor.locator('[data-easymde-visual-block-id]').count()).toBeLessThanOrEqual(160);
    if (index < 4) await lockPreview(page, labels);
  }

  const sampleMaximumMs = Math.max(...samples.map(({ clickToEditableMs }) => clickToEditableMs));
  const longTaskCount = samples.reduce((total, sample) => total + sample.longTaskCount, 0);
  const longTaskMaxMs = Math.max(...samples.map(({ longTaskMaxMs: duration }) => duration));
  await attachTiming(testInfo, 'warm-windowed-unlock.json', {
    blockCap: 160,
    longTaskCount,
    longTaskMaxMs,
    metric: '5-sample maximum',
    pendingFrameSamples: samples.filter(({ clickToPendingFrameMs }) => clickToPendingFrameMs !== null).length,
    paragraphCount,
    warmup,
    samples,
    sampleMaximumMs
  });
  expect(samples.every(({ clickToPendingMutationMs }) => clickToPendingMutationMs <= 100)).toBe(true);
  expect(sampleMaximumMs).toBeLessThanOrEqual(500);
  expect(samples.every(({ scrollAnchorDelta }) => Math.abs(scrollAnchorDelta.scrollTop) <= 1)).toBe(true);
  expectNoDocumentWrites([warmup, ...samples]);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
});

test('cancels a pending cold unlock when immersive mode changes', async ({ page }) => {
  await login(page);
  await openNewPost(page);
  const markdown = Array.from(
    { length: 8 },
    (_, index) => `Synthetic canceled unlock paragraph ${index + 1}.`
  ).join('\n\n');
  await fillMarkdownAndWaitForPreview(page, markdown, 8);
  const labels = await enterImmersivePreview(page);
  const requestMonitor = createPostRequestMonitor(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  try {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 1000,
      downloadThroughput: 200 * 1024,
      uploadThroughput: 750 * 1024 / 8,
      connectionType: 'cellular3g'
    });
    const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
    await beginUnlockTiming(page, unlock, labels.previewEditorLabel);
    requestMonitor.start();
    await unlock.click();
    await expect(unlock).toHaveAttribute('aria-busy', 'true');
    await expect(unlock).toBeDisabled();
    const pendingFrameMs = await waitForPendingFrame(page);
    expect(pendingFrameMs).toBeLessThanOrEqual(100);
    await page.getByRole('button', { name: labels.splitMode }).click();
    await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-split/u);
    await expect(page.getByRole('textbox', {
      name: labels.previewEditorLabel
    })).toHaveCount(0);
    await expect(page.getByRole('button', {
      name: labels.previewUnlockEdit
    })).toHaveCount(0);
    const requests = requestMonitor.stop();
    expectNoDocumentWrites([requests]);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    const relockedPreview = page.getByRole('button', {
      name: labels.previewUnlockEdit
    });
    await expect(relockedPreview).toBeEnabled();
    await expect(relockedPreview).not.toHaveAttribute('aria-busy', 'true');
    await stopUnlockTiming(page);
  } finally {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none'
    });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.detach();
  }
});
