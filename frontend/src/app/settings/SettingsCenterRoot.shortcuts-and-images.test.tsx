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
import { SettingsCenterRoot } from "./SettingsCenterRoot";
import {
	bootstrap,
	installSettingsCenterLocationLifecycle,
} from "./settings-center-root.test-harness";

installSettingsCenterLocationLifecycle();

describe("SettingsCenterRoot shortcuts section", () => {
	it("renders all 19 commands in three groups without shortcut behavior switches", () => {
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
			screen.getByRole("heading", { name: "codeAndFormula" }),
		).not.toBeNull();
		expect(
			screen.getAllByRole("button", { name: /^Record .* shortcut:/ }),
		).toHaveLength(38);
		expect(
			screen.queryByRole("switch", { name: "showShortcutHints" }),
		).toBeNull();
	});

	it("records a real keyboard chord and persists canonical code tokens", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const recorder = screen.getByRole("button", {
			name: "Record insertLink windowsLinux shortcut: Ctrl+K",
		});

		await user.click(recorder);
		expect(recorder.textContent).toContain("shortcutRecording");
		fireEvent.keyDown(recorder, {
			key: "[",
			code: "BracketLeft",
			ctrlKey: true,
			shiftKey: true,
		});
		expect(recorder.textContent).toContain("[");
		expect(recorder.textContent).not.toContain("shortcutRecording");
		expect(recorder.ownerDocument.activeElement).toBe(recorder);
	});

	it("ignores composition and modifier-only events while recording", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const recorder = screen.getByRole("button", {
			name: "Record italic windowsLinux shortcut: Ctrl+I",
		});

		await user.click(recorder);
		fireEvent.keyDown(recorder, {
			key: "Control",
			code: "ControlLeft",
			ctrlKey: true,
		});
		fireEvent.keyDown(recorder, {
			key: "Process",
			code: "KeyI",
			ctrlKey: true,
			isComposing: true,
			keyCode: 229,
		});
		expect(recorder.textContent).toBe("shortcutRecording");
		expect(recorder.getAttribute("aria-invalid")).toBeNull();
		fireEvent.keyDown(recorder, { key: "i", code: "KeyI" });
		expect(recorder.getAttribute("aria-invalid")).toBe("true");
		fireEvent.keyDown(recorder, { key: "Escape", code: "Escape" });
		expect(recorder.textContent).toContain("Ctrl");
		expect(recorder.getAttribute("aria-invalid")).toBeNull();
	});

	it("keeps a cleared shortcut disabled until the single reset command is used", async () => {
		const user = userEvent.setup();
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const recorder = screen.getByRole("button", {
			name: "Record saveArticle windowsLinux shortcut: Ctrl+S",
		});
		await user.click(
			screen.getByRole("button", {
				name: "Clear saveArticle windowsLinux shortcut",
			}),
		);
		expect(recorder.textContent).toBe("shortcutDisabled");
		await user.tab();
		expect(recorder.textContent).toBe("shortcutDisabled");

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
		expect(recorder.textContent).toContain("Ctrl");
		expect(recorder.textContent).toContain("S");
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

	it("marks conflicts inline and opens an alert dialog instead of saving", async () => {
		const user = userEvent.setup();
		const fetch = vi.spyOn(window, "fetch");
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const { unmount } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} overlayRoot={overlayRoot} />,
		);
		const bold = screen.getByRole("button", {
			name: "Record bold windowsLinux shortcut: Ctrl+B",
		});
		await user.click(bold);
		fireEvent.keyDown(bold, { key: "s", code: "KeyS", ctrlKey: true });
		expect(bold.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getAllByText("Conflicts with saveArticle.")).toHaveLength(1);

		const save = screen.getByRole("button", { name: "saveSettings" });
		await user.click(save);
		expect(fetch).not.toHaveBeenCalled();
		const dialog = within(overlayRoot).getByRole("alertdialog", {
			name: "shortcutConflictTitle",
		});
		expect(within(dialog).getByText("saveArticle, bold")).not.toBeNull();
		expect(within(dialog).getByText("Ctrl")).not.toBeNull();
		await user.click(
			within(dialog).getByRole("button", {
				name: "returnToShortcutSettings",
			}),
		);
		await waitFor(() => expect(save.ownerDocument.activeElement).toBe(save));
		fetch.mockRestore();
		unmount();
		overlayRoot.remove();
	});

	it("marks a conflict with a read-only registry command", () => {
		const value: SettingsCenterBootstrap = {
			...bootstrap(),
			reservedShortcuts: [
				{
					id: "copywechat",
					label: "Copy to WeChat",
					windows: "Ctrl+B",
					mac: "",
				},
			],
		};
		render(<SettingsCenterRoot bootstrap={value} />);

		const bold = screen.getByRole("button", {
			name: "Record bold windowsLinux shortcut: Ctrl+B",
		});
		expect(bold.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByText("Conflicts with Copy to WeChat.")).not.toBeNull();
	});

	it("opens the same alert dialog for a server-rejected shortcut conflict", async () => {
		const user = userEvent.setup();
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const fetch = vi.spyOn(window, "fetch").mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({
				code: "easymde_settings_shortcut_conflict",
				data: {
					bindings: [
						{ editable: true, id: "bold", label: "Server Bold" },
						{ editable: false, id: "extension", label: "Extension command" },
					],
					platform: "windows",
					shortcut: "Ctrl+B",
				},
			}),
		} as Response);
		const { unmount } = render(
			<SettingsCenterRoot bootstrap={bootstrap()} overlayRoot={overlayRoot} />,
		);
		await user.click(
			screen.getByRole("button", {
				name: "Clear italic windowsLinux shortcut",
			}),
		);
		const save = screen.getByRole("button", { name: "saveSettings" });
		await user.click(save);

		const dialog = await within(overlayRoot).findByRole("alertdialog", {
			name: "shortcutConflictTitle",
		});
		expect(within(dialog).getByText("windowsLinux")).not.toBeNull();
		expect(within(dialog).getByText("Ctrl")).not.toBeNull();
		expect(within(dialog).getByText("B")).not.toBeNull();
		expect(
			within(dialog).getByText("Server Bold, Extension command"),
		).not.toBeNull();
		expect(screen.getByText("settingsSaveRejected")).not.toBeNull();
		expect(fetch).toHaveBeenCalledOnce();
		await user.click(
			within(dialog).getByRole("button", {
				name: "returnToShortcutSettings",
			}),
		);
		await waitFor(() => expect(save.ownerDocument.activeElement).toBe(save));
		fetch.mockRestore();
		unmount();
		overlayRoot.remove();
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

	it("marks image-hosting changes dirty and saves the strict boolean", async () => {
		const user = userEvent.setup();
		const savedPayload = { current: null as Record<string, unknown> | null };
		const initialSettings = bootstrap().settings;
		const savedSettings = {
			...initialSettings,
			revision: initialSettings.revision + 1,
			images: {
				...initialSettings.images,
				imageHostingEnabled: true,
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

		render(
			<SettingsCenterRoot
				bootstrap={bootstrap({ imageHostingEnabled: false })}
			/>,
		);
		const toggle = screen.getByRole("switch", { name: "enableImageHosting" });
		const save = screen.getByRole<HTMLButtonElement>("button", {
			name: "saveSettings",
		});

		expect(toggle.getAttribute("aria-checked")).toBe("false");
		await user.click(toggle);
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(save.disabled).toBe(false);
		expect(screen.getByText("settingsUnsavedChanges")).not.toBeNull();

		await user.click(save);
		await waitFor(() =>
			expect(screen.getByText("settingsSaved")).not.toBeNull(),
		);
		if (!savedPayload.current) throw new Error("settings-save-payload-missing");
		expect(
			(savedPayload.current.settings as SettingsCenterSettings).images
				.imageHostingEnabled,
		).toBe(true);
		fetch.mockRestore();
	});

	it("edits the disabled filename rule without requests and saves false with the rule", async () => {
		const user = userEvent.setup();
		const initialBootstrap = bootstrap({ imageHostingEnabled: false });
		const editedStoragePath = "disabled/{date}";
		const editedFileNameRule = "{uuid}";
		const savedPayload = { current: null as Record<string, unknown> | null };
		const savedSettings = {
			...initialBootstrap.settings,
			revision: initialBootstrap.settings.revision + 1,
			images: {
				...initialBootstrap.settings.images,
				imageHostingEnabled: false,
				storagePath: editedStoragePath,
				fileNameRule: editedFileNameRule,
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

		try {
			render(<SettingsCenterRoot bootstrap={initialBootstrap} />);
			const storagePath = screen.getByRole<HTMLInputElement>("textbox", {
				name: "storagePath",
			});
			const rule = screen.getByRole<HTMLInputElement>("textbox", {
				name: "fileNameRule",
			});
			fireEvent.change(storagePath, { target: { value: editedStoragePath } });
			fireEvent.change(rule, { target: { value: editedFileNameRule } });
			expect(fetch).not.toHaveBeenCalled();

			const toggle = screen.getByRole("switch", {
				name: "enableImageHosting",
			});
			await user.click(toggle);
			await user.click(toggle);
			expect(toggle.getAttribute("aria-checked")).toBe("false");
			expect(rule.value).toBe(editedFileNameRule);
			expect(storagePath.value).toBe(editedStoragePath);
			expect(fetch).not.toHaveBeenCalled();

			const save = screen.getByRole<HTMLButtonElement>("button", {
				name: "saveSettings",
			});
			expect(save.disabled).toBe(false);
			await user.click(save);
			await waitFor(() =>
				expect(screen.getByText("settingsSaved")).not.toBeNull(),
			);
			if (!savedPayload.current)
				throw new Error("settings-save-payload-missing");
			const payloadSettings = savedPayload.current
				.settings as SettingsCenterSettings;
			expect(payloadSettings.images.imageHostingEnabled).toBe(false);
			expect(payloadSettings.images.fileNameRule).toBe(editedFileNameRule);
		} finally {
			fetch.mockRestore();
		}
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

		expect(service.textContent).toContain("cloudflareR2");
		expect(service.matches(":disabled")).toBe(false);
		expect(screen.queryByRole("combobox", { name: "editorTheme" })).toBeNull();
	});
});
