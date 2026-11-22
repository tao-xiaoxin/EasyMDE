import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from "../../../contracts/visual-markdown-read-only";
import { markdownLineStarts } from "../../../shared/markdown/markdown-line-model";
import {
	ACCEPTED_WINDOW_BASELINE_SHIFT_COMPACTION_LIMIT,
	type AcceptedWindowBaseBlockRecord,
	type AcceptedWindowBaseline,
	type AcceptedWindowBlockBaseline,
	type AcceptedWindowBlockOverride,
	type AcceptedWindowRangeShift,
	type AcceptedWindowSourceRange,
	type PendingWindowFlowAnchor,
	type PreviewAcceptedWindowSnapshot,
	type PreviewHtmlState,
	type PreviewSourceSnapshot,
	previewWindowGeometryEpochKey,
} from "./preview-surface-types";
import {
	fullMaterializedNodes,
	PREVIEW_WINDOW_SPACER_ATTRIBUTE,
	PreviewWindowDomError,
	type PreviewWindowNodeRepository,
	previewWindowBlockIndexForNode,
	previewWindowFlowDocumentCoordinate,
	VISUAL_BLOCK_ATTRIBUTE,
	validatePreviewWindowRepository,
	validatePreviewWindowRepositoryBlock,
	validatePreviewWindowRepositoryHeader,
} from "./preview-window-dom";

export function hasPreviewWindowLayoutBox(
	node: HTMLElement,
	rect: DOMRect,
): boolean {
	const hasPositiveHeight =
		(Number.isFinite(rect.height) && rect.height > 0) || node.offsetHeight > 0;
	return (
		hasPositiveHeight ||
		(Number.isFinite(rect.width) && rect.width > 0) ||
		node.offsetWidth > 0 ||
		node.getClientRects().length > 0
	);
}

export function hasMeasuredMountedPreviewWindowGeometry(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	anchor?: PendingWindowFlowAnchor,
): boolean {
	const epoch = previewWindowGeometryEpochKey(repository.context);
	const anchorIndex = anchor
		? previewWindowBlockIndexForNode(repository, surface, anchor.node)
		: null;
	if (0 === anchorIndex) return true;
	for (const child of Array.from(surface.children)) {
		if (child.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)) continue;
		if (child === repository.ownedGap?.node) continue;
		const index = previewWindowBlockIndexForNode(repository, surface, child);
		if (null !== anchorIndex && null !== index && index > anchorIndex) break;
		if (null === index || repository.flowGeometryEpoch[index] !== epoch) {
			return false;
		}
	}
	return true;
}

export function verifyPreviewWindowFlowAnchor(
	surface: HTMLElement,
	anchor: PendingWindowFlowAnchor,
): void {
	if (!anchor.node.isConnected) return;
	const currentTop = anchor.node.getBoundingClientRect().top;
	const currentDocumentTop = previewWindowFlowDocumentCoordinate(
		surface,
		currentTop,
		"preview-window-flow-anchor-invalid",
	);
	const devicePixelRatio =
		surface.ownerDocument.defaultView?.devicePixelRatio ?? 1;
	const tolerance =
		1 / Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
	if (Math.abs(currentDocumentTop - anchor.documentTop) > tolerance) {
		throw new PreviewWindowDomError(
			"preview-window-flow-anchor-verification-failed",
		);
	}
}

export function hasExactSurfaceChildren(
	surface: HTMLElement,
	nodes: ReadonlyArray<Node>,
): boolean {
	if (surface.childNodes.length !== nodes.length) return false;
	return nodes.every((node, index) => surface.childNodes[index] === node);
}

export function isFullMaterializedWindowSurface(
	surface: HTMLElement,
	repository: PreviewWindowNodeRepository,
): boolean {
	if (!surface.isConnected) return false;
	const roots: HTMLElement[] = [];
	for (const node of Array.from(surface.childNodes)) {
		if (node instanceof HTMLElement) {
			roots.push(node);
			continue;
		}
		if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) {
			return false;
		}
		if (
			node.nodeType !== Node.COMMENT_NODE &&
			node.nodeType !== Node.TEXT_NODE
		) {
			return false;
		}
	}
	return (
		roots.length === fullMaterializedNodes(repository).length &&
		fullMaterializedNodes(repository).every(
			(node, index) =>
				roots[index] === node &&
				node.isConnected &&
				!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE) &&
				node.parentNode === surface,
		)
	);
}

