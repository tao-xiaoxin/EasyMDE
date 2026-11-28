import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { cssColorAlpha } from "./wechat-list-table-layout";
import { finiteCssPixelValue } from "./wechat-preview-measurement";
import { pseudoContent } from "./wechat-pseudo-content";
import { appendDeclarations } from "./wechat-style-policy";

const GEOMETRY_EPSILON = 0.01;
const NATIVE_UNORDERED_TYPES = new Set(["circle", "disc", "square", "none"]);
const ASCII_COLLAPSIBLE_WHITESPACE = /^[\t\n\f\r ]*$/u;
const FRAGMENTATION_PROPERTIES = [
	"break-before",
	"break-after",
	"break-inside",
	"column-break-before",
	"column-break-after",
	"column-break-inside",
] as const;
const PROJECTION_STYLE_PROPERTIES = [
	"display",
	"position",
	"float",
	"clear",
	"transform",
	"writing-mode",
	"height",
	"min-height",
	"max-height",
	"padding-top",
	"padding-bottom",
	"border-top-width",
	"border-bottom-width",
	"margin-top",
	"margin-bottom",
	"list-style-type",
	"list-style-position",
	"list-style-image",
	"counter-reset",
	"counter-increment",
	"counter-set",
	"white-space",
	...FRAGMENTATION_PROPERTIES,
] as const;
const PSEUDO_PAINT_PROPERTIES = [
	"content",
	"display",
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"margin-top",
	"margin-bottom",
	"margin-left",
	"border-left-width",
	"border-left-style",
	"border-left-color",
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"background-image",
	"background-color",
	"box-shadow",
	"filter",
	"mask",
	"clip-path",
	"opacity",
	"visibility",
	"overflow",
	"float",
	"transform",
	"writing-mode",
	"mix-blend-mode",
] as const;

type Rect = Readonly<{
	bottom: number;
	left: number;
	top: number;
}>;

type WechatNestedListProjectionGeometry = Readonly<{
	firstChildTop: number;
	lastChildBottom: number;
	ownerRect: Rect;
	wrapperOriginLeft: number;
}>;

export type WechatNestedListProjectionPaint = Readonly<{
	bottom: number;
	color: string;
	left: number;
	top: number;
	width: number;
}>;

export type WechatNestedListProjectionCapture = Readonly<{
	geometry: WechatNestedListProjectionGeometry | null;
	nestedLists: readonly Element[];
	owner: Element;
	paint: WechatNestedListProjectionPaint | null;
	sourceKey: string;
}>;

export type WechatNestedListProjectionCollector = {
	captures: WechatNestedListProjectionCapture[];
};

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function finitePixel(value: string, allowAuto = false): number | null {
	const trimmed = normalized(value);
	if (allowAuto && ("auto" === trimmed || "" === trimmed)) return 0;
	const parsed = finiteCssPixelValue(value);
	if (null === parsed || !Number.isFinite(parsed)) return null;
	return parsed;
}

function requiredPixel(property: string, value: string): number {
	const parsed = finitePixel(value);
	if (null === parsed)
		throw new Error(`wechat-nested-list-projection-${property}-unsupported`);
	return parsed;
}

function styleValue(style: CSSStyleDeclaration, property: string): string {
	return normalized(style.getPropertyValue(property));
}

function styleSignature(
	style: CSSStyleDeclaration | null,
	properties: readonly string[],
): string {
	if (!style) return "unavailable";
	return properties
		.map((property) => `${property}=${styleValue(style, property)}`)
		.join(",");
}

function hasUnsupportedFragmentation(style: CSSStyleDeclaration): boolean {
	return FRAGMENTATION_PROPERTIES.some((property) => {
		const value = styleValue(style, property);
		return Boolean(value && !["auto", "initial", "inherit"].includes(value));
	});
}

