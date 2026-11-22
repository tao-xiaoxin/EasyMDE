import {
	type DOMOutputSpec,
	type MarkSpec,
	type NodeSpec,
	Schema,
} from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";
import type { VisualEditorImageScalePercentage } from "../../contracts/visual-editor";

export type VisualImageScale = VisualEditorImageScalePercentage;

export const VISUAL_IMAGE_SCALES: ReadonlyArray<VisualImageScale> = [
	25, 33, 50, 67, 100, 150, 200,
];

export type TableTextAlign = "left" | "center" | "right" | null;
export type ProtectedBlockKind = "math" | "mermaid" | "toc" | "footnotes" | "raw";
export type ProtectedInlineKind = "math-inline" | "footnote-ref" | "raw-inline";

export type VisualNodeName =
	| "doc"
	| "paragraph"
	| "heading"
	| "blockquote"
	| "bullet_list"
	| "ordered_list"
	| "task_list"
	| "list_item"
	| "task_item"
	| "code_block"
	| "horizontal_rule"
	| "table"
	| "table_row"
	| "table_cell"
	| "table_header"
	| "protected_block"
	| "text"
	| "hard_break"
	| "image"
	| "protected_inline";

export type VisualMarkName = "link" | "em" | "strong" | "strike" | "code";

const PROTECTED_BLOCK_KINDS: ReadonlyArray<ProtectedBlockKind> = [
	"math",
	"mermaid",
	"toc",
	"footnotes",
	"raw",
];

const PROTECTED_INLINE_KINDS: ReadonlyArray<ProtectedInlineKind> = [
	"math-inline",
	"footnote-ref",
	"raw-inline",
];

const UNSAFE_URL_PROTOCOL_PATTERN =
	/^\s*(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i;

export function isValidVisualImageScale(value: unknown): value is VisualImageScale {
	return typeof value === "number" && VISUAL_IMAGE_SCALES.includes(value as VisualImageScale);
}

export function isValidTableTextAlign(value: unknown): value is TableTextAlign {
	return value === null || value === "left" || value === "center" || value === "right";
}

export function normalizeProtectedBlockKind(value: unknown): ProtectedBlockKind {
	return typeof value === "string" && PROTECTED_BLOCK_KINDS.includes(value as ProtectedBlockKind)
		? (value as ProtectedBlockKind)
		: "raw";
}

export function normalizeProtectedInlineKind(value: unknown): ProtectedInlineKind {
	return typeof value === "string" && PROTECTED_INLINE_KINDS.includes(value as ProtectedInlineKind)
		? (value as ProtectedInlineKind)
		: "raw-inline";
}

export function normalizeHeadingLevel(value: unknown): number {
	return typeof value === "number" && Number.isInteger(value)
		? Math.min(6, Math.max(1, value))
		: 1;
}

export function sanitizeFenceChar(value: unknown): "`" | "~" {
	return value === "~" ? "~" : "`";
}

export function sanitizeFenceLength(value: unknown): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 3 ? value : 3;
}

export function sanitizeDomUrl(rawUrl: string): string | null {
	const trimmed = rawUrl.trim();
	if (trimmed.length === 0 || UNSAFE_URL_PROTOCOL_PATTERN.test(trimmed)) {
		return null;
	}
	return trimmed;
}

function readTableAlignFromDom(dom: HTMLElement): TableTextAlign {
	const alignAttr = dom.getAttribute("align")?.trim().toLowerCase() ?? "";
	if (isValidTableTextAlign(alignAttr)) {
		return alignAttr;
	}
	const styleAlign = dom.style.textAlign.trim().toLowerCase();
	return isValidTableTextAlign(styleAlign) ? styleAlign : null;
}

function writeTableAlignToDom(value: unknown, attrs: Record<string, unknown>): void {
	if (!isValidTableTextAlign(value) || value === null) {
		return;
	}
	attrs.align = value;
	const existing = typeof attrs.style === "string" ? attrs.style : "";
	const rule = `text-align:${value}`;
	attrs.style = existing ? `${existing};${rule}` : rule;
}

function validateColumnAlignments(value: unknown): void {
	if (value === null) {
		return;
	}
	if (!Array.isArray(value) || value.some((entry) => !isValidTableTextAlign(entry))) {
		throw new TypeError("columnAlignments must be null or an array of TableTextAlign values");
	}
}

function parseCodeBlockLanguageFromDom(dom: HTMLElement): string {
	const dataLanguage = dom.getAttribute("data-language")?.trim();
	if (dataLanguage) {
		return dataLanguage;
	}
	const codeChild = dom.querySelector("code");
	if (!codeChild) {
		return "";
	}
	for (const className of codeChild.className.split(/\s+/)) {
		if (className.startsWith("language-") && className.length > 9) {
			return className.slice(9);
		}
	}
	return "";
}

