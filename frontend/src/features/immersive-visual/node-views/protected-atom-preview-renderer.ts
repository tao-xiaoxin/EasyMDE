import {
	DOMSerializer,
	Fragment,
	type Node as ProseMirrorNode,
} from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { COMMONMARK_ESCAPABLE_PUNCTUATION } from "../../../shared/image-scale-title";
import {
	advancePhpCommonMarkBlockLine,
	createPhpCommonMarkBlockState,
	type PhpCommonMarkBlockState,
} from "../../../shared/markdown/php-commonmark-block-engine";
import {
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	cursorRemainder,
	type LineColumnCursor,
	matchListMarkerLength,
	measureLeadingColumns,
	nextNonSpaceIndex,
} from "../../../shared/markdown/php-commonmark-block-helpers";
import {
	createInlineHtmlScanGuard,
	type InlineHtmlSegment,
	matchBlockInlineHtmlOrAutolink,
	matchSingleLineInlineHtmlOrAutolink,
} from "../../../shared/markdown/php-commonmark-inline-html";
import {
	extractReferenceDefinitionLabels,
	parseInlineMarkdownFragment,
	parseMarkdownToVisualDoc,
} from "../markdown-parser";
import {
	FOOTNOTE_DEF_LINE,
	isCommonMarkBlankLine,
} from "../markdown-prescanner";
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

type BlockContainer = PhpCommonMarkBlockState["containers"][number];
type ListMeta = { emittedIndent: number | null; leadCols: number; markerText: string; origIndent: number; padding: number };
type PreviewLineKind = "blank" | "content" | "fenced-code" | "html-block" | "indented-code";
type PreviewLine = {
	containers: BlockContainer[]; contentRel: number; kind: PreviewLineKind;
	openedHereStart: number; rawLine: string; scanned: PhpCommonMarkBlockState["lines"][number]; strippedRest: string;
};

function indexBacktickRuns(text: string): Map<number, number[]> | null {
	let i = text.indexOf("`");
	if (i < 0) return null;
	const first = i;
	while (i < text.length && text[i] === "`") i += 1;
	let s = text.indexOf("`", i);
	if (s < 0) return null;
	const runs = new Map<number, number[]>([[i - first, [first]]]);
	for (; s >= 0; s = text.indexOf("`", i)) {
		i = s + 1;
		while (i < text.length && text[i] === "`") i += 1;
		const b = runs.get(i - s);
		if (b) b.push(s); else runs.set(i - s, [s]);
	}
	return runs;
}

const COMMONMARK_URI_AUTOLINK_PREFIX = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:/;
const COMMONMARK_EMAIL_AUTOLINK =
	/^<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>$/;

function isCommonMarkAutolink(token: string): boolean {
	if (
		token.length < 4 ||
		token[0] !== "<" ||
		token[token.length - 1] !== ">"
	) {
		return false;
	}
	if (COMMONMARK_URI_AUTOLINK_PREFIX.test(token)) {
		const colonIdx = token.indexOf(":");
		for (let k = colonIdx + 1; k < token.length - 1; k += 1) {
			const ch = token[k];
			if (ch === "<" || ch === ">" || token.charCodeAt(k) <= 0x20) {
				return false;
			}
		}
		return true;
	}
	return COMMONMARK_EMAIL_AUTOLINK.test(token);
}

function buildInlineHtmlSegments(text: string): InlineHtmlSegment[] {
	const segments: InlineHtmlSegment[] = [];
	let start = 0;
	for (let pos = 0; pos <= text.length; pos += 1) {
		if (pos === text.length || text[pos] === "\n") {
			segments.push({ contentOffset: start, lineEnd: pos });
			start = pos + 1;
		}
	}
	return segments;
}

/**
 * Strip CommonMark §6.6 inline raw HTML tokens (including multiline open/close
 * tags, quoted attributes, comments, CDATA, PIs, and declarations) outside §6.1
 * backtick code spans (including multiline spans) and §6.5 autolinks in O(N),
 * preserving `\n` line counts.
 */
