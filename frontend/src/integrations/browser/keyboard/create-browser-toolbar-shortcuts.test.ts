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

	it("accepts the explicitly registered context-menu portal as the same owner", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		const portalOwner = document.createElement("div");
		const menuButton = document.createElement("button");
		portalOwner.append(menuButton);
		document.body.append(editorRoot, portalOwner);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }],
			editorRoot,
			eventTarget: document,
			isOwnedTarget: (target) => portalOwner.contains(target),
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(execute);
		binding.activate();

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		menuButton.dispatchEvent(event);

		expect(execute).toHaveBeenCalledWith("bold");
		expect(event.defaultPrevented).toBe(true);
	});

	it("uses a settings-customized shortcut while the owned context menu is focused", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		const portalOwner = document.createElement("div");
		const menuButton = document.createElement("button");
		portalOwner.append(menuButton);
		document.body.append(editorRoot, portalOwner);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{ id: "bold" }],
			editorRoot,
			eventTarget: document,
			isOwnedTarget: (target) => portalOwner.contains(target),
			platform: "win",
			shortcuts: { bold: { mac: "Cmd+B", win: "Ctrl+Shift+B" } },
			source,
		}).prepareBinding(execute);
		binding.activate();

		menuButton.dispatchEvent(new KeyboardEvent("keydown", {
			bubbles: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
			shiftKey: true,
		}));

		expect(execute).toHaveBeenCalledWith("bold");
	});

	it("suppresses a changed registry default without dispatching it", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{
				defaultShortcutMac: "Cmd+B",
				defaultShortcutWin: "Ctrl+B",
				id: "bold",
			}],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: { bold: { mac: "Cmd+B", win: "Ctrl+Shift+B" } },
			source,
		}).prepareBinding(execute);
		binding.activate();

		const oldDefault = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		const stopPropagation = vi.spyOn(oldDefault, "stopPropagation");
		source.dispatchEvent(oldDefault);

		expect(execute).not.toHaveBeenCalled();
		expect(oldDefault.defaultPrevented).toBe(true);
		expect(stopPropagation).toHaveBeenCalledOnce();

		const repeatedOldDefault = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
			repeat: true,
		});
		const repeatedStopPropagation = vi.spyOn(repeatedOldDefault, "stopPropagation");
		source.dispatchEvent(repeatedOldDefault);

		expect(execute).not.toHaveBeenCalled();
		expect(repeatedOldDefault.defaultPrevented).toBe(true);
		expect(repeatedStopPropagation).toHaveBeenCalledOnce();

		const configured = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
			shiftKey: true,
		});
		source.dispatchEvent(configured);

		expect(execute).toHaveBeenCalledWith("bold");
	});

	it("suppresses a cleared registry default without dispatching it", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{
				defaultShortcutMac: "Cmd+B",
				defaultShortcutWin: "Ctrl+B",
				id: "bold",
			}],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: { bold: { mac: "Cmd+B", win: "" } },
			source,
		}).prepareBinding(execute);
		binding.activate();

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		const stopPropagation = vi.spyOn(event, "stopPropagation");
		source.dispatchEvent(event);

		expect(execute).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
		expect(stopPropagation).toHaveBeenCalledOnce();

		const repeated = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
			repeat: true,
		});
		const repeatedStopPropagation = vi.spyOn(repeated, "stopPropagation");
		source.dispatchEvent(repeated);

		expect(execute).not.toHaveBeenCalled();
		expect(repeated.defaultPrevented).toBe(true);
		expect(repeatedStopPropagation).toHaveBeenCalledOnce();
	});

	it("lets the configured command win when another command owns the old default", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [
				{
					defaultShortcutMac: "Cmd+B",
					defaultShortcutWin: "Ctrl+B",
					id: "bold",
				},
				{
					defaultShortcutMac: "Cmd+I",
					defaultShortcutWin: "Ctrl+I",
					id: "italic",
				},
			],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: {
				bold: { mac: "Cmd+B", win: "Ctrl+Shift+B" },
				italic: { mac: "Cmd+I", win: "Ctrl+B" },
			},
			source,
		}).prepareBinding(execute);
		binding.activate();

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		source.dispatchEvent(event);

		expect(execute).toHaveBeenCalledWith("italic");
		expect(event.defaultPrevented).toBe(true);
	});

	it("keeps an unchanged registry default active", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{
				defaultShortcutMac: "Cmd+B",
				defaultShortcutWin: "Ctrl+B",
				id: "bold",
			}],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: { bold: { mac: "Cmd+B", win: "Ctrl+B" } },
			source,
		}).prepareBinding(execute);
		binding.activate();

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		source.dispatchEvent(event);

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

	it("leaves outside, composition, keyCode 229, dead-key, and process events untouched", () => {
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
			commands: [{
				defaultShortcutMac: "Cmd+B",
				defaultShortcutWin: "Ctrl+B",
				id: "bold",
			}],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: { bold: { mac: "Cmd+B", win: "Ctrl+Shift+B" } },
			source,
		}).prepareBinding(execute);
		binding.activate();

		const keyCode229 = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
		});
		Object.defineProperty(keyCode229, "keyCode", { value: 229 });
		const events = [
			{ target: title, event: new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyB", ctrlKey: true, key: "b" }) },
			{ target: outside, event: new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyB", ctrlKey: true, key: "b" }) },
			{ target: content, event: new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyB", ctrlKey: true, isComposing: true, key: "b" }) },
			{ target: content, event: new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyB", ctrlKey: true, key: "Dead" }) },
			{ target: content, event: new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyB", ctrlKey: true, key: "Process" }) },
			{ target: content, event: keyCode229 },
			{ target: content, event: new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyU", ctrlKey: true, key: "u" }) },
		] as const;
		for (const { target, event } of events) {
			target.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}

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

	it("consumes repeated configured shortcuts without dispatching them", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{
				defaultShortcutMac: "Cmd+S",
				defaultShortcutWin: "Ctrl+S",
				id: "save",
			}],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts,
			source,
		}).prepareBinding(execute);
		binding.activate();

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyS",
			ctrlKey: true,
			key: "s",
			repeat: true,
		});
		source.dispatchEvent(event);

		expect(execute).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("consumes a repeated customized shortcut instead of exposing it to native handling", () => {
		const editorRoot = document.createElement("div");
		const source = document.createElement("textarea");
		editorRoot.append(source);
		document.body.append(editorRoot);
		const execute = vi.fn();
		const binding = createBrowserToolbarShortcuts({
			commands: [{
				defaultShortcutMac: "Cmd+B",
				defaultShortcutWin: "Ctrl+B",
				id: "bold",
			}],
			editorRoot,
			eventTarget: document,
			platform: "win",
			shortcuts: { bold: { mac: "Cmd+B", win: "Ctrl+Shift+B" } },
			source,
		}).prepareBinding(execute);
		binding.activate();

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "KeyB",
			ctrlKey: true,
			key: "b",
			repeat: true,
			shiftKey: true,
		});
		const stopPropagation = vi.spyOn(event, "stopPropagation");
		source.dispatchEvent(event);

		expect(execute).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
		expect(stopPropagation).toHaveBeenCalledOnce();
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