function protectedBlockExtraClasses(kind: ProtectedBlockKind): string {
	switch (kind) {
		case "math":
			return " easymde-math easymde-math-block";
		case "mermaid":
			return " easymde-mermaid";
		case "toc":
			return " easymde-toc";
		case "footnotes":
			return " easymde-footnotes";
		case "raw":
			return "";
	}
}

function protectedInlineExtraClasses(kind: ProtectedInlineKind): string {
	switch (kind) {
		case "math-inline":
			return " easymde-math easymde-math-inline";
		case "footnote-ref":
			return " easymde-footnote-ref";
		case "raw-inline":
			return "";
	}
}

const rawTableNodes = tableNodes({
	tableGroup: "block",
	cellContent: "paragraph",
	cellAttributes: {
		textAlign: {
			default: null,
			validate(value: unknown) {
				if (!isValidTableTextAlign(value)) {
					throw new RangeError("Invalid table cell textAlign");
				}
			},
			getFromDOM: readTableAlignFromDom,
			setDOMAttr: writeTableAlignToDom,
		},
	},
});

const tableNodeSpec: NodeSpec = {
	...rawTableNodes.table,
	attrs: {
		alignAnnotation: { default: null },
		columnAlignments: { default: null, validate: validateColumnAlignments },
	},
	parseDOM: [
		{
			tag: "table",
			getAttrs(dom) {
				if (!(dom instanceof HTMLElement)) {
					return { alignAnnotation: null, columnAlignments: null };
				}
				const container = dom.closest("[data-easymde-table-align-annotation]");
				const rawAnnotation =
					dom.getAttribute("data-easymde-table-align-annotation") ??
					container?.getAttribute("data-easymde-table-align-annotation") ??
					"";
				const trimmed = rawAnnotation.trim();
				return { alignAnnotation: trimmed.length > 0 ? trimmed : null, columnAlignments: null };
			},
		},
	],
	toDOM(node): DOMOutputSpec {
		const rawAnnotation =
			typeof node.attrs.alignAnnotation === "string" ? node.attrs.alignAnnotation.trim() : "";
		const sectionAttrs: Record<string, string> = {
			class: "table-container easymde-table-container",
			...(rawAnnotation.length > 0 ? { "data-easymde-table-align-annotation": rawAnnotation } : {}),
		};
		return ["section", sectionAttrs, ["table", ["tbody", 0]]];
	},
};

