import type { WechatClipboardResult } from "../../../contracts/ports/wechat-clipboard-port";
import type { WechatClipboardCopySharedState } from "./wechat-clipboard-copy-transaction";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	createDimensionSemanticsContext,
	type WechatDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import { collectPreparedSignatures } from "./wechat-fidelity-signature";
import type { WechatInlinePseudoPaintReadiness } from "./wechat-inline-pseudo-paint";
import {
	eligibleWechatMathVectorOwners,
	type WechatMathVectorAtlasLoader,
} from "./wechat-math-vector-portable";
import type { MermaidContentBox } from "./wechat-mermaid-content-box";
import { mermaidAdmissionScrollGeometry } from "./wechat-mermaid-geometry";
import {
	captureWechatMathSourceAdmissionSynchronously,
	hasWechatMathStaticFlowCandidate,
	type SerializedClipboardPayload,
	serializeClipboardPayloadSynchronously,
} from "./wechat-portable-serialization";
import {
	type PreparedClipboardFallback,
	type PreparedClipboardPayload,
	type PreparedMermaidContentBoxEvidence,
	preparedClipboardPayload,
	reusablePreparedClipboardPayload,
} from "./wechat-prepared-payload";
import { previewMeasurementLeaseSourceMatches } from "./wechat-preview-geometry-cache";
import {
	createPreviewMeasurementLease,
	createPreviewTransitionLease,
	type WechatPreviewMeasurementLease,
	type WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import { clipboardSourceMarkup } from "./wechat-source-freshness";
import {
	createTaskCheckboxGeometryLease,
	type TaskCheckboxGeometryLease,
} from "./wechat-task-geometry";

export function legacyCopy(
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

export function preparedGeometryRuntime(
	preview: HTMLElement,
	root: HTMLElement,
	prepared: PreparedClipboardPayload | undefined,
	measurement: WechatPreviewMeasurementLease | null,
	dimensionSemantics: WechatDimensionSemanticsContext,
	runtime: BrowserWechatClipboardRuntime,
): Readonly<{
	evidence: PreparedMermaidContentBoxEvidence | null;
	isCurrent: () => boolean;
	runtime: BrowserWechatClipboardRuntime;
}> | null {
	const owners = [
		...(root.matches(".easymde-mermaid[data-easymde-mermaid-layout]")
			? [root]
			: []),
		...root.querySelectorAll(".easymde-mermaid[data-easymde-mermaid-layout]"),
	];
	if (!owners.length) {
		return { runtime, evidence: null, isCurrent: () => true };
	}
	if (owners.some((owner) => null === mermaidAdmissionScrollGeometry(owner))) {
		return null;
	}
	const candidate = prepared?.payload ? prepared : prepared?.fallback;
	const boxes = candidate?.contentBoxes;
	if (boxes?.isCurrent() && owners.every((owner) => boxes.get(owner))) {
		return {
			runtime: { ...runtime, mermaidContentBoxes: boxes },
			evidence: null,
			isCurrent: boxes.isCurrent,
		};
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
		(!fonts ||
			("loaded" === fonts.status && fonts.ready === evidence.fontReady));
	if (!basicInputsMatch()) return null;
	dimensionSemantics.refresh();
	if (
		collectPreparedSignatures({
			preview: root,
			runtime,
			dimensionSemantics,
			contentBoxInputsOnly: true,
			includeDimension: false,
		}).layout !== evidence.inputSignature
	) {
		return null;
	}
	const mapped = new Map<Element, MermaidContentBox>();
	for (const owner of owners) {
		const source = measurement.sourceFor(owner);
		const box = source ? evidence.boxes.get(source) : null;
		if (
			!source ||
			!preview.contains(source) ||
			measurement.measurementFor(source) !== owner ||
			!box
		) {
			return null;
		}
		mapped.set(owner, box);
	}
	if (mapped.size !== evidence.boxes.size || !basicInputsMatch()) return null;
	return {
		evidence,
		isCurrent: () => {
			if (!basicInputsMatch()) return false;
			const currentOwners = [
				...(root.matches(".easymde-mermaid[data-easymde-mermaid-layout]")
					? [root]
					: []),
				...root.querySelectorAll(
					".easymde-mermaid[data-easymde-mermaid-layout]",
				),
			];
			return (
				currentOwners.length === owners.length &&
				owners.every((owner, index) => {
					const source = measurement.sourceFor(owner);
					return (
						currentOwners[index] === owner &&
						Boolean(
							source &&
								preview.contains(source) &&
								measurement.measurementFor(source) === owner &&
								evidence.boxes.has(source),
						)
					);
				})
			);
		},
		runtime: {
			...runtime,
			mermaidContentBoxes: { get: (source) => mapped.get(source) ?? null },
		},
	};
}

function synchronousCompatibilityPayload(
	preview: HTMLElement,
	serializationPreview: HTMLElement,
	copyRuntime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext,
	taskGeometryLease: TaskCheckboxGeometryLease | null,
	preparedFallback: SerializedClipboardPayload | null,
	inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null,
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined,
): SerializedClipboardPayload | null {
	if (preparedFallback) return preparedFallback;
	if (
		mathVectorAtlasLoader &&
		eligibleWechatMathVectorOwners(serializationPreview, copyRuntime).length > 0
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
}

export function fallbackAfterSynchronousModernFailure(
	preview: HTMLElement,
	requiresPreviewResolution: boolean,
	pendingFallback: PreparedClipboardFallback | null,
	shared: WechatClipboardCopySharedState,
): WechatClipboardResult {
	if (requiresPreviewResolution) {
		return { code: "wechat-copy-failed", status: "failed" };
	}
	const {
		backgroundAssetCache,
		mathVectorAtlasLoader,
		nextPreparationSequence,
		preparedPayloads,
		runtime,
	} = shared;
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
		transition = measurement ? null : createPreviewTransitionLease([preview]);
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
		const geometry = preparedGeometryRuntime(
			preview,
			serializationPreview,
			prepared,
			measurement,
			dimensionSemantics,
			runtime,
		);
		if (!geometry) {
			if (!prepared || prepared.payload) {
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
					taskGeometryLease,
					undefined,
					undefined,
					undefined,
					mathVectorAtlasLoader,
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
		const hasMathCandidate =
			hasWechatMathStaticFlowCandidate(serializationPreview);
		const currentSignatures = collectPreparedSignatures({
			preview: serializationPreview,
			runtime: copyRuntime,
			dimensionSemantics,
			includeDimensionGeometry: hasMathCandidate,
		});
		const currentLayoutSignature = currentSignatures.layout;
		const currentDimensionSignature = currentSignatures.dimension;
		const mathSourceCapture = hasMathCandidate
			? captureWechatMathSourceAdmissionSynchronously(
					serializationPreview,
					copyRuntime,
					true,
					undefined,
					undefined,
					currentSignatures.dimensionGeometry,
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
					taskGeometryLease,
					undefined,
					undefined,
					undefined,
					mathVectorAtlasLoader,
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
							isCurrent: () => clipboardSourceMarkup(preview) === currentMarkup,
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
			preview,
			serializationPreview,
			copyRuntime,
			dimensionSemantics,
			taskGeometryLease,
			preparedFallback,
			inlinePseudoReadiness,
			mathVectorAtlasLoader,
		);
		dimensionSemantics.refresh();
		if (
			collectPreparedSignatures({
				preview: serializationPreview,
				runtime: copyRuntime,
				dimensionSemantics,
				includeDimension: false,
			}).layout !== currentLayoutSignature
		) {
			return { code: "wechat-copy-failed", status: "failed" };
		}
		if (
			fallback &&
			geometry.isCurrent() &&
			legacyCopy(fallback.html, fallback.text, runtime)
		) {
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

export function executeLegacyWechatCopy(
	preview: HTMLElement,
	shared: WechatClipboardCopySharedState,
): WechatClipboardResult {
	const {
		backgroundAssetCache,
		mathVectorAtlasLoader,
		nextPreparationSequence,
		preparedPayloads,
		runtime,
	} = shared;
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
		transition = measurement ? null : createPreviewTransitionLease([preview]);
		if (transition && !transition.isReady()) {
			return { code: "wechat-copy-failed", status: "failed" };
		}
		const serializationPreview = measurement?.root ?? preview;
		const prepared = preparedPayloads.get(preview);
		dimensionSemantics = createDimensionSemanticsContext(
			serializationPreview,
			preview,
			runtime,
		);
		const geometry = preparedGeometryRuntime(
			preview,
			serializationPreview,
			prepared,
			measurement,
			dimensionSemantics,
			runtime,
		);
		if (!geometry) {
			if (!prepared || prepared.payload) {
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
				measurement = null;
				transition = null;
				dimensionSemantics = null;
			}
			return { code: "wechat-copy-failed", status: "failed" };
		}
		const copyRuntime = geometry.runtime;
		const currentMarkup = clipboardSourceMarkup(preview);
		const hasMathCandidate =
			hasWechatMathStaticFlowCandidate(serializationPreview);
		const currentSignatures = collectPreparedSignatures({
			preview: serializationPreview,
			runtime: copyRuntime,
			dimensionSemantics,
			includeDimensionGeometry: hasMathCandidate,
		});
		const currentLayoutSignature = currentSignatures.layout;
		const currentDimensionSignature = currentSignatures.dimension;
		const mathSourceCapture = hasMathCandidate
			? captureWechatMathSourceAdmissionSynchronously(
					serializationPreview,
					copyRuntime,
					true,
					undefined,
					undefined,
					currentSignatures.dimensionGeometry,
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
			collectPreparedSignatures({
				preview: serializationPreview,
				runtime: copyRuntime,
				dimensionSemantics,
				includeDimension: false,
			}).layout !== currentLayoutSignature
		) {
			return { code: "wechat-copy-failed", status: "failed" };
		}
		if (
			geometry.isCurrent() &&
			legacyCopy(payload.html, payload.text, runtime)
		) {
			return { method: "legacy", status: "copied" };
		}
		return { code: "wechat-clipboard-unsupported", status: "failed" };
	} finally {
		dimensionSemantics?.cleanup();
		transition?.cleanup();
		measurement?.cleanup();
	}
}
