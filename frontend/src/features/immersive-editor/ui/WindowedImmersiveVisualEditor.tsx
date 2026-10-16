import { useLayoutEffect, useRef } from "@wordpress/element";

import type { PreviewEditMap } from "../../../contracts/ports/preview-request";
import {
	isMarkdownTerminalWhitespaceSuffix,
	markdownLineStarts,
} from "../../../shared/markdown/markdown-line-model";
import type {
	DocumentHistoryState,
	DocumentSelection,
} from "../../document-source/adapters/code-mirror-document-session";
import {
	applyVisualBlockShortcut,
	applyVisualInlineShortcut,
	applyVisualMarkdownEditIntent,
	applyVisualToolbarCommand,
	assertVisualMarkdownReadOnlySnapshot,
	captureVisualSelection,
	captureVisualCodeInputSnapshot,
	captureVisualMarkdownReadOnlySnapshot,
	captureVisualThematicBreakSelection,
	classifyVisualSelectionProvenance,
	mergeVisualMarkdownChangeDetails,
	normalizeVisualCaretAtDocumentBoundary,
	normalizeVisualCodePlaceholders,
	projectVisualCodeBodySelection,
	protectVisualMarkdownReadOnlyRegions,
	reconcileVisualCodeBodyDom,
	restoreVisualCodeFenceFamilies,
	restoreVisualSelection,
	selectVisualImageForContextMenu,
	serializeVisualMarkdownBlockFragment,
	VISUAL_MARKDOWN_READ_ONLY_SELECTOR,
	type VisualCodeInputSnapshot,
	type VisualMarkdownReadOnlySnapshot,
	type VisualSelectionSnapshot,
	visualCaretBoundaryFromSourceOffset,
	visualBoundarySourceOffset,
	visualCodeBodyDomOffset,
	visualCodeBodyDomText,
	visualCodeBodyIntervalAtOrdinal,
	visualCodeBodyOrdinalForSourceRange,
	visualSelectionSourceRangeForBlocks,
	visualThematicBreakSourceSelection,
	visualContextMenuCaretRangeAtPoint,
} from "../visual-markdown";
import type {
	ImmersiveVisualEditorProps,
	ImmersiveVisualEditorRuntime,
	ImmersiveWindowAcceptedSnapshot,
} from "./ImmersiveVisualEditor";
import { assertVisualCanonicalChangeRequest } from "./ImmersiveVisualEditor";

const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";
const VISUAL_FENCE_ATTRIBUTE = "data-easymde-visual-fence";
const VISUAL_FENCE_INFO_ATTRIBUTE = "data-easymde-visual-fence-info";
const VISUAL_FENCE_OPEN_EOF_ATTRIBUTE = "data-easymde-visual-fence-open-eof";

function visualSelectionEqual(
	left: VisualSelectionSnapshot,
	right: VisualSelectionSnapshot,
): boolean {
	return (
		left.anchorNode === right.anchorNode &&
		left.anchorOffset === right.anchorOffset &&
		left.backward === right.backward &&
		left.focusNode === right.focusNode &&
		left.focusOffset === right.focusOffset
	);
}
const WINDOW_SPACER_ATTRIBUTE = "data-easymde-preview-window-spacer";

type Props = ImmersiveVisualEditorProps &
	Readonly<{
		acceptedWindowSnapshotGeneration?: number;
		editMap: PreviewEditMap;
		getAcceptedWindowSnapshot?: () => ImmersiveWindowAcceptedSnapshot | null;
		prepareWindowBlockAdoption: (node: HTMLElement) => (() => boolean) | null;
		requestPreviewAtDocumentEnd: (
			markdown: string,
			sourceSelection?: Readonly<{ end: number; start: number }>,
		) => Readonly<{
			onSelectionRestored?: () => void;
			release: () => void;
			signature: string;
		}>;
	}>;

type MutableBlockRange = {
	baseEnd: number;
	baseStart: number;
	editable: boolean;
	id: string;
	index: number;
};

type EffectiveBlockRange = MutableBlockRange &
	Readonly<{
		end: number;
		start: number;
	}>;

type WindowBlockSnapshot = Readonly<{
	attributes: ReadonlyArray<Readonly<{ name: string; value: string }>>;
	innerHTML: string;
	node: HTMLElement;
}>;

type WindowSelectionBoundary = Readonly<{
	blockIndex: number;
	node?: Node;
	nodePath: ReadonlyArray<number>;
	offset: number;
	parent?: ParentNode;
	textData?: string;
}>;

type WindowSelectionSnapshot = Readonly<{
	anchor: WindowSelectionBoundary;
	focus: WindowSelectionBoundary;
}>;

class SourceRangeLedger {
	private readonly byId = new Map<string, MutableBlockRange>();
	private readonly shifts: number[];

	constructor(ranges: ReadonlyArray<MutableBlockRange>) {
		this.shifts = new Array(ranges.length + 1).fill(0);
		ranges.forEach((range) => {
			this.byId.set(range.id, range);
		});
	}

	get(id: string): EffectiveBlockRange | null {
		const range = this.byId.get(id);
		if (!range) return null;
		return {
			...range,
			end: range.baseEnd + this.prefix(range.index + 1),
			start: range.baseStart + this.prefix(range.index),
		};
	}

	get size(): number {
		return this.byId.size;
	}

	applyDelta(index: number, delta: number): void {
		for (
			let cursor = index + 1;
			cursor < this.shifts.length;
			cursor += cursor & -cursor
		) {
			this.shifts[cursor] = (this.shifts[cursor] ?? 0) + delta;
		}
	}

	hasEditableAfter(index: number): boolean {
		return Array.from(this.byId.values()).some(
			(range) => range.index > index && range.editable,
		);
	}

	private prefix(end: number): number {
		let total = 0;
		for (let cursor = end; cursor > 0; cursor -= cursor & -cursor) {
			total += this.shifts[cursor] ?? 0;
		}
		return total;
	}
}

type ActiveRegion = Readonly<{
	after: Node | null;
	baseline: string;
	blockSnapshots: ReadonlyArray<WindowBlockSnapshot>;
	before: Node | null;
	blockEnd: number;
	blockStart: number;
	blocks: ReadonlyArray<HTMLElement>;
	readOnlySnapshot: VisualMarkdownReadOnlySnapshot;
	selection: WindowSelectionSnapshot;
	sourceEnd: number;
	sourceStart: number;
}>;

type PendingHistorySelection = Readonly<{
	historyState: DocumentHistoryState;
	markdown: string;
	onDocumentEndSelectionRestored: (() => void) | null;
	releaseDocumentEndPin: (() => void) | null;
	restoreFocus: boolean;
	selection: DocumentSelection;
	signature: string;
	thematicBreakGap?: WindowedThematicBreakGap;
}>;

type DeletionDirection = "backward" | "forward";

type CommitOptions = Readonly<{
	allowSingleBlockStructural?: boolean;
}>;

type FormalPreviewOptions = Readonly<{
	pinWindowSelection?: boolean;
	pinSourceSelection?: Readonly<{ end: number; start: number }>;
}>;

type WindowedThematicBreakGap = Readonly<{
	afterBlockId: string | null;
	afterBlockSource?: string;
	afterMarkdown: string;
	beforeBlockId: string | null;
	beforeBlockSource?: string;
	beforeMarkdown: string;
	gap: string;
	postSelection: DocumentSelection;
	sourceSelection: DocumentSelection;
	windowSelection?: Readonly<{ end: number; start: number }>;
}>;

type WindowedThematicBreakPreparation = Readonly<{
	afterRange: EffectiveBlockRange | null;
	beforeRange: EffectiveBlockRange | null;
	range: EffectiveBlockRange;
	selection: DocumentSelection;
	source: string;
}>;

type WindowedCodeBodyInputIntent = Readonly<{
	blockId: string;
	code: HTMLElement;
	codeTextBefore: string;
	data: string | null;
	directBodyEdit: boolean;
	initialEmptyBody: boolean;
	inputType: string;
	lineEnding: string;
	pre: HTMLElement;
	recoveredCode: HTMLElement | null;
	sourceCodeSnapshot: HTMLElement;
	sourcePrefix: string;
	sourceSelection: Readonly<{ end: number; start: number }>;
	visualBodyStart: number;
	visualSelection: Readonly<{ end: number; start: number }>;
}>;

function releasePendingHistorySelection(pending: {
	current: PendingHistorySelection | null;
}): void {
	const previous = pending.current;
	pending.current = null;
	previous?.releaseDocumentEndPin?.();
}

function sameDocumentSelection(
	left: DocumentSelection,
	right: DocumentSelection,
): boolean {
	return (
		left.direction === right.direction &&
		left.end === right.end &&
		left.start === right.start
	);
}

function sameDocumentHistoryState(
	left: DocumentHistoryState,
	right: DocumentHistoryState,
): boolean {
	return (
		left.redoDepth === right.redoDepth && left.undoDepth === right.undoDepth
	);
}

type CodeBodyTextDelta = Readonly<{
	end: number;
	replacement: string;
	start: number;
}>;

function codeBodyTextDelta(
	before: string,
	after: string,
): CodeBodyTextDelta | null {
	let start = 0;
	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	)
		start += 1;
	if (start === before.length && start === after.length) return null;

	let beforeEnd = before.length;
	let afterEnd = after.length;
	while (
		beforeEnd > start &&
		afterEnd > start &&
		before[beforeEnd - 1] === after[afterEnd - 1]
	) {
		beforeEnd -= 1;
		afterEnd -= 1;
	}
	return {
		end: beforeEnd,
		replacement: after.slice(start, afterEnd),
		start,
	};
}

function sourceLineEndingBefore(markdown: string, offset: number): string {
	const previous = markdown[offset - 1];
	if ("\n" === previous) {
		return "\r" === markdown[offset - 2] ? "\r\n" : "\n";
	}
	return "\r" === previous ? "\r" : "\n";
}

function unwrapWindowedCodePlaceholder(
	inputBlock: VisualCodeInputSnapshot | null,
): void {
	const placeholder = inputBlock?.placeholder;
	if (!placeholder?.isConnected || "" === placeholder.textContent) return;
	const text = placeholder.firstChild;
	if (1 !== placeholder.childNodes.length || !(text instanceof Text)) {
		throw new Error("visual-editor-code-placeholder-invalid");
	}
	const selection = placeholder.ownerDocument.defaultView?.getSelection();
	const restoreSelection = Boolean(
		selection?.anchorNode === text && selection.focusNode === text,
	);
	const anchorOffset = selection?.anchorOffset ?? 0;
	const focusOffset = selection?.focusOffset ?? 0;
	placeholder.replaceWith(text);
	if (restoreSelection) {
		selection?.setBaseAndExtent(text, anchorOffset, text, focusOffset);
	}
}

function documentSelectionDirection(
	selection: Selection,
): DocumentSelection["direction"] {
	if (selection.isCollapsed) return "none";
	const anchorNode = selection.anchorNode;
	const focusNode = selection.focusNode;
	if (!anchorNode || !focusNode) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const documentRef = anchorNode.ownerDocument;
	if (!documentRef) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const anchor = documentRef.createRange();
	anchor.setStart(anchorNode, selection.anchorOffset);
	anchor.collapse(true);
	const focus = documentRef.createRange();
	focus.setStart(focusNode, selection.focusOffset);
	focus.collapse(true);
	return anchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0
		? "forward"
		: "backward";
}

const WINDOWED_CODE_BODY_INPUT_TYPES: ReadonlySet<string> = new Set([
	"deleteByCut",
	"deleteContentBackward",
	"deleteContentForward",
	"deleteWordBackward",
	"deleteWordForward",
	"insertCompositionText",
	"insertFromComposition",
	"insertLineBreak",
	"insertParagraph",
	"insertReplacementText",
	"insertText",
]);
const WINDOWED_CODE_BODY_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteByCut",
	"deleteContentBackward",
	"deleteContentForward",
	"deleteWordBackward",
	"deleteWordForward",
]);
const WINDOWED_WHOLE_DOCUMENT_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteContentForward",
]);
const WINDOWED_THEMATIC_BREAK_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteContentForward",
]);

function windowedCodeBodyInputIntent(
	event: InputEvent,
	inputBlock: VisualCodeInputSnapshot | null,
	region: ActiveRegion,
	sourceSlice: string,
	fallbackLineEnding: string,
	onDiagnostic: (code: string) => void,
): WindowedCodeBodyInputIntent | null {
	const codeBodyIsEmpty = Boolean(
		inputBlock && /^\n*$/.test(inputBlock.codeText.replace(/\r\n/g, "\n")),
	);
	if (
		!inputBlock ||
		inputBlock.placeholder ||
		!WINDOWED_CODE_BODY_INPUT_TYPES.has(event.inputType)
	)
		return null;
	if (1 !== region.blocks.length || region.blocks[0] !== inputBlock.pre) {
		throw new Error("visual-editor-code-body-map-stale");
	}
	const blockId = inputBlock.pre.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
	if (!blockId) throw new Error("visual-editor-code-body-map-stale");

	const targetRange = event.getTargetRanges?.()[0];
	const selection = inputBlock.code.ownerDocument.defaultView?.getSelection();
	const startNode = targetRange?.startContainer ?? selection?.anchorNode;
	const endNode = targetRange?.endContainer ?? selection?.focusNode;
	const startOffset = targetRange?.startOffset ?? selection?.anchorOffset;
	const endOffset = targetRange?.endOffset ?? selection?.focusOffset;
	if (
		!startNode ||
		!endNode ||
		undefined === startOffset ||
		undefined === endOffset
	) {
		throw new Error("visual-editor-code-body-selection-unavailable");
	}
	let projection: ReturnType<typeof projectVisualCodeBodySelection>;
	try {
		projection = projectVisualCodeBodySelection(
			inputBlock.code,
			sourceSlice,
			region.baseline,
			0,
			{
				end: { node: endNode, offset: endOffset },
				start: { node: startNode, offset: startOffset },
			},
		);
	} catch (error) {
		try {
			visualCodeBodyIntervalAtOrdinal(sourceSlice, 0);
		} catch {
			onDiagnostic("visual-editor-code-body-source-interval-invalid");
		}
		try {
			visualCodeBodyIntervalAtOrdinal(region.baseline, 0);
		} catch {
			onDiagnostic("visual-editor-code-body-visual-baseline-interval-invalid");
		}
		throw error;
	}
	const lineEnding =
		projection.sourceInterval.lineEnding ||
		sourceSlice.match(/\r\n|\r|\n/)?.[0] ||
		fallbackLineEnding;
	const sourceOpening = sourceSlice.slice(
		projection.sourceInterval.sourceBlockStart,
		projection.sourceInterval.bodyStart,
	);
	const sourcePrefix =
		"" === projection.sourceText && !/(?:\r\n|\r|\n)$/u.test(sourceOpening)
			? lineEnding
			: "";
	const isBodyDeletion = WINDOWED_CODE_BODY_DELETION_TYPES.has(event.inputType);
	return {
		blockId,
		code: inputBlock.code,
		codeTextBefore: inputBlock.codeText,
		data: event.data,
		directBodyEdit:
			codeBodyIsEmpty ||
			"insertParagraph" === event.inputType ||
			"insertLineBreak" === event.inputType ||
			isBodyDeletion,
		initialEmptyBody: "" === projection.sourceText,
		inputType: event.inputType,
		lineEnding,
		pre: inputBlock.pre,
		recoveredCode: null,
		sourceCodeSnapshot: inputBlock.code.cloneNode(true) as HTMLElement,
		sourcePrefix,
		sourceSelection: projection.sourceSelection,
		visualBodyStart: projection.visualInterval.bodyStart,
		visualSelection: projection.visualSelection,
	};
}

