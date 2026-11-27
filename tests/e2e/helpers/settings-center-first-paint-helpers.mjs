import { Buffer } from "node:buffer";
import { expect } from "@playwright/test";

export const SETTINGS_CENTER_FIRST_PAINT_PATH =
	"/wp-admin/admin.php?page=easymde&route=/general_setting";
function readPositiveIntegerEnvironment(name, fallback) {
	const value = process.env[name];
	if (value === undefined) return fallback;
	if (!/^[1-9]\d*$/u.test(value)) {
		throw new Error(`${name} must be a strict positive integer.`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a strict positive integer.`);
	}

	return parsed;
}

export const SETTINGS_CENTER_FIRST_PAINT_RUNS = readPositiveIntegerEnvironment(
	"EASYMDE_FIRST_PAINT_RUNS",
	1,
);
export const SETTINGS_CENTER_FRAME_FINGERPRINT_TOLERANCE = 20;
const SETTINGS_CENTER_FRAME_MAX_WHITE_RATIO = 0.98;
const SETTINGS_CENTER_FIRST_PAINT_VIEWPORTS = [
	{ name: "desktop", width: 1440, height: 900 },
	{ name: "mobile", width: 390, height: 844 },
];
const SETTINGS_CENTER_FIRST_PAINT_CACHE_MODES = [
	{ name: "cold", cacheDisabled: true, clearBeforeSetup: true },
	{ name: "warm", cacheDisabled: false, clearBeforeSetup: false },
];
const SETTINGS_CENTER_FIRST_PAINT_REFRESH_MODES = [
	{ name: "normal", hardRefresh: false },
	{ name: "hard", hardRefresh: true },
];
const SETTINGS_CENTER_FIRST_PAINT_BASELINE_PROFILE = {
	name: "baseline",
	cpuThrottlingRate: 1,
	networkConditions: {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
		connectionType: "none",
	},
};
const SETTINGS_CENTER_FIRST_PAINT_PROFILES = [
	SETTINGS_CENTER_FIRST_PAINT_BASELINE_PROFILE,
	{
		name: "throttled",
		cpuThrottlingRate: 4,
		networkConditions: {
			offline: false,
			latency: 150,
			downloadThroughput: 200 * 1024,
			uploadThroughput: (750 * 1024) / 8,
			connectionType: "cellular3g",
		},
	},
];

function buildSettingsCenterFirstPaintCases() {
	const cases = [];
	for (const viewport of SETTINGS_CENTER_FIRST_PAINT_VIEWPORTS) {
		for (const cacheMode of SETTINGS_CENTER_FIRST_PAINT_CACHE_MODES) {
			for (const refreshMode of SETTINGS_CENTER_FIRST_PAINT_REFRESH_MODES) {
				for (const profile of SETTINGS_CENTER_FIRST_PAINT_PROFILES) {
					cases.push({
						name: [
							viewport.name,
							cacheMode.name,
							refreshMode.name,
							profile.name,
						].join("-"),
						viewport,
						cacheMode,
						refreshMode,
						profile,
					});
				}
			}
		}
	}
	return cases;
}

export const SETTINGS_CENTER_FIRST_PAINT_ALL_CASES =
	buildSettingsCenterFirstPaintCases();
const SETTINGS_CENTER_FIRST_PAINT_CASE_NAME =
	process.env.EASYMDE_FIRST_PAINT_CASE;

function selectSettingsCenterFirstPaintCases(allCases, requestedCaseName) {
	if (requestedCaseName === undefined) return allCases;

	const selectedCases = allCases.filter(
		(scenario) => scenario.name === requestedCaseName,
	);
	if (selectedCases.length !== 1) {
		throw new Error(
			[
				"EASYMDE_FIRST_PAINT_CASE must exactly match one generated caseName.",
				`Received ${JSON.stringify(requestedCaseName)}.`,
				`Expected one of: ${allCases.map((scenario) => scenario.name).join(", ")}.`,
			].join(" "),
		);
	}

	return selectedCases;
}

export const SETTINGS_CENTER_FIRST_PAINT_CASES = selectSettingsCenterFirstPaintCases(
	SETTINGS_CENTER_FIRST_PAINT_ALL_CASES,
	SETTINGS_CENTER_FIRST_PAINT_CASE_NAME,
);
export const SETTINGS_CENTER_FIRST_PAINT_EXPECTED_CASE_COUNT =
	SETTINGS_CENTER_FIRST_PAINT_CASE_NAME === undefined
		? SETTINGS_CENTER_FIRST_PAINT_ALL_CASES.length
		: 1;
const SETTINGS_CENTER_FIRST_PAINT_PUBLIC_EVIDENCE_KEYS = Object.freeze([
	"caseName",
	"iteration",
	"stableState",
	"durationMs",
]);
export const SETTINGS_CENTER_FIRST_PAINT_STDOUT_PREFIX =
	"EASYMDE_SETTINGS_CENTER_FIRST_PAINT_EVIDENCE:";
const SETTINGS_CENTER_FIRST_PAINT_TIMEOUT_PER_CASE_MS = 60_000;
export const SETTINGS_CENTER_FIRST_PAINT_TIMEOUT_MS = Math.max(
	600_000,
	SETTINGS_CENTER_FIRST_PAINT_CASES.length *
		SETTINGS_CENTER_FIRST_PAINT_RUNS *
		SETTINGS_CENTER_FIRST_PAINT_TIMEOUT_PER_CASE_MS,
);

async function applySettingsCenterBrowserConditions(cdp, profile, cacheMode) {
	await cdp.send("Emulation.setCPUThrottlingRate", {
		rate: profile.cpuThrottlingRate,
	});
	await cdp.send("Network.emulateNetworkConditions", profile.networkConditions);
	await cdp.send("Network.setCacheDisabled", {
		cacheDisabled: cacheMode.cacheDisabled,
	});
}

export async function restoreSettingsCenterBrowserConditions(cdp) {
	const errors = [];
	for (const [method, params] of [
		[
			"Emulation.setCPUThrottlingRate",
			{ rate: SETTINGS_CENTER_FIRST_PAINT_BASELINE_PROFILE.cpuThrottlingRate },
		],
		[
			"Network.emulateNetworkConditions",
			SETTINGS_CENTER_FIRST_PAINT_BASELINE_PROFILE.networkConditions,
		],
		["Network.setCacheDisabled", { cacheDisabled: false }],
	]) {
		try {
			await cdp.send(method, params);
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(
			errors,
			"Settings Center browser condition restoration failed.",
		);
	}
}

export async function withSettingsCenterBrowserConditions(
	cdp,
	profile,
	cacheMode,
	callback,
) {
	let operationError;
	let restoreError;
	let result;
	try {
		try {
			await applySettingsCenterBrowserConditions(cdp, profile, cacheMode);
			result = await callback();
		} catch (error) {
			operationError = error;
		}
	} finally {
		try {
			await restoreSettingsCenterBrowserConditions(cdp);
		} catch (error) {
			restoreError = error;
		}
	}
	if (operationError && restoreError) {
		throw new AggregateError(
			[operationError, restoreError],
			"Settings Center browser conditions and restoration failed.",
		);
	}
	if (operationError) throw operationError;
	if (restoreError) throw restoreError;
	return result;
}

export async function prepareSettingsCenterFirstPaintCase(page, cdp, scenario) {
	await page.setViewportSize({
		width: scenario.viewport.width,
		height: scenario.viewport.height,
	});
	if (scenario.cacheMode.clearBeforeSetup) {
		await cdp.send("Network.clearBrowserCache");
	}
	await page.goto(SETTINGS_CENTER_FIRST_PAINT_PATH);
	await waitForSettingsCenterReady(page);
}

async function reloadSettingsCenterForFirstPaint(page, cdp, refreshMode) {
	if (refreshMode.hardRefresh) {
		const mainFrameNavigation = page.waitForEvent("framenavigated", {
			predicate: (frame) => frame === page.mainFrame(),
		});
		await Promise.all([
			mainFrameNavigation,
			cdp.send("Page.reload", { ignoreCache: true }),
		]);
		return;
	}
	await page.reload({ waitUntil: "domcontentloaded" });
}

export async function captureSettingsCenterScreenshot(cdp, decoder, expectedSize) {
	return decodeSettingsCenterPng(
		decoder,
		(
			await cdp.send("Page.captureScreenshot", {
				format: "png",
				fromSurface: true,
				captureBeyondViewport: false,
			})
		).data,
		expectedSize,
	);
}

export async function waitForSettingsCenterReady(page) {
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

export async function assertSettingsCenterShellAbsent(page) {
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

export function matchesSettingsCenterFrame(frame, reference) {
	return (
		frame.whiteRatio < SETTINGS_CENTER_FRAME_MAX_WHITE_RATIO &&
		frame.darkTopRatio < 0.35 &&
		settingsCenterFingerprintDistance(frame, reference) <=
			SETTINGS_CENTER_FRAME_FINGERPRINT_TOLERANCE
	);
}

function isSettingsCenterBlankFrame(frame) {
	return frame.whiteRatio >= 0.995;
}

function isSettingsCenterFallbackFrame(frame) {
	return (
		frame.whiteRatio >= SETTINGS_CENTER_FRAME_MAX_WHITE_RATIO &&
		!isSettingsCenterBlankFrame(frame)
	);
}

function matchesExactSettingsCenterFrame(frame, reference) {
	return (
		frame.width === reference.width &&
		frame.height === reference.height &&
		frame.pixelHash === reference.pixelHash &&
		frame.whiteRatio === reference.whiteRatio &&
		frame.darkTopRatio === reference.darkTopRatio &&
		settingsCenterFingerprintDistance(frame, reference) === 0
	);
}

export function selectSettingsCenterFirstPaintPublicEvidence(evidence) {
	return evidence.map((entry) =>
		Object.fromEntries(
			SETTINGS_CENTER_FIRST_PAINT_PUBLIC_EVIDENCE_KEYS.map((key) => [
				key,
				entry[key],
			]),
		),
	);
}

export async function captureSettingsCenterNavigationEvidence(
	page,
	cdp,
	decoder,
	expectedSize,
	refreshMode,
	scenario,
) {
	const fail = (reason) =>
		new Error(`settings-center-first-paint:${scenario.name}:${reason}`);
	const settingsApplication = page.locator(".easymde-settings-center");
	const beforeVisible = await settingsApplication.isVisible();
	if (!beforeVisible) throw fail("settings-before-reload-not-visible");
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
		throw fail("settings-reference-frame-invalid");
	}
	let committed = false;
	let collectFrames = true;
	const frames = [];
	const pendingAcks = new Set();
	const ackErrors = [];
	const lifecycleInitTimestamps = new Map();
	let navigationLoaderId;
	let navigationInitTimestamp;
	let lifecycleError;
	let captureNavigationEvents = false;
	const frameTree = await cdp.send("Page.getFrameTree");
	const mainFrameId = frameTree.frameTree.frame.id;
	const handleFrameNavigated = ({ frame }) => {
		if (!frame.parentId && frame.id === mainFrameId) {
			committed = true;
			navigationLoaderId = frame.loaderId;
			navigationInitTimestamp = lifecycleInitTimestamps.get(navigationLoaderId);
		}
	};
	const handleLifecycleEvent = ({ frameId, loaderId, name, timestamp }) => {
		if (
			!captureNavigationEvents ||
			name !== "init" ||
			frameId !== mainFrameId
		) {
			return;
		}

		if (typeof loaderId !== "string" || typeof timestamp !== "number") {
			lifecycleError = fail("settings-lifecycle-init-invalid");
			return;
		}

		lifecycleInitTimestamps.set(loaderId, timestamp);
		if (loaderId === navigationLoaderId) {
			navigationInitTimestamp = timestamp;
		}
	};
	const handleScreencastFrame = ({ data, metadata, sessionId }) => {
		const ack = cdp.send("Page.screencastFrameAck", { sessionId });
		pendingAcks.add(ack);
		ack.then(
			() => pendingAcks.delete(ack),
			(error) => {
				ackErrors.push(error);
				pendingAcks.delete(ack);
			},
		);
		if (
			committed &&
			collectFrames &&
			typeof navigationInitTimestamp === "number" &&
			typeof metadata?.timestamp === "number" &&
			metadata.timestamp >= navigationInitTimestamp
		) {
			frames.push({ data, timestamp: metadata.timestamp });
		}
	};
	cdp.on("Page.frameNavigated", handleFrameNavigated);
	cdp.on("Page.lifecycleEvent", handleLifecycleEvent);
	cdp.on("Page.screencastFrame", handleScreencastFrame);
	let screencastStarted = false;
	let lifecycleEventsEnabled = false;
	try {
		await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });
		lifecycleEventsEnabled = true;
		await cdp.send("Page.startScreencast", {
			format: "png",
			maxWidth: expectedSize.width,
			maxHeight: expectedSize.height,
			everyNthFrame: 1,
		});
		screencastStarted = true;
		captureNavigationEvents = true;
		await reloadSettingsCenterForFirstPaint(page, cdp, refreshMode);
		await waitForSettingsCenterReady(page);
		collectFrames = false;
		if (lifecycleError) {
			throw lifecycleError;
		}
		if (
			typeof navigationLoaderId !== "string" ||
			typeof navigationInitTimestamp !== "number"
		) {
			throw fail("settings-lifecycle-init-missing");
		}
		if (!committed) throw fail("settings-main-frame-commit-missing");
		await assertSettingsCenterShellAbsent(page);
	} finally {
		try {
			try {
				if (screencastStarted) await cdp.send("Page.stopScreencast");
			} finally {
				if (lifecycleEventsEnabled) {
					await cdp.send("Page.setLifecycleEventsEnabled", {
						enabled: false,
					});
				}
			}
		} finally {
			cdp.off("Page.frameNavigated", handleFrameNavigated);
			cdp.off("Page.lifecycleEvent", handleLifecycleEvent);
			cdp.off("Page.screencastFrame", handleScreencastFrame);
			await Promise.all(pendingAcks);
		}
	}
	if (ackErrors.length > 0) throw ackErrors[0];

	const afterVisible = await settingsApplication.isVisible();
	if (!afterVisible) throw fail("settings-after-reload-not-visible");
	const afterScreenshot = await cdp.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: false,
	});
	const afterAnalysis = await decodeSettingsCenterPng(
		decoder,
		afterScreenshot.data,
		expectedSize,
	);
	if (frames.length > 0) {
		const frameAnalyses = await Promise.all(
			frames.map((frame) =>
				decodeSettingsCenterPng(decoder, frame.data, expectedSize),
			),
		);
		let phase = "retained";
		let blankFrameCount = 0;
		let firstNewSettingsIndex = -1;
		for (let index = 0; index < frameAnalyses.length; index += 1) {
			const analysis = frameAnalyses[index];
			const exactRetained = matchesExactSettingsCenterFrame(
				analysis,
				beforeAnalysis,
			);
			const blank = isSettingsCenterBlankFrame(analysis);
			const fallback = isSettingsCenterFallbackFrame(analysis);
			const settings = matchesSettingsCenterFrame(analysis, beforeAnalysis);

			if (phase === "retained") {
				if (exactRetained) continue;
				if (fallback) throw fail("settings-fallback-frame-emitted");
				if (blank) {
					phase = "blank";
					blankFrameCount += 1;
					continue;
				}
				if (settings) {
					phase = "settings";
					firstNewSettingsIndex = index;
					continue;
				}
				throw fail("settings-frame-mismatch");
			}

			if (phase === "blank") {
				if (blank) {
					blankFrameCount += 1;
					continue;
				}
				if (fallback) throw fail("settings-fallback-frame-emitted");
				if (settings) {
					phase = "settings";
					firstNewSettingsIndex = index;
					continue;
				}
				throw fail("settings-frame-mismatch");
			}

			if (phase === "settings") {
				if (blank) throw fail("settings-blank-frame-emitted");
				if (fallback) throw fail("settings-fallback-frame-emitted");
				if (!settings) throw fail("settings-frame-mismatch");
				continue;
			}
			throw fail("settings-frame-mismatch");
		}

		if (firstNewSettingsIndex < 0) {
			if (phase !== "retained") {
				throw fail("settings-nonblank-frame-missing");
			}
			if (!matchesExactSettingsCenterFrame(afterAnalysis, beforeAnalysis)) {
				throw fail("settings-retained-pixels-changed");
			}
			return {
				beforeVisible,
				afterVisible,
				frameBytes: 0,
				leadingBlankFrameCount: 0,
				nonblankFrameCount: 0,
				retainedPixels: true,
				allFramesMatch: true,
				analysis: afterAnalysis,
				retainedPixelHash: afterAnalysis.pixelHash,
			};
		}

		const postSettingsFrameAnalyses = frameAnalyses.slice(
			firstNewSettingsIndex,
		);
		const frameFingerprintDistances = postSettingsFrameAnalyses.map(
			(analysis) => settingsCenterFingerprintDistance(analysis, beforeAnalysis),
		);
		return {
			beforeVisible,
			afterVisible,
			frameBytes: Buffer.byteLength(
				frames[firstNewSettingsIndex].data,
				"base64",
			),
			leadingBlankFrameCount: blankFrameCount,
			nonblankFrameCount: postSettingsFrameAnalyses.length,
			retainedPixels: false,
			allFramesMatch: true,
			maxDarkTopRatio: Math.max(
				...postSettingsFrameAnalyses.map((analysis) => analysis.darkTopRatio),
			),
			maxFingerprintDistance: Math.max(...frameFingerprintDistances),
			analysis: postSettingsFrameAnalyses[0],
		};
	}

	if (!matchesExactSettingsCenterFrame(afterAnalysis, beforeAnalysis)) {
		throw fail("settings-retained-pixels-changed");
	}
	return {
		beforeVisible,
		afterVisible,
		frameBytes: 0,
		leadingBlankFrameCount: 0,
		retainedPixels: true,
		allFramesMatch: true,
		analysis: afterAnalysis,
		retainedPixelHash: afterAnalysis.pixelHash,
	};
}
