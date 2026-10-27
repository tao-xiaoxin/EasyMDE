import type {
	PreviewEditMap,
	PreviewEditMapBlock,
} from "../../../contracts/ports/preview-request";
import {
	createPreviewWindowModel,
	type PreviewWindowBlock,
	type PreviewWindowContext,
	type PreviewWindowFlowGeometry,
	type PreviewWindowRange,
	type PreviewWindowResult,
	type PreviewWindowViewport,
} from "../model/preview-window-model";

export type PreviewWindowFlowMeasurement = Readonly<{
	geometry: PreviewWindowFlowGeometry;
	gapMeasured: boolean;
}>;

export type PreviewWindowFlowBoundary = Readonly<{
	epoch: string;
	first: HTMLElement;
	last: HTMLElement;
	origin: number;
	end: number;
}>;

export type PreviewWindowSpacerFlowReconciliation = Readonly<{
	desiredSpan: number;
	range: PreviewWindowResult["layoutRuns"][number]["range"];
	contentHeight: number;
}>;

export const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";
export const PREVIEW_WINDOW_SPACER_ATTRIBUTE =
	"data-easymde-preview-window-spacer";

type PreviewWindowRepositoryBlock = Readonly<{
	index: number;
	map: PreviewEditMapBlock;
	node: HTMLElement;
}>;

export type PreviewWindowNodeRepository = {
	blocks: ReadonlyArray<PreviewWindowRepositoryBlock>;
	ownedGap?: Readonly<{ node: HTMLElement; before: number; after: number | null }>;
	context: PreviewWindowContext;
	indexById: ReadonlyMap<string, number>;
	model: ReturnType<typeof createPreviewWindowModel>;
	nodes: ReadonlyArray<HTMLElement>;
	flowGeometry: PreviewWindowFlowGeometry[];
	flowGeometryEpoch: Array<string | null>;
	flowGapEpoch: Array<string | null>;
	flowGeometryUnknownRanges?: Array<{ end: number; start: number }>;
	flowGapUnknownRanges?: Array<{ end: number; start: number }>;
	flowBoundary: PreviewWindowFlowBoundary | null;
	spacerContentHeights: Map<
		string,
		Readonly<{ epoch: string; height: number }>
	>;
	spacers: Map<string, HTMLElement>;
};

type PreviewWindowUnknownRange = { end: number; start: number };

function unknownRanges(size: number): PreviewWindowUnknownRange[] {
	return size > 0 ? [{ end: size, start: 0 }] : [];
}

function markRangeKnown(
	ranges: PreviewWindowUnknownRange[] | undefined,
	index: number,
): void {
	if (!ranges) return;
	const rangeIndex = ranges.findIndex(
		(range) => index >= range.start && index < range.end,
	);
	if (rangeIndex < 0) return;
	const range = ranges[rangeIndex];
	if (!range) return;
	const replacement: PreviewWindowUnknownRange[] = [];
	if (range.start < index) replacement.push({ end: index, start: range.start });
	if (index + 1 < range.end)
		replacement.push({ end: range.end, start: index + 1 });
	ranges.splice(rangeIndex, 1, ...replacement);
}

function markRangeUnknown(
	ranges: PreviewWindowUnknownRange[] | undefined,
	index: number,
): void {
	if (!ranges) return;
	let start = index;
	let end = index + 1;
	let insertion = 0;
	while (insertion < ranges.length) {
		const range = ranges[insertion];
		if (!range || range.end >= start) break;
		insertion += 1;
	}
	while (insertion < ranges.length) {
		const range = ranges[insertion];
		if (!range || range.start > end) break;
		start = Math.min(start, range.start);
		end = Math.max(end, range.end);
		ranges.splice(insertion, 1);
	}
	ranges.splice(insertion, 0, { end, start });
}

function hasUnknownInRange(
	ranges: readonly PreviewWindowUnknownRange[] | undefined,
	values: readonly (string | null)[],
	epoch: string,
	range: PreviewWindowRange,
): boolean {
	if (ranges) {
		return ranges.some(
			(unknown) => unknown.start < range.end && unknown.end > range.start,
		);
	}
	for (let index = range.start; index < range.end; index += 1) {
		if (values[index] !== epoch) return true;
	}
	return false;
}

export function markPreviewWindowFlowGeometryMeasured(
	repository: PreviewWindowNodeRepository,
	index: number,
): void {
	markRangeKnown(repository.flowGeometryUnknownRanges, index);
}

export function markPreviewWindowFlowGapMeasured(
	repository: PreviewWindowNodeRepository,
	index: number,
): void {
	markRangeKnown(repository.flowGapUnknownRanges, index);
}

