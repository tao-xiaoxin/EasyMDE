import {
	DEFAULT_EDITOR_CLIPBOARD_IMAGE_MAX_BYTES,
	type EditorClipboardImageWriteResult,
	type EditorClipboardPort,
	type EditorClipboardWriteResult,
} from "../../contracts/ports/editor-clipboard-port";
import type {
	EditorDownloadPort,
	EditorDownloadResult,
} from "../../contracts/ports/editor-download-port";
import type {
	WechatVisualRasterizationPort,
	WechatVisualRasterizationResult,
} from "../../contracts/ports/wechat-visual-rasterization-port";
import {
	type GeneratedContentAcceptedPreview,
	type GeneratedContentTarget,
	type GeneratedContentTargetLease,
	generatedContentTargetMatchesIdentity,
} from "./generated-content-target";

export type GeneratedContentExportMode = "immersive" | "ordinary";

export type GeneratedContentExportIdentity = Readonly<{
	acceptedPreview: GeneratedContentAcceptedPreview;
	mode: GeneratedContentExportMode;
	sourceRevision: number;
}>;

export type GeneratedContentExportFailureCode =
	| "generated-content-export-clipboard-failed"
	| "generated-content-export-clipboard-unsupported"
	| "generated-content-export-disposed"
	| "generated-content-export-kind-invalid"
	| "generated-content-export-lease-stale"
	| "generated-content-export-mathml-unavailable"
	| "generated-content-export-mode-stale"
	| "generated-content-export-operation-stale"
	| "generated-content-export-preview-stale"
	| "generated-content-export-rasterization-failed"
	| "generated-content-export-rasterization-invalid"
	| "generated-content-export-rasterization-timeout"
	| "generated-content-export-source-stale"
	| "generated-content-export-target-invalid"
	| "generated-content-export-download-failed";

export type GeneratedContentExportResult =
	| Readonly<{ status: "copied" | "requested" }>
	| Readonly<{
			code: GeneratedContentExportFailureCode;
			status: "failed";
	  }>;

export type GeneratedContentExportDimensions = Readonly<{
	height: number;
	width: number;
}>;

export type GeneratedContentExportRequest = Readonly<{
	dimensions?: GeneratedContentExportDimensions;
	identity: () => GeneratedContentExportIdentity | null;
	mode: GeneratedContentExportMode;
	lease: GeneratedContentTargetLease;
	validateLease: (
		lease: GeneratedContentTargetLease,
		identity: GeneratedContentExportIdentity,
	) => boolean;
}>;

export type GeneratedContentSaveAsImageRequest = GeneratedContentExportRequest &
	Readonly<{
		filename: string;
	}>;

export type GeneratedContentExportSession = Readonly<{
	copyAsImage: (
		request: GeneratedContentExportRequest,
	) => Promise<GeneratedContentExportResult>;
	copyMathMl: (
		request: GeneratedContentExportRequest,
	) => Promise<GeneratedContentExportResult>;
	dispose: () => void;
	saveAsImage: (
		request: GeneratedContentSaveAsImageRequest,
	) => Promise<GeneratedContentExportResult>;
}>;

export type CreateGeneratedContentExportSessionOptions = Readonly<{
	clipboard: EditorClipboardPort;
	download: EditorDownloadPort;
	maxBytes?: number;
	maxPixels?: number;
	rasterScale?: number;
	rasterizationTimeoutMs?: number;
	rasterizer: WechatVisualRasterizationPort;
}>;

type Operation = Readonly<{
	controller: AbortController;
	sequence: number;
}>;

class ExportError extends Error {
	readonly code: GeneratedContentExportFailureCode;

	constructor(code: GeneratedContentExportFailureCode) {
		super(code);
		this.name = "GeneratedContentExportError";
		this.code = code;
	}
}

const DEFAULT_MAX_PIXELS = 16_777_216;
const DEFAULT_RASTER_SCALE = 1;
const DEFAULT_RASTERIZATION_TIMEOUT_MS = 10_000;
const MAX_BYTES = 16_777_216;
const MAX_PIXELS = 16_777_216;
const MAX_DIMENSION = 4096;
const MAX_RASTERIZATION_TIMEOUT_MS = 10_000;

