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
	mathCloneRole,
	mathOuterAllocationDecision,
} from "./wechat-clone-metadata";
import type { CaptureGeometry } from "./wechat-math-capture-geometry";
import {
	captureError,
	elementRect,
	finite,
	GEOMETRY_QUANTUM,
	type InlineCaptureContext,
	layoutPresent,
	type RunCapture,
	runtimeNumber,
	type WechatMathVectorAllocation,
	type WechatMathVectorCaptureErrorCode,
} from "./wechat-math-vector-capture-primitives";
import type {
	WechatMathVectorGlyphRun,
	WechatMathVectorRect,
} from "./wechat-math-vector-scene";

export function directVisualRect(
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

export function allocationEdges(
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

export function createInlineCaptureContext(
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

export function computedGeometry(
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
	const resolvedInlineOverflow = inline
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
		inlineOverflow: resolvedInlineOverflow,
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

export type BaselineCaptureResult = Readonly<{
	runs: readonly WechatMathVectorGlyphRun[];
	inlineLayout: WechatVisualInlineLayout | null;
	baselineHeight: number | null;
}>;

export function baselineRuns(
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
