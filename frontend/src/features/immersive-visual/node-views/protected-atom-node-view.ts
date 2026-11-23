import { closeHistory } from "prosemirror-history";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type {
	EditorView,
	NodeView,
	NodeViewConstructor,
} from "prosemirror-view";
import {
	normalizeProtectedBlockKind,
	normalizeProtectedInlineKind,
	type ProtectedBlockKind,
	type ProtectedInlineKind,
} from "../visual-schema";
import {
	copyTextToClipboard,
	createAtomButton,
	createAtomElement,
	ensureMermaidInitialized,
	MONOSPACE_FONT,
	ProtectedCardEditor,
	sanitizeMermaidSvg,
	subscribePreviewRuntimeReady,
	subscribeVisualEditableState,
} from "./protected-atom-card-editor";

export {
	PREVIEW_RUNTIME_READY_EVENT,
	type RuntimeReadySubscription,
	sanitizeMermaidSvg,
	subscribePreviewRuntimeReady,
} from "./protected-atom-card-editor";

export type KatexRenderOptions = Readonly<{
	displayMode: boolean;
	strict: string;
	throwOnError: boolean;
}>;
export type KatexRuntime = Readonly<{
	render: (
		tex: string,
		element: HTMLElement,
		options: KatexRenderOptions,
	) => void;
}>;
export type MermaidRenderResult = Readonly<{ svg: string }>;
export type MermaidRuntime = Readonly<{
	initialize?: (options: Record<string, unknown>) => void;
	render: (
		id: string,
		source: string,
	) => Promise<MermaidRenderResult> | MermaidRenderResult;
}>;
export type ProtectedAtomLabels = Readonly<{
	cancel?: string;
	copied?: string;
	copy?: string;
	edit?: string;
	footnotes?: string;
	math?: string;
	mermaid?: string;
	raw?: string;
	save?: string;
	toc?: string;
}>;
/** Localized format templates; `{kind}` expands to the localized kind label. */
export type ProtectedAtomLabelTemplates = Readonly<{
	copy?: string;
	edit?: string;
	source?: string;
}>;
export type ProtectedAtomNodeViewOptions = Readonly<{
	getKatex?: () => KatexRuntime | null | undefined;
	getMermaid?: () => MermaidRuntime | null | undefined;
	labelTemplates?: ProtectedAtomLabelTemplates;
	labels?: ProtectedAtomLabels;
}>;

/** Transaction meta marking a discrete protected-card commit boundary. */
export const PROTECTED_CARD_COMMIT_META = "easymdeProtectedCardCommit";

type ProtectedEnhancementWindow = Window & {
	katex?: KatexRuntime;
	mermaid?: MermaidRuntime;
};
type ProtectedAtomKind = ProtectedBlockKind | ProtectedInlineKind;

const DEFAULT_LABELS: Required<ProtectedAtomLabels> = {
	cancel: "Cancel",
	copied: "Copied",
	copy: "Copy",
	edit: "Edit",
	footnotes: "Footnotes",
	math: "Math",
	mermaid: "Mermaid",
	raw: "Raw",
	save: "Save",
	toc: "TOC",
};
const DEFAULT_LABEL_TEMPLATES: Required<ProtectedAtomLabelTemplates> = {
	copy: "Copy {kind}",
	edit: "Edit {kind}",
	source: "{kind} source",
};
const COPY_FEEDBACK_DURATION_MS = 1600;
const ROOT_KIND_CLASSES: Record<ProtectedAtomKind, string> = {
	math: "easymde-protected-block",
	mermaid: "easymde-protected-block",
	toc: "easymde-protected-block easymde-toc",
	footnotes: "easymde-protected-block easymde-footnotes",
	raw: "easymde-protected-block",
	"math-inline": "easymde-protected-inline",
	"footnote-ref": "easymde-protected-inline easymde-footnote-ref",
	"raw-inline": "easymde-protected-inline",
};
/**
 * Generated-content marker classes live on the clean preview element so
 * `.easymde-math > .katex | .katex-display > .katex` parity holds for MathML
 * extraction and PNG clones never capture card chrome.
 */
