import type { EditorClipboardRichPayload } from "../../contracts/ports/editor-clipboard-port";
import type { SafePreviewHtml } from "../../contracts/ports/preview-request";

export type SimplifiedFormattingFailureCode =
	| "editor-simplified-formatting-html-invalid"
	| "editor-simplified-formatting-input-too-large"
	| "editor-simplified-formatting-node-limit"
	| "editor-simplified-formatting-output-too-large"
	| "editor-simplified-formatting-parse-failed"
	| "editor-simplified-formatting-serialize-failed";

export type SimplifiedFormattingResult =
	| Readonly<{
			payload: EditorClipboardRichPayload;
			status: "converted";
	  }>
	| Readonly<{
			code: SimplifiedFormattingFailureCode;
			status: "failed";
	  }>;

export type SimplifiedFormattingDomParser = Readonly<{
	parseFromString: (source: string, mimeType: "text/html") => Document;
}>;

export type SimplifiedFormattingOptions = Readonly<{
	maxBytes?: number;
	maxNodes?: number;
	parser: SimplifiedFormattingDomParser;
}>;

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_NODES = 20_000;
const BLOCK_TAGS = new Set([
	"ADDRESS",
	"ARTICLE",
	"ASIDE",
	"BLOCKQUOTE",
	"DETAILS",
	"DIV",
	"DL",
	"FIELDSET",
	"FIGCAPTION",
	"FIGURE",
	"FOOTER",
	"FORM",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HEADER",
	"HR",
	"LI",
	"MAIN",
	"NAV",
	"OL",
	"P",
	"PRE",
	"SECTION",
	"TABLE",
	"TBODY",
	"TFOOT",
	"THEAD",
	"TR",
	"UL",
]);
const DECORATIVE_CLASSES = new Set([
	"easymde-code-copy__button",
	"easymde-code-copy__fallback",
	"easymde-code-copy__status",
	"easymde-code-line-number-gutter",
]);
const PRESERVED_ATTRIBUTES = new Set([
	"align",
	"alt",
	"checked",
	"colspan",
	"height",
	"href",
	"rowspan",
	"scope",
	"src",
	"start",
	"target",
	"title",
	"type",
	"width",
]);
const ALIGNMENT_TAGS = new Set(["COL", "COLGROUP", "TD", "TH", "TABLE"]);

type PlainTextSegment =
	| Readonly<{ kind: "text"; value: string }>
	| Readonly<{ kind: "break"; lines: 1 | 2 }>;

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const codePoint = value.codePointAt(index) ?? 0;
		if (codePoint > 0xffff) index += 1;
		bytes +=
			codePoint <= 0x7f
				? 1
				: codePoint <= 0x7ff
					? 2
					: codePoint <= 0xffff
						? 3
						: 4;
	}
	return bytes;
}

function validBound(value: number | undefined, fallback: number): boolean {
	return Number.isSafeInteger(value ?? fallback) && (value ?? fallback) > 0;
}

function classNames(element: Element): ReadonlyArray<string> {
	return (element.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean);
}

function isDecorative(element: Element): boolean {
	const classes = classNames(element);
	return (
		DECORATIVE_CLASSES.has(classes[0] ?? "") ||
		classes.some((name) => name.startsWith("easymde-code-copy__")) ||
		element.hasAttribute("data-easymde-code-copy")
	);
}

function countNodes(node: Node): number {
	let count = 1;
	node.childNodes.forEach((child) => {
		count += countNodes(child);
	});
	return count;
}

function normalizeAlignment(element: Element): void {
	if (!ALIGNMENT_TAGS.has(element.tagName) || element.hasAttribute("align"))
		return;
	const value = (element as HTMLElement).style
		.getPropertyValue("text-align")
		.trim()
		.toLowerCase();
	if (value && ["left", "center", "right", "justify"].includes(value)) {
		element.setAttribute("align", value);
	}
}

function isCheckboxInput(element: Element): boolean {
	return (
		"INPUT" === element.tagName &&
		"checkbox" === (element.getAttribute("type") ?? "").toLowerCase()
	);
}

function isBlockElement(element: Element | null): boolean {
	return Boolean(
		element && ("BODY" === element.tagName || BLOCK_TAGS.has(element.tagName)),
	);
}

function adjacentElement(
	node: Node,
	direction: "previousSibling" | "nextSibling",
): Element | null {
	let sibling = node[direction];
	while (sibling) {
		if (sibling.nodeType === 1) return sibling as Element;
		if (sibling.nodeType === 3 && !/^\s*$/u.test(sibling.nodeValue ?? "")) {
			return null;
		}
		sibling = sibling[direction];
	}
	return null;
}

function isLayoutWhitespace(node: Node): boolean {
	if (node.nodeType !== 3 || !/^\s*$/u.test(node.nodeValue ?? "")) {
		return false;
	}
	const parent = node.parentElement;
	if (!parent || "PRE" === parent.tagName || "CODE" === parent.tagName) {
		return false;
	}
	if (!isBlockElement(parent)) return false;
	return (
		isBlockElement(adjacentElement(node, "previousSibling")) ||
		isBlockElement(adjacentElement(node, "nextSibling"))
	);
}

