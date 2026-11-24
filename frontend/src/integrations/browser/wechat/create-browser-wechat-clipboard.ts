import type { ImageUploadPort } from "../../../contracts/ports/image-upload-port";

import type {
	WechatClipboardCopyOptions,
	WechatClipboardPort,
	WechatClipboardPreparationOptions,
	WechatClipboardResult,
} from "../../../contracts/ports/wechat-clipboard-port";

import type { WechatVisualRasterizationPort } from "../../../contracts/ports/wechat-visual-rasterization-port";

import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	mermaidCaptureSnapshotIsCurrent,
	mermaidResponsiveSnapshotIsCurrent,
} from "./wechat-capture-plan";
import {
	type BrowserWechatClipboardRuntime,
	createSerializationYield,
	WECHAT_COPY_TIMING_NAMES,
	waitForBrowserTask,
	withTimeout,
} from "./wechat-clipboard-runtime";
import {
	createMermaidContentBoxLease,
	type MermaidContentBox,
	type MermaidContentBoxLease,
} from "./wechat-mermaid-content-box";
import {
	createWechatCopyTotalTiming,
	createWechatReadinessTiming,
	type WechatReadinessTiming,
} from "./wechat-copy-timing";
import {
	createDimensionSemanticsContext,
	type WechatDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import {
	preparedDimensionGeometrySignature,
	preparedDimensionGeometrySignatureWithYield,
	preparedDimensionSemanticsSignature,
	preparedLayoutSignature,
} from "./wechat-fidelity-signature";
import {
	createWechatMathVectorAtlasCache,
	createWechatMathVectorAtlasLoaderIfConfigured,
	eligibleWechatMathVectorOwners,
	type WechatMathVectorAtlasLoader,
} from "./wechat-math-vector-portable";
import {
	mermaidAdmissionScrollGeometry,
	mermaidSourceUsesAutoBlockMargins,
} from "./wechat-mermaid-geometry";
import {
	assertPngConversionCurrent,
	logPngFailureDiagnostic,
	pngScale,
	WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
	WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
	type WechatPngConversionContext,
	WechatPngConversionError,
	type WechatPngConversionState,
} from "./wechat-png-conversion-policy";
import {
	captureWechatMathSourceAdmissionSynchronously,
	hasWechatMathStaticFlowCandidate,
	type SerializedClipboardPayload,
	serializeClipboardPayload,
	serializeClipboardPayloadSynchronously,
} from "./wechat-portable-serialization";
import type { WechatInlinePseudoPaintReadiness } from "./wechat-inline-pseudo-paint";
import {
	type BackgroundPreparationCache,
	coalescedBackgroundPreparation,
	type PreparedClipboardPayload,
	type PreparedClipboardPayloadCache,
	type PreparedMermaidContentBoxEvidence,
	preparedClipboardPayload,
	preparedClipboardPayloadAfterWrite,
	reusablePreparedClipboardPayload,
} from "./wechat-prepared-payload";
import {
	cachedPreviewGeometryMeasurement,
	type PreviewGeometryMeasurementCache,
	preparePreviewGeometryOnly,
	previewMeasurementLeaseSourceMatches,
	waitForPreviewMeasurement,
} from "./wechat-preview-geometry-cache";
import {
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	rememberPreviewWidthValue,
	type WechatPreviewMeasurementLease,
	type WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import {
	assertCopyPreviewCurrent,
	assertPortableCopyCurrent,
	type ClipboardSourceFreshnessGuard,
	type ClipboardSourceFreshnessState,
	clipboardSourceMarkup,
	createClipboardSourceFreshnessGuard,
	previewReady,
	type WechatClipboardCopyGuard,
} from "./wechat-source-freshness";
import { createWechatTableNativeGridGuard } from "./wechat-table-native-grid-integration";
import {
	createTaskCheckboxGeometryLease,
	type TaskCheckboxGeometryLease,
} from "./wechat-task-geometry";
import { beginWechatTiming, runWechatSyncTiming } from "./wechat-timing";

export type {
	BrowserWechatClipboardRuntime,
	ClipboardItemConstructor,
} from "./wechat-clipboard-runtime";
export {
	MAX_WECHAT_PNG_DIMENSION,
	MAX_WECHAT_PNG_PIXELS,
	MAX_WECHAT_PNG_TOTAL_BYTES,
	MAX_WECHAT_PNG_TOTAL_PIXELS,
	MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
	MAX_WECHAT_PNG_VISUALS,
	WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
	WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
	WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
} from "./wechat-png-conversion-policy";

export const CLIPBOARD_COMMIT_TIMEOUT_MS = 10_000;

type ClipboardWriteResult = Readonly<{ error: unknown | null }>;

type ModernCopyTransaction = Readonly<{
	assertBlobCurrent: () => void;
	awaitCompletion: (
		writeResult: Promise<ClipboardWriteResult>,
		writeFailure: Promise<never>,
		htmlBlob: Promise<Blob>,
		textBlob: Promise<Blob>,
		cancellationFailure: Promise<never>,
	) => Promise<void>;
	cleanup: () => void;
	finalize: () => void;
	onFailure: (error: unknown) => WechatClipboardResult;
	onSynchronousModernFailure: () => WechatClipboardResult;
	payload: Promise<SerializedClipboardPayload>;
	start: () => void;
}>;

function legacyCopy(
	html: string,
	text: string,
	runtime: BrowserWechatClipboardRuntime,
): boolean {
	const selection = runtime.getSelection();
	const ranges = selection
		? Array.from({ length: selection.rangeCount }, (_, index) =>
				selection.getRangeAt(index),
			)
		: [];
	const activeElement = runtime.document.activeElement as HTMLElement | null;
	const container = runtime.document.createElement("div");
	const range = runtime.document.createRange();
	const offset = runtime.pageOffset();
	container.className = "easymde-copy-sandbox";
	container.setAttribute("contenteditable", "true");
	container.innerHTML = html;
	runtime.document.body.appendChild(container);
	let clipboardSubmission: "pending" | "complete" | "failed" = "pending";
	const handleCopy = (event: Event): void => {
		const clipboardData = (event as ClipboardEvent).clipboardData;
		if (!clipboardData) {
			clipboardSubmission = "failed";
			event.preventDefault();
			return;
		}
		try {
			clipboardData.setData("text/html", html);
			clipboardData.setData("text/plain", text);
			clipboardSubmission = "complete";
			event.preventDefault();
		} catch {
			clipboardSubmission = "failed";
			event.preventDefault();
		}
	};
	runtime.document.addEventListener("copy", handleCopy, true);
	const getClipboardSubmission = (): "pending" | "complete" | "failed" =>
		clipboardSubmission;
	try {
		if (selection) {
			selection.removeAllRanges();
			range.selectNodeContents(container);
			selection.addRange(range);
		}
		try {
			const commandSucceeded =
				"function" === typeof runtime.document.execCommand &&
				runtime.document.execCommand("copy");
			return Boolean(
				commandSucceeded && "complete" === getClipboardSubmission(),
			);
		} catch {
			return false;
		}
	} finally {
		runtime.document.removeEventListener("copy", handleCopy, true);
		if (selection) {
			selection.removeAllRanges();
			ranges.forEach((storedRange) => {
				selection.addRange(storedRange);
			});
		}
		container.remove();
		if (activeElement?.isConnected)
			activeElement.focus({ preventScroll: true });
		runtime.scrollTo(offset.x, offset.y);
	}
}

export function createBrowserWechatClipboard(
	runtime: BrowserWechatClipboardRuntime,
): WechatClipboardPort {
	const backgroundAssetCache: BackgroundAssetCache = new Map();
	const preparedPayloads: PreparedClipboardPayloadCache = new WeakMap();
	const backgroundPreparations: BackgroundPreparationCache = new WeakMap();
	const geometryMeasurements: PreviewGeometryMeasurementCache = new WeakMap();
	const mathVectorAtlasCache = createWechatMathVectorAtlasCache();
	const mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined =
		createWechatMathVectorAtlasLoaderIfConfigured(
			runtime,
			mathVectorAtlasCache,
		);
	let preparationSequence = 0;
	const nextPreparationSequence = (): number => {
		preparationSequence += 1;
		return preparationSequence;
	};
	const preparedGeometryRuntime = (
		preview: HTMLElement,
		root: HTMLElement,
		prepared: PreparedClipboardPayload | undefined,
		measurement: WechatPreviewMeasurementLease | null,
		dimensionSemantics: WechatDimensionSemanticsContext,
	): Readonly<{
		evidence: PreparedMermaidContentBoxEvidence | null;
		isCurrent: () => boolean;
		runtime: BrowserWechatClipboardRuntime;
	}> | null => {
		const owners = [
			...(root.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ? [root] : []),
			...root.querySelectorAll('.easymde-mermaid[data-easymde-mermaid-layout]'),
		];
		if (!owners.length) return { runtime, evidence: null, isCurrent: () => true };
		if (owners.some((owner) => null === mermaidAdmissionScrollGeometry(owner))) return null;
		const candidate = prepared?.payload ? prepared : prepared?.fallback;
		const boxes = candidate?.contentBoxes;
		if (boxes?.isCurrent() && owners.every((owner) => boxes.get(owner))) {
			return { runtime: { ...runtime, mermaidContentBoxes: boxes }, evidence: null, isCurrent: boxes.isCurrent };
		}
		const evidence = candidate?.contentBoxEvidence;
		if (!measurement || !evidence || !candidate) return null;
		const fonts = runtime.document.fonts ?? null;
		const basicInputsMatch = (): boolean =>
			measurement.isReady() &&
			measurement.sourceRoot === preview &&
			evidence.sourceRoot === preview &&
			measurement.sourceWidthKey === evidence.sourceWidthKey &&
			previewMeasurementLeaseSourceMatches(measurement, preview, runtime) &&
			candidate.sourceMarkup === clipboardSourceMarkup(preview) &&
			(runtime.document.fonts ?? null) === evidence.fontSet &&
			(!fonts || ('loaded' === fonts.status && fonts.ready === evidence.fontReady));
		if (!basicInputsMatch()) return null;
		dimensionSemantics.refresh();
		if (preparedLayoutSignature(preview, runtime, root, dimensionSemantics, undefined, false, true) !== evidence.inputSignature) {
			return null;
		}
		const mapped = new Map<Element, MermaidContentBox>();
		for (const owner of owners) {
			const source = measurement.sourceFor(owner);
			const box = source ? evidence.boxes.get(source) : null;
			if (!source || !preview.contains(source) || measurement.measurementFor(source) !== owner || !box) return null;
			mapped.set(owner, box);
		}
		if (mapped.size !== evidence.boxes.size || !basicInputsMatch()) return null;
		return {
			evidence,
			isCurrent: () => {
				if (!basicInputsMatch()) return false;
				const currentOwners = [
					...(root.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ? [root] : []),
					...root.querySelectorAll('.easymde-mermaid[data-easymde-mermaid-layout]'),
				];
				return currentOwners.length === owners.length && owners.every((owner, index) => {
					const source = measurement.sourceFor(owner);
					return currentOwners[index] === owner && Boolean(source && preview.contains(source) &&
						measurement.measurementFor(source) === owner && evidence.boxes.has(source));
				});
			},
			runtime: { ...runtime, mermaidContentBoxes: { get: (source) => mapped.get(source) ?? null } },
		};
	};

	return {
		releasePrepared(preview: HTMLElement): void {
			const prepared = preparedPayloads.get(preview);
			if (!prepared) return;
			preparedPayloads.delete(preview);
			prepared.backgroundCancel?.();
			prepared.cancel?.();
			prepared.contentBoxes?.cleanup();
			if (prepared.fallback?.contentBoxes !== prepared.contentBoxes) {
				prepared.fallback?.contentBoxes?.cleanup();
			}
		},
		rememberPreviewWidth(preview: HTMLElement): void {
			rememberPreviewWidthValue(preview);
		},
		async prepare(
			preview: HTMLElement,
			options: WechatClipboardPreparationOptions = {},
		): Promise<void> {
			if (!previewReady(preview)) return;
			if (options.geometryOnly) {
				await preparePreviewGeometryOnly(
					preview,
					runtime,
					geometryMeasurements,
					options.signal,
				);
				return;
			}
			if (options.background) {
				await coalescedBackgroundPreparation(
					preview,
					runtime,
					backgroundAssetCache,
					preparedPayloads,
					backgroundPreparations,
					nextPreparationSequence,
					options.signal,
					mathVectorAtlasLoader,
				);
				return;
			}
			await preparedClipboardPayload(
				preview,
				runtime,
				backgroundAssetCache,
				preparedPayloads,
				nextPreparationSequence,
				true,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				mathVectorAtlasLoader,
			).promise;
		},
		async copy(
			preview: HTMLElement,
			options: WechatClipboardCopyOptions = {},
		): Promise<WechatClipboardResult> {
			const hiddenFormalPreview =
				Boolean(options.resolvePreview) &&
				preview.classList.contains("easymde-preview-surface-hidden");
			if (!hiddenFormalPreview && !previewReady(preview)) {
				return { code: "wechat-preview-unavailable", status: "failed" };
			}

			const pngConversionEnabled = true === options.pngConversionEnabled;
			const copyGuard: WechatClipboardCopyGuard = {
				isCurrent: options.isCurrent,
				signal: options.signal,
			};
			const copyWasCancelled = (): boolean =>
				Boolean(options.signal?.aborted) ||
				Boolean(options.isCurrent && !options.isCurrent());
			const requiresPreviewResolution = Boolean(
				options.resolvePreview &&
					(hiddenFormalPreview ||
						preview.querySelector("[data-easymde-preview-window-spacer]")),
			);
			if (pngConversionEnabled && (!runtime.write || !runtime.clipboardItem)) {
				return {
					code: "wechat-png-clipboard-failed",
					sideEffects: "none",
					status: "failed",
				};
			}
			if (
				pngConversionEnabled &&
				(!options.visualRasterizationPort ||
					!options.imageUploadPort ||
					!Number.isSafeInteger(options.postId) ||
					(options.postId as number) < 0 ||
					!Number.isSafeInteger(options.maxBytes) ||
					(options.maxBytes as number) < 1)
			) {
				return {
					code: "wechat-png-rasterization-failed",
					sideEffects: "none",
					status: "failed",
				};
			}
			if (copyWasCancelled()) {
				return pngConversionEnabled
					? {
							code: "wechat-png-rasterization-cancelled",
							sideEffects: "none",
							status: "failed",
						}
					: { code: "wechat-copy-failed", status: "failed" };
			}

			if (runtime.write && runtime.clipboardItem) {
				// Claim a matching hidden geometry lease synchronously with the user
				// activation.  Theme/mode layout work may make the Preview visible
				// before the async resolver runs; once claimed, the foreground copy
				// owns the lease and background preparation cannot abort its host.
				let foregroundGeometryMeasurement = pngConversionEnabled
					? cachedPreviewGeometryMeasurement(
							preview,
							runtime,
							geometryMeasurements,
						)
					: null;
				const resolveController = requiresPreviewResolution
					? new AbortController()
					: null;
				const propagateResolveAbort = () => resolveController?.abort();
				if (resolveController && options.signal) {
					if (options.signal.aborted) {
						resolveController.abort();
					} else {
						options.signal.addEventListener("abort", propagateResolveAbort, {
							once: true,
						});
					}
				}
				const detachResolveAbort = (): void => {
					if (options.signal) {
						options.signal.removeEventListener(
							"abort",
							propagateResolveAbort,
						);
					}
				};
				const readyPreview = requiresPreviewResolution
					? Promise.resolve()
							.then(() =>
								options.resolvePreview?.(resolveController?.signal),
							)
							.then((resolved) => {
								if (!resolved || !previewReady(resolved)) {
									throw new Error("wechat-preview-unavailable");
								}
								return resolved;
							})
							.finally(detachResolveAbort)
					: Promise.resolve(preview);
				let payloadPreview = preview;
				let payload!: Promise<SerializedClipboardPayload>;
				let startTransaction!: () => void;
				let assertBlobCurrent!: () => void;
				let awaitCompletion!: ModernCopyTransaction["awaitCompletion"];
				let finalizeTransaction!: () => void;
				let synchronousModernFailure!: () => WechatClipboardResult;
				let transactionFailure!: (error: unknown) => WechatClipboardResult;
				let cleanupTransaction!: () => void;
				let finishCopyTotal: (terminal: "error" | "success") => void = () =>
					undefined;
				const baseRuntime = runtime;

				if (pngConversionEnabled) {
					let runtime: BrowserWechatClipboardRuntime = baseRuntime;
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
							options.signal.addEventListener(
								"abort",
								propagateConversionAbort,
								{ once: true },
							);
						}
					}
					const detachConversionAbort = () => {
						options.signal?.removeEventListener(
							"abort",
							propagateConversionAbort,
						);
					};
					const conversionSignal = conversionController.signal;
					const conversionRasterizationPort = options.visualRasterizationPort as
						| WechatVisualRasterizationPort
						| undefined;
					const conversionImageUploadPort = options.imageUploadPort as
						| ImageUploadPort
						| undefined;
					let disposeConversionFreshness: (() => void) | undefined;
					let conversionSourceFreshness: ClipboardSourceFreshnessGuard | null =
						null;
						let conversionFidelitySignature: string | null = null;
					let disposeGeometryMeasurement: (() => void) | undefined;
					let disposeTableNativeGridMeasurement: (() => void) | undefined;
					let tableNativeGridMeasurement: WechatPreviewMeasurementLease | null =
						null;
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
					finishCopyTotal = createWechatCopyTotalTiming(
						preview.ownerDocument.defaultView?.performance,
						true,
					);
					assertBlobCurrent = () => {
						assertCopyPreviewCurrent(payloadPreview, copyGuard);
						if (contentBoxes && !contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
						if (!conversionSourceFreshness?.finalize()) {
							throw new Error("wechat-copy-stale");
						}
						if (null === conversionFidelitySignature)
							throw new Error("wechat-copy-stale");
						if (
							preparedLayoutSignature(
								payloadPreview,
								runtime,
								tableNativeGridMeasurement?.root ?? payloadPreview,
								null,
								undefined,
								true,
							) !== conversionFidelitySignature
						)
							throw new Error("wechat-copy-stale");
						tableNativeGridGuard?.assertCurrent();
					};
					awaitCompletion = async (
						writeResult,
						writeFailure,
						htmlBlob,
						textBlob,
						cancellationFailure,
					) => {
						const completion = Promise.all([
							payload,
							htmlBlob,
							textBlob,
							writeResult,
						]);
						const completed = await withTimeout(
							Promise.race([completion, writeFailure, cancellationFailure]),
							WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
							"wechat-png-transaction-timeout",
						);
						const { error } = completed[3];
						if (null !== error) throw error;
					};
					finalizeTransaction = () => {
						assertCopyPreviewCurrent(payloadPreview, copyGuard);
						if (contentBoxes && !contentBoxes.isCurrent()) throw new Error("wechat-copy-stale");
						if (!conversionSourceFreshness?.finalize()) {
							throw new Error("wechat-copy-stale");
						}
						if (null === conversionFidelitySignature)
							throw new Error("wechat-copy-stale");
						if (
							preparedLayoutSignature(
								payloadPreview,
								runtime,
								tableNativeGridMeasurement?.root ?? payloadPreview,
								null,
								undefined,
								true,
							) !== conversionFidelitySignature
						)
							throw new Error("wechat-copy-stale");
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
					synchronousModernFailure = () => ({
						code: "wechat-png-clipboard-failed",
						sideEffects: "none",
						status: "failed",
					});
					transactionFailure = (error: unknown) => {
						finishCopyTotal("error");
						conversionController.abort();
						contentBoxes?.cleanup();
						contentBoxes = null;
						if (error instanceof WechatPngConversionError)
							logPngFailureDiagnostic(error);
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
					cleanupTransaction = () => {
						if (!tableNativeGridTransactionOpen) return;
						// Abort before releasing the hidden root so any late continuation
						// observes cancellation before it can read released geometry.
						conversionController.abort();
						finishCopyTotal("error");
						readinessTiming?.fail();
						foregroundGeometryMeasurement?.cleanup();
						foregroundGeometryMeasurement = null;
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
					payload = new Promise<SerializedClipboardPayload>(
						(resolve, reject) => {
							startTransaction = () => {
								void readyPreview
									.then((resolvedPreview) => {
										if (
											conversionSignal.aborted ||
											(options.isCurrent && !options.isCurrent())
										) {
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
										const transferredGeometryMeasurement =
											foregroundGeometryMeasurement &&
											foregroundGeometryMeasurement.lease.sourceRoot ===
												resolvedPreview
												? foregroundGeometryMeasurement
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
											foregroundGeometryMeasurement = null;
											throw new WechatPngConversionError(
												"wechat-png-rasterization-cancelled",
											);
										}
										if (
											foregroundGeometryMeasurement &&
											!transferredGeometryMeasurement
										) {
											foregroundGeometryMeasurement.cleanup();
											foregroundGeometryMeasurement = null;
										}
										const cachedGeometryMeasurement =
											transferredGeometryMeasurement ??
											cachedPreviewGeometryMeasurement(
												resolvedPreview,
												runtime,
												geometryMeasurements,
											);
										foregroundGeometryMeasurement = null;
										const geometryMeasurement =
											cachedGeometryMeasurement?.lease ??
											createPreviewMeasurementLease(
												resolvedPreview,
												runtime,
												conversionSignal,
											);
										disposeGeometryMeasurement = () => {
											if (cachedGeometryMeasurement)
												cachedGeometryMeasurement.cleanup();
											else geometryMeasurement?.cleanup();
										};
										const taskGeometryLease = createTaskCheckboxGeometryLease(
											resolvedPreview,
											runtime,
											conversionSignal,
											geometryMeasurement,
										);
										disposeTaskGeometryLease = () =>
											taskGeometryLease?.cleanup();
										const measurementOwnedGeometry =
											null !== geometryMeasurement;
										const transitionReadiness = geometryMeasurement
											? null
											: createPreviewTransitionLease(
													[resolvedPreview],
													conversionSignal,
												);
										disposeTransitionReadiness = () =>
											transitionReadiness?.cleanup();
										const serializationPreview =
											geometryMeasurement?.root ?? resolvedPreview;
										const geometryReadiness = cachedGeometryMeasurement
											? waitForPreviewMeasurement(
													geometryMeasurement?.ready ?? Promise.resolve(),
													conversionSignal,
												)
											: (geometryMeasurement?.ready ?? Promise.resolve());
										readinessTiming = createWechatReadinessTiming({
											geometryOwner: measurementOwnedGeometry
												? "measurement"
												: "source",
											geometryPairs: geometryMeasurement
												? geometryMeasurement.root.querySelectorAll("img")
														.length
												: null,
											geometryReadiness,
											hidden: measurementOwnedGeometry,
											performance:
												resolvedPreview.ownerDocument.defaultView?.performance,
											taskGeometryOwner: taskGeometryLease
												? "task-geometry"
												: "source",
											taskGeometryReadiness:
												taskGeometryLease?.ready ?? Promise.resolve(),
											transitionReadiness:
												transitionReadiness?.ready ?? Promise.resolve(),
										});
										return readinessTiming.ready
											.then(async () => {
												if (
													serializationPreview.matches('.easymde-mermaid[data-easymde-mermaid-layout]') ||
													serializationPreview.querySelector('.easymde-mermaid[data-easymde-mermaid-layout]')
												) {
													contentBoxes = createMermaidContentBoxLease(serializationPreview, conversionSignal);
													try {
														await contentBoxes.ready;
													} catch {
														throw new WechatPngConversionError(conversionSignal.aborted
															? "wechat-png-rasterization-cancelled"
															: "wechat-png-rasterization-failed");
													}
													if (!contentBoxes.isCurrent()) throw new WechatPngConversionError("wechat-png-rasterization-cancelled");
													runtime = { ...runtime, mermaidContentBoxes: contentBoxes };
												}
												const nativeGridMeasurement =
													cachedGeometryMeasurement?.lease ??
													geometryMeasurement;
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
													imageUploadPort:
														conversionImageUploadPort as ImageUploadPort,
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
														if (!yieldToBrowser)
															throw new Error("wechat-copy-yield-unavailable");
														const dimensionSemantics =
															createDimensionSemanticsContext(
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
															const serialized =
																await serializeClipboardPayload(
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
																const sourceFreshnessCurrent =
																	sourceFreshness.finalize();
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
																		mermaidSourceUsesAutoBlockMargins(
																			source,
																			runtime,
																		) !== snapshot.autoMargins
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
						},
					);
				} else {
					let portableRuntime = runtime;
					let portablePrepared: PreparedClipboardPayload | null = null;
					let portablePreparation: {
						preview: HTMLElement;
						prepared: PreparedClipboardPayload;
					} | null = null;
					let disposePortableActiveOwner: (() => void) | undefined;
					let portableMeasurement: WechatPreviewMeasurementLease | null = null;
					let portableDimensionSemantics: WechatDimensionSemanticsContext | null =
						null;
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
					const portableFreshnessReady = new Promise<void>(
						(resolve, reject) => {
							resolvePortableFreshness = resolve;
							rejectPortableFreshness = reject;
						},
					);
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
					const initializePortableFreshness = (
						resolvedPreview: HTMLElement,
					): void => {
						if (portableFreshnessClosed) {
							rejectPortableFreshness(new Error("wechat-copy-cancelled"));
							return;
						}
						try {
							payloadPreview = resolvedPreview;
							rememberPreviewWidthValue(resolvedPreview);
							portableSourceFreshness.current =
								createClipboardSourceFreshnessGuard(resolvedPreview);
							resolvePortableFreshness();
						} catch (error: unknown) {
							rejectPortableFreshness(error);
						}
					};
					const portablePreparationIsCurrent = (): boolean =>
						!copyWasCancelled() && null !== portableFreshness.current();
					startTransaction = () => {
						if (requiresPreviewResolution) {
							void readyPreview.then(
								initializePortableFreshness,
								(error: unknown) => rejectPortableFreshness(error),
							);
						} else {
							initializePortableFreshness(preview);
						}
					};
					assertBlobCurrent = () => {
						assertPortableCopyCurrent(
							payloadPreview,
							copyGuard,
							portableFreshness,
						);
						if (portablePrepared?.contentBoxes && !portablePrepared.contentBoxes.isCurrent()) {
							throw new Error("wechat-copy-stale");
						}
						if (
							null === portableFidelitySignature ||
							null === portableDimensionSemantics
						)
							throw new Error("wechat-copy-stale");
						portableDimensionSemantics.refresh();
						if (
							preparedLayoutSignature(
								payloadPreview,
								portableRuntime,
								portableMeasurement?.root ?? payloadPreview,
								portableDimensionSemantics,
							) !== portableFidelitySignature
						)
							throw new Error("wechat-copy-stale");
						portableTableNativeGridGuard?.assertCurrent();
					};
					awaitCompletion = async (
						writeResult,
						writeFailure,
						htmlBlob,
						textBlob,
						cancellationFailure,
					) => {
						const payloadReady = withTimeout(
							Promise.all([payload, htmlBlob, textBlob]),
							WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
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
					finalizeTransaction = () => {
						const sourceGuard = portableFreshness.current();
						assertCopyPreviewCurrent(payloadPreview, copyGuard);
						if (portablePrepared?.contentBoxes && !portablePrepared.contentBoxes.isCurrent()) {
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
						)
							throw new Error("wechat-copy-stale");
						portableDimensionSemantics.refresh();
						if (
							preparedLayoutSignature(
								payloadPreview,
								portableRuntime,
								portableMeasurement?.root ?? payloadPreview,
								portableDimensionSemantics,
							) !== portableFidelitySignature
						)
							throw new Error("wechat-copy-stale");
						if (!sourceGuard?.finalize()) throw new Error("wechat-copy-stale");
						assertCopyPreviewCurrent(payloadPreview, copyGuard);
					};
					synchronousModernFailure = fallbackAfterSynchronousModernFailure;
					transactionFailure = () => ({
						code: "wechat-copy-failed",
						status: "failed",
					});
					cleanupTransaction = () => {
						if (!portableTransactionOpen) return;
						// Reject any later owner registration first, then close Source
						// freshness, and only then release the accepted active owner.
						portableTransactionOpen = false;
						disposePortableFreshness();
						disposePortablePreparation();
						const cleanupActiveOwner = disposePortableActiveOwner;
						disposePortableActiveOwner = undefined;
						portableMeasurement = null;
						portableDimensionSemantics = null;
						cleanupActiveOwner?.();
					};
					payload = requiresPreviewResolution
						? readyPreview.then((resolvedPreview) => {
								payloadPreview = resolvedPreview;
								return preparedClipboardPayloadAfterWrite(
									resolvedPreview,
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
										portableTableNativeGridGuard =
											createWechatTableNativeGridGuard(ready.root, runtime);
									},
									(signature) => {
										portableFidelitySignature = signature;
									},
								).then((prepared) => {
									portablePrepared = prepared;
									return prepared.promise;
								});
							})
						: preparedClipboardPayloadAfterWrite(
								preview,
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
									portablePreparation = { preview: preparedPreview, prepared };
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
									portableTableNativeGridGuard =
										createWechatTableNativeGridGuard(ready.root, runtime);
								},
								(signature) => {
									portableFidelitySignature = signature;
								},
							).then((prepared) => {
								portablePrepared = prepared;
								return prepared.promise;
							});
				}
				let rejectDeferredPayload: ((error: unknown) => void) | null = null;
				const deferredPayloadFailure = new Promise<never>(
					(_resolve, reject) => {
						rejectDeferredPayload = reject;
					},
				);
				const abortDeferredPayload = (): void => {
					rejectDeferredPayload?.(new Error("wechat-copy-cancelled"));
				};
				const detachCopyAbort = (): void => {
					options.signal?.removeEventListener("abort", abortDeferredPayload);
				};
				if (options.signal) {
					if (options.signal.aborted) {
						abortDeferredPayload();
					} else {
						options.signal.addEventListener("abort", abortDeferredPayload, {
							once: true,
						});
					}
				}
				const transaction: ModernCopyTransaction = {
					assertBlobCurrent,
					awaitCompletion,
					cleanup: cleanupTransaction,
					finalize: finalizeTransaction,
					onFailure: transactionFailure,
					onSynchronousModernFailure: synchronousModernFailure,
					payload,
					start: startTransaction,
				};
				const gateBlob = (source: Promise<Blob>): Promise<Blob> =>
					Promise.race([
						source.then((blob) => {
							transaction.assertBlobCurrent();
							return blob;
						}),
						deferredPayloadFailure,
					]);
				const htmlBlob = gateBlob(
					payload.then(
						({ html }) => new runtime.blob([html], { type: "text/html" }),
					),
				);
				const textBlob = gateBlob(
					payload.then(
						({ text }) => new runtime.blob([text], { type: "text/plain" }),
					),
				);
				const preparedBeforeWrite =
					!pngConversionEnabled && !requiresPreviewResolution
						? preparedPayloads.get(preview)
						: null;
				const pendingFallback =
					preparedBeforeWrite && !preparedBeforeWrite.payload
						? preparedBeforeWrite.fallback
						: null;
				const observeBlobRejections = (): void => {
					if (htmlBlob instanceof Promise) void htmlBlob.catch(() => undefined);
					if (textBlob instanceof Promise) void textBlob.catch(() => undefined);
				};
				const synchronousCompatibilityPayload = (
					serializationPreview: HTMLElement,
					copyRuntime: BrowserWechatClipboardRuntime,
					dimensionSemantics: WechatDimensionSemanticsContext,
					taskGeometryLease: TaskCheckboxGeometryLease | null,
					preparedFallback: SerializedClipboardPayload | null,
					inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null,
				): SerializedClipboardPayload | null => {
					if (preparedFallback) return preparedFallback;
					if (
						mathVectorAtlasLoader &&
						eligibleWechatMathVectorOwners(serializationPreview, copyRuntime)
							.length > 0
					) {
						return null;
					}
					return serializeClipboardPayloadSynchronously(
						serializationPreview,
						copyRuntime,
						preview,
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
				};
				function fallbackAfterSynchronousModernFailure(): WechatClipboardResult {
					if (requiresPreviewResolution) {
						return { code: "wechat-copy-failed", status: "failed" };
					}
					// ClipboardItem construction and write invocation still happen in
					// the originating click task. A payload prepared before that task
					// may therefore use the activation-safe compatibility path.
					let measurement = createPreviewMeasurementLease(preview, runtime);
					let transition: WechatPreviewTransitionLease | null = null;
					let taskGeometryLease: TaskCheckboxGeometryLease | null = null;
					let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
					try {
						if (measurement && !measurement.isReady()) {
							const retry = preparedClipboardPayload(
								preview,
								runtime,
								backgroundAssetCache,
								preparedPayloads,
								nextPreparationSequence,
								true,
								false,
								undefined,
								measurement,
								undefined,
								undefined,
								undefined,
								undefined,
								undefined,
								undefined,
								mathVectorAtlasLoader,
							);
							void retry.promise.catch(() => undefined);
							measurement = null;
							return { code: "wechat-copy-failed", status: "failed" };
						}
						transition = measurement
							? null
							: createPreviewTransitionLease([preview]);
						if (transition && !transition.isReady()) {
							return { code: "wechat-copy-failed", status: "failed" };
						}
						taskGeometryLease = createTaskCheckboxGeometryLease(
							preview,
							runtime,
							undefined,
							measurement,
						);
						if (taskGeometryLease && !taskGeometryLease.isReady()) {
							return { code: "wechat-copy-failed", status: "failed" };
						}
						const serializationPreview = measurement?.root ?? preview;
						const prepared = preparedPayloads.get(preview);
						dimensionSemantics = createDimensionSemanticsContext(
							serializationPreview,
							preview,
							runtime,
						);
						const geometry = preparedGeometryRuntime(preview, serializationPreview, prepared, measurement, dimensionSemantics);
						if (!geometry) {
							if (!prepared || prepared.payload) {
								const retry = preparedClipboardPayload(
									preview, runtime, backgroundAssetCache, preparedPayloads, nextPreparationSequence,
									true, false, undefined, measurement, dimensionSemantics, transition, taskGeometryLease,
									undefined, undefined, undefined, mathVectorAtlasLoader,
								);
								void retry.promise.catch(() => undefined);
								measurement = null;
								transition = null;
								taskGeometryLease = null;
								dimensionSemantics = null;
							}
							return { code: "wechat-copy-failed", status: "failed" };
						}
						const copyRuntime = geometry.runtime;
						const currentMarkup = clipboardSourceMarkup(preview);
						const currentLayoutSignature = preparedLayoutSignature(
							preview,
							copyRuntime,
							serializationPreview,
							dimensionSemantics,
						);
						dimensionSemantics.refresh();
						const currentDimensionSignature =
							preparedDimensionSemanticsSignature(
								serializationPreview,
								copyRuntime,
								dimensionSemantics,
							);
						const mathSourceCapture = hasWechatMathStaticFlowCandidate(
							serializationPreview,
						)
							? captureWechatMathSourceAdmissionSynchronously(
									serializationPreview,
									copyRuntime,
									true,
									undefined,
									undefined,
									preparedDimensionGeometrySignature(
										serializationPreview,
										copyRuntime,
										dimensionSemantics,
									),
								)
							: null;
						const preparedFallback = reusablePreparedClipboardPayload(
							prepared,
							currentMarkup,
							currentDimensionSignature,
							currentLayoutSignature,
							pendingFallback,
							mathSourceCapture?.sourceFingerprint ?? "",
							mathSourceCapture?.rawDimensionGeometrySignature ?? "",
							geometry.evidence,
						);
						if (geometry.evidence && !preparedFallback) {
							if (!prepared || prepared.payload) {
								const retry = preparedClipboardPayload(
									preview, runtime, backgroundAssetCache, preparedPayloads, nextPreparationSequence,
									true, false, undefined, measurement, dimensionSemantics, transition, taskGeometryLease,
									undefined, undefined, undefined, mathVectorAtlasLoader,
								);
								void retry.promise.catch(() => undefined);
								measurement = null;
								transition = null;
								taskGeometryLease = null;
								dimensionSemantics = null;
							}
							return { code: "wechat-copy-failed", status: "failed" };
						}
						const inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null =
							measurement
								? {
										existing: { kind: "measurement", lease: measurement },
										sourceFreshness: {
											isCurrent: () =>
												clipboardSourceMarkup(preview) === currentMarkup,
										},
								  }
								: transition
									? {
											existing: { kind: "transition", lease: transition },
											sourceFreshness: {
												isCurrent: () =>
													clipboardSourceMarkup(preview) === currentMarkup,
										},
									  }
									: null;
						// If no background payload has completed yet, the compatibility
						// path gets one synchronous attempt in the click task. A remote
						// theme image deliberately returns null here; claiming success
						// without its materialized asset would produce a partial paste.
						const fallback = synchronousCompatibilityPayload(
							serializationPreview,
							copyRuntime,
							dimensionSemantics,
							taskGeometryLease,
							preparedFallback,
							inlinePseudoReadiness,
						);
						dimensionSemantics.refresh();
						if (
							preparedLayoutSignature(
								preview,
								copyRuntime,
								serializationPreview,
								dimensionSemantics,
							) !== currentLayoutSignature
						)
							return { code: "wechat-copy-failed", status: "failed" };
						if (fallback && geometry.isCurrent() && legacyCopy(fallback.html, fallback.text, runtime)) {
							return { method: "legacy", status: "copied" };
						}
					} finally {
						dimensionSemantics?.cleanup();
						transition?.cleanup();
						taskGeometryLease?.cleanup();
						measurement?.cleanup();
					}
					return { code: "wechat-copy-failed", status: "failed" };
				}
				let writePromise: Promise<void>;
				try {
					const item = new runtime.clipboardItem({
						// ClipboardItem accepts PromiseLike<Blob> values. Starting the
						// write before theme-image fetches finish keeps the click's
						// transient user activation attached to the operation.
						"text/html": htmlBlob,
						"text/plain": textBlob,
					});
					writePromise = Promise.resolve(runtime.write([item]));
				} catch {
					finishCopyTotal("error");
					transaction.cleanup();
					detachCopyAbort();
					observeBlobRejections();
					if (copyWasCancelled()) {
						return transaction.onFailure(new Error("wechat-copy-cancelled"));
					}
					return transaction.onSynchronousModernFailure();
				}
				transaction.start();
				try {
					const writeResult = writePromise.then(
						() => ({ error: null }),
						(error: unknown) => ({ error }),
					);
					const writeFailure = writeResult.then(({ error }) => {
						if (null !== error) throw error;
						return new Promise<never>(() => undefined);
					});
					await transaction.awaitCompletion(
						writeResult,
						writeFailure,
						htmlBlob,
						textBlob,
						deferredPayloadFailure,
					);
					transaction.finalize();
					finishCopyTotal("success");
					return { method: "clipboard", status: "copied" };
				} catch (error: unknown) {
					// A rejected modern write resumes after an await and cannot safely
					// enter the activation-sensitive legacy path. Report the failure
					// instead of attempting an asynchronous compatibility fallback.
					observeBlobRejections();
					const rejectPayload = rejectDeferredPayload as
						| ((error: unknown) => void)
						| null;
					rejectPayload?.(error);
					return transaction.onFailure(error);
				} finally {
					transaction.cleanup();
					detachCopyAbort();
				}
			}

			if (pngConversionEnabled) {
				return {
					code: "wechat-png-clipboard-failed",
					sideEffects: "none",
					status: "failed",
				};
			}

			if (requiresPreviewResolution) {
				return { code: "wechat-copy-failed", status: "failed" };
			}

			// Legacy execCommand must run synchronously in the originating click
			// task. Preview preparation owns the asynchronous serialization; a
			// click before it resolves is a truthful failure and can be retried once
			// the next stable Preview notification has completed preparation.
			let measurement = createPreviewMeasurementLease(preview, runtime);
			let transition: WechatPreviewTransitionLease | null = null;
			let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
			try {
				if (measurement && !measurement.isReady()) {
					const retry = preparedClipboardPayload(
						preview,
						runtime,
						backgroundAssetCache,
						preparedPayloads,
						nextPreparationSequence,
						true,
						false,
						undefined,
						measurement,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						mathVectorAtlasLoader,
					);
					void retry.promise.catch(() => undefined);
					measurement = null;
					return { code: "wechat-copy-failed", status: "failed" };
				}
				transition = measurement
					? null
					: createPreviewTransitionLease([preview]);
				if (transition && !transition.isReady()) {
					return { code: "wechat-copy-failed", status: "failed" };
				}
				const serializationPreview = measurement?.root ?? preview;
				const prepared = preparedPayloads.get(preview);
				dimensionSemantics = createDimensionSemanticsContext(serializationPreview, preview, runtime);
				const geometry = preparedGeometryRuntime(preview, serializationPreview, prepared, measurement, dimensionSemantics);
				if (!geometry) {
					if (!prepared || prepared.payload) {
						const retry = preparedClipboardPayload(
							preview, runtime, backgroundAssetCache, preparedPayloads, nextPreparationSequence,
							true, false, undefined, measurement, dimensionSemantics, transition, undefined,
							undefined, undefined, undefined, mathVectorAtlasLoader,
						);
						void retry.promise.catch(() => undefined);
						measurement = null;
						transition = null;
						dimensionSemantics = null;
					}
					return { code: "wechat-copy-failed", status: "failed" };
				}
				const copyRuntime = geometry.runtime;
				const currentMarkup = clipboardSourceMarkup(preview);
				const currentLayoutSignature = preparedLayoutSignature(
					preview,
					copyRuntime,
					serializationPreview,
					dimensionSemantics,
				);
				dimensionSemantics.refresh();
				const currentDimensionSignature = preparedDimensionSemanticsSignature(
					serializationPreview,
					copyRuntime,
					dimensionSemantics,
				);
				const mathSourceCapture = hasWechatMathStaticFlowCandidate(
					serializationPreview,
				)
					? captureWechatMathSourceAdmissionSynchronously(
							serializationPreview,
							copyRuntime,
							true,
							undefined,
							undefined,
							preparedDimensionGeometrySignature(
								serializationPreview,
								copyRuntime,
								dimensionSemantics,
							),
						)
					: null;
				const payload = reusablePreparedClipboardPayload(
					prepared,
					currentMarkup,
					currentDimensionSignature,
					currentLayoutSignature,
					null,
					mathSourceCapture?.sourceFingerprint ?? "",
					mathSourceCapture?.rawDimensionGeometrySignature ?? "",
					geometry.evidence,
				);
				if (!payload) {
					const current = preparedPayloads.get(preview);
					const preparationIsPending = Boolean(current && !current.payload);
					if (!preparationIsPending) {
						const retry = preparedClipboardPayload(
							preview,
							runtime,
							backgroundAssetCache,
							preparedPayloads,
							nextPreparationSequence,
							true,
							false,
							undefined,
							measurement,
							dimensionSemantics,
							transition,
							undefined,
							undefined,
							undefined,
							undefined,
							mathVectorAtlasLoader,
						);
						void retry.promise.catch(() => undefined);
						dimensionSemantics = null;
						measurement = null;
						transition = null;
						return { code: "wechat-copy-failed", status: "failed" };
					}
					return { code: "wechat-copy-failed", status: "failed" };
				}
				dimensionSemantics.refresh();
				if (
					preparedLayoutSignature(
						preview,
						copyRuntime,
						serializationPreview,
						dimensionSemantics,
					) !== currentLayoutSignature
				)
					return { code: "wechat-copy-failed", status: "failed" };
				if (geometry.isCurrent() && legacyCopy(payload.html, payload.text, runtime)) {
					return { method: "legacy", status: "copied" };
				}
				return { code: "wechat-clipboard-unsupported", status: "failed" };
			} finally {
				dimensionSemantics?.cleanup();
				transition?.cleanup();
				measurement?.cleanup();
			}
		},
	};
}
