import { expect } from "@playwright/test";
import { expectedOriginFromBaseURL } from "../wechat-wordpress-fixture.mjs";
import { assertCandidateCopyCMDelta } from "./source-diagnostic-harness.mjs";
import { assertCandidateRestorePeer } from "./source-diagnostic-harness.mjs";
import { assertCandidateSourceBaseline } from "./source-diagnostic-harness.mjs";
import { assertCandidateSourceFingerprintEqual } from "./source-diagnostic-harness.mjs";
import { assertCandidateSourceTaskFingerprints } from "./source-diagnostic-harness.mjs";
import { assertCanonicalSource } from "./editor-session.mjs";
import { candidateMutationDelta } from "./source-diagnostic-harness.mjs";
import { canonicalImage } from "./environment.mjs";
import { canonicalImageSource } from "./environment.mjs";
import { canonicalMarkdownLength } from "./environment.mjs";
import { canonicalMarkdownSha256 } from "./environment.mjs";
import { captureCandidateSerializedTaskScreenshots } from "./candidate-capture.mjs";
import { captureCandidateTaskScreenshots } from "./candidate-capture.mjs";
import { createUploadTimeline } from "./copy-timeline.mjs";
import { expectedArticleTheme } from "./environment.mjs";
import { expectedCodeTheme } from "./environment.mjs";
import { installPerformanceProbe } from "./performance-probe.mjs";
import { previewSelector } from "./environment.mjs";
import { privateEvidenceDirectory } from "./private-evidence.mjs";
import { readBrowserConfiguration } from "./editor-session.mjs";
import { readCandidateBuildIdentity } from "./server-bundle.mjs";
import { readCandidatePostFingerprint } from "./candidate-capture.mjs";
import { readCandidateRichClipboard } from "./candidate-capture.mjs";
import { readCandidateRuntimeIdentity } from "./server-bundle.mjs";
import { readCandidateSourceFingerprint } from "./source-diagnostic-harness.mjs";
import { readCandidateSourceH3Ordinal } from "./source-diagnostic-harness.mjs";
import { readCandidateSourceH3Sample } from "./source-diagnostic-harness.mjs";
import { readCandidateSourcePhase } from "./source-diagnostic-harness.mjs";
import { readServerImageSettings } from "./server-bundle.mjs";
import { restoreCandidateSourceDiagnosticScroll } from "./source-diagnostic-harness.mjs";
import { routeCandidateBuildAssets } from "./server-bundle.mjs";
import { stableFailureCode } from "./private-evidence.mjs";
import { startCandidateSourceDiagnostic } from "./source-diagnostic-harness.mjs";
import { stopCandidateSourceDiagnostic } from "./source-diagnostic-harness.mjs";
import { summarizeUploadTimeline } from "./copy-timeline.mjs";
import { waitForCandidateSourceStability } from "./source-diagnostic-harness.mjs";
import { waitForCopySuccess } from "./copy-timeline.mjs";
import { waitForNativeWriteFulfilled } from "./copy-timeline.mjs";
import { waitForPreviewReady } from "./editor-session.mjs";
import { writeFailureSnapshot } from "./private-evidence.mjs";
import { writePrivateEvidence } from "./private-evidence.mjs";

