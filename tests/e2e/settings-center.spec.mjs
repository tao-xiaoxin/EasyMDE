import { expect, test } from "@playwright/test";

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

function expectNear(actual, expected, tolerance = 0.5) {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

async function login(page) {
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

async function expectRemovedSettingsPage(
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
	await expect(page.locator('link[href*="/assets/css/admin/settings.css"]')).toHaveCount(0);
	if (message) {
		await expect(page.locator("body")).toContainText(message);
	}
}

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
	await expect(page.locator("#wpbody-content h1")).toHaveText(/^\s*(?:插件|Plugins)\s*$/u);
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

	const disabledControl = page
		.locator(
			'[data-settings-section="images"] [data-setting-label] input:disabled',
		)
		.first();
	const targetRow = disabledControl.locator(
		"xpath=ancestor::*[@data-setting-label][1]",
	);
	const targetLabel = await targetRow.getAttribute("data-setting-label");
	if (!targetLabel)
		throw new Error("settings-search-unavailable-label-missing");

	await page.getByRole("searchbox").fill(targetLabel);
	await page
		.locator(".easymde-settings-center__search-results button")
		.filter({ hasText: targetLabel })
		.click();

	await expect(targetRow).toBeFocused();
	await expect(targetRow).toHaveAttribute("tabindex", "-1");
	await expect(disabledControl).toBeDisabled();
	await expect
		.poll(async () => {
			const [targetBox, headerBox] = await Promise.all([
				targetRow.boundingBox(),
				page
					.locator(".easymde-settings-center__sticky-header")
					.boundingBox(),
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
				page
					.locator(".easymde-settings-center__sticky-header")
					.boundingBox(),
			]);
			if (!targetBox || !headerBox)
				throw new Error("settings-search-group-geometry-missing");

			return Math.abs(targetBox.y - headerBox.y - headerBox.height - 33);
		})
		.toBeLessThanOrEqual(0.5);
});

test("matches the reference Settings Center header geometry", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const geometry = await page.evaluate(() => {
		const measure = (selector) => {
			const element = document.querySelector(selector);
			if (!element) {
				throw new Error(`settings-geometry-missing-${selector}`);
			}

			const rect = element.getBoundingClientRect();
			return {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
			};
		};

		return {
			title: measure(".easymde-settings-center__header-scale h1"),
			description: measure(
				".easymde-settings-center__header-scale header p",
			),
			closeIcon: measure(
				".easymde-settings-center__header-scale header > a svg",
			),
			closeLink: measure(
				".easymde-settings-center__header-scale header > a",
			),
			search: measure(".easymde-settings-center__search input"),
			searchIcon: measure(".easymde-settings-center__search > svg"),
			footerSpace: measure(
				".easymde-settings-center__content-footer-space",
			),
			frame: measure(".easymde-settings-center__frame"),
			aside: measure(".easymde-settings-center__sidebar"),
			main: measure(".easymde-settings-center main"),
			relationships: (() => {
				const frame = measure(".easymde-settings-center__frame");
				const aside = measure(".easymde-settings-center__sidebar");
				const main = measure(".easymde-settings-center main");
				const title = measure(".easymde-settings-center__header-scale h1");
				const description = measure(
					".easymde-settings-center__header-scale header p",
				);
				const closeLink = measure(
					".easymde-settings-center__header-scale header > a",
				);
				const search = measure(".easymde-settings-center__search input");

				return {
					frameLeft: frame.x,
					asideFrameOffsetX: aside.x - frame.x,
					mainFrameOffsetX: main.x - frame.x,
					titleMainOffsetX: title.x - main.x,
					descriptionMainOffsetX: description.x - main.x,
					closeFrameRightGap: frame.x + frame.width - closeLink.x - closeLink.width,
					searchMainLeftGap: search.x - main.x,
					searchMainRightGap: main.x + main.width - search.x - search.width,
				};
			})(),
		};
	});

	for (const [key, expected] of Object.entries({
		title: { y: 93.6, height: 37.8 },
		description: { y: 138.6, height: 21.6 },
		closeIcon: { y: 21.04, width: 20.7, height: 20.7 },
		closeLink: { y: 16.2, width: 30.375, height: 30.375 },
		search: { y: 198, height: 38.7 },
		searchIcon: { y: 208.35, width: 18, height: 18 },
		footerSpace: { height: 30 },
	})) {
		for (const [property, value] of Object.entries(expected)) {
			expectNear(geometry[key][property], value);
		}
	}

	for (const [property, value] of Object.entries({
		frameLeft: 0,
		asideFrameOffsetX: 0,
		mainFrameOffsetX: 260,
		titleMainOffsetX: 33.3,
		descriptionMainOffsetX: 32.4,
		closeFrameRightGap: 16.2,
		searchMainLeftGap: 30.6,
		searchMainRightGap: 33.3,
	})) {
		expectNear(geometry.relationships[property], value);
	}
});

