import { SVGPathData } from "svg-pathdata";
import type {
	WechatVisualInlineLayout,
	WechatVisualInlineOverflow,
} from "../../../contracts/ports/wechat-visual-rasterization-port";
import {
	isMathBlockContentCaptureSnapshot,
	snapshotMathCaptureNode,
} from "./wechat-capture-plan";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	hasVisualRasterizationAncestor,
	mathCloneRole,
	mathOuterAllocationDecision,
	visualRasterizationKind,
} from "./wechat-clone-metadata";
import type { FontFaceCandidate } from "./wechat-managed-fonts";
import type { CaptureGeometry } from "./wechat-math-capture-geometry";
import type {
	WechatMathVectorAtlas,
	WechatMathVectorFrozenScene,
	WechatMathVectorFrozenSvgChild,
	WechatMathVectorFrozenSvgFragment,
	WechatMathVectorGlyphRun,
	WechatMathVectorMatrix,
	WechatMathVectorRect,
	WechatMathVectorResolvedPaint,
	WechatMathVectorRulePaint,
} from "./wechat-math-vector-scene";
import {
	type AcquiredPreviewGeometryMeasurement,
	previewMeasurementLeaseSourceMatches,
	waitForPreviewMeasurement,
} from "./wechat-preview-geometry-cache";
import { assertCopyGuardCurrent } from "./wechat-source-freshness";
import {
	applySvgMatrixToPoint,
	multiplySvgMatrices,
	parseSvgPreserveAspectRatioAttribute,
	parseSvgViewBoxAttribute,
	svgMatrixDeterminant,
	svgViewBoxToViewportTransform,
} from "./wechat-svg-marker-geometry";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const SHOW_TEXT = 4;
const GEOMETRY_QUANTUM = 1 / 64;
const SOLID_PAINT = /^[-#a-z0-9().,%\s/]+$/iu;
const RENDERER_STRUT = "\u200b";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const EMPTY_PAINT = new Set(["none", "transparent"]);
const ZERO_ALPHA_COLOR =
	/^(?:rgba|hsla)\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*0(?:\.0+)?%?\s*\)$/iu;
const RULE_CLASSES =
	/(^|[-_])(frac-line|sqrt-line|rule|overline|underline)([-_]|$)/iu;

export type WechatMathVectorCaptureOptions = Readonly<{
	atlas: WechatMathVectorAtlas;
	managedFaces: readonly FontFaceCandidate[];
	measurement: AcquiredPreviewGeometryMeasurement;
	preview: HTMLElement;
	runtime: BrowserWechatClipboardRuntime;
	sourceOwners: readonly Element[];
	signal?: AbortSignal;
	isCurrent?: () => boolean;
}>;

export type WechatMathVectorAllocation = Readonly<{
	/** Effective source-computed edges used once by final scene materialization. */
	edges: Readonly<{
		borderBottom: number;
		borderLeft: number;
		borderRight: number;
		borderTop: number;
		marginLeft: number;
		marginRight: number;
		paddingBottom: number;
		paddingLeft: number;
		paddingRight: number;
		paddingTop: number;
	}>;
	/** The existing rasterizer allocation projection consumed by the serializer. */
	geometry: CaptureGeometry;
	/** The owner border-box in source-owner coordinates. */
	ownerRect: WechatMathVectorRect;
	/** The direct-child layout union used for the detached vector viewBox. */
	visualRect: WechatMathVectorRect;
	/** The frozen line-box baseline minus the allocated bottom edge. */
	baselineHeight: number | null;
}>;

export type WechatMathVectorCapturedScene = Readonly<{
	allocation: WechatMathVectorAllocation;
	replacementShell: Element;
	scene: WechatMathVectorFrozenScene;
	sourceOwner: Element;
}>;

export type WechatMathVectorCaptureErrorCode =
	| "atlas-invalid"
	| "baseline-invalid"
	| "clip-invalid"
	| "font-face-ambiguous"
	| "font-face-missing"
	| "font-face-unloaded"
	| "font-transform-unsupported"
	| "fragment-invalid"
	| "geometry-invalid"
	| "inline-unsupported"
	| "glyph-missing"
	| "marker-invalid"
	| "mask-unsupported"
	| "matrix-invalid"
	| "pairing-invalid"
	| "paint-invalid"
	| "path-invalid"
	| "source-text-mismatch"
	| "viewport-invalid";

export class WechatMathVectorCaptureError extends Error {
	readonly code: WechatMathVectorCaptureErrorCode;

	constructor(code: WechatMathVectorCaptureErrorCode) {
		super(`wechat-math-vector-capture-${code}`);
		this.name = "WechatMathVectorCaptureError";
		this.code = code;
	}
}

function captureError(
	code: WechatMathVectorCaptureErrorCode,
): WechatMathVectorCaptureError {
	return new WechatMathVectorCaptureError(code);
}

function finite(
	value: unknown,
	code: WechatMathVectorCaptureErrorCode,
): number {
	if ("number" !== typeof value || !Number.isFinite(value))
		throw captureError(code);
	return value;
}

function runtimeNumber(
	value: unknown,
	code: WechatMathVectorCaptureErrorCode,
): number {
	const number = finite(value, code);
	return Object.is(number, -0) ? 0 : number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && "object" === typeof value && !Array.isArray(value);
}

function hasExactKeys(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const ownKeys = Reflect.ownKeys(value);
	return (
		ownKeys.length === keys.length && keys.every((key) => ownKeys.includes(key))
	);
}

function matrixRecord(
	value: unknown,
	code: WechatMathVectorCaptureErrorCode = "matrix-invalid",
): WechatMathVectorMatrix {
	if (!value || ("object" !== typeof value && "function" !== typeof value))
		throw captureError(code);
	try {
		const matrix = Object.freeze({
			a: runtimeNumber((value as { a?: unknown }).a, code),
			b: runtimeNumber((value as { b?: unknown }).b, code),
			c: runtimeNumber((value as { c?: unknown }).c, code),
			d: runtimeNumber((value as { d?: unknown }).d, code),
			e: runtimeNumber((value as { e?: unknown }).e, code),
			f: runtimeNumber((value as { f?: unknown }).f, code),
		});
		const determinant = svgMatrixDeterminant(matrix);
		if (!Number.isFinite(determinant) || determinant === 0)
			throw captureError(code);
		return matrix;
	} catch (error: unknown) {
		if (error instanceof WechatMathVectorCaptureError) throw error;
		throw captureError(code);
	}
}

function inverseMatrix(value: WechatMathVectorMatrix): WechatMathVectorMatrix {
	const determinant = svgMatrixDeterminant(value);
	if (!Number.isFinite(determinant) || determinant === 0)
		throw captureError("matrix-invalid");
	return matrixRecord({
		a: value.d / determinant,
		b: -value.b / determinant,
		c: -value.c / determinant,
		d: value.a / determinant,
		e: (value.c * value.f - value.d * value.e) / determinant,
		f: (value.b * value.e - value.a * value.f) / determinant,
	});
}

function solidPaint(value: unknown, allowNone = false): string {
	if ("string" !== typeof value) throw captureError("paint-invalid");
	const trimmed = value.trim();
	const normalized = trimmed.toLowerCase();
	if (
		!trimmed ||
		!SOLID_PAINT.test(trimmed) ||
		(!allowNone && EMPTY_PAINT.has(normalized)) ||
		normalized === "currentcolor" ||
		normalized.startsWith("context-") ||
		normalized.startsWith("url(") ||
		normalized.startsWith("var(")
	) {
		throw captureError("paint-invalid");
	}
	return trimmed;
}

function opacity(value: unknown): number {
	const candidate = "string" === typeof value ? Number(value.trim()) : value;
	const number = finite(
		undefined === candidate ? 1 : candidate,
		"paint-invalid",
	);
	if (number < 0 || number > 1) throw captureError("paint-invalid");
	return runtimeNumber(number, "paint-invalid");
}

function resolvedPaint(value: unknown): WechatMathVectorResolvedPaint {
	if (!hasExactKeys(value, ["fill", "opacity", "stroke", "strokeWidth"]))
		throw captureError("paint-invalid");
	return Object.freeze({
		fill: solidPaint(value.fill, true),
		opacity: opacity(value.opacity),
		stroke: solidPaint(value.stroke, true),
		strokeWidth: (() => {
			const width = finite(value.strokeWidth, "paint-invalid");
			if (width < 0) throw captureError("paint-invalid");
			return runtimeNumber(width, "paint-invalid");
		})(),
	});
}

function pathIsValid(pathData: unknown): pathData is string {
	if ("string" !== typeof pathData || !pathData.trim())
		throw captureError("path-invalid");
	try {
		const commands = SVGPathData.parse(pathData);
		if (!commands.length) throw captureError("path-invalid");
		for (const command of commands) {
			for (const value of Object.values(command)) {
				if ("number" === typeof value && !Number.isFinite(value))
					throw captureError("path-invalid");
			}
		}
	} catch (error: unknown) {
		if (error instanceof WechatMathVectorCaptureError) throw error;
		throw captureError("path-invalid");
	}
	return true;
}

function styleValue(
	runtime: BrowserWechatClipboardRuntime,
	element: Element,
	property: string,
): string {
	return runtime.getComputedStyle(element).getPropertyValue(property).trim();
}

function elementRect(
	element: Element,
	code: WechatMathVectorCaptureErrorCode,
): DOMRect {
	const rect = element.getBoundingClientRect();
	for (const value of [
		rect.left,
		rect.top,
		rect.right,
		rect.bottom,
		rect.width,
		rect.height,
	])
		finite(value, code);
	return rect;
}

