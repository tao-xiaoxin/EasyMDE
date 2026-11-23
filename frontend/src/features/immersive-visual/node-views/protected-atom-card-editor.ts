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
/** Functions other than `url()` that can fetch a remote resource. */
const UNSAFE_CSS_FUNCTION_PATTERN =
	/(?:^|[^A-Za-z0-9_-])(?:-webkit-)?(?:image-set|src)\s*\(/i;
/** SVG presentation attributes whose values may carry CSS `url(...)`. */
const SVG_URL_REFERENCE_ATTRS = new Set([
	"clip-path",
	"cursor",
	"fill",
	"filter",
	"marker",
	"marker-end",
	"marker-mid",
	"marker-start",
	"mask",
	"stroke",
]);

type CssRewriteContext = Readonly<{
	idMap: ReadonlyMap<string, string>;
	sameDocumentUrl: string;
}>;
type CssUrlToken = Readonly<{
	end: number;
	quote: string;
	target: string | null;
}>;

function isCssIdentChar(ch: string | undefined): boolean {
	if (ch === undefined || ch.length === 0) return false;
	return /[A-Za-z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

function isCssWhitespace(ch: string | undefined): boolean {
	return ch !== undefined && /\s/.test(ch);
}

/** Index after a CSS comment or string starting at `start`, else `start`. */
function skipCssCommentOrString(css: string, start: number): number {
	if (css.startsWith("/*", start)) {
		const end = css.indexOf("*/", start + 2);
		return end < 0 ? css.length : end + 2;
	}
	const quote = css[start];
	if (quote !== '"' && quote !== "'") return start;
	let i = start + 1;
	while (i < css.length) {
		const ch = css[i];
		if (ch === "\\") {
			i += 2;
		} else if (ch === quote) {
			return i + 1;
		} else if (ch === "\n") {
			return i;
		} else {
			i += 1;
		}
	}
	return css.length;
}

/** Parse a `url(` token at `start`; `target` is null for a bad URL. */
function readCssUrlToken(css: string, start: number): CssUrlToken {
	let i = start + 4;
	while (isCssWhitespace(css[i])) i += 1;
	const opening = css[i];
	const quote = opening === '"' || opening === "'" ? opening : "";
	let target: string | null = null;
	if (quote.length > 0) {
		let j = i + 1;
		while (j < css.length && css[j] !== quote && css[j] !== "\n") {
			j += css[j] === "\\" ? 2 : 1;
		}
		if (css[j] === quote) target = css.slice(i + 1, j);
		i = css[j] === quote ? j + 1 : j;
	} else {
		let j = i;
		while (j < css.length && css[j] !== ")" && !/[\s"'(\\]/.test(css[j] ?? "")) {
			j += 1;
		}
		target = css.slice(i, j);
		i = j;
	}
	while (isCssWhitespace(css[i])) i += 1;
	if (target !== null && css[i] === ")") return { end: i + 1, quote, target };
	// Bad URL: consume through the balancing `)` and report no target.
	let depth = 1;
	for (; i < css.length; i += 1) {
		if (css[i] === "(") depth += 1;
		if (css[i] !== ")") continue;
		depth -= 1;
		if (depth === 0) return { end: i + 1, quote, target: null };
	}
	return { end: css.length, quote, target: null };
}

/** Same-document fragment ID of a `url()` target, or null for any other URL. */
function localCssFragmentId(
	target: string,
	sameDocumentUrl: string,
): string | null {
	const value = target.trim();
	const hashIndex = value.indexOf("#");
	if (hashIndex < 0 || hashIndex === value.length - 1) return null;
	if (
		hashIndex > 0 &&
		(sameDocumentUrl.length === 0 ||
			value.slice(0, hashIndex) !== sameDocumentUrl)
	) {
		return null;
	}
	const id = value.slice(hashIndex + 1);
	return /[\s"'()\\<>]/.test(id) ? null : id;
}

/**
 * Rewrite one declaration or value run: keep (and scope) same-document
 * fragment `url(#id)` references in any case or quoting, strip every other
 * `url(...)`, and drop the run when escapes or other fetching functions could
 * hide a remote load. Hex colors and other text are never touched.
 */
function rewriteCssValueRun(run: string, context: CssRewriteContext): string {
	let out = "";
	let i = 0;
	while (i < run.length) {
		const skipped = skipCssCommentOrString(run, i);
		if (skipped !== i) {
			out += run.slice(i, skipped);
			i = skipped;
			continue;
		}
		const ch = run[i] ?? "";
		if (ch === "\\") return "";
		if (
			run.slice(i, i + 4).toLowerCase() === "url(" &&
			!isCssIdentChar(run[i - 1])
		) {
			const token = readCssUrlToken(run, i);
			const id =
				token.target === null
					? null
					: localCssFragmentId(token.target, context.sameDocumentUrl);
			if (id !== null) {
				const mapped = context.idMap.get(id);
				out += mapped
					? `url(${token.quote}#${mapped}${token.quote})`
					: run.slice(i, token.end);
			}
			i = token.end;
			continue;
		}
		out += ch;
		i += 1;
	}
	return UNSAFE_CSS_FUNCTION_PATTERN.test(out) ? "" : out;
}

function escapeCssIdent(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i += 1) {
		const ch = value[i] ?? "";
		if (/[0-9]/.test(ch) && (i === 0 || (i === 1 && value[0] === "-"))) {
			out += `\\${ch.charCodeAt(0).toString(16)} `;
		} else {
			out += isCssIdentChar(ch) ? ch : `\\${ch}`;
		}
	}
	return out;
}

/** Rewrite whole `#ident` ID selectors outside strings and comments. */
function rewriteCssSelectorIds(
	selector: string,
	idMap: ReadonlyMap<string, string>,
): string {
	let out = "";
	let i = 0;
	while (i < selector.length) {
		const skipped = skipCssCommentOrString(selector, i);
		if (skipped !== i) {
			out += selector.slice(i, skipped);
			i = skipped;
			continue;
		}
		if (selector[i] !== "#") {
			out += selector[i];
			i += 1;
			continue;
		}
		let end = i + 1;
		while (isCssIdentChar(selector[end])) end += 1;
		const mapped =
			selector[end] === "\\"
				? undefined
				: idMap.get(selector.slice(i + 1, end));
		out += mapped ? `#${escapeCssIdent(mapped)}` : selector.slice(i, end);
		i = end;
	}
	return out;
}

/**
 * Dependency-free CSS walker. Segments end at top-level `;`, `{`, or `}`
 * outside comments, strings, and parentheses; a `{`-terminated segment is a
 * selector (or at-rule) prelude, every other segment is a declaration run.
 * Nested `@media { #id path { ... } }` therefore keeps selector context.
 */
function rewriteCssText(
	css: string,
	context: CssRewriteContext,
	mode: "declarations" | "stylesheet",
): string {
	let out = "";
	let segmentStart = 0;
	let parenDepth = 0;
	let i = 0;
	while (i < css.length) {
		const skipped = skipCssCommentOrString(css, i);
		if (skipped !== i) {
			i = skipped;
			continue;
		}
		const ch = css[i];
		if (ch === "(") parenDepth += 1;
		else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
		else if (
			parenDepth === 0 &&
			(ch === ";" || (mode === "stylesheet" && (ch === "{" || ch === "}")))
		) {
			const segment = css.slice(segmentStart, i);
			const isSelector = ch === "{" && !segment.trimStart().startsWith("@");
			out += isSelector
				? rewriteCssSelectorIds(segment, context.idMap)
				: rewriteCssValueRun(segment, context);
			out += ch;
			segmentStart = i + 1;
		}
		i += 1;
	}
	return out + rewriteCssValueRun(css.slice(segmentStart), context);
}

function sanitizeCssText(
	cssText: string,
	context: CssRewriteContext,
	mode: "declarations" | "stylesheet",
): string {
	return UNSAFE_STYLE_PATTERN.test(cssText)
		? ""
		: rewriteCssText(cssText, context, mode);
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

function removeAttr(element: Element, attr: Attr): void {
	if (attr.namespaceURI)
		element.removeAttributeNS(attr.namespaceURI, attr.localName);
	element.removeAttribute(attr.name);
}

function sanitizeSvgTree(root: Element, context: CssRewriteContext): void {
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
			} else if (name === "style" || SVG_URL_REFERENCE_ATTRS.has(localName)) {
				const safeValue = sanitizeCssText(attr.value, context, "declarations");
				if (safeValue.trim().length === 0) removeAttr(element, attr);
				else if (safeValue !== attr.value)
					element.setAttribute(attr.name, safeValue);
			}
		}
		if (tagName === "style") {
			element.textContent = sanitizeCssText(
				element.textContent ?? "",
				context,
				"stylesheet",
			);
		}
		for (let i = element.children.length - 1; i >= 0; i -= 1) {
			const child = element.children[i];
			if (child) stack.push(child);
		}
	}
}

const SVG_IDREF_LIST_ATTRS = new Set(["aria-labelledby", "aria-describedby"]);

function documentUrlWithoutHash(targetDocument: Document): string {
	const url = targetDocument.URL || "";
	const hashIndex = url.indexOf("#");
	return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

/**
 * Scope descendant SVG IDs so a hidden formal Preview rendering of the same
 * diagram cannot capture `url(#id)` marker, gradient, or clip references or
 * `#id` CSS selectors. The root `<svg id>` and literal CSS colors stay
 * untouched.
 */
function scopeSvgDescendantIds(
	svgElement: Element,
	scope: string,
	sameDocumentUrl: string,
): void {
	const idMap = new Map<string, string>();
	const descendants = Array.from(svgElement.querySelectorAll("[id]"));
	for (const element of descendants) {
		const oldId = element.getAttribute("id") ?? "";
		if (oldId.trim().length === 0) continue;
		if (
			oldId.startsWith(`${scope}__`) ||
			oldId.startsWith(`${scope}_`) ||
			oldId.startsWith(`${scope}-`)
		) {
			continue;
		}
		let newId = idMap.get(oldId);
		if (!newId) {
			newId = `${scope}__${oldId}`;
			idMap.set(oldId, newId);
		}
		element.setAttribute("id", newId);
	}
	if (idMap.size === 0) return;
	const context: CssRewriteContext = { idMap, sameDocumentUrl };
	const elements = [
		svgElement,
		...Array.from(svgElement.querySelectorAll("*")),
	];
	for (const element of elements) {
		for (const attr of Array.from(element.attributes)) {
			const name = attr.name.toLowerCase();
			const localName = (attr.localName || name).toLowerCase();
			if (name === "id") continue;
			const value = attr.value;
			let nextValue = value;
			if (localName === "href") {
				const trimmed = value.trim();
				const mapped = trimmed.startsWith("#")
					? idMap.get(trimmed.slice(1))
					: undefined;
				if (mapped) nextValue = `#${mapped}`;
			} else if (SVG_IDREF_LIST_ATTRS.has(name)) {
				nextValue = value
					.split(/\s+/)
					.filter((token) => token.length > 0)
					.map((token) => idMap.get(token) ?? token)
					.join(" ");
			} else if (name === "style" || SVG_URL_REFERENCE_ATTRS.has(localName)) {
				nextValue = rewriteCssText(value, context, "declarations");
			}
			if (nextValue === value) continue;
			if (attr.namespaceURI) {
				element.setAttributeNS(attr.namespaceURI, attr.name, nextValue);
			} else {
				element.setAttribute(attr.name, nextValue);
			}
		}
		if ((element.localName || "").toLowerCase() === "style") {
			const css = element.textContent ?? "";
			const nextCss = rewriteCssText(css, context, "stylesheet");
			if (nextCss !== css) element.textContent = nextCss;
		}
	}
}

export function sanitizeMermaidSvg(
	svgMarkup: string,
	targetDocument: Document,
	idScopePrefix?: string,
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
	const sameDocumentUrl = documentUrlWithoutHash(targetDocument);
	sanitizeSvgTree(svgElement, { idMap: new Map(), sameDocumentUrl });
	const scope =
		idScopePrefix && idScopePrefix.trim().length > 0
			? idScopePrefix.trim()
			: (svgElement.getAttribute("id") || "").trim();
	if (scope.length > 0) {
		scopeSvgDescendantIds(svgElement, scope, sameDocumentUrl);
	}
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