function failed(
	code: GeneratedContentExportFailureCode,
): GeneratedContentExportResult {
	return { code, status: "failed" };
}

function validDimensions(
	dimensions: GeneratedContentExportDimensions,
): boolean {
	return (
		Number.isFinite(dimensions.width) &&
		Number.isFinite(dimensions.height) &&
		dimensions.width >= 1 &&
		dimensions.height >= 1 &&
		dimensions.width <= MAX_DIMENSION &&
		dimensions.height <= MAX_DIMENSION
	);
}

function validPositiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function validIdentity(
	identity: GeneratedContentExportIdentity | null,
): identity is GeneratedContentExportIdentity {
	return Boolean(
		identity &&
			("ordinary" === identity.mode || "immersive" === identity.mode) &&
			Number.isSafeInteger(identity.sourceRevision) &&
			identity.sourceRevision >= 0 &&
			!!identity.acceptedPreview &&
			Number.isSafeInteger(identity.acceptedPreview.revision) &&
			identity.acceptedPreview.revision >= 0 &&
			"string" === typeof identity.acceptedPreview.signature &&
			identity.acceptedPreview.signature.length > 0,
	);
}

function visualDimensions(
	request: GeneratedContentExportRequest,
): GeneratedContentExportDimensions | null {
	if (request.dimensions) return request.dimensions;
	if ("function" !== typeof request.lease.root.getBoundingClientRect)
		return null;
	const rect = request.lease.root.getBoundingClientRect();
	return { height: rect.height, width: rect.width };
}

function validTarget(target: GeneratedContentTarget): boolean {
	return (
		!!target &&
		("math" === target.kind || "mermaid" === target.kind) &&
		"string" === typeof target.blockId &&
		target.blockId.length > 0 &&
		Number.isSafeInteger(target.ordinal) &&
		target.ordinal >= 0 &&
		Number.isSafeInteger(target.sourceRevision) &&
		target.sourceRevision >= 0 &&
		!!target.acceptedPreview &&
		Number.isSafeInteger(target.acceptedPreview.revision) &&
		target.acceptedPreview.revision >= 0 &&
		"string" === typeof target.acceptedPreview.signature &&
		target.acceptedPreview.signature.length > 0 &&
		!!target.original &&
		"string" === typeof target.original.full &&
		"string" === typeof target.original.body
	);
}

function leaseFailure(
	request: GeneratedContentExportRequest,
): GeneratedContentExportFailureCode | null {
	const lease = request.lease;
	if (!lease || !validTarget(lease.target)) {
		return "generated-content-export-target-invalid";
	}
	if (1 !== lease.root?.nodeType || !lease.root.isConnected) {
		return "generated-content-export-lease-stale";
	}
	if ("function" !== typeof request.validateLease) {
		return "generated-content-export-lease-stale";
	}
	return null;
}

function currentFailure(
	operation: Operation,
	active: boolean,
	currentSequence: number,
	request: GeneratedContentExportRequest,
): GeneratedContentExportFailureCode | null {
	if (!active) return "generated-content-export-disposed";
	if (operation.sequence !== currentSequence)
		return "generated-content-export-operation-stale";
	const leaseFailureCode = leaseFailure(request);
	if (leaseFailureCode) return leaseFailureCode;
	const target = request.lease.target;
	let identity: GeneratedContentExportIdentity | null;
	try {
		identity = request.identity();
	} catch {
		return "generated-content-export-source-stale";
	}
	if (!validIdentity(identity)) return "generated-content-export-source-stale";
	if (identity.mode !== request.mode)
		return "generated-content-export-mode-stale";
	if (identity.sourceRevision !== target.sourceRevision) {
		return "generated-content-export-source-stale";
	}
	if (
		identity.acceptedPreview.revision !== target.acceptedPreview.revision ||
		identity.acceptedPreview.signature !== target.acceptedPreview.signature
	) {
		return "generated-content-export-preview-stale";
	}
	if (!generatedContentTargetMatchesIdentity(target, identity)) {
		return "generated-content-export-preview-stale";
	}
	try {
		if (!request.validateLease(request.lease, identity)) {
			return "generated-content-export-lease-stale";
		}
	} catch {
		return "generated-content-export-lease-stale";
	}
	return null;
}

