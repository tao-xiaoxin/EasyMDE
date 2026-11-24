/**
 * Shared contracts, constants, errors, and frozen-node predicates for bounded
 * KaTeX vertical-list static-flow normalization.
 */

export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const GEOMETRY_QUANTUM = 1 / 64;
export const PSEUDO_ELEMENTS = ["::before", "::after"] as const;
export const PHYSICAL_INSETS = ["top", "right", "bottom", "left"] as const;
export const LOGICAL_INSETS = [
	"inset-block-start",
	"inset-block-end",
	"inset-inline-start",
	"inset-inline-end",
] as const;
export const HOLDER_EDGE_PROPERTIES = [
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
] as const;
const ROW_EDGE_PROPERTIES = [
	...HOLDER_EDGE_PROPERTIES,
	"top",
	"right",
	"bottom",
	"left",
] as const;
export const ROW_NON_HORIZONTAL_EDGE_PROPERTIES = [
	"margin-top",
	"margin-bottom",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
] as const;
export const ROW_HORIZONTAL_MARGIN_PROPERTIES = [
	"margin-left",
	"margin-right",
] as const;
const BORDER_STYLE_PROPERTIES = [
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"border-left-style",
] as const;
const BORDER_COLOR_PROPERTIES = [
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
] as const;
const LAYOUT_SAFETY_PROPERTIES = [
	"float",
	"clear",
	"transform",
	"translate",
	"rotate",
	"scale",
	"contain",
	"container-type",
	"content-visibility",
	"will-change",
	"perspective",
	"overflow-x",
	"overflow-y",
] as const;
const PAINT_SAFETY_PROPERTIES = [
	"filter",
	"backdrop-filter",
	"clip",
	"clip-path",
	"mask",
	"mix-blend-mode",
	"background-image",
	"box-shadow",
] as const;
export const CAPTURE_STYLE_PROPERTIES = [
	"display",
	"position",
	"height",
	"width",
	"vertical-align",
	"box-sizing",
	"writing-mode",
	...BORDER_STYLE_PROPERTIES,
	...BORDER_COLOR_PROPERTIES,
	"z-index",
	"animation-name",
	"animation-duration",
	"transition-property",
	"transition-duration",
	...ROW_EDGE_PROPERTIES,
	...LOGICAL_INSETS,
	...LAYOUT_SAFETY_PROPERTIES,
	...PAINT_SAFETY_PROPERTIES,
] as const;
export const TYPED_DIMENSION_PROPERTIES = [
	"height",
	"block-size",
	"width",
	"inline-size",
	"top",
	"bottom",
	"left",
	"right",
	...LOGICAL_INSETS,
] as const;
const CSS_PIXEL =
	/^([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)px$/iu;
const TYPED_PIXEL =
	/^px:([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)$/u;
const TYPED_PERCENT =
	/^percent:([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)$/u;

export type WechatMathStaticFlowErrorCode =
	| "animation-read-failed"
	| "apply-detached"
	| "apply-duplicate-target"
	| "apply-parent-mismatch"
	| "apply-rollback-failed"
	| "apply-style-rejected"
	| "cancelled"
	| "identity-mismatch"
	| "identity-missing"
	| "identity-outside-root"
	| "node-unobserved"
	| "root-mismatch"
	| "signature-missing"
	| "stale";

export class WechatMathStaticFlowError extends Error {
	readonly code: string;

	constructor(code: WechatMathStaticFlowErrorCode, cause?: unknown) {
		super(
			`wechat-math-static-flow-${code}`,
			cause === undefined ? undefined : { cause },
		);
		this.name = "WechatMathStaticFlowError";
		this.code = `wechat-math-static-flow-${code}`;
	}
}

export type WechatMathStaticFlowGate = Readonly<{
	isCancelled: () => boolean;
	isCurrent: () => boolean;
	signal?: AbortSignal;
}>;

export type WechatMathStaticFlowTypedStyleMap = Readonly<{
	get: (property: string) => unknown;
}>;

export type WechatMathStaticFlowRect = Readonly<{
	bottom: number;
	height: number;
	left: number;
	right: number;
	top: number;
	width: number;
}>;

export type WechatMathStaticFlowRuntime = Readonly<{
	getAnimations: () => readonly Animation[];
	getComputedStyle: (
		element: Element,
		pseudoElement?: string,
	) => CSSStyleDeclaration;
	getRect: (element: Element) => WechatMathStaticFlowRect;
	getTypedStyleMap: (element: Element) => WechatMathStaticFlowTypedStyleMap;
}>;

export type WechatMathRectEvidence = Readonly<{
	epochId: number;
	rawRect: WechatMathStaticFlowRect;
	rootRectAtEpoch: WechatMathStaticFlowRect;
}>;

export type WechatMathFrozenNode = Readonly<{
	animationIntersects: boolean;
	key: string;
	classList: ReadonlySet<string>;
	element: Element;
	holderTextFlag: boolean;
	localName: string;
	namespaceURI: string;
	orderedChildren: readonly Element[];
	parent: Element | null;
	hasChildNodes: boolean;
	pseudos: Readonly<
		Record<
			(typeof PSEUDO_ELEMENTS)[number],
			Readonly<{ content: string; position: string }>
		>
	>;
	rectEvidence: WechatMathRectEvidence;
	styles: Readonly<Record<string, string>>;
	typedTokens: Readonly<Record<string, string>>;
}>;

export type WechatMathTopologyContext = Readonly<{
	ancestorClassLists?: ReadonlyMap<Element, ReadonlySet<string>>;
	ancestorParents?: ReadonlyMap<Element, Element | null>;
	getNode: (element: Element) => WechatMathFrozenNode | undefined;
	observedSequence: readonly Element[];
	sourceRoot: Element;
}>;

export type WechatMathSourceRowAdmission = Readonly<{
	pstrutSource: Element;
	rawTop: string;
	source: Element;
	top: number;
}>;

export type WechatMathSourceSvgAdmission = Readonly<{
	sourceChain: readonly Element[];
	sourceHolder: Element;
	sourceRow: Element;
	sourceSvg: SVGSVGElement;
}>;

export type WechatMathSourceEmptyTransportAdmission = Readonly<{
	source: Element;
	sourceBoxSizing: "border-box" | "content-box";
}>;

export type WechatMathSourceGroupAdmission = Readonly<{
	evidence: string;
	reason: string | null;
	rows: readonly WechatMathSourceRowAdmission[];
	emptyTransport: readonly WechatMathSourceEmptyTransportAdmission[];
	source: Element;
	svgTransitions: readonly WechatMathSourceSvgAdmission[];
}>;

export type WechatMathSourceAdmissionWitness = Readonly<{
	groups: readonly Readonly<{
		reason: string | null;
		source: string;
	}>[];
	orderedObserved: readonly string[];
	rows: readonly Readonly<{
		rawTop: string;
		source: string;
		top: number;
	}>[];
	svg: readonly Readonly<{
		holder: string;
		row: string;
		svg: string;
	}>[];
	version: 1;
}>;

export type WechatMathSourceAdmissionResult = Readonly<{
	groups: readonly WechatMathSourceGroupAdmission[];
	sourceNodes: ReadonlyMap<Element, WechatMathFrozenNode>;
	sourceRoot: Element;
	topology: WechatMathTopologyContext;
	witness: WechatMathSourceAdmissionWitness;
	witnessSignature: string;
}>;

export type CapturedRow = Readonly<{
	clone: Element;
	cloneParent: Element;
	pstrutClone: Element;
	pstrutSource: Element;
	rawTop: string;
	source: Element;
	top: number;
}>;

export type CapturedSvgTransition = Readonly<{
	cloneChain: readonly Element[];
	cloneHolder: Element;
	cloneRow: Element;
	cloneSvg: SVGSVGElement;
	sourceHolder: Element;
	sourceRow: Element;
	sourceSvg: SVGSVGElement;
}>;

export type CapturedEmptyTransport = Readonly<{
	clone: Element;
	cloneParent: Element;
	source: Element;
	sourceBoxSizing: "border-box" | "content-box";
}>;

export type CapturedGroup = Readonly<{
	clone: Element;
	evidence: string;
	reason: string | null;
	rows: readonly CapturedRow[];
	emptyTransport: readonly CapturedEmptyTransport[];
	source: Element;
	svgTransitions: readonly CapturedSvgTransition[];
}>;

export type WechatMathStaticFlowSnapshot = Readonly<{
	cloneRoot: Element;
	groups: readonly CapturedGroup[];
	liveSourceAdmissionSignature: string;
	rawDimensionGeometrySignature: string;
	signature: string;
	sourceRoot: Element;
	version: 1;
}>;

export type WechatMathStaticFlowSvgTransition = Readonly<{
	cloneChain: readonly Element[];
	cloneHolder: Element;
	cloneRow: Element;
	cloneSvg: SVGSVGElement;
	sourceHolder: Element;
	sourceRow: Element;
	sourceSvg: SVGSVGElement;
}>;

export type WechatMathStaticFlowRowTransition = Readonly<{
	clone: Element;
	cloneParent: Element;
	pstrutClone: Element;
	rawTop: string;
	source: Element;
	top: number;
}>;

export type WechatMathStaticFlowRejectedGroup = Readonly<{
	reason: string;
	source: Element;
}>;

export type WechatMathStaticFlowPlan = Readonly<{
	cloneRoot: Element;
	emptyTransportTransitions: readonly WechatMathStaticFlowEmptyTransportTransition[];
	rejectedGroups: readonly WechatMathStaticFlowRejectedGroup[];
	rowTransitions: readonly WechatMathStaticFlowRowTransition[];
	snapshotSignature: string;
	svgTransitions: readonly WechatMathStaticFlowSvgTransition[];
}>;

export type WechatMathStaticFlowEmptyTransportTransition = Readonly<{
	clone: Element;
	cloneParent: Element;
	source: Element;
	sourceBoxSizing: "border-box" | "content-box";
}>;

export type WechatMathStaticFlowCaptureOptions = Readonly<{
	cloneIdentityFor: (source: Element) => Element | null;
	cloneRoot: Element;
	gate: WechatMathStaticFlowGate;
	liveSourceAdmissionSignature: string;
	rawDimensionGeometrySignature: string;
	runtime: WechatMathStaticFlowRuntime;
	sourceAdmission?: WechatMathSourceAdmissionResult;
	sourceRoot: Element;
}>;

export type WechatMathStaticFlowPlanOptions = Readonly<{
	gate: WechatMathStaticFlowGate;
}>;

export type WechatMathStaticFlowApplyOptions = Readonly<{
	cloneRoot?: Element;
	gate: WechatMathStaticFlowGate;
}>;

function isDOMNode(value: unknown): boolean {
	if (null === value || typeof value !== "object") return false;
	if (typeof Node !== "undefined" && value instanceof Node) return true;
	return (
		"nodeType" in value &&
		typeof (value as { nodeType: unknown }).nodeType === "number"
	);
}

export function freezeMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
	const copy = new Map(source);
	Object.defineProperties(copy, {
		clear: {
			configurable: false,
			enumerable: false,
			value: () => {
				throw new TypeError("Map is read-only");
			},
		},
		delete: {
			configurable: false,
			enumerable: false,
			value: () => {
				throw new TypeError("Map is read-only");
			},
		},
		set: {
			configurable: false,
			enumerable: false,
			value: () => {
				throw new TypeError("Map is read-only");
			},
		},
	});
	return Object.freeze(copy);
}

export function deepFreezePlainRecord<T>(value: T): T {
	if (null === value || typeof value !== "object") return value;
	if (isDOMNode(value)) return value;
	if (Object.isFrozen(value)) return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			deepFreezePlainRecord(item);
		}
		return Object.freeze(value) as T;
	}
	for (const key of Object.keys(value)) {
		const propertyValue = (value as Record<string, unknown>)[key];
		if (null !== propertyValue && typeof propertyValue === "object") {
			deepFreezePlainRecord(propertyValue);
		}
	}
	return Object.freeze(value) as T;
}

