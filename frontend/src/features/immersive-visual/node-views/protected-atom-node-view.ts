import { closeHistory } from "prosemirror-history";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type {
	EditorView,
	NodeView,
	NodeViewConstructor,
} from "prosemirror-view";
import type {
	VisualGeneratedRuntimePort,
	VisualRuntimeFeature,
	VisualRuntimeState,
} from "../../../contracts/visual-editor";
import { markIntrinsicMermaidLayout } from "../../../shared/mermaid/mermaid-runtime-config";
import {
	normalizeProtectedBlockKind,
	normalizeProtectedInlineKind,
	type ProtectedBlockKind,
	type ProtectedInlineKind,
} from "../visual-schema";
import {
	ensureMermaidInitialized,
	sanitizeMermaidSvg,
} from "./mermaid-svg-sanitizer";
import {
	createAtomButton,
	createAtomElement,
	MONOSPACE_FONT,
	ProtectedCardEditor,
} from "./protected-atom-card-editor";
import {
	mountTocPreview,
	renderFootnoteRefPreview,
	renderFootnotesBlockPreview,
	renderRawBlockPreview,
	renderRawInlinePreview,
} from "./protected-atom-preview-renderer";
import {
	createRuntimeProvider,
	createStandaloneRuntimePort,
	extractMermaidSource,
	type KatexRuntime,
	type MermaidRuntime,
	type ProtectedAtomRuntimeProvider,
	type ResolvedRuntimeProvider,
	renderMathWithRuntime,
} from "./protected-atom-runtime";
import { subscribeVisualEditableState } from "./visual-view-events";

export { sanitizeMermaidSvg } from "./mermaid-svg-sanitizer";
export {
	extractBlockMathTex,
	extractInlineMathTex,
	extractMermaidSource,
	type KatexRenderOptions,
	type KatexRuntime,
	type MermaidRenderResult,
	type MermaidRuntime,
	type ProtectedAtomRuntimeProvider,
} from "./protected-atom-runtime";

export type ProtectedAtomLabels = Readonly<{
	cancel?: string;
	edit?: string;
	footnotes?: string;
	math?: string;
	mermaid?: string;
	raw?: string;
	save?: string;
	toc?: string;
}>;
/** Localized format templates; `%s` (or legacy `{kind}`) expands to the localized kind label. */
export type ProtectedAtomLabelTemplates = Readonly<{
	edit?: string;
	source?: string;
}>;
export type ProtectedAtomNodeViewOptions = Readonly<{
	getKatex?: () => KatexRuntime | null | undefined;
	getMermaid?: () => MermaidRuntime | null | undefined;
	labelTemplates?: ProtectedAtomLabelTemplates;
	labels?: ProtectedAtomLabels;
	runtimePort?: VisualGeneratedRuntimePort;
	runtimeProvider?: ProtectedAtomRuntimeProvider;
}>;

/** Transaction meta marking a discrete protected-card commit boundary. */
export const PROTECTED_CARD_COMMIT_META = "easymdeProtectedCardCommit";

type ProtectedAtomKind = ProtectedBlockKind | ProtectedInlineKind;
type CardAtomKind = Exclude<
	ProtectedAtomKind,
	"math" | "math-inline" | "mermaid"
>;