export function createAcceptedWindowSnapshot(
	surface: HTMLElement,
	repository: PreviewWindowNodeRepository,
	commit: Readonly<{
		key: number;
		nodes: ReadonlyArray<Node>;
		revision: number;
	}>,
	state: PreviewHtmlState,
	baseline: AcceptedWindowBaseline | null,
): PreviewAcceptedWindowSnapshot | null {
	if (
		!baseline ||
		baseline.revision !== state.htmlRevision ||
		baseline.signature !== state.signature ||
		!hasExactSurfaceChildren(surface, commit.nodes) ||
		commit.revision !== state.htmlRevision ||
		commit.revision !== state.generation ||
		commit.nodes.length !== surface.childNodes.length
	)
		return null;
	try {
		validatePreviewWindowRepositoryHeader(repository);
	} catch {
		return null;
	}
	const ownedGap = repository.ownedGap?.node ?? null;
	// A certified gap is presentation of this exact commit. Omitting it from the
	// installed child sequence while still publishing it as owned would describe
	// a DOM the sink never wrote.
	if (ownedGap && !commit.nodes.includes(ownedGap)) return null;
	const blocks = commit.nodes.flatMap((node) => {
		if (node === ownedGap) return [];
		if (
			!(node instanceof HTMLElement) ||
			node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
		)
			return [];
		const id = node.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
		const index = id ? repository.indexById.get(id) : undefined;
		if (undefined === index) return [null];
		try {
			validatePreviewWindowRepositoryBlock(repository, index);
		} catch {
			return [null];
		}
		const entry = repository.blocks[index];
		const accepted = entry
			? readAcceptedWindowBaselineBlock(baseline, entry.node)
			: null;
		if (
			!entry ||
			entry.node !== node ||
			!accepted ||
			accepted.id !== entry.map.id
		) {
			return [null];
		}
		return [
			Object.freeze({
				id: entry.map.id,
				innerHTML: accepted.innerHTML,
				node: entry.node,
			}),
		];
	});
	if (blocks.some((block) => null === block)) return null;
	return Object.freeze({
		blocks: Object.freeze(
			blocks as Array<{
				id: string;
				innerHTML: string;
				node: HTMLElement;
			}>,
		),
		key: commit.key,
		nodes: Object.freeze([...commit.nodes]),
		...(baseline.sourceMapCurrent && state.editMap
			? { editMap: state.editMap }
			: {}),
		...(baseline.sourceRevision !== null
			? { sourceRevision: baseline.sourceRevision }
			: {}),
		...(ownedGap ? { ownedGap } : {}),
		revision: commit.revision,
		signature: state.signature,
	});
}

export function certifiedTextTailGapSlice(
	gapSlice: string,
	tightAdjacent: boolean,
): boolean {
	if (/^[\r\n]{2,}$/u.test(gapSlice)) return true;
	return tightAdjacent && /^[\r\n]?$/u.test(gapSlice);
}

export function markVisualProtectedNodesReadOnly(
	roots: ReadonlyArray<HTMLElement>,
): void {
	for (const root of roots) {
		if (
			root.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR) &&
			!root.hasAttribute("contenteditable")
		) {
			root.setAttribute("contenteditable", "false");
		}
		const nested = root.querySelectorAll(VISUAL_MARKDOWN_READ_ONLY_SELECTOR);
		for (let index = 0; index < nested.length; index += 1) {
			const candidate = nested[index];
			if (
				candidate instanceof HTMLElement &&
				!candidate.hasAttribute("contenteditable")
			) {
				candidate.setAttribute("contenteditable", "false");
			}
		}
	}
}

