import { NodeSelection, Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type {
	ImmersiveVisualEditorRuntime,
	VisualCanonicalChangeRequest,
	VisualEditorAcceptedPreview,
	VisualEditorContextMenuTargetLease,
	VisualEditorGeneratedContentKind,
	VisualEditorGeneratedContentOriginal,
	VisualEditorGeneratedContentTarget,
	VisualEditorGeneratedContentTargetIndex,
	VisualEditorGeneratedImageTarget,
	VisualEditorGeneratedPreviewIdentity,
	VisualEditorImageTargetIndex,
	VisualEditorMarkdownImageScaleMatch,
	VisualEditorSelection,
	VisualEditorSourceRange,
	VisualToolbarCommandOptions,
	VisualToolbarCommandResult,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { executeVisualToolbarCommand } from "./visual-commands";
import {
	assertCanonicalChangePrecondition,
	computeVisualSelectionToMarkdownSelection,
} from "./visual-source-mapping";

export type ProseMirrorVisualRuntimeOptions = Readonly<{
	applyExternalCanonicalUpdate: (
		nextMarkdown: string,
		nextRevision: number,
		nextSelection: VisualEditorSelection,
	) => void;
	disposeSignal?: AbortSignal;
	documentSession: EditorDocumentSession;
	flushPendingSync: () => void;
	getGeneratedPreviewIdentity?: () => VisualEditorGeneratedPreviewIdentity | null;
	isEditable: () => boolean;
	onCanonicalDocumentChange?: (markdown: string) => void;
	onMarkdownChange?: (markdown: string) => void;
	runWithEchoSuppressed: <T>(fn: () => T) => T;
	view: EditorView;
}>;

type ImageMatchResolution = Readonly<{
	blockId: string;
	match: VisualEditorMarkdownImageScaleMatch;
	ordinal: number;
}>;

type GeneratedContentResolution = Readonly<{
	blockId: string;
	ordinal: number;
	original: VisualEditorGeneratedContentOriginal;
}>;

type TrackedHandle = Readonly<{
	isCurrent: () => boolean;
	release: () => void;
}>;

const ATOMIC_NODE_NAMES = new Set([
	"horizontal_rule",
	"image",
	"protected_block",
	"protected_inline",
]);

const MERMAID_FENCE_HEADER_PATTERN = /^ {0,3}(?:`{3,}|~{3,})\s*mermaid(?:\s|$)/i;

function sameSelection(left: VisualEditorSelection, right: VisualEditorSelection): boolean {
	return (
		left.start === right.start &&
		left.end === right.end &&
		left.direction === right.direction
	);
}

function syncCanonicalSelectionOnly(
	documentSession: EditorDocumentSession,
	nextSelection: VisualEditorSelection,
	runWithEchoSuppressed: <T>(fn: () => T) => T,
): void {
	const doc = documentSession.document;
	if (sameSelection(doc.getSelection(), nextSelection)) return;
	const docWithOptionalSet = doc as typeof doc & {
		setSelection?: (selection: VisualEditorSelection) => void;
	};
	runWithEchoSuppressed(() => {
		if (typeof docWithOptionalSet.setSelection === "function") {
			docWithOptionalSet.setSelection(nextSelection);
			return;
		}
		doc.applyTextChange({ selection: nextSelection, value: doc.getValue() });
	});
}

function resolvePosForDomElement(view: EditorView, element: Element): number | null {
	try {
		const pos = view.posAtDOM(element, 0);
		return pos >= 0 && pos <= view.state.doc.content.size ? pos : null;
	} catch {
		return null;
	}
}

function resolveAtomicNodeSelection(view: EditorView, element: Element): NodeSelection | null {
	const pos = resolvePosForDomElement(view, element);
	if (pos === null) return null;
	for (const candidatePos of [pos, pos - 1]) {
		if (candidatePos < 0 || candidatePos >= view.state.doc.content.size) continue;
		const node = view.state.doc.nodeAt(candidatePos);
		if (node && ATOMIC_NODE_NAMES.has(node.type.name)) {
			try {
				return NodeSelection.create(view.state.doc, candidatePos);
			} catch {
				// Try next candidate position.
			}
		}
	}
	return null;
}

function resolveSelectionForPointerTarget(
	view: EditorView,
	target: Element | null | undefined,
	point: Readonly<{ x: number; y: number }> | undefined,
	activation: "keyboard" | "pointer" | undefined,
): Selection {
	const currentSelection = view.state.selection;
	if (activation === "keyboard") return currentSelection;

	if (target && view.dom.contains(target)) {
		const atomicTarget =
			(target instanceof HTMLImageElement ? target : target.closest("img")) ??
			target.closest("[data-easymde-protected-block], [data-easymde-protected-inline]") ??
			target.closest("hr");
		if (atomicTarget && view.dom.contains(atomicTarget)) {
			const atomicSel = resolveAtomicNodeSelection(view, atomicTarget);
			if (atomicSel) return atomicSel;
		}
	}

	if (!currentSelection.empty) return currentSelection;

	if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
		const coords = view.posAtCoords({ left: point.x, top: point.y });
		if (coords && coords.pos >= 0 && coords.pos <= view.state.doc.content.size) {
			if (coords.inside >= 0) {
				const insideNode = view.state.doc.nodeAt(coords.inside);
				if (insideNode && ATOMIC_NODE_NAMES.has(insideNode.type.name)) {
					try {
						return NodeSelection.create(view.state.doc, coords.inside);
					} catch {
						// Fall through to nearest selection.
					}
				}
			}
			return Selection.near(view.state.doc.resolve(coords.pos));
		}
	}

	if (target && view.dom.contains(target)) {
		const domPos = resolvePosForDomElement(view, target);
		if (domPos !== null) return Selection.near(view.state.doc.resolve(domPos));
	}
	return currentSelection;
}

function selectionMatchesRange(
	selection: VisualEditorSourceRange,
	rangeStart: number,
	rangeEnd: number,
): boolean {
	return selection.start === selection.end
		? selection.start >= rangeStart && selection.start <= rangeEnd
		: selection.start >= rangeStart && selection.end <= rangeEnd;
}

function findImageMatchInIndex(
	index: VisualEditorImageTargetIndex,
	selection: VisualEditorSourceRange,
	elementOrdinal?: number,
): ImageMatchResolution | null {
	let globalOrdinal = 0;
	for (let blockIdx = 0; blockIdx < index.blockImages.length; blockIdx += 1) {
		const blockEntry = index.blockImages[blockIdx];
		if (blockEntry?.status !== "ready") continue;
		for (let imgIdx = 0; imgIdx < blockEntry.images.length; imgIdx += 1) {
			const match = blockEntry.images[imgIdx];
			if (!match) continue;
			if (
				selectionMatchesRange(selection, match.start, match.end) &&
				(elementOrdinal === undefined || globalOrdinal === elementOrdinal)
			) {
				return { blockId: `pm-block-${blockIdx}`, match, ordinal: imgIdx };
			}
			globalOrdinal += 1;
		}
	}
	for (let i = 0; i < index.images.length; i += 1) {
		const match = index.images[i];
		if (match && selectionMatchesRange(selection, match.start, match.end)) {
			return { blockId: "pm-block-0", match, ordinal: i };
		}
	}
	return null;
}

function collectMermaidBlocks(
	index: VisualEditorGeneratedContentTargetIndex,
): ReadonlyArray<Readonly<{ blockIdx: number; from: number; to: number }>> {
	const results: Array<Readonly<{ blockIdx: number; from: number; to: number }>> = [];
	for (let i = 0; i < index.blocks.length; i += 1) {
		const block = index.blocks[i];
		if (block?.kind !== "code") continue;
		if (MERMAID_FENCE_HEADER_PATTERN.test(index.source.slice(block.from, block.to))) {
			results.push({ blockIdx: i, from: block.from, to: block.to });
		}
	}
	return results;
}

function extractMermaidOriginal(
	source: string,
	from: number,
	to: number,
): VisualEditorGeneratedContentOriginal | null {
	if (from < 0 || to > source.length || from >= to) return null;
	const full = source.slice(from, to);
	const firstNl = full.indexOf("\n");
	const lastNl = full.lastIndexOf("\n");
	if (firstNl < 0 || lastNl <= firstNl) {
		return { body: full, bodyRange: { from, to }, full, fullRange: { from, to } };
	}
	const bodyFrom = from + firstNl + 1;
	const bodyTo = from + lastNl;
	return {
		body: source.slice(bodyFrom, bodyTo),
		bodyRange: { from: bodyFrom, to: bodyTo },
		full,
		fullRange: { from, to },
	};
}

function findGeneratedContentOriginal(
	index: VisualEditorGeneratedContentTargetIndex,
	kind: VisualEditorGeneratedContentKind,
	ordinal: number,
	element: Element | null,
): GeneratedContentResolution | null {
	const source = index.source;
	const domRaw = element?.getAttribute("data-easymde-visual-markdown-source") ?? null;

	if (kind === "math") {
		const matchedIdx =
			domRaw !== null
				? index.mathSpans.findIndex((span) => source.slice(span.from, span.to) === domRaw)
				: -1;
		const resolvedIdx = matchedIdx >= 0 ? matchedIdx : ordinal;
		const span = index.mathSpans[resolvedIdx];
		if (!span) return null;
		return {
			blockId: `pm-math-${resolvedIdx}`,
			ordinal: resolvedIdx,
			original: {
				body: source.slice(span.bodyFrom, span.bodyTo),
				bodyRange: { from: span.bodyFrom, to: span.bodyTo },
				full: source.slice(span.from, span.to),
				fullRange: { from: span.from, to: span.to },
			},
		};
	}

	const mermaidBlocks = collectMermaidBlocks(index);
	const matchedIdx =
		domRaw !== null
			? mermaidBlocks.findIndex((entry) => source.slice(entry.from, entry.to) === domRaw)
			: -1;
	const resolvedIdx = matchedIdx >= 0 ? matchedIdx : ordinal;
	const entry = mermaidBlocks[resolvedIdx];
	if (!entry) return null;
	const original = extractMermaidOriginal(source, entry.from, entry.to);
	return original
		? { blockId: `pm-block-${entry.blockIdx}`, ordinal: resolvedIdx, original }
		: null;
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
				? { isCurrent: handle.isCurrent, release: () => undefined, root, target }
				: null,
		target,
	};
}

export function createProseMirrorVisualRuntime(
	options: ProseMirrorVisualRuntimeOptions,
): ImmersiveVisualEditorRuntime {
	const {
		applyExternalCanonicalUpdate,
		disposeSignal,
		documentSession,
		flushPendingSync,
		getGeneratedPreviewIdentity,
		isEditable: isEditableProp,
		onCanonicalDocumentChange,
		onMarkdownChange,
		runWithEchoSuppressed,
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

	const syncSelectionFromView = (selection: Selection): void => {
		const mapped = computeVisualSelectionToMarkdownSelection(
			view.state.doc,
			selection,
			documentSession.document.getValue(),
		);
		syncCanonicalSelectionOnly(documentSession, mapped, runWithEchoSuppressed);
	};

	const syncCurrentEditableSelection = (): boolean => {
		if (!isLiveEditable()) return false;
		flushPendingSync();
		syncSelectionFromView(view.state.selection);
		return true;
	};

	const buildImageTarget = (
		matchInfo: ImageMatchResolution,
		element: HTMLImageElement,
		index: VisualEditorImageTargetIndex,
	): VisualEditorGeneratedImageTarget => {
		const domBlockId = element
			.closest("[data-easymde-visual-block-id]")
			?.getAttribute("data-easymde-visual-block-id");
		return {
			acceptedPreview: acceptedPreviewFor(index.revision, index.source.length),
			blockId: domBlockId && domBlockId.length > 0 ? domBlockId : matchInfo.blockId,
			ordinal: matchInfo.ordinal,
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
			const result = executeVisualToolbarCommand(view, command);
			if (result === "handled") flushPendingSync();
			return result;
		},

		applyCanonicalChange(request: VisualCanonicalChangeRequest): VisualToolbarCommandResult {
			if (!isLiveEditable()) return "blocked";
			flushPendingSync();
			const doc = documentSession.document;
			const precondition = assertCanonicalChangePrecondition(
				request,
				doc.getRevision(),
				doc.getValue(),
				doc.getSelection(),
			);
			if (!precondition.ok) return "blocked";

			try {
				runWithEchoSuppressed(() => {
					doc.applyTextChange({
						changes: request.change.changes,
						selection: request.change.selection,
						value: request.change.value,
					});
				});
				const nextValue = doc.getValue();
				applyExternalCanonicalUpdate(nextValue, doc.getRevision(), request.change.selection);
				onMarkdownChange?.(nextValue);
				onCanonicalDocumentChange?.(nextValue);
				return "handled";
			} catch {
				return "failed";
			}
		},

		getGeneratedPreviewIdentity: () =>
			disposed ? null : (getGeneratedPreviewIdentity?.() ?? null),
		isEditable: isLiveEditable,
		isTransferPending: () => false,
		needsAcceptedPreviewRefresh: () => false,
		refreshAcceptedPreview: () => true,

		prepareContextMenuDemand(): boolean {
			if (disposed) return false;
			flushPendingSync();
			return isLiveEditable();
		},

		captureContextMenuTarget(target: Element | null): VisualEditorContextMenuTargetLease | null {
			if (disposed || !target || !view.dom.isConnected || !view.dom.contains(target)) {
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
			return { release: handle.release, resolve: () => (handle.isCurrent() ? target : null) };
		},

		prepareContextMenuSelection(target, point, activation): boolean {
			if (!isLiveEditable()) return false;
			flushPendingSync();
			syncSelectionFromView(resolveSelectionForPointerTarget(view, target, point, activation));
			return true;
		},

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
			const elementOrdinal = Array.from(view.dom.querySelectorAll("img")).indexOf(request.element);
			const matchInfo =
				findImageMatchInIndex(
					request.index,
					request.selection,
					elementOrdinal >= 0 ? elementOrdinal : undefined,
				) ?? findImageMatchInIndex(request.index, request.selection);
			if (!matchInfo) return null;
			const target = buildImageTarget(matchInfo, request.element, request.index);
			const handle = createTrackedHandle(
				() =>
					isIndexCurrent(request.index.revision, request.index.source) &&
					request.element.isConnected &&
					view.dom.contains(request.element),
			);
			return { ...handle, root: request.element, target };
		},

		prepareImageTargetBySelection(request) {
			if (!isIndexCurrent(request.index.revision, request.index.source)) return null;
			const matchInfo = findImageMatchInIndex(request.index, request.selection);
			if (!matchInfo) return null;
			const imageIndex = request.index.images.indexOf(matchInfo.match);
			const rootImage = Array.from(view.dom.querySelectorAll("img"))[
				imageIndex >= 0 ? imageIndex : matchInfo.ordinal
			];
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
			const target = buildGeneratedTarget(request.kind, resolved, request.index);
			const handle = createTrackedHandle(
				() =>
					isIndexCurrent(request.index.revision, request.index.source) &&
					request.element.isConnected &&
					view.dom.contains(request.element),
			);
			return { ...handle, root: request.element, target };
		},

		prepareGeneratedContentTargetForSelection(request) {
			if (!isIndexCurrent(request.index.revision, request.index.source)) return null;
			let kind: VisualEditorGeneratedContentKind | null = null;
			let resolved: GeneratedContentResolution | null = null;
			const mathIdx = request.index.mathSpans.findIndex((span) =>
				selectionMatchesRange(request.selection, span.from, span.to),
			);
			if (mathIdx >= 0) {
				kind = "math";
				resolved = findGeneratedContentOriginal(request.index, "math", mathIdx, null);
			} else {
				const mermaidIdx = collectMermaidBlocks(request.index).findIndex((entry) =>
					selectionMatchesRange(request.selection, entry.from, entry.to),
				);
				if (mermaidIdx >= 0) {
					kind = "mermaid";
					resolved = findGeneratedContentOriginal(request.index, "mermaid", mermaidIdx, null);
				}
			}
			if (!resolved || !kind) return null;
			const elements = Array.from(
				view.dom.querySelectorAll(kind === "math" ? ".easymde-math" : ".easymde-mermaid"),
			);
			const rootElement =
				elements.find(
					(el) => el.getAttribute("data-easymde-visual-markdown-source") === resolved.original.full,
				) ?? elements[resolved.ordinal];
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
			if (disposed) return false;
			flushPendingSync();
			const doc = documentSession.document;
			if (doc.getRevision() !== expected.revision || doc.getValue() !== expected.value) {
				return false;
			}
			syncSelectionFromView(view.state.selection);
			return true;
		},

		surface: view.dom,
	};
}
