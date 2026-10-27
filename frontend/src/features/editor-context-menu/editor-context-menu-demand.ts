import {
	useCallback,
	useRef,
	useState
} from "@wordpress/element";

import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type {
	EditorContextMenuFeatureProps,
	EditorContextMenuSurface,
	EditorContextMenuTargetLease
} from "./EditorContextMenuFeature";
import {
	contextSurface,
	codeFromError,
	isSurfaceNoLongerEditable,
	isTargetLeaseLost,
	type OpenState,
	type PendingAction,
	type PendingOpenDemand,
	releaseActionContext,
	releaseActionUnlessSharedWithContexts,
	releaseActionUnlessSharedWithPending,
	releasePendingUnlessActionOwns,
	releaseTargetLeaseUnlessShared,
	restoreCapturedContextSelection,
	sharesOwnedLease,
	surfaceSnapshotStillDescribesPendingDemand
} from "./editor-context-menu-context";

export type EditorContextMenuDemandController = Readonly<{
	cancelPending: () => void;
	consumeAcceptedSelection: (surface: EditorContextMenuSurface) => void;
	dismiss: () => void;
	dispose: () => void;
	invokeAction: (id: string) => void;
	isRetainedPending: (surface: EditorContextMenuSurface) => boolean;
	open: OpenState | null;
	openSurface: (
		surface: EditorContextMenuSurface,
		position: Readonly<{ x: number; y: number }>,
		target: Element | null,
		activation: "keyboard" | "pointer"
	) => void;
	readOpen: () => OpenState | null;
	readPending: () => PendingOpenDemand | null;
	replay: (surface: EditorContextMenuSurface) => void;
	restoreMenuSelection: () => void;
	validateOwners: (
		source: EditorContextMenuSurface | null,
		visual: EditorContextMenuSurface | null
	) => void;
}>;

/**
 * The one owner of the context-menu demand resources: the visible state, the
 * single pending demand, its generation, the Clipboard check controller, and
 * the action promise. Context derivation, event binding, and notifications
 * call into this owner; none of them stores a second copy of that state.
 */
