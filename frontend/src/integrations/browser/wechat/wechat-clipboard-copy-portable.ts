import { fallbackAfterSynchronousModernFailure } from "./wechat-clipboard-copy-legacy";
import {
	CLIPBOARD_COMMIT_TIMEOUT_MS,
	type ModernCopyTransaction,
	remainingTransactionTimeoutMs,
	type WechatClipboardCopySharedState,
} from "./wechat-clipboard-copy-transaction";
import { withTimeout } from "./wechat-clipboard-runtime";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { preparedLayoutSignature } from "./wechat-fidelity-signature";
import { WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS } from "./wechat-png-conversion-policy";
import {
	type PreparedClipboardPayload,
	preparedClipboardPayloadAfterWrite,
} from "./wechat-prepared-payload";
import { previewMeasurementLeaseSourceMatches } from "./wechat-preview-geometry-cache";
import {
	rememberPreviewWidthValue,
	type WechatPreviewMeasurementLease,
} from "./wechat-preview-measurement";
import {
	assertCopyPreviewCurrent,
	assertPortableCopyCurrent,
	type ClipboardSourceFreshnessGuard,
	type ClipboardSourceFreshnessState,
	createClipboardSourceFreshnessGuard,
	type WechatClipboardCopyGuard,
} from "./wechat-source-freshness";
import { createWechatTableNativeGridGuard } from "./wechat-table-native-grid-integration";

