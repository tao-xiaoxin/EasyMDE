import { render, screen } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { describe, expect, it } from "vitest";

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
});
