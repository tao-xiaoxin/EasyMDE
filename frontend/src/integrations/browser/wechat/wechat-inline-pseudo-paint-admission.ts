import { SVGPathData } from "svg-pathdata";
import {
	assertPaint,
	EPSILON,
	finitePixels,
	frozen,
	opaqueColor,
	paintFailure,
	supportedStyleValue,
	zeroPixels,
} from "./wechat-inline-pseudo-paint-core";
import type {
	WechatInlinePseudoPaintAnimationInspection,
	WechatInlinePseudoPaintCapabilities,
	WechatInlinePseudoPaintCircleSource,
	WechatInlinePseudoPaintMaskPropertyValues,
	WechatInlinePseudoPaintMaskSource,
	WechatInlinePseudoPaintStyleSnapshot,
} from "./wechat-inline-pseudo-paint-types";
import {
	pseudoSvgContent,
	SAFE_PSEUDO_SVG_ATTRIBUTES,
} from "./wechat-task-paint";

function supportedMaskValue(
	values: WechatInlinePseudoPaintMaskPropertyValues,
	key: keyof WechatInlinePseudoPaintMaskPropertyValues,
): string {
	const state = values[key];
	assertPaint("supported" === state.support, "mask");
	return state.value.toLowerCase();
}

function assertMaskPolicy(
	values: WechatInlinePseudoPaintMaskPropertyValues,
): void {
	assertPaint(
		supportedMaskValue(values, "image") ===
			supportedMaskValue(values, "prefixedImage"),
		"mask",
	);
	assertPaint(
		["match-source", "alpha"].includes(supportedMaskValue(values, "mode")),
		"mask",
	);
	if ("supported" === values.prefixedMode.support) {
		assertPaint(
			["match-source", "alpha"].includes(
				supportedMaskValue(values, "prefixedMode"),
			),
			"mask",
		);
	}
	assertPaint("contain" === supportedMaskValue(values, "size"), "mask");
	assertPaint("contain" === supportedMaskValue(values, "prefixedSize"), "mask");
	assertPaint("no-repeat" === supportedMaskValue(values, "repeat"), "mask");
	assertPaint(
		"no-repeat" === supportedMaskValue(values, "prefixedRepeat"),
		"mask",
	);
	assertPaint("50% 50%" === supportedMaskValue(values, "position"), "mask");
	assertPaint(
		"50% 50%" === supportedMaskValue(values, "prefixedPosition"),
		"mask",
	);
	const composite = supportedMaskValue(values, "composite");
	const prefixedComposite = supportedMaskValue(values, "prefixedComposite");
	assertPaint(["add", "source-over"].includes(composite), "mask");
	assertPaint(["add", "source-over"].includes(prefixedComposite), "mask");
	const origin = supportedMaskValue(values, "origin");
	const prefixedOrigin = supportedMaskValue(values, "prefixedOrigin");
	assertPaint(
		["border-box", "padding-box", "content-box"].includes(origin),
		"mask",
	);
	assertPaint(origin === prefixedOrigin, "mask");
	const clip = supportedMaskValue(values, "clip");
	const prefixedClip = supportedMaskValue(values, "prefixedClip");
	assertPaint(
		["border-box", "padding-box", "content-box"].includes(clip),
		"mask",
	);
	assertPaint(clip === prefixedClip, "mask");
}

function inactiveAnimationPolicy(
	pseudo: WechatInlinePseudoPaintStyleSnapshot,
): boolean {
	return (
		"none" === supportedStyleValue(pseudo, "animation-name").toLowerCase() &&
		/^(?:0s,?\s*)+$/u.test(
			supportedStyleValue(pseudo, "animation-duration").toLowerCase(),
		) &&
		/^(?:0s,?\s*)+$/u.test(
			supportedStyleValue(pseudo, "animation-delay").toLowerCase(),
		) &&
		/^(?:1,?\s*)+$/u.test(
			supportedStyleValue(pseudo, "animation-iteration-count"),
		) &&
		"none" ===
			supportedStyleValue(pseudo, "transition-property").toLowerCase() &&
		/^(?:0s,?\s*)+$/u.test(
			supportedStyleValue(pseudo, "transition-duration").toLowerCase(),
		) &&
		/^(?:0s,?\s*)+$/u.test(
			supportedStyleValue(pseudo, "transition-delay").toLowerCase(),
		)
	);
}

export function assertAnimationProof(
	source: HTMLElement,
	pseudo: WechatInlinePseudoPaintStyleSnapshot,
	capabilities: WechatInlinePseudoPaintCapabilities,
): void {
	assertPaint(
		"none" === supportedStyleValue(pseudo, "animation-name").toLowerCase(),
		"animation",
	);
	if (inactiveAnimationPolicy(pseudo)) return;
	let animations: readonly WechatInlinePseudoPaintAnimationInspection[];
	try {
		animations = capabilities.animations.inspectAnimations(source);
	} catch {
		throw paintFailure("animation");
	}
	assertPaint(Array.isArray(animations), "animation");
	animations.forEach((animation) => {
		assertPaint(Number.isFinite(animation.endTime), "animation");
		assertPaint(!animation.pending, "animation");
		assertPaint(
			!["running", "paused"].includes(animation.playState.toLowerCase()),
			"animation",
		);
		assertPaint("css-animation" !== animation.kind, "animation");
		assertPaint("unknown" !== animation.kind, "animation");
	});
}

