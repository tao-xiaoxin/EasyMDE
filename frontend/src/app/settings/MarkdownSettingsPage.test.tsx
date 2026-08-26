import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

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
	it("defaults table alignment to center when no settings are provided", () => {
		render(
			<MarkdownSettingsPage
				applyEditorThemeToFrontend
				onApplyEditorThemeToFrontendChange={() => undefined}
				strings={strings}
			/>,
		);

		expect(
			screen.getByRole("combobox", { name: "tableAlignment" }).textContent,
		).toContain("alignCenter");
	});

	it("saves interactive table alignment and code line number selections", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const settings = {
			...SETTINGS_CENTER_TEST_SETTINGS.markdown,
			tableAlignment: "center",
		};
		render(
			<MarkdownSettingsPage
				applyEditorThemeToFrontend
				onApplyEditorThemeToFrontendChange={() => undefined}
				onChange={onChange}
				settings={settings}
				strings={strings}
			/>,
		);
		const tableAlignment = screen.getByRole("combobox", {
			name: "tableAlignment",
		});
		const codeLineNumbers = screen.getByRole("combobox", {
			name: "codeBlockLineNumbers",
		});

		expect(tableAlignment.matches(":disabled")).toBe(false);
		expect(codeLineNumbers.matches(":disabled")).toBe(false);
		await user.click(tableAlignment);
		await user.click(screen.getByRole("option", { name: "alignLeft" }));
		expect(onChange).toHaveBeenLastCalledWith({
			...settings,
			tableAlignment: "left",
		});
		await user.click(codeLineNumbers);
		await user.click(screen.getByRole("option", { name: "hide" }));
		expect(onChange).toHaveBeenLastCalledWith({
			...settings,
			codeLineNumbers: "hide",
		});
	});

	it("places the published theme rendering toggle in the former editor theme row", async () => {
		const user = userEvent.setup();
		const onThemeRenderingChange = vi.fn();
		render(
			<MarkdownSettingsPage
				applyEditorThemeToFrontend
				onApplyEditorThemeToFrontendChange={onThemeRenderingChange}
				settings={SETTINGS_CENTER_TEST_SETTINGS.markdown}
				strings={strings}
			/>,
		);
		const editorSection = screen
			.getByRole("heading", { name: "markdownEditorSettings" })
			.closest("section");
		if (!editorSection) throw new Error("markdown-editor-section-missing");
		const controls = within(editorSection as HTMLElement);
		const toggle = controls.getByRole("switch", {
			name: "applyEditorThemeToFrontend",
		});
		const labels = Array.from(
			editorSection.querySelectorAll("[data-setting-label]"),
			(row) => row.getAttribute("data-setting-label"),
		);

		expect(labels).toEqual(["wordWrap", "applyEditorThemeToFrontend"]);
		expect(
			controls.queryByRole("combobox", { name: "editorTheme" }),
		).toBeNull();
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		await user.click(toggle);
		expect(onThemeRenderingChange).toHaveBeenCalledWith(false);
	});

	it("places paste conversion in Markdown parsing and rendering without an Other section", () => {
		render(
			<MarkdownSettingsPage
				applyEditorThemeToFrontend
				onApplyEditorThemeToFrontendChange={() => undefined}
				settings={SETTINGS_CENTER_TEST_SETTINGS.markdown}
				strings={strings}
			/>,
		);
		const parsingSection = screen
			.getByRole("heading", { name: "markdownParsingRendering" })
			.closest("section");

		expect(parsingSection).not.toBeNull();
		expect(
			within(parsingSection as HTMLElement).getByRole("switch", {
				name: "pasteAsMarkdown",
			}),
		).not.toBeNull();
		expect(screen.queryByRole("heading", { name: "otherSettings" })).toBeNull();
	});

	it("does not render removed Markdown formatting preferences", () => {
		render(
			<MarkdownSettingsPage
				applyEditorThemeToFrontend
				onApplyEditorThemeToFrontendChange={() => undefined}
				settings={SETTINGS_CENTER_TEST_SETTINGS.markdown}
				strings={strings}
			/>,
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
			<MarkdownSettingsPage
				applyEditorThemeToFrontend
				onApplyEditorThemeToFrontendChange={() => undefined}
				settings={SETTINGS_CENTER_TEST_SETTINGS.markdown}
				strings={strings}
			/>,
		);

		expect(
			screen.queryByRole("switch", { name: "showLineNumbers" }),
		).toBeNull();
		expect(screen.queryByRole("switch", { name: "htmlRendering" })).toBeNull();
		for (const name of [
			"githubFlavor",
			"smartPunctuation",
			"pasteAsMarkdown",
		]) {
			expect(screen.getByRole("switch", { name }).matches(":disabled")).toBe(
				true,
			);
		}
	});
});
