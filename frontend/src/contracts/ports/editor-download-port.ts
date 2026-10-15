export type EditorDownloadFailureCode =
	| "editor-download-cancelled"
	| "editor-download-disposed"
	| "editor-download-filename-invalid"
	| "editor-download-invalid-png"
	| "editor-download-object-url-failed"
	| "editor-download-trigger-failed"
	| "editor-download-unsupported";

export type EditorDownloadResult =
	| Readonly<{ status: "requested" }>
	| Readonly<{
			code: EditorDownloadFailureCode;
			status: "failed";
	  }>;

export type EditorDownloadPort = Readonly<{
	dispose: () => void;
	requestPngDownload: (
		image: Blob,
		filename: string,
		signal?: AbortSignal,
	) => Promise<EditorDownloadResult>;
}>;