export function createPortableCopyTransaction(
	params: Readonly<{
		copyGuard: WechatClipboardCopyGuard;
		copyWasCancelled: () => boolean;
		deadlineMs?: number | undefined;
		disposeColdSourceFreshness?: (() => void) | undefined;
		isColdSourceFresh?: (() => boolean) | undefined;
		preview: HTMLElement;
		readyPreview: Promise<HTMLElement>;
		requiresPreviewResolution: boolean;
		shared: WechatClipboardCopySharedState;
	}>,
): ModernCopyTransaction {
	const {
		copyGuard,
		copyWasCancelled,
		deadlineMs,
		disposeColdSourceFreshness,
		isColdSourceFresh,
		preview,
		readyPreview,
		requiresPreviewResolution,
		shared,
	} = params;
	const {
		backgroundAssetCache,
		mathVectorAtlasLoader,
		nextPreparationSequence,
		preparedPayloads,
		runtime,
	} = shared;

	let payloadPreview = preview;
	let portableRuntime = runtime;
	let portablePrepared: PreparedClipboardPayload | null = null;
	let portablePreparation: {
		preview: HTMLElement;
		prepared: PreparedClipboardPayload;
	} | null = null;
	let disposePortableActiveOwner: (() => void) | undefined;
	let portableMeasurement: WechatPreviewMeasurementLease | null = null;
	let portableDimensionSemantics: WechatDimensionSemanticsContext | null = null;
	let portableFidelitySignature: string | null = null;
	let portableTableNativeGridGuard: ReturnType<
		typeof createWechatTableNativeGridGuard
	> | null = null;
	let portableTransactionOpen = true;

	const disposePortablePreparation = (): void => {
		const owned = portablePreparation;
		portablePreparation = null;
		if (!owned) return;
		const current = preparedPayloads.get(owned.preview);
		if (current !== owned.prepared || owned.prepared.payload) return;
		const recovery = owned.prepared.fallback;
		owned.prepared.cancel?.();
		if (owned.prepared.contentBoxes !== recovery?.contentBoxes) {
			owned.prepared.contentBoxes?.cleanup();
		}
		if (recovery) {
			preparedPayloads.set(owned.preview, {
				backgroundCancel: owned.prepared.backgroundCancel,
				contentBoxes: recovery.contentBoxes ?? null,
				contentBoxEvidence: recovery.contentBoxEvidence ?? null,
				fallback: recovery,
				dimensionSignature: recovery.dimensionSignature,
				layoutOwner: owned.prepared.layoutOwner,
				layoutSignature: recovery.layoutSignature,
				payload: recovery.payload,
				promise: Promise.resolve(recovery.payload),
				sequence: owned.prepared.sequence,
				sourceMarkup: recovery.sourceMarkup,
				mathSourceAdmission: recovery.mathSourceAdmission,
				recoveredAtLayoutSignature: owned.prepared.layoutSignature,
			});
		} else {
			preparedPayloads.delete(owned.preview);
		}
	};

	const portableSourceFreshness: {
		current: ClipboardSourceFreshnessGuard | null;
	} = { current: null };
	let portableFreshnessClosed = false;
	let resolvePortableFreshness!: () => void;
	let rejectPortableFreshness!: (error: unknown) => void;
	const portableFreshnessReady = new Promise<void>((resolve, reject) => {
		resolvePortableFreshness = resolve;
		rejectPortableFreshness = reject;
	});
	void portableFreshnessReady.catch(() => undefined);
	const portableFreshness: ClipboardSourceFreshnessState = {
		current: () =>
			portableFreshnessClosed ? null : portableSourceFreshness.current,
		ready: portableFreshnessReady,
	};
	const disposePortableFreshness = (): void => {
		if (portableFreshnessClosed) return;
		portableFreshnessClosed = true;
		portableSourceFreshness.current?.dispose();
		rejectPortableFreshness(new Error("wechat-copy-cancelled"));
	};
	const initializePortableFreshness = (resolvedPreview: HTMLElement): void => {
		if (portableFreshnessClosed) {
			disposeColdSourceFreshness?.();
			rejectPortableFreshness(new Error("wechat-copy-cancelled"));
			return;
		}
		try {
			payloadPreview = resolvedPreview;
			rememberPreviewWidthValue(resolvedPreview);
			const sourceFreshness =
				createClipboardSourceFreshnessGuard(resolvedPreview);
			if (isColdSourceFresh && !isColdSourceFresh()) {
				disposeColdSourceFreshness?.();
				sourceFreshness.dispose();
				rejectPortableFreshness(new Error("wechat-copy-stale"));
				return;
			}
			disposeColdSourceFreshness?.();
			portableSourceFreshness.current = sourceFreshness;
			resolvePortableFreshness();
		} catch (error: unknown) {
			disposeColdSourceFreshness?.();
			rejectPortableFreshness(error);
		}
	};
	const portablePreparationIsCurrent = (): boolean =>
		!copyWasCancelled() && null !== portableFreshness.current();

	const preparedBeforeWrite = !requiresPreviewResolution
		? preparedPayloads.get(preview)
		: null;
	const pendingFallback =
		preparedBeforeWrite && !preparedBeforeWrite.payload
			? preparedBeforeWrite.fallback
			: null;

	const startAfterWrite = (targetPreview: HTMLElement) =>
		preparedClipboardPayloadAfterWrite(
			targetPreview,
			runtime,
			backgroundAssetCache,
			preparedPayloads,
			nextPreparationSequence,
			copyGuard,
			portableFreshness,
			(cleanup) => {
				if (!portableTransactionOpen) return false;
				disposePortableActiveOwner = cleanup;
				return true;
			},
			(preparedPreview, prepared) => {
				if (!portableTransactionOpen) {
					throw new Error("wechat-copy-cancelled");
				}
				portablePreparation = {
					preview: preparedPreview,
					prepared,
				};
			},
			portablePreparationIsCurrent,
			mathVectorAtlasLoader,
			(ready) => {
				if (!portableTransactionOpen) {
					throw new Error("wechat-copy-cancelled");
				}
				portableMeasurement = ready.measurement;
				portableDimensionSemantics = ready.dimensionSemantics;
				portableRuntime = ready.runtime;
				portableTableNativeGridGuard = createWechatTableNativeGridGuard(
					ready.root,
					runtime,
				);
			},
			(signature) => {
				portableFidelitySignature = signature;
			},
		).then((prepared) => {
			portablePrepared = prepared;
			return prepared.promise;
		});

	const payload = requiresPreviewResolution
		? readyPreview.then((resolvedPreview) => {
				payloadPreview = resolvedPreview;
				return startAfterWrite(resolvedPreview);
			})
		: startAfterWrite(preview);
	void payload.catch(() => undefined);

	const startTransaction = (): void => {
		if (requiresPreviewResolution) {
			void readyPreview.then(initializePortableFreshness, (error: unknown) =>
				rejectPortableFreshness(error),
			);
		} else {
			initializePortableFreshness(preview);
		}
	};

	const assertBlobCurrent = (): void => {
		assertPortableCopyCurrent(payloadPreview, copyGuard, portableFreshness);
		if (
			portablePrepared?.contentBoxes &&
			!portablePrepared.contentBoxes.isCurrent()
		) {
			throw new Error("wechat-copy-stale");
		}
		if (
			null === portableFidelitySignature ||
			null === portableDimensionSemantics
		) {
			throw new Error("wechat-copy-stale");
		}
		portableDimensionSemantics.refresh();
		if (
			preparedLayoutSignature(
				payloadPreview,
				portableRuntime,
				portableMeasurement?.root ?? payloadPreview,
				portableDimensionSemantics,
			) !== portableFidelitySignature
		) {
			throw new Error("wechat-copy-stale");
		}
		portableTableNativeGridGuard?.assertCurrent();
	};

	const awaitCompletion: ModernCopyTransaction["awaitCompletion"] = async (
		writeResult,
		writeFailure,
		htmlBlob,
		textBlob,
		cancellationFailure,
	) => {
		const remainingTimeoutMs = remainingTransactionTimeoutMs(
			deadlineMs,
			WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
		);
		if (remainingTimeoutMs <= 0) {
			throw new Error("wechat-clipboard-preparation-timeout");
		}
		const payloadReady = withTimeout(
			Promise.all([payload, htmlBlob, textBlob]),
			remainingTimeoutMs,
			"wechat-clipboard-preparation-timeout",
		);
		await Promise.race([
			payloadReady.then(async () => {
				const { error } = await withTimeout(
					writeResult,
					CLIPBOARD_COMMIT_TIMEOUT_MS,
				);
				if (null !== error) throw error;
			}),
			writeFailure,
			cancellationFailure,
		]);
	};

	const finalizeTransaction = (): void => {
		const sourceGuard = portableFreshness.current();
		assertCopyPreviewCurrent(payloadPreview, copyGuard);
		if (
			portablePrepared?.contentBoxes &&
			!portablePrepared.contentBoxes.isCurrent()
		) {
			throw new Error("wechat-copy-stale");
		}
		portableTableNativeGridGuard?.assertCurrent();
		if (
			portableMeasurement &&
			(!portableMeasurement.isReady() ||
				!previewMeasurementLeaseSourceMatches(
					portableMeasurement,
					payloadPreview,
					runtime,
				))
		) {
			throw new Error("wechat-copy-stale");
		}
		if (
			null === portableFidelitySignature ||
			null === portableDimensionSemantics
		) {
			throw new Error("wechat-copy-stale");
		}
		portableDimensionSemantics.refresh();
		if (
			preparedLayoutSignature(
				payloadPreview,
				portableRuntime,
				portableMeasurement?.root ?? payloadPreview,
				portableDimensionSemantics,
			) !== portableFidelitySignature
		) {
			throw new Error("wechat-copy-stale");
		}
		if (!sourceGuard?.finalize()) throw new Error("wechat-copy-stale");
		assertCopyPreviewCurrent(payloadPreview, copyGuard);
	};

	const cleanupTransaction = (): void => {
		if (!portableTransactionOpen) return;
		// Reject any later owner registration first, then close Source
		// freshness, and only then release the accepted active owner.
		portableTransactionOpen = false;
		disposeColdSourceFreshness?.();
		disposePortableFreshness();
		disposePortablePreparation();
		const cleanupActiveOwner = disposePortableActiveOwner;
		disposePortableActiveOwner = undefined;
		portableMeasurement = null;
		portableDimensionSemantics = null;
		cleanupActiveOwner?.();
	};

	return {
		assertBlobCurrent,
		awaitCompletion,
		cleanup: cleanupTransaction,
		finalize: finalizeTransaction,
		finishTotal: () => undefined,
		onFailure: () => ({
			code: "wechat-copy-failed",
			status: "failed",
		}),
		onSynchronousModernFailure: () =>
			fallbackAfterSynchronousModernFailure(
				preview,
				requiresPreviewResolution,
				pendingFallback,
				shared,
			),
		payload,
		start: startTransaction,
	};
}
