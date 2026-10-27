export type PreviewFeatures = Readonly<Record<string, boolean>>;

/**
 * Bound the amount of untrusted metadata the browser will retain for one
 * Preview response. This still leaves room for the supported long-document
 * editor while preventing an accidentally or maliciously oversized sidecar
 * from becoming a client-side allocation hazard.
 */
export const MAX_PREVIEW_EDIT_MAP_BLOCKS = 50_000;

export const MAX_PREVIEW_CODE_MAP_ENTRIES = 50_000;
export const MAX_PREVIEW_CODE_MAP_CONTENT_BYTES = 4_194_304;
export const MAX_PREVIEW_CODE_PROJECTION_ENTRIES = 50_000;
export const MAX_PREVIEW_CODE_PROJECTION_ROWS = 50_000;
export const MAX_PREVIEW_CODE_PROJECTION_BYTES = 4_194_304;
export const MAX_PREVIEW_CODE_PROJECTION_INFO_BYTES = 1_024;

export type PreviewEditMapBlock = Readonly<{
	id: string;
	startLine: number;
	endLine: number;
	editable: boolean;
}>;

export type PreviewEditMap = Readonly<{
	version: 1;
	coordinate: "line";
	signature: string;
	blocks: ReadonlyArray<PreviewEditMapBlock>;
}>;

export type PreviewCodeBodyKind = "fenced" | "indented";

export type PreviewCodeBodyMapEntry =
	| Readonly<{
			content: string;
			endLine: number;
			kind: PreviewCodeBodyKind;
			startLine: number;
			status: "available";
	  }>
	| Readonly<{
			code: "preview-code-body-source-unavailable";
			endLine: number;
			kind: PreviewCodeBodyKind;
			startLine: number;
			status: "unavailable";
	  }>;

export type PreviewCodeBodyMap =
	| Readonly<{
			coordinate: "line";
			entries: ReadonlyArray<PreviewCodeBodyMapEntry>;
			signature: string;
			status: "available";
			version: 1;
	  }>
	| Readonly<{
			code: "preview-code-body-limit" | "preview-code-body-unavailable";
			coordinate: "line";
			signature: string;
			status: "unavailable";
			version: 1;
	  }>;

export type PreviewCodeProjectionRow = Readonly<{
	contentLine: number;
	literalFrom: number;
	literalLeadingSpaces: number;
	prefixEnd: number;
	prefixTabColumns: number;
	sourceLine: number;
}>;

export type PreviewCodeProjectionEntry =
	| Readonly<{
			code:
				| "preview-code-projection-info-limit"
				| "preview-code-projection-source-unavailable";
			endLine: number;
			kind: PreviewCodeBodyKind;
			startLine: number;
			status: "unavailable";
	  }>
	| Readonly<{
			endLine: number;
			fenceOffset: number;
			info: string;
			kind: "fenced";
			rows: ReadonlyArray<PreviewCodeProjectionRow>;
			startLine: number;
			status: "available";
	  }>
	| Readonly<{
			endLine: number;
			kind: "indented";
			rows: ReadonlyArray<PreviewCodeProjectionRow>;
			startLine: number;
			status: "available";
	  }>;

export type PreviewCodeProjection =
	| Readonly<{
			coordinate: "line";
			entries: ReadonlyArray<PreviewCodeProjectionEntry>;
			offsetUnit: "utf16";
			signature: string;
			status: "available";
			version: 1;
	  }>
	| Readonly<{
			code:
				| "preview-code-projection-limit"
				| "preview-code-projection-unavailable";
			coordinate: "line";
			offsetUnit: "utf16";
			signature: string;
			status: "unavailable";
			version: 1;
	  }>;

export type PreparedPreviewMarkup = Readonly<{
	sourceNodes: ReadonlyArray<Node>;
}>;

const PROTOTYPE_RESERVED_FEATURE_KEYS = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

export function isPreviewFeatureKey(key: string): boolean {
	return !PROTOTYPE_RESERVED_FEATURE_KEYS.has(key);
}

declare const safePreviewHtmlBrand: unique symbol;

export type SafePreviewHtml = string &
	Readonly<{ [safePreviewHtmlBrand]: true }>;

export type PreviewRequest = Readonly<{
	markdown: string;
	postId: number;
	markdownTheme: string;
	codeTheme: string;
	customCssId: string;
	signature: string;
}>;

export type PreviewResponse = Readonly<{
	codeMap?: PreviewCodeBodyMap;
	codeProjection?: PreviewCodeProjection;
	html: SafePreviewHtml;
	features: PreviewFeatures;
	editMap?: PreviewEditMap;
	preparedMarkup?: PreparedPreviewMarkup;
}>;

export type PreviewRequestPort = Readonly<{
	render: (
		request: PreviewRequest,
		signal: AbortSignal,
	) => Promise<PreviewResponse>;
}>;

export type PreviewRequestState =
	| Readonly<{ kind: "loading"; request: PreviewRequest; revision: number }>
	| Readonly<{ kind: "empty"; request: PreviewRequest; revision: number }>
	| Readonly<{
			kind: "success";
			request: PreviewRequest;
			response: PreviewResponse;
			revision: number;
	  }>
	| Readonly<{ kind: "error"; request: PreviewRequest; revision: number }>;
