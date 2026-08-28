import { describe, expect, it } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../test/settings-center-settings-fixture";
import { findShortcutConflicts } from "./ShortcutsSettingsPage";

const strings = Object.fromEntries(
	SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
) as SettingsCenterBootstrap["strings"];

describe("findShortcutConflicts", () => {
	it("ignores conflicts between reserved-only bindings", () => {
		const reservedShortcuts: SettingsCenterBootstrap["reservedShortcuts"] = [
			{
				id: "reserved-first",
				label: "Reserved first",
				windows: "Ctrl+Alt+8",
				mac: "Cmd+Option+8",
			},
			{
				id: "reserved-second",
				label: "Reserved second",
				windows: "Ctrl+Alt+8",
				mac: "Cmd+Option+8",
			},
		];

		expect(
			findShortcutConflicts(
				SETTINGS_CENTER_TEST_SETTINGS.shortcuts.values,
				reservedShortcuts,
				strings,
			),
		).toEqual([]);
	});

	it("keeps editable-reserved and editable-editable conflicts", () => {
		const values = {
			...SETTINGS_CENTER_TEST_SETTINGS.shortcuts.values,
			bold: { windows: "Ctrl+Alt+9", mac: "Cmd+Option+9" },
			italic: { windows: "Ctrl+Alt+9", mac: "Cmd+Option+9" },
		};
		const reservedShortcuts: SettingsCenterBootstrap["reservedShortcuts"] = [
			{
				id: "reserved-command",
				label: "Reserved command",
				windows: "Ctrl+Alt+9",
				mac: "Cmd+Option+9",
			},
		];

		const conflicts = findShortcutConflicts(values, reservedShortcuts, strings);

		expect(conflicts).toHaveLength(2);
		for (const conflict of conflicts) {
			expect(conflict.bindings.map((binding) => binding.label)).toEqual(
				expect.arrayContaining(["bold", "italic", "Reserved command"]),
			);
			expect(conflict.bindings.some((binding) => binding.editable)).toBe(true);
		}
	});
});
