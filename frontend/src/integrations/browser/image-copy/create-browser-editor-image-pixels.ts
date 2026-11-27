import {
	EDITOR_IMAGE_PIXELS_MAX_BYTES,
	EDITOR_IMAGE_PIXELS_MAX_DIMENSION,
	EDITOR_IMAGE_PIXELS_MAX_TOTAL_PIXELS,
	EDITOR_IMAGE_PIXELS_TIMEOUT_MS,
	type EditorImagePixelsFailureCode,
	type EditorImagePixelsLease,
	type EditorImagePixelsPort,
	type EditorImagePixelsRequest,
	type EditorImagePixelsResult,
} from "../../../contracts/ports/editor-image-pixels-port";

export type BrowserEditorImagePixelsRuntime = Readonly<{
	clearTimeout: (handle: unknown) => void;
	createCanvas?: () => HTMLCanvasElement;
	document: Document;
	setTimeout: (callback: () => void, delayMs: number) => unknown;
}>;

type ImageFingerprint = Readonly<{
	currentSrc: string;
	naturalHeight: number;
	naturalWidth: number;
	sizes: string;
	src: string;
	srcset: string;
}>;

type ValidatedImage = Readonly<{
	fingerprint: ImageFingerprint;
	height: number;
	image: HTMLImageElement;
	pixelCount: number;
	source: string;
	width: number;
}>;

type Validation =
	| Readonly<{ status: "valid"; value: ValidatedImage }>
	| Readonly<{ code: EditorImagePixelsFailureCode; status: "failed" }>;

type PngEncodingResult =
	| Readonly<{ blob: Blob; status: "encoded" }>
	| Readonly<{ status: "aborted" | "empty" | "failed" | "tainted" }>;

function failed(code: EditorImagePixelsFailureCode): EditorImagePixelsResult {
	return { code, status: "failed" };
}

function defaultRuntime(): BrowserEditorImagePixelsRuntime | null {
	if (
		"undefined" === typeof document ||
		"undefined" === typeof setTimeout ||
		"undefined" === typeof clearTimeout
	) {
		return null;
	}
	return {
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
		document,
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	};
}

function runtimeSupportsCanvas(
	runtime: BrowserEditorImagePixelsRuntime | null,
): boolean {
	if (
		!runtime ||
		"function" !== typeof runtime.clearTimeout ||
		"function" !== typeof runtime.setTimeout ||
		"function" !== typeof runtime.document?.createElement
	) {
		return false;
	}
	try {
		const canvas =
			runtime.createCanvas?.() ?? runtime.document.createElement("canvas");
		return (
			"function" === typeof canvas.getContext &&
			"function" === typeof canvas.toBlob
		);
	} catch {
		return false;
	}
}

function imageElement(value: unknown): value is HTMLImageElement {
	return Boolean(
		value &&
			"object" === typeof value &&
			1 === (value as Element).nodeType &&
			"IMG" === (value as Element).tagName,
	);
}

function captureFingerprint(image: HTMLImageElement): ImageFingerprint | null {
	try {
		return {
			currentSrc: image.currentSrc,
			naturalHeight: image.naturalHeight,
			naturalWidth: image.naturalWidth,
			sizes: image.sizes,
			src: image.src,
			srcset: image.srcset,
		};
	} catch {
		return null;
	}
}

function sameFingerprint(
	left: ImageFingerprint,
	right: ImageFingerprint,
): boolean {
	return (
		left.currentSrc === right.currentSrc &&
		left.naturalHeight === right.naturalHeight &&
		left.naturalWidth === right.naturalWidth &&
		left.sizes === right.sizes &&
		left.src === right.src &&
		left.srcset === right.srcset
	);
}

function sourceOrigin(document: Document): string | null {
	const origin = document.defaultView?.location.origin;
	if (origin && "null" !== origin) return origin;
	try {
		const base = new URL(document.baseURI);
		return ["http:", "https:"].includes(base.protocol) ? base.origin : null;
	} catch {
		return null;
	}
}

