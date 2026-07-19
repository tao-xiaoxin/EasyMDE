import { expect, test } from '@playwright/test';

const isolationMode = process.env.EASYMDE_E2E_VISUAL_ISOLATION === '1';
const referenceUrl = process.env.EASYMDE_VISUAL_REFERENCE_URL;
const refactorUrl = process.env.EASYMDE_VISUAL_REFACTOR_URL;
const fixturePassword = 'easymde-visual-fixture';

async function logIn(page, origin, username) {
  await page.goto(`${origin}/wp-login.php`);
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(fixturePassword);
  await Promise.all([
    page.waitForURL(/\/wp-admin\//),
    page.locator('#wp-submit').click()
  ]);
  await page.goto(`${origin}/wp-admin/post-new.php`);
  await page.waitForFunction(() => Boolean(window.EasyMDEConfig?.nonce));

  return page.evaluate(() => ({
    displayName: document.querySelector('#wp-admin-bar-my-account .display-name')?.textContent?.trim(),
    nonce: window.EasyMDEConfig.nonce
  }));
}

async function requestPreview(context, origin, nonce) {
  return context.request.post(`${origin}/wp-json/easymde/v1/preview`, {
    data: {
      markdown: '# Synthetic nonce isolation probe'
    },
    headers: {
      'X-WP-Nonce': nonce
    }
  });
}

test.describe('EasyMDE editor visual browser isolation', () => {
  test.skip(!isolationMode, 'Run only through the explicit dual-environment isolation workflow.');

  test('separates browser profiles, cookies, local storage, session storage, and cache', async ({ browser }) => {
    if (!referenceUrl || !refactorUrl) {
      throw new Error('Set EASYMDE_VISUAL_REFERENCE_URL and EASYMDE_VISUAL_REFACTOR_URL.');
    }

    const referenceContext = await browser.newContext();
    const refactorContext = await browser.newContext();
    const referencePage = await referenceContext.newPage();
    const refactorPage = await refactorContext.newPage();
    const storageKey = 'easymde:visual-isolation-probe';
    const cookieName = 'easymde_visual_isolation_probe';

    try {
      await referencePage.goto(`${referenceUrl}/wp-login.php`);
      await refactorPage.goto(`${refactorUrl}/wp-login.php`);

      await referencePage.evaluate(async ({ cookie, key }) => {
        localStorage.setItem(key, 'reference');
        sessionStorage.setItem(key, 'reference');
        const cache = await caches.open('easymde-visual-reference');
        await cache.put('/easymde-visual-probe', new Response('reference'));
        document.cookie = `${cookie}=reference; path=/; SameSite=Lax`;
      }, { cookie: cookieName, key: storageKey });
      await refactorPage.evaluate(async ({ cookie, key }) => {
        localStorage.setItem(key, 'refactor');
        sessionStorage.setItem(key, 'refactor');
        const cache = await caches.open('easymde-visual-refactor');
        await cache.put('/easymde-visual-probe', new Response('refactor'));
        document.cookie = `${cookie}=refactor; path=/; SameSite=Lax`;
      }, { cookie: cookieName, key: storageKey });

      const referenceState = await referencePage.evaluate(async (key) => ({
        cache: await (await caches.open('easymde-visual-reference')).match('/easymde-visual-probe').then((response) => response.text()),
        local: localStorage.getItem(key),
        session: sessionStorage.getItem(key),
        cookie: document.cookie
      }), storageKey);
      const refactorState = await refactorPage.evaluate(async (key) => ({
        cache: await (await caches.open('easymde-visual-refactor')).match('/easymde-visual-probe').then((response) => response.text()),
        local: localStorage.getItem(key),
        session: sessionStorage.getItem(key),
        cookie: document.cookie
      }), storageKey);

      expect(referenceState).toEqual({
        cache: 'reference',
        local: 'reference',
        session: 'reference',
        cookie: expect.stringContaining(`${cookieName}=reference`)
      });
      expect(refactorState).toEqual({
        cache: 'refactor',
        local: 'refactor',
        session: 'refactor',
        cookie: expect.stringContaining(`${cookieName}=refactor`)
      });
      expect(await referenceContext.cookies()).not.toEqual(await refactorContext.cookies());
      expect(referenceContext).not.toBe(refactorContext);
    } finally {
      await referenceContext.close();
      await refactorContext.close();
    }
  });

  test('separates WordPress test users, authenticated sessions, and REST nonces', async ({ browser }) => {
    if (!referenceUrl || !refactorUrl) {
      throw new Error('Set EASYMDE_VISUAL_REFERENCE_URL and EASYMDE_VISUAL_REFACTOR_URL.');
    }

    const referenceContext = await browser.newContext();
    const refactorContext = await browser.newContext();
    const referencePage = await referenceContext.newPage();
    const refactorPage = await refactorContext.newPage();

    try {
      const referenceIdentity = await logIn(
        referencePage,
        referenceUrl,
        'easymde-visual-administrator'
      );
      const refactorIdentity = await logIn(
        refactorPage,
        refactorUrl,
        'easymde-visual-restricted-author'
      );

      expect(referenceIdentity.displayName).toBe('Easymde Visual Administrator');
      expect(refactorIdentity.displayName).toBe('Easymde Visual Restricted Author');
      expect(referenceIdentity.nonce).not.toBe(refactorIdentity.nonce);

      const referenceOwnNonce = await requestPreview(
        referenceContext,
        referenceUrl,
        referenceIdentity.nonce
      );
      const refactorOwnNonce = await requestPreview(
        refactorContext,
        refactorUrl,
        refactorIdentity.nonce
      );
      expect(referenceOwnNonce.status()).toBe(200);
      expect(refactorOwnNonce.status()).toBe(200);

      const referenceCrossNonce = await requestPreview(
        referenceContext,
        referenceUrl,
        refactorIdentity.nonce
      );
      const refactorCrossNonce = await requestPreview(
        refactorContext,
        refactorUrl,
        referenceIdentity.nonce
      );
      expect(referenceCrossNonce.status()).toBe(403);
      expect(refactorCrossNonce.status()).toBe(403);
      expect((await referenceCrossNonce.json()).code).toBe('rest_cookie_invalid_nonce');
      expect((await refactorCrossNonce.json()).code).toBe('rest_cookie_invalid_nonce');

      const referenceSessionAtRefactor = await referenceContext.request.get(
        `${refactorUrl}/wp-admin/`,
        { maxRedirects: 0 }
      );
      const refactorSessionAtReference = await refactorContext.request.get(
        `${referenceUrl}/wp-admin/`,
        { maxRedirects: 0 }
      );
      expect(referenceSessionAtRefactor.status()).toBe(302);
      expect(refactorSessionAtReference.status()).toBe(302);
      expect(referenceSessionAtRefactor.headers().location).toContain('/wp-login.php');
      expect(refactorSessionAtReference.headers().location).toContain('/wp-login.php');
    } finally {
      await referenceContext.close();
      await refactorContext.close();
    }
  });
});
