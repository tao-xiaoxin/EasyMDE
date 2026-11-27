import { SVGPathData } from "svg-pathdata";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ATLAS_SCHEMA = "easymde-katex-glyph-atlas/1";
const COORDINATE_SYSTEM = "font-units-y-up";
const DECIMAL_PLACES = 6;

export type WechatMathVectorRect = Readonly<{
	height: number;
	width: number;
	x: number;
	y: number;
}>;

export type WechatMathVectorMatrix = Readonly<{
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}>;

export type WechatMathVectorAtlas = Readonly<{
	fonts: readonly Readonly<{
		cmap: readonly Readonly<{ codepoint: number; glyphId: number }>[];
		file: string;
		glyphs: readonly Readonly<{
			advanceWidth: number;
			id: number;
			outline: Readonly<{ pathData: string }>;
		}>[];
		unitsPerEm: number;
	}>[];
	schema: string;
	serialization: Readonly<{
		coordinateSystem: string;
		decimalPlaces: number;
		flipY: boolean;
		optimize: boolean;
	}>;
}>;

type WechatMathVectorAtlasGlyph =
	WechatMathVectorAtlas["fonts"][number]["glyphs"][number];

type WechatMathVectorValidatedFont = Readonly<{
	glyphsByCodepoint: ReadonlyMap<number, WechatMathVectorAtlasGlyph>;
	unitsPerEm: number;
}>;

type WechatMathVectorValidatedFontIndex = ReadonlyMap<
	string,
	WechatMathVectorValidatedFont
>;

export type WechatMathVectorGlyphPosition = Readonly<{
	codepoint: number;
	x: number;
}>;

export type WechatMathVectorGlyphRun = Readonly<{
	baselineY: number;
	fill: string;
	fontFile: string;
	fontSize: number;
	glyphs: readonly WechatMathVectorGlyphPosition[];
}>;

export type WechatMathVectorRulePaint = Readonly<{
	fill: string;
	height: number;
	opacity?: number;
	width: number;
	x: number;
	y: number;
}>;

/**
 * A rectangular nested clip viewport already expressed in the fragment
 * input's local basis (before relative CTM P). Capture computes P^-1C and
 * rejects non-axis-aligned transforms; the builder emits an identity clip
 * viewport around the primitive.
 */
export type WechatMathVectorNestedClipViewportRect = Readonly<{
	height: number;
	transform: "none";
	unit: "userSpaceOnUse";
	width: number;
	x: number;
	y: number;
}>;

export type WechatMathVectorResolvedPaint = Readonly<{
	fill: string;
	opacity: number;
	stroke: string;
	strokeWidth: number;
}>;

export type WechatMathVectorFrozenSvgPath = Readonly<{
	kind: "path";
	paint: WechatMathVectorResolvedPaint;
	pathData: string;
}>;

export type WechatMathVectorFrozenSvgLine = Readonly<{
	kind: "line";
	paint: WechatMathVectorResolvedPaint;
	x1: number;
	x2: number;
	y1: number;
	y2: number;
}>;

export type WechatMathVectorFrozenSvgChild =
	| WechatMathVectorFrozenSvgPath
	| WechatMathVectorFrozenSvgLine;

export type WechatMathVectorFrozenSvgFragment = Readonly<{
	/** Local-basis rectangles for generated identity clip viewports. */
	nestedClipViewportRects: readonly WechatMathVectorNestedClipViewportRect[];
	children: readonly WechatMathVectorFrozenSvgChild[];
	relativeCtm: WechatMathVectorMatrix;
}>;

export type WechatMathVectorFrozenScene = Readonly<{
	rulePaint: readonly WechatMathVectorRulePaint[];
	runs: readonly WechatMathVectorGlyphRun[];
	svgFragments: readonly WechatMathVectorFrozenSvgFragment[];
	viewport: Readonly<{
		height: number;
		viewBox: WechatMathVectorRect;
		width: number;
	}>;
}>;

export type WechatMathVectorSceneErrorCode =
	| "atlas-schema-invalid"
	| "font-invalid"
	| "glyph-invalid"
	| "glyph-path-invalid"
	| "unknown-font"
	| "unknown-glyph"
	| "fragment-invalid"
	| "clip-invalid"
	| "matrix-invalid"
	| "paint-invalid"
	| "run-invalid"
	| "rule-invalid"
	| "viewport-invalid";

export class WechatMathVectorSceneError extends Error {
	readonly code: WechatMathVectorSceneErrorCode;