function imageClipboardFailure(
	result: EditorClipboardImageWriteResult,
): GeneratedContentExportResult {
	if ("written" === result.status) return { status: "copied" };
	return "editor-clipboard-unsupported" === result.code
		? failed("generated-content-export-clipboard-unsupported")
		: failed("generated-content-export-clipboard-failed");
}

function textClipboardFailure(
	result: EditorClipboardWriteResult,
): GeneratedContentExportResult {
	if ("written" === result.status) return { status: "copied" };
	return "editor-clipboard-unsupported" === result.code
		? failed("generated-content-export-clipboard-unsupported")
		: failed("generated-content-export-clipboard-failed");
}

function downloadFailure(
	_result: EditorDownloadResult,
): GeneratedContentExportResult {
	return failed("generated-content-export-download-failed");
}

function mathMlText(source: Element): string | null {
	const katexRoot = source.matches(".katex")
		? source
		: source.querySelector(":scope > .katex, :scope > .katex-display > .katex");
	const mathMlRoot = katexRoot?.querySelector(":scope > .katex-mathml");
	const math = mathMlRoot?.querySelector(":scope > math");
	if (!math || "string" !== typeof math.outerHTML || "" === math.outerHTML)
		return null;
	return math.outerHTML;
}

export function createGeneratedContentExportSession({
	clipboard,
	download,
	maxBytes = DEFAULT_EDITOR_CLIPBOARD_IMAGE_MAX_BYTES,
	maxPixels = DEFAULT_MAX_PIXELS,
	rasterScale = DEFAULT_RASTER_SCALE,
	rasterizationTimeoutMs = DEFAULT_RASTERIZATION_TIMEOUT_MS,
	rasterizer,
}: CreateGeneratedContentExportSessionOptions): GeneratedContentExportSession {
	let active = true;
	let currentSequence = 0;
	let pending: Operation | null = null;

	const begin = (): Operation | null => {
		if (!active) return null;
		pending?.controller.abort();
		const operation: Operation = {
			controller: new AbortController(),
			sequence: ++currentSequence,
		};
		pending = operation;
		return operation;
	};

	const finish = (operation: Operation): void => {
		if (pending === operation) pending = null;
	};

	const rasterize = async (
		operation: Operation,
		request: GeneratedContentExportRequest,
	): Promise<WechatVisualRasterizationResult> => {
		const initialFailure = currentFailure(
			operation,
			active,
			currentSequence,
			request,
		);
		if (initialFailure) throw new ExportError(initialFailure);
		const dimensions = visualDimensions(request);
		if (!dimensions || !validDimensions(dimensions)) {
			throw new ExportError("generated-content-export-rasterization-invalid");
		}
		if (
			!validPositiveInteger(maxPixels) ||
			maxPixels > MAX_PIXELS ||
			!Number.isFinite(rasterScale) ||
			rasterScale < 1 ||
			rasterScale > 2
		) {
			throw new ExportError("generated-content-export-rasterization-invalid");
		}
		if (!validPositiveInteger(maxBytes) || maxBytes > MAX_BYTES) {
			throw new ExportError("generated-content-export-rasterization-invalid");
		}
		if (!validPositiveInteger(rasterizationTimeoutMs)) {
			throw new ExportError("generated-content-export-rasterization-invalid");
		}
		if (rasterizationTimeoutMs > MAX_RASTERIZATION_TIMEOUT_MS) {
			throw new ExportError("generated-content-export-rasterization-invalid");
		}
		const outputWidth = Math.ceil(dimensions.width * rasterScale);
		const outputHeight = Math.ceil(dimensions.height * rasterScale);
		if (
			!Number.isSafeInteger(outputWidth) ||
			!Number.isSafeInteger(outputHeight) ||
			outputWidth < 1 ||
			outputHeight < 1 ||
			outputWidth * outputHeight > maxPixels
		) {
			throw new ExportError("generated-content-export-rasterization-invalid");
		}

		let timer: ReturnType<typeof setTimeout> | null = null;
		let timeoutTriggered = false;
		let removeAbortListener = (): void => undefined;
		const rasterization = Promise.resolve().then(() =>
			rasterizer.rasterize({
				height: dimensions.height,
				kind: request.lease.target.kind,
				maxPixels,
				scale: rasterScale,
				signal: operation.controller.signal,
				source: request.lease.root,
				width: dimensions.width,
			}),
		);
		void rasterization.catch(() => undefined);
		const cancellation = new Promise<WechatVisualRasterizationResult>(
			(_resolve, reject) => {
				const onAbort = (): void => {
					if (timeoutTriggered) return;
					const failure = currentFailure(
						operation,
						active,
						currentSequence,
						request,
					);
					reject(
						new ExportError(
							failure ?? "generated-content-export-operation-stale",
						),
					);
				};
				removeAbortListener = (): void => {
					operation.controller.signal.removeEventListener("abort", onAbort);
				};
				if (operation.controller.signal.aborted) {
					onAbort();
				} else {
					operation.controller.signal.addEventListener("abort", onAbort, {
						once: true,
					});
				}
			},
		);
		const timeout = new Promise<WechatVisualRasterizationResult>(
			(_resolve, reject) => {
				timer = setTimeout(() => {
					timeoutTriggered = true;
					operation.controller.abort();
					reject(
						new ExportError("generated-content-export-rasterization-timeout"),
					);
				}, rasterizationTimeoutMs);
			},
		);
		try {
			const result = await Promise.race([rasterization, timeout, cancellation]);
			const afterFailure = currentFailure(
				operation,
				active,
				currentSequence,
				request,
			);
			if (afterFailure) throw new ExportError(afterFailure);
			if (
				!result?.file ||
				!(result.file instanceof Blob) ||
				"image/png" !== result.file.type.toLowerCase() ||
				result.file.size < 1 ||
				result.file.size > maxBytes ||
				!Number.isFinite(result.width) ||
				!Number.isFinite(result.height) ||
				result.width !== dimensions.width ||
				result.height !== dimensions.height ||
				!Number.isSafeInteger(result.pixelCount) ||
				result.pixelCount < 1 ||
				result.pixelCount > maxPixels ||
				result.pixelCount !== outputWidth * outputHeight
			) {
				throw new ExportError("generated-content-export-rasterization-invalid");
			}
			return result;
		} finally {
			if (timer) clearTimeout(timer);
			removeAbortListener();
		}
	};

	const copyAsImage = async (
		request: GeneratedContentExportRequest,
	): Promise<GeneratedContentExportResult> => {
		if (!active) return failed("generated-content-export-disposed");
		const requestFailure = leaseFailure(request);
		if (requestFailure) return failed(requestFailure);
		if (
			request.lease.target.kind !== "math" &&
			request.lease.target.kind !== "mermaid"
		) {
			return failed("generated-content-export-kind-invalid");
		}
		const initialFailure = currentFailure(
			{ controller: new AbortController(), sequence: currentSequence },
			active,
			currentSequence,
			request,
		);
		if (initialFailure) return failed(initialFailure);
		let pngSupported = false;
		try {
			pngSupported = clipboard.supportsPngWrite?.() === true;
		} catch {
			pngSupported = false;
		}
		if (!pngSupported) {
			return failed("generated-content-export-clipboard-unsupported");
		}
		if ("function" !== typeof clipboard.writeImageDeferred) {
			return failed("generated-content-export-clipboard-unsupported");
		}
		const operation = begin();
		if (!operation) return failed("generated-content-export-disposed");

		let rasterizationFailure: GeneratedContentExportFailureCode | null = null;
		const image = rasterize(operation, request)
			.catch((error: unknown) => {
				rasterizationFailure =
					error instanceof ExportError
						? error.code
						: "generated-content-export-rasterization-failed";
				throw error;
			})
			.then((result) => result.file);
		void image.catch(() => undefined);

		let writeResult: EditorClipboardImageWriteResult;
		try {
			// Keep this invocation before the first await so the original click activation reaches ClipboardItem.
			writeResult = await clipboard.writeImageDeferred(image, {
				maxBytes,
				signal: operation.controller.signal,
			});
		} catch {
			operation.controller.abort();
			finish(operation);
			const stale = currentFailure(operation, active, currentSequence, request);
			if (stale) return failed(stale);
			return rasterizationFailure
				? failed(rasterizationFailure)
				: failed("generated-content-export-clipboard-failed");
		}
		if ("written" === writeResult.status) {
			try {
				await image;
			} catch {
				operation.controller.abort();
			}
		} else {
			operation.controller.abort();
		}
		const stale = currentFailure(operation, active, currentSequence, request);
		finish(operation);
		if (stale) return failed(stale);
		if (rasterizationFailure) return failed(rasterizationFailure);
		return "written" === writeResult.status
			? { status: "copied" }
			: imageClipboardFailure(writeResult);
	};

	const copyMathMl = async (
		request: GeneratedContentExportRequest,
	): Promise<GeneratedContentExportResult> => {
		if (!active) return failed("generated-content-export-disposed");
		const requestFailure = leaseFailure(request);
		if (requestFailure) return failed(requestFailure);
		if ("math" !== request.lease.target.kind)
			return failed("generated-content-export-kind-invalid");
		const operation = begin();
		if (!operation) return failed("generated-content-export-disposed");
		const initialFailure = currentFailure(
			operation,
			active,
			currentSequence,
			request,
		);
		if (initialFailure) {
			finish(operation);
			return failed(initialFailure);
		}
		const text = mathMlText(request.lease.root);
		if (!text) {
			finish(operation);
			return failed("generated-content-export-mathml-unavailable");
		}
		let result: EditorClipboardWriteResult;
		try {
			result = await clipboard.write(text, {
				signal: operation.controller.signal,
			});
		} catch {
			finish(operation);
			const stale = currentFailure(operation, active, currentSequence, request);
			if (stale) return failed(stale);
			return failed("generated-content-export-clipboard-failed");
		}
		const stale = currentFailure(operation, active, currentSequence, request);
		finish(operation);
		if (stale) return failed(stale);
		return "written" === result.status
			? { status: "copied" }
			: textClipboardFailure(result);
	};

	const saveAsImage = async (
		request: GeneratedContentSaveAsImageRequest,
	): Promise<GeneratedContentExportResult> => {
		if (!active) return failed("generated-content-export-disposed");
		const requestFailure = leaseFailure(request);
		if (requestFailure) return failed(requestFailure);
		const operation = begin();
		if (!operation) return failed("generated-content-export-disposed");
		let rasterizationFailure: GeneratedContentExportFailureCode | null = null;
		let result: WechatVisualRasterizationResult;
		try {
			result = await rasterize(operation, request);
		} catch (error: unknown) {
			rasterizationFailure =
				error instanceof ExportError
					? error.code
					: "generated-content-export-rasterization-failed";
			finish(operation);
			return failed(rasterizationFailure);
		}
		if (rasterizationFailure) {
			finish(operation);
			return failed(rasterizationFailure);
		}
		const stale = currentFailure(operation, active, currentSequence, request);
		if (stale) {
			finish(operation);
			return failed(stale);
		}
		let downloadResult: EditorDownloadResult;
		try {
			downloadResult = await download.requestPngDownload(
				result.file,
				request.filename,
				operation.controller.signal,
			);
		} catch {
			finish(operation);
			const stale = currentFailure(operation, active, currentSequence, request);
			if (stale) return failed(stale);
			return failed("generated-content-export-download-failed");
		}
		const afterDownloadFailure = currentFailure(
			operation,
			active,
			currentSequence,
			request,
		);
		finish(operation);
		if (afterDownloadFailure) return failed(afterDownloadFailure);
		return "requested" === downloadResult.status
			? { status: "requested" }
			: downloadFailure(downloadResult);
	};

	return {
		copyAsImage,
		copyMathMl,
		dispose() {
			if (!active) return;
			active = false;
			currentSequence += 1;
			pending?.controller.abort();
			pending = null;
		},
		saveAsImage,
	};
}
