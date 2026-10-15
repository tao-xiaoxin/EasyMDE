import type {
	EditorClipboardFailureCode,
	EditorClipboardImageOperationOptions,
	EditorClipboardImageWriteResult,
	EditorClipboardOperationOptions,
	EditorClipboardPort,
	EditorClipboardReadResult,
	EditorClipboardRichOperationOptions,
	EditorClipboardRichPayload,
	EditorClipboardRichWriteResult,
	EditorClipboardState,
	EditorClipboardWriteResult,
} from "../../../contracts/ports/editor-clipboard-port";
import {
	DEFAULT_EDITOR_CLIPBOARD_IMAGE_MAX_BYTES,
	DEFAULT_EDITOR_CLIPBOARD_RICH_MAX_BYTES,
} from "../../../contracts/ports/editor-clipboard-port";

export type BrowserEditorClipboardRuntime = Readonly<{
	readText: () => Promise<string>;
	supportsPngWrite?: () => boolean;
	supportsRichWrite?: () => boolean;
	writeDeferred?: (text: Promise<string>) => Promise<void>;
	writeImageDeferred?: (image: Promise<Blob>) => Promise<void>;
	writeRichDeferred?: (
		payload: Promise<EditorClipboardRichPayload>,
	) => Promise<void>;
	writeText: (text: string) => Promise<void>;
}>;

type MutableOperation = Readonly<{
	id: number;
	signal?: AbortSignal;
}>;

type DeferredWriteOperation = Readonly<{
	cleanup: () => void;
	reject: (reason: unknown) => void;
}>;

type ImagePayloadFailureCode = Extract<
	EditorClipboardFailureCode,
	| "editor-clipboard-image-invalid"
	| "editor-clipboard-image-payload-failed"
	| "editor-clipboard-image-too-large"
>;

type RichPayloadFailureCode = Extract<
	EditorClipboardFailureCode,
	| "editor-clipboard-rich-payload-failed"
	| "editor-clipboard-rich-payload-invalid"
	| "editor-clipboard-rich-payload-too-large"
>;

type ClipboardItemConstructor = new (
	payload: Record<string, Blob | PromiseLike<Blob>>,
) => unknown;

type ClipboardItemConstructorWithSupport = ClipboardItemConstructor & {
	supports?: (type: string) => boolean;
};

function supportsPngClipboardWrite(
	clipboard: Clipboard,
	clipboardItem: ClipboardItemConstructorWithSupport | null,
): boolean {
	if (
		"function" !== typeof clipboard.write ||
		null === clipboardItem ||
		"function" !== typeof clipboardItem.supports
	) {
		return false;
	}
	try {
		return true === clipboardItem.supports("image/png");
	} catch {
		return false;
	}
}

function supportsRichClipboardWrite(
	clipboard: Clipboard,
	clipboardItem: ClipboardItemConstructorWithSupport | null,
): boolean {
	if (
		"function" !== typeof clipboard.write ||
		null === clipboardItem ||
		"function" !== typeof clipboardItem.supports
	) {
		return false;
	}
	try {
		return (
			true === clipboardItem.supports("text/html") &&
			true === clipboardItem.supports("text/plain")
		);
	} catch {
		return false;
	}
}

class ImagePayloadError extends Error {
	readonly code: ImagePayloadFailureCode;

	constructor(code: ImagePayloadFailureCode) {
		super(code);
		this.name = "ImagePayloadError";
		this.code = code;
	}
}

class RichPayloadError extends Error {
	readonly code: RichPayloadFailureCode;

	constructor(code: RichPayloadFailureCode) {
		super(code);
		this.name = "RichPayloadError";
		this.code = code;
	}
}

class ClipboardOperationError extends Error {
	readonly code: Extract<
		EditorClipboardFailureCode,
		"editor-clipboard-cancelled" | "editor-clipboard-disposed"
	>;

	constructor(code: ClipboardOperationError["code"]) {
		super(code);
		this.name = "ClipboardOperationError";
		this.code = code;
	}
}

function cancelledResult(): EditorClipboardReadResult {
	return { code: "editor-clipboard-cancelled", status: "failed" };
}

function failureResult(
	code: Extract<EditorClipboardFailureCode, "editor-clipboard-disposed">,
): EditorClipboardReadResult {
	return { code, status: "failed" };
}