	constructor(code: WechatMathVectorSceneErrorCode) {
		super(`wechat-math-vector-scene-${code}`);
		this.name = "WechatMathVectorSceneError";
		this.code = code;
	}
}

function sceneError(
	code: WechatMathVectorSceneErrorCode,
): WechatMathVectorSceneError {
	return new WechatMathVectorSceneError(code);
}

function finite(value: number, code: WechatMathVectorSceneErrorCode): number {
	if (!Number.isFinite(value)) throw sceneError(code);
	return value;
}

function positive(value: number, code: WechatMathVectorSceneErrorCode): number {
	if (!Number.isFinite(value) || value <= 0) throw sceneError(code);
	return value;
}

function formatNumber(
	value: number,
	code: WechatMathVectorSceneErrorCode,
): string {
	finite(value, code);
	return String(Object.is(value, -0) ? 0 : value);
}

function rect(
	value: WechatMathVectorRect,
	code: WechatMathVectorSceneErrorCode,
): void {
	if (!value || typeof value !== "object") throw sceneError(code);
	finite(value.x, code);
	finite(value.y, code);
	positive(value.width, code);
	positive(value.height, code);
}

function matrix(value: WechatMathVectorMatrix): void {
	if (!value || typeof value !== "object") throw sceneError("matrix-invalid");
	for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
		finite(value[key], "matrix-invalid");
	}
	const determinant = value.a * value.d - value.b * value.c;
	if (!Number.isFinite(determinant) || 0 === determinant)
		throw sceneError("matrix-invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
	if (!isRecord(value)) return false;
	const ownKeys = Reflect.ownKeys(value);
	return (
		ownKeys.length === keys.length && keys.every((key) => ownKeys.includes(key))
	);
}

