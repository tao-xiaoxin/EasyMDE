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

function expectBoundingBoxesNear(actual, expected, tolerance = 0.5) {
	for (const property of ["x", "y", "width", "height"]) {
		expectNear(actual[property], expected[property], tolerance);
	}
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
	await expect(
		page.locator('link[href*="/assets/css/admin/settings.css"]'),
	).toHaveCount(0);
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

test("covers the WordPress Admin shell before the Settings Center bundle mounts", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	let releaseBundle = () => undefined;
	const bundleGate = new Promise((resolve) => {
		releaseBundle = resolve;
	});
	let reportBundleIntercepted = () => undefined;
	const bundleIntercepted = new Promise((resolve) => {
		reportBundleIntercepted = resolve;
	});
	const settingsBundle = (url) =>
		url.pathname.includes(
			"/assets/build/settings-center/assets/settings-center-",
		) && url.pathname.endsWith(".js");

	await page.route(settingsBundle, async (route) => {
		reportBundleIntercepted();
		const response = await route.fetch();
		await bundleGate;
		await route.fulfill({ response });
	});

	let navigation;
	let startupFrame;
	try {
		navigation = page.goto(
			"/wp-admin/admin.php?page=easymde&route=/general_setting",
		);
		await bundleIntercepted;

		const startupHost = page.locator("#easymde-settings-center-root");
		await expect(startupHost).toBeAttached();
		await expect(page.locator(".easymde-settings-center")).toHaveCount(0);
		await expect(
			startupHost.locator("[data-settings-center-startup]"),
		).toBeVisible();
		startupFrame = await page.evaluate(async () => {
			await new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
			const host = document.querySelector("#easymde-settings-center-root");
			if (!(host instanceof HTMLElement))
				throw new Error("settings-center-startup-host-missing");
			const brand = host.querySelector(".easymde-settings-center__brand");
			if (!(brand instanceof HTMLElement))
				throw new Error("settings-center-startup-brand-missing");
			const hostBox = host.getBoundingClientRect();
			const brandBox = brand.getBoundingClientRect();
			const hostStyle = getComputedStyle(host);
			const points = [
				[8, 8],
				[80, 200],
				[window.innerWidth / 2, window.innerHeight / 2],
			];
			return {
				background: hostStyle.backgroundColor,
				position: hostStyle.position,
				coversViewport:
					hostBox.left <= 0 &&
					hostBox.top <= 0 &&
					hostBox.right >= window.innerWidth &&
					hostBox.bottom >= window.innerHeight,
				pointsOwnedByHost: points.every(([x, y]) => {
					const target = document.elementFromPoint(x, y);
					return target === host || Boolean(target && host.contains(target));
				}),
				brandBox: {
					x: brandBox.x,
					y: brandBox.y,
					width: brandBox.width,
					height: brandBox.height,
				},
				brandAvoidsViewportCenter:
					brandBox.right < window.innerWidth / 2 &&
					brandBox.bottom < window.innerHeight / 2,
			};
		});
	} finally {
		releaseBundle();
		if (navigation) await navigation;
		await page.unroute(settingsBundle);
	}

	expect(startupFrame).toMatchObject({
		background: "rgb(253, 254, 254)",
		position: "fixed",
		coversViewport: true,
		pointsOwnedByHost: true,
		brandAvoidsViewportCenter: true,
	});
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await expect(page.locator("[data-settings-center-startup]")).toHaveCount(0);
	const mountedBrandBox = await page
		.locator(".easymde-settings-center__brand")
		.boundingBox();
	expect(mountedBrandBox).not.toBeNull();
	expectBoundingBoxesNear(startupFrame.brandBox, mountedBrandBox);
});