function hasUnsupportedDirectText(
	owner: HTMLElement,
	computed: CSSStyleDeclaration,
): boolean {
	return Array.from(owner.childNodes).some((child) => {
		if (3 !== child.nodeType) return false;
		const value = child.nodeValue ?? "";
		if (!value) return false;
		return (
			"normal" !== styleValue(computed, "white-space") ||
			!ASCII_COLLAPSIBLE_WHITESPACE.test(value)
		);
	});
}

function isVisibleColor(value: string): boolean {
	const color = normalized(value);
	if (!color || ["none", "transparent"].includes(color)) return false;
	const alpha = cssColorAlpha(color);
	return null === alpha || alpha > 0;
}

function pseudoIsEmpty(
	source: Element,
	runtime: BrowserWechatClipboardRuntime,
	pseudo: "::before" | "::after",
): boolean {
	return (
		"" ===
		pseudoContent(
			runtime.getComputedStyle(source, pseudo).getPropertyValue("content"),
		)
	);
}

function pseudoIsAbsent(
	source: Element,
	runtime: BrowserWechatClipboardRuntime,
	pseudo: "::before" | "::after",
): boolean {
	return (
		null ===
		pseudoContent(
			runtime.getComputedStyle(source, pseudo).getPropertyValue("content"),
		)
	);
}

function hasUnsupportedPseudo(
	source: Element,
	runtime: BrowserWechatClipboardRuntime,
): boolean {
	return ["::before", "::after"].some(
		(pseudo) =>
			!pseudoIsAbsent(source, runtime, pseudo as "::before" | "::after") &&
			!pseudoIsEmpty(source, runtime, pseudo as "::before" | "::after"),
	);
}

function hasTaskStructure(root: Element): boolean {
	return Boolean(
		root.closest(".task-list, .task-list-item") ||
			root.querySelector(
				".task-list, .task-list-item, .easymde-task-checkbox, input[type=checkbox]",
			),
	);
}

function isOrdinaryUnorderedList(
	list: Element,
	runtime: BrowserWechatClipboardRuntime,
): boolean {
	if ("UL" !== list.tagName || hasTaskStructure(list)) return false;
	const computed = runtime.getComputedStyle(list);
	if (
		"block" !== styleValue(computed, "display") ||
		hasUnsupportedPseudo(list, runtime) ||
		hasUnsupportedFragmentation(computed)
	)
		return false;
	if (!NATIVE_UNORDERED_TYPES.has(styleValue(computed, "list-style-type")))
		return false;
	if ("outside" !== styleValue(computed, "list-style-position")) return false;
	if ("none" !== styleValue(computed, "list-style-image")) return false;
	if (
		"none" !== styleValue(computed, "counter-reset") ||
		"none" !== styleValue(computed, "counter-increment") ||
		"none" !== styleValue(computed, "counter-set") ||
		"horizontal-tb" !== styleValue(computed, "writing-mode")
	)
		return false;
	const children = Array.from(list.children);
	if (!children.length || children.some((child) => "LI" !== child.tagName))
		return false;
	return children.every((child) => {
		const item = runtime.getComputedStyle(child);
		return (
			"list-item" === styleValue(item, "display") &&
			NATIVE_UNORDERED_TYPES.has(styleValue(item, "list-style-type")) &&
			"outside" === styleValue(item, "list-style-position") &&
			"none" === styleValue(item, "list-style-image") &&
			"none" === styleValue(item, "counter-reset") &&
			"none" === styleValue(item, "counter-increment") &&
			"none" === styleValue(item, "counter-set") &&
			"horizontal-tb" === styleValue(item, "writing-mode") &&
			!hasUnsupportedFragmentation(item) &&
			!hasUnsupportedPseudo(child, runtime)
		);
	});
}