export async function runCandidateCaptureScenario({ baseURL, context, createOwnedPost, login, page, runWp, test, testInfo, testSlug }) {

	test.setTimeout(180_000);
	privateEvidenceDirectory();
	const origin = expectedOriginFromBaseURL(baseURL, "wechat-copy-performance");
	let candidateBuild = null;
	let routeState = null;
	let uploadTimeline = null;
	let uploadSnapshot = null;
	let postId = null;
	let sourceBefore = null;
	let postBefore = null;
	let mutationEvidence = null;
	let sourceDiagnosticStarted = false;
	let sourceDiagnosticBefore = null;
	let sourceCalibrationPhase = null;
	let sourceCalibrationStability = null;
	let sourceCalibrationCMDelta = null;
	let sourceShotsPhase = null;
	let sourceRestorePhase = null;
	let sourceStability = null;
	let copyBeginPhase = null;
	let copyEndPhase = null;
	let sourceFinalPhase = null;
	let selectedH3Ordinal = null;
	let sourceH3Sample = null;
	let serializedH3Sample = null;
	let serializedTaskScreenshots = null;
	const sourceTaskFingerprints = [];
	let probeStopped = false;
	let primaryError = null;
	const cleanupErrors = [];
	try {
		candidateBuild = readCandidateBuildIdentity();
		uploadTimeline = createUploadTimeline(page);
		await installPerformanceProbe(page);
		const serverSettings = readServerImageSettings(runWp);
		postId = createOwnedPost(
			testInfo.wechatPerformanceUser,
			testSlug(testInfo),
			testInfo,
		);
		postBefore = readCandidatePostFingerprint(runWp, postId);
		routeState = await routeCandidateBuildAssets(page, candidateBuild, origin);
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
		await waitForPreviewReady(page);
		const runtimeIdentity = await readCandidateRuntimeIdentity(page);
		expect(runtimeIdentity).toEqual({
			loaderBootstrapPresent: true,
			mainScriptLoaded: true,
		});
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
			previewPresentation: "split",
			previewVisible: true,
			sourceVisible: true,
		});
		expect(serverSettings).toEqual({
			backupEnabled: false,
			imageHostingEnabled: true,
			service: "cloudflare-r2",
			wechatPngExportEnabled: true,
		});
		await page.mouse.move(0, 0);
		await startCandidateSourceDiagnostic(page);
		sourceDiagnosticStarted = true;
		sourceDiagnosticBefore = await readCandidateSourcePhase(
			page,
			"source-before",
		);
		assertCandidateSourceBaseline(sourceDiagnosticBefore.diagnostic);
		const sourceCalibrationBaseline =
			await readCandidateSourceFingerprint(page);
		await page.setViewportSize({ height: 785, width: 1329 });
		await waitForPreviewReady(page);
		await assertCanonicalSource(page);
		const restoredCalibrationScroll =
			await restoreCandidateSourceDiagnosticScroll(
				page,
				sourceDiagnosticBefore.diagnostic,
			);
		sourceCalibrationStability = await waitForCandidateSourceStability(
			page,
			restoredCalibrationScroll.expected,
		);
		sourceCalibrationPhase = await readCandidateSourcePhase(
			page,
			"source-calibration-restored",
		);
		assertCandidateSourceBaseline(sourceCalibrationPhase.diagnostic);
		sourceBefore = await readCandidateSourceFingerprint(page);
		assertCandidateSourceFingerprintEqual(
			sourceBefore,
			sourceCalibrationBaseline,
		);
		expect(readCandidatePostFingerprint(runWp, postId)).toEqual(postBefore);
		const routedBeforeCopy = routeState.observed();
		expect(routedBeforeCopy).toEqual(
			expect.arrayContaining(["loader", "main"]),
		);
		expect(sourceBefore.preview.inputChecked).toHaveLength(19);
		expect(sourceBefore.preview.formControlCount).toBe(19);
		expect(sourceBefore.preview.inputChecked.filter(Boolean)).toHaveLength(16);
		expect(
			sourceBefore.preview.inputChecked.filter((value) => !value),
		).toHaveLength(3);
		const markdownMeta = postBefore.find(
			({ key }) => key === "_easymde_markdown",
		);
		expect(markdownMeta).toMatchObject({
			length: canonicalMarkdownLength,
			sha256: canonicalMarkdownSha256,
		});
		const sourceScreenshot = await captureCandidateTaskScreenshots(
			page,
			testInfo,
			{
				capture: page.locator(".easymde-immersive-preview-canvas").first(),
				markers: page
					.locator(previewSelector)
					.locator('input[type="checkbox"]'),
				onMarker: async ({ index }) => {
					const phase = await readCandidateSourcePhase(page, "source-shots");
					assertCandidateSourceBaseline(phase.diagnostic);
					assertCandidateSourceFingerprintEqual(
						phase.fingerprint,
						sourceBefore,
					);
					if (index === 0) {
						const selection = await readCandidateSourceH3Ordinal(page);
						selectedH3Ordinal = selection.ordinal;
						sourceH3Sample = await readCandidateSourceH3Sample(
							page,
							selectedH3Ordinal,
						);
					}
					sourceTaskFingerprints.push({
						diagnostic: phase.diagnostic,
						fingerprint: phase.fingerprint,
						index,
					});
					if (index === 18) sourceShotsPhase = phase;
				},
				onRestore: async ({ restored }) => {
					const phase = await readCandidateSourcePhase(page, "restoration");
					assertCandidateRestorePeer(phase.diagnostic, restored.expected);
					sourceRestorePhase = { ...phase, restored };
				},
				peer: { selector: ".easymde-source-react .cm-scroller" },
				scrollRootSelector: ".easymde-immersive-preview-canvas",
				stem: "source-task",
			},
		);
		assertCandidateSourceTaskFingerprints(sourceTaskFingerprints, sourceBefore);
		if (
			!sourceCalibrationPhase ||
			!sourceShotsPhase ||
			!sourceRestorePhase ||
			!sourceH3Sample
		) {
			throw new Error("wechat-copy-candidate-source-phase-missing");
		}
		sourceCalibrationCMDelta = candidateMutationDelta(
			sourceDiagnosticBefore.diagnostic,
			sourceCalibrationPhase.diagnostic,
			"cmPresentation",
		);
		const sourceShotCMDelta = candidateMutationDelta(
			sourceCalibrationPhase.diagnostic,
			sourceShotsPhase.diagnostic,
			"cmPresentation",
		);
		const restorationCMDelta = candidateMutationDelta(
			sourceShotsPhase.diagnostic,
			sourceRestorePhase.diagnostic,
			"cmPresentation",
		);
		expect(sourceRestorePhase.fingerprint).toEqual(sourceBefore);
		sourceStability = await waitForCandidateSourceStability(
			page,
			sourceRestorePhase.restored.expected,
		);
		copyBeginPhase = await readCandidateSourcePhase(page, "copy-begin");
		assertCandidateSourceBaseline(copyBeginPhase.diagnostic);
		assertCandidateSourceFingerprintEqual(
			copyBeginPhase.fingerprint,
			sourceBefore,
		);

		await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.begin(),
		);
		const copyButton = page.locator(".easymde-toolbar-copy-action");
		await expect(copyButton).toHaveCount(1);
		await expect(copyButton).toBeVisible();
		await copyButton.click();
		await waitForCopySuccess(page, testInfo, uploadTimeline);
		await waitForNativeWriteFulfilled(page, testInfo, uploadTimeline);
		const pageSample = await page.evaluate(() =>
			globalThis.__easymdeWechatCopyPerformance.end(),
		);
		await page.evaluate(() => globalThis.__easymdeWechatCopyPerformance.stop());
		probeStopped = true;
		copyEndPhase = await readCandidateSourcePhase(page, "copy-end");
		assertCandidateSourceBaseline(copyEndPhase.diagnostic);
		const copyEndCMDelta = assertCandidateCopyCMDelta(
			copyBeginPhase.diagnostic,
			copyEndPhase.diagnostic,
		);
		expect(copyEndPhase.fingerprint).toEqual(sourceBefore);
		expect(pageSample.clicks).toHaveLength(1);
		expect(pageSample.writes).toHaveLength(1);
		expect(pageSample.writes[0].nativeState).toBe("fulfilled");
		uploadSnapshot = await uploadTimeline.snapshot(pageSample);
		const uploadEvidence = summarizeUploadTimeline(uploadSnapshot);
		expect(uploadEvidence.peakInFlight).toBeLessThanOrEqual(3);
		const richClipboard = await readCandidateRichClipboard(page);
		expect(richClipboard).toMatchObject({
			itemCount: 1,
			hasHtml: true,
			hasPlainText: true,
			markerType: "static-owner",
			roleCount: 19,
			ownerCount: 19,
			checkedTrue: 16,
			checkedFalse: 3,
			checkedStates: sourceBefore.preview.inputChecked,
			inputCount: 0,
			formControlCount: 0,
			allDisabled: true,
		});
		expect(richClipboard.checkedStates).toEqual(
			sourceBefore.preview.inputChecked,
		);
		serializedTaskScreenshots = await captureCandidateSerializedTaskScreenshots(
			page,
			testInfo,
			richClipboard.html,
			selectedH3Ordinal,
		);
		serializedH3Sample = serializedTaskScreenshots.h3Sample;
		const sourceAfter = await readCandidateSourceFingerprint(page);
		const postAfter = readCandidatePostFingerprint(runWp, postId);
		expect(sourceAfter).toEqual(sourceBefore);
		expect(postAfter).toEqual(postBefore);
		sourceFinalPhase = await readCandidateSourcePhase(page, "final");
		assertCandidateSourceBaseline(sourceFinalPhase.diagnostic);
		assertCandidateSourceFingerprintEqual(
			sourceFinalPhase.fingerprint,
			sourceBefore,
		);
		const finalCMDelta = candidateMutationDelta(
			copyEndPhase.diagnostic,
			sourceFinalPhase.diagnostic,
			"cmPresentation",
		);
		expect(finalCMDelta).toBe(0);
		mutationEvidence = {
			copyBegin: copyBeginPhase,
			copyEnd: copyEndPhase,
			copyEndCMDelta,
			finalCMDelta,
			sourceCalibrationCMDelta,
			sourceCalibrationPhase,
			sourceCalibrationStability,
			restorationCMDelta,
			sourceBefore: sourceDiagnosticBefore,
			sourceFinal: sourceFinalPhase,
			sourceRestore: sourceRestorePhase,
			sourceShotCMDelta,
			sourceShots: sourceShotsPhase,
			stability: sourceStability,
			h3Diagnostic: {
				source: sourceH3Sample,
				serialized: serializedH3Sample,
				status: "diagnostic-only",
			},
			taskFingerprints: sourceTaskFingerprints,
		};
		const routedAfterCopy = routeState.observed();
		expect(routedAfterCopy).toEqual(
			expect.arrayContaining(["loader", "main", "worker"]),
		);
		await writePrivateEvidence(testInfo, {
			candidateStatus: "visual-candidate-only",
			nativeWeChatPassClaimed: false,
			build: candidateBuild.identity,
			runtime: runtimeIdentity,
			routedAssets: routedAfterCopy,
			routedAssetEvidence: routeState.evidence(),
			serverSettings,
			browserConfiguration,
			mutations: mutationEvidence,
			h3Diagnostic: {
				source: sourceH3Sample,
				serialized: serializedH3Sample,
				status: "diagnostic-only",
			},
			richClipboard: {
				itemCount: richClipboard.itemCount,
				hasHtml: richClipboard.hasHtml,
				hasPlainText: richClipboard.hasPlainText,
				markerType: richClipboard.markerType,
				roleCount: richClipboard.roleCount,
				ownerCount: richClipboard.ownerCount,
				checkedTrue: richClipboard.checkedTrue,
				checkedFalse: richClipboard.checkedFalse,
				checkedStates: richClipboard.checkedStates,
				inputCount: richClipboard.inputCount,
				formControlCount: richClipboard.formControlCount,
				allDisabled: richClipboard.allDisabled,
			},
			sourceBefore,
			sourceAfter,
			postBefore,
			postAfter,
			uploads: uploadEvidence,
			screenshots: {
				sourceTaskSections: sourceScreenshot,
				serializedOutputTaskSections: serializedTaskScreenshots.screenshots,
				sourceTaskIndices: sourceScreenshot.map(({ index }) => index),
				serializedOutputTaskIndices: serializedTaskScreenshots.screenshots.map(
					({ index }) => index,
				),
				sourceContentWidth: sourceBefore.preview.contentWidth,
				serializedOutputContentWidths: [serializedTaskScreenshots.contentWidth],
				serializedOutputWidths: [serializedTaskScreenshots.width],
			},
			paintReview: "unverified",
			nativeAcceptance: "unverified",
		});
	} catch (error) {
		primaryError = error;
		let sourceFailurePhase = { state: "unavailable" };
		try {
			if (!page.isClosed() && sourceDiagnosticStarted) {
				sourceFailurePhase = await readCandidateSourcePhase(page, "failure");
			}
		} catch {
			sourceFailurePhase = { state: "unavailable" };
		}
		try {
			await writePrivateEvidence(testInfo, {
				candidateStatus: "visual-candidate-failed",
				failureCode: stableFailureCode(error),
				mutations: {
					copyBegin: copyBeginPhase,
					copyEnd: copyEndPhase,
					sourceBefore: sourceDiagnosticBefore,
					sourceCalibrationCMDelta,
					sourceCalibrationPhase,
					sourceCalibrationStability,
					sourceFailure: sourceFailurePhase,
					sourceRestore: sourceRestorePhase,
					sourceShots: sourceShotsPhase,
					taskFingerprints: sourceTaskFingerprints,
				},
				h3Diagnostic: {
					source: sourceH3Sample,
					serialized: serializedH3Sample,
					status: "diagnostic-only",
				},
			});
		} catch {
			cleanupErrors.push(
				new Error("wechat-copy-candidate-source-failure-evidence-unavailable"),
			);
		}
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
				cleanupErrors.push(
					new Error("wechat-copy-candidate-failure-snapshot-unavailable"),
				);
			}
		}
		throw error;
	} finally {
		if (sourceDiagnosticStarted) {
			try {
				await stopCandidateSourceDiagnostic(page);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-diagnostic-cleanup-failed"),
				);
			}
			sourceDiagnosticStarted = false;
		}
		if (!probeStopped) {
			try {
				await page.evaluate(() =>
					globalThis.__easymdeWechatCopyPerformance?.stop(),
				);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-probe-cleanup-failed"),
				);
			}
		}
		if (uploadTimeline) {
			try {
				uploadTimeline.stop();
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-upload-listener-cleanup-failed"),
				);
			}
		}
		if (routeState) {
			try {
				await routeState.stop();
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-asset-route-cleanup-failed"),
				);
			}
		}
		if (cleanupErrors.length && (primaryError || testInfo.errors.length > 0)) {
			testInfo.errors.push(
				...cleanupErrors.map(({ message }) => ({ message })),
			);
			cleanupErrors.length = 0;
		}
	}
	if (cleanupErrors.length && !primaryError) {
		testInfo.errors.push(...cleanupErrors.map(({ message }) => ({ message })));
		cleanupErrors.length = 0;
		throw new Error("wechat-copy-performance-candidate-cleanup-failed");
	}
}
