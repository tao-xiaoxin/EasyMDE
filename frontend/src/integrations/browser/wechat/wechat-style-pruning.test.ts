import {
	describe,
	expect,
	it,
} from "vitest";

import {
	declaration,
	mockStyleRuntime as mockRuntime,
} from "./wechat-clipboard-test-fixtures";
import {
	styleDeclarations,
	styleDeclarationsSynchronously,
} from "./wechat-pseudo-elements";
import {
	keepStyle,
	PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES,
	portableStyleProperties,
} from "./wechat-style-policy";
import { createWechatTreePredicateCache } from "./wechat-tree-predicates";

const SVG_NS = "http://www.w3.org/2000/svg";


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
});
