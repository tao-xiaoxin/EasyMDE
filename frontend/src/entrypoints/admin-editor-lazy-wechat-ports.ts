import type {
	WechatClipboardCopyOptions,
	WechatClipboardPort,
	WechatClipboardResult,
} from "../contracts/ports/wechat-clipboard-port";
import {
	WechatVisualRasterizationError,
	type WechatVisualRasterizationPort,
} from "../contracts/ports/wechat-visual-rasterization-port";
import type {
	BrowserWechatClipboardPort,
	BrowserWechatClipboardRuntime,
	PrestartedModernClipboardWrite,
} from "../integrations/browser/wechat/create-browser-wechat-clipboard";
import type { BrowserWechatVisualRasterizerRuntime } from "../integrations/browser/wechat/create-browser-wechat-visual-rasterizer";
import { rememberPreviewWidthValue } from "../integrations/browser/wechat/wechat-preview-width-store";

export type WechatClipboardModule = Readonly<{
	createBrowserWechatClipboard: (
		runtime: BrowserWechatClipboardRuntime,
	) => BrowserWechatClipboardPort;
}>;

export type WechatVisualRasterizerModule = Readonly<{
	createBrowserWechatVisualRasterizer: (
		runtime: BrowserWechatVisualRasterizerRuntime,
	) => WechatVisualRasterizationPort;
}>;

function wechatBackgroundPreparationAbortError(): Error {
	const error = new Error("wechat-background-preparation-cancelled");
	error.name = "AbortError";
	return error;
}

function raceWithAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
	createAbortError: () => Error,
): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		void promise.catch(() => undefined);
		return Promise.reject(createAbortError());
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			reject(createAbortError());
		};
		const cleanup = () => {
			signal.removeEventListener("abort", onAbort);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		void promise.then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error: unknown) => {
				cleanup();
				reject(error);
			},
		);
	});
}

const WECHAT_CLIPBOARD_CHUNK_LOAD_TIMEOUT_MS = 60_000;
const COLD_COPY_REFRESH_ONLY_ATTRIBUTES: readonly string[] = [
	"aria-busy",
	"data-easymde-preview-accepted",
	"data-easymde-preview-refreshing",
];

type ColdCopySnapshot = Readonly<{
	checkboxes: string;
	innerHtml: string;
	rootOuterHtml: string;
}>;

type ColdCopyFreshnessGuard = Readonly<{
	dispose: () => void;
	isCurrent: () => boolean;
	onStale: (listener: () => void) => () => void;
}>;

function coldPreviewReady(preview: HTMLElement): boolean {
	if (!preview.isConnected) return false;
	const refreshing =
		"1" === preview.getAttribute("data-easymde-preview-refreshing") ||
		"true" === preview.getAttribute("aria-busy");
	const acceptedDuringRefresh =
		refreshing &&
		"1" === preview.getAttribute("data-easymde-preview-accepted") &&
		!preview.querySelector("[data-easymde-preview-window-spacer]");
	return (
		(Boolean(preview.firstElementChild) || "" !== preview.innerHTML.trim()) &&
		!preview.querySelector(
			".easymde-preview-empty, .easymde-preview-error, .easymde-render-error",
		) &&
		"1" !== preview.getAttribute("data-easymde-preview-error") &&
		(!refreshing || acceptedDuringRefresh)
	);
}

function hasValidPngCopyOptions(options: WechatClipboardCopyOptions): boolean {
	return Boolean(
		options.visualRasterizationPort &&
			options.imageUploadPort &&
			Number.isSafeInteger(options.postId) &&
			(options.postId as number) >= 0 &&
			Number.isSafeInteger(options.maxBytes) &&
			(options.maxBytes as number) >= 1,
	);
}

function snapshotColdCopyState(preview: HTMLElement): ColdCopySnapshot {
	const rootClone = preview.cloneNode(false) as HTMLElement;
	for (const attribute of COLD_COPY_REFRESH_ONLY_ATTRIBUTES) {
		rootClone.removeAttribute(attribute);
	}
	const checkboxes = Array.from(preview.querySelectorAll("input"))
		.map((input) => ((input as HTMLInputElement).checked ? "1" : "0"))
		.join(",");
	return {
		checkboxes,
		innerHtml: preview.innerHTML,
		rootOuterHtml: rootClone.outerHTML,
	};
}