export function flowError(
	code: WechatMathStaticFlowErrorCode,
	cause?: unknown,
): WechatMathStaticFlowError {
	return new WechatMathStaticFlowError(code, cause);
}

export function assertGate(gate: WechatMathStaticFlowGate): void {
	if (gate.signal?.aborted || gate.isCancelled()) throw flowError("cancelled");
	if (!gate.isCurrent()) throw flowError("stale");
}

export function finitePixel(value: string): number | null {
	const match = CSS_PIXEL.exec(value.trim());
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
}

export function typedToken(value: unknown): string {
	if (!value || "object" !== typeof value) return "unknown";
	const record = value as Readonly<{
		unit?: unknown;
		value?: unknown;
		text?: unknown;
		toString?: () => string;
	}>;
	if ("string" === typeof record.value) {
		const keyword = record.value.trim().toLowerCase();
		return keyword ? `keyword:${keyword}` : "unknown";
	}
	if ("number" !== typeof record.value || !Number.isFinite(record.value)) {
		if ("function" === typeof record.toString) {
			try {
				const text = record.toString().trim().toLowerCase();
				if (text) return `text:${text}`;
			} catch {
				// Fall through
			}
		}
		return "unknown";
	}
	if ("percent" === record.unit) return `percent:${record.value}`;
	if ("number" === record.unit) return `number:${record.value}`;
	if ("string" === typeof record.unit && record.unit.trim())
		return `${record.unit.trim().toLowerCase()}:${record.value}`;
	return "unknown";
}

