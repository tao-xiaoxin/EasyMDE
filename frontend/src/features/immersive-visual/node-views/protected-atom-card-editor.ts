import type { EditorView } from "prosemirror-view";
import { sanitizeDomUrl } from "../visual-schema";

/**
 * Extracted raw-source card editor for protected atoms.
 *
 * The editor owns the multiline `<textarea>` / single-line `<input>` chrome,
 * the Save/Cancel controls, the card-local IME composition state, and the
 * shared reactive editable-state hub consumed by every atom NodeView.
 *
 * Composition isolation is owned here: `compositionstart`,
 * `compositionupdate`, and `compositionend` are stopped at the card boundary so
 * a `<textarea>` inside a `contenteditable="false"` NodeView can never leak
 * into the outer ProseMirror composition lifecycle.
 *
 * The module also owns the protected atoms' shared browser presentation
 * helpers: preview-runtime readiness subscription, Mermaid SVG sanitization,
 * and the single Mermaid initialization that mirrors formal Preview exactly.
 */

export const MONOSPACE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export type VisualEditableListener = (editable: boolean) => void;

const editableListeners = new WeakMap<
	EditorView,
	Set<VisualEditableListener>
>();
const lastPublishedEditable = new WeakMap<EditorView, boolean>();
const editableInteractionCleanups = new WeakMap<EditorView, () => void>();

/**
 * Subscribe a NodeView to dynamic `EditorView.editable` changes. ProseMirror
 * updates `view.editable` on every `setProps`, but it does not call
 * `NodeView.update()` when only `editable` changed, so the highlight plugin's
 * PluginView publishes the new state through this hub.
 */
export function subscribeVisualEditableState(
	view: EditorView,
	listener: VisualEditableListener,
): () => void {
	let listeners = editableListeners.get(view);
	if (!listeners) {
		listeners = new Set();
		editableListeners.set(view, listeners);
	}
	listeners.add(listener);
	if (listeners.size === 1) {
		// Independent fallback for hosts that mount NodeViews without the
		// highlight plugin: refresh stale disabled state on the next interaction.
		const sync = (): void => publishVisualEditableState(view);
		view.dom.addEventListener("focusin", sync);
		view.dom.addEventListener("pointerdown", sync, true);
		editableInteractionCleanups.set(view, () => {
			view.dom.removeEventListener("focusin", sync);
			view.dom.removeEventListener("pointerdown", sync, true);
		});
	}
	return () => {
		const current = editableListeners.get(view);
		if (!current) return;
		current.delete(listener);
		if (current.size === 0) {
			editableListeners.delete(view);
			const cleanup = editableInteractionCleanups.get(view);
			editableInteractionCleanups.delete(view);
			cleanup?.();
		}
	};
}

/** Publish the current `view.editable` state to subscribed NodeViews. */
export function publishVisualEditableState(view: EditorView): void {
	if (view.isDestroyed) return;
	const editable = view.editable;
	if (lastPublishedEditable.get(view) === editable) return;
	lastPublishedEditable.set(view, editable);
	const listeners = editableListeners.get(view);
	if (!listeners) return;
	for (const listener of Array.from(listeners)) {
		listener(editable);
	}
}

