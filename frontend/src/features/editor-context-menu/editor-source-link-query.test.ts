import { describe, expect, it, vi } from "vitest";

import { markdownLanguage } from "@codemirror/lang-markdown";

import type {
	PreviewRequest,
	PreviewRequestPort,
	PreviewResponse,
	SafePreviewHtml,
} from "../../contracts/ports/preview-request";
import { buildWorkerRoundTripBlockIndex } from "./editor-block-index-worker-round-trip.test-harness";
import { createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex } from "./editor-markdown-block-index";
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

	it("preserves trailing parsing context for paren-protected GFM autolinks and dot-protected emails without weakening ownership validation (Round 31 Track A #4)", async () => {
		// Verbatim `MarkdownRenderer::render_preview()` block-0 outputs for each query prefix.
		const cases: ReadonlyArray<
			Readonly<{
				expectedPrefix: string;
				href: string;
				html0: string;
				needle: string;
				source: string;
			}>
		> = [
			{
				expectedPrefix: "https://x?)",
				href: "https://x?",
				html0: '<p><a href="https://x?">https://x?</a>)</p><p>doc</p>',
				needle: "https://x?",
				source: "![$$x$$](https://x?)",
			},
			{
				expectedPrefix: "https://a.com/b,)",
				href: "https://a.com/b,",
				html0: '<p><a href="https://a.com/b,">https://a.com/b,</a>)</p><p>doc</p>',
				needle: "https://a.com/b,",
				source: "![$$x$$](https://a.com/b,)",
			},
			{
				expectedPrefix: "https://a.com/x!)",
				href: "https://a.com/x!",
				html0: '<p><a href="https://a.com/x!">https://a.com/x!</a>)</p><p>doc</p>',
				needle: "https://a.com/x!",
				source: "![$$x$$](https://a.com/x!)",
			},
			{
				expectedPrefix: "www.example.com?)",
				href: "http://www.example.com?",
				html0:
					'<p><a href="http://www.example.com?">www.example.com?</a>)</p><p>doc</p>',
				needle: "www.example.com?",
				source: "![$$x$$](www.example.com?)",
			},
			{
				expectedPrefix: "https://a.com/a&amp;)",
				href: "https://a.com/a&amp;",
				html0:
					'<p><a href="https://a.com/a&amp;amp;">https://a.com/a&amp;amp;</a>)</p><p>doc</p>',
				needle: "https://a.com/a&amp;",
				source: "![$$x$$](https://a.com/a&amp;)",
			},
			{
				expectedPrefix: "https://a.com/b?)",
				href: "https://a.com/b?",
				html0: '<p><a href="https://a.com/b?">https://a.com/b?</a>)</p><p>doc</p>',
				needle: "https://a.com/b?",
				source: "![$$x$$](https://a.com/b?))",
			},
			{
				expectedPrefix: "a@b.c_.",
				href: "mailto:a@b.c_",
				html0: '<p><a href="mailto:a@b.c_">a@b.c_</a>.</p><p>doc</p>',
				needle: "a@b.c_",
				source: "![$$x$$](a@b.c_.)",
			},
			{
				expectedPrefix: "https://example",
				href: "https://example",
				html0: '<p><a href="https://example">https://example</a></p><p>doc</p>',
				needle: "https://example",
				source: "![$$x$$](https://example.)",
			},
			{
				expectedPrefix: "a@b.c",
				href: "mailto:a@b.c",
				html0: '<p><a href="mailto:a@b.c">a@b.c</a></p><p>doc</p>',
				needle: "a@b.c",
				source: "![$$x$$](a@b.c.)",
			},
			{
				expectedPrefix: "<https://x?>",
				href: "https://x?",
				html0: '<p><a href="https://x?">https://x?</a></p><p>doc</p>',
				needle: "https://x?",
				source: "![$$x$$](<https://x?>)",
			},
		];

		for (const entry of cases) {
			const caret = entry.source.indexOf(entry.needle) + 2;
			const current = binding(entry.source, entry.source, {
				end: caret,
				start: caret,
			});
			const { requestFactory, session } = createHarness({
				render: async (request) => response(request.markdown, entry.html0),
			});
			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(entry.source),
				}).status,
				entry.source,
			).toBe("pending");
			await settle();
			expect(
				requestFactory.mock.calls[0]?.[0]?.markdown,
				`query:${entry.source}`,
			).toBe(`${entry.expectedPrefix}\n\n${entry.source}`);
			expect(session.peek(current), `result:${entry.source}`).toEqual({
				href: entry.href,
				status: "ready",
			});
			session.dispose();
		}

		// Ownership rejection guards: leaked punctuation, prefix text, or extra elements in trailing text stay rejected.
		const parenSource = "![$$x$$](https://x?)";
		const parenCaret = parenSource.indexOf("https://x?") + 2;
		for (const badHtml of [
			'<p><a href="https://x">https://x</a>?)</p><p>doc</p>',
			'<p>lead <a href="https://x?">https://x?</a>)</p><p>doc</p>',
			'<p><a href="https://x?">https://x?</a><em>)</em></p><p>doc</p>',
			'<p><a href="https://x?">https://x?</a></p><p>doc</p>',
		]) {
			const current = binding(parenSource, badHtml, {
				end: parenCaret,
				start: parenCaret,
			});
			const { session } = createHarness({
				render: async (request) => response(request.markdown, badHtml),
			});
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(parenSource),
			});
			await settle();
			expect(session.peek(current), badHtml).toEqual({
				code: "editor-source-link-preview-ownership-invalid",
				status: "unavailable",
			});
			session.dispose();
		}

		// Standalone `https://x?` (cursor on `?`) and masked broken-image destinations never become ready.
		for (const [source, caret] of [
			["https://example.com?", "https://example.com?".length - 1],
			["![$$x$$](`) a@b.c`", "![$$x$$](`) a@b.c`".indexOf("a@b.c") + 2],
			[
				"![$$x$$](x<!--)a@b.c -->",
				"![$$x$$](x<!--)a@b.c -->".indexOf("a@b.c") + 2,
			],
		] as const) {
			const current = binding(source, source, { end: caret, start: caret });
			const { render, session } = createHarness();
			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(source),
				}),
				source,
			).toEqual({ status: "none" });
			expect(render).not.toHaveBeenCalled();
			session.dispose();
		}
	});

	it("handles www.-prefixed emails, inert URL trailing suffixes, and GFM table-cell escaped pipes (Round 32 Track A #2/#4, Track B F2/F3/F4)", async () => {
		// Verbatim `MarkdownRenderer::render_preview()` block-0 outputs for each query prefix.
		const cases: ReadonlyArray<
			Readonly<{
				expectedCandidateSource?: string;
				expectedPrefix: string;
				href: string;
				html0: string;
				needle: string;
				source: string;
			}>
		> = [
			// Track B F2: `www.`-prefixed GFM email autolinks retain EmailAutolinkParser precedence.
			{
				expectedPrefix: "www.a@b.c_.",
				href: "mailto:www.a@b.c_",
				html0:
					'<p><a href="mailto:www.a@b.c_">www.a@b.c_</a>.</p><p>doc</p>',
				needle: "www.a@b.c_",
				source: "![a](b$$x$$) www.a@b.c_.",
			},
			{
				expectedPrefix: "www.a@b.c-.",
				href: "mailto:www.a@b.c-",
				html0:
					'<p><a href="mailto:www.a@b.c-">www.a@b.c-</a>.</p><p>doc</p>',
				needle: "www.a@b.c-",
				source: "![a](b$$x$$) www.a@b.c-.",
			},
			{
				expectedPrefix: "www.a@b.c..",
				href: "mailto:www.a@b.c.",
				html0:
					'<p><a href="mailto:www.a@b.c.">www.a@b.c.</a>.</p><p>doc</p>',
				needle: "www.a@b.c.",
				source: "![a](b$$x$$) www.a@b.c..",
			},
			{
				expectedPrefix: "www.a@b.c_.",
				href: "mailto:www.a@b.c_",
				html0:
					'<p><a href="mailto:www.a@b.c_">www.a@b.c_</a>.</p><p>doc</p>',
				needle: "www.a@b.c_",
				source:
					'| h1 | h2 |\n| - | - |\n| www.a@b.c_. ![a](/i.png "$$x$$") | c |',
			},
			{
				expectedPrefix: "www.a",
				href: "http://www.a",
				html0: '<p><a href="http://www.a">www.a</a></p><p>doc</p>',
				needle: "www.a",
				source: "![a](b$$x$$) www.a@b.c_",
			},
			// Track A #4 + Track B F3: inert synthesized suffixes avoid entity decoding & Markdown formatting.
			{
				expectedPrefix: "https://x/))))aaaa)",
				href: "https://x/))))",
				html0:
					'<p><a href="https://x/))))">https://x/))))</a>aaaa)</p><p>doc</p>',
				needle: "https://x/",
				source: "![$$x$$](z) https://x/))))&lt;)",
			},
			{
				expectedPrefix: "https://example.com?)",
				href: "https://example.com?",
				html0:
					'<p><a href="https://example.com?">https://example.com?</a>)</p><p>doc</p>',
				needle: "example.com",
				source: "![a](b$$x$$) https://example.com?&amp;",
			},
			{
				expectedPrefix: "https://example.com?)",
				href: "https://example.com?",
				html0:
					'<p><a href="https://example.com?">https://example.com?</a>)</p><p>doc</p>',
				needle: "example.com",
				source: "![a](b$$x$$) https://example.com?&lt;",
			},
			{
				expectedPrefix: "https://example.com?)",
				href: "https://example.com?",
				html0:
					'<p><a href="https://example.com?">https://example.com?</a>)</p><p>doc</p>',
				needle: "example.com",
				source: "![a](b$$x$$) https://example.com?&copy;",
			},
			{
				expectedPrefix: "https://example.com?)",
				href: "https://example.com?",
				html0:
					'<p><a href="https://example.com?">https://example.com?</a>)</p><p>doc</p>',
				needle: "example.com",
				source:
					'| h1 | h2 |\n| - | - |\n| https://example.com?&amp; ![a](/i.png "$$x$$") | c |',
			},
			{
				expectedPrefix: "https://example.com?a)))aaa)",
				href: "https://example.com?a)))",
				html0:
					'<p><a href="https://example.com?a)))">https://example.com?a)))</a>aaa)</p><p>doc</p>',
				needle: "example.com",
				source: "![a](b$$x$$) https://example.com?a)))*x*)))))))",
			},
			{
				expectedPrefix: "https://example.com/(a?&easymde;",
				href: "https://example.com/(a?",
				html0:
					'<p><a href="https://example.com/(a?">https://example.com/(a?</a>&amp;easymde;</p><p>doc</p>',
				needle: "example.com",
				source: "![a](b$$x$$) https://example.com/(a?&amp;",
			},
			{
				expectedPrefix: "https://example.com/a)?&easymde;",
				href: "https://example.com/a)?",
				html0:
					'<p><a href="https://example.com/a)?">https://example.com/a)?</a>&amp;easymde;</p><p>doc</p>',
				needle: "example.com",
				source: "![a](b$$x$$) https://example.com/a)?&amp;",
			},
			// Track A #2 + Track B F4: GFM table-cell `\|` and `\\|` unescaping in Preview queries.
			{
				expectedCandidateSource: "<https://a\\|b.com>",
				expectedPrefix: "<https://a|b.com>",
				href: "https://a%7Cb.com",
				html0:
					'<p><a href="https://a%7Cb.com">https://a|b.com</a></p><p>doc</p>',
				needle: "https://a",
				source: "![$$x$$](<https://a\\|b.com>) | c\n| - | - |",
			},
			{
				expectedCandidateSource: "<https://example.com/a\\|b>",
				expectedPrefix: "<https://example.com/a|b>",
				href: "https://example.com/a%7Cb",
				html0:
					'<p><a href="https://example.com/a%7Cb">https://example.com/a|b</a></p><p>doc</p>',
				needle: "example.com",
				source:
					'| h1 | h2 |\n| - | - |\n| <https://example.com/a\\|b> ![a](/i.png "$$x$$") | c |',
			},
			{
				expectedCandidateSource: "[foo\\|bar]",
				expectedPrefix: "[foo|bar]",
				href: "https://pipe-ref.example",
				html0:
					'<p><a href="https://pipe-ref.example">foo|bar</a></p><p>doc</p>',
				needle: "foo",
				source:
					'| h1 | h2 |\n| - | - |\n| [foo\\|bar] ![a](/i.png "$$x$$") | c |\n\n[foo|bar]: https://pipe-ref.example',
			},
			{
				expectedCandidateSource: "[lbl][foo\\|bar]",
				expectedPrefix: "[lbl][foo|bar]",
				href: "https://pipe-ref.example",
				html0: '<p><a href="https://pipe-ref.example">lbl</a></p><p>doc</p>',
				needle: "lbl",
				source:
					'| h1 | h2 |\n| - | - |\n| [lbl][foo\\|bar] ![a](/i.png "$$x$$") | c |\n\n[foo|bar]: https://pipe-ref.example',
			},
			{
				expectedCandidateSource: "https://a\\|b.com",
				expectedPrefix: "https://a|b.com",
				href: "https://a%7Cb.com",
				html0:
					'<p><a href="https://a%7Cb.com">https://a|b.com</a></p><p>doc</p>',
				needle: "https://a",
				source: "![$$x$$](https://a\\|b.com) | c\n| - | - |",
			},
			{
				expectedCandidateSource: "https://example.com/a",
				expectedPrefix: "https://example.com/a",
				href: "https://example.com/a",
				html0:
					'<p><a href="https://example.com/a">https://example.com/a</a></p><p>doc</p>',
				needle: "example.com",
				source: "| https://example.com/a\\|b |\n| - |",
			},
			{
				expectedCandidateSource: "<https://a\\|b.com>",
				expectedPrefix: "<https://a|b.com>",
				href: "https://a%7Cb.com",
				html0:
					'<p><a href="https://a%7Cb.com">https://a|b.com</a></p><p>doc</p>',
				needle: "https://a",
				source: "| <https://a\\|b.com> |\n| - |",
			},
			{
				expectedCandidateSource: "[foo\\|bar]",
				expectedPrefix: "[foo|bar]",
				href: "https://pipe-ref.example",
				html0:
					'<p><a href="https://pipe-ref.example">foo|bar</a></p><p>doc</p>',
				needle: "foo",
				source: "| [foo\\|bar] |\n| - |\n\n[foo|bar]: https://pipe-ref.example",
			},
			{
				expectedCandidateSource: "[lbl](https://example.com/a\\|b)",
				expectedPrefix: "[lbl](https://example.com/a|b)",
				href: "https://example.com/a%7Cb",
				html0:
					'<p><a href="https://example.com/a%7Cb">lbl</a></p><p>doc</p>',
				needle: "lbl",
				source: "| [lbl](https://example.com/a\\|b) |\n| - |",
			},
			{
				expectedCandidateSource: "<https://a\\\\|b.com>",
				expectedPrefix: "<https://a\\|b.com>",
				href: "https://a%5C%7Cb.com",
				html0:
					'<p><a href="https://a%5C%7Cb.com">https://a\\|b.com</a></p><p>doc</p>',
				needle: "https://a",
				source: "| <https://a\\\\|b.com> |\n| - |",
			},
			{
				expectedCandidateSource: "[lbl](https://example.com/a\\\\|b)",
				expectedPrefix: "[lbl](https://example.com/a\\|b)",
				href: "https://example.com/a%7Cb",
				html0:
					'<p><a href="https://example.com/a%7Cb">lbl</a></p><p>doc</p>',
				needle: "lbl",
				source: "| [lbl](https://example.com/a\\\\|b) |\n| - |",
			},
			{
				expectedCandidateSource: "https://a",
				expectedPrefix: "https://a",
				href: "https://a",
				html0: '<p><a href="https://a">https://a</a></p><p>doc</p>',
				needle: "https://a",
				source: "| https://a\\\\|b.com |\n| - |",
			},
			{
				expectedCandidateSource: "[foo\\\\|bar]",
				expectedPrefix: "[foo\\|bar]",
				href: "https://dbl-pipe-ref.example",
				html0:
					'<p><a href="https://dbl-pipe-ref.example">foo|bar</a></p><p>doc</p>',
				needle: "foo",
				source:
					"| [foo\\\\|bar] |\n| - |\n\n[foo\\|bar]: https://dbl-pipe-ref.example",
			},
			{
				expectedCandidateSource: "https://a\\|b.com?",
				expectedPrefix: "https://a|b.com?)",
				href: "https://a%7Cb.com?",
				html0:
					'<p><a href="https://a%7Cb.com?">https://a|b.com?</a>)</p><p>doc</p>',
				needle: "https://a",
				source: "![$$x$$](https://a\\|b.com?) | c\n| - | - |",
			},
			{
				expectedCandidateSource: "<https://a\\|b.com>",
				expectedPrefix: "<https://a|b.com>",
				href: "https://a%7Cb.com",
				html0:
					'<p><a href="https://a%7Cb.com">https://a|b.com</a></p><p>doc</p>',
				needle: "https://a",
				source: "> | <https://a\\|b.com> |\n> | - |",
			},
			// Non-table paragraph keeps `\|` untouched.
			{
				expectedCandidateSource: "<https://a\\|b.com>",
				expectedPrefix: "<https://a\\|b.com>",
				href: "https://a%5C%7Cb.com",
				html0:
					'<p><a href="https://a%5C%7Cb.com">https://a\\|b.com</a></p><p>doc</p>',
				needle: "https://a",
				source: "<https://a\\|b.com>",
			},
		];

		for (const entry of cases) {
			const caret = entry.source.indexOf(entry.needle) + 1;
			const current = binding(entry.source, entry.source, {
				end: caret,
				start: caret,
			});
			const { requestFactory, session } = createHarness({
				render: async (request) => response(request.markdown, entry.html0),
			});
			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(entry.source),
				}).status,
				entry.source,
			).toBe("pending");
			await settle();
			const call = requestFactory.mock.calls[0]?.[0];
			expect(call?.markdown, `query:${entry.source}`).toBe(
				`${entry.expectedPrefix}\n\n${entry.source}`,
			);
			if (undefined !== entry.expectedCandidateSource) {
				expect(call?.candidate.source, `candidate:${entry.source}`).toBe(
					entry.expectedCandidateSource,
				);
			}
			expect(session.peek(current), `result:${entry.source}`).toEqual({
				href: entry.href,
				status: "ready",
			});
			session.dispose();
		}

		// Ownership rejection stays strict for synthesized `aaaa)` and `&easymde;` suffixes.
		for (const [source, needle, badHtml] of [
			[
				"![$$x$$](z) https://x/))))&lt;)",
				"https://x/",
				'<p><a href="https://x/))))">https://x/))))</a>&lt;)</p><p>doc</p>',
			],
			[
				"![$$x$$](z) https://x/))))&lt;)",
				"https://x/",
				'<p><a href="https://x/))))">https://x/))))</a><em>aaaa)</em></p><p>doc</p>',
			],
			[
				"![a](b$$x$$) https://example.com/(a?&amp;",
				"example.com",
				'<p><a href="https://example.com/(a?">https://example.com/(a?</a>&amp;</p><p>doc</p>',
			],
		] as const) {
			const caret = source.indexOf(needle) + 1;
			const current = binding(source, `${source}:${badHtml}`, {
				end: caret,
				start: caret,
			});
			const { session } = createHarness({
				render: async (request) => response(request.markdown, badHtml),
			});
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(source),
			});
			await settle();
			expect(session.peek(current), badHtml).toEqual({
				code: "editor-source-link-preview-ownership-invalid",
				status: "unavailable",
			});
			session.dispose();
		}

		// Non-matching escaped-pipe table ref and caret past unescaped pipe in path URL stay `none`.
		for (const [source, caret] of [
			[
				"| [foo\\|bar] |\n| - |\n\n[foo\\|bar]: https://wrong.example",
				"| [foo\\|bar] |\n| - |\n\n[foo\\|bar]: https://wrong.example".indexOf(
					"foo",
				) + 1,
			],
			[
				"| https://example.com/a\\|b |\n| - |",
				"| https://example.com/a\\|b |\n| - |".indexOf("|b") + 1,
			],
		] as const) {
			const current = binding(source, source, { end: caret, start: caret });
			const { render, session } = createHarness();
			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(source),
				}),
				source,
			).toEqual({ status: "none" });
			expect(render).not.toHaveBeenCalled();
			session.dispose();
		}
	});

	it("avoids full-document rescans on 100k-line pipe paragraphs and preserves table-cell queries across worker-unpacked indexes (Round 33 Track A #2)", async () => {
		const largeBlankDoc = `https://example.com | note\n\n${"z\n\n".repeat(100_000)}`;
		const largeSingleRunDoc = `https://example.com | note\n${"z\n".repeat(100_000)}`;
		const largeTailSingleRunDoc = `${"z\n".repeat(100_000)}https://example.com | note`;

		for (const [label, doc, caret] of [
			["100k-blank-separated", largeBlankDoc, 10],
			["100k-single-run-head", largeSingleRunDoc, 10],
			[
				"100k-single-run-tail",
				largeTailSingleRunDoc,
				largeTailSingleRunDoc.lastIndexOf("example") + 2,
			],
		] as const) {
			const built = createEditorMarkdownBlockIndex(doc);
			// 100k separate blocks exceed the worker block bound, so that document
			// only reaches the menu as a direct index; model a cell-less copy.
			const { linkTableCells: _cells, ...cellLess } = built;
			const workerUnpacked =
				"100k-blank-separated" === label
					? cellLess
					: await buildWorkerRoundTripBlockIndex(doc);
			for (const [mode, idx] of [
				["direct", built],
				["worker-unpacked", workerUnpacked],
			] as const) {
				const current = binding(doc, `${label}:${mode}`, {
					end: caret,
					start: caret,
				});
				const { requestFactory, session } = createHarness({
					render: () => new Promise(() => undefined),
				});
				const started = performance.now();
				const state = session.ensure({ binding: current, blockIndex: idx });
				const elapsed = performance.now() - started;
				expect(state.status, `${label}:${mode}`).toBe("pending");
				expect(elapsed, `${label}:${mode}`).toBeLessThan(250);
				expect(
					requestFactory.mock.calls[0]?.[0]?.markdown.startsWith(
						"https://example.com\n\n",
					),
					`prefix:${label}:${mode}`,
				).toBe(true);
				session.dispose();
			}
		}

		// Real packed worker round trip carries `linkTableCells`, preserving GFM
		// table-cell unescaping and bare autolink trailing context without rescans.
		for (const [source, needle, expectedPrefix, html0, href] of [
			[
				"| <https://a\\|b.com> |\n| - |",
				"https://a",
				"<https://a|b.com>",
				'<p><a href="https://a%7Cb.com">https://a|b.com</a></p><p>doc</p>',
				"https://a%7Cb.com",
			],
			[
				"| <https://a\\\\|b.com> |\n| - |",
				"https://a",
				"<https://a\\|b.com>",
				'<p><a href="https://a%5C%7Cb.com">https://a\\|b.com</a></p><p>doc</p>',
				"https://a%5C%7Cb.com",
			],
			[
				"![$$x$$](https://a\\|b.com?) | c\n| - | - |",
				"https://a",
				"https://a|b.com?)",
				'<p><a href="https://a%7Cb.com?">https://a|b.com?</a>)</p><p>doc</p>',
				"https://a%7Cb.com?",
			],
			[
				"> | <https://a\\|b.com> |\n> | - |",
				"https://a",
				"<https://a|b.com>",
				'<p><a href="https://a%7Cb.com">https://a|b.com</a></p><p>doc</p>',
				"https://a%7Cb.com",
			],
			[
				"| (https://a.com/b,) |\n| - |",
				"a.com",
				"https://a.com/b,)",
				'<p><a href="https://a.com/b,">https://a.com/b,</a>)</p><p>doc</p>',
				"https://a.com/b,",
			],
		] as const) {
			const workerUnpacked = await buildWorkerRoundTripBlockIndex(source);
			expect(workerUnpacked.linkTableCells, source).toEqual(
				createEditorMarkdownBlockIndex(source).linkTableCells,
			);
			const caret = source.indexOf(needle) + 1;
			const current = binding(source, `worker:${source}`, {
				end: caret,
				start: caret,
			});
			const { requestFactory, session } = createHarness({
				render: async (request) => response(request.markdown, html0),
			});
			expect(
				session.ensure({ binding: current, blockIndex: workerUnpacked }).status,
				source,
			).toBe("pending");
			await settle();
			expect(requestFactory.mock.calls[0]?.[0]?.markdown, source).toBe(
				`${expectedPrefix}\n\n${source}`,
			);
			expect(session.peek(current), source).toEqual({
				href,
				status: "ready",
			});
			session.dispose();
		}
	});

	it("resolves bare GFM autolinks in ordinary paragraphs/tables and UTF-8 multi-byte unbalanced parens with exact PHP href parity (Round 33 Track A #3/#4)", async () => {
		// Verbatim `MarkdownRenderer::render_preview()` + real `kses.php` block-0 outputs.
		const cases: ReadonlyArray<
			Readonly<{
				carets: ReadonlyArray<number>;
				expectedPrefix: string;
				href: string;
				html0: string;
				source: string;
			}>
		> = [
			// Track A #3: ordinary paragraphs & ordinary tables without display math
			{
				carets: [1, 4, 6, 9],
				expectedPrefix: "www.a@b.c_.",
				href: "mailto:www.a@b.c_",
				html0:
					'<p><a href="mailto:www.a@b.c_">www.a@b.c_</a>.</p><p>doc</p>',
				source: "www.a@b.c_.",
			},
			{
				carets: [1, 6, 9],
				expectedPrefix: "www.a@b.c-.",
				href: "mailto:www.a@b.c-",
				html0:
					'<p><a href="mailto:www.a@b.c-">www.a@b.c-</a>.</p><p>doc</p>',
				source: "www.a@b.c-.",
			},
			{
				carets: [1, 6, 9],
				expectedPrefix: "www.a@b.c..",
				href: "mailto:www.a@b.c.",
				html0:
					'<p><a href="mailto:www.a@b.c.">www.a@b.c.</a>.</p><p>doc</p>',
				source: "www.a@b.c..",
			},
			{
				carets: [1, 4],
				expectedPrefix: "www.a",
				href: "http://www.a",
				html0: '<p><a href="http://www.a">www.a</a></p><p>doc</p>',
				source: "www.a@b.c_",
			},
			{
				carets: [2, 10, 16],
				expectedPrefix: "https://a.com/b,)",
				href: "https://a.com/b,",
				html0:
					'<p><a href="https://a.com/b,">https://a.com/b,</a>)</p><p>doc</p>',
				source: "(https://a.com/b,)",
			},
			{
				carets: [2, 10],
				expectedPrefix: "https://x?)",
				href: "https://x?",
				html0: '<p><a href="https://x?">https://x?</a>)</p><p>doc</p>',
				source: "(https://x?)",
			},
			{
				carets: [2, 16],
				expectedPrefix: "www.example.com?)",
				href: "http://www.example.com?",
				html0:
					'<p><a href="http://www.example.com?">www.example.com?</a>)</p><p>doc</p>',
				source: "(www.example.com?)",
			},
			{
				carets: [2, 19],
				expectedPrefix: "https://example.com?)",
				href: "https://example.com?",
				html0:
					'<p><a href="https://example.com?">https://example.com?</a>)</p><p>doc</p>',
				source: "https://example.com?&amp;",
			},
			{
				carets: [2, 13],
				expectedPrefix: "https://x/))))aaaa)",
				href: "https://x/))))",
				html0:
					'<p><a href="https://x/))))">https://x/))))</a>aaaa)</p><p>doc</p>',
				source: "https://x/))))&lt;)",
			},
			{
				carets: [2, 23],
				expectedPrefix: "https://example.com?a)))aaa)",
				href: "https://example.com?a)))",
				html0:
					'<p><a href="https://example.com?a)))">https://example.com?a)))</a>aaa)</p><p>doc</p>',
				source: "https://example.com?a)))*x*)))))))",
			},
			{
				carets: [3, 8],
				expectedPrefix: "www.a@b.c_.",
				href: "mailto:www.a@b.c_",
				html0:
					'<p><a href="mailto:www.a@b.c_">www.a@b.c_</a>.</p><p>doc</p>',
				source: "| www.a@b.c_. |\n| - |",
			},
			{
				carets: [5, 18],
				expectedPrefix: "https://a.com/b,)",
				href: "https://a.com/b,",
				html0:
					'<p><a href="https://a.com/b,">https://a.com/b,</a>)</p><p>doc</p>',
				source: "| (https://a.com/b,) |\n| - |",
			},
			{
				carets: [5, 12],
				expectedPrefix: "https://x?)",
				href: "https://x?",
				html0: '<p><a href="https://x?">https://x?</a>)</p><p>doc</p>',
				source: "| (https://x?) |\n| - |",
			},
			// Track A #4: UTF-8 multi-byte unbalanced-paren byte trimming parity
			{
				carets: [12, 21],
				expectedPrefix: "https://x/a)é)",
				href: "https://x/a)%C3%83",
				html0:
					'<p><a href="https://x/a)%C3%83">https://x/a)Ã</a>)</p><p>doc</p>',
				source: "![$$x$$](https://x/a)é)",
			},
			{
				carets: [12, 21],
				expectedPrefix: "https://x/a)中)",
				href: "https://x/a)%C3%83%C2%B8",
				html0:
					'<p><a href="https://x/a)%C3%83%C2%B8">https://x/a)ä¸</a>)</p><p>doc</p>',
				source: "![$$x$$](https://x/a)中)",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/a",
				href: "https://x/a",
				html0: '<p><a href="https://x/a">https://x/a</a></p><p>doc</p>',
				source: "![$$x$$](https://x/a)😀)",
			},
			{
				carets: [12, 21],
				expectedPrefix: "https://x/a)𐐀)",
				href: "https://x/a)%C3%83%C2%90%C2%90",
				html0:
					'<p><a href="https://x/a)%C3%83%C2%90%C2%90">https://x/a)ð  </a>)</p><p>doc</p>',
				source: "![$$x$$](https://x/a)𐐀)",
			},
			{
				carets: [4, 13],
				expectedPrefix: "https://x/a)é)",
				href: "https://x/a)%C3%83",
				html0:
					'<p><a href="https://x/a)%C3%83">https://x/a)Ã</a>)</p><p>doc</p>',
				source: "(https://x/a)é)",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/a)é&amp",
				href: "https://x/a)%C3%A9&amp",
				html0:
					'<p><a href="https://x/a)%C3%A9&amp;amp">https://x/a)é&amp;amp</a></p><p>doc</p>',
				source: "![$$x$$](https://x/a)é&amp;)",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/a)é*x",
				href: "https://x/a)%C3%A9*x",
				html0:
					'<p><a href="https://x/a)%C3%A9*x">https://x/a)é*x</a></p><p>doc</p>',
				source: "![$$x$$](https://x/a)é*x*)",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/aé",
				href: "https://x/a%C3%A9",
				html0: '<p><a href="https://x/a%C3%A9">https://x/aé</a></p><p>doc</p>',
				source: "![$$x$$](https://x/aé)",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/a))aa)",
				href: "https://x/a))",
				html0:
					'<p><a href="https://x/a))">https://x/a))</a>aa)</p><p>doc</p>',
				source: "![$$x$$](https://x/a))é)",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/a))aa)",
				href: "https://x/a))",
				html0:
					'<p><a href="https://x/a))">https://x/a))</a>aa)</p><p>doc</p>',
				source: "![$$x$$](https://x/a))é))",
			},
			{
				carets: [12],
				expectedPrefix: "https://x/a))))中aaa)",
				href: "https://x/a))))%C3%83%C2%B8",
				html0:
					'<p><a href="https://x/a))))%C3%83%C2%B8">https://x/a))))ä¸</a>aaa)</p><p>doc</p>',
				source: "![$$x$$](https://x/a))))中中)",
			},
		];

		for (const entry of cases) {
			const blockIndex = createEditorMarkdownBlockIndex(entry.source);
			for (const caret of entry.carets) {
				const current = binding(entry.source, `${entry.source}@${caret}`, {
					end: caret,
					start: caret,
				});
				const { requestFactory, session } = createHarness({
					render: async (request) => response(request.markdown, entry.html0),
				});
				expect(
					session.ensure({ binding: current, blockIndex }).status,
					`${entry.source}@${caret}`,
				).toBe("pending");
				await settle();
				expect(
					requestFactory.mock.calls[0]?.[0]?.markdown,
					`query:${entry.source}@${caret}`,
				).toBe(`${entry.expectedPrefix}\n\n${entry.source}`);
				expect(session.peek(current), `result:${entry.source}@${caret}`).toEqual(
					{
						href: entry.href,
						status: "ready",
					},
				);
				session.dispose();
			}
		}

		// Negative controls: masked, non-link, or trailing-punctuation carets stay `none`.
		for (const [source, caret] of [
			["`www.a@b.c_.`", 6],
			["`(https://a.com/b,)`", 8],
			["<!-- www.a@b.c_. -->", 10],
			["<www.example.com>", 6],
			["https://a.com/b,", 15],
			["www.a@b.c_", 7],
			["![$$x$$](https://x/a)é)", 22],
			["![$$x$$](https://x/a)😀)", 21],
		] as const) {
			const current = binding(source, `neg:${source}@${caret}`, {
				end: caret,
				start: caret,
			});
			const { render, session } = createHarness();
			expect(
				session.ensure({
					binding: current,
					blockIndex: createEditorMarkdownBlockIndex(source),
				}),
				`${source}@${caret}`,
			).toEqual({ status: "none" });
			expect(render).not.toHaveBeenCalled();
			session.dispose();
		}

		// Negative ownership guards for UTF-8 unbalanced-paren queries stay strict.
		const utf8Source = "![$$x$$](https://x/a)é)";
		for (const badHtml of [
			'<p><a href="https://x/a)%C3%83">https://x/a)Ã</a></p><p>doc</p>',
			'<p><a href="https://x/a)%C3%83">https://x/a)Ã</a><em>)</em></p><p>doc</p>',
			'<p>lead <a href="https://x/a)%C3%83">https://x/a)Ã</a>)</p><p>doc</p>',
		]) {
			const current = binding(utf8Source, badHtml, { end: 12, start: 12 });
			const { session } = createHarness({
				render: async (request) => response(request.markdown, badHtml),
			});
			session.ensure({
				binding: current,
				blockIndex: createEditorMarkdownBlockIndex(utf8Source),
			});
			await settle();
			expect(session.peek(current), badHtml).toEqual({
				code: "editor-source-link-preview-ownership-invalid",
				status: "unavailable",
			});
			session.dispose();
		}
	});

	it("resolves list-nested and chained-math table links through direct and real packed worker indexes (Round 34 Track A #1/#2)", async () => {
		// `MarkdownRenderer::render_preview()` + real `kses.php` block-0 outputs.
		const linkA = '<p><a href="/x%7Cy">a</a></p><p>doc</p>';
		const refOk = '<p><a href="https://example.com/ok">x</a></p><p>doc</p>';
		const escapedPipe = '<p><a href="https://example.com/a%7Cb">x</a></p><p>doc</p>';
		for (const [source, prefix, html0, href] of [
			["10. a\n\n    | [a](/x\\|y) |\n    | - |", "[a](/x|y)", linkA, "/x%7Cy"],
			[
				"10. item\n\n    | a | b |\n    | - | - |\n    | [x][a\\|b] | c |\n\n[a|b]: https://example.com/ok",
				"[x][a|b]",
				refOk,
				"https://example.com/ok",
			],
			[
				"10. item\n\n    | a | b |\n    | - | - |\n    | [x](https://example.com/a\\\\|b) | c |",
				"[x](https://example.com/a\\|b)",
				escapedPipe,
				"https://example.com/a%7Cb",
			],
			[
				"- outer\n  - inner\n\n    | a | b |\n    | - | - |\n    | [x](https://example.com/a\\\\|b) | c |",
				"[x](https://example.com/a\\|b)",
				escapedPipe,
				"https://example.com/a%7Cb",
			],
			[
				"| [x][a\\|b] \\(a\nb\\) \\(c\nd\\) | col2 |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
				"[x][a|b]",
				refOk,
				"https://example.com/ok",
			],
			[
				"| [x](https://example.com/a\\\\|b) \\(a\nb\\) \\(c\nd\\) | col2 |\n| --- | --- |",
				"[x](https://example.com/a\\|b)",
				escapedPipe,
				"https://example.com/a%7Cb",
			],
		] as const) {
			const direct = createEditorMarkdownBlockIndex(source);
			const worker = await buildWorkerRoundTripBlockIndex(source);
			expect(worker.linkTableCells, source).toEqual(direct.linkTableCells);
			expect(worker.linkTableCells?.size ?? 0, source).toBeGreaterThan(0);
			const caret = source.indexOf("[") + 1;
			for (const [mode, blockIndex] of [
				["direct", direct],
				["worker", worker],
			] as const) {
				const current = binding(source, `${mode}:${source}`, {
					end: caret,
					start: caret,
				});
				const { requestFactory, session } = createHarness({
					render: async (request) => response(request.markdown, html0),
				});
				expect(session.ensure({ binding: current, blockIndex }).status).toBe(
					"pending",
				);
				await settle();
				expect(
					requestFactory.mock.calls[0]?.[0]?.markdown,
					`${mode}:${source}`,
				).toBe(`${prefix}\n\n${source}`);
				expect(session.peek(current), `${mode}:${source}`).toEqual({
					href,
					status: "ready",
				});
				session.dispose();
			}
		}
	});

	it("answers worker-unpacked menu queries in O(1) after 100k-line pipe/dash paragraphs (Round 34 Track B #1)", async () => {
		const source = `z|-\n${"z\n".repeat(100_000)}https://example.com | note`;
		const worker = await buildWorkerRoundTripBlockIndex(source);
		const caret = source.lastIndexOf("example") + 2;
		const { requestFactory, session } = createHarness({
			render: () => new Promise(() => undefined),
		});
		const started = performance.now();
		const state = session.ensure({
			binding: binding(source, "perf", { end: caret, start: caret }),
			blockIndex: worker,
		});
		const elapsed = performance.now() - started;
		expect(state.status).toBe("pending");
		expect(elapsed).toBeLessThanOrEqual(250);
		expect(
			requestFactory.mock.calls[0]?.[0]?.markdown.startsWith(
				"https://example.com\n\n",
			),
		).toBe(true);
		session.dispose();

		// A hand-built index without `linkTableCells` never rescans the source.
		const { linkTableCells: _omitted, ...withoutCells } =
			createEditorMarkdownBlockIndex("| https://a\\|b.com |\n| - |");
		const fallback = createHarness({ render: () => new Promise(() => undefined) });
		expect(
			fallback.session.ensure({
				binding: binding(withoutCells.source, "no-cells", { end: 4, start: 4 }),
				blockIndex: withoutCells,
			}).status,
		).toBe("pending");
		expect(
			fallback.requestFactory.mock.calls[0]?.[0]?.markdown.endsWith(
				`\n\n${withoutCells.source}`,
			),
		).toBe(true);
		fallback.session.dispose();
	}, 60_000);

	it("resolves 2-line and 3-line reconciled PHP table links and isolates multi-cell escaped-pipe queries through direct and worker round-trip indexes (Round 35 Track A #1, Track B #2)", async () => {
		// Verbatim real PHP `MarkdownRenderer::render_preview()` + `kses.php` block-0 outputs.
		const cases: ReadonlyArray<
			Readonly<{
				href: string;
				html0: string;
				needle: string;
				prefix: string;
				source: string;
			}>
		> = [
			{
				href: "https://example.com",
				html0: '<p><a href="https://example.com">https://example.com</a></p><p>doc</p>',
				needle: "https://example.com",
				prefix: "https://example.com",
				source: "[a|https://example.com]:\n|-|-|",
			},
			{
				href: "/bar",
				html0: '<p><a href="/bar">c</a></p><p>doc</p>',
				needle: "[c](/bar)",
				prefix: "[c](/bar)",
				source: '[a | b]: /ref "\n| - | - |\n| [c](/bar) | d"',
			},
			{
				href: "/bar",
				html0: '<p><a href="/bar">c</a></p><p>doc</p>',
				needle: "[c](/bar)",
				prefix: "[c](/bar)",
				source: '[a | b]: /ref "\n| - | - |\n| [c](/bar) | https://c.example"',
			},
			{
				href: "https://c.example",
				html0: '<p><a href="https://c.example">https://c.example</a></p><p>doc</p>',
				needle: "https://c.example",
				prefix: "https://c.example",
				source: '[a | b]: /ref "\n| - | - |\n| [c](/bar) | https://c.example"',
			},
			{
				href: "https://k.example",
				html0: '<p><a href="https://k.example">c</a></p><p>doc</p>',
				needle: "[c][k]",
				prefix: "[c][k]",
				source: '[a | b]: /ref "\n| - | - |\n| [c][k] | d"\n\n[k]: https://k.example',
			},
			{
				href: "tel:12345",
				html0: '<p><a href="tel:12345">tel:12345</a></p><p>doc</p>',
				needle: "<tel:12345>",
				prefix: "<tel:12345>",
				source: '[a | b]: /ref "\n| - | - |\n| <tel:12345> | d"',
			},
			{
				href: "/x%7Cy",
				html0: '<p><a href="/x%7Cy">a</a></p><p>doc</p>',
				needle: "[a](/x\\|y)",
				prefix: "[a](/x|y)",
				source: "| [a](/x\\|y) | [b](/u\\|v) |\n| - | - |",
			},
			{
				href: "/u%7Cv",
				html0: '<p><a href="/u%7Cv">b</a></p><p>doc</p>',
				needle: "[b](/u\\|v)",
				prefix: "[b](/u|v)",
				source: "| [a](/x\\|y) | [b](/u\\|v) |\n| - | - |",
			},
		];

		for (const entry of cases) {
			const direct = createEditorMarkdownBlockIndex(entry.source);
			const worker = await buildWorkerRoundTripBlockIndex(entry.source);
			expect(worker.linkTableCells, `${entry.source}:${entry.needle}`).toEqual(
				direct.linkTableCells,
			);
			expect(worker.linkCandidates, `${entry.source}:${entry.needle}`).toEqual(
				direct.linkCandidates,
			);
			const caret = entry.source.indexOf(entry.needle) + 1;
			for (const [mode, blockIndex] of [
				["direct", direct],
				["worker", worker],
			] as const) {
				const current = binding(
					entry.source,
					`${mode}:${entry.source}:${entry.needle}`,
					{ end: caret, start: caret },
				);
				const { requestFactory, session } = createHarness({
					render: async (request) => response(request.markdown, entry.html0),
				});
				expect(
					session.ensure({ binding: current, blockIndex }).status,
					`${mode}:${entry.needle}`,
				).toBe("pending");
				await settle();
				expect(
					requestFactory.mock.calls[0]?.[0]?.markdown,
					`${mode}:${entry.needle}`,
				).toBe(`${entry.prefix}\n\n${entry.source}`);
				expect(session.peek(current), `${mode}:${entry.needle}`).toEqual({
					href: entry.href,
					status: "ready",
				});
				session.dispose();
			}
		}
	});

	it("resolves cross-block multiline paren-math PHP table cells and plain-paragraph double-backslash pipes through direct and worker round-trip indexes (Round 36 Track A #1, Track B #3)", async () => {
		// Verbatim real PHP `MarkdownRenderer::render_preview()` + `kses.php` block-0 outputs.
		const refOk = '<p><a href="https://example.com/ok">x</a></p><p>doc</p>';
		const pipeUrl = '<p><a href="https://example.com/1%7C2">x</a></p><p>doc</p>';
		const plainPipeUrl = '<p><a href="/x%5C%7Cy">a</a></p><p>doc</p>';
		const cases: ReadonlyArray<
			Readonly<{
				expectTableCell: boolean;
				href: string;
				html0: string;
				needle: string;
				prefix: string;
				source: string;
			}>
		> = [
			{
				expectTableCell: false,
				href: "/x%5C%7Cy",
				html0: plainPipeUrl,
				needle: "[a](/x\\\\|y)",
				prefix: "[a](/x\\\\|y)",
				source: "[a](/x\\\\|y)",
			},
			{
				expectTableCell: true,
				href: "https://example.com/ok",
				html0: refOk,
				needle: "[x][a\\|b]",
				prefix: "[x][a|b]",
				source: '[r]: /u "\\(a"\nb\\) [x][a\\|b] | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok',
			},
			{
				expectTableCell: true,
				href: "https://example.com/ok",
				html0: refOk,
				needle: "[x][a\\|b]",
				prefix: "[x][a|b]",
				source: "| [x][a\\|b] \\(m\n\nn\\) | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
			},
			{
				expectTableCell: true,
				href: "https://example.com/1%7C2",
				html0: pipeUrl,
				needle: "[x](https://example.com/1\\\\|2)",
				prefix: "[x](https://example.com/1\\|2)",
				source: "| [x](https://example.com/1\\\\|2) \\(m\n\nn\\) | c |\n| --- | --- |",
			},
			{
				expectTableCell: true,
				href: "https://example.com/1%7C2",
				html0: pipeUrl,
				needle: "[x](https://example.com/1\\\\|2)",
				prefix: "[x](https://example.com/1\\|2)",
				source: "| [x](https://example.com/1\\\\|2) \\(m\n# h\nn\\) | c |\n| --- | --- |",
			},
			{
				expectTableCell: true,
				href: "https://example.com/1%7C2",
				html0: pipeUrl,
				needle: "[x](https://example.com/1\\\\|2)",
				prefix: "[x](https://example.com/1\\|2)",
				source: '[r]: /u "\\(a"\nb\\) [x](https://example.com/1\\\\|2) | c |\n| --- | --- |',
			},
		];

		for (const entry of cases) {
			const direct = createEditorMarkdownBlockIndex(entry.source);
			const worker = await buildWorkerRoundTripBlockIndex(entry.source);
			if (entry.expectTableCell) {
				expect(worker.linkTableCells, entry.source).toEqual(direct.linkTableCells);
				expect(worker.linkTableCells?.size, entry.source).toBe(1);
			} else {
				expect(direct.linkTableCells?.size, entry.source).toBe(0);
				expect(worker.linkTableCells, entry.source).toBeUndefined();
			}
			const caret = entry.source.indexOf(entry.needle) + 1;
			for (const [mode, blockIndex] of [
				["direct", direct],
				["worker", worker],
			] as const) {
				const current = binding(entry.source, `${mode}:${entry.source}`, {
					end: caret,
					start: caret,
				});
				const { requestFactory, session } = createHarness({
					render: async (request) => response(request.markdown, entry.html0),
				});
				expect(
					session.ensure({ binding: current, blockIndex }).status,
					`${mode}:${entry.source}`,
				).toBe("pending");
				await settle();
				expect(
					requestFactory.mock.calls[0]?.[0]?.markdown,
					`${mode}:${entry.source}`,
				).toBe(`${entry.prefix}\n\n${entry.source}`);
				expect(session.peek(current), `${mode}:${entry.source}`).toEqual({
					href: entry.href,
					status: "ready",
				});
				session.dispose();
			}
		}

		// Large 100k-line document with 1 table at the top stays bounded on unpack and O(1) on ensure().
		const largeTopTable = `| [a](/x\\|y) | c |\n| - | - |\n\nz|-\n${"z\n".repeat(100_000)}`;
		const workerTop = await buildWorkerRoundTripBlockIndex(largeTopTable);
		expect(workerTop.linkTableCells?.size).toBe(1);
		const topCaret = largeTopTable.indexOf("[a]") + 1;
		const { requestFactory, session } = createHarness({
			render: () => new Promise(() => undefined),
		});
		const started = performance.now();
		const topState = session.ensure({
			binding: binding(largeTopTable, "top-table-perf", {
				end: topCaret,
				start: topCaret,
			}),
			blockIndex: workerTop,
		});
		const elapsed = performance.now() - started;
		expect(topState.status).toBe("pending");
		expect(elapsed).toBeLessThanOrEqual(250);
		expect(
			requestFactory.mock.calls[0]?.[0]?.markdown.startsWith("[a](/x|y)\n\n"),
		).toBe(true);
		session.dispose();
	}, 60_000);
});

function createEditorMarkdownBlockIndex(source: string, options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = { referenceLabelCaseFoldProfile: 14 }) {
  return createProfiledMarkdownBlockIndex(source, options);
}
