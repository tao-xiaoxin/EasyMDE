import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";

export type EditorContextMenuBlockIndexRevision = number | string;
export type EditorContextMenuBlockIndexGeneration = number | string;

export type EditorContextMenuBlockIndexBuildContext = Readonly<{
	deadline: number;
}>;

export type EditorContextMenuBlockIndexBuild = (
	signal: AbortSignal,
	context: EditorContextMenuBlockIndexBuildContext,
) => EditorMarkdownBlockIndex | Promise<EditorMarkdownBlockIndex>;

export type EditorContextMenuBlockIndexCacheOptions = Readonly<{
	now?: () => number;
}>;

export type EditorContextMenuBlockIndexCache = Readonly<{
	invalidate: (owner: object) => void;
	peek: (
		input: Readonly<{
			generation: EditorContextMenuBlockIndexGeneration;
			owner: object;
			revision: EditorContextMenuBlockIndexRevision;
		}>,
	) => EditorMarkdownBlockIndex | null;
	schedule: (
		input: Readonly<{
			build: EditorContextMenuBlockIndexBuild;
			delayMs?: number;
			generation: EditorContextMenuBlockIndexGeneration;
			onFailure: (error: unknown) => void;
			owner: object;
			revision: EditorContextMenuBlockIndexRevision;
			timeoutMs?: number;
		}>,
	) => boolean;
	subscribe: (listener: () => void) => () => void;
	dispose: () => void;
}>;

type CacheEntry = Readonly<{
	generation: EditorContextMenuBlockIndexGeneration;
	index: EditorMarkdownBlockIndex;
	owner: object;
	revision: EditorContextMenuBlockIndexRevision;
}>;

type CacheKey = Readonly<{
	generation: EditorContextMenuBlockIndexGeneration;
	owner: object;
	revision: EditorContextMenuBlockIndexRevision;
}>;

type FailedCacheKey = CacheKey & Readonly<{ retryAvailable: boolean }>;

type PendingBuild = {
	build: EditorContextMenuBlockIndexBuild;
	controller: AbortController;
	deadlineTimer: ReturnType<typeof setTimeout> | null;
	expiresAt: number | null;
	generation: EditorContextMenuBlockIndexGeneration;
	onFailure: (error: unknown) => void;
	owner: object;
	revision: EditorContextMenuBlockIndexRevision;
	timeoutMs: number;
};

const DEFAULT_INDEX_BUILD_DEBOUNCE_MS = 120;
const DEFAULT_INDEX_BUILD_TIMEOUT_MS = 10_000;
const CACHE_TIMEOUT_CODE = "editor-block-index-cache-timeout";
const CACHE_TIMEOUT_INVALID_CODE =
	"editor-context-menu-block-index-cache-timeout-invalid";
const MAX_SAME_KEY_RETRIES = 1;

function defaultNow(): number {
	return "function" === typeof globalThis.performance?.now
		? globalThis.performance.now()
		: Date.now();
}

function sameKey(
	left: Readonly<{
		generation: EditorContextMenuBlockIndexGeneration;
		owner: object;
		revision: EditorContextMenuBlockIndexRevision;
	}>,
	right: Readonly<{
		generation: EditorContextMenuBlockIndexGeneration;
		owner: object;
		revision: EditorContextMenuBlockIndexRevision;
	}>,
): boolean {
	return (
		left.owner === right.owner &&
		Object.is(left.generation, right.generation) &&
		Object.is(left.revision, right.revision)
	);
}

