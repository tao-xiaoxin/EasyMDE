import {
	DOMSerializer,
	Fragment,
	type Node as ProseMirrorNode,
} from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import {
	htmlBlockLineCloses,
	matchHtmlBlockOpen,
} from "../../../shared/markdown/php-commonmark-block-helpers";
import {
	extractReferenceDefinitionLabels,
	parseInlineMarkdownFragment,
	parseMarkdownToVisualDoc,
} from "../markdown-parser";
import {
	ATX_HEADING,
	analyzeLine,
	type DetectableFence,
	detectFence,
	FOOTNOTE_DEF_LINE,
	isCommonMarkBlankLine,
	isFenceCloser,
	SETEXT_UNDERLINE,
	stripBlockquoteDepth,
	THEMATIC_BREAK,
} from "../markdown-prescanner";
import {
	createInlineHtmlScanState,
	execCommonMarkInlineHtmlToken,
	skipInlineCodeSpan,
} from "../markdown-prescanner-inline";
import { sanitizeDomUrl, visualEditorSchema } from "../visual-schema";
import {
	highlightCodeIntoElement,
	scheduleCodeFrameBackgroundSync,
} from "./code-block-node-view";
import { createAtomElement } from "./protected-atom-card-editor";
import { subscribeVisualDocumentUpdate } from "./visual-view-events";

const HTML_BLOCK_TAG_OPEN = /^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=\s|\/?>|$)/;
const INLINE_MARKDOWN_SPECIAL = /[*_`[\]!~\\$<&\r\n]/;
const RAW_BLOCK_HEADINGS_CACHE_MAX = 64;

type RawBlockHeading = Readonly<{ level: number; text: string }>;
const rawBlockHeadingsCache = new Map<
	string,
	ReadonlyArray<RawBlockHeading>
>();

export type NestedMathPreviewRenderer = (
	doc: Document,
	displayMode: boolean,
	rawMarkdown: string,
) => HTMLElement;

export type RawBlockPreviewOptions = Readonly<{
	fallbackLabel: string;
	footnotesLabel: string;
	renderNestedMath?: NestedMathPreviewRenderer;
	viewWindow: Window | null;
}>;

function isHtmlComment(raw: string): boolean {
	const trimmed = raw.trim();
	return trimmed.startsWith("<!--") && trimmed.endsWith("-->");
}

function footnoteDisplayLabel(raw: string): string {
	const match = /^\[\^([^\s\]]+)\]$/.exec(raw.trim());
	return match?.[1] ? `^${match[1]}` : raw;
}

/**
 * Strip CommonMark §6.6 inline raw HTML tokens (tags, comments, declarations,
 * PIs, CDATA) outside backtick code spans in O(L).
 */
function stripInlineHtmlOutsideCode(line: string): string {
	let out = "";
	let i = 0;
	const len = line.length;
	const scanState = createInlineHtmlScanState();
	while (i < len) {
		const ch = line[i] ?? "";
		if (ch === "`") {
			const codeEnd = skipInlineCodeSpan(line, i);
			out += line.slice(i, codeEnd);
			i = codeEnd;
			continue;
		}
		if (ch === "<") {
			const matched = execCommonMarkInlineHtmlToken(line, i, scanState);
			if (matched !== null) {
				i += matched.length;
				continue;
			}
		}
		out += ch;
		i += 1;
	}
	return out;
}

/**
 * Strip raw HTML blocks and inline tags from a protected `raw` Markdown block
 * using CommonMark `html_input: 'strip'` semantics (matching EasyMDE's `main`
 * PHP `MarkdownRenderer`), keeping inner blank-line-separated Markdown intact.
 */
