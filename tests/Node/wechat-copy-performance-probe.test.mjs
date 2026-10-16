import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import {
	copyTimingStages,
	timingDetailOwners,
} from "../e2e/wechat-copy-performance/trace-contract.mjs";

// The performance spec keeps registration and fixture binding; the probe,
// diagnostics environment, and server bundle identity owners are dedicated
// modules loaded here for focused verification.
const probeSource = readFileSync(
	new URL(
		"../e2e/wechat-copy-performance/performance-probe.mjs",
		import.meta.url,
	),
	"utf8",
);
const diagnosticsSource = readFileSync(
	new URL("../e2e/wechat-copy-performance/environment.mjs", import.meta.url),
	"utf8",
);
const serverBundleSource = readFileSync(
	new URL("../e2e/wechat-copy-performance/server-bundle.mjs", import.meta.url),
	"utf8",
);
const performanceSources = [
	probeSource,
	diagnosticsSource,
	serverBundleSource,
].join("\n");
const probeArguments = {
	beginMarker: "test.begin",
	clickMarker: "test.click",
	copyTimingStageEntries: [...copyTimingStages.entries()],
	endMarker: "test.end",
	timingDetailKindValues: ["math", "mermaid"],
	timingDetailModeValues: ["async", "sync"],
	timingDetailOwnerValues: [...timingDetailOwners],
	timingDetailTerminalValues: ["error", "success"],
};

function loadProbeInitializer(context) {
	const installStart = probeSource.indexOf(
		"function installPerformanceProbe(page)",
	);
	const callbackStart = probeSource.indexOf(
		"({\n\t\t\tbeginMarker",
		installStart,
	);
	const callbackEndMarker =
		"\n\t\t},\n\t\t{\n\t\t\tbeginMarker: traceBeginMarker";
	const callbackEnd = probeSource.indexOf(callbackEndMarker, callbackStart);
	assert.ok(installStart >= 0);
	assert.ok(callbackStart > installStart);
	assert.ok(callbackEnd > callbackStart);
	const callbackSource = probeSource.slice(
		callbackStart,
		callbackEnd + "\n\t\t}".length,
	);
	return vm.runInContext(`(${callbackSource})`, context);
}

function loadDiagnosticsFlagValidator() {
	const start = diagnosticsSource.indexOf(
		"function localDiagnosticsEnabledFromSetting(value)",
	);
	const end = diagnosticsSource.indexOf(
		"\nexport const localDiagnosticsEnabled =",
		start,
	);
	assert.ok(start >= 0);
	assert.ok(end > start);
	return vm.runInNewContext(`(${diagnosticsSource.slice(start, end).trim()})`);
}

function bindDomContext(context, PerformanceObserver) {
	context.PerformanceObserver = PerformanceObserver;
}

function createProbeHarness(markup) {
	const dom = new JSDOM(markup, {
		pretendToBeVisual: true,
		url: "http://localhost:8093/wp-admin/post.php",
	});
	const { window } = dom;
	const nativeWrites = [];
	const observers = [];
	const clipboard = {
		write(items) {
			nativeWrites.push(items);
			return Promise.resolve();
		},
	};
	Object.defineProperty(window.navigator, "clipboard", {
		configurable: true,
		value: clipboard,
	});
	Object.defineProperty(window.navigator, "userActivation", {
		configurable: true,
		value: { isActive: true },
	});
	Object.defineProperty(window.document, "hasFocus", {
		configurable: true,
		value: () => true,
	});
	class StubPerformanceObserver {
		static supportedEntryTypes = ["measure", "longtask"];

		constructor(callback) {
			this.callback = callback;
			observers.push(this);
		}

		observe(options) {
			this.type = options?.type;
		}

		takeRecords() {
			return [];
		}

		disconnect() {}
	}
	window.PerformanceObserver = StubPerformanceObserver;
	Object.defineProperty(window.performance, "mark", {
		configurable: true,
		value: () => {},
	});
	Object.defineProperty(window.performance, "clearMarks", {
		configurable: true,
		value: () => {},
	});
	const context = vm.createContext(window);
	bindDomContext(context, StubPerformanceObserver);
	return { context, dom, nativeWrites, observers, window };
}

function initializeProbe(context) {
	const initializer = loadProbeInitializer(context);
	initializer(probeArguments);
	return vm.runInContext("globalThis.__easymdeWechatCopyPerformance", context);
}

