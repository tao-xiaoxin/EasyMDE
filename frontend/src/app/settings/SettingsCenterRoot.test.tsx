import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "@wordpress/element";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { SettingsCenterSettings } from "../../contracts/settings-center-settings";
import {
	SETTINGS_CENTER_DEFAULT_SETTINGS,
	SETTINGS_CENTER_TEST_SETTINGS,
} from "../../test/settings-center-settings-fixture";
import { SettingsCenterRoot } from "./SettingsCenterRoot";

function bootstrap({
	configuredImageDomains = false,
}: {
	configuredImageDomains?: boolean;
} = {}): SettingsCenterBootstrap {
	return {
		schemaVersion: 2,
		closeUrl: "/wp-admin/options-general.php",
		uploadLimits: { systemMaxBytes: 5 * 1024 * 1024 },
		api: {
			settingsUrl: "/wp-json/easymde/v1/settings",
			actionNonce: "test-action-nonce",
			imageHostingVerificationActionNonce: "test-image-hosting-action-nonce",
			imageHostingVerificationUrl:
				"/wp-json/easymde/v1/image-hosting/verification",
			imageHostingSecretRevealActionNonce:
				"test-image-hosting-secret-reveal-action-nonce",
			imageHostingSecretRevealUrl: "/wp-json/easymde/v1/image-hosting/secret",
			nonce: "test-nonce",
		},
		assets: {
			brandMarkUrl: "/plugin/brand.png",
			headerIllustrationUrl: "/plugin/header.png",
			searchEmptyIllustrationUrl: "/plugin/search-empty.png",
		},
		links: {
			projectUrl: "https://github.com/tao-xiaoxin/EasyMDE",
			documentationUrl: "https://github.com/tao-xiaoxin/EasyMDE#readme",
			releasesUrl: "https://github.com/tao-xiaoxin/EasyMDE/releases",
			issuesUrl: "https://github.com/tao-xiaoxin/EasyMDE/issues",
			securityUrl: "https://github.com/tao-xiaoxin/EasyMDE/security/policy",
			licenseUrl: "https://github.com/tao-xiaoxin/EasyMDE/blob/main/LICENSE",
		},
		drafts: {
			images: {
				domain: "https://img.example.test",
				backupDomain: "https://backup.example.test",
				primaryCredentialsConfigured: false,
				backupCredentialsConfigured: false,
			},
		},
		settings: configuredImageDomains
			? {
					...SETTINGS_CENTER_TEST_SETTINGS,
					images: {
						...SETTINGS_CENTER_TEST_SETTINGS.images,
						domain: "https://img.example.test",
						backupDomain: "https://backup.example.test",
					},
				}
			: SETTINGS_CENTER_TEST_SETTINGS,
		defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
		strings: {
			...Object.fromEntries(
				SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
			),
			editPrompt: "editPrompt %s",
			duplicatePrompt: "duplicatePrompt %s",
			deletePrompt: "deletePrompt %s",
			transferFileSelectedNotice: "transferFileSelectedNotice %s",
		} as unknown as SettingsCenterBootstrap["strings"],
	};
}

let originalLocation: Location;

beforeEach(() => {
	originalLocation = window.location;
	Object.defineProperty(window, "location", {
		configurable: true,
		value: new URL("https://example.test/wp-admin/options.php"),
	});
});