function nestedOrdinaryListRoots(
	owner: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
): HTMLElement[] | null {
	if (
		"LI" !== owner.tagName ||
		owner.closest("ol, .task-list, .task-list-item") ||
		hasUnsupportedPseudo(owner, runtime)
	)
		return null;
	const ownerStyle = runtime.getComputedStyle(owner);
	if (
		"list-item" !== styleValue(ownerStyle, "display") ||
		!NATIVE_UNORDERED_TYPES.has(styleValue(ownerStyle, "list-style-type")) ||
		"outside" !== styleValue(ownerStyle, "list-style-position") ||
		"none" !== styleValue(ownerStyle, "list-style-image") ||
		"none" !== styleValue(ownerStyle, "counter-reset") ||
		"none" !== styleValue(ownerStyle, "counter-increment") ||
		"none" !== styleValue(ownerStyle, "counter-set") ||
		"horizontal-tb" !== styleValue(ownerStyle, "writing-mode") ||
		hasUnsupportedFragmentation(ownerStyle)
	)
		return null;
	const parentList = owner.parentElement;
	if (
		!(parentList instanceof HTMLElement) ||
		!isOrdinaryUnorderedList(parentList, runtime)
	)
		return null;
	const roots = Array.from(owner.children).filter(
		(element): element is HTMLElement => "UL" === element.tagName,
	);
	if (!roots.length) return [];
	if (owner.querySelector("ol")) return null;
	if (
		Array.from(owner.querySelectorAll("ul")).some(
			(list) => !roots.some((root) => root === list || root.contains(list)),
		)
	)
		return null;
	for (const root of roots) {
		if (root.closest("ol") || !isOrdinaryUnorderedList(root, runtime))
			return null;
		for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
			if ("OL" === list.tagName || !isOrdinaryUnorderedList(list, runtime))
				return null;
		}
	}
	return roots;
}

function directFlowGeometry(
	owner: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): Readonly<{
	firstChildTop: number;
	lastChildBottom: number;
	ownerRect: Rect;
	wrapperOriginLeft: number;
}> | null {
	const computed = runtime.getComputedStyle(owner);
	if (
		!(["list-item", "block"] as readonly string[]).includes(
			styleValue(computed, "display"),
		) ||
		!["static", "relative"].includes(styleValue(computed, "position")) ||
		"none" !== styleValue(computed, "float") ||
		"none" !== styleValue(computed, "clear") ||
		"none" !== styleValue(computed, "transform") ||
		"horizontal-tb" !== styleValue(computed, "writing-mode")
	)
		return null;
	if (
		("list-item" === styleValue(computed, "display") &&
			"outside" !== styleValue(computed, "list-style-position")) ||
		hasUnsupportedFragmentation(computed) ||
		hasUnsupportedDirectText(owner, computed)
	)
		return null;
	const raw = dimensionSemantics?.getComputedStyle(owner) ?? computed;
	const minHeight = finitePixel(raw.getPropertyValue("min-height"));
	if (
		!["auto", ""].includes(styleValue(raw, "height")) ||
		null === minHeight ||
		0 !== minHeight ||
		"none" !== styleValue(raw, "max-height")
	)
		return null;
	for (const property of [
		"padding-top",
		"padding-bottom",
		"border-top-width",
		"border-bottom-width",
	]) {
		if (0 !== requiredPixel(property, computed.getPropertyValue(property)))
			return null;
	}
	const ownerRect = owner.getBoundingClientRect();
	if (
		![
			ownerRect.left,
			ownerRect.top,
			ownerRect.bottom,
			ownerRect.width,
			ownerRect.height,
		].every((value) => Number.isFinite(value)) ||
		ownerRect.height <= 0
	)
		return null;
	const children = Array.from(owner.children);
	if (!children.length) return null;
	let previousBottom = Number.NEGATIVE_INFINITY;
	for (const child of children) {
		const childStyle = runtime.getComputedStyle(child);
		if (
			!["block", "list-item"].includes(styleValue(childStyle, "display")) ||
			"static" !== styleValue(childStyle, "position") ||
			"none" !== styleValue(childStyle, "float") ||
			"none" !== styleValue(childStyle, "clear") ||
			"none" !== styleValue(childStyle, "transform") ||
			"horizontal-tb" !== styleValue(childStyle, "writing-mode") ||
			hasUnsupportedFragmentation(childStyle) ||
			hasUnsupportedPseudo(child, runtime)
		)
			return null;
		if (
			"list-item" === styleValue(childStyle, "display") &&
			"outside" !== styleValue(childStyle, "list-style-position")
		)
			return null;
		const marginTop = finitePixel(childStyle.getPropertyValue("margin-top"));
		const marginBottom = finitePixel(
			childStyle.getPropertyValue("margin-bottom"),
		);
		if (
			null === marginTop ||
			null === marginBottom ||
			marginTop < 0 ||
			marginBottom < 0
		)
			return null;
		const rect = child.getBoundingClientRect();
		if (
			![rect.top, rect.bottom, rect.height].every((value) =>
				Number.isFinite(value),
			) ||
			rect.height <= 0 ||
			rect.top + GEOMETRY_EPSILON < previousBottom
		)
			return null;
		previousBottom = rect.bottom;
	}
	const borderLeft = requiredPixel(
		"border-left-width",
		computed.getPropertyValue("border-left-width"),
	);
	const paddingLeft = requiredPixel(
		"padding-left",
		computed.getPropertyValue("padding-left"),
	);
	const lastChild = children[children.length - 1];
	return {
		firstChildTop: children[0]?.getBoundingClientRect().top ?? Number.NaN,
		lastChildBottom: lastChild?.getBoundingClientRect().bottom ?? Number.NaN,
		ownerRect: {
			bottom: ownerRect.bottom,
			left: ownerRect.left,
			top: ownerRect.top,
		},
		wrapperOriginLeft: ownerRect.left + borderLeft + paddingLeft,
	};
}

