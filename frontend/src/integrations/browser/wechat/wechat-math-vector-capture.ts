import {
	hasVisualRasterizationAncestor,
	visualRasterizationKind,
} from "./wechat-clone-metadata";
import {
	codepointMap,
	codepoints,
	fontForText,
	getPairedText,
	isExactRendererStrut,
	sourceTextNodes,
	textStream,
	validateAtlas,
	verifyPairTree,
} from "./wechat-math-vector-capture-fonts";
import {
	rulePaints,
	svgFragmentsForOwner,
} from "./wechat-math-vector-capture-graphics";
import {
	allocationEdges,
	baselineRuns,
	computedGeometry,
	createInlineCaptureContext,
	directVisualRect,
} from "./wechat-math-vector-capture-layout";
import {
	assertReplacedDescendantMasks,
	captureError,
	type RunCapture,
	sourcePaintAdmitted,
	type WechatMathVectorAllocation,
	type WechatMathVectorCapturedScene,
	WechatMathVectorCaptureError,
	type WechatMathVectorCaptureErrorCode,
	type WechatMathVectorCaptureOptions,
} from "./wechat-math-vector-capture-primitives";
import type { WechatMathVectorFrozenScene } from "./wechat-math-vector-scene";
import {
	type AcquiredPreviewGeometryMeasurement,
	previewMeasurementLeaseSourceMatches,
	waitForPreviewMeasurement,
} from "./wechat-preview-geometry-cache";
import { assertCopyGuardCurrent } from "./wechat-source-freshness";

export {
	type WechatMathVectorAllocation,
	type WechatMathVectorCapturedScene,
	WechatMathVectorCaptureError,
	type WechatMathVectorCaptureErrorCode,
	type WechatMathVectorCaptureOptions,
};

function captureOwner(
	sourceOwner: Element,
	options: WechatMathVectorCaptureOptions,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
): WechatMathVectorCapturedScene {
	const measurementOwner = lease.measurementFor(sourceOwner);
	if (!measurementOwner || lease.sourceFor(measurementOwner) !== sourceOwner)
		throw captureError("pairing-invalid");
	verifyPairTree(lease, sourceOwner, measurementOwner);
	if (textStream(sourceOwner) !== textStream(measurementOwner))
		throw captureError("source-text-mismatch");
	assertReplacedDescendantMasks(measurementOwner, lease.root, options.runtime);
	const { ownerRect: ownerDomRect, visualRect } = directVisualRect(
		sourceOwner,
		measurementOwner,
		options.runtime,
	);
	const inline = createInlineCaptureContext(
		sourceOwner,
		measurementOwner,
		options.runtime,
		ownerDomRect,
		visualRect,
	);
	const visualTexts = sourceTextNodes(sourceOwner);
	const runs: RunCapture[] = [];
	let nonStrutVisualTextCount = 0;
	for (const sourceText of visualTexts) {
		const measurementText = getPairedText(lease, sourceText);
		if (isExactRendererStrut(sourceText, measurementText, lease)) continue;
		const textParent = measurementText.parentElement;
		if (!textParent) throw captureError("pairing-invalid");
		if (!sourcePaintAdmitted(textParent, lease.root, options.runtime)) continue;
		nonStrutVisualTextCount += 1;
		const font = fontForText(
			measurementText,
			lease.root,
			options.runtime,
			options.managedFaces,
			options.atlas,
		);
		const parent = measurementText.parentElement;
		if (!parent) throw captureError("pairing-invalid");
		const glyphs = codepoints(sourceText.data);
		const cmap = codepointMap(font.font);
		for (const item of glyphs)
			if (!cmap.has(item.codepoint)) throw captureError("glyph-missing");
		runs.push({
			fill: font.fill,
			font: font.font,
			fontFile: font.font.file,
			fontSize: font.fontSize,
			glyphs,
			measurementText,
			parent,
			sourceText,
		});
	}
	if (nonStrutVisualTextCount > 0 && !runs.length)
		throw captureError("baseline-invalid");
	const baselineCapture = baselineRuns(
		sourceOwner,
		measurementOwner,
		runs,
		visualRect,
		options.runtime,
		inline,
	);
	const geometry = computedGeometry(
		sourceOwner,
		measurementOwner,
		options.runtime,
		visualRect,
		ownerDomRect,
		inline,
		baselineCapture.inlineLayout,
	);
	const viewport = Object.freeze({
		height: visualRect.height,
		viewBox: visualRect,
		width: visualRect.width,
	});
	const scene: WechatMathVectorFrozenScene = Object.freeze({
		rulePaint: rulePaints(
			sourceOwner,
			measurementOwner,
			lease.root,
			options.runtime,
			ownerDomRect,
		),
		runs: baselineCapture.runs,
		svgFragments: svgFragmentsForOwner(
			sourceOwner,
			measurementOwner,
			lease,
			options.runtime,
			ownerDomRect,
		),
		viewport,
	});
	const allocation: WechatMathVectorAllocation = Object.freeze({
		edges: allocationEdges(sourceOwner, options.runtime),
		geometry,
		ownerRect: Object.freeze({
			height: ownerDomRect.height > 0 ? ownerDomRect.height : visualRect.height,
			width: ownerDomRect.width > 0 ? ownerDomRect.width : visualRect.width,
			x: 0,
			y: 0,
		}),
		visualRect,
		baselineHeight: baselineCapture.baselineHeight,
	});
	return Object.freeze({
		allocation,
		replacementShell: sourceOwner,
		scene,
		sourceOwner,
	});
}

