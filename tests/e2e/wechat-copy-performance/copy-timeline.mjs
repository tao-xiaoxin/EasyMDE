import { expect } from "@playwright/test";
import { uploadPathSuffix } from "./trace-contract.mjs";
import { writeFailureSnapshot } from "./private-evidence.mjs";

export async function waitForCopySuccess(page, testInfo, uploadTimeline = null) {
	let snapshotWritten = false;
	let snapshotError = false;
	let terminalCode = "pending";
	try {
		await expect
			.poll(
				async () => {
					const stateCode = await page.evaluate(() => {
						const probe = globalThis.__easymdeWechatCopyPerformance;
						const current = probe?.getState?.();
						if (!current) return "missing";
						if (current.status.some(({ code }) => code === "failed"))
							return "failed";
						if (current.status.some(({ code }) => code === "success"))
							return "success";
						return "pending";
					});
					terminalCode = stateCode;
					if (terminalCode === "failed" && !snapshotWritten) {
						try {
							await writeFailureSnapshot(
								testInfo,
								page,
								"copy-terminal",
								"wechat-copy-performance-copy-failed",
								uploadTimeline,
							);
						} catch {
							snapshotError = true;
						} finally {
							snapshotWritten = true;
						}
					}
					return terminalCode;
				},
				{ timeout: 120_000 },
			)
			.toMatch(/^(?:success|failed)$/u);
	} catch {
		if (!snapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"copy-terminal",
					terminalCode === "failed"
						? "wechat-copy-performance-copy-failed"
						: "wechat-copy-performance-copy-timeout",
					uploadTimeline,
				);
			} catch {
				snapshotError = true;
			} finally {
				snapshotWritten = true;
			}
		}
		throw new Error(
			snapshotError
				? "wechat-copy-performance-failure-snapshot-unavailable"
				: terminalCode === "failed"
					? "wechat-copy-performance-copy-failed"
					: "wechat-copy-performance-copy-timeout",
		);
	}
	if (terminalCode === "failed") {
		throw new Error(
			snapshotError
				? "wechat-copy-performance-failure-snapshot-unavailable"
				: "wechat-copy-performance-copy-failed",
		);
	}
}

export async function waitForNativeWriteFulfilled(
	page,
	testInfo,
	uploadTimeline = null,
) {
	let snapshotWritten = false;
	let terminalCode = "pending";
	try {
		await expect
			.poll(
				async () => {
					const state = await page.evaluate(() => {
						const current =
							globalThis.__easymdeWechatCopyPerformance?.getState?.();
						return current?.writes[0]?.nativeState ?? "pending";
					});
					terminalCode = state;
					if (state === "rejected" && !snapshotWritten) {
						try {
							await writeFailureSnapshot(
								testInfo,
								page,
								"native-write",
								"wechat-copy-performance-native-write-rejected",
								uploadTimeline,
							);
						} finally {
							snapshotWritten = true;
						}
					}
					return state;
				},
				{ timeout: 10_000 },
			)
			.toBe("fulfilled");
	} catch {
		if (!snapshotWritten) {
			try {
				await writeFailureSnapshot(
					testInfo,
					page,
					"native-write",
					terminalCode === "rejected"
						? "wechat-copy-performance-native-write-rejected"
						: "wechat-copy-performance-native-write-timeout",
					uploadTimeline,
				);
			} finally {
				snapshotWritten = true;
			}
		}
		throw new Error(
			terminalCode === "rejected"
				? "wechat-copy-performance-native-write-rejected"
				: "wechat-copy-performance-native-write-timeout",
		);
	}
}

export async function readClipboardShape(page) {
	return page.evaluate(async () => {
		if (
			!navigator.clipboard ||
			typeof navigator.clipboard.read !== "function"
		) {
			throw new Error(
				"wechat-copy-performance-native-clipboard-read-unavailable",
			);
		}
		const items = await navigator.clipboard.read();
		const typeCounts = items.map((item) =>
			Array.isArray(item.types) ? item.types.length : 0,
		);
		return { itemCount: items.length, typeCounts };
	});
}

export function matchesUploadTarget(target) {
	try {
		return (
			target.method() === "POST" &&
			new URL(target.url()).pathname.endsWith(uploadPathSuffix)
		);
	} catch {
		return false;
	}
}

export function readRequestTiming(request) {
	try {
		const timing = request.timing();
		return timing && typeof timing === "object" ? timing : null;
	} catch {
		return null;
	}
}

export function timingEpoch(timing, key) {
	if (
		!timing ||
		!Number.isFinite(timing.startTime) ||
		timing.startTime <= 0 ||
		!Number.isFinite(timing[key]) ||
		timing[key] < 0
	)
		return null;
	return timing.startTime + timing[key];
}

