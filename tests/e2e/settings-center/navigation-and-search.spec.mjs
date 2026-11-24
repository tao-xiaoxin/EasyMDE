import { expect, test } from "@playwright/test";
import { login } from "../helpers/settings-center-helpers.mjs";

test("keeps the EasyMDE menu logo inside the native icon slot", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/profile.php");

	const menuItem = page.locator("#toplevel_page_easymde");
	const iconSlot = menuItem.locator("> a > .wp-menu-image");
	const logo = iconSlot.locator("img");

	await expect(menuItem).toBeVisible();
	await expect(menuItem.locator("> a")).toHaveAttribute(
		"href",
		/admin\.php\?page=easymde&route=\/general_setting$/u,
	);
	await expect(logo).toHaveAttribute(
		"src",
		/assets\/images\/easymde-editor-icon\.png$/u,
	);
	await expect(page.locator("#wpwrap")).toBeVisible();
	await expect(page.locator("#easymde-settings-center-root")).toHaveCount(0);
	await expect(
		page.locator('script[src*="/assets/build/settings-center/"]'),
	).toHaveCount(0);
	await expect(
		page.locator('link[href*="/assets/css/admin/settings-center.css"]'),
	).toHaveCount(0);
	await expect
		.poll(async () => {
			const slot = await iconSlot.boundingBox();
			const image = await logo.boundingBox();
			if (!slot || !image) {
				return false;
			}

			return (
				image.width <= 20 &&
				image.height <= 20 &&
				image.x >= slot.x &&
				image.y >= slot.y &&
				image.x + image.width <= slot.x + slot.width &&
				image.y + image.height <= slot.y + slot.height
			);
		})
		.toBe(true);

	await menuItem.hover();
	await expect(menuItem).toHaveClass(/opensub/u);
	await expect(menuItem.locator(".wp-submenu")).toBeVisible();
});

test("opens the native plugin updates list from the EasyMDE submenu", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/profile.php");

	const menuItem = page.locator("#toplevel_page_easymde");
	await menuItem.hover();
	const updatesLink = menuItem.locator(
		'.wp-submenu a[href*="plugins.php?plugin_status=upgrade"]',
	);

	await expect(updatesLink).toHaveText(/^(?:更新|Updates)$/u);
	await updatesLink.click();
	await expect(page).toHaveURL(
		/\/wp-admin\/plugins\.php\?plugin_status=upgrade$/u,
	);
	await expect(page.locator("#wpbody-content h1")).toHaveText(
		/^\s*(?:插件|Plugins)\s*$/u,
	);
	const activePluginFilter = page.locator(".subsubsub a.current");
	await expect(activePluginFilter).toHaveCount(1);
	const activeFilterText = await activePluginFilter.textContent();
	expect(activeFilterText).toMatch(
		/(?:可供更新|全部|Update Available|Available updates|All)/iu,
	);
});

test("opens the settings center through the explicit General route", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/profile.php");

	const menuItem = page.locator("#toplevel_page_easymde");
	await menuItem.locator("> a").click();
	await expect(page).toHaveURL(
		/\/wp-admin\/admin\.php\?page=easymde&route=(?:%2F|\/)general_setting$/iu,
	);
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
});

