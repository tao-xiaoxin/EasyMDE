import { expect } from '@playwright/test';

export async function selectOrdinaryOption(
  page,
  combobox,
  optionLabel,
  { strategy = 'click' } = {}
) {
  if ('keyboard' === strategy) {
    await combobox.focus();
    await expect(combobox).toBeFocused();
    await page.keyboard.press('Enter');
  } else if ('click' === strategy) {
    await combobox.click();
  } else {
    throw new Error(`ordinary-select-strategy-unavailable:${strategy}`);
  }
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

  if ('keyboard' === strategy) {
    const lastOptionIndex = optionLabels.length - 1;
    const startAtEnd = optionIndex > lastOptionIndex / 2;
    const distance = startAtEnd
      ? lastOptionIndex - optionIndex
      : optionIndex;
    await page.keyboard.press(startAtEnd ? 'End' : 'Home');
    for (let index = 0; index < distance; index += 1) {
      await page.keyboard.press(startAtEnd ? 'ArrowUp' : 'ArrowDown');
    }
    const optionId = await options.nth(optionIndex).getAttribute('id');
    if (!optionId) {
      throw new Error('ordinary-select-option-id-unavailable');
    }
    await expect(combobox).toHaveAttribute('aria-activedescendant', optionId);
    await page.keyboard.press('Enter');
  } else {
    // The menu option is the component's single commit boundary. Clicking it
    // keeps that real handler path while removing one Playwright round-trip for
    // every Home/Arrow key in the 46-theme visual matrix.
    await options.nth(optionIndex).click();
  }
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toContainText(optionLabel);
}