const nodes: Record<VisualNodeName, NodeSpec> = {
	doc: { content: "block+" },

	paragraph: {
		content: "inline*",
		group: "block",
		parseDOM: [{ tag: "p" }],
		toDOM: (): DOMOutputSpec => ["p", 0],
	},

	heading: {
		attrs: { level: { default: 1 } },
		content: "inline*",
		group: "block",
		defining: true,
		parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
		toDOM: (node): DOMOutputSpec => [`h${normalizeHeadingLevel(node.attrs.level)}`, 0],
	},

	blockquote: {
		content: "block+",
		group: "block",
		defining: true,
		parseDOM: [{ tag: "blockquote" }],
		toDOM: (): DOMOutputSpec => ["blockquote", 0],
	},

	bullet_list: {
		content: "list_item+",
		group: "block",
		parseDOM: [{ tag: "ul:not(.contains-task-list):not(.task-list)" }],
		toDOM: (): DOMOutputSpec => ["ul", 0],
	},

	ordered_list: {
		attrs: { order: { default: 1 } },
		content: "list_item+",
		group: "block",
		parseDOM: [
			{
				tag: "ol",
				getAttrs(dom) {
					if (!(dom instanceof HTMLElement)) {
						return { order: 1 };
					}
					const parsed = Number.parseInt(dom.getAttribute("start") ?? "1", 10);
					return { order: Number.isInteger(parsed) && parsed > 0 ? parsed : 1 };
				},
			},
		],
		toDOM(node): DOMOutputSpec {
			const order =
				typeof node.attrs.order === "number" &&
				Number.isInteger(node.attrs.order) &&
				node.attrs.order > 0
					? node.attrs.order
					: 1;
			return order === 1 ? ["ol", 0] : ["ol", { start: String(order) }, 0];
		},
	},

	task_list: {
		content: "task_item+",
		group: "block",
		parseDOM: [{ tag: "ul.contains-task-list" }, { tag: "ul.task-list" }],
		toDOM: (): DOMOutputSpec => ["ul", { class: "contains-task-list" }, 0],
	},

	list_item: {
		content: "paragraph block*",
		defining: true,
		parseDOM: [{ tag: "li:not(.task-list-item)" }],
		toDOM: (): DOMOutputSpec => ["li", 0],
	},

	task_item: {
		attrs: { checked: { default: false } },
		content: "paragraph block*",
		defining: true,
		parseDOM: [
			{
				tag: "li.task-list-item",
				getAttrs(dom) {
					if (!(dom instanceof HTMLElement)) {
						return { checked: false };
					}
					const dataChecked = dom.getAttribute("data-checked");
					if (dataChecked === "true" || dataChecked === "false") {
						return { checked: dataChecked === "true" };
					}
					const checkbox = dom.querySelector('input[type="checkbox"]');
					return { checked: checkbox instanceof HTMLInputElement ? checkbox.checked : false };
				},
			},
		],
		toDOM: (node): DOMOutputSpec => [
			"li",
			{ class: "task-list-item", "data-checked": node.attrs.checked ? "true" : "false" },
			0,
		],
	},

	code_block: {
		attrs: {
			language: { default: "" },
			info: { default: "" },
			fenceChar: { default: "`" },
			fenceLength: { default: 3 },
		},
		content: "text*",
		marks: "",
		group: "block",
		code: true,
		defining: true,
		parseDOM: [
			{
				tag: "pre",
				preserveWhitespace: "full",
				getAttrs(dom) {
					const language = dom instanceof HTMLElement ? parseCodeBlockLanguageFromDom(dom) : "";
					return { language, info: language, fenceChar: "`", fenceLength: 3 };
				},
			},
		],
		toDOM(node): DOMOutputSpec {
			const language = typeof node.attrs.language === "string" ? node.attrs.language.trim() : "";
			const preAttrs: Record<string, string> = {
				class: "easymde-code-block",
				...(language.length > 0 ? { "data-language": language } : {}),
			};
			const codeAttrs: Record<string, string> =
				language.length > 0 ? { class: `language-${language}` } : {};
			return ["pre", preAttrs, ["code", codeAttrs, 0]];
		},
	},

	horizontal_rule: {
		group: "block",
		atom: true,
		selectable: true,
		parseDOM: [{ tag: "hr" }],
		toDOM: (): DOMOutputSpec => ["hr"],
	},

	table: tableNodeSpec,
	table_row: rawTableNodes.table_row,
	table_cell: rawTableNodes.table_cell,
	table_header: rawTableNodes.table_header,

	protected_block: {
		group: "block",
		atom: true,
		selectable: true,
		isolating: true,
		attrs: { kind: { default: "raw" }, rawMarkdown: { default: "" } },
		parseDOM: [
			{
				tag: "div[data-easymde-protected-block]",
				getAttrs(dom) {
					if (!(dom instanceof HTMLElement)) {
						return { kind: "raw", rawMarkdown: "" };
					}
					return {
						kind: normalizeProtectedBlockKind(dom.getAttribute("data-easymde-protected-kind")),
						rawMarkdown:
							dom.getAttribute("data-easymde-visual-markdown-source") ?? dom.textContent ?? "",
					};
				},
			},
		],
		toDOM(node): DOMOutputSpec {
			const kind = normalizeProtectedBlockKind(node.attrs.kind);
			const rawMarkdown = typeof node.attrs.rawMarkdown === "string" ? node.attrs.rawMarkdown : "";
			return [
				"div",
				{
					class: `easymde-protected-block${protectedBlockExtraClasses(kind)}`,
					contenteditable: "false",
					"data-easymde-protected-block": "1",
					"data-easymde-protected-kind": kind,
					"data-easymde-visual-markdown-source": rawMarkdown,
				},
				rawMarkdown,
			];
		},
	},

	text: { group: "inline" },

	hard_break: {
		inline: true,
		group: "inline",
		selectable: false,
		parseDOM: [{ tag: "br" }],
		toDOM: (): DOMOutputSpec => ["br"],
	},

	image: {
		inline: true,
		group: "inline",
		draggable: true,
		attrs: {
			src: { default: "" },
			alt: { default: "" },
			title: { default: null },
			scale: { default: null },
		},
		parseDOM: [
			{
				tag: "img[src]",
				getAttrs(dom) {
					if (!(dom instanceof HTMLElement)) {
						return { src: "", alt: "", title: null, scale: null };
					}
					const rawScale = dom.getAttribute("data-easymde-image-scale");
					const parsedScale = rawScale ? Number.parseInt(rawScale, 10) : null;
					const rawTitle = dom.getAttribute("title");
					return {
						src: dom.getAttribute("src") ?? "",
						alt: dom.getAttribute("alt") ?? "",
						title: rawTitle && rawTitle.length > 0 ? rawTitle : null,
						scale: isValidVisualImageScale(parsedScale) ? parsedScale : null,
					};
				},
			},
		],
		toDOM(node): DOMOutputSpec {
			const safeSrc = sanitizeDomUrl(typeof node.attrs.src === "string" ? node.attrs.src : "") ?? "";
			const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
			const title =
				typeof node.attrs.title === "string" && node.attrs.title.length > 0 ? node.attrs.title : null;
			const scale = isValidVisualImageScale(node.attrs.scale) ? node.attrs.scale : null;
			const attrs: Record<string, string> = {
				src: safeSrc,
				alt,
				...(title !== null ? { title } : {}),
				...(scale !== null
					? {
							width: `${scale}%`,
							style: `width: ${scale}%; height: auto;`,
							"data-easymde-image-scale": String(scale),
						}
					: {}),
			};
			return ["img", attrs];
		},
	},

	protected_inline: {
		inline: true,
		group: "inline",
		atom: true,
		selectable: true,
		attrs: { kind: { default: "math-inline" }, rawMarkdown: { default: "" } },
		parseDOM: [
			{
				tag: "span[data-easymde-protected-inline]",
				getAttrs(dom) {
					if (!(dom instanceof HTMLElement)) {
						return { kind: "raw-inline", rawMarkdown: "" };
					}
					return {
						kind: normalizeProtectedInlineKind(dom.getAttribute("data-easymde-protected-kind")),
						rawMarkdown:
							dom.getAttribute("data-easymde-visual-markdown-source") ?? dom.textContent ?? "",
					};
				},
			},
		],
		toDOM(node): DOMOutputSpec {
			const kind = normalizeProtectedInlineKind(node.attrs.kind);
			const rawMarkdown = typeof node.attrs.rawMarkdown === "string" ? node.attrs.rawMarkdown : "";
			return [
				"span",
				{
					class: `easymde-protected-inline${protectedInlineExtraClasses(kind)}`,
					contenteditable: "false",
					"data-easymde-protected-inline": "1",
					"data-easymde-protected-kind": kind,
					"data-easymde-visual-markdown-source": rawMarkdown,
				},
				rawMarkdown,
			];
		},
	},
};

