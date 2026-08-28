import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const pageRenders = vi.hoisted(() => ({
	about: 0,
	general: 0,
	images: 0,
	markdown: 0,
	shortcuts: 0,
	transfer: 0,
}));

vi.mock("./GeneralSettingsPage", async () => {
	const { createElement: createMockElement } = await import("@wordpress/element");
	return {
		GeneralSettingsPage: ({
			onChange,
			settings,
		}: {
			onChange?: (settings: SettingsCenterSettings["general"]) => void;
			settings?: SettingsCenterSettings["general"];
		}) => {
			pageRenders.general += 1;
			if (!settings) throw new Error("settings-center-general-settings-missing");
			return createMockElement(
				"button",
				{
					onClick: () =>
						onChange?.({
							...settings,
							showLineNumbers: !settings.showLineNumbers,
						}),
					type: "button",
				},
				"edit-general",
			);
		},
	};
});

vi.mock("./ShortcutsSettingsPage", async () => {
	const { createElement: createMockElement } = await import("@wordpress/element");
	return {
		ShortcutsSettingsPage: () => {
			pageRenders.shortcuts += 1;
			return createMockElement("div", null, "shortcuts-page");
		},
	};
});

vi.mock("./ImagesSettingsPage", async () => {
	const { createElement: createMockElement } = await import("@wordpress/element");
	return {
		DuplicateImageHostDialog: () => null,
		hasDuplicateImageHostConfiguration: () => false,
		ImagesSettingsPage: () => {
			pageRenders.images += 1;
			return createMockElement("div", null, "images-page");
		},
	};
});

vi.mock("./MarkdownSettingsPage", async () => {
	const { createElement: createMockElement } = await import("@wordpress/element");
	return {
		MarkdownSettingsPage: () => {
			pageRenders.markdown += 1;
			return createMockElement("div", null, "markdown-page");
		},
	};
});

vi.mock("./TransferSettingsPage", async () => {
	const { createElement: createMockElement } = await import("@wordpress/element");
	return {
		TransferSettingsPage: () => {
			pageRenders.transfer += 1;
			return createMockElement("div", null, "transfer-page");
		},
	};
});

vi.mock("./AboutSettingsPage", async () => {
	const { createElement: createMockElement } = await import("@wordpress/element");
	return {
		AboutDialog: () => null,
		AboutSettingsPage: () => {
			pageRenders.about += 1;
			return createMockElement("div", null, "about-page");
		},
	};
});

import { SettingsCenterRoot } from "./SettingsCenterRoot";

function bootstrap(): SettingsCenterBootstrap {
	return {
		schemaVersion: 2,
		closeUrl: "/wp-admin/options-general.php",
		uploadLimits: { systemMaxBytes: 5 * 1024 * 1024 },
		api: {
			settingsUrl: "/wp-json/easymde/v1/settings",
			actionNonce: "test-action-nonce",
			imageHostingVerificationActionNonce: "test-verification-nonce",
			imageHostingVerificationUrl: "/wp-json/easymde/v1/verification",
			imageHostingSecretRevealActionNonce: "test-secret-nonce",
			imageHostingSecretRevealUrl: "/wp-json/easymde/v1/secret",
			nonce: "test-nonce",
		},
		assets: {
			brandMarkUrl: "/brand.png",
			headerIllustrationUrl: "/header.png",
			searchEmptyIllustrationUrl: "/empty.png",
		},
		links: {
			projectUrl: "https://example.test/project",
			documentationUrl: "https://example.test/docs",
			releasesUrl: "https://example.test/releases",
			issuesUrl: "https://example.test/issues",
			licenseUrl: "https://example.test/license",
		},
		drafts: {
			images: {
				domain: "",
				backupDomain: "",
				primaryCredentialsConfigured: false,
				backupCredentialsConfigured: false,
			},
		},
		settings: SETTINGS_CENTER_TEST_SETTINGS,
		defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
		strings: Object.fromEntries(
			SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
		) as SettingsCenterBootstrap["strings"],
	};
}

