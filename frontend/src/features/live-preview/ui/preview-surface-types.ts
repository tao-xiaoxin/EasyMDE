import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type {
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../../contracts/ports/editor-block-index-port";
import type {
	PreviewEditMap,
	PreviewFeatures,
	PreviewRequestPort,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import { VISUAL_MARKDOWN_SOURCE_ATTRIBUTE } from "../../../shared/markdown/normalize-math-tex";
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
import {
	type PreviewEnhancementPort,
	previewEnhancementFailureCode,
} from "../ports/preview-enhancement-port";
import type {
	PreviewScrollPort,
	PreviewScrollSnapshot,
} from "../ports/preview-scroll-port";
import type { SafePreviewHtmlSinkCommit } from "./SafePreviewHtmlSink";

export const PREVIEW_STAGING_SLICE_BUDGET_MS = 8;
export const PREVIEW_STAGING_DOM_APPEND_MAX_NODES = 32;
export const PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS = 32;
export const PREVIEW_LARGE_DOCUMENT_BLOCK_THRESHOLD = 160;
export const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";
export { VISUAL_MARKDOWN_SOURCE_ATTRIBUTE };

export class PreviewSurfaceDomError extends Error {
	constructor(code: string) {
		super(code);
		this.name = "PreviewSurfaceDomError";
	}
}

export function previewFailureCode(error: unknown): string {
	return error instanceof PreviewSurfaceDomError
		? error.message
		: previewEnhancementFailureCode(error);
}

export function isLargePreviewDocument(
	editMap: PreviewEditMap | null,
): boolean {
	return (editMap?.blocks.length ?? 0) > PREVIEW_LARGE_DOCUMENT_BLOCK_THRESHOLD;
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
	stagedCommit: SafePreviewHtmlSinkCommit | null;
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

export type PreviewSourceSelection = Readonly<{
	end: number;
	start: number;
}>;

export type PreviewGeneratedContentTargetRequest = Readonly<{
	element: Element;
	index: PreviewGeneratedContentTargetIndex;
	kind: GeneratedContentKind;
	ordinal: number;
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

export type VisualBlockMarker = Readonly<{
	id: string;
	marker: Comment;
}>;

export type VisualMarkdownSourceMarker = Readonly<{
	kind: "math" | "mermaid";
	marker: Comment;
	source: string;
}>;

export type PendingPreviewScrollRestore = Readonly<{
	generation: number;
	snapshot: PreviewScrollSnapshot;
}>;

export type PreviewSurfaceRuntime = Readonly<{
	getGeneratedPreviewIdentity: () => PreviewGeneratedPreviewIdentity | null;
	prepareGeneratedContentTarget: (
		request: PreviewGeneratedContentTargetRequest,
	) => PreviewGeneratedContentTargetLease | null;
	prepareGeneratedContentTargetForSelection: (
		request: PreviewGeneratedContentTargetForSelectionRequest,
	) => PreviewGeneratedContentTargetPinLease | null;
	prepareImageTarget: (
		request: PreviewImageTargetRequest,
	) => PreviewImageTargetLease | null;
	prepareImageTargetBySelection: (
		request: PreviewImageTargetSelectionRequest,
	) => PreviewImageTargetPinLease | null;
	session: PreviewRequestSession;
	surface: HTMLElement;
}>;

export type PreviewSurfaceOwnerProps = Readonly<{
	className?: string;
	currentSourceSnapshot?: () => PreviewSourceSnapshot | null;
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
	onDispose?: (runtime: PreviewSurfaceRuntime) => void;
	onHtmlChange?: (html: SafePreviewHtml) => void;
	onImageReadinessChange?: () => void;
	onReady: (runtime: PreviewSurfaceRuntime) => void;
	onSnapshotReady?: (
		html: SafePreviewHtml,
		signature: string,
		editMap: PreviewEditMap | null,
	) => void;
	onStatusChange?: (status: PreviewSurfaceStatus) => void;
	port: PreviewRequestPort;
	role?: string;
	scrollPort: PreviewScrollPort;
	sourceRevision?: number;
	stagingScheduler?: PreviewSurfaceStagingScheduler;
	style?: CSSProperties;
}>;

export type MutableRefBox<T> = { current: T };

export type PreviewSurfaceRefs = Readonly<{
	acceptedGeneratedPreviewRef: MutableRefBox<AcceptedGeneratedPreview | null>;
	acceptedHtmlRevisionRef: MutableRefBox<number | null>;
	committedEnhancementCandidateRef: MutableRefBox<PreviewEnhancementCandidate | null>;
	currentSourceSnapshotRef: MutableRefBox<
		(() => PreviewSourceSnapshot | null) | undefined
	>;
	emptyModeRef: MutableRefBox<"message" | "paper" | undefined>;
	enhancementCandidateRef: MutableRefBox<PreviewEnhancementCandidate | null>;
	generationRef: MutableRefBox<number>;
	getGeneratedPreviewIdentityRef: MutableRefBox<
		PreviewSurfaceRuntime["getGeneratedPreviewIdentity"]
	>;
	layoutSyncedGenerationRef: MutableRefBox<number | null>;
	ownerActiveRef: MutableRefBox<boolean>;
	prepareGeneratedContentTargetForSelectionRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetForSelection"]
	>;
	prepareGeneratedContentTargetRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareGeneratedContentTarget"]
	>;
	prepareImageTargetBySelectionRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareImageTargetBySelection"]
	>;
	prepareImageTargetRef: MutableRefBox<
		PreviewSurfaceRuntime["prepareImageTarget"]
	>;
	scrollSnapshotRef: MutableRefBox<PendingPreviewScrollRestore | null>;
	sourceRevisionRef: MutableRefBox<number | null>;
	stagedPreviewImageElementsRef: MutableRefBox<StagedPreviewImageElements | null>;
	stateRef: MutableRefBox<PreviewSurfaceState>;
	surfaceRef: MutableRefBox<HTMLElement | null>;
}>;

export type PreviewSurfaceSetState = Dispatch<
	SetStateAction<PreviewSurfaceState>
>;

export type PreviewStagedCommitActions = Readonly<{
	beforeStagedCommit: (revision: number, hasInstalledHtml: boolean) => boolean;
	captureScroll: (generation: number) => void;
	discardPendingWork: () => void;
	discardStaging: () => void;
	onStagedCommit: (revision: number) => void;
}>;

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
				stagedCommit: null,
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
		stagedCommit: null,
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
