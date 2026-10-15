import { expect } from "@playwright/test";
import { expectedOriginFromBaseURL } from "../wechat-wordpress-fixture.mjs";
import { assertCanonicalSource } from "./editor-session.mjs";
import { canonicalImage } from "./environment.mjs";
import { canonicalImageSource } from "./environment.mjs";
import { configurePerformanceMode } from "./editor-session.mjs";
import { configuredPerformanceMode } from "./performance-mode.mjs";
import { createUploadTimeline } from "./copy-timeline.mjs";
import { expectedArticleTheme } from "./environment.mjs";
import { expectedCodeTheme } from "./environment.mjs";
import { expectedImageProvider } from "./environment.mjs";
import { installPerformanceModeOverride } from "./editor-session.mjs";
import { installPerformanceProbe } from "./performance-probe.mjs";
import { performanceModeExpectations } from "./performance-mode.mjs";
import { privateEvidenceDirectory } from "./private-evidence.mjs";
import { readBrowserConfiguration } from "./editor-session.mjs";
import { readClipboardShape } from "./copy-timeline.mjs";
import { readPerformanceModeState } from "./editor-session.mjs";
import { readServerBundleIdentity } from "./server-bundle.mjs";
import { readServerImageSettings } from "./server-bundle.mjs";
import { stableFailureCode } from "./private-evidence.mjs";
import { startTracing } from "./trace-summary.mjs";
import { stopTracing } from "./trace-summary.mjs";
import { summarizePageTiming } from "./trace-summary.mjs";
import { summarizeTrace } from "./trace-summary.mjs";
import { summarizeUploadTimeline } from "./copy-timeline.mjs";
import { waitForCopySuccess } from "./copy-timeline.mjs";
import { waitForNativeWriteFulfilled } from "./copy-timeline.mjs";
import { withDeadline } from "./trace-summary.mjs";
import { writeFailureSnapshot } from "./private-evidence.mjs";
import { writePrivateEvidence } from "./private-evidence.mjs";

