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
});