function coldCopySnapshotsEqual(
	a: ColdCopySnapshot,
	b: ColdCopySnapshot,
): boolean {
	return (
		a.innerHtml === b.innerHtml &&
		a.rootOuterHtml === b.rootOuterHtml &&
		a.checkboxes === b.checkboxes
	);
}

function createColdCopyFreshnessGuard(
	preview: HTMLElement,
): ColdCopyFreshnessGuard {
	const MutationObserverConstructor =
		preview.ownerDocument.defaultView?.MutationObserver ??
		globalThis.MutationObserver;
	if ("function" !== typeof MutationObserverConstructor) {
		throw new Error("wechat-copy-freshness-observer-unavailable");
	}
	let disposed = false;
	let mutatedDuringChunkLoad = false;
	let staleListener: (() => void) | null = null;
	let initial: ColdCopySnapshot | null = null;

	const markMutated = (): void => {
		if (mutatedDuringChunkLoad) return;
		mutatedDuringChunkLoad = true;
		const listener = staleListener;
		staleListener = null;
		listener?.();
	};

	const evaluateCurrentness = (): boolean => {
		if (mutatedDuringChunkLoad) return false;
		if (!preview.isConnected) {
			markMutated();
			return false;
		}
		if (null === initial) return true;
		if (!coldCopySnapshotsEqual(snapshotColdCopyState(preview), initial)) {
			markMutated();
			return false;
		}
		return true;
	};

	const recordMutations = (records: readonly MutationRecord[]): void => {
		if (mutatedDuringChunkLoad || disposed) return;
		const hasMeaningful = records.some(
			(record) =>
				!(
					"attributes" === record.type &&
					record.target === preview &&
					"string" === typeof record.attributeName &&
					COLD_COPY_REFRESH_ONLY_ATTRIBUTES.includes(record.attributeName)
				),
		);
		if (hasMeaningful) {
			evaluateCurrentness();
		}
	};

	const observer = new MutationObserverConstructor(recordMutations);
	try {
		observer.observe(preview, {
			attributes: true,
			characterData: true,
			childList: true,
			subtree: true,
		});
		initial = snapshotColdCopyState(preview);
		recordMutations(observer.takeRecords());
	} catch (error: unknown) {
		observer.disconnect();
		throw error;
	}

	return {
		dispose(): void {
			if (disposed) return;
			disposed = true;
			staleListener = null;
			observer.disconnect();
		},
		isCurrent(): boolean {
			if (!disposed) recordMutations(observer.takeRecords());
			if (mutatedDuringChunkLoad) return false;
			return evaluateCurrentness();
		},
		onStale(listener): () => void {
			if (mutatedDuringChunkLoad) {
				listener();
				return () => undefined;
			}
			if (disposed) return () => undefined;
			staleListener = listener;
			return () => {
				if (staleListener === listener) staleListener = null;
			};
		},
	};
}

function createLazyPortLoader<TModule, TPort>(
	loadModule: () => Promise<TModule>,
	createPort: (loaded: TModule) => TPort,
): Readonly<{
	current: () => TPort | null;
	load: () => Promise<TPort>;
}> {
	let resolvedPort: TPort | null = null;
	let portPromise: Promise<TPort> | null = null;
	return {
		current: () => resolvedPort,
		load(): Promise<TPort> {
			if (resolvedPort) return Promise.resolve(resolvedPort);
			if (!portPromise) {
				let modulePromise: Promise<TModule>;
				try {
					modulePromise = loadModule();
				} catch (error: unknown) {
					return Promise.reject(error);
				}
				const pending = Promise.resolve(modulePromise)
					.then((loaded) => {
						const port = createPort(loaded);
						resolvedPort = port;
						return port;
					})
					.catch((error: unknown) => {
						if (portPromise === pending) portPromise = null;
						throw error;
					});
				portPromise = pending;
			}
			return portPromise;
		},
	};
}

type ModernBrowserWechatClipboardRuntime = BrowserWechatClipboardRuntime &
	Readonly<{
		clipboardItem: NonNullable<BrowserWechatClipboardRuntime["clipboardItem"]>;
		write: NonNullable<BrowserWechatClipboardRuntime["write"]>;
	}>;

