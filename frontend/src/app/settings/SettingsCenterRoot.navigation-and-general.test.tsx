import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "@wordpress/element";
import { Profiler } from "react";
import { describe, expect, it, vi } from "vitest";

import { SettingsCenterRoot } from "./SettingsCenterRoot";
import {
	bootstrap,
	installSettingsCenterLocationLifecycle,
} from "./settings-center-root.test-harness";

installSettingsCenterLocationLifecycle();

describe("SettingsCenterRoot global search", () => {
	it("commits the complete production root once during initial mount", () => {
		const commitPhases: string[] = [];
		const overlayRoot = document.createElement("div");

		render(
			<Profiler
				id="settings-center"
				onRender={(_id, phase) => commitPhases.push(phase)}
			>
				<SettingsCenterRoot bootstrap={bootstrap()} overlayRoot={overlayRoot} />
			</Profiler>,
		);

		expect(commitPhases).toEqual(["mount"]);
	});

	it("builds the complete search index only when search is first used", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const search = screen.getByRole("searchbox", { name: "searchSettings" });

		expect(container.querySelector('[id^="settings-search-"]')).toBeNull();
		await user.click(search);
		expect(container.querySelector('[id^="settings-search-"]')).not.toBeNull();
		await user.type(search, "tableAlignment");
		expect(
			await screen.findByRole("button", { name: "tableAlignment" }),
		).not.toBeNull();
	});

	it("renders only the six implemented navigation items and sections", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);

		expect(
			Array.from(container.querySelectorAll("[data-nav-id]"), (element) =>
				element.getAttribute("data-nav-id"),
			),
		).toEqual([
			"general",
			"shortcuts",
			"images",
			"markdown",
			"transfer",
			"about",
		]);
		expect(
			Array.from(
				container.querySelectorAll("[data-settings-section]"),
				(element) => element.getAttribute("data-settings-section"),
			),
		).toEqual([
			"general",
			"shortcuts",
			"images",
			"markdown",
			"transfer",
			"about",
		]);
	});

	it("keeps an active compact navigation item visible without scrolling the settings root", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		const navigation = container.querySelector("nav");
		const imagesButton = screen.getByRole("button", { name: "images" });
		if (!(settingsRoot instanceof HTMLDivElement) || !navigation)
			throw new Error("settings-center-navigation-test-elements-missing");

		const rootScrollTo = vi.fn();
		const navigationScrollTo = vi.fn();
		const itemScrollIntoView = vi.fn();
		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: rootScrollTo,
		});
		Object.defineProperties(navigation, {
			clientWidth: { configurable: true, value: 100 },
			scrollWidth: { configurable: true, value: 300 },
			clientHeight: { configurable: true, value: 40 },
			scrollHeight: { configurable: true, value: 40 },
			scrollLeft: { configurable: true, value: 20 },
			scrollTo: { configurable: true, value: navigationScrollTo },
		});
		navigation.getBoundingClientRect = () =>
			({ left: 0, right: 100, top: 0, bottom: 40 }) as DOMRect;
		imagesButton.getBoundingClientRect = () =>
			({ left: 180, right: 260, top: 0, bottom: 40 }) as DOMRect;
		Object.defineProperty(imagesButton, "scrollIntoView", {
			configurable: true,
			value: itemScrollIntoView,
		});

		await user.click(imagesButton);

		await waitFor(() =>
			expect(navigationScrollTo).toHaveBeenCalledWith({
				left: 180,
				top: 0,
				behavior: "auto",
			}),
		);
		expect(itemScrollIntoView).not.toHaveBeenCalled();
		expect(rootScrollTo).toHaveBeenCalledOnce();
	});

	it("converts scaled navigation geometry into scroll coordinates", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		const navigation = container.querySelector("nav");
		const aboutButton = screen.getByRole("button", { name: "about" });
		if (!(settingsRoot instanceof HTMLDivElement) || !navigation)
			throw new Error("settings-center-navigation-test-element-missing");

		const navigationScrollTo = vi.fn();
		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: vi.fn(),
		});
		Object.defineProperties(navigation, {
			clientWidth: { configurable: true, value: 100 },
			scrollWidth: { configurable: true, value: 100 },
			clientHeight: { configurable: true, value: 40 },
			scrollHeight: { configurable: true, value: 240 },
			scrollTop: { configurable: true, value: 100 },
			scrollTo: { configurable: true, value: navigationScrollTo },
		});
		navigation.getBoundingClientRect = () =>
			({
				left: 0,
				right: 96,
				top: 0,
				bottom: 38.4,
				width: 96,
				height: 38.4,
			}) as DOMRect;
		aboutButton.getBoundingClientRect = () =>
			({ left: 0, right: 96, top: 11.52, bottom: 41.28 }) as DOMRect;

		await user.click(aboutButton);

		await waitFor(() =>
			expect(navigationScrollTo).toHaveBeenCalledWith({
				left: 0,
				top: 103,
				behavior: "auto",
			}),
		);
	});

	it("opens Help from the sidebar and restores its trigger focus", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		const trigger = screen.getByRole("button", { name: "openDocumentation" });
		await user.click(trigger);

		const dialog = within(overlayRoot).getByRole("dialog", {
			name: "aboutHelpDialogTitle",
		});
		expect(
			within(dialog).getByText("aboutHelpEditorWorkflowDescription"),
		).not.toBeNull();
		expect(document.activeElement).toBe(
			within(dialog).getByRole("button", {
				name: "aboutCloseOperationDialog",
			}),
		);

		const dialogLayer = dialog.parentElement;
		const backdrop = dialogLayer?.querySelector<HTMLButtonElement>(
			".easymde-settings-center__dialog-backdrop",
		);
		if (!backdrop)
			throw new Error("settings-center-help-dialog-backdrop-missing");
		await user.click(backdrop);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it("scrolls implemented tabs within the settings container using measured sticky offsets", async () => {
		const user = userEvent.setup();
		const windowScrollTo = vi.spyOn(window, "scrollTo");
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		const stickyHeader = container.querySelector(
			".easymde-settings-center__sticky-header",
		);
		const saveBar = container.querySelector(
			".easymde-settings-center__save-bar",
		);
		const markdown = container.querySelector("#settings-section-markdown");
		if (
			!(settingsRoot instanceof HTMLDivElement) ||
			!(stickyHeader instanceof HTMLDivElement) ||
			!(saveBar instanceof HTMLDivElement) ||
			!(markdown instanceof HTMLElement)
		)
			throw new Error("settings-center-scroll-test-target-missing");

		Object.defineProperty(settingsRoot, "scrollTop", {
			configurable: true,
			value: 100,
			writable: true,
		});
		const scrollTo = vi.fn();
		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: scrollTo,
		});
		Object.defineProperty(settingsRoot, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 900, top: 100 }),
		});
		Object.defineProperty(stickyHeader, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 336, top: 100 }),
		});
		Object.defineProperty(saveBar, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 384, top: 336 }),
		});
		Object.defineProperty(markdown, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 1120, top: 1100 }),
		});

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
		await user.click(screen.getByRole("button", { name: "markdown" }));

		expect(scrollTo).toHaveBeenCalledWith({ top: 807, behavior: "auto" });
		expect(windowScrollTo).not.toHaveBeenCalled();
		windowScrollTo.mockRestore();
	});

	it("keeps the selected section stable inside the scrollspy boundary band", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		const stickyHeader = container.querySelector(
			".easymde-settings-center__sticky-header",
		);
		const sections = Array.from(
			container.querySelectorAll<HTMLElement>("[data-settings-section]"),
		);
		const images = container.querySelector<HTMLElement>(
			"#settings-section-images",
		);
		if (
			!(settingsRoot instanceof HTMLDivElement) ||
			!(stickyHeader instanceof HTMLDivElement) ||
			!images
		)
			throw new Error("settings-center-scrollspy-boundary-target-missing");

		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: vi.fn(),
		});
		Object.defineProperty(settingsRoot, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 844, top: 0 }),
		});
		Object.defineProperty(stickyHeader, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 300, top: 112 }),
		});
		let imagesTop = 317;
		for (const [index, section] of sections.entries()) {
			Object.defineProperty(section, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					bottom: index < 2 ? -100 : imagesTop + (index - 2) * 1000 + 900,
					top: index < 2 ? -200 + index * 50 : imagesTop + (index - 2) * 1000,
				}),
			});
		}

		await user.click(screen.getByRole("button", { name: "images" }));
		fireEvent.scroll(settingsRoot);
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "images" })
					.getAttribute("aria-current"),
			).toBe("page"),
		);

		imagesTop = 340;
		fireEvent.scroll(settingsRoot);
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "shortcuts" })
					.getAttribute("aria-current"),
			).toBe("page"),
		);
	});

	it("coalesces repeated scrollspy layout reads into one animation frame", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		const stickyHeader = container.querySelector(
			".easymde-settings-center__sticky-header",
		);
		const general = container.querySelector("#settings-section-general");
		if (
			!(settingsRoot instanceof HTMLDivElement) ||
			!(stickyHeader instanceof HTMLDivElement) ||
			!(general instanceof HTMLElement)
		)
			throw new Error("settings-center-scroll-coalescing-target-missing");

		Object.defineProperty(settingsRoot, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 900, top: 0 }),
		});
		Object.defineProperty(stickyHeader, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ bottom: 237, top: 0 }),
		});
		const generalRect = vi.fn(() => ({ bottom: 900, top: 240 }));
		Object.defineProperty(general, "getBoundingClientRect", {
			configurable: true,
			value: generalRect,
		});
		let scheduledFrame: FrameRequestCallback | null = null;
		const requestFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				scheduledFrame = callback;
				return 91;
			});

		fireEvent.scroll(settingsRoot);
		fireEvent.scroll(settingsRoot);
		fireEvent.scroll(settingsRoot);

		expect(requestFrame).toHaveBeenCalledTimes(1);
		expect(generalRect).not.toHaveBeenCalled();
		if (!scheduledFrame)
			throw new Error("settings-center-scroll-coalescing-frame-missing");
		(scheduledFrame as FrameRequestCallback)(16);
		expect(generalRect).toHaveBeenCalledOnce();
		requestFrame.mockRestore();
	});

	it("indexes and opens results from sections beyond General", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		if (!(settingsRoot instanceof HTMLDivElement))
			throw new Error("settings-search-root-missing");
		const scrollTo = vi.fn();
		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: scrollTo,
		});
		const search = screen.getByRole<HTMLInputElement>("searchbox", {
			name: "searchSettings",
		});

		await user.type(search, "tableAlignment");

		const result = await screen.findByRole("button", {
			name: "tableAlignment",
		});
		expect(
			screen
				.getByRole("button", { name: "markdown" })
				.getAttribute("aria-current"),
		).toBe("page");
		await user.click(result);

		expect(search.value).toBe("");
		expect(screen.getByText("tableAlignment")).not.toBeNull();
		await waitFor(() => expect(scrollTo).toHaveBeenCalledOnce());
	});

	it("reports no results only after searching the complete settings index", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.type(
			screen.getByRole("searchbox", { name: "searchSettings" }),
			"not-a-setting",
		);

		expect(
			await screen.findByRole("heading", {
				name: "noSearchResults",
			}),
		).not.toBeNull();
	});

	it("keeps owner-backed image settings searchable and focuses their control", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const settingsRoot = container.firstElementChild;
		if (!(settingsRoot instanceof HTMLDivElement))
			throw new Error("settings-search-root-missing");
		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: vi.fn(),
		});

		expect(
			screen
				.getByRole("switch", { name: "enableBackupImageHost" })
				.matches(":disabled"),
		).toBe(false);
		await user.type(
			screen.getByRole("searchbox", { name: "searchSettings" }),
			"backupBucket",
		);
		expect(
			screen
				.getByRole("textbox", { name: "backupBucket" })
				.matches(":disabled"),
		).toBe(false);
		await user.click(
			await screen.findByRole("button", { name: "backupBucket" }),
		);

		const target = screen.getByRole("textbox", { name: "backupBucket" });
		await waitFor(() => expect(document.activeElement).toBe(target));
	});

	it("adds and removes hosting settings from search as the feature is toggled", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot
				bootstrap={bootstrap({ imageHostingEnabled: false })}
			/>,
		);
		const settingsRoot = container.firstElementChild;
		if (!(settingsRoot instanceof HTMLDivElement))
			throw new Error("settings-search-root-missing");
		Object.defineProperty(settingsRoot, "scrollTo", {
			configurable: true,
			value: vi.fn(),
		});
		const search = screen.getByRole("searchbox", { name: "searchSettings" });
		const toggle = screen.getByRole("switch", { name: "enableImageHosting" });

		await user.type(search, "fileNameRule");
		expect(
			await screen.findByRole("button", { name: /^fileNameRule/u }),
		).not.toBeNull();
		await user.click(screen.getByRole("button", { name: /^fileNameRule/u }));
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("textbox", { name: "fileNameRule" }),
			),
		);

		for (const query of ["selectImageHostService", "uploadRetryCount"]) {
			await user.type(search, query);
			expect(
				await screen.findByRole("heading", { name: "noSearchResults" }),
			).not.toBeNull();
			await user.click(screen.getByRole("button", { name: "clearSearch" }));
		}

		await user.click(toggle);
		await user.type(search, "selectImageHostService");
		expect(
			await screen.findByRole("button", { name: "selectImageHostService" }),
		).not.toBeNull();

		await user.click(toggle);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "selectImageHostService" }),
			).toBeNull(),
		);
		expect(
			await screen.findByRole("heading", { name: "noSearchResults" }),
		).not.toBeNull();
	});

	it("enables only owner-backed upload formats and keeps one format selected", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const formats = [
			"allowUploadWebp",
			"allowUploadPng",
			"allowUploadJpg",
			"allowUploadJpeg",
			"allowUploadJfif",
			"allowUploadGif",
		];
		const controls = formats.map((name) =>
			screen.getByRole<HTMLInputElement>("checkbox", { name }),
		);
		const [webp, png, jpg, jpeg, jfif, gif] = controls;
		if (!jpg || !png || !webp || !jpeg || !jfif || !gif)
			throw new Error("settings-upload-format-controls-missing");

		expect(controls.every((control) => !control.disabled)).toBe(true);
		await user.click(webp);
		await user.click(png);
		await user.click(jpg);
		await user.click(jpeg);
		await user.click(jfif);

		expect(gif.checked).toBe(true);
		expect(gif.disabled).toBe(false);
		await user.click(gif);
		expect(gif.checked).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain(
			"uploadFormatRequired",
		);
		await user.click(webp);
		expect(webp.checked).toBe(true);
		expect(screen.queryByRole("alert")).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "compressImages" })
				.matches(":disabled"),
		).toBe(false);
	});

	it("excludes the About page from the settings search index", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.type(
			screen.getByRole("searchbox", { name: "searchSettings" }),
			"aboutVersionInformation",
		);
		expect(await screen.findByText("noSearchResults")).not.toBeNull();
		expect(
			screen.queryByText("aboutVersionInformation", {
				selector: ".easymde-settings-center__search-results strong",
			}),
		).toBeNull();
	});

	it("cancels pending result navigation when the settings root unmounts", async () => {
		const user = userEvent.setup();
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockReturnValue(41);
		const cancelAnimationFrame = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => undefined);
		const { unmount } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.type(
			screen.getByRole("searchbox", { name: "searchSettings" }),
			"tableAlignment",
		);
		await user.click(
			await screen.findByRole("button", { name: "tableAlignment" }),
		);
		expect(requestAnimationFrame).toHaveBeenCalledOnce();

		unmount();
		expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
		requestAnimationFrame.mockRestore();
		cancelAnimationFrame.mockRestore();
	});
});

