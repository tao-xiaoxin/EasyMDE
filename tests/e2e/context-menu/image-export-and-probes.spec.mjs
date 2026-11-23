import { expect, test } from '@playwright/test';
import {
  anyMenuItem,
  assertSourceExactValue,
  closeMenu,
  createImageRequestGate,
  ensureSecondWordPressUser,
  expectMenuItemState,
  expectSourceSelection,
  imageScaleSource,
  imageSourceAlt,
  loadCanonicalFixture,
  login,
  menuSelector,
  menuViewportSelector,
  occurrenceOffset,
  openNewPost,
  openRootSubmenu,
  openSourceMenu,
  openVisibleSubmenu,
  replaceSourceWithNativeInput,
  replaceVisualSourceOccurrence,
  rootItem,
  selectSourceText,
  waitForSourceExactValue,
  waitForSourcePreviewAccepted
} from '../helpers/context-menu-helpers.mjs';
import {
  applyImageScaleFromSource,
  assertPreviewImageScale,
  classifyNativeWordPressRead,
  decodePostParameters,
  displayMathSource,
  exerciseImageScaleMatrix,
  fencedBlockSource,
  nativeWordPressReadOwner,
  openClipboardWriteDenial,
  privacySafeTextEvidence,
  readNativeWordPressIdentity,
  runGeneratedExportAction,
  saveAndReloadImageScale,
  seedTextClipboard,
  startGeneratedExportMutationProbe,
  startSourceMediaConsoleProbe,
  waitForRealImageLoad
} from '../helpers/context-menu-media-export-helpers.mjs';
import {
  clickVisualTextPoint,
  enterFullVisual,
  enterImmersive,
  openVisualImageMenu,
  openVisualMenu,
  readMenuRect,
  expectUnifiedVisualSurface,
  readMountedVisualImages,
  readVisibleBand,
  readVisualImageTargetState,
  revealWindowedVisualBlock,
  visualBlockImage,
  scrollWindowedVisualToTop,
  visualImagePoint
} from '../helpers/context-menu-visual-helpers.mjs';

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
  trace: 'off',
  video: 'off'
});

// Core renders `#post-lock-dialog`, and so sends real lock-refresh heartbeats,
// only on a multi-user site; guarantee one disposable second user with
// teardown deletion for the heartbeat classifier test.
const testWithSecondUser = test.extend({
  secondWordPressUser: async ({ page }, use) => {
    await login(page);
    const user = await ensureSecondWordPressUser(page);
    try {
      await use(user);
    } finally {
      await user.remove();
    }
  }
});

