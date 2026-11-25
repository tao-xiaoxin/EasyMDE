import {
	collectTableRowCells,
	findFirstMathRangeEndingAfter,
	findLineAtOffset,
	findTableRowCellInCells,
	scanPhpTablePrefixThroughOffset,
	type TableRowCellRange,
	unescapeTableCellPipes,
} from "../../shared/markdown/php-commonmark-block-scan";
import {
	maskDisplayMathLength,
	maskInlineMathLength,
} from "../../shared/markdown/php-markdown-math-mask";

export type ReferenceLabelCaseFoldProfile = 11 | 13 | 14 | 16 | 17 | "unsupported";

export function isReferenceLabelCaseFoldProfile(
	value: unknown,
): value is ReferenceLabelCaseFoldProfile {
	return value === 11 || value === 13 || value === 14 || value === 16 || value === 17 || value === "unsupported";
}

export type EditorMarkdownBlockKind =
	| "code"
	| "heading"
	| "list"
	| "math"
	| "paragraph"
	| "quote"
	| "table"
	| "thematic-break"
	| "unavailable";

export type EditorMarkdownSourceBlock = Readonly<{
	editable: boolean;
	from: number;
	kind: EditorMarkdownBlockKind;
	lineEnd: number;
	lineStart: number;
	to: number;
}>;

export type EditorMarkdownMathSpan = Readonly<{
	bodyFrom: number;
	bodyTo: number;
	displayMode: boolean;
	from: number;
	to: number;
}>;

export type EditorMarkdownImageBlockStatus = "ready" | "unavailable";

/** Numeric image provenance kept separate from image text/target data. */
export type EditorMarkdownImageBlock = Readonly<{
	count: number;
	firstImageIndex: number;
	status: EditorMarkdownImageBlockStatus;
}>;

export type EditorMarkdownImageRange = Readonly<{
	from: number;
	to: number;
}>;

export type EditorMarkdownImageIndexData = Readonly<{
	imageBlocks: ReadonlyArray<EditorMarkdownImageBlock>;
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>;
}>;

export type EditorMarkdownLinkCandidateKind = "autolink" | "link";

/**
 * Exact link construct ranges prepared by the block-index owner. Text stays in
 * the canonical source; consumers only map these source ranges back to it.
 * Candidates are sorted and non-overlapping: nested link syntax inside a link
 * label is literal CommonMark text, so only the outermost rendered link keeps
 * a range there.
 */
export type EditorMarkdownLinkCandidate = Readonly<{
	blockFrom: number;
	blockTo: number;
	from: number;
	kind: EditorMarkdownLinkCandidateKind;
	reference: boolean;
	to: number;
}>;

export type EditorMarkdownLinkTableCellContext = Readonly<{
	cellEnd: number;
	cellStart: number;
	/**
	 * Masked slice `[cellStart, cellEnd)` when PHP math masking altered the
	 * table cell text; omitted when `source` already matches the cell text.
	 */
	maskedCellText?: string;
	/**
	 * Precomputed table-cell-unescaped query source when the candidate contains
	 * `\|` outside PHP math spans; omitted when `source.slice(from, to)` is
	 * already identical.
	 */
	unescapedSource?: string;
}>;

/** The worker result is source-free; the Root retains the canonical source. */
export type EditorMarkdownBlockIndexData = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	imageBlocks: ReadonlyArray<EditorMarkdownImageBlock>;
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>;
	length: number;
	/**
	 * Prepared by the block-index build for every current producer. Hand-written
	 * fixtures may omit it; consumers must then fail explicitly instead of
	 * re-deriving link candidates themselves.
	 */
	linkCandidates?: ReadonlyArray<EditorMarkdownLinkCandidate>;
	/**
	 * Precomputed PHP GFM table-cell context keyed by `candidate.from` for
	 * link candidates inside PHP table rows. Omitted when no table-cell link
	 * candidates exist (or in hand-written fixtures).
	 */
	linkTableCells?: ReadonlyMap<number, EditorMarkdownLinkTableCellContext>;
	mathSpans: ReadonlyArray<EditorMarkdownMathSpan>;
}>;

/** Named alias for consumers that make the image provenance boundary explicit. */
export type EditorMarkdownBlockIndexDataWithImages =
	EditorMarkdownBlockIndexData;

