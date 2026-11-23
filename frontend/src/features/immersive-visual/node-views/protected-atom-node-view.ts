import type { Node as ProseMirrorNode } from "prosemirror-model";
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
	sanitizeDomUrl,
} from "../visual-schema";

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
export type ProtectedAtomNodeViewOptions = Readonly<{
	getKatex?: () => KatexRuntime | null | undefined;
	getMermaid?: () => MermaidRuntime | null | undefined;
	labels?: ProtectedAtomLabels;
}>;

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
const COPY_FEEDBACK_DURATION_MS = 1600;
const KIND_CLASSES: Record<ProtectedAtomKind, string> = {
	math: "easymde-protected-block easymde-math easymde-math-block",
	mermaid: "easymde-protected-block easymde-mermaid",
	toc: "easymde-protected-block easymde-toc",
	footnotes: "easymde-protected-block easymde-footnotes",
	raw: "easymde-protected-block",
	"math-inline": "easymde-protected-inline easymde-math easymde-math-inline",
	"footnote-ref": "easymde-protected-inline easymde-footnote-ref",
	"raw-inline": "easymde-protected-inline",
};
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
const FORBIDDEN_SVG_TAGS = new Set([
	"applet",
	"base",
	"embed",
	"form",
	"frame",
	"frameset",
	"iframe",
	"link",
	"meta",
	"noscript",
	"object",
	"portal",
	"script",
	"template",
]);
const URL_BEARING_ATTRS = new Set([
	"action",
	"data",
	"formaction",
	"href",
	"poster",
	"src",
	"xlink:href",
]);
const UNSAFE_STYLE_PATTERN =
	/(?:javascript\s*:|vbscript\s*:|expression\s*\(|@import\b|behavior\s*:|-moz-binding\s*:)/i;
const UNSAFE_CSS_URL_PATTERN = /url\(\s*['"]?\s*(?!#)[^)]+\)/gi;
const MONOSPACE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const MERMAID_LABEL_FONT_FAMILY = '"trebuchet ms", verdana, arial, sans-serif';

const initializedMermaidRuntimes = new WeakSet<object>();
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

function isSafeSvgHref(rawValue: string): boolean {
	let compact = "";
	for (let i = 0; i < rawValue.length; i += 1) {
		if (rawValue.charCodeAt(i) > 32) compact += rawValue[i];
	}
	if (compact.length === 0) return false;
	if (compact.startsWith("#")) return true;
	return (
		!/^(?:javascript|vbscript|data):/i.test(compact) &&
		sanitizeDomUrl(rawValue) !== null
	);
}

function sanitizeInlineCssText(cssText: string): string {
	return UNSAFE_STYLE_PATTERN.test(cssText)
		? ""
		: cssText.replace(UNSAFE_CSS_URL_PATTERN, "");
}

function removeAttr(element: Element, attr: Attr): void {
	if (attr.namespaceURI)
		element.removeAttributeNS(attr.namespaceURI, attr.localName);
	element.removeAttribute(attr.name);
}

function sanitizeSvgTree(root: Element): void {
	const stack: Element[] = [root];
	while (stack.length > 0) {
		const element = stack.pop();
		if (!element) continue;
		const tagName = (element.localName || element.tagName).toLowerCase();
		if (FORBIDDEN_SVG_TAGS.has(tagName)) {
			element.remove();
			continue;
		}
		for (const attr of Array.from(element.attributes)) {
			const name = attr.name.toLowerCase();
			if (
				name.startsWith("on") ||
				(URL_BEARING_ATTRS.has(name) && !isSafeSvgHref(attr.value))
			) {
				removeAttr(element, attr);
			} else if (name === "style") {
				const safeStyle = sanitizeInlineCssText(attr.value);
				if (safeStyle.length === 0) removeAttr(element, attr);
				else if (safeStyle !== attr.value)
					element.setAttribute(attr.name, safeStyle);
			}
		}
		if (tagName === "style") {
			element.textContent = sanitizeInlineCssText(element.textContent ?? "");
		}
		for (let i = element.children.length - 1; i >= 0; i -= 1) {
			const child = element.children[i];
			if (child) stack.push(child);
		}
	}
}

export function sanitizeMermaidSvg(
	svgMarkup: string,
	targetDocument: Document,
): SVGElement | null {
	const trimmed = svgMarkup.trim();
	if (trimmed.length === 0 || typeof DOMParser === "undefined") return null;
	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(trimmed, "image/svg+xml");
	const svgElement =
		xmlDoc.querySelector("parsererror") === null &&
		xmlDoc.documentElement?.localName.toLowerCase() === "svg"
			? xmlDoc.documentElement
			: parser.parseFromString(trimmed, "text/html").querySelector("svg");
	if (!svgElement) return null;
	sanitizeSvgTree(svgElement);
	const adopted = targetDocument.importNode(svgElement, true);
	return adopted.localName.toLowerCase() === "svg"
		? (adopted as SVGElement)
		: null;
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

function ensureMermaidInitialized(mermaid: MermaidRuntime): void {
	if (initializedMermaidRuntimes.has(mermaid)) return;
	initializedMermaidRuntimes.add(mermaid);
	if (typeof mermaid.initialize !== "function") return;
	try {
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "default",
			fontFamily: MERMAID_LABEL_FONT_FAMILY,
			fontSize: 16,
		});
	} catch {
		// Minimal runtimes or test mocks may reject re-initialization.
	}
}

function readRawMarkdown(node: ProseMirrorNode): string {
	return typeof node.attrs.rawMarkdown === "string"
		? node.attrs.rawMarkdown
		: "";
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

function createEl<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = doc.createElement(tag);
	element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function makeButton(
	doc: Document,
	className: string,
	label: string,
): HTMLButtonElement {
	const button = createEl(doc, "button", className, label);
	button.type = "button";
	return button;
}

async function copyTextToClipboard(
	text: string,
	doc: Document,
): Promise<boolean> {
	const clipboard =
		typeof navigator !== "undefined" ? navigator.clipboard : undefined;
	if (clipboard && typeof clipboard.writeText === "function") {
		try {
			await clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to legacy execCommand copy fallback when available.
		}
	}
	if (typeof doc.execCommand !== "function" || !doc.body) {
		return false;
	}
	const helper = doc.createElement("textarea");
	helper.value = text;
	helper.setAttribute("readonly", "");
	helper.setAttribute("aria-hidden", "true");
	helper.tabIndex = -1;
	Object.assign(helper.style, {
		position: "fixed",
		top: "-9999px",
		left: "-9999px",
		opacity: "0",
		pointerEvents: "none",
	});
	const previousFocus =
		doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
	doc.body.appendChild(helper);
	try {
		helper.focus();
		helper.select();
		return Boolean(doc.execCommand("copy"));
	} catch {
		return false;
	} finally {
		helper.remove();
		if (previousFocus?.isConnected) {
			previousFocus.focus();
		}
	}
}

class ProtectedAtomNodeView implements NodeView {
	readonly dom: HTMLElement;
	private readonly isBlock: boolean;
	private node: ProseMirrorNode;
	private readonly view: EditorView;
	private readonly getPos: () => number | undefined;
	private readonly options: ProtectedAtomNodeViewOptions;
	private readonly labels: Required<ProtectedAtomLabels>;
	private readonly previewContainer: HTMLElement;
	private readonly cardActions: HTMLDivElement | null = null;
	private readonly editButton: HTMLButtonElement | null = null;
	private readonly copyButton: HTMLButtonElement | null = null;
	private readonly cardActionsCleanup: (() => void) | null = null;
	private editorContainer: HTMLElement | null = null;
	private editorCleanup: (() => void) | null = null;
	private editing = false;
	private selected = false;
	private destroyed = false;
	private renderGeneration = 0;
	private copyGeneration = 0;
	private copyResetTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly onDoubleClick: (event: MouseEvent) => void;

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
			const cardActions = createEl(
				doc,
				"div",
				"easymde-protected-card-actions",
			);
			cardActions.setAttribute("contenteditable", "false");
			const editButton = makeButton(
				doc,
				"easymde-protected-edit-btn",
				this.labels.edit,
			);
			const copyButton = makeButton(
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

		this.previewContainer = createEl(
			doc,
			isBlock ? "div" : "span",
			"easymde-protected-preview",
		);
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
		this.syncRootAttributes();
		this.renderPreview();
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
		this.dom.className = KIND_CLASSES[kind];
		this.dom.setAttribute("data-easymde-protected-kind", kind);
		this.dom.setAttribute(
			"data-easymde-visual-markdown-source",
			readRawMarkdown(this.node),
		);
		if (this.editing) {
			this.dom.classList.add("easymde-protected-editing");
			this.dom.setAttribute("data-easymde-protected-editing", "1");
		} else {
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
			const editLabel = `${this.labels.edit} ${kindLabel}`;
			this.editButton.setAttribute("aria-label", editLabel);
			this.editButton.title = editLabel;
			this.editButton.disabled = !this.view.editable;
		}
		if (this.copyButton) {
			const copyLabel = `${this.labels.copy} ${kindLabel}`;
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
		const code = createEl(doc, "code", "easymde-protected-fallback", text);
		code.style.fontFamily = MONOSPACE_FONT;
		if (!this.isBlock) {
			this.previewContainer.replaceChildren(code);
			return;
		}
		const pre = createEl(doc, "pre", "easymde-protected-fallback-pre");
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
				createEl(doc, "span", "easymde-protected-inline-card", rawMarkdown),
			);
			return;
		}
		const card = createEl(doc, "div", "easymde-protected-card");
		const badge = createEl(
			doc,
			"span",
			"easymde-protected-card-label",
			this.labels[KIND_LABEL_KEY[kind]],
		);
		const body = createEl(
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
			return;
		}
		const target = createEl(
			this.dom.ownerDocument,
			displayMode ? "div" : "span",
			"easymde-protected-math-rendered",
		);
		try {
			katex.render(tex, target, {
				displayMode,
				throwOnError: false,
				strict: "ignore",
			});
			this.previewContainer.replaceChildren(target);
			this.dom.setAttribute("data-easymde-rendered", "1");
		} catch {
			this.dom.classList.add("easymde-render-error");
			this.renderMonospaceFallback(rawMarkdown);
		}
	}

	private renderMermaidPreview(rawMarkdown: string, generation: number): void {
		const source = extractMermaidSource(rawMarkdown);
		const mermaid = resolveRuntime("mermaid", this.options.getMermaid);
		this.renderMonospaceFallback(source.length > 0 ? source : rawMarkdown);
		if (!mermaid || source.length === 0) return;
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

	private teardownRawEditor(): void {
		this.editorCleanup?.();
		this.editorCleanup = null;
		this.editorContainer?.remove();
		this.editorContainer = null;
		this.editing = false;
		this.previewContainer.style.removeProperty("display");
		this.syncRootAttributes();
	}

	private openRawEditor(): void {
		this.renderGeneration += 1;
		this.resetCopyFeedback();
		this.editing = true;
		this.previewContainer.style.display = "none";

		const doc = this.dom.ownerDocument;
		const rawMarkdown = readRawMarkdown(this.node);
		const kindLabel = this.labels[KIND_LABEL_KEY[this.currentKind()]];
		const container = createEl(
			doc,
			this.isBlock ? "div" : "span",
			"easymde-protected-editor",
		);

		const field = createEl(
			doc,
			this.isBlock ? "textarea" : "input",
			"easymde-protected-source-input",
		);
		if (field instanceof HTMLTextAreaElement) {
			field.rows = Math.min(12, Math.max(2, rawMarkdown.split("\n").length));
			Object.assign(field.style, { width: "100%", boxSizing: "border-box" });
		} else {
			field.type = "text";
			field.size = Math.min(60, Math.max(12, rawMarkdown.length + 2));
		}
		field.style.fontFamily = MONOSPACE_FONT;
		field.value = rawMarkdown;
		field.setAttribute("aria-label", `${kindLabel} source`);

		const actions = createEl(
			doc,
			this.isBlock ? "div" : "span",
			"easymde-protected-editor-actions",
		);
		const saveButton = makeButton(
			doc,
			"easymde-protected-save-btn",
			this.labels.save,
		);
		saveButton.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
		const cancelButton = makeButton(
			doc,
			"easymde-protected-cancel-btn",
			this.labels.cancel,
		);
		cancelButton.setAttribute("aria-keyshortcuts", "Escape");
		actions.append(saveButton, cancelButton);
		container.append(field, actions);

		const onFieldKeyDown = (event: KeyboardEvent): void => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === "Escape") {
				event.preventDefault();
				this.cancelRawEditor();
			} else if (
				event.key === "Enter" &&
				(event.ctrlKey || event.metaKey || !event.shiftKey)
			) {
				event.preventDefault();
				this.commitRawEditor(field.value);
			}
		};
		const onContainerKeyDown = (event: KeyboardEvent): void => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === "Escape") {
				event.preventDefault();
				this.cancelRawEditor();
			} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				this.commitRawEditor(field.value);
			}
		};
		const onButton =
			(action: () => void) =>
			(event: MouseEvent): void => {
				event.preventDefault();
				event.stopPropagation();
				action();
			};
		const onSave = onButton(() => this.commitRawEditor(field.value));
		const onCancel = onButton(() => this.cancelRawEditor());

		field.addEventListener("keydown", onFieldKeyDown as EventListener);
		container.addEventListener("keydown", onContainerKeyDown as EventListener);
		saveButton.addEventListener("click", onSave);
		cancelButton.addEventListener("click", onCancel);
		this.editorContainer = container;
		this.editorCleanup = () => {
			field.removeEventListener("keydown", onFieldKeyDown as EventListener);
			container.removeEventListener(
				"keydown",
				onContainerKeyDown as EventListener,
			);
			saveButton.removeEventListener("click", onSave);
			cancelButton.removeEventListener("click", onCancel);
		};
		this.dom.appendChild(container);
		this.syncRootAttributes();
		field.focus();
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
			nextRawMarkdown !== previousRaw && this.view.editable
				? resolveAtomPosition(this.getPos, this.view, this.node.type.name)
				: null;
		const currentNode = pos !== null ? this.view.state.doc.nodeAt(pos) : null;
		if (pos === null || !currentNode || currentNode.type !== this.node.type) {
			this.renderPreview();
			this.view.focus();
			return;
		}
		this.view.dispatch(
			this.view.state.tr.setNodeMarkup(pos, undefined, {
				...currentNode.attrs,
				rawMarkdown: nextRawMarkdown,
			}),
		);
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
			Boolean(target && this.cardActions?.contains(target)) ||
			Boolean(this.editing && target && this.editorContainer?.contains(target))
		);
	}

	ignoreMutation(): boolean {
		return true;
	}

	destroy(): void {
		this.destroyed = true;
		this.renderGeneration += 1;
		this.resetCopyFeedback();
		this.dom.removeEventListener("dblclick", this.onDoubleClick);
		this.cardActionsCleanup?.();
		this.editorCleanup?.();
		this.editorCleanup = null;
		this.editorContainer = null;
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
