import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import type {
	MermaidContentBox,
	MermaidContentBoxLease,
} from "./wechat-mermaid-content-box";
import type {
	SerializedClipboardPayload,
	WechatMathSourceCaptureResult,
} from "./wechat-portable-serialization";
import type {
	WechatPreviewMeasurementLease,
	WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";

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

export type PreparedClipboardPayloadCache = WeakMap<
	HTMLElement,
	PreparedClipboardPayload
>;

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

export function preparedClipboardSerializationReady(
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
	): boolean =>
		!boxes ||
		boxes.isCurrent() ||
		Boolean(evidence && evidence === validatedContentBoxEvidence);
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
		boxesCurrent(
			prepared.fallback?.contentBoxes,
			prepared.fallback?.contentBoxEvidence,
		) &&
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
		boxesCurrent(
			prepared?.fallback?.contentBoxes,
			prepared?.fallback?.contentBoxEvidence,
		) &&
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
		boxesCurrent(
			pendingFallback?.contentBoxes,
			pendingFallback?.contentBoxEvidence,
		) &&
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
