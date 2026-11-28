import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	createSerializationYield,
	type SerializationYield,
	throwIfBackgroundPreparationAborted,
	WECHAT_COPY_TIMING_NAMES,
} from "./wechat-clipboard-runtime";
import {
	createDimensionSemanticsContext,
	type WechatDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import {
	collectPreparedSignatures,
	collectPreparedSignaturesWithYield,
	type PreparedSignatureBundle,
} from "./wechat-fidelity-signature";
import type { WechatInlinePseudoPaintReadiness } from "./wechat-inline-pseudo-paint";
import { collectFontFaces } from "./wechat-managed-fonts";
import { captureWechatMathVectorScenesWithBorrowedMeasurement } from "./wechat-math-vector-capture";
import {
	eligibleWechatMathVectorOwners,
	type WechatMathVectorAtlasLoader,
	type WechatMathVectorPortableCapture,
} from "./wechat-math-vector-portable";
import {
	createMermaidContentBoxLease,
	type MermaidContentBox,
	type MermaidContentBoxLease,
} from "./wechat-mermaid-content-box";
import {
	captureWechatMathSourceAdmission,
	captureWechatMathSourceAdmissionSynchronously,
	hasWechatMathStaticFlowCandidate,
	serializeClipboardPayload,
	type WechatMathSourceCaptureResult,
} from "./wechat-portable-serialization";
import {
	type PreparedClipboardFallback,
	type PreparedClipboardPayload,
	type PreparedClipboardPayloadCache,
	type PreparedMermaidContentBoxEvidence,
	reusablePreparedClipboardPayload,
} from "./wechat-prepared-payload-state";
import { waitForPreviewMeasurement } from "./wechat-preview-geometry-cache";
import {
	createHiddenPreviewGeometryMeasurement,
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	type WechatPreviewMeasurementLease,
	type WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import {
	type ClipboardSourceFreshnessGuard,
	clipboardSourceMarkup,
} from "./wechat-source-freshness";
import {
	createTaskCheckboxGeometryLease,
	type TaskCheckboxGeometryLease,
} from "./wechat-task-geometry";
import { beginWechatTiming, runWechatSyncTiming } from "./wechat-timing";

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
	onContentBoxesAdopted?: (boxes: MermaidContentBoxLease | null) => void,
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
		serializationPreview.matches(
			".easymde-mermaid[data-easymde-mermaid-layout]",
		) ||
			serializationPreview.querySelector(
				".easymde-mermaid[data-easymde-mermaid-layout]",
			),
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
	let initialDimensionGeometrySignature = "";
	const hasMathStaticFlowCandidate =
		hasWechatMathStaticFlowCandidate(serializationPreview);
	const needsInitialDimensionGeometry =
		(!mathSourceCaptureResult && hasMathStaticFlowCandidate) || !background;
	const layoutSignature =
		!background &&
		!hasIntrinsicOwners &&
		(!measurement || measurement.isReady()) &&
		(!transition || transition.isReady()) &&
		(!taskGeometryLease || taskGeometryLease.isReady())
			? (() => {
					dimensionSemantics?.refresh();
					const signatures = collectPreparedSignatures({
						preview: serializationPreview,
						runtime,
						dimensionSemantics,
						includeDimensionGeometry: needsInitialDimensionGeometry,
					});
					initialDimensionSignature = signatures.dimension;
					initialDimensionGeometrySignature = signatures.dimensionGeometry;
					return signatures.layout;
				})()
			: "";
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
				contentBoxes ??= createMermaidContentBoxLease(
					serializationPreview,
					signal,
				);
				prepared.contentBoxes = contentBoxes;
				onContentBoxesAdopted?.(contentBoxes);
				await contentBoxes.ready;
				assertNotReleased();
				if (!contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
				runtime = { ...runtime, mermaidContentBoxes: contentBoxes };
			}
			if (!background && layoutSignature) return layoutSignature;
			dimensionSemantics?.refresh();
			const signatures = background
				? await collectPreparedSignaturesWithYield({
						preview: serializationPreview,
						runtime,
						yieldToBrowser: yieldToBrowser as SerializationYield,
						signal,
						dimensionSemantics,
						includeDimensionGeometry: needsInitialDimensionGeometry,
					})
				: collectPreparedSignatures({
						preview: serializationPreview,
						runtime,
						dimensionSemantics,
						includeDimensionGeometry: needsInitialDimensionGeometry,
					});
			initialDimensionSignature = signatures.dimension;
			initialDimensionGeometrySignature = signatures.dimensionGeometry;
			return signatures.layout;
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
			const fallbackReusable =
				background &&
				null !== fallback &&
				Boolean(fallback.hasMathVectorAtlas) ===
					Boolean(mathVectorAtlasLoader) &&
				fallback.sourceMarkup === sourceMarkup &&
				fallback.layoutSignature === initialSignature &&
				fallback.dimensionSignature === initialDimensionSignature &&
				fallback.mathSourceAdmission.sourceFingerprint ===
					(mathSourceCaptureResult?.sourceFingerprint ?? "") &&
				fallback.mathSourceAdmission.rawDimensionGeometrySignature ===
					(mathSourceCaptureResult?.rawDimensionGeometrySignature ?? "") &&
				(!hasIntrinsicOwners ||
					(!measurement && Boolean(contentBoxes?.isCurrent()))) &&
				(!fallback.contentBoxes || fallback.contentBoxes.isCurrent());
			if (fallbackReusable) {
				await measurement?.wait();
				await transition?.wait();
				await taskGeometryLease?.wait();
				assertNotReleased();
				throwIfBackgroundPreparationAborted(signal);
				if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
				if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
					throw new Error("wechat-copy-stale");
				}
				if (contentBoxes && !contentBoxes.isCurrent()) {
					throw new Error("wechat-copy-stale");
				}
				prepared.mathSourceAdmission =
					mathSourceCaptureResult ?? fallback.mathSourceAdmission;
				prepared.dimensionSignature = initialDimensionSignature;
				prepared.layoutSignature = initialSignature;
				prepared.contentBoxEvidence = measurement
					? (fallback.contentBoxEvidence ?? null)
					: null;
				onPreparedFidelitySignature?.(initialSignature);
				prepared.payload = fallback.payload;
				if (measurement && !deferContentBoxCleanup) contentBoxes?.cleanup();
				else if (!measurement) contentBoxes?.retain();
				const current = preparedPayloads.get(preview);
				if (
					current === prepared &&
					prepared.fallback?.contentBoxes !== contentBoxes
				) {
					prepared.fallback?.contentBoxes?.cleanup();
				}
				delete prepared.cancel;
				return fallback.payload;
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
					if (contentBoxes && !contentBoxes.isCurrent()) {
						throw new Error("wechat-copy-stale");
					}
					if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
						throw new Error("wechat-copy-stale");
					}
					await measurement?.wait();
					await transition?.wait();
					await taskGeometryLease?.wait();
					let hiddenContentBoxEvidence: PreparedMermaidContentBoxEvidence | null =
						null;
					let pendingHiddenContentBox: Readonly<{
						boxes: Map<Element, MermaidContentBox>;
						fontReady: Promise<FontFaceSet> | null;
						fonts: FontFaceSet | null;
						sourceWidthKey: number | null;
					}> | null = null;
					if (measurement && contentBoxes) {
						const fonts = runtime.document.fonts ?? null;
						const fontReady = fonts?.ready ?? null;
						if (fonts && "loaded" !== fonts.status) {
							throw new Error("wechat-copy-stale");
						}
						const boxes = new Map<Element, MermaidContentBox>();
						const owners = [
							...(serializationPreview.matches(
								".easymde-mermaid[data-easymde-mermaid-layout]",
							)
								? [serializationPreview]
								: []),
							...serializationPreview.querySelectorAll(
								".easymde-mermaid[data-easymde-mermaid-layout]",
							),
						];
						for (const owner of owners) {
							const source = measurement.sourceFor(owner);
							const box = contentBoxes.get(owner);
							if (
								!source ||
								!preview.contains(source) ||
								!box ||
								boxes.has(source)
							) {
								throw new Error("wechat-copy-stale");
							}
							boxes.set(source, box);
						}
						pendingHiddenContentBox = {
							boxes,
							fontReady,
							fonts,
							sourceWidthKey: measurement.sourceWidthKey,
						};
					}
					runWechatSyncTiming(
						preview.ownerDocument.defaultView?.performance,
						WECHAT_COPY_TIMING_NAMES.finalRawContextRefresh,
						{ mode: "sync" },
						() => dimensionSemantics?.refresh(),
					);
					const needsFinalDimensionGeometry =
						hasWechatMathStaticFlowCandidate(serializationPreview) ||
						!background;
					const finalGeometryTiming = beginWechatTiming(
						preview.ownerDocument.defaultView?.performance,
						WECHAT_COPY_TIMING_NAMES.finalGeometry,
						{ mode: background ? "async" : "sync" },
					);
					let finalSignatures: PreparedSignatureBundle;
					try {
						finalSignatures = background
							? await collectPreparedSignaturesWithYield({
									preview: serializationPreview,
									runtime,
									yieldToBrowser: yieldToBrowser as SerializationYield,
									signal,
									dimensionSemantics,
									includeContentBoxInputLayout: null !== pendingHiddenContentBox,
									includeDimensionGeometry: needsFinalDimensionGeometry,
								})
							: collectPreparedSignatures({
									preview: serializationPreview,
									runtime,
									dimensionSemantics,
									includeContentBoxInputLayout: null !== pendingHiddenContentBox,
									includeDimensionGeometry: needsFinalDimensionGeometry,
								});
						finalGeometryTiming.finish("success");
					} catch (error: unknown) {
						finalGeometryTiming.finish("error");
						throw error;
					}
					if (pendingHiddenContentBox && contentBoxes) {
						const { boxes, fontReady, fonts, sourceWidthKey } =
							pendingHiddenContentBox;
						if (
							!contentBoxes.isCurrent() ||
							(fonts && ("loaded" !== fonts.status || fonts.ready !== fontReady))
						) {
							throw new Error("wechat-copy-stale");
						}
						hiddenContentBoxEvidence = {
							boxes,
							fontReady,
							fontSet: fonts,
							inputSignature: finalSignatures.contentBoxInputLayout,
							sourceRoot: preview,
							sourceWidthKey,
						};
					}
					const finalSignature = finalSignatures.layout;
					const finalDimensionSignature = finalSignatures.dimension;
					const finalDimensionGeometrySignature =
						finalSignatures.dimensionGeometry;
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
					if (contentBoxes && !contentBoxes.isCurrent()) {
						throw new Error("wechat-copy-stale");
					}
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
					if (
						current === prepared &&
						prepared.fallback?.contentBoxes !== contentBoxes
					) {
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
							hasMathVectorAtlas: Boolean(prepared.hasMathVectorAtlas),
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
						hasMathVectorAtlas: Boolean(recovery.hasMathVectorAtlas),
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
		hasMathVectorAtlas: Boolean(mathVectorAtlasLoader),
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
	if (contentBoxes) onContentBoxesAdopted?.(contentBoxes);
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
	onContentBoxesAdopted?: (boxes: MermaidContentBoxLease | null) => void,
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
			...(serializationPreview.matches(
				".easymde-mermaid[data-easymde-mermaid-layout]",
			)
				? [serializationPreview]
				: []),
			...serializationPreview.querySelectorAll(
				".easymde-mermaid[data-easymde-mermaid-layout]",
			),
		];
		const existingBoxes = existing?.contentBoxes;
		const boxesReady =
			!intrinsicOwners.length ||
			Boolean(
				existingBoxes?.isCurrent() &&
					intrinsicOwners.every((owner) => existingBoxes.get(owner)),
			);
		const fingerprintRuntime =
			existingBoxes && boxesReady
				? { ...runtime, mermaidContentBoxes: existingBoxes }
				: runtime;
		const readinessReady =
			(!measurement || measurement.isReady()) &&
			(!transition || transition.isReady());
		const taskGeometryReady = !taskGeometryLease || taskGeometryLease.isReady();
		const canCheckSyncReuse =
			!background &&
			!replace &&
			Boolean(existing) &&
			readinessReady &&
			taskGeometryReady &&
			boxesReady;
		let currentLayoutSignature = "";
		let currentDimensionSignature = "";
		if (canCheckSyncReuse) {
			const hasMathCandidate =
				hasWechatMathStaticFlowCandidate(serializationPreview);
			dimensionSemantics?.refresh();
			const currentSignatures = collectPreparedSignatures({
				preview: serializationPreview,
				runtime: fingerprintRuntime,
				dimensionSemantics,
				includeDimensionGeometry: !mathSourceCaptureResult && hasMathCandidate,
			});
			currentLayoutSignature = currentSignatures.layout;
			currentDimensionSignature = currentSignatures.dimension;
			if (!mathSourceCaptureResult) {
				mathSourceCaptureResult = captureWechatMathSourceAdmissionSynchronously(
					serializationPreview,
					fingerprintRuntime,
					true,
					signal,
					isCurrent,
					hasMathCandidate ? currentSignatures.dimensionGeometry : "",
				);
			}
		}
		if (
			canCheckSyncReuse &&
			existing &&
			existing.mathSourceAdmission.sourceFingerprint ===
				(mathSourceCaptureResult?.sourceFingerprint ?? "") &&
			existing.mathSourceAdmission.rawDimensionGeometrySignature ===
				(mathSourceCaptureResult?.rawDimensionGeometrySignature ?? "") &&
			reusablePreparedClipboardPayload(
				existing,
				clipboardSourceMarkup(preview),
				currentDimensionSignature,
				currentLayoutSignature,
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
						hasMathVectorAtlas: Boolean(existing.hasMathVectorAtlas),
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
			onContentBoxesAdopted,
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
