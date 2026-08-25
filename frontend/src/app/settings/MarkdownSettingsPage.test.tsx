import { render, screen, within } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { describe, expect, it } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../test/settings-center-settings-fixture";
import { MarkdownSettingsPage } from "./MarkdownSettingsPage";

const strings = Object.fromEntries(
	SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
) as unknown as SettingsCenterBootstrap["strings"];

describe("MarkdownSettingsPage", () => {
	it("places paste conversion in Markdown parsing and rendering without an Other section", () => {
		render(
			<MarkdownSettingsPage settings={SETTINGS_CENTER_TEST_SETTINGS.markdown} strings={strings} />,
		);
		const parsingSection = screen
			.getByRole("heading", { name: "markdownParsingRendering" })
			.closest("section");

		expect(parsingSection).not.toBeNull();
		expect(
			within(parsingSection as HTMLElement).getByRole("switch", { name: "pasteAsMarkdown" }),
		).not.toBeNull();
		expect(screen.queryByRole("heading", { name: "otherSettings" })).toBeNull();
	});

	it("does not render removed Markdown formatting preferences", () => {
		render(
			<MarkdownSettingsPage settings={SETTINGS_CENTER_TEST_SETTINGS.markdown} strings={strings} />,
		);
		for (const label of [
			"defaultLineEnding",
			"unorderedListMarker",
			"orderedListStart",
			"blockquoteIndentStyle",
		]) {
			expect(screen.queryByLabelText(label)).toBeNull();
			expect(screen.queryByText(label)).toBeNull();
		}
	});

	it("does not duplicate the editor-owned line number setting", () => {
		render(
			<MarkdownSettingsPage settings={SETTINGS_CENTER_TEST_SETTINGS.markdown} strings={strings} />,
		);

		expect(screen.queryByRole("switch", { name: "showLineNumbers" })).toBeNull();
	});
});