function layoutPresent(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
): boolean {
	return (
		runtime
			.getComputedStyle(element)
			.getPropertyValue("display")
			.trim()
			.toLowerCase() !== "none"
	);
}

function textStream(root: Element): string {
	const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
	let value = "";
	let node = walker.nextNode();
	while (node) {
		value += node.textContent ?? "";
		node = walker.nextNode();
	}
	return value;
}

function isMathMlText(node: Text): boolean {
	let current: Element | null = node.parentElement;
	while (current) {
		if (
			current.classList.contains("katex-mathml") ||
			current.localName.toLowerCase() === "math" ||
			current.localName.toLowerCase() === "annotation" ||
			current.namespaceURI === MATHML_NAMESPACE
		)
			return true;
		current = current.parentElement;
	}
	return false;
}

function isExactRendererStrut(
	sourceText: Text,
	measurementText: Text,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
): boolean {
	if (
		sourceText.data !== RENDERER_STRUT ||
		measurementText.data !== RENDERER_STRUT
	)
		return false;
	const sourceS = sourceText.parentElement;
	const measurementS = measurementText.parentElement;
	const sourceR = sourceS?.parentElement;
	const measurementR = measurementS?.parentElement;
	const sourceT = sourceR?.parentElement;
	const measurementT = measurementR?.parentElement;
	if (
		!sourceS ||
		!measurementS ||
		!sourceR ||
		!measurementR ||
		!sourceT ||
		!measurementT
	)
		return false;
	if (
		!sourceS.classList.contains("vlist-s") ||
		sourceS.childNodes.length !== 1 ||
		sourceS.firstChild !== sourceText ||
		!measurementS.classList.contains("vlist-s") ||
		measurementS.childNodes.length !== 1 ||
		measurementS.firstChild !== measurementText ||
		!sourceR.classList.contains("vlist-r") ||
		!measurementR.classList.contains("vlist-r") ||
		!sourceT.classList.contains("vlist-t") ||
		!sourceT.classList.contains("vlist-t2") ||
		!measurementT.classList.contains("vlist-t") ||
		!measurementT.classList.contains("vlist-t2")
	)
		return false;
	return (
		lease.measurementFor(sourceS) === measurementS &&
		lease.sourceFor(measurementS) === sourceS &&
		lease.measurementFor(sourceR) === measurementR &&
		lease.sourceFor(measurementR) === sourceR &&
		lease.measurementFor(sourceT) === measurementT &&
		lease.sourceFor(measurementT) === sourceT
	);
}

function codepoints(
	value: string,
): ReadonlyArray<Readonly<{ codepoint: number; end: number; start: number }>> {
	const result: Array<
		Readonly<{ codepoint: number; end: number; start: number }>
	> = [];
	for (let start = 0; start < value.length; ) {
		const codepoint = value.codePointAt(start);
		if (undefined === codepoint) throw captureError("source-text-mismatch");
		const end = start + (codepoint > 0xffff ? 2 : 1);
		result.push(Object.freeze({ codepoint, end, start }));
		start = end;
	}
	return result;
}

function getPairedText(
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	sourceText: Text,
): Text {
	const sourceParent = sourceText.parentElement;
	if (!sourceParent) throw captureError("pairing-invalid");
	const measurementParent = lease.measurementFor(sourceParent);
	if (!measurementParent || lease.sourceFor(measurementParent) !== sourceParent)
		throw captureError("pairing-invalid");
	const index = Array.from(sourceParent.childNodes).indexOf(sourceText);
	const measurementNode = measurementParent.childNodes[index];
	if (
		!(measurementNode instanceof Text) ||
		measurementNode.data !== sourceText.data
	)
		throw captureError("source-text-mismatch");
	return measurementNode;
}

function verifyPairTree(
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	source: Node,
	measurement: Node,
): void {
	if (source.nodeType !== measurement.nodeType)
		throw captureError("pairing-invalid");
	if (source.nodeType === TEXT_NODE) {
		if (source.textContent !== measurement.textContent)
			throw captureError("source-text-mismatch");
		return;
	}
	if (
		source.nodeType !== ELEMENT_NODE ||
		measurement.nodeType !== ELEMENT_NODE
	) {
		if (source.nodeValue !== measurement.nodeValue)
			throw captureError("pairing-invalid");
		return;
	}
	const sourceElement = source as Element;
	const measurementElement = measurement as Element;
	if (
		sourceElement.localName !== measurementElement.localName ||
		sourceElement.namespaceURI !== measurementElement.namespaceURI ||
		lease.measurementFor(sourceElement) !== measurementElement ||
		lease.sourceFor(measurementElement) !== sourceElement
	)
		throw captureError("pairing-invalid");
	const sourceChildren = Array.from(source.childNodes);
	const measurementChildren = Array.from(measurement.childNodes);
	if (sourceChildren.length !== measurementChildren.length)
		throw captureError("pairing-invalid");
	sourceChildren.forEach((child, index) => {
		const paired = measurementChildren[index];
		if (!paired) throw captureError("pairing-invalid");
		verifyPairTree(lease, child, paired);
	});
}

function directVisualRect(
	_owner: Element,
	measurementOwner: Element,
	runtime: BrowserWechatClipboardRuntime,
): { ownerRect: DOMRect; visualRect: WechatMathVectorRect; html: Element } {
	const html = measurementOwner.matches(".katex-html")
		? measurementOwner
		: measurementOwner.querySelector(".katex-html");
	if (!html || !layoutPresent(html, runtime))
		throw captureError("viewport-invalid");
	const ownerDomRect = elementRect(measurementOwner, "viewport-invalid");
	const directChildren = Array.from(html.children).filter((child) =>
		layoutPresent(child, runtime),
	);
	const rects = directChildren
		.map((child) => elementRect(child, "viewport-invalid"))
		.filter((item) => item.width > 0 && item.height > 0);
	if (!rects.length) throw captureError("viewport-invalid");
	const left = Math.min(...rects.map((item) => item.left));
	const top = Math.min(...rects.map((item) => item.top));
	const right = Math.max(...rects.map((item) => item.right));
	const bottom = Math.max(...rects.map((item) => item.bottom));
	const width = right - left;
	const height = bottom - top;
	if (!(width > 0) || !(height > 0)) throw captureError("viewport-invalid");
	return {
		html,
		ownerRect: ownerDomRect,
		visualRect: Object.freeze({
			height: runtimeNumber(height, "viewport-invalid"),
			width: runtimeNumber(width, "viewport-invalid"),
			x: runtimeNumber(left - ownerDomRect.left, "viewport-invalid"),
			y: runtimeNumber(top - ownerDomRect.top, "viewport-invalid"),
		}),
	};
}

type InlineCaptureContext = Readonly<{
	parent: Element;
	owner: Element;
	ownerRect: DOMRect;
	visualRect: WechatMathVectorRect;
	marginTop: number;
	marginRight: number;
	marginBottom: number;
	marginLeft: number;
	overflowX: WechatVisualInlineOverflow;
	overflowY: WechatVisualInlineOverflow;
	display: "inline-block" | "inline-flex";
	verticalAlign: string;
	writingMode: string;
}>;

function cssLength(
	value: string,
	code: WechatMathVectorCaptureErrorCode,
): number {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed || trimmed === "auto" || trimmed === "0") return 0;
	const match = /^(?:[+-]?\d+(?:\.\d*)?|[+-]?\.\d+)px$/iu.exec(trimmed);
	if (!match) throw captureError(code);
	return runtimeNumber(Number.parseFloat(match[0]), code);
}

function computedBorderWidth(
	style: CSSStyleDeclaration,
	side: "bottom" | "left" | "right" | "top",
): number {
	const styleValue = style
		.getPropertyValue(`border-${side}-style`)
		.trim()
		.toLowerCase();
	if (styleValue === "none" || styleValue === "hidden") return 0;
	const property = `border-${side}-width`;
	const normalized = style.getPropertyValue(property).trim().toLowerCase();
	if (!normalized) throw captureError("geometry-invalid");
	if (normalized === "0") return 0;
	const match = /^((?:\d+(?:\.\d*)?|\.\d+))px$/iu.exec(normalized);
	const parsed = match ? Number.parseFloat(match[1] ?? "") : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < 0)
		throw captureError("geometry-invalid");
	return runtimeNumber(parsed, "geometry-invalid");
}

function computedNonnegativeLength(
	style: CSSStyleDeclaration,
	property: string,
): number {
	const normalized = style.getPropertyValue(property).trim().toLowerCase();
	if (!normalized || normalized === "auto")
		throw captureError("geometry-invalid");
	if (normalized === "0") return 0;
	const match = /^((?:\d+(?:\.\d*)?|\.\d+))px$/iu.exec(normalized);
	const parsed = match ? Number.parseFloat(match[1] ?? "") : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < 0)
		throw captureError("geometry-invalid");
	return runtimeNumber(parsed, "geometry-invalid");
}

function allocationEdges(
	sourceOwner: Element,
	runtime: BrowserWechatClipboardRuntime,
): WechatMathVectorAllocation["edges"] {
	const style = runtime.getComputedStyle(sourceOwner);
	return Object.freeze({
		borderBottom: computedBorderWidth(style, "bottom"),
		borderLeft: computedBorderWidth(style, "left"),
		borderRight: computedBorderWidth(style, "right"),
		borderTop: computedBorderWidth(style, "top"),
		marginLeft: cssLength(
			style.getPropertyValue("margin-left"),
			"inline-unsupported",
		),
		marginRight: cssLength(
			style.getPropertyValue("margin-right"),
			"inline-unsupported",
		),
		paddingBottom: computedNonnegativeLength(style, "padding-bottom"),
		paddingLeft: computedNonnegativeLength(style, "padding-left"),
		paddingRight: computedNonnegativeLength(style, "padding-right"),
		paddingTop: computedNonnegativeLength(style, "padding-top"),
	});
}

