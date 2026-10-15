import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createEditorContextMenuBlockIndexCache,
	type EditorContextMenuBlockIndexBuild,
} from "./editor-context-menu-block-index-cache";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";

function index(length: number): EditorMarkdownBlockIndex {
	return {
		blocks: [],
		imageBlocks: [],
		imageRanges: [],
		length,
		mathSpans: [],
		source: "x".repeat(length),
	};
}

function request(
	owner: object,
	revision: number,
	build: EditorContextMenuBlockIndexBuild,
	onFailure = vi.fn(),
) {
	return {
		build,
		delayMs: 0,
		generation: 1,
		onFailure,
		owner,
		revision,
	};
}

describe("createEditorContextMenuBlockIndexCache", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("peeks readiness without invoking a parser", () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const build = vi.fn(() => index(4));

		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();
		expect(build).not.toHaveBeenCalled();
		cache.schedule(request(owner, 1, build));
		vi.advanceTimersByTime(0);
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();
		expect(build).toHaveBeenCalledOnce();
		cache.dispose();
	});

	it("publishes an async result only for the latest generation and revision", async () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const firstControl: {
			resolve?: (value: EditorMarkdownBlockIndex) => void;
		} = {};
		const first = new Promise<EditorMarkdownBlockIndex>((resolve) => {
			firstControl.resolve = resolve;
		});
		const firstBuild = vi.fn(() => first);
		const secondBuild = vi.fn(() => index(7));

		cache.schedule(request(owner, 1, firstBuild));
		vi.advanceTimersByTime(0);
		cache.schedule({ ...request(owner, 2, secondBuild), generation: 2 });
		vi.advanceTimersByTime(0);
		await vi.runAllTimersAsync();
		expect(cache.peek({ generation: 2, owner, revision: 2 })).toEqual(index(7));

		firstControl.resolve?.(index(6));
		await Promise.resolve();
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();
		cache.dispose();
	});

	it("invalidates without parsing on every typing notification", () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const build = vi.fn(() => index(5));

		cache.schedule(request(owner, 1, build));
		vi.advanceTimersByTime(0);
		expect(build).toHaveBeenCalledOnce();
		cache.invalidate(owner);
		expect(build).toHaveBeenCalledOnce();

		cache.schedule(request(owner, 2, build));
		vi.advanceTimersByTime(0);
		expect(build).toHaveBeenCalledTimes(2);
		cache.dispose();
	});

	it("notifies feature subscribers when readiness changes", async () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const listener = vi.fn();
		cache.subscribe(listener);

		cache.schedule(request(owner, 1, async () => index(7)));
		expect(listener).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(0);
		await Promise.resolve();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(cache.peek({ generation: 1, owner, revision: 1 })).not.toBeNull();
		cache.dispose();
	});

	it("reports a non-abort worker failure and releases references on dispose", async () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const failure = vi.fn();
		const error = new Error("worker-failed");

		cache.schedule(request(owner, 1, () => Promise.reject(error), failure));
		vi.advanceTimersByTime(0);
		await Promise.resolve();
		expect(failure).toHaveBeenCalledWith(error);
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();

		cache.dispose();
		expect(() => cache.schedule(request(owner, 1, () => index(8)))).toThrow(
			"editor-context-menu-block-index-cache-disposed",
		);
	});

	it("does not retry a failed key until its owner is invalidated", async () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const failure = new Error("worker-failed");
		const build = vi.fn(() => Promise.reject(failure));

		cache.schedule(request(owner, 1, build));
		vi.advanceTimersByTime(0);
		await Promise.resolve();
		expect(build).toHaveBeenCalledOnce();

		cache.schedule(request(owner, 1, build));
		vi.advanceTimersByTime(0);
		expect(build).toHaveBeenCalledOnce();

		cache.invalidate(owner);
		cache.schedule(request(owner, 1, build));
		vi.advanceTimersByTime(0);
		await Promise.resolve();
		expect(build).toHaveBeenCalledTimes(2);
		cache.dispose();
	});

	it("starts one overall deadline when the debounced build begins", async () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const failure = vi.fn();
		let resolveLate: ((value: EditorMarkdownBlockIndex) => void) | undefined;
		const build = vi.fn(
			(signal: AbortSignal) =>
				new Promise<EditorMarkdownBlockIndex>((resolve, reject) => {
					resolveLate = resolve;
					signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					});
				}),
		);

		cache.schedule({
			...request(owner, 1, build, failure),
			delayMs: 100,
			timeoutMs: 25,
		});
		vi.advanceTimersByTime(99);
		expect(build).not.toHaveBeenCalled();
		expect(failure).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(build).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(24);
		expect(failure).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(failure).toHaveBeenCalledOnce();
		expect(failure.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "editor-block-index-cache-timeout" }),
		);
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();
		resolveLate?.(index(9));
		await Promise.resolve();
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();

		cache.schedule({
			...request(
				owner,
				1,
				vi.fn(() => index(9)),
				failure,
			),
			delayMs: 0,
			timeoutMs: 25,
		});
		vi.advanceTimersByTime(0);
		expect(failure).toHaveBeenCalledOnce();
		cache.dispose();
	});

	it("clears the overall deadline after readiness and on cancellation", async () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const failure = vi.fn();
		const build = vi.fn(async () => index(6));

		cache.schedule({ ...request(owner, 1, build, failure), timeoutMs: 25 });
		vi.advanceTimersByTime(0);
		await Promise.resolve();
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toEqual(index(6));
		vi.advanceTimersByTime(100);
		expect(failure).not.toHaveBeenCalled();

		const controllerBuild = vi.fn(
			(signal: AbortSignal) =>
				new Promise<EditorMarkdownBlockIndex>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					});
				}),
		);
		cache.invalidate(owner);
		cache.schedule({
			...request(owner, 2, controllerBuild, failure),
			timeoutMs: 25,
		});
		vi.advanceTimersByTime(0);
		expect(controllerBuild).toHaveBeenCalledOnce();
		cache.invalidate(owner);
		vi.advanceTimersByTime(100);
		expect(failure).not.toHaveBeenCalled();
		cache.dispose();
	});

	it("rejects an invalid cache timeout without scheduling work", () => {
		vi.useFakeTimers();
		const cache = createEditorContextMenuBlockIndexCache();
		const owner = {};
		const build = vi.fn(() => index(3));

		expect(() =>
			cache.schedule({ ...request(owner, 1, build), timeoutMs: 0 }),
		).toThrow("editor-context-menu-block-index-cache-timeout-invalid");
		vi.advanceTimersByTime(1000);
		expect(build).not.toHaveBeenCalled();
		cache.dispose();
	});

	it("rechecks the original deadline before publishing a late promise", async () => {
		vi.useFakeTimers();
		let clock = 0;
		const cache = createEditorContextMenuBlockIndexCache({
			now: () => clock,
		});
		const owner = {};
		const failure = vi.fn();
		let resolveBuild: ((value: EditorMarkdownBlockIndex) => void) | undefined;
		let buildSignal: AbortSignal | undefined;
		let buildDeadline: number | undefined;
		const build = vi.fn(
			(signal: AbortSignal, context: { deadline: number }) => {
				buildSignal = signal;
				buildDeadline = context.deadline;
				return new Promise<EditorMarkdownBlockIndex>((resolve) => {
					resolveBuild = resolve;
				});
			},
		);

		cache.schedule({
			...request(owner, 1, build, failure),
			timeoutMs: 10,
		});
		vi.advanceTimersByTime(0);
		expect(build).toHaveBeenCalledOnce();
		expect(buildDeadline).toBe(10);
		clock = 11;
		resolveBuild?.(index(8));
		await Promise.resolve();
		await Promise.resolve();

		expect(failure).toHaveBeenCalledOnce();
		expect(failure.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "editor-block-index-cache-timeout" }),
		);
		expect(buildSignal?.aborted).toBe(true);
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toBeNull();
		cache.dispose();
	});

	it("publishes before the original deadline and clears its overdue timer", async () => {
		vi.useFakeTimers();
		let clock = 0;
		const cache = createEditorContextMenuBlockIndexCache({
			now: () => clock,
		});
		const owner = {};
		const failure = vi.fn();
		let resolveBuild: ((value: EditorMarkdownBlockIndex) => void) | undefined;
		const build = vi.fn(
			() =>
				new Promise<EditorMarkdownBlockIndex>((resolve) => {
					resolveBuild = resolve;
				}),
		);

		cache.schedule({
			...request(owner, 1, build, failure),
			timeoutMs: 10,
		});
		vi.advanceTimersByTime(0);
		clock = 9;
		resolveBuild?.(index(8));
		await Promise.resolve();
		await Promise.resolve();
		expect(cache.peek({ generation: 1, owner, revision: 1 })).toEqual(index(8));
		clock = 11;
		vi.advanceTimersByTime(10);
		expect(failure).not.toHaveBeenCalled();
		cache.dispose();
	});
});