type ColdWechatChunkWaitResult =
	| Readonly<{ kind: "loaded"; port: BrowserWechatClipboardPort }>
	| Readonly<{ kind: "aborted" }>
	| Readonly<{ kind: "stale" }>
	| Readonly<{ kind: "timeout" }>
	| Readonly<{ kind: "write-failed"; error: unknown }>
	| Readonly<{ kind: "load-failed"; error: unknown }>;

function createPrestartedModernClipboardWrite(
	runtime: ModernBrowserWechatClipboardRuntime,
	options: Readonly<{
		coldFreshness: ColdCopyFreshnessGuard | null;
		deadlineMs: number;
	}>,
): PrestartedModernClipboardWrite {
	let settled = false;
	let resolveHtml!: (blob: Blob) => void;
	let rejectHtml!: (error: unknown) => void;
	let resolveText!: (blob: Blob) => void;
	let rejectText!: (error: unknown) => void;
	const htmlBlob = new Promise<Blob>((resolve, reject) => {
		resolveHtml = resolve;
		rejectHtml = reject;
	});
	const textBlob = new Promise<Blob>((resolve, reject) => {
		resolveText = resolve;
		rejectText = reject;
	});
	void htmlBlob.catch(() => undefined);
	void textBlob.catch(() => undefined);

	const rejectBoth = (error: unknown): void => {
		if (settled) return;
		settled = true;
		rejectHtml(error);
		rejectText(error);
	};

	let writePromise: Promise<void>;
	try {
		const item = new runtime.clipboardItem({
			// Start the modern Clipboard write synchronously in the click task so
			// transient user activation survives a cold dynamic chunk import.
			"text/html": htmlBlob,
			"text/plain": textBlob,
		});
		writePromise = Promise.resolve(runtime.write([item]));
	} catch (error: unknown) {
		rejectBoth(error);
		throw error;
	}
	void writePromise.catch(() => undefined);

	const coldFreshness = options.coldFreshness;
	return {
		bind(sourceHtmlBlob, sourceTextBlob): void {
			if (settled) {
				void sourceHtmlBlob.catch(() => undefined);
				void sourceTextBlob.catch(() => undefined);
				return;
			}
			settled = true;
			void sourceHtmlBlob.then(resolveHtml, rejectHtml);
			void sourceTextBlob.then(resolveText, rejectText);
		},
		deadlineMs: options.deadlineMs,
		...(coldFreshness
			? {
					disposeColdSourceFreshness: coldFreshness.dispose,
					isColdSourceFresh: coldFreshness.isCurrent,
				}
			: {}),
		reject: rejectBoth,
		writePromise,
	};
}

