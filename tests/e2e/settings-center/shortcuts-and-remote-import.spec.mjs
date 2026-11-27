import { expect, test } from "@playwright/test";
import {
	dispatchBrowserPaste,
	login,
	openSettingsSection,
	readImageHostingEnabled,
	resetSettingsAndRestoreImageHosting,
	resetSettingsCenterDefaults,
	saveSettingsCenter,
	selectSettingsOption,
	setImageHostingEnabled,
	setRemoteImageUploadMode,
} from "../helpers/settings-center-helpers.mjs";

test("records, persists, and executes a customized shortcut through real keyboard events", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="shortcuts"]').click();

	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const saveButton = page.locator(
		".easymde-settings-center__save-bar > button",
	);
	const saveStatus = page.locator("[data-save-status]");
	const resetButton = page.getByRole("button", {
		name: strings.restoreDefaultShortcuts,
		exact: true,
	});
	const headingThreeRow = () =>
		page.locator(
			`[data-settings-section="shortcuts"] [data-setting-label="${strings.headingThree}"]`,
		);
	const windowsRecorder = () =>
		headingThreeRow()
			.locator(".easymde-settings-center__shortcut-recorder")
			.first();
	const macRecorder = () =>
		headingThreeRow()
			.locator(".easymde-settings-center__shortcut-recorder")
			.nth(1);
	const isMac = await page.evaluate(() => navigator.platform.startsWith("Mac"));
	const recorder = isMac ? macRecorder : windowsRecorder;
	const recordedShortcut = isMac
		? { press: "Meta+Alt+9", labels: ["Cmd", "Option", "9"] }
		: { press: "Control+Alt+9", labels: ["Ctrl", "Alt", "9"] };
	const displayedShortcut = recordedShortcut.labels.join("+");
	const defaultDisplayedShortcut = isMac ? "Cmd+3" : "Ctrl+3";
	const clearButton = () =>
		headingThreeRow()
			.locator(".easymde-settings-center__shortcut-clear")
			.nth(isMac ? 1 : 0);
	const save = async () => {
		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(saveStatus).toHaveAttribute("data-save-status", /saved|idle/u);
		await expect(saveButton).toBeDisabled();
	};
	const expectShortcutFits = async (menu, shortcut) => {
		const geometry = await menu.evaluate((element, shortcutSelector) => {
			const shortcutElement = element.querySelector(shortcutSelector);
			if (!(shortcutElement instanceof HTMLElement)) return null;
			const menuBounds = element.getBoundingClientRect();
			const shortcutBounds = shortcutElement.getBoundingClientRect();
			return {
				menuLeft: menuBounds.left,
				menuRight: menuBounds.right,
				shortcutLeft: shortcutBounds.left,
				shortcutRight: shortcutBounds.right,
				viewportWidth: window.innerWidth,
			};
		}, shortcut);
		if (!geometry) {
			throw new Error("The shortcut geometry could not be measured.");
		}
		expect(geometry.menuLeft).toBeGreaterThanOrEqual(12);
		expect(geometry.menuRight).toBeLessThanOrEqual(geometry.viewportWidth - 12);
		expect(geometry.shortcutLeft).toBeGreaterThanOrEqual(geometry.menuLeft);
		expect(geometry.shortcutRight).toBeLessThanOrEqual(geometry.menuRight);
	};
	try {
		await resetButton.click();
		if (await saveButton.isEnabled()) await save();
		await expect(windowsRecorder().locator("kbd")).toHaveText(["Ctrl", "3"]);
		await expect(macRecorder().locator("kbd")).toHaveText(["Cmd", "3"]);

		await recorder().click();
		await expect(recorder()).toHaveAttribute("data-recording", "true");
		await page.keyboard.press(recordedShortcut.press);
		await expect(recorder()).not.toHaveAttribute("data-recording", "true");
		await expect(recorder().locator("kbd")).toHaveText(recordedShortcut.labels);
		await expect(headingThreeRow().locator("input")).toHaveCount(0);
		await save();

		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await expect(recorder().locator("kbd")).toHaveText(recordedShortcut.labels);

		await page.setViewportSize({ width: 480, height: 720 });
		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const source = page.locator("#easymde-source");
		const sourceEditor = page.locator(".easymde-source-react .cm-content");
		const headingLabel = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings,
		);
		const headingTrigger = page.getByRole("button", {
			name: headingLabel,
			exact: true,
		});
		const headingMenu = page.getByRole("menu", {
			name: headingLabel,
			exact: true,
			includeHidden: true,
		});
		const headingThreeItem = headingMenu.locator(
			'[data-easymde-command="heading3"]',
		);
		await expect(headingTrigger).toHaveAttribute("title", headingLabel);
		await headingTrigger.click();
		await expect(headingMenu).toBeVisible();
		await expect(
			headingThreeItem.locator(".easymde-popover-item-shortcut"),
		).toHaveText(displayedShortcut);
		await expectShortcutFits(
			headingMenu,
			'[data-easymde-command="heading3"] .easymde-popover-item-shortcut',
		);
		await page.keyboard.press("Escape");

		await sourceEditor.fill("Alpha");
		await sourceEditor.focus();
		await page.keyboard.press(recordedShortcut.press);
		await expect(source).toHaveValue("### Alpha");
		await expect(sourceEditor.locator(".cm-line")).toHaveText("### Alpha");

		await page.locator(".easymde-toolbar-immersive-toggle").click();
		const immersiveHeadingTrigger = page.locator(
			".easymde-immersive-formatting .easymde-toolbar-popover-headings > button",
		);
		const immersiveHeadingMenu = page.locator(".is-immersive-heading-menu");
		const immersiveHeadingThreeItem = immersiveHeadingMenu.locator(
			'[data-easymde-command="heading3"]',
		);
		await expect(immersiveHeadingTrigger).toHaveAttribute(
			"title",
			headingLabel,
		);
		await immersiveHeadingTrigger.click();
		await expect(immersiveHeadingMenu).toBeVisible();
		await expect(
			immersiveHeadingThreeItem.locator(".easymde-popover-item-shortcut"),
		).toHaveText(displayedShortcut);
		await expectShortcutFits(
			immersiveHeadingMenu,
			'[data-easymde-command="heading3"] .easymde-popover-item-shortcut',
		);

		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="shortcuts"]').click();
		await clearButton().click();
		await expect(recorder().locator("kbd")).toHaveCount(0);
		await save();

		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const clearedSource = page.locator("#easymde-source");
		const clearedSourceEditor = page.locator(
			".easymde-source-react .cm-content",
		);
		const clearedHeadingTrigger = page.getByRole("button", {
			name: headingLabel,
			exact: true,
		});
		const clearedHeadingMenu = page.getByRole("menu", {
			name: headingLabel,
			exact: true,
			includeHidden: true,
		});
		await clearedHeadingTrigger.click();
		await expect(clearedHeadingMenu).toBeVisible();
		await expect(
			clearedHeadingMenu
				.locator('[data-easymde-command="heading3"]')
				.locator(".easymde-popover-item-shortcut"),
		).toHaveCount(0);
		await page.keyboard.press("Escape");
		await clearedSourceEditor.fill("Beta");
		await clearedSourceEditor.focus();
		await page.keyboard.press(recordedShortcut.press);
		await expect(clearedSource).toHaveValue("Beta");

		await page.locator(".easymde-toolbar-immersive-toggle").click();
		const clearedImmersiveHeadingTrigger = page.locator(
			".easymde-immersive-formatting .easymde-toolbar-popover-headings > button",
		);
		const clearedImmersiveHeadingMenu = page.locator(
			".is-immersive-heading-menu",
		);
		await expect(clearedImmersiveHeadingTrigger).toHaveAttribute(
			"title",
			headingLabel,
		);
		await clearedImmersiveHeadingTrigger.click();
		await expect(clearedImmersiveHeadingMenu).toBeVisible();
		await expect(
			clearedImmersiveHeadingMenu
				.locator('[data-easymde-command="heading3"]')
				.locator(".easymde-popover-item-shortcut"),
		).toHaveCount(0);
	} finally {
		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="shortcuts"]').click();
		await resetButton.click();
		if (await saveButton.isEnabled()) await save();
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="shortcuts"]').click();
		await expect(windowsRecorder().locator("kbd")).toHaveText(["Ctrl", "3"]);
		await expect(macRecorder().locator("kbd")).toHaveText(["Cmd", "3"]);

		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const headingLabel = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings,
		);
		const headingTrigger = page.getByRole("button", {
			name: headingLabel,
			exact: true,
		});
		const headingMenu = page.getByRole("menu", {
			name: headingLabel,
			exact: true,
			includeHidden: true,
		});
		await headingTrigger.click();
		await expect(headingMenu).toBeVisible();
		await expect(
			headingMenu
				.locator('[data-easymde-command="heading3"]')
				.locator(".easymde-popover-item-shortcut"),
		).toHaveText(defaultDisplayedShortcut);
		await page.keyboard.press("Escape");

		await page.locator(".easymde-toolbar-immersive-toggle").click();
		const immersiveHeadingTrigger = page.locator(
			".easymde-immersive-formatting .easymde-toolbar-popover-headings > button",
		);
		const immersiveHeadingMenu = page.locator(".is-immersive-heading-menu");
		await immersiveHeadingTrigger.click();
		await expect(immersiveHeadingMenu).toBeVisible();
		await expect(
			immersiveHeadingMenu
				.locator('[data-easymde-command="heading3"]')
				.locator(".easymde-popover-item-shortcut"),
		).toHaveText(defaultDisplayedShortcut);
	}
});

