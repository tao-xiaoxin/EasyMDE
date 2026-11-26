import { joinBackward } from "prosemirror-commands";
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
import { createMarkdownRoundTripGuard } from "../markdown-serializer";
import { createVisualCanonicalSync } from "../visual-canonical-sync";
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

function countLinks(doc: ProseMirrorNode): number {
	let count = 0;
	let prevKey: unknown = Symbol("none");
	doc.descendants((node) => {
		if (!node.isText) {
			prevKey = Symbol("none");
			return true;
		}
		const link = node.marks.find((m) => m.type.name === "link");
		if (!link) {
			prevKey = Symbol("none");
			return true;
		}
		const key = JSON.stringify(link.attrs);
		if (key !== prevKey) count += 1;
		prevKey = key;
		return true;
	});
	return count;
}

/** Returns `parent` with child `idx` replaced (or removed when `null`). */
function withChild(
	parent: ProseMirrorNode,
	idx: number,
	replacement: ProseMirrorNode | null,
): ProseMirrorNode {
	const children: ProseMirrorNode[] = [];
	for (let i = 0; i < parent.childCount; i += 1) {
		if (i !== idx) children.push(parent.child(i));
		else if (replacement) children.push(replacement);
	}
	return parent.type.create(parent.attrs, children);
}

function insertTextAt(
	doc: ProseMirrorNode,
	at: number,
	text: string,
	to = at,
): ProseMirrorNode {
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.insertText(text, at, to)).doc;
}

/**
 * `M` cascading 3-item ordered lists (each item 0 declares the next
 * partial-title label, each trailing item references the previous label)
 * plus one `K`-item list whose trailing items reference every cascade label.
 * The edit deletes the leading `[c0]` definition and every list's first item.
 */
function buildCascade(m: number, k: number, sink: boolean): string {
	const parts = ["[c0]: /u0"];
	for (let i = 0; i < m; i += 1) {
		parts.push(`sep${i}`);
		parts.push(
			`9. remove\n10. [c${i + 1}]: /u${i + 1}\n    "t${i + 1}\n    ===\n11. [x${i}]: /x${i}\n    "T${i} [c${i}]" z`,
		);
	}
	parts.push("sepbig");
	const big = ["9. remove", '10. [big]: /b\n    "tb\n    ==='];
	for (let j = 0; j < k; j += 1) big.push(`${11 + j}. [c${(j % m) + 1}]`);
	parts.push(big.join("\n"));
	const refs: string[] = [];
	for (let i = 1; i <= m; i += 1) refs.push(`[c${i}] [x${i - 1}]`);
	if (!sink) refs.push("[big]");
	parts.push(refs.join(" "));
	return parts.join("\n\n");
}

function serializeCascadeEdit(
	md: string,
): Readonly<{ elapsedMs: number; serialized: string }> {
	const guard = createMarkdownRoundTripGuard(
		md,
		parseMarkdownWithBlockSources(md),
	);
	const doc = guard.initialDoc;
	const children: ProseMirrorNode[] = [];
	for (let i = 1; i < doc.childCount; i += 1) {
		const child = doc.child(i);
		if (child.type.name !== "ordered_list") {
			children.push(child);
			continue;
		}
		const items: ProseMirrorNode[] = [];
		for (let x = 1; x < child.childCount; x += 1) items.push(child.child(x));
		children.push(child.type.create(child.attrs, items));
	}
	const edited = doc.type.create(null, children);
	const startedAt = performance.now();
	const serialized = guard.serialize(edited);
	return { elapsedMs: performance.now() - startedAt, serialized };
}

function rekeyLinks(node: ProseMirrorNode, key: string): ProseMirrorNode {
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
}

function createSync(markdown: string) {
	let value = markdown;
	const applyTextChange = vi.fn(
		(change: Readonly<{ historySelectionBefore?: unknown; value: string }>) => {
			value = change.value;
			return { from: 0, to: value.length };
		},
	);
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
	const sync = createVisualCanonicalSync({
		documentSession,
		isCompositionBusy: () => false,
		onCanonicalChange: vi.fn(),
		onFailure: vi.fn(),
	});
	const host = document.createElement("div");
	document.body.appendChild(host);
	const setValue = (next: string): void => {
		value = next;
	};
	return { applyTextChange, getValue: () => value, host, setValue, sync };
}

