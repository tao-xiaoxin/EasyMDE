import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const adminUser = process.env.WORDPRESS_ADMIN_USER || 'admin';
const adminPassword = process.env.WORDPRESS_ADMIN_PASSWORD || 'admin';
const fixtureMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const fixtureImage = readFileSync(
  new URL('../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);

async function login(page) {
  await page.goto('/wp-login.php');
  await page.locator('#loginform').evaluate((form, credentials) => {
    const username = form.elements.namedItem('log');
    const password = form.elements.namedItem('pwd');
    const submit = form.elements.namedItem('wp-submit');

    if (!(username instanceof HTMLInputElement)
      || !(password instanceof HTMLInputElement)
      || !(submit instanceof HTMLInputElement)) {
      throw new Error('WordPress login fields are unavailable.');
    }

    username.value = credentials.username;
    password.value = credentials.password;
    form.requestSubmit(submit);
  }, { username: adminUser, password: adminPassword });
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function selectTheme(page, combobox, label) {
  await combobox.focus();
  await page.keyboard.press('Enter');
  await expect(combobox).toHaveAttribute('aria-expanded', 'true');
  const listboxId = await combobox.getAttribute('aria-controls');
  if (!listboxId) throw new Error('Inkwell theme listbox is unavailable.');

  const options = page.locator(`[id=${JSON.stringify(listboxId)}] [role="option"]`);
  const labels = (await options.allTextContents()).map((item) => item.trim());
  const index = labels.indexOf(label);
  if (-1 === index) throw new Error(`Inkwell theme option is unavailable: ${label}`);

  await page.keyboard.press(index > (labels.length - 1) / 2 ? 'End' : 'Home');
  const startAtEnd = index > (labels.length - 1) / 2;
  const distance = startAtEnd ? labels.length - 1 - index : index;
  for (let step = 0; step < distance; step += 1) {
    await page.keyboard.press(startAtEnd ? 'ArrowUp' : 'ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toContainText(label);
}

test('matches the Inkwell README palettes across the full Markdown fixture', async ({ page }, testInfo) => {
  await login(page);
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();

  const fixtureImageUrl = new URL(
    '/easymde-e2e-fixtures/markdown-full-capability-image.png',
    page.url()
  ).href;
  await page.route(fixtureImageUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: fixtureImage
  }));
  const markdown = fixtureMarkdown.replace(
    /https:\/\/raw\.githubusercontent\.com\/tao-xiaoxin\/EasyMDE\/main\/docs\/assets\/easymde-logo-rounded\.png/g,
    fixtureImageUrl
  );
  const source = page.locator('.easymde-source-react .cm-content');
  const preview = page.locator('.easymde-pane-preview article');
  await source.fill(markdown);
  await expect(preview).toContainText('Markdown 全量能力测试文档');
  await expect(preview.locator('table').first()).toBeVisible();
  await expect(preview.locator('pre code').first()).toBeVisible();

  const strings = await page.evaluate(() => ({
    articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
    editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
  }));
  const trigger = page.locator('.easymde-toolbar-section-secondary')
    .getByRole('button', { name: strings.editorSettings, exact: true });
  const articleThemes = await page.evaluate(() => (
    window.EasyMDEEditorRootBootstrap.appearance.articleThemes
      .map(({ id, label }) => ({ id, label }))
  ));
  const expected = {
    inkwell: {
      background: 'rgb(255, 255, 255)',
      text: 'rgb(61, 72, 82)',
      heading: 'rgb(26, 35, 50)',
      quote: 'rgb(248, 250, 252)',
      table: 'rgb(241, 245, 249)',
      inlineCode: 'rgb(246, 248, 251)',
      inlineText: 'rgb(199, 37, 78)'
    },
    'inkwell-dark': {
      background: 'rgb(26, 32, 48)',
      text: 'rgb(196, 205, 216)',
      heading: 'rgb(237, 241, 247)',
      quote: 'rgb(30, 38, 54)',
      table: 'rgb(34, 44, 60)',
      inlineCode: 'rgb(36, 46, 66)',
      inlineText: 'rgb(240, 160, 184)'
    }
  };
  const evidence = [];

  for (const [id, contract] of Object.entries(expected)) {
    const registeredTheme = articleThemes.find((theme) => theme.id === id);
    if (!registeredTheme) throw new Error(`Registered Inkwell theme is unavailable: ${id}`);
    await page.setViewportSize({ width: 1200, height: 900 });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: strings.editorSettings });
    await selectTheme(page, dialog.getByRole('combobox', { name: strings.articleTheme, exact: true }), registeredTheme.label);
    await expect(preview).toHaveClass(new RegExp(`easymde-markdown-theme-${id}`));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const snapshot = await preview.evaluate((root) => {
      const style = getComputedStyle(root);
      const heading = root.querySelector('h1');
      const quote = root.querySelector('blockquote');
      const tableHeader = root.querySelector('thead');
      const inlineCode = root.querySelector('p code');
      const codeBlock = root.querySelector('pre');
      const rootBox = root.getBoundingClientRect();
      const visibleBlocks = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,blockquote,table,pre,img')];
      const maxRight = visibleBlocks.reduce(
        (right, element) => Math.max(right, element.getBoundingClientRect().right),
        rootBox.left
      );

      return {
        background: style.backgroundColor,
        text: style.color,
        heading: heading ? getComputedStyle(heading).color : null,
        quote: quote ? getComputedStyle(quote).backgroundColor : null,
        table: tableHeader ? getComputedStyle(tableHeader).backgroundColor : null,
        inlineCode: inlineCode ? getComputedStyle(inlineCode).backgroundColor : null,
        inlineText: inlineCode ? getComputedStyle(inlineCode).color : null,
        codeVisible: !!codeBlock && getComputedStyle(codeBlock).display !== 'none',
        overflow: root.scrollWidth - root.clientWidth,
        maxRightOverflow: Math.max(0, maxRight - rootBox.right)
      };
    });
    evidence.push({ id, width: 1200, ...snapshot });
    expect(snapshot).toMatchObject({
      background: contract.background,
      text: contract.text,
      heading: contract.heading,
      quote: contract.quote,
      table: contract.table,
      inlineCode: contract.inlineCode,
      inlineText: contract.inlineText,
      codeVisible: true,
      overflow: 0,
      maxRightOverflow: 0
    });

    await page.setViewportSize({ width: 680, height: 900 });
    const narrow = await preview.evaluate((root) => ({
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      paneScrollWidth: root.closest('.easymde-pane-preview')?.scrollWidth ?? -1
    }));
    evidence.push({ id, width: 680, ...narrow });
    expect(narrow.scrollWidth).toBe(narrow.clientWidth);
    expect(narrow.paneScrollWidth).toBeLessThanOrEqual(narrow.clientWidth + 1);
  }

  await testInfo.attach('inkwell-full-fixture-evidence.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json'
  });
});