test("keeps a visible exit when the Settings Center bundle cannot load", async ({
	page,
}) => {
	await login(page);
	const settingsBundle = (url) =>
		url.pathname.includes(
			"/assets/build/settings-center/assets/settings-center-",
		) && url.pathname.endsWith(".js");

	await page.route(settingsBundle, (route) => route.abort("failed"));
	try {
		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toHaveCount(0);
		const startup = page.locator("[data-settings-center-startup]");
		await expect(startup).toBeVisible();
		await expect(startup).toContainText(/EasyMDE/u);
		const status = startup.locator("[data-settings-center-startup-status]");
		await expect(status).toHaveAttribute("role", "alert");
		await expect(status).toHaveAttribute("aria-busy", "false");
		await expect(status).toContainText(/could not start|无法启动/iu);
		const exit = startup.locator("a");
		await expect(exit).toBeVisible();
		await exit.click();
		await expect(page).toHaveURL(/\/wp-admin\/options-general\.php$/u);
		await expect(page.locator("#wpwrap")).toBeVisible();
	} finally {
		await page.unroute(settingsBundle);
	}
});

test("keeps a neutral exit surface when Content Security Policy blocks scripts", async ({
	page,
}) => {
	await login(page);
	const settingsDocument = (url) =>
		url.pathname.endsWith("/wp-admin/admin.php") &&
		url.searchParams.get("page") === "easymde";

	await page.route(settingsDocument, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				"content-security-policy":
					"script-src 'none'; style-src 'self'; img-src 'self' data:",
			},
		});
	});
	try {
		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toHaveCount(0);
		const startup = page.locator("[data-settings-center-startup]");
		await expect(startup).toBeVisible();
		const status = startup.locator("[data-settings-center-startup-status]");
		await expect(status).toHaveAttribute("aria-busy", "false");
		await expect(status).not.toHaveAttribute("role", "status");
		await expect(status).not.toContainText(/Loading|正在加载/iu);
		const exit = startup.locator("a");
		await expect(exit).toBeVisible();
		await exit.click();
		await expect(page).toHaveURL(/\/wp-admin\/options-general\.php$/u);
	} finally {
		await page.unroute(settingsDocument);
	}
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

