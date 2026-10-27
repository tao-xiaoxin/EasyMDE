import { useEffect } from "@wordpress/element";

import type {
	EditorContextMenuFeatureProps,
	EditorContextMenuSurface
} from "./EditorContextMenuFeature";
import type { EditorContextMenuDemandController } from "./editor-context-menu-demand";

/**
 * Binds owner notifications into the single demand owner.
 *
 * The per-surface `evaluating` guard is the only reentrancy state here: a
 * pending preparation can publish a selection while this evaluation is already
 * replaying it, and a nested replay would repeat the same work. It never stores
 * demand state or captures a target.
 */
export function useEditorContextMenuNotifications(input: Readonly<{
	consumeAcceptedSelection: EditorContextMenuDemandController["consumeAcceptedSelection"];
	direction: "ltr" | "rtl";
	heading?: EditorContextMenuFeatureProps["heading"];
	isRetainedPending: EditorContextMenuDemandController["isRetainedPending"];
	readPending: EditorContextMenuDemandController["readPending"];
	replay: EditorContextMenuDemandController["replay"];
	validateOwners: EditorContextMenuDemandController["validateOwners"];
	source: EditorContextMenuSurface | null;
	visual: EditorContextMenuSurface | null;
}>): void {
	const {
		consumeAcceptedSelection,
		isRetainedPending,
		readPending,
		replay,
		validateOwners,
		source,
		visual
	} = input;

	useEffect(() => {
		const surfaces = [source, visual].filter(
			(candidate): candidate is EditorContextMenuSurface => Boolean(candidate)
		);
		const cleanups = surfaces.flatMap((surface) => {
			let evaluating = false;
			const refresh = (): void => {
				// A pending preparation flow can publish a selection update while
				// this evaluation is already re-running `prepare`; that publication
				// belongs to the demand being evaluated, so a nested pass would only
				// repeat the same work. Dropping the nested pass keeps the
				// synchronous prepare -> selection -> refresh cycle from recursing
				// while the outermost evaluation still observes the resulting
				// snapshot.
				if (evaluating) return;
				evaluating = true;
				try {
					replay(surface);
				} finally {
					evaluating = false;
				}
			};
			const subscriptions = [] as Array<() => void>;
			if (surface.subscribeBlockIndex) {
				subscriptions.push(surface.subscribeBlockIndex(refresh));
			}
			if (surface.subscribeReadiness) {
				subscriptions.push(surface.subscribeReadiness(refresh));
			}
			if (surface.subscribeSnapshot) {
				subscriptions.push(surface.subscribeSnapshot(refresh));
			}
			if (surface.subscribeSelection) {
				subscriptions.push(surface.subscribeSelection(() => {
					// The owner's accepted presentation publication runs synchronously
					// inside its own canonical write, so consume it before the ordinary
					// reentrancy guard: a legitimate receipt arriving while preparation
					// is still evaluating must not be dropped. A miss does nothing here
					// and the unchanged flow below decides.
					consumeAcceptedSelection(surface);
					const pendingHere =
						readPending()?.surface.element === surface.element;
					// A visible menu that is still waiting for its refreshed inventory
					// was retained by `refreshOpenMenu` and has no pending demand behind
					// it. Its captured selection is part of the demand it was opened
					// with, and a selection-only change publishes through this
					// subscription (never through the text snapshot), so it has to be
					// validated here exactly like a pending demand. Otherwise the
					// retained menu keeps describing a selection the user no longer has;
					// a same-batch A -> B -> A change is handled by the synchronous
					// retirement in `retireOpenState`.
					if (!pendingHere && !isRetainedPending(surface)) return;
					refresh();
				}));
			}
			// A surface object can be replaced after its readiness owner has already
			// notified the old subscription. Replaying only a demand anchored to
			// this same surface closes that notification gap. An already-open menu
			// has no pending demand: refreshing it here would rebuild its action
			// context during an ordinary owner rerender and could release a
			// generated/image resource that a later action still owns.
			const pendingSurface = readPending()?.surface;
			if (
				pendingSurface
				&& pendingSurface.element === surface.element
				&& pendingSurface.boundaryElement === surface.boundaryElement
				&& (pendingSurface.identity ?? pendingSurface.element)
					=== (surface.identity ?? surface.element)
			) {
				refresh();
			}
			return subscriptions;
		});
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [
		consumeAcceptedSelection,
		isRetainedPending,
		readPending,
		replay,
		source?.boundaryElement,
		source?.element,
		source?.getActionContext,
		source?.getBlockIndex,
		source?.getContextReadiness,
		source?.identity,
		source?.subscribeBlockIndex,
		source?.subscribeReadiness,
		source?.subscribeSelection,
		source?.subscribeSnapshot,
		visual?.boundaryElement,
		visual?.element,
		visual?.getActionContext,
		visual?.getBlockIndex,
		visual?.getContextReadiness,
		visual?.identity,
		visual?.subscribeBlockIndex,
		visual?.subscribeReadiness,
		visual?.subscribeSelection,
		visual?.subscribeSnapshot
	]);

	useEffect(() => {
		validateOwners(source, visual);
	}, [
		input.direction,
		input.heading,
		validateOwners,
		source?.boundaryElement,
		source?.element,
		source?.generation,
		source?.getBlockIndex,
		source?.identity,
		visual?.boundaryElement,
		visual?.element,
		visual?.generation,
		visual?.getBlockIndex,
		visual?.identity
	]);
}