function stripMetadata(root: Node): void {
	const children = Array.from(root.childNodes);
	for (const child of children) {
		if (child.nodeType !== 1) {
			if (child.nodeType === 8) child.parentNode?.removeChild(child);
			continue;
		}
		const element = child as Element;
		if (
			isDecorative(element) ||
			["SCRIPT", "STYLE", "TEMPLATE"].includes(element.tagName)
		) {
			element.parentNode?.removeChild(element);
			continue;
		}
		normalizeAlignment(element);
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const preserveCheckboxDisabled =
				"disabled" === name && isCheckboxInput(element);
			if (
				name === "class" ||
				name === "id" ||
				name === "style" ||
				name.startsWith("data-easymde-") ||
				(!PRESERVED_ATTRIBUTES.has(name) && !preserveCheckboxDisabled)
			) {
				element.removeAttribute(attribute.name);
			}
		}
		stripMetadata(element);
	}
}

function appendPlainText(
	node: Node,
	output: PlainTextSegment[],
	preserveWhitespace = false,
): void {
	if (node.nodeType === 3) {
		if (!preserveWhitespace && isLayoutWhitespace(node)) return;
		output.push({ kind: "text", value: node.nodeValue ?? "" });
		return;
	}
	if (node.nodeType !== 1) return;
	const element = node as Element;
	const tag = element.tagName;
	if ("BR" === tag) {
		output.push({ kind: "text", value: "\n" });
		return;
	}
	if ("IMG" === tag) {
		const alt = element.getAttribute("alt");
		const title = element.getAttribute("title");
		const src = element.getAttribute("src");
		const fallback = alt || title || src;
		if (fallback) output.push({ kind: "text", value: fallback });
		return;
	}
	if (isCheckboxInput(element)) {
		output.push({
			kind: "text",
			value: element.hasAttribute("checked") ? "[x] " : "[ ] ",
		});
		return;
	}
	if ("HR" === tag) {
		output.push({ kind: "break", lines: 2 });
		return;
	}
	if ("TR" === tag) {
		const cells = Array.from(element.children).filter((child) =>
			["TD", "TH"].includes(child.tagName),
		);
		cells.forEach((cell, index) => {
			if (index > 0) output.push({ kind: "text", value: "\t" });
			appendPlainText(cell, output);
		});
		output.push({ kind: "break", lines: 1 });
		return;
	}
	const preserveChildWhitespace =
		preserveWhitespace || "PRE" === tag || "CODE" === tag;
	for (const child of Array.from(element.childNodes)) {
		appendPlainText(child, output, preserveChildWhitespace);
	}
	if (BLOCK_TAGS.has(tag)) {
		output.push({ kind: "break", lines: "LI" === tag ? 1 : 2 });
	}
}

function plainText(root: Document): string {
	const output: PlainTextSegment[] = [];
	for (const child of Array.from(root.body.childNodes))
		appendPlainText(child, output);

	let text = "";
	let pendingBreak: 1 | 2 | null = null;
	for (const segment of output) {
		if ("break" === segment.kind) {
			pendingBreak = Math.max(pendingBreak ?? 0, segment.lines) as 1 | 2;
			continue;
		}
		if (pendingBreak) {
			text += "\n".repeat(pendingBreak);
			pendingBreak = null;
		}
		text += segment.value.replace(/\r\n?/gu, "\n");
	}
	return text;
}

function serializedChildren(root: Document): string {
	return Array.from(root.body.childNodes)
		.map((node) => {
			if (node.nodeType === 3) {
				const holder = root.createElement("span");
				holder.textContent = node.nodeValue ?? "";
				return holder.innerHTML;
			}
			if (node.nodeType === 1) return (node as Element).outerHTML;
			return "";
		})
		.join("");
}

export function createSimplifiedFormattingPayload(
	html: SafePreviewHtml,
	options: SimplifiedFormattingOptions,
): SimplifiedFormattingResult {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
	if (
		!validBound(maxBytes, DEFAULT_MAX_BYTES) ||
		!validBound(maxNodes, DEFAULT_MAX_NODES)
	) {
		return {
			code: "editor-simplified-formatting-html-invalid",
			status: "failed",
		};
	}
	if ("string" !== typeof html) {
		return {
			code: "editor-simplified-formatting-html-invalid",
			status: "failed",
		};
	}
	if (utf8ByteLength(html) > maxBytes) {
		return {
			code: "editor-simplified-formatting-input-too-large",
			status: "failed",
		};
	}

	let document: Document;
	try {
		document = options.parser.parseFromString(html, "text/html");
	} catch {
		return {
			code: "editor-simplified-formatting-parse-failed",
			status: "failed",
		};
	}
	if (!document?.body || document.querySelector("parsererror")) {
		return {
			code: "editor-simplified-formatting-parse-failed",
			status: "failed",
		};
	}
	if (countNodes(document.body) > maxNodes) {
		return {
			code: "editor-simplified-formatting-node-limit",
			status: "failed",
		};
	}

	try {
		stripMetadata(document.body);
		const outputHtml = serializedChildren(document);
		const outputText = plainText(document);
		if (
			utf8ByteLength(outputHtml) > maxBytes ||
			utf8ByteLength(outputText) > maxBytes
		) {
			return {
				code: "editor-simplified-formatting-output-too-large",
				status: "failed",
			};
		}
		return {
			payload: { html: outputHtml, text: outputText },
			status: "converted",
		};
	} catch {
		return {
			code: "editor-simplified-formatting-serialize-failed",
			status: "failed",
		};
	}
}