async function runProbeScenario(markup, targetSelector) {
	const { context, dom, nativeWrites, window } = createProbeHarness(markup);
	try {
		const probe = initializeProbe(context);
		assert.ok(probe);
		probe.begin();
		const target = window.document.querySelector(targetSelector);
		assert.ok(target);
		target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await window.navigator.clipboard.write(["clipboard-item"]);
		await probe.awaitEarlyPhases();
		const sample = probe.end();
		assert.equal(nativeWrites.length, 1);
		assert.equal(sample.writes.length, 1);
		assert.equal(sample.writes[0].nativeState, "fulfilled");
		assert.equal(sample.clicks.length, 1);
		assert.ok(Number.isFinite(sample.clickAt));
		assert.ok(Number.isFinite(sample.endAt));
		assert.ok(sample.endAt >= sample.clickAt);
		assert.equal(sample.rafs.filter(({ index }) => index > 0).length, 3);
		assert.equal(sample.rafs.filter(({ index }) => index === 0).length, 1);
		return sample;
	} finally {
		vm.runInContext(
			"globalThis.__easymdeWechatCopyPerformance?.stop()",
			context,
		);
		dom.window.close();
	}
}

test("performance probe executes ordinary and immersive owner paths", async () => {
	const ordinary = await runProbeScenario(
		'<button class="easymde-toolbar-copy-action"><span data-target="copy"></span></button>',
		"[data-target=copy]",
	);
	assert.equal(ordinary.clicks[0].surface, "ordinary");
	assert.equal(ordinary.writes[0].surface, "ordinary");
	assert.equal(ordinary.clicks[0].owner.ownerDocumentMatches, true);

	const immersive = await runProbeScenario(
		'<button class="easymde-immersive-wechat"><span data-target="copy"></span></button>',
		"[data-target=copy]",
	);
	assert.equal(immersive.clicks[0].surface, "immersive");
	assert.equal(immersive.writes[0].surface, "immersive");
	assert.equal(immersive.clicks[0].owner.ownerDocumentMatches, true);
});

test("performance probe leaves unrelated clicks out of timing state", () => {
	const { context, dom, window } = createProbeHarness(
		'<button class="easymde-toolbar-theme" data-target="theme"></button>',
	);
	try {
		const probe = initializeProbe(context);
		probe.begin();
		window.document.querySelector("[data-target=theme]").click();
		const state = probe.getState();
		assert.equal(state.clickAt, null);
		assert.equal(state.clickCount, 0);
		assert.equal(state.writeCount, 0);
		assert.equal(state.rafs.length, 0);
	} finally {
		vm.runInContext(
			"globalThis.__easymdeWechatCopyPerformance?.stop()",
			context,
		);
		dom.window.close();
	}
});

test("local diagnostics flag rejects values outside the shared contract", () => {
	const validate = loadDiagnosticsFlagValidator();
	assert.equal(validate(undefined), false);
	assert.equal(validate(""), false);
	assert.equal(validate(" 0 "), false);
	assert.equal(validate(" 1 "), true);
	for (const value of ["2", "true", "enabled"]) {
		assert.throws(() => validate(value), /local-diagnostics-flag-invalid/u);
	}
});

test("performance profile identity follows the current checked-in artifact", () => {
	const manifest = JSON.parse(
		readFileSync(
			new URL("../../assets/build/manifest.json", import.meta.url),
			"utf8",
		),
	);
	const entry = manifest["frontend/src/entrypoints/admin-editor.tsx"];
	assert.equal(entry?.isEntry, true);
	assert.match(entry?.file ?? "", /^assets\/admin-editor-[A-Za-z0-9_-]+\.js$/u);
	assert.ok(
		readFileSync(new URL(`../../assets/build/${entry.file}`, import.meta.url))
			.length > 0,
	);
	assert.match(
		serverBundleSource,
		/function readCurrentServerBundleIdentity\(\)/u,
	);
	assert.match(serverBundleSource, /assets\/build\/manifest\.json/u);
	assert.doesNotMatch(performanceSources, /expectedDtdEditor|MatchesDtd/u);
});

function measureEntry(name, detail, startTime = 10, duration = 2) {
	return { detail, duration, entryType: "measure", name, startTime };
}

function emitMeasures(observers, entries) {
	const measureObserver = observers.find(({ type }) => type === "measure");
	assert.ok(measureObserver);
	measureObserver.callback({ getEntries: () => entries });
}

function normalize(value) {
	return JSON.parse(JSON.stringify(value));
}

