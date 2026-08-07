import { render, screen, waitFor, within } from "@testing-library/react";
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

function bootstrap(): SettingsCenterBootstrap {
	return {
		schemaVersion: 2,
		closeUrl: "/wp-admin/options-general.php?page=easymde",
		api: {
			settingsUrl: "/wp-json/easymde/v1/settings",
			actionNonce: "test-action-nonce",
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
			},
		},
		settings: SETTINGS_CENTER_TEST_SETTINGS,
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

beforeEach(() => {
	const secureWindow = new Proxy(window, {
		get(target, property, receiver) {
			if (property === "location") {
				return new URL("https://example.test/wp-admin/options.php");
			}
			return Reflect.get(target, property, receiver);
		},
	});
	vi.stubGlobal("window", secureWindow);
});

afterEach(() => {
	vi.unstubAllGlobals();
});
describe("SettingsCenterRoot global search", () => {
	it("indexes and opens results from sections beyond General", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
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

	it("marks image settings unavailable while keeping them searchable", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		expect(
			screen
				.getByRole("switch", { name: "enableBackupImageHost" })
				.matches(":disabled"),
		).toBe(true);
		await user.type(
			screen.getByRole("searchbox", { name: "searchSettings" }),
			"backupBucket",
		);
		expect(
			screen
				.getByRole("textbox", { name: "backupBucket" })
				.matches(":disabled"),
		).toBe(true);
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

	it("restores defaults only within the selected shortcut group", async () => {
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
		expect(headingWindows.value).toBe("Ctrl+Shift+1");
	});

	it("restores one shortcut default when its field is cleared", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const windowsSave = screen.getByRole<HTMLInputElement>("textbox", {
			name: "saveArticle windowsLinux",
		});

		await user.clear(windowsSave);
		await user.tab();

		expect(windowsSave.value).toBe("Ctrl+S");
	});

	it("keeps shortcut behavior switches in browser-session state", async () => {
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
		await user.click(hints);
		expect(hints.getAttribute("aria-checked")).toBe("false");
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
			screen.getByRole("heading", { name: "defaultInsertion" }),
		).not.toBeNull();
	});

	it("keeps backup image-host fields visible but unavailable", () => {
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
		).toBe(true);
		expect(backup.matches(":disabled")).toBe(true);
	});

	it("does not expose a fake image-host connection test", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const imagesSection = screen
			.getByRole("heading", { name: "imageHostService" })
			.closest('[data-settings-section="images"]');
		if (!(imagesSection instanceof HTMLElement))
			throw new Error("images-settings-section-missing");
		const images = within(imagesSection);

		expect(images.queryByRole("button", { name: "testConnection" })).toBeNull();
		expect(
			images.queryByRole("button", { name: "testBackupConnection" }),
		).toBeNull();
		expect(images.getByRole("note").textContent).toContain(
			"settingsUnavailable",
		);
	});

	it("keeps filename and upload controls unavailable", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const rule = screen.getByRole<HTMLInputElement>("textbox", {
			name: "fileNameRule",
		});
		const gif = screen.getByRole("checkbox", { name: "allowUploadGif" });

		expect(rule.matches(":disabled")).toBe(true);
		expect(gif.matches(":disabled")).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "fileNamePresetMd5" })
				.matches(":disabled"),
		).toBe(true);
	});
	it("retains stable IDs in unavailable select controls", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const service = screen.getByRole<HTMLSelectElement>("combobox", {
			name: "selectImageHostService",
		});
		const theme = screen.getByRole<HTMLSelectElement>("combobox", {
			name: "editorTheme",
		});

		expect(service.value).toBe("cloudflare-r2");
		expect(theme.value).toBe("system");
		expect(service.matches(":disabled")).toBe(true);
		expect(theme.matches(":disabled")).toBe(true);
	});
});

