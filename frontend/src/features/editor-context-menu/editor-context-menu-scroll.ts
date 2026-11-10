export type EditorContextMenuScrollPosition = Readonly<{
	left: number;
	top: number;
}>;

export type EditorContextMenuScrollBaseline = Readonly<{
	positions: ReadonlyMap<Element, EditorContextMenuScrollPosition>;
	viewport: EditorContextMenuScrollPosition;
}>;

/** Snapshot the same ancestor/window scroll positions used by an open menu. */
export function captureEditorContextMenuScrollBaseline(
	surfaceElement: Element | null | undefined,
	windowRef: Window
): EditorContextMenuScrollBaseline {
	const positions = new Map<Element, EditorContextMenuScrollPosition>();
	for (
		let element = surfaceElement ?? null;
		element;
		element = element.parentElement
	) {
		positions.set(element, {
			left: element.scrollLeft,
			top: element.scrollTop
		});
	}
	return {
		positions,
		viewport: { left: windowRef.scrollX, top: windowRef.scrollY }
	};
}

/**
 * True only when this scroll event moves a target away from the baseline.
 * A known ancestor/window at its captured position is a queued event and is
 * ignored; an unknown external target is never admitted.
 */
export function editorContextMenuScrollMoved(
	event: Event,
	baseline: EditorContextMenuScrollBaseline,
	documentRef: Document,
	windowRef: Window
): boolean {
	const target = event.target;
	if (
		target === documentRef
		|| target === windowRef
		|| target === event.currentTarget
	) {
		return (
			windowRef.scrollX !== baseline.viewport.left
			|| windowRef.scrollY !== baseline.viewport.top
		);
	}
	const initial = target instanceof Element
		? baseline.positions.get(target)
		: undefined;
	if (!initial || !(target instanceof Element)) return true;
	return (
		target.scrollLeft !== initial.left
		|| target.scrollTop !== initial.top
	);
}
