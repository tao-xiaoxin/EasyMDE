import type {
	EditorContextMenuActionContext,
	EditorContextMenuFeatureProps,
	EditorContextMenuSurface,
	EditorContextMenuSurfaceSnapshot,
	EditorContextMenuTargetLease
} from "./EditorContextMenuFeature";
import {
	captureEditorContext,
	findMarkdownBlock,
	markdownHeadingLevel,
	type EditorContextSnapshot,
	type EditorSelection,
	type MarkdownBlock
} from "./editor-context-menu-rules";
import { editorContextSelectionFitsRange } from "./editor-context-menu-text-edit";
import {
	tableSelectionAt,
	type TableSelection
} from "./editor-markdown-table";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import type { EditorContextMenuHeadingContext } from "./editor-context-menu-model";
import type { MarkdownImageScaleMatch } from "../image-scale/image-scale-contract";
import type { EditorContextMenuContextReadiness } from "./EditorContextMenuFeature";

export type EditorContextMenuPendingReleaseReason = "cancelled" | "unavailable";

export type CapturedContextSelection = Readonly<{
	anchorNode: Node;
	anchorOffset: number;
	focusNode: Node;
	focusOffset: number;
	range: Range;
}>;

export type OpenState = Readonly<{
	actionContext: EditorContextMenuActionContext | null;
	activation: "keyboard" | "pointer";
	block: MarkdownBlock | null;
	boundaryElement: HTMLElement;
	captured: EditorContextSnapshot;
	contextSelection: CapturedContextSelection | null;
	generation: number;
	getBlockIndex?: EditorContextMenuSurface["getBlockIndex"];
	heading: EditorContextMenuHeadingContext | null;
	image: MarkdownImageScaleMatch | null;
	imageUploadDisabled: boolean;
	readiness: EditorContextMenuContextReadiness;
	releasePending: (reason?: EditorContextMenuPendingReleaseReason) => void;
	restoreFocus: () => void;
	selectionOutsideTarget: boolean;
	surfaceElement: HTMLElement;
	tableSelection: TableSelection | undefined;
	targetElement: Element | null;
	targetLease: EditorContextMenuTargetLease | null;
}>;

export type PendingAction = Readonly<{
	context: EditorContextMenuActionContext | undefined;
	promise: Promise<void>;
}>;

export type PendingOpenDemand = Readonly<{
	position: Readonly<{ x: number; y: number }>;
	state: OpenState;
	surface: EditorContextMenuSurface;
	target: Element | null;
}>;

/**
 * The owner could not authenticate the demanded block against its current
 * accepted source, ledger, or runtime instance. This is not an error the user
 * can act on - the block the gesture described is gone - so it retires the
 * demand silently instead of reporting a failure or opening a menu for a
 * different block.
 */
export class ContextMenuTargetLeaseLost extends Error {
	constructor() {
		super("editor-context-menu-target-lease-lost");
	}
}

export function isTargetLeaseLost(error: unknown): boolean {
	return error instanceof ContextMenuTargetLeaseLost;
}

/**
 * A replay or rebuild that finds the surface no longer editable is a teardown,
 * not a new user gesture: the demand retires without a user-facing failure.
 */
export function isSurfaceNoLongerEditable(error: unknown): boolean {
	return error instanceof Error
		&& (
			"editor-context-menu-visual-surface-read-only" === error.message
			|| "editor-context-menu-source-read-only" === error.message
		);
}

const CONTEXT_MENU_ERROR_CODES: Readonly<Record<string, true>> = {
	"editor-context-menu-position-invalid": true,
	"editor-context-menu-selection-invalid": true,
	"editor-context-menu-selection-map-failed": true,
	"editor-context-menu-source-read-only": true,
	"editor-context-menu-surface-disconnected": true,
	"editor-context-menu-target-unavailable": true,
	"editor-context-menu-visual-surface-read-only": true
};

export function codeFromError(error: unknown, fallback: string): string {
	if (!(error instanceof Error)) return fallback;
	if (CONTEXT_MENU_ERROR_CODES[error.message]) return error.message;
	// Preserve privacy-safe operation codes from the editor owners so a
	// readiness/open failure remains diagnosable without exposing exception
	// messages or document content. Unknown errors still use the stable
	// feature-level fallback.
	return /^editor-(?:block-index|code-content|source-link|context-menu)-[a-z0-9-]+$/u.test(
		error.message
	)
		? error.message
		: fallback;
}