function circleRadius(value: string, outerSide: number): number {
	const normalized = value.trim().toLowerCase();
	if ("50%" === normalized) return outerSide / 2;
	if ("100%" === normalized) return outerSide;
	if (!normalized.endsWith("px")) throw paintFailure("geometry");
	return finitePixels(normalized);
}

export function circleRadiusEvidence(value: string, cssSide: number): boolean {
	const normalized = value.trim().toLowerCase();
	if (["50%", "100%"].includes(normalized)) return true;
	if (!normalized.endsWith("px")) return false;
	const match = /^(?:\d+(?:\.\d+)?|\.\d+)px$/u.exec(normalized);
	return Boolean(match) && Number.parseFloat(normalized) >= cssSide / 2;
}

function assertNoOutline(pseudo: WechatInlinePseudoPaintStyleSnapshot): void {
	assertPaint(
		"none" === supportedStyleValue(pseudo, "outline-style").toLowerCase(),
		"admission",
	);
	finitePixels(supportedStyleValue(pseudo, "outline-width"), true);
}

function assertPostCommitCircleGeometry(
	pseudo: WechatInlinePseudoPaintStyleSnapshot,
): Readonly<{
	borderColor: string;
	borderWidth: number;
	fill: string;
	height: number;
	width: number;
}> {
	const boxSizing = supportedStyleValue(pseudo, "box-sizing").toLowerCase();
	assertPaint(["content-box", "border-box"].includes(boxSizing), "geometry");
	const width = finitePixels(supportedStyleValue(pseudo, "width"));
	const height = finitePixels(supportedStyleValue(pseudo, "height"));
	const sides = ["top", "right", "bottom", "left"] as const;
	sides.forEach((side) => {
		assertPaint(
			zeroPixels(supportedStyleValue(pseudo, `padding-${side}`)),
			"geometry",
		);
	});
	const widths = sides.map((side) =>
		finitePixels(supportedStyleValue(pseudo, `border-${side}-width`), true),
	);
	const borderWidth = widths[0] ?? -1;
	const borderColor = supportedStyleValue(pseudo, "border-top-color");
	sides.forEach((side, index) => {
		assertPaint(widths[index] === borderWidth, "geometry");
		assertPaint(
			"solid" ===
				supportedStyleValue(pseudo, `border-${side}-style`).toLowerCase(),
			"geometry",
		);
		assertPaint(
			supportedStyleValue(pseudo, `border-${side}-color`).toLowerCase() ===
				borderColor.toLowerCase(),
			"geometry",
		);
	});
	const outerSide =
		"content-box" === boxSizing ? width + borderWidth * 2 : width;
	const outerHeight =
		"content-box" === boxSizing ? height + borderWidth * 2 : height;
	assertPaint(
		outerSide === outerHeight && outerSide > borderWidth * 2,
		"geometry",
	);
	const radii = [
		"border-top-left-radius",
		"border-top-right-radius",
		"border-bottom-right-radius",
		"border-bottom-left-radius",
	].map((property) =>
		circleRadius(supportedStyleValue(pseudo, property), outerSide),
	);
	assertPaint(
		radii.every((value) => value === radii[0]),
		"geometry",
	);
	// Adjacent corner radii are normalized uniformly when their sum exceeds a
	// side. Equal source radii therefore normalize to one common outer radius.
	assertPaint(
		Math.min(radii[0] ?? 0, outerSide / 2) >= outerSide / 2,
		"geometry",
	);
	const fill = supportedStyleValue(pseudo, "background-color");
	assertPaint(opaqueColor(borderColor) && opaqueColor(fill), "geometry");
	assertPaint(
		"none" === supportedStyleValue(pseudo, "background-image").toLowerCase(),
		"geometry",
	);
	assertNoOutline(pseudo);
	return frozen({
		borderColor,
		borderWidth,
		fill,
		height: outerHeight,
		width: outerSide,
	});
}

export function readCircle(
	pseudo: WechatInlinePseudoPaintStyleSnapshot,
): WechatInlinePseudoPaintCircleSource {
	return assertPostCommitCircleGeometry(pseudo);
}

