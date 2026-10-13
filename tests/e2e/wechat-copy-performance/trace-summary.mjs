import { copyTimingStages } from "./trace-contract.mjs";
import { genericTraceStageByName } from "./trace-contract.mjs";
import { traceClickMarker } from "./trace-contract.mjs";
import { traceEndMarker } from "./trace-contract.mjs";

export async function startTracing(context, page) {
	const cdp = await context.newCDPSession(page);
	try {
		await cdp.send("Tracing.start", {
			categories:
				"devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing",
			streamCompression: "none",
			streamFormat: "json",
			transferMode: "ReturnAsStream",
		});
	} catch {
		await cdp.detach().catch(() => undefined);
		throw new Error("wechat-copy-performance-tracing-start-failed");
	}
	return cdp;
}

export async function withDeadline(operation, failureCode, timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(failureCode)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function stopTracing(cdp) {
	let completeHandler;
	let streamHandle = null;
	let operationError = null;
	let cleanupError = null;
	let traceEvents = null;
	const complete = new Promise((resolveComplete) => {
		completeHandler = (payload) => resolveComplete(payload);
		cdp.on("Tracing.tracingComplete", completeHandler);
	});
	try {
		await cdp.send("Tracing.end");
		const payload = await withDeadline(
			complete,
			"wechat-copy-performance-tracing-complete-timeout",
			15_000,
		);
		if (
			payload.dataLossOccurred === true ||
			typeof payload.stream !== "string"
		) {
			throw new Error("wechat-copy-performance-tracing-stream-invalid");
		}
		streamHandle = payload.stream;
		let raw = "";
		let eof = false;
		while (!eof) {
			const chunk = await cdp.send("IO.read", { handle: streamHandle });
			if (typeof chunk.data !== "string") {
				throw new Error("wechat-copy-performance-tracing-data-invalid");
			}
			raw += chunk.base64Encoded
				? Buffer.from(chunk.data, "base64").toString("utf8")
				: chunk.data;
			eof = chunk.eof === true;
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error("wechat-copy-performance-tracing-json-invalid");
		}
		if (!Array.isArray(parsed?.traceEvents)) {
			throw new Error("wechat-copy-performance-tracing-events-unavailable");
		}
		traceEvents = parsed.traceEvents;
	} catch (error) {
		operationError = error;
		throw error;
	} finally {
		if (streamHandle) {
			try {
				await cdp.send("IO.close", { handle: streamHandle });
			} catch {
				if (!operationError) {
					cleanupError = new Error(
						"wechat-copy-performance-tracing-stream-close-failed",
					);
				}
			}
		}
		if (completeHandler) cdp.off("Tracing.tracingComplete", completeHandler);
		try {
			await cdp.detach();
		} catch {
			if (!operationError) {
				cleanupError ??= new Error(
					"wechat-copy-performance-tracing-detach-failed",
				);
			}
		}
	}
	if (!operationError && cleanupError) throw cleanupError;
	return traceEvents;
}

export function readTraceMarker(events, marker) {
	const matches = events
		.filter((event) => event && typeof event === "object")
		.filter((event) => {
			const data = event.args?.data;
			return (
				event.name === marker || data?.name === marker || data?.label === marker
			);
		})
		.map((event) => ({
			atMs: Number(event.ts) / 1000,
			pid: event.pid,
			tid: event.tid,
		}))
		.filter(({ atMs }) => Number.isFinite(atMs));
	return matches.length > 0 ? matches[0] : null;
}

export function traceExclusiveDuration(event, events) {
	const start = Number(event.ts) / 1000;
	const duration = Number(event.dur) / 1000;
	const end = start + duration;
	if (![start, duration, end].every(Number.isFinite) || duration <= 0) return 0;
	const children = events
		.filter((candidate) => candidate !== event)
		.filter((candidate) => candidate.ph === "X")
		.filter(
			(candidate) => candidate.pid === event.pid && candidate.tid === event.tid,
		)
		.map((candidate) => ({
			end: Number(candidate.ts) / 1000 + Number(candidate.dur) / 1000,
			start: Number(candidate.ts) / 1000,
		}))
		.filter((candidate) => candidate.start >= start && candidate.end <= end)
		.filter((candidate) => candidate.end > candidate.start)
		.sort((left, right) => left.start - right.start);
	let covered = 0;
	let coveredStart = null;
	let coveredEnd = null;
	for (const child of children) {
		if (coveredStart === null) {
			coveredStart = child.start;
			coveredEnd = child.end;
		} else if (child.start <= coveredEnd) {
			coveredEnd = Math.max(coveredEnd, child.end);
		} else {
			covered += coveredEnd - coveredStart;
			coveredStart = child.start;
			coveredEnd = child.end;
		}
	}
	if (coveredStart !== null) covered += coveredEnd - coveredStart;
	return Math.max(0, duration - Math.min(duration, covered));
}

export function summarizeTrace(events) {
	const clickMarker = readTraceMarker(events, traceClickMarker);
	const endMarker = readTraceMarker(events, traceEndMarker);
	if (
		!clickMarker ||
		!endMarker ||
		!Number.isFinite(clickMarker.pid) ||
		!Number.isFinite(clickMarker.tid) ||
		clickMarker.pid !== endMarker.pid ||
		clickMarker.tid !== endMarker.tid ||
		endMarker.atMs < clickMarker.atMs
	) {
		return {
			earlyFunctionAttribution: "unverified",
			reason: "trace-marker-owner-unavailable",
			records: [],
			status: "unverified",
		};
	}
	const clickAt = clickMarker.atMs;
	const endAt = endMarker.atMs;
	const rendererEvents = events.filter(
		(event) =>
			event &&
			typeof event === "object" &&
			event.pid === clickMarker.pid &&
			event.tid === clickMarker.tid,
	);
	const userTimingEvents = rendererEvents.filter((event) => {
		const data = event.args?.data;
		const symbol =
			typeof data?.name === "string"
				? data.name
				: typeof data?.label === "string"
					? data.label
					: event.name;
		return copyTimingStages.has(symbol);
	});
	const userTimingHit = userTimingEvents.length > 0;
	const records = rendererEvents
		.filter((event) => event.ph === "X")
		.map((event) => {
			const data = event.args?.data;
			const symbol =
				typeof data?.name === "string"
					? data.name
					: typeof data?.label === "string"
						? data.label
						: event.name;
			const capabilityStage = copyTimingStages.get(symbol);
			const genericStage = genericTraceStageByName.get(event.name);
			const stage = capabilityStage ?? genericStage;
			const startMs = Number(event.ts) / 1000;
			const durationMs = Number(event.dur) / 1000;
			if (
				!stage ||
				!Number.isFinite(startMs) ||
				!Number.isFinite(durationMs) ||
				durationMs <= 0
			) {
				return null;
			}
			const finishMs = startMs + durationMs;
			const overlapStart = Math.max(startMs, clickAt);
			const overlapEnd = Math.min(finishMs, endAt);
			if (!(overlapEnd > overlapStart)) return null;
			return {
				durationMs,
				layoutCount: 0,
				offsetMs: startMs - clickAt,
				selfTimeMs: traceExclusiveDuration(event, events),
				stage,
				attribution: capabilityStage
					? "user-timing-capability"
					: "non-attributed",
			};
		})
		.filter(Boolean);
	if (records.length === 0) {
		return {
			earlyFunctionAttribution: "unverified",
			reason: userTimingHit
				? "user-timing-duration-unavailable"
				: "known-dtd-symbol-not-observed",
			records: [],
			status: userTimingHit ? "verified" : "unverified",
		};
	}
	return {
		earlyFunctionAttribution: "unverified",
		records,
		status: userTimingHit ? "verified" : "unverified",
	};
}

export function overlapRecords(entries, startMs, endMs) {
	return entries
		.map((entry) => {
			const finishMs = entry.startMs + entry.durationMs;
			const overlapStart = Math.max(entry.startMs, startMs);
			const overlapEnd = Math.min(finishMs, endMs);
			if (!(overlapEnd > overlapStart)) return null;
			return {
				durationMs: entry.durationMs,
				overlapDurationMs: overlapEnd - overlapStart,
				overlapOffsetMs: overlapStart - startMs,
				startMs: entry.startMs,
				stage: "longtask",
			};
		})
		.filter(Boolean);
}

export function summarizePageTiming(sample) {
	if (
		!Number.isFinite(sample.clickAt) ||
		!Number.isFinite(sample.endAt) ||
		sample.endAt < sample.clickAt
	) {
		throw new Error("wechat-copy-performance-page-interval-invalid");
	}
	if (sample.observerError) throw new Error(sample.observerError);
	if (sample.clicks.length !== 1)
		throw new Error("wechat-copy-performance-click-count-invalid");
	const writes = sample.writes;
	if (writes.length !== 1)
		throw new Error("wechat-copy-performance-native-write-count-invalid");
	const [write] = writes;
	if (
		write.nativeState !== "fulfilled" ||
		write.itemCount !== 1 ||
		write.activation !== true
	) {
		throw new Error("wechat-copy-performance-native-write-state-invalid");
	}
	const clickState = sample.clicks[0].owner;
	if (
		clickState.ownerDocumentMatches !== true ||
		clickState.defaultViewMatches !== true ||
		clickState.selfMatchesWindow !== true ||
		clickState.topMatchesSelf !== true ||
		clickState.documentHasFocus !== true ||
		clickState.visibilityState !== "visible"
	) {
		throw new Error("wechat-copy-performance-click-owner-state-invalid");
	}
	if (!sample.status.some(({ code }) => code === "success")) {
		throw new Error("wechat-copy-performance-success-status-unavailable");
	}
	if (
		!Number.isFinite(sample.statusSuccessAt) ||
		sample.statusSuccessAt > sample.endAt
	) {
		throw new Error("wechat-copy-performance-copy-terminal-invalid");
	}
	if (!Number.isFinite(write.settledAt)) {
		throw new Error("wechat-copy-performance-native-write-settlement-invalid");
	}
	if (sample.rafs.filter(({ index }) => index > 0).length < 3) {
		throw new Error("wechat-copy-performance-raf-sequence-incomplete");
	}
	if (!sample.rafs.some(({ index }) => index === 0)) {
		throw new Error("wechat-copy-performance-zero-delay-task-unavailable");
	}
	const longTasks = overlapRecords(
		sample.longTasks,
		sample.clickAt,
		sample.statusSuccessAt,
	);
	const measures = sample.measures.map((measure) => ({
		detail: measure.detail,
		durationMs: measure.durationMs,
		offsetMs: measure.startMs - sample.clickAt,
		stage: copyTimingStages.get(measure.name),
	}));
	if (measures.length === 0)
		throw new Error("wechat-copy-performance-measures-unavailable");
	if (measures.some(({ stage }) => !stage)) {
		throw new Error("wechat-copy-performance-measure-stage-invalid");
	}
	const earlyStages = sample.rafs.map(({ at, index }) => ({
		durationMs: 0,
		layoutCount: 0,
		offsetMs: at - sample.clickAt,
		selfTimeMs: 0,
		stage: index === 0 ? "task-zero-delay" : `raf-${index}`,
	}));
	return {
		longTasks,
		measures,
		clickOwner: sample.clicks[0].owner,
		copyTerminalAt: sample.statusSuccessAt,
		notifications: sample.status,
		ownerChanges: sample.ownerChanges,
		ownerChangeStages: sample.ownerChanges.map(({ at, type }) => ({
			durationMs: 0,
			layoutCount: 0,
			offsetMs: at - sample.clickAt,
			selfTimeMs: 0,
			stage: `owner-${type}`,
		})),
		pageInterval: {
			durationMs: sample.statusSuccessAt - sample.clickAt,
			layoutCount: 0,
			offsetMs: 0,
			selfTimeMs: 0,
			stage: "copy-interval",
		},
		earlyStages,
		write: {
			activation: write.activation,
			at: write.at,
			nativeState: write.nativeState,
			owner: write.owner,
			settledAt: write.settledAt,
		},
	};
}