describe("SettingsCenterRoot Markdown section", () => {
	it("renders only the remaining Markdown groups after Images in the continuous settings card", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const sections = Array.from(
			container.querySelectorAll("[data-settings-section]"),
		);

		expect(
			sections
				.slice(0, 4)
				.map((section) => section.getAttribute("data-settings-section")),
		).toEqual(["general", "shortcuts", "images", "markdown"]);
		expect(
			screen.getByRole("heading", { name: "markdownEditorSettings" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "markdownParsingRendering" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("heading", { name: "markdownExtensions" }),
		).toBeNull();
		expect(screen.queryByRole("heading", { name: "otherSettings" })).toBeNull();
		const parsing = screen
			.getByRole("heading", { name: "markdownParsingRendering" })
			.closest("section");
		expect(parsing).not.toBeNull();
		expect(
			within(parsing as HTMLElement).getByRole("switch", {
				name: "pasteAsMarkdown",
			}),
		).not.toBeNull();
	});

	it("does not render settings for parser defaults or editor-owned presentation", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		for (const name of [
			"markdownLivePreview",
			"fixedToolbar",
			"taskLists",
			"emoji",
			"mathSupport",
			"tableExtension",
			"footnotes",
			"definitionLists",
			"imageSizeSyntax",
		]) {
			expect(screen.queryByRole("switch", { name })).toBeNull();
		}
	});

	it("enables word wrapping and keeps remaining Markdown controls without runtime owners unavailable", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const markdown = document.querySelector(
			'[data-settings-section="markdown"]',
		);
		if (!(markdown instanceof HTMLElement))
			throw new Error("markdown-settings-section-missing");
		const controls = within(markdown);
		const wordWrap = controls.getByRole("switch", { name: "wordWrap" });
		const themeRendering = controls.getByRole("switch", {
			name: "applyEditorThemeToFrontend",
		});

		expect(wordWrap.matches(":disabled")).toBe(false);
		fireEvent.click(wordWrap);
		expect(wordWrap.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByRole("button", { name: "saveSettings" })).not.toBeNull();
		expect(themeRendering.matches(":disabled")).toBe(false);
		expect(
			controls.queryByRole("textbox", { name: "unorderedListMarker" }),
		).toBeNull();
		expect(
			controls.queryByRole("switch", { name: "showLineNumbers" }),
		).toBeNull();
		expect(wordWrap.getAttribute("aria-describedby")).toBeNull();
		expect(
			document.getElementById("easymde-markdown-unavailable"),
		).not.toBeNull();
	});
});

