// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { SafePreviewHtml } from "../../../contracts/ports/preview-request";
import { createEnhancementCandidate } from "./preview-enhancement-staging";

function mountSurface(
	className: string,
	canvasWidth: number,
	surfaceWidth = 0,
): Readonly<{ canvas: HTMLElement; surface: HTMLElement }> {
	const canvas = document.createElement("div");
	canvas.className = "easymde-immersive-preview-canvas";
	Object.defineProperty(canvas, "clientWidth", {
		configurable: true,
		value: canvasWidth,
	});
	const surface = document.createElement("div");
	surface.className = className;
	Object.defineProperty(surface, "getBoundingClientRect", {
		configurable: true,
		value: () => ({ height: 0, width: surfaceWidth }),
	});
	canvas.append(surface);
	document.body.append(canvas);
	return { canvas, surface };
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("createEnhancementCandidate", () => {
	it("stages a hidden visual-mode Preview owner as a laid-out box at the scroll canvas width", () => {
		const { canvas, surface } = mountSurface(
			"easymde-preview easymde-markdown-theme-newsprint easymde-preview-surface-hidden",
			720,
		);

		const { surface: candidate } = createEnhancementCandidate(
			surface,
			"<p>Fresh</p>" as SafePreviewHtml,
			true,
		);

		expect(candidate.classList.contains("easymde-preview-surface-hidden")).toBe(
			false,
		);
		expect(
			candidate.classList.contains("easymde-markdown-theme-newsprint"),
		).toBe(true);
		expect(candidate.style.width).toBe("720px");
		expect(candidate.parentElement).toBe(canvas);
		expect(candidate.dataset.easymdePreviewStaging).toBe("1");
		// The live owner keeps its own hidden class; only the staging copy drops it.
		expect(surface.classList.contains("easymde-preview-surface-hidden")).toBe(
			true,
		);
	});

	it("keeps the visible owner width when the active surface lays out", () => {
		const { surface } = mountSurface("easymde-preview", 720, 512);

		const { surface: candidate } = createEnhancementCandidate(
			surface,
			"<p>Fresh</p>" as SafePreviewHtml,
			true,
		);

		expect(candidate.style.width).toBe("512px");
	});

	it("falls back to one pixel when neither the surface nor a scroll canvas has width", () => {
		const surface = document.createElement("div");
		surface.className = "easymde-preview easymde-preview-surface-hidden";
		document.body.append(surface);

		const { surface: candidate } = createEnhancementCandidate(
			surface,
			"<p>Fresh</p>" as SafePreviewHtml,
			false,
		);

		expect(candidate.style.width).toBe("1px");
		expect(candidate.style.display).toBe("none");
		expect(candidate.classList.contains("easymde-preview-surface-hidden")).toBe(
			false,
		);
	});
});
