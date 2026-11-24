import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	type SerializationYield,
	throwIfBackgroundPreparationAborted,
	WECHAT_COPY_TIMING_NAMES,
	yieldSerializationBoundary,
} from "./wechat-clipboard-runtime";
import { EXPORT_TEXT_NORMALIZATIONS } from "./wechat-clone-metadata";
import { createWechatMarkupPreparationTimings } from "./wechat-copy-timing";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { createDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { preparedDimensionGeometrySignature } from "./wechat-fidelity-signature";
import type {
	WechatInlinePseudoPaintRawCapture,
	WechatInlinePseudoPaintReadiness,
} from "./wechat-inline-pseudo-paint";
import {
	applyWechatMathStaticFlow,
	type WechatMathSourceAdmissionResult,
	type WechatMathStaticFlowRuntime,
} from "./wechat-math-static-flow";
import {
	bindWechatMathVectorScenes,
	materializeWechatMathVectorScenes,
	type WechatMathVectorBoundPlan,
	type WechatMathVectorPortableCapture,
} from "./wechat-math-vector-portable";
import type { WechatNestedListProjectionCapture } from "./wechat-nested-list-projection";
import { replaceVisualObjects } from "./wechat-png-conversion";
import {
	assertPngConversionCurrent,
	type WechatPngConversionContext,
} from "./wechat-png-conversion-policy";
import { findKaTeXMathMl } from "./wechat-portable-content";
import {
	finalizeMarkup,
	referencedFragmentIds,
	removeOmittedNodes,
} from "./wechat-portable-serialization-finalize";
import {
	inlineStyles,
	inlineStylesSynchronously,
} from "./wechat-portable-serialization-inline-styles";
import {
	bindMathStaticFlowPlan,
	captureWechatMathSourceAdmission,
	captureWechatMathSourceAdmissionSynchronously,
	createMathStaticFlowGate,
	hasWechatMathStaticFlowCandidate,
} from "./wechat-portable-serialization-math";
import { connectedPlainText } from "./wechat-portable-serialization-plaintext";
import { applyInlinePseudoPaint } from "./wechat-portable-serialization-pseudo-paint";
import {
	assertHeadingEmptyPseudoFlows,
	type HeadingEmptyPseudoFlowCollector,
} from "./wechat-pseudo-elements";
import {
	assertQuotePseudoFlows,
	type QuotePseudoFlowCollector,
} from "./wechat-quote-pseudo-flow";
import { createWechatSvgPortableIntegration } from "./wechat-svg-portable-integration";
import { planWechatTableNativeGridForSerialization } from "./wechat-table-native-grid-integration";
import { assertTaskCheckboxCaptionRuns } from "./wechat-task-caption";
import {
	createTaskCheckboxGeometryContext,
	type TaskCheckboxGeometryLease,
	taskCheckboxGeometryScopes,
} from "./wechat-task-geometry";
import {
	assertTaskCheckboxStaticOwners,
	replaceTaskListCheckboxClones,
} from "./wechat-task-paint";
import {
	assertTaskCheckboxStaticFlowAllocationsForRoot,
	normalizeTaskCheckboxStaticFlow,
	normalizeTaskCheckboxStaticFlowSynchronously,
} from "./wechat-task-static-flow";
import { runWechatSyncTiming } from "./wechat-timing";

export {
	finalizeMarkup,
	normalizeStructure,
	referencedFragmentIds,
	retainReferencedFragmentIds,
	wrapKaTeXVisualRoots,
	wrapTextLeaves,
} from "./wechat-portable-serialization-finalize";
export {
	inlineStyles,
	inlineStylesSynchronously,
} from "./wechat-portable-serialization-inline-styles";
export {
	captureWechatMathSourceAdmission,
	captureWechatMathSourceAdmissionSynchronously,
	hasWechatMathStaticFlowCandidate,
	type WechatMathSourceCaptureResult,
} from "./wechat-portable-serialization-math";
export {
	connectedPlainText,
	normalizedPlainText,
} from "./wechat-portable-serialization-plaintext";

export async function createMarkup(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	cache: BackgroundAssetCache,
	yieldToBrowser: SerializationYield | null = null,
	conversion?: WechatPngConversionContext,
	signal?: AbortSignal,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
	mathVectorCapture: WechatMathVectorPortableCapture | null = null,
	mathVectorTextState?: { value: string | null },
	inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null = null,
): Promise<HTMLElement> {
	throwIfBackgroundPreparationAborted(signal);
	if (conversion) assertPngConversionCurrent(conversion);
	const mathCapture = sourceAdmission
		? null
		: await captureWechatMathSourceAdmission(
				preview,
				runtime,
				yieldToBrowser,
				signal ?? conversion?.signal,
				isCurrent,
				!conversion,
				conversion || !hasWechatMathStaticFlowCandidate(preview)
					? ""
					: preparedDimensionGeometrySignature(
							preview,
							runtime,
							dimensionSemantics,
						),
			);
	const effectiveSourceAdmission = conversion
		? null
		: (sourceAdmission ?? mathCapture?.sourceAdmission ?? null);
	const effectiveMathFingerprint =
		mathSourceFingerprint || mathCapture?.sourceFingerprint || "";
	const effectiveMathGeometrySignature =
		mathRawDimensionGeometrySignature ||
		mathCapture?.rawDimensionGeometrySignature ||
		"";
	const effectiveMathRuntime = mathRuntime ?? mathCapture?.runtime ?? null;
	const clone = preview.cloneNode(true) as HTMLElement;
	const cloneIdentity = new Map<Element, Element>();
	const inlinePseudoPaintCaptures: WechatInlinePseudoPaintRawCapture[] = [];
	const nestedListProjectionCaptures: WechatNestedListProjectionCapture[] = [];
	const omittedInlinePseudoPaintSources = new Set<Element>();
	let mathVectorPlan: WechatMathVectorBoundPlan | null = null;
	const svgIntegration = createWechatSvgPortableIntegration(
		preview,
		clone,
		runtime,
	);
	const sourceTaskInputs = replaceTaskListCheckboxClones(
		sourceRoot,
		preview,
		clone,
		runtime,
	);
	svgIntegration.reconcileTaskCheckboxes(preview, clone);
	const fragmentIds = referencedFragmentIds(preview);
	const mathMlNodes = findKaTeXMathMl(clone);
	if (
		taskCheckboxGeometryScopes(sourceRoot, runtime).length &&
		!taskGeometryLease
	) {
		throw new Error("wechat-task-checkbox-geometry-lease-missing");
	}
	const taskGeometry = createTaskCheckboxGeometryContext(
		taskGeometryLease,
		runtime,
		dimensionSemantics,
	);
	const headingFlowCollector: HeadingEmptyPseudoFlowCollector = {
		expectations: [],
	};
	const quoteFlowCollector: QuotePseudoFlowCollector = { expectations: [] };
	const markupTimings = createWechatMarkupPreparationTimings(
		clone.ownerDocument.defaultView?.performance,
		Boolean(conversion),
	);
	try {
		await inlineStyles(
			preview,
			clone,
			runtime.getComputedStyle,
			true,
			runtime,
			cache,
			preview,
			sourceRoot,
			dimensionSemantics,
			yieldToBrowser,
			conversion,
			signal,
			taskGeometry,
			headingFlowCollector,
			cloneIdentity,
			quoteFlowCollector,
			inlinePseudoPaintCaptures,
			nestedListProjectionCaptures,
		);
		markupTimings.inlineStyles.finish("success");
		throwIfBackgroundPreparationAborted(signal);
		const tableNativeGridPlans = planWechatTableNativeGridForSerialization(
			preview,
			cloneIdentity,
			runtime,
		);
		if (conversion && mathVectorCapture)
			throw new Error("wechat-math-vector-png-conflict");
		if (mathVectorCapture) {
			mathVectorPlan = bindWechatMathVectorScenes(
				sourceRoot,
				clone,
				mathVectorCapture.measurement,
				cloneIdentity,
				mathVectorCapture,
			);
		}
		removeOmittedNodes(
			clone,
			mathMlNodes,
			svgIntegration,
			omittedInlinePseudoPaintSources,
		);
		const mathPlan = bindMathStaticFlowPlan(
			preview,
			clone,
			effectiveMathRuntime,
			effectiveSourceAdmission,
			effectiveMathFingerprint,
			effectiveMathGeometrySignature,
			cloneIdentity,
			svgIntegration,
			conversion,
			signal,
			isCurrent,
			new Set([
				...(mathVectorPlan?.measurementOwners ?? []),
				...(mathVectorPlan?.sourceOwners ?? []),
			]),
		);
		svgIntegration.freezePlan(conversion ?? null);
		if (conversion) {
			assertPngConversionCurrent(conversion);
			await replaceVisualObjects(
				clone,
				conversion,
				runtime,
				cache,
				yieldToBrowser,
			);
			assertPngConversionCurrent(conversion);
		}
		await normalizeTaskCheckboxStaticFlow(
			clone,
			runtime,
			yieldToBrowser,
			conversion,
			signal,
			taskGeometryLease,
		);
		throwIfBackgroundPreparationAborted(signal);
		const finalized = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.finalizeMarkup,
			{ mode: "sync" },
			() =>
				finalizeMarkup(
					clone,
					fragmentIds,
					tableNativeGridPlans,
					nestedListProjectionCaptures,
					cloneIdentity,
				),
		);
		if (mathPlan) {
			applyWechatMathStaticFlow(mathPlan, {
				cloneRoot: finalized,
				gate: createMathStaticFlowGate(conversion, signal, isCurrent),
			});
		}
		svgIntegration.applyPlan(finalized);
		if (mathVectorPlan) {
			if (mathVectorTextState)
				mathVectorTextState.value = connectedPlainText(finalized, preview);
			materializeWechatMathVectorScenes(
				finalized,
				mathVectorPlan,
				clone.ownerDocument,
			);
		}
		applyInlinePseudoPaint(
			preview,
			finalized,
			runtime,
			inlinePseudoReadiness,
			inlinePseudoPaintCaptures,
			omittedInlinePseudoPaintSources,
			cloneIdentity,
		);
		assertTaskCheckboxStaticOwners(sourceTaskInputs, finalized);
		assertTaskCheckboxStaticFlowAllocationsForRoot(finalized);
		assertHeadingEmptyPseudoFlows(headingFlowCollector.expectations, finalized);
		assertQuotePseudoFlows(quoteFlowCollector.expectations, finalized);
		throwIfBackgroundPreparationAborted(signal);
		markupTimings.markupPreparation.finish("success");
		return finalized;
	} catch (error: unknown) {
		markupTimings.inlineStyles.finish("error");
		markupTimings.markupPreparation.finish("error");
		throw error;
	} finally {
		taskGeometry?.cleanup();
	}
}

