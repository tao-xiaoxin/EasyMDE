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

test("keeps section navigation, the sticky boundary, and the Chinese heading in sync", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const steps = [
		{ id: "images", previousId: "general", title: "图床设置" },
		{ id: "markdown", previousId: "images", title: "Markdown 设置" },
	];

	for (const step of steps) {
		await page.locator(`[data-nav-id="${step.id}"]`).click();
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
				heading: step.title,
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

	await page
		.getByRole("searchbox", { name: "搜索全部设置" })
		.fill("自动聚焦编辑器");
	await page
		.locator(".easymde-settings-center__search-results button")
		.filter({ hasText: "自动聚焦编辑器" })
		.click();

	await expect
		.poll(() =>
			page.evaluate(() => {
				const target = document.querySelector(
					'[data-setting-label="自动聚焦编辑器"]',
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
			}),
		)
		.toEqual({ referenceTargetGap: true, focused: true });
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

test("preserves the reference mobile crop and unavailable settings remain non-saveable", async ({
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

	await expect(settingsCenter).toBeVisible();
	await expect(saveBar).toHaveCSS("display", "none");
	await expect
		.poll(async () => settingsCenter.evaluate((element) => element.scrollWidth))
		.toBe(1100);
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

	await expect(generalSection.locator("fieldset[disabled]")).toHaveCount(3);
	await expect(generalSection.locator('[role="switch"]').first()).toBeEnabled();
	await expect(
		generalSection.locator("fieldset[disabled] select").first(),
	).toBeDisabled();
	await expect(saveButton).toBeDisabled();
});
