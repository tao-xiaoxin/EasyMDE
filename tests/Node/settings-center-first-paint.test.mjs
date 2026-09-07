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
		"const handleScreencastFrame = ({ data, sessionId }) => {",
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
		"if (committed && collectFrames) frames.push(data);",
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

	assert.match(
		firstPaintSource,
		/test\.step\(`settings-center-first-paint:\$\{scenario\.name\}/u,
	);
});