export function createEditorContextMenuBlockIndexCache(
	options: EditorContextMenuBlockIndexCacheOptions = {},
): EditorContextMenuBlockIndexCache {
	const now = options.now ?? defaultNow;
	let disposed = false;
	let entry: CacheEntry | null = null;
	let failed: FailedCacheKey | null = null;
	let pending: PendingBuild | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const listeners = new Set<() => void>();

	const clearTimer = (): void => {
		if (null === timer) return;
		clearTimeout(timer);
		timer = null;
	};

	const clearDeadline = (request: PendingBuild | null): void => {
		if (!request || null === request.deadlineTimer) return;
		clearTimeout(request.deadlineTimer);
		request.deadlineTimer = null;
	};

	const isExpired = (request: PendingBuild): boolean =>
		null !== request.expiresAt && now() >= request.expiresAt;

	const cancelPending = (): void => {
		clearDeadline(pending);
		pending?.controller.abort();
		pending = null;
		clearTimer();
	};

	const assertActive = (): void => {
		if (disposed)
			throw new Error("editor-context-menu-block-index-cache-disposed");
	};

	const notify = (): void => {
		for (const listener of listeners) listener();
	};

	const failPending = (request: PendingBuild, error: Error): void => {
		if (pending !== request) return;
		clearDeadline(request);
		pending = null;
		const retriedSameKey = failed && sameKey(request, failed);
		failed = {
			generation: request.generation,
			owner: request.owner,
			revision: request.revision,
			retryAvailable: !retriedSameKey && MAX_SAME_KEY_RETRIES > 0,
		};
		notify();
		request.onFailure(error);
	};

	const timeoutPending = (request: PendingBuild): void => {
		if (pending !== request) return;
		if (!isExpired(request)) {
			request.deadlineTimer = setTimeout(
				() => timeoutPending(request),
				Math.max(0, (request.expiresAt ?? now()) - now()),
			);
			return;
		}
		request.controller.abort();
		failPending(request, new Error(CACHE_TIMEOUT_CODE));
	};

	const peek = ({
		generation,
		owner,
		revision,
	}: Parameters<
		EditorContextMenuBlockIndexCache["peek"]
	>[0]): EditorMarkdownBlockIndex | null => {
		if (disposed || !entry) return null;
		return sameKey({ generation, owner, revision }, entry) ? entry.index : null;
	};

	const schedule = ({
		build,
		delayMs = DEFAULT_INDEX_BUILD_DEBOUNCE_MS,
		generation,
		onFailure,
		owner,
		revision,
		timeoutMs = DEFAULT_INDEX_BUILD_TIMEOUT_MS,
	}: Parameters<EditorContextMenuBlockIndexCache["schedule"]>[0]): boolean => {
		assertActive();
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
			throw new Error(CACHE_TIMEOUT_INVALID_CODE);
		}
		const key: CacheKey = { generation, owner, revision };
		if (peek(key)) {
			return true;
		}
		if (pending && sameKey(key, pending)) {
			return true;
		}
		if (failed && sameKey(key, failed)) {
			if (!failed.retryAvailable) return false;
			// Permit one recovery attempt for the key that just failed. The
			// consumed marker remains until this attempt succeeds or the owner
			// is invalidated, so repeated readiness renders cannot retry forever.
			failed = { ...failed, retryAvailable: false };
		} else {
			failed = null;
		}
		cancelPending();
		const controller = new AbortController();
		const request: PendingBuild = {
			build,
			controller,
			deadlineTimer: null,
			expiresAt: null,
			generation,
			onFailure,
			owner,
			revision,
			timeoutMs,
		};
		pending = request;
		notify();
		timer = setTimeout(() => {
			timer = null;
			if (pending !== request || disposed) return;
			request.expiresAt = now() + request.timeoutMs;
			request.deadlineTimer = setTimeout(
				() => timeoutPending(request),
				request.timeoutMs,
			);
			void (async () => {
				let index: EditorMarkdownBlockIndex;
				try {
					index = await request.build(request.controller.signal, {
						deadline: request.expiresAt ?? now(),
					});
				} catch (error) {
					if (isExpired(request)) {
						timeoutPending(request);
						return;
					}
					if (
						disposed ||
						pending !== request ||
						request.controller.signal.aborted
					)
						return;
					failPending(
						request,
						error instanceof Error
							? error
							: new Error("editor-context-menu-block-index-build-failed"),
					);
					return;
				}
				if (
					disposed ||
					pending !== request ||
					request.controller.signal.aborted
				)
					return;
				if (isExpired(request)) {
					timeoutPending(request);
					return;
				}
				clearDeadline(request);
				pending = null;
				entry = {
					generation: request.generation,
					index,
					owner: request.owner,
					revision: request.revision,
				};
				failed = null;
				notify();
			})();
		}, delayMs);
		return true;
	};

	return {
		invalidate(owner) {
			assertActive();
			const changed =
				entry?.owner === owner ||
				pending?.owner === owner ||
				failed?.owner === owner;
			if (entry?.owner === owner) entry = null;
			if (pending?.owner === owner) cancelPending();
			if (failed?.owner === owner) failed = null;
			if (changed) notify();
		},
		peek,
		schedule,
		subscribe(listener) {
			assertActive();
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelPending();
			entry = null;
			failed = null;
			listeners.clear();
		},
	};
}
