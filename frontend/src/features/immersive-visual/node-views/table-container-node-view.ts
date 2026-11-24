import type { Node as ProseMirrorNode } from "prosemirror-model";
import { updateColumnsOnResize } from "prosemirror-tables";
import type {
	EditorView,
	NodeView,
	NodeViewConstructor,
	ViewMutationRecord,
} from "prosemirror-view";

export type TableContainerNodeViewOptions = Readonly<{
	/**
	 * Fallback column minimum width (in CSS pixels) used by `prosemirror-tables`
	 * when resizing columns. Defaults to `25`.
	 */
	defaultCellMinWidth?: number;
}>;

const TABLE_CONTAINER_CLASS = "table-container easymde-table-container";
const TABLE_ALIGN_ANNOTATION_ATTR = "data-easymde-table-align-annotation";
const DEFAULT_CELL_MIN_WIDTH = 25;

function readAlignAnnotation(node: ProseMirrorNode): string {
	return typeof node.attrs.alignAnnotation === "string"
		? node.attrs.alignAnnotation.trim()
		: "";
}

function normalizeDefaultCellMinWidth(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.round(value)
		: DEFAULT_CELL_MIN_WIDTH;
}

function hasExplicitColumnWidth(tableNode: ProseMirrorNode): boolean {
	const firstRow = tableNode.firstChild;
	if (!firstRow) {
		return false;
	}
	for (let i = 0; i < firstRow.childCount; i += 1) {
		const colwidth = firstRow.child(i).attrs.colwidth as unknown;
		if (
			Array.isArray(colwidth) &&
			colwidth.some((width) => typeof width === "number" && width > 0)
		) {
			return true;
		}
	}
	return false;
}

function syncTableColumns(
	tableNode: ProseMirrorNode,
	colgroup: HTMLTableColElement,
	table: HTMLTableElement,
	defaultCellMinWidth: number,
): void {
	updateColumnsOnResize(tableNode, colgroup, table, defaultCellMinWidth);
	// When no column has been explicitly resized, let EasyMDE's article themes
	// own table width without forcing an oversized inline min-width.
	if (!hasExplicitColumnWidth(tableNode)) {
		table.style.removeProperty("width");
		table.style.removeProperty("min-width");
	}
}

/**
 * ProseMirror NodeView for `table` nodes that wraps `<table><colgroup/><tbody/></table>`
 * inside `<section class="table-container easymde-table-container">` so all 46 EasyMDE
 * article themes apply identically while remaining 100% compatible with `prosemirror-tables`.
 */
export class TableContainerNodeView implements NodeView {
	node: ProseMirrorNode;
	readonly defaultCellMinWidth: number;
	readonly dom: HTMLElement;
	readonly table: HTMLTableElement;
	readonly colgroup: HTMLTableColElement;
	readonly contentDOM: HTMLTableSectionElement;

	constructor(
		node: ProseMirrorNode,
		defaultCellMinWidth: number = DEFAULT_CELL_MIN_WIDTH,
		view?: EditorView,
	) {
		this.node = node;
		this.defaultCellMinWidth =
			normalizeDefaultCellMinWidth(defaultCellMinWidth);

		const doc = view?.dom.ownerDocument ?? document;
		this.dom = doc.createElement("section");
		this.dom.className = TABLE_CONTAINER_CLASS;

		this.table = doc.createElement("table");
		this.table.style.setProperty(
			"--default-cell-min-width",
			`${this.defaultCellMinWidth}px`,
		);

		this.colgroup = doc.createElement("colgroup");
		this.contentDOM = doc.createElement("tbody");

		this.table.appendChild(this.colgroup);
		this.table.appendChild(this.contentDOM);
		this.dom.appendChild(this.table);

		this.syncAnnotation(node);
		syncTableColumns(node, this.colgroup, this.table, this.defaultCellMinWidth);
	}

	private syncAnnotation(node: ProseMirrorNode): void {
		const annotation = readAlignAnnotation(node);
		if (annotation.length > 0) {
			if (this.dom.getAttribute(TABLE_ALIGN_ANNOTATION_ATTR) !== annotation) {
				this.dom.setAttribute(TABLE_ALIGN_ANNOTATION_ATTR, annotation);
			}
		} else {
			this.dom.removeAttribute(TABLE_ALIGN_ANNOTATION_ATTR);
		}
	}

	update(nextNode: ProseMirrorNode): boolean {
		if (nextNode.type !== this.node.type) {
			return false;
		}
		this.node = nextNode;
		this.syncAnnotation(nextNode);
		syncTableColumns(
			nextNode,
			this.colgroup,
			this.table,
			this.defaultCellMinWidth,
		);
		return true;
	}

	ignoreMutation(record: ViewMutationRecord): boolean {
		if (record.type === "selection") {
			return false;
		}
		if (record.target === this.dom || record.target === this.table) {
			return record.type === "attributes";
		}
		return this.colgroup.contains(record.target);
	}
}

/**
 * Creates a ProseMirror `NodeViewConstructor` for `table` nodes wrapped in
 * EasyMDE's `.table-container.easymde-table-container` `<section>` element.
 */
export function createTableContainerNodeView(
	options: TableContainerNodeViewOptions = {},
): NodeViewConstructor {
	const defaultCellMinWidth = normalizeDefaultCellMinWidth(
		options.defaultCellMinWidth,
	);
	return (node, view) =>
		new TableContainerNodeView(node, defaultCellMinWidth, view);
}
