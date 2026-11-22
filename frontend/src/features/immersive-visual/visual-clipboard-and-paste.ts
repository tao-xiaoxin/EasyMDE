import { Fragment, type Node as ProseMirrorNode, Slice } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
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

export function extractImageFilesFromDataTransfer(
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
		view.state.selection.$from.parent.type === visualEditorSchema.nodes.code_block
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
	const hardBreakType = visualEditorSchema.nodes.hard_break;

	for (let i = 0; i < parsedDoc.childCount; i += 1) {
		if (i > 0) {
			inlineNodes.push(hardBreakType.create());
		}
		const block = parsedDoc.child(i);
		if (block.isTextblock) {
			block.content.forEach((child) => {
				inlineNodes.push(child);
			});
		} else {
			const fallbackText = block.textContent;
			if (fallbackText.length > 0) {
				inlineNodes.push(visualEditorSchema.text(fallbackText));
			}
		}
	}

	return Fragment.from(inlineNodes);
}

function insertParsedMarkdownDoc(
	view: EditorView,
	markdownText: string,
): boolean {
	const normalized = markdownText.replace(/\r\n?/g, "\n");
	const parsedDoc = parseMarkdownToVisualDoc(normalized);

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
			inlineContent = Fragment.from(visualEditorSchema.text(leadingSpace)).append(
				inlineContent,
			);
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

function syncDomSelectionIntoView(view: EditorView): void {
	const domSelection = view.dom.ownerDocument.defaultView?.getSelection();
	if (!domSelection || domSelection.rangeCount === 0) {
		return;
	}
	const range = domSelection.getRangeAt(0);
	if (
		!view.dom.contains(range.startContainer) ||
		!view.dom.contains(range.endContainer)
	) {
		return;
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
			const nextSelection = TextSelection.create(view.state.doc, from, to);
			if (!nextSelection.eq(view.state.selection)) {
				view.dispatch(view.state.tr.setSelection(nextSelection));
			}
		}
	} catch {
		// Keep current ProseMirror selection when DOM range cannot be mapped.
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

export function createVisualClipboardPlugin(
	options: VisualClipboardPluginOptions = {},
): Plugin {
	return new Plugin({
		key: VISUAL_CLIPBOARD_PLUGIN_KEY,
		props: {
			handleDOMEvents: {
				paste(view, event) {
					if (!view.editable) {
						return false;
					}
					const clipboardData = event.clipboardData;
					if (!clipboardData) {
						return false;
					}
					const imageFiles = extractImageFilesFromDataTransfer(clipboardData);
					if (imageFiles.length > 0) {
						const uploadEnabled = resolveBooleanOption(
							options.imageUploadEnabled,
							false,
						);
						const pasteUploadEnabled = resolveBooleanOption(
							options.imagePasteUploadEnabled,
							false,
						);
						if (uploadEnabled && pasteUploadEnabled && options.onImagePaste) {
							syncDomSelectionIntoView(view);
							event.preventDefault();
							options.onImagePaste(imageFiles, event);
							return true;
						}
						return false;
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
						IMAGE_TAG_PATTERN.test(htmlData)
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
					const imageFiles = extractImageFilesFromDataTransfer(dataTransfer);
					const uploadEnabled = resolveBooleanOption(
						options.imageUploadEnabled,
						true,
					);
					if (imageFiles.length > 0) {
						if (!uploadEnabled || !options.onImageDrop) {
							return false;
						}
						event.preventDefault();
						let positioned = false;
						if (
							Number.isFinite(event.clientX) &&
							Number.isFinite(event.clientY)
						) {
							const coords = view.posAtCoords({
								left: event.clientX,
								top: event.clientY,
							});
							if (
								coords &&
								coords.pos >= 0 &&
								coords.pos <= view.state.doc.content.size
							) {
								const dropSelection = Selection.near(
									view.state.doc.resolve(coords.pos),
								);
								view.dispatch(view.state.tr.setSelection(dropSelection));
								positioned = true;
							}
						}
						if (!positioned) {
							syncDomSelectionIntoView(view);
						}
						options.onImageDrop(imageFiles, event);
						return true;
					}

					const plainText = readTransferData(dataTransfer, "text/plain");
					const htmlData = readTransferData(dataTransfer, "text/html");
					if (
						!uploadEnabled &&
						plainText.length > 0 &&
						IMAGE_TAG_PATTERN.test(htmlData)
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

				const imageFiles = extractImageFilesFromDataTransfer(clipboardData);
				if (imageFiles.length > 0) {
					const uploadEnabled = resolveBooleanOption(
						options.imageUploadEnabled,
						false,
					);
					const pasteUploadEnabled = resolveBooleanOption(
						options.imagePasteUploadEnabled,
						false,
					);
					if (uploadEnabled && pasteUploadEnabled && options.onImagePaste) {
						syncDomSelectionIntoView(view);
						event.preventDefault();
						options.onImagePaste(imageFiles, event);
						return true;
					}
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
				const imageFiles = extractImageFilesFromDataTransfer(event.dataTransfer);
				if (imageFiles.length === 0) {
					return false;
				}
				const uploadEnabled = resolveBooleanOption(
					options.imageUploadEnabled,
					true,
				);
				if (!uploadEnabled || !options.onImageDrop) {
					return false;
				}

				event.preventDefault();
				if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
					const coords = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					if (coords && coords.pos >= 0 && coords.pos <= view.state.doc.content.size) {
						const dropSelection = Selection.near(
							view.state.doc.resolve(coords.pos),
						);
						view.dispatch(view.state.tr.setSelection(dropSelection));
					}
				}
				options.onImageDrop(imageFiles, event);
				return true;
			},
		},
	});
}