const DEFAULT_LABELS: Required<ProtectedAtomLabels> = {
	cancel: "Cancel",
	edit: "Edit",
	footnotes: "Footnotes",
	math: "Math",
	mermaid: "Mermaid",
	raw: "Raw",
	save: "Save",
	toc: "TOC",
};
const DEFAULT_LABEL_TEMPLATES: Required<ProtectedAtomLabelTemplates> = {
	edit: "Edit {kind}",
	source: "{kind} source",
};
const ROOT_KIND_CLASSES: Record<ProtectedAtomKind, string> = {
	math: "easymde-protected-block",
	mermaid: "easymde-protected-block",
	toc: "easymde-protected-block",
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
	toc: " easymde-toc",
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

function readRawMarkdown(node: ProseMirrorNode): string {
	return typeof node.attrs.rawMarkdown === "string"
		? node.attrs.rawMarkdown
		: "";
}

/**
 * Expand the kind placeholder: WordPress Gettext `%s` / `%1$s` (PHP-owned
 * localized templates) and the legacy `{kind}` token.
 */
function formatLabel(template: string, kindLabel: string): string {
	return template.replace(/%(?:1\$)?s|\{kind\}/g, () => kindLabel);
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
	private readonly labels: Required<ProtectedAtomLabels>;
	private readonly templates: Required<ProtectedAtomLabelTemplates>;
	private readonly runtimeProvider: ResolvedRuntimeProvider;
	private readonly runtimePort: VisualGeneratedRuntimePort;
	private readonly previewContainer: HTMLElement;
	private readonly cardActions: HTMLDivElement | null = null;
	private readonly editButton: HTMLButtonElement | null = null;
	private readonly cardActionsCleanup: (() => void) | null = null;
	private cardEditor: ProtectedCardEditor | null = null;
	private editing = false;
	private selected = false;
	private destroyed = false;
	private renderGeneration = 0;
	private runtimeUnsubscribe: (() => void) | null = null;
	private previewCleanup: (() => void) | null = null;
	private readonly unsubscribeEditable: () => void;
	private readonly onDoubleClick: (event: MouseEvent) => void;
	private readonly onMouseDown: (event: MouseEvent) => void;
	private readonly onPreviewClick: (event: MouseEvent) => void;

	private readonly cardRenderers: Record<
		CardAtomKind,
		(doc: Document, rawMarkdown: string) => void
	> = {
		"footnote-ref": (doc, rawMarkdown) => {
			this.unsubscribeRuntime();
			this.previewContainer.replaceChildren(
				renderFootnoteRefPreview(doc, rawMarkdown),
			);
		},
		"raw-inline": (doc, rawMarkdown) => {
			let needsRuntime = false;
			this.previewContainer.replaceChildren(
				renderRawInlinePreview(
					doc,
					rawMarkdown,
					{ footnotes: this.labels.footnotes, raw: this.labels.raw },
					(d, displayMode, raw) => {
						const result = this.renderNestedMathElement(d, displayMode, raw);
						if (result.pendingRuntime) needsRuntime = true;
						return result.element;
					},
				),
			);
			if (needsRuntime) this.subscribeRuntime();
			else this.unsubscribeRuntime();
		},
		toc: (doc) => {
			this.unsubscribeRuntime();
			this.requestRuntimeState("toc");
			this.previewCleanup = mountTocPreview(
				doc,
				this.previewContainer,
				this.view,
				this.labels.toc,
				() => !this.destroyed && !this.editing && this.currentKind() === "toc",
			);
		},
		footnotes: (doc, rawMarkdown) => {
			this.unsubscribeRuntime();
			this.previewContainer.replaceChildren(
				renderFootnotesBlockPreview(doc, rawMarkdown, this.labels.footnotes),
			);
		},
		raw: (doc, rawMarkdown) => {
			let needsRuntime = false;
			this.previewContainer.replaceChildren(
				renderRawBlockPreview(doc, rawMarkdown, {
					fallbackLabel: this.labels.raw,
					footnotesLabel: this.labels.footnotes,
					renderNestedMath: (d, displayMode, raw) => {
						const result = this.renderNestedMathElement(d, displayMode, raw);
						if (result.pendingRuntime) needsRuntime = true;
						return result.element;
					},
					viewWindow: doc.defaultView,
				}),
			);
			if (needsRuntime) this.subscribeRuntime();
			else this.unsubscribeRuntime();
		},
	};

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
		this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
		this.templates = {
			...DEFAULT_LABEL_TEMPLATES,
			...(options.labelTemplates ?? {}),
		};

		const doc = view.dom.ownerDocument;
		this.runtimeProvider = createRuntimeProvider(doc, options);
		this.runtimePort =
			options.runtimePort ?? createStandaloneRuntimePort(this.runtimeProvider);

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
			const onEditClick = (event: MouseEvent): void => {
				event.preventDefault();
				event.stopPropagation();
				if (this.destroyed || this.editing || !this.view.editable) return;
				this.openRawEditor();
			};
			const stopActionMouseDown = (event: MouseEvent): void => {
				event.stopPropagation();
			};
			editButton.addEventListener("mousedown", stopActionMouseDown);
			editButton.addEventListener("click", onEditClick);
			cardActions.append(editButton);
			this.dom.appendChild(cardActions);
			this.cardActions = cardActions;
			this.editButton = editButton;
			this.cardActionsCleanup = () => {
				editButton.removeEventListener("mousedown", stopActionMouseDown);
				editButton.removeEventListener("click", onEditClick);
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
		this.onPreviewClick = (event: MouseEvent) => {
			if (this.destroyed || this.editing) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest("a")) {
				event.preventDefault();
			}
		};
		if (isBlock) this.dom.addEventListener("mousedown", this.onMouseDown);
		this.previewContainer.addEventListener("click", this.onPreviewClick);
		this.unsubscribeEditable = subscribeVisualEditableState(view, () => {
			if (!this.destroyed) this.syncRootAttributes();
		});
		this.syncRootAttributes();
		this.renderPreview();
	}

	private isPreviewPointerEvent(event: Event): boolean {
		if (!this.isBlock || this.destroyed || this.editing) return false;
		if (!(event instanceof MouseEvent) || event.button !== 0) return false;
		const target = event.target instanceof Node ? event.target : null;
		return !(
			(target && this.cardActions?.contains(target)) ||
			(target && this.cardEditor?.element.contains(target))
		);
	}

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

	private createMonospaceFallbackElement(
		doc: Document,
		text: string,
		isBlock: boolean,
	): HTMLElement {
		const code = createAtomElement(
			doc,
			"code",
			"easymde-protected-fallback",
			text,
		);
		code.style.fontFamily = MONOSPACE_FONT;
		if (!isBlock) return code;
		// A `<div>`, never `<pre>`: `code-frame.css` styles every
		// `.easymde-code-mac pre` as a dark Mac terminal frame.
		const block = createAtomElement(
			doc,
			"div",
			"easymde-protected-fallback-pre",
		);
		Object.assign(block.style, { margin: "0", whiteSpace: "pre-wrap" });
		block.appendChild(code);
		return block;
	}

	private createLoadingPlaceholderElement(
		doc: Document,
		isBlock: boolean,
	): HTMLElement {
		const placeholder = createAtomElement(
			doc,
			isBlock ? "div" : "span",
			"easymde-protected-loading",
		);
		placeholder.setAttribute("aria-busy", "true");
		placeholder.setAttribute("data-easymde-protected-loading", "1");
		return placeholder;
	}

	private renderMonospaceFallback(text: string): void {
		this.previewContainer.replaceChildren(
			this.createMonospaceFallbackElement(
				this.dom.ownerDocument,
				text,
				this.isBlock,
			),
		);
	}

	private renderLoadingPlaceholder(): void {
		this.previewContainer.replaceChildren(
			this.createLoadingPlaceholderElement(
				this.dom.ownerDocument,
				this.isBlock,
			),
		);
	}

	private renderNestedMathElement(
		doc: Document,
		displayMode: boolean,
		rawMarkdown: string,
	): Readonly<{ element: HTMLElement; pendingRuntime: boolean }> {
		const host = createAtomElement(
			doc,
			displayMode ? "div" : "span",
			displayMode
				? "easymde-math easymde-math-block"
				: "easymde-math easymde-math-inline",
		);
		const outcome = renderMathWithRuntime(
			host,
			displayMode,
			rawMarkdown,
			this.runtimePort,
			this.runtimeProvider,
		);
		if (outcome === "rendered") {
			return { element: host, pendingRuntime: false };
		}
		if (outcome === "loading") {
			host.appendChild(this.createLoadingPlaceholderElement(doc, displayMode));
			return { element: host, pendingRuntime: true };
		}
		host.appendChild(
			this.createMonospaceFallbackElement(doc, rawMarkdown, displayMode),
		);
		return { element: host, pendingRuntime: outcome === "unavailable" };
	}

	private renderMathPreview(displayMode: boolean, rawMarkdown: string): void {
		// Render into the `.easymde-math` element itself so `.katex`
		// (inline) or `.katex-display > .katex` (block) is a direct child,
		// matching the formal Preview DOM and MathML/PNG export contracts.
		const outcome = renderMathWithRuntime(
			this.previewContainer,
			displayMode,
			rawMarkdown,
			this.runtimePort,
			this.runtimeProvider,
		);
		if (outcome === "rendered") {
			this.dom.setAttribute("data-easymde-rendered", "1");
			this.unsubscribeRuntime();
			return;
		}
		if (outcome === "loading") {
			this.renderLoadingPlaceholder();
			this.subscribeRuntime();
			return;
		}
		if (outcome === "error") {
			this.dom.classList.add("easymde-render-error");
		} else if (outcome === "unavailable") {
			this.subscribeRuntime();
		}
		this.renderMonospaceFallback(rawMarkdown);
	}

	private renderMermaidPreview(rawMarkdown: string, generation: number): void {
		const source = extractMermaidSource(rawMarkdown);
		if (source.length === 0) {
			this.renderMonospaceFallback(rawMarkdown);
			return;
		}
		const state = this.requestRuntimeState("mermaid");
		if (state === "loading") {
			this.renderLoadingPlaceholder();
			this.subscribeRuntime();
			return;
		}
		const mermaid =
			state === "ready" ? this.runtimeProvider.getMermaid() : null;
		if (!mermaid) {
			this.renderMonospaceFallback(source);
			this.subscribeRuntime();
			return;
		}
		this.unsubscribeRuntime();
		mermaidRenderSequence += 1;
		const renderId = `easymde-visual-mermaid-${mermaidRenderSequence}`;

		const cachedSvg = this.runtimeProvider.readCachedMermaidSvg(
			source,
			renderId,
		);
		if (cachedSvg !== null) {
			const safeCachedSvg = sanitizeMermaidSvg(
				cachedSvg,
				this.dom.ownerDocument,
				renderId,
			);
			if (safeCachedSvg) {
				this.dom.classList.remove("easymde-render-error");
				this.dom.setAttribute("data-easymde-rendered", "1");
				this.previewContainer.replaceChildren(safeCachedSvg);
				markIntrinsicMermaidLayout(this.previewContainer);
				return;
			}
		}

		// Keep a non-source loading placeholder while Mermaid renders
		// asynchronously so users never see raw diagram source unless they
		// explicitly open the source editor or rendering actually fails.
		this.renderLoadingPlaceholder();
		ensureMermaidInitialized(mermaid);

		Promise.resolve()
			.then(() => mermaid.render(renderId, source))
			.then((result) => {
				if (
					this.destroyed ||
					this.editing ||
					this.renderGeneration !== generation
				) {
					return;
				}
				const svgMarkup = typeof result?.svg === "string" ? result.svg : "";
				const safeSvg = sanitizeMermaidSvg(
					svgMarkup,
					this.dom.ownerDocument,
					renderId,
				);
				if (!safeSvg) {
					this.dom.classList.add("easymde-render-error");
					this.renderMonospaceFallback(source);
					return;
				}
				this.runtimeProvider.writeCachedMermaidSvg(source, renderId, svgMarkup);
				this.dom.classList.remove("easymde-render-error");
				this.dom.setAttribute("data-easymde-rendered", "1");
				this.previewContainer.replaceChildren(safeSvg);
				markIntrinsicMermaidLayout(this.previewContainer);
			})
			.catch(() => {
				if (
					!this.destroyed &&
					!this.editing &&
					this.renderGeneration === generation
				) {
					this.dom.classList.add("easymde-render-error");
					this.renderMonospaceFallback(source);
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
		delete this.previewContainer.dataset.easymdeMermaidLayout;
		this.clearPreviewCleanup();
		if (kind === "math" || kind === "math-inline") {
			this.renderMathPreview(kind === "math", rawMarkdown);
		} else if (kind === "mermaid") {
			this.renderMermaidPreview(rawMarkdown, generation);
		} else {
			this.cardRenderers[kind](this.dom.ownerDocument, rawMarkdown);
		}
	}

	private requestRuntimeState(
		feature: VisualRuntimeFeature,
	): VisualRuntimeState {
		return this.runtimePort.request(feature);
	}

	private subscribeRuntime(): void {
		if (this.destroyed || this.runtimeUnsubscribe) return;
		this.runtimeUnsubscribe = this.runtimePort.subscribe(() => {
			if (this.destroyed || this.editing) return;
			this.renderPreview();
		});
	}

	private unsubscribeRuntime(): void {
		this.runtimeUnsubscribe?.();
		this.runtimeUnsubscribe = null;
	}

	private clearPreviewCleanup(): void {
		this.previewCleanup?.();
		this.previewCleanup = null;
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
		this.clearPreviewCleanup();
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
		this.unsubscribeEditable();
		this.unsubscribeRuntime();
		this.clearPreviewCleanup();
		this.dom.removeEventListener("dblclick", this.onDoubleClick);
		this.dom.removeEventListener("mousedown", this.onMouseDown);
		this.previewContainer.removeEventListener("click", this.onPreviewClick);
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