test("keeps only the remaining Markdown settings inside their responsive section", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1152, height: 753 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	await page
		.getByRole("button", { name: /^(?:Markdown 设置|Markdown Settings)$/u })
		.click();
	const markdownSection = page.locator('[data-settings-section="markdown"]');
	await expect(markdownSection).toBeVisible();

	const removedSettings = [
		/^(?:实时预览|Live Preview)$/u,
		/^(?:固定工具栏|Fixed Toolbar)$/u,
		/^(?:任务列表|Task Lists)$/u,
		/^(?:表情符号|Emoji)$/u,
		/^(?:数学公式支持|Math Formula Support)$/u,
		/^(?:表格扩展|Table Extension)$/u,
		/^(?:脚注|Footnotes)$/u,
		/^(?:定义列表|Definition Lists)$/u,
		/^(?:图片尺寸语法|Image Size Syntax)$/u,
	];
	for (const name of removedSettings) {
		await expect(markdownSection.getByRole("switch", { name })).toHaveCount(0);
	}
	await expect(
		markdownSection.getByRole("heading", {
			name: /^(?:Markdown 扩展|Markdown Extensions)$/u,
		}),
	).toHaveCount(0);

	for (const name of [
		/^(?:编辑器设置|Editor Settings)$/u,
		/^(?:Markdown 解析与渲染|Markdown Parsing and Rendering)$/u,
	]) {
		await expect(markdownSection.getByRole("heading", { name })).toBeVisible();
	}
	await expect(
		markdownSection.getByRole("heading", { name: /^(?:其他|Other)$/u }),
	).toHaveCount(0);
	const pasteConversion = markdownSection.getByRole("switch", {
		name: /将粘贴内容转换为 Markdown|Convert Pasted Content to Markdown/u,
	});
	await expect(pasteConversion).toBeVisible();
	await expect(
		pasteConversion.locator("xpath=ancestor::section[1]").getByRole("heading", {
			name: /^(?:Markdown 解析与渲染|Markdown Parsing and Rendering)$/u,
		}),
	).toBeVisible();

	for (const width of [1152, 390]) {
		await page.setViewportSize({ width, height: 753 });
		const overflow = await markdownSection.evaluate((section) => {
			const owner = section.getBoundingClientRect();
			const visibleDescendants = Array.from(
				section.querySelectorAll("*"),
			).filter((element) => {
				const style = getComputedStyle(element);
				const bounds = element.getBoundingClientRect();
				return (
					style.display !== "none" &&
					style.visibility !== "hidden" &&
					bounds.width > 0 &&
					bounds.height > 0
				);
			});
			return visibleDescendants.reduce(
				(result, element) => {
					const bounds = element.getBoundingClientRect();
					return {
						left: Math.max(result.left, owner.left - bounds.left),
						right: Math.max(result.right, bounds.right - owner.right),
					};
				},
				{
					left: Math.max(0, -section.scrollLeft),
					right: Math.max(0, section.scrollWidth - section.clientWidth),
				},
			);
		});
		expect(overflow.left).toBeLessThanOrEqual(1);
		expect(overflow.right).toBeLessThanOrEqual(1);
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
			'[data-settings-section="images"] [data-setting-label] button[role="switch"]:disabled',
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

test("runs the image-hosting interaction contract without exposing credentials", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	const verificationPayloads = [];
	let releaseFirstVerification;
	const firstVerificationGate = new Promise((resolve) => {
		releaseFirstVerification = resolve;
	});
	await page.route(
		"**/wp-json/easymde/v1/image-hosting/verification",
		async (route) => {
			const payload = route.request().postDataJSON();
			verificationPayloads.push(payload);
			if (verificationPayloads.length === 1) await firstVerificationGate;
			await route.fulfill({
				contentType: "application/json",
				json: {
					target: payload.target,
					status: "uploaded",
					path: `verification/${payload.target}.ico`,
					url: `http://images.example.test/verification/${payload.target}.ico`,
				},
				status: 200,
			});
		},
	);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="images"]').click();

	const images = page.locator('[data-settings-section="images"]');
	await expect(
		images.getByRole("switch", {
			name: /上传后插入 Markdown 链接|Insert Markdown Link After Upload/u,
		}),
	).toHaveCount(0);
	await expect(
		images.getByRole("combobox", {
			name: /图片标题展示|Image Title Display/u,
		}),
	).toBeEnabled();
	for (const name of [
		/Alt 文本来源|Alt Text Source/u,
		/复制图片 URL 到剪贴板|Copy Image URL to Clipboard/u,
		/默认插入格式|Default Insert Format/u,
	]) {
		await expect(images.getByLabel(name)).toHaveCount(0);
	}
	const maximumSize = images.getByRole("spinbutton", {
		name: /最大支持图片大小|Maximum Supported Image Size/u,
	});
	await expect(maximumSize).toHaveAttribute("min", "1");
	await expect(maximumSize).toHaveAttribute("max", "10");
	await expect(
		images.getByRole("combobox", {
			name: /上传失败时重试|Retry Failed Upload/u,
		}),
	).toHaveCount(0);
	const primary = images.locator(".is-host-service");
	const verification = primary.locator(
		".easymde-settings-center__verification-row",
	);
	const uploadVerificationStatus = verification.locator(
		".easymde-settings-center__verification-status",
	);
	const verificationButton = verification.locator("> button");
	const verificationStrings = await page.evaluate(() => ({
		close: window.EasyMDESettingsCenterBootstrap.strings.closeImageFeedback,
		success:
			window.EasyMDESettingsCenterBootstrap.strings.uploadVerificationSucceeded,
		verifying: window.EasyMDESettingsCenterBootstrap.strings.verifyingUpload,
		warning:
			window.EasyMDESettingsCenterBootstrap.strings
				.insecureViewingDomainWarning,
	}));
	await primary
		.getByRole("textbox", {
			name: /查看图片域名|Viewing Image Domain/u,
		})
		.fill("http://images.example.test");
	await verificationButton.click();
	await expect(verificationButton).toBeDisabled();
	await expect(verificationButton).toHaveText(verificationStrings.verifying);
	releaseFirstVerification();
	await expect(uploadVerificationStatus).toHaveAttribute(
		"data-state",
		"verified",
	);
	await expect(verificationButton).toBeEnabled();
	const successDialog = page.getByRole("dialog", {
		name: verificationStrings.success,
	});
	await expect(successDialog).toBeVisible();
	await expect(
		successDialog.getByText(verificationStrings.warning),
	).toBeVisible();
	const footerClose = successDialog.locator("footer button");
	await expect(footerClose).toHaveText(verificationStrings.close);
	await expect(footerClose).toBeFocused();
	await page.setViewportSize({ width: 390, height: 844 });
	const dialogGeometry = await successDialog.boundingBox();
	expect(dialogGeometry).not.toBeNull();
	expect(dialogGeometry.x).toBeGreaterThanOrEqual(12);
	expect(dialogGeometry.x + dialogGeometry.width).toBeLessThanOrEqual(378);
	await expect(footerClose).toHaveCSS("height", "44px");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await footerClose.click();
	await expect(verificationButton).toBeFocused();
	await page.setViewportSize({ width: 1440, height: 900 });
	expect(verificationPayloads[0]).toMatchObject({
		revision: expect.any(Number),
		settings: expect.objectContaining({ service: "cloudflare-r2" }),
		target: "primary",
	});

	const bucket = primary.locator("input").nth(1);
	await bucket.fill(`${await bucket.inputValue()}-draft`);
	await expect(uploadVerificationStatus).toHaveAttribute("data-state", "stale");
	await expect(verificationButton).toBeEnabled();
	await verificationButton.click();
	await expect(uploadVerificationStatus).toHaveAttribute(
		"data-state",
		"verified",
	);
	await page
		.getByRole("dialog", { name: verificationStrings.success })
		.locator("footer button")
		.click();
	expect(verificationPayloads).toHaveLength(2);
	expect(verificationPayloads[1].settings.bucket).toBe(
		await bucket.inputValue(),
	);
	await expect(
		primary.getByRole("textbox", {
			name: /自定义 Endpoint|Custom Endpoint/u,
		}),
	).toHaveCount(1);
	await expect(
		primary.getByRole("textbox", {
			name: /查看图片域名|Viewing Image Domain/u,
		}),
	).toHaveCount(1);

	const accessKey = primary
		.locator(".easymde-settings-center__secret-input")
		.first();
	const accessInput = accessKey.locator("input");
	const revealButton = accessKey.locator("button");
	await expect(accessInput).toHaveAttribute("type", "password");
	await expect(revealButton).toHaveCount(0);
	await accessInput.fill("synthetic-browser-only-key");
	await expect(accessInput).toHaveAttribute("type", "password");
	await expect(revealButton).toHaveCount(0);

	const rule = primary.locator(".easymde-settings-center__file-name-input");
	await primary
		.locator(
			'.easymde-settings-center__file-name-presets [data-preset-index="1"]',
		)
		.click();
	await expect(rule).toHaveValue("{year}/{month}/{md5}.{ext}");
	await rule.fill("assets/.");
	await primary
		.locator(".easymde-settings-center__file-name-variables button")
		.last()
		.click();
	await expect(rule).toHaveValue("assets/.{ext}");

	const backup = images.locator(".is-backup-host");
	const backupToggle = backup.locator('[role="switch"]').first();
	if ((await backupToggle.getAttribute("aria-checked")) !== "true") {
		await backupToggle.click();
	}
	await expect(
		backup.locator(".easymde-settings-center__backup-fields"),
	).toHaveCount(1);
	await backupToggle.click();
	await expect(
		backup.locator(".easymde-settings-center__backup-fields"),
	).toHaveCount(0);
	await backupToggle.click();
	await expect(
		backup.locator(".easymde-settings-center__backup-fields"),
	).toHaveCount(1);
	await expect(
		backup.getByRole("switch", {
			name: /保持.*对象路径|Keep.*Object Path/u,
		}),
	).toHaveCount(0);

	const formats = images.locator(
		".easymde-settings-center__upload-formats input",
	);
	for (let index = 0; index < 4; index += 1) {
		const format = formats.nth(index);
		if (!(await format.isChecked())) await format.check();
	}
	for (let index = 0; index < 3; index += 1) await formats.nth(index).uncheck();
	await formats.nth(3).click();
	await expect(formats.nth(3)).toBeChecked();
	const uploadFormatRequired = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings.uploadFormatRequired,
	);
	await expect(page.getByText(uploadFormatRequired)).toBeVisible();

	await page.reload();
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
});

