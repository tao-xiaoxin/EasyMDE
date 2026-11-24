import { describe, expect, it, vi } from "vitest";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import { declaration } from "./wechat-clipboard-test-fixtures";
import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	HIDDEN_NODES,
	WECHAT_PNG_VISUAL_CLONES,
} from "./wechat-clone-metadata";
import { createPseudoMarker } from "./wechat-pseudo-elements";
import {
	applyWechatTableNativeGridForSerialization,
	createWechatTableNativeGridGuard,
	planWechatTableNativeGridForSerialization,
	wechatTableNativeGridAuxiliarySignature,
} from "./wechat-table-native-grid-integration";

type StyleValues = Readonly<Record<string, string>>;

const tableStyles: StyleValues = {
	display: "block",
	"animation-name": "none",
	width: "335px",
	"table-layout": "auto",
	"border-collapse": "collapse",
	"border-spacing": "2px",
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"border-top-style": "none",
	"border-right-style": "none",
	"border-bottom-style": "none",
	"border-left-style": "none",
	"border-top-width": "0px",
	"border-right-width": "0px",
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-radius": "0px",
	"border-top-left-radius": "0px",
	"border-top-right-radius": "0px",
	"border-bottom-right-radius": "0px",
	"border-bottom-left-radius": "0px",
	"box-shadow": "none",
	"padding-top": "0px",
	"padding-right": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
};

const groupStyles: StyleValues = {
	display: "contents",
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"border-top-style": "none",
	"border-right-style": "none",
	"border-bottom-style": "none",
	"border-left-style": "none",
	"border-top-width": "0px",
	"border-right-width": "0px",
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-radius": "0px",
	"border-top-left-radius": "0px",
	"border-top-right-radius": "0px",
	"border-bottom-right-radius": "0px",
	"border-bottom-left-radius": "0px",
	"box-shadow": "none",
	"padding-top": "0px",
	"padding-right": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
};

const pseudoStyles: StyleValues = {
	content: '""',
	"animation-name": "none",
	display: "table-caption",
	width: "335px",
	height: "0px",
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"border-top-style": "none",
	"border-right-style": "none",
	"border-bottom-style": "none",
	"border-left-style": "none",
	"border-top-width": "0px",
	"border-right-width": "0px",
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-radius": "0px",
	"border-top-left-radius": "0px",
	"border-top-right-radius": "0px",
	"border-bottom-right-radius": "0px",
	"border-bottom-left-radius": "0px",
	"box-shadow": "none",
	"padding-top": "0px",
	"padding-right": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
	"margin-top": "0px",
	"margin-right": "0px",
	"margin-bottom": "0px",
	"margin-left": "0px",
};

function style(values: StyleValues): CSSStyleDeclaration {
	return declaration(values);
}

function rect(width: number, height: number): DOMRect {
	return {
		bottom: height,
		height,
		left: 0,
		right: width,
		top: 0,
		width,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} as DOMRect;
}

function cssRule(css: string, selector = ".theme table::before"): CSSRule {
	const styleElement = document.createElement("style");
	styleElement.textContent = `${selector}{${css}}`;
	document.head.append(styleElement);
	const rule = styleElement.sheet?.cssRules.item(0);
	if (!rule) throw new Error("CSS test rule missing");
	return rule;
}

function mutableCssRule(
	css: string,
	selector = ".theme table::before",
): CSSStyleRule {
	const styleElement = document.createElement("style");
	styleElement.textContent = `${selector}{${css}}`;
	document.head.append(styleElement);
	const rule = styleElement.sheet?.cssRules.item(0);
	if (!(rule instanceof CSSStyleRule))
		throw new Error("CSS style rule missing");
	return rule;
}

function tableFixture(): HTMLTableElement {
	document.body.innerHTML =
		'<div class="theme"><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table></div>';
	const table = document.querySelector("table");
	if (!table) throw new Error("table fixture missing");
	const tableRect = rect(335, 133);
	Object.defineProperty(table, "getBoundingClientRect", {
		configurable: true,
		value: () => tableRect,
	});
	Object.defineProperty(table.parentElement, "getBoundingClientRect", {
		configurable: true,
		value: () => tableRect,
	});
	table.querySelectorAll("tr").forEach((row) => {
		let right = 0;
		Array.from(row.children).forEach((cell) => {
			right += 111.6666666667;
			Object.defineProperty(cell, "getBoundingClientRect", {
				configurable: true,
				value: () => {
					const width = 111.6666666667;
					return { ...rect(width, 33), left: right - width, right };
				},
			});
		});
	});
	return table;
}