function inlineOverflow(value: string): WechatVisualInlineOverflow {
	const normalized = value.trim().toLowerCase();
	return ["auto", "clip", "hidden", "scroll", "visible"].includes(normalized)
		? (normalized as WechatVisualInlineOverflow)
		: "visible";
}

function unsupportedInlineProperty(
	value: string,
	allowed: readonly string[],
): boolean {
	const normalized = value.trim().toLowerCase();
	return Boolean(normalized && !allowed.includes(normalized));
}

function createInlineCaptureContext(
	owner: Element,
	measurementOwner: Element,
	runtime: BrowserWechatClipboardRuntime,
	ownerRect: DOMRect,
	visualRect: WechatMathVectorRect,
): InlineCaptureContext | null {
	const style = runtime.getComputedStyle(measurementOwner);
	const display = style.getPropertyValue("display").trim().toLowerCase();
	if (display === "inline") throw captureError("inline-unsupported");
	if (display !== "inline-block" && display !== "inline-flex") return null;
	const parent = measurementOwner.parentElement;
	if (!parent) throw captureError("pairing-invalid");
	if (
		unsupportedInlineProperty(style.getPropertyValue("float"), ["none"]) ||
		unsupportedInlineProperty(style.getPropertyValue("position"), ["static"]) ||
		unsupportedInlineProperty(style.getPropertyValue("transform"), ["none"]) ||
		unsupportedInlineProperty(style.getPropertyValue("writing-mode"), [
			"horizontal-tb",
		])
	)
		throw captureError("inline-unsupported");
	for (const property of [
		"break-before",
		"break-after",
		"break-inside",
		"column-break-before",
		"column-break-after",
		"column-break-inside",
	]) {
		if (
			unsupportedInlineProperty(style.getPropertyValue(property), [
				"auto",
				"avoid",
				"initial",
				"inherit",
				"",
			])
		)
			throw captureError("inline-unsupported");
	}
	if (!(ownerRect.width > 0) || !(ownerRect.height > 0))
		throw captureError("viewport-invalid");
	return Object.freeze({
		parent,
		owner,
		ownerRect,
		visualRect,
		marginTop: cssLength(
			style.getPropertyValue("margin-top"),
			"inline-unsupported",
		),
		marginRight: cssLength(
			style.getPropertyValue("margin-right"),
			"inline-unsupported",
		),
		marginBottom: cssLength(
			style.getPropertyValue("margin-bottom"),
			"inline-unsupported",
		),
		marginLeft: cssLength(
			style.getPropertyValue("margin-left"),
			"inline-unsupported",
		),
		overflowX: inlineOverflow(style.getPropertyValue("overflow-x")),
		overflowY: inlineOverflow(style.getPropertyValue("overflow-y")),
		display: display as "inline-block" | "inline-flex",
		verticalAlign: style
			.getPropertyValue("vertical-align")
			.trim()
			.toLowerCase(),
		writingMode:
			style.getPropertyValue("writing-mode").trim().toLowerCase() ||
			"horizontal-tb",
	});
}

function inlineSnapshotElements(
	context: InlineCaptureContext,
): readonly Element[] {
	const elements = new Set<Element>();
	let current: Element | null = context.parent;
	while (current) {
		elements.add(current);
		Array.from(current.children).forEach((child) => {
			elements.add(child);
		});
		current = current.parentElement;
	}
	const html = context.owner.matches(".katex-html")
		? context.owner
		: context.owner.querySelector(".katex-html");
	if (html)
		Array.from(html.children).forEach((child) => {
			elements.add(child);
		});
	return Object.freeze(Array.from(elements));
}

function inlineLayoutFromBaseline(
	context: InlineCaptureContext,
	parentBaseline: number,
): Readonly<{
	inlineLayout: WechatVisualInlineLayout;
	baselineHeight: number;
}> {
	const allocationTop = context.ownerRect.top - context.marginTop;
	const allocationHeight =
		context.ownerRect.height + context.marginTop + context.marginBottom;
	const decoratedHeight = context.ownerRect.height;
	if (!(allocationHeight > 0)) throw captureError("inline-unsupported");
	const allocationBottom = allocationTop + allocationHeight;
	const baseline = runtimeNumber(
		parentBaseline - allocationTop,
		"baseline-invalid",
	);
	const baselineHeight = runtimeNumber(
		parentBaseline - allocationBottom,
		"baseline-invalid",
	);
	const viewport = Object.freeze({
		height: runtimeNumber(decoratedHeight, "viewport-invalid"),
		offsetX: runtimeNumber(
			context.ownerRect.left - context.ownerRect.left,
			"viewport-invalid",
		),
		offsetY: runtimeNumber(
			context.ownerRect.top - allocationTop,
			"viewport-invalid",
		),
		width: runtimeNumber(context.ownerRect.width, "viewport-invalid"),
	});
	const inlineLayout: WechatVisualInlineLayout = Object.freeze({
		baseline,
		height: runtimeNumber(allocationHeight, "viewport-invalid"),
		overflowX: context.overflowX,
		overflowY: context.overflowY,
		paintOffsetX: runtimeNumber(
			context.ownerRect.left - context.ownerRect.left + context.visualRect.x,
			"viewport-invalid",
		),
		paintOffsetY: runtimeNumber(
			context.ownerRect.top - allocationTop + context.visualRect.y,
			"viewport-invalid",
		),
		viewport,
		width: runtimeNumber(context.ownerRect.width, "viewport-invalid"),
	});
	return { inlineLayout, baselineHeight };
}

function computedGeometry(
	owner: Element,
	measurementOwner: Element,
	runtime: BrowserWechatClipboardRuntime,
	visualRect: WechatMathVectorRect,
	ownerRect: DOMRect,
	inline: InlineCaptureContext | null,
	inlineLayout: WechatVisualInlineLayout | null,
): CaptureGeometry {
	const computed = runtime.getComputedStyle(measurementOwner);
	const parent = measurementOwner.parentElement;
	const parentStyle = parent ? runtime.getComputedStyle(parent) : null;
	const overflowX = computed
		.getPropertyValue("overflow-x")
		.trim()
		.toLowerCase();
	const overflowY = computed
		.getPropertyValue("overflow-y")
		.trim()
		.toLowerCase();
	const overflowValues = new Set([
		"auto",
		"clip",
		"hidden",
		"scroll",
		"visible",
	]);
	const inlineOverflow = inline
		? { x: inline.overflowX, y: inline.overflowY }
		: overflowValues.has(overflowX) && overflowValues.has(overflowY)
			? {
					x: overflowX as "auto" | "clip" | "hidden" | "scroll" | "visible",
					y: overflowY as "auto" | "clip" | "hidden" | "scroll" | "visible",
				}
			: null;
	const role = mathCloneRole(owner);
	const requiresBaseline = Boolean(
		inline || (role && ["katex", "html"].includes(role)),
	);
	const typed = snapshotMathCaptureNode(owner, runtime.getComputedStyle(owner));
	const shells = Array.from(
		owner.querySelectorAll(".katex-display, .katex, .katex-html"),
	).map((element) => {
		return snapshotMathCaptureNode(element, runtime.getComputedStyle(element));
	});
	const mathContent = isMathBlockContentCaptureSnapshot({
		owner: typed,
		shells,
	});
	const formattingOwnerDisplay =
		parentStyle?.getPropertyValue("display").trim().toLowerCase() || null;
	const decision = mathOuterAllocationDecision(
		owner,
		runtime.getComputedStyle(owner),
		runtime.getComputedStyle.bind(runtime),
		formattingOwnerDisplay,
		false,
	);
	const width =
		inlineLayout?.width ??
		(ownerRect.width > 0 ? ownerRect.width : visualRect.width);
	const height =
		inlineLayout?.height ??
		(ownerRect.height > 0 ? ownerRect.height : visualRect.height);
	if (!(width > 0) || !(height > 0)) throw captureError("viewport-invalid");
	const typographyStyle = inline && parentStyle ? parentStyle : computed;
	const typography = Object.freeze(
		[
			"font-family",
			"font-size",
			"font-style",
			"font-weight",
			"letter-spacing",
			"line-height",
			"word-spacing",
		].map((property) =>
			Object.freeze({
				property,
				value: typographyStyle.getPropertyValue(property).trim(),
			}),
		),
	);
	return Object.freeze({
		height,
		inlineOverflow,
		inlineLayout,
		originX: visualRect.x,
		originY: visualRect.y,
		preservesInlineConstraints:
			Boolean(inline) || !mathContent || !decision.authoredOuterWidthNeutral,
		requiresBaseline,
		typography,
		width,
	});
}