function typedPixel(token: string | undefined): number | null {
	if (!token) return null;
	const match = TYPED_PIXEL.exec(token);
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
}

function typedPercent(token: string | undefined): number | null {
	if (!token) return null;
	const match = TYPED_PERCENT.exec(token);
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
}

export function near(
	left: number,
	right: number,
	quantum = GEOMETRY_QUANTUM,
): boolean {
	return Math.abs(left - right) <= quantum;
}

export function sameRect(
	left: WechatMathStaticFlowRect,
	right: WechatMathStaticFlowRect,
): boolean {
	return (["bottom", "height", "left", "right", "top", "width"] as const).every(
		(property) => near(left[property], right[property]),
	);
}

export function rectIsFinite(rect: WechatMathStaticFlowRect): boolean {
	return (["bottom", "height", "left", "right", "top", "width"] as const).every(
		(property) => Number.isFinite(rect[property]),
	);
}

export function elementKey(element: Element): string {
	const className =
		"svg" === element.localName.toLowerCase()
			? (element as SVGElement).className.baseVal
			: (element as HTMLElement).className;
	return `${element.namespaceURI ?? ""}|${element.localName.toLowerCase()}|${className}`;
}

function animationTargetFor(animation: Animation): Element | null {
	try {
		const effect = animation.effect;
		if (!effect || "object" !== typeof effect) return null;
		const target = (effect as KeyframeEffect).target;
		return target instanceof Element ? target : null;
	} catch (error: unknown) {
		throw flowError("animation-read-failed", error);
	}
}