const marks: Record<VisualMarkName, MarkSpec> = {
	link: {
		attrs: { href: { default: "" }, title: { default: null } },
		inclusive: false,
		parseDOM: [
			{
				tag: "a[href]",
				getAttrs(dom) {
					if (!(dom instanceof HTMLElement)) {
						return { href: "", title: null };
					}
					const title = dom.getAttribute("title");
					return {
						href: dom.getAttribute("href") ?? "",
						title: title && title.length > 0 ? title : null,
					};
				},
			},
		],
		toDOM(mark): DOMOutputSpec {
			const safeHref = sanitizeDomUrl(typeof mark.attrs.href === "string" ? mark.attrs.href : "");
			const title =
				typeof mark.attrs.title === "string" && mark.attrs.title.length > 0 ? mark.attrs.title : null;
			const attrs: Record<string, string> = {
				...(safeHref !== null ? { href: safeHref } : {}),
				...(title !== null ? { title } : {}),
			};
			return ["a", attrs, 0];
		},
	},

	em: {
		parseDOM: [
			{ tag: "i" },
			{ tag: "em" },
			{ style: "font-style", getAttrs: (value) => (value === "italic" ? null : false) },
		],
		toDOM: (): DOMOutputSpec => ["em", 0],
	},

	strong: {
		parseDOM: [
			{ tag: "strong" },
			{
				tag: "b",
				getAttrs: (dom) =>
					dom instanceof HTMLElement && dom.style.fontWeight !== "normal" ? null : false,
			},
			{
				style: "font-weight",
				getAttrs: (value) =>
					typeof value === "string" && /^(?:bold(?:er)?|[5-9]\d{2})$/.test(value) ? null : false,
			},
		],
		toDOM: (): DOMOutputSpec => ["strong", 0],
	},

	strike: {
		parseDOM: [
			{ tag: "del" },
			{ tag: "s" },
			{ tag: "strike" },
			{
				style: "text-decoration",
				getAttrs: (value) =>
					typeof value === "string" && value.includes("line-through") ? null : false,
			},
		],
		toDOM: (): DOMOutputSpec => ["del", 0],
	},

	code: {
		code: true,
		excludes: "_",
		parseDOM: [{ tag: "code" }],
		toDOM: (): DOMOutputSpec => ["code", 0],
	},
};

export const visualEditorSchema = new Schema<VisualNodeName, VisualMarkName>({ nodes, marks });