export function markPreviewWindowFlowGeometryUnknown(
	repository: PreviewWindowNodeRepository,
	index: number,
): void {
	markRangeUnknown(repository.flowGeometryUnknownRanges, index);
}

export function markPreviewWindowFlowGapUnknown(
	repository: PreviewWindowNodeRepository,
	index: number,
): void {
	markRangeUnknown(repository.flowGapUnknownRanges, index);
}

export class PreviewWindowDomError extends Error {
	constructor(code: string) {
		super(code);
		this.name = "PreviewWindowDomError";
	}
}

function fail(code: string): never {
	throw new PreviewWindowDomError(code);
}

function rootElements(surface: HTMLElement): HTMLElement[] {
	const roots: HTMLElement[] = [];
	for (const node of Array.from(surface.childNodes)) {
		if (node instanceof HTMLElement) {
			roots.push(node);
			continue;
		}
		if ("#text" === node.nodeName && (node.textContent ?? "").trim()) {
			fail("preview-window-root-text-invalid");
		}
		if (
			node.nodeType !== Node.COMMENT_NODE &&
			node.nodeType !== Node.TEXT_NODE
		) {
			fail("preview-window-root-node-invalid");
		}
	}
	return roots;
}

function validateBlockBinding(
	roots: readonly HTMLElement[],
	editMap: PreviewEditMap,
): void {
	if (roots.length !== editMap.blocks.length) {
		fail("preview-window-block-map-count-mismatch");
	}
	const ids = new Set<string>();
	roots.forEach((root, index) => {
		const expected = editMap.blocks[index];
		if (
			!expected ||
			root.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== expected.id
		) {
			fail("preview-window-block-map-marker-mismatch");
		}
		if (ids.has(expected.id)) fail("preview-window-block-map-duplicate");
		ids.add(expected.id);
	});
}

export function validatePreviewWindowMarkup(
	surface: HTMLElement,
	editMap: PreviewEditMap,
): void {
	if (1 !== editMap.version || "line" !== editMap.coordinate) {
		fail("preview-window-edit-map-invalid");
	}
	validateBlockBinding(rootElements(surface), editMap);
}

export function createPreviewWindowRepository(
	surface: HTMLElement,
	editMap: PreviewEditMap,
	context: PreviewWindowContext,
): PreviewWindowNodeRepository {
	if (
		1 !== editMap.version ||
		"line" !== editMap.coordinate ||
		editMap.signature !== context.signature
	) {
		fail("preview-window-edit-map-invalid");
	}
	const roots = rootElements(surface);
	validateBlockBinding(roots, editMap);
	editMap.blocks.forEach((block, index) => {
		if (!block.editable) roots[index]?.setAttribute("contenteditable", "false");
	});
	const blocks: PreviewWindowBlock[] = editMap.blocks.map((map) => ({
		id: map.id,
		startLine: map.startLine,
		endLine: map.endLine,
		editable: map.editable,
		measuredHeight: 24,
	}));
	const model = createPreviewWindowModel(blocks, context);
	const indexById = new Map<string, number>();
	editMap.blocks.forEach((block, index) => {
		indexById.set(block.id, index);
	});
	return {
		blocks: editMap.blocks.map((map, index) => ({
			index,
			map,
			node: roots[index] as HTMLElement,
		})),
		context,
		indexById,
		model,
		nodes: roots,
		flowGeometry: [...model.flowGeometries],
		flowGeometryEpoch: roots.map(() => null),
		flowGapEpoch: roots.map(() => null),
		flowGeometryUnknownRanges: unknownRanges(roots.length),
		flowGapUnknownRanges: unknownRanges(roots.length),
		flowBoundary: null,
		spacerContentHeights: new Map(),
		spacers: new Map(),
	};
}

export function previewWindowBlockIndexForNode(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	node: Node | null,
): number | null {
	let current = node;
	while (current && current !== surface) {
		if (current instanceof HTMLElement) {
			const id = current.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
			if (id) return repository.indexById.get(id) ?? null;
		}
		current = current.parentNode;
	}
	return null;
}