export function releaseActionContext(
	actionContext: EditorContextMenuActionContext | null | undefined
): void {
	actionContext?.generated?.lease.release?.();
	actionContext?.image?.lease?.release?.();
}

export function actionContextForMenu(
	actionContext: EditorContextMenuActionContext | null
): EditorContextMenuActionContext | null {
	return actionContext ? { ...actionContext } : null;
}

export function sharesOwnedLease(
	left: EditorContextMenuActionContext | null | undefined,
	right: EditorContextMenuActionContext | null | undefined
): boolean {
	return Boolean(
		left
		&& right
		&& (
			Boolean(left.generated?.lease)
				&& left.generated?.lease === right.generated?.lease
			|| Boolean(left.image?.lease)
				&& left.image?.lease === right.image?.lease
		)
	);
}

export function releasePendingUnlessActionOwns(
	state: OpenState | null | undefined,
	pending: PendingAction | null
): void {
	if (!sharesOwnedLease(pending?.context, state?.actionContext)) {
		state?.releasePending(
			"pending" === state.readiness.status ? "cancelled" : undefined
		);
	}
}

/**
 * Retire a gesture's target witness once its demand is really over. A rebuild
 * of the same demand carries the same lease object, so releasing the state it
 * replaces must not invalidate the retained one; only a demand that ends (or
 * receives a different lease) releases it. Owners make `release` idempotent, so
 * repeated cleanups of one retired demand stay harmless.
 */
export function releaseTargetLeaseUnlessShared(
	lease: EditorContextMenuTargetLease | null | undefined,
	retained: EditorContextMenuTargetLease | null | undefined
): void {
	if (lease && lease !== retained) lease.release();
}

export function releaseActionUnlessSharedWithPending(
	actionContext: EditorContextMenuActionContext | null | undefined,
	pending: PendingAction | null
): void {
	if (!sharesOwnedLease(actionContext, pending?.context))
		releaseActionContext(actionContext);
}

export function releaseActionUnlessSharedWithContexts(
	actionContext: EditorContextMenuActionContext | null | undefined,
	retainedContexts: ReadonlyArray<
		EditorContextMenuActionContext | null | undefined
	>,
	pending: PendingAction | null
): void {
	const retained = [pending?.context, ...retainedContexts];
	if (!retained.some((context) => sharesOwnedLease(actionContext, context))) {
		releaseActionContext(actionContext);
	}
}

/**
 * A pending demand is still anchored to the pointer gesture that created it,
 * not to the revision that happened to be current while the surface owner was
 * still materializing its context inventory. Readiness advancement (a worker
 * block-index build, an accepted Preview, a rebuilt visual surface) legally
 * advances the revision and the surface generation without any user edit, so
 * those fields are rebound to the latest snapshot instead of being treated as
 * a stale capture. The document value, the selection, and the surface identity
 * remain the demand's truth: when the user (or another owner) changed the text
 * or moved the selection, the demand no longer describes what the user pointed
 * at and must not open a menu for it.
 */
export function surfaceSnapshotStillDescribesPendingDemand(
	state: OpenState,
	surface: EditorContextMenuSurface,
	snapshot: EditorContextMenuSurfaceSnapshot
): boolean {
	const captured = state.captured;
	return captured.surfaceIdentity === (surface.identity ?? surface.element)
		&& captured.surface === surface.kind
		&& captured.value === snapshot.value
		&& captured.selection.start === snapshot.selection.start
		&& captured.selection.end === snapshot.selection.end
		&& captured.selection.direction === snapshot.selection.direction;
}

function blockForContext(
	value: string,
	selection: EditorSelection,
	blockIndex: EditorMarkdownBlockIndex | null | undefined
): Readonly<{
	block: MarkdownBlock | null;
	selectionOutsideTarget: boolean;
}> {
	const block = null === blockIndex
		? null
		: findMarkdownBlock(value, selection.start, blockIndex);
	const selectionOutsideTarget = Boolean(
		block
		&& selection.start !== selection.end
		&& !editorContextSelectionFitsRange(selection, {
			from: block.start,
			to: block.end
		})
	);
	return {
		block: selectionOutsideTarget ? null : block,
		selectionOutsideTarget
	};
}

