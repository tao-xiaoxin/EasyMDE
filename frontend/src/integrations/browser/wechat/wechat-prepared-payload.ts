import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	type SerializationYield,
	WECHAT_COPY_TIMING_NAMES,
	backgroundPreparationAbortError,
	createSerializationYield,
	throwIfBackgroundPreparationAborted,
	waitForBrowserTask,
} from "./wechat-clipboard-runtime";
import {
	type ClipboardSourceFreshnessState,
	type WechatClipboardCopyGuard,
	assertPortableCopyCurrent,
	clipboardSourceMarkup,
	isRetryableBackgroundPreparationError,
} from "./wechat-source-freshness";
import {
	type TaskCheckboxGeometryLease,
	createTaskCheckboxGeometryLease,
} from "./wechat-task-geometry";
import {
	type WechatDimensionSemanticsContext,
	createDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import {
	type WechatPreviewMeasurementLease,
	type WechatPreviewTransitionLease,
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	isPreviewHidden,
} from "./wechat-preview-measurement";
import { beginWechatTiming, runWechatSyncTiming } from "./wechat-timing";
import {
	preparedDimensionGeometrySignature,
	preparedDimensionSemanticsSignature,
	preparedLayoutSignature,
	preparedLayoutSignatureWithYield,
} from "./wechat-fidelity-signature";
import {
	captureWechatMathSourceAdmission,
	captureWechatMathSourceAdmissionSynchronously,
	hasWechatMathStaticFlowCandidate,
	serializeClipboardPayload,
} from "./wechat-portable-serialization";
import type {
	SerializedClipboardPayload,
	WechatMathSourceCaptureResult,
} from "./wechat-portable-serialization";
export type PreparedClipboardFallback = Readonly<{
	dimensionSignature: string;
	layoutSignature: string;
	payload: SerializedClipboardPayload;
	sequence: number;
	sourceMarkup: string;
	mathSourceAdmission: WechatMathSourceCaptureResult;
}>;

export type PreparedClipboardPayload = {
	backgroundCancel: (() => void) | null;
	payload: SerializedClipboardPayload | null;
	promise: Promise<SerializedClipboardPayload>;
	sequence: number;
	sourceMarkup: string;
	dimensionSignature: string;
	layoutSignature: string;
	fallback: PreparedClipboardFallback | null;
	recoveredAtLayoutSignature: string | null;
	layoutOwner: "live" | "measurement";
	mathSourceAdmission: WechatMathSourceCaptureResult;
};
export type PreparedClipboardPayloadCache = WeakMap<
	HTMLElement,
	PreparedClipboardPayload
>;

export function reusablePreparedClipboardPayload(
	prepared: PreparedClipboardPayload | undefined,
	sourceMarkup: string,
	dimensionSignature: string,
	layoutSignature: string,
	pendingFallback: PreparedClipboardFallback | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
): SerializedClipboardPayload | null {
	if (
		prepared?.payload &&
		prepared.sourceMarkup === sourceMarkup &&
		prepared.mathSourceAdmission.sourceFingerprint === mathSourceFingerprint &&
		prepared.mathSourceAdmission.rawDimensionGeometrySignature ===
			mathRawDimensionGeometrySignature &&
		prepared.dimensionSignature === dimensionSignature &&
		prepared.layoutSignature === layoutSignature
	) {
		return prepared.payload;
	}
	if (
		prepared?.payload &&
		prepared.recoveredAtLayoutSignature === layoutSignature &&
		prepared.fallback?.mathSourceAdmission.sourceFingerprint ===
			mathSourceFingerprint &&
		prepared.fallback?.mathSourceAdmission.rawDimensionGeometrySignature ===
			mathRawDimensionGeometrySignature &&
		prepared.fallback?.sourceMarkup === sourceMarkup &&
		prepared.fallback.dimensionSignature === dimensionSignature
	) {
		return prepared.payload;
	}
	if (
		!prepared?.payload &&
		prepared?.fallback?.mathSourceAdmission.sourceFingerprint ===
			mathSourceFingerprint &&
		prepared?.fallback?.mathSourceAdmission.rawDimensionGeometrySignature ===
			mathRawDimensionGeometrySignature &&
		prepared?.fallback?.sourceMarkup === sourceMarkup &&
		prepared.fallback.dimensionSignature === dimensionSignature
	) {
		return prepared.fallback.payload;
	}
	if (
		pendingFallback?.mathSourceAdmission.sourceFingerprint ===
			mathSourceFingerprint &&
		pendingFallback?.mathSourceAdmission.rawDimensionGeometrySignature ===
			mathRawDimensionGeometrySignature &&
		pendingFallback?.sourceMarkup === sourceMarkup &&
		pendingFallback.dimensionSignature === dimensionSignature
	) {
		return pendingFallback.payload;
	}
	return null;
}
export type BackgroundPreparationWaiter = {
	reject: (error: unknown) => void;
	resolve: () => void;
	signal?: AbortSignal;
	onAbort?: () => void;
};
export type BackgroundPreparationState = {
	active: Promise<void> | null;
	activeController: AbortController | null;
	requested: boolean;
	timer: number | ReturnType<typeof setTimeout> | null;
	waiters: BackgroundPreparationWaiter[];
};
export type BackgroundPreparationCache = WeakMap<
	HTMLElement,
	BackgroundPreparationState
>;

export function createPreparedClipboardPayload(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	fallback: PreparedClipboardFallback | null,
	sequence: number,
	background = false,
	signal?: AbortSignal,
	measurement: WechatPreviewMeasurementLease | null = null,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	transition: WechatPreviewTransitionLease | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	isCurrent?: () => boolean,
	backgroundCancel: (() => void) | null = null,
	suppliedMathSourceAdmission: WechatMathSourceCaptureResult | null = null,
): PreparedClipboardPayload {
	let prepared: PreparedClipboardPayload;
	throwIfBackgroundPreparationAborted(signal);
	if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
	const serializationPreview = measurement?.root ?? preview;
	let mathSourceCaptureResult = suppliedMathSourceAdmission;
	const readiness = Promise.all([
		measurement?.ready ?? Promise.resolve(),
		transition?.ready ?? Promise.resolve(),
		taskGeometryLease?.ready ?? Promise.resolve(),
	]);
	// Root class/style changes (font and article-theme controls) can change the
	// computed output without changing the rendered child markup. Responsive
	// breakpoints can also change computed styles and geometry without changing
	// the DOM, so keep both the full sink markup and a layout fingerprint.
	const sourceMarkup = clipboardSourceMarkup(preview);
	const yieldToBrowser = createSerializationYield(runtime, background, signal);
	let initialDimensionSignature = "";
	const initialDimensionSignatureSink = { value: "" };
	const layoutSignature =
		!background &&
		(!measurement || measurement.isReady()) &&
		(!transition || transition.isReady()) &&
		(!taskGeometryLease || taskGeometryLease.isReady())
			? (() => {
					dimensionSemantics?.refresh();
					const signature = preparedLayoutSignature(
						preview,
						runtime,
						serializationPreview,
						dimensionSemantics,
						initialDimensionSignatureSink,
					);
					initialDimensionSignature = initialDimensionSignatureSink.value;
					return signature;
				})()
			: "";
	let initialDimensionGeometrySignature = "";
	// Keep normal preparation asynchronous. A synchronous full-Preview walk is
	// only justified inside the originating click task when a browser rejects
	// Promise-backed ClipboardItem values; doing it for every background refresh
	// can monopolize the main thread on Mermaid/KaTeX-heavy articles.
	const initialLayoutSignature = readiness.then(
		async () => {
			throwIfBackgroundPreparationAborted(signal);
			if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
			dimensionSemantics?.refresh();
			initialDimensionGeometrySignature =
				hasWechatMathStaticFlowCandidate(serializationPreview) || !background
					? preparedDimensionGeometrySignature(
							serializationPreview,
							runtime,
							dimensionSemantics,
						)
					: "";
			if (!background && layoutSignature) return layoutSignature;
			if (background) {
				const signature = await preparedLayoutSignatureWithYield(
					preview,
					runtime,
					yieldToBrowser as SerializationYield,
					signal,
					serializationPreview,
					dimensionSemantics,
					initialDimensionSignatureSink,
				);
				initialDimensionSignature = initialDimensionSignatureSink.value;
				return signature;
			}
			const signature = preparedLayoutSignature(
				preview,
				runtime,
				serializationPreview,
				dimensionSemantics,
				initialDimensionSignatureSink,
			);
			initialDimensionSignature = initialDimensionSignatureSink.value;
			return signature;
		},
		(error: unknown) => {
			throw error;
		},
	);
	const promise = initialLayoutSignature
		.then(async (initialSignature) => {
			throwIfBackgroundPreparationAborted(signal);
			if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
			if (clipboardSourceMarkup(preview) !== sourceMarkup) {
				throw new Error("wechat-copy-stale");
			}
			if (!mathSourceCaptureResult) {
				mathSourceCaptureResult = await captureWechatMathSourceAdmission(
					serializationPreview,
					runtime,
					yieldToBrowser,
					signal,
					isCurrent,
					true,
					initialDimensionGeometrySignature,
				);
			}
			return serializeClipboardPayload(
				serializationPreview,
				runtime,
				backgroundAssetCache,
				yieldToBrowser,
				undefined,
				signal,
				preview,
				dimensionSemantics,
				taskGeometryLease,
				mathSourceCaptureResult?.sourceAdmission,
				mathSourceCaptureResult?.sourceFingerprint,
				mathSourceCaptureResult?.rawDimensionGeometrySignature,
				mathSourceCaptureResult?.runtime,
				isCurrent,
			).then(async (payload) => {
				throwIfBackgroundPreparationAborted(signal);
				if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
					throw new Error("wechat-copy-stale");
				}
				await measurement?.wait();
				await transition?.wait();
				await taskGeometryLease?.wait();
				runWechatSyncTiming(
					preview.ownerDocument.defaultView?.performance,
					WECHAT_COPY_TIMING_NAMES.finalRawContextRefresh,
					{ mode: "sync" },
					() => dimensionSemantics?.refresh(),
				);
				const finalDimensionSignatureSink = { value: "" };
				const finalGeometryTiming = beginWechatTiming(
					preview.ownerDocument.defaultView?.performance,
					WECHAT_COPY_TIMING_NAMES.finalGeometry,
					{ mode: background ? "async" : "sync" },
				);
				let finalSignature: string;
				try {
					finalSignature = background
						? await preparedLayoutSignatureWithYield(
								preview,
								runtime,
								yieldToBrowser as SerializationYield,
								signal,
								serializationPreview,
								dimensionSemantics,
								finalDimensionSignatureSink,
							)
						: preparedLayoutSignature(
								preview,
								runtime,
								serializationPreview,
								dimensionSemantics,
								finalDimensionSignatureSink,
							);
					finalGeometryTiming.finish("success");
				} catch (error: unknown) {
					finalGeometryTiming.finish("error");
					throw error;
				}
				const finalDimensionSignature = finalDimensionSignatureSink.value;
				const finalDimensionGeometrySignature =
					hasWechatMathStaticFlowCandidate(serializationPreview) || !background
						? preparedDimensionGeometrySignature(
								serializationPreview,
								runtime,
								dimensionSemantics,
							)
						: "";
				let finalMathSourceCaptureResult = mathSourceCaptureResult;
				if (hasWechatMathStaticFlowCandidate(serializationPreview)) {
					finalMathSourceCaptureResult = await captureWechatMathSourceAdmission(
						serializationPreview,
						runtime,
						yieldToBrowser,
						signal,
						isCurrent,
						true,
						finalDimensionGeometrySignature,
					);
					if (
						finalMathSourceCaptureResult.sourceFingerprint !==
							(mathSourceCaptureResult?.sourceFingerprint ?? "") ||
						finalMathSourceCaptureResult.rawDimensionGeometrySignature !==
							(mathSourceCaptureResult?.rawDimensionGeometrySignature ?? "")
					) {
						throw new Error("wechat-copy-stale");
					}
				}
				throwIfBackgroundPreparationAborted(signal);
				runWechatSyncTiming(
					preview.ownerDocument.defaultView?.performance,
					WECHAT_COPY_TIMING_NAMES.finalSourceFreshness,
					{ mode: "sync" },
					() => {
						if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
							throw new Error("wechat-copy-stale");
						}
					},
				);
				if (background && initialSignature !== finalSignature) {
					throw new Error("wechat-copy-stale");
				}
				if (
					!background &&
					initialDimensionGeometrySignature !== finalDimensionGeometrySignature
				) {
					throw new Error("wechat-copy-stale");
				}
				if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
				prepared.mathSourceAdmission = finalMathSourceCaptureResult ?? {
					rawDimensionGeometrySignature: "",
					runtime: null,
					sourceAdmission: null,
					sourceFingerprint: "",
				};
				prepared.dimensionSignature = finalDimensionSignature;
				prepared.layoutSignature = finalSignature;
				prepared.payload = payload;
				const current = preparedPayloads.get(preview);
				throwIfBackgroundPreparationAborted(signal);
				prepared.payload = payload;
				if (
					current &&
					current !== prepared &&
					current.sourceMarkup === prepared.sourceMarkup &&
					(!current.fallback || current.fallback.sequence < prepared.sequence)
				) {
					// A replacement may have started while this serialization was waiting
					// on theme assets. Keep the most recent successful payload available
					// to that replacement if its own preparation later fails.
					current.fallback = {
						dimensionSignature: prepared.dimensionSignature,
						layoutSignature: prepared.layoutSignature,
						payload,
						sequence: prepared.sequence,
						sourceMarkup: prepared.sourceMarkup,
						mathSourceAdmission: prepared.mathSourceAdmission,
					};
				}
				return payload;
			});
		})
		.catch((error: unknown) => {
			const current = preparedPayloads.get(preview);
			if (current === prepared) {
				const recovery = current.fallback;
				if (recovery) {
					preparedPayloads.set(preview, {
						backgroundCancel: prepared.backgroundCancel,
						fallback: recovery,
						dimensionSignature: recovery.dimensionSignature,
						layoutOwner: prepared.layoutOwner,
						layoutSignature: recovery.layoutSignature,
						payload: recovery.payload,
						promise: Promise.resolve(recovery.payload),
						sequence: prepared.sequence,
						sourceMarkup: recovery.sourceMarkup,
						mathSourceAdmission: recovery.mathSourceAdmission,
						recoveredAtLayoutSignature: prepared.layoutSignature,
					});
				} else {
					preparedPayloads.delete(preview);
				}
			}
			throw error;
		});
	prepared = {
		backgroundCancel,
		fallback,
		dimensionSignature: initialDimensionSignature,
		layoutOwner: measurement ? "measurement" : "live",
		payload: null,
		promise,
		sequence,
		sourceMarkup,
		layoutSignature,
		recoveredAtLayoutSignature: null,
		mathSourceAdmission: mathSourceCaptureResult ?? {
			rawDimensionGeometrySignature: "",
			runtime: null,
			sourceAdmission: null,
			sourceFingerprint: "",
		},
	};
	preparedPayloads.set(preview, prepared);
	return prepared;
}

