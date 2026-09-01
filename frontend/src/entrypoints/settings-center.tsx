import { createElement, createRoot, flushSync } from "@wordpress/element";

import { SettingsCenterRoot } from "../app/settings/SettingsCenterRoot";
import { parseSettingsCenterBootstrap } from "../contracts/bootstrap/settings-center-bootstrap";

type SettingsCenterBrowserRuntime = Readonly<{
	document: Document;
	window: Window;
}>;

export function showSettingsCenterStartupFailure(
	root: HTMLElement | null,
	message: string,
	code: string,
	closeUrl: string,
	closeLabel = "Return to WordPress settings",
): void {
	if (root) {
		root.replaceChildren();
		const notice = root.ownerDocument.createElement("div");
		notice.className =
			"notice notice-error easymde-settings-center-startup-error";
		notice.setAttribute("role", "alert");
		const paragraph = root.ownerDocument.createElement("p");
		paragraph.textContent =
			message.trim() ||
			"EasyMDE Settings Center could not start. WordPress settings remain available.";
		notice.append(paragraph);
		const exit = root.ownerDocument.createElement("a");
		exit.href = closeUrl;
		exit.textContent = closeLabel;
		notice.append(exit);
		root.append(notice);
	}
	console.error(`[EasyMDE] ${code}`);
}

function assertSameOriginUrl(value: string, windowRef: Window): void {
	const url = new URL(value, windowRef.location.href);
	if (
		url.origin !== windowRef.location.origin ||
		url.username ||
		url.password
	) {
		throw new Error("settings-center-url-origin-invalid");
	}
}

function assertEmptyRoot(container: HTMLElement): void {
	if (container.childNodes.length > 0) {
		throw new Error("settings-center-root-not-empty");
	}
}

function assertSettingsCenterStylesheet(
	documentRef: Document,
	windowRef: Window,
): void {
	const stylesheet = documentRef.querySelector<HTMLLinkElement>(
		"#easymde-admin-settings-center-css",
	);
	if (
		stylesheet === null ||
		stylesheet.tagName !== "LINK" ||
		stylesheet.sheet === null ||
		windowRef
			.getComputedStyle(documentRef.documentElement)
			.getPropertyValue("--easymde-settings-center-styles-ready")
			.trim() !== "1"
	) {
		throw new Error("settings-center-stylesheet-unavailable");
	}
}

export function mountSettingsCenter(
	rawBootstrap: unknown,
	runtime: SettingsCenterBrowserRuntime,
): () => void {
	const container = runtime.document.querySelector<HTMLElement>(
		"#easymde-settings-center-root",
	);
	if (!container) throw new Error("settings-center-root-unavailable");

	const bootstrap = parseSettingsCenterBootstrap(rawBootstrap);
	assertSameOriginUrl(bootstrap.closeUrl, runtime.window);
	assertSettingsCenterStylesheet(runtime.document, runtime.window);
	assertEmptyRoot(container);

	const root = createRoot(container);
	const overlayRoot = runtime.document.createElement("div");
	overlayRoot.dataset.settingsOverlayRoot = "";
	let active = true;
	try {
		container.insertAdjacentElement("afterend", overlayRoot);
		flushSync(() => {
			root.render(
				<SettingsCenterRoot bootstrap={bootstrap} overlayRoot={overlayRoot} />,
			);
		});
	} catch (error) {
		active = false;
		root.unmount();
		overlayRoot.remove();
		throw error;
	}

	return () => {
		if (!active) return;
		active = false;
		root.unmount();
		overlayRoot.remove();
	};
}

declare global {
	interface Window {
		EasyMDESettingsCenterBootstrap?: unknown;
		EasyMDESettingsCenterStarted?: boolean;
	}
}

export function startSettingsCenter(
	rawBootstrap: unknown,
	runtime: SettingsCenterBrowserRuntime,
): () => void {
	let observer: MutationObserver | null = null;
	let teardownRoot: (() => void) | null = null;
	let active = true;

	const mountWhenReady = (): boolean => {
		if (!active || teardownRoot) return true;
		const root = runtime.document.querySelector<HTMLElement>(
			"#easymde-settings-center-root",
		);
		if (!root) return false;

		observer?.disconnect();
		try {
			teardownRoot = mountSettingsCenter(rawBootstrap, runtime);
			runtime.document
				.querySelector("[data-settings-center-server-fallback]")
				?.remove();
		} catch (error) {
			const code =
				error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
					? error.message
					: "settings-center-startup-failed";
			showSettingsCenterStartupFailure(
				root,
				root.dataset.failureMessage ?? "",
				code,
				root.dataset.closeUrl ?? "",
				root.dataset.closeLabel ?? "",
			);
			runtime.document
				.querySelector("[data-settings-center-server-fallback]")
				?.remove();
		}
		return true;
	};

	if (!mountWhenReady()) {
		const runtimeWindow = runtime.window as Window &
			Pick<typeof globalThis, "MutationObserver">;
		const pendingObserver = new runtimeWindow.MutationObserver(mountWhenReady);
		observer = pendingObserver;
		pendingObserver.observe(runtime.document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	return () => {
		if (!active) return;
		active = false;
		observer?.disconnect();
		teardownRoot?.();
	};
}

if (import.meta.env.MODE !== "test") {
	window.EasyMDESettingsCenterStarted = true;
	const teardown = startSettingsCenter(window.EasyMDESettingsCenterBootstrap, {
		document,
		window,
	});
	window.addEventListener("pagehide", teardown, { once: true });
}