function headingForContext(
	value: string,
	block: MarkdownBlock | null,
	source: EditorContextMenuFeatureProps["heading"]
): EditorContextMenuHeadingContext | null {
	if ("heading" !== block?.kind || !source) return null;
	const levels = source.commands
		.filter((command) =>
			"heading-menu" === command.surface && "heading" === command.action
		)
		.map((command) => {
			const level = command.level;
			if (
				"number" !== typeof level
				|| !Number.isInteger(level)
				|| level < 1
				|| level > 6
			) {
				throw new Error("editor-context-menu-heading-command-invalid");
			}
			return { id: command.id, label: command.label, level };
		});
	if (0 === levels.length) return null;
	return {
		currentLevel: markdownHeadingLevel(value, block),
		label: source.label,
		levels
	};
}

function captureSurfaceContextSelection(
	surface: HTMLElement
): CapturedContextSelection | null {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (
		!selection?.rangeCount
		|| !selection.anchorNode
		|| !selection.focusNode
		|| !surface.contains(selection.anchorNode)
		|| !surface.contains(selection.focusNode)
	) return null;
	try {
		return {
			anchorNode: selection.anchorNode,
			anchorOffset: selection.anchorOffset,
			focusNode: selection.focusNode,
			focusOffset: selection.focusOffset,
			range: selection.getRangeAt(0).cloneRange()
		};
	} catch {
		return null;
	}
}