describe("SettingsCenterRoot About section", () => {
	it("renders every About group after Transfer instead of a placeholder", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const sections = Array.from(
			container.querySelectorAll("[data-settings-section]"),
		);

		expect(
			sections.map((section) => section.getAttribute("data-settings-section")),
		).toEqual([
			"general",
			"shortcuts",
			"images",
			"markdown",
			"transfer",
			"about",
		]);
		expect(
			screen.getByRole("heading", { name: "aboutVersionInformation" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "aboutCoreCapabilities" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "aboutResourcesSupport" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "aboutPluginIntroduction" }),
		).not.toBeNull();
	});

	it("links About actions to their maintained project resources", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		expect(
			screen
				.getByRole("link", { name: "aboutCheckUpdates" })
				.getAttribute("href"),
		).toBe("https://github.com/tao-xiaoxin/EasyMDE/releases");
		expect(
			screen
				.getByRole("link", { name: "aboutIssueFeedback" })
				.getAttribute("href"),
		).toBe("https://github.com/tao-xiaoxin/EasyMDE/issues");
		expect(
			screen.queryByRole("link", { name: /aboutSecurityPolicy/ }),
		).toBeNull();
	});

	it("opens truthful Help and Changelog dialogs and restores trigger focus", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		const documentation = screen.getByRole("button", {
			name: /aboutOfficialDocumentation/,
		});
		await user.click(documentation);
		const helpDialog = within(overlayRoot).getByRole("dialog", {
			name: "aboutHelpDialogTitle",
		});
		expect(
			within(helpDialog).getByText("aboutHelpEditorWorkflowDescription"),
		).not.toBeNull();
		const openDocumentation = within(helpDialog).getByRole("link", {
			name: "aboutOpenFullDocumentation",
		});
		const helpClose = within(helpDialog).getByRole("button", {
			name: "aboutCloseOperationDialog",
		});
		const closeHelp = within(helpDialog).getByRole("button", {
			name: "aboutClose",
		});
		expect(document.activeElement).toBe(helpClose);
		await user.tab();
		expect(document.activeElement).toBe(openDocumentation);
		await user.tab();
		expect(document.activeElement).toBe(closeHelp);
		await user.tab();
		expect(document.activeElement).toBe(helpClose);
		await user.keyboard("{Shift>}{Tab}{/Shift}");
		expect(document.activeElement).toBe(closeHelp);

		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(documentation));

		const changelog = screen.getByRole("button", { name: /aboutChangelog/ });
		await user.click(changelog);
		const changelogDialog = within(overlayRoot).getByRole("dialog", {
			name: "aboutChangelog",
		});
		expect(
			within(changelogDialog).getByText("vaboutCurrentVersionValue"),
		).not.toBeNull();
		expect(
			within(changelogDialog).getByText("vaboutVersion017"),
		).not.toBeNull();
		await user.click(
			within(changelogDialog).getByRole("button", { name: "aboutClose" }),
		);
		await waitFor(() => expect(document.activeElement).toBe(changelog));
	});
});
