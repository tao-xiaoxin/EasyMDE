import { createRoot } from "@wordpress/element";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEditorRootBootstrap } from "../contracts/bootstrap/editor-root-bootstrap";
import type { EditorClipboardPort } from "../contracts/ports/editor-clipboard-port";
import type { WechatClipboardPort } from "../contracts/ports/wechat-clipboard-port";
import type {
	WechatVisualRasterizationPort,
	WechatVisualRasterizationResult,
} from "../contracts/ports/wechat-visual-rasterization-port";
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
			document.body.append(preview);
			const validPngOptions = {
				imageUploadPort: { upload: vi.fn() },
				maxBytes: 1024 * 1024,
				pngConversionEnabled: true,
				postId: 7,
				visualRasterizationPort: { rasterize: vi.fn() },
			};

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
					...validPngOptions,
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
				...validPngOptions,
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
			document.body.append(preview);

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
				imageUploadPort: { upload: vi.fn() },
				maxBytes: 1024 * 1024,
				pngConversionEnabled: true,
				postId: 7,
				visualRasterizationPort: { rasterize: vi.fn() },
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

			// Synchronous modern ClipboardItem failure never falls back to async execCommand
			// and warms the clipboard chunk for non-PNG copy without unhandled rejections.
			const syncThrowWarmChunk = deferred<never>();
			loadWechatClipboard.mockReturnValueOnce(syncThrowWarmChunk.promise);
			throwOnClipboardItem = true;
			await expect(wechatClipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(loadWechatClipboard).toHaveBeenCalledTimes(4);
			expect(execCommand).not.toHaveBeenCalled();
			syncThrowWarmChunk.reject(new Error("sync-throw-warm-load-failed"));
			await new Promise((resolve) => window.setTimeout(resolve, 0));
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

	it("rejects stale cold WeChat copy when Preview mutates or disconnects during delayed chunk import and cleans up observers", async () => {
		const actual = await vi.importActual<
			typeof import("../integrations/browser/wechat/create-browser-wechat-clipboard")
		>("../integrations/browser/wechat/create-browser-wechat-clipboard");
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const capturedItems: Array<Record<string, Blob | PromiseLike<Blob>>> = [];
		const writtenPayloads: Array<{ html: string; text: string }> = [];
		class ClipboardItemStub {
			constructor(
				readonly payload: Record<string, Blob | PromiseLike<Blob>>,
			) {
				capturedItems.push(payload);
			}
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
		const mutationObserverDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"MutationObserver",
		);
		const RealMutationObserver = window.MutationObserver;
		let activeObservers = 0;
		class TrackingMutationObserver extends RealMutationObserver {
			private observing = false;

			override observe(target: Node, options?: MutationObserverInit): void {
				if (!this.observing) {
					this.observing = true;
					activeObservers += 1;
				}
				super.observe(target, options);
			}

			override disconnect(): void {
				if (this.observing) {
					this.observing = false;
					activeObservers -= 1;
				}
				super.disconnect();
			}
		}
		Object.defineProperty(window, "MutationObserver", {
			configurable: true,
			value: TrackingMutationObserver,
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

		const createPreview = (html: string): HTMLElement => {
			const element = document.createElement("article");
			element.setAttribute("data-easymde-preview-html-sink", "1");
			element.innerHTML = html;
			Object.defineProperty(element, "innerText", {
				configurable: true,
				get: () => element.textContent ?? "",
			});
			Object.defineProperty(element, "getBoundingClientRect", {
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
			document.body.append(element);
			return element;
		};

		try {
			// 1. Portable cold copy: in-place Preview mutation during delayed chunk load
			//    (even when resolvePreview is provided for an ordinary visible preview,
			//    matching production EditorRoot wiring) rejects stale copy cleanly.
			const portableChunk = deferred<typeof actual>();
			const teardownPortable = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => portableChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const portableRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const preview = createPreview("<p>Original preview</p>");
			const portableCopy = portableRendered.props.children.props.wechatClipboard.copy(
				preview,
				{ resolvePreview: vi.fn(async () => preview) },
			);
			expect(nativeWrite).toHaveBeenCalledTimes(1);
			expect(activeObservers).toBe(1);

			preview.innerHTML = "<p>Replacement preview</p>";
			portableChunk.resolve(actual);

			await expect(portableCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(writtenPayloads).toHaveLength(0);
			await expect(capturedItems[0]?.["text/html"]).rejects.toThrow(
				"wechat-copy-stale",
			);
			await expect(capturedItems[0]?.["text/plain"]).rejects.toThrow(
				"wechat-copy-stale",
			);
			expect(activeObservers).toBe(0);
			teardownPortable();

			// 2. PNG cold copy: in-place mutation returns PNG cancellation code and cleans up.
			render.mockClear();
			const pngChunk = deferred<typeof actual>();
			const teardownPng = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => pngChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const pngRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const pngPreview = createPreview("<p>Original PNG preview</p>");
			const pngCopy = pngRendered.props.children.props.wechatClipboard.copy(
				pngPreview,
				{
					imageUploadPort: { upload: vi.fn() },
					maxBytes: 1024 * 1024,
					pngConversionEnabled: true,
					postId: 7,
					visualRasterizationPort: { rasterize: vi.fn() },
				},
			);
			expect(activeObservers).toBe(1);
			pngPreview.innerHTML = "<p>Replacement PNG preview</p>";
			pngChunk.resolve(actual);
			await expect(pngCopy).resolves.toEqual({
				code: "wechat-png-rasterization-cancelled",
				sideEffects: "none",
				status: "failed",
			});
			expect(writtenPayloads).toHaveLength(0);
			await expect(capturedItems[1]?.["text/html"]).rejects.toThrow(
				"wechat-copy-stale",
			);
			await expect(capturedItems[1]?.["text/plain"]).rejects.toThrow(
				"wechat-copy-stale",
			);
			expect(activeObservers).toBe(0);
			teardownPng();

			// 3. Disconnect during delayed chunk load rejects stale copy cleanly.
			render.mockClear();
			const disconnectChunk = deferred<typeof actual>();
			const teardownDisconnect = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => disconnectChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const disconnectRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const detachedPreview = createPreview("<p>Connected at click</p>");
			const disconnectCopy =
				disconnectRendered.props.children.props.wechatClipboard.copy(
					detachedPreview,
				);
			expect(activeObservers).toBe(1);
			detachedPreview.remove();
			disconnectChunk.resolve(actual);
			await expect(disconnectCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(writtenPayloads).toHaveLength(0);
			expect(activeObservers).toBe(0);
			teardownDisconnect();

			// 4. Direct copyWithPrestartedWrite zero-gap handoff: if cold freshness turns
			//    stale right as the loaded adapter installs its own freshness guard, the
			//    adapter rejects cleanly and disposes the cold observer.
			const handoffPreview = createPreview("<p>Handoff content</p>");
			const directClipboard = actual.createBrowserWechatClipboard({
				blob: Blob,
				clipboardItem: ClipboardItemStub,
				document,
				getComputedStyle: (element, pseudoElement) =>
					window.getComputedStyle(element, pseudoElement),
				getSelection: () => window.getSelection(),
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: (items) => nativeWrite(items as ClipboardItems),
			});
			let freshnessChecks = 0;
			const disposeColdSourceFreshness = vi.fn();
			const prestartedReject = vi.fn();
			const handoffHtml = deferred<Blob>();
			const handoffText = deferred<Blob>();
			void handoffHtml.promise.catch(() => undefined);
			void handoffText.promise.catch(() => undefined);
			const handoffWritePromise = Promise.all([
				handoffHtml.promise,
				handoffText.promise,
			]).then(() => undefined);
			void handoffWritePromise.catch(() => undefined);
			const handoffResult = await directClipboard.copyWithPrestartedWrite(
				handoffPreview,
				{},
				{
					bind(sourceHtmlBlob, sourceTextBlob) {
						void sourceHtmlBlob.then(handoffHtml.resolve, handoffHtml.reject);
						void sourceTextBlob.then(handoffText.resolve, handoffText.reject);
					},
					deadlineMs: Date.now() + 60_000,
					disposeColdSourceFreshness,
					isColdSourceFresh: () => {
						freshnessChecks += 1;
						return freshnessChecks === 1;
					},
					reject: prestartedReject,
					writePromise: handoffWritePromise,
				},
			);
			expect(handoffResult).toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(freshnessChecks).toBe(2);
			expect(disposeColdSourceFreshness).toHaveBeenCalled();
			expect(activeObservers).toBe(0);

			// 4b. Direct copyWithPrestartedWrite zero-gap handoff for PNG copy too.
			let pngFreshnessChecks = 0;
			const disposePngColdFreshness = vi.fn();
			const pngHandoffHtml = deferred<Blob>();
			const pngHandoffText = deferred<Blob>();
			void pngHandoffHtml.promise.catch(() => undefined);
			void pngHandoffText.promise.catch(() => undefined);
			const pngHandoffWritePromise = Promise.all([
				pngHandoffHtml.promise,
				pngHandoffText.promise,
			]).then(() => undefined);
			void pngHandoffWritePromise.catch(() => undefined);
			const pngHandoffResult = await directClipboard.copyWithPrestartedWrite(
				handoffPreview,
				{
					imageUploadPort: { upload: vi.fn() },
					maxBytes: 1024 * 1024,
					pngConversionEnabled: true,
					postId: 7,
					visualRasterizationPort: { rasterize: vi.fn() },
				},
				{
					bind(sourceHtmlBlob, sourceTextBlob) {
						void sourceHtmlBlob.then(
							pngHandoffHtml.resolve,
							pngHandoffHtml.reject,
						);
						void sourceTextBlob.then(
							pngHandoffText.resolve,
							pngHandoffText.reject,
						);
					},
					deadlineMs: Date.now() + 60_000,
					disposeColdSourceFreshness: disposePngColdFreshness,
					isColdSourceFresh: () => {
						pngFreshnessChecks += 1;
						return pngFreshnessChecks === 1;
					},
					reject: vi.fn(),
					writePromise: pngHandoffWritePromise,
				},
			);
			expect(pngHandoffResult).toEqual({
				code: "wechat-png-rasterization-cancelled",
				sideEffects: "none",
				status: "failed",
			});
			expect(pngFreshnessChecks).toBe(2);
			expect(disposePngColdFreshness).toHaveBeenCalled();
			expect(activeObservers).toBe(0);

			// 5. Hidden formal Preview with resolvePreview (unlocked visual editing)
			//    intentionally refreshes the formal Preview and succeeds.
			render.mockClear();
			const visualChunk = deferred<typeof actual>();
			const teardownVisual = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => visualChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const visualRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const hiddenFormal = createPreview("<p>Stale hidden preview</p>");
			hiddenFormal.classList.add("easymde-preview-surface-hidden");
			const freshFormal = createPreview("<p>Refreshed formal preview</p>");
			const visualCopy =
				visualRendered.props.children.props.wechatClipboard.copy(hiddenFormal, {
					resolvePreview: async () => freshFormal,
				});
			hiddenFormal.innerHTML = "<p>Mutated while hidden</p>";
			visualChunk.resolve(actual);
			await expect(visualCopy).resolves.toEqual({
				method: "clipboard",
				status: "copied",
			});
			expect(writtenPayloads).toHaveLength(1);
			expect(writtenPayloads[0]?.html).toContain("Refreshed formal preview");
			expect(activeObservers).toBe(0);
			teardownVisual();

			await new Promise((resolve) => window.setTimeout(resolve, 0));
			expect(unhandledRejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
			getComputedStyleSpy.mockRestore();
			if (mutationObserverDescriptor) {
				Object.defineProperty(
					window,
					"MutationObserver",
					mutationObserverDescriptor,
				);
			} else {
				delete (window as Window & { MutationObserver?: unknown })
					.MutationObserver;
			}
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

	it("ignores no-op DOM mutations during cold chunk load while rejecting genuine attribute, content, or checkbox changes", async () => {
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

		const createPreview = (html: string): HTMLElement => {
			const element = document.createElement("article");
			element.className = "easymde-preview easymde-markdown-theme-default";
			element.setAttribute("data-easymde-preview-html-sink", "1");
			element.innerHTML = html;
			Object.defineProperty(element, "innerText", {
				configurable: true,
				get: () => element.textContent ?? "",
			});
			Object.defineProperty(element, "getBoundingClientRect", {
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
			document.body.append(element);
			return element;
		};

		try {
			// 1. Writing the exact same class attribute back during delayed chunk load
			//    delivers a MutationRecord but keeps normalized state identical -> succeeds.
			const noopChunk = deferred<typeof actual>();
			const teardownNoop = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => noopChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const noopRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const noopPreview = createPreview("<p>Same class writeback</p>");
			const noopCopy =
				noopRendered.props.children.props.wechatClipboard.copy(noopPreview);
			noopPreview.setAttribute(
				"class",
				noopPreview.getAttribute("class") ?? "",
			);
			// Flush microtasks so MutationObserver callback runs BEFORE chunk resolves.
			await Promise.resolve();
			await Promise.resolve();
			noopChunk.resolve(actual);
			await expect(noopCopy).resolves.toEqual({
				method: "clipboard",
				status: "copied",
			});
			expect(writtenPayloads).toHaveLength(1);
			expect(writtenPayloads[0]?.html).toContain("Same class writeback");
			teardownNoop();

			// 2. Genuine attribute change during cold chunk delay still rejects Copy.
			render.mockClear();
			const attrChunk = deferred<typeof actual>();
			const teardownAttr = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => attrChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const attrRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const attrPreview = createPreview("<p>Attribute change</p>");
			const attrCopy =
				attrRendered.props.children.props.wechatClipboard.copy(attrPreview);
			attrPreview.setAttribute("class", "easymde-preview changed-theme");
			await Promise.resolve();
			attrChunk.resolve(actual);
			await expect(attrCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(writtenPayloads).toHaveLength(1);
			teardownAttr();

			// 3. Genuine checkbox toggle during cold chunk delay rejects Copy.
			render.mockClear();
			const checkboxChunk = deferred<typeof actual>();
			const teardownCheckbox = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => checkboxChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const checkboxRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const checkboxPreview = createPreview(
				'<ul><li><input type="checkbox"> Task item</li></ul>',
			);
			const checkboxInput = checkboxPreview.querySelector("input");
			if (!checkboxInput) throw new Error("checkbox-input-missing");
			const checkboxCopy =
				checkboxRendered.props.children.props.wechatClipboard.copy(
					checkboxPreview,
				);
			checkboxInput.checked = true;
			checkboxChunk.resolve(actual);
			await expect(checkboxCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(writtenPayloads).toHaveLength(1);
			teardownCheckbox();
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

	it("validates preview readiness and PNG options before touching Clipboard on cold clicks and short-circuits synchronous abort/stale writes", async () => {
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		const capturedItems: Array<Record<string, Blob | PromiseLike<Blob>>> = [];
		let onClipboardWrite: (() => void) | null = null;
		let throwSyncOnClipboardItem = false;
		class ClipboardItemStub {
			constructor(
				readonly payload: Record<string, Blob | PromiseLike<Blob>>,
			) {
				if (throwSyncOnClipboardItem) {
					throw new Error("sync-clipboard-item-error");
				}
				capturedItems.push(payload);
			}
		}
		const nativeWrite = vi.fn(() => {
			onClipboardWrite?.();
			return Promise.resolve();
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

		const warmChunk = deferred<never>();
		const loadWechatClipboard = vi.fn(() => warmChunk.promise);

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
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const wechatClipboard = rendered.props.children.props.wechatClipboard;

			// 1. aria-busy="true" (without accepted refresh flag) fails before Clipboard or chunk load.
			const busyPreview = document.createElement("article");
			busyPreview.setAttribute("aria-busy", "true");
			busyPreview.innerHTML = "<p>Loading...</p>";
			document.body.append(busyPreview);
			await expect(wechatClipboard.copy(busyPreview)).resolves.toEqual({
				code: "wechat-preview-unavailable",
				status: "failed",
			});
			await expect(
				wechatClipboard.copy(busyPreview, {
					imageUploadPort: { upload: vi.fn() },
					maxBytes: 1024,
					pngConversionEnabled: true,
					postId: 7,
					visualRasterizationPort: { rasterize: vi.fn() },
				}),
			).resolves.toEqual({
				code: "wechat-preview-unavailable",
				sideEffects: "none",
				status: "failed",
			});

			// 2. Empty Preview fails before Clipboard or chunk load.
			const emptyPreview = document.createElement("article");
			document.body.append(emptyPreview);
			await expect(wechatClipboard.copy(emptyPreview)).resolves.toEqual({
				code: "wechat-preview-unavailable",
				status: "failed",
			});

			// 3. Error Preview fails before Clipboard or chunk load.
			const errorPreview = document.createElement("article");
			errorPreview.setAttribute("data-easymde-preview-error", "1");
			errorPreview.innerHTML = "<p>Error</p>";
			document.body.append(errorPreview);
			await expect(wechatClipboard.copy(errorPreview)).resolves.toEqual({
				code: "wechat-preview-unavailable",
				status: "failed",
			});

			// 4. Invalid PNG options fail before Clipboard or chunk load.
			const ready = document.createElement("article");
			ready.innerHTML = "<p>Ready content</p>";
			document.body.append(ready);
			await expect(
				wechatClipboard.copy(ready, { pngConversionEnabled: true }),
			).resolves.toEqual({
				code: "wechat-png-rasterization-failed",
				sideEffects: "none",
				status: "failed",
			});
			expect(nativeWrite).not.toHaveBeenCalled();
			expect(loadWechatClipboard).not.toHaveBeenCalled();

			// 5. Synchronous abort during navigator.clipboard.write() short-circuits before loader.load().
			const syncAbortController = new AbortController();
			onClipboardWrite = () => {
				syncAbortController.abort();
			};
			await expect(
				wechatClipboard.copy(ready, { signal: syncAbortController.signal }),
			).resolves.toEqual({
				code: "wechat-copy-cancelled",
				status: "cancelled",
			});
			expect(nativeWrite).toHaveBeenCalledTimes(1);
			expect(loadWechatClipboard).not.toHaveBeenCalled();

			// 6. Synchronous DOM mutation during navigator.clipboard.write() short-circuits before loader.load().
			onClipboardWrite = () => {
				ready.innerHTML = "<p>Mutated synchronously during write</p>";
			};
			await expect(wechatClipboard.copy(ready)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(nativeWrite).toHaveBeenCalledTimes(2);
			expect(loadWechatClipboard).not.toHaveBeenCalled();
			onClipboardWrite = null;

			// 7. Synchronous ClipboardItem throw warms loader.load() for non-PNG cold clicks
			//    (and rejects cleanly without unhandled rejections).
			throwSyncOnClipboardItem = true;
			await expect(
				wechatClipboard.copy(ready, {
					imageUploadPort: { upload: vi.fn() },
					maxBytes: 1024,
					pngConversionEnabled: true,
					postId: 7,
					visualRasterizationPort: { rasterize: vi.fn() },
				}),
			).resolves.toEqual({
				code: "wechat-png-clipboard-failed",
				sideEffects: "none",
				status: "failed",
			});
			expect(loadWechatClipboard).not.toHaveBeenCalled();

			await expect(wechatClipboard.copy(ready)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(loadWechatClipboard).toHaveBeenCalledOnce();
			warmChunk.reject(new Error("warm-chunk-rejected"));
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

	it("enforces a single 60-second end-to-end deadline across cold chunk load and preparation and never calls port.copy post-await", async () => {
		const actual = await vi.importActual<
			typeof import("../integrations/browser/wechat/create-browser-wechat-clipboard")
		>("../integrations/browser/wechat/create-browser-wechat-clipboard");
		vi.useFakeTimers();
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

		try {
			// 1. Portable cold copy: 50s chunk load leaves only 10s for preparation.
			const portableChunk = deferred<typeof actual>();
			const teardownPortable = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => portableChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const portableRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const hiddenPreview = document.createElement("article");
			hiddenPreview.setAttribute("data-easymde-preview-html-sink", "1");
			hiddenPreview.classList.add("easymde-preview-surface-hidden");
			hiddenPreview.innerHTML = "<p>Deadline test</p>";
			document.body.append(hiddenPreview);

			const hangingPreviewResolution = deferred<HTMLElement | null>();
			let portableSettled = false;
			const portableCopy = portableRendered.props.children.props.wechatClipboard
				.copy(hiddenPreview, {
					resolvePreview: () => hangingPreviewResolution.promise,
				})
				.finally(() => {
					portableSettled = true;
				});

			await vi.advanceTimersByTimeAsync(50_000);
			expect(portableSettled).toBe(false);

			portableChunk.resolve(actual);
			await vi.advanceTimersByTimeAsync(9_999);
			expect(portableSettled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			await expect(portableCopy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			await expect(capturedItems[0]?.["text/html"]).rejects.toThrow(
				"wechat-clipboard-preparation-timeout",
			);
			await expect(capturedItems[0]?.["text/plain"]).rejects.toThrow(
				"wechat-clipboard-preparation-timeout",
			);
			teardownPortable();

			// 2. PNG cold copy: 50s chunk load leaves only 10s for PNG transaction.
			render.mockClear();
			const pngChunk = deferred<typeof actual>();
			const teardownPng = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(() => pngChunk.promise),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const pngRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const hangingPngResolution = deferred<HTMLElement | null>();
			let pngSettled = false;
			const pngCopy = pngRendered.props.children.props.wechatClipboard
				.copy(hiddenPreview, {
					imageUploadPort: { upload: vi.fn() },
					maxBytes: 1024 * 1024,
					pngConversionEnabled: true,
					postId: 7,
					resolvePreview: () => hangingPngResolution.promise,
					visualRasterizationPort: { rasterize: vi.fn() },
				})
				.finally(() => {
					pngSettled = true;
				});

			await vi.advanceTimersByTimeAsync(50_000);
			expect(pngSettled).toBe(false);

			pngChunk.resolve(actual);
			await vi.advanceTimersByTimeAsync(9_999);
			expect(pngSettled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			await expect(pngCopy).resolves.toEqual({
				code: "wechat-png-transaction-timeout",
				sideEffects: "none",
				status: "failed",
			});
			await expect(capturedItems[1]?.["text/html"]).rejects.toThrow(
				"wechat-png-transaction-timeout",
			);
			await expect(capturedItems[1]?.["text/plain"]).rejects.toThrow(
				"wechat-png-transaction-timeout",
			);
			teardownPng();

			// 3. Missing copyWithPrestartedWrite fails truthfully and never invokes port.copy() post-await.
			render.mockClear();
			const legacyShapeCopy = vi
				.fn()
				.mockResolvedValue({ method: "clipboard", status: "copied" });
			const teardownNoPrestarted = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard: vi.fn(async () => ({
					createBrowserWechatClipboard: () =>
						({
							copy: legacyShapeCopy,
						}) as never,
				})),
				onStartupFailure: vi.fn(),
				window,
				wordpress: {
					apiFetch: Object.assign(vi.fn(), {
						nonceMiddleware: { nonce: "nonce" },
					}),
					hooks: { addAction: vi.fn(), removeAction: vi.fn() },
				},
			});
			const noPrestartedRendered = render.mock.calls[0]?.[0] as {
				props: { children: { props: { wechatClipboard: WechatClipboardPort } } };
			};
			const visiblePreview = document.createElement("article");
			visiblePreview.setAttribute("data-easymde-preview-html-sink", "1");
			visiblePreview.innerHTML = "<p>Visible preview</p>";
			document.body.append(visiblePreview);
			await expect(
				noPrestartedRendered.props.children.props.wechatClipboard.copy(
					visiblePreview,
				),
			).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(legacyShapeCopy).not.toHaveBeenCalled();
			await expect(capturedItems[2]?.["text/html"]).rejects.toThrow(
				"wechat-copy-prestarted-write-unsupported",
			);
			teardownNoPrestarted();

			await vi.advanceTimersByTimeAsync(0);
			expect(unhandledRejections).toEqual([]);
		} finally {
			vi.useRealTimers();
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

	it("clears portPromise after a synchronous factory throw in lazy WeChat clipboard and visual rasterizer loaders so retries succeed", async () => {
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

		const loadWechatClipboard = vi
			.fn()
			.mockResolvedValueOnce({
				createBrowserWechatClipboard: () => {
					throw new Error("clipboard-factory-sync-boom");
				},
			})
			.mockResolvedValueOnce(actual);

		const expectedRasterResult: WechatVisualRasterizationResult = {
			file: new File(["png"], "visual.png", { type: "image/png" }),
			height: 40,
			pixelCount: 4000,
			width: 100,
		};
		const rasterizeSpy = vi.fn().mockResolvedValue(expectedRasterResult);
		const loadWechatVisualRasterizer = vi
			.fn()
			.mockResolvedValueOnce({
				createBrowserWechatVisualRasterizer: () => {
					throw new Error("rasterizer-factory-sync-boom");
				},
			})
			.mockResolvedValueOnce({
				createBrowserWechatVisualRasterizer: () => ({
					rasterize: rasterizeSpy,
				}),
			});

		try {
			const teardown = mountAdminEditor(bootstrap, {
				document,
				failureMessage: "Editor failed",
				loadWechatClipboard,
				loadWechatVisualRasterizer,
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
							wechatClipboard: WechatClipboardPort;
							wechatVisualRasterizationPort: WechatVisualRasterizationPort;
						};
					};
				};
			};
			const { wechatClipboard, wechatVisualRasterizationPort } =
				rendered.props.children.props;

			// 1. Lazy WeChat clipboard factory throws synchronously -> first call fails,
			//    portPromise resets, and subsequent retry loads and succeeds.
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML = "<p>Retry after factory throw</p>";
			Object.defineProperty(preview, "innerText", {
				configurable: true,
				value: "Retry after factory throw",
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

			await expect(wechatClipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(loadWechatClipboard).toHaveBeenCalledTimes(1);

			await expect(wechatClipboard.copy(preview)).resolves.toEqual({
				method: "clipboard",
				status: "copied",
			});
			expect(loadWechatClipboard).toHaveBeenCalledTimes(2);
			expect(writtenPayloads).toHaveLength(1);
			expect(writtenPayloads[0]?.html).toContain("Retry after factory throw");

			// 2. Lazy WeChat visual rasterizer factory throws synchronously -> first call
			//    rejects with unavailable error, portPromise resets, and retry succeeds.
			const rasterElement = document.createElement("div");
			const rasterRequest = {
				height: 40,
				kind: "math" as const,
				mathCapture: "content" as const,
				maxPixels: 16_777_216,
				scale: 2,
				signal: new AbortController().signal,
				source: rasterElement,
				width: 100,
			};
			await expect(
				wechatVisualRasterizationPort.rasterize(rasterRequest),
			).rejects.toMatchObject({
				code: "wechat-png-rasterization-unavailable",
			});
			expect(loadWechatVisualRasterizer).toHaveBeenCalledTimes(1);

			await expect(
				wechatVisualRasterizationPort.rasterize(rasterRequest),
			).resolves.toEqual(expectedRasterResult);
			expect(loadWechatVisualRasterizer).toHaveBeenCalledTimes(2);
			expect(rasterizeSpy).toHaveBeenCalledOnce();
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
