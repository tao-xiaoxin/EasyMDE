import { describe, expect, it, vi } from "vitest";

import {
	EDITOR_MARKDOWN_BLOCK_KIND_ORDER,
	type EditorBlockIndexWorkerResponse,
	type ReferenceLabelCaseFoldProfile,
	MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES,
} from "../contracts/ports/editor-block-index-port";
import {
	createEditorBlockIndexWorkerHandler,
	type EditorBlockIndexWorkerBuildResult,
	registerEditorBlockIndexWorkerScope,
} from "./editor-block-index-worker";
import * as blockIndex from "../features/editor-context-menu/editor-markdown-block-index";
import { validateData } from "../integrations/browser/editor-context-menu/editor-block-index-worker-protocol";

function packedBuild(source: string, _profile: ReferenceLabelCaseFoldProfile): EditorBlockIndexWorkerBuildResult {
	const blocks = new Int32Array([0, source.length, 0, 0, 4, 1]);
	const mathSpans = new Int32Array();
	const images = new Int32Array([0, 0, 0]);
	const links = new Int32Array();
	return {
		data: {
			blockCount: 1,
			blocks: blocks.buffer,
			format: "packed-v3",
			imageCount: 0,
			images: images.buffer,
			length: source.length,
			linkCount: 0,
			links: links.buffer,
			mathSpanCount: 0,
			mathSpans: mathSpans.buffer,
		},
		transfer: [blocks.buffer, mathSpans.buffer, images.buffer, links.buffer],
	};
}