function captureStemPaint(
	owner: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	ownerRect: Rect,
	wrapperOriginLeft: number,
): WechatNestedListProjectionPaint | null {
	const computed = runtime.getComputedStyle(owner);
	if ("relative" !== styleValue(computed, "position")) return null;
	const pseudo = runtime.getComputedStyle(owner, "::before");
	if (!pseudoIsEmpty(owner, runtime, "::before")) return null;
	if (
		"absolute" !== styleValue(pseudo, "position") ||
		"block" !== styleValue(pseudo, "display") ||
		"none" !== styleValue(pseudo, "float") ||
		"none" !== styleValue(pseudo, "transform") ||
		"horizontal-tb" !== styleValue(pseudo, "writing-mode") ||
		"visible" !== styleValue(pseudo, "visibility") ||
		"visible" !== styleValue(pseudo, "overflow") ||
		"none" !== styleValue(pseudo, "background-image") ||
		isVisibleColor(pseudo.getPropertyValue("background-color")) ||
		"none" !== styleValue(pseudo, "box-shadow") ||
		"none" !== styleValue(pseudo, "filter") ||
		"none" !== styleValue(pseudo, "mask") ||
		"none" !== styleValue(pseudo, "clip-path") ||
		"normal" !== styleValue(pseudo, "mix-blend-mode") ||
		"1" !== styleValue(pseudo, "opacity") ||
		!isVisibleColor(pseudo.getPropertyValue("border-left-color")) ||
		"solid" !== styleValue(pseudo, "border-left-style")
	)
		return null;
	for (const side of ["top", "right", "bottom"] as const) {
		if (
			!["none", "hidden"].includes(
				styleValue(pseudo, `border-${side}-style`),
			) &&
			0 !==
				requiredPixel(
					`border-${side}-width`,
					pseudo.getPropertyValue(`border-${side}-width`),
				)
		)
			return null;
	}
	const top = finitePixel(pseudo.getPropertyValue("top"));
	const bottom = finitePixel(pseudo.getPropertyValue("bottom"));
	const left = finitePixel(pseudo.getPropertyValue("left"));
	const marginTop = finitePixel(pseudo.getPropertyValue("margin-top"));
	const marginBottom = finitePixel(pseudo.getPropertyValue("margin-bottom"));
	const marginLeft = finitePixel(pseudo.getPropertyValue("margin-left"));
	const width = finitePixel(pseudo.getPropertyValue("border-left-width"));
	if (
		null === top ||
		null === bottom ||
		null === left ||
		null === marginTop ||
		null === marginBottom ||
		null === marginLeft ||
		null === width ||
		width <= 0
	)
		return null;
	const borderTop = requiredPixel(
		"border-top-width",
		computed.getPropertyValue("border-top-width"),
	);
	const borderBottom = requiredPixel(
		"border-bottom-width",
		computed.getPropertyValue("border-bottom-width"),
	);
	const paintTop = ownerRect.top + borderTop + top + marginTop;
	const paintBottom = ownerRect.bottom - borderBottom - bottom - marginBottom;
	const paintLeft =
		ownerRect.left +
		requiredPixel(
			"border-left-width",
			computed.getPropertyValue("border-left-width"),
		) +
		left +
		marginLeft;
	if (
		!Number.isFinite(paintTop) ||
		!Number.isFinite(paintBottom) ||
		paintBottom <= paintTop
	)
		return null;
	if (!Number.isFinite(wrapperOriginLeft)) return null;
	return {
		bottom: paintBottom,
		color: pseudo.getPropertyValue("border-left-color").trim(),
		left: paintLeft,
		top: paintTop,
		width,
	};
}