function assertOriginalMaskAlpha(path: Element): void {
	const attributes = Array.from(path.attributes).map(({ name, value }) =>
		frozen([name, value] as const),
	);
	const allowed = SAFE_PSEUDO_SVG_ATTRIBUTES.path;
	assertPaint(
		attributes.every(([name]) => allowed?.has(name)),
		"mask",
	);
	const read = (name: string): string | undefined =>
		attributes.find(([candidate]) => candidate.toLowerCase() === name)?.[1];
	const fill = read("fill") ?? "black";
	const fillOpacity = read("fill-opacity");
	const stroke = read("stroke");
	const strokeOpacity = read("stroke-opacity");
	const strokeWidth = read("stroke-width");
	assertPaint(opaqueColor(fill), "mask");
	assertPaint(undefined === fillOpacity || Number(fillOpacity) === 1, "mask");
	assertPaint(undefined === stroke || "none" === stroke.toLowerCase(), "mask");
	assertPaint(
		undefined === strokeOpacity || Number(strokeOpacity) === 0,
		"mask",
	);
	assertPaint(undefined === strokeWidth || Number(strokeWidth) === 0, "mask");
	assertPaint(read("d"), "mask");
}

export function readMaskSource(
	source: HTMLElement,
	values: WechatInlinePseudoPaintMaskPropertyValues,
	pseudo: WechatInlinePseudoPaintStyleSnapshot,
): WechatInlinePseudoPaintMaskSource {
	assertMaskPolicy(values);
	["top", "right", "bottom", "left"].forEach((side) => {
		assertPaint(
			zeroPixels(supportedStyleValue(pseudo, `padding-${side}`)),
			"mask",
		);
		assertPaint(
			zeroPixels(supportedStyleValue(pseudo, `border-${side}-width`)),
			"mask",
		);
	});
	[
		"border-top-left-radius",
		"border-top-right-radius",
		"border-bottom-right-radius",
		"border-bottom-left-radius",
	].forEach((property) => {
		assertPaint(zeroPixels(supportedStyleValue(pseudo, property)), "mask");
	});
	assertPaint(
		"none" === supportedStyleValue(pseudo, "background-image").toLowerCase(),
		"mask",
	);
	assertNoOutline(pseudo);
	assertPaint(
		opaqueColor(supportedStyleValue(pseudo, "background-color")),
		"mask",
	);
	const contentWidth = finitePixels(supportedStyleValue(pseudo, "width"));
	const contentHeight = finitePixels(supportedStyleValue(pseudo, "height"));
	const parsed = pseudoSvgContent(
		supportedStyleValue(values, "image"),
		source.ownerDocument,
	);
	assertPaint(parsed, "mask");
	assertPaint(
		!Array.from(parsed.attributes).some(({ name }) =>
			["width", "height"].includes(name.toLowerCase()),
		),
		"mask",
	);
	const viewBox = parsed.getAttribute("viewBox")?.trim() ?? "";
	const numbers = viewBox.split(/[\s,]+/u).map(Number);
	assertPaint(
		numbers.length === 4 &&
			numbers.every(Number.isFinite) &&
			(numbers[2] ?? 0) > 0 &&
			(numbers[3] ?? 0) > 0,
		"mask",
	);
	const intrinsicRatio = (numbers[2] ?? 0) / (numbers[3] ?? 0);
	assertPaint(
		Math.abs(intrinsicRatio - contentWidth / contentHeight) <= EPSILON,
		"mask",
	);
	const rootAllowed = SAFE_PSEUDO_SVG_ATTRIBUTES.svg;
	assertPaint(rootAllowed, "mask");
	assertPaint(
		Array.from(parsed.attributes).every(
			({ name }) =>
				rootAllowed.has(name) || rootAllowed.has(name.toLowerCase()),
		),
		"mask",
	);
	const paths = Array.from(parsed.querySelectorAll("path"));
	assertPaint(
		paths.length > 0 &&
			paths.every(
				(path) => path.parentNode === parsed && path.children.length === 0,
			),
		"mask",
	);
	const viewBoxMinX = numbers[0] ?? 0;
	const viewBoxMinY = numbers[1] ?? 0;
	const viewBoxMaxX = viewBoxMinX + (numbers[2] ?? 0);
	const viewBoxMaxY = viewBoxMinY + (numbers[3] ?? 0);
	const alphaPaths = paths.map((path) => {
		assertOriginalMaskAlpha(path);
		const pathData = path.getAttribute("d")?.trim() ?? "";
		let bounds: ReturnType<SVGPathData["getBounds"]>;
		try {
			bounds = new SVGPathData(pathData).getBounds();
		} catch {
			throw paintFailure("mask");
		}
		assertPaint(
			[bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(
				Number.isFinite,
			) &&
				bounds.minX >= viewBoxMinX &&
				bounds.minY >= viewBoxMinY &&
				bounds.maxX <= viewBoxMaxX &&
				bounds.maxY <= viewBoxMaxY,
			"mask",
		);
		const attributes = Array.from(path.attributes).map(({ name, value }) =>
			frozen([name, value] as const),
		);
		return frozen({ originalAttributes: frozen(attributes) });
	});
	return frozen({
		alphaPaths: frozen(alphaPaths),
		intrinsicRatio,
		geometry: frozen({
			contentBoxHeight: contentHeight,
			contentBoxWidth: contentWidth,
			intrinsicRatioMatchesContentBox: true,
		}),
		mask: values,
		viewBox,
	});
}
