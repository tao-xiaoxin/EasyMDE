import type {
	PreviewRequest,
	PreviewRequestPort,
	PreviewResponse,
} from "../../contracts/ports/preview-request";
import {
	isPhpTrimChar,
	unescapeTableCellPipes,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	findLineAtOffset,
	findTableRowCellInCells,
	getCachedPhpTableRowCells,
	scanPhpCommonMarkBlocks,
} from "../../shared/markdown/php-commonmark-block-scan";
import { gfmAutolinkTrailingContext } from "../../shared/markdown/php-commonmark-inline-html";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	MAX_MARKDOWN_PREVIEW_BYTES,
	utf8ByteLength,
} from "../../shared/utf8-byte-length";
import type {
	EditorMarkdownBlockIndex,
	EditorMarkdownLinkTableCellContext,
	EditorMarkdownMathSpan,
} from "./editor-markdown-block-index";
import { unescapeTableCellPipesOutsideMath } from "./editor-markdown-link-preparation";
import type { SimplifiedFormattingDomParser } from "./editor-simplified-formatting";
import {
	type EditorSourceLinkCandidate,
	type EditorSourceLinkSelection,
	type EditorSourceLinkUnavailableCode,
	findEditorSourceLink,
} from "./editor-source-link";

export const MAX_EDITOR_SOURCE_LINK_QUERY_BYTES = MAX_MARKDOWN_PREVIEW_BYTES;
export const EDITOR_SOURCE_LINK_QUERY_TIMEOUT_MS = 10_000;
const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";

export type EditorSourceLinkQuerySelection = EditorSourceLinkSelection &
	Readonly<{
		direction?: "backward" | "forward" | "none";
	}>;

export type EditorSourceLinkQueryMenuIdentity = object | string | number;

export type EditorSourceLinkQueryBinding = Readonly<{
	menuIdentity: EditorSourceLinkQueryMenuIdentity;
	revision?: number;
	selection: EditorSourceLinkQuerySelection;
	source: string;
}>;

export type EditorSourceLinkQueryState =
	| Readonly<{ status: "none" }>
	| Readonly<{ status: "pending" }>
	| Readonly<{ href: string; status: "ready" }>
	| Readonly<{
			code: EditorSourceLinkQueryUnavailableCode;
			status: "unavailable";
	  }>;

export type EditorSourceLinkQueryReadiness = EditorSourceLinkQueryState;

export type EditorSourceLinkQueryUnavailableCode =
	| EditorSourceLinkUnavailableCode
	| "editor-source-link-preview-anchor-missing"
	| "editor-source-link-preview-invalid"
	| "editor-source-link-preview-ownership-invalid"
	| "editor-source-link-preview-ownership-missing"
	| "editor-source-link-query-disposed"
	| "editor-source-link-query-failed"
	| "editor-source-link-query-current-check-failed"
	| "editor-source-link-query-timeout"
	| "editor-source-link-query-too-large"
	| "editor-source-link-request-failed"
	| "editor-source-link-request-markdown-mismatch";

export type EditorSourceLinkQueryRequestFactory = (
	input: Readonly<{
		binding: EditorSourceLinkQueryBinding;
		candidate: EditorSourceLinkCandidate;
		markdown: string;
	}>,
) => PreviewRequest;

export type EditorSourceLinkQueryEnsureInput = Readonly<{
	binding: EditorSourceLinkQueryBinding;
	blockIndex?: EditorMarkdownBlockIndex | null | undefined;
}>;

export type EditorSourceLinkQuerySession = Readonly<{
	cancel: (binding?: EditorSourceLinkQueryBinding) => void;
	dispose: () => void;
	ensure: (
		input: EditorSourceLinkQueryEnsureInput,
	) => EditorSourceLinkQueryState;
	peek: (binding: EditorSourceLinkQueryBinding) => EditorSourceLinkQueryState;
	readiness: (
		binding: EditorSourceLinkQueryBinding,
	) => EditorSourceLinkQueryReadiness;
	subscribe: (listener: () => void) => () => void;
}>;

