import { Buffer } from "node:buffer";
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

async function saveSettingsCenter(page) {
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

async function openSettingsSection(page, section) {
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator(`button[data-nav-id="${section}"]`).click();
}

async function readImageHostingEnabled(page) {
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

async function setImageHostingEnabled(page, enabled) {
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

async function selectSettingsOption(page, label, optionLabel) {
	const trigger = page.getByRole("combobox", { name: label, exact: true });
	if ((await trigger.textContent())?.trim() === optionLabel) return;
	await trigger.click();
	const listbox = page.getByRole("listbox", { name: label, exact: true });
	await expect(listbox).toBeVisible();
	await listbox
		.getByRole("option", { name: optionLabel, exact: true })
		.click();
	await expect(trigger).toHaveText(optionLabel);
}

async function resetSettingsCenterDefaults(page) {
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

async function resetSettingsAndRestoreImageHosting(page, originalEnabled) {
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

async function setRemoteImageUploadMode(page, mode) {
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
	return { label: strings.remoteImageUploadMode, optionLabel: optionLabels[mode] };
}

async function dispatchBrowserPaste(target, { html = "", plainText }) {
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

const SETTINGS_CENTER_FIRST_PAINT_PATH =
	"/wp-admin/admin.php?page=easymde&route=/general_setting";
const SETTINGS_CENTER_FIRST_PAINT_RUNS = 5;
const SETTINGS_CENTER_FRAME_FINGERPRINT_TOLERANCE = 20;
const SETTINGS_CENTER_FIRST_PAINT_CASES = [
	{ name: "desktop-cold", width: 1440, height: 900, cacheDisabled: true },
	{ name: "desktop-warm", width: 1440, height: 900, cacheDisabled: false },
	{ name: "mobile-cold", width: 390, height: 844, cacheDisabled: true },
	{ name: "mobile-warm", width: 390, height: 844, cacheDisabled: false },
];

async function waitForSettingsCenterReady(page) {
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await expect(
		page.locator(".easymde-settings-center__sidebar nav"),
	).toBeVisible();
	await expect(
		page.locator(".easymde-settings-center__sticky-header h1"),
	).toBeVisible();
	await expect(page.getByRole("searchbox")).toBeVisible();
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(resolve));
		});
	});
}

async function assertSettingsCenterShellAbsent(page) {
	for (const shellId of [
		"wpwrap",
		"wpadminbar",
		"adminmenu",
		"wpcontent",
		"wpbody",
		"wpfooter",
	]) {
		await expect(page.locator(`#${shellId}`)).toHaveCount(0);
	}
	const hasOpaqueBodyPseudoVeil = await page.evaluate(() => {
		const style = getComputedStyle(document.body, "::before");
		return (
			style.content !== "none" &&
			style.display !== "none" &&
			style.backgroundColor !== "rgba(0, 0, 0, 0)"
		);
	});
	expect(hasOpaqueBodyPseudoVeil).toBe(false);
}

async function decodeSettingsCenterPng(decoder, data, expectedSize) {
	return decoder.evaluate(
		async ({ png, expectedWidth, expectedHeight }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${png}`;
			await image.decode();
			if (
				image.naturalWidth !== expectedWidth ||
				image.naturalHeight !== expectedHeight
			) {
				throw new Error("settings-frame-size-mismatch");
			}
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("settings-frame-canvas-unavailable");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(
				0,
				0,
				canvas.width,
				canvas.height,
			).data;
			let topSamples = 0;
			let darkTopSamples = 0;
			let allSamples = 0;
			let whiteSamples = 0;
			let pixelHash = 2166136261;
			const fingerprint = [];
			for (let y = 0; y < canvas.height; y += 8) {
				for (let x = 0; x < canvas.width; x += 8) {
					const index = (y * canvas.width + x) * 4;
					const red = pixels[index];
					const green = pixels[index + 1];
					const blue = pixels[index + 2];
					const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
					allSamples += 1;
					if (red > 246 && green > 246 && blue > 246) whiteSamples += 1;
					if (y < 56) {
						topSamples += 1;
						if (luminance < 85) darkTopSamples += 1;
					}
					if (y % 16 === 0 && x % 16 === 0) {
						fingerprint.push(red, green, blue);
					}
				}
			}
			for (let index = 0; index < pixels.length; index += 4) {
				pixelHash = Math.imul(pixelHash ^ pixels[index], 16777619);
				pixelHash = Math.imul(pixelHash ^ pixels[index + 1], 16777619);
				pixelHash = Math.imul(pixelHash ^ pixels[index + 2], 16777619);
			}
			return {
				width: image.naturalWidth,
				height: image.naturalHeight,
				darkTopRatio: darkTopSamples / topSamples,
				whiteRatio: whiteSamples / allSamples,
				pixelHash: pixelHash >>> 0,
				fingerprint,
			};
		},
		{
			png: data,
			expectedWidth: expectedSize.width,
			expectedHeight: expectedSize.height,
		},
	);
}

function settingsCenterFingerprintDistance(frame, reference) {
	if (frame.fingerprint.length !== reference.fingerprint.length) {
		throw new Error("settings-frame-fingerprint-size-mismatch");
	}
	let absoluteDifference = 0;
	for (let index = 0; index < frame.fingerprint.length; index += 1) {
		absoluteDifference += Math.abs(
			frame.fingerprint[index] - reference.fingerprint[index],
		);
	}

	return absoluteDifference / frame.fingerprint.length;
}

function matchesSettingsCenterFrame(frame, reference) {
	return (
		frame.whiteRatio < 0.995 &&
		frame.darkTopRatio < 0.35 &&
		settingsCenterFingerprintDistance(frame, reference) <=
			SETTINGS_CENTER_FRAME_FINGERPRINT_TOLERANCE
	);
}

async function captureSettingsCenterNavigationEvidence(
	page,
	cdp,
	decoder,
	expectedSize,
) {
	const settingsApplication = page.locator(".easymde-settings-center");
	const beforeVisible = await settingsApplication.isVisible();
	if (!beforeVisible) throw new Error("settings-before-reload-not-visible");
	const beforeScreenshot = await cdp.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: false,
	});
	const beforeAnalysis = await decodeSettingsCenterPng(
		decoder,
		beforeScreenshot.data,
		expectedSize,
	);
	if (!matchesSettingsCenterFrame(beforeAnalysis, beforeAnalysis)) {
		throw new Error("settings-reference-frame-invalid");
	}
	let committed = false;
	const frames = [];
	const pendingAcks = new Set();
	const ackErrors = [];
	const handleFrameNavigated = ({ frame }) => {
		if (!frame.parentId) committed = true;
	};
	const handleScreencastFrame = ({ data, sessionId }) => {
		const ack = cdp.send("Page.screencastFrameAck", { sessionId });
		pendingAcks.add(ack);
		ack.then(
			() => pendingAcks.delete(ack),
			(error) => {
				ackErrors.push(error);
				pendingAcks.delete(ack);
			},
		);
		if (committed) frames.push(data);
	};
	cdp.on("Page.frameNavigated", handleFrameNavigated);
	cdp.on("Page.screencastFrame", handleScreencastFrame);
	let screencastStarted = false;
	try {
		await cdp.send("Page.startScreencast", {
			format: "png",
			maxWidth: expectedSize.width,
			maxHeight: expectedSize.height,
			everyNthFrame: 1,
		});
		screencastStarted = true;
		await page.reload({ waitUntil: "domcontentloaded" });
		await waitForSettingsCenterReady(page);
		if (!committed) throw new Error("settings-main-frame-commit-missing");
		await assertSettingsCenterShellAbsent(page);
	} finally {
		try {
			if (screencastStarted) await cdp.send("Page.stopScreencast");
		} finally {
			cdp.off("Page.frameNavigated", handleFrameNavigated);
			cdp.off("Page.screencastFrame", handleScreencastFrame);
			await Promise.all(pendingAcks);
		}
	}
	if (ackErrors.length > 0) throw ackErrors[0];

	const afterVisible = await settingsApplication.isVisible();
	if (!afterVisible) throw new Error("settings-after-reload-not-visible");
	const afterScreenshot = await cdp.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: false,
	});
	if (frames.length > 0) {
		const frameAnalyses = await Promise.all(
			frames.map((frame) =>
				decodeSettingsCenterPng(decoder, frame, expectedSize),
			),
		);
		const nonblankFrameAnalyses = frameAnalyses.filter(
			(analysis) => analysis.whiteRatio < 0.995,
		);
		if (nonblankFrameAnalyses.length === 0) {
			throw new Error("settings-nonblank-frame-missing");
		}
		const frameFingerprintDistances = nonblankFrameAnalyses.map((analysis) =>
			settingsCenterFingerprintDistance(analysis, beforeAnalysis),
		);
		return {
			beforeVisible,
			afterVisible,
			frameBytes: Buffer.byteLength(frames[0], "base64"),
			nonblankFrameCount: nonblankFrameAnalyses.length,
			retainedPixels: false,
			allNonblankFramesMatch: nonblankFrameAnalyses.every((analysis) =>
				matchesSettingsCenterFrame(analysis, beforeAnalysis),
			),
			maxDarkTopRatio: Math.max(
				...nonblankFrameAnalyses.map((analysis) => analysis.darkTopRatio),
			),
			maxFingerprintDistance: Math.max(...frameFingerprintDistances),
			analysis: nonblankFrameAnalyses[0],
		};
	}

	const afterAnalysis = await decodeSettingsCenterPng(
		decoder,
		afterScreenshot.data,
		expectedSize,
	);
	if (beforeAnalysis.pixelHash !== afterAnalysis.pixelHash) {
		throw new Error("settings-retained-pixels-changed");
	}
	return {
		beforeVisible,
		afterVisible,
		frameBytes: 0,
		retainedPixels: true,
		allNonblankFramesMatch: true,
		analysis: afterAnalysis,
		retainedPixelHash: afterAnalysis.pixelHash,
	};
}

test("does not paint the WordPress shell across compositor first-paint quadrants", async ({
	page,
}) => {
	await login(page);
	const decoder = await page.context().newPage();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Page.enable");
	await cdp.send("Network.enable");
	const evidence = [];
	try {
		for (const scenario of SETTINGS_CENTER_FIRST_PAINT_CASES) {
			await page.setViewportSize({
				width: scenario.width,
				height: scenario.height,
			});
			await cdp.send("Network.setCacheDisabled", {
				cacheDisabled: scenario.cacheDisabled,
			});
			await cdp.send("Network.clearBrowserCache");
			await page.goto(SETTINGS_CENTER_FIRST_PAINT_PATH);
			await waitForSettingsCenterReady(page);
			const settingsReference = await decodeSettingsCenterPng(
				decoder,
				(
					await cdp.send("Page.captureScreenshot", {
						format: "png",
						fromSurface: true,
						captureBeyondViewport: false,
					})
				).data,
				{ width: scenario.width, height: scenario.height },
			);
			await page.goto("/wp-admin/profile.php");
			await expect(page.locator("#wpwrap")).toBeVisible();
			const nativeWordPressFrame = await decodeSettingsCenterPng(
				decoder,
				(
					await cdp.send("Page.captureScreenshot", {
						format: "png",
						fromSurface: true,
						captureBeyondViewport: false,
					})
				).data,
				{ width: scenario.width, height: scenario.height },
			);
			expect(
				matchesSettingsCenterFrame(nativeWordPressFrame, settingsReference),
			).toBe(false);
			await page.goto(SETTINGS_CENTER_FIRST_PAINT_PATH);
			await waitForSettingsCenterReady(page);

			for (
				let iteration = 0;
				iteration < SETTINGS_CENTER_FIRST_PAINT_RUNS;
				iteration += 1
			) {
				const result = await captureSettingsCenterNavigationEvidence(
					page,
					cdp,
					decoder,
					{ width: scenario.width, height: scenario.height },
				);
				evidence.push({
					scenario: scenario.name,
					iteration,
					...result,
				});
			}
		}
	} finally {
		await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
		await cdp.detach();
		await decoder.close();
	}

	expect(evidence).toHaveLength(
		SETTINGS_CENTER_FIRST_PAINT_CASES.length * SETTINGS_CENTER_FIRST_PAINT_RUNS,
	);
	for (const scenario of SETTINGS_CENTER_FIRST_PAINT_CASES) {
		const scenarioEvidence = evidence.filter(
			(entry) => entry.scenario === scenario.name,
		);
		expect(scenarioEvidence).toHaveLength(SETTINGS_CENTER_FIRST_PAINT_RUNS);
		for (const entry of scenarioEvidence) {
			expect(entry.beforeVisible).toBe(true);
			expect(entry.afterVisible).toBe(true);
			expect(entry.analysis).toMatchObject({
				width: scenario.width,
				height: scenario.height,
			});
			expect(entry.analysis.darkTopRatio).toBeLessThan(0.35);
			expect(entry.analysis.whiteRatio).toBeLessThan(0.995);
			expect(entry.allNonblankFramesMatch).toBe(true);
			if (entry.retainedPixels) {
				expect(entry.frameBytes).toBe(0);
				expect(entry.retainedPixelHash).toBe(entry.analysis.pixelHash);
			} else {
				expect(entry.frameBytes).toBeGreaterThan(0);
				expect(entry.nonblankFrameCount).toBeGreaterThan(0);
				expect(entry.maxDarkTopRatio).toBeLessThan(0.35);
				expect(entry.maxFingerprintDistance).toBeLessThanOrEqual(
					SETTINGS_CENTER_FRAME_FINGERPRINT_TOLERANCE,
				);
			}
		}
	}
	await waitForSettingsCenterReady(page);
	await expect(page.locator("body")).toHaveClass(
		/easymde-settings-center-document/u,
	);
	await expect(
		page.locator('link[data-easymde-settings-favicon="true"]'),
	).toHaveCount(1);
	await expect(page.locator("#easymde-settings-center-root")).toHaveCount(1);
	await assertSettingsCenterShellAbsent(page);
	await expect(page.locator("[data-settings-center-startup]")).toHaveCount(0);
	await expect(
		page.locator("[data-settings-center-server-fallback]"),
	).toHaveCount(0);
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
		await expect(page.locator("[data-settings-center-startup]")).toHaveCount(0);
		await expect(page.locator("#wpwrap")).toHaveCount(0);
		await expect(page.locator("#wpadminbar")).toHaveCount(0);
		await expect(page.locator("#adminmenu")).toHaveCount(0);
		const fallback = page.locator("[data-settings-center-server-fallback]");
		await expect(fallback).toBeVisible();
		await expect(fallback).toHaveAttribute("role", "alert");
		await expect(fallback).toContainText(/could not start|无法启动/iu);
		await expect(fallback).not.toContainText(/Loading|正在加载/iu);
		const exit = fallback.locator("a");
		await expect(exit).toBeVisible();
		await exit.click();
		await expect(page).toHaveURL(/\/wp-admin\/options-general\.php$/u);
		await expect(page.locator("#wpwrap")).toBeVisible();
	} finally {
		await page.unroute(settingsBundle);
	}
});

test("keeps a dedicated exit when the Settings Center stylesheet cannot load", async ({
	page,
}) => {
	await login(page);
	const settingsStylesheet = (url) =>
		url.pathname.endsWith("/assets/css/admin/settings-center.css");

	await page.route(settingsStylesheet, (route) => route.abort("failed"));
	try {
		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toHaveCount(0);
		await expect(page.locator("#wpwrap")).toHaveCount(0);
		await expect(page.locator("#wpadminbar")).toHaveCount(0);
		await expect(page.locator("#adminmenu")).toHaveCount(0);
		const error = page.locator(
			'#easymde-settings-center-root [role="alert"]',
		);
		await expect(error).toBeVisible();
		await expect(error).toContainText(/could not start|无法启动/iu);
		const exit = error.locator("a");
		await expect(exit).toBeVisible();
		await exit.click();
		await expect(page).toHaveURL(/\/wp-admin\/options-general\.php$/u);
		await expect(page.locator("#wpwrap")).toBeVisible();
	} finally {
		await page.unroute(settingsStylesheet);
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
		await expect(page.locator("[data-settings-center-startup]")).toHaveCount(0);
		await expect(page.locator("#wpwrap")).toHaveCount(0);
		await expect(page.locator("#wpadminbar")).toHaveCount(0);
		await expect(page.locator("#adminmenu")).toHaveCount(0);
		const fallback = page.locator("[data-settings-center-server-fallback]");
		await expect(fallback).toBeVisible();
		await expect(fallback).toHaveAttribute("role", "alert");
		await expect(fallback).not.toContainText(/Loading|正在加载/iu);
		const exit = fallback.locator("a");
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

test("runs the image-hosting interaction contract without exposing credentials", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	const verificationPayloads = [];
	let originalImageHostingEnabled;
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
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await setImageHostingEnabled(page, false);
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
		await setImageHostingEnabled(page, true);
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
				window.EasyMDESettingsCenterBootstrap.strings
					.uploadVerificationSucceeded,
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
		await expect(successDialog).toHaveCSS("box-sizing", "border-box");
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
		await expect(uploadVerificationStatus).toHaveAttribute(
			"data-state",
			"stale",
		);
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
		for (let index = 0; index < 3; index += 1)
			await formats.nth(index).uncheck();
		await formats.nth(3).click();
		await expect(formats.nth(3)).toBeChecked();
		const uploadFormatRequired = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings.uploadFormatRequired,
		);
		await expect(page.getByText(uploadFormatRequired)).toBeVisible();

		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
	} finally {
		releaseFirstVerification();
		if (typeof originalImageHostingEnabled === "boolean") {
			await setImageHostingEnabled(page, originalImageHostingEnabled);
		}
	}
});

test("persists the bounded upload retry count across a settings-center refresh", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	let originalImageHostingEnabled;
	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await setImageHostingEnabled(page, true);
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
		const saveFeedbackStrings = await page.evaluate(() => ({
			close:
				window.EasyMDESettingsCenterBootstrap.strings.closeSettingsFeedback,
			saved: window.EasyMDESettingsCenterBootstrap.strings.settingsSaved,
		}));
		const saveFeedback = page
			.getByRole("status")
			.filter({ hasText: saveFeedbackStrings.saved });
		await expect(saveFeedback).toBeVisible();
		await expect(
			saveFeedback.getByRole("button", { name: saveFeedbackStrings.close }),
		).toBeVisible();
		await expect(page.locator("[data-save-status]")).toHaveAttribute(
			"data-save-status",
			"saved",
		);

		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		await expect(
			page.getByRole("spinbutton", { name: retryLabel }),
		).toHaveValue(testRetryCount);

		await page
			.getByRole("spinbutton", { name: retryLabel })
			.fill(originalRetryCount);
		await page.getByRole("button", { name: /保存设置|Save Settings/u }).click();
		await expect(page.locator("[data-save-status]")).toHaveAttribute(
			"data-save-status",
			"saved",
		);
	} finally {
		if (typeof originalImageHostingEnabled === "boolean") {
			await setImageHostingEnabled(page, originalImageHostingEnabled);
		}
	}
});

test("reports a real settings save network failure in the shared message popup", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	const strings = await page.evaluate(() =>
		window.EasyMDESettingsCenterBootstrap.strings,
	);
	await page.route("**/wp-json/easymde/v1/settings", async (route) => {
		if (route.request().method() === "POST") {
			await route.abort("failed");
			return;
		}
		await route.continue();
	});

	await page
		.getByRole("switch", { name: strings.showLineNumbers })
		.click();
	const saveButton = page.getByRole("button", { name: strings.saveSettings });
	await saveButton.click();
	const feedback = page
		.getByRole("alert")
		.filter({ hasText: strings.settingsSaveNetworkFailed });
	await expect(feedback).toBeVisible();
	await expect(saveButton).toBeEnabled();
	await expect(
		page.getByRole("status").filter({ hasText: strings.settingsSaved }),
	).toHaveCount(0);
	await feedback
		.getByRole("button", { name: strings.closeSettingsFeedback })
		.click();
	await expect(feedback).toHaveCount(0);
	await page.unroute("**/wp-json/easymde/v1/settings");
});

test("keeps the maximum image size unit inside the horizontal stepper", async ({
	page,
}) => {
	const browserFailures = [];
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type())) {
			const sourceUrl = message.location().url;
			if (
				sourceUrl &&
				new URL(sourceUrl, page.url()).origin !== new URL(page.url()).origin
			) {
				return;
			}
			browserFailures.push(`${message.type()}: ${message.text()}`);
		}
	});
	page.on("pageerror", (error) =>
		browserFailures.push(`pageerror: ${error.message}`),
	);
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
	const systemLimitWarning = page.getByRole("alert").filter({
		hasText: /系统当前允许上传|current system upload limit/u,
	});
	const decrement = page.getByRole("button", { name: `${label} - 1` });
	const increment = page.getByRole("button", { name: `${label} + 1` });
	const originalValue = await input.inputValue();
	const systemMaxBytes = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.uploadLimits.systemMaxBytes,
	);
	const bytesPerMegabyte = 1024 * 1024;
	const maximumConfigurableSizeMb = Number(await input.getAttribute("max"));
	expect(maximumConfigurableSizeMb).toBe(10);
	expect(systemMaxBytes).toBeLessThan(
		maximumConfigurableSizeMb * bytesPerMegabyte,
	);
	const warningValue = Math.floor(systemMaxBytes / bytesPerMegabyte) + 1;

	const assertGeometry = async (viewportWidth) => {
		await expect(stepper.locator(":scope > *")).toHaveCount(3);
		await expect(unit).toHaveText("M");
		const typography = await Promise.all([
			input.evaluate((element) => getComputedStyle(element).fontSize),
			unit.evaluate((element) => getComputedStyle(element).fontSize),
		]);
		expect(typography).toEqual(["15.5px", "15px"]);
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
		const [decrementBox, valueBox, unitBox, incrementBox, stepperBox] =
			geometry;
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
	const assertWarningGeometry = async () => {
		await expect(systemLimitWarning.locator("svg circle")).toHaveCount(1);
		await expect(systemLimitWarning.locator("svg line")).toHaveCount(2);
		const geometry = await Promise.all([
			systemLimitWarning.boundingBox(),
			systemLimitWarning.locator("svg").boundingBox(),
			systemLimitWarning.locator(":scope > span").boundingBox(),
		]);
		if (geometry.some((box) => !box)) {
			throw new Error("maximum-image-size-warning-geometry-missing");
		}
		const [warningBox, iconBox, textBox] = geometry;
		expect(iconBox.x).toBeGreaterThanOrEqual(warningBox.x);
		expect(iconBox.x + iconBox.width).toBeLessThan(textBox.x);
		expect(Math.abs(iconBox.y - textBox.y)).toBeLessThanOrEqual(1.5);
		expect(textBox.x + textBox.width).toBeLessThanOrEqual(
			warningBox.x + warningBox.width + 0.5,
		);
		expect(
			await systemLimitWarning.evaluate(
				(element) =>
					element.scrollWidth <= element.clientWidth &&
					element.scrollHeight <= element.clientHeight,
			),
		).toBe(true);
	};

	await input.fill(String(warningValue));
	try {
		await expect(systemLimitWarning).toBeVisible();
		await assertGeometry(1152);
		await assertWarningGeometry();
		const warningStyles = await Promise.all([
			systemLimitWarning.evaluate((element) => ({
				color: getComputedStyle(element).color,
				display: getComputedStyle(element).display,
			})),
			systemLimitWarning
				.locator("svg")
				.evaluate((element) => getComputedStyle(element).color),
		]);
		expect(warningStyles).toEqual([
			{ color: "rgb(180, 35, 24)", display: "flex" },
			"rgb(180, 35, 24)",
		]);
		if (warningValue < maximumConfigurableSizeMb) {
			await increment.click();
			await expect(input).toHaveValue(String(warningValue + 1));
		} else {
			await decrement.click();
			await expect(input).toHaveValue(String(warningValue - 1));
		}
		await input.fill(String(warningValue));

		await page.setViewportSize({ width: 390, height: 844 });
		await assertGeometry(390);
		await assertWarningGeometry();
		const cdp = await page.context().newCDPSession(page);
		const metrics = await cdp.send("Page.getLayoutMetrics");
		expect(metrics.cssLayoutViewport.clientWidth).toBe(390);
		await cdp.detach();
		expect(browserFailures).toEqual([]);
	} finally {
		await input.fill(originalValue);
	}
	await expect(input).toHaveValue(originalValue);
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
		expect(geometry.menuRight).toBeLessThanOrEqual(
			geometry.viewportWidth - 12,
		);
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
		await expect(immersiveHeadingTrigger).toHaveAttribute("title", headingLabel);
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
				name: strings.fileNameRule,
				exact: true,
			}),
		).toHaveValue("{year}/{month}/{md5}.{ext}");
		await expect(
			page.getByRole("button", {
				name: strings.fileNamePresetMd5,
				exact: true,
			}),
		).toHaveAttribute("aria-pressed", "true");

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
			const sourceEditor = page.locator(
				".easymde-source-react .cm-content",
			);
			const postId = Number(await page.locator("#post_ID").inputValue());
			const originalUrl = `https://source.synthetic.test/${mode}.png`;
			const altText = `Remote ${mode}`;
			const markdown = `![${altText}](${originalUrl})`;
			const previousRequestCount = importRequests.length;
			await sourceEditor.fill("Before ");
			await sourceEditor.focus();
			await sourceEditor.press("End");
			await dispatchBrowserPaste(sourceEditor, { plainText: markdown });
			await expect.poll(() => importRequests.length).toBe(
				previousRequestCount + 1,
			);
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
			const sourceEditor = page.locator(
				".easymde-source-react .cm-content",
			);
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
	const schemeMismatchUrl = "http://images.example.test/not-the-primary-origin.png";
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
			page
				.getByRole("status")
				.filter({ hasText: strings.pasteAlreadyHosted }),
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
		const sourceEditor = page.locator(
			".easymde-source-react .cm-content",
		);
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
		const boundaryEditor = page.locator(
			".easymde-source-react .cm-content",
		);
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

test("persists the pasted-image upload switch and restores its prior value", async ({
	page,
}) => {
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	await page.locator('button[data-nav-id="images"]').click();

	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	const saveButton = page.locator(
		".easymde-settings-center__save-bar > button",
	);
	const saveStatus = page.locator("[data-save-status]");
	let originalImageHostingEnabled;
	const pastedImageUpload = () =>
		page.getByRole("switch", {
			name: strings.autoUploadPastedImages,
			exact: true,
		});
	const initialValue = await pastedImageUpload().getAttribute("aria-checked");
	if (initialValue !== "true" && initialValue !== "false") {
		throw new Error("settings-center-pasted-image-upload-state-missing");
	}
	const changedValue = initialValue === "true" ? "false" : "true";
	const dispatchPastedImage = async (sourceEditor) => {
		await sourceEditor.evaluate((element) => {
			const bytes = Uint8Array.from(
				atob(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				),
				(character) => character.charCodeAt(0),
			);
			const file = new File([bytes], "paste.png", { type: "image/png" });
			const event = new Event("paste", { bubbles: true, cancelable: true });
			Object.defineProperty(event, "clipboardData", {
				value: {
					files: [file],
					items: [
						{
							getAsFile: () => file,
							kind: "file",
							type: "image/png",
						},
					],
				},
			});
			element.dispatchEvent(event);
		});
	};
	const save = async () => {
		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(saveStatus).toHaveAttribute("data-save-status", /saved|idle/u);
		await expect(saveButton).toBeDisabled();
	};

	try {
		originalImageHostingEnabled = await readImageHostingEnabled(page);
		await setImageHostingEnabled(page, true);
		await pastedImageUpload().click();
		await expect(pastedImageUpload()).toHaveAttribute(
			"aria-checked",
			changedValue,
		);
		await save();
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		await expect(pastedImageUpload()).toHaveAttribute(
			"aria-checked",
			changedValue,
		);

		if (changedValue !== "false") {
			await pastedImageUpload().click();
			await save();
		}
		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const source = page.locator("#easymde-source");
		const sourceEditor = page.locator(".easymde-source-react .cm-content");
		const pasteUploadDisabled = await page.evaluate(
			() =>
				window.EasyMDEEditorRootBootstrap.imageUpload.strings
					.pasteUploadDisabled,
		);
		const uploadRequests = [];
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				new URL(request.url()).pathname.endsWith(
					"/easymde/v1/image-hosting/upload",
				)
			) {
				uploadRequests.push(request.url());
			}
		});
		await sourceEditor.fill("Paste guard");
		await dispatchPastedImage(sourceEditor);
		await expect(
			page.getByRole("status").filter({ hasText: pasteUploadDisabled }),
		).toBeVisible();
		await expect(source).toHaveValue("Paste guard");
		expect(uploadRequests).toHaveLength(0);

		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		await pastedImageUpload().click();
		await expect(pastedImageUpload()).toHaveAttribute("aria-checked", "true");
		await save();
		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const enabledSource = page.locator("#easymde-source");
		const enabledSourceEditor = page.locator(
			".easymde-source-react .cm-content",
		);
		const pasteFailed = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.pasteFailed,
		);
		await enabledSourceEditor.fill("Paste enabled guard");
		await dispatchPastedImage(enabledSourceEditor);
		await expect.poll(() => uploadRequests.length).toBe(1);
		await expect(
			page.getByRole("alert").filter({ hasText: pasteFailed }),
		).toBeVisible();
		await expect(enabledSource).toHaveValue("Paste enabled guard");
	} finally {
		if (typeof originalImageHostingEnabled === "boolean") {
			await setImageHostingEnabled(page, originalImageHostingEnabled);
		}
		await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		if (
			(await pastedImageUpload().getAttribute("aria-checked")) !== initialValue
		) {
			await pastedImageUpload().click();
			await save();
		}
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		await expect(pastedImageUpload()).toHaveAttribute(
			"aria-checked",
			initialValue,
		);
	}
});

