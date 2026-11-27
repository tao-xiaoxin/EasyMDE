import { expect } from "@playwright/test";
import { expectedOriginFromBaseURL } from "../wechat-wordpress-fixture.mjs";
import { assertCanonicalSource } from "./editor-session.mjs";
import { canonicalImage } from "./environment.mjs";
import { canonicalImageSource } from "./environment.mjs";
import { captureCandidateTaskScreenshots } from "./candidate-capture.mjs";
import { expectedArticleTheme } from "./environment.mjs";
import { expectedCodeTheme } from "./environment.mjs";
import { previewSelector } from "./environment.mjs";
import { privateEvidenceDirectory } from "./private-evidence.mjs";
import { readBrowserConfiguration } from "./editor-session.mjs";
import { readCandidateBuildIdentity } from "./server-bundle.mjs";
import { readCandidatePostFingerprint } from "./candidate-capture.mjs";
import { readCandidateRuntimeIdentity } from "./server-bundle.mjs";
import { readCandidateSourceDiagnostic } from "./source-diagnostic-harness.mjs";
import { readCandidateSourceFingerprint } from "./source-diagnostic-harness.mjs";
import { routeCandidateBuildAssets } from "./server-bundle.mjs";
import { stableFailureCode } from "./private-evidence.mjs";
import { startCandidateSourceDiagnostic } from "./source-diagnostic-harness.mjs";
import { stopCandidateSourceDiagnostic } from "./source-diagnostic-harness.mjs";
import { waitForPreviewReady } from "./editor-session.mjs";
import { writePrivateEvidence } from "./private-evidence.mjs";

