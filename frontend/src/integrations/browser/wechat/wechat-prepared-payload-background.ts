import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	backgroundPreparationAbortError,
} from "./wechat-clipboard-runtime";
import type { WechatMathVectorAtlasLoader } from "./wechat-math-vector-portable";
import { preparedClipboardPayload } from "./wechat-prepared-payload-builder";
import type {
	BackgroundPreparationCache,
	BackgroundPreparationState,
	BackgroundPreparationWaiter,
	PreparedClipboardPayloadCache,
} from "./wechat-prepared-payload-state";

export const BACKGROUND_PREPARATION_QUIET_DELAY_MS = 120;

export function scheduleBackgroundPreparation(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	backgroundPreparations: BackgroundPreparationCache,
	nextSequence: () => number,
	state: BackgroundPreparationState,
	delay: number,
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
): void {
	if (state.timer !== null) return;
	const browserWindow = runtime.document.defaultView;
	state.timer = browserWindow
		? browserWindow.setTimeout(run, delay)
		: setTimeout(run, delay);

	function run(): void {
		state.timer = null;
		if (state.active || !state.requested) return;
		state.requested = false;

		const controller = new AbortController();
		state.activeController = controller;
		let operation: Promise<void>;
		try {
			operation = preparedClipboardPayload(
				preview,
				runtime,
				backgroundAssetCache,
				preparedPayloads,
				nextSequence,
				true,
				true,
				controller.signal,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				() => {
					if (state.activeController === controller) controller.abort();
				},
				undefined,
				mathVectorAtlasLoader,
			).promise.then(() => undefined);
		} catch (error: unknown) {
			operation = Promise.reject(error);
		}

		state.active = operation;
		operation.then(
			() => finish(operation, true),
			(error: unknown) => finish(operation, false, error),
		);
	}

	function finish(
		operation: Promise<void>,
		success: boolean,
		error?: unknown,
	): void {
		if (state.active !== operation) return;
		state.active = null;
		state.activeController = null;
		if (backgroundPreparations.get(preview) !== state) return;
		if (state.requested) {
			scheduleBackgroundPreparation(
				preview,
				runtime,
				backgroundAssetCache,
				preparedPayloads,
				backgroundPreparations,
				nextSequence,
				state,
				BACKGROUND_PREPARATION_QUIET_DELAY_MS,
				mathVectorAtlasLoader,
			);
			return;
		}

		const waiters = state.waiters.splice(0);
		waiters.forEach((waiter) => {
			waiter.signal?.removeEventListener(
				"abort",
				waiter.onAbort as EventListener,
			);
			if (success) waiter.resolve();
			else waiter.reject(error);
		});
		if (!state.active && !state.requested && state.waiters.length === 0) {
			if (backgroundPreparations.get(preview) === state) {
				backgroundPreparations.delete(preview);
			}
		}
	}
}

export function cancelBackgroundPreparationIfUnused(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundPreparations: BackgroundPreparationCache,
	state: BackgroundPreparationState,
): void {
	if (state.waiters.length > 0) return;
	state.requested = false;
	if (state.timer !== null) {
		const browserWindow = runtime.document.defaultView;
		if (browserWindow) browserWindow.clearTimeout(state.timer as number);
		else clearTimeout(state.timer);
		state.timer = null;
	}
	state.activeController?.abort();
	if (!state.active && backgroundPreparations.get(preview) === state) {
		backgroundPreparations.delete(preview);
	}
}

export function removeBackgroundPreparationWaiter(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundPreparations: BackgroundPreparationCache,
	state: BackgroundPreparationState,
	waiter: BackgroundPreparationWaiter,
): void {
	const index = state.waiters.indexOf(waiter);
	if (index < 0) return;
	state.waiters.splice(index, 1);
	waiter.signal?.removeEventListener("abort", waiter.onAbort as EventListener);
	waiter.reject(backgroundPreparationAbortError());
	cancelBackgroundPreparationIfUnused(
		preview,
		runtime,
		backgroundPreparations,
		state,
	);
}

export function coalescedBackgroundPreparation(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	backgroundAssetCache: BackgroundAssetCache,
	preparedPayloads: PreparedClipboardPayloadCache,
	backgroundPreparations: BackgroundPreparationCache,
	nextSequence: () => number,
	signal?: AbortSignal,
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined = undefined,
): Promise<void> {
	if (signal?.aborted) return Promise.reject(backgroundPreparationAbortError());
	let state = backgroundPreparations.get(preview);
	if (!state) {
		state = {
			active: null,
			activeController: null,
			requested: false,
			timer: null,
			waiters: [],
		};
		backgroundPreparations.set(preview, state);
	}
	state.requested = true;
	let waiter!: BackgroundPreparationWaiter;
	const promise = new Promise<void>((resolve, reject) => {
		waiter = signal ? { reject, resolve, signal } : { reject, resolve };
		state?.waiters.push(waiter);
	});
	if (signal) {
		const onAbort = () =>
			removeBackgroundPreparationWaiter(
				preview,
				runtime,
				backgroundPreparations,
				state as BackgroundPreparationState,
				waiter,
			);
		waiter.onAbort = onAbort;
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
	}
	if (state.requested && !state.active && state.timer === null) {
		scheduleBackgroundPreparation(
			preview,
			runtime,
			backgroundAssetCache,
			preparedPayloads,
			backgroundPreparations,
			nextSequence,
			state,
			0,
			mathVectorAtlasLoader,
		);
	}
	return promise;
}