test("persists the bounded upload retry count across a settings-center refresh", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="images"]').click();
	const retryLabel = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings.uploadRetryCount,
	);
	const retryInput = page.getByRole("spinbutton", { name: retryLabel });
	const decrement = page.getByRole("button", { name: `${retryLabel} - 1` });
	const increment = page.getByRole("button", { name: `${retryLabel} + 1` });
	const originalRetryCount = await retryInput.inputValue();
	const testRetryCount = originalRetryCount === "5" ? "4" : "5";
	await expect(retryInput).toHaveAttribute("min", "0");
	await expect(retryInput).toHaveAttribute("max", "5");
	await expect(
		retryInput.locator("xpath=..").locator(":scope > span"),
	).toHaveCount(0);
	const geometry = await Promise.all([
		decrement.boundingBox(),
		retryInput.boundingBox(),
		increment.boundingBox(),
	]);
	expect(geometry.every(Boolean)).toBe(true);
	expect(geometry[0].x).toBeLessThan(geometry[1].x);
	expect(geometry[1].x).toBeLessThan(geometry[2].x);
	expect(geometry[2].x + geometry[2].width).toBeLessThanOrEqual(390);
	expect(Math.abs(geometry[0].y - geometry[1].y)).toBeLessThan(1);
	expect(Math.abs(geometry[1].y - geometry[2].y)).toBeLessThan(1);

	await retryInput.fill("0");
	await expect(decrement).toBeDisabled();
	await expect(increment).toBeEnabled();
	await increment.click();
	await expect(retryInput).toHaveValue("1");
	await retryInput.fill("5");
	await expect(increment).toBeDisabled();
	await expect(decrement).toBeEnabled();
	await decrement.click();
	await expect(retryInput).toHaveValue("4");
	await retryInput.fill(testRetryCount);
	await page.getByRole("button", { name: /保存设置|Save Settings/u }).click();
	await expect(page.locator("[data-save-status]")).toHaveAttribute(
		"data-save-status",
		"saved",
	);

	await page.reload();
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="images"]').click();
	await expect(page.getByRole("spinbutton", { name: retryLabel })).toHaveValue(
		testRetryCount,
	);

	await page
		.getByRole("spinbutton", { name: retryLabel })
		.fill(originalRetryCount);
	await page.getByRole("button", { name: /保存设置|Save Settings/u }).click();
	await expect(page.locator("[data-save-status]")).toHaveAttribute(
		"data-save-status",
		"saved",
	);
});