export function preparedClipboardPayload(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	nextSequence: () => number,
	replace = false,
	background = false,
	signal?: AbortSignal,
	suppliedMeasurement?: WechatPreviewMeasurementLease | null,
	suppliedDimensionSemantics?: WechatDimensionSemanticsContext | null,
	suppliedTransition?: WechatPreviewTransitionLease | null,
	suppliedTaskGeometryLease?: TaskCheckboxGeometryLease | null,
	isCurrent?: () => boolean,
	backgroundCancel: (() => void) | null = null,
	suppliedMathSourceAdmission: WechatMathSourceCaptureResult | null = null,
): PreparedClipboardPayload {
	throwIfBackgroundPreparationAborted(signal);
	const measurement =
		undefined === suppliedMeasurement
			? createPreviewMeasurementLease(preview, runtime, signal)
			: suppliedMeasurement;
	const transition =
		suppliedTransition ??
		(measurement ? null : createPreviewTransitionLease([preview], signal));
	let taskGeometryLease: TaskCheckboxGeometryLease | null =
		suppliedTaskGeometryLease ?? null;
	const serializationPreview = measurement?.root ?? preview;
	let mathSourceCaptureResult = suppliedMathSourceAdmission;
	let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
	try {
		if (undefined === suppliedTaskGeometryLease) {
			taskGeometryLease = createTaskCheckboxGeometryLease(
				preview,
				runtime,
				signal,
				measurement,
			);
		}
		dimensionSemantics =
			suppliedDimensionSemantics ??
			createDimensionSemanticsContext(serializationPreview, preview, runtime);
		const existing = preparedPayloads.get(preview);
		const readinessReady =
			(!measurement || measurement.isReady()) &&
			(!transition || transition.isReady());
		const taskGeometryReady = !taskGeometryLease || taskGeometryLease.isReady();
		const currentDimensionSignature =
			readinessReady && taskGeometryReady
				? (() => {
						dimensionSemantics?.refresh();
						return preparedDimensionSemanticsSignature(
							serializationPreview,
							runtime,
							dimensionSemantics,
						);
					})()
				: "";
		if (readinessReady && taskGeometryReady && !mathSourceCaptureResult) {
			mathSourceCaptureResult = captureWechatMathSourceAdmissionSynchronously(
				serializationPreview,
				runtime,
				true,
				signal,
				isCurrent,
				hasWechatMathStaticFlowCandidate(serializationPreview)
					? preparedDimensionGeometrySignature(
							serializationPreview,
							runtime,
							dimensionSemantics,
						)
					: "",
			);
		}
		if (
			!replace &&
			existing &&
			readinessReady &&
			taskGeometryReady &&
			existing.mathSourceAdmission.sourceFingerprint ===
				(mathSourceCaptureResult?.sourceFingerprint ?? "") &&
			existing.mathSourceAdmission.rawDimensionGeometrySignature ===
				(mathSourceCaptureResult?.rawDimensionGeometrySignature ?? "") &&
			reusablePreparedClipboardPayload(
				existing,
				clipboardSourceMarkup(preview),
				currentDimensionSignature,
				preparedLayoutSignature(
					preview,
					runtime,
					serializationPreview,
					dimensionSemantics,
				),
				null,
				mathSourceCaptureResult?.sourceFingerprint ?? "",
				mathSourceCaptureResult?.rawDimensionGeometrySignature ?? "",
			)
		) {
			measurement?.cleanup();
			transition?.cleanup();
			taskGeometryLease?.cleanup();
			dimensionSemantics.cleanup();
			return existing;
		}
		const fallback = existing
			? existing.payload
				? {
						dimensionSignature: existing.dimensionSignature,
						layoutSignature: existing.layoutSignature,
						payload: existing.payload,
						sequence: existing.sequence,
						sourceMarkup: existing.sourceMarkup,
						mathSourceAdmission: existing.mathSourceAdmission,
					}
				: existing.fallback
			: null;
		const prepared = createPreparedClipboardPayload(
			preview,
			runtime,
			backgroundAssetCache,
			preparedPayloads,
			fallback,
			nextSequence(),
			background,
			signal,
			measurement,
			dimensionSemantics,
			transition,
			taskGeometryLease,
			isCurrent,
			backgroundCancel,
			mathSourceCaptureResult,
		);
		if (measurement) {
			void prepared.promise.then(measurement.cleanup, measurement.cleanup);
		}
		if (transition) {
			void prepared.promise.then(transition.cleanup, transition.cleanup);
		}
		if (taskGeometryLease) {
			void prepared.promise.then(
				taskGeometryLease.cleanup,
				taskGeometryLease.cleanup,
			);
		}
		void prepared.promise.then(
			dimensionSemantics.cleanup,
			dimensionSemantics.cleanup,
		);
		return prepared;
	} catch (error: unknown) {
		measurement?.cleanup();
		transition?.cleanup();
		taskGeometryLease?.cleanup();
		dimensionSemantics?.cleanup();
		throw error;
	}
}