function validateImage(
	runtime: BrowserEditorImagePixelsRuntime,
	lease: EditorImagePixelsLease,
): Validation {
	if (
		!lease ||
		!imageElement(lease.image) ||
		"function" !== typeof lease.isCurrent
	) {
		return { code: "editor-image-pixels-image-invalid", status: "failed" };
	}
	let current = false;
	try {
		current = lease.isCurrent();
	} catch {
		current = false;
	}
	if (!current)
		return { code: "editor-image-pixels-lease-stale", status: "failed" };
	const fingerprint = captureFingerprint(lease.image);
	if (!fingerprint) {
		return { code: "editor-image-pixels-image-invalid", status: "failed" };
	}
	const rawSource = fingerprint.currentSrc || fingerprint.src;
	if ("" === rawSource) {
		return { code: "editor-image-pixels-image-invalid", status: "failed" };
	}
	const origin = sourceOrigin(runtime.document);
	let source: URL;
	try {
		source = new URL(rawSource, runtime.document.baseURI);
	} catch {
		return { code: "editor-image-pixels-origin-invalid", status: "failed" };
	}
	if (
		!["http:", "https:"].includes(source.protocol) ||
		!origin ||
		source.origin !== origin
	) {
		return { code: "editor-image-pixels-origin-invalid", status: "failed" };
	}
	const width = fingerprint.naturalWidth;
	const height = fingerprint.naturalHeight;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > EDITOR_IMAGE_PIXELS_MAX_DIMENSION ||
		height > EDITOR_IMAGE_PIXELS_MAX_DIMENSION
	) {
		return { code: "editor-image-pixels-dimensions-invalid", status: "failed" };
	}
	const pixelCount = width * height;
	if (pixelCount > EDITOR_IMAGE_PIXELS_MAX_TOTAL_PIXELS) {
		return { code: "editor-image-pixels-pixel-limit", status: "failed" };
	}
	return {
		status: "valid",
		value: {
			fingerprint,
			height,
			image: lease.image,
			pixelCount,
			source: source.href,
			width,
		},
	};
}

function leaseIsCurrent(
	lease: EditorImagePixelsLease,
	fingerprint: ImageFingerprint,
): boolean {
	try {
		const currentFingerprint = captureFingerprint(lease.image);
		return (
			lease.isCurrent() &&
			!!currentFingerprint &&
			sameFingerprint(fingerprint, currentFingerprint)
		);
	} catch {
		return false;
	}
}

function encodePng(
	canvas: HTMLCanvasElement,
	signal: AbortSignal,
): Promise<PngEncodingResult> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: PngEncodingResult): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			resolve(result);
		};
		const onAbort = (): void => finish({ status: "aborted" });
		if (signal.aborted) {
			finish({ status: "aborted" });
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			canvas.toBlob((blob) => {
				if (null === blob) {
					finish({ status: "empty" });
					return;
				}
				finish({ blob, status: "encoded" });
			}, "image/png");
		} catch (error) {
			finish({
				status:
					"undefined" !== typeof DOMException &&
					error instanceof DOMException &&
					"SecurityError" === error.name
						? "tainted"
						: "failed",
			});
		}
	});
}

function drawFailureCode(error: unknown): EditorImagePixelsFailureCode {
	return "undefined" !== typeof DOMException &&
		error instanceof DOMException &&
		"SecurityError" === error.name
		? "editor-image-pixels-tainted"
		: "editor-image-pixels-draw-failed";
}

