import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import {
	expectNear,
	login,
	openSettingsSection,
	readImageHostingEnabled,
	readWechatPngExportEnabled,
	saveSettingsCenter,
	setImageHostingEnabled,
	setWechatPngExportEnabled,
} from "../helpers/settings-center-helpers.mjs";

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
			fileNameRule: window.EasyMDESettingsCenterBootstrap.strings.fileNameRule,
			storagePath: window.EasyMDESettingsCenterBootstrap.strings.storagePath,
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

		const storagePath = primary.getByRole("textbox", {
			name: verificationStrings.storagePath,
			exact: true,
		});
		await storagePath.fill(`${await storagePath.inputValue()}/draft`);
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
		expect(verificationPayloads[1].settings.storagePath).toBe(
			await storagePath.inputValue(),
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

		const rule = primary.getByRole("textbox", {
			name: verificationStrings.fileNameRule,
			exact: true,
		});
		await primary
			.locator(
				'.easymde-settings-center__file-name-presets [data-preset-index="1"]',
			)
			.click();
		await expect(rule).toHaveValue("{md5}");
		await expect(storagePath).toHaveValue("{year}/{month}");
		await rule.fill(".");
		await primary
			.locator(".easymde-settings-center__file-name-variables button")
			.last()
			.click();
		await expect(rule).toHaveValue(".{name}");

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
		for (let index = 0; index < 6; index += 1) {
			const format = formats.nth(index);
			if (!(await format.isChecked())) await format.check();
		}
		for (let index = 0; index < 5; index += 1)
			await formats.nth(index).uncheck();
		await formats.nth(5).click();
		await expect(formats.nth(5)).toBeChecked();
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

test("persists the WeChat PNG conversion switch and restores its prior value", async ({
	page,
}) => {
	await login(page);
	const initialValue = await readWechatPngExportEnabled(page);
	const changedValue = !initialValue;

	try {
		await setWechatPngExportEnabled(page, changedValue);
		await page.reload();
		await expect(page.locator(".easymde-settings-center")).toBeVisible();
		expect(await readWechatPngExportEnabled(page)).toBe(changedValue);
	} finally {
		await setWechatPngExportEnabled(page, initialValue);
	}
});

test("image hosting is opt-in and disabled local uploads use WordPress media", async ({
	page,
}) => {
	const browserFailures = [];
	const mediaRequests = [];
	const imageHostingRequests = [];
	const uploadedAttachmentIds = [];
	const settingsPath =
		"/wp-admin/admin.php?page=easymde&route=/general_setting";
	const gravatarPattern = /^https:\/\/secure\.gravatar\.com\//u;
	const routeMatches = (value, routePath) => {
		const url = new URL(String(value));
		return (
			url.pathname.endsWith(routePath) ||
			(url.searchParams.get("rest_route") || "").endsWith(
				routePath.replace("/wp-json", ""),
			)
		);
	};
	const blockImageHosting = (url) =>
		routeMatches(url, "/wp-json/easymde/v1/image-hosting/upload") ||
		routeMatches(url, "/wp-json/easymde/v1/image-hosting/import");

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
	let originalStoragePath;
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
		const storagePath = page.getByRole("textbox", {
			name: strings.storagePath,
			exact: true,
		});
		originalStoragePath = await storagePath.inputValue();
		originalFileNameRule = await fileNameRule.inputValue();
		await expect(storagePath).toBeEnabled();
		await expect(fileNameRule).toBeEnabled();
		await expect(
			images.getByText(strings.storagePathDescription, { exact: true }),
		).toBeVisible();
		await expect(
			images.getByText(strings.fileNameRuleDescription, { exact: true }),
		).toBeVisible();
		await expect(
			images.locator(".easymde-settings-center__file-name-presets > button"),
		).toHaveCount(6);
		await expect(
			images.locator(".easymde-settings-center__file-name-variables button"),
		).toHaveCount(9);
		await expect(
			images.locator(".easymde-settings-center__file-name-preview code"),
		).toHaveText("2026/07/a8f4c2d1.webp");
		const editedStoragePath = "disabled/{date}";
		const editedFileNameRule = "{uuid}";
		await storagePath.fill(editedStoragePath);
		await fileNameRule.fill(editedFileNameRule);
		await expect(storagePath).toHaveValue(editedStoragePath);
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
				name: strings.storagePath,
				exact: true,
			}),
		).toHaveValue(editedStoragePath);
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
				name: strings.storagePath,
				exact: true,
			}),
		).toHaveValue(editedStoragePath);
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
				name: strings.storagePath,
				exact: true,
			}),
		).toHaveValue(editedStoragePath);
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
		expect(routeMatches(bootstrap.endpoint, "/wp-json/easymde/v1/media")).toBe(
			true,
		);
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
		const mediaResponse = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				routeMatches(response.url(), "/wp-json/easymde/v1/media"),
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
			if (
				typeof originalStoragePath === "string" &&
				typeof originalFileNameRule === "string"
			) {
				const storagePath = page.getByRole("textbox", {
					name: strings.storagePath,
					exact: true,
				});
				const fileNameRule = page.getByRole("textbox", {
					name: strings.fileNameRule,
					exact: true,
				});
				if (
					(await storagePath.inputValue()) !== originalStoragePath ||
					(await fileNameRule.inputValue()) !== originalFileNameRule
				) {
					await storagePath.fill(originalStoragePath);
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
		throw new AggregateError(
			cleanupFailures,
			"Image hosting E2E cleanup failed.",
		);
	}
});