const PREVIEW_KIND_CLASSES: Record<ProtectedAtomKind, string> = {
	math: " easymde-math easymde-math-block",
	mermaid: " easymde-mermaid",
	toc: "",
	footnotes: "",
	raw: "",
	"math-inline": " easymde-math easymde-math-inline",
	"footnote-ref": "",
	"raw-inline": "",
};
const GENERATED_MARKER_KINDS = new Set<ProtectedAtomKind>([
	"math",
	"mermaid",
	"math-inline",
]);
const KIND_LABEL_KEY: Record<ProtectedAtomKind, keyof ProtectedAtomLabels> = {
	math: "math",
	"math-inline": "math",
	mermaid: "mermaid",
	toc: "toc",
	footnotes: "footnotes",
	"footnote-ref": "footnotes",
	raw: "raw",
	"raw-inline": "raw",
};
let mermaidRenderSequence = 0;

export function extractBlockMathTex(rawMarkdown: string): string {
	const trimmed = rawMarkdown.trim();
	const fenced =
		trimmed.length >= 4 &&
		((trimmed.startsWith("$$") && trimmed.endsWith("$$")) ||
			(trimmed.startsWith("\\[") && trimmed.endsWith("\\]")));
	return fenced ? trimmed.slice(2, -2).trim() : trimmed;
}

