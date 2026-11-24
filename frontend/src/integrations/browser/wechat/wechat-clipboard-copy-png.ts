import type { ImageUploadPort } from "../../../contracts/ports/image-upload-port";
import type { WechatClipboardCopyOptions } from "../../../contracts/ports/wechat-clipboard-port";
import type { WechatVisualRasterizationPort } from "../../../contracts/ports/wechat-visual-rasterization-port";
import {
	mermaidCaptureSnapshotIsCurrent,
	mermaidResponsiveSnapshotIsCurrent,
} from "./wechat-capture-plan";
import type {
	ModernCopyTransaction,
	ReadyPreviewResolution,
	WechatClipboardCopySharedState,
} from "./wechat-clipboard-copy-transaction";
import {
	type BrowserWechatClipboardRuntime,
	createSerializationYield,
	WECHAT_COPY_TIMING_NAMES,
	waitForBrowserTask,
} from "./wechat-clipboard-runtime";
import {
	createWechatCopyTotalTiming,
	createWechatReadinessTiming,
	type WechatReadinessTiming,
} from "./wechat-copy-timing";
import { createDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	preparedDimensionGeometrySignatureWithYield,
	preparedLayoutSignature,
} from "./wechat-fidelity-signature";
import type { WechatInlinePseudoPaintReadiness } from "./wechat-inline-pseudo-paint";
import {
	createMermaidContentBoxLease,
	type MermaidContentBoxLease,
} from "./wechat-mermaid-content-box";
import { mermaidSourceUsesAutoBlockMargins } from "./wechat-mermaid-geometry";
import {
	assertPngConversionCurrent,
	logPngFailureDiagnostic,
	pngScale,
	WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
	type WechatPngConversionContext,
	WechatPngConversionError,
	type WechatPngConversionState,
} from "./wechat-png-conversion-policy";
import {
	type SerializedClipboardPayload,
	serializeClipboardPayload,
} from "./wechat-portable-serialization";
import {
	cachedPreviewGeometryMeasurement,
	previewMeasurementLeaseSourceMatches,
	waitForPreviewMeasurement,
} from "./wechat-preview-geometry-cache";
import {
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	rememberPreviewWidthValue,
	type WechatPreviewMeasurementLease,
} from "./wechat-preview-measurement";
import {
	assertCopyPreviewCurrent,
	type ClipboardSourceFreshnessGuard,
	createClipboardSourceFreshnessGuard,
	type WechatClipboardCopyGuard,
} from "./wechat-source-freshness";
import { createWechatTableNativeGridGuard } from "./wechat-table-native-grid-integration";
import { createTaskCheckboxGeometryLease } from "./wechat-task-geometry";
import { beginWechatTiming, runWechatSyncTiming } from "./wechat-timing";