function browserClipboardRuntime(): BrowserEditorClipboardRuntime | null {
	if ("undefined" === typeof navigator || !navigator.clipboard) {
		return null;
	}
	const clipboard = navigator.clipboard;
	const clipboardItemValue = (
		globalThis as typeof globalThis & { ClipboardItem?: unknown }
	).ClipboardItem;
	const clipboardItem =
		"function" === typeof clipboardItemValue
			? (clipboardItemValue as ClipboardItemConstructorWithSupport)
			: null;
	const supportsPng = supportsPngClipboardWrite(clipboard, clipboardItem);
	const supportsRich = supportsRichClipboardWrite(clipboard, clipboardItem);

	return {
		readText: () => clipboard.readText(),
		supportsPngWrite: () => supportsPng,
		supportsRichWrite: () => supportsRich,
		...(supportsPng && clipboardItem
			? {
					writeImageDeferred: (image: Promise<Blob>): Promise<void> => {
						const item = new clipboardItem({ "image/png": image });
						return clipboard.write([item] as unknown as ClipboardItems);
					},
				}
			: {}),
		...(supportsRich && clipboardItem
			? {
					writeRichDeferred: (
						payload: Promise<EditorClipboardRichPayload>,
					): Promise<void> => {
						const html = payload.then(
							(value) => new Blob([value.html], { type: "text/html" }),
						);
						const text = payload.then(
							(value) => new Blob([value.text], { type: "text/plain" }),
						);
						void html.catch(() => undefined);
						void text.catch(() => undefined);
						const item = new clipboardItem({
							"text/html": html,
							"text/plain": text,
						});
						return clipboard.write([item] as unknown as ClipboardItems);
					},
				}
			: {}),
		writeText: (text) => clipboard.writeText(text),
	};
}

function readResult(text: string): EditorClipboardReadResult {
	return "" === text ? { status: "empty" } : { status: "available", text };
}

function unavailableResult(
	code: Extract<
		EditorClipboardFailureCode,
		"editor-clipboard-read-failed" | "editor-clipboard-unsupported"
	>,
): EditorClipboardReadResult {
	return { code, status: "unavailable" };
}

function imageFailureResult(
	code: ImagePayloadFailureCode,
): EditorClipboardImageWriteResult {
	return { code, status: "failed" };
}

function richFailureResult(
	code: RichPayloadFailureCode,
): EditorClipboardRichWriteResult {
	return { code, status: "failed" };
}

function operationFailureResult(
	code: Extract<
		EditorClipboardFailureCode,
		"editor-clipboard-cancelled" | "editor-clipboard-disposed"
	>,
): EditorClipboardImageWriteResult {
	return { code, status: "failed" };
}

function richOperationFailureResult(
	code: Extract<
		EditorClipboardFailureCode,
		"editor-clipboard-cancelled" | "editor-clipboard-disposed"
	>,
): EditorClipboardRichWriteResult {
	return { code, status: "failed" };
}

function imageMaxBytes(
	options?: EditorClipboardImageOperationOptions,
): number | null {
	const maxBytes =
		options?.maxBytes ?? DEFAULT_EDITOR_CLIPBOARD_IMAGE_MAX_BYTES;
	return Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : null;
}

function richMaxBytes(
	options?: EditorClipboardRichOperationOptions,
): number | null {
	const maxBytes = options?.maxBytes ?? DEFAULT_EDITOR_CLIPBOARD_RICH_MAX_BYTES;
	return Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : null;
}

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const codePoint = value.codePointAt(index) ?? 0;
		if (codePoint > 0xffff) index += 1;
		bytes +=
			codePoint <= 0x7f
				? 1
				: codePoint <= 0x7ff
					? 2
					: codePoint <= 0xffff
						? 3
						: 4;
	}
	return bytes;
}

function validateRichPayload(
	value: unknown,
	maxBytes: number,
): EditorClipboardRichPayload {
	if (!value || "object" !== typeof value || Array.isArray(value)) {
		throw new RichPayloadError("editor-clipboard-rich-payload-invalid");
	}
	const candidate = value as Record<string, unknown>;
	if (
		2 !== Object.keys(candidate).length ||
		"string" !== typeof candidate.html ||
		"string" !== typeof candidate.text ||
		"" === candidate.html ||
		"" === candidate.text
	) {
		throw new RichPayloadError("editor-clipboard-rich-payload-invalid");
	}
	if (
		utf8ByteLength(candidate.html) > maxBytes ||
		utf8ByteLength(candidate.text) > maxBytes
	) {
		throw new RichPayloadError("editor-clipboard-rich-payload-too-large");
	}
	return { html: candidate.html, text: candidate.text };
}