function projectionSourceKey(
	owner: HTMLElement,
	roots: readonly HTMLElement[],
	geometry: WechatNestedListProjectionGeometry | null,
	paint: WechatNestedListProjectionPaint | null,
	runtime: BrowserWechatClipboardRuntime,
	rawOwnerStyle: CSSStyleDeclaration | null,
): string {
	const ownerRect = geometry?.ownerRect ?? null;
	const childEdges = Array.from(owner.children).map((child) => {
		const computed = runtime.getComputedStyle(child);
		const rect = geometry ? child.getBoundingClientRect() : null;
		return [
			child.tagName,
			styleSignature(computed, PROJECTION_STYLE_PROPERTIES),
			Array.from(child.childNodes)
				.filter((node) => 3 === node.nodeType)
				.map((node) =>
					ASCII_COLLAPSIBLE_WHITESPACE.test(node.nodeValue ?? "")
						? "ascii-whitespace"
						: "authored-text",
				)
				.join("\u0001"),
			ownerRect && rect ? rect.top - ownerRect.top : "unmeasured",
			ownerRect && rect ? rect.bottom - ownerRect.top : "unmeasured",
		].join(":");
	});
	const listTerms = roots
		.flatMap((root) => [root, ...Array.from(root.querySelectorAll("ul, li"))])
		.map((list) => {
			const computed = runtime.getComputedStyle(list);
			return [
				list.tagName,
				styleSignature(computed, PROJECTION_STYLE_PROPERTIES),
			].join(":");
		});
	const pseudoTerms = ["::before", "::after"].map((pseudo) =>
		styleSignature(
			runtime.getComputedStyle(owner, pseudo),
			PSEUDO_PAINT_PROPERTIES,
		),
	);
	const paintTerm = paint
		? [
				geometry ? paint.left - geometry.wrapperOriginLeft : "unmeasured",
				geometry ? paint.top - geometry.firstChildTop : "unmeasured",
				geometry ? geometry.lastChildBottom - paint.bottom : "unmeasured",
				paint.width,
				paint.color,
			].join(",")
		: "none";
	const geometryTerm = geometry
		? [
				geometry.firstChildTop - geometry.ownerRect.top,
				geometry.lastChildBottom - geometry.ownerRect.top,
				geometry.wrapperOriginLeft - geometry.ownerRect.left,
			].join(",")
		: "none";
	return [
		"easymde-nested-list-projection-v1",
		styleSignature(
			runtime.getComputedStyle(owner),
			PROJECTION_STYLE_PROPERTIES,
		),
		styleSignature(rawOwnerStyle, ["height", "min-height", "max-height"]),
		pseudoTerms.join("|"),
		listTerms.join("|"),
		geometryTerm,
		childEdges.join("|"),
		paintTerm,
	].join(";");
}