export function validatePreviewWindowRepository(
	repository: PreviewWindowNodeRepository,
): void {
	// The repository is detached after the staging candidate is removed, so
	// validate its node sequence without relying on a connected parent.
	if (repository.nodes.length !== repository.blocks.length) {
		fail("preview-window-repository-count-mismatch");
	}
	if (repository.flowGeometry.length !== repository.blocks.length) {
		fail("preview-window-flow-geometry-missing");
	}
	if (
		repository.flowGeometryEpoch.length !== repository.blocks.length ||
		repository.flowGapEpoch.length !== repository.blocks.length
	) {
		fail("preview-window-flow-epoch-missing");
	}
	for (const geometry of repository.flowGeometry) {
		if (
			!Number.isFinite(geometry.borderHeight) ||
			geometry.borderHeight < 0 ||
			!Number.isFinite(geometry.marginBefore) ||
			!Number.isFinite(geometry.marginAfter) ||
			!Number.isFinite(geometry.gapAfter) ||
			geometry.borderHeight + geometry.gapAfter < 0
		) {
			fail("preview-window-flow-geometry-invalid");
		}
	}
	repository.blocks.forEach((block, index) => {
		if (repository.nodes[index] !== block.node) {
			fail("preview-window-repository-order-invalid");
		}
		if (block.node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.map.id) {
			fail("preview-window-block-map-marker-mismatch");
		}
	});
}

function finiteCssLength(value: string | undefined, property: string): number {
	if (undefined === value || "" === value) {
		throw new PreviewWindowDomError(`preview-window-flow-${property}-invalid`);
	}
	if ("auto" === value) return 0;
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) {
		throw new PreviewWindowDomError(`preview-window-flow-${property}-invalid`);
	}
	return parsed;
}

function computedBlockMargin(
	style: CSSStyleDeclaration | null,
	logical: "marginBlockStart" | "marginBlockEnd",
	physical: "marginTop" | "marginBottom",
): number {
	if (!style) {
		throw new PreviewWindowDomError(`preview-window-flow-${logical}-invalid`);
	}
	const logicalValue = style[logical];
	return finiteCssLength(logicalValue || style[physical], logical);
}

function assertRepresentableFlowParent(node: HTMLElement): void {
	const parentStyle = node.parentElement
		? node.ownerDocument.defaultView?.getComputedStyle(node.parentElement)
		: null;
	if (!parentStyle) {
		throw new PreviewWindowDomError("preview-window-flow-parent-style-missing");
	}
	const display = parentStyle?.display ?? "";
	if (
		display.includes("flex") ||
		display.includes("grid") ||
		display.includes("table") ||
		(parentStyle?.columnCount &&
			!(
				"auto" === parentStyle.columnCount || "1" === parentStyle.columnCount
			)) ||
		(parentStyle?.writingMode && "horizontal-tb" !== parentStyle.writingMode) ||
		(parentStyle?.columnGap &&
			!(["0px", "normal", ""] as string[]).includes(parentStyle.columnGap)) ||
		(parentStyle?.rowGap &&
			!(["0px", "normal", ""] as string[]).includes(parentStyle.rowGap))
	) {
		throw new PreviewWindowDomError("preview-window-flow-gap-unrepresentable");
	}
}

/**
 * Measure only a connected root and an adjacent connected canonical neighbor.
 * When the neighbor is hidden behind a spacer, retain the last known signed
 * gap instead of pretending that the spacer is the next source block.
 */
export function measurePreviewWindowBlockGeometry(
	node: HTMLElement,
	nextNode: HTMLElement | null,
	previousGeometry: PreviewWindowFlowGeometry = {
		borderHeight: 24,
		marginBefore: 0,
		marginAfter: 0,
		gapAfter: 0,
	},
	ownedGap?: HTMLElement,
): PreviewWindowFlowMeasurement | null {
	if (!node.isConnected) {
		throw new PreviewWindowDomError("preview-window-flow-node-disconnected");
	}
	const rect = node.getBoundingClientRect();
	const style = node.ownerDocument.defaultView?.getComputedStyle(node) ?? null;
	const nextStyle =
		nextNode?.ownerDocument.defaultView?.getComputedStyle(nextNode) ?? null;
	assertRepresentableFlowParent(node);
	// A transformed root has no reliable layout coordinate in its client rect.
	// Preserve the last complete metric until the presentation transform ends.
	if (
		(style?.transform && "none" !== style.transform) ||
		(nextStyle?.transform && "none" !== nextStyle.transform)
	) {
		return null;
	}
	const borderHeight = rect.height;
	const marginBefore = computedBlockMargin(
		style,
		"marginBlockStart",
		"marginTop",
	);
	const marginAfter = computedBlockMargin(
		style,
		"marginBlockEnd",
		"marginBottom",
	);
	if (!Number.isFinite(borderHeight) || borderHeight < 0) {
		throw new PreviewWindowDomError("preview-window-flow-height-invalid");
	}
	if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) {
		throw new PreviewWindowDomError("preview-window-flow-position-invalid");
	}

	let gapAfter = previousGeometry.gapAfter;
	const canonicalNeighbor = Boolean(
		nextNode?.isConnected &&
			nextNode.parentNode === node.parentNode &&
			(node.nextElementSibling === nextNode || (ownedGap && node.nextElementSibling === ownedGap && ownedGap.nextElementSibling === nextNode)),
	);
	if (canonicalNeighbor) {
		const nextRect = nextNode?.getBoundingClientRect();
		if (
			!nextRect ||
			!Number.isFinite(rect.top) ||
			!Number.isFinite(nextRect.top) ||
			!Number.isFinite(rect.bottom)
		) {
			throw new PreviewWindowDomError("preview-window-flow-gap-invalid");
		}
		if (nextRect.top < rect.top) {
			throw new PreviewWindowDomError("preview-window-flow-nonmonotonic");
		}
		gapAfter = nextRect.top - rect.bottom;
		if (!Number.isFinite(gapAfter)) {
			throw new PreviewWindowDomError("preview-window-flow-gap-invalid");
		}
	}
	if (!Number.isFinite(gapAfter) || borderHeight + gapAfter < 0) {
		throw new PreviewWindowDomError("preview-window-flow-geometry-invalid");
	}
	return {
		geometry: { borderHeight, marginBefore, marginAfter, gapAfter },
		gapMeasured: canonicalNeighbor,
	};
}

