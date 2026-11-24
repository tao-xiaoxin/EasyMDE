/**
 * Extracted raw-source card editor for protected atoms.
 *
 * Owns the multiline `<textarea>` / single-line `<input>` chrome, the
 * Save/Cancel controls, and card-local IME composition isolation:
 * `compositionstart`, `compositionupdate`, and `compositionend` are stopped at
 * the card boundary so a `<textarea>` inside a `contenteditable="false"`
 * NodeView can never leak into the outer ProseMirror composition lifecycle.
 */

export const MONOSPACE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

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