function validateImagePayload(value: unknown, maxBytes: number): Blob {
	if ("undefined" === typeof Blob || !(value instanceof Blob)) {
		throw new ImagePayloadError("editor-clipboard-image-invalid");
	}
	if ("image/png" !== value.type.toLowerCase() || value.size < 1) {
		throw new ImagePayloadError("editor-clipboard-image-invalid");
	}
	if (value.size > maxBytes) {
		throw new ImagePayloadError("editor-clipboard-image-too-large");
	}
	return value;
}

function imageFailureCode(reason: unknown): ImagePayloadFailureCode | null {
	if (reason instanceof ImagePayloadError) return reason.code;
	return null;
}

function richFailureCode(reason: unknown): RichPayloadFailureCode | null {
	if (reason instanceof RichPayloadError) return reason.code;
	return null;
}

function operationFailureCode(
	reason: unknown,
): Extract<
	EditorClipboardFailureCode,
	"editor-clipboard-cancelled" | "editor-clipboard-disposed"
> | null {
	if (reason instanceof ClipboardOperationError) return reason.code;
	return null;
}

export function createBrowserEditorClipboard(
	runtime:
		| BrowserEditorClipboardRuntime
		| null
		| undefined = browserClipboardRuntime(),
): EditorClipboardPort {
	const listeners = new Set<() => void>();
	let active = true;
	let nextOperationId = 0;
	let pendingRead: MutableOperation | null = null;
	const deferredWrites = new Set<DeferredWriteOperation>();
	const deferredImageWrites = new Set<DeferredWriteOperation>();
	const deferredRichWrites = new Set<DeferredWriteOperation>();
	let state: EditorClipboardState = { status: "unknown" };

	const supportsPngWrite = (): boolean =>
		active &&
		Boolean(runtime?.writeImageDeferred) &&
		(runtime?.supportsPngWrite ? runtime.supportsPngWrite() : true);

	const supportsRichWrite = (): boolean =>
		active &&
		Boolean(runtime?.writeRichDeferred) &&
		(runtime?.supportsRichWrite ? runtime.supportsRichWrite() : true);

	const publish = (nextState: EditorClipboardState): void => {
		if (!active || nextState.status === state.status) {
			if (
				!active ||
				("unavailable" === nextState.status &&
					"unavailable" === state.status &&
					nextState.code === state.code)
			) {
				return;
			}
		}
		if (
			nextState.status === state.status &&
			("unavailable" !== nextState.status ||
				"unavailable" !== state.status ||
				nextState.code === state.code)
		) {
			return;
		}
		state = nextState;
		for (const listener of listeners) listener();
	};

	const beginRead = (
		options?: EditorClipboardOperationOptions,
	): MutableOperation | EditorClipboardReadResult => {
		if (!active) return failureResult("editor-clipboard-disposed");
		if (options?.signal?.aborted) return cancelledResult();
		const operation: MutableOperation = {
			id: ++nextOperationId,
			...(options?.signal ? { signal: options.signal } : {}),
		};
		pendingRead = operation;
		publish({ status: "checking" });
		return operation;
	};

	const read = async (
		options?: EditorClipboardOperationOptions,
	): Promise<EditorClipboardReadResult> => {
		const operationOrResult = beginRead(options);
		if ("status" in operationOrResult) return operationOrResult;
		const operation = operationOrResult;

		if (!runtime) {
			if (pendingRead?.id === operation.id) {
				pendingRead = null;
				publish({
					code: "editor-clipboard-unsupported",
					status: "unavailable",
				});
			}
			return unavailableResult("editor-clipboard-unsupported");
		}

		try {
			const text = await runtime.readText();
			if (!active) return failureResult("editor-clipboard-disposed");
			if (pendingRead?.id !== operation.id || operation.signal?.aborted)
				return cancelledResult();
			pendingRead = null;
			const result = readResult(text);
			if ("available" === result.status) {
				publish({ status: "available" });
			} else if ("empty" === result.status) {
				publish(result);
			}
			return result;
		} catch {
			if (!active) return failureResult("editor-clipboard-disposed");
			if (pendingRead?.id !== operation.id) return cancelledResult();
			if (operation.signal?.aborted) {
				return cancelledResult();
			}
			pendingRead = null;
			publish({ code: "editor-clipboard-read-failed", status: "unavailable" });
			return unavailableResult("editor-clipboard-read-failed");
		}
	};

	const write = async (
		text: string,
		options?: EditorClipboardOperationOptions,
	): Promise<EditorClipboardWriteResult> => {
		if (!active) return { code: "editor-clipboard-disposed", status: "failed" };
		if (options?.signal?.aborted)
			return { code: "editor-clipboard-cancelled", status: "failed" };
		if (!runtime) {
			return { code: "editor-clipboard-unsupported", status: "failed" };
		}

		try {
			await runtime.writeText(text);
			publish("" === text ? { status: "empty" } : { status: "available" });
		} catch {
			return { code: "editor-clipboard-write-failed", status: "failed" };
		}
		if (!active || options?.signal?.aborted) {
			return {
				code: options?.signal?.aborted
					? "editor-clipboard-cancelled"
					: "editor-clipboard-disposed",
				status: "failed",
			};
		}
		publish({ status: "unknown" });
		return { status: "written" };
	};

	const writeDeferred = async (
		text: Promise<string>,
		options?: EditorClipboardOperationOptions,
	): Promise<EditorClipboardWriteResult> => {
		if (!active) return { code: "editor-clipboard-disposed", status: "failed" };
		if (options?.signal?.aborted)
			return { code: "editor-clipboard-cancelled", status: "failed" };
		if (!runtime?.writeDeferred) {
			return { code: "editor-clipboard-unsupported", status: "failed" };
		}
		let operation!: DeferredWriteOperation;
		let settled = false;
		const guardedText = new Promise<string>((resolve, reject) => {
			const finishResolve = (value: string): void => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			const finishReject = (reason: unknown): void => {
				if (settled) return;
				settled = true;
				reject(reason);
			};
			const onAbort = (): void => {
				finishReject(new Error("editor-clipboard-cancelled"));
			};
			operation = {
				cleanup: () => {
					options?.signal?.removeEventListener("abort", onAbort);
					deferredWrites.delete(operation);
				},
				reject: finishReject,
			};
			deferredWrites.add(operation);
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			void text.then(
				(value) => {
					if (!active) {
						finishReject(new Error("editor-clipboard-disposed"));
					} else if (options?.signal?.aborted) {
						finishReject(new Error("editor-clipboard-cancelled"));
					} else {
						finishResolve(value);
					}
				},
				(reason: unknown) => finishReject(reason),
			);
		});
		void guardedText.catch(() => undefined);
		try {
			await runtime.writeDeferred(guardedText);
		} catch {
			return {
				code: !active
					? "editor-clipboard-disposed"
					: options?.signal?.aborted
						? "editor-clipboard-cancelled"
						: "editor-clipboard-write-failed",
				status: "failed",
			};
		} finally {
			operation.cleanup();
		}
		if (!active || options?.signal?.aborted) {
			return {
				code: options?.signal?.aborted
					? "editor-clipboard-cancelled"
					: "editor-clipboard-disposed",
				status: "failed",
			};
		}
		publish({ status: "unknown" });
		return { status: "written" };
	};

	const writeImageDeferred = async (
		image: Promise<Blob>,
		options?: EditorClipboardImageOperationOptions,
	): Promise<EditorClipboardImageWriteResult> => {
		const sourceImage = Promise.resolve(image);
		void sourceImage.catch(() => undefined);
		if (!active) return operationFailureResult("editor-clipboard-disposed");
		if (options?.signal?.aborted)
			return operationFailureResult("editor-clipboard-cancelled");
		if (!runtime?.writeImageDeferred || !supportsPngWrite()) {
			return { code: "editor-clipboard-unsupported", status: "failed" };
		}
		const maxBytes = imageMaxBytes(options);
		if (null === maxBytes)
			return imageFailureResult("editor-clipboard-image-invalid");

		let operation!: DeferredWriteOperation;
		let payloadFailure: ImagePayloadFailureCode | null = null;
		let payloadRejection: unknown = null;
		let guardedSettled = false;
		const guardedImage = new Promise<Blob>((resolve, reject) => {
			const finishResolve = (value: Blob): void => {
				if (guardedSettled) return;
				guardedSettled = true;
				resolve(value);
			};
			const finishReject = (reason: unknown): void => {
				if (guardedSettled) return;
				guardedSettled = true;
				payloadRejection = reason;
				reject(reason);
			};
			const onAbort = (): void => {
				finishReject(new ClipboardOperationError("editor-clipboard-cancelled"));
			};
			operation = {
				cleanup: () => {
					options?.signal?.removeEventListener("abort", onAbort);
					deferredImageWrites.delete(operation);
				},
				reject: finishReject,
			};
			deferredImageWrites.add(operation);
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			void sourceImage.then(
				(value) => {
					if (!active) {
						finishReject(
							new ClipboardOperationError("editor-clipboard-disposed"),
						);
						return;
					}
					if (options?.signal?.aborted) {
						finishReject(
							new ClipboardOperationError("editor-clipboard-cancelled"),
						);
						return;
					}
					try {
						finishResolve(validateImagePayload(value, maxBytes));
					} catch (reason) {
						payloadFailure =
							imageFailureCode(reason) ?? "editor-clipboard-image-invalid";
						finishReject(reason);
					}
				},
				() => {
					payloadFailure = "editor-clipboard-image-payload-failed";
					finishReject(
						new ImagePayloadError("editor-clipboard-image-payload-failed"),
					);
				},
			);
		});
		void guardedImage.catch(() => undefined);

		let nativeFailed = false;
		let nativeFailure: unknown = null;
		try {
			// This invocation must remain before the first await so the caller's
			// click activation reaches ClipboardItem and navigator.clipboard.write.
			const writePromise = runtime.writeImageDeferred(guardedImage);
			try {
				await writePromise;
			} catch (reason) {
				nativeFailed = true;
				nativeFailure = reason;
			}
		} catch (reason) {
			operation.cleanup();
			const payloadCode = imageFailureCode(reason);
			const operationCode = operationFailureCode(reason);
			if (payloadCode) return imageFailureResult(payloadCode);
			if (operationCode) return operationFailureResult(operationCode);
			return { code: "editor-clipboard-write-failed", status: "failed" };
		}

		if (nativeFailed) {
			operation.cleanup();
			const payloadCode = payloadFailure ?? imageFailureCode(nativeFailure);
			if (payloadCode) return imageFailureResult(payloadCode);
			if (!active) return operationFailureResult("editor-clipboard-disposed");
			if (options?.signal?.aborted)
				return operationFailureResult("editor-clipboard-cancelled");
			return { code: "editor-clipboard-write-failed", status: "failed" };
		}

		try {
			await guardedImage;
		} catch (reason) {
			payloadRejection = reason;
		}
		operation.cleanup();
		if (!active) return operationFailureResult("editor-clipboard-disposed");
		if (options?.signal?.aborted)
			return operationFailureResult("editor-clipboard-cancelled");
		const payloadCode = payloadFailure ?? imageFailureCode(payloadRejection);
		if (payloadCode) return imageFailureResult(payloadCode);
		const operationCode = operationFailureCode(payloadRejection);
		if (operationCode) return operationFailureResult(operationCode);
		if (payloadRejection)
			return imageFailureResult("editor-clipboard-image-payload-failed");
		publish({ status: "unknown" });
		return { status: "written" };
	};

	const writeRichDeferred = async (
		payload: Promise<EditorClipboardRichPayload>,
		options?: EditorClipboardRichOperationOptions,
	): Promise<EditorClipboardRichWriteResult> => {
		const sourcePayload = Promise.resolve(payload);
		void sourcePayload.catch(() => undefined);
		if (!active) return richOperationFailureResult("editor-clipboard-disposed");
		if (options?.signal?.aborted)
			return richOperationFailureResult("editor-clipboard-cancelled");
		if (!runtime?.writeRichDeferred || !supportsRichWrite()) {
			return { code: "editor-clipboard-unsupported", status: "failed" };
		}
		const maxBytes = richMaxBytes(options);
		if (null === maxBytes)
			return richFailureResult("editor-clipboard-rich-payload-invalid");

		let operation!: DeferredWriteOperation;
		let payloadFailure: RichPayloadFailureCode | null = null;
		let payloadRejection: unknown = null;
		let guardedSettled = false;
		const guardedPayload = new Promise<EditorClipboardRichPayload>(
			(resolve, reject) => {
				const finishResolve = (value: EditorClipboardRichPayload): void => {
					if (guardedSettled) return;
					guardedSettled = true;
					resolve(value);
				};
				const finishReject = (reason: unknown): void => {
					if (guardedSettled) return;
					guardedSettled = true;
					payloadRejection = reason;
					reject(reason);
				};
				const onAbort = (): void => {
					finishReject(
						new ClipboardOperationError("editor-clipboard-cancelled"),
					);
				};
				operation = {
					cleanup: () => {
						options?.signal?.removeEventListener("abort", onAbort);
						deferredRichWrites.delete(operation);
					},
					reject: finishReject,
				};
				deferredRichWrites.add(operation);
				options?.signal?.addEventListener("abort", onAbort, { once: true });
				void sourcePayload.then(
					(value) => {
						if (!active) {
							finishReject(
								new ClipboardOperationError("editor-clipboard-disposed"),
							);
							return;
						}
						if (options?.signal?.aborted) {
							finishReject(
								new ClipboardOperationError("editor-clipboard-cancelled"),
							);
							return;
						}
						try {
							finishResolve(validateRichPayload(value, maxBytes));
						} catch (reason) {
							payloadFailure =
								richFailureCode(reason) ??
								"editor-clipboard-rich-payload-invalid";
							finishReject(reason);
						}
					},
					() => {
						payloadFailure = "editor-clipboard-rich-payload-failed";
						const reason = new RichPayloadError(
							"editor-clipboard-rich-payload-failed",
						);
						finishReject(reason);
					},
				);
			},
		);
		void guardedPayload.catch(() => undefined);

		let nativeFailed = false;
		let nativeFailure: unknown = null;
		try {
			// This invocation must remain before the first await so the caller's click activation reaches ClipboardItem.
			const writePromise = runtime.writeRichDeferred(guardedPayload);
			try {
				await writePromise;
			} catch (reason) {
				nativeFailed = true;
				nativeFailure = reason;
			}
		} catch (reason) {
			operation.cleanup();
			const payloadCode = payloadFailure ?? richFailureCode(reason);
			const operationCode = operationFailureCode(reason);
			if (payloadCode) return richFailureResult(payloadCode);
			if (operationCode) return richOperationFailureResult(operationCode);
			return { code: "editor-clipboard-write-failed", status: "failed" };
		}

		if (nativeFailed) {
			operation.cleanup();
			const payloadCode = payloadFailure ?? richFailureCode(nativeFailure);
			if (payloadCode) return richFailureResult(payloadCode);
			if (!active)
				return richOperationFailureResult("editor-clipboard-disposed");
			if (options?.signal?.aborted)
				return richOperationFailureResult("editor-clipboard-cancelled");
			return { code: "editor-clipboard-write-failed", status: "failed" };
		}

		try {
			await guardedPayload;
		} catch (reason) {
			payloadRejection = reason;
		}
		operation.cleanup();
		if (!active) return richOperationFailureResult("editor-clipboard-disposed");
		if (options?.signal?.aborted)
			return richOperationFailureResult("editor-clipboard-cancelled");
		const payloadCode = payloadFailure ?? richFailureCode(payloadRejection);
		if (payloadCode) return richFailureResult(payloadCode);
		const operationCode = operationFailureCode(payloadRejection);
		if (operationCode) return richOperationFailureResult(operationCode);
		if (payloadRejection)
			return richFailureResult("editor-clipboard-rich-payload-failed");
		publish({ status: "unknown" });
		return { status: "written" };
	};

	return {
		check: read,
		dispose() {
			if (!active) return;
			active = false;
			for (const operation of deferredWrites) {
				operation.reject(new Error("editor-clipboard-disposed"));
			}
			for (const operation of Array.from(deferredImageWrites)) {
				operation.reject(
					new ClipboardOperationError("editor-clipboard-disposed"),
				);
				operation.cleanup();
			}
			for (const operation of Array.from(deferredRichWrites)) {
				operation.reject(
					new ClipboardOperationError("editor-clipboard-disposed"),
				);
				operation.cleanup();
			}
			pendingRead = null;
			listeners.clear();
			state = { code: "editor-clipboard-unsupported", status: "unavailable" };
		},
		getState: () => state,
		read,
		subscribe(listener) {
			if (!active) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		supportsPngWrite,
		supportsRichWrite,
		write,
		...(runtime?.writeDeferred ? { writeDeferred } : {}),
		...(runtime?.writeImageDeferred ? { writeImageDeferred } : {}),
		...(runtime?.writeRichDeferred ? { writeRichDeferred } : {}),
	};
}
