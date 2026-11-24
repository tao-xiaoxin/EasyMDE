import { createRoot } from "@wordpress/element";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEditorRootBootstrap } from "../contracts/bootstrap/editor-root-bootstrap";
import type { EditorClipboardPort } from "../contracts/ports/editor-clipboard-port";
import type { WechatClipboardPort } from "../contracts/ports/wechat-clipboard-port";
import { createBrowserEditorBlockIndexWorker } from "../integrations/browser/editor-context-menu/create-browser-editor-block-index-worker";
import { createBrowserLocalDraftStorage } from "../integrations/browser/local-drafts/browser-local-draft-storage";
import { createBrowserWechatClipboard } from "../integrations/browser/wechat/create-browser-wechat-clipboard";
import { createBrowserWechatPngEncoder } from "../integrations/browser/wechat/create-browser-wechat-png-encoder";
import { createBrowserPreviewEnhancementPort } from "../integrations/preview-runtime/browser-preview-enhancement";
import {
	createWordPressAppearancePort,
	resolveAppearanceArticleThemeUrl,
} from "../integrations/wordpress/appearance/create-wordpress-appearance-port";
import { createWordPressImageUploadPort } from "../integrations/wordpress/media/wordpress-image-upload";
import { createWordPressMediaFramePort } from "../integrations/wordpress/media/wordpress-media-frame";
import { mountAdminEditor } from "./admin-editor";

vi.hoisted(() => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

vi.mock("@wordpress/element", async (importOriginal) => ({
	...(await importOriginal<typeof import("@wordpress/element")>()),
	createRoot: vi.fn(),
}));
vi.mock("../contracts/bootstrap/editor-root-bootstrap", () => ({
	parseEditorRootBootstrap: vi.fn(),
}));
vi.mock(
	"../integrations/browser/editor-layout/create-browser-scroll-sync",
	() => ({ createBrowserScrollSync: vi.fn(() => ({})) }),
);
vi.mock(
	"../integrations/browser/editor-context-menu/create-browser-editor-block-index-worker",
	() => ({
		createBrowserEditorBlockIndexWorker: vi.fn(() => ({
			build: vi.fn(),
			dispose: vi.fn(),
		})),
	}),
);
vi.mock(
	"../integrations/browser/keyboard/create-browser-toolbar-shortcuts",
	() => ({ createBrowserToolbarShortcuts: vi.fn(() => ({})) }),
);
vi.mock(
	"../integrations/browser/local-drafts/browser-local-draft-storage",
	() => ({
		createBrowserLocalDraftStorage: vi.fn(() => ({
			fingerprint: vi.fn(() => "saved-fingerprint"),
		})),
	}),
);
vi.mock(
	"../integrations/browser/preview/create-browser-preview-scroll",
	() => ({ createBrowserPreviewScroll: vi.fn(() => ({})) }),
);
vi.mock(
	"../integrations/browser/wechat/create-browser-wechat-clipboard",
	() => ({
		createBrowserWechatClipboard: vi.fn(() => ({
			copy: vi.fn().mockResolvedValue({ method: "clipboard", status: "copied" }),
			prepare: vi.fn().mockResolvedValue(undefined),
			releasePrepared: vi.fn(),
			rememberPreviewWidth: vi.fn(),
		})),
	}),
);
vi.mock(
	"../integrations/browser/wechat/create-browser-wechat-png-encoder",
	() => ({ createBrowserWechatPngEncoder: vi.fn(() => null) }),
);
vi.mock("../integrations/preview-runtime/browser-preview-enhancement", () => ({
	createBrowserPreviewEnhancementPort: vi.fn(() => ({})),
	createWindowPreviewEnhancementRuntime: vi.fn(() => ({})),
}));
vi.mock(
	"../integrations/wordpress/appearance/create-wordpress-appearance-port",
	() => ({
		createWordPressAppearancePort: vi.fn(() => ({ dispose: vi.fn() })),
		resolveAppearanceArticleThemeUrl: vi.fn(
			() => "https://example.test/assets/themes/article/default.css",
		),
	}),
);
vi.mock(
	"../integrations/wordpress/appearance/create-wordpress-font-controls-port",
	() => ({ createWordPressFontControlsPort: vi.fn(() => ({})) }),
);
vi.mock("../integrations/wordpress/media/wordpress-image-upload", () => ({
	createWordPressImageUploadPort: vi.fn(() => ({})),
}));
vi.mock(
	"../integrations/wordpress/media/wordpress-remote-image-import",
	() => ({
		createWordPressRemoteImageImportPort: vi.fn(() => ({})),
	}),
);
vi.mock("../integrations/wordpress/media/wordpress-media-frame", () => ({
	createWordPressMediaFramePort: vi.fn(() => ({})),
}));
vi.mock(
	"../integrations/wordpress/native-form/wordpress-native-submission",
	() => ({ createWordPressNativeSubmissionPort: vi.fn(() => ({})) }),
);
vi.mock(
	"../integrations/wordpress/preview/create-wordpress-preview-port",
	() => ({ createWordPressPreviewPort: vi.fn(() => ({})) }),
);
vi.mock(
	"../integrations/wordpress/session/create-wordpress-editor-session-port",
	() => ({ createWordPressEditorSessionPort: vi.fn(() => ({})) }),
);

function installEditorStylesheets() {
	document.head.replaceChildren();
	const content = document.createElement("style");
	content.id = "easymde-content-css";
	content.textContent = ".easymde-rendered-content p { color: black; }";
	const articleSheet = document.createElement("style");
	articleSheet.textContent = ".easymde-rendered-content h1 { margin: 0; }";
	document.head.append(content, articleSheet);
	const article = document.createElement("link");
	article.id = "easymde-article-theme-css";
	article.rel = "stylesheet";
	article.href = "https://example.test/assets/themes/article/default.css";
	Object.defineProperty(article, "sheet", {
		configurable: true,
		value: articleSheet.sheet,
	});
	document.head.append(article);
}

const bootstrap = {
	appearance: {},
	document: {},
	referenceLabelCaseFoldProfile: 14,
	editorBlockIndexWorkerUrl:
		"https://example.test/wp-content/plugins/easymde/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js",
	fonts: {},
	imageUpload: {
		actionNonce: "image-hosting-nonce",
		allowedExtensions: ["webp", "png", "jpg", "jpeg", "jfif", "gif"],
		endpoint: "/image-hosting/upload",
		importEndpoint: "/image-hosting/import",
		nonce: "nonce",
		postId: 7,
		remoteImageUploadMode: "both",
		uploadOwner: "image-hosting",
	},
	immersiveStrings: {
		autoSave: "Auto save",
		autoSaveEnabled: "Auto save is enabled",
		articleOutline: "Article outline",
		cancel: "Cancel",
		close: "Close",
		column: "Column",
		edit: "Edit",
		editMode: "Edit mode",
		editorSettings: "Editor settings",
		enter: "Enter immersive writing",
		expand: "Expand",
		exit: "Exit immersive writing",
		hideOutline: "Hide outline",
		history: "History",
		historyEmpty: "No revisions",
		historyError: "Revision error",
		historyLoading: "Loading revisions",
		historyAll: "All",
		historyVersions: "Revision history",
		immersive: "Immersive writing",
		insert: "Insert",
		insertTable: "Insert table",
		line: "Line",
		manualSave: "Manual save",
		moreActions: "More actions",
		markdown: "Markdown",
		noHeadings: "No headings",
		outline: "Article outline",
		outlineDescription: "Show heading navigation on the left",
		preview: "Preview",
		previewChangesRecorded: "Changes recorded",
		previewContentLoaded: "Content loaded",
		previewEditable: "Editable",
		previewEditorLabel: "Visual article editor",
		previewLockReadOnly: "Lock as read only",
		previewReadOnly: "Read only",
		previewUnlockEdit: "Unlock and edit",
		previewMode: "Preview mode",
		protectedCardEditFormat: "Edit %s",
		protectedCardFootnotes: "Footnotes",
		protectedCardMath: "Math",
		protectedCardMermaid: "Mermaid",
		protectedCardRaw: "Raw",
		protectedCardSave: "Save",
		protectedCardSourceFormat: "%s source",
		protectedCardToc: "TOC",
		publish: "Publish article",
		restore: "Restore revision",
		restoreConfirm: "Unsaved changes will be lost",
		restoreThisVersion: "Restore this revision",
		resizeOutline: "Resize article outline",
		saved: "Saved",
		settings: "Settings",
		showOutline: "Show outline",
		split: "Split",
		splitMode: "Split mode",
		splitPreview: "Split preview",
		splitPreviewDescription:
			"Live preview editing area (what you see is what you get)",
		table: "Table",
		tableColumns: "Columns",
		tableRows: "Rows",
		theme: "Theme",
		themeSettings: "Theme settings",
		addTags: "Add tags",
		categories: "Categories",
		categoriesDescription: "Choose categories.",
		categoriesSelected: "Selected: %s",
		closePublish: "Close publish dialog",
		collapse: "Collapse",
		continueAddingTags: "Continue adding...",
		excerpt: "Excerpt",
		excerptPlaceholder: "Write an excerpt...",
		featuredImage: "Featured image",
		imageRecommendation: "Landscape images are recommended",
		imageRequirements: "Supports JPG, PNG, and WebP, max 5MB",
		noWriteBeforeSubmit: "Nothing is written before submission.",
		password: "Password",
		passwordPlaceholder: "Enter access password",
		passwordRequired: "Enter an access password.",
		preparingPublish: "Ready to publish",
		private: "Private",
		privateDescription: "Only editors can view this article.",
		public: "Public",
		publishDescription: "Confirm article details.",
		publishFailed:
			"WordPress did not accept the publish request. Check the page state and try again.",
		publishLoadingPreview: "Loading preview...",
		remove: "Remove",
		removeTag: "Remove tag: %s",
		replace: "Replace",
		selectFeaturedImage: "Select featured image",
		sticky: "Stick to the top",
		tags: "Tags",
		tagsDescription: "Press Enter or comma.",
		updateArticle: "Update article",
		updateDescription: "Confirm article changes.",
		updateExisting: "Update existing article",
		visibility: "Visibility",
		title: "Article title",
		unsaved: "Unsaved",
		viewModes: "View modes",
		wechat: "Copy to WeChat",
		wechatCopied: "Copied",
	},
	labels: {
		mediaPickerFailure: "Media failed",
		preview: "Preview",
		source: "Markdown",
		toolbar: "Toolbar",
	},
	layout: {},
	localDrafts: { locale: "en_US", postId: 7 },
	mediaPicker: {
		canUseMedia: true,
		defaultAlt: "image",
		frameUrl:
			"https://example.test/wp-admin/admin-post.php?action=easymde_media_picker",
		insertMedia: "Insert Media",
		insertion: { titleDisplay: "none" },
		placeholderAlt: "alt text",
	},
	preview: { postId: 7 },
	previewEnhancement: {
		assetBaseUrl: "https://example.test/plugin/",
		assets: {
			katexCssUrl:
				"https://example.test/plugin/assets/vendor/katex/katex.min.css",
		},
	},
	toolbar: { commands: [], shortcuts: [] },
	wechatExport: {
		wechatMathAtlasContentVersion: "0123456789abcdef",
		wechatMathAtlasUrl:
			"https://example.test/plugin/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef",
	},
	wordpress: {
		customCssUrl: "/custom-css",
		isNewPost: false,
		nonce: "nonce",
		publishCategories: [],
		previewUrl: "/preview",
		revisionsUrl: "/posts/",
	},
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, reject, resolve };
}