function runtimeFor(
	table: HTMLTableElement,
	{
		rules = [cssRule("width:100cqi;")],
		pseudo = {},
		tableStyle = {},
		cell = {},
		hiddenAncestor = false,
	}: Readonly<{
		rules?: readonly CSSRule[];
		pseudo?: StyleValues;
		tableStyle?: StyleValues;
		cell?: StyleValues;
		hiddenAncestor?: boolean;
	}> = {},
): BrowserWechatClipboardRuntime {
	const cells = Array.from(table.querySelectorAll("th, td"));
	return {
		blob: Blob,
		clipboardItem: null,
		document: {
			defaultView: {
				CSSMediaRule: window.CSSMediaRule,
				CSSRule: window.CSSRule,
				CSSStyleRule: window.CSSStyleRule,
				CSSSupportsRule: window.CSSSupportsRule,
				matchMedia: vi.fn(() => ({ matches: true })),
				CSS: { supports: vi.fn(() => true) },
			},
			styleSheets: [{ cssRules: rules }],
		} as unknown as Document,
		getComputedStyle: (element, pseudoElement) => {
			if (pseudoElement) return style({ ...pseudoStyles, ...pseudo });
			if (element === table) return style({ ...tableStyles, ...tableStyle });
			if (element.parentElement === table)
				return style({
					...groupStyles,
					...(hiddenAncestor ? { display: "none" } : {}),
				});
			if (element.tagName === "TR") return style({ display: "table-row" });
			if (cells.includes(element))
				return style({ display: "table-cell", ...cell });
			return style({ display: "block" });
		},
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write: null,
	};
}