export async function preparedClipboardPayloadAfterWrite(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	nextSequence: () => number,
	guard: WechatClipboardCopyGuard = {},
	sourceFreshness: ClipboardSourceFreshnessState,
	onMeasurementLease?: (cleanup: () => void) => void,
	onPreparedPayload?: (
		preview: HTMLElement,
		prepared: PreparedClipboardPayload,
	) => void,
	isCurrent?: () => boolean,
): Promise<PreparedClipboardPayload> {
	// Keep the click task free of computed-style and geometry work. The first
	// await is intentional: modern Clipboard write() must receive its deferred
	// payload before the freshness walk starts.
	await sourceFreshness.ready;
	assertPortableCopyCurrent(preview, guard, sourceFreshness);
	const yieldToBrowser = createSerializationYield(runtime, true);
	if (!yieldToBrowser) throw new Error("wechat-copy-yield-unavailable");
	await waitForBrowserTask(runtime);
	assertPortableCopyCurrent(preview, guard, sourceFreshness);

	let measurement: WechatPreviewMeasurementLease | null = null;
	let transition: WechatPreviewTransitionLease | null = null;
	let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
	try {
		let existing = preparedPayloads.get(preview);
		if (existing && !existing.payload) {
			if (existing.sourceMarkup !== clipboardSourceMarkup(preview)) {
				existing = undefined;
			} else if (
				"live" === existing.layoutOwner &&
				existing.backgroundCancel &&
				isPreviewHidden(preview, runtime)
			) {
				existing.backgroundCancel();
				assertPortableCopyCurrent(preview, guard, sourceFreshness);
				existing = undefined;
			} else {
				try {
					await existing.promise;
				} catch (error: unknown) {
					const recovered = preparedPayloads.get(preview);
					if (recovered?.payload) {
						existing = recovered;
					} else if (isRetryableBackgroundPreparationError(error)) {
						assertPortableCopyCurrent(preview, guard, sourceFreshness);
						existing = undefined;
					} else {
						throw error;
					}
				}
				assertPortableCopyCurrent(preview, guard, sourceFreshness);
				existing = preparedPayloads.get(preview);
			}
		}

		const measurementLease = createPreviewMeasurementLease(
			preview,
			runtime,
			guard.signal,
		);
		measurement = measurementLease;
		if (measurementLease) onMeasurementLease?.(measurementLease.cleanup);
		transition = measurement
			? null
			: createPreviewTransitionLease([preview], guard.signal);
		await measurementLease?.ready;
		await transition?.ready;
		assertPortableCopyCurrent(preview, guard, sourceFreshness);
		const serializationPreview = measurement?.root ?? preview;
		dimensionSemantics = createDimensionSemanticsContext(
			serializationPreview,
			preview,
			runtime,
		);
		const mathSourceCaptureResult = await captureWechatMathSourceAdmission(
			serializationPreview,
			runtime,
			yieldToBrowser,
			guard.signal,
			isCurrent,
			true,
			hasWechatMathStaticFlowCandidate(serializationPreview)
				? preparedDimensionGeometrySignature(
						serializationPreview,
						runtime,
						dimensionSemantics,
					)
				: "",
		);

		if (existing?.payload) {
			assertPortableCopyCurrent(preview, guard, sourceFreshness);
			const sourceMarkup = clipboardSourceMarkup(preview);
			const layoutSignature = await preparedLayoutSignatureWithYield(
				preview,
				runtime,
				yieldToBrowser,
				undefined,
				serializationPreview,
				dimensionSemantics,
			);
			dimensionSemantics.refresh();
			const currentDimensionSignature = preparedDimensionSemanticsSignature(
				serializationPreview,
				runtime,
				dimensionSemantics,
			);
			assertPortableCopyCurrent(preview, guard, sourceFreshness);
			const liveSourceMarkup = clipboardSourceMarkup(preview);
			const current = preparedPayloads.get(preview);
			if (
				current?.payload &&
				current.mathSourceAdmission.sourceFingerprint ===
					mathSourceCaptureResult.sourceFingerprint &&
				current.mathSourceAdmission.rawDimensionGeometrySignature ===
					mathSourceCaptureResult.rawDimensionGeometrySignature &&
				current.sourceMarkup === sourceMarkup &&
				liveSourceMarkup === sourceMarkup &&
				current.dimensionSignature === currentDimensionSignature &&
				current.layoutSignature === layoutSignature
			) {
				measurement?.cleanup();
				measurement = null;
				transition?.cleanup();
				transition = null;
				return current;
			}
		}

		// A replacement is created only after write() has been invoked. Background
		// mode supplies the yielding serializer and preserves the latest stable
		// same-source payload as its failure fallback.
		assertPortableCopyCurrent(preview, guard, sourceFreshness);
		await yieldToBrowser();
		assertPortableCopyCurrent(preview, guard, sourceFreshness);
		const prepared = preparedClipboardPayload(
			preview,
			runtime,
			backgroundAssetCache,
			preparedPayloads,
			nextSequence,
			true,
			true,
			guard.signal,
			measurement,
			dimensionSemantics,
			transition,
			undefined,
			isCurrent,
			null,
			mathSourceCaptureResult,
		);
		dimensionSemantics = null;
		transition = null;
		onPreparedPayload?.(preview, prepared);
		measurement = null;
		return prepared;
	} finally {
		measurement?.cleanup();
		transition?.cleanup();
		dimensionSemantics?.cleanup();
	}
}

