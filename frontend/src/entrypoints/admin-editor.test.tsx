import { createRoot } from "@wordpress/element";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEditorRootBootstrap } from "../contracts/bootstrap/editor-root-bootstrap";
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
	() => ({ createBrowserWechatClipboard: vi.fn(() => ({})) }),
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

	it("mounts the production root once and returns idempotent teardown", () => {
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
		expect(createBrowserWechatClipboard).toHaveBeenCalledWith(
			expect.objectContaining({
				approvedAssetBaseUrl: bootstrap.previewEnhancement.assetBaseUrl,
				approvedKaTeXCssUrl: bootstrap.previewEnhancement.assets.katexCssUrl,
				wechatMathAtlasContentVersion:
					bootstrap.wechatExport.wechatMathAtlasContentVersion,
				wechatMathAtlasUrl: bootstrap.wechatExport.wechatMathAtlasUrl,
			}),
		);
		expect(createBrowserLocalDraftStorage).toHaveBeenCalledWith(
			expect.objectContaining({
				config: { ...bootstrap.localDrafts, postId: 11 },
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
					};
				};
			};
		};
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
		expect(
			nativeEditor?.classList.contains("easymde-native-editor-hidden"),
		).toBe(false);
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
		} finally {
			Object.defineProperty(window, "fetch", {
				configurable: true,
				writable: true,
				value: originalFetch,
			});
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
