import { act, render } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

import type { PreviewEditMap } from "../../../contracts/ports/preview-request";
import type {
	DocumentHistoryState,
	DocumentSelection,
} from "../../document-source/adapters/code-mirror-document-session";
import { createCodeMirrorDocumentSession } from "../../document-source/adapters/code-mirror-document-session";
import { createNativeTitleSession } from "../../document-source/adapters/native-title-session";
import type { EditorDocumentSession } from "../../document-source/editor-document-session";
import { createEditorDocumentSession } from "../../document-source/editor-document-session";
import {
	createVisualMarkdownSourceRangeFromPreviewEditMap,
	serializeVisualMarkdownBlockFragment,
	visualSelectionSourceRangeForBlocks,
} from "../visual-markdown";
import type {
	ImmersiveVisualEditorRuntime,
	ImmersiveWindowAcceptedSnapshot,
} from "./ImmersiveVisualEditor";
import {
	WindowedImmersiveVisualEditor,
} from "./WindowedImmersiveVisualEditor";

function fixture(
	options: Readonly<{
		blockOverrides?: Readonly<Record<number, string>>;
		markupOverrides?: Readonly<Record<number, string>>;
		lineOverrides?: Readonly<Record<number, string>>;
		mounted?: ReadonlyArray<number>;
		nonEditable?: ReadonlyArray<number>;
		paragraphBlocks?: boolean;
		sourceLineEnding?: "\n" | "\r\n" | "\r";
		sourceBlockCount?: number;
	}> = {},
) {
	const mounted = options.mounted ?? [160];
	const sourceBlockCount = options.sourceBlockCount ?? 320;
	const nonEditable = new Set(options.nonEditable ?? []);
	const sourceBlocks = Array.from(
		{ length: sourceBlockCount },
		(_, index) =>
			options.blockOverrides?.[index] ??
			options.lineOverrides?.[index] ??
			`Line ${index}`,
	);
	const lineEnding = options.sourceLineEnding ?? "\n";
	let canonical = sourceBlocks.join(
		options.paragraphBlocks ? `${lineEnding}${lineEnding}` : lineEnding,
	);
	const sourceRangesPreviousEnd: number[] = [];
	const sourceRanges = sourceBlocks.map((block, index) => {
		const startLine =
			index === 0 ? 0 : (sourceRangesPreviousEnd[index - 1] ?? 0);
		const endLine = startLine + block.split(/\r\n|\r|\n/).length;
		sourceRangesPreviousEnd[index] =
			endLine + (options.paragraphBlocks ? 1 : 0);
		return { endLine, startLine };
	});
	const editMap: PreviewEditMap = {
		blocks: sourceRanges.map(({ endLine, startLine }, index) => {
			return {
				editable: !nonEditable.has(index),
				endLine,
				id: `b${index}`,
				startLine,
			};
		}),
		coordinate: "line",
		signature: "windowed",
		version: 1,
	};
	const surface = document.createElement("article");
	surface.contentEditable = "true";
	const firstMounted = mounted[0];
	const lastMounted = mounted[mounted.length - 1];
	if (undefined === firstMounted || undefined === lastMounted) {
		throw new Error("windowed-fixture-mounted-blocks-missing");
	}
	surface.innerHTML = [
		firstMounted > 0
			? '<div data-easymde-preview-window-spacer="1"></div>'
			: "",
		mounted
			.map(
				(index) =>
					options.markupOverrides?.[index] ??
					`<p data-easymde-visual-block-id="b${index}">${options.lineOverrides?.[index] ?? `Line ${index}`}</p>`,
			)
			.join(""),
		lastMounted < sourceBlockCount - 1
			? '<div data-easymde-preview-window-spacer="1"></div>'
			: "",
	].join("");
	document.body.append(surface);
	const listeners = new Set<() => void>();
	let currentSelection: DocumentSelection = {
		direction: "none",
		end: 0,
		start: 0,
	};
	let revision = 0;
	const documentChanges = vi.fn(
		(change: { selection: DocumentSelection; value: string }) => {
			canonical = change.value;
			revision += 1;
			for (const listener of listeners) listener();
		},
	);
	const applyTextChange = vi.fn(
		(change: { selection: DocumentSelection; value: string }) => {
			currentSelection = change.selection;
			if (change.value !== canonical) documentChanges(change);
		},
	);
	const documentSession = {
		document: {
			applyTextChange,
			canRedo: vi.fn(() => false),
			canUndo: vi.fn(() => false),
			getHistoryState: (): DocumentHistoryState => ({
				redoDepth: 0,
				undoDepth: 0,
			}),
			getRevision: () => revision,
			getValue: () => canonical,
			getSelection: () => currentSelection,
			redo: vi.fn(() => false),
			setVisualEditingActive: vi.fn(),
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			undo: vi.fn(() => false),
		},
	} as unknown as EditorDocumentSession;
	return {
		applyTextChange,
		canonical: () => canonical,
		documentChanges,
		documentSession,
		editMap,
		setCanonical: (value: string, notify = true) => {
			if (value !== canonical) revision += 1;
			canonical = value;
			if (notify) {
				for (const listener of listeners) listener();
			}
		},
		surface,
	};
}

function placeCaret(text: Text, offset: number): void {
	const range = document.createRange();
	range.setStart(text, offset);
	range.collapse(true);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function selectThematicBreak(
	surface: HTMLElement,
	direction: "backward" | "forward" = "forward",
): HTMLHRElement {
	const thematicBreak = surface.querySelector("hr");
	if (!(thematicBreak instanceof HTMLHRElement)) {
		throw new Error("windowed-thematic-break-missing");
	}
	const range = document.createRange();
	range.selectNode(thematicBreak);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	if ("backward" === direction) {
		selection?.setBaseAndExtent(
			surface,
			range.endOffset,
			surface,
			range.startOffset,
		);
	}
	return thematicBreak;
}

function textOffsetWithin(
	root: HTMLElement,
	node: Node,
	offset: number,
): number {
	const range = root.ownerDocument.createRange();
	range.selectNodeContents(root);
	range.setEnd(node, offset);
	return range.toString().length;
}

function expectConnectedCodeCaret(
	code: HTMLElement,
	expectedOffset: number,
): void {
	const selection = code.ownerDocument.defaultView?.getSelection();
	if (!selection?.anchorNode) throw new Error("windowed-code-caret-missing");
	expect(selection.isCollapsed).toBe(true);
	expect(selection.anchorNode.isConnected).toBe(true);
	expect(code.contains(selection.anchorNode)).toBe(true);
	expect(
		textOffsetWithin(code, selection.anchorNode, selection.anchorOffset),
	).toBe(expectedOffset);
}

const testPrepareWindowBlockAdoption = (): (() => boolean) => () => true;

/**
 * Isolated owned lease fixture: every acquisition returns a real lease with an
 * idempotent release, so the consumer must own and settle exactly what it took.
 * No no-op capability stands in for a missing runtime.
 */
function testRetainCompositionSurface(): Readonly<{ release: () => void }> {
	let released = false;
	return {
		release: () => {
			if (released) return;
			released = true;
		},
	};
}

const testDocumentEndPreviewRequest =
	(signature: string) => (_markdown: string) => ({
		release: vi.fn(),
		signature,
	});

const testDocumentEndPreviewRequestUsing =
	(requestPreview: (markdown: string) => string) => (markdown: string) => ({
		release: vi.fn(),
		signature: requestPreview(markdown),
	});

function dispatchBackspace(surface: HTMLElement): void {
	surface.dispatchEvent(
		new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "Backspace",
		}),
	);
	surface.dispatchEvent(
		new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		}),
	);
	const selection = window.getSelection();
	const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
	if (!range?.collapsed || !(range.startContainer instanceof Text)) {
		throw new Error("windowed-backspace-selection-missing");
	}
	if (range.startOffset < 1) throw new Error("windowed-backspace-at-start");
	const deletion = range.cloneRange();
	deletion.setStart(range.startContainer, range.startOffset - 1);
	deletion.deleteContents();
	const caret = surface.ownerDocument.createRange();
	caret.setStart(range.startContainer, range.startOffset - 1);
	caret.collapse(true);
	selection?.removeAllRanges();
	selection?.addRange(caret);
	surface.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			inputType: "deleteContentBackward",
		}),
	);
}

function renderWindowEditor(
	current: ReturnType<typeof fixture>,
	options: Readonly<{
		documentSession?: EditorDocumentSession;
		prepareWindowBlockAdoption?: (node: HTMLElement) => (() => boolean) | null;
		retainCompositionSurface?: () => Readonly<{ release: () => void }>;
			requestPreviewAtDocumentEnd?: (
				markdown: string,
				sourceSelection?: Readonly<{ end: number; start: number }>,
			) => Readonly<{
			release: () => void;
			signature: string;
		}>;
		onDiagnostic?: (code: string) => void;
		onFailure?: (code: string) => void;
		onTransferFailure?: () => void;
		onCanonicalDocumentChange?: () => void;
		onMarkdownChange?: () => void;
		onPendingChange?: (pending: boolean) => void;
		onReady?: (runtime: ImmersiveVisualEditorRuntime) => void;
		pending?: boolean;
		acceptedWindowSnapshotGeneration?: number;
		getAcceptedWindowSnapshot?: () => ImmersiveWindowAcceptedSnapshot | null;
		getGeneratedPreviewIdentity?: ImmersiveVisualEditorRuntime["getGeneratedPreviewIdentity"];
		prepareGeneratedContentTarget?: ImmersiveVisualEditorRuntime["prepareGeneratedContentTarget"];
		prepareGeneratedContentTargetForSelection?: ImmersiveVisualEditorRuntime["prepareGeneratedContentTargetForSelection"];
		prepareImageTarget?: ImmersiveVisualEditorRuntime["prepareImageTarget"];
		prepareImageTargetBySelection?: ImmersiveVisualEditorRuntime["prepareImageTargetBySelection"];
		requestPreview?: (markdown: string) => string;
	}> = {},
) {
	const onFailure = options.onFailure ?? vi.fn();
	const onTransferFailure = options.onTransferFailure ?? vi.fn();
	const onDiagnostic = options.onDiagnostic ?? vi.fn();
	const onPendingChange = options.onPendingChange ?? vi.fn();
	const requestPreview = options.requestPreview ?? vi.fn(() => "next");
	const requestPreviewAtDocumentEnd =
		options.requestPreviewAtDocumentEnd ??
		((markdown: string) => ({
			release: vi.fn(),
			signature: requestPreview(markdown),
		}));
	const prepareBlock = options.prepareWindowBlockAdoption ?? (() => () => true);
	const retainCompositionSurface =
		options.retainCompositionSurface ?? testRetainCompositionSurface;
	const componentProps = {
		documentSession: options.documentSession ?? current.documentSession,
		editMap: current.editMap,
		imagePasteUploadEnabled: false,
		imageUploadEnabled: false,
		onCanonicalDocumentChange: options.onCanonicalDocumentChange ?? vi.fn(),
		onDiagnostic,
		onDispose: vi.fn(),
		onFailure,
		onMarkdownChange: options.onMarkdownChange ?? vi.fn(),
		onPendingChange,
		onReady: options.onReady ?? vi.fn(),
		onTransferFailure,
		pending: options.pending ?? false,
		...(undefined !== options.acceptedWindowSnapshotGeneration
			? {
					acceptedWindowSnapshotGeneration:
						options.acceptedWindowSnapshotGeneration,
				}
			: {}),
		...(options.getAcceptedWindowSnapshot
			? { getAcceptedWindowSnapshot: options.getAcceptedWindowSnapshot }
			: {}),
		...(options.getGeneratedPreviewIdentity
			? { getGeneratedPreviewIdentity: options.getGeneratedPreviewIdentity }
			: {}),
		...(options.prepareGeneratedContentTarget
			? { prepareGeneratedContentTarget: options.prepareGeneratedContentTarget }
			: {}),
		...(options.prepareGeneratedContentTargetForSelection
			? {
					prepareGeneratedContentTargetForSelection:
						options.prepareGeneratedContentTargetForSelection,
				}
			: {}),
		...(options.prepareImageTarget
			? { prepareImageTarget: options.prepareImageTarget }
			: {}),
		...(options.prepareImageTargetBySelection
			? { prepareImageTargetBySelection: options.prepareImageTargetBySelection }
			: {}),
		previewSnapshot: { revision: 1, signature: "windowed" },
		previewStatus: "ready" as const,
		prepareWindowBlockAdoption: prepareBlock,
		retainCompositionSurface,
		requestPreview,
		requestPreviewAtDocumentEnd,
		surface: current.surface,
	};
	const view = render(<WindowedImmersiveVisualEditor {...componentProps} />);
	return {
		onDiagnostic,
		onFailure,
		onPendingChange,
		requestPreview,
		rerenderPreview: (
			editMap: PreviewEditMap,
			previewSnapshot: Readonly<{ revision: number; signature: string }>,
		) =>
			view.rerender(
				<WindowedImmersiveVisualEditor
					{...componentProps}
					editMap={editMap}
					previewSnapshot={previewSnapshot}
				/>,
			),
		view,
		rerenderAcceptedWindow: (generation: number) =>
			view.rerender(
				<WindowedImmersiveVisualEditor
					{...componentProps}
					acceptedWindowSnapshotGeneration={generation}
				/>,
			),
		// A same-source transfer states itself through the owner's pending
		// prop; the surface stays editable, exactly as the real producer does.
		rerenderPending: (nextPending: boolean) =>
			view.rerender(
				<WindowedImmersiveVisualEditor
					{...componentProps}
					pending={nextPending}
				/>,
			),
		rerenderPendingAcceptedWindow: (
			generation: number,
			nextPending: boolean,
		) =>
			view.rerender(
				<WindowedImmersiveVisualEditor
					{...componentProps}
					acceptedWindowSnapshotGeneration={generation}
					pending={nextPending}
				/>,
			),
		// One public-props render carrying a new map, its matching Preview
		// snapshot and the accepted window generation together. Splitting these
		// would let a later call overwrite the map with the original props.
		rerenderAcceptedWindowWithMap: (
			editMap: PreviewEditMap,
			previewSnapshot: Readonly<{ revision: number; signature: string }>,
			generation: number,
		) =>
			view.rerender(
				<WindowedImmersiveVisualEditor
					{...componentProps}
					acceptedWindowSnapshotGeneration={generation}
					editMap={editMap}
					previewSnapshot={previewSnapshot}
				/>,
			),
	};
}

function acceptedWindowSnapshotForMountedBlock(
	current: ReturnType<typeof fixture>,
	mountedBlock: HTMLElement,
): ImmersiveWindowAcceptedSnapshot {
	const blocks = Array.from(current.surface.children)
		.filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement &&
				!child.hasAttribute("data-easymde-preview-window-spacer"),
		)
		.map((node) => {
			if (node.getAttribute("data-easymde-visual-block-id") === "b160") {
				node = mountedBlock;
			}
			const id = node.getAttribute("data-easymde-visual-block-id");
			if (!id) throw new Error("windowed-certificate-block-id-missing");
			return {
				id,
				innerHTML: node.innerHTML,
				node,
			};
		});
	return {
		blocks,
		key: 1,
		nodes: Array.from(current.surface.childNodes),
		revision: 1,
		signature: "windowed",
	};
}

function renderCodeBodyEditor(
	initialFence: string,
	codeText: string,
	options: Readonly<{
		codeMarkup?: string;
		documentSession?: EditorDocumentSession;
		onFailure?: (code: string) => void;
		requestPreview?: (markdown: string) => string;
		sourceBlockCount?: number;
		onReady?: (runtime: ImmersiveVisualEditorRuntime) => void;
	}> = {},
) {
	const blockIndex = 160;
	const { codeMarkup, sourceBlockCount = 320, ...renderOptions } = options;
	const current = fixture({
		blockOverrides: { [blockIndex]: initialFence },
		markupOverrides: {
			[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>${codeMarkup ?? codeText}</code></pre>`,
		},
		mounted: [blockIndex],
		sourceBlockCount,
	});
	const initialMarkdown = current.canonical();
	const sourceStart = initialMarkdown.indexOf(initialFence);
	if (sourceStart < 0) throw new Error("windowed-code-body-source-missing");
	const rendered = renderWindowEditor(current, renderOptions);
	const code = current.surface.querySelector<HTMLElement>(
		`[data-easymde-visual-block-id="b${blockIndex}"] > code`,
	);
	if (!(code instanceof HTMLElement)) {
		throw new Error("windowed-code-body-code-missing");
	}
	return {
		...rendered,
		code,
		current,
		initialMarkdown,
		sourceStart,
	};
}

function mergeMountedBlocks(
	first: HTMLElement,
	second: HTMLElement,
	caretOffset: number,
): void {
	first.textContent = `${first.textContent ?? ""}${second.textContent ?? ""}`;
	second.remove();
	const text = first.firstChild;
	if (!(text instanceof Text)) throw new Error("windowed-merged-text-missing");
	placeCaret(text, caretOffset);
}

function dispatchCodeBodyDeletion(
	surface: HTMLElement,
	code: HTMLElement,
	options: Readonly<{
		inputType: string;
		postCaretOffset?: number | undefined;
		replacement?: string | undefined;
		removedLength: number;
		start: number;
		targetRanges?: "empty" | "explicit" | "missing";
		targetRangeEnd?: number;
		targetRangeStart?: number;
	}>,
): InputEvent {
	const textNodes: Text[] = [];
	const walker = code.ownerDocument.createTreeWalker(
		code,
		NodeFilter.SHOW_TEXT,
	);
	let node = walker.nextNode();
	while (node) {
		if (!(node instanceof Text)) {
			throw new Error("windowed-code-body-deletion-text-missing");
		}
		textNodes.push(node);
		node = walker.nextNode();
	}
	if (1 !== textNodes.length) {
		throw new Error("windowed-code-body-deletion-text-missing");
	}
	const text = textNodes[0];
	if (!text) throw new Error("windowed-code-body-deletion-text-missing");
	const backward = options.inputType.endsWith("Backward");
	const defaultCaret = backward
		? options.start + options.removedLength
		: options.start;
	placeCaret(text, options.targetRangeStart ?? defaultCaret);
	const beforeInput = new InputEvent("beforeinput", {
		bubbles: true,
		cancelable: true,
		inputType: options.inputType,
	});
	if ("missing" !== options.targetRanges) {
		Object.defineProperty(beforeInput, "getTargetRanges", {
			value: () => {
				if ("empty" === options.targetRanges) return [];
				const range = document.createRange();
				range.setStart(text, options.targetRangeStart ?? options.start);
				range.setEnd(
					text,
					options.targetRangeEnd ?? options.start + options.removedLength,
				);
				return [range];
			},
		});
	}
	surface.dispatchEvent(beforeInput);
	text.data =
		text.data.slice(0, options.start) +
		(options.replacement ?? "") +
		text.data.slice(options.start + options.removedLength);
	placeCaret(
		text,
		options.postCaretOffset ??
			options.start + (options.replacement?.length ?? 0),
	);
	surface.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			inputType: options.inputType,
		}),
	);
	return beforeInput;
}

describe("WindowedImmersiveVisualEditor", () => {
	it.each([
		{ language: "bash", position: "first", blockIndex: 1 },
		{ language: "python", position: "middle", blockIndex: 160 },
		{ language: "typescript", position: "end", blockIndex: 319 },
	])("test-first visual sequential deletion reaches the heading tail before Enter ($language, $position)", async ({ language, blockIndex }) => {
		// This unlocked visual surface has no literal fence glyphs: its empty
		// PRE command removes the delimiters. Keep deleting through the resulting
		// native paragraph boundary; a toolbar/remove-code call cannot stand in.
		const fence = `~~~${language}\nAB\n~~~`;
		const headingIndex = blockIndex - 1;
		const current = fixture({
			blockOverrides: { [headingIndex]: "### Before", [blockIndex]: fence },
			markupOverrides: {
				[headingIndex]: `<h3 data-easymde-visual-block-id="b${headingIndex}">Before</h3>`,
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-${language}">AB\n</code></pre>`,
			},
			mounted: blockIndex === 319 ? [headingIndex, blockIndex] : [headingIndex, blockIndex, blockIndex + 1],
			paragraphBlocks: true,
		});
		const original = current.canonical();
		const field = document.createElement("textarea");
		field.value = field.defaultValue = original;
		const container = document.createElement("div");
		document.body.append(container, field);
		const owner = createCodeMirrorDocumentSession({ container, label: "Markdown", submissionField: field });
		const session = createEditorDocumentSession(owner, createNativeTitleSession(null));
		session.registerSubmissionState({ appleFont: "system", codeTheme: "github", codeThemeExplicit: false, customCssId: "", customFont: "none", markdownTheme: "default", serifFont: "off", windowsFont: "system" });
		const rendered = renderWindowEditor(current, { documentSession: session });
		try {
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			current.surface.focus();
			const code = current.surface.querySelector("code");
			if (!(code instanceof HTMLElement)) throw new Error("sequence-code-missing");
			for (const [index, body] of ["A\n", "\n"].entries()) {
				act(() => {
					const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" });
					const text = code.firstChild;
					if (!(text instanceof Text)) throw new Error("sequence-body-text-missing");
					placeCaret(text, 2 - index);
					current.surface.dispatchEvent(key);
					if (!key.defaultPrevented) dispatchCodeBodyDeletion(current.surface, code, { inputType: "deleteContentBackward", removedLength: 1, start: 1 - index });
				});
				expect(owner.getValue()).toBe(original.replace(fence, `~~~${language}\n${body}~~~`));
				expectConnectedCodeCaret(code, 1 - index);
			}
			act(() => current.surface.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" })));
			const empty = current.surface.querySelector(`[data-easymde-visual-block-id="b${blockIndex}"]`);
			const heading = current.surface.querySelector("h3");
			const headingText = heading?.firstChild;
			if (!(empty instanceof HTMLParagraphElement) || !(heading instanceof HTMLElement) || !(headingText instanceof Text)) throw new Error("sequence-exit-prerequisite-missing");
			expect(empty.textContent).toBe("");
			const afterExit = owner.getValue();
			const headingTail = afterExit.indexOf("### Before") + "### Before".length;
			const emptyPoint = owner.getSelection().start;
			expect(afterExit.slice(headingTail, emptyPoint)).toMatch(/^\n+$/);
			// The serializer omits an empty P; removing its native boundary does
			// not normalize the canonical owner's pre-existing hidden blank lines.
			const afterExtraDelete = afterExit;
			act(() => {
				const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" });
				current.surface.dispatchEvent(key);
				if (key.defaultPrevented) return;
				const target = document.createRange();
				target.setStart(headingText, headingText.length);
				target.setEnd(empty, 0);
				const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" });
				Object.defineProperty(before, "getTargetRanges", { value: () => [target] });
				current.surface.dispatchEvent(before);
				if (!before.defaultPrevented) {
					empty.remove();
					placeCaret(headingText, headingText.length);
					current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
				}
			});
			expect.soft(owner.getValue()).toBe(afterExtraDelete);
			expect.soft(owner.getSelection()).toEqual({ direction: "none", start: headingTail, end: headingTail });
			const native = window.getSelection();
			expect.soft(native?.anchorNode?.isConnected).toBe(true);
			expect.soft(native?.anchorNode && heading.contains(native.anchorNode)).toBe(true);
			if (native?.anchorNode && heading.contains(native.anchorNode)) expect(textOffsetWithin(heading, native.anchorNode, native.anchorOffset)).toBe("Before".length);
			expect.soft(rendered.onFailure).not.toHaveBeenCalled();
			// Accept the real structural request before a deliberate later click.
			// A permanently held request would make that click invalidate the
			// pending lease and test rejection, not heading-tail Enter.
			const canonicalBlocks = original.split("\n\n");
			let sourceOffset = 0;
			const acceptedMap: PreviewEditMap = { ...current.editMap, signature: "next", blocks: current.editMap.blocks.filter((block) => block.id !== `b${blockIndex}`).map((block) => {
				const ordinal = Number.parseInt(block.id.slice(1), 10);
				const source = canonicalBlocks[ordinal];
				if (!source) throw new Error("sequence-accepted-source-missing");
				const offset = afterExtraDelete.indexOf(source, sourceOffset);
				if (offset < 0) throw new Error("sequence-accepted-source-range-missing");
				sourceOffset = offset + source.length;
				const startLine = afterExtraDelete.slice(0, offset).split("\n").length - 1;
				return { ...block, startLine, endLine: startLine + source.split("\n").length };
			}) };
			act(() => rendered.rerenderPreview(acceptedMap, { revision: 2, signature: "next" }));
			expect.soft(owner.getValue()).toBe(afterExtraDelete);
			expect.soft(owner.getSelection()).toEqual({ direction: "none", start: headingTail, end: headingTail });
			expect.soft(window.getSelection()?.anchorNode && heading.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
			if (window.getSelection()?.anchorNode && heading.contains(window.getSelection()?.anchorNode ?? null)) expect(textOffsetWithin(heading, window.getSelection()?.anchorNode as Node, window.getSelection()?.anchorOffset ?? -1)).toBe("Before".length);
			// Explicit user click at the heading end is a separate accepted action;
			// it does not repair or excuse the pre-Enter native-caret assertions.
			placeCaret(headingText, headingText.length);
			const paragraph = document.createElement("p");
			paragraph.append(document.createElement("br"));
			act(() => {
				const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
				current.surface.dispatchEvent(key);
				if (key.defaultPrevented) return;
				const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
				current.surface.dispatchEvent(before);
				if (!before.defaultPrevented) {
					heading.after(paragraph);
					window.getSelection()?.collapse(paragraph, 0);
					current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertParagraph" }));
				}
			});
			const afterEnter = owner.getValue();
			const point = owner.getSelection().start;
			expect.soft(point, "Enter owns a source point after the heading text").toBeGreaterThan(headingTail);
			expect.soft(afterEnter.slice(headingTail, point)).toMatch(/^\n+$/);
			expect.soft(afterEnter.replace(/\n/g, "")).toBe(afterExtraDelete.replace(/\n/g, ""));
			expect.soft(window.getSelection()?.anchorNode && heading.contains(window.getSelection()?.anchorNode ?? null)).toBe(false);
			for (const [index, data] of ["a", "b", "c"].entries()) {
				act(() => {
					const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data });
					current.surface.dispatchEvent(before);
					if (!before.defaultPrevented) {
						const range = window.getSelection()?.getRangeAt(0);
						if (!range) throw new Error("sequence-typing-range-missing");
						const text = document.createTextNode(data);
						range.insertNode(text);
						window.getSelection()?.collapse(text, 1);
					}
					current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data }));
				});
				const draft = "abc".slice(0, index + 1);
				expect.soft(owner.getValue()).toBe(afterEnter.slice(0, point) + draft + afterEnter.slice(point));
				expect.soft(owner.getSelection()).toEqual({ direction: "none", start: point + draft.length, end: point + draft.length });
				expect.soft(window.getSelection()?.anchorNode?.isConnected).toBe(true);
			}
			expect.soft(current.surface.textContent).toContain("abc");
			expect.soft(document.activeElement).toBe(current.surface);
			expect.soft(rendered.onFailure).not.toHaveBeenCalled();
			expect.soft(rendered.onDiagnostic).not.toHaveBeenCalled();
		} finally {
			rendered.view.unmount(); owner.destroy(); container.remove(); field.remove(); current.surface.remove();
		}
	});

	it("creates a current-surface caret for a cold-entry context menu", () => {
		const blockIndex = 160;
		const current = fixture({
			markupOverrides: {
				[blockIndex]: `<p data-easymde-visual-block-id="b${blockIndex}">Line ${blockIndex}</p>`,
			},
			mounted: [blockIndex],
		});
		const onFailure = vi.fn();
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector("p");
		if (!(paragraph instanceof HTMLElement) || !runtimeHolder.current) {
			throw new Error("windowed-cold-entry-context-fixture-missing");
		}
		window.getSelection()?.removeAllRanges();

		try {
			expect(
			runtimeHolder.current.prepareContextMenuSelection?.(paragraph, { x: 20, y: 20 }),
			).toBe(true);
			expect(onFailure).not.toHaveBeenCalled();
			expect(current.applyTextChange).toHaveBeenCalledOnce();
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("projects PRE endpoints through CODE content boundaries across mounted blocks", () => {
		const current = fixture({
			blockOverrides: {
				0: "~~~js\nAlpha\n~~~",
				1: "After",
			},
			markupOverrides: {
				0: '<pre data-easymde-visual-block-id="b0" '
					+ 'data-easymde-visual-fence="~~~" '
					+ 'data-easymde-visual-fence-info="js"><code>Alpha</code></pre>',
				1: '<p data-easymde-visual-block-id="b1">After</p>',
			},
			mounted: [0, 1],
			paragraphBlocks: true,
			sourceBlockCount: 2,
		});
		const { view } = renderWindowEditor(current);
		const pre = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b0"]',
		);
		const afterText = current.surface.querySelector(
			'[data-easymde-visual-block-id="b1"]',
		)?.firstChild;
		const blocks = Array.from(
			current.surface.querySelectorAll<HTMLElement>(
				'[data-easymde-visual-block-id]',
			),
		);
		if (!(pre instanceof HTMLElement)
			|| !(afterText instanceof Text)
			|| 2 !== blocks.length) {
			throw new Error("windowed-pre-boundary-fixture-invalid");
		}
		const selection = window.getSelection();
		selection?.setBaseAndExtent(afterText, 2, pre, 0);
		const source = current.canonical();
		const baseline = serializeVisualMarkdownBlockFragment(blocks);

		expect(
			visualSelectionSourceRangeForBlocks(blocks, source, baseline),
		).toEqual({
			direction: "backward",
			end: source.indexOf("After") + 2,
			start: source.indexOf("Alpha"),
		});
		view.unmount();
	});

	it.each([
		{ backward: false, direction: "forward" as const },
		{ backward: true, direction: "backward" as const },
	])(
		"maps an exact native thematic-break selection through the current ledger ($direction)",
		({ backward, direction }) => {
			const blockIndex = 160;
			const current = fixture({
				blockOverrides: { [blockIndex]: "---" },
				markupOverrides: {
					[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
				},
				mounted: [blockIndex],
			});
			const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
				current: null,
			};
			const rendered = renderWindowEditor(current, {
				onReady: (nextRuntime) => {
					runtimeHolder.current = nextRuntime;
				},
			});
			const thematicBreak = current.surface.querySelector("hr");
			if (!(thematicBreak instanceof HTMLHRElement)) {
				throw new Error("windowed-thematic-break-missing");
			}
			const nativeRange = document.createRange();
			nativeRange.selectNode(thematicBreak);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(nativeRange);
			if (backward) {
				selection?.setBaseAndExtent(
					current.surface,
					nativeRange.endOffset,
					current.surface,
					nativeRange.startOffset,
				);
			}

			try {
				const range = createVisualMarkdownSourceRangeFromPreviewEditMap(
					current.canonical(),
					current.editMap,
					{ end: blockIndex + 1, start: blockIndex },
				);
				expect(runtimeHolder.current?.prepareMediaSelection()).toBe(true);
				expect(current.applyTextChange).toHaveBeenCalledWith({
					selection: {
						direction,
						end: range.start + 3,
						start: range.start,
					},
					value: current.canonical(),
				});
			} finally {
				rendered.view.unmount();
				if (current.surface.isConnected) current.surface.remove();
			}
		},
	);

	it("routes a thematic-break context-menu selection through its dedicated owner", () => {
		const blockIndex = 160;
		const current = fixture({
			blockOverrides: { [blockIndex]: "---" },
			markupOverrides: {
				[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
			},
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const thematicBreak = selectThematicBreak(current.surface);
		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(thematicBreak),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenCalledWith(
				expect.objectContaining({
					selection: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
					value: current.canonical(),
				}),
			);
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});
  it("normalizes a collapsed pointer HR target through the Windowed ledger", () => {
    const blockIndex = 160;
    const current = fixture({
      blockOverrides: { [blockIndex]: "---" },
      markupOverrides: {
        [blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
      },
      mounted: [blockIndex],
    });
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null,
    };
    const rendered = renderWindowEditor(current, {
      onReady: (nextRuntime) => {
        runtimeHolder.current = nextRuntime;
      },
    });
    const thematicBreak = current.surface.querySelector("hr");
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error("windowed-hr-pointer-fixture-missing");
    }
    window.getSelection()?.removeAllRanges();
    try {
      expect(
        runtimeHolder.current?.prepareContextMenuSelection?.(
          thematicBreak,
          { x: 2, y: 2 },
          "pointer",
        ),
      ).toBe(true);
      expect(current.documentSession.document.getSelection()).toMatchObject({
        direction: "forward",
        start: expect.any(Number),
        end: expect.any(Number),
      });
      expect(current.applyTextChange).toHaveBeenCalledOnce();
    } finally {
      rendered.view.unmount();
      if (current.surface.isConnected) current.surface.remove();
    }
  });

	it("keeps a straddling selection and rejects the image context gesture", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `Before ${imageMarkdown}`;
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const insideText = current.surface.querySelector("p")?.firstChild;
		const image = current.surface.querySelector("img");
		const outside = document.createElement("p");
		outside.textContent = "Outside";
		document.body.append(outside);
		const outsideText = outside.firstChild;
		if (
			!(insideText instanceof Text)
			|| !(image instanceof HTMLImageElement)
			|| !(outsideText instanceof Text)
		) {
			throw new Error("windowed-straddling-selection-fixture-missing");
		}
		const straddling = document.createRange();
		straddling.setStart(insideText, 0);
		straddling.setEnd(outsideText, 3);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(straddling);

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image),
			).toBe(false);
			expect(current.applyTextChange).not.toHaveBeenCalled();
			expect(selection?.rangeCount).toBe(1);
			expect(selection?.anchorNode).toBe(insideText);
			expect(selection?.focusNode).toBe(outsideText);
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
			outside.remove();
		}
	});

	it("maps an image-element context-menu target through the current ledger", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `Before ${imageMarkdown}`;
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: {
				[blockIndex]: `<p data-easymde-visual-block-id="b${blockIndex}">Before <img alt="alt" src="https://example.test/image.png"></p>`,
			},
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector("p");
		const text = paragraph?.firstChild;
		const image = current.surface.querySelector("img");
		if (
			!(paragraph instanceof HTMLElement)
			|| !(text instanceof Text)
			|| !(image instanceof HTMLImageElement)
		) {
			throw new Error("windowed-image-context-target-missing");
		}
		const imageCaret = document.createRange();
		imageCaret.setStart(text, 0);
		imageCaret.collapse(true);
		const nativeSelection = window.getSelection();
		nativeSelection?.removeAllRanges();
		nativeSelection?.addRange(imageCaret);
		const sourceStart = current.canonical().indexOf(imageMarkdown);
		if (sourceStart < 0) throw new Error("windowed-image-source-missing");

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenCalledWith({
				selection: {
					direction: "forward",
					end: sourceStart + imageMarkdown.length,
					start: sourceStart,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("re-resolves a replaced image context target on a menu refresh pass", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `Before ${imageMarkdown}`;
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const failures: string[] = [];
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure: (code: string) => {
				failures.push(code);
			},
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-refresh-image-missing");
		}
		const sourceStart = current.canonical().indexOf(imageMarkdown);
		if (sourceStart < 0) throw new Error("windowed-refresh-source-missing");
		const expectedSelection = {
			direction: "forward",
			end: sourceStart + imageMarkdown.length,
			start: sourceStart,
		};

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: expectedSelection,
				value: current.canonical(),
			});

			// An accepted Preview window re-render replaces the mounted block and
			// leaves the browser with a surface-level caret.
			const paragraph = current.surface.querySelector("p");
			if (!(paragraph instanceof HTMLParagraphElement)) {
				throw new Error("windowed-refresh-block-missing");
			}
			paragraph.outerHTML = blockMarkup;
			const replacement = current.surface.querySelector("p");
			if (!(replacement instanceof HTMLParagraphElement)) {
				throw new Error("windowed-refresh-block-missing");
			}
			acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(
				current,
				replacement,
			);
			act(() => rendered.rerenderAcceptedWindow(1));
			const caret = document.createRange();
			caret.selectNodeContents(current.surface);
			caret.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(caret);

			// The pending menu refresh replays the now-stale target element.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image, {
					x: 20,
					y: 20,
				}),
			).toBe(true);
			expect(failures).toEqual([]);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: expectedSelection,
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("maps a live second image after an accepted window rebuild replaced its block", () => {
		const firstIndex = 160;
		const secondIndex = 161;
		const firstMarkdown = "![first](https://example.test/first.png)";
		const secondMarkdown = "![second](https://example.test/second.png)";
		const firstMarkup =
			`<p data-easymde-visual-block-id="b${firstIndex}">`
			+ '<img alt="first" src="https://example.test/first.png"></p>';
		const secondMarkup =
			`<p data-easymde-visual-block-id="b${secondIndex}">`
			+ '<img alt="second" src="https://example.test/second.png"></p>';
		const current = fixture({
			blockOverrides: {
				[firstIndex]: firstMarkdown,
				[secondIndex]: secondMarkdown,
			},
			markupOverrides: {
				[firstIndex]: firstMarkup,
				[secondIndex]: secondMarkup,
			},
			mounted: [firstIndex, secondIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const failures: string[] = [];
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure: (code: string) => {
				failures.push(code);
			},
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const firstImage = current.surface.querySelector("img");
		if (!(firstImage instanceof HTMLImageElement)) {
			throw new Error("windowed-first-image-missing");
		}
		const firstStart = current.canonical().indexOf(firstMarkdown);
		const secondStart = current.canonical().indexOf(secondMarkdown);
		if (firstStart < 0 || secondStart < 0) {
			throw new Error("windowed-image-source-missing");
		}

		try {
			// First image menu, closed with Esc.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(firstImage),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: firstStart + firstMarkdown.length,
					start: firstStart,
				},
				value: current.canonical(),
			});
			window.getSelection()?.removeAllRanges();

			// The accepted Preview window commit replaces both mounted blocks
			// and leaves the browser with a surface-level caret.
			for (const [index, markup] of [
				[firstIndex, firstMarkup],
				[secondIndex, secondMarkup],
			] as const) {
				const block = current.surface.querySelector(
					`[data-easymde-visual-block-id="b${index}"]`,
				);
				if (!(block instanceof HTMLElement)) {
					throw new Error("windowed-rebuild-block-missing");
				}
				block.outerHTML = markup;
			}
			const rebuilt = current.surface.querySelector(
				`[data-easymde-visual-block-id="b${firstIndex}"]`,
			);
			if (!(rebuilt instanceof HTMLElement)) {
				throw new Error("windowed-rebuild-block-missing");
			}
			acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(current, rebuilt);
			act(() => rendered.rerenderAcceptedWindow(1));
			const surfaceCaret = document.createRange();
			surfaceCaret.selectNodeContents(current.surface);
			surfaceCaret.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(surfaceCaret);

			// The second image is a fresh live element from the replayed
			// window, so its own source range must map without borrowing the
			// first image's selection.
			const secondImage = current.surface.querySelectorAll("img")[1];
			if (!(secondImage instanceof HTMLImageElement)) {
				throw new Error("windowed-second-image-missing");
			}
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(secondImage),
			).toBe(true);
			expect(failures).toEqual([]);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: secondStart + secondMarkdown.length,
					start: secondStart,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("selects the left-clicked image and marks it without writing the document", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const current = fixture({
			blockOverrides: {
				[blockIndex]: imageMarkdown,
				[blockIndex + 1]: "After",
			},
			markupOverrides: {
				[blockIndex]:
					`<p data-easymde-visual-block-id="b${blockIndex}">`
					+ '<img alt="alt" src="https://example.test/image.png"></p>',
				[blockIndex + 1]:
					`<p data-easymde-visual-block-id="b${blockIndex + 1}">After</p>`,
			},
			mounted: [blockIndex, blockIndex + 1],
		});
		const rendered = renderWindowEditor(current);
		const image = current.surface.querySelector("img");
		const imageBlock = image?.parentElement ?? null;
		const imageStart = current.canonical().indexOf(imageMarkdown);
		if (
			!(image instanceof HTMLImageElement)
			|| !imageBlock
			|| imageStart < 0
		) {
			throw new Error("windowed-image-activation-fixture-missing");
		}
		const marker = (): Element | null =>
			document.querySelector(".easymde-visual-image-selection-feedback");

		try {
			expect(marker()).toBeNull();
			image.dispatchEvent(
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			);
			// The activation owns the selection and republishes the unchanged
			// canonical value with the image's own source range.
			expect(window.getSelection()?.anchorNode).toBe(imageBlock);
			expect(window.getSelection()?.isCollapsed).toBe(false);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: imageStart + imageMarkdown.length,
					start: imageStart,
				},
				value: current.canonical(),
			});
			// The marker lives outside the editable surface, so it cannot leak
			// into serialization or the accepted-window comparison.
			expect(marker()).toBeInstanceOf(HTMLElement);
			expect(current.surface.contains(marker())).toBe(false);

			// A primary press outside an image drops the remembered selection.
			current.surface.dispatchEvent(
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			);
			expect(marker()).toBeNull();
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("re-anchors the retained image selection on a pointer demand after Escape", () => {
		const firstIndex = 160;
		const secondIndex = 161;
		const firstMarkdown = "![first](https://example.test/first.png)";
		const secondMarkdown = "![second](https://example.test/second.png)";
		const current = fixture({
			blockOverrides: {
				[firstIndex]: firstMarkdown,
				[secondIndex]: secondMarkdown,
			},
			markupOverrides: {
				[firstIndex]:
					`<p data-easymde-visual-block-id="b${firstIndex}">`
					+ '<img alt="first" src="https://example.test/first.png"></p>',
				[secondIndex]:
					`<p data-easymde-visual-block-id="b${secondIndex}">`
					+ '<img alt="second" src="https://example.test/second.png"></p>',
			},
			mounted: [firstIndex, secondIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			onFailure: (code: string) => {
				failures.push(code);
			},
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const [firstImage, secondImage] = Array.from(
			current.surface.querySelectorAll("img"),
		);
		const firstStart = current.canonical().indexOf(firstMarkdown);
		const secondStart = current.canonical().indexOf(secondMarkdown);
		if (
			!(firstImage instanceof HTMLImageElement)
			|| !(secondImage instanceof HTMLImageElement)
			|| firstStart < 0
			|| secondStart < 0
		) {
			throw new Error("windowed-retained-image-fixture-missing");
		}

		try {
			// First image menu, dismissed with Escape. The image-node range the
			// menu placed and the DOM both survive exactly as the browser left
			// them: no range is cleared and no block is rebuilt.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(firstImage),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: firstStart + firstMarkdown.length,
					start: firstStart,
				},
				value: current.canonical(),
			});
			expect(window.getSelection()?.rangeCount).toBe(1);
			expect(window.getSelection()?.isCollapsed).toBe(false);

			// The second image is already live, so the pointer demand has to
			// rebind the retained range on its own.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(
					secondImage,
					{ x: 10, y: 10 },
					"pointer",
				),
			).toBe(true);
			expect(failures).toEqual([]);
			expect(window.getSelection()?.anchorNode).toBe(
				secondImage.parentElement,
			);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: secondStart + secondMarkdown.length,
					start: secondStart,
				},
				value: current.canonical(),
			});

			// A -> B -> A repeats with the same retained-range conditions.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(
					firstImage,
					{ x: 10, y: 10 },
					"pointer",
				),
			).toBe(true);
			expect(failures).toEqual([]);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: firstStart + firstMarkdown.length,
					start: firstStart,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("re-anchors the retained image selection while the first menu is still open", () => {
		const firstIndex = 160;
		const secondIndex = 161;
		const firstMarkdown = "![first](https://example.test/first.png)";
		const secondMarkdown = "![second](https://example.test/second.png)";
		const current = fixture({
			blockOverrides: {
				[firstIndex]: firstMarkdown,
				[secondIndex]: secondMarkdown,
			},
			markupOverrides: {
				[firstIndex]:
					`<p data-easymde-visual-block-id="b${firstIndex}">`
					+ '<img alt="first" src="https://example.test/first.png"></p>',
				[secondIndex]:
					`<p data-easymde-visual-block-id="b${secondIndex}">`
					+ '<img alt="second" src="https://example.test/second.png"></p>',
			},
			mounted: [firstIndex, secondIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			onFailure: (code: string) => {
				failures.push(code);
			},
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const [firstImage, secondImage] = Array.from(
			current.surface.querySelectorAll("img"),
		);
		const firstStart = current.canonical().indexOf(firstMarkdown);
		const secondStart = current.canonical().indexOf(secondMarkdown);
		if (
			!(firstImage instanceof HTMLImageElement)
			|| !(secondImage instanceof HTMLImageElement)
			|| firstStart < 0
			|| secondStart < 0
		) {
			throw new Error("windowed-open-menu-image-fixture-missing");
		}

		try {
			// The first menu stays open: its demand owns the retained range.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(firstImage),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenCalledTimes(1);

			// The replacing right-click runs the real pointer gesture before
			// the menu demand is prepared again. A secondary-button gesture
			// must not disturb the range the open menu still owns.
			for (const type of ["pointerdown", "mousedown"] as const) {
				secondImage.dispatchEvent(
					new MouseEvent(type, {
						button: 2,
						bubbles: true,
						cancelable: true,
						composed: true,
					}),
				);
			}
			expect(window.getSelection()?.isCollapsed).toBe(false);

			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(
					secondImage,
					{ x: 10, y: 10 },
					"pointer",
				),
			).toBe(true);
			expect(failures).toEqual([]);
			expect(window.getSelection()?.anchorNode).toBe(
				secondImage.parentElement,
			);
			expect(current.applyTextChange).toHaveBeenCalledTimes(2);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: secondStart + secondMarkdown.length,
					start: secondStart,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("keeps the replayed image ordinal when a block repeats one image source", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `First ${imageMarkdown} second ${imageMarkdown}`;
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">First `
			+ '<img alt="alt" src="https://example.test/image.png"> second '
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const failures: string[] = [];
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure: (code: string) => {
				failures.push(code);
			},
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const images = current.surface.querySelectorAll("img");
		const second = images[1];
		if (!(second instanceof HTMLImageElement)) {
			throw new Error("windowed-duplicate-image-missing");
		}
		const firstStart = current.canonical().indexOf(imageMarkdown);
		const secondStart =
			firstStart < 0
				? -1
				: current.canonical().indexOf(imageMarkdown, firstStart + 1);
		if (firstStart < 0 || secondStart < 0) {
			throw new Error("windowed-duplicate-image-source-missing");
		}
		const expectedSelection = {
			direction: "forward",
			end: secondStart + imageMarkdown.length,
			start: secondStart,
		};
		const surfaceCaret = document.createRange();
		surfaceCaret.selectNodeContents(current.surface);
		surfaceCaret.collapse(true);

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(second),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: expectedSelection,
				value: current.canonical(),
			});

			// An accepted Preview window re-render replaces the mounted block
			// and leaves the browser with a surface-level caret.
			const paragraph = current.surface.querySelector("p");
			if (!(paragraph instanceof HTMLParagraphElement)) {
				throw new Error("windowed-duplicate-block-missing");
			}
			paragraph.outerHTML = blockMarkup;
			const replacement = current.surface.querySelector("p");
			if (!(replacement instanceof HTMLParagraphElement)) {
				throw new Error("windowed-duplicate-block-missing");
			}
			acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(
				current,
				replacement,
			);
			act(() => rendered.rerenderAcceptedWindow(1));
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(surfaceCaret);

			// The replayed stale target must keep its ordinal instead of
			// binding to the first same-source image in the live block.
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(second, {
					x: 20,
					y: 20,
				}),
			).toBe(true);
			expect(failures).toEqual([]);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: expectedSelection,
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("fails explicitly when a replaced image context target cannot be restored", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `Before ${imageMarkdown}`;
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-unrestorable-image-missing");
		}
		const sourceStart = current.canonical().indexOf(imageMarkdown);
		if (sourceStart < 0) {
			throw new Error("windowed-unrestorable-image-source-missing");
		}

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image),
			).toBe(true);
			const writesAfterCapture = current.applyTextChange.mock.calls.length;

			// The re-render keeps the block but renders a different image, so
			// the replayed identity can no longer be authenticated.
			const paragraph = current.surface.querySelector("p");
			if (!(paragraph instanceof HTMLParagraphElement)) {
				throw new Error("windowed-unrestorable-block-missing");
			}
			paragraph.outerHTML =
				`<p data-easymde-visual-block-id="b${blockIndex}">Before `
				+ '<img alt="alt" src="https://example.test/changed.png"></p>';
			const caret = document.createRange();
			caret.selectNodeContents(current.surface);
			caret.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(caret);

			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image, {
					x: 20,
					y: 20,
				}),
			).toBe(false);
			expect(current.applyTextChange.mock.calls.length).toBe(
				writesAfterCapture,
			);
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("rejects a replaced image target that this surface never prepared", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `Before ${imageMarkdown}`;
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-unprepared-image-missing");
		}
		const paragraph = current.surface.querySelector("p");
		if (!(paragraph instanceof HTMLParagraphElement)) {
			throw new Error("windowed-unprepared-block-missing");
		}
		paragraph.outerHTML = blockMarkup;
		const caret = document.createRange();
		caret.selectNodeContents(current.surface);
		caret.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(caret);

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image, {
					x: 20,
					y: 20,
				}),
			).toBe(false);
			expect(current.applyTextChange).not.toHaveBeenCalled();
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("maps a cold direct top-level code target from the block ledger", () => {
		const initialFence = "```js\nalpha\nbeta\n```";
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderCodeBodyEditor(initialFence, "alpha\nbeta\n", {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const { code, current, sourceStart } = rendered;
		const text = code.firstChild;
		if (!(text instanceof Text)) {
			throw new Error("windowed-cold-direct-code-text-missing");
		}

		try {
			// A warm caret inside the code body establishes the canonical
			// code-block selection through the normal preparation path.
			placeCaret(text, 0);
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(code),
			).toBe(true);
			const warmSelection = current.documentSession.document.getSelection();
			expect(warmSelection.start).toBe(sourceStart);
			expect(warmSelection.end).toBeGreaterThan(sourceStart);

			// A cold entry has no native range at all, so the direct top-level
			// PRE target itself must drive the same canonical mapping instead
			// of failing the native-selection gate.
			window.getSelection()?.removeAllRanges();
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(code),
			).toBe(true);
			expect(current.documentSession.document.getSelection()).toEqual(
				warmSelection,
			);
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("preserves a partial code-body selection for a code context target", () => {
		const initialFence = "```js\nalpha\nbeta\n```";
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderCodeBodyEditor(initialFence, "alpha\nbeta\n", {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const { code, current, sourceStart, view } = rendered;
		const text = code.firstChild;
		if (!(text instanceof Text)) {
			throw new Error("windowed-partial-code-context-text-missing");
		}
		const range = document.createRange();
		range.setStart(text, 1);
		range.setEnd(text, 8);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		const runtime = runtimeHolder.current;
		if (!runtime) throw new Error("windowed-partial-code-context-runtime-missing");
		const bodyStart = initialFence.indexOf("alpha");
		if (bodyStart < 0) throw new Error("windowed-partial-code-context-source-missing");

		try {
			expect(runtime.prepareContextMenuSelection?.(code)).toBe(true);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "forward",
					end: sourceStart + bodyStart + 8,
					start: sourceStart + bodyStart + 1,
				},
				value: current.canonical(),
			});
		} finally {
			view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("maps a nested quote code context target through the window ledger", () => {
		const blockIndex = 160;
		const blockMarkdown = "> ~~~js\n> alpha\n> ~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: {
				[blockIndex]: `<blockquote data-easymde-visual-block-id="b${blockIndex}"><pre data-easymde-visual-fence="\`\`\`" data-easymde-visual-fence-info="js"><code class="language-js">alpha\n</code></pre></blockquote>`,
			},
			mounted: [blockIndex],
		});
		const onFailure = vi.fn();
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const code = current.surface.querySelector("blockquote pre > code");
		const text = code?.firstChild;
		if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
			throw new Error("windowed-nested-code-context-fixture-missing");
		}
		const range = document.createRange();
		range.setStart(text, 1);
		range.setEnd(text, 4);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		const runtime = runtimeHolder.current;
		if (!runtime) throw new Error("windowed-nested-code-context-runtime-missing");

		try {
			expect(runtime.prepareContextMenuSelection?.(code)).toBe(true);
			expect(onFailure).not.toHaveBeenCalled();
			expect(current.documentSession.document.getSelection().end).toBeGreaterThan(
			current.documentSession.document.getSelection().start,
		);
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("maps a cold nested quote code target from the pointer hit", () => {
		const blockIndex = 160;
		const blockMarkdown = "> ~~~js\n> alpha\n> ~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: {
				[blockIndex]: `<blockquote data-easymde-visual-block-id="b${blockIndex}"><pre data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js"><code class="language-js">alpha\n</code></pre></blockquote>`,
			},
			mounted: [blockIndex],
		});
		const onFailure = vi.fn();
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const code = current.surface.querySelector("blockquote pre > code");
		if (!(code instanceof HTMLElement)) {
			throw new Error("windowed-cold-nested-code-context-fixture-missing");
		}
		window.getSelection()?.removeAllRanges();

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(code, {
				x: 20,
				y: 20,
			}),
			).toBe(true);
			expect(onFailure).not.toHaveBeenCalled();
			const expectedOffset = current.canonical().indexOf("alpha");
			expect(current.documentSession.document.getSelection()).toEqual({
				direction: "none",
				end: expectedOffset,
				start: expectedOffset,
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("selects the owning block for a collapsed nested quote code target", () => {
		const blockIndex = 160;
		const blockMarkdown = "> ~~~js\n> alpha\n> ~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: {
				[blockIndex]: `<blockquote data-easymde-visual-block-id="b${blockIndex}"><pre data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js"><code class="language-js">alpha\n</code></pre></blockquote>`,
			},
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const code = current.surface.querySelector("blockquote pre > code");
		const text = code?.firstChild;
		if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
			throw new Error("windowed-collapsed-nested-code-context-fixture-missing");
		}
		placeCaret(text, 2);
		const runtime = runtimeHolder.current;
		if (!runtime) throw new Error("windowed-collapsed-nested-code-context-runtime-missing");
		const sourceStart = current.canonical().indexOf(blockMarkdown);
		if (sourceStart < 0) throw new Error("windowed-collapsed-nested-code-context-source-missing");

		try {
			expect(runtime.prepareContextMenuSelection?.(code)).toBe(true);
			const caret = sourceStart + blockMarkdown.indexOf("alpha") + 2;
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "none",
					end: caret,
					start: caret,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("selects the owning block for a collapsed nested list code target", () => {
		const blockIndex = 160;
		const blockMarkdown = "- item\n\n  ```\n  alpha\n  ```";
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: {
				[blockIndex]: `<ul data-easymde-visual-block-id="b${blockIndex}"><li><p>item</p><pre><code>alpha\n</code></pre></li></ul>`,
			},
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const code = current.surface.querySelector("ul pre > code");
		const text = code?.firstChild;
		if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
			throw new Error("windowed-collapsed-nested-list-code-context-fixture-missing");
		}
		placeCaret(text, 2);
		const runtime = runtimeHolder.current;
		if (!runtime) throw new Error("windowed-collapsed-nested-list-code-context-runtime-missing");
		const sourceStart = current.canonical().indexOf(blockMarkdown);
		if (sourceStart < 0) throw new Error("windowed-collapsed-nested-list-code-context-source-missing");

		try {
			expect(runtime.prepareContextMenuSelection?.(code)).toBe(true);
			expect(current.applyTextChange).toHaveBeenLastCalledWith({
				selection: {
					direction: "none",
					end: sourceStart + blockMarkdown.indexOf("alpha") + 2,
					start: sourceStart + blockMarkdown.indexOf("alpha") + 2,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("preserves a mixed text-and-image range for an image context target", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkdown = `Before ${imageMarkdown} after`;
		const current = fixture({
			blockOverrides: { [blockIndex]: blockMarkdown },
			markupOverrides: {
				[blockIndex]: `<p data-easymde-visual-block-id="b${blockIndex}">Before <img alt="alt" src="https://example.test/image.png"> after</p>`,
			},
			mounted: [blockIndex],
		});
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector("p");
		const before = paragraph?.firstChild;
		const after = paragraph?.lastChild;
		const image = current.surface.querySelector("img");
		if (
			!(paragraph instanceof HTMLElement)
			|| !(before instanceof Text)
			|| !(after instanceof Text)
			|| !(image instanceof HTMLImageElement)
		) {
			throw new Error("windowed-mixed-image-context-fixture-missing");
		}
		const range = document.createRange();
		range.setStart(before, 0);
		range.setEnd(after, after.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		const sourceStart = current.canonical().indexOf(blockMarkdown);
		if (sourceStart < 0) throw new Error("windowed-mixed-image-source-missing");

		try {
			expect(
				runtimeHolder.current?.prepareContextMenuSelection?.(image),
			).toBe(true);
			expect(current.applyTextChange).toHaveBeenCalledWith({
				selection: {
					direction: "forward",
					end: sourceStart + blockMarkdown.length,
					start: sourceStart,
				},
				value: current.canonical(),
			});
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it("uses the reselected native range after a cancelled context-menu preparation", () => {
		const blockIndex = 160;
		const current = fixture({
			blockOverrides: { [blockIndex]: "alpha beta" },
			markupOverrides: {
				[blockIndex]: `<p data-easymde-visual-block-id="b${blockIndex}">alpha beta</p>`,
			},
			mounted: [blockIndex],
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const text = paragraph?.firstChild;
		if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
			throw new Error("windowed-context-menu-lease-fixture-missing");
		}
		if (!runtime) throw new Error("windowed-context-menu-lease-runtime-missing");
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
		const select = (start: number, end: number): void => {
			const range = document.createRange();
			range.setStart(text, start);
			range.setEnd(text, end);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
		};
		const bold = {
			action: "wrap" as const,
			group: "format" as const,
			icon: "editor-bold",
			id: "bold" as const,
			label: "Bold",
			prefix: "**",
			suffix: "**",
			surface: "main" as const,
		};
		try {
			select(0, 5);
			expect(readyRuntime.prepareContextMenuSelection?.(paragraph)).toBe(true);
			current.surface.focus();
			select(6, 10);
			expect(readyRuntime.executeCommand(bold)).toBe("handled");
			expect(current.canonical()).toContain("alpha **beta**");
			expect(current.canonical()).not.toContain("**alpha** beta");
		} finally {
			view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it.each([
		{ direction: "forward" as const, inputType: "deleteContentForward" },
		{ direction: "backward" as const, inputType: "deleteContentBackward" },
	])(
		"deletes only the selected thematic-break marker for $inputType",
		({ direction, inputType }) => {
			const blockIndex = 160;
			const current = fixture({
				blockOverrides: { [blockIndex]: "---" },
				markupOverrides: {
					[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
				},
				mounted: [blockIndex],
			});
			const original = current.canonical();
			const sourceStart = original.indexOf("---");
			if (sourceStart < 0) throw new Error("windowed-hr-source-missing");
			const expected =
				original.slice(0, sourceStart) + original.slice(sourceStart + 3);
			const requestPreview = vi.fn(() => "windowed-hr-delete");
			const onMarkdownChange = vi.fn();
			const { view } = renderWindowEditor(current, {
				onMarkdownChange,
				requestPreview,
			});
			selectThematicBreak(current.surface, direction);
			const keyDown = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Backspace",
			});
			current.surface.dispatchEvent(keyDown);
			expect(keyDown.defaultPrevented).toBe(false);

			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType,
			});
			current.surface.dispatchEvent(beforeInput);

			expect(beforeInput.defaultPrevented).toBe(true);
			expect(current.canonical()).toBe(expected);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(current.applyTextChange).toHaveBeenCalledWith({
				changes: { from: sourceStart, insert: "", to: sourceStart + 3 },
				deferNativeBridge: false,
				isolateHistoryBefore: true,
				recordHistorySelection: true,
				selection: {
					direction: "none",
					end: sourceStart,
					start: sourceStart,
				},
				value: expected,
			});
			expect(onMarkdownChange).toHaveBeenCalledOnce();
			expect(requestPreview).toHaveBeenCalledWith(expected);
			view.unmount();
		},
	);

	it("records the exact HR range in real CodeMirror Undo and Redo history", () => {
		const blockIndex = 160;
		const current = fixture({
			blockOverrides: { [blockIndex]: "---" },
			markupOverrides: {
				[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
			},
			mounted: [blockIndex],
		});
		const initialMarkdown = current.canonical();
		const sourceStart = initialMarkdown.indexOf("---");
		if (sourceStart < 0) throw new Error("windowed-hr-history-source-missing");
		const expectedMarkdown =
			initialMarkdown.slice(0, sourceStart) + initialMarkdown.slice(sourceStart + 3);
		const submissionField = document.createElement("textarea");
		submissionField.value = initialMarkdown;
		submissionField.defaultValue = initialMarkdown;
		const container = document.createElement("div");
		document.body.append(container, submissionField);
		const codeMirrorDocument = createCodeMirrorDocumentSession({
			container,
			label: "Markdown source",
			submissionField,
		});
		const documentSession = createEditorDocumentSession(
			codeMirrorDocument,
			createNativeTitleSession(null),
		);
		documentSession.registerSubmissionState({
			appleFont: "system",
			codeTheme: "dark",
			codeThemeExplicit: false,
			customCssId: "",
			customFont: "none",
			markdownTheme: "default",
			serifFont: "off",
			windowsFont: "system",
		});
		const { view } = renderWindowEditor(current, {
			documentSession,
			requestPreview: vi.fn(() => "windowed-hr-history"),
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		selectThematicBreak(current.surface);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(true);
		expect(documentSession.document.getValue()).toBe(expectedMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: sourceStart,
			start: sourceStart,
		});

		expect(documentSession.document.undo()).toBe(true);
		expect(documentSession.document.getValue()).toBe(initialMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "forward",
			end: sourceStart + 3,
			start: sourceStart,
		});
		view.unmount();
		expect(documentSession.document.redo()).toBe(true);
		expect(documentSession.document.getValue()).toBe(expectedMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: sourceStart,
			start: sourceStart,
		});

		documentSession.document.destroy();
		container.remove();
		submissionField.remove();
	});

	it("does not write an exact HR selection when beforeinput is not cancelable", () => {
		const current = fixture({
			blockOverrides: { 160: "---" },
			markupOverrides: {
				160: '<hr data-easymde-visual-block-id="b160">',
			},
		});
		const original = current.canonical();
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, { onFailure });
		selectThematicBreak(current.surface);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			inputType: "deleteContentForward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(original);
		expect(current.applyTextChange).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-beforeinput-not-cancelable",
		);
		view.unmount();
	});

	it("reports a transfer failure when HR deletion writes before Preview fails", () => {
		const current = fixture({
			blockOverrides: { 160: "---" },
			markupOverrides: {
				160: '<hr data-easymde-visual-block-id="b160">',
			},
		});
		const original = current.canonical();
		const sourceStart = original.indexOf("---");
		if (sourceStart < 0) throw new Error("windowed-hr-source-missing");
		const expected =
			original.slice(0, sourceStart) + original.slice(sourceStart + 3);
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			onFailure,
			onTransferFailure,
			requestPreview: vi.fn(() => {
				throw new Error("windowed-hr-preview-failed");
			}),
		});
		selectThematicBreak(current.surface);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe(expected);
		expect(current.applyTextChange).toHaveBeenCalledTimes(2);
		expect(onTransferFailure).toHaveBeenCalledOnce();
		expect(onFailure).toHaveBeenCalledWith("windowed-hr-preview-failed");
		view.unmount();
	});

	it("rejects structural pending text insertion when the canonical lease is stale", () => {
		const blockIndex = 160;
		const current = fixture({
			blockOverrides: { [blockIndex]: "---" },
			markupOverrides: {
				[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
			},
			mounted: [159, 160, 161],
			paragraphBlocks: true,
		});
		const original = current.canonical();
		const sourceStart = original.indexOf("---");
		if (sourceStart < 0) throw new Error("windowed-hr-source-missing");
		const deleted =
			original.slice(0, sourceStart) + original.slice(sourceStart + 3);
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			onFailure,
			onTransferFailure,
			requestPreview: vi.fn(() => "windowed-hr-pending"),
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		selectThematicBreak(current.surface);

		const deleteInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(deleteInput);
		expect(deleteInput.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe(deleted);

		// Canonical selection changes while structural preview is pending
		current.applyTextChange({
			selection: { direction: "none", end: 0, start: 0 },
			value: deleted,
		});

		const insertInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "X",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(insertInput);

		expect(insertInput.defaultPrevented).toBe(true);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-pending-selection-stale",
		);
		expect(current.canonical()).toBe(deleted);
		view.unmount();
	});

	it("restores the HR selection on Undo and a safe adjacent caret on Redo", () => {
		const blockIndex = 160;
		const current = fixture({
			blockOverrides: { [blockIndex]: "---" },
			markupOverrides: {
				[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
			},
			mounted: [159, 160, 161],
			paragraphBlocks: true,
			sourceLineEnding: "\r\n",
		});
		const original = current.canonical();
		const sourceStart = original.indexOf("---");
		if (sourceStart < 0) throw new Error("windowed-hr-history-source-missing");
		const deleted =
			original.slice(0, sourceStart) + original.slice(sourceStart + 3);
		const undo = vi.fn(() => {
			current.setCanonical(original, false);
			current.applyTextChange({
				selection: {
					direction: "forward",
					end: sourceStart + 3,
					start: sourceStart,
				},
				value: original,
			});
			return true;
		});
		const redo = vi.fn(() => {
			current.setCanonical(deleted, false);
			current.applyTextChange({
				selection: { direction: "none", end: sourceStart, start: sourceStart },
				value: deleted,
			});
			return true;
		});
		Object.assign(current.documentSession.document, { redo, undo });
		const requestPreview = vi.fn((markdown: string) =>
			markdown === deleted ? "windowed-hr-deleted" : "windowed-hr-original",
		);
		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const rendered = renderWindowEditor(current, {
			onDiagnostic,
			onFailure,
			requestPreview,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		selectThematicBreak(current.surface);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward",
			}),
		);
		expect(current.canonical()).toBe(deleted);

		const deletedEditMap: PreviewEditMap = {
			...current.editMap,
			blocks: current.editMap.blocks.filter((_, index) => index !== blockIndex),
			signature: "windowed-hr-deleted",
		};
		current.surface.innerHTML = [
			'<div data-easymde-preview-window-spacer="1"></div>',
			'<p data-easymde-visual-block-id="b159">Line 159</p>',
			'<p data-easymde-visual-block-id="b161">Line 161</p>',
			'<div data-easymde-preview-window-spacer="1"></div>',
		].join("");
		rendered.rerenderPreview(deletedEditMap, {
			revision: 2,
			signature: "windowed-hr-deleted",
		});
		expect(onFailure).not.toHaveBeenCalled();
		const deletedSelection = window.getSelection();
		const deletedNext = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b161"]',
		);
		if (
			!(deletedNext instanceof HTMLElement) ||
			!deletedSelection?.anchorNode
		) {
			throw new Error("windowed-hr-deleted-selection-missing");
		}
		expect(deletedNext.contains(deletedSelection.anchorNode)).toBe(true);
		expect(
			textOffsetWithin(
				deletedNext,
				deletedSelection.anchorNode,
				deletedSelection.anchorOffset,
			),
		).toBe(0);

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(historyUndo.defaultPrevented).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		current.surface.innerHTML = [
			'<div data-easymde-preview-window-spacer="1"></div>',
			'<p data-easymde-visual-block-id="b159">Line 159</p>',
			'<hr data-easymde-visual-block-id="b160">',
				'<p data-easymde-visual-block-id="b161">Line 161</p>',
			'<div data-easymde-preview-window-spacer="1"></div>',
		].join("");
		rendered.rerenderPreview(
			{ ...current.editMap, signature: "windowed-hr-original" },
			{ revision: 3, signature: "windowed-hr-original" },
		);
		expect(onFailure).not.toHaveBeenCalled();
		const restoredHr = current.surface.querySelector("hr");
		if (!(restoredHr instanceof HTMLHRElement)) {
			throw new Error("windowed-hr-restored-node-missing");
		}
		const restoredSelection = window.getSelection();
		const restoredIndex = Array.from(current.surface.childNodes).indexOf(
			restoredHr,
		);
		expect(restoredSelection?.anchorNode).toBe(current.surface);
		expect(restoredSelection?.focusNode).toBe(current.surface);
		expect(restoredSelection?.anchorOffset).toBe(restoredIndex);
		expect(restoredSelection?.focusOffset).toBe(restoredIndex + 1);

		const historyRedo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyRedo",
		});
		current.surface.dispatchEvent(historyRedo);
		expect(historyRedo.defaultPrevented).toBe(true);
		expect(redo).toHaveBeenCalledOnce();
		current.surface.innerHTML = [
			'<div data-easymde-preview-window-spacer="1"></div>',
			'<p data-easymde-visual-block-id="b159">Line 159</p>',
			'<p data-easymde-visual-block-id="b161">Line 161</p>',
			'<div data-easymde-preview-window-spacer="1"></div>',
		].join("");
		rendered.rerenderPreview(deletedEditMap, {
			revision: 4,
			signature: "windowed-hr-deleted",
		});
		expect(onFailure).not.toHaveBeenCalled();

		const next = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b161"]',
		);
		const nextText = next?.firstChild;
		if (!(next instanceof HTMLElement) || !(nextText instanceof Text)) {
			throw new Error("windowed-hr-redo-next-block-missing");
		}
		const beforeInsert = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "X",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInsert);
		nextText.data = `X${nextText.data}`;
		placeCaret(nextText, 1);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertText",
			}),
		);
		expect(current.canonical()).toContain("\r\n\r\nXLine 161");
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		rendered.view.unmount();
	});

	it.each([
		{
			blockText: "  ---",
			inputType: "deleteContentForward",
			lineEnding: "\r\n" as const,
			mounted: [159, 160, 161],
			name: "indented CRLF marker",
		},
		{
			blockText: "---",
			inputType: "deleteContentBackward",
			lineEnding: "\r\n" as const,
			mounted: [159, 160],
			name: "EOF marker",
		},
	])(
		"preserves surrounding bytes for an $name",
		({ blockText, inputType, lineEnding, mounted }) => {
			const blockIndex = 160;
			const current = fixture({
				blockOverrides: { [blockIndex]: blockText },
				markupOverrides: {
					[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
				},
				mounted,
				sourceBlockCount: mounted.includes(161) ? 320 : 161,
				sourceLineEnding: lineEnding,
			});
			const original = current.canonical();
			const sourceStart = original.indexOf(blockText);
			if (sourceStart < 0) throw new Error("windowed-hr-byte-source-missing");
			const expected =
				original.slice(0, sourceStart) +
				original.slice(sourceStart + blockText.length);
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, {
				onFailure,
			});
			selectThematicBreak(current.surface);
			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType,
			});
			current.surface.dispatchEvent(beforeInput);

			expect(beforeInput.defaultPrevented).toBe(true);
			expect(current.canonical()).toBe(expected);
			expect(current.applyTextChange).toHaveBeenCalledWith(
				expect.objectContaining({
					changes: {
						from: sourceStart,
						insert: "",
						to: sourceStart + blockText.length,
					},
					value: expected,
				}),
			);
			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		},
	);

	it("does not fall back to whole-window capture for a stale HR ledger", () => {
		const blockIndex = 160;
		const current = fixture({
			blockOverrides: { [blockIndex]: "---" },
			markupOverrides: {
				[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
			},
			mounted: [blockIndex],
		});
		const onFailure = vi.fn();
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const rendered = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
		});
		const thematicBreak = current.surface.querySelector("hr");
		if (!(thematicBreak instanceof HTMLHRElement)) {
			throw new Error("windowed-stale-thematic-break-missing");
		}
		const range = document.createRange();
		range.selectNode(thematicBreak);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		current.setCanonical(`${current.canonical()}x`, false);

		try {
			expect(runtimeHolder.current?.prepareMediaSelection()).toBe(false);
			expect(current.applyTextChange).not.toHaveBeenCalled();
			expect(onFailure.mock.calls).toEqual([["visual-editor-window-stale"]]);
		} finally {
			rendered.view.unmount();
			if (current.surface.isConnected) current.surface.remove();
		}
	});

	it.each([
		{
			kind: "stale source",
			expectedFailure: "visual-editor-window-stale",
		},
		{
			kind: "noneditable range",
			expectedFailure: "visual-editor-selection-map-failed",
		},
		{
			kind: "foreign block",
			expectedFailure: "visual-editor-window-source-navigation-dom-stale",
		},
		{
			kind: "read-only mutation",
			expectedFailure: "visual-editor-window-selection-invalid",
		},
		{
			kind: "spacer mutation",
			expectedFailure: "visual-editor-window-selection-invalid",
		},
	] as const)(
		"rejects an exact HR deletion with a $kind without writing",
		({ expectedFailure, kind }) => {
			const blockIndex = 160;
			const current = fixture({
				blockOverrides: { [blockIndex]: "---" },
				markupOverrides: {
					[blockIndex]: `<hr data-easymde-visual-block-id="b${blockIndex}">`,
				},
				...("noneditable range" === kind ? { nonEditable: [blockIndex] } : {}),
			});
			const original = current.canonical();
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, { onFailure });
			const thematicBreak = selectThematicBreak(current.surface);
			if ("stale source" === kind) {
				current.setCanonical(`${original}x`, false);
			} else if ("foreign block" === kind) {
				thematicBreak.setAttribute("data-easymde-visual-block-id", "foreign");
			} else if ("read-only mutation" === kind) {
				thematicBreak.setAttribute("contenteditable", "false");
			} else if ("spacer mutation" === kind) {
				thematicBreak.setAttribute("data-easymde-preview-window-spacer", "1");
			}
			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentForward",
			});
			current.surface.dispatchEvent(beforeInput);

			expect(beforeInput.defaultPrevented).toBe(true);
			expect(current.canonical()).toBe(
				"stale source" === kind ? `${original}x` : original,
			);
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(expectedFailure);
			expect(onFailure).toHaveBeenCalledOnce();
			view.unmount();
		},
	);

	it("leaves a mixed HR selection to ordinary Windowed capture", () => {
		const current = fixture({
			blockOverrides: { 160: "---" },
			markupOverrides: {
				160: '<hr data-easymde-visual-block-id="b160">',
			},
			mounted: [159, 160, 161],
		});
		const original = current.canonical();
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, { onFailure });
		const previousText = current.surface.querySelector(
			'[data-easymde-visual-block-id="b159"]',
		)?.firstChild;
		const nextText = current.surface.querySelector(
			'[data-easymde-visual-block-id="b161"]',
		)?.firstChild;
		if (!(previousText instanceof Text) || !(nextText instanceof Text)) {
			throw new Error("windowed-hr-mixed-selection-text-missing");
		}
		window
			.getSelection()
			?.setBaseAndExtent(previousText, 0, nextText, nextText.length);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentForward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(original);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("forwards the Preview generated-target lease preparer through the windowed runtime", () => {
		const current = fixture({ mounted: [160] });
		const prepareGeneratedContentTarget = vi.fn(() => null);
		const prepareGeneratedContentTargetForSelection = vi.fn(() => null);
		const prepareImageTarget = vi.fn(() => null);
		const prepareImageTargetBySelection = vi.fn(() => null);
		const getGeneratedPreviewIdentity = vi.fn(() => null);
		const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtimeHolder.current = nextRuntime;
			},
			getGeneratedPreviewIdentity,
			prepareGeneratedContentTarget,
			prepareGeneratedContentTargetForSelection,
			prepareImageTarget,
			prepareImageTargetBySelection,
		});

		const readyRuntime = runtimeHolder.current;
		if (!readyRuntime) throw new Error("windowed-runtime-missing");
		expect(readyRuntime.getGeneratedPreviewIdentity()).toBeNull();
		expect(
			readyRuntime.prepareGeneratedContentTarget({
				element: current.surface,
				index: {
					blocks: [],
					length: 0,
					mathSpans: [],
					revision: 1,
					source: "",
				},
				kind: "math",
				ordinal: 0,
			}),
		).toBeNull();
		expect(getGeneratedPreviewIdentity).toHaveBeenCalledOnce();
		expect(prepareGeneratedContentTarget).toHaveBeenCalledOnce();
		expect(
			readyRuntime.prepareGeneratedContentTargetForSelection({
				index: {
					blocks: [],
					length: 0,
					mathSpans: [],
					revision: 1,
					source: "",
				},
				selection: { end: 0, start: 0 },
			}),
		).toBeNull();
		expect(prepareGeneratedContentTargetForSelection).toHaveBeenCalledOnce();
		expect(
			readyRuntime.prepareImageTarget({
				element: document.createElement("img"),
				index: {
					blockImages: [],
					blocks: [],
					complete: true,
					images: [],
					length: 0,
					revision: 1,
					source: "",
					sourceBytes: 0,
				},
				selection: { end: 0, start: 0 },
			}),
		).toBeNull();
		expect(prepareImageTarget).toHaveBeenCalledOnce();
		expect(
			readyRuntime.prepareImageTargetBySelection({
				index: {
					blockImages: [],
					blocks: [],
					complete: true,
					images: [],
					length: 0,
					revision: 1,
					source: "",
					sourceBytes: 0,
				},
				selection: { end: 0, start: 0 },
			}),
		).toBeNull();
		expect(prepareImageTargetBySelection).toHaveBeenCalledOnce();
		view.unmount();
	});

	it("maps lone-CR line ranges for a mounted fenced code block", () => {
		const blockIndex = 160;
		const sourceFence = "~~~\rAlpha\r~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: sourceFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>Alpha\n</code></pre>`,
			},
			mounted: [blockIndex],
		});
		const onFailure = vi.fn();

		const { view } = renderWindowEditor(current, { onFailure });

		expect(current.editMap.blocks[blockIndex]).toMatchObject({
			endLine: 163,
			startLine: 160,
		});
		expect(onFailure).not.toHaveBeenCalled();
		expect(
			current.surface.querySelector(
				`[data-easymde-visual-block-id="b${blockIndex}"] > code`,
			)?.textContent,
		).toBe("Alpha\n");
		view.unmount();
	});

	it.each([
		{
			blockIndex: 0,
			blankLineCount: 0,
			fence: "~~~",
			lineIndex: 0,
			nativeBody: "A",
		},
		{
			blockIndex: 0,
			blankLineCount: 2,
			fence: "~~~",
			lineIndex: 0,
			nativeBody: "A\n\n",
		},
		{
			blockIndex: 160,
			blankLineCount: 2,
			fence: "~~~",
			lineIndex: 1,
			nativeBody: "\nA",
		},
	])(
		"preserves $fence code body at line $lineIndex in mounted block b$blockIndex",
		({ blockIndex, blankLineCount, fence, lineIndex, nativeBody }) => {
			const blockId = `b${blockIndex}`;
			const initialFence = `${fence}\n${"\n".repeat(blankLineCount)}${fence}`;
			const codeText = "\n".repeat(blankLineCount);
			const current = fixture({
				blockOverrides: { [blockIndex]: initialFence },
				markupOverrides: {
					[blockIndex]: `<pre data-easymde-visual-block-id="${blockId}"><code>${codeText}</code></pre>`,
				},
				mounted: [blockIndex],
			});
			const requestPreview = vi.fn(() => "unexpected-preview");
			const { onFailure, view } = renderWindowEditor(current, {
				requestPreview,
			});
			const code = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="${blockId}"] > code`,
			);
			if (!(code instanceof HTMLElement)) {
				throw new Error("windowed-empty-fence-code-missing");
			}
			const initialMarkdown = current.canonical();
			const initialStart = initialMarkdown.indexOf(initialFence);
			if (initialStart < 0)
				throw new Error("windowed-empty-fence-source-missing");
			const initialText = code.firstChild;
			if (initialText instanceof Text) {
				placeCaret(initialText, lineIndex);
			} else {
				const range = document.createRange();
				range.setStart(code, 0);
				range.collapse(true);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
			}

			current.surface.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					data: "A",
					inputType: "insertText",
				}),
			);
			const nativeText =
				initialText instanceof Text ? initialText : document.createTextNode("");
			code.replaceChildren(nativeText);
			nativeText.data = nativeBody;
			placeCaret(nativeText, lineIndex + 1);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: "A",
					inputType: "insertText",
				}),
			);

			const expectedBodyLines = Array(Math.max(1, blankLineCount)).fill("");
			expectedBodyLines[lineIndex] = "A";
			const expectedBody = `${expectedBodyLines.join("\n")}\n`;
			const expectedFence = `${fence}\n${expectedBody}${fence}`;
			expect(onFailure).not.toHaveBeenCalled();
			expect(current.canonical()).toBe(
				initialMarkdown.slice(0, initialStart) +
					expectedFence +
					initialMarkdown.slice(initialStart + initialFence.length),
			);
			expect(code.textContent).toBe(expectedBody);
			expect(window.getSelection()?.anchorNode).toBe(nativeText);
			expect(window.getSelection()?.anchorOffset).toBe(lineIndex + 1);
			expect(window.getSelection()?.isCollapsed).toBe(true);
			expect(requestPreview).not.toHaveBeenCalled();
			view.unmount();
		},
	);

	it("keeps a keyboard fence shortcut local and editable in a windowed block", () => {
		const current = fixture({ lineOverrides: { 160: "~~~bash" } });
		const requestPreview = vi.fn(() => "fence-preview");
		const onPendingChange = vi.fn();
		const prepareWindowBlockAdoption = vi.fn(() => () => true);
		const { onFailure, view } = renderWindowEditor(current, {
			onPendingChange,
			prepareWindowBlockAdoption,
			requestPreview,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-fence-text-missing");
		placeCaret(text, text.length);

		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		);

		const code = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"] > code',
		);
		if (!(code instanceof HTMLElement))
			throw new Error("windowed-fence-code-missing");
		const placeholder = code.firstElementChild;
		if (
			!(placeholder instanceof HTMLSpanElement) ||
			!(placeholder.firstChild instanceof Text)
		)
			throw new Error("windowed-fence-placeholder-missing");
		expect(
			placeholder.getAttribute("data-easymde-visual-code-placeholder"),
		).toBe("");
		expect(window.getSelection()?.anchorNode).toBe(placeholder.firstChild);
		expect(window.getSelection()?.focusNode).toBe(placeholder.firstChild);
		expect(window.getSelection()?.isCollapsed).toBe(true);
		expect(window.getSelection()?.anchorOffset).toBe(0);
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onPendingChange).not.toHaveBeenCalledWith(true);
		expect(prepareWindowBlockAdoption).toHaveBeenCalledWith(code.parentElement);
		expect(current.canonical()).toContain("```bash\n\n```");

		const input = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "echo ready",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(input);
		expect(input.defaultPrevented).toBe(false);
		const codeText = placeholder.firstChild;
		if (!(codeText instanceof Text))
			throw new Error("windowed-fence-code-text-missing");
		codeText.data = "echo ready";
		placeCaret(codeText, codeText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
			}),
		);
		expect(current.canonical()).toContain("```bash\necho ready\n```");
		expect(code.textContent).toBe("echo ready");
		expect(window.getSelection()?.anchorNode).toBe(codeText);
		expect(window.getSelection()?.anchorOffset).toBe(codeText.length);

		const beforeDelete = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeDelete);
		expect(onFailure).not.toHaveBeenCalled();
		expect(beforeDelete.defaultPrevented).toBe(false);
		const deleteRange = document.createRange();
		deleteRange.setStart(codeText, codeText.length - 1);
		deleteRange.setEnd(codeText, codeText.length);
		deleteRange.deleteContents();
		placeCaret(codeText, codeText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentBackward",
			}),
		);
		expect(onFailure).not.toHaveBeenCalled();
		expect(current.canonical()).toContain("```bash\necho read\n```");

		placeCaret(codeText, 0);
		const beforeForwardDelete = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentForward",
		});
		current.surface.dispatchEvent(beforeForwardDelete);
		expect(beforeForwardDelete.defaultPrevented).toBe(false);
		const forwardDeleteRange = document.createRange();
		forwardDeleteRange.setStart(codeText, 0);
		forwardDeleteRange.setEnd(codeText, 1);
		forwardDeleteRange.deleteContents();
		placeCaret(codeText, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentForward",
			}),
		);
		expect(current.canonical()).toContain("```bash\ncho read\n```");

		placeCaret(codeText, 0);
		const beforeEmptyDelete = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentForward",
		});
		current.surface.dispatchEvent(beforeEmptyDelete);
		codeText.data = "";
		placeCaret(codeText, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentForward",
			}),
		);

		const restored = code.firstElementChild;
		expect(restored).toBeInstanceOf(HTMLSpanElement);
		expect(restored?.getAttribute("data-easymde-visual-code-placeholder")).toBe(
			"",
		);
		expect(restored?.textContent).toBe("");
		expect(current.canonical()).toContain("```bash\n\n```");

		const restoredText = restored?.firstChild;
		if (!(restoredText instanceof Text))
			throw new Error("windowed-restored-text-missing");
		const beforeRetype = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "y",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeRetype);
		restoredText.data = "y";
		placeCaret(restoredText, restoredText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "y",
				inputType: "insertText",
			}),
		);
		expect(restored?.hasAttribute("data-easymde-visual-code-placeholder")).toBe(
			false,
		);
		expect(current.canonical()).toContain("```bash\ny\n```");
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onPendingChange).not.toHaveBeenCalledWith(true);
		view.unmount();
	});

	it("continues native code input after Chromium leaves a transparent span and preserves history selection", () => {
		const current = fixture({ lineOverrides: { 160: "~~~bash" } });
		const initialMarkdown = current.canonical();
		const fenceStart = initialMarkdown.indexOf("~~~bash");
		if (fenceStart < 0)
			throw new Error("windowed-transparent-span-fence-missing");
		const afterFence = initialMarkdown.replace("~~~bash", "```bash\n\n```");
		const afterA = initialMarkdown.replace("~~~bash", "```bash\nA\n```");
		const afterAl = initialMarkdown.replace("~~~bash", "```bash\nAl\n```");
		const bodyStart = fenceStart + "~~~bash\n".length;
		const submissionField = document.createElement("textarea");
		submissionField.value = initialMarkdown;
		submissionField.defaultValue = initialMarkdown;
		submissionField.setSelectionRange(
			fenceStart + "~~~bash".length,
			fenceStart + "~~~bash".length,
		);
		const container = document.createElement("div");
		document.body.append(container, submissionField);
		const codeMirrorDocument = createCodeMirrorDocumentSession({
			container,
			label: "Markdown source",
			submissionField,
		});
		const documentSession = createEditorDocumentSession(
			codeMirrorDocument,
			createNativeTitleSession(null),
		);
		documentSession.registerSubmissionState({
			appleFont: "system",
			codeTheme: "dark",
			codeThemeExplicit: false,
			customCssId: "",
			customFont: "none",
			markdownTheme: "default",
			serifFont: "off",
			windowsFont: "system",
		});
		const requestPreview = vi.fn(() => "transparent-span-preview");
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			documentSession,
			onFailure,
			requestPreview,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const paragraphText = paragraph?.firstChild;
		if (!(paragraphText instanceof Text)) {
			throw new Error("windowed-transparent-span-source-missing");
		}
		placeCaret(paragraphText, paragraphText.length);
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		);
		expect(documentSession.document.getValue()).toBe(afterFence);

		const code = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"] > code',
		);
		const placeholder = code?.firstElementChild;
		if (
			!(code instanceof HTMLElement) ||
			!(placeholder instanceof HTMLSpanElement) ||
			!(placeholder.firstChild instanceof Text)
		) {
			throw new Error("windowed-transparent-span-placeholder-missing");
		}
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "A",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);

		const browserText = document.createTextNode("A");
		const transparentSpan = document.createElement("span");
		transparentSpan.append(document.createTextNode(""));
		code.replaceChildren(browserText, transparentSpan);
		placeCaret(browserText, browserText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "A",
				inputType: "insertText",
			}),
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(documentSession.document.getValue()).toBe(afterA);
		expect(code.textContent).toBe("A");
		expect(code.firstChild).toBe(browserText);
		expect(code.children).toHaveLength(1);
		expect(code.firstElementChild).toBe(transparentSpan);
		expect(transparentSpan.attributes).toHaveLength(0);

		const nextBeforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "l",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(nextBeforeInput);
		expect(nextBeforeInput.defaultPrevented).toBe(false);
		browserText.insertData(1, "l");
		placeCaret(browserText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "l",
				inputType: "insertText",
			}),
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(documentSession.document.getValue()).toBe(afterAl);
		expect(code.textContent).toBe("Al");
		expect(code.firstChild).toBe(browserText);
		expect(window.getSelection()?.anchorNode).toBeInstanceOf(Text);
		expect(window.getSelection()?.anchorNode?.parentNode).toBe(code);
		expect(window.getSelection()?.anchorNode).toBe(browserText);
		expect(window.getSelection()?.anchorOffset).toBe(2);
		documentSession.document.flush();
		expect([
			submissionField.selectionStart,
			submissionField.selectionEnd,
		]).toEqual([bodyStart + 2, bodyStart + 2]);
		expect(requestPreview).not.toHaveBeenCalled();
		view.unmount();

		expect(documentSession.document.undo()).toBe(true);
		expect(documentSession.document.getValue()).toBe(afterA);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: bodyStart + 1,
			start: bodyStart + 1,
		});
		expect(documentSession.document.redo()).toBe(true);
		expect(documentSession.document.getValue()).toBe(afterAl);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: bodyStart + 2,
			start: bodyStart + 2,
		});
		documentSession.document.destroy();
		container.remove();
		submissionField.remove();
	});

	it.each(["text", "enter", "composition", "undo", "outside focus", "revision ABA", "held local", "paste", "held composition", "descended target", "descended target consumed", "pending paste"] as const)("keeps heading-adjacent fence exit and Enter at its original middle source gap (%s)", async (action) => {
		const blockIndex = 160;
		const fence = "~~~lang\nA\n~~~";
		const current = fixture({
			blockOverrides: { 159: "### Before", 160: fence, 161: "### After", 162: "```other\nNEIGHBOR\n```" },
			markupOverrides: {
				159: '<h3 data-easymde-visual-block-id="b159">Before</h3>\n',
				160: '<pre data-easymde-visual-block-id="b160" data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="lang"><code>A\n</code></pre>\n',
				161: '<h3 data-easymde-visual-block-id="b161">After</h3>\n',
				162: '<pre data-easymde-visual-block-id="b162" data-easymde-visual-fence="```" data-easymde-visual-fence-info="other"><code>NEIGHBOR\n</code></pre>\n',
			},
			mounted: [159, 160, 161, 162], paragraphBlocks: true,
		});
		const original = current.canonical();
		const fenceStart = original.indexOf(fence);
		const bodyStart = fenceStart + "~~~lang\n".length;
		const container = document.createElement("div");
		const submissionField = document.createElement("textarea");
		submissionField.value = original;
		submissionField.setSelectionRange(bodyStart + 1, bodyStart + 1);
		document.body.append(container, submissionField);
		const history = createCodeMirrorDocumentSession({ container, label: "Markdown source", submissionField });
		history.setVisualEditingActive(true);
		const requestPreview = vi.fn((_markdown: string) => "heading-fence-enter");
		const release = vi.fn();
		const onCanonicalDocumentChange = vi.fn();
		const { view, rerenderPreview, onFailure, onDiagnostic } = renderWindowEditor(current, {
			documentSession: { document: history } as unknown as EditorDocumentSession,
			onCanonicalDocumentChange,
			requestPreview,
			requestPreviewAtDocumentEnd: (markdown) => ({ release, signature: requestPreview(markdown) }),
		});
		const outside = document.createElement("input");
		document.body.append(outside);
		try {
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			current.surface.focus();
			const text = current.surface.querySelector('[data-easymde-visual-block-id="b160"] code')?.firstChild;
			const neighbor = current.surface.querySelector('[data-easymde-visual-block-id="b162"]');
			if (!(text instanceof Text) || !(neighbor instanceof HTMLElement)) throw new Error("middle-fence-consumer-missing");
			placeCaret(text, 1);
			const deletion = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" });
			const target = document.createRange(); target.setStart(text, 0); target.setEnd(text, 1);
			Object.defineProperty(deletion, "getTargetRanges", { value: () => [target] });
			current.surface.dispatchEvent(deletion);
			expect(deletion.defaultPrevented).toBe(false);
			text.deleteData(0, 1); placeCaret(text, 0);
			current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
			expect(history.getValue()).toBe(original.replace("~~~lang\nA\n~~~", "~~~lang\n\n~~~"));
			const backspace = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" });
			current.surface.dispatchEvent(backspace);
			expect(backspace.defaultPrevented).toBe(true);
			const paragraph = current.surface.querySelector('[data-easymde-visual-block-id="b160"]');
			if (!(paragraph instanceof HTMLParagraphElement)) throw new Error("middle-fence-exit-paragraph-missing");
			expect(history.getSelection()).toEqual({ direction: "none", start: fenceStart, end: fenceStart });
			expect(window.getSelection()?.anchorNode).toBe(paragraph);
			// The exited fence leaves the renderer's lone BR placeholder, so the
			// caret must sit at the block start rather than after the placeholder.
			expect(paragraph.childNodes).toHaveLength(1);
			expect(paragraph.firstChild).toBeInstanceOf(HTMLBRElement);
			expect(window.getSelection()?.anchorOffset).toBe(0);
			expect(neighbor.isConnected).toBe(true);
			expect(current.surface.querySelector('[data-easymde-visual-block-id="b162"]')).toBe(neighbor);
			const afterExit = history.getValue();
			const enterKey = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
			current.surface.dispatchEvent(enterKey);
			expect(enterKey.defaultPrevented).toBe(false);
			expect(onFailure).not.toHaveBeenCalled();
			const enter = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
			const paragraphStart = document.createRange(); paragraphStart.setStart(paragraph, 0); paragraphStart.collapse(true);
			Object.defineProperty(enter, "getTargetRanges", { value: () => [paragraphStart] });
			current.surface.dispatchEvent(enter);
			expect(enter.defaultPrevented).toBe(true);
			const gapStart = fenceStart + 1;
			const afterEnter = afterExit.slice(0, fenceStart) + "\n" + afterExit.slice(fenceStart);
			expect(onFailure).not.toHaveBeenCalled();
			expect(history.getValue()).toBe(afterEnter);
			expect(history.getSelection().start).toBeGreaterThan(0);
			expect(requestPreview).toHaveBeenCalledOnce();
			const acceptedMap: PreviewEditMap = { ...current.editMap, signature: "heading-fence-enter", blocks: current.editMap.blocks
				.filter((_, index) => index !== blockIndex)
				.map((block, index) => index < blockIndex ? block : { ...block, id: `b${index}`, startLine: block.startLine - 1, endLine: block.endLine - 1 }) };
			if (action === "held local") {
				const held = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "gap" });
				const placeholder = paragraph.firstChild;
				if (!(placeholder instanceof HTMLBRElement)) throw new Error("gap-placeholder-missing");
				const target = document.createRange(); target.setStart(placeholder, 0); target.collapse(true);
				Object.defineProperty(held, "getTargetRanges", { value: () => [target] });
				current.surface.dispatchEvent(held);
				expect(held.defaultPrevented).toBe(true);
				const typed = afterEnter.slice(0, gapStart) + "gap" + afterEnter.slice(gapStart);
				expect(history.getValue()).toBe(typed);
				expect(history.getSelection()).toEqual({ direction: "none", start: gapStart + 3, end: gapStart + 3 });
				expect(paragraph.textContent).toBe("gap");
				expectConnectedCodeCaret(paragraph, 3);
				expect(current.surface.querySelector('[data-easymde-visual-block-id="b162"]')).toBe(neighbor);
				expect(onFailure).not.toHaveBeenCalled();
				const typedMap: PreviewEditMap = { ...current.editMap, signature: "heading-fence-enter", blocks: current.editMap.blocks.map((block, index) => index < 160 ? block : index === 160 ? { ...block, startLine: block.startLine + 1, endLine: block.startLine + 2 } : { ...block, startLine: block.startLine - 1, endLine: block.endLine - 1 }) };
				current.surface.innerHTML = '<div data-easymde-preview-window-spacer="1"></div><h3 data-easymde-visual-block-id="b159">Before</h3>\n<p data-easymde-visual-block-id="b160">gap</p>\n<h3 data-easymde-visual-block-id="b161">After</h3>\n<pre data-easymde-visual-block-id="b162"><code>NEIGHBOR\n</code></pre>\n<div data-easymde-preview-window-spacer="1"></div>';
				rerenderPreview(typedMap, { revision: 4, signature: "heading-fence-enter" });
				expect(current.surface.getAttribute("contenteditable")).toBe("true");
				const acceptedText = current.surface.querySelector('[data-easymde-visual-block-id="b160"]')?.firstChild;
				if (!(acceptedText instanceof Text)) throw new Error("gap-accepted-text-missing");
				expect(window.getSelection()?.anchorNode).toBe(acceptedText);
				expect(window.getSelection()?.anchorOffset).toBe(3);
				const continuation = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "Z" });
				current.surface.dispatchEvent(continuation);
				expect(continuation.defaultPrevented).toBe(false);
				acceptedText.appendData("Z"); placeCaret(acceptedText, 4);
				current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Z" }));
				expect(history.getValue()).toBe(afterEnter.slice(0, gapStart) + "gapZ" + afterEnter.slice(gapStart));
				expect(onFailure).not.toHaveBeenCalled();
				expect(onDiagnostic).not.toHaveBeenCalled();
				return;
			}
			if (action === "held composition") {
				// An IME that begins before the Enter response returns must keep the
				// pending canonical lease instead of being refused by the ready-only
				// gap branch: the draft is discarded and its data is inserted once at
				// the recorded gap.
				const paragraphAfterEnter = current.surface.querySelector('[data-easymde-visual-block-id="b160"]');
				if (!(paragraphAfterEnter instanceof HTMLElement)) throw new Error("gap-held-composition-paragraph-missing");
				const revisionBeforeComposition = history.getRevision?.();
				current.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
				current.surface.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "文" }));
				const draft = document.createTextNode("文");
				paragraphAfterEnter.prepend(draft);
				placeCaret(draft, 1);
				current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "文" }));
				expect(history.getValue()).toBe(afterEnter);
				current.surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "文" }));
				expect(onFailure).not.toHaveBeenCalled();
				const composed = `${afterEnter.slice(0, gapStart)}文${afterEnter.slice(gapStart)}`;
				expect(history.getValue()).toBe(composed);
				expect(history.getSelection()).toEqual({ direction: "none", start: gapStart + 1, end: gapStart + 1 });
				// The committed data is now the owned draft's own text: it must be
				// visible exactly once, and canonical must have taken it exactly
				// once, without the earlier formal certificate being refreshed.
				const visible = paragraphAfterEnter.textContent ?? "";
				expect(visible.split("文").length - 1).toBe(1);
				expect(visible).toBe("文");
				expect(history.getRevision?.()).toBe((revisionBeforeComposition as number) + 1);
				expect(current.surface.querySelector('[data-easymde-visual-block-id="b162"]')).toBe(neighbor);
				expect(onDiagnostic).not.toHaveBeenCalled();
				return;
			}
			if (action === "pending paste") {
				// The Enter Preview is still outstanding, so the paste must consume
				// the authenticated pending lease instead of being refused.
				expect(requestPreview).toHaveBeenCalledOnce();
				const paste = new Event("paste", { bubbles: true, cancelable: true });
				Object.defineProperty(paste, "clipboardData", {
					value: { files: [], getData: () => "X", items: [], types: ["text/plain"] },
				});
				current.surface.dispatchEvent(paste);
				expect(paste.defaultPrevented).toBe(true);
				await act(async () => {
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
				});
				expect(onFailure).not.toHaveBeenCalled();
				expect(history.getValue()).toBe(`${afterEnter.slice(0, gapStart)}X${afterEnter.slice(gapStart)}`);
				expect(history.getSelection()).toEqual({ direction: "none", start: gapStart + 1, end: gapStart + 1 });
				expect(paragraph.textContent).toBe("X");
				expectConnectedCodeCaret(paragraph, 1);
				expect(requestPreview).toHaveBeenCalledTimes(2);
				return;
			}
			current.surface.innerHTML = '<div data-easymde-preview-window-spacer="1"></div><h3 data-easymde-visual-block-id="b159">Before</h3><h3 data-easymde-visual-block-id="b160">After</h3><pre data-easymde-visual-block-id="b161"><code>NEIGHBOR\n</code></pre><div data-easymde-preview-window-spacer="1"></div>';
			if (action === "outside focus") outside.focus();
			if (action === "revision ABA") { expect(history.undo()).toBe(true); expect(history.redo()).toBe(true); }
			rerenderPreview(acceptedMap, { revision: 3, signature: "heading-fence-enter" });
			if (action === "revision ABA") {
				expect(onCanonicalDocumentChange).toHaveBeenCalled();
				const rejected = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "Q" });
				current.surface.dispatchEvent(rejected);
				expect(rejected.defaultPrevented).toBe(true);
				expect(history.getValue()).toBe(afterEnter);
				return;
			}
			if (action === "outside focus") {
				expect(onFailure).not.toHaveBeenCalled();
				expect(document.activeElement).toBe(outside);
				expect(history.getValue()).toBe(afterEnter);
				return;
			}
			expect(onFailure).not.toHaveBeenCalled();
			expect(onDiagnostic).not.toHaveBeenCalled();
			expect(history.getSelection().start).toBeGreaterThan(0);
			expect(window.getSelection()?.anchorNode).not.toBe(current.surface.firstChild);
			expect(document.activeElement).toBe(current.surface);
			if (action === "descended target" || action === "descended target consumed") {
				// After acceptance the caret collapses onto the following heading's
				// element boundary while canonical selection stays in the blank gap.
				// Chromium then names a `beforeinput` target inside that heading's own
				// text run; only a zero-length prefix is the same source boundary.
				const presentation = current.surface.querySelector('[data-easymde-visual-block-id="b160"]');
				if (!(presentation instanceof HTMLElement)) throw new Error("gap-descended-presentation-missing");
				const headingText = presentation.firstChild;
				if (!(headingText instanceof Text)) throw new Error("gap-descended-text-missing");
				const target = document.createRange();
				target.setStart(headingText, action === "descended target" ? 0 : 2);
				target.collapse(true);
				const input = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "Q" });
				Object.defineProperty(input, "getTargetRanges", { value: () => [target] });
				current.surface.dispatchEvent(input);
				expect(input.defaultPrevented).toBe(true);
				if (action === "descended target") {
					expect(history.getValue()).toBe(`${afterEnter.slice(0, gapStart)}Q${afterEnter.slice(gapStart)}`);
					expect(history.getSelection()).toEqual({ direction: "none", start: gapStart + 1, end: gapStart + 1 });
					expect(onFailure).not.toHaveBeenCalled();
					expect(onDiagnostic).not.toHaveBeenCalled();
				} else {
					// A consumed prefix is source the browser would leave in front of
					// the insertion point, so this point is not the blank gap.
					expect(history.getValue()).toBe(afterEnter);
					expect(onFailure).toHaveBeenCalledWith("visual-editor-window-pending-selection-stale");
				}
				return;
			}
			if (action === "paste") {
				// The accepted restore collapses the native caret at the following
				// heading's boundary while canonical selection stays in the blank
				// gap. A plain-text paste must consume that authenticated gap
				// instead of remapping the substitute presentation position.
				const paste = new Event("paste", { bubbles: true, cancelable: true });
				Object.defineProperty(paste, "clipboardData", {
					value: {
						files: [],
						getData: () => "X",
						items: [],
						types: ["text/plain"],
					},
				});
				current.surface.dispatchEvent(paste);
				expect(paste.defaultPrevented).toBe(true);
				await act(async () => {
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
				});
				expect(history.getValue()).toBe(
					`${afterEnter.slice(0, gapStart)}X${afterEnter.slice(gapStart)}`,
				);
				expect(history.getSelection()).toEqual({
					direction: "none",
					end: gapStart + 1,
					start: gapStart + 1,
				});
				expect(onFailure).not.toHaveBeenCalled();
				expect(onDiagnostic).not.toHaveBeenCalled();
				return;
			}
			let expectedSource = afterEnter;
			let insertionPoint = gapStart;
			if (action === "enter") {
				current.surface.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
				const newline = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
				current.surface.dispatchEvent(newline);
				expect(newline.defaultPrevented).toBe(true);
				expectedSource = afterEnter.slice(0, gapStart) + "\n" + afterEnter.slice(gapStart);
				insertionPoint += 1;
				expect(history.getValue()).toBe(expectedSource);
				rerenderPreview({ ...acceptedMap, blocks: acceptedMap.blocks.map((block, index) => index < 160 ? block : { ...block, startLine: block.startLine + 1, endLine: block.endLine + 1 }) }, { revision: 4, signature: "heading-fence-enter" });
			}
			const inserted = action === "composition" ? "文" : "Q";
			if (action === "composition") {
				const after = current.surface.querySelector('[data-easymde-visual-block-id="b160"]');
				if (!(after instanceof HTMLElement)) throw new Error("gap-composition-after-missing");
				current.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
				current.surface.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: inserted }));
				const draft = document.createTextNode(inserted); after.prepend(draft); placeCaret(draft, draft.length);
				current.surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: inserted }));
				expect(history.getValue()).toBe(expectedSource);
				current.surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: inserted }));
				expect(after.textContent).toBe("After");
				expect(Array.from(current.surface.querySelectorAll("p")).some((node) => node.textContent === inserted)).toBe(true);
				const completion = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromComposition", data: inserted });
				current.surface.dispatchEvent(completion);
				expect(completion.defaultPrevented).toBe(true);
			} else {
				const continuation = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: inserted });
				current.surface.dispatchEvent(continuation);
				expect(continuation.defaultPrevented).toBe(true);
			}
			const typed = expectedSource.slice(0, insertionPoint) + inserted + expectedSource.slice(insertionPoint);
			expect(history.getValue()).toBe(typed);
			expect(history.getSelection()).toEqual({ direction: "none", start: insertionPoint + inserted.length, end: insertionPoint + inserted.length });
			expect(onFailure).not.toHaveBeenCalled();
			expect(onDiagnostic).not.toHaveBeenCalled();
			if (action === "undo") {
				const typedMap: PreviewEditMap = { ...current.editMap, signature: "heading-fence-enter", blocks: current.editMap.blocks.map((block, index) => index < 160 ? block : index === 160 ? { ...block, startLine: block.startLine + 1, endLine: block.startLine + 2 } : { ...block, startLine: block.startLine - 1, endLine: block.endLine - 1 }) };
				const typedHtml = '<div data-easymde-preview-window-spacer="1"></div><h3 data-easymde-visual-block-id="b159">Before</h3><p data-easymde-visual-block-id="b160">Q</p><h3 data-easymde-visual-block-id="b161">After</h3><pre data-easymde-visual-block-id="b162"><code>NEIGHBOR\n</code></pre><div data-easymde-preview-window-spacer="1"></div>';
				current.surface.innerHTML = typedHtml;
				rerenderPreview(typedMap, { revision: 4, signature: "heading-fence-enter" });
				current.surface.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyUndo" }));
				expect(history.getValue()).toBe(afterEnter);
				current.surface.innerHTML = '<div data-easymde-preview-window-spacer="1"></div><h3 data-easymde-visual-block-id="b159">Before</h3><h3 data-easymde-visual-block-id="b160">After</h3><pre data-easymde-visual-block-id="b161"><code>NEIGHBOR\n</code></pre><div data-easymde-preview-window-spacer="1"></div>';
				rerenderPreview(acceptedMap, { revision: 5, signature: "heading-fence-enter" });
				expect(history.getSelection()).toEqual({ direction: "none", start: gapStart, end: gapStart });
				current.surface.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyRedo" }));
				expect(history.getValue()).toBe(typed);
				current.surface.innerHTML = typedHtml;
				rerenderPreview(typedMap, { revision: 6, signature: "heading-fence-enter" });
				expect(history.getSelection()).toEqual({ direction: "none", start: gapStart + 1, end: gapStart + 1 });
				expect(onFailure).not.toHaveBeenCalled();
				expect(onDiagnostic).not.toHaveBeenCalled();
			}
		} finally {
			view.unmount(); history.destroy(); container.remove(); submissionField.remove(); outside.remove();
		}
	});

	it.each([
		{ closed: true, fence: "~~~", targetRanges: "explicit" },
		{ closed: true, fence: "```", targetRanges: "explicit" },
		{ closed: false, fence: "~~~", targetRanges: "missing" },
		{ closed: false, fence: "```", targetRanges: "empty" },
	])(
		"removes an empty $fence code frame with Backspace and preserves real history ($closed)",
		({ closed, fence, targetRanges }) => {
			const blockIndex = 160;
			const initialFence = closed ? `${fence}\nA\n${fence}` : `${fence}\nA\n`;
			const emptyFence = closed ? `${fence}\n\n${fence}` : `${fence}\n\n`;
			const initialCodeText = "A\n";
			const previousFence = `~~~\nPREVIOUS\n~~~`;
			const current = fixture({
				blockOverrides: closed
					? { [blockIndex]: initialFence }
					: { [blockIndex - 1]: previousFence, [blockIndex]: initialFence },
				markupOverrides: {
					...(!closed
						? {
								[blockIndex - 1]:
									`<pre data-easymde-visual-block-id="b${blockIndex - 1}" data-easymde-visual-fence="~~~"><code class="hljs">PREVIOUS\n</code></pre>`,
							}
						: {}),
					[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}" data-easymde-visual-fence="${fence}"><code class="hljs">${initialCodeText}</code></pre>`,
				},
				mounted: closed ? [159, blockIndex, 161] : [159, blockIndex],
				sourceBlockCount: closed ? 320 : blockIndex + 1,
			});
			const initialMarkdown = current.canonical();
			const fenceStart = initialMarkdown.indexOf(initialFence);
			if (fenceStart < 0)
				throw new Error("windowed-empty-code-history-fence-missing");
			const bodyStart = fenceStart + fence.length + 1;
			const initialCaret = bodyStart + 1;
			const emptyMarkdown = initialMarkdown.replace(initialFence, emptyFence);
			const sourceAfterRemoval = closed
				? emptyMarkdown.slice(0, fenceStart) +
					"\n" +
					emptyMarkdown.slice(fenceStart + emptyFence.length + 1)
				: emptyMarkdown.slice(0, fenceStart);
			const submissionField = document.createElement("textarea");
			submissionField.value = initialMarkdown;
			submissionField.defaultValue = initialMarkdown;
			submissionField.setSelectionRange(initialCaret, initialCaret);
			const container = document.createElement("div");
			document.body.append(container, submissionField);
			const codeMirrorDocument = createCodeMirrorDocumentSession({
				container,
				label: "Markdown source",
				submissionField,
			});
			const documentSession = createEditorDocumentSession(
				codeMirrorDocument,
				createNativeTitleSession(null),
			);
			documentSession.registerSubmissionState({
				appleFont: "system",
				codeTheme: "dark",
				codeThemeExplicit: false,
				customCssId: "",
				customFont: "none",
				markdownTheme: "default",
				serifFont: "off",
				windowsFont: "system",
			});
			const onFailure = vi.fn();
			const requestPreview = vi.fn(() => "unused-empty-code-history-preview");
			const { view } = renderWindowEditor(current, {
				documentSession,
				onFailure,
				requestPreview,
			});
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			current.surface.focus();

			const pre = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			const previousPre = closed
				? null
				: current.surface.querySelector<HTMLElement>(
						`[data-easymde-visual-block-id="b${blockIndex - 1}"]`,
					);
			const code = pre?.querySelector(":scope > code");
			const text = code?.firstChild;
			if (
				!(pre instanceof HTMLElement) ||
				!(code instanceof HTMLElement) ||
				!(text instanceof Text) ||
				(!closed && !(previousPre instanceof HTMLElement))
			) {
				throw new Error("windowed-empty-code-history-code-missing");
			}
			placeCaret(text, 1);

			const deleteCharacter = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Backspace",
			});
			current.surface.dispatchEvent(deleteCharacter);
			expect(deleteCharacter.defaultPrevented).toBe(false);
			if (previousPre instanceof HTMLElement) {
				expect(
					previousPre.hasAttribute("data-easymde-visual-fence-open-eof"),
				).toBe(false);
			}
			if (closed) {
				expect(pre.hasAttribute("data-easymde-visual-fence-open-eof")).toBe(
					false,
				);
			} else {
				expect(pre.getAttribute("data-easymde-visual-fence-open-eof")).toBe(
					"1",
				);
			}
			const deleteBeforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward",
			});
			const deleteTargetRange = document.createRange();
			deleteTargetRange.setStart(text, 0);
			deleteTargetRange.setEnd(text, 1);
			if ("missing" !== targetRanges) {
				Object.defineProperty(deleteBeforeInput, "getTargetRanges", {
					value: () => ("empty" === targetRanges ? [] : [deleteTargetRange]),
				});
			}
			current.surface.dispatchEvent(deleteBeforeInput);
			expect(deleteBeforeInput.defaultPrevented).toBe(false);
			text.deleteData(0, 1);
			placeCaret(text, 0);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "deleteContentBackward",
				}),
			);

			expect(documentSession.document.getValue()).toBe(emptyMarkdown);
			expect(pre.isConnected).toBe(true);
			expect(code.textContent).toBe("\n");
			if (closed) {
				expect(pre.hasAttribute("data-easymde-visual-fence-open-eof")).toBe(
					false,
				);
			} else {
				expect(pre.getAttribute("data-easymde-visual-fence-open-eof")).toBe(
					"2",
				);
			}
			const emptyCaret = documentSession.document.getSelection();
			expect(emptyCaret).toEqual({
				direction: "none",
				end: bodyStart,
				start: bodyStart,
			});
			expect(onFailure).not.toHaveBeenCalled();
			expect(requestPreview).not.toHaveBeenCalled();

			const removeEmptyCode = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Backspace",
			});
			current.surface.dispatchEvent(removeEmptyCode);
			expect(removeEmptyCode.defaultPrevented).toBe(true);
			const replacement = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			expect(replacement?.tagName).toBe("P");
			const visualSelection = window.getSelection();
			expect(visualSelection?.isCollapsed).toBe(true);
			expect(
				Boolean(
					replacement &&
						visualSelection?.anchorNode &&
						(visualSelection.anchorNode === replacement ||
							replacement.contains(visualSelection.anchorNode)),
				),
			).toBe(true);
			const removedCaret = documentSession.document.getSelection();
			expect(removedCaret.direction).toBe("none");
			expect(removedCaret.start).toBe(removedCaret.end);
			expect(onFailure).not.toHaveBeenCalled();
			expect(requestPreview).not.toHaveBeenCalled();
			expect(documentSession.document.getValue()).toBe(sourceAfterRemoval);

			view.unmount();
			expect(documentSession.document.undo()).toBe(true);
			expect(documentSession.document.getValue()).toBe(emptyMarkdown);
			expect(documentSession.document.getSelection()).toEqual(emptyCaret);
			expect(documentSession.document.undo()).toBe(true);
			expect(documentSession.document.getValue()).toBe(initialMarkdown);
			expect(documentSession.document.getSelection()).toEqual({
				direction: "none",
				end: initialCaret,
				start: initialCaret,
			});
			expect(documentSession.document.redo()).toBe(true);
			expect(documentSession.document.getValue()).toBe(emptyMarkdown);
			expect(documentSession.document.getSelection()).toEqual(emptyCaret);
			expect(documentSession.document.redo()).toBe(true);
			expect(documentSession.document.getValue()).toBe(sourceAfterRemoval);
			expect(documentSession.document.getSelection()).toEqual(removedCaret);

			documentSession.document.destroy();
			container.remove();
			submissionField.remove();
		},
	);

	it.each(["~~~", "```"])(
		"keeps the document-end history target mounted while adopting removal of an empty %s frame",
		async (fence) => {
			const blockIndex = 220;
			const initialFence = `${fence}\nA\n`;
			const current = fixture({
				blockOverrides: { [blockIndex]: initialFence },
				markupOverrides: {
					[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>A\n</code></pre>`,
				},
				mounted: [blockIndex],
				paragraphBlocks: true,
				sourceBlockCount: blockIndex + 1,
			});
			const initialMarkdown = current.canonical();
			const fenceStart = initialMarkdown.lastIndexOf(initialFence);
			if (fenceStart < 0)
				throw new Error("windowed-history-removal-fence-missing");
			const bodyStart = fenceStart + fence.length + 1;
			const emptyMarkdown = initialMarkdown.replace(
				initialFence,
				`${fence}\n\n`,
			);
			const frameRemovedMarkdown = emptyMarkdown.slice(0, fenceStart);
			const submissionField = document.createElement("textarea");
			submissionField.value = initialMarkdown;
			submissionField.defaultValue = initialMarkdown;
			submissionField.setSelectionRange(bodyStart + 1, bodyStart + 1);
			const container = document.createElement("div");
			document.body.append(container, submissionField);
			const codeMirrorDocument = createCodeMirrorDocumentSession({
				container,
				label: "Markdown source",
				submissionField,
			});
			const documentSession = createEditorDocumentSession(
				codeMirrorDocument,
				createNativeTitleSession(null),
			);
			documentSession.registerSubmissionState({
				appleFont: "system",
				codeTheme: "dark",
				codeThemeExplicit: false,
				customCssId: "",
				customFont: "none",
				markdownTheme: "default",
				serifFont: "off",
				windowsFont: "system",
			});
			const previewRequests: Array<Readonly<{ markdown: string }>> = [];
			const requestPreview = vi.fn((markdown: string) => {
				previewRequests.push({ markdown });
				return `windowed-history-${previewRequests.length}`;
			});
			const pinReleases: Array<ReturnType<typeof vi.fn>> = [];
			const requestPreviewAtDocumentEnd = vi.fn((markdown: string) => {
				const release = vi.fn();
				pinReleases.push(release);
				return { release, signature: requestPreview(markdown) };
			});
			const onDiagnostic = vi.fn();
			const onFailure = vi.fn();
			const { rerenderPreview, view } = renderWindowEditor(current, {
				documentSession,
				onDiagnostic,
				onFailure,
				requestPreview,
				requestPreviewAtDocumentEnd,
			});
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			current.surface.focus();

			const acceptLatestPreview = async (
				markdown: string,
				keepsFrame: boolean,
			): Promise<void> => {
				const request = previewRequests.at(-1);
				const signature = requestPreview.mock.results.at(-1)?.value;
				if (
					!request ||
					request.markdown !== markdown ||
					typeof signature !== "string"
				) {
					throw new Error("windowed-history-removal-preview-request-missing");
				}
				const blocks = keepsFrame
					? current.editMap.blocks
					: current.editMap.blocks.slice(0, blockIndex);
				const editMap: PreviewEditMap = {
					...current.editMap,
					blocks,
					signature,
				};
				if (keepsFrame) {
					current.surface.innerHTML = [
						'<div data-easymde-preview-window-spacer="1"></div>',
						`<pre data-easymde-visual-block-id="b${blockIndex}"><code>${
							markdown === initialMarkdown ? "A\n" : "\n"
						}</code></pre>`,
					].join("");
				} else if (
					requestPreviewAtDocumentEnd.mock.lastCall?.[0] === markdown
				) {
					current.surface.innerHTML = [
						'<div data-easymde-preview-window-spacer="1"></div>',
						'<p data-easymde-visual-block-id="b211">Line 211</p>',
						'<div data-easymde-preview-window-spacer="1"></div>',
						'<p data-easymde-visual-block-id="b219">Line 219</p>',
					].join("");
				} else {
					current.surface.innerHTML = [
						'<p data-easymde-visual-block-id="b0">Line 0</p>',
						'<div data-easymde-preview-window-spacer="1"></div>',
						'<p data-easymde-visual-block-id="b211">Line 211</p>',
						'<div data-easymde-preview-window-spacer="1"></div>',
					].join("");
					const selection = window.getSelection();
					selection?.collapse(current.surface, 0);
				}
				await act(async () => {
					rerenderPreview(editMap, {
						revision: previewRequests.length + 1,
						signature,
					});
					await Promise.resolve();
				});
			};
			const dispatchHistory = async (
				inputType: "historyRedo" | "historyUndo",
				expectedMarkdown: string,
				keepsFrame: boolean,
			): Promise<void> => {
				const event = new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType,
				});
				current.surface.dispatchEvent(event);
				expect(event.defaultPrevented).toBe(true);
				expect(documentSession.document.getValue()).toBe(expectedMarkdown);
				await acceptLatestPreview(expectedMarkdown, keepsFrame);
			};

			const pre = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			const code = pre?.querySelector(":scope > code");
			const text = code?.firstChild;
			if (
				!(pre instanceof HTMLElement) ||
				!(code instanceof HTMLElement) ||
				!(text instanceof Text)
			) {
				throw new Error("windowed-history-removal-code-missing");
			}
			placeCaret(text, 1);
			const deleteCharacter = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward",
			});
			const targetRange = document.createRange();
			targetRange.setStart(text, 0);
			targetRange.setEnd(text, 1);
			Object.defineProperty(deleteCharacter, "getTargetRanges", {
				value: () => [targetRange],
			});
			current.surface.dispatchEvent(deleteCharacter);
			expect(deleteCharacter.defaultPrevented).toBe(false);
			text.deleteData(0, 1);
			placeCaret(text, 0);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "deleteContentBackward",
				}),
			);
			expect(documentSession.document.getValue()).toBe(emptyMarkdown);
			expect(code.textContent).toBe("\n");
			expect(onFailure).not.toHaveBeenCalled();

			placeCaret(text, 0);
			const removeFrame = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Backspace",
			});
			current.surface.dispatchEvent(removeFrame);
			expect(removeFrame.defaultPrevented).toBe(true);
			expect(documentSession.document.getValue()).toBe(frameRemovedMarkdown);
			expect(requestPreview).not.toHaveBeenCalled();

			await dispatchHistory("historyUndo", emptyMarkdown, true);
			await dispatchHistory("historyUndo", initialMarkdown, true);
			await dispatchHistory("historyRedo", emptyMarkdown, true);
			await dispatchHistory("historyRedo", frameRemovedMarkdown, false);

			expect(requestPreviewAtDocumentEnd).toHaveBeenCalledTimes(4);
			expect(requestPreviewAtDocumentEnd).toHaveBeenNthCalledWith(1, emptyMarkdown, {
				direction: "none", start: bodyStart, end: bodyStart,
			});
			expect(requestPreviewAtDocumentEnd).toHaveBeenNthCalledWith(2, initialMarkdown, {
				direction: "none", start: bodyStart + 1, end: bodyStart + 1,
			});
			expect(requestPreviewAtDocumentEnd).toHaveBeenNthCalledWith(3, emptyMarkdown, {
				direction: "none", start: bodyStart, end: bodyStart,
			});
			expect(requestPreviewAtDocumentEnd).toHaveBeenNthCalledWith(4, frameRemovedMarkdown);
			expect(pinReleases).toHaveLength(4);
			for (const release of pinReleases) expect(release).toHaveBeenCalledOnce();
			expect(documentSession.document.getSelection()).toEqual({
				direction: "none",
				end: frameRemovedMarkdown.length,
				start: frameRemovedMarkdown.length,
			});
			expect(current.surface.querySelectorAll("pre")).toHaveLength(0);
			expect(
				current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
			).not.toBeNull();
			const finalParagraph = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b219"]',
			);
			const visualSelection = window.getSelection();
			const visualAnchor = visualSelection?.anchorNode;
			if (!(finalParagraph instanceof HTMLElement) || !visualAnchor) {
				throw new Error("windowed-history-removal-visible-caret-missing");
			}
			expect(visualSelection?.isCollapsed).toBe(true);
			expect(
				visualAnchor === finalParagraph ||
					finalParagraph.contains(visualAnchor),
			).toBe(true);
			expect(
				textOffsetWithin(
					finalParagraph,
					visualAnchor,
					visualSelection.anchorOffset,
				),
			).toBe(finalParagraph.textContent?.length);
			expect(onDiagnostic).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();

			view.unmount();
			documentSession.document.destroy();
			container.remove();
			submissionField.remove();
		},
	);

	it("does not map a document-end history caret over hidden non-line-ending source", () => {
		const current = fixture({
			lineOverrides: { 0: "Before" },
			mounted: [0],
			sourceBlockCount: 1,
		});
		const markdown = "Visible content\n\n[ref]: https://example.test\n";
		current.setCanonical("Before");
		let historySelection: DocumentSelection = {
			direction: "none",
			end: 0,
			start: 0,
		};
		const redo = vi.fn(() => {
			current.setCanonical(markdown);
			historySelection = {
				direction: "none",
				end: markdown.length,
				start: markdown.length,
			};
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			redo,
		});
		const requestPreview = vi.fn(() => "hidden-source-history");
		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onDiagnostic,
			onFailure,
			requestPreview,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();

		const historyRedo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyRedo",
		});
		current.surface.dispatchEvent(historyRedo);
		expect(historyRedo.defaultPrevented).toBe(true);
		expect(redo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(markdown);
		expect(requestPreview).toHaveBeenCalledWith(markdown);

		current.surface.innerHTML =
			'<p data-easymde-visual-block-id="b0">Visible content</p>';
		rerenderPreview(
			{ ...current.editMap, signature: "hidden-source-history" },
			{ revision: 2, signature: "hidden-source-history" },
		);

		// One report per event: the pinned document-end demand fails through
		// the transfer owner, which is the single owner of this code, so the
		// diagnostic channel stays silent for the same event.
		expect(onDiagnostic).not.toHaveBeenCalledWith(
			"visual-editor-window-history-selection-not-mounted",
		);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-history-selection-not-mounted",
		);
		expect(onFailure).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(markdown);
		const visibleBlock = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b0"]',
		);
		const anchor = window.getSelection()?.anchorNode;
		expect(
			Boolean(visibleBlock && anchor && visibleBlock.contains(anchor)),
		).toBe(false);
		view.unmount();
	});

	it("restores the document-end history caret after a lone-CR omitted whitespace line", () => {
		const current = fixture({
			lineOverrides: { 0: "Before" },
			mounted: [0],
			sourceBlockCount: 1,
		});
		const markdown = "Before\r \t";
		current.setCanonical("Before");
		let historySelection: DocumentSelection = {
			direction: "none",
			end: 0,
			start: 0,
		};
		const redo = vi.fn(() => {
			current.setCanonical(markdown);
			historySelection = {
				direction: "none",
				end: markdown.length,
				start: markdown.length,
			};
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			redo,
		});
		const signature = "lone-cr-whitespace-history";
		const requestPreview = vi.fn(() => signature);
		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onDiagnostic,
			onFailure,
			requestPreview,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();

		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyRedo",
			}),
		);
		current.surface.innerHTML =
			'<p data-easymde-visual-block-id="b0">Before</p>';
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b0"]',
		);
		const selection = window.getSelection();
		if (!(paragraph instanceof HTMLElement) || !selection?.anchorNode) {
			throw new Error("windowed-lone-cr-whitespace-caret-missing");
		}
		expect(paragraph.contains(selection.anchorNode)).toBe(true);
		expect(
			textOffsetWithin(paragraph, selection.anchorNode, selection.anchorOffset),
		).toBe(paragraph.textContent?.length);
		view.unmount();
	});

	it("leaves an empty fence on a second Enter in a windowed block", () => {
		const current = fixture({ lineOverrides: { 160: "```js" } });
		const requestPreview = vi.fn(() => "unexpected-preview");
		const onPendingChange = vi.fn();
		const { view } = renderWindowEditor(current, {
			onPendingChange,
			requestPreview,
		});
		const sourceBlock = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const source = sourceBlock?.firstChild;
		if (!(source instanceof Text))
			throw new Error("windowed-second-enter-source-missing");
		placeCaret(source, source.length);
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		);
		const firstCode = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"] > code',
		);
		if (!(firstCode instanceof HTMLElement))
			throw new Error("windowed-second-enter-code-missing");
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onPendingChange).not.toHaveBeenCalledWith(true);

		const secondEnter = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "Enter",
		});
		current.surface.dispatchEvent(secondEnter);
		expect(secondEnter.defaultPrevented).toBe(true);
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		expect(paragraph?.tagName).toBe("P");
		expect(window.getSelection()?.anchorNode).toBe(paragraph);
		expect(current.canonical()).not.toContain("```js\n\n```");
		expect(current.canonical()).toContain("Line 161");
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onPendingChange).not.toHaveBeenCalledWith(true);
		view.unmount();
	});

	it("rebuilds a windowed code child removed by a full-range deletion", () => {
		const current = fixture({ lineOverrides: { 160: "~~~bash" } });
		const requestPreview = vi.fn(() => "full-delete-preview");
		const { view } = renderWindowEditor(current, { requestPreview });
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const source = paragraph?.firstChild;
		if (!(source instanceof Text))
			throw new Error("windowed-full-delete-source-missing");
		placeCaret(source, source.length);
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		);

		const pre = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const code = pre?.querySelector(":scope > code");
		const placeholder = code?.firstElementChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(code instanceof HTMLElement) ||
			!(placeholder instanceof HTMLSpanElement) ||
			!(placeholder.firstChild instanceof Text)
		)
			throw new Error("windowed-full-delete-code-missing");
		const gutter = document.createElement("span");
		gutter.className = "easymde-code-line-number-gutter";
		gutter.textContent = "1";
		pre.insertBefore(gutter, code);
		const codeText = placeholder.firstChild;
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "echo hi",
				inputType: "insertText",
			}),
		);
		codeText.data = "echo hi";
		placeCaret(codeText, codeText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "echo hi",
				inputType: "insertText",
			}),
		);
		expect(current.canonical()).toContain("```bash\necho hi\n```");

		const selectedCode = document.createRange();
		selectedCode.selectNodeContents(code);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(selectedCode);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward",
			}),
		);
		code.remove();
		pre.append(document.createElement("br"));
		const normalizedSelection = document.createRange();
		normalizedSelection.setStart(pre, 0);
		normalizedSelection.collapse(true);
		selection?.removeAllRanges();
		selection?.addRange(normalizedSelection);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentBackward",
			}),
		);

		const restoredCode = pre.querySelector(":scope > code");
		const restored = restoredCode?.firstElementChild;
		expect(Array.from(pre.children).map((child) => child.tagName)).toEqual([
			"SPAN",
			"CODE",
		]);
		expect(
			pre.querySelector(":scope > .easymde-code-line-number-gutter"),
		).not.toBeNull();
		expect(restoredCode?.className).toBe("hljs language-bash");
		expect(restored).toBeInstanceOf(HTMLSpanElement);
		expect(restored?.getAttribute("data-easymde-visual-code-placeholder")).toBe(
			"",
		);
		expect(restored?.textContent).toBe("");
		expect(current.canonical()).toContain("```bash\n\n```");
		expect(requestPreview).not.toHaveBeenCalled();

		if (
			!(restored instanceof HTMLSpanElement) ||
			!(restored.firstChild instanceof Text)
		) {
			throw new Error("windowed-full-delete-placeholder-missing");
		}
		const restoredText = restored.firstChild;
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "y",
				inputType: "insertText",
			}),
		);
		restoredText.data = "y";
		placeCaret(restoredText, restoredText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "y",
				inputType: "insertText",
			}),
		);
		expect(restored.hasAttribute("data-easymde-visual-code-placeholder")).toBe(
			false,
		);
		expect(current.canonical()).toContain("```bash\ny\n```");
		expect(requestPreview).not.toHaveBeenCalled();
		view.unmount();
	});

	it("does not mutate an empty fence while editing an unrelated windowed paragraph", () => {
		const current = fixture({
			lineOverrides: { 160: "~~~", 161: "Paragraph" },
			mounted: [160, 161],
		});
		const { view } = renderWindowEditor(current);
		const fenceParagraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const fenceText = fenceParagraph?.firstChild;
		if (!(fenceText instanceof Text))
			throw new Error("windowed-unrelated-fence-missing");
		placeCaret(fenceText, fenceText.length);
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		);

		const pre = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const placeholder = pre?.querySelector(
			"[data-easymde-visual-code-placeholder]",
		);
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b161"]',
		);
		const paragraphText = paragraph?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(placeholder instanceof HTMLElement) ||
			!(paragraphText instanceof Text)
		) {
			throw new Error("windowed-unrelated-paragraph-missing");
		}
		const before = current.canonical();
		placeCaret(paragraphText, paragraphText.length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "!",
				inputType: "insertText",
			}),
		);
		paragraphText.data = "Paragraph!";
		placeCaret(paragraphText, paragraphText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "!",
				inputType: "insertText",
			}),
		);

		expect(
			placeholder.getAttribute("data-easymde-visual-code-placeholder"),
		).toBe("");
		expect(current.canonical()).toBe(before.replace("Paragraph", "Paragraph!"));
		view.unmount();
	});

	it("reports an input-phase unsupported windowed PRE shape without committing input", () => {
		const current = fixture({
			lineOverrides: { 160: "~~~bash", 161: "Paragraph" },
			mounted: [160, 161],
		});
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "unexpected-preview");
		const { view } = renderWindowEditor(current, { onFailure, requestPreview });
		const fenceParagraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const fenceText = fenceParagraph?.firstChild;
		if (!(fenceText instanceof Text))
			throw new Error("windowed-invalid-shape-fence-missing");
		placeCaret(fenceText, fenceText.length);
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		);
		const pre = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const code = pre?.querySelector(":scope > code");
		const codeText = code?.firstElementChild?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(code instanceof HTMLElement) ||
			!(codeText instanceof Text)
		) {
			throw new Error("windowed-invalid-shape-fixture-missing");
		}
		const unknown = document.createElement("span");
		unknown.textContent = "user-visible";
		const canonicalBefore = current.canonical();
		const applyCallsBefore = current.documentChanges.mock.calls.length;
		placeCaret(codeText, codeText.length);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "!",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		const acceptedHtml = current.surface.innerHTML;
		pre.insertBefore(unknown, code);
		const input = new InputEvent("input", {
			bubbles: true,
			data: "!",
			inputType: "insertText",
		});
		expect(() => current.surface.dispatchEvent(input)).not.toThrow();

		expect(onFailure).toHaveBeenCalledWith("visual-editor-code-shape-invalid");
		expect(onFailure.mock.calls).toEqual([
			["visual-editor-code-shape-invalid"],
		]);
		expect(current.canonical()).toBe(canonicalBefore);
		expect(current.surface.innerHTML).toBe(acceptedHtml);
		expect(current.documentChanges.mock.calls.length).toBe(applyCallsBefore);
		expect(requestPreview).not.toHaveBeenCalled();
		const restoredCode = pre.querySelector(":scope > code");
		const restoredPlaceholderText = restoredCode?.firstElementChild?.firstChild;
		expect(restoredPlaceholderText).toBeInstanceOf(Text);
		expect(window.getSelection()?.anchorNode).toBe(restoredPlaceholderText);
		expect(window.getSelection()?.anchorOffset).toBe(codeText.length);
		view.unmount();
	});

	it("keeps a one-block heading toolbar command local so the next Backspace is not blocked by Preview", () => {
		const current = fixture();
		const requestPreview = vi.fn(() => "heading-preview");
		const finalizeAdoption = vi.fn(() => true);
		const prepareWindowBlockAdoption = vi.fn(() => finalizeAdoption);
		const onPendingChange = vi.fn();
		const onFailure = vi.fn();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onPendingChange,
			prepareWindowBlockAdoption,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			requestPreview,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-toolbar-text-missing");
		placeCaret(text, text.length);
		if (!runtime) throw new Error("windowed-toolbar-runtime-missing");
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;

		const commandResult = readyRuntime.executeCommand({
			action: "heading",
			group: "heading",
			icon: "heading",
			id: "heading2",
			label: "Heading 2",
			level: 2,
			surface: "heading-menu",
		});
		expect(commandResult).toBe("handled");
		expect(onFailure).not.toHaveBeenCalled();
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onPendingChange).not.toHaveBeenCalledWith(true);

		const heading = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const headingText = heading?.firstChild;
		if (!(headingText instanceof Text))
			throw new Error("windowed-toolbar-heading-missing");
		const selection = window.getSelection();
		expect(selection?.anchorNode).toBe(headingText);
		expect(selection?.anchorOffset).toBe(headingText.length);
		expect(prepareWindowBlockAdoption).toHaveBeenCalledWith(heading);
		expect(finalizeAdoption).toHaveBeenCalledOnce();
		dispatchBackspace(current.surface);

		expect(current.canonical().split("\n")[160]).toBe("## Line 16");
		expect(onPendingChange).not.toHaveBeenCalledWith(true);
		view.unmount();
	});

	it("returns unsupported without reporting a command that has no editable selection", () => {
		const current = fixture();
		const onFailure = vi.fn();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-unsupported-runtime-missing");
		window.getSelection()?.removeAllRanges();
		const before = current.canonical();

		try {
			expect(
				(runtime as ImmersiveVisualEditorRuntime).executeCommand({
					action: "wrap",
					group: "format",
					icon: "editor-bold",
					id: "bold",
					label: "Bold",
					prefix: "**",
					suffix: "**",
					surface: "main",
				}),
			).toBe("unsupported");
			expect(current.canonical()).toBe(before);
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("does not mutate canonical content when window block adoption preflight fails", () => {
		const current = fixture();
		current.surface.tabIndex = 0;
		const onFailure = vi.fn();
		const prepareWindowBlockAdoption = vi.fn(() => null);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			prepareWindowBlockAdoption,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-preflight-text-missing");
		placeCaret(text, text.length);
		if (!runtime) throw new Error("windowed-preflight-runtime-missing");

		const before = current.canonical();
		expect(
			(runtime as ImmersiveVisualEditorRuntime).executeCommand({
				action: "heading",
				group: "heading",
				icon: "heading",
				id: "heading2",
				label: "Heading 2",
				level: 2,
				surface: "heading-menu",
			}),
		).toBe("failed");

		expect(current.canonical()).toBe(before);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-block-adoption-failed",
		);
		expect(prepareWindowBlockAdoption).toHaveBeenCalledOnce();
		const restoredSelectionText = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		)?.firstChild;
		if (!(restoredSelectionText instanceof Text)) {
			throw new Error("windowed-preflight-restored-text-missing");
		}
		expect(window.getSelection()?.anchorNode).toBe(restoredSelectionText);
		expect(window.getSelection()?.focusNode).toBe(restoredSelectionText);
		expect(window.getSelection()?.anchorOffset).toBe(
			restoredSelectionText.length,
		);
		expect(window.getSelection()?.focusOffset).toBe(
			restoredSelectionText.length,
		);
		expect(document.activeElement).toBe(current.surface);
		view.unmount();
	});

	it("rolls back the canonical and Preview transaction when adoption finalization fails", () => {
		const current = fixture();
		current.surface.tabIndex = 0;
		const onFailure = vi.fn();
		let canonicalDuringFinalize: string | null = null;
		const finalizeAdoption = vi.fn(() => {
			canonicalDuringFinalize = current.canonical();
			return false;
		});
		const prepareWindowBlockAdoption = vi.fn(() => finalizeAdoption);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			prepareWindowBlockAdoption,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (
			!(paragraph instanceof HTMLParagraphElement) ||
			!(text instanceof Text)
		) {
			throw new Error("windowed-finalization-text-missing");
		}
		if (!runtime) throw new Error("windowed-finalization-runtime-missing");

		const before = current.canonical();
		const beforeHtml = current.surface.innerHTML;
		placeCaret(text, text.length);
		expect(
			(runtime as ImmersiveVisualEditorRuntime).executeCommand({
				action: "heading",
				group: "heading",
				icon: "heading",
				id: "heading2",
				label: "Heading 2",
				level: 2,
				surface: "heading-menu",
			}),
		).toBe("failed");

		expect(current.canonical()).toBe(before);
		expect(current.surface.innerHTML).toBe(beforeHtml);
		expect(
			current.surface.querySelector('[data-easymde-visual-block-id="b160"]'),
		).toBe(paragraph);
		expect(canonicalDuringFinalize).toBe(before);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-block-adoption-failed",
		);
		expect(onFailure).toHaveBeenCalledOnce();
		expect(prepareWindowBlockAdoption).toHaveBeenCalledOnce();
		expect(finalizeAdoption).toHaveBeenCalledOnce();
		expect(current.documentChanges).not.toHaveBeenCalled();
		const restoredSelectionText = paragraph.firstChild;
		if (!(restoredSelectionText instanceof Text)) {
			throw new Error("windowed-finalization-restored-selection-text-missing");
		}
		expect(window.getSelection()?.anchorNode).toBe(restoredSelectionText);
		expect(window.getSelection()?.focusNode).toBe(restoredSelectionText);
		expect(window.getSelection()?.anchorOffset).toBe(
			restoredSelectionText.length,
		);
		expect(window.getSelection()?.focusOffset).toBe(
			restoredSelectionText.length,
		);
		expect(document.activeElement).toBe(current.surface);

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(historyUndo.defaultPrevented).toBe(true);
		expect(current.documentSession.document.undo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(before);

		const historyRedo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyRedo",
		});
		current.surface.dispatchEvent(historyRedo);
		expect(historyRedo.defaultPrevented).toBe(true);
		expect(current.documentSession.document.redo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(before);

		const restoredText = paragraph.firstChild;
		if (!(restoredText instanceof Text)) {
			throw new Error("windowed-finalization-restored-text-missing");
		}
		expect(window.getSelection()?.anchorNode).toBe(restoredText);
		expect(window.getSelection()?.anchorOffset).toBe(restoredText.length);
		placeCaret(restoredText, restoredText.length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "!",
				inputType: "insertText",
			}),
		);
		restoredText.data += "!";
		placeCaret(restoredText, restoredText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "!",
				inputType: "insertText",
			}),
		);

		expect(current.canonical().split("\n")[160]).toBe("Line 160!");
		expect(
			onFailure.mock.calls.map(([code]) => code),
		).toContain("visual-editor-window-block-adoption-failed");
		view.unmount();
	});

	it("keeps a committed canonical change truthful when Preview scheduling fails", () => {
		const current = fixture();
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreview = vi.fn(() => {
			return "unused-preview";
		});
		const requestPreviewAtDocumentEnd = vi.fn(() => {
			throw new Error("visual-editor-window-preview-schedule-failed");
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			prepareWindowBlockAdoption: () => () => true,
			requestPreview,
			requestPreviewAtDocumentEnd,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text) || !runtime) {
			throw new Error("windowed-preview-schedule-failure-fixture-missing");
		}
		current.surface.tabIndex = 0;
		current.surface.focus();
		window.getSelection()?.setBaseAndExtent(text, 6, text, 2);
		const sourceBefore = current.canonical();

		try {
			expect(
				(runtime as ImmersiveVisualEditorRuntime).executeCommand({
					action: "codeFence",
					group: "insert",
					icon: "media-code",
					id: "codefence-middle",
					label: "Code fence",
					surface: "main",
				}),
			).toBe("failed");
			expect(current.canonical()).not.toBe(sourceBefore);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(
				current.surface.querySelector(
					'[data-easymde-visual-block-id="b160"] > code',
				)?.tagName,
			).toBe("CODE");
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-preview-schedule-failed",
			);
			expect(onTransferFailure).toHaveBeenCalledOnce();
		} finally {
			view.unmount();
		}
	});

	it("releases editing ownership on unmount without deferred selection work", async () => {
		const current = fixture();
		const { view } = renderWindowEditor(current);
		view.unmount();
		await act(async () => {
			await Promise.resolve();
		});
		expect(
			current.documentSession.document.setVisualEditingActive,
		).toHaveBeenLastCalledWith(false);
	});

	it("accepts source navigation with a retained connected protected selection", () => {
		const generatedSource = "Before\n\n$$x$$\n\nAfter";
		const current = fixture({
			blockOverrides: { 160: generatedSource },
			markupOverrides: {
				160:
					'<p data-easymde-visual-block-id="b160">' +
					"<span>Before</span>" +
					'<span class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x">' +
					'<span class="katex-display"><span class="katex">x</span></span>' +
					"</span>" +
					"<span>After</span></p>",
			},
			mounted: [160],
			nonEditable: [160],
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const protectedNode = current.surface.querySelector(".katex-display");
		if (!(protectedNode instanceof HTMLElement) || !runtime) {
			throw new Error("windowed-source-navigation-protected-node-missing");
		}
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
		const range = document.createRange();
		range.selectNodeContents(protectedNode);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		try {
			expect(
				readyRuntime.prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(true);
			expect(current.documentChanges).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("registers a Preview-owner window certificate before navigation", () => {
		const current = fixture();
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const { rerenderAcceptedWindow, view } = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const original = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!(original instanceof HTMLElement) || !runtime) {
			throw new Error("windowed-certificate-original-node-missing");
		}
		const adopted = original.cloneNode(true) as HTMLElement;
		original.replaceWith(adopted);
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(current, adopted);
		act(() => rerenderAcceptedWindow(1));

		try {
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(true);
			expect(onFailure).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("registers accepted window certificate with list and blockquote nested fences and preserves navigation", () => {
		const listSource = "- item\n\n  ~~~js\n  alpha\n  ~~~";
		const quoteSource = "> ```bash linenos\n> beta\n> ```";
		const current = fixture({
			blockOverrides: {
				160: listSource,
				161: quoteSource,
			},
			markupOverrides: {
				160:
					'<ul data-easymde-visual-block-id="b160"><li><p>item</p>' +
					"<pre><code>alpha\n</code></pre></li></ul>",
				161:
					'<blockquote data-easymde-visual-block-id="b161">' +
					"<pre><code>beta\n</code></pre></blockquote>",
			},
			mounted: [160, 161],
			paragraphBlocks: true,
		});
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const { rerenderAcceptedWindow, view } = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
		});
		const listRoot = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const quoteRoot = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b161"]',
		);
		if (!listRoot || !quoteRoot || !runtime) {
			throw new Error("windowed-nested-fence-nodes-missing");
		}
		const adoptedList = listRoot.cloneNode(true) as HTMLElement;
		const adoptedQuote = quoteRoot.cloneNode(true) as HTMLElement;
		listRoot.replaceWith(adoptedList);
		quoteRoot.replaceWith(adoptedQuote);
		acceptedSnapshot = {
			blocks: [
				{
					id: "b160",
					innerHTML: adoptedList.innerHTML,
					node: adoptedList,
				},
				{
					id: "b161",
					innerHTML: adoptedQuote.innerHTML,
					node: adoptedQuote,
				},
			],
			key: 1,
			nodes: Array.from(current.surface.childNodes),
			revision: 1,
			signature: "windowed",
		};
		act(() => rerenderAcceptedWindow(1));
		const listPre = adoptedList.querySelector("pre");
		const quotePre = adoptedQuote.querySelector("pre");
		expect(listPre?.getAttribute("data-easymde-visual-fence")).toBe("~~~");
		expect(listPre?.getAttribute("data-easymde-visual-fence-info")).toBe("js");
		expect(quotePre?.getAttribute("data-easymde-visual-fence")).toBe("```");
		expect(quotePre?.getAttribute("data-easymde-visual-fence-info")).toBe(
			"bash linenos",
		);
		const canonicalBefore = {
			history: current.documentSession.document.getHistoryState(),
			revision: current.documentSession.document.getRevision?.(),
			value: current.canonical(),
		};

		try {
			// Navigation succeeds because accepted certificate and live DOM matched
			// through one source-bound idempotent transaction.
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(true);
			expect({
				history: current.documentSession.document.getHistoryState(),
				revision: current.documentSession.document.getRevision?.(),
				value: current.canonical(),
			}).toEqual(canonicalBefore);
			expect(onFailure).not.toHaveBeenCalled();

			// Context-menu whole-block selection on nested code pre is prepared.
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareContextMenuSelection?.(
					listPre,
				),
			).toBe(true);

			// Ready-to-Ready window replacement: a newer snapshot for the same nodes
			// re-registers idempotently.
			acceptedSnapshot = {
				...acceptedSnapshot,
				key: 2,
				revision: 2,
			};
			act(() => rerenderAcceptedWindow(2));
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(true);
			expect(listPre?.getAttribute("data-easymde-visual-fence")).toBe("~~~");

			// Remount re-registers and preserves source navigation.
			view.unmount();
			let remountedRuntime: ImmersiveVisualEditorRuntime | null = null;
			const remounted = renderWindowEditor(current, {
				acceptedWindowSnapshotGeneration: 2,
				getAcceptedWindowSnapshot: () => acceptedSnapshot,
				onFailure,
				onReady: (next) => {
					remountedRuntime = next;
				},
			});
			expect(
				(remountedRuntime as ImmersiveVisualEditorRuntime | null)?.prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(true);
			remounted.view.unmount();
		} finally {
			view.unmount();
		}
	});

	it("rejects accepted window certificate for nested fence when DOM or bindings are invalid", () => {
		const listSource = "- item\n\n  ~~~js\n  alpha\n  ~~~";
		const current = fixture({
			blockOverrides: { 160: listSource },
			markupOverrides: {
				160:
					'<ul data-easymde-visual-block-id="b160"><li><p>item</p>' +
					"<pre><code>alpha\n</code></pre></li></ul>",
			},
			mounted: [160],
			paragraphBlocks: true,
		});
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const { rerenderAcceptedWindow, view } = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const listRoot = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!listRoot || !runtime) throw new Error("windowed-root-missing");
		const adoptedList = listRoot.cloneNode(true) as HTMLElement;
		listRoot.replaceWith(adoptedList);

		// Negative 1: non-derived HTML mutation in live container
		acceptedSnapshot = {
			blocks: [
				{
					id: "b160",
					innerHTML: adoptedList.innerHTML,
					node: adoptedList,
				},
			],
			key: 1,
			nodes: Array.from(current.surface.childNodes),
			revision: 1,
			signature: "windowed",
		};
		const paragraph = adoptedList.querySelector("p");
		if (!paragraph) throw new Error("nested-paragraph-missing");
		paragraph.textContent = "Mutated";
		act(() => rerenderAcceptedWindow(1));
		expect(
			(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
				revision: 0,
				value: current.canonical(),
			}),
		).toBe(false);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-source-navigation-dom-stale",
		);
		view.unmount();
	});

	it("rejects a same-ID foreign window node after certificate registration", () => {
		const current = fixture();
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const { rerenderAcceptedWindow, view } = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const original = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!(original instanceof HTMLElement) || !runtime) {
			throw new Error("windowed-certificate-foreign-node-missing");
		}
		const adopted = original.cloneNode(true) as HTMLElement;
		original.replaceWith(adopted);
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(current, adopted);
		act(() => rerenderAcceptedWindow(1));
		const foreign = adopted.cloneNode(true) as HTMLElement;
		foreign.textContent = "Foreign";
		adopted.replaceWith(foreign);

		try {
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(false);
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-source-navigation-dom-stale",
			);
		} finally {
			view.unmount();
		}
	});

	it("rejects a deleted window node after certificate registration", () => {
		const current = fixture();
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const { rerenderAcceptedWindow, view } = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const original = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!(original instanceof HTMLElement) || !runtime) {
			throw new Error("windowed-certificate-delete-node-missing");
		}
		const adopted = original.cloneNode(true) as HTMLElement;
		original.replaceWith(adopted);
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(current, adopted);
		act(() => rerenderAcceptedWindow(1));
		adopted.remove();

		try {
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(false);
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-source-navigation-dom-stale",
			);
		} finally {
			view.unmount();
		}
	});

	it("commits an active Windowed composition before source navigation", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text) || !runtime) {
			throw new Error("windowed-source-navigation-composition-missing");
		}
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);
		text.data += "X";
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		const expectedValue = current.canonical().replace("Line 160", "Line 160X");

		try {
			expect(
				(runtime as ImmersiveVisualEditorRuntime).prepareSourceNavigation({
					revision: 1,
					value: expectedValue,
				}),
			).toBe(true);
			expect(current.canonical()).toBe(expectedValue);
			expect(current.documentChanges).toHaveBeenCalledOnce();
		} finally {
			view.unmount();
		}
	});

	it("rejects source navigation after a foreign editable DOM mutation", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!(paragraph instanceof HTMLElement) || !runtime) {
			throw new Error("windowed-source-navigation-editable-node-missing");
		}
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
		paragraph.textContent = "Foreign";

		try {
			expect(
				readyRuntime.prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(false);
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-source-navigation-dom-stale",
			);
			expect(current.documentChanges).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("rejects source navigation after a protected DOM mutation", () => {
		const generatedSource = "Before\n\n$$x$$\n\nAfter";
		const current = fixture({
			blockOverrides: { 160: generatedSource },
			markupOverrides: {
				160:
					'<p data-easymde-visual-block-id="b160">' +
					'<span class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x">Rendered</span>' +
					"</p>",
			},
			mounted: [160],
			nonEditable: [160],
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const protectedNode = current.surface.querySelector(".easymde-math");
		if (!(protectedNode instanceof HTMLElement) || !runtime) {
			throw new Error("windowed-source-navigation-mutation-node-missing");
		}
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
		protectedNode.textContent = "Foreign";

		try {
			expect(
				readyRuntime.prepareSourceNavigation({
					revision: 0,
					value: current.canonical(),
				}),
			).toBe(false);
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-read-only-region-mutated",
			);
			expect(current.documentChanges).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("rejects writes after an external canonical change", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const onCanonicalDocumentChange = vi.fn();
		const { view } = renderWindowEditor(current, {
			onCanonicalDocumentChange,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-unmount-text-missing");
		current.setCanonical(current.canonical().replace("Line 160", "External"));
		expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();
		placeCaret(text, text.length);
		if (!runtime) throw new Error("windowed-stale-runtime-missing");
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
		expect(
			readyRuntime.executeCommand({
				action: "heading",
				group: "heading",
				icon: "heading",
				id: "heading2",
				label: "Heading 2",
				level: 2,
				surface: "heading-menu",
			}),
		).toBe("blocked");
		view.unmount();
	});

	it("applies the exact visual wrap locally without falling back to the canonical toolbar owner", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-fallback-text-missing");
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, 4);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		if (!runtime) throw new Error("windowed-fallback-runtime-missing");
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
		expect(
			readyRuntime.executeCommand({
				action: "wrap",
				group: "format",
				icon: "editor-bold",
				id: "bold",
				label: "Bold",
				prefix: "**",
				suffix: "**",
				surface: "main",
			}),
		).toBe("handled");

		const sourceStart =
			Array.from({ length: 160 }, (_, index) => `Line ${index}`).join("\n")
				.length + 1;
		expect(current.documentChanges).toHaveBeenLastCalledWith(
			expect.objectContaining({
				selection: {
					direction: "forward",
					end: sourceStart + 6,
					start: sourceStart + 2,
				},
				value: current.canonical(),
			}),
		);
		expect(current.canonical().split("\n")[160]).toBe("**Line** 160");
		expect(readyRuntime.prepareToolbarFallback()).toBe(true);
		expect(current.canonical().split("\n")[160]).toBe("**Line** 160");
		view.unmount();
	});

	it("applies a selected visual code fence locally without requesting a Preview", () => {
		const current = fixture();
		const requestPreview = vi.fn(() => "unexpected-preview");
		const prepareWindowBlockAdoption = vi.fn(() => () => true);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			prepareWindowBlockAdoption,
			requestPreview,
		});
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-code-fence-text-missing");
		const range = document.createRange();
		range.selectNodeContents(text);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		if (!runtime) throw new Error("windowed-code-fence-runtime-missing");
		const readyRuntime = runtime as ImmersiveVisualEditorRuntime;

		try {
			expect(
				readyRuntime.executeCommand({
					action: "codeFence",
					group: "insert",
					icon: "media-code",
					id: "codefence",
					label: "Code fence",
					surface: "main",
				}),
			).toBe("handled");
			expect(current.canonical().split("\n").slice(159, 164)).toEqual([
				"Line 159",
				"```",
				"Line 160",
				"```",
				"Line 161",
			]);
			expect(
				current.surface.querySelector(
					'[data-easymde-visual-block-id="b160"] > code.hljs',
				)?.textContent,
			).toBe("Line 160");
			expect(requestPreview).not.toHaveBeenCalled();
			expect(prepareWindowBlockAdoption).toHaveBeenCalledOnce();
			expect(selection?.toString()).toBe("Line 160");
			expect(selection?.anchorNode).toBe(
				current.surface.querySelector(
					'[data-easymde-visual-block-id="b160"] > code',
				)?.firstChild,
			);
			expect(selection?.focusNode).toBe(
				current.surface.querySelector(
					'[data-easymde-visual-block-id="b160"] > code',
				)?.firstChild,
			);
		} finally {
			view.unmount();
		}
	});

	it("restores a noncollapsed selection after an accepted middle code-fence Preview", () => {
		const current = fixture();
		const requestPreview = vi.fn((_markdown: string) => "middle-code-preview");
		const requestPreviewAtDocumentEnd = vi.fn((markdown: string) => ({
			release: vi.fn(),
			signature: requestPreview(markdown),
		}));
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreview,
			requestPreviewAtDocumentEnd,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-middle-code-text-missing");
		const selection = window.getSelection();
		selection?.setBaseAndExtent(text, 6, text, 2);
		if (!runtime) throw new Error("windowed-middle-code-runtime-missing");

		expect(
			(runtime as ImmersiveVisualEditorRuntime).executeCommand({
				action: "codeFence",
				group: "insert",
				icon: "media-code",
				id: "codefence-middle",
				label: "Code fence",
				surface: "main",
			}),
		).toBe("handled");
		const expectedSelection = current.documentSession.document.getSelection();
		expect(expectedSelection.direction).toBe("backward");
		expect(expectedSelection.start).toBeLessThan(expectedSelection.end);
		expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(
			current.canonical(),
			expectedSelection,
		);

		const source = current.canonical();
		const opening = source.match(/(^|\n)(`{3,}|~{3,})[^\n]*\n/u);
		if (!opening || undefined === opening.index || !opening[2]) {
			throw new Error("windowed-middle-code-fence-source-missing");
		}
		const fence = opening[2];
		const fenceLineStart = opening.index + (opening[1] ? 1 : 0);
		const bodyStart = opening.index + opening[0].length;
		const closingMarker = `\n${fence}\n`;
		const closingStart = source.indexOf(closingMarker, bodyStart);
		if (closingStart < 0)
			throw new Error("windowed-middle-code-fence-close-missing");
		const targetEnd = closingStart + closingMarker.length;
		const startLine = source.slice(0, fenceLineStart).split("\n").length - 1;
		const endLine = source.slice(0, targetEnd).split("\n").length - 1;
		const body = source.slice(bodyStart, closingStart + 1);
		const acceptedBlocks = [
			...current.editMap.blocks.slice(0, 160),
			{
				editable: true,
				endLine,
				id: "b160-code",
				startLine,
			},
		];
		current.surface.innerHTML = [
			'<div data-easymde-preview-window-spacer="1"></div>',
			`<pre data-easymde-visual-block-id="b160-code"><code>${body}</code></pre>`,
			'<div data-easymde-preview-window-spacer="1"></div>',
		].join("");
		selection?.collapse(current.surface, 0);
		act(() => {
			rerenderPreview(
				{
					...current.editMap,
					blocks: acceptedBlocks,
					signature: "middle-code-preview",
				},
				{ revision: 2, signature: "middle-code-preview" },
			);
		});

		const acceptedCode = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160-code"] > code',
		);
		const acceptedText = acceptedCode?.firstChild;
		const acceptedSelection = window.getSelection();
		expect(onFailure).not.toHaveBeenCalled();
		expect(onTransferFailure).not.toHaveBeenCalled();
		expect(acceptedText).toBeInstanceOf(Text);
		expect(acceptedSelection?.rangeCount).toBe(1);
		expect(acceptedSelection?.isCollapsed).toBe(false);
		expect(acceptedSelection?.anchorNode).toBe(acceptedText);
		expect(acceptedSelection?.focusNode).toBe(acceptedText);
		expect(acceptedSelection?.anchorOffset).toBeGreaterThan(
			acceptedSelection?.focusOffset ?? Number.MAX_SAFE_INTEGER,
		);
		expect(current.documentSession.document.getSelection()).toEqual(
			expectedSelection,
		);
		view.unmount();
	});

	it("keeps the canonical selection when the windowed surface has no DOM selection", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		window.getSelection()?.removeAllRanges();

		try {
			if (!runtime) throw new Error("windowed-empty-selection-runtime-missing");
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			expect(readyRuntime.prepareToolbarFallback()).toBe(true);
			expect(current.documentChanges).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("commits the following block boundary when a removal caret lands on the blank line it left", () => {
		const current = fixture({
			lineOverrides: { 160: "Remove me", 161: "After" },
			mounted: [159, 160, 161],
			paragraphBlocks: true,
		});
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(
			(_markdown: string, _selection?: Readonly<{ end: number; start: number }>) => ({
				release: vi.fn(),
				signature: "windowed",
			}),
		);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreviewAtDocumentEnd,
		});
		current.surface.tabIndex = 0;
		current.surface.focus();

		try {
			if (!runtime) throw new Error("windowed-removal-caret-runtime-missing");
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const source = current.canonical();
			const removed = "Remove me";
			const from = source.indexOf(removed);
			if (from < 0) throw new Error("windowed-removal-caret-target-missing");
			// A canonical removal of a whole block keeps its trailing line
			// terminator: the command removes the block's content only, so the
			// block's ledger range survives as bare whitespace.
			const to = from + removed.length;
			const value = source.slice(0, from) + source.slice(to);
			// The command collapses its caret where the removed block started.
			// That offset is the empty line the removal left behind, which no
			// editable block owns, so the following editable block owns the
			// committed selection instead.
			expect(
				readyRuntime.applyCanonicalChange({
					change: {
						changes: { from, insert: "", to },
						selection: { direction: "none", end: from, start: from },
						value,
					},
					expected: {
						revision: 0,
						selection: { direction: "none", end: 0, start: 0 },
						value: source,
					},
				}),
			).toBe("handled");
			const projected = value.indexOf("After");
			if (projected <= 0) {
				throw new Error("windowed-removal-caret-follower-missing");
			}
			expect(current.documentChanges).toHaveBeenLastCalledWith(
				expect.objectContaining({
					selection: { direction: "none", end: projected, start: projected },
					value,
				}),
			);
			expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(value, {
				direction: "none",
				end: projected,
				start: projected,
			});
			expect(onFailure).not.toHaveBeenCalled();
			expect(onTransferFailure).not.toHaveBeenCalled();
			// The accepted Preview for that commit must reach the same
			// position: the window replaces the removed block's DOM, so the
			// delayed pending-history restore is the step that decides whether
			// the surface keeps editing or is torn down.
			current.surface
				.querySelector('[data-easymde-visual-block-id="b160"]')
				?.remove();
			rerenderPreview(
				{
					blocks: current.editMap.blocks.filter(
						(block) => "b160" !== block.id,
					),
					coordinate: "line",
					signature: "windowed",
					version: 1,
				},
				{ revision: 2, signature: "windowed" },
			);
			expect(onFailure).not.toHaveBeenCalled();
			expect(onTransferFailure).not.toHaveBeenCalled();
			const caret = window.getSelection();
			expect(caret?.rangeCount).toBe(1);
			expect(caret?.isCollapsed).toBe(true);
			expect(caret?.anchorNode?.isConnected).toBe(true);
			expect(current.surface.contains(caret?.anchorNode ?? null)).toBe(true);
		} finally {
			view.unmount();
		}
	});

	it("commits the preceding block boundary when the removal has no following block", () => {
		const current = fixture({
			mounted: [159, 160],
			paragraphBlocks: true,
			sourceBlockCount: 161,
		});
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(
			(_markdown: string, _selection?: Readonly<{ end: number; start: number }>) => ({
				release: vi.fn(),
				signature: "windowed",
			}),
		);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreviewAtDocumentEnd,
		});
		current.surface.tabIndex = 0;
		current.surface.focus();

		try {
			if (!runtime) {
				throw new Error("windowed-trailing-removal-runtime-missing");
			}
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const source = current.canonical();
			const removed = "Line 160";
			const from = source.indexOf(removed);
			if (from < 0) throw new Error("windowed-trailing-removal-target-missing");
			// The last block ends the document, so it has no trailing newline.
			const to = source.length;
			const value = source.slice(0, from) + source.slice(to);
			const result = readyRuntime.applyCanonicalChange({
				change: {
					changes: { from, insert: "", to },
					selection: { direction: "none", end: from, start: from },
					value,
				},
				expected: {
					revision: 0,
					selection: { direction: "none", end: 0, start: 0 },
					value: source,
				},
			});
			expect(onFailure).not.toHaveBeenCalled();
			expect(result).toBe("handled");
			const preceding = "Line 159";
			// The committed caret belongs to the preceding block's own text end:
			// its ledger range includes the trailing line terminators the
			// removal left behind, which no caret can be restored onto.
			const projected = value.indexOf(preceding) + preceding.length;
			expect(current.documentChanges).toHaveBeenLastCalledWith(
				expect.objectContaining({
					selection: { direction: "none", end: projected, start: projected },
					value,
				}),
			);
			expect(onFailure).not.toHaveBeenCalled();
			// The accepted Preview for the removal must not tear the surface
			// down: the delayed pending-history restore has to reach the
			// committed position inside the mounted window.
			current.surface
				.querySelector('[data-easymde-visual-block-id="b160"]')
				?.remove();
			rerenderPreview(
				{
					blocks: current.editMap.blocks.slice(0, 160),
					coordinate: "line",
					signature: "windowed",
					version: 1,
				},
				{ revision: 2, signature: "windowed" },
			);
			expect(onFailure).not.toHaveBeenCalled();
			expect(onTransferFailure).not.toHaveBeenCalled();
			const caret = window.getSelection();
			expect(caret?.rangeCount).toBe(1);
			expect(caret?.isCollapsed).toBe(true);
			expect(current.surface.contains(caret?.anchorNode ?? null)).toBe(true);
		} finally {
			view.unmount();
		}
	});

	it("keeps the windowed surface editable when Undo restores a removed code block", () => {
		const current = fixture({
			lineOverrides: { 159: "Before", 160: "```text\ncode\n```" },
			markupOverrides: {
				159: '<p data-easymde-visual-block-id="b159">Before</p>',
				160: '<pre data-easymde-visual-block-id="b160"><code>code</code></pre>',
			},
			mounted: [159, 160],
			sourceBlockCount: 161,
		});
		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onDiagnostic,
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreview: () => "windowed",
			requestPreviewAtDocumentEnd: testDocumentEndPreviewRequest("windowed"),
		});
		current.surface.tabIndex = 0;
		current.surface.focus();

		try {
			if (!runtime) throw new Error("windowed-undo-runtime-missing");
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const source = current.canonical();
			// Block 160 is the last block, a fence with no trailing terminator:
			// the command removes its content through the document end.
			const fenceStart = source.indexOf("```text");
			if (fenceStart < 0) throw new Error("windowed-undo-fence-missing");
			const removed = source.slice(0, fenceStart);
			expect(
				readyRuntime.applyCanonicalChange({
					change: {
						changes: { from: fenceStart, insert: "", to: source.length },
						selection: { direction: "none", end: fenceStart, start: fenceStart },
						value: removed,
					},
					expected: {
						revision: 0,
						selection: { direction: "none", end: 0, start: 0 },
						value: source,
					},
				}),
			).toBe("handled");
			expect(onFailure).not.toHaveBeenCalled();
			// Complete that transfer the way an accepted Preview window commit
			// does, so the history route is free again.
			current.surface
				.querySelector('[data-easymde-visual-block-id="b160"]')
				?.remove();
			const withoutFence = {
				blocks: current.editMap.blocks.filter((block) => "b160" !== block.id),
				coordinate: "line" as const,
				signature: "windowed",
				version: 1 as const,
			};
			rerenderPreview(withoutFence, { revision: 2, signature: "windowed" });
			expect(onFailure).not.toHaveBeenCalled();

			// Cmd+Z restores the removed fence and the non-collapsed source
			// selection the command had replaced.
			const fence = document.createElement("pre");
			fence.setAttribute("data-easymde-visual-block-id", "b160");
			const code = document.createElement("code");
			code.textContent = "code";
			fence.append(code);
			current.surface.append(fence);
			const restoredSelection = {
				direction: "forward" as const,
				end: source.length,
				start: fenceStart,
			};
			Object.assign(current.documentSession.document, {
				getSelection: () => restoredSelection,
				undo: vi.fn(() => {
					current.setCanonical(source);
					return true;
				}),
			});
			const historyUndo = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyUndo",
			});
			current.surface.dispatchEvent(historyUndo);
			expect(historyUndo.defaultPrevented).toBe(true);
			expect(current.canonical()).toBe(source);
			rerenderPreview(
				{ ...current.editMap, signature: "windowed" },
				{ revision: 3, signature: "windowed" },
			);

			expect(onDiagnostic.mock.calls.flat()).toEqual([]);
			expect(onFailure.mock.calls.flat()).toEqual([]);
			expect(onTransferFailure).not.toHaveBeenCalled();
			const caret = window.getSelection();
			expect(caret?.anchorNode?.isConnected).toBe(true);
			expect(current.surface.contains(caret?.anchorNode ?? null)).toBe(true);
		} finally {
			view.unmount();
		}
	});

	it("commits the following block boundary when a removal caret lands on the blank line it left", () => {
		const current = fixture({
			lineOverrides: { 160: "Remove me", 161: "After" },
			mounted: [159, 160, 161],
			paragraphBlocks: true,
		});
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(
			(_markdown: string, _selection?: Readonly<{ end: number; start: number }>) => ({
				release: vi.fn(),
				signature: "windowed",
			}),
		);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreviewAtDocumentEnd,
		});
		current.surface.tabIndex = 0;
		current.surface.focus();

		try {
			if (!runtime) throw new Error("windowed-removal-caret-runtime-missing");
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const source = current.canonical();
			const removed = "Remove me";
			const from = source.indexOf(removed);
			if (from < 0) throw new Error("windowed-removal-caret-target-missing");
			const to = from + removed.length + 1;
			const value = source.slice(0, from) + source.slice(to);
			// The command collapses its caret where the removed block started.
			// That offset is the empty line the removal left behind, which no
			// editable block owns.
			expect(
				readyRuntime.applyCanonicalChange({
					change: {
						changes: { from, insert: "", to },
						selection: { direction: "none", end: from, start: from },
						value,
					},
					expected: {
						revision: 0,
						selection: { direction: "none", end: 0, start: 0 },
						value: source,
					},
				}),
			).toBe("handled");
			const projected = value.indexOf("After");
			if (projected <= 0) {
				throw new Error("windowed-removal-caret-follower-missing");
			}
			expect(current.documentChanges).toHaveBeenLastCalledWith(
				expect.objectContaining({
					selection: { direction: "none", end: projected, start: projected },
					value,
				}),
			);
			expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(value, {
				direction: "none",
				end: projected,
				start: projected,
			});
			expect(onFailure).not.toHaveBeenCalled();
			expect(onTransferFailure).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("commits the preceding block boundary when the removal has no following block", () => {
		const current = fixture({
			mounted: [159, 160],
			paragraphBlocks: true,
			sourceBlockCount: 161,
		});
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(
			(_markdown: string, _selection?: Readonly<{ end: number; start: number }>) => ({
				release: vi.fn(),
				signature: "windowed",
			}),
		);
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreviewAtDocumentEnd,
		});
		current.surface.tabIndex = 0;
		current.surface.focus();

		try {
			if (!runtime) {
				throw new Error("windowed-trailing-removal-runtime-missing");
			}
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const source = current.canonical();
			const removed = "Line 160";
			const from = source.indexOf(removed);
			if (from < 0) throw new Error("windowed-trailing-removal-target-missing");
			// The last block ends the document, so it has no trailing newline.
			const to = source.length;
			const value = source.slice(0, from) + source.slice(to);
			const result = readyRuntime.applyCanonicalChange({
				change: {
					changes: { from, insert: "", to },
					selection: { direction: "none", end: from, start: from },
					value,
				},
				expected: {
					revision: 0,
					selection: { direction: "none", end: 0, start: 0 },
					value: source,
				},
			});
			expect(onFailure).not.toHaveBeenCalled();
			expect(result).toBe("handled");
			const preceding = "Line 159";
			// The projected caret sits on the surviving boundary the removal
			// left behind; the canonical write itself must carry the exact
			// source and the projected collapsed selection.
			const lastChange = current.documentChanges.mock.calls.at(-1)?.[0];
			if (!lastChange) {
				throw new Error("windowed-trailing-removal-change-missing");
			}
			expect(lastChange.value).toBe(value);
			expect(lastChange.selection.start).toBe(lastChange.selection.end);
			expect(
				lastChange.selection.start,
			).toBeGreaterThanOrEqual(value.indexOf(preceding));
			expect(
				lastChange.selection.start,
			).toBeLessThanOrEqual(value.indexOf(preceding) + preceding.length + 1);
			expect(onFailure).not.toHaveBeenCalled();
			// The accepted Preview for the removal must not tear the surface
			// down. The committed caret sits on the line terminator the removed
			// block left behind, which no editable block owns, so the nearest
			// mounted block owns the native caret instead.
			current.surface
				.querySelector('[data-easymde-visual-block-id="b160"]')
				?.remove();
			rerenderPreview(
				{
					blocks: current.editMap.blocks.slice(0, 160),
					coordinate: "line",
					signature: "windowed",
					version: 1,
				},
				{ revision: 2, signature: "windowed" },
			);
			expect(onFailure).not.toHaveBeenCalled();
			expect(onTransferFailure).not.toHaveBeenCalled();
			const caret = window.getSelection();
			expect(caret?.rangeCount).toBe(1);
			expect(caret?.isCollapsed).toBe(true);
			expect(current.surface.contains(caret?.anchorNode ?? null)).toBe(true);
		} finally {
			view.unmount();
		}
	});

	it("applies an accepted canonical change through the formal windowed Preview owner", () => {
		const current = fixture();
		const onMarkdownChange = vi.fn();
		const onPendingChange = vi.fn();
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "canonical-change-next");
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onMarkdownChange,
			onPendingChange,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			requestPreview,
		});
		try {
			if (!runtime)
				throw new Error("windowed-canonical-change-runtime-missing");
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const source = current.canonical();
			const nextValue = `>${source}`;
			expect(
				readyRuntime.applyCanonicalChange({
					change: {
						changes: { from: 0, insert: ">", to: 0 },
						selection: { direction: "none", end: 1, start: 1 },
						value: nextValue,
					},
					expected: {
						revision: 0,
						selection: { direction: "none", end: 0, start: 0 },
						value: source,
					},
				}),
			).toBe("handled");
			expect(current.canonical()).toBe(nextValue);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(onMarkdownChange).toHaveBeenCalledOnce();
			expect(onPendingChange).toHaveBeenCalledWith(true);
			expect(requestPreview).toHaveBeenCalledWith(nextValue);
			expect(onFailure).not.toHaveBeenCalled();
		} finally {
			view.unmount();
		}
	});

	it("keeps a committed canonical capability truthful when Preview scheduling fails", () => {
		const current = fixture();
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(() => {
			throw new Error("visual-editor-window-preview-schedule-failed");
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			onTransferFailure,
			requestPreviewAtDocumentEnd,
		});
		try {
			if (!runtime) {
				throw new Error("windowed-canonical-postcommit-runtime-missing");
			}
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			current.surface.tabIndex = 0;
			current.surface.focus();
			const source = current.canonical();
			const nextValue = `>${source}`;
			expect(
				readyRuntime.applyCanonicalChange({
					change: {
						changes: { from: 0, insert: ">", to: 0 },
						selection: { direction: "none", end: 1, start: 1 },
						value: nextValue,
					},
					expected: {
						revision: 0,
						selection: { direction: "none", end: 0, start: 0 },
						value: source,
					},
				}),
			).toBe("failed");
			expect(current.canonical()).toBe(nextValue);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-preview-schedule-failed",
			);
			expect(onTransferFailure).toHaveBeenCalledOnce();
		} finally {
			view.unmount();
		}
	});

	it("rejects a windowed canonical change after a foreign editable DOM mutation", () => {
		const current = fixture();
		const onFailure = vi.fn();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const { view } = renderWindowEditor(current, {
			onFailure,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		try {
			if (!runtime) throw new Error("windowed-dom-stale-runtime-missing");
			const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
			const paragraph = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b160"]',
			);
			if (!(paragraph?.firstChild instanceof Text)) {
				throw new Error("windowed-dom-stale-block-missing");
			}
			paragraph.firstChild.data = "foreign";
			const source = current.canonical();
			expect(
				readyRuntime.applyCanonicalChange({
					change: {
						changes: { from: 0, insert: ">", to: 0 },
						selection: { direction: "none", end: 1, start: 1 },
						value: `>${source}`,
					},
					expected: {
						revision: 0,
						selection: { direction: "none", end: 0, start: 0 },
						value: source,
					},
				}),
			).toBe("failed");
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-source-navigation-dom-stale",
			);
		} finally {
			view.unmount();
		}
	});

	it("latches an external canonical change and rejects Windowed writes until teardown", () => {
		const current = fixture();
		const onCanonicalDocumentChange = vi.fn();
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			onCanonicalDocumentChange,
			onFailure,
		});
		current.setCanonical(current.canonical().replace("Line 160", "External"));
		expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();

		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-stale-text-missing");
		placeCaret(text, text.length);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "insertText",
			data: "X",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		current.setCanonical("Later external");
		expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();
		view.unmount();
	});

	it.each(["~~~js", "```js", "~~~~~bash", "`````js"])(
		"keeps a windowed %s fence family in the canonical change",
		(fence) => {
			const current = fixture();
			const canonical = current.canonical().split("\n");
			canonical[160] = fence;
			current.setCanonical(canonical.join("\n"));
			const requestPreview = vi.fn(() => `${fence}-preview`);
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, {
				onFailure,
				requestPreview,
			});
			const paragraph = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b160"]',
			);
			const text = paragraph?.firstChild;
			if (!(text instanceof Text))
				throw new Error("windowed-fence-text-missing");
			text.data = fence;
			placeCaret(text, text.length);

			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			});
			current.surface.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
			expect(onFailure).not.toHaveBeenCalled();
			expect(requestPreview).not.toHaveBeenCalled();
			const family = fence.match(/^(`{3,}|~{3,})/)?.[1];
			if (!family) throw new Error("windowed-canonical-fence-family-missing");
			const canonicalFamily =
				"~" === family[0] ? "`".repeat(family.length) : family;
			const info = fence.slice(family.length);
			expect(current.canonical()).toContain(
				`${canonicalFamily}${info}\n\n${canonicalFamily}`,
			);
			view.unmount();
		},
	);

	it.each(["`````js linenos=true", "~~~~~js linenos=true"])(
		"restores the complete %s info string in a windowed code block",
		(sourceFence) => {
			const current = fixture({ lineOverrides: { 160: sourceFence } });
			const paragraph = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b160"]',
			);
			if (!paragraph) throw new Error("windowed-info-paragraph-missing");
			const pre = document.createElement("pre");
			pre.setAttribute("data-easymde-visual-block-id", "b160");
			const code = document.createElement("code");
			code.className = "language-rendered";
			code.textContent = "body";
			pre.append(code);
			paragraph.replaceWith(pre);

			const { view } = renderWindowEditor(current);
			const family = sourceFence.match(/^(`{3,}|~{3,})/)?.[1];
			expect(pre.getAttribute("data-easymde-visual-fence")).toBe(family);
			expect(pre.getAttribute("data-easymde-visual-fence-info")).toBe(
				"js linenos=true",
			);
			view.unmount();
		},
	);

	it("commits one middle-Block input without cloning or serializing the partial surface", () => {
		const current = fixture();
		const onFailure = vi.fn();
		const cloneSurface = vi.spyOn(current.surface, "cloneNode");
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={onFailure}
				onMarkdownChange={vi.fn()}
				onPendingChange={vi.fn()}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending={false}
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="ready"
				requestPreview={vi.fn(() => "next")}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest("next")}
				surface={current.surface}
			/>,
		);
		const text = current.surface.querySelector("p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-text-missing");
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "X",
				inputType: "insertText",
			}),
		);
		text.data += "X";
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertText",
			}),
		);

		const lines = current.canonical().split("\n");
		expect(lines[159]).toBe("Line 159");
		expect(lines[160]).toBe("Line 160X");
		expect(lines[161]).toBe("Line 161");
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(current.documentChanges).toHaveBeenCalledWith(
			expect.objectContaining({
				changes: {
					from:
						Array.from({ length: 160 }, (_, index) => `Line ${index}`).join(
							"\n",
						).length + 1,
					insert: "Line 160X\n",
					to:
						Array.from({ length: 161 }, (_, index) => `Line ${index}`).join(
							"\n",
						).length + 1,
				},
			}),
		);
		expect(cloneSurface).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it.each([
		{ inputType: "deleteContentBackward", targetRanges: "missing" },
		{ inputType: "deleteContentBackward", targetRanges: "empty" },
		{ inputType: "deleteContentForward", targetRanges: "missing" },
		{ inputType: "deleteContentForward", targetRanges: "empty" },
	] as const)(
		"maps repeated-space $inputType with $targetRanges target ranges from the post-delete caret",
		({ inputType, targetRanges }) => {
			const initialFence = "~~~\nA   B\n~~~";
			const expectedFence = "~~~\nA  B\n~~~";
			const onFailure = vi.fn();
			const requestPreview = vi.fn(() => "unexpected-code-deletion-preview");
			const { code, current, initialMarkdown, sourceStart, view } =
				renderCodeBodyEditor(initialFence, "A   B\n", {
					onFailure,
					requestPreview,
				});
			const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${expectedFence}${initialMarkdown.slice(
				sourceStart + initialFence.length,
			)}`;
			const sourceCaret = sourceStart + "~~~\n".length + 2;

			const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
				inputType,
				removedLength: 1,
				start: 2,
				targetRanges,
			});

			expect(beforeInput.defaultPrevented).toBe(false);
			expect(current.canonical()).toBe(expectedMarkdown);
			expect(current.documentSession.document.getValue()).toBe(
				expectedMarkdown,
			);
			expect(current.documentSession.document.getSelection()).toEqual({
				direction: "none",
				end: sourceCaret,
				start: sourceCaret,
			});
			expect(code.textContent).toBe("A  B\n");
			expectConnectedCodeCaret(code, 2);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(current.documentChanges).toHaveBeenCalledWith(
				expect.objectContaining({
					recordHistorySelection: true,
					selection: {
						direction: "none",
						end: sourceCaret,
						start: sourceCaret,
					},
				}),
			);
			expect(requestPreview).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		},
	);

	it("keeps a repeated-run caret connected inside highlighted code markup", () => {
		const initialFence = "~~~js\nA   B\n~~~";
		const changedFence = "~~~js\nA  B\n~~~";
		const onFailure = vi.fn();
		const { code, current, initialMarkdown, sourceStart, view } =
			renderCodeBodyEditor(initialFence, "A   B\n", {
				codeMarkup: '<span class="hljs-name">A   B\n</span>',
				onFailure,
			});
		const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${changedFence}${initialMarkdown.slice(
			sourceStart + initialFence.length,
		)}`;

		dispatchCodeBodyDeletion(current.surface, code, {
			inputType: "deleteContentBackward",
			removedLength: 1,
			start: 2,
			targetRanges: "empty",
		});

		expect(current.canonical()).toBe(expectedMarkdown);
		expect(code.textContent).toBe("A  B\n");
		expectConnectedCodeCaret(code, 2);
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("preserves the input selection when native deletion produces no DOM delta", () => {
		const initialFence = "~~~\nABCD\n~~~";
		const onFailure = vi.fn();
		const { code, current, initialMarkdown, sourceStart, view } =
			renderCodeBodyEditor(initialFence, "ABCD\n", { onFailure });
		const sourceCaret = sourceStart + "~~~\n".length + 2;

		const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
			inputType: "deleteContentBackward",
			removedLength: 0,
			start: 2,
			targetRanges: "missing",
		});

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: sourceCaret,
			start: sourceCaret,
		});
		expect(code.textContent).toBe("ABCD\n");
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("projects repeated multi-code-unit emoji deletion from the collapsed caret", () => {
		const initialFence = "~~~\n🙂🙂🙂\n~~~";
		const expectedFence = "~~~\n🙂🙂\n~~~";
		const onFailure = vi.fn();
		const { code, current, initialMarkdown, sourceStart, view } =
			renderCodeBodyEditor(initialFence, "🙂🙂🙂\n", { onFailure });
		const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${expectedFence}${initialMarkdown.slice(
			sourceStart + initialFence.length,
		)}`;
		const sourceCaret = sourceStart + "~~~\n".length + 2;

		const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
			inputType: "deleteContentBackward",
			removedLength: 2,
			start: 2,
			targetRanges: "missing",
		});

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(expectedMarkdown);
		expect(current.documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: sourceCaret,
			start: sourceCaret,
		});
		expect(code.textContent).toBe("🙂🙂\n");
		expectConnectedCodeCaret(code, 2);
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("keeps the terminal renderer LF outside an open code body deletion", () => {
		const initialFence = "~~~\nA";
		const failure = vi.fn();
		const { code, current, initialMarkdown, onFailure, sourceStart, view } =
			renderCodeBodyEditor(initialFence, "A\n", {
				onFailure: failure,
				sourceBlockCount: 161,
			});
		const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}~~~\n`;
		const sourceCaret = sourceStart + "~~~\n".length;

		const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
			inputType: "deleteContentBackward",
			removedLength: 1,
			start: 0,
			targetRanges: "empty",
		});

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(expectedMarkdown);
		expect(current.documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: sourceCaret,
			start: sourceCaret,
		});
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it.each([
		{
			body: "ABCD\n",
			name: "a wrong caret",
			postCaretOffset: 2,
			replacement: undefined,
			start: 1,
		},
		{
			body: "A  B\n",
			name: "text substitution",
			postCaretOffset: undefined,
			replacement: "x",
			start: 2,
		},
	])(
		"fails fast for $name during collapsed deletion",
		({ body, postCaretOffset, replacement, start }) => {
			const initialFence = `~~~\n${body}~~~`;
			const onFailure = vi.fn();
			const { code, current, initialMarkdown, view } = renderCodeBodyEditor(
				initialFence,
				body,
				{ onFailure },
			);

			const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
				inputType: "deleteContentForward",
				postCaretOffset,
				removedLength: 1,
				replacement,
				start,
				targetRanges: "empty",
			});

			expect(beforeInput.defaultPrevented).toBe(false);
			expect(current.canonical()).toBe(initialMarkdown);
			expect(
				current.surface.querySelector(
					`[data-easymde-visual-block-id="b160"] > code`,
				)?.textContent,
			).toBe(body);
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-code-body-selection-invalid",
			);
			expect(onFailure).toHaveBeenCalledOnce();
			view.unmount();
		},
	);

	it("rejects a cross-block forward target from a mid-body caret", () => {
		// A malformed Chromium target is a no-op ONLY at the body's terminal
		// caret. From a mid-body caret the same cross-block shape contradicts
		// the code-body owner and keeps the explicit stale rejection.
		const body = "ABCD\n";
		const initialFence = `~~~\n${body}~~~`;
		const onFailure = vi.fn();
		const { code, current, initialMarkdown, view } = renderCodeBodyEditor(
			initialFence,
			body,
			{ onFailure },
		);

		const heading = document.createElement("h3");
		heading.setAttribute("data-easymde-visual-block-id", "b161");
		heading.textContent = "Next";
		const pre = code.closest("pre");
		if (!(pre instanceof HTMLElement)) {
			throw new Error("windowed-midbody-pre-missing");
		}
		pre.after(heading);
		const text = code.firstChild;
		if (!(text instanceof Text)) {
			throw new Error("windowed-midbody-text-missing");
		}
		placeCaret(text, 2);
		const target = document.createRange();
		target.setStart(text, 2);
		target.setEnd(heading, 0);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentForward",
		});
		Object.defineProperty(beforeInput, "getTargetRanges", {
			value: () => [target],
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		// The mid-body contradiction must stay an explicit failure - never a
		// silent no-op and never a native mutation.
		expect(onFailure).toHaveBeenCalled();
		expect(current.canonical()).toBe(initialMarkdown);
		view.unmount();
	});

	it("consumes a terminal forward deletion whose target leaves the code body", () => {
		// The real Chromium shape captured on post-1018: the caret sits after
		// the body's last content - one stop before the body's own terminal
		// newline, which is its own trailing Text node - and the forward
		// target runs from that newline's start out to the next block's
		// element boundary. There is no in-body character to delete, so the
		// keystroke is a structural no-op, not stale state.
		const body = 'echo "gap-target"Q';
		const markup =
			'<span class="hljs-built_in">echo</span> '
			+ '<span class="hljs-string">"gap-target"Q</span>\n';
		const initialFence = `~~~bash\n${body}\n~~~`;
		const onFailure = vi.fn();
		const { code, current, initialMarkdown, view } = renderCodeBodyEditor(
			initialFence,
			`${body}\n`,
			{ codeMarkup: markup, onFailure },
		);

		const heading = document.createElement("h3");
		heading.setAttribute("data-easymde-visual-block-id", "b161");
		heading.textContent = "Next";
		const pre = code.closest("pre");
		if (!(pre instanceof HTMLElement)) {
			throw new Error("windowed-terminal-pre-missing");
		}
		pre.after(heading);
		const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		let walked = walker.nextNode();
		while (walked) {
			if (walked instanceof Text) textNodes.push(walked);
			walked = walker.nextNode();
		}
		const caretNode = textNodes[textNodes.length - 2];
		const newlineNode = textNodes[textNodes.length - 1];
		if (
			!caretNode
			|| !newlineNode
			|| "\n" !== newlineNode.data
			|| caretNode.data !== '"gap-target"Q'
		) {
			throw new Error("windowed-terminal-text-shape-missing");
		}
		placeCaret(caretNode, caretNode.length);
		const target = document.createRange();
		target.setStart(newlineNode, 0);
		target.setEnd(heading, 0);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentForward",
		});
		Object.defineProperty(beforeInput, "getTargetRanges", {
			value: () => [target],
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe(initialMarkdown);
		const selection = window.getSelection();
		const caretElement =
			selection?.anchorNode instanceof Element
				? selection.anchorNode
				: (selection?.anchorNode?.parentElement ?? null);
		expect(caretElement?.closest("pre > code")).toBe(code);
		expect(onFailure).not.toHaveBeenCalledWith(
			"visual-editor-code-body-selection-invalid",
		);
		view.unmount();
	});

	it("keeps a noncollapsed target range authoritative for code deletion", () => {
		const initialFence = "~~~\nABCD\n~~~";
		const expectedFence = "~~~\nAD\n~~~";
		const onFailure = vi.fn();
		const { code, current, initialMarkdown, sourceStart, view } =
			renderCodeBodyEditor(initialFence, "ABCD\n", { onFailure });
		const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${expectedFence}${initialMarkdown.slice(
			sourceStart + initialFence.length,
		)}`;
		const sourceCaret = sourceStart + "~~~\n".length + 1;

		const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
			inputType: "deleteContentForward",
			removedLength: 2,
			start: 1,
			targetRangeEnd: 3,
			targetRangeStart: 1,
			targetRanges: "explicit",
		});

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(expectedMarkdown);
		expect(current.documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: sourceCaret,
			start: sourceCaret,
		});
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("records collapsed repeated-space deletion selections in real Undo and Redo history", () => {
		const blockIndex = 160;
		const initialFence = "~~~\nA   B\n~~~";
		const expectedFence = "~~~\nA  B\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>A   B\n</code></pre>`,
			},
			mounted: [blockIndex],
		});
		const initialMarkdown = current.canonical();
		const initialStart = initialMarkdown.indexOf(initialFence);
		const expectedMarkdown =
			initialMarkdown.slice(0, initialStart) +
			expectedFence +
			initialMarkdown.slice(initialStart + initialFence.length);
		const beforeCaret = initialStart + "~~~\n".length + 3;
		const afterCaret = initialStart + "~~~\n".length + 2;
		const submissionField = document.createElement("textarea");
		submissionField.value = initialMarkdown;
		submissionField.defaultValue = initialMarkdown;
		submissionField.setSelectionRange(beforeCaret, beforeCaret);
		const container = document.createElement("div");
		document.body.append(container, submissionField);
		const codeMirrorDocument = createCodeMirrorDocumentSession({
			container,
			label: "Markdown source",
			submissionField,
		});
		const documentSession = createEditorDocumentSession(
			codeMirrorDocument,
			createNativeTitleSession(null),
		);
		documentSession.registerSubmissionState({
			appleFont: "system",
			codeTheme: "dark",
			codeThemeExplicit: false,
			customCssId: "",
			customFont: "none",
			markdownTheme: "default",
			serifFont: "off",
			windowsFont: "system",
		});
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			documentSession,
			onFailure,
		});
		current.surface.tabIndex = 0;
		current.surface.focus();
		const code = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"] > code`,
		);
		if (!(code instanceof HTMLElement)) {
			throw new Error("windowed-history-repeated-space-code-missing");
		}

		dispatchCodeBodyDeletion(current.surface, code, {
			inputType: "deleteContentBackward",
			removedLength: 1,
			start: 2,
			targetRanges: "missing",
		});
		expect(documentSession.document.getValue()).toBe(expectedMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: afterCaret,
			start: afterCaret,
		});
		expectConnectedCodeCaret(code, 2);
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();

		expect(documentSession.document.undo()).toBe(true);
		expect(documentSession.document.getValue()).toBe(initialMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: beforeCaret,
			start: beforeCaret,
		});
		expect(documentSession.document.redo()).toBe(true);
		expect(documentSession.document.getValue()).toBe(expectedMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: afterCaret,
			start: afterCaret,
		});
		documentSession.document.destroy();
		container.remove();
		submissionField.remove();
	});

	it("keeps repeated Backspace edits in one mounted Block exact", () => {
		const current = fixture();
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={vi.fn()}
				onMarkdownChange={vi.fn()}
				onPendingChange={vi.fn()}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending={false}
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="ready"
				requestPreview={vi.fn(() => "next")}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest("next")}
				surface={current.surface}
			/>,
		);
		const text = current.surface.querySelector("p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-text-missing");
		const expectedLines = ["Line 16", "Line 1", "Line", "Line"];
		for (let index = 0; index < 4; index += 1) {
			placeCaret(text, text.length);
			current.surface.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			text.data = text.data.slice(0, -1);
			placeCaret(text, text.length);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "deleteContentBackward",
				}),
			);
			expect(current.canonical().split("\n")[160]).toBe(expectedLines[index]);
		}

		expect(current.canonical().split("\n")[160]).toBe("Line");
		expect(current.documentChanges).toHaveBeenCalledTimes(3);
		view.unmount();
	});

	it("commits pasted Markdown after returning from the paste event", async () => {
		const current = fixture();
		const requestPreview = vi.fn(() => "paste-signature");
		const onPendingChange = vi.fn();
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={vi.fn()}
				onMarkdownChange={vi.fn()}
				onPendingChange={onPendingChange}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending={false}
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="ready"
				requestPreview={requestPreview}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(
					requestPreview,
				)}
				surface={current.surface}
			/>,
		);
		const text = current.surface.querySelector("p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-text-missing");
		placeCaret(text, "Line ".length);
		const paste = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(paste, "clipboardData", {
			value: { files: [], getData: () => "**bold**", items: [] },
		});
		current.surface.dispatchEvent(paste);

		expect(paste.defaultPrevented).toBe(true);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(requestPreview).not.toHaveBeenCalled();
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		});

		expect(current.canonical().split("\n")[160]).toBe("Line **bold**160");
		expect(requestPreview).toHaveBeenCalledOnce();
		expect(current.surface.querySelector("p")?.textContent).toBe("Line 160");
		expect(onPendingChange).toHaveBeenCalledWith(true);
		view.unmount();
	});

	it("commits a root-boundary input after the document-end Block is pinned", () => {
		vi.useFakeTimers();
		try {
			const current = fixture({ mounted: [160, 319] });
			const requestPreview = vi.fn(() => "root-boundary");
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, {
				onFailure,
				requestPreview,
			});
			expect(
				current.surface.querySelector("[data-easymde-preview-window-spacer]"),
			).not.toBeNull();
			expect(
				current.surface.lastElementChild?.getAttribute(
					"data-easymde-visual-block-id",
				),
			).toBe("b319");
			const range = document.createRange();
			range.setStart(current.surface, current.surface.childNodes.length);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);

			const keyDown = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: " ",
			});
			current.surface.dispatchEvent(keyDown);
			expect(keyDown.defaultPrevented).toBe(false);
			expect(onFailure).not.toHaveBeenCalled();

			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: " continuation",
				inputType: "insertText",
			});
			current.surface.dispatchEvent(beforeInput);
			const text = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b319"]',
			)?.firstChild;
			if (!(text instanceof Text))
				throw new Error("windowed-root-boundary-text-missing");
			text.data += " continuation";
			const afterInput = document.createRange();
			afterInput.setStart(text, text.length);
			afterInput.collapse(true);
			selection?.removeAllRanges();
			selection?.addRange(afterInput);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: " continuation",
					inputType: "insertText",
				}),
			);
			act(() => {
				vi.advanceTimersByTime(80);
			});

			expect(beforeInput.defaultPrevented).toBe(false);
			expect(current.canonical()).toBe(
				`${Array.from({ length: 320 }, (_, index) => `Line ${index}`).join(
					"\n",
				)} continuation`,
			);
			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects a root-end input while the document-end Block is unmounted", () => {
		const current = fixture();
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, { onFailure });
		const range = document.createRange();
		range.setStart(current.surface, current.surface.childNodes.length);
		range.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: " misplaced",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(current.canonical()).not.toContain("misplaced");
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-selection-map-failed",
		);
		view.unmount();
	});

	it("rejects a destructive selection that crosses an unmounted spacer", () => {
		const current = fixture();
		current.surface.insertAdjacentHTML(
			"beforeend",
			'<p data-easymde-visual-block-id="b161">Line 161</p>',
		);
		const onFailure = vi.fn();
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={onFailure}
				onMarkdownChange={vi.fn()}
				onPendingChange={vi.fn()}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending={false}
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="ready"
				requestPreview={vi.fn(() => "next")}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest("next")}
				surface={current.surface}
			/>,
		);
		const first = current.surface.querySelector(
			'[data-easymde-visual-block-id="b160"]',
		)?.firstChild;
		const second = current.surface.querySelector(
			'[data-easymde-visual-block-id="b161"]',
		)?.firstChild;
		if (!(first instanceof Text) || !(second instanceof Text)) {
			throw new Error("windowed-selection-text-missing");
		}
		window.getSelection()?.setBaseAndExtent(first, 0, second, second.length);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-selection-invalid",
		);
		view.unmount();
	});

	it("owns Ctrl+A Backspace as a canonical full-document deletion", () => {
		const current = fixture();
		const original = current.canonical();
		const onFailure = vi.fn();
		const onTransferFailure = vi.fn();
		const requestPreview = vi.fn(() => "empty-document-preview");
		const { view } = renderWindowEditor(current, {
			onFailure,
			onTransferFailure,
			requestPreview,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();

		const selectAll = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
			key: "a",
		});
		current.surface.dispatchEvent(selectAll);
		expect(selectAll.defaultPrevented).toBe(true);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(requestPreview).not.toHaveBeenCalled();

		const backspace = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "Backspace",
		});
		current.surface.dispatchEvent(backspace);
		expect(backspace.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(original);
		expect(onFailure).not.toHaveBeenCalled();

		const deleteAll = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(deleteAll);

		expect(deleteAll.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe("");
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(current.documentChanges.mock.lastCall?.[0]).toEqual({
			changes: {
				from: 0,
				insert: "",
				to: expect.any(Number),
			},
			deferNativeBridge: false,
			recordHistorySelection: true,
			selection: {
				direction: "none",
				end: 0,
				start: 0,
			},
			value: "",
		});
		expect(requestPreview).toHaveBeenCalledWith("");
		expect(onFailure).not.toHaveBeenCalled();
		expect(onTransferFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("does not delete unmounted source on a whole-surface cut", () => {
		const current = fixture();
		const original = current.canonical();
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "unexpected-cut-preview");
		const { view } = renderWindowEditor(current, { onFailure, requestPreview });
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const selectAll = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
			key: "a",
		});
		current.surface.dispatchEvent(selectAll);
		expect(selectAll.defaultPrevented).toBe(true);

		const cut = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteByCut",
		});
		current.surface.dispatchEvent(cut);

		expect(cut.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe(original);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-selection-invalid",
		);
		view.unmount();
	});

	it("clears canonical source when the root includes a generated read-only block", () => {
		const generatedSource = "Before\n\n```mermaid\nA-->B\n```\n\nAfter";
		const current = fixture({
			blockOverrides: { 160: generatedSource },
			markupOverrides: {
				160:
					'<p data-easymde-visual-block-id="b160">' +
					'<span class="easymde-mermaid" contenteditable="false">Rendered</span>' +
					"</p>",
			},
			mounted: [160],
			nonEditable: [160],
		});
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "empty-rich-document-preview");
		const { view } = renderWindowEditor(current, { onFailure, requestPreview });
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key: "a",
			}),
		);
		const deleteAll = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(deleteAll);

		expect(deleteAll.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe("");
		expect(requestPreview).toHaveBeenCalledWith("");
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("leaves a composing full-range deletion to the IME owner", () => {
		const current = fixture();
		const original = current.canonical();
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, { onFailure });
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const paragraph = current.surface.querySelector("p");
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-composition-text-missing");
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", {
				bubbles: true,
			}),
		);
		const range = document.createRange();
		range.selectNodeContents(current.surface);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
			isComposing: true,
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(false);
		expect(current.canonical()).toBe(original);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("does not let a stale Ctrl+A selection clear a later collapsed deletion", () => {
		const current = fixture();
		const original = current.canonical();
		const { view } = renderWindowEditor(current);
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key: "a",
			}),
		);
		const paragraph = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text))
			throw new Error("windowed-stale-selection-text-missing");
		placeCaret(text, text.length);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		text.deleteData(text.length - 1, 1);
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentBackward",
			}),
		);

		expect(current.canonical()).not.toBe("");
		expect(current.canonical()).toBe(original.replace("Line 160", "Line 16"));
		expect(current.documentChanges).toHaveBeenCalledOnce();
		view.unmount();
	});

	it("clears a root selection spanning a mounted code block", () => {
		const requestPreview = vi.fn(() => "empty-code-document-preview");
		const { current, view } = renderCodeBodyEditor(
			'~~~json\n{"value":1}\n~~~',
			'{"value":1}\n',
			{ requestPreview },
		);
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const code = current.surface.querySelector<HTMLElement>("pre > code");
		const codeText = code?.firstChild;
		if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
			throw new Error("windowed-code-anchor-selection-missing");
		}
		placeCaret(codeText, codeText.length);
		current.surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key: "a",
			}),
		);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(requestPreview).not.toHaveBeenCalled();

		const deleteAll = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(deleteAll);

		expect(deleteAll.defaultPrevented).toBe(true);
		expect(current.canonical()).toBe("");
		expect(requestPreview).toHaveBeenCalledWith("");
		view.unmount();
	});

	it("keeps a selected mapped code block local to code", () => {
		const onFailure = vi.fn();
		const { code, current, view } = renderCodeBodyEditor(
			'~~~json\n{"value":1}\n~~~',
			'{"value":1}\n',
			{ onFailure },
		);
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const selectedCode = document.createRange();
		selectedCode.selectNodeContents(code);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(selectedCode);

		const deleteBody = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(deleteBody);
		expect(deleteBody.defaultPrevented).toBe(false);
		code.replaceChildren(document.createTextNode(""));
		placeCaret(code.firstChild as Text, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentBackward",
			}),
		);

		expect(current.canonical()).not.toBe("");
		expect(current.canonical()).toContain("~~~json");
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("merges a mounted adjacent Block for backward deletion at the block start", () => {
		const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "backward-boundary");
		const { view } = renderWindowEditor(current, { onFailure, requestPreview });
		const previous = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b159"]',
		);
		const currentBlock = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const currentText = currentBlock?.firstChild;
		if (
			!(previous instanceof HTMLElement) ||
			!(currentBlock instanceof HTMLElement) ||
			!(currentText instanceof Text)
		) {
			throw new Error("windowed-adjacent-block-missing");
		}
		placeCaret(currentText, 0);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(false);
		mergeMountedBlocks(previous, currentBlock, "Line 159".length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentBackward",
			}),
		);

		expect(
			current.canonical().split("\n").filter(Boolean).slice(158, 162),
		).toEqual(["Line 158", "Line 159Line 160", "Line 161", "Line 162"]);
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(requestPreview).toHaveBeenCalledWith(current.canonical());
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("merges a mounted adjacent Block for forward deletion at the block end", () => {
		const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "forward-boundary");
		const { view } = renderWindowEditor(current, { onFailure, requestPreview });
		const previous = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b159"]',
		);
		const next = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const previousText = previous?.firstChild;
		if (
			!(previous instanceof HTMLElement) ||
			!(next instanceof HTMLElement) ||
			!(previousText instanceof Text)
		) {
			throw new Error("windowed-adjacent-block-missing");
		}
		placeCaret(previousText, previousText.length);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentForward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(false);
		mergeMountedBlocks(previous, next, "Line 159".length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteContentForward",
			}),
		);

		expect(
			current.canonical().split("\n").filter(Boolean).slice(158, 162),
		).toEqual(["Line 158", "Line 159Line 160", "Line 161", "Line 162"]);
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(requestPreview).toHaveBeenCalledWith(current.canonical());
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it.each([
		{
			inputType: "deleteWordBackward",
			name: "backward word deletion at the block start",
		},
		{
			inputType: "deleteWordForward",
			name: "forward word deletion at the block end",
		},
	])(
		"merges adjacent Blocks for $name with exact canonical bytes",
		({ inputType }) => {
			const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
			const original = current.canonical();
			const sourceStart = original.indexOf("Line 159");
			const sourceEnd = sourceStart + "Line 159\n\nLine 160\n".length;
			const expected =
				original.slice(0, sourceStart) +
				"Line 159Line 160\n" +
				original.slice(sourceEnd);
			const onFailure = vi.fn();
			const requestPreview = vi.fn(() => "word-delete");
			const { view } = renderWindowEditor(current, {
				onFailure,
				requestPreview,
			});
			const previous = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b159"]',
			);
			const next = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b160"]',
			);
			const previousText = previous?.firstChild;
			const nextText = next?.firstChild;
			if (
				!(previous instanceof HTMLElement) ||
				!(next instanceof HTMLElement) ||
				!(previousText instanceof Text) ||
				!(nextText instanceof Text)
			)
				throw new Error("windowed-word-delete-block-missing");

			if ("deleteWordBackward" === inputType) {
				placeCaret(nextText, 0);
			} else {
				placeCaret(previousText, previousText.length);
			}
			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType,
			});
			current.surface.dispatchEvent(beforeInput);
			expect(beforeInput.defaultPrevented).toBe(false);

			mergeMountedBlocks(previous, next, "Line 159".length);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType,
				}),
			);

			const lines = current.canonical().split("\n");
			expect(lines[318]).toBe("Line 159Line 160");
			expect(current.canonical()).toBe(expected);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(current.documentChanges).toHaveBeenCalledWith({
				changes: {
					from: sourceStart,
					insert: "Line 159Line 160\n",
					to: sourceEnd,
				},
				deferNativeBridge: false,
				recordHistorySelection: true,
				selection: {
					direction: "none",
					end: sourceStart + "Line 159".length,
					start: sourceStart + "Line 159".length,
				},
				value: expected,
			});
			expect(requestPreview).toHaveBeenCalledOnce();
			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		},
	);

	it("rejects a protected-region mutation discovered during Windowed commit", () => {
		const blockIndex = 160;
		const mermaidSource = "flowchart TD\nA-->B";
		const protectedMarkdown = `Before\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\`\n\nAfter`;
		const current = fixture({
			blockOverrides: { [blockIndex]: protectedMarkdown },
			markupOverrides: {
				[blockIndex]: `<p data-easymde-visual-block-id="b${blockIndex}"><span>Before</span><span class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD\nA--&gt;B">Protected</span><span>After</span></p>`,
			},
			mounted: [blockIndex],
		});
		const original = current.canonical();
		const block = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(block instanceof HTMLElement))
			throw new Error("windowed-commit-block-missing");
		const protectedNode = block.children[1];
		const after = block.children[2]?.firstChild;
		if (!(protectedNode instanceof HTMLElement) || !(after instanceof Text)) {
			throw new Error("windowed-commit-protected-node-missing");
		}
		protectedNode.setAttribute("contenteditable", "false");
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, { onFailure });
		placeCaret(after, after.length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "insertText",
			}),
		);
		after.data += "!";
		protectedNode.textContent = "Tampered";
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(original);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-read-only-region-mutated",
		);
		expect(onFailure).toHaveBeenCalledOnce();
		view.unmount();
	});

	it("round-trips a cross-block word deletion through Windowed Undo and Redo", () => {
		const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
		const original = current.canonical();
		const sourceStart = original.indexOf("Line 159");
		const sourceEnd = sourceStart + "Line 159\n\nLine 160\n".length;
		const deleted =
			original.slice(0, sourceStart) +
			"Line 159Line 160\n" +
			original.slice(sourceEnd);
		const undo = vi.fn(() => {
			current.setCanonical(original);
			return true;
		});
		const redo = vi.fn(() => {
			current.setCanonical(deleted);
			return true;
		});
		Object.assign(current.documentSession.document, { redo, undo });
		const requestPreview = vi.fn(() => "word-history");
		const { view } = renderWindowEditor(current, { requestPreview });
		const settledEditMap: PreviewEditMap = {
			blocks: [
				{
					editable: true,
					endLine: 319,
					id: "b159",
					startLine: 318,
				},
			],
			coordinate: "line",
			signature: "word-history",
			version: 1,
		};
		const previous = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b159"]',
		);
		const next = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const previousText = previous?.firstChild;
		const nextText = next?.firstChild;
		if (
			!(previous instanceof HTMLElement) ||
			!(next instanceof HTMLElement) ||
			!(previousText instanceof Text) ||
			!(nextText instanceof Text)
		)
			throw new Error("windowed-history-block-missing");
		placeCaret(nextText, 0);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteWordBackward",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		mergeMountedBlocks(previous, next, previousText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "deleteWordBackward",
			}),
		);
		expect(current.canonical()).toBe(deleted);
		expect(current.documentChanges).toHaveBeenCalledOnce();

		const settlePreview = (revision: number) => {
			act(() => {
				view.rerender(
					<WindowedImmersiveVisualEditor
						documentSession={current.documentSession}
						editMap={settledEditMap}
						imagePasteUploadEnabled={false}
						imageUploadEnabled={false}
						onCanonicalDocumentChange={vi.fn()}
						onDiagnostic={vi.fn()}
						onDispose={vi.fn()}
						onFailure={vi.fn()}
						onMarkdownChange={vi.fn()}
						onPendingChange={vi.fn()}
						onReady={vi.fn()}
						prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
						retainCompositionSurface={testRetainCompositionSurface}
						onTransferFailure={vi.fn()}
						pending={false}
						previewSnapshot={{ revision, signature: "word-history" }}
						previewStatus="ready"
						requestPreview={requestPreview}
						requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(
							requestPreview,
						)}
						surface={current.surface}
					/>,
				);
			});
		};
		settlePreview(2);

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(historyUndo.defaultPrevented).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(original);
		settlePreview(3);

		const historyRedo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyRedo",
		});
		current.surface.dispatchEvent(historyRedo);
		expect(historyRedo.defaultPrevented).toBe(true);
		expect(redo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(deleted);
		expect(requestPreview).toHaveBeenCalledTimes(3);
		view.unmount();
	});

	it("restores an absolute history selection inside an ordinary b160 paragraph", () => {
		const blockIndex = 160;
		const current = fixture({
			lineOverrides: { [blockIndex]: "Line 160 edited" },
			mounted: [blockIndex],
		});
		const editedMarkdown = current.canonical();
		const restoredMarkdown = editedMarkdown.replace(
			"Line 160 edited",
			"Line 160",
		);
		const sourceStart = restoredMarkdown.indexOf("Line 160");
		if (sourceStart < 0)
			throw new Error("windowed-paragraph-history-source-missing");
		let historySelection: DocumentSelection = {
			direction: "none",
			end: sourceStart + 3,
			start: sourceStart + 3,
		};
		const undo = vi.fn(() => {
			current.setCanonical(restoredMarkdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const signature = "paragraph-history";
		const requestPreview = vi.fn(() => signature);
		const { onDiagnostic, onFailure, rerenderPreview, view } =
			renderWindowEditor(current, { requestPreview });
		current.surface.focus();

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(historyUndo.defaultPrevented).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(restoredMarkdown);
		expect(document.activeElement).toBe(current.surface);
		const adoptedParagraph = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(adoptedParagraph instanceof HTMLElement)) {
			throw new Error("windowed-paragraph-history-adoption-missing");
		}
		adoptedParagraph.textContent = "Line 160";
		historySelection = {
			direction: "none",
			end: sourceStart + 3,
			start: sourceStart + 3,
		};
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(onDiagnostic).not.toHaveBeenCalled();
		const paragraph = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const text = paragraph?.firstChild;
		if (!(text instanceof Text)) {
			throw new Error("windowed-paragraph-history-restored-text-missing");
		}
		expect(window.getSelection()?.anchorNode).toBe(text);
		expect(window.getSelection()?.anchorOffset).toBe(3);
		expect(requestPreview).toHaveBeenCalledWith(restoredMarkdown);
		view.unmount();
	});

	it("restores a history selection across adjacent heading blocks", () => {
		const current = fixture({
			blockOverrides: {
				4: "# 一级标题 Heading 1",
				5: "## 二级标题 Heading 2",
			},
			markupOverrides: {
				4: '<h1 data-easymde-visual-block-id="b4">一级标题 Heading 1</h1>',
				5: '<h2 data-easymde-visual-block-id="b5">二级标题 Heading 2</h2>',
			},
			mounted: [4, 5],
			sourceBlockCount: 6,
		});
		const restoredMarkdown = current.canonical();
		const start = restoredMarkdown.indexOf("一级标题");
		const end = restoredMarkdown.indexOf("二级标题") + "二级标题 Heading 2".length;
		if (start < 0 || end <= start) {
			throw new Error("windowed-heading-history-source-missing");
		}
		let historySelection: DocumentSelection = {
			direction: "forward",
			end,
			start: start,
		};
		const undo = vi.fn(() => {
			current.setCanonical(restoredMarkdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const signature = "heading-history";
		const requestPreview = vi.fn(() => signature);
		const { onDiagnostic, onFailure, rerenderPreview, view } = renderWindowEditor(current, {
			requestPreview,
		});
		current.surface.focus();

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(historyUndo.defaultPrevented).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		historySelection = { direction: "forward", end, start };
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(window.getSelection()?.isCollapsed).toBe(false);
		expect(window.getSelection()?.toString()).toContain("一级标题 Heading 1");
		expect(window.getSelection()?.toString()).toContain("二级标题 Heading 2");
		view.unmount();
	});

	it("restores a plain selection inside a large accepted list without boundary-budget failure", () => {
		const blockIndex = 160;
		const entries = Array.from({ length: 96 }, (_, index) =>
			36 === index ? "前端开发" : `项目条目 ${index}`,
		);
		const editedList = entries
			.map((entry, index) => `- ${36 === index ? `**${entry}**` : entry}`)
			.join("\n");
		const listMarkup = (bold: boolean): string =>
			`<ul data-easymde-visual-block-id="b${blockIndex}">${entries
				.map((entry, index) => `<li>${bold && 36 === index ? `<strong>${entry}</strong>` : entry}</li>`)
				.join("")}</ul>`;
		const current = fixture({
			blockOverrides: { [blockIndex]: editedList },
			markupOverrides: { [blockIndex]: listMarkup(true) },
			mounted: [blockIndex],
		});
		const editedMarkdown = current.canonical();
		const restoredMarkdown = editedMarkdown.replace("**前端开发**", "前端开发");
		const sourceStart = restoredMarkdown.indexOf("前端开发");
		if (sourceStart < 0) throw new Error("windowed-large-list-history-source-missing");
		let historySelection: DocumentSelection = {
			direction: "forward",
			end: sourceStart + "前端开发".length,
			start: sourceStart,
		};
		const undo = vi.fn(() => {
			current.setCanonical(restoredMarkdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const signature = "large-list-history";
		const requestPreview = vi.fn(() => signature);
		const { onDiagnostic, onFailure, rerenderPreview, view } = renderWindowEditor(current, {
			onFailure: vi.fn(),
			requestPreview,
		});
		current.surface.focus();

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(historyUndo.defaultPrevented).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		const adoptedList = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(adoptedList instanceof HTMLElement)) {
			throw new Error("windowed-large-list-history-adoption-missing");
		}
		adoptedList.innerHTML = entries.map((entry) => `<li>${entry}</li>`).join("");
		historySelection = {
			direction: "forward",
			end: sourceStart + "前端开发".length,
			start: sourceStart,
		};
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(onDiagnostic).not.toHaveBeenCalled();
		const selection = window.getSelection();
		expect(selection?.toString()).toBe("前端开发");
		expect(selection?.isCollapsed).toBe(false);
		view.unmount();
	});

	it.each([true, false])("pins a focused non-EOF native Redo caret at the unmounted HR source boundary (focused=%s)", (focused) => {
		const blocks = Array.from({ length: 100 }, (_, index) => `Line ${index}`);
		const prefix = blocks.slice(0, 68).join("\n\n") + "\n\n";
		blocks[68] = "P".repeat(3523 - prefix.length) + "R".repeat(170);
		blocks[69] = "---";
		const unpadded = blocks.join("\n\n");
		blocks[99] += "Z".repeat(36979 - unpadded.length);
		const original = blocks.join("\n\n");
		const redone = original.slice(0, 3523) + original.slice(3693);
		expect(original.length).toBe(36979);
		expect(redone.length).toBe(36809);
		expect(redone.slice(3525, 3529)).toBe("---\n");
		const current = fixture({
			blockOverrides: Object.fromEntries(blocks.map((block, index) => [index, block])),
			mounted: Array.from({ length: 41 }, (_, index) => index),
			paragraphBlocks: true,
			sourceBlockCount: blocks.length,
		});
		const container = document.createElement("div");
		const submissionField = document.createElement("textarea");
		submissionField.value = original;
		document.body.append(container, submissionField);
		const history = createCodeMirrorDocumentSession({ container, label: "Markdown source", submissionField });
		history.setVisualEditingActive(true);
		history.applyTextChange({
			changes: { from: 3523, to: 3693, insert: "" },
			historySelectionBefore: { direction: "forward", start: 3523, end: 3693 },
			recordHistorySelection: true,
			selection: { direction: "none", start: 3525, end: 3525 },
			value: redone,
		});
		expect(history.undo()).toBe(true);
		const release = vi.fn();
		const signature = "offscreen-hr-native-redo";
		const requestPreviewAtDocumentEnd = vi.fn(() => ({ signature, release }));
		const requestPreview = vi.fn(() => signature);
		const { view, rerenderPreview, onDiagnostic, onFailure } = renderWindowEditor(current, {
			documentSession: { document: history } as unknown as EditorDocumentSession,
			requestPreview,
			requestPreviewAtDocumentEnd,
		});
		const outside = document.createElement("input");
		document.body.append(outside);
		try {
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			if (focused) current.surface.focus();
			else outside.focus();
			expect(current.surface.querySelector('[data-easymde-visual-block-id="b69"]')).toBeNull();
			current.surface.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyRedo" }));
			expect(history.getValue()).toBe(redone);
			expect(history.getSelection()).toEqual({ direction: "none", start: 3525, end: 3525 });
			expect(history.getRevision?.()).toBe(3);
			expect(history.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });
			if (focused) {
				expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(redone, { direction: "none", start: 3525, end: 3525 });
				expect(requestPreview).not.toHaveBeenCalled();
				current.surface.innerHTML = '<div data-easymde-preview-window-spacer="1"></div>'
					+ `<p data-easymde-visual-block-id="b68">${blocks[68]?.slice(0, -170)}</p>`
					+ '<hr data-easymde-visual-block-id="b69"><p data-easymde-visual-block-id="b70">Line 70</p>'
					+ '<div data-easymde-preview-window-spacer="1"></div>';
			} else {
				expect(requestPreviewAtDocumentEnd).not.toHaveBeenCalled();
				expect(requestPreview).toHaveBeenCalledWith(redone);
			}
			rerenderPreview({ ...current.editMap, signature }, { revision: 2, signature });
			expect(onFailure).not.toHaveBeenCalled();
			expect(onDiagnostic).not.toHaveBeenCalled();
			expect(history.getSelection()).toEqual({ direction: "none", start: 3525, end: 3525 });
			expect(history.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });
			expect(document.activeElement).toBe(focused ? current.surface : outside);
			if (focused) {
				const hr = current.surface.querySelector("hr");
				expect(hr?.isConnected).toBe(true);
				const native = window.getSelection();
				expect(native?.isCollapsed).toBe(true);
				expect(native?.anchorNode).toBe(current.surface);
				expect(current.surface.childNodes[native?.anchorOffset ?? -1]).toBe(hr);
				expect(release).toHaveBeenCalledOnce();
			} else expect(release).not.toHaveBeenCalled();
		} finally {
			view.unmount();
			history.destroy();
			container.remove();
			submissionField.remove();
			outside.remove();
		}
	});

	it("pins every focused Windowed history selection through the Preview owner", () => {
		const blockIndex = 160;
		const entries = Array.from({ length: 96 }, (_, index) =>
			36 === index ? "前端开发" : `项目条目 ${index}`,
		);
		const editedList = entries
			.map((entry, index) => `- ${36 === index ? `**${entry}**` : entry}`)
			.join("\n");
		const current = fixture({
			blockOverrides: { [blockIndex]: editedList },
			markupOverrides: {
				[blockIndex]: `<ul data-easymde-visual-block-id="b${blockIndex}">${entries
					.map((entry, index) =>
						`<li>${36 === index ? `<strong>${entry}</strong>` : entry}</li>`,
					)
					.join("")}</ul>`,
			},
			mounted: [blockIndex],
		});
		const editedMarkdown = current.canonical();
		const restoredMarkdown = editedMarkdown.replace("**前端开发**", "前端开发");
		const undoSelection: DocumentSelection = {
			direction: "forward",
			end: restoredMarkdown.indexOf("前端开发") + "前端开发".length,
			start: restoredMarkdown.indexOf("前端开发"),
		};
		const redoSelection: DocumentSelection = {
			direction: "forward",
			end: editedMarkdown.indexOf("**前端开发**") + "**前端开发**".length,
			start: editedMarkdown.indexOf("**前端开发**"),
		};
		let historySelection = redoSelection;
		const undo = vi.fn(() => {
			historySelection = undoSelection;
			current.setCanonical(restoredMarkdown);
			return true;
		});
		const redo = vi.fn(() => {
			historySelection = redoSelection;
			current.setCanonical(editedMarkdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			redo,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const signature = "windowed-history-pin";
		const requestPreviewAtDocumentEnd = vi.fn(
			(
				markdown: string,
				sourceSelection?: Readonly<{ end: number; start: number }>,
			) => ({
				release: vi.fn(),
				signature,
				...(sourceSelection ? { sourceSelection, markdown } : { markdown }),
			}),
		);
		const { rerenderPreview, view } = renderWindowEditor(current, {
			requestPreviewAtDocumentEnd,
		});

		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyUndo",
			}),
		);
		expect(undo).toHaveBeenCalledOnce();
		expect(requestPreviewAtDocumentEnd).toHaveBeenNthCalledWith(
			1,
			restoredMarkdown,
			undoSelection,
		);
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyRedo",
			}),
		);
		expect(redo).toHaveBeenCalledOnce();
		expect(requestPreviewAtDocumentEnd).toHaveBeenNthCalledWith(
			2,
			editedMarkdown,
			redoSelection,
		);
		view.unmount();
	});

	it("does not restore a plain match without source-range provenance", () => {
		const markdown = "hidden\n\n[hidden]: https://example.test\n";
		const current = fixture({
			blockOverrides: { 0: markdown },
			markupOverrides: {
				0: '<p data-easymde-visual-block-id="b0">hidden</p>',
			},
			mounted: [0],
			sourceBlockCount: 1,
		});
		const sourceStart = markdown.indexOf("[hidden]") + 1;
		const historySelection: DocumentSelection = {
			direction: "forward",
			end: sourceStart + "hidden".length,
			start: sourceStart,
		};
		const undo = vi.fn(() => {
			current.setCanonical(markdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const signature = "plain-provenance-history";
		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(
			(
				_previewMarkdown: string,
				_sourceSelection?: Readonly<{ end: number; start: number }>,
			) => ({
				release: vi.fn(),
				signature,
			}),
		);
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onDiagnostic,
			onFailure,
			requestPreviewAtDocumentEnd,
		});

		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyUndo",
			}),
		);
		expect(undo).toHaveBeenCalledOnce();
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-selection-map-failed",
		);
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(window.getSelection()?.toString()).not.toBe("hidden");
		view.unmount();
	});

	it("restores backward history selection at a shared adjacent-block boundary", () => {
		const current = fixture({ mounted: [159, 160] });
		const markdown = current.canonical();
		const boundary = markdown.indexOf("Line 160");
		if (boundary < 0)
			throw new Error("windowed-history-boundary-source-missing");
		let historySelection: DocumentSelection = {
			direction: "backward",
			end: boundary,
			start: boundary - 2,
		};
		const undo = vi.fn(() => {
			current.setCanonical(markdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const signature = "boundary-history";
		const requestPreview = vi.fn(() => signature);
		const { onDiagnostic, onFailure, rerenderPreview, view } =
			renderWindowEditor(current, { requestPreview });
		current.surface.focus();

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(undo).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(current.surface);
		historySelection = {
			direction: "backward",
			end: boundary,
			start: boundary - 2,
		};
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(onDiagnostic).not.toHaveBeenCalled();
		const previous = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b159"]',
		);
		const next = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) {
			throw new Error("windowed-history-boundary-restored-text-missing");
		}
		const selection = window.getSelection();
		const anchor = selection?.anchorNode;
		const focus = selection?.focusNode;
		if (!anchor || !focus)
			throw new Error("windowed-history-boundary-selection-missing");
		expect(anchor === next || next.contains(anchor)).toBe(true);
		expect(textOffsetWithin(next, anchor, selection.anchorOffset)).toBe(0);
		expect(focus === previous || previous.contains(focus)).toBe(true);
		expect(textOffsetWithin(previous, focus, selection.focusOffset)).toBe(7);
		expect(selection?.isCollapsed).toBe(false);
		expect(requestPreview).toHaveBeenCalledWith(markdown);
		view.unmount();
	});

	it("maps a history caret at document EOF to the final mounted paragraph", () => {
		const blockIndex = 319;
		const current = fixture({ mounted: [blockIndex] });
		const markdown = current.canonical();
		const eof = markdown.length;
		let historySelection: DocumentSelection = {
			direction: "none",
			end: eof,
			start: eof,
		};
		const undo = vi.fn(() => {
			current.setCanonical(markdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const signature = "eof-history";
		const requestPreview = vi.fn(() => signature);
		const { onDiagnostic, onFailure, rerenderPreview, view } =
			renderWindowEditor(current, { requestPreview });
		current.surface.focus();

		const historyUndo = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(historyUndo);
		expect(undo).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(current.surface);
		historySelection = { direction: "none", end: eof, start: eof };
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).not.toHaveBeenCalled();
		expect(onDiagnostic).not.toHaveBeenCalled();
		const paragraph = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(paragraph instanceof HTMLElement)) {
			throw new Error("windowed-eof-history-restored-text-missing");
		}
		const anchor = window.getSelection()?.anchorNode;
		const anchorOffset = window.getSelection()?.anchorOffset;
		if (!anchor || undefined === anchorOffset) {
			throw new Error("windowed-eof-history-selection-missing");
		}
		expect(anchor === paragraph || paragraph.contains(anchor)).toBe(true);
		expect(textOffsetWithin(paragraph, anchor, anchorOffset)).toBe(
			paragraph.textContent?.length,
		);
		expect(requestPreview).toHaveBeenCalledWith(markdown);
		view.unmount();
	});

	it("keeps an EOF history caret outside a protected inline formula", () => {
		const blockIndex = 319;
		const current = fixture({
			blockOverrides: { [blockIndex]: "Alpha $x$" },
			markupOverrides: {
				[blockIndex]:
					`<p data-easymde-visual-block-id="b${blockIndex}">Alpha ` +
					'<span class="easymde-math" data-easymde-rendered="1" ' +
					'data-easymde-visual-markdown-source="$x$">' +
					"<span>Rendered</span></span></p>",
			},
			mounted: [blockIndex],
		});
		const markdown = current.canonical();
		const historySelection: DocumentSelection = {
			direction: "none",
			end: markdown.length,
			start: markdown.length,
		};
		const undo = vi.fn(() => {
			current.setCanonical(markdown);
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => historySelection,
			undo,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const signature = "protected-inline-math-eof";
		const onFailure = vi.fn();
		const requestPreviewAtDocumentEnd = vi.fn(() => ({
			release: vi.fn(),
			signature,
		}));
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onFailure,
			requestPreviewAtDocumentEnd,
		});
		current.surface.focus();
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyUndo",
			}),
		);
		expect(undo).toHaveBeenCalledOnce();
		rerenderPreview(
			{ ...current.editMap, signature },
			{ revision: 2, signature },
		);

		expect(onFailure).not.toHaveBeenCalled();
		const block = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const protectedNode = block?.querySelector<HTMLElement>(".easymde-math");
		const anchor = window.getSelection()?.anchorNode;
		if (!(block instanceof HTMLElement) || !(protectedNode instanceof HTMLElement) || !anchor) {
			throw new Error("windowed-protected-eof-selection-missing");
		}
		expect(anchor === block || block.contains(anchor)).toBe(true);
		expect(protectedNode.contains(anchor)).toBe(false);
		expect(window.getSelection()?.isCollapsed).toBe(true);
		view.unmount();
	});

	it.each([
		{ ending: "exact block EOF", suffix: "", unprotectedRoot: false },
		{ ending: "terminal line endings", suffix: "\n\n", unprotectedRoot: false },
		{
			ending: "an unprotected generated root",
			suffix: "",
			unprotectedRoot: true,
		},
	])(
		"restores a real Redo caret at EOF after a themed final link with $ending",
		({ suffix, unprotectedRoot }) => {
			const blockIndex = 319;
			const finalSource = `[red-crimson](https://example.test/reference "Red crimson reference")${suffix}`;
			const finalMarkup =
				'<p data-easymde-visual-block-id="b319"><span class="footnote-word">red-crimson</span><sup class="footnote-ref">[1]</sup></p>';
			const current = fixture({
				blockOverrides: { [blockIndex]: finalSource },
				markupOverrides: {
					[blockIndex]: finalMarkup,
				},
				mounted: [blockIndex],
			});
			const targetMarkdown = current.canonical();
			const alternateMarkdown = targetMarkdown.replace("Line 0", "Edit 0");
			const terminalBlock = current.editMap.blocks[blockIndex];
			if (!terminalBlock)
				throw new Error("windowed-themed-history-range-missing");
			current.editMap = {
				...current.editMap,
				blocks: [
					...current.editMap.blocks.map((block, index) =>
						index === blockIndex
							? { ...block, endLine: block.startLine + 1 }
							: block,
					),
					{
						editable: false,
						endLine: terminalBlock.startLine + 1,
						id: "b320",
						startLine: terminalBlock.startLine + 1,
					},
					{
						editable: false,
						endLine: terminalBlock.startLine + 1,
						id: "b321",
						startLine: terminalBlock.startLine + 1,
					},
				],
			};
			const generatedSeparatorClass = unprotectedRoot
				? "unknown-generated-root"
				: "footnotes-sep";
			const generatedRoots = `<section class="${generatedSeparatorClass}" data-easymde-visual-block-id="b320">\u200b</section><section class="footnotes" data-easymde-visual-block-id="b321"><span class="footnote-item" id="fn1"><span class="footnote-num">[1] </span><p>Red crimson reference: <em>https://example.test/reference</em>\u200b</p></span></section>`;
			current.surface.insertAdjacentHTML("beforeend", generatedRoots);
			const submissionField = document.createElement("textarea");
			submissionField.value = targetMarkdown;
			submissionField.defaultValue = targetMarkdown;
			submissionField.setSelectionRange(
				targetMarkdown.length,
				targetMarkdown.length,
			);
			const container = document.createElement("div");
			document.body.append(container, submissionField);
			const codeMirrorDocument = createCodeMirrorDocumentSession({
				container,
				label: "Markdown source",
				submissionField,
			});
			const documentSession = createEditorDocumentSession(
				codeMirrorDocument,
				createNativeTitleSession(null),
			);
			documentSession.registerSubmissionState({
				appleFont: "system",
				codeTheme: "dark",
				codeThemeExplicit: false,
				customCssId: "",
				customFont: "none",
				markdownTheme: "default",
				serifFont: "off",
				windowsFont: "system",
			});
			documentSession.document.applyTextChange({
				changes: { from: 0, insert: "Edit 0", to: "Line 0".length },
				recordHistorySelection: true,
				selection: {
					direction: "none",
					end: alternateMarkdown.length,
					start: alternateMarkdown.length,
				},
				value: alternateMarkdown,
			});
			expect(documentSession.document.undo()).toBe(true);
			expect(documentSession.document.getValue()).toBe(targetMarkdown);

			const signature = "themed-document-end-redo";
			const releasePin = vi.fn();
			const requestPreviewAtDocumentEnd = vi.fn(() => ({
				release: releasePin,
				signature,
			}));
			const onDiagnostic = vi.fn();
			const onFailure = vi.fn();
			const { rerenderPreview, view } = renderWindowEditor(current, {
				documentSession,
				onDiagnostic,
				onFailure,
				requestPreviewAtDocumentEnd,
			});
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			current.surface.focus();

			const redo = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "historyRedo",
			});
			current.surface.dispatchEvent(redo);
			expect(redo.defaultPrevented).toBe(true);
			expect(documentSession.document.getValue()).toBe(alternateMarkdown);
			expect(documentSession.document.getSelection()).toEqual({
				direction: "none",
				end: alternateMarkdown.length,
				start: alternateMarkdown.length,
			});
			expect(requestPreviewAtDocumentEnd).toHaveBeenCalledOnce();
			expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(
				alternateMarkdown,
			);

			current.surface.innerHTML = [
				'<div data-easymde-preview-window-spacer="1"></div>',
				finalMarkup,
				generatedRoots,
			].join("");
			rerenderPreview(
				{ ...current.editMap, signature },
				{ revision: 2, signature },
			);

			expect(onDiagnostic).not.toHaveBeenCalled();
			expect(releasePin).toHaveBeenCalledOnce();
			if (unprotectedRoot) {
				expect(onFailure).toHaveBeenCalledWith(
					"visual-editor-window-history-selection-map-failed",
				);
				expect(onFailure).toHaveBeenCalledOnce();
				view.unmount();
				documentSession.destroy();
				container.remove();
				submissionField.remove();
				return;
			}
			expect(onFailure).not.toHaveBeenCalled();
			expect(
				current.surface
					.querySelector('[data-easymde-visual-block-id="b320"]')
					?.getAttribute("contenteditable"),
			).toBe("false");
			expect(
				current.surface
					.querySelector('[data-easymde-visual-block-id="b321"]')
					?.getAttribute("contenteditable"),
			).toBe("false");
			const paragraph = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			const selection = window.getSelection();
			const anchor = selection?.anchorNode;
			if (!(paragraph instanceof HTMLElement) || !anchor || !selection) {
				throw new Error("windowed-themed-history-selection-missing");
			}
			expect(selection.isCollapsed).toBe(true);
			expect(anchor === paragraph || paragraph.contains(anchor)).toBe(true);
			expect(textOffsetWithin(paragraph, anchor, selection.anchorOffset)).toBe(
				paragraph.textContent?.length,
			);

			view.unmount();
			documentSession.destroy();
			container.remove();
			submissionField.remove();
		},
	);

	it.each([
		{
			className: "easymde-math",
			extraAttributes: 'data-easymde-rendered="1"',
			name: "math",
		},
		{
			className: "easymde-mermaid",
			extraAttributes: "",
			name: "Mermaid",
		},
		{
			className: "easymde-toc",
			extraAttributes: "",
			name: "table of contents",
		},
		{
			className: "footnotes",
			extraAttributes: "",
			name: "footnotes",
		},
	])(
		"fails closed when a selection deletion crosses generated $name content",
		({ className, extraAttributes }) => {
			const current = fixture();
			const block = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b160"]',
			);
			if (!(block instanceof HTMLElement))
				throw new Error("windowed-protected-block-missing");
			block.innerHTML = [
				"<span>Before</span>",
				`<span class="${className}" ${extraAttributes}>Protected</span>`,
				"<span>After</span>",
			].join("");
			const protectedNode = block.children[1];
			if (!(protectedNode instanceof HTMLElement)) {
				throw new Error("windowed-protected-node-missing");
			}
			protectedNode.setAttribute("contenteditable", "false");
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, { onFailure });
			const before = block.firstElementChild?.firstChild;
			const after = block.lastElementChild?.firstChild;
			if (!(before instanceof Text) || !(after instanceof Text)) {
				throw new Error("windowed-protected-selection-text-missing");
			}
			window.getSelection()?.setBaseAndExtent(before, 0, after, after.length);
			const initialHtml = current.surface.innerHTML;
			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward",
			});
			current.surface.dispatchEvent(beforeInput);

			expect(beforeInput.defaultPrevented).toBe(true);
			expect(current.surface.innerHTML).toBe(initialHtml);
			expect(current.canonical()).toBe(
				Array.from({ length: 320 }, (_, index) => `Line ${index}`).join("\n"),
			);
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-read-only-region-mutated",
			);
			view.unmount();
		},
	);

	it.each([
		{
			blockOffset: 0,
			inputType: "deleteContentBackward",
			mounted: [160],
			name: "backward spacer boundary",
		},
		{
			blockOffset: "Line 160".length,
			inputType: "deleteContentForward",
			mounted: [160],
			name: "forward spacer boundary",
		},
		{
			blockOffset: 0,
			inputType: "deleteContentBackward",
			mounted: [159, 160],
			name: "backward non-editable boundary",
			nonEditable: [159],
		},
	])(
		"fails closed at a $name before the browser mutates the DOM",
		({ blockOffset, inputType, mounted, nonEditable }) => {
			const current = fixture({
				mounted,
				...(nonEditable ? { nonEditable } : {}),
			});
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, { onFailure });
			const block = current.surface.querySelector<HTMLElement>(
				'[data-easymde-visual-block-id="b160"]',
			);
			const text = block?.firstChild;
			if (!(text instanceof Text))
				throw new Error("windowed-boundary-text-missing");
			placeCaret(text, blockOffset);
			const initialHtml = current.surface.innerHTML;
			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType,
			});
			current.surface.dispatchEvent(beforeInput);

			expect(beforeInput.defaultPrevented).toBe(true);
			expect(current.surface.innerHTML).toBe(initialHtml);
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-window-adjacent-block-unavailable",
			);
			view.unmount();
		},
	);

	it("merges a structural Enter that creates a sibling Block inside the active region", () => {
		const current = fixture();
		const onFailure = vi.fn();
		const requestPreview = vi.fn((_markdown: string) => "enter-signature");
		const requestPreviewAtDocumentEnd = vi.fn((markdown: string) => ({
			release: vi.fn(),
			signature: requestPreview(markdown),
		}));
		const { rerenderPreview, view } = renderWindowEditor(current, {
			onFailure,
			requestPreview,
			requestPreviewAtDocumentEnd,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();
		const paragraph = current.surface.querySelector("p");
		const text = paragraph?.firstChild;
		if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
			throw new Error("windowed-text-missing");
		}
		placeCaret(text, "Line".length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "insertParagraph",
			}),
		);
		text.data = "Line";
		const sibling = document.createElement("p");
		sibling.textContent = " 160";
		paragraph.after(sibling);
		const siblingText = sibling.firstChild;
		if (!(siblingText instanceof Text))
			throw new Error("windowed-sibling-text-missing");
		placeCaret(siblingText, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertParagraph",
			}),
		);

		expect(current.canonical().split("\n").slice(160, 163)).toEqual([
			"Line",
			"",
			"160",
		]);
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(requestPreview).toHaveBeenCalledWith(current.canonical());
		expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(
			current.canonical(),
			current.documentSession.document.getSelection(),
		);
		expect(onFailure).not.toHaveBeenCalled();

		const expectedSelection = current.documentSession.document.getSelection();
		const acceptedSignature = "enter-signature";
		const acceptedBlocks = current.editMap.blocks.flatMap((block, index) => {
			if (index < 160) return [block];
			if (index === 160) {
				return [
					{ ...block, endLine: block.startLine + 1 },
					{
						editable: true,
						endLine: block.endLine + 2,
						id: "b160-enter",
						startLine: block.startLine + 2,
					},
				];
			}
			return [
				{
					...block,
					endLine: block.endLine + 2,
					id: `${block.id}-shifted`,
					startLine: block.startLine + 2,
				},
			];
		});
		current.surface.innerHTML = [
			'<div data-easymde-preview-window-spacer="1"></div>',
			'<p data-easymde-visual-block-id="b160">Line</p>',
			'<p data-easymde-visual-block-id="b160-enter">160</p>',
			'<div data-easymde-preview-window-spacer="1"></div>',
		].join("");
		const replacedSelection = window.getSelection();
		replacedSelection?.collapse(current.surface, 0);
		act(() => {
			rerenderPreview(
				{
					...current.editMap,
					blocks: acceptedBlocks,
					signature: acceptedSignature,
				},
				{ revision: 2, signature: acceptedSignature },
			);
		});

		const siblingAfterPreview = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160-enter"]',
		);
		const selectionAfterPreview = window.getSelection();
		const anchorAfterPreview = selectionAfterPreview?.anchorNode;
		expect(onFailure).not.toHaveBeenCalled();
		expect(selectionAfterPreview?.isCollapsed).toBe(true);
		expect(document.activeElement).toBe(current.surface);
		expect(siblingAfterPreview).not.toBeNull();
		expect(anchorAfterPreview).not.toBeNull();
		expect(anchorAfterPreview?.isConnected).toBe(true);
		expect(
			anchorAfterPreview && siblingAfterPreview?.contains(anchorAfterPreview),
		).toBe(true);
		expect(
			textOffsetWithin(
				siblingAfterPreview as HTMLElement,
				anchorAfterPreview as Node,
				selectionAfterPreview?.anchorOffset ?? -1,
			),
		).toBe(0);
		expect(current.documentSession.document.getSelection()).toEqual(
			expectedSelection,
		);
		view.unmount();
	});

	it("inserts a source newline when Chromium splits one code body into two CODE children", () => {
		const blockIndex = 160;
		const initialFence = "~~~\nAB\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`,
			},
			mounted: [blockIndex],
		});
		const { onFailure, view } = renderWindowEditor(current);
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const initialCode = pre?.querySelector(":scope > code");
		const initialText = initialCode?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(initialCode instanceof HTMLElement) ||
			!(initialText instanceof Text)
		)
			throw new Error("windowed-enter-code-body-missing");
		const initialMarkdown = current.canonical();
		const initialStart = initialMarkdown.indexOf(initialFence);
		if (initialStart < 0) throw new Error("windowed-enter-code-source-missing");
		placeCaret(initialText, 1);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "insertParagraph",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);

		const firstLine = document.createElement("code");
		firstLine.textContent = "A";
		const secondLine = document.createElement("code");
		secondLine.textContent = "B";
		pre.replaceChildren(firstLine, secondLine);
		const secondLineText = secondLine.firstChild;
		if (!(secondLineText instanceof Text)) {
			throw new Error("windowed-enter-split-code-text-missing");
		}
		placeCaret(secondLineText, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertParagraph",
			}),
		);

		expect(current.canonical()).toBe(
			initialMarkdown.slice(0, initialStart) +
				"~~~\nA\nB\n~~~" +
				initialMarkdown.slice(initialStart + initialFence.length),
		);
		const editedCode = pre.querySelector(":scope > code");
		const editedText = editedCode?.firstChild;
		if (!(editedCode instanceof HTMLElement) || !(editedText instanceof Text)) {
			throw new Error("windowed-enter-reconciled-code-missing");
		}
		expect(pre.querySelectorAll(":scope > code")).toHaveLength(1);
		placeCaret(editedText, 2);
		const characterBeforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "X",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(characterBeforeInput);
		expect(characterBeforeInput.defaultPrevented).toBe(false);
		editedText.insertData(2, "X");
		placeCaret(editedText, 3);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(
			initialMarkdown.slice(0, initialStart) +
				"~~~\nA\nXB\n~~~" +
				initialMarkdown.slice(initialStart + initialFence.length),
		);
		expect(current.documentChanges).toHaveBeenCalledTimes(2);
		const caret = initialStart + "~~~\nA\nX".length;
		expect(current.documentChanges.mock.lastCall?.[0].selection).toEqual({
			direction: "none",
			end: caret,
			start: caret,
		});
		expect(window.getSelection()?.anchorNode).toBe(editedText);
		expect(window.getSelection()?.anchorOffset).toBe(3);
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it("records real CodeMirror history selections for Windowed Enter, X, and IME edits", async () => {
		const blockIndex = 160;
		const fence = "~~~js\nA\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: fence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">A\n</code></pre>`,
			},
			mounted: [blockIndex],
		});
		const initialMarkdown = current.canonical();
		const fenceStart = initialMarkdown.indexOf(fence);
		if (fenceStart < 0) throw new Error("windowed-real-history-fence-missing");
		const bodyStart = fenceStart + "~~~js\n".length;
		const afterEnter = initialMarkdown.replace(fence, "~~~js\nA\n\n~~~");
		const afterX = initialMarkdown.replace(fence, "~~~js\nA\nX\n~~~");
		const submissionField = document.createElement("textarea");
		submissionField.value = initialMarkdown;
		submissionField.defaultValue = initialMarkdown;
		submissionField.setSelectionRange(bodyStart + 1, bodyStart + 1);
		const container = document.createElement("div");
		document.body.append(container, submissionField);
		const codeMirrorDocument = createCodeMirrorDocumentSession({
			container,
			label: "Markdown source",
			submissionField,
		});
		const titleSession = createNativeTitleSession(null);
		const documentSession = createEditorDocumentSession(
			codeMirrorDocument,
			titleSession,
		);
		documentSession.registerSubmissionState({
			appleFont: "system",
			codeTheme: "dark",
			codeThemeExplicit: false,
			customCssId: "",
			customFont: "none",
			markdownTheme: "default",
			serifFont: "off",
			windowsFont: "system",
		});
		const requestPreview = vi.fn(() => "windowed-real-history");
		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, {
			documentSession,
			onFailure,
			requestPreview,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		current.surface.focus();

		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const initialCode = pre?.querySelector(":scope > code");
		const initialText = initialCode?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(initialCode instanceof HTMLElement) ||
			!(initialText instanceof Text)
		)
			throw new Error("windowed-real-history-code-missing");
		placeCaret(initialText, 1);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "insertParagraph",
			}),
		);
		const firstLine = document.createElement("code");
		firstLine.className = "language-js";
		firstLine.textContent = "A";
		const secondLine = document.createElement("code");
		secondLine.className = "language-js";
		secondLine.textContent = "\n";
		pre.replaceChildren(firstLine, secondLine);
		const secondLineText = secondLine.firstChild;
		if (!(secondLineText instanceof Text)) {
			throw new Error("windowed-real-history-enter-text-missing");
		}
		placeCaret(secondLineText, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertParagraph",
			}),
		);
		expect(documentSession.document.getValue()).toBe(afterEnter);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: bodyStart + 2,
			start: bodyStart + 2,
		});

		const codeAfterEnter = pre.querySelector(":scope > code");
		const textAfterEnter = codeAfterEnter?.firstChild;
		if (
			!(codeAfterEnter instanceof HTMLElement) ||
			!(textAfterEnter instanceof Text)
		) {
			throw new Error("windowed-real-history-after-enter-code-missing");
		}
		placeCaret(textAfterEnter, 2);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "X",
				inputType: "insertText",
			}),
		);
		textAfterEnter.insertData(2, "X");
		placeCaret(textAfterEnter, 3);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertText",
			}),
		);
		expect(documentSession.document.getValue()).toBe(afterX);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: bodyStart + 3,
			start: bodyStart + 3,
		});

		const compositionCode = pre.querySelector(":scope > code");
		const compositionText = compositionCode?.firstChild;
		if (
			!(compositionCode instanceof HTMLElement) ||
			!(compositionText instanceof Text)
		) {
			throw new Error("windowed-real-history-ime-code-missing");
		}
		placeCaret(compositionText, 2);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", {
				bubbles: true,
				data: "",
			}),
		);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "文",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		compositionText.insertData(2, "文");
		placeCaret(compositionText, 3);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "文",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "文",
			}),
		);
		const afterComposition = initialMarkdown.replace(
			fence,
			"~~~js\nA\n文X\n~~~",
		);
		expect(documentSession.document.getValue()).toBe(afterX);
		await act(async () => {
			await Promise.resolve();
		});
		expect(documentSession.document.getValue()).toBe(afterComposition);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: bodyStart + 3,
			start: bodyStart + 3,
		});
		documentSession.document.flush();
		expect([
			submissionField.selectionStart,
			submissionField.selectionEnd,
		]).toEqual([bodyStart + 3, bodyStart + 3]);
		expect(onFailure).not.toHaveBeenCalled();

		view.unmount();
		const assertHistoryState = (markdown: string, selection: number): void => {
			expect(documentSession.document.getValue()).toBe(markdown);
			expect(documentSession.document.getSelection()).toEqual({
				direction: "none",
				end: selection,
				start: selection,
			});
			documentSession.document.flush();
			expect([
				submissionField.selectionStart,
				submissionField.selectionEnd,
			]).toEqual([selection, selection]);
		};
		expect(documentSession.document.undo()).toBe(true);
		assertHistoryState(afterX, bodyStart + 2);
		expect(documentSession.document.undo()).toBe(true);
		assertHistoryState(afterEnter, bodyStart + 2);
		expect(documentSession.document.undo()).toBe(true);
		assertHistoryState(initialMarkdown, bodyStart + 1);
		expect(documentSession.document.redo()).toBe(true);
		assertHistoryState(afterEnter, bodyStart + 2);
		expect(documentSession.document.redo()).toBe(true);
		assertHistoryState(afterX, bodyStart + 3);
		expect(documentSession.document.redo()).toBe(true);
		assertHistoryState(afterComposition, bodyStart + 3);
		expect(documentSession.document.canRedo()).toBe(false);

		documentSession.document.destroy();
		container.remove();
		submissionField.remove();
	});

	it("records the visible ordinary paragraph selection before native input history", () => {
		const blockIndex = 159;
		const current = fixture({
			blockOverrides: { 160: "~~~js\nA\n~~~" },
			markupOverrides: {
				160: '<pre data-easymde-visual-block-id="b160"><code class="language-js">A\n</code></pre>',
			},
			mounted: [blockIndex, 160],
			paragraphBlocks: true,
		});
		const initialMarkdown = current.canonical();
		const paragraphStart = initialMarkdown.indexOf("Line 159");
		if (paragraphStart < 0)
			throw new Error("windowed-paragraph-history-source-missing");
		const afterX = initialMarkdown.replace("Line 159", "XLine 159");
		const submissionField = document.createElement("textarea");
		submissionField.value = initialMarkdown;
		submissionField.defaultValue = initialMarkdown;
		submissionField.setSelectionRange(
			initialMarkdown.length,
			initialMarkdown.length,
		);
		const container = document.createElement("div");
		document.body.append(container, submissionField);
		const codeMirrorDocument = createCodeMirrorDocumentSession({
			container,
			label: "Markdown source",
			submissionField,
		});
		const documentSession = createEditorDocumentSession(
			codeMirrorDocument,
			createNativeTitleSession(null),
		);
		documentSession.registerSubmissionState({
			appleFont: "system",
			codeTheme: "dark",
			codeThemeExplicit: false,
			customCssId: "",
			customFont: "none",
			markdownTheme: "default",
			serifFont: "off",
			windowsFont: "system",
		});
		const requestPreview = vi.fn(() => "next");
		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const { view, rerenderPreview } = renderWindowEditor(current, {
			documentSession,
			onDiagnostic,
			onFailure,
			requestPreview,
		});
		current.surface.tabIndex = 0;
		current.surface.focus();
		expect(document.activeElement).toBe(current.surface);
		const paragraph = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const text = paragraph?.firstChild;
		if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
			throw new Error("windowed-paragraph-history-dom-missing");
		}
		expect(documentSession.document.getSelection().start).toBe(
			initialMarkdown.length,
		);
		placeCaret(text, 0);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "X",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		text.insertData(0, "X");
		placeCaret(text, 1);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertText",
			}),
		);
		expect(documentSession.document.getValue()).toBe(afterX);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: paragraphStart + 1,
			start: paragraphStart + 1,
		});
		expect(document.activeElement).toBe(current.surface);

		const undo = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
			key: "z",
		});
		current.surface.dispatchEvent(undo);
		expect(undo.defaultPrevented).toBe(true);
		expect(requestPreview).toHaveBeenCalledWith(initialMarkdown);
		const previewSignature = "next";
		act(() => {
			paragraph.textContent = "Line 159";
			rerenderPreview(
				{ ...current.editMap, signature: previewSignature },
				{ revision: 2, signature: previewSignature },
			);
		});
		expect(documentSession.document.getValue()).toBe(initialMarkdown);
		expect(documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: paragraphStart,
			start: paragraphStart,
		});
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		expect(window.getSelection()?.anchorNode).toBe(paragraph);
		expect(window.getSelection()?.anchorOffset).toBe(0);
		expect(
			current.surface.querySelector(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			),
		).toBe(paragraph);

		view.unmount();
		documentSession.destroy();
		container.remove();
		submissionField.remove();
	});

	it.each(["~~~", "```"])(
		"preserves body input and history for a bare EOF %s fence",
		(fence) => {
			const lineEnding = "\n";
			const blockIndex = 160;
			const current = fixture({
				blockOverrides: { [blockIndex]: fence },
				markupOverrides: {
					[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code></code></pre>`,
				},
				mounted: [159, blockIndex],
				paragraphBlocks: true,
				sourceBlockCount: blockIndex + 1,
			});
			const initialMarkdown = current.canonical();
			const fenceStart = initialMarkdown.indexOf(fence);
			if (fenceStart < 0) throw new Error("windowed-bare-eof-fence-missing");
			const submissionField = document.createElement("textarea");
			submissionField.value = initialMarkdown;
			submissionField.defaultValue = initialMarkdown;
			submissionField.setSelectionRange(
				initialMarkdown.length,
				initialMarkdown.length,
			);
			const container = document.createElement("div");
			document.body.append(container, submissionField);
			const codeMirrorDocument = createCodeMirrorDocumentSession({
				container,
				label: "Markdown source",
				submissionField,
			});
			const documentSession = createEditorDocumentSession(
				codeMirrorDocument,
				createNativeTitleSession(null),
			);
			expect(documentSession.document.getValue()).toBe(initialMarkdown);
			documentSession.registerSubmissionState({
				appleFont: "system",
				codeTheme: "dark",
				codeThemeExplicit: false,
				customCssId: "",
				customFont: "none",
				markdownTheme: "default",
				serifFont: "off",
				windowsFont: "system",
			});
			const onFailure = vi.fn();
			const { view } = renderWindowEditor(current, {
				documentSession,
				onFailure,
			});
			current.surface.tabIndex = 0;
			current.surface.setAttribute("contenteditable", "true");
			current.surface.focus();

			const pre = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			const code = pre?.querySelector(":scope > code");
			if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
				throw new Error("windowed-bare-eof-code-missing");
			}
			const placeCodeCaret = (offset: number) => {
				const range = document.createRange();
				range.setStart(code, offset);
				range.collapse(true);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
			};
			const dispatchText = (data: string, offset: number) => {
				const beforeInput = new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					data,
					inputType: "insertText",
				});
				current.surface.dispatchEvent(beforeInput);
				expect(beforeInput.defaultPrevented).toBe(false);
				let text: Text | null =
					code.firstChild instanceof Text ? code.firstChild : null;
				if (!text) {
					text = document.createTextNode("");
					code.append(text);
				}
				text.insertData(offset, data);
				placeCaret(text, offset + data.length);
				current.surface.dispatchEvent(
					new InputEvent("input", {
						bubbles: true,
						data,
						inputType: "insertText",
					}),
				);
			};
			const assertState = (markdown: string, body: string, caret: number) => {
				expect(documentSession.document.getValue()).toBe(markdown);
				expect(documentSession.document.getSelection()).toEqual({
					direction: "none",
					end: caret,
					start: caret,
				});
				documentSession.document.flush();
				expect([
					submissionField.selectionStart,
					submissionField.selectionEnd,
				]).toEqual([caret, caret]);
				const codeBody = pre.querySelector<HTMLElement>(":scope > code");
				expect(codeBody?.textContent).toBe(body);
				const anchor = window.getSelection()?.anchorNode ?? null;
				const anchorOffset = window.getSelection()?.anchorOffset;
				if (!codeBody || !anchor || undefined === anchorOffset) {
					throw new Error("windowed-bare-eof-visible-caret-missing");
				}
				expect(anchor === codeBody || codeBody.contains(anchor)).toBe(true);
				expect(textOffsetWithin(codeBody, anchor, anchorOffset)).toBe(
					body.length - 1,
				);
			};

			placeCodeCaret(0);
			dispatchText("x", 0);
			const bodyStart = fenceStart + fence.length + lineEnding.length;
			const afterX = `${initialMarkdown}${lineEnding}x${lineEnding}`;
			assertState(afterX, "x\n", bodyStart + 1);

			dispatchText("y", 1);
			const afterY = `${initialMarkdown}${lineEnding}xy${lineEnding}`;
			assertState(afterY, "xy\n", bodyStart + 2);

			const lineBreakBeforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: null,
				inputType: "insertLineBreak",
			});
			current.surface.dispatchEvent(lineBreakBeforeInput);
			expect(lineBreakBeforeInput.defaultPrevented).toBe(false);
			const textBeforeLineBreak = code.firstChild;
			if (!(textBeforeLineBreak instanceof Text)) {
				throw new Error("windowed-bare-eof-text-missing");
			}
			textBeforeLineBreak.insertData(2, "\n");
			placeCaret(textBeforeLineBreak, 3);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "insertLineBreak",
				}),
			);
			const afterLineBreak = `${initialMarkdown}${lineEnding}xy${lineEnding}${lineEnding}`;
			assertState(afterLineBreak, "xy\n\n", bodyStart + 2 + lineEnding.length);
			expect(onFailure).not.toHaveBeenCalled();

			view.unmount();
			const assertHistory = (markdown: string, caret: number) => {
				expect(documentSession.document.getValue()).toBe(markdown);
				expect(documentSession.document.getSelection()).toEqual({
					direction: "none",
					end: caret,
					start: caret,
				});
				documentSession.document.flush();
				expect(submissionField.selectionEnd).toBe(caret);
			};
			expect(documentSession.document.undo()).toBe(true);
			assertHistory(afterY, bodyStart + 2);
			expect(documentSession.document.undo()).toBe(true);
			assertHistory(initialMarkdown, initialMarkdown.length);
			expect(documentSession.document.redo()).toBe(true);
			// Redoing the whole run restores the caret CodeMirror maps from the
			// run's pre-edit start selection through the composed change, which
			// lands one stop short of the run's own post-edit caret - the same
			// position a native typing run redoes to.
			assertHistory(afterY, bodyStart + 1);
			expect(documentSession.document.redo()).toBe(true);
			assertHistory(afterLineBreak, bodyStart + 2 + lineEnding.length);

			documentSession.destroy();
			container.remove();
			submissionField.remove();
		},
	);

	it("restores the accepted window region when noncancelable code input loses PRE identity", () => {
		const blockIndex = 160;
		const initialFence = "~~~\nAB\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`,
			},
			mounted: [159, blockIndex, 161],
		});
		const { onFailure, view } = renderWindowEditor(current);
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const code = pre?.querySelector(":scope > code");
		const text = code?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(code instanceof HTMLElement) ||
			!(text instanceof Text)
		)
			throw new Error("windowed-stale-code-identity-fixture-invalid");
		const initialMarkdown = current.canonical();
		const initialStart = initialMarkdown.indexOf(initialFence);
		if (initialStart < 0) throw new Error("windowed-stale-code-source-missing");
		placeCaret(text, 1);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			inputType: "insertParagraph",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);

		const replacementPre = pre.cloneNode(true) as HTMLElement;
		const replacementCode = replacementPre.querySelector(":scope > code");
		const replacementText = replacementCode?.firstChild;
		if (!(replacementText instanceof Text)) {
			throw new Error("windowed-stale-code-replacement-invalid");
		}
		replacementText.data = "A\nB";
		pre.replaceWith(replacementPre);
		placeCaret(replacementText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertParagraph",
			}),
		);

		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith("visual-editor-code-body-map-stale");
		const restoredPre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		expect(restoredPre).toBe(pre);
		expect(restoredPre?.querySelector(":scope > code")?.textContent).toBe("AB");

		const restoredText =
			restoredPre?.querySelector(":scope > code")?.firstChild;
		if (!(restoredText instanceof Text)) {
			throw new Error("windowed-stale-code-restored-text-missing");
		}
		placeCaret(restoredText, 1);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "Z",
				inputType: "insertText",
			}),
		);
		restoredText.insertData(1, "Z");
		placeCaret(restoredText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "Z",
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(
			initialMarkdown.slice(0, initialStart) +
				"~~~\nAZB\n~~~" +
				initialMarkdown.slice(initialStart + initialFence.length),
		);
		expect(onFailure).toHaveBeenCalledOnce();
		expect(current.documentChanges).toHaveBeenCalledOnce();
		view.unmount();
	});

	it("rejects noncancelable insertText after the browser replaces a captured code PRE", () => {
		const blockIndex = 160;
		const initialFence = "~~~\nAB\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`,
			},
			mounted: [159, blockIndex, 161],
		});
		const requestPreview = vi.fn(() => "unexpected-preview");
		const { onFailure, view } = renderWindowEditor(current, { requestPreview });
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const code = pre?.querySelector(":scope > code");
		const text = code?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(code instanceof HTMLElement) ||
			!(text instanceof Text)
		) {
			throw new Error("windowed-noncancelable-text-fixture-invalid");
		}
		const initialMarkdown = current.canonical();
		placeCaret(text, 1);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			data: "Q",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);

		const replacementPre = pre.cloneNode(false) as HTMLElement;
		const replacementCode = code.cloneNode(false) as HTMLElement;
		replacementCode.textContent = "AQB";
		replacementPre.append(replacementCode);
		pre.replaceWith(replacementPre);
		const replacementText = replacementCode.firstChild;
		if (!(replacementText instanceof Text)) {
			throw new Error("windowed-noncancelable-text-replacement-invalid");
		}
		placeCaret(replacementText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				cancelable: false,
				data: "Q",
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(requestPreview).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith("visual-editor-code-body-map-stale");
		const restoredPre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const restoredCode = restoredPre?.querySelector(":scope > code");
		const restoredText = restoredCode?.firstChild;
		if (
			restoredPre !== pre ||
			!(restoredCode instanceof HTMLElement) ||
			!(restoredText instanceof Text)
		) {
			throw new Error("windowed-noncancelable-text-restoration-invalid");
		}
		expect(restoredCode.textContent).toBe("AB");
		expect(window.getSelection()?.anchorNode).toBe(restoredText);
		expect(window.getSelection()?.anchorOffset).toBe(1);

		const recoveryBeforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "Z",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(recoveryBeforeInput);
		expect(recoveryBeforeInput.defaultPrevented).toBe(false);
		restoredText.insertData(1, "Z");
		placeCaret(restoredText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "Z",
				inputType: "insertText",
			}),
		);
		expect(current.canonical()).toContain("~~~\nAZB\n~~~");
		expect(onFailure).toHaveBeenCalledOnce();
		expect(current.documentChanges).toHaveBeenCalledOnce();
		view.unmount();
	});

	it("projects highlighted code input and keeps Markdown shortcuts literal in CODE", () => {
		const blockIndex = 160;
		const initialFence = "~~~js\nAB\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"><span class="hljs-keyword">A</span><font color="#c678dd">B</font>\n</code></pre>`,
			},
			mounted: [159, blockIndex, 161],
		});
		const { onFailure, view } = renderWindowEditor(current);
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const code = pre?.querySelector(":scope > code");
		const token = code?.querySelector("span.hljs-keyword");
		const text = token?.firstChild;
		const browserFont = code?.querySelector("font");
		if (
			!(pre instanceof HTMLElement) ||
			!(code instanceof HTMLElement) ||
			!(token instanceof HTMLElement) ||
			!(text instanceof Text) ||
			!(browserFont instanceof HTMLElement)
		)
			throw new Error("windowed-highlighted-code-input-fixture-invalid");
		const initialMarkdown = current.canonical();
		placeCaret(text, 1);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "**literal**",
				inputType: "insertText",
			}),
		);
		text.insertData(1, "**literal**");
		placeCaret(text, 1 + "**literal**".length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "**literal**",
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(
			initialMarkdown.replace(initialFence, "~~~js\nA**literal**B\n~~~"),
		);
		expect(code.querySelector("strong")).toBeNull();
		expect(code.querySelector("font")).toBe(browserFont);
		expect(onFailure).not.toHaveBeenCalled();
		view.unmount();
	});

	it.each(["~~~", "```"])(
		"widens a Windowed %s fence around literal body delimiters",
		(fence) => {
			const blockIndex = 160;
			const initialFence = `${fence}js\nA\n${fence}`;
			const current = fixture({
				blockOverrides: { [blockIndex]: initialFence },
				markupOverrides: {
					[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">A\n</code></pre>`,
				},
				mounted: [159, blockIndex, 161],
			});
			const { onFailure, requestPreview, view } = renderWindowEditor(current);
			const pre = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			const code = pre?.querySelector(":scope > code");
			const text = code?.firstChild;
			if (
				!(pre instanceof HTMLElement) ||
				!(code instanceof HTMLElement) ||
				!(text instanceof Text)
			) {
				throw new Error("windowed-literal-fence-fixture-invalid");
			}
			const initialMarkdown = current.canonical();
			placeCaret(text, text.length);
			current.surface.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					data: fence,
					inputType: "insertText",
				}),
			);
			text.insertData(text.length, fence);
			placeCaret(text, text.length);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: fence,
					inputType: "insertText",
				}),
			);

			const widenedFence = fence[0]?.repeat(fence.length + 1);
			expect(current.canonical()).toBe(
				initialMarkdown.replace(
					initialFence,
					`${widenedFence}js\nA\n${fence}\n${widenedFence}`,
				),
			);
			expect(pre.getAttribute("data-easymde-visual-fence")).toBe(widenedFence);
			expect(requestPreview).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		},
	);

	it("restores a noncancelable edit when the selected region cannot map to one code block", () => {
		const blockIndex = 160;
		const initialFence = "~~~\nAB\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`,
			},
			mounted: [159, blockIndex, 161],
		});
		const { onFailure, view } = renderWindowEditor(current);
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const code = pre?.querySelector(":scope > code");
		const codeText = code?.firstChild;
		const adjacentText = current.surface.querySelector(
			'[data-easymde-visual-block-id="b161"]',
		)?.firstChild;
		if (
			!(pre instanceof HTMLElement) ||
			!(code instanceof HTMLElement) ||
			!(codeText instanceof Text) ||
			!(adjacentText instanceof Text)
		)
			throw new Error("windowed-code-map-rejection-fixture-invalid");
		const initialMarkdown = current.canonical();
		const initialStart = initialMarkdown.indexOf(initialFence);
		if (initialStart < 0)
			throw new Error("windowed-code-map-rejection-source-missing");
		const selection = window.getSelection();
		selection?.setBaseAndExtent(codeText, 1, adjacentText, 0);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			inputType: "insertParagraph",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		codeText.data = "A\nB";
		placeCaret(codeText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertParagraph",
			}),
		);

		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith("visual-editor-code-body-map-stale");
		const restoredPre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const restoredText =
			restoredPre?.querySelector(":scope > code")?.firstChild;
		const restoredAdjacentText = current.surface.querySelector(
			'[data-easymde-visual-block-id="b161"]',
		)?.firstChild;
		if (
			!(restoredText instanceof Text) ||
			!(restoredAdjacentText instanceof Text)
		)
			throw new Error("windowed-code-map-rejection-restoration-invalid");
		expect(restoredPre).toBe(pre);
		expect(restoredText.data).toBe("AB");
		expect(selection?.anchorNode).toBe(restoredText);
		expect(selection?.anchorOffset).toBe(1);
		expect(selection?.focusNode).toBe(restoredAdjacentText);
		expect(selection?.focusOffset).toBe(0);

		placeCaret(restoredText, 1);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "Z",
				inputType: "insertText",
			}),
		);
		restoredText.insertData(1, "Z");
		placeCaret(restoredText, 2);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "Z",
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(
			initialMarkdown.slice(0, initialStart) +
				"~~~\nAZB\n~~~" +
				initialMarkdown.slice(initialStart + initialFence.length),
		);
		expect(onFailure).toHaveBeenCalledOnce();
		expect(current.documentChanges).toHaveBeenCalledOnce();
		view.unmount();
	});

	it.each([
		["without a language", "~~~\n\n~~~", ""],
		["with the js language", "~~~js\n\n~~~", ' class="language-js"'],
	])(
		"restores the windowed DOM when a noncancelable IME edit has a rejected code selection $0",
		async (_description, initialFence, languageClass) => {
			const blockIndex = 160;
			const current = fixture({
				blockOverrides: { [blockIndex]: initialFence },
				markupOverrides: {
					[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code${languageClass}></code></pre>`,
				},
				mounted: [159, blockIndex, 161],
				paragraphBlocks: true,
			});
			const { onDiagnostic, onFailure, view } = renderWindowEditor(current);
			const pre = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			const code = pre?.querySelector(":scope > code");
			if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
				throw new Error("windowed-ime-rejected-code-missing");
			}
			const initialMarkdown = current.canonical();
			const initialStart = initialMarkdown.indexOf(initialFence);
			if (initialStart < 0)
				throw new Error("windowed-ime-rejected-source-missing");
			const selectionRange = document.createRange();
			selectionRange.setStart(pre, 0);
			selectionRange.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(selectionRange);

			current.surface.dispatchEvent(
				new CompositionEvent("compositionstart", {
					bubbles: true,
					data: "",
				}),
			);
			const beforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: false,
				data: "中",
				inputType: "insertCompositionText",
				isComposing: true,
			});
			current.surface.dispatchEvent(beforeInput);
			expect(beforeInput.cancelable).toBe(false);
			expect(beforeInput.defaultPrevented).toBe(false);

			const compositionText = document.createTextNode("中");
			code.replaceChildren(compositionText);
			placeCaret(compositionText, compositionText.length);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: "中",
					inputType: "insertCompositionText",
					isComposing: true,
				}),
			);
			current.surface.dispatchEvent(
				new CompositionEvent("compositionend", {
					bubbles: true,
					data: "中",
				}),
			);
			await act(async () => {
				await Promise.resolve();
			});

			expect(current.canonical()).toBe(initialMarkdown);
			expect(current.documentChanges).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(
				"visual-editor-code-body-selection-invalid",
			);
			expect(onDiagnostic).not.toHaveBeenCalled();
			const restoredCode = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"] > code`,
			);
			if (!(restoredCode instanceof HTMLElement)) {
				throw new Error("windowed-ime-rejected-restored-code-missing");
			}
			expect(restoredCode.textContent).toBe("");

			const validText = document.createTextNode("A");
			const validBeforeInput = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "A",
				inputType: "insertText",
			});
			const validStart = document.createRange();
			validStart.setStart(restoredCode, 0);
			validStart.collapse(true);
			selection?.removeAllRanges();
			selection?.addRange(validStart);
			current.surface.dispatchEvent(validBeforeInput);
			expect(validBeforeInput.defaultPrevented).toBe(false);
			restoredCode.replaceChildren(validText);
			placeCaret(validText, validText.length);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: "A",
					inputType: "insertText",
				}),
			);

			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(onFailure).toHaveBeenCalledOnce();
			const acceptedFence = initialFence.includes("js")
				? "~~~js\nA\n~~~"
				: "~~~\nA\n~~~";
			expect(current.canonical()).toBe(
				initialMarkdown.slice(0, initialStart) +
					acceptedFence +
					initialMarkdown.slice(initialStart + initialFence.length),
			);
			view.unmount();
		},
	);

	it("restores a noncancelable mutation when an open fence slice stops before canonical EOF", async () => {
		const blockIndex = 160;
		const initialFence = "~~~js\n";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"></code></pre>`,
			},
			mounted: [159, blockIndex, 161],
			paragraphBlocks: true,
		});
		const initialMarkdown = current.canonical();
		const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
			initialMarkdown,
			current.editMap,
			{ end: blockIndex + 1, start: blockIndex },
		);
		const sourceSlice = initialMarkdown.slice(
			sourceRange.start,
			sourceRange.end,
		);
		expect(sourceRange.end).toBeLessThan(initialMarkdown.length);
		expect(sourceSlice.match(/\n*$/u)?.[0].length).toBe(2);

		const onFailure = vi.fn();
		const { view } = renderWindowEditor(current, { onFailure });
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const code = pre?.querySelector(":scope > code");
		if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
			throw new Error("windowed-partial-open-fence-code-missing");
		}
		// An opening-only row cannot prove a complete canonical interval, so it
		// must not claim EOF ownership.
		expect(pre.hasAttribute("data-easymde-visual-fence-open-eof")).toBe(false);
		const initialHtml = current.surface.innerHTML;
		const selectionRange = document.createRange();
		selectionRange.setStart(code, 0);
		selectionRange.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(selectionRange);

		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
		);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-open-fence-source-range-invalid",
		);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			data: "中",
			inputType: "insertCompositionText",
			isComposing: true,
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		code.replaceChildren(document.createTextNode("中"));
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "中",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "中",
			}),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(current.surface.innerHTML).toBe(initialHtml);
		expect(pre.hasAttribute("data-easymde-visual-fence-open-eof")).toBe(false);
		expect(onFailure).toHaveBeenCalledOnce();
		view.unmount();
	});

	it("rejects an exact parent-anchored deletion when an open fence slice stops before canonical EOF", () => {
		const blockIndex = 160;
		const initialFence = "~~~js\n";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"></code></pre>`,
			},
			mounted: [159, blockIndex, 161],
			paragraphBlocks: true,
		});
		const initialMarkdown = current.canonical();
		const initialHistory = current.documentSession.document.getHistoryState();
		const initialSelection = current.documentSession.document.getSelection();
		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "unexpected-preview");
		const { view } = renderWindowEditor(current, { onFailure, requestPreview });
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(pre instanceof HTMLElement)) {
			throw new Error("windowed-partial-open-fence-missing");
		}
		expect(pre.hasAttribute("data-easymde-visual-fence-open-eof")).toBe(false);
		const initialHtml = current.surface.innerHTML;

		const range = document.createRange();
		range.selectNode(pre);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-window-selection-invalid",
		);
		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(current.applyTextChange).not.toHaveBeenCalled();
		expect(current.documentSession.document.getHistoryState()).toEqual(initialHistory);
		expect(current.documentSession.document.getSelection()).toEqual(initialSelection);
		expect(requestPreview).not.toHaveBeenCalled();
		expect(current.surface.innerHTML).toBe(initialHtml);
		view.unmount();
	});

	it("deletes a closed middle fence through exact parent-anchored selectNode(pre) and projects selection to the next surviving editable block", () => {
		const blockIndex = 160;
		const initialFence = "~~~js\nconsole.log(1);\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">console.log(1);\n</code></pre>`,
			},
			mounted: [159, blockIndex, 161],
			paragraphBlocks: true,
		});
		const initialMarkdown = current.canonical();
		const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
			initialMarkdown,
			current.editMap,
			{ end: blockIndex + 1, start: blockIndex },
		);
		const expectedMarkdown =
			initialMarkdown.slice(0, sourceRange.start) +
			initialMarkdown.slice(sourceRange.end);
		const nextBlockIndex = 161;
		const nextBlockRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
			initialMarkdown,
			current.editMap,
			{ end: nextBlockIndex + 1, start: nextBlockIndex },
		);
		const removedLength = sourceRange.end - sourceRange.start;
		const nextBlockExpectedStart = nextBlockRange.start - removedLength;
		expect(sourceRange.start).not.toBe(nextBlockExpectedStart);
		expect(
			expectedMarkdown.slice(sourceRange.start, nextBlockExpectedStart),
		).toMatch(/^\n+$/);

		const onFailure = vi.fn();
		const requestPreview = vi.fn(() => "preview-after-middle-fence-delete");
		const onMarkdownChange = vi.fn();
		const { view } = renderWindowEditor(current, {
			onFailure,
			onMarkdownChange,
			requestPreview,
		});
		const pre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(pre instanceof HTMLElement)) {
			throw new Error("windowed-middle-fence-pre-missing");
		}

		const range = document.createRange();
		range.selectNode(pre);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "deleteContentBackward",
		});
		current.surface.dispatchEvent(beforeInput);

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(onFailure).not.toHaveBeenCalled();
		expect(current.canonical()).toBe(expectedMarkdown);
		expect(current.documentChanges).toHaveBeenCalledOnce();
		expect(onMarkdownChange).toHaveBeenCalledOnce();
		expect(current.documentSession.document.getSelection()).toEqual({
			direction: "none",
			end: nextBlockExpectedStart,
			start: nextBlockExpectedStart,
		});
		expect(current.applyTextChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				changes: { from: sourceRange.start, insert: "", to: sourceRange.end },
				selection: {
					direction: "none",
					end: nextBlockExpectedStart,
					start: nextBlockExpectedStart,
				},
				value: expectedMarkdown,
			}),
		);
		expect(requestPreview).toHaveBeenCalledWith(expectedMarkdown);
		view.unmount();
	});

	it("rejects a noncancelable IME mutation when the source selection is outside CODE", async () => {
		const blockIndex = 160;
		const initialFence = "~~~js\n\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"></code></pre>`,
			},
			mounted: [159, blockIndex, 161],
			paragraphBlocks: true,
		});
		const onDiagnostic = vi.fn();
		const { onFailure, view } = renderWindowEditor(current, { onDiagnostic });
		const pre = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		const code = pre?.querySelector(":scope > code");
		if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
			throw new Error("windowed-ime-map-invalid-code-missing");
		}
		const initialMarkdown = current.canonical();
		const initialHtml = current.surface.innerHTML;
		const selectionRange = document.createRange();
		selectionRange.setStart(pre, 0);
		selectionRange.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(selectionRange);

		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", {
				bubbles: true,
				data: "",
			}),
		);

		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-code-body-selection-invalid",
		);
		expect(onDiagnostic).not.toHaveBeenCalled();

		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			data: "中",
			inputType: "insertCompositionText",
			isComposing: true,
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);
		code.replaceChildren(document.createTextNode("中"));
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "中",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "中",
			}),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		expect(current.surface.innerHTML).toBe(initialHtml);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onDiagnostic).not.toHaveBeenCalled();
		view.unmount();
	});

	it("restores a newly mounted js fence before projecting its terminal-LF code body", async () => {
		const blockIndex = 160;
		const initialFence = "~~~js\n\n~~~";
		const current = fixture({
			blockOverrides: { [blockIndex]: initialFence },
			markupOverrides: {
				[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">\n</code></pre>`,
			},
			mounted: [159, blockIndex, 161],
			paragraphBlocks: true,
		});
		current.surface.tabIndex = 0;
		current.surface.setAttribute("contenteditable", "true");
		const initialMarkdown = current.canonical();
		const initialStart = initialMarkdown.indexOf(initialFence);
		if (initialStart < 0)
			throw new Error("windowed-terminal-lf-source-missing");
		const historyValues: ReadonlyArray<
			Readonly<{
				markdown: string;
				selection: DocumentSelection;
			}>
		> = [
			{
				markdown: initialMarkdown,
				selection: {
					direction: "none",
					end: initialStart + "~~~js\n".length,
					start: initialStart + "~~~js\n".length,
				},
			},
		];
		let mutableHistoryValues = [...historyValues];
		let historyIndex = 0;
		let documentSelection = historyValues[0]?.selection;
		if (!documentSelection)
			throw new Error("windowed-history-selection-missing");
		const undo = vi.fn(() => {
			if (historyIndex < 1) return false;
			historyIndex -= 1;
			const state = mutableHistoryValues[historyIndex];
			if (!state) throw new Error("windowed-history-undo-state-missing");
			current.setCanonical(state.markdown);
			documentSelection = state.selection;
			return true;
		});
		const redo = vi.fn(() => {
			if (historyIndex + 1 >= mutableHistoryValues.length) return false;
			historyIndex += 1;
			const state = mutableHistoryValues[historyIndex];
			if (!state) throw new Error("windowed-history-redo-state-missing");
			current.setCanonical(state.markdown);
			documentSelection = state.selection;
			return true;
		});
		Object.assign(current.documentSession.document, {
			getSelection: () => documentSelection,
			redo,
			undo,
		});

		const onDiagnostic = vi.fn();
		const onFailure = vi.fn();
		const previewRequests: string[] = [];
		const requestPreview = vi.fn((markdown: string) => {
			previewRequests.push(markdown);
			return `code-history-${previewRequests.length}`;
		});
		const componentProps = {
			documentSession: current.documentSession,
			editMap: current.editMap,
			imagePasteUploadEnabled: false,
			imageUploadEnabled: false,
			onCanonicalDocumentChange: vi.fn(),
			onDiagnostic,
			onDispose: vi.fn(),
			onFailure,
			onMarkdownChange: vi.fn(),
			onPendingChange: vi.fn(),
			onReady: vi.fn(),
			onTransferFailure: vi.fn(),
			pending: false,
			prepareWindowBlockAdoption: testPrepareWindowBlockAdoption,
			retainCompositionSurface: testRetainCompositionSurface,
			previewSnapshot: { revision: 1, signature: "windowed" },
			previewStatus: "ready" as const,
			requestPreview,
			requestPreviewAtDocumentEnd:
				testDocumentEndPreviewRequestUsing(requestPreview),
			surface: current.surface,
		};
		const view = render(<WindowedImmersiveVisualEditor {...componentProps} />);
		const oldPre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!(oldPre instanceof HTMLElement)) {
			throw new Error("windowed-terminal-lf-pre-missing");
		}
		const pre = document.createElement("pre");
		pre.setAttribute("data-easymde-visual-block-id", `b${blockIndex}`);
		const style = oldPre.getAttribute("style");
		if (null !== style) pre.setAttribute("style", style);
		const code = document.createElement("code");
		code.className = "language-js";
		code.textContent = "\n";
		pre.append(code);
		oldPre.replaceWith(pre);

		const selectionRange = document.createRange();
		selectionRange.setStart(pre, 0);
		selectionRange.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(selectionRange);

		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", {
				bubbles: true,
				data: "",
			}),
		);

		const acceptedHtml = current.surface.innerHTML;
		expect(pre.getAttribute("data-easymde-visual-fence")).toBe("~~~");
		expect(pre.getAttribute("data-easymde-visual-fence-info")).toBe("js");
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-code-body-selection-invalid",
		);
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(current.canonical()).toBe(initialMarkdown);

		const beforeCompositionInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: false,
			data: "中",
			inputType: "insertCompositionText",
			isComposing: true,
		});
		current.surface.dispatchEvent(beforeCompositionInput);
		expect(beforeCompositionInput.defaultPrevented).toBe(false);
		const compositionText = document.createTextNode("中");
		code.replaceChildren(compositionText);
		placeCaret(compositionText, compositionText.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "中",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "中",
			}),
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(current.surface.innerHTML).toBe(acceptedHtml);
		expect(current.canonical()).toBe(initialMarkdown);
		expect(current.documentChanges).not.toHaveBeenCalled();
		const restoredPre = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		const restoredCode = restoredPre?.querySelector(":scope > code");
		const restoredText = restoredCode?.firstChild;
		if (
			restoredPre !== pre ||
			!(restoredCode instanceof HTMLElement) ||
			!(restoredText instanceof Text)
		)
			throw new Error("windowed-terminal-lf-restoration-invalid");
		expect(restoredCode.textContent).toBe("\n");
		expect(restoredPre.getAttribute("data-easymde-visual-fence")).toBe("~~~");
		expect(restoredPre.getAttribute("data-easymde-visual-fence-info")).toBe(
			"js",
		);
		expect(window.getSelection()?.anchorNode).toBe(restoredPre);
		expect(window.getSelection()?.anchorOffset).toBe(0);

		const afterA =
			initialMarkdown.slice(0, initialStart) +
			"~~~js\nA\n~~~" +
			initialMarkdown.slice(initialStart + initialFence.length);
		const rememberCurrentHistoryState = () => {
			const change = current.documentChanges.mock.lastCall?.[0];
			if (!change) throw new Error("windowed-history-edit-selection-missing");
			mutableHistoryValues = mutableHistoryValues.slice(0, historyIndex + 1);
			mutableHistoryValues.push({
				markdown: current.canonical(),
				selection: change.selection,
			});
			historyIndex = mutableHistoryValues.length - 1;
			documentSelection = change.selection;
		};
		placeCaret(restoredText, 0);
		const characterBeforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "A",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(characterBeforeInput);
		expect(characterBeforeInput.defaultPrevented).toBe(false);
		restoredText.insertData(0, "A");
		placeCaret(restoredText, 1);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "A",
				inputType: "insertText",
			}),
		);
		expect(current.canonical()).toBe(afterA);
		rememberCurrentHistoryState();

		const codeAfterA = restoredPre.querySelector(":scope > code");
		const textAfterA = codeAfterA?.firstChild;
		if (!(codeAfterA instanceof HTMLElement) || !(textAfterA instanceof Text)) {
			throw new Error("windowed-terminal-lf-after-character-missing");
		}
		placeCaret(textAfterA, 1);
		const enterBeforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "insertParagraph",
		});
		current.surface.dispatchEvent(enterBeforeInput);
		expect(enterBeforeInput.defaultPrevented).toBe(false);
		const firstLine = document.createElement("code");
		firstLine.className = "language-js";
		firstLine.textContent = "A";
		const secondLine = document.createElement("code");
		secondLine.className = "language-js";
		secondLine.textContent = "\n";
		restoredPre.replaceChildren(firstLine, secondLine);
		const secondLineText = secondLine.firstChild;
		if (!(secondLineText instanceof Text)) {
			throw new Error("windowed-terminal-lf-enter-split-missing");
		}
		placeCaret(secondLineText, 0);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertParagraph",
			}),
		);
		const afterEnter =
			initialMarkdown.slice(0, initialStart) +
			"~~~js\nA\n\n~~~" +
			initialMarkdown.slice(initialStart + initialFence.length);
		expect(current.canonical()).toBe(afterEnter);
		rememberCurrentHistoryState();

		const codeAfterEnter = restoredPre.querySelector(":scope > code");
		const textAfterEnter = codeAfterEnter?.firstChild;
		if (
			!(codeAfterEnter instanceof HTMLElement) ||
			!(textAfterEnter instanceof Text)
		) {
			throw new Error("windowed-terminal-lf-after-enter-missing");
		}
		placeCaret(textAfterEnter, 2);
		const nextCharacterBeforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "X",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(nextCharacterBeforeInput);
		expect(nextCharacterBeforeInput.defaultPrevented).toBe(false);
		textAfterEnter.insertData(2, "X");
		placeCaret(textAfterEnter, 3);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "X",
				inputType: "insertText",
			}),
		);
		const afterX =
			initialMarkdown.slice(0, initialStart) +
			"~~~js\nA\nX\n~~~" +
			initialMarkdown.slice(initialStart + initialFence.length);
		expect(current.canonical()).toBe(afterX);
		expect(current.documentChanges).toHaveBeenCalledTimes(3);
		rememberCurrentHistoryState();

		const editMapForBody = (
			body: string,
			signature: string,
		): PreviewEditMap => {
			const codeFence = `~~~js\n${body}~~~`;
			const lineDelta =
				codeFence.split(/\r?\n/).length - initialFence.split(/\r?\n/).length;
			return {
				...current.editMap,
				blocks: current.editMap.blocks.map((block, index) => ({
					...block,
					endLine: block.endLine + (index >= blockIndex ? lineDelta : 0),
					startLine: block.startLine + (index > blockIndex ? lineDelta : 0),
				})),
				signature,
			};
		};
		const settleHistoryPreview = (
			markdown: string,
			body: string,
			revision: number,
			keepSurfaceFocused = true,
			expectedOffset?: number | null,
		) => {
			const signature = `code-history-${previewRequests.length}`;
			const activePre = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"]`,
			);
			if (!(activePre instanceof HTMLElement)) {
				throw new Error("windowed-terminal-lf-history-preview-code-missing");
			}
			const adoptedPre = document.createElement("pre");
			adoptedPre.setAttribute("data-easymde-visual-block-id", `b${blockIndex}`);
			const adoptedCode = document.createElement("code");
			adoptedCode.className = "language-js";
			adoptedCode.textContent = body;
			adoptedPre.append(adoptedCode);
			activePre.replaceWith(adoptedPre);
			const selection =
				current.surface.ownerDocument.defaultView?.getSelection();
			if (!selection) throw new Error("windowed-history-dom-selection-missing");
			selection.removeAllRanges();
			if (keepSurfaceFocused) current.surface.focus();
			selection.setBaseAndExtent(current.surface, 0, current.surface, 0);
			act(() => {
				view.rerender(
					<WindowedImmersiveVisualEditor
						{...componentProps}
						editMap={editMapForBody(body, signature)}
						previewSnapshot={{ revision, signature }}
					/>,
				);
			});
			expect(current.canonical()).toBe(markdown);
			const adoptedCodeAfterCommit = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"] > code`,
			);
			const restoredSelection =
				current.surface.ownerDocument.defaultView?.getSelection();
			const restoredAnchor = restoredSelection?.anchorNode ?? null;
			const restoredOffset = (() => {
				if (
					!(adoptedCodeAfterCommit instanceof HTMLElement) ||
					!restoredSelection?.isCollapsed ||
					!restoredAnchor ||
					(restoredAnchor !== adoptedCodeAfterCommit &&
						!adoptedCodeAfterCommit.contains(restoredAnchor))
				)
					return null;
				const range = current.surface.ownerDocument.createRange();
				range.selectNodeContents(adoptedCodeAfterCommit);
				range.setEnd(restoredAnchor, restoredSelection.anchorOffset);
				return range.toString().length;
			})();
			expect(onFailure.mock.calls.map(([code]) => code)).toEqual([
				"visual-editor-code-body-selection-invalid",
			]);
			expect(onDiagnostic).not.toHaveBeenCalled();
			const expectedCaretOffset =
				undefined === expectedOffset
					? body === "A\nX\n"
						? 3
						: "A\n\n" === body
							? 2
							: 1
					: expectedOffset;
			expect(restoredOffset).toBe(expectedCaretOffset);
		};
		const dispatchHistory = (inputType: "historyRedo" | "historyUndo") => {
			expect(current.surface.ownerDocument.activeElement).toBe(current.surface);
			const event = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType,
			});
			current.surface.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		};

		dispatchHistory("historyUndo");
		expect(undo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(afterEnter);
		const afterEnterCaret =
			afterEnter.indexOf("~~~js\nA\n\n~~~") + "~~~js\n".length + 2;
		expect(documentSelection).toEqual({
			direction: "none",
			end: afterEnterCaret,
			start: afterEnterCaret,
		});
		settleHistoryPreview(afterEnter, "A\n\n", 2);
		dispatchHistory("historyUndo");
		expect(undo).toHaveBeenCalledTimes(2);
		expect(current.canonical()).toBe(afterA);
		settleHistoryPreview(afterA, "A\n", 3);
		dispatchHistory("historyRedo");
		expect(redo).toHaveBeenCalledOnce();
		expect(current.canonical()).toBe(afterEnter);
		settleHistoryPreview(afterEnter, "A\n\n", 4);
		dispatchHistory("historyRedo");
		expect(redo).toHaveBeenCalledTimes(2);
		expect(current.canonical()).toBe(afterX);
		settleHistoryPreview(afterX, "A\nX\n", 5);
		expect(requestPreview).toHaveBeenNthCalledWith(1, afterEnter);
		expect(requestPreview).toHaveBeenNthCalledWith(2, afterA);
		expect(requestPreview).toHaveBeenNthCalledWith(3, afterEnter);
		expect(requestPreview).toHaveBeenNthCalledWith(4, afterX);
		expect(current.documentChanges).toHaveBeenCalledTimes(3);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(
			"visual-editor-code-body-selection-invalid",
		);
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(restoredPre.getAttribute("data-easymde-visual-fence")).toBe("~~~");
		expect(restoredPre.getAttribute("data-easymde-visual-fence-info")).toBe(
			"js",
		);

		const focusOutsideEditor = document.createElement("button");
		document.body.append(focusOutsideEditor);
		dispatchHistory("historyUndo");
		expect(current.canonical()).toBe(afterEnter);
		focusOutsideEditor.focus();
		settleHistoryPreview(afterEnter, "A\n\n", 6, false, null);
		expect(document.activeElement).toBe(focusOutsideEditor);
		focusOutsideEditor.remove();
		view.unmount();
	});

	it("commits one canonical transaction after IME composition ends", async () => {
		const current = fixture();
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={vi.fn()}
				onMarkdownChange={vi.fn()}
				onPendingChange={vi.fn()}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending={false}
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="ready"
				requestPreview={vi.fn(() => "next")}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest("next")}
				surface={current.surface}
			/>,
		);
		const text = current.surface.querySelector("p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-text-missing");
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", {
				bubbles: true,
			}),
		);
		text.data += "输入";
		placeCaret(text, text.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "输入",
				inputType: "insertCompositionText",
				isComposing: true,
			}),
		);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "输入",
			}),
		);
		await Promise.resolve();

		expect(current.canonical().split("\n")[160]).toBe("Line 160输入");
		expect(current.documentChanges).toHaveBeenCalledOnce();
		view.unmount();
	});

	it.each(["~~~", "```"])(
		"preserves the structural code newline after %s composition in a shifted block",
		async (fence) => {
			const blockIndex = 160;
			const initialFence = `${fence}\n${fence}`;
			const current = fixture({
				blockOverrides: { [blockIndex]: initialFence },
				markupOverrides: {
					[blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code></code></pre>`,
				},
				mounted: [blockIndex],
			});
			const onFailure = vi.fn();
			const requestPreview = vi.fn(() => "unused-composition-preview");
			const { view } = renderWindowEditor(current, {
				onFailure,
				requestPreview,
			});
			const code = current.surface.querySelector<HTMLElement>(
				`[data-easymde-visual-block-id="b${blockIndex}"] > code`,
			);
			if (!(code instanceof HTMLElement)) {
				throw new Error("windowed-ime-code-body-missing");
			}
			const initialMarkdown = current.canonical();
			const initialStart = initialMarkdown.indexOf(initialFence);
			if (initialStart < 0) throw new Error("windowed-ime-code-source-missing");
			const startRange = document.createRange();
			startRange.setStart(code, 0);
			startRange.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(startRange);

			current.surface.dispatchEvent(
				new CompositionEvent("compositionstart", {
					bubbles: true,
					data: "",
				}),
			);
			current.surface.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					data: "中",
					inputType: "insertCompositionText",
					isComposing: true,
				}),
			);
			const text = document.createTextNode("中");
			code.replaceChildren(text);
			placeCaret(text, text.length);
			current.surface.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: "中",
					inputType: "insertCompositionText",
					isComposing: true,
				}),
			);
			current.surface.dispatchEvent(
				new CompositionEvent("compositionend", {
					bubbles: true,
					data: "中",
				}),
			);
			await act(async () => {
				await Promise.resolve();
			});

			const expectedFence = `${fence}\n中\n${fence}`;
			expect(current.canonical()).toBe(
				initialMarkdown.slice(0, initialStart) +
					expectedFence +
					initialMarkdown.slice(initialStart + initialFence.length),
			);
			expect(code.textContent).toBe("中\n");
			expect(code.firstChild).toBe(text);
			expect(window.getSelection()?.anchorNode).toBe(text);
			expect(window.getSelection()?.anchorOffset).toBe(1);
			expect(current.documentChanges).toHaveBeenCalledOnce();
			expect(requestPreview).not.toHaveBeenCalled();
			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		},
	);

	it("routes browser history Undo to the CodeMirror owner and requests formal Preview", () => {
		const current = fixture();
		const previous = current.canonical().replace("Line 160", "Line 16");
		const undo = vi.fn(() => {
			current.setCanonical(previous);
			return true;
		});
		Object.assign(current.documentSession.document, { undo });
		const requestPreview = vi.fn(() => "undo-signature");
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={vi.fn()}
				onMarkdownChange={vi.fn()}
				onPendingChange={vi.fn()}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending={false}
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="ready"
				requestPreview={requestPreview}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(
					requestPreview,
				)}
				surface={current.surface}
			/>,
		);
		const history = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "historyUndo",
		});
		current.surface.dispatchEvent(history);

		expect(history.defaultPrevented).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		expect(requestPreview).toHaveBeenCalledWith(previous);
		view.unmount();
	});

	it.each([
		{ key: "z", metaKey: false, ctrlKey: true },
		{ key: "Z", metaKey: true, ctrlKey: false },
	])(
		"routes $key keyboard Undo to CodeMirror history",
		({ key, metaKey, ctrlKey }) => {
			const current = fixture();
			const previous = current.canonical().replace("Line 160", "Line 16");
			const undo = vi.fn(() => {
				current.setCanonical(previous);
				return true;
			});
			Object.assign(current.documentSession.document, { undo });
			const requestPreview = vi.fn(() => "undo-signature");
			const view = render(
				<WindowedImmersiveVisualEditor
					documentSession={current.documentSession}
					editMap={current.editMap}
					imagePasteUploadEnabled={false}
					imageUploadEnabled={false}
					onCanonicalDocumentChange={vi.fn()}
					onDiagnostic={vi.fn()}
					onDispose={vi.fn()}
					onFailure={vi.fn()}
					onMarkdownChange={vi.fn()}
					onPendingChange={vi.fn()}
					onReady={vi.fn()}
					prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
					retainCompositionSurface={testRetainCompositionSurface}
					onTransferFailure={vi.fn()}
					pending={false}
					previewSnapshot={{ revision: 1, signature: "windowed" }}
					previewStatus="ready"
					requestPreview={requestPreview}
					requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(
						requestPreview,
					)}
					surface={current.surface}
				/>,
			);
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey,
				key,
				metaKey,
			});
			current.surface.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
			expect(undo).toHaveBeenCalledOnce();
			expect(requestPreview).toHaveBeenCalledWith(previous);
			view.unmount();
		},
	);

	it.each([
		{ key: "z", shiftKey: true },
		{ key: "y", shiftKey: false },
	])(
		"routes Control+$key keyboard Redo to CodeMirror history",
		({ key, shiftKey }) => {
			const current = fixture();
			const next = current.canonical().replace("Line 160", "Line 160 redone");
			const redo = vi.fn(() => {
				current.setCanonical(next);
				return true;
			});
			Object.assign(current.documentSession.document, { redo });
			const requestPreview = vi.fn(() => "redo-signature");
			const view = render(
				<WindowedImmersiveVisualEditor
					documentSession={current.documentSession}
					editMap={current.editMap}
					imagePasteUploadEnabled={false}
					imageUploadEnabled={false}
					onCanonicalDocumentChange={vi.fn()}
					onDiagnostic={vi.fn()}
					onDispose={vi.fn()}
					onFailure={vi.fn()}
					onMarkdownChange={vi.fn()}
					onPendingChange={vi.fn()}
					onReady={vi.fn()}
					prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
					retainCompositionSurface={testRetainCompositionSurface}
					onTransferFailure={vi.fn()}
					pending={false}
					previewSnapshot={{ revision: 1, signature: "windowed" }}
					previewStatus="ready"
					requestPreview={requestPreview}
					requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(
						requestPreview,
					)}
					surface={current.surface}
				/>,
			);
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key,
				shiftKey,
			});
			current.surface.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
			expect(redo).toHaveBeenCalledOnce();
			expect(requestPreview).toHaveBeenCalledWith(next);
			view.unmount();
		},
	);

	it("claims native keyboard history while a formal Preview is pending", () => {
		const current = fixture();
		const view = render(
			<WindowedImmersiveVisualEditor
				documentSession={current.documentSession}
				editMap={current.editMap}
				imagePasteUploadEnabled={false}
				imageUploadEnabled={false}
				onCanonicalDocumentChange={vi.fn()}
				onDiagnostic={vi.fn()}
				onDispose={vi.fn()}
				onFailure={vi.fn()}
				onMarkdownChange={vi.fn()}
				onPendingChange={vi.fn()}
				onReady={vi.fn()}
				prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
				retainCompositionSurface={testRetainCompositionSurface}
				onTransferFailure={vi.fn()}
				pending
				previewSnapshot={{ revision: 1, signature: "windowed" }}
				previewStatus="loading"
				requestPreview={vi.fn(() => "next")}
				requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest("next")}
				surface={current.surface}
			/>,
		);
		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
			key: "y",
		});
		current.surface.dispatchEvent(event);

		// The canonical history owner claims the shortcut even while a formal
		// Preview is in flight, so Undo/Redo is never invisible; the pending
		// request is reconciled by the history path instead of dropped here.
		expect(event.defaultPrevented).toBe(true);
		expect(current.documentSession.document.redo).toHaveBeenCalled();
		view.unmount();
	});

	it.each(["Control", "Shift", "Alt", "Meta", "ArrowDown"])(
		"ignores the %s key without requiring an active editable Block",
		(key) => {
			const current = fixture();
			const onFailure = vi.fn();
			const view = render(
				<WindowedImmersiveVisualEditor
					documentSession={current.documentSession}
					editMap={current.editMap}
					imagePasteUploadEnabled={false}
					imageUploadEnabled={false}
					onCanonicalDocumentChange={vi.fn()}
					onDiagnostic={vi.fn()}
					onDispose={vi.fn()}
					onFailure={onFailure}
					onMarkdownChange={vi.fn()}
					onPendingChange={vi.fn()}
					onReady={vi.fn()}
					prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
					retainCompositionSurface={testRetainCompositionSurface}
					onTransferFailure={vi.fn()}
					pending={false}
					previewSnapshot={{ revision: 1, signature: "windowed" }}
					previewStatus="ready"
					requestPreview={vi.fn(() => "next")}
					requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest("next")}
					surface={current.surface}
				/>,
			);
			window.getSelection()?.removeAllRanges();
			current.surface.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key,
				}),
			);

			expect(onFailure).not.toHaveBeenCalled();
			view.unmount();
		},
	);
});

describe("Windowed context-menu target lease", () => {
	function targetFixture(): Readonly<{
		current: ReturnType<typeof fixture>;
		runtime: () => ImmersiveVisualEditorRuntime;
		surface: HTMLElement;
		unmount: () => void;
	}> {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const current = fixture({
			blockOverrides: { [blockIndex]: `Before ${imageMarkdown}` },
			markupOverrides: {
				[blockIndex]:
					`<p data-easymde-visual-block-id="b${blockIndex}">Before `
					+ '<img alt="alt" src="https://example.test/image.png"></p>',
			},
			mounted: [blockIndex],
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		const surface = current.surface;
		return {
			current,
			runtime: () => {
				if (!runtime) throw new Error("windowed-lease-runtime-missing");
				return runtime;
			},
			surface,
			unmount: () => {
				rendered.view.unmount();
				if (surface.isConnected) surface.remove();
			},
		};
	}

	it("binds the exact live target without writing the document", () => {
		const { current, runtime, surface, unmount } = targetFixture();
		const image = surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		const canonicalBefore = current.canonical();
		const writesBefore = current.applyTextChange.mock.calls.length;

		const lease = runtime().captureContextMenuTarget(image);
		expect(lease).not.toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writesBefore);
		expect(current.canonical()).toBe(canonicalBefore);
		expect(lease?.resolve()).toBe(image);

		lease?.release();
		// Release is terminal and idempotent: the block is still mounted, yet
		// the retired demand no longer has a target.
		expect(lease?.resolve()).toBeNull();
		expect(() => lease?.release()).not.toThrow();
		unmount();
	});

	it("captures and resolves a pointed block while another block changed", () => {
		const current = fixture({
			blockOverrides: { 160: "Pointed", 161: "Neighbour" },
			mounted: [160, 161],
			markupOverrides: {
				160:
					'<p data-easymde-visual-block-id="b160">Pointed '
					+ '<img alt="alt" src="https://example.test/image.png"></p>',
				161: '<p data-easymde-visual-block-id="b161">Neighbour</p>',
			},
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const surface = current.surface;
		const image = surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		// A different mounted root is rewritten by a legally accepted render
		// (enhancement, materialization, a scroll-driven window commit). The
		// pointed block is untouched, so the gesture still owns its own row.
		const neighbour = surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b161"]',
		);
		if (!neighbour) throw new Error("windowed-lease-neighbour-missing");
		neighbour.textContent = "Enhancement rendered elsewhere";
		const writes = current.applyTextChange.mock.calls.length;
		const canonical = current.canonical();

		const root = runtime as ImmersiveVisualEditorRuntime;
		const lease = root.captureContextMenuTarget(image);
		if (!lease) throw new Error("windowed-lease-not-issued");
		expect(lease.resolve()).toBe(image);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		expect(current.canonical()).toBe(canonical);

		// The same proof still refuses a target whose OWN block was rewritten:
		// a foreign change is never laundered into another block's authority.
		const imageBlock = image.closest<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!imageBlock) throw new Error("windowed-lease-block-missing");
		imageBlock.append("foreign");
		expect(lease.resolve()).toBeNull();
		expect(root.captureContextMenuTarget(image)).toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		lease.release();
		expect(lease.resolve()).toBeNull();
		rendered.view.unmount();
		surface.remove();
	});

	it("refuses a surface witness once the accepted child list was mutated", () => {
		const { runtime, surface, unmount } = targetFixture();
		expect(runtime().captureContextMenuTarget(surface)).not.toBeNull();
		// A same-id replacement is not a new accepted render: the owner never
		// installed this node, so the surface no longer describes the document
		// it accepted and a whole-surface gesture is refused rather than being
		// prepared against rows that no longer describe the mounted DOM.
		const imageBlock = surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!imageBlock) throw new Error("windowed-lease-block-missing");
		imageBlock.replaceWith(imageBlock.cloneNode(true));
		expect(runtime().captureContextMenuTarget(surface)).toBeNull();
		expect(runtime().captureContextMenuTarget(surface.querySelector("img")))
			.toBeNull();
		unmount();
	});

	it("refuses the demand preflight while the accepted DOM describes another source", () => {
		const blockIndex = 160;
		const current = fixture({ mounted: [blockIndex] });
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		expect(root.prepareContextMenuDemand()).toBe(true);
		// A committed canonical write whose accepted render has not arrived: the
		// mounted DOM still describes the previous revision, so no demand can be
		// attributed to it yet. The gesture ends here, before any capture.
		const before = current.canonical();
		current.setCanonical(`${before}\n\nPending`);
		expect(root.prepareContextMenuDemand()).toBe(false);
		expect(root.captureContextMenuTarget(current.surface)).toBeNull();
		// Nothing was written, and the refusal is not a failure report.
		expect(current.canonical()).toBe(`${before}\n\nPending`);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("captures the surface root for a keyboard activation and never a spacer", () => {
		const blockIndex = 160;
		const current = fixture({
			mounted: [blockIndex],
			sourceBlockCount: 320,
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const lease = root.captureContextMenuTarget(current.surface);
		expect(lease?.resolve()).toBe(current.surface);
		const spacer = current.surface.querySelector(
			"[data-easymde-preview-window-spacer]",
		);
		if (!(spacer instanceof HTMLElement)) {
			throw new Error("windowed-lease-spacer-missing");
		}
		expect(root.captureContextMenuTarget(spacer)).toBeNull();
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses detached, foreign, and unattributable targets", () => {
		const { runtime, surface, unmount } = targetFixture();
		const detached = document.createElement("img");
		detached.setAttribute("alt", "alt");
		detached.setAttribute("src", "https://example.test/image.png");
		const otherSurface = document.createElement("article");
		otherSurface.innerHTML =
			'<p data-easymde-visual-block-id="b160">Before '
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		document.body.append(otherSurface);
		const foreignImage = otherSurface.querySelector("img");
		const loose = document.createElement("span");
		surface.append(loose);

		expect(runtime().captureContextMenuTarget(detached)).toBeNull();
		expect(runtime().captureContextMenuTarget(foreignImage)).toBeNull();
		expect(runtime().captureContextMenuTarget(loose)).toBeNull();
		expect(runtime().captureContextMenuTarget(null)).toBeNull();
		otherSurface.remove();
		unmount();
	});

	it("retires the lease when an accepted source change reuses the block id", () => {
		const { current, runtime, surface, unmount } = targetFixture();
		const image = surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		const lease = runtime().captureContextMenuTarget(image);
		expect(lease).not.toBeNull();
		const writes = current.applyTextChange.mock.calls.length;
		// A foreign canonical write reuses the label for a different block.
		current.setCanonical(`${current.canonical()}\n\nReplaced`);
		expect(lease?.resolve()).toBeNull();
		// Resolution itself never writes canonical content or history.
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		unmount();
	});

	it("refuses capture while a foreign canonical write stands", () => {
		const { current, runtime, surface, unmount } = targetFixture();
		current.setCanonical(`${current.canonical()}\n\nForeign`);
		expect(runtime().captureContextMenuTarget(surface.querySelector("img")))
			.toBeNull();
		unmount();
	});

	it("refuses the demand preflight during an unsettled native input", async () => {
		const blockIndex = 160;
		const current = fixture({ mounted: [blockIndex] });
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		expect(root.prepareContextMenuDemand()).toBe(true);

		const text = current.surface.querySelector("p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("windowed-lease-text-missing");
		// compositionstart owns a draft only from this surface's authenticated
		// caret; without one the owner rejects the composition and never enters
		// the state this preflight must refuse.
		placeCaret(text, text.length);
		// An IME draft belongs to the browser until compositionend publishes it.
		current.surface.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);
		expect(root.prepareContextMenuDemand()).toBe(false);
		current.surface.dispatchEvent(
			new CompositionEvent("compositionend", { data: "" }),
		);
		await act(async () => {
			await Promise.resolve();
		});
		// Once the draft is settled the ordinary preflight resumes.
		expect(root.prepareContextMenuDemand()).toBe(true);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("resolves a registered same-source replacement through the lease API", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: `Before ${imageMarkdown}` },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure: (code: string) => failures.push(code),
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const originalImage = current.surface.querySelector("img");
		if (!(originalImage instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		const writesBefore = current.applyTextChange.mock.calls.length;

		const lease = root.captureContextMenuTarget(originalImage);
		expect(lease).not.toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writesBefore);
		expect(lease?.resolve()).toBe(originalImage);

		// The accepted Preview window commit replaces the block with an
		// equivalent render of the same source.
		const paragraph = current.surface.querySelector("p");
		if (!(paragraph instanceof HTMLParagraphElement)) {
			throw new Error("windowed-lease-block-missing");
		}
		paragraph.outerHTML = blockMarkup;
		const replacement = current.surface.querySelector("p");
		if (!(replacement instanceof HTMLParagraphElement)) {
			throw new Error("windowed-lease-block-missing");
		}
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(
			current,
			replacement,
		);
		act(() => rendered.rerenderAcceptedWindow(1));

		const replacementImage = current.surface.querySelector("img");
		if (!(replacementImage instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		expect(originalImage.isConnected).toBe(false);
		expect(replacementImage.isConnected).toBe(true);
		expect(replacementImage).not.toBe(originalImage);
		expect(lease?.resolve()).toBe(replacementImage);
		expect(failures).toEqual([]);
		expect(current.applyTextChange.mock.calls.length).toBe(writesBefore);

		// A released lease is dead even though its block is still mounted.
		lease?.release();
		expect(lease?.resolve()).toBeNull();
		rendered.view.unmount();
		current.surface.remove();
	});

	it("keeps a certified same-source row while pending and resolves after acceptance", () => {
		const blockIndex = 160;
		const imageMarkdown = "![alt](https://example.test/image.png)";
		const blockMarkup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: `Before ${imageMarkdown}` },
			markupOverrides: { [blockIndex]: blockMarkup },
			mounted: [blockIndex],
		});
		// The fixture assigns the editable property; jsdom does not reflect it to
		// the attribute, so publish the producer's editable surface explicitly.
		current.surface.setAttribute("contenteditable", "true");
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			pending: true,
			onFailure: (code: string) => failures.push(code),
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		// The real producer keeps the surface editable during a same-source
		// transfer, so the demand is admitted.
		expect(current.surface.getAttribute("contenteditable")).toBe("true");
		expect(root.prepareContextMenuDemand()).toBe(true);
		const writesBefore = current.applyTextChange.mock.calls.length;
		const lease = root.captureContextMenuTarget(image);
		expect(lease).not.toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writesBefore);
		// Readiness, not identity, keeps the target unresolved while pending.
		expect(lease?.resolve()).toBeNull();

		const paragraph = current.surface.querySelector("p");
		if (!(paragraph instanceof HTMLParagraphElement)) {
			throw new Error("windowed-lease-block-missing");
		}
		paragraph.outerHTML = blockMarkup;
		const replacement = current.surface.querySelector("p");
		if (!(replacement instanceof HTMLParagraphElement)) {
			throw new Error("windowed-lease-block-missing");
		}
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(
			current,
			replacement,
		);
		act(() => rendered.rerenderPendingAcceptedWindow(1, false));

		const replacementImage = current.surface.querySelector("img");
		if (!(replacementImage instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		expect(lease?.resolve()).toBe(replacementImage);
		expect(failures).toEqual([]);
		expect(current.applyTextChange.mock.calls.length).toBe(writesBefore);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("rebinds a fresh demand on the same image after the accepted scale render", () => {
		const blockIndex = 160;
		const scaled = '![alt](https://example.test/image.png "{width=50%}")';
		const markup = (title: string): string =>
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ `<img alt="alt" src="https://example.test/image.png" title="${title}"></p>`;
		// The scaled source is already the canonical document, exactly as it is
		// once the Image scale command has written it; the mounted DOM is still
		// the accepted 100% render.
		const current = fixture({
			blockOverrides: { [blockIndex]: `Before ${scaled}` },
			markupOverrides: { [blockIndex]: markup("{width=100%}") },
			mounted: [blockIndex],
		});
		expect(current.canonical()).toContain(scaled);
		current.surface.setAttribute("contenteditable", "true");
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onFailure: (code: string) => failures.push(code),
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const firstImage = current.surface.querySelector("img");
		if (!(firstImage instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		// The accepted render for the scaled source installs a new image node.
		const block = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!block) throw new Error("windowed-lease-block-missing");
		block.outerHTML = markup("{width=50%}");
		const replacement = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!replacement) throw new Error("windowed-lease-block-missing");
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(
			current,
			replacement,
		);
		act(() => rendered.rerenderAcceptedWindow(1));
		expect(failures).toEqual([]);

		// A demand on the SAME image after that accepted render binds the live
		// replacement node and never the retired element.
		expect(root.prepareContextMenuDemand()).toBe(true);
		const acceptedImage = current.surface.querySelector("img");
		if (!(acceptedImage instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		expect(acceptedImage).not.toBe(firstImage);
		const replay = root.captureContextMenuTarget(acceptedImage);
		if (!replay) throw new Error("windowed-lease-not-issued");
		expect(replay.resolve()).toBe(acceptedImage);
		expect(failures).toEqual([]);
		replay.release();
		expect(replay.resolve()).toBeNull();
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses the demand while the owner's own scale transfer is still pending", () => {
		const blockIndex = 160;
		const original = '![alt](https://example.test/image.png "{width=100%}")';
		const markup =
			`<p data-easymde-visual-block-id="b${blockIndex}">Before `
			+ '<img alt="alt" src="https://example.test/image.png" title="{width=100%}"></p>';
		const current = fixture({
			blockOverrides: { [blockIndex]: `Before ${original}` },
			markupOverrides: { [blockIndex]: markup },
			mounted: [blockIndex],
		});
		current.surface.setAttribute("contenteditable", "true");
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			requestPreview: () => "windowed",
			onFailure: (code: string) => failures.push(code),
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const image = current.surface.querySelector("img");
		if (!(image instanceof HTMLImageElement)) {
			throw new Error("windowed-lease-image-missing");
		}
		expect(root.prepareContextMenuDemand()).toBe(true);
		root.captureContextMenuTarget(image)?.release();
		const source = current.canonical();
		const from = source.indexOf('"{width=100%}"');
		if (from < 0) throw new Error("windowed-lease-source-missing");
		const to = from + '"{width=100%}"'.length;
		const value = `${source.slice(0, from)}"{width=50%}"${source.slice(to)}`;
		expect(
			root.applyCanonicalChange({
				change: {
					changes: { from, insert: '"{width=50%}"', to },
					selection: { direction: "none", end: from, start: from },
					value,
				},
				expected: {
					revision: 0,
					selection: { direction: "none", end: 0, start: 0 },
					value: source,
				},
			}),
		).toBe("handled");
		// The canonical document is already the scaled source while the accepted
		// DOM still renders the previous width: the pointed block cannot be
		// attributed to either document yet. The gesture ends before capture and
		// reports nothing; the settled transfer admits the next gesture.
		expect(current.canonical()).toBe(value);
		expect(image.getAttribute("title")).toBe("{width=100%}");
		expect(root.prepareContextMenuDemand()).toBe(false);
		expect(root.captureContextMenuTarget(image)).toBeNull();
		expect(failures).toEqual([]);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses capture while the accepted DOM still describes another source", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const block = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!block) throw new Error("windowed-lease-block-missing");
		// A structural local commit retires the produced block and publishes a
		// new canonical source while the accepted window still renders the old
		// one; no correspondence into the demanded source exists yet.
		const source = current.canonical();
		const from = source.indexOf("Line 160");
		if (from < 0) throw new Error("windowed-lease-source-missing");
		const to = from + "Line 160".length;
		const value = source.slice(0, from) + source.slice(to);
		expect(
			root.applyCanonicalChange({
				change: {
					changes: { from, insert: "", to },
					selection: { direction: "none", end: from, start: from },
					value,
				},
				expected: {
					revision: 0,
					selection: { direction: "none", end: 0, start: 0 },
					value: source,
				},
			}),
		).toBe("handled");
		expect(root.captureContextMenuTarget(block)).toBeNull();
		expect(current.applyTextChange).toHaveBeenCalled();
		rendered.view.unmount();
		current.surface.remove();
	});

	it("never retargets an earlier lease after a structural source change", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const block = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!block) throw new Error("windowed-lease-block-missing");
		const lease = root.captureContextMenuTarget(block);
		expect(lease?.resolve()).toBe(block);
		const source = current.canonical();
		const from = source.indexOf("Line 160");
		if (from < 0) throw new Error("windowed-lease-source-missing");
		const to = from + "Line 160".length;
		const value = source.slice(0, from) + source.slice(to);
		expect(
			root.applyCanonicalChange({
				change: {
					changes: { from, insert: "", to },
					selection: { direction: "none", end: from, start: from },
					value,
				},
				expected: {
					revision: 0,
					selection: { direction: "none", end: 0, start: 0 },
					value: source,
				},
			}),
		).toBe("handled");
		const writes = current.applyTextChange.mock.calls.length;
		// The lease binds the canonical source it was captured in, so a later
		// render of a different document cannot satisfy it. (This case is
		// rejected by source equality, before the captured row could be
		// compared; it does not by itself exercise the row guard.)
		expect(lease?.resolve()).toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		expect(current.canonical()).toBe(value);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses a forged nested label and a duplicated same-label root", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const accepted = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!accepted) throw new Error("windowed-lease-block-missing");

		// A forged nested label is certified into the accepted DOM first, so
		// the mount certificate passes and only the actual-root/identity rule
		// can refuse it.
		const forgedLabel = document.createElement("span");
		forgedLabel.setAttribute("data-easymde-visual-block-id", "b999");
		accepted.append(forgedLabel);
		acceptedSnapshot = acceptedWindowSnapshotForMountedBlock(current, accepted);
		act(() => rendered.rerenderAcceptedWindow(1));
		expect(root.captureContextMenuTarget(forgedLabel)).toBeNull();
		const validLease = root.captureContextMenuTarget(accepted);
		if (!validLease) throw new Error("windowed-lease-not-issued");
		expect(validLease.resolve()).toBe(accepted);
		validLease.release();
		expect(validLease.resolve()).toBeNull();

		// A second mounted root claiming the same label can never be part of an
		// accepted mount (the certificate pins the exact child sequence and
		// unique ids), so a duplicated mount is refused before any label is
		// trusted, and the captured-root uniqueness check is a second defense
		// for the window before a fresh certificate exists.
		const duplicate = accepted.cloneNode(true) as HTMLElement;
		current.surface.append(duplicate);
		expect(root.captureContextMenuTarget(duplicate)).toBeNull();
		expect(root.captureContextMenuTarget(accepted)).toBeNull();
		duplicate.remove();
		rendered.view.unmount();
		current.surface.remove();
	});

	it("binds an immediate ordinary native input without a flush", () => {
		const blockIndex = 160;
		const current = fixture({ mounted: [blockIndex] });
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const requestPreview = vi.fn(() => "next");
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			requestPreview,
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		current.surface.tabIndex = 0;
		current.surface.focus();
		const text = current.surface.querySelector("p")?.firstChild;
		if (!(text instanceof Text)) {
			throw new Error("windowed-lease-text-missing");
		}
		const initial = current.canonical();
		const start = initial.indexOf("Line 160");
		if (start < 0) throw new Error("windowed-lease-source-missing");
		placeCaret(text, text.data.length);

		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "Z",
				inputType: "insertText",
			}),
		);
		text.data = `${text.data}Z`;
		placeCaret(text, text.data.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "Z",
				inputType: "insertText",
			}),
		);

		// The ordinary owner publishes its own native input synchronously, so
		// the demand sees the user's text with no debounce to flush.
		expect(current.canonical()).toBe(
			`${initial.slice(0, start)}Line 160Z${initial.slice(start + 8)}`,
		);
		expect(requestPreview).not.toHaveBeenCalled();
		const block = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!block) throw new Error("windowed-lease-block-missing");
		const writes = current.applyTextChange.mock.calls.length;
		expect(root.prepareContextMenuDemand()).toBe(true);
		const lease = root.captureContextMenuTarget(block);
		expect(lease?.resolve()).toBe(block);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses authority for a mounted root relabelled to another valid unmounted row", () => {
		const blockIndex = 160;
		const neighborIndex = 161;
		const current = fixture({
			lineOverrides: {
				[blockIndex]: "Same",
				[neighborIndex]: "Same",
			},
			mounted: [blockIndex],
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			onFailure: (code: string) => failures.push(code),
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const mounted = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${blockIndex}"]`,
		);
		if (!mounted) throw new Error("windowed-lease-block-missing");
		const canonicalBefore = current.canonical();
		const lease = root.captureContextMenuTarget(mounted);
		if (!lease) throw new Error("windowed-lease-not-issued");
		expect(lease.resolve()).toBe(mounted);
		const writes = current.applyTextChange.mock.calls.length;
		const selectionBefore = window.getSelection();
		const rangeBefore =
			selectionBefore && selectionBefore.rangeCount > 0
				? selectionBefore.getRangeAt(0).cloneRange()
				: null;

		// Only the live label changes: same Node, same body, same source, same
		// accepted mount, and the new label names a real unmounted row whose
		// rendering is identical.
		mounted.setAttribute(
			"data-easymde-visual-block-id",
			`b${neighborIndex}`,
		);
		expect(mounted.textContent).toBe("Same");
		expect(
			current.surface.querySelectorAll(
				`[data-easymde-visual-block-id="b${neighborIndex}"]`,
			).length,
		).toBe(1);

		expect(root.captureContextMenuTarget(mounted)).toBeNull();
		expect(lease.resolve()).toBeNull();
		// The metadata-using readiness/source-navigation path rejects before any
		// canonical selection or data write.
		expect(
			root.prepareSourceNavigation({
				revision: 0,
				value: current.canonical(),
			}),
		).toBe(false);
		expect(root.prepareContextMenuDemand()).toBe(true);
		expect(failures).toContain(
			"visual-editor-window-source-navigation-dom-stale",
		);
		expect(current.canonical()).toBe(canonicalBefore);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		const selectionAfter = window.getSelection();
		const rangeAfter =
			selectionAfter && selectionAfter.rangeCount > 0
				? selectionAfter.getRangeAt(0).cloneRange()
				: null;
		expect(rangeAfter?.startContainer ?? null).toBe(
			rangeBefore?.startContainer ?? null,
		);
		expect(rangeAfter?.startOffset ?? -1).toBe(rangeBefore?.startOffset ?? -1);

		// A native beforeinput on the forged root cannot launder the label into a
		// fresh local accepted registry either. The owner cancels the native
		// mutation, so the DOM text must not be advanced after the rejection.
		const text = mounted.firstChild;
		if (!(text instanceof Text)) {
			throw new Error("windowed-lease-text-missing");
		}
		placeCaret(text, text.data.length);
		const beforeInput = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			data: "Z",
			inputType: "insertText",
		});
		current.surface.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(true);
		expect(mounted.textContent).toBe("Same");
		expect(current.canonical()).toBe(canonicalBefore);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("does not publish canonical input when retained metadata changes mid-event", () => {
		const firstIndex = 159;
		const secondIndex = 160;
		const current = fixture({ mounted: [firstIndex, secondIndex] });
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const failures: string[] = [];
		const rendered = renderWindowEditor(current, {
			onFailure: (code: string) => failures.push(code),
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		current.surface.tabIndex = 0;
		current.surface.focus();
		const edited = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${firstIndex}"]`,
		);
		const text = edited?.firstChild;
		if (!(edited && text instanceof Text)) {
			throw new Error("windowed-lease-block-missing");
		}
		const canonicalBefore = current.canonical();
		const documentChangesBefore = current.documentChanges.mock.calls.length;
		placeCaret(text, text.data.length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "Z",
				inputType: "insertText",
			}),
		);
		// The native event is free to change content, but this retained root no
		// longer carries the label it was accepted with.
		edited.setAttribute(
			"data-easymde-visual-block-id",
			`b${secondIndex + 1}`,
		);
		text.data = `${text.data}Z`;
		placeCaret(text, text.data.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "Z",
				inputType: "insertText",
			}),
		);

		expect(current.canonical()).toBe(canonicalBefore);
		// A selection-only publication from the beforeinput capture is expected;
		// canonical document writes are not.
		expect(current.documentChanges.mock.calls.length).toBe(documentChangesBefore);
		expect(failures).toContain(
			"visual-editor-window-source-navigation-dom-stale",
		);
		// The forged label gained no canonical authority: the same node remains
		// uncapturable, and canonical source/history are untouched by the
		// rejected transaction (this path is not one of the region-restoring
		// failure kinds).
		expect(root.captureContextMenuTarget(edited)).toBeNull();
		rendered.view.unmount();
		current.surface.remove();
	});

	it("preserves a real local ledger shift for an unchanged later root", () => {
		const firstIndex = 159;
		const secondIndex = 160;
		const current = fixture({ mounted: [firstIndex, secondIndex] });
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const requestPreview = vi.fn(() => "next");
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			requestPreview,
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		current.surface.tabIndex = 0;
		current.surface.focus();
		const earlier = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${firstIndex}"]`,
		);
		const later = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${secondIndex}"]`,
		);
		const text = earlier?.firstChild;
		if (!(earlier && later && text instanceof Text)) {
			throw new Error("windowed-lease-block-missing");
		}
		const initial = current.canonical();
		const line = `Line ${firstIndex}`;
		const lineStart = initial.indexOf(line);
		if (lineStart < 0) throw new Error("windowed-lease-source-missing");
		placeCaret(text, text.data.length);
		current.surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				data: "Z",
				inputType: "insertText",
			}),
		);
		text.data = `${text.data}Z`;
		placeCaret(text, text.data.length);
		current.surface.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "Z",
				inputType: "insertText",
			}),
		);

		// The ordinary owner publishes the edit synchronously and exactly; no
		// Preview burst is invented to settle it.
		expect(current.canonical()).toBe(
			initial.slice(0, lineStart + line.length) +
				"Z" +
				initial.slice(lineStart + line.length),
		);
		expect(requestPreview).not.toHaveBeenCalled();
		expect(root.prepareContextMenuDemand()).toBe(true);
		const lease = root.captureContextMenuTarget(later);
		if (!lease) throw new Error("windowed-lease-not-issued");
		// A record frozen at the pre-edit offsets would not describe the shifted
		// row, so this positive depends on the refreshed effective bounds.
		expect(lease.resolve()).toBe(later);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses a genuinely read-only surface even while a transfer stands", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			pending: true,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		current.surface.setAttribute("contenteditable", "false");
		expect(root.prepareContextMenuDemand()).toBe(false);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("refuses the removed occurrence after the real accepted render renumbers roots", () => {
		const intro = 0;
		const firstFence = 1;
		const middle = 2;
		const secondFence = 3;
		const tail = 4;
		const fenceSource = "```\nsame\n```";
		const current = fixture({
			blockOverrides: {
				[intro]: "Intro",
				[firstFence]: fenceSource,
				[middle]: "Middle",
				[secondFence]: fenceSource,
				[tail]: "Tail",
			},
			markupOverrides: {
				[intro]: '<p data-easymde-visual-block-id="b0">Intro</p>',
				[firstFence]:
					'<pre data-easymde-visual-block-id="b1"><code>same\n</code></pre>',
				[middle]: '<p data-easymde-visual-block-id="b2">Middle</p>',
				[secondFence]:
					'<pre data-easymde-visual-block-id="b3"><code>same\n</code></pre>',
				[tail]: '<p data-easymde-visual-block-id="b4">Tail</p>',
			},
			mounted: [intro, firstFence, middle, secondFence, tail],
			paragraphBlocks: true,
			sourceBlockCount: 5,
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
			requestPreview: vi.fn(() => "windowed"),
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const pointed = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b1"]',
		);
		const surviving = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b3"]',
		);
		if (!(pointed && surviving)) {
			throw new Error("windowed-lease-fence-missing");
		}
		// A lease taken while the old source was current; it is the control for
		// the later non-revival assertion.
		const oldSourceLease = root.captureContextMenuTarget(surviving);
		if (!oldSourceLease) throw new Error("windowed-lease-not-issued");
		expect(oldSourceLease.resolve()).toBe(surviving);

		const source = current.canonical();
		const value = `Middle\n\n${fenceSource}\n\nTail`;
		expect(source.endsWith(value)).toBe(true);
		const from = 0;
		const to = source.length - value.length;
		expect(
			root.applyCanonicalChange({
				change: {
					changes: { from, insert: "", to },
					selection: { direction: "none", end: from, start: from },
					value,
				},
				expected: {
					revision: 0,
					selection: { direction: "none", end: 0, start: 0 },
					value: source,
				},
			}),
		).toBe("handled");
		expect(current.canonical()).toBe(value);
		const writes = current.applyTextChange.mock.calls.length;
		// The accepted render has not arrived yet, so the accepted DOM still
		// describes the previous revision and keeps the demanded source
		// parked. The old-source lease is already dead on source equality.
		expect(oldSourceLease.resolve()).toBeNull();

		// The accepted render has not arrived yet, so the owner holds no
		// correspondence into the demanded source for the removed block.
		expect(pointed.isConnected).toBe(true);
		expect(root.captureContextMenuTarget(pointed)).toBeNull();

		// The real accepted response: three roots, b0=Middle, b1=surviving
		// fence, b2=Tail, with truthful line spans for that exact source.
		const acceptedMiddle = document.createElement("p");
		acceptedMiddle.innerHTML = "Middle";
		const acceptedFence = document.createElement("pre");
		const acceptedCode = document.createElement("code");
		acceptedCode.textContent = "same\n";
		acceptedFence.append(acceptedCode);
		const acceptedTail = document.createElement("p");
		acceptedTail.innerHTML = "Tail";
		current.surface.replaceChildren(acceptedMiddle, acceptedFence, acceptedTail);
		const [newMiddle, newFence, newTail] = Array.from(current.surface.children);
		if (
			!(newMiddle instanceof HTMLElement)
			|| !(newFence instanceof HTMLElement)
			|| !(newTail instanceof HTMLElement)
		) {
			throw new Error("windowed-lease-accepted-block-missing");
		}
		newMiddle.setAttribute("data-easymde-visual-block-id", "b0");
		newFence.setAttribute("data-easymde-visual-block-id", "b1");
		newTail.setAttribute("data-easymde-visual-block-id", "b2");
		const acceptedMap: PreviewEditMap = {
			blocks: [
				{ editable: true, endLine: 1, id: "b0", startLine: 0 },
				{ editable: true, endLine: 5, id: "b1", startLine: 2 },
				{ editable: true, endLine: 7, id: "b2", startLine: 6 },
			],
			coordinate: "line",
			signature: "windowed",
			version: 1,
		};
		act(() =>
			rendered.rerenderPreview(acceptedMap, {
				revision: 1,
				signature: "windowed",
			}),
		);
		expect(current.canonical()).toBe(value);
		// The removed occurrence is detached and stays uncapturable; no label
		// or content comparison can reattach it to the surviving fence.
		expect(pointed.isConnected).toBe(false);
		expect(root.captureContextMenuTarget(pointed)).toBeNull();
		// The pre-change lease is dead. Its discriminator is the canonical
		// source it was captured in, not the row comparison.
		expect(oldSourceLease.resolve()).toBeNull();
		// The fresh current roots are capturable on their own merits.
		const freshLease = root.captureContextMenuTarget(newFence);
		if (!freshLease) throw new Error("windowed-lease-not-issued");
		expect(freshLease.resolve()).toBe(newFence);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("rejects a captured fence lease after a same-source accepted render relocates its row", () => {
		const firstIndex = 0;
		const secondIndex = 1;
		const fenceSource = "```\nsame\n```";
		const current = fixture({
			blockOverrides: {
				[firstIndex]: fenceSource,
				[secondIndex]: fenceSource,
			},
			markupOverrides: {
				[firstIndex]:
					`<pre data-easymde-visual-block-id="b${firstIndex}"><code>same\n</code></pre>`,
				[secondIndex]:
					`<pre data-easymde-visual-block-id="b${secondIndex}"><code>same\n</code></pre>`,
			},
			mounted: [firstIndex, secondIndex],
			paragraphBlocks: true,
			sourceBlockCount: 2,
		});
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		let acceptedSnapshot: ImmersiveWindowAcceptedSnapshot | null = null;
		const rendered = renderWindowEditor(current, {
			acceptedWindowSnapshotGeneration: 0,
			getAcceptedWindowSnapshot: () => acceptedSnapshot,
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const oldFirst = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${firstIndex}"]`,
		);
		const oldSecond = current.surface.querySelector<HTMLElement>(
			`[data-easymde-visual-block-id="b${secondIndex}"]`,
		);
		const [firstRow, secondRow] = current.editMap.blocks;
		if (!(oldFirst && oldSecond && firstRow && secondRow)) {
			throw new Error("windowed-lease-fence-missing");
		}
		// Both fences render exactly the same bytes, so only the accepted
		// interval can tell the two occurrences apart.
		expect(oldFirst.tagName).toBe("PRE");
		expect(oldSecond.tagName).toBe("PRE");
		expect(oldFirst.innerHTML).toBe(oldSecond.innerHTML);
		const lease = root.captureContextMenuTarget(oldFirst);
		if (!lease) throw new Error("windowed-lease-not-issued");
		expect(lease.resolve()).toBe(oldFirst);

		const canonicalBefore = current.canonical();
		const revisionBefore = current.documentSession.document.getRevision?.();
		const historyBefore = current.documentSession.document.getHistoryState();
		const writes = current.applyTextChange.mock.calls.length;
		const documentChanges = current.documentChanges.mock.calls.length;

		// A fresh accepted render of the SAME source and signature, in source
		// order, with truthful and unique spans: the first row is now owned by
		// b1 and the second by b0, so the captured b0 label has moved to the
		// other identical fence interval.
		const relocatedMap: PreviewEditMap = {
			...current.editMap,
			blocks: [
				{ ...firstRow, id: `b${secondIndex}` },
				{ ...secondRow, id: `b${firstIndex}` },
			],
		};
		const freshFirstRow = document.createElement("pre");
		freshFirstRow.setAttribute(
			"data-easymde-visual-block-id",
			`b${secondIndex}`,
		);
		const freshFirstCode = document.createElement("code");
		freshFirstCode.textContent = "same\n";
		freshFirstRow.append(freshFirstCode);
		const freshSecondRow = document.createElement("pre");
		freshSecondRow.setAttribute(
			"data-easymde-visual-block-id",
			`b${firstIndex}`,
		);
		const freshSecondCode = document.createElement("code");
		freshSecondCode.textContent = "same\n";
		freshSecondRow.append(freshSecondCode);
		current.surface.replaceChildren(freshFirstRow, freshSecondRow);
		acceptedSnapshot = {
			blocks: [
				{
					id: `b${secondIndex}`,
					innerHTML: freshFirstRow.innerHTML,
					node: freshFirstRow,
				},
				{
					id: `b${firstIndex}`,
					innerHTML: freshSecondRow.innerHTML,
					node: freshSecondRow,
				},
			],
			key: 1,
			nodes: Array.from(current.surface.childNodes),
			revision: 1,
			signature: "windowed",
		};
		// ONE public-props render carries the relocated map, its matching
		// Preview snapshot and the accepted generation together.
		act(() =>
			rendered.rerenderAcceptedWindowWithMap(
				relocatedMap,
				{ revision: 1, signature: "windowed" },
				1,
			),
		);

		// Acceptance changes no canonical byte, revision, history or DOM text.
		expect(current.canonical()).toBe(canonicalBefore);
		expect(current.documentSession.document.getRevision?.()).toBe(
			revisionBefore,
		);
		expect(current.documentSession.document.getHistoryState()).toEqual(
			historyBefore,
		);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		expect(current.documentChanges.mock.calls.length).toBe(documentChanges);
		expect(oldFirst.isConnected).toBe(false);
		expect(oldSecond.isConnected).toBe(false);

		// The captured label still names exactly one mounted fence with the same
		// rendering, but its accepted interval moved: the demand is dead.
		expect(lease.resolve()).toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		lease.release();
		expect(lease.resolve()).toBeNull();

		// Each fresh root is capturable through its own accepted binding.
		const freshLeaseFirst = root.captureContextMenuTarget(freshFirstRow);
		const freshLeaseSecond = root.captureContextMenuTarget(freshSecondRow);
		if (!(freshLeaseFirst && freshLeaseSecond)) {
			throw new Error("windowed-lease-not-issued");
		}
		expect(freshLeaseFirst.resolve()).toBe(freshFirstRow);
		expect(freshLeaseSecond.resolve()).toBe(freshSecondRow);
		freshLeaseFirst.release();
		freshLeaseSecond.release();
		expect(freshLeaseFirst.resolve()).toBeNull();
		expect(freshLeaseSecond.resolve()).toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("does not revive a lease across a notified source ABA", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const root = runtime as ImmersiveVisualEditorRuntime;
		const block = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!block) throw new Error("windowed-lease-block-missing");
		const original = current.canonical();
		const lease = root.captureContextMenuTarget(block);
		if (!lease) throw new Error("windowed-lease-not-issued");
		expect(lease.resolve()).toBe(block);
		const writes = current.applyTextChange.mock.calls.length;

		// Ordinary owner notifications carry the foreign writes: A -> B -> A.
		current.setCanonical(`${original}\nForeign`);
		expect(lease.resolve()).toBeNull();
		current.setCanonical(original);
		expect(current.canonical()).toBe(original);
		expect(lease.resolve()).toBeNull();
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		rendered.view.unmount();
		current.surface.remove();
	});

	it("keeps a released lease dead across teardown and re-entry", () => {
		const current = fixture();
		let runtime: ImmersiveVisualEditorRuntime | null = null;
		const rendered = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				runtime = nextRuntime;
			},
		});
		if (!runtime) throw new Error("windowed-lease-runtime-missing");
		const first = runtime as ImmersiveVisualEditorRuntime;
		const block = current.surface.querySelector<HTMLElement>(
			'[data-easymde-visual-block-id="b160"]',
		);
		if (!block) throw new Error("windowed-lease-block-missing");
		const lease = first.captureContextMenuTarget(block);
		expect(lease?.resolve()).toBe(block);
		rendered.view.unmount();
		// The same DOM is mounted again by a fresh owner instance.
		let reentered: ImmersiveVisualEditorRuntime | null = null;
		const second = renderWindowEditor(current, {
			onReady: (nextRuntime) => {
				reentered = nextRuntime;
			},
		});
		const root = reentered as ImmersiveVisualEditorRuntime | null;
		if (!root) throw new Error("windowed-lease-runtime-missing");
		expect(lease?.resolve()).toBeNull();
		const writes = current.applyTextChange.mock.calls.length;
		expect(root.captureContextMenuTarget(block)?.resolve()).toBe(block);
		expect(current.applyTextChange.mock.calls.length).toBe(writes);
		lease?.release();
		second.view.unmount();
		current.surface.remove();
	});
});