const SOLID_PAINT = /^[-#a-z0-9().,%\s/]+$/iu;

function resolvedSolidPaint(value: unknown): string {
	if (typeof value !== "string") throw sceneError("paint-invalid");
	const trimmed = value.trim();
	const normalized = trimmed.toLowerCase();
	if (
		!trimmed ||
		normalized === "currentcolor" ||
		normalized.startsWith("context-") ||
		normalized.startsWith("url(") ||
		normalized.startsWith("var(") ||
		!SOLID_PAINT.test(trimmed)
	) {
		throw sceneError("paint-invalid");
	}
	return trimmed;
}

function validateOpacity(value: number | undefined): number {
	const opacity = undefined === value ? 1 : value;
	if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
		throw sceneError("paint-invalid");
	return opacity;
}

function validateAtlas(
	atlas: WechatMathVectorAtlas,
): WechatMathVectorValidatedFontIndex {
	if (
		!atlas ||
		atlas.schema !== ATLAS_SCHEMA ||
		!atlas.serialization ||
		atlas.serialization.coordinateSystem !== COORDINATE_SYSTEM ||
		atlas.serialization.decimalPlaces !== DECIMAL_PLACES ||
		atlas.serialization.flipY !== false ||
		atlas.serialization.optimize !== false ||
		!Array.isArray(atlas.fonts)
	) {
		throw sceneError("atlas-schema-invalid");
	}
	const fonts = new Map<string, WechatMathVectorValidatedFont>();
	for (const font of atlas.fonts) {
		if (
			!font ||
			typeof font.file !== "string" ||
			!font.file ||
			fonts.has(font.file) ||
			!Number.isInteger(font.unitsPerEm) ||
			font.unitsPerEm < 1 ||
			font.unitsPerEm > 0x7fffffff ||
			!Array.isArray(font.cmap) ||
			!Array.isArray(font.glyphs)
		) {
			throw sceneError("font-invalid");
		}
		const glyphsById = new Map<number, WechatMathVectorAtlasGlyph>();
		for (const glyph of font.glyphs) {
			if (
				!glyph ||
				!Number.isInteger(glyph.id) ||
				glyph.id < 0 ||
				glyphsById.has(glyph.id) ||
				!Number.isFinite(glyph.advanceWidth) ||
				glyph.advanceWidth < 0 ||
				typeof glyph.outline?.pathData !== "string"
			) {
				throw sceneError("glyph-invalid");
			}
			glyphsById.set(glyph.id, glyph);
		}
		const glyphsByCodepoint = new Map<number, WechatMathVectorAtlasGlyph>();
		for (const entry of font.cmap) {
			if (
				!entry ||
				!Number.isInteger(entry.codepoint) ||
				entry.codepoint < 0 ||
				entry.codepoint > 0x10ffff ||
				glyphsByCodepoint.has(entry.codepoint)
			) {
				throw sceneError("font-invalid");
			}
			const glyph = glyphsById.get(entry.glyphId);
			if (!glyph) throw sceneError("font-invalid");
			glyphsByCodepoint.set(entry.codepoint, glyph);
		}
		fonts.set(font.file, {
			glyphsByCodepoint,
			unitsPerEm: font.unitsPerEm,
		});
	}
	return fonts;
}

function pathIsValid(pathData: string): boolean {
	if (!pathData.trim()) return true;
	try {
		const commands = SVGPathData.parse(pathData);
		if (!commands.length) return false;
		for (const command of commands) {
			for (const value of Object.values(command)) {
				if (typeof value === "number" && !Number.isFinite(value)) return false;
			}
		}
		const bounds = new SVGPathData(commands).getBounds();
		return [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(
			Number.isFinite,
		);
	} catch {
		return false;
	}
}

function validateResolvedPaint(value: unknown): WechatMathVectorResolvedPaint {
	if (!hasExactKeys(value, ["fill", "opacity", "stroke", "strokeWidth"])) {
		throw sceneError("paint-invalid");
	}
	const paint = value as Record<string, unknown>;
	if (
		typeof paint.opacity !== "number" ||
		typeof paint.strokeWidth !== "number"
	) {
		throw sceneError("paint-invalid");
	}
	const strokeWidth = finite(paint.strokeWidth, "paint-invalid");
	if (strokeWidth < 0) throw sceneError("paint-invalid");
	return {
		fill: resolvedSolidPaint(paint.fill),
		opacity: validateOpacity(paint.opacity),
		stroke: resolvedSolidPaint(paint.stroke),
		strokeWidth,
	};
}

function validateRectClip(
	value: unknown,
): WechatMathVectorNestedClipViewportRect {
	if (
		!hasExactKeys(value, ["height", "transform", "unit", "width", "x", "y"])
	) {
		throw sceneError("clip-invalid");
	}
	const clip = value as WechatMathVectorNestedClipViewportRect;
	if (clip.unit !== "userSpaceOnUse" || clip.transform !== "none") {
		throw sceneError("clip-invalid");
	}
	rect(clip, "clip-invalid");
	return clip;
}

function setPaintAttributes(
	element: SVGElement,
	paint: WechatMathVectorResolvedPaint,
): void {
	element.setAttribute("fill", paint.fill);
	element.setAttribute("stroke", paint.stroke);
	element.setAttribute(
		"stroke-width",
		formatNumber(paint.strokeWidth, "paint-invalid"),
	);
	if (paint.opacity !== 1) {
		element.setAttribute(
			"opacity",
			formatNumber(paint.opacity, "paint-invalid"),
		);
	}
}

function createStaticSvgChild(document: Document, child: unknown): SVGElement {
	if (
		isRecord(child) &&
		child.kind === "path" &&
		hasExactKeys(child, ["kind", "paint", "pathData"])
	) {
		const pathRecord = child as Record<string, unknown>;
		if (
			typeof pathRecord.pathData !== "string" ||
			!pathRecord.pathData.trim() ||
			!pathIsValid(pathRecord.pathData)
		) {
			throw sceneError("glyph-path-invalid");
		}
		const path = document.createElementNS(SVG_NAMESPACE, "path");
		path.setAttribute("d", pathRecord.pathData);
		setPaintAttributes(path, validateResolvedPaint(pathRecord.paint));
		return path;
	}

	if (
		isRecord(child) &&
		child.kind === "line" &&
		hasExactKeys(child, ["kind", "paint", "x1", "x2", "y1", "y2"])
	) {
		const lineRecord = child as Record<string, unknown>;
		const coordinates = [
			lineRecord.x1,
			lineRecord.y1,
			lineRecord.x2,
			lineRecord.y2,
		];
		if (coordinates.some((coordinate) => typeof coordinate !== "number")) {
			throw sceneError("fragment-invalid");
		}
		const [x1, y1, x2, y2] = coordinates as [number, number, number, number];
		for (const coordinate of [x1, y1, x2, y2]) {
			finite(coordinate, "fragment-invalid");
		}
		const line = document.createElementNS(SVG_NAMESPACE, "line");
		line.setAttribute("x1", formatNumber(x1, "fragment-invalid"));
		line.setAttribute("y1", formatNumber(y1, "fragment-invalid"));
		line.setAttribute("x2", formatNumber(x2, "fragment-invalid"));
		line.setAttribute("y2", formatNumber(y2, "fragment-invalid"));
		setPaintAttributes(line, validateResolvedPaint(lineRecord.paint));
		return line;
	}

	throw sceneError("fragment-invalid");
}

function createStaticSvgFragment(
	document: Document,
	fragment: unknown,
): SVGElement {
	if (
		!hasExactKeys(fragment, [
			"children",
			"nestedClipViewportRects",
			"relativeCtm",
		])
	) {
		throw sceneError("fragment-invalid");
	}
	const record = fragment as Record<string, unknown>;
	if (!Array.isArray(record.children) || !record.children.length) {
		throw sceneError("fragment-invalid");
	}
	if (!Array.isArray(record.nestedClipViewportRects)) {
		throw sceneError("fragment-invalid");
	}
	if (!hasExactKeys(record.relativeCtm, ["a", "b", "c", "d", "e", "f"])) {
		throw sceneError("matrix-invalid");
	}
	const relativeCtm = record.relativeCtm as WechatMathVectorMatrix;
	matrix(relativeCtm);

	const content = document.createElementNS(SVG_NAMESPACE, "g");
	for (const child of record.children) {
		content.append(createStaticSvgChild(document, child));
	}
	let current: SVGElement = content;
	for (
		let index = record.nestedClipViewportRects.length - 1;
		index >= 0;
		index -= 1
	) {
		const clip = validateRectClip(record.nestedClipViewportRects[index]);
		// The local-basis rect is already P^-1C; this viewport is an identity
		// clip around the primitive, followed outside by g(P).
		const viewport = document.createElementNS(SVG_NAMESPACE, "svg");
		viewport.setAttribute("x", formatNumber(clip.x, "clip-invalid"));
		viewport.setAttribute("y", formatNumber(clip.y, "clip-invalid"));
		viewport.setAttribute("width", formatNumber(clip.width, "clip-invalid"));
		viewport.setAttribute("height", formatNumber(clip.height, "clip-invalid"));
		viewport.setAttribute(
			"viewBox",
			`${formatNumber(clip.x, "clip-invalid")} ${formatNumber(clip.y, "clip-invalid")} ${formatNumber(clip.width, "clip-invalid")} ${formatNumber(clip.height, "clip-invalid")}`,
		);
		viewport.setAttribute("overflow", "hidden");
		viewport.setAttribute(
			"style",
			"overflow:hidden!important;max-width:none!important",
		);
		viewport.append(current);
		current = viewport;
	}

	const transformed = document.createElementNS(SVG_NAMESPACE, "g");
	transformed.setAttribute(
		"transform",
		`matrix(${formatNumber(relativeCtm.a, "matrix-invalid")} ${formatNumber(relativeCtm.b, "matrix-invalid")} ${formatNumber(relativeCtm.c, "matrix-invalid")} ${formatNumber(relativeCtm.d, "matrix-invalid")} ${formatNumber(relativeCtm.e, "matrix-invalid")} ${formatNumber(relativeCtm.f, "matrix-invalid")})`,
	);
	transformed.append(current);
	return transformed;
}

function buildScene(
	document: Document,
	frozen: WechatMathVectorFrozenScene,
	fonts: WechatMathVectorValidatedFontIndex,
	validatedGlyphPaths: Set<WechatMathVectorAtlasGlyph>,
): SVGSVGElement {
	if (!frozen?.viewport) throw sceneError("viewport-invalid");
	const viewport = frozen.viewport;
	rect(viewport.viewBox, "viewport-invalid");
	positive(viewport.width, "viewport-invalid");
	positive(viewport.height, "viewport-invalid");
	if (
		!Array.isArray(frozen.runs) ||
		!Array.isArray(frozen.rulePaint) ||
		!Array.isArray(frozen.svgFragments)
	) {
		throw sceneError("viewport-invalid");
	}

	const scene = document.createElementNS(SVG_NAMESPACE, "svg");
	scene.setAttribute("xmlns", SVG_NAMESPACE);
	scene.setAttribute("width", formatNumber(viewport.width, "viewport-invalid"));
	scene.setAttribute(
		"height",
		formatNumber(viewport.height, "viewport-invalid"),
	);
	scene.setAttribute(
		"viewBox",
		`${formatNumber(viewport.viewBox.x, "viewport-invalid")} ${formatNumber(viewport.viewBox.y, "viewport-invalid")} ${formatNumber(viewport.viewBox.width, "viewport-invalid")} ${formatNumber(viewport.viewBox.height, "viewport-invalid")}`,
	);
	scene.setAttribute("overflow", "visible");
	scene.setAttribute(
		"style",
		"max-width:none!important;overflow:visible!important",
	);

	for (const rule of frozen.rulePaint) {
		if (
			!rule ||
			!Number.isFinite(rule.x) ||
			!Number.isFinite(rule.y) ||
			!Number.isFinite(rule.width) ||
			!Number.isFinite(rule.height) ||
			rule.width <= 0 ||
			rule.height <= 0
		) {
			throw sceneError("rule-invalid");
		}
		const rectElement = document.createElementNS(SVG_NAMESPACE, "rect");
		rectElement.setAttribute("x", formatNumber(rule.x, "rule-invalid"));
		rectElement.setAttribute("y", formatNumber(rule.y, "rule-invalid"));
		rectElement.setAttribute("width", formatNumber(rule.width, "rule-invalid"));
		rectElement.setAttribute(
			"height",
			formatNumber(rule.height, "rule-invalid"),
		);
		rectElement.setAttribute("fill", resolvedSolidPaint(rule.fill));
		const opacity = validateOpacity(rule.opacity);
		if (opacity !== 1)
			rectElement.setAttribute(
				"opacity",
				formatNumber(opacity, "rule-invalid"),
			);
		scene.append(rectElement);
	}

	for (const svgFragment of frozen.svgFragments) {
		scene.append(createStaticSvgFragment(document, svgFragment));
	}

	for (const run of frozen.runs) {
		if (
			!run ||
			typeof run.fontFile !== "string" ||
			!fonts.has(run.fontFile) ||
			!Number.isFinite(run.fontSize) ||
			run.fontSize <= 0 ||
			!Number.isFinite(run.baselineY) ||
			!Array.isArray(run.glyphs)
		) {
			if (run && typeof run.fontFile === "string" && !fonts.has(run.fontFile)) {
				throw sceneError("unknown-font");
			}
			throw sceneError("run-invalid");
		}
		const font = fonts.get(run.fontFile);
		if (!font) throw sceneError("unknown-font");
		const fill = resolvedSolidPaint(run.fill);
		const scale = run.fontSize / font.unitsPerEm;
		for (const placement of run.glyphs) {
			if (
				!placement ||
				!Number.isInteger(placement.codepoint) ||
				placement.codepoint < 0 ||
				placement.codepoint > 0x10ffff ||
				!Number.isFinite(placement.x)
			) {
				throw sceneError("glyph-invalid");
			}
			const glyph = font.glyphsByCodepoint.get(placement.codepoint);
			if (!glyph) throw sceneError("unknown-glyph");
			if (!validatedGlyphPaths.has(glyph)) {
				if (!pathIsValid(glyph.outline.pathData))
					throw sceneError("glyph-path-invalid");
				validatedGlyphPaths.add(glyph);
			}
			if (!glyph.outline.pathData.trim()) continue;
			const glyphPath = document.createElementNS(SVG_NAMESPACE, "path");
			glyphPath.setAttribute("d", glyph.outline.pathData);
			glyphPath.setAttribute("fill", fill);
			glyphPath.setAttribute(
				"transform",
				`translate(${formatNumber(placement.x, "glyph-invalid")} ${formatNumber(run.baselineY, "glyph-invalid")}) scale(${formatNumber(scale, "glyph-invalid")} ${formatNumber(-scale, "glyph-invalid")})`,
			);
			scene.append(glyphPath);
		}
	}
	return scene;
}

/**
 * Builds every scene while detached. The function has no Source DOM, layout,
 * atlas-loading, cache, upload, or global-state responsibilities. If any
 * scene is invalid, it throws before returning the batch.
 */
export function buildWechatMathVectorScenes(
	document: Document,
	frozenScenes: readonly WechatMathVectorFrozenScene[],
	atlas: WechatMathVectorAtlas,
): readonly SVGSVGElement[] {
	const fonts = validateAtlas(atlas);
	if (!Array.isArray(frozenScenes)) throw sceneError("viewport-invalid");
	const validatedGlyphPaths = new Set<WechatMathVectorAtlasGlyph>();
	return frozenScenes.map((frozen) =>
		buildScene(document, frozen, fonts, validatedGlyphPaths),
	);
}
