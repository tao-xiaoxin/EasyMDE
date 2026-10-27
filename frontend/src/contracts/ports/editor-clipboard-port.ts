export type EditorClipboardStatus =
	| "unknown"
	| "checking"
	| "available"
	| "empty"
	| "unavailable";

export type EditorClipboardFailureCode =
	| "editor-clipboard-cancelled"
	| "editor-clipboard-disposed"
	| "editor-clipboard-image-invalid"
	| "editor-clipboard-image-payload-failed"
	| "editor-clipboard-image-too-large"
	| "editor-clipboard-read-failed"
	| "editor-clipboard-unsupported"
	| "editor-clipboard-write-failed"
	| "editor-clipboard-rich-payload-failed"
	| "editor-clipboard-rich-payload-invalid"
	| "editor-clipboard-rich-payload-too-large";

export type EditorClipboardReadFailureCode =
	| "editor-clipboard-read-failed"
	| "editor-clipboard-unsupported";

export type EditorClipboardWriteFailureCode =
	| "editor-clipboard-cancelled"
	| "editor-clipboard-disposed"
	| "editor-clipboard-unsupported"
	| "editor-clipboard-write-failed";

export type EditorClipboardImageWriteFailureCode =
	| EditorClipboardWriteFailureCode
	| "editor-clipboard-image-invalid"
	| "editor-clipboard-image-payload-failed"
	| "editor-clipboard-image-too-large";

export type EditorClipboardRichPayload = Readonly<{
	html: string;
	text: string;
}>;

export type EditorClipboardRichPayloadFailureCode =
	| "editor-clipboard-rich-payload-failed"
	| "editor-clipboard-rich-payload-invalid"
	| "editor-clipboard-rich-payload-too-large";

export type EditorClipboardRichWriteFailureCode =
	| EditorClipboardWriteFailureCode
	| EditorClipboardRichPayloadFailureCode;

export type EditorClipboardState =
	| Readonly<{ status: "unknown" | "checking" | "available" | "empty" }>
	| Readonly<{
			code: EditorClipboardReadFailureCode;
			status: "unavailable";
	  }>;

export type EditorClipboardReadResult =
	| Readonly<{ status: "available"; text: string }>
	| Readonly<{ status: "empty" }>
	| Readonly<{
			code: EditorClipboardReadFailureCode;
			status: "unavailable";
	  }>
	| Readonly<{
			code: Extract<
				EditorClipboardFailureCode,
				"editor-clipboard-cancelled" | "editor-clipboard-disposed"
			>;
			status: "failed";
	  }>;

export type EditorClipboardWriteResult =
	| Readonly<{ status: "written" }>
	| Readonly<{
			code: EditorClipboardWriteFailureCode;
			status: "failed";
	  }>;

export type EditorClipboardImageWriteResult =
	| Readonly<{ status: "written" }>
	| Readonly<{
			code: EditorClipboardImageWriteFailureCode;
			status: "failed";
	  }>;

export type EditorClipboardRichOperationOptions = Readonly<{
	maxBytes?: number;
	signal?: AbortSignal;
}>;

export type EditorClipboardRichWriteResult =
	| Readonly<{ status: "written" }>
	| Readonly<{
			code: EditorClipboardRichWriteFailureCode;
			status: "failed";
	  }>;

export type EditorClipboardOperationOptions = Readonly<{
	signal?: AbortSignal;
}>;

export type EditorClipboardImageOperationOptions = Readonly<{
	maxBytes?: number;
	signal?: AbortSignal;
}>;

export const DEFAULT_EDITOR_CLIPBOARD_IMAGE_MAX_BYTES = 16_777_216;
export const DEFAULT_EDITOR_CLIPBOARD_RICH_MAX_BYTES = 1_048_576;

export interface EditorClipboardPort {
	check(
		options?: EditorClipboardOperationOptions,
	): Promise<EditorClipboardReadResult>;
	dispose(): void;
	getState(): EditorClipboardState;
	read(
		options?: EditorClipboardOperationOptions,
	): Promise<EditorClipboardReadResult>;
	subscribe(listener: () => void): () => void;
	supportsPngWrite?: () => boolean;
	supportsRichWrite?: () => boolean;
	write(
		text: string,
		options?: EditorClipboardOperationOptions,
	): Promise<EditorClipboardWriteResult>;
	writeDeferred?: (
		text: Promise<string>,
		options?: EditorClipboardOperationOptions,
	) => Promise<EditorClipboardWriteResult>;
	writeImageDeferred?: (
		image: Promise<Blob>,
		options?: EditorClipboardImageOperationOptions,
	) => Promise<EditorClipboardImageWriteResult>;
	writeRichDeferred?: (
		payload: Promise<EditorClipboardRichPayload>,
		options?: EditorClipboardRichOperationOptions,
	) => Promise<EditorClipboardRichWriteResult>;
}