describe("SettingsCenterRoot Markdown section", () => {
	it("renders every Markdown group after Images in the continuous settings card", () => {
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
			screen.getByRole("heading", { name: "markdownExtensions" }),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "otherSettings" }),
		).not.toBeNull();
	});

	it("keeps Markdown controls unavailable without a runtime owner", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const markdown = document.querySelector(
			'[data-settings-section="markdown"]',
		);
		if (!(markdown instanceof HTMLElement))
			throw new Error("markdown-settings-section-missing");
		const controls = within(markdown);
		const lineNumbers = controls.getByRole("switch", {
			name: "showLineNumbers",
		});
		const theme = controls.getByRole<HTMLSelectElement>("combobox", {
			name: "editorTheme",
		});
		const unorderedMarker = controls.getByRole<HTMLInputElement>("textbox", {
			name: "unorderedListMarker",
		});

		expect(lineNumbers.matches(":disabled")).toBe(true);
		expect(theme.matches(":disabled")).toBe(true);
		expect(unorderedMarker.matches(":disabled")).toBe(true);
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

	it("keeps filename and selected import file in browser-session state", async () => {
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
		const fileInput = transfer.getByLabelText<HTMLInputElement>(
			"transferChooseConfigurationFile",
		);

		await user.clear(fileName);
		await user.type(fileName, "easymde-visual-audit");
		expect(fileName.value).toBe("easymde-visual-audit");

		await user.upload(
			fileInput,
			new File(["{}"], "settings.json", {
				type: "application/json",
			}),
		);
		expect(transfer.getByText("settings.json")).not.toBeNull();
		expect(
			transfer.getByRole("button", { name: "transferConfirmImport" }),
		).not.toBeNull();
		expect(screen.getByRole("status").textContent).toContain(
			"transferFileSelectedNotice settings.json",
		);
	});

	it("exports the current draft and imports a validated configuration into the draft", async () => {
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
		const fileInput = transfer.getByLabelText<HTMLInputElement>(
			"transferChooseConfigurationFile",
		);
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
			expect(within(container).getByRole("status").textContent).toContain(
				"transferExportSuccess",
			);
			const calls = createObjectUrl.mock.calls as ReadonlyArray<
				Readonly<[Blob]>
			>;
			const firstCall = calls[0];
			if (!firstCall) throw new Error("settings-center-export-blob-missing");
			const exported = JSON.parse(await firstCall[0].text()) as {
				schemaVersion: number;
				settings: SettingsCenterSettings;
			};
			expect(exported.schemaVersion).toBe(1);
			expect(exported.settings.general.autoFocusEditor).toBe(true);
			expect(exported.settings.images.accessKey).toBe("");
			expect(exported.settings.images.secretKey).toBe("");
			expect(exported.settings.images.backupAccessKey).toBe("");
			expect(exported.settings.images.backupSecretKey).toBe("");
			expect(click).toHaveBeenCalledOnce();

			const imported = {
				...bootstrap().settings,
				general: { ...bootstrap().settings.general, autoFocusEditor: false },
				images: {
					...bootstrap().settings.images,
					accessKey: "imported-access-key",
					secretKey: "imported-secret-key",
				},
			};
			await user.upload(
				fileInput,
				new File(
					[JSON.stringify({ schemaVersion: 1, settings: imported })],
					"import.json",
					{ type: "application/json" },
				),
			);
			await user.click(
				transfer.getByRole("button", { name: "transferConfirmImport" }),
			);
			await waitFor(() =>
				expect(
					screen
						.getByRole("switch", { name: "autoFocusEditor" })
						.getAttribute("aria-checked"),
				).toBe("false"),
			);
			const imagesSection = container.querySelector(
				'[data-settings-section="images"]',
			);
			if (!(imagesSection instanceof HTMLElement))
				throw new Error("settings-center-images-section-missing");
			expect(
				within(imagesSection).getByLabelText<HTMLInputElement>("accessKey")
					.value,
			).toBe("");
			expect(
				within(imagesSection).getByLabelText<HTMLInputElement>("secretKey")
					.value,
			).toBe("");
			expect(within(container).getByRole("status").textContent).toContain(
				"transferImportApplied",
			);
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
			expect(within(container).getByRole("status").textContent).toContain(
				"transferExportFailed",
			);
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

	it("resets the browser draft to defaults and reports the applied change", async () => {
		const user = userEvent.setup();
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (_input, init) => {
				const payload = JSON.parse(String(init?.body)) as Record<
					string,
					unknown
				>;
				expect(payload.resetSecrets).toBe(true);
				return {
					ok: true,
					json: async () => ({ settings: bootstrap().settings }),
				} as Response;
			});
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		const autoFocus = screen.getByRole("switch", { name: "autoFocusEditor" });
		expect(autoFocus.matches(":disabled")).toBe(false);
		const resetTrigger = screen.getByRole("button", {
			name: /transferResetCurrentConfiguration/,
		});
		await user.click(resetTrigger);
		const dialog = within(overlayRoot).getByRole("dialog", {
			name: "transferResetCurrentConfiguration",
		});
		expect(within(dialog).getByText("transferResetWarning")).not.toBeNull();

		const close = within(dialog).getByRole("button", {
			name: "transferCloseOperationDialog",
		});
		const cancel = within(dialog).getByRole("button", { name: "cancel" });
		const confirm = within(dialog).getByRole("button", {
			name: "transferConfirmReset",
		});
		expect(document.activeElement).toBe(close);
		await user.tab();
		expect(document.activeElement).toBe(cancel);
		await user.tab();
		expect(document.activeElement).toBe(confirm);
		await user.tab();
		expect(document.activeElement).toBe(close);
		await user.keyboard("{Shift>}{Tab}{/Shift}");
		expect(document.activeElement).toBe(confirm);

		await user.click(confirm);
		expect(autoFocus.getAttribute("aria-checked")).toBe("true");
		expect(within(overlayRoot).getByRole("status").textContent).toContain(
			"transferResetApplied",
		);
		await waitFor(() => expect(document.activeElement).toBe(resetTrigger));
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" })
				.disabled,
		).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
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
			within(statusDialog).getByText("transferCheckBootstrap"),
		).not.toBeNull();
		expect(
			within(statusDialog).getByText("transferCheckImageDraftIncomplete"),
		).not.toBeNull();
		expect(
			within(statusDialog).getByText("transferCheckSettingsEndpointConfigured"),
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
	it("enables owner-backed controls while keeping unsupported fields unavailable", () => {
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		expect(
			screen
				.getByRole("switch", { name: "autoFocusEditor" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen.getByRole("combobox", { name: "interfaceLanguage" }).matches(":disabled"),
		).toBe(true);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" })
				.disabled,
		).toBe(true);
	});

	it("changes an owner-backed dropdown and sends the selected value", async () => {
		const user = userEvent.setup();
		const payloadRef = { current: null as Record<string, unknown> | null };
		const fetch = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
			payloadRef.current = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
				}),
			} as Response;
		});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		const select = screen.getByRole<HTMLSelectElement>("combobox", {
			name: "statusBarDisplay",
		});
		await user.selectOptions(select, "hidden");
		expect(select.value).toBe("hidden");
		await user.click(screen.getByRole<HTMLButtonElement>("button", { name: "saveSettings" }));

		await waitFor(() => expect(screen.getByText("settingsSaved")).not.toBeNull());
		if (!payloadRef.current) throw new Error("settings-save-payload-missing");
		const general = payloadRef.current.settings as Record<string, unknown>;
		expect((general.general as Record<string, unknown>).statusBarMode).toBe("hidden");
		fetch.mockRestore();
	});

	it("saves edited owner-backed settings through WordPress and reports completion", async () => {
		const user = userEvent.setup();
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ settings: bootstrap().settings }),
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
					json: async () => ({ settings: latestSettings }),
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
