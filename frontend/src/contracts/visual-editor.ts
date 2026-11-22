import type { ToolbarCommand } from "./bootstrap/toolbar-bootstrap";
import type {
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "./ports/editor-block-index-port";
import type { PreviewEditMap } from "./ports/preview-request";

export type VisualEditorSelectionDirection = "backward" | "forward" | "none";

export type VisualEditorSelection = Readonly<{
	direction: VisualEditorSelectionDirection;
	end: number;
	start: number;
}>;

export type VisualEditorSourceRange = Readonly<{
	end: number;
	start: number;
}>;

export type VisualEditorAcceptedPreview = Readonly<{
	revision: number;
	signature: string;
}>;

export type VisualEditorGeneratedPreviewIdentity = Readonly<{
	editMap: PreviewEditMap | null;
	revision: number;
	signature: string;
	sourceRevision: number;
}>;

export type VisualEditorImageScalePercentage =
	| 25
	| 33
	| 50
	| 67
	| 100
	| 150
	| 200;

export type VisualEditorMarkdownImageScaleMatch = Readonly<{
	alt: string;
	destination: string;
	destinationAngle: boolean;
	destinationEnd: number;
	destinationStart: number;
	end: number;
	imageEnd: number;
	raw: string;
	scale: VisualEditorImageScalePercentage | null;
	start: number;
	title: string | null;
	titleEnd: number | null;
	titleMarkerEnd: number | null;
	titleMarkerStart: number | null;
	titleStart: number | null;
}>;

export type VisualEditorGeneratedImageOriginal = Readonly<{
	alt: string;
	destination: string;
	end: number;
	raw: string;
	start: number;
	title: string | null;
}>;

export type VisualEditorGeneratedImageTarget = Readonly<{
	acceptedPreview: VisualEditorAcceptedPreview;
	blockId: string;
	ordinal: number;
	original: VisualEditorGeneratedImageOriginal;
	sourceRevision: number;
}>;

export type VisualEditorImageTargetIndex = Readonly<{
	blockImages: ReadonlyArray<
		Readonly<{
			end: number;
			images: ReadonlyArray<VisualEditorMarkdownImageScaleMatch>;
			start: number;
			status: "ready" | "unavailable";
		}>
	>;
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	complete: true;
	images: ReadonlyArray<VisualEditorMarkdownImageScaleMatch>;
	length: number;
	revision: number;
	sourceBytes: number;
	source: string;
}>;

export type VisualEditorImageTargetRequest = Readonly<{
	element: HTMLImageElement;
	index: VisualEditorImageTargetIndex;
	selection: VisualEditorSourceRange;
}>;

export type VisualEditorImageTargetSelectionRequest = Readonly<{
	index: VisualEditorImageTargetIndex;
	selection: VisualEditorSourceRange;
}>;

export type VisualEditorImageTargetLease = Readonly<{
	isCurrent: () => boolean;
	release: () => void;
	root: HTMLImageElement;
	target: VisualEditorGeneratedImageTarget;
}>;

export type VisualEditorImageTargetPinLease = Readonly<{
	getLease: () => VisualEditorImageTargetLease | null;
	isCurrent: () => boolean;
	release: () => void;
	target: VisualEditorGeneratedImageTarget;
}>;

export type VisualEditorGeneratedContentKind = "math" | "mermaid";

export type VisualEditorGeneratedContentSourceRange = Readonly<{
	from: number;
	to: number;
}>;

export type VisualEditorGeneratedContentOriginal = Readonly<{
	body: string;
	bodyRange: VisualEditorGeneratedContentSourceRange;
	full: string;
	fullRange: VisualEditorGeneratedContentSourceRange;
}>;

export type VisualEditorGeneratedContentTarget = Readonly<{
	acceptedPreview: VisualEditorAcceptedPreview;
	blockId: string;
	kind: VisualEditorGeneratedContentKind;
	ordinal: number;
	original: VisualEditorGeneratedContentOriginal;
	sourceRevision: number;
}>;

export type VisualEditorGeneratedContentTargetIndex = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	length: number;
	mathSpans: ReadonlyArray<EditorMarkdownMathSpan>;
	revision: number;
	source: string;
}>;

export type VisualEditorGeneratedContentTargetRequest = Readonly<{
	element: Element;
	index: VisualEditorGeneratedContentTargetIndex;
	kind: VisualEditorGeneratedContentKind;
	ordinal: number;
}>;

export type VisualEditorGeneratedContentTargetForSelectionRequest = Readonly<{
	index: VisualEditorGeneratedContentTargetIndex;
	selection: VisualEditorSourceRange;
}>;

export type VisualEditorGeneratedContentTargetLease = Readonly<{
	isCurrent: () => boolean;
	release: () => void;
	root: Element;
	target: VisualEditorGeneratedContentTarget;
}>;

export type VisualEditorGeneratedContentTargetPinLease = Readonly<{
	getLease: () => VisualEditorGeneratedContentTargetLease | null;
	isCurrent: () => boolean;
	release: () => void;
	target: VisualEditorGeneratedContentTarget;
}>;

export type VisualEditorContextMenuSurfaceSnapshot = Readonly<{
	revision?: number;
	selection: VisualEditorSelection;
	value: string;
}>;

export type VisualEditorContextMenuTargetLease = Readonly<{
	resolve: () => Element | null;
	release: () => void;
	consumeAcceptedSelectionTransition?: (
		before: VisualEditorContextMenuSurfaceSnapshot,
		after: VisualEditorContextMenuSurfaceSnapshot,
	) => boolean;
}>;

