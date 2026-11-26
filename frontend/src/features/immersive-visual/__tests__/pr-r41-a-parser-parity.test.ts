import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocumentSession } from "../../document-source/editor-document-session";
import { nodesSemanticallyEqual } from "../markdown-node-alignment";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "../markdown-parser";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { createVisualCanonicalSync } from "../visual-canonical-sync";
import { createVisualClipboardPlugin } from "../visual-clipboard-and-paste";
import { visualEditorSchema } from "../visual-schema";

// Every expected Markdown serialization, link title, and anchor count below
// was verified against real PHP `EasyMDE\Content\MarkdownRenderer::render()`.

function findTextPos(doc: ProseMirrorNode, needle: string): number {
	let found = -1;
	doc.descendants((node, pos) => {
		if (found >= 0 || !node.isText || !node.text) return found < 0;
		const idx = node.text.indexOf(needle);
		if (idx >= 0) {
			found = pos + idx;
			return false;
		}
		return true;
	});
	expect(found, `Could not find "${needle}" in doc`).toBeGreaterThanOrEqual(0);
	return found;
}

function collectLinkTitles(markdown: string): unknown[] {
	const titles: unknown[] = [];
	parseMarkdownToVisualDoc(markdown).descendants((node) => {
		const link = node.marks.find((m) => m.type.name === "link");
		if (link && node.isText) titles.push(link.attrs.title);
	});
	return titles;
}

/** Removes top-level block 0 and the first item of the list at `listIdx`. */
function deleteFirstBlockAndFirstItem(
	doc: ProseMirrorNode,
	listIdx: number,
): ProseMirrorNode {
	const children: ProseMirrorNode[] = [];
	for (let i = 1; i < doc.childCount; i += 1) {
		const child = doc.child(i);
		if (i !== listIdx) {
			children.push(child);
			continue;
		}
		const items: ProseMirrorNode[] = [];
		for (let k = 1; k < child.childCount; k += 1) items.push(child.child(k));
		children.push(child.type.create(child.attrs, items));
	}
	return doc.type.create(null, children);
}

function timeSerialize(
	md: string,
	listIdx: number,
): Readonly<{ elapsedMs: number; serialized: string }> {
	const parsed = parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	const edited = deleteFirstBlockAndFirstItem(guard.initialDoc, listIdx);
	const startedAt = performance.now();
	const serialized = guard.serialize(edited);
	return { elapsedMs: performance.now() - startedAt, serialized };
}

function createPasteView(markdown: string): EditorView {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return new EditorView(host, {
		state: EditorState.create({
			doc: parseMarkdownToVisualDoc(markdown),
			plugins: [createVisualClipboardPlugin()],
			schema: visualEditorSchema,
		}),
	});
}

function pastePlainText(view: EditorView, cursor: number, text: string): void {
	view.dispatch(
		view.state.tr.setSelection(TextSelection.create(view.state.doc, cursor)),
	);
	const event = new Event("paste", {
		bubbles: true,
		cancelable: true,
	}) as ClipboardEvent;
	Object.defineProperty(event, "clipboardData", {
		value: {
			files: [],
			getData: (type: string) => (type === "text/plain" ? text : ""),
			items: [],
		},
	});
	const handled = view.someProp("handlePaste", (handler) =>
		handler(view, event, view.state.doc.slice(0, 0)),
	);
	expect(handled).toBe(true);
}

