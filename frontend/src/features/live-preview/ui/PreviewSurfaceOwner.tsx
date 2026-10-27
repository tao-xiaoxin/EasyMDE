import {
	createElement,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "@wordpress/element";
import type { CSSProperties } from "react";
import type { DocumentHistoryState } from "../../document-source/adapters/code-mirror-document-session";
import { certifiedTextTailGapSlice } from "../../immersive-editor/visual-markdown";
import type {
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../../contracts/ports/editor-block-index-port";
import type {
	PreviewEditMap,
	PreviewFeatures,
	PreviewRequestPort,
	PreviewRequestState,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import { prepareVisualProtectedNodeAdoption } from "../../../shared/dom/visual-protected-node-adoption";
import {
	isMarkdownTerminalWhitespaceSuffix,
	markdownLineStarts,
} from "../../../shared/markdown/markdown-line-model";
import type {
	GeneratedContentKind,
	GeneratedContentOriginal,
	GeneratedContentTarget,
	GeneratedContentTargetLease as GeneratedTargetLease,
} from "../../generated-content-export/generated-content-target";
import { associateGeneratedContentTarget } from "../../generated-content-export/generated-content-target";
import {
	associateGeneratedImageTargetBySelection,
	type GeneratedImageTarget,
	type GeneratedImageTargetIndex,
	type GeneratedImageTargetSelection,
	generatedImageTargetCount,
} from "../../generated-content-export/generated-image-target";
import {
	projectVisualCodeFenceMetadata,
	projectVisualCodeBodySelection,
	serializeVisualMarkdownBlockFragment,
	visualCodeBodyBoundaryAtOffset,
} from "../../immersive-editor/visual-markdown";
import {
	createPreviewRequestSession,
	type PreviewRequestSession,
} from "../model/create-preview-request-session";
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from "../model/preview-window-model";
import {
	type PreviewEnhancementPort,
	previewEnhancementFailureCode,
} from "../ports/preview-enhancement-port";
import type {
	PreviewScrollPort,
	PreviewScrollSnapshot,
} from "../ports/preview-scroll-port";
import {
	capturePreviewWindowFlowBoundary,
	createPreviewWindowRepository,
	fullMaterializedNodes,
	markPreviewWindowFlowGapMeasured,
	publishPreviewWindowMeasuredBlock,
	markPreviewWindowFlowGapUnknown,
	markPreviewWindowFlowGeometryMeasured,
	markPreviewWindowFlowGeometryUnknown,
	measurePreviewWindowAdoptedBlock,
	measurePreviewWindowBlockGeometry,
	PREVIEW_WINDOW_SPACER_ATTRIBUTE,
	PreviewWindowDomError,
	type PreviewWindowNodeRepository,
	previewWindowBlockIndexForNode,
	previewWindowFlowDocumentCoordinate,
	reconcilePreviewWindowSpacerFlow,
	resetPreviewWindowFlowGeometry,
	VISUAL_BLOCK_ATTRIBUTE,
	validatePreviewWindowMarkup,
	validatePreviewWindowRepository,
	viewportForCanvas,
	windowNodes,
} from "./preview-window-dom";
import {
	SafePreviewHtmlSink,
	type SafePreviewHtmlSinkCommit,
	type SafePreviewHtmlSinkCompositionGate,
	type SafePreviewHtmlSinkMaterializeCommit,
	type SafePreviewHtmlSinkSelectionHandoff,
	type SafePreviewHtmlSinkWindowCommit,
} from "./SafePreviewHtmlSink";

function previewFailureCode(error: unknown): string {
	return error instanceof PreviewWindowDomError
		? error.message
		: previewEnhancementFailureCode(error);
}

function previewNeedsWindow(editMap: PreviewEditMap | null): boolean {
	return (editMap?.blocks.length ?? 0) > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
}

// The editing marker changes caret and selection presentation only; theme and
// font classes remain part of the geometry epoch.
function previewWindowGeometryClassName(className: string | undefined): string {
	return (className ?? "")
		.split(/\s+/u)
		.filter((value) => value && "easymde-immersive-visual-editor" !== value)
		.join(" ");
}

function previewDocumentEndBlockIndex(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
): number {
	if (
		editMap.signature !== signature ||
		1 !== editMap.version ||
		"line" !== editMap.coordinate
	) {
		throw new PreviewWindowDomError("preview-window-document-end-map-invalid");
	}

	const lineStarts = markdownLineStarts(markdown);

	let lastEditableBlockIndex = -1;
	editMap.blocks.forEach((block, index) => {
		if (block.editable) lastEditableBlockIndex = index;
	});

	const eofBlocks = editMap.blocks.flatMap((block, index) => {
		const zeroWidthGeneratedBlock =
			!block.editable && block.startLine === block.endLine;
		if (
			!Number.isInteger(block.startLine) ||
			!Number.isInteger(block.endLine) ||
			block.startLine < 0 ||
			block.startLine > lineStarts.length ||
			block.endLine < block.startLine ||
			(block.endLine === block.startLine && !zeroWidthGeneratedBlock) ||
			block.endLine > lineStarts.length
		) {
			throw new PreviewWindowDomError(
				"preview-window-document-end-range-invalid",
			);
		}
		const start =
			block.startLine === lineStarts.length
				? markdown.length
				: lineStarts[block.startLine];
		const end =
			block.endLine === lineStarts.length
				? markdown.length
				: lineStarts[block.endLine];
		if (undefined === start || undefined === end) {
			throw new PreviewWindowDomError(
				"preview-window-document-end-range-invalid",
			);
		}
		const reachesDocumentEnd =
			end === markdown.length ||
			isMarkdownTerminalWhitespaceSuffix(markdown.slice(end));
		return block.editable && start < markdown.length && reachesDocumentEnd
			? [index]
			: [];
	});

	if (
		1 !== eofBlocks.length ||
		eofBlocks[0] !== lastEditableBlockIndex ||
		editMap.blocks.length <= DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED
	) {
		throw new PreviewWindowDomError(
			"preview-window-document-end-block-unavailable",
		);
	}
	return eofBlocks[0];
}

function previewSourceSelectionBlockIndices(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
	sourceSelection: Readonly<{ end: number; start: number }>,
): number[] {
	if (
		editMap.signature !== signature ||
		1 !== editMap.version ||
		"line" !== editMap.coordinate
	) {
		throw new PreviewWindowDomError("preview-window-selection-map-invalid");
	}
	const range = sourceSelection.start !== sourceSelection.end;
	const offsets = [sourceSelection.start, sourceSelection.end];
	if (
		offsets.some(
			(offset) =>
				!Number.isSafeInteger(offset) || offset < 0 || offset > markdown.length,
		)
	) {
		throw new PreviewWindowDomError("preview-window-selection-range-invalid");
	}
	const lineStarts = markdownLineStarts(markdown);
	const collapsed = sourceSelection.start === sourceSelection.end;
	const indices = [
		previewSourceSelectionBlockIndex(
			markdown,
			editMap,
			signature,
			lineStarts,
			sourceSelection.start,
			false,
			collapsed,
		),
		...(range
			? [
					previewSourceSelectionBlockIndex(
						markdown,
						editMap,
						signature,
						lineStarts,
						sourceSelection.end,
						true,
						false,
					),
				]
			: []),
	];
	const start = Math.min(...indices);
	const end = Math.max(...indices);
	return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function previewSourceSelectionBlockIndex(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
	lineStarts: ReadonlyArray<number>,
	offset: number,
	preferPrevious: boolean,
	collapsed: boolean,
): number {
	if (offset === markdown.length) {
		return previewDocumentEndBlockIndex(markdown, editMap, signature);
	}
	const lineIndex = markdownLineIndexAtOffset(lineStarts, offset);
	const exactLineStart = lineStarts[lineIndex] === offset;
	const candidateLines =
		preferPrevious && exactLineStart
			? Array.from({ length: lineIndex + 1 }, (_, index) => lineIndex - index)
			: [lineIndex];
	for (const candidateLine of candidateLines) {
		const blockIndex = editMap.blocks.findIndex(
			(block) =>
				block.editable &&
				block.startLine <= candidateLine &&
				candidateLine < block.endLine,
		);
		if (blockIndex >= 0) return blockIndex;
	}
	// A canonical removal can leave a *collapsed* caret on the line terminators
	// the removed block kept, and that position has no editable owner. The
	// following editable block owns the pin then, otherwise the preceding one,
	// but only while the source between the caret and that block is blank:
	// nothing else is recoverable whitespace, and a non-collapsed endpoint
	// keeps its explicit failure.
	const nearest = collapsed
		? blankLineEditableBlockIndex(markdown, editMap, lineStarts, lineIndex, offset)
		: -1;
	if (nearest >= 0) return nearest;
	throw new PreviewWindowDomError("preview-window-selection-block-unavailable");
}

/**
 * The editable block a collapsed caret with no editable owner on its own line
 * can still pin, or `-1` when no block is reachable through blank source. The
 * following block wins when every skipped line is blank, otherwise the
 * preceding block when the source between its range end and the caret is blank.
 */
function blankLineEditableBlockIndex(
	markdown: string,
	editMap: PreviewEditMap,
	lineStarts: ReadonlyArray<number>,
	lineIndex: number,
	offset: number,
): number {
	let previous = -1;
	let previousStart = -1;
	let next = -1;
	let nextStart = -1;
	editMap.blocks.forEach((block, index) => {
		if (!block.editable || block.endLine <= block.startLine) return;
		if (block.endLine <= lineIndex) {
			previous = index;
			previousStart = lineStarts[block.endLine] ?? -1;
		} else if (-1 === next && block.startLine > lineIndex) {
			next = index;
			nextStart = lineStarts[block.startLine] ?? -1;
		}
	});
	if (
		-1 !== next &&
		nextStart >= 0 &&
		isMarkdownTerminalWhitespaceSuffix(markdown.slice(offset, nextStart))
	) {
		return next;
	}
	if (
		-1 !== previous &&
		previousStart >= 0 &&
		isMarkdownTerminalWhitespaceSuffix(markdown.slice(previousStart, offset))
	) {
		return previous;
	}
	return -1;
}

function previewImageSelectionBlockIndices(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
	sourceSelection: Readonly<{ end: number; start: number }>,
	cached?: Readonly<{
		editableBlockRanges: ReadonlyArray<AcceptedEditableBlockRange>;
		lineStarts: ReadonlyArray<number>;
	}>,
): number[] {
	if (
		editMap.signature !== signature ||
		1 !== editMap.version ||
		"line" !== editMap.coordinate
	)
		throw new PreviewWindowDomError("preview-window-selection-map-invalid");
	const range = sourceSelection.start !== sourceSelection.end;
	const offsets = [sourceSelection.start, sourceSelection.end];
	if (
		offsets.some(
			(offset) =>
				!Number.isSafeInteger(offset) || offset < 0 || offset > markdown.length,
		)
	)
		throw new PreviewWindowDomError("preview-window-selection-range-invalid");
	const lineStarts = cached?.lineStarts ?? markdownLineStarts(markdown);
	const indices = [
		previewImageSelectionBlockIndex(
			editMap,
			lineStarts,
			sourceSelection.start,
			cached,
			false,
		),
		...(range
			? [
					previewImageSelectionBlockIndex(
						editMap,
						lineStarts,
						sourceSelection.end,
						cached,
						true,
					),
				]
			: []),
	];
	return [...new Set(indices)];
}

function previewImageSelectionBlockIndex(
	editMap: PreviewEditMap,
	lineStarts: ReadonlyArray<number>,
	offset: number,
	cached:
		| Readonly<{
				editableBlockRanges: ReadonlyArray<AcceptedEditableBlockRange>;
				lineStarts: ReadonlyArray<number>;
		  }>
		| undefined,
	preferPrevious: boolean,
): number {
	const lineIndex = markdownLineIndexAtOffset(lineStarts, offset);
	const exactLineStart = lineStarts[lineIndex] === offset;
	const candidateLines =
		preferPrevious && exactLineStart
			? Array.from({ length: lineIndex + 1 }, (_, index) => lineIndex - index)
			: [lineIndex];
	for (const candidateLine of candidateLines) {
		const blockIndex = cached
			? cachedEditableBlockIndexForLine(cached.editableBlockRanges, candidateLine)
			: editMap.blocks.findIndex(
					(block) =>
						block.editable &&
						block.startLine <= candidateLine &&
						candidateLine < block.endLine,
				);
		if (blockIndex >= 0) return blockIndex;
	}
	throw new PreviewWindowDomError("preview-window-selection-block-unavailable");
}

type AcceptedEditableBlockRange = Readonly<{
	endLine: number;
	index: number;
	startLine: number;
}>;

function markdownLineIndexAtOffset(
	lineStarts: ReadonlyArray<number>,
	offset: number,
): number {
	let low = 0;
	let high = lineStarts.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const lineStart = lineStarts[middle];
		if (undefined !== lineStart && lineStart <= offset) low = middle + 1;
		else high = middle;
	}
	return Math.max(0, low - 1);
}

function cachedEditableBlockIndexForLine(
	ranges: ReadonlyArray<AcceptedEditableBlockRange>,
	lineIndex: number,
): number {
	let low = 0;
	let high = ranges.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const range = ranges[middle];
		if (range && range.startLine <= lineIndex) low = middle + 1;
		else high = middle;
	}
	const range = ranges[low - 1];
	return range && lineIndex < range.endLine ? range.index : -1;
}

type PreviewMessages = Readonly<{
	empty: string;
	error: string;
	loading: string;
}>;

type PreviewHtmlState = Readonly<{
	codeTheme: string;
	editMap: PreviewEditMap | null;
	features: PreviewFeatures;
	generation: number;
	html: SafePreviewHtml;
	htmlRevision: number;
	kind: "html";
	paperPlaceholder?: true;
	phase: "committing" | "enhancing" | "failed" | "loading" | "ready";
	signature: string;
	materializeCommit: SafePreviewHtmlSinkMaterializeCommit | null;
	stagedCommit: SafePreviewHtmlSinkCommit | null;
	windowedCommit: SafePreviewHtmlSinkWindowCommit | null;
	windowedFailure?: boolean;
}>;

type PreviewStatusState = Readonly<{
	generation: number;
	kind: "empty" | "error" | "loading";
}>;

type PreviewSurfaceState = PreviewHtmlState | PreviewStatusState;

export type PreviewSurfaceStagingScheduler = Readonly<{
	now?: () => number;
	yield: () => Promise<void>;
}>;

const PREVIEW_STAGING_SLICE_BUDGET_MS = 8;
const PREVIEW_STAGING_DOM_APPEND_MAX_NODES = 32;
const PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS = 32;
const PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS = 4;

type PreviewWindowGeometryPreparation = Readonly<{
	controller: AbortController;
	key: number;
	revision: number;
	styleEpoch: number;
	widthEpoch: number;
}>;

type PreviewWindowMountedGeometryMeasurement = {
	anchorCorrection: number;
	anchorGeometryMeasured: boolean;
	anchorIndex: number;
	contextKey: string;
	indices: number[];
	cursor: number;
};
function hasPreviewWindowLayoutBox(
	node: HTMLElement,
	rect: DOMRect,
): boolean {
	const hasPositiveHeight =
		(Number.isFinite(rect.height) && rect.height > 0) ||
		node.offsetHeight > 0;
	return (
		hasPositiveHeight ||
		(Number.isFinite(rect.width) && rect.width > 0) ||
		node.offsetWidth > 0 ||
		node.getClientRects().length > 0
	);
}

type PreviewEnhancementCandidate = Readonly<{
	codeTheme: string;
	editMap: PreviewEditMap | null;
	features: PreviewFeatures;
	generation: number;
	markdown: string;
	requestRevision: number | null;
	serverHtml: SafePreviewHtml;
	signature: string;
	sourceNodes: ReadonlyArray<Node>;
	surface: HTMLElement;
}>;

type AcceptedGeneratedPreview = Readonly<{
	blockRanges: ReadonlyMap<
		string,
		Readonly<{
			end: number;
			index: number;
			start: number;
		}>
	>;
	editableBlockRanges: ReadonlyArray<AcceptedEditableBlockRange>;
	editMap: PreviewEditMap | null;
	generation: number;
	lineStarts: ReadonlyArray<number>;
	markdown: string;
	requestRevision: number | null;
	signature: string;
	sourceRevision: number;
}>;

type StagedPreviewImageElements = Readonly<{
	byBlock: ReadonlyMap<string, ReadonlyArray<HTMLImageElement>>;
	generation: number;
}>;

export type PreviewSurfaceStatus = "empty" | "error" | "loading" | "ready";

export type PreviewDocumentEndPinLease = Readonly<{
	release: () => void;
}>;

export type PreviewGeneratedContentTargetRequest = Readonly<{
	element: Element;
	index: PreviewGeneratedContentTargetIndex;
	kind: GeneratedContentKind;
	ordinal: number;
}>;

export type PreviewGeneratedContentTargetSelectionRequest = Readonly<{
	index: PreviewGeneratedContentTargetIndex;
	kind: GeneratedContentKind;
	ordinal: number;
	selection: PreviewSourceSelection;
}>;

export type PreviewGeneratedContentTargetForSelectionRequest = Readonly<{
	index: PreviewGeneratedContentTargetIndex;
	selection: PreviewSourceSelection;
}>;

export type PreviewGeneratedContentTargetIndex = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	length: number;
	mathSpans: ReadonlyArray<EditorMarkdownMathSpan>;
	revision: number;
	source: string;
}>;

export type PreviewGeneratedContentTargetLease = GeneratedTargetLease &
	Readonly<{
		isCurrent: () => boolean;
		release: () => void;
	}>;

export type PreviewGeneratedContentTargetPinLease = Readonly<{
	getLease: () => PreviewGeneratedContentTargetLease | null;
	isCurrent: () => boolean;
	release: () => void;
	target: GeneratedContentTarget;
}>;

export type PreviewImageTargetRequest = Readonly<{
	element: HTMLImageElement;
	index: GeneratedImageTargetIndex;
	selection: GeneratedImageTargetSelection;
}>;

export type PreviewImageTargetSelectionRequest = Readonly<{
	index: GeneratedImageTargetIndex;
	selection: GeneratedImageTargetSelection;
}>;

export type PreviewImageTargetLease = Readonly<{
	isCurrent: () => boolean;
	release: () => void;
	root: HTMLImageElement;
	target: GeneratedImageTarget;
}>;

export type PreviewImageTargetPinLease = Readonly<{
	getLease: () => PreviewImageTargetLease | null;
	isCurrent: () => boolean;
	release: () => void;
	target: GeneratedImageTarget;
}>;

export type PreviewGeneratedPreviewIdentity = Readonly<{
	editMap: PreviewEditMap | null;
	revision: number;
	signature: string;
	sourceRevision: number;
}>;

export type PreviewSourceSnapshot = Readonly<{
	revision: number;
	value: string;
}>;

export type PreviewAcceptedWindowSnapshot = Readonly<{
	blocks: ReadonlyArray<
		Readonly<{
			id: string;
			innerHTML: string;
			node: HTMLElement;
		}>
	>;
	/** The exact child sequence installed by the accepted window commit. */
	nodes: ReadonlyArray<Node>;
	/** Present only while the accepted source still has its formal map. */
	editMap?: PreviewEditMap;
	sourceRevision?: number;
	ownedGap?: HTMLElement;
	/** The accepted Preview HTML revision represented by this certificate. */
	revision: number;
	signature: string;
	/** Monotonic identity for the installed window commit. */
	key: number;
}>;

export type PreviewSourceSelection = Readonly<{
	end: number;
	start: number;
}>;

type MutablePreviewDocumentEndPin = {
	generation: number | null;
	requestRevision: number | null;
	signature: string;
	sourceSelection: PreviewSourceSelection | null;
	targetIndices: number[];
};

const VISUAL_MARKDOWN_SOURCE_ATTRIBUTE = "data-easymde-visual-markdown-source";

type VisualBlockMarker = Readonly<{
	id: string;
	marker: Comment;
}>;

type PendingMaterialization = Readonly<{
	key: number;
	promise: Promise<boolean>;
	resolve: (completed: boolean) => void;
	revision: number;
}>;

type MutablePreviewWindowCommit = {
	key: number;
	nodes: Node[];
	revision: number;
	selectionHandoff?: SafePreviewHtmlSinkSelectionHandoff;
};

type AcceptedWindowBlockBaseline = Readonly<{
	id: string;
	innerHTML: string;
	node: HTMLElement;
	sourceRange: Readonly<{ start: number; end: number }> | null;
}>;

type AcceptedWindowBaseline = Readonly<{
	blocks: ReadonlyMap<HTMLElement, AcceptedWindowBlockBaseline>;
	revision: number;
	signature: string;
	markdown: string | null;
	/** Local range transport does not renew the formal edit map. */
	sourceMapCurrent: boolean;
	sourceRevision: number | null;
}>;

type PendingPreviewScrollRestore = Readonly<{
	generation: number;
	snapshot: PreviewScrollSnapshot;
}>;

type PendingWindowFlowAnchor = Readonly<{
	documentTop: number;
	node: HTMLElement;
}>;

function hasMeasuredMountedPreviewWindowGeometry(
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

function verifyPreviewWindowFlowAnchor(
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
		1 /
		Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
	if (Math.abs(currentDocumentTop - anchor.documentTop) > tolerance) {
		throw new PreviewWindowDomError(
			"preview-window-flow-anchor-verification-failed",
		);
	}
}

export type PreviewOwnedGap = Readonly<{
	node: HTMLElement;
	markdown: string;
	sourceRevision: number;
	html: string;
	surface: HTMLElement;
	historyState: DocumentHistoryState;
	isLive: () => boolean;
	before: Readonly<{ start: number; end: number; source: string }>;
	after: Readonly<{ start: number; end: number; source: string }>;
}>;

export type PreviewCompositionSurfaceLease = Readonly<{
	release: () => void;
	retainGap?: (gap: PreviewOwnedGap) => void;
}>;

export type PreviewSurfaceRuntime = Readonly<{
	getGeneratedPreviewIdentity: () => PreviewGeneratedPreviewIdentity | null;
	getAcceptedWindowSnapshot: () => PreviewAcceptedWindowSnapshot | null;
	materialize: () => Promise<boolean>;
	prepareGeneratedContentTarget: (
		request: PreviewGeneratedContentTargetRequest,
	) => PreviewGeneratedContentTargetLease | null;
	prepareGeneratedContentTargetBySelection: (
		request: PreviewGeneratedContentTargetSelectionRequest,
	) => PreviewGeneratedContentTargetPinLease | null;
	prepareGeneratedContentTargetForSelection: (
		request: PreviewGeneratedContentTargetForSelectionRequest,
	) => PreviewGeneratedContentTargetPinLease | null;
	prepareImageTarget: (
		request: PreviewImageTargetRequest,
	) => PreviewImageTargetLease | null;
	prepareImageTargetBySelection: (
		request: PreviewImageTargetSelectionRequest,
	) => PreviewImageTargetPinLease | null;
	prepareDocumentEndWindowPin: (
		signature: string,
		sourceSelection?: PreviewSourceSelection,
	) => PreviewDocumentEndPinLease;
	prepareWindowBlockAdoption: (node: HTMLElement) => (() => boolean) | null;
	/**
	 * Held by the immersive editor while an accepted composition lease owns the
	 * surface. Releasing re-runs the sink effect with the newest props, so the
	 * accepted commit installs only after the canonical text is published.
	 */
	retainCompositionSurface: () => PreviewCompositionSurfaceLease;
	session: PreviewRequestSession;
	surface: HTMLElement;
}>;

type PreviewSurfaceOwnerProps = Readonly<{
	className?: string;
	contentEditable?: boolean;
	emptyMode?: "message" | "paper";
	enhancementPort: PreviewEnhancementPort;
	featureOverrides?: PreviewFeatures;
	initial: Readonly<{
		codeTheme?: string;
		editMap?: PreviewEditMap;
		features: PreviewFeatures;
		html: SafePreviewHtml;
		signature: string;
	}>;
	initialRevision: number;
	label?: string;
	messages: PreviewMessages;
	onDiagnostic?: (code: string) => void;
	onHtmlChange?: (html: SafePreviewHtml) => void;
	onImageReadinessChange?: () => void;
	onWindowReady?: () => void;
	onSnapshotReady?: (
		html: SafePreviewHtml,
		signature: string,
		editMap: PreviewEditMap | null,
	) => void;
	onDispose?: (runtime: PreviewSurfaceRuntime) => void;
	onReady: (runtime: PreviewSurfaceRuntime) => void;
	onStatusChange?: (status: PreviewSurfaceStatus) => void;
	port: PreviewRequestPort;
	currentSourceSnapshot?: () => PreviewSourceSnapshot | null;
	scrollPort: PreviewScrollPort;
	role?: string;
	sourceRevision?: number;
	spellCheck?: boolean;
	materializeScheduler?: PreviewSurfaceStagingScheduler;
	stagingScheduler?: PreviewSurfaceStagingScheduler;
	style?: CSSProperties;
	windowed?: boolean;
}>;

function initialState(props: PreviewSurfaceOwnerProps): PreviewSurfaceState {
	const features = {
		...props.initial.features,
		...props.featureOverrides,
	};
	if (!props.initial.html.trim()) {
		if ("paper" === props.emptyMode) {
			return {
				codeTheme: props.initial.codeTheme ?? "",
				editMap: props.initial.editMap ?? null,
				features,
				generation: 0,
				html: props.initial.html,
				htmlRevision: 0,
				kind: "html",
				paperPlaceholder: true,
				phase: "enhancing",
				signature: props.initial.signature,
				materializeCommit: null,
				stagedCommit: null,
				windowedCommit: null,
			};
		}
		return { generation: 0, kind: "loading" };
	}
	return {
		codeTheme: props.initial.codeTheme ?? "",
		editMap: props.initial.editMap ?? null,
		features,
		generation: 0,
		html: props.initial.html,
		htmlRevision: 0,
		kind: "html",
		phase: "enhancing",
		signature: props.initial.signature,
		materializeCommit: null,
		stagedCommit: null,
		windowedCommit: null,
	};
}

function acceptedGeneratedPreviewFromCandidate(
	candidate: PreviewEnhancementCandidate,
	sourceRevision: number,
): AcceptedGeneratedPreview | null {
	const lineStarts = markdownLineStarts(candidate.markdown);
	const blockRanges = new Map<
		string,
		{
			end: number;
			index: number;
			start: number;
		}
	>();
	for (const [index, block] of (candidate.editMap?.blocks ?? []).entries()) {
		const start = lineStarts[block.startLine];
		const end =
			block.endLine === lineStarts.length
				? candidate.markdown.length
				: lineStarts[block.endLine];
		if (undefined === start || undefined === end || blockRanges.has(block.id)) {
			return null;
		}
		blockRanges.set(block.id, { end, index, start });
	}
	const editableBlockRanges = (candidate.editMap?.blocks ?? [])
		.map((block, index) => ({
			endLine: block.endLine,
			index,
			startLine: block.startLine,
		}))
		.filter((range, index) => {
			const block = candidate.editMap?.blocks[index];
			return Boolean(block?.editable && range.startLine < range.endLine);
		});
	return {
		blockRanges,
		editableBlockRanges,
		editMap: candidate.editMap,
		generation: candidate.generation,
		lineStarts,
		markdown: candidate.markdown,
		requestRevision: candidate.requestRevision,
		signature: candidate.signature,
		sourceRevision,
	};
}

function capturePreviewImageElements(
	surface: HTMLElement,
	editMap: PreviewEditMap | null,
	generation: number,
): StagedPreviewImageElements {
	const byBlock = new Map<string, ReadonlyArray<HTMLImageElement>>();
	if (editMap) {
		editMap.blocks.forEach((block, index) => {
			const root = surface.children[index];
			if (!(root instanceof HTMLElement)) return;
			const images =
				root instanceof HTMLImageElement
					? [root]
					: Array.from(root.querySelectorAll<HTMLImageElement>("img"));
			byBlock.set(
				block.id,
				images.filter(
					(image) => image.closest("[data-easymde-visual-block-id]") === root,
				),
			);
		});
	}
	return { byBlock, generation };
}

type SourceLine = Readonly<{
	contentEnd: number;
	end: number;
}>;

function sourceLine(source: string, from: number, limit: number): SourceLine {
	let contentEnd = from;
	while (
		contentEnd < limit &&
		source[contentEnd] !== "\r" &&
		source[contentEnd] !== "\n"
	)
		contentEnd += 1;
	let end = contentEnd;
	if (end < limit && "\r" === source[end]) {
		end += 1;
		if (end < limit && "\n" === source[end]) end += 1;
	} else if (end < limit && "\n" === source[end]) {
		end += 1;
	}
	return { contentEnd, end };
}

function mermaidOriginalForCodeBlock(
	source: string,
	block: EditorMarkdownSourceBlock,
): GeneratedContentOriginal | null {
	if (
		"code" !== block.kind ||
		block.from < 0 ||
		block.to <= block.from ||
		block.to > source.length
	)
		return null;
	const opening = sourceLine(source, block.from, block.to);
	const openingText = source.slice(block.from, opening.contentEnd);
	const openingMatch = openingText.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u);
	if (!openingMatch || opening.end <= opening.contentEnd) return null;
	const info = openingMatch[2]
		?.trim()
		.split(/[ \t]+/u)[0]
		?.toLowerCase();
	if ("mermaid" !== info) return null;
	const fence = openingMatch[1];
	if (!fence) return null;
	const bodyFrom = opening.end;
	let cursor = bodyFrom;
	while (cursor < block.to) {
		const line = sourceLine(source, cursor, block.to);
		const lineText = source.slice(cursor, line.contentEnd);
		const closingMatch = lineText.match(/^ {0,3}(`+|~+)[ \t]*$/u);
		const closingFence = closingMatch?.[1];
		if (
			closingFence &&
			closingFence[0] === fence[0] &&
			closingFence.length >= fence.length
		) {
			if (source.slice(line.end, block.to).trim()) return null;
			return {
				body: source.slice(bodyFrom, cursor),
				bodyRange: { from: bodyFrom, to: cursor },
				full: source.slice(block.from, block.to),
				fullRange: { from: block.from, to: block.to },
			};
		}
		if (line.end <= cursor) break;
		cursor = line.end;
	}
	return null;
}

function generatedTargetMatchesSourceSelection(
	target: GeneratedContentTarget,
	selection: PreviewSourceSelection,
): boolean {
	return sourceSelectionMatchesGeneratedRanges(
		selection,
		target.original.fullRange,
		target.original.bodyRange,
	);
}

function sourceSelectionMatchesGeneratedRanges(
	selection: PreviewSourceSelection,
	fullRange: Readonly<{ from: number; to: number }>,
	bodyRange: Readonly<{ from: number; to: number }>,
): boolean {
	if (
		!Number.isSafeInteger(selection.start) ||
		!Number.isSafeInteger(selection.end) ||
		selection.start < 0 ||
		selection.end < selection.start
	)
		return false;
	return (
		selection.start >= fullRange.from &&
		selection.end <= fullRange.to &&
		selection.end >= bodyRange.from &&
		selection.start <= bodyRange.to
	);
}

function lowerBoundByFrom<T extends Readonly<{ from: number }>>(
	items: ReadonlyArray<T>,
	from: number,
): number {
	let low = 0;
	let high = items.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const item = items[middle];
		if (item && item.from < from) low = middle + 1;
		else high = middle;
	}
	return low;
}

function hasExactSurfaceChildren(
	surface: HTMLElement,
	nodes: ReadonlyArray<Node>,
): boolean {
	if (surface.childNodes.length !== nodes.length) return false;
	return nodes.every((node, index) => surface.childNodes[index] === node);
}

function previewWindowGeometryEpochKey(
	context: Readonly<
		Pick<
			PreviewWindowNodeRepository["context"],
			"revision" | "signature" | "styleEpoch" | "widthEpoch"
		>
	>,
): string {
	return `${context.revision}:${context.signature}:${context.styleEpoch}:${context.widthEpoch}`;
}

function isFullMaterializedWindowSurface(
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

function createAcceptedWindowSnapshot(
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
		validatePreviewWindowRepository(repository);
	} catch {
		return null;
	}
	const blocks = commit.nodes.flatMap((node) => {
		if (node === repository.ownedGap?.node) return [];
		if (
			!(node instanceof HTMLElement) ||
			node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
		)
			return [];
		const id = node.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
		const index = id ? repository.indexById.get(id) : undefined;
		const entry = undefined !== index ? repository.blocks[index] : null;
		const accepted = entry ? baseline.blocks.get(entry.node) : null;
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
		...(baseline.sourceMapCurrent && state.editMap ? { editMap: state.editMap } : {}),
		...(baseline.sourceRevision !== null ? { sourceRevision: baseline.sourceRevision } : {}),
		...(repository.ownedGap ? { ownedGap: repository.ownedGap.node } : {}),
		revision: commit.revision,
		signature: state.signature,
	});
}

function previewWindowFenceBindings(
	repository: PreviewWindowNodeRepository,
	markdown: string,
): ((root: HTMLElement) => Readonly<{ end: number; start: number }> | null) | null {
	if (!markdown) return null;
	const lineStarts = markdownLineStarts(markdown);
	const bindings = new Map<string, Readonly<{ end: number; start: number }>>();
	let previousEndLine = 0;
	for (const entry of repository.blocks) {
		const block = entry.map;
		if (
			!Number.isInteger(block.startLine) ||
			!Number.isInteger(block.endLine) ||
			block.startLine < previousEndLine ||
			block.startLine < 0 ||
			block.endLine < block.startLine ||
			block.endLine > lineStarts.length ||
			(block.editable && block.endLine === block.startLine)
		) {
			return null;
		}
		previousEndLine = block.endLine;
		if (!block.editable) continue;
		const start = lineStarts[block.startLine];
		const end =
			block.endLine === lineStarts.length
				? markdown.length
				: lineStarts[block.endLine];
		if (undefined === start || undefined === end) return null;
		bindings.set(block.id, { end, start });
	}
	return (root: HTMLElement) => {
		const id = root.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
		return id ? (bindings.get(id) ?? null) : null;
	};
}

function captureAcceptedWindowBaseline(
	surface: HTMLElement,
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
	if (markdown) {
		const binding = previewWindowFenceBindings(repository, markdown);
		if (binding) {
			projectVisualCodeFenceMetadata(markdown, surface, binding);
		}
	}
	prepareVisualProtectedNodeAdoption([], repository.nodes);
	const blocks = new Map<HTMLElement, AcceptedWindowBlockBaseline>();
	const starts = null != markdown ? markdownLineStarts(markdown) : null;
	for (const entry of repository.blocks) {
		const clone = entry.node.cloneNode(true);
		if (!(clone instanceof HTMLElement)) return null;
		blocks.set(
			entry.node,
			Object.freeze({
				id: entry.map.id,
				innerHTML: clone.innerHTML,
				node: entry.node,
				sourceRange: starts && null != markdown ? {
					start: starts[entry.map.startLine] ?? markdown.length,
					end: starts[entry.map.endLine] ?? markdown.length,
				} : null,
			}),
		);
	}
	return Object.freeze({ blocks, revision, signature, markdown: markdown ?? null, sourceRevision, sourceMapCurrent: true });
}

function extendAcceptedWindowBaseline(
	baseline: AcceptedWindowBaseline,
	id: string,
	node: HTMLElement,
	sourceSnapshot: PreviewSourceSnapshot | null = null,
): AcceptedWindowBaseline {
	const clone = node.cloneNode(true);
	if (!(clone instanceof HTMLElement)) {
		throw new PreviewWindowDomError("preview-window-baseline-capture-failed");
	}
	const previous = baseline.blocks.get(node) ?? [...baseline.blocks.values()].find((block) => block.id === id);
	const previousRange = previous?.sourceRange ?? null;
	let markdown = baseline.markdown;
	let sourceRevision = baseline.sourceRevision;
	let changedRange = previousRange;
	let delta = 0;
	if (sourceSnapshot && markdown !== null && previousRange && sourceSnapshot.value !== markdown) {
		delta = sourceSnapshot.value.length - markdown.length;
		const end = previousRange.end + delta;
		if (end < previousRange.start
			|| !sourceSnapshot.value.startsWith(markdown.slice(0, previousRange.start))
			|| sourceSnapshot.value.slice(end) !== markdown.slice(previousRange.end)) {
			throw new PreviewWindowDomError("preview-window-local-source-witness-stale");
		}
		changedRange = { start: previousRange.start, end };
		markdown = sourceSnapshot.value;
		sourceRevision = sourceSnapshot.revision;
	} else if (sourceSnapshot && sourceSnapshot.value === markdown) sourceRevision = sourceSnapshot.revision;
	const blocks = new Map<HTMLElement, AcceptedWindowBlockBaseline>();
	for (const [root, block] of baseline.blocks) {
		if (block.id === id) continue;
		const range = block.sourceRange;
		blocks.set(root, delta && previousRange && range && range.start >= previousRange.end
			? Object.freeze({ ...block, sourceRange: { start: range.start + delta, end: range.end + delta } }) : block);
	}
	blocks.set(node, Object.freeze({ id, innerHTML: clone.innerHTML, node, sourceRange: changedRange }));
	return Object.freeze({ ...baseline, blocks, markdown, sourceRevision,
		sourceMapCurrent: baseline.sourceMapCurrent && markdown === baseline.markdown });
}

function surfaceStatus(state: PreviewSurfaceState): PreviewSurfaceStatus {
	if ("html" !== state.kind) {
		return state.kind;
	}
	return "ready" === state.phase
		? "ready"
		: "failed" === state.phase
			? "error"
			: "loading";
}

function previewScrollCanvas(surface: HTMLElement): HTMLElement {
	const canvas = surface.parentElement;
	if (!canvas?.classList.contains("easymde-immersive-preview-canvas")) {
		throw new Error("preview-scroll-canvas-missing");
	}
	return canvas;
}

function createEnhancementCandidate(
	activeSurface: HTMLElement,
	html: SafePreviewHtml,
	layoutParticipating: boolean,
	preparedSourceNodes?: ReadonlyArray<Node>,
): Readonly<{ sourceNodes: ReadonlyArray<Node>; surface: HTMLElement }> {
	const documentRef = activeSurface.ownerDocument;
	let parsedSourceNodes: ReadonlyArray<Node>;
	if (preparedSourceNodes) {
		parsedSourceNodes = preparedSourceNodes;
	} else {
		const template = documentRef.createElement("template");
		template.innerHTML = html;
		parsedSourceNodes = Array.from(template.content.childNodes);
	}
	const candidate = documentRef.createElement("div");
	candidate.className = activeSurface.className;
	candidate.style.cssText = activeSurface.style.cssText;
	candidate.setAttribute("aria-hidden", "true");
	candidate.setAttribute("inert", "");
	candidate.dataset.easymdePreviewStaging = "1";
	candidate.style.position = "fixed";
	candidate.style.insetInlineStart = "-100000px";
	candidate.style.top = "0";
	candidate.style.width = `${Math.max(
		1,
		activeSurface.getBoundingClientRect().width,
	)}px`;
	candidate.style.maxWidth = "none";
	candidate.style.visibility = "hidden";
	candidate.style.pointerEvents = "none";
	if (layoutParticipating) {
		previewScrollCanvas(activeSurface).append(candidate);
	} else {
		candidate.style.display = "none";
	}
	return {
		sourceNodes: parsedSourceNodes,
		surface: candidate,
	};
}

async function measurePreviewWindowCandidateGeometry(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
): Promise<boolean> {
	let sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
	for (let index = 0; index < repository.nodes.length; index += 1) {
		if (signal.aborted || !isCurrent()) return false;
		const node = repository.nodes[index];
		if (!node?.isConnected || node.parentNode !== surface) continue;
		const rect = node.getBoundingClientRect();
		if (!Number.isFinite(rect.height) || rect.height <= 0) continue;
		const previousGeometry = repository.flowGeometry[index];
		if (!previousGeometry) continue;
		const measurement = measurePreviewWindowBlockGeometry(
			node,
			repository.nodes[index + 1] ?? null,
			previousGeometry,
			repository.ownedGap?.node,
		);
		if (!measurement) continue;
		publishPreviewWindowMeasuredBlock(repository, surface, index, measurement, 0, rect);
		if (
			stagingTime(scheduler, surface.ownerDocument) - sliceStartedAt >=
			PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS
		) {
			await scheduler.yield();
			if (signal.aborted || !isCurrent()) return false;
			sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
		}
	}
	return true;
}

function defaultPreviewSurfaceStagingScheduler(
	documentRef: Document,
): PreviewSurfaceStagingScheduler {
	const windowRef = documentRef.defaultView;
	return {
		now: () => windowRef?.performance?.now() ?? Date.now(),
		yield: () =>
			new Promise<void>((resolve) => {
				if (windowRef?.requestAnimationFrame) {
					windowRef.requestAnimationFrame(() => resolve());
					return;
				}
				if (windowRef) {
					windowRef.setTimeout(resolve, 0);
					return;
				}
				setTimeout(resolve, 0);
			}),
	};
}

function stagingTime(
	scheduler: PreviewSurfaceStagingScheduler,
	documentRef: Document,
): number {
	return (
		scheduler.now?.() ??
		documentRef.defaultView?.performance?.now() ??
		Date.now()
	);
}

async function populateEnhancementCandidate(
	candidate: PreviewEnhancementCandidate,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
): Promise<boolean> {
	const documentRef = candidate.surface.ownerDocument;
	let sliceStartedAt = stagingTime(scheduler, documentRef);
	let index = 0;
	while (index < candidate.sourceNodes.length) {
		const batch = documentRef.createDocumentFragment();
		let batchSize = 0;
		do {
			if (signal.aborted || !isCurrent()) return false;
			const node = candidate.sourceNodes[index];
			if (!node) throw new Error("preview-staging-node-missing");
			batch.append(node);
			index += 1;
			batchSize += 1;
		} while (
			index < candidate.sourceNodes.length &&
			batchSize < PREVIEW_STAGING_DOM_APPEND_MAX_NODES &&
			stagingTime(scheduler, documentRef) - sliceStartedAt <
				PREVIEW_STAGING_SLICE_BUDGET_MS
		);
		candidate.surface.append(batch);
		if (
			index < candidate.sourceNodes.length &&
			stagingTime(scheduler, documentRef) - sliceStartedAt >=
				PREVIEW_STAGING_SLICE_BUDGET_MS
		) {
			await scheduler.yield();
			if (signal.aborted || !isCurrent()) return false;
			sliceStartedAt = stagingTime(scheduler, documentRef);
		}
	}
	return !signal.aborted && isCurrent();
}

function discardEnhancementCandidate(
	candidate: PreviewEnhancementCandidate | null,
): void {
	candidate?.surface.remove();
}

function capturePreviewBlockMarkers(
	surface: HTMLElement,
	editMap: PreviewEditMap,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
):
	| ReadonlyArray<VisualBlockMarker>
	| null
	| Promise<ReadonlyArray<VisualBlockMarker> | null> {
	validatePreviewWindowMarkup(surface, editMap);
	const markers: VisualBlockMarker[] = [];
	const documentRef = surface.ownerDocument;
	const stale = (): null => {
		removePreviewBlockMarkers(markers);
		return null;
	};
	const capture =
		async (): Promise<ReadonlyArray<VisualBlockMarker> | null> => {
			let sliceStartedAt = stagingTime(scheduler, documentRef);
			try {
				for (
					let blockIndex = 0;
					blockIndex < editMap.blocks.length;
					blockIndex += 1
				) {
					if (signal.aborted || !isCurrent()) return stale();
					const block = editMap.blocks[blockIndex];
					const root = surface.children[blockIndex];
					if (!block || !(root instanceof HTMLElement)) {
						throw new Error("preview-window-block-map-marker-mismatch");
					}
					const marker = documentRef.createComment(
						`easymde-visual-block:${block.id}`,
					);
					root.before(marker);
					markers.push({ id: block.id, marker });
					if (
						blockIndex + 1 < editMap.blocks.length &&
						stagingTime(scheduler, documentRef) - sliceStartedAt >=
							PREVIEW_STAGING_SLICE_BUDGET_MS
					) {
						await scheduler.yield();
						if (signal.aborted || !isCurrent()) return stale();
						sliceStartedAt = stagingTime(scheduler, documentRef);
					}
				}
				return markers;
			} catch (error) {
				removePreviewBlockMarkers(markers);
				throw error;
			}
		};
	return capture();
}

function removePreviewBlockMarkers(
	markers: ReadonlyArray<VisualBlockMarker>,
): void {
	for (const { marker } of markers) marker.remove();
}

function annotateEnhancedPreviewBlocks(
	markers: ReadonlyArray<VisualBlockMarker>,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
): boolean | Promise<boolean> {
	const documentRef = markers[0]?.marker.ownerDocument;
	if (!documentRef) {
		removePreviewBlockMarkers(markers);
		return !signal.aborted && isCurrent();
	}
	const annotate = async (): Promise<boolean> => {
		let sliceStartedAt = stagingTime(scheduler, documentRef);
		try {
			for (let index = 0; index < markers.length; index += 1) {
				if (signal.aborted || !isCurrent()) return false;
				const entry = markers[index];
				const target = entry?.marker.nextElementSibling;
				if (!entry || !(target instanceof HTMLElement)) {
					throw new Error("preview-window-block-map-marker-mismatch");
				}
				target.setAttribute(VISUAL_BLOCK_ATTRIBUTE, entry.id);
				if (
					index + 1 < markers.length &&
					stagingTime(scheduler, documentRef) - sliceStartedAt >=
						PREVIEW_STAGING_SLICE_BUDGET_MS
				) {
					await scheduler.yield();
					if (signal.aborted || !isCurrent()) return false;
					sliceStartedAt = stagingTime(scheduler, documentRef);
				}
			}
			return !signal.aborted && isCurrent();
		} finally {
			removePreviewBlockMarkers(markers);
		}
	};
	return annotate();
}

type VisualMarkdownSourceMarker = Readonly<{
	kind: "math" | "mermaid";
	marker: Comment;
	source: string;
}>;

function captureVisualMarkdownSources(
	surface: HTMLElement,
): ReadonlyArray<VisualMarkdownSourceMarker> {
	const sources: VisualMarkdownSourceMarker[] = [];
	for (const node of surface.querySelectorAll<HTMLElement>(".easymde-math")) {
		if (node.closest("pre > code")) continue;
		const marker = surface.ownerDocument.createComment(
			"easymde-visual-markdown-source",
		);
		node.before(marker);
		sources.push({ kind: "math", marker, source: node.textContent ?? "" });
	}
	for (const node of surface.querySelectorAll<HTMLElement>(
		"pre > code.language-mermaid",
	)) {
		const block = node.parentElement;
		if (!block) throw new Error("preview-enhancement-visual-source-missing");
		const marker = surface.ownerDocument.createComment(
			"easymde-visual-markdown-source",
		);
		block.before(marker);
		sources.push({ kind: "mermaid", marker, source: node.textContent ?? "" });
	}
	return sources;
}

function removeVisualMarkdownSourceMarkers(
	sources: ReadonlyArray<VisualMarkdownSourceMarker>,
): void {
	for (const { marker } of sources) marker.remove();
}

function annotateEnhancedVisualSources(
	sources: ReturnType<typeof captureVisualMarkdownSources>,
): void {
	try {
		for (const { kind, marker, source } of sources) {
			const output = marker.nextElementSibling;
			const target =
				"math" === kind
					? output?.matches(".easymde-math")
						? output
						: null
					: output?.matches(".easymde-mermaid")
						? output
						: output?.matches("pre")
							? output.querySelector(":scope > code.language-mermaid")
							: null;
			if (!target) {
				throw new Error("preview-enhancement-visual-source-missing");
			}
			target.setAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE, source);
		}
	} finally {
		removeVisualMarkdownSourceMarkers(sources);
	}
}

export function PreviewSurfaceOwner(props: PreviewSurfaceOwnerProps) {
	const surfaceRef = useRef<HTMLElement | null>(null);
	const ownedGapRef = useRef<PreviewOwnedGap | null>(null);
	const resumeDeferredEnhancementRef = useRef<(() => void) | null>(null);
	const scrollSnapshotRef = useRef<PendingPreviewScrollRestore | null>(null);
	const generationRef = useRef(0);
	const enhancementCandidateRef = useRef<PreviewEnhancementCandidate | null>(
		null,
	);
	const committedEnhancementCandidateRef =
		useRef<PreviewEnhancementCandidate | null>(null);
	const acceptedHtmlRevisionRef = useRef<number | null>(null);
	const sourceRevisionRef = useRef<number | null>(props.sourceRevision ?? null);
	sourceRevisionRef.current = props.sourceRevision ?? null;
	const currentSourceSnapshotRef = useRef(props.currentSourceSnapshot);
	currentSourceSnapshotRef.current = props.currentSourceSnapshot;
	const acceptedGeneratedPreviewRef = useRef<AcceptedGeneratedPreview | null>(
		null,
	);
	const stagedPreviewImageElementsRef =
		useRef<StagedPreviewImageElements | null>(null);
	const previewWindowRepositoryRef = useRef<PreviewWindowNodeRepository | null>(
		null,
	);
	const acceptedWindowBaselineRef = useRef<AcceptedWindowBaseline | null>(null);
	const pendingWindowBaselineRef = useRef<AcceptedWindowBaseline | null>(null);
	const acceptedWindowSnapshotRef =
		useRef<PreviewAcceptedWindowSnapshot | null>(null);
	const installedWindowSnapshotRef = useRef<PreviewAcceptedWindowSnapshot | null>(null);
	const pendingWindowCommitRef = useRef<MutablePreviewWindowCommit | null>(
		null,
	);
	const windowCommitKeyRef = useRef(0);
	const windowCommitPendingRef = useRef(false);
	const windowStyleEpochRef = useRef(0);
	const windowWidthEpochRef = useRef(0);
	const windowStyleSignatureRef = useRef("");
	const windowWidthRef = useRef<number | null>(null);
	const geometryPreparationKeyRef = useRef(0);
	const geometryPreparationRef =
		useRef<PreviewWindowGeometryPreparation | null>(null);
	const windowGeometryRequiresMeasuredRef = useRef(false);
	const installedWindowGeometryContextRef = useRef<string | null>(null);
	const pendingWindowFlowAnchorRef = useRef<PendingWindowFlowAnchor | null>(
		null,
	);
	const materializeCommitKeyRef = useRef(0);
	const materializePendingRef = useRef<PendingMaterialization | null>(null);
	const materializationPendingRef = useRef(false);
	const materializedOverrideRef = useRef(false);
	const ownerActiveRef = useRef(false);
	const documentEndPinRef = useRef<MutablePreviewDocumentEndPin | null>(null);
	const compositionSurfaceActivationRef = useRef(0);
	const compositionSurfaceLeasesRef = useRef(0);
	const compositionSurfaceHeldRef = useRef(false);
	const [compositionSurfaceVersion, setCompositionSurfaceVersion] = useState(0);
	const compositionSurfaceGate: SafePreviewHtmlSinkCompositionGate = {
		isHeld: () => compositionSurfaceHeldRef.current,
		version: compositionSurfaceVersion,
	};
	const retainCompositionSurfaceRef = useRef<
		(activation: number) => PreviewCompositionSurfaceLease
	>(() => {
		throw new Error("preview-composition-surface-inactive");
	});
	const prepareWindowBlockAdoptionRef = useRef<
		(node: HTMLElement) => (() => boolean) | null
	>(() => null);
	const prepareGeneratedContentTargetRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTarget"]
	>(() => null);
	const prepareGeneratedContentTargetBySelectionRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetBySelection"]
	>(() => null);
	const prepareGeneratedContentTargetForSelectionRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetForSelection"]
	>(() => null);
	const prepareImageTargetRef = useRef<
		PreviewSurfaceRuntime["prepareImageTarget"]
	>(() => null);
	const prepareImageTargetBySelectionRef = useRef<
		PreviewSurfaceRuntime["prepareImageTargetBySelection"]
	>(() => null);
	const getGeneratedPreviewIdentityRef = useRef<
		PreviewSurfaceRuntime["getGeneratedPreviewIdentity"]
	>(() => null);
	const getAcceptedWindowSnapshotRef = useRef<
		PreviewSurfaceRuntime["getAcceptedWindowSnapshot"]
	>(() => null);
	const materializeRef = useRef<
		(reportDiagnostics?: boolean) => Promise<boolean>
	>(() => Promise.resolve(false));
	const scheduleWindowRef = useRef<() => void>(() => undefined);
	const windowedRef = useRef(Boolean(props.windowed));
	windowedRef.current = Boolean(props.windowed);
	const layoutSyncedGenerationRef = useRef<number | null>(null);
	const emptyModeRef = useRef(props.emptyMode);
	emptyModeRef.current = props.emptyMode;
	const [state, setState] = useState<PreviewSurfaceState>(() =>
		initialState(props),
	);
	const stateRef = useRef<PreviewSurfaceState>(state);
	stateRef.current = state;

	const readCurrentSourceSnapshot = (): PreviewSourceSnapshot | null => {
		const snapshot = currentSourceSnapshotRef.current?.() ?? null;
		if (
			!snapshot ||
			!Number.isSafeInteger(snapshot.revision) ||
			snapshot.revision < 0 ||
			"string" !== typeof snapshot.value
		)
			return null;
		return snapshot;
	};

	const currentAcceptedGeneratedPreview = (
		accepted: AcceptedGeneratedPreview,
		surface: HTMLElement,
		verifySourceValue = false,
	): boolean => {
		const current = stateRef.current;
		const sourceSnapshot = readCurrentSourceSnapshot();
		return Boolean(
			ownerActiveRef.current &&
				sourceSnapshot &&
				sourceSnapshot.revision === accepted.sourceRevision &&
				(!verifySourceValue || sourceSnapshot.value === accepted.markdown) &&
				(sourceRevisionRef.current === null ||
					sourceRevisionRef.current === sourceSnapshot.revision) &&
				"html" === current.kind &&
				"ready" === current.phase &&
				current.generation === accepted.generation &&
				current.signature === accepted.signature &&
				current.editMap?.signature === accepted.signature &&
				surface.isConnected,
		);
	};

	const mintGeneratedContentTargetForBlock = (
		request: Readonly<{
			index: PreviewGeneratedContentTargetIndex;
			kind: GeneratedContentKind;
			ordinal: number;
		}>,
		accepted: AcceptedGeneratedPreview,
		blockId: string | null,
	): GeneratedContentTarget | null => {
		const sourceIndex = request.index;
		if (
			sourceIndex.revision !== accepted.sourceRevision ||
			sourceIndex.source !== accepted.markdown ||
			sourceIndex.length !== sourceIndex.source.length ||
			!Number.isSafeInteger(request.ordinal) ||
			request.ordinal < 0 ||
			!blockId ||
			!accepted.editMap ||
			accepted.editMap.signature !== accepted.signature
		)
			return null;
		const blockIndex = accepted.editMap.blocks.findIndex(
			(block) => block.id === blockId,
		);
		const block = accepted.editMap.blocks[blockIndex];
		if (!block?.editable || blockIndex < 0) return null;
		const blockRange = accepted.blockRanges.get(block.id);
		if (!blockRange) return null;
		const { end: blockEnd, start: blockStart } = blockRange;
		const acceptedPreview = {
			revision: accepted.generation,
			signature: accepted.signature,
		};
		if ("math" === request.kind) {
			const spans = sourceIndex.mathSpans.filter(
				(span) => span.from >= blockStart && span.to <= blockEnd,
			);
			const associated = associateGeneratedContentTarget({
				acceptedPreview,
				blockId: block.id,
				kind: request.kind,
				mathSpans: spans,
				ordinal: request.ordinal,
				source: sourceIndex.source,
				sourceRevision: accepted.sourceRevision,
			});
			return "associated" === associated.status ? associated.target : null;
		}
		const mermaidOriginals = sourceIndex.blocks
			.filter(
				(sourceBlock) =>
					"code" === sourceBlock.kind &&
					sourceBlock.from >= blockStart &&
					sourceBlock.to <= blockEnd,
			)
			.map((sourceBlock) =>
				mermaidOriginalForCodeBlock(sourceIndex.source, sourceBlock),
			)
			.filter(
				(original): original is GeneratedContentOriginal => null !== original,
			);
		const original = mermaidOriginals[request.ordinal];
		if (!original) return null;
		const associated = associateGeneratedContentTarget({
			acceptedPreview,
			blockId: block.id,
			kind: request.kind,
			ordinal: request.ordinal,
			original,
			source: sourceIndex.source,
			sourceRevision: accepted.sourceRevision,
		});
		return "associated" === associated.status ? associated.target : null;
	};

	const mintGeneratedContentTarget = (
		request: PreviewGeneratedContentTargetRequest,
		accepted: AcceptedGeneratedPreview,
	): GeneratedContentTarget | null =>
		mintGeneratedContentTargetForBlock(
			request,
			accepted,
			request.element
				.closest("[data-easymde-visual-block-id]")
				?.getAttribute("data-easymde-visual-block-id") ?? null,
		);

	const generatedRootsForBlock = (
		block: HTMLElement,
		kind: GeneratedContentTarget["kind"],
	): ReadonlyArray<HTMLElement> => {
		const selector = "math" === kind ? ".easymde-math" : ".easymde-mermaid";
		const roots = block.matches(selector)
			? [block, ...Array.from(block.querySelectorAll<HTMLElement>(selector))]
			: Array.from(block.querySelectorAll<HTMLElement>(selector));
		return roots.filter(
			(root) =>
				root.closest("[data-easymde-visual-block-id]") === block &&
				(root === block || root.parentElement?.closest(selector) === null),
		);
	};

	const currentGeneratedContentTarget = (
		request: Readonly<{ element: Element; target: GeneratedContentTarget }>,
		accepted: AcceptedGeneratedPreview,
		surface: HTMLElement,
		verifySourceValue = false,
	): boolean => {
		const target = request.target;
		if (
			!currentAcceptedGeneratedPreview(accepted, surface, verifySourceValue) ||
			target.sourceRevision !== accepted.sourceRevision ||
			target.acceptedPreview.revision !== accepted.generation ||
			target.acceptedPreview.signature !== accepted.signature ||
			request.element.ownerDocument !== surface.ownerDocument ||
			!surface.contains(request.element) ||
			!request.element.isConnected
		)
			return false;
		if (
			!accepted.editMap ||
			accepted.editMap.signature !== accepted.signature
		) {
			return false;
		}
		const blockRange = accepted.blockRanges.get(target.blockId);
		const blockIndex = blockRange?.index ?? -1;
		const block = accepted.editMap.blocks[blockIndex];
		if (!blockRange || !block?.editable || blockIndex < 0) return false;
		const { end: blockEnd, start: blockStart } = blockRange;
		if (
			target.original.fullRange.from < blockStart ||
			target.original.fullRange.to > blockEnd ||
			accepted.markdown.slice(
				target.original.fullRange.from,
				target.original.fullRange.to,
			) !== target.original.full ||
			accepted.markdown.slice(
				target.original.bodyRange.from,
				target.original.bodyRange.to,
			) !== target.original.body
		)
			return false;
		const visualBlock = request.element.closest(
			"[data-easymde-visual-block-id]",
		);
		if (
			!(visualBlock instanceof HTMLElement) ||
			visualBlock.getAttribute("data-easymde-visual-block-id") !==
				target.blockId
		)
			return false;
		if ("math" === target.kind) {
			if (
				!request.element.matches(".easymde-math") ||
				1 !== request.element.querySelectorAll(".katex-mathml > math").length
			)
				return false;
		} else if (
			!request.element.matches(".easymde-mermaid") ||
			1 !== request.element.querySelectorAll("svg").length
		)
			return false;
		if (!windowedRef.current) return true;
		const repository = previewWindowRepositoryRef.current;
		if (
			!repository ||
			repository.context.revision !== accepted.generation ||
			repository.context.signature !== accepted.signature ||
			repository.indexById.get(target.blockId) !== blockIndex ||
			repository.nodes[blockIndex] !== visualBlock
		)
			return false;
		return true;
	};

	const generatedRootForTarget = (
		target: GeneratedContentTarget,
		surface: HTMLElement,
	): HTMLElement | null => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const blockRange = accepted?.blockRanges.get(target.blockId);
		if (!accepted || !blockRange) return null;
		const repository = previewWindowRepositoryRef.current;
		const block = windowedRef.current
			? repository?.nodes[blockRange.index]
			: surface.children[blockRange.index];
		if (
			!(block instanceof HTMLElement) ||
			block.getAttribute("data-easymde-visual-block-id") !== target.blockId
		)
			return null;
		return generatedRootsForBlock(block, target.kind)[target.ordinal] ?? null;
	};

	const createGeneratedContentTargetLease = (
		target: GeneratedContentTarget,
		element: Element,
		accepted: AcceptedGeneratedPreview,
		surface: HTMLElement,
		onRelease?: () => void,
		parentIsCurrent?: () => boolean,
	): PreviewGeneratedContentTargetLease | null => {
		const targetRequest = { element, target };
		if (
			generatedRootForTarget(target, surface) !== element ||
			!currentGeneratedContentTarget(targetRequest, accepted, surface, true)
		) {
			return null;
		}
		let released = false;
		return {
			isCurrent: () =>
				!released &&
				(parentIsCurrent?.() ?? true) &&
				Boolean(acceptedGeneratedPreviewRef.current) &&
				currentGeneratedContentTarget(targetRequest, accepted, surface),
			release: () => {
				if (released) return;
				released = true;
				onRelease?.();
			},
			root: element,
			target,
		};
	};

	const prepareImageTargetRefValue = (
		request: PreviewImageTargetRequest,
		accepted: AcceptedGeneratedPreview,
		surface: HTMLElement,
		parentIsCurrent?: () => boolean,
	): PreviewImageTargetLease | null => {
		const element = request.element;
		if (!element.isConnected || !surface.contains(element)) return null;
		const visualBlock = element.closest("[data-easymde-visual-block-id]");
		if (!(visualBlock instanceof HTMLElement)) return null;
		const blockId = visualBlock.getAttribute("data-easymde-visual-block-id");
		const blockRange = blockId ? accepted.blockRanges.get(blockId) : null;
		const block = blockRange
			? accepted.editMap?.blocks[blockRange.index]
			: null;
		if (!blockId || !blockRange || !block?.editable) return null;
		const domImages = Array.from(visualBlock.querySelectorAll("img")).filter(
			(image) =>
				image.closest("[data-easymde-visual-block-id]") === visualBlock,
		);
		const ordinal = domImages.indexOf(element);
		if (ordinal < 0) return null;
		const sourceBlocks = request.index.blocks.filter(
			(sourceBlock) =>
				sourceBlock.from >= blockRange.start &&
				sourceBlock.to <= blockRange.end &&
				sourceBlock.from < sourceBlock.to &&
				sourceBlock.kind !== "code" &&
				sourceBlock.kind !== "unavailable" &&
				request.selection.start >= sourceBlock.from &&
				request.selection.end <= sourceBlock.to &&
				request.index.images.some(
					(image) =>
						image.start >= sourceBlock.from && image.end <= sourceBlock.to,
				),
		);
		if (1 !== sourceBlocks.length) return null;
		const sourceBlock = sourceBlocks[0];
		if (!sourceBlock) return null;
		const targetBlock = {
			editable: sourceBlock.editable,
			end: sourceBlock.to,
			id: blockId,
			kind: sourceBlock.kind,
			start: sourceBlock.from,
		};
		const sourceCount = generatedImageTargetCount({
			block: targetBlock,
			index: request.index,
		});
		if (null === sourceCount || sourceCount !== domImages.length) return null;
		const associated = associateGeneratedImageTargetBySelection({
			acceptedPreview: {
				revision: accepted.generation,
				signature: accepted.signature,
			},
			block: targetBlock,
			index: request.index,
			selection: request.selection,
			sourceRevision: accepted.sourceRevision,
		});
		if ("failed" === associated.status) return null;
		if (associated.target.ordinal !== ordinal) return null;
		const stagedImages = stagedPreviewImageElementsRef.current;
		if (
			!stagedImages ||
			stagedImages.generation !== accepted.generation ||
			stagedImages.byBlock.get(blockId)?.[ordinal] !== element
		)
			return null;
		const capturedAttributes = {
			alt: element.getAttribute("alt"),
			currentSrc: element.currentSrc,
			naturalHeight: element.naturalHeight,
			naturalWidth: element.naturalWidth,
			src: element.getAttribute("src"),
			srcset: element.getAttribute("srcset"),
			sizes: element.getAttribute("sizes"),
			title: element.getAttribute("title"),
		};
		const target = associated.target;
		const isCurrent = (): boolean =>
			Boolean(
				acceptedGeneratedPreviewRef.current &&
					currentAcceptedGeneratedPreview(accepted, surface) &&
					element.isConnected &&
					surface.contains(element) &&
					element.closest("[data-easymde-visual-block-id]") === visualBlock &&
					Array.from(
						visualBlock.querySelectorAll<HTMLImageElement>("img"),
					).filter(
						(image) =>
							image.closest("[data-easymde-visual-block-id]") === visualBlock,
					)[target.ordinal] === element &&
					element.getAttribute("src") === capturedAttributes.src &&
					element.currentSrc === capturedAttributes.currentSrc &&
					element.naturalHeight === capturedAttributes.naturalHeight &&
					element.naturalWidth === capturedAttributes.naturalWidth &&
					element.getAttribute("srcset") === capturedAttributes.srcset &&
					element.getAttribute("sizes") === capturedAttributes.sizes &&
					element.getAttribute("alt") === capturedAttributes.alt &&
					element.getAttribute("title") === capturedAttributes.title &&
					target.sourceRevision === accepted.sourceRevision &&
					target.acceptedPreview.revision === accepted.generation &&
					target.acceptedPreview.signature === accepted.signature &&
					accepted.markdown.slice(
						target.original.start,
						target.original.end,
					) === target.original.raw,
			);
		if (!isCurrent()) return null;
		let released = false;
		return {
			isCurrent: () =>
				!released && (parentIsCurrent?.() ?? true) && isCurrent(),
			release: () => {
				if (released) return;
				released = true;
			},
			root: element,
			target,
		};
	};

	const imageElementForTarget = (
		target: GeneratedImageTarget,
		surface: HTMLElement,
	): HTMLImageElement | null => {
		const stagedImages = stagedPreviewImageElementsRef.current;
		if (!stagedImages) return null;
		const element = stagedImages.byBlock.get(target.blockId)?.[target.ordinal];
		return element && surface.contains(element) ? element : null;
	};

	const imageTargetDomIdentityCurrent = (
		target: GeneratedImageTarget,
		surface: HTMLElement,
	): boolean => {
		const expected = stagedPreviewImageElementsRef.current?.byBlock.get(
			target.blockId,
		)?.[target.ordinal];
		if (!expected) return false;
		if (!expected.isConnected) return windowedRef.current;
		const visualBlock = expected.closest("[data-easymde-visual-block-id]");
		if (
			!(visualBlock instanceof HTMLElement) ||
			!surface.contains(visualBlock)
		) {
			return false;
		}
		const images = Array.from(
			visualBlock.querySelectorAll<HTMLImageElement>("img"),
		).filter(
			(image) =>
				image.closest("[data-easymde-visual-block-id]") === visualBlock,
		);
		return images[target.ordinal] === expected;
	};

	const imageTargetForSelection = (
		request: PreviewImageTargetSelectionRequest,
		accepted: AcceptedGeneratedPreview,
		blockRange: Readonly<{ end: number; start: number }>,
		blockId: string,
	): GeneratedImageTarget | null => {
		const candidates: GeneratedImageTarget[] = [];
		for (const sourceBlock of request.index.blocks) {
			if (
				sourceBlock.from < blockRange.start ||
				sourceBlock.to > blockRange.end ||
				sourceBlock.from >= sourceBlock.to ||
				!sourceBlock.editable ||
				"code" === sourceBlock.kind ||
				"unavailable" === sourceBlock.kind
			)
				continue;
			const associated = associateGeneratedImageTargetBySelection({
				acceptedPreview: {
					revision: accepted.generation,
					signature: accepted.signature,
				},
				block: {
					editable: sourceBlock.editable,
					end: sourceBlock.to,
					id: blockId,
					kind: sourceBlock.kind,
					start: sourceBlock.from,
				},
				index: request.index,
				selection: request.selection,
				sourceRevision: accepted.sourceRevision,
			});
			if ("associated" === associated.status)
				candidates.push(associated.target);
		}
		return 1 === candidates.length ? (candidates[0] ?? null) : null;
	};

	getGeneratedPreviewIdentityRef.current = () => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const surface = surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!currentAcceptedGeneratedPreview(accepted, surface, true)
		)
			return null;
		return {
			editMap: accepted.editMap,
			revision: accepted.generation,
			signature: accepted.signature,
			sourceRevision: accepted.sourceRevision,
		};
	};

	getAcceptedWindowSnapshotRef.current = () => {
		const accepted = acceptedWindowSnapshotRef.current ?? installedWindowSnapshotRef.current;
		const surface = surfaceRef.current;
		const current = stateRef.current;
		const repository = previewWindowRepositoryRef.current;
		const commit = "html" === current.kind ? current.windowedCommit : null;
		if (
			!accepted ||
			!surface?.isConnected ||
			!ownerActiveRef.current ||
			!windowedRef.current ||
			windowCommitPendingRef.current ||
			materializationPendingRef.current ||
			!repository ||
			!commit ||
			"html" !== current.kind ||
			!["ready", "committing"].includes(current.phase) ||
			("committing" === current.phase && windowCommitPendingRef.current) ||
			current.generation !== accepted.revision ||
			current.htmlRevision !== accepted.revision ||
			current.signature !== accepted.signature ||
			generationRef.current !== accepted.revision ||
			repository.context.revision !== accepted.revision ||
			repository.context.signature !== accepted.signature ||
			commit.key !== accepted.key ||
			commit.revision !== accepted.revision ||
			!hasExactSurfaceChildren(surface, accepted.nodes) ||
			!hasExactSurfaceChildren(surface, commit.nodes) ||
			accepted.nodes.length !== commit.nodes.length ||
			accepted.nodes.some((node, index) => commit.nodes[index] !== node)
		)
			return null;
		if (accepted.sourceRevision !== undefined) {
			const source = readCurrentSourceSnapshot();
			// This certifies accepted content, not a live input lease.
			// Preserve its recorded epoch; input owners compare that epoch with
			// their current revision/history before authorizing any mutation.
			if (!source || source.value !== acceptedWindowBaselineRef.current?.markdown) return null;
		}
		try {
			validatePreviewWindowRepository(repository);
		} catch {
			return null;
		}
		for (const block of accepted.blocks) {
			const index = repository.indexById.get(block.id);
			const currentBlock =
				undefined !== index ? repository.blocks[index] : null;
			if (
				!currentBlock ||
				currentBlock.map.id !== block.id ||
				currentBlock.node !== block.node ||
				undefined === index ||
				repository.nodes[index] !== block.node ||
				block.node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id
			)
				return null;
		}
		return accepted;
	};

	prepareGeneratedContentTargetRef.current = (request) => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const surface = surfaceRef.current;
		if (!accepted || !surface) return null;
		const target = mintGeneratedContentTarget(request, accepted);
		if (!target) return null;
		return createGeneratedContentTargetLease(
			target,
			request.element,
			accepted,
			surface,
		);
	};

	prepareGeneratedContentTargetBySelectionRef.current = (request) => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const surface = surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!accepted.editMap ||
			!windowedRef.current ||
			null === accepted.requestRevision
		)
			return null;
		const targetIndices = previewSourceSelectionBlockIndices(
			accepted.markdown,
			accepted.editMap,
			accepted.signature,
			request.selection,
		);
		if (1 !== targetIndices.length) return null;
		const blockIndex = targetIndices[0];
		if (undefined === blockIndex) return null;
		const block = accepted.editMap.blocks[blockIndex];
		if (!block?.editable) return null;
		const target = mintGeneratedContentTargetForBlock(
			request,
			accepted,
			block.id,
		);
		if (
			!target ||
			!generatedTargetMatchesSourceSelection(target, request.selection)
		)
			return null;
		if (documentEndPinRef.current) {
			throw new Error("preview-window-generated-target-pin-already-active");
		}
		const pin: MutablePreviewDocumentEndPin = {
			generation: accepted.generation,
			requestRevision: accepted.requestRevision,
			signature: accepted.signature,
			sourceSelection: request.selection,
			targetIndices,
		};
		documentEndPinRef.current = pin;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			clearDocumentEndPin(pin, true);
		};
		const getLease = (): PreviewGeneratedContentTargetLease | null => {
			if (
				released ||
				documentEndPinRef.current !== pin ||
				!currentAcceptedGeneratedPreview(accepted, surface, true)
			)
				return null;
			const element = generatedRootForTarget(target, surface);
			if (!element) return null;
			return createGeneratedContentTargetLease(
				target,
				element,
				accepted,
				surface,
				release,
				() => !released && documentEndPinRef.current === pin,
			);
		};
		scheduleWindowRef.current();
		return {
			getLease,
			isCurrent: () =>
				!released &&
				documentEndPinRef.current === pin &&
				currentAcceptedGeneratedPreview(accepted, surface),
			release,
			target,
		};
	};

	prepareGeneratedContentTargetForSelectionRef.current = (request) => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const surface = surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!accepted.editMap ||
			request.index.source !== accepted.markdown ||
			request.index.revision !== accepted.sourceRevision ||
			request.index.length !== request.index.source.length ||
			!currentAcceptedGeneratedPreview(accepted, surface, true)
		)
			return null;
		const targetIndices = previewImageSelectionBlockIndices(
			accepted.markdown,
			accepted.editMap,
			accepted.signature,
			request.selection,
			{
				editableBlockRanges: accepted.editableBlockRanges,
				lineStarts: accepted.lineStarts,
			},
		);
		if (1 !== targetIndices.length) return null;
		const blockIndex = targetIndices[0];
		if (undefined === blockIndex) return null;
		const block = accepted.editMap.blocks[blockIndex];
		if (!block?.editable) return null;
		const candidate = generatedContentTargetForSelection(
			request,
			accepted,
			block.id,
		);
		if (!candidate) return null;
		if (documentEndPinRef.current) {
			throw new Error("preview-window-generated-target-pin-already-active");
		}
		const getMountedLease = (
			parentIsCurrent?: () => boolean,
		): PreviewGeneratedContentTargetLease | null => {
			const element = generatedRootForTarget(candidate.target, surface);
			if (!element) return null;
			return createGeneratedContentTargetLease(
				candidate.target,
				element,
				accepted,
				surface,
				undefined,
				parentIsCurrent,
			);
		};
		if (!windowedRef.current) {
			let released = false;
			return {
				getLease: () =>
					released || !currentAcceptedGeneratedPreview(accepted, surface, true)
						? null
						: getMountedLease(() => !released),
				isCurrent: () =>
					!released && currentAcceptedGeneratedPreview(accepted, surface, true),
				release: () => {
					released = true;
				},
				target: candidate.target,
			};
		}
		if (null === accepted.requestRevision) return null;
		const pin: MutablePreviewDocumentEndPin = {
			generation: accepted.generation,
			requestRevision: accepted.requestRevision,
			signature: accepted.signature,
			sourceSelection: request.selection,
			targetIndices,
		};
		documentEndPinRef.current = pin;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			clearDocumentEndPin(pin, true);
		};
		const getLease = (): PreviewGeneratedContentTargetLease | null => {
			if (
				released ||
				documentEndPinRef.current !== pin ||
				!currentAcceptedGeneratedPreview(accepted, surface, true)
			)
				return null;
			return getMountedLease(
				() => !released && documentEndPinRef.current === pin,
			);
		};
		scheduleWindowRef.current();
		return {
			getLease,
			isCurrent: () =>
				!released &&
				documentEndPinRef.current === pin &&
				currentAcceptedGeneratedPreview(accepted, surface, true),
			release,
			target: candidate.target,
		};
	};

	prepareImageTargetRef.current = (request) => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const surface = surfaceRef.current;
		if (!accepted || !surface) return null;
		if (
			!request.index.complete ||
			request.index.source !== accepted.markdown ||
			request.index.revision !== accepted.sourceRevision ||
			request.index.length !== request.index.source.length
		)
			return null;
		return prepareImageTargetRefValue(request, accepted, surface);
	};

	prepareImageTargetBySelectionRef.current = (request) => {
		const accepted = acceptedGeneratedPreviewRef.current;
		const surface = surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!accepted.editMap ||
			!request.index.complete ||
			request.index.source !== accepted.markdown ||
			request.index.revision !== accepted.sourceRevision ||
			request.index.length !== request.index.source.length ||
			!currentAcceptedGeneratedPreview(accepted, surface, true) ||
			!Number.isSafeInteger(request.selection.start) ||
			!Number.isSafeInteger(request.selection.end) ||
			request.selection.start < 0 ||
			request.selection.end < request.selection.start ||
			request.selection.end > request.index.source.length
		)
			return null;
		const targetIndices = previewImageSelectionBlockIndices(
			accepted.markdown,
			accepted.editMap,
			accepted.signature,
			request.selection,
			{
				editableBlockRanges: accepted.editableBlockRanges,
				lineStarts: accepted.lineStarts,
			},
		);
		if (1 !== targetIndices.length) return null;
		const blockIndex = targetIndices[0];
		if (undefined === blockIndex) return null;
		const block = accepted.editMap.blocks[blockIndex];
		const blockRange = block ? accepted.blockRanges.get(block.id) : null;
		if (!block?.editable || !blockRange) return null;
		const target = imageTargetForSelection(
			request,
			accepted,
			blockRange,
			block.id,
		);
		if (!target) return null;
		if (documentEndPinRef.current) {
			throw new Error("preview-window-generated-target-pin-already-active");
		}
		const getMountedLease = (
			parentIsCurrent?: () => boolean,
		): PreviewImageTargetLease | null => {
			const element = imageElementForTarget(target, surface);
			if (!element) return null;
			const lease = prepareImageTargetRefValue(
				{ element, index: request.index, selection: request.selection },
				accepted,
				surface,
				parentIsCurrent,
			);
			if (
				!lease ||
				lease.target.blockId !== target.blockId ||
				lease.target.ordinal !== target.ordinal ||
				lease.target.original.start !== target.original.start ||
				lease.target.original.end !== target.original.end
			) {
				lease?.release();
				return null;
			}
			return lease;
		};
		if (!windowedRef.current) {
			let released = false;
			return {
				getLease: () =>
					released || !currentAcceptedGeneratedPreview(accepted, surface, true)
						? null
						: getMountedLease(() => !released),
				isCurrent: () =>
					!released &&
					currentAcceptedGeneratedPreview(accepted, surface, true) &&
					imageTargetDomIdentityCurrent(target, surface),
				release: () => {
					released = true;
				},
				target,
			};
		}
		if (null === accepted.requestRevision) return null;
		const pin: MutablePreviewDocumentEndPin = {
			generation: accepted.generation,
			requestRevision: accepted.requestRevision,
			signature: accepted.signature,
			sourceSelection: request.selection,
			targetIndices: [blockIndex],
		};
		documentEndPinRef.current = pin;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			clearDocumentEndPin(pin, true);
		};
		const getLease = (): PreviewImageTargetLease | null => {
			if (
				released ||
				documentEndPinRef.current !== pin ||
				!currentAcceptedGeneratedPreview(accepted, surface, true)
			)
				return null;
			return getMountedLease(
				() => !released && documentEndPinRef.current === pin,
			);
		};
		scheduleWindowRef.current();
		return {
			getLease,
			isCurrent: () =>
				!released &&
				documentEndPinRef.current === pin &&
				currentAcceptedGeneratedPreview(accepted, surface, true) &&
				imageTargetDomIdentityCurrent(target, surface),
			release,
			target,
		};
	};

	function clearDocumentEndPin(
		pin: MutablePreviewDocumentEndPin,
		reconcile: boolean,
	): void {
		if (documentEndPinRef.current !== pin) return;
		documentEndPinRef.current = null;
		const repository = previewWindowRepositoryRef.current;
		if (
			reconcile &&
			ownerActiveRef.current &&
			pin.targetIndices.length > 0 &&
			repository?.context.revision === pin.generation &&
			repository.context.signature === pin.signature
		) {
			scheduleWindowRef.current();
		}
	}

	function prepareDocumentEndWindowPin(
		signature: string,
		sourceSelection?: PreviewSourceSelection,
	): PreviewDocumentEndPinLease {
		if (!ownerActiveRef.current) {
			throw new Error("preview-window-document-end-owner-inactive");
		}
		if (!windowedRef.current || !signature) {
			throw new Error("preview-window-document-end-pin-unavailable");
		}
		if (
			sourceSelection &&
			(!Number.isSafeInteger(sourceSelection.start) ||
				!Number.isSafeInteger(sourceSelection.end) ||
				sourceSelection.start < 0 ||
				sourceSelection.end < sourceSelection.start)
		) {
			throw new Error("preview-window-selection-range-invalid");
		}
		if (documentEndPinRef.current) {
			throw new Error("preview-window-document-end-pin-already-active");
		}
		const pin: MutablePreviewDocumentEndPin = {
			generation: null,
			requestRevision: null,
			signature,
			sourceSelection: sourceSelection ?? null,
			targetIndices: [],
		};
		documentEndPinRef.current = pin;
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				clearDocumentEndPin(pin, true);
			},
		};
	}

	function bindDocumentEndPin(
		requestState: PreviewRequestState,
		generation: number,
	): void {
		const pin = documentEndPinRef.current;
		if (!pin) return;
		if (
			"loading" === requestState.kind &&
			null === pin.requestRevision &&
			requestState.request.signature === pin.signature
		) {
			pin.requestRevision = requestState.revision;
			pin.generation = generation;
			return;
		}
		if (
			"success" === requestState.kind &&
			pin.requestRevision === requestState.revision &&
			requestState.request.signature === pin.signature
		) {
			pin.generation = generation;
			return;
		}
		clearDocumentEndPin(pin, false);
	}

	const windowStyleSignature = `${previewWindowGeometryClassName(
		props.className,
	)}:${JSON.stringify(props.style ?? {})}`;
	if (windowStyleSignatureRef.current !== windowStyleSignature) {
		windowStyleSignatureRef.current = windowStyleSignature;
		windowStyleEpochRef.current += 1;
	}

	const discardPendingWork = useCallback(() => {
		geometryPreparationRef.current?.controller.abort();
		geometryPreparationRef.current = null;
		const pendingMaterialization = materializePendingRef.current;
		if (pendingMaterialization) {
			materializePendingRef.current = null;
			materializationPendingRef.current = false;
			pendingMaterialization.resolve(false);
		}
		materializedOverrideRef.current = false;
		pendingWindowCommitRef.current = null;
		windowCommitPendingRef.current = false;
		installedWindowGeometryContextRef.current = null;
		pendingWindowFlowAnchorRef.current = null;
		pendingWindowBaselineRef.current = null;
		acceptedWindowSnapshotRef.current = null;
		installedWindowSnapshotRef.current = null;
		discardEnhancementCandidate(enhancementCandidateRef.current);
		enhancementCandidateRef.current = null;
	}, []);

	const discardStaging = useCallback(() => {
		discardPendingWork();
		discardEnhancementCandidate(committedEnhancementCandidateRef.current);
		committedEnhancementCandidateRef.current = null;
		previewWindowRepositoryRef.current = null;
	}, [discardPendingWork]);

	const reconcileInstalledWindowCommit = useCallback(
		(
			repository: PreviewWindowNodeRepository,
			surface: HTMLElement,
			commit: Readonly<{ nodes: ReadonlyArray<Node>; revision: number }>,
		): void => {
			const epoch = previewWindowGeometryEpochKey(repository.context);
			for (const node of commit.nodes) {
				if (
					!(node instanceof HTMLElement) ||
					!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
				)
					continue;
				const reconciliation = reconcilePreviewWindowSpacerFlow(
					repository,
					surface,
					node,
					epoch,
				);
				if (!reconciliation) continue;
				repository.spacerContentHeights.set(
					`${reconciliation.range.start}:${reconciliation.range.end}`,
					{ epoch, height: reconciliation.contentHeight },
				);
			}
		},
		[],
	);

	const onStagedCommit = useCallback(
		(revision: number) => {
			windowCommitPendingRef.current = false;
			if (pendingWindowCommitRef.current?.revision === revision) {
				pendingWindowCommitRef.current = null;
			}
			const repository = previewWindowRepositoryRef.current;
			if (repository && repository.context.revision !== revision) {
				previewWindowRepositoryRef.current = null;
			}
			const candidate = committedEnhancementCandidateRef.current;
			if (candidate?.generation === revision) {
				const sourceRevision = sourceRevisionRef.current;
				const sourceSnapshot = readCurrentSourceSnapshot();
				if (
					ownerActiveRef.current &&
					sourceSnapshot &&
					sourceSnapshot.value === candidate.markdown &&
					(sourceRevision === null ||
						sourceRevision === sourceSnapshot.revision) &&
					candidate.signature
				) {
					acceptedGeneratedPreviewRef.current =
						acceptedGeneratedPreviewFromCandidate(
							candidate,
							sourceSnapshot.revision,
						);
				} else {
					acceptedGeneratedPreviewRef.current = null;
				}
				candidate.surface.remove();
				committedEnhancementCandidateRef.current = null;
			}
			const committingState = stateRef.current;
			if (
				windowedRef.current &&
				"html" === committingState.kind &&
				("committing" === committingState.phase ||
					"ready" === committingState.phase) &&
				committingState.windowedCommit?.revision === revision
			) {
				const pendingBaseline = pendingWindowBaselineRef.current;
				if (
					pendingBaseline?.revision === revision &&
					pendingBaseline.signature === committingState.signature
				) {
					const installedSource = readCurrentSourceSnapshot();
					// The formal frame may have waited behind a revoked IME lease.
					// Certify its exact source at installation; this renews content
					// ownership only, never the old input/history capability.
					acceptedWindowBaselineRef.current = installedSource && installedSource.value === pendingBaseline.markdown
						? Object.freeze({ ...pendingBaseline, sourceRevision: installedSource.revision })
						: pendingBaseline;
					pendingWindowBaselineRef.current = null;
				}
				const repository = previewWindowRepositoryRef.current;
				const surface = surfaceRef.current;
				let deferAnchorVerification = false;
				if (repository && surface) {
					try {
						reconcileInstalledWindowCommit(
							repository,
							surface,
							committingState.windowedCommit,
						);
						const pendingAnchor = pendingWindowFlowAnchorRef.current;
						if (
							pendingAnchor?.node.isConnected &&
							!hasMeasuredMountedPreviewWindowGeometry(
								repository,
								surface,
								pendingAnchor,
							)
						) {
							deferAnchorVerification = true;
							scheduleWindowRef.current();
						} else {
							pendingWindowFlowAnchorRef.current = null;
							if (pendingAnchor) {
								verifyPreviewWindowFlowAnchor(surface, pendingAnchor);
							}
						}
					} catch (error) {
						pendingWindowFlowAnchorRef.current = null;
						acceptedWindowSnapshotRef.current = null;
						installedWindowSnapshotRef.current = null;
						props.onDiagnostic?.(previewFailureCode(error));
						previewWindowRepositoryRef.current = null;
						setState((current) =>
							"html" === current.kind && current.generation === revision
								? {
										...current,
										phase: "failed",
										signature: "",
										materializeCommit: null,
										stagedCommit: null,
										windowedCommit: retainedWindowedCommit(current),
										windowedFailure: true,
									}
								: current,
						);
						return;
					}
				}
				installedWindowSnapshotRef.current = repository && surface
					? createAcceptedWindowSnapshot(surface, repository, committingState.windowedCommit, committingState, acceptedWindowBaselineRef.current)
					: null;
				if (!deferAnchorVerification) {
					acceptedWindowSnapshotRef.current = installedWindowSnapshotRef.current;
					installedWindowGeometryContextRef.current = repository
						? previewWindowGeometryEpochKey(repository.context)
						: null;
					if (acceptedWindowSnapshotRef.current) {
						props.onWindowReady?.();
					}
				} else {
					acceptedWindowSnapshotRef.current = null;
					installedWindowGeometryContextRef.current = null;
				}
			} else {
				acceptedWindowSnapshotRef.current = null;
				installedWindowSnapshotRef.current = null;
				installedWindowGeometryContextRef.current = null;
			}
			if (
				ownerActiveRef.current &&
				generationRef.current === revision &&
				"html" === committingState.kind &&
				committingState.generation === revision &&
				committingState.htmlRevision === revision &&
				"committing" === committingState.phase
			) {
				acceptedHtmlRevisionRef.current = revision;
			}
			const finish = () => {
				if (!ownerActiveRef.current || generationRef.current !== revision)
					return;
				setState((current) =>
					"html" === current.kind &&
					current.generation === revision &&
					"committing" === current.phase &&
					(current.stagedCommit?.revision === revision ||
						current.windowedCommit?.revision === revision)
						? { ...current, phase: "ready", stagedCommit: null }
						: current,
				);
				scheduleWindowRef.current();
			};
			const fail = (error: unknown) => {
				if (!ownerActiveRef.current || generationRef.current !== revision)
					return;
				const documentEndPin = documentEndPinRef.current;
				if (documentEndPin?.generation === revision) {
					clearDocumentEndPin(documentEndPin, false);
				}
				if (scrollSnapshotRef.current?.generation === revision) {
					scrollSnapshotRef.current = null;
				}
				props.onDiagnostic?.(previewFailureCode(error));
				previewWindowRepositoryRef.current = null;
				setState((current) =>
					"html" === current.kind &&
					current.generation === revision &&
					"committing" === current.phase
						? {
								...current,
								phase: "failed",
								signature: "",
								stagedCommit: null,
								windowedCommit: null,
								windowedFailure: true,
							}
						: current,
				);
			};
			const current = stateRef.current;
			if (
				windowedRef.current &&
				"html" === current.kind &&
				"committing" === current.phase &&
				previewNeedsWindow(current.editMap)
			) {
				const surface = surfaceRef.current;
				if (!surface) throw new Error("preview-surface-missing");
				const scheduler =
					props.stagingScheduler ??
					defaultPreviewSurfaceStagingScheduler(surface.ownerDocument);
				void scheduler.yield().then(finish, fail);
				return;
			}
			finish();
		},
		[
			props.onDiagnostic,
			props.onWindowReady,
			props.stagingScheduler,
			reconcileInstalledWindowCommit,
		],
	);

	const generatedContentTargetForSelection = (
		request: PreviewGeneratedContentTargetForSelectionRequest,
		accepted: AcceptedGeneratedPreview,
		blockId: string,
	): Readonly<{
		kind: GeneratedContentKind;
		ordinal: number;
		target: GeneratedContentTarget;
	}> | null => {
		const blockRange = accepted.blockRanges.get(blockId);
		if (!blockRange) return null;
		const acceptedPreview = {
			revision: accepted.generation,
			signature: accepted.signature,
		};
		type PendingCandidate =
			| Readonly<{
					kind: "math";
					mathSpans: ReadonlyArray<EditorMarkdownMathSpan>;
					ordinal: number;
			  }>
			| Readonly<{
					kind: "mermaid";
					ordinal: number;
					original: GeneratedContentOriginal;
			  }>;
		const candidates: PendingCandidate[] = [];
		const mathSpans = request.index.mathSpans;
		const mathBlockStart = lowerBoundByFrom(mathSpans, blockRange.start);
		const mathBlockEnd = lowerBoundByFrom(mathSpans, blockRange.end);
		const mathSelectionPivot = lowerBoundByFrom(
			mathSpans,
			request.selection.start,
		);
		const mathCandidateIndices = [
			mathSelectionPivot - 1,
			mathSelectionPivot,
		].filter(
			(index, position, indices) =>
				index >= mathBlockStart &&
				index < mathBlockEnd &&
				indices.indexOf(index) === position,
		);
		const matchingMathIndices = mathCandidateIndices.filter((index) => {
			const span = mathSpans[index];
			return Boolean(
				span &&
					span.from >= blockRange.start &&
					span.to <= blockRange.end &&
					sourceSelectionMatchesGeneratedRanges(
						request.selection,
						{ from: span.from, to: span.to },
						{ from: span.bodyFrom, to: span.bodyTo },
					),
			);
		});
		if (1 === matchingMathIndices.length) {
			const mathIndex = matchingMathIndices[0];
			if (undefined !== mathIndex) {
				candidates.push({
					kind: "math",
					mathSpans: mathSpans.slice(mathBlockStart, mathBlockEnd),
					ordinal: mathIndex - mathBlockStart,
				});
			}
		} else if (matchingMathIndices.length > 1) {
			return null;
		}

		const sourceBlocks = request.index.blocks;
		const sourceBlockStart = lowerBoundByFrom(sourceBlocks, blockRange.start);
		const sourceBlockEnd = lowerBoundByFrom(sourceBlocks, blockRange.end);
		const mermaidSelectionPivot = lowerBoundByFrom(
			sourceBlocks,
			request.selection.start,
		);
		const mermaidCandidateIndices = [
			mermaidSelectionPivot - 1,
			mermaidSelectionPivot,
		].filter(
			(index, position, indices) =>
				index >= sourceBlockStart &&
				index < sourceBlockEnd &&
				indices.indexOf(index) === position,
		);
		const matchingMermaidCandidates: Array<
			Readonly<{ index: number; original: GeneratedContentOriginal }>
		> = [];
		for (const index of mermaidCandidateIndices) {
			const sourceBlock = sourceBlocks[index];
			if (
				"code" !== sourceBlock?.kind ||
				(sourceBlock?.from ?? 0) < blockRange.start ||
				(sourceBlock?.to ?? 0) > blockRange.end
			)
				continue;
			const original = mermaidOriginalForCodeBlock(
				request.index.source,
				sourceBlock,
			);
			if (
				original &&
				sourceSelectionMatchesGeneratedRanges(
					request.selection,
					original.fullRange,
					original.bodyRange,
				)
			)
				matchingMermaidCandidates.push({ index, original });
		}
		if (matchingMermaidCandidates.length > 1) return null;
		const mermaidCandidate = matchingMermaidCandidates[0];
		if (mermaidCandidate) {
			let ordinal = 0;
			for (
				let index = sourceBlockStart;
				index < mermaidCandidate.index;
				index++
			) {
				const sourceBlock = sourceBlocks[index];
				if (
					sourceBlock &&
					"code" === sourceBlock.kind &&
					sourceBlock.from >= blockRange.start &&
					sourceBlock.to <= blockRange.end &&
					mermaidOriginalForCodeBlock(request.index.source, sourceBlock)
				)
					ordinal += 1;
			}
			candidates.push({
				kind: "mermaid",
				ordinal,
				original: mermaidCandidate.original,
			});
		}
		if (1 !== candidates.length) return null;
		const candidate = candidates[0];
		if (!candidate) return null;
		const associated =
			"math" === candidate.kind
				? associateGeneratedContentTarget({
						acceptedPreview,
						blockId,
						kind: candidate.kind,
						mathSpans: candidate.mathSpans,
						ordinal: candidate.ordinal,
						source: request.index.source,
						sourceRevision: accepted.sourceRevision,
					})
				: associateGeneratedContentTarget({
						acceptedPreview,
						blockId,
						kind: candidate.kind,
						ordinal: candidate.ordinal,
						original: candidate.original,
						source: request.index.source,
						sourceRevision: accepted.sourceRevision,
					});
		if (
			"associated" !== associated.status ||
			!generatedTargetMatchesSourceSelection(
				associated.target,
				request.selection,
			)
		)
			return null;
		return {
			kind: candidate.kind,
			ordinal: candidate.ordinal,
			target: associated.target,
		};
	};

	const onMaterializeComplete = useCallback((revision: number, key: number) => {
		const pending = materializePendingRef.current;
		if (
			!ownerActiveRef.current ||
			!pending ||
			pending.revision !== revision ||
			pending.key !== key
		)
			return;
		materializePendingRef.current = null;
		materializationPendingRef.current = false;
		acceptedWindowSnapshotRef.current = null;
		installedWindowSnapshotRef.current = null;
		pending.resolve(true);
		setState((current) =>
			"html" === current.kind &&
			current.generation === revision &&
			current.materializeCommit?.key === key
				? {
						...current,
						materializeCommit: null,
						stagedCommit: null,
						windowedCommit: null,
					}
				: current,
		);
	}, []);

	const onMaterializeFailure = useCallback(
		(revision: number, key: number, error: unknown) => {
			const pending = materializePendingRef.current;
			if (
				!ownerActiveRef.current ||
				!pending ||
				pending.revision !== revision ||
				pending.key !== key
			)
				return;
			materializePendingRef.current = null;
			materializationPendingRef.current = false;
			materializedOverrideRef.current = false;
			windowCommitPendingRef.current = false;
			acceptedWindowSnapshotRef.current = null;
			installedWindowSnapshotRef.current = null;
			previewWindowRepositoryRef.current = null;
			pending.resolve(false);
			props.onDiagnostic?.(previewFailureCode(error));
			setState((current) =>
				"html" === current.kind &&
				current.generation === revision &&
				current.materializeCommit?.key === key
					? {
							...current,
							materializeCommit: null,
							phase: "failed",
							signature: "",
							stagedCommit: null,
							windowedCommit: null,
							windowedFailure: true,
						}
					: current,
			);
		},
		[props.onDiagnostic],
	);

	const materialize = useCallback(
		(reportDiagnostics = true): Promise<boolean> => {
			if (!ownerActiveRef.current) return Promise.resolve(false);
			const currentState = stateRef.current;
			if ("html" !== currentState.kind || "ready" !== currentState.phase) {
				if (reportDiagnostics) {
					props.onDiagnostic?.("preview-window-materialize-not-ready");
				}
				return Promise.resolve(false);
			}
			const repository = previewWindowRepositoryRef.current;
			if (!repository) {
				const surface = surfaceRef.current;
				if (
					materializationPendingRef.current ||
					surface?.querySelector(`[${PREVIEW_WINDOW_SPACER_ATTRIBUTE}]`) ||
					(windowedRef.current && previewNeedsWindow(currentState.editMap))
				) {
					if (reportDiagnostics) {
						props.onDiagnostic?.(
							"preview-window-materialize-repository-unavailable",
						);
					}
					return Promise.resolve(false);
				}
				return Promise.resolve(true);
			}
			if (
				currentState.generation !== repository.context.revision ||
				currentState.htmlRevision !== repository.context.revision ||
				currentState.signature !== repository.context.signature
			) {
				discardPendingWork();
				previewWindowRepositoryRef.current = null;
				if (reportDiagnostics) {
					props.onDiagnostic?.("preview-window-materialize-repository-stale");
				}
				return Promise.resolve(false);
			}
			try {
				validatePreviewWindowRepository(repository);
			} catch (error) {
				props.onDiagnostic?.(previewFailureCode(error));
				return Promise.resolve(false);
			}
			const surface = surfaceRef.current;
			if (!surface) throw new Error("preview-surface-missing");
			const nodes = fullMaterializedNodes(repository);
			if (isFullMaterializedWindowSurface(surface, repository)) {
				materializedOverrideRef.current = true;
				return Promise.resolve(true);
			}
			const pending = materializePendingRef.current;
			if (pending?.revision === repository.context.revision) {
				return pending.promise;
			}
			if (pending) {
				materializePendingRef.current = null;
				pending.resolve(false);
			}
			const key = ++materializeCommitKeyRef.current;
			let resolveMaterialization!: (completed: boolean) => void;
			const promise = new Promise<boolean>((resolve) => {
				resolveMaterialization = resolve;
			});
			materializePendingRef.current = {
				key,
				promise,
				resolve: resolveMaterialization,
				revision: repository.context.revision,
			};
			materializationPendingRef.current = true;
			materializedOverrideRef.current = true;
			windowCommitPendingRef.current = false;
			acceptedWindowSnapshotRef.current = null;
			installedWindowSnapshotRef.current = null;
			const materializeCommit: SafePreviewHtmlSinkMaterializeCommit = {
				key,
				nodes,
				revision: repository.context.revision,
			};
			setState((current) =>
				"html" === current.kind &&
				"ready" === current.phase &&
				current.htmlRevision === repository.context.revision
					? {
							...current,
							materializeCommit,
							stagedCommit: null,
							windowedCommit: null,
						}
					: current,
			);
			return promise;
		},
		[discardPendingWork, props.onDiagnostic],
	);
	materializeRef.current = materialize;

	const prepareWindowBlockAdoption = (
		node: HTMLElement,
	): (() => boolean) | null => {
		if (!ownerActiveRef.current || !windowedRef.current) return null;
		const surface = surfaceRef.current;
		const repository = previewWindowRepositoryRef.current;
		const current = stateRef.current;
		if (
			!surface?.isConnected ||
			!repository ||
			"html" !== current.kind ||
			"ready" !== current.phase ||
			current.generation !== repository.context.revision ||
			current.htmlRevision !== repository.context.revision ||
			current.signature !== repository.context.signature ||
			current.editMap?.signature !== repository.context.signature ||
			current.editMap?.blocks.length !== repository.nodes.length ||
			generationRef.current !== repository.context.revision ||
			materializationPendingRef.current ||
			!(node instanceof HTMLElement) ||
			node.ownerDocument !== surface.ownerDocument ||
			node.parentNode !== surface ||
			node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
		)
			return null;

		try {
			validatePreviewWindowRepository(repository);
		} catch {
			return null;
		}

		const id = node.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
		if (!id) return null;
		const index = repository.indexById.get(id);
		if (undefined === index) return null;
		const block = repository.blocks[index];
		if (
			!block ||
			block.index !== index ||
			block.map.id !== id ||
			repository.indexById.size !== repository.nodes.length ||
			repository.blocks.some(
				(entry) => repository.indexById.get(entry.map.id) !== entry.index,
			)
		)
			return null;

		const mountedIndices = new Set<number>();
		let previousIndex = -1;
		const expectedChildren = Array.from(surface.children);
		for (const child of Array.from(surface.children)) {
			if (child.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)) continue;
			const childId = child.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
			if (!childId) return null;
			const childIndex = repository.indexById.get(childId);
			if (undefined === childIndex || mountedIndices.has(childIndex)) {
				return null;
			}
			if (childIndex <= previousIndex) return null;
			previousIndex = childIndex;
			mountedIndices.add(childIndex);
			if (child !== node && repository.nodes[childIndex] !== child) {
				return null;
			}
		}
		if (!mountedIndices.has(index)) return null;

		const previousNode = repository.nodes[index];
		if (!previousNode) return null;
		const pendingCommit = windowCommitPendingRef.current
			? pendingWindowCommitRef.current
			: null;
		const pendingNodeIndex = pendingCommit?.nodes.indexOf(previousNode) ?? -1;
		if (
			windowCommitPendingRef.current &&
			(!pendingCommit ||
				pendingCommit.revision !== repository.context.revision ||
				pendingNodeIndex < 0)
		)
			return null;
		const expectedContext = repository.context;
		let replacementAdopted = false;
		// A rejected adoption must leave the accepted window mounted: a
		// foreign replacement root this finalize refuses has no accepted
		// identity, so the row it claimed goes back to the node the repository
		// still names. Restoring here keeps the sink self-healing for every
		// refusal path without touching any accepting one.
		const restoreAcceptedNode = (): void => {
			if (
				node.isConnected &&
				node.parentNode === surface &&
				!previousNode.isConnected &&
				repository.nodes[index] === previousNode
			) {
				node.replaceWith(previousNode);
			}
		};
		return () => {
			if (!ownerActiveRef.current || !windowedRef.current) {
				restoreAcceptedNode();
				return false;
			}
			const currentSurface = surfaceRef.current;
			const currentRepository = previewWindowRepositoryRef.current;
			const currentState = stateRef.current;
			if (
				currentSurface !== surface ||
				!surface.isConnected ||
				currentRepository !== repository ||
				"html" !== currentState.kind ||
				"ready" !== currentState.phase ||
				currentState.generation !== expectedContext.revision ||
				currentState.htmlRevision !== expectedContext.revision ||
				currentState.signature !== expectedContext.signature ||
				currentState.editMap?.signature !== expectedContext.signature ||
				currentState.editMap?.blocks.length !== repository.nodes.length ||
				generationRef.current !== expectedContext.revision ||
				repository.context !== expectedContext ||
				materializationPendingRef.current ||
				(pendingCommit && pendingWindowCommitRef.current !== pendingCommit) ||
				node.ownerDocument !== surface.ownerDocument ||
				node.parentNode !== surface ||
				node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== id ||
				node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE) ||
				expectedChildren.length !== surface.children.length ||
				expectedChildren.some(
					(expectedChild, childIndex) =>
						surface.children[childIndex] !== expectedChild,
				)
			) {
				restoreAcceptedNode();
				return false;
			}

			try {
				validatePreviewWindowRepository(repository);
			} catch {
				restoreAcceptedNode();
			return false;
			}

			const currentBlock = repository.blocks[index];
			if (
				!currentBlock ||
				currentBlock.index !== index ||
				currentBlock.map.id !== id ||
				repository.indexById.get(id) !== index
			) {
				restoreAcceptedNode();
				return false;
			}
			if (currentBlock.node === node && repository.nodes[index] === node) {
				// A root-preserving local edit keeps the mounted node, so the
				// repository already names it and only its accepted content
				// moved. Advance exactly this block's baselines and retire the
				// published snapshot: re-reporting the previous content would
				// describe a DOM this owner no longer has, and every later
				// accepted-window registration would reject the live node.
				if (
					acceptedWindowBaselineRef.current?.revision !==
						expectedContext.revision ||
					acceptedWindowBaselineRef.current.signature !==
						expectedContext.signature
				) {
					restoreAcceptedNode();
					return false;
				}
				acceptedWindowBaselineRef.current = extendAcceptedWindowBaseline(
					acceptedWindowBaselineRef.current,
					id,
					node,
					readCurrentSourceSnapshot(),
				);
				if (
					pendingWindowBaselineRef.current?.revision ===
						expectedContext.revision &&
					pendingWindowBaselineRef.current.signature ===
						expectedContext.signature
				) {
					pendingWindowBaselineRef.current = extendAcceptedWindowBaseline(
						pendingWindowBaselineRef.current,
						id,
						node,
						readCurrentSourceSnapshot(),
					);
				}
				// The retained root now describes accepted content the flow model
				// has not measured. Record that exact content here, in the same
				// accepted transition, so a later window commit can still compare
				// its installed surface with a boundary that describes it.
				// A second finalization after replacement adoption advances only
				// the canonical witness; the replacement geometry was invalidated
				// once by the pre-canonical DOM transaction below.
				if (!replacementAdopted) measurePreviewWindowAdoptedBlock(repository, surface, index);
				acceptedWindowSnapshotRef.current = null;
				installedWindowSnapshotRef.current = null;
				return true;
			}
			if (
				currentBlock.node !== previousNode ||
				repository.nodes[index] !== previousNode
			) {
				restoreAcceptedNode();
				return false;
			}

			// Repository adoption and the sink's accepted child list are one
			// transition. Otherwise loading rejects the old PRE identity and
			// remounts HTML, destroying the pending native selection lease.
			const acceptedCommit = currentState.windowedCommit;
			const acceptedNodes = acceptedCommit?.nodes.map((child) => child === previousNode ? node : child);
			if (acceptedCommit && (acceptedCommit.revision !== expectedContext.revision
				|| !acceptedCommit.nodes.includes(previousNode)
				|| acceptedNodes?.length !== surface.childNodes.length
				|| acceptedNodes.some((child, childIndex) => surface.childNodes[childIndex] !== child))) {
				restoreAcceptedNode();
				return false;
			}

			const previousNodes = repository.nodes;
			const previousBlocks = repository.blocks;
			const previousFlowGeometry = repository.flowGeometry[index];
			const previousFlowEpoch = repository.flowGeometryEpoch[index] ?? null;
			const previousGapEpoch = repository.flowGapEpoch[index] ?? null;
			const previousPrecedingGeometry =
				index > 0 ? repository.flowGeometry[index - 1] : undefined;
			const previousPrecedingGapEpoch =
				index > 0 ? repository.flowGapEpoch[index - 1] : undefined;
			const geometryEpoch = previewWindowGeometryEpochKey(repository.context);
			const previousGeometryRequirement =
				windowGeometryRequiresMeasuredRef.current;
			const replacementRequiresMeasurement =
				installedWindowGeometryContextRef.current === geometryEpoch &&
				(repository.flowGeometryUnknownRanges
					? repository.flowGeometryUnknownRanges.length === 0
					: repository.flowGeometryEpoch.every(
							(value) => value === geometryEpoch,
						));
			const mutablePendingNodes = pendingCommit?.nodes;
			const previousPendingNode = mutablePendingNodes?.[pendingNodeIndex];
			const nextNodes = [...repository.nodes];
			nextNodes[index] = node;
			const nextBlocks = repository.blocks.map((entry, entryIndex) =>
				entryIndex === index ? { ...entry, node } : entry,
			);
			const replacementGeometry = repository.model.flowGeometries[index];
			if (!replacementGeometry) {
				restoreAcceptedNode();
				return false;
			}
			const nextAcceptedBaseline =
				acceptedWindowBaselineRef.current?.revision ===
					expectedContext.revision &&
				acceptedWindowBaselineRef.current.signature ===
					expectedContext.signature
					? extendAcceptedWindowBaseline(
							acceptedWindowBaselineRef.current,
							id,
							node,
							readCurrentSourceSnapshot(),
						)
					: acceptedWindowBaselineRef.current;
			const nextPendingBaseline =
				pendingWindowBaselineRef.current?.revision ===
					expectedContext.revision &&
				pendingWindowBaselineRef.current.signature === expectedContext.signature
					? extendAcceptedWindowBaseline(
							pendingWindowBaselineRef.current,
							id,
							node,
							readCurrentSourceSnapshot(),
						)
					: pendingWindowBaselineRef.current;
			repository.nodes = nextNodes;
			repository.blocks = nextBlocks;
			repository.flowGeometry[index] = replacementGeometry;
			repository.flowGeometryEpoch[index] = null;
			repository.flowGapEpoch[index] = null;
			markPreviewWindowFlowGeometryUnknown(repository, index);
			markPreviewWindowFlowGapUnknown(repository, index);
			if (index > 0 && previousPrecedingGeometry) {
				repository.flowGeometry[index - 1] = {
					...previousPrecedingGeometry,
					gapAfter: 0,
				};
				repository.flowGapEpoch[index - 1] = null;
				markPreviewWindowFlowGapUnknown(repository, index - 1);
			}
			if (mutablePendingNodes) mutablePendingNodes[pendingNodeIndex] = node;
			try {
				validatePreviewWindowRepository(repository);
			} catch {
				repository.nodes = previousNodes;
				repository.blocks = previousBlocks;
				repository.flowGeometry[index] =
					previousFlowGeometry ?? replacementGeometry;
				repository.flowGeometryEpoch[index] = previousFlowEpoch;
				repository.flowGapEpoch[index] = previousGapEpoch;
				if (previousFlowEpoch === geometryEpoch) {
					markPreviewWindowFlowGeometryMeasured(repository, index);
				} else {
					markPreviewWindowFlowGeometryUnknown(repository, index);
				}
				if (previousGapEpoch === geometryEpoch) {
					markPreviewWindowFlowGapMeasured(repository, index);
				} else {
					markPreviewWindowFlowGapUnknown(repository, index);
				}
				windowGeometryRequiresMeasuredRef.current = previousGeometryRequirement;
				if (index > 0 && previousPrecedingGeometry) {
					repository.flowGeometry[index - 1] = previousPrecedingGeometry;
					repository.flowGapEpoch[index - 1] =
						previousPrecedingGapEpoch ?? null;
					if (previousPrecedingGapEpoch === geometryEpoch) {
						markPreviewWindowFlowGapMeasured(repository, index - 1);
					} else {
						markPreviewWindowFlowGapUnknown(repository, index - 1);
					}
				}
				if (mutablePendingNodes && previousPendingNode) {
					mutablePendingNodes[pendingNodeIndex] = previousPendingNode;
				}
				restoreAcceptedNode();
				return false;
			}
			acceptedWindowSnapshotRef.current = null;
			installedWindowSnapshotRef.current = null;
			if (
				index === 0 ||
				index === repository.nodes.length - 1 ||
				!repository.flowBoundary
			) {
				repository.flowBoundary = null;
			}
			repository.spacerContentHeights.clear();
			if (replacementRequiresMeasurement) {
				windowGeometryRequiresMeasuredRef.current = true;
			}
			acceptedWindowBaselineRef.current = nextAcceptedBaseline;
			pendingWindowBaselineRef.current = nextPendingBaseline;
			replacementAdopted = true;
			if (acceptedCommit && acceptedNodes) {
				setState((current) => current.kind === "html" && current.windowedCommit === acceptedCommit
					? { ...current, windowedCommit: { ...acceptedCommit, nodes: acceptedNodes } }
					: current);
			}
			return true;
		};
	};
	prepareWindowBlockAdoptionRef.current = prepareWindowBlockAdoption;
	useEffect(() => {
		if (!compositionSurfaceHeldRef.current) scheduleWindowRef.current();
	}, [compositionSurfaceVersion]);
	retainCompositionSurfaceRef.current = (activation) => {
		const surface = surfaceRef.current;
		if (
			activation !== compositionSurfaceActivationRef.current ||
			!ownerActiveRef.current ||
			!surface ||
			!surface.isConnected
		) {
			// A runtime from a superseded activation must not lend the current
			// surface; only the live owner activation can hold its own lease.
			throw new Error("preview-composition-surface-inactive");
		}
		if (materializationPendingRef.current) {
			// Gating future starts cannot stop a rollback already in flight; the
			// admission must refuse instead of holding over it.
			throw new Error("preview-composition-surface-busy");
		}
		compositionSurfaceLeasesRef.current += 1;
		compositionSurfaceHeldRef.current = true;
		setCompositionSurfaceVersion((version) => version + 1);
		let released = false;
		return {
			retainGap: (gap) => {
				if (released || activation !== compositionSurfaceActivationRef.current || gap.surface !== surface || gap.node.parentNode !== surface || !gap.isLive()) {
					throw new Error("preview-owned-gap-stale");
				}
				ownedGapRef.current = gap;
			},
			release: () => {
				// A late, duplicated, or pre-teardown release never lifts another
				// lease: only this activation may settle its own token.
				if (released) return;
				released = true;
				if (activation !== compositionSurfaceActivationRef.current) return;
				compositionSurfaceLeasesRef.current = Math.max(
					0,
					compositionSurfaceLeasesRef.current - 1,
				);
				compositionSurfaceHeldRef.current = compositionSurfaceLeasesRef.current > 0;
				if (!compositionSurfaceHeldRef.current) resumeDeferredEnhancementRef.current?.();
				setCompositionSurfaceVersion((version) => version + 1);
			},
		};
	};

	useLayoutEffect(() => {
		const pending = materializePendingRef.current;
		if (!pending) return;
		if (
			"html" === state.kind &&
			state.generation === pending.revision &&
			state.materializeCommit?.key === pending.key
		)
			return;
		materializePendingRef.current = null;
		materializationPendingRef.current = false;
		materializedOverrideRef.current = false;
		pending.resolve(false);
	}, [state]);

	function captureScroll(generation: number): void {
		if (surfaceRef.current) {
			scrollSnapshotRef.current = {
				generation,
				snapshot: props.scrollPort.capture(
					previewScrollCanvas(surfaceRef.current),
				),
			};
		}
	}

	const retainedWindowedCommit = (
		current: PreviewSurfaceState,
	): SafePreviewHtmlSinkWindowCommit | null => {
		if (!windowedRef.current || "html" !== current.kind) return null;
		const commit = current.windowedCommit;
		const surface = surfaceRef.current;
		if (!commit || commit.revision !== current.htmlRevision || !surface) {
			return null;
		}
		const currentNodes = Array.from(surface.childNodes);
		if (
			currentNodes.length !== commit.nodes.length ||
			!commit.nodes.every((node, index) => currentNodes[index] === node)
		) {
			return null;
		}
		return commit;
	};

	function publishRequestState(requestState: PreviewRequestState): void {
		const generation = ++generationRef.current;
		bindDocumentEndPin(requestState, generation);
		// A pinned selection is a current edit: the editor's own anchor owns this
		// request's viewport. Re-applying the previous review ratio when the
		// formal render lands would displace the already-painted edited row a
		// second time (the same owner is used by native Undo/Redo and by Enter).
		const editOwnedViewport =
			documentEndPinRef.current?.signature ===
			requestState.request.signature;
		// A review ratio must not be captured from a commit that is still painting
		// or enhancing: those phases carry the transient DOM/scroll restore in
		// flight, and replaying that transient ratio would become the next
		// request's final position. Initial/loading content and a ready accepted
		// render keep their existing capture contract.
		const viewportSettled = !(
			"html" === stateRef.current.kind
			&& ("committing" === stateRef.current.phase
				|| "enhancing" === stateRef.current.phase)
		);
		if (
			!editOwnedViewport &&
			viewportSettled &&
			("loading" === requestState.kind || "success" === requestState.kind)
		) {
			captureScroll(generation);
		} else {
			scrollSnapshotRef.current = null;
		}
		discardPendingWork();
		previewWindowRepositoryRef.current = null;

		if ("loading" === requestState.kind) {
			setState((current) =>
				"html" === current.kind
					? {
							...current,
							generation,
							phase: "loading",
							signature: "",
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: retainedWindowedCommit(current),
						}
					: "paper" === emptyModeRef.current
						? {
								codeTheme: requestState.request.codeTheme,
								editMap: null,
								features: {},
								generation,
								html: "" as SafePreviewHtml,
								htmlRevision: generation,
								kind: "html",
								paperPlaceholder: true,
								phase: "loading",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: null,
							}
						: { generation, kind: "loading" },
			);
			return;
		}
		if ("empty" === requestState.kind) {
			setState(
				"paper" === emptyModeRef.current
					? {
							codeTheme: requestState.request.codeTheme,
							editMap: null,
							features: {},
							generation,
							// The empty string is the only HTML value that is intrinsically
							// safe without invoking the server renderer.
							html: "" as SafePreviewHtml,
							htmlRevision: generation,
							kind: "html",
							paperPlaceholder: true,
							phase: "ready",
							signature: requestState.request.signature,
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: null,
						}
					: { generation, kind: "empty" },
			);
			return;
		}
		if ("error" === requestState.kind) {
			setState((current) =>
				"paper" === emptyModeRef.current && "html" === current.kind
					? {
							...current,
							generation,
							phase: "failed",
							signature: "",
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: retainedWindowedCommit(current),
							...(windowedRef.current ? { windowedFailure: true } : {}),
						}
					: { generation, kind: "error" },
			);
			return;
		}
		const activeSurface = surfaceRef.current;
		if (!activeSurface) throw new Error("preview-surface-missing");
		const features = {
			...requestState.response.features,
			...props.featureOverrides,
		};
		const failCandidate = (error: unknown) => {
			if (!ownerActiveRef.current || generationRef.current !== generation)
				return;
			const documentEndPin = documentEndPinRef.current;
			if (documentEndPin?.generation === generation) {
				clearDocumentEndPin(documentEndPin, false);
			}
			if (scrollSnapshotRef.current?.generation === generation) {
				scrollSnapshotRef.current = null;
			}
			props.onDiagnostic?.(previewFailureCode(error));
			setState((current) => {
				const previousHtml = "html" === current.kind ? current : null;
				return {
					codeTheme: requestState.request.codeTheme,
					editMap: null,
					features,
					generation,
					html: previousHtml?.html ?? ("" as SafePreviewHtml),
					htmlRevision: previousHtml?.htmlRevision ?? generation,
					kind: "html",
					phase: "failed",
					signature: "",
					materializeCommit: null,
					stagedCommit: null,
					windowedCommit: retainedWindowedCommit(current),
					...(windowedRef.current ? { windowedFailure: true } : {}),
				};
			});
		};
		const stageCandidate = () => {
			if (!ownerActiveRef.current || generationRef.current !== generation)
				return;
			let candidateMarkup: Readonly<{
				sourceNodes: ReadonlyArray<Node>;
				surface: HTMLElement;
			}>;
			const windowedFirstPaint =
				windowedRef.current &&
				previewNeedsWindow(requestState.response.editMap ?? null);
			try {
				candidateMarkup = createEnhancementCandidate(
					activeSurface,
					requestState.response.html,
				!windowedRef.current,
					requestState.response.preparedMarkup?.sourceNodes,
				);
			} catch (error) {
				failCandidate(error);
				return;
			}
			enhancementCandidateRef.current = {
				codeTheme: requestState.request.codeTheme,
				editMap: requestState.response.editMap ?? null,
				features,
				generation,
				markdown: requestState.request.markdown,
				requestRevision: requestState.revision,
				serverHtml: requestState.response.html,
				signature: requestState.request.signature,
				sourceNodes: candidateMarkup.sourceNodes,
				surface: candidateMarkup.surface,
			};
			setState((current) => {
				if (generationRef.current !== generation) return current;
				const hasCurrentHtml =
					"html" === current.kind && Boolean(current.html.trim());
				return {
					codeTheme: requestState.request.codeTheme,
					editMap: requestState.response.editMap ?? null,
					features,
					generation,
					html:
						hasCurrentHtml && "html" === current.kind
							? current.html
							: windowedFirstPaint
								? ("" as SafePreviewHtml)
								: requestState.response.html,
					htmlRevision:
						hasCurrentHtml && "html" === current.kind
							? current.htmlRevision
							: generation,
					kind: "html",
					phase: "enhancing",
					signature: "",
					materializeCommit: null,
					stagedCommit:
						!hasCurrentHtml && !windowedFirstPaint
							? {
									nodes: candidateMarkup.sourceNodes.map((node) =>
										node.cloneNode(true),
									),
									revision: generation,
								}
							: null,
					windowedCommit: retainedWindowedCommit(current),
				};
			});
		};
		if (
			windowedRef.current &&
			previewNeedsWindow(requestState.response.editMap ?? null)
		) {
			const scheduler =
				props.stagingScheduler ??
				defaultPreviewSurfaceStagingScheduler(activeSurface.ownerDocument);
			void scheduler.yield().then(stageCandidate, failCandidate);
			return;
		}
		stageCandidate();
	}

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");
		ownerActiveRef.current = true;
		// This runtime belongs to exactly this owner activation. A later effect
		// restart replaces the activation, so an old runtime must not acquire a
		// lease against the new owner's surface.
		const runtimeActivation = compositionSurfaceActivationRef.current;
		const session = createPreviewRequestSession({
			initialRevision: props.initialRevision,
			onState: publishRequestState,
			port: props.port,
		});
		const runtime = {
			getAcceptedWindowSnapshot: () => getAcceptedWindowSnapshotRef.current(),
			getGeneratedPreviewIdentity: () =>
				getGeneratedPreviewIdentityRef.current(),
			materialize: () => materializeRef.current(),
			prepareGeneratedContentTarget: (
				request: PreviewGeneratedContentTargetRequest,
			) => prepareGeneratedContentTargetRef.current(request),
			prepareGeneratedContentTargetBySelection: (
				request: PreviewGeneratedContentTargetSelectionRequest,
			) => prepareGeneratedContentTargetBySelectionRef.current(request),
			prepareGeneratedContentTargetForSelection: (
				request: PreviewGeneratedContentTargetForSelectionRequest,
			) => prepareGeneratedContentTargetForSelectionRef.current(request),
			prepareImageTarget: (request: PreviewImageTargetRequest) =>
				prepareImageTargetRef.current(request),
			prepareImageTargetBySelection: (
				request: PreviewImageTargetSelectionRequest,
			) => prepareImageTargetBySelectionRef.current(request),
			prepareDocumentEndWindowPin,
			prepareWindowBlockAdoption: (node: HTMLElement) =>
				prepareWindowBlockAdoptionRef.current(node),
			retainCompositionSurface: () =>
				retainCompositionSurfaceRef.current(runtimeActivation),
			session,
			surface,
		};
		try {
			props.onReady(runtime);
		} catch (error) {
			ownerActiveRef.current = false;
			acceptedWindowBaselineRef.current = null;
			pendingWindowBaselineRef.current = null;
			session.destroy();
			throw error;
		}
		return () => {
			ownerActiveRef.current = false;
			compositionSurfaceActivationRef.current += 1;
			compositionSurfaceLeasesRef.current = 0;
			compositionSurfaceHeldRef.current = false;
			acceptedWindowSnapshotRef.current = null;
			installedWindowSnapshotRef.current = null;
			acceptedGeneratedPreviewRef.current = null;
			ownedGapRef.current = null;
			stagedPreviewImageElementsRef.current = null;
			documentEndPinRef.current = null;
			scrollSnapshotRef.current = null;
			discardStaging();
			props.onDispose?.(runtime);
			session.destroy();
		};
	}, [discardStaging]);

	useLayoutEffect(() => {
		if (props.windowed) {
			// Release the previous activation's full-surface hold before window setup.
			// Do not release a consumer's hold on ordinary rerenders of this activation.
			materializedOverrideRef.current = false;
			return;
		}
		acceptedWindowSnapshotRef.current = null;
		installedWindowSnapshotRef.current = null;
		const documentEndPin = documentEndPinRef.current;
		if (documentEndPin) clearDocumentEndPin(documentEndPin, false);
	}, [props.windowed]);

	useLayoutEffect(() => {
		setState((current) => {
			if ("paper" === props.emptyMode) {
				if ("empty" === current.kind) {
					return {
						codeTheme: props.initial.codeTheme ?? "",
						editMap: props.initial.editMap ?? null,
						features: {},
						generation: current.generation,
						html: "" as SafePreviewHtml,
						htmlRevision: current.generation,
						kind: "html",
						paperPlaceholder: true,
						phase: "ready",
						signature: "",
						materializeCommit: null,
						stagedCommit: null,
						windowedCommit: null,
					};
				}
				if ("loading" === current.kind) {
					return {
						codeTheme: props.initial.codeTheme ?? "",
						editMap: props.initial.editMap ?? null,
						features: {},
						generation: current.generation,
						html: "" as SafePreviewHtml,
						htmlRevision: current.generation,
						kind: "html",
						paperPlaceholder: true,
						phase: "loading",
						signature: "",
						materializeCommit: null,
						stagedCommit: null,
						windowedCommit: null,
					};
				}
				return current;
			}
			if ("html" !== current.kind || !current.paperPlaceholder) {
				return current;
			}
			if ("ready" === current.phase) {
				return { generation: current.generation, kind: "empty" };
			}
			if ("failed" === current.phase) {
				return { generation: current.generation, kind: "error" };
			}
			return { generation: current.generation, kind: "loading" };
		});
	}, [props.emptyMode, props.initial.codeTheme]);

	const readyHtml =
		"html" === state.kind && "ready" === state.phase ? state : null;
	useLayoutEffect(() => {
		if (!readyHtml) return;
		props.onHtmlChange?.(readyHtml.html);
		props.onSnapshotReady?.(
			readyHtml.html,
			readyHtml.signature,
			readyHtml.editMap,
		);
	}, [
		readyHtml?.html,
		readyHtml?.htmlRevision,
		readyHtml?.signature,
		props.onHtmlChange,
		props.onSnapshotReady,
	]);

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		const snapshot = scrollSnapshotRef.current;
		if (
			surface &&
			snapshot &&
			"html" === state.kind &&
			"ready" === state.phase &&
			state.generation === snapshot.generation &&
			state.htmlRevision === snapshot.generation &&
			acceptedHtmlRevisionRef.current === state.htmlRevision
		) {
			scrollSnapshotRef.current = null;
			props.scrollPort.restore(previewScrollCanvas(surface), snapshot.snapshot);
		}
	}, [state]);

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) return;
		surface.easymdePreviewSignature =
			"html" === state.kind && "ready" === state.phase ? state.signature : "";
	}, [state]);

	useLayoutEffect(() => {
		props.onStatusChange?.(surfaceStatus(state));
	}, [state, props.onStatusChange]);

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		if (!surface || !readyHtml || !surface.isConnected) {
			return;
		}
		const images = Array.from(
			surface.querySelectorAll<HTMLImageElement>("img"),
		);
		if (0 === images.length) return;
		const listeners = new Map<HTMLImageElement, () => void>();
		for (const image of images) {
			const notify = () => {
				if (!image.isConnected || !surface.contains(image)) return;
				props.onImageReadinessChange?.();
			};
			listeners.set(image, notify);
			image.addEventListener("load", notify);
			image.addEventListener("error", notify);
			if (image.complete && image.naturalWidth > 0) notify();
		}
		return () => {
			for (const image of images) {
				const notify = listeners.get(image);
				if (!notify) continue;
				image.removeEventListener("load", notify);
				image.removeEventListener("error", notify);
			}
		};
	}, [
		readyHtml?.generation,
		readyHtml?.htmlRevision,
		readyHtml?.signature,
		readyHtml?.stagedCommit?.revision,
		readyHtml?.windowedCommit?.key,
		readyHtml?.materializeCommit?.key,
		props.onImageReadinessChange,
	]);

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		if (!surface || "html" !== state.kind || "enhancing" !== state.phase)
			return;
		const generation = state.generation;
		let candidate = enhancementCandidateRef.current;
		if (!candidate && 0 === generation) {
			const candidateMarkup = createEnhancementCandidate(
				surface,
				state.html,
				!windowedRef.current,
			);
			candidate = {
				codeTheme: state.codeTheme,
				editMap: state.editMap,
				features: state.features,
				generation,
				markdown: "",
				requestRevision: null,
				serverHtml: state.html,
				signature: state.signature,
				sourceNodes: candidateMarkup.sourceNodes,
				surface: candidateMarkup.surface,
			};
			enhancementCandidateRef.current = candidate;
		}
		if (!candidate || candidate.generation !== generation) return;
		const activeCandidate = candidate;
		const candidateSurface = activeCandidate.surface;
		const controller = new AbortController();
		let active = true;
		if (generationRef.current !== generation) return;
		let visualSources: ReadonlyArray<VisualMarkdownSourceMarker> = [];
		let blockMarkers: ReadonlyArray<VisualBlockMarker> = [];
		const isCurrent = () => active && generationRef.current === generation;

		const failEnhancement = (error: unknown) => {
			if (!isCurrent()) return;
			const documentEndPin = documentEndPinRef.current;
			if (documentEndPin?.generation === generation) {
				clearDocumentEndPin(documentEndPin, false);
			}
			if (scrollSnapshotRef.current?.generation === generation) {
				scrollSnapshotRef.current = null;
			}
			removeVisualMarkdownSourceMarkers(visualSources);
			removePreviewBlockMarkers(blockMarkers);
			candidateSurface.remove();
			props.onDiagnostic?.(previewFailureCode(error));
			enhancementCandidateRef.current = null;
			pendingWindowBaselineRef.current = null;
			previewWindowRepositoryRef.current = null;
			setState((current) =>
				"html" === current.kind && current.generation === generation
					? {
							...current,
							html: activeCandidate.serverHtml,
							htmlRevision: generation,
							phase: "failed",
							signature: "",
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: null,
							...(windowedRef.current ? { windowedFailure: true } : {}),
						}
					: current,
			);
		};

		const runEnhancement = async (): Promise<void> => {
			try {
				const scheduler =
					props.stagingScheduler ??
					defaultPreviewSurfaceStagingScheduler(candidateSurface.ownerDocument);
				if (
					!(await populateEnhancementCandidate(
						activeCandidate,
						scheduler,
						isCurrent,
						controller.signal,
					))
				) {
					candidateSurface.remove();
					return;
				}
				if (!isCurrent()) return;
				if (activeCandidate.editMap) {
					const markerCapture = capturePreviewBlockMarkers(
						candidateSurface,
						activeCandidate.editMap,
						scheduler,
						isCurrent,
						controller.signal,
					);
					const capturedMarkers =
						markerCapture instanceof Promise
							? await markerCapture
							: markerCapture;
					if (!capturedMarkers) {
						candidateSurface.remove();
						return;
					}
					blockMarkers = capturedMarkers;
				}
				visualSources = captureVisualMarkdownSources(candidateSurface);
				await props.enhancementPort.enhance(
					candidateSurface,
					activeCandidate.features,
					isCurrent,
					{ codeTheme: activeCandidate.codeTheme, signal: controller.signal },
				);
				if (!isCurrent()) return;
				if (
					windowedRef.current &&
					previewNeedsWindow(activeCandidate.editMap)
				) {
					candidateSurface.style.display = "block";
					const activeSurface = surfaceRef.current;
					if (!activeSurface) throw new Error("preview-surface-missing");
					previewScrollCanvas(activeSurface).append(candidateSurface);
				}
				try {
					if (blockMarkers.length > 0) {
						const annotation = annotateEnhancedPreviewBlocks(
							blockMarkers,
							scheduler,
							isCurrent,
							controller.signal,
						);
						const annotated =
							annotation instanceof Promise ? await annotation : annotation;
						if (!annotated) {
							candidateSurface.remove();
							return;
						}
					}
					annotateEnhancedVisualSources(visualSources);
				} catch (error) {
					failEnhancement(error);
					return;
				}
				if (
					activeCandidate.sourceNodes.length >
						PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS ||
					blockMarkers.length > PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS
				) {
					await scheduler.yield();
					if (!isCurrent() || controller.signal.aborted) {
						candidateSurface.remove();
						return;
					}
				}
				const largeWindow =
					windowedRef.current && previewNeedsWindow(activeCandidate.editMap);
				const preparedDocumentEndPin = documentEndPinRef.current;
				let matchingDocumentEndPin =
					preparedDocumentEndPin &&
					preparedDocumentEndPin.generation === generation &&
					preparedDocumentEndPin.requestRevision ===
						activeCandidate.requestRevision &&
					preparedDocumentEndPin.signature === activeCandidate.signature
						? preparedDocumentEndPin
						: null;
				if (
					preparedDocumentEndPin?.generation === generation &&
					!matchingDocumentEndPin
				) {
					throw new PreviewWindowDomError(
						"preview-window-document-end-pin-identity-mismatch",
					);
				}
				if (matchingDocumentEndPin && !largeWindow) {
					clearDocumentEndPin(matchingDocumentEndPin, false);
					matchingDocumentEndPin = null;
				}
				const enhancedHtml = largeWindow
					? activeCandidate.serverHtml
					: (candidateSurface.innerHTML as SafePreviewHtml);
				if (largeWindow) {
					await scheduler.yield();
					if (!isCurrent() || controller.signal.aborted) {
						candidateSurface.remove();
						return;
					}
				}
				let repository: PreviewWindowNodeRepository | null = null;
				let windowedCommit: MutablePreviewWindowCommit | null = null;
				let stagedCommit: SafePreviewHtmlSinkCommit | null = null;
				stagedPreviewImageElementsRef.current = capturePreviewImageElements(
					candidateSurface,
					activeCandidate.editMap ?? null,
					generation,
				);
				if (
					windowedRef.current &&
					previewNeedsWindow(activeCandidate.editMap)
				) {
					if (!activeCandidate.editMap) {
						throw new Error("preview-window-edit-map-missing");
					}
					previewWindowRepositoryRef.current = createPreviewWindowRepository(
						candidateSurface,
						activeCandidate.editMap,
						{
							revision: generation,
							signature: activeCandidate.signature,
							styleEpoch: windowStyleEpochRef.current,
							widthEpoch: windowWidthEpochRef.current,
						},
					);
					windowGeometryRequiresMeasuredRef.current = false;
					repository = previewWindowRepositoryRef.current;
					let ownedGap = ownedGapRef.current;
					let gapBlank = false;
					if (ownedGap?.isLive() && ownedGap.markdown === activeCandidate.markdown) {
						const retainedGap = ownedGap;
						const starts = markdownLineStarts(activeCandidate.markdown);
						const resolveBlockExtent = (extent: PreviewOwnedGap["before"]): Readonly<{ index: number; range: PreviewOwnedGap["before"] }> | null => {
							const exact = activeCandidate.editMap!.blocks.flatMap((block, index) => {
								const start = starts[block.startLine] ?? activeCandidate.markdown.length;
								const end = starts[block.endLine] ?? activeCandidate.markdown.length;
								return start === extent.start
									&& end === extent.end
									&& activeCandidate.markdown.slice(start, end) === extent.source
									? [{ index, range: extent }]
									: [];
							});
							if (exact.length === 1 && exact[0]) return exact[0];
							if (extent.start !== retainedGap.before.start
								|| extent.end !== retainedGap.before.end
								|| extent.source !== retainedGap.before.source) return null;
							const rebound = activeCandidate.editMap!.blocks.flatMap((block, index) => {
								const start = starts[block.startLine] ?? activeCandidate.markdown.length;
								const end = starts[block.endLine] ?? activeCandidate.markdown.length;
								const formalSource = activeCandidate.markdown.slice(start, end);
								const suffix = activeCandidate.markdown.slice(extent.end, end);
								return start === extent.start
									&& end > extent.end
									&& end <= retainedGap.after.start
									&& formalSource.startsWith(extent.source)
									&& /^(?:\r\n|\r|\n)$/u.test(suffix)
									? [{ index, range: { start, end, source: formalSource } }]
									: [];
							});
							return rebound.length === 1 && rebound[0] ? rebound[0] : null;
						};
						const beforeMatch = resolveBlockExtent(ownedGap.before);
						if (!beforeMatch) throw new PreviewWindowDomError("preview-owned-gap-source-range-stale");
						if (beforeMatch.range !== ownedGap.before) {
							ownedGap = { ...ownedGap, before: beforeMatch.range };
							ownedGapRef.current = ownedGap;
						}
						const neighborIndices = [ownedGap.before, ownedGap.after].map((extent) => activeCandidate.editMap!.blocks.findIndex((block) =>
							(starts[block.startLine] ?? activeCandidate.markdown.length) === extent.start
							&& (starts[block.endLine] ?? activeCandidate.markdown.length) === extent.end
							&& activeCandidate.markdown.slice(extent.start, extent.end) === extent.source));
						const before = neighborIndices[0]!;
						const mappedAfter = neighborIndices[1]!;
						const eofAfter = mappedAfter < 0
							&& before === activeCandidate.editMap.blocks.length - 1
							&& ownedGap.after.start === activeCandidate.markdown.length
							&& ownedGap.after.end === activeCandidate.markdown.length
							&& "" === ownedGap.after.source;
						const after = eofAfter ? null : mappedAfter;
						// Same certificate predicate as the producer: a blank line, or the
						// tight adjacency where the following row starts at this row's end
						// (so the gap slice is only that row's own single line ending).
						gapBlank = certifiedTextTailGapSlice(
							activeCandidate.markdown.slice(ownedGap.before.end, ownedGap.after.start),
							ownedGap.after.start <= ownedGap.before.end + 2,
						);
						if (before >= 0 && (eofAfter || after === before + 1) && gapBlank) {
							const clone = ownedGap.node.cloneNode(true) as HTMLElement;
							clone.removeAttribute(VISUAL_BLOCK_ATTRIBUTE);
							if (eofAfter) repository.nodes[before]!.after(clone);
							else {
								if (after === null) throw new PreviewWindowDomError("preview-owned-gap-neighbor-missing");
								repository.nodes[after]!.before(clone);
							}
							repository.ownedGap = { node: clone, before, after };
						}
					}
					if (
						!(await measurePreviewWindowCandidateGeometry(
							repository,
							candidateSurface,
							scheduler,
							isCurrent,
							controller.signal,
						))
					) {
						candidateSurface.remove();
						return;
					}
					pendingWindowBaselineRef.current = captureAcceptedWindowBaseline(
						candidateSurface,
						repository,
						generation,
						activeCandidate.signature,
						activeCandidate.markdown ||
							(readCurrentSourceSnapshot()?.value ?? null),
						readCurrentSourceSnapshot()?.revision ?? null,
					);
					if (!pendingWindowBaselineRef.current) {
						throw new PreviewWindowDomError(
							"preview-window-baseline-capture-failed",
						);
					}
					const pinnedIndices = matchingDocumentEndPin
						? matchingDocumentEndPin.sourceSelection
							? previewSourceSelectionBlockIndices(
									activeCandidate.markdown,
									activeCandidate.editMap,
									activeCandidate.signature,
									matchingDocumentEndPin.sourceSelection,
								)
							: [
									previewDocumentEndBlockIndex(
										activeCandidate.markdown,
										activeCandidate.editMap,
										activeCandidate.signature,
									),
								]
						: [];
					if (matchingDocumentEndPin) {
						matchingDocumentEndPin.targetIndices = pinnedIndices;
					}
					await scheduler.yield();
					if (!isCurrent() || controller.signal.aborted) {
						previewWindowRepositoryRef.current = null;
						candidateSurface.remove();
						return;
					}
					if (repository.ownedGap && compositionSurfaceHeldRef.current) {
						// Native preedit owns the real paragraph. Its existing lease
						// releases after composition settlement, never after ready.
						await new Promise<void>((resolve) => {
							const resume = (): void => {
								controller.signal.removeEventListener("abort", resume);
								if (resumeDeferredEnhancementRef.current === resume) resumeDeferredEnhancementRef.current = null;
								resolve();
							};
							resumeDeferredEnhancementRef.current = resume;
							controller.signal.addEventListener("abort", resume, { once: true });
						});
						if (!isCurrent() || controller.signal.aborted) {
							candidateSurface.remove();
							return;
						}
					}
					if (repository.ownedGap && (!ownedGap || !ownedGap.isLive())) {
						const renewed = ownedGapRef.current;
						// A new input capability may retain the same physical blank
						// while staging yields. Reconcile that exact presentation;
						// a different source epoch, shape or neighbor is still stale.
						if (!ownedGap || !renewed?.isLive() || renewed.node !== ownedGap.node
							|| renewed.surface !== ownedGap.surface || renewed.surface !== surface
							|| renewed.historyState.undoDepth !== ownedGap.historyState.undoDepth
							|| renewed.historyState.redoDepth !== ownedGap.historyState.redoDepth
							|| renewed.sourceRevision !== ownedGap.sourceRevision || renewed.markdown !== ownedGap.markdown
							|| renewed.html !== ownedGap.html || renewed.node.innerHTML !== ownedGap.html
							|| renewed.before.start !== ownedGap.before.start || renewed.before.end !== ownedGap.before.end
							|| renewed.before.source !== ownedGap.before.source || renewed.after.start !== ownedGap.after.start
							|| renewed.after.end !== ownedGap.after.end || renewed.after.source !== ownedGap.after.source) {
							throw new PreviewWindowDomError("preview-owned-gap-stale");
						}
						ownedGap = renewed;
					}
					const currentDocumentEndPin = documentEndPinRef.current;
					const initialPinnedIndices =
						matchingDocumentEndPin &&
						currentDocumentEndPin === matchingDocumentEndPin &&
						matchingDocumentEndPin.generation === repository.context.revision &&
						matchingDocumentEndPin.signature === repository.context.signature &&
						matchingDocumentEndPin.targetIndices.length > 0
							? [...matchingDocumentEndPin.targetIndices]
							: [];
					if (repository.ownedGap && ownedGap?.isLive()) {
						initialPinnedIndices.push(repository.ownedGap.before);
						if (repository.ownedGap.after !== null) {
							initialPinnedIndices.push(repository.ownedGap.after);
						}
						repository.ownedGap.node.remove();
						ownedGap.node.removeAttribute(VISUAL_BLOCK_ATTRIBUTE);
						repository.ownedGap = { ...repository.ownedGap, node: ownedGap.node };
					}
					// A surviving accepted row is the native editing anchor, not a
					// pixel offset to repair after replacing its selection subtree.
					let selectionHandoff: SafePreviewHtmlSinkSelectionHandoff | undefined;
					const native = surface.ownerDocument.defaultView?.getSelection();
					let selectedRoot: Node | null = native?.isCollapsed ? native.anchorNode : null;
					while (selectedRoot && selectedRoot.parentNode !== surface) selectedRoot = selectedRoot.parentNode;
					const previousBaseline = acceptedWindowBaselineRef.current;
					const previousBlock = selectedRoot instanceof HTMLElement ? previousBaseline?.blocks.get(selectedRoot) : null;
					const previousRange = previousBlock?.sourceRange;
					const currentSource = readCurrentSourceSnapshot();
					if (selectedRoot instanceof HTMLElement && previousBlock && previousRange && previousBaseline
						&& currentSource && currentSource.revision === previousBaseline.sourceRevision
						&& currentSource.value === previousBaseline.markdown && currentSource.value === activeCandidate.markdown
						&& selectedRoot.innerHTML === previousBlock.innerHTML
						&& selectedRoot.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === previousBlock.id) {
						const starts = markdownLineStarts(activeCandidate.markdown);
						const index = activeCandidate.editMap.blocks.findIndex((block) => block.editable
							&& starts[block.startLine] === previousRange.start
							&& (starts[block.endLine] ?? activeCandidate.markdown.length) === previousRange.end);
						const candidateNode = repository.nodes[index];
						if (candidateNode && candidateNode.tagName === selectedRoot.tagName && candidateNode.innerHTML === selectedRoot.innerHTML
							&& activeCandidate.markdown.slice(previousRange.start, previousRange.end) === previousBaseline.markdown?.slice(previousRange.start, previousRange.end)) {
							const id = repository.blocks[index]!.map.id;
							selectedRoot.setAttribute(VISUAL_BLOCK_ATTRIBUTE, id);
							repository.nodes = repository.nodes.map((node, ordinal) => ordinal === index ? selectedRoot as HTMLElement : node);
							repository.blocks = repository.blocks.map((block, ordinal) => ordinal === index ? { ...block, node: selectedRoot as HTMLElement } : block);
							if (pendingWindowBaselineRef.current) pendingWindowBaselineRef.current = extendAcceptedWindowBaseline(pendingWindowBaselineRef.current, id, selectedRoot);
							initialPinnedIndices.push(index);
						} else if (candidateNode && candidateNode.tagName === selectedRoot.tagName && native?.anchorNode && native.isCollapsed) {
							const previousRoot = selectedRoot;
							const previousPoint = { node: native.anchorNode, offset: native.anchorOffset };
							const previousCodes = Array.from(previousRoot.querySelectorAll<HTMLElement>("pre > code"));
							const previousCode = previousPoint.node instanceof Element ? previousPoint.node.closest("code") : previousPoint.node.parentElement?.closest("code");
							const codeOrdinal = previousCode instanceof HTMLElement ? previousCodes.indexOf(previousCode) : -1;
							const nextCodes = Array.from(candidateNode.querySelectorAll<HTMLElement>("pre > code"));
							const nextCode = nextCodes[codeOrdinal];
							if (previousCode instanceof HTMLElement && codeOrdinal >= 0 && nextCode && nextCodes.length === previousCodes.length) {
								const sourceSlice = activeCandidate.markdown.slice(previousRange.start, previousRange.end);
								const projection = projectVisualCodeBodySelection(previousCode, sourceSlice,
									serializeVisualMarkdownBlockFragment([previousRoot]), codeOrdinal, { start: previousPoint, end: previousPoint });
								const sourceBodyOffset = projection.sourceSelection.start - projection.sourceInterval.bodyStart;
								const nextPoint = visualCodeBodyBoundaryAtOffset(nextCode, projection.sourceText.slice(0, sourceBodyOffset).replace(/\r\n|\r/g, "\n").length);
								const nextProjection = projectVisualCodeBodySelection(nextCode, sourceSlice,
									serializeVisualMarkdownBlockFragment([candidateNode]), codeOrdinal, { start: nextPoint, end: nextPoint });
								if (nextProjection.sourceSelection.start !== projection.sourceSelection.start || nextProjection.sourceSelection.end !== projection.sourceSelection.end) {
									throw new PreviewWindowDomError("preview-window-code-selection-projection-mismatch");
								}
								const nextHtml = candidateNode.innerHTML;
								const nextId = repository.blocks[index]!.map.id;
								selectionHandoff = {
									previous: previousPoint, next: nextPoint,
									isCurrent: () => {
										const liveSource = readCurrentSourceSnapshot();
										if (!ownerActiveRef.current || generationRef.current !== generation
											|| liveSource?.revision !== currentSource.revision || liveSource.value !== currentSource.value
											|| previousRoot.innerHTML !== previousBlock.innerHTML
											|| previousRoot.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== previousBlock.id
											|| candidateNode.innerHTML !== nextHtml || candidateNode.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== nextId
											|| previousRoot.querySelectorAll("pre > code")[codeOrdinal] !== previousCode
											|| candidateNode.querySelectorAll("pre > code")[codeOrdinal] !== nextCode
											|| !previousCode.contains(previousPoint.node) || !nextCode.contains(nextPoint.node)
											|| previousPoint.offset < 0 || previousPoint.offset > (previousPoint.node instanceof Text ? previousPoint.node.length : previousPoint.node.childNodes.length)
											|| nextPoint.offset < 0 || nextPoint.offset > nextPoint.node.length) return false;
										const livePrevious = projectVisualCodeBodySelection(previousCode, sourceSlice,
											serializeVisualMarkdownBlockFragment([previousRoot]), codeOrdinal, { start: previousPoint, end: previousPoint });
										const liveNext = projectVisualCodeBodySelection(nextCode, sourceSlice,
											serializeVisualMarkdownBlockFragment([candidateNode]), codeOrdinal, { start: nextPoint, end: nextPoint });
										return livePrevious.sourceSelection.start === projection.sourceSelection.start
											&& livePrevious.sourceSelection.end === projection.sourceSelection.end
											&& liveNext.sourceSelection.start === projection.sourceSelection.start
											&& liveNext.sourceSelection.end === projection.sourceSelection.end;
									},
								};
								initialPinnedIndices.push(index);
							}
						}
					}
					const initialWindow = repository.model.getWindow({
						context: repository.context,
						pinnedIndices: [...new Set(initialPinnedIndices)],
						...(initialPinnedIndices.length > 0
							? { maxMaterialized: DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED }
							: {}),
						viewport: viewportForCanvas(previewScrollCanvas(surface)),
					});
					windowedCommit = {
						key: ++windowCommitKeyRef.current,
						nodes: [...windowNodes(repository, initialWindow)],
						revision: generation,
						...(selectionHandoff ? { selectionHandoff } : {}),
					};
					windowCommitPendingRef.current = true;
					acceptedWindowSnapshotRef.current = null;
					installedWindowSnapshotRef.current = null;
					pendingWindowCommitRef.current = windowedCommit;
				} else {
					stagedCommit = {
						nodes: Array.from(candidateSurface.childNodes),
						revision: generation,
					};
				}
				if (scrollSnapshotRef.current?.generation === generation) {
					captureScroll(generation);
				}
				enhancementCandidateRef.current = null;
				committedEnhancementCandidateRef.current = activeCandidate;
				setState((current) =>
					"html" === current.kind && current.generation === generation
						? {
								...current,
								html: enhancedHtml,
								htmlRevision: generation,
								phase: "committing",
								signature: activeCandidate.signature,
								materializeCommit: null,
								stagedCommit,
								windowedCommit,
							}
						: current,
				);
			} catch (error) {
				failEnhancement(error);
			}
		};

		void runEnhancement();
		return () => {
			active = false;
			controller.abort();
			removeVisualMarkdownSourceMarkers(visualSources);
			removePreviewBlockMarkers(blockMarkers);
			if (committedEnhancementCandidateRef.current?.generation !== generation) {
				candidateSurface.remove();
			}
		};
	}, [
		state,
		props.enhancementPort,
		props.featureOverrides,
		props.stagingScheduler,
	]);

	const windowedEditing = Boolean(
		props.windowed &&
			("html" !== state.kind || previewNeedsWindow(state.editMap)),
	);
	useLayoutEffect(() => {
		if (!windowedEditing) {
			materializedOverrideRef.current = false;
			void materializeRef.current(false);
			return;
		}
		if (materializationPendingRef.current) {
			// Sink completion clears readyHtml.materializeCommit and reruns this effect;
			// failure publishes the failed phase, cancelling a queued Root unlock.
			return;
		}
		if (materializedOverrideRef.current) {
			// A consumer is using the full surface in this activation. A new windowed
			// activation releases this hold above, before a new unlock can wait here.
			return;
		}
		const surface = surfaceRef.current;
		if (!surface || "html" !== state.kind || "ready" !== state.phase) {
			return;
		}
		let repository = previewWindowRepositoryRef.current;
		if (repository && repository.context.revision !== state.generation) {
			previewWindowRepositoryRef.current = null;
			windowCommitPendingRef.current = false;
			repository = null;
		}
		if (!repository) {
			if (!state.editMap) {
				const documentEndPin = documentEndPinRef.current;
				if (documentEndPin?.generation === state.generation) {
					clearDocumentEndPin(documentEndPin, false);
				}
				props.onDiagnostic?.("preview-window-edit-map-missing");
				setState((current) =>
					"html" === current.kind && current.generation === state.generation
						? {
								...current,
								phase: "failed",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: null,
								windowedFailure: true,
							}
						: current,
				);
				return;
			}
			try {
				repository = createPreviewWindowRepository(surface, state.editMap, {
					revision: state.generation,
					signature: state.signature,
					styleEpoch: windowStyleEpochRef.current,
					widthEpoch: windowWidthEpochRef.current,
				});
				windowGeometryRequiresMeasuredRef.current = false;
			} catch (error) {
				const documentEndPin = documentEndPinRef.current;
				if (documentEndPin?.generation === state.generation) {
					clearDocumentEndPin(documentEndPin, false);
				}
				props.onDiagnostic?.(previewFailureCode(error));
				setState((current) =>
					"html" === current.kind && current.generation === state.generation
						? {
								...current,
								phase: "failed",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: null,
								windowedFailure: true,
							}
						: current,
				);
				return;
			}
			previewWindowRepositoryRef.current = repository;
			if (
				!acceptedWindowBaselineRef.current ||
				acceptedWindowBaselineRef.current.revision !== state.generation ||
				acceptedWindowBaselineRef.current.signature !== state.signature
			) {
				const currentSourceMarkdown =
					committedEnhancementCandidateRef.current?.generation ===
					state.generation
						? committedEnhancementCandidateRef.current.markdown
						: acceptedGeneratedPreviewRef.current?.generation ===
								  state.generation
							? acceptedGeneratedPreviewRef.current.markdown
							: (readCurrentSourceSnapshot()?.value ?? null);
				acceptedWindowBaselineRef.current = captureAcceptedWindowBaseline(
					surface,
					repository,
					state.generation,
					state.signature,
					currentSourceMarkdown,
					readCurrentSourceSnapshot()?.revision ?? null,
				);
				if (!acceptedWindowBaselineRef.current) {
					props.onDiagnostic?.("preview-window-baseline-capture-failed");
					setState((current) =>
						"html" === current.kind && current.generation === state.generation
							? {
									...current,
									phase: "failed",
									signature: "",
									windowedCommit: null,
									windowedFailure: true,
									materializeCommit: null,
									stagedCommit: null,
								}
							: current,
					);
					return;
				}
			}
		}

		const activeRepository = repository;
		const canvas = previewScrollCanvas(surface);
		const documentRef = surface.ownerDocument;
		const windowRef = documentRef.defaultView;
		let frame: number | null = null;
		let disposed = false;
		let pendingMountedGeometry: PreviewWindowMountedGeometryMeasurement | null =
			null;
		if (
			activeRepository.context.styleEpoch !== windowStyleEpochRef.current ||
			activeRepository.context.widthEpoch !== windowWidthEpochRef.current
		) {
			const hadMeasuredGeometry =
				installedWindowGeometryContextRef.current !== null;
			activeRepository.context = activeRepository.model.resetEpochs(
				activeRepository.context,
				{
					styleEpoch: windowStyleEpochRef.current,
					widthEpoch: windowWidthEpochRef.current,
				},
			);
			resetPreviewWindowFlowGeometry(activeRepository);
			if (hadMeasuredGeometry) {
				windowGeometryRequiresMeasuredRef.current = true;
			}
			installedWindowGeometryContextRef.current = null;
		}
		windowWidthRef.current = surface.getBoundingClientRect().width;
		const geometryEpoch = () =>
			previewWindowGeometryEpochKey(activeRepository.context);
		const geometryScheduler =
			props.stagingScheduler ??
			defaultPreviewSurfaceStagingScheduler(surface.ownerDocument);

		const cancelFrame = () => {
			if (null === frame) return;
			if (windowRef?.cancelAnimationFrame) {
				windowRef.cancelAnimationFrame(frame);
			} else {
				windowRef?.clearTimeout(frame);
			}
			frame = null;
		};

		const pinnedIndices = (): readonly number[] => {
			const pins = new Set<number>();
			if (activeRepository.ownedGap) {
				pins.add(activeRepository.ownedGap.before);
				if (activeRepository.ownedGap.after !== null) pins.add(activeRepository.ownedGap.after);
			}
			const selection = documentRef.getSelection?.();
			if (
				selection &&
				1 === selection.rangeCount &&
				selection.anchorNode === surface &&
				selection.focusNode === surface
			) {
				const start = Math.min(
					selection.anchorOffset,
					selection.focusOffset,
				);
				const end = Math.max(
					selection.anchorOffset,
					selection.focusOffset,
				);
				for (let childIndex = start; childIndex < end; childIndex += 1) {
					const child = surface.childNodes[childIndex];
					const index = child
						? previewWindowBlockIndexForNode(activeRepository, surface, child)
						: null;
					if (null !== index) pins.add(index);
				}
			}
			const selectionIndex = previewWindowBlockIndexForNode(
				activeRepository,
				surface,
				selection?.anchorNode ?? null,
			);
			if (null !== selectionIndex) pins.add(selectionIndex);
			const focusIndex = previewWindowBlockIndexForNode(
				activeRepository,
				surface,
				selection?.focusNode ?? null,
			);
			if (null !== focusIndex) pins.add(focusIndex);
			const activeIndex = previewWindowBlockIndexForNode(
				activeRepository,
				surface,
				documentRef.activeElement,
			);
			if (null !== activeIndex) pins.add(activeIndex);
			if (
				selection?.isCollapsed &&
				selection.anchorNode === surface &&
				selection.focusNode === surface &&
				selection.anchorOffset === selection.focusOffset
			) {
				if (0 === selection.anchorOffset) pins.add(0);
				if (
					selection.anchorOffset === surface.childNodes.length &&
					activeRepository.nodes.length > 0
				) {
					pins.add(activeRepository.nodes.length - 1);
				}
			}
			const documentEndPin = documentEndPinRef.current;
			if (
				documentEndPin?.generation === activeRepository.context.revision &&
				documentEndPin.signature === activeRepository.context.signature
			) {
				for (const targetIndex of documentEndPin.targetIndices) {
					pins.add(targetIndex);
				}
			}
			return [...pins].sort((left, right) => left - right);
		};

		const commitWindow = () => {
			frame = null;
			if (disposed || windowCommitPendingRef.current) return;
			if (materializationPendingRef.current || materializedOverrideRef.current) {
				// Do not race the sink or replace a consumer's full surface. Pending sink
				// completion restarts setup; a later activation releases a completed hold.
				return;
			}
			if (compositionSurfaceHeldRef.current) {
				// A lease owns the surface: measuring the draft would certify its
				// preedit height. Release re-runs this effect with fresh props.
				return;
			}
			try {
				activeRepository.model.assertCurrent(activeRepository.context);
				if (
					pendingMountedGeometry &&
					pendingMountedGeometry.contextKey !== geometryEpoch()
				) {
					pendingMountedGeometry = null;
				}
				if (!pendingMountedGeometry) {
					const mountedIndices: number[] = [];
					for (const child of Array.from(surface.children)) {
						const index = previewWindowBlockIndexForNode(
							activeRepository,
							surface,
							child,
						);
						if (null !== index) mountedIndices.push(index);
					}
					pendingMountedGeometry = {
						anchorCorrection: 0,
						anchorGeometryMeasured: false,
						anchorIndex: mountedIndices[0] ?? 0,
						contextKey: geometryEpoch(),
						cursor: 0,
						indices: mountedIndices,
					};
				}
				const geometrySliceStartedAt = stagingTime(
					geometryScheduler,
					surface.ownerDocument,
				);
				while (
					pendingMountedGeometry.cursor < pendingMountedGeometry.indices.length
				) {
					const pending: PreviewWindowMountedGeometryMeasurement =
						pendingMountedGeometry;
					const index = pending.indices[pending.cursor];
					pending.cursor += 1;
					if (undefined === index) continue;
					const canReusePreparedGeometry =
						index !== pending.anchorIndex &&
						installedWindowGeometryContextRef.current !== geometryEpoch() &&
						activeRepository.flowGeometryEpoch[index] === geometryEpoch() &&
						activeRepository.flowGapEpoch[index] === geometryEpoch();
					if (canReusePreparedGeometry) continue;
					const node = activeRepository.nodes[index];
					if (!node?.isConnected || node.parentNode !== surface) {
						throw new PreviewWindowDomError(
							"preview-window-flow-node-unavailable",
						);
					}
					const rect = node.getBoundingClientRect();
					const hasPositiveHeight =
						(Number.isFinite(rect.height) && rect.height > 0) ||
						node.offsetHeight > 0;
					if (!hasPreviewWindowLayoutBox(node, rect)) {
						if (
							windowGeometryRequiresMeasuredRef.current &&
							activeRepository.flowGeometryEpoch[index] !== geometryEpoch()
						) {
							throw new PreviewWindowDomError(
								"preview-window-flow-measurement-unavailable",
							);
						}
						continue;
					}
					const previousGeometry = activeRepository.flowGeometry[index];
					if (!previousGeometry) {
						throw new PreviewWindowDomError(
							"preview-window-flow-geometry-missing",
						);
					}
					const measurement = measurePreviewWindowBlockGeometry(
						node,
						activeRepository.nodes[index + 1] ?? null,
						previousGeometry,
						activeRepository.ownedGap?.node,
					);
					if (!measurement) {
						if (
							windowGeometryRequiresMeasuredRef.current &&
							!hasPositiveHeight &&
							activeRepository.flowGeometryEpoch[index] !== geometryEpoch()
						) {
							throw new PreviewWindowDomError(
								"preview-window-flow-measurement-unavailable",
							);
						}
						if (activeRepository.flowGeometryEpoch[index] !== geometryEpoch()) {
							throw new PreviewWindowDomError(
								"preview-window-flow-transform-unmeasured",
							);
						}
						if (
							index === pending.anchorIndex &&
							activeRepository.flowGeometryEpoch[index] === geometryEpoch()
						)
							pending.anchorGeometryMeasured = true;
						continue;
					}
					if (index === pending.anchorIndex)
						pending.anchorGeometryMeasured = true;
					const publication = publishPreviewWindowMeasuredBlock(
						activeRepository,
						surface,
						index,
						measurement,
						pending.anchorIndex,
						rect,
					);
					pending.anchorCorrection += publication.anchorCorrection;
					if (
						stagingTime(geometryScheduler, surface.ownerDocument) -
							geometrySliceStartedAt >=
						PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS
					) {
						frame = null;
						scheduleWindow();
						return;
					}
				}
				if (
					pendingMountedGeometry.indices.length > 0 &&
					!pendingMountedGeometry.anchorGeometryMeasured
				) {
					// A hidden activation can expose connected roots before their first
					// layout metric. Keep the repository uncommitted; the existing resize
					// observer will re-enter this pass when the surface becomes measurable.
					pendingMountedGeometry.cursor = 0;
					pendingMountedGeometry.anchorCorrection = 0;
					return;
				}
				const anchorCorrection = pendingMountedGeometry.anchorCorrection;
				if (0 !== anchorCorrection) canvas.scrollTop += anchorCorrection;
				const documentEndPin = documentEndPinRef.current;
				const documentEndPinApplies = Boolean(
					documentEndPin?.generation === activeRepository.context.revision &&
						documentEndPin.signature === activeRepository.context.signature &&
						documentEndPin.targetIndices.length > 0,
				);
				const result = activeRepository.model.getWindow({
					context: activeRepository.context,
					pinnedIndices: pinnedIndices(),
					...(documentEndPinApplies
						? { maxMaterialized: DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED }
						: {}),
					viewport: viewportForCanvas(canvas),
				});
				const commit: MutablePreviewWindowCommit = {
					key: ++windowCommitKeyRef.current,
					nodes: [...windowNodes(activeRepository, result)],
					revision: activeRepository.context.revision,
				};
				const deferredAnchor = pendingWindowFlowAnchorRef.current;
				const preserveDeferredAnchor = Boolean(
					deferredAnchor?.node.isConnected &&
					!acceptedWindowSnapshotRef.current,
				);
				if (!preserveDeferredAnchor) {
					const survivingAnchor = commit.nodes.find(
						(node): node is HTMLElement =>
							node instanceof HTMLElement &&
							!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE) &&
							node.parentNode === surface,
					);
					if (survivingAnchor) {
						const anchorRect = survivingAnchor.getBoundingClientRect();
						if (!hasPreviewWindowLayoutBox(survivingAnchor, anchorRect)) {
							pendingMountedGeometry.cursor = 0;
							pendingMountedGeometry.anchorCorrection = 0;
							pendingMountedGeometry.anchorGeometryMeasured = false;
							return;
						}
						const anchorTop = anchorRect.top;
						const documentTop = previewWindowFlowDocumentCoordinate(
							surface,
							anchorTop,
							"preview-window-flow-anchor-invalid",
						);
						pendingWindowFlowAnchorRef.current = Number.isFinite(documentTop)
							? {
									documentTop,
								node: survivingAnchor,
							}
							: null;
					} else {
						pendingWindowFlowAnchorRef.current = null;
					}
				}
				pendingMountedGeometry = null;
				if (
					commit.nodes.length === surface.childNodes.length &&
					commit.nodes.every(
						(node, index) => surface.childNodes[index] === node,
					)
				) {
					const pendingAnchor = pendingWindowFlowAnchorRef.current;
					if (pendingAnchor?.node.isConnected) {
						if (
							!hasMeasuredMountedPreviewWindowGeometry(
								activeRepository,
								surface,
								pendingAnchor,
							)
						) {
							scheduleWindow();
							return;
						}
						verifyPreviewWindowFlowAnchor(surface, pendingAnchor);
					}
					pendingWindowFlowAnchorRef.current = null;
					if (!acceptedWindowSnapshotRef.current) {
						const currentState = stateRef.current;
						if (
							"html" === currentState.kind &&
							(currentState.phase === "committing" ||
								currentState.phase === "ready") &&
							currentState.windowedCommit?.revision ===
								activeRepository.context.revision
						) {
							acceptedWindowSnapshotRef.current =
								createAcceptedWindowSnapshot(
									surface,
									activeRepository,
									currentState.windowedCommit,
									currentState,
									acceptedWindowBaselineRef.current,
								);
							installedWindowGeometryContextRef.current =
								previewWindowGeometryEpochKey(activeRepository.context);
						}
					}
					if (acceptedWindowSnapshotRef.current) {
						props.onWindowReady?.();
					}
					return;
				}
				windowCommitPendingRef.current = true;
				acceptedWindowSnapshotRef.current = null;
				installedWindowSnapshotRef.current = null;
				pendingWindowCommitRef.current = commit;
				setState((current) =>
					"html" === current.kind &&
					current.generation === activeRepository.context.revision &&
					"ready" === current.phase
						? { ...current, windowedCommit: commit }
						: current,
				);
			} catch (error) {
				windowCommitPendingRef.current = false;
				pendingWindowCommitRef.current = null;
				acceptedWindowSnapshotRef.current = null;
				installedWindowSnapshotRef.current = null;
				previewWindowRepositoryRef.current = null;
				props.onDiagnostic?.(previewFailureCode(error));
				setState((current) =>
					"html" === current.kind &&
					current.generation === activeRepository.context.revision
						? {
								...current,
								phase: "failed",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: retainedWindowedCommit(current),
								windowedFailure: true,
							}
						: current,
				);
			}
		};

		const scheduleWindow = () => {
			if (compositionSurfaceHeldRef.current) return;
			if (disposed || geometryPreparationRef.current || null !== frame) return;
			if (materializationPendingRef.current || materializedOverrideRef.current) {
				// This is the same activation-scoped hold as commitWindow, not a dropped
				// unlock: completion retries setup, failure publishes error, reentry releases.
				return;
			}
			if (windowRef?.requestAnimationFrame) {
				frame = windowRef.requestAnimationFrame(commitWindow);
				return;
			}
			frame = windowRef
				? (windowRef.setTimeout(commitWindow, 0) as unknown as number)
				: (setTimeout(commitWindow, 0) as unknown as number);
		};

		scheduleWindowRef.current = scheduleWindow;

		const onSelectionChange = () => scheduleWindow();
		const onResize = () => {
			const width = surface.getBoundingClientRect().width;
			const previousWidth = windowWidthRef.current;
			if (
				Number.isFinite(width) &&
				width > 0 &&
				null !== previousWidth &&
				Math.abs(width - previousWidth) >= 0.5
			) {
				const hadMeasuredGeometry =
					installedWindowGeometryContextRef.current !== null;
				windowWidthRef.current = width;
				windowWidthEpochRef.current += 1;
				activeRepository.context = activeRepository.model.resetEpochs(
					activeRepository.context,
					{
						styleEpoch: windowStyleEpochRef.current,
						widthEpoch: windowWidthEpochRef.current,
					},
				);
				resetPreviewWindowFlowGeometry(activeRepository);
				if (hadMeasuredGeometry) {
					windowGeometryRequiresMeasuredRef.current = true;
				}
				installedWindowGeometryContextRef.current = null;
			}
			scheduleWindow();
		};
		const beginGeometryPreparation = (): boolean => {
			if (compositionSurfaceHeldRef.current) return false;
			const currentState = stateRef.current;
			if (
				"html" !== currentState.kind ||
				"ready" !== currentState.phase ||
				currentState.windowedCommit ||
				!isFullMaterializedWindowSurface(surface, activeRepository)
			)
				return false;
			const hasLayoutBox = activeRepository.nodes.some((node) =>
				hasPreviewWindowLayoutBox(node, node.getBoundingClientRect()),
			);
			if (!hasLayoutBox) return false;
			const controller = new AbortController();
			const preparation: PreviewWindowGeometryPreparation = {
				controller,
				key: ++geometryPreparationKeyRef.current,
				revision: activeRepository.context.revision,
				styleEpoch: activeRepository.context.styleEpoch,
				widthEpoch: activeRepository.context.widthEpoch,
			};
			geometryPreparationRef.current = preparation;
			const scheduler =
				props.stagingScheduler ??
				defaultPreviewSurfaceStagingScheduler(surface.ownerDocument);
			const isCurrentPreparation = (): boolean => {
				const context = activeRepository.context;
				return Boolean(
					geometryPreparationRef.current === preparation &&
						!controller.signal.aborted &&
						!compositionSurfaceHeldRef.current &&
						ownerActiveRef.current &&
						previewWindowRepositoryRef.current === activeRepository &&
						generationRef.current === preparation.revision &&
						context.revision === preparation.revision &&
						context.styleEpoch === preparation.styleEpoch &&
						context.widthEpoch === preparation.widthEpoch,
				);
			};
			const isCurrentFullSurface = (): boolean =>
				isCurrentPreparation() &&
				isFullMaterializedWindowSurface(surface, activeRepository);
			void (async () => {
				let sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
				for (let index = 0; index < activeRepository.nodes.length; index += 1) {
					if (!isCurrentPreparation()) return;
					const node = activeRepository.nodes[index];
					if (
						!node ||
						surface.children[index] !== node ||
						!node.isConnected ||
						node.parentNode !== surface ||
						node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
					) {
						throw new PreviewWindowDomError("preview-window-flow-node-missing");
					}
					const rect = node.getBoundingClientRect();
					const hasPositiveHeight =
						(Number.isFinite(rect.height) && rect.height > 0) ||
						node.offsetHeight > 0;
					if (!hasPreviewWindowLayoutBox(node, rect)) {
						throw new PreviewWindowDomError(
							"preview-window-flow-measurement-unavailable",
						);
					}
					const previousGeometry = activeRepository.flowGeometry[index];
					if (!previousGeometry) {
						throw new PreviewWindowDomError(
							"preview-window-flow-geometry-missing",
						);
					}
					const measurement = measurePreviewWindowBlockGeometry(
						node,
						activeRepository.nodes[index + 1] ?? null,
						previousGeometry,
						activeRepository.ownedGap?.node,
					);
					if (!measurement) {
						if (windowGeometryRequiresMeasuredRef.current && !hasPositiveHeight) {
							throw new PreviewWindowDomError(
								"preview-window-flow-measurement-unavailable",
							);
						}
						throw new PreviewWindowDomError(
							"preview-window-flow-transform-unmeasured",
						);
					}
					publishPreviewWindowMeasuredBlock(
						activeRepository,
						surface,
						index,
						measurement,
						0,
						rect,
					);
					if (
						stagingTime(scheduler, surface.ownerDocument) - sliceStartedAt >=
						PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS
					) {
						await scheduler.yield();
						if (!isCurrentPreparation()) return;
						sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
					}
				}
				if (!isCurrentFullSurface()) return;
				capturePreviewWindowFlowBoundary(
					activeRepository,
					surface,
					geometryEpoch(),
				);
				windowGeometryRequiresMeasuredRef.current = false;
				geometryPreparationRef.current = null;
				scheduleWindow();
			})()
				.catch((error: unknown) => {
					if (!isCurrentPreparation()) return;
					geometryPreparationRef.current = null;
					previewWindowRepositoryRef.current = null;
					props.onDiagnostic?.(previewFailureCode(error));
					setState((current) =>
						"html" === current.kind &&
						current.generation === preparation.revision
							? {
									...current,
									phase: "failed",
									signature: "",
									materializeCommit: null,
									stagedCommit: null,
									windowedCommit: null,
									windowedFailure: true,
								}
							: current,
					);
				})
				.finally(() => {
					if (geometryPreparationRef.current === preparation) {
						geometryPreparationRef.current = null;
						if (!controller.signal.aborted && !disposed) {
							if (!beginGeometryPreparation()) scheduleWindow();
						}
					}
				});
			return true;
		};
		const resizeObserverConstructor = windowRef?.ResizeObserver;
		const resizeObserver = resizeObserverConstructor
			? new resizeObserverConstructor(onResize)
			: null;
		canvas.addEventListener("scroll", scheduleWindow, { passive: true });
		documentRef.addEventListener("selectionchange", onSelectionChange);
		windowRef?.addEventListener("resize", onResize);
		resizeObserver?.observe(canvas);
		resizeObserver?.observe(surface);
		if (!beginGeometryPreparation()) scheduleWindow();

		return () => {
			disposed = true;
			pendingMountedGeometry = null;
			if (
				geometryPreparationRef.current?.revision ===
				activeRepository.context.revision
			) {
				geometryPreparationRef.current.controller.abort();
				geometryPreparationRef.current = null;
			}
			cancelFrame();
			resizeObserver?.disconnect();
			if (scheduleWindowRef.current === scheduleWindow) {
				scheduleWindowRef.current = () => undefined;
			}
			canvas.removeEventListener("scroll", scheduleWindow);
			documentRef.removeEventListener("selectionchange", onSelectionChange);
			windowRef?.removeEventListener("resize", onResize);
		};
	}, [
		state.kind,
		state.generation,
		readyHtml?.editMap,
		readyHtml?.materializeCommit,
		readyHtml?.phase,
		readyHtml?.signature,
		windowedEditing,
		materialize,
		props.className,
		props.onDiagnostic,
		props.onWindowReady,
		props.style,
		// A suspended setup must wake for the lease's release with the current
		// props instead of staying asleep with stale measurement closures.
		compositionSurfaceVersion,
	]);

	useLayoutEffect(() => {
		if (
			"html" !== state.kind ||
			"ready" !== state.phase ||
			layoutSyncedGenerationRef.current === state.generation
		) {
			return;
		}
		const surface = surfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");
		if (!surface.querySelector("pre > code.hljs")) return;
		layoutSyncedGenerationRef.current = state.generation;
		try {
			props.enhancementPort.syncCodeFrameBackgrounds(surface);
		} catch (error) {
			props.onDiagnostic?.(previewEnhancementFailureCode(error));
		}
	}, [state, props.enhancementPort, props.onDiagnostic]);

	const busy =
		"loading" === state.kind ||
		("html" === state.kind &&
			["committing", "enhancing", "loading"].includes(state.phase));
	const failed = "html" === state.kind && "failed" === state.phase;
	const effectiveContentEditable =
		props.contentEditable && !("html" === state.kind && state.windowedFailure);

	return (
		<SafePreviewHtmlSink
			ariaBusy={busy}
			error={failed}
			html={"html" === state.kind ? state.html : null}
			htmlRevision={
				"html" === state.kind ? state.htmlRevision : state.generation
			}
			materializeCommit={"html" === state.kind ? state.materializeCommit : null}
			phase={"html" === state.kind ? state.phase : state.kind}
			{...(props.materializeScheduler
				? { materializeScheduler: props.materializeScheduler }
				: {})}
			onMaterializeComplete={onMaterializeComplete}
			onMaterializeFailure={onMaterializeFailure}
			onStagedCommit={onStagedCommit}
			refreshing={busy}
			compositionGate={compositionSurfaceGate}
			acceptedHtml={
				"html" === state.kind &&
				Boolean(state.html.trim()) &&
				"failed" !== state.phase &&
				acceptedHtmlRevisionRef.current === state.htmlRevision
			}
			surfaceRef={surfaceRef}
			stagedCommit={"html" === state.kind ? state.stagedCommit : null}
			{...("empty" === state.kind
				? {
						statusClassName: "easymde-preview-empty",
						statusMessage: props.messages.empty,
					}
				: {})}
			{...("error" === state.kind
				? {
						statusClassName: "easymde-preview-error",
						statusMessage: props.messages.error,
					}
				: {})}
			{...(("loading" === state.kind ||
				("html" === state.kind &&
					"enhancing" === state.phase &&
					!state.html.trim())) &&
			"paper" !== props.emptyMode
				? {
						statusClassName: "easymde-preview-pending",
						statusMessage: props.messages.loading,
						statusRole: "status",
					}
				: {})}
			{...(undefined !== props.contentEditable
				? { contentEditable: effectiveContentEditable }
				: {})}
			{...(props.label ? { label: props.label } : {})}
			{...(props.role ? { role: props.role } : {})}
			{...(undefined !== props.spellCheck
				? { spellCheck: props.spellCheck }
				: {})}
			{...(props.className ? { className: props.className } : {})}
			{...(props.style ? { style: props.style } : {})}
			windowedCommit={"html" === state.kind ? state.windowedCommit : null}
		/>
	);
}

declare global {
	interface HTMLElement {
		easymdePreviewSignature?: string;
	}
}