export function createMarkupSynchronously(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
	mathVectorCapture: WechatMathVectorPortableCapture | null = null,
	mathVectorTextState?: { value: string | null },
	inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null = null,
): HTMLElement | null {
	const mathCapture = sourceAdmission
		? null
		: captureWechatMathSourceAdmissionSynchronously(
				preview,
				runtime,
				true,
				undefined,
				isCurrent,
				hasWechatMathStaticFlowCandidate(preview)
					? preparedDimensionGeometrySignature(
							preview,
							runtime,
							dimensionSemantics,
						)
					: "",
			);
	const effectiveSourceAdmission =
		sourceAdmission ?? mathCapture?.sourceAdmission ?? null;
	const effectiveMathFingerprint =
		mathSourceFingerprint || mathCapture?.sourceFingerprint || "";
	const effectiveMathGeometrySignature =
		mathRawDimensionGeometrySignature ||
		mathCapture?.rawDimensionGeometrySignature ||
		"";
	const effectiveMathRuntime = mathRuntime ?? mathCapture?.runtime ?? null;
	const clone = preview.cloneNode(true) as HTMLElement;
	const cloneIdentity = new Map<Element, Element>();
	const inlinePseudoPaintCaptures: WechatInlinePseudoPaintRawCapture[] = [];
	const nestedListProjectionCaptures: WechatNestedListProjectionCapture[] = [];
	const omittedInlinePseudoPaintSources = new Set<Element>();
	let mathVectorPlan: WechatMathVectorBoundPlan | null = null;
	const svgIntegration = createWechatSvgPortableIntegration(
		preview,
		clone,
		runtime,
	);
	const sourceTaskInputs = replaceTaskListCheckboxClones(
		sourceRoot,
		preview,
		clone,
		runtime,
	);
	svgIntegration.reconcileTaskCheckboxes(preview, clone);
	const fragmentIds = referencedFragmentIds(preview);
	const mathMlNodes = findKaTeXMathMl(clone);
	if (
		taskCheckboxGeometryScopes(sourceRoot, runtime).length &&
		!taskGeometryLease
	) {
		throw new Error("wechat-task-checkbox-geometry-lease-missing");
	}
	const taskGeometry = createTaskCheckboxGeometryContext(
		taskGeometryLease,
		runtime,
		dimensionSemantics,
	);
	const headingFlowCollector: HeadingEmptyPseudoFlowCollector = {
		expectations: [],
	};
	const quoteFlowCollector: QuotePseudoFlowCollector = { expectations: [] };
	try {
		if (
			!inlineStylesSynchronously(
				preview,
				clone,
				runtime.getComputedStyle,
				true,
				runtime,
				preview,
				sourceRoot,
				dimensionSemantics,
				taskGeometry,
				headingFlowCollector,
				cloneIdentity,
				quoteFlowCollector,
				inlinePseudoPaintCaptures,
				nestedListProjectionCaptures,
			)
		)
			return null;
		const tableNativeGridPlans = planWechatTableNativeGridForSerialization(
			preview,
			cloneIdentity,
			runtime,
		);
		if (mathVectorCapture) {
			mathVectorPlan = bindWechatMathVectorScenes(
				sourceRoot,
				clone,
				mathVectorCapture.measurement,
				cloneIdentity,
				mathVectorCapture,
			);
		}
		removeOmittedNodes(
			clone,
			mathMlNodes,
			svgIntegration,
			omittedInlinePseudoPaintSources,
		);
		const mathPlan = bindMathStaticFlowPlan(
			preview,
			clone,
			effectiveMathRuntime,
			effectiveSourceAdmission,
			effectiveMathFingerprint,
			effectiveMathGeometrySignature,
			cloneIdentity,
			svgIntegration,
			undefined,
			undefined,
			isCurrent,
			new Set([
				...(mathVectorPlan?.measurementOwners ?? []),
				...(mathVectorPlan?.sourceOwners ?? []),
			]),
		);
		svgIntegration.freezePlan(null);
		normalizeTaskCheckboxStaticFlowSynchronously(
			clone,
			runtime,
			taskGeometryLease,
		);
		const finalized = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.finalizeMarkup,
			{ mode: "sync" },
			() =>
				finalizeMarkup(
					clone,
					fragmentIds,
					tableNativeGridPlans,
					nestedListProjectionCaptures,
					cloneIdentity,
				),
		);
		if (mathPlan) {
			applyWechatMathStaticFlow(mathPlan, {
				cloneRoot: finalized,
				gate: createMathStaticFlowGate(undefined, undefined, isCurrent),
			});
		}
		svgIntegration.applyPlan(finalized);
		if (mathVectorPlan) {
			if (mathVectorTextState)
				mathVectorTextState.value = connectedPlainText(finalized, preview);
			materializeWechatMathVectorScenes(
				finalized,
				mathVectorPlan,
				clone.ownerDocument,
			);
		}
		applyInlinePseudoPaint(
			preview,
			finalized,
			runtime,
			inlinePseudoReadiness,
			inlinePseudoPaintCaptures,
			omittedInlinePseudoPaintSources,
			cloneIdentity,
		);
		assertTaskCheckboxStaticOwners(sourceTaskInputs, finalized);
		assertTaskCheckboxStaticFlowAllocationsForRoot(finalized);
		assertHeadingEmptyPseudoFlows(headingFlowCollector.expectations, finalized);
		assertQuotePseudoFlows(quoteFlowCollector.expectations, finalized);
		return finalized;
	} finally {
		taskGeometry?.cleanup();
	}
}

