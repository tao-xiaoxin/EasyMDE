import type { EditorView } from "prosemirror-view";

export type VisualCompositionPhase =
	| "composing"
	| "failed"
	| "idle"
	| "settling";

export type VisualCompositionSession = Readonly<{
	/** True while a composition is open or its DOM flush has not landed yet. */
	isBusy: () => boolean;
	/**
	 * Called by the host for every doc-changing transaction while settling:
	 * ProseMirror's queued DOM flush has landed, so commit it once now.
	 */
	noteSettlingTransaction: () => void;
	phase: () => VisualCompositionPhase;
	/** External canonical state replaced the projection: drop composition. */
	reset: () => void;
	/** Resolves once no composition is pending and its commit succeeded. */
	settle: () => Promise<boolean>;
	dispose: () => void;
}>;

export type VisualCompositionSessionOptions = Readonly<{
	commit: () => boolean;
	view: EditorView;
}>;

const PROTECTED_COMPOSITION_SELECTOR =
	".easymde-protected-editor, [data-easymde-protected-block], [data-easymde-protected-inline]";
const MAX_SETTLE_ATTEMPTS = 3;

function isProtectedTarget(
	view: EditorView,
	target: EventTarget | null,
): boolean {
	const element =
		target && typeof (target as Node).nodeType === "number"
			? (target as Node).nodeType === 1
				? (target as Element)
				: (target as Node).parentElement
			: null;
	if (!element || element === view.dom) return false;
	const protectedRoot = element.closest(PROTECTED_COMPOSITION_SELECTOR);
	return protectedRoot !== null && view.dom.contains(protectedRoot);
}

/**
 * IME composition state machine: `idle -> composing -> settling -> idle`, or
 * `failed` when the settled commit is rejected. `compositionend` never commits
 * the stale pre-flush ProseMirror state synchronously: settlement waits one
 * microtask (after ProseMirror's own queued DOM flush) and one task, guarded by
 * generation and disposal, then commits exactly once. Composition events from
 * protected-card fields never touch the outer state.
 */
export function createVisualCompositionSession(
	options: VisualCompositionSessionOptions,
): VisualCompositionSession {
	const { commit, view } = options;
	let phase: VisualCompositionPhase = "idle";
	let generation = 0;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let waiters: Array<(ok: boolean) => void> = [];

	const resolveWaiters = (ok: boolean): void => {
		const pending = waiters;
		waiters = [];
		for (const resolve of pending) resolve(ok);
	};

	const clearTimer = (): void => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const finalize = (): void => {
		clearTimer();
		generation += 1;
		phase = "idle";
		let ok = false;
		try {
			ok = commit();
		} catch {
			ok = false;
		}
		phase = ok ? "idle" : "failed";
		resolveWaiters(ok);
	};

	const scheduleSettlement = (attempt: number): void => {
		const scheduledGeneration = generation;
		void Promise.resolve().then(() => {
			if (
				disposed ||
				scheduledGeneration !== generation ||
				phase !== "settling"
			)
				return;
			clearTimer();
			timer = setTimeout(() => {
				timer = null;
				if (
					disposed ||
					scheduledGeneration !== generation ||
					phase !== "settling"
				)
					return;
				if (view.composing && attempt + 1 < MAX_SETTLE_ATTEMPTS) {
					scheduleSettlement(attempt + 1);
					return;
				}
				finalize();
			}, 0);
		});
	};

	const handleCompositionStart = (event: Event): void => {
		if (disposed || isProtectedTarget(view, event.target)) return;
		clearTimer();
		generation += 1;
		phase = "composing";
	};

	const handleCompositionEnd = (event: Event): void => {
		if (disposed || isProtectedTarget(view, event.target)) return;
		if (phase !== "composing") return;
		generation += 1;
		phase = "settling";
		scheduleSettlement(0);
	};

	view.dom.addEventListener("compositionstart", handleCompositionStart);
	view.dom.addEventListener("compositionend", handleCompositionEnd);

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			clearTimer();
			generation += 1;
			view.dom.removeEventListener("compositionstart", handleCompositionStart);
			view.dom.removeEventListener("compositionend", handleCompositionEnd);
			resolveWaiters(false);
		},
		isBusy: () =>
			!disposed &&
			(phase === "composing" || phase === "settling" || view.composing),
		noteSettlingTransaction() {
			if (!disposed && phase === "settling" && !view.composing) finalize();
		},
		phase: () => phase,
		reset() {
			clearTimer();
			generation += 1;
			if (phase !== "composing") phase = "idle";
			resolveWaiters(phase === "idle");
		},
		settle() {
			if (disposed) return Promise.resolve(false);
			if (phase === "composing" || phase === "settling") {
				return new Promise<boolean>((resolve) => {
					waiters.push(resolve);
				});
			}
			if (phase === "failed") {
				phase = "idle";
				try {
					const ok = commit();
					phase = ok ? "idle" : "failed";
					return Promise.resolve(ok);
				} catch {
					return Promise.resolve(false);
				}
			}
			return Promise.resolve(true);
		},
	};
}