export function scheduleBackgroundPreparation(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	backgroundPreparations: BackgroundPreparationCache,
	nextSequence: () => number,
	state: BackgroundPreparationState,
	delay: number,
): void {
	if (state.timer !== null) return;
	const browserWindow = runtime.document.defaultView;
	state.timer = browserWindow
		? browserWindow.setTimeout(run, delay)
		: setTimeout(run, delay);

	function run(): void {
		state.timer = null;
		if (state.active || !state.requested) return;
		state.requested = false;

		const controller = new AbortController();
		state.activeController = controller;
		let operation: Promise<void>;
		try {
			operation = preparedClipboardPayload(
				preview,
				runtime,
				backgroundAssetCache,
				preparedPayloads,
				nextSequence,
				true,
				true,
				controller.signal,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				() => {
					if (state.activeController === controller) controller.abort();
				},
			).promise.then(() => undefined);
		} catch (error: unknown) {
			operation = Promise.reject(error);
		}

		state.active = operation;
		operation.then(
			() => finish(operation, true),
			(error: unknown) => finish(operation, false, error),
		);
	}

	function finish(
		operation: Promise<void>,
		success: boolean,
		error?: unknown,
	): void {
		if (state.active !== operation) return;
		state.active = null;
		state.activeController = null;
		if (backgroundPreparations.get(preview) !== state) return;
		if (state.requested) {
			scheduleBackgroundPreparation(
				preview,
				runtime,
				backgroundAssetCache,
				preparedPayloads,
				backgroundPreparations,
				nextSequence,
				state,
				BACKGROUND_PREPARATION_QUIET_DELAY_MS,
			);
			return;
		}

		const waiters = state.waiters.splice(0);
		waiters.forEach((waiter) => {
			waiter.signal?.removeEventListener(
				"abort",
				waiter.onAbort as EventListener,
			);
			if (success) waiter.resolve();
			else waiter.reject(error);
		});
		if (!state.active && !state.requested && state.waiters.length === 0) {
			if (backgroundPreparations.get(preview) === state) {
				backgroundPreparations.delete(preview);
			}
		}
	}
}

