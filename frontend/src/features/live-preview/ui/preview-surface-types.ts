import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type {
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../../contracts/ports/editor-block-index-port";
import type {
	PreviewAcceptedWindowRow,
	PreviewAcceptedWindowRowRequest,
	PreviewEditMap,
	PreviewFeatures,
	PreviewRequestPort,
	PreviewRequestState,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import type { DocumentHistoryState } from "../../document-source/adapters/code-mirror-document-session";
import type {
	GeneratedContentKind,
	GeneratedContentTarget,
	GeneratedContentTargetLease as GeneratedTargetLease,
} from "../../generated-content-export/generated-content-target";
import type {
	GeneratedImageTarget,
	GeneratedImageTargetIndex,
	GeneratedImageTargetSelection,
} from "../../generated-content-export/generated-image-target";
import type { PreviewRequestSession } from "../model/create-preview-request-session";
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
	PreviewWindowDomError,
	type PreviewWindowNodeRepository,
} from "./preview-window-dom";
import type {
	SafePreviewHtmlSinkCommit,
	SafePreviewHtmlSinkMaterializeCommit,
	SafePreviewHtmlSinkSelectionHandoff,
	SafePreviewHtmlSinkWindowCommit,
	SafePreviewHtmlSinkWindowController,
} from "./SafePreviewHtmlSink";

export const PREVIEW_STAGING_SLICE_BUDGET_MS = 8;
export const PREVIEW_STAGING_DOM_APPEND_MAX_NODES = 32;
export const PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS = 32;
export const PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS = 4;
export const VISUAL_MARKDOWN_SOURCE_ATTRIBUTE =
	"data-easymde-visual-markdown-source";
export const ACCEPTED_WINDOW_BASELINE_SHIFT_COMPACTION_LIMIT = 64;

export function previewFailureCode(error: unknown): string {
	return error instanceof PreviewWindowDomError
		? error.message
		: previewEnhancementFailureCode(error);
}

/**
 * The sink boundary for a same-generation window install.
 *
 * `precommit` is the only stage that proves the sink did not install the next
 * commit. `installed` retains ownership of the actual sink commit even when
 * certification, snapshot publication, readiness, or diagnostic notification
 * fails; a consumer must not roll it back to the previous DOM.
 */
export class PreviewWindowInstallFault extends Error {
	constructor(
		readonly stage: "precommit" | "installed",
		readonly code: string,
		override readonly cause?: unknown,
		readonly diagnosticCause?: unknown,
	) {
		super(code);
		this.name = "PreviewWindowInstallFault";
	}
}

export function isPreviewWindowInstallFault(
	error: unknown,
): error is PreviewWindowInstallFault {
	return error instanceof PreviewWindowInstallFault;
}

export function previewNeedsWindow(editMap: PreviewEditMap | null): boolean {
	return (editMap?.blocks.length ?? 0) > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
}

// The editing marker changes caret and selection presentation only; theme and
// font classes remain part of the geometry epoch.
export function previewWindowGeometryClassName(
	className: string | undefined,
): string {
	return (className ?? "")
		.split(/\s+/u)
		.filter((value) => value && "easymde-immersive-visual-editor" !== value)
		.join(" ");
}

export function previewWindowGeometryEpochKey(
	context: Readonly<
		Pick<
			PreviewWindowNodeRepository["context"],
			"revision" | "signature" | "styleEpoch" | "widthEpoch"
		>
	>,
): string {
	return `${context.revision}:${context.signature}:${context.styleEpoch}:${context.widthEpoch}`;
}

export type AcceptedEditableBlockRange = Readonly<{
	endLine: number;
	index: number;
	startLine: number;
}>;

export type PreviewMessages = Readonly<{
	empty: string;
	error: string;
	loading: string;
}>;

export type PreviewHtmlState = Readonly<{
	codeTheme: string;
	editMap: PreviewEditMap | null;
	features: PreviewFeatures;
	generation: number;
	html: SafePreviewHtml;
	htmlRevision: number;
	kind: "html";
	paperPlaceholder?: true;
	phase:
		| "committing"
		| "enhancing"
		| "failed"
		| "loading"
		| "ready"
		| "retained";
	signature: string;
	materializeCommit: SafePreviewHtmlSinkMaterializeCommit | null;
	stagedCommit: SafePreviewHtmlSinkCommit | null;
	windowedCommit: SafePreviewHtmlSinkWindowCommit | null;
	windowedFailure?: boolean;
}>;

export type PreviewStatusState = Readonly<{
	generation: number;
	kind: "empty" | "error" | "loading";
}>;

export type PreviewSurfaceState = PreviewHtmlState | PreviewStatusState;

export type PreviewSurfaceStagingScheduler = Readonly<{
	now?: () => number;
	yield: () => Promise<void>;
}>;

export type PreviewWindowGeometryPreparation = Readonly<{
	controller: AbortController;
	key: number;
	revision: number;
	styleEpoch: number;
	widthEpoch: number;
}>;

export type PreviewWindowMountedGeometryMeasurement = {
	anchorCorrection: number;
	anchorGeometryMeasured: boolean;
	anchorIndex: number;
	contextKey: string;
	indices: number[];
	cursor: number;
};

export type PreviewEnhancementCandidate = Readonly<{
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

export type AcceptedGeneratedPreview = Readonly<{
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

export type StagedPreviewImageElements = Readonly<{
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

export type MutablePreviewDocumentEndPin = {
	generation: number | null;
	requestRevision: number | null;
	signature: string;
	sourceSelection: PreviewSourceSelection | null;
	targetIndices: number[];
};

export type VisualBlockMarker = Readonly<{
	id: string;
	marker: Comment;
}>;

export type VisualMarkdownSourceMarker = Readonly<{
	kind: "math" | "mermaid";
	marker: Comment;
	source: string;
}>;

export type PendingMaterialization = Readonly<{
	key: number;
	promise: Promise<boolean>;
	resolve: (completed: boolean) => void;
	revision: number;
}>;

export type MutablePreviewWindowCommit = {
	key: number;
	nodes: Node[];
	revision: number;
	selectionHandoff?: SafePreviewHtmlSinkSelectionHandoff;
};

export type AcceptedWindowSourceRange = Readonly<{
	start: number;
	end: number;
}>;

export type AcceptedWindowBlockBaseline = Readonly<{
	id: string;
	innerHTML: string;
	node: HTMLElement;
	rootSnapshot: HTMLElement;
	sourceRange: AcceptedWindowSourceRange | null;
}>;

export type AcceptedWindowBaseBlockRecord = {
	readonly id: string;
	innerHTML: string | null;
	readonly node: HTMLElement;
	rootSnapshot: HTMLElement | null;
	readonly sourceRange: AcceptedWindowSourceRange | null;
};

export type AcceptedWindowBaselineBase = Readonly<{
	blocksByNode: ReadonlyMap<HTMLElement, AcceptedWindowBaseBlockRecord>;
	nodeById: ReadonlyMap<string, HTMLElement>;
}>;

export type AcceptedWindowBlockOverride = Readonly<{
	id: string;
	innerHTML: string;
	node: HTMLElement;
	rootSnapshot: HTMLElement;
	shiftIndex: number;
	sourceRange: AcceptedWindowSourceRange | null;
}>;

export type AcceptedWindowRangeShift = Readonly<{
	at: number;
	delta: number;
	sourceBlockId: string;
	sourceEnd: number;
	sourceStart: number;
}>;

export type AcceptedWindowBaseline = Readonly<{
	base: AcceptedWindowBaselineBase;
	lastEditedBlockId: string | null;
	markdown: string | null;
	overridesById: ReadonlyMap<string, AcceptedWindowBlockOverride>;
	overridesByNode: ReadonlyMap<HTMLElement, AcceptedWindowBlockOverride>;
	revision: number;
	shifts: ReadonlyArray<AcceptedWindowRangeShift>;
	signature: string;
	/** Local range transport does not renew the formal edit map. */
	sourceMapCurrent: boolean;
	sourceRevision: number | null;
}>;

export type PendingAdoptedBlockMeasurements = {
	frame: number | null;
	indices: Set<number>;
	repository: PreviewWindowNodeRepository;
	surface: HTMLElement;
	windowRef: Window | null;
};

export type PendingPreviewScrollRestore = Readonly<{
	generation: number;
	snapshot: PreviewScrollSnapshot;
}>;

export type PendingWindowFlowAnchor = Readonly<{
	documentTop: number;
	node: HTMLElement;
}>;

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
	getAcceptedReferenceSource: (
		request: Readonly<{ revision: number; signature: string }>,
	) => string | null;
	getAcceptedWindowSnapshot: () => PreviewAcceptedWindowSnapshot | null;
	getAcceptedWindowRow: (
		request: PreviewAcceptedWindowRowRequest,
	) => PreviewAcceptedWindowRow | null;
	revealAcceptedWindowRow: (
		request: PreviewAcceptedWindowRowRequest &
			Readonly<{
				gap: HTMLElement;
				source: string;
				sourceRevision: number;
				/** Text-row continuation retires the temporary caret address; atomic rows retain it. */
				retainGap?: boolean;
				onRefusal?: (
					reason: string,
					details: Readonly<Record<string, boolean | number>>,
				) => void;
			}>,
	) => PreviewAcceptedWindowSnapshot | null;
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

export type PreviewSurfaceOwnerProps = Readonly<{
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

export type MutableRefBox<T> = { current: T };

export type PreviewSurfaceRefs = Readonly<{
	surfaceRef: MutableRefBox<HTMLElement | null>;
	windowControllerRef: MutableRefBox<SafePreviewHtmlSinkWindowController | null>;
	ownedGapRef: MutableRefBox<PreviewOwnedGap | null>;
	resumeDeferredEnhancementRef: MutableRefBox<(() => void) | null>;
	scrollSnapshotRef: MutableRefBox<PendingPreviewScrollRestore | null>;
	generationRef: MutableRefBox<number>;
	enhancementCandidateRef: MutableRefBox<PreviewEnhancementCandidate | null>;
	committedEnhancementCandidateRef: MutableRefBox<PreviewEnhancementCandidate | null>;
	acceptedHtmlRevisionRef: MutableRefBox<number | null>;
	sourceRevisionRef: MutableRefBox<number | null>;
	currentSourceSnapshotRef: MutableRefBox<
		(() => PreviewSourceSnapshot | null) | undefined
	>;
	acceptedGeneratedPreviewRef: MutableRefBox<AcceptedGeneratedPreview | null>;
	stagedPreviewImageElementsRef: MutableRefBox<StagedPreviewImageElements | null>;
	previewWindowRepositoryRef: MutableRefBox<PreviewWindowNodeRepository | null>;
	acceptedWindowBaselineRef: MutableRefBox<AcceptedWindowBaseline | null>;
	pendingWindowBaselineRef: MutableRefBox<AcceptedWindowBaseline | null>;
	pendingAdoptedMeasurementsRef: MutableRefBox<PendingAdoptedBlockMeasurements | null>;
	acceptedWindowSnapshotRef: MutableRefBox<PreviewAcceptedWindowSnapshot | null>;
	installedWindowSnapshotRef: MutableRefBox<PreviewAcceptedWindowSnapshot | null>;
	pendingWindowCommitRef: MutableRefBox<MutablePreviewWindowCommit | null>;
	windowCommitKeyRef: MutableRefBox<number>;
	windowCommitPendingRef: MutableRefBox<boolean>;
	windowStyleEpochRef: MutableRefBox<number>;
	windowWidthEpochRef: MutableRefBox<number>;
	windowStyleSignatureRef: MutableRefBox<string>;
	windowWidthRef: MutableRefBox<number | null>;
	geometryPreparationKeyRef: MutableRefBox<number>;
	geometryPreparationRef: MutableRefBox<PreviewWindowGeometryPreparation | null>;
	windowGeometryRequiresMeasuredRef: MutableRefBox<boolean>;
	installedWindowGeometryContextRef: MutableRefBox<string | null>;
	pendingWindowFlowAnchorRef: MutableRefBox<PendingWindowFlowAnchor | null>;
	materializeCommitKeyRef: MutableRefBox<number>;
	materializePendingRef: MutableRefBox<PendingMaterialization | null>;
	materializationPendingRef: MutableRefBox<boolean>;
	materializedOverrideRef: MutableRefBox<boolean>;
	ownerActiveRef: MutableRefBox<boolean>;
	documentEndPinRef: MutableRefBox<MutablePreviewDocumentEndPin | null>;
	compositionSurfaceActivationRef: MutableRefBox<number>;
	compositionSurfaceLeasesRef: MutableRefBox<number>;
	compositionSurfaceHeldRef: MutableRefBox<boolean>;
	retainCompositionSurfaceRef: MutableRefBox<
		(activation: number) => PreviewCompositionSurfaceLease
	>;
	prepareWindowBlockAdoptionRef: MutableRefBox<
		(node: HTMLElement) => (() => boolean) | null
	>;
	prepareGeneratedContentTargetRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareGeneratedContentTarget"]
	>;
	prepareGeneratedContentTargetBySelectionRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetBySelection"]
	>;
	prepareGeneratedContentTargetForSelectionRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetForSelection"]
	>;
	prepareImageTargetRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareImageTarget"]
	>;
	prepareImageTargetBySelectionRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareImageTargetBySelection"]
	>;
	getGeneratedPreviewIdentityRef: MutableRefBox<
		PreviewSurfaceRuntime["getGeneratedPreviewIdentity"]
	>;
	getAcceptedWindowSnapshotRef: MutableRefBox<
		PreviewSurfaceRuntime["getAcceptedWindowSnapshot"]
	>;
	getAcceptedWindowRowRef: MutableRefBox<
		PreviewSurfaceRuntime["getAcceptedWindowRow"]
	>;
	revealAcceptedWindowRowRef: MutableRefBox<
		PreviewSurfaceRuntime["revealAcceptedWindowRow"]
	>;
	materializeRef: MutableRefBox<
		(reportDiagnostics?: boolean) => Promise<boolean>
	>;
	scheduleWindowRef: MutableRefBox<() => void>;
	windowedRef: MutableRefBox<boolean>;
	layoutSyncedGenerationRef: MutableRefBox<number | null>;
	emptyModeRef: MutableRefBox<"message" | "paper" | undefined>;
	stateRef: MutableRefBox<PreviewSurfaceState>;
}>;

export type PreviewSurfaceSetState = Dispatch<
	SetStateAction<PreviewSurfaceState>
>;

export type PreviewWindowCommitActions = Readonly<{
	cancelPendingAdoptedMeasurements: () => void;
	flushPendingAdoptedMeasurements: (
		repository?: PreviewWindowNodeRepository,
		surface?: HTMLElement,
	) => void;
	scheduleAdoptedBlockMeasurement: (
		repository: PreviewWindowNodeRepository,
		surface: HTMLElement,
		index: number,
	) => void;
	discardPendingWork: () => void;
	discardStaging: () => void;
	reconcileInstalledWindowCommit: (
		repository: PreviewWindowNodeRepository,
		surface: HTMLElement,
		commit: Readonly<{ nodes: ReadonlyArray<Node>; revision: number }>,
	) => void;
	beforeStagedCommit: (revision: number, hasInstalledHtml: boolean) => boolean;
	onStagedCommit: (revision: number) => void;
	onMaterializeComplete: (revision: number, key: number) => void;
	onMaterializeFailure: (revision: number, key: number, error: unknown) => void;
	materialize: (reportDiagnostics?: boolean) => Promise<boolean>;
	captureScroll: (generation: number) => void;
}>;

export type PreviewRequestStateLike = PreviewRequestState;

export function initialState(
	props: PreviewSurfaceOwnerProps,
): PreviewSurfaceState {
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

export function surfaceStatus(
	state: PreviewSurfaceState,
): PreviewSurfaceStatus {
	if ("html" !== state.kind) {
		return state.kind;
	}
	return "ready" === state.phase || "retained" === state.phase
		? "ready"
		: "failed" === state.phase
			? "error"
			: "loading";
}

export function previewScrollCanvas(surface: HTMLElement): HTMLElement {
	const canvas = surface.parentElement;
	if (!canvas?.classList.contains("easymde-immersive-preview-canvas")) {
		throw new Error("preview-scroll-canvas-missing");
	}
	return canvas;
}

declare global {
	interface HTMLElement {
		easymdePreviewSignature?: string;
	}
}