function stripInlineHtmlOutsideCode(text: string): string {
	const runs = indexBacktickRuns(text);
	const cursors = runs ? new Map<number, number>() : null;
	const guard = createInlineHtmlScanGuard();
	let segments: InlineHtmlSegment[] | null = null;
	let segIdx = 0;
	let lineEnd = text.indexOf("\n");
	if (lineEnd < 0) lineEnd = text.length;
	let out = "";
	for (let i = 0; i < text.length; ) {
		const ch = text[i] ?? "";
		if (ch === "\\" && COMMONMARK_ESCAPABLE_PUNCTUATION.test(text[i + 1] ?? "")) {
			out += text.slice(i, i + 2);
			i += 2;
		} else if (ch === "`") {
			let end = i + 1;
			while (end < text.length && text[end] === "`") end += 1;
			const bucket = runs?.get(end - i);
			if (bucket && cursors) {
				let pos = cursors.get(end - i) ?? 0;
				while (pos < bucket.length && (bucket[pos] ?? -1) < end) pos += 1;
				cursors.set(end - i, pos);
				if (bucket[pos] !== undefined) end = (bucket[pos] ?? 0) + (end - i);
			}
			out += text.slice(i, end);
			i = end;
		} else if (ch === "<") {
			if (i > lineEnd) {
				const nextNl = text.indexOf("\n", i);
				lineEnd = nextNl < 0 ? text.length : nextNl;
			}
			const single = matchSingleLineInlineHtmlOrAutolink(
				text,
				i,
				guard,
				lineEnd,
			);
			if (single.status === "ok") {
				const token = text.slice(i, single.end);
				if (isCommonMarkAutolink(token)) {
					out += token;
				}
				i = single.end;
			} else if (single.status === "needs-multiline") {
				if (segments === null) {
					segments = buildInlineHtmlSegments(text);
				}
				while (
					segIdx + 1 < segments.length &&
					(segments[segIdx]?.lineEnd ?? 0) < i
				) {
					segIdx += 1;
				}
				const blockMatch = matchBlockInlineHtmlOrAutolink(
					text,
					segments,
					segIdx,
					i,
					segments.length - 1,
					guard,
				);
				if (blockMatch !== null) {
					if (blockMatch.segIdx > segIdx) {
						out += "\n".repeat(blockMatch.segIdx - segIdx);
					} else if (isCommonMarkAutolink(text.slice(i, blockMatch.pos))) {
						out += text.slice(i, blockMatch.pos);
					}
					segIdx = blockMatch.segIdx;
					i = blockMatch.pos;
				} else {
					out += ch;
					i += 1;
				}
			} else {
				out += ch;
				i += 1;
			}
		} else {
			out += ch;
			i += 1;
		}
	}
	return out;
}

function consumeListMarker(cursor: LineColumnCursor, origIndent: number): ListMeta {
	const leadCols = measureLeadingColumns(cursor);
	consumeWhitespaceColumns(cursor, leadCols);
	const len = matchListMarkerLength(cursor.line.slice(cursor.index), false);
	const markerText = cursor.line.slice(cursor.index, cursor.index + len);
	cursor.index += len; cursor.column += len;
	const padding = Math.max(1, origIndent - leadCols - len);
	consumeWhitespaceColumns(cursor, Math.min(padding, measureLeadingColumns(cursor)));
	return { emittedIndent: null, leadCols, markerText, origIndent, padding };
}