test("rejects the removed Settings Center URL without loading its form or assets", async ({
	page,
}) => {
	await login(page);
	await expectRemovedSettingsPage(
		page,
		"/wp-admin/admin.php?page=easymde/settings/general",
		{
			status: 403,
			message:
				/Sorry, you are not allowed to access this page\.|抱歉，您不能访问此页面。/iu,
		},
	);
});

test("rejects an unsupported settings center route explicitly", async ({
	page,
}) => {
	await login(page);
	const response = await page.goto(
		"/wp-admin/admin.php?page=easymde&route=/unsupported",
	);

	expect(response?.status()).toBe(404);
	await expect(page.locator("body")).toContainText(
		/settings route is not supported|不支持此 EasyMDE 设置路由/iu,
	);
});

test("rejects the removed Options URLs without loading their form or assets", async ({
	page,
}) => {
	await login(page);
	await expectRemovedSettingsPage(
		page,
		"/wp-admin/options-general.php?page=easymde-legacy",
		{
			status: 403,
			message:
				/Sorry, you are not allowed to access this page\.|抱歉，您不能访问此页面。/iu,
		},
	);
	await expectRemovedSettingsPage(
		page,
		"/wp-admin/options-general.php?page=easymde",
		{ status: 200, assertNoOptionsForm: false },
	);
});

test("keeps the settings save action clickable after scrolling", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const scrollContainer = page.locator(".easymde-settings-center");
	const saveBar = page.locator(".easymde-settings-center__save-bar");
	const shortcutInput = page
		.locator(
			'[data-settings-section="shortcuts"] .easymde-settings-center__shortcut-row',
		)
		.first()
		.locator("input")
		.first();
	const saveButton = page.locator(
		".easymde-settings-center__save-bar > button",
	);
	const saveStatus = page.locator("[data-save-status]");
	const initialValue = await shortcutInput.inputValue();
	const changedValue = "Ctrl+Alt+Shift+E";

	await expect(shortcutInput).toBeEnabled();

	try {
		await shortcutInput.fill(changedValue);
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
		await expect(saveStatus).toHaveAttribute(
			"data-save-status",
			/saved|idle/u,
		);
		await expect(saveButton).toBeDisabled();

		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await expect(
			page
				.locator(
					'[data-settings-section="shortcuts"] .easymde-settings-center__shortcut-row',
				)
				.first()
				.locator("input")
				.first(),
		).toHaveValue(changedValue);
	} finally {
		const currentValue = await shortcutInput.inputValue();
		if (currentValue !== initialValue) {
			await shortcutInput.fill(initialValue);
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(saveStatus).toHaveAttribute(
				"data-save-status",
				/saved|idle/u,
			);
			await expect(saveButton).toBeDisabled();
		}
	}
});

