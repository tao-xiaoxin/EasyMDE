import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	createSerializationYield,
	waitForBrowserTask,
} from "./wechat-clipboard-runtime";
import {
	createDimensionSemanticsContext,
	type WechatDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import {
	preparedDimensionGeometrySignatureWithYield,
	preparedDimensionSemanticsSignature,
	preparedLayoutSignatureWithYield,
} from "./wechat-fidelity-signature";
import type { WechatMathVectorAtlasLoader } from "./wechat-math-vector-portable";
import {
	createMermaidContentBoxLease,
	type MermaidContentBoxLease,
} from "./wechat-mermaid-content-box";
import {
	captureWechatMathSourceAdmission,
	hasWechatMathStaticFlowCandidate,
} from "./wechat-portable-serialization";
import { preparedClipboardPayload } from "./wechat-prepared-payload-builder";
import {
	type PreparedClipboardPayload,
	type PreparedClipboardPayloadCache,
	type PreparedClipboardSerializationOwnerCleanupRegistration,
	type PreparedClipboardSerializationReady,
	preparedClipboardSerializationReady,
} from "./wechat-prepared-payload-state";
import {
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	isPreviewHidden,
	type WechatPreviewMeasurementLease,
	type WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import {
	assertPortableCopyCurrent,
	type ClipboardSourceFreshnessState,
	clipboardSourceMarkup,
	isRetryableBackgroundPreparationError,
	type WechatClipboardCopyGuard,
} from "./wechat-source-freshness";

export {
	BACKGROUND_PREPARATION_QUIET_DELAY_MS,
	cancelBackgroundPreparationIfUnused,
	coalescedBackgroundPreparation,
	removeBackgroundPreparationWaiter,
	scheduleBackgroundPreparation,
} from "./wechat-prepared-payload-background";
export {
	createPreparedClipboardPayload,
	preparedClipboardPayload,
} from "./wechat-prepared-payload-builder";
export {
	type BackgroundPreparationCache,
	type BackgroundPreparationState,
	type BackgroundPreparationWaiter,
	type PreparedClipboardFallback,
	type PreparedClipboardPayload,
	type PreparedClipboardPayloadCache,
	type PreparedClipboardSerializationOwnerCleanupRegistration,
	type PreparedClipboardSerializationReady,
	type PreparedMermaidContentBoxEvidence,
	reusablePreparedClipboardPayload,
} from "./wechat-prepared-payload-state";

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
			if (measurementCleanup || !contentBoxesTransferred)
				contentBoxes?.cleanup();
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
			serializationPreview.matches(
				".easymde-mermaid[data-easymde-mermaid-layout]",
			) ||
			serializationPreview.querySelector(
				".easymde-mermaid[data-easymde-mermaid-layout]",
			)
		) {
			contentBoxes = createMermaidContentBoxLease(
				serializationPreview,
				guard.signal,
			);
			await contentBoxes.ready;
			assertPortableCopyCurrent(preview, guard, sourceFreshness);
			if (serializationOwnerCleaned || !contentBoxes.isCurrent()) {
				throw new Error("wechat-copy-stale");
			}
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

		if (
			existing?.payload &&
			(!existing.contentBoxes || existing.contentBoxes.isCurrent())
		) {
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
