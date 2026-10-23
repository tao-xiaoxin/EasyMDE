import type { EditorContextSnapshot } from "./editor-context-menu-rules";

export type EditorContextMenuActionOperation = Readonly<{
	captured: EditorContextSnapshot;
	cleanup: () => void;
	controller: AbortController;
	isCurrent: () => boolean;
}>;

export type EditorContextMenuOperationOwner = Readonly<{
	begin: (
		captured: EditorContextSnapshot,
		isCurrent: () => boolean,
	) => EditorContextMenuActionOperation;
	dispose: () => void;
	finish: (operation: EditorContextMenuActionOperation) => void;
	recheck: (isCurrent: (captured: EditorContextSnapshot) => boolean) => void;
}>;

/**
 * The one owner of the context-menu action's cancellation lifetime.
 *
 * A new action retires the previous operation before it starts. The operation
 * owns exactly its own AbortController and document/selection subscriptions;
 * target, image, and generated-content leases stay with the context-menu
 * feature that issued them, so nothing is released twice.
 */
export function createEditorContextMenuOperationOwner(input: Readonly<{
	subscribeDocument: (listener: () => void) => () => void;
	subscribeSelection: (listener: () => void) => () => void;
}>): EditorContextMenuOperationOwner {
	let active: EditorContextMenuActionOperation | null = null;

	const finish = (operation: EditorContextMenuActionOperation): void => {
		if (active === operation) operation.cleanup();
	};

	const dispose = (): void => {
		active?.controller.abort();
		active?.cleanup();
	};

	const begin = (
		captured: EditorContextSnapshot,
		isCurrent: () => boolean,
	): EditorContextMenuActionOperation => {
		const previous = active;
		previous?.controller.abort();
		previous?.cleanup();
		const controller = new AbortController();
		const check = (): void => {
			if (!isCurrent()) controller.abort();
		};
		const unsubscribeDocument = input.subscribeDocument(check);
		const unsubscribeSelection = input.subscribeSelection(check);
		const operation: EditorContextMenuActionOperation = {
			captured,
			cleanup: () => {
				unsubscribeDocument();
				unsubscribeSelection();
				if (active === operation) active = null;
			},
			controller,
			isCurrent,
		};
		active = operation;
		check();
		return operation;
	};

	const recheck = (
		isCurrent: (captured: EditorContextSnapshot) => boolean,
	): void => {
		if (active && !isCurrent(active.captured)) active.controller.abort();
	};

	return { begin, dispose, finish, recheck };
}