export function cancelBackgroundPreparationIfUnused(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundPreparations: BackgroundPreparationCache,
	state: BackgroundPreparationState,
): void {
	if (state.waiters.length > 0) return;
	state.requested = false;
	if (state.timer !== null) {
		const browserWindow = runtime.document.defaultView;
		if (browserWindow) browserWindow.clearTimeout(state.timer as number);
		else clearTimeout(state.timer);
		state.timer = null;
	}
	state.activeController?.abort();
	if (!state.active && backgroundPreparations.get(preview) === state) {
		backgroundPreparations.delete(preview);
	}
}

export function removeBackgroundPreparationWaiter(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundPreparations: BackgroundPreparationCache,
	state: BackgroundPreparationState,
	waiter: BackgroundPreparationWaiter,
): void {
	const index = state.waiters.indexOf(waiter);
	if (index < 0) return;
	state.waiters.splice(index, 1);
	waiter.signal?.removeEventListener("abort", waiter.onAbort as EventListener);
	waiter.reject(backgroundPreparationAbortError());
	cancelBackgroundPreparationIfUnused(
		preview,
		runtime,
		backgroundPreparations,
		state,
	);
}

export function coalescedBackgroundPreparation(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	backgroundPreparations: BackgroundPreparationCache,
	nextSequence: () => number,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return Promise.reject(backgroundPreparationAbortError());
	let state = backgroundPreparations.get(preview);
	if (!state) {
		state = {
			active: null,
			activeController: null,
			requested: false,
			timer: null,
			waiters: [],
		};
		backgroundPreparations.set(preview, state);
	}
	state.requested = true;
	let waiter!: BackgroundPreparationWaiter;
	const promise = new Promise<void>((resolve, reject) => {
		waiter = signal ? { reject, resolve, signal } : { reject, resolve };
		state?.waiters.push(waiter);
	});
	if (signal) {
		const onAbort = () =>
			removeBackgroundPreparationWaiter(
				preview,
				runtime,
				backgroundPreparations,
				state as BackgroundPreparationState,
				waiter,
			);
		waiter.onAbort = onAbort;
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
	}
	if (state.requested && !state.active && state.timer === null) {
		scheduleBackgroundPreparation(
			preview,
			runtime,
			backgroundAssetCache,
			preparedPayloads,
			backgroundPreparations,
			nextSequence,
			state,
			0,
		);
	}
	return promise;
}

export const BACKGROUND_PREPARATION_QUIET_DELAY_MS = 120;
