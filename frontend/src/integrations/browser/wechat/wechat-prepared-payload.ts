import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	backgroundPreparationAbortError,
	createSerializationYield,
	type SerializationYield,
	throwIfBackgroundPreparationAborted,
	WECHAT_COPY_TIMING_NAMES,
	waitForBrowserTask,
} from "./wechat-clipboard-runtime";
import {
	createDimensionSemanticsContext,
	type WechatDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import {
	preparedDimensionGeometrySignature,
	preparedDimensionGeometrySignatureWithYield,
	preparedDimensionSemanticsSignature,
	preparedLayoutSignature,
	preparedLayoutSignatureWithYield,
} from "./wechat-fidelity-signature";
import { collectFontFaces } from "./wechat-managed-fonts";
import { captureWechatMathVectorScenesWithBorrowedMeasurement } from "./wechat-math-vector-capture";
import {
	createMermaidContentBoxLease,
	type MermaidContentBox,
	type MermaidContentBoxLease,
} from "./wechat-mermaid-content-box";
import {
	eligibleWechatMathVectorOwners,
	type WechatMathVectorAtlasLoader,
	type WechatMathVectorPortableCapture,
} from "./wechat-math-vector-portable";
import type {
	SerializedClipboardPayload,
	WechatMathSourceCaptureResult,
} from "./wechat-portable-serialization";
import type { WechatInlinePseudoPaintReadiness } from "./wechat-inline-pseudo-paint";
import {
	captureWechatMathSourceAdmission,
	captureWechatMathSourceAdmissionSynchronously,
	hasWechatMathStaticFlowCandidate,
	serializeClipboardPayload,
} from "./wechat-portable-serialization";
import { waitForPreviewMeasurement } from "./wechat-preview-geometry-cache";
import {
	createHiddenPreviewGeometryMeasurement,
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	isPreviewHidden,
	type WechatPreviewMeasurementLease,
	type WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import {
	assertPortableCopyCurrent,
	type ClipboardSourceFreshnessState,
	type ClipboardSourceFreshnessGuard,
	clipboardSourceMarkup,
	isRetryableBackgroundPreparationError,
	type WechatClipboardCopyGuard,
} from "./wechat-source-freshness";
import {
	createTaskCheckboxGeometryLease,
	type TaskCheckboxGeometryLease,
} from "./wechat-task-geometry";
import { beginWechatTiming, runWechatSyncTiming } from "./wechat-timing";
export type PreparedMermaidContentBoxEvidence = Readonly<{
	boxes: ReadonlyMap<Element, MermaidContentBox>;
	fontReady: Promise<FontFaceSet> | null;
	fontSet: FontFaceSet | null;
	inputSignature: string;
	sourceRoot: HTMLElement;
	sourceWidthKey: number | null;
}>;
export type PreparedClipboardFallback = Readonly<{
	contentBoxes?: MermaidContentBoxLease | null;
	contentBoxEvidence?: PreparedMermaidContentBoxEvidence | null;
	dimensionSignature: string;
	layoutSignature: string;
	payload: SerializedClipboardPayload;
	sequence: number;
	sourceMarkup: string;
	mathSourceAdmission: WechatMathSourceCaptureResult;
}>;

export type PreparedClipboardPayload = {
	backgroundCancel: (() => void) | null;
	cancel?: () => void;
	contentBoxes?: MermaidContentBoxLease | null;
	contentBoxEvidence?: PreparedMermaidContentBoxEvidence | null;
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
export type PreparedClipboardSerializationReady = Readonly<
	| {
			activeOwner: "measurement";
			dimensionSemantics: WechatDimensionSemanticsContext;
			measurement: WechatPreviewMeasurementLease;
			root: HTMLElement;
			runtime: BrowserWechatClipboardRuntime;
			transition: null;
	  }
	| {
			activeOwner: "transition";
			dimensionSemantics: WechatDimensionSemanticsContext;
			measurement: null;
			root: HTMLElement;
			runtime: BrowserWechatClipboardRuntime;
			transition: WechatPreviewTransitionLease;
	  }
>;

export type PreparedClipboardSerializationOwnerCleanupRegistration = (
	cleanup: () => void,
) => boolean;

function preparedClipboardSerializationReady(
	preview: HTMLElement,
	dimensionSemantics: WechatDimensionSemanticsContext,
	measurement: WechatPreviewMeasurementLease | null,
	transition: WechatPreviewTransitionLease | null,
	runtime: BrowserWechatClipboardRuntime,
): PreparedClipboardSerializationReady {
	if (Boolean(measurement) === Boolean(transition)) {
		throw new Error("wechat-copy-serialization-owner-invalid");
	}
	const root = measurement?.root ?? preview;
	return Object.freeze(
		measurement
			? {
					activeOwner: "measurement" as const,
					dimensionSemantics,
					measurement,
					root,
					runtime,
					transition: null,
				}
			: {
					activeOwner: "transition" as const,
					dimensionSemantics,
					measurement: null,
					root,
					runtime,
					transition: transition as WechatPreviewTransitionLease,
				},
	);
}
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
	validatedContentBoxEvidence: PreparedMermaidContentBoxEvidence | null = null,
): SerializedClipboardPayload | null {
	const boxesCurrent = (
		boxes: MermaidContentBoxLease | null | undefined,
		evidence: PreparedMermaidContentBoxEvidence | null | undefined,
	): boolean => !boxes || boxes.isCurrent() || Boolean(evidence && evidence === validatedContentBoxEvidence);
	if (
		prepared?.payload &&
		boxesCurrent(prepared.contentBoxes, prepared.contentBoxEvidence) &&
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
		boxesCurrent(prepared.fallback?.contentBoxes, prepared.fallback?.contentBoxEvidence) &&
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
		boxesCurrent(prepared?.fallback?.contentBoxes, prepared?.fallback?.contentBoxEvidence) &&
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
		boxesCurrent(pendingFallback?.contentBoxes, pendingFallback?.contentBoxEvidence) &&
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

async function captureMathVectorPortable(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	measurement: WechatPreviewMeasurementLease | null,
	signal: AbortSignal | undefined,
	isCurrent: (() => boolean) | undefined,
	atlasLoader: WechatMathVectorAtlasLoader | undefined,
): Promise<Readonly<{
	capture: WechatMathVectorPortableCapture;
	ownedMeasurementCleanup: (() => void) | null;
}> | null> {
	if (!atlasLoader) return null;
	const sourceOwners = eligibleWechatMathVectorOwners(preview, runtime);
	if (!sourceOwners.length) return null;
	const ownedMeasurement =
		measurement ??
		createHiddenPreviewGeometryMeasurement(preview, runtime, signal);
	const acquiredMeasurement = {
		cleanup: ownedMeasurement.cleanup,
		lease: ownedMeasurement,
	};
	try {
		const fonts = runtime.document.fonts;
		if (fonts?.ready) {
			await waitForPreviewMeasurement(
				Promise.resolve(fonts.ready).then(() => undefined),
				signal,
			);
		}
		if (!runtime.approvedAssetBaseUrl || !runtime.approvedKaTeXCssUrl) {
			throw new Error("wechat-math-vector-font-scope-missing");
		}
		const atlas = await atlasLoader(signal, isCurrent);
		const scenes = await captureWechatMathVectorScenesWithBorrowedMeasurement({
			atlas,
			managedFaces: collectFontFaces(
				runtime.document,
				runtime.approvedAssetBaseUrl,
				runtime.approvedKaTeXCssUrl,
			),
			measurement: acquiredMeasurement,
			preview,
			runtime,
			sourceOwners,
			...(signal ? { signal } : {}),
			...(isCurrent ? { isCurrent } : {}),
		});
		return Object.freeze({
			capture: Object.freeze({
				atlas,
				measurement: acquiredMeasurement,
				scenes,
			}),
			ownedMeasurementCleanup: measurement ? null : ownedMeasurement.cleanup,
		});
	} catch (error: unknown) {
		if (!measurement) ownedMeasurement.cleanup();
		throw error;
	}
}

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
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
	inlineSourceFreshness: Pick<
		ClipboardSourceFreshnessGuard,
		"isCurrent"
	> | null = null,
	onPreparedFidelitySignature?: (signature: string) => void,
	suppliedContentBoxes: MermaidContentBoxLease | null = null,
	deferContentBoxCleanup = false,
): PreparedClipboardPayload {
	let prepared: PreparedClipboardPayload;
	let released = false;
	const assertNotReleased = (): void => {
		if (released) throw new Error("wechat-copy-cancelled");
	};
	throwIfBackgroundPreparationAborted(signal);
	if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
	const serializationPreview = measurement?.root ?? preview;
	let contentBoxes = suppliedContentBoxes;
	const hasIntrinsicOwners = Boolean(
		serializationPreview.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ||
		serializationPreview.querySelector('.easymde-mermaid[data-easymde-mermaid-layout]'),
	);
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
	const inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null =
		measurement
			? {
					existing: { kind: "measurement", lease: measurement },
					sourceFreshness: inlineSourceFreshness ?? {
					isCurrent: () => clipboardSourceMarkup(preview) === sourceMarkup,
				},
				}
			: transition
				? {
						existing: { kind: "transition", lease: transition },
						sourceFreshness: inlineSourceFreshness ?? {
						isCurrent: () => clipboardSourceMarkup(preview) === sourceMarkup,
					},
					}
				: null;
	const yieldToBrowser = createSerializationYield(runtime, background, signal);
	let initialDimensionSignature = "";
	const initialDimensionSignatureSink = { value: "" };
	const layoutSignature =
		!background &&
		!hasIntrinsicOwners &&
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
			assertNotReleased();
			throwIfBackgroundPreparationAborted(signal);
			if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
			if (hasIntrinsicOwners) {
				contentBoxes ??= createMermaidContentBoxLease(serializationPreview, signal);
				prepared.contentBoxes = contentBoxes;
				await contentBoxes.ready;
				assertNotReleased();
				if (!contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
				runtime = { ...runtime, mermaidContentBoxes: contentBoxes };
			}
			dimensionSemantics?.refresh();
			initialDimensionGeometrySignature =
				hasWechatMathStaticFlowCandidate(serializationPreview) || !background
					? background && yieldToBrowser
						? await preparedDimensionGeometrySignatureWithYield(
								serializationPreview,
								runtime,
								yieldToBrowser,
								signal,
								dimensionSemantics,
							)
						: preparedDimensionGeometrySignature(
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
			assertNotReleased();
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
			const mathVectorPortable = await captureMathVectorPortable(
				preview,
				runtime,
				measurement,
				signal,
				isCurrent,
				mathVectorAtlasLoader,
			);
			const mathVectorCapture = mathVectorPortable?.capture ?? null;
			const ownedMeasurementCleanup =
				mathVectorPortable?.ownedMeasurementCleanup ?? null;
			let ownedMeasurementCleaned = false;
			const cleanupOwnedMeasurement = (): void => {
				if (ownedMeasurementCleaned) return;
				ownedMeasurementCleaned = true;
				ownedMeasurementCleanup?.();
			};
			return Promise.resolve()
				.then(() =>
					serializeClipboardPayload(
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
						mathVectorCapture,
						inlinePseudoReadiness,
					),
				)
				.then(async (payload) => {
					assertNotReleased();
					throwIfBackgroundPreparationAborted(signal);
					if (contentBoxes && !contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
					if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
						throw new Error("wechat-copy-stale");
					}
					await measurement?.wait();
					await transition?.wait();
					await taskGeometryLease?.wait();
					let hiddenContentBoxEvidence: PreparedMermaidContentBoxEvidence | null = null;
					if (measurement && contentBoxes) {
						const fonts = runtime.document.fonts ?? null;
						const fontReady = fonts?.ready ?? null;
						if (fonts && 'loaded' !== fonts.status) throw new Error("wechat-copy-stale");
						const boxes = new Map<Element, MermaidContentBox>();
						const owners = [
							...(serializationPreview.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ? [serializationPreview] : []),
							...serializationPreview.querySelectorAll('.easymde-mermaid[data-easymde-mermaid-layout]'),
						];
						for (const owner of owners) {
							const source = measurement.sourceFor(owner);
							const box = contentBoxes.get(owner);
							if (!source || !preview.contains(source) || !box || boxes.has(source)) throw new Error("wechat-copy-stale");
							boxes.set(source, box);
						}
						const inputSignature = background && yieldToBrowser
							? await preparedLayoutSignatureWithYield(preview, runtime, yieldToBrowser, signal, serializationPreview, dimensionSemantics, undefined, false, true)
							: preparedLayoutSignature(preview, runtime, serializationPreview, dimensionSemantics, undefined, false, true);
						if (!contentBoxes.isCurrent() || (fonts && ('loaded' !== fonts.status || fonts.ready !== fontReady))) {
							throw new Error("wechat-copy-stale");
						}
						hiddenContentBoxEvidence = {
							boxes, fontReady, fontSet: fonts, inputSignature,
							sourceRoot: preview, sourceWidthKey: measurement.sourceWidthKey,
						};
					}
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
						hasWechatMathStaticFlowCandidate(serializationPreview) ||
						!background
							? background && yieldToBrowser
								? await preparedDimensionGeometrySignatureWithYield(
										serializationPreview,
										runtime,
										yieldToBrowser,
										signal,
										dimensionSemantics,
									)
								: preparedDimensionGeometrySignature(
										serializationPreview,
										runtime,
										dimensionSemantics,
									)
							: "";
					let finalMathSourceCaptureResult = mathSourceCaptureResult;
					if (hasWechatMathStaticFlowCandidate(serializationPreview)) {
						finalMathSourceCaptureResult =
							await captureWechatMathSourceAdmission(
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
						initialDimensionGeometrySignature !==
							finalDimensionGeometrySignature
					) {
						throw new Error("wechat-copy-stale");
					}
					if (isCurrent && !isCurrent())
						throw new Error("wechat-copy-cancelled");
					assertNotReleased();
					if (contentBoxes && !contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
					prepared.mathSourceAdmission = finalMathSourceCaptureResult ?? {
						rawDimensionGeometrySignature: "",
						runtime: null,
						sourceAdmission: null,
						sourceFingerprint: "",
					};
					throwIfBackgroundPreparationAborted(signal);
					prepared.dimensionSignature = finalDimensionSignature;
					prepared.layoutSignature = finalSignature;
					prepared.contentBoxEvidence = hiddenContentBoxEvidence;
					onPreparedFidelitySignature?.(finalSignature);
					prepared.payload = payload;
					if (measurement && !deferContentBoxCleanup) contentBoxes?.cleanup();
					else if (!measurement) contentBoxes?.retain();
					cleanupOwnedMeasurement();
					const current = preparedPayloads.get(preview);
					if (current === prepared && prepared.fallback?.contentBoxes !== contentBoxes) {
						prepared.fallback?.contentBoxes?.cleanup();
					}
					if (
						current &&
						current !== prepared &&
						current.sourceMarkup === prepared.sourceMarkup &&
						(!current.fallback || current.fallback.sequence < prepared.sequence)
					) {
						// A replacement may have started while this serialization was waiting
						// on theme assets. Keep the most recent successful payload available
						// to that replacement if its own preparation later fails.
						if (current.fallback?.contentBoxes !== contentBoxes) {
							current.fallback?.contentBoxes?.cleanup();
						}
						current.fallback = {
							contentBoxes,
							contentBoxEvidence: prepared.contentBoxEvidence ?? null,
							dimensionSignature: prepared.dimensionSignature,
							layoutSignature: prepared.layoutSignature,
							payload,
							sequence: prepared.sequence,
							sourceMarkup: prepared.sourceMarkup,
							mathSourceAdmission: prepared.mathSourceAdmission,
						};
					}
					delete prepared.cancel;
					return payload;
				})
				.catch((error: unknown) => {
					cleanupOwnedMeasurement();
					throw error;
				});
		})
		.catch((error: unknown) => {
			if (contentBoxes !== fallback?.contentBoxes) contentBoxes?.cleanup();
			const current = preparedPayloads.get(preview);
			if (current === prepared) {
				const recovery = current.fallback;
				if (recovery) {
					preparedPayloads.set(preview, {
						backgroundCancel: prepared.backgroundCancel,
						contentBoxes: recovery.contentBoxes ?? null,
						contentBoxEvidence: recovery.contentBoxEvidence ?? null,
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
		cancel: () => {
			released = true;
			contentBoxes?.cleanup();
		},
		contentBoxes,
		contentBoxEvidence: null,
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
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
	deferActiveOwnerCleanup = false,
	inlineSourceFreshness: Pick<
		ClipboardSourceFreshnessGuard,
		"isCurrent"
	> | null = null,
	onPreparedFidelitySignature?: (signature: string) => void,
	suppliedContentBoxes: MermaidContentBoxLease | null = null,
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
		const intrinsicOwners = [
			...(serializationPreview.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ? [serializationPreview] : []),
			...serializationPreview.querySelectorAll('.easymde-mermaid[data-easymde-mermaid-layout]'),
		];
		const existingBoxes = existing?.contentBoxes;
		const boxesReady = !intrinsicOwners.length || Boolean(
			existingBoxes?.isCurrent() && intrinsicOwners.every((owner) => existingBoxes.get(owner)),
		);
		const fingerprintRuntime = existingBoxes && boxesReady
			? { ...runtime, mermaidContentBoxes: existingBoxes }
			: runtime;
		const readinessReady =
			(!measurement || measurement.isReady()) &&
			(!transition || transition.isReady());
		const taskGeometryReady = !taskGeometryLease || taskGeometryLease.isReady();
		const currentDimensionSignature =
			!background && !replace && readinessReady && taskGeometryReady && boxesReady
				? (() => {
						dimensionSemantics?.refresh();
						return preparedDimensionSemanticsSignature(
							serializationPreview,
							fingerprintRuntime,
							dimensionSemantics,
						);
					})()
				: "";
		if (
			!background &&
			!replace &&
			readinessReady &&
			taskGeometryReady &&
			boxesReady &&
			!mathSourceCaptureResult
		) {
			mathSourceCaptureResult = captureWechatMathSourceAdmissionSynchronously(
				serializationPreview,
				fingerprintRuntime,
				true,
				signal,
				isCurrent,
				hasWechatMathStaticFlowCandidate(serializationPreview)
					? preparedDimensionGeometrySignature(
							serializationPreview,
							fingerprintRuntime,
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
			boxesReady &&
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
					fingerprintRuntime,
					serializationPreview,
					dimensionSemantics,
				),
				null,
				mathSourceCaptureResult?.sourceFingerprint ?? "",
				mathSourceCaptureResult?.rawDimensionGeometrySignature ?? "",
			)
		) {
			if (!deferActiveOwnerCleanup) {
				if (measurement) measurement.cleanup();
				else transition?.cleanup();
			}
			taskGeometryLease?.cleanup();
			dimensionSemantics.cleanup();
			return existing;
		}
		const fallback = existing
			? existing.payload
				? {
						contentBoxes: existing.contentBoxes ?? null,
						contentBoxEvidence: existing.contentBoxEvidence ?? null,
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
			mathVectorAtlasLoader,
			inlineSourceFreshness,
			onPreparedFidelitySignature,
			suppliedContentBoxes,
			deferActiveOwnerCleanup,
		);
		if (!deferActiveOwnerCleanup && (measurement || transition)) {
			let cleanupCalled = false;
			const cleanup = (): void => {
				if (cleanupCalled) return;
				cleanupCalled = true;
				if (measurement) measurement.cleanup();
				else transition?.cleanup();
			};
			void prepared.promise.then(cleanup, cleanup);
		}
		if (taskGeometryLease) {
			void prepared.promise.then(
				taskGeometryLease.cleanup,
				taskGeometryLease.cleanup,
			);
		}
		if (!deferActiveOwnerCleanup) {
			void prepared.promise.then(
				dimensionSemantics.cleanup,
				dimensionSemantics.cleanup,
			);
		}
		return prepared;
	} catch (error: unknown) {
		if (!deferActiveOwnerCleanup) {
			if (measurement) measurement.cleanup();
			else transition?.cleanup();
		}
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
	onSerializationOwnerCleanup?: PreparedClipboardSerializationOwnerCleanupRegistration,
	onPreparedPayload?: (
		preview: HTMLElement,
		prepared: PreparedClipboardPayload,
	) => void,
	isCurrent?: () => boolean,
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
	onSerializationReady?: (ready: PreparedClipboardSerializationReady) => void,
	onPreparedFidelitySignature?: (signature: string) => void,
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
	let activeOwnerCleanupAccepted = false;
	let transition: WechatPreviewTransitionLease | null = null;
	let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
	let contentBoxes: MermaidContentBoxLease | null = null;
	let contentBoxesTransferred = false;
	let serializationOwnerCleaned = false;
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
		transition = measurement
			? null
			: createPreviewTransitionLease([preview], guard.signal);
		const measurementCleanup = measurement?.cleanup;
		const transitionCleanup = transition?.cleanup;
		const cleanupSerializationOwner = (): void => {
			if (serializationOwnerCleaned) return;
			serializationOwnerCleaned = true;
			measurementCleanup?.();
			transitionCleanup?.();
			dimensionSemantics?.cleanup();
			if (measurementCleanup || !contentBoxesTransferred) contentBoxes?.cleanup();
		};
		const activeOwnerCleanup = measurementCleanup ?? transitionCleanup;
		if (activeOwnerCleanup && onSerializationOwnerCleanup) {
			const accepted = onSerializationOwnerCleanup(cleanupSerializationOwner);
			if (true !== accepted) throw new Error("wechat-copy-cancelled");
			activeOwnerCleanupAccepted = true;
		}
		await measurementLease?.ready;
		await transition?.ready;
		assertPortableCopyCurrent(preview, guard, sourceFreshness);
		const serializationPreview = measurement?.root ?? preview;
		if (
			serializationPreview.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ||
			serializationPreview.querySelector('.easymde-mermaid[data-easymde-mermaid-layout]')
		) {
			contentBoxes = createMermaidContentBoxLease(serializationPreview, guard.signal);
			await contentBoxes.ready;
			assertPortableCopyCurrent(preview, guard, sourceFreshness);
			if (serializationOwnerCleaned || !contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
			runtime = { ...runtime, mermaidContentBoxes: contentBoxes };
		}
		dimensionSemantics = createDimensionSemanticsContext(
			serializationPreview,
			preview,
			runtime,
		);
		if (serializationOwnerCleaned) dimensionSemantics.cleanup();
		if (onSerializationReady) {
			onSerializationReady(
				preparedClipboardSerializationReady(
					preview,
					dimensionSemantics,
					measurement,
					transition,
					runtime,
				),
			);
		}
		const mathSourceCaptureResult = await captureWechatMathSourceAdmission(
			serializationPreview,
			runtime,
			yieldToBrowser,
			guard.signal,
			isCurrent,
			true,
			hasWechatMathStaticFlowCandidate(serializationPreview)
				? await preparedDimensionGeometrySignatureWithYield(
						serializationPreview,
						runtime,
						yieldToBrowser,
						guard.signal,
						dimensionSemantics,
					)
				: "",
		);

		if (existing?.payload && (!existing.contentBoxes || existing.contentBoxes.isCurrent())) {
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
				onPreparedFidelitySignature?.(current.layoutSignature);
				if (!activeOwnerCleanupAccepted) {
					if (measurement) measurement.cleanup();
					else transition?.cleanup();
				}
				measurement = null;
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
			mathVectorAtlasLoader,
			activeOwnerCleanupAccepted,
			sourceFreshness.current(),
			onPreparedFidelitySignature,
			contentBoxes,
		);
		contentBoxesTransferred = true;
		if (!activeOwnerCleanupAccepted) dimensionSemantics = null;
		transition = null;
		onPreparedPayload?.(preview, prepared);
		measurement = null;
		return prepared;
	} finally {
		if (!activeOwnerCleanupAccepted) {
			if (measurement) measurement.cleanup();
			else transition?.cleanup();
			dimensionSemantics?.cleanup();
			if (!contentBoxesTransferred) contentBoxes?.cleanup();
		}
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
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
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
				undefined,
				mathVectorAtlasLoader,
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
				mathVectorAtlasLoader,
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
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
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
			mathVectorAtlasLoader,
		);
	}
	return promise;
}

export const BACKGROUND_PREPARATION_QUIET_DELAY_MS = 120;