export async function serializeClipboardPayload(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	cache: BackgroundAssetCache,
	yieldToBrowser: SerializationYield | null = null,
	conversion?: WechatPngConversionContext,
	signal?: AbortSignal,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
	mathVectorCapture: WechatMathVectorPortableCapture | null = null,
	inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null = null,
): Promise<SerializedClipboardPayload> {
	throwIfBackgroundPreparationAborted(signal);
	const ownedDimensionSemantics =
		dimensionSemantics ??
		createDimensionSemanticsContext(preview, sourceRoot, runtime);
	try {
		ownedDimensionSemantics.refresh();
		const mathVectorTextState = { value: null as string | null };
		const clone = await createMarkup(
			preview,
			runtime,
			cache,
			yieldToBrowser,
			conversion,
			signal,
			sourceRoot,
			ownedDimensionSemantics,
			taskGeometryLease,
			sourceAdmission,
			mathSourceFingerprint,
			mathRawDimensionGeometrySignature,
			mathRuntime,
			isCurrent,
			mathVectorCapture,
			mathVectorTextState,
			inlinePseudoReadiness,
		);
		throwIfBackgroundPreparationAborted(signal);
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		const html = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.outerHtml,
			{ mode: "sync" },
			() => {
				const html = clone.outerHTML;
				assertTaskCheckboxCaptionRuns(
					clone,
					EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
					"encoded",
				);
				return html;
			},
		);
		await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
		throwIfBackgroundPreparationAborted(signal);
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		const text = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.connectedPlainText,
			{ mode: "sync" },
			() => mathVectorTextState.value ?? connectedPlainText(clone, preview),
		);
		await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
		throwIfBackgroundPreparationAborted(signal);
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		return { html, text };
	} finally {
		if (!dimensionSemantics) ownedDimensionSemantics.cleanup();
	}
}