test("anchors every Settings selector to a translucent white shared popup", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1152, height: 753 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	const root = page.locator(".easymde-settings-center");
	await expect(root).toBeVisible();
	await expect(root.locator("select")).toHaveCount(0);

	const trigger = page.getByRole("combobox", {
		name: /默认编辑模式|Default Editing Mode/u,
	});
	await trigger.click();
	const listbox = page.getByRole("listbox", {
		name: /默认编辑模式|Default Editing Mode/u,
	});
	await expect(listbox).toBeVisible();
	const initialGeometry = await Promise.all([
		trigger.boundingBox(),
		listbox.boundingBox(),
		listbox.evaluate((element) => ({
			animationDuration: getComputedStyle(element).animationDuration,
			animationName: getComputedStyle(element).animationName,
			background: getComputedStyle(element).backgroundColor,
			backdropFilter: getComputedStyle(element).backdropFilter,
			borderRadius: getComputedStyle(element).borderRadius,
			colorScheme: getComputedStyle(element).colorScheme,
			padding: getComputedStyle(element).padding,
			position: getComputedStyle(element).position,
		})),
	]);
	const [initialTriggerBox, initialListboxBox, initialStyle] = initialGeometry;
	if (!initialTriggerBox || !initialListboxBox)
		throw new Error("settings-select-initial-geometry-missing");
	expect(Math.abs(initialListboxBox.x - initialTriggerBox.x)).toBeLessThan(0.5);
	expect(
		Math.abs(initialListboxBox.width - initialTriggerBox.width),
	).toBeLessThan(0.5);
	expect(initialListboxBox.height).toBe(82);
	const selectedOptionBox = await listbox
		.getByRole("option", { selected: true })
		.boundingBox();
	if (!selectedOptionBox)
		throw new Error("settings-select-selected-option-geometry-missing");
	expect(
		Math.abs(
			selectedOptionBox.y +
				selectedOptionBox.height / 2 -
				(initialTriggerBox.y + initialTriggerBox.height / 2),
		),
	).toBeLessThan(0.5);
	expect(initialStyle).toEqual({
		animationDuration: "0.11s",
		animationName: "easymde-settings-select-enter",
		background: "rgba(255, 255, 255, 0.92)",
		backdropFilter: "blur(20px) saturate(1.12)",
		borderRadius: "12px",
		colorScheme: "light",
		padding: "4px",
		position: "fixed",
	});
	const firstOptionStyle = await listbox
		.getByRole("option")
		.first()
		.evaluate((element) => ({
			fontSize: getComputedStyle(element).fontSize,
			fontWeight: getComputedStyle(element).fontWeight,
			height: element.getBoundingClientRect().height,
			padding: getComputedStyle(element).padding,
		}));
	expect(firstOptionStyle).toEqual({
		fontSize: "14px",
		fontWeight: "400",
		height: 24,
		padding: "2px 10px 2px 4px",
	});

	await root.evaluate((element) => {
		element.scrollTop += 40;
	});
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => resolve())),
	);
	const [scrolledTriggerBox, scrolledListboxBox] = await Promise.all([
		trigger.boundingBox(),
		listbox.boundingBox(),
	]);
	if (!scrolledTriggerBox || !scrolledListboxBox)
		throw new Error("settings-select-scrolled-geometry-missing");
	expect(Math.abs(scrolledListboxBox.x - scrolledTriggerBox.x)).toBeLessThan(
		0.5,
	);
	expect(
		Math.abs(scrolledListboxBox.width - scrolledTriggerBox.width),
	).toBeLessThan(0.5);
	const scrolledSelectedOptionBox = await listbox
		.getByRole("option", { selected: true })
		.boundingBox();
	if (!scrolledSelectedOptionBox)
		throw new Error(
			"settings-select-scrolled-selected-option-geometry-missing",
		);
	expect(
		Math.abs(
			scrolledSelectedOptionBox.y +
				scrolledSelectedOptionBox.height / 2 -
				(scrolledTriggerBox.y + scrolledTriggerBox.height / 2),
		),
	).toBeLessThan(0.5);

	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(trigger).toContainText(/源码编辑|Source Editing/u);
	await trigger.click();
	const changedSelectedOption = listbox.getByRole("option", { selected: true });
	const [changedTriggerBox, changedSelectedOptionBox] = await Promise.all([
		trigger.boundingBox(),
		changedSelectedOption.boundingBox(),
	]);
	if (!changedTriggerBox || !changedSelectedOptionBox)
		throw new Error("settings-select-changed-selection-geometry-missing");
	expect(
		Math.abs(
			changedSelectedOptionBox.y +
				changedSelectedOptionBox.height / 2 -
				(changedTriggerBox.y + changedTriggerBox.height / 2),
		),
	).toBeLessThan(0.5);
	await expect(changedSelectedOption.locator("svg")).toHaveCount(1);
	await page
		.getByRole("option", { name: /实时预览（所见即所得）|Live Preview/u })
		.click();
	await expect(trigger).toContainText(/实时预览|Live Preview/u);
});

test("keeps section navigation, the sticky boundary, and the localized heading in sync", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const steps = [
		{ id: "images", previousId: "general" },
		{ id: "markdown", previousId: "images" },
	];

	for (const step of steps) {
		const navItem = page.locator(`[data-nav-id="${step.id}"]`);
		const expectedHeading = (await navItem.textContent())?.trim();
		expect(expectedHeading).toBeTruthy();
		await navItem.click();
		await expect
			.poll(async () =>
				page.evaluate(({ id, previousId }) => {
					const section = document.querySelector(
						`[data-settings-section="${id}"]`,
					);
					const stickyHeader = document.querySelector(
						".easymde-settings-center__sticky-header",
					);
					const currentNav = document.querySelector(`[data-nav-id="${id}"]`);
					const previousNav = document.querySelector(
						`[data-nav-id="${previousId}"]`,
					);
					const heading = document.querySelector(
						".easymde-settings-center__sticky-header h1",
					);
					if (
						!section ||
						!stickyHeader ||
						!currentNav ||
						!previousNav ||
						!heading
					) {
						throw new Error(`settings-navigation-${id}-state-missing`);
					}

					return {
						referenceSectionGap:
							Math.abs(
								section.getBoundingClientRect().top -
									stickyHeader.getBoundingClientRect().bottom -
									9,
							) <= 0.5,
						current: currentNav.getAttribute("aria-current"),
						previous: previousNav.getAttribute("aria-current"),
						heading: heading.textContent?.trim(),
					};
				}, step),
			)
			.toEqual({
				referenceSectionGap: true,
				current: "page",
				previous: null,
				heading: expectedHeading,
			});
	}
});

