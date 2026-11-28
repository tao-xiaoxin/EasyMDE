import { SVGPathData } from "svg-pathdata";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	captureError,
	EMPTY_PAINT,
	elementRect,
	finite,
	inverseMatrix,
	matrixRecord,
	RULE_CLASSES,
	resolvedPaint,
	runtimeNumber,
	SVG_NAMESPACE,
	solidPaint,
	sourcePaintAdmitted,
	styleValue,
	WechatMathVectorCaptureError,
	ZERO_ALPHA_COLOR,
} from "./wechat-math-vector-capture-primitives";
import type {
	WechatMathVectorFrozenSvgChild,
	WechatMathVectorFrozenSvgFragment,
	WechatMathVectorMatrix,
	WechatMathVectorRect,
	WechatMathVectorResolvedPaint,
	WechatMathVectorRulePaint,
} from "./wechat-math-vector-scene";
import type { AcquiredPreviewGeometryMeasurement } from "./wechat-preview-geometry-cache";
import {
	applySvgMatrixToPoint,
	multiplySvgMatrices,
	parseSvgPreserveAspectRatioAttribute,
	parseSvgViewBoxAttribute,
	svgViewBoxToViewportTransform,
} from "./wechat-svg-marker-geometry";

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

export function rulePaints(
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

export function svgFragmentsForOwner(
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