export function animationIntersects(
	element: Element,
	animations: readonly Animation[],
): boolean {
	return animations.some((animation) => {
		const target = animationTargetFor(animation);
		return Boolean(
			target &&
				(target === element ||
					target.contains(element) ||
					element.contains(target)),
		);
	});
}

export function pseudoContentIsAbsent(rawContent: string): boolean {
	const trimmed = rawContent.trim().toLowerCase();
	return !trimmed || "none" === trimmed || "normal" === trimmed;
}

export function nodeStyleValue(
	node: WechatMathFrozenNode,
	property: string,
): string {
	return node.styles[property] ?? "";
}

export function nodeStylePixels(
	node: WechatMathFrozenNode,
	property: string,
): number | null {
	return finitePixel(nodeStyleValue(node, property));
}

export function nodeStyleIs(
	node: WechatMathFrozenNode,
	property: string,
	expected: string,
): boolean {
	return nodeStyleValue(node, property) === expected;
}

export function nodeStyleIn(
	node: WechatMathFrozenNode,
	property: string,
	expected: readonly string[],
): boolean {
	return expected.includes(nodeStyleValue(node, property));
}

export function nodeStyleZero(
	node: WechatMathFrozenNode,
	property: string,
): boolean {
	return 0 === nodeStylePixels(node, property);
}

export function nodeStyleAllZero(
	node: WechatMathFrozenNode,
	properties: readonly string[],
): boolean {
	return properties.every((property) => nodeStyleZero(node, property));
}

export function nodeTypedPixel(
	node: WechatMathFrozenNode,
	property: string,
): number | null {
	return typedPixel(node.typedTokens[property]);
}

export function nodeTypedPercent(
	node: WechatMathFrozenNode,
	property: string,
): number | null {
	return typedPercent(node.typedTokens[property]);
}

export function nodeTypedKeywordAuto(
	node: WechatMathFrozenNode,
	property: string,
): boolean {
	return "keyword:auto" === node.typedTokens[property];
}

