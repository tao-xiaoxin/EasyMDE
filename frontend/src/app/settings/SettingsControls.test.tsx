import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";
import { SettingsSelect } from "./SettingsControls";

const OPTIONS = [
	{ value: "live", label: "Live preview" },
	{ value: "source", label: "Source editing", disabled: true },
	{ value: "preview", label: "Preview only" },
] as const;

function renderSelect(onChange = vi.fn(), value = "live") {
	return {
		onChange,
		...render(
			<div className="easymde-settings-center">
				<SettingsSelect
					label="Editing mode"
					onChange={onChange}
					options={OPTIONS}
					value={value}
				/>
				<div data-settings-overlay-root="" />
			</div>,
		),
	};
}

describe("SettingsSelect", () => {
	it("renders one controlled combobox and portals a white aligned listbox", async () => {
		const user = userEvent.setup();
		renderSelect();
		const trigger = screen.getByRole("combobox", { name: "Editing mode" });
		vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
			bottom: 140,
			height: 40,
			left: 320,
			right: 620,
			top: 100,
			width: 300,
			x: 320,
			y: 100,
			toJSON: () => ({}),
		});

		await user.click(trigger);

		const listbox = screen.getByRole("listbox", { name: "Editing mode" });
		expect(listbox.parentElement).toBe(document.body);
		expect(
			listbox.classList.contains("easymde-settings-center__select-listbox"),
		).toBe(true);
		expect(listbox.style.left).toBe("320px");
		expect(listbox.style.top).toBe("103px");
		expect(listbox.style.width).toBe("300px");
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(
			screen
				.getByRole("option", { name: "Live preview" })
				.getAttribute("aria-selected"),
		).toBe("true");
	});

	it("aligns the selected option over the trigger regardless of its index", async () => {
		const user = userEvent.setup();
		renderSelect(vi.fn(), "preview");
		const trigger = screen.getByRole("combobox", { name: "Editing mode" });
		vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
			bottom: 140,
			height: 40,
			left: 320,
			right: 620,
			top: 100,
			width: 300,
			x: 320,
			y: 100,
			toJSON: () => ({}),
		});

		await user.click(trigger);

		const listbox = screen.getByRole("listbox", { name: "Editing mode" });
		expect(listbox.style.top).toBe("55px");
		expect(
			screen
				.getByRole("option", { name: "Preview only" })
				.getAttribute("aria-selected"),
		).toBe("true");
	});

	it("skips disabled options and commits the active keyboard option", async () => {
		const user = userEvent.setup();
		const { onChange } = renderSelect();
		const trigger = screen.getByRole("combobox", { name: "Editing mode" });

		await user.click(trigger);
		await user.keyboard("{ArrowDown}{Enter}");

		expect(onChange).toHaveBeenCalledWith("preview");
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("closes without changing on Escape and outside pointer activation", async () => {
		const user = userEvent.setup();
		const { onChange } = renderSelect();
		const trigger = screen.getByRole("combobox", { name: "Editing mode" });

		await user.click(trigger);
		await user.keyboard("{ArrowDown}{Escape}");
		expect(onChange).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(trigger);

		await user.click(trigger);
		await user.click(document.body);
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onChange).not.toHaveBeenCalled();
	});
});
