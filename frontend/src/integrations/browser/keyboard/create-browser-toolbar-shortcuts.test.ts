// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createBrowserToolbarShortcuts } from "./create-browser-toolbar-shortcuts";

const shortcuts = {
	bold: { mac: "Cmd+B", win: "Ctrl+B" },
	save: { mac: "Cmd+S", win: "Ctrl+S" },
};

describe("createBrowserToolbarShortcuts", () => {
	it("prepares without listening, then owns matching shortcuts inside the editor root", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		const content = document.createElement("div");
		content.contentEditable = "true";
		editorRoot.append(source, content);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }, { id: "save" }],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(execute);

		content.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
				key: "b",
			}),
		);
		expect(execute).not.toHaveBeenCalled();

		binding.activate();
		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		content.dispatchEvent(event);

		expect(execute).toHaveBeenCalledWith("bold");
		expect(event.defaultPrevented).toBe(true);
	});

	it("matches shifted symbol bindings from event.code", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "unorderedlist" }, { id: "orderedlist" }],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: {
				unorderedlist: { mac: "Cmd+Option+U", win: "Ctrl+Shift+BracketRight" },
				orderedlist: { mac: "Cmd+Option+O", win: "Ctrl+Shift+BracketLeft" },
			},
			source,
		}).prepareBinding(execute);
		binding.activate();

		source.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				code: "BracketRight",
				ctrlKey: true,
				key: "}",
				shiftKey: true,
			}),
		);
		source.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				code: "BracketLeft",
				ctrlKey: true,
				key: "{",
				shiftKey: true,
			}),
		);

		expect(execute.mock.calls).toEqual([["unorderedlist"], ["orderedlist"]]);
	});

	it("executes every settings-managed command through its canonical Windows binding", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const cases = [
			["savepost", "Ctrl+S", { code: "KeyS", ctrlKey: true, key: "s" }],
			["bold", "Ctrl+B", { code: "KeyB", ctrlKey: true, key: "b" }],
			["italic", "Ctrl+I", { code: "KeyI", ctrlKey: true, key: "i" }],
			[
				"strike",
				"Alt+Shift+5",
				{ altKey: true, code: "Digit5", key: "%", shiftKey: true },
			],
			["paragraph", "Ctrl+0", { code: "Digit0", ctrlKey: true, key: "0" }],
			["heading1", "Ctrl+1", { code: "Digit1", ctrlKey: true, key: "1" }],
			["heading2", "Ctrl+2", { code: "Digit2", ctrlKey: true, key: "2" }],
			["heading3", "Ctrl+3", { code: "Digit3", ctrlKey: true, key: "3" }],
			["heading4", "Ctrl+4", { code: "Digit4", ctrlKey: true, key: "4" }],
			["heading5", "Ctrl+5", { code: "Digit5", ctrlKey: true, key: "5" }],
			["heading6", "Ctrl+6", { code: "Digit6", ctrlKey: true, key: "6" }],
			[
				"quote",
				"Ctrl+Shift+Q",
				{ code: "KeyQ", ctrlKey: true, key: "Q", shiftKey: true },
			],
			[
				"unorderedlist",
				"Ctrl+Shift+BracketRight",
				{ code: "BracketRight", ctrlKey: true, key: "}", shiftKey: true },
			],
			[
				"orderedlist",
				"Ctrl+Shift+BracketLeft",
				{ code: "BracketLeft", ctrlKey: true, key: "{", shiftKey: true },
			],
			[
				"inlinecode",
				"Ctrl+Shift+Backquote",
				{ code: "Backquote", ctrlKey: true, key: "~", shiftKey: true },
			],
			[
				"codefence",
				"Ctrl+Shift+K",
				{ code: "KeyK", ctrlKey: true, key: "K", shiftKey: true },
			],
			[
				"mathblock",
				"Ctrl+Shift+M",
				{ code: "KeyM", ctrlKey: true, key: "M", shiftKey: true },
			],
			["link", "Ctrl+K", { code: "KeyK", ctrlKey: true, key: "k" }],
			[
				"image",
				"Ctrl+Shift+I",
				{ code: "KeyI", ctrlKey: true, key: "I", shiftKey: true },
			],
		] as const;
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: cases.map(([id]) => ({ id })),
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: Object.fromEntries(
				cases.map(([id, win]) => [id, { mac: "", win }]),
			),
			source,
		}).prepareBinding(execute);
		binding.activate();

		for (const [, , init] of cases) {
			source.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					...init,
				}),
			);
		}

		expect(execute.mock.calls.map(([id]) => id)).toEqual(
			cases.map(([id]) => id),
		);
	});

	it("executes every settings-managed command through its canonical macOS binding", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const cases = [
			["savepost", "Cmd+S", { code: "KeyS", key: "s", metaKey: true }],
			["bold", "Cmd+B", { code: "KeyB", key: "b", metaKey: true }],
			["italic", "Cmd+I", { code: "KeyI", key: "i", metaKey: true }],
			[
				"strike",
				"Ctrl+Shift+Backquote",
				{ code: "Backquote", ctrlKey: true, key: "~", shiftKey: true },
			],
			["paragraph", "Cmd+0", { code: "Digit0", key: "0", metaKey: true }],
			["heading1", "Cmd+1", { code: "Digit1", key: "1", metaKey: true }],
			["heading2", "Cmd+2", { code: "Digit2", key: "2", metaKey: true }],
			["heading3", "Cmd+3", { code: "Digit3", key: "3", metaKey: true }],
			["heading4", "Cmd+4", { code: "Digit4", key: "4", metaKey: true }],
			["heading5", "Cmd+5", { code: "Digit5", key: "5", metaKey: true }],
			["heading6", "Cmd+6", { code: "Digit6", key: "6", metaKey: true }],
			[
				"quote",
				"Cmd+Option+Q",
				{ altKey: true, code: "KeyQ", key: "q", metaKey: true },
			],
			[
				"unorderedlist",
				"Cmd+Option+U",
				{ altKey: true, code: "KeyU", key: "u", metaKey: true },
			],
			[
				"orderedlist",
				"Cmd+Option+O",
				{ altKey: true, code: "KeyO", key: "o", metaKey: true },
			],
			[
				"inlinecode",
				"Cmd+Shift+Backquote",
				{ code: "Backquote", key: "~", metaKey: true, shiftKey: true },
			],
			[
				"codefence",
				"Cmd+Option+C",
				{ altKey: true, code: "KeyC", key: "c", metaKey: true },
			],
			[
				"mathblock",
				"Cmd+Option+B",
				{ altKey: true, code: "KeyB", key: "b", metaKey: true },
			],
			["link", "Cmd+K", { code: "KeyK", key: "k", metaKey: true }],
			[
				"image",
				"Cmd+Ctrl+I",
				{ code: "KeyI", ctrlKey: true, key: "i", metaKey: true },
			],
		] as const;
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: cases.map(([id]) => ({ id })),
			editorRoot,
			eventTarget: document,
			platform: "mac",
			shortcuts: Object.fromEntries(
				cases.map(([id, mac]) => [id, { mac, win: "" }]),
			),
			source,
		}).prepareBinding(execute);
		binding.activate();

		for (const [, , init] of cases) {
			source.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					...init,
				}),
			);
		}

		expect(execute.mock.calls.map(([id]) => id)).toEqual(
			cases.map(([id]) => id),
		);
	});

	it("ignores composition, unrelated fields, outside targets, and unmatched shortcuts", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		const title = document.createElement("input");
		const content = document.createElement("div");
		const outside = document.createElement("div");
		content.contentEditable = "true";
		editorRoot.append(source, title, content);
		document.body.append(editorRoot, outside);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(execute);
		binding.activate();

		title.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "b" }),
		);
		outside.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "b" }),
		);
		content.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				ctrlKey: true,
				isComposing: true,
				key: "b",
			}),
		);
		content.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "u" }),
		);

		expect(execute).not.toHaveBeenCalled();
	});

	it("preserves native textarea handling and Mac modifier normalization", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }],
			editorRoot,
			eventTarget: document,
			platform: "mac",
			shortcuts,
			source,
		}).prepareBinding(execute);
		binding.activate();

		source.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "B",
				metaKey: true,
			}),
		);

		expect(execute).toHaveBeenCalledWith("bold");
	});

	it("removes its listener through idempotent disposal", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "save" }],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(execute);
		binding.activate();
		binding.dispose();
		binding.dispose();

		source.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				ctrlKey: true,
				key: "s",
			}),
		);

		expect(execute).not.toHaveBeenCalled();
	});

	it("ignores repeated matching shortcuts", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "save" }],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(execute);
		binding.activate();

		source.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				code: "KeyS",
				ctrlKey: true,
				key: "s",
				repeat: true,
			}),
		);

		expect(execute).not.toHaveBeenCalled();
	});

	it("skips empty disabled bindings and rejects invalid or duplicate active bindings", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");

		expect(() =>
			createBrowserToolbarShortcuts({
				commands: [{ id: "bold" }, { id: "save" }],
				editorRoot,
				eventTarget: document,
				platform: "win",
				shortcuts: {
					bold: { mac: "", win: "" },
					save: { mac: "Cmd+S", win: "Ctrl+S" },
				},
				source,
			}),
		).not.toThrow();
		expect(() =>
			createBrowserToolbarShortcuts({
				commands: [{ id: "bold" }],
				editorRoot,
				eventTarget: document,
				platform: "win",
				shortcuts: { bold: { mac: "Cmd+B", win: "Shift+B" } },
				source,
			}),
		).toThrow("toolbar-shortcut-binding-invalid");
		expect(() =>
			createBrowserToolbarShortcuts({
				commands: [{ id: "bold" }, { id: "save" }],
				editorRoot,
				eventTarget: document,
				platform: "win",
				shortcuts: {
					bold: { mac: "Cmd+B", win: "Ctrl+B" },
					save: { mac: "Cmd+B", win: "control+b" },
				},
				source,
			}),
		).toThrow("toolbar-shortcut-bindings-conflict");
	});

	it("rejects invalid surfaces and duplicate activation before registering a second owner", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		const shortcutOwner = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts,
			source,
		});
		const binding = shortcutOwner.prepareBinding(vi.fn());

		binding.activate();
		expect(() => binding.activate()).toThrow(
			"toolbar-shortcut-binding-already-activated",
		);
		expect(() =>
			createBrowserToolbarShortcuts({
				commands: [{ id: "bold" }],
				editorRoot: null as never,
				eventTarget: document,
				platform: "win",
				shortcuts,
				source,
			}),
		).toThrow("toolbar-shortcut-surfaces-invalid");
	});

	it("stays disposable when browser listener activation throws", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		const removeEventListener = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }],
			editorRoot,
			eventTarget: {
				addEventListener() {
					throw new Error("listener unavailable");
				},
				removeEventListener,
			},
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(vi.fn());

		expect(() => binding.activate()).toThrow("listener unavailable");
		expect(() => binding.dispose()).not.toThrow();
		expect(removeEventListener).not.toHaveBeenCalled();
	});
});