export function createPngCopyTransaction(
	params: Readonly<{
		copyGuard: WechatClipboardCopyGuard;
		copyWasCancelled: () => boolean;
		deadlineMs?: number | undefined;
		disposeColdSourceFreshness?: (() => void) | undefined;
		foregroundGeometryMeasurement: ReturnType<
			typeof cachedPreviewGeometryMeasurement
		>;
		isColdSourceFresh?: (() => boolean) | undefined;
		options: WechatClipboardCopyOptions;
		preview: HTMLElement;
		readyPreview: ReadyPreviewResolution;
		shared: WechatClipboardCopySharedState;
	}>,
): ModernCopyTransaction {
	const {
		copyGuard,
		copyWasCancelled,
		deadlineMs,
		disposeColdSourceFreshness,
		isColdSourceFresh,
		options,
		preview,
		readyPreview,
		shared,
	} = params;
	const { backgroundAssetCache, geometryMeasurements } = shared;
	let activeForegroundGeometryMeasurement =
		params.foregroundGeometryMeasurement;
	let payloadPreview = preview;
	let runtime: BrowserWechatClipboardRuntime = shared.runtime;
	let contentBoxes: MermaidContentBoxLease | null = null;
	const conversionState: WechatPngConversionState = {
		uploadsMayRemain: false,
	};
	const conversionController = new AbortController();
	const propagateConversionAbort = () => conversionController.abort();
	if (options.signal) {
		if (options.signal.aborted) {
			conversionController.abort();
		} else {
			options.signal.addEventListener("abort", propagateConversionAbort, {
				once: true,
			});
		}
	}
	const detachConversionAbort = () => {
		options.signal?.removeEventListener("abort", propagateConversionAbort);
	};
	const conversionSignal = conversionController.signal;
	const conversionRasterizationPort = options.visualRasterizationPort as
		| WechatVisualRasterizationPort
		| undefined;
	const conversionImageUploadPort = options.imageUploadPort as
		| ImageUploadPort
		| undefined;
	let disposeConversionFreshness: (() => void) | undefined;
	let conversionSourceFreshness: ClipboardSourceFreshnessGuard | null = null;
	let conversionFidelitySignature: string | null = null;
	let disposeGeometryMeasurement: (() => void) | undefined;
	let disposeTableNativeGridMeasurement: (() => void) | undefined;
	let tableNativeGridMeasurement: WechatPreviewMeasurementLease | null = null;
	let tableNativeGridGuard: ReturnType<
		typeof createWechatTableNativeGridGuard
	> | null = null;
	let tableNativeGridTransactionOpen = true;
	const closeTableNativeGridTransaction = (): void => {
		if (!tableNativeGridTransactionOpen) return;
		tableNativeGridTransactionOpen = false;
		const cleanup = disposeTableNativeGridMeasurement;
		disposeTableNativeGridMeasurement = undefined;
		tableNativeGridMeasurement = null;
		cleanup?.();
	};
	let disposeTaskGeometryLease: (() => void) | undefined;
	let disposeTransitionReadiness: (() => void) | undefined;
	let readinessTiming: WechatReadinessTiming | null = null;
	const finishCopyTotal = createWechatCopyTotalTiming(
		preview.ownerDocument.defaultView?.performance,
		true,
	);
	let startTransaction!: () => void;

	const assertBlobCurrent = (): void => {
		assertCopyPreviewCurrent(payloadPreview, copyGuard);
		if (contentBoxes && !contentBoxes.isCurrent()) {
			throw new Error("wechat-copy-stale");
		}
		if (!conversionSourceFreshness?.finalize()) {
			throw new Error("wechat-copy-stale");
		}
		if (null === conversionFidelitySignature) {
			throw new Error("wechat-copy-stale");
		}
		if (
			preparedLayoutSignature(
				payloadPreview,
				runtime,
				tableNativeGridMeasurement?.root ?? payloadPreview,
				null,
				undefined,
				true,
			) !== conversionFidelitySignature
		) {
			throw new Error("wechat-copy-stale");
		}
		tableNativeGridGuard?.assertCurrent();
	};

	const finalizeTransaction = (): void => {
		assertCopyPreviewCurrent(payloadPreview, copyGuard);
		if (contentBoxes && !contentBoxes.isCurrent()) {
			throw new Error("wechat-copy-stale");
		}
		if (!conversionSourceFreshness?.finalize()) {
			throw new Error("wechat-copy-stale");
		}
		if (null === conversionFidelitySignature) {
			throw new Error("wechat-copy-stale");
		}
		if (
			preparedLayoutSignature(
				payloadPreview,
				runtime,
				tableNativeGridMeasurement?.root ?? payloadPreview,
				null,
				undefined,
				true,
			) !== conversionFidelitySignature
		) {
			throw new Error("wechat-copy-stale");
		}
		tableNativeGridGuard?.assertCurrent();
		if (
			tableNativeGridMeasurement &&
			(!tableNativeGridMeasurement.isReady() ||
				!previewMeasurementLeaseSourceMatches(
					tableNativeGridMeasurement,
					payloadPreview,
					runtime,
				))
		) {
			throw new Error("wechat-copy-stale");
		}
	};

	const synchronousModernFailure: ModernCopyTransaction["onSynchronousModernFailure"] =
		() => ({
			code: "wechat-png-clipboard-failed",
			sideEffects: "none",
			status: "failed",
		});

	const transactionFailure: ModernCopyTransaction["onFailure"] = (
		error: unknown,
	) => {
		finishCopyTotal("error");
		conversionController.abort();
		readyPreview.abort();
		contentBoxes?.cleanup();
		contentBoxes = null;
		if (error instanceof WechatPngConversionError) {
			logPngFailureDiagnostic(error);
		}
		return {
			code:
				error instanceof WechatPngConversionError
					? error.code
					: copyWasCancelled()
						? "wechat-png-rasterization-cancelled"
						: error instanceof Error &&
								"wechat-png-transaction-timeout" === error.message
							? "wechat-png-transaction-timeout"
							: "wechat-png-clipboard-failed",
			sideEffects: conversionState.uploadsMayRemain
				? "uploads-may-remain"
				: "none",
			status: "failed",
		};
	};

	const cleanupTransaction = (): void => {
		if (!tableNativeGridTransactionOpen) return;
		// Abort before releasing the hidden root so any late continuation
		// observes cancellation before it can read released geometry.
		conversionController.abort();
		readyPreview.abort();
		finishCopyTotal("error");
		readinessTiming?.fail();
		disposeColdSourceFreshness?.();
		activeForegroundGeometryMeasurement?.cleanup();
		activeForegroundGeometryMeasurement = null;
		disposeConversionFreshness?.();
		disposeConversionFreshness = undefined;
		disposeGeometryMeasurement?.();
		disposeGeometryMeasurement = undefined;
		closeTableNativeGridTransaction();
		disposeTaskGeometryLease?.();
		disposeTaskGeometryLease = undefined;
		disposeTransitionReadiness?.();
		disposeTransitionReadiness = undefined;
		detachConversionAbort();
	};

	const payload = new Promise<SerializedClipboardPayload>((resolve, reject) => {
		startTransaction = () => {
			readyPreview.start();
			void readyPreview.promise
				.then((resolvedPreview) => {
					if (
						conversionSignal.aborted ||
						(options.isCurrent && !options.isCurrent())
					) {
						disposeColdSourceFreshness?.();
						throw new WechatPngConversionError(
							"wechat-png-rasterization-cancelled",
						);
					}
					payloadPreview = resolvedPreview;
					rememberPreviewWidthValue(resolvedPreview);
					const sourceFreshness =
						createClipboardSourceFreshnessGuard(resolvedPreview);
					conversionSourceFreshness = sourceFreshness;
					disposeConversionFreshness = sourceFreshness.dispose;
					if (isColdSourceFresh && !isColdSourceFresh()) {
						disposeColdSourceFreshness?.();
						throw new WechatPngConversionError(
							"wechat-png-rasterization-cancelled",
						);
					}
					disposeColdSourceFreshness?.();
					const transferredGeometryMeasurement =
						activeForegroundGeometryMeasurement &&
						activeForegroundGeometryMeasurement.lease.sourceRoot ===
							resolvedPreview
							? activeForegroundGeometryMeasurement
							: null;
					if (
						transferredGeometryMeasurement &&
						!previewMeasurementLeaseSourceMatches(
							transferredGeometryMeasurement.lease,
							resolvedPreview,
							runtime,
						)
					) {
						transferredGeometryMeasurement.cleanup();
						activeForegroundGeometryMeasurement = null;
						throw new WechatPngConversionError(
							"wechat-png-rasterization-cancelled",
						);
					}
					if (
						activeForegroundGeometryMeasurement &&
						!transferredGeometryMeasurement
					) {
						activeForegroundGeometryMeasurement.cleanup();
						activeForegroundGeometryMeasurement = null;
					}
					const cachedGeometryMeasurement =
						transferredGeometryMeasurement ??
						cachedPreviewGeometryMeasurement(
							resolvedPreview,
							runtime,
							geometryMeasurements,
						);
					activeForegroundGeometryMeasurement = null;
					const geometryMeasurement =
						cachedGeometryMeasurement?.lease ??
						createPreviewMeasurementLease(
							resolvedPreview,
							runtime,
							conversionSignal,
						);
					disposeGeometryMeasurement = () => {
						if (cachedGeometryMeasurement) cachedGeometryMeasurement.cleanup();
						else geometryMeasurement?.cleanup();
					};
					const taskGeometryLease = createTaskCheckboxGeometryLease(
						resolvedPreview,
						runtime,
						conversionSignal,
						geometryMeasurement,
					);
					disposeTaskGeometryLease = () => taskGeometryLease?.cleanup();
					const measurementOwnedGeometry = null !== geometryMeasurement;
					const transitionReadiness = geometryMeasurement
						? null
						: createPreviewTransitionLease([resolvedPreview], conversionSignal);
					disposeTransitionReadiness = () => transitionReadiness?.cleanup();
					const serializationPreview =
						geometryMeasurement?.root ?? resolvedPreview;
					const geometryReadiness = cachedGeometryMeasurement
						? waitForPreviewMeasurement(
								geometryMeasurement?.ready ?? Promise.resolve(),
								conversionSignal,
							)
						: (geometryMeasurement?.ready ?? Promise.resolve());
					readinessTiming = createWechatReadinessTiming({
						geometryOwner: measurementOwnedGeometry ? "measurement" : "source",
						geometryPairs: geometryMeasurement
							? geometryMeasurement.root.querySelectorAll("img").length
							: null,
						geometryReadiness,
						hidden: measurementOwnedGeometry,
						performance:
							resolvedPreview.ownerDocument.defaultView?.performance,
						taskGeometryOwner: taskGeometryLease ? "task-geometry" : "source",
						taskGeometryReadiness:
							taskGeometryLease?.ready ?? Promise.resolve(),
						transitionReadiness:
							transitionReadiness?.ready ?? Promise.resolve(),
					});
					return readinessTiming.ready
						.then(async () => {
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
									conversionSignal,
								);
								try {
									await contentBoxes.ready;
								} catch {
									throw new WechatPngConversionError(
										conversionSignal.aborted
											? "wechat-png-rasterization-cancelled"
											: "wechat-png-rasterization-failed",
									);
								}
								if (!contentBoxes.isCurrent()) {
									throw new WechatPngConversionError(
										"wechat-png-rasterization-cancelled",
									);
								}
								runtime = { ...runtime, mermaidContentBoxes: contentBoxes };
							}
							const nativeGridMeasurement =
								cachedGeometryMeasurement?.lease ?? geometryMeasurement;
							if (
								nativeGridMeasurement &&
								!previewMeasurementLeaseSourceMatches(
									nativeGridMeasurement,
									resolvedPreview,
									runtime,
								)
							) {
								throw new WechatPngConversionError(
									"wechat-png-rasterization-cancelled",
								);
							}
							tableNativeGridMeasurement = nativeGridMeasurement;
							tableNativeGridGuard = createWechatTableNativeGridGuard(
								serializationPreview,
								runtime,
								true,
							);
							conversionFidelitySignature = preparedLayoutSignature(
								resolvedPreview,
								runtime,
								serializationPreview,
								null,
								undefined,
								true,
							);
							disposeGeometryMeasurement = undefined;
							disposeTableNativeGridMeasurement = () => {
								nativeGridMeasurement?.cleanup();
								tableNativeGridMeasurement = null;
								conversionSourceFreshness = null;
								sourceFreshness.dispose();
								disposeConversionFreshness = undefined;
							};
							const conversionContext: WechatPngConversionContext = {
								captureBoundary: serializationPreview,
								isCurrent: () =>
									(!options.isCurrent || options.isCurrent()) &&
									sourceFreshness.isCurrent() &&
									(!contentBoxes || contentBoxes.isCurrent()),
								imageUploadPort: conversionImageUploadPort as ImageUploadPort,
								maxBytes: options.maxBytes as number,
								mermaidSnapshots: new Map(),
								postId: options.postId as number,
								rasterizationPort:
									conversionRasterizationPort as WechatVisualRasterizationPort,
								scale: pngScale(resolvedPreview),
								signal: conversionSignal,
								state: conversionState,
							};
							return waitForBrowserTask(runtime)
								.then(async () => {
									assertPngConversionCurrent(conversionContext);
									const yieldToBrowser = createSerializationYield(
										runtime,
										true,
										conversionSignal,
									);
									if (!yieldToBrowser) {
										throw new Error("wechat-copy-yield-unavailable");
									}
									const dimensionSemantics = createDimensionSemanticsContext(
										serializationPreview,
										resolvedPreview,
										runtime,
										true,
									);
									try {
										dimensionSemantics.refresh();
										const initialSignature =
											await preparedDimensionGeometrySignatureWithYield(
												serializationPreview,
												runtime,
												yieldToBrowser,
												conversionSignal,
												dimensionSemantics,
												true,
											);
										assertPngConversionCurrent(conversionContext);
										const inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null =
											geometryMeasurement
												? {
														existing: {
															kind: "measurement",
															lease: geometryMeasurement,
														},
														sourceFreshness,
													}
												: transitionReadiness
													? {
															existing: {
																kind: "transition",
																lease: transitionReadiness,
															},
															sourceFreshness,
														}
													: null;
										const serialized = await serializeClipboardPayload(
											serializationPreview,
											runtime,
											backgroundAssetCache,
											yieldToBrowser,
											conversionContext,
											undefined,
											resolvedPreview,
											dimensionSemantics,
											taskGeometryLease,
											undefined,
											"",
											"",
											undefined,
											undefined,
											undefined,
											inlinePseudoReadiness,
										);
										assertPngConversionCurrent(conversionContext);
										await geometryMeasurement?.wait();
										await transitionReadiness?.wait();
										await taskGeometryLease?.wait();
										runWechatSyncTiming(
											serializationPreview.ownerDocument.defaultView
												?.performance,
											WECHAT_COPY_TIMING_NAMES.finalRawContextRefresh,
											{ mode: "sync" },
											() => dimensionSemantics.refresh(),
										);
										const finalGeometryTiming = beginWechatTiming(
											serializationPreview.ownerDocument.defaultView
												?.performance,
											WECHAT_COPY_TIMING_NAMES.finalGeometry,
											{ mode: "async" },
										);
										let finalSignature: string;
										try {
											finalSignature =
												await preparedDimensionGeometrySignatureWithYield(
													serializationPreview,
													runtime,
													yieldToBrowser,
													conversionSignal,
													dimensionSemantics,
													true,
												);
											finalGeometryTiming.finish("success");
										} catch (error: unknown) {
											finalGeometryTiming.finish("error");
											throw error;
										}
										const finalSourceTiming = beginWechatTiming(
											serializationPreview.ownerDocument.defaultView
												?.performance,
											WECHAT_COPY_TIMING_NAMES.finalSourceFreshness,
											{ mode: "sync" },
										);
										try {
											if (initialSignature !== finalSignature) {
												finalSourceTiming.finish("error");
												throw new WechatPngConversionError(
													"wechat-png-rasterization-cancelled",
												);
											}
											const sourceFreshnessCurrent = sourceFreshness.finalize();
											if (!sourceFreshnessCurrent) {
												finalSourceTiming.finish("error");
												throw new WechatPngConversionError(
													"wechat-png-rasterization-cancelled",
												);
											}
											for (const [
												source,
												snapshot,
											] of conversionContext.mermaidSnapshots) {
												if (
													!mermaidCaptureSnapshotIsCurrent(
														source,
														runtime,
														conversionContext.captureBoundary,
														snapshot,
													)
												) {
													finalSourceTiming.finish("error");
													throw new WechatPngConversionError(
														"wechat-png-rasterization-cancelled",
													);
												}
											}
											for (const [
												source,
												snapshot,
											] of conversionContext.mermaidSnapshots) {
												if (
													mermaidSourceUsesAutoBlockMargins(source, runtime) !==
													snapshot.autoMargins
												) {
													finalSourceTiming.finish("error");
													throw new WechatPngConversionError(
														"wechat-png-rasterization-cancelled",
													);
												}
											}
											for (const [
												source,
												snapshot,
											] of conversionContext.mermaidSnapshots) {
												if (
													"mermaid-responsive" === snapshot.mode &&
													!mermaidResponsiveSnapshotIsCurrent(
														source,
														runtime,
														conversionContext.captureBoundary,
														snapshot.responsive,
													)
												) {
													finalSourceTiming.finish("error");
													throw new WechatPngConversionError(
														"wechat-png-rasterization-cancelled",
													);
												}
											}
											finalSourceTiming.finish("success");
										} catch (error: unknown) {
											finalSourceTiming.finish("error");
											throw error;
										}
										return serialized;
									} finally {
										dimensionSemantics.cleanup();
									}
								})
								.finally(() => {
									conversionContext.mermaidSnapshots.clear();
								});
						})
						.finally(() => {
							disposeTaskGeometryLease?.();
							disposeTaskGeometryLease = undefined;
						});
				})
				.then(resolve, reject);
		};
	});
	void payload.catch(() => undefined);

	return {
		assertBlobCurrent,
		cleanup: cleanupTransaction,
		commitTimeoutCode: "wechat-png-transaction-timeout",
		deadlineMs,
		defaultTimeoutMs: WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
		finalize: finalizeTransaction,
		finishTotal: finishCopyTotal,
		onFailure: transactionFailure,
		onSynchronousModernFailure: synchronousModernFailure,
		payload,
		preparationTimeoutCode: "wechat-png-transaction-timeout",
		start: startTransaction,
	};
}