test("performance probe whitelists production copy timings and retains safe detail fields", () => {
	const names = [
		"easymde.wechat.copy.total",
		"easymde.wechat.copy.geometry-readiness",
		"easymde.wechat.copy.inline-styles",
		"easymde.wechat.copy.markup-preparation",
		"easymde.wechat.copy.task-geometry-readiness",
		"easymde.wechat.copy.transition-readiness",
	];
	for (const name of names) assert.ok(copyTimingStages.has(name), name);

	const harness = createProbeHarness(
		"<!doctype html><html><body></body></html>",
	);
	try {
		const probe = initializeProbe(harness.context);
		probe.begin();
		emitMeasures(harness.observers, [
			measureEntry("easymde.wechat.copy.total", {
				mode: "async",
				terminal: "success",
			}),
			measureEntry("easymde.wechat.copy.geometry-readiness", {
				hidden: false,
				mode: "async",
				owner: "source",
				pairs: 3,
				terminal: "success",
			}),
			measureEntry("easymde.wechat.copy.inline-styles", {
				mode: "async",
				terminal: "success",
			}),
			measureEntry("easymde.wechat.copy.markup-preparation", {
				mode: "async",
				terminal: "success",
			}),
			measureEntry("easymde.wechat.copy.task-geometry-readiness", {
				hidden: true,
				mode: "async",
				owner: "task-geometry",
				terminal: "success",
			}),
			measureEntry("easymde.wechat.copy.transition-readiness", {
				hidden: false,
				mode: "async",
				owner: "source",
				terminal: "success",
			}),
		]);
		const sample = probe.end();
		assert.equal(sample.observerError, null);
		assert.deepEqual(
			normalize(sample.measures.map(({ name, detail }) => ({ name, detail }))),
			[
				{
					name: "easymde.wechat.copy.total",
					detail: { mode: "async", terminal: "success" },
				},
				{
					name: "easymde.wechat.copy.geometry-readiness",
					detail: {
						hidden: false,
						mode: "async",
						owner: "source",
						pairs: 3,
						terminal: "success",
					},
				},
				{
					name: "easymde.wechat.copy.inline-styles",
					detail: { mode: "async", terminal: "success" },
				},
				{
					name: "easymde.wechat.copy.markup-preparation",
					detail: { mode: "async", terminal: "success" },
				},
				{
					name: "easymde.wechat.copy.task-geometry-readiness",
					detail: {
						hidden: true,
						mode: "async",
						owner: "task-geometry",
						terminal: "success",
					},
				},
				{
					name: "easymde.wechat.copy.transition-readiness",
					detail: {
						hidden: false,
						mode: "async",
						owner: "source",
						terminal: "success",
					},
				},
			],
		);
	} finally {
		vm.runInContext(
			"globalThis.__easymdeWechatCopyPerformance?.stop()",
			harness.context,
		);
		harness.dom.window.close();
	}
});

const unknownDetailCases = [
	[
		"enumerable",
		(detail, sentinel) => {
			detail.secret = sentinel;
			return detail;
		},
	],
	[
		"non-enumerable",
		(detail, sentinel) => {
			Object.defineProperty(detail, "secret", {
				configurable: true,
				value: sentinel,
			});
			return detail;
		},
	],
	[
		"Symbol",
		(detail, sentinel) => {
			detail[Symbol("secret")] = sentinel;
			return detail;
		},
	],
];

for (const [kind, addUnknownField] of unknownDetailCases) {
	test(`performance probe rejects unknown ${kind} timing detail fields`, () => {
		const sentinel = `wechat-sensitive-${kind}-sentinel`;
		const harness = createProbeHarness(
			"<!doctype html><html><body></body></html>",
		);
		try {
			const probe = initializeProbe(harness.context);
			probe.begin();
			const detail = addUnknownField(
				{ mode: "async", terminal: "success" },
				sentinel,
			);
			emitMeasures(harness.observers, [
				measureEntry("easymde.wechat.copy.total", detail),
			]);
			const sample = probe.end();
			assert.equal(
				sample.observerError,
				"wechat-copy-performance-measure-detail-keys-invalid",
			);
			assert.deepEqual(normalize(sample.measures), []);
			assert.equal(JSON.stringify(sample).includes(sentinel), false);
		} finally {
			vm.runInContext(
				"globalThis.__easymdeWechatCopyPerformance?.stop()",
				harness.context,
			);
			harness.dom.window.close();
		}
	});
}