test("adapts the Settings Center to a narrow viewport and unavailable settings remain non-saveable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");

	const settingsCenter = page.locator(".easymde-settings-center");
	const saveBar = settingsCenter.locator(
		".easymde-settings-center__save-bar",
	);
	const saveButton = settingsCenter.locator(
		".easymde-settings-center__save-bar > button",
	);
	const generalSection = settingsCenter.locator(
		'[data-settings-section="general"]',
	);
	const nav = settingsCenter.locator(".easymde-settings-center__sidebar nav");
	const frame = settingsCenter.locator(".easymde-settings-center__frame");
	const sidebar = settingsCenter.locator(".easymde-settings-center__sidebar");
	const help = settingsCenter.locator(".easymde-settings-center__help");
	const header = settingsCenter.locator(
		".easymde-settings-center__header-scale header",
	);
	const headerDescription = header.locator("p");
	const main = settingsCenter.locator("main");

	await expect(settingsCenter).toBeVisible();
	await expect(saveBar).toHaveCSS("display", "none");
	await expect
		.poll(async () =>
			settingsCenter.evaluate(
				(element) => element.scrollWidth - element.clientWidth,
			),
		)
		.toBeLessThanOrEqual(1);
	await expect
		.poll(async () => settingsCenter.evaluate((element) => element.clientWidth))
		.toBeGreaterThanOrEqual(375);
	await expect
		.poll(async () => settingsCenter.evaluate((element) => element.clientWidth))
		.toBeLessThanOrEqual(390);
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(1);
	await expect(frame).toHaveCSS("display", "block");
	await expect(sidebar).toHaveCSS("width", "390px");
	await expect(main).toHaveCSS("width", "390px");
	await expect(nav).toHaveCSS("overflow-x", "auto");
	await expect(help).toBeInViewport();
	await headerDescription.evaluate((element) => {
		element.textContent =
			"Configure image upload and storage services with common hosts and custom upload destinations.";
	});
	await expect
		.poll(async () => {
			const headerBox = await header.boundingBox();
			const descriptionBox = await headerDescription.boundingBox();
			if (!headerBox || !descriptionBox)
				throw new Error("settings-center-mobile-header-bounds-missing");
			return descriptionBox.y + descriptionBox.height - (headerBox.y + headerBox.height);
		})
		.toBeLessThanOrEqual(0.5);

	const initialHelpBox = await help.boundingBox();
	expect(initialHelpBox).not.toBeNull();
	await settingsCenter.evaluate((element) => {
		element.scrollTop = 700;
	});
	await expect.poll(async () => settingsCenter.evaluate((element) => element.scrollTop)).toBe(700);
	await expect(help).toBeInViewport();
	await settingsCenter.evaluate((element) => {
		element.scrollTop = 0;
	});
	await expect.poll(async () => settingsCenter.evaluate((element) => element.scrollTop)).toBe(0);
	const restoredHelpBox = await help.boundingBox();
	expect(restoredHelpBox).not.toBeNull();
	expect(Math.abs((restoredHelpBox?.x ?? 0) - (initialHelpBox?.x ?? 0))).toBeLessThanOrEqual(0.5);
	expect(Math.abs((restoredHelpBox?.y ?? 0) - (initialHelpBox?.y ?? 0))).toBeLessThanOrEqual(0.5);

	const enabledToggle = generalSection.locator('[role="switch"]').first();
	await enabledToggle.click();
	await expect(saveButton).toBeEnabled();
	const saveStatus = saveBar.locator("span").first();
	await saveStatus.evaluate((element) => {
		element.textContent =
			"The settings could not be saved because the network request failed. Try again.";
	});
	await settingsCenter.evaluate((element) => {
		element.scrollTop = 700;
	});
	await expect(saveButton).toBeInViewport();
	await expect
		.poll(async () => {
			const barBox = await saveBar.boundingBox();
			return barBox?.height ?? 0;
		})
		.toBe(98);
	await expect
		.poll(async () =>
			page.locator(".easymde-settings-center__frame").evaluate((frame) => {
				const main = frame.querySelector("main");
				if (!main) throw new Error("settings-center-mobile-main-missing");
				return Number.parseFloat(getComputedStyle(main).paddingBottom);
			}),
		)
		.toBe(98);
	await expect
		.poll(async () => {
			const buttonBox = await saveButton.boundingBox();
			if (!buttonBox)
				throw new Error("settings-center-mobile-save-button-bounds-missing");
			return saveButton.evaluate(
				(button, point) => {
					const hit = button.ownerDocument.elementFromPoint(point.x, point.y);
					return hit === button || Boolean(hit && button.contains(hit));
				},
				{
					x: buttonBox.x + buttonBox.width / 2,
					y: buttonBox.y + buttonBox.height / 2,
				},
			);
		})
		.toBe(true);

	await settingsCenter.evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.setViewportSize({ width: 740, height: 360 });
	await expect
		.poll(async () =>
			settingsCenter.evaluate(
				(element) => element.scrollWidth - element.clientWidth,
			),
		)
		.toBeLessThanOrEqual(1);
	await expect(help).toBeInViewport();
	const searchInput = settingsCenter.locator(
		".easymde-settings-center__search input",
	);
	for (const control of [searchInput, saveButton]) {
		await expect(control).toBeInViewport();
		await expect
			.poll(async () => {
				const controlBox = await control.boundingBox();
				if (!controlBox)
					throw new Error("settings-center-landscape-control-bounds-missing");
				return control.evaluate(
					(element, point) => {
						const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
						return hit === element || Boolean(hit && element.contains(hit));
					},
					{
						x: controlBox.x + controlBox.width / 2,
						y: controlBox.y + controlBox.height / 2,
					},
				);
			})
			.toBe(true);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await settingsCenter.evaluate((element) => {
		element.scrollTop = 0;
	});
	await enabledToggle.click();
	await expect(saveButton).toBeDisabled();

	const navIds = await nav
		.locator("button[data-nav-id]")
		.evaluateAll((buttons) =>
			buttons.map((button) => button.getAttribute("data-nav-id")),
		);
	expect(navIds).not.toContain("ai-comments");
	expect(navIds).not.toContain("ai-settings");
	expect(navIds).not.toContain("article-sync");
	await expect(nav).not.toContainText(
		/AI|comment|评论|article\s*sync|文章同步/i,
	);

	await settingsCenter.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event("scroll"));
	});
	const aboutNav = nav.locator('button[data-nav-id="about"]');
	await expect(aboutNav).toHaveAttribute("aria-current", "page");
	await expect(aboutNav).toBeInViewport();

	await expect(generalSection.locator("fieldset[disabled]")).toHaveCount(2);
	await expect(
		generalSection.getByRole("combobox", { name: /界面语言|interface language/i }),
	).toHaveCount(0);
	await expect(generalSection.locator('[role="switch"]').first()).toBeEnabled();
	await expect(
		generalSection.locator("fieldset[disabled] select").first(),
	).toBeDisabled();
	await expect(saveButton).toBeDisabled();
});
