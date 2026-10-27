export type EditorImagePixelsFailureCode =
	| "editor-image-pixels-cancelled"
	| "editor-image-pixels-canvas-unavailable"
	| "editor-image-pixels-dimensions-invalid"
	| "editor-image-pixels-disposed"
	| "editor-image-pixels-draw-failed"
	| "editor-image-pixels-empty"
	| "editor-image-pixels-encode-failed"
	| "editor-image-pixels-image-invalid"
	| "editor-image-pixels-lease-stale"
	| "editor-image-pixels-mime-invalid"
	| "editor-image-pixels-origin-invalid"
	| "editor-image-pixels-output-too-large"
	| "editor-image-pixels-pixel-limit"
	| "editor-image-pixels-timeout"
	| "editor-image-pixels-tainted"
	| "editor-image-pixels-unsupported";

export type EditorImagePixelsLease = Readonly<{
	image: HTMLImageElement;
	isCurrent: () => boolean;
}>;

export type EditorImagePixelsRequest = Readonly<{
	lease: EditorImagePixelsLease;
	signal?: AbortSignal;
}>;

export type EditorImagePixelsResult =
	| Readonly<{
			blob: Blob;
			height: number;
			pixelCount: number;
			source: string;
			status: "extracted";
			width: number;
	  }>
	| Readonly<{
			code: EditorImagePixelsFailureCode;
			status: "failed";
	  }>;

export const EDITOR_IMAGE_PIXELS_MAX_DIMENSION = 4096;
export const EDITOR_IMAGE_PIXELS_MAX_BYTES = 16_777_216;
export const EDITOR_IMAGE_PIXELS_MAX_TOTAL_PIXELS = 16_000_000;
export const EDITOR_IMAGE_PIXELS_TIMEOUT_MS = 10_000;

export type EditorImagePixelsPort = Readonly<{
	canExtract: (lease: EditorImagePixelsLease) => boolean;
	dispose: () => void;
	extractPng: (
		request: EditorImagePixelsRequest,
	) => Promise<EditorImagePixelsResult>;
	supports: () => boolean;
}>;