export function captureNestedOrdinaryListProjection(
	source: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
): WechatNestedListProjectionCapture | null {
	const roots = nestedOrdinaryListRoots(source, runtime);
	if (!roots?.length) return null;
	const geometry = directFlowGeometry(source, runtime, dimensionSemantics);
	const rawOwnerStyle = geometry
		? (dimensionSemantics?.getComputedStyle(source) ??
			runtime.getComputedStyle(source))
		: null;
	const paint = geometry
		? captureStemPaint(
				source,
				runtime,
				geometry.ownerRect,
				geometry.wrapperOriginLeft,
			)
		: null;
	return {
		geometry,
		nestedLists: roots,
		owner: source,
		paint,
		sourceKey: projectionSourceKey(
			source,
			roots,
			geometry,
			paint,
			runtime,
			rawOwnerStyle,
		),
	};
}

export function collectNestedOrdinaryListProjection(
	source: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	collector: WechatNestedListProjectionCollector,
): void {
	const capture = captureNestedOrdinaryListProjection(
		source,
		runtime,
		dimensionSemantics,
	);
	if (capture) collector.captures.push(capture);
}

export function nestedOrdinaryListProjectionSignature(
	source: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
): string {
	return (
		captureNestedOrdinaryListProjection(source, runtime, dimensionSemantics)
			?.sourceKey ?? ""
	);
}

function resolveReplacement(element: Element): Element {
	let current = element;
	const visited = new Set<Element>();
	while (true) {
		if (visited.has(current))
			throw new Error("wechat-nested-list-projection-replacement-cycle");
		visited.add(current);
		const replacement = WECHAT_STRUCTURE_REPLACEMENTS.get(current);
		if (!replacement) return current;
		current = replacement;
	}
}

function replacementSources(
	captures: readonly WechatNestedListProjectionCapture[],
): Element[] {
	const roots = Array.from(
		new Set(captures.flatMap((capture) => capture.nestedLists)),
	);
	return roots.filter(
		(root) =>
			!roots.some(
				(candidate) => candidate !== root && candidate.contains(root),
			),
	);
}

function structuralSources(root: Element): Element[] {
	return [root, ...Array.from(root.querySelectorAll("ul, li"))];
}

function depth(element: Element): number {
	let result = 0;
	let current = element.parentElement;
	while (current) {
		result += 1;
		current = current.parentElement;
	}
	return result;
}

function generatedBeforeMarker(
	owner: Element,
	finalOwner: Element,
): HTMLElement {
	const markers = Array.from(finalOwner.querySelectorAll("*")).filter(
		(element): element is HTMLElement => {
			const record = GENERATED_PSEUDO_CLONE_OWNERS.get(element);
			return record?.owner === owner && "::before" === record.pseudo;
		},
	);
	if (1 !== markers.length || markers[0]?.parentElement !== finalOwner)
		throw new Error("wechat-nested-list-projection-marker-missing");
	return markers[0];
}

function wrapperPaintDeclarations(
	owner: WechatNestedListProjectionCapture,
	paint: WechatNestedListProjectionPaint,
): string[] {
	const geometry = owner.geometry;
	if (!geometry)
		throw new Error("wechat-nested-list-projection-paint-geometry-missing");
	const left = paint.left - geometry.wrapperOriginLeft;
	const gutter = Math.max(0, -left);
	const x = left + gutter;
	const top = paint.top - geometry.firstChildTop;
	const bottom = geometry.lastChildBottom - paint.bottom;
	if (
		![left, gutter, x, top, bottom, paint.width].every(Number.isFinite) ||
		top < -GEOMETRY_EPSILON ||
		bottom < -GEOMETRY_EPSILON
	)
		throw new Error("wechat-nested-list-projection-paint-geometry-invalid");
	const normalizedTop = Math.max(0, top);
	const normalizedBottom = Math.max(0, bottom);
	return [
		"display:block",
		"width:auto",
		"height:auto",
		"box-sizing:border-box",
		"border:0",
		"margin-top:0",
		"margin-right:0",
		`margin-left:${-gutter}px`,
		"margin-bottom:0",
		"padding-top:0",
		"padding-right:0",
		`padding-left:${gutter}px`,
		"padding-bottom:0",
		`background-image:linear-gradient(transparent ${normalizedTop + normalizedBottom}px, ${paint.color} ${normalizedTop + normalizedBottom}px)`,
		`background-position:${x}px ${-normalizedBottom}px`,
		`background-size:${paint.width}px 100%`,
		"background-repeat:no-repeat",
		"background-origin:border-box",
		"background-clip:border-box",
	];
}