export type VisualToolbarCommandResult =
	| "blocked"
	| "failed"
	| "handled"
	| "unsupported";

export type VisualToolbarCommandOptions = Readonly<{
	requestPreviewTransfer?: boolean;
}>;

export type VisualCanonicalChangeRequest = Readonly<{
	change: Readonly<{
		changes: Readonly<{ from: number; insert: string; to: number }>;
		selection: VisualEditorSelection;
		selectionFallback?: "caret" | "reflow-caret";
		value: string;
	}>;
	expected: Readonly<{
		revision: number;
		selection: VisualEditorSelection;
		value: string;
	}>;
}>;

export type ImmersiveVisualEditorRuntime = Readonly<{
	executeCommand: (
		command: ToolbarCommand,
		options?: VisualToolbarCommandOptions,
	) => VisualToolbarCommandResult;
	applyCanonicalChange: (
		request: VisualCanonicalChangeRequest,
	) => VisualToolbarCommandResult;
	getGeneratedPreviewIdentity: () => VisualEditorGeneratedPreviewIdentity | null;
	isEditable: () => boolean;
	/**
	 * Synchronous owner state: the accepted Preview no longer describes the
	 * canonical source, so its edit map may not be used to prepare a selection.
	 * This covers both an in-flight transfer and the window where the new
	 * canonical source is published but its accepted Preview is not installed
	 * yet. Context-menu readiness reads this directly instead of a React render
	 * value that can lag the owner.
	 */
	isTransferPending: () => boolean;
	prepareImageTarget: (
		request: VisualEditorImageTargetRequest,
	) => VisualEditorImageTargetLease | null;
	prepareImageTargetBySelection: (
		request: VisualEditorImageTargetSelectionRequest,
	) => VisualEditorImageTargetPinLease | null;
	prepareGeneratedContentTarget: (
		request: VisualEditorGeneratedContentTargetRequest,
	) => VisualEditorGeneratedContentTargetLease | null;
	prepareGeneratedContentTargetForSelection: (
		request: VisualEditorGeneratedContentTargetForSelectionRequest,
	) => VisualEditorGeneratedContentTargetPinLease | null;
	/**
	 * The pure preflight a demand runs exactly once, before this owner captures
	 * its target: settle the user-authored native input this owner already
	 * accepted, then report whether the document is still this owner's to
	 * describe. It requests no render, maps no target, and places no selection.
	 * An existing pending Preview alone is not a preflight failure, because the
	 * demand parks on readiness for that render instead; a pending input that
	 * cannot settle is a real failure this owner has already reported exactly
	 * once, so callers must not report it again.
	 */
	prepareContextMenuDemand: () => boolean;
	/**
	 * Capture the logical block - and the exact subtarget - that the user's one
	 * gesture addressed, as a witness in the current canonical source. Capture
	 * is pure: no selection placement, no document write, no render request. It
	 * runs once per initial gesture, after `prepareContextMenuDemand`.
	 *
	 * `resolve` returns the element that block became in the accepted render for
	 * the same source, so a formal re-authentication that renumbers roots or
	 * replaces nodes still yields the block the user pointed at. It returns null
	 * for a released, replaced, foreign, ambiguous, or stale target, which
	 * callers must treat as the target being lost - never as permission to fall
	 * back to the pre-render element or to an old coordinate.
	 */
	captureContextMenuTarget: (
		target: Element | null,
	) => VisualEditorContextMenuTargetLease | null;
	prepareMediaSelection: () => boolean;
	prepareContextMenuSelection?: (
		target?: Element | null,
		point?: Readonly<{ x: number; y: number }>,
		activation?: "keyboard" | "pointer",
	) => boolean;
	/**
	 * True when the accepted Preview cannot be shown to describe the current
	 * canonical source - this owner committed a local edit it could not prove
	 * line-preserving, or a previous document's render still stands beside a new
	 * source. A demand calls `refreshAcceptedPreview` instead of refusing: the
	 * refresh requests the formal Preview for the current canonical source, the
	 * demand stays parked on readiness, and the same gesture completes once that
	 * render is accepted. A foreign DOM change, an unknown canonical revision,
	 * or a lost transfer is not refreshable and still fails explicitly.
	 */
	needsAcceptedPreviewRefresh?: () => boolean;
	/**
	 * Request the formal Preview for the current canonical source, supplying the
	 * canonical revision, native history, and selection the acceptance must
	 * match, and keep the owner in a pending transfer until that render is
	 * accepted. Returns false when the source is not a trusted staleness, which
	 * callers must report as an explicit failure rather than retrying.
	 */
	refreshAcceptedPreview?: () => boolean;
	prepareSourceNavigation: (
		expected: Readonly<{ revision: number; value: string }>,
	) => boolean;
	prepareToolbarFallback: () => boolean;
	surface: HTMLElement;
}>;

export type ImmersiveWindowAcceptedSnapshot = Readonly<{
	blocks: ReadonlyArray<
		Readonly<{
			id: string;
			innerHTML: string;
			node: HTMLElement;
		}>
	>;
	/** Formal ledger and canonical revision published with these exact nodes. */
	editMap?: PreviewEditMap;
	sourceRevision?: number;
	key: number;
	nodes: ReadonlyArray<Node>;
	/** Owner-certified physical gap; never a formal edit-map row. */
	ownedGap?: HTMLElement;
	revision: number;
	signature: string;
}>;