export function useEditorContextMenuDemand(input: Readonly<{
	clipboard: EditorClipboardPort;
	direction: "ltr" | "rtl";
	heading?: EditorContextMenuFeatureProps["heading"];
	onAction: EditorContextMenuFeatureProps["onAction"];
	onFailure: (code: string) => void;
}>): EditorContextMenuDemandController {
	const [open, setOpen] = useState<OpenState | null>(null);
	const openRef = useRef<OpenState | null>(null);
	const pendingOpenRef = useRef<PendingOpenDemand | null>(null);
	const clipboardAbortRef = useRef<AbortController | null>(null);
	const demandGenerationRef = useRef(0);
	const onFailureRef = useRef(input.onFailure);
	const onActionRef = useRef(input.onAction);
	const actionPromiseRef = useRef<PendingAction | null>(null);
	const directionRef = useRef(input.direction);
	const headingRef = useRef(input.heading);
	onFailureRef.current = input.onFailure;
	onActionRef.current = input.onAction;
	directionRef.current = input.direction;
	headingRef.current = input.heading;
	openRef.current = open;

	const cancelPendingOpen = useCallback((abortClipboard = true): void => {
		if (abortClipboard) clipboardAbortRef.current?.abort();
		const pending = pendingOpenRef.current;
		pendingOpenRef.current = null;
		if (!pending) return;
		releaseActionUnlessSharedWithPending(
			pending.state.actionContext,
			actionPromiseRef.current
		);
		releasePendingUnlessActionOwns(pending.state, actionPromiseRef.current);
		releaseTargetLeaseUnlessShared(
			pending.state.targetLease,
			openRef.current?.targetLease
		);
	}, []);

	/**
	 * Retire the live demand synchronously, then schedule the React update that
	 * removes it from the tree. `openRef.current` is only rewritten on the next
	 * render, so clearing it here is what keeps a notification arriving in the
	 * same batch (an A -> B -> A selection change) from reading a retired state
	 * and re-matching its captured snapshot, which would resurrect a menu the
	 * user's change already retired. The render that follows assigns the actual
	 * state - `null`, or the state of a demand opened in the same batch - back
	 * to the ref.
	 */
	const retireOpenState = useCallback((): void => {
		openRef.current = null;
		setOpen(null);
	}, []);

	/**
	 * End a visible demand and everything it owns. The target lease is retired
	 * here and nowhere else for an open menu, so a later notification from the
	 * owner cannot resolve it again, revive the menu, or reuse its block.
	 */
	const retireVisibleDemand = useCallback((current: OpenState | null): void => {
		if (!current) return;
		clipboardAbortRef.current?.abort();
		clipboardAbortRef.current = null;
		releaseActionUnlessSharedWithPending(
			current.actionContext,
			actionPromiseRef.current
		);
		releasePendingUnlessActionOwns(current, actionPromiseRef.current);
		releaseTargetLeaseUnlessShared(current.targetLease, null);
		retireOpenState();
		current.restoreFocus();
	}, [retireOpenState]);

	/**
	 * Rebuild the context of a *visible* menu for the demand it was opened
	 * with. A legal background transition - an accepted Preview, a rebuilt
	 * block index, a replaced surface object - advances the revision, the
	 * surface generation, or the inventory the menu was derived from while the
	 * user changed neither the document nor the selection. The menu then keeps
	 * its captured target and anchor, replaces its context with the rebuilt
	 * one, and stays on screen while that inventory is still pending, instead
	 * of dismissing itself over a benign refresh. A demand that no longer
	 * describes the document state is still dismissed, and a genuine readiness
	 * failure still reports its code.
	 */
	const refreshOpenMenu = useCallback((
		surface: EditorContextMenuSurface,
		current: OpenState
	): void => {
		const retire = (reportFailure: string | null): void => {
			retireVisibleDemand(current);
			if (reportFailure) onFailureRef.current(reportFailure);
		};
		if (
			!surfaceSnapshotStillDescribesPendingDemand(
				current,
				surface,
				surface.getSnapshot()
			)
		) {
			retire(null);
			return;
		}
		let refreshed: OpenState;
		try {
			refreshed = {
				...contextSurface(
					surface,
					directionRef.current,
					current.captured.position,
					// The same gesture keeps the element it captured and the witness its
					// owner issued for it. Re-capturing on a notification would describe
					// a different moment than the one the user acted on.
					current.targetElement,
					current.targetLease,
					headingRef.current,
					current.activation
				),
				generation: current.generation
			};
		} catch (error) {
			// A visible menu whose block no longer exists in the owner's accepted
			// source is retired silently: the user cannot act on a target the owner
			// cannot authenticate, and reopening it for a different block is worse
			// than closing it. A surface that is no longer editable means the user
			// left the mode (or the owner failed closed), which is teardown rather
			// than a failure they caused, so it retires silently too. Everything else
			// keeps its explicit failure.
			retire(
				isTargetLeaseLost(error) || isSurfaceNoLongerEditable(error)
					? null
					: codeFromError(error, "editor-context-menu-open-failed")
			);
			return;
		}
		// Rebinding a valid owner is not a cancellation. The surface's
		// releasePending callback is an EditorRoot-wide cleanup owner, so
		// invoking it here can release the freshly prepared lease held by
		// `refreshed` as well. Only retire the old action lease; keep the pending
		// resources until the refreshed state is explicitly dismissed or fails
		// readiness.
		releaseActionUnlessSharedWithContexts(
			current.actionContext,
			[refreshed.actionContext],
			actionPromiseRef.current
		);
		if ("unavailable" === refreshed.readiness.status) {
			retireOpenState();
			releaseActionUnlessSharedWithPending(
				refreshed.actionContext,
				actionPromiseRef.current
			);
			if (
				!sharesOwnedLease(
					refreshed.actionContext,
					actionPromiseRef.current?.context
				)
			) {
				refreshed.releasePending("unavailable");
			}
			releaseTargetLeaseUnlessShared(refreshed.targetLease, null);
			onFailureRef.current(refreshed.readiness.code);
			return;
		}
		// A `pending` rebuild keeps the menu visible with the same target and
		// anchor; the `ready` rebuild replaces its context with the new
		// inventory.
		setOpen(refreshed);
	}, [retireOpenState, retireVisibleDemand]);

	/**
	 * Consume an owner-published accepted selection transition for the ONE
	 * initial pending demand of this gesture.
	 *
	 * The visual owner normalizes its own presentation caret while it accepts a
	 * trusted render: the canonical value and revision do not change, only the
	 * selection. Without this receipt the ordinary matcher would read that
	 * publication as the user moving the selection and cancel the gesture the
	 * user is still making.
	 *
	 * Scope is deliberately narrow. It is eligible only for the initial pending
	 * demand (no visible menu, no action in flight) whose lease exposes the
	 * optional receipt; the receipt itself owns owner, staged-proof, history and
	 * permission validation. A miss is not a cancellation: it returns false and
	 * the existing matcher and refresh path decide, which is what keeps the
	 * existing own-prepare reentrancy behaviour intact. Nothing here resolves a
	 * target, runs readiness, prepares a selection, or executes an action.
	 */
	const consumePendingAcceptedSelection = useCallback(
		(surface: EditorContextMenuSurface): void => {
			const pending = pendingOpenRef.current;
			if (!pending || openRef.current) return;
			if (pending.surface.element !== surface.element) return;
			if (pending.surface.boundaryElement !== surface.boundaryElement) return;
			if (pending.surface.kind !== surface.kind) return;
			if ((pending.surface.identity ?? pending.surface.element)
				!== (surface.identity ?? surface.element)) return;
			if (
				undefined !== pending.surface.generation
				&& pending.surface.generation !== surface.generation
			) return;
			const lease = pending.state.targetLease;
			if (!lease?.consumeAcceptedSelectionTransition) return;
			if (actionPromiseRef.current) return;
			const captured = pending.state.captured;
			// The receipt is compared against the demand's own canonical capture, so
			// a missing revision is not a match: the owner must be able to state the
			// known revision it published against.
			if (undefined === captured.revision) return;
			const before = {
				revision: captured.revision,
				selection: captured.selection,
				value: captured.value
			};
			const afterSnapshot = surface.getSnapshot();
			const consumed = lease.consumeAcceptedSelectionTransition(
				before,
				afterSnapshot
			);
			if (!consumed) return;
			// The synchronous publication could have dismissed or replaced this
			// demand through another listener. Never reinsert a canceled demand or
			// write into a new one.
			if (pendingOpenRef.current !== pending) return;
			if (openRef.current) return;
			if (actionPromiseRef.current) return;
			// The receipt authenticated THIS pair. The surface must still report it,
			// field for field: a second, different snapshot is not evidence for the
			// transition the owner just consumed, so nothing is copied from it.
			const current = surface.getSnapshot();
			if (
				undefined === current.revision
				|| current.revision !== afterSnapshot.revision
				|| current.value !== afterSnapshot.value
				|| current.selection.start !== afterSnapshot.selection.start
				|| current.selection.end !== afterSnapshot.selection.end
				|| current.selection.direction !== afterSnapshot.selection.direction
			) return;
			pendingOpenRef.current = {
				...pending,
				state: {
					...pending.state,
					captured: {
						...pending.state.captured,
						selection: {
							direction: afterSnapshot.selection.direction,
							end: afterSnapshot.selection.end,
							start: afterSnapshot.selection.start
						}
					}
				}
			};
		},
		[]
	);

	/**
	 * Replay readiness for the demand anchored to this surface. A pending demand
	 * is rebuilt without re-capturing its target or re-running the owner's input
	 * preparation; a visible demand keeps its anchor and context while its
	 * inventory is rebuilt. Readiness advancement is not a new user gesture.
	 */
	const replay = useCallback((surface: EditorContextMenuSurface): void => {
		const current = openRef.current;
		const pending = pendingOpenRef.current;
		if (!current && pending && pending.surface.element === surface.element) {
			const snapshot = surface.getSnapshot();
			if (
				!surfaceSnapshotStillDescribesPendingDemand(
					pending.state,
					surface,
					snapshot
				)
			) {
				cancelPendingOpen();
				return;
			}
			let next: OpenState;
			try {
				next = {
					...contextSurface(
						surface,
						directionRef.current,
						pending.position,
						pending.target,
						pending.state.targetLease,
						headingRef.current,
						pending.state.activation
					),
					generation: pending.state.generation
				};
			} catch (error) {
				// The owner cannot authenticate this gesture's block any more, so the
				// demand ends without a failure the user could act on. The readiness
				// state that woke this pass is not a new gesture: it must never
				// re-capture, re-flush input, or revive the old target. A replay
				// against a surface that has since become non-editable (the user left
				// the mode, or the owner failed closed) is exactly that teardown case,
				// so it retires silently rather than reporting a read-only failure the
				// user never caused.
				cancelPendingOpen();
				if (!isTargetLeaseLost(error) && !isSurfaceNoLongerEditable(error)) {
					onFailureRef.current(
						codeFromError(error, "editor-context-menu-open-failed")
					);
				}
				return;
			}
			if ("pending" === next.readiness.status) {
				pendingOpenRef.current = { ...pending, state: next };
				releaseActionUnlessSharedWithContexts(
					pending.state.actionContext,
					[next.actionContext],
					actionPromiseRef.current
				);
				return;
			}
			pendingOpenRef.current = null;
			releaseActionUnlessSharedWithContexts(
				pending.state.actionContext,
				[next.actionContext],
				actionPromiseRef.current
			);
			if ("unavailable" === next.readiness.status) {
				clipboardAbortRef.current?.abort();
				clipboardAbortRef.current = null;
				releaseActionUnlessSharedWithPending(
					next.actionContext,
					actionPromiseRef.current
				);
				if (
					!sharesOwnedLease(
						next.actionContext,
						actionPromiseRef.current?.context
					)
				) {
					next.releasePending("unavailable");
				}
				releaseTargetLeaseUnlessShared(next.targetLease, null);
				onFailureRef.current(next.readiness.code);
				return;
			}
			setOpen(next);
			return;
		}
		if (
			!current
			|| current.surfaceElement !== surface.element
			|| current.getBlockIndex !== surface.getBlockIndex
		) return;
		// Every rebuild of a visible demand goes through the same
		// readiness-then-lease flow as a pending or owner-drift rebuild. A
		// visible menu has no second, cheaper path: the stored target element
		// was authenticated for the render the user opened the menu on, so a
		// readiness notification - an accepted Preview that replaces the block
		// DOM without touching the canonical document, a new pending phase, a
		// rebuilt inventory - has to re-ask the owner whether this demand's
		// block still exists and let the owner's lease name the live element.
		// Reading the retired element here would rebuild image, link, and
		// generated context against a node the owner no longer stands behind.
		// The lease is not re-captured and the preflight is not re-run: this is
		// the same gesture, with the readiness the owner just published.
		refreshOpenMenu(surface, current);
	}, [cancelPendingOpen, refreshOpenMenu]);

	const openSurface = useCallback((
		surface: EditorContextMenuSurface,
		position: Readonly<{ x: number; y: number }>,
		target: Element | null,
		activation: "keyboard" | "pointer"
	): void => {
		clipboardAbortRef.current?.abort();
		const clipboardController = new AbortController();
		clipboardAbortRef.current = clipboardController;
		const generation = ++demandGenerationRef.current;
		void input.clipboard.check({ signal: clipboardController.signal }).catch((error) => {
			if (clipboardController.signal.aborted) return;
			const pending = pendingOpenRef.current;
			if (
				openRef.current?.generation !== generation
				&& pending?.state.generation !== generation
			) return;
			onFailureRef.current(
				codeFromError(error, "editor-context-menu-clipboard-check-failed")
			);
		});
		cancelPendingOpen(false);
		const previous = openRef.current;
		releaseActionUnlessSharedWithPending(
			previous?.actionContext,
			actionPromiseRef.current
		);
		releasePendingUnlessActionOwns(previous, actionPromiseRef.current);
		releaseTargetLeaseUnlessShared(previous?.targetLease, null);
		retireOpenState();
		let next: OpenState;
		let lease: EditorContextMenuTargetLease | null = null;
		try {
			// The owner settles the input it already accepted from the user before
			// this demand reads a document. Without it, a gesture that arrives
			// inside the owner's input debounce would capture the pre-input source
			// and describe a block the user has already moved past. This runs once
			// per activation - never on a readiness replay - and its refusal ends
			// the gesture before any target is captured. The owner has already
			// reported its own failure through its failure port, so adding a
			// generic menu failure here would report the same refusal twice.
			const prepared = !surface.prepareDemand || surface.prepareDemand();
			if (!prepared) {
				clipboardController.abort();
				clipboardAbortRef.current = null;
				return;
			}
			// A pointer activation must describe the element the pointer is on,
			// not whatever selection an earlier gesture left behind. This runs
			// before the demand snapshot is read so a demand that still has to
			// wait for structural readiness is captured from the pointed
			// selection, and it runs before the owner's gated `prepare` because
			// that callback only executes once readiness is already available.
			if (
				"pointer" === activation
				&& surface.preparePointerSelection
				&& !surface.preparePointerSelection(position)
			) {
				// The pointer selection could not be established, and that failure
				// is explicit: a read-only owner keeps its own surface failure code,
				// while an unmappable, detached, or otherwise unusable pointer
				// reports the selection-mapping failure.
				throw new Error(
					surface.isEditable()
						? "editor-context-menu-selection-map-failed"
						: ("visual" === surface.kind
							? "editor-context-menu-visual-surface-read-only"
							: "editor-context-menu-source-read-only")
				);
			}
			// Capture the target once, while the element the user pointed at is
			// still live. Capture is pure: it reads the owner's provenance without
			// writing the document, moving the selection, or requesting a render.
			if (surface.captureTarget) {
				lease = surface.captureTarget(target);
				if (!lease) throw new Error("editor-context-menu-target-unavailable");
			}
			next = {
				...contextSurface(
					surface,
					directionRef.current,
					position,
					target,
					lease,
					headingRef.current,
					activation
				),
				generation
			};
		} catch (error) {
			// Releasing here covers a capture that succeeded before a later
			// snapshot or readiness failure; the lease never outlives the
			// activation that failed to produce a demand.
			if (lease) releaseTargetLeaseUnlessShared(lease, null);
			clipboardAbortRef.current?.abort();
			// The owner authenticated the gesture and then could not resolve it
			// against its own accepted DOM. That block is gone, so the activation
			// ends silently instead of naming a failure the user cannot act on.
			if (!isTargetLeaseLost(error)) {
				onFailureRef.current(
					codeFromError(error, "editor-context-menu-open-failed")
				);
			}
			return;
		}
		if ("unavailable" === next.readiness.status) {
			clipboardController.abort();
			clipboardAbortRef.current = null;
			releaseActionContext(next.actionContext);
			next.releasePending("unavailable");
			releaseTargetLeaseUnlessShared(next.targetLease, null);
			onFailureRef.current(next.readiness.code);
			return;
		}
		if ("pending" === next.readiness.status) {
			pendingOpenRef.current = { position, state: next, surface, target };
			return;
		}
		setOpen(next);
	}, [cancelPendingOpen, input.clipboard, retireOpenState]);

	const dismiss = useCallback((): void => {
		clipboardAbortRef.current?.abort();
		clipboardAbortRef.current = null;
		const current = openRef.current;
		releaseActionUnlessSharedWithPending(
			current?.actionContext,
			actionPromiseRef.current
		);
		releasePendingUnlessActionOwns(current, actionPromiseRef.current);
		releaseTargetLeaseUnlessShared(current?.targetLease, null);
		retireOpenState();
		current?.restoreFocus();
	}, [retireOpenState]);

	const restoreMenuSelection = useCallback((): void => {
		const current = openRef.current;
		if (!current) return;
		restoreCapturedContextSelection(
			current.surfaceElement,
			current.contextSelection
		);
	}, []);

	const invokeAction = useCallback((id: string): void => {
		const current = openRef.current;
		if (!current) return;
		const actionContext = current.actionContext ?? undefined;
		const actionStart = new Promise<void>(() => undefined);
		actionPromiseRef.current = { context: actionContext, promise: actionStart };
		let result: void | Promise<void>;
		try {
			result = undefined === actionContext
				? onActionRef.current(id, current.captured)
				: onActionRef.current(id, current.captured, actionContext);
		} catch (error) {
			if (actionPromiseRef.current?.promise === actionStart)
				actionPromiseRef.current = null;
			releaseActionContext(actionContext);
			throw error;
		}
		if (result && "function" === typeof result.then) {
			const pending = Promise.resolve(result);
			actionPromiseRef.current = { context: actionContext, promise: pending };
			void pending.then(
				() => {
					const currentAction = actionPromiseRef.current?.promise === pending;
					if (currentAction) actionPromiseRef.current = null;
					const currentMenu = openRef.current?.actionContext;
					const pendingMenu = pendingOpenRef.current?.state.actionContext;
					if (
						!sharesOwnedLease(actionContext, pendingMenu)
						&& (currentMenu === actionContext
							|| !sharesOwnedLease(actionContext, currentMenu))
					) {
						releaseActionContext(actionContext);
					}
				},
				() => {
					const currentAction = actionPromiseRef.current?.promise === pending;
					if (currentAction) actionPromiseRef.current = null;
					const currentMenu = openRef.current?.actionContext;
					const pendingMenu = pendingOpenRef.current?.state.actionContext;
					if (
						!sharesOwnedLease(actionContext, pendingMenu)
						&& (currentMenu === actionContext
							|| !sharesOwnedLease(actionContext, currentMenu))
					) {
						releaseActionContext(actionContext);
					}
				}
			);
		} else {
			if (actionPromiseRef.current?.promise === actionStart)
				actionPromiseRef.current = null;
			releaseActionContext(actionContext);
		}
	}, []);

	const validateOwners = useCallback((
		source: EditorContextMenuSurface | null,
		visual: EditorContextMenuSurface | null
	): void => {
		const current = openRef.current;
		const pending = pendingOpenRef.current;
		const activeElements = [source?.element, visual?.element];
		const activeBoundaries = [source?.boundaryElement, visual?.boundaryElement];
		const activeIdentities = [
			source?.identity ?? source?.element,
			visual?.identity ?? visual?.element
		];
		// A pending demand describes the pointer gesture the user made, not the
		// revision that happened to be current while the surface was still
		// materializing. An accepted Preview or a block-index build legally
		// recreates the owner's memoized surface, which advances the runtime
		// generation and the structural provider identity, and a demand that
		// survived the readiness transition must still be rebound to the current
		// surface instead of being cancelled silently. Only the surface itself
		// going away (element, boundary, or owner identity) invalidates the
		// demand. An open menu keeps the stricter check below because it presents
		// the capture it was opened with.
		if (
			pending
			&& (
				!activeElements.includes(pending.surface.element)
				|| !activeBoundaries.includes(pending.state.boundaryElement)
				|| !activeIdentities.includes(
					pending.state.captured.surfaceIdentity
				)
			)
		) {
			cancelPendingOpen();
		}
		if (
			current
			&& (
				!activeElements.includes(current.surfaceElement)
				|| !activeBoundaries.includes(current.boundaryElement)
				|| !activeIdentities.includes(current.captured.surfaceIdentity)
			)
		) {
			retireVisibleDemand(current);
			return;
		}
		if (current) {
			const currentSurface = [source, visual].find(
				(candidate): candidate is EditorContextMenuSurface =>
					Boolean(
						candidate
						&& candidate.element === current.surfaceElement
						&& candidate.boundaryElement === current.boundaryElement
						&& (candidate.identity ?? candidate.element)
							=== current.captured.surfaceIdentity
					)
			);
			const ownerDrift = Boolean(
				currentSurface
				&& (
					current.captured.surfaceGeneration !== currentSurface.generation
					|| current.getBlockIndex !== currentSurface.getBlockIndex
				)
			);
			if (ownerDrift && currentSurface) {
				// A visible menu keeps presenting the target and anchor the user
				// opened it with; the helper revalidates the demand's document state,
				// rebuilds the context against the replaced surface, and retains the
				// menu across a pending inventory instead of dismissing it.
				refreshOpenMenu(currentSurface, current);
			}
		}
	}, [cancelPendingOpen, refreshOpenMenu, retireVisibleDemand]);

	const readOpen = useCallback((): OpenState | null => openRef.current, []);
	const readPending = useCallback(
		(): PendingOpenDemand | null => pendingOpenRef.current,
		[]
	);
	const isRetainedPending = useCallback(
		(surface: EditorContextMenuSurface): boolean =>
			Boolean(
				openRef.current
				&& openRef.current.surfaceElement === surface.element
				&& "pending" === openRef.current.readiness.status
			),
		[]
	);

	const dispose = useCallback((): void => {
		clipboardAbortRef.current?.abort();
		cancelPendingOpen();
		releaseActionUnlessSharedWithPending(
			openRef.current?.actionContext,
			actionPromiseRef.current
		);
		releasePendingUnlessActionOwns(openRef.current, actionPromiseRef.current);
		releaseTargetLeaseUnlessShared(openRef.current?.targetLease, null);
		retireOpenState();
	}, [cancelPendingOpen, retireOpenState]);

	return {
		cancelPending: cancelPendingOpen,
		consumeAcceptedSelection: consumePendingAcceptedSelection,
		dismiss,
		dispose,
		invokeAction,
		isRetainedPending,
		open,
		openSurface,
		readOpen,
		readPending,
		replay,
		restoreMenuSelection,
		validateOwners
	};
}