afterEach(() => {
	Object.defineProperty(window, "location", {
		configurable: true,
		value: originalLocation,
	});
});
describe("SettingsCenterRoot global search", () => {
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

		await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
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

	it("enables only owner-backed upload formats and keeps one format selected", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const formats = [
			"allowUploadJpg",
			"allowUploadPng",
			"allowUploadWebp",
			"allowUploadGif",
		];
		const controls = formats.map((name) =>
			screen.getByRole<HTMLInputElement>("checkbox", { name }),
		);
		const [jpg, png, webp, gif] = controls;
		if (!jpg || !png || !webp || !gif)
			throw new Error("settings-upload-format-controls-missing");

		expect(controls.every((control) => !control.disabled)).toBe(true);
		await user.click(jpg);
		await user.click(png);
		await user.click(webp);

		expect(gif.checked).toBe(true);
		expect(gif.disabled).toBe(false);
		await user.click(gif);
		expect(gif.checked).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain(
			"uploadFormatRequired",
		);
		await user.click(
			screen.getByRole("button", { name: "closeImageFeedback" }),
		);
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

describe("SettingsCenterRoot shortcuts section", () => {
	it("renders General and Shortcuts as consecutive settings sections", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const sections = Array.from(
			container.querySelectorAll("[data-settings-section]"),
		);

		expect(
			sections
				.slice(0, 2)
				.map((section) => section.getAttribute("data-settings-section")),
		).toEqual(["general", "shortcuts"]);
		expect(
			screen.getByRole("heading", { name: "commonShortcuts" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "headingAndFormatting" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "shortcutBehavior" }),
		).not.toBeNull();
	});

	it("restores every shortcut from the single reference reset command", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const windowsSave = screen.getByRole<HTMLInputElement>("textbox", {
			name: "saveArticle windowsLinux",
		});
		const macSave = screen.getByRole<HTMLInputElement>("textbox", {
			name: "saveArticle macOS",
		});
		const headingWindows = screen.getByRole<HTMLInputElement>("textbox", {
			name: "headingOne windowsLinux",
		});

		expect(windowsSave.value).toBe("Ctrl+S");
		expect(macSave.value).toBe("Cmd+S");
		await user.clear(windowsSave);
		await user.type(windowsSave, "Ctrl+Shift+S");
		await user.clear(headingWindows);
		await user.type(headingWindows, "Ctrl+Shift+1");
		expect(windowsSave.value).toBe("Ctrl+Shift+S");
		expect(headingWindows.value).toBe("Ctrl+Shift+1");

		const commonGroup = screen
			.getByRole("heading", { name: "commonShortcuts" })
			.closest("section");
		if (!(commonGroup instanceof HTMLElement))
			throw new Error("common-shortcuts-group-missing");
		await user.click(
			within(commonGroup).getByRole("button", {
				name: "restoreDefaultShortcuts",
			}),
		);
		expect(windowsSave.value).toBe("Ctrl+S");
		expect(macSave.value).toBe("Cmd+S");
		expect(headingWindows.value).toBe("Ctrl+1");
	});

	it("shows the reset command only on the reference common-shortcuts group", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const commonGroup = screen
			.getByRole("heading", { name: "commonShortcuts" })
			.closest("section");
		const headingGroup = screen
			.getByRole("heading", { name: "headingAndFormatting" })
			.closest("section");
		if (
			!(commonGroup instanceof HTMLElement) ||
			!(headingGroup instanceof HTMLElement)
		)
			throw new Error("shortcut-reset-visibility-groups-missing");

		expect(
			within(commonGroup).getByRole("button", {
				name: "restoreDefaultShortcuts",
			}),
		).not.toBeNull();
		expect(
			within(headingGroup).queryByRole("button", {
				name: "restoreDefaultShortcuts",
			}),
		).toBeNull();
	});

	it("restores an empty shortcut from defaults when suggestions are enabled", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const windowsSave = screen.getByRole<HTMLInputElement>("textbox", {
			name: "saveArticle windowsLinux",
		});

		await user.clear(windowsSave);
		await user.tab();

		expect(windowsSave.value).toBe("Ctrl+S");
	});

	it("preserves an empty shortcut when suggestions are disabled", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		await user.click(
			screen.getByRole("switch", { name: "customShortcutSuggestions" }),
		);
		const windowsSave = screen.getByRole<HTMLInputElement>("textbox", {
			name: "saveArticle windowsLinux",
		});
		await user.clear(windowsSave);
		await user.tab();
		expect(windowsSave.value).toBe("");
	});

	it("enables shortcut behavior and marks duplicate bindings by platform", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const behavior = screen
			.getByRole("heading", { name: "shortcutBehavior" })
			.closest("section");
		if (!behavior) throw new Error("shortcut-behavior-section-missing");
		const hints = within(behavior).getByRole("switch", {
			name: "showShortcutHints",
		});

		expect(hints.getAttribute("aria-checked")).toBe("true");
		expect(hints.matches(":disabled")).toBe(false);
		await user.clear(
			screen.getByRole("textbox", { name: "bold windowsLinux" }),
		);
		await user.type(
			screen.getByRole("textbox", { name: "bold windowsLinux" }),
			"Ctrl+S",
		);
		expect(
			screen
				.getByRole("textbox", { name: "saveArticle windowsLinux" })
				.getAttribute("aria-invalid"),
		).toBe("true");
		expect(
			screen
				.getByRole("textbox", { name: "bold windowsLinux" })
				.getAttribute("aria-invalid"),
		).toBe("true");
		await user.click(
			screen.getByRole("switch", { name: "detectShortcutConflicts" }),
		);
		expect(
			screen
				.getByRole("textbox", { name: "bold windowsLinux" })
				.getAttribute("aria-invalid"),
		).toBeNull();
	});
});