export type EditorSourceLinkQueryOptions = Readonly<{
	isCurrent: (binding: EditorSourceLinkQueryBinding) => boolean;
	notify: () => void;
	parser: SimplifiedFormattingDomParser;
	previewPort: PreviewRequestPort;
	requestFactory: EditorSourceLinkQueryRequestFactory;
}>;

type ActiveQuery = {
	binding: EditorSourceLinkQueryBinding;
	candidate: EditorSourceLinkCandidate;
	controller: AbortController;
	state: EditorSourceLinkQueryState;
	timeoutId: ReturnType<typeof setTimeout> | null;
};

type CachedState = Readonly<{
	binding: EditorSourceLinkQueryBinding;
	state: EditorSourceLinkQueryState;
}>;

function sameSelection(
	left: EditorSourceLinkQuerySelection,
	right: EditorSourceLinkQuerySelection,
): boolean {
	return (
		left.start === right.start &&
		left.end === right.end &&
		left.direction === right.direction
	);
}

function sameBinding(
	left: EditorSourceLinkQueryBinding,
	right: EditorSourceLinkQueryBinding,
): boolean {
	return (
		left.source === right.source &&
		Object.is(left.revision, right.revision) &&
		Object.is(left.menuIdentity, right.menuIdentity) &&
		sameSelection(left.selection, right.selection)
	);
}

function lineCount(markdown: string): number {
	let count = 1;
	for (let index = 0; index < markdown.length; index += 1) {
		if ("\r" === markdown[index]) {
			count += 1;
			if ("\n" === markdown[index + 1]) index += 1;
		} else if ("\n" === markdown[index]) {
			count += 1;
		}
	}
	return count;
}

function topLevelElements(document: Document): ReadonlyArray<Element> {
	return Array.from(document.body.children);
}

function anchorsIn(root: Element): ReadonlyArray<HTMLAnchorElement> {
	const anchors: HTMLAnchorElement[] = [];
	if (root instanceof HTMLAnchorElement) anchors.push(root);
	anchors.push(...Array.from(root.querySelectorAll<HTMLAnchorElement>("a")));
	return anchors;
}

function hasOutsideText(root: Element, anchor: HTMLAnchorElement): boolean {
	const walker = root.ownerDocument.createTreeWalker(root, 4);
	let node = walker.nextNode();
	while (node) {
		if (!anchor.contains(node) && (node.nodeValue ?? "").trim()) return true;
		node = walker.nextNode();
	}
	return false;
}

function hasGeneratedOrImageNode(root: Element): boolean {
	return Boolean(
		root.matches(
			"img, .easymde-math, .easymde-mermaid, .easymde-toc, .footnotes, .footnotes-sep, [data-easymde-preview-window-spacer], [data-easymde-visual-source-id]",
		) ||
			root.querySelector(
				"img, .easymde-math, .easymde-mermaid, .easymde-toc, .footnotes, .footnotes-sep, [data-easymde-preview-window-spacer], [data-easymde-visual-block-id], [data-easymde-visual-source-id]",
			),
	);
}

function hasUnexpectedOutsideContent(
	root: Element,
	anchor: HTMLAnchorElement,
	expectedTrailingText: string,
): boolean {
	if (0 === expectedTrailingText.length) {
		return hasOutsideText(root, anchor);
	}
	let seenAnchor = false;
	let trailingText = "";
	for (let index = 0; index < root.childNodes.length; index += 1) {
		const child = root.childNodes[index];
		if (!child) continue;
		if (child === anchor) {
			seenAnchor = true;
			continue;
		}
		if (3 !== child.nodeType) return true;
		const text = child.nodeValue ?? "";
		if (!seenAnchor) {
			if (text.trim()) return true;
		} else {
			trailingText += text;
		}
	}
	return !seenAnchor || trailingText !== expectedTrailingText;
}

type PreparedSourceLinkQuery = Readonly<{
	expectedTrailingText: string;
	queryMarkdown: string;
}>;

