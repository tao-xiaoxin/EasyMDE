import { expect } from '@playwright/test';

export async function selectOrdinaryOption(page, combobox, optionLabel) {
  await combobox.click();
  await expect(combobox).toHaveAttribute('aria-expanded', 'true');
  const listboxId = await combobox.getAttribute('aria-controls');
  if (!listboxId) {
    throw new Error('ordinary-select-listbox-owner-unavailable');
  }

  const options = page.locator(`[id=${JSON.stringify(listboxId)}] [role="option"]`);
  await expect(options.first()).toBeAttached();
  const optionLabels = (await options.allTextContents()).map((label) => label.trim());
  const optionIndex = optionLabels.indexOf(optionLabel);
  if (-1 === optionIndex) {
    throw new Error(`ordinary-select-option-unavailable:${optionLabel}`);
  }

  // The menu option is the component's single commit boundary. Clicking it
  // keeps that real handler path while removing one Playwright round-trip for
  // every Home/Arrow key in the 46-theme visual matrix.
  await options.nth(optionIndex).click();
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toContainText(optionLabel);
}