describe("SettingsCenterRoot images section", () => {
	it("renders the Images groups after Shortcuts in the continuous settings card", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const sections = Array.from(
			container.querySelectorAll("[data-settings-section]"),
		);

		expect(
			sections
				.slice(0, 3)
				.map((section) => section.getAttribute("data-settings-section")),
		).toEqual(["general", "shortcuts", "images"]);
		expect(
			screen.getByRole("heading", { name: "imageHostService" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "backupImageHost" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "uploadBehavior" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("heading", { name: "defaultInsertion" }),
		).toBeNull();
	});

	it("toggles the owner-backed backup image-host fields", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const backup = screen.getByRole("switch", {
			name: "enableBackupImageHost",
		});

		expect(
			screen.getByRole("textbox", { name: "backupBucket" }),
		).not.toBeNull();
		expect(
			screen
				.getByRole("textbox", { name: "backupBucket" })
				.matches(":disabled"),
		).toBe(false);
		expect(backup.matches(":disabled")).toBe(false);
		await user.click(backup);
		expect(screen.queryByRole("textbox", { name: "backupBucket" })).toBeNull();
	});

	it("exposes real server-backed image-host upload verification", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const imagesSection = screen
			.getByRole("heading", { name: "imageHostService" })
			.closest('[data-settings-section="images"]');
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("images-settings-section-missing");
		const images = within(imagesSection);

		expect(
			images
				.getByRole("button", { name: "verifyPrimaryUpload" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			images
				.getByRole("button", { name: "verifyBackupUpload" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			images.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerificationPending", "uploadVerificationPending"]);
	});

	it("enables the server-owned filename behavior and upload formats", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const rule = screen.getByRole<HTMLInputElement>("textbox", {
			name: "fileNameRule",
		});
		const gif = screen.getByRole("checkbox", { name: "allowUploadGif" });

		expect(rule.matches(":disabled")).toBe(false);
		expect(gif.matches(":disabled")).toBe(false);
		expect(
			screen
				.getByRole("button", { name: "fileNamePresetMd5" })
				.matches(":disabled"),
		).toBe(false);
	});

	it("exposes only the owner-backed image title display setting", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		expect(
			screen.getByRole<HTMLButtonElement>("combobox", {
				name: "imageTitleDisplay",
			}).disabled,
		).toBe(false);
		expect(screen.queryByLabelText("defaultInsertFormat")).toBeNull();
		expect(screen.queryByLabelText("altTextSource")).toBeNull();
		expect(screen.queryByLabelText("imageFeaturedPlaceholder")).toBeNull();
	});
	it("retains stable IDs while enabling the supported image provider", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const service = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "selectImageHostService",
		});
		const theme = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "editorTheme",
		});

		expect(service.textContent).toContain("cloudflareR2");
		expect(theme.textContent).toContain("automaticFollowSystem");
		expect(service.matches(":disabled")).toBe(false);
		expect(theme.matches(":disabled")).toBe(true);
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
		expect(
			screen.queryByRole("heading", { name: "otherSettings" }),
		).toBeNull();
		const parsing = screen
			.getByRole("heading", { name: "markdownParsingRendering" })
			.closest("section");
		expect(parsing).not.toBeNull();
		expect(within(parsing as HTMLElement).getByRole("switch", { name: "pasteAsMarkdown" })).not.toBeNull();
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
		const theme = controls.getByRole<HTMLSelectElement>("combobox", {
			name: "editorTheme",
		});

		expect(wordWrap.matches(":disabled")).toBe(false);
		fireEvent.click(wordWrap);
		expect(wordWrap.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByRole("button", { name: "saveSettings" })).not.toBeNull();
		expect(theme.matches(":disabled")).toBe(true);
		expect(controls.queryByRole("textbox", { name: "unorderedListMarker" })).toBeNull();
		expect(controls.queryByRole("switch", { name: "showLineNumbers" })).toBeNull();
		expect(wordWrap.getAttribute("aria-describedby")).toBeNull();
		expect(
			document.getElementById("easymde-markdown-unavailable"),
		).not.toBeNull();
	});
});