export function resetPreviewWindowFlowGeometry(
	repository: PreviewWindowNodeRepository,
): void {
	repository.flowGeometry = [...repository.model.flowGeometries];
	repository.flowGeometryEpoch = repository.nodes.map(() => null);
	repository.flowGapEpoch = repository.nodes.map(() => null);
	if (repository.flowGeometryUnknownRanges) {
		repository.flowGeometryUnknownRanges.splice(
			0,
			repository.flowGeometryUnknownRanges.length,
			...unknownRanges(repository.nodes.length),
		);
	}
	if (repository.flowGapUnknownRanges) {
		repository.flowGapUnknownRanges.splice(
			0,
			repository.flowGapUnknownRanges.length,
			...unknownRanges(repository.nodes.length),
		);
	}
	repository.flowBoundary = null;
	repository.spacerContentHeights.clear();
	repository.spacers.clear();
}

function spacerRangeKey(
	range: PreviewWindowResult["layoutRuns"][number]["range"],
): string {
	return `${range.start}:${range.end}`;
}

function previewWindowGeometryEpochKey(context: PreviewWindowContext): string {
	return `${context.revision}:${context.signature}:${context.styleEpoch}:${context.widthEpoch}`;
}

function finiteRectValue(value: number, code: string): number {
	if (!Number.isFinite(value)) throw new PreviewWindowDomError(code);
	return value;
}

function hasPresentationTransform(node: HTMLElement): boolean {
	const style = node.ownerDocument.defaultView?.getComputedStyle(node);
	return Boolean(style?.transform && "none" !== style.transform);
}

function flowMeasurementTolerance(documentRef: Document): number {
	const devicePixelRatio = documentRef.defaultView?.devicePixelRatio ?? 1;
	return (
		1 / Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1)
	);
}

export function previewWindowFlowDocumentCoordinate(
	surface: HTMLElement,
	value: number,
	valueCode: string,
): number {
	const canvas = surface.parentElement;
	if (!(canvas instanceof HTMLElement)) {
		throw new PreviewWindowDomError("preview-window-flow-canvas-missing");
	}
	const canvasTop = finiteRectValue(
		canvas.getBoundingClientRect().top,
		"preview-window-flow-canvas-position-invalid",
	);
	const scrollTop = finiteRectValue(
		canvas.scrollTop,
		"preview-window-flow-scroll-position-invalid",
	);
	return finiteRectValue(value, valueCode) - canvasTop + scrollTop;
}