describe("wechat-table-native-grid integration", () => {
	it("changes the pure auxiliary signature for 100cqi to fixed 335px at equal geometry", () => {
		const dynamic = tableFixture();
		const dynamicSignature = wechatTableNativeGridAuxiliarySignature(
			dynamic,
			runtimeFor(dynamic),
		);
		const fixed = tableFixture();
		const fixedSignature = wechatTableNativeGridAuxiliarySignature(
			fixed,
			runtimeFor(fixed, { rules: [cssRule("width:335px;")] }),
		);
		expect(fixedSignature).not.toBe(dynamicSignature);
	});

	it("applies only display:table after the existing scroll section", () => {
		const table = tableFixture();
		const clone = table.cloneNode(true) as HTMLTableElement;
		clone.setAttribute(
			"style",
			"display:block;width:max-content;margin-left:auto;overflow-x:visible",
		);
		const pseudo = style(pseudoStyles);
		const marker = createPseudoMarker(
			table,
			clone,
			"::before",
			pseudo,
			() => pseudo,
			false,
			"",
			null,
			[
				"display:table-caption",
				"width:335px!important",
				"height:0px",
				"padding:0px",
				"border:0px",
			],
		);
		if (!marker) throw new Error("generated marker missing");
		clone.append(marker);
		const markerStyle = marker.getAttribute("style");
		expect(GENERATED_PSEUDO_CLONE_OWNERS.get(marker)?.owner).toBe(clone);
		const section = document.createElement("section");
		section.append(clone);
		const plans = planWechatTableNativeGridForSerialization(
			table,
			new Map([[table, clone]]),
			runtimeFor(table),
		);

		applyWechatTableNativeGridForSerialization(section, plans);

		expect(clone.parentElement).toBe(section);
		expect(clone.getAttribute("style")).toContain("display:table!important");
		expect(clone.getAttribute("style")).toContain("width:max-content");
		expect(clone.getAttribute("style")).toContain("margin-left:auto");
		expect(clone.getAttribute("style")).toContain("overflow-x:visible");
		expect(marker.getAttribute("style")).toBe(markerStyle);
	});

	it("omits an existing serializer-hidden table subtree from guard and planning", () => {
		const root = document.createElement("article");
		root.setAttribute("data-easymde-preview-html-sink", "1");
		root.innerHTML =
			"<div><table><tbody><tr><td>Hidden</td></tr></tbody></table></div>";
		const hidden = root.querySelector("div");
		const parent = hidden?.parentElement;
		const table = root.querySelector("table");
		if (!hidden || !parent || !table)
			throw new Error("hidden table fixture missing");
		const cloneRoot = root.cloneNode(true) as HTMLElement;
		const cloneHidden = cloneRoot.querySelector("div");
		if (!cloneHidden) throw new Error("hidden clone fixture missing");
		HIDDEN_NODES.add(cloneHidden);

		expect(() =>
			createWechatTableNativeGridGuard(root, {
				...runtimeFor(table),
				getComputedStyle: (element, pseudoElement) =>
					element === hidden && !pseudoElement
						? style({ display: "none" })
						: runtimeFor(table).getComputedStyle(element, pseudoElement),
			}),
		).not.toThrow();
		expect(
			planWechatTableNativeGridForSerialization(
				root,
				new Map([[hidden, cloneHidden]]),
				runtimeFor(table, { hiddenAncestor: true }),
			),
		).toEqual([]);
	});

	it("omits an authorized PNG-rasterized subtree from table admission", () => {
		const root = document.createElement("article");
		root.setAttribute("data-easymde-preview-html-sink", "1");
		root.innerHTML =
			'<div class="easymde-mermaid"><table><tbody><tr><td>Rasterized</td></tr></tbody></table><svg></svg></div>';
		const owner = root.querySelector(".easymde-mermaid");
		const table = root.querySelector("table");
		if (!owner || !table) throw new Error("rasterized table fixture missing");
		const cloneRoot = root.cloneNode(true) as HTMLElement;
		const cloneOwner = cloneRoot.querySelector(".easymde-mermaid");
		if (!cloneOwner) throw new Error("rasterized clone fixture missing");
		WECHAT_PNG_VISUAL_CLONES.set(cloneOwner, {
			kind: "mermaid",
			source: owner,
		});

		expect(() =>
			createWechatTableNativeGridGuard(root, runtimeFor(table), true),
		).not.toThrow();
		expect(
			planWechatTableNativeGridForSerialization(
				root,
				new Map([[owner, cloneOwner]]),
				runtimeFor(table),
			),
		).toEqual([]);
	});

	it("fails explicitly for a visible unmeasurable table", () => {
		const table = tableFixture();
		Object.defineProperty(table, "getBoundingClientRect", {
			configurable: true,
			value: () => rect(0, 0),
		});
		expect(() =>
			createWechatTableNativeGridGuard(table, runtimeFor(table)),
		).toThrow("wechat-table-native-grid-table-geometry");
	});

	it("captures the table baseline once and rejects an equal-geometry CSS mutation", () => {
		const table = tableFixture();
		const authorRule = mutableCssRule("width:100cqi;");
		const dynamicRuntime = runtimeFor(table, { rules: [authorRule] });
		const guard = createWechatTableNativeGridGuard(table, dynamicRuntime);
		expect(() => guard.assertCurrent()).not.toThrow();

		const dynamicKey = wechatTableNativeGridAuxiliarySignature(
			table,
			dynamicRuntime,
		);
		const fixedKey = wechatTableNativeGridAuxiliarySignature(
			table,
			runtimeFor(table, { rules: [cssRule("width:335px;")] }),
		);
		expect(fixedKey).not.toBe(dynamicKey);

		authorRule.style.setProperty("width", "335px");
		expect(table.getBoundingClientRect().width).toBe(335);
		expect(() => guard.assertCurrent()).toThrow(
			"wechat-table-native-grid-source-changed",
		);
	});

	it("leaves a non-target table unchanged through planning and application", () => {
		const table = tableFixture();
		const clone = table.cloneNode(true) as HTMLTableElement;
		clone.setAttribute("style", "display:block");
		const plans = planWechatTableNativeGridForSerialization(
			table,
			new Map([[table, clone]]),
			runtimeFor(table, { pseudo: { display: "inline" } }),
		);

		applyWechatTableNativeGridForSerialization(clone, plans);

		expect(plans).toEqual([]);
		expect(clone.getAttribute("style")).toBe("display:block");
	});
});