describe("SettingsCenterRoot Transfer section", () => {
	it("renders the complete Transfer groups after Markdown instead of a placeholder", () => {
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const sections = Array.from(
			container.querySelectorAll("[data-settings-section]"),
		);

		expect(
			sections
				.slice(0, 5)
				.map((section) => section.getAttribute("data-settings-section")),
		).toEqual(["general", "shortcuts", "images", "markdown", "transfer"]);
		expect(
			screen.getByRole("heading", { name: "transferExportConfiguration" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "transferImportConfiguration" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "transferConfigurationManagement" }),
		).not.toBeNull();
	});

	it("imports a valid configuration into the draft and saves it explicitly", async () => {
		const user = userEvent.setup();
		const importedSettings: SettingsCenterSettings = {
			...bootstrap().settings,
			general: {
				...bootstrap().settings.general,
				autoFocusEditor: true,
			},
			images: {
				...bootstrap().settings.images,
				titleDisplay: "filename",
			},
		};
		const legacySettings = structuredClone(importedSettings) as unknown as {
			images: Record<string, unknown>;
			markdown: Record<string, unknown>;
		};
		delete legacySettings.images.maxImageSizeMb;
		delete legacySettings.images.titleDisplay;
		Object.assign(legacySettings.images, {
			insertMarkdown: false,
			preserveFileName: true,
			copyUrl: true,
			maxImageSize: "3840",
			insertFormat: "url",
			altSource: "empty",
			captionMode: "filename",
			featuredPlaceholder: true,
		});
		Object.assign(legacySettings.markdown, {
			lineNumbers: false,
			lineEnding: "crlf",
			unorderedMarker: "*",
			orderedStart: "3",
			blockquoteStyle: "spaced",
		});
		const savedSettings = {
			...importedSettings,
			revision: importedSettings.revision + 1,
		};
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: savedSettings,
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const transferSection = container.querySelector(
			'[data-settings-section="transfer"]',
		);
		if (!(transferSection instanceof HTMLElement))
			throw new Error("settings-center-transfer-section-missing");
		const transfer = within(transferSection);
		const fileInput = transfer.getByLabelText<HTMLInputElement>(
			"transferChooseConfigurationFile",
		);

		expect(fileInput.disabled).toBe(false);
		const chooseFile = transfer.getByRole("button", {
			name: "transferChooseConfigurationFile",
		});
		expect(chooseFile.matches(":disabled")).toBe(false);
		await user.upload(
			fileInput,
			new File(
				[JSON.stringify({ schemaVersion: 1, settings: legacySettings })],
				"settings.json",
				{ type: "application/json" },
			),
		);
		await user.click(
			transfer.getByRole("button", { name: "transferConfirmImport" }),
		);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" })
				.disabled,
		).toBe(false);
		await user.click(screen.getByRole("button", { name: "saveSettings" }));
		await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
			settings: SettingsCenterSettings;
		};
		expect(body.settings.general.autoFocusEditor).toBe(true);
		expect(body.settings.images.maxImageSizeMb).toBe(5);
		expect(body.settings.images.titleDisplay).toBe("filename");
		expect(body.settings.images).not.toHaveProperty("insertFormat");
		expect(body.settings.markdown).not.toHaveProperty("lineNumbers");
		fetch.mockRestore();
	});

	it("drops the removed line number field from schema 2 imports", async () => {
		const user = userEvent.setup();
		const legacySettings = structuredClone(
			bootstrap().settings,
		) as unknown as {
			general: Record<string, unknown>;
			markdown: Record<string, unknown>;
		};
		legacySettings.general.autoFocusEditor = true;
		legacySettings.markdown.lineNumbers = false;
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: bootstrap().settings,
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const transferSection = container.querySelector(
			'[data-settings-section="transfer"]',
		);
		if (!(transferSection instanceof HTMLElement))
			throw new Error("settings-center-transfer-section-missing");
		const transfer = within(transferSection);
		const fileInput = transfer.getByLabelText<HTMLInputElement>(
			"transferChooseConfigurationFile",
		);

		await user.upload(
			fileInput,
			new File(
				[JSON.stringify({ schemaVersion: 2, settings: legacySettings })],
				"settings.json",
				{ type: "application/json" },
			),
		);
		await user.click(
			transfer.getByRole("button", { name: "transferConfirmImport" }),
		);
		await user.click(screen.getByRole("button", { name: "saveSettings" }));
		await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
			settings: SettingsCenterSettings;
		};
		expect(body.settings.markdown).not.toHaveProperty("lineNumbers");
		fetch.mockRestore();
	});

	it("exports the current draft with secrets redacted", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const transferSection = container.querySelector(
			'[data-settings-section="transfer"]',
		);
		if (!(transferSection instanceof HTMLElement))
			throw new Error("settings-center-transfer-section-missing");
		const transfer = within(transferSection);
		const createObjectUrl = vi.fn((value: Blob) => {
			void value;
			return "blob:settings-center";
		});
		const revokeObjectUrl = vi.fn();
		const originalCreateObjectUrl = URL.createObjectURL;
		const originalRevokeObjectUrl = URL.revokeObjectURL;
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectUrl,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectUrl,
		});
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);

		try {
			await user.click(
				transfer.getByRole("button", { name: /transferExportConfiguration/ }),
			);
			expect(screen.getByText("transferExportSuccess")).not.toBeNull();
			const calls = createObjectUrl.mock.calls as ReadonlyArray<
				Readonly<[Blob]>
			>;
			const firstCall = calls[0];
			if (!firstCall) throw new Error("settings-center-export-blob-missing");
			const exported = JSON.parse(await firstCall[0].text()) as {
				schemaVersion: number;
				settings: SettingsCenterSettings;
			};
			expect(exported.schemaVersion).toBe(3);
			expect(exported.settings.general.autoFocusEditor).toBe(false);
			expect(exported.settings.images.accessKey).toBe("");
			expect(exported.settings.images.secretKey).toBe("");
			expect(exported.settings.images.backupAccessKey).toBe("");
			expect(exported.settings.images.backupSecretKey).toBe("");
			expect(click).toHaveBeenCalledOnce();

			expect(
				transfer.getByLabelText<HTMLInputElement>(
					"transferChooseConfigurationFile",
				).disabled,
			).toBe(false);
		} finally {
			Object.defineProperty(URL, "createObjectURL", {
				configurable: true,
				value: originalCreateObjectUrl,
			});
			Object.defineProperty(URL, "revokeObjectURL", {
				configurable: true,
				value: originalRevokeObjectUrl,
			});
			click.mockRestore();
		}
	});
	it("preserves Unicode export names and rejects unsafe paths", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const transferSection = container.querySelector(
			'[data-settings-section="transfer"]',
		);
		if (!(transferSection instanceof HTMLElement))
			throw new Error("settings-center-transfer-section-missing");
		const transfer = within(transferSection);
		const fileName = transfer.getByRole<HTMLInputElement>("textbox", {
			name: "transferExportFileName",
		});
		const createObjectUrl = vi.fn(() => "blob:settings-center");
		const originalCreateObjectUrl = URL.createObjectURL;
		const revokeObjectUrl = vi.fn();
		const originalRevokeObjectUrl = URL.revokeObjectURL;
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectUrl,
		});
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectUrl,
		});
		let downloadName = "";
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(function (this: HTMLAnchorElement) {
				downloadName = this.download;
			});

		try {
			await user.clear(fileName);
			await user.type(fileName, "配置-导出");
			await user.click(
				transfer.getByRole("button", { name: /transferExportConfiguration/ }),
			);
			expect(downloadName).toBe("配置-导出.json");

			await user.clear(fileName);
			await user.type(fileName, "nested/导出");
			await user.click(
				transfer.getByRole("button", { name: /transferExportConfiguration/ }),
			);
			expect(click).toHaveBeenCalledOnce();
			expect(createObjectUrl).toHaveBeenCalledOnce();
			expect(screen.getByText("transferExportNameInvalid")).not.toBeNull();
		} finally {
			Object.defineProperty(URL, "createObjectURL", {
				configurable: true,
				value: originalCreateObjectUrl,
			});
			Object.defineProperty(URL, "revokeObjectURL", {
				configurable: true,
				value: originalRevokeObjectUrl,
			});
			click.mockRestore();
		}
	});

	it("resets the configuration through the explicit save path and keeps cache deletion unavailable", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		const resetTrigger = screen.getByRole("button", {
			name: /transferResetCurrentConfiguration/,
		});
		expect(resetTrigger.matches(":disabled")).toBe(false);
		await user.click(resetTrigger);
		const resetDialog = within(overlayRoot).getByRole("dialog", {
			name: "transferResetCurrentConfiguration",
		});
		await user.click(
			within(resetDialog).getByRole("button", { name: "transferConfirmReset" }),
		);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" })
				.disabled,
		).toBe(false);
		const clearCacheTrigger = screen.getByRole("button", {
			name: /transferClearLocalCache/,
		});
		expect(clearCacheTrigger.matches(":disabled")).toBe(true);
	});

	it("keeps clearing blank secrets when one credential is entered after reset", async () => {
		const user = userEvent.setup();
		const savedSettings = {
			...SETTINGS_CENTER_DEFAULT_SETTINGS,
			revision: SETTINGS_CENTER_DEFAULT_SETTINGS.revision + 1,
		};
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: savedSettings,
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		await user.click(
			screen.getByRole("button", {
				name: /transferResetCurrentConfiguration/,
			}),
		);
		const resetDialog = within(overlayRoot).getByRole("dialog", {
			name: "transferResetCurrentConfiguration",
		});
		await user.click(
			within(resetDialog).getByRole("button", {
				name: "transferConfirmReset",
			}),
		);
		await user.type(screen.getByLabelText("accessKey"), "replacement-key");
		await user.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
			resetSecrets?: boolean;
			settings: SettingsCenterSettings;
		};
		expect(body.resetSecrets).toBe(true);
		expect(body.settings.images).toMatchObject({
			accessKey: "replacement-key",
			secretKey: "",
			backupAccessKey: "",
			backupSecretKey: "",
		});
		fetch.mockRestore();
	});

	it("shows truthful storage and configuration checks in operation dialogs", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		await user.click(
			screen.getByRole("button", {
				name: /transferOpenConfigurationDirectory/,
			}),
		);
		const directoryDialog = within(overlayRoot).getByRole("dialog", {
			name: "transferConfigurationDirectory",
		});
		expect(
			within(directoryDialog).getByText("transferStorageLocationValue"),
		).not.toBeNull();
		await user.click(
			within(directoryDialog).getByRole("button", {
				name: "transferCopyStorageLocation",
			}),
		);
		expect(within(overlayRoot).getByRole("status").textContent).toContain(
			"transferStorageLocationCopied",
		);

		await user.click(
			within(directoryDialog).getByRole("button", {
				name: "transferCloseOperationDialog",
			}),
		);
		await user.click(
			screen.getByRole("button", {
				name: /transferViewConfigurationStatus/,
			}),
		);
		const statusDialog = within(overlayRoot).getByRole("dialog", {
			name: "transferConfigurationStatusCheck",
		});
		expect(
			within(statusDialog).getByText("transferCheckImageDraftIncomplete"),
		).not.toBeNull();
		expect(
			within(statusDialog).getByText("transferCheckRuntimeAssetsReady"),
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
			screen
				.getByRole("link", { name: /aboutSecurityPolicy/ })
				.getAttribute("href"),
		).toBe("https://github.com/tao-xiaoxin/EasyMDE/security/policy");
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

describe("SettingsCenterRoot persistence", () => {
	it("blocks saving an identical primary and backup host and restores focus after dismissal", async () => {
		const user = userEvent.setup();
		const fetch = vi.spyOn(window, "fetch");
		const value = bootstrap();
		const duplicateBootstrap: SettingsCenterBootstrap = {
			...value,
			settings: {
				...value.settings,
				images: {
					...value.settings.images,
					backupService: "cloudflare-r2",
					backupEndpoint: value.settings.images.endpoint,
					backupBucket: value.settings.images.bucket,
				},
			},
		};
		const { container } = render(
			<SettingsCenterRoot bootstrap={duplicateBootstrap} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement)) {
			throw new Error("settings-center-overlay-missing");
		}

		await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
		const trigger = screen.getByRole("button", { name: "saveSettings" });
		await user.click(trigger);
		const dialog = within(overlayRoot).getByRole("alertdialog", {
			name: "duplicateImageHostTitle",
		});
		expect(
			within(dialog).getByText("duplicateImageHostDescription"),
		).not.toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		fetch.mockRestore();
	});

	it("enables owner-backed controls while keeping unsupported fields unavailable", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		expect(
			screen
				.getByRole("switch", { name: "autoFocusEditor" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen.queryByRole("combobox", { name: "interfaceLanguage" }),
		).toBeNull();
		expect(
			screen
				.getByRole("combobox", { name: "defaultVisibility" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen.queryByRole("switch", { name: "smartListRecognition" }),
		).toBeNull();
		expect(
			screen
				.getByRole("combobox", { name: "summaryMode" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" })
				.disabled,
		).toBe(true);
	});

	it("saves the selected summary sync method through the Settings owner", async () => {
		const user = userEvent.setup();
		const requestBody = {
			current: null as { settings: SettingsCenterSettings } | null,
		};
		const fetch = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
			requestBody.current = JSON.parse(String(init?.body)) as {
				settings: SettingsCenterSettings;
			};
			return {
				ok: true,
				json: async () => ({
					settings: {
						...bootstrap().settings,
						revision: bootstrap().settings.revision + 1,
						general: {
							...bootstrap().settings.general,
							summaryMode: "auto-100",
						},
					},
					credentialStatus: {
						primaryConfigured: false,
						backupConfigured: false,
					},
				}),
			} as Response;
		});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.click(screen.getByRole("combobox", { name: "summaryMode" }));
		await user.click(screen.getByRole("option", { name: "summary100" }));
		await user.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() => expect(screen.getByText("settingsSaved")).not.toBeNull());
		expect(requestBody.current?.settings.general.summaryMode).toBe("auto-100");
		fetch.mockRestore();
	});

	it("changes an owner-backed dropdown and sends the selected value", async () => {
		const user = userEvent.setup();
		const payloadRef = { current: null as Record<string, unknown> | null };
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (_input, init) => {
				payloadRef.current = JSON.parse(String(init?.body)) as Record<
					string,
					unknown
				>;
				return {
					ok: true,
					json: async () => ({
						settings: {
							...bootstrap().settings,
							revision: bootstrap().settings.revision + 1,
							general: {
								...bootstrap().settings.general,
								statusBarMode: "hidden",
							},
						},
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		const select = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "statusBarDisplay",
		});
		await user.click(select);
		await user.click(screen.getByRole("option", { name: "hiddenStatusBar" }));
		expect(select.textContent).toContain("hiddenStatusBar");
		await user.click(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" }),
		);

		await waitFor(() =>
			expect(screen.getByText("settingsSaved")).not.toBeNull(),
		);
		if (!payloadRef.current) throw new Error("settings-save-payload-missing");
		const general = payloadRef.current.settings as Record<string, unknown>;
		expect((general.general as Record<string, unknown>).statusBarMode).toBe(
			"hidden",
		);
		fetch.mockRestore();
	});

	it("saves edited owner-backed settings through WordPress and reports completion", async () => {
		const user = userEvent.setup();
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: bootstrap().settings,
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
		const save = screen.getByRole<HTMLButtonElement>("button", {
			name: "saveSettings",
		});
		expect(save.disabled).toBe(false);
		await user.click(save);

		await waitFor(() =>
			expect(screen.getByText("settingsSaved")).not.toBeNull(),
		);
		expect(fetch).toHaveBeenCalledOnce();
		fetch.mockRestore();
	});

	it("saves the bounded upload retry count as a number", async () => {
		const user = userEvent.setup();
		const savedPayload = { current: null as Record<string, unknown> | null };
		const savedSettings = {
			...bootstrap().settings,
			revision: bootstrap().settings.revision + 1,
			images: {
				...bootstrap().settings.images,
				uploadRetryCount: 5,
			},
		};
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (_input, init) => {
				savedPayload.current = JSON.parse(String(init?.body)) as Record<
					string,
					unknown
				>;
				return {
					ok: true,
					json: async () => ({
						settings: savedSettings,
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		fireEvent.change(
			screen.getByRole("spinbutton", { name: "uploadRetryCount" }),
			{ target: { value: "5" } },
		);
		await user.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() =>
			expect(screen.getByText("settingsSaved")).not.toBeNull(),
		);
		if (!savedPayload.current) throw new Error("settings-save-payload-missing");
		const payloadSettings = savedPayload.current
			.settings as SettingsCenterSettings;
		expect(payloadSettings.images.uploadRetryCount).toBe(5);
		expect(
			screen.getByRole<HTMLInputElement>("spinbutton", {
				name: "uploadRetryCount",
			}).value,
		).toBe("5");
		fetch.mockRestore();
	});

	it("shows newly saved primary credentials as configured immediately", async () => {
		const user = userEvent.setup();
		const savedSettings = {
			...bootstrap().settings,
			revision: bootstrap().settings.revision + 1,
			images: {
				...bootstrap().settings.images,
				accessKey: "",
				secretKey: "",
			},
		};
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: savedSettings,
				credentialStatus: {
					primaryConfigured: true,
					backupConfigured: false,
				},
			}),
		} as Response);
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.type(screen.getByLabelText("accessKey"), "new-access-key");
		await user.type(screen.getByLabelText("secretKey"), "new-secret-key");
		await user.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() =>
			expect(
				screen.getByLabelText<HTMLInputElement>("accessKey").placeholder,
			).toBe("••••••••••••"),
		);
		expect(
			screen.getByLabelText<HTMLInputElement>("secretKey").placeholder,
		).toBe("••••••••••••");
		fetch.mockRestore();
	});

	it("keeps a replaced primary connection stale after the saved secrets are redacted", async () => {
		const user = userEvent.setup();
		const configuredBootstrap = bootstrap({ configuredImageDomains: true });
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (input, init) => {
				const url = String(input);
				if (url.endsWith("/image-hosting/verification")) {
					const request = JSON.parse(String(init?.body)) as {
						target: "primary" | "backup";
					};
					return {
						ok: true,
						json: async () => ({
							path: "20260824/00000000-0000-4000-8000-000000000000.png",
							status: "uploaded",
							target: request.target,
							url: "https://img.example.test/20260824/00000000-0000-4000-8000-000000000000.png",
						}),
					} as Response;
				}
				return {
					ok: true,
					json: async () => ({
						settings: {
							...configuredBootstrap.settings,
							revision: configuredBootstrap.settings.revision + 1,
						},
						credentialStatus: {
							primaryConfigured: true,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		const { container } = render(
			<SettingsCenterRoot bootstrap={configuredBootstrap} />,
		);
		const imagesSection = container.querySelector(
			'[data-settings-section="images"]',
		);
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("settings-center-images-section-missing");
		const images = within(imagesSection);

		await user.click(
			images.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.click(
			images.getByRole("button", { name: "verifyBackupUpload" }),
		);
		await waitFor(() =>
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerified", "uploadVerified"]),
		);

		await user.type(images.getByLabelText("secretKey"), "replacement-secret");
		expect(images.getAllByRole("status")[0]?.textContent).toBe(
			"uploadVerificationStale",
		);
		await user.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() =>
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerificationStale", "uploadVerified"]),
		);
		fetch.mockRestore();
	});

	it("tests the current unsaved image draft without requiring a settings save", async () => {
		const user = userEvent.setup();
		const configuredBootstrap = bootstrap({ configuredImageDomains: true });
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (input, init) => {
				if (!String(input).endsWith("/image-hosting/verification")) {
					throw new Error("unexpected-settings-save");
				}
				const request = JSON.parse(String(init?.body)) as {
					target: "primary";
					revision: number;
					settings: SettingsCenterSettings["images"];
				};
				expect(request).toEqual({
					target: "primary",
					revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
					settings: {
						...SETTINGS_CENTER_TEST_SETTINGS.images,
						bucket: "draft-bucket",
						domain: "https://img.example.test",
						backupDomain: "https://backup.example.test",
					},
				});
				return {
					ok: true,
					json: async () => ({
						path: "20260824/00000000-0000-4000-8000-000000000000.png",
						status: "uploaded",
						target: request.target,
						url: "https://img.example.test/20260824/00000000-0000-4000-8000-000000000000.png",
					}),
				} as Response;
			});
		const { container } = render(
			<SettingsCenterRoot bootstrap={configuredBootstrap} />,
		);
		const imagesSection = container.querySelector(
			'[data-settings-section="images"]',
		);
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("settings-center-images-section-missing");
		const images = within(imagesSection);
		const bucket = images.getByRole<HTMLInputElement>("textbox", {
			name: "bucket",
		});

		await user.clear(bucket);
		await user.type(bucket, "draft-bucket");
		const testButton = images.getByRole<HTMLButtonElement>("button", {
			name: "verifyPrimaryUpload",
		});
		expect(testButton.disabled).toBe(false);
		await user.click(testButton);

		await waitFor(() =>
			expect(images.getAllByRole("status")[0]?.textContent).toBe(
				"uploadVerified",
			),
		);
		expect(fetch).toHaveBeenCalledOnce();
		fetch.mockRestore();
	});

	it("does not revive a pre-save verification after the file-name rule is saved and then restored in the draft", async () => {
		const user = userEvent.setup();
		const configuredBootstrap = bootstrap({ configuredImageDomains: true });
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (input, init) => {
				if (String(input).endsWith("/image-hosting/verification")) {
					const request = JSON.parse(String(init?.body)) as {
						target: "primary" | "backup";
					};
					return {
						ok: true,
						json: async () => ({
							path: "20260824/00000000-0000-4000-8000-000000000000.png",
							status: "uploaded",
							target: request.target,
							url: "https://img.example.test/20260824/00000000-0000-4000-8000-000000000000.png",
						}),
					} as Response;
				}
				return {
					ok: true,
					json: async () => ({
						settings: {
							...configuredBootstrap.settings,
							revision: configuredBootstrap.settings.revision + 1,
							images: {
								...configuredBootstrap.settings.images,
								fileNameRule: "changed/{md5}.{ext}",
							},
						},
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		const { container } = render(
			<SettingsCenterRoot bootstrap={configuredBootstrap} />,
		);
		const imagesSection = container.querySelector(
			'[data-settings-section="images"]',
		);
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("settings-center-images-section-missing");
		const images = within(imagesSection);

		await user.click(
			images.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.click(
			images.getByRole("button", { name: "verifyBackupUpload" }),
		);
		await waitFor(() =>
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerified", "uploadVerified"]),
		);

		const rule = images.getByRole<HTMLInputElement>("textbox", {
			name: "fileNameRule",
		});
		await user.clear(rule);
		await user.type(rule, "changed/{md5}.{ext}");
		await user.click(screen.getByRole("button", { name: "saveSettings" }));
		await waitFor(() =>
			expect(
				container
					.querySelector("[data-save-status]")
					?.getAttribute("data-save-status"),
			).toBe("saved"),
		);
		await user.clear(rule);
		await user.type(rule, SETTINGS_CENTER_TEST_SETTINGS.images.fileNameRule);

		expect(
			images.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerificationStale", "uploadVerificationStale"]);
		fetch.mockRestore();
	});

	it("clears configured credential presentation after a reset is saved", async () => {
		const user = userEvent.setup();
		const configuredBootstrap = bootstrap({ configuredImageDomains: true });
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (input, init) => {
				if (String(input).endsWith("/image-hosting/verification")) {
					const request = JSON.parse(String(init?.body)) as {
						target: "primary" | "backup";
					};
					return {
						ok: true,
						json: async () => ({
							path: "20260824/00000000-0000-4000-8000-000000000000.png",
							status: "uploaded",
							target: request.target,
							url: "https://img.example.test/20260824/00000000-0000-4000-8000-000000000000.png",
						}),
					} as Response;
				}
				return {
					ok: true,
					json: async () => ({
						settings: {
							...configuredBootstrap.defaultSettings,
							revision: configuredBootstrap.settings.revision + 1,
						},
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		const { container } = render(
			<SettingsCenterRoot
				bootstrap={{
					...configuredBootstrap,
					drafts: {
						images: {
							...configuredBootstrap.drafts.images,
							primaryCredentialsConfigured: true,
							backupCredentialsConfigured: true,
						},
					},
				}}
			/>,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		const imagesSection = container.querySelector(
			'[data-settings-section="images"]',
		);
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("settings-center-images-section-missing");
		const images = within(imagesSection);
		expect(
			screen.getByLabelText<HTMLInputElement>("accessKey").placeholder,
		).toBe("••••••••••••");
		await user.click(
			images.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.click(
			images.getByRole("button", { name: "verifyBackupUpload" }),
		);
		await waitFor(() =>
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerified", "uploadVerified"]),
		);

		await user.click(
			screen.getByRole("button", {
				name: /transferResetCurrentConfiguration/,
			}),
		);
		const resetDialog = within(overlayRoot).getByRole("dialog", {
			name: "transferResetCurrentConfiguration",
		});
		await user.click(
			within(resetDialog).getByRole("button", {
				name: "transferConfirmReset",
			}),
		);
		await user.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() =>
			expect(
				screen.getByLabelText<HTMLInputElement>("accessKey").placeholder,
			).toBe(""),
		);
		expect(
			screen.getByLabelText<HTMLInputElement>("backupAccessKey").placeholder,
		).toBe("");
		expect(
			images.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerificationStale", "uploadVerificationStale"]);
		fetch.mockRestore();
	});

	it("returns the successful save status to idle after a bounded acknowledgement", async () => {
		const user = userEvent.setup();
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: bootstrap().settings,
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);
		try {
			render(<SettingsCenterRoot bootstrap={bootstrap()} />);

			await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
			await user.click(
				screen.getByRole<HTMLButtonElement>("button", {
					name: "saveSettings",
				}),
			);
			await waitFor(() =>
				expect(screen.getByText("settingsSaved")).not.toBeNull(),
			);
			await waitFor(
				() => expect(screen.queryByText("settingsSaved")).toBeNull(),
				{ timeout: 3000 },
			);
			expect(
				screen.getByRole<HTMLButtonElement>("button", {
					name: "saveSettings",
				}).disabled,
			).toBe(true);
		} finally {
			fetch.mockRestore();
		}
	});

	it("offers the latest server state after a save conflict", async () => {
		const user = userEvent.setup();
		const latestSettings = {
			...bootstrap().settings,
			general: { ...bootstrap().settings.general, autoFocusEditor: true },
		};
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementationOnce(async (_input, init) => {
				expect(init?.method).toBe("POST");
				expect(new Headers(init?.headers).get("X-WP-Nonce")).toBe("test-nonce");
				return { ok: false, status: 409 } as Response;
			})
			.mockImplementationOnce(async (_input, init) => {
				expect(init?.method).toBe("GET");
				expect(new Headers(init?.headers).get("X-WP-Nonce")).toBe("test-nonce");
				return {
					ok: true,
					json: async () => ({
						settings: latestSettings,
						credentialStatus: {
							primaryConfigured: true,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
		await user.click(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" }),
		);
		await waitFor(() =>
			expect(screen.getByText("settingsConflict")).not.toBeNull(),
		);

		const reload = screen.getByRole<HTMLButtonElement>("button", {
			name: "reloadSettings",
		});
		expect(reload.disabled).toBe(false);
		await user.click(reload);
		await waitFor(() =>
			expect(
				screen
					.getByRole("switch", { name: "autoFocusEditor" })
					.getAttribute("aria-checked"),
			).toBe("true"),
		);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(
			screen.getByLabelText<HTMLInputElement>("accessKey").placeholder,
		).toBe("••••••••••••");
		fetch.mockRestore();
	});

	it("invalidates both upload verifications after an authoritative conflict reload", async () => {
		const user = userEvent.setup();
		const configuredBootstrap = bootstrap({ configuredImageDomains: true });
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (input, init) => {
				const url = String(input);
				if (url.endsWith("/image-hosting/verification")) {
					const request = JSON.parse(String(init?.body)) as {
						target: "primary" | "backup";
					};
					return {
						ok: true,
						json: async () => ({
							path: "20260824/00000000-0000-4000-8000-000000000000.png",
							status: "uploaded",
							target: request.target,
							url: "https://img.example.test/20260824/00000000-0000-4000-8000-000000000000.png",
						}),
					} as Response;
				}
				if (init?.method === "POST") {
					return { ok: false, status: 409 } as Response;
				}
				return {
					ok: true,
					json: async () => ({
						settings: configuredBootstrap.settings,
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		const { container } = render(
			<SettingsCenterRoot bootstrap={configuredBootstrap} />,
		);
		const imagesSection = container.querySelector(
			'[data-settings-section="images"]',
		);
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("settings-center-images-section-missing");
		const images = within(imagesSection);

		await user.click(
			images.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.click(
			images.getByRole("button", { name: "verifyBackupUpload" }),
		);
		await waitFor(() =>
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerified", "uploadVerified"]),
		);

		await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
		await user.click(screen.getByRole("button", { name: "saveSettings" }));
		await waitFor(() =>
			expect(screen.getByText("settingsConflict")).not.toBeNull(),
		);
		await user.click(screen.getByRole("button", { name: "reloadSettings" }));

		await waitFor(() =>
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerificationStale", "uploadVerificationStale"]),
		);
		fetch.mockRestore();
	});

	it("reports save failures without claiming completion", async () => {
		const user = userEvent.setup();
		const fetch = vi
			.spyOn(window, "fetch")
			.mockRejectedValue(new Error("settings-save-failed"));
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		await user.click(screen.getByRole("switch", { name: "autoFocusEditor" }));
		const save = screen.getByRole<HTMLButtonElement>("button", {
			name: "saveSettings",
		});
		await user.click(save);

		await waitFor(() =>
			expect(screen.getByText("settingsSaveNetworkFailed")).not.toBeNull(),
		);
		expect(screen.queryByText("settingsSaved")).toBeNull();
		expect(save.disabled).toBe(false);
		fetch.mockRestore();
	});
});