export function createBrowserEditorImagePixels(
	suppliedRuntime:
		| BrowserEditorImagePixelsRuntime
		| null
		| undefined = defaultRuntime(),
): EditorImagePixelsPort {
	let active = true;
	const pending = new Set<(result: EditorImagePixelsResult) => void>();
	const supports = (): boolean =>
		active && runtimeSupportsCanvas(suppliedRuntime);

	const canExtract = (lease: EditorImagePixelsLease): boolean =>
		supports() &&
		Boolean(
			suppliedRuntime &&
				"valid" === validateImage(suppliedRuntime, lease).status,
		);

	const extractPng = (
		request: EditorImagePixelsRequest,
	): Promise<EditorImagePixelsResult> => {
		if (!active) return Promise.resolve(failed("editor-image-pixels-disposed"));
		if (!suppliedRuntime || !runtimeSupportsCanvas(suppliedRuntime)) {
			return Promise.resolve(failed("editor-image-pixels-unsupported"));
		}
		return new Promise((resolve) => {
			let settled = false;
			let canvas: HTMLCanvasElement | null = null;
			let timeout: unknown = null;
			let removeAbort = (): void => undefined;
			const controller = new AbortController();
			const finish = (result: EditorImagePixelsResult): void => {
				if (settled) return;
				settled = true;
				if (null !== timeout) suppliedRuntime.clearTimeout(timeout);
				removeAbort();
				controller.abort();
				if (canvas) {
					canvas.width = 0;
					canvas.height = 0;
				}
				pending.delete(finish);
				resolve(result);
			};
			pending.add(finish);
			if (request.signal) {
				const onAbort = (): void =>
					finish(failed("editor-image-pixels-cancelled"));
				if (request.signal.aborted) {
					finish(failed("editor-image-pixels-cancelled"));
					return;
				}
				request.signal.addEventListener("abort", onAbort, { once: true });
				removeAbort = () =>
					request.signal?.removeEventListener("abort", onAbort);
			}
			timeout = suppliedRuntime.setTimeout(
				() => finish(failed("editor-image-pixels-timeout")),
				EDITOR_IMAGE_PIXELS_TIMEOUT_MS,
			);
			void (async (): Promise<void> => {
				const validation = validateImage(suppliedRuntime, request.lease);
				if ("failed" === validation.status) {
					finish(failed(validation.code));
					return;
				}
				const { fingerprint, height, image, pixelCount, source, width } =
					validation.value;
				if (!leaseIsCurrent(request.lease, fingerprint)) {
					finish(failed("editor-image-pixels-lease-stale"));
					return;
				}
				try {
					canvas =
						suppliedRuntime.createCanvas?.() ??
						suppliedRuntime.document.createElement("canvas");
					canvas.width = width;
					canvas.height = height;
					const context = canvas.getContext("2d");
					if (!context) {
						finish(failed("editor-image-pixels-canvas-unavailable"));
						return;
					}
					if (!leaseIsCurrent(request.lease, fingerprint)) {
						finish(failed("editor-image-pixels-lease-stale"));
						return;
					}
					try {
						context.drawImage(image, 0, 0);
					} catch (error) {
						finish(failed(drawFailureCode(error)));
						return;
					}
					const encoding = await encodePng(canvas, controller.signal);
					if (settled) return;
					if ("encoded" !== encoding.status) {
						finish(
							failed(
								"aborted" === encoding.status
									? "editor-image-pixels-cancelled"
									: "empty" === encoding.status
										? "editor-image-pixels-empty"
										: "tainted" === encoding.status
											? "editor-image-pixels-tainted"
											: "editor-image-pixels-encode-failed",
							),
						);
						return;
					}
					if (!leaseIsCurrent(request.lease, fingerprint)) {
						finish(failed("editor-image-pixels-lease-stale"));
						return;
					}
					if (
						"string" !== typeof encoding.blob.type ||
						"image/png" !== encoding.blob.type.toLowerCase()
					) {
						finish(failed("editor-image-pixels-mime-invalid"));
						return;
					}
					if (
						"number" !== typeof encoding.blob.size ||
						!Number.isFinite(encoding.blob.size) ||
						encoding.blob.size < 1
					) {
						finish(failed("editor-image-pixels-empty"));
						return;
					}
					if (encoding.blob.size > EDITOR_IMAGE_PIXELS_MAX_BYTES) {
						finish(failed("editor-image-pixels-output-too-large"));
						return;
					}
					finish({
						blob: encoding.blob,
						height,
						pixelCount,
						source,
						status: "extracted",
						width,
					});
				} catch (error) {
					if (!settled)
						finish(
							failed(
								"undefined" !== typeof DOMException &&
									error instanceof DOMException &&
									"SecurityError" === error.name
									? "editor-image-pixels-tainted"
									: "editor-image-pixels-encode-failed",
							),
						);
				}
			})();
		});
	};

	return {
		canExtract,
		dispose: () => {
			if (!active) return;
			active = false;
			for (const finish of Array.from(pending)) {
				finish(failed("editor-image-pixels-disposed"));
			}
		},
		extractPng,
		supports,
	};
}