test("keeps the maximum image size unit inside the horizontal stepper", async ({
	page,
}) => {
	const browserFailures = [];
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type())) {
			browserFailures.push(`${message.type()}: ${message.text()}`);
		}
	});
	page.on("pageerror", (error) => browserFailures.push(`pageerror: ${error.message}`));
	await page.setViewportSize({ width: 1152, height: 753 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="images"]').click();

	const label = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings.maximumImageSize,
	);
	const input = page.getByRole("spinbutton", { name: label });
	const valueCell = input.locator("xpath=..");
	const stepper = valueCell.locator("xpath=..");
	const unit = valueCell.locator(":scope > span");
	const decrement = page.getByRole("button", { name: `${label} - 1` });
	const increment = page.getByRole("button", { name: `${label} + 1` });

	const assertGeometry = async (viewportWidth) => {
		await expect(stepper.locator(":scope > *")).toHaveCount(3);
		await expect(unit).toHaveText("M");
		const typography = await Promise.all([
			input.evaluate((element) => getComputedStyle(element).fontSize),
			unit.evaluate((element) => getComputedStyle(element).fontSize),
		]);
		expect(typography).toEqual(["15.5px", "15.5px"]);
		const geometry = await Promise.all([
			decrement.boundingBox(),
			valueCell.boundingBox(),
			unit.boundingBox(),
			increment.boundingBox(),
			stepper.boundingBox(),
		]);
		if (geometry.some((box) => !box)) {
			throw new Error("maximum-image-size-stepper-geometry-missing");
		}
		const [decrementBox, valueBox, unitBox, incrementBox, stepperBox] = geometry;
		expect(decrementBox.x).toBeLessThan(valueBox.x);
		expect(valueBox.x).toBeLessThan(incrementBox.x);
		expect(unitBox.x + unitBox.width).toBeLessThanOrEqual(
			valueBox.x + valueBox.width,
		);
		expect(incrementBox.x + incrementBox.width).toBeLessThanOrEqual(
			stepperBox.x + stepperBox.width,
		);
		expect(incrementBox.x + incrementBox.width).toBeLessThanOrEqual(
			viewportWidth,
		);
		expectNear(decrementBox.y, valueBox.y);
		expectNear(valueBox.y, incrementBox.y);
		expect(
			await stepper.evaluate(
				(element) =>
					element.scrollWidth <= element.clientWidth &&
					element.scrollHeight <= element.clientHeight,
			),
		).toBe(true);
	};

	await assertGeometry(1152);
	const originalValue = Number(await input.inputValue());
	if (originalValue < 10) {
		await increment.click();
		await expect(input).toHaveValue(String(originalValue + 1));
	} else {
		await decrement.click();
		await expect(input).toHaveValue(String(originalValue - 1));
	}
	await input.fill(String(originalValue));

	await page.setViewportSize({ width: 390, height: 844 });
	await assertGeometry(390);
	const cdp = await page.context().newCDPSession(page);
	const metrics = await cdp.send("Page.getLayoutMetrics");
	expect(metrics.cssLayoutViewport.clientWidth).toBe(390);
	await cdp.detach();
	expect(browserFailures).toEqual([]);
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
			description: measure(".easymde-settings-center__header-scale header p"),
			closeIcon: measure(
				".easymde-settings-center__header-scale header > a svg",
			),
			closeLink: measure(".easymde-settings-center__header-scale header > a"),
			search: measure(".easymde-settings-center__search input"),
			searchIcon: measure(".easymde-settings-center__search > svg"),
			footerSpace: measure(".easymde-settings-center__content-footer-space"),
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
					closeFrameRightGap:
						frame.x + frame.width - closeLink.x - closeLink.width,
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
		await expect(saveStatus).toHaveAttribute("data-save-status", /saved|idle/u);
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
	const saveBar = settingsCenter.locator(".easymde-settings-center__save-bar");
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
	const imagesNav = nav.locator('button[data-nav-id="images"]');
	const expectedImagesTitle = (await imagesNav.textContent())?.trim();
	if (!expectedImagesTitle)
		throw new Error("settings-center-images-navigation-label-missing");
	await imagesNav.click();
	const navigationFrames = await page.evaluate(async (expectedTitle) => {
		const frames = [];
		for (let index = 0; index < 12; index += 1) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			frames.push({
				active: document
					.querySelector('nav [aria-current="page"]')
					?.getAttribute("data-nav-id"),
				title: document.querySelector("h1")?.textContent?.trim(),
				expectedTitle,
			});
		}
		return frames;
	}, expectedImagesTitle);
	expect(navigationFrames).toEqual(
		Array.from({ length: 12 }, () => ({
			active: "images",
			title: expectedImagesTitle,
			expectedTitle: expectedImagesTitle,
		})),
	);
	await nav.locator('button[data-nav-id="general"]').click();
	await headerDescription.evaluate((element) => {
		element.textContent =
			"Configure image upload and storage services with supported image hosts.";
	});
	await expect
		.poll(async () => {
			const headerBox = await header.boundingBox();
			const descriptionBox = await headerDescription.boundingBox();
			if (!headerBox || !descriptionBox)
				throw new Error("settings-center-mobile-header-bounds-missing");
			return (
				descriptionBox.y +
				descriptionBox.height -
				(headerBox.y + headerBox.height)
			);
		})
		.toBeLessThanOrEqual(0.5);

	const initialHelpBox = await help.boundingBox();
	expect(initialHelpBox).not.toBeNull();
	await settingsCenter.evaluate((element) => {
		element.scrollTop = 700;
	});
	await expect
		.poll(async () => settingsCenter.evaluate((element) => element.scrollTop))
		.toBe(700);
	await expect(help).toBeInViewport();
	await settingsCenter.evaluate((element) => {
		element.scrollTop = 0;
	});
	await expect
		.poll(async () => settingsCenter.evaluate((element) => element.scrollTop))
		.toBe(0);
	const restoredHelpBox = await help.boundingBox();
	expect(restoredHelpBox).not.toBeNull();
	expect(
		Math.abs((restoredHelpBox?.x ?? 0) - (initialHelpBox?.x ?? 0)),
	).toBeLessThanOrEqual(0.5);
	expect(
		Math.abs((restoredHelpBox?.y ?? 0) - (initialHelpBox?.y ?? 0)),
	).toBeLessThanOrEqual(0.5);

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
						const hit = element.ownerDocument.elementFromPoint(
							point.x,
							point.y,
						);
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

	await expect(generalSection.locator("fieldset[disabled]")).toHaveCount(1);
	await expect(
		generalSection.getByRole("combobox", {
			name: /界面语言|interface language/i,
		}),
	).toHaveCount(0);
	await expect(generalSection.locator('[role="switch"]').first()).toBeEnabled();
	await expect(
		generalSection.getByRole("combobox", {
			name: /默认摘要同步方式|default summary sync method/i,
		}),
	).toBeDisabled();
	await expect(
		generalSection.getByRole("switch", {
			name: /智能列表识别|smart list recognition/i,
		}),
	).toHaveCount(0);
	await expect(
		generalSection.getByRole("switch", {
			name: /粘贴内容清理|clean pasted content/i,
		}),
	).toHaveCount(0);
	await expect(saveButton).toBeDisabled();
});