function isBareGfmAutolinkCandidate(
	candidate: EditorSourceLinkCandidate,
): boolean {
	return (
		"link" === candidate.kind &&
		!candidate.reference &&
		!candidate.source.startsWith("[")
	);
}

function lineBoundsAt(
	source: string,
	offset: number,
): Readonly<{ end: number; start: number }> {
	let start = offset;
	while (start > 0) {
		const ch = source[start - 1];
		if ("\n" === ch || "\r" === ch) break;
		start -= 1;
	}
	let end = offset;
	while (end < source.length) {
		const ch = source[end];
		if ("\n" === ch || "\r" === ch) break;
		end += 1;
	}
	return { end, start };
}

function tokenEndBeforeWhitespace(
	text: string,
	start: number,
	limit: number,
): number {
	let pos = start;
	while (pos < limit) {
		if (text.charCodeAt(pos) <= 0x20) break;
		pos += 1;
	}
	return pos;
}

function isBlankSlice(source: string, start: number, end: number): boolean {
	for (let i = start; i < end; i += 1) {
		const ch = source[i];
		if (" " !== ch && "\t" !== ch) return false;
	}
	return true;
}

function findMathSpanCovering(
	mathSpans: ReadonlyArray<EditorMarkdownMathSpan>,
	offset: number,
): EditorMarkdownMathSpan | null {
	let low = 0;
	let high = mathSpans.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const span = mathSpans[middle];
		if (!span) return null;
		if (span.to <= offset) {
			low = middle + 1;
		} else if (span.from > offset) {
			high = middle - 1;
		} else {
			return span;
		}
	}
	return null;
}

function lineMayBeGfmTableSeparator(
	source: string,
	start: number,
	end: number,
): boolean {
	let hasPipe = false;
	let hasDash = false;
	for (let i = start; i < end; i += 1) {
		const ch = source[i];
		if ("|" === ch) hasPipe = true;
		else if ("-" === ch) hasDash = true;
		if (hasPipe && hasDash) return true;
	}
	return false;
}

function findLocalTableWindowStart(
	source: string,
	lineStart: number,
	mathSpans: ReadonlyArray<EditorMarkdownMathSpan>,
): Readonly<{ hasSeparatorAbove: boolean; start: number }> {
	let pos = lineStart;
	let hasSeparatorAbove = false;
	const coveringStart = findMathSpanCovering(mathSpans, pos);
	if (coveringStart && coveringStart.from < pos) {
		pos = lineBoundsAt(source, coveringStart.from).start;
	}
	while (pos > 0) {
		const prevBreak =
			pos >= 2 && "\n" === source[pos - 1] && "\r" === source[pos - 2]
				? pos - 2
				: pos - 1;
		const prevStart = lineBoundsAt(source, prevBreak).start;
		if (isBlankSlice(source, prevStart, prevBreak)) {
			const bridging = findMathSpanCovering(mathSpans, prevBreak);
			if (!bridging || bridging.displayMode) break;
		}
		if (!hasSeparatorAbove && lineMayBeGfmTableSeparator(source, prevStart, prevBreak)) {
			hasSeparatorAbove = true;
		}
		pos = prevStart;
		const covering = findMathSpanCovering(mathSpans, pos);
		if (covering && covering.from < pos) {
			pos = lineBoundsAt(source, covering.from).start;
		}
	}
	return { hasSeparatorAbove, start: pos };
}

