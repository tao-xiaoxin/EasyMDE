import { describe, expect, it, vi } from "vitest";

import {
	MAX_PREVIEW_CODE_MAP_CONTENT_BYTES,
	MAX_PREVIEW_CODE_MAP_ENTRIES,
	MAX_PREVIEW_CODE_PROJECTION_ENTRIES,
	MAX_PREVIEW_EDIT_MAP_BLOCKS,
	type PreviewEditMapBlock,
} from "../../../contracts/ports/preview-request";
import { createWordPressPreviewPort } from "./create-wordpress-preview-port";

const request = {
	markdown: "# Preview",
	postId: 17,
	markdownTheme: "newsprint",
	codeTheme: "github-dark",
	customCssId: "custom-1",
	signature: "opaque",
};

const block = (
	id: string,
	startLine: number,
	endLine: number,
	editable = true,
): PreviewEditMapBlock => ({ id, startLine, endLine, editable });

const rawEditMap = (
	blocks: readonly PreviewEditMapBlock[] = [block("b0", 0, 1)],
) => ({
	version: 1,
	coordinate: "line",
	blocks,
});

const codeEntry = (
	kind: "fenced" | "indented",
	startLine: number,
	endLine: number,
	content = "value\n",
) => ({
	content,
	endLine,
	kind,
	startLine,
	status: "available" as const,
});

const rawCodeMap = (
	entries: readonly Record<string, unknown>[] = [codeEntry("fenced", 0, 3)],
) => ({
	version: 1,
	coordinate: "line",
	status: "available" as const,
	entries,
});

const projectionRow = (
	values: Partial<{
		contentLine: number;
		literalFrom: number;
		literalLeadingSpaces: number;
		prefixEnd: number;
		prefixTabColumns: number;
		sourceLine: number;
	}> = {},
) => ({
	contentLine: 0,
	literalFrom: 0,
	literalLeadingSpaces: 0,
	prefixEnd: 0,
	prefixTabColumns: 0,
	sourceLine: 1,
	...values,
});

const rawProjection = (entries: readonly Record<string, unknown>[]) => ({
	version: 1,
	coordinate: "line" as const,
	offsetUnit: "utf16" as const,
	status: "available" as const,
	entries,
});

const fencedProjectionEntry = (
	startLine: number,
	endLine: number,
	rows: readonly Record<string, unknown>[],
	values: Partial<{ fenceOffset: number; info: string }> = {},
) => ({
	endLine,
	fenceOffset: 0,
	info: "js",
	kind: "fenced" as const,
	rows,
	startLine,
	status: "available" as const,
	...values,
});

const markedHtml = (...ids: string[]): string =>
	ids.map((id) => `<p data-easymde-visual-block-id="${id}">${id}</p>`).join("");

const validResponse = (overrides: Record<string, unknown> = {}) => ({
	html: markedHtml("b0"),
	features: { toc: true },
	editMap: rawEditMap(),
	...overrides,
});

