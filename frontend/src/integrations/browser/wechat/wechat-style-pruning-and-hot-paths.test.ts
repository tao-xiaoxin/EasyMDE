import { describe, expect, it, vi } from "vitest";

import type {
	BrowserWechatClipboardRuntime,
	SerializationYield,
} from "./wechat-clipboard-runtime";
import { declaration } from "./wechat-clipboard-test-fixtures";
import {
	createDimensionSemanticsContext,
	RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES,
	syncRawContextAttributes,
} from "./wechat-dimension-semantics";
import { collectPreparedSignatures, collectPreparedSignaturesWithYield } from "./wechat-fidelity-signature";
import {
	createNativeVisualCaptureClone,
	nativeVisualStyleDeclarations,
} from "./wechat-png-conversion";
import type { WechatPngConversionContext } from "./wechat-png-conversion-policy";
import {
	styleDeclarations,
	styleDeclarationsSynchronously,
} from "./wechat-pseudo-elements";
import {
	keepStyle,
	PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES,
	portableStyleProperties,
	removeTransientAttributes,
	WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE,
} from "./wechat-style-policy";
import { createWechatTreePredicateCache } from "./wechat-tree-predicates";

const SVG_NS = "http://www.w3.org/2000/svg";

function mockRuntime(
	resolver: (
		element: Element,
		pseudoElement?: string,
	) => CSSStyleDeclaration,
	fetch?: BrowserWechatClipboardRuntime["fetch"],
): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		...(fetch ? { fetch } : {}),
		getComputedStyle: resolver,
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write: null,
	};
}