export function stripCommonMarkHtmlForPreview(rawMarkdown: string): string {
	const lines = rawMarkdown.replace(/\r\n?/g, "\n").split("\n");
	const kept: string[] = [];
	let activeFence: DetectableFence | null = null;
	let inParagraph = false;
	let activeHtmlBlock: Readonly<{
		quoteDepth: number;
		type: 1 | 2 | 3 | 4 | 5 | 6 | 7;
	}> | null = null;

	for (const line of lines) {
		if (activeFence) {
			kept.push(line);
			if (isFenceCloser(line, activeFence)) activeFence = null;
			inParagraph = false;
			continue;
		}

		const analysis = analyzeLine(line, 0);
		const lineQuoteDepth = (analysis.prefix.match(/>/g) ?? []).length;

		if (activeHtmlBlock) {
			const afterQuote =
				activeHtmlBlock.quoteDepth > 0
					? stripBlockquoteDepth(line, activeHtmlBlock.quoteDepth)
					: line;
			if (afterQuote !== null) {
				if (activeHtmlBlock.type === 6 || activeHtmlBlock.type === 7) {
					if (isCommonMarkBlankLine(afterQuote)) {
						activeHtmlBlock = null;
						if (kept.length > 0) {
							kept.push(
								analysis.prefix.length > 0
									? analysis.prefix.replace(/[ \t]+$/, "")
									: "",
							);
						}
						inParagraph = false;
						continue;
					}
					inParagraph = false;
					continue;
				}
				if (htmlBlockLineCloses(activeHtmlBlock.type, afterQuote)) {
					activeHtmlBlock = null;
				}
				inParagraph = false;
				continue;
			}
			activeHtmlBlock = null;
		}

		if (isCommonMarkBlankLine(analysis.rest)) {
			inParagraph = false;
			if (kept.length > 0) {
				kept.push(
					analysis.prefix.length > 0
						? analysis.prefix.replace(/[ \t]+$/, "")
						: "",
				);
			}
			continue;
		}

		const isTopLevel = analysis.prefix.length === 0 && analysis.indent <= 3;

		const fence = detectFence(analysis);
		if (fence) {
			activeFence = fence;
			inParagraph = false;
			kept.push(line);
			continue;
		}

		if (analysis.indent <= 3 && analysis.content.startsWith("<")) {
			const htmlType = matchHtmlBlockOpen(analysis.content, !inParagraph);
			if (htmlType !== null) {
				if (
					htmlType === 6 ||
					htmlType === 7 ||
					!htmlBlockLineCloses(htmlType, analysis.content)
				) {
					activeHtmlBlock = { quoteDepth: lineQuoteDepth, type: htmlType };
				}
				inParagraph = false;
				continue;
			}
		}

		const isIndentedCodeLine: boolean =
			!inParagraph && analysis.prefix.length === 0 && analysis.indent >= 4;
		const isSetextUnderline: boolean =
			inParagraph && isTopLevel && SETEXT_UNDERLINE.test(analysis.content);
		const strippedLine = isIndentedCodeLine
			? line
			: `${analysis.prefix}${stripInlineHtmlOutsideCode(analysis.rest)}`;
		if (
			inParagraph &&
			isCommonMarkBlankLine(strippedLine.slice(analysis.prefix.length))
		) {
			// A stripped inline-only HTML line (e.g. standalone `<kbd>`) inside
			// an open paragraph must not emit a blank line and split the `<p>`.
			continue;
		}
		kept.push(strippedLine);
		inParagraph =
			!isIndentedCodeLine &&
			!isSetextUnderline &&
			!(
				analysis.indent <= 3 &&
				(ATX_HEADING.test(analysis.content) ||
					THEMATIC_BREAK.test(analysis.content))
			);
	}

	return kept
		.join("\n")
		.replace(/^(?:[ \t]*\n)+/, "")
		.replace(/(?:\n[ \t]*)+$/, "");
}

const baseSerializer = DOMSerializer.fromSchema(visualEditorSchema);

