import type {
	AppearanceBootstrap,
	AppearanceState,
} from "../../contracts/bootstrap/appearance-bootstrap";
import type { EditorRootPreviewBootstrap } from "../../contracts/bootstrap/editor-root-bootstrap";
import type {
	MediaPickerDocumentPort,
	MediaPickerDocumentSnapshot,
} from "../../contracts/ports/media-picker-port";
import type { PreviewRequest } from "../../contracts/ports/preview-request";
import type { EditorDocumentSession } from "../../features/document-source/ui/EditorDocumentSource";
import type { EditorTextEdit } from "../../features/editor-context-menu/editor-context-menu-text-edit";
import type { ImmersiveViewMode } from "../../features/immersive-editor/immersive-editor";
import type {
	PreviewSourceSelection,
	PreviewSurfaceRuntime,
	PreviewSurfaceStatus,
} from "../../features/live-preview/ui/PreviewSurfaceOwner";
import { isMarkdownTerminalWhitespaceSuffix } from "../../shared/markdown/markdown-line-model";
import type {
	ApplyVisualCanonicalChange,
	EditorVisualPreviewSnapshotLike,
	ImmersiveVisualEditorRuntime,
	VisualCanonicalChangeContext,
	VisualPreviewWindowRequest,
} from "./editor-root-types";

export const WECHAT_PREPARATION_DEBOUNCE_MS = 180;

export function isCancelledVisualTransferFailure(code: string): boolean {
	return [
		"visual-editor-canonical-document-changed",
		"visual-editor-markdown-paste-document-stale",
		"visual-editor-markdown-paste-selection-stale",
		"visual-editor-markdown-paste-superseded",
		"visual-editor-native-preview-document-stale",
		"visual-editor-native-preview-stale",
	].includes(code);
}

/**
 * Transfer failures a newer accepted Preview already supersedes. The runtime
 * drops the pending transfer and keeps serving its canvas, and the next
 * transfer re-synchronizes it, so the host keeps the Visual session instead of
 * announcing an editor-action failure. An external canonical document change
 * is deliberately absent: the Visual session has no accepted source for it and
 * must end.
 */
export function isSupersededVisualTransferFailure(code: string): boolean {
	return [
		"visual-editor-markdown-paste-document-stale",
		"visual-editor-markdown-paste-superseded",
		"visual-editor-native-preview-document-stale",
		"visual-editor-native-preview-stale",
	].includes(code);
}

/**
 * Preview-render failures where canonical Markdown edits remain intact and the
 * formal server Preview request failed (for example HTTP 500 or a network
 * outage). Keeping visual editing unlocked with a visible privacy-safe alert
 * and without scheduling an automatic retry lets the user continue editing or
 * undo without losing input.
 */
export function isPreviewRenderFailureCode(code: string): boolean {
	return [
		"visual-editor-markdown-paste-render-failed",
		"visual-editor-native-preview-failed",
		"visual-editor-history-preview-failed",
	].includes(code);
}

/**
 * Failures that invalidate the accepted visual DOM itself: the owner has
 * already restored its accepted snapshot, so it reports through `onFailure`
 * only and never reaches `onTransferFailure`. A surface whose accepted
 * provenance is gone cannot stay in visual editing, so Root leaves the mode
 * here - the same terminal outcome the transfer-failure path produces.
 */
export function isAcceptedDomInvalidatingFailure(code: string): boolean {
	return (
		"visual-editor-code-body-map-stale" === code ||
		"visual-editor-canonical-change-map-stale" === code
	);
}

export function isVisualPreviewWindowRequestCurrent(
	request: VisualPreviewWindowRequest | null,
	snapshot: Pick<
		EditorVisualPreviewSnapshotLike,
		"revision" | "signature"
	> | null,
	status: PreviewSurfaceStatus,
	active: boolean,
): boolean {
	return Boolean(
		active &&
			request &&
			snapshot &&
			"ready" === status &&
			snapshot.revision === request.revision &&
			snapshot.signature === request.signature,
	);
}

export function visualPreviewSourceHasEditableMap(
	snapshot: Pick<EditorVisualPreviewSnapshotLike, "editMap"> | null,
	sourceMarkdown: string | null,
): boolean {
	return Boolean(
		snapshot?.editMap ||
			(null !== sourceMarkdown &&
				isMarkdownTerminalWhitespaceSuffix(sourceMarkdown)),
	);
}