export function capturePreviewWindowFlowBoundary(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	epoch: string,
): void {
	if (repository.nodes.length < 1) {
		repository.flowBoundary = null;
		return;
	}
	const surfaceRect = surface.getBoundingClientRect();
	if (!Number.isFinite(surfaceRect.height) || surfaceRect.height <= 0) {
		repository.flowBoundary = null;
		return;
	}
	if (
		surface.children.length !== fullMaterializedNodes(repository).length ||
		!fullMaterializedNodes(repository).every(
			(node, index) =>
				surface.children[index] === node &&
				node.isConnected &&
				node.parentNode === surface &&
				!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE),
		)
	) {
		throw new PreviewWindowDomError(
			"preview-window-flow-boundary-sequence-invalid",
		);
	}
	const lastIndex = repository.nodes.length - 1;
	if (
		!repository.flowGeometryEpoch.every((value) => value === epoch) ||
		repository.flowGapEpoch.some(
			(value, index) => index !== lastIndex && value !== epoch,
		)
	) {
		throw new PreviewWindowDomError(
			"preview-window-flow-boundary-epoch-invalid",
		);
	}
	const first = repository.nodes[0];
	const last = repository.nodes[repository.nodes.length - 1];
	if (
		!first ||
		!last ||
		hasPresentationTransform(first) ||
		hasPresentationTransform(last)
	) {
		throw new PreviewWindowDomError("preview-window-flow-boundary-unmeasured");
	}
	const firstRect = first.getBoundingClientRect();
	const lastRect = last.getBoundingClientRect();
	const lastGeometry = repository.flowGeometry[repository.nodes.length - 1];
	if (!lastGeometry) {
		throw new PreviewWindowDomError("preview-window-flow-geometry-missing");
	}
	const origin = previewWindowFlowDocumentCoordinate(
		surface,
		firstRect.top,
		"preview-window-flow-origin-invalid",
	);
	const end = previewWindowFlowDocumentCoordinate(
		surface,
		surfaceRect.bottom,
		"preview-window-flow-end-invalid",
	);
	const lastBottom = previewWindowFlowDocumentCoordinate(
		surface,
		lastRect.bottom,
		"preview-window-flow-end-invalid",
	);
	const tailGap = end - lastBottom;
	if (!Number.isFinite(tailGap) || lastGeometry.borderHeight + tailGap < 0) {
		throw new PreviewWindowDomError("preview-window-flow-tail-invalid");
	}
	const lastGeometryWithTail = { ...lastGeometry, gapAfter: tailGap };
	repository.model.updateMeasuredHeight({
		anchorIndex: repository.nodes.length,
		context: repository.context,
		geometry: lastGeometryWithTail,
		index: lastIndex,
		measuredHeight: lastGeometry.borderHeight,
	});
	repository.flowGeometry[lastIndex] = lastGeometryWithTail;
	repository.flowGapEpoch[lastIndex] = epoch;
	markPreviewWindowFlowGapMeasured(repository, lastIndex);
	if (!Number.isFinite(origin) || !Number.isFinite(end)) {
		throw new PreviewWindowDomError("preview-window-flow-boundary-invalid");
	}
	repository.flowBoundary = {
		epoch,
		first,
		last,
		origin,
		end,
	};
}

/**
 * Advances the captured full-flow boundary by one measured block. A mounted
 * root-preserving edit changes content without a new geometry epoch, so the
 * measured delta is the only authority that can keep the boundary and the live
 * surface in the same coordinates before a spacer reconciliation compares them.
 */
export function advancePreviewWindowFlowBoundary(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	index: number,
	geometry: PreviewWindowFlowGeometry,
	delta: number,
	rect: DOMRect,
): void {
	const boundary = repository.flowBoundary;
	const node = repository.nodes[index];
	if (
		!boundary ||
		!node ||
		boundary.epoch !== previewWindowGeometryEpochKey(repository.context) ||
		!(
			boundary.first === node ||
			boundary.last === node ||
			index < repository.nodes.length - 1
		)
	)
		return;
	const origin =
		boundary.first === node
			? previewWindowFlowDocumentCoordinate(
					surface,
					rect.top,
					"preview-window-flow-origin-invalid",
				)
			: boundary.origin;
	const end =
		boundary.last === node
			? previewWindowFlowDocumentCoordinate(
					surface,
					rect.bottom,
					"preview-window-flow-end-invalid",
				) + geometry.gapAfter
			: boundary.end + delta;
	if (!Number.isFinite(origin) || !Number.isFinite(end)) {
		throw new PreviewWindowDomError("preview-window-flow-boundary-invalid");
	}
	repository.flowBoundary = { ...boundary, origin, end };
}

/**
 * Publishes the one measured-geometry transaction every window caller shares:
 * the measured model height, the advanced flow boundary, and the block/gap
 * epoch and known-range bookkeeping. Callers keep their own node/rect
 * validation, measurement, scheduling, error policy and anchor-correction
 * consumption; only this duplication of the repository transaction lives here.
 */
export function publishPreviewWindowMeasuredBlock(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	index: number,
	measurement: PreviewWindowFlowMeasurement,
	anchorIndex: number,
	rect: DOMRect,
): Readonly<{ anchorCorrection: number; delta: number; geometry: PreviewWindowFlowGeometry }> {
	const geometry = measurement.geometry;
	const update = repository.model.updateMeasuredHeight({
		anchorIndex,
		context: repository.context,
		geometry,
		index,
		measuredHeight: geometry.borderHeight,
	});
	advancePreviewWindowFlowBoundary(
		repository,
		surface,
		index,
		geometry,
		update.delta,
		rect,
	);
	const epoch = previewWindowGeometryEpochKey(repository.context);
	repository.spacerContentHeights.clear();
	repository.flowGeometry[index] = geometry;
	repository.flowGeometryEpoch[index] = epoch;
	markPreviewWindowFlowGeometryMeasured(repository, index);
	if (measurement.gapMeasured) {
		repository.flowGapEpoch[index] = epoch;
		markPreviewWindowFlowGapMeasured(repository, index);
	}
	return { anchorCorrection: update.anchorCorrection, delta: update.delta, geometry };
}