test("blocks a same-platform shortcut conflict without sending or persisting it", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="shortcuts"]').click();

	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const shortcutSection = page.locator('[data-settings-section="shortcuts"]');
	const row = (label) =>
		shortcutSection.locator(`[data-setting-label="${label}"]`);
	const windowsRecorder = (label) =>
		row(label).locator(".easymde-settings-center__shortcut-recorder").first();
	const saveButton = page.getByRole("button", {
		name: strings.saveSettings,
		exact: true,
	});
	const settingsPosts = [];
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname.endsWith("/easymde/v1/settings")
		) {
			settingsPosts.push(request.url());
		}
	});

	await windowsRecorder(strings.bold).click();
	await page.keyboard.press("Control+S");
	await expect(windowsRecorder(strings.bold)).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(windowsRecorder(strings.saveArticle)).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await saveButton.click();
	const dialog = page.getByRole("alertdialog", {
		name: strings.shortcutConflictTitle,
		exact: true,
	});
	await expect(dialog).toBeVisible();
	expect(settingsPosts).toHaveLength(0);
	await dialog
		.getByRole("button", {
			name: strings.returnToShortcutSettings,
			exact: true,
		})
		.click();
	await expect(saveButton).toBeFocused();

	await page.reload();
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await expect(windowsRecorder(strings.bold).locator("kbd")).toHaveText([
		"Ctrl",
		"B",
	]);
});

