import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type AdminEditorLoaderBootstrap,
	type AdminEditorLoaderRuntime,
	startAdminEditorLoader,
} from "./admin-editor-loader";

const mainScriptUrl =
	"/wp-content/plugins/easymde/assets/build/assets/admin-editor-test.js";

function bootstrap(
	overrides: Partial<AdminEditorLoaderBootstrap> = {},
): AdminEditorLoaderBootstrap {
	return {
		editorBootstrap: { schemaVersion: 2 },
		failureMessage: "EasyMDE could not start.",
		mainScriptUrl,
		...overrides,
	};
}

function editorDom(): void {
	document.body.innerHTML = `
    <form id="post">
      <input id="post_ID" value="11">
      <input id="title" value="Title">
      <input id="easymde-enabled-field" value="1">
      <textarea id="easymde-source"></textarea>
      <input id="easymde-code-theme-field">
      <input id="easymde-code-theme-explicit-field">
      <input id="easymde-custom-css-id-field">
      <input id="easymde-markdown-theme-field">
      <input id="easymde-apple-font-field">
      <input id="easymde-custom-font-field">
      <input id="easymde-serif-font-field">
      <input id="easymde-windows-font-field">
    </form>
    <div id="postdivrich"><textarea id="content"></textarea></div>
    <div id="easymde-editor-root" data-failure-message="EasyMDE could not start."></div>
  `;
}

function runtime(
	mainStart?: AdminEditorLoaderRuntime["mainStart"],
): AdminEditorLoaderRuntime {
	return mainStart ? { document, mainStart, window } : { document, window };
}

async function settleMutationObserver(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function loaderScript(): HTMLScriptElement {
	const script = document.querySelector<HTMLScriptElement>(
		"script[data-easymde-admin-editor-loader]",
	);
	if (!script) throw new Error("loader-script-unavailable");
	return script;
}

describe("startAdminEditorLoader", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		document.head
			.querySelectorAll("script[data-easymde-admin-editor-loader]")
			.forEach((script) => {
				script.remove();
			});
		delete (window as Window & { EasyMDEAdminEditorLoaderState?: unknown })
			.EasyMDEAdminEditorLoaderState;
		(window as Window & { wp?: unknown }).wp = {
			apiFetch: vi.fn(),
			hooks: { addAction: vi.fn(), removeAction: vi.fn() },
		};
	});

	it("loads the main entry with high fetch priority and waits for the complete DOM gate", async () => {
		const mainStart = vi.fn(() => vi.fn());
		const teardown = startAdminEditorLoader(bootstrap(), runtime(mainStart));
		const script = loaderScript();

		expect(script.async).toBe(true);
		expect(script.fetchPriority).toBe("high");
		expect(script.src).toBe(new URL(mainScriptUrl, window.location.href).href);
		expect(mainStart).not.toHaveBeenCalled();

		script.dispatchEvent(new Event("load"));
		expect(mainStart).not.toHaveBeenCalled();

		editorDom();
		await settleMutationObserver();

		expect(mainStart).toHaveBeenCalledWith(
			expect.objectContaining({
				bootstrap: { schemaVersion: 2 },
				document,
				window,
				wordpress: expect.any(Object),
			}),
		);
		teardown();
	});

	it("starts when the DOM gate is ready before the dynamic entry finishes loading", async () => {
		editorDom();
		const mainStart = vi.fn(() => vi.fn());
		const teardown = startAdminEditorLoader(bootstrap(), runtime(mainStart));

		expect(mainStart).not.toHaveBeenCalled();
		loaderScript().dispatchEvent(new Event("load"));
		await settleMutationObserver();

		expect(mainStart).toHaveBeenCalledOnce();
		teardown();
	});

	it("does not hide the native editor before the main entry owns the document", async () => {
		editorDom();
		const nativeEditor = document.querySelector<HTMLElement>("#postdivrich");
		const mainStart = vi.fn(() => vi.fn());
		startAdminEditorLoader(bootstrap(), runtime(mainStart));
		loaderScript().dispatchEvent(new Event("load"));
		await settleMutationObserver();

		expect(mainStart).toHaveBeenCalledOnce();
		expect(
			nativeEditor?.classList.contains("easymde-native-editor-hidden"),
		).toBe(false);
	});

	it("reports a script load failure without hiding the native editor", async () => {
		editorDom();
		const nativeEditor = document.querySelector<HTMLElement>("#postdivrich");
		const mainStart = vi.fn(() => vi.fn());
		const teardown = startAdminEditorLoader(bootstrap(), runtime(mainStart));
		loaderScript().dispatchEvent(new Event("error"));
		await settleMutationObserver();

		expect(mainStart).not.toHaveBeenCalled();
		expect(
			document.querySelector(".easymde-editor-startup-error")?.textContent,
		).toContain("EasyMDE could not start.");
		expect(
			nativeEditor?.classList.contains("easymde-native-editor-hidden"),
		).toBe(false);
		teardown();
	});

	it("is idempotent across repeated starts and tears down the main entry on pagehide", async () => {
		editorDom();
		const mainTeardown = vi.fn();
		const mainStart = vi.fn(() => mainTeardown);
		const firstTeardown = startAdminEditorLoader(
			bootstrap(),
			runtime(mainStart),
		);
		const secondTeardown = startAdminEditorLoader(
			bootstrap(),
			runtime(mainStart),
		);
		expect(firstTeardown).toBe(secondTeardown);
		expect(
			document.querySelectorAll("script[data-easymde-admin-editor-loader]"),
		).toHaveLength(1);

		loaderScript().dispatchEvent(new Event("load"));
		await settleMutationObserver();
		expect(mainStart).toHaveBeenCalledOnce();

		window.dispatchEvent(new Event("pagehide"));
		expect(mainTeardown).toHaveBeenCalledOnce();
		firstTeardown();
		expect(mainTeardown).toHaveBeenCalledOnce();
	});

	it("fails closed for an invalid cross-origin main entry URL", async () => {
		editorDom();
		const mainStart = vi.fn(() => vi.fn());
		const teardown = startAdminEditorLoader(
			bootstrap({ mainScriptUrl: "https://attacker.example/editor.js" }),
			runtime(mainStart),
		);
		await settleMutationObserver();

		expect(mainStart).not.toHaveBeenCalled();
		expect(
			document.querySelector(".easymde-editor-startup-error")?.textContent,
		).toContain("EasyMDE could not start.");
		expect(
			document.querySelectorAll("script[data-easymde-admin-editor-loader]"),
		).toHaveLength(0);
		teardown();
	});

	it("reports a missing main entry export instead of leaving a false ready state", async () => {
		editorDom();
		const teardown = startAdminEditorLoader(bootstrap(), runtime());
		loaderScript().dispatchEvent(new Event("load"));
		await settleMutationObserver();

		expect(
			document.querySelector(".easymde-editor-startup-error")?.textContent,
		).toContain("EasyMDE could not start.");
		teardown();
	});
});
