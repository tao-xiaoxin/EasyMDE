import {
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { mockStyleRuntime as mockRuntime } from "./wechat-clipboard-test-fixtures";
import {
	createDimensionSemanticsContext,
	RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES,
	syncRawContextAttributes,
} from "./wechat-dimension-semantics";
import { WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE } from "./wechat-style-policy";

describe("WeChat dimension context refresh", () => {
	it("syncRawContextAttributes handles identical, added, changed, removed, reordered, and suppressed identity attributes faithfully", () => {
		const source = document.createElement("div");
		source.setAttribute("class", "alpha");
		source.setAttribute("dir", "rtl");
		source.setAttribute("data-easymde-preview-html-sink", "1");
		const mirror = document.createElement("div");

		// Initial sync with identity suppression.
		syncRawContextAttributes(source, mirror, true);
		expect(mirror.getAttribute("class")).toBe("alpha");
		expect(mirror.getAttribute("dir")).toBe("rtl");
		expect(mirror.hasAttribute("data-easymde-preview-html-sink")).toBe(false);

		// Identical fast-path when no identity attributes exist.
		const plainSource = document.createElement("p");
		plainSource.setAttribute("class", "body");
		plainSource.setAttribute("lang", "en");
		const plainMirror = plainSource.cloneNode(false) as Element;
		const setAttrSpy = vi.spyOn(plainMirror, "setAttribute");
		const removeAttrSpy = vi.spyOn(plainMirror, "removeAttribute");
		syncRawContextAttributes(plainSource, plainMirror, true);
		expect(setAttrSpy).not.toHaveBeenCalled();
		expect(removeAttrSpy).not.toHaveBeenCalled();

		// Updated, added, and removed attributes.
		plainSource.setAttribute("class", "updated");
		plainSource.setAttribute("data-note", "hi");
		plainSource.removeAttribute("lang");
		syncRawContextAttributes(plainSource, plainMirror, true);
		expect(plainMirror.getAttribute("class")).toBe("updated");
		expect(plainMirror.getAttribute("data-note")).toBe("hi");
		expect(plainMirror.hasAttribute("lang")).toBe(false);

		// Suppressed attribute already present on mirror is stripped even when counts match.
		const idSource = document.createElement("article");
		const idMirror = document.createElement("article");
		for (const attr of RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES) {
			idSource.setAttribute(attr, "1");
			idMirror.setAttribute(attr, "1");
		}
		syncRawContextAttributes(idSource, idMirror, true);
		for (const attr of RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES) {
			expect(idMirror.hasAttribute(attr)).toBe(false);
		}
		// With suppressPreviewSinkIdentity = false, identity attributes are copied.
		syncRawContextAttributes(idSource, idMirror, false);
		for (const attr of RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES) {
			expect(idMirror.getAttribute(attr)).toBe("1");
		}
	});

	it("createDimensionSemanticsContext initializes clean mirror without losing refresh synchronization", () => {
		const wrapper = document.createElement("div");
		wrapper.className = "easymde-preview-shell";
		const preview = document.createElement("article");
		preview.className = "easymde-rendered-content";
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.setAttribute("data-easymde-editor-owner", "react");
		preview.innerHTML =
			'<p class="lead" data-easymde-preview-accepted="1">Hello</p>';
		wrapper.append(preview);
		document.body.append(wrapper);

		const context = createDimensionSemanticsContext(
			preview,
			preview,
			mockRuntime((element) => window.getComputedStyle(element)),
		);
		try {
			expect(context.getRefreshGeneration()).toBe(1);
			const mirrorHost = document.querySelector(
				".easymde-wechat-raw-dimension-context",
			);
			const mirrorRoot = mirrorHost?.querySelector("article");
			const mirrorLead = mirrorRoot?.querySelector("p");
			expect(
				mirrorRoot?.getAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE),
			).toBe("1");
			expect(mirrorRoot?.hasAttribute("data-easymde-preview-html-sink")).toBe(
				false,
			);
			expect(mirrorRoot?.hasAttribute("data-easymde-editor-owner")).toBe(false);
			expect(mirrorLead?.hasAttribute("data-easymde-preview-accepted")).toBe(
				false,
			);
			expect(mirrorLead?.className).toBe("lead");

			// Mutate attributes on source and verify refresh() synchronizes mirror.
			wrapper.classList.add("dark-mode");
			preview.querySelector("p")?.setAttribute("class", "lead highlighted");
			context.refresh();
			expect(context.getRefreshGeneration()).toBe(2);
			expect(
				mirrorHost?.querySelector(".easymde-preview-shell")?.className,
			).toContain("dark-mode");
			expect(mirrorLead?.className).toBe("lead highlighted");
			expect(
				mirrorRoot?.getAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE),
			).toBe("1");
		} finally {
			context.cleanup();
			wrapper.remove();
		}
	});
});
