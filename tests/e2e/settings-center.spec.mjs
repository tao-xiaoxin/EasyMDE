import { expect, test } from '@playwright/test';

const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or the process environment.`);
  }

  return value;
}

async function login(page) {
  await page.goto('/wp-login.php');
  if (await page.locator('#loginform').count() === 0) {
    return;
  }

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

test('keeps the settings save action clickable after scrolling', async ({ page }) => {
  await login(page);
  await page.goto('/wp-admin/admin.php?page=easymde/settings/general');
  await expect(page.locator('.easymde-settings-center')).toBeVisible();

  const scrollContainer = page.locator('.easymde-settings-center');
  const shortcutInput = page.locator(
    '[data-settings-section="shortcuts"] .easymde-settings-center__shortcut-row',
  ).first().locator('input').first();
  const saveButton = page.locator('.easymde-settings-center__save-bar > button');
  const saveStatus = page.locator('[data-save-status]');
  const initialValue = await shortcutInput.inputValue();
  const changedValue = 'Ctrl+Alt+Shift+E';

  await expect(shortcutInput).toBeEnabled();

  try {
    await shortcutInput.fill(changedValue);
    await scrollContainer.evaluate((element) => {
      element.scrollTop = 58;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(saveButton).toBeEnabled();
    await expect.poll(async () => saveButton.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )?.closest('.easymde-settings-center__save-bar > button') === button;
    })).toBe(true);

    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(saveStatus).toHaveAttribute('data-save-status', 'saved');

    await page.reload();
    await expect(page.locator('.easymde-settings-center')).toBeVisible();
    await expect(page.locator(
      '[data-settings-section="shortcuts"] .easymde-settings-center__shortcut-row',
    ).first().locator('input').first()).toHaveValue(changedValue);
  } finally {
    const currentValue = await shortcutInput.inputValue();
    if (currentValue !== initialValue) {
      await shortcutInput.fill(initialValue);
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveButton).toBeDisabled();
      await expect(saveStatus).toHaveAttribute('data-save-status', 'saved');
    }
  }
});

test('keeps the mobile settings center bounded and unavailable settings non-saveable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/wp-admin/admin.php?page=easymde/settings/general');

  const settingsCenter = page.locator('.easymde-settings-center');
  const saveButton = settingsCenter.locator('.easymde-settings-center__save-bar > button');
  const generalSection = settingsCenter.locator('[data-settings-section="general"]');
  const nav = settingsCenter.locator('.easymde-settings-center__sidebar nav');

  await expect(settingsCenter).toBeVisible();
  await expect.poll(async () => settingsCenter.evaluate((element) => (
    element.scrollWidth - element.clientWidth
  ))).toBeLessThanOrEqual(1);
  await expect.poll(async () => page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(1);

  const navIds = await nav.locator('button[data-nav-id]').evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute('data-nav-id'))
  ));
  expect(navIds).not.toContain('ai-comments');
  expect(navIds).not.toContain('ai-settings');
  expect(navIds).not.toContain('article-sync');
  await expect(nav).not.toContainText(/AI|comment|评论|article\s*sync|文章同步/i);

  await expect(generalSection.locator('fieldset[disabled]')).toHaveCount(3);
  await expect(generalSection.locator('[role="switch"]').first()).toBeEnabled();
  await expect(generalSection.locator('fieldset[disabled] select').first()).toBeDisabled();
  await expect(saveButton).toBeDisabled();
});