function findLocalTableWindowEnd(
	source: string,
	lineEnd: number,
	mathSpans: ReadonlyArray<EditorMarkdownMathSpan>,
): Readonly<{ end: number; hasSeparatorBelow: boolean }> {
	let end = lineEnd;
	const coveringCurrent = findMathSpanCovering(mathSpans, end);
	if (coveringCurrent && coveringCurrent.to > end) {
		end = lineBoundsAt(source, coveringCurrent.to).end;
	}
	if (end >= source.length) return { end: source.length, hasSeparatorBelow: false };
	const nextStart =
		end + ("\r" === source[end] && "\n" === source[end + 1] ? 2 : 1);
	if (nextStart > source.length) return { end, hasSeparatorBelow: false };
	const nextEnd = lineBoundsAt(source, nextStart).end;
	if (isBlankSlice(source, nextStart, nextEnd)) {
		const bridging = findMathSpanCovering(mathSpans, end);
		if (!bridging || bridging.displayMode) return { end, hasSeparatorBelow: false };
	}
	const hasSeparatorBelow = lineMayBeGfmTableSeparator(source, nextStart, nextEnd);
	end = nextEnd;
	const coveringNext = findMathSpanCovering(mathSpans, end);
	if (coveringNext && coveringNext.to > end) {
		end = lineBoundsAt(source, coveringNext.to).end;
	}
	return { end, hasSeparatorBelow };
}

/**
 * Worker-unpacked fallback (`packed-v3` omits `linkTableCells`): resolves
 * PHP table-cell context strictly within the contiguous non-blank table run
 * around `candidate.from` (extending at most one line forward for header
 * delimiter detection, and fast-exiting without scanning whenever no potential
 * GFM separator line exists in that run) so menu queries never rescan the full
 * document.
 */
function resolveWorkerTableCellContext(
	source: string,
	candidate: EditorSourceLinkCandidate,
	blockIndex: EditorMarkdownBlockIndex | null | undefined,
): EditorMarkdownLinkTableCellContext | null {
	const lineBounds = lineBoundsAt(source, candidate.from);
	const candidateHasEscapedPipe = candidate.source.includes("\\|");
	if (
		!candidateHasEscapedPipe &&
		!source.slice(lineBounds.start, lineBounds.end).includes("|")
	) {
		return null;
	}
	const mathSpans = blockIndex?.mathSpans ?? [];
	const { hasSeparatorAbove, start: windowStart } = findLocalTableWindowStart(
		source,
		lineBounds.start,
		mathSpans,
	);
	const { end: windowEnd, hasSeparatorBelow } = findLocalTableWindowEnd(
		source,
		lineBounds.end,
		mathSpans,
	);
	if (
		(windowStart === lineBounds.start && windowEnd === lineBounds.end) ||
		(!hasSeparatorAbove && !hasSeparatorBelow)
	) {
		return null;
	}
	const slice = source.slice(windowStart, windowEnd);
	const localMath = scanPhpMarkdownMathRanges(slice);
	const localScan = scanPhpCommonMarkBlocks(slice, localMath);
	const localFrom = candidate.from - windowStart;
	const localTo = candidate.to - windowStart;
	const line = findLineAtOffset(localScan.lines, localFrom);
	if (!line?.isTableRow) return null;
	const cells = getCachedPhpTableRowCells(slice, localScan, line);
	const cell = findTableRowCellInCells(cells, localFrom);
	if (!cell || localTo > cell.end) return null;
	const unescapedSource = candidateHasEscapedPipe
		? unescapeTableCellPipesOutsideMath(slice, localFrom, localTo, localMath)
		: undefined;
	const masked =
		undefined !== localScan.tableCellSource
			? localScan.tableCellSource.slice(cell.start, cell.end)
			: undefined;
	const maskedCellText =
		undefined !== masked && masked !== slice.slice(cell.start, cell.end)
			? masked
			: undefined;
	return {
		cellEnd: windowStart + cell.end,
		cellStart: windowStart + cell.start,
		...(undefined !== maskedCellText ? { maskedCellText } : {}),
		...(undefined !== unescapedSource && unescapedSource !== candidate.source
			? { unescapedSource }
			: {}),
	};
}

