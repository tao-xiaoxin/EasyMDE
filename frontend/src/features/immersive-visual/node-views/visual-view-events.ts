import type { EditorView } from "prosemirror-view";

/**
 * Per-EditorView reactive hubs shared across visual NodeViews
 * (`ProtectedAtomNodeView`, `TaskItemNodeView`, `CodeBlockNodeView`) without
 * coupling them to card-editor or sanitizer code.
 */

export type VisualEditableListener = (editable: boolean) => void;

const editableListeners = new WeakMap<
	EditorView,
	Set<VisualEditableListener>
>();
const lastPublishedEditable = new WeakMap<EditorView, boolean>();
const editableInteractionCleanups = new WeakMap<EditorView, () => void>();

/**
 * Subscribe a NodeView to dynamic `EditorView.editable` changes. ProseMirror
 * updates `view.editable` on every `setProps`, but it does not call
 * `NodeView.update()` when only `editable` changed, so the highlight plugin's
 * PluginView publishes the new state through this hub.
 */
export function subscribeVisualEditableState(
	view: EditorView,
	listener: VisualEditableListener,
): () => void {
	let listeners = editableListeners.get(view);
	if (!listeners) {
		listeners = new Set();
		editableListeners.set(view, listeners);
	}
	listeners.add(listener);
	if (listeners.size === 1) {
		// Independent fallback for hosts that mount NodeViews without the
		// highlight plugin: refresh stale disabled state on the next interaction.
		const sync = (): void => publishVisualEditableState(view);
		view.dom.addEventListener("focusin", sync);
		view.dom.addEventListener("pointerdown", sync, true);
		editableInteractionCleanups.set(view, () => {
			view.dom.removeEventListener("focusin", sync);
			view.dom.removeEventListener("pointerdown", sync, true);
		});
	}
	return () => {
		const current = editableListeners.get(view);
		if (!current) return;
		current.delete(listener);
		if (current.size === 0) {
			editableListeners.delete(view);
			const cleanup = editableInteractionCleanups.get(view);
			editableInteractionCleanups.delete(view);
			cleanup?.();
		}
	};
}

/** Publish the current `view.editable` state to subscribed NodeViews. */
export function publishVisualEditableState(view: EditorView): void {
	if (view.isDestroyed) return;
	const editable = view.editable;
	if (lastPublishedEditable.get(view) === editable) return;
	lastPublishedEditable.set(view, editable);
	const listeners = editableListeners.get(view);
	if (!listeners) return;
	for (const listener of Array.from(listeners)) {
		listener(editable);
	}
}

const documentUpdateListeners = new WeakMap<EditorView, Set<() => void>>();

/**
 * Subscribe a NodeView (e.g. live `[TOC]`) to document updates on `view`.
 * Only mounted views that depend on cross-node state subscribe, so ordinary
 * editing incurs zero overhead when none are present.
 */
export function subscribeVisualDocumentUpdate(
	view: EditorView,
	listener: () => void,
): () => void {
	let listeners = documentUpdateListeners.get(view);
	if (!listeners) {
		listeners = new Set();
		documentUpdateListeners.set(view, listeners);
	}
	listeners.add(listener);
	return () => {
		const current = documentUpdateListeners.get(view);
		if (!current) return;
		current.delete(listener);
		if (current.size === 0) {
			documentUpdateListeners.delete(view);
		}
	};
}

/** Publish a document-change tick to subscribed NodeViews. */
export function publishVisualDocumentUpdate(view: EditorView): void {
	if (view.isDestroyed) return;
	const listeners = documentUpdateListeners.get(view);
	if (!listeners) return;
	for (const listener of Array.from(listeners)) {
		listener();
	}
}