test("opens a search result at the reference offset and focuses its control", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const targetControl = page.getByRole("switch").first();
	const targetRow = targetControl.locator(
		"xpath=ancestor::*[@data-setting-label][1]",
	);
	const targetLabel = await targetRow.getAttribute("data-setting-label");
	if (!targetLabel) throw new Error("settings-search-target-label-missing");

	await page.getByRole("searchbox").fill(targetLabel);
	await page
		.locator(".easymde-settings-center__search-results button")
		.filter({ hasText: targetLabel })
		.click();

	await expect
		.poll(() =>
			page.evaluate((label) => {
				const target = [
					...document.querySelectorAll("[data-setting-label]"),
				].find(
					(element) => element.getAttribute("data-setting-label") === label,
				);
				const stickyHeader = document.querySelector(
					".easymde-settings-center__sticky-header",
				);
				const control = target?.querySelector("button");
				if (!target || !stickyHeader || !control)
					throw new Error("settings-search-result-target-missing");

				return {
					referenceTargetGap:
						Math.abs(
							target.getBoundingClientRect().top -
								stickyHeader.getBoundingClientRect().bottom -
								33,
						) <= 0.5,
					focused: document.activeElement === control,
				};
			}, targetLabel),
		)
		.toEqual({ referenceTargetGap: true, focused: true });
});

test("keeps focus on an unavailable search result without implying availability", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const targetLabel = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings.pasteAsMarkdown,
	);
	const disabledControl = page.getByRole("switch", {
		name: targetLabel,
		exact: true,
	});
	const targetRow = disabledControl.locator(
		"xpath=ancestor::*[@data-setting-label][1]",
	);
	await expect(targetRow).toHaveAttribute("data-setting-label", targetLabel);

	await page.getByRole("searchbox").fill(targetLabel);
	const result = page
		.locator(".easymde-settings-center__search-results button")
		.filter({ hasText: targetLabel });
	await expect(result).toHaveCount(1);
	await result.click();

	await expect(targetRow).toBeFocused();
	await expect(targetRow).toHaveAttribute("tabindex", "-1");
	await expect(disabledControl).toBeDisabled();
	await expect
		.poll(async () => {
			const [targetBox, headerBox] = await Promise.all([
				targetRow.boundingBox(),
				page.locator(".easymde-settings-center__sticky-header").boundingBox(),
			]);
			if (!targetBox || !headerBox)
				throw new Error("settings-search-unavailable-geometry-missing");

			return Math.abs(targetBox.y - headerBox.y - headerBox.height - 33);
		})
		.toBeLessThanOrEqual(0.5);
});

test("focuses a group-only search result at the reference offset", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const targetHeading = page
		.locator('[data-settings-section="shortcuts"] h2')
		.nth(1);
	const targetLabel = (await targetHeading.textContent())?.trim();
	if (!targetLabel) throw new Error("settings-search-group-label-missing");

	await page.getByRole("searchbox").fill(targetLabel);
	await page
		.locator(".easymde-settings-center__search-results")
		.getByText(targetLabel, { exact: true })
		.locator("xpath=ancestor::button[1]")
		.click();

	await expect(targetHeading).toBeFocused();
	await expect(targetHeading).toHaveAttribute("tabindex", "-1");
	await expect
		.poll(async () => {
			const [targetBox, headerBox] = await Promise.all([
				targetHeading.boundingBox(),
				page.locator(".easymde-settings-center__sticky-header").boundingBox(),
			]);
			if (!targetBox || !headerBox)
				throw new Error("settings-search-group-geometry-missing");

			return Math.abs(targetBox.y - headerBox.y - headerBox.height - 33);
		})
		.toBeLessThanOrEqual(0.5);
});

test("keeps the settings save action clickable after scrolling", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="shortcuts"]').click();

	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const scrollContainer = page.locator(".easymde-settings-center");
	const saveBar = page.locator(".easymde-settings-center__save-bar");
	const saveButton = page.locator(
		".easymde-settings-center__save-bar > button",
	);
	const saveStatus = page.locator("[data-save-status]");
	const recorder = page
		.locator(
			`[data-settings-section="shortcuts"] [data-setting-label="${strings.italic}"]`,
		)
		.locator(".easymde-settings-center__shortcut-recorder")
		.first();
	const resetButton = page.getByRole("button", {
		name: strings.restoreDefaultShortcuts,
		exact: true,
	});

	try {
		await recorder.click();
		await page.keyboard.press("Control+Alt+Shift+E");
		await expect(saveBar).toHaveCSS("display", "flex");
		await scrollContainer.evaluate((element) => {
			element.scrollTop = 58;
			element.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		await expect(saveButton).toBeEnabled();
		await expect
			.poll(async () =>
				saveButton.evaluate((button) => {
					const bounds = button.getBoundingClientRect();
					return (
						document
							.elementFromPoint(
								bounds.left + bounds.width / 2,
								bounds.top + bounds.height / 2,
							)
							?.closest(".easymde-settings-center__save-bar > button") ===
						button
					);
				}),
			)
			.toBe(true);
		await saveButton.click();
		await expect(saveStatus).toHaveAttribute("data-save-status", /saved|idle/u);
		await expect(saveButton).toBeDisabled();
	} finally {
		await resetButton.click();
		if (await saveButton.isEnabled()) {
			await saveButton.click();
			await expect(saveStatus).toHaveAttribute(
				"data-save-status",
				/saved|idle/u,
			);
		}
	}
});