export function applyNestedOrdinaryListProjection(
	root: HTMLElement,
	captures: readonly WechatNestedListProjectionCapture[],
	cloneIdentity: ReadonlyMap<Element, Element>,
): void {
	if (!captures.length) return;
	const roots = replacementSources(captures);
	const replacementEntries = roots
		.flatMap((sourceRoot) => structuralSources(sourceRoot))
		.map((source) => {
			const clone = cloneIdentity.get(source);
			if (!clone || !root.contains(clone))
				throw new Error("wechat-nested-list-projection-clone-missing");
			return { clone, source };
		})
		.filter(
			(entry, index, entries) =>
				entries.findIndex((candidate) => candidate.clone === entry.clone) ===
				index,
		)
		.sort((left, right) => depth(right.source) - depth(left.source));
	const owners = Array.from(
		new Map(captures.map((capture) => [capture.owner, capture])).values(),
	);
	const ownerBindings = owners.map((capture) => {
		const originalOwner = cloneIdentity.get(capture.owner);
		if (!originalOwner || !root.contains(originalOwner))
			throw new Error("wechat-nested-list-projection-owner-missing");
		const finalOwner = resolveReplacement(originalOwner);
		if (!root.contains(finalOwner))
			throw new Error("wechat-nested-list-projection-final-owner-missing");
		const marker = capture.paint
			? generatedBeforeMarker(originalOwner, finalOwner)
			: null;
		const declarations = capture.paint
			? wrapperPaintDeclarations(capture, capture.paint)
			: null;
		return { capture, declarations, marker, originalOwner };
	});
	replacementEntries.forEach(({ clone }) => {
		if (WECHAT_STRUCTURE_REPLACEMENTS.has(clone))
			throw new Error(
				"wechat-nested-list-projection-replacement-already-bound",
			);
	});

	replacementEntries.forEach(({ clone, source }) => {
		const section = root.ownerDocument.createElement("section");
		Array.from(clone.attributes).forEach((attribute) => {
			section.setAttribute(attribute.name, attribute.value);
		});
		section.setAttribute("role", "LI" === source.tagName ? "listitem" : "list");
		while (clone.firstChild) section.appendChild(clone.firstChild);
		clone.replaceWith(section);
		WECHAT_STRUCTURE_REPLACEMENTS.set(clone, section);
	});

	ownerBindings
		.sort(
			(left, right) => depth(right.capture.owner) - depth(left.capture.owner),
		)
		.forEach(({ capture, declarations, marker, originalOwner }) => {
			if (!capture.paint) return;
			if (!marker)
				throw new Error("wechat-nested-list-projection-marker-missing");
			const finalOwner = resolveReplacement(originalOwner);
			const finalMarker = generatedBeforeMarker(originalOwner, finalOwner);
			if (finalMarker !== marker)
				throw new Error("wechat-nested-list-projection-marker-moved");
			const wrapper = root.ownerDocument.createElement("section");
			if (!declarations)
				throw new Error("wechat-nested-list-projection-paint-missing");
			appendDeclarations(wrapper, declarations);
			finalMarker.remove();
			while (finalOwner.firstChild) wrapper.appendChild(finalOwner.firstChild);
			finalOwner.appendChild(wrapper);
		});
}