test("keeps reference Help geometry stable while compact content stays inside its owners", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1200, height: 753 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");

	const settingsCenter = page.locator(".easymde-settings-center");
	const sidebar = settingsCenter.locator(".easymde-settings-center__sidebar");
	const nav = sidebar.locator("nav");
	const help = sidebar.locator(".easymde-settings-center__help");
	const uploadFormats = settingsCenter.locator(
		".easymde-settings-center__upload-formats",
	);
	const primaryVerification = settingsCenter
		.locator(
			'[data-settings-section="images"] .easymde-settings-center__verification-row',
		)
		.first();

	await expect(settingsCenter).toBeVisible();

	const expectReferenceSidebar = async () => {
		const geometry = await Promise.all([
			sidebar.boundingBox(),
			help.boundingBox(),
		]);
		const [sidebarBox, helpBox] = geometry;
		if (!sidebarBox || !helpBox)
			throw new Error("settings-center-reference-help-bounds-missing");

		expect(Math.abs(sidebarBox.width - 260)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(helpBox.x - 16.5)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(helpBox.width - 217.92)).toBeLessThanOrEqual(0.5);
		expect(
			Math.abs(
				sidebarBox.x + sidebarBox.width - helpBox.x - helpBox.width - 25.58,
			),
		).toBeLessThanOrEqual(0.75);
	};

	const expectUploadFormatsContained = async () => {
		const overflow = await uploadFormats.evaluate((element) => {
			const section = element.closest(
				".easymde-settings-center__settings-section",
			);
			if (!section)
				throw new Error("settings-center-upload-formats-section-missing");
			const elementBounds = element.getBoundingClientRect();
			const sectionBounds = section.getBoundingClientRect();
			return elementBounds.right - sectionBounds.right;
		});
		expect(overflow).toBeLessThanOrEqual(0.75);
	};

	const expectPrimaryVerificationContained = async () => {
		const containment = await primaryVerification.evaluate((element) => {
			const section = element.closest(
				".easymde-settings-center__settings-section",
			);
			if (!section)
				throw new Error("settings-center-verification-section-missing");
			const elementBounds = element.getBoundingClientRect();
			const sectionBounds = section.getBoundingClientRect();
			const rightmost = [element, ...element.querySelectorAll("*")].reduce(
				(current, descendant) => {
					const bounds = descendant.getBoundingClientRect();
					return bounds.right > current.bounds.right
						? { bounds, descendant }
						: current;
				},
				{ bounds: elementBounds, descendant: element },
			);
			return {
				contents: rightmost.bounds.right - sectionBounds.right,
				offender: `${rightmost.descendant.tagName.toLowerCase()}.${rightmost.descendant.className}`,
				owner: elementBounds.right - sectionBounds.right,
			};
		});
		expect(containment.owner).toBeLessThanOrEqual(0.75);
		expect(containment.contents, containment.offender).toBeLessThanOrEqual(
			0.75,
		);
	};

	const expectEverySectionContained = async () => {
		const measurements = await settingsCenter
			.locator("[data-settings-section]")
			.evaluateAll((sections) =>
				sections.map((section) => {
					const sectionBounds = section.getBoundingClientRect();
					const descendants = Array.from(section.querySelectorAll("*")).map(
						(element) => ({
							className:
								typeof element.className === "string" ? element.className : "",
							right: element.getBoundingClientRect().right,
							tagName: element.tagName.toLowerCase(),
						}),
					);
					const rightmost = descendants.reduce(
						(current, candidate) =>
							candidate.right > current.right ? candidate : current,
						{
							className: "",
							right: sectionBounds.right,
							tagName: section.tagName.toLowerCase(),
						},
					);
					return {
						descendantOverflow: rightmost.right - sectionBounds.right,
						id: section.getAttribute("data-settings-section"),
						offender: `${rightmost.tagName}.${rightmost.className}`,
						scrollOverflow: section.scrollWidth - section.clientWidth,
					};
				}),
			);
		const overflowing = measurements.filter(
			(measurement) => measurement.scrollOverflow > 1,
		);
		expect(overflowing, JSON.stringify(measurements)).toEqual([]);
	};

	for (const width of [1200, 1100, 1099, 900, 841]) {
		await page.setViewportSize({ width, height: 753 });
		await expectReferenceSidebar();
		await expectUploadFormatsContained();
		await expectPrimaryVerificationContained();
		await expectEverySectionContained();
		await expect
			.poll(async () =>
				settingsCenter.evaluate(
					(element) => element.scrollWidth - element.clientWidth,
				),
			)
			.toBeLessThanOrEqual(1);
	}

	await page.setViewportSize({ width: 1099, height: 753 });
	const helpBeforeReload = await help.boundingBox();
	await page.reload();
	await expect(settingsCenter).toBeVisible();
	await expectReferenceSidebar();
	const helpAfterReload = await help.boundingBox();
	if (!helpBeforeReload || !helpAfterReload)
		throw new Error("settings-center-reloaded-help-bounds-missing");
	for (const coordinate of ["x", "y", "width", "height"]) {
		expect(
			Math.abs(helpAfterReload[coordinate] - helpBeforeReload[coordinate]),
		).toBeLessThanOrEqual(0.5);
	}

	await page.setViewportSize({ width: 841, height: 500 });
	await expectReferenceSidebar();
	const shortDesktopOverlap = await Promise.all([
		nav.boundingBox(),
		help.boundingBox(),
	]).then(([navBox, helpBox]) => {
		if (!navBox || !helpBox)
			throw new Error("settings-center-short-desktop-bounds-missing");
		return navBox.y + navBox.height - helpBox.y;
	});
	expect(shortDesktopOverlap).toBeLessThanOrEqual(0.5);
	await settingsCenter.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event("scroll"));
	});
	const aboutNav = nav.locator('button[data-nav-id="about"]');
	await expect(aboutNav).toHaveAttribute("aria-current", "page");
	const activeNavOverflow = await Promise.all([
		nav.boundingBox(),
		aboutNav.boundingBox(),
	]).then(([navBox, activeBox]) => {
		if (!navBox || !activeBox)
			throw new Error("settings-center-short-active-nav-bounds-missing");
		return activeBox.y + activeBox.height - (navBox.y + navBox.height);
	});
	expect(activeNavOverflow).toBeLessThanOrEqual(0.5);

	await page.setViewportSize({ width: 740, height: 360 });
	const shortMobileOverflow = await Promise.all([
		sidebar.boundingBox(),
		help.boundingBox(),
		sidebar.evaluate((element) =>
			Number.parseFloat(getComputedStyle(element).paddingRight),
		),
	]).then(([sidebarBox, helpBox, paddingRight]) => {
		if (!sidebarBox || !helpBox)
			throw new Error("settings-center-short-mobile-bounds-missing");
		return (
			helpBox.x +
			helpBox.width -
			(sidebarBox.x + sidebarBox.width - paddingRight)
		);
	});
	expect(shortMobileOverflow).toBeLessThanOrEqual(0.5);
});
