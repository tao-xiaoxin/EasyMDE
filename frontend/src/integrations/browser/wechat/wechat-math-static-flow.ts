import { replaceDeclarations } from "./wechat-style-declarations";

/**
 * Bounded KaTeX vertical-list normalization for the WeChat serializer.
 *
 * The serializer captures a frozen source/clone identity graph, admits only
 * measured row and SVG-holder transitions, applies the plan to the normalized
 * SECTION clone, and rechecks source freshness before committing the payload.
 *
 * The only admitted row transition is the measured KaTeX pattern:
 *
 *   relative row + zero height + negative top:t + zero offsets
 *   + a direct positive inflow `.pstrut`
 *   -> static row + margin-top:t + margin-bottom:-t
 *
 * A group is all-or-nothing. A row-owned absolute SVG is admitted only through
 * an explicit inline-block holder with finite width/height, automatic insets,
 * and equal source SVG/holder geometry. The SVG transition is applied before
 * any row transition, and the Source tree is never mutated.
 */

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const GEOMETRY_QUANTUM = 1 / 64;
export const PSEUDO_ELEMENTS = ["::before", "::after"] as const;
const PHYSICAL_INSETS = ["top", "right", "bottom", "left"] as const;
export const LOGICAL_INSETS = [
	"inset-block-start",
	"inset-block-end",
	"inset-inline-start",
	"inset-inline-end",
] as const;
const HOLDER_EDGE_PROPERTIES = [
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

export type WechatMathSourceGroupAdmission = Readonly<{
	evidence: string;
	reason: string | null;
	rows: readonly WechatMathSourceRowAdmission[];
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

type CapturedRow = Readonly<{
	clone: Element;
	cloneParent: Element;
	pstrutClone: Element;
	pstrutSource: Element;
	rawTop: string;
	source: Element;
	top: number;
}>;

type CapturedSvgTransition = Readonly<{
	cloneChain: readonly Element[];
	cloneHolder: Element;
	cloneRow: Element;
	cloneSvg: SVGSVGElement;
	sourceHolder: Element;
	sourceRow: Element;
	sourceSvg: SVGSVGElement;
}>;

type CapturedGroup = Readonly<{
	clone: Element;
	evidence: string;
	reason: string | null;
	rows: readonly CapturedRow[];
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
	rejectedGroups: readonly WechatMathStaticFlowRejectedGroup[];
	rowTransitions: readonly WechatMathStaticFlowRowTransition[];
	snapshotSignature: string;
	svgTransitions: readonly WechatMathStaticFlowSvgTransition[];
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

function freezeMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
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

function flowError(
	code: WechatMathStaticFlowErrorCode,
	cause?: unknown,
): WechatMathStaticFlowError {
	return new WechatMathStaticFlowError(code, cause);
}

function assertGate(gate: WechatMathStaticFlowGate): void {
	if (gate.signal?.aborted || gate.isCancelled()) throw flowError("cancelled");
	if (!gate.isCurrent()) throw flowError("stale");
}

function finitePixel(value: string): number | null {
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

function near(
	left: number,
	right: number,
	quantum = GEOMETRY_QUANTUM,
): boolean {
	return Math.abs(left - right) <= quantum;
}

function sameRect(
	left: WechatMathStaticFlowRect,
	right: WechatMathStaticFlowRect,
): boolean {
	return (["bottom", "height", "left", "right", "top", "width"] as const).every(
		(property) => near(left[property], right[property]),
	);
}

function rectIsFinite(rect: WechatMathStaticFlowRect): boolean {
	return (["bottom", "height", "left", "right", "top", "width"] as const).every(
		(property) => Number.isFinite(rect[property]),
	);
}

function elementKey(element: Element): string {
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

function animationIntersects(
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

function pseudoContentIsAbsent(rawContent: string): boolean {
	const trimmed = rawContent.trim().toLowerCase();
	return !trimmed || "none" === trimmed || "normal" === trimmed;
}

function sourceNodeFor(
	source: Element,
	options: WechatMathStaticFlowCaptureOptions,
): WechatMathFrozenNode {
	const node = options.sourceAdmission?.sourceNodes.get(source);
	if (!node) throw flowError("identity-missing");
	return node;
}

function validateChildOrder(
	sourceParent: Element,
	cloneParent: Element,
	options: WechatMathStaticFlowCaptureOptions,
): void {
	const sourceNodes = options.sourceAdmission?.sourceNodes;
	if (!sourceNodes) throw flowError("identity-missing");
	const sourceNode = sourceNodes.get(sourceParent);
	if (!sourceNode) throw flowError("identity-missing");
	const sourceChildren = sourceNode.orderedChildren;
	const cloneChildren = Array.from(cloneParent.children);
	if (sourceChildren.length !== cloneChildren.length)
		throw flowError("identity-mismatch");
	sourceChildren.forEach((sourceChild, index) => {
		const cloneChild = options.cloneIdentityFor(sourceChild);
		const childNode = sourceNodes.get(sourceChild);
		if (!cloneChild || !childNode) throw flowError("identity-missing");
		if (
			cloneChild.namespaceURI !== childNode.namespaceURI ||
			cloneChild.localName !== childNode.localName ||
			cloneChildren[index] !== cloneChild
		)
			throw flowError("identity-mismatch");
	});
}

function isCompatibleCloneRootName(
	sourceLocalName: string,
	cloneLocalName: string,
): boolean {
	return (
		sourceLocalName === cloneLocalName ||
		(["div", "article", "blockquote"].includes(sourceLocalName.toLowerCase()) &&
			"section" === cloneLocalName.toLowerCase())
	);
}

function pairElement(
	source: Element,
	options: WechatMathStaticFlowCaptureOptions,
): Readonly<{ clone: Element; source: Element }> {
	if (source === options.sourceRoot)
		return { clone: options.cloneRoot, source };
	const sourceNode = sourceNodeFor(source, options);
	const sourceNodes = options.sourceAdmission?.sourceNodes;
	if (!sourceNodes) throw flowError("identity-missing");
	const clone = options.cloneIdentityFor(source);
	if (!clone) throw flowError("identity-missing");
	if (
		clone === source ||
		clone.namespaceURI !== sourceNode.namespaceURI ||
		!isCompatibleCloneRootName(sourceNode.localName, clone.localName)
	)
		throw flowError("identity-mismatch");
	if (!sourceNodes.has(source) || !options.cloneRoot.contains(clone)) {
		throw flowError("identity-outside-root");
	}
	const sourceParent = sourceNode.parent;
	if (sourceParent && sourceNodes.has(sourceParent)) {
		const expectedParent =
			sourceParent === options.sourceRoot
				? options.cloneRoot
				: options.cloneIdentityFor(sourceParent);
		if (!expectedParent) throw flowError("identity-missing");
		if (clone.parentElement !== expectedParent)
			throw flowError("identity-mismatch");
	}
	return { clone, source };
}

function nodeStyleValue(node: WechatMathFrozenNode, property: string): string {
	return node.styles[property] ?? "";
}

function nodeStylePixels(
	node: WechatMathFrozenNode,
	property: string,
): number | null {
	return finitePixel(nodeStyleValue(node, property));
}

function nodeStyleIs(
	node: WechatMathFrozenNode,
	property: string,
	expected: string,
): boolean {
	return nodeStyleValue(node, property) === expected;
}

function nodeStyleIn(
	node: WechatMathFrozenNode,
	property: string,
	expected: readonly string[],
): boolean {
	return expected.includes(nodeStyleValue(node, property));
}

function nodeStyleZero(node: WechatMathFrozenNode, property: string): boolean {
	return 0 === nodeStylePixels(node, property);
}

function nodeStyleAllZero(
	node: WechatMathFrozenNode,
	properties: readonly string[],
): boolean {
	return properties.every((property) => nodeStyleZero(node, property));
}

function nodeTypedPixel(
	node: WechatMathFrozenNode,
	property: string,
): number | null {
	return typedPixel(node.typedTokens[property]);
}

function nodeTypedPercent(
	node: WechatMathFrozenNode,
	property: string,
): number | null {
	return typedPercent(node.typedTokens[property]);
}

function nodeSafeLayoutAndPaint(node: WechatMathFrozenNode): boolean {
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

function nodeSafePseudo(node: WechatMathFrozenNode): boolean {
	return PSEUDO_ELEMENTS.every((pseudoElement) =>
		pseudoContentIsAbsent(node.pseudos[pseudoElement]?.content ?? ""),
	);
}

function nodeVisibleOverflow(node: WechatMathFrozenNode): boolean {
	return (
		nodeStyleIs(node, "overflow-x", "visible") &&
		nodeStyleIs(node, "overflow-y", "visible")
	);
}

function nodeSvgOverflowIsSafe(node: WechatMathFrozenNode): boolean {
	return (
		["visible", "hidden", "clip"].includes(
			nodeStyleValue(node, "overflow-x"),
		) &&
		["visible", "hidden", "clip"].includes(nodeStyleValue(node, "overflow-y"))
	);
}

function nodeEstablishesACB(node: WechatMathFrozenNode): boolean {
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

function nodeEvidenceSignature(node: WechatMathFrozenNode): string {
	return JSON.stringify({
		animation: node.animationIntersects,
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

type TopologyInterval = Readonly<{ end: number; start: number }>;
type SafetyEvent = Readonly<{
	element: Element;
	nearestACB: Element | null;
}>;
type TopologySafetySummary = Readonly<{
	firstFixed: SafetyEvent | null;
	firstPseudo: SafetyEvent | null;
}>;
type TopologyIndex = Readonly<{
	absoluteByACB: ReadonlyMap<Element, readonly Element[]>;
	intervals: ReadonlyMap<Element, TopologyInterval>;
	nodes: ReadonlyMap<Element, WechatMathFrozenNode>;
	safety: ReadonlyMap<Element, TopologySafetySummary>;
}>;

function firstSafetyEvent(
	current: SafetyEvent | null,
	candidate: SafetyEvent | null,
	order: ReadonlyMap<Element, TopologyInterval>,
): SafetyEvent | null {
	if (!current) return candidate;
	if (!candidate) return current;
	const currentInterval = order.get(current.element);
	const candidateInterval = order.get(candidate.element);
	if (!currentInterval || !candidateInterval) return current;
	return candidateInterval.start < currentInterval.start ? candidate : current;
}

function indexTopology(context: WechatMathTopologyContext): TopologyIndex {
	let timer = 0;
	const intervals = new Map<Element, TopologyInterval>();
	const nodes = new Map<Element, WechatMathFrozenNode>();
	const safety = new Map<Element, TopologySafetySummary>();
	const absoluteByACB = new Map<Element, Element[]>();
	const visited = new Set<Element>();

	function walk(
		element: Element,
		inheritedRow: Element | null,
		inheritedACB: Element | null,
	): void {
		if (visited.has(element)) return;
		visited.add(element);
		const node = context.getNode(element);
		if (!node) throw flowError("node-unobserved");
		nodes.set(element, node);
		const start = ++timer;
		const parentNode = node.parent ? nodes.get(node.parent) : undefined;
		const isRowRoot = Boolean(
			parentNode?.classList.has("vlist") &&
				node.namespaceURI === XHTML_NAMESPACE &&
				node.localName === "span" &&
				nodeStyleIs(node, "display", "block") &&
				nodeStyleIs(node, "position", "relative"),
		);
		const row = isRowRoot ? element : inheritedRow;
		const nearestACB = isRowRoot ? element : inheritedACB;
		const ownEvent: SafetyEvent = { element, nearestACB };
		if ("absolute" === node.styles.position && nearestACB) {
			const candidates = absoluteByACB.get(nearestACB) ?? [];
			candidates.push(element);
			absoluteByACB.set(nearestACB, candidates);
		}
		const ownFixed = "fixed" === node.styles.position ? ownEvent : null;
		const ownPseudo = PSEUDO_ELEMENTS.some(
			(pseudo) => !pseudoContentIsAbsent(node.pseudos[pseudo]?.content ?? ""),
		)
			? ownEvent
			: null;
		const childACB = nodeEstablishesACB(node) ? element : nearestACB;

		for (const child of node.orderedChildren) {
			walk(child, row, childACB);
		}

		const end = ++timer;
		intervals.set(element, { end, start });
		let firstFixed = ownFixed;
		let firstPseudo = ownPseudo;
		for (const child of node.orderedChildren) {
			const childSummary = safety.get(child);
			if (!childSummary) continue;
			firstFixed = firstSafetyEvent(
				firstFixed,
				childSummary.firstFixed,
				intervals,
			);
			firstPseudo = firstSafetyEvent(
				firstPseudo,
				childSummary.firstPseudo,
				intervals,
			);
		}
		safety.set(element, { firstFixed, firstPseudo });
	}

	walk(context.sourceRoot, null, null);
	return {
		absoluteByACB,
		intervals,
		nodes,
		safety,
	};
}

function nodeContains(
	intervals: ReadonlyMap<Element, TopologyInterval>,
	ancestor: Element,
	descendant: Element,
): boolean {
	const a = intervals.get(ancestor);
	const d = intervals.get(descendant);
	if (!a || !d) return false;
	return d.start >= a.start && d.end <= a.end;
}

function evaluateSourceSvgTransition(
	svgEl: SVGSVGElement,
	rowEl: Element,
	index: TopologyIndex,
): Readonly<{
	evidence: string;
	reason: string | null;
	transition: WechatMathSourceSvgAdmission | null;
}> {
	const svgNode = index.nodes.get(svgEl);
	if (!svgNode)
		return { evidence: "svg-missing", reason: "svg-holder", transition: null };
	const holderEl = svgNode.parent;
	if (!holderEl)
		return {
			evidence: "holder-missing",
			reason: "svg-holder",
			transition: null,
		};
	const holderNode = index.nodes.get(holderEl);
	if (
		!holderNode ||
		holderNode.namespaceURI !== XHTML_NAMESPACE ||
		holderNode.localName !== "span"
	) {
		return {
			evidence: "holder-missing",
			reason: "svg-holder",
			transition: null,
		};
	}
	if (
		holderNode.orderedChildren.length !== 1 ||
		holderNode.orderedChildren[0] !== svgEl
	) {
		return {
			evidence: "holder-children",
			reason: "svg-holder",
			transition: null,
		};
	}
	if (holderNode.holderTextFlag) {
		return { evidence: "holder-text", reason: "svg-holder", transition: null };
	}

	const sourceChain: Element[] = [holderEl];
	let chainSource: Element = holderEl;
	while (chainSource !== rowEl) {
		const parentEl = index.nodes.get(chainSource)?.parent ?? null;
		if (!parentEl || !nodeContains(index.intervals, rowEl, parentEl)) {
			return { evidence: "identity", reason: "svg-identity", transition: null };
		}
		chainSource = parentEl;
		sourceChain.push(chainSource);
	}

	const serialized = `${nodeEvidenceSignature(holderNode)}|${nodeEvidenceSignature(svgNode)}`;
	if (holderNode.animationIntersects || svgNode.animationIntersects) {
		return { evidence: serialized, reason: "svg-animation", transition: null };
	}
	if (!nodeSafePseudo(holderNode) || !nodeSafePseudo(svgNode)) {
		return { evidence: serialized, reason: "svg-pseudo", transition: null };
	}
	if (!nodeSafeLayoutAndPaint(holderNode) || !nodeVisibleOverflow(holderNode)) {
		return { evidence: serialized, reason: "svg-safety", transition: null };
	}
	if (!nodeSafeLayoutAndPaint(svgNode) || !nodeSvgOverflowIsSafe(svgNode)) {
		return { evidence: serialized, reason: "svg-safety", transition: null };
	}
	if (
		!nodeStyleIs(holderNode, "display", "inline-block") ||
		!nodeStyleIs(holderNode, "position", "static")
	) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (!nodeStyleIs(holderNode, "vertical-align", "baseline")) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (!nodeStyleAllZero(holderNode, HOLDER_EDGE_PROPERTIES)) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	const holderWidth = nodeStylePixels(holderNode, "width");
	const holderHeight = nodeStylePixels(holderNode, "height");
	const holderTypedWidth = nodeTypedPixel(holderNode, "width");
	const holderTypedHeight = nodeTypedPixel(holderNode, "height");
	if (
		null === holderWidth ||
		null === holderHeight ||
		holderWidth <= 0 ||
		holderHeight <= 0 ||
		null === holderTypedWidth ||
		null === holderTypedHeight ||
		!near(holderWidth, holderTypedWidth, GEOMETRY_QUANTUM) ||
		!near(holderHeight, holderTypedHeight, GEOMETRY_QUANTUM) ||
		!rectIsFinite(holderNode.rectEvidence.rawRect) ||
		!near(
			holderNode.rectEvidence.rawRect.width,
			holderWidth,
			GEOMETRY_QUANTUM,
		) ||
		!near(
			holderNode.rectEvidence.rawRect.height,
			holderHeight,
			GEOMETRY_QUANTUM,
		)
	) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (
		!nodeStyleIs(svgNode, "position", "absolute") ||
		!nodeStyleIs(svgNode, "display", "block")
	) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (
		!PHYSICAL_INSETS.every((property) => nodeStyleIs(svgNode, property, "auto"))
	) {
		return { evidence: serialized, reason: "svg-inset", transition: null };
	}
	if (
		!LOGICAL_INSETS.every((property) => nodeStyleIs(svgNode, property, "auto"))
	) {
		return { evidence: serialized, reason: "svg-inset", transition: null };
	}
	if (!nodeStyleAllZero(svgNode, HOLDER_EDGE_PROPERTIES)) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	const svgWidth = nodeStylePixels(svgNode, "width");
	const svgHeight = nodeStylePixels(svgNode, "height");
	if (
		null === svgWidth ||
		null === svgHeight ||
		svgWidth <= 0 ||
		svgHeight <= 0 ||
		!near(svgWidth, holderWidth, GEOMETRY_QUANTUM) ||
		!near(svgHeight, holderHeight, GEOMETRY_QUANTUM)
	) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	const typedSvgWidth =
		nodeTypedPixel(svgNode, "width") ?? nodeTypedPixel(svgNode, "inline-size");
	const typedSvgHeight =
		nodeTypedPixel(svgNode, "height") ?? nodeTypedPixel(svgNode, "block-size");
	const percentSvgWidth =
		nodeTypedPercent(svgNode, "width") ??
		nodeTypedPercent(svgNode, "inline-size");
	const keywordSvgHeight =
		svgNode.typedTokens.height === "keyword:inherit" ||
		svgNode.typedTokens["block-size"] === "keyword:inherit";
	if (
		(null === typedSvgWidth &&
			!(
				null !== percentSvgWidth && near(percentSvgWidth, 100, GEOMETRY_QUANTUM)
			)) ||
		(null === typedSvgHeight && !keywordSvgHeight) ||
		(null !== typedSvgWidth &&
			!near(typedSvgWidth, holderWidth, GEOMETRY_QUANTUM)) ||
		(null !== typedSvgHeight &&
			!near(typedSvgHeight, holderHeight, GEOMETRY_QUANTUM))
	) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	if (
		!sameRect(svgNode.rectEvidence.rawRect, holderNode.rectEvidence.rawRect) ||
		!rectIsFinite(svgNode.rectEvidence.rawRect)
	) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	return {
		evidence: serialized,
		reason: null,
		transition: Object.freeze({
			sourceChain: Object.freeze(sourceChain),
			sourceHolder: holderEl,
			sourceRow: rowEl,
			sourceSvg: svgEl,
		}),
	};
}

function bindSvgTransitionToClone(
	transition: WechatMathSourceSvgAdmission,
	rowClone: Element,
	options: WechatMathStaticFlowCaptureOptions,
): Readonly<{
	reason: string | null;
	transition: CapturedSvgTransition | null;
}> {
	const holderPair = pairElement(transition.sourceHolder, options);
	const svgPair = pairElement(transition.sourceSvg, options);
	if (
		!(holderPair.clone instanceof Element) ||
		!(svgPair.clone instanceof SVGSVGElement)
	) {
		return { reason: "svg-identity", transition: null };
	}
	if (
		holderPair.clone.children.length !== 1 ||
		holderPair.clone.firstElementChild !== svgPair.clone
	) {
		return { reason: "svg-holder", transition: null };
	}
	if (
		Array.from(holderPair.clone.childNodes).some(
			(node) =>
				node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
		)
	) {
		return { reason: "svg-holder", transition: null };
	}
	if (svgPair.clone.parentElement !== holderPair.clone) {
		return { reason: "svg-identity", transition: null };
	}
	validateChildOrder(transition.sourceHolder, holderPair.clone, options);

	const cloneChain: Element[] = [holderPair.clone];
	for (let index = 1; index < transition.sourceChain.length; index += 1) {
		const sourceAncestor = transition.sourceChain[index];
		if (!sourceAncestor) continue;
		const ancestorPair = pairElement(sourceAncestor, options);
		if (
			cloneChain[cloneChain.length - 1]?.parentElement !== ancestorPair.clone
		) {
			return { reason: "svg-identity", transition: null };
		}
		cloneChain.push(ancestorPair.clone);
	}
	if (cloneChain[cloneChain.length - 1] !== rowClone) {
		return { reason: "svg-identity", transition: null };
	}
	return {
		reason: null,
		transition: Object.freeze({
			cloneChain: Object.freeze(cloneChain),
			cloneHolder: holderPair.clone,
			cloneRow: rowClone,
			cloneSvg: svgPair.clone,
			sourceHolder: transition.sourceHolder,
			sourceRow: transition.sourceRow,
			sourceSvg: transition.sourceSvg,
		}),
	};
}

function evaluateSourceRow(
	rowEl: Element,
	groupEl: Element,
	index: TopologyIndex,
): Readonly<{
	evidence: string;
	reason: string | null;
	row: WechatMathSourceRowAdmission | null;
}> {
	const rowNode = index.nodes.get(rowEl);
	if (!rowNode)
		return { evidence: "row-missing", reason: "row-shape", row: null };
	if (
		rowNode.namespaceURI !== XHTML_NAMESPACE ||
		"span" !== rowNode.localName ||
		rowNode.parent !== groupEl
	) {
		return { evidence: "row-shape", reason: "row-shape", row: null };
	}
	const serialized = nodeEvidenceSignature(rowNode);
	if (rowNode.animationIntersects)
		return { evidence: serialized, reason: "row-animation", row: null };
	if (!nodeSafePseudo(rowNode))
		return { evidence: serialized, reason: "row-pseudo", row: null };
	if (!nodeSafeLayoutAndPaint(rowNode) || !nodeVisibleOverflow(rowNode)) {
		return { evidence: serialized, reason: "row-safety", row: null };
	}
	if (
		!nodeStyleIs(rowNode, "display", "block") ||
		!nodeStyleIs(rowNode, "position", "relative") ||
		!["auto", "0px"].includes(nodeStyleValue(rowNode, "left")) ||
		!["auto", "0px"].includes(nodeStyleValue(rowNode, "right")) ||
		!nodeStyleIs(rowNode, "bottom", "auto")
	) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	if (
		!nodeStyleZero(rowNode, "height") ||
		!nodeStyleAllZero(rowNode, HOLDER_EDGE_PROPERTIES)
	) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	const rawTop = nodeStyleValue(rowNode, "top");
	if (!/^-(?:\d+(?:\.\d+)?|\.\d+)px$/iu.test(rawTop)) {
		return { evidence: serialized, reason: "row-top", row: null };
	}
	const top = finitePixel(rawTop);
	if (null === top || top >= 0) {
		return { evidence: serialized, reason: "row-top", row: null };
	}
	const typedTop = nodeTypedPixel(rowNode, "top");
	if (
		null === typedTop ||
		!Number.isFinite(typedTop) ||
		typedTop >= 0 ||
		!near(top, typedTop, GEOMETRY_QUANTUM)
	) {
		return { evidence: serialized, reason: "row-top", row: null };
	}
	const typedHeight = nodeTypedPixel(rowNode, "height");
	const typedBlockSize = nodeTypedPixel(rowNode, "block-size");
	if (
		(null === typedHeight || !near(typedHeight, 0, GEOMETRY_QUANTUM)) &&
		(null === typedBlockSize || !near(typedBlockSize, 0, GEOMETRY_QUANTUM))
	) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	const pstrut = rowNode.orderedChildren.find((child) =>
		index.nodes.get(child)?.classList.has("pstrut"),
	);
	if (!pstrut) return { evidence: serialized, reason: "pstrut", row: null };
	const pstrutNode = index.nodes.get(pstrut);
	if (!pstrutNode) return { evidence: serialized, reason: "pstrut", row: null };
	const pstrutSerialized = `${serialized}|${nodeEvidenceSignature(pstrutNode)}`;
	if (pstrutNode.animationIntersects)
		return {
			evidence: pstrutSerialized,
			reason: "pstrut-animation",
			row: null,
		};
	if (!nodeSafePseudo(pstrutNode))
		return { evidence: pstrutSerialized, reason: "pstrut-pseudo", row: null };
	if (!nodeSafeLayoutAndPaint(pstrutNode))
		return { evidence: pstrutSerialized, reason: "pstrut", row: null };
	const pstrutHeight = nodeStylePixels(pstrutNode, "height");
	const pstrutTypedHeight = nodeTypedPixel(pstrutNode, "height");
	if (
		!nodeStyleIs(pstrutNode, "display", "inline-block") ||
		!["static", "relative"].includes(nodeStyleValue(pstrutNode, "position")) ||
		0 !== nodeStylePixels(pstrutNode, "width") ||
		null === pstrutHeight ||
		pstrutHeight <= 0 ||
		null === pstrutTypedHeight ||
		!near(pstrutHeight, pstrutTypedHeight, GEOMETRY_QUANTUM) ||
		!rectIsFinite(pstrutNode.rectEvidence.rawRect) ||
		pstrutNode.rectEvidence.rawRect.height <= 0
	) {
		return { evidence: pstrutSerialized, reason: "pstrut", row: null };
	}
	return {
		evidence: pstrutSerialized,
		reason: null,
		row: Object.freeze({
			pstrutSource: pstrut,
			rawTop,
			source: rowEl,
			top,
		}),
	};
}

function bindRowToClone(
	row: WechatMathSourceRowAdmission,
	groupClone: Element,
	options: WechatMathStaticFlowCaptureOptions,
): Readonly<{ reason: string | null; row: CapturedRow | null }> {
	const rowPair = pairElement(row.source, options);
	if (rowPair.clone.parentElement !== groupClone)
		return { reason: "row-shape", row: null };
	validateChildOrder(row.source, rowPair.clone, options);
	const pstrutPair = pairElement(row.pstrutSource, options);
	return {
		reason: null,
		row: Object.freeze({
			clone: rowPair.clone,
			cloneParent: groupClone,
			pstrutClone: pstrutPair.clone,
			pstrutSource: row.pstrutSource,
			rawTop: row.rawTop,
			source: row.source,
			top: row.top,
		}),
	};
}

function evaluateSourceGroup(
	groupEl: Element,
	context: WechatMathTopologyContext,
	index: TopologyIndex,
): WechatMathSourceGroupAdmission {
	const groupNode = index.nodes.get(groupEl);
	if (!groupNode)
		return {
			evidence: "group-missing",
			reason: "group-layout",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};

	const parentEl =
		groupNode.parent ?? context.ancestorParents?.get(groupEl) ?? null;
	const parentClassList = parentEl
		? (index.nodes.get(parentEl)?.classList ??
			context.ancestorClassLists?.get(parentEl))
		: undefined;
	const grandparentEl = parentEl
		? (index.nodes.get(parentEl)?.parent ??
			context.ancestorParents?.get(parentEl) ??
			null)
		: null;
	const grandparentClassList = grandparentEl
		? (index.nodes.get(grandparentEl)?.classList ??
			context.ancestorClassLists?.get(grandparentEl))
		: undefined;

	if (
		groupNode.namespaceURI !== XHTML_NAMESPACE ||
		"span" !== groupNode.localName ||
		!parentClassList?.has("vlist-r") ||
		!grandparentClassList?.has("vlist-t")
	) {
		return {
			evidence: "group-shape",
			reason: "group-layout",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};
	}

	const groupSerialized = nodeEvidenceSignature(groupNode);
	if (
		!nodeStyleIs(groupNode, "display", "table-cell") ||
		!nodeStyleIs(groupNode, "position", "relative")
	) {
		return {
			evidence: groupSerialized,
			reason: "group-layout",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};
	}
	if (groupNode.animationIntersects) {
		return {
			evidence: groupSerialized,
			reason: "group-animation",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};
	}
	if (!nodeSafePseudo(groupNode)) {
		return {
			evidence: groupSerialized,
			reason: "group-pseudo",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};
	}
	if (!nodeSafeLayoutAndPaint(groupNode) || !nodeVisibleOverflow(groupNode)) {
		return {
			evidence: groupSerialized,
			reason: "group-safety",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};
	}

	const rowSources = groupNode.orderedChildren.filter(
		(child) => index.nodes.get(child)?.namespaceURI === XHTML_NAMESPACE,
	);
	if (
		!rowSources.length ||
		rowSources.length !== groupNode.orderedChildren.length
	) {
		return {
			evidence: groupSerialized,
			reason: "group-shape",
			rows: [],
			source: groupEl,
			svgTransitions: [],
		};
	}

	const rows: WechatMathSourceRowAdmission[] = [];
	const rowEvidence: string[] = [];
	for (const rowSource of rowSources) {
		const captured = evaluateSourceRow(rowSource, groupEl, index);
		rowEvidence.push(captured.evidence);
		if (captured.reason || !captured.row) {
			return {
				evidence: [groupSerialized, ...rowEvidence].join("|"),
				reason: captured.reason ?? "row-shape",
				rows: [],
				source: groupEl,
				svgTransitions: [],
			};
		}
		rows.push(captured.row);
	}

	const svgTransitions: WechatMathSourceSvgAdmission[] = [];
	const svgEvidence: string[] = [];
	const seenSvg = new Set<Element>();
	const evidence = (): string =>
		[groupSerialized, ...rowEvidence, ...svgEvidence].join("|");
	const reject = (reason: string): WechatMathSourceGroupAdmission => ({
		evidence: evidence(),
		reason,
		rows: [],
		source: groupEl,
		svgTransitions: [],
	});

	for (const row of rows) {
		const summary = index.safety.get(row.source);
		if (!summary) return reject("row-shape");

		// Pseudo checks are deliberately evaluated before position checks, matching
		// the original admission order while reading the indexed event once.
		const pseudoEvent = summary.firstPseudo;
		if (pseudoEvent) {
			const pseudoNode = index.nodes.get(pseudoEvent.element);
			if (!pseudoNode) return reject("row-pseudo");
			for (const pseudo of PSEUDO_ELEMENTS) {
				const pseudoContent = pseudoNode.pseudos[pseudo]?.content ?? "";
				if (pseudoContentIsAbsent(pseudoContent)) continue;
				const pseudoPosition = pseudoNode.pseudos[pseudo]?.position ?? "static";
				if (
					"fixed" === pseudoPosition ||
					("absolute" === pseudoPosition &&
						(pseudoEvent.element === row.source ||
							pseudoEvent.nearestACB === row.source))
				) {
					return reject("absolute-containing-block");
				}
				return reject("row-pseudo");
			}
		}

		const fixedEvent =
			summary.firstFixed?.element === row.source ? null : summary.firstFixed;
		const absoluteCandidates = index.absoluteByACB.get(row.source) ?? [];
		let absoluteIndex = 0;
		while (fixedEvent || absoluteIndex < absoluteCandidates.length) {
			const absolute = absoluteCandidates[absoluteIndex];
			const fixedStart = fixedEvent
				? index.intervals.get(fixedEvent.element)?.start
				: undefined;
			const absoluteStart = absolute
				? index.intervals.get(absolute)?.start
				: undefined;
			if (
				fixedEvent &&
				(undefined === absoluteStart ||
					(undefined !== fixedStart && fixedStart < absoluteStart))
			) {
				return reject("absolute-containing-block");
			}
			if (!absolute) break;
			absoluteIndex += 1;
			const node = index.nodes.get(absolute);
			if (!node) return reject("absolute-containing-block");
			if (node.namespaceURI !== SVG_NAMESPACE || "svg" !== node.localName) {
				return reject("absolute-containing-block");
			}
			if (seenSvg.has(absolute)) continue;
			seenSvg.add(absolute);
			const captured = evaluateSourceSvgTransition(
				absolute as SVGSVGElement,
				row.source,
				index,
			);
			svgEvidence.push(captured.evidence);
			if (captured.reason || !captured.transition)
				return reject(captured.reason ?? "svg-identity");
			svgTransitions.push(captured.transition);
		}
	}

	return {
		evidence: evidence(),
		reason: null,
		rows: Object.freeze(rows),
		source: groupEl,
		svgTransitions: Object.freeze(svgTransitions),
	};
}

function bindSourceGroupToClone(
	group: WechatMathSourceGroupAdmission,
	options: WechatMathStaticFlowCaptureOptions,
): CapturedGroup {
	const pair = pairElement(group.source, options);
	if (group.reason !== null) {
		return {
			clone: pair.clone,
			evidence: group.evidence,
			reason: group.reason,
			rows: [],
			source: group.source,
			svgTransitions: [],
		};
	}
	validateChildOrder(group.source, pair.clone, options);
	const rows: CapturedRow[] = [];
	for (const row of group.rows) {
		const boundRow = bindRowToClone(row, pair.clone, options);
		if (boundRow.reason || !boundRow.row) {
			return {
				clone: pair.clone,
				evidence: group.evidence,
				reason: boundRow.reason ?? "row-shape",
				rows: [],
				source: group.source,
				svgTransitions: [],
			};
		}
		rows.push(boundRow.row);
	}
	const svgTransitions: CapturedSvgTransition[] = [];
	for (const transition of group.svgTransitions) {
		const rowPair = pairElement(transition.sourceRow, options);
		const boundSvg = bindSvgTransitionToClone(
			transition,
			rowPair.clone,
			options,
		);
		if (boundSvg.reason || !boundSvg.transition) {
			return {
				clone: pair.clone,
				evidence: group.evidence,
				reason: boundSvg.reason ?? "svg-identity",
				rows: [],
				source: group.source,
				svgTransitions: [],
			};
		}
		svgTransitions.push(boundSvg.transition);
	}
	return {
		clone: pair.clone,
		evidence: group.evidence,
		reason: null,
		rows: Object.freeze(rows),
		source: group.source,
		svgTransitions: Object.freeze(svgTransitions),
	};
}

export function collectWechatMathLiveTopology(
	sourceRoot: Element,
	runtime: WechatMathStaticFlowRuntime,
): WechatMathTopologyContext {
	const animations = runtime.getAnimations();
	const nodeMap = new Map<Element, WechatMathFrozenNode>();
	const observedSequence: Element[] = [];

	const rootRect = runtime.getRect(sourceRoot) ?? {
		bottom: 0,
		height: 0,
		left: 0,
		right: 0,
		top: 0,
		width: 0,
	};

	function visit(element: Element): void {
		if (nodeMap.has(element)) return;
		observedSequence.push(element);

		const style = runtime.getComputedStyle(element);
		const styles = Object.freeze(
			Object.fromEntries(
				CAPTURE_STYLE_PROPERTIES.map((property) => [
					property,
					style.getPropertyValue(property).trim().toLowerCase(),
				]),
			),
		);

		let typedTokens: Readonly<Record<string, string>> = Object.freeze({});
		try {
			const typedMap = runtime.getTypedStyleMap(element);
			typedTokens = Object.freeze(
				Object.fromEntries(
					TYPED_DIMENSION_PROPERTIES.map((property) => [
						property,
						typedToken(typedMap.get(property)),
					]),
				),
			);
		} catch {
			// Fall through
		}

		const pseudos = Object.freeze(
			Object.fromEntries(
				PSEUDO_ELEMENTS.map((pseudo) => {
					const pseudoStyle = runtime.getComputedStyle(element, pseudo);
					const content = pseudoStyle.getPropertyValue("content").trim();
					const position =
						pseudoStyle.getPropertyValue("position").trim().toLowerCase() ||
						"static";
					return [pseudo, Object.freeze({ content, position })];
				}),
			) as Record<
				(typeof PSEUDO_ELEMENTS)[number],
				Readonly<{ content: string; position: string }>
			>,
		);

		const rawRect = runtime.getRect(element) ?? {
			bottom: 0,
			height: 0,
			left: 0,
			right: 0,
			top: 0,
			width: 0,
		};
		const rectEvidence: WechatMathRectEvidence = Object.freeze({
			epochId: 0,
			rawRect,
			rootRectAtEpoch: rootRect,
		});

		const hasAnimation = animationIntersects(element, animations);

		const holderTextFlag = Array.from(element.childNodes).some(
			(node) =>
				node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
		);

		const orderedChildren = Object.freeze(Array.from(element.children));
		const classList = Object.freeze(
			new Set(Array.from(element.classList ?? [])),
		);

		const node: WechatMathFrozenNode = Object.freeze({
			animationIntersects: hasAnimation,
			key: elementKey(element),
			classList,
			element,
			holderTextFlag,
			localName: element.localName.toLowerCase(),
			namespaceURI: element.namespaceURI ?? "",
			orderedChildren,
			parent: element.parentElement,
			pseudos,
			rectEvidence,
			styles,
			typedTokens,
		});

		nodeMap.set(element, node);

		for (const child of orderedChildren) {
			visit(child);
		}
	}

	visit(sourceRoot);

	const ancestorClassLists = new Map<Element, ReadonlySet<string>>();
	const ancestorParents = new Map<Element, Element | null>();
	if (sourceRoot.parentElement) {
		ancestorParents.set(sourceRoot, sourceRoot.parentElement);
		ancestorClassLists.set(
			sourceRoot.parentElement,
			Object.freeze(
				new Set(Array.from(sourceRoot.parentElement.classList ?? [])),
			),
		);
		if (sourceRoot.parentElement.parentElement) {
			ancestorParents.set(
				sourceRoot.parentElement,
				sourceRoot.parentElement.parentElement,
			);
			ancestorClassLists.set(
				sourceRoot.parentElement.parentElement,
				Object.freeze(
					new Set(
						Array.from(sourceRoot.parentElement.parentElement.classList ?? []),
					),
				),
			);
		}
	}

	return Object.freeze({
		ancestorClassLists: Object.freeze(ancestorClassLists),
		ancestorParents: Object.freeze(ancestorParents),
		getNode: (el) => nodeMap.get(el),
		observedSequence: Object.freeze(observedSequence),
		sourceRoot,
	});
}

export function evaluateWechatMathSourceAdmission(
	contextOrRoot: WechatMathTopologyContext | Element,
	runtime?: WechatMathStaticFlowRuntime,
	_animations?: readonly Animation[],
	_observedElements?: readonly Element[],
): WechatMathSourceAdmissionResult {
	let context: WechatMathTopologyContext;
	if ("getNode" in contextOrRoot) {
		context = contextOrRoot;
	} else if (runtime) {
		context = collectWechatMathLiveTopology(contextOrRoot, runtime);
	} else {
		throw new Error("evaluateWechatMathSourceAdmission-missing-runtime");
	}

	const index = indexTopology(context);
	const candidateGroups: Element[] = [];
	const seen = new Set<Element>();
	for (const element of context.observedSequence) {
		if (!index.nodes.get(element)?.classList.has("vlist") || seen.has(element))
			continue;
		seen.add(element);
		candidateGroups.push(element);
	}

	const groups = candidateGroups.map((group) =>
		evaluateSourceGroup(group, context, index),
	);
	const keyFor = (element: Element): string =>
		index.nodes.get(element)?.key ?? "unobserved";
	const orderedObserved = context.observedSequence.map(keyFor);
	const groupWitness = groups.map((g) => ({
		reason: g.reason,
		source: keyFor(g.source),
	}));
	const rowWitness = groups.flatMap((g) =>
		g.rows.map((r) => ({
			rawTop: r.rawTop,
			source: keyFor(r.source),
			top: r.top,
		})),
	);
	const svgWitness = groups.flatMap((g) =>
		g.svgTransitions.map((s) => ({
			holder: keyFor(s.sourceHolder),
			row: keyFor(s.sourceRow),
			svg: keyFor(s.sourceSvg),
		})),
	);
	const witness: WechatMathSourceAdmissionWitness = {
		groups: groupWitness,
		orderedObserved,
		rows: rowWitness,
		svg: svgWitness,
		version: 1 as const,
	};

	return deepFreezePlainRecord({
		groups,
		sourceNodes: freezeMap(index.nodes),
		sourceRoot: context.sourceRoot,
		topology: context,
		witness,
		witnessSignature: JSON.stringify(witness),
	});
}

export function captureWechatMathStaticFlowSnapshot(
	options: WechatMathStaticFlowCaptureOptions,
): WechatMathStaticFlowSnapshot {
	assertGate(options.gate);
	if (
		options.sourceAdmission &&
		options.sourceAdmission.sourceRoot !== options.sourceRoot
	) {
		throw flowError("root-mismatch");
	}
	if (
		!options.liveSourceAdmissionSignature ||
		!options.rawDimensionGeometrySignature
	) {
		throw flowError("signature-missing");
	}

	const sourceAdmission =
		options.sourceAdmission ??
		evaluateWechatMathSourceAdmission(
			options.sourceRoot,
			options.runtime,
			options.runtime.getAnimations(),
		);
	const sourceRootNode = sourceAdmission.sourceNodes.get(options.sourceRoot);
	if (!sourceRootNode) throw flowError("identity-missing");
	if (
		options.sourceRoot === options.cloneRoot ||
		sourceRootNode.namespaceURI !== options.cloneRoot.namespaceURI ||
		!isCompatibleCloneRootName(
			sourceRootNode.localName,
			options.cloneRoot.localName,
		)
	)
		throw flowError("root-mismatch");

	// Binding always receives the same frozen source topology that produced the
	// admission. Clone membership and child order remain live validation.
	const bindingOptions: WechatMathStaticFlowCaptureOptions = {
		...options,
		sourceAdmission,
	};
	const sourceKeyFor = (element: Element): string =>
		sourceAdmission.sourceNodes.get(element)?.key ?? "unobserved";
	const groups = sourceAdmission.groups.map((group) =>
		bindSourceGroupToClone(group, bindingOptions),
	);

	const payload = {
		cloneRoot: elementKey(options.cloneRoot),
		groups: groups.map((group) => ({
			evidence: group.evidence,
			reason: group.reason,
			rows: group.rows.map(({ source, top }) => ({
				source: sourceKeyFor(source),
				top,
			})),
			source: sourceKeyFor(group.source),
			svg: group.svgTransitions.map(({ sourceHolder, sourceSvg }) => ({
				holder: sourceKeyFor(sourceHolder),
				svg: sourceKeyFor(sourceSvg),
			})),
		})),
		liveSourceAdmissionSignature: options.liveSourceAdmissionSignature,
		rawDimensionGeometrySignature: options.rawDimensionGeometrySignature,
		sourceRoot: sourceKeyFor(options.sourceRoot),
		version: 1,
		witness: sourceAdmission.witness,
	};
	assertGate(options.gate);
	return deepFreezePlainRecord({
		cloneRoot: options.cloneRoot,
		groups,
		liveSourceAdmissionSignature: options.liveSourceAdmissionSignature,
		rawDimensionGeometrySignature: options.rawDimensionGeometrySignature,
		signature: JSON.stringify(payload),
		sourceRoot: options.sourceRoot,
		version: 1 as const,
	});
}

export function planWechatMathStaticFlow(
	snapshot: WechatMathStaticFlowSnapshot,
	options: WechatMathStaticFlowPlanOptions,
): WechatMathStaticFlowPlan {
	assertGate(options.gate);
	const accepted = snapshot.groups.filter((group) => null === group.reason);
	const plan: WechatMathStaticFlowPlan = deepFreezePlainRecord({
		cloneRoot: snapshot.cloneRoot,
		rejectedGroups: snapshot.groups
			.filter(
				(group): group is CapturedGroup & { reason: string } =>
					null !== group.reason,
			)
			.map((group) => ({ reason: group.reason, source: group.source })),
		rowTransitions: accepted.flatMap((group) =>
			group.rows.map(
				({ clone, cloneParent, pstrutClone, rawTop, source, top }) => ({
					clone,
					cloneParent,
					pstrutClone,
					rawTop,
					source,
					top,
				}),
			),
		),
		snapshotSignature: snapshot.signature,
		svgTransitions: accepted.flatMap((group) =>
			group.svgTransitions.map((transition) => ({
				...transition,
				cloneChain: [...transition.cloneChain],
			})),
		),
	});
	assertGate(options.gate);
	return plan;
}

type AppliedStyle = Readonly<{ element: Element; original: string | null }>;

function declarationsForSvg(): readonly string[] {
	return [
		"position:static",
		...PHYSICAL_INSETS.map((property) => `${property}:auto`),
		...LOGICAL_INSETS.map((property) => `${property}:auto`),
	];
}

function declarationsForRow(rawTop: string): readonly string[] {
	if (!/^-(?:\d+(?:\.\d+)?|\.\d+)px$/i.test(rawTop))
		throw flowError("apply-style-rejected");
	const positiveBottom = rawTop.slice(1);
	return [
		"position:static",
		"top:auto",
		"bottom:auto",
		`margin-top:${rawTop}`,
		`margin-bottom:${positiveBottom}`,
	];
}

function applyDeclarations(
	element: Element,
	declarations: readonly string[],
): void {
	try {
		replaceDeclarations(element, declarations, true);
		const style = (element as Element & { style?: CSSStyleDeclaration }).style;
		declarations.forEach((declaration) => {
			const property = declaration.slice(0, declaration.indexOf(":"));
			if (
				!style?.getPropertyValue(property).trim() ||
				"important" !== style.getPropertyPriority(property)
			) {
				throw flowError("apply-style-rejected");
			}
		});
	} catch (error: unknown) {
		if (error instanceof WechatMathStaticFlowError) throw error;
		throw flowError("apply-style-rejected", error);
	}
}

function restoreStyles(applied: readonly AppliedStyle[]): void {
	[...applied].reverse().forEach(({ element, original }) => {
		if (null === original) element.removeAttribute("style");
		else element.setAttribute("style", original);
	});
}

export function applyWechatMathStaticFlow(
	plan: WechatMathStaticFlowPlan,
	options: WechatMathStaticFlowApplyOptions,
): void {
	assertGate(options.gate);
	const cloneRoot = options.cloneRoot ?? plan.cloneRoot;

	const targets = [
		...plan.svgTransitions.flatMap((transition) => [
			transition.cloneSvg,
			transition.cloneHolder,
		]),
		...plan.rowTransitions.flatMap((transition) => [
			transition.clone,
			transition.pstrutClone,
		]),
	];
	const seenTargets = new Set<Element>();
	for (const target of targets) {
		if (seenTargets.has(target)) throw flowError("apply-duplicate-target");
		seenTargets.add(target);
		if (
			!cloneRoot.contains(target) ||
			target.ownerDocument !== cloneRoot.ownerDocument
		) {
			throw flowError("apply-detached");
		}
	}
	for (const transition of plan.svgTransitions) {
		if (
			transition.cloneSvg.parentElement !== transition.cloneHolder ||
			transition.cloneChain[0] !== transition.cloneHolder ||
			transition.cloneChain[transition.cloneChain.length - 1] !==
				transition.cloneRow ||
			!cloneRoot.contains(transition.cloneHolder)
		)
			throw flowError("apply-parent-mismatch");
		for (let index = 1; index < transition.cloneChain.length; index += 1) {
			if (
				transition.cloneChain[index - 1]?.parentElement !==
				transition.cloneChain[index]
			) {
				throw flowError("apply-parent-mismatch");
			}
		}
		if (
			transition.cloneChain.some((element) => !cloneRoot.contains(element)) ||
			transition.cloneSvg.parentElement !== transition.cloneChain[0] ||
			transition.cloneChain[transition.cloneChain.length - 1] !==
				transition.cloneRow
		)
			throw flowError("apply-detached");
	}
	for (const transition of plan.rowTransitions) {
		const parent = transition.clone.parentElement;
		if (
			parent !== transition.cloneParent ||
			!cloneRoot.contains(transition.cloneParent)
		) {
			throw flowError("apply-parent-mismatch");
		}
		if (
			!transition.pstrutClone ||
			transition.pstrutClone.parentElement !== transition.clone ||
			!cloneRoot.contains(transition.pstrutClone)
		) {
			throw flowError("apply-parent-mismatch");
		}
	}

	const applied: AppliedStyle[] = targets.map((element) => ({
		element,
		original: element.getAttribute("style"),
	}));
	try {
		assertGate(options.gate);
		for (const transition of plan.svgTransitions) {
			applyDeclarations(transition.cloneSvg, declarationsForSvg());
		}
		assertGate(options.gate);
		for (const transition of plan.rowTransitions) {
			applyDeclarations(
				transition.clone,
				declarationsForRow(transition.rawTop),
			);
		}
		assertGate(options.gate);
	} catch (error: unknown) {
		try {
			restoreStyles(applied);
		} catch (rollbackError: unknown) {
			throw flowError("apply-rollback-failed", rollbackError);
		}
		throw error;
	}
}