function realAppearanceBootstrap(markdownTheme: string = "newsprint") {
	return {
		articleThemes: [
			{
				cssUrl: "assets/themes/article/default.css",
				defaultCodeTheme: "atom-one-dark",
				id: "default",
				label: "Default",
				markupProfile: "common-v1",
			},
			{
				cssUrl: "assets/themes/article/newsprint.css",
				defaultCodeTheme: "atom-one-dark",
				id: "newsprint",
				label: "Newsprint",
				markupProfile: "common-v1",
			},
		],
		canManageCustomCss: false,
		codeThemeExplicit: false,
		codeThemes: [{ id: "atom-one-dark", label: "Atom One Dark" }],
		customCss: [],
		customCssVariables: [],
		customMarkupProfile: "common-v1",
		state: {
			codeTheme: "atom-one-dark",
			customCssId: "",
			markdownTheme,
		},
		strings: {} as never,
	};
}

function bootstrapWithRealAppearance(markdownTheme: string = "newsprint") {
	return {
		...bootstrap,
		appearance: realAppearanceBootstrap(markdownTheme),
		previewEnhancement: {
			...bootstrap.previewEnhancement,
			assetBaseUrl: "https://example.test/",
		},
	};
}

function attachCandidateStylesheet(
	candidate: HTMLLinkElement,
	articleSheet: CSSStyleSheet,
): void {
	Object.defineProperty(candidate, "sheet", {
		configurable: true,
		value: articleSheet,
	});
	candidate.dispatchEvent(new Event("load"));
}