export function createUploadTimeline(page) {
	const records = new Map();
	let nextOrdinal = 1;
	let inFlight = 0;
	let peakInFlight = 0;
	let stopped = false;
	const updateRecordTiming = (record, request) => {
		const timing = readRequestTiming(request);
		const startEpoch = timingEpoch(timing, "requestStart");
		const responseEpoch = timingEpoch(timing, "responseStart");
		const settleEpoch = timingEpoch(timing, "responseEnd");
		if (record.startEpoch === null && startEpoch !== null)
			record.startEpoch = startEpoch;
		if (record.responseEpoch === null && responseEpoch !== null)
			record.responseEpoch = responseEpoch;
		return settleEpoch;
	};

	const onRequest = (request) => {
		if (!matchesUploadTarget(request) || records.has(request)) return;
		const record = {
			ordinal: nextOrdinal++,
			startEpoch: null,
			responseEpoch: null,
			settleEpoch: null,
			status: null,
			terminal: "pending",
		};
		records.set(request, record);
		updateRecordTiming(record, request);
		inFlight += 1;
		peakInFlight = Math.max(peakInFlight, inFlight);
	};

	const onResponse = (response) => {
		const request = response.request();
		const record = records.get(request);
		if (!record) return;
		updateRecordTiming(record, request);
		const status = response.status();
		if (Number.isInteger(status)) record.status = status;
	};

	const finalize = (request, terminal) => {
		const record = records.get(request);
		if (record?.terminal !== "pending") return;
		const settleEpoch = updateRecordTiming(record, request);
		if (settleEpoch !== null) record.settleEpoch = settleEpoch;
		record.terminal = terminal;
		inFlight = Math.max(0, inFlight - 1);
	};

	const onRequestFinished = (request) => finalize(request, "finished");
	const onRequestFailed = (request) => finalize(request, "failed");

	page.on("request", onRequest);
	page.on("response", onResponse);
	page.on("requestfinished", onRequestFinished);
	page.on("requestfailed", onRequestFailed);

	return {
		failureFacts() {
			return {
				clock: "page-performance-upload-failure-facts",
				observedCount: records.size,
				peakInFlight,
				unsettledCount: inFlight,
				uploads: [...records.values()]
					.sort((left, right) => left.ordinal - right.ordinal)
					.map((record) => ({
						ordinal: record.ordinal,
						startAvailable: record.startEpoch !== null,
						firstByteAvailable: record.responseEpoch !== null,
						settleAvailable: record.settleEpoch !== null,
						status: record.status,
						terminal: record.terminal,
					})),
			};
		},
		async snapshot(pageSample) {
			const pageTimeOrigin = await page.evaluate(() => performance.timeOrigin);
			if (!Number.isFinite(pageTimeOrigin)) {
				throw new Error("wechat-copy-performance-upload-clock-unavailable");
			}
			if (
				!Number.isFinite(pageSample.clickAt) ||
				!Number.isFinite(pageSample.statusSuccessAt) ||
				pageSample.statusSuccessAt < pageSample.clickAt
			) {
				throw new Error("wechat-copy-performance-upload-copy-window-invalid");
			}
			const toOffset = (epoch) =>
				epoch === null ? null : epoch - pageTimeOrigin - pageSample.clickAt;
			return {
				clock: "page-performance-offset-from-copy-click",
				copyWindowDurationMs: pageSample.statusSuccessAt - pageSample.clickAt,
				peakInFlight,
				unsettledCount: inFlight,
				uploads: [...records.values()]
					.sort((left, right) => left.ordinal - right.ordinal)
					.map((record) => {
						const startMs = toOffset(record.startEpoch);
						const firstByteMs = toOffset(record.responseEpoch);
						const settleMs = toOffset(record.settleEpoch);
						return {
							ordinal: record.ordinal,
							startMs,
							firstByteMs,
							settleMs,
							durationMs:
								startMs !== null && settleMs !== null
									? settleMs - startMs
									: null,
							status: record.status,
							terminal: record.terminal,
							peakInFlight,
							timing: [startMs, firstByteMs, settleMs].every(Number.isFinite)
								? "available"
								: "unavailable",
						};
					}),
			};
		},
		stop() {
			if (stopped) return;
			stopped = true;
			page.off("request", onRequest);
			page.off("response", onResponse);
			page.off("requestfinished", onRequestFinished);
			page.off("requestfailed", onRequestFailed);
		},
	};
}

export function summarizeUploadTimeline(timeline) {
	if (timeline?.clock !== "page-performance-offset-from-copy-click")
		throw new Error("wechat-copy-performance-upload-clock-invalid");
	if (!Number.isFinite(timeline.copyWindowDurationMs))
		throw new Error("wechat-copy-performance-upload-copy-window-invalid");
	if (!Number.isInteger(timeline.peakInFlight) || timeline.peakInFlight < 1)
		throw new Error("wechat-copy-performance-r2-upload-unobserved");
	if (!Array.isArray(timeline.uploads) || timeline.uploads.length < 1)
		throw new Error("wechat-copy-performance-r2-upload-unobserved");
	if (timeline.unsettledCount !== 0)
		throw new Error("wechat-copy-performance-r2-upload-unsettled");
	const ordinals = timeline.uploads.map(({ ordinal }) => ordinal);
	if (
		ordinals.some((ordinal, index) => ordinal !== index + 1) ||
		new Set(ordinals).size !== ordinals.length
	)
		throw new Error("wechat-copy-performance-r2-upload-ordinal-invalid");
	for (const upload of timeline.uploads) {
		if (upload.timing !== "available")
			throw new Error("wechat-copy-performance-upload-timing-unavailable");
		if (
			upload.terminal !== "finished" ||
			!Number.isFinite(upload.startMs) ||
			!Number.isFinite(upload.firstByteMs) ||
			!Number.isFinite(upload.settleMs) ||
			!Number.isFinite(upload.durationMs) ||
			!Number.isInteger(upload.status) ||
			!Number.isInteger(upload.peakInFlight)
		)
			throw new Error("wechat-copy-performance-r2-upload-timing-invalid");
		if (
			upload.startMs < 0 ||
			upload.firstByteMs < upload.startMs ||
			upload.settleMs < upload.firstByteMs ||
			upload.settleMs > timeline.copyWindowDurationMs ||
			Math.abs(upload.durationMs - (upload.settleMs - upload.startMs)) > 0.001
		)
			throw new Error("wechat-copy-performance-r2-upload-window-invalid");
		if (upload.status < 200 || upload.status >= 300)
			throw new Error("wechat-copy-performance-r2-upload-http-failed");
	}
	return timeline;
}