export function extractInlineMathTex(rawMarkdown: string): string {
	const trimmed = rawMarkdown.trim();
	if (
		trimmed.startsWith("\\(") &&
		trimmed.endsWith("\\)") &&
		trimmed.length >= 4
	) {
		return trimmed.slice(2, -2).trim();
	}
	if (
		trimmed.startsWith("$") &&
		trimmed.endsWith("$") &&
		!trimmed.startsWith("$$") &&
		trimmed.length >= 2
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

export function extractMermaidSource(rawMarkdown: string): string {
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n").trim();
	if (normalized.length === 0) return "";
	const lines = normalized.split("\n");
	const opener = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid\b.*$/i.exec(lines[0] ?? "");
	if (!opener?.[1]) return normalized;
	const closerPattern =
		opener[1][0] === "~" ? /^ {0,3}(~{3,})[ \t]*$/ : /^ {0,3}(`{3,})[ \t]*$/;
	const closer =
		lines.length > 1 ? closerPattern.exec(lines[lines.length - 1] ?? "") : null;
	const hasCloser = Boolean(
		closer?.[1] && closer[1].length >= opener[1].length,
	);
	return lines
		.slice(1, hasCloser ? lines.length - 1 : lines.length)
		.join("\n")
		.trim();
}

function resolveRuntime<K extends "katex" | "mermaid">(
	key: K,
	getter?: () => ProtectedEnhancementWindow[K] | null | undefined,
): NonNullable<ProtectedEnhancementWindow[K]> | null {
	const candidate = getter
		? getter()
		: typeof window !== "undefined"
			? (window as ProtectedEnhancementWindow)[key]
			: null;
	return candidate && typeof candidate.render === "function"
		? (candidate as NonNullable<ProtectedEnhancementWindow[K]>)
		: null;
}

function readRawMarkdown(node: ProseMirrorNode): string {
	return typeof node.attrs.rawMarkdown === "string"
		? node.attrs.rawMarkdown
		: "";
}

function formatLabel(template: string, kindLabel: string): string {
	return template.split("{kind}").join(kindLabel);
}

function resolveAtomPosition(
	getPos: () => number | undefined,
	view: EditorView,
	expectedTypeName: string,
): number | null {
	let pos: number | undefined;
	try {
		pos = getPos();
	} catch {
		return null;
	}
	if (
		typeof pos !== "number" ||
		!Number.isInteger(pos) ||
		pos < 0 ||
		pos >= view.state.doc.content.size
	) {
		return null;
	}
	const current = view.state.doc.nodeAt(pos);
	return current && current.type.name === expectedTypeName ? pos : null;
}

class ProtectedAtomNodeView implements NodeView {
	readonly dom: HTMLElement;
	private readonly isBlock: boolean;
	private node: ProseMirrorNode;
	private readonly view: EditorView;
	private readonly getPos: () => number | undefined;
	private readonly options: ProtectedAtomNodeViewOptions;
	private readonly labels: Required<ProtectedAtomLabels>;
	private readonly templates: Required<ProtectedAtomLabelTemplates>;
	private readonly previewContainer: HTMLElement;
	private readonly cardActions: HTMLDivElement | null = null;
	private readonly editButton: HTMLButtonElement | null = null;
	private readonly copyButton: HTMLButtonElement | null = null;
	private readonly cardActionsCleanup: (() => void) | null = null;
	private cardEditor: ProtectedCardEditor | null = null;
	private editing = false;
	private selected = false;
	private destroyed = false;
	private renderGeneration = 0;
	private copyGeneration = 0;
	private copyResetTimer: ReturnType<typeof setTimeout> | null = null;
	private runtimeReadyUnsubscribe: (() => void) | null = null;
	private readonly unsubscribeEditable: () => void;
	private readonly onDoubleClick: (event: MouseEvent) => void;
	private readonly onMouseDown: (event: MouseEvent) => void;

	constructor(
		node: ProseMirrorNode,
		view: EditorView,
		getPos: () => number | undefined,
		isBlock: boolean,
		options: ProtectedAtomNodeViewOptions,
	) {
		this.node = node;
		this.view = view;
		this.getPos = getPos;
		this.isBlock = isBlock;
		this.options = options;
		this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
		this.templates = {
			...DEFAULT_LABEL_TEMPLATES,
			...(options.labelTemplates ?? {}),
		};

		const doc = view.dom.ownerDocument;
		this.dom = doc.createElement(isBlock ? "div" : "span");
		this.dom.setAttribute("contenteditable", "false");
		this.dom.setAttribute(
			isBlock
				? "data-easymde-protected-block"
				: "data-easymde-protected-inline",
			"1",
		);

		if (isBlock) {
			const cardActions = createAtomElement(
				doc,
				"div",
				"easymde-protected-card-actions",
			);
			cardActions.setAttribute("contenteditable", "false");
			cardActions.setAttribute("data-easymde-protected-ui", "1");
			cardActions.setAttribute("aria-hidden", "false");
			const editButton = createAtomButton(
				doc,
				"easymde-protected-edit-btn",
				this.labels.edit,
			);
			const copyButton = createAtomButton(
				doc,
				"easymde-protected-copy-btn",
				this.labels.copy,
			);
			const onEditClick = (event: MouseEvent): void => {
				event.preventDefault();
				event.stopPropagation();
				if (this.destroyed || this.editing || !this.view.editable) return;
				this.openRawEditor();
			};
			const onCopyClick = (event: MouseEvent): void => {
				event.preventDefault();
				event.stopPropagation();
				if (this.destroyed) return;
				this.copyRawMarkdown();
			};
			const stopActionMouseDown = (event: MouseEvent): void => {
				event.stopPropagation();
			};
			editButton.addEventListener("mousedown", stopActionMouseDown);
			copyButton.addEventListener("mousedown", stopActionMouseDown);
			editButton.addEventListener("click", onEditClick);
			copyButton.addEventListener("click", onCopyClick);
			cardActions.append(editButton, copyButton);
			this.dom.appendChild(cardActions);
			this.cardActions = cardActions;
			this.editButton = editButton;
			this.copyButton = copyButton;
			this.cardActionsCleanup = () => {
				editButton.removeEventListener("mousedown", stopActionMouseDown);
				copyButton.removeEventListener("mousedown", stopActionMouseDown);
				editButton.removeEventListener("click", onEditClick);
				copyButton.removeEventListener("click", onCopyClick);
			};
		}

		this.previewContainer = createAtomElement(
			doc,
			isBlock ? "div" : "span",
			"easymde-protected-preview",
		);
		this.previewContainer.setAttribute("contenteditable", "false");
		this.dom.appendChild(this.previewContainer);

		this.onDoubleClick = (event: MouseEvent) => {
			if (
				this.destroyed ||
				this.editing ||
				!this.view.editable ||
				(this.cardActions &&
					event.target instanceof Node &&
					this.cardActions.contains(event.target))
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.openRawEditor();
		};
		this.dom.addEventListener("dblclick", this.onDoubleClick);
		this.onMouseDown = (event: MouseEvent) => {
			if (!this.isPreviewPointerEvent(event)) return;
			event.preventDefault();
			this.selectInEditor();
		};
		if (isBlock) this.dom.addEventListener("mousedown", this.onMouseDown);
		this.unsubscribeEditable = subscribeVisualEditableState(view, () => {
			if (!this.destroyed) this.syncRootAttributes();
		});
		this.syncRootAttributes();
		this.renderPreview();
	}

	/**
	 * Left-button pointer events on a block card's non-editing preview
	 * surface (outside its action buttons and raw editor).
	 */
	private isPreviewPointerEvent(event: Event): boolean {
		if (!this.isBlock || this.destroyed || this.editing) return false;
		if (!(event instanceof MouseEvent) || event.button !== 0) return false;
		const target = event.target instanceof Node ? event.target : null;
		return !(
			(target && this.cardActions?.contains(target)) ||
			(target && this.cardEditor?.element.contains(target))
		);
	}

	/**
	 * Selects the card explicitly as a NodeSelection (matching ImageNodeView)
	 * instead of relying on native click resolution around uneditable DOM.
	 */
	private selectInEditor(): void {
		const pos = resolveAtomPosition(
			this.getPos,
			this.view,
			this.node.type.name,
		);
		if (pos === null) return;
		const current = this.view.state.selection;
		if (!(current instanceof NodeSelection && current.from === pos)) {
			this.view.dispatch(
				this.view.state.tr.setSelection(
					NodeSelection.create(this.view.state.doc, pos),
				),
			);
		}
		if (this.view.editable && !this.view.hasFocus()) this.view.focus();
	}

	private currentKind(): ProtectedAtomKind {
		return this.isBlock
			? normalizeProtectedBlockKind(this.node.attrs.kind)
			: normalizeProtectedInlineKind(this.node.attrs.kind);
	}

	private readLiveRawMarkdown(): string {
		const pos = resolveAtomPosition(
			this.getPos,
			this.view,
			this.node.type.name,
		);
		const liveNode = pos !== null ? this.view.state.doc.nodeAt(pos) : null;
		return liveNode && liveNode.type === this.node.type
			? readRawMarkdown(liveNode)
			: readRawMarkdown(this.node);
	}

	private resetCopyFeedback(): void {
		this.copyGeneration += 1;
		if (this.copyResetTimer !== null) {
			clearTimeout(this.copyResetTimer);
			this.copyResetTimer = null;
		}
		if (this.copyButton) {
			this.copyButton.textContent = this.labels.copy;
			this.copyButton.classList.remove("is-copied");
			this.copyButton.removeAttribute("data-easymde-copied");
		}
	}

	private showCopiedFeedback(): void {
		if (!this.copyButton) return;
		if (this.copyResetTimer !== null) {
			clearTimeout(this.copyResetTimer);
			this.copyResetTimer = null;
		}
		this.copyButton.textContent = this.labels.copied;
		this.copyButton.classList.add("is-copied");
		this.copyButton.setAttribute("data-easymde-copied", "1");
		this.copyResetTimer = setTimeout(() => {
			this.copyResetTimer = null;
			if (this.destroyed || !this.copyButton) return;
			this.copyButton.textContent = this.labels.copy;
			this.copyButton.classList.remove("is-copied");
			this.copyButton.removeAttribute("data-easymde-copied");
		}, COPY_FEEDBACK_DURATION_MS);
	}

	private copyRawMarkdown(): void {
		const rawMarkdown = this.readLiveRawMarkdown();
		this.copyGeneration += 1;
		const generation = this.copyGeneration;
		void copyTextToClipboard(rawMarkdown, this.dom.ownerDocument).then(
			(copied) => {
				if (
					!copied ||
					this.destroyed ||
					this.editing ||
					this.copyGeneration !== generation ||
					!this.copyButton
				) {
					return;
				}
				this.showCopiedFeedback();
			},
		);
	}

	private syncRootAttributes(): void {
		const kind = this.currentKind();
		const kindLabel = this.labels[KIND_LABEL_KEY[kind]];
		this.dom.className = ROOT_KIND_CLASSES[kind];
		this.dom.setAttribute("data-easymde-protected-kind", kind);
		this.dom.setAttribute(
			"data-easymde-visual-markdown-source",
			readRawMarkdown(this.node),
		);
		this.previewContainer.className = `easymde-protected-preview${PREVIEW_KIND_CLASSES[kind]}`;
		if (GENERATED_MARKER_KINDS.has(kind)) {
			this.previewContainer.setAttribute(
				"data-easymde-visual-markdown-source",
				readRawMarkdown(this.node),
			);
		} else {
			this.previewContainer.removeAttribute(
				"data-easymde-visual-markdown-source",
			);
		}
		if (this.editing) {
			this.dom.classList.add("easymde-protected-editing");
			this.dom.setAttribute("data-easymde-protected-editing", "1");
		} else {
			this.dom.classList.remove("easymde-protected-editing");
			this.dom.removeAttribute("data-easymde-protected-editing");
		}
		if (this.cardActions) {
			this.cardActions.hidden = this.editing;
			if (this.editing) {
				this.cardActions.style.display = "none";
			} else {
				this.cardActions.style.removeProperty("display");
			}
		}
		if (this.editButton) {
			const editLabel = formatLabel(this.templates.edit, kindLabel);
			this.editButton.setAttribute("aria-label", editLabel);
			this.editButton.title = editLabel;
			this.editButton.disabled = this.destroyed || !this.view.editable;
		}
		if (this.copyButton) {
			const copyLabel = formatLabel(this.templates.copy, kindLabel);
			this.copyButton.setAttribute("aria-label", copyLabel);
			this.copyButton.title = copyLabel;
		}
		this.applySelectionVisuals();
	}

	private applySelectionVisuals(): void {
		if (this.selected) {
			this.dom.classList.add(
				"easymde-protected-selected",
				"ProseMirror-selectednode",
			);
			this.dom.setAttribute("data-easymde-protected-selected", "1");
			Object.assign(this.dom.style, {
				outline: "2px solid rgba(34, 113, 177, 0.45)",
				outlineOffset: "2px",
			});
			return;
		}
		this.dom.classList.remove(
			"easymde-protected-selected",
			"ProseMirror-selectednode",
		);
		this.dom.removeAttribute("data-easymde-protected-selected");
		this.dom.style.removeProperty("outline");
		this.dom.style.removeProperty("outline-offset");
	}

	private renderMonospaceFallback(text: string): void {
		const doc = this.dom.ownerDocument;
		const code = createAtomElement(
			doc,
			"code",
			"easymde-protected-fallback",
			text,
		);
		code.style.fontFamily = MONOSPACE_FONT;
		if (!this.isBlock) {
			this.previewContainer.replaceChildren(code);
			return;
		}
		const pre = createAtomElement(doc, "pre", "easymde-protected-fallback-pre");
		Object.assign(pre.style, { margin: "0", whiteSpace: "pre-wrap" });
		pre.appendChild(code);
		this.previewContainer.replaceChildren(pre);
	}

	private renderCardPreview(
		kind: ProtectedAtomKind,
		rawMarkdown: string,
	): void {
		const doc = this.dom.ownerDocument;
		if (!this.isBlock) {
			this.previewContainer.replaceChildren(
				createAtomElement(
					doc,
					"span",
					"easymde-protected-inline-card",
					rawMarkdown,
				),
			);
			return;
		}
		const card = createAtomElement(doc, "div", "easymde-protected-card");
		const badge = createAtomElement(
			doc,
			"span",
			"easymde-protected-card-label",
			this.labels[KIND_LABEL_KEY[kind]],
		);
		const body = createAtomElement(
			doc,
			"pre",
			"easymde-protected-card-source",
			rawMarkdown,
		);
		Object.assign(body.style, { margin: "4px 0 0", whiteSpace: "pre-wrap" });
		card.append(badge, body);
		this.previewContainer.replaceChildren(card);
	}

	private renderMathPreview(displayMode: boolean, rawMarkdown: string): void {
		const tex = displayMode
			? extractBlockMathTex(rawMarkdown)
			: extractInlineMathTex(rawMarkdown);
		const katex = resolveRuntime("katex", this.options.getKatex);
		if (!katex || tex.length === 0) {
			this.renderMonospaceFallback(rawMarkdown);
			if (!katex) this.subscribeRuntimeReady();
			return;
		}
		this.previewContainer.replaceChildren();
		try {
			// Render into the `.easymde-math` element itself so `.katex`
			// (inline) or `.katex-display > .katex` (block) is a direct child,
			// matching the formal Preview DOM and MathML/PNG export contracts.
			katex.render(tex, this.previewContainer, {
				displayMode,
				throwOnError: false,
				strict: "ignore",
			});
			this.dom.setAttribute("data-easymde-rendered", "1");
			this.unsubscribeRuntimeReady();
		} catch {
			this.dom.classList.add("easymde-render-error");
			this.renderMonospaceFallback(rawMarkdown);
		}
	}

	private renderMermaidPreview(rawMarkdown: string, generation: number): void {
		const source = extractMermaidSource(rawMarkdown);
		const mermaid = resolveRuntime("mermaid", this.options.getMermaid);
		this.renderMonospaceFallback(source.length > 0 ? source : rawMarkdown);
		if (!mermaid || source.length === 0) {
			if (!mermaid) this.subscribeRuntimeReady();
			return;
		}
		this.unsubscribeRuntimeReady();
		ensureMermaidInitialized(mermaid);
		mermaidRenderSequence += 1;
		const renderId = `easymde-visual-mermaid-${mermaidRenderSequence}`;

		Promise.resolve()
			.then(() => mermaid.render(renderId, source))
			.then((result) => {
				if (
					this.destroyed ||
					this.editing ||
					this.renderGeneration !== generation
				)
					return;
				const safeSvg = sanitizeMermaidSvg(
					typeof result?.svg === "string" ? result.svg : "",
					this.dom.ownerDocument,
				);
				if (!safeSvg) {
					this.dom.classList.add("easymde-render-error");
					return;
				}
				this.dom.classList.remove("easymde-render-error");
				this.dom.setAttribute("data-easymde-rendered", "1");
				this.previewContainer.replaceChildren(safeSvg);
			})
			.catch(() => {
				if (
					!this.destroyed &&
					!this.editing &&
					this.renderGeneration === generation
				) {
					this.dom.classList.add("easymde-render-error");
				}
			});
	}

	private renderPreview(): void {
		this.renderGeneration += 1;
		const generation = this.renderGeneration;
		const kind = this.currentKind();
		const rawMarkdown = readRawMarkdown(this.node);
		this.dom.classList.remove("easymde-render-error");
		this.dom.removeAttribute("data-easymde-rendered");
		if (kind === "math" || kind === "math-inline") {
			this.renderMathPreview(kind === "math", rawMarkdown);
		} else if (kind === "mermaid") {
			this.renderMermaidPreview(rawMarkdown, generation);
		} else {
			this.renderCardPreview(kind, rawMarkdown);
		}
	}

	private subscribeRuntimeReady(): void {
		if (this.destroyed || this.runtimeReadyUnsubscribe) return;
		this.runtimeReadyUnsubscribe = subscribePreviewRuntimeReady(
			this.dom.ownerDocument,
			() => {
				if (this.destroyed || this.editing) return;
				this.renderPreview();
			},
		);
	}

	private unsubscribeRuntimeReady(): void {
		this.runtimeReadyUnsubscribe?.();
		this.runtimeReadyUnsubscribe = null;
	}

	private teardownRawEditor(): void {
		const editor = this.cardEditor;
		this.cardEditor = null;
		editor?.destroy();
		this.editing = false;
		this.previewContainer.style.removeProperty("display");
		this.syncRootAttributes();
	}

	private openRawEditor(): void {
		this.renderGeneration += 1;
		this.resetCopyFeedback();
		this.editing = true;
		this.previewContainer.style.display = "none";
		this.syncRootAttributes();

		const kindLabel = this.labels[KIND_LABEL_KEY[this.currentKind()]];
		const editor = new ProtectedCardEditor(this.dom.ownerDocument, {
			cancelLabel: this.labels.cancel,
			fieldAriaLabel: formatLabel(this.templates.source, kindLabel),
			initialValue: readRawMarkdown(this.node),
			isBlock: this.isBlock,
			onCancel: () => this.cancelRawEditor(),
			onCommit: (nextRawMarkdown) => this.commitRawEditor(nextRawMarkdown),
			saveLabel: this.labels.save,
		});
		this.cardEditor = editor;
		this.dom.appendChild(editor.element);
		this.syncRootAttributes();
		editor.focus();
	}

	private cancelRawEditor(): void {
		if (!this.editing) return;
		this.teardownRawEditor();
		this.renderPreview();
		this.view.focus();
	}

	private commitRawEditor(nextRawMarkdown: string): void {
		if (!this.editing) return;
		const previousRaw = readRawMarkdown(this.node);
		this.teardownRawEditor();
		const pos =
			nextRawMarkdown !== previousRaw && this.view.editable && !this.destroyed
				? resolveAtomPosition(this.getPos, this.view, this.node.type.name)
				: null;
		const currentNode = pos !== null ? this.view.state.doc.nodeAt(pos) : null;
		if (pos === null || !currentNode || currentNode.type !== this.node.type) {
			this.renderPreview();
			this.view.focus();
			return;
		}
		const tr = this.view.state.tr;
		if (nextRawMarkdown.trim().length === 0) {
			// Empty card content deletes the atom instead of leaving a ghost.
			tr.delete(pos, pos + currentNode.nodeSize);
			if (tr.doc.childCount === 0) {
				const paragraphType = this.view.state.schema.nodes.paragraph;
				if (paragraphType) tr.insert(0, paragraphType.create());
			}
		} else {
			tr.setNodeMarkup(pos, undefined, {
				...currentNode.attrs,
				rawMarkdown: nextRawMarkdown,
			});
		}
		tr.setMeta(PROTECTED_CARD_COMMIT_META, true);
		this.view.dispatch(closeHistory(tr));
		this.view.focus();
	}

	selectNode(): void {
		this.selected = true;
		this.applySelectionVisuals();
	}

	deselectNode(): void {
		this.selected = false;
		this.applySelectionVisuals();
	}

	update(nextNode: ProseMirrorNode): boolean {
		if (nextNode.type !== this.node.type) return false;
		const changed =
			this.node.attrs.kind !== nextNode.attrs.kind ||
			readRawMarkdown(this.node) !== readRawMarkdown(nextNode);
		this.node = nextNode;
		if (changed) this.resetCopyFeedback();
		if (this.editing && changed) this.teardownRawEditor();
		else this.syncRootAttributes();
		if (!this.editing && changed) this.renderPreview();
		return true;
	}

	stopEvent(event: Event): boolean {
		const target = event.target instanceof Node ? event.target : null;
		return (
			event.type === "dblclick" ||
			((event.type === "mousedown" || event.type === "click") &&
				this.isPreviewPointerEvent(event)) ||
			Boolean(target && this.cardActions?.contains(target)) ||
			Boolean(
				this.cardEditor && target && this.cardEditor.element.contains(target),
			)
		);
	}

	ignoreMutation(): boolean {
		return true;
	}

	destroy(): void {
		this.destroyed = true;
		this.renderGeneration += 1;
		this.resetCopyFeedback();
		this.unsubscribeEditable();
		this.unsubscribeRuntimeReady();
		this.dom.removeEventListener("dblclick", this.onDoubleClick);
		this.dom.removeEventListener("mousedown", this.onMouseDown);
		this.cardActionsCleanup?.();
		const editor = this.cardEditor;
		this.cardEditor = null;
		editor?.destroy();
	}
}

export function createProtectedBlockNodeView(
	options: ProtectedAtomNodeViewOptions = {},
): NodeViewConstructor {
	return (node, view, getPos) =>
		new ProtectedAtomNodeView(node, view, getPos, true, options);
}

export function createProtectedInlineNodeView(
	options: ProtectedAtomNodeViewOptions = {},
): NodeViewConstructor {
	return (node, view, getPos) =>
		new ProtectedAtomNodeView(node, view, getPos, false, options);
}
