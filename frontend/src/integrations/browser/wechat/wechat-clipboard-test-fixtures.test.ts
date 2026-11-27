import { describe, expect, it } from "vitest";

import { computedStyle, declaration } from "./wechat-clipboard-test-fixtures";

describe("wechat clipboard computed-style fixture", () => {
	it.each(["::before", "::after"])(
		"returns browser-real noncandidate content for an unconfigured %s pseudo",
		(pseudoElement) => {
			const source = document.createElement("p");
			const pseudo = computedStyle(source, pseudoElement);

			expect(pseudo.getPropertyValue("content")).toBe("none");
			expect(pseudo.getPropertyValue("display")).toBe("");
		},
	);

	it.each(["::marker", "::selection", "::first-line"])(
		"preserves the prior empty-value contract for unrelated %s pseudo queries",
		(pseudoElement) => {
			const source = document.createElement("li");
			const pseudo = computedStyle(source, pseudoElement);

			expect(pseudo.getPropertyValue("content")).toBe("");
			expect(pseudo.getPropertyValue("display")).toBe("");
		},
	);

	it("preserves quoted-empty and literal pseudo values supplied by focused declarations", () => {
		const empty = declaration({ content: '""' });
		const literal = declaration({ content: '"generated"' });
		const unreadable = declaration({ content: "" });

		expect(empty.getPropertyValue("content")).toBe('""');
		expect(literal.getPropertyValue("content")).toBe('"generated"');
		expect(unreadable.getPropertyValue("content")).toBe("");
	});
});