function createPreviewSerializer(
	doc: Document,
	viewWindow: Window | null,
	renderNestedMath: NestedMathPreviewRenderer | undefined,
	labels: Readonly<{ footnotes: string; raw: string }>,
	depth: number,
): DOMSerializer {
	return new DOMSerializer(
		{
			...baseSerializer.nodes,
			code_block(node) {
				const pre = createAtomElement(doc, "pre", "easymde-code-block");
				const language =
					typeof node.attrs.language === "string"
						? node.attrs.language.trim()
						: "";
				const code = doc.createElement("code");
				highlightCodeIntoElement(
					doc,
					code,
					node.textContent,
					language,
					viewWindow,
				);
				pre.appendChild(code);
				scheduleCodeFrameBackgroundSync(pre, code, viewWindow);
				return pre;
			},
			image(node) {
				const safeSrc = sanitizeDomUrl(
					typeof node.attrs.src === "string" ? node.attrs.src : "",
				);
				if (!safeSrc) return ["span", { "aria-hidden": "true" }];
				const img = doc.createElement("img");
				img.setAttribute("src", safeSrc);
				img.setAttribute(
					"alt",
					typeof node.attrs.alt === "string" ? node.attrs.alt : "",
				);
				const title =
					typeof node.attrs.title === "string" ? node.attrs.title : "";
				if (title) img.setAttribute("title", title);
				return img;
			},
			protected_block(node) {
				const kind = typeof node.attrs.kind === "string" ? node.attrs.kind : "";
				const raw =
					typeof node.attrs.rawMarkdown === "string"
						? node.attrs.rawMarkdown
						: "";
				if (kind === "math" && renderNestedMath) {
					return renderNestedMath(doc, true, raw);
				}
				if (kind === "footnotes") {
					return renderFootnotesBlockPreview(doc, raw, labels.footnotes);
				}
				if (kind === "raw" && depth < 3) {
					const inner = renderRawBlockPreviewInternal(
						doc,
						raw,
						{
							fallbackLabel: labels.raw,
							footnotesLabel: labels.footnotes,
							...(renderNestedMath ? { renderNestedMath } : {}),
							viewWindow,
						},
						depth + 1,
					);
					const wrapper = doc.createElement("div");
					wrapper.appendChild(inner);
					return wrapper;
				}
				return createAtomElement(doc, "div", "easymde-protected-fallback", raw);
			},
			protected_inline(node) {
				const kind = typeof node.attrs.kind === "string" ? node.attrs.kind : "";
				const raw =
					typeof node.attrs.rawMarkdown === "string"
						? node.attrs.rawMarkdown
						: "";
				if (kind === "footnote-ref") {
					return renderFootnoteRefPreview(doc, raw);
				}
				if (kind === "math-inline" && renderNestedMath) {
					return renderNestedMath(doc, false, raw);
				}
				return renderRawInlinePreview(doc, raw, labels, renderNestedMath);
			},
		},
		{
			...baseSerializer.marks,
			link(mark) {
				const safeHref = sanitizeDomUrl(
					typeof mark.attrs.href === "string" ? mark.attrs.href : "",
				);
				if (!safeHref) return ["span", 0];
				const title =
					typeof mark.attrs.title === "string" && mark.attrs.title.length > 0
						? mark.attrs.title
						: null;
				return [
					"a",
					{
						href: safeHref,
						tabindex: "-1",
						...(title !== null ? { title } : {}),
					},
					0,
				];
			},
		},
	);
}

function createCollapsedMetaChip(
	doc: Document,
	summaryText: string,
): HTMLElement {
	const chip = createAtomElement(
		doc,
		"div",
		"easymde-protected-meta-chip",
		summaryText,
	);
	chip.setAttribute("data-easymde-protected-collapsed", "1");
	return chip;
}

function collectReferenceLabels(rawMarkdown: string): string[] | null {
	return extractReferenceDefinitionLabels(rawMarkdown);
}

