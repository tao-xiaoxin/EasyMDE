type WordPressHooks = Readonly<{
	addAction: (
		hook: string,
		namespace: string,
		callback: (...args: ReadonlyArray<unknown>) => void,
	) => void;
	removeAction: (hook: string, namespace: string) => void;
}>;

type WordPressRuntime = Readonly<{
	apiFetch: unknown;
	hooks: WordPressHooks;
}>;

export type AdminEditorLoaderBootstrap = Readonly<{
	editorBootstrap: unknown;
	failureMessage: string;
	mainScriptUrl: string;
}>;

export type AdminEditorLoaderStartRuntime = Readonly<{
	bootstrap: unknown;
	document: Document;
	failureMessage: string;
	window: Window;
	wordpress: WordPressRuntime;
}>;

export type AdminEditorMainStart = (
	runtime: AdminEditorLoaderStartRuntime,
) => () => void;

type AdminEditorLoaderWindow = Window & {
	EasyMDEAdminEditorStart?: AdminEditorMainStart;
	EasyMDEAdminEditorLoaderState?: AdminEditorLoaderState;
	EasyMDEEditorRootBootstrap?: unknown;
	wp?: {
		apiFetch?: unknown;
		hooks?: Partial<WordPressHooks>;
	};
};

export type AdminEditorLoaderRuntime = Readonly<{
	document: Document;
	mainStart?: AdminEditorMainStart;
	window: Window;
}>;

type AdminEditorLoaderState = Readonly<{
	teardown: () => void;
}>;

type MutableLoaderState = {
	active: boolean;
	domObserver: MutationObserver | null;
	domReady: boolean;
	failureCode: string | null;
	failureRendered: boolean;
	loaded: boolean;
	mainTeardown: (() => void) | null;
	script: HTMLScriptElement | null;
	teardown: () => void;
};

const domGateSelectors = [
	"#easymde-editor-root",
	"#post",
	"#post_ID",
	"#title",
	"#content",
	"#easymde-source",
	"#easymde-enabled-field",
	"#easymde-code-theme-field",
	"#easymde-code-theme-explicit-field",
	"#easymde-custom-css-id-field",
	"#easymde-markdown-theme-field",
	"#easymde-apple-font-field",
	"#easymde-custom-font-field",
	"#easymde-serif-font-field",
	"#easymde-windows-font-field",
] as const;