/**
 * Records one already-accepted root-preserving block edit in the window flow.
 * The caller owns the authenticated transition (repository identity, live
 * surface, canonical source, and selection are already verified); this only
 * records the measured geometry and advances the boundary that later spacer
 * reconciliation verifies against.
 */
export function measurePreviewWindowAdoptedBlock(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	index: number,
): void {
	const node = repository.nodes[index];
	const previousGeometry = repository.flowGeometry[index];
	if (
		!node ||
		!previousGeometry ||
		!node.isConnected ||
		node.parentNode !== surface
	)
		return;
	const rect = node.getBoundingClientRect();
	if (
		(!Number.isFinite(rect.height) || rect.height <= 0) &&
		node.offsetHeight <= 0
	)
		return;
	const measurement = measurePreviewWindowBlockGeometry(
		node,
		repository.nodes[index + 1] ?? null,
		previousGeometry,
		repository.ownedGap?.node,
	);
	if (!measurement) return;
	publishPreviewWindowMeasuredBlock(
		repository,
		surface,
		index,
		measurement,
		index,
		rect,
	);
}

function currentBlockSibling(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	node: Element | null,
): HTMLElement | null {
	if (!(node instanceof HTMLElement)) return null;
	if (node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)) return null;
	const index = previewWindowBlockIndexForNode(repository, surface, node);
	return null === index ? null : node;
}

function readSpacerRange(
	spacer: HTMLElement,
	repository: PreviewWindowNodeRepository,
): PreviewWindowResult["layoutRuns"][number]["range"] {
	const start = Number.parseInt(
		spacer.getAttribute("data-easymde-preview-window-start") ?? "",
		10,
	);
	const end = Number.parseInt(
		spacer.getAttribute("data-easymde-preview-window-end") ?? "",
		10,
	);
	if (
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		start < 0 ||
		end <= start ||
		end > repository.nodes.length
	) {
		throw new PreviewWindowDomError("preview-window-flow-spacer-range-invalid");
	}
	return { start, end };
}