function collectFootnoteLabels(rawMarkdown: string): string[] {
	const labels: string[] = [];
	for (const line of rawMarkdown.replace(/\r\n?/g, "\n").split("\n")) {
		const match = FOOTNOTE_DEF_LINE.exec(line);
		if (match?.[1]) labels.push(`^${match[1]}`);
	}
	return labels;
}

export function renderRawInlinePreview(
	doc: Document,
	rawMarkdown: string,
	labels: Readonly<{ footnotes: string; raw: string }>,
	renderNestedMath?: NestedMathPreviewRenderer,
): HTMLElement {
	const comment = isHtmlComment(rawMarkdown);
	const visibleMarkdown = comment
		? ""
		: stripInlineHtmlOutsideCode(rawMarkdown);
	if (visibleMarkdown.length === 0) {
		const hidden = createAtomElement(
			doc,
			"span",
			"easymde-protected-inline-hidden",
		);
		hidden.setAttribute("aria-hidden", "true");
		return hidden;
	}
	// Strip HTML tags and render inner inline Markdown (e.g. `<u>*italic*</u>`)
	// via the visual schema's sanitized DOMSerializer, matching `html_input: 'strip'`.
	const span = createAtomElement(
		doc,
		"span",
		"easymde-protected-inline-rendered",
	);
	if (!INLINE_MARKDOWN_SPECIAL.test(visibleMarkdown)) {
		span.textContent = visibleMarkdown;
		return span;
	}
	const nodes = parseInlineMarkdownFragment(visibleMarkdown);
	const serializer = createPreviewSerializer(
		doc,
		doc.defaultView,
		renderNestedMath,
		labels,
		1,
	);
	span.appendChild(
		serializer.serializeFragment(Fragment.from(nodes), { document: doc }),
	);
	return span;
}

export function renderFootnoteRefPreview(
	doc: Document,
	rawMarkdown: string,
): HTMLElement {
	return createAtomElement(
		doc,
		"span",
		"easymde-footnote-ref-link",
		footnoteDisplayLabel(rawMarkdown),
	);
}

type TocHeadingItem = Readonly<{
	id: string;
	level: number;
	text: string;
}>;

/**
 * Approximates PHP `EasyMDE\Content\TocGenerator::unique_heading_id`
 * (`src/Content/TocGenerator.php`) using ASCII/NFKD transliteration for
 * non-navigable visual TOC preview links.
 */
function uniqueTocHeadingId(
	text: string,
	usedIds: Set<string>,
	fallbackIndex: number,
): string {
	const normalized = text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
	const base = normalized.length > 0 ? normalized : `section-${fallbackIndex}`;
	let id = base;
	let suffix = 2;
	while (usedIds.has(id)) {
		id = `${base}-${suffix}`;
		suffix += 1;
	}
	usedIds.add(id);
	return id;
}

function extractVisualHeadingText(headingNode: ProseMirrorNode): string {
	let text = "";
	headingNode.forEach((child) => {
		if (child.isText) {
			text += child.text ?? "";
			return;
		}
		if (child.type.name === "hard_break") {
			text += "\n";
			return;
		}
		if (child.type.name === "image") {
			text += typeof child.attrs.alt === "string" ? child.attrs.alt : "";
			return;
		}
		if (child.type.name !== "protected_inline") {
			text += child.textContent;
			return;
		}
		const kind = typeof child.attrs.kind === "string" ? child.attrs.kind : "";
		const raw =
			typeof child.attrs.rawMarkdown === "string"
				? child.attrs.rawMarkdown
				: "";
		if (kind === "footnote-ref") {
			text += footnoteDisplayLabel(raw);
			return;
		}
		if (kind === "math-inline") {
			text += raw;
			return;
		}
		if (isHtmlComment(raw)) return;
		const visible = stripInlineHtmlOutsideCode(raw);
		if (visible.length === 0) return;
		if (!INLINE_MARKDOWN_SPECIAL.test(visible)) {
			text += visible;
			return;
		}
		for (const inlineNode of parseInlineMarkdownFragment(visible)) {
			if (inlineNode.isText) text += inlineNode.text ?? "";
			else if (inlineNode.type.name === "image") {
				text +=
					typeof inlineNode.attrs.alt === "string" ? inlineNode.attrs.alt : "";
			} else if (inlineNode.type.name === "protected_inline") {
				text +=
					inlineNode.attrs.kind === "footnote-ref"
						? footnoteDisplayLabel(String(inlineNode.attrs.rawMarkdown ?? ""))
						: String(inlineNode.attrs.rawMarkdown ?? "");
			} else {
				text += inlineNode.textContent;
			}
		}
	});
	return text;
}