describe("WeChat portable style pruning", () => {
	it("omits no-op transparent background shorthands and default background sub-properties only when no image is painted", async () => {
		const paragraph = document.createElement("p");
		const chromeOrderA =
			"rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box";
		const chromeOrderB =
			"none 0% 0% / auto repeat scroll padding-box border-box rgba(0, 0, 0, 0)";
		const cssColor4 =
			"rgb(0 0 0 / 0) none repeat scroll 0px 0px / auto padding-box border-box";

		for (const noopBackground of [
			chromeOrderA,
			chromeOrderB,
			cssColor4,
			"transparent",
		]) {
			const computed = declaration({
				background: noopBackground,
				"background-image": "none",
				"background-position": "0% 0%",
				"background-repeat": "repeat",
				"background-size": "auto",
				display: "block",
			});
			expect(
				keepStyle("background", noopBackground, paragraph, {
					computed,
					omitDefaultValues: true,
					svgElement: false,
				}),
				noopBackground,
			).toBe(false);
			expect(
				keepStyle("background", noopBackground, paragraph, {
					computed,
					omitDefaultValues: false,
					svgElement: false,
				}),
				`omitDefaultValues=false ${noopBackground}`,
			).toBe(true);

			const modern = await styleDeclarations(
				paragraph,
				computed,
				false,
				false,
				mockRuntime(() => computed),
				new Map(),
			);
			const legacy = styleDeclarationsSynchronously(
				paragraph,
				computed,
				false,
				false,
				mockRuntime(() => computed),
			);
			expect(legacy).toEqual(modern);
			for (const property of [
				"background",
				"background-image",
				"background-position",
				"background-repeat",
				"background-size",
			]) {
				expect(
					modern.some((entry) => entry.startsWith(`${property}:`)),
					`${noopBackground} -> ${property}`,
				).toBe(false);
			}
		}

		// `0px 0px` default background-position is also omitted when unpainted.
		const zeroPxComputed = declaration({
			"background-image": "none",
			"background-position": "0px 0px",
		});
		expect(
			keepStyle("background-position", "0px 0px", paragraph, {
				computed: zeroPxComputed,
				omitDefaultValues: true,
				svgElement: false,
			}),
		).toBe(false);

		// Non-standard `foo-gradient(...)` is not treated as a painted CSS gradient.
		const bogusGradientComputed = declaration({
			background: "foo-gradient(red, blue)",
			"background-image": "none",
			"background-position": "0% 0%",
		});
		expect(
			keepStyle("background-position", "0% 0%", paragraph, {
				computed: bogusGradientComputed,
				omitDefaultValues: true,
				svgElement: false,
			}),
		).toBe(false);

		// Real background color and gradient/image keep background and sub-properties.
		const paintedColor = declaration({
			background:
				"rgb(255, 240, 245) none repeat scroll 0% 0% / auto padding-box border-box",
			"background-color": "rgb(255, 240, 245)",
			"background-image": "none",
			"background-position": "0% 0%",
			"background-repeat": "repeat",
			"background-size": "auto",
		});
		expect(
			keepStyle(
				"background",
				paintedColor.getPropertyValue("background"),
				paragraph,
				{
					computed: paintedColor,
					omitDefaultValues: true,
					svgElement: false,
				},
			),
		).toBe(true);
		expect(
			keepStyle("background-color", "rgb(255, 240, 245)", paragraph, {
				computed: paintedColor,
				omitDefaultValues: true,
				svgElement: false,
			}),
		).toBe(true);

		const gradientComputed = declaration({
			background: "linear-gradient(90deg, rgb(1, 2, 3), rgb(4, 5, 6))",
			"background-image": "linear-gradient(90deg, rgb(1, 2, 3), rgb(4, 5, 6))",
			"background-position": "0% 0%",
			"background-repeat": "repeat",
			"background-size": "auto",
		});
		for (const [property, value] of [
			["background", gradientComputed.getPropertyValue("background")],
			[
				"background-image",
				gradientComputed.getPropertyValue("background-image"),
			],
			["background-position", "0% 0%"],
			["background-repeat", "repeat"],
			["background-size", "auto"],
		] as const) {
			expect(
				keepStyle(property, value, paragraph, {
					computed: gradientComputed,
					omitDefaultValues: true,
					svgElement: false,
				}),
				`gradient preserves ${property}`,
			).toBe(true);
		}
	});

	it("omits borderless edges and border-radius:0px on ordinary elements while preserving protected elements and visible borders", () => {
		const borderless = declaration({
			"border-top-width": "0px",
			"border-top-style": "none",
			"border-top-color": "rgb(34, 34, 34)",
			"border-right-width": "0px",
			"border-right-style": "none",
			"border-right-color": "rgba(0, 0, 0, 0)",
			"border-bottom-width": "2px",
			"border-bottom-style": "solid",
			"border-bottom-color": "rgb(200, 10, 20)",
			"border-left-width": "0px",
			"border-left-style": "hidden",
			"border-left-color": "rgb(0, 0, 0)",
			"border-radius": "0px",
		});

		const p = document.createElement("p");
		const span = document.createElement("span");
		const svgPath = document.createElementNS(SVG_NS, "path");

		for (const el of [p, span, svgPath]) {
			const svg = el === svgPath;
			expect(
				keepStyle("border-top-width", "0px", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(false);
			expect(
				keepStyle("border-top-style", "none", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(false);
			expect(
				keepStyle("border-top-color", "rgb(34, 34, 34)", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(false);
			expect(
				keepStyle("border-right-color", "rgba(0, 0, 0, 0)", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(false);
			expect(
				keepStyle("border-radius", "0px", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(false);

			// Visible border edge (`solid`) and `hidden` edge stay preserved.
			expect(
				keepStyle("border-bottom-width", "2px", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(true);
			expect(
				keepStyle("border-bottom-style", "solid", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(true);
			expect(
				keepStyle("border-bottom-color", "rgb(200, 10, 20)", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(true);
			expect(
				keepStyle("border-left-style", "hidden", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(true);
			// Non-zero border-radius stays preserved.
			expect(
				keepStyle("border-radius", "4px", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: svg,
				}),
			).toBe(true);
			// Native PNG capture (`omitDefaultValues = false`) preserves everything.
			expect(
				keepStyle("border-top-width", "0px", el, {
					computed: borderless,
					omitDefaultValues: false,
					svgElement: svg,
				}),
			).toBe(true);
			expect(
				keepStyle("border-radius", "0px", el, {
					computed: borderless,
					omitDefaultValues: false,
					svgElement: svg,
				}),
			).toBe(true);
		}

		// Protected elements keep borderless declarations and border-radius:0px.
		const taskLi = document.createElement("li");
		taskLi.className = "task-list-item";
		const taskCheckbox = document.createElement("input");
		taskCheckbox.type = "checkbox";
		taskLi.append(taskCheckbox);

		const protectedElements = [
			document.createElement("table"),
			document.createElement("thead"),
			document.createElement("tbody"),
			document.createElement("tfoot"),
			document.createElement("tr"),
			document.createElement("th"),
			document.createElement("td"),
			document.createElement("hr"),
			document.createElement("blockquote"),
			document.createElement("input"),
			taskCheckbox,
		];
		for (const el of protectedElements) {
			expect(
				keepStyle("border-top-width", "0px", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: false,
				}),
				`${el.tagName} border-top-width`,
			).toBe(true);
			expect(
				keepStyle("border-top-style", "none", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: false,
				}),
				`${el.tagName} border-top-style`,
			).toBe(true);
			expect(
				keepStyle("border-radius", "0px", el, {
					computed: borderless,
					omitDefaultValues: true,
					svgElement: false,
				}),
				`${el.tagName} border-radius`,
			).toBe(true);
		}
		// Root and pseudo-elements are also protected.
		expect(
			keepStyle("border-top-width", "0px", p, {
				computed: borderless,
				omitDefaultValues: true,
				root: true,
				svgElement: false,
			}),
		).toBe(true);
		expect(
			keepStyle("border-radius", "0px", p, {
				computed: borderless,
				omitDefaultValues: true,
				root: true,
				svgElement: false,
			}),
		).toBe(true);
		expect(
			keepStyle("border-top-width", "0px", p, {
				computed: borderless,
				omitDefaultValues: true,
				pseudoElement: true,
				svgElement: false,
			}),
		).toBe(true);
		expect(
			keepStyle("border-radius", "0px", p, {
				computed: borderless,
				omitDefaultValues: true,
				pseudoElement: true,
				svgElement: false,
			}),
		).toBe(true);
	});

	it("omits stop-color and stop-opacity on non-<stop> SVG elements and preserves them on <stop>", () => {
		const svg = document.createElementNS(SVG_NS, "svg");
		const path = document.createElementNS(SVG_NS, "path");
		const gradient = document.createElementNS(SVG_NS, "linearGradient");
		const stop = document.createElementNS(SVG_NS, "stop");
		gradient.append(stop);
		svg.append(gradient, path);

		expect(portableStyleProperties(path, false, false)).not.toContain(
			"stop-color",
		);
		expect(portableStyleProperties(path, false, false)).not.toContain(
			"stop-opacity",
		);
		expect(portableStyleProperties(stop, false, false)).toContain("stop-color");
		expect(portableStyleProperties(stop, false, false)).toContain(
			"stop-opacity",
		);

		expect(
			keepStyle("stop-color", "rgb(0, 0, 0)", path, {
				omitDefaultValues: true,
				svgElement: true,
			}),
		).toBe(false);
		expect(
			keepStyle("stop-opacity", "1", path, {
				omitDefaultValues: true,
				svgElement: true,
			}),
		).toBe(false);
		expect(
			keepStyle("stop-color", "rgb(0, 0, 0)", stop, {
				omitDefaultValues: true,
				svgElement: true,
			}),
		).toBe(true);
		expect(
			keepStyle("stop-opacity", "1", stop, {
				omitDefaultValues: true,
				svgElement: true,
			}),
		).toBe(true);
		expect(
			keepStyle("stop-color", "rgb(0, 0, 0)", path, {
				omitDefaultValues: false,
				svgElement: true,
			}),
		).toBe(true);
	});

	it("omits border-collapse:separate and border-spacing:0px outside tables and preserves them on tables and table descendants", () => {
		const predicates = createWechatTreePredicateCache();
		const outsideP = document.createElement("p");
		const svgPath = document.createElementNS(SVG_NS, "path");
		const table = document.createElement("table");
		const tbody = document.createElement("tbody");
		const tr = document.createElement("tr");
		const td = document.createElement("td");
		const innerSpan = document.createElement("span");
		td.append(innerSpan);
		tr.append(td);
		tbody.append(tr);
		table.append(tbody);
		const cssTableDiv = document.createElement("div");

		const blockStyle = declaration({ display: "block" });
		const tableDisplayStyle = declaration({ display: "table" });

		// Outside table and SVG -> omitted
		for (const [el, isSvg] of [
			[outsideP, false],
			[svgPath, true],
		] as const) {
			expect(
				keepStyle("border-collapse", "separate", el, {
					computed: blockStyle,
					omitDefaultValues: true,
					predicates,
					svgElement: isSvg,
				}),
			).toBe(false);
			expect(
				keepStyle("border-spacing", "0px", el, {
					computed: blockStyle,
					omitDefaultValues: true,
					predicates,
					svgElement: isSvg,
				}),
			).toBe(false);
			expect(
				keepStyle("border-spacing", "0px 0px", el, {
					computed: blockStyle,
					omitDefaultValues: true,
					predicates,
					svgElement: isSvg,
				}),
			).toBe(false);
		}

		// Non-default values outside table stay preserved, and native capture stays preserved.
		expect(
			keepStyle("border-collapse", "collapse", outsideP, {
				computed: blockStyle,
				omitDefaultValues: true,
				predicates,
				svgElement: false,
			}),
		).toBe(true);
		expect(
			keepStyle("border-collapse", "separate", outsideP, {
				computed: blockStyle,
				omitDefaultValues: false,
				predicates,
				svgElement: false,
			}),
		).toBe(true);

		// Table, td, descendant inside table, and display:table element stay preserved.
		for (const [el, computed] of [
			[table, tableDisplayStyle],
			[td, declaration({ display: "table-cell" })],
			[innerSpan, declaration({ display: "inline" })],
			[cssTableDiv, tableDisplayStyle],
		] as const) {
			expect(
				keepStyle("border-collapse", "separate", el, {
					computed,
					omitDefaultValues: true,
					predicates,
					svgElement: false,
				}),
			).toBe(true);
			expect(
				keepStyle("border-spacing", "0px", el, {
					computed,
					omitDefaultValues: true,
					predicates,
					svgElement: false,
				}),
			).toBe(true);
		}
	});

	it("preserves all 14 inherited default style properties, safety-critical properties, and SVG presentation attribute overrides", () => {
		const p = document.createElement("p");
		const inheritedSamples: ReadonlyArray<readonly [string, string]> = [
			["font-style", "normal"],
			["font-variant", "normal"],
			["font-stretch", "100%"],
			["letter-spacing", "normal"],
			["text-transform", "none"],
			["white-space", "normal"],
			["text-indent", "0px"],
			["text-shadow", "none"],
			["tab-size", "8"],
			["list-style-position", "outside"],
			["marker-start", "none"],
			["marker-mid", "none"],
			["marker-end", "none"],
			["paint-order", "normal"],
		];
		expect(inheritedSamples).toHaveLength(
			PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES.size,
		);
		for (const [property, value] of inheritedSamples) {
			expect(PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES.has(property)).toBe(
				true,
			);
			expect(
				keepStyle(property, value, p, { omitDefaultValues: true }),
				`inherited ${property}`,
			).toBe(true);
		}

		// Never prune max-width:none, min-width:0px, box-sizing:border-box, transform-origin.
		for (const [property, value] of [
			["max-width", "none"],
			["min-width", "0px"],
			["min-height", "0px"],
			["box-sizing", "border-box"],
			["transform-origin", "50% 50%"],
		] as const) {
			expect(
				keepStyle(property, value, p, { omitDefaultValues: true }),
				`kept ${property}:${value}`,
			).toBe(true);
		}

		// Non-inherited defaults are omitted on ordinary HTML elements.
		for (const [property, value] of [
			["flex", "0 1 auto"],
			["position", "static"],
			["float", "none"],
			["clear", "none"],
			["max-height", "none"],
			["overflow", "visible"],
			["overflow-x", "visible"],
			["overflow-y", "visible"],
			["top", "auto"],
			["right", "auto"],
			["bottom", "auto"],
			["left", "auto"],
			["z-index", "auto"],
			["transform", "none"],
		] as const) {
			expect(
				keepStyle(property, value, p, { omitDefaultValues: true }),
				`pruned ${property}:${value}`,
			).toBe(false);
			expect(
				keepStyle(property, value, p, { omitDefaultValues: false }),
				`native kept ${property}:${value}`,
			).toBe(true);
		}

		// SVG and replaced elements preserve overflow:visible (UA default is hidden/clip).
		const svg = document.createElementNS(SVG_NS, "svg");
		const img = document.createElement("img");
		for (const property of ["overflow", "overflow-x", "overflow-y"] as const) {
			expect(
				keepStyle(property, "visible", svg, {
					omitDefaultValues: true,
					svgElement: true,
				}),
			).toBe(true);
			expect(
				keepStyle(property, "visible", img, {
					omitDefaultValues: true,
					svgElement: false,
				}),
			).toBe(true);
		}

		// Non-inherited SVG defaults are omitted when no presentation attribute is being overridden,
		// and preserved when overriding a presentation attribute.
		const plainPath = document.createElementNS(SVG_NS, "path");
		const attrPath = document.createElementNS(SVG_NS, "path");
		attrPath.setAttribute("filter", "url(#old)");
		attrPath.setAttribute("transform", "scale(2)");
		for (const [property, value] of [
			["clip-path", "none"],
			["mask", "none"],
			["filter", "none"],
			["mix-blend-mode", "normal"],
			["transform-box", "view-box"],
			["vector-effect", "none"],
			["transform", "none"],
		] as const) {
			expect(
				keepStyle(property, value, plainPath, {
					omitDefaultValues: true,
					svgElement: true,
				}),
				`plain svg pruned ${property}`,
			).toBe(false);
		}
		expect(
			keepStyle("filter", "none", attrPath, {
				omitDefaultValues: true,
				svgElement: true,
			}),
		).toBe(true);
		expect(
			keepStyle("transform", "none", attrPath, {
				omitDefaultValues: true,
				svgElement: true,
			}),
		).toBe(true);
	});

	it("preserves explicit child resets of CSS-inherited SVG properties marker-* and paint-order without presentation attributes", async () => {
		const svg = document.createElementNS(SVG_NS, "svg");
		const group = document.createElementNS(SVG_NS, "g");
		group.setAttribute("style", "marker-end:url(#arrow);paint-order:stroke");
		const childPath = document.createElementNS(SVG_NS, "path");
		childPath.setAttribute(
			"style",
			"marker-start:none;marker-mid:none;marker-end:none;paint-order:normal",
		);
		group.append(childPath);
		svg.append(group);

		const childComputed = declaration({
			"marker-start": "none",
			"marker-mid": "none",
			"marker-end": "none",
			"paint-order": "normal",
		});

		for (const [property, value] of [
			["marker-start", "none"],
			["marker-mid", "none"],
			["marker-end", "none"],
			["paint-order", "normal"],
		] as const) {
			expect(childPath.hasAttribute(property)).toBe(false);
			expect(
				keepStyle(property, value, childPath, {
					computed: childComputed,
					omitDefaultValues: true,
					svgElement: true,
				}),
				`inherited SVG reset ${property}:${value}`,
			).toBe(true);
		}

		const modern = await styleDeclarations(
			childPath,
			childComputed,
			false,
			false,
			mockRuntime(() => childComputed),
			new Map(),
		);
		const legacy = styleDeclarationsSynchronously(
			childPath,
			childComputed,
			false,
			false,
			mockRuntime(() => childComputed),
		);
		expect(legacy).toEqual(modern);
		expect(modern).toContain("marker-start:none");
		expect(modern).toContain("marker-mid:none");
		expect(modern).toContain("marker-end:none");
		expect(modern).toContain("paint-order:normal");
	});
});

describe("WeChat hot-path micro-allocation and yield optimizations", () => {
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

	it("checks shouldYield once per element in styleDeclarations, nativeVisualStyleDeclarations, and preparedLayoutSignatureWithYield", async () => {
		const preview = document.createElement("article");
		preview.innerHTML = "<p>One</p><p>Two</p>";
		const p = preview.querySelector("p") as HTMLElement;
		const measured = declaration({
			display: "block",
			color: "rgb(10, 20, 30)",
			position: "static",
			"max-height": "none",
		});
		const runtime = mockRuntime((_el, pseudo) =>
			pseudo ? declaration({ content: "none" }) : measured,
		);

		const styleShouldYield = vi.fn(() => false);
		const styleYield = Object.assign(
			vi.fn(async () => undefined),
			{ shouldYield: styleShouldYield },
		) as SerializationYield;
		await styleDeclarations(p, measured, false, false, runtime, new Map(), styleYield);
		expect(styleShouldYield).toHaveBeenCalledTimes(1);

		const nativeShouldYield = vi.fn(() => false);
		const nativeYield = Object.assign(
			vi.fn(async () => undefined),
			{ shouldYield: nativeShouldYield },
		) as SerializationYield;
		const nativeDecls = await nativeVisualStyleDeclarations(
			p,
			measured,
			runtime,
			new Map(),
			nativeYield,
		);
		expect(nativeShouldYield).toHaveBeenCalledTimes(1);
		// Native PNG capture keeps default values (`omitDefaultValues = false`).
		expect(nativeDecls).toContain("position:static");
		expect(nativeDecls).toContain("max-height:none");

		// createNativeVisualCaptureClone still strips transient attributes from every descendant.
		const captureSource = document.createElement("div");
		captureSource.setAttribute("data-temp", "1");
		captureSource.innerHTML = '<span data-child="2" aria-label="x">Text</span>';
		const pngContext: WechatPngConversionContext = {
			captureBoundary: captureSource,
			imageUploadPort: { upload: vi.fn() },
			maxBytes: 1024,
			mermaidSnapshots: new Map(),
			postId: 1,
			rasterizationPort: { rasterize: vi.fn() },
			scale: 1,
			signal: new AbortController().signal,
			state: { uploadsMayRemain: false },
		};
		const captured = await createNativeVisualCaptureClone(
			captureSource,
			runtime,
			new Map(),
			null,
			pngContext,
		);
		expect(captured.element.hasAttribute("data-temp")).toBe(false);
		expect(
			captured.element.querySelector("span")?.hasAttribute("data-child"),
		).toBe(false);
		expect(
			captured.element.querySelector("span")?.hasAttribute("aria-label"),
		).toBe(false);

		const sigShouldYield = vi.fn(() => false);
		const sigYield = Object.assign(
			vi.fn(async () => undefined),
			{ shouldYield: sigShouldYield },
		) as SerializationYield;
		const syncSignature = collectPreparedSignatures({ preview, runtime, includeDimension: false }).layout;
		const asyncSignature = (await collectPreparedSignaturesWithYield({
			preview,
			runtime,
			yieldToBrowser: sigYield,
			includeDimension: false,
		})).layout;
		expect(asyncSignature).toBe(syncSignature);
		// 3 elements in `preview` (`article`, `p`, `p`) -> 1 shouldYield check per element.
		expect(sigShouldYield).toHaveBeenCalledTimes(3);
	});

	it("preserves Chromium serialized transparent background shorthand on task-list checkboxes and their pseudos", () => {
		const list = document.createElement("ul");
		list.className = "task-list";
		const item = document.createElement("li");
		item.className = "task-list-item";
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		item.append(checkbox);
		list.append(item);
		const blinkTransparentBackground =
			"rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box";
		const computed = declaration({
			background: blinkTransparentBackground,
			"background-image": "none",
			"background-position": "0% 0%",
			"background-repeat": "repeat",
			"background-size": "auto",
		});

		expect(
			keepStyle("background", blinkTransparentBackground, checkbox, {
				computed,
				omitDefaultValues: true,
				svgElement: false,
			}),
		).toBe(true);
		expect(
			keepStyle("background", blinkTransparentBackground, checkbox, {
				computed,
				omitDefaultValues: true,
				pseudoElement: true,
				pseudoElementContent: '""',
				svgElement: false,
			}),
		).toBe(true);
	});

	it("caches per-element pruning computed-style queries across styleDeclarations and passes svg predicates through native visual capture", async () => {
		const paragraph = document.createElement("p");
		const rawComputed = declaration({
			background:
				"rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box",
			"background-image": "none",
			"background-position": "0% 0%",
			"background-repeat": "repeat",
			"background-size": "auto",
			"border-top-width": "0px",
			"border-top-style": "none",
			"border-top-color": "rgb(34, 34, 34)",
			"border-right-width": "0px",
			"border-right-style": "none",
			"border-right-color": "rgb(34, 34, 34)",
			"border-bottom-width": "2px",
			"border-bottom-style": "solid",
			"border-bottom-color": "rgb(200, 10, 20)",
			"border-left-width": "0px",
			"border-left-style": "none",
			"border-left-color": "rgb(34, 34, 34)",
			"border-collapse": "separate",
			"border-spacing": "0px",
			display: "block",
			color: "rgb(34, 34, 34)",
		});
		const readCounts = new Map<string, number>();
		const trackedComputed = {
			getPropertyValue: (property: string): string => {
				readCounts.set(property, (readCounts.get(property) ?? 0) + 1);
				return rawComputed.getPropertyValue(property);
			},
		} as unknown as CSSStyleDeclaration;

		const declarations = await styleDeclarations(
			paragraph,
			trackedComputed,
			false,
			false,
			mockRuntime(() => trackedComputed),
			new Map(),
		);
		expect(declarations).toContain("border-bottom-width:2px");
		expect(declarations).toContain("border-bottom-style:solid");
		expect(declarations).toContain("border-bottom-color:rgb(200, 10, 20)");
		expect(
			declarations.some((entry) => entry.startsWith("border-top-")),
		).toBe(false);
		expect(
			declarations.some((entry) => entry.startsWith("background")),
		).toBe(false);
		expect(
			declarations.some((entry) => entry.startsWith("border-collapse:")),
		).toBe(false);
		expect(
			declarations.some((entry) => entry.startsWith("border-spacing:")),
		).toBe(false);
		// Each side style/width is read at most once by pruning (+1 for the main property loop).
		expect(readCounts.get("border-top-style")).toBe(2);
		expect(readCounts.get("border-top-width")).toBe(2);
		// Bordered bottom edge short-circuits before reading border-bottom-width in pruning.
		expect(readCounts.get("border-bottom-style")).toBe(2);
		expect(readCounts.get("border-bottom-width")).toBe(1);
		// Background image/shorthand pruning reads once across all 4 background sub-properties (+1 main loop).
		expect(readCounts.get("background-image")).toBe(2);
		expect(readCounts.get("background")).toBe(2);
		// Table display check runs at most once across border-collapse and border-spacing (+1 main loop).
		expect(readCounts.get("display")).toBe(2);

		// nativeVisualStyleDeclarations reuses the pass-local tree predicate cache once per element
		// rather than walking ancestors on every CSS property inside keepStyle.
		const container = document.createElement("div");
		container.className = "easymde-math-inline";
		const katex = document.createElement("span");
		katex.className = "katex";
		const leaf = document.createElement("span");
		katex.append(leaf);
		container.append(katex);
		const predicates = createWechatTreePredicateCache();
		const isSvgSpy = vi.spyOn(predicates, "isSvgElement");
		const specialSpy = vi.spyOn(predicates, "supportsSpecialLayout");
		const nativeMeasured = declaration({
			display: "inline-block",
			color: "rgb(10, 20, 30)",
			position: "relative",
			"vertical-align": "baseline",
		});
		const nativeDecls = await nativeVisualStyleDeclarations(
			leaf,
			nativeMeasured,
			mockRuntime(() => nativeMeasured),
			new Map(),
			null,
			predicates,
		);
		expect(nativeDecls).toContain("display:inline-block");
		expect(nativeDecls).toContain("position:relative");
		expect(isSvgSpy).toHaveBeenCalledTimes(1);
		expect(specialSpy).toHaveBeenCalledTimes(1);
	});
});