function stringsEqualRange(
	left: string,
	leftStart: number,
	right: string,
	rightStart: number,
	length: number,
): boolean {
	if (length <= 0) return true;
	if (left === right && leftStart === rightStart) return true;
	if (
		leftStart < 0 ||
		rightStart < 0 ||
		leftStart + length > left.length ||
		rightStart + length > right.length
	) {
		return false;
	}
	if (
		left.charCodeAt(leftStart) !== right.charCodeAt(rightStart) ||
		left.charCodeAt(leftStart + length - 1) !==
			right.charCodeAt(rightStart + length - 1)
	) {
		return false;
	}
	for (let offset = 1; offset < length - 1; offset += 1) {
		if (
			left.charCodeAt(leftStart + offset) !==
			right.charCodeAt(rightStart + offset)
		) {
			return false;
		}
	}
	return true;
}

function captureNodeBaselineSnapshot(
	node: HTMLElement,
): Readonly<{ innerHTML: string; rootSnapshot: HTMLElement }> | null {
	const rootSnapshot = node.cloneNode(false);
	if (!(rootSnapshot instanceof HTMLElement)) return null;
	return {
		innerHTML: node.innerHTML,
		rootSnapshot,
	};
}

function ensureBaseBlockCaptured(
	record: AcceptedWindowBaseBlockRecord,
): Readonly<{ innerHTML: string; rootSnapshot: HTMLElement }> | null {
	if (null !== record.innerHTML && null !== record.rootSnapshot) {
		return {
			innerHTML: record.innerHTML,
			rootSnapshot: record.rootSnapshot,
		};
	}
	const captured = captureNodeBaselineSnapshot(record.node);
	if (!captured) return null;
	record.innerHTML = captured.innerHTML;
	record.rootSnapshot = captured.rootSnapshot;
	return captured;
}

function applyBaselineRangeShifts(
	range: AcceptedWindowSourceRange | null,
	shifts: ReadonlyArray<AcceptedWindowRangeShift>,
	fromIndex: number,
): AcceptedWindowSourceRange | null {
	if (!range || fromIndex >= shifts.length) return range;
	let start = range.start;
	let end = range.end;
	for (let index = fromIndex; index < shifts.length; index += 1) {
		const shift = shifts[index];
		if (!shift || 0 === shift.delta) continue;
		if (start >= shift.at) {
			start += shift.delta;
			end += shift.delta;
		}
	}
	return start === range.start && end === range.end ? range : { start, end };
}

export function pinAcceptedWindowBaselineNodes(
	baseline: AcceptedWindowBaseline | null,
	nodes: ReadonlyArray<Node>,
): void {
	if (!baseline) return;
	for (const node of nodes) {
		if (!(node instanceof HTMLElement)) continue;
		const baseRecord = baseline.base.blocksByNode.get(node);
		if (!baseRecord || baseline.overridesById.has(baseRecord.id)) continue;
		ensureBaseBlockCaptured(baseRecord);
	}
}

export function readAcceptedWindowBaselineBlock(
	baseline: AcceptedWindowBaseline | null,
	node: HTMLElement,
): AcceptedWindowBlockBaseline | null {
	if (!baseline) return null;
	const override = baseline.overridesByNode.get(node);
	if (override) {
		const sourceRange = applyBaselineRangeShifts(
			override.sourceRange,
			baseline.shifts,
			override.shiftIndex,
		);
		if (sourceRange === override.sourceRange) {
			return override;
		}
		return Object.freeze({
			id: override.id,
			innerHTML: override.innerHTML,
			node: override.node,
			rootSnapshot: override.rootSnapshot,
			sourceRange,
		});
	}
	const baseRecord = baseline.base.blocksByNode.get(node);
	if (!baseRecord || baseline.overridesById.has(baseRecord.id)) {
		return null;
	}
	const captured = ensureBaseBlockCaptured(baseRecord);
	if (!captured) return null;
	const sourceRange = applyBaselineRangeShifts(
		baseRecord.sourceRange,
		baseline.shifts,
		0,
	);
	return Object.freeze({
		id: baseRecord.id,
		innerHTML: captured.innerHTML,
		node: baseRecord.node,
		rootSnapshot: captured.rootSnapshot,
		sourceRange,
	});
}