describe("editor block-index worker entry", () => {
	it.each([
		["ASCII references", "[label][REF]\n\n[ref]: /target", 1],
		["ordinary Unicode prose", "Unicode prose: Straße and 汉字.", 0],
	])("builds %s under an unsupported profile", (_label, source, linkCount) => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message));
		handler({ data: { generation: 1, revision: 2, source, type: "build", referenceLabelCaseFoldProfile: "unsupported" } });
		const result = messages[0];
		if (result?.type !== "result") throw new Error("result-missing");
		expect(result.data.linkCount).toBe(linkCount);
	});

	it("reports unsupported non-ASCII reference folding without a packed result", () => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message));
		handler({ data: { generation: 3, revision: 4, source: "[label][Straße]\n\n[STRASSE]: /target", type: "build", referenceLabelCaseFoldProfile: "unsupported" } });
		expect(messages).toEqual([{ type: "error", generation: 3, revision: 4, code: "editor-block-index-reference-profile-unavailable" }]);
	});

	it("maps only the exact reference-profile error and redacts other failures", () => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		let detail = "visual-editor-reference-label-fold-profile-unavailable";
		const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message), () => { throw new Error(detail); });
		const request = { generation: 1, revision: 2, source: "abc", type: "build", referenceLabelCaseFoldProfile: "unsupported" };
		handler({ data: request });
		detail += "-private-detail";
		handler({ data: request });
		expect(messages).toEqual([
			{ type: "error", generation: 1, revision: 2, code: "editor-block-index-reference-profile-unavailable" },
			{ type: "error", generation: 1, revision: 2, code: "editor-block-index-build-failed" },
		]);
	});
	it.each([13, "unsupported"] as const)("passes the request profile %s to the production index builder", (profile) => {
		const build = vi.spyOn(blockIndex, "createEditorMarkdownBlockIndex");
		try {
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message));
			handler({ data: { generation: 1, revision: 1, source: "abc", type: "build", referenceLabelCaseFoldProfile: profile } });
			expect(build).toHaveBeenCalledWith("abc", { referenceLabelCaseFoldProfile: profile });
			expect(messages[0]?.type).toBe("result");
		} finally {
			build.mockRestore();
		}
	});
	it.each([11, 13, 14, 16, 17, "unsupported"] as const)(
		"passes the explicit reference fold profile %s to its build owner",
		(profile) => {
			const build = vi.fn(packedBuild);
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message), build);
			handler({ data: { generation: 1, revision: 1, source: "abc", type: "build", referenceLabelCaseFoldProfile: profile } });
			expect(build).toHaveBeenCalledWith("abc", profile);
			expect(messages[0]?.type).toBe("result");
		},
	);

	it.each([undefined, null, 12, 15, 18, "14", true])(
		"rejects an invalid reference fold profile %#",
		(profile) => {
			const build = vi.fn(packedBuild);
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message), build);
			handler({ data: { generation: 1, revision: 1, source: "abc", type: "build", referenceLabelCaseFoldProfile: profile } });
			expect(build).not.toHaveBeenCalled();
			expect(messages).toEqual([{ code: "editor-block-index-worker-profile-invalid", generation: 1, revision: 1, type: "error" }]);
		},
	);
	it("rejects an omitted reference fold profile", () => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) => messages.push(message));
		handler({ data: { generation: 1, revision: 2, source: "abc", type: "build" } });
		expect(messages).toEqual([{ code: "editor-block-index-worker-profile-invalid", generation: 1, revision: 2, type: "error" }]);
	});
	it("packs a thematic break with the appended kind code without changing existing codes", () => {
		const source = "before\n  ***  \nafter";
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) =>
			messages.push(message),
		);

		handler({
			data: { generation: 3, revision: 7, source, type: "build", referenceLabelCaseFoldProfile: 14 },
		});

		const result = messages[0];
		if ("result" !== result?.type) throw new Error("result-missing");
		const words = Array.from(new Int32Array(result.data.blocks));
		const fields = 6;
		const ruleOffset = fields;

		expect(EDITOR_MARKDOWN_BLOCK_KIND_ORDER.slice(0, 8)).toEqual([
			"code",
			"heading",
			"list",
			"math",
			"paragraph",
			"quote",
			"table",
			"unavailable",
		]);
		expect(EDITOR_MARKDOWN_BLOCK_KIND_ORDER[words[ruleOffset + 4] ?? -1]).toBe(
			"thematic-break",
		);
		expect(words.slice(ruleOffset, ruleOffset + fields)).toEqual([
			source.indexOf("  ***"),
			source.indexOf("  ***") + "  ***  ".length,
			1,
			1,
			EDITOR_MARKDOWN_BLOCK_KIND_ORDER.indexOf("thematic-break"),
			1,
		]);
	});

	it("returns packed-v3 data with transferable buffers in the production path", () => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const transfers: Array<ReadonlyArray<Transferable>> = [];
		const handler = createEditorBlockIndexWorkerHandler((message, transfer) => {
			messages.push(message);
			transfers.push(transfer ?? []);
		}, packedBuild);

		handler({
			data: { generation: 3, revision: 7, source: "abc", type: "build", referenceLabelCaseFoldProfile: 14 },
		});

		const result = messages[0];
		if ("result" !== result?.type) throw new Error("result-missing");
		const packed = result?.data as unknown as { format?: unknown };
		if ("packed-v3" !== packed?.format)
			throw new Error("packed-result-missing");
		expect(packed.format).toBe("packed-v3");
		expect(JSON.stringify(result)).not.toContain("abc");
		expect(transfers[0]).toHaveLength(4);
	});

	it("packs prepared link candidates without echoing any source text", () => {
		const source = 'Before [caption](https://source.test "a)b") after';
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) =>
			messages.push(message),
		);

		handler({
			data: { generation: 1, revision: 2, source, type: "build", referenceLabelCaseFoldProfile: 14 },
		});

		const result = messages[0];
		if ("result" !== result?.type) throw new Error("result-missing");
		const from = source.indexOf("[caption]");
		const to = source.indexOf("after") - 1;
		expect(result.data.linkCount).toBe(1);
		expect(Array.from(new Int32Array(result.data.links))).toEqual([
			from,
			to,
			0,
			source.length,
			0,
			0,
		]);
		expect(JSON.stringify(result)).not.toContain("caption");
	});

	it("forwards production scope transfers and detaches source buffers", () => {
		let listener = (_event: { data: unknown }): void => {
			throw new Error("production-worker-listener-missing");
		};
		let sent: EditorBlockIndexWorkerResponse | null = null;
		let delivered: EditorBlockIndexWorkerResponse | null = null;
		const scope = {
			addEventListener(
				_type: "message",
				handler: (event: { data: unknown }) => void,
			): void {
				listener = handler;
			},
			postMessage(
				message: EditorBlockIndexWorkerResponse,
				transfer?: Transferable[],
			): void {
				sent = message;
				delivered = structuredClone(message, { transfer: transfer ?? [] });
			},
		};
		registerEditorBlockIndexWorkerScope(scope, packedBuild);
		listener({
			data: { generation: 3, revision: 7, source: "abc", type: "build", referenceLabelCaseFoldProfile: 14 },
		});

		if (!sent || !delivered)
			throw new Error("production-worker-result-missing");
		const sentResult = sent as Extract<
			EditorBlockIndexWorkerResponse,
			{ type: "result" }
		>;
		const deliveredResult = delivered as Extract<
			EditorBlockIndexWorkerResponse,
			{ type: "result" }
		>;
		const sentData = sentResult.data;
		const deliveredData = deliveredResult.data;
		expect(sentData.blocks.byteLength).toBe(0);
		expect(sentData.mathSpans.byteLength).toBe(0);
		expect(sentData.images.byteLength).toBe(0);
		expect(deliveredData.blocks.byteLength).toBeGreaterThan(0);
		expect(deliveredData.mathSpans.byteLength).toBe(0);
		expect(deliveredData.images.byteLength).toBeGreaterThan(0);
		expect(deliveredResult.generation).toBe(3);
		expect(deliveredResult.revision).toBe(7);
	});

	it("reports malformed requests and parser failures with stable codes", () => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler(
			(message) => messages.push(message),
			() => {
				throw new Error("parser detail must not cross the worker boundary");
			},
		);

		handler({ data: { generation: 1, revision: 1, source: "abc" } });
		handler({
			data: { generation: 1, revision: 1, source: "abc", type: "build", referenceLabelCaseFoldProfile: 14 },
		});

		expect(messages).toEqual([
			{ code: "editor-block-index-worker-request-invalid", type: "error" },
			{
				code: "editor-block-index-build-failed",
				generation: 1,
				revision: 1,
				type: "error",
			},
		]);
	});

	it("rejects a source above the authoritative byte bound without parsing it", () => {
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) =>
			messages.push(message),
		);
		const source = "😀".repeat(
			Math.ceil(MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES / 4) + 1,
		);

		handler({ data: { generation: 4, revision: 9, source, type: "build", referenceLabelCaseFoldProfile: 14 } });

		expect(messages).toEqual([
			{
				code: "editor-block-index-source-too-large",
				generation: 4,
				revision: 9,
				type: "error",
			},
		]);
	});

	it.each([
		["R23-2a cross-paragraph inline math with bold", "\\(a\n\n**word!** \\)"],
		["R23-2b cross-paragraph inline math plain", "\\(a\n\nword \\)"],
		["R23-2a CRLF cross-paragraph inline math", "\\(a\r\n\r\n**word!** \\)"],
		["R24A #1 quoted indented block math", ">     $$x\n**word**$$"],
		["R25A #1 empty list item indented code", "-\n\n    **word** $x$"],
		["R25A #1 CRLF empty list item indented code", "-\r\n\r\n    **word** $x$"],
		["R25A #1 quoted empty list item indented code", "> -\n> \n>     **word** $x$"],
		["R25A #1 CRLF quoted empty list item indented code", "> -\r\n> \r\n>     **word** $x$"],
		["R26A #2 single-char-remainder nested empty list indented code", "-  -\n\n      **word** $x$"],
		["R26A #2 CRLF single-char-remainder nested empty list indented code", "-  -\r\n\r\n      **word** $x$"],
		["R26B #1a empty list item + paragraph + indented code", "-\n\n  para\n\n    **word** $x$"],
		["R26B #1a CRLF empty list item + paragraph + indented code", "-\r\n\r\n  para\r\n\r\n    **word** $x$"],
		["R26B #1 #3 quoted empty list item block math spanning paragraph", "> -\n>\n>     $$\n\nhello **word** $$"],
		["R26B #1 #3 CRLF quoted empty list item block math spanning paragraph", "> -\r\n>\r\n>     $$\r\n\r\nhello **word** $$"],
		["R25A #2 same-line consecutive ref defs with math", "[a]\n\n[b]: /b [a]: **word**$$x$$"],
		["R25A #2 CRLF same-line consecutive ref defs with math", "[a]\r\n\r\n[b]: /b [a]: **word**$$x$$"],
		["pipe inside inline math table header", "| $a | **word** b$ |\n| --- | --- |"],
		["quote with block math and cross-paragraph inline math", "> $$a$$\n> \\(b\n\nword\\)"],
		["R27B #2a same-container nested ordered list paragraph", "1. ab\n   2. c\n\n       **word** $x$"],
		["R27B #2a CRLF same-container nested ordered list paragraph", "1. ab\r\n   2. c\r\n\r\n       **word** $x$"],
		["R27B #2b textarea HTML block after paragraph", "para\n<textarea>\n$x$\n</textarea>"],
		["R27B #2b CRLF textarea HTML block after paragraph", "para\r\n<textarea>\r\n$x$\r\n</textarea>"],
		["R27B #2b lowercase doctype HTML block", "<!doctype html\n$x$\n>"],
		["R27B #2b lowercase CDATA HTML block", "<![cdata[\n$x$\n]]>"],
		["R27B #2b self-closing pre Type-7 HTML block", "<pre/>\n$x$"],
	])(
		"round-trips %s through worker packing and protocol validation without invalid-result errors",
		async (_label, source) => {
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) =>
				messages.push(message),
			);
			handler({
				data: {
					generation: 1,
					referenceLabelCaseFoldProfile: 14,
					revision: 1,
					source,
					type: "build",
				},
			});
			const response = messages[0];
			expect(response?.type).toBe("result");
			if ("result" !== response?.type) throw new Error("worker-result-missing");
			const validated = await validateData(response.data, source, () => false);
			expect(validated.status).toBe("valid");
		},
	);
	it.each([
		["<pre/>\n$$x$$", 1],
		["<pre/>\n$x$", 0],
		["<div>\n$$x$$", 1],
		["<div>\n$x$", 0],
		["<textarea>\n$$x$$\n</textarea>", 0],
		["<!doctype html\n$$x$$\n>", 0],
		["<![cdata[\n$$x$$\n]]>", 0],
		["<!--\n$$x$$\n-->", 0],
		["<pre/>\r\n$$x$$", 1],
		["<div>\r\n$x$", 0],
	] as const)(
		"R28A #3 packs %j with %i block-math span(s) and validates",
		async (source, mathSpanCount) => {
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) =>
				messages.push(message),
			);
			handler({
				data: { generation: 1, referenceLabelCaseFoldProfile: 14, revision: 1, source, type: "build" },
			});
			const response = messages[0];
			if ("result" !== response?.type) throw new Error("worker-result-missing");
			expect(response.data.mathSpanCount).toBe(mathSpanCount);
			const validated = await validateData(response.data, source, () => false);
			expect(validated.status).toBe("valid");
		},
	);
	it.each([
		["R29B #1 4-space indented quote math", "> a\n>\n    > $x$\n\n$z$", 1],
		["R29B #1 tab indented quote math", "> a\n>\n\t> $x$\n\n$z$", 1],
		["R29B #1 4-space indented quote unclosed backtick", "> a\n>\n    > `code\n\n$z$\n\n`", 1],
		["R29B #1 4-space indented quote unclosed $$", "> a\n>\n    > $$\n\n$z$\n\n$$", 1],
		["R29A #1 div + block math + comment math", "<div>\n$$x$$\n<!-- $$y$$ -->", 1],
		["R29A #2 pre/> + block math + inline math", "<pre/>\n$$x$$\n$y$", 2],
		["R29B #3.1 div + block + inline + para inline", "<div>\n$$x$$\n$y$\n\n$z$", 3],
		["R29B #3.1 pre/> + block + inline + para inline", "<pre/>\n$$x$$\n$y$\n\n$z$", 3],
		["R29B #3.1 same-line div + block + inline", "<div> $$x$$ $y$", 2],
		["R29B #3.1 div + block math + prose", "<div>\n$$x$$\nhello", 1],
		["R29B #3.2 closed Type-1 pre + block + inline", "<pre>foo</pre> $$x$$\n\n$z$", 2],
		["R29B #3.2 closed Type-2 comment + block + inline", "<!-- c --> $$x$$\n\n$z$", 2],
		["R29B #3.2 closed Type-4 doctype + block + inline", "<!DOCTYPE html> $$x$$\n\n$z$", 2],
		["R29B #3.2 closed Type-3 PI + block + inline", "<?php ?> $$x$$\n\n$z$", 2],
		["R29B #3.2 closed Type-5 CDATA + block + inline", "<![CDATA[x]]> $$x$$\n\n$z$", 2],
		["R29B #3.2 block math eating comment close", "<!--\n$$x\n-->\n$$\n\n$z$", 0],
		["R29B #3.3 unfragmented div with inline math", "<div>\n$x$\n</div>", 0],
		["R28A #3 pre/> + block math", "<pre/>\n$$x$$", 1],
		["R28A #3 pre/> + inline math", "<pre/>\n$x$", 0],
		["R28A #3 textarea + block math", "<textarea>\n$$x$$\n</textarea>", 0],
		["R28A #3 doctype + block math", "<!doctype html\n$$x$$\n>", 0],
		["R28A #3 cdata + block math", "<![cdata[\n$$x$$\n]]>", 0],
		["R28A #3 comment + block math", "<!--\n$$x$$\n-->", 0],
	] as const)(
		"R29 packs %s (LF & CRLF) with %i math span(s) and validates cleanly",
		async (_label, lfSource, mathSpanCount) => {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const messages: EditorBlockIndexWorkerResponse[] = [];
				const handler = createEditorBlockIndexWorkerHandler((message) =>
					messages.push(message),
				);
				handler({
					data: { generation: 1, referenceLabelCaseFoldProfile: 14, revision: 1, source, type: "build" },
				});
				const response = messages[0];
				if ("result" !== response?.type) throw new Error("worker-result-missing");
				expect(response.data.mathSpanCount, JSON.stringify(source)).toBe(mathSpanCount);
				const validated = await validateData(response.data, source, () => false);
				expect(validated.status, JSON.stringify(source)).toBe("valid");
				if ("valid" === validated.status && "<div>\n$x$\n</div>" === lfSource) {
					expect(validated.value.blocks).toHaveLength(1);
					expect(validated.value.blocks[0]).toMatchObject({
						editable: false,
						from: 0,
						kind: "unavailable",
						to: source.length,
					});
				}
			}
		},
	);

	it.each([
		["R30A #1 div + block + inline HTML attr math + inline", '<div>\n$$x$$\nA <i title="$y$">word</i> $z$', 2],
		["R30A #1 div + block + span title math", '<div>\n$$x$$\n<span title="$y$">hi</span>', 1],
		["R30A #1 div + block + inline HTML comment math", "<div>\n$$x$$\na <!-- $y$ --> b", 1],
		["R30B #2 standalone span title math", '<span title="$y$">hi</span>', 0],
		["R30B #2 positive control math between tags", "<span>$y$</span>", 1],
		["R30B #2 inline HTML comment math", "a <!-- $y$ --> b", 0],
		["R30B #2 inline PI math", "a <?php $y$ ?> b", 0],
		["R30B #1 block math creates custom HTML block", "para\n$$x$$\n<custom>\n$y$\n</custom>", 1],
		["R30B #1 block math creates div HTML block", "para $$x$$ <div>\n$y$", 1],
		["R30B #1 block math creates comment HTML block", "para $$x$$ <!--\n$y$\n-->", 1],
		["R30B #1 block math creates pre HTML block", "para $$x$$ <pre>\n$y$\n</pre>", 1],
		["R30B #1 block math breaks link ref title", '[a]: /url "$$x$$"\n\n[a]', 1],
		["R30B #1 block math splits link ref destination", "[a]: /$$x$$\n\n[a]", 1],
		["R30B #1 block math inside link ref label", "[$$x$$]: /url\n\n[$$x$$]", 2],
		["R30B #1 block math exposes link ref def", "para $$x$$ [ref]: /url\n\n[ref]", 1],
		["R30B #1 block math exposes ATX heading", "para $$x$$ # heading", 1],
		["R30B #1 block math exposes blockquote", "para $$x$$ > quote", 1],
		["R30B #1 block math exposes thematic break", "para $$x$$ ---", 1],
		["R30B #1 block math splits heading and paragraph", "# h $$b$$ t", 1],
		["R30B #1 quote with block math", "> $$x$$", 1],
		["R30B #1 list with block math", "- $$x$$", 1],
	] as const)(
		"R30 packs %s (LF & CRLF) with %i math span(s) and validates cleanly",
		async (_label, lfSource, mathSpanCount) => {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const messages: EditorBlockIndexWorkerResponse[] = [];
				const handler = createEditorBlockIndexWorkerHandler((message) =>
					messages.push(message),
				);
				handler({
					data: { generation: 1, referenceLabelCaseFoldProfile: 14, revision: 1, source, type: "build" },
				});
				const response = messages[0];
				if ("result" !== response?.type) throw new Error("worker-result-missing");
				expect(response.data.mathSpanCount, JSON.stringify(source)).toBe(mathSpanCount);
				const validated = await validateData(response.data, source, () => false);
				expect(validated.status, JSON.stringify(source)).toBe("valid");
			}
		},
	);

	it("R30A #2 packs and validates the 220 KB single-line HTML+math benchmark well under 1.5 s", async () => {
		const source = `<div> ${"$$x$$ word ".repeat(20_000).trimEnd()}`;
		expect(source.length).toBe(220_005);
		const startedAt = performance.now();
		const messages: EditorBlockIndexWorkerResponse[] = [];
		const handler = createEditorBlockIndexWorkerHandler((message) =>
			messages.push(message),
		);
		handler({
			data: { generation: 1, referenceLabelCaseFoldProfile: 14, revision: 1, source, type: "build" },
		});
		const response = messages[0];
		if ("result" !== response?.type) throw new Error("worker-result-missing");
		expect(response.data.mathSpanCount).toBe(20_000);
		expect(response.data.blockCount).toBe(40_001);
		const validated = await validateData(response.data, source, () => false);
		const elapsedMs = performance.now() - startedAt;

		expect(validated.status).toBe("valid");
		expect(elapsedMs).toBeLessThan(1_500);
	});

	it.each([
		["R31 #1 space after <", "A < x $y$ > and $z$", 2],
		["R31 #2 uppercase tag", 'a <SPAN title="$x$">hi</SPAN> b', 1],
		["R31 #3 uppercase attribute", 'a <span TITLE="$x$">hi</span> b', 1],
		["R31 #4 short self-closing comment", "a <!---> $x$ --> b", 1],
		["R31 #5 double dash inside comment", "a <!-- -- $x$ --> b", 0],
		["R31 #6 trailing dash before comment close", "a <!-- $x$ ---> b", 0],
		["R31 #7 lowercase doctype declaration", "a <!doctype $x$> b", 0],
		["R31 #8 space in self-close / >", 'a <br title="$x$"/ > b', 1],
		["R31 #9 underscore in tag name", 'a <a_b title="$x$">hi</a_b>', 1],
		["R31 CDATA", "a <![CDATA[$x$]]> b", 0],
		["R31 processing instruction", "a <? $x$ ?> b", 0],
		["R31 angle autolink", "a <https://example.com/$x$> b", 1],
		["R31 valid lowercase anchor tag", 'a <a href="$x$">hi</a> b', 0],
	] as const)(
		"R31 packs %s (LF & CRLF) with %i math span(s) and validates cleanly",
		async (_label, lfSource, mathSpanCount) => {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const messages: EditorBlockIndexWorkerResponse[] = [];
				const handler = createEditorBlockIndexWorkerHandler((message) =>
					messages.push(message),
				);
				handler({
					data: {
						generation: 1,
						referenceLabelCaseFoldProfile: 14,
						revision: 1,
						source,
						type: "build",
					},
				});
				const response = messages[0];
				if ("result" !== response?.type) {
					throw new Error("worker-result-missing");
				}
				expect(response.data.mathSpanCount, JSON.stringify(source)).toBe(
					mathSpanCount,
				);
				const validated = await validateData(response.data, source, () => false);
				expect(validated.status, JSON.stringify(source)).toBe("valid");
			}
		},
	);

	it("R31B #2 packs 30 KB and 100 KB space runs with and without math in linear time (< 200 ms)", async () => {
		const runs = [
			{ expectedMath: 0, source: `a${" ".repeat(30_000)}b` },
			{ expectedMath: 1, source: `$x$ ${" ".repeat(30_000)}b` },
			{ expectedMath: 0, source: `a${" ".repeat(100_000)}b` },
			{ expectedMath: 1, source: `$x$ ${" ".repeat(100_000)}b` },
		];
		for (const run of runs) {
			const startedAt = performance.now();
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) =>
				messages.push(message),
			);
			handler({
				data: {
					generation: 1,
					referenceLabelCaseFoldProfile: 14,
					revision: 1,
					source: run.source,
					type: "build",
				},
			});
			const response = messages[0];
			if ("result" !== response?.type) {
				throw new Error("worker-result-missing");
			}
			const validated = await validateData(
				response.data,
				run.source,
				() => false,
			);
			const elapsedMs = performance.now() - startedAt;
			expect(response.data.mathSpanCount).toBe(run.expectedMath);
			expect(validated.status).toBe("valid");
			expect(elapsedMs).toBeLessThan(200);
		}
	});

	it("R32A #2 & R32B #2 pack and validate 64k links + math, 5k nested **, 64k unmatched brackets, 10k unclosed link tails, and 64k autolinks without timeout or stack overflow", async () => {
		const links64k = `A ${"[a](/url) ".repeat(64_000)}$z$`;
		const runs: ReadonlyArray<
			Readonly<{
				expectedLinks?: number;
				expectedMath: number;
				label: string;
				maxMs: number;
				source: string;
			}>
		> = [
			{
				expectedLinks: 64_000,
				expectedMath: 1,
				label: "64k links + $z$ (640 KB)",
				maxMs: 4_000,
				source: links64k,
			},
			{
				expectedMath: 0,
				label: "5k nested ** (zero stack overflow)",
				maxMs: 500,
				source: `${"**".repeat(5_000)}x${"**".repeat(5_000)}`,
			},
			{
				expectedMath: 0,
				label: "64k unmatched ]",
				maxMs: 500,
				source: "]".repeat(64_000),
			},
			{
				expectedMath: 0,
				label: "10k unclosed angle URL [a](<",
				maxMs: 500,
				source: "[a](<".repeat(10_000),
			},
			{
				expectedMath: 0,
				label: "10k unclosed single-quote title [a](x '",
				maxMs: 500,
				source: "[a](x '".repeat(10_000),
			},
			{
				expectedLinks: 64_000,
				expectedMath: 0,
				label: "64k GFM autolinks",
				maxMs: 2_000,
				source: "https://a.com ".repeat(64_000),
			},
		];

		for (const run of runs) {
			const startedAt = performance.now();
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) =>
				messages.push(message),
			);
			handler({
				data: {
					generation: 1,
					referenceLabelCaseFoldProfile: 14,
					revision: 1,
					source: run.source,
					type: "build",
				},
			});
			const response = messages[0];
			if ("result" !== response?.type) {
				throw new Error(`worker-result-missing:${run.label}`);
			}
			const validated = await validateData(
				response.data,
				run.source,
				() => false,
			);
			const elapsedMs = performance.now() - startedAt;
			expect(validated.status, run.label).toBe("valid");
			expect(response.data.mathSpanCount, run.label).toBe(run.expectedMath);
			if (undefined !== run.expectedLinks) {
				expect(response.data.linkCount, run.label).toBe(run.expectedLinks);
			}
			if ("valid" === validated.status && run.source === links64k) {
				const span = validated.value.mathSpans[0];
				expect(span).toBeDefined();
				if (span) {
					expect(links64k.slice(span.from, span.to)).toBe("$z$");
				}
			}
			expect(
				elapsedMs,
				`${run.label}: ${elapsedMs.toFixed(1)}ms`,
			).toBeLessThan(run.maxMs);
		}
	});

	it("R33A #2 & R33B #1 #3 pack escaped/balanced bare URLs and deeply nested blockquotes/lists in O(N) time", async () => {
		const runs: ReadonlyArray<
			Readonly<{
				expectedBlocks?: number;
				expectedMath: number;
				label: string;
				maxMs: number;
				source: string;
			}>
		> = [
			{
				expectedMath: 0,
				label: "32k [a](x\\) (224 KB)",
				maxMs: 600,
				source: "[a](x\\)".repeat(32_000),
			},
			{
				expectedMath: 0,
				label: "32k [a](x\\) + trailing ) (224 KB)",
				maxMs: 600,
				source: `${"[a](x\\)".repeat(32_000)} ! )`,
			},
			{
				expectedMath: 0,
				label: "16k [a](x() + trailing ) (112 KB)",
				maxMs: 400,
				source: `${"[a](x()".repeat(16_000)} ! )`,
			},
			{
				expectedBlocks: 1,
				expectedMath: 0,
				label: "200x 500-deep blockquotes",
				maxMs: 300,
				source: `${"> ".repeat(500)}a\n`.repeat(200),
			},
			{
				expectedBlocks: 1,
				expectedMath: 1,
				label: "4000-deep blockquote + $x$",
				maxMs: 200,
				source: `${"> ".repeat(4_000)}$x$`,
			},
			{
				expectedBlocks: 1,
				expectedMath: 1,
				label: "2000-deep bullet list + $x$",
				maxMs: 200,
				source: `${"- ".repeat(2_000)}$x$`,
			},
			{
				expectedBlocks: 1,
				expectedMath: 1,
				label: "101-deep blockquote + $x$ preserves math=1",
				maxMs: 200,
				source: `${"> ".repeat(101)}$x$`,
			},
			{
				expectedBlocks: 2,
				expectedMath: 0,
				label: "100-deep blockquote followed by root heading",
				maxMs: 200,
				source: `${"> ".repeat(100)}a\n# heading`,
			},
		];

		for (const run of runs) {
			const startedAt = performance.now();
			const messages: EditorBlockIndexWorkerResponse[] = [];
			const handler = createEditorBlockIndexWorkerHandler((message) =>
				messages.push(message),
			);
			handler({
				data: {
					generation: 1,
					referenceLabelCaseFoldProfile: 14,
					revision: 1,
					source: run.source,
					type: "build",
				},
			});
			const response = messages[0];
			if ("result" !== response?.type) {
				throw new Error(`worker-result-missing:${run.label}`);
			}
			const validated = await validateData(
				response.data,
				run.source,
				() => false,
			);
			const elapsedMs = performance.now() - startedAt;
			expect(validated.status, run.label).toBe("valid");
			expect(response.data.mathSpanCount, run.label).toBe(run.expectedMath);
			if (undefined !== run.expectedBlocks) {
				expect(response.data.blockCount, run.label).toBe(run.expectedBlocks);
			}
			expect(
				elapsedMs,
				`${run.label}: ${elapsedMs.toFixed(1)}ms`,
			).toBeLessThan(run.maxMs);
		}
	});

	it.each([
		[
			"R33B #3 same-line consecutive LinkReference",
			'[a]\n\n[b]: /b [a]: /url "$x$"',
			0,
			1,
		],
		[
			"R33B #3 escaped-quote LinkReference title close",
			'[a]: /a "hi\\"\n$x$\n\n[a]',
			1,
			1,
		],
		[
			"R33B #3 entity-quote LinkReference title close",
			'[a]: /a "hi&quot;\n$x$\n\n[a]',
			1,
			1,
		],
	] as const)(
		"matches League CommonMark 2.8.2 LinkReference leaf parsing for %s (LF & CRLF)",
		async (_label, lfSource, expectedMath, expectedLinks) => {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const messages: EditorBlockIndexWorkerResponse[] = [];
				const handler = createEditorBlockIndexWorkerHandler((message) =>
					messages.push(message),
				);
				handler({
					data: {
						generation: 1,
						referenceLabelCaseFoldProfile: 14,
						revision: 1,
						source,
						type: "build",
					},
				});
				const response = messages[0];
				if ("result" !== response?.type) {
					throw new Error("worker-result-missing");
				}
				expect(response.data.mathSpanCount, JSON.stringify(source)).toBe(
					expectedMath,
				);
				expect(response.data.linkCount, JSON.stringify(source)).toBe(
					expectedLinks,
				);
				const validated = await validateData(
					response.data,
					source,
					() => false,
				);
				expect(validated.status, JSON.stringify(source)).toBe("valid");
			}
		},
	);
});