function normalizeFamily(value: unknown): string {
	if ("string" !== typeof value) return "";
	const first = value.split(",")[0]?.trim() ?? "";
	return first
		.replace(/^("|')(.*)\1$/u, "$2")
		.trim()
		.toLowerCase();
}

function normalizeDescriptor(
	value: unknown,
	property: "font-style" | "font-weight" | "font-stretch",
): string {
	const normalized =
		"string" === typeof value ? value.trim().toLowerCase() : "";
	if (property === "font-weight") {
		if (!normalized || normalized === "normal") return "400";
		if (normalized === "bold") return "700";
	}
	if (property === "font-stretch") {
		if (!normalized || normalized === "normal" || normalized === "100%")
			return "normal";
	}
	return normalized || "normal";
}

function descriptor(face: FontFaceCandidate, property: string): string {
	const prefix = `${property}:`;
	return (
		face.descriptors
			.find((item) => item.trim().toLowerCase().startsWith(prefix))
			?.slice(prefix.length)
			.trim() ?? ""
	);
}

function basename(value: string): string {
	const withoutQuery = value.split(/[?#]/u)[0] ?? value;
	const slash = withoutQuery.lastIndexOf("/");
	return (
		slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery
	).toLowerCase();
}

function fontStem(value: string): string {
	return basename(value).replace(/\.[a-z0-9]+$/iu, "");
}

function validateAtlas(atlas: WechatMathVectorAtlas): void {
	if (
		atlas?.schema !== "easymde-katex-glyph-atlas/1" ||
		atlas.serialization?.coordinateSystem !== "font-units-y-up" ||
		atlas.serialization?.decimalPlaces !== 6 ||
		atlas.serialization?.flipY !== false ||
		atlas.serialization?.optimize !== false ||
		!Array.isArray(atlas.fonts)
	)
		throw captureError("atlas-invalid");
}

function atlasFontForFace(
	face: FontFaceCandidate,
	atlas: WechatMathVectorAtlas,
): WechatMathVectorAtlas["fonts"][number] {
	const sourceNames = face.sources.map((source) => basename(source.url));
	const sourceStems = face.sources.map((source) => fontStem(source.url));
	const matches = atlas.fonts.filter((font) => {
		const file = basename(font.file);
		const stem = fontStem(font.file);
		return (
			sourceNames.includes(file) ||
			sourceNames.some(
				(source) => source.endsWith(file) || file.endsWith(source),
			) ||
			sourceStems.includes(stem)
		);
	});
	if (matches.length !== 1) throw captureError("font-face-missing");
	const font = matches[0];
	if (
		!font?.file ||
		!Number.isInteger(font.unitsPerEm) ||
		font.unitsPerEm <= 0 ||
		!Array.isArray(font.cmap) ||
		!Array.isArray(font.glyphs)
	) {
		throw captureError("atlas-invalid");
	}
	const glyphIds = new Set<number>();
	for (const glyph of font.glyphs) {
		if (
			!isRecord(glyph) ||
			"number" !== typeof glyph.id ||
			!Number.isInteger(glyph.id) ||
			glyphIds.has(glyph.id)
		)
			throw captureError("atlas-invalid");
		glyphIds.add(glyph.id);
	}
	const cmap = new Map<number, number>();
	for (const entry of font.cmap) {
		if (
			!isRecord(entry) ||
			!Number.isInteger(entry.codepoint) ||
			!Number.isInteger(entry.glyphId)
		) {
			throw captureError("atlas-invalid");
		}
		const codepoint = entry.codepoint;
		const glyphId = entry.glyphId;
		if (
			"number" !== typeof codepoint ||
			"number" !== typeof glyphId ||
			cmap.has(codepoint) ||
			!glyphIds.has(glyphId)
		)
			throw captureError("atlas-invalid");
		cmap.set(codepoint, glyphId);
	}
	return font;
}

function registeredFontFaces(
	document: Document,
): readonly Record<string, unknown>[] {
	const fonts = (document as Document & { fonts?: unknown }).fonts;
	if (!fonts || ("object" !== typeof fonts && "function" !== typeof fonts))
		return [];
	try {
		if (Symbol.iterator in Object(fonts))
			return Array.from(fonts as Iterable<unknown>).filter(isRecord);
	} catch {
		// The collection is an admission witness. An unreadable collection fails at the caller.
	}
	const result: Record<string, unknown>[] = [];
	const forEach = (fonts as { forEach?: unknown }).forEach;
	if ("function" === typeof forEach) {
		(forEach as (callback: (value: unknown) => void) => void).call(
			fonts,
			(value) => {
				if (isRecord(value)) result.push(value);
			},
		);
	}
	return result;
}

function assertFontTransformChain(
	measurementText: Text,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
): void {
	let current = measurementText.parentElement;
	while (current) {
		const transform = runtime
			.getComputedStyle(current)
			.getPropertyValue("transform")
			.trim()
			.toLowerCase();
		if (transform && transform !== "none")
			throw captureError("font-transform-unsupported");
		if (current === measurementRoot) return;
		current = current.parentElement;
	}
	throw captureError("pairing-invalid");
}

const MASK_FAMILIES = [
	{ image: "mask-image", shorthand: "mask" },
	{ image: "-webkit-mask-image", shorthand: "-webkit-mask" },
	{ image: "mask-border-source", shorthand: "mask-border" },
	{
		image: "-webkit-mask-box-image-source",
		shorthand: "-webkit-mask-box-image",
	},
] as const;
function nonNoneMaskValue(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return Boolean(normalized && normalized !== "none");
}

function computedMaskValue(
	element: Element,
	style: CSSStyleDeclaration,
	property: string,
): string {
	const direct = style.getPropertyValue(property);
	if (direct) return direct;
	const css = element.ownerDocument.defaultView?.CSS;
	// Typed OM throws for unknown properties in some engines. Only query an
	// alias after the engine explicitly accepts it; CSSOM values above remain
	// authoritative when Typed OM or CSS.supports is unavailable.
	if (
		!css ||
		"function" !== typeof css.supports ||
		!css.supports(property, "none")
	)
		return "";
	const styleMap = (
		element as Element & {
			computedStyleMap?: () => { get?: (name: string) => unknown };
		}
	).computedStyleMap;
	if ("function" !== typeof styleMap) return "";
	try {
		const value = styleMap.call(element)?.get?.(property) as
			| { toString?: () => string; value?: unknown }
			| undefined;
		if ("string" === typeof value?.value) return value.value;
		if ("function" === typeof value?.toString) return value.toString();
	} catch {
		throw captureError("mask-unsupported");
	}
	return "";
}

function unsupportedDescendantMask(
	element: Element,
	style: CSSStyleDeclaration,
): boolean {
	return MASK_FAMILIES.some(({ image, shorthand }) => {
		// A readable image/source longhand owns the family. Chromium still
		// serializes placement-only mask configurations in the shorthand, so
		// consulting it first would invent paint for `mask-image: none`.
		const imageValue = computedMaskValue(element, style, image);
		if (imageValue) return nonNoneMaskValue(imageValue);
		return nonNoneMaskValue(computedMaskValue(element, style, shorthand));
	});
}

function assertReplacedDescendantMasks(
	measurementOwner: Element,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
): void {
	const ownerChain: Element[] = [];
	let ancestor: Element | null = measurementOwner;
	while (ancestor) {
		ownerChain.unshift(ancestor);
		if (ancestor === measurementRoot) break;
		ancestor = ancestor.parentElement;
	}
	if (!ownerChain.length || ownerChain[0] !== measurementRoot)
		throw captureError("pairing-invalid");

	let inheritedVisibility: "hidden" | "visible" = "visible";
	let inheritedOpacity = 1;
	for (const element of ownerChain) {
		const style = runtime.getComputedStyle(element);
		const display = style.getPropertyValue("display").trim().toLowerCase();
		const contentVisibility = style
			.getPropertyValue("content-visibility")
			.trim()
			.toLowerCase();
		// These states cannot be overridden by a descendant.
		if (display === "none" || contentVisibility === "hidden") return;
		const visibility = style
			.getPropertyValue("visibility")
			.trim()
			.toLowerCase();
		if (visibility === "visible") inheritedVisibility = "visible";
		else if (visibility === "hidden" || visibility === "collapse")
			inheritedVisibility = "hidden";
		inheritedOpacity = runtimeNumber(
			inheritedOpacity * opacity(style.getPropertyValue("opacity") || 1),
			"paint-invalid",
		);
	}

	const pending = Array.from(measurementOwner.children)
		.reverse()
		.map((element) => ({
			element,
			opacity: inheritedOpacity,
			unsupportedMask: false,
			visibility: inheritedVisibility,
		}));
	while (pending.length) {
		const current = pending.pop();
		if (!current) throw captureError("pairing-invalid");
		const style = runtime.getComputedStyle(current.element);
		const display = style.getPropertyValue("display").trim().toLowerCase();
		const contentVisibility = style
			.getPropertyValue("content-visibility")
			.trim()
			.toLowerCase();
		if (display === "none" || contentVisibility === "hidden") continue;

		const visibilityValue = style
			.getPropertyValue("visibility")
			.trim()
			.toLowerCase();
		const visibility =
			visibilityValue === "visible"
				? "visible"
				: visibilityValue === "hidden" || visibilityValue === "collapse"
					? "hidden"
					: current.visibility;
		const elementOpacity = runtimeNumber(
			current.opacity * opacity(style.getPropertyValue("opacity") || 1),
			"paint-invalid",
		);
		// Opacity and display omission cannot be restored by descendants.
		if (elementOpacity === 0) continue;
		// Masks composite visible descendants even when this wrapper is hidden
		// but a child restores visibility. Carry that paint dependency separately.
		const unsupportedMask =
			current.unsupportedMask ||
			unsupportedDescendantMask(current.element, style);
		if (visibility === "visible" && unsupportedMask)
			throw captureError("mask-unsupported");
		for (const element of Array.from(current.element.children).reverse()) {
			pending.push({
				element,
				opacity: elementOpacity,
				unsupportedMask,
				visibility,
			});
		}
	}
}

/**
 * Admit one source primitive for the detached scene. The chain ends at the
 * paired measurement root so the intentional host opacity is never folded
 * into source paint. Visibility may be overridden by a visible descendant;
 * display/content-visibility and opacity cannot. Masks on the retained owner
 * shell and its outside context are preserved; masks on replaced descendants
 * are unsupported because the generated scene cannot reproduce them.
 */
function sourcePaintAdmitted(
	element: Element,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
	isSvgPrimitive = false,
): boolean {
	const chain: Element[] = [];
	let current: Element | null = element;
	while (current) {
		chain.unshift(current);
		if (current === measurementRoot) break;
		current = current.parentElement;
	}
	if (!chain.length || chain[0] !== measurementRoot)
		throw captureError("pairing-invalid");

	let effectiveVisibility: "hidden" | "visible" = "visible";
	let effectiveOpacity = 1;
	for (const candidate of chain) {
		const style = runtime.getComputedStyle(candidate);
		const display = style.getPropertyValue("display").trim().toLowerCase();
		const contentVisibility = style
			.getPropertyValue("content-visibility")
			.trim()
			.toLowerCase();
		if (display === "none" || contentVisibility === "hidden") return false;

		const visibility = style
			.getPropertyValue("visibility")
			.trim()
			.toLowerCase();
		if (visibility === "visible") effectiveVisibility = "visible";
		else if (visibility === "hidden" || visibility === "collapse")
			effectiveVisibility = "hidden";

		const elementOpacity = opacity(style.getPropertyValue("opacity") || 1);
		effectiveOpacity = runtimeNumber(
			effectiveOpacity * elementOpacity,
			"paint-invalid",
		);
	}
	if (effectiveVisibility === "hidden" || effectiveOpacity === 0) return false;
	if (effectiveOpacity !== 1) throw captureError("paint-invalid");

	if (isSvgPrimitive) {
		for (const candidate of chain) {
			const style = runtime.getComputedStyle(candidate);
			for (const property of ["fill-opacity", "stroke-opacity"]) {
				const value = opacity(style.getPropertyValue(property) || 1);
				if (value !== 1) throw captureError("paint-invalid");
			}
		}
	}
	return true;
}

function fontForText(
	measurementText: Text,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
	managedFaces: readonly FontFaceCandidate[],
	atlas: WechatMathVectorAtlas,
): {
	face: FontFaceCandidate;
	font: WechatMathVectorAtlas["fonts"][number];
	fontSize: number;
	fill: string;
} {
	const parent = measurementText.parentElement;
	if (!parent) throw captureError("font-face-missing");
	const style = runtime.getComputedStyle(parent);
	const family = normalizeFamily(style.getPropertyValue("font-family"));
	const expectedStyle = normalizeDescriptor(
		style.getPropertyValue("font-style"),
		"font-style",
	);
	const expectedWeight = normalizeDescriptor(
		style.getPropertyValue("font-weight"),
		"font-weight",
	);
	const expectedStretch = normalizeDescriptor(
		style.getPropertyValue("font-stretch"),
		"font-stretch",
	);
	assertFontTransformChain(measurementText, measurementRoot, runtime);
	const variation = style
		.getPropertyValue("font-variation-settings")
		.trim()
		.toLowerCase();
	if (variation && variation !== "normal" && variation !== "none")
		throw captureError("font-transform-unsupported");
	const candidates = managedFaces.filter(
		(face) =>
			face.familyKey === family &&
			face.sources.length > 0 &&
			normalizeDescriptor(descriptor(face, "font-style"), "font-style") ===
				expectedStyle &&
			normalizeDescriptor(descriptor(face, "font-weight"), "font-weight") ===
				expectedWeight &&
			normalizeDescriptor(descriptor(face, "font-stretch"), "font-stretch") ===
				expectedStretch,
	);
	if (candidates.length !== 1)
		throw captureError(
			candidates.length ? "font-face-ambiguous" : "font-face-missing",
		);
	const face = candidates[0];
	if (!face) throw captureError("font-face-missing");
	const witnesses = registeredFontFaces(runtime.document).filter(
		(registered) =>
			registered.status === "loaded" &&
			normalizeFamily(registered.family) === family &&
			normalizeDescriptor(registered.style, "font-style") === expectedStyle &&
			normalizeDescriptor(registered.weight, "font-weight") ===
				expectedWeight &&
			normalizeDescriptor(registered.stretch, "font-stretch") ===
				expectedStretch,
	);
	if (!witnesses.length) throw captureError("font-face-unloaded");
	if (witnesses.length !== 1) throw captureError("font-face-ambiguous");
	const font = atlasFontForFace(face, atlas);
	const fontSizeMatch = /^(?:[+-]?\d+(?:\.\d*)?|[+-]?\.\d+)px$/iu.exec(
		style.getPropertyValue("font-size").trim(),
	);
	if (!fontSizeMatch) throw captureError("font-face-missing");
	const fontSize = Number.parseFloat(fontSizeMatch[0]);
	if (!Number.isFinite(fontSize) || fontSize <= 0)
		throw captureError("font-face-missing");
	const color =
		style.getPropertyValue("color").trim() ||
		style.getPropertyValue("fill").trim();
	return {
		face,
		fill: solidPaint(color),
		font,
		fontSize: runtimeNumber(fontSize, "font-face-missing"),
	};
}

function codepointMap(
	font: WechatMathVectorAtlas["fonts"][number],
): Map<number, number> {
	const map = new Map<number, number>();
	for (const entry of font.cmap) map.set(entry.codepoint, entry.glyphId);
	return map;
}

type RunCapture = {
	fill: string;
	fontFile: string;
	fontSize: number;
	font: WechatMathVectorAtlas["fonts"][number];
	glyphs: readonly Readonly<{
		codepoint: number;
		end: number;
		start: number;
	}>[];
	measurementText: Text;
	sourceText: Text;
	parent: Element;
};

function sourceTextNodes(owner: Element): Text[] {
	const walker = owner.ownerDocument.createTreeWalker(owner, SHOW_TEXT);
	const nodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		const text = node as Text;
		if (!isMathMlText(text)) nodes.push(text);
		node = walker.nextNode();
	}
	return nodes;
}

function cssBorderWidth(style: CSSStyleDeclaration, property: string): number {
	const value = style.getPropertyValue(property).trim();
	if (!value) return 0;
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed) || parsed < 0)
		throw captureError("geometry-invalid");
	return parsed;
}

function emptyBackgroundPaint(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		!normalized ||
		EMPTY_PAINT.has(normalized) ||
		ZERO_ALPHA_COLOR.test(normalized)
	);
}