describe("mountAdminEditor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createWordPressAppearancePort).mockImplementation(
			() =>
				({
					dispose: vi.fn(),
				}) as never,
		);
		vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(
			"https://example.test/assets/themes/article/default.css",
		);
		installEditorStylesheets();
		document.body.innerHTML = `
      <form id="post">
        <input id="post_ID" value="11">
        <input id="title" value="Title">
        <input id="easymde-enabled-field" value="1">
        <textarea id="easymde-source"># Markdown</textarea>
        <input id="easymde-code-theme-field">
        <input id="easymde-code-theme-explicit-field" value="0">
        <input id="easymde-custom-css-id-field">
        <input id="easymde-markdown-theme-field">
        <input id="easymde-apple-font-field">
        <input id="easymde-custom-font-field">
        <input id="easymde-serif-font-field">
        <input id="easymde-windows-font-field">
        <button id="save-post" type="button">Save Draft</button>
        <button id="publish" type="button">Publish</button>
      </form>
      <div id="postdivrich"><textarea id="content"></textarea></div>
      <div id="easymde-editor-root"></div>
    `;
		vi.mocked(parseEditorRootBootstrap).mockReturnValue(bootstrap as never);
	});

	it("uses the real appearance constructor after provisional candidate handoff", async () => {
		const actual = await vi.importActual<
			typeof import("../integrations/wordpress/appearance/create-wordpress-appearance-port")
		>("../integrations/wordpress/appearance/create-wordpress-appearance-port");
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		vi.mocked(parseEditorRootBootstrap).mockReturnValue(
			bootstrapWithRealAppearance() as never,
		);
		const target = "https://example.test/assets/themes/article/newsprint.css";
		vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(target);
		const original = document.querySelector<HTMLLinkElement>(
			"#easymde-article-theme-css",
		);
		const articleSheet = document.querySelector<HTMLStyleElement>(
			"style:not(#easymde-content-css)",
		)?.sheet;
		if (!original || !articleSheet)
			throw new Error("test-article-style-missing");
		const originalRuleCount = articleSheet.cssRules.length;
		const observed: Array<
			Readonly<{
				canonicalIsCandidate: boolean;
				oldConnected: boolean;
				renderCalls: number;
			}>
		> = [];
		vi.mocked(createWordPressAppearancePort).mockImplementation((options) => {
			const candidate = Array.from(
				options.document.querySelectorAll<HTMLLinkElement>("link"),
			).find((link) => link !== original);
			observed.push({
				canonicalIsCandidate:
					options.document.querySelector("#easymde-article-theme-css") ===
					candidate,
				oldConnected: original.isConnected,
				renderCalls: render.mock.calls.length,
			});
			return actual.createWordPressAppearancePort(options);
		});

		const onStartupFailure = vi.fn();
		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure,
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});
		const candidate = Array.from(
			document.querySelectorAll<HTMLLinkElement>("link"),
		).find((link) => link !== original);
		if (!candidate) throw new Error("test-article-candidate-missing");
		attachCandidateStylesheet(candidate, articleSheet);

		expect(observed).toEqual([
			{
				canonicalIsCandidate: true,
				oldConnected: true,
				renderCalls: 0,
			},
		]);
		expect(render).toHaveBeenCalledOnce();
		expect(document.querySelector("#easymde-article-theme-css")).toBe(
			candidate,
		);
		expect(original.isConnected).toBe(false);
		expect(onStartupFailure).not.toHaveBeenCalled();

		teardown();
		expect(articleSheet.cssRules).toHaveLength(originalRuleCount);
	});

	it("reports a real appearance-constructor failure after disposing every prior owner once", async () => {
		const actual = await vi.importActual<
			typeof import("../integrations/wordpress/appearance/create-wordpress-appearance-port")
		>("../integrations/wordpress/appearance/create-wordpress-appearance-port");
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const enhancementDispose = vi.fn();
		vi.mocked(createBrowserPreviewEnhancementPort).mockReturnValue({
			dispose: enhancementDispose,
		} as never);
		const mediaDispose = vi.fn();
		vi.mocked(createWordPressMediaFramePort).mockReturnValue({
			dispose: mediaDispose,
		} as never);
		vi.mocked(parseEditorRootBootstrap).mockReturnValue(
			bootstrapWithRealAppearance("missing") as never,
		);
		vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(
			"https://example.test/assets/themes/article/newsprint.css",
		);
		vi.mocked(createWordPressAppearancePort).mockImplementation((options) =>
			actual.createWordPressAppearancePort(options),
		);
		const original = document.querySelector<HTMLLinkElement>(
			"#easymde-article-theme-css",
		);
		const articleSheet = document.querySelector<HTMLStyleElement>(
			"style:not(#easymde-content-css)",
		)?.sheet;
		if (!original || !articleSheet)
			throw new Error("test-article-style-missing");
		const originalRuleCount = articleSheet.cssRules.length;
		const onStartupFailure = vi.fn();
		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure,
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});
		const candidate = Array.from(
			document.querySelectorAll<HTMLLinkElement>("link"),
		).find((link) => link !== original);
		if (!candidate) throw new Error("test-article-candidate-missing");
		attachCandidateStylesheet(candidate, articleSheet);

		expect(onStartupFailure).toHaveBeenCalledWith(
			"appearance-article-theme-asset-unavailable",
		);
		expect(onStartupFailure).toHaveBeenCalledOnce();
		expect(unmount).toHaveBeenCalledOnce();
		expect(enhancementDispose).toHaveBeenCalledOnce();
		expect(mediaDispose).toHaveBeenCalledOnce();
		expect(render).not.toHaveBeenCalled();
		expect(candidate.isConnected).toBe(false);
		expect(document.querySelector("#easymde-article-theme-css")).toBe(original);
		expect(original.isConnected).toBe(true);
		expect(articleSheet.cssRules).toHaveLength(originalRuleCount);
		teardown();
		expect(onStartupFailure).toHaveBeenCalledOnce();
	});

	it("reports a real-root render failure and disposes the real appearance port once", async () => {
		const actual = await vi.importActual<
			typeof import("../integrations/wordpress/appearance/create-wordpress-appearance-port")
		>("../integrations/wordpress/appearance/create-wordpress-appearance-port");
		const unmount = vi.fn();
		const render = vi.fn(() => {
			throw new Error("editor-render-failed");
		});
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const enhancementDispose = vi.fn();
		vi.mocked(createBrowserPreviewEnhancementPort).mockReturnValue({
			dispose: enhancementDispose,
		} as never);
		const mediaDispose = vi.fn();
		vi.mocked(createWordPressMediaFramePort).mockReturnValue({
			dispose: mediaDispose,
		} as never);
		vi.mocked(parseEditorRootBootstrap).mockReturnValue(
			bootstrapWithRealAppearance() as never,
		);
		vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(
			"https://example.test/assets/themes/article/newsprint.css",
		);
		let appearanceDisposeCalls = 0;
		vi.mocked(createWordPressAppearancePort).mockImplementation((options) => {
			const port = actual.createWordPressAppearancePort(options);
			const dispose = port.dispose;
			port.dispose = () => {
				appearanceDisposeCalls += 1;
				dispose();
			};
			return port;
		});
		const original = document.querySelector<HTMLLinkElement>(
			"#easymde-article-theme-css",
		);
		const articleSheet = document.querySelector<HTMLStyleElement>(
			"style:not(#easymde-content-css)",
		)?.sheet;
		if (!original || !articleSheet)
			throw new Error("test-article-style-missing");
		const originalRuleCount = articleSheet.cssRules.length;
		const onStartupFailure = vi.fn();
		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure,
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});
		const candidate = Array.from(
			document.querySelectorAll<HTMLLinkElement>("link"),
		).find((link) => link !== original);
		if (!candidate) throw new Error("test-article-candidate-missing");
		attachCandidateStylesheet(candidate, articleSheet);

		expect(onStartupFailure).toHaveBeenCalledWith("editor-render-failed");
		expect(onStartupFailure).toHaveBeenCalledOnce();
		expect(appearanceDisposeCalls).toBe(1);
		expect(unmount).toHaveBeenCalledOnce();
		expect(enhancementDispose).toHaveBeenCalledOnce();
		expect(mediaDispose).toHaveBeenCalledOnce();
		expect(candidate.isConnected).toBe(false);
		expect(document.querySelector("#easymde-article-theme-css")).toBe(original);
		expect(original.isConnected).toBe(true);
		expect(articleSheet.cssRules).toHaveLength(originalRuleCount);
		teardown();
		expect(appearanceDisposeCalls).toBe(1);
		expect(onStartupFailure).toHaveBeenCalledOnce();
	});

	it("commits an adjacent prepared candidate without moving it", () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const original = document.querySelector<HTMLLinkElement>(
			"#easymde-article-theme-css",
		);
		const originalParent = original?.parentElement;
		const articleSheet = document.querySelector<HTMLStyleElement>(
			"style:not(#easymde-content-css)",
		)?.sheet;
		if (!original || !articleSheet)
			throw new Error("test-article-style-missing");
		const target = "https://example.test/assets/themes/article/newsprint.css";
		vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(target);
		const onStartupFailure = vi.fn();
		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure,
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});
		const candidate = Array.from(
			document.querySelectorAll<HTMLLinkElement>("link"),
		).find((link) => link !== original);
		if (!candidate) throw new Error("test-article-candidate-missing");
		Object.defineProperty(candidate, "sheet", {
			configurable: true,
			value: articleSheet,
		});
		candidate.dispatchEvent(new Event("load"));

		expect(render).toHaveBeenCalledOnce();
		expect(document.querySelector("#easymde-article-theme-css")).toBe(
			candidate,
		);
		expect(candidate.media).toBe(original.media);
		expect(candidate.parentElement).toBe(originalParent);
		expect(onStartupFailure).not.toHaveBeenCalled();
		teardown();
	});

	it.each(["error", "timeout"] as const)(
		"cleans up an initial article candidate after stylesheet readiness %s",
		async (exit) => {
			if ("timeout" === exit) vi.useFakeTimers();
			try {
				vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(
					"https://example.test/assets/themes/article/newsprint.css",
				);
				const onStartupFailure = vi.fn();
				const original = document.querySelector<HTMLLinkElement>(
					"#easymde-article-theme-css",
				);
				if (!original) throw new Error("test-article-style-missing");
				const teardown = mountAdminEditor(bootstrap, {
					document,
					failureMessage: "Editor failed",
					onStartupFailure,
					window,
					wordpress: {
						apiFetch: Object.assign(vi.fn(), {
							nonceMiddleware: { nonce: "nonce" },
						}),
						hooks: { addAction: vi.fn(), removeAction: vi.fn() },
					},
				});
				const candidate = Array.from(
					document.querySelectorAll<HTMLLinkElement>("link"),
				).find((link) => link !== original);
				if (!candidate) throw new Error("test-article-candidate-missing");
				if ("error" === exit) candidate.dispatchEvent(new Event("error"));
				else await vi.advanceTimersByTimeAsync(15_000);
				expect(onStartupFailure).toHaveBeenCalledWith(
					"error" === exit
						? "editor-stylesheet-load-failed"
						: "editor-stylesheet-load-timeout",
				);
				expect(candidate.isConnected).toBe(false);
				expect(document.querySelector("#easymde-article-theme-css")).toBe(
					original,
				);
				teardown();
			} finally {
				if ("timeout" === exit) vi.useRealTimers();
			}
		},
	);

	it("restores the old article link and leases when prepared mount fails", () => {
		vi.mocked(resolveAppearanceArticleThemeUrl).mockReturnValue(
			"https://example.test/assets/themes/article/newsprint.css",
		);
		document.querySelector("#easymde-source")?.remove();
		const onStartupFailure = vi.fn();
		const original = document.querySelector<HTMLLinkElement>(
			"#easymde-article-theme-css",
		);
		const articleSheet = document.querySelector<HTMLStyleElement>(
			"style:not(#easymde-content-css)",
		)?.sheet;
		if (!original || !articleSheet)
			throw new Error("test-article-style-missing");
		const originalRuleCount = articleSheet.cssRules.length;
		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure,
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});
		const candidate = Array.from(
			document.querySelectorAll<HTMLLinkElement>("link"),
		).find((link) => link !== original);
		if (!candidate) throw new Error("test-article-candidate-missing");
		Object.defineProperty(candidate, "sheet", {
			configurable: true,
			value: articleSheet,
		});
		candidate.dispatchEvent(new Event("load"));

		expect(onStartupFailure).toHaveBeenCalledWith(
			"native-markdown-field-unavailable",
		);
		expect(document.querySelector("#easymde-article-theme-css")).toBe(original);
		expect(candidate.isConnected).toBe(false);
		expect(articleSheet.cssRules.length).toBe(originalRuleCount);
		expect(
			document.querySelector("#easymde-editor-root")?.childNodes,
		).toHaveLength(0);
		teardown();
	});

	it("mounts the production root once and returns idempotent teardown", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		const saveDraft = document.querySelector<HTMLButtonElement>("#save-post");
		const publish = document.querySelector<HTMLButtonElement>("#publish");
		const saveDraftClick = vi.spyOn(saveDraft as HTMLButtonElement, "click");
		const publishClick = vi
			.spyOn(publish as HTMLButtonElement, "click")
			.mockImplementation(() => {
				publish?.dispatchEvent(
					new MouseEvent("click", { bubbles: true, cancelable: true }),
				);
				publish
					?.closest("form")
					?.dispatchEvent(
						new SubmitEvent("submit", { bubbles: true, cancelable: true }),
					);
			});
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure: vi.fn(),
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});

		expect(createRoot).toHaveBeenCalledWith(
			document.querySelector("#easymde-editor-root"),
		);
		expect(createBrowserPreviewEnhancementPort).toHaveBeenCalledWith(
			bootstrap.previewEnhancement,
			expect.objectContaining({ editorRootSelector: "#easymde-editor-root" }),
		);
		expect(createWordPressAppearancePort).toHaveBeenCalledWith(
			expect.objectContaining({ editorRootSelector: "#easymde-editor-root" }),
		);
		expect(createBrowserWechatPngEncoder).toHaveBeenCalledWith(
			expect.objectContaining({ workerUrl: expect.any(String) }),
		);
		expect(createBrowserWechatClipboard).not.toHaveBeenCalled();
		expect(createBrowserLocalDraftStorage).toHaveBeenCalledWith(
			expect.objectContaining({
				config: { ...bootstrap.localDrafts, postId: 11 },
			}),
		);
		expect(createBrowserEditorBlockIndexWorker).toHaveBeenCalledWith(
			expect.objectContaining({
				referenceLabelCaseFoldProfile: bootstrap.referenceLabelCaseFoldProfile,
				workerUrl: bootstrap.editorBlockIndexWorkerUrl,
			}),
		);
		expect(createWordPressImageUploadPort).toHaveBeenCalledWith(
			expect.objectContaining({
				actionNonce: "image-hosting-nonce",
				endpoint: "/image-hosting/upload",
				nonce: "nonce",
				uploadOwner: "image-hosting",
			}),
		);
		expect(
			vi.mocked(createWordPressImageUploadPort).mock.calls[0]?.[0],
		).not.toHaveProperty("destination");
		expect(render).toHaveBeenCalledTimes(1);
		const rendered = render.mock.calls[0]?.[0] as {
			props: {
				children: {
					props: {
						onDocumentOwnerChange: (owned: boolean) => void;
						publishPost: (session: never) => boolean;
						wechatClipboard: {
							prepare?: (preview: HTMLElement) => Promise<void>;
						};
					};
				};
			};
		};
		const preview = document.createElement("div");
		preview.innerHTML = "<p>Preview</p>";
		await rendered.props.children.props.wechatClipboard.prepare?.(preview);
		expect(createBrowserWechatClipboard).toHaveBeenCalledWith(
			expect.objectContaining({
				approvedAssetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
				approvedKaTeXCssUrl: bootstrap.previewEnhancement.assets.katexCssUrl,
				wechatMathAtlasContentVersion:
					bootstrap.wechatExport.wechatMathAtlasContentVersion,
				wechatMathAtlasUrl: bootstrap.wechatExport.wechatMathAtlasUrl,
			}),
		);
		expect(rendered.props.children.props.publishPost({} as never)).toBe(true);
		expect(publishClick).toHaveBeenCalledOnce();
		expect(saveDraftClick).not.toHaveBeenCalled();
		const nativeEditor = document.querySelector<HTMLElement>("#postdivrich");
		expect(
			nativeEditor?.classList.contains("easymde-native-editor-hidden"),
		).toBe(false);
		rendered.props.children.props.onDocumentOwnerChange(true);
		expect(
			nativeEditor?.classList.contains("easymde-native-editor-hidden"),
		).toBe(true);
		expect(() => {
			teardown();
			teardown();
		}).not.toThrow();
		expect(unmount).toHaveBeenCalledTimes(1);
		const blockIndexPort = vi.mocked(createBrowserEditorBlockIndexWorker).mock
			.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
		expect(blockIndexPort.dispose).toHaveBeenCalledOnce();
		expect(
			nativeEditor?.classList.contains("easymde-native-editor-hidden"),
		).toBe(false);
	});

	it("passes the native PNG ClipboardItem capability through the editor runtime", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const nativeWrite = vi.fn().mockResolvedValue(undefined);
		const clipboard = {
			readText: vi.fn().mockResolvedValue(""),
			write: nativeWrite,
			writeText: vi.fn().mockResolvedValue(undefined),
		} as unknown as Clipboard;
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			window.navigator,
			"clipboard",
		);
		const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"ClipboardItem",
		);
		class ClipboardItemStub {
			static supports = vi.fn((type: string) => "image/png" === type);

			constructor(readonly payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: clipboard,
		});
		Object.defineProperty(window, "ClipboardItem", {
			configurable: true,
			value: ClipboardItemStub,
		});

		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { editorClipboardPort: EditorClipboardPort };
					};
				};
			};
			const editorClipboardPort =
				rendered.props.children.props.editorClipboardPort;
			if (!editorClipboardPort?.writeImageDeferred) {
				throw new Error("entrypoint-png-clipboard-port-missing");
			}
			expect(editorClipboardPort.supportsPngWrite?.()).toBe(true);
			let resolvePayload!: (value: Blob) => void;
			const payload = new Promise<Blob>((resolve) => {
				resolvePayload = resolve;
			});
			const result = editorClipboardPort.writeImageDeferred(payload);
			expect(nativeWrite).toHaveBeenCalledOnce();
			expect(ClipboardItemStub.supports).toHaveBeenCalledWith("image/png");
			resolvePayload(new Blob(["png"], { type: "image/png" }));
			await expect(result).resolves.toEqual({ status: "written" });
			ClipboardItemStub.supports.mockReturnValue(false);
			expect(editorClipboardPort.supportsPngWrite?.()).toBe(false);
			await expect(
				editorClipboardPort.writeImageDeferred(
					Promise.resolve(new Blob(["png"], { type: "image/png" })),
				),
			).resolves.toEqual({
				code: "editor-clipboard-unsupported",
				status: "failed",
			});
			expect(nativeWrite).toHaveBeenCalledOnce();
			teardown();
		} finally {
			if (clipboardDescriptor) {
				Object.defineProperty(
					window.navigator,
					"clipboard",
					clipboardDescriptor,
				);
			} else {
				Reflect.deleteProperty(window.navigator, "clipboard");
			}
			if (clipboardItemDescriptor) {
				Object.defineProperty(window, "ClipboardItem", clipboardItemDescriptor);
			} else {
				delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			}
		}
	});

	it("passes native deferred rich Clipboard support through the editor runtime", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const nativeWrite = vi.fn().mockResolvedValue(undefined);
		const clipboard = {
			readText: vi.fn().mockResolvedValue(""),
			write: nativeWrite,
			writeText: vi.fn().mockResolvedValue(undefined),
		} as unknown as Clipboard;
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			window.navigator,
			"clipboard",
		);
		const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"ClipboardItem",
		);
		class ClipboardItemStub {
			static supports = vi.fn((type: string) =>
				["text/html", "text/plain"].includes(type),
			);

			constructor(readonly payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: clipboard,
		});
		Object.defineProperty(window, "ClipboardItem", {
			configurable: true,
			value: ClipboardItemStub,
		});

		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { editorClipboardPort: EditorClipboardPort };
					};
				};
			};
			const editorClipboardPort =
				rendered.props.children.props.editorClipboardPort;
			if (!editorClipboardPort?.writeRichDeferred) {
				throw new Error("entrypoint-rich-clipboard-port-missing");
			}
			expect(editorClipboardPort.supportsRichWrite?.()).toBe(true);
			let resolvePayload!: (value: { html: string; text: string }) => void;
			const payload = new Promise<{ html: string; text: string }>((resolve) => {
				resolvePayload = resolve;
			});
			const result = editorClipboardPort.writeRichDeferred(payload);
			expect(nativeWrite).toHaveBeenCalledOnce();
			expect(ClipboardItemStub.supports).toHaveBeenCalledWith("text/html");
			expect(ClipboardItemStub.supports).toHaveBeenCalledWith("text/plain");
			resolvePayload({ html: "<p>Rendered</p>", text: "Rendered" });
			await expect(result).resolves.toEqual({ status: "written" });
			teardown();
		} finally {
			if (clipboardDescriptor) {
				Object.defineProperty(
					window.navigator,
					"clipboard",
					clipboardDescriptor,
				);
			} else {
				Reflect.deleteProperty(window.navigator, "clipboard");
			}
			if (clipboardItemDescriptor) {
				Object.defineProperty(window, "ClipboardItem", clipboardItemDescriptor);
			} else {
				delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			}
		}
	});

	it("observes a late plain deferred payload rejection after native setup throws", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const nativeWrite = vi.fn().mockResolvedValue(undefined);
		const clipboard = {
			readText: vi.fn().mockResolvedValue(""),
			write: nativeWrite,
			writeText: vi.fn().mockResolvedValue(undefined),
		} as unknown as Clipboard;
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			window.navigator,
			"clipboard",
		);
		const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"ClipboardItem",
		);
		class ThrowingClipboardItem {
			static supports = vi.fn(() => true);

			constructor(_payload: Record<string, Blob | PromiseLike<Blob>>) {
				throw new Error("native setup failed");
			}
		}
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: clipboard,
		});
		Object.defineProperty(window, "ClipboardItem", {
			configurable: true,
			value: ThrowingClipboardItem,
		});

		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { editorClipboardPort: EditorClipboardPort };
					};
				};
			};
			const editorClipboardPort =
				rendered.props.children.props.editorClipboardPort;
			if (!editorClipboardPort?.writeDeferred) {
				throw new Error("entrypoint-plain-deferred-clipboard-port-missing");
			}
			const payload = deferred<string>();
			const result = editorClipboardPort.writeDeferred(payload.promise);
			await expect(result).resolves.toEqual({
				code: "editor-clipboard-write-failed",
				status: "failed",
			});
			payload.reject(new Error("late renderer failure"));
			await Promise.resolve();
			teardown();
		} finally {
			if (clipboardDescriptor) {
				Object.defineProperty(
					window.navigator,
					"clipboard",
					clipboardDescriptor,
				);
			} else {
				Reflect.deleteProperty(window.navigator, "clipboard");
			}
			if (clipboardItemDescriptor) {
				Object.defineProperty(window, "ClipboardItem", clipboardItemDescriptor);
			} else {
				delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			}
		}
	});

	it("logs lifecycle diagnostics at info level without downgrading real failures", () => {
		const render = vi.fn();
		vi.mocked(createRoot).mockReturnValue({
			render,
			unmount: vi.fn(),
		} as never);
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		try {
			mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});

			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: {
							onFailure: (code: string, level?: "error" | "info") => void;
						};
					};
				};
			};
			const onFailure = rendered.props.children.props.onFailure;
			onFailure("wechat-export-cancelled-theme-change", "info");
			onFailure("wechat-png-upload-failed");

			expect(info).toHaveBeenCalledWith(
				"[EasyMDE] wechat-export-cancelled-theme-change",
			);
			expect(info).toHaveBeenCalledOnce();
			expect(error).toHaveBeenCalledWith("[EasyMDE] wechat-png-upload-failed");
		} finally {
			info.mockRestore();
			error.mockRestore();
		}
	});

	it("creates and disposes the isolated WordPress media frame adapter", () => {
		const render = vi.fn();
		vi.mocked(createRoot).mockReturnValue({
			render,
			unmount: vi.fn(),
		} as never);
		const dispose = vi.fn();
		vi.mocked(createWordPressMediaFramePort).mockReturnValue({
			dispose,
			open: vi.fn(),
		});
		const wordpress = {
			apiFetch: Object.assign(vi.fn(), {
				nonceMiddleware: { nonce: "nonce" },
			}),
			hooks: { addAction: vi.fn(), removeAction: vi.fn() },
		};

		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure: vi.fn(),
			window,
			wordpress,
		});

		expect(createWordPressMediaFramePort).toHaveBeenCalledWith({
			frameUrl: bootstrap.mediaPicker.frameUrl,
			window,
		});
		teardown();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("forwards the clipboard fetch RequestInit, including its abort signal", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const originalFetch = window.fetch;
		const windowFetch = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) =>
				Promise.resolve({} as Response),
		);
		Object.defineProperty(window, "fetch", {
			configurable: true,
			writable: true,
			value: windowFetch,
		});

		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});

			expect(createBrowserWechatClipboard).not.toHaveBeenCalled();

			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: {
							wechatClipboard: {
								prepare?: (preview: HTMLElement) => Promise<void>;
							};
						};
					};
				};
			};
			const preview = document.createElement("div");
			preview.innerHTML = "<p>Preview</p>";
			await rendered.props.children.props.wechatClipboard.prepare?.(preview);

			const fetchAdapter = vi.mocked(createBrowserWechatClipboard).mock
				.calls[0]?.[0]?.fetch;
			expect(fetchAdapter).toEqual(expect.any(Function));
			const signal = new AbortController().signal;
			const init: RequestInit = {
				credentials: "same-origin",
				signal,
			};

			await fetchAdapter?.("/assets/images/theme.png", init);

			expect(windowFetch).toHaveBeenCalledWith(
				"/assets/images/theme.png",
				init,
			);
			teardown();
		} finally {
			Object.defineProperty(window, "fetch", {
				configurable: true,
				writable: true,
				value: originalFetch,
			});
		}
	});

	it("aborts lazy WeChat preparation cleanly before loading and respects teardown", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

		const teardown = mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure: vi.fn(),
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});

		const rendered = render.mock.calls[0]?.[0] as {
			props: {
				children: {
					props: {
						wechatClipboard: {
							copy: (
								preview: HTMLElement,
								options?: { pngConversionEnabled?: boolean },
							) => Promise<unknown>;
							prepare?: (
								preview: HTMLElement,
								options?: { background?: boolean; signal?: AbortSignal },
							) => Promise<void>;
						};
					};
				};
			};
		};
		const preview = document.createElement("div");
		preview.innerHTML = "<p>Preview</p>";
		const aborted = new AbortController();
		aborted.abort();

		await expect(
			rendered.props.children.props.wechatClipboard.prepare?.(preview, {
				background: true,
				signal: aborted.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(createBrowserWechatClipboard).not.toHaveBeenCalled();

		teardown();
		await expect(
			rendered.props.children.props.wechatClipboard.copy(preview, {
				pngConversionEnabled: true,
			}),
		).resolves.toEqual({
			code: "wechat-png-clipboard-failed",
			sideEffects: "none",
			status: "failed",
		});
		expect(createBrowserWechatClipboard).not.toHaveBeenCalled();
	});

	it("starts modern Clipboard write synchronously during a cold WeChat chunk load and commits once the chunk resolves", async () => {
		const actual = await vi.importActual<
			typeof import("../integrations/browser/wechat/create-browser-wechat-clipboard")
		>("../integrations/browser/wechat/create-browser-wechat-clipboard");
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const writtenPayloads: Array<{ html: string; text: string }> = [];
		class ClipboardItemStub {
			constructor(
				readonly payload: Record<string, Blob | PromiseLike<Blob>>,
			) {}
		}
		const nativeWrite = vi.fn(async (items: ClipboardItems) => {
			const item = (items as unknown as ClipboardItemStub[])[0];
			const htmlBlob = await item?.payload["text/html"];
			const textBlob = await item?.payload["text/plain"];
			if (!htmlBlob || !textBlob) {
				throw new Error("clipboard-item-blobs-missing");
			}
			writtenPayloads.push({
				html: await htmlBlob.text(),
				text: await textBlob.text(),
			});
		});
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			window.navigator,
			"clipboard",
		);
		const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"ClipboardItem",
		);
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: {
				readText: vi.fn().mockResolvedValue(""),
				write: nativeWrite,
				writeText: vi.fn().mockResolvedValue(undefined),
			} as unknown as Clipboard,
		});
		Object.defineProperty(window, "ClipboardItem", {
			configurable: true,
			value: ClipboardItemStub,
		});

		const chunk = deferred<typeof actual>();
		const loadWechatClipboard = vi.fn(() => chunk.promise);
		const realGetComputedStyle = window.getComputedStyle.bind(window);
		const getComputedStyleSpy = vi
			.spyOn(window, "getComputedStyle")
			.mockImplementation((element, pseudoElement) => {
				if (pseudoElement) {
					return {
						getPropertyValue: (property: string) =>
							"content" === property ? "none" : "",
					} as unknown as CSSStyleDeclaration;
				}
				return realGetComputedStyle(element);
			});
		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard,
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { wechatClipboard: WechatClipboardPort };
					};
				};
			};
			const wechatClipboard = rendered.props.children.props.wechatClipboard;
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML = "<p>Cold load preview</p>";
			Object.defineProperty(preview, "innerText", {
				configurable: true,
				value: "Cold load preview",
			});
			Object.defineProperty(preview, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					bottom: 240,
					height: 240,
					left: 0,
					right: 640,
					top: 0,
					width: 640,
					x: 0,
					y: 0,
				}),
			});
			document.body.append(preview);

			const copyPromise = wechatClipboard.copy(preview);

			// Critical invariant: modern Clipboard write starts synchronously in the
			// click task BEFORE the dynamic chunk import settles.
			expect(nativeWrite).toHaveBeenCalledOnce();
			expect(loadWechatClipboard).toHaveBeenCalledOnce();
			expect(writtenPayloads).toHaveLength(0);

			chunk.resolve(actual);
			await expect(copyPromise).resolves.toEqual({
				method: "clipboard",
				status: "copied",
			});
			expect(nativeWrite).toHaveBeenCalledOnce();
			expect(writtenPayloads).toHaveLength(1);
			expect(writtenPayloads[0]?.html).toContain("Cold load preview");
			expect(writtenPayloads[0]?.text).toContain("Cold load preview");

			// Subsequent warm copy reuses the resolved port synchronously without
			// re-importing the chunk.
			const warmCopy = wechatClipboard.copy(preview);
			expect(nativeWrite).toHaveBeenCalledTimes(2);
			expect(loadWechatClipboard).toHaveBeenCalledOnce();
			await expect(warmCopy).resolves.toEqual({
				method: "clipboard",
				status: "copied",
			});
			teardown();
		} finally {
			getComputedStyleSpy.mockRestore();
			if (clipboardDescriptor) {
				Object.defineProperty(
					window.navigator,
					"clipboard",
					clipboardDescriptor,
				);
			} else {
				Reflect.deleteProperty(window.navigator, "clipboard");
			}
			if (clipboardItemDescriptor) {
				Object.defineProperty(window, "ClipboardItem", clipboardItemDescriptor);
			} else {
				delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			}
		}
	});

	it("aborts a pending cold WeChat chunk load immediately with cancellation codes and zero unhandled rejections", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const capturedItems: Array<Record<string, Blob | PromiseLike<Blob>>> = [];
		class ClipboardItemStub {
			constructor(
				readonly payload: Record<string, Blob | PromiseLike<Blob>>,
			) {
				capturedItems.push(payload);
			}
		}
		const nativeWrite = vi.fn(async (items: ClipboardItems) => {
			const item = (items as unknown as ClipboardItemStub[])[0];
			await Promise.all([
				item?.payload["text/html"],
				item?.payload["text/plain"],
			]);
		});
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			window.navigator,
			"clipboard",
		);
		const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"ClipboardItem",
		);
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: {
				readText: vi.fn().mockResolvedValue(""),
				write: nativeWrite,
				writeText: vi.fn().mockResolvedValue(undefined),
			} as unknown as Clipboard,
		});
		Object.defineProperty(window, "ClipboardItem", {
			configurable: true,
			value: ClipboardItemStub,
		});

		const unhandledRejections: unknown[] = [];
		const onUnhandledRejection = (reason: unknown): void => {
			unhandledRejections.push(reason);
		};
		process.on("unhandledRejection", onUnhandledRejection);

		const pendingChunks: Array<ReturnType<typeof deferred<never>>> = [];
		const loadWechatClipboard = vi.fn(() => {
			const next = deferred<never>();
			pendingChunks.push(next);
			return next.promise;
		});

		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard,
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { wechatClipboard: WechatClipboardPort };
					};
				};
			};
			const wechatClipboard = rendered.props.children.props.wechatClipboard;
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML = "<p>Abort test</p>";

			// Already-aborted signals settle immediately without touching Clipboard or loading the chunk.
			const preAborted = new AbortController();
			preAborted.abort();
			await expect(
				wechatClipboard.copy(preview, { signal: preAborted.signal }),
			).resolves.toEqual({
				code: "wechat-copy-cancelled",
				status: "cancelled",
			});
			await expect(
				wechatClipboard.copy(preview, {
					pngConversionEnabled: true,
					signal: preAborted.signal,
				}),
			).resolves.toEqual({
				code: "wechat-png-rasterization-cancelled",
				sideEffects: "none",
				status: "failed",
			});
			expect(nativeWrite).not.toHaveBeenCalled();
			expect(loadWechatClipboard).not.toHaveBeenCalled();

			// Non-PNG abort while chunk import is still pending.
			const nonPngController = new AbortController();
			const nonPngCopy = wechatClipboard.copy(preview, {
				signal: nonPngController.signal,
			});
			expect(nativeWrite).toHaveBeenCalledTimes(1);
			nonPngController.abort();
			await expect(nonPngCopy).resolves.toEqual({
				code: "wechat-copy-cancelled",
				status: "cancelled",
			});
			await expect(capturedItems[0]?.["text/html"]).rejects.toThrow(
				"wechat-copy-cancelled",
			);
			await expect(capturedItems[0]?.["text/plain"]).rejects.toThrow(
				"wechat-copy-cancelled",
			);

			// PNG abort while the same pending chunk import is still unresolved.
			const pngController = new AbortController();
			const pngCopy = wechatClipboard.copy(preview, {
				pngConversionEnabled: true,
				signal: pngController.signal,
			});
			expect(nativeWrite).toHaveBeenCalledTimes(2);
			pngController.abort();
			await expect(pngCopy).resolves.toEqual({
				code: "wechat-png-rasterization-cancelled",
				sideEffects: "none",
				status: "failed",
			});
			await expect(capturedItems[1]?.["text/html"]).rejects.toThrow(
				"wechat-copy-cancelled",
			);
			await expect(capturedItems[1]?.["text/plain"]).rejects.toThrow(
				"wechat-copy-cancelled",
			);

			// Rejecting the abandoned chunk import afterwards must not produce unhandled rejections.
			pendingChunks[0]?.reject(new Error("abandoned-chunk-load-error"));
			await new Promise((resolve) => window.setTimeout(resolve, 0));
			expect(unhandledRejections).toEqual([]);
			teardown();
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
			if (clipboardDescriptor) {
				Object.defineProperty(
					window.navigator,
					"clipboard",
					clipboardDescriptor,
				);
			} else {
				Reflect.deleteProperty(window.navigator, "clipboard");
			}
			if (clipboardItemDescriptor) {
				Object.defineProperty(window, "ClipboardItem", clipboardItemDescriptor);
			} else {
				delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			}
		}
	});

	it("rejects prestarted ClipboardItem blobs cleanly when cold chunk import fails, modern setup throws, or legacy fallback is unavailable", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const capturedItems: Array<Record<string, Blob | PromiseLike<Blob>>> = [];
		let throwOnClipboardItem = false;
		class ClipboardItemStub {
			constructor(
				readonly payload: Record<string, Blob | PromiseLike<Blob>>,
			) {
				if (throwOnClipboardItem) {
					throw new Error("clipboard-item-sync-throw");
				}
				capturedItems.push(payload);
			}
		}
		const nativeWrite = vi.fn(async (items: ClipboardItems) => {
			const item = (items as unknown as ClipboardItemStub[])[0];
			await Promise.all([
				item?.payload["text/html"],
				item?.payload["text/plain"],
			]);
		});
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			window.navigator,
			"clipboard",
		);
		const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"ClipboardItem",
		);
		const originalExecCommand = document.execCommand;
		const execCommand = vi.fn(() => true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: {
				readText: vi.fn().mockResolvedValue(""),
				write: nativeWrite,
				writeText: vi.fn().mockResolvedValue(undefined),
			} as unknown as Clipboard,
		});
		Object.defineProperty(window, "ClipboardItem", {
			configurable: true,
			value: ClipboardItemStub,
		});

		const unhandledRejections: unknown[] = [];
		const onUnhandledRejection = (reason: unknown): void => {
			unhandledRejections.push(reason);
		};
		process.on("unhandledRejection", onUnhandledRejection);

		const loadWechatClipboard = vi.fn();
		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard,
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const rendered = render.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { wechatClipboard: WechatClipboardPort };
					};
				};
			};
			const wechatClipboard = rendered.props.children.props.wechatClipboard;
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML = "<p>Failure test</p>";

			// Non-PNG chunk rejection rejects deferred blobs and returns truthful failure.
			const firstChunk = deferred<never>();
			loadWechatClipboard.mockReturnValueOnce(firstChunk.promise);
			const nonPngCopy = wechatClipboard.copy(preview);
			expect(nativeWrite).toHaveBeenCalledTimes(1);
			firstChunk.reject(new Error("chunk-network-error"));
			await expect(nonPngCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			await expect(capturedItems[0]?.["text/html"]).rejects.toThrow(
				"chunk-network-error",
			);
			await expect(capturedItems[0]?.["text/plain"]).rejects.toThrow(
				"chunk-network-error",
			);

			// PNG chunk rejection retries the cleared portPromise and returns truthful PNG failure.
			const secondChunk = deferred<never>();
			loadWechatClipboard.mockReturnValueOnce(secondChunk.promise);
			const pngCopy = wechatClipboard.copy(preview, {
				pngConversionEnabled: true,
			});
			expect(nativeWrite).toHaveBeenCalledTimes(2);
			secondChunk.reject(new Error("chunk-png-network-error"));
			await expect(pngCopy).resolves.toEqual({
				code: "wechat-png-clipboard-failed",
				sideEffects: "none",
				status: "failed",
			});
			await expect(capturedItems[1]?.["text/html"]).rejects.toThrow(
				"chunk-png-network-error",
			);
			await expect(capturedItems[1]?.["text/plain"]).rejects.toThrow(
				"chunk-png-network-error",
			);

			// Browser write rejection before chunk resolution fails immediately and rejects deferred blobs.
			const thirdChunk = deferred<never>();
			loadWechatClipboard.mockReturnValueOnce(thirdChunk.promise);
			nativeWrite.mockRejectedValueOnce(new Error("NotAllowedError"));
			const earlyWriteRejectCopy = wechatClipboard.copy(preview);
			await expect(earlyWriteRejectCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			await expect(capturedItems[2]?.["text/html"]).rejects.toThrow(
				"NotAllowedError",
			);
			await expect(capturedItems[2]?.["text/plain"]).rejects.toThrow(
				"NotAllowedError",
			);
			thirdChunk.reject(new Error("abandoned-after-write-reject"));
			await new Promise((resolve) => window.setTimeout(resolve, 0));

			// Synchronous modern ClipboardItem failure never falls back to async execCommand.
			throwOnClipboardItem = true;
			await expect(wechatClipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(execCommand).not.toHaveBeenCalled();
			teardown();

			// Legacy-only browser (no modern Clipboard) warms the chunk and fails truthfully.
			throwOnClipboardItem = false;
			Reflect.deleteProperty(window.navigator, "clipboard");
			delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			const legacyChunk = deferred<never>();
			const legacyLoader = vi.fn(() => legacyChunk.promise);
			const legacyRender = vi.fn();
			vi.mocked(createRoot).mockReturnValue({
				render: legacyRender,
				unmount: vi.fn(),
			} as never);
			const teardownLegacy = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: legacyLoader,
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const legacyRendered = legacyRender.mock.calls[0]?.[0] as {
				props: {
					children: {
						props: { wechatClipboard: WechatClipboardPort };
					};
				};
			};
			await expect(
				legacyRendered.props.children.props.wechatClipboard.copy(preview),
			).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(legacyLoader).toHaveBeenCalledOnce();
			expect(execCommand).not.toHaveBeenCalled();
			legacyChunk.reject(new Error("legacy-warm-load-failed"));
			await new Promise((resolve) => window.setTimeout(resolve, 0));
			expect(unhandledRejections).toEqual([]);
			teardownLegacy();
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
			Object.defineProperty(document, "execCommand", {
				configurable: true,
				value: originalExecCommand,
			});
			if (clipboardDescriptor) {
				Object.defineProperty(
					window.navigator,
					"clipboard",
					clipboardDescriptor,
				);
			} else {
				Reflect.deleteProperty(window.navigator, "clipboard");
			}
			if (clipboardItemDescriptor) {
				Object.defineProperty(window, "ClipboardItem", clipboardItemDescriptor);
			} else {
				delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
			}
		}
	});

	it("reports a prevented native publish as unsuccessful", () => {
		const render = vi.fn();
		vi.mocked(createRoot).mockReturnValue({
			render,
			unmount: vi.fn(),
		} as never);
		const form = document.querySelector<HTMLFormElement>("#post");
		const publish = document.querySelector<HTMLButtonElement>("#publish");
		form?.addEventListener("submit", (event) => {
			event.preventDefault();
		});
		vi.spyOn(publish as HTMLButtonElement, "click").mockImplementation(() => {
			publish?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
			form?.dispatchEvent(
				new SubmitEvent("submit", { bubbles: true, cancelable: true }),
			);
		});

		mountAdminEditor(bootstrap, {
			document,
			failureMessage: "Editor failed",
			onStartupFailure: vi.fn(),
			window,
			wordpress: {
				apiFetch: Object.assign(vi.fn(), {
					nonceMiddleware: { nonce: "nonce" },
				}),
				hooks: { addAction: vi.fn(), removeAction: vi.fn() },
			},
		});

		const rendered = render.mock.calls[0]?.[0] as {
			props: {
				children: {
					props: { publishPost: (session: never) => boolean };
				};
			};
		};
		expect(rendered.props.children.props.publishPost({} as never)).toBe(false);
	});

	it.each([
		["title", "#title"],
		["native editor", "#postdivrich"],
	])(
		"mounts when a supported post type has no optional %s field",
		(_label, selector) => {
			document.querySelector(selector)?.remove();
			const render = vi.fn();
			vi.mocked(createRoot).mockReturnValue({
				render,
				unmount: vi.fn(),
			} as never);

			expect(() =>
				mountAdminEditor(bootstrap, {
					document,
					failureMessage: "Editor failed",
					onStartupFailure: vi.fn(),
					window,
					wordpress: {
						apiFetch: Object.assign(vi.fn(), {
							nonceMiddleware: { nonce: "nonce" },
						}),
						hooks: { addAction: vi.fn(), removeAction: vi.fn() },
					},
				}),
			).not.toThrow();

			expect(render).toHaveBeenCalledOnce();
			const rendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { titleField: HTMLInputElement | null } } };
			};
			expect(rendered.props.children.props.titleField).toBe(
				"title" === _label ? null : document.querySelector("#title"),
			);
		},
	);

	it("fails before mounting when the delegated root is not empty", () => {
		document
			.querySelector("#easymde-editor-root")
			?.append(document.createElement("span"));
		expect(() =>
			mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			}),
		).toThrow("react-editor-root-not-empty");
		expect(createRoot).not.toHaveBeenCalled();
	});
});
