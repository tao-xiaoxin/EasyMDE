import { describe, expect, it, vi } from "vitest";

import { markdownLanguage } from "@codemirror/lang-markdown";

import type {
	PreviewRequest,
	PreviewRequestPort,
	PreviewResponse,
	SafePreviewHtml,
} from "../../contracts/ports/preview-request";
import { createEditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import {
	createEditorSourceLinkQuery,
	type EditorSourceLinkQueryBinding,
	type EditorSourceLinkQuerySession,
	EDITOR_SOURCE_LINK_QUERY_TIMEOUT_MS,
	MAX_EDITOR_SOURCE_LINK_QUERY_BYTES,
} from "./editor-source-link-query";

function safeHtml(value: string): SafePreviewHtml {
	return value as SafePreviewHtml;
}

function binding(
	source: string,
	menuIdentity: object | string = {},
	selection: Readonly<{ end: number; start: number }> = { end: 2, start: 1 },
	revision = 1,
): EditorSourceLinkQueryBinding {
	return {
		menuIdentity,
		revision,
		selection,
		source,
	};
}

function response(
	markdown: string,
	html: string,
	blocks = [
		{ endLine: 1, id: "b17", startLine: 0 },
		{ endLine: 3, id: "b99", startLine: 2 },
	],
): PreviewResponse {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const roots = Array.from(parsed.body.children);
	for (const [index, root] of roots.entries()) {
		const block = blocks[index];
		if (block) root.setAttribute("data-easymde-visual-block-id", block.id);
	}
	return {
		editMap: {
			blocks: blocks.map((block) => ({ ...block, editable: true })),
			coordinate: "line",
			signature: `query:${markdown.length}`,
			version: 1,
		},
		features: {},
		html: safeHtml(parsed.body.innerHTML),
	};
}

function createHarness(
	options: Readonly<{
		current?: () => boolean;
		render?: PreviewRequestPort["render"];
		requestFactory?: (
			input: Readonly<{
				binding: EditorSourceLinkQueryBinding;
				candidate: Readonly<{ source: string }>;
				markdown: string;
			}>,
		) => PreviewRequest;
	}> = {},
): Readonly<{
	notify: ReturnType<typeof vi.fn>;
	render: ReturnType<typeof vi.fn>;
	requestFactory: ReturnType<typeof vi.fn>;
	session: EditorSourceLinkQuerySession;
}> {
	const notify = vi.fn();
	const render = vi.fn(
		options.render ??
			(async (request: PreviewRequest) =>
				response(
					request.markdown,
					'<p><a href="https://actual.test/target">caption</a></p><p>canonical</p>',
				)),
	);
	const requestFactory = vi.fn(
		options.requestFactory ??
			((input) => ({
				customCssId: "",
				codeTheme: "neutral-code",
				markdown: input.markdown,
				markdownTheme: "neutral-source",
				postId: 0,
				signature: `source-link:${input.markdown.length}`,
			})),
	);
	const session = createEditorSourceLinkQuery({
		isCurrent: options.current ?? (() => true),
		notify,
		parser: new DOMParser(),
		previewPort: { render },
		requestFactory,
	});
	return { notify, render, requestFactory, session };
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("createEditorSourceLinkQuery", () => {
	it("returns none for ordinary non-link text without rendering or feedback", () => {
		const { notify, render, session } = createHarness();
		const source = "ordinary text";
		const current = binding(source);

		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}),
		).toEqual({ status: "none" });
		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}),
		).toEqual({ status: "none" });
		expect(render).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});

	it("does not cache a pending block-index gap and retries once it is ready", async () => {
		const source = "[caption](https://source.test)";
		const current = binding(source, "menu-index");
		const { render, session } = createHarness();

		expect(session.ensure({ binding: current, blockIndex: null })).toEqual({
			code: "editor-source-link-block-index-unavailable",
			status: "unavailable",
		});
		expect(session.peek(current)).toEqual({ status: "none" });
		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}).status,
		).toBe("pending");
		await settle();
		expect(render).toHaveBeenCalledOnce();
		expect(session.peek(current)).toMatchObject({ status: "ready" });
	});

	it("queries one isolated inline node and returns the server href", async () => {
		const source = "[caption](https://source.test/original)";
		const current = binding(source, "menu-1", {
			end: source.indexOf("caption") + 3,
			start: source.indexOf("caption") + 1,
		});
		const { render, requestFactory, session } = createHarness();

		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}).status,
		).toBe("pending");
		await settle();

		expect(render).toHaveBeenCalledOnce();
		expect(requestFactory).toHaveBeenCalledOnce();
		const request = requestFactory.mock.calls[0]?.[0];
		expect(request?.markdown).toBe(`${source}\n\n${source}`);
		expect(session.peek(current)).toEqual({
			href: "https://actual.test/target",
			status: "ready",
		});
		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}),
		).toEqual({
			href: "https://actual.test/target",
			status: "ready",
		});
	});

	it.each([
		["<https://source.test/auto>", "https://actual.test/auto"],
		["<person@example.test>", "mailto:person@actual.test"],
		[
			"[标题][引用]\n\n[引用]: https://source.test/ref",
			"https://实际.test/引用",
		],
	])("uses the authoritative Preview result for %s", async (source, href) => {
		const linkOffset = source.startsWith("[")
			? source.indexOf("标题") + 1
			: source.indexOf("source") + 2;
		const current = binding(source, "menu-unicode", {
			end: linkOffset + 2,
			start: linkOffset,
		});
		const { session } = createHarness({
			render: async (request) =>
				response(
					request.markdown,
					`<p><a href="${href}">caption</a></p><p>canonical</p>`,
				),
		});

		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		await settle();
		expect(session.peek(current)).toEqual({ href, status: "ready" });
	});

	// Astra review blockers: a >32 KiB prefix previously switched to a second
	// scanner that truncated legal titles and lost the destination context, so
	// the menu either reported an ownership failure or offered no link actions.
	it.each([
		[
			"caption",
			'[caption](https://example.test "a)b")',
			(snippet: string) => snippet.indexOf("caption") + 1,
		],
		[
			"destination",
			'[caption](https://example.test "a)b")',
			(snippet: string) => snippet.indexOf("example") + 2,
		],
		[
			"angle destination",
			"[caption](<https://example.test/a)b>)",
			(snippet: string) => snippet.indexOf("example") + 2,
		],
	] as const)(
		"keeps a long-paragraph %s caret on the complete owned candidate",
		async (_label, snippet, offset) => {
			const source = `${"ordinary ".repeat(4_000)}${snippet}`;
			const caret = source.indexOf(snippet) + offset(snippet);
			const current = binding(source, "menu-long-source-link", {
				end: caret,
				start: caret,
			});
			const { requestFactory, session } = createHarness({
				render: async (request) =>
					response(
						request.markdown,
						'<p><a href="https://actual.test/title">caption</a></p><p>canonical</p>',
					),
			});

			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(source),
				}).status,
			).toBe("pending");
			await settle();
			expect(requestFactory.mock.calls[0]?.[0]?.markdown).toBe(
				`${snippet}\n\n${source}`,
			);
			expect(session.peek(current)).toEqual({
				href: "https://actual.test/title",
				status: "ready",
			});
		},
	);

	it("answers a long-paragraph prompt from the prepared index without parsing", () => {
		const snippet = '[caption](https://example.test "a)b")';
		const source = `${"ordinary ".repeat(100_000)}${snippet}`;
		expect(source.length).toBeGreaterThan(900_000);
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const parse = vi.spyOn(markdownLanguage.parser, "parse");
		const caret = source.indexOf("caption") + 1;
		const current = binding(source, "menu-cold-index", {
			end: caret,
			start: caret,
		});
		const { session } = createHarness();

		const started = performance.now();
		const state = session.ensure({ binding: current, blockIndex });
		const elapsed = performance.now() - started;
		const parsedInputs = parse.mock.calls.map(([input]) => input);
		parse.mockRestore();

		expect(state.status).toBe("pending");
		expect(parsedInputs).toEqual([]);
		expect(elapsed).toBeLessThan(250);
	});

	it.each([
		"[<https://inner.test>][missing]",
		"[<https://inner.test>]",
		"[<https://inner.test>][]",
	] as const)(
		"keeps the rendered inner autolink ready for the undefined reference %s",
		async (snippet) => {
			const source = `${"ordinary ".repeat(4_000)}${snippet}`;
			const caret = source.indexOf("inner") + 2;
			const current = binding(source, "menu-undefined-reference", {
				end: caret,
				start: caret,
			});
			const { render, requestFactory, session } = createHarness({
				render: async (request) =>
					response(
						request.markdown,
						'<p><a href="https://inner.test">https://inner.test</a></p><p>canonical</p>',
					),
			});

			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(source),
				}).status,
			).toBe("pending");
			await settle();
			expect(render).toHaveBeenCalledOnce();
			expect(requestFactory.mock.calls[0]?.[0]?.markdown).toBe(
				`<https://inner.test>\n\n${source}`,
			);
			expect(session.peek(current)).toEqual({
				href: "https://inner.test",
				status: "ready",
			});
		},
	);

	it("keeps the resolved outer reference ready over its inner autolink", async () => {
		const source = "[<https://inner.test>][ref]\n\n[ref]: https://outer.test";
		const caret = source.indexOf("inner") + 2;
		const current = binding(source, "menu-defined-reference", {
			end: caret,
			start: caret,
		});
		const { requestFactory, session } = createHarness({
			render: async (request) =>
				response(
					request.markdown,
					'<p><a href="https://outer.test">https://inner.test</a></p><p>canonical</p>',
				),
		});

		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		await settle();
		expect(requestFactory.mock.calls[0]?.[0]?.markdown).toBe(
			`[<https://inner.test>][ref]\n\n${source}`,
		);
		expect(session.peek(current)).toEqual({
			href: "https://outer.test",
			status: "ready",
		});
	});

	it("keeps a reference candidate that did not render as a unique link as none", async () => {
		const source = "[caption][ref]\n\n[ref]: https://source.test";
		const caret = source.indexOf("caption") + 1;
		const current = binding(source, "menu-reference-not-rendered", {
			end: caret,
			start: caret,
		});
		const { session } = createHarness({
			render: async (request) =>
				response(
					request.markdown,
					'<p>[caption]<a href="https://inner.test">inner</a>[missing]</p><p>canonical</p>',
				),
		});

		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		await settle();
		expect(session.peek(current)).toEqual({ status: "none" });
	});

	it("keeps a long-paragraph code-span selection as none instead of a failure", async () => {
		const source = `${"ordinary ".repeat(4_000)}\`[caption](https://example.test)\``;
		const caret = source.indexOf("caption") + 1;
		const current = binding(source, "menu-long-code-span", {
			end: caret,
			start: caret,
		});
		const { render, session } = createHarness();

		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}),
		).toEqual({ status: "none" });
		expect(render).not.toHaveBeenCalled();
	});

	it("keeps an undefined reference use-site as normal none rather than failure", async () => {
		const source = "[missing][reference]";
		const current = binding(source, "menu-missing");
		const { session } = createHarness({
			render: async (request) =>
				response(request.markdown, "<p>missing</p><p>canonical</p>"),
		});

		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		await settle();
		expect(session.peek(current)).toEqual({ status: "none" });
	});

	it("keeps a missing inline anchor as an explicit Preview failure", async () => {
		const source = "[missing](https://source.test)";
		const current = binding(source, "menu-inline-missing");
		const { session } = createHarness({
			render: async (request) =>
				response(request.markdown, "<p>missing</p><p>canonical</p>"),
		});

		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		await settle();
		expect(session.peek(current)).toEqual({
			code: "editor-source-link-preview-anchor-missing",
			status: "unavailable",
		});
	});

	it("rejects outside text, images, and generated nodes in the owned block", async () => {
		const source = "[caption](https://source.test)";
		for (const html of [
			'<p>prefix <a href="https://actual.test">caption</a></p><p>canonical</p>',
			'<p><a href="https://actual.test">caption</a><img src="x"></p><p>canonical</p>',
			'<p><a href="https://actual.test">caption</a><span class="easymde-mermaid">generated</span></p><p>canonical</p>',
			'<p><a href="https://actual.test">caption</a><span data-easymde-visual-block-id="foreign">drift</span></p><p>canonical</p>',
		]) {
			const { session } = createHarness({
				render: async (request) => response(request.markdown, html),
			});
			const current = binding(source, html);
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			});
			await settle();
			expect(session.peek(current)).toEqual({
				code: "editor-source-link-preview-ownership-invalid",
				status: "unavailable",
			});
			session.dispose();
		}
	});

	it("requires the owned root marker to match its edit-map block id", async () => {
		const source = "[caption](https://source.test)";
		const current = binding(source, "menu-marker-drift");
		const valid = response(
			`${source}\n\n${source}`,
			'<p><a href="https://actual.test">caption</a></p><p>canonical</p>',
		);
		const parsed = new DOMParser().parseFromString(valid.html, "text/html");
		parsed.body.firstElementChild?.setAttribute(
			"data-easymde-visual-block-id",
			"foreign",
		);
		const { session } = createHarness({
			render: async () => ({
				...valid,
				html: safeHtml(parsed.body.innerHTML),
			}),
		});

		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		await settle();
		expect(session.peek(current)).toEqual({
			code: "editor-source-link-preview-ownership-invalid",
			status: "unavailable",
		});
	});

	it("fails before Preview when the exact UTF-8 query exceeds one MiB", () => {
		const source =
			"[caption](https://source.test)\n" +
			"x".repeat(MAX_EDITOR_SOURCE_LINK_QUERY_BYTES);
		const { render, requestFactory, session } = createHarness();
		const current = binding(source, "menu-too-large", {
			end: 3,
			start: 1,
		});

		expect(
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			}),
		).toEqual({
			code: "editor-source-link-query-too-large",
			status: "unavailable",
		});
		expect(render).not.toHaveBeenCalled();
		expect(requestFactory).not.toHaveBeenCalled();
	});

	it("aborts the prior generation and ignores its late response", async () => {
		let resolveFirst!: (value: PreviewResponse) => void;
		const first = new Promise<PreviewResponse>((resolve) => {
			resolveFirst = resolve;
		});
		const render = vi
			.fn()
			.mockReturnValueOnce(first)
			.mockImplementation(async (request: PreviewRequest) =>
				response(
					request.markdown,
					'<p><a href="https://second.test">caption</a></p><p>canonical</p>',
				),
			);
		const source = "[caption](https://source.test)";
		const firstBinding = binding(source, "first");
		const secondBinding = binding(source, "second", { end: 4, start: 2 });
		const { session } = createHarness({ render });

		session.ensure({
			binding: firstBinding,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		const firstSignal = render.mock.calls[0]?.[1] as AbortSignal;
		session.ensure({
			binding: secondBinding,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		expect(firstSignal.aborted).toBe(true);
		resolveFirst(
			response(
				`${source}\n\n${source}`,
				'<p><a href="https://first.test">caption</a></p><p>canonical</p>',
			),
		);
		await settle();
		expect(session.peek(firstBinding)).toEqual({ status: "none" });
		expect(session.peek(secondBinding)).toEqual({
			href: "https://second.test",
			status: "ready",
		});
	});

	it("does not publish a late result after currentness is lost or the session is disposed", async () => {
		let current = true;
		let resolve!: (value: PreviewResponse) => void;
		const pending = new Promise<PreviewResponse>((next) => {
			resolve = next;
		});
		const { notify, session } = createHarness({
			current: () => current,
			render: () => pending,
		});
		const source = "[caption](https://source.test)";
		const currentBinding = binding(source, "late");
		session.ensure({
			binding: currentBinding,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		current = false;
		resolve(
			response(
				`${source}\n\n${source}`,
				'<p><a href="https://late.test">caption</a></p><p>canonical</p>',
			),
		);
		await settle();
		expect(session.peek(currentBinding)).toEqual({ status: "none" });
		expect(notify).not.toHaveBeenCalled();

		current = true;
		const disposed = binding(source, "disposed");
		session.ensure({
			binding: disposed,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		session.dispose();
		expect(() => session.peek(disposed)).not.toThrow();
		expect(session.peek(disposed)).toEqual({ status: "none" });
	});

	it("exposes readiness, subscription, cancellation, and a real failure code", async () => {
		const listeners: Array<() => void> = [];
		const { notify, session } = createHarness({
			render: () => Promise.reject(new Error("synthetic")),
		});
		const unsubscribe = session.subscribe(() =>
			listeners.push(() => undefined),
		);
		const source = "[caption](https://source.test)";
		const current = binding(source, "failure");
		expect(session.readiness(current)).toEqual({ status: "none" });
		session.ensure({
			binding: current,
			blockIndex: createEditorMarkdownBlockIndex(source),
		});
		expect(session.readiness(current)).toEqual({ status: "pending" });
		await settle();
		expect(session.readiness(current)).toEqual({
			code: "editor-source-link-query-failed",
			status: "unavailable",
		});
		expect(notify).toHaveBeenCalled();
		expect(listeners.length).toBeGreaterThan(0);
		unsubscribe();
		session.cancel(current);
	});

	it("ends an unresolved Preview request with a visible stable timeout", async () => {
		vi.useFakeTimers();
		try {
			const source = "[caption](https://source.test)";
			const current = binding(source, "timeout");
			let requestSignal: AbortSignal | undefined;
			let resolveRender!: (value: PreviewResponse) => void;
			const render = vi.fn((_request: PreviewRequest, signal: AbortSignal) => {
				requestSignal = signal;
				return new Promise<PreviewResponse>((resolve) => {
					resolveRender = resolve;
				});
			});
			const { notify, session } = createHarness({ render });

			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(source),
				}),
			).toEqual({ status: "pending" });
			await settle();
			if (!requestSignal) throw new Error("expected Preview request signal");
			expect(requestSignal.aborted).toBe(false);

			await vi.advanceTimersByTimeAsync(EDITOR_SOURCE_LINK_QUERY_TIMEOUT_MS);

			expect(requestSignal.aborted).toBe(true);
			expect(session.readiness(current)).toEqual({
				code: "editor-source-link-query-timeout",
				status: "unavailable",
			});
			expect(session.peek(current)).toEqual({
				code: "editor-source-link-query-timeout",
				status: "unavailable",
			});
			expect(notify).toHaveBeenCalled();
			resolveRender(
				response(
					`${source}\n\n${source}`,
					'<p><a href="https://late.test">caption</a></p><p>canonical</p>',
				),
			);
			await settle();
			expect(session.readiness(current)).toEqual({
				code: "editor-source-link-query-timeout",
				status: "unavailable",
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