describe("createWordPressPreviewPort", () => {
	it("maps the typed request to the existing WordPress REST contract", async () => {
		const apiFetch = vi.fn().mockResolvedValue(
			validResponse({
				html: '<h1 data-easymde-visual-block-id="b0">Preview</h1>',
			}),
		);
		const port = createWordPressPreviewPort(
			apiFetch,
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);
		const controller = new AbortController();

		const response = await port.render(request, controller.signal);
		expect(response).toMatchObject({
			html: '<h1 data-easymde-visual-block-id="b0">Preview</h1>',
			features: { toc: true },
			editMap: {
				version: 1,
				coordinate: "line",
				signature: "opaque",
				blocks: [block("b0", 0, 1)],
			},
			codeMap: {
				code: "preview-code-body-unavailable",
				coordinate: "line",
				signature: "opaque",
				status: "unavailable",
				version: 1,
			},
		});
		expect(response.preparedMarkup?.sourceNodes).toHaveLength(1);
		expect(
			(
				response.preparedMarkup?.sourceNodes[0] as HTMLElement | undefined
			)?.getAttribute("data-easymde-visual-block-id"),
		).toBe("b0");
		expect(apiFetch).toHaveBeenCalledWith({
			url: "https://example.test/wp-json/easymde/v1/preview",
			method: "POST",
			headers: { "X-WP-Nonce": "nonce" },
			data: {
				markdown: "# Preview",
				post_id: 17,
				markdown_theme: "newsprint",
				code_theme: "github-dark",
				custom_css_id: "custom-1",
			},
			signal: controller.signal,
		});
	});

	it("validates available code leaves and binds the map to the request signature", async () => {
		const codeMapRequest = {
			...request,
			markdown: ["0", "1", "2", "3", "4", "5", "6", "7", "8"].join("\n"),
		};
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					codeMap: rawCodeMap([
						codeEntry("fenced", 1, 4, "one\r\ntwo\r\n"),
						{
							code: "preview-code-body-source-unavailable",
							endLine: 8,
							kind: "indented",
							startLine: 6,
							status: "unavailable" as const,
						},
					]),
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(codeMapRequest, new AbortController().signal),
		).resolves.toMatchObject({
			codeMap: {
				coordinate: "line",
				entries: [
					codeEntry("fenced", 1, 4, "one\r\ntwo\r\n"),
					{
						code: "preview-code-body-source-unavailable",
						endLine: 8,
						kind: "indented",
						startLine: 6,
						status: "unavailable",
					},
				],
				signature: "opaque",
				status: "available",
				version: 1,
			},
		});
	});

	it("normalizes a valid projection and proves nonblank rows against its code leaf", async () => {
		const projectionRequest = {
			...request,
			markdown: "```js\none\n```",
			signature: "projection-signature",
		};
		const projection = rawProjection([
			fencedProjectionEntry(0, 3, [projectionRow()]),
		]);
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					codeMap: rawCodeMap([codeEntry("fenced", 0, 3, "one\n")]),
					codeProjection: projection,
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		const response = await port.render(
			projectionRequest,
			new AbortController().signal,
		);
		expect(response).toMatchObject({
			codeProjection: {
				coordinate: "line",
				entries: [projection.entries[0]],
				offsetUnit: "utf16",
				signature: "projection-signature",
				status: "available",
				version: 1,
			},
		});
	});

	it("accepts a shared tab proof and omits semantic blank rows", async () => {
		const projectionRequest = {
			...request,
			markdown: "\tone\n\n",
			signature: "tab-signature",
		};
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					codeMap: rawCodeMap([codeEntry("indented", 0, 3, "one\n\n")]),
					codeProjection: rawProjection([
						{
							endLine: 3,
							kind: "indented",
							rows: [
								projectionRow({
									literalFrom: 1,
									prefixTabColumns: 2,
									sourceLine: 0,
								}),
							],
							startLine: 0,
							status: "available" as const,
						},
					]),
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		const response = await port.render(
			projectionRequest,
			new AbortController().signal,
		);
		expect(response).toMatchObject({
			codeProjection: {
				entries: [
					{
						kind: "indented",
						rows: [
							{
								contentLine: 0,
								prefixTabColumns: 2,
							},
						],
					},
				],
				status: "available",
			},
		});
	});

	it("keeps HTML and codeMap usable when projection metadata is missing or malformed", async () => {
		const projectionRequest = {
			...request,
			markdown: "```js\none\n```",
			signature: "projection-fallback",
		};
		const codeMap = rawCodeMap([codeEntry("fenced", 0, 3, "one\n")]);
		const malformedProjection = rawProjection([
			fencedProjectionEntry(0, 3, [null as unknown as Record<string, unknown>]),
		]);
		const port = createWordPressPreviewPort(
			vi
				.fn()
				.mockResolvedValue(
					validResponse({ codeMap, codeProjection: malformedProjection }),
				),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(projectionRequest, new AbortController().signal),
		).resolves.toMatchObject({
			html: markedHtml("b0"),
			codeMap: {
				status: "available",
				entries: [codeEntry("fenced", 0, 3, "one\n")],
			},
			codeProjection: {
				code: "preview-code-projection-unavailable",
				status: "unavailable",
				signature: "projection-fallback",
			},
		});
	});

	it.each([
		{
			name: "kind and range do not match the unique code leaf",
			codeProjection: rawProjection([
				{
					...fencedProjectionEntry(0, 3, [projectionRow()]),
					kind: "indented" as const,
				},
			]),
		},
		{
			name: "UTF-16 offset splits a surrogate pair",
			codeProjection: rawProjection([
				fencedProjectionEntry(0, 3, [projectionRow({ literalFrom: 1 })]),
			]),
			markdown: "```js\n😀one\n```",
			codeMap: rawCodeMap([codeEntry("fenced", 0, 3, "😀one\n")]),
		},
		{
			name: "negative source offset",
			codeProjection: rawProjection([
				fencedProjectionEntry(0, 3, [projectionRow({ prefixEnd: -1 })]),
			]),
		},
		{
			name: "virtual leading spaces exceed the bound",
			codeProjection: rawProjection([
				fencedProjectionEntry(0, 3, [
					projectionRow({ literalLeadingSpaces: 4 }),
				]),
			]),
		},
		{
			name: "virtual leading spaces without a shared tab",
			codeProjection: rawProjection([
				fencedProjectionEntry(0, 3, [
					projectionRow({ literalFrom: 1, literalLeadingSpaces: 1 }),
				]),
			]),
			markdown: "```js\n  one\n```",
			codeMap: rawCodeMap([codeEntry("fenced", 0, 3, "  one\n")]),
		},
		{
			name: "fenced info exceeds the UTF-8 bound",
			codeProjection: rawProjection([
				fencedProjectionEntry(0, 3, [projectionRow()], {
					info: "x".repeat(1025),
				}),
			]),
		},
		{
			name: "unknown top-level projection metadata",
			codeProjection: { ...rawProjection([]), extra: true },
		},
		{
			name: "malformed projection limit metadata",
			codeProjection: {
				...rawProjection([]),
				code: "preview-code-projection-limit" as const,
				extra: true,
				status: "unavailable" as const,
			},
		},
	])(
		"normalizes $name without rejecting the response",
		async ({
			codeProjection,
			markdown = "```js\none\n```",
			codeMap = rawCodeMap([codeEntry("fenced", 0, 3, "one\n")]),
		}) => {
			const projectionRequest = {
				...request,
				markdown,
				signature: "projection-invalid",
			};
			const port = createWordPressPreviewPort(
				vi.fn().mockResolvedValue(validResponse({ codeMap, codeProjection })),
				"/wp-json/easymde/v1/preview",
				"nonce",
				"https://example.test/wp-admin/post.php",
			);

			await expect(
				port.render(projectionRequest, new AbortController().signal),
			).resolves.toMatchObject({
				codeProjection: {
					code: "preview-code-projection-unavailable",
					status: "unavailable",
					signature: "projection-invalid",
				},
			});
		},
	);

	it("preserves a formal projection limit without inventing rows", async () => {
		const projectionRequest = {
			...request,
			markdown: "```\none\n```",
			signature: "projection-limit",
		};
		const entries = Array.from(
			{ length: MAX_PREVIEW_CODE_PROJECTION_ENTRIES },
			(_, index) => ({
				code: "preview-code-projection-source-unavailable" as const,
				endLine: index + 1,
				kind: "fenced" as const,
				startLine: index,
				status: "unavailable" as const,
			}),
		);
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					codeMap: rawCodeMap([codeEntry("fenced", 0, 3, "one\n")]),
					codeProjection: rawProjection(entries),
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(projectionRequest, new AbortController().signal),
		).resolves.toMatchObject({
			codeProjection: {
				code: "preview-code-projection-limit",
				status: "unavailable",
				signature: "projection-limit",
			},
		});
	});

	it("preserves the formal map limit failure without inventing entries", async () => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					codeMap: {
						code: "preview-code-body-limit",
						coordinate: "line",
						status: "unavailable",
						version: 1,
					},
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).resolves.toMatchObject({
			codeMap: {
				code: "preview-code-body-limit",
				status: "unavailable",
				signature: "opaque",
			},
		});
	});

	it.each([
		{
			name: "invalid version",
			codeMap: { ...rawCodeMap(), version: 2 },
		},
		{
			name: "invalid coordinate",
			codeMap: { ...rawCodeMap(), coordinate: "byte" },
		},
		{
			name: "invalid status",
			codeMap: { ...rawCodeMap(), status: "unavailable", entries: [] },
		},
		{
			name: "invalid kind",
			codeMap: rawCodeMap([{ ...codeEntry("fenced", 0, 1), kind: "unknown" }]),
		},
		{
			name: "overlapping leaves",
			codeMap: rawCodeMap([
				codeEntry("fenced", 0, 2),
				codeEntry("indented", 1, 3),
			]),
		},
		{
			name: "range outside source",
			codeMap: rawCodeMap([codeEntry("fenced", 0, 2)]),
		},
		{
			name: "available leaf without content",
			codeMap: rawCodeMap([
				{ endLine: 1, kind: "fenced", startLine: 0, status: "available" },
			]),
		},
		{
			name: "unavailable leaf without stable code",
			codeMap: rawCodeMap([
				{
					endLine: 1,
					kind: "fenced",
					startLine: 0,
					status: "unavailable",
				},
			]),
		},
		{
			name: "response-owned signature",
			codeMap: { ...rawCodeMap(), signature: "untrusted" },
		},
		{
			name: "unexpected map key",
			codeMap: { ...rawCodeMap(), extra: true },
		},
		{
			name: "unexpected entry key",
			codeMap: rawCodeMap([{ ...codeEntry("fenced", 0, 1), extra: true }]),
		},
	])("rejects $name in a code body map", async ({ codeMap }) => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(validResponse({ codeMap })),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it("rejects code maps above the entry or UTF-8 content limits", async () => {
		const tooManyEntries = Array.from(
			{ length: MAX_PREVIEW_CODE_MAP_ENTRIES + 1 },
			(_, index) => codeEntry("fenced", index, index + 1),
		);
		const tooMany = createWordPressPreviewPort(
			vi
				.fn()
				.mockResolvedValue(
					validResponse({ codeMap: rawCodeMap(tooManyEntries) }),
				),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);
		await expect(
			tooMany.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});

		const tooMuchContent = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					codeMap: rawCodeMap([
						codeEntry(
							"fenced",
							0,
							1,
							"x".repeat(MAX_PREVIEW_CODE_MAP_CONTENT_BYTES + 1),
						),
					]),
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);
		await expect(
			tooMuchContent.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it.each([
		null,
		{ html: 7, features: {}, editMap: rawEditMap() },
		{ html: markedHtml("b0"), features: [], editMap: rawEditMap() },
		{ html: markedHtml("b0"), features: { toc: "yes" }, editMap: rawEditMap() },
		{ html: markedHtml("b0"), features: {}, editMap: null },
		{
			html: markedHtml("b0"),
			features: {},
			editMap: { version: 2, coordinate: "line", blocks: [] },
		},
		{
			html: markedHtml("b0"),
			features: {},
			editMap: { version: 1, coordinate: "byte", blocks: [] },
		},
		{
			html: markedHtml("b0"),
			features: {},
			editMap: { version: 1, coordinate: "line", blocks: {} },
		},
	])("rejects an invalid response shape", async (response) => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(response),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);
		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it("adds the client request signature without trusting a response signature", async () => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(
				validResponse({
					editMap: { ...rawEditMap(), signature: "server-controlled" },
				}),
			),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it("validates CRLF-safe line ranges and binds the map to that request", async () => {
		const crlfRequest = {
			...request,
			markdown: "# One\r\n\r\n# Two",
			signature: "crlf-signature",
		};
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue({
				html: markedHtml("b0", "b1"),
				features: {},
				editMap: rawEditMap([block("b0", 0, 1), block("b1", 2, 3)]),
			}),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(crlfRequest, new AbortController().signal),
		).resolves.toMatchObject({
			editMap: {
				version: 1,
				coordinate: "line",
				signature: "crlf-signature",
				blocks: [block("b0", 0, 1), block("b1", 2, 3)],
			},
		});
	});

	it.each([
		{
			name: "invalid block id",
			blocks: [block("source-0", 0, 1)],
		},
		{
			name: "duplicate block id",
			blocks: [block("b0", 0, 1), block("b0", 1, 2)],
		},
		{
			name: "overlapping ranges",
			blocks: [block("b0", 0, 2), block("b1", 1, 3)],
		},
		{
			name: "backward ranges",
			blocks: [block("b0", 2, 3), block("b1", 1, 2)],
		},
		{
			name: "negative range",
			blocks: [block("b0", -1, 1)],
		},
		{
			name: "non-integer range",
			blocks: [block("b0", 0, 1.5)],
		},
		{
			name: "range outside request",
			blocks: [block("b0", 1, 2)],
		},
		{
			name: "editable zero-length range",
			blocks: [block("b0", 0, 0, true)],
		},
	])("rejects $name in the edit map", async ({ blocks }) => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue({
				html: markedHtml(...blocks.map(({ id }) => id)),
				features: {},
				editMap: rawEditMap(blocks),
			}),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it("allows a zero-length non-editable generated block", async () => {
		const generatedRequest = {
			...request,
			markdown: "[TOC]\n\n# Heading",
			signature: "generated-signature",
		};
		const blocks = [block("b0", 0, 0, false), block("b1", 2, 3)];
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue({
				html: markedHtml("b0", "b1"),
				features: {},
				editMap: rawEditMap(blocks),
			}),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(generatedRequest, new AbortController().signal),
		).resolves.toMatchObject({
			editMap: { signature: "generated-signature", blocks },
		});
	});

	it("rejects a map above the bounded block limit before HTML traversal", async () => {
		const blocks = Array.from(
			{ length: MAX_PREVIEW_EDIT_MAP_BLOCKS + 1 },
			(_, index) => block(`b${index}`, 0, 0, false),
		);
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue({
				html: markedHtml("b0"),
				features: {},
				editMap: rawEditMap(blocks),
			}),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it.each([
		["missing top-level marker", "<p>Preview</p>"],
		["wrong top-level marker", markedHtml("b1")],
		["extra top-level marker", markedHtml("b0", "b1")],
	])("rejects HTML/map mismatch: %s", async (_name, html) => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue(validResponse({ html })),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it.each(["__proto__", "prototype", "constructor"])(
		"rejects prototype-reserved edit map key %s",
		async (key) => {
			const editMap = JSON.parse(
				`{"version":1,"coordinate":"line","blocks":[{"id":"b0","startLine":0,"endLine":1,"editable":true}],"${key}":true}`,
			) as Record<string, unknown>;
			const port = createWordPressPreviewPort(
				vi.fn().mockResolvedValue(validResponse({ editMap })),
				"/wp-json/easymde/v1/preview",
				"nonce",
				"https://example.test/wp-admin/post.php",
			);

			await expect(
				port.render(request, new AbortController().signal),
			).rejects.toMatchObject({
				name: "PreviewResponseError",
			});
		},
	);

	it("rejects prototype-reserved block keys", async () => {
		const reservedBlock = JSON.parse(
			'{"id":"b0","startLine":0,"endLine":1,"editable":true,"__proto__":true}',
		) as PreviewEditMapBlock;
		const port = createWordPressPreviewPort(
			vi
				.fn()
				.mockResolvedValue(
					validResponse({ editMap: rawEditMap([reservedBlock]) }),
				),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});

	it.each(["__proto__", "prototype", "constructor"])(
		"rejects the prototype-reserved response feature key %s",
		async (key) => {
			const features = JSON.parse(`{"${key}":true}`) as Record<string, boolean>;
			const port = createWordPressPreviewPort(
				vi.fn().mockResolvedValue(validResponse({ features })),
				"/wp-json/easymde/v1/preview",
				"nonce",
				"https://example.test/wp-admin/post.php",
			);

			await expect(
				port.render(request, new AbortController().signal),
			).rejects.toMatchObject({
				name: "PreviewResponseError",
			});
		},
	);

	it("rejects cross-origin and credentialed Preview endpoints before a request", () => {
		for (const endpoint of [
			"https://remote.example/wp-json/easymde/v1/preview",
			"https://user:password@example.test/wp-json/easymde/v1/preview",
		]) {
			expect(() =>
				createWordPressPreviewPort(
					vi.fn(),
					endpoint,
					"nonce",
					"https://example.test/wp-admin/post.php",
				),
			).toThrow("preview-url-invalid");
		}
	});

	it("rejects a response that omits editMap instead of accepting legacy HTML", async () => {
		const port = createWordPressPreviewPort(
			vi.fn().mockResolvedValue({ html: markedHtml("b0"), features: {} }),
			"/wp-json/easymde/v1/preview",
			"nonce",
			"https://example.test/wp-admin/post.php",
		);

		await expect(
			port.render(request, new AbortController().signal),
		).rejects.toMatchObject({
			name: "PreviewResponseError",
		});
	});
});
