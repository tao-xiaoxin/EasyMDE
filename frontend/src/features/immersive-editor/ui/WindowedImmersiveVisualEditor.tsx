import { useLayoutEffect, useRef } from "@wordpress/element";
import { markdownLanguage } from "@codemirror/lang-markdown";

import type { PreviewAcceptedWindowRow, PreviewAcceptedWindowRowRequest, PreviewEditMap } from "../../../contracts/ports/preview-request";
import type { PreviewCompositionSurfaceLease } from "../../live-preview/ui/PreviewSurfaceOwner";
import type { ReferenceLabelCaseFoldProfile } from "../../../contracts/ports/editor-block-index-port";
import {
	isMarkdownTerminalWhitespaceSuffix,
	markdownLineStarts,
} from "../../../shared/markdown/markdown-line-model";
import type {
	DocumentHistoryState,
	DocumentSelection,
	DocumentTextChangeRange,
} from "../../document-source/adapters/code-mirror-document-session";
import type { EditorDocumentSession } from "../../document-source/editor-document-session";
import {
	applyVisualBlockShortcut,
	applyVisualInlineShortcut,
	applyVisualMarkdownEditIntent,
	applyVisualToolbarCommand,
	assertVisualMarkdownReadOnlySnapshot,
	captureVisualSelection,
	certifiedTextTailGapSlice,
	captureVisualCodeInputSnapshot,
	captureVisualMarkdownReadOnlySnapshot,
	captureVisualThematicBreakSelection,
	prepareVisualThematicBreakPointerSelection,
	classifyVisualSelectionProvenance,
	coversMarkdownUnits,
	createVisualImageInteraction,
	createVisualMarkdownImageSourceIntervalMap,
	createVisualMarkdownSourceRangeFromPreviewEditMap,
	expandVisualCodeFenceForBody,
	isVisualThematicBreakSource,
	mergeVisualMarkdownChangeDetails,
	VisualMarkdownMergeError,
	nextGraphemeBoundary,
	normalizeVisualCaretAtDocumentBoundary,
	normalizeVisualCodePlaceholders,
	previousGraphemeBoundary,
	projectVisualCodeBodySelection,
	projectVisualLiteralFencePrefix,
	projectVisualLiteralParagraphLine,
	isMarkdownFenceOpeningLine,
	projectVisualCodeFenceMetadata,
	projectVisualMarkdownRemovalSelection,
	protectVisualMarkdownReadOnlyRegions,
	reconcileVisualCodeBodyDom,
	restoreVisualSelection,
	serializeVisualMarkdownBlockFragment,
	VISUAL_MARKDOWN_READ_ONLY_SELECTOR,
  type VisualCodeInputSnapshot,
  type VisualCodeBodySelectionProjection,
  type VisualCodeFenceBodyExpansion,
  type VisualMarkdownReadOnlySnapshot,
  type VisualMarkdownSourceIntervalMap,
  type VisualSelectionSnapshot,
  type VisualStructuralBoundaryBlock,
  type VisualThematicBreakPointerPreparation,
	visualBoundarySourceOffset,
	visualBoundaryForImageSourceEdge,
	visualSourceRangeForRenderedImage,
	visualRetiredInlineSourceRange,
	applyVisualCodeFenceMetadataFromSource,
	visualCaretBoundaryFromSourceOffset,
	visualCodeFenceRootSourceOffset,
	visualCodeBodyDomOffset,
	visualCodeBodyDomText,
	visualCodeBodyIntervalAtOrdinal,
	visualCodeBodyIntervals,
	visualCodeBodyOrdinalForSourceRange,
	visualContextMenuCaretRangeAtPoint,
	visualSelectionSourceRangeForBlocks,
	visualSourceEscapeDeletionRange,
	resolveVisualStructuralKeyboardContextGap,
	visualStructuralBoundaryBlocks,
	visualStructuralBoundaryCapture,
	visualStructuralBoundarySnapshot,
	visualStructuralBoundaryTokenNear,
	visualStructuralParagraphInsertion,
	placeVisualStructuralBoundarySelection,
	visualThematicBreakSourceSelection,
} from "../visual-markdown";
import type {
	ImmersiveVisualEditorProps,
	ImmersiveVisualEditorRuntime,
	ImmersiveWindowAcceptedSnapshot,
} from "./ImmersiveVisualEditor";
import type { EditorContextMenuTargetLease } from "../../editor-context-menu/EditorContextMenuFeature";
import { markdownReferenceContextQuery, markdownReferenceLabelQuery, type MarkdownSyntaxNode } from "../../editor-context-menu/editor-markdown-link-preparation";
import { prepareVisualProtectedNodeAdoption } from "../../../shared/dom/visual-protected-node-adoption";
import { assertVisualCanonicalChangeRequest, nativeTerminalSpaceArtifact } from "./ImmersiveVisualEditor";

const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";
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

/**
 * A direct surface root the browser cannot merge into a neighbouring text
 * block: an object the caret cannot enter (thematic break, rendered math,
 * mermaid). Backspace at the visual start of the next block removes the whole
 * object instead of asking Chromium to merge across it.
 *
 * This classifier answers only "can the caret enter this root"; it does not
 * license removing the root's source. A table container is also a `section`,
 * yet its cells hold the caret. Source removal asks
 * `isWindowedAtomicRemovalRoot`, which adds the interior proof below.
 */
function isWindowedAtomicRoot(node: HTMLElement): boolean {
	if (node instanceof HTMLHRElement) return true;
	if (node.matches("section, .easymde-table-container")) return true;
	if (node.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)) {
		return !node.matches(".easymde-toc, .footnotes-sep, .footnotes");
	}
	return false;
}

/**
 * Whether a root carries an editable interior: a descendant that can hold a
 * caret. Deleting such a root as one object would destroy text the user can
 * still edit, so adjacent-object removal may only act on a root that has
 * none - a thematic break or a rendered protected object. A table (cells), a
 * list (items) or a paragraph is an editable interior: its edge is a text
 * join, never an object deletion.
 *
 * This is the Full surface's `hasEditableVisualInterior` contract, kept
 * identical so both owners classify the same DOM the same way.
 */
function hasEditableWindowedInterior(node: HTMLElement): boolean {
	return null !== node.querySelector("table, td, th, li, p, pre");
}

/**
 * A root adjacent-object removal may delete as one object: an atomic root
 * with no descendant that can hold a caret. A table container is a
 * `section`, so the root classifier alone called it atomic and one
 * Backspace deleted the whole table; the Full surface already excludes such
 * roots the same way (`isAtomicVisualRoot` + `hasEditableVisualInterior`).
 */
function isWindowedAtomicRemovalRoot(node: HTMLElement): boolean {
	return isWindowedAtomicRoot(node) && !hasEditableWindowedInterior(node);
}

/** Whether the collapsed native caret is at the visual start of `block`. */
function caretAtWindowedRootStart(block: HTMLElement): boolean {
	const selection = block.ownerDocument.defaultView?.getSelection();
	if (
		!selection?.isCollapsed ||
		selection.rangeCount !== 1 ||
		!selection.anchorNode ||
		selection.anchorNode !== selection.focusNode ||
		selection.anchorOffset !== selection.focusOffset ||
		!block.contains(selection.anchorNode)
	) return false;
	const prefix = block.ownerDocument.createRange();
	prefix.selectNodeContents(block);
	prefix.setEnd(selection.anchorNode, selection.anchorOffset);
	return "" === prefix.toString().trim();
}

/** Whether the collapsed native caret is at the visual end of `block`. */
function caretAtWindowedRootEnd(block: HTMLElement): boolean {
	const selection = block.ownerDocument.defaultView?.getSelection();
	if (
		!selection?.isCollapsed ||
		selection.rangeCount !== 1 ||
		!selection.anchorNode ||
		selection.anchorNode !== selection.focusNode ||
		selection.anchorOffset !== selection.focusOffset ||
		!block.contains(selection.anchorNode)
	) return false;
	const suffix = block.ownerDocument.createRange();
	suffix.selectNodeContents(block);
	suffix.setStart(selection.anchorNode, selection.anchorOffset);
	return "" === suffix.toString().trim();
}

/** The last source character of a block's own lines, without its line ending. */
function windowedBlockTextEnd(
	source: string,
	range: Readonly<{ end: number; start: number }>,
): number {
	let end = range.end;
	while (end > range.start && ("\n" === source[end - 1] || "\r" === source[end - 1])) {
		end -= 1;
	}
	return end;
}

/**
 * The syntax nodes that spell no rendered character of their own: a link's
 * destination, label and title, a fence's info string, an HTML tag, an
 * entity's spelling, an escape, a horizontal rule, a table's pipes, a task
 * checkbox. Every `…Mark` node (emphasis, code, link, strikethrough, list,
 * header, quote) is the same kind of syntax.
 */
const UNRENDERED_MARKDOWN_SYNTAX: ReadonlySet<string> = new Set([
	"CodeInfo",
	"Comment",
	"CommentBlock",
	"Entity",
	"Escape",
	"HTMLTag",
	"HorizontalRule",
	"LinkLabel",
	"LinkTitle",
	"TableDelimiter",
	"TaskMarker",
	"URL",
]);

/**
 * The source spellings the renderer consumes as syntax of its own but which no
 * Markdown parser node names: the inline and display math delimiters and the
 * footnote reference opener. The renderer, not the Lezer grammar, decides
 * these, so this list has to track the renderer's own rules.
 */
const UNRENDERED_MARKDOWN_SPELLINGS: ReadonlyArray<string> = ["$$", "$", "[^"];

/**
 * The node the last parse resolved at a deletion's own end. A Backspace at the
 * document end asks again about the same terminal block until the document
 * changes, and the block cannot change without one, so the parse is reused
 * instead of repeated on every press.
 */
let renderedMarkdownUnitNode: Readonly<{
	limit: number;
	name: string;
	source: string;
}> | null = null;

function renderedMarkdownUnitNodeName(source: string, limit: number): string {
	if (
		renderedMarkdownUnitNode?.source !== source ||
		renderedMarkdownUnitNode.limit !== limit
	) {
		renderedMarkdownUnitNode = {
			limit,
			name: markdownLanguage.parser.parse(source).resolveInner(limit - 1, 1).name,
			source,
		};
	}
	return renderedMarkdownUnitNode.name;
}

/**
 * Whether `[start, end)` of a block's own source is one whole rendered
 * Markdown unit.
 *
 * A document-end deletion has no mounted row to read the visible character
 * from, so it may only remove bytes that render. `coversMarkdownUnits` refuses
 * a range that splits a backslash escape, and the parser refuses a range whose
 * last character is syntax that renders nothing of its own: the `*` of
 * `**bold**`, the closing backtick of `` `code` ``, the `)` of `[a](url)`.
 * Deleting such a delimiter would silently rewrite the block's Markdown where
 * the mounted row deletes the last visible character instead.
 *
 * `source` is the block's real source, line endings included: the parser only
 * names a hard break when it can see the line ending that marker precedes, so
 * the fragment may not be trimmed to the text end. Only the resolved offset is
 * clamped, after the parse.
 */
function coversRenderedMarkdownUnit(
	source: string,
	start: number,
	end: number,
): boolean {
	if (end <= start) return false;
	const limit = Math.min(end, source.length);
	if (limit <= start || !coversMarkdownUnits(source, start, limit)) return false;
	const nodeName = renderedMarkdownUnitNodeName(source, limit);
	if (nodeName.endsWith("Mark") || UNRENDERED_MARKDOWN_SYNTAX.has(nodeName)) {
		return false;
	}
	// A hard break that ends the paragraph has no node of its own: the marker
	// renders the `<br>` after it, so deleting the marker alone would remove
	// more than the one visible unit this proof promises.
	if ("\\" === source[limit - 1] && /^[\r\n]/u.test(source.slice(limit))) {
		return false;
	}
	// The deleted grapheme may be only the last byte of an editor-only
	// spelling, so the source up to the deletion end is what names it.
	const head = source.slice(0, limit);
	return !UNRENDERED_MARKDOWN_SPELLINGS.some((spelling) =>
		head.endsWith(spelling),
	);
}

type Props = ImmersiveVisualEditorProps &
	Readonly<{
		referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile;
		acceptedWindowSnapshotGeneration?: number;
		editMap: PreviewEditMap;
		getAcceptedWindowSnapshot?: () => ImmersiveWindowAcceptedSnapshot | null;
		getAcceptedWindowRow?: (request: PreviewAcceptedWindowRowRequest) => PreviewAcceptedWindowRow | null;
		getAcceptedReferenceSource?: (request: Readonly<{ revision: number; signature: string }>) => string | null;
		revealAcceptedWindowRow?: (request: PreviewAcceptedWindowRowRequest & Readonly<{
			gap: HTMLElement; source: string; sourceRevision: number;
			onRefusal?: (reason: string, details: Readonly<Record<string, boolean | number>>) => void;
		}>) => ImmersiveWindowAcceptedSnapshot | null;
		prepareWindowBlockAdoption: (node: HTMLElement) => (() => boolean) | null;
		retainCompositionSurface: () => PreviewCompositionSurfaceLease;
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
	private readonly endAdjustments = new Map<number, number>();
	private readonly shifts: number[];
	/** The shift an edit before every editable row gives all of them. */
	private leadingShift = 0;

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
			end: range.baseEnd + this.leadingShift + this.prefix(range.index + 1)
				+ (this.endAdjustments.get(range.index) ?? 0),
			start: range.baseStart + this.leadingShift + this.prefix(range.index),
		};
	}

	get size(): number {
		return this.byId.size;
	}

	/**
	 * Move the rows through one canonical replacement of [from, to) by
	 * `insertLength` units. The owner is the last editable row starting at or
	 * before `from`: it keeps its start, and its end absorbs only what the
	 * edit removed from or inserted into that row. Every later row moves by
	 * the whole delta, and an edit before every editable row moves them all.
	 * A protected row carries no source extent, so it can never own an edit.
	 */
	transport(from: number, to: number, insertLength: number): void {
		const delta = insertLength - (to - from);
		let owner: EffectiveBlockRange | null = null;
		for (const range of this.byId.values()) {
			if (!range.editable) continue;
			const effective = this.get(range.id);
			if (effective && effective.start <= from
				&& (!owner || effective.index > owner.index)) owner = effective;
		}
		if (!owner) {
			this.leadingShift += delta;
			return;
		}
		const removedInside = Math.max(
			0,
			Math.min(owner.end, to) - Math.max(owner.start, from),
		);
		const insertedInside = from < owner.end ? insertLength : 0;
		this.applyDelta(owner.index, delta, insertedInside - removedInside);
	}

	/**
	 * Shift every row after `index` by `delta`. The row at `index` is the one
	 * whose end this edit can reach, so its own end moves by `endDelta`: the
	 * bytes the edit removed from inside that row, never more. A deletion that
	 * lies entirely after the row's end removes none of it.
	 */
	private applyDelta(index: number, delta: number, endDelta: number = delta): void {
		for (
			let cursor = index + 1;
			cursor < this.shifts.length;
			cursor += cursor & -cursor
		) {
			this.shifts[cursor] = (this.shifts[cursor] ?? 0) + delta;
		}
		if (endDelta !== delta) {
			this.endAdjustments.set(index,
				(this.endAdjustments.get(index) ?? 0) + endDelta - delta);
		}
	}

	hasEditableAfter(index: number): boolean {
		return Array.from(this.byId.values()).some(
			(range) => range.index > index && range.editable,
		);
	}

	/** The next accepted editable source row after this index, mounted or not. */
	nextEditableAfter(index: number): EffectiveBlockRange | null {
		let next: MutableBlockRange | null = null;
		for (const range of this.byId.values()) {
			if (range.index <= index || !range.editable) continue;
			if (!next || range.index < next.index) next = range;
		}
		return next ? this.get(next.id) : null;
	}

	all(): ReadonlyArray<EffectiveBlockRange> {
		return Array.from(this.byId.values()).flatMap((range) => {
			const effective = this.get(range.id);
			return effective ? [effective] : [];
		});
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
	imageProjection?: VisualMarkdownSourceIntervalMap;
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
	emptyCodeGap?: WindowedEmptyCodeGap;
}>;

/**
 * A text deletion the browser already performed while a formal Preview was
 * outstanding. The owner publishes it from the mutated DOM against the pending
 * source lease in the following `input` event.
 */
type PendingNativeTextDeletion = Readonly<{
	baseline: string;
	block: HTMLElement;
	blockId: string;
	blockIndex: number;
	caret: number;
	inputType: string;
	source: string;
	sourceEnd: number;
	sourceSlice: string;
	sourceStart: number;
	targetCollapsed: boolean;
	imageProjection?: VisualMarkdownSourceIntervalMap;
	imageDeletion?: Readonly<{ from: number; to: number; expected: HTMLElement; removed: Node; retained: ReadonlyArray<Node>; parent: Node; index: number;
		preceding: Readonly<{ node: Text; data: string; expected: Text }> | null }>;
}>;

type DeletionDirection = "backward" | "forward";

type CommitOptions = Readonly<{
	allowSingleBlockStructural?: boolean;
	/**
	 * A trusted IME replacement commit whose pre-edit origin is still the live
	 * canonical source. The commit may settle both carets on the insertion end
	 * only when the whole resulting value proves that exact insertion; a
	 * drifted native caret is not authoritative for it.
	 */
	compositionCommit?: Readonly<{ insertionEnd: number; value: string }>;
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

/** Issued only by this owner's authenticated empty-PRE to paragraph command. */
type WindowedEmptyCodeGap = Readonly<{
	before: Readonly<{ start: number; end: number; source: string }>;
	after: Readonly<{ start: number; end: number; source: string }>;
	codeBodySourceRange?: Readonly<{ end: number; start: number }>;
	markdown: string;
	selection: DocumentSelection;
	revision: number;
	historyState: DocumentHistoryState;
	presentation: HTMLElement;
	presentationHtml: string;
	accepted: boolean;
	draftSourceStart?: number;
	/**
	 * This gap sits after the document's last block, so the paragraph is the
	 * surface's own editable document-end position. Chromium cannot hold a
	 * caret at the host boundary after a trailing object, so that position must
	 * be a real paragraph; unlike the between-rows gaps, Backspace here removes
	 * the preceding object instead of collapsing onto its row.
	 */
	documentEnd?: boolean;
}>;

/**
 * One canonical grapheme removal at a certified document end whose terminal row
 * is not mounted. `from`/`to` is the exact source interval the deletion owns and
 * `selection` is the caret it leaves behind, on the terminal row's own text end.
 */
type WindowedDocumentEndDeletion = Readonly<{
	from: number;
	selection: DocumentSelection;
	to: number;
	value: string;
}>;

function rememberEmptyCodeGap(
	history: Map<number, WindowedEmptyCodeGap>,
	gap: WindowedEmptyCodeGap,
): void {
	history.set(gap.historyState.undoDepth, gap);
	while (history.size > 32) {
		const oldest = history.keys().next().value;
		if (oldest === undefined) break;
		history.delete(oldest);
	}
}

function emptyCodeGapMatchesDocument(
	gap: WindowedEmptyCodeGap,
	document: EditorDocumentSession["document"],
): boolean {
	return document.getValue() === gap.markdown
		&& document.getRevision?.() === gap.revision
		&& sameDocumentSelection(document.getSelection(), gap.selection)
		&& sameDocumentHistoryState(document.getHistoryState(), gap.historyState);
}

function emptyCodeGapPresentationMatchesDocument(
	gap: WindowedEmptyCodeGap,
	document: EditorDocumentSession["document"],
): boolean {
	return document.getValue() === gap.markdown
		&& document.getRevision?.() === gap.revision
		&& sameDocumentHistoryState(document.getHistoryState(), gap.historyState)
		&& gap.presentation.isConnected && gap.presentation.innerHTML === gap.presentationHtml;
}

/**
 * A paragraph whose own text is a block-shortcut trigger belongs to the shared
 * block-shortcut owner, which rewrites the block: it is never a source-neutral
 * text-tail split.
 */
function blockShortcutTail(block: HTMLElement): boolean {
	if ('P' !== block.tagName) return false;
	const text = block.textContent ?? '';
	return /^(?:#{1,6}|>|---|\*\*\*|___|[-*+]|\d+\.|[-*+] \[[ xX]\])$/u.test(text)
		|| /^ {0,3}(?:`{3,}|~{3,})/u.test(text);
}

function windowedGapLineParagraphShape(paragraph: HTMLElement): boolean {
	const children = Array.from(paragraph.childNodes);
	if (0 === children.length) return false;
	if (1 === children.length && children[0] instanceof Text) return true;
	return children.every((child) => child instanceof HTMLBRElement);
}

function emptyCodeGapBoundary(gap: WindowedEmptyCodeGap, node: Node | null, offset: number): boolean {
	const paragraph = gap.presentation;
	if (!paragraph.isConnected) return false;
	if ("PRE" === paragraph.tagName) {
		const code = paragraph.querySelector<HTMLElement>(":scope > code");
		return Boolean(
			node &&
			code &&
			visualCodeBodyDomOffset(code, { node, offset }) !== null,
		);
	}
	if (paragraph instanceof HTMLParagraphElement && windowedGapLineParagraphShape(paragraph)
		&& !(1 === paragraph.childNodes.length && paragraph.firstChild instanceof Text)) {
		if (node === paragraph && Number.isInteger(offset) && offset >= 0 && offset <= paragraph.childNodes.length) return true;
		if (node instanceof HTMLBRElement && paragraph.contains(node)) return offset === 0 || offset === 1;
		return false;
	}
	// Once the certified gap has taken its first character, the paragraph holds
	// this owner's own uncommitted editing draft. The draft is the same
	// presentation and the same source gap, so a caret inside it is that gap's
	// own editing position; the canonical splice still uses the recorded
	// source offset, never the DOM offset.
	if (
		paragraph instanceof HTMLParagraphElement
		&& paragraph.childNodes.length === 1
		&& paragraph.firstChild instanceof Text
		&& node === paragraph.firstChild
		&& Number.isInteger(offset)
		&& offset >= 0
		&& offset <= paragraph.firstChild.length
	) {
		return true;
	}
	if (node === paragraph && offset === 0) return true;
	// Chromium names a `beforeinput` target inside the presentation's own first
	// text run rather than the element itself. That point is the same source
	// boundary only while it carries a zero-length prefix: anything the browser
	// would leave in front of the insertion point is already consumed source,
	// not the blank gap.
	if (!(node instanceof Text) || !Number.isInteger(offset) || offset < 0) return false;
	if (node.ownerDocument !== paragraph.ownerDocument || !paragraph.contains(node)) return false;
	const prefix = paragraph.ownerDocument.createRange();
	prefix.selectNodeContents(paragraph);
	try {
		prefix.setEnd(node, offset);
	} catch {
		return false;
	}
	return 0 === prefix.toString().length;
}

function emptyCodeGapNeighbor(node: Node | null, direction: "before" | "after"): HTMLElement | null {
	while (node instanceof Text && /^[ \t\r\n]*$/u.test(node.data)) node = direction === "before" ? node.previousSibling : node.nextSibling;
	return node instanceof HTMLElement ? node : null;
}

function restoreEmptyCodeGapSelection(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	gap: WindowedEmptyCodeGap,
): HTMLElement {
	const invalid = (): never => { throw new Error("visual-editor-window-history-selection-map-failed"); };
	const point = gap.selection.start;
	if (gap.selection.direction !== "none" || point !== gap.selection.end
		|| gap.before.end > point || point > gap.after.start
		|| !certifiedTextTailGapSlice(
			gap.markdown.slice(gap.before.end, gap.after.start),
			gap.after.start <= gap.before.end + 2,
		)) return invalid();
	const find = (extent: WindowedEmptyCodeGap["before"]): HTMLElement => {
		const matches = Array.from(surface.children).filter((child): child is HTMLElement => {
			if (!(child instanceof HTMLElement) || child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) return false;
			const range = ranges.get(child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "");
			return Boolean(range?.editable && range.start === extent.start && range.end === extent.end
				&& gap.markdown.slice(range.start, range.end) === extent.source);
		});
		return matches.length === 1 && matches[0] ? matches[0] : invalid();
	};
	const before = find(gap.before);
	const eofBoundary = gap.after.start === gap.after.end
		&& gap.after.start === gap.markdown.length
		&& "" === gap.after.source;
	const after = eofBoundary
		? gap.presentation
		: find(gap.after);
	if (eofBoundary && (after.parentNode !== surface || after !== gap.presentation)) return invalid();
	const nodes = Array.from(surface.childNodes);
	const start = nodes.indexOf(before);
	const end = nodes.indexOf(after);
	if (start < 0 || end <= start || nodes.slice(start + 1, end).some(node =>
		!(node instanceof Text && /^[ \t\r\n]*$/u.test(node.data)))) return invalid();
	const native = surface.ownerDocument.defaultView?.getSelection();
	if (!native) return invalid();
	native.collapse(after, 0);
	return after;
}

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

/**
 * The terminal separators a document-end line break still has to add.
 *
 * A line break at the document end opens the paragraph after the last block,
 * and two line endings separate that paragraph. A document that already ends
 * in two or more of them changes nothing, so the answer is empty; otherwise it
 * is the missing separators spelled with the document's own line ending.
 *
 * Only a paragraph may follow the last block here: a document that still ends
 * inside a fenced code block is refused by `documentEndRootRow` before this
 * question is asked, and a code body's own line break adds one body line.
 */
function missingTerminalSeparators(markdown: string, lineEnding: string): string {
	const present = (/(?:\r\n|\r|\n)+$/u.exec(markdown)?.[0] ?? "")
		.match(/\r\n|\r|\n/gu)?.length ?? 0;
	return present >= 2 ? "" : lineEnding.repeat(2 - present);
}

/**
 * Whether the document still ends inside a fenced code block.
 *
 * An unterminated fence runs to the end of the document, and its own row owns
 * that terminal line: a line break there appends one body line, never the two
 * separators a paragraph after the last block needs. The renderer's code-body
 * intervals are the single authority on that shape, so this reads them instead
 * of re-deriving the fence rules; the answer is memoized because a character-
 * wise Backspace at the document end asks again for the same source.
 */
let openCodeFenceSource: string | null = null;
let openCodeFenceAtDocumentEnd = false;

function endsInsideOpenCodeFence(markdown: string): boolean {
	if (openCodeFenceSource !== markdown) {
		openCodeFenceSource = markdown;
		openCodeFenceAtDocumentEnd = visualCodeBodyIntervals(markdown).some(
			(interval) =>
				!interval.closed && interval.sourceBlockEnd === markdown.length,
		);
	}
	return openCodeFenceAtDocumentEnd;
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

const WINDOWED_CODE_BODY_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteByCut",
	"deleteContentBackward",
	"deleteContentForward",
	"deleteWordBackward",
	"deleteWordForward",
]);

const WINDOWED_PENDING_TEXT_INPUT_TYPES: Readonly<Record<string, true>> = {
	insertText: true,
	insertReplacementText: true,
	insertLineBreak: true,
	// A certified gap keeps accepting newlines while its own formal Preview is
	// outstanding: repeated Enter is the same owner continuing the same source
	// gap, not an unavailable input.
	insertParagraph: true,
};

const WINDOWED_PENDING_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteContentForward",
	"deleteWordBackward",
	"deleteWordForward",
]);

const WINDOWED_PENDING_NAVIGATION_KEYS: Readonly<Record<string, true>> = {
	ArrowLeft: true,
	ArrowRight: true,
	ArrowUp: true,
	ArrowDown: true,
	Home: true,
	End: true,
	PageUp: true,
	PageDown: true,
};

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
const WINDOWED_WHOLE_DOCUMENT_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteContentForward",
]);
const WINDOWED_THEMATIC_BREAK_DELETION_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteContentForward",
]);
const WINDOWED_ATOMIC_ROOT_REMOVAL_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteContentForward",
	"deleteWordBackward",
	"deleteWordForward",
]);
const WINDOWED_ATOMIC_ROOT_BACKWARD_TYPES: ReadonlySet<string> = new Set([
	"deleteContentBackward",
	"deleteWordBackward",
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
		// This builder owns one CODE body. A cancelable deletion whose own
		// target provably leaves that body is a structural deletion: decline
		// ownership so the region owner commits it, instead of rejecting a
		// legitimate cross-block edit as a stale body map. Declining for a
		// target that stays inside the body would drop the keystroke entirely,
		// because this builder is the only owner that can commit a body edit,
		// so the handoff additionally requires the classifier to report the
		// target as outside the body and keeps every unproved case on the
		// explicit stale rejection.
		if (
			event.cancelable &&
			WINDOWED_CODE_BODY_DELETION_TYPES.has(event.inputType) &&
			region.blocks.length > 1 &&
			"outside" ===
				codeBodyDeletionOwnership(
					inputBlock.pre,
					event,
					"deleteContentForward" === event.inputType ||
						"deleteWordForward" === event.inputType
						? "forward"
						: "backward",
				) &&
			structuralDeletionTargetIsAuthenticated(region, event, inputBlock.pre)
		) {
			return null;
		}
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
	// The authenticated split proof must be read BEFORE any mutation: the
	// sibling removal below changes the child list it verifies.
	const authenticatedSplit = isWindowedParagraphCodeSplit(input);
	if (codeChildren.length > 1) {
		if ("insertParagraph" !== input.inputType || 2 !== codeChildren.length) {
			throw new Error("visual-editor-code-shape-invalid");
		}
		for (const sibling of codeChildren) {
			if (sibling !== code) sibling.remove();
		}
	}
	if (authenticatedSplit) {
		// Chromium's own paragraph split inside PRE leaves the kept CODE with
		// one synthetic <br> as its last child - the marker of the split, not
		// content. Only that exact marker is removed, and only after the
		// authenticated two-CODE split proved it. Any other BR, DIV or
		// unknown element still reaches the markup guard and rejects
		// unchanged.
		const last = code.lastChild;
		if (
			last instanceof HTMLBRElement &&
			0 === last.attributes.length
		) {
			last.remove();
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

type ContextMenuInlineTargetKind = "link" | "math" | "mermaid";

/**
 * The immutable descriptor of one pointed subtarget inside an accepted block.
 * An image nested in a link stays an image target; an inline link, formula or
 * diagram keeps its kind and its rendered source signature. Nothing here is an
 * authorization by itself: the descriptor is always paired with the accepted
 * document/source witness below.
 */
type ContextMenuTargetIdentity = Readonly<{
  blockId: string | null;
  imageAlt: string | null;
  imageOrdinal: number | null;
  imageSrc: string | null;
  inlineKind: ContextMenuInlineTargetKind | null;
  inlinePath: ReadonlyArray<number> | null;
  inlineSignature: string | null;
}>;

/**
 * One owner-issued target witness. It is captured while the pointed element is
 * still live and bound to the canonical source the owner had already committed
 * AND to the source its mounted ledger and accepted DOM describe. Those two are
 * the same document at capture time; a capture that cannot prove that
 * correspondence is refused rather than parked. A later resolution may only
 * re-bind within that same accepted source; it never reconstructs a block from
 * detached ancestry, a same-ordinal `bN` label of another document, or a
 * coordinate hit-test.
 */
type ContextMenuTargetWitness = ContextMenuTargetIdentity &
  Readonly<{
    anchor: Element;
    /**
     * The accepted ledger row of the pointed block inside the canonical source
     * this witness is bound to. Capture refuses to issue a block witness without
     * it; `null` therefore appears only on a surface-level gesture, which names
     * no block at all.
     */
    blockSourceRange: Readonly<{ end: number; start: number }> | null;
    /**
     * The pointed block's content exactly as this owner had rendered it when
     * the gesture happened, or `null` for a surface-level gesture. A resolution
     * demands that the accepted block still renders this same content, but
     * content equality alone never authorizes a block: the captured row must
     * match too.
     */
    blockSerialization: string | null;
    canonicalSource: string;
    surfaceRoot: boolean;
  }>;

function contextMenuTargetIdentity(
  target: Element,
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
    imageAlt: image?.getAttribute("alt") ?? null,
    imageOrdinal: 0 <= ordinal ? ordinal : null,
    imageSrc: image?.getAttribute("src") ?? null,
    inlinePath,
    inlineKind,
    inlineSignature,
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
 * The mounted accepted block that a witness names, or `null`.
 *
 * Authorization needs the captured canonical row to match exactly, plus a
 * unique mounted root carrying that label, accepted-registry membership for
 * editable blocks, and an identical current rendering. This is the only place
 * a stale `bN` label is read, and it is read only against THIS surface's live
 * children and the witness's own accepted source.
 */
function witnessedContextMenuBlock(
  surface: HTMLElement,
  witness: ContextMenuTargetWitness,
  ranges: SourceRangeLedger,
  accepted: AcceptedWindowedBlocks,
): HTMLElement | null {
  // A block witness is authorized by the exact canonical row it captured.
  // Capture refuses to issue one without that row, and a resolution that
  // cannot find it in the same row again never falls back to a label, a
  // rendering, or a future substitution.
  if (!witness.blockId || !witness.blockSourceRange) return null;
  const matches = Array.from(surface.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.hasAttribute(WINDOW_SPACER_ATTRIBUTE) &&
      child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === witness.blockId,
  );
  // A duplicated identity cannot say which mounted block the gesture meant.
  if (1 !== matches.length) return null;
  const block = matches[0];
  if (!block) return null;
  // The row must be the one this Node was accepted with. Label lookup alone
  // would let a relabelled node claim another valid unmounted row whose
  // rendering matches, so the accepted record is consulted first.
  const range = acceptedWindowedBlockRange(block, ranges, accepted);
  if (!range || !block.isConnected || !surface.contains(block)) {
    return null;
  }
  // The record's own serialization is the accepted content of this exact Node;
  // a node whose accepted content differs is a different block. Content is
  // compared against the record, never used to discover a row.
  const record = accepted.get(block);
  if (!record) return null;
  // The witness pins the content this block rendered when the gesture
  // happened. A block whose content changed is a different block, whatever its
  // label says.
  let serialization: string | null = null;
  try {
    serialization = normalizedWindowedBlockSerialization(block);
  } catch {
    serialization = null;
  }
  if (null === serialization || serialization !== witness.blockSerialization) {
    return null;
  }
  if (
    record.editable &&
    null !== record.serialization &&
    record.serialization !== serialization
  ) {
    return null;
  }
  // The captured row is the block's position in the demanded canonical source.
  // A same-id block that now owns another interval is a different block, even
  // when its rendering is identical.
  if (
    range.start !== witness.blockSourceRange.start ||
    range.end !== witness.blockSourceRange.end
  ) {
    return null;
  }
  return block;
}

/**
 * Resolve the exact live element of a captured witness, or `null`.
 *
 * Positive evidence is required: the same owner instance and surface, the same
 * canonical and mounted accepted source, the same accepted window certificate,
 * and the same accepted block content. A changed window commit key inside that
 * same accepted document may legally rebind to its replacement node; a changed
 * accepted document never can, even when the new render reuses the old `bN`
 * label for a different block. Absence of accepted identity is not evidence of
 * agreement.
 */
function resolveWitnessedContextMenuTarget(
  surface: HTMLElement,
  witness: ContextMenuTargetWitness,
  current: Readonly<{
    accepted: AcceptedWindowedBlocks;
    canonicalSource: string;
    mountedSource: string;
    ranges: SourceRangeLedger;
    ready: boolean;
  }>,
): Element | null {
  if (!current.ready || !surface.isConnected) return null;
  // Readiness already certifies the mounted DOM against the canonical source.
  // The witness binds that canonical document: an accepted window commit may
  // legally replace every mounted node of the very same document, while any
  // other accepted source - including a fresh render that reuses the old `bN`
  // labels for different blocks - is a different demand.
  if (
    current.canonicalSource !== witness.canonicalSource ||
    current.mountedSource !== witness.canonicalSource
  ) return null;
  if (witness.surfaceRoot) {
    // A keyboard activation on the surface root is its own surface-level
    // witness. It never degrades to a guessed descendant.
    return surface;
  }
  const block = witnessedContextMenuBlock(
    surface,
    witness,
    current.ranges,
    current.accepted,
  );
  if (!block) return null;
  // The anchor is the exact element the user pointed at. While it is still
  // mounted inside the block this witness just re-authenticated, it is not a
  // substitute for anything: preparation keeps the exact node it described.
  if (witness.anchor.isConnected && block.contains(witness.anchor)) {
    return witness.anchor;
  }
  // An image nested inside a link is still an image context. Resolve the
  // concrete image slot before the enclosing link so image scale/copy/delete
  // actions cannot silently degrade to link actions after a window commit.
  if (null !== witness.imageOrdinal) {
    const liveImage = visualBlockImages(block)[witness.imageOrdinal] ?? null;
    if (
      !liveImage
      || liveImage.getAttribute("src") !== witness.imageSrc
      || (liveImage.getAttribute("alt") ?? "") !== (witness.imageAlt ?? "")
    ) return null;
    return liveImage;
  }
  if (witness.inlinePath && witness.inlineKind) {
    const inlineTarget = elementAtPath(block, witness.inlinePath);
    if (
      !inlineTarget
      || !inlineTargetMatchesIdentity(
        inlineTarget,
        witness.inlineKind,
        witness.inlineSignature,
      )
    ) return null;
    return inlineTarget;
  }
  return block;
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
	// The document-end sink: this owner's own caret paragraph, which stands for
	// an empty source interval after the last row and therefore owns no row. It
	// is not accepted content, so a selection that spans the whole surface is
	// still the whole document.
	ownedPresentation: HTMLElement | null = null,
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
		(child) =>
			child !== ownedPresentation &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
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

/**
 * The owner of a deletion that starts at this block's own body edge.
 *
 * The body offset of a boundary is measured across the whole CODE element, not
 * inside one Text node: a highlighted body is a run of sibling spans, so a
 * caret at the second span's offset 0 is body offset 2 and Backspace there
 * removes the character before it. The native target range is authoritative
 * whenever it is nonempty, and a missing range falls back to the same
 * whole-body measurement. "empty" means the deletion interval holds nothing
 * inside this body, which is a no-change keystroke rather than a structural
 * edit; "outside" means the interval leaves the body and the structural path
 * owns it.
 */
function codeBodyDeletionOwnership(
	block: HTMLElement,
	event: InputEvent,
	direction: "backward" | "forward",
): "body" | "empty" | "outside" {
	const code = block.querySelector<HTMLElement>(":scope > code");
	if (!code) return "outside";
	const bodyLength = code.textContent?.length ?? 0;
	const targetRange = event.getTargetRanges?.()[0];
	if (targetRange && !targetRange.collapsed) {
		// An explicitly nonempty native target defines the deletion.
		const start = visualCodeBodyDomOffset(code, {
			node: targetRange.startContainer,
			offset: targetRange.startOffset,
		});
		const end = visualCodeBodyDomOffset(code, {
			node: targetRange.endContainer,
			offset: targetRange.endOffset,
		});
		if (null === start || null === end || end <= start) return "outside";
		return "body";
	}
	const selection = block.ownerDocument.defaultView?.getSelection();
	// Only a collapsed caret has to be judged against the body's edges; a real
	// selection deletion defines its own interval and keeps its existing path.
	if (!selection?.isCollapsed) return "outside";
	const anchorNode = selection.anchorNode;
	if (!anchorNode || !code.contains(anchorNode)) return "outside";
	const caret = visualCodeBodyDomOffset(code, {
		node: anchorNode,
		offset: selection.anchorOffset,
	});
	if (null === caret) return "outside";
	if ("backward" === direction) return 0 === caret ? "empty" : "body";
	return caret >= bodyLength ? "empty" : "body";
}

/** A native deletion target contained by this paragraph and touching its caret. */
export function equivalentParagraphBoundaries(
	block: HTMLParagraphElement,
	left: Readonly<{ node: Node; offset: number }>,
	right: Readonly<{ node: Node; offset: number }>,
): boolean {
	if (!block.contains(left.node) || !block.contains(right.node)) return false;
	if (left.node === right.node && left.offset === right.offset) return true;
	const protectedAncestor = (node: Node): boolean => {
		const element = node instanceof Element ? node : node.parentElement;
		return Boolean(element?.closest(`[contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}, [${WINDOW_SPACER_ATTRIBUTE}]`));
	};
	if (protectedAncestor(left.node) || protectedAncestor(right.node)) return false;
	const first = block.ownerDocument.createRange();
	const second = block.ownerDocument.createRange();
	try {
		first.setStart(left.node, left.offset); first.collapse(true);
		second.setStart(right.node, right.offset); second.collapse(true);
		const order = first.compareBoundaryPoints(Range.START_TO_START, second);
		if (order === 0) return true;
		const lower = order < 0 ? first : second;
		const upper = order < 0 ? second : first;
		const corridor = block.ownerDocument.createRange();
		corridor.setStart(lower.startContainer, lower.startOffset);
		corridor.setEnd(upper.startContainer, upper.startOffset);
		const fragment = corridor.cloneContents();
		const walker = block.ownerDocument.createTreeWalker(fragment, NodeFilter.SHOW_ALL);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node instanceof Text) {
				if (node.length > 0) return false;
			} else if (node instanceof Element) {
				if (!node.matches("a, em, strong, del, code, span")
					|| node.matches(`[contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}, [${WINDOW_SPACER_ATTRIBUTE}]`)) return false;
			} else return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Whether a row's source and serialization differ only inside its image units. */
function imageUnitsAccountForRowSpelling(
	projection: VisualMarkdownSourceIntervalMap,
	source: string,
	baseline: string,
): boolean {
	const units = projection.imageUnits;
	if (!units?.length) return false;
	const normalized = source.replace(/\r\n/g, "\n");
	let sourceAt = 0;
	let baselineAt = 0;
	for (const unit of units) {
		if (normalized.slice(sourceAt, unit.sourceStart) !== baseline.slice(baselineAt, unit.baselineStart)) return false;
		sourceAt = unit.sourceEnd;
		baselineAt = unit.baselineEnd;
	}
	return normalized.slice(sourceAt) === baseline.slice(baselineAt);
}

function paragraphOwnsNativeDeletion(
	block: HTMLElement,
	event: InputEvent,
	direction: "backward" | "forward",
): boolean {
	if (!(block instanceof HTMLParagraphElement)) return false;
	const selection = block.ownerDocument.defaultView?.getSelection();
	const targets = event.getTargetRanges?.();
	if (!selection?.isCollapsed || !selection.anchorNode || targets?.length !== 1) return false;
	const target = targets[0];
	if (!target || target.collapsed || !block.contains(target.startContainer)
		|| !block.contains(target.endContainer)) return false;
	const boundary = direction === "backward"
		? { node: target.endContainer, offset: target.endOffset }
		: { node: target.startContainer, offset: target.startOffset };
	return equivalentParagraphBoundaries(block, boundary, { node: selection.anchorNode, offset: selection.anchorOffset });
}

/**
 * Whether the collapsed caret inside this code body sits at the body's own
 * terminal position, proved against the source slice's interval rather than
 * the raw DOM text: the source body (bodyStart..bodyEnd) ends with its own
 * final line newline, and the DOM's code text is exactly that body - or that
 * body plus one extra renderer terminal newline. The terminal caret positions
 * are therefore after the body's last content (one stop before the body's own
 * final newline), the body's very end, and, only when the renderer added its
 * extra newline, the stop after it. Any other offset is mid-body.
 */
/**
 * The authenticated fenced-body interval of one mounted PRE, resolved from
 * the accepted ledger's own source row: the row IS the block's owned slice,
 * and the fence it mounts is ordinal 0 within that slice, so the validated
 * interval helper runs once on the slice instead of rescanning the whole
 * document. The fence must open at the slice start; the ledger row may carry
 * its legal separator run past the closing fence, which is not part of the
 * block. A block without an authenticated editable row, or a slice whose
 * first fence does not open exactly at its start, leaves the terminal guard
 * off and the existing explicit rejection in charge. Duplicate bodies stay
 * correct because the slice is the ledger's own source position, never
 * language or text matching.
 */
function windowedOwnedCodeBodyInterval(
	pre: HTMLElement,
	ranges: SourceRangeLedger,
	accepted: AcceptedWindowedBlocks,
	sourceMarkdown: string,
): Readonly<{ bodyEnd: number; bodyStart: number }> | null {
	const row = acceptedWindowedBlockRange(pre, ranges, accepted);
	if (!row?.editable) return null;
	if (
		row.start < 0 ||
		row.end < row.start ||
		row.end > sourceMarkdown.length
	) {
		return null;
	}
	const ownedSlice = sourceMarkdown.slice(row.start, row.end);
	try {
		const interval = visualCodeBodyIntervalAtOrdinal(ownedSlice, 0);
		if (0 !== interval.sourceBlockStart) return null;
		return {
			bodyEnd: row.start + interval.bodyEnd,
			bodyStart: row.start + interval.bodyStart,
		};
	} catch {
		return null;
	}
}

function windowedCodeBodyTerminalCaret(
	inputBlock: VisualCodeInputSnapshot,
	surface: HTMLElement,
	sourceMarkdown: string,
	bodyInterval: Readonly<{ bodyEnd: number; bodyStart: number }> | null,
): boolean {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection?.isCollapsed || !selection.anchorNode) return false;
	const code = inputBlock.code;
	if (
		selection.anchorNode !== code
		&& !code.contains(selection.anchorNode)
	) return false;
	if (!bodyInterval) return false;
	const markdown = sourceMarkdown;
	try {
		const bodyText = normalizeCodeBodyDomTextForWindow(
			markdown.slice(bodyInterval.bodyStart, bodyInterval.bodyEnd),
		);
		const domText = normalizeCodeBodyDomTextForWindow(inputBlock.codeText);
		const caretOffset = visualCodeBodyDomOffset(code, {
			node: selection.anchorNode,
			offset: selection.anchorOffset,
		});
		if (null === caretOffset) return false;
		const rendererTerminalNewline = domText === `${bodyText}\n`;
		if (domText !== bodyText && !rendererTerminalNewline) return false;
		return caretOffset === bodyText.length
			|| caretOffset === bodyText.length - 1
			|| (rendererTerminalNewline && caretOffset === bodyText.length + 1);
	} catch {
		return false;
	}
}

function normalizeCodeBodyDomTextForWindow(value: string): string {
	return value.replace(/\r\n|\r/g, "\n");
}

/**
 * Positive proof that a deletion's own target is the captured region's own
 * edit. The region's blocks are already validated as contiguous, editable and
 * spacer-free; this additionally requires a nonempty native target whose two
 * endpoints are connected and each contained by a block of that same region.
 * A missing, collapsed or foreign target is unproved and keeps the explicit
 * stale rejection instead of being handed on as a structural edit.
 */
function structuralDeletionTargetIsAuthenticated(
	region: ActiveRegion,
	event: InputEvent,
	block: HTMLElement,
): boolean {
	const targetRange = event.getTargetRanges?.()[0];
	if (!targetRange || targetRange.collapsed) return false;
	const startNode = targetRange.startContainer;
	const endNode = targetRange.endContainer;
	if (!startNode.isConnected || !endNode.isConnected) return false;
	const contains = (node: Node): boolean =>
		region.blocks.some((block) => block === node || block.contains(node));
	if (!contains(startNode) || !contains(endNode)) return false;
	// A target that crosses a protected region is not an ordinary structural
	// edit: it must be rejected before any commit rather than handed on and
	// repaired after the DOM has moved. The native target is a StaticRange, so
	// it is re-expressed as a live Range to test its own intersection.
	let liveRange: Range;
	try {
		liveRange = block.ownerDocument.createRange();
		liveRange.setStart(targetRange.startContainer, targetRange.startOffset);
		liveRange.setEnd(targetRange.endContainer, targetRange.endOffset);
	} catch {
		return false;
	}
	return !rangeIntersectsReadOnlyRegion(liveRange, region.readOnlySnapshot);
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

/**
 * Whether a range touches a protected region. The Selection's own check does
 * not cover `event.getTargetRanges()`: a collapsed caret inside an editable
 * CODE body can carry a target that reaches into a protected descendant of an
 * adjacent editable block, so the target's own endpoints and every region it
 * crosses are tested here before any structural handoff.
 */
function rangeIntersectsReadOnlyRegion(
	range: Range,
	snapshot: VisualMarkdownReadOnlySnapshot,
): boolean {
	return snapshot.some(({ node }) => {
		if (
			node.contains(range.startContainer) ||
			node.contains(range.endContainer)
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

/**
 * Whether the Selection's own interval actually reaches a protected region.
 * `Range.intersectsNode` is true for a node that merely shares an ancestor
 * with the range, so it is not evidence that a caret inside an ordinary code
 * body touches protected content. A protected region is hit when it contains
 * either endpoint or when the range's own boundary points fall inside it;
 * anything else leaves an ordinary edit to its own owner.
 */
function selectionIntersectsReadOnlyRegion(
	selection: Selection,
	snapshot: VisualMarkdownReadOnlySnapshot,
): boolean {
	if (!selection.rangeCount) return false;
	const range = selection.getRangeAt(0);
	const covers = (node: Node): boolean => {
		const document = node.ownerDocument;
		if (!document) return true;
		let outer: Range;
		try {
			outer = document.createRange();
			outer.selectNode(node);
		} catch {
			return true;
		}
		// The selection owns the protected node when its own interval starts at
		// or before that node and ends at or after it. A caret that merely
		// shares an ancestor with it owns nothing.
		return (
			range.compareBoundaryPoints(Range.START_TO_START, outer) <= 0 &&
			range.compareBoundaryPoints(Range.END_TO_END, outer) >= 0
		);
	};
	return snapshot.some(({ node }) => {
		if (
			node.contains(selection.anchorNode) ||
			node.contains(selection.focusNode)
		) {
			return true;
		}
		return covers(node);
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
				(child.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR) || child.matches("area, base, br, col, embed, hr, img, input, link, meta, param, source, track, wbr"))
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

/**
 * Ledger rows aligned to the surface's own children for the structural
 * boundary owner. A child with no ledger row, or a row that is not editable,
 * simply cannot certify a gap.
 */
function windowedStructuralBlocks(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
): ReadonlyArray<VisualStructuralBoundaryBlock> {
	const rows = Array.from(surface.children).flatMap((child) => {
		const id = child.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
		const range = id ? ranges.get(id) : null;
		return range
			? [{ editable: range.editable, end: range.end, id: range.id, start: range.start }]
			: [];
	});
	return visualStructuralBoundaryBlocks(surface, rows);
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

/**
 * The absolute source interval each mounted region root owns, taken from the
 * ledger row of the block itself. A block without an editable row has no
 * binding and therefore cannot claim any fence metadata.
 */
function windowBlockFenceBindings(
	ranges: SourceRangeLedger,
	blocks: ReadonlyArray<HTMLElement>,
): ReadonlyMap<HTMLElement, Readonly<{ end: number; start: number }>> {
	const bindings = new Map<
		HTMLElement,
		Readonly<{ end: number; start: number }>
	>();
	for (const block of blocks) {
		const range = ranges.get(
			block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
		);
		if (!range?.editable) continue;
		bindings.set(block, { end: range.end, start: range.start });
	}
	return bindings;
}

/**
 * Re-derive the derived code-fence metadata of live region PREs with the same
 * source-and-structure proof the accepted setup projection uses. The full
 * canonical source is handed in, so a fence that merely ends at the region
 * boundary can never be mistaken for a canonical open-at-EOF fence, and only a
 * PRE whose owning root has an exact binding and whose parser-proven container
 * path matches a canonical leaf is written. Unmatched roots keep their current
 * attributes; this is a normalization, never a blanket refresh.
 */
function restoreRegionCodeFenceMetadata(
	surface: HTMLElement,
	blocks: ReadonlyArray<HTMLElement>,
	source: string,
	bindings: ReadonlyMap<HTMLElement, Readonly<{ end: number; start: number }>>,
	sourceRange: Readonly<{ documentLength: number; end: number }>,
): void {
	const livePres = blockPreElements(blocks);
	if (0 === livePres.length) return;
	if (
		!Number.isInteger(sourceRange.end) ||
		!Number.isInteger(sourceRange.documentLength) ||
		sourceRange.end < 0 ||
		sourceRange.end > sourceRange.documentLength
	) {
		throw new Error("visual-editor-window-source-range-invalid");
	}
	const matches = projectVisualCodeFenceMetadata(
		source,
		surface,
		(root) => bindings.get(root) ?? null,
	);
	if (
		sourceRange.end !== sourceRange.documentLength &&
		(
			livePres.some((pre) =>
				pre.hasAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE),
			)
			|| matches.some(
				(match) => match.leafOpen && match.leafEnd > match.bindingEnd,
			)
		)
	) {
		throw new Error("visual-editor-window-open-fence-source-range-invalid");
	}
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
		if (0 !== containing.length) return null;
		// A caret in the document's own terminal line endings sits after every
		// mounted row: those bytes are not a row of their own, so the document
		// end they spell is the last row's own end and that row owns the
		// position. This includes the exact end of the source, where the row
		// range may already stop before the final line ending.
		const endingAtDocumentEnd = mappedBlocks.filter(
			({ range }) =>
				range.end <= offset &&
				isMarkdownTerminalWhitespaceSuffix(markdown.slice(range.end)),
		);
		if (1 !== endingAtDocumentEnd.length) return null;
		return endingAtDocumentEnd[0];
	};
	// A collapsed caret sitting exactly on a row's canonical end (its row
	// range owns the trailing line ending) has no containing row. Both
	// endpoints need the same previous-row boundary mapping, otherwise the
	// live caret at that very block end cannot be restored from its own row.
	const start = blockForOffset(selection.start, true);
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
	if (!firstRange || !lastRange || selection.start < firstRange.start)
		return null;
	// A collapsed caret inside the document's terminal line endings is the
	// document end, not a position outside the mounted rows: the line endings
	// after the last row are unowned source, and every canonical caret the
	// owner records there names the same visible place - after the last block.
	const terminalDocumentEnd =
		selection.start === selection.end &&
		selection.start >= lastRange.end &&
		isMarkdownTerminalWhitespaceSuffix(markdown.slice(lastRange.end));
	if (selection.end > lastRange.end && !terminalDocumentEnd) return null;
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

/**
 * The native identity of one certified structural gap, in the node shape the
 * pending lease and history snapshot compare. The source-only half keeps it
 * available while a newer Preview is still outstanding.
 */
function captureWindowedStructuralSelection(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	sourceMarkdown: string,
	recordedCaret: number,
): VisualSelectionSnapshot | null {
	return visualStructuralBoundarySnapshot(
		surface,
		windowedStructuralBlocks(surface, ranges),
		sourceMarkdown,
		recordedCaret,
	);
}

function restoreMountedSourceSelection(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	markdown: string,
	selection: DocumentSelection,
	profile: ReferenceLabelCaseFoldProfile,
	accepted?: Readonly<{
		blockSerializations: AcceptedWindowedBlocks;
		childNodes: ReadonlyArray<Node>;
	}>,
): boolean {
	if (
		selection.start === selection.end &&
		"none" === selection.direction &&
		placeVisualStructuralBoundarySelection(
			surface,
			markdown,
			windowedStructuralBlocks(surface, ranges),
			selection.start,
		)
	) {
		return true;
	}
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
	restoreRegionCodeFenceMetadata(
		surface,
		region.blocks,
		markdown,
		windowBlockFenceBindings(ranges, region.blocks),
		{
			documentLength: markdown.length,
			end: region.sourceEnd,
		},
	);
	const localSelection = {
		end: selection.end - region.sourceStart,
		start: selection.start - region.sourceStart,
	};
	if (region.terminalDocumentEnd && "PRE" !== region.end.block.tagName) {
		const block = region.end.block;
		// An object the caret cannot enter has no editable address of its
		// own: this position is only representable through the owner's
		// document-end sink, so report it as not mounted here and let the
		// caller present it there.
		if (isWindowedAtomicRoot(block) && !(block instanceof HTMLHRElement)) {
			return false;
		}
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
			selection.start !== selection.end ||
			selection.start < liveRange.end ||
			selection.start > markdown.length ||
			!isMarkdownTerminalWhitespaceSuffix(markdown.slice(selection.start)) ||
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
	let referenceDefined: ((label: string) => boolean) | null = null;
	const isReferenceDefined = (label: string): boolean => {
		if (!referenceDefined) {
			const nodes: MarkdownSyntaxNode[] = [];
			markdownLanguage.parser.parse(markdown).iterate({ enter: (node) => {
				nodes.push({ from: node.from, name: node.name, to: node.to });
			} });
			referenceDefined = markdownReferenceLabelQuery(markdown, nodes, profile);
		}
		return referenceDefined(label);
	};
	const mapBoundary = (
		sourceOffset: number,
		endpoint: typeof region.start,
	): WindowSelectionBoundary => {
		const clone = endpoint.block.cloneNode(true) as HTMLElement;
		const endpointMarkdown = markdown.slice(
			endpoint.range.start,
			endpoint.range.end,
		);
		applyVisualCodeFenceMetadataFromSource(clone, endpointMarkdown);
		const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
		// A fence block maps against the block itself, and that root's boundary
		// space starts at the code body: the live surface keeps the opening
		// delimiter line as fence metadata instead of DOM text, so its mapped
		// offsets omit that line. Translate the source offset once here so the
		// mapper receives offsets in its own root space, exactly as the full
		// owner does.
		const rootOffset = visualCodeFenceRootSourceOffset(
			clone,
			endpointMarkdown,
			sourceOffset - endpoint.range.start,
		);
		if (rootOffset < 0) {
			throw new Error("visual-editor-window-history-selection-map-failed");
		}
		const imageBoundary = clone.querySelector('img')
			? visualBoundaryForImageSourceEdge(clone, endpointMarkdown, rootOffset, isReferenceDefined)
			: null;
		let boundary: Readonly<{ node: Node; offset: number }>;
		try {
			boundary = imageBoundary ?? visualCaretBoundaryFromSourceOffset(
				clone,
				endpointMarkdown,
				endpointBaseline,
				rootOffset,
			);
		} catch (error) {
			// The block's text tail is the same canonical point whether or not the
			// renderer kept the source's escapes: a renderer decodes `\~`/`\``
			// while the canonical source keeps them, so the generic mapping cannot
			// align the two byte strings even though both end at the same caret.
			// Only a tail whose remaining bytes are line endings takes this path;
			// every interior offset keeps the explicit mapping failure.
			const tail = markdown.slice(sourceOffset, endpoint.range.end);
			if (sourceOffset !== endpoint.range.end && !/^[\r\n]+$/u.test(tail)) throw error;
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
		blockSerializations: AcceptedWindowedBlocks;
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

/**
 * The fenced interval of one structural block, in absolute source coordinates.
 * The interval owner is handed the ledger's own slice, so no code ordinal is
 * ever resolved against the whole document, and its answer is required to
 * describe exactly that slice before it is translated back. That keeps LF,
 * CRLF and still-open fences the interval owner's decision instead of a
 * line-ending trim here.
 */
function exactStructuralBlockSourceInterval(
	markdown: string,
	range: Readonly<{ end: number; start: number }>,
): Readonly<{ end: number; start: number }> | null {
	const slice = markdown.slice(range.start, range.end);
	if (!slice) return null;
	let interval: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
	try {
		interval = visualCodeBodyIntervalAtOrdinal(slice, 0);
	} catch {
		return null;
	}
	if (
		0 !== interval.codeOrdinal ||
		0 !== interval.sourceBlockStart ||
		interval.sourceBlockEnd !== slice.length
	) {
		return null;
	}
	if (!interval.closed && range.end !== markdown.length) {
		return null;
	}
	return {
		end: range.start + interval.sourceBlockEnd,
		start: range.start + interval.sourceBlockStart,
	};
}

/**
 * Resolve the native selection a browser makes for `Range.selectNode(pre)` on
 * one direct child of the surface. The child is authenticated as an editable,
 * unprotected, spacer-free structural block in surface order whose ledger
 * slice proves exactly one closed fence, so an arbitrary root or spacer
 * selection is still rejected by the callers.
 * The mutation caller must also authenticate the current canonical source and
 * the accepted editable/protected DOM snapshots before changing the document.
 */
function captureExactDirectChildFenceSelection(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	markdown: string,
): Readonly<{
	block: HTMLPreElement;
	direction: "backward" | "forward";
	end: number;
	index: number;
	start: number;
}> | null {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (
		1 !== selection?.rangeCount ||
		selection.isCollapsed ||
		selection.anchorNode !== surface ||
		selection.focusNode !== surface
	) {
		return null;
	}
	const start = Math.min(selection.anchorOffset, selection.focusOffset);
	const end = Math.max(selection.anchorOffset, selection.focusOffset);
	if (
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		end - start !== 1 ||
		start < 0 ||
		end > surface.childNodes.length
	) {
		return null;
	}
	const range = selection.getRangeAt(0);
	if (
		range.startContainer !== surface ||
		range.endContainer !== surface ||
		range.startOffset !== start ||
		range.endOffset !== end
	) {
		return null;
	}
	const selected = surface.childNodes[start];
	if (
		!(selected instanceof HTMLPreElement) ||
		selected.parentNode !== surface ||
		!selected.isConnected
	) {
		return null;
	}
	let ancestor: HTMLElement | null = selected;
	while (ancestor) {
		if (
			ancestor.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR) ||
			ancestor.hasAttribute(WINDOW_SPACER_ATTRIBUTE) ||
			"false" === ancestor.getAttribute("contenteditable")?.toLowerCase()
		) {
			return null;
		}
		if (ancestor === surface) break;
		ancestor = ancestor.parentElement;
	}
	const ledger = ranges.get(
		selected.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "",
	);
	if (!ledger?.editable) return null;
	const sourceInterval = exactStructuralBlockSourceInterval(markdown, {
		end: ledger.end,
		start: ledger.start,
	});
	if (!sourceInterval) return null;
	return {
		block: selected,
		direction:
			selection.anchorOffset > selection.focusOffset ? "backward" : "forward",
		end: sourceInterval.end,
		index: start,
		start: sourceInterval.start,
	};
}

function captureActiveRegion(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	accepted: AcceptedWindowedBlocks,
	sourceMarkdown: string,
	deletionEvent: InputEvent | null = null,
	deletionDirection?: DeletionDirection,
	onInitialRegion?: (region: ActiveRegion) => void,
	// The document-end sink: this owner's own caret paragraph after the last
	// accepted row. It owns no row, so it is skipped exactly like a spacer; a
	// caret INSIDE it still has no row to map and is refused below. A certified
	// in-document gap is NOT skipped here: it is a rendered row, and a caret
	// inside it is an ordinary region anchor.
	ownedPresentation: HTMLElement | null = null,
): ActiveRegion {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	if (!selection?.anchorNode || !selection.focusNode) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	// A native `Range.selectNode(pre)` selection is anchored on the surface
	// itself and has no block for rootBlock() to find. Resolve that exact
	// authenticated structural selection to its own block first; every other
	// anchor/focus shape keeps the existing root mapping and rejection.
	const exactFence = captureExactDirectChildFenceSelection(
		surface,
		ranges,
		sourceMarkdown,
	);
	const anchor = exactFence
		? exactFence.block
		: rootBlock(surface, selection.anchorNode);
	const focus = exactFence
		? exactFence.block
		: rootBlock(surface, selection.focusNode);
	if (!anchor || !focus) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	// The selected roots must still own the rows this owner accepted for THEM.
	// A node relabelled to another valid row cannot steer the region, and a
	// metadata failure here is a rejection rather than an out-of-region skip.
	const surfaceChildren = Array.from(surface.children);
	// Rows that a still-mounted accepted root owns. A browser-created
	// replacement root has no record of its own; it may keep the row it was
	// mounted for, but it can never take over a row that another mounted
	// accepted root still owns.
	const acceptedMountedIds = new Set<string>();
	for (const child of surfaceChildren) {
		const record = child instanceof HTMLElement
			? accepted.get(child)
			: undefined;
		if (record) acceptedMountedIds.add(record.id);
	}
	const rowFor = (block: HTMLElement): EffectiveBlockRange | null => {
		const acceptedRange = acceptedWindowedBlockRange(block, ranges, accepted);
		if (acceptedRange || accepted.has(block)) return acceptedRange;
		const id = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
		const range = id ? ranges.get(id) : undefined;
		return range && !acceptedMountedIds.has(range.id) ? range : null;
	};
	const anchorRange = rowFor(anchor);
	const focusRange = rowFor(focus);
	if (!anchorRange?.editable || !focusRange?.editable) {
		throw new Error("visual-editor-window-selection-invalid");
	}
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
		// A deletion whose own target interval stays inside this block's code
		// body belongs to this block alone. Expanding to the adjacent sibling
		// would claim a two-block region for a one-body edit and reject it.
		// Only a target the body cannot contain is a real cross-block edit.
		// Only an interval that leaves this block's body is a real cross-block
		// edit. A same-body edit and an empty interval both stay inside this
		// block, so a noncancelable event cannot build a two-block region.
		if (
			!deletionEvent ||
			(!paragraphOwnsNativeDeletion(anchor, deletionEvent, deletionDirection) &&
				"outside" === codeBodyDeletionOwnership(anchor, deletionEvent, deletionDirection))
		) {
			const adjacent = adjacentEditableBlock(anchor, ranges, deletionDirection);
			const adjacentRange = rowFor(adjacent);
			if (!adjacentRange) {
				throw new Error("visual-editor-window-adjacent-block-unavailable");
			}
			blockStart = Math.min(blockStart, adjacentRange.index);
			blockEnd = Math.max(blockEnd, adjacentRange.index + 1);
		}
	}
	const blocks: HTMLElement[] = [];
	for (const child of surfaceChildren) {
		if (child === ownedPresentation) continue;
		// The prior record is consulted before the spacer flag: a root this
		// owner accepted cannot become a gap by adding that attribute.
		const priorRecord =
			child instanceof HTMLElement ? accepted.get(child) : undefined;
		if (child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) {
			if (priorRecord) {
				throw new Error("visual-editor-window-selection-invalid");
			}
			continue;
		}
		const range = child instanceof HTMLElement ? rowFor(child) : null;
		// A mounted root that owns no row - neither its accepted record nor a
		// uniquely labelled replacement - means the DOM drifted from that
		// acceptance, so the region is refused instead of silently skipping the
		// node and republishing a sibling's metadata.
		if (!range) throw new Error("visual-editor-window-selection-invalid");
		if (range.index < blockStart || range.index >= blockEnd) continue;
		if (!range.editable || range.index !== blockStart + blocks.length) {
			throw new Error("visual-editor-window-selection-invalid");
		}
		blocks.push(child as HTMLElement);
	}
	if (blocks.length !== blockEnd - blockStart) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	const first = blocks[0];
	const last = blocks[blocks.length - 1];
	// The region's own bounds come from the same accepted binding as its roots.
	const firstRange = first ? rowFor(first) : null;
	const lastRange = last ? rowFor(last) : null;
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
	restoreRegionCodeFenceMetadata(
		surface,
		blocks,
		sourceMarkdown,
		windowBlockFenceBindings(ranges, blocks),
		{
			documentLength: sourceMarkdown.length,
			end: sourceEnd,
		},
	);
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

/**
 * The certified gap presentation as its own `ActiveRegion`.
 *
 * A gap paragraph stands for an empty source interval between two accepted
 * rows, so `captureActiveRegion` has no row to map and must not guess one.
 * The certificate is the authority instead: the region is exactly that one
 * node, its recorded snapshot is the presentation the owner retained, and its
 * selection is the live caret inside it. Restoring this region can therefore
 * only discard this owner's own uncommitted draft (an IME composition, a
 * rejected input) and never touches accepted content.
 */
function captureCertifiedGapRegion(
	surface: HTMLElement,
	gap: WindowedEmptyCodeGap,
): ActiveRegion {
	const selection = surface.ownerDocument.defaultView?.getSelection();
	const presentation = gap.presentation;
	if (
		!selection?.anchorNode ||
		!selection.focusNode ||
		presentation.parentNode !== surface ||
		!emptyCodeGapBoundary(gap, selection.anchorNode, selection.anchorOffset) ||
		!emptyCodeGapBoundary(gap, selection.focusNode, selection.focusOffset)
	) {
		throw new Error("visual-editor-window-selection-invalid");
	}
	return {
		after: presentation.nextSibling,
		baseline: serializeVisualMarkdownBlockFragment([presentation]),
		blockEnd: 1,
		blockSnapshots: [
			{
				attributes: Array.from(
					presentation.attributes,
					({ name, value }) => ({ name, value }),
				),
				innerHTML: gap.presentationHtml,
				node: presentation,
			},
		],
		blockStart: 0,
		blocks: [presentation],
		before: presentation.previousSibling,
		readOnlySnapshot: captureVisualMarkdownReadOnlySnapshot(surface),
		selection: captureWindowSelection([presentation], selection),
		sourceEnd: gap.markdown.length,
		sourceStart: gap.markdown.length,
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

/**
 * The exact live DOM a block's accepted serialization was computed from: the
 * root's own attributes in document order plus its inner HTML. The serializer
 * reads nothing outside the root it is handed, so an editable root that still
 * spells this input serializes to the same string. A capture therefore reuses
 * the stored serialization while the live root still spells it, and recomputes
 * only the roots that changed.
 */
type AcceptedWindowedBlockSpelling = Readonly<{
	attributes: string;
	innerHTML: string;
}>;

/**
 * An attribute name cannot contain the `\u0000` separator and every value is
 * length-prefixed, so two different attribute sets can never spell one string.
 */
function windowedBlockSpelling(
	block: HTMLElement,
): AcceptedWindowedBlockSpelling {
	const attributes = block.attributes;
	let spelling = "";
	for (let index = 0; index < attributes.length; index += 1) {
		const attribute = attributes[index];
		if (!attribute) continue;
		spelling += `${attribute.name}\u0000${attribute.value.length}\u0000${attribute.value}\u0001`;
	}
	return { attributes: spelling, innerHTML: block.innerHTML };
}

/**
 * Whether a ledger has a row for every block the surface currently mounts.
 * Used before adopting a freshly built ledger: a map for a newer source than
 * the mounted DOM would otherwise strand live children with no row.
 */
function ledgerDescribesMountedBlocks(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	ownedPresentation: HTMLElement | null = null,
): boolean {
	return Array.from(surface.children)
		.filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement &&
				child !== ownedPresentation &&
				!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
		)
		.every(
			(block) =>
				null !== ranges.get(block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ""),
		);
}

/**
 * One accepted mounted root's immutable identity: the block id, ledger
 * position and editability the owner actually published, plus the effective
 * source interval at that moment and the accepted normalized rendering of an
 * editable root. The DOM attribute is mutable user-space metadata; this record
 * is the authority that a later validation compares it against.
 */
type AcceptedWindowedBlockRecord = Readonly<{
  editable: boolean;
  end: number;
  id: string;
  index: number;
  serialization: string | null;
  // The spelling the accepted serialization was computed from, or `null` when
  // the row carries no serialization in its proof.
  spelling: AcceptedWindowedBlockSpelling | null;
  start: number;
}>;

type AcceptedWindowedBlocks = WeakMap<HTMLElement, AcceptedWindowedBlockRecord>;

/**
 * The immutable record for one accepted mounted root. An editable root's
 * serialization proves that this node still spells its accepted row, so it is
 * recomputed only when the live root no longer spells the input the prior
 * record's serialization was computed from. A retained node whose identity the
 * caller already validated hands its stored serialization forward; every other
 * root is serialized from the live DOM.
 */
function acceptedWindowedBlockRecord(
	block: HTMLElement,
	id: string,
	range: EffectiveBlockRange,
	prior: AcceptedWindowedBlockRecord | null,
): AcceptedWindowedBlockRecord {
	const identity = {
		editable: range.editable,
		// The effective bounds are read AFTER the real ledger shift, so a
		// local edit in an earlier row refreshes later rows truthfully
		// instead of freezing pre-edit offsets.
		end: range.end,
		id,
		index: range.index,
		start: range.start,
	};
	if (!range.editable) return { ...identity, serialization: null, spelling: null };
	const spelling = windowedBlockSpelling(block);
	const retained =
		prior &&
		prior.editable &&
		null !== prior.serialization &&
		null !== prior.spelling &&
		prior.spelling.innerHTML === spelling.innerHTML &&
		prior.spelling.attributes === spelling.attributes
			? prior
			: null;
	return {
		...identity,
		serialization: retained
			? retained.serialization
			: normalizedWindowedBlockSerialization(block),
		spelling,
	};
}

class WindowedDomStaleError extends Error {
	constructor(readonly reason: string) {
		super("visual-editor-window-source-navigation-dom-stale");
	}
}

/**
 * The transfer's recorded DOM selection no longer names the live caret while
 * the canonical lease still does. A render the owner installed for that same
 * transfer replaces the nodes the transfer was captured against; the source,
 * caret and history are unchanged, so a deletion can still be applied to the
 * canonical source instead of being left to an unproved native mutation.
 */
class WindowedPendingDomIdentityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WindowedPendingDomIdentityError";
	}
}

class WindowedPendingInputRefusal extends Error {
	constructor(readonly reason: string, readonly event?: InputEvent) {
		super("visual-editor-window-pending-input-unavailable");
	}
}

class WindowedPendingInputDomError extends Error {
	constructor(message: string, readonly reason: string) {
		super(message);
	}
}

class WindowedPendingMergeContextError extends Error {
	constructor(readonly diagnostic: string) {
		super("visual-editor-markdown-merge-failed");
	}
}

class WindowedRowRevealError extends Error {
	constructor(readonly stage: string, readonly details: Readonly<Record<string, boolean | number | string>>) {
		super("visual-editor-window-selection-map-failed");
	}
}

class WindowedPendingImageError extends Error {
	constructor(readonly stage: string, readonly details: Readonly<Record<string, boolean | number>>) {
		super("visual-editor-window-pending-selection-stale");
	}
}

/**
 * The current authoritative ledger row of an accepted mounted root, or `null`.
 *
 * The record is found by the actual Node FIRST, and only then is its immutable
 * accepted id used to read the ledger. A node whose live label changed to
 * another valid row therefore matches nothing: it is not the block the owner
 * accepted, even when that other row exists, is unmounted, and renders the same
 * text. The row must still carry the record's id, index, editability and
 * effective bounds, so a stale record cannot survive a ledger it no longer
 * describes.
 */
function acceptedWindowedBlockRange(
  block: HTMLElement,
  ranges: SourceRangeLedger,
  accepted: AcceptedWindowedBlocks,
): EffectiveBlockRange | null {
  const record = accepted.get(block);
  if (!record || !block.isConnected) return null;
  if (
    (block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "") !== record.id
  ) return null;
  const range = ranges.get(record.id);
  if (
    !range ||
    range.id !== record.id ||
    range.index !== record.index ||
    range.editable !== record.editable ||
    range.start !== record.start ||
    range.end !== record.end
  ) return null;
  return range;
}

function captureAcceptedWindowedBlockSerializations(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	previous: AcceptedWindowedBlocks | null,
	ownedPresentation: HTMLElement | null = null,
): AcceptedWindowedBlocks {
	const accepted: AcceptedWindowedBlocks = new WeakMap();
	const claimedIds = new Set<string>();
	for (const block of Array.from(surface.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement &&
			child !== ownedPresentation &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	)) {
		const id = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
		const range = ranges.get(id);
		if (!range) {
			throw new WindowedDomStaleError("capture-missing-row");
		}
		// One accepted row belongs to exactly one mounted root. A second node
		// claiming it - forged or duplicated - cannot be recorded as the owner's
		// render of that block.
		if (claimedIds.has(id)) {
			throw new WindowedDomStaleError("capture-duplicate-row");
		}
		claimedIds.add(id);
		// A local owner refresh reads nodes that were already accepted. Its
		// prior immutable identity is the only authority for which row such a
		// node may continue to own, so a label changed during the same task
		// can never become the next record's identity. A node with no prior
		// record was not retained by this edit; it is a new root that the
		// existing adoption path already validated, and it is admitted only
		// here, never in place of a retained node's proof.
		const prior = previous ? previous.get(block) ?? null : null;
		if (
			prior &&
			(
				prior.id !== id ||
				prior.index !== range.index ||
				prior.editable !== range.editable
			)
		) {
			throw new WindowedDomStaleError("capture-prior-binding");
		}
		// The prior record is the only source of a reusable snapshot: a root
		// that still spells the exact DOM its stored serialization was computed
		// from hands that serialization forward, and every root that changed is
		// serialized again. A bare revision counter could never stand in for
		// this check, because the record - not the counter - is the proof that
		// each root still spells its accepted row.
		accepted.set(
			block,
			acceptedWindowedBlockRecord(block, id, range, prior),
		);
	}
	return accepted;
}

/**
 * Bind a mounted root to the accepted ledger row it still carries. The row is
 * the only identity authority; a root without an editable row has no binding
 * and therefore cannot claim any fence metadata.
 */
function acceptedFenceBinding(
	ranges: SourceRangeLedger,
): (root: HTMLElement) => Readonly<{ end: number; start: number }> | null {
	return (root) => {
		const id = root.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
		const range = id ? ranges.get(id) : null;
		if (!range?.editable) return null;
		return { end: range.end, start: range.start };
	};
}

function registerAcceptedWindowSnapshot(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	snapshot: ImmersiveWindowAcceptedSnapshot,
	mountedSource: string,
	sourceRevision: number | undefined,
): AcceptedWindowedBlocks | null {
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
			child !== snapshot.ownedGap &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	);
	if (
		snapshot.blocks.length !== currentBlocks.length ||
		acceptedByNode.size !== snapshot.blocks.length
	) {
		return null;
	}
	projectVisualCodeFenceMetadata(
		mountedSource,
		surface,
		acceptedFenceBinding(ranges),
	);
	const expectedFragment = surface.ownerDocument.createDocumentFragment();
	const expectedClones: HTMLElement[] = [];
	for (const acceptedBlock of snapshot.blocks) {
		const clone = acceptedBlock.node.cloneNode(false) as HTMLElement;
		clone.innerHTML = acceptedBlock.innerHTML;
		expectedFragment.append(clone);
		expectedClones.push(clone);
	}
	projectVisualCodeFenceMetadata(
		mountedSource,
		expectedFragment,
		acceptedFenceBinding(ranges),
	);
	const acceptedIds = new Set<string>();
	for (const [index, acceptedBlock] of snapshot.blocks.entries()) {
		const currentBlock = currentBlocks[index];
		const expectedInnerHTML =
			expectedClones[index]?.innerHTML ?? acceptedBlock.innerHTML;
		if (
			!currentBlock ||
			acceptedIds.has(acceptedBlock.id) ||
			!ranges.get(acceptedBlock.id) ||
			acceptedBlock.node !== currentBlock ||
			acceptedBlock.node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !==
				acceptedBlock.id ||
			currentBlock.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== acceptedBlock.id ||
			expectedInnerHTML !== acceptedBlock.node.innerHTML
		) {
			return null;
		}
		acceptedIds.add(acceptedBlock.id);
	}
	const accepted: AcceptedWindowedBlocks = new WeakMap();
	for (const [index, block] of currentBlocks.entries()) {
		const id = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
		const range = ranges.get(id);
		const acceptedBlock = acceptedByNode.get(block);
		const expectedInnerHTML =
			expectedClones[index]?.innerHTML ?? acceptedBlock?.innerHTML;
		if (
			!range ||
			!acceptedBlock ||
			acceptedBlock.id !== id ||
			acceptedBlock.node !== block ||
			expectedInnerHTML !== block.innerHTML
		) {
			return null;
		}
		// The record's identity is the snapshot's accepted id, never a label
		// read from the live node, and its bounds are the effective ledger row
		// validated above.
		accepted.set(
			block,
			acceptedWindowedBlockRecord(block, acceptedBlock.id, range, null),
		);
	}
	return accepted;
}

function assertMountedEditableBlocksMatchAccepted(
	surface: HTMLElement,
	ranges: SourceRangeLedger,
	accepted: AcceptedWindowedBlocks,
	acceptedNodes: ReadonlyArray<Node>,
	// This owner's own presentation over an empty source interval: its
	// uncommitted native text inside a certified gap, or the document-end sink
	// paragraph that is its own caret position. Neither is accepted content, so
	// its serialization is not compared. Node identity is still required, and
	// nothing else may differ.
	ownedPresentation: HTMLElement | null = null,
): void {
	const currentNodes = Array.from(surface.childNodes);
	if (
		currentNodes.length !== acceptedNodes.length ||
		currentNodes.some((node, index) => node !== acceptedNodes[index])
	) {
		throw new WindowedDomStaleError("mount-child-identity");
	}

	for (const block of Array.from(surface.children).filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement &&
			!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE),
	)) {
		if (ownedPresentation && block === ownedPresentation) continue;
		// Every accepted root - editable or not - must still own the row this
		// owner accepted for it. Reading the row from the live label would let a
		// relabelled node claim another valid row, so the record is the only
		// identity authority here.
		const range = acceptedWindowedBlockRange(block, ranges, accepted);
		const record = accepted.get(block);
		if (!range || !record) {
			throw new WindowedDomStaleError("mount-block-binding");
		}
		if (!range.editable) continue;
		if (
			null !== record.serialization &&
			normalizedWindowedBlockSerialization(block) !== record.serialization
		) {
			throw new WindowedDomStaleError("mount-serialization");
		}
	}
}

function restoreWindowRegion(
	surface: HTMLElement,
	region: ActiveRegion,
	restoreSelection = true,
): void {
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
		// Rebuild the accepted content, but keep every equivalent protected
		// descendant at its original node identity: the retained read-only
		// snapshot and the accepted certificates are bound to those exact
		// nodes, so recreating them would reject the next input or menu
		// preparation on a region that was restored unchanged.
		const restoredTemplate = surface.ownerDocument.createElement("template");
		restoredTemplate.innerHTML = snapshot.innerHTML;
		const protectedAdoption = prepareVisualProtectedNodeAdoption(
			Array.from(snapshot.node.childNodes),
			Array.from(restoredTemplate.content.childNodes),
			true,
			"protected-order",
		);
		snapshot.node.replaceChildren(...protectedAdoption.nodes);
		surface.insertBefore(snapshot.node, region.after);
	}
	if (!restoreSelection) return;
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

export function WindowedImmersiveVisualEditor({
	documentSession,
	referenceLabelCaseFoldProfile,
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
	retainCompositionSurface,
	acceptedWindowSnapshotGeneration,
	getAcceptedWindowSnapshot,
	getAcceptedWindowRow,
	getAcceptedReferenceSource,
	revealAcceptedWindowRow,
}: Props) {
	const pendingRef = useRef<Readonly<{
		markdown: string;
		signature: string;
		visualSelection: VisualSelectionSnapshot | null;
	}> | null>(null);
	const pendingHistorySelectionRef = useRef<PendingHistorySelection | null>(
		null,
	);
	const pendingNativeTextDeletionRef =
		useRef<PendingNativeTextDeletion | null>(null);
	const contextMenuSelectionRef = useRef<VisualSelectionSnapshot | null>(null);
	// The exact native selection this owner placed itself while adopting an
	// accepted Preview render (including a history restore). It exists so a
	// pointer demand on an image can replace a selection the editor restored
	// instead of treating it as a deliberate user selection. Any later
	// selection that differs from it drops the record.
	const ownerPlacedSelectionRef = useRef<VisualSelectionSnapshot | null>(null);
	const contextMenuTargetsRef = useRef(
		new WeakMap<Element, ContextMenuTargetWitness>(),
	);
	const editMapRef = useRef(editMap);
	editMapRef.current = editMap;
	const thematicBreakDeletionHistoryRef = useRef<
		ReadonlyArray<WindowedThematicBreakGap>
	>([]);
	const emptyCodeGapRef = useRef<WindowedEmptyCodeGap | null>(null);
	const emptyCodeGapHistoryRef = useRef(new Map<number, WindowedEmptyCodeGap>());
	const ownedGapPresentationRef = useRef<WindowedEmptyCodeGap | null>(null);
	// The paragraph this owner created as the document-end caret position. It
	// is presentation only, never accepted content, so it is tracked by node
	// identity independently of the gap certificate that describes it.
	const documentEndSinkRef = useRef<HTMLElement | null>(null);
	const retainCompositionSurfaceRef = useRef(retainCompositionSurface);
	retainCompositionSurfaceRef.current = retainCompositionSurface;
	const pendingPropRef = useRef(pending);
	pendingPropRef.current = pending;
	const selfWriteRef = useRef(false);
	const externalChangeReportedRef = useRef(false);
	const sourceRef = useRef(documentSession.document.getValue());
	// Immutable source snapshot described by the mounted ledger/DOM. A pending
	// structural transfer has a newer canonical source, but has not adopted DOM.
	const mountedSourceRef = useRef(sourceRef.current);
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
	const acceptedBlockSerializationsRef = useRef<AcceptedWindowedBlocks>(
		new WeakMap(),
	);
	const acceptedWindowChildNodesRef = useRef<ReadonlyArray<Node>>([]);
	const acceptedWindowSnapshotIdentityRef = useRef<Readonly<{
		key: number;
		revision: number;
		signature: string;
	}> | null>(null);
	const activeRef = useRef(false);
	const retainGapPresentation = (gap: WindowedEmptyCodeGap): void => {
		ownedGapPresentationRef.current = gap;
		const lease = retainCompositionSurfaceRef.current();
		try {
			lease.retainGap?.({ node: gap.presentation, markdown: gap.markdown,
				sourceRevision: gap.revision, html: gap.presentationHtml,
				surface, historyState: gap.historyState,
				before: gap.before, after: gap.after,
				isLive: () => activeRef.current && surface.isConnected && gap.presentation.parentNode === surface
					&& ownedGapPresentationRef.current === gap && emptyCodeGapPresentationMatchesDocument(gap, documentSession.document) });
		} finally { lease.release(); }
	};
	const promoteGapPresentation = (gap: WindowedEmptyCodeGap): void => {
		const acceptedGap = { ...gap, accepted: true };
		emptyCodeGapRef.current = acceptedGap;
		const lease = pendingHistorySelectionRef.current;
		if (lease?.emptyCodeGap === gap) {
			pendingHistorySelectionRef.current = { ...lease, emptyCodeGap: acceptedGap };
		}
		retainGapPresentation(acceptedGap);
		rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, acceptedGap);
	};
	/**
	 * Mount the certified paragraph that stands for a document-end caret.
	 *
	 * The paragraph is appended after the last child - the article's
	 * reading-order end - and carries no source of its own. Its presentation
	 * is retained first, because the gap certificate is the caret's real
	 * address: a retain that throws leaves the canonical selection and the
	 * document untouched. Only then may the caller publish a canonical
	 * selection that is not on that address yet; a caller whose selection is
	 * already canonical has nothing to publish.
	 */
	const mountDocumentEndSink = (
		markdown: string,
		revision: number,
		before: Readonly<{ end: number; source: string; start: number }>,
		selection: DocumentSelection,
		publishSelection?: () => void,
	): WindowedEmptyCodeGap => {
		const paragraph = surface.ownerDocument.createElement("p");
		paragraph.append(surface.ownerDocument.createElement("br"));
		surface.append(paragraph);
		const gap: WindowedEmptyCodeGap = {
			accepted: true,
			after: { end: markdown.length, source: "", start: markdown.length },
			before,
			documentEnd: true,
			historyState: documentSession.document.getHistoryState(),
			markdown,
			presentation: paragraph,
			presentationHtml: paragraph.innerHTML,
			revision,
			selection: { ...selection },
		};
		try {
			retainGapPresentation(gap);
			publishSelection?.();
		} catch (error) {
			if (ownedGapPresentationRef.current === gap) ownedGapPresentationRef.current = null;
			paragraph.remove();
			throw error;
		}
		emptyCodeGapRef.current = gap;
		documentEndSinkRef.current = paragraph;
		rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, gap);
		acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
		surface.ownerDocument.defaultView?.getSelection()?.collapse(paragraph, 0);
		return gap;
	};
	/**
	 * Present a canonical document-end caret the mounted window has no row
	 * for.
	 *
	 * A history point can sit in the terminal line endings after the last
	 * block (`| a | b |\n\n` with the caret between them). No row owns those
	 * bytes, and when the last block is an object the caret cannot enter, no
	 * editable node holds the position at all. The sink is this owner's
	 * certified address for exactly that canonical place, so a restore of
	 * such a point mounts it instead of failing the transfer.
	 */
	const presentDocumentEndSinkSelection = (
		markdown: string,
		selection: DocumentSelection,
	): boolean => {
		if (
			selection.direction !== "none" ||
			selection.start !== selection.end ||
			!activeRef.current ||
			!surface.isConnected ||
			"true" !== surface.getAttribute("contenteditable") ||
			documentEndSinkRef.current ||
			ownedGapPresentationRef.current
		) return false;
		const revision = documentSession.document.getRevision?.();
		if (
			!Number.isSafeInteger(revision) ||
			documentSession.document.getValue() !== markdown ||
			mountedSourceRef.current !== markdown ||
			!sameDocumentSelection(documentSession.document.getSelection(), selection)
		) return false;
		const rows = Array.from(surface.children).filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement &&
				!child.hasAttribute(WINDOW_SPACER_ATTRIBUTE) &&
				child !== documentEndSinkRef.current,
		);
		const last = rows[rows.length - 1];
		if (!last || !isWindowedAtomicRoot(last)) return false;
		const range = acceptedWindowedBlockRange(
			last,
			rangesRef.current,
			acceptedBlockSerializationsRef.current,
		);
		if (
			!range?.editable ||
			range.id !== (last.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "") ||
			range.index !== editMapRef.current.blocks.length - 1 ||
			range.end > markdown.length ||
			selection.start < range.end ||
			selection.start > markdown.length ||
			// Only the line endings the owner can certify as an owned gap may
			// be spanned here; any other bytes name a source position this
			// sink cannot stand for.
			!certifiedTextTailGapSlice(markdown.slice(range.end, markdown.length), true)
		) return false;
		mountDocumentEndSink(markdown, revision as number, {
			end: range.end,
			source: markdown.slice(range.start, range.end),
			start: range.start,
		}, selection);
		return true;
	};
	const promoteAcceptedWindowGap = (snapshot: ImmersiveWindowAcceptedSnapshot): void => {
		const transfer = pendingRef.current;
		const lease = pendingHistorySelectionRef.current;
		const gap = emptyCodeGapRef.current;
		if (!transfer || !lease || !gap || gap.accepted || lease.emptyCodeGap !== gap
			|| ownedGapPresentationRef.current !== gap || snapshot.ownedGap !== gap.presentation
			|| gap.presentation.parentNode !== surface || snapshot.signature !== transfer.signature
			|| snapshot.editMap?.signature !== transfer.signature || lease.signature !== transfer.signature
			|| lease.markdown !== transfer.markdown || gap.markdown !== transfer.markdown
			|| mountedSourceRef.current !== transfer.markdown || sourceRef.current !== transfer.markdown
			|| snapshot.sourceRevision !== gap.revision
			|| !sameDocumentSelection(lease.selection, gap.selection)
			|| !sameDocumentHistoryState(lease.historyState, gap.historyState)
			|| !emptyCodeGapMatchesDocument(gap, documentSession.document)
			|| !emptyCodeGapPresentationMatchesDocument(gap, documentSession.document)) return;
		promoteGapPresentation(gap);
	};

	/**
	 * The certified gap presentation, while its certificate still describes
	 * the mounted document. Its document-end form is the sink; every other
	 * form is a rendered empty row that a caret can legitimately sit in, so
	 * only structural captures - which must not attribute a row to it - skip
	 * it by identity.
	 */
	const ownedGapPresentationExclusion = (): HTMLElement | null => {
		const gap = ownedGapPresentationRef.current;
		return gap && gap.presentation.parentNode === surface
			&& emptyCodeGapPresentationMatchesDocument(gap, documentSession.document)
			? gap.presentation : null;
	};
	/**
	 * The paragraph this owner created as its own caret position after the
	 * last accepted row. It owns no ledger row and is never source, so every
	 * structural capture skips it by identity.
	 */
	const documentEndSinkExclusion = (): HTMLElement | null => {
		const sink = documentEndSinkRef.current;
		return sink && sink.parentNode === surface ? sink : null;
	};
	/**
	 * The node a structural capture must not treat as a rendered row: this
	 * owner's own presentation, gap or document-end sink. Nothing else is
	 * ever skipped: a real row that lost its acceptance still fails.
	 */
	const ownedPresentationExclusion = (): HTMLElement | null =>
		ownedGapPresentationExclusion() ?? documentEndSinkExclusion();
	/**
	 * The region an IME composition owns. The document-end sink is the
	 * caret's own paragraph and owns no row, so its certified snapshot is
	 * the region - restoring it can only discard this owner's own draft.
	 * Every other caret is the ordinary accepted region. Only the sink is
	 * skipped there: a certified in-document gap is a real row, and the
	 * caret being composed into it is the region's own anchor.
	 */
	const captureCompositionRegion = (
		gap: WindowedEmptyCodeGap | null | undefined,
	): ActiveRegion =>
		gap?.documentEnd === true &&
		gap.presentation === documentEndSinkRef.current
			? captureCertifiedGapRegion(surface, gap)
			: captureActiveRegion(
					surface,
					rangesRef.current,
					acceptedBlockSerializationsRef.current,
					mountedSourceRef.current,
					null,
					undefined,
					undefined,
					documentEndSinkExclusion(),
				);
	/**
	 * Retire the document-end sink. Its paragraph is presentation for one
	 * exact canonical value, so it must never outlive that value or the
	 * caret position it was created for.
	 */
	const removeDocumentEndSink = (): void => {
		const sink = documentEndSinkRef.current;
		documentEndSinkRef.current = null;
		if (!sink) return;
		if (sink.parentNode === surface) sink.remove();
		if (emptyCodeGapRef.current?.presentation === sink) {
			emptyCodeGapRef.current = null;
		}
		if (ownedGapPresentationRef.current?.presentation === sink) {
			ownedGapPresentationRef.current = null;
		}
		acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
	};

	useLayoutEffect(() => {
		if (externalChangeReportedRef.current) return;
		const transfer = pendingRef.current;
		if (transfer && transfer.signature !== previewSnapshot.signature) return;
		if (editMap.signature !== previewSnapshot.signature) {
			onFailure("visual-editor-window-signature-invalid");
			onTransferFailure();
			return;
		}
		const installed = getAcceptedWindowSnapshot?.();
		if (installed?.signature === previewSnapshot.signature &&
			installed.editMap &&
			(installed.sourceRevision === undefined ||
				installed.sourceRevision !== documentSession.document.getRevision?.())) return;
		const sourceMarkdown = documentSession.document.getValue();
		// Adopt the fresh ledger only when it describes the DOM mounted right
		// now. A map for a source the surface has not adopted yet would leave
		// live children without rows, and every later guard then reports stale
		// navigation for an ordinary edit. The existing ledger already tracks
		// this DOM through its deltas.
		const nextRanges = createBlockRanges(sourceMarkdown, editMap);
		if (ledgerDescribesMountedBlocks(surface, nextRanges, ownedPresentationExclusion())) {
			rangesRef.current = nextRanges;
			mountedSourceRef.current = sourceMarkdown;
		}
		projectVisualCodeFenceMetadata(
			mountedSourceRef.current,
			surface,
			acceptedFenceBinding(rangesRef.current),
		);
		protectVisualMarkdownReadOnlyRegions(surface);
		readOnlySnapshotRef.current =
			captureVisualMarkdownReadOnlySnapshot(surface);
		acceptedBlockSerializationsRef.current =
			captureAcceptedWindowedBlockSerializations(
				surface,
				rangesRef.current,
				null,
				ownedPresentationExclusion(),
			);
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
		if (snapshot.ownedGap && (!ownedGapPresentationRef.current || snapshot.ownedGap !== ownedGapPresentationRef.current.presentation || !emptyCodeGapPresentationMatchesDocument(ownedGapPresentationRef.current, documentSession.document))) return;
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
			mountedSourceRef.current,
			documentSession.document.getRevision?.(),
		);
		if (!accepted) {
			return;
		}
		acceptedBlockSerializationsRef.current = accepted;
		acceptedWindowChildNodesRef.current = [...snapshot.nodes];
		promoteAcceptedWindowGap(snapshot);
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
		if (!activePending) {
			pendingNativeTextDeletionRef.current = null;
			return;
		}
		if ("error" === previewStatus) {
			pendingRef.current = null;
			emptyCodeGapRef.current = null;
			ownedGapPresentationRef.current = null;
			emptyCodeGapHistoryRef.current.clear();
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
			emptyCodeGapRef.current = null;
			ownedGapPresentationRef.current = null;
			emptyCodeGapHistoryRef.current.clear();
			thematicBreakDeletionHistoryRef.current = [];
			releasePendingHistorySelection(pendingHistorySelectionRef);
			onPendingChange(false);
			onFailure("visual-editor-markdown-paste-superseded");
			onTransferFailure();
			return;
		}
		sourceRef.current = activePending.markdown;
		// Adopt the fresh ledger only when it describes the DOM mounted right
		// now. A map for a source the surface has not adopted yet would leave
		// live children without rows, and every later guard then reports stale
		// navigation for an ordinary edit. The existing ledger already tracks
		// this DOM through its deltas.
		const nextRanges = createBlockRanges(activePending.markdown, editMap);
		if (ledgerDescribesMountedBlocks(surface, nextRanges, ownedPresentationExclusion())) {
			rangesRef.current = nextRanges;
			mountedSourceRef.current = activePending.markdown;
		}
		projectVisualCodeFenceMetadata(
			mountedSourceRef.current,
			surface,
			acceptedFenceBinding(rangesRef.current),
		);
		protectVisualMarkdownReadOnlyRegions(surface);
		readOnlySnapshotRef.current =
			captureVisualMarkdownReadOnlySnapshot(surface);
		acceptedBlockSerializationsRef.current =
			captureAcceptedWindowedBlockSerializations(
				surface,
				rangesRef.current,
				null,
				ownedPresentationExclusion(),
			);
		acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
		// The accepted snapshot this render just registered still certifies this
		// DOM; dropping its identity would leave no owner to register it again.
		if (acceptedWindowSnapshotIdentityRef.current?.signature !== previewSnapshot.signature) {
			acceptedWindowSnapshotIdentityRef.current = null;
		}
		pendingRef.current = null;
		onPendingChange(false);
		const pendingHistorySelection = pendingHistorySelectionRef.current;
		if (
			pendingHistorySelection &&
			pendingHistorySelection.signature === activePending.signature &&
			pendingHistorySelection.markdown === activePending.markdown
		) {
			pendingHistorySelectionRef.current = null;
			// A fresh adoption retires any earlier ownership claim; only the
			// successful restore below records a new one.
			ownerPlacedSelectionRef.current = null;
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
					const emptyPresentation = pendingHistorySelection.emptyCodeGap;
					const retainedGap = emptyPresentation && emptyCodeGapRef.current === emptyPresentation
						&& emptyCodeGapMatchesDocument(emptyPresentation, documentSession.document)
						&& emptyPresentation.presentation.parentNode === surface
						&& emptyPresentation.presentation instanceof HTMLParagraphElement
						&& windowedGapLineParagraphShape(emptyPresentation.presentation);
					if (retainedGap) surface.ownerDocument.defaultView?.getSelection()?.collapse(
						emptyPresentation.presentation,
						emptyPresentation.presentation.childNodes.length,
					);
					const mountedSelectionRestored = Boolean(retainedGap) || restoreMountedSourceSelection(
						surface, rangesRef.current, activePending.markdown, pendingHistorySelection.selection, referenceLabelCaseFoldProfile,
						{ blockSerializations: acceptedBlockSerializationsRef.current, childNodes: acceptedWindowChildNodesRef.current });
					const emptyCodeGap = pendingHistorySelection.emptyCodeGap;
					let emptyCodeGapRestored = false;
					if (!mountedSelectionRestored && emptyCodeGap) {
						if (emptyCodeGapRef.current !== emptyCodeGap
							|| !emptyCodeGapMatchesDocument(emptyCodeGap, documentSession.document)) {
							throw new Error("visual-editor-window-history-selection-stale");
						}
						assertMountedEditableBlocksMatchAccepted(surface, rangesRef.current,
							acceptedBlockSerializationsRef.current, acceptedWindowChildNodesRef.current,
							emptyCodeGap.presentation);
						const after = restoreEmptyCodeGapSelection(surface, rangesRef.current, emptyCodeGap);
						promoteGapPresentation({ ...emptyCodeGap, presentation: after, presentationHtml: after.innerHTML });
						emptyCodeGapRestored = true;
					}
					const restored =
						mountedSelectionRestored || emptyCodeGapRestored ||
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
							: false) ||
							presentDocumentEndSinkSelection(
								activePending.markdown,
								pendingHistorySelection.selection,
							);
					if (!restored) {
						// One report per event: a pinned demand fails through the
						// transfer owner, and an unpinned one keeps the surface
						// editable with a diagnostic instead of a second copy of
						// the same code.
						if (pendingHistorySelection.releaseDocumentEndPin) {
							throw new Error(
								"visual-editor-window-history-selection-not-mounted",
							);
						}
						onDiagnostic(
							"visual-editor-window-history-selection-not-mounted",
						);
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
					// A failed capture only loses the pointer-replacement
					// exemption; it must never turn a successful restore into a
					// reported history failure.
					let placed: VisualSelectionSnapshot | null = null;
					if (restored) {
						try {
							placed = captureVisualSelection(surface);
						} catch {
							placed = null;
						}
					}
					ownerPlacedSelectionRef.current = placed;
				}
			} catch (error) {
				if (error instanceof WindowedDomStaleError) {
					onDiagnostic(`visual-editor-window-source-navigation-dom-stale:${error.reason}`);
				}
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
		activeRef.current = true;
		let composing = false;
		let pendingNavigationGesture: Readonly<{ markdown: string; revision: number; signature: string }> | null = null;
		/**
		 * Held while an accepted empty-code-gap composition owns the Preview
		 * surface. It is acquired only after the admission that binds the
		 * composition to a canonical lease, and released after that lease has
		 * published its text and requested the superseding Preview. Ordinary
		 * caret compositions never acquire it.
		 */
		let compositionSurfaceLease: Readonly<{ release: () => void }> | null = null;
		const releaseCompositionSurface = () => {
			const lease = compositionSurfaceLease;
			compositionSurfaceLease = null;
			lease?.release();
			pendingComposition?.compositionLease?.release();
		};
		let cancelPendingPaste: (() => void) | null = null;
		let visualInputBlock: VisualCodeInputSnapshot | null = null;
		let codeBodyInput: WindowedCodeBodyInputIntent | null = null;
		let textDeletion: Readonly<{
			inputType: string;
			node: Text;
			source: string;
			sourceSelection: Readonly<{ start: number; end: number }>;
			text: string;
			visualSelection: Readonly<{ start: number; end: number }>;
		}> | null = null;
		// The canonical undo group the browser itself would have produced for
		// one typed run inside a code body: consecutive plain insertText
		// keystrokes into the SAME body continue the previous history event,
		// exactly like a native editor. Any other edit - a deletion, a line
		// break, a different block, a structural change - ends the run, and
		// the next typing keystroke starts its own group.
		let codeBodyTypingRun: Readonly<{
			blockId: string;
			pre: HTMLElement;
			sourceAfter: string;
		}> | null = null;
		let rejectedComposition: ActiveRegion | null = null;
		let rejectedBeforeInput: ActiveRegion | null = null;
		let pendingComposition: Readonly<{
			childNodes: ReadonlyArray<Node>;
			compositionLease: Readonly<{ release: () => void }> | null;
			lease: PendingHistorySelection;
			region: ActiveRegion;
			revision: number | undefined;
		}> | null = null;
		let cancelledPendingComposition = false;
		let completedPendingComposition: Readonly<{ data: string; markdown: string }> | null = null;
		let ordinaryCompositionOrigin: Readonly<{
		  insertionStart: number;
		  revision: number | undefined;
		  source: string;
		  textNode: Text;
		  textOffset: number;
		  textBefore: string;
		}> | null = null;

		const captureMergeFailure = (
			error: unknown,
			phase: string,
			context: Readonly<{ sourceStart: number; sourceEnd: number; baselineLength: number; editedLength: number; blockCount: number; structural: boolean; bodyInput: boolean; deletion: boolean }>,
		): string | null => {
			if (error instanceof WindowedPendingMergeContextError) return error.diagnostic;
			if (!(error instanceof Error) || error.message !== "visual-editor-markdown-merge-failed") return null;
			const native = surface.ownerDocument.defaultView?.getSelection();
			const lease = pendingHistorySelectionRef.current;
			const canonical = documentSession.document.getValue();
			return `visual-editor-window-merge:reason=${error instanceof VisualMarkdownMergeError ? error.reason : "unclassified"};${JSON.stringify({
				phase, ...context,
				merge: error instanceof VisualMarkdownMergeError ? error.details : null,
				canonicalLength: canonical.length,
				sourceLength: sourceRef.current.length,
				mountedLength: mountedSourceRef.current.length,
				canonicalMatchesSource: canonical === sourceRef.current,
				mountedMatchesSource: mountedSourceRef.current === sourceRef.current,
				leaseMatchesSource: Boolean(lease && lease.markdown === sourceRef.current),
				focused: surface.ownerDocument.activeElement === surface,
				rangeCount: native?.rangeCount ?? 0,
				anchorType: native?.anchorNode?.nodeType ?? 0,
				anchorOffset: native?.anchorOffset ?? -1,
				focusType: native?.focusNode?.nodeType ?? 0,
				focusOffset: native?.focusOffset ?? -1,
			})}`;
		};
		const report = (error: unknown, capturedMerge: string | null = null): false => {
			if (error instanceof WindowedRowRevealError) {
				onDiagnostic(`visual-editor-window-row-reveal:stage=${error.stage};${JSON.stringify(error.details)}`);
			}
			if (error instanceof WindowedPendingImageError) {
				onDiagnostic(`visual-editor-window-pending-image:stage=${error.stage};${JSON.stringify(error.details)}`);
			}
			const mergeDiagnostic = capturedMerge ?? captureMergeFailure(error, "unclassified", { sourceStart: -1, sourceEnd: -1, baselineLength: -1, editedLength: -1, blockCount: -1, structural: false, bodyInput: false, deletion: false });
			if (mergeDiagnostic) onDiagnostic(mergeDiagnostic);
			if (error instanceof WindowedDomStaleError) {
				onDiagnostic(`visual-editor-window-source-navigation-dom-stale:${error.reason}`);
			}
			if (error instanceof WindowedPendingInputRefusal) {
				const lease = pendingHistorySelectionRef.current;
				const transfer = pendingRef.current;
				const selection = documentSession.document.getSelection();
				const history = documentSession.document.getHistoryState();
				const native = surface.ownerDocument.defaultView?.getSelection();
				const target = error.event?.getTargetRanges?.() ?? [];
				const children = Array.from(surface.childNodes);
				const accepted = acceptedWindowChildNodesRef.current;
				const inputType = error.event?.inputType;
				const canonical = documentSession.document.getValue();
				const knownInputType = inputType && (WINDOWED_PENDING_DELETION_TYPES.has(inputType)
					|| WINDOWED_CODE_BODY_DELETION_TYPES.has(inputType)
					|| WINDOWED_PENDING_TEXT_INPUT_TYPES[inputType] === true) ? inputType : "other";
				onDiagnostic(`visual-editor-window-pending-input:reason=${error.reason};${JSON.stringify({
					eventAvailable: Boolean(error.event),
					inputType: knownInputType,
					sourceLength: sourceRef.current.length,
					canonicalLength: canonical.length,
					mountedLength: mountedSourceRef.current.length,
					leaseLength: lease?.markdown.length ?? -1,
					transferLength: transfer?.markdown.length ?? -1,
					sourceMatchesLease: Boolean(lease && sourceRef.current === lease.markdown),
					canonicalMatchesSource: canonical === sourceRef.current,
					canonicalMatchesLease: Boolean(lease && canonical === lease.markdown),
					transferMatchesLease: Boolean(lease && transfer && transfer.markdown === lease.markdown),
					signatureMatches: Boolean(lease && transfer && transfer.signature === lease.signature),
					selectionStart: selection.start, selectionEnd: selection.end,
					selectionDirection: selection.direction,
					leaseStart: lease?.selection.start ?? -1, leaseEnd: lease?.selection.end ?? -1,
					leaseDirection: lease?.selection.direction ?? "none",
					undoDepth: history.undoDepth, redoDepth: history.redoDepth,
					leaseUndoDepth: lease?.historyState.undoDepth ?? -1,
					leaseRedoDepth: lease?.historyState.redoDepth ?? -1,
					focused: surface.ownerDocument.activeElement === surface,
					active,
					externalChange: externalChangeReportedRef.current,
					pendingProp: pendingPropRef.current,
					rangeCount: native?.rangeCount ?? 0,
					anchorType: native?.anchorNode?.nodeType ?? 0,
					anchorOffset: native?.anchorOffset ?? -1,
					anchorConnected: native?.anchorNode?.isConnected ?? false,
					focusType: native?.focusNode?.nodeType ?? 0,
					focusOffset: native?.focusOffset ?? -1,
					focusConnected: native?.focusNode?.isConnected ?? false,
					targetCount: target.length,
					targetStartType: target[0]?.startContainer.nodeType ?? 0,
					targetStartOffset: target[0]?.startOffset ?? -1,
					targetStartConnected: target[0]?.startContainer.isConnected ?? false,
					targetEndType: target[0]?.endContainer.nodeType ?? 0,
					targetEndOffset: target[0]?.endOffset ?? -1,
					targetEndConnected: target[0]?.endContainer.isConnected ?? false,
					liveChildren: children.length,
					acceptedChildren: accepted.length,
					childrenMatch: children.length === accepted.length && children.every((node, index) => node === accepted[index]),
				})}`);
			}
			onFailure(
				error instanceof Error
					? error.message
					: "visual-editor-window-sync-failed",
			);
			return false;
		};
		const imageInteraction = createVisualImageInteraction(surface, {
			canActivate: () =>
				active &&
				!composing &&
				!pendingRef.current &&
				!pendingPropRef.current &&
				!externalChangeReportedRef.current,
			focus: () => focusSurface(surface),
			report: (error) => report(error),
			ownsSelection: () => {
				const ownerPlaced = ownerPlacedSelectionRef.current;
				if (!ownerPlaced) return false;
				try {
					const current = captureVisualSelection(surface);
					return Boolean(current && visualSelectionEqual(ownerPlaced, current));
				} catch {
					// An uncapturable selection is never proven to be this
					// owner's own, so deliberate selections stay protected.
					return false;
				}
			},
			synchronizeSelection: () => runtime.prepareMediaSelection(),
		});
		/**
		 * The ledger is the only map from the mounted rows to the canonical
		 * source until a newer render is adopted, so every canonical
		 * replacement this owner writes or replays from history moves it. The
		 * accepted registry binds each mounted root to its row's extent; each
		 * record moves by exactly what its own row moved, so a record that had
		 * already stopped matching its row keeps failing that proof.
		 */
		const transportMountedRows = (
			changes: ReadonlyArray<DocumentTextChangeRange>,
		): void => {
			const ranges = rangesRef.current;
			const accepted = acceptedBlockSerializationsRef.current;
			const bound = Array.from(surface.children).flatMap((block) => {
				const record = block instanceof HTMLElement ? accepted.get(block) : undefined;
				const row = record ? ranges.get(record.id) : null;
				return block instanceof HTMLElement && record && row
					? [{ block, record, row }]
					: [];
			});
			// Ascending replacements apply from the last one back, so each is
			// still addressed in coordinates no earlier replacement has moved.
			for (const change of [...changes].reverse()) {
				ranges.transport(change.from, change.to, change.insert.length);
			}
			for (const { block, record, row } of bound) {
				const moved = ranges.get(record.id);
				if (!moved) continue;
				accepted.set(block, {
					...record,
					end: record.end + moved.end - row.end,
					start: record.start + moved.start - row.start,
				});
			}
		};
		const applyDocumentChange = (
			change: Parameters<typeof documentSession.document.applyTextChange>[0],
		): void => {
			// Any canonical WRITE this owner makes is one edit group boundary
			// unless the commit path itself just proved a typing continuation.
			// A selection-only sync carries the source the owner already
			// published and writes no history event, so it cannot end a typed
			// run: the browser groups by what changed, not by caret reports.
			if (change.changes || change.value !== sourceRef.current) {
				codeBodyTypingRun = null;
			}
			selfWriteRef.current = true;
			try {
				documentSession.document.applyTextChange(change);
			} finally {
				selfWriteRef.current = false;
			}
			if (change.changes) transportMountedRows([change.changes]);
		};
		const referenceContext = (source: string): ((label: string) => boolean) => {
			let reference: ((label: string) => boolean) | null = null;
			return (label) => {
				if (!reference) {
					const identity = acceptedWindowSnapshotIdentityRef.current;
					if (!identity) {
						throw new Error("visual-editor-reference-context-stale");
					}
					const formal = getAcceptedReferenceSource?.(identity);
					if (formal === null || formal === undefined) throw new Error("visual-editor-reference-context-stale");
					const parse = (markdown: string): MarkdownSyntaxNode[] => {
						const nodes: MarkdownSyntaxNode[] = [];
						markdownLanguage.parser.parse(markdown).iterate({ enter(node) {
							nodes.push({ from: node.from, name: node.name, to: node.to });
						} });
						return nodes;
					};
					const currentNodes = parse(source);
					reference = markdownReferenceContextQuery(source, currentNodes, formal,
						source === formal ? currentNodes : parse(formal), referenceLabelCaseFoldProfile);
				}
				return reference(label);
			};
		};
		const imageProjection = (
			blocks: ReadonlyArray<HTMLElement>, source: string, sourceSlice: string, baseline: string,
		): VisualMarkdownSourceIntervalMap | undefined => {
			if (!blocks.some((block) => block.querySelector("img"))) return undefined;
			const root = surface.ownerDocument.createElement("article");
			for (const block of blocks) root.append(block.cloneNode(true));
			return createVisualMarkdownImageSourceIntervalMap(root, sourceSlice, baseline, referenceContext(source));
		};
		const capture = (
			deletionEvent: InputEvent | null = null,
			deletionDirection?: DeletionDirection,
		): ActiveRegion => {
			if (externalChangeReportedRef.current) {
				throw new Error("visual-editor-window-stale");
			}
			regionRef.current = null;
			const captured = captureActiveRegion(
				surface,
				rangesRef.current,
				// The region may only claim rows these very nodes were accepted
				// with, so the registry travels into the native capture boundary.
				acceptedBlockSerializationsRef.current,
				sourceRef.current,
				deletionEvent,
				deletionDirection,
				(snapshot: ActiveRegion) => {
					regionRef.current = snapshot;
				},
				documentEndSinkExclusion(),
			);
			const source = sourceRef.current;
			const projection = imageProjection(captured.blocks, source,
				source.slice(captured.sourceStart, captured.sourceEnd), captured.baseline);
			const region = projection ? { ...captured, imageProjection: projection } : captured;
			regionRef.current = region;
			return region;
		};
		/**
		 * The identity half of readiness: this surface still mounts exactly the
		 * nodes, protected regions and editable serializations this owner
		 * accepted for the source its ledger describes. It states nothing about
		 * whether a transfer is outstanding, so a caller that must distinguish
		 * identity from readiness can use it on its own.
		 */
		const assertAcceptedMountCertificate = (): void => {
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
				ownedPresentationExclusion(),
			);
		};
		const assertReadySourceAndDom = (): string => {
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
			assertAcceptedMountCertificate();
			return source;
		};
		const prepareThematicBreakSelection =
			(): WindowedThematicBreakPreparation | null => {
				const source = assertReadySourceAndDom();
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

					throw new Error('visual-editor-selection-map-failed');
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
    const validateThematicBreakTarget = (target: Element | null): void => {
      assertReadySourceAndDom();
      const blockId = target?.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
      const range = blockId ? rangesRef.current.get(blockId) : null;
      if (
        !(target instanceof HTMLHRElement)
        || target.parentElement !== surface
        || !target.isConnected
        || !blockId
        || !range?.editable
        || range.id !== blockId
      ) throw new Error("visual-editor-selection-map-failed");
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
					region.imageProjection,
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
			const deletion = textDeletion;
			textDeletion = null;
			if (!region)
				return report(new Error("visual-editor-window-region-missing"));
			const source = sourceRef.current;
			let adoptionTransaction = false;
			let adoptionFinalized = false;
			let documentChangeApplied = false;
			// Whether this transaction reached commit as a structural edit. The
			// rollback guard below reads it, because such a commit can fail after
			// the browser has already mutated the DOM while canonical is unchanged.
			let structuralInput = false;
			let mergePhase = "commit-setup";
			let editedLength = -1;
			let blockCount = -1;
			try {
				assertVisualMarkdownReadOnlySnapshot(surface, region.readOnlySnapshot);
				const blocks = currentRegionBlocks(surface, region);
				blockCount = blocks.length;
				// The native event is allowed to change content and to remove or
				// merge whole roots, never a retained root's identity. Verify the
				// metadata-only binding of every retained root this owner accepted
				// BEFORE publishing canonical input, so a label forged during the
				// event cannot be laundered by the very commit that refreshes the
				// registry. A browser-created replacement root has no accepted
				// identity to protect and keeps the region's existing checks.
				for (const retained of region.blocks) {
					if (!blocks.includes(retained)) continue;
					if (
						!acceptedBlockSerializationsRef.current.has(retained)
					) continue;
					if (
						!acceptedWindowedBlockRange(
							retained,
							rangesRef.current,
							acceptedBlockSerializationsRef.current,
						)
					) {
						throw new WindowedDomStaleError("commit-block-binding");
					}
				}
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
				structuralInput =
					structuralChange &&
					!(
						options.allowSingleBlockStructural &&
						blocks.length === 1 &&
						region.blocks.length === 1 &&
						region.blockEnd - region.blockStart === 1
					);
				const structural = structuralInput;
				const retainedStructuralRows = structural && blocks.every((block) =>
					region.blocks.includes(block) && acceptedBlockSerializationsRef.current.has(block),
				);
				if (retainedStructuralRows) {
					const expected = acceptedWindowChildNodesRef.current.filter((node) =>
						!region.blocks.includes(node as HTMLElement) || blocks.includes(node as HTMLElement),
					);
					const actual = Array.from(surface.childNodes);
					if (expected.length !== actual.length || expected.some((node, index) => node !== actual[index])) {
						throw new WindowedDomStaleError("commit-child-identity");
					}
					for (const child of Array.from(surface.children)) {
						if (!(child instanceof HTMLElement) || blocks.includes(child)
							|| child.hasAttribute(WINDOW_SPACER_ATTRIBUTE) || child === ownedPresentationExclusion()) continue;
						const record = acceptedBlockSerializationsRef.current.get(child);
						if (!record || !acceptedWindowedBlockRange(child, rangesRef.current, acceptedBlockSerializationsRef.current)
							|| (record.editable && record.serialization !== null
								&& normalizedWindowedBlockSerialization(child) !== record.serialization)) {
							throw new WindowedDomStaleError("commit-surrounding-block-stale");
						}
					}
				}
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
				} else if (deletion) {
					const block = blocks[0];
					const snapshot = region.blockSnapshots[0];
					const native = surface.ownerDocument.defaultView?.getSelection();
					const expectedText = deletion.text.slice(0, deletion.visualSelection.start)
						+ deletion.text.slice(deletion.visualSelection.end);
					const retainedText = block?.childNodes.length === 1 && block.firstChild === deletion.node
						&& deletion.node.data === expectedText && native?.isCollapsed
						&& native.anchorNode === deletion.node && native.anchorOffset === deletion.visualSelection.start;
					const emptyParagraph = expectedText === "" && deletion.visualSelection.start === 0
						&& deletion.visualSelection.end === deletion.text.length && !deletion.node.isConnected
						&& !deletion.node.parentNode && block instanceof HTMLParagraphElement
						&& block.childNodes.length === 1 && block.firstChild instanceof HTMLBRElement
						&& block.firstChild.attributes.length === 0 && native?.isCollapsed
						&& native.anchorNode === block && native.anchorOffset === 0;
					if (source !== deletion.source || documentSession.document.getValue() !== source
						|| blocks.length !== 1 || !block || block !== region.blocks[0] || !snapshot
						|| block.attributes.length !== snapshot.attributes.length
						|| snapshot.attributes.some(({ name, value }) => block.getAttribute(name) !== value)
						|| (!retainedText && !emptyParagraph)) {
						throw new WindowedDomStaleError("native-deletion-identity");
					}
					mergePhase = "commit-native-deletion";
					const result = applyVisualMarkdownEditIntent(sourceSlice, region.baseline,
						deletion.sourceSelection, deletion.visualSelection, deletion.inputType, null);
					if (!result) throw new Error("visual-editor-markdown-merge-failed");
					replacementMarkdown = result.sourceMarkdown;
					mergePhase = "commit-native-deletion-selection";
					const mappedSelection = emptyParagraph ? result.selection : visualSelectionSourceRangeForBlocks(
						blocks, replacementMarkdown, serializeVisualMarkdownBlockFragment(blocks));
					selection = { ...mappedSelection, start: region.sourceStart + mappedSelection.start,
						end: region.sourceStart + mappedSelection.end };
				} else {
					const edited = serializeVisualMarkdownBlockFragment(blocks);
					editedLength = edited.length;
					mergePhase = "commit-merge";
					const merged = mergeVisualMarkdownChangeDetails(
						sourceSlice,
						region.baseline,
						edited,
						region.imageProjection,
					);
					mergePhase = "commit-selection";
					const resultSource = source.slice(0, region.sourceStart) + merged.value + source.slice(region.sourceEnd);
					const resultProjection = imageProjection(blocks, resultSource, merged.value, edited);
					const relativeSelection = visualSelectionSourceRangeForBlocks(
						blocks,
						merged.value,
						edited,
						resultProjection,
					);
					let mapped = merged.value;
					let mappedSelection = relativeSelection;
					// A paragraph line beginning with a fence opening stays literal
					// until the explicit Enter command. This mapped edit is one of the
					// source-write entries and uses the same shared projection as the
					// pending text owner. A real fence is a PRE, never this branch.
					if (1 === blocks.length && "P" === blocks[0]?.tagName
						&& "" !== mapped) {
						const caretLineStart = 0 === mappedSelection.start
							? 0 : mapped.lastIndexOf("\n", mappedSelection.start - 1) + 1;
						const caretLineEndIndex = mapped.indexOf("\n", mappedSelection.start);
						const caretLineEnd = caretLineEndIndex < 0 ? mapped.length : caretLineEndIndex;
						const caretLine = mapped.slice(caretLineStart, caretLineEnd);
						const lineBefore = sourceSlice.slice(
							caretLineStart,
							sourceSlice.indexOf("\n", caretLineStart) < 0
								? sourceSlice.length : sourceSlice.indexOf("\n", caretLineStart)
						);
						const literal = isMarkdownFenceOpeningLine(lineBefore)
							? null
							: projectVisualLiteralParagraphLine(
							caretLine,
							mappedSelection.start - caretLineStart
						);
						if (literal) {
							mapped = mapped.slice(0, caretLineStart)
								+ literal.markdown
								+ mapped.slice(caretLineEnd);
							mappedSelection = {
								direction: mappedSelection.direction,
								start: caretLineStart + literal.offset,
								end: caretLineStart + literal.offset
							};
						}
					}
					replacementMarkdown = mapped;
					selection = {
						direction: mappedSelection.direction,
						end: region.sourceStart + mappedSelection.end,
						start: region.sourceStart + mappedSelection.start,
					};
				}
				const value =
					source.slice(0, region.sourceStart) +
					replacementMarkdown +
					source.slice(region.sourceEnd);
				if (
				  options.compositionCommit
				  && value === options.compositionCommit.value
				  && options.compositionCommit.insertionEnd >= region.sourceStart
				  && options.compositionCommit.insertionEnd
				    <= region.sourceStart + replacementMarkdown.length
				) {
				  const end = options.compositionCommit.insertionEnd;
				  selection = { direction: "none", start: end, end };
				}
				const restoreFocus = surface.ownerDocument.activeElement === surface;
				const adoptionFinalizers: Array<() => boolean> = [];
				adoptionTransaction = structuralChange && !structural;
				if (!structural) {
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
				if (adoptionTransaction) {
					for (const finalize of adoptionFinalizers) {
						if (!finalize()) {
							throw new Error("visual-editor-window-block-adoption-failed");
						}
					}
				}
				if (bodyInput) {
					// The body edit replaces exactly one direct PRE block, so its
					// owned interval is the region start plus the serialized
					// replacement. The whole canonical document is still the EOF
					// authority, which keeps the open-fence range guard exact.
					const bodyBlock = blocks[0];
					if (!bodyBlock) {
						throw new Error("visual-editor-window-code-fence-map-invalid");
					}
					restoreRegionCodeFenceMetadata(
						surface,
						blocks,
						value,
						new Map([
							[
								bodyBlock,
								{
									end: region.sourceStart + replacementMarkdown.length,
									start: region.sourceStart,
								},
							],
						]),
						{
							documentLength: value.length,
							end: region.sourceStart + replacementMarkdown.length,
						},
					);
				}
				adoptionFinalized = adoptionTransaction;
				// One typed run in one code body: this commit continues the
				// previous plain-character insert into the SAME body only when
				// it is itself a plain character insert (on either body-edit
				// branch - a nonempty body routes inserts through the generic
				// fragment serializer), the previous commit was the same kind
				// on the same block, and the canonical source this commit
				// builds on is exactly what that previous commit produced.
				// Everything else - the run's first character, a deletion, a
				// line break, a moved or structural edit - starts a new undo
				// group, so a preceding deletion can never be folded into the
				// typing run.
				const typingCodeBodyInput =
					bodyInput
					&& ["insertText", "insertReplacementText"].includes(
						bodyInput.inputType,
					)
					&& null !== bodyInput.data
					&& !/[\r\n]/u.test(bodyInput.data)
						? bodyInput
						: null;
				const continuesCodeBodyTypingRun = Boolean(
					typingCodeBodyInput
					&& codeBodyTypingRun
					&& codeBodyTypingRun.pre === typingCodeBodyInput.pre
					&& codeBodyTypingRun.blockId === typingCodeBodyInput.blockId
					&& codeBodyTypingRun.sourceAfter === source,
				);
				applyDocumentChange({
					changes: {
						from: region.sourceStart,
						insert: replacementMarkdown,
						to: region.sourceEnd,
					},
					deferNativeBridge: !structural,
					...(continuesCodeBodyTypingRun
						? { joinPreviousHistory: true }
						: {}),
					// A typed character never appends the separate canonical
					// selection event: this owner commits every keystroke on
					// its own, and that selection event would hang off the
					// first character and block the next keystroke from
					// joining its run. The change's own selection effect still
					// records the caret; undo restores the pre-edit caret the
					// event itself carries.
					...(typingCodeBodyInput
						? { carryHistorySelectionWithoutEvent: true }
						: { recordHistorySelection: true }),
					selection,
					value,
				});
				codeBodyTypingRun =
					typingCodeBodyInput
					&& typingCodeBodyInput.pre.getAttribute(VISUAL_BLOCK_ATTRIBUTE)
						=== typingCodeBodyInput.blockId
						? {
							blockId: typingCodeBodyInput.blockId,
							pre: typingCodeBodyInput.pre,
							sourceAfter: value,
						}
					: null;
				documentChangeApplied = true;
				sourceRef.current = value;
				// Replacement adoption must precede the canonical write to own the
				// DOM transaction, so a transaction-scoped finalize already ran
				// above. A root-preserving edit instead publishes accepted content
				// only after the canonical owner accepts this exact validated local
				// transition. Exactly one of the two runs, once.
				if (!adoptionTransaction) {
					for (const finalize of adoptionFinalizers) {
						if (!finalize()) {
							throw new Error("visual-editor-window-block-adoption-failed");
						}
					}
				} else if (adoptionTransaction && value !== source) {
					// A transaction-scoped replacement finalized BEFORE this
					// write still has an accepted baseline for the pre-write
					// source. Renew every adopted root against the canonical
					// source just published; a stale witness fails here.
					for (const block of blocks) {
						const rewitness = prepareWindowBlockAdoption(block);
						if (!rewitness || !rewitness()) {
							throw new Error("visual-editor-window-block-adoption-failed");
						}
					}
				}
				if (value !== source) onMarkdownChange();
				if (structural) {
					if (retainedStructuralRows || (value === source && blocks.every((block) => acceptedBlockSerializationsRef.current.has(block)))) {
						acceptedBlockSerializationsRef.current = captureAcceptedWindowedBlockSerializations(
							surface, rangesRef.current, acceptedBlockSerializationsRef.current,
							ownedPresentationExclusion());
						acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
					}
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
					mountedSourceRef.current = value;
					acceptedBlockSerializationsRef.current =
						captureAcceptedWindowedBlockSerializations(
							surface,
							rangesRef.current,
							// Every node retained by this local edit was already
							// accepted; its prior immutable id/row is the proof that
							// a label changed during this task cannot be laundered
							// into the refreshed registry.
							acceptedBlockSerializationsRef.current,
							ownedPresentationExclusion(),
						);
					acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
				}
				protectVisualMarkdownReadOnlyRegions(surface);
				readOnlySnapshotRef.current =
					captureVisualMarkdownReadOnlySnapshot(surface);
				return true;
			} catch (error) {
				const capturedMerge = captureMergeFailure(error, mergePhase, {
					sourceStart: region.sourceStart, sourceEnd: region.sourceEnd,
					baselineLength: region.baseline.length, editedLength, blockCount,
					structural: structuralInput, bodyInput: Boolean(bodyInput), deletion: Boolean(deletion)
				});
				if (documentChangeApplied) {
					onTransferFailure();
					return report(error, capturedMerge);
				}
				// A captured transaction that failed before any canonical change
				// must leave the live region on its accepted DOM again. That
				// covers an unfinished adoption and a code-body builder input,
				// and equally a structural merge or selection edit whose commit
				// threw with `bodyInput` empty: those preserve canonical source
				// while the browser has already mutated the DOM. The guard is
				// the source itself, so a transaction whose canonical document
				// already diverged is never rolled back.
				const sourceUnchanged =
					documentSession.document.getValue() === source;
				// The guard covers the whole restoration decision, unfinished
				// adoption included: a transaction that already published a
				// newer canonical document must never have that owner's DOM
				// replaced by this older snapshot.
				if (
					sourceUnchanged &&
					((adoptionTransaction && !adoptionFinalized) ||
						bodyInput ||
						structuralInput)
				) {
					try {
						restoreWindowRegion(surface, region);
					} catch (rollbackError) {
						return report(rollbackError, capturedMerge);
					}
				}
				return report(error, capturedMerge);
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
			// The document-end sink exists only for the exact canonical value it
			// was certified against: it is this owner's caret position after the
			// last block, not source. Any other value has a real row (or a
			// different gap) at that position, so the paragraph must go before
			// the transfer is recorded.
			const sink = documentEndSinkRef.current;
			if (
				sink &&
				!(
					emptyCodeGapRef.current?.documentEnd === true &&
					emptyCodeGapRef.current.presentation === sink &&
					emptyCodeGapRef.current.markdown === markdown
				)
			) {
				removeDocumentEndSink();
			}
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
				pendingRef.current = {
					markdown,
					signature,
					visualSelection:
						captureVisualSelection(surface) ??
						captureWindowedStructuralSelection(
							surface,
							rangesRef.current,
							markdown,
							historySelection?.selection.start ?? markdown.length,
						),
				};
				if (historySelection) {
					pendingHistorySelectionRef.current = {
						markdown,
						historyState: historySelection.historyState,
						onDocumentEndSelectionRestored,
						releaseDocumentEndPin,
						restoreFocus: historySelection.restoreFocus,
						selection: historySelection.selection,
						signature,
						...(emptyCodeGapRef.current
							&& emptyCodeGapMatchesDocument(emptyCodeGapRef.current, documentSession.document)
							? { emptyCodeGap: emptyCodeGapRef.current } : {}),
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
		const adoptCommittedPendingWindow = (): void => {
			const transfer = pendingRef.current;
			const lease = pendingHistorySelectionRef.current;
			const physical = ownedGapPresentationRef.current;
			if (!transfer || !lease || !physical || !active || externalChangeReportedRef.current
				|| transfer.signature !== lease.signature || transfer.markdown !== lease.markdown
				|| transfer.markdown !== sourceRef.current || transfer.markdown !== documentSession.document.getValue()
				|| !sameDocumentSelection(documentSession.document.getSelection(), lease.selection)
				|| !sameDocumentHistoryState(documentSession.document.getHistoryState(), lease.historyState)
				|| !emptyCodeGapPresentationMatchesDocument(physical, documentSession.document)) return;
			const snapshot = getAcceptedWindowSnapshot?.();
			if (!snapshot?.editMap || snapshot.signature !== transfer.signature
				|| snapshot.editMap.signature !== transfer.signature || snapshot.ownedGap !== physical.presentation
				|| (snapshot.sourceRevision !== undefined && snapshot.sourceRevision !== documentSession.document.getRevision?.())
				|| !Number.isSafeInteger(snapshot.key) || snapshot.key < 0
				|| !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return;
			const previous = acceptedWindowSnapshotIdentityRef.current;
			if (previous?.key === snapshot.key && previous.revision === snapshot.revision && previous.signature === snapshot.signature) return;
			const ranges = createBlockRanges(transfer.markdown, snapshot.editMap);
			const pendingGap = lease.emptyCodeGap;
			if (pendingGap
				&& pendingGap.after.start === transfer.markdown.length
				&& pendingGap.after.end === transfer.markdown.length
				&& "" === pendingGap.after.source) {
				const rebound = ranges.all().filter((range) => {
					const formalSource = transfer.markdown.slice(range.start, range.end);
					const suffix = transfer.markdown.slice(pendingGap.before.end, range.end);
					return range.editable
						&& range.start === pendingGap.before.start
						&& range.end > pendingGap.before.end
						&& range.end <= pendingGap.after.start
						&& formalSource.startsWith(pendingGap.before.source)
						&& /^(?:\r\n|\r|\n)$/u.test(suffix);
				});
				if (rebound.length > 1) throw new Error("visual-editor-window-history-selection-map-ambiguous");
				const nextRange = rebound[0];
				if (nextRange) {
					const nextGap: WindowedEmptyCodeGap = {
						...pendingGap,
						before: {
							end: nextRange.end,
							source: transfer.markdown.slice(nextRange.start, nextRange.end),
							start: nextRange.start,
						},
					};
					emptyCodeGapRef.current = nextGap;
					pendingHistorySelectionRef.current = { ...lease, emptyCodeGap: nextGap };
					retainGapPresentation(nextGap);
					rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, nextGap);
				}
			}
			const accepted = registerAcceptedWindowSnapshot(surface, ranges, snapshot, transfer.markdown, documentSession.document.getRevision?.());
			if (!accepted) return;
			// This certificate comes from the actual installed formal commit,
			// not from the editable draft or a later parent props render.
			rangesRef.current = ranges;
			mountedSourceRef.current = transfer.markdown;
			acceptedBlockSerializationsRef.current = accepted;
			acceptedWindowChildNodesRef.current = [...snapshot.nodes];
			promoteAcceptedWindowGap(snapshot);
			protectVisualMarkdownReadOnlyRegions(surface);
			readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
			acceptedWindowSnapshotIdentityRef.current = { key: snapshot.key, revision: snapshot.revision, signature: snapshot.signature };
		};
		const assertPendingInputDom = (): VisualMarkdownReadOnlySnapshot => {
			adoptCommittedPendingWindow();
			const readOnly = readOnlySnapshotRef.current;
			if (!readOnly) throw new Error("visual-editor-window-read-only-snapshot-missing");
			assertVisualMarkdownReadOnlySnapshot(surface, readOnly);
			assertMountedEditableBlocksMatchAccepted(surface, rangesRef.current,
				acceptedBlockSerializationsRef.current, acceptedWindowChildNodesRef.current,
				ownedPresentationExclusion());
			return readOnly;
		};
		/**
		 * The mounted rows a remembered gap can be rebuilt on. The gap's own
		 * extents name the document it belongs to, so they only match a row of
		 * the surface that is already mounted; a block the history restore
		 * brings back has no DOM of its own before the accepted preview.
		 */
		const gapOwnerRows = (extent: WindowedEmptyCodeGap["before"]): HTMLElement[] => {
			const mountedMarkdown = mountedSourceRef.current;
			return Array.from(surface.children).filter((child): child is HTMLElement => {
				if (!(child instanceof HTMLElement) || child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) return false;
				const range = acceptedWindowedBlockRange(child, rangesRef.current, acceptedBlockSerializationsRef.current);
				if (!range?.editable || range.start !== extent.start) return false;
				if (range.end === extent.end && mountedMarkdown.slice(range.start, range.end) === extent.source) return true;
				return range.end > extent.end
					&& mountedMarkdown.slice(range.start, range.end).startsWith(extent.source)
					&& /^(?:\r\n|\r|\n)$/u.test(mountedMarkdown.slice(extent.end, range.end));
			});
		};
		/**
		 * Retire the presentation held for a gap whose document value the
		 * history restore replaces.
		 */
		const discardGapPresentation = (): void => {
			// The sink is old presentation for a different value; the paragraph
			// a restore builds is the new caret position (and becomes the sink
			// again when the restored gap is a document-end one).
			removeDocumentEndSink();
			const previous = ownedGapPresentationRef.current;
			if (previous?.presentation.isConnected && previous.presentation.parentNode === surface) {
				previous.presentation.remove();
			}
			ownedGapPresentationRef.current = null;
			emptyCodeGapRef.current = null;
		};
		const prepareHistoryGapPresentation = (
			gap: WindowedEmptyCodeGap,
			markdown: string,
			revision: number,
			historyState: DocumentHistoryState,
		): WindowedEmptyCodeGap => {
			discardGapPresentation();
			const find = (extent: WindowedEmptyCodeGap["before"]): HTMLElement => {
				const matches = gapOwnerRows(extent);
				if (matches.length !== 1 || !matches[0]) throw new Error("visual-editor-window-history-selection-map-failed");
				return matches[0];
			};
			const before = find(gap.before);
			const after = gap.after.start === markdown.length && gap.after.end === markdown.length && gap.after.source === ""
				? null
				: find(gap.after);
			const paragraph = surface.ownerDocument.createElement("p");
			paragraph.append(surface.ownerDocument.createElement("br"));
			if (after) after.before(paragraph);
			else before.after(paragraph);
			// A document-end gap keeps its paragraph as the surface's own caret
			// position after the last block, so this replacement paragraph is
			// the sink for exactly this value.
			if (gap.documentEnd === true) documentEndSinkRef.current = paragraph;
			surface.ownerDocument.defaultView?.getSelection()?.collapse(paragraph, paragraph.childNodes.length);
			return {
				...gap,
				accepted: false,
				historyState,
				markdown,
				presentation: paragraph,
				presentationHtml: paragraph.innerHTML,
				revision,
			};
		};
		/**
		 * A remembered gap can only be rebuilt where its owning row is still
		 * mounted. When the restore itself brings that block back, there is no
		 * row to attach the paragraph to yet: the accepted preview mounts it and
		 * presents the document end through the history pin instead.
		 */
		const restoreHistoryGapPresentation = (
			gap: WindowedEmptyCodeGap,
			markdown: string,
			revision: number,
			historyState: DocumentHistoryState,
		): WindowedEmptyCodeGap | null => {
			if (gap.after.start !== markdown.length || gap.after.end !== markdown.length || "" !== gap.after.source) return gap;
			const owners = gapOwnerRows(gap.before);
			if (owners.length > 1) throw new Error("visual-editor-window-history-selection-map-failed");
			if (0 === owners.length) {
				discardGapPresentation();
				return null;
			}
			return prepareHistoryGapPresentation(gap, markdown, revision, historyState);
		};
		const pendingInputLease = (event?: InputEvent): PendingHistorySelection => {
			const transfer = pendingRef.current;
			const lease = pendingHistorySelectionRef.current;
			const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
			const ownedGap = lease?.emptyCodeGap;
			const ownsGapSelection = Boolean(ownedGap && emptyCodeGapRef.current === ownedGap
				&& emptyCodeGapMatchesDocument(ownedGap, documentSession.document) && nativeSelection?.isCollapsed
				&& emptyCodeGapBoundary(ownedGap, nativeSelection.anchorNode, nativeSelection.anchorOffset)
				&& emptyCodeGapBoundary(ownedGap, nativeSelection.focusNode, nativeSelection.focusOffset));
			const visualSelection =
				captureVisualSelection(surface) ??
				(lease
					? captureWindowedStructuralSelection(
							surface,
							rangesRef.current,
							lease.markdown,
							lease.selection.start,
						)
					: null);
			if (!active || externalChangeReportedRef.current || !transfer || !lease ||
				transfer.signature !== lease.signature || transfer.markdown !== lease.markdown ||
				surface.ownerDocument.activeElement !== surface ||
				!nativeSelection?.rangeCount) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
			if (!ownsGapSelection && (!transfer.visualSelection || !visualSelection ||
				!visualSelectionEqual(transfer.visualSelection, visualSelection))) {
				throw new WindowedPendingDomIdentityError(
					"visual-editor-window-pending-selection-stale",
				);
			}
			let readOnly: VisualMarkdownReadOnlySnapshot;
			try {
				readOnly = assertPendingInputDom();
			} catch (error) {
				const reason = error instanceof WindowedDomStaleError
					&& ["mount-child-identity", "mount-block-binding", "mount-serialization"].includes(error.reason)
					? error.reason
					: error instanceof Error && error.message === "visual-editor-window-read-only-snapshot-missing"
						? "read-only-snapshot-missing"
						: error instanceof Error && error.message === "visual-editor-read-only-region-mutated"
							? "read-only-region-mutated" : "unclassified";
				throw new WindowedPendingInputDomError(`visual-editor-window-pending-selection-stale:dom:${error instanceof Error ? error.message : String(error)}`, reason);
			}
			if (selectionIntersectsReadOnlyRegion(nativeSelection, readOnly)) {
				throw new Error("visual-editor-read-only-region-mutated");
			}
			const targets = event?.getTargetRanges?.() ?? [];
			const target = targets[0];
			const range = nativeSelection.getRangeAt(0);
			if (target && readOnly.some(({ node }) => node.contains(target.startContainer) || node.contains(target.endContainer))) {
				throw new Error("visual-editor-read-only-region-mutated");
			}
			let targetMatches = !target || (target.startContainer === range.startContainer && target.startOffset === range.startOffset &&
				target.endContainer === range.endContainer && target.endOffset === range.endOffset);
			if (!targetMatches && target && range.collapsed && target.startContainer === target.endContainer && target.startOffset === target.endOffset && lease.emptyCodeGap) {
				targetMatches = emptyCodeGapMatchesDocument(lease.emptyCodeGap, documentSession.document)
					&& emptyCodeGapBoundary(lease.emptyCodeGap, range.startContainer, range.startOffset)
					&& emptyCodeGapBoundary(lease.emptyCodeGap, target.startContainer, target.startOffset);
			}
			if (!targetMatches && target && range.collapsed && target.startContainer === target.endContainer && target.startOffset === target.endOffset && event?.inputType !== "insertReplacementText") {
				const inputBlock = captureVisualCodeInputSnapshot(selectedVisualCodeBlock(surface));
				if (inputBlock) {
					const nativeOffset = visualCodeBodyDomOffset(inputBlock.code, { node: range.startContainer, offset: range.startOffset });
					const targetOffset = visualCodeBodyDomOffset(inputBlock.code, { node: target.startContainer, offset: target.startOffset });
					targetMatches = nativeOffset !== null && targetOffset !== null && nativeOffset === targetOffset;
				}
			}
			if (!targetMatches && target && range.collapsed && target.collapsed
				&& target.startContainer.isConnected && surface.contains(target.startContainer)
				&& visualSelection) {
				// A browser target range can name the same canonical source point
				// through a different DOM node than the live caret (for example the
				// row the pending render just re-created). The operation is owned by
				// the certified lease either way, so prove the equivalence on the
				// canonical source selection instead of on node identity.
				const live = surface.ownerDocument.defaultView?.getSelection();
				if (live) {
					const saved = range.cloneRange();
					const probe = target.startContainer.ownerDocument?.createRange();
					if (!probe) throw new WindowedPendingInputRefusal("target-probe-unavailable", event);
					probe.setStart(target.startContainer, target.startOffset);
					probe.collapse(true);
					live.removeAllRanges();
					live.addRange(probe);
					let targetCanonical: VisualSelectionSnapshot | null = null;
					try {
						targetCanonical = captureVisualSelection(surface);
					} catch {
						targetCanonical = null;
					} finally {
						live.removeAllRanges();
						live.addRange(saved);
					}
					targetMatches = Boolean(targetCanonical
						&& visualSelectionEqual(targetCanonical, visualSelection));
				}
			}
			if (targets.length > 1 || !targetMatches || (event?.inputType === "insertReplacementText" &&
				(!target || !range.collapsed || lease.selection.start !== lease.selection.end))) {
				throw new WindowedPendingInputRefusal(targets.length > 1 ? "multiple-targets"
					: !targetMatches ? "target-range-mismatch" : "replacement-range-unsupported", event);
			}
			return lease;
		};
		const assertPendingCanonicalLease = (lease: PendingHistorySelection): void => {
			const valueOk = documentSession.document.getValue() === lease.markdown && sourceRef.current === lease.markdown;
			const currentSelection = documentSession.document.getSelection();
			const selectionOk = sameDocumentSelection(currentSelection, lease.selection);
			const historyOk = sameDocumentHistoryState(documentSession.document.getHistoryState(), lease.historyState);
			if (!active || externalChangeReportedRef.current || !valueOk || !selectionOk || !historyOk) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
		};
		/**
		 * A pending transfer whose recorded caret is a certified token edge
		 * keeps that exact point and opens its own paragraph, exactly like the
		 * accepted path. The certificate comes from the recorded canonical
		 * caret plus the live gap's own direct child, so the still-outstanding
		 * render's rows are never asked to describe the newer source.
		 */
		const applyStructuralPendingCanonicalText = (
			lease: PendingHistorySelection,
			text: string,
		): boolean => {
			assertPendingCanonicalLease(lease);
			const gap = visualStructuralBoundaryCapture(
				surface,
				lease.markdown,
				windowedStructuralBlocks(surface, rangesRef.current),
				lease.selection.start,
			);
			if (!gap) return false;
			// The recorded canonical caret is the authority while the matching
			// Preview is outstanding: it is still the break's edge, or the
			// point inside the paragraph this owner opened beside it. Any other
			// caret keeps the ordinary pending text owner.
			const token = visualStructuralBoundaryTokenNear(
				lease.markdown,
				lease.selection.start,
				gap.edge,
			);
			if (!token) return false;
			const insertion = visualStructuralParagraphInsertion(
				lease.markdown,
				token,
				gap.edge,
				lease.selection.start,
				text.replace(/\r\n|\r/g, "\n"),
			);
			if (insertion.value === lease.markdown) return true;
			const selection: DocumentSelection = {
				direction: "none",
				end: insertion.selection.end,
				start: insertion.selection.start,
			};
			applyDocumentChange({
				changes: insertion.changes,
				recordHistorySelection: true,
				selection,
				value: insertion.value,
			});
			sourceRef.current = insertion.value;
			onMarkdownChange();
			requestFormalPreview(
				insertion.value,
				{
					historyState: documentSession.document.getHistoryState(),
					restoreFocus: surface.ownerDocument.activeElement === surface,
					selection,
				},
				{ pinWindowSelection: true },
			);
			return true;
		};
		const acceptedEmptyCodeGap = (): WindowedEmptyCodeGap | null => {
			const gap = emptyCodeGapRef.current;
			const native = surface.ownerDocument.defaultView?.getSelection();
			return gap?.accepted && emptyCodeGapMatchesDocument(gap, documentSession.document)
				&& surface.ownerDocument.activeElement === surface && native?.isCollapsed
				&& emptyCodeGapBoundary(gap, native.anchorNode, native.anchorOffset)
				&& emptyCodeGapBoundary(gap, native.focusNode, native.focusOffset) ? gap : null;
		};
		/**
		 * The document-end sink while the native caret is inside it. Chromium
		 * relocates a host-boundary caret after a trailing object to the host
		 * start, so that position only exists as a real paragraph this owner
		 * certified. The paragraph has no source of its own: its edit commands
		 * address the trailing object's source instead.
		 */
		const documentEndGapCaret = (): WindowedEmptyCodeGap | null => {
			const gap = acceptedEmptyCodeGap();
			return gap?.documentEnd === true
				&& gap.presentation === documentEndSinkRef.current
				&& gap.presentation.parentNode === surface
				? gap
				: null;
		};
		/**
		 * The nearest materialised node before the sink, ignoring separators,
		 * when that node is an object this owner may remove as a whole.
		 *
		 * The sink's Backspace removes the trailing object's own source range,
		 * so the node must pass the removal proof, not only the caret-entry
		 * classifier: a table container is an atomic root the caret cannot
		 * enter, yet its cells are editable interior, and removing it would
		 * delete the table's whole source. Such a root is refused here, and
		 * the adjacent-neighbour proof below consumes the press with no write.
		 */
		const documentEndGapAtomic = (
			gap: WindowedEmptyCodeGap,
		): HTMLElement | null => {
			let node: Node | null = gap.presentation.previousSibling;
			while (node instanceof Text && /^\s*$/u.test(node.data)) {
				node = node.previousSibling;
			}
			return node instanceof HTMLElement
				&& !node.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
				&& isWindowedAtomicRemovalRoot(node)
				? node
				: null;
		};
		const applyPendingCodeBodyText = (
			gap: WindowedEmptyCodeGap,
			pre: HTMLElement,
			nativeText: string,
		): void => {
			const source = gap.markdown;
			const sourceRange = gap.codeBodySourceRange;
			if (!sourceRange || sourceRange.start < 0 || sourceRange.end < sourceRange.start
				|| sourceRange.end > source.length) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
			const code = pre.querySelector<HTMLElement>(":scope > code");
			if (!code || pre.parentNode !== surface) {
				throw new Error("visual-editor-code-body-map-stale");
			}
			const baseline = serializeVisualMarkdownBlockFragment([pre]);
			const native = surface.ownerDocument.defaultView?.getSelection();
			if (!native?.isCollapsed || !native.rangeCount) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
			const range = native.getRangeAt(0);
			if (!code.contains(range.startContainer) && range.startContainer !== code) {
				throw new Error("visual-editor-code-body-selection-invalid");
			}
			if (range.startContainer instanceof Text) {
				range.startContainer.insertData(range.startOffset, nativeText);
				native.collapse(range.startContainer, range.startOffset + nativeText.length);
			} else {
				const inserted = surface.ownerDocument.createTextNode(nativeText);
				range.insertNode(inserted);
				native.collapse(inserted, inserted.length);
			}
			normalizeVisualCodePlaceholders(surface, "insertText", pre);
			const sourceSlice = source.slice(sourceRange.start, sourceRange.end);
		const edited = serializeVisualMarkdownBlockFragment([pre]);
		let merged: ReturnType<typeof mergeVisualMarkdownChangeDetails>;
		let relativeSelection: ReturnType<typeof visualSelectionSourceRangeForBlocks>;
		let mergePhase = "pending-code-merge";
		try {
			merged = mergeVisualMarkdownChangeDetails(sourceSlice, baseline, edited);
			mergePhase = "pending-code-selection";
			relativeSelection = visualSelectionSourceRangeForBlocks([pre], merged.value, edited);
		} catch (error) {
			const captured = captureMergeFailure(error, mergePhase, {
				sourceStart: sourceRange.start, sourceEnd: sourceRange.end,
				baselineLength: baseline.length, editedLength: edited.length, blockCount: 1,
				structural: false, bodyInput: true, deletion: false
			});
			if (captured) throw new WindowedPendingMergeContextError(captured);
			throw error;
		}
		const value = source.slice(0, sourceRange.start)
			+ merged.value
			+ source.slice(sourceRange.end);
		const selection: DocumentSelection = {
			direction: relativeSelection.direction,
			end: sourceRange.start + relativeSelection.end,
			start: sourceRange.start + relativeSelection.start,
		};
		applyDocumentChange({
			changes: { from: sourceRange.start, insert: merged.value, to: sourceRange.end },
			recordHistorySelection: true,
			selection,
			value,
		});
		sourceRef.current = value;
		const revision = documentSession.document.getRevision?.();
		if (!Number.isSafeInteger(revision)) {
			throw new Error("visual-editor-window-pending-selection-stale");
		}
		const historyState = documentSession.document.getHistoryState();
		const spliceDelta = merged.value.length - (sourceRange.end - sourceRange.start);
		const transport = (extent: Readonly<{ end: number; start: number; source: string }>) =>
			extent.start >= sourceRange.end
				? { ...extent, start: extent.start + spliceDelta, end: extent.end + spliceDelta }
				: extent;
		const nextGap: WindowedEmptyCodeGap = {
			...gap,
			after: transport(gap.after),
			accepted: false,
			codeBodySourceRange: {
				end: sourceRange.end + spliceDelta,
				start: sourceRange.start,
			},
			historyState,
			markdown: value,
			presentationHtml: pre.innerHTML,
			revision: revision as number,
			selection,
		};
		emptyCodeGapRef.current = nextGap;
		acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
		readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
		retainGapPresentation(nextGap);
		rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, nextGap);
		onMarkdownChange();
		requestFormalPreview(value, {
			historyState,
			restoreFocus: surface.ownerDocument.activeElement === surface,
			selection,
		}, { pinWindowSelection: true });
	};
		const applyEmptyCodeGapText = (gap: WindowedEmptyCodeGap, text: string, pendingLease?: PendingHistorySelection, settleWithoutFocus = false): void => {
			if (emptyCodeGapRef.current !== gap || !emptyCodeGapMatchesDocument(gap, documentSession.document)) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
			if (pendingLease) {
				// A settled composition has already certified its captured canonical
				// range; native focus and the visual mapping no longer participate.
				const leaseIsLive = settleWithoutFocus
					? pendingRef.current?.signature === pendingLease.signature
						&& pendingRef.current?.markdown === pendingLease.markdown
					: pendingInputLease() === pendingLease;
				if (pendingLease !== pendingHistorySelectionRef.current || pendingLease.emptyCodeGap !== gap || !leaseIsLive) {
					throw new Error("visual-editor-window-pending-selection-stale");
				}
			} else assertReadySourceAndDom();
			let start = gap.selection.start;
			const end = start;
			const lineEnding = sourceLineEndingBefore(gap.markdown, start);
			const nativeText = text.replace(/\r\n|\r|\n/g, lineEnding);
			// The certified gap is the blank source interval BETWEEN two accepted
			// rows: `start` is the first byte of the following row, not a position
			// inside it. Ordinary text typed here is its own Markdown block, so it
			// needs the same blank-line separation the source already used on each
			// side. Splicing the raw character would glue it to the following
			// row's first line and silently rewrite that row (a heading's next
			// paragraph, a fence delimiter, a table header).
			const gapSeparator = gap.markdown.slice(gap.before.end, start);
			// Typing into a source-neutral gap is its own Markdown block only when
			// the caret is exactly at the following accepted row's first byte and
			// that row does not already own a leading blank line. A row whose own
			// source begins with a line ending keeps its blank line as the
			// insertion point (the existing middle-gap contract), and a caret
			// earlier in a longer gap is already inside blank source.
			// A gap at the document end has no following row to collide with, so
			// its text simply continues the terminal blank line.
			const hasFollowingRow = gap.after.start < gap.markdown.length
				|| '' !== gap.after.source;
			const followingRowOwnsLeadingBlank = /^(?:\r\n|\r|\n)/u.test(gap.after.source);
			const separatesAsOwnBlock = !/[\r\n]/u.test(nativeText)
				&& '' !== nativeText
				&& hasFollowingRow
				&& start === gap.after.start
				&& /^(?:\r\n|\r|\n)*$/u.test(gapSeparator)
				&& !followingRowOwnsLeadingBlank;
			// When the captured gap already holds the blank line it is separated on
			// the left. A tight gap has no separator bytes at all: an ordinary
			// paragraph then needs one blank line before the new block, while an
			// ATX heading terminates itself and needs none. The trailing blank line
			// is always required, because `start` is the following row's first byte.
			const leftSeparator = separatesAsOwnBlock
				&& '' === gapSeparator
				&& !/^#{1,6}[ \t]/u.test(gap.before.source)
					? lineEnding
					: '';
			const lineBreakOnly = nativeText.length > 0 && !/[^\r\n]/u.test(nativeText);
			// A line break at the document end opens the paragraph after the last
			// block. The terminal line already exists there, so only the line
			// endings that separate the new block are missing: splicing the raw
			// break would just terminate the last line and leave the caret in a
			// position no row owns. Two terminal endings already separate it, so
			// that command changes nothing at all.
			const terminalBreak = lineBreakOnly && !hasFollowingRow
				? missingTerminalSeparators(gap.markdown, lineEnding)
				: null;
			let replacement = terminalBreak !== null
				? terminalBreak
				: separatesAsOwnBlock
					? `${leftSeparator}${nativeText}${lineEnding}${lineEnding}`
					: nativeText;
			let replacementStart = start;
			const presentation = gap.presentation;
			const echoesText = nativeText.length > 0 && !/[\r\n]/u.test(nativeText);
			const mountedPresentation = echoesText && presentation.isConnected && presentation.parentNode === surface ? presentation : null;
			// The echo paragraph is the owner's own. A certified gap paragraph
			// (its lone BR or its own single draft Text) is used directly; an
			// accepted row element the acceptance collapsed the caret onto is
			// never drafted into - the owner opens its own paragraph directly
			// before that row, exactly where the certified gap sits.
			const echoParagraph = (() => {
				if (!mountedPresentation) return null;
				if (mountedPresentation instanceof HTMLParagraphElement) return mountedPresentation;
				const rowRange = acceptedWindowedBlockRange(mountedPresentation, rangesRef.current, acceptedBlockSerializationsRef.current);
				if (!rowRange || rowRange.start !== gap.after.start || rowRange.end !== gap.after.end) return null;
				const paragraph = surface.ownerDocument.createElement("p");
				mountedPresentation.before(paragraph);
				acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
				return paragraph;
			})();
			const ownedParagraph = null !== echoParagraph;
			const paragraph = echoParagraph ?? presentation;
			const draftStart = gap.draftSourceStart ?? start;
			const codeBody = paragraph.matches("pre")
				? paragraph.querySelector<HTMLElement>(":scope > code")
				: null;
			if (codeBody) {
				if (!pendingLease) {
					throw new Error("visual-editor-window-pending-selection-stale");
				}
				applyPendingCodeBodyText(gap, paragraph, nativeText);
				return;
			}
			// The paragraph the terminal break would open already exists in the
			// source, so the command only presents the caret at it: nothing is
			// spliced and the certified presentation stays exactly as accepted.
			if ("" === terminalBreak) return;
			// A line break inside the certified gap is a real input line: echo it
			// in the owned paragraph and move the native caret to that new line.
			// The canonical splice below still advances the source by one LF, so
			// the visible line and the source position stay the same operation.
			if (lineBreakOnly && paragraph instanceof HTMLParagraphElement
				&& paragraph.parentNode === surface
				&& Array.from(paragraph.childNodes).every((child) => child instanceof HTMLBRElement)) {
				const count = nativeText.split(/\r\n|\r|\n/u).length - 1;
				for (let line = 0; line < count; line += 1) {
					paragraph.append(surface.ownerDocument.createElement("br"));
				}
				const native = surface.ownerDocument.defaultView?.getSelection();
				if (native) {
					native.removeAllRanges();
					native.collapse(paragraph, paragraph.childNodes.length);
				}
			}
			if (ownedParagraph) {
				const previousText = paragraph.textContent ?? "";
				const projected = projectVisualLiteralFencePrefix(previousText + nativeText);
				if (projected) {
					const previousSource = projectVisualLiteralFencePrefix(previousText)?.markdown ?? previousText;
					if (draftStart < 0 || draftStart > end || gap.markdown.slice(draftStart, end) !== previousSource) {
						throw new Error("visual-editor-window-pending-selection-stale");
					}
					replacementStart = draftStart;
					replacement = projected.markdown;
				}
			}
			const value = gap.markdown.slice(0, replacementStart) + replacement + gap.markdown.slice(end);
			// The caret is the owner's own inserted text, which sits inside the
			// separation it just established: after the opening blank line for a
			// new block, or at the end of the draft text otherwise.
			const caret = separatesAsOwnBlock && replacementStart === start
				? start + leftSeparator.length + nativeText.length
				: replacementStart + replacement.length;
			const selection: DocumentSelection = { direction: "none", start: caret, end: caret };
			// The owned draft echoes the character in the gap presentation before
			// any renderer responds, so typing is visible while the formal Preview
			// is still outstanding. The draft is never recorded as accepted
			// content: it is one token this owner renews with each certified
			// splice, and the formal acceptance hands it over atomically.
			// Only ordinary text echoes. A line break keeps the certified empty-gap
			// presentation (its lone BR) exactly as the accepted render describes
			// it, and the echo only ever touches a paragraph this owner holds, never
			// a neighbour row the acceptance may have collapsed onto.
			// Visible draft bytes stay native; source escaping belongs only to
			// the canonical paragraph projection until the explicit block command.
			if (ownedParagraph) {
				const existing = paragraph.childNodes.length === 1
					&& paragraph.firstChild instanceof Text ? paragraph.firstChild : null;
				const draft = existing ?? paragraph.ownerDocument.createTextNode("");
				if (!existing) paragraph.replaceChildren(draft);
				draft.appendData(nativeText);
				const native = surface.ownerDocument.defaultView?.getSelection();
				if (native) {
					native.removeAllRanges();
					native.collapse(draft, draft.length);
				}
			}
			emptyCodeGapRef.current = null;
			applyDocumentChange({ changes: { from: replacementStart, to: end, insert: replacement }, recordHistorySelection: true, selection, value });
			sourceRef.current = value;
			const revision = documentSession.document.getRevision?.();
			if (!Number.isSafeInteger(revision)) throw new Error("visual-editor-window-pending-selection-stale");
			const historyState = documentSession.document.getHistoryState();
			// The splice transports both neighbouring extents by its own delta, so
			// the certificate keeps naming the same real source rows. A line break
			// additionally keeps the certified empty-gap presentation, exactly as
			// the accepted empty-gap contract requires; ordinary text continues the
			// same owned draft instead, so the next character is the same operation
			// rather than a second, unrelated pending input.
			const spliceDelta = replacement.length - (end - replacementStart);
			const transport = (extent: Readonly<{ end: number; start: number; source: string }>) =>
				extent.start >= start
					? { ...extent, start: extent.start + spliceDelta, end: extent.end + spliceDelta }
					: extent;
			const nextGap: WindowedEmptyCodeGap = {
				...gap,
				markdown: value,
				selection,
				revision: revision as number,
				historyState,
				after: transport(gap.after),
				presentationHtml: paragraph.innerHTML,
				accepted: !echoesText,
				// A freshly separated block records where its own draft text starts -
				// after the leading separator but before the typed characters - so
				// the next character continues this same block instead of re-opening
				// the following row's line or re-proving a caret-relative slice.
				...(echoesText
					? { draftSourceStart: separatesAsOwnBlock ? caret - nativeText.length : draftStart }
					: {}),
			};
			emptyCodeGapRef.current = nextGap;
			retainGapPresentation(nextGap);
			rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, nextGap);
			onMarkdownChange();
			requestFormalPreview(value, { historyState: documentSession.document.getHistoryState(), restoreFocus: surface.ownerDocument.activeElement === surface, selection }, { pinWindowSelection: true });
		};
		/**
		 * A certified text draft holding a complete fence opening at its caret
		 * keeps the block Enter command while its formal Preview is outstanding.
		 * The command is the same shared shortcut owner the accepted path uses,
		 * so a typed tilde or backtick opener becomes the equally wide backtick
		 * fence, and the canonical block text is that owner's own block
		 * serialization. The draft stops being a gap, and the shortcut's Preview
		 * supersedes the outstanding one.
		 */
		const applyPendingFenceShortcut = (
			lease: PendingHistorySelection,
			draft: WindowedEmptyCodeGap,
			event: KeyboardEvent,
		): boolean => {
			const text = draft.presentation.textContent ?? "";
			// Only a complete fence opening owns the command. Every other Enter
			// keeps the ordinary pending text owner.
			if (!/^ {0,3}(?:`{3,}|~{3,})[^`]*$/u.test(text)) return false;
			if (!Number.isSafeInteger(draft.draftSourceStart)) return false;
			const start = draft.draftSourceStart as number;
			const end = draft.after.start;
			if (start < 0 || end < start || end < lease.selection.start || end > lease.markdown.length) return false;
			// The pending draft owns the source extent through the next accepted row.
			// At canonical EOF that row is empty and contributes no trailer; prove
			// that exact case before the shortcut can mutate the mounted paragraph.
			const trailer = lease.markdown.slice(lease.selection.start, end);
			const authenticatedEofWithoutTrailer = trailer === ""
				&& end === lease.markdown.length
				&& draft.after.start === draft.after.end
				&& draft.after.source === ""
				&& draft.after.start === lease.selection.start;
			if (!/^[\r\n]+$/u.test(trailer) && !authenticatedEofWithoutTrailer) return false;
			assertPendingCanonicalLease(lease);
			assertPendingInputDom();
			if (!applyVisualBlockShortcut(surface, event)) return false;
			const native = surface.ownerDocument.defaultView?.getSelection();
			const anchor = native?.anchorNode;
			const element = anchor instanceof Element ? anchor : anchor?.parentElement;
			const pre = element?.closest("pre");
			if (!(pre instanceof HTMLElement) || pre.parentNode !== surface)
				throw new WindowedPendingInputRefusal("shortcut-pre-root-missing");
			// The fragment serializer omits the article's trailing block separator,
			// so the draft's own separator (between its text end and the following
			// row) is preserved verbatim as the block's trailing separation.
			const serialized = serializeVisualMarkdownBlockFragment([pre]).replace(/^[\r\n]+/u, "") + trailer;
			if ("" === serialized)
				throw new WindowedPendingInputRefusal("shortcut-serialization-empty");
			const firstBreak = serialized.search(/[\r\n]/u);
			const breakLength = firstBreak < 0
				? 0
				: serialized.startsWith("\r\n", firstBreak) ? 2 : 1;
			// The caret opens the fence's empty body line, i.e. just after the
			// opening line's own line ending.
			const caret = start + (firstBreak < 0 ? serialized.length : firstBreak + breakLength);
			const selection: DocumentSelection = { direction: "none", start: caret, end: caret };
			const value = lease.markdown.slice(0, start) + serialized + lease.markdown.slice(end);
			applyDocumentChange({ changes: { from: start, insert: serialized, to: end },
				recordHistorySelection: true, selection, value });
			sourceRef.current = value;
			const spliceDelta = serialized.length - (end - start);
			const transport = (extent: Readonly<{ end: number; start: number; source: string }>) =>
				extent.start >= start
					? { ...extent, start: extent.start + spliceDelta, end: extent.end + spliceDelta }
					: extent;
			const revision = documentSession.document.getRevision?.();
			if (!Number.isSafeInteger(revision)) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
			const historyState = documentSession.document.getHistoryState();
			const nextGap: WindowedEmptyCodeGap = {
				...draft,
				after: transport(draft.after),
				accepted: false,
				codeBodySourceRange: {
					end: transport(draft.after).start,
					start: draft.before.end,
				},
				historyState,
				markdown: value,
				presentation: pre,
				presentationHtml: pre.innerHTML,
				revision: revision as number,
				selection,
			};
			emptyCodeGapRef.current = nextGap;
			acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
			readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
			retainGapPresentation(nextGap);
			rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, nextGap);
			onMarkdownChange();
			requestFormalPreview(value, {
				historyState: documentSession.document.getHistoryState(),
				restoreFocus: surface.ownerDocument.activeElement === surface,
				selection,
			}, { pinWindowSelection: true });
			return true;
		};
		const applyPendingCanonicalCodeBodyDeletion = (
			lease: PendingHistorySelection,
			event: InputEvent,
		): boolean => {
			// A deletion during the pending window is owned by the pending
			// source lease itself. It passes the SAME lease gate the insert
			// path uses - call pendingInputLease() without the event so the
			// noncollapsed native target is not compared against the collapsed
			// lease caret - retaining the focus, lease-liveness, visual
			// selection and read-only DOM proofs. On top of that gate, the
			// deletion adds its own target proof: exactly one target range,
			// nonempty, both endpoints inside the one authenticated mounted
			// CODE, and the projected interval touching the lease selection
			// (a backward deletion removes the character before the caret, a
			// forward one the character after; anything else retargets and
			// rejects). The deleted interval comes from the lease's
			// authoritative markdown, never from re-serializing the surface.
			let leaseGate: PendingHistorySelection;
			try {
				leaseGate = pendingInputLease();
			} catch {
				return false;
			}
			if (
				leaseGate !== lease ||
				(event.getTargetRanges?.() ?? []).length !== 1
			) {
				return false;
			}
			const inputBlock = captureVisualCodeInputSnapshot(
				selectedVisualCodeBlock(surface),
			);
			if (!inputBlock || !inputBlock.pre.isConnected) return false;
			const operationGap = lease.emptyCodeGap?.presentation === inputBlock.pre
				? lease.emptyCodeGap
				: null;
			const row = acceptedWindowedBlockRange(
				inputBlock.pre,
				rangesRef.current,
				acceptedBlockSerializationsRef.current,
			);
			const operationRange = operationGap?.codeBodySourceRange ?? null;
		if (!row?.editable && !operationRange) return false;
			if (!operationGap && !row) return false;
			const source = lease.markdown;
		const blockStart = row?.start ?? operationRange?.start;
		const blockEnd = row?.end ?? operationRange?.end;
			if (
			blockStart === undefined ||
			blockEnd === undefined ||
			blockStart < 0 ||
			blockEnd <= blockStart ||
			blockEnd > source.length
			) {
				return false;
			}
		const blockSlice = source.slice(blockStart, blockEnd);
			const target = event.getTargetRanges?.()[0];
		if (operationGap && inputBlock.placeholder && "deleteContentBackward" === event.inputType) {
			assertPendingCanonicalLease(lease);
			const shortcut = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Backspace",
			});
			if (!applyVisualBlockShortcut(surface, shortcut)) return false;
			// The shared shortcut replaces the PRE, so the lease's old
			// presentation is detached. Resolve the live replacement from the
			// connected native caret before publishing the authenticated source
			// deletion; never serialize a retired node as a pending fallback.
			const native = surface.ownerDocument.defaultView?.getSelection();
			const anchor = native?.anchorNode;
			const element = anchor instanceof Element ? anchor : anchor?.parentElement;
			const paragraph = element?.closest("p");
			if (!(paragraph instanceof HTMLParagraphElement) || paragraph.parentNode !== surface) return false;
			// The code-body range begins at the authenticated before-row extent,
			// while the draft source start marks the actual fence opener. Preserve
			// that exact separator when the fence is removed, so the owned paragraph
			// returns to the source gap that preceded this operation.
			const draftSourceStart = operationGap.draftSourceStart;
			if (
				typeof draftSourceStart !== "number"
				|| !Number.isSafeInteger(draftSourceStart)
				|| draftSourceStart < blockStart
				|| draftSourceStart > blockEnd
			) return false;
			const draftStart = draftSourceStart as number;
			const sourceGap = source.slice(blockStart, draftStart);
			if (!/^[\r\n]*$/u.test(sourceGap)) return false;
			const value = source.slice(0, blockStart) + sourceGap + source.slice(blockEnd);
			const selection: DocumentSelection = { direction: "none", end: blockStart, start: blockStart };
			applyDocumentChange({
				changes: { from: blockStart, insert: sourceGap, to: blockEnd },
				recordHistorySelection: true,
				selection,
				value,
			});
			sourceRef.current = value;
			const revision = documentSession.document.getRevision?.();
			if (!Number.isSafeInteger(revision)) throw new Error("visual-editor-window-pending-selection-stale");
			const historyState = documentSession.document.getHistoryState();
			const delta = value.length - source.length;
			const transport = (extent: Readonly<{ end: number; start: number; source: string }>) =>
				extent.start >= blockEnd
					? { ...extent, start: extent.start + delta, end: extent.end + delta }
					: extent;
			const nextGap: WindowedEmptyCodeGap = {
				before: operationGap.before,
				after: transport(operationGap.after),
				accepted: false,
				historyState,
				markdown: value,
				...(operationGap.draftSourceStart !== undefined
					? { draftSourceStart: operationGap.draftSourceStart }
					: {}),
				presentation: paragraph,
				presentationHtml: paragraph.innerHTML,
				revision: revision as number,
				selection,
			};
			emptyCodeGapRef.current = nextGap;
			acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
			readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
			retainGapPresentation(nextGap);
			rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, nextGap);
			onMarkdownChange();
			requestFormalPreview(value, {
				historyState,
				restoreFocus: surface.ownerDocument.activeElement === surface,
				selection,
			}, { pinWindowSelection: true });
			return true;
		}
			if (
				!target ||
				target.collapsed ||
				!(
					(target.startContainer === inputBlock.code ||
						inputBlock.code.contains(target.startContainer)) &&
					(target.endContainer === inputBlock.code ||
						inputBlock.code.contains(target.endContainer))
				)
			) {
				return false;
			}
			// Correspondence: a collapsed lease must be touched on the side its
			// inputType consumes. A real selection is its own interval - both
			// Backspace and forward Delete must name exactly that interval and
			// nothing beside it. Any other target is a retarget and rejects.
			const leaseSelection = lease.selection;
			const collapsedLease = leaseSelection.start === leaseSelection.end;
			const leaseCaret = leaseSelection.start;
			/**
			 * A canonical-only pending write leaves this CODE showing the text
			 * it was accepted with while the source has moved on, so its DOM
			 * cannot be projected through the newer slice. The lease's
			 * canonical selection is then the authority, exactly as for a
			 * pending paragraph: the accepted presentation must be unchanged,
			 * and the browser target must be precisely the authenticated native
			 * selection, or the one grapheme it consumes beside the caret.
			 */
			const retainedPresentationInterval = (): Readonly<{
				body: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
				from: number;
				to: number;
			}> | null => {
				if (operationGap || !row) return null;
				const record = acceptedBlockSerializationsRef.current.get(inputBlock.pre);
				if (!record || normalizedWindowedBlockSerialization(inputBlock.pre) !== record.serialization) return null;
				const native = surface.ownerDocument.defaultView?.getSelection();
				if (!native?.anchorNode || !native.focusNode) return null;
				const offsetOf = (node: Node, offset: number) => visualCodeBodyDomOffset(inputBlock.code, { node, offset });
				const anchor = offsetOf(native.anchorNode, native.anchorOffset);
				const focus = offsetOf(native.focusNode, native.focusOffset);
				const targetStart = offsetOf(target.startContainer, target.startOffset);
				const targetEnd = offsetOf(target.endContainer, target.endOffset);
				if (null === anchor || null === focus || null === targetStart || null === targetEnd) return null;
				const backward = "deleteContentBackward" === event.inputType;
				if (!backward && "deleteContentForward" !== event.inputType) return null;
				let from = leaseSelection.start;
				let to = leaseSelection.end;
				if (collapsedLease) {
					if (anchor !== focus) return null;
					const text = visualCodeBodyDomText(inputBlock.code);
					const consumed = backward
						? targetEnd === anchor && targetStart === previousGraphemeBoundary(text, anchor)
						: targetStart === anchor && targetEnd === nextGraphemeBoundary(text, anchor);
					if (!consumed) return null;
					if (backward) from = previousGraphemeBoundary(source, leaseCaret);
					else to = nextGraphemeBoundary(source, leaseCaret);
				} else if (targetStart !== Math.min(anchor, focus) || targetEnd !== Math.max(anchor, focus)) {
					return null;
				}
				try {
					return { body: visualCodeBodyIntervalAtOrdinal(blockSlice, 0), from: from - blockStart, to: to - blockStart };
				} catch {
					return null;
				}
			};
			let projection: ReturnType<typeof projectVisualCodeBodySelection> | null;
			try {
				projection = projectVisualCodeBodySelection(
					inputBlock.code,
					blockSlice,
					blockSlice,
					0,
					{
						end: {
							node: target.endContainer,
							offset: target.endOffset,
						},
						start: {
							node: target.startContainer,
							offset: target.startOffset,
						},
					},
				);
			} catch {
				projection = null;
			}
			const interval = projection
				? { body: projection.sourceInterval, from: projection.sourceSelection.start, to: projection.sourceSelection.end }
				: retainedPresentationInterval();
			if (!interval) return false;
			const { body, from: localFrom, to: localTo } = interval;
			// The projection states block-relative offsets: prove the deleted
			// interval sits strictly inside the body before lifting it to the
			// document coordinates the canonical write needs.
			if (
				localFrom >= localTo ||
				body.bodyStart > localFrom ||
				localTo > body.bodyEnd
			) {
				return false;
			}
			const from = blockStart + localFrom;
			const to = blockStart + localTo;
			let matchesLease: boolean;
			if (operationGap) {
				const native = surface.ownerDocument.defaultView?.getSelection();
				if (!native?.isCollapsed || !native.anchorNode || !native.focusNode) return false;
				let nativeProjection: ReturnType<typeof projectVisualCodeBodySelection>;
				try {
					nativeProjection = projectVisualCodeBodySelection(
						inputBlock.code,
						blockSlice,
						blockSlice,
						0,
						{
							end: { node: native.focusNode, offset: native.focusOffset },
							start: { node: native.anchorNode, offset: native.anchorOffset },
						},
					);
				} catch {
					return false;
				}
				const nativeCaret = blockStart + nativeProjection.sourceSelection.start;
				matchesLease = "deleteContentBackward" === event.inputType
					? to === nativeCaret
					: "deleteContentForward" === event.inputType
						? from === nativeCaret
						: false;
			} else {
				matchesLease = collapsedLease
					? "deleteContentBackward" === event.inputType
						? to === leaseCaret
						: "deleteContentForward" === event.inputType
							? from === leaseCaret
							: from === leaseCaret || to === leaseCaret
					: from === leaseSelection.start && to === leaseSelection.end;
			}
			if (!matchesLease) return false;
			assertPendingCanonicalLease(lease);
			// The next body comes from the projection's own block-relative
			// interval, never from re-slicing the shrunken document: the
			// ledger row and body offsets still describe the pre-deletion
			// block, so absolute slicing would read past the body's new end.
			// The raw source slice passes through unchanged: the reconciler
			// normalizes expectedBody itself, and re-encoding here would
			// rewrite mixed existing line endings.
			const nextBody =
				blockSlice.slice(body.bodyStart, localFrom) +
				blockSlice.slice(localTo, body.bodyEnd);
			// Deleting a marker can leave a literal closing run in the body
			// (for example "~~x~" minus "x" is "~~~"). The maintained
			// code-fence owner widens the OUTER fence for exactly that body;
			// the raw byte splice must not close the block early and
			// reinterpret the following block. Its interval is this row's own
			// authenticated slice, never the whole document.
			let fenceExpansion: VisualCodeFenceBodyExpansion | null;
			try {
				fenceExpansion = expandVisualCodeFenceForBody(
					blockSlice,
					0,
					nextBody,
				);
			} catch {
				// The maintained expansion owner refuses a block whose fence
				// shape it cannot prove; this deletion must then stay a no-op
				// instead of publishing a raw splice it could not reframe.
				return false;
			}
			let changes: { from: number; insert: string; to: number } = {
				from,
				insert: "",
				to,
			};
			let caretOffset = from;
			let replacementMarkdown: string | null = null;
			let value: string;
			if (fenceExpansion) {
				// The expansion must serialize exactly the raw-spliced block:
				// anything else would rewrite bytes this gesture never edited.
				const unexpandedBlock =
					blockSlice.slice(0, localFrom) + blockSlice.slice(localTo);
				if (fenceExpansion.unexpandedMarkdown !== unexpandedBlock) {
					throw new Error("visual-editor-code-body-map-stale");
				}
				replacementMarkdown = fenceExpansion.markdown;
				changes = {
						from: blockStart,
					insert: replacementMarkdown,
						to: blockEnd,
				};
				caretOffset = from + fenceExpansion.openingFenceDelta;
				value =
						source.slice(0, blockStart) +
					replacementMarkdown +
						source.slice(blockEnd);
			} else {
				value = source.slice(0, from) + source.slice(to);
			}
			const selection: DocumentSelection = {
				direction: "none",
				start: caretOffset,
				end: caretOffset,
			};
			applyDocumentChange({
				changes,
				recordHistorySelection: true,
				selection,
				value,
			});
			sourceRef.current = value;
			const caret: DocumentSelection = { direction: "none", start: caretOffset, end: caretOffset };
			if (!projection) {
				// A retained presentation stays as accepted, exactly like a
				// pending insertion; the formal Preview renders the new body.
				onMarkdownChange();
				requestFormalPreview(value, {
					historyState: documentSession.document.getHistoryState(),
					restoreFocus: surface.ownerDocument.activeElement === surface,
					selection: caret,
				}, { pinWindowSelection: true });
				return true;
			}
			// The native event was prevented, so this owner performs the very
			// deletion the target described in the live CODE, then reconciles
			// the body to the published canonical text: the target's endpoints
			// were already proven inside this CODE, so deleting its contents
			// applies exactly the projected interval.
			const liveTarget = surface.ownerDocument.createRange();
			liveTarget.setStart(target.startContainer, target.startOffset);
			liveTarget.setEnd(target.endContainer, target.endOffset);
			liveTarget.deleteContents();
			reconcileVisualCodeBodyDom(
				inputBlock.code,
				nextBody,
				// The caret after any deletion sits at the removed interval's
				// start; the projection's local selection already states it
				// in DOM-relative offsets, which is what the reconciler
				// expects - a source-byte offset would overcount after CRLF.
				projection.localSelection.start,
			);
			if (null !== replacementMarkdown) {
				if (operationGap) {
					applyVisualCodeFenceMetadataFromSource(inputBlock.pre, replacementMarkdown);
				} else {
					if (!row) throw new Error("visual-editor-code-body-map-stale");
				// The widened opening family is the accepted DOM's own fence
				// metadata now: later projections and block serializations
				// must read the widened family, not the pre-deletion one.
				restoreRegionCodeFenceMetadata(
					surface,
					[inputBlock.pre],
					value,
					new Map([
						[
							inputBlock.pre,
							{
								end: row.start + replacementMarkdown.length,
								start: row.start,
							},
						],
					]),
					{
						documentLength: value.length,
						end: row.start + replacementMarkdown.length,
					},
				);
				}
			}
			if (operationGap) {
				const revision = documentSession.document.getRevision?.();
				if (!Number.isSafeInteger(revision)) {
					throw new Error("visual-editor-window-pending-selection-stale");
				}
				const historyState = documentSession.document.getHistoryState();
				const delta = value.length - source.length;
				const transport = (extent: Readonly<{ end: number; start: number; source: string }>) =>
					extent.start >= blockEnd
						? { ...extent, start: extent.start + delta, end: extent.end + delta }
						: extent;
				const nextGap: WindowedEmptyCodeGap = {
					...operationGap,
					after: transport(operationGap.after),
					accepted: false,
					codeBodySourceRange: {
						end: blockEnd + delta,
						start: blockStart,
					},
					historyState,
					markdown: value,
					presentationHtml: inputBlock.pre.innerHTML,
					revision: revision as number,
					selection,
				};
				emptyCodeGapRef.current = nextGap;
				acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
				readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
				retainGapPresentation(nextGap);
				rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, nextGap);
				onMarkdownChange();
				requestFormalPreview(value, {
					historyState,
					restoreFocus: surface.ownerDocument.activeElement === surface,
					selection,
				}, { pinWindowSelection: true });
				return true;
			}
			mountedSourceRef.current = value;
			// The owner just made this edit: refresh its own accepted
			// serialization and mirror through the existing capture owners, so
			// an immediately following keystroke under the still-pending
			// Preview re-proves the same block instead of meeting a stale
			// certificate.
			acceptedBlockSerializationsRef.current =
				captureAcceptedWindowedBlockSerializations(
					surface,
					rangesRef.current,
					acceptedBlockSerializationsRef.current,
					ownedPresentationExclusion(),
				);
			acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
			readOnlySnapshotRef.current =
				captureVisualMarkdownReadOnlySnapshot(surface);
			onMarkdownChange();
			requestFormalPreview(value, {
				historyState: documentSession.document.getHistoryState(),
				restoreFocus: surface.ownerDocument.activeElement === surface,
				selection: caret,
			}, { pinWindowSelection: true });
			return true;
		};
		const applyPendingCanonicalText = (lease: PendingHistorySelection, text: string, compositionSettlement = false, nativeTyping = false): void => {
			assertPendingCanonicalLease(lease);
			if (lease.emptyCodeGap) {
				applyEmptyCodeGapText(lease.emptyCodeGap, text, pendingRef.current || pendingPropRef.current ? lease : undefined, compositionSettlement);
				return;
			}
			const source = lease.markdown;
			const { start, end } = lease.selection;
			if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) {
				throw new Error("visual-editor-window-pending-selection-stale");
			}
			let replacement = text.replace(/\r\n|\r|\n/g, sourceLineEndingBefore(source, start));
			let changes = { from: start, insert: replacement, to: end };
			let caret = start + replacement.length;
			// A paragraph line that starts with a fence opening stays literal until
			// the explicit Enter command, even while a formal Preview is pending.
			// Only this owner's own paragraph line is projected; code bodies never
			// reach this branch.
			const nativeParagraph = (() => {
				const node = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
				const element = node instanceof Element ? node : node?.parentElement;
				const paragraph = element?.closest("p");
				return paragraph && paragraph.parentElement === surface
					&& !paragraph.closest("pre, code, [contenteditable=\"false\"]") ? paragraph : null;
			})();
			if (nativeTyping && nativeParagraph) {
				const lineStart = 0 === start ? 0 : source.lastIndexOf("\n", start - 1) + 1;
				const nextBreak = source.indexOf("\n", end);
				const lineEnd = nextBreak < 0 ? source.length : nextBreak;
				const line = source.slice(lineStart, start)
					+ replacement
					+ source.slice(end, lineEnd);
				const literal = isMarkdownFenceOpeningLine(source.slice(lineStart, lineEnd))
					? null
					: projectVisualLiteralParagraphLine(
						line,
						start - lineStart + replacement.length
					);
				if (literal) {
					changes = { from: lineStart, insert: literal.markdown, to: lineEnd };
					replacement = literal.markdown;
					caret = lineStart + literal.offset;
				}
			}
			const value = changes.from === start && changes.to === end
				? source.slice(0, start) + replacement + source.slice(end)
				: source.slice(0, changes.from) + replacement + source.slice(changes.to);
			if (value === source) return;
			const selection: DocumentSelection = { direction: "none", start: caret, end: caret };
			applyDocumentChange({ changes,
				recordHistorySelection: true, selection, value });
			sourceRef.current = value;
			onMarkdownChange();
			requestFormalPreview(value, {
				historyState: documentSession.document.getHistoryState(),
				restoreFocus: surface.ownerDocument.activeElement === surface,
				selection,
			}, { pinWindowSelection: true });
		};
		const captureNativeImageDeletion = (
			event: InputEvent, block: HTMLElement, blockIndex: number, caret: number,
			source: string, sourceStart: number, sourceEnd: number, baseline: string,
			direction: DeletionDirection,
		): PendingNativeTextDeletion | "image-target-unproved" | null => {
			if (!paragraphOwnsNativeDeletion(block, event, direction)) return null;
			const target = event.getTargetRanges?.()[0];
			if (!target) return null;
			const range = surface.ownerDocument.createRange();
			range.setStart(target.startContainer, target.startOffset);
			range.setEnd(target.endContainer, target.endOffset);
			const fragment = range.cloneContents();
			if (fragment.querySelectorAll("img").length !== 1) return null;
			const walker = surface.ownerDocument.createTreeWalker(fragment, NodeFilter.SHOW_ALL);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (node instanceof Text ? node.length > 0 : !(node instanceof Element)
					|| !node.matches("img, a, em, strong, del, span")
					|| node.matches(`[contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)) return "image-target-unproved";
			}
			const selected = Array.from(block.querySelectorAll("img")).filter((image) => {
				const imageRange = surface.ownerDocument.createRange(); imageRange.selectNode(image);
				return range.compareBoundaryPoints(Range.START_TO_START, imageRange) <= 0
					&& range.compareBoundaryPoints(Range.END_TO_END, imageRange) >= 0;
			});
			const native = surface.ownerDocument.defaultView?.getSelection();
			if (selected.length !== 1 || !(block instanceof HTMLParagraphElement) || !native?.anchorNode) return "image-target-unproved";
			const image = selected[0];
			if (!image) return "image-target-unproved";
			const sourceSlice = source.slice(sourceStart, sourceEnd);
			const referenceDefined = referenceContext(source);
			const edge = visualBoundaryForImageSourceEdge(block, sourceSlice, caret - sourceStart, referenceDefined);
			if (!edge || !equivalentParagraphBoundaries(block, edge, { node: native.anchorNode, offset: native.anchorOffset })) return "image-target-unproved";
			const imageRange = visualSourceRangeForRenderedImage(block, image, sourceSlice, referenceDefined);
			const retired = visualRetiredInlineSourceRange(block, image, sourceSlice, imageRange);
			let removed: Node = image;
			while (removed.parentElement && removed.parentElement !== block
				&& removed.parentElement.matches("a, em, strong, del")
				&& removed.parentElement.childNodes.length === 1) removed = removed.parentElement;
			const parent = removed.parentNode;
			if (!parent || !block.contains(parent)) return "image-target-unproved";
			const index = Array.prototype.indexOf.call(parent.childNodes, removed) as number;
			if (index < 0) return "image-target-unproved";
			const expected = block.cloneNode(true) as HTMLElement;
			const expectedRemoved = nodeAtPath(expected, nodePathWithin(block, removed));
			const precedingNode = removed.previousSibling;
			const expectedPreceding = precedingNode instanceof Text ? nodeAtPath(expected, nodePathWithin(block, precedingNode)) : null;
			const preceding = precedingNode instanceof Text && expectedPreceding instanceof Text
				? { node: precedingNode, data: precedingNode.data, expected: expectedPreceding } : null;
			expectedRemoved.parentNode?.removeChild(expectedRemoved);
			const retained: Node[] = [];
			const nodes = surface.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_ALL);
			for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
				if (node !== removed && !removed.contains(node)) retained.push(node);
			}
			return { baseline, block, blockId: block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "", blockIndex, caret,
				inputType: event.inputType, source, sourceEnd, sourceSlice, sourceStart, targetCollapsed: false,
				imageDeletion: { from: sourceStart + retired.start, to: sourceStart + retired.end, expected, removed, retained, parent, index, preceding } };
		};
		const pendingDeletionApplies = (event: InputEvent): true | string => {
			const forward = ["deleteContentForward", "deleteWordForward"].includes(
				event.inputType,
			);
			const source = sourceRef.current;
			const lease = pendingHistorySelectionRef.current;
			if (!lease || lease.markdown !== source || !active || externalChangeReportedRef.current) {
				return "lease-source";
			}
			const selection = lease.selection;
			if (
				!Number.isInteger(selection.start) ||
				!Number.isInteger(selection.end) ||
				selection.start < 0 ||
				selection.end < selection.start ||
				selection.end > source.length
			) return "selection-bounds";
			const commit = (
				from: number,
				to: number,
				caret: number,
			): void => {
				const value = source.slice(0, from) + source.slice(to);
				const postSelection: DocumentSelection = {
					direction: "none",
					end: caret,
					start: caret,
				};
				regionRef.current = null;
				applyDocumentChange({
					changes: { from, insert: "", to },
					recordHistorySelection: true,
					selection: postSelection,
					value,
				});
				sourceRef.current = value;
				onMarkdownChange();
				requestFormalPreview(
					value,
					{
						historyState: documentSession.document.getHistoryState(),
						restoreFocus: surface.ownerDocument.activeElement === surface,
						selection: postSelection,
					},
					{
						// A canonical deletion keeps the caret at the document
						// end whenever only separator line endings follow it;
						// the restored window has to mount that end again.
						pinWindowSelection:
							value.length > 0 &&
							isMarkdownTerminalWhitespaceSuffix(value.slice(caret)),
					},
				);
			};
			const caret = selection.start;
			const word = event.inputType.startsWith("deleteWord");
			const graphemeFrom = (index: number): number => {
				if (!word) return previousGraphemeBoundary(source, index);
				let end = index;
				while (end > 0 && /\s/u.test(source.charAt(end - 1))) end -= 1;
				while (end > 0 && !/\s/u.test(source.charAt(end - 1))) end -= 1;
				return end;
			};
			const graphemeTo = (index: number): number => {
				if (!word) return nextGraphemeBoundary(source, index);
				let end = index;
				while (end < source.length && /\s/u.test(source.charAt(end))) end += 1;
				while (end < source.length && !/\s/u.test(source.charAt(end))) end += 1;
				return end;
			};
			/**
			 * Delete one grapheme at the pending canonical caret. This is the
			 * owner's answer whenever the mounted row cannot prove that it
			 * still spells the pending source: the canonical caret is the
			 * authority, and the browser's own mutation of an unproved row
			 * would publish nothing because the native input stays suppressed
			 * while this transfer is live.
			 */
			const canonicalDeletion = (): true | string => {
				if (forward) {
					if (caret >= source.length) {
						if (event.cancelable) event.preventDefault();
						return true;
					}
					const to = graphemeTo(caret);
					if (to <= caret || !event.cancelable) return "canonical-deletion-unavailable";
					event.preventDefault();
					commit(caret, to, caret);
					return true;
				}
				if (caret <= 0) {
					if (event.cancelable) event.preventDefault();
					return true;
				}
				const from = graphemeFrom(caret);
				if (from >= caret || !event.cancelable) return "canonical-deletion-unavailable";
				event.preventDefault();
				commit(from, caret, from);
				return true;
			};
			// A real selection is its own canonical interval; both deletion
			// directions remove exactly that interval.
			const canonicalAnswer = (): true | string => {
				if (selection.start === selection.end) return canonicalDeletion();
				if (!event.cancelable) return "selection-deletion-not-cancelable";
				event.preventDefault();
				commit(selection.start, selection.end, selection.start);
				return true;
			};
			let leaseGate: "native" | "canonical" = "native";
			try {
				pendingInputLease();
				leaseGate = "canonical";
				assertPendingCanonicalLease(lease);
			} catch (error) {
				// A render installed for this same transfer can replace the nodes
				// the transfer captured. The canonical caret and history still
				// describe the pending source, so the deletion proceeds there
				// instead of letting the browser mutate an unproved row.
				if (!(error instanceof WindowedPendingDomIdentityError)) {
					if (error instanceof WindowedPendingInputRefusal) return error.reason;
					if (leaseGate === "canonical") return "canonical-lease-rejected";
					if (error instanceof WindowedPendingInputDomError) return `lease-dom-${error.reason}`;
					if (error instanceof Error && error.message === "visual-editor-window-pending-selection-stale") return "lease-selection-stale";
					if (error instanceof Error && error.message === "visual-editor-read-only-region-mutated") return "lease-read-only";
					return "lease-gate-rejected";
				}
				try {
					assertPendingCanonicalLease(lease);
				} catch {
					return "canonical-lease-rejected";
				}
				return canonicalAnswer();
			}
			if (selection.start !== selection.end) return canonicalAnswer();
			const native = surface.ownerDocument.defaultView?.getSelection();
			const block = native?.anchorNode
				? rootBlock(surface, native.anchorNode)
				: null;
			if (
				!block ||
				block.parentElement !== surface ||
				block.hasAttribute(WINDOW_SPACER_ATTRIBUTE) ||
				block.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR) ||
				isWindowedAtomicRoot(block)
			) {
				return canonicalDeletion();
			}
			const blockId = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "";
			// The pending source is already newer than the edit map the last
			// adopted Preview carried; its line coordinates describe a source
			// this deletion no longer edits. The ledger tracks this mounted row
			// through every owner delta, so only its effective bounds describe
			// the source this deletion must edit.
			const ledgerRange = acceptedWindowedBlockRange(
				block,
				rangesRef.current,
				acceptedBlockSerializationsRef.current,
			);
			if (!ledgerRange || ledgerRange.id !== blockId) return canonicalDeletion();
			// The lease's canonical caret is the authority. A mounted row can
			// only serve a deletion the caret proves is its own: while a
			// transfer is in flight the native caret may still sit on a row the
			// owner placed as a provisional address (removing the trailing
			// object leaves no row at the document end), and an in-row deletion
			// there would publish a change to a block the user never pointed at.
			if (caret < ledgerRange.start || caret > ledgerRange.end) {
				return canonicalDeletion();
			}
			const blockIndex = ledgerRange.index;
			const sourceStart = ledgerRange.start;
			const sourceEnd = ledgerRange.end;
			// An emptied row owns a zero-length canonical extent; a Backspace at
			// its start is still the join with the block before it, never a
			// reason to let the native mutation run past this owner.
			if (blockIndex < 0 || sourceEnd < sourceStart || sourceEnd > source.length) return canonicalDeletion();
			const sourceSlice = source.slice(sourceStart, sourceEnd);
			let baseline: string;
			try {
				baseline = serializeVisualMarkdownBlockFragment([block]);
			} catch {
				return "row-serialization-failed";
			}
			try {
				const image = captureNativeImageDeletion(event, block, blockIndex, caret, source,
					sourceStart, sourceEnd, baseline, forward ? "forward" : "backward");
				if (image === "image-target-unproved") return image;
				if (image) { pendingNativeTextDeletionRef.current = image; return true; }
			} catch { return "image-source-map-failed"; }
			// The mounted row still spells the pending source of this block, so
			// its own serialization is the stable pre-edit baseline. A row that
			// lags behind pending text has no such proof and uses the canonical
			// caret instead.
			const spelled = sourceSlice.replace(/(?:\r\n|\r|\n)+$/u, "");
			let rowImageProjection: VisualMarkdownSourceIntervalMap | undefined;
			if (spelled !== baseline && block.querySelector("img")) {
				// Serialization spells every image inline, so a reference image's
				// row differs from its source there and only there. A row whose
				// images cannot be proved keeps the canonical caret.
				try {
					const projection = imageProjection([block], source, sourceSlice, baseline);
					if (projection && imageUnitsAccountForRowSpelling(projection, spelled, baseline)) rowImageProjection = projection;
				} catch (error) {
					if (!(error instanceof Error) || !["visual-editor-reference-context-stale", "visual-editor-image-source-map-failed"].includes(error.message)) throw error;
				}
			}
			const synced = spelled === baseline || Boolean(rowImageProjection);
			const atStart = !forward && caretAtWindowedRootStart(block);
			const atEnd = forward && caretAtWindowedRootEnd(block);
			if (synced && !atStart && !atEnd) {
				// The browser performs this in-row deletion itself. The following
				// input event publishes its serialized result against the exact
				// pending source slice, so markup inside the row is deleted by the
				// same DOM→Markdown mapping every accepted edit uses.
				const targets = event.getTargetRanges?.() ?? [];
				const target = targets[0];
				if (
					targets.length !== 1 ||
					!target ||
					!block.contains(target.startContainer) ||
					!block.contains(target.endContainer)
				) return canonicalDeletion();
				pendingNativeTextDeletionRef.current = {
					baseline,
					block,
					blockId,
					blockIndex,
					caret,
					inputType: event.inputType,
					source,
					sourceEnd,
					sourceSlice,
					sourceStart,
					targetCollapsed: target.collapsed,
					...(rowImageProjection ? { imageProjection: rowImageProjection } : {}),
				};
				return true;
			}
			if (!synced || (!atStart && !atEnd)) {
				return canonicalDeletion();
			}
			// The deletion crosses this block's edge. The neighbour is either
			// plain content (joining removes the separator) or one atomic object
			// whose own source lines must disappear with it.
			const targetRange = event.getTargetRanges?.()[0];
			if (!event.cancelable) return "boundary-deletion-not-cancelable";
			if (!targetRange) return canonicalDeletion();
			let adjacent: Node | null = forward
				? block.nextSibling
				: block.previousSibling;
			while (adjacent instanceof Text && /^\s*$/u.test(adjacent.data)) {
				adjacent = forward ? adjacent.nextSibling : adjacent.previousSibling;
			}
			// An unmounted neighbour has no node to take the caret, but the join is
			// plain source; the requested Preview mounts the row at the new caret.
			if (
				adjacent instanceof HTMLElement &&
				adjacent.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
			) adjacent = null;
			event.preventDefault();
			const placeDomCaret = (node: Element, offset: number): void => {
				surface.ownerDocument.defaultView
					?.getSelection()
					?.collapse(node, offset);
			};
			if (
				adjacent instanceof HTMLElement &&
				isWindowedAtomicRemovalRoot(adjacent)
			) {
				const atomicRange = acceptedWindowedBlockRange(
					adjacent,
					rangesRef.current,
					acceptedBlockSerializationsRef.current,
				);
				if (
					!atomicRange ||
					atomicRange.editable !== true ||
					atomicRange.id !==
						(adjacent.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "")
				) return "atomic-range-unavailable";
				const atomicStart = atomicRange.start;
				const atomicEnd = atomicRange.end;
				if (
					adjacent instanceof HTMLHRElement &&
					!isVisualThematicBreakSource(source, atomicRange)
				) return "atomic-thematic-break-invalid";
				if (atomicEnd <= atomicStart) return "atomic-range-empty";
				let start = atomicStart;
				let end = atomicEnd;
				if (start >= 2 && "\r\n" === source.slice(start - 2, start)) {
					start -= 2;
				} else if (start > 0 && "\n" === source[start - 1]) {
					start -= 1;
				} else if ("\r\n" === source.slice(end, end + 2)) {
					end += 2;
				} else if ("\n" === source[end]) {
					end += 1;
				}
				// The canonical caret after removing the object sits at the end
				// of the block before it (backward) or this block's text end
				// (forward). Place the live caret on that very node first, so the
				// Preview requested below records a selection this DOM can prove.
				if (forward) {
					placeDomCaret(block, block.childNodes.length);
				} else {
					let previous: Node | null = adjacent.previousSibling;
					while (previous && !(previous instanceof HTMLElement)) {
						previous = previous.previousSibling;
					}
					if (previous instanceof HTMLElement) {
						placeDomCaret(previous, previous.childNodes.length);
					}
				}
				commit(
					start,
					end,
					Math.max(0, Math.min(source.length, caret - (end - start))),
				);
				return true;
			}
			if (
				adjacent instanceof HTMLElement &&
				isWindowedAtomicRoot(adjacent)
			) {
				// A root with an editable interior is not an object this owner
				// may delete, and a table holds no text of its own, so the join
				// below is not representable either. The press is consumed with
				// no write, as the Full surface's table-edge owner does.
				return true;
			}
			// Joining two content roots removes every whitespace unit between
			// them: paragraph separators are not content.
			// A boundary keystroke can arrive before the Preview this owner just
			// requested re-places the DOM caret. The canonical caret already sits
			// on the joined line, so there is no separator left to remove: delete
			// the one grapheme that caret names instead of refusing the key.
			if (forward) {
				let to = caret;
				while (to < source.length && /\s/u.test(source.charAt(to))) to += 1;
				if (to === source.length || !/[\r\n]/u.test(source.slice(caret, to))) {
					const next = nextGraphemeBoundary(source, caret);
					if (next <= caret) {
						if (event.cancelable) event.preventDefault();
						return true;
					}
					if (!event.cancelable) return "boundary-deletion-not-cancelable";
					event.preventDefault();
					commit(caret, next, caret);
					return true;
				}
				placeDomCaret(block, block.childNodes.length);
				commit(caret, to, caret);
				return true;
			}
			let from = caret;
			while (from > 0 && /\s/u.test(source.charAt(from - 1))) from -= 1;
			if (from === 0 || !/[\r\n]/u.test(source.slice(from, caret))) {
				const previous = previousGraphemeBoundary(source, caret);
				if (previous >= caret) {
					if (event.cancelable) event.preventDefault();
					return true;
				}
				if (!event.cancelable) return "boundary-deletion-not-cancelable";
				event.preventDefault();
				commit(previous, caret, previous);
				return true;
			}
			if (adjacent instanceof HTMLElement) {
				placeDomCaret(adjacent, adjacent.childNodes.length);
			}
			commit(from, caret, from);
			return true;
		};
		const commitPendingNativeTextDeletion = (
			context: PendingNativeTextDeletion,
		): void => {
			const refusal = (stage: string): Error => {
				const proof = context.imageDeletion;
				if (!proof) return new Error("visual-editor-window-pending-selection-stale");
				const nodes: Node[] = [];
				const walker = surface.ownerDocument.createTreeWalker(context.block, NodeFilter.SHOW_ALL);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
				const native = surface.ownerDocument.defaultView?.getSelection();
				const canonical = documentSession.document.getValue();
				return new WindowedPendingImageError(stage, {
					active, externalChange: externalChangeReportedRef.current,
					canonicalMatches: canonical === context.source,
					sourceMatches: sourceRef.current === context.source,
					canonicalLength: canonical.length, sourceLength: context.source.length,
					mountedLength: mountedSourceRef.current.length, sourceRefLength: sourceRef.current.length,
					inputForward: context.inputType === "deleteContentForward" || context.inputType === "deleteWordForward",
					rowIndex: context.blockIndex, rowStart: context.sourceStart, rowEnd: context.sourceEnd,
					caret: context.caret, imageFrom: proof.from, imageTo: proof.to,
					blockConnected: context.block.isConnected, blockInSurface: context.block.parentElement === surface,
					blockIdMatches: context.block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === context.blockId,
					rootMatches: context.block.isEqualNode(proof.expected),
					shallowRootMatches: context.block.cloneNode(false).isEqualNode(proof.expected.cloneNode(false)),
					childCount: context.block.childNodes.length, expectedChildCount: proof.expected.childNodes.length,
					firstChildIsBreak: context.block.firstChild instanceof HTMLBRElement,
					placeholderAttributeCount: context.block.firstChild instanceof HTMLBRElement ? context.block.firstChild.attributes.length : -1,
					nodeCount: nodes.length, retainedCount: proof.retained.length,
					imageCount: nodes.filter((node) => node instanceof HTMLImageElement).length,
					breakCount: nodes.filter((node) => node instanceof HTMLBRElement).length,
					textNodeCount: nodes.filter((node) => node instanceof Text).length,
					textLength: nodes.reduce((sum, node) => sum + (node instanceof Text ? node.length : 0), 0),
					retainedMatches: nodes.length === proof.retained.length && nodes.every((node, index) => node === proof.retained[index]),
					focused: surface.ownerDocument.activeElement === surface, rangeCount: native?.rangeCount ?? 0,
					nativeCollapsed: native?.isCollapsed ?? false,
					anchorType: native?.anchorNode?.nodeType ?? 0, anchorOffset: native?.anchorOffset ?? -1,
					anchorIsBlock: native?.anchorNode === context.block, focusIsBlock: native?.focusNode === context.block,
					anchorInBlock: Boolean(native?.anchorNode && context.block.contains(native.anchorNode)),
				});
			};
			if (
				!active ||
				externalChangeReportedRef.current ||
				documentSession.document.getValue() !== context.source ||
				sourceRef.current !== context.source
			) {
				report(refusal("native-source-epoch"));
				onTransferFailure();
				return;
			}
			if (
				!context.block.isConnected ||
				context.block.parentElement !== surface ||
				(context.block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "") !==
					context.blockId
			) {
				report(refusal("native-row-binding"));
				onTransferFailure();
				return;
			}
			if (context.imageDeletion) {
				const proof = context.imageDeletion;
				const nodes: Node[] = [];
				const walker = surface.ownerDocument.createTreeWalker(context.block, NodeFilter.SHOW_ALL);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
				const native = surface.ownerDocument.defaultView?.getSelection();
				// Chromium's own outcome of deleting an image after a space: the
				// preceding Text's last SPACE becomes NBSP. Only that one Text of the
				// expected row follows it; the comparison below stays complete.
				const preceding = proof.preceding;
				if (preceding && proof.parent.childNodes[proof.index - 1] === preceding.node
					&& nativeTerminalSpaceArtifact(native ?? null, preceding.node, preceding.data)) {
					preceding.expected.data = preceding.node.data;
				}
				const exact = context.block.isEqualNode(proof.expected) && nodes.length === proof.retained.length
					&& nodes.every((node, index) => node === proof.retained[index])
					&& context.block instanceof HTMLParagraphElement && native?.rangeCount === 1 && native.isCollapsed
					&& Boolean(native.anchorNode && native.focusNode
						&& equivalentParagraphBoundaries(context.block, { node: proof.parent, offset: proof.index },
							{ node: native.anchorNode, offset: native.anchorOffset })
						&& equivalentParagraphBoundaries(context.block, { node: proof.parent, offset: proof.index },
							{ node: native.focusNode, offset: native.focusOffset }));
				const placeholder = context.block instanceof HTMLParagraphElement
					&& proof.expected.childNodes.length === 0 && proof.retained.length === 0
					&& !proof.removed.isConnected && !surface.contains(proof.removed)
					&& context.block.cloneNode(false).isEqualNode(proof.expected.cloneNode(false))
					&& context.block.childNodes.length === 1 && context.block.firstChild instanceof HTMLBRElement
					&& context.block.firstChild.attributes.length === 0 && context.block.firstChild.childNodes.length === 0
					&& surface.ownerDocument.activeElement === surface && native?.rangeCount === 1 && native.isCollapsed
					&& native.anchorNode === context.block && native.focusNode === context.block
					&& native.anchorOffset === 0 && native.focusOffset === 0;
				if (!exact && !placeholder) {
					report(refusal("native-image-outcome"));
					onTransferFailure();
					return;
				}
				const value = context.source.slice(0, proof.from) + context.source.slice(proof.to);
				const selection: DocumentSelection = { direction: "none", start: proof.from, end: proof.from };
				try {
					applyDocumentChange({ changes: { from: proof.from, to: proof.to, insert: "" },
						recordHistorySelection: true, selection, value });
				} catch (error) {
					report(error); onTransferFailure(); return;
				}
				sourceRef.current = value;
				mountedSourceRef.current = value;
				acceptedBlockSerializationsRef.current = captureAcceptedWindowedBlockSerializations(
					surface, rangesRef.current, acceptedBlockSerializationsRef.current, ownedPresentationExclusion());
				acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
				readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
				onMarkdownChange();
				requestFormalPreview(value, { historyState: documentSession.document.getHistoryState(),
					restoreFocus: surface.ownerDocument.activeElement === surface, selection },
					{ pinWindowSelection: isMarkdownTerminalWhitespaceSuffix(value.slice(selection.start)) });
				return;
			}
			let edited: string;
			let merged: ReturnType<typeof mergeVisualMarkdownChangeDetails>;
			let relative: ReturnType<typeof visualSelectionSourceRangeForBlocks>;
			let editedLength = -1;
			let mergePhase = "pending-native-serialization";
			try {
				edited = serializeVisualMarkdownBlockFragment([context.block]);
				editedLength = edited.length;
				if (edited === context.baseline) {
					// Some visible row bytes (typically edge whitespace) do not
					// survive serialization, so an in-row deletion of them leaves
					// this block's serialized text unchanged even though the
					// browser moved the caret. No merge can describe that native
					// result, and publishing nothing would leave the pending lease
					// naming a caret the DOM no longer holds. Apply the same
					// one-grapheme canonical deletion at the leased caret instead;
					// the row already spells its result and the pending Preview
					// reconciles it against that source.
					if (context.targetCollapsed) return;
					const forwardDeletion = context.inputType.includes("Forward");
					const to = forwardDeletion
						? nextGraphemeBoundary(context.source, context.caret)
						: context.caret;
					const from = forwardDeletion
						? context.caret
						: previousGraphemeBoundary(context.source, context.caret);
					if (to <= from) return;
					const value =
						context.source.slice(0, from) + context.source.slice(to);
					const caret = forwardDeletion ? context.caret : from;
					const selection: DocumentSelection = {
						direction: "none",
						end: caret,
						start: caret,
					};
					try {
						applyDocumentChange({
							changes: { from, insert: "", to },
							recordHistorySelection: true,
							selection,
							value,
						});
					} catch (error) {
						report(error);
						onTransferFailure();
						return;
					}
					sourceRef.current = value;
					mountedSourceRef.current = value;
					// The browser already removed this byte from the row, so the
					// canonical deletion above makes the live DOM and the published
					// source agree again. Re-capture this owner's accepted registry
					// from that DOM before the next keystroke proves it.
					acceptedBlockSerializationsRef.current =
						captureAcceptedWindowedBlockSerializations(
							surface,
							rangesRef.current,
							acceptedBlockSerializationsRef.current,
							ownedPresentationExclusion(),
						);
					acceptedWindowChildNodesRef.current = Array.from(
						surface.childNodes,
					);
					readOnlySnapshotRef.current =
						captureVisualMarkdownReadOnlySnapshot(surface);
					onMarkdownChange();
					requestFormalPreview(
						value,
						{
							historyState: documentSession.document.getHistoryState(),
							restoreFocus:
								surface.ownerDocument.activeElement === surface,
							selection,
						},
						{
							pinWindowSelection:
								caret === value.length && value.length > 0,
						},
					);
					return;
				}
				mergePhase = "pending-native-merge";
				merged = mergeVisualMarkdownChangeDetails(
					context.sourceSlice,
					context.baseline,
					edited,
					context.imageProjection,
				);
				mergePhase = "pending-native-selection";
				relative = visualSelectionSourceRangeForBlocks(
					[context.block],
					merged.value,
					edited,
					context.imageProjection
						? imageProjection([context.block], context.source.slice(0, context.sourceStart) + merged.value + context.source.slice(context.sourceEnd), merged.value, edited)
						: undefined,
				);
			} catch (error) {
				const capturedMerge = captureMergeFailure(error, mergePhase, {
					sourceStart: context.sourceStart, sourceEnd: context.sourceEnd,
					baselineLength: context.baseline.length, editedLength, blockCount: 1,
					structural: false, bodyInput: false, deletion: true
				});
				report(error, capturedMerge);
				onTransferFailure();
				return;
			}
			// The row serializer trims trailing whitespace that the live text
			// node can still hold (deleting "1" from "Filler 1" leaves the DOM
			// text "Filler "). The marker-based lookup then names one byte past
			// the merged row for that edge, a byte the canonical value does not
			// contain. The caret is the merged row's end; interior offsets keep
			// their exact mapped position.
			const clampToMergedRow = (offset: number): number =>
				Math.max(0, Math.min(merged.value.length, offset));
			const relativeStart = clampToMergedRow(relative.start);
			const relativeEnd = clampToMergedRow(relative.end);
			const selection: DocumentSelection = {
				direction: "none",
				end: context.sourceStart + relativeEnd,
				start: context.sourceStart + relativeStart,
			};
			const value =
				context.source.slice(0, context.sourceStart) +
				merged.value +
				context.source.slice(context.sourceEnd);
			try {
				applyDocumentChange({
					changes: {
						from: context.sourceStart,
						insert: merged.value,
						to: context.sourceEnd,
					},
					recordHistorySelection: true,
					selection,
					value,
				});
			} catch (error) {
				report(error);
				onTransferFailure();
				return;
			}
			sourceRef.current = value;
			mountedSourceRef.current = value;
			// The browser already mutated this row. Re-capture the accepted
			// registry from the DOM this owner now publishes, so the next
			// keystroke under the still-pending Preview proves these very
			// nodes instead of meeting the pre-mutation certificate.
			acceptedBlockSerializationsRef.current =
				captureAcceptedWindowedBlockSerializations(
					surface,
					rangesRef.current,
					acceptedBlockSerializationsRef.current,
					ownedPresentationExclusion(),
				);
			acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
			readOnlySnapshotRef.current =
				captureVisualMarkdownReadOnlySnapshot(surface);
			onMarkdownChange();
			requestFormalPreview(
				value,
				{
					historyState: documentSession.document.getHistoryState(),
					restoreFocus: surface.ownerDocument.activeElement === surface,
					selection,
				},
				{
					pinWindowSelection:
						selection.start === value.length && value.length > 0,
				},
			);
		};
		const finishPendingCompositionDom = (restoreSelection: boolean): void => {
			const composition = pendingComposition;
			pendingComposition = null;
			composing = false;
			if (!composition) return;
			const sameWindow = composition.childNodes.length === surface.childNodes.length &&
				composition.childNodes.every((node, index) => surface.childNodes[index] === node);
			if (sameWindow) {
				const currentBlocks = currentRegionBlocks(surface, composition.region);
				if (currentBlocks.length !== composition.region.blocks.length ||
					currentBlocks.some((block, index) => block !== composition.region.blocks[index]) ||
					composition.region.blockSnapshots.some(({ node, attributes }) =>
						node.attributes.length !== attributes.length || attributes.some(({ name, value }) => node.getAttribute(name) !== value))) {
					throw new WindowedDomStaleError("composition-block-identity");
				}
				assertVisualMarkdownReadOnlySnapshot(surface, composition.region.readOnlySnapshot);
				// Discard only this owned IME draft. Canonical insertion uses the
				// revisioned range below, never the old rendered frame's text.
				restoreWindowRegion(surface, composition.region, restoreSelection);
				const transfer = pendingRef.current;
				if (transfer?.signature === composition.lease.signature) {
					pendingRef.current = { ...transfer, visualSelection: captureVisualSelection(surface) };
				}
			}
			// A late accepted Preview may already have replaced the draft's nodes.
			// Validate its own certificate instead of restoring detached old nodes.
			assertPendingInputDom();
		};
		const invalidatePendingInputSelection = (): void => {
			if (!pendingRef.current && !pendingComposition) return;
			const invalidatedComposition = pendingComposition;
			if (pendingComposition) {
				cancelledPendingComposition = true;
				try { finishPendingCompositionDom(false); } catch (error) { report(error); onTransferFailure(); }
				finally { invalidatedComposition?.compositionLease?.release(); }
			}
			const transfer = pendingRef.current;
			if (transfer) {
				pendingRef.current = { ...transfer, visualSelection: null };
				const revision = documentSession.document.getRevision?.();
				pendingNavigationGesture = Number.isSafeInteger(revision)
					? { markdown: transfer.markdown, revision: revision as number, signature: transfer.signature }
					: null;
			} else pendingNavigationGesture = null;
			const lease = pendingHistorySelectionRef.current;
			if (lease) pendingHistorySelectionRef.current = { ...lease, restoreFocus: false };
		};
		const handlePendingPointerDown = (): void => {
			emptyCodeGapRef.current = null;
			invalidatePendingInputSelection();
		};
		/**
		 * A real navigation gesture moves the native caret without a
		 * cancelable beforeinput, and the keydown invalidates the pending
		 * lease so an unproved move cannot be attributed. The producer event
		 * that follows is the move itself: when that caret still sits inside
		 * one accepted editable row or CODE body, or this owner's authenticated
		 * operation PRE, project it through that exact source slice and republish the lease's
		 * canonical caret and the transfer's visual witness. Every precondition
		 * fails closed - a foreign, unfocused, stale, structural or unprovable caret
		 * leaves the invalidated lease exactly as it was.
		 */
		const reauthenticatePendingNavigationSelection = (): void => {
			const transfer = pendingRef.current;
			const lease = pendingHistorySelectionRef.current;
			if (!transfer || !lease || !active || externalChangeReportedRef.current) return;
			if (composing || pendingComposition) return;
			if (transfer.signature !== lease.signature || transfer.markdown !== lease.markdown) return;
			// An owner-placed selection is not a user gesture; only a drifted
			// one has already been reclassified by the caller.
			if (ownerPlacedSelectionRef.current) {
				const current = captureVisualSelection(surface);
				if (!current || visualSelectionEqual(ownerPlacedSelectionRef.current, current)) return;
				ownerPlacedSelectionRef.current = null;
			}
			if (
				!surface.isConnected ||
				surface.ownerDocument.activeElement !== surface ||
				"true" !== surface.getAttribute("contenteditable")
			) return;
			const source = lease.markdown;
			if (
				documentSession.document.getValue() !== source ||
				sourceRef.current !== source ||
				!sameDocumentSelection(documentSession.document.getSelection(), lease.selection) ||
				!sameDocumentHistoryState(documentSession.document.getHistoryState(), lease.historyState)
			) return;
			const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
			if (
				!nativeSelection?.rangeCount ||
				!nativeSelection.anchorNode ||
				!nativeSelection.focusNode
			) return;
			// The normalised Range endpoints are the ones the browser reports
			// and the ones the deletion target will repeat; the raw
			// anchor/focus order only states the selection's direction.
			const visualSelection = captureVisualSelection(surface);
			if (!visualSelection) return;
			const inputBlock = captureVisualCodeInputSnapshot(
				selectedVisualCodeBlock(surface),
			);
			if (!inputBlock) {
				const gesture = pendingNavigationGesture;
				if (!gesture || gesture.signature !== transfer.signature || gesture.markdown !== source
					|| gesture.revision !== documentSession.document.getRevision?.()) return;
				const block = rootBlock(surface, visualSelection.anchorNode);
				if (!block || block !== rootBlock(surface, visualSelection.focusNode)) return;
				const row = acceptedWindowedBlockRange(block, rangesRef.current, acceptedBlockSerializationsRef.current);
				const record = acceptedBlockSerializationsRef.current.get(block);
				if (!row?.editable || !record || row.start < 0 || row.end <= row.start || row.end > source.length) return;
				let selection: DocumentSelection;
				try {
					const readOnly = assertPendingInputDom();
					if (selectionIntersectsReadOnlyRegion(nativeSelection, readOnly)) return;
					if (normalizedWindowedBlockSerialization(block) !== record.serialization) return;
					const baseline = serializeVisualMarkdownBlockFragment([block]);
					const relative = visualSelectionSourceRangeForBlocks([block], source.slice(row.start, row.end), baseline);
					if (relative.start < 0 || relative.end > row.end - row.start) return;
					selection = { direction: relative.direction, start: row.start + relative.start, end: row.start + relative.end };
				} catch {
					return;
				}
				pendingHistorySelectionRef.current = { ...lease, restoreFocus: true, selection };
				pendingRef.current = { ...transfer, visualSelection };
				pendingNavigationGesture = null;
				applyDocumentChange({ selection, value: source });
				return;
			}
			if (!inputBlock?.pre.isConnected) return;
			if (inputBlock.placeholder) return;
			if (
				!(inputBlock.code === visualSelection.anchorNode ||
					inputBlock.code.contains(visualSelection.anchorNode)) ||
				!(inputBlock.code === visualSelection.focusNode ||
					inputBlock.code.contains(visualSelection.focusNode))
			) return;
			const operationGap = lease.emptyCodeGap?.presentation === inputBlock.pre
				? lease.emptyCodeGap
				: null;
			const operationRange = operationGap?.codeBodySourceRange ?? null;
			if (
				operationGap && (
					emptyCodeGapRef.current !== operationGap ||
					!emptyCodeGapPresentationMatchesDocument(operationGap, documentSession.document) ||
					!operationRange ||
					!Number.isSafeInteger(operationRange.start) ||
					!Number.isSafeInteger(operationRange.end)
				)
			) return;
			const row = operationGap
				? null
				: acceptedWindowedBlockRange(
					inputBlock.pre,
					rangesRef.current,
					acceptedBlockSerializationsRef.current,
				);
			const blockStart = operationRange?.start ?? row?.start;
			const blockEnd = operationRange?.end ?? row?.end;
			if (
				(!operationGap && !row?.editable) ||
				blockStart === undefined ||
				blockEnd === undefined ||
				blockStart < 0 ||
				blockEnd <= blockStart ||
				blockEnd > source.length
			) return;
			const blockSlice = source.slice(blockStart, blockEnd);
			let projection: VisualCodeBodySelectionProjection;
			try {
				projection = projectVisualCodeBodySelection(
					inputBlock.code,
					blockSlice,
					blockSlice,
					0,
					{
						end: {
							node: visualSelection.focusNode,
							offset: visualSelection.focusOffset,
						},
						start: {
							node: visualSelection.anchorNode,
							offset: visualSelection.anchorOffset,
						},
					},
				);
			} catch {
				return;
			}
			const interval = projection.sourceInterval;
			const start = projection.sourceSelection.start;
			const end = projection.sourceSelection.end;
			if (start < interval.bodyStart || end > interval.bodyEnd) return;
			const collapsedSelection =
				visualSelection.anchorNode === visualSelection.focusNode &&
				visualSelection.anchorOffset === visualSelection.focusOffset;
			if (collapsedSelection !== (start === end)) return;
			const direction: DocumentSelection["direction"] = collapsedSelection
				? "none"
				: visualSelection.backward
					? "backward"
					: "forward";
			const selection: DocumentSelection = {
				direction,
				end: blockStart + end,
				start: blockStart + start,
			};
			if (
				selection.start === lease.selection.start &&
				selection.end === lease.selection.end &&
				selection.direction === lease.selection.direction &&
				transfer.visualSelection &&
				visualSelectionEqual(transfer.visualSelection, visualSelection)
			) {
				return;
			}
			const renewedOperationGap = operationGap
				? { ...operationGap, selection }
				: null;
			if (renewedOperationGap) {
				emptyCodeGapRef.current = renewedOperationGap;
				retainGapPresentation(renewedOperationGap);
				rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, renewedOperationGap);
			}
			pendingHistorySelectionRef.current = {
				...lease,
				...(renewedOperationGap ? { emptyCodeGap: renewedOperationGap } : {}),
				restoreFocus: true,
				selection,
			};
			pendingRef.current = { ...transfer, visualSelection };
			// Selection-only sync: the published source is unchanged, so this
			// writes no history entry and cannot move the native caret.
			applyDocumentChange({ selection, value: source });
		};
		const reissueGapInputSelection = (): void => {
			if (emptyCodeGapRef.current || !active || externalChangeReportedRef.current) return;
			const physical = ownedGapPresentationRef.current;
			const native = surface.ownerDocument.defaultView?.getSelection();
			if (!physical || !emptyCodeGapPresentationMatchesDocument(physical, documentSession.document)
				|| physical.presentation.parentNode !== surface || physical.presentation.childNodes.length !== 1
				|| !(physical.presentation.firstChild instanceof HTMLBRElement)
				|| surface.ownerDocument.activeElement !== surface || !native?.isCollapsed
				|| !emptyCodeGapBoundary(physical, native.anchorNode, native.anchorOffset)
				|| !emptyCodeGapBoundary(physical, native.focusNode, native.focusOffset)) return;
			assertPendingInputDom();
			applyDocumentChange({ value: physical.markdown, selection: physical.selection });
			const gap = { ...physical, selection: { ...physical.selection }, historyState: documentSession.document.getHistoryState() };
			emptyCodeGapRef.current = gap;
			retainGapPresentation(gap);
			rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, gap);
			const transfer = pendingRef.current; const previous = pendingHistorySelectionRef.current;
			if (transfer && previous && transfer.markdown === gap.markdown && previous.markdown === gap.markdown && transfer.signature === previous.signature) {
				pendingHistorySelectionRef.current = { ...previous, emptyCodeGap: gap, selection: gap.selection, historyState: gap.historyState, restoreFocus: true };
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
					region.imageProjection,
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
					region.imageProjection,
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
		/**
		 * A clipboard or drop replacement at a certified empty-code gap has no
		 * block for the region capture: its native caret sits at the following
		 * row's boundary while canonical selection still names the blank source
		 * gap. Consume that authenticated certificate exactly like the typed
		 * path, and fall back to the ordinary region mapper everywhere else.
		 */
		const replaceSelectionOrCertifiedGap = (value: string): boolean => {
			reissueGapInputSelection();
			// Only an idle owner can consume the certificate: with a transfer
			// outstanding the canonical write belongs to the pending lease path,
			// so this gesture keeps its existing refusal instead of claiming the gap.
			const gap = pendingRef.current || pendingPropRef.current
				? null
				: acceptedEmptyCodeGap();
			if (!gap) return replaceSelection(value);
			try {
				applyEmptyCodeGapText(gap, value);
				return true;
			} catch (error) {
				return report(error);
			}
		};
		const runHistory = (redo: boolean): void => {
			if (!active || externalChangeReportedRef.current) {
				return;
			}
			const restoreFocus = surface.ownerDocument.activeElement === surface;
			const priorPhysical = ownedGapPresentationRef.current;
			const priorPhysicalValid = Boolean(priorPhysical && priorPhysical.presentation.parentNode === surface
				&& emptyCodeGapPresentationMatchesDocument(priorPhysical, documentSession.document));
			selfWriteRef.current = true;
			let changed: boolean;
			try {
				// A step replays canonical replacements onto the rows still
				// mounted, exactly like an owner write: they move with it.
				changed = redo
					? documentSession.document.redo(transportMountedRows)
					: documentSession.document.undo(transportMountedRows);
			} finally {
				selfWriteRef.current = false;
			}
			if (!changed) return;
			const markdown = documentSession.document.getValue();
			const historySelection = documentSession.document.getSelection();
			const knownGap = emptyCodeGapHistoryRef.current.get(documentSession.document.getHistoryState().undoDepth);
			const gapRevision = documentSession.document.getRevision?.();
			const historyState = documentSession.document.getHistoryState();
			const historyGap = knownGap && knownGap.markdown === markdown && Number.isSafeInteger(gapRevision)
				&& sameDocumentSelection(knownGap.selection, historySelection)
				? { ...knownGap, revision: gapRevision as number, historyState, accepted: false }
				: null;
			const restoredGap = historyGap
				? restoreHistoryGapPresentation(historyGap, markdown, gapRevision as number, historyState)
				: null;
			if (restoredGap && priorPhysical && priorPhysicalValid
				&& restoredGap.presentation === priorPhysical.presentation
				&& restoredGap.presentation.parentNode === surface
				&& restoredGap.presentation.innerHTML === priorPhysical.presentationHtml
				&& restoredGap.presentationHtml !== priorPhysical.presentationHtml) {
				restoredGap.presentation.innerHTML = restoredGap.presentationHtml;
			}
			emptyCodeGapRef.current = restoredGap;
			if (restoredGap && !pendingComposition && restoredGap.presentation.isConnected && restoredGap.presentation.parentNode === surface) {
				retainGapPresentation(restoredGap);
				rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, restoredGap);
			}
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
			// Every focused history point must be mounted by the same accepted
			// Preview that restores it, including a collapsed non-EOF HR boundary.
			const ordinaryHistoryWindowPin =
				restoreFocus && !restoresThematicBreak
					&& (selection.start !== markdown.length || selection.end !== markdown.length)
					? { pinSourceSelection: selection, pinWindowSelection: true }
					: {};
			sourceRef.current = markdown;
			onMarkdownChange();
			requestFormalPreview(
				markdown,
				{
				historyState,
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
		/**
		 * The structural candidate state. `none` means the cheap eligibility
		 * test did not see a surface-anchored caret beside a direct-child
		 * break, so ordinary owners keep the gesture. `certified` carries the
		 * fully authenticated gap. `rejected` means the caret IS that
		 * candidate but the certificate failed; callers must refuse the
		 * gesture instead of falling through to generic mapping, because the
		 * generic normalizer would skip the break and edit a neighbour.
		 */
		type StructuralCandidate =
			| Readonly<{ kind: "none" }>
			| Readonly<{ kind: "rejected" }>
			| Readonly<{
				canonical: DocumentSelection;
				gap: NonNullable<ReturnType<typeof visualStructuralBoundaryCapture>>;
				kind: "certified";
				source: string;
			}>;
		const structuralCandidate = (event?: InputEvent): StructuralCandidate => {
			const native = surface.ownerDocument.defaultView?.getSelection();
			const nativeRange = native?.rangeCount === 1
				? native.getRangeAt(0)
				: null;
			if (
				!native?.isCollapsed
				|| !nativeRange?.collapsed
				|| native.anchorNode !== surface
				|| native.focusNode !== surface
				|| native.anchorOffset !== native.focusOffset
			) {
				return { kind: "none" };
			}
			const offset = native.anchorOffset;
			if (
				!(surface.childNodes[offset] instanceof HTMLHRElement)
				&& !(surface.childNodes[offset - 1] instanceof HTMLHRElement)
			) {
				return { kind: "none" };
			}
			try {
				// The whole event target must still name that one collapsed point:
				// multiple ranges or any non-collapsed endpoint belong to another
				// owner (replacement included) and are not this boundary.
				const targets = event?.getTargetRanges?.() ?? [];
				if (
					targets.length > 1
					|| (targets[0]
						&& (!targets[0].collapsed
							|| targets[0].startContainer !== native.anchorNode
							|| targets[0].startOffset !== native.anchorOffset
							|| targets[0].endContainer !== native.anchorNode
							|| targets[0].endOffset !== native.anchorOffset))
				) {
					return { kind: "rejected" };
				}
				const source = assertReadySourceAndDom();
				const canonical = documentSession.document.getSelection();
				if (
					"none" !== canonical.direction
					|| canonical.start !== canonical.end
				) {
					return { kind: "rejected" };
				}
				const gap = visualStructuralBoundaryCapture(
					surface,
					source,
					windowedStructuralBlocks(surface, rangesRef.current),
					canonical.start,
				);
				if (
					!gap
					|| gap.selection.start !== canonical.start
					|| gap.selection.end !== canonical.end
					|| gap.selection.start !== gap.selection.end
				) {
					return { kind: "rejected" };
				}
				return { canonical, gap, kind: "certified", source };
			} catch {
				return { kind: "rejected" };
			}
		};
		/**
		 * A collapsed root caret at a surface edge whose nearest materialized
		 * node is an atomic block has no editable row to normalize into. The
		 * canonical boundary is real: the caret stands before/after that
		 * object's own source range, so the caller edits that range directly
		 * instead of asking the block normalizer to guess a neighbouring row.
		 */
		const rootAtomicEdgeTarget = (
			side: "end" | "start",
		): HTMLElement | null => {
			const native = surface.ownerDocument.defaultView?.getSelection();
			if (
				!native?.isCollapsed ||
				native.rangeCount !== 1 ||
				native.anchorNode !== surface ||
				native.focusNode !== surface ||
				native.anchorOffset !== native.focusOffset
			) {
				return null;
			}
			const backward = "end" === side;
			if (
				native.anchorOffset !==
				(backward ? surface.childNodes.length : 0)
			) {
				return null;
			}
			let node: Node | null = backward ? surface.lastChild : surface.firstChild;
			while (node instanceof Text && /^\s*$/u.test(node.data)) {
				node = backward ? node.previousSibling : node.nextSibling;
			}
			if (
				!(node instanceof HTMLElement) ||
				node.hasAttribute(WINDOW_SPACER_ATTRIBUTE) ||
				!isWindowedAtomicRoot(node)
			) {
				return null;
			}
			return node;
		};
		/**
		 * The canonical source range of an atomic object addressed by a root
		 * caret, proved to be the document's own first or last block. A root
		 * caret is not inside any row, so the object's accepted snapshot and
		 * its edit-map row are the only identities that can certify the edge.
		 */
		const rootAtomicCanonicalSource = (
			atomic: HTMLElement,
			side: "end" | "start",
		): Readonly<{
			source: string;
			start: number;
			end: number;
			index: number;
		}> => {
			const source = assertReadySourceAndDom();
			const readOnlySnapshot = readOnlySnapshotRef.current;
			if (!readOnlySnapshot) {
				throw new Error("visual-editor-window-read-only-snapshot-missing");
			}
			assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
			const atomicRange = acceptedWindowedBlockRange(
				atomic,
				rangesRef.current,
				acceptedBlockSerializationsRef.current,
			);
			const editMap = editMapRef.current;
			if (!atomicRange || atomicRange.editable !== true) {
				throw new Error("visual-editor-selection-map-failed");
			}
			const atomicBlock = editMap.blocks[atomicRange.index];
			if (
				!atomicBlock ||
				atomicBlock.id !== atomicRange.id ||
				atomicBlock.id !== (atomic.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "")
			) {
				throw new Error("visual-editor-selection-map-failed");
			}
			const atDocumentEdge =
				"end" === side
					? atomicRange.index === editMap.blocks.length - 1 &&
						/^\s*$/u.test(source.slice(atomicRange.end))
					: atomicRange.index === 0 &&
						/^\s*$/u.test(source.slice(0, atomicRange.start));
			if (!atDocumentEdge) {
				throw new Error("visual-editor-selection-map-failed");
			}
			const atomicSource = createVisualMarkdownSourceRangeFromPreviewEditMap(
				source,
				editMap,
				{ end: atomicRange.index + 1, start: atomicRange.index },
			);
			if (
				atomicSource.start !== atomicRange.start ||
				atomicSource.end !== atomicRange.end ||
				(atomic instanceof HTMLHRElement &&
					!isVisualThematicBreakSource(source, atomicSource))
			) {
				throw new Error("visual-editor-selection-map-failed");
			}
			return {
				end: atomicSource.end,
				index: atomicRange.index,
				source,
				start: atomicSource.start,
			};
		};
		/**
		 * Mount the certified paragraph that stands for the document end.
		 *
		 * Chromium cannot hold a caret at a contenteditable host's own end
		 * boundary when the last child is an object the caret cannot enter, so
		 * that position has to be a real paragraph this owner owns. It is
		 * appended after the last child, i.e. at the article's reading-order
		 * end, carries no source of its own, and is retired as soon as the
		 * caret leaves it or the source changes. Every document-end gesture
		 * then addresses `before` - the document's own last row - through the
		 * certified gap instead of a host boundary no mapper can resolve.
		 * The mount ritual itself lives in `mountDocumentEndSink`, so this
		 * form only names the canonical position it stands for.
		 */
		const mountDocumentEndGap = (
			markdown: string,
			revision: number,
			before: Readonly<{ end: number; source: string; start: number }>,
		): WindowedEmptyCodeGap => {
			const selection: DocumentSelection = {
				direction: "none",
				end: markdown.length,
				start: markdown.length,
			};
			// The canonical selection moves onto the retained address only after
			// the sink exists, so a retain that throws cannot leave the caret
			// pointing at a paragraph the owner never mounted.
			return mountDocumentEndSink(markdown, revision, before, selection, () =>
				applyDocumentChange({ selection, value: markdown }));
		};
		/**
		 * The ledger row that certifies a collapsed caret on the surface itself
		 * as the canonical document end.
		 *
		 * Chromium puts `Control+End` on the editing host at `childNodes.length`
		 * when the node it would have to enter is not editable, and a window
		 * that advances under that caret leaves it there after the terminal row
		 * mounts. That caret stands after every mounted node, and the accepted
		 * window represents every row it does not mount with a spacer, so the
		 * position is the document end in both shapes: while the window still
		 * hides the terminal row (a trailing spacer is the last child) and after
		 * it has settled with that row mounted (nothing trails it). The trailing
		 * child's kind is therefore not the discriminator - the ledger's own
		 * last row is.
		 *
		 * That row must be editable, end exactly at the document end, and be a
		 * row a paragraph may follow. Only a caret satisfying that proof is
		 * owned by the document-end commands below; every other root caret
		 * keeps the existing rejection.
		 */
		const documentEndRootRow = (): Readonly<{
			markdown: string;
			range: EffectiveBlockRange;
			revision: number;
		}> | null => {
			if (
				!active ||
				externalChangeReportedRef.current ||
				pendingRef.current ||
				pendingPropRef.current ||
				emptyCodeGapRef.current ||
				ownedGapPresentationRef.current ||
				documentEndSinkRef.current
			) return null;
			const native = surface.ownerDocument.defaultView?.getSelection();
			if (
				!native?.isCollapsed ||
				native.rangeCount !== 1 ||
				native.anchorNode !== surface ||
				native.focusNode !== surface ||
				native.anchorOffset !== native.focusOffset ||
				native.anchorOffset !== surface.childNodes.length
			) return null;
			const markdown = assertReadySourceAndDom();
			const revision = documentSession.document.getRevision?.();
			if (
				!Number.isSafeInteger(revision) ||
				markdown !== mountedSourceRef.current
			) return null;
			const blocks = editMapRef.current.blocks;
			const lastBlock = blocks[blocks.length - 1];
			const lastRange = lastBlock
				? rangesRef.current.get(lastBlock.id)
				: null;
			// The last row must be a real editable extent of this source, and
			// that extent must reach the document end: a row that stops short
			// leaves bytes no row owns, so the terminal line is not this
			// caret's position.
			if (!lastRange?.editable || lastRange.end !== markdown.length) return null;
			// The terminal line is the last row's own when the browser cannot
			// enter that row (an object root, whose caret the document-end sink
			// certifies) and when the document still ends inside a fenced code
			// block (whose own row appends one body line). A paragraph after the
			// last block is neither, so this proof must not claim those carets.
			const terminal = Array.from(surface.children).find(
				(child): child is HTMLElement =>
					child instanceof HTMLElement &&
					child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === lastRange.id,
			);
			if (
				(terminal !== undefined && isWindowedAtomicRoot(terminal)) ||
				endsInsideOpenCodeFence(markdown)
			) return null;
			return { markdown, range: lastRange, revision: revision as number };
		};
		const documentEndRootGap = (): WindowedEmptyCodeGap | null => {
			const proof = documentEndRootRow();
			if (!proof) return null;
			return mountDocumentEndGap(proof.markdown, proof.revision, {
				end: proof.range.end,
				source: proof.markdown.slice(proof.range.start, proof.range.end),
				start: proof.range.start,
			});
		};
		/**
		 * The canonical deletion a Backspace at that same certified document end
		 * owns.
		 *
		 * A mounted terminal row is its own deletion owner: the boundary
		 * normalizer places the caret inside it and the browser's own character
		 * deletion maps that visible character through the row's serialization.
		 * Only a terminal row with no mounted element leaves no row to delete
		 * from and no DOM character to read, so the canonical end is the sole
		 * authority: one Backspace removes exactly the grapheme that precedes
		 * the terminal row's own text - never one of the line endings after it -
		 * and leaves the canonical caret on that text end. A source tail that
		 * renders nothing of its own (a delimiter, a link destination) has no
		 * grapheme to remove this way, so it is refused and keeps the existing
		 * root-end rejection instead of rewriting the block's Markdown.
		 */
		const documentEndRootDeletion = (): WindowedDocumentEndDeletion | null => {
			const proof = documentEndRootRow();
			if (!proof) return null;
			const { markdown, range } = proof;
			if (
				Array.from(surface.children).some(
					(child) =>
						child instanceof HTMLElement &&
						child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === range.id,
				)
			) return null;
			const to = windowedBlockTextEnd(markdown, range);
			const from = previousGraphemeBoundary(markdown, to);
			if (from >= to) return null;
			// The block's real source, line endings included: the parser has to
			// see the line ending a terminal marker precedes before it can name
			// the unit that marker belongs to. Only the offsets are clamped.
			if (!coversRenderedMarkdownUnit(
				markdown.slice(range.start, range.end),
				from - range.start,
				to - range.start,
			)) return null;
			const selection: DocumentSelection = {
				direction: "none",
				end: from,
				start: from,
			};
			return {
				from,
				selection,
				to,
				value: markdown.slice(0, from) + markdown.slice(to),
			};
		};
		const handleBeforeInput = (event: InputEvent) => {
			visualInputBlock = null;
			textDeletion = null;
			if (!event.cancelable &&
				(event.inputType === "historyUndo" || event.inputType === "historyRedo")) {
				report(new Error("visual-editor-window-beforeinput-not-cancelable"));
				onTransferFailure();
				return;
			}
			if (rejectedComposition || rejectedBeforeInput) {
				if (event.cancelable) event.preventDefault();
				return;
			}
			if (cancelledPendingComposition && (event.isComposing || event.inputType.includes("Composition"))) {
				if (event.cancelable) event.preventDefault();
				else { report(new Error("visual-editor-window-beforeinput-not-cancelable")); onTransferFailure(); }
				return;
			}
			if (completedPendingComposition && event.inputType === "insertFromComposition" &&
				event.data === completedPendingComposition.data && sourceRef.current === completedPendingComposition.markdown) {
				completedPendingComposition = null;
				if (event.cancelable) event.preventDefault();
				else { report(new Error("visual-editor-window-beforeinput-not-cancelable")); onTransferFailure(); }
				return;
			}
			completedPendingComposition = null;
			if (pendingComposition && (event.inputType === "historyUndo" || event.inputType === "historyRedo")) {
				event.preventDefault();
				cancelledPendingComposition = true;
				try {
					finishPendingCompositionDom(surface.ownerDocument.activeElement === surface);
					runHistory(event.inputType === "historyRedo");
				} catch (error) { report(error); onTransferFailure(); }
				finally { releaseCompositionSurface(); }
				return;
			}
			const wholeDocumentDeletionInput =
				WINDOWED_WHOLE_DOCUMENT_DELETION_TYPES.has(event.inputType);
			if (!composing && !event.isComposing) codeBodyInput = null;
			// Native menu/gesture history has no keydown. Like keyboard history,
			// it supersedes the pending formal Preview through the canonical owner.
			if (
				!composing && !event.isComposing &&
				("historyUndo" === event.inputType || "historyRedo" === event.inputType)
			) {
				event.preventDefault();
				runHistory("historyRedo" === event.inputType);
				return;
			}
			if (!active || externalChangeReportedRef.current) {
				if (event.cancelable) event.preventDefault();
				return;
			}
			if (pendingComposition) {
				// Native IME may own a non-cancelable draft in the old mounted
				// region. Only compositionend publishes its final data canonically.
				if (event.cancelable) event.preventDefault();
				return;
			}
			if (!composing && !event.isComposing) {
				try { reissueGapInputSelection(); } catch (error) { if (event.cancelable) event.preventDefault(); report(error); return; }
			}
			if (pendingRef.current || pendingPropRef.current) {
				if (pendingNavigationGesture) {
					const gesture = pendingNavigationGesture;
					try {
						reauthenticatePendingNavigationSelection();
					} catch (error) {
						if (event.cancelable) event.preventDefault();
						report(error);
						return;
					} finally {
						if (pendingNavigationGesture === gesture) pendingNavigationGesture = null;
					}
				}
				const sourceBefore = documentSession.document.getValue();
				let pendingCodeBody: VisualCodeInputSnapshot | null = null;
				try {
					pendingCodeBody = captureVisualCodeInputSnapshot(
						selectedVisualCodeBlock(surface),
					);
				} catch {
					pendingCodeBody = null;
				}
				if (
					WINDOWED_CODE_BODY_DELETION_TYPES.has(event.inputType) &&
					pendingCodeBody
				) {
					if (event.cancelable) event.preventDefault();
					try {
						if (!event.cancelable) throw new Error("visual-editor-window-beforeinput-not-cancelable");
						// The pending lease owns proved in-body deletions itself;
						// anything it cannot prove keeps the explicit rejection.
						// A proved deletion completes the event here: the insert
						// pipeline below would re-derive a lease against a
						// caret this event just replaced.
						const historyLease = pendingHistorySelectionRef.current;
						if (
							!historyLease ||
							historyLease.markdown !== sourceBefore ||
							!applyPendingCanonicalCodeBodyDeletion(historyLease, event)
						) {
							throw new WindowedPendingInputRefusal("pending-code-deletion-rejected", event);
						}
					} catch (error) {
						report(error);
						if (!event.cancelable || documentSession.document.getValue() !== sourceBefore) onTransferFailure();
					}
					return;
				}
				if (WINDOWED_PENDING_DELETION_TYPES.has(event.inputType)) {
					try {
						const result = pendingDeletionApplies(event);
						if (result !== true) {
							throw new WindowedPendingInputRefusal(result, event);
						}
					} catch (error) {
						// Only a deletion the lease proved may run natively. The input
						// that follows stays suppressed while this transfer is live, so
						// a rejected deletion fails closed instead of leaving a mutated
						// row that nothing records.
						if (event.cancelable) event.preventDefault();
						report(error);
						if (!event.cancelable || documentSession.document.getValue() !== sourceBefore) onTransferFailure();
					}
					return;
				}
				if (event.cancelable) event.preventDefault();
				try {
					if (!event.cancelable) throw new Error("visual-editor-window-beforeinput-not-cancelable");
					const lineBreakInput = event.inputType === "insertLineBreak"
						|| event.inputType === "insertParagraph";
					if (WINDOWED_PENDING_TEXT_INPUT_TYPES[event.inputType] !== true ||
						(!lineBreakInput && event.data === null)) {
						throw new WindowedPendingInputRefusal("unsupported-pending-input", event);
					}
					const lease = pendingInputLease(event);
					const text = lineBreakInput ? "\n" : event.data ?? "";
					if (!applyStructuralPendingCanonicalText(lease, text)) {
						applyPendingCanonicalText(lease, text, false, true);
					}
				} catch (error) {
					report(error);
					if (!event.cancelable || documentSession.document.getValue() !== sourceBefore) onTransferFailure();
				}
				return;
			}
			if (composing || event.isComposing) return;
			const emptyCodeGap = acceptedEmptyCodeGap();
			if (emptyCodeGap && (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak"
				|| ((event.inputType === "insertText" || event.inputType === "insertReplacementText") && event.data !== null))) {
				try {
					if (!event.cancelable) {
						rejectedBeforeInput = capture();
						throw new Error("visual-editor-window-beforeinput-not-cancelable");
					}
					event.preventDefault();
					const targets = event.getTargetRanges?.() ?? [];
					if (targets.length > 1 || targets.some(target => !emptyCodeGapBoundary(emptyCodeGap, target.startContainer, target.startOffset)
						|| !emptyCodeGapBoundary(emptyCodeGap, target.endContainer, target.endOffset))) {
						throw new Error("visual-editor-window-pending-selection-stale");
					}
					applyEmptyCodeGapText(emptyCodeGap, event.inputType === "insertParagraph" || event.inputType === "insertLineBreak" ? "\n" : event.data ?? "");
				} catch (error) { report(error); }
				return;
			}
			if (
				WINDOWED_CODE_BODY_DELETION_TYPES.has(event.inputType) &&
				rangesRef.current
			) {
				const fence = captureExactDirectChildFenceSelection(
					surface,
					rangesRef.current,
					sourceRef.current,
				);
				if (fence) {
					// One exact structural removal for an owned fence selection: the
					// browser cannot be allowed to mutate a code body here, so the
					// event must be cancelable or the native mutation is refused.
					if (!event.cancelable) {
						onTransferFailure();
						report(
							new Error("visual-editor-window-beforeinput-not-cancelable"),
						);
						return;
					}
					event.preventDefault();
					let fenceChangeApplied = false;
					try {
						const source = assertReadySourceAndDom();
						const value =
							source.slice(0, fence.start) + source.slice(fence.end);
						const postSelection: DocumentSelection = {
							direction: "none",
							end: fence.start,
							start: fence.start,
						};
						const restoreFocus =
							surface.ownerDocument.activeElement === surface;
						const committedSelection = projectVisualMarkdownRemovalSelection(
							editMapRef.current.blocks.map((block) =>
								rangesRef.current.get(block.id),
							),
							source,
							{ from: fence.start, insert: "", to: fence.end },
							postSelection,
							value,
						);
						regionRef.current = null;
						applyDocumentChange({ selection: postSelection, value: source });
						applyDocumentChange({
							changes: { from: fence.start, insert: "", to: fence.end },
							deferNativeBridge: false,
							isolateHistoryBefore: true,
							recordHistorySelection: true,
							selection: committedSelection,
							value,
						});
						fenceChangeApplied = true;
						sourceRef.current = value;
						onMarkdownChange();
						requestFormalPreview(
							value,
							{
								historyState: documentSession.document.getHistoryState(),
								restoreFocus,
								selection: committedSelection,
							},
							{
								pinWindowSelection:
									committedSelection.start === value.length && value.length > 0,
							},
						);
					} catch (error) {
						if (fenceChangeApplied) onTransferFailure();
						report(error);
					}
					return;
				}
			}
			let wholeDocumentDeletion = false;
			if (wholeDocumentDeletionInput) {
				try {
					wholeDocumentDeletion = selectionCoversEditableSurface(
						surface,
						rangesRef.current,
						documentEndSinkExclusion(),
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
			if (WINDOWED_ATOMIC_ROOT_REMOVAL_TYPES.has(event.inputType)) {
				const backward = WINDOWED_ATOMIC_ROOT_BACKWARD_TYPES.has(
					event.inputType,
				);
				let removal: Readonly<{
					atomic: HTMLElement;
					backward: boolean;
					initialBlock: HTMLElement | null;
					documentEndGap?: WindowedEmptyCodeGap;
				}> | null = null;
				try {
					// The certified document-end sink is the surface's real
					// paragraph for the caret position after a trailing atomic
					// object. The sink owns no source row, so its Backspace
					// removes that object rather than collapsing onto it - but
					// only an object the removal proof admits. A root with an
					// editable interior (a table) leaves `sinkAtomic` null, and
					// the neighbour proof below consumes the press with no write.
					const documentEndGap = backward ? documentEndGapCaret() : null;
					const sinkAtomic = documentEndGap
						? documentEndGapAtomic(documentEndGap)
						: null;
					if (documentEndGap && sinkAtomic) {
						removal = {
							atomic: sinkAtomic,
							backward: true,
							documentEndGap,
							initialBlock: null,
						};
					}
					const rootAtomicEdge = rootAtomicEdgeTarget(
						backward ? "end" : "start",
					);
					const rootAtomic = rootAtomicEdge &&
						isWindowedAtomicRemovalRoot(rootAtomicEdge)
						? rootAtomicEdge
						: null;
					if (rootAtomic) {
						removal = { atomic: rootAtomic, backward, initialBlock: null };
					} else if (rootAtomicEdge && event.cancelable) {
						// A root with an editable interior at the document edge is
						// not an object to remove, and no text row stands on its
						// far side to join: the press is a no-op, exactly as the
						// Full surface treats the same boundary.
						event.preventDefault();
						return;
					}
					const native = surface.ownerDocument.defaultView?.getSelection();
					const selectionNode = native?.anchorNode ?? null;
					let initialBlock: HTMLElement | null = selectionNode instanceof HTMLElement
						? selectionNode
						: selectionNode?.parentElement ?? null;
					while (initialBlock && initialBlock.parentNode !== surface) {
						initialBlock = initialBlock.parentElement;
					}
					if (
						// A ruling already made above stands: the certified
						// document-end sink owns the trailing object's source
						// range, and its paragraph is presentation, not a row the
						// generic neighbour proof could resolve.
						!removal &&
						native?.isCollapsed &&
						native.rangeCount === 1 &&
						selectionNode &&
						initialBlock?.parentNode === surface &&
						!initialBlock.hasAttribute(WINDOW_SPACER_ATTRIBUTE) &&
						!isWindowedAtomicRoot(initialBlock) &&
						(backward
							? caretAtWindowedRootStart(initialBlock)
							: caretAtWindowedRootEnd(initialBlock))
					) {
						// The renderer's blank-line separators may sit between the two
						// roots; no other content may be jumped over.
						let atomic: Node | null = backward
							? initialBlock.previousSibling
							: initialBlock.nextSibling;
						while (atomic instanceof Text && /^\s*$/u.test(atomic.data)) {
							atomic = backward ? atomic.previousSibling : atomic.nextSibling;
						}
						if (
							atomic instanceof HTMLElement &&
							!atomic.hasAttribute(WINDOW_SPACER_ATTRIBUTE) &&
							isWindowedAtomicRemovalRoot(atomic)
						) {
							let between = backward ? atomic.nextSibling : initialBlock.nextSibling;
							const betweenEnd = backward ? initialBlock : atomic;
							let separatorOnly = true;
							while (between && between !== betweenEnd) {
								if (!(between instanceof Text) || !/^\s*$/u.test(between.data)) {
									separatorOnly = false;
									break;
								}
								between = between.nextSibling;
							}
							if (separatorOnly) {
								removal = { atomic, backward, initialBlock };
							}
						} else if (
							atomic instanceof HTMLElement &&
							!atomic.hasAttribute(WINDOW_SPACER_ATTRIBUTE) &&
							isWindowedAtomicRoot(atomic) &&
							event.cancelable
						) {
							// A root with an editable interior is not an object this
							// owner may delete, and a table holds no text of its own,
							// so joining the neighbouring line into its last row is
							// not representable either. The press is a no-op,
							// exactly as the Full surface's table-edge owner treats
							// the same boundary.
							event.preventDefault();
							return;
						}
					}
				} catch (error) {
					if (event.cancelable) event.preventDefault();
					report(error);
					return;
				}
				if (removal) {
					if (!event.cancelable) {
						onTransferFailure();
						report(
							new Error("visual-editor-window-beforeinput-not-cancelable"),
						);
						return;
					}
					event.preventDefault();
					let documentChangeApplied = false;
					try {
						const { atomic, backward, initialBlock, documentEndGap } = removal;
						const source = assertReadySourceAndDom();
						const readOnlySnapshot = readOnlySnapshotRef.current;
						if (!readOnlySnapshot) {
							throw new Error("visual-editor-window-read-only-snapshot-missing");
						}
						assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
						if (
							documentEndGap &&
							(documentEndGap.presentation.parentNode !== surface ||
								documentEndGap.markdown !== source)
						) {
							throw new Error("visual-editor-window-pending-selection-stale");
						}
						const atomicRange = acceptedWindowedBlockRange(
							atomic,
							rangesRef.current,
							acceptedBlockSerializationsRef.current,
						);
						const initialRange = initialBlock
							? acceptedWindowedBlockRange(
									initialBlock,
									rangesRef.current,
									acceptedBlockSerializationsRef.current,
							  )
							: null;
						const editMap = editMapRef.current;
						if (!atomicRange || atomicRange.editable !== true) {
							throw new Error("visual-editor-selection-map-failed");
						}
						if (initialBlock) {
							if (
								!initialRange ||
								(backward
									? atomicRange.index + 1 !== initialRange.index
									: initialRange.index + 1 !== atomicRange.index)
							) {
								throw new Error("visual-editor-selection-map-failed");
							}
						} else {
							// A root caret owns no neighbouring row to prove against.
							// The object itself must be the current document's first or
							// last block, with nothing but separator whitespace on the
							// caret's side of it.
							const atDocumentEdge =
								backward
									? atomicRange.index === editMap.blocks.length - 1 &&
										/^\s*$/u.test(source.slice(atomicRange.end))
									: atomicRange.index === 0 &&
										/^\s*$/u.test(source.slice(0, atomicRange.start));
							if (!atDocumentEdge) {
								throw new Error("visual-editor-selection-map-failed");
							}
						}
						const atomicBlock = editMap.blocks[atomicRange.index];
						if (
							!atomicBlock ||
							atomicBlock.id !== atomicRange.id ||
							atomicBlock.id !==
								(atomic.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? "")
						) {
							throw new Error("visual-editor-selection-map-failed");
						}
						const atomicSource = createVisualMarkdownSourceRangeFromPreviewEditMap(
							source,
							editMap,
							{ end: atomicRange.index + 1, start: atomicRange.index },
						);
						if (
							atomicSource.start !== atomicRange.start ||
							atomicSource.end !== atomicRange.end ||
							(atomic instanceof HTMLHRElement &&
								!isVisualThematicBreakSource(source, atomicSource))
						) {
							throw new Error("visual-editor-selection-map-failed");
						}
						if (
							documentEndGap &&
							(atomicSource.start !== documentEndGap.before.start ||
								atomicSource.end !== documentEndGap.before.end ||
								source.slice(atomicSource.start, atomicSource.end) !==
									documentEndGap.before.source)
						) {
							throw new Error("visual-editor-window-pending-selection-stale");
						}
						// Remove the object's own source lines plus one adjacent
						// line ending, so the remaining blocks keep their canonical
						// blank-line separation instead of growing an empty one.
						let start = atomicSource.start;
						let end = atomicSource.end;
						if (start >= 2 && "\r\n" === source.slice(start - 2, start)) {
							start -= 2;
						} else if (start > 0 && "\n" === source[start - 1]) {
							start -= 1;
						} else if ("\r\n" === source.slice(end, end + 2)) {
							end += 2;
						} else if ("\n" === source[end]) {
							end += 1;
						}
						if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
							throw new Error("visual-editor-selection-map-failed");
						}
						const value = source.slice(0, start) + source.slice(end);
						// The caret stays where the deletion was pressed: the start
						// of the block after the object, or the end of the block
						// before it. A root caret after a trailing object has no
						// next row, so it lands on the last text byte the removal
						// leaves behind.
						let caret: number;
						let selectionBefore: number;
						if (initialRange) {
							caret = backward
								? Math.max(
										0,
										Math.min(value.length, initialRange.start - (end - start)),
								  )
								: Math.max(
										0,
										Math.min(value.length, windowedBlockTextEnd(source, initialRange)),
								  );
							selectionBefore = backward
								? initialRange.start
								: windowedBlockTextEnd(source, initialRange);
						} else if (backward) {
							caret = Math.max(0, Math.min(value.length, start));
							while (caret > 0 && /\s/u.test(source.charAt(caret - 1))) {
								caret -= 1;
							}
							selectionBefore = source.length;
						} else {
							caret = 0;
							selectionBefore = 0;
						}
						const postSelection: DocumentSelection = {
							direction: "none",
							end: caret,
							start: caret,
						};
						const restoreFocus =
							surface.ownerDocument.activeElement === surface;
						if (documentEndGap) {
							const revealCandidates = editMap.blocks.slice(0, atomicRange.index).map((block) => rangesRef.current.get(block.id))
								.filter((range): range is EffectiveBlockRange => Boolean(range?.editable && range.start <= caret && caret <= range.end));
							const target = revealCandidates[revealCandidates.length - 1];
							let row = target ? Array.from(surface.children).find((node): node is HTMLElement =>
								node instanceof HTMLElement && node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === target.id) : undefined;
							const refuseReveal: (stage: string, details?: Readonly<Record<string, boolean | number | string>>) => never = (stage, details = {}) => {
								const currentNative = surface.ownerDocument.defaultView?.getSelection();
								throw new WindowedRowRevealError(stage, {
									sourceLength: source.length, canonicalLength: documentSession.document.getValue().length,
									mountedLength: mountedSourceRef.current.length,
									canonicalMatchesSource: documentSession.document.getValue() === source,
									mountedMatchesSource: mountedSourceRef.current === source,
									caret, deletionStart: start, deletionEnd: end, atomicIndex: atomicRange.index,
									targetIndex: target?.index ?? -1, targetStart: target?.start ?? -1, targetEnd: target?.end ?? -1,
									childCount: surface.childNodes.length, focused: surface.ownerDocument.activeElement === surface,
									anchorType: currentNative?.anchorNode?.nodeType ?? 0, anchorOffset: currentNative?.anchorOffset ?? -1,
									inGap: Boolean(currentNative?.anchorNode && documentEndGap.presentation.contains(currentNative.anchorNode)),
									...details,
								});
							};
							if (target && !row) {
								const revision = documentSession.document.getRevision?.();
								if (!Number.isSafeInteger(revision)) refuseReveal("row-revision");
								const identity = acceptedWindowSnapshotIdentityRef.current;
								if (!identity || identity.signature !== previewSnapshot.signature) refuseReveal("row-owner-epoch", { identityPresent: Boolean(identity) });
								const request = { id: target.id, index: target.index, revision: identity.revision,
									signature: identity.signature };
								let witnessRefusal: Readonly<{ reason: string; details: Readonly<Record<string, boolean | number>> }> | null = null;
								const witness = getAcceptedWindowRow?.({ ...request, onRefusal: (reason, details) => { witnessRefusal = { reason, details }; } });
								if (!witness || witness.source !== source || witness.sourceRevision !== revision
									|| witness.sourceRange.start !== target.start || witness.sourceRange.end !== target.end) {
									const failure = witnessRefusal as Readonly<{ reason: string; details: Readonly<Record<string, boolean | number>> }> | null;
									refuseReveal("row-witness", { witnessPresent: Boolean(witness),
										witnessSourceMatches: witness?.source === source, witnessRevisionMatches: witness?.sourceRevision === revision,
										witnessStart: witness?.sourceRange.start ?? -1, witnessEnd: witness?.sourceRange.end ?? -1,
										witnessReason: failure?.reason ?? "unreported", ...failure?.details });
								}
								let refusal: Readonly<{ reason: string; details: Readonly<Record<string, boolean | number>> }> | null = null;
								const snapshot = revealAcceptedWindowRow?.({ ...request, gap: documentEndGap.presentation,
									source, sourceRevision: revision as number, onRefusal: (reason, details) => { refusal = { reason, details }; } });
								const accepted = snapshot && registerAcceptedWindowSnapshot(surface, rangesRef.current, snapshot, source, revision);
								if (!snapshot) {
									const failure = refusal as Readonly<{ reason: string; details: Readonly<Record<string, boolean | number>> }> | null;
									refuseReveal("row-reveal", { revealAvailable: Boolean(revealAcceptedWindowRow),
										previewReason: failure?.reason ?? "unreported", ...failure?.details });
								}
								if (!accepted) refuseReveal("row-register");
								if (snapshot.ownedGap !== documentEndGap.presentation) refuseReveal("row-gap");
								acceptedBlockSerializationsRef.current = accepted;
								acceptedWindowChildNodesRef.current = [...snapshot.nodes];
								acceptedWindowSnapshotIdentityRef.current = { key: snapshot.key, revision: snapshot.revision, signature: snapshot.signature };
								protectVisualMarkdownReadOnlyRegions(surface);
								readOnlySnapshotRef.current = captureVisualMarkdownReadOnlySnapshot(surface);
								row = snapshot.blocks.find((block) => block.id === target.id)?.node;
							}
							if (target && !row) refuseReveal("row-find");
							let point: Readonly<{ node: Node; offset: number }> = { node: surface, offset: 0 };
							if (target && row) {
								const rowSource = source.slice(target.start, target.end);
								const localOffset = caret - target.start;
								let query: ((label: string) => boolean) | null = null;
								const referenceDefined = (label: string): boolean => {
									if (!query) {
										const nodes: MarkdownSyntaxNode[] = [];
										markdownLanguage.parser.parse(source).iterate({ enter: (node) => { nodes.push({ from: node.from, name: node.name, to: node.to }); } });
										query = markdownReferenceLabelQuery(source, nodes, referenceLabelCaseFoldProfile);
									}
									return query(label);
								};
								point = (row.querySelector("img") && visualBoundaryForImageSourceEdge(row, rowSource, localOffset, referenceDefined))
									|| visualCaretBoundaryFromSourceOffset(row, rowSource, serializeVisualMarkdownBlockFragment([row]), localOffset);
							}
							removeDocumentEndSink();
							surface.ownerDocument.defaultView?.getSelection()?.collapse(point.node, point.offset);
						}
						regionRef.current = null;
						applyDocumentChange({
							selection: {
								direction: "none",
								end: selectionBefore,
								start: selectionBefore,
							},
							value: source,
						});
						applyDocumentChange({
							changes: { from: start, insert: "", to: end },
							deferNativeBridge: false,
							isolateHistoryBefore: true,
							recordHistorySelection: true,
							selection: postSelection,
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
							},
							{
								// Removing the trailing object leaves the caret on the
								// last text byte; the line endings the removal kept are
								// not content. That position is still the document end
								// the restored window has to mount.
								pinWindowSelection:
									value.length > 0 &&
									(postSelection.start === value.length ||
										isMarkdownTerminalWhitespaceSuffix(
											value.slice(postSelection.start),
										)),
							},
						);
					} catch (error) {
						if (documentChangeApplied) onTransferFailure();
						report(error);
					}
					return;
				}
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
			if (
				!event.isComposing &&
				("insertText" === event.inputType ||
					"insertReplacementText" === event.inputType) &&
				null !== event.data
			) {
				const rootSide = rootAtomicEdgeTarget("end")
					? ("end" as const)
					: rootAtomicEdgeTarget("start")
						? ("start" as const)
						: null;
				const rootAtomic = rootSide ? rootAtomicEdgeTarget(rootSide) : null;
				if (rootSide && rootAtomic) {
					if (!event.cancelable) {
						report(new Error("visual-editor-window-beforeinput-not-cancelable"));
						onTransferFailure();
						return;
					}
					event.preventDefault();
					try {
						const range = rootAtomicCanonicalSource(rootAtomic, rootSide);
						const text = event.data.replace(/\r\n|\r/g, "\n");
						let point: number;
						let insertion: string;
						let caret: number;
						if ("end" === rootSide) {
							// Keep every existing separator byte; add only the
							// minimum that makes the typed text its own paragraph.
							point = /^\s*$/u.test(range.source.slice(range.end))
								? range.source.length
								: range.end;
							const before = range.source.slice(0, point);
							const separator = /\n\n$/u.test(before)
								? ""
								: /\n$/u.test(before)
									? "\n"
									: "\n\n";
							insertion = separator + text;
							caret = point + insertion.length;
						} else {
							point = /^\s*$/u.test(range.source.slice(0, range.start))
								? 0
								: range.start;
							const after = range.source.slice(point);
							const separator = /^\n\n/u.test(after)
								? ""
								: /^\n/u.test(after)
									? "\n"
									: "\n\n";
							insertion = text + separator;
							caret = point + text.length;
						}
						const value =
							range.source.slice(0, point) +
							insertion +
							range.source.slice(point);
						const selection: DocumentSelection = {
							direction: "none",
							end: caret,
							start: caret,
						};
						const restoreFocus =
							surface.ownerDocument.activeElement === surface;
						regionRef.current = null;
						applyDocumentChange({
							changes: { from: point, insert: insertion, to: point },
							recordHistorySelection: true,
							selection,
							value,
						});
						sourceRef.current = value;
						onMarkdownChange();
						requestFormalPreview(
							value,
							{
								historyState: documentSession.document.getHistoryState(),
								restoreFocus,
								selection,
							},
							{ pinWindowSelection: true },
						);
					} catch (error) {
						report(error);
					}
					return;
				}
				// A caret this owner placed in a certified parent gap has no
				// block for capture(), but it still stands for one exact
				// canonical point: the typed text opens its own paragraph and
				// the break keeps its line.
				const candidate = structuralCandidate(event);
				if ("rejected" === candidate.kind) {
					// This caret IS a structural candidate, so a failed
					// certificate must stop here: the document-boundary
					// normalizer would skip the break and let the generic owner
					// edit a neighbouring row.
					if (event.cancelable) event.preventDefault();
					report(new Error("visual-editor-selection-map-failed"));
					return;
				}
				const structural = "certified" === candidate.kind ? candidate : null;
				if (structural) {
					const { canonical, gap, source } = structural;
					if (!event.cancelable) {
						report(new Error("visual-editor-window-beforeinput-not-cancelable"));
						onTransferFailure();
						return;
					}
					event.preventDefault();
					try {
						const insertion = visualStructuralParagraphInsertion(
							source,
							gap.token,
							gap.edge,
							canonical.start,
							event.data.replace(/\r\n|\r/g, "\n"),
						);
						const selection: DocumentSelection = {
							direction: "none",
							end: insertion.selection.end,
							start: insertion.selection.start,
						};
						const restoreFocus =
							surface.ownerDocument.activeElement === surface;
						regionRef.current = null;
						applyDocumentChange({
							changes: insertion.changes,
							recordHistorySelection: true,
							selection,
							value: insertion.value,
						});
						sourceRef.current = insertion.value;
						onMarkdownChange();
						requestFormalPreview(
							insertion.value,
							{
								historyState: documentSession.document.getHistoryState(),
								restoreFocus,
								selection,
							},
							{ pinWindowSelection: true },
						);
					} catch (error) {
						report(error);
					}
					return;
				}
			}
			try {
				normalizeVisualCaretAtDocumentBoundary(surface);
			} catch (error) {
				event.preventDefault();
				report(error);
				return;
			}
			// A Backspace with nothing left to remove inside its own code body
			// is an empty deletion interval: a legitimate no-change keystroke,
			// not stale state. Cancel the native mutation so the body cannot
			// drift from canonical source, and leave the accepted region alone.
			// An empty deletion interval inside this block's own code body is a
			// legitimate no-change keystroke, not stale state. It is only
			// cancellable when the event says so; a noncancelable event keeps
			// the capture/restore rejection path below so the native mutation
			// cannot leave the body out of step with canonical source.
			const deletionDirectionForInput = [
				"deleteContentBackward",
				"deleteWordBackward",
			].includes(event.inputType)
				? "backward" as const
				: ["deleteContentForward", "deleteWordForward"].includes(
							event.inputType,
						)
					? "forward" as const
					: null;
			if (
				visualInputBlock &&
				deletionDirectionForInput &&
				event.cancelable &&
				"empty" ===
					codeBodyDeletionOwnership(
						visualInputBlock.pre,
						event,
						deletionDirectionForInput,
					)
			) {
				event.preventDefault();
				return;
			}
			// Chromium names a forward deletion at the end of a code body by a
			// target range that LEAVES the body into the next block's element
			// boundary, because no in-body character follows the caret. When the
			// collapsed caret is still the body's own terminal position - proved
			// against the source slice's interval, not the raw DOM text - this
			// is a structural-boundary no-op, not stale state: consume the
			// event, keep the caret where the user placed it, and leave the
			// accepted region alone. A caret anywhere else in the body, a target
			// whose start also leaves the body, or a code text that does not
			// match the source body keeps the existing explicit rejection.
			if (
				visualInputBlock &&
				"deleteContentForward" === event.inputType &&
				event.cancelable &&
				"outside" === codeBodyDeletionOwnership(
					visualInputBlock.pre,
					event,
					"forward",
				) &&
				windowedCodeBodyTerminalCaret(
					visualInputBlock,
					surface,
					sourceRef.current,
					windowedOwnedCodeBodyInterval(visualInputBlock.pre, rangesRef.current, acceptedBlockSerializationsRef.current, sourceRef.current),
				)
			) {
				const forwardTarget = event.getTargetRanges?.()[0];
				const startInside = !forwardTarget
					|| forwardTarget.startContainer === visualInputBlock.code
					|| visualInputBlock.code.contains(forwardTarget.startContainer);
				const endInside = forwardTarget
					&& (forwardTarget.endContainer === visualInputBlock.code
						|| visualInputBlock.code.contains(forwardTarget.endContainer));
				if (startInside && !endInside) {
					event.preventDefault();
					return;
				}
			}
			let region: ActiveRegion | null = null;
			try {
				region = capture(event, deletionDirectionForInput ?? undefined);
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
				const native = surface.ownerDocument.defaultView?.getSelection();
				const targets = event.getTargetRanges?.() ?? [];
				const target = targets[0];
				const block = region.blocks[0];
				const text = block?.firstChild;
				if (!visualInputBlock && deletionDirectionForInput && region.blocks.length === 1
					&& block instanceof HTMLParagraphElement && block.childNodes.length === 1 && text instanceof Text
					&& region.baseline === text.data && native?.isCollapsed && native.anchorNode === text
					&& targets.length === 1 && target?.startContainer === text && target.endContainer === text
					&& target.startOffset < target.endOffset
					&& (deletionDirectionForInput === "backward"
						? target.endOffset === native.anchorOffset : target.startOffset === native.anchorOffset)) {
					const visualSelection = { start: target.startOffset, end: target.endOffset };
					const sourceSelection = visualSourceEscapeDeletionRange(
						sourceRef.current.slice(region.sourceStart, region.sourceEnd), region.baseline,
						visualSelection.start, visualSelection.end);
					if (sourceSelection) textDeletion = { inputType: event.inputType, node: text,
						source: sourceRef.current, sourceSelection, text: text.data, visualSelection };
				}
				syncVisibleSelection(region);
				if (!visualInputBlock && deletionDirectionForInput && region.blocks.length === 1 && block) {
					const selection = documentSession.document.getSelection();
					if (selection.start === selection.end) {
						const source = assertReadySourceAndDom();
						const image = captureNativeImageDeletion(event, block, region.blockStart, selection.start,
							source, region.sourceStart, region.sourceEnd, region.baseline, deletionDirectionForInput);
						if (image === "image-target-unproved") throw new Error("visual-editor-window-image-target-unproved");
						if (image) {
							pendingNativeTextDeletionRef.current = image;
							regionRef.current = null;
							return;
						}
					}
				}
			} catch (error) {
				const currentRegion = region ?? regionRef.current;
				const capturedMerge = captureMergeFailure(error, "beforeinput-selection", {
					sourceStart: currentRegion?.sourceStart ?? -1, sourceEnd: currentRegion?.sourceEnd ?? -1,
					baselineLength: currentRegion?.baseline.length ?? -1, editedLength: -1,
					blockCount: currentRegion?.blocks.length ?? -1,
					structural: false, bodyInput: Boolean(codeBodyInput), deletion: Boolean(textDeletion)
				});
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
				report(error, capturedMerge);
			}
		};
		const handleInput = (event: InputEvent) => {
			const inputBlock = visualInputBlock;
			visualInputBlock = null;
			const pendingNativeDeletion = pendingNativeTextDeletionRef.current;
			if (pendingNativeDeletion) {
				pendingNativeTextDeletionRef.current = null;
				if (
					!rejectedBeforeInput &&
					!pendingComposition &&
					!composing &&
					!event.isComposing &&
					pendingNativeDeletion.inputType === event.inputType
				) {
					commitPendingNativeTextDeletion(pendingNativeDeletion);
					return;
				}
			}
			if (textDeletion && textDeletion.inputType !== event.inputType) textDeletion = null;
			if (rejectedBeforeInput) {
				restoreRejectedBeforeInput(rejectedBeforeInput);
				return;
			}
			if (rejectedComposition) return;
			if (pendingComposition || (cancelledPendingComposition && (event.isComposing || event.inputType.includes("Composition")))) return;
			if (
				!active ||
				externalChangeReportedRef.current ||
				composing ||
				event.isComposing ||
				pendingRef.current
			) {
				return;
			}
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
			completedPendingComposition = null;
			cancelledPendingComposition = false;
			ordinaryCompositionOrigin = null;
			try { reissueGapInputSelection(); } catch (error) { cancelledPendingComposition = true; report(error); return; }
			// A transfer that is still outstanding owns the caret even when the
			// caret is a certified empty-code gap: its canonical lease is the only
			// authority that can place the committed text, so it must be tried
			// before the ready-only gap path that requires an idle owner.
			if (pendingRef.current || pendingPropRef.current) {
				try {
					const lease = pendingInputLease();
					assertPendingCanonicalLease(lease);
					const region = captureCompositionRegion(lease.emptyCodeGap);
					// Only a canonical empty-gap lease needs its old P/BR
					// presentation kept live. An ordinary pending caret already
					// authenticates a newly accepted frame and keeps its existing
					// accept-while-composing behaviour.
					const compositionLease = lease.emptyCodeGap
						? retainCompositionSurfaceRef.current() : null;
					pendingComposition = {
						compositionLease,
						lease,
						revision: documentSession.document.getRevision?.(),
						childNodes: Array.from(surface.childNodes),
						region,
					};
					compositionSurfaceLease = compositionLease;
					composing = true;
				} catch (error) {
					cancelledPendingComposition = true;
					report(error);
				}
				return;
			}
			const emptyCodeGap = acceptedEmptyCodeGap();
			if (emptyCodeGap) {
				try {
					assertReadySourceAndDom();
					const region = captureCompositionRegion(emptyCodeGap);
					const compositionLease = retainCompositionSurfaceRef.current();
					pendingComposition = {
						compositionLease,
						lease: { markdown: emptyCodeGap.markdown, selection: emptyCodeGap.selection,
							historyState: emptyCodeGap.historyState, signature: editMapRef.current.signature,
							restoreFocus: true, releaseDocumentEndPin: null, onDocumentEndSelectionRestored: null, emptyCodeGap },
						revision: emptyCodeGap.revision, childNodes: Array.from(surface.childNodes),
						region,
					};
					compositionSurfaceLease = compositionLease;
					composing = true;
				} catch (error) { cancelledPendingComposition = true; report(error); }
				return;
			}
			if (
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

				// Ordinary composition has no pending lease: capture its single
				// certified origin now, while the canonical caret and the native caret
				// still agree, so the final replacement can settle on the insertion end
				// instead of trusting the browser's drifted caret.
				ordinaryCompositionOrigin = null;
				try {
					const source = sourceRef.current;
					const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
					const mapped = visualSelectionSourceRangeForBlocks(
						region.blocks,
						sourceSlice,
						region.baseline,
						region.imageProjection,
					);
					const native = surface.ownerDocument.defaultView?.getSelection();
					if (
						mapped.start === mapped.end
						&& native?.isCollapsed
						&& native.anchorNode instanceof Text
						&& native.anchorNode.isConnected
						&& region.blocks.some((block) => block.contains(native.anchorNode))
					) {
						ordinaryCompositionOrigin = {
							insertionStart: region.sourceStart + mapped.start,
							revision: documentSession.document.getRevision?.(),
							source,
							textNode: native.anchorNode,
							textOffset: native.anchorOffset,
							textBefore: native.anchorNode.data,
						};
					}
				} catch {
					ordinaryCompositionOrigin = null;
				}
				syncVisibleSelection(region);
				composing = true;
			} catch (error) {
				ordinaryCompositionOrigin = null;
				report(error);
				const rejectedRegion = region ?? regionRef.current;
				if (rejectedRegion) {
					rejectedComposition = rejectedRegion;
				}
			}
		};
		const handleCompositionEnd = (event: CompositionEvent) => {
			if (externalChangeReportedRef.current) {
				releaseCompositionSurface();
				return;
			}
			if (cancelledPendingComposition) {
				cancelledPendingComposition = false;
				releaseCompositionSurface();
				return;
			}
			if (pendingComposition) {
				const composition = pendingComposition;
				try {
					if (documentSession.document.getRevision?.() !== composition.revision) {
						throw new Error("visual-editor-window-pending-selection-stale");
					}
					assertPendingCanonicalLease(composition.lease);
					finishPendingCompositionDom(surface.ownerDocument.activeElement === surface);
					if (event.data !== "") {
						applyPendingCanonicalText(composition.lease, event.data, true, true);
						completedPendingComposition = { data: event.data, markdown: sourceRef.current };
					}
				} catch (error) {
					if (pendingComposition) {
						try { finishPendingCompositionDom(false); } catch (restoreError) { report(restoreError); }
					}
					report(error);
					onTransferFailure();
				} finally {
					// The lease's canonical text is published and its superseding
					// request issued above; waking the surface now installs that
					// frame, or a late rejection if the lease was refused.
					composition.compositionLease?.release();
					releaseCompositionSurface();
				}
				return;
			}
			const rejectedRegion = rejectedComposition;
			if (rejectedRegion) {
				releaseCompositionSurface();
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
			const origin = ordinaryCompositionOrigin;
			ordinaryCompositionOrigin = null;
			const nativeWitness = (() => {
				const native = surface.ownerDocument.defaultView?.getSelection();
				return native?.anchorNode && native.focusNode
					? {
							anchorNode: native.anchorNode,
							anchorOffset: native.anchorOffset,
							focusNode: native.focusNode,
							focusOffset: native.focusOffset,
						}
					: null;
			})();
			const source = sourceRef.current;
			const expectedCommittedText = origin
				? origin.textBefore.slice(0, origin.textOffset)
					+ event.data
					+ origin.textBefore.slice(origin.textOffset)
				: "";
			const nativeOwnsOrigin = Boolean(
				origin
				&& nativeWitness
				&& nativeWitness.anchorNode === origin.textNode
				&& nativeWitness.focusNode === origin.textNode
				&& nativeWitness.anchorOffset === nativeWitness.focusOffset
				&& origin.textNode.isConnected
				&& surface.contains(origin.textNode)
				&& origin.textNode.data === expectedCommittedText
				&& nativeWitness.anchorOffset >= origin.textOffset
				&& nativeWitness.anchorOffset <= origin.textOffset + event.data.length
			);
			const compositionCommit = origin
				&& nativeOwnsOrigin
				&& "" !== event.data
				&& origin.source === source
				&& origin.revision === documentSession.document.getRevision?.()
				? {
						insertionEnd: origin.insertionStart + event.data.length,
						value:
							origin.source.slice(0, origin.insertionStart)
							+ event.data
							+ origin.source.slice(origin.insertionStart),
					}
				: undefined;
			queueMicrotask(() => {
				const nativeAtSettlement = surface.ownerDocument.defaultView?.getSelection();
				const nativeUnmovedAtSettlement = Boolean(
					nativeAtSettlement
					&& nativeWitness
					&& nativeAtSettlement.anchorNode === nativeWitness.anchorNode
					&& nativeAtSettlement.anchorOffset === nativeWitness.anchorOffset
					&& nativeAtSettlement.focusNode === nativeWitness.focusNode
					&& nativeAtSettlement.focusOffset === nativeWitness.focusOffset
				);
				const committed = commit(
					compositionCommit && nativeUnmovedAtSettlement
						? { compositionCommit }
						: undefined,
				);
				if (!committed || !compositionCommit || !origin || !nativeUnmovedAtSettlement) return;
				const native = surface.ownerDocument.defaultView?.getSelection();
				const expectedText =
					origin.textBefore.slice(0, origin.textOffset)
					+ event.data
					+ origin.textBefore.slice(origin.textOffset);
				const insertionEnd = origin.textOffset + event.data.length;
				const nativeUnmoved = Boolean(
					native
					&& nativeWitness
					&& native.anchorNode === nativeWitness.anchorNode
					&& native.anchorOffset === nativeWitness.anchorOffset
					&& native.focusNode === nativeWitness.focusNode
					&& native.focusOffset === nativeWitness.focusOffset
				);
				if (
					nativeUnmoved
					&& origin.textNode.isConnected
					&& surface.contains(origin.textNode)
					&& origin.textNode.data === expectedText
					&& native?.isCollapsed
					&& native.anchorNode === origin.textNode
					&& native.anchorOffset >= origin.textOffset
					&& native.anchorOffset < insertionEnd
				) {
					native.collapse(origin.textNode, insertionEnd);
				}
			});
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
			const key = event.key.toLowerCase();
			const selectAllShortcut =
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				!event.shiftKey &&
				"a" === key;
			const historyShortcut =
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				("z" === key || ("y" === key && !event.shiftKey));
			if (pendingComposition && historyShortcut) {
				event.preventDefault();
				cancelledPendingComposition = true;
				try {
					finishPendingCompositionDom(surface.ownerDocument.activeElement === surface);
					runHistory("y" === key || event.shiftKey);
				} catch (error) { report(error); onTransferFailure(); }
				finally { releaseCompositionSurface(); }
				return;
			}
			if (composing || event.isComposing) return;
			if (event.key === "Backspace" && !pendingComposition) {
				try {
					reissueGapInputSelection();
					const gap = emptyCodeGapRef.current;
					const native = surface.ownerDocument.defaultView?.getSelection();
					const before = gap ? emptyCodeGapNeighbor(gap.presentation.previousSibling, "before") : null;
					const row = before && acceptedWindowedBlockRange(before, rangesRef.current, acceptedBlockSerializationsRef.current);
					if (gap && gap.documentEnd !== true && native?.isCollapsed
						&& emptyCodeGapBoundary(gap, native.anchorNode, native.anchorOffset)
						&& gap.presentation instanceof HTMLParagraphElement && windowedGapLineParagraphShape(gap.presentation)
						&& row?.editable && row.start === gap.before.start && row.end === gap.before.end && before) {
						assertPendingInputDom();
						event.preventDefault();
						const point = row.end - (gap.markdown.slice(row.start, row.end).match(/[\r\n]+$/u)?.[0].length ?? 0);
						const selection: DocumentSelection = { direction: "none", start: point, end: point };
						gap.presentation.remove(); emptyCodeGapRef.current = null; ownedGapPresentationRef.current = null;
						const tail = before.lastChild;
						if (tail) native.collapse(tail, tail instanceof Text ? tail.length : tail.childNodes.length);
						else native.collapse(before, 0);
						applyDocumentChange({ value: gap.markdown, selection });
						acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
						requestFormalPreview(gap.markdown, { selection, historyState: documentSession.document.getHistoryState(), restoreFocus: true }, { pinWindowSelection: true });
						return;
					}
				} catch (error) { event.preventDefault(); report(error); return; }
			}
			if (event.key === "Enter" && !composing && !event.isComposing) {
				try {
					// A caret on the host's own end after the trailing spacer has no
					// row to split: its canonical position is the document end. The
					// owner mounts its certified document-end paragraph there and the
					// same gap command opens the terminal block, so the position stops
					// being a host boundary no mapper can resolve.
					const documentEndGap = documentEndRootGap();
					if (documentEndGap) {
						if (!event.cancelable) {
							report(new Error("visual-editor-window-beforeinput-not-cancelable"));
							onTransferFailure();
							return;
						}
						event.preventDefault();
						regionRef.current = null;
						applyEmptyCodeGapText(documentEndGap, "\n");
						return;
					}
					const native = surface.ownerDocument.defaultView?.getSelection();
					// A text tail is a direct surface block, heading or paragraph.
					// Its source-neutral trailing line is owned by the same certified
					// gap regardless of which block kind introduced it.
					let block: HTMLElement | null = native?.anchorNode instanceof HTMLElement
						? native.anchorNode
						: native?.anchorNode?.parentElement ?? null;
					while (block && block.parentNode !== surface) block = block.parentElement;
					if (block && !/^(?:H[1-6]|P)$/u.test(block.tagName)) block = null;
					// An empty block already has its own native split contract (the
					// exited-fence middle gap); only a real text tail owns this line.
					if (block && '' === (block.textContent ?? '')) block = null;
					if (block instanceof HTMLElement && block.parentNode === surface && native?.isCollapsed) {
						const before = acceptedWindowedBlockRange(block, rangesRef.current, acceptedBlockSerializationsRef.current);
						const physical = ownedGapPresentationRef.current;
						const existingGap = physical && emptyCodeGapPresentationMatchesDocument(physical, documentSession.document)
							&& block.nextSibling === physical.presentation && windowedGapLineParagraphShape(physical.presentation) ? physical.presentation : null;
						const afterNode = emptyCodeGapNeighbor(existingGap ? existingGap.nextSibling : block.nextSibling, "after");
						const mountedAfter = afterNode ? acceptedWindowedBlockRange(afterNode, rangesRef.current, acceptedBlockSerializationsRef.current) : null;
						// An unmounted source row has no DOM node: its accepted source
						// extent is the certificate, never a fabricated spacer slot.
						const sourceAfter = before ? rangesRef.current.nextEditableAfter(before.index) : null;
						const after = mountedAfter?.editable ? mountedAfter : sourceAfter;
						const markdown = documentSession.document.getValue();
						const tail = before ? before.end - (markdown.slice(before.start, before.end).match(/[\r\n]+$/u)?.[0].length ?? 0) : -1;
						const noSourceRowAfter = !rangesRef.current.hasEditableAfter(before?.index ?? Number.MAX_SAFE_INTEGER);
						const gapEnd = after?.editable ? after.start
							: noSourceRowAfter && before?.editable && /^[\r\n]*$/u.test(markdown.slice(before.end)) ? markdown.length : null;
						const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(block); prefix.setEnd(native.anchorNode!, native.anchorOffset);
						const gapSlice = gapEnd === null ? null : markdown.slice(tail, gapEnd);
						const emptyEofGap = null === after
							&& noSourceRowAfter
							&& gapEnd === markdown.length
							&& gapSlice !== null
							&& /^[\r\n]*$/u.test(gapSlice)
							&& before?.editable
							&& !blockShortcutTail(block);
						const tightAdjacent = emptyEofGap || (
							null !== after && null !== before
							&& after.start === before.end
							&& !blockShortcutTail(block)
						);
						if (before?.editable && gapEnd !== null && prefix.toString() === block.textContent
							&& null !== gapSlice
							&& certifiedTextTailGapSlice(gapSlice, tightAdjacent)) {
							if (pendingHistorySelectionRef.current) assertPendingCanonicalLease(pendingHistorySelectionRef.current);
							assertPendingInputDom();
							const revision = documentSession.document.getRevision?.();
							if (!Number.isSafeInteger(revision) || markdown !== sourceRef.current) throw new Error("visual-editor-window-pending-selection-stale");
							event.preventDefault();
							const paragraph = existingGap ?? surface.ownerDocument.createElement("p");
							if (!existingGap) paragraph.append(surface.ownerDocument.createElement("br"));
							block.after(paragraph); native.collapse(paragraph, existingGap ? paragraph.childNodes.length : 0);
							// The caret sits after the certified separator: the blank line
							// when there is one, otherwise the following row's own start.
								const eofSeparator = emptyEofGap
									? missingTerminalSeparators(markdown, sourceLineEndingBefore(markdown, markdown.length))
									: "";
							const gapMarkdown = eofSeparator
								? markdown + eofSeparator
								: markdown;
							const gapLineEndings = gapSlice.match(/\r\n|\r|\n/g) ?? [];
							const point = emptyEofGap
								? gapMarkdown.length
								: gapLineEndings.length >= 2
									? tail + (gapLineEndings[0]?.length ?? 0) + (gapLineEndings[1]?.length ?? 0)
									: gapEnd;
							const selection: DocumentSelection = { direction: "none", start: point, end: point };
							applyDocumentChange({
								...(eofSeparator
									? { changes: { from: markdown.length, insert: eofSeparator, to: markdown.length } }
									: {}),
								recordHistorySelection: true,
								selection,
								value: gapMarkdown,
							});
							sourceRef.current = gapMarkdown;
							onMarkdownChange();
							const nextRevision = documentSession.document.getRevision?.();
							if (!Number.isSafeInteger(nextRevision)) throw new Error("visual-editor-window-pending-selection-stale");
							const nextHistoryState = documentSession.document.getHistoryState();
							emptyCodeGapRef.current = {
								markdown: gapMarkdown,
								selection,
								revision: nextRevision as number,
								historyState: nextHistoryState,
								presentation: paragraph,
								presentationHtml: paragraph.innerHTML,
								accepted: true,
								before: { start: before.start, end: before.end, source: markdown.slice(before.start, before.end) },
								after: after?.editable ? { start: after.start, end: after.end, source: markdown.slice(after.start, after.end) }
									: { start: gapMarkdown.length, end: gapMarkdown.length, source: "" },
							};
							acceptedWindowChildNodesRef.current = Array.from(surface.childNodes);
							retainGapPresentation(emptyCodeGapRef.current);
							rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, emptyCodeGapRef.current);
							requestFormalPreview(gapMarkdown, { historyState: nextHistoryState, restoreFocus: true, selection }, { pinWindowSelection: true });
							return;
						}
					}
				} catch (error) { event.preventDefault(); report(error); return; }
			}
			// A certified text draft whose caret sits at the end of a complete fence
			// opening owns the block Enter command even while its formal Preview is
			// outstanding. Without this the pending beforeinput path would insert a
			// plain line break instead of building the fence.
			if ("Enter" === event.key && (pendingRef.current || pendingPropRef.current)) {
				const draft = emptyCodeGapRef.current;
				const lease = pendingHistorySelectionRef.current;
				const native = surface.ownerDocument.defaultView?.getSelection();
				if (draft && !draft.accepted && lease && draft.markdown === lease.markdown
					&& native?.isCollapsed && draft.presentation.isConnected
					&& native.anchorNode && draft.presentation.contains(native.anchorNode)) {
					const head = surface.ownerDocument.createRange();
					head.selectNodeContents(draft.presentation);
					head.setEnd(native.anchorNode, native.anchorOffset);
					const text = draft.presentation.textContent ?? "";
					if ("" !== text && head.toString() === text) {
						try {
							if (applyPendingFenceShortcut(lease, draft, event)) return;
						} catch (error) {
							event.preventDefault();
							report(error);
							return;
						}
					}
				}
			}
			// A pending formal Preview must not make Undo invisible. The shortcut is
			// claimed by the history owner below even while a transfer is in flight,
			// so the canonical document and the pending request are reconciled by the
			// history path itself instead of being silently dropped here. Other keys
			// leave input admission to beforeinput; navigation invalidates the lease.
			if (
				!historyShortcut &&
				(pendingRef.current || pendingPropRef.current)
			) {
				if (WINDOWED_PENDING_NAVIGATION_KEYS[event.key] === true || selectAllShortcut) invalidatePendingInputSelection();
				return;
			}
			if (historyShortcut) {
				event.preventDefault();
				runHistory("y" === key || event.shiftKey);
				return;
			}
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
			if (
				WINDOWED_PENDING_NAVIGATION_KEYS[event.key] === true &&
				emptyCodeGapRef.current?.documentEnd !== true
			) {
				// A navigation key retires an ordinary gap certificate, because
				// the caret may have left it. The document-end sink keeps its
				// certificate: its paragraph is a real mounted caret position,
				// and every consumer re-proves the native caret against it.
				emptyCodeGapRef.current = null;
			}
			if (event.key === "Enter" && acceptedEmptyCodeGap()) return;
			if (!["Backspace", " ", "Delete", "Enter"].includes(event.key)) return;
			if ("Delete" === event.key && documentEndGapCaret()) {
				// Forward deletion at canonical EOF has nothing to consume. The
				// sink is the surface's own paragraph, so the generic region
				// capture has no row for it and must not run.
				event.preventDefault();
				return;
			}
			// A restored caret in a certified parent gap has no block for the
			// document-boundary normalizer or the region capture below. Its
			// ordinary text input is owned by beforeinput through the same
			// certificate, so this key must pass through untouched. Only a
			// certified gap takes this route; every other root endpoint keeps
			// the existing rejection.
			if (" " === event.key) {
				const candidate = structuralCandidate();
				if ("certified" === candidate.kind) return;
				if ("rejected" === candidate.kind) {
					// An eligible-but-uncertified gap must not reach the
					// normalizer or the region capture below.
					event.preventDefault();
					report(new Error("visual-editor-selection-map-failed"));
					return;
				}
			}
			if ("Backspace" === event.key) {
				let wholeDocumentSelection = false;
				try {
					wholeDocumentSelection = selectionCoversEditableSurface(
						surface,
						rangesRef.current,
						documentEndSinkExclusion(),
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
				// A native range selecting one direct-child fence has the same
				// shape: the fence carries no descendant caret, so let beforeinput
				// own the exact structural deletion instead of reporting a false
				// selection error here.
				if (
					rangesRef.current &&
					captureExactDirectChildFenceSelection(
						surface,
						rangesRef.current,
						sourceRef.current,
					)
				)
					return;
			}
			// A root caret beside a mounted atomic object has no editable row the
			// normalizer could place it in. beforeinput owns the object's own
			// source range instead of guessing a neighbouring row here. The
			// certified document-end sink is that same caret in its real
			// paragraph form: its Backspace also removes the trailing object,
			// so it must not be normalised into the object's own row either.
			if (
				("Backspace" === event.key &&
					(rootAtomicEdgeTarget("end") || documentEndGapCaret())) ||
				(" " === event.key &&
					(rootAtomicEdgeTarget("start") ||
						rootAtomicEdgeTarget("end") ||
						documentEndGapCaret()))
			) {
				return;
			}
			// A certified host-boundary caret at the document end has no row for
			// the normalizer to place it in and none for the generic deletion
			// owner to remove a character from. The position is still the
			// canonical end, so this key deletes the one grapheme before the
			// terminal row's own text - exactly the character the full surface
			// deletes from the same caret - and pins the restored window to that
			// end. A transfer that is already outstanding owns later presses
			// through its own canonical deletion, so a characterwise run stays
			// one grapheme per press.
			if ("Backspace" === event.key) {
				let deletion: WindowedDocumentEndDeletion | null;
				try {
					deletion = documentEndRootDeletion();
				} catch (error) {
					event.preventDefault();
					report(error);
					return;
				}
				if (deletion) {
					if (!event.cancelable) {
						report(new Error("visual-editor-window-beforeinput-not-cancelable"));
						onTransferFailure();
						return;
					}
					event.preventDefault();
					regionRef.current = null;
					applyDocumentChange({
						changes: { from: deletion.from, insert: "", to: deletion.to },
						recordHistorySelection: true,
						selection: deletion.selection,
						value: deletion.value,
					});
					sourceRef.current = deletion.value;
					onMarkdownChange();
					requestFormalPreview(
						deletion.value,
						{
							historyState: documentSession.document.getHistoryState(),
							restoreFocus: surface.ownerDocument.activeElement === surface,
							selection: deletion.selection,
						},
						{
							// Only separator line endings follow the new caret: the
							// restored window has to mount that end again instead of
							// leaving the caret on the host boundary.
							pinWindowSelection:
								deletion.value.length > 0 &&
								isMarkdownTerminalWhitespaceSuffix(
									deletion.value.slice(deletion.selection.start),
								),
						},
					);
					return;
				}
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
				const emptyCodeExit = region.blocks.length === 1 && region.blocks[0]?.tagName === "PRE";
				if (!applyVisualBlockShortcut(surface, event)) {
					regionRef.current = null;
					return;
				}
				regionRef.current = region;
				const committed = commit({
					allowSingleBlockStructural: true,
				});
				if (committed && emptyCodeExit && rangesRef.current) {
					const beforeNode = emptyCodeGapNeighbor(region.before, "before");
					const afterNode = emptyCodeGapNeighbor(region.after, "after");
					const before = beforeNode ? acceptedWindowedBlockRange(beforeNode, rangesRef.current, acceptedBlockSerializationsRef.current) : null;
					const after = afterNode ? acceptedWindowedBlockRange(afterNode, rangesRef.current, acceptedBlockSerializationsRef.current) : null;
					const markdown = sourceRef.current;
					const selection = documentSession.document.getSelection();
					const revision = documentSession.document.getRevision?.();
					const native = surface.ownerDocument.defaultView?.getSelection();
					const paragraph = native?.anchorNode;
					if (before?.editable && after?.editable && Number.isSafeInteger(revision)
						&& paragraph instanceof HTMLParagraphElement && paragraph.parentNode === surface
						&& paragraph.childNodes.length === 1 && paragraph.firstChild instanceof HTMLBRElement
						&& selection.direction === "none" && selection.start === selection.end
						&& before.end <= selection.start && selection.end <= after.start
						&& /^(?:\r\n|\r|\n)+$/u.test(markdown.slice(before.end, after.start))) {
						const gap: WindowedEmptyCodeGap = {
							before: { start: before.start, end: before.end, source: markdown.slice(before.start, before.end) },
							after: { start: after.start, end: after.end, source: markdown.slice(after.start, after.end) },
							markdown, selection: { ...selection }, revision: revision as number,
							historyState: documentSession.document.getHistoryState(), presentation: paragraph,
							presentationHtml: paragraph.innerHTML,
							accepted: true,
						};
						emptyCodeGapRef.current = gap;
						retainGapPresentation(gap);
						rememberEmptyCodeGap(emptyCodeGapHistoryRef.current, gap);
					}
				}
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
				if (composing || pendingComposition) {
					// A native IME draft owns the caret and its DOM; a paste must
					// never serialize that draft as if it were accepted content.
					report(new Error("visual-editor-markdown-paste-superseded"));
					return;
				}
				if (pendingRef.current || pendingPropRef.current) {
					// The outstanding transfer already holds an authenticated
					// canonical lease for this caret. Consume it through the same
					// pending text owner instead of refusing the gesture; a lease
					// that no longer describes the live canonical document,
					// selection, history, or DOM still refuses below.
					try {
						const lease = pendingInputLease();
						assertPendingCanonicalLease(lease);
						applyPendingCanonicalText(lease, markdown);
					} catch (error) {
						report(error);
					}
					return;
				}
				replaceSelectionOrCertifiedGap(markdown);
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
			replaceSelectionOrCertifiedGap(event.dataTransfer?.getData("text/plain") ?? "");
		};
		const invalidateContextMenuSelection = (): void => {
			contextMenuSelectionRef.current = null;
		};
		/**
		 * The document-end caret sink.
		 *
		 * Chromium cannot keep a collapsed caret at a contenteditable host's own
		 * end boundary when the last child is an object the caret cannot enter
		 * (a mermaid diagram, a table, a thematic break): its next key silently
		 * relocates that caret to the host's start, so an ordinary Backspace
		 * would delete the first block of the article. The source position is
		 * still the document end, so the surface has to own a real editable
		 * paragraph there. This is the same certified gap this owner already
		 * issues for an empty code fence, with an empty source interval at
		 * canonical EOF: it is presentation only until the first typed character
		 * splices it into the canonical document.
		 */
		const documentEndSinkCandidate = (): HTMLElement | null => {
			if (!active || externalChangeReportedRef.current || !surface.isConnected) return null;
			if (surface.ownerDocument.activeElement !== surface) return null;
			if ("true" !== surface.getAttribute("contenteditable")) return null;
			const native = surface.ownerDocument.defaultView?.getSelection();
			if (!native || !native.isCollapsed || native.rangeCount !== 1) return null;
			if (native.anchorNode !== surface || native.focusNode !== surface
				|| native.anchorOffset !== native.focusOffset
				|| native.anchorOffset !== surface.childNodes.length) return null;
			let last: Node | null = surface.lastChild;
			while (last instanceof Text && /^[ \t\r\n]*$/u.test(last.data)) last = last.previousSibling;
			if (!(last instanceof HTMLElement)
				|| last.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
				|| !isWindowedAtomicRoot(last)) return null;
			return last;
		};
		const settleDocumentEndSelection = (): void => {
			if (composing || pendingComposition) return;
			if (pendingRef.current || pendingPropRef.current) return;
			const native = surface.ownerDocument.defaultView?.getSelection();
			const previousSink = documentEndSinkRef.current;
			const sinkMounted = Boolean(
				previousSink && previousSink.parentNode === surface,
			);
			const sinkHoldsCaret = Boolean(
				sinkMounted &&
					previousSink &&
					native?.isCollapsed &&
					native.anchorNode &&
					previousSink.contains(native.anchorNode),
			);
			// The sink is a caret position, never a paragraph of the article:
			// when the native caret leaves it, the paragraph leaves with it. A
			// sink that stays behind would be an empty block the document does
			// not contain.
			if (sinkMounted && !sinkHoldsCaret) removeDocumentEndSink();
			const owned = ownedGapPresentationRef.current;
			if (owned && owned.presentation.parentNode === surface) return;
			// An owned presentation that is no longer mounted cannot be retained
			// by any later acceptance either - `retainGap` only ever keeps a live
			// node - so its vestigial ownership and certificate are retired here
			// instead of blocking the next document-end caret forever.
			if (owned) ownedGapPresentationRef.current = null;
			if (
				emptyCodeGapRef.current &&
				emptyCodeGapRef.current.presentation.parentNode !== surface
			) {
				emptyCodeGapRef.current = null;
			}
			if (emptyCodeGapRef.current) return;
			const last = documentEndSinkCandidate();
			if (!last) return;
			const markdown = documentSession.document.getValue();
			const revision = documentSession.document.getRevision?.();
			const range = acceptedWindowedBlockRange(
				last,
				rangesRef.current,
				acceptedBlockSerializationsRef.current,
			);
			if (
				!Number.isSafeInteger(revision)
				|| !range?.editable
				|| range.index !== editMapRef.current.blocks.length - 1
				|| range.end !== markdown.length
				|| markdown !== sourceRef.current
				|| markdown !== mountedSourceRef.current
				// The sink is the line after the last block. A source with no final
				// line ending has no such line yet; typing there has to establish
				// the separator first, which is an edit, not this caret gesture.
				|| !/[\r\n]$/u.test(markdown)
			) return;
			mountDocumentEndGap(markdown, revision as number, {
				end: range.end,
				source: markdown.slice(range.start, range.end),
				start: range.start,
			});
		};
		const handleDocumentEndSelectionChange = (): void => {
			try {
				settleDocumentEndSelection();
			} catch (error) {
				report(error);
			}
		};
		const handleContextMenuSelectionChange = (): void => {
			const ownerPlaced = ownerPlacedSelectionRef.current;
			if (ownerPlaced) {
				let drifted = true;
				try {
					const currentOwner = captureVisualSelection(surface);
					drifted = !currentOwner || !visualSelectionEqual(ownerPlaced, currentOwner);
				} catch {
					drifted = true;
				}
				if (drifted) {
					// The native selection moved away from the one this owner
					// placed, so it now describes a user gesture again.
					ownerPlacedSelectionRef.current = null;
				}
			}
			const lease = contextMenuSelectionRef.current;
			if (lease) {
				const current = captureVisualSelection(surface);
				if (!current || !visualSelectionEqual(lease, current)) {
					invalidateContextMenuSelection();
				}
			}
			// The pending lease's own producer: a real caret move that can be
			// authenticated against its accepted row or code body is handed back to
			// the lease; every other move stays invalidated.
			reauthenticatePendingNavigationSelection();
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
				emptyCodeGapRef.current = null;
				ownedGapPresentationRef.current = null;
				emptyCodeGapHistoryRef.current.clear();
				releasePendingHistorySelection(pendingHistorySelectionRef);
				// Source ownership moved: revoke the owned draft and its lease now.
				const foreignComposition = pendingComposition;
				pendingComposition = null;
				cancelledPendingComposition = true;
				foreignComposition?.compositionLease?.release();
				releaseCompositionSurface();
				onCanonicalDocumentChange();
			}
		});

		surface.addEventListener("beforeinput", handleBeforeInput);
		surface.addEventListener("pointerdown", handlePendingPointerDown);
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
		surface.ownerDocument.addEventListener(
			"selectionchange",
			handleDocumentEndSelectionChange,
			true,
		);
		surface.addEventListener("focusin", handleContextMenuSurfaceFocus);
		/**
		 * The accepted evidence a captured witness may be resolved against,
		 * read from the owner's own certified state. Read-only: a resolution
		 * never maps a selection, flushes native input, or requests a render.
		 */
		const contextMenuWitnessEvidence = (): Readonly<{
			accepted: AcceptedWindowedBlocks;
			canonicalSource: string;
			mountedSource: string;
			ranges: SourceRangeLedger;
			ready: boolean;
		}> => {
			// Readiness for a demand is this owner's identity and settlement
			// state: it is live, it reports no foreign change, its transfer has
			// settled, and the canonical document is still the one this owner
			// committed. The block's own proof is the witness, re-authenticated
			// below against the accepted registry and ledger; a whole-surface
			// certificate would instead reject a demand whose pointed block is
			// untouched merely because a legally accepted render enhanced or
			// materialized a different block.
			const ready =
				active
				&& !externalChangeReportedRef.current
				&& !pendingRef.current
				&& !pendingPropRef.current
				&& documentSession.document.getValue() === sourceRef.current;
			return {
				accepted: acceptedBlockSerializationsRef.current,
				canonicalSource: sourceRef.current,
				mountedSource: mountedSourceRef.current,
				ranges: rangesRef.current,
				ready,
			};
		};

		/**
		 * Capture one gesture's target while it is still live, or `null` when
		 * this owner cannot name it.
		 *
		 * The witness binds the canonical source the owner has committed AND the
		 * source its mounted ledger and accepted DOM actually describe. Those
		 * two must already be the same document: a demand captured while a
		 * structural commit is still awaiting its accepted render describes a
		 * previous revision, so it is refused outright rather than parked for a
		 * later `bN`/content guess. Capture is otherwise independent of
		 * readiness - an outstanding same-source transfer is a readiness fact,
		 * not an identity fact - so a held gesture on unchanged accepted DOM
		 * keeps its authentic row.
		 *
		 * Nothing here reads detached ancestry, a coordinate hit-test, another
		 * surface's nodes, or a request to render.
		 */
		const captureContextMenuWitness = (
			target: Element | null,
		): ContextMenuTargetWitness | null => {
			if (!active || externalChangeReportedRef.current) return null;
			if (!target || !surface.isConnected) return null;
			// Only the surface itself is a surface-level witness. A renderer gap
			// element between blocks carries no block of its own and is never
			// guessed into a descendant or a neighbour.
			const surfaceRoot = target === surface;
			if (!surfaceRoot && !(target.isConnected && surface.contains(target)))
				return null;
			const canonicalSource = sourceRef.current;
			if (
				documentSession.document.getValue() !== canonicalSource ||
				mountedSourceRef.current !== canonicalSource
			) {
				// The accepted DOM describes another revision of the document.
				// No correspondence into the demanded source exists yet.
				return null;
			}
			// The certificate this gesture needs is the POINTED root's, not the
			// whole window's: a legally accepted render may enhance another block
			// (KaTeX, materialization, a scroll-driven window commit) after this
			// owner accepted the surface, and that says nothing about whether the
			// block the user pointed at is still the one this owner accepted.
			// Every per-root proof below is unchanged and still required.
			if (surfaceRoot) {
				// A surface-level gesture names the whole mounted document, so its
				// own certificate is the accepted child list - the same nodes, in
				// the same order, that this owner installed. A surface whose child
				// list was mutated after acceptance (a replaced same-id root, an
				// inserted clone, a removed block) describes no accepted document,
				// so the gesture is refused here instead of being prepared against
				// rows that no longer describe the mounted DOM.
				const acceptedNodes = acceptedWindowChildNodesRef.current;
				const mountedNodes = Array.from(surface.childNodes);
				if (
					mountedNodes.length !== acceptedNodes.length ||
					mountedNodes.some((node, index) => node !== acceptedNodes[index])
				)
					return null;
				return {
					...contextMenuTargetIdentity(surface),
					anchor: surface,
					blockSourceRange: null,
					blockSerialization: null,
					canonicalSource,
					surfaceRoot: true,
				};
			}
			// The target's ACTUAL direct root is the only block this gesture can
			// name. Read it from the surface's own children instead of trusting a
			// label found anywhere in the ancestry: a nested or cloned same-label
			// node must never borrow another accepted root's identity.
			let actualRoot: HTMLElement | null = null;
			for (
				let current = target instanceof HTMLElement ? target : target.parentElement;
				current && current !== surface;
				current = current.parentElement
			) {
				if (current.parentElement === surface) actualRoot = current;
			}
			if (
				!actualRoot?.isConnected ||
				!surface.contains(target) ||
				!surface.contains(actualRoot)
			) {
				return null;
			}
			// A renderer gap between accepted blocks owns no source range.
			if (actualRoot.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) return null;
			const blockId = actualRoot.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
			const identity = contextMenuTargetIdentity(target);
			if (!blockId || identity.blockId !== blockId) return null;
			// The label must name exactly this one mounted root.
			if (
				1 !==
				Array.from(surface.children).filter(
					(child) =>
						child instanceof HTMLElement
						&& !child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
						&& child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) === blockId,
				).length
			) {
				return null;
			}
			const range = acceptedWindowedBlockRange(
				actualRoot,
				rangesRef.current,
				acceptedBlockSerializationsRef.current,
			);
			// The record bound to this actual Node - not the live label - names
			// the row this gesture may own. A node relabelled to another valid,
			// unmounted row has no binding here even when its rendering is
			// identical and its new label is unique.
			if (!range) return null;
			let renderedSerialization: string | null = null;
			try {
				renderedSerialization = normalizedWindowedBlockSerialization(actualRoot);
			} catch {
				renderedSerialization = null;
			}
			if (null === renderedSerialization) return null;
			// The root must still render the content this owner accepted for it.
			// A foreign change to THIS block is a different block; a foreign
			// change elsewhere in the window says nothing about this root.
			const record = acceptedBlockSerializationsRef.current.get(actualRoot);
			if (!record) return null;
			if (
				record.editable
				&& null !== record.serialization
				&& record.serialization !== renderedSerialization
			) return null;
			return {
				...identity,
				anchor: target,
				blockSourceRange: { end: range.end, start: range.start },
				blockSerialization: renderedSerialization,
				canonicalSource,
				surfaceRoot: false,
			};
		};

		/**
		 * Issue the demand's target lifetime for one captured witness. `release`
		 * is idempotent and terminal; `resolve` re-authenticates the witness
		 * against the owner's current accepted source and returns `null` - never
		 * a substitute element - when that demand can no longer be attributed.
		 */
		const issueContextMenuTargetLease = (
			witness: ContextMenuTargetWitness,
		): EditorContextMenuTargetLease => {
			let released = false;
			// A retired anchor is only replayable while its own demand owns this
			// record, so the record retires with the lease.
			contextMenuTargetsRef.current.set(witness.anchor, witness);
			return {
				release: () => {
					if (released) return;
					released = true;
					contextMenuTargetsRef.current.delete(witness.anchor);
				},
				resolve: () => {
					if (released || !active || externalChangeReportedRef.current)
						return null;
					return resolveWitnessedContextMenuTarget(
						surface,
						witness,
						contextMenuWitnessEvidence(),
					);
				},
			};
		};

		/**
		 * The element a preparation pass may select. A node this surface still
		 * mounts is prepared exactly as before; a replayed node resolves only
		 * through the witness its own demand captured, and never through the
		 * block id or image ordinal the detached node still carries.
		 */
		const resolveContextMenuSelectionTarget = (
			target: Element | null | undefined,
		): Element | null => {
			if (!target) return null;
			if (target.isConnected && surface.contains(target)) {
				// Existing connected-node preparation is preserved, with one
				// addition: when the target sits inside an accepted root, that
				// root must still own the row this owner accepted for it. A node
				// relabelled onto another valid row is refused here, before any
				// selection or canonical write.
				if (target !== surface) {
					let actualRoot: HTMLElement | null = null;
					for (
						let current =
							target instanceof HTMLElement ? target : target.parentElement;
						current && current !== surface;
						current = current.parentElement
					) {
						if (current.parentElement === surface) actualRoot = current;
					}
					if (
						actualRoot &&
						!actualRoot.hasAttribute(WINDOW_SPACER_ATTRIBUTE) &&
						!acceptedWindowedBlockRange(
							actualRoot,
							rangesRef.current,
							acceptedBlockSerializationsRef.current,
						)
					) {
						return null;
					}
				}
				// The witness recorded here is what a later replay of this same
				// gesture authenticates against.
				const witness = captureContextMenuWitness(target);
				if (witness) contextMenuTargetsRef.current.set(target, witness);
				return target;
			}
			const witness = contextMenuTargetsRef.current.get(target);
			if (!witness) return null;
			return resolveWitnessedContextMenuTarget(
				surface,
				witness,
				contextMenuWitnessEvidence(),
			);
		};

		/**
		 * Settle what this owner already accepted from the user before the
		 * demand reads its snapshot. Version C holds no debounce window: an
		 * accepted native edit is published by its own `input` handler in the
		 * same task, so the only unsettled states are ones this owner must not
		 * publish - an IME draft that belongs to the native window until
		 * compositionend, or a native rejection the owner is still rolling back.
		 * Refusing them fails the activation closed instead of capturing a
		 * source the user has not authored.
		 */
		const prepareContextMenuDemand = (): boolean => {
			if (!active || externalChangeReportedRef.current) return false;
			if (!surface.isConnected) return false;
			if (
				"false" === surface.getAttribute("contenteditable")?.toLowerCase()
			)
				return false;
			// An IME draft belongs to the native window until compositionend
			// publishes it; a rejected native input is still being rolled back.
			// Neither is a document the user has authored.
			if (
				composing
				|| pendingComposition
				|| cancelledPendingComposition
				|| rejectedBeforeInput
				|| rejectedComposition
			)
				return false;
			// A beforeinput capture is input the owner has not published yet. Its
			// `input` handler is the one publisher of that region, so committing
			// it here would race the native event and leave it reporting a missing
			// region.
			if (regionRef.current) return false;
			// A native paste is held for one task so its own publish path can run;
			// the document is not settled until that task runs.
			if (cancelPendingPaste) return false;
			// A same-source transfer is a readiness fact, not an identity fact:
			// the accepted DOM still describes the demanded document, so the
			// gesture is admitted. A transfer that already advanced the canonical
			// source is different - the accepted DOM describes a previous
			// revision, so no demand can be attributed to it yet. Refusing here
			// ends the gesture silently, before any capture or reported failure;
			// the settled transfer notifies readiness and the next gesture is
			// admitted normally.
			const canonicalSource = sourceRef.current;
			if (
				documentSession.document.getValue() !== canonicalSource ||
				mountedSourceRef.current !== canonicalSource
			)
				return false;
			return true;
		};

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
					// A removal that takes whole blocks with it can report its
					// caret on whitespace this surface cannot mount or restore.
					// Commit the nearest surviving editable boundary instead so
					// the history selection, the window pin, and the native
					// restoration all describe the same position.
					const committedSelection = projectVisualMarkdownRemovalSelection(
						editMapRef.current.blocks.map((block) =>
							rangesRef.current.get(block.id),
						),
						currentValue,
						request.change.changes,
						request.change.selection,
						request.change.value,
					);
					applyDocumentChange({
						changes: request.change.changes,
						recordHistorySelection: true,
						selection: committedSelection,
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
							selection: committedSelection,
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
			isTransferPending: () =>
				Boolean(
					pendingRef.current ||
						pendingPropRef.current ||
						externalChangeReportedRef.current,
				),
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
					// A caret this owner placed in a certified parent gap has no
					// block to capture, but it still stands for one exact
					// canonical point: publish that point instead of failing.
					// The certificate is the same ready one the text owner uses,
					// so a mutated or replaced accepted child is not blessed.
					const candidate = structuralCandidate();
					if ("rejected" === candidate.kind) {
						return report(new Error("visual-editor-selection-map-failed"));
					}
					if ("certified" === candidate.kind) {
						applyDocumentChange({
							selection: candidate.gap.selection,
							value: candidate.source,
						});
						regionRef.current = null;
						return true;
					}
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
						region.imageProjection,
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
			captureContextMenuTarget(target) {
				const witness = captureContextMenuWitness(target);
				return witness ? issueContextMenuTargetLease(witness) : null;
			},
			prepareContextMenuDemand,
			prepareContextMenuSelection(target, point, activation = "keyboard") {
				if (!active || externalChangeReportedRef.current || pendingRef.current || pendingPropRef.current) return false;
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
				const resolvedTarget = resolveContextMenuSelectionTarget(target);
				if (target && !resolvedTarget) {
					// The owner could not authenticate this target against its
					// current accepted source: the gesture's block is gone, or the
					// replayed node was never captured by this demand. Fail
					// explicitly instead of preparing the surface-level caret or
					// rebinding the action to a different block.
					return false;
				}
                const targetThematicBreak = resolvedTarget?.closest("hr");
                const currentThematicBreak = captureVisualThematicBreakSelection(surface);
                const selectionBeforePreparation =
                    surface.ownerDocument.defaultView?.getSelection();
                const preservesOwnedSelection = Boolean(
                    "pointer" === activation
                    && targetThematicBreak
                    && "owned" === provenance
                    && selectionBeforePreparation
                    && !selectionBeforePreparation.isCollapsed
                    && (
                        !currentThematicBreak
                        || currentThematicBreak.block !== targetThematicBreak
                    )
                );
                const preparesThematicBreak = Boolean(
                    ("keyboard" === activation && currentThematicBreak)
                    || (
                        "pointer" === activation
                        && targetThematicBreak
                        && !preservesOwnedSelection
                    )
                );
                let pointerPreparation: VisualThematicBreakPointerPreparation | null = null;
                if ("pointer" === activation && preparesThematicBreak) {
                    validateThematicBreakTarget(resolvedTarget);
                }
                if ("pointer" === activation && preparesThematicBreak) {
                    try {
                        pointerPreparation = prepareVisualThematicBreakPointerSelection(
                            surface,
                            resolvedTarget,
                        );
                        if (!pointerPreparation) {
                            throw new Error("visual-editor-selection-map-failed");
                        }
                    } catch (error) {
                        return report(error);
                    }
                }
                imageInteraction.select(resolvedTarget, activation);
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
                if (preparesThematicBreak) {
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
                        pointerPreparation?.restore();
                        return report(error);
                    }
                }
				// A keyboard activation has no target element: the feature passes
				// the surface itself, so the generic caret placement below would
				// either fail or move the caret into a descendant and lose the
				// certified parent gap.
				//
				// Precedence:
				// 1. Keep an already-certified exact canonical/native match first.
				// 2. When the native caret is an eligible root gap beside a break
				//    but the canonical caret has not yet been updated (e.g. natural
				//    primary click on an HR), run full ready authentication independently
				//    and enumerate both adjacent direct children. If exactly one
				//    adjacent direct child is a certified editable HR, derive its
				//    canonical selection from its row token and publish it.
				// 3. Ambiguous (two adjacent HRs with no canonical tie-breaker),
				//    foreign, stale, mutated, or spacer shapes fail closed (report and refuse).
				if ("keyboard" === activation) {
					// Native selection check for eligible root gap beside an HR
					const native = surface.ownerDocument.defaultView?.getSelection();
					const nativeRange = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
					const isEligibleRootGap = Boolean(
						native?.isCollapsed
						&& nativeRange?.collapsed
						&& native.anchorNode === surface
						&& native.focusNode === surface
						&& native.anchorOffset === native.focusOffset
						&& (
							surface.childNodes[native.anchorOffset] instanceof HTMLHRElement
							|| surface.childNodes[native.anchorOffset - 1] instanceof HTMLHRElement
						)
					);
					if (isEligibleRootGap && native) {
						try {
							const source = assertReadySourceAndDom();
							const blocks = windowedStructuralBlocks(surface, rangesRef.current);
							const canonicalSelection = documentSession.document.getSelection();
							const canonicalPoint =
								"none" === canonicalSelection.direction &&
								canonicalSelection.start === canonicalSelection.end
									? canonicalSelection.start
									: -1;
							const resolved = resolveVisualStructuralKeyboardContextGap(
								surface,
								source,
								blocks,
								canonicalPoint,
							);
							if (resolved) {
								contextMenuSelectionRef.current =
									captureWindowedStructuralSelection(
										surface,
										rangesRef.current,
										source,
										resolved.selection.start,
									);
								applyDocumentChange({
									selection: resolved.selection,
									value: source,
								});
								regionRef.current = null;
								return true;
							}
							// Ambiguous (e.g. 2 adjacent HRs without canonical tie-breaker),
							// foreign, stale, or mutated: fail closed
							return report(new Error("visual-editor-selection-map-failed"));
						} catch (error) {
							return report(error);
						}
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
						// Same ready certificate as the text and media owners: a
						// gap caret is published only from an authenticated
						// accepted surface, never from tag/ID proof alone.
						const candidate = structuralCandidate();
						if ("rejected" === candidate.kind) {
							return report(new Error("visual-editor-selection-map-failed"));
						}
						if ("certified" === candidate.kind) {
							applyDocumentChange({
								selection: candidate.gap.selection,
								value: candidate.source,
							});
							regionRef.current = null;
							return finishPreparation(true);
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
							region.imageProjection,
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
				if (!active || externalChangeReportedRef.current || pendingRef.current || pendingPropRef.current) return false;
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
			const composition = pendingComposition;
			// Discard the owned draft only while its canonical lease is still
			// current. A newer canonical state already owns the surface, so the old
			// DOM is never restored over it and nothing is serialized here.
			if (
				composition &&
				surface.isConnected &&
				!externalChangeReportedRef.current &&
				documentSession.document.getRevision?.() === composition.revision
			) {
				try { finishPendingCompositionDom(false); } catch (error) { report(error); }
			}
			pendingComposition = null;
			cancelledPendingComposition = true;
			composition?.compositionLease?.release();
			releaseCompositionSurface();
			active = false;
			activeRef.current = false;
			imageInteraction.dispose();
			thematicBreakDeletionHistoryRef.current = [];
			emptyCodeGapRef.current = null;
			ownedGapPresentationRef.current = null;
			emptyCodeGapHistoryRef.current.clear();
			releasePendingHistorySelection(pendingHistorySelectionRef);
			cancelPendingPaste?.();
			cancelPendingPaste = null;
			unsubscribe();
			surface.removeEventListener("beforeinput", handleBeforeInput);
			surface.removeEventListener("pointerdown", handlePendingPointerDown);
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
			surface.ownerDocument.removeEventListener(
				"selectionchange",
				handleDocumentEndSelectionChange,
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
		getAcceptedReferenceSource,
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
		referenceLabelCaseFoldProfile,
		requestPreview,
		requestPreviewAtDocumentEnd,
		retainCompositionSurface,
		surface,
	]);

	return null;
}
