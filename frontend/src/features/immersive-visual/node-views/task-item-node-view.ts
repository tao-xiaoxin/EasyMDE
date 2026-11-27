import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
	EditorView,
	NodeView,
	NodeViewConstructor,
	ViewMutationRecord,
} from "prosemirror-view";
import { subscribeVisualEditableState } from "./visual-view-events";

export type TaskItemNodeViewOptions = Readonly<{
	checkboxAriaLabel?: string;
}>;

const TASK_ITEM_CLASS = "task-list-item";
const TASK_CHECKBOX_CLASS = "task-list-item-checkbox";
const TASK_CONTENT_CLASS = "easymde-task-item-content";
const DEFAULT_CHECKBOX_ARIA_LABEL = "Toggle task completion";

function readCheckedAttr(node: ProseMirrorNode): boolean {
	return Boolean(node.attrs.checked);
}

function resolveTaskItemPosition(
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
	const resolvedNode = view.state.doc.nodeAt(pos);
	return resolvedNode && resolvedNode.type.name === expectedTypeName
		? pos
		: null;
}

class TaskItemNodeView implements NodeView {
	readonly dom: HTMLLIElement;
	readonly contentDOM: HTMLDivElement;
	private readonly checkbox: HTMLInputElement;
	private node: ProseMirrorNode;
	private readonly view: EditorView;
	private readonly getPos: () => number | undefined;
	private readonly onMouseDown: (event: MouseEvent) => void;
	private readonly onClick: (event: MouseEvent) => void;
	private readonly onChange: () => void;
	private readonly unsubscribeEditable: () => void;
	private destroyed = false;

	constructor(
		node: ProseMirrorNode,
		view: EditorView,
		getPos: () => number | undefined,
		options: TaskItemNodeViewOptions,
	) {
		this.node = node;
		this.view = view;
		this.getPos = getPos;

		const doc = view.dom.ownerDocument;
		this.dom = doc.createElement("li");
		this.dom.className = TASK_ITEM_CLASS;

		this.checkbox = doc.createElement("input");
		this.checkbox.type = "checkbox";
		this.checkbox.className = TASK_CHECKBOX_CLASS;
		this.checkbox.setAttribute("contenteditable", "false");
		this.checkbox.setAttribute(
			"aria-label",
			options.checkboxAriaLabel && options.checkboxAriaLabel.length > 0
				? options.checkboxAriaLabel
				: DEFAULT_CHECKBOX_ARIA_LABEL,
		);

		this.contentDOM = doc.createElement("div");
		this.contentDOM.className = TASK_CONTENT_CLASS;

		this.dom.appendChild(this.checkbox);
		this.dom.appendChild(this.contentDOM);

		this.syncCheckedState(readCheckedAttr(node));

		this.onMouseDown = (event: MouseEvent) => {
			event.preventDefault();
		};

		this.onClick = (event: MouseEvent) => {
			event.stopPropagation();
			if (!this.view.editable) {
				event.preventDefault();
				this.syncCheckedState(readCheckedAttr(this.node));
				return;
			}
			// Do not call preventDefault() when editable: HTML checkbox canceled
			// activation steps revert `checkbox.checked` after the click event.
			this.setChecked(!readCheckedAttr(this.node));
		};

		this.onChange = () => {
			const desired = this.checkbox.checked;
			const current = readCheckedAttr(this.node);
			if (!this.view.editable) {
				this.syncCheckedState(current);
				return;
			}
			if (desired !== current) {
				this.setChecked(desired);
			}
		};

		this.checkbox.addEventListener("mousedown", this.onMouseDown);
		this.checkbox.addEventListener("click", this.onClick);
		this.checkbox.addEventListener("change", this.onChange);
		this.unsubscribeEditable = subscribeVisualEditableState(view, () => {
			if (this.destroyed) return;
			this.syncCheckedState(readCheckedAttr(this.node));
		});
	}

	private syncCheckedState(checked: boolean): void {
		const checkedAttr = checked ? "true" : "false";
		this.dom.setAttribute("data-checked", checkedAttr);
		this.checkbox.checked = checked;
		this.checkbox.setAttribute("aria-checked", checkedAttr);
		if (checked) {
			this.checkbox.setAttribute("checked", "");
		} else {
			this.checkbox.removeAttribute("checked");
		}
		this.checkbox.disabled = !this.view.editable;
	}

	private setChecked(nextChecked: boolean): void {
		if (!this.view.editable) {
			this.syncCheckedState(readCheckedAttr(this.node));
			return;
		}
		const pos = resolveTaskItemPosition(
			this.getPos,
			this.view,
			this.node.type.name,
		);
		if (pos === null) {
			this.syncCheckedState(readCheckedAttr(this.node));
			return;
		}
		const currentNode = this.view.state.doc.nodeAt(pos);
		if (!currentNode || currentNode.type !== this.node.type) {
			return;
		}
		if (readCheckedAttr(currentNode) === nextChecked) {
			this.syncCheckedState(nextChecked);
			return;
		}
		const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
			...currentNode.attrs,
			checked: nextChecked,
		});
		this.view.dispatch(tr);
	}

	update(nextNode: ProseMirrorNode): boolean {
		if (nextNode.type !== this.node.type) {
			return false;
		}
		this.node = nextNode;
		this.syncCheckedState(readCheckedAttr(nextNode));
		return true;
	}

	stopEvent(event: Event): boolean {
		return event.target === this.checkbox;
	}

	ignoreMutation(mutation: ViewMutationRecord): boolean {
		if (mutation.type === "selection") {
			return false;
		}
		if (mutation.target === this.checkbox) {
			return true;
		}
		return mutation.type === "attributes" && mutation.target === this.dom;
	}

	destroy(): void {
		this.destroyed = true;
		this.unsubscribeEditable();
		this.checkbox.removeEventListener("mousedown", this.onMouseDown);
		this.checkbox.removeEventListener("click", this.onClick);
		this.checkbox.removeEventListener("change", this.onChange);
	}
}

export function createTaskItemNodeView(
	options: TaskItemNodeViewOptions = {},
): NodeViewConstructor {
	return (node, view, getPos) =>
		new TaskItemNodeView(node, view, getPos, options);
}