test("image hosting is opt-in and disabled local uploads use WordPress media", async ({
	page,
}) => {
	const browserFailures = [];
	const mediaRequests = [];
	const imageHostingRequests = [];
	const uploadedAttachmentIds = [];
	const settingsPath = "/wp-admin/admin.php?page=easymde&route=/general_setting";
	const gravatarPattern = /^https:\/\/secure\.gravatar\.com\//u;
	const routeMatches = (value, routePath) => {
		const url = new URL(String(value));
		return url.pathname.endsWith(routePath)
			|| (url.searchParams.get("rest_route") || "").endsWith(
				routePath.replace("/wp-json", ""),
			);
	};
	const blockImageHosting = (url) =>
		routeMatches(url, "/wp-json/easymde/v1/image-hosting/upload")
		|| routeMatches(url, "/wp-json/easymde/v1/image-hosting/import");

	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type())) {
			browserFailures.push(
				`${message.type()}:${message.location().url}:${message.text()}`,
			);
		}
	});
	page.on("pageerror", (error) =>
		browserFailures.push(`pageerror:${error.message}`),
	);
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			routeMatches(request.url(), "/wp-json/easymde/v1/media")
		) {
			mediaRequests.push(request);
		}
		if (blockImageHosting(request.url())) imageHostingRequests.push(request);
	});
	await page.route(blockImageHosting, (route) =>
		route.abort("blockedbyclient"),
	);
	await page.route(gravatarPattern, (route) =>
		route.fulfill({
			body: Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				"base64",
			),
			contentType: "image/png",
			status: 200,
		}),
	);

	let originalImageHostingEnabled;
	let originalFileNameRule;
	let restNonce;
	let testError;
	try {
		await login(page);
		await page.goto(settingsPath);
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		const images = page.locator('[data-settings-section="images"]');
		let strings = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings,
		);
		let toggle = page.getByRole("switch", {
			name: strings.enableImageHosting,
			exact: true,
		});
		originalImageHostingEnabled = await page.evaluate(
			() =>
				window.EasyMDESettingsCenterBootstrap.settings.images
					.imageHostingEnabled,
		);
		await setImageHostingEnabled(page, false);
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		strings = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings,
		);
		toggle = page.getByRole("switch", {
			name: strings.enableImageHosting,
			exact: true,
		});
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		const fileNameRule = page.getByRole("textbox", {
			name: strings.fileNameRule,
			exact: true,
		});
		originalFileNameRule = await fileNameRule.inputValue();
		await expect(fileNameRule).toBeEnabled();
		await expect(
			images.getByText(strings.fileNameRuleDescription, { exact: true }),
		).toBeVisible();
		await expect(
			images.locator(
				".easymde-settings-center__file-name-presets > button",
			),
		).toHaveCount(6);
		await expect(
			images.locator(
				".easymde-settings-center__file-name-variables button",
			),
		).toHaveCount(10);
		await expect(
			images.locator(
				".easymde-settings-center__file-name-preview code",
			),
		).toHaveText("2026/07/a8f4c2d1.webp");
		const editedFileNameRule = "disabled/{date}/{uuid}.{ext}";
		await fileNameRule.fill(editedFileNameRule);
		await expect(fileNameRule).toHaveValue(editedFileNameRule);
		await expect(
			page.getByRole("combobox", {
				name: strings.selectImageHostService,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", {
				name: strings.verifyPrimaryUpload,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", {
				name: strings.backupImageHost,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("combobox", {
				name: strings.remoteImageUploadMode,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("switch", {
				name: strings.compressImages,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("switch", {
				name: strings.autoUploadPastedImages,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("combobox", {
				name: strings.imageTitleDisplay,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("spinbutton", {
				name: strings.maximumImageSize,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("checkbox", {
				name: strings.allowUploadPng,
				exact: true,
			}),
		).toBeVisible();

		await toggle.focus();
		await page.keyboard.press("Space");
		await expect(toggle).toBeFocused();
		await expect(toggle).toHaveAttribute("aria-checked", "true");
		await saveSettingsCenter(page);
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		strings = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings,
		);
		toggle = page.getByRole("switch", {
			name: strings.enableImageHosting,
			exact: true,
		});
		await expect(toggle).toHaveAttribute("aria-checked", "true");
		await expect(
			page.getByRole("combobox", {
				name: strings.selectImageHostService,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: strings.verifyPrimaryUpload,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("textbox", {
				name: strings.fileNameRule,
				exact: true,
			}),
		).toHaveValue(editedFileNameRule);
		await expect(
			page.getByRole("heading", {
				name: strings.backupImageHost,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("combobox", {
				name: strings.remoteImageUploadMode,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("switch", {
				name: strings.compressImages,
				exact: true,
			}),
		).toBeVisible();
		expect(
			await page.evaluate(
				() =>
					window.EasyMDESettingsCenterBootstrap.settings.images
						.imageHostingEnabled,
			),
		).toBe(true);

		const backupToggle = page.getByRole("switch", {
			name: strings.enableBackupImageHost,
			exact: true,
		});
		const originalBackupEnabled =
			await backupToggle.getAttribute("aria-checked");
		if (originalBackupEnabled !== "true" && originalBackupEnabled !== "false") {
			throw new Error("settings-center-backup-hosting-state-missing");
		}
		if (originalBackupEnabled === "false") {
			await backupToggle.focus();
			await page.keyboard.press("Space");
			await expect(backupToggle).toHaveAttribute("aria-checked", "true");
		}
		await expect(
			page.getByRole("textbox", {
				name: strings.backupBucket,
				exact: true,
			}),
		).toBeVisible();
		await backupToggle.focus();
		await page.keyboard.press("Space");
		await expect(backupToggle).toBeFocused();
		await expect(backupToggle).toHaveAttribute("aria-checked", "false");
		await expect(
			page.getByRole("textbox", {
				name: strings.backupBucket,
				exact: true,
			}),
		).toHaveCount(0);
		if (originalBackupEnabled === "true") {
			await backupToggle.focus();
			await page.keyboard.press("Space");
			await expect(backupToggle).toHaveAttribute("aria-checked", "true");
		}

		await toggle.focus();
		await page.keyboard.press("Space");
		await expect(toggle).toBeFocused();
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		await expect(
			page.getByRole("combobox", {
				name: strings.selectImageHostService,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", {
				name: strings.backupImageHost,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("combobox", {
				name: strings.remoteImageUploadMode,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("switch", {
				name: strings.compressImages,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("textbox", {
				name: strings.fileNameRule,
				exact: true,
			}),
		).toHaveValue(editedFileNameRule);
		await saveSettingsCenter(page);
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		await page.locator('button[data-nav-id="images"]').click();
		strings = await page.evaluate(
			() => window.EasyMDESettingsCenterBootstrap.strings,
		);
		toggle = page.getByRole("switch", {
			name: strings.enableImageHosting,
			exact: true,
		});
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		await expect(
			page.getByRole("textbox", {
				name: strings.fileNameRule,
				exact: true,
			}),
		).toHaveValue(editedFileNameRule);

		await page.goto("/wp-admin/post-new.php");
		await expect(page.locator("#easymde-editor")).toBeVisible();
		const bootstrap = await page.evaluate(() => ({
			endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
			importEndpoint:
				window.EasyMDEEditorRootBootstrap.imageUpload.importEndpoint,
			nonce: window.EasyMDEEditorRootBootstrap.imageUpload.nonce,
			remoteImageUploadMode:
				window.EasyMDEEditorRootBootstrap.imageUpload.remoteImageUploadMode,
			uploadOwner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner,
		}));
		restNonce = bootstrap.nonce;
		expect(bootstrap.uploadOwner).toBe("media");
		expect(
			routeMatches(bootstrap.endpoint, "/wp-json/easymde/v1/media"),
		).toBe(true);
		expect(
			routeMatches(
				bootstrap.importEndpoint,
				"/wp-json/easymde/v1/image-hosting/import",
			),
		).toBe(true);
		expect(bootstrap.remoteImageUploadMode).toBe("off");

		const source = page.locator("#easymde-source");
		const sourceEditor = page.locator(".easymde-source-react .cm-content");
		await sourceEditor.fill("Local upload baseline");
		await sourceEditor.focus();
		await sourceEditor.press("End");
		const mediaResponse = page.waitForResponse((response) =>
			response.request().method() === "POST"
				&& routeMatches(response.url(), "/wp-json/easymde/v1/media"),
		);
		await sourceEditor.evaluate((editor) => {
			const binary = atob(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			);
			const bytes = Uint8Array.from(binary, (character) =>
				character.charCodeAt(0),
			);
			const transfer = new DataTransfer();
			transfer.items.add(
				new File([bytes], "synthetic-png.png", { type: "image/png" }),
			);
			editor.dispatchEvent(
				new DragEvent("drop", {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
				}),
			);
		});
		const response = await mediaResponse;
		expect(response.status()).toBe(200);
		const result = await response.json();
		expect(result.id).toEqual(expect.any(Number));
		uploadedAttachmentIds.push(result.id);
		expect(result.url).toMatch(
			/\/wp-content\/uploads\/disabled\/\d{8}\/[a-f0-9-]{36}\.png$/u,
		);
		const attachmentResponse = await page.request.get(
			`/wp-json/wp/v2/media/${result.id}`,
			{ headers: { "X-WP-Nonce": restNonce } },
		);
		expect(attachmentResponse.status()).toBe(200);
		const attachment = await attachmentResponse.json();
		expect(attachment.source_url).toBe(result.url);
		expect(attachment.media_details.file).toMatch(
			/^disabled\/\d{8}\/[a-f0-9-]{36}\.png$/u,
		);
		const uploadedFileResponse = await page.request.get(result.url);
		expect(uploadedFileResponse.status()).toBe(200);
		await expect(source).toHaveValue(
			`Local upload baseline![synthetic png](${result.url})`,
		);
		expect(mediaRequests).toHaveLength(1);
		expect(imageHostingRequests).toHaveLength(0);
		expect(browserFailures).toEqual([]);
	} catch (error) {
		testError = error;
	}

	const cleanupFailures = [];
	if (originalImageHostingEnabled !== undefined) {
		try {
			await openSettingsSection(page, "images");
			const strings = await page.evaluate(
				() => window.EasyMDESettingsCenterBootstrap.strings,
			);
			const toggle = page.getByRole("switch", {
				name: strings.enableImageHosting,
				exact: true,
			});
			if (
				(await toggle.getAttribute("aria-checked")) !==
				String(originalImageHostingEnabled)
			) {
				await toggle.focus();
				await page.keyboard.press("Space");
				await saveSettingsCenter(page);
			}
			if (typeof originalFileNameRule === "string") {
				const fileNameRule = page.getByRole("textbox", {
					name: strings.fileNameRule,
					exact: true,
				});
				if ((await fileNameRule.inputValue()) !== originalFileNameRule) {
					await fileNameRule.fill(originalFileNameRule);
					await saveSettingsCenter(page);
				}
			}
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
	for (const attachmentId of uploadedAttachmentIds) {
		try {
			const response = await page.request.delete(
				`/wp-json/wp/v2/media/${attachmentId}?force=true`,
				{ headers: { "X-WP-Nonce": restNonce } },
			);
			if (!response.ok()) {
				cleanupFailures.push(
					new Error(`e2e-media-cleanup-http-${response.status()}`),
				);
			}
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
	try {
		await page.unroute(blockImageHosting);
	} catch (error) {
		cleanupFailures.push(error);
	}
	try {
		await page.unroute(gravatarPattern);
	} catch (error) {
		cleanupFailures.push(error);
	}
	if (testError) {
		if (cleanupFailures.length) {
			throw new AggregateError(
				[testError, ...cleanupFailures],
				"Image hosting E2E test and cleanup failed.",
			);
		}
		throw testError;
	}
	if (cleanupFailures.length) {
		throw new AggregateError(cleanupFailures, "Image hosting E2E cleanup failed.");
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
