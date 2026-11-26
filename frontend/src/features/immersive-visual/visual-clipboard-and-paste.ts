import {
	Fragment,
	type Node as ProseMirrorNode,
	Slice,
} from "prosemirror-model";
import {
	NodeSelection,
	Plugin,
	PluginKey,
	Selection,
	TextSelection,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import { remapLinkBoundaryKeys } from "./visual-link-boundary-remap";
import { visualEditorSchema } from "./visual-schema";

export type VisualClipboardPluginOptions = Readonly<{
	imagePasteUploadEnabled?: boolean | (() => boolean);
	imageUploadEnabled?: boolean | (() => boolean);
	onImageDrop?: (files: ReadonlyArray<File>, event: DragEvent) => void;
	onImagePaste?: (files: ReadonlyArray<File>, event: ClipboardEvent) => void;
}>;

const VISUAL_CLIPBOARD_PLUGIN_KEY = new PluginKey("easymdeVisualClipboard");

const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:png|jpe?g|jfif|gif|webp)$/i;

const SEMANTIC_HTML_TAG_PATTERN =
	/<\/?(?:h[1-6]|strong|b|em|i|del|s|a|img|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|pre|code|hr)\b/i;

const MARKDOWN_SYNTAX_SIGNAL_PATTERN =
	/(?:^|\n)(?: {0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s|```|~~~|\$\$|---+|\*\*\*+|___+)|\|[^\n]+\|\n\|?[ \t]*:?-{1,}:?[ \t]*\|)|\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\n]+\)/;

function resolveBooleanOption(
	option: boolean | (() => boolean) | undefined,
	defaultValue: boolean,
): boolean {
	if (typeof option === "function") {
		return option();
	}
	return option ?? defaultValue;
}

function isImageFile(file: File): boolean {
	if (file.type.toLowerCase().startsWith("image/")) {
		return true;
	}
	return file.type.length === 0 && IMAGE_FILE_EXTENSION_PATTERN.test(file.name);
}

function extractImageFilesFromDataTransfer(
	dataTransfer: DataTransfer | null,
): File[] {
	if (!dataTransfer) {
		return [];
	}
	const files: File[] = [];
	const seen = new Set<string>();

	const recordFile = (file: File | null): void => {
		if (!file || !isImageFile(file)) {
			return;
		}
		const fingerprint = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
		if (seen.has(fingerprint)) {
			return;
		}
		seen.add(fingerprint);
		files.push(file);
	};

	const items = dataTransfer.items;
	if (items && items.length > 0) {
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			if (item && item.kind === "file") {
				recordFile(item.getAsFile());
			}
		}
	}

	const rawFiles = dataTransfer.files;
	if (rawFiles && rawFiles.length > 0) {
		for (let i = 0; i < rawFiles.length; i += 1) {
			recordFile(rawFiles[i] ?? null);
		}
	}

	return files;
}

function isSelectionInCodeBlock(view: EditorView): boolean {
	return (
		view.state.selection.$from.parent.type ===
		visualEditorSchema.nodes.code_block
	);
}

/**
 * Image files must never be spliced into code blocks or over a selected
 * protected block or inline atom: the upload owner is bypassed and the native
 * handler runs instead so no Markdown is corrupted. Paste evaluates the
 * current selection; drop evaluates the selection resolved at the pointer.
 */
function isBlockedVisualImageSelection(selection: Selection): boolean {
	if (selection.$from.parent.type === visualEditorSchema.nodes.code_block) {
		return true;
	}
	if (!(selection instanceof NodeSelection)) return false;
	const nodeType = selection.node.type;
	return (
		nodeType === visualEditorSchema.nodes.protected_block ||
		nodeType === visualEditorSchema.nodes.protected_inline
	);
}

function isSelectionInsideTableCell(view: EditorView): boolean {
	const { $from } = view.state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const name = $from.node(depth).type.name;
		if (name === "table_cell" || name === "table_header") {
			return true;
		}
	}
	return false;
}

function flattenDocToTableCellFragment(parsedDoc: ProseMirrorNode): Fragment {
	const inlineNodes: ProseMirrorNode[] = [];
	appendTextblockInlineNodes(parsedDoc, inlineNodes);
	return Fragment.from(inlineNodes);
}

/**
 * Flattens every nested textblock into inline content separated by hard breaks.
 * Nested lists and tables pasted into a cell keep their readable text instead of
 * being concatenated into a single run of characters.
 */
function appendTextblockInlineNodes(
	node: ProseMirrorNode,
	out: ProseMirrorNode[],
): void {
	if (node.isTextblock) {
		if (out.length > 0) {
			out.push(visualEditorSchema.nodes.hard_break.create());
		}
		node.content.forEach((child) => {
			out.push(child);
		});
		return;
	}
	node.forEach((child) => {
		appendTextblockInlineNodes(child, out);
	});
}

function isInlineOnly(nodes: ReadonlyArray<ProseMirrorNode>): boolean {
	return nodes.every((node) => node.isInline);
}

function wrapClipboardBlocks(
	nodes: ReadonlyArray<ProseMirrorNode>,
): ProseMirrorNode | null {
	if (nodes.length === 0) return null;
	if (isInlineOnly(nodes)) {
		return visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [...nodes]),
		]);
	}
	// The serializer iterates the wrapper's children, so table slices must be
	// wrapped in `doc` (not a bare `table`) to emit GFM table syntax.
	// `prosemirror-tables` assigns `header_cell` to `table_header`.
	if (nodes.every((node) => node.type.spec.tableRole === "row")) {
		return visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.table.create(null, [...nodes]),
		]);
	}
	if (
		nodes.every((node) => {
			const role = node.type.spec.tableRole;
			return role === "cell" || role === "header_cell";
		})
	) {
		return visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.table.create(null, [
				visualEditorSchema.nodes.table_row.create(null, [...nodes]),
			]),
		]);
	}
	// Whole-table `CellSelection` slices carry the `table` node itself.
	if (
		nodes.every((node) => {
			const role = node.type.spec.tableRole;
			return node.isBlock && (!role || role === "table");
		})
	) {
		return visualEditorSchema.nodes.doc.create(null, [...nodes]);
	}
	return null;
}

/**
 * Plain-text Copy/Cut uses the canonical Markdown serializer so protected math,
 * Mermaid, TOC, footnote, and image atoms keep their Markdown syntax instead of
 * being erased from `text/plain`.
 */
function serializeClipboardSliceToText(slice: Slice): string {
	const nodes: ProseMirrorNode[] = [];
	slice.content.forEach((node) => {
		nodes.push(node);
	});
	const wrapper = wrapClipboardBlocks(nodes);
	if (wrapper) return serializeVisualDocToMarkdown(wrapper);
	return slice.content.textBetween(0, slice.content.size, "\n\n", "\uFFFC");
}

function insertParsedMarkdownDoc(
	view: EditorView,
	markdownText: string,
): boolean {
	const normalized = markdownText.replace(/\r\n?/g, "\n");
	if (normalized.includes("\n") && normalized.trim().length === 0) {
		// A newline-only paste must not delete the selection without inserting
		// anything: commit a hard break through the normal editing path.
		view.dispatch(
			view.state.tr
				.replaceSelectionWith(visualEditorSchema.nodes.hard_break.create())
				.scrollIntoView(),
		);
		return true;
	}
	// A pasted fragment is parsed as its own document: re-key its links so
	// they never merge with an adjacent existing link.
	const freshDoc = parseMarkdownToVisualDoc(normalized);
	const parsedDoc = freshDoc.copy(remapLinkBoundaryKeys(freshDoc.content));

	if (isSelectionInsideTableCell(view)) {
		const cellFragment = flattenDocToTableCellFragment(parsedDoc);
		const slice = new Slice(cellFragment, 0, 0);
		view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
		return true;
	}

	if (
		parsedDoc.childCount === 1 &&
		parsedDoc.firstChild?.type === visualEditorSchema.nodes.paragraph
	) {
		const leadingSpace = /^[ \t]+/.exec(normalized)?.[0] ?? "";
		const trailingSpace = /[ \t]+$/.exec(normalized)?.[0] ?? "";
		let inlineContent = parsedDoc.firstChild.content;
		if (
			leadingSpace.length > 0 &&
			!parsedDoc.firstChild.textContent.startsWith(leadingSpace)
		) {
			inlineContent = Fragment.from(
				visualEditorSchema.text(leadingSpace),
			).append(inlineContent);
		}
		if (
			trailingSpace.length > 0 &&
			normalized.trim().length > 0 &&
			!parsedDoc.firstChild.textContent.endsWith(trailingSpace)
		) {
			inlineContent = inlineContent.append(
				Fragment.from(visualEditorSchema.text(trailingSpace)),
			);
		}
		const inlineSlice = new Slice(inlineContent, 0, 0);
		view.dispatch(view.state.tr.replaceSelection(inlineSlice).scrollIntoView());
		return true;
	}

	const { selection } = view.state;
	const { $from, empty } = selection;
	const isEmptyTopParagraph =
		empty &&
		$from.depth === 1 &&
		$from.parent.type === visualEditorSchema.nodes.paragraph &&
		$from.parent.content.size === 0;

	if (isEmptyTopParagraph) {
		const tr = view.state.tr.replaceWith(
			$from.before(1),
			$from.after(1),
			parsedDoc.content,
		);
		view.dispatch(tr.scrollIntoView());
		return true;
	}

	const blockSlice = new Slice(parsedDoc.content, 0, 0);
	view.dispatch(view.state.tr.replaceSelection(blockSlice).scrollIntoView());
	return true;
}

function shouldTreatAsPlainMarkdownPaste(
	plainText: string,
	htmlData: string,
): boolean {
	if (plainText.length === 0) {
		return false;
	}
	const trimmedHtml = htmlData.trim();
	if (trimmedHtml.length === 0) {
		return true;
	}
	return (
		!SEMANTIC_HTML_TAG_PATTERN.test(trimmedHtml) &&
		MARKDOWN_SYNTAX_SIGNAL_PATTERN.test(plainText)
	);
}

/** Maps the DOM selection to a ProseMirror selection without dispatching it. */
function readDomSelection(view: EditorView): Selection | null {
	const domSelection = view.dom.ownerDocument.defaultView?.getSelection();
	if (!domSelection || domSelection.rangeCount === 0) {
		return null;
	}
	const range = domSelection.getRangeAt(0);
	if (
		!view.dom.contains(range.startContainer) ||
		!view.dom.contains(range.endContainer)
	) {
		return null;
	}
	try {
		const from = view.posAtDOM(range.startContainer, range.startOffset);
		const to = view.posAtDOM(range.endContainer, range.endOffset);
		if (
			from >= 0 &&
			to >= 0 &&
			from <= view.state.doc.content.size &&
			to <= view.state.doc.content.size
		) {
			return TextSelection.create(view.state.doc, from, to);
		}
	} catch {
		// Keep current ProseMirror selection when DOM range cannot be mapped.
	}
	return null;
}

function syncDomSelectionIntoView(view: EditorView): void {
	const nextSelection = readDomSelection(view);
	if (nextSelection && !nextSelection.eq(view.state.selection)) {
		view.dispatch(view.state.tr.setSelection(nextSelection));
	}
}

function readTransferData(
	transfer: DataTransfer | null | undefined,
	type: string,
): string {
	if (!transfer || typeof transfer.getData !== "function") {
		return "";
	}
	return transfer.getData(type) ?? "";
}

const IMAGE_TAG_PATTERN = /<img\b/i;

type ImageDropTarget =
	| Readonly<{ kind: "blocked" }>
	| Readonly<{ kind: "ready"; selection: Selection }>
	| Readonly<{ kind: "none" }>;

const PROTECTED_DROP_TARGET_SELECTOR =
	"[data-easymde-protected-kind], [data-easymde-protected-block], [data-easymde-protected-inline], .easymde-code-block";

function isDropBlockedNode(node: ProseMirrorNode | null | undefined): boolean {
	if (!node) return false;
	const type = node.type;
	return (
		type === visualEditorSchema.nodes.code_block ||
		type === visualEditorSchema.nodes.protected_block ||
		type === visualEditorSchema.nodes.protected_inline
	);
}

/** Whether the node actually hit by the pointer (or an ancestor) is protected. */
function isProtectedHit(doc: ProseMirrorNode, inside: number): boolean {
	if (inside < 0 || inside > doc.content.size) return false;
	if (isDropBlockedNode(doc.nodeAt(inside))) return true;
	const $inside = doc.resolve(inside);
	for (let depth = $inside.depth; depth >= 1; depth -= 1) {
		if (isDropBlockedNode($inside.node(depth))) return true;
	}
	return false;
}

function readDropCoords(
	view: EditorView,
	event: DragEvent,
): ReturnType<EditorView["posAtCoords"]> {
	if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
		return null;
	}
	try {
		return view.posAtCoords({ left: event.clientX, top: event.clientY });
	} catch {
		return null;
	}
}

/**
 * Resolves where a drop lands without mutating editor state. Priority: a DOM
 * target inside protected content, the node actually hit by the pointer
 * (`coords.inside`), the pointer insertion position, and only without pointer
 * coordinates the DOM or current selection. The eligibility check evaluates
 * this target, never the pre-drop caret.
 */
function resolveImageDropSelection(
	view: EditorView,
	event: DragEvent,
): ImageDropTarget {
	const target = event.target;
	const protectedTarget =
		typeof Element !== "undefined" && target instanceof Element
			? target.closest(PROTECTED_DROP_TARGET_SELECTOR)
			: null;
	if (protectedTarget !== null && view.dom.contains(protectedTarget)) {
		return { kind: "blocked" };
	}
	const doc = view.state.doc;
	const coords = readDropCoords(view, event);
	if (coords) {
		if (isProtectedHit(doc, coords.inside)) {
			return { kind: "blocked" };
		}
		if (coords.pos < 0 || coords.pos > doc.content.size) {
			return { kind: "none" };
		}
		const selection = Selection.near(doc.resolve(coords.pos));
		return isBlockedVisualImageSelection(selection)
			? { kind: "blocked" }
			: { kind: "ready", selection };
	}
	const fallback = readDomSelection(view) ?? view.state.selection;
	return isBlockedVisualImageSelection(fallback)
		? { kind: "blocked" }
		: { kind: "ready", selection: fallback };
}

function applyImageDropSelection(view: EditorView, target: Selection): void {
	if (!target.eq(view.state.selection)) {
		view.dispatch(view.state.tr.setSelection(target));
	}
	// Focus only after the drop selection exists: the upload owner reads the DOM
	// selection, and focusing first would commit a stale one over it.
	view.focus();
}

export function createVisualClipboardPlugin(
	options: VisualClipboardPluginOptions = {},
): Plugin {
	const handleImageFilesPaste = (
		view: EditorView,
		event: ClipboardEvent,
		data: DataTransfer,
	): boolean | null => {
		const imageFiles = extractImageFilesFromDataTransfer(data);
		if (imageFiles.length === 0) return null;
		if (isBlockedVisualImageSelection(view.state.selection)) return false;
		const uploadEnabled = resolveBooleanOption(
			options.imageUploadEnabled,
			false,
		);
		const pasteUploadEnabled = resolveBooleanOption(
			options.imagePasteUploadEnabled,
			false,
		);
		if (!uploadEnabled || !pasteUploadEnabled || !options.onImagePaste) {
			return false;
		}
		syncDomSelectionIntoView(view);
		event.preventDefault();
		options.onImagePaste(imageFiles, event);
		return true;
	};

	const handleImageFilesDrop = (
		view: EditorView,
		event: DragEvent,
		data: DataTransfer | null,
	): boolean | null => {
		const imageFiles = extractImageFilesFromDataTransfer(data);
		if (imageFiles.length === 0) return null;
		const uploadEnabled = resolveBooleanOption(
			options.imageUploadEnabled,
			false,
		);
		if (!uploadEnabled || !options.onImageDrop) return false;
		const resolved = resolveImageDropSelection(view, event);
		if (resolved.kind !== "ready") return false;
		event.preventDefault();
		applyImageDropSelection(view, resolved.selection);
		options.onImageDrop(imageFiles, event);
		return true;
	};

	return new Plugin({
		key: VISUAL_CLIPBOARD_PLUGIN_KEY,
		props: {
			clipboardTextSerializer(slice) {
				return serializeClipboardSliceToText(slice);
			},

			handleDOMEvents: {
				paste(view, event) {
					if (!view.editable) {
						return false;
					}
					const clipboardData = event.clipboardData;
					if (!clipboardData) {
						return false;
					}
					const pasteResult = handleImageFilesPaste(view, event, clipboardData);
					if (pasteResult !== null) {
						return pasteResult;
					}

					const plainText = readTransferData(clipboardData, "text/plain");
					const htmlData = readTransferData(clipboardData, "text/html");
					const uploadEnabled = resolveBooleanOption(
						options.imageUploadEnabled,
						false,
					);
					if (
						!uploadEnabled &&
						plainText.length > 0 &&
						IMAGE_TAG_PATTERN.test(htmlData) &&
						!isSelectionInCodeBlock(view)
					) {
						syncDomSelectionIntoView(view);
						event.preventDefault();
						return insertParsedMarkdownDoc(view, plainText);
					}
					return false;
				},

				drop(view, event) {
					if (!view.editable) {
						return false;
					}
					const dataTransfer = event.dataTransfer;
					if (!dataTransfer) {
						return false;
					}
					const dropResult = handleImageFilesDrop(view, event, dataTransfer);
					if (dropResult !== null) {
						return dropResult;
					}

					const plainText = readTransferData(dataTransfer, "text/plain");
					const htmlData = readTransferData(dataTransfer, "text/html");
					const uploadEnabled = resolveBooleanOption(
						options.imageUploadEnabled,
						false,
					);
					if (
						!uploadEnabled &&
						plainText.length > 0 &&
						IMAGE_TAG_PATTERN.test(htmlData) &&
						!isSelectionInCodeBlock(view)
					) {
						syncDomSelectionIntoView(view);
						event.preventDefault();
						return insertParsedMarkdownDoc(view, plainText);
					}
					return false;
				},
			},

			handlePaste(view, event) {
				if (!view.editable) {
					return false;
				}
				const clipboardData = event.clipboardData;
				if (!clipboardData) {
					return false;
				}

				const pasteResult = handleImageFilesPaste(view, event, clipboardData);
				if (pasteResult !== null) {
					return pasteResult;
				}

				const plainText = readTransferData(clipboardData, "text/plain");
				if (isSelectionInCodeBlock(view)) {
					if (plainText.length === 0) {
						return false;
					}
					syncDomSelectionIntoView(view);
					event.preventDefault();
					const normalizedCode = plainText.replace(/\r\n?/g, "\n");
					view.dispatch(
						view.state.tr.insertText(normalizedCode).scrollIntoView(),
					);
					return true;
				}

				const htmlData = readTransferData(clipboardData, "text/html");
				if (!shouldTreatAsPlainMarkdownPaste(plainText, htmlData)) {
					return false;
				}

				syncDomSelectionIntoView(view);
				event.preventDefault();
				return insertParsedMarkdownDoc(view, plainText);
			},

			handleDrop(view, event) {
				if (!view.editable) {
					return false;
				}
				const dropResult = handleImageFilesDrop(
					view,
					event,
					event.dataTransfer,
				);
				return dropResult === true;
			},
		},
	});
}
