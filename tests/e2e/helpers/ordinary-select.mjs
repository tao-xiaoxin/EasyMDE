import { expect } from '@playwright/test';

export async function selectOrdinaryOption(page, combobox, optionLabel) {
  await combobox.focus();
  await expect(combobox).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(combobox).toHaveAttribute('aria-expanded', 'true');
  const listboxId = await combobox.getAttribute('aria-controls');
  if (!listboxId) {
    throw new Error('ordinary-select-listbox-owner-unavailable');
  }

  const options = page.locator(`[id=${JSON.stringify(listboxId)}] [role="option"]`);
  const optionLabels = (await options.allTextContents()).map((label) => label.trim());
  const optionIndex = optionLabels.indexOf(optionLabel);
  if (-1 === optionIndex) {
    throw new Error(`ordinary-select-option-unavailable:${optionLabel}`);
  }

  const lastOptionIndex = optionLabels.length - 1;
  const startAtEnd = optionIndex > lastOptionIndex / 2;
  await page.keyboard.press(startAtEnd ? 'End' : 'Home');
  const distance = startAtEnd
    ? lastOptionIndex - optionIndex
    : optionIndex;
  for (let index = 0; index < distance; index += 1) {
    await page.keyboard.press(startAtEnd ? 'ArrowUp' : 'ArrowDown');
  }

  const optionId = await options.nth(optionIndex).getAttribute('id');
  if (!optionId) {
    throw new Error('ordinary-select-option-id-unavailable');
  }
  await expect(combobox).toHaveAttribute('aria-activedescendant', optionId);
  await page.keyboard.press('Enter');
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toContainText(optionLabel);
}
