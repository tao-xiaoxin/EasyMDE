import { act, render } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

import type {
	PreviewEditMap,
	PreviewRequest,
	PreviewResponse,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import { createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex } from "../../editor-context-menu/editor-markdown-block-index";
import type { GeneratedImageTargetIndex } from "../../generated-content-export/generated-image-target";
import { parseMarkdownImageScale } from "../../image-scale/image-scale-contract";
import type { PreviewRequestSession } from "../model/create-preview-request-session";
import type { PreviewEnhancementPort } from "../ports/preview-enhancement-port";
import type { PreviewScrollPort } from "../ports/preview-scroll-port";
import {
	type PreviewGeneratedContentTargetIndex,
	type PreviewSourceSnapshot,
	PreviewSurfaceOwner,
	type PreviewSurfaceRuntime,
	type PreviewSurfaceStatus,
} from "./PreviewSurfaceOwner";

const messages = {
	empty: "Start writing Markdown to preview the article.",
	error: "Preview failed. Please keep writing; saving is not affected.",
	loading: "Loading preview...",
};

const request = (markdown: string, signature = markdown): PreviewRequest => ({
	markdown,
	postId: 7,
	markdownTheme: "default",
	codeTheme: "atom-one-dark",
	customCssId: "",
	signature,
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function safeHtml(value: string): SafePreviewHtml {
	return value as SafePreviewHtml;
}

async function flushAnimationFrames(count = 8): Promise<void> {
	for (let index = 0; index < count; index += 1) {
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
	}
}

type PreviewResponseFixture = Omit<PreviewResponse, "editMap"> &
	Partial<Pick<PreviewResponse, "editMap">>;

type PreviewResponseDeferred = Readonly<{
	promise: Promise<PreviewResponse>;
	reject: (reason?: unknown) => void;
	resolve: (response: PreviewResponseFixture) => void;
}>;

function normalizePreviewResponse(
	response: PreviewResponseFixture,
	previewRequest: PreviewRequest,
): PreviewResponse {
	if (response.editMap) return { ...response, editMap: response.editMap };
	const template = document.createElement("template");
	template.innerHTML = response.html;
	const blocks = Array.from(template.content.children).map((element, index) => {
		const id = `b${index}`;
		element.setAttribute("data-easymde-visual-block-id", id);
		return {
			editable: true as const,
			endLine: index + 1,
			id,
			startLine: index,
		};
	});
	if (0 === blocks.length) throw new Error("preview-response-fixture-empty");
	return {
		...response,
		html: template.innerHTML as SafePreviewHtml,
		editMap: {
			version: 1,
			coordinate: "line",
			signature: previewRequest.signature,
			blocks,
		},
	};
}

function deferredPreviewResponse(
	previewRequest: PreviewRequest,
): PreviewResponseDeferred {
	const pending = deferred<PreviewResponse>();
	return {
		promise: pending.promise,
		reject: pending.reject,
		resolve: (response) =>
			pending.resolve(normalizePreviewResponse(response, previewRequest)),
	};
}

function blockFixture(count: number, signature: string) {
	const blocks = Array.from({ length: count }, (_, index) => ({
		id: `b${index}`,
		startLine: index * 2,
		endLine: index * 2 + 1,
		editable: true as const,
	}));
	return {
		editMap: {
			version: 1 as const,
			coordinate: "line" as const,
			signature,
			blocks,
		},
		html: blocks
			.map(({ id }) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
			.join("") as SafePreviewHtml,
	};
}

function visualSourceMarkerCount(surface: HTMLElement): number {
	const walker = surface.ownerDocument.createTreeWalker(
		surface,
		NodeFilter.SHOW_COMMENT,
	);
	let count = 0;
	while (walker.nextNode()) {
		if ("easymde-visual-markdown-source" === walker.currentNode.nodeValue) {
			count += 1;
		}
	}
	return count;
}

function createEditorMarkdownBlockIndex(source: string) {
	return createProfiledMarkdownBlockIndex(source, {
		referenceLabelCaseFoldProfile: 14,
	});
}

function setup(options?: {
	className?: string;
	emptyMode?: "message" | "paper";
	enhance?: PreviewEnhancementPort["enhance"];
	initialHtml?: string;
	initialEditMap?: PreviewEditMap;
	initialSignature?: string;
	currentSourceSnapshot?: () => PreviewSourceSnapshot | null;
	sourceRevision?: number;
	onDiagnostic?: (code: string) => void;
	onHtmlChange?: (html: SafePreviewHtml) => void;
	onSnapshotReady?: (
		html: SafePreviewHtml,
		signature: string,
		editMap: PreviewEditMap | null,
	) => void;
	onImageReadinessChange?: () => void;
	onStatusChange?: (status: PreviewSurfaceStatus) => void;
	scrollPort?: PreviewScrollPort;
	stagingScheduler?: Readonly<{
		now?: () => number;
		yield: () => Promise<void>;
	}>;
}) {
	let className = options?.className;
	let currentSourceSnapshot = options?.currentSourceSnapshot;
	let sourceRevision = options?.sourceRevision;
	let session!: PreviewRequestSession;
	let runtime!: PreviewSurfaceRuntime;
	const responses: PreviewResponseDeferred[] = [];
	const renderPreview = vi.fn((previewRequest: PreviewRequest) => {
		const response = deferredPreviewResponse(previewRequest);
		responses.push(response);
		return response.promise;
	});
	const enhancementPort: PreviewEnhancementPort = {
		prepareCodeTheme: vi.fn().mockResolvedValue({
			cancel: vi.fn(),
			commit: vi.fn(),
		}),
		syncCodeFrameBackgrounds: vi.fn(),
		enhance: options?.enhance ?? vi.fn().mockResolvedValue(undefined),
	};
	const onDiagnostic = options?.onDiagnostic ?? vi.fn();
	const defaultScrollPort: PreviewScrollPort = {
		capture: (surface) => ({
			left: surface.scrollLeft,
			ratio: 0,
			top: surface.scrollTop,
		}),
		restore: (surface, snapshot) => {
			surface.scrollLeft = snapshot.left;
			surface.scrollTop = snapshot.top;
		},
	};
	const owner = (emptyMode = options?.emptyMode) => (
		<div className="easymde-immersive-preview-canvas">
			<PreviewSurfaceOwner
				{...(undefined !== className ? { className } : {})}
				enhancementPort={enhancementPort}
				initial={{
					codeTheme: "github",
					...(options?.initialEditMap
						? { editMap: options.initialEditMap }
						: {}),
					features: {},
					html: safeHtml(options?.initialHtml ?? "<p>Initial preview</p>"),
					signature: options?.initialSignature ?? "initial",
				}}
				initialRevision={0}
				messages={messages}
				{...(emptyMode ? { emptyMode } : {})}
				{...(options?.stagingScheduler
					? { stagingScheduler: options.stagingScheduler }
					: {})}
				onDiagnostic={onDiagnostic}
				{...(options?.onHtmlChange
					? { onHtmlChange: options.onHtmlChange }
					: {})}
				{...(options?.onSnapshotReady
					? { onSnapshotReady: options.onSnapshotReady }
					: {})}
				{...(options?.onImageReadinessChange
					? { onImageReadinessChange: options.onImageReadinessChange }
					: {})}
				{...(options?.onStatusChange
					? { onStatusChange: options.onStatusChange }
					: {})}
				{...(undefined !== sourceRevision ? { sourceRevision } : {})}
				{...(currentSourceSnapshot ? { currentSourceSnapshot } : {})}
				onReady={(readySession) => {
					runtime = readySession;
					session = readySession.session;
				}}
				port={{ render: renderPreview }}
				scrollPort={options?.scrollPort ?? defaultScrollPort}
			/>
		</div>
	);
	const result = render(owner());
	const surface = result.container.querySelector("article");
	if (!(surface instanceof HTMLElement)) throw new Error("surface missing");
	const canvas = result.container.querySelector(
		".easymde-immersive-preview-canvas",
	);
	if (!(canvas instanceof HTMLElement)) throw new Error("canvas missing");
	return {
		enhancementPort,
		onDiagnostic,
		renderPreview,
		responses,
		runtime,
		session,
		setEmptyMode: (emptyMode: "message" | "paper") =>
			result.rerender(owner(emptyMode)),
		canvas,
		surface,
		...result,
		rerender: () => result.rerender(owner()),
		setCurrentSourceSnapshot: (
			next: (() => PreviewSourceSnapshot | null) | undefined,
		) => {
			currentSourceSnapshot = next;
			result.rerender(owner());
		},
		setSourceRevision: (next: number | undefined) => {
			sourceRevision = next;
			result.rerender(owner());
		},
		setClassName: (value: string | undefined) => {
			className = value;
			result.rerender(owner());
		},
	};
}

describe("PreviewSurfaceOwner", () => {
	it("reports verified Preview image load and error readiness", async () => {
		const onImageReadinessChange = vi.fn();
		const current = setup({
			initialHtml: '<p><img src="https://img.test/ready.png"></p>',
			onImageReadinessChange,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) throw new Error("image-missing");
		expect(onImageReadinessChange).not.toHaveBeenCalled();
		image.dispatchEvent(new Event("load"));
		image.dispatchEvent(new Event("error"));
		expect(onImageReadinessChange).toHaveBeenCalledTimes(2);
		current.unmount();
	});

	it("removes Preview image readiness listeners on teardown", async () => {
		const onImageReadinessChange = vi.fn();
		const current = setup({
			initialHtml: '<p><img src="https://img.test/teardown.png"></p>',
			onImageReadinessChange,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) throw new Error("image-missing");
		current.unmount();
		image.dispatchEvent(new Event("load"));
		image.dispatchEvent(new Event("error"));
		expect(onImageReadinessChange).not.toHaveBeenCalled();
	});

	it("ignores image readiness events from a stale Preview generation", async () => {
		const onImageReadinessChange = vi.fn();
		const current = setup({
			initialHtml: '<p><img src="https://img.test/first.png"></p>',
			onImageReadinessChange,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const staleImage = current.surface.querySelector("img");
		if (!(staleImage instanceof HTMLImageElement)) {
			throw new Error("image-missing");
		}
		act(() => current.session.schedule(request("next", "next-image"), true));
		current.responses[0]?.resolve({
			features: {},
			html: safeHtml('<p><img src="https://img.test/second.png"></p>'),
		});
		await act(async () => {
			for (let index = 0; index < 24; index += 1) await Promise.resolve();
			await flushAnimationFrames(8);
		});
		const nextImage = current.surface.querySelector("img");
		if (!(nextImage instanceof HTMLImageElement)) {
			throw new Error("next-image-missing");
		}
		staleImage.dispatchEvent(new Event("load"));
		expect(onImageReadinessChange).not.toHaveBeenCalled();
		nextImage.dispatchEvent(new Event("load"));
		expect(onImageReadinessChange).toHaveBeenCalledTimes(1);
		current.unmount();
	});

	it("leases only the accepted current generated math root and releases it safely", async () => {
		const source = "$x$";
		const signature = "generated-math-initial";
		let currentSource = source;
		let currentRevision = 41;
		const current = setup({
			currentSourceSnapshot: () => ({
				revision: currentRevision,
				value: currentSource,
			}),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
			sourceRevision: 41,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		act(() => {
			current.session.schedule(request(source, signature), true);
		});
		expect(current.responses).toHaveLength(1);
		current.responses[0]?.resolve({
			features: {},
			editMap: {
				version: 1,
				coordinate: "line",
				signature,
				blocks: [
					{
						editable: true,
						endLine: 1,
						id: "b0",
						startLine: 0,
					},
				],
			},
			html: safeHtml(
				'<p data-easymde-visual-block-id="b0">' +
					'<span class="easymde-math">' +
					'<span class="katex-mathml"><math><mi>x</mi></math></span>' +
					"</span></p>",
			),
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		expect(current.surface.easymdePreviewSignature).toBe(signature);

		const math = current.surface.querySelector(".easymde-math");
		expect(math).toBeInstanceOf(HTMLElement);
		if (!(math instanceof HTMLElement)) throw new Error("math-root-missing");
		const sourceIndex: PreviewGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "math",
					lineEnd: 0,
					lineStart: 0,
					to: 3,
				},
			],
			length: source.length,
			mathSpans: [
				{
					bodyFrom: 1,
					bodyTo: 2,
					displayMode: false,
					from: 0,
					to: 3,
				},
			],
			revision: 41,
			source,
		};

		const lease = current.runtime.prepareGeneratedContentTarget({
			element: math,
			index: sourceIndex,
			kind: "math",
			ordinal: 0,
		});
		expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
			revision: 2,
			signature,
			sourceRevision: 41,
		});
		expect(lease?.root).toBe(math);
		expect(lease?.isCurrent()).toBe(true);

		const staleLease = current.runtime.prepareGeneratedContentTarget({
			element: math,
			index: sourceIndex,
			kind: "math",
			ordinal: 0,
		});
		expect(staleLease?.isCurrent()).toBe(true);
		if (!staleLease) throw new Error("stale-lease-missing");
		currentSource = "changed";
		expect(current.runtime.getGeneratedPreviewIdentity()).toBeNull();
		expect(
			current.runtime.prepareGeneratedContentTarget({
				element: math,
				index: sourceIndex,
				kind: "math",
				ordinal: 0,
			}),
		).toBeNull();
		currentRevision = 42;
		expect(staleLease.isCurrent()).toBe(false);
		currentSource = source;
		currentRevision = 41;
		await act(async () => {
			current.session.schedule(request("next", "next-signature"), true);
			await Promise.resolve();
		});
		expect(staleLease?.isCurrent()).toBe(false);

		const wrongOrdinal = current.runtime.prepareGeneratedContentTarget({
			element: math,
			index: sourceIndex,
			kind: "math",
			ordinal: 1,
		});
		expect(wrongOrdinal).toBeNull();

		lease?.release();
		expect(lease?.isCurrent()).toBe(false);
		current.unmount();
		expect(staleLease?.isCurrent()).toBe(false);
		expect(current.runtime.getGeneratedPreviewIdentity()).toBeNull();
	});

	it("rejects a duplicate math root whose DOM ordinal does not match its source span", async () => {
		const source = "$a$ and $b$";
		const signature = "generated-math-duplicates";
		const current = setup({
			currentSourceSnapshot: () => ({ revision: 9, value: source }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
			sourceRevision: 9,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		current.session.schedule(request(source, signature), true);
		current.responses[0]?.resolve({
			features: {},
			editMap: {
				version: 1,
				coordinate: "line",
				signature,
				blocks: [
					{
						editable: true,
						endLine: 1,
						id: "b0",
						startLine: 0,
					},
				],
			},
			html: safeHtml(
				'<p data-easymde-visual-block-id="b0">' +
					'<span class="easymde-math"><span class="katex-mathml">' +
					"<math><mi>a</mi></math></span></span>" +
					'<span class="easymde-math"><span class="katex-mathml">' +
					"<math><mi>b</mi></math></span></span></p>",
			),
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const roots = Array.from(
			current.surface.querySelectorAll<HTMLElement>(".easymde-math"),
		);
		expect(roots).toHaveLength(2);
		const sourceIndex: PreviewGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 0,
					lineStart: 0,
					to: source.length,
				},
			],
			length: source.length,
			mathSpans: [
				{ bodyFrom: 1, bodyTo: 2, displayMode: false, from: 0, to: 3 },
				{ bodyFrom: 9, bodyTo: 10, displayMode: false, from: 8, to: 11 },
			],
			revision: 9,
			source,
		};
		expect(
			current.runtime.prepareGeneratedContentTarget({
				element: roots[0] as HTMLElement,
				index: sourceIndex,
				kind: "math",
				ordinal: 1,
			}),
		).toBeNull();
		const secondLease = current.runtime.prepareGeneratedContentTarget({
			element: roots[1] as HTMLElement,
			index: sourceIndex,
			kind: "math",
			ordinal: 1,
		});
		expect(secondLease?.isCurrent()).toBe(true);
		const replacement = roots[1]?.cloneNode(true);
		if (!(replacement instanceof HTMLElement)) {
			throw new Error("generated-root-replacement-missing");
		}
		roots[1]?.replaceWith(replacement);
		expect(secondLease?.isCurrent()).toBe(false);
		current.unmount();
	});

	it("does not accept a rendered candidate after the canonical source changes", async () => {
		const source = "$x$";
		const signature = "generated-math-late-commit";
		let currentSource = source;
		const current = setup({
			currentSourceSnapshot: () => ({ revision: 17, value: currentSource }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
			sourceRevision: 17,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		current.session.schedule(request(source, signature), true);
		currentSource = "changed";
		current.responses[0]?.resolve({
			features: {},
			editMap: {
				version: 1,
				coordinate: "line",
				signature,
				blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
			},
			html: safeHtml(
				'<p data-easymde-visual-block-id="b0">' +
					'<span class="easymde-math"><span class="katex-mathml">' +
					"<math><mi>x</mi></math></span></span></p>",
			),
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		expect(current.runtime.getGeneratedPreviewIdentity()).toBeNull();
		current.unmount();
	});

	it("mints a Mermaid target for a visual block that is itself the generated root", async () => {
		const source = "```mermaid\r\nA-->B\r\n```";
		const signature = "generated-mermaid-root";
		const current = setup({
			currentSourceSnapshot: () => ({ revision: 23, value: source }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
			sourceRevision: 23,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		current.session.schedule(request(source, signature), true);
		current.responses[0]?.resolve({
			features: {},
			editMap: {
				version: 1,
				coordinate: "line",
				signature,
				blocks: [
					{
						editable: true,
						endLine: 3,
						id: "b0",
						startLine: 0,
					},
				],
			},
			html: safeHtml(
				'<div data-easymde-visual-block-id="b0" ' +
					'class="easymde-mermaid"><svg></svg></div>',
			),
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const mermaid = current.surface.querySelector(".easymde-mermaid");
		expect(mermaid).toBeInstanceOf(HTMLElement);
		if (!(mermaid instanceof HTMLElement)) {
			throw new Error("mermaid-root-missing");
		}
		const index: PreviewGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "code",
					lineEnd: 2,
					lineStart: 0,
					to: source.length,
				},
			],
			length: source.length,
			mathSpans: [],
			revision: 23,
			source,
		};
		const lease = current.runtime.prepareGeneratedContentTarget({
			element: mermaid,
			index,
			kind: "mermaid",
			ordinal: 0,
		});
		expect(lease?.isCurrent()).toBe(true);
		expect(lease?.target.original).toEqual({
			body: "A-->B\r\n",
			bodyRange: { from: 12, to: 19 },
			full: source,
			fullRange: { from: 0, to: source.length },
		});
		current.unmount();
	});

	it("mints a standalone math block root from the indexed display span", async () => {
		const source = "$$x$$";
		const signature = "generated-math-block-root";
		const current = setup({
			currentSourceSnapshot: () => ({ revision: 24, value: source }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
			sourceRevision: 24,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		act(() => {
			current.session.schedule(request(source, signature), true);
		});
		expect(current.responses).toHaveLength(1);
		await act(async () => {
			current.responses[0]?.resolve({
				editMap: {
					version: 1,
					coordinate: "line",
					signature,
					blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
				},
				features: {},
				html: safeHtml(
					'<div data-easymde-visual-block-id="b0" ' +
						'class="easymde-math"><span class="katex-mathml">' +
						"<math><mi>x</mi></math></span></div>",
				),
			});
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const root = current.surface.querySelector(".easymde-math");
		if (!(root instanceof HTMLElement)) {
			throw new Error("math-block-root-missing");
		}
		const index: PreviewGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "math",
					lineEnd: 0,
					lineStart: 0,
					to: source.length,
				},
			],
			length: source.length,
			mathSpans: [
				{
					bodyFrom: 2,
					bodyTo: 3,
					displayMode: true,
					from: 0,
					to: source.length,
				},
			],
			revision: 24,
			source,
		};
		const lease = current.runtime.prepareGeneratedContentTarget({
			element: root,
			index,
			kind: "math",
			ordinal: 0,
		});
		expect(lease?.isCurrent()).toBe(true);
		const selectionPin =
			current.runtime.prepareGeneratedContentTargetForSelection({
				index,
				selection: { end: source.length, start: 0 },
			});
		expect(selectionPin?.target.kind).toBe("math");
		expect(selectionPin?.target.ordinal).toBe(0);
		expect(selectionPin?.getLease()?.root).toBe(root);
		selectionPin?.release();
		current.unmount();
	});

	it("looks up a dense math selection from the sorted index without minting every span", async () => {
		const source = Array.from({ length: 100 }, () => "$x$").join(" ");
		const signature = "generated-dense-selection";
		const parsed = createEditorMarkdownBlockIndex(source);
		const current = setup({
			currentSourceSnapshot: () => ({ revision: 25, value: source }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
			sourceRevision: 25,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		act(() => {
			current.session.schedule(request(source, signature), true);
		});
		expect(current.responses).toHaveLength(1);
		await act(async () => {
			current.responses[0]?.resolve({
				editMap: {
					version: 1,
					coordinate: "line",
					signature,
					blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
				},
				features: {},
				html: safeHtml(
					'<p data-easymde-visual-block-id="b0">' +
						Array.from(
							{ length: 100 },
							() =>
								'<span class="easymde-math"><span class="katex-mathml">' +
								"<math><mi>x</mi></math></span></span>",
						).join("") +
						"</p>",
				),
			});
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const mathSpans = parsed.mathSpans;
		const lastSpan = mathSpans[mathSpans.length - 1];
		if (!lastSpan) throw new Error("dense-selection-span-missing");
		const index: PreviewGeneratedContentTargetIndex = {
			blocks: parsed.blocks,
			length: source.length,
			mathSpans,
			revision: 25,
			source,
		};
		const pin = current.runtime.prepareGeneratedContentTargetForSelection({
			index,
			selection: { end: lastSpan.to, start: lastSpan.from },
		});
		expect(pin?.target.kind).toBe("math");
		expect(pin?.target.ordinal).toBe(mathSpans.length - 1);
		expect(pin?.target.original.fullRange).toEqual({
			from: lastSpan.from,
			to: lastSpan.to,
		});
		pin?.release();
		expect(
			current.runtime.prepareGeneratedContentTargetForSelection({
				index,
				selection: { end: 0, start: 0 },
			}),
		).toBeNull();
		current.unmount();
	});

	it("leases the exact visual image node and keeps duplicate destinations distinct", async () => {
		const source =
			"![one](https://img.test/a.png) ![two](https://img.test/a.png)";
		const signature = "generated-image-lease";
		const firstImage = parseMarkdownImageScale(source, 0);
		const secondStart = source.indexOf("![two]");
		const secondImage = parseMarkdownImageScale(source, secondStart);
		if (!firstImage || !secondImage) {
			throw new Error("image-target-fixture-invalid");
		}
		const current = setup({
			currentSourceSnapshot: () => ({ revision: 55, value: source }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		act(() => {
			current.session.schedule(request(source, signature), true);
		});
		expect(current.responses).toHaveLength(1);
		await act(async () => {
			current.responses[0]?.resolve({
				editMap: {
					version: 1,
					coordinate: "line",
					signature,
					blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
				},
				features: {},
				html: safeHtml(
					'<p data-easymde-visual-block-id="b0">' +
						'<img src="https://img.test/a.png" alt="one">' +
						'<img src="https://img.test/a.png" alt="two"></p>',
				),
			});
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		const images = Array.from(current.surface.querySelectorAll("img"));
		expect(images).toHaveLength(2);
		const index: GeneratedImageTargetIndex = {
			blockImages: [
				{
					end: source.length,
					images: [firstImage, secondImage],
					start: 0,
					status: "ready",
				},
			],
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 0,
					lineStart: 0,
					to: source.length,
				},
			],
			complete: true,
			images: [firstImage, secondImage],
			length: source.length,
			revision: 55,
			source,
			sourceBytes: source.length,
		};
		const firstLease = current.runtime.prepareImageTarget({
			element: images[0] as HTMLImageElement,
			index,
			selection: { end: firstImage.end, start: firstImage.start },
		});
		const secondLease = current.runtime.prepareImageTarget({
			element: images[1] as HTMLImageElement,
			index,
			selection: { end: secondImage.end, start: secondImage.start },
		});
		expect(firstLease?.target.original.raw).toBe(firstImage.raw);
		expect(secondLease?.target.original.start).toBe(secondImage.start);
		expect(firstLease?.isCurrent()).toBe(true);
		const endSelectionPin = current.runtime.prepareImageTargetBySelection({
			index,
			selection: { end: secondImage.end, start: secondImage.start },
		});
		expect(endSelectionPin?.target.blockId).toBe("b0");
		expect(endSelectionPin?.getLease()?.root).toBe(images[1]);
		endSelectionPin?.release();
		const firstSelectionPin = current.runtime.prepareImageTargetBySelection({
			index,
			selection: { end: firstImage.end, start: firstImage.start },
		});
		expect(firstSelectionPin?.getLease()?.root).toBe(images[0]);
		const visualBlock = images[0]?.closest("[data-easymde-visual-block-id]");
		visualBlock?.insertBefore(
			images[1] as HTMLImageElement,
			images[0] as HTMLImageElement,
		);
		expect(firstSelectionPin?.getLease()).toBeNull();
		expect(firstSelectionPin?.isCurrent()).toBe(false);
		firstSelectionPin?.release();
		visualBlock?.insertBefore(
			images[0] as HTMLImageElement,
			images[1] as HTMLImageElement,
		);
		expect(secondLease?.isCurrent()).toBe(true);
		images[1]?.setAttribute("srcset", "https://img.test/a-2x.png 2x");
		expect(secondLease?.isCurrent()).toBe(false);
		const fingerprintLease = current.runtime.prepareImageTarget({
			element: images[1] as HTMLImageElement,
			index,
			selection: { end: secondImage.end, start: secondImage.start },
		});
		expect(fingerprintLease?.isCurrent()).toBe(true);
		images[1]?.setAttribute("sizes", "50vw");
		expect(fingerprintLease?.isCurrent()).toBe(false);
		const currentSrcLease = current.runtime.prepareImageTarget({
			element: images[1] as HTMLImageElement,
			index,
			selection: { end: secondImage.end, start: secondImage.start },
		});
		Object.defineProperty(images[1], "currentSrc", {
			configurable: true,
			value: "https://img.test/a-2x.png",
		});
		expect(currentSrcLease?.isCurrent()).toBe(false);
		const naturalSizeLease = current.runtime.prepareImageTarget({
			element: images[1] as HTMLImageElement,
			index,
			selection: { end: secondImage.end, start: secondImage.start },
		});
		Object.defineProperties(images[1], {
			naturalHeight: { configurable: true, value: 120 },
			naturalWidth: { configurable: true, value: 240 },
		});
		expect(naturalSizeLease?.isCurrent()).toBe(false);
		images[0]?.setAttribute("src", "https://img.test/changed.png");
		expect(firstLease?.isCurrent()).toBe(false);
		current.unmount();
	});

	it("accepts a generated export again after a legitimate source revision and Preview commit", async () => {
		let source = "$x$";
		let revision = 41;
		const signature = "generated-source-revision";
		const current = setup({
			currentSourceSnapshot: () => ({ revision, value: source }),
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
		});
		const accept = async (
			markdown: string,
			htmlValue: string,
		): Promise<void> => {
			const responseIndex = current.responses.length;
			act(() => {
				current.session.schedule(request(markdown, signature), true);
			});
			expect(current.responses).toHaveLength(responseIndex + 1);
			await act(async () => {
				current.responses[responseIndex]?.resolve({
					editMap: {
						version: 1,
						coordinate: "line",
						signature,
						blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
					},
					features: {},
					html: safeHtml(
						`<p data-easymde-visual-block-id="b0">${htmlValue}</p>`,
					),
				});
				for (let index = 0; index < 16; index += 1) await Promise.resolve();
				await flushAnimationFrames(6);
			});
		};
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		await accept(
			source,
			'<span class="easymde-math">' +
				'<span class="katex-mathml"><math><mi>x</mi></math></span></span>',
		);
		expect(current.runtime.getGeneratedPreviewIdentity()?.sourceRevision).toBe(
			41,
		);
		source = "$y$";
		revision = 42;
		await accept(
			source,
			'<span class="easymde-math">' +
				'<span class="katex-mathml"><math><mi>y</mi></math></span></span>',
		);
		expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
			signature,
			sourceRevision: 42,
		});
		current.unmount();
	});

	it("uses a replaced source snapshot provider when a later Preview commits", async () => {
		const source = "$x$";
		const signature = "generated-provider-replacement";
		const current = setup({
			initialHtml: "<p>Initial preview</p>",
			initialSignature: signature,
		});
		await act(async () => {
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(4);
		});
		current.setCurrentSourceSnapshot(() => ({ revision: 7, value: source }));
		act(() => {
			current.session.schedule(request(source, signature), true);
		});
		expect(current.responses).toHaveLength(1);
		await act(async () => {
			current.responses[0]?.resolve({
				editMap: {
					version: 1,
					coordinate: "line",
					signature,
					blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
				},
				features: {},
				html: safeHtml(
					'<p data-easymde-visual-block-id="b0">' +
						'<span class="easymde-math"><span class="katex-mathml">' +
						"<math><mi>x</mi></math></span></span></p>",
				),
			});
			for (let index = 0; index < 16; index += 1) await Promise.resolve();
			await flushAnimationFrames(6);
		});
		expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
			revision: 2,
			signature,
			sourceRevision: 7,
		});
		current.unmount();
	});

	it("exposes the read-only preview surface as a polite live region", async () => {
		const current = setup();

		expect(current.surface.hasAttribute("contenteditable")).toBe(false);
		expect(current.surface.getAttribute("aria-live")).toBe("polite");
		await act(async () => {});
	});

	it("renders initial server HTML through the single preview sink", async () => {
		const { surface } = setup({ initialHtml: "<h2>Server preview</h2>" });

		expect(surface.matches("[data-easymde-preview-html-sink]")).toBe(true);
		expect(surface.querySelector("h2")?.textContent).toBe("Server preview");
		await act(async () => {});
		expect(surface.getAttribute("aria-busy")).toBe("false");
		expect(surface.easymdePreviewSignature).toBe("initial");
	});

	it("publishes enhanced generation-zero server HTML", async () => {
		const onHtmlChange = vi.fn<(html: SafePreviewHtml) => void>();
		const current = setup({
			enhance: async (surface) => {
				surface.querySelector("h2")?.setAttribute("data-enhanced", "1");
			},
			initialHtml: "<h2>Server preview</h2>",
			onHtmlChange,
		});

		await act(async () => {});

		expect(current.surface.easymdePreviewSignature).toBe("initial");
		expect(onHtmlChange).toHaveBeenCalledOnce();
		expect(onHtmlChange).toHaveBeenCalledWith(
			safeHtml('<h2 data-enhanced="1">Server preview</h2>'),
		);
	});

	it("preserves Block markers after enhancement replaces a root element", async () => {
		const fixture = blockFixture(4, "block-marker-preservation");
		const current = setup({
			enhance: async (surface) => {
				const replaced = surface.querySelector(
					'[data-easymde-visual-block-id="b3"]',
				);
				if (!replaced) throw new Error("replacement-target-missing");
				const enhanced = surface.ownerDocument.createElement("section");
				enhanced.textContent = "enhanced final Block";
				replaced.replaceWith(enhanced);
			},
			initialEditMap: fixture.editMap,
			initialHtml: fixture.html,
			initialSignature: "block-marker-preservation",
			stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
		});

		await act(async () => {
			for (let index = 0; index < 12; index += 1) await Promise.resolve();
			await flushAnimationFrames(8);
		});
		expect(
			current.surface.querySelector('[data-easymde-visual-block-id="b3"]')
				?.tagName,
		).toBe("SECTION");
		expect(current.onDiagnostic).not.toHaveBeenCalled();
		expect(
			current.surface.getAttribute("data-easymde-preview-error"),
		).toBeNull();
		current.unmount();
	});

	it("fails closed when the server block marker does not match editMap", async () => {
		const fixture = blockFixture(2, "invalid-map");
		const diagnostics: string[] = [];
		const current = setup({
			initialEditMap: fixture.editMap,
			initialHtml: fixture.html.replace("b1", "wrong"),
			initialSignature: "invalid-map",
			onDiagnostic: (code) => diagnostics.push(code),
		});

		await act(async () => {
			for (let index = 0; index < 8; index += 1) await Promise.resolve();
		});

		expect(diagnostics).toContain("preview-window-block-map-marker-mismatch");
		expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
			"1",
		);
	});

	it("offers an immersive ready empty paper without changing the ordinary empty message", () => {
		const ordinaryStatuses: PreviewSurfaceStatus[] = [];
		const ordinary = setup({
			initialHtml: "",
			onStatusChange: (status) => ordinaryStatuses.push(status),
		});

		act(() => {
			ordinary.session.schedule(request(""), true);
		});

		expect(ordinary.surface.textContent).toBe(messages.empty);
		expect(ordinaryStatuses[ordinaryStatuses.length - 1]).toBe("empty");

		const paperHtmlChanges: SafePreviewHtml[] = [];
		const paperStatuses: PreviewSurfaceStatus[] = [];
		const paper = setup({
			emptyMode: "paper",
			initialHtml: "",
			onHtmlChange: (html) => paperHtmlChanges.push(html),
			onStatusChange: (status) => paperStatuses.push(status),
		});

		act(() => {
			paper.session.schedule(request(""), true);
		});

		expect(paper.renderPreview).not.toHaveBeenCalled();
		expect(paper.surface.matches("[data-easymde-preview-html-sink]")).toBe(
			true,
		);
		expect(paper.surface.innerHTML).toBe("");
		expect(paper.surface.getAttribute("aria-busy")).toBe("false");
		expect(paperStatuses[paperStatuses.length - 1]).toBe("ready");
		expect(paperHtmlChanges).toEqual([safeHtml("")]);
	});

	it("announces a non-empty initial request while leaving empty paper mode", () => {
		const statuses: PreviewSurfaceStatus[] = [];
		const current = setup({
			initialHtml: "",
			onStatusChange: (status) => statuses.push(status),
		});

		act(() => {
			current.session.schedule(request("# Still rendering"), true);
			current.setEmptyMode("paper");
			current.setEmptyMode("message");
		});

		expect(current.surface.textContent).toBe(messages.loading);
		expect(current.surface.querySelector('[role="status"]')?.textContent).toBe(
			messages.loading,
		);
		expect(current.surface.getAttribute("aria-busy")).toBe("true");
		expect(statuses[statuses.length - 1]).toBe("loading");
		expect(current.surface.textContent).not.toBe(messages.empty);
	});

	it("keeps an empty paper surface blank while its preview request is pending", () => {
		const current = setup({ emptyMode: "paper", initialHtml: "" });
		act(() => current.session.schedule(request("# Paper pending"), true));

		expect(current.surface.innerHTML).toBe("");
		expect(current.surface.querySelector('[role="status"]')).toBeNull();
		expect(current.surface.getAttribute("aria-busy")).toBe("true");
	});

	it("keeps the loading status while an empty response is being enhanced", async () => {
		const enhancement = deferred<void>();
		const current = setup({
			enhance: () => enhancement.promise,
			initialHtml: "",
		});

		act(() => current.session.schedule(request("# Empty response"), true));
		await act(async () => {
			current.responses[0]?.resolve({
				editMap: {
					version: 1,
					coordinate: "line",
					signature: "# Empty response",
					blocks: [],
				},
				features: {},
				html: safeHtml(""),
			});
			await Promise.resolve();
		});

		expect(current.surface.getAttribute("aria-busy")).toBe("true");
		expect(current.surface.querySelector('[role="status"]')?.textContent).toBe(
			messages.loading,
		);

		await act(async () => {
			enhancement.resolve();
			await enhancement.promise;
		});

		expect(current.surface.getAttribute("aria-busy")).toBe("false");
		expect(current.surface.querySelector('[role="status"]')).toBeNull();
		expect(current.surface.innerHTML).toBe("");
	});

	it("preserves a failed non-empty request when leaving empty paper mode", async () => {
		const statuses: PreviewSurfaceStatus[] = [];
		const current = setup({
			initialHtml: "",
			onStatusChange: (status) => statuses.push(status),
		});

		act(() => {
			current.session.schedule(request("# Failure"), true);
			current.setEmptyMode("paper");
		});
		await act(async () => {
			current.responses[0]?.reject(new Error("private response detail"));
			await Promise.resolve();
		});
		act(() => current.setEmptyMode("message"));

		expect(current.surface.textContent).toBe(messages.error);
		expect(statuses[statuses.length - 1]).toBe("error");
		expect(current.surface.textContent).not.toBe(messages.empty);
	});

	it("keeps the previously committed snapshot available while the next request is loading", async () => {
		const { session, surface } = setup();
		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			session.schedule(request("# Updated"), true);
		});

		expect(surface.getAttribute("aria-busy")).toBe("true");
		expect(surface.getAttribute("data-easymde-preview-refreshing")).toBe("1");
		expect(surface.getAttribute("data-easymde-preview-accepted")).toBe("1");
		expect(surface.textContent).toContain("Initial preview");
		expect(surface.querySelector('[role="status"]')).toBeNull();
	});

	it("keeps the previous accepted HTML visible while the next response is pending", async () => {
		const current = setup({ initialHtml: "<p>Stable preview</p>" });
		await act(async () => {
			await Promise.resolve();
		});
		act(() => current.session.schedule(request("# New version", "new"), true));

		expect(current.surface.innerHTML).toBe("<p>Stable preview</p>");
		expect(current.surface.getAttribute("aria-busy")).toBe("true");
		expect(
			current.surface.getAttribute("data-easymde-preview-refreshing"),
		).toBe("1");
		expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
			"1",
		);
		expect(current.surface.querySelector('[role="status"]')).toBeNull();
	});

	it("keeps only the previous enhanced snapshot accepted until its replacement commits", async () => {
		const enhancement = deferred<void>();
		const current = setup({
			enhance: vi
				.fn()
				.mockImplementationOnce(() => Promise.resolve())
				.mockImplementationOnce(() => enhancement.promise),
			initialHtml: "<p>Stable preview</p>",
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
			"1",
		);

		act(() =>
			current.session.schedule(request("# Replacement", "replacement"), true),
		);
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>Unenhanced replacement</p>"),
				features: {},
			});
			await Promise.resolve();
		});

		expect(current.surface.textContent).toContain("Stable preview");
		expect(current.surface.textContent).not.toContain("Unenhanced replacement");
		expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
			"1",
		);

		await act(async () => {
			enhancement.resolve();
			await enhancement.promise;
		});
		expect(current.surface.textContent).toContain("Unenhanced replacement");
		expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
			"1",
		);
		expect(current.surface.getAttribute("aria-busy")).toBe("false");
	});

	it("renders accessible empty and error states without reporting readiness", async () => {
		const empty = setup();
		act(() => {
			empty.session.schedule(request(""), true);
		});
		expect(empty.surface.textContent).toBe(messages.empty);
		expect(empty.surface.getAttribute("aria-busy")).toBe("false");
		expect(empty.surface.easymdePreviewSignature).toBe("");

		const failed = setup();
		act(() => {
			failed.session.schedule(request("# Failure"), true);
		});
		await act(async () => {
			failed.responses[0]?.reject(new Error("private response detail"));
			await Promise.resolve();
		});
		expect(failed.surface.textContent).toBe(messages.error);
		expect(failed.surface.getAttribute("aria-busy")).toBe("false");
		expect(failed.surface.easymdePreviewSignature).toBe("");
	});

	it("marks a successful response ready only after enhancement completes", async () => {
		const enhancement = deferred<void>();
		const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
			() => enhancement.promise,
		);
		const statuses: PreviewSurfaceStatus[] = [];
		const current = setup({
			enhance,
			initialHtml: "",
			onStatusChange: (status) => statuses.push(status),
		});

		act(() => {
			current.session.schedule(request("# Current", "current-signature"), true);
		});
		expect(statuses[statuses.length - 1]).toBe("loading");
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<pre><code>const current = true;</code></pre>"),
				features: { syntaxHighlight: true },
			});
			await Promise.resolve();
		});

		expect(enhance).toHaveBeenCalledTimes(1);
		expect(enhance.mock.calls[0]?.[3]).toEqual(
			expect.objectContaining({ codeTheme: "atom-one-dark" }),
		);
		expect(current.surface.getAttribute("aria-busy")).toBe("true");
		expect(current.surface.textContent).toContain("const current = true;");
		expect(current.surface.easymdePreviewSignature).toBe("");
		expect(statuses[statuses.length - 1]).toBe("loading");

		await act(async () => {
			enhancement.resolve();
			await enhancement.promise;
		});
		expect(current.surface.getAttribute("aria-busy")).toBe("false");
		expect(current.surface.easymdePreviewSignature).toBe("current-signature");
		expect(statuses[statuses.length - 1]).toBe("ready");
	});

	it("retains the previous HTML until the accepted candidate is committed", async () => {
		const enhancement = deferred<void>();
		const initialHtml = "<p>Stable enhanced Preview</p>";
		const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
			if (enhance.mock.calls.length === 1) return Promise.resolve();
			expect(candidate.tagName).toBe("DIV");
			expect(
				candidate
					.closest(".easymde-immersive-preview-canvas")
					?.querySelectorAll("article"),
			).toHaveLength(1);
			expect(candidate.isConnected).toBe(true);
			expect(candidate.getAttribute("aria-hidden")).toBe("true");
			expect(candidate.hasAttribute("inert")).toBe(true);
			expect(candidate.hasAttribute("tabindex")).toBe(false);
			expect(candidate.hasAttribute("contenteditable")).toBe(false);
			expect(candidate.hasAttribute("role")).toBe(false);
			expect(candidate.hasAttribute("aria-live")).toBe(false);
			expect(
				candidate.querySelector('[data-easymde-visual-block-id="b0"]')
					?.textContent,
			).toBe("Candidate Preview");
			return enhancement.promise;
		});
		const current = setup({ enhance, initialHtml });
		const activeIdentity = current.surface;

		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			current.session.schedule(request("# Candidate", "candidate"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>Candidate Preview</p>"),
				features: {},
			});
			await Promise.resolve();
		});

		expect(current.surface).toBe(activeIdentity);
		expect(current.surface.innerHTML).toBe(initialHtml);
		expect(current.surface.getAttribute("aria-busy")).toBe("true");
		expect(current.surface.easymdePreviewSignature).toBe("");

		await act(async () => {
			enhancement.resolve();
			await enhancement.promise;
		});

		expect(current.surface).toBe(activeIdentity);
		expect(current.surface.innerHTML).toBe(
			'<p data-easymde-visual-block-id="b0">Candidate Preview</p>',
		);
	});

	it("does not let a parent rerender roll back a committed enhanced sink", async () => {
		const current = setup({
			initialHtml: "<p>Stable</p>",
			enhance: async (candidate) => {
				candidate.querySelector("p")?.setAttribute("data-enhanced", "1");
			},
		});
		await act(async () => {
			await Promise.resolve();
		});

		const setInnerHTML = vi.spyOn(current.surface, "innerHTML", "set");
		expect(current.surface.innerHTML).toBe('<p data-enhanced="1">Stable</p>');
		current.rerender();

		expect(current.surface.innerHTML).toBe('<p data-enhanced="1">Stable</p>');
		expect(setInnerHTML).not.toHaveBeenCalled();
		setInnerHTML.mockRestore();
	});

	it("preheats an inert connected staging surface while retaining the active preview", async () => {
		const enhancement = deferred<void>();
		let enhancementCalls = 0;
		const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
			enhancementCalls += 1;
			if (1 === enhancementCalls) return Promise.resolve();
			expect(candidate.isConnected).toBe(true);
			expect(candidate.getAttribute("aria-hidden")).toBe("true");
			expect(candidate.hasAttribute("inert")).toBe(true);
			expect(candidate.matches("[data-easymde-preview-html-sink]")).toBe(false);
			return enhancement.promise;
		});
		const current = setup({
			enhance,
			initialHtml: "<p>Stable</p>",
		});
		await act(async () => {
			await Promise.resolve();
		});

		const setInnerHTML = vi.spyOn(current.surface, "innerHTML", "set");
		act(() => {
			current.session.schedule(request("candidate", "candidate"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>Candidate</p>"),
				features: {},
			});
			await Promise.resolve();
		});

		expect(current.surface.innerHTML).toBe("<p>Stable</p>");
		expect(setInnerHTML).not.toHaveBeenCalled();
		await act(async () => {
			enhancement.resolve();
			await enhancement.promise;
		});

		expect(current.surface.innerHTML).toBe(
			'<p data-easymde-visual-block-id="b0">Candidate</p>',
		);
		expect(setInnerHTML).not.toHaveBeenCalled();
		expect(
			current.surface.parentElement?.querySelectorAll(
				"[data-easymde-preview-staging]",
			),
		).toHaveLength(0);
		setInnerHTML.mockRestore();
	});

	it("keeps initial server HTML unaccepted while enhancement is pending", async () => {
		const enhancement = deferred<void>();
		const current = setup({
			enhance: () => enhancement.promise,
			initialHtml: "",
		});
		act(() => current.session.schedule(request("# First Preview"), true));
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>First safe preview</p>"),
				features: {},
			});
			await Promise.resolve();
		});

		expect(current.surface.textContent).toBe("First safe preview");
		expect(current.surface.getAttribute("aria-busy")).toBe("true");
		expect(
			current.surface.getAttribute("data-easymde-preview-accepted"),
		).toBeNull();
		expect(current.surface.easymdePreviewSignature).toBe("");

		await act(async () => {
			enhancement.resolve();
			await enhancement.promise;
		});
		expect(current.surface.easymdePreviewSignature).toBe("# First Preview");
		expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
			"1",
		);
	});

	it("yields connected staging when elapsed work reaches its time budget", async () => {
		const firstYield = deferred<void>();
		let clockReads = 0;
		let releaseFirstYield = true;
		const stagingScheduler = {
			now: () => {
				clockReads += 1;
				return clockReads * 3;
			},
			yield: vi.fn(() => {
				if (releaseFirstYield) {
					releaseFirstYield = false;
					return firstYield.promise;
				}
				return Promise.resolve();
			}),
		};
		const totalNodes = 130;
		const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
			async (candidate) => {
				expect(candidate.isConnected).toBe(true);
				expect(candidate.childElementCount).toBe(totalNodes);
			},
		);
		const current = setup({
			enhance,
			initialHtml: "<p>Stable</p>",
			stagingScheduler,
		});
		await act(async () => {
			await Promise.resolve();
		});
		enhance.mockClear();

		const activeChild = current.surface.firstChild;
		const setInnerHTML = vi.spyOn(current.surface, "innerHTML", "set");
		const stagingMutations: MutationRecord[] = [];
		const stagingObserver = new MutationObserver((records) => {
			stagingMutations.push(
				...records.filter(
					(record) =>
						record.target instanceof HTMLElement &&
						record.target.hasAttribute("data-easymde-preview-staging"),
				),
			);
		});
		stagingObserver.observe(current.canvas, { childList: true, subtree: true });
		act(() => {
			current.session.schedule(request("large", "large"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml(
					Array.from(
						{ length: totalNodes },
						(_, index) => `<p>node-${index}</p>`,
					).join(""),
				),
				features: {},
			});
			await Promise.resolve();
		});

		const staging = current.canvas.querySelector<HTMLElement>(
			"[data-easymde-preview-staging]",
		);
		expect(staging).not.toBeNull();
		expect(staging?.isConnected).toBe(true);
		expect(staging?.childElementCount).toBe(3);
		expect(staging?.childElementCount).toBeLessThan(totalNodes);
		expect(stagingScheduler.yield).toHaveBeenCalledOnce();
		stagingMutations.push(
			...stagingObserver
				.takeRecords()
				.filter((record) => record.target === staging),
		);
		stagingObserver.disconnect();
		expect(
			stagingMutations.filter((record) => record.target === staging),
		).toHaveLength(1);
		expect(stagingMutations[0]?.addedNodes).toHaveLength(3);
		expect(enhance).not.toHaveBeenCalled();
		expect(current.surface.firstChild).toBe(activeChild);
		expect(setInnerHTML).not.toHaveBeenCalled();

		await act(async () => {
			firstYield.resolve();
			await firstYield.promise;
		});

		expect(enhance).toHaveBeenCalledOnce();
		expect(current.surface.querySelectorAll("p")).toHaveLength(totalNodes);
		expect(
			current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
		).toHaveLength(0);
		expect(setInnerHTML).not.toHaveBeenCalled();
		setInnerHTML.mockRestore();
	});

	it("aborts a staging batch before enhancement and removes its connected candidate", async () => {
		const firstYield = deferred<void>();
		let clockReads = 0;
		let firstBatch = true;
		const stagingScheduler = {
			now: () => {
				clockReads += 1;
				return clockReads * 3;
			},
			yield: vi.fn(() => {
				if (firstBatch) {
					firstBatch = false;
					return firstYield.promise;
				}
				return Promise.resolve();
			}),
		};
		let enhancedText = "";
		const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
			async (candidate) => {
				enhancedText = candidate.textContent ?? "";
			},
		);
		const current = setup({
			enhance,
			initialHtml: "<p>Stable</p>",
			stagingScheduler,
		});
		await act(async () => {
			await Promise.resolve();
		});
		enhance.mockClear();

		act(() => {
			current.session.schedule(request("stale", "stale"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml(
					Array.from(
						{ length: 130 },
						(_, index) => `<p>stale-${index}</p>`,
					).join(""),
				),
				features: {},
			});
			await Promise.resolve();
		});
		expect(
			current.canvas.querySelector("[data-easymde-preview-staging]"),
		).not.toBeNull();

		act(() => {
			current.session.schedule(request("current", "current"), true);
		});
		await act(async () => {
			current.responses[1]?.resolve({
				html: safeHtml("<p>Current</p>"),
				features: {},
			});
			await Promise.resolve();
		});
		firstYield.resolve();
		await act(async () => {
			await firstYield.promise;
			await Promise.resolve();
		});

		expect(enhance).toHaveBeenCalledOnce();
		expect(enhancedText).toBe("Current");
		expect(current.surface.textContent).toBe("Current");
		expect(
			current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
		).toHaveLength(0);
	});

	it("synchronizes layout-dependent code-frame styles only after the candidate commits", async () => {
		const syncSurfaces: HTMLElement[] = [];
		const phases: string[] = [];
		const current = setup({
			initialHtml: "<p>Stable</p>",
			enhance: async (candidate) => {
				phases.push("enhance");
				const code = candidate.ownerDocument.createElement("code");
				code.className = "hljs";
				const pre = candidate.ownerDocument.createElement("pre");
				pre.append(code);
				candidate.append(pre);
			},
		});
		vi.mocked(
			current.enhancementPort.syncCodeFrameBackgrounds,
		).mockImplementation((surface: HTMLElement) => {
			phases.push("sync");
			syncSurfaces.push(surface);
			expect(surface).toBe(current.surface);
			expect(surface.isConnected).toBe(true);
		});

		await act(async () => {
			await Promise.resolve();
		});
		syncSurfaces.length = 0;
		phases.length = 0;
		act(() => {
			current.session.schedule(request("code", "code"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<pre><code>code</code></pre>"),
				features: { syntaxHighlight: true },
			});
			await Promise.resolve();
		});
		expect(phases).toEqual(["enhance", "sync"]);
		expect(syncSurfaces).toEqual([current.surface]);
	});

	it("restores identical server HTML before enhancing a newer response", async () => {
		const enhancementInputs: string[] = [];
		const current = setup({
			initialHtml: "",
			enhance: async (surface) => {
				const code = surface.querySelector("pre > code");
				if (!(code instanceof HTMLElement)) throw new Error("code missing");
				enhancementInputs.push(code.innerHTML);
				code.classList.add("hljs");
				code.dataset.highlighted = "yes";
				code.dataset.easymdeHighlighted = "1";
				code.innerHTML = '<span class="hljs-keyword">const</span> value = 1;';
			},
		});
		const html = safeHtml(
			'<pre><code class="language-js">const value = 1;</code></pre>',
		);

		act(() =>
			current.session.schedule(
				request("```js\nconst value = 1;\n```", "first"),
				true,
			),
		);
		await act(async () => {
			current.responses[0]?.resolve({
				features: { syntaxHighlight: true },
				html,
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		act(() =>
			current.session.schedule(
				{
					...request("```js\nconst value = 1;\n```", "second"),
					codeTheme: "github",
				},
				true,
			),
		);
		await act(async () => {
			current.responses[1]?.resolve({
				features: { syntaxHighlight: true },
				html,
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(enhancementInputs).toEqual(["const value = 1;", "const value = 1;"]);
	});

	it("hands enhanced Preview markup with Markdown sources attached", async () => {
		const onHtmlChange = vi.fn();
		const current = setup({
			initialHtml: "",
			onHtmlChange,
			enhance: async (surface) => {
				const math = surface.querySelector<HTMLElement>(".easymde-math");
				if (math) {
					math.innerHTML = '<span class="katex">rendered math</span>';
					math.dataset.easymdeRendered = "1";
				}
				const mermaid = surface.querySelector(
					"pre:has(> code.language-mermaid)",
				);
				mermaid?.replaceWith(
					Object.assign(document.createElement("div"), {
						className: "easymde-mermaid",
						innerHTML: "<svg><text>rendered diagram</text></svg>",
					}),
				);
			},
		});

		act(() => {
			current.session.schedule(request("# Enhanced", "enhanced"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				features: { math: true, mermaid: true },
				html: safeHtml(
					[
						'<div class="easymde-math easymde-math-block">$$x^2$$</div>',
						'<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>',
					].join(""),
				),
			});
			await Promise.resolve();
		});

		expect(onHtmlChange).toHaveBeenCalledOnce();
		const enhanced = document.createElement("article");
		enhanced.innerHTML = onHtmlChange.mock.calls[0]?.[0] ?? "";
		expect(enhanced.querySelector(".katex")).not.toBeNull();
		expect(
			enhanced
				.querySelector(".easymde-math")
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("$$x^2$$");
		expect(enhanced.querySelector(".easymde-mermaid svg")).not.toBeNull();
		expect(
			enhanced
				.querySelector(".easymde-mermaid")
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("flowchart TD\nA-->B");
	});

	it("keeps each visual Markdown source attached when enhancement changes node counts", async () => {
		const onHtmlChange = vi.fn();
		const current = setup({
			initialHtml: "",
			onHtmlChange,
			enhance: async (surface) => {
				for (const math of surface.querySelectorAll<HTMLElement>(
					".easymde-math",
				)) {
					math.innerHTML = `<span class="katex">${math.dataset.case}</span>`;
					math.dataset.easymdeRendered = "1";
				}
				for (const code of surface.querySelectorAll<HTMLElement>(
					"pre > code.language-mermaid",
				)) {
					const replacement = document.createElement("div");
					replacement.className = "easymde-mermaid";
					replacement.dataset.case = code.dataset.case;
					replacement.innerHTML = `<svg><text>${code.dataset.case}</text></svg>`;
					code.parentElement?.replaceWith(replacement);
				}

				const extraMath = document.createElement("div");
				extraMath.className = "easymde-math";
				extraMath.dataset.case = "extra-math";
				const extraMermaid = document.createElement("div");
				extraMermaid.className = "easymde-mermaid";
				extraMermaid.dataset.case = "extra-mermaid";
				surface.prepend(extraMath, extraMermaid);
			},
		});

		act(() => {
			current.session.schedule(request("# Enhanced", "enhanced"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				features: { math: true, mermaid: true },
				html: safeHtml(
					[
						'<div class="easymde-math" data-case="math-one">$$one$$</div>',
						'<pre><code class="language-mermaid" data-case="mermaid-one">flowchart TD\nA--&gt;B</code></pre>',
						'<div class="easymde-math" data-case="math-two">$$two$$</div>',
						'<pre><code class="language-mermaid" data-case="mermaid-two">flowchart TD\nC--&gt;D</code></pre>',
					].join(""),
				),
			});
			await Promise.resolve();
		});

		const enhanced = document.createElement("article");
		enhanced.innerHTML = onHtmlChange.mock.calls[0]?.[0] ?? "";
		expect(
			enhanced
				.querySelector('[data-case="extra-math"]')
				?.hasAttribute("data-easymde-visual-markdown-source"),
		).toBe(false);
		expect(
			enhanced
				.querySelector('[data-case="extra-mermaid"]')
				?.hasAttribute("data-easymde-visual-markdown-source"),
		).toBe(false);
		expect(
			enhanced
				.querySelector('[data-case="math-one"]')
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("$$one$$");
		expect(
			enhanced
				.querySelector('[data-case="math-two"]')
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("$$two$$");
		expect(
			enhanced
				.querySelector('[data-case="mermaid-one"]')
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("flowchart TD\nA-->B");
		expect(
			enhanced
				.querySelector('[data-case="mermaid-two"]')
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("flowchart TD\nC-->D");
	});

	it("removes visual source markers when enhanced output no longer matches its source", async () => {
		const current = setup({
			enhance: async (surface) => {
				surface
					.querySelector(".easymde-math")
					?.replaceWith(document.createElement("p"));
			},
			initialHtml: "",
		});

		act(() => {
			current.session.schedule(request("$x$", "mismatched"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				features: { math: true },
				html: safeHtml('<span class="easymde-math">$x$</span>'),
			});
			await Promise.resolve();
		});

		expect(visualSourceMarkerCount(current.surface)).toBe(0);
		expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
			"1",
		);
		expect(current.onDiagnostic).toHaveBeenCalledWith(
			"preview-enhancement-visual-source-missing",
		);
	});

	it("does not bind visual Markdown sources that are nested inside code", async () => {
		const current = setup({
			enhance: async (surface) => {
				const code = surface.querySelector("pre > code");
				if (!code) throw new Error("preview-enhancement-code-missing");
				code.innerHTML = '<span class="hljs-string">printf "$x$"</span>';
				surface
					.querySelector(".easymde-math:not(pre .easymde-math)")
					?.setAttribute("data-easymde-rendered", "1");
			},
			initialHtml: "",
		});

		act(() => {
			current.session.schedule(request("code and math", "code-and-math"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				features: { math: true, syntaxHighlight: true },
				html: safeHtml(
					'<pre><code class="language-bash"><span class="easymde-math">$x$</span></code></pre>' +
						'<div class="easymde-math">$$real$$</div>',
				),
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(current.onDiagnostic).not.toHaveBeenCalled();
		expect(
			current.surface.getAttribute("data-easymde-preview-error"),
		).toBeNull();
		expect(
			current.surface
				.querySelector(".easymde-math")
				?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("$$real$$");
	});

	it("preserves the stable visual-source diagnostic when enhanced output loses a source node", async () => {
		const onDiagnostic = vi.fn();
		const current = setup({
			initialHtml: "",
			onDiagnostic,
			enhance: async (surface) => {
				surface
					.querySelector(".easymde-math")
					?.replaceWith(document.createElement("p"));
			},
		});

		act(() => {
			current.session.schedule(request("$x$", "visual-source-missing"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				features: { math: true },
				html: safeHtml('<div class="easymde-math">$x$</div>'),
			});
			await Promise.resolve();
		});

		expect(onDiagnostic).toHaveBeenCalledWith(
			"preview-enhancement-visual-source-missing",
		);
	});

	it("reports empty and failed states instead of retaining a stale ready status", async () => {
		const statuses: PreviewSurfaceStatus[] = [];
		const current = setup({
			onStatusChange: (status) => statuses.push(status),
		});
		await act(async () => {});
		expect(statuses[statuses.length - 1]).toBe("ready");

		act(() => current.session.schedule(request(""), true));
		expect(statuses[statuses.length - 1]).toBe("empty");

		act(() => current.session.schedule(request("# Failure"), true));
		expect(statuses[statuses.length - 1]).toBe("loading");
		await act(async () => {
			current.responses[0]?.reject(new Error("private response detail"));
			await Promise.resolve();
		});
		expect(statuses[statuses.length - 1]).toBe("error");
	});

	it("does not let stale enhancement completion mark a newer response ready", async () => {
		const firstEnhancement = deferred<void>();
		const enhance = vi
			.fn<PreviewEnhancementPort["enhance"]>()
			.mockImplementationOnce(() => firstEnhancement.promise)
			.mockResolvedValueOnce(undefined);
		const current = setup({ enhance, initialHtml: "" });

		act(() => {
			current.session.schedule(request("# First", "first"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml('<span class="easymde-math">$first$</span>'),
				features: { math: true },
			});
			await Promise.resolve();
		});
		expect(visualSourceMarkerCount(current.surface)).toBe(0);
		const firstIsCurrent = enhance.mock.calls[0]?.[2];
		expect(firstIsCurrent?.()).toBe(true);
		act(() => {
			current.session.schedule(request("# Second", "second"), true);
		});
		expect(firstIsCurrent?.()).toBe(false);
		expect(visualSourceMarkerCount(current.surface)).toBe(0);
		await act(async () => {
			current.responses[1]?.resolve({
				html: safeHtml("<p>Second</p>"),
				features: {},
			});
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			firstEnhancement.resolve();
			await firstEnhancement.promise;
		});

		expect(current.surface.textContent).toBe("Second");
		expect(current.surface.easymdePreviewSignature).toBe("second");
		expect(
			current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
		).toHaveLength(0);
	});

	it("captures and restores the canvas scroll position after replacing HTML", async () => {
		const capture = vi.fn<PreviewScrollPort["capture"]>((surface) => ({
			left: surface.scrollLeft,
			ratio: 0,
			top: surface.scrollTop,
		}));
		const restore = vi.fn<PreviewScrollPort["restore"]>((surface, snapshot) => {
			surface.scrollLeft = snapshot.left;
			surface.scrollTop = snapshot.top;
		});
		const current = setup({ scrollPort: { capture, restore } });
		current.canvas.scrollLeft = 9;
		current.canvas.scrollTop = 42;

		act(() => {
			current.session.schedule(request("# Updated", "updated"), true);
		});
		current.canvas.scrollLeft = 12;
		current.canvas.scrollTop = 78;
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>Updated</p>"),
				features: {},
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(capture).toHaveBeenCalledWith(current.canvas);
		expect(restore).toHaveBeenCalledWith(current.canvas, {
			left: 12,
			ratio: 0,
			top: 78,
		});
		expect(current.canvas.scrollLeft).toBe(12);
		expect(current.canvas.scrollTop).toBe(78);
		expect(current.surface.textContent).toBe("Updated");
	});

	it("discards pending scroll restoration after empty, error, and failed requests", async () => {
		const restore = vi.fn<PreviewScrollPort["restore"]>();
		const current = setup({
			enhance: vi.fn().mockRejectedValue(new Error("enhancement failed")),
			initialHtml: "",
			scrollPort: {
				capture: (surface) => ({
					left: surface.scrollLeft,
					ratio: 0,
					top: surface.scrollTop,
				}),
				restore,
			},
		});

		act(() => current.session.schedule(request(""), true));
		expect(restore).not.toHaveBeenCalled();

		act(() => current.session.schedule(request("# Request error"), true));
		await act(async () => {
			current.responses[0]?.reject(new Error("private response detail"));
			await Promise.resolve();
		});
		expect(current.surface.textContent).toBe(messages.error);
		expect(restore).not.toHaveBeenCalled();

		act(() => current.session.schedule(request("# Enhancement error"), true));
		await act(async () => {
			current.responses[1]?.resolve({
				html: safeHtml("<p>Enhancement failure</p>"),
				features: {},
			});
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
			"1",
		);
		expect(restore).not.toHaveBeenCalled();
	});

	it("ignores superseded enhancement completion and does not restore after teardown", async () => {
		const firstEnhancement = deferred<void>();
		const secondEnhancement = deferred<void>();
		const enhance = vi
			.fn<PreviewEnhancementPort["enhance"]>()
			.mockImplementationOnce(() => firstEnhancement.promise)
			.mockImplementationOnce(() => secondEnhancement.promise);
		const restore = vi.fn<PreviewScrollPort["restore"]>();
		const current = setup({
			enhance,
			initialHtml: "",
			scrollPort: {
				capture: (surface) => ({
					left: surface.scrollLeft,
					ratio: 0,
					top: surface.scrollTop,
				}),
				restore,
			},
		});

		act(() =>
			current.session.schedule(request("# First", "first-scroll"), true),
		);
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>First</p>"),
				features: {},
			});
			await Promise.resolve();
		});
		expect(enhance).toHaveBeenCalledTimes(1);

		act(() =>
			current.session.schedule(request("# Second", "second-scroll"), true),
		);
		await act(async () => {
			current.responses[1]?.resolve({
				html: safeHtml("<p>Second</p>"),
				features: {},
			});
			await Promise.resolve();
		});
		expect(enhance).toHaveBeenCalledTimes(2);
		expect(restore).not.toHaveBeenCalled();

		await act(async () => {
			secondEnhancement.resolve();
			await secondEnhancement.promise;
		});
		expect(current.surface.textContent).toBe("Second");
		expect(restore).toHaveBeenCalledOnce();

		current.unmount();
		await act(async () => {
			firstEnhancement.resolve();
			await firstEnhancement.promise;
		});
		expect(restore).toHaveBeenCalledOnce();

		const lateEnhancement = deferred<void>();
		const lateRestore = vi.fn<PreviewScrollPort["restore"]>();
		const lateEnhance = vi.fn<PreviewEnhancementPort["enhance"]>(
			() => lateEnhancement.promise,
		);
		const lateOwner = setup({
			enhance: lateEnhance,
			initialHtml: "",
			scrollPort: {
				capture: (surface) => ({
					left: surface.scrollLeft,
					ratio: 0,
					top: surface.scrollTop,
				}),
				restore: lateRestore,
			},
		});
		act(() => lateOwner.session.schedule(request("# Late owner"), true));
		await act(async () => {
			lateOwner.responses[0]?.resolve({
				html: safeHtml("<p>Late</p>"),
				features: {},
			});
			await Promise.resolve();
		});
		expect(lateEnhance).toHaveBeenCalledOnce();
		lateOwner.unmount();
		await act(async () => {
			lateEnhancement.resolve();
			await lateEnhancement.promise;
		});
		expect(lateRestore).not.toHaveBeenCalled();
	});

	it("keeps sanitized HTML but marks the surface unavailable when enhancement fails", async () => {
		const current = setup({
			enhance: vi.fn().mockRejectedValue(new Error("enhancement failed")),
			initialHtml: "",
		});

		act(() => {
			current.session.schedule(request("```mermaid", "diagram"), true);
		});
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml('<pre class="mermaid">graph TD; A--&gt;B;</pre>'),
				features: { mermaid: true },
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(current.surface.querySelector(".mermaid")).not.toBeNull();
		expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
			"1",
		);
		expect(current.surface.easymdePreviewSignature).toBe("");
		expect(current.onDiagnostic).toHaveBeenCalledWith(
			"preview-enhancement-failed",
		);
		expect(
			current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
		).toHaveLength(0);
	});

	it("reports only sanitized current enhancement failures", async () => {
		const firstEnhancement = deferred<void>();
		const secondEnhancement = deferred<void>();
		const enhance = vi
			.fn<PreviewEnhancementPort["enhance"]>()
			.mockImplementationOnce(() => firstEnhancement.promise)
			.mockImplementationOnce(() => secondEnhancement.promise);
		const current = setup({ enhance, initialHtml: "" });

		act(() => current.session.schedule(request("# First", "first"), true));
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>First</p>"),
				features: { math: true },
			});
			await Promise.resolve();
		});
		act(() => current.session.schedule(request("# Second", "second"), true));
		await act(async () => {
			current.responses[1]?.resolve({
				html: safeHtml("<p>Second</p>"),
				features: { mermaid: true },
			});
			await Promise.resolve();
			firstEnhancement.reject(new Error("preview-enhancement-resource-stale"));
			await Promise.resolve();
		});
		expect(current.onDiagnostic).not.toHaveBeenCalled();
		expect(
			current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
		).toHaveLength(1);

		await act(async () => {
			secondEnhancement.reject(
				new Error("preview-enhancement-runtime-unavailable"),
			);
			await Promise.resolve();
		});
		expect(current.onDiagnostic).toHaveBeenCalledWith(
			"preview-enhancement-runtime-unavailable",
		);
		expect(
			current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
		).toHaveLength(0);
	});

	it("does not report a late enhancement failure after teardown", async () => {
		const enhancement = deferred<void>();
		const current = setup({
			enhance: () => enhancement.promise,
			initialHtml: "",
		});
		act(() => current.session.schedule(request("# Pending"), true));
		await act(async () => {
			current.responses[0]?.resolve({
				html: safeHtml("<p>Pending</p>"),
				features: { math: true },
			});
			await Promise.resolve();
		});

		current.unmount();
		await act(async () => {
			enhancement.reject(new Error("preview-enhancement-resource-load-failed"));
			await Promise.resolve();
		});

		expect(current.onDiagnostic).not.toHaveBeenCalled();
	});

	it("keeps large preview candidates detached during enhancement and skips candidate innerHTML serialization", async () => {
		const fixture = blockFixture(200, "large-non-windowed-preview");
		const enhancement = deferred<void>();
		const enhancementStarted = deferred<HTMLElement>();
		const htmlChanges: SafePreviewHtml[] = [];
		const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
			candidate
				.querySelector('[data-easymde-visual-block-id="b199"]')
				?.setAttribute("data-enhanced", "1");
			enhancementStarted.resolve(candidate);
			return enhancement.promise;
		});
		const current = setup({
			enhance,
			initialHtml: "",
			onHtmlChange: (html) => htmlChanges.push(html),
			stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
		});
		try {
			act(() => {
				current.session.schedule(
					request("# Large Preview", fixture.editMap.signature),
					true,
				);
			});
			let candidate!: HTMLElement;
			await act(async () => {
				current.responses[0]?.resolve({
					editMap: fixture.editMap,
					features: {},
					html: fixture.html,
				});
				await Promise.resolve();
			});
			await act(async () => {
				candidate = await enhancementStarted.promise;
			});

			expect(candidate.isConnected).toBe(false);
			expect(candidate.style.display).toBe("none");
			expect(
				current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
			).toHaveLength(0);
			expect(
				current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
			).toHaveLength(0);

			const innerHtmlGetter = vi.spyOn(candidate, "innerHTML", "get");
			await act(async () => {
				enhancement.resolve();
				await enhancement.promise;
				for (let index = 0; index < 8; index += 1) await Promise.resolve();
			});

			expect(innerHtmlGetter).not.toHaveBeenCalled();
			expect(
				current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
			).toHaveLength(200);
			expect(
				current.surface
					.querySelector('[data-easymde-visual-block-id="b199"]')
					?.getAttribute("data-enhanced"),
			).toBe("1");
			expect(htmlChanges).toEqual([fixture.html]);
			expect(current.surface.easymdePreviewSignature).toBe(
				fixture.editMap.signature,
			);
			innerHtmlGetter.mockRestore();
		} finally {
			current.unmount();
		}
	});
});
