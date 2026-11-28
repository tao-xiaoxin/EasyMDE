import {
	describe,
	expect,
	it,
} from "vitest";

import { removeTransientAttributes } from "./wechat-style-policy";

describe("WeChat transient attribute cleanup", () => {
	it("removeTransientAttributes preserves safe styles, strips transient and unsafe URL attributes, and sanitizes srcset", () => {
		const el = document.createElement("img");
		const longStyle = `display:block;color:rgb(1, 2, 3);background-image:linear-gradient(90deg, red, blue);padding-left:12px`;
		el.setAttribute("style", longStyle);
		el.setAttribute("id", "hero");
		el.setAttribute("alt", "Diagram");
		el.setAttribute("data-easymde-source", "1");
		el.setAttribute("aria-label", "transient");
		el.setAttribute("onclick", "alert(1)");
		el.setAttribute("role", "presentation");
		el.setAttribute("tabindex", "0");
		el.setAttribute("href", "  java\nscript:alert(1)");
		el.setAttribute("src", "data:image/png;base64,AAAA");
		el.setAttribute(
			"srcset",
			"javascript:alert(1) 1x, https://example.test/ok.png 2x, data:image/png;base64,AAAA 3x, vbscript:bad 4x",
		);

		removeTransientAttributes(el);

		expect(el.getAttribute("style")).toBe(longStyle);
		expect(el.getAttribute("id")).toBe("hero");
		expect(el.getAttribute("alt")).toBe("Diagram");
		expect(el.hasAttribute("data-easymde-source")).toBe(false);
		expect(el.hasAttribute("aria-label")).toBe(false);
		expect(el.hasAttribute("onclick")).toBe(false);
		expect(el.hasAttribute("role")).toBe(false);
		expect(el.hasAttribute("tabindex")).toBe(false);
		expect(el.hasAttribute("href")).toBe(false);
		expect(el.getAttribute("src")).toBe("data:image/png;base64,AAAA");
		expect(el.getAttribute("srcset")).toBe(
			"https://example.test/ok.png 2x, data:image/png;base64,AAAA 3x",
		);

		// Unsafe data: URL on src is removed.
		const badImg = document.createElement("img");
		badImg.setAttribute("src", "data:text/html;base64,PHNjcmlwdD4=");
		removeTransientAttributes(badImg);
		expect(badImg.hasAttribute("src")).toBe(false);
	});
});
