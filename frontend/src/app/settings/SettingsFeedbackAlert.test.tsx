import { createElement } from "@wordpress/element";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsFeedbackAlert } from "./SettingsFeedbackAlert";

describe("SettingsFeedbackAlert", () => {
	it.each([
		["success", "status", "Settings saved"],
		["info", "status", "Configuration copied"],
		["error", "alert", "Settings save failed"],
	] as const)(
		"renders %s feedback with the correct live-region role",
		(kind, role, message) => {
			const { container } = render(
				<SettingsFeedbackAlert
					closeLabel="Close message"
					kind={kind}
					message={message}
					onClose={vi.fn()}
				/>,
			);

			const feedback = screen.getByRole(role);
			expect(feedback.textContent).toContain(message);
			expect(feedback.getAttribute("aria-atomic")).toBe("true");
			expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
				"true",
			);
		},
	);

	it("dismisses without stranding focus on the removed close control", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(
			<SettingsFeedbackAlert
				closeLabel="Close message"
				kind="success"
				message="Settings saved"
				onClose={onClose}
			/>,
		);
		const returnTarget = document.createElement("button");
		document.body.append(returnTarget);
		returnTarget.focus();
		const close = screen.getByRole("button", { name: "Close message" });
		close.focus();
		await user.keyboard("{Enter}");

		expect(onClose).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(returnTarget);
		returnTarget.remove();
	});

	it("reports close-control focus so an owner can pause auto-dismiss", () => {
		const onFocusChange = vi.fn();
		render(
			<SettingsFeedbackAlert
				closeLabel="Close message"
				kind="success"
				message="Settings saved"
				onClose={vi.fn()}
				onFocusChange={onFocusChange}
			/>,
		);
		const close = screen.getByRole("button", { name: "Close message" });
		close.focus();
		close.blur();
		expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
	});
});
