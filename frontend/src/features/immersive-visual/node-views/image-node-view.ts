import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type {
	EditorView,
	NodeView,
	NodeViewConstructor,
} from "prosemirror-view";
import {
	isValidVisualImageScale,
	sanitizeDomUrl,
	type VisualImageScale,
} from "../visual-schema";

export type ImageNodeViewOptions = Readonly<{
	selectionRingColor?: string;
}>;

const IMAGE_BASE_CLASS = "easymde-visual-image";
const IMAGE_SELECTED_CLASS = "easymde-visual-image-selected";
const PROSEMIRROR_SELECTED_CLASS = "ProseMirror-selectednode";
const DEFAULT_IMAGE_SELECTION_SHADOW = "0 0 0 3px rgba(34, 113, 177, 0.28)";
const IMAGE_SELECTION_RADIUS = "3px";

function readStringAttr(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readOptionalTitleAttr(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readScaleAttr(value: unknown): VisualImageScale | null {
	return isValidVisualImageScale(value) ? value : null;
}

function resolveImagePosition(
	getPos: () => number | undefined,
	view: EditorView,
	nodeTypeName: string,
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
	return resolvedNode && resolvedNode.type.name === nodeTypeName ? pos : null;
}

class ImageNodeView implements NodeView {
	readonly dom: HTMLImageElement;
	private node: ProseMirrorNode;
	private readonly view: EditorView;
	private readonly getPos: () => number | undefined;
	private readonly selectionShadow: string;
	private selected = false;
	private readonly onMouseDown: (event: MouseEvent) => void;
	private readonly onClick: (event: MouseEvent) => void;

	constructor(
		node: ProseMirrorNode,
		view: EditorView,
		getPos: () => number | undefined,
		options: ImageNodeViewOptions,
	) {
		this.node = node;
		this.view = view;
		this.getPos = getPos;
		this.selectionShadow = options.selectionRingColor
			? `0 0 0 3px ${options.selectionRingColor}`
			: DEFAULT_IMAGE_SELECTION_SHADOW;

		const doc = view.dom.ownerDocument;
		this.dom = doc.createElement("img");
		this.dom.className = IMAGE_BASE_CLASS;
		this.dom.draggable = true;

		this.syncAttributes(node);

		this.onMouseDown = (event: MouseEvent) => {
			if (event.button !== 0) {
				return;
			}
			this.selectInEditor();
		};

		this.onClick = (event: MouseEvent) => {
			if (event.button !== 0) {
				return;
			}
			this.selectInEditor();
		};

		this.dom.addEventListener("mousedown", this.onMouseDown);
		this.dom.addEventListener("click", this.onClick);
	}

	private syncAttributes(node: ProseMirrorNode): void {
		const safeSrc = sanitizeDomUrl(readStringAttr(node.attrs.src));
		if (safeSrc !== null) {
			if (this.dom.getAttribute("src") !== safeSrc) {
				this.dom.setAttribute("src", safeSrc);
			}
		} else {
			this.dom.removeAttribute("src");
		}

		const alt = readStringAttr(node.attrs.alt);
		if (this.dom.getAttribute("alt") !== alt) {
			this.dom.setAttribute("alt", alt);
		}

		const title = readOptionalTitleAttr(node.attrs.title);
		if (title !== null) {
			if (this.dom.getAttribute("title") !== title) {
				this.dom.setAttribute("title", title);
			}
		} else {
			this.dom.removeAttribute("title");
		}

		const scale = readScaleAttr(node.attrs.scale);
		if (scale !== null) {
			const scaleText = String(scale);
			this.dom.setAttribute("width", `${scaleText}%`);
			this.dom.setAttribute("data-easymde-image-scale", scaleText);
			this.dom.style.width = `${scaleText}%`;
			this.dom.style.height = "auto";
		} else {
			this.dom.removeAttribute("width");
			this.dom.removeAttribute("data-easymde-image-scale");
			this.dom.style.removeProperty("width");
			this.dom.style.removeProperty("height");
		}
	}

	private applySelectionVisuals(): void {
		if (this.selected) {
			this.dom.classList.add(IMAGE_SELECTED_CLASS, PROSEMIRROR_SELECTED_CLASS);
			this.dom.setAttribute("data-easymde-visual-image-selected", "1");
			this.dom.style.boxShadow = this.selectionShadow;
			this.dom.style.borderRadius = IMAGE_SELECTION_RADIUS;
			return;
		}
		this.dom.classList.remove(IMAGE_SELECTED_CLASS, PROSEMIRROR_SELECTED_CLASS);
		this.dom.removeAttribute("data-easymde-visual-image-selected");
		this.dom.style.removeProperty("box-shadow");
		this.dom.style.removeProperty("border-radius");
	}

	private selectInEditor(): void {
		const pos = resolveImagePosition(
			this.getPos,
			this.view,
			this.node.type.name,
		);
		if (pos === null) {
			return;
		}
		const currentSelection = this.view.state.selection;
		if (
			currentSelection instanceof NodeSelection &&
			currentSelection.from === pos
		) {
			return;
		}
		const nextSelection = NodeSelection.create(this.view.state.doc, pos);
		this.view.dispatch(this.view.state.tr.setSelection(nextSelection));
		if (this.view.editable) {
			this.view.focus();
		}
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
		if (nextNode.type !== this.node.type) {
			return false;
		}
		this.node = nextNode;
		this.syncAttributes(nextNode);
		this.applySelectionVisuals();
		return true;
	}

	stopEvent(event: Event): boolean {
		if (event.type === "click" || event.type === "mousedown") {
			return !(event instanceof MouseEvent) || event.button === 0;
		}
		return false;
	}

	ignoreMutation(): boolean {
		return true;
	}

	destroy(): void {
		this.dom.removeEventListener("mousedown", this.onMouseDown);
		this.dom.removeEventListener("click", this.onClick);
	}
}

export function createImageNodeView(
	options: ImageNodeViewOptions = {},
): NodeViewConstructor {
	return (node, view, getPos) => new ImageNodeView(node, view, getPos, options);
}