export function focusVisualPreviewRuntime(
	runtime: ImmersiveVisualEditorRuntime | null,
	activeElement: () => HTMLElement | null,
	onFailure: (code: string) => void,
): boolean {
	const surface = runtime?.surface;
	const editable = Boolean(
		surface &&
			("boolean" === typeof surface.isContentEditable
				? surface.isContentEditable
				: "true" === surface.getAttribute("contenteditable")),
	);
	if (!surface?.isConnected || !editable) {
		onFailure("visual-editor-focus-surface-unavailable");
		return false;
	}
	if (runtime?.focus) {
		runtime.focus();
	} else {
		surface.focus({ preventScroll: true });
	}
	if (activeElement() === surface) return true;
	onFailure("visual-editor-focus-surface-failed");
	return false;
}

export function immersiveModeFromEditingMode(
	editingMode: string,
): ImmersiveViewMode {
	switch (editingMode) {
		case "live-preview":
			return "split";
		case "source":
			return "source";
		case "preview":
			return "preview";
		default:
			throw new Error("editor-root-immersive-editing-mode-invalid");
	}
}

export function immersiveLayoutClassName(
	immersive: boolean,
	mode: ImmersiveViewMode,
): string {
	return `easymde-editor${immersive ? " is-immersive" : ""}${
		immersive ? ` is-immersive-${mode}` : ""
	}`;
}

export function previewRequest(
	markdown: string,
	preview: EditorRootPreviewBootstrap,
	appearance: AppearanceState,
	revision: number,
): PreviewRequest {
	return {
		markdown,
		postId: preview.postId,
		markdownTheme: appearance.markdownTheme,
		codeTheme: appearance.codeTheme,
		customCssId: appearance.customCssId,
		signature: `${revision}:${markdown.length}`,
	};
}

export function schedulePreviewWithDocumentEndPin(
	runtime: Pick<
		PreviewSurfaceRuntime,
		"prepareDocumentEndWindowPin" | "session"
	>,
	request: PreviewRequest,
	onHistoryPendingChange?: (pending: boolean) => void,
	onHistorySelectionRestored?: () => void,
	sourceSelection?: PreviewSourceSelection,
	immediate = true,
): Readonly<{
	onSelectionRestored: () => void;
	release: () => void;
	signature: string;
}> {
	onHistoryPendingChange?.(true);
	let lease: ReturnType<
		PreviewSurfaceRuntime["prepareDocumentEndWindowPin"]
	> | null = null;
	try {
		lease = runtime.prepareDocumentEndWindowPin(
			request.signature,
			sourceSelection,
		);
		runtime.session.schedule(request, immediate);
	} catch (error) {
		try {
			lease?.release();
		} finally {
			onHistoryPendingChange?.(false);
		}
		throw error;
	}
	if (!lease) throw new Error("preview-document-end-pin-not-prepared");
	let released = false;
	let selectionRestored = false;
	return {
		onSelectionRestored: () => {
			if (released || selectionRestored) return;
			selectionRestored = true;
			onHistorySelectionRestored?.();
		},
		release: () => {
			if (released) return;
			released = true;
			try {
				lease?.release();
			} finally {
				onHistoryPendingChange?.(false);
			}
		},
		signature: request.signature,
	};
}

export function visualPreviewUsesWindowedOwner(
	needsWindow: boolean,
	historyOwnerPending: boolean,
	editing: boolean,
	requested: boolean,
): boolean {
	return (needsWindow || historyOwnerPending) && (editing || requested);
}

export function visualPreviewSurfaceUsesWindowedOwner(
	needsWindow: boolean,
	historyOwnerPending: boolean,
	previewPending: boolean,
	editing: boolean,
	requested: boolean,
): boolean {
	return (
		(needsWindow || historyOwnerPending || previewPending) &&
		(editing || requested)
	);
}

export function visualPreviewSurfaceWindowedForVisibility(
	currentWindowed: boolean,
	previewVisible: boolean,
	needsWindow: boolean,
): boolean {
	return currentWindowed || (!previewVisible && needsWindow);
}

export function scheduleVisualWindowedHistoryBranchRelease(
	isDocumentEndHistoryPending: () => boolean,
	hasRedo: () => boolean,
	release: () => void,
	enqueue: (callback: () => void) => void = queueMicrotask,
): void {
	enqueue(() => {
		if (!isDocumentEndHistoryPending() && !hasRedo()) release();
	});
}

export function previewScrollCanvas(surface: HTMLElement): HTMLElement {
	const canvas = surface.parentElement;
	if (!canvas?.classList.contains("easymde-immersive-preview-canvas")) {
		throw new Error("preview-scroll-canvas-missing");
	}
	return canvas;
}