function computeTableCellAutolinkTrailingContext(
	source: string,
	candidate: EditorSourceLinkCandidate,
	tableCell: EditorMarkdownLinkTableCellContext,
): string {
	if (undefined !== tableCell.maskedCellText) {
		const cellText = tableCell.maskedCellText;
		const headFrom = candidate.from - tableCell.cellStart;
		const headTo = candidate.to - tableCell.cellStart;
		let tailLimit = cellText.length;
		while (tailLimit > headTo && isPhpTrimChar(cellText[tailLimit - 1])) {
			tailLimit -= 1;
		}
		const tailEnd = tokenEndBeforeWhitespace(cellText, headTo, tailLimit);
		const unescapedHead = unescapeTableCellPipes(
			cellText.slice(headFrom, headTo),
		);
		const unescapedTail = unescapeTableCellPipes(
			cellText.slice(headTo, tailEnd),
		);
		return gfmAutolinkTrailingContext(
			`${unescapedHead}${unescapedTail}`,
			0,
			unescapedHead.length,
		);
	}
	const tailEnd = tokenEndBeforeWhitespace(
		source,
		candidate.to,
		tableCell.cellEnd,
	);
	const unescapedHead = tableCell.unescapedSource ?? candidate.source;
	const unescapedTail = unescapeTableCellPipes(
		source.slice(candidate.to, tailEnd),
	);
	return gfmAutolinkTrailingContext(
		`${unescapedHead}${unescapedTail}`,
		0,
		unescapedHead.length,
	);
}

function prepareSourceLinkQuery(
	source: string,
	candidate: EditorSourceLinkCandidate,
	blockIndex: EditorMarkdownBlockIndex | null | undefined,
): PreparedSourceLinkQuery {
	const isBareAutolink = isBareGfmAutolinkCandidate(candidate);
	const candidateHasEscapedPipe = candidate.source.includes("\\|");

	if (candidateHasEscapedPipe || isBareAutolink) {
		const tableCell =
			undefined !== blockIndex?.linkTableCells
				? (blockIndex.linkTableCells.get(candidate.from) ?? null)
				: resolveWorkerTableCellContext(source, candidate, blockIndex);
		if (tableCell) {
			const querySource = tableCell.unescapedSource ?? candidate.source;
			const expectedTrailingText = isBareAutolink
				? computeTableCellAutolinkTrailingContext(source, candidate, tableCell)
				: "";
			return {
				expectedTrailingText,
				queryMarkdown: `${querySource}${expectedTrailingText}\n\n${source}`,
			};
		}
	}

	let expectedTrailingText = "";
	if (isBareAutolink) {
		const lineBounds = lineBoundsAt(source, candidate.from);
		const trailingBound = tokenEndBeforeWhitespace(
			source,
			candidate.to,
			Math.min(lineBounds.end, candidate.blockTo),
		);
		expectedTrailingText =
			trailingBound > candidate.to
				? gfmAutolinkTrailingContext(
						source.slice(candidate.from, trailingBound),
						0,
						candidate.to - candidate.from,
					)
				: "";
	}
	return {
		expectedTrailingText,
		queryMarkdown: `${candidate.source}${expectedTrailingText}\n\n${source}`,
	};
}

