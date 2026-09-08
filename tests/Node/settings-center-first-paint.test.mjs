import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const firstPaintSource = readFileSync(
	join(repoRoot, "tests/e2e/settings-center.spec.mjs"),
	"utf8",
);

test("first-paint screencast collection stops at semantic readiness", () => {
	const handlerStart = firstPaintSource.indexOf(
		"const handleScreencastFrame = ({ data, metadata, sessionId }) => {",
	);
	const handlerEnd = firstPaintSource.indexOf(
		'\n\tcdp.on("Page.frameNavigated", handleFrameNavigated);',
		handlerStart,
	);
	assert.ok(handlerStart >= 0, "screencast handler should exist");
	assert.ok(handlerEnd > handlerStart, "screencast handler should be bounded");
	const handler = firstPaintSource.slice(handlerStart, handlerEnd);

	const ackIndex = handler.indexOf(
		'cdp.send("Page.screencastFrameAck", { sessionId })',
	);
	const collectIndex = handler.indexOf(
		"frames.push({ data, timestamp: metadata.timestamp });",
	);
	assert.ok(ackIndex >= 0, "every screencast frame must be acknowledged");
	assert.ok(collectIndex > ackIndex, "ACK must happen before collection");

	const readyIndex = firstPaintSource.indexOf(
		"await waitForSettingsCenterReady(page);",
		handlerEnd,
	);
	const disableIndex = firstPaintSource.indexOf(
		"collectFrames = false;",
		readyIndex,
	);
	const stopIndex = firstPaintSource.indexOf(
		'await cdp.send("Page.stopScreencast");',
		disableIndex,
	);
	assert.ok(readyIndex >= 0, "semantic readiness wait should exist");
	assert.ok(disableIndex > readyIndex, "collection must close after readiness");
	assert.ok(
		stopIndex > disableIndex,
		"screencast must stop after collection closes",
	);
});

test("first-paint screencast frames are bound to the initialized navigation loader", () => {
	const lifecycleHandlerIndex = firstPaintSource.indexOf(
		"const handleLifecycleEvent = ({ frameId, loaderId, name, timestamp }) => {",
	);
	const lifecycleListenerIndex = firstPaintSource.indexOf(
		'cdp.on("Page.lifecycleEvent", handleLifecycleEvent);',
	);
	const lifecycleEnableIndex = firstPaintSource.indexOf(
		'cdp.send("Page.setLifecycleEventsEnabled", { enabled: true })',
	);
	const reloadIndex = firstPaintSource.indexOf(
		"await reloadSettingsCenterForFirstPaint(page, cdp, refreshMode);",
	);
	const loaderBindingIndex = firstPaintSource.indexOf(
		"navigationLoaderId = frame.loaderId;",
	);
	const timestampFilterIndex = firstPaintSource.indexOf(
		"metadata.timestamp >= navigationInitTimestamp",
	);
	const lifecycleTimestampGuardIndex = firstPaintSource.indexOf(
		'settings-lifecycle-init-missing',
	);
	assert.ok(lifecycleHandlerIndex >= 0, "lifecycle handler should exist");
	assert.ok(
		lifecycleListenerIndex > lifecycleHandlerIndex,
		"lifecycle handler must be registered",
	);
	assert.ok(
		lifecycleEnableIndex > lifecycleListenerIndex &&
		lifecycleEnableIndex < reloadIndex,
		"lifecycle events must be enabled before navigation",
	);
	assert.ok(
		loaderBindingIndex >= 0,
		"navigation loader must come from the main-frame navigation",
	);
	assert.ok(
		timestampFilterIndex > loaderBindingIndex,
		"screencast frames must be filtered by the initialized navigation timestamp",
	);
	assert.ok(
		lifecycleTimestampGuardIndex > timestampFilterIndex,
		"missing lifecycle init must fail explicitly",
	);
});

test("first-paint classifier does not accept the near-white fallback as Settings", () => {
	assert.match(
		firstPaintSource,
		/SETTINGS_CENTER_FRAME_MAX_WHITE_RATIO = 0\.98/u,
	);
	assert.match(
		firstPaintSource,
		/isSettingsCenterFallbackFrame\(analysis\)/u,
	);
	assert.match(
		firstPaintSource,
		/settings-fallback-frame-emitted/u,
	);
	assert.match(
		firstPaintSource,
		/matchesExactSettingsCenterFrame\(\s*analysis,\s*beforeAnalysis,?\s*\)/u,
	);
	assert.match(firstPaintSource, /let phase = "retained";/u);
	assert.match(firstPaintSource, /phase === "blank"/u);
	assert.match(firstPaintSource, /phase === "settings"/u);
});