test("persists all remote image import modes and resets the documented defaults", async ({
	page,
}) => {
	await login(page);
	let originalImageHostingEnabled;
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await resetSettingsCenterDefaults(page);
		await setImageHostingEnabled(page, true);
		await openSettingsSection(page, "general");
		const generalDefaults = await page.evaluate(() => ({
			autoSaveInterval:
				window.EasyMDESettingsCenterBootstrap.settings.general.autoSaveInterval,
			label: window.EasyMDESettingsCenterBootstrap.strings.autoSaveInterval,
		}));
		expect(generalDefaults.autoSaveInterval).toBe("30");
		await expect(
			page.getByRole("combobox", {
				name: generalDefaults.label,
				exact: true,
			}),
		).toContainText("30");

		await openSettingsSection(page, "images");
		const strings = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings,
		);
		await expect(
			page.getByRole("spinbutton", {
				name: strings.uploadRetryCount,
				exact: true,
			}),
		).toHaveValue("0");
		await expect(
			page.getByRole("combobox", {
				name: strings.imageTitleDisplay,
				exact: true,
			}),
		).toHaveText(strings.leaveEmpty);
		await expect(
			page.getByRole("textbox", {
				name: strings.storagePath,
				exact: true,
			}),
		).toHaveValue("{year}/{month}");
		await expect(
			page.getByRole("textbox", {
				name: strings.fileNameRule,
				exact: true,
			}),
		).toHaveValue("{md5}");
		await expect(
			page.getByRole("button", {
				name: strings.fileNamePresetMd5,
				exact: true,
			}),
		).toHaveAttribute("aria-pressed", "true");
		expect(strings.fileNamePresetYearMonth).toMatch(
			/Year and Month Directory|年\/月目录/u,
		);
		expect(strings.fileNamePresetArticle).toMatch(
			/Article Directory|文章目录/u,
		);

		for (const mode of ["both", "visual", "source", "off"]) {
			const selected = await setRemoteImageUploadMode(page, mode);
			await page.reload();
			await expect(page.locator(".easymde-settings-center")).toBeVisible();
			await page.locator('button[data-nav-id="images"]').click();
			await expect(
				page.getByRole("combobox", {
					name: selected.label,
					exact: true,
				}),
			).toHaveText(selected.optionLabel);
		}

		await resetSettingsCenterDefaults(page);
		await setImageHostingEnabled(page, true);
		await openSettingsSection(page, "images");
		await expect(
			page.getByRole("combobox", {
				name: strings.remoteImageUploadMode,
				exact: true,
			}),
		).toHaveText(strings.remoteImageUploadBoth);
		await expect(
			page.getByRole("spinbutton", {
				name: strings.uploadRetryCount,
				exact: true,
			}),
		).toHaveValue("0");
	} finally {
		await resetSettingsAndRestoreImageHosting(
			page,
			originalImageHostingEnabled,
		);
	}
});