/** Transfer-only worker payload; the adapter exposes object-shaped data. */
export type EditorMarkdownBlockIndexPackedData = Readonly<{
	blockCount: number;
	blocks: ArrayBuffer;
	format: "packed-v3";
	imageCount: number;
	images: ArrayBuffer;
	length: number;
	linkCount: number;
	links: ArrayBuffer;
	linkTableCellCount?: number;
	linkTableCells?: ArrayBuffer;
	mathSpanCount: number;
	mathSpans: ArrayBuffer;
}>;

export type EditorMarkdownLinkTableCellWireData = Readonly<{
	linkTableCellCount: number;
	linkTableCells: ArrayBuffer;
}>;

export type EditorBlockIndexWorkerData = EditorMarkdownBlockIndexPackedData;

export type EditorMarkdownBlockIndexBuildInput = Readonly<{
	generation: number;
	revision: number;
	source: string;
}>;

export type EditorBlockIndexWorkerRequest = EditorMarkdownBlockIndexBuildInput &
	Readonly<{ type: "build"; referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile }>;

export type EditorBlockIndexWorkerResponse =
	| Readonly<{
			data: EditorBlockIndexWorkerData;
			generation: number;
			revision: number;
			type: "result";
	  }>
	| Readonly<{
			code: EditorMarkdownBlockIndexFailureCode;
			generation?: number;
			revision?: number;
			type: "error";
	  }>;

export type EditorMarkdownBlockIndexFailureCode =
	| "editor-block-index-cancelled"
	| "editor-block-index-disposed"
	| "editor-block-index-input-invalid"
	| "editor-block-index-reference-profile-unavailable"
	| "editor-block-index-result-invalid"
	| "editor-block-index-result-too-large"
	| "editor-block-index-source-too-large"
	| "editor-block-index-stale"
	| "editor-block-index-cache-timeout"
	| "editor-block-index-worker-url-invalid"
	| "editor-block-index-worker-construction-failed"
	| "editor-block-index-worker-failed"
	| "editor-block-index-worker-message-invalid"
	| "editor-block-index-worker-post-failed"
	| "editor-block-index-worker-profile-invalid"
	| "editor-block-index-worker-request-invalid"
	| "editor-block-index-worker-timeout"
	| "editor-block-index-worker-timeout-invalid"
	| "editor-block-index-build-failed";

// Keep worker input aligned with the PHP Preview and Revision 1 MiB byte limit.
export const MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES = 1_048_576;
export const MAX_EDITOR_BLOCK_INDEX_BLOCKS = 100_000;
export const MAX_EDITOR_BLOCK_INDEX_MATH_SPANS = 100_000;
export const MAX_EDITOR_BLOCK_INDEX_IMAGES = 100_000;
export const MAX_EDITOR_BLOCK_INDEX_LINKS = 100_000;
export const EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS = 6;
export const EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS = 5;
export const EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS = 3;
export const EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS = 2;
export const EDITOR_BLOCK_INDEX_PACKED_LINK_FIELDS = 6;
export const EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE = 3;
export const EDITOR_BLOCK_INDEX_PACKED_V3_KEYS: ReadonlyArray<string> = [
	"blockCount",
	"blocks",
	"format",
	"imageCount",
	"images",
	"length",
	"linkCount",
	"links",
	"mathSpanCount",
	"mathSpans",
];
export const EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_WIRE_KEYS: ReadonlyArray<string> =
	["linkTableCellCount", "linkTableCells"];
export const EDITOR_BLOCK_INDEX_LINK_KIND_LINK = 0;
export const EDITOR_BLOCK_INDEX_LINK_KIND_AUTOLINK = 1;
export const EDITOR_BLOCK_INDEX_IMAGE_STATUS_READY = 0;
export const EDITOR_BLOCK_INDEX_IMAGE_STATUS_UNAVAILABLE = 1;
export const EDITOR_MARKDOWN_BLOCK_KIND_ORDER: ReadonlyArray<EditorMarkdownBlockKind> =
	[
		"code",
		"heading",
		"list",
		"math",
		"paragraph",
		"quote",
		"table",
		"unavailable",
		"thematic-break",
	];

const EDITOR_BLOCK_INDEX_WORKER_PATH =
	"assets/build/editor-block-index-worker/assets/editor-block-index-worker-";
const EDITOR_BLOCK_INDEX_WORKER_FILE =
	/^assets\/build\/editor-block-index-worker\/assets\/editor-block-index-worker-[A-Za-z0-9_-]+\.js$/u;
const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;

