import {
	type BrowserWechatClipboardRuntime,
	type SerializationYield,
	throwIfBackgroundPreparationAborted,
} from "./wechat-clipboard-runtime";
import { HIDDEN_NODES } from "./wechat-clone-metadata";
import {
	captureWechatMathStaticFlowSnapshot,
	planWechatMathStaticFlow,
	type WechatMathSourceAdmissionResult,
	type WechatMathStaticFlowGate,
	type WechatMathStaticFlowRuntime,
} from "./wechat-math-static-flow";
import {
	createWechatMathStaticFlowSourceCapture,
	type WechatMathStaticFlowSealedCapture,
} from "./wechat-math-static-flow-capture";
import type { WechatPngConversionContext } from "./wechat-png-conversion-policy";
import type { WechatSvgPortableIntegration } from "./wechat-svg-portable-integration";

export type WechatMathSourceCaptureResult = Readonly<{
	runtime: WechatMathStaticFlowRuntime | null;
	sourceAdmission: WechatMathSourceAdmissionResult | null;
	sourceFingerprint: string;
	rawDimensionGeometrySignature: string;
}>;

export function hasWechatMathStaticFlowCandidate(
	sourceRoot: HTMLElement,
): boolean {
	return (
		sourceRoot.matches(
			".katex, .katex-display, .katex-html, .easymde-math-block, .easymde-math-inline, .vlist",
		) ||
		Boolean(
			sourceRoot.querySelector(
				".katex, .katex-display, .katex-html, .easymde-math-block, .easymde-math-inline, .vlist",
			),
		)
	);
}

function animationReaderFor(
	runtime: BrowserWechatClipboardRuntime,
): () => readonly Animation[] {
	const documentReader = (
		runtime.document as Document & {
			getAnimations?: () => readonly Animation[];
		}
	).getAnimations;
	if ("function" === typeof documentReader)
		return () => documentReader.call(runtime.document);
	throw new Error("wechat-math-static-flow-animation-reader-missing");
}

function emptyMathSourceCaptureResult(): WechatMathSourceCaptureResult {
	return {
		rawDimensionGeometrySignature: "",
		runtime: null,
		sourceAdmission: null,
		sourceFingerprint: "",
	};
}

function mathCaptureResultFromSealed(
	sealed: WechatMathStaticFlowSealedCapture,
	rawDimensionGeometrySignature: string,
): WechatMathSourceCaptureResult {
	return {
		rawDimensionGeometrySignature,
		runtime: sealed.capturedRuntime,
		sourceAdmission: sealed.sourceAdmission,
		sourceFingerprint: sealed.sourceFingerprint,
	};
}

function createMathSourceCapture(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
) {
	if (!hasWechatMathStaticFlowCandidate(sourceRoot)) return null;
	return createWechatMathStaticFlowSourceCapture({
		enabled: true,
		runtime: {
			document: runtime.document,
			getAnimations: animationReaderFor(runtime),
			getComputedStyle: runtime.getComputedStyle,
		},
		sourceRoot,
	});
}

function assertMathCaptureCurrent(
	signal?: AbortSignal,
	isCurrent?: () => boolean,
): void {
	throwIfBackgroundPreparationAborted(signal);
	if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
}

export async function captureWechatMathSourceAdmission(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	yieldToBrowser: SerializationYield | null = null,
	signal?: AbortSignal,
	isCurrent?: () => boolean,
	enabled = true,
	rawDimensionGeometrySignature = "",
): Promise<WechatMathSourceCaptureResult> {
	if (!enabled) return emptyMathSourceCaptureResult();
	const capture = createMathSourceCapture(sourceRoot, runtime);
	if (!capture) return emptyMathSourceCaptureResult();
	const elements = [
		sourceRoot,
		...Array.from(sourceRoot.querySelectorAll("*")),
	];
	for (const element of elements) {
		assertMathCaptureCurrent(signal, isCurrent);
		capture.observe(
			element,
			runtime.getComputedStyle(element),
			element.getBoundingClientRect(),
		);
		if (yieldToBrowser?.shouldYield()) {
			await yieldToBrowser();
			assertMathCaptureCurrent(signal, isCurrent);
			capture.updateCoordinateEpoch(sourceRoot.getBoundingClientRect());
		}
	}
	assertMathCaptureCurrent(signal, isCurrent);
	const sealed = capture.seal();
	if (!sealed) throw new Error("wechat-math-static-flow-capture-missing");
	return mathCaptureResultFromSealed(sealed, rawDimensionGeometrySignature);
}

export function captureWechatMathSourceAdmissionSynchronously(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	enabled = true,
	signal?: AbortSignal,
	isCurrent?: () => boolean,
	rawDimensionGeometrySignature = "",
): WechatMathSourceCaptureResult {
	if (!enabled) return emptyMathSourceCaptureResult();
	const capture = createMathSourceCapture(sourceRoot, runtime);
	if (!capture) return emptyMathSourceCaptureResult();
	const elements = [
		sourceRoot,
		...Array.from(sourceRoot.querySelectorAll("*")),
	];
	elements.forEach((element) => {
		assertMathCaptureCurrent(signal, isCurrent);
		capture.observe(
			element,
			runtime.getComputedStyle(element),
			element.getBoundingClientRect(),
		);
	});
	assertMathCaptureCurrent(signal, isCurrent);
	const sealed = capture.seal();
	if (!sealed) throw new Error("wechat-math-static-flow-capture-missing");
	return mathCaptureResultFromSealed(sealed, rawDimensionGeometrySignature);
}

