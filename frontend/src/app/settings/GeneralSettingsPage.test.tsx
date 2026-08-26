import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../test/settings-center-settings-fixture";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

const strings = Object.fromEntries(
	SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
) as unknown as SettingsCenterBootstrap["strings"];

describe("GeneralSettingsPage", () => {
	it("does not duplicate the theme rendering preference moved to Markdown settings", () => {
		render(
			<GeneralSettingsPage
				query=""
				searchEmptyIllustrationUrl="/plugin/search-empty.png"
				settings={SETTINGS_CENTER_TEST_SETTINGS.general}
				strings={strings}
			/>,
		);

		expect(
			screen.queryByRole("switch", {
				name: "applyEditorThemeToFrontend",
			}),
		).toBeNull();
	});

	it("shows the published code copy button enabled by default and reports changes", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const settings = {
			...SETTINGS_CENTER_TEST_SETTINGS.general,
			showPublishedCodeCopyButton: true,
		};
		render(
			<GeneralSettingsPage
				onChange={onChange}
				query=""
				searchEmptyIllustrationUrl="/plugin/search-empty.png"
				settings={settings}
				strings={strings}
			/>,
		);
		const toggle = screen.getByRole("switch", {
			name: "showPublishedCodeCopyButton",
		});

		expect(toggle.getAttribute("aria-checked")).toBe("true");
		await user.click(toggle);
		expect(onChange).toHaveBeenLastCalledWith({
			...settings,
			showPublishedCodeCopyButton: false,
		});
	});

	it("offers every summary sync method and reports the selected setting", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<GeneralSettingsPage
				onChange={onChange}
				query=""
				searchEmptyIllustrationUrl="/plugin/search-empty.png"
				settings={SETTINGS_CENTER_TEST_SETTINGS.general}
				strings={strings}
			/>,
		);
		const select = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "summaryMode",
		});

		expect(select.matches(":disabled")).toBe(false);
		await user.click(select);
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["summary55", "summary100", "manualSummary"]);
		await user.click(screen.getByRole("option", { name: "manualSummary" }));
		expect(onChange).toHaveBeenLastCalledWith({
			...SETTINGS_CENTER_TEST_SETTINGS.general,
			summaryMode: "manual",
		});
	});

	it("places status-bar display immediately after the default editing mode", () => {
		render(
			<GeneralSettingsPage
				query=""
				searchEmptyIllustrationUrl="/plugin/search-empty.png"
				settings={SETTINGS_CENTER_TEST_SETTINGS.general}
				strings={strings}
			/>,
		);

		const heading = screen.getByRole("heading", { name: "basePreferences" });
		const section = heading.closest("section");
		if (!section) throw new Error("general-base-preferences-section-missing");
		const labels = Array.from(
			section.querySelectorAll("[data-setting-label]"),
			(row) => row.getAttribute("data-setting-label"),
		);

		expect(labels.slice(0, 2)).toEqual([
			"defaultEditingMode",
			"statusBarDisplay",
		]);
	});

	it("does not expose editor capabilities or WordPress category ownership as settings", () => {
		render(
			<GeneralSettingsPage
				query=""
				searchEmptyIllustrationUrl="/plugin/search-empty.png"
				settings={SETTINGS_CENTER_TEST_SETTINGS.general}
				strings={strings}
			/>,
		);

		expect(
			screen.queryByRole("switch", { name: "cleanPastedContent" }),
		).toBeNull();
		expect(
			screen.queryByRole("switch", { name: "smartListRecognition" }),
		).toBeNull();
		expect(
			screen.queryByRole("combobox", { name: "defaultCategory" }),
		).toBeNull();
		expect(
			screen.queryByRole("switch", { name: "featuredImagePlaceholder" }),
		).toBeNull();
	});
});