function rewritePreviewLine(
	entry: PreviewLine,
	listMeta: Map<BlockContainer, ListMeta>,
	emittedQuotes: Set<BlockContainer>,
): string {
	const { containers, contentRel, kind, openedHereStart, rawLine, strippedRest } = entry;
	const needsRewrite = (limit: number): boolean =>
		containers.slice(0, limit).some((c) =>
			c.kind === "list"
				? listMeta.get(c)?.emittedIndent !== c.indent
				: !emittedQuotes.has(c),
		);
	const hasPendingContainer = (from: number): boolean =>
		containers.slice(from).some((c) =>
			c.kind === "list"
				? listMeta.get(c)?.emittedIndent === null
				: !emittedQuotes.has(c),
		);
	const cursor: LineColumnCursor = { column: 0, index: 0, line: rawLine, virtualSpaces: 0 };
	if (kind === "blank") {
		if (!needsRewrite(containers.length)) return rawLine.slice(0, contentRel).replace(/[ \t]+$/, "");
		let out = ""; let hasQuote = false;
		for (const c of containers) {
			if (c.kind === "blockquote") {
				const lead = measureLeadingColumns(cursor);
				if (!consumeBlockquoteMarker(cursor)) break;
				out += `${" ".repeat(lead)}> `; hasQuote = true;
				emittedQuotes.add(c);
			} else {
				const m = listMeta.get(c);
				if (!m || m.emittedIndent === null || measureLeadingColumns(cursor) < c.indent) break;
				consumeWhitespaceColumns(cursor, c.indent);
				out += " ".repeat(m.emittedIndent);
			}
		}
		return hasQuote ? out.replace(/[ \t]+$/, "") : "";
	}
	const isCode = kind === "fenced-code" || kind === "indented-code";
	if (!needsRewrite(openedHereStart)) {
		for (const c of containers.slice(openedHereStart)) {
			if (c.kind === "blockquote") {
				emittedQuotes.add(c);
			} else {
				const m = listMeta.get(c);
				if (m) m.emittedIndent = m.origIndent;
			}
		}
		return isCode ? rawLine : `${rawLine.slice(0, contentRel)}${strippedRest}`;
	}
	let out = ""; let prev: ListMeta | null = null; let lazyStopped = false; let materializedLazy = false;
	const flush = (nextCols: number): number => {
		if (!prev) return nextCols;
		const total = (nextCols >= 4 ? 1 : Math.max(1, Math.min(prev.padding, 4 - nextCols))) + nextCols;
		prev.emittedIndent = prev.leadCols + prev.markerText.length + (total >= 5 ? 1 : total);
		prev = null;
		return total;
	};
	for (let k = 0; k < containers.length; k += 1) {
		const c = containers[k];
		if (!c) break;
		if (c.kind === "blockquote") {
			const lead = measureLeadingColumns(cursor);
			const colAfter = cursor.column + lead;
			if (!lazyStopped && consumeBlockquoteMarker(cursor)) {
				out += " ".repeat(flush(lead)) + (cursor.column - colAfter - 1 > 0 ? "> " : ">");
				emittedQuotes.add(c);
			} else {
				lazyStopped = true;
				if (!hasPendingContainer(k)) break;
				out += `${" ".repeat(flush(0))}> `;
				emittedQuotes.add(c);
				materializedLazy = true;
			}
		} else {
			const m = listMeta.get(c);
			if (!m) break;
			if (k < openedHereStart) {
				const lazy = lazyStopped || measureLeadingColumns(cursor) < c.indent;
				if (!lazy) consumeWhitespaceColumns(cursor, c.indent);
				if (m.emittedIndent === null) {
					const hadPrev = prev !== null;
					out += `${" ".repeat(flush(m.leadCols))}${m.markerText}`;
					if (hadPrev) m.leadCols = 0;
					prev = m;
					if (lazy) {
						lazyStopped = true;
						materializedLazy = true;
						if (!hasPendingContainer(k + 1)) break;
					}
				} else if (!lazy) {
					out += " ".repeat(m.emittedIndent);
				} else {
					lazyStopped = true;
					if (!hasPendingContainer(k + 1)) break;
					out += " ".repeat(flush(m.emittedIndent));
					materializedLazy = true;
				}
			} else {
				const hadPrev = prev !== null;
				consumeListMarker(cursor, c.indent);
				out += `${" ".repeat(flush(m.leadCols))}${m.markerText}${" ".repeat(m.padding)}`;
				m.emittedIndent = hadPrev ? m.origIndent - m.leadCols : m.origIndent;
			}
		}
	}
	if (lazyStopped && !prev && !materializedLazy) return `${rawLine.slice(0, contentRel)}${strippedRest}`;
	if (prev) {
		const rawExtra = isCode ? measureLeadingColumns(cursor)
			: lazyStopped ? 0
			: measureLeadingColumns({ column: cursor.column, index: 0, line: strippedRest, virtualSpaces: cursor.virtualSpaces });
		const extra = !isCode && rawExtra >= 4 ? 0 : rawExtra;
		return `${out}${" ".repeat(flush(extra))}${isCode ? rawLine.slice(nextNonSpaceIndex(cursor)) : strippedRest.replace(/^[ \t]+/, "")}`;
	}
	return isCode
		? kind === "indented-code"
			? `${out}${" ".repeat(measureLeadingColumns(cursor))}${rawLine.slice(nextNonSpaceIndex(cursor))}`
			: `${out}${cursorRemainder(cursor)}`
		: lazyStopped
			? `${out}${strippedRest.replace(/^[ \t]+/, "")}`
			: `${out}${cursor.virtualSpaces > 0 ? " ".repeat(cursor.virtualSpaces) : ""}${strippedRest}`;
}