describe("PR-R42-A liveness tail/verbatim parity, list discovery order, prioritized list drain, accepted-doc identity, and reconcile link re-keying", () => {
	describe("1. Liveness follows a preserved non-verbatim container's actual tail (Track B #1)", () => {
		it("uses the preserved trailing list item indent so the Setext partial title is never silently lost", () => {
			const md =
				'10. # a\n1. # b\n12. # c\n\n   $$x$$ [p]: /u\n"t\n===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const list = guard.initialDoc.child(0);
			const serialized = guard.serialize(
				withChild(guard.initialDoc, 0, withChild(list, 2, null)),
			);
			expect(serialized).toBe(
				'10. # a\n1. # b\n\n$$x$$\n\n[p]: /u\n\n"t\n===\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(["t\n"]);
		});

		it("keeps a preserved blockquote's trailing blank `>` line so no lazy-continuation escalation inlines the reference", () => {
			const md = '> # a\n> p\n>\n$$x$$ [p]: /u\n"t\n===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const at = findTextPos(guard.initialDoc, "a") + 1;
			const serialized = guard.serialize(
				insertTextAt(guard.initialDoc, at, "2"),
			);
			expect(serialized).toBe(
				'> # a2\n>\n> p\n>\n$$x$$ [p]: /u\n"t\n===\n\n[link][p]',
			);
			expect(collectLinkTitles(serialized)).toEqual(["t\n"]);
		});
	});

	describe("2. List-internal partial-title refdefs register before list reuse resolves (Track B #2)", () => {
		it("predicts the loose list's first-item break exactly as the final serializer, keeping [a]'s Setext title", () => {
			const md =
				'1. remove\n\n2. [a]: /a\n   "TitleA\n   ===\n3. [b]: /b\n   "TitleB" x\n\n[linkA][a] [linkB][b]';
			const guard = createMarkdownRoundTripGuard(md);
			const at = findTextPos(guard.initialDoc, '"TitleB" x') + 9;
			let doc = insertTextAt(guard.initialDoc, at, "y", at + 1);
			doc = withChild(doc, 0, withChild(doc.child(0), 0, null));
			const serialized = guard.serialize(doc);
			expect(serialized).toBe(
				'1. [a]: /a\n\n   # "TitleA\n2. [b]: /b\n   "TitleB" y\n\n[linkA](/a "TitleA&#10;") [linkB][b]',
			);
			expect(collectLinkTitles(serialized)).toEqual(["TitleA\n", "TitleB"]);
		});
	});

	describe("3. Swallow guards trust only a verbatim-emitted adjacent list (Track B #3)", () => {
		it("keeps a wide-indented paragraph top-level after its list is canonicalized by refdef invalidation", () => {
			const md = "[dead]: /d\n\n1.   [dead]\n\n   paragraph after list";
			const guard = createMarkdownRoundTripGuard(md);
			const serialized = guard.serialize(withChild(guard.initialDoc, 0, null));
			expect(serialized).toBe("1. [dead](/d)\n\nparagraph after list");
			const doc = parseMarkdownToVisualDoc(serialized);
			expect(doc.childCount).toBe(2);
			expect(doc.child(1).type.name).toBe("paragraph");
		});

		it("keeps the top-level Setext heading and the partial title after an invalidated wide-indented list", () => {
			const md =
				'[dead]: /d\n\n1.   [dead]\n\n   [p]: /u\n"t\n===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const serialized = guard.serialize(withChild(guard.initialDoc, 0, null));
			expect(serialized).toBe('1. [dead](/d)\n\n[p]: /u\n"t\n===\n\n[link][p]');
			expect(collectLinkTitles(serialized)).toEqual([null, "t\n"]);
			const doc = parseMarkdownToVisualDoc(serialized);
			expect(doc.child(doc.childCount - 2).type.name).toBe("heading");
		});
	});

	describe("4. Dirty lists drain one at a time, smallest non-sink first (Track B #4)", () => {
		it("serializes a small cascade exactly", () => {
			const { serialized } = serializeCascadeEdit(buildCascade(2, 4, false));
			expect(serialized).toBe(
				[
					"sep0",
					'9. [c1]: /u1\n   "t1\n   ===\n10. [x0]: /x0\n    "T0 [c0](/u0)" z',
					"sep1",
					'9. [c2]: /u2\n   "t2\n   ===\n11. [x1]: /x1\n    "T1 [c1]" z',
					"sepbig",
					'9. [big]: /b\n   "tb\n   ===\n11. [c1]\n12. [c2]\n13. [c1]\n14. [c2]',
					'[c1] [x0](/x0 "T0 [c0]") [c2] [x1] [big]',
				].join("\n\n"),
			);
		});

		it("scales linearly for M=50/K=200 and M=100/K=400 with a sink and a non-sink big list", () => {
			for (const sink of [true, false] as const) {
				for (const [m, k] of [
					[50, 200],
					[100, 400],
				] as const) {
					const { elapsedMs, serialized } = serializeCascadeEdit(
						buildCascade(m, k, sink),
					);
					const label = `sink=${String(sink)} M=${m} K=${k}`;
					expect(serialized.startsWith("sep0\n\n9. [c1]: /u1\n"), label).toBe(
						true,
					);
					expect(serialized, label).toContain(`\n${10 + k}. [c${m}]`);
					expect(elapsedMs, label).toBeLessThan(1500);
				}
			}
		});
	});

	describe("5. Every accepted-doc comparison ignores non-semantic boundaryKey shifts (Track B #5)", () => {
		it("maps selections, records history selection, and settles pending commits on a re-keyed doc", () => {
			const markdown = "first\n\n[a](/u)[b](/u)";
			const { applyTextChange, getValue, host, sync } = createSync(markdown);
			const acceptedDoc = sync.getAcceptedDoc();
			const rekeyed = rekeyLinks(acceptedDoc, "dom");
			expect(rekeyed.eq(acceptedDoc)).toBe(false);
			expect(nodesSemanticallyEqual(rekeyed, acceptedDoc)).toBe(true);
			const view = new EditorView(host, {
				state: EditorState.create({ doc: rekeyed, schema: visualEditorSchema }),
			});
			try {
				sync.attach(view);
				const caret = TextSelection.create(rekeyed, 6);
				expect(sync.mapSelection(caret)).toMatchObject({ end: 5, start: 5 });

				expect(sync.commitPending()).toBe(true);
				expect(applyTextChange).not.toHaveBeenCalled();

				const previousState = EditorState.create({
					doc: rekeyed,
					schema: visualEditorSchema,
					selection: caret,
				});
				const nextState = previousState.apply(
					previousState.tr.insertText("X", 6),
				);
				expect(sync.commit(previousState, nextState).ok).toBe(true);
				expect(applyTextChange).toHaveBeenCalledTimes(1);
				expect(
					applyTextChange.mock.calls[0]?.[0].historySelectionBefore,
				).toMatchObject({ end: 5, start: 5 });
				expect(getValue()).toBe("firstX\n\n[a](/u)[b](/u)");
			} finally {
				view.destroy();
				host.remove();
				sync.dispose();
			}
		});
	});

	describe("6. Reconcile re-keys spliced links so they never merge with preserved neighbours (Track A #1)", () => {
		for (const [label, initial, next] of [
			["prefix-edited", "[x](/v)\n\n[c](/u)", "[a](/u)\n\n[c](/u)"],
			["suffix-edited", "[a](/u)\n\n[x](/v)", "[a](/u)\n\n[c](/u)"],
		] as const) {
			it(`keeps two links after reconcile -> Backspace -> commit (${label})`, () => {
				const { getValue, host, setValue, sync } = createSync(initial);
				const view = new EditorView(host, {
					state: EditorState.create({
						doc: sync.getAcceptedDoc(),
						schema: visualEditorSchema,
					}),
				});
				try {
					sync.attach(view);
					setValue(next);
					expect(
						sync.reconcile(next, 2, {
							direction: "forward",
							end: 0,
							start: 0,
						}),
					).toBe(true);
					const before = view.state;
					const atSecond = before.doc.child(0).nodeSize + 1;
					const caretState = before.apply(
						before.tr.setSelection(TextSelection.create(before.doc, atSecond)),
					);
					let merged: EditorState | null = null;
					expect(
						joinBackward(caretState, (tr) => {
							merged = caretState.apply(tr);
						}),
					).toBe(true);
					if (merged === null) throw new Error("Backspace did not apply");
					const mergedState: EditorState = merged;
					expect(countLinks(mergedState.doc)).toBe(2);
					expect(sync.commit(before, mergedState).ok).toBe(true);
					expect(getValue()).toBe("[a](/u)[c](/u)");
				} finally {
					view.destroy();
					host.remove();
					sync.dispose();
				}
			});
		}
	});
});