export function documentPort(
	session: EditorDocumentSession,
	isActive: () => boolean,
	insertionSelection?: MediaPickerDocumentSnapshot["selection"],
	formatInsertion?: (value: string, inserted: string) => EditorTextEdit,
): MediaPickerDocumentPort {
	return {
		applyTextChange: (change) => {
			if (!isActive()) {
				throw new Error("editor-root-document-session-inactive");
			}
			// The media picker is a user gesture that can stay open across an
			// arbitrary delay, so the authoritative Source field may become read-only
			// or disabled before the user confirms. Re-check here, at the mutation,
			// rather than only when the picker opened: a read-only surface must not
			// gain a canonical write or a history entry it never permitted. The code
			// follows this port's own `media-picker-*` namespace so the rejection
			// reaches the user as a specific media failure instead of the generic
			// `media-picker-operation-failed` fallback.
			if (!session.document.isEditable()) {
				throw new Error("media-picker-document-read-only");
			}
			if (!insertionSelection || !formatInsertion) {
				session.document.applyTextChange(change);
				return;
			}
			const currentValue = session.document.getValue();
			const { end, start } = insertionSelection;
			const suffixLength = currentValue.length - end;
			const suffixStart = change.value.length - suffixLength;
			if (
				suffixStart < start ||
				change.value.slice(0, start) !== currentValue.slice(0, start) ||
				change.value.slice(suffixStart) !== currentValue.slice(end)
			) {
				throw new Error("media-picker-document-stale");
			}
			session.document.applyTextChange(
				formatInsertion(currentValue, change.value.slice(start, suffixStart)),
			);
		},
		focus: () => {
			if (isActive()) {
				session.document.focus();
			}
		},
		getSnapshot: () => {
			if (!isActive()) {
				throw new Error("editor-root-document-session-inactive");
			}
			return {
				selection: insertionSelection ?? session.document.getSelection(),
				value: session.document.getValue(),
			};
		},
	};
}

export function visualMediaPickerDocument(
	session: EditorDocumentSession,
	expected: VisualCanonicalChangeContext,
	isActive: () => boolean,
	focus: () => void,
	apply: ApplyVisualCanonicalChange,
	insertionSelection?: MediaPickerDocumentSnapshot["selection"],
	formatInsertion?: (value: string, inserted: string) => EditorTextEdit,
): MediaPickerDocumentPort {
	const currentSnapshot = (): MediaPickerDocumentSnapshot => {
		if (!isActive()) {
			throw new Error("editor-root-document-session-inactive");
		}
		return {
			selection: insertionSelection ?? session.document.getSelection(),
			value: session.document.getValue(),
		};
	};

	return {
		applyTextChange: (change) => {
			if (!isActive()) {
				throw new Error("editor-root-document-session-inactive");
			}
			const { end, start } = insertionSelection ?? expected.selection;
			const suffixLength = expected.value.length - end;
			const suffixStart = change.value.length - suffixLength;
			if (
				suffixStart < start ||
				change.value.slice(0, start) !== expected.value.slice(0, start) ||
				change.value.slice(suffixStart) !== expected.value.slice(end)
			) {
				throw new Error("media-picker-document-stale");
			}
			const formatted = formatInsertion
				? formatInsertion(
						expected.value,
						change.value.slice(start, suffixStart),
					)
				: {
						changes: {
							from: start,
							insert: change.value.slice(start, suffixStart),
							to: end,
						},
						selection: change.selection,
						value: change.value,
					};
			if (!formatted.changes) {
				throw new Error("media-picker-insertion-change-missing");
			}
			if (
				!apply(expected, {
					changes: formatted.changes,
					selection: formatted.selection,
					value: formatted.value,
				})
			) {
				throw new Error("media-picker-visual-canonical-change-failed");
			}
		},
		focus: () => {
			if (isActive()) focus();
		},
		getSnapshot: currentSnapshot,
	};
}

export function mediaPickerFailureCode(error: unknown): string {
	return error instanceof Error &&
		/^media-picker-[a-z0-9-]+$/.test(error.message)
		? error.message
		: "media-picker-operation-failed";
}

export function articleMarkupProfile(
	bootstrap: AppearanceBootstrap,
	state: AppearanceState,
): string {
	if ("custom" === state.markdownTheme) return bootstrap.customMarkupProfile;
	const theme = bootstrap.articleThemes.find(
		({ id }) => id === state.markdownTheme,
	);
	if (!theme) {
		throw new Error("appearance-article-theme-markup-profile-missing");
	}
	return theme.markupProfile;
}