export function nodeSafeLayoutAndPaint(node: WechatMathFrozenNode): boolean {
	if (
		!nodeStyleIn(node, "float", ["none"]) ||
		!nodeStyleIn(node, "clear", ["none"]) ||
		!nodeStyleIn(node, "transform", ["none"]) ||
		!nodeStyleIn(node, "translate", ["none"]) ||
		!nodeStyleIn(node, "rotate", ["none"]) ||
		!nodeStyleIn(node, "scale", ["none"]) ||
		!nodeStyleIn(node, "contain", ["none"]) ||
		!nodeStyleIn(node, "container-type", ["normal"]) ||
		!nodeStyleIn(node, "content-visibility", ["visible"]) ||
		!nodeStyleIn(node, "will-change", ["auto"]) ||
		!nodeStyleIn(node, "perspective", ["none"]) ||
		!nodeStyleIn(node, "filter", ["none"]) ||
		!nodeStyleIn(node, "backdrop-filter", ["none"]) ||
		!nodeStyleIn(node, "clip", ["auto"]) ||
		!nodeStyleIn(node, "clip-path", ["none"]) ||
		!nodeStyleIn(node, "mask", ["none"]) ||
		!nodeStyleIn(node, "mix-blend-mode", ["normal"]) ||
		!nodeStyleIn(node, "background-image", ["none"]) ||
		!nodeStyleIn(node, "box-shadow", ["none"]) ||
		!nodeStyleIn(node, "writing-mode", ["horizontal-tb"]) ||
		!nodeStyleIn(node, "animation-name", ["none"]) ||
		!nodeStyleIn(node, "z-index", ["auto"])
	)
		return false;
	const durations = nodeStyleValue(node, "transition-duration")
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
	return durations.every((duration) => "0s" === duration || "0ms" === duration);
}

export function nodeSafePseudo(node: WechatMathFrozenNode): boolean {
	return PSEUDO_ELEMENTS.every((pseudoElement) =>
		pseudoContentIsAbsent(node.pseudos[pseudoElement]?.content ?? ""),
	);
}

export function nodeVisibleOverflow(node: WechatMathFrozenNode): boolean {
	return (
		nodeStyleIs(node, "overflow-x", "visible") &&
		nodeStyleIs(node, "overflow-y", "visible")
	);
}

function nodeBorderColorIsTransparent(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized || normalized === "transparent") return true;
	const rgba = normalized.match(
		/^rgba\(\s*[^,]+\s*,\s*[^,]+\s*,\s*[^,]+\s*,\s*([\d.]+)\s*\)$/u,
	);
	return Boolean(rgba && Number.parseFloat(rgba[1] ?? "1") <= 0);
}

export function nodeHasPaintedBorder(node: WechatMathFrozenNode): boolean {
	return HOLDER_EDGE_PROPERTIES.some((property) => {
		if (!property.startsWith("border-") || !property.endsWith("-width"))
			return false;
		const side = property.slice("border-".length, -"-width".length);
		const width = nodeStylePixels(node, property);
		return (
			null !== width &&
			width > 0 &&
			!["none", "hidden"].includes(
				nodeStyleValue(node, `border-${side}-style`),
			) &&
			!nodeBorderColorIsTransparent(
				nodeStyleValue(node, `border-${side}-color`),
			)
		);
	});
}

export function nodeSvgOverflowIsSafe(node: WechatMathFrozenNode): boolean {
	return (
		["visible", "hidden", "clip"].includes(
			nodeStyleValue(node, "overflow-x"),
		) &&
		["visible", "hidden", "clip"].includes(nodeStyleValue(node, "overflow-y"))
	);
}

export function nodeEstablishesACB(node: WechatMathFrozenNode): boolean {
	if (!nodeStyleIn(node, "position", ["static"])) return true;
	for (const prop of [
		"transform",
		"translate",
		"rotate",
		"scale",
		"perspective",
		"filter",
		"backdrop-filter",
	] as const) {
		if ((node.styles[prop] ?? "none") !== "none") return true;
	}
	if ((node.styles["container-type"] ?? "normal") !== "normal") return true;
	if ((node.styles.contain ?? "none") !== "none") return true;
	const willChange = node.styles["will-change"] ?? "auto";
	if (willChange !== "auto") {
		const tokens = willChange.split(",").map((t) => t.trim());
		if (
			tokens.some((t) =>
				[
					"transform",
					"filter",
					"perspective",
					"contain",
					"container-type",
				].includes(t),
			)
		) {
			return true;
		}
	}
	return false;
}

export function nodeEvidenceSignature(node: WechatMathFrozenNode): string {
	return JSON.stringify({
		animation: node.animationIntersects,
		hasChildNodes: node.hasChildNodes,
		pseudo: Object.fromEntries(
			PSEUDO_ELEMENTS.map((pseudo) => [
				pseudo,
				node.pseudos[pseudo]?.content ?? "",
			]),
		),
		rect: node.rectEvidence.rawRect,
		style: node.styles,
		typed: node.typedTokens,
	});
}