/**
 * Strip raw HTML blocks and inline tags from a protected `raw` Markdown block
 * using CommonMark `html_input: 'strip'` semantics (matching EasyMDE's `main`
 * PHP `MarkdownRenderer`), preserving list containers across stripped HTML
 * blocks and multiline CommonMark §6.1 backtick code spans.
 */
export function stripCommonMarkHtmlForPreview(rawMarkdown: string): string {
	const state = createPhpCommonMarkBlockState(true, true);
	const listMeta = new Map<BlockContainer, ListMeta>();
	const emittedQuotes = new Set<BlockContainer>();
	const entries: PreviewLine[] = [];
	let offset = 0;
	for (const line of rawMarkdown.replace(/\r\n?/g, "\n").split("\n")) {
		const lineStart = offset;
		const nextLineStart = lineStart + line.length + 1;
		offset = nextLineStart;
		const prevContainers = state.containers.slice();
		advancePhpCommonMarkBlockLine(state, line, lineStart, lineStart + line.length, nextLineStart);
		const scanned = state.lines[state.lines.length - 1];
		if (!scanned) continue;
		let openedHereStart = 0;
		while (openedHereStart < prevContainers.length && state.containers[openedHereStart] === prevContainers[openedHereStart]) openedHereStart += 1;
		const containers = state.containers.slice();
		if (containers.slice(openedHereStart).some((c) => c.kind === "list")) {
			const cursor: LineColumnCursor = { column: 0, index: 0, line, virtualSpaces: 0 };
			for (let k = 0; k < containers.length; k += 1) {
				const c = containers[k];
				if (!c) break;
				if (c.kind === "blockquote") consumeBlockquoteMarker(cursor);
				else if (k < openedHereStart) consumeWhitespaceColumns(cursor, c.indent);
				else listMeta.set(c, consumeListMarker(cursor, c.indent));
			}
		}
		const contentRel = Math.max(0, scanned.contentOffset - lineStart);
		const kind: PreviewLineKind =
			state.leaf?.kind === "html-block" ? "html-block"
			: state.blockCodeRanges[state.blockCodeRanges.length - 1]?.end === nextLineStart
				? (state.leaf?.kind === "indented-code" ? "indented-code" : "fenced-code")
				: isCommonMarkBlankLine(line.slice(contentRel)) ? "blank" : "content";
		entries.push({ containers, contentRel, kind, openedHereStart, rawLine: line, scanned, strippedRest: "" });
	}
	for (let idx = 0; idx < entries.length; ) {
		const entry = entries[idx];
		if (entry?.kind !== "content") { idx += 1; continue; }
		const blockId = entry.scanned.inlineBlockId;
		let end = idx + 1;
		while (blockId >= 0 && entries[end]?.kind === "content" && entries[end]?.scanned.inlineBlockId === blockId) end += 1;
		const stripped = stripInlineHtmlOutsideCode(entries.slice(idx, end).map((e) => e.rawLine.slice(e.contentRel)).join("\n")).split("\n");
		for (let j = idx; j < end; j += 1) {
			const target = entries[j];
			if (target) target.strippedRest = stripped[j - idx] ?? "";
		}
		idx = end;
	}
	const kept: string[] = [];
	for (const e of entries) {
		if (e.kind === "html-block" || (e.kind === "blank" && kept.length === 0)) continue;
		if (e.kind === "content" && isCommonMarkBlankLine(e.strippedRest)) continue;
		kept.push(e.kind === "blank" && !e.scanned.consumedBlockquote ? "" : rewritePreviewLine(e, listMeta, emittedQuotes));
	}
	return kept.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
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