export async function runSourceDiagnosticScenario({ baseURL, createOwnedPost, login, page, runWp, test, testInfo, testSlug }) {

	test.setTimeout(180_000);
	privateEvidenceDirectory();
	const origin = expectedOriginFromBaseURL(baseURL, "wechat-copy-performance");
	let candidateBuild = null;
	let routeState = null;
	let canonicalImageRoute = null;
	let postId = null;
	let sourceBefore = null;
	let postBefore = null;
	let diagnosticBefore = null;
	const sourceTaskEvidence = [];
	let sourceAfterRestore = null;
	let diagnosticAfterRestore = null;
	let primaryError = null;
	let diagnosticStarted = false;
	const cleanupErrors = [];
	try {
		candidateBuild = readCandidateBuildIdentity();
		postId = createOwnedPost(
			testInfo.wechatPerformanceUser,
			testSlug(testInfo),
			testInfo,
		);
		postBefore = readCandidatePostFingerprint(runWp, postId);
		routeState = await routeCandidateBuildAssets(page, candidateBuild, origin);
		canonicalImageRoute = (route) =>
			route.fulfill({
				body: canonicalImage,
				contentType: "image/png",
				status: 200,
			});
		await page.route(canonicalImageSource, canonicalImageRoute);
		await login(page, testInfo.wechatPerformanceUser, baseURL);
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
			articleTheme: expectedArticleTheme,
			codeTheme: expectedCodeTheme,
			previewPresentation: "split",
			previewVisible: true,
			sourceVisible: true,
		});
		sourceBefore = await readCandidateSourceFingerprint(page);
		await startCandidateSourceDiagnostic(page);
		diagnosticStarted = true;
		diagnosticBefore = await readCandidateSourceDiagnostic(page);
		const sourceScreenshots = await captureCandidateTaskScreenshots(
			page,
			testInfo,
			{
				capture: page.locator('[data-easymde-editor-owner="react"] .easymde-immersive-preview-canvas'),
				markers: page
					.locator(previewSelector)
					.locator('input[type="checkbox"]'),
				onMarker: async ({
					captureBox,
					index,
					markerBox,
					scrollMetrics,
					visibleHeight,
					visibleWidth,
				}) => {
					const fingerprint = await readCandidateSourceFingerprint(page);
					const diagnostic = await readCandidateSourceDiagnostic(page);
					sourceTaskEvidence.push({
						capture: {
							height: captureBox.height,
							width: captureBox.width,
							visibleHeight,
							visibleWidth,
						},
						canonicalFingerprint: fingerprint,
						index,
						marker: {
							height: markerBox.height,
							width: markerBox.width,
						},
						scrollMetrics,
						diagnostic,
					});
				},
				peer: { selector: ".easymde-source-react .cm-scroller" },
				scrollRootSelector: '[data-easymde-editor-owner="react"] .easymde-immersive-preview-canvas',
				stem: "source-diagnostic-task",
			},
		);
		sourceAfterRestore = await readCandidateSourceFingerprint(page);
		diagnosticAfterRestore = await readCandidateSourceDiagnostic(page);
		expect(sourceAfterRestore).toEqual(sourceBefore);
		const postAfter = readCandidatePostFingerprint(runWp, postId);
		expect(postAfter).toEqual(postBefore);
		expect(sourceTaskEvidence).toHaveLength(19);
		await writePrivateEvidence(testInfo, {
			browserConfiguration,
			candidateBuild: candidateBuild.identity,
			copyAttempted: false,
			diagnosticStatus: "source-only-diagnostic",
			fullMutationGate: "not-evaluated",
			post: {
				before: postBefore,
				after: postAfter,
			},
			runtime: runtimeIdentity,
			screenshots: {
				files: sourceScreenshots,
				indices: sourceScreenshots.map(({ index }) => index),
			},
			source: {
				canonicalFingerprintAfterRestore: sourceAfterRestore,
				canonicalFingerprintBefore: sourceBefore,
				canonicalFingerprintPerTask: sourceTaskEvidence,
				beforeDiagnostic: diagnosticBefore,
				afterRestoreDiagnostic: diagnosticAfterRestore,
			},
			uploadAttempted: false,
		});
	} catch (error) {
		primaryError = error;
		let sourceAfterFailure = { state: "unavailable" };
		let diagnosticAfterFailure = { state: "unavailable" };
		let postAfterFailure = { state: "unavailable" };
		try {
			if (!page.isClosed()) {
				sourceAfterFailure = await readCandidateSourceFingerprint(page);
			}
		} catch {
			sourceAfterFailure = { state: "unavailable" };
		}
		try {
			if (!page.isClosed() && diagnosticStarted) {
				diagnosticAfterFailure = await readCandidateSourceDiagnostic(page);
			}
		} catch {
			diagnosticAfterFailure = { state: "unavailable" };
		}
		if (postId) {
			try {
				postAfterFailure = readCandidatePostFingerprint(runWp, postId);
			} catch {
				postAfterFailure = { state: "unavailable" };
			}
		}
		try {
			await writePrivateEvidence(testInfo, {
				copyAttempted: false,
				diagnosticStatus: "source-only-diagnostic-failed",
				failureCode: stableFailureCode(error),
				post: {
					afterFailure: postAfterFailure,
					before: postBefore,
				},
				source: {
					canonicalFingerprintAfterFailure: sourceAfterFailure,
					canonicalFingerprintBefore: sourceBefore,
					canonicalFingerprintPerTask: sourceTaskEvidence,
					beforeDiagnostic: diagnosticBefore,
					diagnosticAfterFailure,
				},
				uploadAttempted: false,
			});
		} catch {
			cleanupErrors.push(
				new Error(
					"wechat-copy-candidate-source-diagnostic-evidence-unavailable",
				),
			);
		}
		throw error;
	} finally {
		if (diagnosticStarted) {
			try {
				await stopCandidateSourceDiagnostic(page);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-diagnostic-cleanup-failed"),
				);
			}
		}
		if (canonicalImageRoute) {
			try {
				await page.unroute(canonicalImageSource, canonicalImageRoute);
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-image-route-cleanup-failed"),
				);
			}
		}
		if (routeState) {
			try {
				await routeState.stop();
			} catch {
				cleanupErrors.push(
					new Error("wechat-copy-candidate-source-asset-route-cleanup-failed"),
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
		throw new Error("wechat-copy-performance-source-diagnostic-cleanup-failed");
	}
}