test.describe('Editor context menu production surfaces', () => {
  test('keeps the real mutation probe behind the decoded-body guard for unreadable and file-bearing requests', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const savePost = page.locator('#save-post');
    await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await assertSourceExactValue(source, markdown, 'probe-guard-saved');
    const identity = await readNativeWordPressIdentity(page);
    if (!identity.postId || '0' === identity.postId) {
      throw new Error('probe-guard-identity-unavailable');
    }

    // Integration path: these requests go through the REAL probe wrapper the
    // production assertions use, not the classifier called directly. A
    // legitimate multipart lock release must be exempt, while an unreadable
    // body and a file-bearing body carrying the same Action must be writes.
    const probe = await startGeneratedExportMutationProbe(page);
    const lockFields = [
      ['action', 'wp-remove-post-lock'],
      ['_wpnonce', await page.locator('#_wpnonce').inputValue()],
      ['post_ID', identity.postId],
      ['active_post_lock', await page.locator('#active_post_lock').inputValue()]
    ];
    const multipartBody = (entries, extraPart = '') => {
      let body = '';
      for (const [name, value] of entries) {
        body += `--B\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      }
      return `${body}${extraPart}--B--\r\n`;
    };
    const sendBody = async (body, contentType) => page.evaluate(async ({ payload, type }) => {
      const response = await fetch('/wp-admin/admin-ajax.php', {
        body: payload,
        headers: { 'content-type': type },
        method: 'POST'
      });
      return response.status;
    }, { payload: body, type: contentType });
    // Fulfilled locally: the point is what the probe observes, and these bodies
    // must not release a real lock or reach a real Action handler.
    await page.route('**/wp-admin/admin-ajax.php', (route) => route.fulfill({
      body: '{"success":true,"data":{}}',
      contentType: 'application/json',
      status: 200
    }));

    const filePart = '--B\r\nContent-Disposition: form-data; name="upload"; '
      + 'filename="x.png"\r\nContent-Type: image/png\r\n\r\nBINARY\r\n';
    try {
      // 1. real shape -> exempt
      await sendBody(
        multipartBody(lockFields),
        'multipart/form-data; boundary=B'
      );
      await probe.assertEmpty('probe-guard-multipart-own');

      // 2. unreadable multipart -> write; the Action cannot be read, so it is
      // recorded as an unknown owner rather than exempted by its URL.
      await sendBody('not-a-multipart-body', 'multipart/form-data; boundary=B');
      const afterBroken = probe.writes();
      if (!afterBroken.includes('admin-ajax:unknown')) {
        throw new Error(
          `probe-guard-unreadable-not-recorded:${JSON.stringify(afterBroken)}`
        );
      }

      // 3. file-bearing multipart -> write even though the Action decodes.
      await sendBody(
        multipartBody(lockFields, filePart),
        'multipart/form-data; boundary=B'
      );
      const afterFile = probe.writes();
      if (!afterFile.includes('admin-ajax:wp-remove-post-lock')) {
        throw new Error(
          `probe-guard-file-part-not-recorded:${JSON.stringify(afterFile)}`
        );
      }

      // 4. the same benign fields urlencoded stay exempt through the probe.
      const beforeUrlencoded = probe.writes().length;
      await sendBody(
        new URLSearchParams(lockFields).toString(),
        'application/x-www-form-urlencoded; charset=UTF-8'
      );
      if (probe.writes().length !== beforeUrlencoded) {
        throw new Error(
          `probe-guard-urlencoded-recorded:${JSON.stringify(probe.writes())}`
        );
      }
    } finally {
      probe.stop();
      await page.unroute('**/wp-admin/admin-ajax.php');
    }
    await assertSourceExactValue(source, markdown, 'probe-guard-complete');
  });

  test('decodes the real multipart Core lock release and denies foreign, duplicate, and autosave variants', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    // A saved draft is what gives Core a post id and an active post lock, the
    // two fields its pagehide release beacon actually reads.
    const { markdown, source } = await loadCanonicalFixture(page);
    const savePost = page.locator('#save-post');
    await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await assertSourceExactValue(source, markdown, 'multipart-lock-saved');

    const identity = await readNativeWordPressIdentity(page);
    const activeLock = await page.locator('#active_post_lock').inputValue();
    const nonce = await page.locator('#_wpnonce').inputValue();
    if (!identity.postId || '0' === identity.postId || !activeLock || !nonce) {
      throw new Error('multipart-lock-identity-unavailable');
    }

    // These are the exact fields wp-admin/js/post.js appends to its
    // pagehide sendBeacon FormData.
    const fields = [
      ['action', 'wp-remove-post-lock'],
      ['_wpnonce', nonce],
      ['post_ID', identity.postId],
      ['active_post_lock', activeLock]
    ];
    const multipartRequest = (entries) => {
      let body = '';
      for (const [name, value] of entries) {
        body += `--B\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      }
      body += '--B--\r\n';
      return {
        headers: () => ({ 'content-type': 'multipart/form-data; boundary=B' }),
        postData: () => body
      };
    };
    const classifyMultipart = (entries) => {
      const decoded = decodePostParameters(multipartRequest(entries));
      return {
        decoded,
        accepted: classifyNativeWordPressRead(
          identity,
          new URL('/wp-admin/admin-ajax.php', page.url()),
          decoded.parameters,
          decoded.parameters.get('action'),
          decoded
        )
      };
    };

    const own = classifyMultipart(fields);
    if (own.decoded.unsupported || own.decoded.hasFilePart) {
      throw new Error(`multipart-lock-decode-invalid:${JSON.stringify({
        hasFilePart: own.decoded.hasFilePart,
        unsupported: own.decoded.unsupported
      })}`);
    }
    // The real shape must decode to the real scalars, not merely be exempt.
    if (JSON.stringify([...own.decoded.parameters.entries()]) !== JSON.stringify(fields)) {
      throw new Error(
        `multipart-lock-fields-mismatch:${JSON.stringify(
          [...own.decoded.parameters.entries()]
        )}`
      );
    }
    if (!own.accepted) {
      throw new Error('multipart-lock-own-post-denied');
    }

    const foreignId = String(Number(identity.postId) + 1000);
    const replaceField = (name, value) => fields.map(([key, current]) =>
      (key === name ? [key, value] : [key, current]));
    const variants = {
      // PHP keeps the last duplicate, so any repeated field is not this read.
      'duplicate-current-post-id': [...fields, ['post_ID', identity.postId]],
      'duplicate-current-then-foreign': [...fields, ['post_ID', foreignId]],
      'foreign-post': replaceField('post_ID', foreignId),
      // An autosave owner has no business in a lock release.
      'unknown-owner-field': [...fields, ['data[wp_autosave][post_id]', identity.postId]],
      'unknown-scalar-field': [...fields, ['_easymde_markdown', 'x']]
    };
    for (const [name, entries] of Object.entries(variants)) {
      const result = classifyMultipart(entries);
      if (result.accepted) {
        throw new Error(`multipart-lock-accepted-variant:${name}`);
      }
    }

    // A part carrying a file is never this read.
    let fileBody = '';
    for (const [partName, value] of fields) {
      fileBody += `--B\r\nContent-Disposition: form-data; name="${partName}"\r\n\r\n${value}\r\n`;
    }
    fileBody += '--B\r\nContent-Disposition: form-data; name="upload"; filename="x.png"'
      + '\r\nContent-Type: image/png\r\n\r\nBINARY\r\n--B--\r\n';
    const fileDecoded = decodePostParameters({
      headers: () => ({ 'content-type': 'multipart/form-data; boundary=B' }),
      postData: () => fileBody
    });
    if (!fileDecoded.hasFilePart) {
      throw new Error('multipart-lock-file-part-undetected');
    }
    if (classifyNativeWordPressRead(
      identity,
      new URL('/wp-admin/admin-ajax.php', page.url()),
      fileDecoded.parameters,
      fileDecoded.parameters.get('action'),
      fileDecoded
    )) {
      throw new Error('multipart-lock-accepted-file-part');
    }

    // An unreadable multipart body is an explicit failure, never a silent
    // exemption by action name.
    const broken = decodePostParameters({
      headers: () => ({ 'content-type': 'multipart/form-data; boundary=Z' }),
      postData: () => 'not-a-multipart-body'
    });
    if (!broken.unsupported) {
      throw new Error('multipart-lock-broken-body-accepted');
    }

    // The real defect: the production probe is attached before a reload, so
    // Core's pagehide multipart lock release must not be recorded as a write.
    const beacons = [];
    const reloadProbe = await startGeneratedExportMutationProbe(page);
    const onRequest = (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/wp-admin/admin-ajax.php')) return;
      const decoded = decodePostParameters(request);
      const action = decoded.parameters.get('action');
      if ('wp-remove-post-lock' !== action) return;
      beacons.push({
        accepted: classifyNativeWordPressRead(
          identity,
          url,
          decoded.parameters,
          action,
          decoded
        ),
        contentType: request.headers()['content-type'] ?? ''
      });
    };
    page.on('request', onRequest);
    try {
      await page.reload({ waitUntil: 'load', timeout: 15_000 });
      await expect(page.locator('#easymde-editor')).toBeVisible();
    } finally {
      page.off('request', onRequest);
    }
    try {
      const recorded = reloadProbe.writes();
      if (recorded.length > 0) {
        throw new Error(
          `multipart-lock-release-recorded-as-write:${JSON.stringify(recorded)}`
        );
      }
    } finally {
      reloadProbe.stop();
    }
    // Core sends this release on pagehide through sendBeacon, so at least one
    // real multipart lock release must have been observed and accepted.
    if (0 === beacons.length) {
      throw new Error('multipart-lock-beacon-not-observed');
    }
    const denied = beacons.filter((beacon) => !beacon.accepted);
    if (denied.length > 0) {
      throw new Error(
        `multipart-lock-beacon-denied:${JSON.stringify(denied.map((beacon) => beacon.contentType))}`
      );
    }
    if (!beacons.some((beacon) => beacon.contentType.includes('multipart/form-data'))) {
      throw new Error(
        `multipart-lock-beacon-not-multipart:${JSON.stringify(
          beacons.map((beacon) => beacon.contentType)
        )}`
      );
    }
  });

  testWithSecondUser('classifies real Core heartbeat reads and denies real autosave, unknown owners, and foreign posts', async ({ page, secondWordPressUser }) => {
    expect(secondWordPressUser.userCount).toBeGreaterThanOrEqual(2);
    // The `secondWordPressUser` fixture already authenticated this page.
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    // Persist the disposable draft once through the real native save so the
    // page publishes a real post identity and Core lock maintenance engages;
    // a post-new.php screen has neither.
    const savePost = page.locator('#save-post');
    await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await expect(page.locator('#post-lock-dialog')).toHaveCount(1);
    await assertSourceExactValue(source, markdown, 'native-read-probe-saved');
    const identity = await readNativeWordPressIdentity(page);
    if (!identity.postId || '0' === identity.postId) {
      throw new Error('native-read-identity-missing');
    }
    const heartbeatRequests = [];
    const onRequest = (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/wp-admin/admin-ajax.php')) return;
      const decoded = decodePostParameters(request);
      const parameters = decoded.parameters;
      if ('heartbeat' !== (url.searchParams.get('action') ?? parameters.get('action'))) return;
      heartbeatRequests.push([...parameters.entries()]);
    };
    page.on('request', onRequest);
    const classify = (entries) => {
      const parameters = new URLSearchParams(entries);
      return classifyNativeWordPressRead(
        identity,
        new URL('/wp-admin/admin-ajax.php', page.url()),
        parameters,
        parameters.get('action')
      );
    };
    const hasOwner = (entries, owner) =>
      entries.some(([key]) => key.startsWith(`data[${owner}]`));
    try {
      await page.evaluate(() => {
        if (!window.jQuery || !window.wp?.autosave?.server?.triggerSave) {
          throw new Error('native-autosave-owner-unavailable');
        }
        window.__easymdeCoreAutosaveProbe = { completed: 0, success: false };
        window.jQuery(document).on('after-autosave.easymdeClassifierProbe', (_event, data) => {
          window.__easymdeCoreAutosaveProbe.completed += 1;
          window.__easymdeCoreAutosaveProbe.success = data?.success === true;
        });
      });
      // A real Core maintenance heartbeat must be exempt: lock refresh,
      // auth check, and nonce refresh all address the current post.
      await page.evaluate(() => window.wp.heartbeat.connectNow());
      await expect.poll(() => heartbeatRequests.length).toBeGreaterThan(0);
      const maintenance = heartbeatRequests
        .filter((entries) => entries.some(([key]) => key.startsWith('data[')))
        .at(-1);
      if (!maintenance) throw new Error('native-read-real-heartbeat-payload-missing');
      if (!maintenance.some(([key]) => '_nonce' === key)) {
        throw new Error('native-read-real-heartbeat-nonce-missing');
      }
      if (!classify(maintenance)) {
        throw new Error(
          `native-read-real-heartbeat-rejected:${JSON.stringify(
            maintenance.map(([key]) => key)
          )}`
        );
      }

      // Derived from that exact real request: only the named mutations may
      // flip it to a write.
      const withoutNonce = maintenance.filter(([key]) => '_nonce' !== key);
      if (classify(withoutNonce)) {
        throw new Error('native-read-accepted-heartbeat-without-nonce');
      }
      const otherScreen = maintenance.map(
        ([key, value]) => ('screen_id' === key ? [key, 'dashboard'] : [key, value])
      );
      if (classify(otherScreen)) {
        throw new Error('native-read-accepted-other-screen-heartbeat');
      }
      const unknownOwner = [...maintenance, ['data[easymde_extension][post_id]', identity.postId]];
      if (classify(unknownOwner)) {
        throw new Error('native-read-accepted-unknown-owner');
      }
      const malformedOwners = {
        'missing-post': [['data[wp-refresh-post-lock][lock]', 'synthetic-lock']],
        'unknown-field': [['data[wp-refresh-post-lock][post_id]', identity.postId], ['data[wp-refresh-post-lock][content]', 'synthetic']],
        'nested-post': [['data[wp-refresh-post-lock][post_id][nested]', identity.postId]],
        'scalar-json': [['data', JSON.stringify({ 'wp-refresh-post-lock': true })]],
        'missing-json-post': [['data', JSON.stringify({ 'wp-refresh-post-nonces': {} })]],
        'foreign-json-post': [['data', JSON.stringify({ 'wp-refresh-post-lock': { post_id: String(Number(identity.postId) + 1000) } })]],
        'mixed-encoding': [['data', '{}'], ['data[wp-refresh-post-lock][post_id]', identity.postId]]
      };
      const maintenanceEnvelope = maintenance.filter(([key]) => key !== 'data' && !key.startsWith('data['));
      for (const [shape, fields] of Object.entries(malformedOwners)) {
        if (classify([...maintenanceEnvelope, ...fields])) {
          throw new Error(`native-read-accepted-malformed-owner:${shape}`);
        }
      }
      const foreignPostId = String(Number(identity.postId) + 1000);
      // Replace the real owner value: PHP keeps the last duplicate, so a
      // replaced (not appended) foreign post id is what the server would use.
      const replaceOwnerPostId = (entries, owner) => entries.map(([key, value]) =>
        key === `data[${owner}][post_id]` ? [key, foreignPostId] : [key, value]);
      let verifiedForeignOwners = 0;
      for (const owner of ['wp-refresh-post-lock', 'wp-refresh-post-nonces']) {
        if (!maintenance.some(([key]) => key === `data[${owner}][post_id]`)) continue;
        verifiedForeignOwners += 1;
        const foreignPost = replaceOwnerPostId(maintenance, owner);
        if (!foreignPost.some(([key, value]) => key === `data[${owner}][post_id]`
          && value === foreignPostId)) {
          throw new Error(`native-read-foreign-post-replacement-missing:${owner}`);
        }
        if (classify(foreignPost)) {
          throw new Error(`native-read-accepted-foreign-post:${owner}`);
        }
        // PHP keeps the last duplicate, so a current-then-foreign pair must
        // also be denied rather than exempted on its first value.
        const duplicate = [...maintenance, [`data[${owner}][post_id]`, foreignPostId]];
        if (classify(duplicate)) {
          throw new Error(`native-read-accepted-duplicate-foreign-post:${owner}`);
        }
      }
      if (0 === verifiedForeignOwners) {
        throw new Error(
          `native-read-foreign-post-control-unavailable:${JSON.stringify(
            maintenance.map(([key]) => key)
          )}`
        );
      }
      const autosaveOwner = [
        ...maintenance.filter(([key]) => !key.startsWith('data[wp_autosave]')),
        ['data[wp_autosave][post_id]', identity.postId],
        ['data[wp_autosave][content]', 'synthetic autosave probe']
      ];
      if (classify(autosaveOwner)) {
        throw new Error('native-read-accepted-autosave-owner');
      }

      // The real autosave path must also be denied, not only a derived shape.
      await replaceSourceWithNativeInput(page, sourceEditor, source, `${markdown}\n\nReal autosave probe.`, 'autosave-first-input');
      await expect(source).toHaveValue(`${markdown}\n\nReal autosave probe.`);
      // Core decides whether to create wp_autosave before EasyMDE's heartbeat
      // callback projects Markdown into #content. Change a real Core-owned
      // field as well: never fabricate an autosave payload or write #content.
      await page.locator('#title').fill('Synthetic Core autosave classifier first');
      const autosaveCount = heartbeatRequests.length;
      await page.evaluate(() => {
        if (!window.wp?.autosave?.server?.triggerSave
          || !window.wp.autosave.server.postChanged()) {
          throw new Error('native-autosave-owner-unavailable');
        }
        window.wp.autosave.server.triggerSave();
      });
      await expect.poll(
        async () => heartbeatRequests.slice(autosaveCount).some(
          (entries) => hasOwner(entries, 'wp_autosave')
        ) && await page.evaluate(() => window.__easymdeCoreAutosaveProbe.completed === 1
          && window.__easymdeCoreAutosaveProbe.success),
        { message: 'a real Core autosave heartbeat must be observed', timeout: 30_000 }
      ).toBe(true);
      const realAutosave = heartbeatRequests.slice(autosaveCount).find(
        (entries) => hasOwner(entries, 'wp_autosave')
      );
      if (classify(realAutosave)) {
        throw new Error(
          `native-read-accepted-real-autosave:${JSON.stringify(
            realAutosave.map(([key]) => key)
          )}`
        );
      }
      // The classifier denies it, so a write probe that used to exempt every
      // heartbeat must now record this real autosave instead of masking it.
      const generatedProbe = await startGeneratedExportMutationProbe(page);
      try {
        await replaceSourceWithNativeInput(page, sourceEditor, source, `${markdown}\n\nReal autosave probe 2.`, 'autosave-second-input');
        await expect(source).toHaveValue(`${markdown}\n\nReal autosave probe 2.`);
        await page.locator('#title').fill('Synthetic Core autosave classifier second');
        const autosaveBefore = heartbeatRequests.length;
        // Awaiting the actual first after-autosave callback above releases
        // Core's in-flight block. Its public trigger resets only nextRun;
        // the real native title supplies the second change-detection input.
        await page.evaluate(() => {
          if (!window.wp?.autosave?.server?.triggerSave
            || !window.wp.autosave.server.postChanged()) {
            throw new Error('native-autosave-owner-unavailable');
          }
          window.wp.autosave.server.triggerSave();
        });
        await expect.poll(
          async () => heartbeatRequests.slice(autosaveBefore).some(
            (entries) => hasOwner(entries, 'wp_autosave')
          ) && await page.evaluate(() => window.__easymdeCoreAutosaveProbe.completed === 2
            && window.__easymdeCoreAutosaveProbe.success),
          { message: 'a second real autosave heartbeat must be observed', timeout: 30_000 }
        ).toBe(true);
        const recorded = generatedProbe.writes();
        if (!recorded.includes('admin-ajax:heartbeat')) {
          throw new Error(
            `native-read-real-autosave-masked-by-probe:${JSON.stringify(recorded)}`
          );
        }
      } finally {
        generatedProbe.stop();
      }
    } finally {
      page.off('request', onRequest);
      await page.evaluate(() => {
        window.jQuery?.(document).off('.easymdeClassifierProbe');
        delete window.__easymdeCoreAutosaveProbe;
      });
    }
    await assertSourceExactValue(
      source,
      `${markdown}\n\nReal autosave probe 2.`,
      'native-read-probe-end'
    );
  });

  test('keeps Source image copying capability gated by the real local PNG load', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const imageGate = createImageRequestGate();
    const { fixtureImageUrl, markdown, source, sourceEditor } =
      await loadCanonicalFixture(page, 1, { imageGate });
    const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;
    const imageStart = occurrenceOffset(markdown, imageMarkdown);
    const image = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"] img'
    ).first();
    const documentWrites = [];
    const dialogs = [];
    const nativeRead = await nativeWordPressReadOwner(page);
    page.on('request', (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      const decoded = decodePostParameters(request);
      const parameters = decoded.parameters;
      const action = url.searchParams.get('action') ?? parameters.get('action');
      if (url.pathname.endsWith('/wp-json/easymde/v1/preview')) return;
      if (nativeRead(url, parameters, action, decoded)) return;
      documentWrites.push(
        url.pathname.endsWith('/wp-admin/post.php')
          ? 'post-form'
          : url.pathname.endsWith('/wp-admin/admin-ajax.php')
            ? `admin-ajax:${/^[a-z0-9_-]{1,40}$/iu.test(action ?? '') ? action : 'unknown'}`
            : url.pathname.includes('/wp-json/')
              ? 'rest'
              : 'other'
      );
    });
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });

    try {
      await expect(image).toHaveCount(1);
      await expect.poll(() => image.evaluate((element) => element.complete)).toBe(false);

      await selectSourceText(page, sourceEditor, markdown, imageMarkdown);
      await openSourceMenu(page, sourceEditor);
      await expectMenuItemState(page, 'copy-image', 'disabled');
      await expectSourceSelection(page, imageStart, imageStart + imageMarkdown.length);
      await expect(source).toHaveValue(markdown);

      imageGate.release();
      await waitForRealImageLoad(image);
      await expect(page.locator(menuSelector)).toBeVisible();
      await expectSourceSelection(page, imageStart, imageStart + imageMarkdown.length);
      await expectMenuItemState(page, 'copy-image', 'enabled');
      await expect(source).toHaveValue(markdown);
      await closeMenu(page);
      await expect(source).toHaveValue(markdown);
      await expect(page.locator('.easymde-editor-message-alert-host [role="alert"]'))
        .toHaveCount(0);
      expect(dialogs).toEqual([]);
      expect(documentWrites).toEqual([]);
    } finally {
      imageGate.release();
    }
  });

  test('applies every image scale through ordinary and immersive split Source, then saves 200% natively', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { fixtureImageUrl, markdown, preview, source, sourceEditor } =
      await loadCanonicalFixture(page);
    const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;

    await exerciseImageScaleMatrix(page, {
      imageMarkdown,
      markdown,
      mode: 'ordinary-source',
      preview,
      source,
      sourceEditor
    });
    await assertSourceExactValue(source, markdown, 'ordinary-source-complete');

    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    const splitPreview = page.locator('[data-easymde-preview-html-sink="1"]').last();
    const splitSourceEditor = page.locator('.easymde-source-react .cm-content');
    await exerciseImageScaleMatrix(page, {
      imageMarkdown,
      markdown,
      mode: 'immersive-split-source',
      preview: splitPreview,
      source,
      sourceEditor: splitSourceEditor
    });
    await assertSourceExactValue(source, markdown, 'immersive-split-source-complete');

    await page.getByRole('button', { name: strings.exit, exact: true }).click();
    await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);

    const finalExpected = imageScaleSource(markdown, imageMarkdown, 200);
    const ordinarySourceEditor = page.locator('.easymde-source-react .cm-content');
    await applyImageScaleFromSource(
      page,
      source,
      ordinarySourceEditor,
      markdown,
      imageMarkdown,
      200,
      finalExpected
    );
    const finalPreview = page.locator('[data-easymde-preview-html-sink="1"]').last();
    const finalImage = finalPreview.getByAltText(imageSourceAlt, { exact: true });
    await expect(finalImage).toHaveCount(1);
    await waitForRealImageLoad(finalImage);
    await assertPreviewImageScale(finalImage, 200, 'before-save');
    await saveAndReloadImageScale(page, source, finalExpected);
  });

  test('exports canonical formula and Mermaid locally without changing Source or Preview', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    await expect(preview.locator('.easymde-math').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();

    const formulaSource = displayMathSource(markdown);
    const mermaidSource = fencedBlockSource(markdown, 'mermaid');
    const formulaExportSource = `\n${formulaSource}\n`;
    const mermaidExportSource = `${mermaidSource}\n`;
    const mutationProbe = await startGeneratedExportMutationProbe(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const assertionCodes = new Set([
      'generated-content-export-clipboard-failed',
      'generated-content-export-clipboard-unsupported',
      'generated-content-export-rasterization-failed'
    ]);
    try {
      let formulaPng;
      for (const [action, label] of [
        ['copy-generated-source', 'formula-copy-source'],
        ['copy-generated-mathml', 'formula-copy-mathml'],
        ['copy-generated-image', 'formula-copy-png']
      ]) {
        const evidence = await runGeneratedExportAction(page, {
          action,
          expectedSource: formulaExportSource,
          kind: 'math',
          label,
          markdown,
          mutationProbe,
          preview,
          selectText: formulaSource,
          source,
          sourceEditor
        });
        if ('copy-generated-image' === action) formulaPng = evidence;
      }

      let mermaidPng;
      for (const [action, label] of [
        ['copy-generated-source', 'mermaid-copy-source'],
        ['copy-generated-image', 'mermaid-copy-png']
      ]) {
        const evidence = await runGeneratedExportAction(page, {
          action,
          expectedSource: mermaidExportSource,
          kind: 'mermaid',
          label,
          markdown,
          mutationProbe,
          preview,
          previousPngHash: formulaPng?.hash,
          selectText: 'flowchart TD',
          source,
          sourceEditor
        });
        if ('copy-generated-image' === action) mermaidPng = evidence;
      }

      if (!formulaPng || !mermaidPng) {
        throw new Error('generated-export-png-evidence-missing');
      }
      if (formulaPng.hash === mermaidPng.hash) {
        throw new Error('generated-export-png-hash-collision');
      }

      // Successful exports must not report any export/clipboard failure.
      const unexpected = consoleProbe.codes().filter((code) => assertionCodes.has(code));
      if (unexpected.length > 0) {
        throw new Error(`generated-export-unexpected-failure:${unexpected.join(',')}`);
      }

      // Negative control: a genuine browser-level denial of clipboard writes
      // must fail the second image export rather than silently accepting the
      // previous PNG. The permission is restored afterwards and a real export
      // must succeed again, proving the failure came from the denial.
      // Leave a real native redo entry across the denied export. Neither the
      // failure nor permission restoration may clear or consume that entry.
      const historyCanary = replaceVisualSourceOccurrence(markdown, '普通文本', '**普通文本**');
      await selectSourceText(page, sourceEditor, markdown, '普通文本');
      await openSourceMenu(page, sourceEditor);
      await rootItem(page, 'bold').click();
      await waitForSourceExactValue(source, historyCanary, 'export-history-canary-bold');
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'export-history-canary-undo');
      await waitForSourcePreviewAccepted(preview, 'export-history-canary-ready');
      const origin = new URL(page.url()).origin;
      const denial = await openClipboardWriteDenial(page, origin, 'formula-copy-png-denied');
      const beforeDenialCodes = new Set(consoleProbe.codes());
      try {
        await seedTextClipboard(page, 'denied clipboard seed', 'formula-copy-png-denied');
        await denial.deny();
        await selectSourceText(page, sourceEditor, markdown, formulaSource);
        await openSourceMenu(page, sourceEditor);
        await openRootSubmenu(page, 'generated-content');
        await openVisibleSubmenu(page, 'copy-generated');
        await anyMenuItem(page, 'copy-generated-image').click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await expect.poll(
          () => consoleProbe.codes().some(
            (code) => !beforeDenialCodes.has(code) && assertionCodes.has(code)
          ),
          { message: 'a denied clipboard write must report an export failure' }
        ).toBe(true);
        // The denial covers sanitized and unsanitized writes, which also
        // blocks clipboard reads; permissions are restored before the seed is
        // inspected. Restoration itself does not touch the clipboard.
        await denial.restore();
        const deniedState = await page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          return {
            hasPng: items.some((item) => item.types.includes('image/png')),
            text: items.flatMap((item) => item.types).includes('text/plain')
              ? await navigator.clipboard.readText()
              : null
          };
        });
        if (deniedState.hasPng) {
          throw new Error('generated-export-denied-write-stale-png-accepted');
        }
        if (deniedState.text !== 'denied clipboard seed') {
          throw new Error(
            'generated-export-denied-write-clipboard-mutated:' +
            JSON.stringify(privacySafeTextEvidence(deniedState.text ?? ''))
          );
        }
        await expect(
          page.locator('.easymde-editor-message-alert-host [role="alert"]').first()
        ).toBeVisible();
        await mutationProbe.assertEmpty('formula-copy-png-denied');
        await assertSourceExactValue(source, markdown, 'formula-copy-png-denied');
      } finally {
        await denial.restore();
        await denial.dispose();
      }
      await sourceEditor.press('ControlOrMeta+Shift+z');
      await waitForSourceExactValue(source, historyCanary, 'export-denied-history-redo');
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'export-denied-history-undo');
      await waitForSourcePreviewAccepted(preview, 'export-denied-history-ready');
      const recoveryBefore = new Set(consoleProbe.codes());
      const recovered = await runGeneratedExportAction(page, {
        action: 'copy-generated-image',
        expectedSource: formulaExportSource,
        kind: 'math',
        label: 'formula-copy-png-recovered',
        markdown,
        mutationProbe,
        preview,
        selectText: formulaSource,
        source,
        sourceEditor
      });
      if (!recovered) {
        throw new Error('generated-export-png-recovery-missing');
      }
      const recoveryFailures = consoleProbe.codes().filter(
        (code) => !recoveryBefore.has(code) && assertionCodes.has(code)
      );
      if (recoveryFailures.length > 0) {
        throw new Error(`generated-export-png-recovery-failed:${recoveryFailures.join(',')}`);
      }
      // The same target at the same scale must rasterize to the same geometry.
      const geometry = (evidence) => `${evidence.width}x${evidence.height}:${evidence.nonBlankPixels}`;
      if (geometry(recovered) !== geometry(formulaPng)) {
        throw new Error(
          `generated-export-png-recovery-mismatch:${JSON.stringify({
            actual: geometry(recovered),
            expected: geometry(formulaPng)
          })}`
        );
      }
      await sourceEditor.press('ControlOrMeta+Shift+z');
      await waitForSourceExactValue(source, historyCanary, 'export-recovered-history-redo');
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'export-recovered-history-undo');
      await waitForSourcePreviewAccepted(preview, 'export-recovered-history-ready');
    } finally {
      consoleProbe.stop();
      mutationProbe.stop();
    }
    await assertSourceExactValue(source, markdown, 'generated-export-complete');
  });

  test('opens image actions when directly right-clicking an unselected Full Visual image', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    await loadCanonicalFixture(page);
    const full = await enterFullVisual(page);
    const image = full.visualEditor.getByAltText(imageSourceAlt, { exact: true }).first();

    await openVisualMenu(
      page,
      full.visualEditor,
      image,
      async () => {
        await image.evaluate((target) => {
          target.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
        });
      }
    );

    await expectMenuItemState(page, 'image-scale', 'enabled');
    await expect(page.locator(menuSelector)).toBeVisible();
  });

  test('re-anchors Windowed Visual image menus and selection to the image under the pointer', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    // ADR-002: two canonical fixtures stay one unified, fully live surface.
    await expectUnifiedVisualSurface(visualEditor, 160);
    // The fixture editor leaves its caret at the document end. Scroll to the
    // top so both fixture images of the first copy are visible and clickable.
    await scrollWindowedVisualToTop(page, visualEditor);
    const mounted = await readMountedVisualImages(visualEditor);
    const firstBlock = mounted[0]?.block ?? null;
    const secondBlock = mounted[1]?.block ?? null;
    if (!firstBlock || !secondBlock || firstBlock === secondBlock) {
      throw new Error(
        `image-pointer-blocks-unavailable:${JSON.stringify(mounted)}`
      );
    }
    // Every demand below addresses its image by block identity, and both images
    // stay mounted and visible so no gesture has to scroll the surface.
    await revealWindowedVisualBlock(page, firstBlock);
    const first = visualBlockImage(visualEditor, firstBlock);
    const second = visualBlockImage(visualEditor, secondBlock);
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await assertSourceExactValue(source, markdown, 'image-pointer-before');

    // First image menu, dismissed with Escape. The native range and the DOM
    // both survive exactly as the browser left them.
    const firstPoint = await openVisualImageMenu(page, first);
    await expectMenuItemState(page, 'image-scale', 'enabled');
    let state = await readVisualImageTargetState(visualEditor);
    if (
      firstPoint.block !== firstBlock
      || !state.overlaps[0]
      || state.overlaps[1]
      || state.anchorBlock !== firstBlock
      || state.markerBlock !== firstBlock
    ) {
      throw new Error(`image-pointer-first-menu-invalid:${JSON.stringify(state)}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');

    // A -> B -> A repeats without any range being cleared in between. Each
    // demand keeps exactly one root menu and describes the pointed image.
    for (const [index, block] of [
      [1, secondBlock],
      [0, firstBlock],
      [1, secondBlock],
      [0, firstBlock]
    ]) {
      const image = 0 === index ? first : second;
      const stateBefore = await readVisualImageTargetState(visualEditor);
      const menuBefore = await readMenuRect(page);
      const point = await openVisualImageMenu(page, image);
      await expectMenuItemState(page, 'image-scale', 'enabled');
      state = await readVisualImageTargetState(visualEditor);
      const other = 0 === index ? 1 : 0;
      if (
        point.block !== block
        || !state.overlaps[index]
        || state.overlaps[other]
        || state.anchorBlock !== block
        || state.markerBlock !== block
      ) {
        throw new Error(
          `image-pointer-retarget-invalid:${index}:${JSON.stringify({
            menuAfter: await readMenuRect(page),
            menuBefore,
            point,
            state,
            stateBefore
          })}`
        );
      }
      await expect(
        page.locator(
          `${menuViewportSelector} [data-easymde-context-menu-layer]`
        )
      ).toHaveCount(1);
    }
    await assertSourceExactValue(source, markdown, 'image-pointer-after');
  });

  test('keeps image ownership on the image a replacing pointer demand selected', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    // ADR-002: two canonical fixtures stay one unified, fully live surface.
    await expectUnifiedVisualSurface(visualEditor, 160);
    await scrollWindowedVisualToTop(page, visualEditor);
    const mounted = await readMountedVisualImages(visualEditor);
    const firstBlock = mounted[0]?.block ?? null;
    const secondBlock = mounted[1]?.block ?? null;
    if (
      !firstBlock
      || !secondBlock
      || firstBlock === secondBlock
      || mounted[0]?.alt !== '占位测试图片'
      || mounted[1]?.alt !== '风景占位图'
    ) {
      throw new Error(
        `image-pointer-blocks-unavailable:${JSON.stringify(mounted)}`
      );
    }
    await revealWindowedVisualBlock(page, firstBlock);
    const first = visualBlockImage(visualEditor, firstBlock);
    const second = visualBlockImage(visualEditor, secondBlock);
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    const firstMarkdown = markdown.match(/!\[占位测试图片\]\([^\r\n]+\)/u)?.[0];
    const secondMarkdown = markdown.match(/!\[风景占位图\]\([^\r\n]+\)/u)?.[0];
    if (!firstMarkdown || !secondMarkdown) {
      throw new Error('image-pointer-source-unavailable');
    }
    await assertSourceExactValue(source, markdown, 'image-pointer-scale-before');

    // First image menu stays open; the second image demand replaces it, and
    // the surface must not be scrolled to reach that image.
    await openVisualImageMenu(page, first);
    await expectMenuItemState(page, 'image-scale', 'enabled');
    await openVisualImageMenu(page, second);
    const state = await readVisualImageTargetState(visualEditor);
    if (
      !state.overlaps[1]
      || state.overlaps[0]
      || state.collapsed
      || state.rangeCount !== 1
    ) {
      throw new Error(
        `image-pointer-open-menu-retarget-invalid:${JSON.stringify(state)}`
      );
    }

    await openRootSubmenu(page, 'image-scale');
    await expectMenuItemState(page, 'image-scale-50', 'enabled');
    await anyMenuItem(page, 'image-scale-50').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    const expected = imageScaleSource(markdown, secondMarkdown, 50, 0);
    await waitForSourceExactValue(source, expected, 'image-pointer-scale-applied');
    const scaled = await source.inputValue();
    // The first image keeps its source bytes: only the pointed image changed.
    if (scaled.includes(imageScaleSource(markdown, firstMarkdown, 50, 0))) {
      throw new Error('image-pointer-first-image-mutated');
    }
    if (!scaled.includes(firstMarkdown)) {
      throw new Error('image-pointer-first-image-source-missing');
    }
    await assertPreviewImageScale(
      visualEditor.getByAltText('风景占位图', { exact: true }).first(),
      50,
      'image-pointer-scale-applied'
    );

    await visualEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, markdown, 'image-pointer-scale-undo');
    await expect(
      visualEditor.getByAltText('风景占位图', { exact: true }).first()
    ).not.toHaveAttribute('data-easymde-image-scale');
    await assertSourceExactValue(source, markdown, 'image-pointer-scale-after');
  });

  test('selects the left-clicked image and moves its visible target state', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    // ADR-002: two canonical fixtures stay one unified, fully live surface.
    await expectUnifiedVisualSurface(visualEditor, 160);
    await scrollWindowedVisualToTop(page, visualEditor);
    const mounted = await readMountedVisualImages(visualEditor);
    const firstBlock = mounted[0]?.block ?? null;
    const secondBlock = mounted[1]?.block ?? null;
    if (!firstBlock || !secondBlock || firstBlock === secondBlock) {
      throw new Error(
        `image-activation-blocks-unavailable:${JSON.stringify(mounted)}`
      );
    }
    // Both images stay mounted and visible, so no gesture has to scroll the
    // surface while it interacts with them.
    await revealWindowedVisualBlock(page, firstBlock);
    const first = visualBlockImage(visualEditor, firstBlock);
    const second = visualBlockImage(visualEditor, secondBlock);
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await assertSourceExactValue(source, markdown, 'image-activation-before');

    // The primary button on an image selects that image and marks it.
    let point = await visualImagePoint(first);
    await page.mouse.click(point.x, point.y);
    let state = await readVisualImageTargetState(visualEditor);
    if (
      state.collapsed
      || state.rangeCount !== 1
      || !state.overlaps[0]
      || state.overlaps[1]
      || state.anchorBlock !== firstBlock
      || state.markerBlock !== firstBlock
    ) {
      throw new Error(`image-activation-first-invalid:${JSON.stringify(state)}`);
    }

    // Activating the next image moves both the selection and the marker.
    point = await visualImagePoint(second);
    await page.mouse.click(point.x, point.y);
    state = await readVisualImageTargetState(visualEditor);
    if (
      state.collapsed
      || state.rangeCount !== 1
      || !state.overlaps[1]
      || state.overlaps[0]
      || state.anchorBlock !== secondBlock
      || state.markerBlock !== secondBlock
    ) {
      throw new Error(`image-activation-second-invalid:${JSON.stringify(state)}`);
    }

    // A layout change the image itself caused — no scroll, no window resize —
    // keeps the marker bound to the box it describes.
    const resizedRect = await second.evaluate((image) => {
      image.style.width = '60%';
      const rect = image.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width)
      };
    });
    await expect
      .poll(async () => (await readVisualImageTargetState(visualEditor)).markerRect)
      .toEqual(resizedRect);

    // Sliding the image out of the visible band must not paint the outline over
    // page chrome: every step keeps the outline inside the band and viewport.
    for (const step of [180, 180, 180, 180]) {
      await page
        .locator('.easymde-immersive-preview-canvas')
        .evaluate((element, offset) => {
          element.scrollTop += offset;
          element.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, step);
      await expect
        .poll(async () => {
          const band = await readVisibleBand(page);
          const state = await readVisualImageTargetState(visualEditor);
          if (!state.markerRect) return 'missing-outline';
          const markerBottom =
            state.markerRect.top + state.markerRect.height;
          const inside =
            state.markerRect.top >= band.top - 1
            && markerBottom <= band.bottom + 1
            && state.markerRect.top >= -1;
          return inside ? 'inside' : JSON.stringify({ band, marker: state.markerRect });
        })
        .toBe('inside');
    }

    // Clicking text clears the marker and leaves a caret inside that block.
    const text = await clickVisualTextPoint(page, visualEditor);
    state = await readVisualImageTargetState(visualEditor);
    if (
      !state.collapsed
      || state.rangeCount !== 1
      || state.markerTop !== null
      || state.markerBlock !== null
      || !text.block
      || state.anchorBlock !== text.block
    ) {
      throw new Error(
        `image-activation-text-invalid:${JSON.stringify({ state, text })}`
      );
    }

    // Selecting and marking an image never writes Markdown.
    await assertSourceExactValue(source, markdown, 'image-activation-after');
  });
});