function responseHref(
	response: PreviewResponse,
	candidate: EditorSourceLinkCandidate,
	parser: SimplifiedFormattingDomParser,
	expectedTrailingText: string,
):
	| Readonly<{ href: string }>
	| Readonly<{ status: "none" }>
	| Readonly<{ code: EditorSourceLinkQueryUnavailableCode }> {
	if (
		!response ||
		"object" !== typeof response ||
		"string" !== typeof response.html
	) {
		return { code: "editor-source-link-preview-invalid" };
	}
	const editMap = response.editMap;
	if (
		editMap?.version !== 1 ||
		editMap.coordinate !== "line" ||
		!Array.isArray(editMap.blocks) ||
		!editMap.blocks.every(
			(block) =>
				Boolean(block) &&
				Number.isSafeInteger(block.startLine) &&
				Number.isSafeInteger(block.endLine) &&
				block.startLine >= 0 &&
				block.endLine >= block.startLine,
		)
	) {
		return { code: "editor-source-link-preview-ownership-missing" };
	}
	const prefixLineCount = lineCount(candidate.source);
	const matchingBlocks = editMap.blocks.filter(
		(block) =>
			block.startLine === 0 &&
			block.endLine === prefixLineCount &&
			block.editable,
	);
	if (1 !== matchingBlocks.length) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	const block = matchingBlocks[0];
	if (!block) return { code: "editor-source-link-preview-ownership-invalid" };
	const blockIndex = editMap.blocks.indexOf(block);
	if (0 !== blockIndex) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	let document: Document;
	try {
		document = parser.parseFromString(response.html, "text/html");
	} catch {
		return { code: "editor-source-link-preview-invalid" };
	}
	if (!document?.body || document.querySelector("parsererror")) {
		return { code: "editor-source-link-preview-invalid" };
	}
	const elements = topLevelElements(document);
	if (
		elements.length !== editMap.blocks.length ||
		blockIndex < 0 ||
		blockIndex >= elements.length
	) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	const owner = elements[blockIndex];
	if (!owner) return { code: "editor-source-link-preview-ownership-invalid" };
	if (owner.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	const anchors = anchorsIn(owner);
	if (1 !== anchors.length) {
		if (0 === anchors.length && candidate.reference) return { status: "none" };
		return { code: "editor-source-link-preview-anchor-missing" };
	}
	const anchor = anchors[0];
	if (!anchor) return { code: "editor-source-link-preview-anchor-missing" };
	const href = anchor.getAttribute("href");
	if (!href?.trim()) {
		return { code: "editor-source-link-preview-anchor-missing" };
	}
	if (hasGeneratedOrImageNode(owner)) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	if (hasUnexpectedOutsideContent(owner, anchor, expectedTrailingText)) {
		// A reference link only renders when the document defines its label.
		// Literal text beside the anchor therefore means this caret has no
		// rendered link, while generated or unexpected nodes stay a failure.
		if (candidate.reference) return { status: "none" };
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	return { href };
}

function failed(
	code: EditorSourceLinkQueryUnavailableCode,
): EditorSourceLinkQueryState {
	return { code, status: "unavailable" };
}

export function createEditorSourceLinkQuery({
	isCurrent,
	notify,
	parser,
	previewPort,
	requestFactory,
}: EditorSourceLinkQueryOptions): EditorSourceLinkQuerySession {
	let active: ActiveQuery | null = null;
	let cached: CachedState | null = null;
	let disposed = false;
	const listeners = new Set<() => void>();

	const publish = (): void => {
		if (disposed) return;
		for (const listener of listeners) listener();
		notify();
	};

	const clearActive = (candidate: ActiveQuery): void => {
		if (active !== candidate) return;
		if (null !== candidate.timeoutId) {
			clearTimeout(candidate.timeoutId);
			candidate.timeoutId = null;
		}
		candidate.controller.abort();
		active = null;
	};

	const clearQueryTimeout = (candidate: ActiveQuery): void => {
		if (null === candidate.timeoutId) return;
		clearTimeout(candidate.timeoutId);
		candidate.timeoutId = null;
	};

	const currentAndLive = (candidate: ActiveQuery): boolean => {
		if (disposed || active !== candidate || candidate.controller.signal.aborted)
			return false;
		return isCurrent(candidate.binding);
	};

	const currentQueryIsLive = (candidate: ActiveQuery): boolean => {
		let live: boolean;
		try {
			live = currentAndLive(candidate);
		} catch {
			if (!disposed && active === candidate) {
				candidate.state = failed(
					"editor-source-link-query-current-check-failed",
				);
				publish();
			}
			return false;
		}
		if (!live && "pending" === candidate.state.status) clearActive(candidate);
		return live;
	};

	const fail = (
		query: ActiveQuery,
		code: EditorSourceLinkQueryUnavailableCode,
	): void => {
		if (!currentQueryIsLive(query)) return;
		clearQueryTimeout(query);
		query.state = failed(code);
		query.controller.abort();
		publish();
	};

	const run = async (
		query: ActiveQuery,
		queryMarkdown: string,
		expectedTrailingText: string,
	): Promise<void> => {
		if (!currentQueryIsLive(query)) return;
		let request: PreviewRequest;
		try {
			request = requestFactory({
				binding: query.binding,
				candidate: query.candidate,
				markdown: queryMarkdown,
			});
		} catch {
			fail(query, "editor-source-link-request-failed");
			return;
		}
		if (
			!request ||
			"object" !== typeof request ||
			"string" !== typeof request.markdown
		) {
			fail(query, "editor-source-link-request-failed");
			return;
		}
		if (request.markdown !== queryMarkdown) {
			fail(query, "editor-source-link-request-markdown-mismatch");
			return;
		}
		let response: PreviewResponse;
		try {
			response = await previewPort.render(request, query.controller.signal);
		} catch {
			fail(query, "editor-source-link-query-failed");
			return;
		}
		if (!currentQueryIsLive(query)) return;
		clearQueryTimeout(query);
		const result = responseHref(
			response,
			query.candidate,
			parser,
			expectedTrailingText,
		);
		if ("status" in result) {
			query.state = { status: "none" };
			publish();
			return;
		}
		if ("code" in result) {
			query.state = failed(result.code);
			publish();
			return;
		}
		query.state = { href: result.href, status: "ready" };
		publish();
	};

	const ensure = ({
		binding,
		blockIndex,
	}: EditorSourceLinkQueryEnsureInput): EditorSourceLinkQueryState => {
		if (disposed) return failed("editor-source-link-query-disposed");
		if (null === blockIndex) {
			if (active) clearActive(active);
			cached = null;
			return failed("editor-source-link-block-index-unavailable");
		}
		if (active && sameBinding(active.binding, binding)) return active.state;
		if (cached && sameBinding(cached.binding, binding)) return cached.state;
		if (active) clearActive(active);
		cached = null;
		const resolution = findEditorSourceLink({
			blockIndex,
			selection: binding.selection,
			source: binding.source,
		});
		if ("none" === resolution.status) {
			cached = { binding, state: { status: "none" } };
			return cached.state;
		}
		if ("unavailable" === resolution.status) {
			cached = { binding, state: failed(resolution.code) };
			return cached.state;
		}
		const { expectedTrailingText, queryMarkdown } = prepareSourceLinkQuery(
			binding.source,
			resolution.candidate,
			blockIndex,
		);
		if (utf8ByteLength(queryMarkdown) > MAX_EDITOR_SOURCE_LINK_QUERY_BYTES) {
			cached = {
				binding,
				state: failed("editor-source-link-query-too-large"),
			};
			return cached.state;
		}
		const query: ActiveQuery = {
			binding,
			candidate: resolution.candidate,
			controller: new AbortController(),
			state: { status: "pending" },
			timeoutId: null,
		};
		active = query;
		query.timeoutId = setTimeout(() => {
			if (!currentQueryIsLive(query)) return;
			clearQueryTimeout(query);
			query.state = failed("editor-source-link-query-timeout");
			query.controller.abort();
			publish();
		}, EDITOR_SOURCE_LINK_QUERY_TIMEOUT_MS);
		void run(query, queryMarkdown, expectedTrailingText);
		return query.state;
	};

	return {
		cancel(binding) {
			if (active && (!binding || sameBinding(active.binding, binding))) {
				clearActive(active);
			}
			if (cached && (!binding || sameBinding(cached.binding, binding))) {
				cached = null;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			if (active) clearActive(active);
			cached = null;
			listeners.clear();
		},
		ensure,
		peek(binding) {
			if (active && sameBinding(active.binding, binding)) return active.state;
			if (cached && sameBinding(cached.binding, binding)) return cached.state;
			return { status: "none" };
		},
		readiness(binding) {
			if (active && sameBinding(active.binding, binding)) return active.state;
			if (cached && sameBinding(cached.binding, binding)) return cached.state;
			return { status: "none" };
		},
		subscribe(listener) {
			if (disposed) throw new Error("editor-source-link-query-disposed");
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