export function readAcceptedWindowBaselineRange(
	baseline: AcceptedWindowBaseline,
	id: string,
	node: HTMLElement,
): AcceptedWindowSourceRange | null {
	const overrideByNode = baseline.overridesByNode.get(node);
	if (overrideByNode) {
		return applyBaselineRangeShifts(
			overrideByNode.sourceRange,
			baseline.shifts,
			overrideByNode.shiftIndex,
		);
	}
	const baseByNode = baseline.base.blocksByNode.get(node);
	if (baseByNode && !baseline.overridesById.has(baseByNode.id)) {
		return applyBaselineRangeShifts(baseByNode.sourceRange, baseline.shifts, 0);
	}
	const overrideById = baseline.overridesById.get(id);
	if (overrideById) {
		return applyBaselineRangeShifts(
			overrideById.sourceRange,
			baseline.shifts,
			overrideById.shiftIndex,
		);
	}
	const baseNode = baseline.base.nodeById.get(id);
	const baseById = baseNode ? baseline.base.blocksByNode.get(baseNode) : null;
	if (!baseById) return null;
	return applyBaselineRangeShifts(baseById.sourceRange, baseline.shifts, 0);
}

function compactAcceptedWindowBaseline(
	baseline: AcceptedWindowBaseline,
): AcceptedWindowBaseline {
	const blocksByNode = new Map<HTMLElement, AcceptedWindowBaseBlockRecord>();
	const nodeById = new Map<string, HTMLElement>();
	for (const [baseNode, record] of baseline.base.blocksByNode) {
		if (baseline.overridesById.has(record.id)) continue;
		const shiftedRange = applyBaselineRangeShifts(
			record.sourceRange,
			baseline.shifts,
			0,
		);
		blocksByNode.set(baseNode, {
			id: record.id,
			innerHTML: record.innerHTML,
			node: record.node,
			rootSnapshot: record.rootSnapshot,
			sourceRange: shiftedRange,
		});
		nodeById.set(record.id, baseNode);
	}
	for (const override of baseline.overridesById.values()) {
		const shiftedRange = applyBaselineRangeShifts(
			override.sourceRange,
			baseline.shifts,
			override.shiftIndex,
		);
		blocksByNode.set(override.node, {
			id: override.id,
			innerHTML: override.innerHTML,
			node: override.node,
			rootSnapshot: override.rootSnapshot,
			sourceRange: shiftedRange,
		});
		nodeById.set(override.id, override.node);
	}
	return Object.freeze({
		...baseline,
		base: Object.freeze({ blocksByNode, nodeById }),
		lastEditedBlockId: null,
		overridesById: new Map(),
		overridesByNode: new Map(),
		shifts: Object.freeze([]),
	});
}

export function captureAcceptedWindowBaseline(
	repository: PreviewWindowNodeRepository,
	revision: number,
	signature: string,
	markdown?: string | null,
	sourceRevision: number | null = null,
): AcceptedWindowBaseline | null {
	try {
		validatePreviewWindowRepository(repository);
	} catch {
		return null;
	}
	markVisualProtectedNodesReadOnly(repository.nodes);
	const blocksByNode = new Map<HTMLElement, AcceptedWindowBaseBlockRecord>();
	const nodeById = new Map<string, HTMLElement>();
	const starts = null != markdown ? markdownLineStarts(markdown) : null;
	for (const entry of repository.blocks) {
		blocksByNode.set(entry.node, {
			id: entry.map.id,
			innerHTML: null,
			node: entry.node,
			rootSnapshot: null,
			sourceRange:
				starts && null != markdown
					? {
							start: starts[entry.map.startLine] ?? markdown.length,
							end: starts[entry.map.endLine] ?? markdown.length,
						}
					: null,
		});
		nodeById.set(entry.map.id, entry.node);
	}
	return Object.freeze({
		base: Object.freeze({ blocksByNode, nodeById }),
		lastEditedBlockId: null,
		markdown: markdown ?? null,
		overridesById: new Map(),
		overridesByNode: new Map(),
		revision,
		shifts: Object.freeze([]),
		signature,
		sourceMapCurrent: true,
		sourceRevision,
	});
}