function objectValue(value: unknown): Record<string, unknown> | null {
	return value && "object" === typeof value && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseBootstrap(value: unknown): AdminEditorLoaderBootstrap {
	const candidate = objectValue(value);
	if (!candidate) throw new Error("react-editor-loader-bootstrap-invalid");

	const mainScriptUrl = candidate.mainScriptUrl;
	const failureMessage = candidate.failureMessage;
	if (
		"string" !== typeof mainScriptUrl ||
		!mainScriptUrl.trim() ||
		"string" !== typeof failureMessage ||
		!failureMessage.trim() ||
		!("editorBootstrap" in candidate)
	) {
		throw new Error("react-editor-loader-bootstrap-invalid");
	}

	return {
		editorBootstrap: candidate.editorBootstrap,
		failureMessage,
		mainScriptUrl,
	};
}

function failureCode(error: unknown): string {
	return error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
		? error.message
		: "react-editor-loader-startup-failed";
}

function showStartupFailure(
	documentRef: Document,
	message: string,
	code: string,
): boolean {
	const root = documentRef.querySelector<HTMLElement>("#easymde-editor-root");
	if (!root) return false;

	root.replaceChildren();
	const notice = documentRef.createElement("div");
	notice.className = "notice notice-error easymde-editor-startup-error";
	notice.dataset.easymdeStartupError = code;
	notice.setAttribute("role", "alert");
	const paragraph = documentRef.createElement("p");
	paragraph.textContent = message;
	notice.append(paragraph);
	root.append(notice);
	console.error(`[EasyMDE] ${code}`);
	return true;
}

function assertSameOriginUrl(value: string, windowRef: Window): URL {
	let url: URL;
	try {
		url = new URL(value, windowRef.location.href);
	} catch {
		throw new Error("react-editor-loader-url-invalid");
	}

	if (
		url.origin !== windowRef.location.origin ||
		url.username ||
		url.password ||
		!["http:", "https:"].includes(url.protocol)
	) {
		throw new Error("react-editor-loader-url-origin-invalid");
	}

	return url;
}

function hasEditorDom(documentRef: Document): boolean {
	return domGateSelectors.every((selector) =>
		documentRef.querySelector(selector),
	);
}

function wordpressRuntime(
	windowRef: AdminEditorLoaderWindow,
): WordPressRuntime {
	const candidate = windowRef.wp;
	const hooks = candidate?.hooks;
	if (
		!candidate ||
		"function" !== typeof candidate.apiFetch ||
		!hooks ||
		"function" !== typeof hooks.addAction ||
		"function" !== typeof hooks.removeAction
	) {
		throw new Error("react-editor-wordpress-runtime-unavailable");
	}

	return {
		apiFetch: candidate.apiFetch,
		hooks: hooks as WordPressHooks,
	};
}

function setFetchPriority(script: HTMLScriptElement): void {
	script.setAttribute("fetchpriority", "high");
	const candidate = script as HTMLScriptElement & {
		fetchPriority?: string;
	};
	candidate.fetchPriority = "high";
}

export function startAdminEditorLoader(
	rawBootstrap: unknown,
	runtime: AdminEditorLoaderRuntime,
): () => void {
	const existing = runtime.window.EasyMDEAdminEditorLoaderState;
	if (existing) return existing.teardown;

	let bootstrap: AdminEditorLoaderBootstrap;
	try {
		bootstrap = parseBootstrap(rawBootstrap);
	} catch (error) {
		const root = runtime.document.querySelector<HTMLElement>(
			"#easymde-editor-root",
		);
		const code = failureCode(error);
		if (
			!showStartupFailure(
				runtime.document,
				root?.dataset.failureMessage || "EasyMDE could not start.",
				code,
			)
		) {
			console.error(`[EasyMDE] ${code}`);
		}
		return () => undefined;
	}
	const state: MutableLoaderState = {
		active: true,
		domObserver: null,
		domReady: false,
		failureCode: null,
		failureRendered: false,
		loaded: false,
		mainTeardown: null,
		script: null,
		teardown: () => undefined,
	};
	const documentRef = runtime.document;
	const windowRef = runtime.window as AdminEditorLoaderWindow;
	const failureMessage = (): string =>
		documentRef.querySelector<HTMLElement>("#easymde-editor-root")?.dataset
			.failureMessage || bootstrap.failureMessage;

	const disconnectDomObserver = (): void => {
		state.domObserver?.disconnect();
		state.domObserver = null;
	};

	const reportFailure = (): void => {
		if (!state.active || !state.failureCode || state.failureRendered) return;
		state.failureRendered = showStartupFailure(
			documentRef,
			failureMessage(),
			state.failureCode,
		);
		if (state.failureRendered) disconnectDomObserver();
	};

	const fail = (error: unknown): void => {
		if (!state.active || state.failureCode) return;
		state.failureCode = failureCode(error);
		reportFailure();
	};

	const tryStart = (): void => {
		if (!state.active || state.failureCode || state.mainTeardown) return;
		state.domReady = hasEditorDom(documentRef);
		if (!state.loaded || !state.domReady) return;

		try {
			const mainStart = runtime.mainStart ?? windowRef.EasyMDEAdminEditorStart;
			if ("function" !== typeof mainStart) {
				throw new Error("react-editor-main-entry-unavailable");
			}

			const wordpress = wordpressRuntime(windowRef);
			windowRef.EasyMDEEditorRootBootstrap = bootstrap.editorBootstrap;
			const teardown = mainStart({
				bootstrap: bootstrap.editorBootstrap,
				document: documentRef,
				failureMessage: failureMessage(),
				window: windowRef,
				wordpress,
			});
			if ("function" !== typeof teardown) {
				throw new Error("react-editor-main-teardown-invalid");
			}
			state.mainTeardown = teardown;
			disconnectDomObserver();
		} catch (error) {
			fail(error);
		}
	};

	const onDomContentLoaded = (): void => {
		tryStart();
		reportFailure();
	};
	const onPagehide = (): void => {
		state.teardown();
	};
	const observeDom = (): void => {
		const mutationObserverWindow = windowRef as Window &
			Pick<typeof globalThis, "MutationObserver">;
		if (
			state.domObserver ||
			state.failureRendered ||
			!mutationObserverWindow.MutationObserver
		)
			return;
		const target = documentRef.documentElement || documentRef;
		const observer = new mutationObserverWindow.MutationObserver(() => {
			tryStart();
			reportFailure();
		});
		state.domObserver = observer;
		observer.observe(target, { childList: true, subtree: true });
	};

	state.teardown = (): void => {
		if (!state.active) return;
		state.active = false;
		if (windowRef.EasyMDEAdminEditorLoaderState === state) {
			delete windowRef.EasyMDEAdminEditorLoaderState;
		}
		disconnectDomObserver();
		documentRef.removeEventListener("DOMContentLoaded", onDomContentLoaded);
		windowRef.removeEventListener("pagehide", onPagehide);
		if (state.script) {
			state.script.onload = null;
			state.script.onerror = null;
			state.script.remove();
			state.script = null;
		}
		state.mainTeardown?.();
		state.mainTeardown = null;
	};
	runtime.window.EasyMDEAdminEditorLoaderState = state;

	windowRef.addEventListener("pagehide", onPagehide, { once: true });
	documentRef.addEventListener("DOMContentLoaded", onDomContentLoaded, {
		once: true,
	});

	try {
		const url = assertSameOriginUrl(bootstrap.mainScriptUrl, windowRef);
		const head = documentRef.head;
		if (!head) throw new Error("react-editor-loader-head-unavailable");
		const script = documentRef.createElement("script");
		script.async = true;
		setFetchPriority(script);
		script.dataset.easymdeAdminEditorLoader = "";
		script.src = url.href;
		script.onload = (): void => {
			if (!state.active) return;
			state.loaded = true;
			tryStart();
		};
		script.onerror = (): void => {
			fail(new Error("react-editor-bundle-load-failed"));
			reportFailure();
		};
		state.script = script;
		head.append(script);
		observeDom();
		tryStart();
		reportFailure();
	} catch (error) {
		fail(error);
		observeDom();
		reportFailure();
	}

	return state.teardown;
}

declare global {
	interface Window {
		EasyMDEAdminEditorLoaderBootstrap?: unknown;
		EasyMDEAdminEditorLoaderState?: AdminEditorLoaderState;
	}
}

if (import.meta.env.MODE !== "test") {
	startAdminEditorLoader(window.EasyMDEAdminEditorLoaderBootstrap, {
		document,
		window: window as AdminEditorLoaderWindow,
	});
}