test("imports source Markdown images only for source-enabled modes", async ({
	page,
}) => {
	await login(page);
	const importRequests = [];
	let originalImageHostingEnabled;
	await page.route(
		"**/wp-json/easymde/v1/image-hosting/import*",
		async (route) => {
			const body = route.request().postDataJSON();
			const importedUrl = `https://media.synthetic.test/source-${importRequests.length + 1}.png`;
			importRequests.push({ body, importedUrl });
			await route.fulfill({
				contentType: "application/json",
				json: {
					alt: body.alt_text,
					backup: { status: "disabled" },
					status: "imported",
					title: "source-import.png",
					url: importedUrl,
				},
				status: 200,
			});
		},
	);
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await resetSettingsCenterDefaults(page);
		await setImageHostingEnabled(page, true);
		for (const mode of ["source", "both"]) {
			await setRemoteImageUploadMode(page, mode);
			await page.goto("/wp-admin/post-new.php");
			await expect(page.locator("#easymde-editor")).toBeVisible();
			const source = page.locator("#easymde-source");
			const sourceEditor = page.locator(".easymde-source-react .cm-content");
			const postId = Number(await page.locator("#post_ID").inputValue());
			const originalUrl = `https://source.synthetic.test/${mode}.png`;
			const altText = `Remote ${mode}`;
			const markdown = `![${altText}](${originalUrl})`;
			const previousRequestCount = importRequests.length;
			await sourceEditor.fill("Before ");
			await sourceEditor.focus();
			await sourceEditor.press("End");
			await dispatchBrowserPaste(sourceEditor, { plainText: markdown });
			await expect
				.poll(() => importRequests.length)
				.toBe(previousRequestCount + 1);
			const imported = importRequests.at(-1);
			expect(imported.body).toEqual({
				alt_text: altText,
				post_id: postId,
				url: originalUrl,
			});
			await expect(source).toHaveValue(
				`Before ![${altText}](${imported.importedUrl})`,
			);
		}

		for (const mode of ["off", "visual"]) {
			await setRemoteImageUploadMode(page, mode);
			await page.goto("/wp-admin/post-new.php");
			await expect(page.locator("#easymde-editor")).toBeVisible();
			const source = page.locator("#easymde-source");
			const sourceEditor = page.locator(".easymde-source-react .cm-content");
			const markdown = `![Keep ${mode}](https://source.synthetic.test/${mode}.png)`;
			const previousRequestCount = importRequests.length;
			await sourceEditor.fill("Before ");
			await sourceEditor.focus();
			await sourceEditor.press("End");
			await dispatchBrowserPaste(sourceEditor, { plainText: markdown });
			await expect(source).toHaveValue(`Before ${markdown}`);
			await page.waitForTimeout(300);
			expect(importRequests).toHaveLength(previousRequestCount);
		}
	} finally {
		await resetSettingsAndRestoreImageHosting(
			page,
			originalImageHostingEnabled,
		);
	}
});