export function reconcilePreviewWindowSpacerFlow(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	spacer: HTMLElement,
	epoch: string,
): PreviewWindowSpacerFlowReconciliation | null {
	if (
		!spacer.isConnected ||
		spacer.parentNode !== surface ||
		!spacer.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
	) {
		throw new PreviewWindowDomError("preview-window-flow-spacer-invalid");
	}
	const range = readSpacerRange(spacer, repository);
	const gapRange = {
		end: range.end,
		start: Math.max(0, range.start - 1),
	};
	if (
		hasUnknownInRange(
			repository.flowGeometryUnknownRanges,
			repository.flowGeometryEpoch,
			epoch,
			range,
		) ||
		hasUnknownInRange(
			repository.flowGapUnknownRanges,
			repository.flowGapEpoch,
			epoch,
			gapRange,
		)
	) {
		return null;
	}
	const previous = currentBlockSibling(
		repository,
		surface,
		spacer.previousElementSibling,
	);
	const next = currentBlockSibling(
		repository,
		surface,
		spacer.nextElementSibling,
	);
	if (spacer.previousElementSibling && !previous) {
		throw new PreviewWindowDomError(
			"preview-window-flow-spacer-neighbor-invalid",
		);
	}
	if (spacer.nextElementSibling && !next) {
		throw new PreviewWindowDomError(
			"preview-window-flow-spacer-neighbor-invalid",
		);
	}
	const previousIndex = previous
		? previewWindowBlockIndexForNode(repository, surface, previous)
		: null;
	const nextIndex = next
		? previewWindowBlockIndexForNode(repository, surface, next)
		: null;
	if (
		(previous && previousIndex !== range.start - 1) ||
		(next && nextIndex !== range.end)
	) {
		throw new PreviewWindowDomError(
			"preview-window-flow-spacer-neighbor-invalid",
		);
	}
	if (
		(previous && hasPresentationTransform(previous)) ||
		(next && hasPresentationTransform(next))
	) {
		throw new PreviewWindowDomError("preview-window-flow-transform-unmeasured");
	}
	const boundary = repository.flowBoundary;
	if ((!previous || !next) && (!boundary || boundary.epoch !== epoch))
		return null;
	const spanInside =
		repository.model.getPrefixHeight(range.end, repository.context) -
		repository.model.getPrefixHeight(range.start, repository.context);
	const precedingGap =
		range.start > 0 ? repository.flowGeometry[range.start - 1]?.gapAfter : 0;
	const trailingGap = !next
		? repository.flowGeometry[range.end - 1]?.gapAfter
		: 0;
	if (undefined === precedingGap) {
		throw new PreviewWindowDomError("preview-window-flow-geometry-missing");
	}
	if (undefined === trailingGap) {
		throw new PreviewWindowDomError("preview-window-flow-geometry-missing");
	}
	const desiredSpan = spanInside + precedingGap;
	if (!Number.isFinite(desiredSpan) || desiredSpan < 0) {
		throw new PreviewWindowDomError("preview-window-flow-span-invalid");
	}
	const spacerRect = spacer.getBoundingClientRect();
	const spacerTop = finiteRectValue(
		spacerRect.top,
		"preview-window-flow-spacer-position-invalid",
	);
	const spacerBottom = finiteRectValue(
		spacerRect.bottom,
		"preview-window-flow-spacer-position-invalid",
	);
	const spacerTopInDocument =
		!previous || !next
			? previewWindowFlowDocumentCoordinate(
					surface,
					spacerTop,
					"preview-window-flow-spacer-position-invalid",
				)
			: spacerTop;
	const spacerBottomInDocument =
		!previous || !next
			? previewWindowFlowDocumentCoordinate(
					surface,
					spacerBottom,
					"preview-window-flow-spacer-position-invalid",
				)
			: spacerBottom;
	const installedSurfaceEndInDocument = !next
		? previewWindowFlowDocumentCoordinate(
				surface,
				finiteRectValue(
					surface.getBoundingClientRect().bottom,
					"preview-window-flow-surface-end-invalid",
				),
				"preview-window-flow-surface-end-invalid",
			)
		: null;
	const gin = previous
		? spacerTop -
			finiteRectValue(
				previous.getBoundingClientRect().bottom,
				"preview-window-flow-boundary-invalid",
			)
		: spacerTopInDocument - (boundary?.origin ?? 0);
	const gout = next
		? finiteRectValue(
				next.getBoundingClientRect().top,
				"preview-window-flow-boundary-invalid",
			) - spacerBottom
		: (installedSurfaceEndInDocument ?? boundary?.end ?? 0) -
			spacerBottomInDocument;
	const contentHeight = desiredSpan - gin - gout;
	if (!Number.isFinite(contentHeight) || contentHeight < 0) {
		throw new PreviewWindowDomError(
			"preview-window-flow-spacer-height-invalid",
		);
	}
	spacer.style.blockSize = `${contentHeight}px`;
	const verifiedRect = spacer.getBoundingClientRect();
	const usesDocumentCoordinates = !previous || !next;
	const verifiedSurfaceEndInDocument = !next
		? previewWindowFlowDocumentCoordinate(
				surface,
				finiteRectValue(
					surface.getBoundingClientRect().bottom,
					"preview-window-flow-surface-end-invalid",
				),
				"preview-window-flow-surface-end-invalid",
			)
		: null;
	const verifiedCoordinate = (value: number, code: string): number =>
		usesDocumentCoordinates
			? previewWindowFlowDocumentCoordinate(surface, value, code)
			: finiteRectValue(value, code);
	const verifiedPreviousBottom = previous
		? verifiedCoordinate(
				previous.getBoundingClientRect().bottom,
				"preview-window-flow-boundary-invalid",
			)
		: (boundary?.origin ?? 0);
	const verifiedNextTop = next
		? verifiedCoordinate(
				next.getBoundingClientRect().top,
				"preview-window-flow-boundary-invalid",
			)
		: (verifiedSurfaceEndInDocument ?? boundary?.end ?? 0);
	const verifiedSpan =
		verifiedCoordinate(
			verifiedRect.top,
			"preview-window-flow-spacer-position-invalid",
		) -
		verifiedPreviousBottom +
		verifiedRect.height +
		verifiedNextTop -
		verifiedCoordinate(
			verifiedRect.bottom,
			"preview-window-flow-spacer-position-invalid",
		);
	if (
		!next &&
		boundary &&
		Math.abs((verifiedSurfaceEndInDocument ?? boundary.end) - boundary.end) >
			flowMeasurementTolerance(surface.ownerDocument)
	) {
		throw new PreviewWindowDomError(
			"preview-window-flow-boundary-verification-failed",
		);
	}
	if (
		!next &&
		boundary &&
		Math.abs(
			(verifiedSurfaceEndInDocument ?? boundary.end) -
				previewWindowFlowDocumentCoordinate(
					surface,
					verifiedRect.bottom,
					"preview-window-flow-spacer-position-invalid",
				) -
				trailingGap,
		) > flowMeasurementTolerance(surface.ownerDocument)
	) {
		throw new PreviewWindowDomError(
			"preview-window-flow-boundary-verification-failed",
		);
	}
	if (
		!Number.isFinite(verifiedSpan) ||
		Math.abs(verifiedSpan - desiredSpan) >
			flowMeasurementTolerance(surface.ownerDocument)
	) {
		throw new PreviewWindowDomError(
			"preview-window-flow-span-verification-failed",
		);
	}
	return { contentHeight, desiredSpan, range };
}