export function serializeClipboardPayloadSynchronously(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
	mathVectorCapture: WechatMathVectorPortableCapture | null = null,
	inlinePseudoReadiness: WechatInlinePseudoPaintReadiness | null = null,
): SerializedClipboardPayload | null {
	const ownedDimensionSemantics =
		dimensionSemantics ??
		createDimensionSemanticsContext(preview, sourceRoot, runtime);
	try {
		ownedDimensionSemantics.refresh();
		const mathVectorTextState = { value: null as string | null };
		const clone = createMarkupSynchronously(
			preview,
			runtime,
			sourceRoot,
			ownedDimensionSemantics,
			taskGeometryLease,
			sourceAdmission,
			mathSourceFingerprint,
			mathRawDimensionGeometrySignature,
			mathRuntime,
			isCurrent,
			mathVectorCapture,
			mathVectorTextState,
			inlinePseudoReadiness,
		);
		if (!clone) return null;
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		const html = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.outerHtml,
			{ mode: "sync" },
			() => {
				const html = clone.outerHTML;
				assertTaskCheckboxCaptionRuns(
					clone,
					EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
					"encoded",
				);
				return html;
			},
		);
		const text = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.connectedPlainText,
			{ mode: "sync" },
			() => mathVectorTextState.value ?? connectedPlainText(clone, preview),
		);
		return { html, text };
	} finally {
		if (!dimensionSemantics) ownedDimensionSemantics.cleanup();
	}
}

export type SerializedClipboardPayload = Readonly<{
	html: string;
	text: string;
}>;