describe("PR-R41-A container-slot separator SSOT, O(N) list liveness, paste link re-keying, and semantic canonical sync", () => {
	describe("1. One shared container-slot separator decision for liveness and serialization (Track B #1)", () => {
		it("escalates lazy continuation after an edited blockquote so the Setext partial title is never silently lost", () => {
			const md = '> # heading\n$$x$$ [p]: /u\n"t\n===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const blockquote = guard.initialDoc.child(0);
			const children: ProseMirrorNode[] = [
				blockquote.type.create(blockquote.attrs, [
					visualEditorSchema.nodes.paragraph.create(
						null,
						visualEditorSchema.text("hello"),
					),
				]),
			];
			for (let i = 1; i < guard.initialDoc.childCount; i += 1) {
				children.push(guard.initialDoc.child(i));
			}
			const serialized = guard.serialize(
				guard.initialDoc.type.create(null, children),
			);
			expect(serialized).toBe(
				'> hello\n\n$$x$$\n\n[p]: /u\n\n"t\n===\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(["t\n"]);
		});

		it("does not inherit a tight separator from a paired list that cannot enter the preservable path", () => {
			const md =
				'1. \\(a\n1. b\\)\n   # h\n$$x$$ [p]: /u\n"t\n===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const at = findTextPos(guard.initialDoc, "h") + 1;
			const state = EditorState.create({
				doc: guard.initialDoc,
				schema: visualEditorSchema,
			});
			const edited = state.apply(state.tr.insertText("2", at)).doc;
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				'1. \\(a\n1. b\\)\n   # h2\n\n$$x$$\n\n[p]: /u\n\n"t\n===\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(["t\n"]);
		});
	});

	describe("2. Single-invalidation ordered lists scale O(K) via batched first-item re-validation (Track A #1 + Track B #2)", () => {
		it("does not re-validate item 0 per trailing item when item 0 has no partial-title candidate (N=100/200/400)", () => {
			for (const count of [100, 200, 400] as const) {
				const items = ["9. remove", "10. keep"];
				while (items.length < count + 2) {
					items.push(`${items.length + 9}. [gone]`);
				}
				const md = `[gone]: /gone\n\n[r]: /u\n"Partial\n===\n\n${items.join("\n")}\n\n[r]`;
				const { elapsedMs, serialized } = timeSerialize(md, 3);
				expect(serialized, `N=${count}`).toMatch(
					/^\[r\]: \/u\n"Partial\n===\n\n9\. keep\n10\. \[gone\]\(\/gone\)\n/,
				);
				expect(serialized.endsWith(`. [gone](/gone)\n\n[r]`)).toBe(true);
				expect(elapsedMs, `N=${count}`).toBeLessThan(1500);
			}
		});

		it("scales linearly for K=50/100/200/400 with and without a partial-title candidate in item 0", () => {
			for (const withCandidate of [false, true] as const) {
				for (const count of [50, 100, 200, 400] as const) {
					const items = [
						"1. first",
						withCandidate ? '2. [r]: /u\n   "t\n   ===' : "2. keep",
					];
					while (items.length < count + 1) {
						items.push(`${items.length + 1}. [dead]`);
					}
					const prefix = withCandidate ? "intro" : '[q]: /u\n"Q\n===';
					const md = `[dead]: /d\n\n${prefix}\n\n${items.join("\n\n")}\n\n${withCandidate ? "[r]" : "[q]"}`;
					const { elapsedMs, serialized } = timeSerialize(
						md,
						withCandidate ? 2 : 3,
					);
					const label = `candidate=${String(withCandidate)} K=${count}`;
					expect(serialized, label).toBe(
						[
							prefix,
							withCandidate ? '1. [r]: /u\n   "t\n   ===' : "1. keep",
							...Array.from(
								{ length: count - 1 },
								(_, i) => `${i + 2}. [dead](/d)`,
							),
							withCandidate ? "[r]" : "[q]",
						].join("\n\n"),
					);
					expect(collectLinkTitles(serialized).pop(), label).toBe(
						withCandidate ? "t\n" : "Q\n",
					);
					expect(elapsedMs, label).toBeLessThan(1500);
				}
			}
		});
	});

	describe("3. Plain-text Markdown paste re-keys link boundaries (Track A #2)", () => {
		it("keeps pasted links distinct from each other and from an adjacent existing link", () => {
			const view = createPasteView("[x](/u)\n\n[c](/u)");
			try {
				pastePlainText(
					view,
					findTextPos(view.state.doc, "c"),
					"[a](/u)[b](/u)",
				);
				expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
					"[x](/u)\n\n[a](/u)[b](/u)[c](/u)",
				);
			} finally {
				view.destroy();
				view.dom.parentElement?.remove();
			}
		});

		it("keeps one formatted pasted link as one link while staying distinct from its neighbours", () => {
			const view = createPasteView("[x](/u)\n\n[c](/u)");
			try {
				pastePlainText(
					view,
					findTextPos(view.state.doc, "c"),
					"[a **bold** `code`](/u)[b](/u)",
				);
				const markdown = serializeVisualDocToMarkdown(view.state.doc);
				expect(markdown).toBe(
					"[x](/u)\n\n[a **bold** `code`](/u)[b](/u)[c](/u)",
				);
				expect(
					nodesSemanticallyEqual(
						parseMarkdownToVisualDoc(markdown),
						view.state.doc,
					),
				).toBe(true);
			} finally {
				view.destroy();
				view.dom.parentElement?.remove();
			}
		});

		it("re-keys links flattened into a table cell paste", () => {
			const view = createPasteView("| h |\n| --- |\n| [x](/u)[c](/u) |");
			try {
				pastePlainText(
					view,
					findTextPos(view.state.doc, "c"),
					"[a](/u)[b](/u)",
				);
				expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
					"| h |\n| --- |\n| [x](/u)[a](/u)[b](/u)[c](/u) |",
				);
			} finally {
				view.destroy();
				view.dom.parentElement?.remove();
			}
		});
	});

	describe("4. Canonical sync ignores non-semantic boundaryKey shifts (Track B #5)", () => {
		const rekeyLinks = (
			node: ProseMirrorNode,
			key: string,
		): ProseMirrorNode => {
			if (node.isText) {
				return node.mark(
					node.marks.map((mark) =>
						mark.type.name === "link"
							? mark.type.create({
									...mark.attrs,
									boundaryKey: `${key}:${String(mark.attrs.boundaryKey)}`,
								})
							: mark,
					),
				);
			}
			const children: ProseMirrorNode[] = [];
			node.forEach((child) => {
				children.push(rekeyLinks(child, key));
			});
			return node.copy(Fragment.from(children));
		};

		const createSync = (markdown: string) => {
			let value = markdown;
			const applyTextChange = vi.fn((change: Readonly<{ value: string }>) => {
				value = change.value;
				return { from: 0, to: value.length };
			});
			const documentSession = {
				document: {
					applyTextChange,
					getRevision: () => 1,
					getSelection: () => ({ direction: "forward", end: 0, start: 0 }),
					getValue: () => value,
					redo: () => false,
					undo: () => false,
				},
			} as unknown as EditorDocumentSession;
			const onCanonicalChange = vi.fn();
			const sync = createVisualCanonicalSync({
				documentSession,
				isCompositionBusy: () => false,
				onCanonicalChange,
				onFailure: vi.fn(),
			});
			const host = document.createElement("div");
			document.body.appendChild(host);
			return { applyTextChange, host, onCanonicalChange, sync };
		};

		it("hits the zero-write fast path for a semantically identical document", () => {
			const markdown = "first\n\n[a](/u)[b](/u)";
			const { applyTextChange, host, onCanonicalChange, sync } =
				createSync(markdown);
			const acceptedDoc = sync.getAcceptedDoc();
			const view = new EditorView(host, {
				state: EditorState.create({
					doc: acceptedDoc,
					schema: visualEditorSchema,
				}),
			});
			try {
				sync.attach(view);
				const rekeyed = rekeyLinks(acceptedDoc, "dom");
				expect(rekeyed.eq(acceptedDoc)).toBe(false);
				const nextState = EditorState.create({
					doc: rekeyed,
					schema: visualEditorSchema,
				});
				expect(sync.commit(view.state, nextState)).toEqual({
					ok: true,
					revision: 1,
				});
				expect(sync.getAcceptedDoc()).toBe(acceptedDoc);
				expect(applyTextChange).not.toHaveBeenCalled();
				expect(onCanonicalChange).not.toHaveBeenCalled();
			} finally {
				view.destroy();
				host.remove();
				sync.dispose();
			}
		});

		it("preserves unchanged suffix nodes with shifted boundaryKeys during reconcile", () => {
			const markdown = "first\n\n[a](/u)[b](/u)";
			const { host, sync } = createSync(markdown);
			const rekeyed = rekeyLinks(sync.getAcceptedDoc(), "dom");
			const view = new EditorView(host, {
				state: EditorState.create({ doc: rekeyed, schema: visualEditorSchema }),
			});
			try {
				sync.attach(view);
				const oldSuffix = view.state.doc.child(1);
				expect(
					sync.reconcile("first edited\n\n[a](/u)[b](/u)", 2, {
						direction: "forward",
						end: 0,
						start: 0,
					}),
				).toBe(true);
				expect(view.state.doc.child(0).textContent).toBe("first edited");
				expect(view.state.doc.child(1)).toBe(oldSuffix);
			} finally {
				view.destroy();
				host.remove();
				sync.dispose();
			}
		});
	});
});
