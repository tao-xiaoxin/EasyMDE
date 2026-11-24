import { expect } from "@playwright/test";

const adminUser = requiredEnvironment("WORDPRESS_ADMIN_USER");
const adminPassword = requiredEnvironment("WORDPRESS_ADMIN_PASSWORD");

function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} must be set in the root .env or the process environment.`,
		);
	}

	return value;
}

export function expectNear(actual, expected, tolerance = 0.5) {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

export async function login(page) {
	await page.goto("/wp-login.php");
	if ((await page.locator("#loginform").count()) === 0) {
		return;
	}

	await page.locator("#loginform").evaluate(
		(form, credentials) => {
			const username = form.elements.namedItem("log");
			const password = form.elements.namedItem("pwd");
			const submit = form.elements.namedItem("wp-submit");
			if (
				!(username instanceof HTMLInputElement) ||
				!(password instanceof HTMLInputElement) ||
				!(submit instanceof HTMLInputElement)
			) {
				throw new Error("WordPress login fields are unavailable.");
			}

			username.value = credentials.username;
			password.value = credentials.password;
			form.requestSubmit(submit);
		},
		{ username: adminUser, password: adminPassword },
	);
	await expect(page.locator("#wpadminbar")).toBeVisible();
}

export async function saveSettingsCenter(page) {
	const saveButton = page.locator(
		".easymde-settings-center__save-bar > button",
	);
	if (!(await saveButton.isEnabled())) return;
	await saveButton.click();
	await expect(page.locator("[data-save-status]")).toHaveAttribute(
		"data-save-status",
		/saved|idle/u,
	);
	await expect(saveButton).toBeDisabled();
}

export async function openSettingsSection(page, section) {
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator(`button[data-nav-id="${section}"]`).click();
}

export async function readImageHostingEnabled(page) {
	await openSettingsSection(page, "images");
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const toggle = page.getByRole("switch", {
		name: strings.enableImageHosting,
		exact: true,
	});
	const value = await toggle.getAttribute("aria-checked");
	if (value !== "true" && value !== "false") {
		throw new Error("settings-center-image-hosting-state-missing");
	}

	return value === "true";
}

export async function setImageHostingEnabled(page, enabled) {
	if (typeof enabled !== "boolean") {
		throw new Error("settings-center-image-hosting-value-invalid");
	}

	await openSettingsSection(page, "images");
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const toggle = page.getByRole("switch", {
		name: strings.enableImageHosting,
		exact: true,
	});
	if ((await toggle.getAttribute("aria-checked")) === String(enabled)) return;
	await toggle.focus();
	await page.keyboard.press("Space");
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await saveSettingsCenter(page);
}

export async function readWechatPngExportEnabled(page) {
	await openSettingsSection(page, "images");
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const toggle = page.getByRole("switch", {
		name: strings.convertDiagramsAndFormulasToPng,
		exact: true,
	});
	const value = await toggle.getAttribute("aria-checked");
	if (value !== "true" && value !== "false") {
		throw new Error("settings-center-wechat-png-export-state-missing");
	}

	return value === "true";
}

export async function setWechatPngExportEnabled(page, enabled) {
	if (typeof enabled !== "boolean") {
		throw new Error("settings-center-wechat-png-export-value-invalid");
	}

	await openSettingsSection(page, "images");
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const toggle = page.getByRole("switch", {
		name: strings.convertDiagramsAndFormulasToPng,
		exact: true,
	});
	if ((await toggle.getAttribute("aria-checked")) === String(enabled)) return;
	await toggle.focus();
	await page.keyboard.press("Space");
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await saveSettingsCenter(page);
}

export async function selectSettingsOption(page, label, optionLabel) {
	const trigger = page.getByRole("combobox", { name: label, exact: true });
	if ((await trigger.textContent())?.trim() === optionLabel) return;
	await trigger.click();
	const listbox = page.getByRole("listbox", { name: label, exact: true });
	await expect(listbox).toBeVisible();
	await listbox.getByRole("option", { name: optionLabel, exact: true }).click();
	await expect(trigger).toHaveText(optionLabel);
}

export async function resetSettingsCenterDefaults(page) {
	await openSettingsSection(page, "transfer");
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	await page
		.locator(".easymde-settings-center__transfer-management button")
		.filter({ hasText: strings.transferResetCurrentConfiguration })
		.click();
	const dialog = page.getByRole("dialog", {
		name: strings.transferResetCurrentConfiguration,
		exact: true,
	});
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole("button", { name: strings.transferConfirmReset, exact: true })
		.click();
	await saveSettingsCenter(page);
}

export async function resetSettingsAndRestoreImageHosting(page, originalEnabled) {
	let resetError;
	try {
		await resetSettingsCenterDefaults(page);
	} catch (error) {
		resetError = error;
	}

	let restoreError;
	if (typeof originalEnabled === "boolean") {
		try {
			await setImageHostingEnabled(page, originalEnabled);
		} catch (error) {
			restoreError = error;
		}
	}

	if (resetError && restoreError) {
		throw new AggregateError(
			[resetError, restoreError],
			"Settings reset and image-hosting restoration failed.",
		);
	}
	if (resetError) throw resetError;
	if (restoreError) throw restoreError;
}

export async function setRemoteImageUploadMode(page, mode) {
	await openSettingsSection(page, "images");
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const optionLabels = {
		both: strings.remoteImageUploadBoth,
		off: strings.remoteImageUploadOff,
		source: strings.remoteImageUploadSource,
		visual: strings.remoteImageUploadVisual,
	};
	await selectSettingsOption(
		page,
		strings.remoteImageUploadMode,
		optionLabels[mode],
	);
	await saveSettingsCenter(page);
	return {
		label: strings.remoteImageUploadMode,
		optionLabel: optionLabels[mode],
	};
}

export async function dispatchBrowserPaste(target, { html = "", plainText }) {
	await target.evaluate(
		(element, { htmlValue, plainTextValue }) => {
			const transfer = new DataTransfer();
			transfer.setData("text/plain", plainTextValue);
			if (htmlValue) {
				transfer.setData("text/html", htmlValue);
			}
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: transfer,
				}),
			);
		},
		{ htmlValue: html, plainTextValue: plainText },
	);
}

export async function expectRemovedSettingsPage(
	page,
	path,
	{ status, message, assertNoOptionsForm = true },
) {
	const response = await page.goto(path);

	expect(response?.status()).toBe(status);
	expect(page.url()).toContain(path);
	await expect(page.locator(".easymde-settings-center")).toHaveCount(0);
	if (assertNoOptionsForm) {
		await expect(page.locator('form[action="options.php"]')).toHaveCount(0);
	}
	await expect(page.locator(".easymde-settings-shortcuts")).toHaveCount(0);
	await expect(page.locator('script[src*="settings-center"]')).toHaveCount(0);
	await expect(page.locator('link[href*="settings-center"]')).toHaveCount(0);
	await expect(
		page.locator('link[href*="/assets/css/admin/settings.css"]'),
	).toHaveCount(0);
	if (message) {
		await expect(page.locator("body")).toContainText(message);
	}
}
