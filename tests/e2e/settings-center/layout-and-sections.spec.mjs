import { expect, test } from "@playwright/test";
import {
	expectNear,
	login,
	readImageHostingEnabled,
	setImageHostingEnabled,
} from "../helpers/settings-center-helpers.mjs";

test("keeps only the remaining Markdown settings inside their responsive section", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1152, height: 753 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	const generalSection = page.locator('[data-settings-section="general"]');
	const themeRenderingName = /^(?:编辑器主题渲染|Editor Theme Rendering)$/u;
	const codeCopyName = /^(?:代码块复制|Code Block Copy)$/u;
	await expect(
		generalSection.getByRole("switch", { name: themeRenderingName }),
	).toHaveCount(0);
	await expect(
		generalSection.getByRole("switch", { name: codeCopyName }),
	).toHaveCount(1);
	await expect(
		generalSection.getByRole("switch", {
			name: /^(?:特色图片占位提示|Featured Image Placeholder)$/u,
		}),
	).toHaveCount(0);

	await page
		.getByRole("button", { name: /^(?:Markdown 设置|Markdown Settings)$/u })
		.click();
	const markdownSection = page.locator('[data-settings-section="markdown"]');
	await expect(markdownSection).toBeVisible();
	const themeRendering = markdownSection.getByRole("switch", {
		name: themeRenderingName,
	});
	await expect(themeRendering).toHaveCount(1);
	await expect(
		markdownSection.getByRole("combobox", {
			name: /^(?:编辑器主题|Editor Theme)$/u,
		}),
	).toHaveCount(0);
	await expect(
		markdownSection.getByRole("switch", {
			name: /^(?:HTML 渲染|HTML Rendering)$/u,
		}),
	).toHaveCount(0);
	await expect(
		markdownSection.getByRole("combobox", {
			name: /^(?:表格对齐|Table Alignment)$/u,
		}),
	).toBeEnabled();
	await expect(
		markdownSection.getByRole("combobox", {
			name: /^(?:代码块行号|Code Block Line Numbers)$/u,
		}),
	).toBeEnabled();
	const initialThemeRendering =
		await themeRendering.getAttribute("aria-checked");
	if (initialThemeRendering !== "true" && initialThemeRendering !== "false") {
		throw new Error("settings-theme-rendering-state-invalid");
	}
	const changedThemeRendering =
		initialThemeRendering === "true" ? "false" : "true";
	const saveButton = page.getByRole("button", {
		name: /保存设置|Save Settings/u,
	});
	const saveStatus = page.locator("[data-save-status]");
	try {
		await themeRendering.click();
		await expect(themeRendering).toHaveAttribute(
			"aria-checked",
			changedThemeRendering,
		);
		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(saveStatus).toHaveAttribute("data-save-status", /saved|idle/u);
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page
			.getByRole("button", { name: /^(?:Markdown 设置|Markdown Settings)$/u })
			.click();
		await expect(themeRendering).toHaveAttribute(
			"aria-checked",
			changedThemeRendering,
		);
	} finally {
		if (
			(await themeRendering.getAttribute("aria-checked")) !==
			initialThemeRendering
		) {
			await themeRendering.click();
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(saveStatus).toHaveAttribute(
				"data-save-status",
				/saved|idle/u,
			);
		}
	}
	const editorLineNumbers = /^(?:显示行号|Show Line Numbers)$/u;
	await expect(
		markdownSection.getByRole("switch", { name: editorLineNumbers }),
	).toHaveCount(0);
	await expect(
		page.getByRole("switch", { name: editorLineNumbers }),
	).toHaveCount(1);

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
	await page.setViewportSize({ width: 1152, height: 753 });
	await page.locator('button[data-nav-id="about"]').click();
	const aboutSection = page.locator('[data-settings-section="about"]');
	await expect(aboutSection).toBeVisible();
	await expect(
		aboutSection.getByRole("link", {
			name: /^(?:安全策略|Security Policy)/u,
		}),
	).toHaveCount(0);
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

	await expect(generalSection.locator("fieldset[disabled]")).toHaveCount(0);
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
	).toBeEnabled();
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

test("persists the default summary sync method selected with the keyboard", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();

	const summaryMode = page.getByRole("combobox", {
		name: /默认摘要同步方式|default summary sync method/i,
	});
	const saveButton = page.locator(
		".easymde-settings-center__save-bar > button",
	);
	const saveStatus = page.locator("[data-save-status]");
	let initialOptionName = "";

	try {
		await expect(summaryMode).toBeEnabled();
		await summaryMode.focus();
		await summaryMode.press("Enter");
		const listbox = page.getByRole("listbox", {
			name: /默认摘要同步方式|default summary sync method/i,
		});
		await expect(listbox).toBeVisible();
		initialOptionName =
			(
				await listbox.getByRole("option", { selected: true }).textContent()
			)?.trim() ?? "";
		if (!initialOptionName)
			throw new Error("settings-center-summary-initial-option-missing");
		const initialOptionIndex = await listbox
			.getByRole("option")
			.evaluateAll((options) =>
				options.findIndex(
					(option) => option.getAttribute("aria-selected") === "true",
				),
			);
		if (initialOptionIndex === 1) {
			await summaryMode.press("Home");
			await summaryMode.press("Enter");
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(saveStatus).toHaveAttribute(
				"data-save-status",
				/saved|idle/u,
			);
			await page.reload();
			await expect(page.locator(".easymde-settings-center")).toBeVisible();
			await summaryMode.focus();
			await summaryMode.press("Enter");
		}
		await summaryMode.press("Home");
		await summaryMode.press("ArrowDown");
		await summaryMode.press("Enter");
		await expect(summaryMode).toContainText(
			/前 100 个字符|first 100 characters/i,
		);

		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(saveStatus).toHaveAttribute("data-save-status", /saved|idle/u);
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await expect(summaryMode).toContainText(
			/前 100 个字符|first 100 characters/i,
		);
	} finally {
		if (initialOptionName) {
			await summaryMode.click();
			const initialOption = page
				.getByRole("listbox", {
					name: /默认摘要同步方式|default summary sync method/i,
				})
				.getByRole("option", { name: initialOptionName, exact: true });
			if ((await initialOption.getAttribute("aria-selected")) !== "true") {
				await initialOption.click();
				await expect(saveButton).toBeEnabled();
				await saveButton.click();
				await expect(saveStatus).toHaveAttribute(
					"data-save-status",
					/saved|idle/u,
				);
			} else {
				await summaryMode.press("Escape");
			}
		}
	}
});

test("keeps reference Help geometry stable while compact content stays inside its owners", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1200, height: 753 });
	await login(page);
	let originalImageHostingEnabled;
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await setImageHostingEnabled(page, true);
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
									typeof element.className === "string"
										? element.className
										: "",
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
	} finally {
		if (typeof originalImageHostingEnabled === "boolean") {
			await setImageHostingEnabled(page, originalImageHostingEnabled);
		}
	}
});
