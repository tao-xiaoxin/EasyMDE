import { performance } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import {
	SETTINGS_CENTER_FIRST_PAINT_ALL_CASES,
	SETTINGS_CENTER_FIRST_PAINT_CASES,
	SETTINGS_CENTER_FIRST_PAINT_EXPECTED_CASE_COUNT,
	SETTINGS_CENTER_FIRST_PAINT_PATH,
	SETTINGS_CENTER_FIRST_PAINT_RUNS,
	SETTINGS_CENTER_FIRST_PAINT_STDOUT_PREFIX,
	SETTINGS_CENTER_FIRST_PAINT_TIMEOUT_MS,
	SETTINGS_CENTER_FRAME_FINGERPRINT_TOLERANCE,
	assertSettingsCenterShellAbsent,
	captureSettingsCenterNavigationEvidence,
	captureSettingsCenterScreenshot,
	matchesSettingsCenterFrame,
	prepareSettingsCenterFirstPaintCase,
	restoreSettingsCenterBrowserConditions,
	selectSettingsCenterFirstPaintPublicEvidence,
	waitForSettingsCenterReady,
	withSettingsCenterBrowserConditions,
} from "../helpers/settings-center-first-paint-helpers.mjs";
import {
	expectRemovedSettingsPage,
	login,
} from "../helpers/settings-center-helpers.mjs";

test("does not paint the WordPress shell across desktop/mobile, cold/warm, normal/hard, and baseline/throttled compositor combinations", async ({
	page,
}, testInfo) => {
	test.setTimeout(SETTINGS_CENTER_FIRST_PAINT_TIMEOUT_MS);
	await login(page);
	const decoder = await page.context().newPage();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Page.enable");
	await cdp.send("Network.enable");
	const evidence = [];
	try {
		for (const scenario of SETTINGS_CENTER_FIRST_PAINT_CASES) {
			await withSettingsCenterBrowserConditions(
				cdp,
				scenario.profile,
				scenario.cacheMode,
				async () => {
					await prepareSettingsCenterFirstPaintCase(page, cdp, scenario);
					const expectedSize = {
						width: scenario.viewport.width,
						height: scenario.viewport.height,
					};
					const settingsReference = await captureSettingsCenterScreenshot(
						cdp,
						decoder,
						expectedSize,
					);
					await page.goto("/wp-admin/profile.php");
					await expect(page.locator("#wpwrap")).toBeVisible();
					const nativeWordPressFrame = await captureSettingsCenterScreenshot(
						cdp,
						decoder,
						expectedSize,
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
						const startedAt = performance.now();
						const result = await captureSettingsCenterNavigationEvidence(
							page,
							cdp,
							decoder,
							expectedSize,
							scenario.refreshMode,
							scenario,
						);
						const durationMs = Math.round(performance.now() - startedAt);
						const stableState = result.retainedPixels
							? "settings-retained"
							: "settings-painted";
						evidence.push({
							caseName: scenario.name,
							viewportMode: scenario.viewport.name,
							cacheMode: scenario.cacheMode.name,
							refreshMode: scenario.refreshMode.name,
							profileMode: scenario.profile.name,
							iteration,
							durationMs,
							stableState,
							...result,
						});
					}
				},
			);
		}
	} finally {
		try {
			await restoreSettingsCenterBrowserConditions(cdp);
		} finally {
			try {
				await cdp.detach();
			} finally {
				await decoder.close();
			}
		}
	}

	expect(evidence).toHaveLength(
		SETTINGS_CENTER_FIRST_PAINT_CASES.length * SETTINGS_CENTER_FIRST_PAINT_RUNS,
	);
	expect(SETTINGS_CENTER_FIRST_PAINT_ALL_CASES).toHaveLength(16);
	expect(SETTINGS_CENTER_FIRST_PAINT_CASES).toHaveLength(
		SETTINGS_CENTER_FIRST_PAINT_EXPECTED_CASE_COUNT,
	);
	for (const scenario of SETTINGS_CENTER_FIRST_PAINT_CASES) {
		const scenarioEvidence = evidence.filter(
			(entry) => entry.caseName === scenario.name,
		);
		expect(scenarioEvidence).toHaveLength(SETTINGS_CENTER_FIRST_PAINT_RUNS);
		for (const entry of scenarioEvidence) {
			expect(entry).toMatchObject({
				caseName: scenario.name,
				viewportMode: scenario.viewport.name,
				cacheMode: scenario.cacheMode.name,
				refreshMode: scenario.refreshMode.name,
				profileMode: scenario.profile.name,
			});
			expect(Number.isFinite(entry.durationMs)).toBe(true);
			expect(entry.durationMs).toBeGreaterThanOrEqual(0);
			expect(entry.stableState).toBe(
				entry.retainedPixels ? "settings-retained" : "settings-painted",
			);
			expect(entry.beforeVisible).toBe(true);
			expect(entry.afterVisible).toBe(true);
			expect(entry.analysis).toMatchObject({
				width: scenario.viewport.width,
				height: scenario.viewport.height,
			});
			expect(entry.analysis.darkTopRatio).toBeLessThan(0.35);
			expect(entry.analysis.whiteRatio).toBeLessThan(0.995);
			expect(entry.allFramesMatch).toBe(true);
			expect(entry.leadingBlankFrameCount).toBeGreaterThanOrEqual(0);
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
	const publicEvidence = selectSettingsCenterFirstPaintPublicEvidence(evidence);
	await testInfo.attach("settings-center-first-paint-evidence.json", {
		body: JSON.stringify(publicEvidence),
		contentType: "application/json",
	});
	process.stdout.write(
		`${SETTINGS_CENTER_FIRST_PAINT_STDOUT_PREFIX}${JSON.stringify(publicEvidence)}\n`,
	);
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
		const error = page.locator('#easymde-settings-center-root [role="alert"]');
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

test("reports a real settings save network failure in the shared message popup", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	await page.goto("/wp-admin/admin.php?page=easymde&route=/general_setting");
	await expect(page.locator(".easymde-settings-center")).toBeVisible();
	const strings = await page.evaluate(
		() => window.EasyMDESettingsCenterBootstrap.strings,
	);
	await page.route("**/wp-json/easymde/v1/settings", async (route) => {
		if (route.request().method() === "POST") {
			await route.abort("failed");
			return;
		}
		await route.continue();
	});

	await page.getByRole("switch", { name: strings.showLineNumbers }).click();
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
				/Sorry, you are not allowed to access this page\.|抱歉，您(?:不能|无权)访问此页面。/iu,
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
				/Sorry, you are not allowed to access this page\.|抱歉，您(?:不能|无权)访问此页面。/iu,
		},
	);
	await expectRemovedSettingsPage(
		page,
		"/wp-admin/options-general.php?page=easymde",
		{ status: 200, assertNoOptionsForm: false },
	);
});
