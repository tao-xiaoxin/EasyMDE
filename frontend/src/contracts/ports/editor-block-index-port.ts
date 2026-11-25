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

export type EditorMarkdownBlockIndexPort = Readonly<{
	build: (
		input: EditorMarkdownBlockIndexBuildInput,
		signal: AbortSignal,
	) => Promise<EditorMarkdownBlockIndexData>;
	dispose: () => void;
}>;