function extractRawBlockHeadings(
	rawMarkdown: string,
): ReadonlyArray<RawBlockHeading> {
	const cached = rawBlockHeadingsCache.get(rawMarkdown);
	if (cached) {
		rawBlockHeadingsCache.delete(rawMarkdown);
		rawBlockHeadingsCache.set(rawMarkdown, cached);
		return cached;
	}
	const headings: RawBlockHeading[] = [];
	const stripped = stripCommonMarkHtmlForPreview(rawMarkdown);
	if (stripped.trim().length > 0) {
		const parsedDoc = parseMarkdownToVisualDoc(stripped);
		parsedDoc.descendants((node) => {
			if (node.type.name === "heading") {
				const level =
					typeof node.attrs.level === "number" ? node.attrs.level : 0;
				headings.push({ level, text: extractVisualHeadingText(node) });
				return false;
			}
			return true;
		});
	}
	if (rawBlockHeadingsCache.size >= RAW_BLOCK_HEADINGS_CACHE_MAX) {
		const oldest = rawBlockHeadingsCache.keys().next().value;
		if (oldest !== undefined) rawBlockHeadingsCache.delete(oldest);
	}
	rawBlockHeadingsCache.set(rawMarkdown, headings);
	return headings;
}

function collectTocHeadings(viewDoc: ProseMirrorNode): TocHeadingItem[] {
	const items: TocHeadingItem[] = [];
	const usedIds = new Set<string>();
	const pushHeading = (level: number, rawText: string): void => {
		if (level < 2 || level > 4) return;
		const text = rawText.trim();
		const lower = text.toLowerCase();
		if (
			text.length === 0 ||
			lower === "toc" ||
			lower === "table of contents" ||
			text === "目录"
		) {
			return;
		}
		const id = uniqueTocHeadingId(text, usedIds, items.length + 1);
		items.push({ id, level, text });
	};

	viewDoc.descendants((node) => {
		if (node.type.name === "heading") {
			const level = typeof node.attrs.level === "number" ? node.attrs.level : 0;
			pushHeading(level, extractVisualHeadingText(node));
			return false;
		}
		if (
			node.type.name === "protected_block" &&
			node.attrs.kind === "raw" &&
			typeof node.attrs.rawMarkdown === "string"
		) {
			for (const heading of extractRawBlockHeadings(node.attrs.rawMarkdown)) {
				pushHeading(heading.level, heading.text);
			}
			return false;
		}
		return true;
	});

	return items;
}

export function renderTocPreview(
	doc: Document,
	viewDoc: ProseMirrorNode,
	fallbackLabel: string,
): Readonly<{ node: Node; signature: string }> {
	const items = collectTocHeadings(viewDoc);
	const signature = items
		.map((item) => `${item.level}:${item.id}:${item.text}`)
		.join("\n");

	if (items.length === 0) {
		return { node: createCollapsedMetaChip(doc, fallbackLabel), signature };
	}
	const list = doc.createElement("ul");
	for (const item of items) {
		const entry = doc.createElement("li");
		entry.className = `easymde-toc-level-${item.level}`;
		const link = doc.createElement("a");
		link.setAttribute("href", `#${item.id}`);
		link.setAttribute("tabindex", "-1");
		link.textContent = item.text;
		entry.appendChild(link);
		list.appendChild(entry);
	}
	return { node: list, signature };
}