export function extendAcceptedWindowBaseline(
	baseline: AcceptedWindowBaseline,
	id: string,
	node: HTMLElement,
	sourceSnapshot: PreviewSourceSnapshot | null = null,
): AcceptedWindowBaseline {
	const captured = captureNodeBaselineSnapshot(node);
	if (!captured) {
		throw new PreviewWindowDomError("preview-window-baseline-capture-failed");
	}
	const previousRange = readAcceptedWindowBaselineRange(baseline, id, node);
	let markdown = baseline.markdown;
	let sourceRevision = baseline.sourceRevision;
	let changedRange = previousRange;
	let delta = 0;
	if (
		sourceSnapshot &&
		markdown !== null &&
		previousRange &&
		sourceSnapshot.value !== markdown
	) {
		delta = sourceSnapshot.value.length - markdown.length;
		const end = previousRange.end + delta;
		if (
			end < previousRange.start ||
			!stringsEqualRange(
				sourceSnapshot.value,
				0,
				markdown,
				0,
				previousRange.start,
			) ||
			!stringsEqualRange(
				sourceSnapshot.value,
				end,
				markdown,
				previousRange.end,
				markdown.length - previousRange.end,
			)
		) {
			throw new PreviewWindowDomError(
				"preview-window-local-source-witness-stale",
			);
		}
		changedRange = { start: previousRange.start, end };
		markdown = sourceSnapshot.value;
		sourceRevision = sourceSnapshot.revision;
	} else if (sourceSnapshot && sourceSnapshot.value === markdown) {
		sourceRevision = sourceSnapshot.revision;
	}
	let shifts = baseline.shifts;
	if (0 !== delta && previousRange && changedRange) {
		const lastShift = shifts[shifts.length - 1];
		if (
			lastShift &&
			baseline.lastEditedBlockId === id &&
			lastShift.sourceBlockId === id &&
			lastShift.sourceStart === previousRange.start &&
			lastShift.sourceEnd === previousRange.end &&
			lastShift.sourceEnd > lastShift.sourceStart
		) {
			const nextShifts = shifts.slice(0, -1);
			nextShifts.push(
				Object.freeze({
					at: lastShift.at,
					delta: lastShift.delta + delta,
					sourceBlockId: id,
					sourceEnd: changedRange.end,
					sourceStart: lastShift.sourceStart,
				}),
			);
			shifts = Object.freeze(nextShifts);
		} else {
			shifts = Object.freeze([
				...shifts,
				Object.freeze({
					at: previousRange.end,
					delta,
					sourceBlockId: id,
					sourceEnd: changedRange.end,
					sourceStart: previousRange.start,
				}),
			]);
		}
	}
	const overridesById = new Map(baseline.overridesById);
	const overridesByNode = new Map(baseline.overridesByNode);
	const existingById = overridesById.get(id);
	if (existingById && existingById.node !== node) {
		overridesByNode.delete(existingById.node);
	}
	const existingByNode = overridesByNode.get(node);
	if (existingByNode && existingByNode.id !== id) {
		overridesById.delete(existingByNode.id);
	}
	const nextOverride: AcceptedWindowBlockOverride = Object.freeze({
		id,
		innerHTML: captured.innerHTML,
		node,
		rootSnapshot: captured.rootSnapshot,
		shiftIndex: shifts.length,
		sourceRange: changedRange,
	});
	overridesById.set(id, nextOverride);
	overridesByNode.set(node, nextOverride);
	const nextBaseline: AcceptedWindowBaseline = Object.freeze({
		...baseline,
		lastEditedBlockId: id,
		markdown,
		overridesById,
		overridesByNode,
		shifts,
		sourceMapCurrent:
			baseline.sourceMapCurrent && markdown === baseline.markdown,
		sourceRevision,
	});
	return shifts.length >= ACCEPTED_WINDOW_BASELINE_SHIFT_COMPACTION_LIMIT
		? compactAcceptedWindowBaseline(nextBaseline)
		: nextBaseline;
}