function validateSourceOwner(
	owner: Element,
	preview: HTMLElement,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	seenOwners: Set<Element>,
	seenMeasurements: Set<Element>,
): void {
	if (
		!(owner instanceof Element) ||
		!preview.contains(owner) ||
		visualRasterizationKind(owner) !== "math" ||
		hasVisualRasterizationAncestor(owner)
	) {
		throw captureError("pairing-invalid");
	}
	if (seenOwners.has(owner)) throw captureError("pairing-invalid");
	for (const existing of seenOwners)
		if (existing.contains(owner) || owner.contains(existing))
			throw captureError("pairing-invalid");
	const measurement = lease.measurementFor(owner);
	if (!measurement || lease.sourceFor(measurement) !== owner)
		throw captureError("pairing-invalid");
	if (seenMeasurements.has(measurement)) throw captureError("pairing-invalid");
	for (const existing of seenMeasurements)
		if (existing.contains(measurement) || measurement.contains(existing))
			throw captureError("pairing-invalid");
	seenOwners.add(owner);
	seenMeasurements.add(measurement);
}

/**
 * Captures complete detached OFF-math vector scenes from one transferred hidden
 * measurement lease. All source/measurement geometry, fonts, paint and static
 * SVG records are frozen synchronously while the lease is live.
 */
async function captureWechatMathVectorScenesCore(
	options: WechatMathVectorCaptureOptions,
): Promise<readonly WechatMathVectorCapturedScene[]> {
	const { lease } = options.measurement;
	if (
		options.preview !== lease.sourceRoot ||
		lease.sourceGeometryReference !== "measurement"
	)
		throw captureError("pairing-invalid");
	const assertCurrent = (): void => {
		assertCopyGuardCurrent({
			signal: options.signal,
			isCurrent: options.isCurrent,
		});
		if (
			!previewMeasurementLeaseSourceMatches(
				lease,
				options.preview,
				options.runtime,
			)
		)
			throw new Error("wechat-copy-stale");
	};
	assertCurrent();
	if (!options.sourceOwners.length) return Object.freeze([]);
	await waitForPreviewMeasurement(lease.ready, options.signal);
	assertCurrent();
	if (!lease.isReady()) throw captureError("pairing-invalid");
	validateAtlas(options.atlas);
	const seenOwners = new Set<Element>();
	const seenMeasurements = new Set<Element>();
	for (const owner of options.sourceOwners)
		validateSourceOwner(
			owner,
			options.preview,
			lease,
			seenOwners,
			seenMeasurements,
		);
	const result = options.sourceOwners.map((owner) => {
		assertCurrent();
		return captureOwner(owner, options, lease);
	});
	assertCurrent();
	return Object.freeze(result);
}

/**
 * Captures from a measurement lease whose cleanup remains owned by the caller.
 * The caller must keep the lease alive through its final freshness checks and
 * release it exactly once after the complete serialization transaction.
 */
export function captureWechatMathVectorScenesWithBorrowedMeasurement(
	options: WechatMathVectorCaptureOptions,
): Promise<readonly WechatMathVectorCapturedScene[]> {
	return captureWechatMathVectorScenesCore(options);
}

/**
 * Captures and consumes one transferred measurement lease. Existing callers
 * retain this ownership contract; the borrowed entry is used by a surrounding
 * serialization transaction that must keep the lease through final checks.
 */
export async function captureWechatMathVectorScenes(
	options: WechatMathVectorCaptureOptions,
): Promise<readonly WechatMathVectorCapturedScene[]> {
	let cleaned = false;
	try {
		return await captureWechatMathVectorScenesCore(options);
	} finally {
		if (!cleaned) {
			cleaned = true;
			options.measurement.cleanup();
		}
	}
}
