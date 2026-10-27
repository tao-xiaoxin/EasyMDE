import katex from "katex";
import { describe, expect, it, vi } from "vitest";

import type { EditorClipboardPort } from "../../contracts/ports/editor-clipboard-port";
import type { WechatVisualRasterizationPort } from "../../contracts/ports/wechat-visual-rasterization-port";
import {
	createGeneratedContentExportSession,
	type GeneratedContentExportIdentity,
	type GeneratedContentExportResult,
} from "./generated-content-export-session";
import {
	associateGeneratedContentTarget,
	type GeneratedContentTarget,
} from "./generated-content-target";

function deferred<T>(): {
	promise: Promise<T>;
	reject: (reason?: unknown) => void;
	resolve: (value: T) => void;
} {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function mathTarget(source = "$x$"): GeneratedContentTarget {
	const delimiterLength =
		source.startsWith("$$") || source.startsWith("\\[") ? 2 : 1;
	const result = associateGeneratedContentTarget({
		acceptedPreview: { revision: 1, signature: "preview-1" },
		blockId: "block-0",
		kind: "math",
		mathSpans: [
			{
				bodyFrom: delimiterLength,
				bodyTo: source.length - delimiterLength,
				displayMode: 2 === delimiterLength,
				from: 0,
				to: source.length,
			},
		],
		ordinal: 0,
		source,
		sourceRevision: 1,
	});
	if (result.status !== "associated") throw new Error(result.code);
	return result.target;
}

function mermaidTarget(
	source = "```mermaid\nA-->B\n```",
): GeneratedContentTarget {
	const result = associateGeneratedContentTarget({
		acceptedPreview: { revision: 1, signature: "preview-1" },
		blockId: "block-0",
		kind: "mermaid",
		ordinal: 0,
		original: {
			body: "A-->B",
			bodyRange: {
				from: source.indexOf("A-->B"),
				to: source.indexOf("A-->B") + 5,
			},
			full: source,
			fullRange: { from: 0, to: source.length },
		},
		source,
		sourceRevision: 1,
	});
	if (result.status !== "associated") throw new Error(result.code);
	return result.target;
}

function identity(
	target: GeneratedContentTarget,
	mode: "ordinary" | "immersive" = "ordinary",
): GeneratedContentExportIdentity {
	return {
		acceptedPreview: target.acceptedPreview,
		mode,
		sourceRevision: target.sourceRevision,
	};
}

function validatedLease(
	target: GeneratedContentTarget,
	root: HTMLElement,
): Readonly<{
	lease: {
		root: HTMLElement;
		target: GeneratedContentTarget;
	};
	validateLease: (
		lease: { root: Element; target: GeneratedContentTarget },
		current: GeneratedContentExportIdentity,
	) => boolean;
}> {
	if (!root.isConnected) document.body.append(root);
	return {
		lease: { root, target },
		validateLease: (candidate, current) =>
			candidate.root === root &&
			candidate.target === target &&
			current.sourceRevision === target.sourceRevision &&
			current.acceptedPreview.revision === target.acceptedPreview.revision &&
			current.acceptedPreview.signature === target.acceptedPreview.signature,
	};
}

function clipboard(
	overrides: Partial<EditorClipboardPort> = {},
): EditorClipboardPort {
	return {
		check: vi.fn(),
		dispose: vi.fn(),
		getState: vi.fn(() => ({ status: "unknown" })),
		read: vi.fn(),
		subscribe: vi.fn(() => () => undefined),
		write: vi.fn().mockResolvedValue({ status: "written" }),
		supportsPngWrite: vi.fn(() => true),
		writeImageDeferred: vi.fn((image: Promise<Blob>) =>
			image.then(() => ({ status: "written" as const })),
		),
		...overrides,
	} as EditorClipboardPort;
}

function rasterizer(
	overrides: Partial<WechatVisualRasterizationPort> = {},
): WechatVisualRasterizationPort {
	return {
		rasterize: vi.fn(async () => ({
			file: new File(["png"], "generated.png", { type: "image/png" }),
			height: 20,
			pixelCount: 200,
			width: 10,
		})),
		...overrides,
	};
}

function expectFailed(
	result: GeneratedContentExportResult,
	code: string,
): void {
	expect(result).toEqual({ code, status: "failed" });
}

describe("generated content export session", () => {
	it("bounds projected pixels before rasterization and reports a bad rasterizer result", async () => {
		const target = mathTarget();
		const source = document.createElement("div");
		const lease = validatedLease(target, source);
		const rasterizerPort = rasterizer();
		const session = createGeneratedContentExportSession({
			clipboard: clipboard(),
			maxPixels: 100,
			rasterizer: rasterizerPort,
		});

		expectFailed(
			await session.copyAsImage({
				dimensions: { height: 20, width: 10 },
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			}),
			"generated-content-export-rasterization-invalid",
		);
		expect(rasterizerPort.rasterize).not.toHaveBeenCalled();

		const invalidResult = createGeneratedContentExportSession({
			clipboard: clipboard(),
			maxPixels: 100,
			rasterizer: rasterizer({
				rasterize: vi.fn(async () => ({
					file: new File(["png"], "generated.png", { type: "image/png" }),
					height: 1,
					pixelCount: 2,
					width: 1,
				})),
			}),
		});
		expectFailed(
			await invalidResult.copyAsImage({
				dimensions: { height: 1, width: 1 },
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			}),
			"generated-content-export-rasterization-invalid",
		);
	});

	it("validates CSS dimensions and ceil-scaled output pixels from the rasterizer contract", async () => {
		const target = mathTarget();
		const source = document.createElement("div");
		const lease = validatedLease(target, source);
		const invalidResult = createGeneratedContentExportSession({
			clipboard: clipboard(),
			rasterScale: 1.5,
			rasterizer: rasterizer({
				rasterize: vi.fn(async () => ({
					file: new File(["png"], "generated.png", { type: "image/png" }),
					height: 2,
					pixelCount: 9,
					width: 3,
				})),
			}),
		});

		expectFailed(
			await invalidResult.copyAsImage({
				dimensions: { height: 2, width: 2 },
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			}),
			"generated-content-export-rasterization-invalid",
		);

		const validResult = createGeneratedContentExportSession({
			clipboard: clipboard(),
			rasterScale: 1.5,
			rasterizer: rasterizer({
				rasterize: vi.fn(async () => ({
					file: new File(["png"], "generated.png", { type: "image/png" }),
					height: 2,
					pixelCount: 9,
					width: 2,
				})),
			}),
		});

		expect(
			await validResult.copyAsImage({
				dimensions: { height: 2, width: 2 },
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			}),
		).toEqual({ status: "copied" });
	});

	it("times out an unresponsive rasterizer and aborts its operation", async () => {
		vi.useFakeTimers();
		try {
			const pending =
				deferred<
					Awaited<ReturnType<WechatVisualRasterizationPort["rasterize"]>>
				>();
			const target = mermaidTarget();
			const source = document.createElement("div");
			const lease = validatedLease(target, source);
			const session = createGeneratedContentExportSession({
				clipboard: clipboard(),
				rasterizationTimeoutMs: 10,
				rasterizer: rasterizer({ rasterize: vi.fn(() => pending.promise) }),
			});
			const result = session.copyAsImage({
				dimensions: { height: 1, width: 1 },
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			});
			await vi.advanceTimersByTimeAsync(10);
			expectFailed(
				await result,
				"generated-content-export-rasterization-timeout",
			);
			pending.resolve({
				file: new File(["png"], "generated.png", { type: "image/png" }),
				height: 1,
				pixelCount: 1,
				width: 1,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("settles immediately on dispose even when the rasterizer ignores abort", async () => {
		const pending =
			deferred<
				Awaited<ReturnType<WechatVisualRasterizationPort["rasterize"]>>
			>();
		const target = mermaidTarget();
		const source = document.createElement("div");
		const lease = validatedLease(target, source);
		const session = createGeneratedContentExportSession({
			clipboard: clipboard(),
			rasterizer: rasterizer({ rasterize: vi.fn(() => pending.promise) }),
		});
		const operation = session.copyAsImage({
			dimensions: { height: 1, width: 1 },
			identity: () => identity(target),
			mode: "ordinary",
			...lease,
		});

		session.dispose();
		expectFailed(await operation, "generated-content-export-disposed");
		pending.resolve({
			file: new File(["png"], "generated.png", { type: "image/png" }),
			height: 1,
			pixelCount: 1,
			width: 1,
		});
	});

	it("denies Copy as Image before rasterization when PNG Clipboard is unsupported", async () => {
		const clipboardPort = clipboard({ supportsPngWrite: vi.fn(() => false) });
		const rasterizerPort = rasterizer();
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizerPort,
		});
		const source = document.createElement("div");
		const target = mathTarget();
		const lease = validatedLease(target, source);

		const result = await session.copyAsImage({
			dimensions: { height: 20, width: 10 },
			identity: () => identity(target),
			mode: "ordinary",
			...lease,
		});

		expectFailed(result, "generated-content-export-clipboard-unsupported");
		expect(rasterizerPort.rasterize).not.toHaveBeenCalled();
	});

	it("keeps the deferred Clipboard call synchronous and reports rasterization failure", async () => {
		const payload =
			deferred<
				Awaited<ReturnType<WechatVisualRasterizationPort["rasterize"]>>
			>();
		const clipboardPort = clipboard({
			writeImageDeferred: vi.fn((image: Promise<Blob>) =>
				image.then(() => ({ status: "written" as const })),
			),
		});
		const rasterizerPort = rasterizer({
			rasterize: vi.fn(() => payload.promise),
		});
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizerPort,
		});
		const target = mathTarget();
		const source = document.createElement("div");
		const lease = validatedLease(target, source);
		const promise = session.copyAsImage({
			dimensions: { height: 20, width: 10 },
			identity: () => identity(target),
			mode: "ordinary",
			...lease,
		});

		expect(clipboardPort.writeImageDeferred).toHaveBeenCalledOnce();
		payload.reject(new Error("rasterizer failed"));
		expectFailed(
			await promise,
			"generated-content-export-rasterization-failed",
		);
	});

	it("rejects a stale accepted Preview signature and does not claim an image was copied", async () => {
		const payload =
			deferred<
				Awaited<ReturnType<WechatVisualRasterizationPort["rasterize"]>>
			>();
		const clipboardPort = clipboard();
		const rasterizerPort = rasterizer({
			rasterize: vi.fn(() => payload.promise),
		});
		const target = mathTarget();
		const source = document.createElement("div");
		const lease = validatedLease(target, source);
		let current: GeneratedContentExportIdentity = identity(target);
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizerPort,
		});
		const promise = session.copyAsImage({
			dimensions: { height: 20, width: 10 },
			identity: () => current,
			mode: "ordinary",
			...lease,
		});

		current = {
			...current,
			acceptedPreview: { revision: 2, signature: "preview-2" },
		};
		payload.resolve({
			file: new File(["png"], "generated.png", { type: "image/png" }),
			height: 20,
			pixelCount: 200,
			width: 10,
		});

		expectFailed(await promise, "generated-content-export-preview-stale");
	});

	it("rejects a lease whose accepted root is replaced during rasterization", async () => {
		const pending =
			deferred<
				Awaited<ReturnType<WechatVisualRasterizationPort["rasterize"]>>
			>();
		const target = mermaidTarget();
		const root = document.createElement("div");
		const lease = validatedLease(target, root);
		let accepted = true;
		const session = createGeneratedContentExportSession({
			clipboard: clipboard(),
			rasterizer: rasterizer({ rasterize: vi.fn(() => pending.promise) }),
		});
		const operation = session.copyAsImage({
			dimensions: { height: 1, width: 1 },
			identity: () => identity(target),
			mode: "ordinary",
			...lease,
			validateLease: (candidate, current) =>
				accepted &&
				candidate.root === root &&
				candidate.target === target &&
				current.sourceRevision === target.sourceRevision,
		});

		accepted = false;
		pending.resolve({
			file: new File(["png"], "generated.png", { type: "image/png" }),
			height: 1,
			pixelCount: 1,
			width: 1,
		});
		expectFailed(await operation, "generated-content-export-lease-stale");
	});

	it("rejects a stale mode and teardown without Clipboard or source mutation", async () => {
		const target = mermaidTarget();
		const original = target.original.full;
		const source = document.createElement("div");
		const lease = validatedLease(target, source);
		const clipboardPort = clipboard();
		let current: GeneratedContentExportIdentity = identity(target, "ordinary");
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizer(),
		});

		current = identity(target, "immersive");
		expectFailed(
			await session.copyAsImage({
				dimensions: { height: 20, width: 10 },
				identity: () => current,
				mode: "ordinary",
				...lease,
			}),
			"generated-content-export-mode-stale",
		);
		expect(clipboardPort.writeImageDeferred).not.toHaveBeenCalled();
		expect(target.original.full).toBe(original);

		const pending =
			deferred<
				Awaited<ReturnType<WechatVisualRasterizationPort["rasterize"]>>
			>();
		const teardownSession = createGeneratedContentExportSession({
			clipboard: clipboard(),
			rasterizer: rasterizer({ rasterize: vi.fn(() => pending.promise) }),
		});
		const operation = teardownSession.copyAsImage({
			dimensions: { height: 20, width: 10 },
			identity: () => identity(target),
			mode: "ordinary",
			...lease,
		});
		teardownSession.dispose();
		pending.resolve({
			file: new File(["png"], "generated.png", { type: "image/png" }),
			height: 20,
			pixelCount: 200,
			width: 10,
		});
		expectFailed(await operation, "generated-content-export-disposed");
	});

	it("copies MathML only for a math target and only from an existing MathML root", async () => {
		const clipboardPort = clipboard();
		const target = mathTarget();
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizer(),
		});
		const source = document.createElement("div");
		source.innerHTML =
			'<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html">x</span></span>';
		const lease = validatedLease(target, source);

		expect(
			await session.copyMathMl({
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			}),
		).toEqual({ status: "copied" });
		expect(clipboardPort.write).toHaveBeenCalledWith(
			"<math><mi>x</mi></math>",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		expectFailed(
			await session.copyMathMl({
				identity: () => identity(mermaidTarget()),
				mode: "ordinary",
				...validatedLease(mermaidTarget(), source),
			}),
			"generated-content-export-kind-invalid",
		);
	});

	it("copies MathML from the whitelisted KaTeX display path", async () => {
		const clipboardPort = clipboard();
		const target = mathTarget("$$x^2$$");
		const source = document.createElement("div");
		source.className = "easymde-math easymde-math-block";
		source.innerHTML = katex.renderToString("x^2", { displayMode: true });
		const lease = validatedLease(target, source);
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizer(),
		});

		expect(
			await session.copyMathMl({
				identity: () => identity(target),
				mode: "ordinary",
				...lease,
			}),
		).toEqual({ status: "copied" });
		expect(clipboardPort.write).toHaveBeenCalledWith(
			expect.stringContaining("<math"),
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("rejects MathML from an unrelated root even when it contains a MathML element", async () => {
		const clipboardPort = clipboard();
		const target = mathTarget();
		const acceptedRoot = document.createElement("div");
		acceptedRoot.innerHTML =
			'<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span>';
		document.body.append(acceptedRoot);
		const unrelatedRoot = document.createElement("div");
		unrelatedRoot.innerHTML =
			'<span class="katex"><span class="katex-mathml"><math><mi>not-x</mi></math></span></span>';
		document.body.append(unrelatedRoot);
		const session = createGeneratedContentExportSession({
			clipboard: clipboardPort,
			rasterizer: rasterizer(),
		});

		expectFailed(
			await session.copyMathMl({
				identity: () => identity(target),
				lease: { root: unrelatedRoot, target },
				mode: "ordinary",
				validateLease: (lease) => lease.root === acceptedRoot,
			}),
			"generated-content-export-lease-stale",
		);
		expect(clipboardPort.write).not.toHaveBeenCalled();
	});

});