test("imports a single visual HTML image only for visual-enabled modes", async ({
	page,
}) => {
	await login(page);
	const importRequests = [];
	let originalImageHostingEnabled;
	await page.route(
		"**/wp-json/easymde/v1/image-hosting/import*",
		async (route) => {
			const body = route.request().postDataJSON();
			const importedUrl = `https://media.synthetic.test/visual-${importRequests.length + 1}.png`;
			importRequests.push({ body, importedUrl });
			await route.fulfill({
				contentType: "application/json",
				json: {
					alt: body.alt_text,
					backup: { status: "disabled" },
					status: "imported",
					title: "visual-import.png",
					url: importedUrl,
				},
				status: 200,
			});
		},
	);
	const openVisualEditor = async () => {
		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		await page
			.locator(".easymde-source-react .cm-content")
			.fill("Visual baseline");
		const strings = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.strings.immersive,
		);
		await page.locator(".easymde-toolbar-immersive-toggle").click();
		await page
			.getByRole("button", { name: strings.preview, exact: true })
			.click();
		const unlock = page.getByRole("button", {
			name: strings.previewUnlockEdit,
			exact: true,
		});
		await expect(unlock).toBeEnabled();
		await unlock.click();
		const visualEditor = page.getByRole("textbox", {
			name: strings.previewEditorLabel,
			exact: true,
		});
		await expect(visualEditor).toHaveAttribute("contenteditable", "true");
		await visualEditor.evaluate((element) => {
			const selection = element.ownerDocument.getSelection();
			const range = element.ownerDocument.createRange();
			range.selectNodeContents(element);
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
			element.focus();
		});
		return visualEditor;
	};
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await resetSettingsCenterDefaults(page);
		await setImageHostingEnabled(page, true);
		await setRemoteImageUploadMode(page, "visual");
		const visualEditor = await openVisualEditor();
		const postId = Number(await page.locator("#post_ID").inputValue());
		const originalUrl = "https://source.synthetic.test/visual.png";
		const altText = "Visual remote";
		await dispatchBrowserPaste(visualEditor, {
			html: `<img alt="${altText}" src="${originalUrl}">`,
			plainText: originalUrl,
		});
		await expect.poll(() => importRequests.length).toBe(1);
		expect(importRequests[0].body).toEqual({
			alt_text: altText,
			post_id: postId,
			url: originalUrl,
		});
		await expect
			.poll(() => page.locator("#easymde-source").inputValue())
			.toContain(`![${altText}](${importRequests[0].importedUrl})`);

		await setRemoteImageUploadMode(page, "source");
		const sourceOnlyVisualEditor = await openVisualEditor();
		const previousRequestCount = importRequests.length;
		const sourceOnlyUrl = "https://source.synthetic.test/source-only.png";
		await dispatchBrowserPaste(sourceOnlyVisualEditor, {
			html: `<img alt="Source only" src="${sourceOnlyUrl}">`,
			plainText: sourceOnlyUrl,
		});
		await page.waitForTimeout(300);
		expect(importRequests).toHaveLength(previousRequestCount);
	} finally {
		await resetSettingsAndRestoreImageHosting(
			page,
			originalImageHostingEnabled,
		);
	}
});