function decodedPath(value: string): string {
	let decoded = value;
	for (let attempt = 0; attempt < 8; attempt += 1) {
		if (decoded.includes("\\") || ENCODED_SEPARATOR.test(decoded)) {
			throw new Error("editor-block-index-worker-url-invalid");
		}
		const next = decodeURIComponent(decoded);
		if (next === decoded) return decoded;
		decoded = next;
	}
	if (decoded.includes("\\") || ENCODED_SEPARATOR.test(decoded)) {
		throw new Error("editor-block-index-worker-url-invalid");
	}
	return decoded;
}

function hasPathTraversal(pathname: string): boolean {
	return pathname
		.split("/")
		.some((segment) => "." === segment || ".." === segment);
}

export function resolveEditorBlockIndexWorkerUrl(
	value: string,
	baseUrl: string,
	expectedOrigin?: string,
): string {
	try {
		const base = new URL(baseUrl);
		const url = new URL(value, base);
		const basePath = decodedPath(
			base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`,
		);
		const pathname = decodedPath(url.pathname);
		if (
			!["http:", "https:"].includes(base.protocol) ||
			url.protocol !== base.protocol ||
			url.origin !== (expectedOrigin ?? base.origin) ||
			(expectedOrigin !== undefined && base.origin !== expectedOrigin) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash ||
			url.username ||
			url.password ||
			url.hash ||
			hasPathTraversal(basePath) ||
			hasPathTraversal(pathname) ||
			!pathname.startsWith(basePath)
		) {
			throw new Error("editor-block-index-worker-url-invalid");
		}
		const relativePath = pathname.slice(basePath.length);
		if (
			!relativePath.startsWith(EDITOR_BLOCK_INDEX_WORKER_PATH) ||
			!EDITOR_BLOCK_INDEX_WORKER_FILE.test(relativePath)
		) {
			throw new Error("editor-block-index-worker-url-invalid");
		}
		return url.href;
	} catch {
		throw new Error("editor-block-index-worker-url-invalid");
	}
}

export const EDITOR_BLOCK_INDEX_PACKED_V3_WITH_TABLE_CELLS_KEYS: ReadonlyArray<string> =
	[
		...EDITOR_BLOCK_INDEX_PACKED_V3_KEYS,
		...EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_WIRE_KEYS,
	];

export type EditorBlockIndexPackedKeyShape = "base" | "with-table-cells";

export type EditorMarkdownTableCellMathRange = Readonly<{
	block?: boolean;
	displayMode?: boolean;
	from: number;
	to: number;
}>;

export function hasOwnEditorBlockIndexKey(
	value: Readonly<Record<string, unknown>>,
	key: string,
): boolean {
	// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
	return Object.prototype.hasOwnProperty.call(value, key);
}

export function hasExactEditorBlockIndexKeys(
	value: Readonly<Record<string, unknown>>,
	keys: ReadonlyArray<string>,
): boolean {
	return (
		Object.keys(value).length === keys.length &&
		keys.every((key) => hasOwnEditorBlockIndexKey(value, key))
	);
}

/**
 * Validates that a `packed-v3` worker payload has either the exact 10 base
 * keys (no table-cell wire extension) or the exact 12 keys (both table-cell
 * wire extension keys), rejecting partial or extra keys.
 */
export function hasExactEditorBlockIndexPackedKeys(
	value: Readonly<Record<string, unknown>>,
): EditorBlockIndexPackedKeyShape | null {
	const hasCount = hasOwnEditorBlockIndexKey(value, "linkTableCellCount");
	const hasBuffer = hasOwnEditorBlockIndexKey(value, "linkTableCells");
	if (!hasCount && !hasBuffer) {
		return hasExactEditorBlockIndexKeys(
			value,
			EDITOR_BLOCK_INDEX_PACKED_V3_KEYS,
		)
			? "base"
			: null;
	}
	if (!hasCount || !hasBuffer) return null;
	return hasExactEditorBlockIndexKeys(
		value,
		EDITOR_BLOCK_INDEX_PACKED_V3_WITH_TABLE_CELLS_KEYS,
	)
		? "with-table-cells"
		: null;
}

/**
 * Validates that a packed math span `[from, to)` is covered by editable
 * non-code, non-unavailable blocks starting at `startBlockIndex` and returns
 * the ending block index, or `-1` on any violation. Only inline `\(...\)` math
 * may span across Lezer block boundaries (such as blank lines or headings).
 */
export function findEditorBlockIndexMathSpanEndBlockIndex(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	startBlockIndex: number,
	from: number,
	to: number,
	displayMode: boolean,
	source: string,
): number {
	const startBlock = blocks[startBlockIndex];
	if (
		!startBlock ||
		from < startBlock.from ||
		!startBlock.editable ||
		"code" === startBlock.kind ||
		"unavailable" === startBlock.kind ||
		(!displayMode && "math" === startBlock.kind)
	) {
		return -1;
	}
	if (to <= startBlock.to) return startBlockIndex;
	if (displayMode || "\\" !== source[from] || "(" !== source[from + 1]) {
		return -1;
	}
	for (let idx = startBlockIndex + 1; idx < blocks.length; idx += 1) {
		const block = blocks[idx];
		if (
			!block?.editable ||
			"code" === block.kind ||
			"unavailable" === block.kind ||
			"math" === block.kind
		) {
			return -1;
		}
		if (to <= block.to) return to > block.from ? idx : -1;
	}
	return -1;
}

function maskSliceMathSpans(
	source: string,
	sliceFrom: number,
	sliceTo: number,
	mathSpans: ReadonlyArray<EditorMarkdownTableCellMathRange>,
	startIndex: number,
): string | undefined {
	if (startIndex >= mathSpans.length || sliceFrom >= sliceTo) return undefined;
	const first = mathSpans[startIndex];
	if (!first || first.from >= sliceTo) return undefined;

	const raw = source.slice(sliceFrom, sliceTo);
	const parts: string[] = [];
	let cursor = sliceFrom;
	for (let i = startIndex; i < mathSpans.length; i += 1) {
		const span = mathSpans[i];
		if (!span) continue;
		if (span.from >= sliceTo) break;
		if (span.to <= cursor) continue;
		const overlapFrom = Math.max(cursor, span.from);
		const overlapTo = Math.min(sliceTo, span.to);
		if (overlapTo <= overlapFrom) continue;
		if (overlapFrom > cursor) {
			parts.push(source.slice(cursor, overlapFrom));
		}
		const isDisplay = Boolean(span.displayMode ?? span.block);
		const fullMask = isDisplay
			? maskDisplayMathLength(span.to - span.from)
			: maskInlineMathLength(span.to - span.from);
		parts.push(
			overlapFrom === span.from && overlapTo === span.to
				? fullMask
				: fullMask.slice(overlapFrom - span.from, overlapTo - span.from),
		);
		cursor = overlapTo;
	}
	if (0 === parts.length) return undefined;
	if (cursor < sliceTo) parts.push(source.slice(cursor, sliceTo));
	const masked = parts.join("");
	return masked !== raw ? masked : undefined;
}

function unescapeSlicePipesOutsideMath(
	source: string,
	from: number,
	to: number,
	mathSpans: ReadonlyArray<EditorMarkdownTableCellMathRange>,
	startIndex: number,
): string | undefined {
	const raw = source.slice(from, to);
	if (!raw.includes("\\|")) return undefined;
	let unescaped: string;
	if (
		startIndex >= mathSpans.length ||
		(mathSpans[startIndex]?.from ?? to) >= to
	) {
		unescaped = unescapeTableCellPipes(raw);
	} else {
		const parts: string[] = [];
		let cursor = from;
		for (let i = startIndex; i < mathSpans.length; i += 1) {
			const span = mathSpans[i];
			if (!span || span.to <= cursor) continue;
			if (span.from >= to) break;
			if (span.from > cursor) {
				parts.push(unescapeTableCellPipes(source.slice(cursor, span.from)));
			}
			const overlapTo = Math.min(to, span.to);
			parts.push(source.slice(Math.max(cursor, span.from), overlapTo));
			cursor = overlapTo;
		}
		if (cursor < to) {
			parts.push(unescapeTableCellPipes(source.slice(cursor, to)));
		}
		unescaped = parts.join("");
	}
	return unescaped !== raw ? unescaped : undefined;
}

/**
 * Canonical derivation of PHP GFM table-cell link context from the
 * authoritative `source` and PHP-extracted math ranges. Shared by direct block
 * indexing and worker unpacking so both paths produce byte-identical contexts
 * without transferring untrusted strings over the worker boundary.
 */
export function deriveEditorMarkdownLinkTableCellContext(
	source: string,
	candidateFrom: number,
	candidateTo: number,
	cellStart: number,
	cellEnd: number,
	mathSpans: ReadonlyArray<EditorMarkdownTableCellMathRange>,
	cachedMaskedCell?: Map<string, string | undefined>,
	knownMathStartIndex?: number,
): EditorMarkdownLinkTableCellContext {
	const mathStartIndex =
		undefined !== knownMathStartIndex
			? knownMathStartIndex
			: mathSpans.length > 0
				? findFirstMathRangeEndingAfter(mathSpans, cellStart)
				: 0;
	let maskedCellText: string | undefined;
	if (
		mathStartIndex < mathSpans.length &&
		(mathSpans[mathStartIndex]?.from ?? cellEnd) < cellEnd
	) {
		if (cachedMaskedCell) {
			const cellKey = `${cellStart}:${cellEnd}`;
			if (cachedMaskedCell.has(cellKey)) {
				maskedCellText = cachedMaskedCell.get(cellKey);
			} else {
				maskedCellText = maskSliceMathSpans(
					source,
					cellStart,
					cellEnd,
					mathSpans,
					mathStartIndex,
				);
				cachedMaskedCell.set(cellKey, maskedCellText);
			}
		} else {
			maskedCellText = maskSliceMathSpans(
				source,
				cellStart,
				cellEnd,
				mathSpans,
				mathStartIndex,
			);
		}
	}
	const candidateMathStartIndex =
		mathStartIndex < mathSpans.length &&
		(mathSpans[mathStartIndex]?.to ?? 0) <= candidateFrom
			? findFirstMathRangeEndingAfter(mathSpans, candidateFrom)
			: mathStartIndex;
	const unescapedSource = unescapeSlicePipesOutsideMath(
		source,
		candidateFrom,
		candidateTo,
		mathSpans,
		candidateMathStartIndex,
	);
	return {
		cellEnd,
		cellStart,
		...(undefined !== maskedCellText ? { maskedCellText } : {}),
		...(undefined !== unescapedSource ? { unescapedSource } : {}),
	};
}

/**
 * Packs `linkTableCells` into a compact 3-int stride
 * `[candidateFrom, cellStart, cellEnd]` buffer sorted by `candidateFrom`,
 * or returns `null` when empty. Never transfers cell strings across the wire.
 */
export function packEditorMarkdownLinkTableCells(
	linkTableCells:
		| ReadonlyMap<number, EditorMarkdownLinkTableCellContext>
		| undefined,
): EditorMarkdownLinkTableCellWireData | null {
	if (!linkTableCells || 0 === linkTableCells.size) return null;
	const entries = Array.from(linkTableCells.entries()).sort(
		(left, right) => left[0] - right[0],
	);
	const records = new Int32Array(
		entries.length * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE,
	);
	entries.forEach(([candidateFrom, cell], index) => {
		const offset = index * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE;
		records[offset] = candidateFrom;
		records[offset + 1] = cell.cellStart;
		records[offset + 2] = cell.cellEnd;
	});
	return {
		linkTableCellCount: entries.length,
		linkTableCells: records.buffer,
	};
}

/**
 * Strictly validates the optional textless 3-int table-cell wire extension
 * inside a `packed-v3` payload against exact PHP GFM table-row and table-cell
 * boundaries derived from the authoritative `source`, then recomputes
 * `maskedCellText` and `unescapedSource` locally.
 *
 * Returns:
 * - `undefined` when the payload has the exact 10 base `packed-v3` keys (no scan),
 * - a `ReadonlyMap` when the payload has the exact 12 keys and every record matches
 *   its exact PHP GFM table-cell range, or
 * - `null` on any structural, key-count, bounds, ordering, or cell-boundary violation.
 */
export function unpackEditorMarkdownLinkTableCells(
	source: string,
	candidateRanges: ReadonlyArray<EditorMarkdownLinkCandidate>,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	rawData: unknown,
	options?: Readonly<{ envelopeValidated?: boolean }>,
): ReadonlyMap<number, EditorMarkdownLinkTableCellContext> | undefined | null {
	if (!rawData || "object" !== typeof rawData || Array.isArray(rawData)) {
		return null;
	}
	const record = rawData as Readonly<Record<string, unknown>>;
	if (!options?.envelopeValidated) {
		const shape = hasExactEditorBlockIndexPackedKeys(record);
		if (null === shape) return null;
		if ("base" === shape) return undefined;
	}
	const count = record.linkTableCellCount;
	const buffer = record.linkTableCells;
	if (
		"number" !== typeof count ||
		!Number.isSafeInteger(count) ||
		count <= 0 ||
		count > candidateRanges.length ||
		!(buffer instanceof ArrayBuffer) ||
		buffer.byteLength !==
			count *
				EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE *
				Int32Array.BYTES_PER_ELEMENT
	) {
		return null;
	}
	let records: Int32Array;
	try {
		records = new Int32Array(buffer);
	} catch {
		return null;
	}

	const matchedCandidates: EditorMarkdownLinkCandidate[] = [];
	let candidateIndex = 0;
	let blockIndex = 0;
	let previousCandidateFrom = -1;
	let previousCellStart = -1;
	let previousCellEnd = -1;
	let maxCellEnd = 0;

	for (let index = 0; index < count; index += 1) {
		const offset = index * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE;
		const from = records[offset] ?? -1;
		const cellStart = records[offset + 1] ?? -1;
		const cellEnd = records[offset + 2] ?? -1;
		if (from <= previousCandidateFrom) return null;
		while (
			candidateIndex < candidateRanges.length &&
			(candidateRanges[candidateIndex]?.from ?? source.length) < from
		) {
			candidateIndex += 1;
		}
		const candidate = candidateRanges[candidateIndex];
		if (!candidate || candidate.from !== from) return null;

		while (
			blockIndex < blocks.length &&
			(blocks[blockIndex]?.to ?? 0) <= from
		) {
			blockIndex += 1;
		}
		const block = blocks[blockIndex];
		if (
			!block?.editable ||
			"unavailable" === block.kind ||
			"code" === block.kind ||
			"math" === block.kind ||
			block.from !== candidate.blockFrom ||
			block.to !== candidate.blockTo ||
			cellStart < 0 ||
			cellStart > from ||
			candidate.to <= from ||
			candidate.to > cellEnd ||
			cellEnd > source.length
		) {
			return null;
		}

		const sameCell =
			cellStart === previousCellStart && cellEnd === previousCellEnd;
		if (!sameCell && cellStart < previousCellEnd) {
			return null;
		}
		previousCellStart = cellStart;
		previousCellEnd = cellEnd;
		if (cellEnd > maxCellEnd) maxCellEnd = cellEnd;
		matchedCandidates.push(candidate);
		previousCandidateFrom = from;
		candidateIndex += 1;
	}

	if (!source.includes("|")) return null;

	const {
		lines: scannedLines,
		maskedSource,
		phpMathRanges,
	} = scanPhpTablePrefixThroughOffset(source, maxCellEnd);
	const rowCellsCache = new Map<number, ReadonlyArray<TableRowCellRange>>();
	const cachedMaskedCell = new Map<string, string | undefined>();
	const cells = new Map<number, EditorMarkdownLinkTableCellContext>();
	let phpMathCursor = 0;

	for (let index = 0; index < count; index += 1) {
		const offset = index * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE;
		const from = records[offset] ?? -1;
		const cellStart = records[offset + 1] ?? -1;
		const cellEnd = records[offset + 2] ?? -1;
		const candidate = matchedCandidates[index];
		if (!candidate) return null;

		const line = findLineAtOffset(scannedLines, from);
		if (
			!line?.isTableRow ||
			line.inlineBlockId < 0 ||
			from < line.contentOffset ||
			candidate.to > line.lineEnd
		) {
			return null;
		}
		let rowCells = rowCellsCache.get(line.lineStart);
		if (undefined === rowCells) {
			rowCells = collectTableRowCells(
				maskedSource,
				line.contentOffset,
				line.lineEnd,
				line.tableColumnCount,
			);
			rowCellsCache.set(line.lineStart, rowCells);
		}
		const cell = findTableRowCellInCells(rowCells, from);
		if (
			null === cell ||
			cell.start !== cellStart ||
			cell.end !== cellEnd ||
			candidate.to > cell.end
		) {
			return null;
		}

		while (
			phpMathCursor < phpMathRanges.length &&
			(phpMathRanges[phpMathCursor]?.to ?? 0) <= cellStart
		) {
			phpMathCursor += 1;
		}
		const context = deriveEditorMarkdownLinkTableCellContext(
			source,
			from,
			candidate.to,
			cellStart,
			cellEnd,
			phpMathRanges,
			cachedMaskedCell,
			phpMathCursor,
		);
		cells.set(from, context);
	}
	return cells;
}

export type EditorMarkdownBlockIndexPort = Readonly<{
	build: (
		input: EditorMarkdownBlockIndexBuildInput,
		signal: AbortSignal,
	) => Promise<EditorMarkdownBlockIndexData>;
	dispose: () => void;
}>;