function inferWindowedCodeBodyDeletionSelection(
	input: WindowedCodeBodyInputIntent,
	sourceMarkdown: string,
	visualMarkdown: string,
): Readonly<{
	sourceSelection: Readonly<{ end: number; start: number }>;
	visualSelection: Readonly<{ end: number; start: number }>;
}> {
	if (input.sourceSelection.start < input.sourceSelection.end) {
		return {
			sourceSelection: input.sourceSelection,
			visualSelection: input.visualSelection,
		};
	}
	const after = visualCodeBodyDomText(input.code);
	const delta = codeBodyTextDelta(input.codeTextBefore, after);
	if (!delta) {
		return {
			sourceSelection: input.sourceSelection,
			visualSelection: input.visualSelection,
		};
	}
	const removedLength = input.codeTextBefore.length - after.length;
	if (
		removedLength <= 0 ||
		delta.start >= delta.end ||
		"" !== delta.replacement ||
		delta.end - delta.start !== removedLength
	) {
		throw new Error("visual-editor-code-body-selection-invalid");
	}
	const domSelection = input.code.ownerDocument.defaultView?.getSelection();
	if (!domSelection?.isCollapsed || !domSelection.anchorNode) {
		throw new Error("visual-editor-code-body-selection-invalid");
	}
	const caretOffset = visualCodeBodyDomOffset(input.code, {
		node: domSelection.anchorNode,
		offset: domSelection.anchorOffset,
	});
	if (null === caretOffset) {
		throw new Error("visual-editor-code-body-selection-invalid");
	}
	const endOffset = caretOffset + removedLength;
	if (
		caretOffset < 0 ||
		endOffset > input.codeTextBefore.length ||
		input.codeTextBefore.slice(0, caretOffset) +
			input.codeTextBefore.slice(endOffset) !==
			after
	) {
		throw new Error("visual-editor-code-body-selection-invalid");
	}
	if (
		visualCodeBodyDomText(input.sourceCodeSnapshot) !== input.codeTextBefore
	) {
		throw new Error("visual-editor-code-body-map-stale");
	}
	const projection = projectVisualCodeBodySelection(
		input.sourceCodeSnapshot,
		sourceMarkdown,
		visualMarkdown,
		0,
		{
			end: codeBodyDomBoundaryAtOffset(input.sourceCodeSnapshot, endOffset),
			start: codeBodyDomBoundaryAtOffset(input.sourceCodeSnapshot, caretOffset),
		},
	);
	if (
		projection.sourceSelection.start >= projection.sourceSelection.end ||
		projection.visualSelection.start >= projection.visualSelection.end
	) {
		throw new Error("visual-editor-code-body-selection-invalid");
	}
	return {
		sourceSelection: projection.sourceSelection,
		visualSelection: projection.visualSelection,
	};
}

function reconcileWindowedCodeBodyDom(
	input: WindowedCodeBodyInputIntent,
	expectedBody: string,
	caretOffset: number,
): void {
	const codeChildren = Array.from(input.pre.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement && "CODE" === child.tagName,
	);
	const code =
		codeChildren.find((child) => child === input.code) ?? codeChildren[0];
	if (!code) throw new Error("visual-editor-code-child-missing");
	if (codeChildren.length > 1) {
		if ("insertParagraph" !== input.inputType || 2 !== codeChildren.length) {
			throw new Error("visual-editor-code-shape-invalid");
		}
		for (const sibling of codeChildren) {
			if (sibling !== code) sibling.remove();
		}
	}
	reconcileVisualCodeBodyDom(code, expectedBody, caretOffset);
}

function isWindowedParagraphCodeSplit(
	input: WindowedCodeBodyInputIntent,
): boolean {
	if ("insertParagraph" !== input.inputType) return false;
	const codes = Array.from(input.pre.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement && "CODE" === child.tagName,
	);
	if (2 !== codes.length) return false;
	const originalAttributes = Array.from(input.sourceCodeSnapshot.attributes);
	if (
		codes.some(
			(code) =>
				code.attributes.length !== originalAttributes.length ||
				originalAttributes.some(
					({ name, value }) => code.getAttribute(name) !== value,
				),
		)
	)
		return false;
	if (
		codes.map((code) => code.textContent ?? "").join("") !==
		input.codeTextBefore
	) {
		return false;
	}
	const selection = input.pre.ownerDocument.defaultView?.getSelection();
	const secondCode = codes[1];
	if (!selection?.isCollapsed || !selection.anchorNode || !secondCode)
		return false;
	return (
		0 ===
		visualCodeBodyDomOffset(secondCode, {
			node: selection.anchorNode,
			offset: selection.anchorOffset,
		})
	);
}

function focusSurface(surface: HTMLElement): void {
	surface.focus({ preventScroll: true });
}

function placeContextMenuCaret(
	surface: HTMLElement,
	target: Element | null,
	point?: Readonly<{ x: number; y: number }>,
): boolean {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection) throw new Error("visual-editor-window-selection-invalid");
	const range = visualContextMenuCaretRangeAtPoint(surface, target, point);
	if (!range) return false;
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}

/**
 * A menu refresh can replay a target element that an accepted Preview window
 * re-render already replaced. Re-resolve the equivalent live element through
 * the replayed target's visual block identity so the refresh still prepares
 * the original image target instead of leaving the surface-level selection
 * behind.
 */
function visualBlockImages(block: Element): HTMLImageElement[] {
  return Array.from(block.querySelectorAll("img")).filter(
    (image): image is HTMLImageElement =>
      image instanceof HTMLImageElement
      && image.closest(`[${VISUAL_BLOCK_ATTRIBUTE}]`) === block,
  );
}

type ContextMenuTargetSnapshotIdentity = Readonly<{
  key: number;
  revision: number;
  signature: string;
}>;

type ContextMenuInlineTargetKind = "link" | "math" | "mermaid";

type ContextMenuTargetIdentity = Readonly<{
  blockId: string | null;
  imageOrdinal: number | null;
  inlinePath: ReadonlyArray<number> | null;
  inlineKind: ContextMenuInlineTargetKind | null;
  inlineSignature: string | null;
  snapshot: ContextMenuTargetSnapshotIdentity | null;
}>;

function contextMenuTargetSnapshotStillMatches(
  recorded: ContextMenuTargetSnapshotIdentity | null,
  current: ContextMenuTargetSnapshotIdentity | null,
): boolean {
  // The window commit key changes on every accepted re-render, while the
  // revision and signature identify the document state that the recorded
  // target belongs to. A cleared identity means no accepted window commit is
  // installed at this instant, so there is no positive evidence of a mismatch;
  // the pending demand's own captured surface snapshot remains the
  // document-state authority for the replay.
  if (!recorded || !current) return true;
  return (
    recorded.revision === current.revision
    && recorded.signature === current.signature
  );
}

function contextMenuTargetIdentity(
  target: Element,
  snapshot: ContextMenuTargetSnapshotIdentity | null,
): ContextMenuTargetIdentity {
  const block = target.closest(`[${VISUAL_BLOCK_ATTRIBUTE}]`);
  const image =
    target instanceof HTMLImageElement ? target : target.closest("img");
  const ordinal = block && image ? visualBlockImages(block).indexOf(image) : -1;
  const inlineTarget = target.closest<HTMLElement>(
    "a, .easymde-math, .easymde-mermaid",
  );
  const inlineKind = inlineTarget?.matches("a")
    ? "link"
    : inlineTarget?.matches(".easymde-math")
      ? "math"
      : inlineTarget?.matches(".easymde-mermaid")
        ? "mermaid"
        : null;
  const inlinePath = (() => {
    if (!block || !inlineTarget || !inlineKind) return null;
    const path: number[] = [];
    let current: Node = inlineTarget;
    while (current !== block) {
      const parent = current.parentNode;
      if (!parent) return null;
      const index = Array.prototype.indexOf.call(parent.childNodes, current);
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }
    return path;
  })();
  const inlineSignature = inlineTarget && inlineKind === "link"
    ? inlineTarget.getAttribute("href") ?? inlineTarget.textContent ?? ""
    : inlineTarget && inlineKind
      ? inlineTarget.getAttribute("data-easymde-generated-source")
        ?? inlineTarget.textContent
        ?? ""
      : null;
  return {
    blockId: block?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? null,
    imageOrdinal: 0 <= ordinal ? ordinal : null,
    inlinePath,
    inlineKind,
    inlineSignature,
    snapshot,
  };
}

function elementAtPath(
  root: Element,
  path: ReadonlyArray<number>,
): Element | null {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current instanceof Element ? current : null;
}

function inlineTargetMatchesIdentity(
  target: Element,
  kind: ContextMenuInlineTargetKind,
  signature: string | null,
): boolean {
  if (
    (kind === "link" && !target.matches("a"))
    || (kind === "math" && !target.matches(".easymde-math"))
    || (kind === "mermaid" && !target.matches(".easymde-mermaid"))
  ) return false;
  if (null === signature) return true;
  const current = kind === "link"
    ? target.getAttribute("href") ?? target.textContent ?? ""
    : target.getAttribute("data-easymde-generated-source")
      ?? target.textContent
      ?? "";
  return current === signature;
}

/**
 * Re-anchor a replayed context-menu target onto the live element of this
 * surface that carries the same visual block identity. An accepted Preview
 * window commit replaces the block DOM, which retires the element a demand was
 * anchored to; the block id and the image slot are the identity that survives
 * such a commit. `null` states that the target cannot be re-anchored onto this
 * surface.
 */
export function resolveLiveWindowContextMenuTarget(
  surface: HTMLElement,
  target: Element | null | undefined,
): Element | null {
  if (!target) return null;
  if (target.isConnected && surface.contains(target)) return target;
  const identity = contextMenuTargetIdentity(target, null);
  const blockId = identity.blockId;
  if (!blockId) return null;
  const block = Array.from(surface.children).find(
    (child) => child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === blockId,
  );
  if (!block) return null;
  // An image nested inside a link is still an image context. Resolve the
  // concrete image slot before the enclosing link so image scale/copy/delete
  // actions cannot silently degrade to link actions after a window commit.
  if (null !== identity.imageOrdinal) {
    const liveImage = visualBlockImages(block)[identity.imageOrdinal] ?? null;
    if (
      !liveImage
      || liveImage.getAttribute("src") !== target.getAttribute("src")
      || (liveImage.getAttribute("alt") ?? "")
        !== (target.getAttribute("alt") ?? "")
    ) return null;
    return liveImage;
  }
  if (identity.inlinePath && identity.inlineKind) {
    const inlineTarget = elementAtPath(block, identity.inlinePath);
    if (
      !inlineTarget
      || !inlineTargetMatchesIdentity(
        inlineTarget,
        identity.inlineKind,
        identity.inlineSignature,
      )
    ) return null;
    return inlineTarget;
  }
  return block;
}

/**
 * A menu refresh can replay a target element that an accepted Preview window
 * re-render already replaced. Only a target captured by an earlier live
 * prepare may be restored, and only while the accepted snapshot still
 * describes the same document state. Restoration resolves the recorded target
 * itself by block id and image slot; an image whose live slot no longer matches
 * the recorded rendered source is an explicit failure instead of a silent block
 * rebind.
 */
function resolveLiveContextMenuTarget(
  surface: HTMLElement,
  target: Element | null | undefined,
  tracked: WeakMap<Element, ContextMenuTargetIdentity>,
  currentSnapshot: ContextMenuTargetSnapshotIdentity | null,
): Element | null {
  if (!target) return null;
  if (target.isConnected && surface.contains(target)) {
    tracked.set(target, contextMenuTargetIdentity(target, currentSnapshot));
    return target;
  }
  const identity = tracked.get(target);
  if (!identity) return null;
  if (!contextMenuTargetSnapshotStillMatches(identity.snapshot, currentSnapshot)) {
    return null;
  }
  const live = resolveLiveWindowContextMenuTarget(surface, target);
  if (live) {
    tracked.set(live, contextMenuTargetIdentity(live, currentSnapshot));
  }
  return live;
}

function selectedVisualCodeBlock(surface: HTMLElement): HTMLElement | null {
	const node = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
	if (!node || !surface.contains(node)) return null;
	const element = node instanceof HTMLElement ? node : node.parentElement;
	const pre = element?.closest("pre");
	return pre && surface.contains(pre) ? pre : null;
}

function rootBlock(
	surface: HTMLElement,
	node: Node | null,
): HTMLElement | null {
	let current =
		node instanceof HTMLElement ? node : (node?.parentElement ?? null);
	while (current && current.parentElement !== surface) {
		current = current.parentElement;
	}
	return current?.parentElement === surface ? current : null;
}

function selectSurfaceContents(surface: HTMLElement): void {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection) throw new Error("visual-editor-window-selection-invalid");
	const range = surface.ownerDocument.createRange();
	range.selectNodeContents(surface);
	selection.removeAllRanges();
	selection.addRange(range);
}

function selectionCoversEditableSurface(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
): boolean {
	const documentRef = surface.ownerDocument;
	const selection = documentRef.defaultView?.getSelection();
	if (
		!surface.isConnected ||
		documentRef.activeElement !== surface ||
		!selection ||
		1 !== selection.rangeCount ||
		selection.isCollapsed ||
		!selection.anchorNode?.isConnected ||
		!selection.focusNode?.isConnected ||
		!surface.contains(selection.anchorNode) ||
		!surface.contains(selection.focusNode)
	)
		return false;
	const range = selection.getRangeAt(0);
	if (
		!range.startContainer.isConnected ||
		!range.endContainer.isConnected ||
		!surface.contains(range.startContainer) ||
		!surface.contains(range.endContainer)
	)
		return false;
	const rootStart = documentRef.createRange();
	rootStart.setStart(surface, 0);
	rootStart.collapse(true);
	const rootEnd = documentRef.createRange();
	rootEnd.setStart(surface, surface.childNodes.length);
	rootEnd.collapse(true);
	if (
		range.compareBoundaryPoints(Range.START_TO_START, rootStart) > 0 ||
		range.compareBoundaryPoints(Range.END_TO_END, rootEnd) < 0
	)
		return false;
	const blocks = Array.from(surface.children).filter(
		(child) => !child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	);
	return (
		blocks.length > 0 &&
		blocks.every((block) => {
			return (
				ranges.get(block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "") !== null
			);
		})
	);
}

function caretIsAtStart(block: HTMLElement): boolean {
	const selection = block.ownerDocument.defaultView?.getSelection();
	if (
		!selection?.isCollapsed ||
		!selection.anchorNode ||
		!block.contains(selection.anchorNode)
	)
		return false;
	try {
		const before = block.ownerDocument.createRange();
		before.selectNodeContents(block);
		before.setEnd(selection.anchorNode, selection.anchorOffset);
		return before.toString().length === 0;
	} catch {
		return false;
	}
}

function caretIsAtEnd(block: HTMLElement): boolean {
	const selection = block.ownerDocument.defaultView?.getSelection();
	if (
		!selection?.isCollapsed ||
		!selection.anchorNode ||
		!block.contains(selection.anchorNode)
	)
		return false;
	try {
		const after = block.ownerDocument.createRange();
		after.selectNodeContents(block);
		after.setStart(selection.anchorNode, selection.anchorOffset);
		return after.toString().length === 0;
	} catch {
		return false;
	}
}

function selectionIntersectsReadOnlyRegion(
	selection: Selection,
	snapshot: VisualMarkdownReadOnlySnapshot,
): boolean {
	if (!selection.rangeCount) return false;
	const range = selection.getRangeAt(0);
	return snapshot.some(({ node }) => {
		if (
			node.contains(selection.anchorNode) ||
			node.contains(selection.focusNode)
		) {
			return true;
		}
		try {
			return range.intersectsNode(node);
		} catch {
			return true;
		}
	});
}

function nodePathWithin(root: Node, node: Node): ReadonlyArray<number> {
	const path: number[] = [];
	let current: Node | null = node;
	while (current && current !== root) {
		const parent: Node | null = current.parentNode;
		if (!parent) throw new Error("visual-editor-window-selection-invalid");
		const index = Array.prototype.indexOf.call(parent.childNodes, current);
		if (index < 0) throw new Error("visual-editor-window-selection-invalid");
		path.unshift(index);
		current = parent;
	}
	if (current !== root)
		throw new Error("visual-editor-window-selection-invalid");
	return path;
}

function nodeAtPath(root: Node, path: ReadonlyArray<number>): Node {
	let current = root;
	for (const index of path) {
		const child = current.childNodes[index];
		if (!child)
			throw new Error("visual-editor-window-history-selection-map-failed");
		current = child;
	}
	return current;
}

function editableBlockEndBoundary(
	block: HTMLElement,
): Readonly<{ node: Node; offset: number }> {
	const visit = (node: Node): Readonly<{ node: Node; offset: number }> | null => {
		if (node instanceof Text) {
			return node.data.length > 0
				? { node, offset: node.data.length }
				: null;
		}
		if (
			node instanceof HTMLElement &&
			node.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
		) {
			return null;
		}
		for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
			const child = node.childNodes[index];
			if (!child) continue;
			if (
				child instanceof HTMLElement &&
				child.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
			) {
				return { node, offset: index + 1 };
			}
			const boundary = visit(child);
			if (boundary) return boundary;
		}
		return { node, offset: node.childNodes.length };
	};
	return visit(block) ?? { node: block, offset: block.childNodes.length };
}