function spacerKey(
	range: PreviewWindowResult["layoutRuns"][number]["range"],
	height: number,
	marginBefore: number,
	marginAfter: number,
): string {
	return `${range.start}:${range.end}:${height}:${marginBefore}:${marginAfter}`;
}

function createSpacer(
	documentRef: Document,
	range: PreviewWindowResult["layoutRuns"][number]["range"],
	height: number,
	marginBefore: number,
	marginAfter: number,
): HTMLElement {
	const spacer = documentRef.createElement("div");
	spacer.setAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE, "1");
	spacer.setAttribute("aria-hidden", "true");
	spacer.contentEditable = "false";
	spacer.style.padding = "0";
	spacer.style.border = "0";
	declareSpacerFlow(spacer, range, height, marginBefore, marginAfter);
	return spacer;
}

/**
 * Declares the range and flow height a spacer currently stands for. Consuming a
 * spacer while it materializes shrinks these declarations in place, so a cached
 * spacer can outlive the run it was created for; re-declaring it before reuse is
 * what keeps an installed spacer's declared range equal to its mounted neighbors.
 */
function declareSpacerFlow(
	spacer: HTMLElement,
	range: PreviewWindowResult["layoutRuns"][number]["range"],
	height: number,
	marginBefore: number,
	marginAfter: number,
): void {
	spacer.setAttribute("data-easymde-preview-window-start", String(range.start));
	spacer.setAttribute("data-easymde-preview-window-end", String(range.end));
	spacer.style.blockSize = `${height}px`;
	spacer.style.marginBlockStart = `${marginBefore}px`;
	spacer.style.marginBlockEnd = `${marginAfter}px`;
}

function spacerFor(
	repository: PreviewWindowNodeRepository,
	range: PreviewWindowResult["layoutRuns"][number]["range"],
	height: number,
	marginBefore: number,
	marginAfter: number,
): HTMLElement {
	const key = spacerKey(range, height, marginBefore, marginAfter);
	const existing = repository.spacers.get(key);
	if (existing) {
		declareSpacerFlow(existing, range, height, marginBefore, marginAfter);
		return existing;
	}
	const documentRef = repository.nodes[0]?.ownerDocument;
	if (!documentRef) fail("preview-window-repository-empty");
	const spacer = createSpacer(
		documentRef,
		range,
		height,
		marginBefore,
		marginAfter,
	);
	repository.spacers.set(key, spacer);
	return spacer;
}

export function windowNodes(
	repository: PreviewWindowNodeRepository,
	result: PreviewWindowResult,
): ReadonlyArray<Node> {
	const nodes: Node[] = [];
	for (const run of result.layoutRuns) {
		if ("spacer" === run.kind) {
			const override = repository.spacerContentHeights.get(
				spacerRangeKey(run.range),
			);
			const height =
				override?.epoch === previewWindowGeometryEpochKey(repository.context)
					? override.height
					: run.height;
			nodes.push(
				spacerFor(
					repository,
					run.range,
					height,
					run.marginBefore,
					run.marginAfter,
				),
			);
			continue;
		}
		for (let index = run.range.start; index < run.range.end; index += 1) {
			const node = repository.nodes[index];
			if (!node) fail("preview-window-repository-order-invalid");
			if (repository.ownedGap?.after === index) nodes.push(repository.ownedGap.node);
			nodes.push(node);
		}
	}
	if (repository.ownedGap?.after === null) {
		nodes.push(repository.ownedGap.node);
	}
	return nodes;
}

export function fullMaterializedNodes(
	repository: PreviewWindowNodeRepository,
): ReadonlyArray<HTMLElement> {
	const nodes = repository.nodes.flatMap((node, index) => repository.ownedGap?.after === index ? [repository.ownedGap.node, node] : [node]);
	return repository.ownedGap?.after === null
		? [...nodes, repository.ownedGap.node]
		: nodes;
}

export function viewportForCanvas(canvas: HTMLElement): PreviewWindowViewport {
	const rect = canvas.getBoundingClientRect();
	const height = canvas.clientHeight > 0 ? canvas.clientHeight : rect.height;
	return {
		scrollTop: Math.max(0, canvas.scrollTop),
		height: Math.max(0, Number.isFinite(height) ? height : 0),
	};
}
