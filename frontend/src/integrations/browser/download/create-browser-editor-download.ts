import type {
	EditorDownloadPort,
	EditorDownloadResult,
} from "../../../contracts/ports/editor-download-port";

export type BrowserEditorDownloadRuntime = Readonly<{
	createObjectURL?: ((image: Blob) => string) | undefined;
	document: Document;
	revokeObjectURL?: ((url: string) => void) | undefined;
	setTimeout: (callback: () => void, delayMs: number) => unknown;
}>;

function defaultRuntime(): BrowserEditorDownloadRuntime | null {
	if (
		"undefined" === typeof document ||
		"undefined" === typeof URL ||
		"function" !== typeof URL.createObjectURL ||
		"function" !== typeof URL.revokeObjectURL ||
		"undefined" === typeof setTimeout
	) {
		return null;
	}
	return {
		createObjectURL: (image) => URL.createObjectURL(image),
		document,
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	};
}

function validFilename(filename: string): boolean {
	return (
		filename.length > 0 &&
		filename.length <= 255 &&
		filename !== "." &&
		filename !== ".." &&
		!filename.includes("/") &&
		!filename.includes("\\") &&
		!Array.from(filename).some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code <= 0x1f || 0x7f === code;
		}) &&
		/\.png$/iu.test(filename)
	);
}

function validPng(image: unknown): image is Blob {
	return (
		"undefined" !== typeof Blob &&
		image instanceof Blob &&
		image.size > 0 &&
		"image/png" === image.type.toLowerCase()
	);
}

function failed(
	code: EditorDownloadResult extends infer Result
		? Result extends { status: "failed"; code: infer Code }
			? Code
			: never
		: never,
): EditorDownloadResult {
	return { code, status: "failed" } as EditorDownloadResult;
}

export function createBrowserEditorDownload(
	suppliedRuntime:
		| BrowserEditorDownloadRuntime
		| null
		| undefined = defaultRuntime(),
): EditorDownloadPort {
	let active = true;
	const pendingCleanups = new Set<() => void>();

	const scheduleCleanup = (
		cleanup: () => void,
		runtime: BrowserEditorDownloadRuntime,
	): void => {
		let completed = false;
		const complete = (): void => {
			if (completed) return;
			completed = true;
			pendingCleanups.delete(complete);
			cleanup();
		};
		if (!active) {
			complete();
			return;
		}
		pendingCleanups.add(complete);
		try {
			runtime.setTimeout(complete, 0);
		} catch {
			complete();
		}
	};

	const requestPngDownload = async (
		image: Blob,
		filename: string,
		signal?: AbortSignal,
	): Promise<EditorDownloadResult> => {
		if (!active) return failed("editor-download-disposed");
		if (signal?.aborted) return failed("editor-download-cancelled");
		if (!validPng(image)) return failed("editor-download-invalid-png");
		if (!validFilename(filename))
			return failed("editor-download-filename-invalid");
		if (
			!suppliedRuntime ||
			"function" !== typeof suppliedRuntime.createObjectURL ||
			"function" !== typeof suppliedRuntime.revokeObjectURL
		) {
			return failed("editor-download-unsupported");
		}

		let objectUrl: string;
		try {
			objectUrl = suppliedRuntime.createObjectURL(image);
		} catch {
			return failed("editor-download-object-url-failed");
		}
		if ("string" !== typeof objectUrl || "" === objectUrl) {
			return failed("editor-download-object-url-failed");
		}

		let anchor: HTMLAnchorElement;
		try {
			anchor = suppliedRuntime.document.createElement("a");
			anchor.href = objectUrl;
			anchor.download = filename;
			anchor.setAttribute("aria-hidden", "true");
			anchor.style.display = "none";
			(
				suppliedRuntime.document.body ??
				suppliedRuntime.document.documentElement
			).append(anchor);
		} catch {
			suppliedRuntime.revokeObjectURL(objectUrl);
			return failed("editor-download-trigger-failed");
		}

		const cleanup = (): void => {
			try {
				if (anchor.isConnected) anchor.remove();
			} finally {
				suppliedRuntime.revokeObjectURL?.(objectUrl);
			}
		};

		let clicked = false;
		try {
			if (active && !signal?.aborted) {
				anchor.click();
				clicked = true;
			}
		} catch {
			clicked = false;
		}

		scheduleCleanup(cleanup, suppliedRuntime);

		if (!active) return failed("editor-download-disposed");
		if (signal?.aborted) return failed("editor-download-cancelled");
		if (!clicked) return failed("editor-download-trigger-failed");
		return { status: "requested" };
	};

	return {
		dispose() {
			if (!active) return;
			active = false;
			let firstFailure: unknown = null;
			for (const cleanup of Array.from(pendingCleanups)) {
				try {
					cleanup();
				} catch (error) {
					firstFailure ??= error;
				}
			}
			if (firstFailure) throw firstFailure;
		},
		requestPngDownload,
	};
}