function plainSourceSelectionText(
	source: string,
	selection: Readonly<{ end: number; start: number }>,
): string | null {
	if (
		selection.start < 0 ||
		selection.end <= selection.start ||
		selection.end > source.length
	) {
		return null;
	}
	const text = source.slice(selection.start, selection.end);
	if (!text || /[\r\n`*_~#[\]()>|!\\]/u.test(text)) return null;
	return text;
}

function restoreUniquePlainTextSelection(
	surface: HTMLElement,
	blocks: ReadonlyArray<HTMLElement>,
	source: string,
	selection: Readonly<{ direction: DocumentSelection["direction"]; end: number; start: number }>,
	sourceRangeForBlock: (
		block: HTMLElement,
	) => Readonly<{ end: number; start: number }> | null,
): boolean {
	if ("forward" !== selection.direction && "backward" !== selection.direction) {
		return false;
	}
	const selectedText = plainSourceSelectionText(source, selection);
	if (!selectedText) return false;
	const matches: Array<Readonly<{
		block: HTMLElement;
		end: number;
		node: Text;
		start: number;
	}>> = [];
	for (const block of blocks) {
		const walker = block.ownerDocument.createTreeWalker(
			block,
			NodeFilter.SHOW_TEXT,
		);
		let node = walker.nextNode();
		while (node) {
			if (
				node instanceof Text &&
				!node.parentElement?.closest(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
			) {
				let from = 0;
				while (from <= node.data.length - selectedText.length) {
					const start = node.data.indexOf(selectedText, from);
					if (start < 0) break;
					matches.push({
						block,
						end: start + selectedText.length,
						node,
						start,
					});
					from = start + 1;
				}
			}
			if (matches.length > 1) return false;
			node = walker.nextNode();
		}
	}
	if (1 !== matches.length) return false;
	const match = matches[0];
	if (!match) return false;
	// The bounded fallback is only needed for list roots, where a large
	// accepted list can exceed the general mapper's boundary budget. Paragraphs
	// and other block types retain the source-aware mapper as their owner.
	if (!new Set(["OL", "UL"]).has(match.block.tagName)) return false;
	const sourceRange = sourceRangeForBlock(match.block);
	if (!sourceRange) return false;
	const blockSource = source.slice(sourceRange.start, sourceRange.end);
	const baseline = serializeVisualMarkdownBlockFragment([match.block]);
	const expectedStart = selection.start - sourceRange.start;
	const expectedEnd = selection.end - sourceRange.start;
	if (
		expectedStart < 0 ||
		expectedEnd > blockSource.length ||
		expectedEnd <= expectedStart
	) {
		return false;
	}
	let mappedStart: number;
	let mappedEnd: number;
	try {
		mappedStart = visualBoundarySourceOffset(
			match.block,
			blockSource,
			baseline,
			match.node,
			match.start,
		);
		mappedEnd = visualBoundarySourceOffset(
			match.block,
			blockSource,
			baseline,
			match.node,
			match.end,
		);
	} catch {
		return false;
	}
	if (mappedStart !== expectedStart || mappedEnd !== expectedEnd) {
		return false;
	}
	const selectionOwner = surface.ownerDocument.defaultView?.getSelection();
	if (!selectionOwner) {
		throw new Error("visual-editor-window-history-selection-restore-failed");
	}
	const anchorOffset =
		"backward" === selection.direction ? match.end : match.start;
	const focusOffset =
		"backward" === selection.direction ? match.start : match.end;
	selectionOwner.setBaseAndExtent(
		match.node,
		anchorOffset,
		match.node,
		focusOffset,
	);
	return true;
}

function captureWindowSelectionBoundary(
	blocks: ReadonlyArray<HTMLElement>,
	node: Node,
	offset: number,
): WindowSelectionBoundary {
	const blockIndex = blocks.findIndex((block) => block.contains(node));
	const block = blocks[blockIndex];
	if (!block) throw new Error("visual-editor-window-selection-invalid");
	return {
		blockIndex,
		node,
		nodePath: nodePathWithin(block, node),
		offset,
		...(node instanceof Text
			? {
					...(node.parentNode ? { parent: node.parentNode } : {}),
					textData: node.data,
				}
			: {}),
	};
}

function captureWindowSelection(
	blocks: ReadonlyArray<HTMLElement>,
	selection: Selection,
): WindowSelectionSnapshot {
	if (!selection.anchorNode || !selection.focusNode) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	return {
		anchor: captureWindowSelectionBoundary(
			blocks,
			selection.anchorNode,
			selection.anchorOffset,
		),
		focus: captureWindowSelectionBoundary(
			blocks,
			selection.focusNode,
			selection.focusOffset,
		),
	};
}

function adjacentEditableBlock(
	block: HTMLElement,
	ranges: SourceRangeLedger,
	direction: DeletionDirection,
): HTMLElement {
	const blockRange = ranges.get(
		block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	const sibling =
		direction === "backward" ? block.previousSibling : block.nextSibling;
	const siblingRange =
		sibling instanceof HTMLElement
			? ranges.get(sibling.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "")
			: null;
	if (
		!blockRange?.editable ||
		!(sibling instanceof HTMLElement) ||
		sibling.hasAttribute(WINDOW_SPACER_ATTRIBUTE) ||
		!siblingRange?.editable ||
		siblingRange.index !==
			blockRange.index + (direction === "backward" ? -1 : 1)
	) {
		throw new Error("visual-editor-window-adjacent-block-unavailable");
	}
	return sibling;
}

function createBlockRanges(
	markdown: string,
	editMap: PreviewEditMap,
): SourceRangeLedger {
	const ranges: MutableBlockRange[] = [];
	const lineStarts = markdownLineStarts(markdown);
	let previousEndLine = 0;
	editMap.blocks.forEach((block, index) => {
		if (
			!Number.isInteger(block.startLine) ||
			!Number.isInteger(block.endLine) ||
			block.startLine < previousEndLine ||
			block.startLine < 0 ||
			block.endLine < block.startLine ||
			block.endLine > lineStarts.length ||
			(block.editable && block.endLine === block.startLine)
		) {
			throw new Error("visual-editor-window-source-range-invalid");
		}
		previousEndLine = block.endLine;
		if (!block.editable) {
			ranges.push({
				baseEnd: 0,
				baseStart: 0,
				editable: false,
				id: block.id,
				index,
			});
			return;
		}
		const start = lineStarts[block.startLine];
		const end =
			block.endLine === lineStarts.length
				? markdown.length
				: lineStarts[block.endLine];
		if (undefined === start || undefined === end) {
			throw new Error("visual-editor-window-source-range-invalid");
		}
		ranges.push({
			baseEnd: end,
			baseStart: start,
			editable: true,
			id: block.id,
			index,
		});
	});
	return new SourceRangeLedger(ranges);
}

function blockPreElements(blocks: ReadonlyArray<HTMLElement>): HTMLElement[] {
	return blocks.flatMap((block) => [
		...(block.matches("pre") ? [block] : []),
		...Array.from(block.querySelectorAll<HTMLElement>("pre")),
	]);
}

function restoreRegionCodeFenceMetadata(
	blocks: ReadonlyArray<HTMLElement>,
	sourceSlice: string,
	sourceRange: Readonly<{ documentLength: number; end: number }>,
): void {
	const livePres = blockPreElements(blocks);
	if (0 === livePres.length) return;

	const detachedRegion = blocks[0]?.ownerDocument.createElement("div");
	if (!detachedRegion) {
		throw new Error("visual-editor-window-code-fence-map-invalid");
	}
	for (const block of blocks) detachedRegion.append(block.cloneNode(true));
	restoreVisualCodeFenceFamilies(detachedRegion, sourceSlice);

	const restoredPres = Array.from(
		detachedRegion.querySelectorAll<HTMLElement>("pre"),
	);
	if (restoredPres.length !== livePres.length) {
		throw new Error("visual-editor-window-code-fence-map-invalid");
	}
	if (
		!Number.isInteger(sourceRange.end) ||
		!Number.isInteger(sourceRange.documentLength) ||
		sourceRange.end < 0 ||
		sourceRange.end > sourceRange.documentLength
	) {
		throw new Error("visual-editor-window-source-range-invalid");
	}
	if (
		sourceRange.end !== sourceRange.documentLength &&
		restoredPres.some((pre) =>
			pre.hasAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE),
		)
	) {
		throw new Error("visual-editor-window-open-fence-source-range-invalid");
	}
	restoredPres.forEach((restoredPre, index) => {
		const livePre = livePres[index];
		if (!livePre) {
			throw new Error("visual-editor-window-code-fence-map-invalid");
		}
		for (const attribute of [
			VISUAL_FENCE_ATTRIBUTE,
			VISUAL_FENCE_INFO_ATTRIBUTE,
			VISUAL_FENCE_OPEN_EOF_ATTRIBUTE,
		]) {
			const value = restoredPre.getAttribute(attribute);
			if (null === value) {
				livePre.removeAttribute(attribute);
			} else {
				livePre.setAttribute(attribute, value);
			}
		}
	});
}

function mountedSelectionRegion(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	markdown: string,
	selection: DocumentSelection,
): Readonly<{
	blocks: ReadonlyArray<HTMLElement>;
	end: Readonly<{ block: HTMLElement; range: EffectiveBlockRange }>;
	terminalDocumentEnd: boolean;
	sourceEnd: number;
	sourceStart: number;
	start: Readonly<{ block: HTMLElement; range: EffectiveBlockRange }>;
}> | null {
	const sourceLength = markdown.length;
	const mappedBlocks = Array.from(surface.children).flatMap((child) => {
		if (
			!(child instanceof HTMLElement) ||
			child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
		) {
			return [];
		}
		const range = ranges.get(child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "");
		return range?.editable ? [{ block: child, range }] : [];
	});
	const blockForOffset = (offset: number, preferPrevious = false) => {
		const containing = mappedBlocks.filter(
			({ range }) => range.start <= offset && offset < range.end,
		);
		if (1 === containing.length) return containing[0];
		if (preferPrevious) {
			const endingAtOffset = mappedBlocks.filter(
				({ range }) => range.end === offset,
			);
			if (1 === endingAtOffset.length) return endingAtOffset[0];
		}
		if (0 !== containing.length || offset !== sourceLength) return null;
		const endingAtSourceEnd = mappedBlocks.filter(
			({ range }) => range.end === sourceLength,
		);
		if (1 === endingAtSourceEnd.length) return endingAtSourceEnd[0];
		if (selection.start !== sourceLength || selection.end !== sourceLength)
			return null;
		const endingAtDocumentEnd = mappedBlocks.filter(
			({ range }) =>
				range.end < sourceLength &&
				isMarkdownTerminalWhitespaceSuffix(markdown.slice(range.end)),
		);
		if (1 !== endingAtDocumentEnd.length) return null;
		return endingAtDocumentEnd[0];
	};
	const start = blockForOffset(selection.start);
	const end = blockForOffset(selection.end, true);
	if (!start || !end) return null;

	const startIndex = Math.min(start.range.index, end.range.index);
	const endIndex = Math.max(start.range.index, end.range.index);
	const domStart = Array.prototype.indexOf.call(surface.children, start.block);
	const domEnd = Array.prototype.indexOf.call(surface.children, end.block);
	if (domStart < 0 || domEnd < 0) return null;
	const orderedDomStart = Math.min(domStart, domEnd);
	const orderedDomEnd = Math.max(domStart, domEnd);
	if (
		Array.from(surface.children)
			.slice(orderedDomStart, orderedDomEnd + 1)
			.some((child) => child.hasAttribute(WINDOW_SPACER_ATTRIBUTE))
	)
		return null;

	const blocks = mappedBlocks
		.filter(({ range }) => range.index >= startIndex && range.index <= endIndex)
		.sort((left, right) => left.range.index - right.range.index)
		.map(({ block }) => block);
	if (blocks.length !== endIndex - startIndex + 1) return null;
	const firstRange = ranges.get(
		blocks[0]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	const lastRange = ranges.get(
		blocks[blocks.length - 1]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	if (
		!firstRange ||
		!lastRange ||
		selection.start < firstRange.start ||
		(selection.end > lastRange.end &&
			!(
				selection.start === sourceLength &&
				selection.end === sourceLength &&
				isMarkdownTerminalWhitespaceSuffix(markdown.slice(lastRange.end))
			))
	)
		return null;
	const terminalDocumentEnd =
		selection.start === sourceLength &&
		selection.end === sourceLength &&
		isMarkdownTerminalWhitespaceSuffix(markdown.slice(lastRange.end));
	return {
		blocks,
		end: { block: end.block, range: end.range },
		terminalDocumentEnd,
		sourceEnd: terminalDocumentEnd ? sourceLength : lastRange.end,
		sourceStart: firstRange.start,
		start: { block: start.block, range: start.range },
	};
}

function sourceCodeBodyOffsetToVisual(
	sourceBody: string,
	sourceOffset: number,
): number {
	if (
		!Number.isInteger(sourceOffset) ||
		sourceOffset < 0 ||
		sourceOffset > sourceBody.length
	) {
		throw new Error("visual-editor-window-history-selection-map-failed");
	}
	let sourceCursor = 0;
	let visualCursor = 0;
	while (sourceCursor < sourceOffset) {
		if (
			"\r" === sourceBody[sourceCursor] &&
			"\n" === sourceBody[sourceCursor + 1]
		) {
			sourceCursor += 2;
		} else {
			sourceCursor += 1;
		}
		visualCursor += 1;
	}
	return visualCursor;
}

function codeBodyDomBoundaryAtOffset(
	code: HTMLElement,
	offset: number,
): Readonly<{ node: Node; offset: number }> {
	const walker = code.ownerDocument.createTreeWalker(
		code,
		NodeFilter.SHOW_TEXT,
	);
	let remaining = offset;
	let lastText: Text | null = null;
	let node = walker.nextNode();
	while (node) {
		if (!(node instanceof Text)) {
			throw new Error("visual-editor-window-history-selection-map-failed");
		}
		lastText = node;
		if (remaining <= node.length) return { node, offset: remaining };
		remaining -= node.length;
		node = walker.nextNode();
	}
	if (0 === remaining && lastText) {
		return { node: lastText, offset: lastText.length };
	}
	if (0 === offset && !lastText) return { node: code, offset: 0 };
	throw new Error("visual-editor-window-history-selection-map-failed");
}

function placeCodeBodySourceSelection(
	pre: HTMLElement,
	sourceBody: string,
	sourceSelection: Readonly<{ end: number; start: number }>,
	direction: DocumentSelection["direction"],
): void {
	const code = Array.from(pre.children).find(
		(child): child is HTMLElement =>
			child instanceof HTMLElement && "CODE" === child.tagName,
	);
	if (!code) throw new Error("visual-editor-code-child-missing");
	const normalizedSource = sourceBody.replace(/\r\n|\r/g, "\n");
	const normalizedDom = (code.textContent ?? "").replace(/\r\n|\r/g, "\n");
	const omittedTerminalLineEnding = normalizedSource === `${normalizedDom}\n`;
	if (normalizedSource !== normalizedDom && !omittedTerminalLineEnding) {
		throw new Error("visual-editor-window-history-selection-map-failed");
	}
	const visualOffset = (sourceOffset: number): number => {
		const offset = sourceCodeBodyOffsetToVisual(sourceBody, sourceOffset);
		if (offset <= normalizedDom.length) return offset;
		if (omittedTerminalLineEnding && offset === normalizedSource.length) {
			return normalizedDom.length;
		}
		throw new Error("visual-editor-window-history-selection-map-failed");
	};
	const anchorSourceOffset =
		"backward" === direction ? sourceSelection.end : sourceSelection.start;
	const focusSourceOffset =
		"backward" === direction ? sourceSelection.start : sourceSelection.end;
	const anchor = codeBodyDomBoundaryAtOffset(
		code,
		visualOffset(anchorSourceOffset),
	);
	const focus = codeBodyDomBoundaryAtOffset(
		code,
		visualOffset(focusSourceOffset),
	);
	const domSelection = code.ownerDocument.defaultView?.getSelection();
	if (!domSelection) {
		throw new Error("visual-editor-window-history-selection-restore-failed");
	}
	domSelection.setBaseAndExtent(
		anchor.node,
		anchor.offset,
		focus.node,
		focus.offset,
	);
}

function restoreMountedSourceSelection(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	markdown: string,
	selection: DocumentSelection,
	accepted?: Readonly<{
		blockSerializations: WeakMap<HTMLElement, string>;
		childNodes: ReadonlyArray<Node>;
	}>,
): boolean {
	if (
		selection.start !== selection.end &&
		("forward" === selection.direction || "backward" === selection.direction)
	) {
		for (const child of Array.from(surface.children)) {
			if (!(child instanceof HTMLHRElement)) continue;
			const blockId = child.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
			const range = blockId ? ranges.get(blockId) : null;
			if (
				!blockId ||
				!range?.editable ||
				child.parentElement !== surface ||
				!child.isConnected
			) {
				continue;
			}
			let thematicSelection: ReturnType<
				typeof visualThematicBreakSourceSelection
			>;
			try {
				thematicSelection = visualThematicBreakSourceSelection(
					markdown,
					{ end: range.end, start: range.start },
					selection.direction,
				);
			} catch {
				continue;
			}
			if (
				thematicSelection.start !== selection.start ||
				thematicSelection.end !== selection.end
			) {
				continue;
			}
			if (accepted) {
				assertMountedEditableBlocksMatchAccepted(
					surface,
					ranges,
					accepted.blockSerializations,
					accepted.childNodes,
				);
			}
			const blockIndex = Array.from(surface.childNodes).indexOf(child);
			if (blockIndex < 0) {
				throw new Error("visual-editor-window-history-selection-map-failed");
			}
			const domSelection = surface.ownerDocument.defaultView?.getSelection();
			if (!domSelection) {
				throw new Error(
					"visual-editor-window-history-selection-restore-failed",
				);
			}
			if ("backward" === selection.direction) {
				domSelection.setBaseAndExtent(
					surface,
					blockIndex + 1,
					surface,
					blockIndex,
				);
			} else {
				domSelection.setBaseAndExtent(
					surface,
					blockIndex,
					surface,
					blockIndex + 1,
				);
			}
			return true;
		}
	}
	const region = mountedSelectionRegion(surface, ranges, markdown, selection);
	if (!region) return false;
	const sourceSlice = markdown.slice(region.sourceStart, region.sourceEnd);
	restoreRegionCodeFenceMetadata(region.blocks, sourceSlice, {
		documentLength: markdown.length,
		end: region.sourceEnd,
	});
	const localSelection = {
		end: selection.end - region.sourceStart,
		start: selection.start - region.sourceStart,
	};
	if (region.terminalDocumentEnd && "PRE" !== region.end.block.tagName) {
		const block = region.end.block;
		const blockId = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
		const liveRange = blockId ? ranges.get(blockId) : null;
		const surfaceChildren = Array.from(surface.childNodes);
		const blockIndex = surfaceChildren.indexOf(block);
		const trailingDomIsGenerated =
			blockIndex >= 0 &&
			surfaceChildren.slice(blockIndex + 1).every((child) => {
				if (child instanceof Text) return /^\s*$/u.test(child.data);
				if (!(child instanceof HTMLElement)) return false;
				if (child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) return true;
				const childRange = ranges.get(
					child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
				);
				return (
					childRange?.editable !== true &&
					"false" === child.getAttribute("contenteditable")?.toLowerCase()
				);
			});
		if (
			!block.isConnected ||
			block.parentElement !== surface ||
			block.ownerDocument !== surface.ownerDocument ||
			"false" === block.getAttribute("contenteditable")?.toLowerCase() ||
			blockIndex < 0 ||
			!liveRange?.editable ||
			liveRange.id !== region.end.range.id ||
			liveRange.index !== region.end.range.index ||
			liveRange.start !== region.end.range.start ||
			liveRange.end !== region.end.range.end ||
			selection.start !== markdown.length ||
			selection.end !== markdown.length ||
			!isMarkdownTerminalWhitespaceSuffix(markdown.slice(liveRange.end)) ||
			(liveRange && ranges.hasEditableAfter(liveRange.index)) ||
			!trailingDomIsGenerated
		) {
			throw new Error("visual-editor-window-history-selection-map-failed");
		}
		const domSelection = surface.ownerDocument.defaultView?.getSelection();
		if (!domSelection) {
			throw new Error("visual-editor-window-history-selection-restore-failed");
		}
		domSelection.collapse(block, block.childNodes.length);
		return true;
	}
	let codeOrdinal: number | null = null;
	try {
		codeOrdinal = visualCodeBodyOrdinalForSourceRange(
			sourceSlice,
			localSelection,
		);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			![
				"visual-editor-code-body-map-ambiguous",
				"visual-editor-code-body-selection-invalid",
			].includes(error.message)
		)
			throw error;
	}
	if (null !== codeOrdinal) {
		if (1 !== region.blocks.length || "PRE" !== region.blocks[0]?.tagName) {
			throw new Error("visual-editor-window-history-selection-map-failed");
		}
		const interval = visualCodeBodyIntervalAtOrdinal(sourceSlice, codeOrdinal);
		if (
			interval.sourceBlockStart < 0 ||
			interval.sourceBlockEnd > sourceSlice.length ||
			localSelection.start < interval.bodyStart ||
			localSelection.end > interval.bodyEnd
		) {
			throw new Error("visual-editor-window-history-selection-map-failed");
		}
		placeCodeBodySourceSelection(
			region.blocks[0],
			sourceSlice.slice(interval.bodyStart, interval.bodyEnd),
			{
				end: localSelection.end - interval.bodyStart,
				start: localSelection.start - interval.bodyStart,
			},
			selection.direction,
		);
		return true;
	}
	if (accepted) {
		assertMountedEditableBlocksMatchAccepted(
			surface,
			ranges,
			accepted.blockSerializations,
			accepted.childNodes,
		);
		if (
			restoreUniquePlainTextSelection(
				surface,
				region.blocks,
				sourceSlice,
				{ direction: selection.direction, ...localSelection },
					(block) => {
						const blockId = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
						const blockRange = blockId ? ranges.get(blockId) : null;
						return blockRange
							? {
									end: blockRange.end - region.sourceStart,
									start: blockRange.start - region.sourceStart,
								  }
							: null;
					},
			)
		) {
			return true;
		}
	}
	const direction = selection.direction;
	const anchorOffset =
		"backward" === direction ? selection.end : selection.start;
	const focusOffset =
		"backward" === direction ? selection.start : selection.end;
	const mapBoundary = (
		sourceOffset: number,
		endpoint: typeof region.start,
	): WindowSelectionBoundary => {
		const clone = endpoint.block.cloneNode(true) as HTMLElement;
		const endpointMarkdown = markdown.slice(
			endpoint.range.start,
			endpoint.range.end,
		);
		const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
		let boundary: Readonly<{ node: Node; offset: number }>;
		try {
			boundary = visualCaretBoundaryFromSourceOffset(
				clone,
				endpointMarkdown,
				endpointBaseline,
				sourceOffset - endpoint.range.start,
			);
		} catch (error) {
			if (sourceOffset !== endpoint.range.end) throw error;
			boundary = editableBlockEndBoundary(clone);
		}
		const blockIndex = region.blocks.indexOf(endpoint.block);
		const boundaryIsInBlock =
			clone === boundary.node || clone.contains(boundary.node);
		if (blockIndex < 0 || !boundaryIsInBlock) {
			throw new Error("visual-editor-window-history-selection-map-failed");
		}
		return {
			blockIndex,
			nodePath: nodePathWithin(clone, boundary.node),
			offset: boundary.offset,
		};
	};
	const anchor = mapBoundary(
		anchorOffset,
		"backward" === direction ? region.end : region.start,
	);
	const focus =
		anchorOffset === focusOffset
			? anchor
			: mapBoundary(
					focusOffset,
					"backward" === direction ? region.start : region.end,
				);
	const liveAnchor = region.blocks[anchor.blockIndex];
	const liveFocus = region.blocks[focus.blockIndex];
	if (!liveAnchor || !liveFocus) {
		throw new Error("visual-editor-window-history-selection-map-failed");
	}
	const selectionOwner = surface.ownerDocument.defaultView?.getSelection();
	if (!selectionOwner) {
		throw new Error("visual-editor-window-history-selection-restore-failed");
	}
	selectionOwner.setBaseAndExtent(
		nodeAtPath(liveAnchor, anchor.nodePath),
		anchor.offset,
		nodeAtPath(liveFocus, focus.nodePath),
		focus.offset,
	);
	return true;
}

function restoreThematicBreakBlankGapSelection(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	markdown: string,
	selection: DocumentSelection,
	gap: WindowedThematicBreakGap,
	accepted?: Readonly<{
		blockSerializations: WeakMap<HTMLElement, string>;
		childNodes: ReadonlyArray<Node>;
	}>,
): boolean {
	const invalid = (): never => {
		throw new Error("visual-editor-window-history-selection-map-failed");
	};
	if (
		!surface.isConnected ||
		"none" !== selection.direction ||
		selection.start !== selection.end ||
		selection.start < 0 ||
		selection.end > markdown.length ||
		markdown !== gap.afterMarkdown ||
		selection.start !== gap.postSelection.start ||
		selection.end !== gap.postSelection.end ||
		!gap.gap ||
		!/^(?:(?:\r\n|\r|\n))+$/u.test(gap.gap) ||
		markdown.slice(selection.start, selection.start + gap.gap.length) !==
			gap.gap
	) {
		return invalid();
	}
	if (accepted) {
		assertMountedEditableBlocksMatchAccepted(
			surface,
			ranges,
			accepted.blockSerializations,
			accepted.childNodes,
		);
	}
	const findChild = (
		id: string | null,
		sourceFragment: string | undefined,
		direction: "before" | "after",
	): HTMLElement | null => {
		const children = Array.from(surface.children).filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement &&
				!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
		);
		const byId = id
			? children.find(
					(child) => child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === id,
				)
			: undefined;
		if (byId) {
			const byIdRange = ranges.get(
				byId.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
			);
			if (
				byIdRange?.editable &&
				(!sourceFragment ||
					markdown.slice(byIdRange.start, byIdRange.end) === sourceFragment)
			) {
				return byId;
			}
		}
		if (sourceFragment === undefined) return null;
		const candidates = children.flatMap((child) => {
			const childRange = ranges.get(
				child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
			);
			if (
				!childRange?.editable ||
				markdown.slice(childRange.start, childRange.end) !== sourceFragment ||
				(direction === "before"
					? childRange.end > selection.start
					: childRange.start < selection.start + gap.gap.length)
			) {
				return [];
			}
			return [{ child, range: childRange }];
		});
		candidates.sort((left, right) =>
			direction === "before"
				? right.range.end - left.range.end
				: left.range.start - right.range.start,
		);
		return candidates[0]?.child ?? null;
	};
	const before = findChild(
		gap.beforeBlockId,
		gap.beforeBlockSource,
		"before",
	);
	const after = findChild(
		gap.afterBlockId,
		gap.afterBlockSource,
		"after",
	);
	const beforeRange = before
		? ranges.get(before.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "")
		: null;
	const afterRange = after
		? ranges.get(after.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "")
		: null;
	if (
		!before ||
		!after ||
		!beforeRange?.editable ||
		!afterRange?.editable ||
		before.parentElement !== surface ||
		after.parentElement !== surface ||
		beforeRange.end > selection.start ||
		!/^(?:(?:\r\n|\r|\n))+$/u.test(
			markdown.slice(beforeRange.end, afterRange.start),
		) ||
		afterRange.start !== selection.start + gap.gap.length
	) {
		return invalid();
	}
	const childNodes = Array.from(surface.childNodes);
	const beforeIndex = childNodes.indexOf(before);
	const afterIndex = childNodes.indexOf(after);
	if (beforeIndex < 0 || afterIndex !== beforeIndex + 1) return invalid();
	const domSelection = surface.ownerDocument.defaultView?.getSelection();
	if (!domSelection) {
		throw new Error("visual-editor-window-history-selection-restore-failed");
	}
	domSelection.collapse(after, 0);
	return true;
}

function captureActiveRegion(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	sourceMarkdown: string,
	deletionDirection?: DeletionDirection,
	onInitialRegion?: (region: ActiveRegion) => void,
): ActiveRegion {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection?.anchorNode || !selection.focusNode) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const anchor = rootBlock(surface, selection.anchorNode);
	const focus = rootBlock(surface, selection.focusNode);
	if (!anchor || !focus) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const anchorRange = ranges.get(
		anchor.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	const focusRange = ranges.get(
		focus.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	if (!anchorRange?.editable || !focusRange?.editable) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const surfaceChildren = Array.from(surface.children);
	const anchorDomIndex = surfaceChildren.indexOf(anchor);
	const focusDomIndex = surfaceChildren.indexOf(focus);
	if (anchorDomIndex < 0 || focusDomIndex < 0) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const domStart = Math.min(anchorDomIndex, focusDomIndex);
	const domEnd = Math.max(anchorDomIndex, focusDomIndex);
	if (
		surfaceChildren
			.slice(domStart, domEnd + 1)
			.some((child) => child.hasAttribute(WINDOW_SPACER_ATTRIBUTE))
	) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	let blockStart = Math.min(anchorRange.index, focusRange.index);
	let blockEnd = Math.max(anchorRange.index, focusRange.index) + 1;
	if (
		deletionDirection &&
		selection.isCollapsed &&
		anchor === focus &&
		(deletionDirection === "backward"
			? caretIsAtStart(anchor)
			: caretIsAtEnd(anchor))
	) {
		const adjacent = adjacentEditableBlock(anchor, ranges, deletionDirection);
		const adjacentRange = ranges.get(
			adjacent.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
		);
		if (!adjacentRange) {
			throw new Error("visual-editor-window-adjacent-block-unavailable");
		}
		blockStart = Math.min(blockStart, adjacentRange.index);
		blockEnd = Math.max(blockEnd, adjacentRange.index + 1);
	}
	const blocks: HTMLElement[] = [];
	for (const child of surfaceChildren) {
		if (child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) continue;
		const range = ranges.get(child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "");
		if (!range || range.index < blockStart || range.index >= blockEnd) continue;
		if (!range.editable || range.index !== blockStart + blocks.length) {
			throw new Error("visual-editor-window-selection-invalid");
		}
		blocks.push(child as HTMLElement);
	}
	if (blocks.length !== blockEnd - blockStart) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const firstRange = ranges.get(
		blocks[0]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	const lastRange = ranges.get(
		blocks[blocks.length - 1]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	if (!firstRange || !lastRange) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const sourceStart = firstRange.start;
	const sourceEnd = lastRange.end;
	const initialRegion: ActiveRegion = {
		after: blocks[blocks.length - 1]?.nextSibling ?? null,
		baseline: "",
		blockSnapshots: blocks.map((block) => ({
			attributes: Array.from(block.attributes, ({ name, value }) => ({
				name,
				value,
			})),
			innerHTML: block.innerHTML,
			node: block,
		})),
		before: blocks[0]?.previousSibling ?? null,
		blockEnd,
		blockStart,
		blocks,
		readOnlySnapshot: captureVisualMarkdownReadOnlySnapshot(surface),
		selection: captureWindowSelection(blocks, selection),
		sourceEnd,
		sourceStart,
	};
	onInitialRegion?.(initialRegion);
	const sourceSlice = sourceMarkdown.slice(sourceStart, sourceEnd);
	restoreRegionCodeFenceMetadata(blocks, sourceSlice, {
		documentLength: sourceMarkdown.length,
		end: sourceEnd,
	});
	blocks.forEach((block) => {
		protectVisualMarkdownReadOnlyRegions(block);
	});
	const readOnlySnapshot = captureVisualMarkdownReadOnlySnapshot(surface);
	if (selectionIntersectsReadOnlyRegion(selection, readOnlySnapshot)) {
		throw new Error("visual-editor-read-only-region-mutated");
	}
	return {
		...initialRegion,
		baseline: serializeVisualMarkdownBlockFragment(blocks),
		blockSnapshots: blocks.map((block) => ({
			attributes: Array.from(block.attributes, ({ name, value }) => ({
				name,
				value,
			})),
			innerHTML: block.innerHTML,
			node: block,
		})),
		readOnlySnapshot,
	};
}

function currentRegionBlocks(
	surface: HTMLElement,
	region: ActiveRegion,
): ReadonlyArray<HTMLElement> {
	if (
		(region.before && region.before.parentNode !== surface) ||
		(region.after && region.after.parentNode !== surface)
	) {
		throw new Error("visual-editor-window-block-detached");
	}
	const blocks: HTMLElement[] = [];
	let node = region.before ? region.before.nextSibling : surface.firstChild;
	while (node && node !== region.after) {
		if (node instanceof HTMLElement) {
			if (node.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) {
				throw new Error("visual-editor-window-selection-invalid");
			}
			blocks.push(node);
		} else if ((node.textContent ?? "").trim()) {
			throw new Error("visual-editor-window-selection-invalid");
		}
		node = node.nextSibling;
	}
	if (node !== region.after || 0 === blocks.length) {
		throw new Error("visual-editor-window-block-detached");
	}
	return blocks;
}

function normalizedWindowedBlockSerialization(block: HTMLElement): string {
	const clone = block.cloneNode(true) as HTMLElement;
	for (const protectedNode of clone.querySelectorAll<HTMLElement>(
		VISUAL_MARKDOWN_READ_ONLY_SELECTOR,
	)) {
		protectedNode.remove();
	}
	return serializeVisualMarkdownBlockFragment([clone]);
}

function captureAcceptedWindowedBlockSerializations(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
): WeakMap<HTMLElement, string> {
	const accepted = new WeakMap<HTMLElement, string>();
	for (const block of Array.from(surface.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	)) {
		const range = ranges.get(block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "");
		if (!range) {
			throw new Error("visual-editor-window-source-navigation-dom-stale");
		}
		if (range.editable) {
			accepted.set(block, normalizedWindowedBlockSerialization(block));
		}
	}
	return accepted;
}

function registerAcceptedWindowSnapshot(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	snapshot: ImmersiveWindowAcceptedSnapshot,
): WeakMap<HTMLElement, string> | null {
	const currentNodes = Array.from(surface.childNodes);
	if (
		currentNodes.length !== snapshot.nodes.length ||
		currentNodes.some((node, index) => node !== snapshot.nodes[index])
	) {
		return null;
	}
	const acceptedByNode = new Map(
		snapshot.blocks.map((block) => [block.node, block]),
	);
	const currentBlocks = Array.from(surface.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	);
	if (
		snapshot.blocks.length !== currentBlocks.length ||
		acceptedByNode.size !== snapshot.blocks.length
	) {
		return null;
	}
	const acceptedIds = new Set<string>();
	for (const [index, acceptedBlock] of snapshot.blocks.entries()) {
		const currentBlock = currentBlocks[index];
		if (
			!currentBlock ||
			acceptedIds.has(acceptedBlock.id) ||
			!ranges.get(acceptedBlock.id) ||
			acceptedBlock.node !== currentBlock ||
			acceptedBlock.node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !==
				acceptedBlock.id ||
			currentBlock.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== acceptedBlock.id ||
			acceptedBlock.innerHTML !== acceptedBlock.node.innerHTML
		) {
			return null;
		}
		acceptedIds.add(acceptedBlock.id);
	}
	const accepted = new WeakMap<HTMLElement, string>();
	for (const block of currentBlocks) {
		const id = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
		const range = ranges.get(id);
		const acceptedBlock = acceptedByNode.get(block);
		if (
			!range ||
			!acceptedBlock ||
			acceptedBlock.id !== id ||
			acceptedBlock.node !== block ||
			acceptedBlock.innerHTML !== block.innerHTML
		) {
			return null;
		}
		if (range.editable) {
			accepted.set(block, normalizedWindowedBlockSerialization(block));
		}
	}
	return accepted;
}

function assertMountedEditableBlocksMatchAccepted(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	accepted: WeakMap<HTMLElement, string>,
	acceptedNodes: ReadonlyArray<Node>,
): void {
	const currentNodes = Array.from(surface.childNodes);
	if (
		currentNodes.length !== acceptedNodes.length ||
		currentNodes.some((node, index) => node !== acceptedNodes[index])
	) {
		throw new Error("visual-editor-window-source-navigation-dom-stale");
	}
	for (const block of Array.from(surface.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	)) {
		const range = ranges.get(block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "");
		if (!range) {
			throw new Error("visual-editor-window-source-navigation-dom-stale");
		}
		if (!range.editable) continue;
		const expected = accepted.get(block);
		if (
			undefined === expected ||
			normalizedWindowedBlockSerialization(block) !== expected
		) {
			throw new Error("visual-editor-window-source-navigation-dom-stale");
		}
	}
}

function restoreWindowRegion(surface: HTMLElement, region: ActiveRegion): void {
	if (
		(region.before && region.before.parentNode !== surface) ||
		(region.after && region.after.parentNode !== surface)
	) {
		throw new Error("visual-editor-window-block-detached");
	}
	const currentNodes: Node[] = [];
	let node = region.before ? region.before.nextSibling : surface.firstChild;
	while (node && node !== region.after) {
		currentNodes.push(node);
		node = node.nextSibling;
	}
	if (node !== region.after) {
		throw new Error("visual-editor-window-block-detached");
	}
	for (const currentNode of currentNodes) {
		const parent = currentNode.parentNode;
		if (!parent) throw new Error("visual-editor-window-block-detached");
		parent.removeChild(currentNode);
	}
	for (const snapshot of region.blockSnapshots) {
		for (const attribute of Array.from(snapshot.node.attributes)) {
			snapshot.node.removeAttribute(attribute.name);
		}
		for (const attribute of snapshot.attributes) {
			snapshot.node.setAttribute(attribute.name, attribute.value);
		}
		snapshot.node.innerHTML = snapshot.innerHTML;
		surface.insertBefore(snapshot.node, region.after);
	}
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection)
		throw new Error("visual-editor-window-selection-restore-failed");
	const boundaryNode = (boundary: WindowSelectionBoundary): Node => {
		const snapshot = region.blockSnapshots[boundary.blockIndex];
		if (!snapshot)
			throw new Error("visual-editor-window-selection-restore-failed");
		let node: Node = snapshot.node;
		for (
			let pathIndex = 0;
			pathIndex < boundary.nodePath.length;
			pathIndex += 1
		) {
			const index = boundary.nodePath[pathIndex];
			if (undefined === index) {
				throw new Error("visual-editor-window-selection-restore-failed");
			}
			const child = node.childNodes[index];
			if (!child) {
				if (pathIndex !== boundary.nodePath.length - 1) {
					throw new Error("visual-editor-window-selection-restore-failed");
				}
				if (!(boundary.node instanceof Text) || "" !== boundary.textData) {
					throw new Error("visual-editor-window-selection-restore-failed");
				}
				if (null !== boundary.node.parentNode) {
					const restoreDetachedEmptyText =
						boundary.node instanceof Text &&
						"" === boundary.textData &&
						boundary.node.ownerDocument === surface.ownerDocument &&
						!boundary.node.isConnected &&
						boundary.node.parentNode === boundary.parent &&
						boundary.parent instanceof HTMLSpanElement &&
						!boundary.parent.isConnected &&
						1 === boundary.parent.childNodes.length &&
						boundary.parent.firstChild === boundary.node &&
						node instanceof HTMLSpanElement &&
						node.ownerDocument === surface.ownerDocument &&
						node.isConnected &&
						node.childNodes.length === index;
					if (!restoreDetachedEmptyText) {
						throw new Error("visual-editor-window-selection-restore-failed");
					}
				}
				if (node.childNodes.length !== index) {
					throw new Error("visual-editor-window-selection-restore-failed");
				}
				boundary.node.data = boundary.textData;
				node.appendChild(boundary.node);
				return boundary.node;
			}
			node = child;
		}
		return node;
	};
	const anchorNode = boundaryNode(region.selection.anchor);
	const focusNode = boundaryNode(region.selection.focus);
	const validOffset = (node: Node, offset: number): boolean =>
		Number.isInteger(offset) &&
		offset >= 0 &&
		offset <= (node instanceof Text ? node.length : node.childNodes.length);
	if (
		!anchorNode.isConnected ||
		!focusNode.isConnected ||
		anchorNode.ownerDocument !== surface.ownerDocument ||
		focusNode.ownerDocument !== surface.ownerDocument ||
		!validOffset(anchorNode, region.selection.anchor.offset) ||
		!validOffset(focusNode, region.selection.focus.offset)
	) {
		throw new Error("visual-editor-window-selection-restore-failed");
	}
	try {
		if (
			anchorNode === focusNode &&
			region.selection.anchor.offset === region.selection.focus.offset
		) {
			selection.collapse(anchorNode, region.selection.anchor.offset);
		} else {
			selection.setBaseAndExtent(
				anchorNode,
				region.selection.anchor.offset,
				focusNode,
				region.selection.focus.offset,
			);
		}
	} catch {
		throw new Error("visual-editor-window-selection-restore-failed");
	}
}

function updateBlockRanges(
	ranges: SourceRangeLedger,
	region: ActiveRegion,
	replacementLength: number,
): void {
	const previousLength = region.sourceEnd - region.sourceStart;
	const delta = replacementLength - previousLength;
	ranges.applyDelta(region.blockStart, delta);
}

export function WindowedImmersiveVisualEditor({
	documentSession,
	editMap,
	imagePasteUploadEnabled,
	imageUploadEnabled,
	onCanonicalDocumentChange,
	onDiagnostic,
	onDispose,
	onFailure,
	onMarkdownChange,
	onPendingChange,
	onReady,
	onTransferFailure,
	getGeneratedPreviewIdentity,
	pending,
	prepareImageTarget,
	prepareImageTargetBySelection,
	prepareGeneratedContentTarget,
	prepareGeneratedContentTargetForSelection,
	previewSnapshot,
	previewStatus,
	requestPreview,
	requestPreviewAtDocumentEnd,
	surface,
	prepareWindowBlockAdoption,
	acceptedWindowSnapshotGeneration,
	getAcceptedWindowSnapshot,
}: Props) {
	const pendingRef = useRef<Readonly<{
		markdown: string;
		signature: string;
	}> | null>(null);
	const pendingHistorySelectionRef = useRef<PendingHistorySelection | null>(
		null,
	);
	const contextMenuSelectionRef = useRef<VisualSelectionSnapshot | null>(null);
	const contextMenuTargetsRef = useRef(
		new WeakMap<Element, ContextMenuTargetIdentity>(),
	);
	const editMapRef = useRef(editMap);
	editMapRef.current = editMap;
	const thematicBreakDeletionHistoryRef = useRef<
		ReadonlyArray<WindowedThematicBreakGap>
	>([]);
	const pendingPropRef = useRef(pending);
	pendingPropRef.current = pending;
	const selfWriteRef = useRef(false);
	const externalChangeReportedRef = useRef(false);
	const sourceRef = useRef(documentSession.document.getValue());
	const rangesRef = useRef<SourceRangeLedger | null>(null) as {
		current: SourceRangeLedger;
	};
	if (!rangesRef.current) {
		rangesRef.current = createBlockRanges(sourceRef.current, editMap);
	}
	const regionRef = useRef<ActiveRegion | null>(null);
	const readOnlySnapshotRef = useRef<VisualMarkdownReadOnlySnapshot | null>(
		null,
	);
	const acceptedBlockSerializationsRef = useRef<WeakMap<HTMLElement, string>>(
		new WeakMap(),
	);
	const acceptedWindowChildNodesRef = useRef<ReadonlyArray<Node>>([]);
	const acceptedWindowSnapshotIdentityRef = useRef<Readonly<{
		key: number;
		revision: number;
		signature: string;
	}> | null>(null);

	useLayoutEffect(() => {
		if (externalChangeReportedRef.current) return;
		if (editMap.signature !== previewSnapshot.signature) {
			onFailure("visual-editor-window-signature-invalid");
			onTransferFailure();
			return;
		}
		const sourceMarkdown = documentSession.document.getValue();
		restoreVisualCodeFenceFamilies(surface, sourceMarkdown);
		protectVisualMarkdownReadOnlyRegions(surface);
		readOnlySnapshotRef.current =
			captureVisualMarkdownReadOnlySnapshot(surface);
		rangesRef.current = createBlockRanges(sourceMarkdown, editMap);
		acceptedBlockSerializationsRef.current =
			captureAcceptedWindowedBlockSerializations(surface, rangesRef.current);
		acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
		acceptedWindowSnapshotIdentityRef.current = null;
	}, [
		documentSession,
		editMap,
		onFailure,
		onTransferFailure,
		previewSnapshot.signature,
	]);

	useLayoutEffect(() => {
		if (!getAcceptedWindowSnapshot || externalChangeReportedRef.current) {
			return;
		}
		const snapshot = getAcceptedWindowSnapshot();
		if (!snapshot) return;
		if (
			!Number.isSafeInteger(snapshot.key) ||
			snapshot.key < 0 ||
			!Number.isSafeInteger(snapshot.revision) ||
			snapshot.revision < 0 ||
			snapshot.signature !== previewSnapshot.signature
		) {
			return;
		}
		const previous = acceptedWindowSnapshotIdentityRef.current;
		if (
			previous?.key === snapshot.key &&
			previous.revision === snapshot.revision &&
			previous.signature === snapshot.signature
		) {
			return;
		}
		const accepted = registerAcceptedWindowSnapshot(
			surface,
			rangesRef.current,
			snapshot,
		);
		if (!accepted) {
			return;
		}
		acceptedBlockSerializationsRef.current = accepted;
		acceptedWindowChildNodesRef.current = [...snapshot.nodes];
		protectVisualMarkdownReadOnlyRegions(surface);
		readOnlySnapshotRef.current =
			captureVisualMarkdownReadOnlySnapshot(surface);
		acceptedWindowSnapshotIdentityRef.current = {
			key: snapshot.key,
			revision: snapshot.revision,
			signature: snapshot.signature,
		};
	}, [
		acceptedWindowSnapshotGeneration,
		getAcceptedWindowSnapshot,
		onFailure,
		previewSnapshot.signature,
		surface,
	]);

	useLayoutEffect(() => {
		if (externalChangeReportedRef.current) {
			releasePendingHistorySelection(pendingHistorySelectionRef);
			return;
		}
		const activePending = pendingRef.current;
		if (!activePending) return;
		if ("error" === previewStatus) {
			pendingRef.current = null;
				thematicBreakDeletionHistoryRef.current = [];
			releasePendingHistorySelection(pendingHistorySelectionRef);
			onPendingChange(false);
			onFailure("visual-editor-markdown-paste-render-failed");
			onTransferFailure();
			return;
		}
		if ("ready" !== previewStatus) return;
		if (activePending.signature !== previewSnapshot.signature) {
			pendingRef.current = null;
				thematicBreakDeletionHistoryRef.current = [];
			releasePendingHistorySelection(pendingHistorySelectionRef);
			onPendingChange(false);
			onFailure("visual-editor-markdown-paste-superseded");
			onTransferFailure();
			return;
		}
		sourceRef.current = activePending.markdown;
		restoreVisualCodeFenceFamilies(surface, activePending.markdown);
		protectVisualMarkdownReadOnlyRegions(surface);
		readOnlySnapshotRef.current =
			captureVisualMarkdownReadOnlySnapshot(surface);
		rangesRef.current = createBlockRanges(activePending.markdown, editMap);
		acceptedBlockSerializationsRef.current =
			captureAcceptedWindowedBlockSerializations(surface, rangesRef.current);
		acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
		acceptedWindowSnapshotIdentityRef.current = null;
		pendingRef.current = null;
		onPendingChange(false);
		const pendingHistorySelection = pendingHistorySelectionRef.current;
		if (
			pendingHistorySelection &&
			pendingHistorySelection.signature === activePending.signature &&
			pendingHistorySelection.markdown === activePending.markdown
		) {
			pendingHistorySelectionRef.current = null;
			try {
				const shouldRestoreFocus = Boolean(
					pendingHistorySelection.restoreFocus &&
						surface.isConnected &&
						"true" === surface.getAttribute("contenteditable") &&
						surface.ownerDocument.activeElement === surface &&
						!externalChangeReportedRef.current,
				);
				if (shouldRestoreFocus) {
					if (
						documentSession.document.getValue() !== activePending.markdown ||
						!sameDocumentSelection(
							documentSession.document.getSelection(),
							pendingHistorySelection.selection,
						) ||
						!sameDocumentHistoryState(
							documentSession.document.getHistoryState(),
							pendingHistorySelection.historyState,
						)
					) {
						throw new Error("visual-editor-window-history-selection-stale");
					}
					focusSurface(surface);
					const mountedSelectionRestored = restoreMountedSourceSelection(
						surface,
						rangesRef.current,
						activePending.markdown,
						pendingHistorySelection.selection,
						{
							blockSerializations: acceptedBlockSerializationsRef.current,
							childNodes: acceptedWindowChildNodesRef.current,
						},
					);
					const restored =
						mountedSelectionRestored ||
							(pendingHistorySelection.thematicBreakGap?.windowSelection
							? restoreThematicBreakBlankGapSelection(
									surface,
									rangesRef.current,
									activePending.markdown,
									pendingHistorySelection.selection,
									pendingHistorySelection.thematicBreakGap,
									{
										blockSerializations: acceptedBlockSerializationsRef.current,
										childNodes: acceptedWindowChildNodesRef.current,
									},
								)
							: false);
					if (!restored) {
						onDiagnostic("visual-editor-window-history-selection-not-mounted");
						if (pendingHistorySelection.releaseDocumentEndPin) {
							throw new Error(
								"visual-editor-window-history-selection-not-mounted",
							);
						}
					}
					if (restored && pendingHistorySelection.releaseDocumentEndPin) {
						const visualSelection =
							surface.ownerDocument.defaultView?.getSelection();
						const pendingSelection = pendingHistorySelection.selection;
						const visualSelectionHasExpectedShape = Boolean(
							visualSelection &&
								1 === visualSelection.rangeCount &&
								visualSelection.anchorNode?.isConnected &&
								visualSelection.focusNode?.isConnected &&
								surface.contains(visualSelection.anchorNode) &&
								surface.contains(visualSelection.focusNode) &&
								(pendingSelection.start === pendingSelection.end
									? visualSelection.isCollapsed
									: !visualSelection.isCollapsed) &&
								("none" === pendingSelection.direction
									? visualSelection.isCollapsed
									: documentSelectionDirection(visualSelection) ===
										pendingSelection.direction),
						);
						if (
							!visualSelectionHasExpectedShape ||
							!pendingHistorySelection.historyState ||
							documentSession.document.getValue() !== activePending.markdown ||
							!sameDocumentSelection(
								documentSession.document.getSelection(),
								pendingHistorySelection.selection,
							) ||
							!sameDocumentHistoryState(
								documentSession.document.getHistoryState(),
								pendingHistorySelection.historyState,
							)
						) {
							throw new Error(
								"visual-editor-window-history-selection-restore-failed",
							);
						}
					}
					if (restored) {
						pendingHistorySelection.onDocumentEndSelectionRestored?.();
					}
				}
			} catch (error) {
				onFailure(
					error instanceof Error
							? error.message
						: "visual-editor-window-history-selection-restore-failed",
				);
				onTransferFailure();
			} finally {
				pendingHistorySelection.releaseDocumentEndPin?.();
			}
		} else {
			releasePendingHistorySelection(pendingHistorySelectionRef);
			focusSurface(surface);
		}
	}, [
		documentSession,
		editMap,
		onDiagnostic,
		onFailure,
		onPendingChange,
		onTransferFailure,
		previewSnapshot,
		previewStatus,
		surface,
	]);

	useLayoutEffect(() => {
		documentSession.document.setVisualEditingActive(true);
		focusSurface(surface);
		let active = true;
		let composing = false;
		let cancelPendingPaste: (() => void) | null = null;
		let visualInputBlock: VisualCodeInputSnapshot | null = null;
		let codeBodyInput: WindowedCodeBodyInputIntent | null = null;
		let rejectedComposition: ActiveRegion | null = null;
		let rejectedBeforeInput: ActiveRegion | null = null;

		const report = (error: unknown): false => {
			onFailure(
				error instanceof Error
					? error.message
					: "visual-editor-window-sync-failed",
			);
			return false;
		};
		const applyDocumentChange = (
			change: Parameters<typeof documentSession.document.applyTextChange>[0],
		): void => {
			selfWriteRef.current = true;
			try {
				documentSession.document.applyTextChange(change);
			} finally {
				selfWriteRef.current = false;
			}
		};
		const capture = (deletionDirection?: DeletionDirection): ActiveRegion => {
			if (externalChangeReportedRef.current) {
				throw new Error("visual-editor-window-stale");
			}
			regionRef.current = null;
			const region = captureActiveRegion(
				surface,
				rangesRef.current,
				sourceRef.current,
				deletionDirection,
				(snapshot) => {
					regionRef.current = snapshot;
				},
			);
			regionRef.current = region;
			return region;
		};
		const prepareThematicBreakSelection =
			(): WindowedThematicBreakPreparation | null => {
				if (!active || externalChangeReportedRef.current) {
					throw new Error("visual-editor-window-stale");
				}
				if (pendingRef.current || pendingPropRef.current) {
					throw new Error("visual-editor-window-pending");
				}
				const source = sourceRef.current;
				if (documentSession.document.getValue() !== source) {
					throw new Error("visual-editor-window-stale");
				}
				const readOnlySnapshot = readOnlySnapshotRef.current;
				if (!readOnlySnapshot) {
					throw new Error("visual-editor-window-read-only-snapshot-missing");
				}
				assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
				assertMountedEditableBlocksMatchAccepted(
					surface,
					rangesRef.current,
					acceptedBlockSerializationsRef.current,
					acceptedWindowChildNodesRef.current,
				);
				const thematicBreakSelection =
					captureVisualThematicBreakSelection(surface);
				if (!thematicBreakSelection) return null;
				const blockId = thematicBreakSelection.block.getAttribute(
					VISUAL_BLOCK_ATTRIBUTE,
				);
				const range = blockId ? rangesRef.current.get(blockId) : null;
				if (
					!blockId ||
					!range?.editable ||
					range.id !== blockId ||
					thematicBreakSelection.block.parentElement !== surface
				) {
					throw new Error("visual-editor-selection-map-failed");
				}
				const adjacentRange = (index: number): EffectiveBlockRange | null => {
					const adjacent = editMapRef.current.blocks[index];
					return adjacent ? rangesRef.current.get(adjacent.id) : null;
				};
				return {
					afterRange: adjacentRange(range.index + 1),
					beforeRange: adjacentRange(range.index - 1),
					range,
					selection: visualThematicBreakSourceSelection(
						source,
						{ end: range.end, start: range.start },
						thematicBreakSelection.direction,
					),
					source,
				};
			};
		const syncVisibleSelection = (region: ActiveRegion): void => {
			const source = sourceRef.current;
			const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
			const domSelection = surface.ownerDocument.defaultView?.getSelection();
			const visibleCodeBlock =
				visualInputBlock &&
				1 === region.blocks.length &&
				visualInputBlock.pre === region.blocks[0] &&
				domSelection?.anchorNode &&
				domSelection.focusNode &&
				(visualInputBlock.code === domSelection.anchorNode ||
					visualInputBlock.code.contains(domSelection.anchorNode)) &&
				(visualInputBlock.code === domSelection.focusNode ||
					visualInputBlock.code.contains(domSelection.focusNode))
					? visualInputBlock
					: null;
			let visibleSelection: Readonly<{
				direction: DocumentSelection["direction"];
				end: number;
				start: number;
			}>;
			if (
				visibleCodeBlock &&
				domSelection?.anchorNode &&
				domSelection.focusNode
			) {
				const sourceSelection =
					codeBodyInput && !codeBodyInput.inputType.startsWith("delete")
						? codeBodyInput.sourceSelection
						: projectVisualCodeBodySelection(
								visibleCodeBlock.code,
								sourceSlice,
								region.baseline,
								0,
								{
									end: {
										node: domSelection.focusNode,
										offset: domSelection.focusOffset,
									},
									start: {
										node: domSelection.anchorNode,
										offset: domSelection.anchorOffset,
									},
								},
							).sourceSelection;
				visibleSelection = {
					direction: documentSelectionDirection(domSelection),
					end: sourceSelection.end,
					start: sourceSelection.start,
				};
			} else {
				visibleSelection = visualSelectionSourceRangeForBlocks(
					region.blocks,
					sourceSlice,
					region.baseline,
				);
			}
			applyDocumentChange({
				selection: {
					direction: visibleSelection.direction,
					end: region.sourceStart + visibleSelection.end,
					start: region.sourceStart + visibleSelection.start,
				},
				value: source,
			});
		};
		const restoreRejectedBeforeInput = (region: ActiveRegion): void => {
			if (rejectedBeforeInput !== region) return;
			rejectedBeforeInput = null;
			visualInputBlock = null;
			codeBodyInput = null;
			regionRef.current = null;
			try {
				restoreWindowRegion(surface, region);
			} catch (error) {
				report(error);
				onTransferFailure();
			}
		};
		const commit = (options: CommitOptions = {}): boolean => {
			if (!active || externalChangeReportedRef.current) return false;
			const region = regionRef.current;
			regionRef.current = null;
			const bodyInput = codeBodyInput;
			codeBodyInput = null;
			if (!region)
				return report(new Error("visual-editor-window-region-missing"));
			const source = sourceRef.current;
			let adoptionTransaction = false;
			let adoptionFinalized = false;
			let documentChangeApplied = false;
			try {
				assertVisualMarkdownReadOnlySnapshot(surface, region.readOnlySnapshot);
				const blocks = currentRegionBlocks(surface, region);
				if (
					bodyInput &&
					(bodyInput.pre !== region.blocks[0] ||
						bodyInput.pre !== blocks[0] ||
						1 !== blocks.length ||
						bodyInput.pre.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !==
							bodyInput.blockId)
				) {
					throw new Error("visual-editor-code-body-map-stale");
				}
				if (bodyInput) {
					const currentCodes = Array.from(bodyInput.pre.children).filter(
						(child): child is HTMLElement =>
							child instanceof HTMLElement && "CODE" === child.tagName,
					);
					const expectedCode = bodyInput.recoveredCode ?? bodyInput.code;
					const splitCodeBody = isWindowedParagraphCodeSplit(bodyInput);
					if (
						!splitCodeBody &&
						(1 !== currentCodes.length || currentCodes[0] !== expectedCode)
					) {
						throw new Error("visual-editor-code-body-map-stale");
					}
				}
				const structuralChange =
					blocks.length !== region.blocks.length ||
					blocks.some((block, index) => block !== region.blocks[index]) ||
					region.blockEnd - region.blockStart > 1;
				const structural =
					structuralChange &&
					!(
						options.allowSingleBlockStructural &&
						blocks.length === 1 &&
						region.blocks.length === 1 &&
						region.blockEnd - region.blockStart === 1
					);
				const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
				let replacementMarkdown: string;
				let selection: Readonly<{
					direction: "backward" | "forward" | "none";
					end: number;
					start: number;
				}>;
				if (bodyInput?.directBodyEdit) {
					const bodySelection = WINDOWED_CODE_BODY_DELETION_TYPES.has(
						bodyInput.inputType,
					)
						? inferWindowedCodeBodyDeletionSelection(
								bodyInput,
								sourceSlice,
								region.baseline,
							)
						: {
								sourceSelection: bodyInput.sourceSelection,
								visualSelection: bodyInput.visualSelection,
							};
					const editInputType =
						"insertParagraph" === bodyInput.inputType
							? "insertLineBreak"
							: bodyInput.inputType;
					const editData =
						"insertParagraph" === bodyInput.inputType ? null : bodyInput.data;
					const replacement =
						"insertLineBreak" === editInputType && null === editData
							? "\n"
							: (editData ?? "");
					const sourceInputReplacement = replacement.replace(
						/\r\n|\r|\n/g,
						bodyInput.lineEnding,
					);
					const visualInputReplacement = replacement.replace(/\r\n|\r/g, "\n");
					const appendInitialBodyLine = Boolean(
						bodyInput.initialEmptyBody &&
							[
								"insertCompositionText",
								"insertFromComposition",
								"insertReplacementText",
								"insertText",
							].includes(bodyInput.inputType) &&
							"" !== replacement &&
							!/[\r\n]/u.test(replacement),
					);
					const sourcePrefix =
						bodyInput.initialEmptyBody &&
						[
							"insertCompositionText",
							"insertFromComposition",
							"insertLineBreak",
							"insertParagraph",
							"insertReplacementText",
							"insertText",
						].includes(bodyInput.inputType)
							? bodyInput.sourcePrefix
							: "";
					const result = applyVisualMarkdownEditIntent(
						sourceSlice,
						region.baseline,
						bodySelection.sourceSelection,
						bodySelection.visualSelection,
						editInputType,
						editData,
						{
							sourceCaretLength:
								sourcePrefix.length + sourceInputReplacement.length,
							sourceReplacement:
								sourcePrefix +
								sourceInputReplacement +
								(appendInitialBodyLine ? bodyInput.lineEnding : ""),
							visualCaretLength: visualInputReplacement.length,
							visualReplacement:
								visualInputReplacement + (appendInitialBodyLine ? "\n" : ""),
						},
					);
					if (!result) {
						throw new Error("visual-editor-code-body-edit-rejected");
					}
					const sourceBody = visualCodeBodyIntervalAtOrdinal(
						result.sourceMarkdown,
						0,
					);
					const expectedBody = result.sourceMarkdown
						.slice(sourceBody.bodyStart, sourceBody.bodyEnd)
						.replace(/\r\n/g, "\n");
					reconcileWindowedCodeBodyDom(
						bodyInput,
						expectedBody,
						result.visualSelection.end - bodyInput.visualBodyStart,
					);
					replacementMarkdown = result.sourceMarkdown;
					selection = {
						direction: result.selection.direction,
						end: region.sourceStart + result.selection.end,
						start: region.sourceStart + result.selection.start,
					};
				} else {
					const edited = serializeVisualMarkdownBlockFragment(blocks);
					const merged = mergeVisualMarkdownChangeDetails(
						sourceSlice,
						region.baseline,
						edited,
					);
					const relativeSelection = visualSelectionSourceRangeForBlocks(
						blocks,
						merged.value,
						edited,
					);
					replacementMarkdown = merged.value;
					selection = {
						direction: relativeSelection.direction,
						end: region.sourceStart + relativeSelection.end,
						start: region.sourceStart + relativeSelection.start,
					};
				}
				const value =
					source.slice(0, region.sourceStart) +
					replacementMarkdown +
					source.slice(region.sourceEnd);
				const restoreFocus = surface.ownerDocument.activeElement === surface;
				const adoptionFinalizers: Array<() => boolean> = [];
				adoptionTransaction = structuralChange && !structural;
				if (adoptionTransaction) {
					if (!prepareWindowBlockAdoption) {
						throw new Error("visual-editor-window-owner-unavailable");
					}
					for (const block of blocks) {
						const finalize = prepareWindowBlockAdoption(block);
						if (!finalize) {
							throw new Error("visual-editor-window-block-adoption-failed");
						}
						adoptionFinalizers.push(finalize);
					}
				}
				for (const finalize of adoptionFinalizers) {
					if (!finalize()) {
						throw new Error("visual-editor-window-block-adoption-failed");
					}
				}
				if (bodyInput) {
					restoreRegionCodeFenceMetadata(blocks, replacementMarkdown, {
						documentLength: value.length,
						end: region.sourceStart + replacementMarkdown.length,
					});
				}
				adoptionFinalized = adoptionTransaction;
				applyDocumentChange({
					changes: {
						from: region.sourceStart,
						insert: replacementMarkdown,
						to: region.sourceEnd,
					},
					deferNativeBridge: !structural,
					recordHistorySelection: true,
					selection,
					value,
				});
				documentChangeApplied = true;
				sourceRef.current = value;
				if (value !== source) onMarkdownChange();
				if (structural) {
					requestFormalPreview(
						value,
						{
							historyState: documentSession.document.getHistoryState(),
							restoreFocus,
							selection,
						},
						{ pinWindowSelection: true },
					);
				} else {
					updateBlockRanges(
						rangesRef.current,
						region,
						replacementMarkdown.length,
					);
					acceptedBlockSerializationsRef.current =
						captureAcceptedWindowedBlockSerializations(
							surface,
							rangesRef.current,
						);
					acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
				}
				protectVisualMarkdownReadOnlyRegions(surface);
				readOnlySnapshotRef.current =
					captureVisualMarkdownReadOnlySnapshot(surface);
				return true;
			} catch (error) {
				if (documentChangeApplied) {
					onTransferFailure();
					return report(error);
				}
				if (
					(adoptionTransaction && !adoptionFinalized) ||
					(bodyInput &&
						!documentChangeApplied &&
						documentSession.document.getValue() === source)
				) {
					try {
						restoreWindowRegion(surface, region);
					} catch (rollbackError) {
						return report(rollbackError);
					}
				}
				return report(error);
			}
		};
		const requestFormalPreview = (
			markdown: string,
			historySelection?: Readonly<{
				historyState: DocumentHistoryState;
				restoreFocus: boolean;
				selection: DocumentSelection;
				thematicBreakGap?: WindowedThematicBreakGap;
			}>,
			options: FormalPreviewOptions = {},
		): void => {
			releasePendingHistorySelection(pendingHistorySelectionRef);
			onPendingChange(true);
			let releaseDocumentEndPin: (() => void) | null = null;
			let onDocumentEndSelectionRestored: (() => void) | null = null;
			try {
				const shouldPinWindowSelection = Boolean(
					historySelection?.restoreFocus &&
						historySelection.historyState &&
						(options.pinWindowSelection ||
							(historySelection.selection.start === markdown.length &&
								historySelection.selection.end === markdown.length)),
				);
				let signature: string;
				if (shouldPinWindowSelection && historySelection) {
					const previewRequest = options.pinWindowSelection
						? requestPreviewAtDocumentEnd(
								markdown,
								options.pinSourceSelection ??
									historySelection.thematicBreakGap?.windowSelection ??
									historySelection.selection,
							)
						: requestPreviewAtDocumentEnd(markdown);
					signature = previewRequest.signature;
					onDocumentEndSelectionRestored =
						previewRequest.onSelectionRestored ?? null;
					releaseDocumentEndPin = previewRequest.release;
				} else {
					signature = requestPreview(markdown);
				}
				pendingRef.current = { markdown, signature };
				if (historySelection) {
					pendingHistorySelectionRef.current = {
						markdown,
						historyState: historySelection.historyState,
						onDocumentEndSelectionRestored,
						releaseDocumentEndPin,
						restoreFocus: historySelection.restoreFocus,
						selection: historySelection.selection,
						signature,
						...(historySelection.thematicBreakGap
							? { thematicBreakGap: historySelection.thematicBreakGap }
							: {}),
					};
				}
			} catch (error) {
				releaseDocumentEndPin?.();
				onPendingChange(false);
				throw error;
			}
		};
		const projectToolbarSelection = (): boolean => {
			try {
				const region = capture();
				const source = sourceRef.current;
				const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
				const relative = visualSelectionSourceRangeForBlocks(
					region.blocks,
					sourceSlice,
					region.baseline,
				);
				applyDocumentChange({
					selection: {
						direction: relative.direction,
						end: region.sourceStart + relative.end,
						start: region.sourceStart + relative.start,
					},
					value: source,
				});
				regionRef.current = null;
				return true;
			} catch (error) {
				return report(error);
			}
		};
		const replaceSelection = (value: string): boolean => {
			try {
				const region = capture();
				const source = sourceRef.current;
				const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
				const baselineSelection = visualSelectionSourceRangeForBlocks(
					region.blocks,
					sourceSlice,
					region.baseline,
				);
				const start = region.sourceStart + baselineSelection.start;
				const end = region.sourceStart + baselineSelection.end;
				const markdown = source.slice(0, start) + value + source.slice(end);
				const caret = start + value.length;
				applyDocumentChange({
					changes: { from: start, insert: value, to: end },
					deferNativeBridge: true,
					holdNativeBridge: true,
					recordHistorySelection: true,
					selection: { direction: "none", end: caret, start: caret },
					value: markdown,
				});
				sourceRef.current = markdown;
				onMarkdownChange();
				requestFormalPreview(markdown);
				return true;
			} catch (error) {
				return report(error);
			}
		};
		const runHistory = (redo: boolean): void => {
			if (!active || externalChangeReportedRef.current) return;
			const restoreFocus = surface.ownerDocument.activeElement === surface;
			selfWriteRef.current = true;
			let changed: boolean;
			try {
				changed = redo
					? documentSession.document.redo()
					: documentSession.document.undo();
			} finally {
				selfWriteRef.current = false;
			}
			if (!changed) return;
			const markdown = documentSession.document.getValue();
			const historySelection = documentSession.document.getSelection();
			const historyThematicBreakSelection =
				!redo &&
				historySelection.start < historySelection.end &&
				/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/u.test(
					markdown.slice(historySelection.start, historySelection.end),
				);
			const thematicBreakGap = [...thematicBreakDeletionHistoryRef.current]
				.reverse()
				.find((candidate) =>
					(redo
						? candidate.afterMarkdown === markdown &&
							sameDocumentSelection(
								documentSession.document.getSelection(),
								candidate.postSelection,
							)
						: candidate.beforeMarkdown === markdown &&
							sameDocumentSelection(
								documentSession.document.getSelection(),
								candidate.sourceSelection,
							)),
				);
			const restoresThematicBreak = Boolean(
				thematicBreakGap || historyThematicBreakSelection,
			);
			const selection = historySelection;
			const ordinaryHistoryWindowPin =
				restoreFocus &&
				!restoresThematicBreak &&
				selection.start !== selection.end
					? {
							pinSourceSelection: selection,
							pinWindowSelection: true,
						}
					: {};
			sourceRef.current = markdown;
			onMarkdownChange();
			requestFormalPreview(
				markdown,
				{
					historyState: documentSession.document.getHistoryState(),
					restoreFocus,
					selection,
						...(restoresThematicBreak && thematicBreakGap
						? { thematicBreakGap }
						: {}),
				},
				{
					...(restoresThematicBreak && (thematicBreakGap || historyThematicBreakSelection)
						? redo
							? thematicBreakGap?.windowSelection
								? { pinSourceSelection: thematicBreakGap.windowSelection }
								: {}
							: {
									pinSourceSelection: {
										end: historyThematicBreakSelection
											? historySelection.end
											: thematicBreakGap?.sourceSelection.end ?? historySelection.end,
										start: historyThematicBreakSelection
											? historySelection.start
											: thematicBreakGap?.sourceSelection.start ?? historySelection.start,
									},
							  }
						: {}),
					pinWindowSelection: Boolean(
						restoresThematicBreak &&
						(redo
							? thematicBreakGap?.windowSelection
							: historyThematicBreakSelection || thematicBreakGap),
					),
					...ordinaryHistoryWindowPin,
				},
			);
		};
		const hasImageFile = (transfer: DataTransfer | null): boolean =>
			Array.from(transfer?.items ?? []).some(
				(item) => "file" === item.kind && /^image\//i.test(item.type),
			) ||
			Array.from(transfer?.files ?? []).some((file) =>
				/^image\//i.test(file.type),
			);
		const handleBeforeInput = (event: InputEvent) => {
			visualInputBlock = null;
			if (rejectedComposition || rejectedBeforeInput) {
				if (event.cancelable) event.preventDefault();
				return;
			}
			const wholeDocumentDeletionInput =
				WINDOWED_WHOLE_DOCUMENT_DELETION_TYPES.has(event.inputType);
			if (!composing && !event.isComposing) codeBodyInput = null;
			if (
				pendingRef.current ||
				pendingPropRef.current ||
				!active ||
				externalChangeReportedRef.current
			) {
				event.preventDefault();
				return;
			}
			if (composing || event.isComposing) return;
			let wholeDocumentDeletion = false;
			if (wholeDocumentDeletionInput) {
				try {
					wholeDocumentDeletion = selectionCoversEditableSurface(
						surface,
						rangesRef.current,
					);
				} catch (error) {
					if (event.cancelable) event.preventDefault();
					report(error);
					return;
				}
			}
			if (wholeDocumentDeletion) {
				event.preventDefault();
				try {
					const source = sourceRef.current;
					const restoreFocus = surface.ownerDocument.activeElement === surface;
					const selection = {
						direction: "none" as const,
						end: 0,
						start: 0,
					};
					if (source) {
						applyDocumentChange({
							changes: { from: 0, insert: "", to: source.length },
							deferNativeBridge: false,
							recordHistorySelection: true,
							selection,
							value: "",
						});
						sourceRef.current = "";
						onMarkdownChange();
						requestFormalPreview("", {
							historyState: documentSession.document.getHistoryState(),
							restoreFocus,
							selection,
						});
					}
				} catch (error) {
					report(error);
				}
				return;
			}
			if (WINDOWED_THEMATIC_BREAK_DELETION_TYPES.has(event.inputType)) {
				let thematicBreak: WindowedThematicBreakPreparation | null = null;
				try {
					thematicBreak = prepareThematicBreakSelection();
				} catch (error) {
					if (event.cancelable) event.preventDefault();
					report(error);
					return;
				}
				if (thematicBreak) {
					if (!event.cancelable) {
						onTransferFailure();
						report(new Error("visual-editor-window-beforeinput-not-cancelable"));
						return;
					}
					event.preventDefault();
					let documentChangeApplied = false;
					try {
						const { selection, source } = thematicBreak;
						const value =
							source.slice(0, selection.start) + source.slice(selection.end);
						const postSelection: DocumentSelection = {
							direction: "none",
							end: selection.start,
							start: selection.start,
						};
						const gapEnd =
							thematicBreak.afterRange?.start ?? thematicBreak.range.end;
						const gap = source.slice(selection.end, gapEnd);
						const removedLength = selection.end - selection.start;
						const afterStart = thematicBreak.afterRange
							? thematicBreak.afterRange.start - removedLength
							: null;
						const beforeStart = thematicBreak.beforeRange
							? Math.max(
									thematicBreak.beforeRange.start,
									thematicBreak.beforeRange.end - 1,
								)
							: null;
						const windowSelection =
							gap &&
							null !== beforeStart &&
							null !== afterStart &&
							thematicBreak.beforeRange &&
							thematicBreak.afterRange
								? { end: afterStart, start: beforeStart }
								: null;
						const thematicBreakGap = gap
							? {
									afterBlockId: thematicBreak.afterRange?.id ?? null,
									...(thematicBreak.afterRange
										? {
												afterBlockSource: source.slice(
													thematicBreak.afterRange.start,
													thematicBreak.afterRange.end,
												),
										}
										: {}),
									afterMarkdown: value,
									beforeBlockId: thematicBreak.beforeRange?.id ?? null,
									...(thematicBreak.beforeRange
										? {
												beforeBlockSource: source.slice(
													thematicBreak.beforeRange.start,
													thematicBreak.beforeRange.end,
												),
										}
										: {}),
									beforeMarkdown: source,
									gap,
									postSelection,
									sourceSelection: selection,
									...(windowSelection ? { windowSelection } : {}),
								}
								: undefined;
						if (thematicBreakGap) {
							thematicBreakDeletionHistoryRef.current = [
								...thematicBreakDeletionHistoryRef.current,
								thematicBreakGap,
							].slice(-32);
						}
						const restoreFocus =
							surface.ownerDocument.activeElement === surface;
						regionRef.current = null;
						applyDocumentChange({ selection, value: source });
						applyDocumentChange({
							changes: {
								from: selection.start,
								insert: "",
								to: selection.end,
							},
							deferNativeBridge: false,
							isolateHistoryBefore: true,
							recordHistorySelection: true,
							selection: {
								direction: "none",
								end: selection.start,
								start: selection.start,
							},
							value,
						});
						documentChangeApplied = true;
						sourceRef.current = value;
						onMarkdownChange();
						requestFormalPreview(
							value,
							{
								historyState: documentSession.document.getHistoryState(),
								restoreFocus,
								selection: postSelection,
								...(thematicBreakGap ? { thematicBreakGap } : {}),
							},
							{
								...(windowSelection
									? { pinSourceSelection: windowSelection }
									: {}),
								pinWindowSelection:
						Boolean(windowSelection) ||
									(postSelection.start === value.length && value.length > 0),
							},
						);
					} catch (error) {
						if (documentChangeApplied) onTransferFailure();
						report(error);
					}
					return;
				}
			}
			if (
				"historyUndo" === event.inputType ||
				"historyRedo" === event.inputType
			) {
				event.preventDefault();
				runHistory("historyRedo" === event.inputType);
				return;
			}
			try {
				visualInputBlock = captureVisualCodeInputSnapshot(
					selectedVisualCodeBlock(surface),
				);
			} catch (error) {
				event.preventDefault();
				report(error);
				return;
			}
			try {
				normalizeVisualCaretAtDocumentBoundary(surface);
			} catch (error) {
				event.preventDefault();
				report(error);
				return;
			}
			let region: ActiveRegion | null = null;
			try {
				region = capture(
					["deleteContentBackward", "deleteWordBackward"].includes(
						event.inputType,
					)
						? "backward"
						: ["deleteContentForward", "deleteWordForward"].includes(
									event.inputType,
								)
							? "forward"
							: undefined,
				);
				if (visualInputBlock) {
					codeBodyInput = windowedCodeBodyInputIntent(
						event,
						visualInputBlock,
						region,
						sourceRef.current.slice(region.sourceStart, region.sourceEnd),
						sourceLineEndingBefore(sourceRef.current, region.sourceStart),
						onDiagnostic,
					);
				}
				syncVisibleSelection(region);
			} catch (error) {
				if (event.cancelable) {
					event.preventDefault();
					regionRef.current = null;
				} else if (region || regionRef.current) {
					const rejectedRegion = region ?? regionRef.current;
					if (!rejectedRegion)
						throw new Error("visual-editor-window-region-missing");
					rejectedBeforeInput = rejectedRegion;
					queueMicrotask(() => restoreRejectedBeforeInput(rejectedRegion));
				} else {
					onTransferFailure();
				}
				report(error);
			}
		};
		const handleInput = (event: InputEvent) => {
			const inputBlock = visualInputBlock;
			visualInputBlock = null;
			if (rejectedBeforeInput) {
				restoreRejectedBeforeInput(rejectedBeforeInput);
				return;
			}
			if (rejectedComposition) return;
			if (
				!active ||
				externalChangeReportedRef.current ||
				composing ||
				event.isComposing ||
				pendingRef.current
			)
				return;
			let recoverDetachedCode = false;
			if (
				codeBodyInput &&
				codeBodyInput.code.parentElement !== codeBodyInput.pre &&
				!isWindowedParagraphCodeSplit(codeBodyInput)
			) {
				const replacementCode = Array.from(codeBodyInput.pre.children).find(
					(child): child is HTMLElement =>
						child instanceof HTMLElement && "CODE" === child.tagName,
				);
				if (
					replacementCode ||
					codeBodyInput.code.parentNode ||
					codeBodyInput.code.isConnected
				) {
					const error = new Error("visual-editor-code-body-map-stale");
					const region = regionRef.current;
					if (region) {
						rejectedBeforeInput = region;
						restoreRejectedBeforeInput(region);
					}
					report(error);
					return;
				}
				codeBodyInput = { ...codeBodyInput, directBodyEdit: false };
				recoverDetachedCode = true;
			}
			if (
				codeBodyInput?.directBodyEdit &&
				WINDOWED_CODE_BODY_DELETION_TYPES.has(codeBodyInput.inputType) &&
				"" === visualCodeBodyDomText(codeBodyInput.code) &&
				!codeBodyInput.pre.hasAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE)
			) {
				codeBodyInput = { ...codeBodyInput, directBodyEdit: false };
			}
			try {
				if (!codeBodyInput?.directBodyEdit) {
					normalizeVisualCodePlaceholders(surface, event.inputType, inputBlock);
					unwrapWindowedCodePlaceholder(inputBlock);
					if (recoverDetachedCode && codeBodyInput) {
						const recovered = captureVisualCodeInputSnapshot(codeBodyInput.pre);
						if (
							!recovered?.placeholder ||
							recovered.codeClassName !==
								codeBodyInput.sourceCodeSnapshot.className
						) {
							throw new Error("visual-editor-code-body-map-stale");
						}
						codeBodyInput = { ...codeBodyInput, recoveredCode: recovered.code };
					}
				}
			} catch (error) {
				const region = regionRef.current;
				if (region) {
					rejectedBeforeInput = region;
					restoreRejectedBeforeInput(region);
				}
				report(error);
				return;
			}
			if (
				!["historyUndo", "historyRedo"].includes(event.inputType) &&
				!inputBlock &&
				!selectedVisualCodeBlock(surface)
			) {
				applyVisualInlineShortcut(surface);
			}
			commit();
		};
		const handleCompositionStart = () => {
			if (
				pendingRef.current ||
				externalChangeReportedRef.current ||
				rejectedComposition ||
				rejectedBeforeInput
			)
				return;
			visualInputBlock = null;
			codeBodyInput = null;
			let region: ActiveRegion | null = null;
			try {
				normalizeVisualCaretAtDocumentBoundary(surface);
				visualInputBlock = captureVisualCodeInputSnapshot(
					selectedVisualCodeBlock(surface),
				);
				region = capture();
				if (visualInputBlock) {
					codeBodyInput = windowedCodeBodyInputIntent(
						new InputEvent("beforeinput", {
							inputType: "insertCompositionText",
						}),
						visualInputBlock,
						region,
						sourceRef.current.slice(region.sourceStart, region.sourceEnd),
						sourceLineEndingBefore(sourceRef.current, region.sourceStart),
						onDiagnostic,
					);
				}
				syncVisibleSelection(region);
				composing = true;
			} catch (error) {
				report(error);
				const rejectedRegion = region ?? regionRef.current;
				if (rejectedRegion) {
					rejectedComposition = rejectedRegion;
				}
			}
		};
		const handleCompositionEnd = (event: CompositionEvent) => {
			if (externalChangeReportedRef.current) return;
			const rejectedRegion = rejectedComposition;
			if (rejectedRegion) {
				composing = false;
				queueMicrotask(() => {
					if (
						!active ||
						externalChangeReportedRef.current ||
						rejectedComposition !== rejectedRegion
					)
						return;
					rejectedComposition = null;
					composing = false;
					visualInputBlock = null;
					codeBodyInput = null;
					regionRef.current = null;
					try {
						restoreWindowRegion(surface, rejectedRegion);
					} catch (error) {
						report(error);
						onTransferFailure();
					}
				});
				return;
			}
			if (!composing) return;
			composing = false;
			if (codeBodyInput) {
				codeBodyInput = { ...codeBodyInput, data: event.data };
			}
			queueMicrotask(() => commit());
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				externalChangeReportedRef.current ||
				rejectedComposition ||
				rejectedBeforeInput
			) {
				event.preventDefault();
				return;
			}
			if (composing || event.isComposing) return;
			const key = event.key.toLowerCase();
			const historyShortcut =
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				("z" === key || ("y" === key && !event.shiftKey));
			if (pendingRef.current || pendingPropRef.current) {
				if (historyShortcut) event.preventDefault();
				return;
			}
			if (historyShortcut) {
				event.preventDefault();
				runHistory("y" === key || event.shiftKey);
				return;
			}
			const selectAllShortcut =
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				!event.shiftKey &&
				"a" === key;
			if (selectAllShortcut) {
				if (!(event.target instanceof Node) || !surface.contains(event.target))
					return;
				event.preventDefault();
				try {
					focusSurface(surface);
					selectSurfaceContents(surface);
				} catch (error) {
					report(error);
				}
				return;
			}
			if (!["Backspace", " ", "Enter"].includes(event.key)) return;
			if ("Backspace" === event.key) {
				let wholeDocumentSelection = false;
				try {
					wholeDocumentSelection = selectionCoversEditableSurface(
						surface,
						rangesRef.current,
					);
				} catch (error) {
					event.preventDefault();
					report(error);
					return;
				}
				if (wholeDocumentSelection) return;
				// A native range selecting one direct-child HR has no descendant
				// caret for captureActiveRegion(). Let beforeinput own the exact
				// marker deletion instead of reporting a false selection error.
				if (captureVisualThematicBreakSelection(surface)) return;
			}
			try {
				normalizeVisualCaretAtDocumentBoundary(surface);
			} catch (error) {
				event.preventDefault();
				report(error);
				return;
			}
			try {
				const region = capture();
				if (!applyVisualBlockShortcut(surface, event)) {
					regionRef.current = null;
					return;
				}
				regionRef.current = region;
				commit({ allowSingleBlockStructural: true });
			} catch (error) {
				report(error);
			}
		};
		const handlePaste = (event: ClipboardEvent) => {
			if (
				externalChangeReportedRef.current ||
				rejectedComposition ||
				rejectedBeforeInput
			) {
				event.preventDefault();
				return;
			}
			if (event.defaultPrevented) return;
			if (hasImageFile(event.clipboardData)) {
				if (!imageUploadEnabled || !imagePasteUploadEnabled) {
					event.preventDefault();
				}
				return;
			}
			event.preventDefault();
			const markdown = event.clipboardData?.getData("text/plain") ?? "";
			if (cancelPendingPaste) {
				report(new Error("visual-editor-markdown-paste-pending"));
				return;
			}
			const ownerWindow = surface.ownerDocument.defaultView;
			const runPaste = () => {
				cancelPendingPaste = null;
				if (!active || externalChangeReportedRef.current) return;
				if (pendingRef.current || pendingPropRef.current) {
					report(new Error("visual-editor-markdown-paste-superseded"));
					return;
				}
				replaceSelection(markdown);
			};
			const timer = ownerWindow
				? ownerWindow.setTimeout(runPaste, 0)
				: setTimeout(runPaste, 0);
			cancelPendingPaste = () => {
				if (ownerWindow) ownerWindow.clearTimeout(timer);
				else clearTimeout(timer);
			};
		};
		const handleDrop = (event: DragEvent) => {
			if (
				externalChangeReportedRef.current ||
				rejectedComposition ||
				rejectedBeforeInput
			) {
				event.preventDefault();
				return;
			}
			if (hasImageFile(event.dataTransfer)) {
				if (!imageUploadEnabled) event.preventDefault();
				return;
			}
			event.preventDefault();
			replaceSelection(event.dataTransfer?.getData("text/plain") ?? "");
		};
		const invalidateContextMenuSelection = (): void => {
			contextMenuSelectionRef.current = null;
		};
		const handleContextMenuSelectionChange = (): void => {
			const lease = contextMenuSelectionRef.current;
			if (!lease) return;
			const current = captureVisualSelection(surface);
			if (!current || !visualSelectionEqual(lease, current)) {
				invalidateContextMenuSelection();
			}
		};
		const handleContextMenuSurfaceFocus = (): void => {
			invalidateContextMenuSelection();
		};
		const unsubscribe = documentSession.document.subscribe(() => {
			if (
				active &&
				!selfWriteRef.current &&
				!externalChangeReportedRef.current &&
				documentSession.document.getValue() !== sourceRef.current
			) {
				externalChangeReportedRef.current = true;
				thematicBreakDeletionHistoryRef.current = [];
				releasePendingHistorySelection(pendingHistorySelectionRef);
				onCanonicalDocumentChange();
			}
		});

		surface.addEventListener("beforeinput", handleBeforeInput);
		surface.addEventListener("input", handleInput);
		surface.addEventListener("compositionstart", handleCompositionStart);
		surface.addEventListener("compositionend", handleCompositionEnd);
		surface.addEventListener("keydown", handleKeyDown);
		surface.addEventListener("paste", handlePaste);
		surface.addEventListener("drop", handleDrop);
		surface.ownerDocument.addEventListener(
			"selectionchange",
			handleContextMenuSelectionChange,
			true,
		);
		surface.addEventListener("focusin", handleContextMenuSurfaceFocus);
		const runtime: ImmersiveVisualEditorRuntime = {
			applyCanonicalChange(request) {
				if (
					!active ||
					externalChangeReportedRef.current ||
					pendingRef.current ||
					pendingPropRef.current
				)
					return "blocked";
				let canonicalApplied = false;
				try {
					if (composing) {
						composing = false;
						if (!regionRef.current || !commit()) return "failed";
					}
					if (pendingRef.current || pendingPropRef.current) {
						return "blocked";
					}
					const currentValue = documentSession.document.getValue();
					assertVisualCanonicalChangeRequest(
						request,
						documentSession.document.getRevision?.(),
						currentValue,
						documentSession.document.getSelection(),
					);
					const readOnlySnapshot = readOnlySnapshotRef.current;
					if (!readOnlySnapshot) {
						throw new Error("visual-editor-window-read-only-snapshot-missing");
					}
					assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
					assertMountedEditableBlocksMatchAccepted(
						surface,
						rangesRef.current,
						acceptedBlockSerializationsRef.current,
						acceptedWindowChildNodesRef.current,
					);
					const restoreFocus = surface.ownerDocument.activeElement === surface;
					applyDocumentChange({
						changes: request.change.changes,
						recordHistorySelection: true,
						selection: request.change.selection,
						value: request.change.value,
					});
					canonicalApplied = true;
					sourceRef.current = request.change.value;
					onMarkdownChange();
					requestFormalPreview(
						request.change.value,
						{
							historyState: documentSession.document.getHistoryState(),
							restoreFocus,
							selection: request.change.selection,
						},
						{ pinWindowSelection: true },
					);
					return "handled";
				} catch (error) {
					if (canonicalApplied) onTransferFailure();
					report(error);
					return "failed";
				}
			},
			executeCommand(command) {
				if (
					!active ||
					externalChangeReportedRef.current ||
					pendingRef.current ||
					pendingPropRef.current
				)
					return "blocked";
				let commandRegion: ActiveRegion | null = null;
				let committed = false;
				let commandSource = "";
				try {
					const preservedSelection = contextMenuSelectionRef.current;
					contextMenuSelectionRef.current = null;
					const currentSelection = captureVisualSelection(surface);
					const activeElement = surface.ownerDocument.activeElement;
					const menuHasFocus =
						activeElement instanceof Element &&
						Boolean(
							activeElement.closest("[data-easymde-context-menu-layer]"),
						);
					const consumesContextMenuSelection = Boolean(
						preservedSelection &&
							(currentSelection
								? visualSelectionEqual(preservedSelection, currentSelection)
								: menuHasFocus),
					);
					if (consumesContextMenuSelection && preservedSelection) {
						try {
							restoreVisualSelection(surface, preservedSelection);
						} catch {
							return "failed";
						}
					}
					const selection = surface.ownerDocument.defaultView?.getSelection();
					if (!selection?.anchorNode || !selection.focusNode) {
						return "unsupported";
					}
					commandSource = sourceRef.current;
					commandRegion = capture();
					if (!applyVisualToolbarCommand(surface, command)) {
						regionRef.current = null;
						return "unsupported";
					}
					committed = commit({ allowSingleBlockStructural: true });
					if (committed) {
						focusSurface(surface);
						return "handled";
					}
					if (
						sourceRef.current !== commandSource ||
						documentSession.document.getValue() !== commandSource
					) {
						focusSurface(surface);
						return "failed";
					}
					try {
						restoreWindowRegion(surface, commandRegion);
						focusSurface(surface);
					} catch (restoreError) {
						report(restoreError);
					}
					return "failed";
				} catch (error) {
					if (!committed && commandRegion) {
						try {
							restoreWindowRegion(surface, commandRegion);
							focusSurface(surface);
						} catch (restoreError) {
							report(restoreError);
						}
					}
					report(error);
					return "failed";
				}
			},
			isEditable: () => Boolean(active && !externalChangeReportedRef.current),
			getGeneratedPreviewIdentity: () =>
				getGeneratedPreviewIdentity?.() ?? null,
			prepareGeneratedContentTarget: (request) =>
				prepareGeneratedContentTarget?.(request) ?? null,
			prepareGeneratedContentTargetForSelection: (request) =>
				prepareGeneratedContentTargetForSelection?.(request) ?? null,
			prepareImageTarget: (request) => prepareImageTarget?.(request) ?? null,
			prepareImageTargetBySelection: (request) =>
				prepareImageTargetBySelection?.(request) ?? null,
			prepareMediaSelection() {
				if (
					!active ||
					externalChangeReportedRef.current ||
					pendingRef.current ||
					pendingPropRef.current
				)
					return false;
				try {
					const thematicBreak = prepareThematicBreakSelection();
					const source = thematicBreak?.source ?? sourceRef.current;
					if (thematicBreak) {
						applyDocumentChange({
							selection: thematicBreak.selection,
							value: source,
						});
						regionRef.current = null;
						return true;
					}
					const region = capture();
					const sourceSlice = source.slice(
						region.sourceStart,
						region.sourceEnd,
					);
					const relative = visualSelectionSourceRangeForBlocks(
						region.blocks,
						sourceSlice,
						region.baseline,
					);
					applyDocumentChange({
						selection: {
							direction: relative.direction,
							end: region.sourceStart + relative.end,
							start: region.sourceStart + relative.start,
						},
						value: source,
					});
					regionRef.current = null;
					return true;
				} catch (error) {
					return report(error);
				}
			},
			prepareContextMenuSelection(target, point) {
				const provenance = classifyVisualSelectionProvenance(
					surface,
					surface.ownerDocument.defaultView?.getSelection(),
				);
				if ("straddling" === provenance) {
					// A selection that straddles or encloses the editable
					// surface keeps the browser's own selection: overwriting it
					// with an image or caret would silently discard the user's
					// intent, so the gesture is rejected explicitly instead.
					return false;
				}
				const resolvedTarget = resolveLiveContextMenuTarget(
					surface,
					target,
					contextMenuTargetsRef.current,
					acceptedWindowSnapshotIdentityRef.current,
				);
				if (target && !resolvedTarget) {
					// The target was never captured by a live prepare, or an
					// accepted Preview window re-render replaced it and its
					// visual block/image identity cannot be restored. Fail
					// explicitly instead of silently preparing the
					// surface-level caret or rebinding the action to the block.
					return false;
				}
				selectVisualImageForContextMenu(surface, resolvedTarget);
				let preparedSelection: VisualSelectionSnapshot | null = null;
				try {
					preparedSelection = captureVisualSelection(surface);
				} catch {
					preparedSelection = null;
				}
				contextMenuSelectionRef.current = null;
				const finishPreparation = (result: boolean): boolean => {
					if (result) contextMenuSelectionRef.current = preparedSelection;
					return result;
				};
				const targetThematicBreak = resolvedTarget?.closest("hr");
				if (
					targetThematicBreak
					&& surface.contains(targetThematicBreak)
				) {
					try {
						const thematicBreak = prepareThematicBreakSelection();
						if (!thematicBreak) {
							throw new Error("visual-editor-selection-map-failed");
						}
						applyDocumentChange({
							selection: thematicBreak.selection,
							value: thematicBreak.source,
						});
						regionRef.current = null;
						return finishPreparation(true);
					} catch (error) {
						return report(error);
					}
				}
				const pre = resolvedTarget?.closest("pre");
				const preOwner = pre ? rootBlock(surface, pre) : null;
				const isDirectPre = Boolean(pre && preOwner === pre);
				let nativeSelection = surface.ownerDocument.defaultView?.getSelection();
				const selectionResolvesToBlocks = (): boolean => {
					const selection = surface.ownerDocument.defaultView?.getSelection();
					if (
						!selection?.anchorNode
						|| !selection.focusNode
						|| !selection.anchorNode.isConnected
						|| !selection.focusNode.isConnected
						|| !surface.contains(selection.anchorNode)
						|| !surface.contains(selection.focusNode)
					) {
						return false;
					}
					return Boolean(
						rootBlock(surface, selection.anchorNode)
						&& rootBlock(surface, selection.focusNode),
					);
				};
				const selectionInsideSurface = selectionResolvesToBlocks();
				if (
					!selectionInsideSurface
					&& !isDirectPre
					&& !placeContextMenuCaret(
						surface,
						resolvedTarget ?? target ?? null,
						point,
					)
				) {
					return finishPreparation(false);
				}
				if (!selectionInsideSurface && !isDirectPre) {
					nativeSelection = surface.ownerDocument.defaultView?.getSelection();
					if (!selectionResolvesToBlocks()) return finishPreparation(false);
				}
				if (!pre || !surface.contains(pre)) {
					try {
						const source = sourceRef.current;
						const region = capture();
						const sourceSlice = source.slice(
							region.sourceStart,
							region.sourceEnd,
						);
						const relative = visualSelectionSourceRangeForBlocks(
							region.blocks,
							sourceSlice,
							region.baseline,
						);
						applyDocumentChange({
							selection: {
								direction: relative.direction,
								end: region.sourceStart + relative.end,
								start: region.sourceStart + relative.start,
							},
							value: source,
						});
						regionRef.current = null;
						return finishPreparation(true);
					} catch (error) {
						return report(error);
					}
				}
				if (preparedSelection && nativeSelection && !nativeSelection.isCollapsed) {
					try {
						return finishPreparation(this.prepareMediaSelection());
					} catch (error) {
						return report(error);
					}
				}
				try {
					const owner = rootBlock(surface, pre);
					if (owner !== pre) {
						return finishPreparation(this.prepareMediaSelection());
					}
					const blockId = owner?.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
					const range = blockId ? rangesRef.current.get(blockId) : null;
					const source = sourceRef.current;
					if (!range?.editable || null === source) {
						return finishPreparation(this.prepareMediaSelection());
					}
					applyDocumentChange({
						selection: {
							direction: "none",
							end: range.end,
							start: range.start,
						},
						value: source,
					});
					return finishPreparation(true);
				} catch (error) {
					return report(error);
				}
			},
			prepareSourceNavigation(expected) {
				if (
					!active ||
					externalChangeReportedRef.current ||
					pendingRef.current ||
					pendingPropRef.current
				)
					return false;
				try {
					if (composing) {
						composing = false;
						if (!regionRef.current || !commit()) return false;
					}
					if (pendingRef.current || pendingPropRef.current)
						throw new Error("visual-editor-window-source-navigation-pending");
					const revision = documentSession.document.getRevision?.();
					if (
						!Number.isSafeInteger(expected.revision) ||
						expected.revision < 0 ||
						undefined === revision ||
						revision !== expected.revision ||
						documentSession.document.getValue() !== expected.value ||
						sourceRef.current !== expected.value
					) {
						throw new Error("visual-editor-window-source-navigation-stale");
					}
					const readOnlySnapshot = readOnlySnapshotRef.current;
					if (!readOnlySnapshot) {
						throw new Error("visual-editor-window-read-only-snapshot-missing");
					}
					assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
					assertMountedEditableBlocksMatchAccepted(
						surface,
						rangesRef.current,
						acceptedBlockSerializationsRef.current,
						acceptedWindowChildNodesRef.current,
					);
					return true;
				} catch (error) {
					return report(error);
				}
			},
			prepareToolbarFallback() {
				if (externalChangeReportedRef.current) return false;
				if (composing && regionRef.current) {
					composing = false;
					if (!commit()) return false;
				}
				const selection = surface.ownerDocument.defaultView?.getSelection();
				if (
					!selection?.anchorNode ||
					!selection.focusNode ||
					!surface.contains(selection.anchorNode) ||
					!surface.contains(selection.focusNode) ||
					!rootBlock(surface, selection.anchorNode) ||
					!rootBlock(surface, selection.focusNode)
				)
					return true;
				return projectToolbarSelection();
			},
			surface,
		};
		onReady(runtime);
		return () => {
			active = false;
			thematicBreakDeletionHistoryRef.current = [];
			releasePendingHistorySelection(pendingHistorySelectionRef);
			cancelPendingPaste?.();
			cancelPendingPaste = null;
			unsubscribe();
			surface.removeEventListener("beforeinput", handleBeforeInput);
			surface.removeEventListener("input", handleInput);
			surface.removeEventListener("compositionstart", handleCompositionStart);
			surface.removeEventListener("compositionend", handleCompositionEnd);
			surface.removeEventListener("keydown", handleKeyDown);
			surface.removeEventListener("paste", handlePaste);
			surface.removeEventListener("drop", handleDrop);
			surface.ownerDocument.removeEventListener(
				"selectionchange",
				handleContextMenuSelectionChange,
				true,
			);
			surface.removeEventListener("focusin", handleContextMenuSurfaceFocus);
			contextMenuSelectionRef.current = null;
			documentSession.document.setVisualEditingActive(false);
			onPendingChange(false);
			onDispose(runtime);
		};
	}, [
		documentSession,
		imagePasteUploadEnabled,
		imageUploadEnabled,
		onCanonicalDocumentChange,
		onDiagnostic,
		onDispose,
		onFailure,
		onMarkdownChange,
		onPendingChange,
		onReady,
		prepareGeneratedContentTarget,
		prepareGeneratedContentTargetForSelection,
		prepareImageTargetBySelection,
		prepareWindowBlockAdoption,
		requestPreview,
		requestPreviewAtDocumentEnd,
		surface,
	]);

	return null;
}