/**
 * Mount a live `[TOC]` preview into `container` and subscribe to document
 * updates so heading additions, edits, and deletions stay synchronized without
 * leaking TOC-specific state into `ProtectedAtomNodeView`.
 */
export function mountTocPreview(
	doc: Document,
	container: HTMLElement,
	view: EditorView,
	fallbackLabel: string,
	isActive: () => boolean,
): () => void {
	let lastSignature = "";
	const sync = (): void => {
		if (!isActive()) return;
		const rendered = renderTocPreview(doc, view.state.doc, fallbackLabel);
		if (rendered.signature === lastSignature && container.childNodes.length > 0) {
			return;
		}
		lastSignature = rendered.signature;
		container.replaceChildren(rendered.node);
	};
	sync();
	return subscribeVisualDocumentUpdate(view, sync);
}

export function renderFootnotesBlockPreview(
	doc: Document,
	rawMarkdown: string,
	fallbackLabel: string,
): HTMLElement {
	const labels = collectFootnoteLabels(rawMarkdown);
	const summary =
		labels.length > 0
			? `${fallbackLabel} · ${labels.slice(0, 4).join(", ")}${labels.length > 4 ? " …" : ""}`
			: fallbackLabel;
	return createCollapsedMetaChip(doc, summary);
}

function unwrapTightListParagraphs(root: ParentNode): void {
	for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
		if (list.getAttribute("data-easymde-tight") === "false") continue;
		for (const item of Array.from(list.children)) {
			if (item.tagName !== "LI") continue;
			for (const child of Array.from(item.children)) {
				if (child.tagName === "P") {
					child.replaceWith(...Array.from(child.childNodes));
				}
			}
		}
	}
}

function renderRawBlockPreviewInternal(
	doc: Document,
	rawMarkdown: string,
	options: RawBlockPreviewOptions,
	depth: number,
): Node {
	const trimmed = rawMarkdown.trim();
	const refLabels = collectReferenceLabels(rawMarkdown);
	if (refLabels) {
		const previewLabels = refLabels
			.slice(0, 3)
			.map((label) => `[${label}]`)
			.join(", ");
		const suffix = refLabels.length > 3 ? ` +${refLabels.length - 3}` : "";
		return createCollapsedMetaChip(
			doc,
			`${options.fallbackLabel} · ${previewLabels}${suffix}`,
		);
	}

	if (isHtmlComment(trimmed)) {
		return createCollapsedMetaChip(
			doc,
			`${options.fallbackLabel} · <!-- … -->`,
		);
	}

	const strippedMarkdown = stripCommonMarkHtmlForPreview(rawMarkdown);
	if (strippedMarkdown.trim().length > 0) {
		const parsedDoc = parseMarkdownToVisualDoc(strippedMarkdown);
		const serializer = createPreviewSerializer(
			doc,
			options.viewWindow,
			options.renderNestedMath,
			{ footnotes: options.footnotesLabel, raw: options.fallbackLabel },
			depth,
		);
		const fragment = serializer.serializeFragment(parsedDoc.content, {
			document: doc,
		});
		unwrapTightListParagraphs(fragment);
		if (fragment.childNodes.length > 0) {
			return fragment;
		}
	}

	const tagMatch = HTML_BLOCK_TAG_OPEN.exec(trimmed);
	const tagHint = tagMatch?.[1] ? ` <${tagMatch[1].toLowerCase()}>` : "";
	return createCollapsedMetaChip(doc, `${options.fallbackLabel}${tagHint}`);
}

export function renderRawBlockPreview(
	doc: Document,
	rawMarkdown: string,
	options: RawBlockPreviewOptions,
): Node {
	return renderRawBlockPreviewInternal(doc, rawMarkdown, options, 0);
}