function unsupportedBackgroundPaint(style: CSSStyleDeclaration): boolean {
	const image = style.getPropertyValue("background-image").trim().toLowerCase();
	if (image && image !== "none") return true;
	const background = style.getPropertyValue("background").trim().toLowerCase();
	return /url\s*\(|(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/iu.test(
		background,
	);
}

function rulePaints(
	_owner: Element,
	measurementOwner: Element,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
	ownerRect: DOMRect,
): readonly WechatMathVectorRulePaint[] {
	const candidates = Array.from(measurementOwner.querySelectorAll("*"));
	const output: WechatMathVectorRulePaint[] = [];
	for (const element of candidates) {
		if (
			element.classList.contains("katex") ||
			element.classList.contains("katex-html") ||
			element.classList.contains("katex-display") ||
			element.classList.contains("easymde-math-block") ||
			element.classList.contains("easymde-math-inline")
		)
			continue;
		if (!sourcePaintAdmitted(element, measurementRoot, runtime)) continue;
		const style = runtime.getComputedStyle(element);
		const classRule = Array.from(element.classList).some((name) =>
			RULE_CLASSES.test(name),
		);
		const borders = {
			bottom: cssBorderWidth(style, "border-bottom-width"),
			left: cssBorderWidth(style, "border-left-width"),
			right: cssBorderWidth(style, "border-right-width"),
			top: cssBorderWidth(style, "border-top-width"),
		};
		const background = style.getPropertyValue("background-color").trim();
		const hasBackground = !emptyBackgroundPaint(background);
		const hasUnsupportedBackground = unsupportedBackgroundPaint(style);
		if (hasUnsupportedBackground) throw captureError("paint-invalid");
		if (
			!classRule &&
			!hasBackground &&
			!Object.values(borders).some((value) => value > 0)
		)
			continue;
		const box = elementRect(element, "geometry-invalid");
		if (!(box.width > 0) || !(box.height > 0))
			throw captureError("geometry-invalid");
		if (hasBackground) {
			output.push(
				Object.freeze({
					fill: solidPaint(background),
					height: runtimeNumber(box.height, "geometry-invalid"),
					opacity: 1,
					width: runtimeNumber(box.width, "geometry-invalid"),
					x: runtimeNumber(box.left - ownerRect.left, "geometry-invalid"),
					y: runtimeNumber(box.top - ownerRect.top, "geometry-invalid"),
				}),
			);
		}
		const addBorder = (
			side: "bottom" | "left" | "right" | "top",
			colorProperty: string,
			styleProperty: string,
		): void => {
			const thickness = borders[side];
			const borderStyle = style
				.getPropertyValue(styleProperty)
				.trim()
				.toLowerCase();
			if (thickness <= 0 || borderStyle === "none" || borderStyle === "hidden")
				return;
			const color = style.getPropertyValue(colorProperty).trim();
			if (!color || EMPTY_PAINT.has(color.toLowerCase())) return;
			const fill = solidPaint(color);
			const width =
				"left" === side || "right" === side
					? Math.min(thickness, box.width)
					: box.width;
			const height =
				"top" === side || "bottom" === side
					? Math.min(thickness, box.height)
					: box.height;
			if (!(width > 0) || !(height > 0)) throw captureError("geometry-invalid");
			const x = "right" === side ? box.right - width : box.left;
			const y = "bottom" === side ? box.bottom - height : box.top;
			output.push(
				Object.freeze({
					fill,
					height: runtimeNumber(height, "geometry-invalid"),
					opacity: 1,
					width: runtimeNumber(width, "geometry-invalid"),
					x: runtimeNumber(x - ownerRect.left, "geometry-invalid"),
					y: runtimeNumber(y - ownerRect.top, "geometry-invalid"),
				}),
			);
		};
		addBorder("top", "border-top-color", "border-top-style");
		addBorder("right", "border-right-color", "border-right-style");
		addBorder("bottom", "border-bottom-color", "border-bottom-style");
		addBorder("left", "border-left-color", "border-left-style");
	}
	return Object.freeze(output);
}

function svgAttributeNumber(
	element: Element,
	attribute: string,
	runtime: BrowserWechatClipboardRuntime,
): number {
	const attr = element.getAttribute(attribute)?.trim() ?? "";
	const numeric = /^(?:[+-]?\d+(?:\.\d*)?|[+-]?\.\d+)(?:px)?$/iu;
	const raw = numeric.test(attr)
		? attr
		: runtime.getComputedStyle(element).getPropertyValue(attribute).trim();
	const match = /^(?:[+-]?\d+(?:\.\d*)?|[+-]?\.\d+)(?:px)?$/iu.exec(raw);
	if (!match) throw captureError("clip-invalid");
	return runtimeNumber(Number.parseFloat(match[0]), "clip-invalid");
}

function elementScreenMatrix(element: Element): WechatMathVectorMatrix {
	const getter = (element as Element & { getScreenCTM?: () => unknown })
		.getScreenCTM;
	if ("function" !== typeof getter) throw captureError("matrix-invalid");
	return matrixRecord(getter.call(element));
}

function clipForSvg(
	svg: Element,
	pathMatrix: WechatMathVectorMatrix,
	runtime: BrowserWechatClipboardRuntime,
): WechatMathVectorRect {
	const width = svgAttributeNumber(svg, "width", runtime);
	const height = svgAttributeNumber(svg, "height", runtime);
	const viewBoxValue = svg.getAttribute("viewBox");
	const preserve = parseSvgPreserveAspectRatioAttribute(
		svg.getAttribute("preserveAspectRatio") ?? "",
	);
	const viewBox = viewBoxValue ? parseSvgViewBoxAttribute(viewBoxValue) : null;
	const viewportMatrix = viewBox
		? svgViewBoxToViewportTransform(viewBox, { width, height }, preserve)
		: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
	const ctm = elementScreenMatrix(svg);
	const clipToScreen = multiplySvgMatrices(ctm, inverseMatrix(viewportMatrix));
	const local = multiplySvgMatrices(inverseMatrix(pathMatrix), clipToScreen);
	for (const value of [local.a, local.b, local.c, local.d, local.e, local.f])
		finite(value, "clip-invalid");
	if (local.b !== 0 || local.c !== 0) throw captureError("clip-invalid");
	const points = [
		applySvgMatrixToPoint(local, { x: 0, y: 0 }),
		applySvgMatrixToPoint(local, { x: width, y: 0 }),
		applySvgMatrixToPoint(local, { x: 0, y: height }),
		applySvgMatrixToPoint(local, { x: width, y: height }),
	];
	const xs = points.map((point) => runtimeNumber(point.x, "clip-invalid"));
	const ys = points.map((point) => runtimeNumber(point.y, "clip-invalid"));
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	const clipWidth = Math.max(...xs) - x;
	const clipHeight = Math.max(...ys) - y;
	if (!(clipWidth > 0) || !(clipHeight > 0)) throw captureError("clip-invalid");
	return Object.freeze({
		height: runtimeNumber(clipHeight, "clip-invalid"),
		width: runtimeNumber(clipWidth, "clip-invalid"),
		x: runtimeNumber(x, "clip-invalid"),
		y: runtimeNumber(y, "clip-invalid"),
	});
}

function markerRect(value: DOMRect): Readonly<{
	bottom: number;
	height: number;
	left: number;
	top: number;
	width: number;
}> {
	for (const field of [
		value.left,
		value.top,
		value.width,
		value.height,
		value.right,
		value.bottom,
	])
		finite(field, "marker-invalid");
	return Object.freeze({
		bottom: value.bottom,
		height: value.height,
		left: value.left,
		top: value.top,
		width: value.width,
	});
}

type GeometrySnapshot = Readonly<{
	children: ReadonlyMap<Node, readonly Node[]>;
	rects: ReadonlyMap<
		Element,
		Readonly<{
			bottom: number;
			height: number;
			left: number;
			top: number;
			width: number;
		}>
	>;
	ranges: ReadonlyMap<
		Text,
		readonly Readonly<{
			bottom: number;
			height: number;
			left: number;
			top: number;
			width: number;
		}>[]
	>;
}>;

function rectSnapshot(element: Element): Readonly<{
	bottom: number;
	height: number;
	left: number;
	top: number;
	width: number;
}> {
	return markerRect(element.getBoundingClientRect());
}

function snapshotGeometry(
	owner: Element,
	runs: readonly RunCapture[],
	extraElements: readonly Element[] = [],
): GeometrySnapshot {
	const elements = new Set<Element>([owner, ...extraElements]);
	if (owner.parentElement) elements.add(owner.parentElement);
	const children = new Map<Node, readonly Node[]>();
	const rects = new Map<
		Element,
		Readonly<{
			bottom: number;
			height: number;
			left: number;
			top: number;
			width: number;
		}>
	>();
	for (const run of runs) {
		elements.add(run.parent);
		if (run.parent.parentElement) elements.add(run.parent.parentElement);
	}
	for (const element of elements) {
		children.set(element, Object.freeze(Array.from(element.childNodes)));
		rects.set(element, rectSnapshot(element));
	}
	const ranges = new Map<
		Text,
		readonly Readonly<{
			bottom: number;
			height: number;
			left: number;
			top: number;
			width: number;
		}>[]
	>();
	for (const run of runs) {
		const range = run.measurementText.ownerDocument.createRange();
		const values: Array<
			Readonly<{
				bottom: number;
				height: number;
				left: number;
				top: number;
				width: number;
			}>
		> = [];
		try {
			for (const item of run.glyphs) {
				range.setStart(run.measurementText, item.start);
				range.setEnd(run.measurementText, item.end);
				values.push(
					rectSnapshot({
						getBoundingClientRect: () => range.getBoundingClientRect(),
					} as unknown as Element),
				);
			}
		} finally {
			range.detach?.();
		}
		ranges.set(run.measurementText, Object.freeze(values));
	}
	return { children, rects, ranges };
}

function closeEnough(a: number, b: number): boolean {
	return Math.abs(a - b) <= GEOMETRY_QUANTUM;
}

function assertGeometryUnchanged(
	before: GeometrySnapshot,
	after: GeometrySnapshot,
): void {
	const keys: readonly ("bottom" | "height" | "left" | "top" | "width")[] = [
		"bottom",
		"height",
		"left",
		"top",
		"width",
	];
	for (const [element, beforeRect] of before.rects) {
		const afterRect = after.rects.get(element);
		if (
			!afterRect ||
			!keys.every((key) => closeEnough(beforeRect[key], afterRect[key]))
		) {
			throw captureError("marker-invalid");
		}
	}
	for (const [text, beforeRanges] of before.ranges) {
		const afterRanges = after.ranges.get(text);
		if (!afterRanges || afterRanges.length !== beforeRanges.length)
			throw captureError("marker-invalid");
		beforeRanges.forEach((beforeRect, index) => {
			const afterRect = afterRanges[index];
			if (
				!afterRect ||
				!keys.every((key) => closeEnough(beforeRect[key], afterRect[key]))
			) {
				throw captureError("marker-invalid");
			}
		});
	}
}

function assertChildrenRestored(
	before: GeometrySnapshot,
	after: GeometrySnapshot,
): void {
	for (const [parent, children] of before.children) {
		const restored = after.children.get(parent);
		if (
			!restored ||
			restored.length !== children.length ||
			restored.some((child, index) => child !== children[index])
		) {
			throw captureError("marker-invalid");
		}
	}
}

type BaselineCaptureResult = Readonly<{
	runs: readonly WechatMathVectorGlyphRun[];
	inlineLayout: WechatVisualInlineLayout | null;
	baselineHeight: number | null;
}>;

function baselineRuns(
	_owner: Element,
	measurementOwner: Element,
	runs: readonly RunCapture[],
	viewport: WechatMathVectorRect,
	_runtime: BrowserWechatClipboardRuntime,
	inline: InlineCaptureContext | null,
): BaselineCaptureResult {
	if (!runs.length && !inline)
		return Object.freeze({
			baselineHeight: null,
			inlineLayout: null,
			runs: Object.freeze([]),
		});
	const extraElements = inline ? inlineSnapshotElements(inline) : [];
	const before = snapshotGeometry(measurementOwner, runs, extraElements);
	const markers: Array<{ marker: HTMLSpanElement; run: RunCapture }> = [];
	const probes: HTMLSpanElement[] = [];
	let result: readonly WechatMathVectorGlyphRun[] | null = null;
	let inlineLayout: WechatVisualInlineLayout | null = null;
	let baselineHeight: number | null = null;
	let failure: unknown = null;
	let parentBaseline: number | null = null;
	try {
		if (inline) {
			const beforeProbe = measurementOwner.ownerDocument.createElement("span");
			const afterProbe = measurementOwner.ownerDocument.createElement("span");
			const probeStyle =
				"display:inline-block !important;width:0 !important;height:0 !important;margin:0 !important;padding:0 !important;border:0 !important;vertical-align:baseline !important;overflow:hidden !important;";
			beforeProbe.style.cssText = probeStyle;
			afterProbe.style.cssText = probeStyle;
			inline.parent.insertBefore(beforeProbe, measurementOwner);
			inline.parent.insertBefore(afterProbe, measurementOwner.nextSibling);
			probes.push(beforeProbe, afterProbe);
			const beforeBaseline = markerRect(beforeProbe.getBoundingClientRect());
			const afterBaseline = markerRect(afterProbe.getBoundingClientRect());
			if (
				beforeBaseline.width !== 0 ||
				beforeBaseline.height !== 0 ||
				afterBaseline.width !== 0 ||
				afterBaseline.height !== 0 ||
				!closeEnough(beforeBaseline.bottom, afterBaseline.bottom)
			)
				throw captureError("marker-invalid");
			parentBaseline = runtimeNumber(beforeBaseline.bottom, "baseline-invalid");
		}
		for (const run of runs) {
			const marker = measurementOwner.ownerDocument.createElement("span");
			marker.style.cssText =
				"display:inline-block !important;width:0 !important;height:0 !important;margin:0 !important;padding:0 !important;border:0 !important;vertical-align:baseline !important;overflow:hidden !important;";
			run.parent.insertBefore(marker, run.measurementText.nextSibling);
			markers.push({ marker, run });
		}
		const during = snapshotGeometry(measurementOwner, runs, extraElements);
		assertGeometryUnchanged(before, during);
		if (inline) {
			const beforeProbe = probes[0];
			const afterProbe = probes[1];
			if (!beforeProbe || !afterProbe) throw captureError("marker-invalid");
			const beforeBaseline = markerRect(beforeProbe.getBoundingClientRect());
			const afterBaseline = markerRect(afterProbe.getBoundingClientRect());
			if (
				beforeBaseline.width !== 0 ||
				beforeBaseline.height !== 0 ||
				afterBaseline.width !== 0 ||
				afterBaseline.height !== 0 ||
				!closeEnough(beforeBaseline.bottom, afterBaseline.bottom) ||
				parentBaseline === null ||
				!closeEnough(parentBaseline, beforeBaseline.bottom)
			)
				throw captureError("marker-invalid");
			parentBaseline = runtimeNumber(beforeBaseline.bottom, "baseline-invalid");
		}
		const ownerRect = elementRect(measurementOwner, "baseline-invalid");
		const output: WechatMathVectorGlyphRun[] = [];
		for (const { marker, run } of markers) {
			const markerValue = markerRect(marker.getBoundingClientRect());
			if (markerValue.width !== 0 || markerValue.height !== 0)
				throw captureError("marker-invalid");
			const baselineY = runtimeNumber(
				markerValue.bottom - ownerRect.top,
				"baseline-invalid",
			);
			const minY = viewport.y;
			const maxY = viewport.y + viewport.height;
			if (
				baselineY < minY - GEOMETRY_QUANTUM ||
				baselineY > maxY + GEOMETRY_QUANTUM
			)
				throw captureError("baseline-invalid");
			const glyphs = run.glyphs.map((item) => {
				const range = run.measurementText.ownerDocument.createRange();
				try {
					range.setStart(run.measurementText, item.start);
					range.setEnd(run.measurementText, item.end);
					const value = markerRect(range.getBoundingClientRect());
					return Object.freeze({
						codepoint: item.codepoint,
						x: runtimeNumber(value.left - ownerRect.left, "baseline-invalid"),
					});
				} finally {
					range.detach?.();
				}
			});
			output.push(
				Object.freeze({
					baselineY,
					fill: run.fill,
					fontFile: run.fontFile,
					fontSize: run.fontSize,
					glyphs: Object.freeze(glyphs),
				}),
			);
		}
		result = Object.freeze(output);
		if (inline) {
			if (parentBaseline === null) throw captureError("baseline-invalid");
			const allocation = inlineLayoutFromBaseline(inline, parentBaseline);
			inlineLayout = allocation.inlineLayout;
			baselineHeight = allocation.baselineHeight;
		}
	} catch (error: unknown) {
		failure = error;
	}
	for (const { marker } of markers) {
		try {
			marker.remove();
		} catch (error: unknown) {
			failure ??= error;
		}
	}
	for (const probe of probes) {
		try {
			probe.remove();
		} catch (error: unknown) {
			failure ??= error;
		}
	}
	if (
		markers.some(({ marker }) => marker.parentNode) ||
		probes.some((probe) => probe.parentNode)
	)
		failure ??= captureError("marker-invalid");
	try {
		const after = snapshotGeometry(measurementOwner, runs, extraElements);
		assertGeometryUnchanged(before, after);
		assertChildrenRestored(before, after);
	} catch (error: unknown) {
		failure ??= error;
	}
	if (failure) throw failure;
	if (!result) throw captureError("baseline-invalid");
	return Object.freeze({ baselineHeight, inlineLayout, runs: result });
}

function getSvgPaint(
	runtime: BrowserWechatClipboardRuntime,
	element: Element,
): WechatMathVectorResolvedPaint {
	const style = runtime.getComputedStyle(element);
	return resolvedPaint({
		fill:
			style.getPropertyValue("fill").trim() ||
			element.getAttribute("fill") ||
			"none",
		opacity:
			style.getPropertyValue("opacity").trim() ||
			element.getAttribute("opacity") ||
			1,
		stroke:
			style.getPropertyValue("stroke").trim() ||
			element.getAttribute("stroke") ||
			"none",
		strokeWidth: Number.parseFloat(
			style.getPropertyValue("stroke-width").trim() ||
				element.getAttribute("stroke-width") ||
				"0",
		),
	});
}

function validateSvgRoot(element: Element): void {
	const allowed = new Set([
		"width",
		"height",
		"viewbox",
		"preserveaspectratio",
		"overflow",
		"x",
		"y",
	]);
	for (const attribute of Array.from(element.attributes)) {
		const name = attribute.name.toLowerCase();
		if (
			!allowed.has(name) ||
			name.startsWith("on") ||
			name === "href" ||
			name.endsWith(":href")
		)
			throw captureError("fragment-invalid");
		if (/\\|url\s*\(|var\s*\(/iu.test(attribute.value))
			throw captureError("paint-invalid");
	}
}

function validateSvgAttributes(element: Element, kind: "path" | "line"): void {
	const allowed =
		"path" === kind
			? new Set(["d", "fill", "stroke", "stroke-width", "opacity", "transform"])
			: new Set([
					"x1",
					"x2",
					"y1",
					"y2",
					"fill",
					"stroke",
					"stroke-width",
					"opacity",
					"transform",
				]);
	for (const attribute of Array.from(element.attributes)) {
		const name = attribute.name.toLowerCase();
		if (
			!allowed.has(name) ||
			name.startsWith("on") ||
			name === "href" ||
			name.endsWith(":href")
		)
			throw captureError("fragment-invalid");
		if (/\\|url\s*\(|var\s*\(/iu.test(attribute.value))
			throw captureError("paint-invalid");
	}
}

function svgFragmentsForOwner(
	owner: Element,
	measurementOwner: Element,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	runtime: BrowserWechatClipboardRuntime,
	ownerRect: DOMRect,
): readonly WechatMathVectorFrozenSvgFragment[] {
	const sourceSvgs = Array.from(owner.querySelectorAll("svg"));
	const fragments: WechatMathVectorFrozenSvgFragment[] = [];
	for (const sourceSvg of sourceSvgs) {
		const measurementSvg = lease.measurementFor(sourceSvg);
		if (
			!measurementSvg ||
			lease.sourceFor(measurementSvg) !== sourceSvg ||
			sourceSvg.namespaceURI !== SVG_NAMESPACE ||
			measurementSvg.namespaceURI !== SVG_NAMESPACE
		)
			throw captureError("fragment-invalid");
		validateSvgRoot(sourceSvg);
		const descendants = Array.from(sourceSvg.querySelectorAll("*"));
		if (
			descendants.some(
				(element) =>
					element.namespaceURI !== SVG_NAMESPACE ||
					!["path", "line"].includes(element.localName.toLowerCase()),
			)
		)
			throw captureError("fragment-invalid");
		const sourceChildren = Array.from(sourceSvg.children);
		const measurementChildren = Array.from(measurementSvg.children);
		if (
			!sourceChildren.length ||
			sourceChildren.length !== measurementChildren.length
		)
			throw captureError("fragment-invalid");
		for (let index = 0; index < sourceChildren.length; index += 1) {
			const sourceChild = sourceChildren[index];
			const measurementChild = measurementChildren[index];
			if (
				!sourceChild ||
				!measurementChild ||
				!["path", "line"].includes(sourceChild.localName.toLowerCase()) ||
				!["path", "line"].includes(measurementChild.localName.toLowerCase()) ||
				sourceChild.localName !== measurementChild.localName ||
				lease.measurementFor(sourceChild) !== measurementChild ||
				lease.sourceFor(measurementChild) !== sourceChild
			)
				throw captureError("fragment-invalid");
			const kind = sourceChild.localName.toLowerCase() as "path" | "line";
			validateSvgAttributes(sourceChild, kind);
			validateSvgAttributes(measurementChild, kind);
			const pathData =
				"path" === kind ? measurementChild.getAttribute("d") : null;
			if (
				"path" === kind &&
				(pathData !== sourceChild.getAttribute("d") || !pathIsValid(pathData))
			)
				throw captureError("path-invalid");
			let lineValues: readonly [number, number, number, number] | null = null;
			if ("line" === kind) {
				const values = ["x1", "x2", "y1", "y2"].map((attribute) => {
					const sourceValue = sourceChild.getAttribute(attribute);
					const measurementValue = measurementChild.getAttribute(attribute);
					if (sourceValue !== measurementValue || !measurementValue)
						throw captureError("fragment-invalid");
					return runtimeNumber(Number(measurementValue), "fragment-invalid");
				});
				if (values.length !== 4) throw captureError("fragment-invalid");
				lineValues = [
					values[0] as number,
					values[1] as number,
					values[2] as number,
					values[3] as number,
				];
			}
			if (!sourcePaintAdmitted(measurementChild, lease.root, runtime, true))
				continue;
			const paint = getSvgPaint(runtime, measurementChild);
			if (paint.opacity === 0) continue;
			if (paint.opacity !== 1) throw captureError("paint-invalid");
			const pathMatrixScreen = elementScreenMatrix(measurementChild);
			const relativeCtm = matrixRecord({
				a: pathMatrixScreen.a,
				b: pathMatrixScreen.b,
				c: pathMatrixScreen.c,
				d: pathMatrixScreen.d,
				e: pathMatrixScreen.e - ownerRect.left,
				f: pathMatrixScreen.f - ownerRect.top,
			});
			const child: WechatMathVectorFrozenSvgChild =
				"path" === kind
					? Object.freeze({
							kind: "path",
							paint,
							pathData: pathData as string,
						})
					: (() => {
							if (!lineValues) throw captureError("fragment-invalid");
							const [x1, x2, y1, y2] = lineValues;
							return Object.freeze({
								kind: "line",
								paint,
								x1,
								x2,
								y1,
								y2,
							});
						})();
			const clips: Array<
				WechatMathVectorFrozenSvgFragment["nestedClipViewportRects"][number]
			> = [];
			let current: Element | null = measurementSvg;
			while (current && current !== measurementOwner.parentElement) {
				if (
					current.namespaceURI === SVG_NAMESPACE &&
					current.localName.toLowerCase() === "svg"
				) {
					const overflow =
						styleValue(runtime, current, "overflow").toLowerCase() ||
						current.getAttribute("overflow")?.trim().toLowerCase() ||
						"";
					if (overflow === "hidden" || overflow === "clip") {
						const clip = clipForSvg(current, pathMatrixScreen, runtime);
						clips.push(
							Object.freeze({
								height: clip.height,
								transform: "none" as const,
								unit: "userSpaceOnUse" as const,
								width: clip.width,
								x: clip.x,
								y: clip.y,
							}),
						);
					}
				}
				current = current.parentElement;
			}
			fragments.push(
				Object.freeze({
					children: Object.freeze([child]),
					nestedClipViewportRects: Object.freeze(clips),
					relativeCtm,
				}),
			);
		}
	}
	return Object.freeze(fragments);
}

function captureOwner(
	sourceOwner: Element,
	options: WechatMathVectorCaptureOptions,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
): WechatMathVectorCapturedScene {
	const measurementOwner = lease.measurementFor(sourceOwner);
	if (!measurementOwner || lease.sourceFor(measurementOwner) !== sourceOwner)
		throw captureError("pairing-invalid");
	verifyPairTree(lease, sourceOwner, measurementOwner);
	if (textStream(sourceOwner) !== textStream(measurementOwner))
		throw captureError("source-text-mismatch");
	assertReplacedDescendantMasks(measurementOwner, lease.root, options.runtime);
	const { ownerRect: ownerDomRect, visualRect } = directVisualRect(
		sourceOwner,
		measurementOwner,
		options.runtime,
	);
	const inline = createInlineCaptureContext(
		sourceOwner,
		measurementOwner,
		options.runtime,
		ownerDomRect,
		visualRect,
	);
	const visualTexts = sourceTextNodes(sourceOwner);
	const runs: RunCapture[] = [];
	let nonStrutVisualTextCount = 0;
	for (const sourceText of visualTexts) {
		const measurementText = getPairedText(lease, sourceText);
		if (isExactRendererStrut(sourceText, measurementText, lease)) continue;
		const textParent = measurementText.parentElement;
		if (!textParent) throw captureError("pairing-invalid");
		if (!sourcePaintAdmitted(textParent, lease.root, options.runtime)) continue;
		nonStrutVisualTextCount += 1;
		const font = fontForText(
			measurementText,
			lease.root,
			options.runtime,
			options.managedFaces,
			options.atlas,
		);
		const parent = measurementText.parentElement;
		if (!parent) throw captureError("pairing-invalid");
		const glyphs = codepoints(sourceText.data);
		const cmap = codepointMap(font.font);
		for (const item of glyphs)
			if (!cmap.has(item.codepoint)) throw captureError("glyph-missing");
		runs.push({
			fill: font.fill,
			font: font.font,
			fontFile: font.font.file,
			fontSize: font.fontSize,
			glyphs,
			measurementText,
			parent,
			sourceText,
		});
	}
	if (nonStrutVisualTextCount > 0 && !runs.length)
		throw captureError("baseline-invalid");
	const baselineCapture = baselineRuns(
		sourceOwner,
		measurementOwner,
		runs,
		visualRect,
		options.runtime,
		inline,
	);
	const geometry = computedGeometry(
		sourceOwner,
		measurementOwner,
		options.runtime,
		visualRect,
		ownerDomRect,
		inline,
		baselineCapture.inlineLayout,
	);
	const viewport = Object.freeze({
		height: visualRect.height,
		viewBox: visualRect,
		width: visualRect.width,
	});
	const scene: WechatMathVectorFrozenScene = Object.freeze({
		rulePaint: rulePaints(
			sourceOwner,
			measurementOwner,
			lease.root,
			options.runtime,
			ownerDomRect,
		),
		runs: baselineCapture.runs,
		svgFragments: svgFragmentsForOwner(
			sourceOwner,
			measurementOwner,
			lease,
			options.runtime,
			ownerDomRect,
		),
		viewport,
	});
	const allocation: WechatMathVectorAllocation = Object.freeze({
		edges: allocationEdges(sourceOwner, options.runtime),
		geometry,
		ownerRect: Object.freeze({
			height: ownerDomRect.height > 0 ? ownerDomRect.height : visualRect.height,
			width: ownerDomRect.width > 0 ? ownerDomRect.width : visualRect.width,
			x: 0,
			y: 0,
		}),
		visualRect,
		baselineHeight: baselineCapture.baselineHeight,
	});
	return Object.freeze({
		allocation,
		replacementShell: sourceOwner,
		scene,
		sourceOwner,
	});
}

function validateSourceOwner(
	owner: Element,
	preview: HTMLElement,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	seenOwners: Set<Element>,
	seenMeasurements: Set<Element>,
): void {
	if (
		!(owner instanceof Element) ||
		!preview.contains(owner) ||
		visualRasterizationKind(owner) !== "math" ||
		hasVisualRasterizationAncestor(owner)
	) {
		throw captureError("pairing-invalid");
	}
	if (seenOwners.has(owner)) throw captureError("pairing-invalid");
	for (const existing of seenOwners)
		if (existing.contains(owner) || owner.contains(existing))
			throw captureError("pairing-invalid");
	const measurement = lease.measurementFor(owner);
	if (!measurement || lease.sourceFor(measurement) !== owner)
		throw captureError("pairing-invalid");
	if (seenMeasurements.has(measurement)) throw captureError("pairing-invalid");
	for (const existing of seenMeasurements)
		if (existing.contains(measurement) || measurement.contains(existing))
			throw captureError("pairing-invalid");
	seenOwners.add(owner);
	seenMeasurements.add(measurement);
}

/**
 * Captures complete detached OFF-math vector scenes from one transferred hidden
 * measurement lease. All source/measurement geometry, fonts, paint and static
 * SVG records are frozen synchronously while the lease is live.
 */
async function captureWechatMathVectorScenesCore(
	options: WechatMathVectorCaptureOptions,
): Promise<readonly WechatMathVectorCapturedScene[]> {
	const { lease } = options.measurement;
	if (
		options.preview !== lease.sourceRoot ||
		lease.sourceGeometryReference !== "measurement"
	)
		throw captureError("pairing-invalid");
	const assertCurrent = (): void => {
		assertCopyGuardCurrent({
			signal: options.signal,
			isCurrent: options.isCurrent,
		});
		if (
			!previewMeasurementLeaseSourceMatches(
				lease,
				options.preview,
				options.runtime,
			)
		)
			throw new Error("wechat-copy-stale");
	};
	assertCurrent();
	if (!options.sourceOwners.length) return Object.freeze([]);
	await waitForPreviewMeasurement(lease.ready, options.signal);
	assertCurrent();
	if (!lease.isReady()) throw captureError("pairing-invalid");
	validateAtlas(options.atlas);
	const seenOwners = new Set<Element>();
	const seenMeasurements = new Set<Element>();
	for (const owner of options.sourceOwners)
		validateSourceOwner(
			owner,
			options.preview,
			lease,
			seenOwners,
			seenMeasurements,
		);
	const result = options.sourceOwners.map((owner) => {
		assertCurrent();
		return captureOwner(owner, options, lease);
	});
	assertCurrent();
	return Object.freeze(result);
}

/**
 * Captures from a measurement lease whose cleanup remains owned by the caller.
 * The caller must keep the lease alive through its final freshness checks and
 * release it exactly once after the complete serialization transaction.
 */
export function captureWechatMathVectorScenesWithBorrowedMeasurement(
	options: WechatMathVectorCaptureOptions,
): Promise<readonly WechatMathVectorCapturedScene[]> {
	return captureWechatMathVectorScenesCore(options);
}

/**
 * Captures and consumes one transferred measurement lease. Existing callers
 * retain this ownership contract; the borrowed entry is used by a surrounding
 * serialization transaction that must keep the lease through final checks.
 */
export async function captureWechatMathVectorScenes(
	options: WechatMathVectorCaptureOptions,
): Promise<readonly WechatMathVectorCapturedScene[]> {
	let cleaned = false;
	try {
		return await captureWechatMathVectorScenesCore(options);
	} finally {
		if (!cleaned) {
			cleaned = true;
			options.measurement.cleanup();
		}
	}
}
