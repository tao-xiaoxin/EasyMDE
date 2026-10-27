import { useEffect } from "@wordpress/element";

import type {
	EditorContextMenuSurface
} from "./EditorContextMenuFeature";
import type {
	CapturedContextSelection
} from "./editor-context-menu-context";
import type {
	EditorContextMenuDemandController
} from "./editor-context-menu-demand";

function eventTargetInside(event: Event, element: HTMLElement): boolean {
	return event.target instanceof Node && element.contains(event.target);
}

export function captureSelectionForContextPointer(
	event: MouseEvent,
	surface: HTMLElement
): CapturedContextSelection | null {
	if (2 !== event.button || !eventTargetInside(event, surface)) return null;
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection || selection.isCollapsed || 1 !== selection.rangeCount) {
		return null;
	}
	if (
		!selection.anchorNode
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

export function restoreContextSelection(
	event: MouseEvent,
	surface: HTMLElement,
	captured: CapturedContextSelection | null
): void {
	const target = event.target;
	if (
		!captured?.range.startContainer.isConnected
		|| !captured.range.endContainer.isConnected
		|| !captured.anchorNode.isConnected
		|| !captured.focusNode.isConnected
		|| !(target instanceof Node)
		|| !surface.contains(target)
	) return;
	try {
		const selection = surface.ownerDocument.defaultView?.getSelection();
		if (!selection?.isCollapsed) return;
		selection.removeAllRanges();
		selection.setBaseAndExtent(
			captured.anchorNode,
			captured.anchorOffset,
			captured.focusNode,
			captured.focusOffset
		);
	} catch {
		return;
	}
}

function keyboardAnchor(
	element: HTMLElement
): Readonly<{ x: number; y: number }> {
	const rect = element.getBoundingClientRect();
	return {
		x: Math.max(0, rect.left),
		y: Math.max(0, rect.bottom)
	};
}

/**
 * Binds native pointer/keyboard admission for the context-menu surfaces and
 * the document-level dismissal/cancel listeners. It owns no demand state: every
 * event either asks the demand owner to open a gesture or to cancel the one it
 * already holds.
 */
export function useEditorContextMenuActivation(input: Readonly<{
	cancelPending: () => void;
	openSurface: EditorContextMenuDemandController["openSurface"];
	readOpen: EditorContextMenuDemandController["readOpen"];
	readPending: EditorContextMenuDemandController["readPending"];
	source: EditorContextMenuSurface | null;
	visual: EditorContextMenuSurface | null;
}>): void {
	const { cancelPending, openSurface, readOpen, readPending, source, visual } =
		input;

	useEffect(() => {
		const surfaces = [source, visual].filter(
			(candidate): candidate is EditorContextMenuSurface => Boolean(candidate)
		);
		const listeners = surfaces.map((surface) => {
			let preservedSelection: CapturedContextSelection | null = null;
			// A native context-menu request is a *pointer* activation only when a
			// pointer gesture preceded it on this surface. The Context Menu key and
			// Shift+F10 make some browsers fire their own `contextmenu` event whose
			// coordinates are a menu anchor, not a pointer hit-test position; such
			// an activation must keep the user's current selection.
			let pointerGesturePending = false;
			const rememberSelection = (): void => {
				const selection =
					surface.element.ownerDocument.defaultView?.getSelection();
				if (
					!selection
					|| selection.isCollapsed
					|| 1 !== selection.rangeCount
					|| !selection.anchorNode
					|| !selection.focusNode
					|| !surface.element.contains(selection.anchorNode)
					|| !surface.element.contains(selection.focusNode)
				) return;
				try {
					preservedSelection = {
						anchorNode: selection.anchorNode,
						anchorOffset: selection.anchorOffset,
						focusNode: selection.focusNode,
						focusOffset: selection.focusOffset,
						range: selection.getRangeAt(0).cloneRange()
					};
				} catch {
					preservedSelection = null;
				}
			};
			const handlePointerDown = (event: PointerEvent): void => {
				pointerGesturePending = true;
				preservedSelection = captureSelectionForContextPointer(
					event,
					surface.element
				);
				if (preservedSelection) {
					event.preventDefault();
				}
			};
			const handleMouseDown = (event: MouseEvent): void => {
				pointerGesturePending = true;
				preservedSelection = captureSelectionForContextPointer(
					event,
					surface.element
				);
				if (preservedSelection) {
					event.preventDefault();
				}
			};
			const handleContextMenu = (event: MouseEvent): void => {
				if (
					!eventTargetInside(event, surface.element)
					|| event.defaultPrevented
				) return;
				const pointerGesture = pointerGesturePending;
				pointerGesturePending = false;
				restoreContextSelection(
					event,
					surface.element,
					preservedSelection
				);
				preservedSelection = null;
				event.preventDefault();
				event.stopPropagation();
				openSurface(
					surface,
					{ x: event.clientX, y: event.clientY },
					event.target instanceof Element ? event.target : null,
					pointerGesture ? "pointer" : "keyboard"
				);
			};
			const handleKeyDown = (event: KeyboardEvent): void => {
				if (
					!eventTargetInside(event, surface.element)
					|| event.isComposing
					|| 229 === event.keyCode
					|| event.defaultPrevented
					|| !(
						"ContextMenu" === event.key
						|| ("F10" === event.key && event.shiftKey)
					)
				) return;
				pointerGesturePending = false;
				event.preventDefault();
				event.stopPropagation();
				openSurface(
					surface,
					keyboardAnchor(surface.element),
					surface.element,
					"keyboard"
				);
			};
			surface.element.ownerDocument.addEventListener(
				"selectionchange",
				rememberSelection,
				true
			);
			surface.element.addEventListener("pointerdown", handlePointerDown, true);
			surface.element.addEventListener("mousedown", handleMouseDown, true);
			surface.element.addEventListener("contextmenu", handleContextMenu, true);
			surface.element.addEventListener("keydown", handleKeyDown, true);
			return () => {
				surface.element.ownerDocument.removeEventListener(
					"selectionchange",
					rememberSelection,
					true
				);
				surface.element.removeEventListener(
					"pointerdown",
					handlePointerDown,
					true
				);
				surface.element.removeEventListener("mousedown", handleMouseDown, true);
				surface.element.removeEventListener(
					"contextmenu",
					handleContextMenu,
					true
				);
				surface.element.removeEventListener("keydown", handleKeyDown, true);
			};
		});
		return () => {
			for (const cleanup of listeners) cleanup();
			// This effect re-runs whenever the owner recreates its surface object,
			// which an accepted Preview or a block-index build does legally while a
			// demand waits for readiness. Cancelling here would silently drop the
			// user's first right-click, so only the listener set is torn down; the
			// demand is cancelled by the owner-replacement check (validation effect)
			// or by the explicit dismissal, outside-interaction, and unmount paths.
		};
	}, [
		openSurface,
		source?.element,
		source?.generation,
		source?.getActionContext,
		source?.getBlockIndex,
		source?.getContextReadiness,
		source?.identity,
		source?.subscribeSelection,
		visual?.element,
		visual?.generation,
		visual?.getActionContext,
		visual?.getBlockIndex,
		visual?.getContextReadiness,
		visual?.identity,
		visual?.subscribeSelection
	]);

	useEffect(() => {
		const ownerDocument =
			source?.element.ownerDocument ?? visual?.element.ownerDocument;
		const windowRef = ownerDocument?.defaultView;
		if (!ownerDocument || !windowRef) return undefined;
		let preservedContextSelection: CapturedContextSelection | null = null;
		const cancelOutside = (target: EventTarget | null): void => {
			const pending = readPending();
			if (!pending || !(target instanceof Node)) return;
			if (!pending.surface.element.contains(target)) cancelPending();
		};
		const handlePointer = (event: PointerEvent): void =>
			cancelOutside(event.target);
		const handlePointerDown = (event: MouseEvent): void => {
			if (2 !== event.button) return;
			const target = event.target;
			if (!(target instanceof Node)) return;
			const surface = [source?.element, visual?.element].find((candidate) =>
				candidate?.contains(target)
			);
			if (!surface) return;
			preservedContextSelection =
				captureSelectionForContextPointer(event, surface);
		};
		const handleContextMenu = (event: MouseEvent): void => {
			const target = event.target;
			if (target instanceof Node) {
				const surface = [source?.element, visual?.element].find((candidate) =>
					candidate?.contains(target)
				);
				if (surface) {
					restoreContextSelection(
						event,
						surface,
						preservedContextSelection
					);
				}
			}
			preservedContextSelection = null;
			cancelOutside(event.target);
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			// A demand that is still waiting for its owner has no visible menu, so
			// the menu's own Escape handler cannot claim the chord. This document
			// capture listener runs before the immersive owner's bubble listener, so
			// it must consume the cancellation here: otherwise the same Escape also
			// exits the editor mode and the held demand resolves into no editable
			// surface at all. With no pending demand (and therefore no open menu)
			// ordinary Escape stays untouched for the owner that handles it.
			if (
				"Escape" === event.key
				&& readPending()
				&& !readOpen()
				&& !event.defaultPrevented
				&& !event.isComposing
				&& 229 !== event.keyCode
			) {
				event.preventDefault();
				event.stopPropagation();
				cancelPending();
				return;
			}
			if ("Tab" === event.key) cancelPending();
		};
		const handleScroll = (): void => cancelPending();
		ownerDocument.addEventListener("pointerdown", handlePointer, true);
		ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
		ownerDocument.addEventListener("mousedown", handlePointerDown, true);
		ownerDocument.addEventListener("contextmenu", handleContextMenu, true);
		ownerDocument.addEventListener("keydown", handleKeyDown, true);
		windowRef.addEventListener("scroll", handleScroll, true);
		return () => {
			ownerDocument.removeEventListener("pointerdown", handlePointer, true);
			ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
			ownerDocument.removeEventListener("mousedown", handlePointerDown, true);
			ownerDocument.removeEventListener("contextmenu", handleContextMenu, true);
			ownerDocument.removeEventListener("keydown", handleKeyDown, true);
			windowRef.removeEventListener("scroll", handleScroll, true);
		};
	}, [cancelPending, readOpen, readPending, source?.element, visual?.element]);
}