export function restoreCapturedContextSelection(
	surface: HTMLElement,
	captured: CapturedContextSelection | null
): boolean {
	if (
		!captured?.range.startContainer.isConnected
		|| !captured.range.endContainer.isConnected
		|| !captured.anchorNode.isConnected
		|| !captured.focusNode.isConnected
		|| !surface.contains(captured.range.startContainer)
		|| !surface.contains(captured.range.endContainer)
		|| !surface.contains(captured.anchorNode)
		|| !surface.contains(captured.focusNode)
	) return false;
	try {
		const selection = surface.ownerDocument.defaultView?.getSelection();
		if (!selection) return false;
		selection.removeAllRanges();
		selection.setBaseAndExtent(
			captured.anchorNode,
			captured.anchorOffset,
			captured.focusNode,
			captured.focusOffset
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Derives the demand state of one gesture. This module owns the derivation
 * only; the single demand/resource owner is the hook that stores and retires
 * these values.
 */
export function contextSurface(
	surface: EditorContextMenuSurface,
	direction: "ltr" | "rtl",
	position: Readonly<{ x: number; y: number }>,
	anchorTarget: Element | null,
	targetLease: EditorContextMenuTargetLease | null,
	heading: EditorContextMenuFeatureProps["heading"],
	activation: "keyboard" | "pointer"
): OpenState {
	if (!surface.element.isConnected) {
		throw new Error("editor-context-menu-surface-disconnected");
	}
	// A demand outlives the DOM node it was anchored to: an accepted Preview
	// commit retires the element while the demand still waits for readiness. The
	// captured original element is therefore only a nonauthoritative anchor for
	// the *structural* pass below - the block index and readiness rules read the
	// document value, not the target. A mutation, preparation, or action context
	// needs the owner to authenticate its own current accepted DOM, which can
	// only happen once readiness permits that read, so a null resolution throws a
	// silent retirement instead of borrowing the old element, a same-ordinal
	// block id, or a coordinate hit-test.
	const resolveLeasedTarget = (): Element | null => {
		if (!targetLease) return anchorTarget;
		const resolved = targetLease.resolve();
		if (!resolved) throw new ContextMenuTargetLeaseLost();
		return resolved;
	};
	let snapshot = surface.getSnapshot();
	// The structural index is derived from the Markdown value alone and is the
	// very input readiness waits for, so it must be requested even while the
	// surface is still pending; otherwise a surface whose readiness needs the
	// index would never receive one and the demand would wait forever. The
	// owner's selection mapping (`prepare`) and action context remain gated
	// behind readiness, because a visual Preview transfer deliberately
	// invalidates the old edit map.
	let blockIndex = surface.getBlockIndex?.(snapshot);
	const initialReadiness = surface.getContextReadiness?.(
		anchorTarget,
		snapshot,
		blockIndex,
		// The demand's own action context cannot exist yet: preparation builds it,
		// and this answer decides whether preparation may run at all. A pending
		// answer therefore has to come from a structural rule that the demand's
		// own context cannot satisfy; the evaluated pass below states the context
		// and owns every context-dependent rule.
		undefined
	);
	if (initialReadiness && "ready" !== initialReadiness.status) {
		// A visual Preview transfer temporarily makes its surface non-editable.
		// Check readiness before asking the owner to prepare a selection: while a
		// transfer is pending, the old edit map is deliberately not a valid input
		// and must not be read. The demand is kept alive by the readiness
		// subscription and is rebuilt after the matching Preview is accepted.
		const captured = captureEditorContext({
			direction,
			position,
			...(undefined === snapshot.revision ? {} : { revision: snapshot.revision }),
			selection: snapshot.selection,
			surfaceIdentity: surface.identity ?? surface.element,
			...(undefined === surface.generation
				? {}
				: { surfaceGeneration: surface.generation }),
			surface: surface.kind,
			value: snapshot.value
		});
		return {
			actionContext: null,
			activation,
			block: null,
			boundaryElement: surface.boundaryElement,
			captured,
			contextSelection: null,
			generation: 0,
			...(surface.getBlockIndex ? { getBlockIndex: surface.getBlockIndex } : {}),
			heading: null,
			image: null,
			imageUploadDisabled: false,
			readiness: initialReadiness,
			releasePending: surface.releasePending ?? (() => undefined),
			restoreFocus: surface.restoreFocus ?? (() => undefined),
			selectionOutsideTarget: false,
			surfaceElement: surface.element,
			tableSelection: undefined,
			targetElement: anchorTarget,
			targetLease
		};
	}
	if (!surface.isEditable()) {
		throw new Error(
			"visual" === surface.kind
				? "editor-context-menu-visual-surface-read-only"
				: "editor-context-menu-source-read-only"
		);
	}
	// Readiness now permits reading the owner's accepted DOM. This is the only
	// place a demand may turn its captured lease into an element: a mutation,
	// selection mapping, or action context that used the retired element would
	// describe a block the current accepted render no longer contains.
	const target = resolveLeasedTarget();
	if (
		surface.prepare
		&& !surface.prepare(target, blockIndex, position, activation)
	) {
		throw new Error("editor-context-menu-selection-map-failed");
	}
	snapshot = surface.getSnapshot();
	blockIndex = surface.getBlockIndex?.(snapshot);
	const contextSelection = captureSurfaceContextSelection(surface.element);
	const captured = captureEditorContext({
		direction,
		position,
		...(undefined === snapshot.revision ? {} : { revision: snapshot.revision }),
		selection: snapshot.selection,
		surfaceIdentity: surface.identity ?? surface.element,
		...(undefined === surface.generation
			? {}
			: { surfaceGeneration: surface.generation }),
		surface: surface.kind,
		value: snapshot.value
	});
	// A surface may explicitly certify a demand without the asynchronous
	// inventory: the visual owner answers `ready` for a structural gap beside an
	// accepted thematic break that its own ledger proves. That claim is the
	// surface's, so the parser-owned block is resolved synchronously here
	// instead of waiting for an inventory build this demand does not need. Every
	// other inventory-less demand keeps no block and stays gated on its index.
	const certifiedWithoutInventory =
		null === blockIndex
		&& undefined !== surface.getContextReadiness
		&& "ready" === initialReadiness?.status;
	const blockContext = blockForContext(
		snapshot.value,
		snapshot.selection,
		certifiedWithoutInventory ? undefined : blockIndex
	);
	const headingContext = headingForContext(
		snapshot.value,
		blockContext.block,
		heading
	);
	const actionContext = actionContextForMenu(
		surface.getActionContext?.(target, snapshot, blockIndex) ?? null
	);
	const image = actionContext?.image?.match ?? null;
	const readiness = surface.getContextReadiness?.(
		target,
		snapshot,
		blockIndex,
		actionContext
	) ?? { status: "ready" as const };
	return {
		actionContext,
		activation,
		block: blockContext.block,
		boundaryElement: surface.boundaryElement,
		captured,
		contextSelection,
		generation: 0,
		...(surface.getBlockIndex ? { getBlockIndex: surface.getBlockIndex } : {}),
		heading: headingContext,
		image,
		imageUploadDisabled: Boolean(image && !surface.canUploadImage?.(image)),
		readiness,
		releasePending: surface.releasePending ?? (() => undefined),
		restoreFocus: surface.restoreFocus ?? (() => undefined),
		selectionOutsideTarget: blockContext.selectionOutsideTarget,
		surfaceElement: surface.element,
		tableSelection: null === blockIndex
			? undefined
			: tableSelectionAt(snapshot.value, snapshot.selection, blockIndex),
		targetElement: target,
		targetLease
	};
}
