import type { WechatVisualInlineOverflow } from "../../../contracts/ports/wechat-visual-rasterization-port";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { FontFaceCandidate } from "./wechat-managed-fonts";
import type { CaptureGeometry } from "./wechat-math-capture-geometry";
import type {
	WechatMathVectorAtlas,
	WechatMathVectorFrozenScene,
	WechatMathVectorMatrix,
	WechatMathVectorRect,
	WechatMathVectorResolvedPaint,
} from "./wechat-math-vector-scene";
import type { AcquiredPreviewGeometryMeasurement } from "./wechat-preview-geometry-cache";
import { svgMatrixDeterminant } from "./wechat-svg-marker-geometry";

export const TEXT_NODE = 3;
export const ELEMENT_NODE = 1;
export const SHOW_TEXT = 4;
export const GEOMETRY_QUANTUM = 1 / 64;
const SOLID_PAINT = /^[-#a-z0-9().,%\s/]+$/iu;
export const RENDERER_STRUT = "\u200b";
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
export const EMPTY_PAINT = new Set(["none", "transparent"]);
export const ZERO_ALPHA_COLOR =
	/^(?:rgba|hsla)\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*0(?:\.0+)?%?\s*\)$/iu;
export const RULE_CLASSES =
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

export type InlineCaptureContext = Readonly<{
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

export type RunCapture = {
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

export function captureError(
	code: WechatMathVectorCaptureErrorCode,
): WechatMathVectorCaptureError {
	return new WechatMathVectorCaptureError(code);
}

export function finite(
	value: unknown,
	code: WechatMathVectorCaptureErrorCode,
): number {
	if ("number" !== typeof value || !Number.isFinite(value))
		throw captureError(code);
	return value;
}

export function runtimeNumber(
	value: unknown,
	code: WechatMathVectorCaptureErrorCode,
): number {
	const number = finite(value, code);
	return Object.is(number, -0) ? 0 : number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function matrixRecord(
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

export function inverseMatrix(
	value: WechatMathVectorMatrix,
): WechatMathVectorMatrix {
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

export function solidPaint(value: unknown, allowNone = false): string {
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

export function resolvedPaint(value: unknown): WechatMathVectorResolvedPaint {
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

export function styleValue(
	runtime: BrowserWechatClipboardRuntime,
	element: Element,
	property: string,
): string {
	return runtime.getComputedStyle(element).getPropertyValue(property).trim();
}

export function elementRect(
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

export function layoutPresent(
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

export function assertReplacedDescendantMasks(
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
export function sourcePaintAdmitted(
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