function waitForWechatClipboardChunk(
	portPromise: Promise<BrowserWechatClipboardPort>,
	writePromise: Promise<void>,
	signal: AbortSignal | undefined,
	timeoutMs: number,
	coldFreshness: ColdCopyFreshnessGuard | null,
): Promise<ColdWechatChunkWaitResult> {
	void portPromise.catch(() => undefined);
	void writePromise.catch(() => undefined);
	if (signal?.aborted) return Promise.resolve({ kind: "aborted" });
	return new Promise<ColdWechatChunkWaitResult>((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let unsubscribeStale: (() => void) | null = null;
		const onAbort = (): void => finish({ kind: "aborted" });
		const finish = (result: ColdWechatChunkWaitResult): void => {
			if (settled) return;
			settled = true;
			if (null !== timer) {
				clearTimeout(timer);
				timer = null;
			}
			unsubscribeStale?.();
			unsubscribeStale = null;
			signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		if (coldFreshness) {
			unsubscribeStale = coldFreshness.onStale(() => finish({ kind: "stale" }));
		}
		if (settled) return;
		timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
		void portPromise.then(
			(port) => finish({ kind: "loaded", port }),
			(error: unknown) => finish({ kind: "load-failed", error }),
		);
		void writePromise.then(
			() => undefined,
			(error: unknown) => finish({ kind: "write-failed", error }),
		);
	});
}

export function createLazyBrowserWechatClipboard(
	runtime: BrowserWechatClipboardRuntime,
	isActive: () => boolean,
	loadWechatClipboard: () => Promise<WechatClipboardModule> = () =>
		import("../integrations/browser/wechat/create-browser-wechat-clipboard"),
): WechatClipboardPort {
	const loader = createLazyPortLoader(
		loadWechatClipboard,
		({ createBrowserWechatClipboard }) => createBrowserWechatClipboard(runtime),
	);

	return {
		rememberPreviewWidth(preview): void {
			if (!isActive()) return;
			rememberPreviewWidthValue(preview);
			loader.current()?.rememberPreviewWidth?.(preview);
		},
		releasePrepared(preview): void {
			loader.current()?.releasePrepared?.(preview);
		},
		prepare(preview, options = {}): Promise<void> {
			if (!isActive()) return Promise.resolve();
			if (options.signal?.aborted) {
				return Promise.reject(wechatBackgroundPreparationAbortError());
			}
			const resolvedPort = loader.current();
			if (resolvedPort) {
				return resolvedPort.prepare
					? resolvedPort.prepare(preview, options)
					: Promise.resolve();
			}
			return raceWithAbort(
				loader.load(),
				options.signal,
				wechatBackgroundPreparationAbortError,
			).then((port) => {
				if (!isActive()) return undefined;
				if (options.signal?.aborted) {
					throw wechatBackgroundPreparationAbortError();
				}
				return port.prepare ? port.prepare(preview, options) : undefined;
			});
		},
		copy(preview, options = {}): Promise<WechatClipboardResult> {
			const png = true === options.pngConversionEnabled;
			const pngFailed = (
				code:
					| "wechat-png-clipboard-failed"
					| "wechat-png-rasterization-cancelled"
					| "wechat-png-transaction-timeout",
			): WechatClipboardResult => ({
				code,
				sideEffects: "none",
				status: "failed",
			});
			const cancelled = (): WechatClipboardResult =>
				png
					? pngFailed("wechat-png-rasterization-cancelled")
					: { code: "wechat-copy-cancelled", status: "cancelled" };
			const failure = (): WechatClipboardResult =>
				png
					? pngFailed("wechat-png-clipboard-failed")
					: { code: "wechat-copy-failed", status: "failed" };
			const stale = (): WechatClipboardResult =>
				png
					? pngFailed("wechat-png-rasterization-cancelled")
					: { code: "wechat-copy-failed", status: "failed" };
			const timeout = (): WechatClipboardResult =>
				png
					? pngFailed("wechat-png-transaction-timeout")
					: { code: "wechat-copy-failed", status: "failed" };
			const timeoutError = (): Error =>
				new Error(
					png
						? "wechat-png-transaction-timeout"
						: "wechat-clipboard-preparation-timeout",
				);

			if (options.signal?.aborted) return Promise.resolve(cancelled());
			if (!isActive()) return Promise.resolve(failure());
			const resolvedPort = loader.current();
			if (resolvedPort) return resolvedPort.copy(preview, options);
			if (options.isCurrent && !options.isCurrent()) {
				return Promise.resolve(stale());
			}
			const hiddenFormalPreview =
				Boolean(options.resolvePreview) &&
				preview.classList.contains("easymde-preview-surface-hidden");
			if (!hiddenFormalPreview && !coldPreviewReady(preview)) {
				return Promise.resolve({
					code: "wechat-preview-unavailable",
					...(png ? { sideEffects: "none" as const } : {}),
					status: "failed",
				});
			}
			if (!runtime.write || !runtime.clipboardItem) {
				if (!png) void loader.load().catch(() => undefined);
				return Promise.resolve(failure());
			}
			if (png && !hasValidPngCopyOptions(options)) {
				return Promise.resolve({
					code: "wechat-png-rasterization-failed",
					sideEffects: "none",
					status: "failed",
				});
			}

			const deadlineMs = Date.now() + WECHAT_CLIPBOARD_CHUNK_LOAD_TIMEOUT_MS;
			const requiresPreviewResolution = Boolean(
				options.resolvePreview &&
					(hiddenFormalPreview ||
						preview.querySelector("[data-easymde-preview-window-spacer]")),
			);

			let coldFreshness: ColdCopyFreshnessGuard | null = null;
			if (!requiresPreviewResolution) {
				try {
					coldFreshness = createColdCopyFreshnessGuard(preview);
				} catch {
					return Promise.resolve(failure());
				}
			}

			let prestartedWrite: PrestartedModernClipboardWrite;
			try {
				prestartedWrite = createPrestartedModernClipboardWrite(
					{
						...runtime,
						clipboardItem: runtime.clipboardItem,
						write: runtime.write,
					},
					{ coldFreshness, deadlineMs },
				);
			} catch {
				coldFreshness?.dispose();
				if (!png) void loader.load().catch(() => undefined);
				return Promise.resolve(failure());
			}

			const abortPrestarted = (
				error: unknown,
				result: WechatClipboardResult,
			): WechatClipboardResult => {
				coldFreshness?.dispose();
				prestartedWrite.reject(error);
				return result;
			};

			if (options.signal?.aborted) {
				return Promise.resolve(
					abortPrestarted(new Error("wechat-copy-cancelled"), cancelled()),
				);
			}
			if (coldFreshness && !coldFreshness.isCurrent()) {
				return Promise.resolve(
					abortPrestarted(new Error("wechat-copy-stale"), stale()),
				);
			}
			if (options.isCurrent && !options.isCurrent()) {
				return Promise.resolve(
					abortPrestarted(new Error("wechat-copy-cancelled"), stale()),
				);
			}
			if (!isActive()) {
				return Promise.resolve(
					abortPrestarted(new Error("wechat-copy-failed"), failure()),
				);
			}

			return waitForWechatClipboardChunk(
				loader.load(),
				prestartedWrite.writePromise,
				options.signal,
				Math.max(0, deadlineMs - Date.now()),
				coldFreshness,
			).then((outcome) => {
				if ("aborted" === outcome.kind || options.signal?.aborted) {
					return abortPrestarted(
						new Error("wechat-copy-cancelled"),
						cancelled(),
					);
				}
				if ("stale" === outcome.kind) {
					return abortPrestarted(new Error("wechat-copy-stale"), stale());
				}
				if ("timeout" === outcome.kind) {
					return abortPrestarted(timeoutError(), timeout());
				}
				if ("loaded" !== outcome.kind) {
					return abortPrestarted(outcome.error, failure());
				}
				if (!isActive()) {
					return abortPrestarted(new Error("wechat-copy-failed"), failure());
				}
				if (options.isCurrent && !options.isCurrent()) {
					return abortPrestarted(new Error("wechat-copy-cancelled"), stale());
				}
				if (coldFreshness && !coldFreshness.isCurrent()) {
					return abortPrestarted(new Error("wechat-copy-stale"), stale());
				}
				if (Date.now() >= deadlineMs) {
					return abortPrestarted(timeoutError(), timeout());
				}
				const port = outcome.port;
				if ("function" !== typeof port.copyWithPrestartedWrite) {
					return abortPrestarted(
						new Error("wechat-copy-prestarted-write-unsupported"),
						failure(),
					);
				}
				try {
					return port
						.copyWithPrestartedWrite(preview, options, prestartedWrite)
						.finally(() => coldFreshness?.dispose());
				} catch (error: unknown) {
					return abortPrestarted(error, failure());
				}
			});
		},
	};
}

export function createLazyBrowserWechatVisualRasterizer(
	runtime: BrowserWechatVisualRasterizerRuntime,
	isActive: () => boolean,
	loadWechatVisualRasterizer: () => Promise<WechatVisualRasterizerModule> = () =>
		import(
			"../integrations/browser/wechat/create-browser-wechat-visual-rasterizer"
		),
): WechatVisualRasterizationPort {
	const loader = createLazyPortLoader(
		loadWechatVisualRasterizer,
		({ createBrowserWechatVisualRasterizer }) =>
			createBrowserWechatVisualRasterizer(runtime),
	);
	const cancelledError = (): Error =>
		new WechatVisualRasterizationError("wechat-png-rasterization-cancelled");

	return {
		rasterize(request) {
			if (!isActive() || request.signal.aborted) {
				return Promise.reject(cancelledError());
			}
			const resolvedPort = loader.current();
			if (resolvedPort) return resolvedPort.rasterize(request);
			return raceWithAbort(loader.load(), request.signal, cancelledError).then(
				(port) => {
					if (!isActive() || request.signal.aborted) throw cancelledError();
					return port.rasterize(request);
				},
				(error: unknown) => {
					if (error instanceof WechatVisualRasterizationError) throw error;
					throw new WechatVisualRasterizationError(
						"wechat-png-rasterization-unavailable",
					);
				},
			);
		},
	};
}
