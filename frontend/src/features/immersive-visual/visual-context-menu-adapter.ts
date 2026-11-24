import {
	NodeSelection,
	type Selection,
	TextSelection,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type {
	ImmersiveVisualEditorRuntime,
	VisualCanonicalChangeRequest,
	VisualEditorAcceptedPreview,
	VisualEditorContextMenuTargetLease,
	VisualEditorGeneratedContentKind,
	VisualEditorGeneratedContentTarget,
	VisualEditorGeneratedContentTargetIndex,
	VisualEditorGeneratedImageTarget,
	VisualEditorGeneratedPreviewIdentity,
	VisualEditorImageTargetIndex,
	VisualToolbarCommandOptions,
	VisualToolbarCommandResult,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import type { VisualCanonicalSync } from "./visual-canonical-sync";
import {
	executeVisualToolbarCommand,
	type VisualHistoryCommands,
} from "./visual-commands";
import {
	collectMermaidBlocks,
	contentImages,
	findGeneratedContentOriginal,
	findImageMatchInIndex,
	type GeneratedContentResolution,
	type ImageMatchResolution,
	imageSlotIdentity,
	resolveSelectionForPointerTarget,
	selectionMatchesRange,
} from "./visual-context-menu-target-resolution";

export type ProseMirrorVisualRuntimeOptions = Readonly<{
	disposeSignal?: AbortSignal;
	documentSession: EditorDocumentSession;
	getGeneratedPreviewIdentity?: () => VisualEditorGeneratedPreviewIdentity | null;
	historyCommands?: VisualHistoryCommands;
	isEditable: () => boolean;
	/** Settles composition first, then the canonical sync. */
	settlePendingEdits: () => Promise<boolean>;
	sync: VisualCanonicalSync;
	view: EditorView;
}>;
type TrackedHandle = Readonly<{
	isCurrent: () => boolean;
	release: () => void;
}>;
/**
 * The NodeSelection for a non-empty `anchor`/`head` extent that spans exactly
 * one top-level selectable atom block, or `null` for any other extent.
 */
function topLevelAtomSelectionBetween(
	doc: EditorView["state"]["doc"],
	anchor: number,
	head: number,
): NodeSelection | null {
	if (anchor === head) return null;
	const from = Math.min(anchor, head);
	const to = Math.max(anchor, head);
	const node = doc.nodeAt(from);
	if (
		node &&
		from + node.nodeSize === to &&
		doc.resolve(from).depth === 0 &&
		node.isBlock &&
		node.isAtom &&
		NodeSelection.isSelectable(node)
	) {
		return NodeSelection.create(doc, from);
	}
	return null;
}

function createPinLease<TRoot extends Element, TTarget>(
	handle: TrackedHandle,
	root: TRoot,
	target: TTarget,
): Readonly<{
	getLease: () => Readonly<{
		isCurrent: () => boolean;
		release: () => void;
		root: TRoot;
		target: TTarget;
	}> | null;
	isCurrent: () => boolean;
	release: () => void;
	target: TTarget;
}> {
	return {
		...handle,
		getLease: () =>
			handle.isCurrent()
				? {
						isCurrent: handle.isCurrent,
						release: () => undefined,
						root,
						target,
					}
				: null,
		target,
	};
}

export function createProseMirrorVisualRuntime(
	options: ProseMirrorVisualRuntimeOptions,
): ImmersiveVisualEditorRuntime {
	const {
		disposeSignal,
		documentSession,
		getGeneratedPreviewIdentity,
		historyCommands,
		isEditable: isEditableProp,
		settlePendingEdits,
		sync,
		view,
	} = options;

	let disposed = Boolean(disposeSignal?.aborted);
	const releaseCallbacks = new Set<() => void>();

	const handleDispose = (): void => {
		if (disposed) return;
		disposed = true;
		for (const release of Array.from(releaseCallbacks)) {
			release();
		}
		releaseCallbacks.clear();
	};
	disposeSignal?.addEventListener("abort", handleDispose, { once: true });

	const isLiveEditable = (): boolean =>
		!disposed &&
		view.dom.isConnected &&
		view.editable &&
		isEditableProp() &&
		documentSession.document.isEditable();

	const isIndexCurrent = (revision: number, source: string): boolean =>
		!disposed &&
		view.dom.isConnected &&
		documentSession.document.getRevision() === revision &&
		documentSession.document.getValue() === source;

	const acceptedPreviewFor = (
		revision: number,
		sourceLength: number,
	): VisualEditorAcceptedPreview => {
		const current = getGeneratedPreviewIdentity?.() ?? null;
		return current
			? { revision: current.revision, signature: current.signature }
			: { revision, signature: `prosemirror:${revision}:${sourceLength}` };
	};

	const createTrackedHandle = (predicate: () => boolean): TrackedHandle => {
		let released = false;
		const release = (): void => {
			if (released) return;
			released = true;
			releaseCallbacks.delete(release);
		};
		releaseCallbacks.add(release);
		return { isCurrent: () => !released && predicate(), release };
	};

	const syncDomSelectionToView = (): Selection => {
		// A NodeSelection (image, protected atom, rule) has no faithful DOM range.
		if (view.state.selection instanceof NodeSelection) {
			return view.state.selection;
		}
		const domSelection = view.dom.ownerDocument.defaultView?.getSelection();
		const anchorNode = domSelection?.anchorNode ?? null;
		const focusNode = domSelection?.focusNode ?? null;
		if (
			domSelection &&
			domSelection.rangeCount > 0 &&
			anchorNode &&
			focusNode
		) {
			// Map anchor/focus (not the forward-normalized Range) so a backward
			// selection keeps its direction.
			if (view.dom.contains(anchorNode) && view.dom.contains(focusNode)) {
				try {
					const anchor = view.posAtDOM(anchorNode, domSelection.anchorOffset);
					const head = view.posAtDOM(focusNode, domSelection.focusOffset);
					if (
						anchor >= 0 &&
						head >= 0 &&
						anchor <= view.state.doc.content.size &&
						head <= view.state.doc.content.size
					) {
						// A DOM range spanning exactly one top-level selectable atom
						// block (rule, protected card) maps to that atom's
						// NodeSelection, matching keyboard selection parity.
						const nextSelection =
							topLevelAtomSelectionBetween(view.state.doc, anchor, head) ??
							TextSelection.between(
								view.state.doc.resolve(anchor),
								view.state.doc.resolve(head),
							);
						if (!nextSelection.eq(view.state.selection)) {
							view.dispatch(view.state.tr.setSelection(nextSelection));
						}
						return nextSelection;
					}
				} catch {
					// Fall back to the current ProseMirror selection.
				}
			}
		}
		return view.state.selection;
	};

	const syncCurrentEditableSelection = (): boolean => {
		if (!isLiveEditable() || !sync.settleNow()) return false;
		sync.syncSelection(syncDomSelectionToView());
		return true;
	};

	const buildImageTarget = (
		matchInfo: ImageMatchResolution,
		element: HTMLImageElement,
		index: VisualEditorImageTargetIndex,
	): VisualEditorGeneratedImageTarget => {
		// The rendered slot is the identity the context menu compares against
		// the pointer image (`visualImageSlotIdentity`).
		const slot = imageSlotIdentity(view.dom, element);
		return {
			acceptedPreview: acceptedPreviewFor(index.revision, index.source.length),
			blockId: slot?.blockId ?? matchInfo.blockId,
			ordinal: slot?.ordinal ?? matchInfo.ordinal,
			original: {
				alt: matchInfo.match.alt,
				destination: matchInfo.match.destination,
				end: matchInfo.match.end,
				raw: matchInfo.match.raw,
				start: matchInfo.match.start,
				title: matchInfo.match.title,
			},
			sourceRevision: index.revision,
		};
	};

	const buildGeneratedTarget = (
		kind: VisualEditorGeneratedContentKind,
		resolved: GeneratedContentResolution,
		index: VisualEditorGeneratedContentTargetIndex,
	): VisualEditorGeneratedContentTarget => ({
		acceptedPreview: acceptedPreviewFor(index.revision, index.source.length),
		blockId: resolved.blockId,
		kind,
		ordinal: resolved.ordinal,
		original: resolved.original,
		sourceRevision: index.revision,
	});

	return {
		executeCommand(
			command: ToolbarCommand,
			_options?: VisualToolbarCommandOptions,
		): VisualToolbarCommandResult {
			if (!isLiveEditable()) return "blocked";
			if (command.action === "undo" || command.action === "redo") {
				return sync.history(command.action);
			}
			if (!sync.settleNow()) return "failed";
			const result = executeVisualToolbarCommand(
				view,
				command,
				historyCommands,
			);
			if (result === "handled" && !sync.settleNow()) return "failed";
			return result;
		},

		applyCanonicalChange(
			request: VisualCanonicalChangeRequest,
		): VisualToolbarCommandResult {
			if (!isLiveEditable()) return "blocked";
			return sync.applyCanonicalChange(request);
		},

		getGeneratedPreviewIdentity: () =>
			disposed ? null : (getGeneratedPreviewIdentity?.() ?? null),
		isEditable: isLiveEditable,
		isTransferPending: () => false,
		needsAcceptedPreviewRefresh: () => false,
		refreshAcceptedPreview: () => true,

		prepareContextMenuDemand(): boolean {
			if (disposed) return false;
			return sync.settleNow() && isLiveEditable();
		},

		captureContextMenuTarget(
			target: Element | null,
		): VisualEditorContextMenuTargetLease | null {
			if (
				disposed ||
				!target ||
				!view.dom.isConnected ||
				!view.dom.contains(target)
			) {
				return null;
			}
			const capturedRevision = documentSession.document.getRevision();
			const handle = createTrackedHandle(
				() =>
					!disposed &&
					view.dom.isConnected &&
					target.isConnected &&
					view.dom.contains(target) &&
					documentSession.document.getRevision() === capturedRevision,
			);
			return {
				release: handle.release,
				resolve: () => (handle.isCurrent() ? target : null),
			};
		},

		prepareContextMenuSelection(target, point, activation): boolean {
			if (!isLiveEditable() || !sync.settleNow()) return false;
			const nextSelection = resolveSelectionForPointerTarget(
				view,
				target,
				point,
				activation,
			);
			if (!nextSelection.eq(view.state.selection)) {
				view.dispatch(view.state.tr.setSelection(nextSelection));
			}
			sync.syncSelection(view.state.selection);
			return true;
		},

		settlePendingEdits: () =>
			disposed ? Promise.resolve(false) : settlePendingEdits(),

		prepareMediaSelection: syncCurrentEditableSelection,
		prepareToolbarFallback: syncCurrentEditableSelection,

		prepareImageTarget(request) {
			if (
				!isIndexCurrent(request.index.revision, request.index.source) ||
				!request.element.isConnected ||
				!view.dom.contains(request.element)
			) {
				return null;
			}
			// The element's own slot must match the selection; never borrow a
			// sibling image's source range for this root.
			const elementOrdinal = contentImages(view).indexOf(request.element);
			if (elementOrdinal < 0) return null;
			const matchInfo = findImageMatchInIndex(
				request.index,
				request.selection,
				elementOrdinal,
			);
			if (!matchInfo) return null;
			const target = buildImageTarget(
				matchInfo,
				request.element,
				request.index,
			);
			const handle = createTrackedHandle(
				() =>
					isIndexCurrent(request.index.revision, request.index.source) &&
					request.element.isConnected &&
					view.dom.contains(request.element),
			);
			return { ...handle, root: request.element, target };
		},

		prepareImageTargetBySelection(request) {
			if (!isIndexCurrent(request.index.revision, request.index.source))
				return null;
			const matchInfo = findImageMatchInIndex(request.index, request.selection);
			if (!matchInfo) return null;
			const imageIndex = request.index.images.indexOf(matchInfo.match);
			const rootImage =
				contentImages(view)[imageIndex >= 0 ? imageIndex : matchInfo.ordinal];
			if (!rootImage?.isConnected) return null;
			const target = buildImageTarget(matchInfo, rootImage, request.index);
			const handle = createTrackedHandle(
				() =>
					isIndexCurrent(request.index.revision, request.index.source) &&
					rootImage.isConnected &&
					view.dom.contains(rootImage),
			);
			return createPinLease(handle, rootImage, target);
		},

		prepareGeneratedContentTarget(request) {
			if (
				!isIndexCurrent(request.index.revision, request.index.source) ||
				!request.element.isConnected ||
				!view.dom.contains(request.element)
			) {
				return null;
			}
			const resolved = findGeneratedContentOriginal(
				request.index,
				request.kind,
				request.ordinal,
				request.element,
			);
			if (!resolved) return null;
			const target = buildGeneratedTarget(
				request.kind,
				resolved,
				request.index,
			);
			const handle = createTrackedHandle(
				() =>
					isIndexCurrent(request.index.revision, request.index.source) &&
					request.element.isConnected &&
					view.dom.contains(request.element),
			);
			return { ...handle, root: request.element, target };
		},

		prepareGeneratedContentTargetForSelection(request) {
			if (!isIndexCurrent(request.index.revision, request.index.source))
				return null;
			let kind: VisualEditorGeneratedContentKind | null = null;
			let resolved: GeneratedContentResolution | null = null;
			const mathIdx = request.index.mathSpans.findIndex((span) =>
				selectionMatchesRange(request.selection, span.from, span.to),
			);
			if (mathIdx >= 0) {
				kind = "math";
				resolved = findGeneratedContentOriginal(
					request.index,
					"math",
					mathIdx,
					null,
				);
			} else {
				const mermaidIdx = collectMermaidBlocks(request.index).findIndex(
					(entry) =>
						selectionMatchesRange(request.selection, entry.from, entry.to),
				);
				if (mermaidIdx >= 0) {
					kind = "mermaid";
					resolved = findGeneratedContentOriginal(
						request.index,
						"mermaid",
						mermaidIdx,
						null,
					);
				}
			}
			if (!resolved || !kind) return null;
			const elements = Array.from(
				view.dom.querySelectorAll(
					kind === "math" ? ".easymde-math" : ".easymde-mermaid",
				),
			);
			const sourceOf = (el: Element | undefined) =>
				el?.getAttribute("data-easymde-visual-markdown-source") ?? null;
			const atOrdinal = elements[resolved.ordinal];
			const rootElement =
				atOrdinal &&
				(sourceOf(atOrdinal) === null ||
					sourceOf(atOrdinal) === resolved.original.full)
					? atOrdinal
					: (elements.find((el) => sourceOf(el) === resolved.original.full) ??
						atOrdinal);
			if (!rootElement?.isConnected) return null;
			const target = buildGeneratedTarget(kind, resolved, request.index);
			const handle = createTrackedHandle(
				() =>
					isIndexCurrent(request.index.revision, request.index.source) &&
					rootElement.isConnected &&
					view.dom.contains(rootElement),
			);
			return createPinLease(handle, rootElement, target);
		},

		prepareSourceNavigation(expected): boolean {
			if (disposed || !sync.settleNow()) return false;
			const doc = documentSession.document;
			if (
				doc.getRevision() !== expected.revision ||
				doc.getValue() !== expected.value
			) {
				return false;
			}
			sync.syncSelection(view.state.selection);
			return true;
		},

		focus(): void {
			if (!disposed && view.dom.isConnected) {
				view.focus();
			}
		},

		surface: view.dom,
	};
}