test("keeps exact primary-domain remote images unchanged without bypassing origin boundaries", async ({
	page,
}) => {
	await login(page);
	let originalDomain = null;
	let originalMode = null;
	let originalImageHostingEnabled;
	let settingsStrings = null;
	const primaryOrigin = "https://images.example.test";
	const sourceImageUrl = `${primaryOrigin}/already-source.png`;
	const visualImageUrl = `${primaryOrigin}/already-visual.png`;
	const schemeMismatchUrl =
		"http://images.example.test/not-the-primary-origin.png";
	const waitForRealImport = () =>
		page.waitForResponse((response) => {
			const request = response.request();
			return (
				request.method() === "POST" &&
				new URL(response.url()).pathname.endsWith(
					"/easymde/v1/image-hosting/import",
				)
			);
		});
	const expectAlreadyHostedStatus = async () => {
		const strings = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.imageUpload.strings,
		);
		expect(strings.pasteAlreadyHosted).toEqual(expect.any(String));
		await expect(
			page.getByRole("status").filter({ hasText: strings.pasteAlreadyHosted }),
		).toBeVisible();
		await expect(
			page.getByRole("status").filter({ hasText: strings.pasteUploaded }),
		).toHaveCount(0);
	};
	const openVisualEditor = async () => {
		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		await page
			.locator(".easymde-source-react .cm-content")
			.fill("Visual baseline");
		const strings = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.strings.immersive,
		);
		await page.locator(".easymde-toolbar-immersive-toggle").click();
		await page
			.getByRole("button", { name: strings.preview, exact: true })
			.click();
		const unlock = page.getByRole("button", {
			name: strings.previewUnlockEdit,
			exact: true,
		});
		await expect(unlock).toBeEnabled();
		await unlock.click();
		const visualEditor = page.getByRole("textbox", {
			name: strings.previewEditorLabel,
			exact: true,
		});
		await expect(visualEditor).toHaveAttribute("contenteditable", "true");
		await visualEditor.evaluate((element) => {
			const selection = element.ownerDocument.getSelection();
			const range = element.ownerDocument.createRange();
			range.selectNodeContents(element);
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
			element.focus();
		});
		return visualEditor;
	};
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await setImageHostingEnabled(page, true);
		await openSettingsSection(page, "images");
		settingsStrings = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings,
		);
		originalMode = await page.evaluate(
			() =>
				window.EasyMDESettingsCenterBootstrap.settings.images
					.remoteImageUploadMode,
		);
		const primary = page.locator(
			'[data-settings-section="images"] .is-host-service',
		);
		const domain = primary.getByRole("textbox", {
			name: settingsStrings.imageFallbackDomain,
			exact: true,
		});
		originalDomain = await domain.inputValue();
		await domain.fill(primaryOrigin);
		await selectSettingsOption(
			page,
			settingsStrings.remoteImageUploadMode,
			settingsStrings.remoteImageUploadBoth,
		);
		await saveSettingsCenter(page);

		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const source = page.locator("#easymde-source");
		const sourceEditor = page.locator(".easymde-source-react .cm-content");
		const sourceAlt = "Already hosted source";
		const sourceMarkdown = `![${sourceAlt}](${sourceImageUrl})`;
		const sourcePostId = Number(await page.locator("#post_ID").inputValue());
		expect(sourcePostId).toBeGreaterThan(0);
		await sourceEditor.fill("Before ");
		await sourceEditor.focus();
		await sourceEditor.press("End");
		const sourceResponsePromise = waitForRealImport();
		await dispatchBrowserPaste(sourceEditor, { plainText: sourceMarkdown });
		const sourceResponse = await sourceResponsePromise;
		expect(sourceResponse.status()).toBe(200);
		expect(sourceResponse.request().postDataJSON()).toEqual({
			alt_text: sourceAlt,
			post_id: sourcePostId,
			url: sourceImageUrl,
		});
		expect(await sourceResponse.json()).toMatchObject({
			status: "unchanged",
			url: sourceImageUrl,
		});
		await expect(source).toHaveValue(`Before ${sourceMarkdown}`);
		await expectAlreadyHostedStatus();

		const visualEditor = await openVisualEditor();
		const visualAlt = "Already hosted visual";
		const visualPostId = Number(await page.locator("#post_ID").inputValue());
		expect(visualPostId).toBeGreaterThan(0);
		await visualEditor.focus();
		const visualResponsePromise = waitForRealImport();
		await dispatchBrowserPaste(visualEditor, {
			html: `<img alt="${visualAlt}" src="${visualImageUrl}">`,
			plainText: visualImageUrl,
		});
		const visualResponse = await visualResponsePromise;
		expect(visualResponse.status()).toBe(200);
		expect(visualResponse.request().postDataJSON()).toEqual({
			alt_text: visualAlt,
			post_id: visualPostId,
			url: visualImageUrl,
		});
		expect(await visualResponse.json()).toMatchObject({
			status: "unchanged",
			url: visualImageUrl,
		});
		await expect
			.poll(() => page.locator("#easymde-source").inputValue())
			.toContain(`![${visualAlt}](${visualImageUrl})`);
		await expectAlreadyHostedStatus();

		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const boundarySource = page.locator("#easymde-source");
		const boundaryEditor = page.locator(".easymde-source-react .cm-content");
		const boundaryAlt = "Scheme mismatch";
		const boundaryMarkdown = `![${boundaryAlt}](${schemeMismatchUrl})`;
		const boundaryPostId = Number(await page.locator("#post_ID").inputValue());
		expect(boundaryPostId).toBeGreaterThan(0);
		await boundaryEditor.focus();
		const boundaryResponsePromise = waitForRealImport();
		await dispatchBrowserPaste(boundaryEditor, {
			plainText: boundaryMarkdown,
		});
		const boundaryResponse = await boundaryResponsePromise;
		expect(boundaryResponse.request().postDataJSON()).toEqual({
			alt_text: boundaryAlt,
			post_id: boundaryPostId,
			url: schemeMismatchUrl,
		});
		expect(boundaryResponse.ok()).toBe(false);
		expect((await boundaryResponse.json()).status).not.toBe("unchanged");
		await expect(boundarySource).toHaveValue(boundaryMarkdown);
		const pasteFailed = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.pasteFailed,
		);
		await expect(
			page.getByRole("alert").filter({ hasText: pasteFailed }),
		).toBeVisible();
	} finally {
		if (
			originalDomain !== null &&
			originalMode !== null &&
			settingsStrings !== null
		) {
			await setImageHostingEnabled(page, true);
			await openSettingsSection(page, "images");
			const primary = page.locator(
				'[data-settings-section="images"] .is-host-service',
			);
			await primary
				.getByRole("textbox", {
					name: settingsStrings.imageFallbackDomain,
					exact: true,
				})
				.fill(originalDomain);
			const originalModeLabels = {
				both: settingsStrings.remoteImageUploadBoth,
				off: settingsStrings.remoteImageUploadOff,
				source: settingsStrings.remoteImageUploadSource,
				visual: settingsStrings.remoteImageUploadVisual,
			};
			await selectSettingsOption(
				page,
				settingsStrings.remoteImageUploadMode,
				originalModeLabels[originalMode],
			);
			await saveSettingsCenter(page);
			await page.reload();
			await expect(page.locator(".easymde-settings-center")).toBeVisible();
			await page.locator('button[data-nav-id="images"]').click();
			await expect(
				primary.getByRole("textbox", {
					name: settingsStrings.imageFallbackDomain,
					exact: true,
				}),
			).toHaveValue(originalDomain);
		}
		if (typeof originalImageHostingEnabled === "boolean") {
			await setImageHostingEnabled(page, originalImageHostingEnabled);
		}
	}
});