export async function runPerformanceProfileScenario({ baseURL, context, createOwnedPost, login, page, runWp, test, testInfo, testSlug }) {

	test.setTimeout(180_000);
	privateEvidenceDirectory();
	const origin = expectedOriginFromBaseURL(baseURL, "wechat-copy-performance");
	let serverSettings = null;
	let postId = null;
	let cdp = null;
	let traceEvents = null;
	let primaryError = null;
	let cleanupError = null;
	let probeStopped = false;
	let uploadTimeline = null;
	let uploadSnapshot = null;

	try {
		uploadTimeline = createUploadTimeline(page);
		await installPerformanceProbe(page);
		serverSettings = readServerImageSettings(runWp);
		postId = createOwnedPost(
			testInfo.wechatPerformanceUser,
			testSlug(testInfo),
			testInfo,
		);
		await page.route(
			(url) => url === canonicalImageSource,
			(route) =>
				route.fulfill({
					body: canonicalImage,
					contentType: "image/png",
					status: 200,
				}),
		);
		await login(page, testInfo.wechatPerformanceUser, baseURL);
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin,
		});
		await page.setViewportSize({ height: 785, width: 1329 });
		await installPerformanceModeOverride(page, configuredPerformanceMode);
		await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
			waitUntil: "domcontentloaded",
		});
		await expect(page.locator("#easymde-editor")).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					height: window.innerHeight,
					width: window.innerWidth,
				})),
			)
			.toEqual({ height: 785, width: 1329 });
		await assertCanonicalSource(page);
		await configurePerformanceMode(page, configuredPerformanceMode);
		const modeState = await readPerformanceModeState(page);
		const expectedModeState =
			performanceModeExpectations[configuredPerformanceMode];
		expect(modeState.actualMode).toBe(configuredPerformanceMode);
		expect(modeState).toMatchObject(expectedModeState);
		const serverBundleIdentity = await readServerBundleIdentity(page);
		if (!Object.values(serverBundleIdentity).every(Boolean)) {
			throw new Error(
				"wechat-copy-performance-server-bundle-identity-mismatch",
			);
		}
		const browserConfiguration = await readBrowserConfiguration(page);
		expect(browserConfiguration).toMatchObject({
			articleStylesheetReady: true,
			articleTheme: expectedArticleTheme,
			codeStylesheetReady: true,
			codeTheme: expectedCodeTheme,
			codeThemeExplicit: "1",
			endpointIsImageHosting: true,
			imageUploadEnabled: true,
			imageUploadOwner: "image-hosting",
			pngConversionEnabled: true,
			previewPresentation: expectedModeState.previewPresentation,
			previewVisible: expectedModeState.previewVisible,
			sourceVisible: expectedModeState.sourceVisible,
		});
		expect(serverSettings).toEqual({
			backupEnabled: false,
			imageHostingEnabled: true,
			service: expectedImageProvider,
			wechatPngExportEnabled: true,
		});

		cdp = await startTracing(context, page);
		await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.begin(),
		);
		let copyButton = page.locator(".easymde-toolbar-copy-action");
		if (modeState.surface === "immersive") {
			const wechatLabel = await page.evaluate(
				() => window.EasyMDEEditorRootBootstrap.strings.immersive.wechat,
			);
			copyButton = page.getByRole("button", {
				name: wechatLabel,
				exact: true,
			});
		}
		await expect(copyButton).toHaveCount(1);
		await expect(copyButton).toBeVisible();
		await copyButton.click();
		await waitForCopySuccess(page, testInfo, uploadTimeline);
		await waitForNativeWriteFulfilled(page, testInfo, uploadTimeline);
		await withDeadline(
			page.evaluate(() =>
				globalThis.__easymdeWechatCopyPerformance.awaitEarlyPhases(),
			),
			"wechat-copy-performance-early-phase-timeout",
			5_000,
		);
		const pageSample = await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.end(),
		);
		await page.evaluate(() => globalThis.__easymdeWechatCopyPerformance.stop());
		probeStopped = true;
		uploadSnapshot = await uploadTimeline.snapshot(pageSample);
		const pageTiming = summarizePageTiming(pageSample);
		const uploadEvidence = summarizeUploadTimeline(uploadSnapshot);
		traceEvents = await stopTracing(cdp);
		cdp = null;
		const traceTiming = summarizeTrace(traceEvents);
		const clipboardShape = await readClipboardShape(page);
		expect(clipboardShape.itemCount).toBe(1);
		expect(clipboardShape.typeCounts[0]).toBeGreaterThan(0);
		await writePrivateEvidence(testInfo, {
			clickOwner: pageTiming.clickOwner,
			copyTerminalAt: pageTiming.copyTerminalAt,
			longTasks: pageTiming.longTasks,
			measures: pageTiming.measures,
			notifications: pageTiming.notifications,
			ownerChanges: pageTiming.ownerChanges,
			ownerChangeStages: pageTiming.ownerChangeStages,
			pageInterval: pageTiming.pageInterval,
			earlyStages: pageTiming.earlyStages,
			uploads: uploadEvidence,
			serverBundleIdentity,
			serverSettings,
			earlyFunctionAttribution: traceTiming.earlyFunctionAttribution,
			traceReason: traceTiming.reason ?? null,
			traceStatus: traceTiming.status,
			traceUserTimingCapability:
				traceTiming.status === "verified" ? "observed" : "unobserved",
			trace: traceTiming.records,
			mode: {
				actual: modeState,
				requested: configuredPerformanceMode,
			},
			write: pageTiming.write,
		});
	} catch (error) {
		primaryError = error;
		if (!testInfo.wechatPerformanceFailureSnapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"test-terminal",
					stableFailureCode(error),
					uploadTimeline,
					uploadSnapshot,
				);
			} catch {
				cleanupError = new Error(
					"wechat-copy-performance-failure-snapshot-unavailable",
				);
			}
		}
		throw error;
	} finally {
		if (!probeStopped) {
			try {
				await page.evaluate(() =>
					globalThis.__easymdeWechatCopyPerformance?.stop(),
				);
			} catch {
				cleanupError = new Error(
					"wechat-copy-performance-probe-cleanup-failed",
				);
			}
		}
		if (cdp) {
			try {
				await stopTracing(cdp);
			} catch {
				cleanupError ??= new Error(
					"wechat-copy-performance-tracing-cleanup-failed",
				);
			}
		}
		if (uploadTimeline) {
			try {
				uploadTimeline.stop();
			} catch {
				cleanupError ??= new Error(
					"wechat-copy-performance-upload-listener-cleanup-failed",
				);
			}
		}
	}
	if (cleanupError && !primaryError) throw cleanupError;
}
