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
  const autoFocus = page.getByRole('switch', { name: '自动聚焦编辑器' });
  const saveButton = page.locator('.easymde-settings-center__save-bar > button');
  const initialValue = await autoFocus.getAttribute('aria-checked');

  try {
    await scrollContainer.evaluate((element) => {
      element.scrollTop = 58;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await autoFocus.click();
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
    await expect(page.locator('.easymde-settings-center__save-bar > span')).toHaveText('设置已保存。');
  } finally {
    const currentValue = await autoFocus.getAttribute('aria-checked');
    if (currentValue !== initialValue) {
      await autoFocus.click();
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveButton).toBeDisabled();
    }
  }
});
