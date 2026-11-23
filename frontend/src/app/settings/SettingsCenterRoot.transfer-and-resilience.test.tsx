import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import type { SettingsCenterSettings } from "../../contracts/settings-center-settings";
import {
	SETTINGS_CENTER_DEFAULT_SETTINGS,
	SETTINGS_CENTER_TEST_SETTINGS,
} from "../../test/settings-center-settings-fixture";
import { SettingsCenterRoot } from "./SettingsCenterRoot";
import {
	bootstrap,
	installSettingsCenterLocationLifecycle,
} from "./settings-center-root.test-harness";

installSettingsCenterLocationLifecycle();

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
			general: bootstrap().settings.general,
			images: {
				...bootstrap().settings.images,
				titleDisplay: "filename",
			},
		};
		const legacySettings = structuredClone(importedSettings) as unknown as {
			general: Record<string, unknown>;
			images: Record<string, unknown>;
			markdown: Record<string, unknown>;
		};
		legacySettings.general.autoFocusEditor = true;
		delete legacySettings.general.applyEditorThemeToFrontend;
		delete legacySettings.general.showPublishedCodeCopyButton;
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
			editorTheme: "system",
			htmlRendering: false,
			lineNumbers: false,
			lineEnding: "crlf",
			unorderedMarker: "*",
			orderedStart: "3",
			blockquoteStyle: "spaced",
		});
		legacySettings.general.featuredImagePlaceholder = true;
		legacySettings.general.statusBarMode = "words-reading-time";
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
		expect(body.settings.general).not.toHaveProperty("autoFocusEditor");
		expect(body.settings.general.applyEditorThemeToFrontend).toBe(true);
		expect(body.settings.general.showPublishedCodeCopyButton).toBe(true);
		expect(body.settings.general.statusBarMode).toBe("detailed");
		expect(body.settings.images.maxImageSizeMb).toBe(5);
		expect(body.settings.images.titleDisplay).toBe("filename");
		expect(body.settings.images).not.toHaveProperty("insertFormat");
		expect(body.settings.markdown).not.toHaveProperty("lineNumbers");
		expect(body.settings.markdown).not.toHaveProperty("editorTheme");
		expect(body.settings.markdown).not.toHaveProperty("htmlRendering");
		expect(body.settings.general).not.toHaveProperty(
			"featuredImagePlaceholder",
		);
		fetch.mockRestore();
	});

	it("drops the removed line number field from schema 2 imports", async () => {
		const user = userEvent.setup();
		const legacySettings = structuredClone(bootstrap().settings) as unknown as {
			general: Record<string, unknown>;
			markdown: Record<string, unknown>;
		};
		legacySettings.general.autoFocusEditor = true;
		delete legacySettings.general.applyEditorThemeToFrontend;
		delete legacySettings.general.showPublishedCodeCopyButton;
		legacySettings.markdown.lineNumbers = false;
		legacySettings.markdown.editorTheme = "system";
		legacySettings.markdown.htmlRendering = false;
		legacySettings.general.featuredImagePlaceholder = true;
		legacySettings.general.statusBarMode = "words";
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
		expect(body.settings.markdown).not.toHaveProperty("editorTheme");
		expect(body.settings.markdown).not.toHaveProperty("htmlRendering");
		expect(body.settings.general).not.toHaveProperty(
			"featuredImagePlaceholder",
		);
		expect(body.settings.general.applyEditorThemeToFrontend).toBe(true);
		expect(body.settings.general.showPublishedCodeCopyButton).toBe(true);
		expect(body.settings.general.statusBarMode).toBe("compact");
		fetch.mockRestore();
	});

	it.each([3, 4, 5, 6, 7])(
		"imports schema %s configurations while removing the retired editor theme",
		async (schemaVersion) => {
			const user = userEvent.setup();
			const legacySettings = structuredClone(
				bootstrap().settings,
			) as unknown as {
				general: Record<string, unknown>;
				markdown: Record<string, unknown>;
			};
			legacySettings.general.autoFocusEditor = true;
			legacySettings.general.statusBarMode = "words";
			legacySettings.markdown.editorTheme = "system";
			legacySettings.markdown.htmlRendering = false;
			legacySettings.general.featuredImagePlaceholder = true;
			if (schemaVersion === 3) {
				delete legacySettings.general.applyEditorThemeToFrontend;
				delete legacySettings.general.showPublishedCodeCopyButton;
			}
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
					[JSON.stringify({ schemaVersion, settings: legacySettings })],
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
			expect(body.settings.general).not.toHaveProperty("autoFocusEditor");
			expect(body.settings.general.applyEditorThemeToFrontend).toBe(true);
			expect(body.settings.general.showPublishedCodeCopyButton).toBe(true);
			expect(body.settings.general.statusBarMode).toBe("compact");
			expect(body.settings.markdown).not.toHaveProperty("editorTheme");
			expect(body.settings.markdown).not.toHaveProperty("htmlRendering");
			expect(body.settings.general).not.toHaveProperty(
				"featuredImagePlaceholder",
			);
			fetch.mockRestore();
		},
	);

	it("rejects a schema 8 payload with retired fields and status modes", async () => {
		const user = userEvent.setup();
		const settings = structuredClone(bootstrap().settings) as unknown as {
			markdown: Record<string, unknown>;
		};
		settings.markdown.editorTheme = "system";
		settings.markdown.htmlRendering = false;
		const general = (
			settings as unknown as {
				general: Record<string, unknown>;
			}
		).general;
		general.featuredImagePlaceholder = true;
		general.autoFocusEditor = true;
		general.statusBarMode = "words-reading-time";
		const fetch = vi.spyOn(window, "fetch");
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const transferSection = container.querySelector(
			'[data-settings-section="transfer"]',
		);
		if (!(transferSection instanceof HTMLElement))
			throw new Error("settings-center-transfer-section-missing");
		const transfer = within(transferSection);

		await user.upload(
			transfer.getByLabelText<HTMLInputElement>(
				"transferChooseConfigurationFile",
			),
			new File(
				[JSON.stringify({ schemaVersion: 8, settings })],
				"settings.json",
				{ type: "application/json" },
			),
		);
		await user.click(
			transfer.getByRole("button", { name: "transferConfirmImport" }),
		);

		expect(screen.getByText("transferImportInvalid")).not.toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		fetch.mockRestore();
	});

	it("imports the schema 9 five-second auto-save interval", async () => {
		const user = userEvent.setup();
		const currentSettings = bootstrap().settings;
		const settings = structuredClone(currentSettings) as unknown as {
			images: Record<string, unknown>;
			general: SettingsCenterSettings["general"];
			revision: number;
		};
		delete settings.images.wechatPngExportEnabled;
		settings.general = {
			...currentSettings.general,
			autoSaveInterval: "5",
		};
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				settings: {
					...currentSettings,
					general: settings.general,
					revision: settings.revision + 1,
				},
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

		await user.upload(
			transfer.getByLabelText<HTMLInputElement>(
				"transferChooseConfigurationFile",
			),
			new File(
				[JSON.stringify({ schemaVersion: 9, settings })],
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
		expect(body.settings.general.autoSaveInterval).toBe("5");
		expect(body.settings.images.wechatPngExportEnabled).toBe(false);
		fetch.mockRestore();
	});

	it("rejects schema 10 imports with a missing or non-boolean PNG conversion flag", async () => {
		const user = userEvent.setup();
		const fetch = vi.spyOn(window, "fetch");
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const transferSection = container.querySelector(
			'[data-settings-section="transfer"]',
		);
		if (!(transferSection instanceof HTMLElement))
			throw new Error("settings-center-transfer-section-missing");
		const transfer = within(transferSection);

		for (const value of [undefined, "false", 0, null]) {
			const settings = structuredClone(bootstrap().settings) as unknown as {
				images: Record<string, unknown>;
			};
			if (value === undefined) {
				delete settings.images.wechatPngExportEnabled;
			} else {
				settings.images.wechatPngExportEnabled = value;
			}
			await user.upload(
				transfer.getByLabelText<HTMLInputElement>(
					"transferChooseConfigurationFile",
				),
				new File(
					[JSON.stringify({ schemaVersion: 10, settings })],
					"settings.json",
					{ type: "application/json" },
				),
			);
			await user.click(
				transfer.getByRole("button", { name: "transferConfirmImport" }),
			);
			expect(screen.getByText("transferImportInvalid")).not.toBeNull();
		}
		expect(fetch).not.toHaveBeenCalled();
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
		expect(exported.schemaVersion).toBe(12);
			expect(exported.settings.images.wechatPngExportEnabled).toBe(false);
			expect(exported.settings.general).not.toHaveProperty("autoFocusEditor");
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

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
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
			screen.queryByRole("switch", { name: "autoFocusEditor" }),
		).toBeNull();
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
		const fetch = vi
			.spyOn(window, "fetch")
			.mockImplementation(async (_input, init) => {
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

		await waitFor(() =>
			expect(screen.getByText("settingsSaved")).not.toBeNull(),
		);
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

	it("does not announce save success before WordPress completes the mutation", async () => {
		const user = userEvent.setup();
		const responseControl = {
			resolve: null as ((response: Response) => void) | null,
		};
		const fetch = vi.spyOn(window, "fetch").mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					responseControl.resolve = resolve;
				}),
		);
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
		const save = screen.getByRole<HTMLButtonElement>("button", {
			name: "saveSettings",
		});
		await user.click(save);

		expect(save.getAttribute("aria-busy")).toBe("true");
		expect(within(overlayRoot).queryByRole("status")).toBeNull();
		const resolveResponse = responseControl.resolve;
		if (!resolveResponse)
			throw new Error("settings-save-response-resolver-missing");
		resolveResponse({
			ok: true,
			json: async () => ({
				settings: bootstrap().settings,
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);

		expect(await within(overlayRoot).findByRole("status")).not.toBeNull();
		expect(fetch).toHaveBeenCalledOnce();
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
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
		const save = screen.getByRole<HTMLButtonElement>("button", {
			name: "saveSettings",
		});
		expect(save.disabled).toBe(false);
		await user.click(save);

		const feedback = await within(overlayRoot).findByRole("status");
		expect(within(feedback).getByText("settingsSaved")).not.toBeNull();
		expect(document.activeElement).toBe(save);
		await user.click(
			within(feedback).getByRole("button", {
				name: "closeSettingsFeedback",
			}),
		);
		await waitFor(() =>
			expect(within(overlayRoot).queryByRole("status")).toBeNull(),
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
						...configuredBootstrap.settings.images,
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

	it("does not revive a pre-save verification after the storage path is saved and then restored in the draft", async () => {
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
								storagePath: "changed",
							fileNameRule: "{md5}",
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

		const storagePath = images.getByRole<HTMLInputElement>("textbox", {
			name: "storagePath",
		});
		await user.clear(storagePath);
		await user.type(storagePath, "changed");

		await user.click(screen.getByRole("button", { name: "saveSettings" }));
		await waitFor(() =>
			expect(
				container
					.querySelector("[data-save-status]")
					?.getAttribute("data-save-status"),
			).toBe("saved"),
		);
		await user.clear(storagePath);
		await user.type(
			storagePath,
			SETTINGS_CENTER_TEST_SETTINGS.images.storagePath,
		);

		expect(
			images.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerificationStale", "uploadVerificationStale"]);
		fetch.mockRestore();
	});

	it("does not revive either verification after upload formats are saved and then restored", async () => {
		const user = userEvent.setup();
		const configuredBootstrap = bootstrap({ configuredImageDomains: true });
		const savedUploadFormats = {
			...configuredBootstrap.settings.images.uploadFormats,
			webp: false,
		};
		const savedSettings = {
			...configuredBootstrap.settings,
			revision: configuredBootstrap.settings.revision + 1,
			images: {
				...configuredBootstrap.settings.images,
				uploadFormats: savedUploadFormats,
			},
		};
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
						settings: savedSettings,
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		try {
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

			const webp = images.getByRole<HTMLInputElement>("checkbox", {
				name: "allowUploadWebp",
			});
			await user.click(webp);
			await user.click(screen.getByRole("button", { name: "saveSettings" }));
			await waitFor(() =>
				expect(
					container
						.querySelector("[data-save-status]")
						?.getAttribute("data-save-status"),
				).toBe("saved"),
			);

			await user.click(webp);
			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerificationStale", "uploadVerificationStale"]);
		} finally {
			fetch.mockRestore();
		}
	});

	it("does not invalidate verified uploads for an equal-value new upload format map", async () => {
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
						settings: configuredBootstrap.settings,
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		try {
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

			const webp = images.getByRole<HTMLInputElement>("checkbox", {
				name: "allowUploadWebp",
			});
			await user.click(webp);
			await user.click(webp);
			await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
			await user.click(screen.getByRole("button", { name: "saveSettings" }));
			await waitFor(() =>
				expect(
					container
						.querySelector("[data-save-status]")
						?.getAttribute("data-save-status"),
				).toBe("saved"),
			);

			expect(
				images.getAllByRole("status").map((status) => status.textContent),
			).toEqual(["uploadVerified", "uploadVerified"]);
		} finally {
			fetch.mockRestore();
		}
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

			await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
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
			general: { ...bootstrap().settings.general, showLineNumbers: true },
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

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
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
					.getByRole("switch", { name: "showLineNumbers" })
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

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
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
		const { container } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} />,
		);
		const overlayRoot = container.querySelector("[data-settings-overlay-root]");
		if (!(overlayRoot instanceof HTMLElement))
			throw new Error("settings-center-overlay-missing");

		await user.click(screen.getByRole("switch", { name: "showLineNumbers" }));
		const save = screen.getByRole<HTMLButtonElement>("button", {
			name: "saveSettings",
		});
		await user.click(save);

		const feedback = await within(overlayRoot).findByRole("alert");
		expect(
			within(feedback).getByText("settingsSaveNetworkFailed"),
		).not.toBeNull();
		expect(document.activeElement).toBe(save);
		expect(screen.queryByText("settingsSaved")).toBeNull();
		expect(save.disabled).toBe(false);
		fetch.mockRestore();
	});
});