describe("SettingsCenterRoot save performance boundaries", () => {
	beforeEach(() => {
		Object.keys(pageRenders).forEach((key) => {
			pageRenders[key as keyof typeof pageRenders] = 0;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps unchanged page props stable when reconciling an authoritative save", async () => {
		const fetch = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
			const payload = JSON.parse(String(init?.body)) as {
				settings: SettingsCenterSettings;
			};
			return {
				ok: true,
				json: async () => ({
					settings: {
						...payload.settings,
						revision: payload.settings.revision + 1,
					},
					credentialStatus: {
						primaryConfigured: false,
						backupConfigured: false,
					},
				}),
			} as Response;
		});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);

		fireEvent.click(screen.getByRole("button", { name: "edit-general" }));
		const rendersBeforeSave = { ...pageRenders };
		fireEvent.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() => expect(screen.getByText("settingsSaved")).not.toBeNull());
		expect(pageRenders.general).toBe(rendersBeforeSave.general);
		expect(pageRenders.shortcuts).toBe(rendersBeforeSave.shortcuts);
		expect(pageRenders.markdown).toBe(rendersBeforeSave.markdown);
		expect(pageRenders.about).toBe(rendersBeforeSave.about);
		expect(pageRenders.images).toBe(rendersBeforeSave.images + 1);
		expect(pageRenders.transfer).toBe(rendersBeforeSave.transfer + 1);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("does not rebuild an active search index for transient save UI", async () => {
		vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
			const payload = JSON.parse(String(init?.body)) as {
				settings: SettingsCenterSettings;
			};
			return {
				ok: true,
				json: async () => ({
					settings: {
						...payload.settings,
						revision: payload.settings.revision + 1,
					},
					credentialStatus: {
						primaryConfigured: false,
						backupConfigured: false,
					},
				}),
			} as Response;
		});
		const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		const root = container.querySelector(".easymde-settings-center");
		if (!(root instanceof HTMLDivElement))
			throw new Error("settings-center-root-missing");

		fireEvent.change(screen.getByRole("searchbox", { name: "searchSettings" }), {
			target: { value: "missing-setting" },
		});
		await waitFor(() =>
			expect(screen.getByText("noSearchResults")).not.toBeNull(),
		);
		const querySelectorAll = vi.spyOn(root, "querySelectorAll");
		fireEvent.click(screen.getByRole("button", { name: "edit-general" }));
		fireEvent.click(screen.getByRole("button", { name: "saveSettings" }));

		await waitFor(() => expect(screen.getByText("settingsSaved")).not.toBeNull());
		expect(querySelectorAll).not.toHaveBeenCalled();
	});

	it("dispatches only one protected write for same-task duplicate activation", async () => {
		let resolveResponse: ((response: Response) => void) | undefined;
		const fetch = vi.spyOn(window, "fetch").mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					resolveResponse = resolve;
				}),
		);
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		fireEvent.click(screen.getByRole("button", { name: "edit-general" }));
		const save = screen.getByRole("button", { name: "saveSettings" });

		act(() => {
			save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(fetch).toHaveBeenCalledOnce();
		if (!resolveResponse) throw new Error("settings-save-response-resolver-missing");
		resolveResponse({
			ok: true,
			json: async () => ({
				settings: {
					...SETTINGS_CENTER_TEST_SETTINGS,
					revision: SETTINGS_CENTER_TEST_SETTINGS.revision + 1,
				},
				credentialStatus: {
					primaryConfigured: false,
					backupConfigured: false,
				},
			}),
		} as Response);
		await waitFor(() => expect(screen.getByText("settingsSaved")).not.toBeNull());
	});

	it("releases the synchronous save lock after a rejected request", async () => {
		const fetch = vi
			.spyOn(window, "fetch")
			.mockRejectedValueOnce(new Error("network unavailable"))
			.mockImplementationOnce(async (_input, init) => {
				const payload = JSON.parse(String(init?.body)) as {
					settings: SettingsCenterSettings;
				};
				return {
					ok: true,
					json: async () => ({
						settings: {
							...payload.settings,
							revision: payload.settings.revision + 1,
						},
						credentialStatus: {
							primaryConfigured: false,
							backupConfigured: false,
						},
					}),
				} as Response;
			});
		render(<SettingsCenterRoot bootstrap={bootstrap()} />);
		fireEvent.click(screen.getByRole("button", { name: "edit-general" }));
		const save = screen.getByRole("button", { name: "saveSettings" });

		fireEvent.click(save);
		await waitFor(() =>
			expect(screen.getByText("settingsSaveNetworkFailed")).not.toBeNull(),
		);
		fireEvent.click(save);

		await waitFor(() => expect(screen.getByText("settingsSaved")).not.toBeNull());
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