type MathStaticFlowPlan = ReturnType<typeof planWechatMathStaticFlow>;

type MathOmissionIndex = Readonly<{
	ends: ReadonlyMap<Element, number>;
	prefix: readonly number[];
	starts: ReadonlyMap<Element, number>;
}>;

function createMathOmissionIndex(
	preview: Element,
	cloneIdentity: ReadonlyMap<Element, Element>,
): MathOmissionIndex {
	const starts = new Map<Element, number>();
	const ends = new Map<Element, number>();
	const omittedFlags: boolean[] = [];
	const visit = (element: Element, inheritedOmission: boolean): void => {
		const start = omittedFlags.length;
		starts.set(element, start);
		const omitted =
			inheritedOmission ||
			HIDDEN_NODES.has(cloneIdentity.get(element) ?? element);
		omittedFlags.push(omitted);
		for (const child of Array.from(element.children)) visit(child, omitted);
		ends.set(element, omittedFlags.length);
	};
	visit(preview, false);
	const prefix = [0];
	for (const omitted of omittedFlags) {
		prefix.push((prefix[prefix.length - 1] ?? 0) + (omitted ? 1 : 0));
	}
	return { ends, prefix, starts };
}

function mathGroupHasOmittedClone(
	group: WechatMathSourceAdmissionResult["groups"][number],
	omissionIndex: MathOmissionIndex,
): boolean {
	const start = omissionIndex.starts.get(group.source);
	const end = omissionIndex.ends.get(group.source);
	return (
		undefined !== start &&
		undefined !== end &&
		omissionIndex.prefix[end] !== omissionIndex.prefix[start]
	);
}

export function createMathStaticFlowGate(
	conversion: WechatPngConversionContext | undefined,
	signal: AbortSignal | undefined,
	isCurrent: (() => boolean) | undefined,
): WechatMathStaticFlowGate {
	const gate: WechatMathStaticFlowGate = {
		isCancelled: () => Boolean(signal?.aborted || conversion?.signal.aborted),
		isCurrent: () =>
			Boolean(
				(!isCurrent || isCurrent()) &&
					(!conversion?.isCurrent || conversion.isCurrent()),
			),
	};
	const gateSignal = signal ?? conversion?.signal;
	return gateSignal ? { ...gate, signal: gateSignal } : gate;
}

export function bindMathStaticFlowPlan(
	preview: HTMLElement,
	clone: HTMLElement,
	runtime: WechatMathStaticFlowRuntime | null,
	sourceAdmission: WechatMathSourceAdmissionResult | null,
	sourceFingerprint: string,
	rawDimensionGeometrySignature: string,
	cloneIdentity: ReadonlyMap<Element, Element>,
	svgIntegration: WechatSvgPortableIntegration,
	conversion: WechatPngConversionContext | undefined,
	signal: AbortSignal | undefined,
	isCurrent: (() => boolean) | undefined,
	excludedSources: ReadonlySet<Element> = new Set(),
): MathStaticFlowPlan | null {
	if (
		!sourceAdmission ||
		!Array.isArray(sourceAdmission.groups) ||
		sourceAdmission.groups.length === 0
	)
		return null;
	if (sourceAdmission.sourceRoot !== preview) {
		throw new Error("wechat-math-static-flow-root-mismatch");
	}
	if (!runtime)
		throw new Error("wechat-math-static-flow-captured-runtime-missing");
	if (!sourceFingerprint)
		throw new Error("wechat-math-static-flow-source-fingerprint-missing");
	if (!rawDimensionGeometrySignature)
		throw new Error("wechat-math-static-flow-dimension-signature-missing");
	const gate = createMathStaticFlowGate(conversion, signal, isCurrent);
	const omissionIndex = createMathOmissionIndex(preview, cloneIdentity);
	const isExcludedVectorSource = (source: Element): boolean =>
		[...excludedSources].some(
			(excluded) => excluded === source || excluded.contains(source),
		);
	const boundGroups = sourceAdmission.groups.filter(
		(group) =>
			!isExcludedVectorSource(group.source) &&
			!mathGroupHasOmittedClone(group, omissionIndex),
	);
	if (!boundGroups.length) return null;
	const bindingSourceAdmission =
		boundGroups.length === sourceAdmission.groups.length
			? sourceAdmission
			: { ...sourceAdmission, groups: boundGroups };
	const snapshot = captureWechatMathStaticFlowSnapshot({
		cloneIdentityFor: (source) => {
			const target = cloneIdentity.get(source) ?? null;
			if (!target) return null;
			if (svgIntegration.sourceForClone(target) !== source) {
				throw new Error("wechat-math-static-flow-identity-mismatch");
			}
			return target;
		},
		cloneRoot: clone,
		gate,
		liveSourceAdmissionSignature: sourceFingerprint,
		rawDimensionGeometrySignature,
		runtime,
		sourceAdmission: bindingSourceAdmission,
		sourceRoot: preview,
	});
	return planWechatMathStaticFlow(snapshot, { gate });
}