export function createAtomElement<K extends keyof HTMLElementTagNameMap>(
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

export function createAtomButton(
	doc: Document,
	className: string,
	label: string,
): HTMLButtonElement {
	const button = createAtomElement(doc, "button", className, label);
	button.type = "button";
	return button;
}

export async function copyTextToClipboard(
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

export type ProtectedCardEditorOptions = Readonly<{
	cancelLabel: string;
	fieldAriaLabel: string;
	initialValue: string;
	isBlock: boolean;
	onCancel: () => void;
	onCommit: (nextRawMarkdown: string) => void;
	saveLabel: string;
}>;

export class ProtectedCardEditor {
	readonly element: HTMLElement;
	private readonly field: HTMLTextAreaElement | HTMLInputElement;
	private readonly options: ProtectedCardEditorOptions;
	private readonly cleanups: Array<() => void> = [];
	private composing = false;
	private pendingCommit = false;
	private disposed = false;

	constructor(doc: Document, options: ProtectedCardEditorOptions) {
		this.options = options;
		const rawMarkdown = options.initialValue;
		this.element = createAtomElement(
			doc,
			options.isBlock ? "div" : "span",
			"easymde-protected-editor",
		);

		const field = createAtomElement(
			doc,
			options.isBlock ? "textarea" : "input",
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
		field.setAttribute("aria-label", options.fieldAriaLabel);
		this.field = field;

		const actions = createAtomElement(
			doc,
			options.isBlock ? "div" : "span",
			"easymde-protected-editor-actions",
		);
		const saveButton = createAtomButton(
			doc,
			"easymde-protected-save-btn",
			options.saveLabel,
		);
		saveButton.setAttribute(
			"aria-keyshortcuts",
			options.isBlock ? "Control+Enter Meta+Enter" : "Enter",
		);
		const cancelButton = createAtomButton(
			doc,
			"easymde-protected-cancel-btn",
			options.cancelLabel,
		);
		cancelButton.setAttribute("aria-keyshortcuts", "Escape");
		actions.append(saveButton, cancelButton);
		this.element.append(field, actions);

		this.onKeyDown = (event: KeyboardEvent): void => {
			event.stopPropagation();
			this.handleKeyDown(event);
		};
		this.onCompositionStart = (event: CompositionEvent): void => {
			event.stopPropagation();
			this.composing = true;
		};
		this.onCompositionUpdate = (event: CompositionEvent): void => {
			event.stopPropagation();
		};
		this.onCompositionEnd = (event: CompositionEvent): void => {
			event.stopPropagation();
			this.composing = false;
			if (!this.pendingCommit || this.disposed) return;
			this.pendingCommit = false;
			this.commitNow();
		};
		this.element.addEventListener("keydown", this.onKeyDown as EventListener);
		field.addEventListener(
			"compositionstart",
			this.onCompositionStart as EventListener,
		);
		field.addEventListener(
			"compositionupdate",
			this.onCompositionUpdate as EventListener,
		);
		field.addEventListener(
			"compositionend",
			this.onCompositionEnd as EventListener,
		);
		const onSaveClick = (event: MouseEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			this.requestCommit();
		};
		const onCancelClick = (event: MouseEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			this.requestCancel();
		};
		saveButton.addEventListener("click", onSaveClick);
		cancelButton.addEventListener("click", onCancelClick);
		this.cleanups.push(
			() =>
				this.element.removeEventListener(
					"keydown",
					this.onKeyDown as EventListener,
				),
			() =>
				field.removeEventListener(
					"compositionstart",
					this.onCompositionStart as EventListener,
				),
			() =>
				field.removeEventListener(
					"compositionupdate",
					this.onCompositionUpdate as EventListener,
				),
			() =>
				field.removeEventListener(
					"compositionend",
					this.onCompositionEnd as EventListener,
				),
			() => saveButton.removeEventListener("click", onSaveClick),
			() => cancelButton.removeEventListener("click", onCancelClick),
		);
	}

	readValue(): string {
		return this.field.value;
	}

	hasPendingCommit(): boolean {
		return this.pendingCommit;
	}

	isComposing(): boolean {
		return this.composing;
	}

	focus(): void {
		this.field.focus();
	}

	requestCommit(): void {
		if (this.disposed) return;
		if (this.composing) {
			this.pendingCommit = true;
			return;
		}
		this.commitNow();
	}

	requestCancel(): void {
		if (this.disposed) return;
		this.pendingCommit = false;
		this.options.onCancel();
	}

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.composing = false;
		this.pendingCommit = false;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.element.remove();
	}

	private commitNow(): void {
		if (this.disposed) return;
		this.pendingCommit = false;
		this.options.onCommit(this.field.value);
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if (this.disposed || event.isComposing) return;
		if (event.key === "Escape") {
			event.preventDefault();
			this.requestCancel();
			return;
		}
		if (event.key !== "Enter") return;
		const accelerator = event.ctrlKey || event.metaKey;
		const wantsCommit = this.options.isBlock
			? accelerator
			: accelerator || !event.shiftKey;
		if (!wantsCommit) return;
		event.preventDefault();
		this.requestCommit();
	}

	private readonly onKeyDown: (event: KeyboardEvent) => void;
	private readonly onCompositionStart: (event: CompositionEvent) => void;
	private readonly onCompositionUpdate: (event: CompositionEvent) => void;
	private readonly onCompositionEnd: (event: CompositionEvent) => void;
}

export const PREVIEW_RUNTIME_READY_EVENT = "easymde:preview-runtime-ready";

export type RuntimeReadySubscription = () => void;

const runtimeReadySubscriptions = new WeakMap<
	Document,
	Readonly<{
		handle: (event: Event) => void;
		listeners: Set<() => void>;
		window: Window | null;
	}>
>();

/**
 * Notify mounted protected atoms when the lazy KaTeX/Mermaid enhancement
 * runtime becomes available, without polling or reloading the page.
 */
export function subscribePreviewRuntimeReady(
	doc: Document,
	listener: () => void,
): RuntimeReadySubscription {
	let entry = runtimeReadySubscriptions.get(doc);
	if (!entry) {
		const listeners = new Set<() => void>();
		let lastEvent: Event | null = null;
		const handle = (event: Event): void => {
			// A bubbling event dispatched on `document` also reaches the window
			// listener; publish each distinct readiness event exactly once.
			if (event === lastEvent) return;
			lastEvent = event;
			for (const candidate of Array.from(listeners)) candidate();
		};
		entry = { handle, listeners, window: doc.defaultView };
		doc.addEventListener(PREVIEW_RUNTIME_READY_EVENT, handle);
		entry.window?.addEventListener(PREVIEW_RUNTIME_READY_EVENT, handle);
		runtimeReadySubscriptions.set(doc, entry);
	}
	const active = entry;
	active.listeners.add(listener);
	return () => {
		const live = runtimeReadySubscriptions.get(doc);
		if (!live) return;
		live.listeners.delete(listener);
		if (live.listeners.size > 0) return;
		doc.removeEventListener(PREVIEW_RUNTIME_READY_EVENT, live.handle);
		live.window?.removeEventListener(PREVIEW_RUNTIME_READY_EVENT, live.handle);
		runtimeReadySubscriptions.delete(doc);
	};
}

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
			const localName = (attr.localName || "").toLowerCase();
			// Check the local name too so custom prefixes (`x:href`) cannot bypass.
			const isUrlBearing =
				URL_BEARING_ATTRS.has(name) || URL_BEARING_ATTRS.has(localName);
			if (
				name.startsWith("on") ||
				localName.startsWith("on") ||
				(isUrlBearing && !isSafeSvgHref(attr.value))
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

export type MermaidInitializationRuntime = Readonly<{
	initialize?: (options: Record<string, unknown>) => void;
}>;

const MERMAID_LABEL_FONT_FAMILY = '"trebuchet ms", verdana, arial, sans-serif';
const MERMAID_LABEL_GEOMETRY_CSS = `
.node .label,
.node .label *,
.edgeLabel,
.edgeLabel *,
foreignObject > div,
foreignObject > div * {
  box-sizing: border-box !important;
  font-family: ${MERMAID_LABEL_FONT_FAMILY} !important;
  font-size: 16px !important;
  font-weight: 400 !important;
  line-height: 20px !important;
  letter-spacing: normal !important;
  word-spacing: normal !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
}

foreignObject > div {
  display: table-cell !important;
}`;
const initializedMermaidRuntimes = new WeakSet<object>();

/**
 * Mirror the single formal-Preview Mermaid configuration exactly (including
 * flowchart padding and label-geometry CSS) so visual mode never degrades a
 * runtime the shared enhancement owner already configured.
 */
export function ensureMermaidInitialized(
	mermaid: MermaidInitializationRuntime,
): void {
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
			flowchart: { diagramPadding: 12 },
			themeCSS: MERMAID_LABEL_GEOMETRY_CSS,
		});
	} catch {
		// Minimal runtimes or test mocks may reject re-initialization.
	}
}
