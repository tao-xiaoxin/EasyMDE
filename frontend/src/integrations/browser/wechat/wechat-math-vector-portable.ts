import type { WechatVisualInlineLayout } from "../../../contracts/ports/wechat-visual-rasterization-port";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	hasVisualRasterizationAncestor,
	KATEX_VISUAL_NODES,
	mathCloneRole,
	mathOuterAllocationDecision,
	visualRasterizationKind,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import type { WechatMathVectorCapturedScene } from "./wechat-math-vector-capture";
import {
	buildWechatMathVectorScenes,
	type WechatMathVectorAtlas,
} from "./wechat-math-vector-scene";
import {
	inlineOverflowStyleValue,
	inlineVerticalAlignValue,
	usesInlineOverflowViewport,
} from "./wechat-png-replacement";
import type { AcquiredPreviewGeometryMeasurement } from "./wechat-preview-geometry-cache";
import { replaceDeclarations } from "./wechat-style-declarations";

const ATLAS_SCHEMA = "easymde-katex-glyph-atlas/1";
const ATLAS_COORDINATE_SYSTEM = "font-units-y-up";
const MAX_ATLAS_BYTES = 8 * 1024 * 1024;

type AtlasErrorCode =
	| "atlas-fetch-unavailable"
	| "atlas-invalid"
	| "atlas-response-invalid"
	| "atlas-url-invalid"
	| "atlas-version-missing";

export class WechatMathVectorAtlasError extends Error {
	readonly code: AtlasErrorCode;

	constructor(code: AtlasErrorCode) {
		super(`wechat-math-vector-${code}`);
		this.name = "WechatMathVectorAtlasError";
		this.code = code;
	}
}

function atlasError(code: AtlasErrorCode): WechatMathVectorAtlasError {
	return new WechatMathVectorAtlasError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function validateAtlasGraph(
	value: unknown,
): asserts value is WechatMathVectorAtlas {
	if (!isRecord(value)) throw atlasError("atlas-invalid");
	if (
		value.schema !== ATLAS_SCHEMA ||
		!isRecord(value.serialization) ||
		value.serialization.coordinateSystem !== ATLAS_COORDINATE_SYSTEM ||
		value.serialization.decimalPlaces !== 6 ||
		value.serialization.flipY !== false ||
		value.serialization.optimize !== false ||
		!Array.isArray(value.fonts)
	)
		throw atlasError("atlas-invalid");
	for (const font of value.fonts) {
		if (
			!isRecord(font) ||
			typeof font.file !== "string" ||
			!font.file.trim() ||
			!finiteInteger(font.unitsPerEm) ||
			font.unitsPerEm <= 0 ||
			!Array.isArray(font.cmap) ||
			!Array.isArray(font.glyphs)
		)
			throw atlasError("atlas-invalid");
		const glyphIds = new Set<number>();
		for (const glyph of font.glyphs) {
			if (
				!isRecord(glyph) ||
				!finiteInteger(glyph.id) ||
				glyphIds.has(glyph.id) ||
				typeof glyph.advanceWidth !== "number" ||
				!Number.isFinite(glyph.advanceWidth) ||
				!isRecord(glyph.outline) ||
				typeof glyph.outline.pathData !== "string"
			)
				throw atlasError("atlas-invalid");
			glyphIds.add(glyph.id);
		}
		const codepoints = new Set<number>();
		for (const mapping of font.cmap) {
			if (
				!isRecord(mapping) ||
				!finiteInteger(mapping.codepoint) ||
				mapping.codepoint < 0 ||
				mapping.codepoint > 0x10ffff ||
				!finiteInteger(mapping.glyphId) ||
				codepoints.has(mapping.codepoint) ||
				!glyphIds.has(mapping.glyphId)
			)
				throw atlasError("atlas-invalid");
			codepoints.add(mapping.codepoint);
		}
	}
}

function freezeAtlas<T>(value: T): T {
	if (!value || typeof value !== "object") return value;
	if (Object.isFrozen(value)) return value;
	Reflect.ownKeys(value as object).forEach((key) => {
		const child = (value as Record<PropertyKey, unknown>)[key];
		freezeAtlas(child);
	});
	return Object.freeze(value);
}

function assertAtlasCurrent(
	signal?: AbortSignal,
	isCurrent?: () => boolean,
): void {
	if (signal?.aborted || (isCurrent && !isCurrent())) {
		throw new Error("wechat-copy-cancelled");
	}
}

export type WechatMathVectorAtlasCache = {
	url: string | null;
	contentVersion: string | null;
	atlas: WechatMathVectorAtlas | null;
};

export type WechatMathVectorAtlasLoader = (
	signal?: AbortSignal,
	isCurrent?: () => boolean,
) => Promise<WechatMathVectorAtlas>;

/** Returns null only when both optional bootstrap fields are absent. */
export function createWechatMathVectorAtlasLoaderIfConfigured(
	runtime: BrowserWechatClipboardRuntime,
	cache: WechatMathVectorAtlasCache,
): WechatMathVectorAtlasLoader | undefined {
	if (
		undefined === runtime.wechatMathAtlasUrl &&
		undefined === runtime.wechatMathAtlasContentVersion
	)
		return undefined;
	return createWechatMathVectorAtlasLoader(runtime, cache);
}

export function createWechatMathVectorAtlasCache(): WechatMathVectorAtlasCache {
	return { atlas: null, contentVersion: null, url: null };
}

export function createWechatMathVectorAtlasLoader(
	runtime: BrowserWechatClipboardRuntime,
	cache: WechatMathVectorAtlasCache,
): WechatMathVectorAtlasLoader {
	return async (signal, isCurrent): Promise<WechatMathVectorAtlas> => {
		assertAtlasCurrent(signal, isCurrent);
		const rawUrl = runtime.wechatMathAtlasUrl?.trim() ?? "";
		const contentVersion = runtime.wechatMathAtlasContentVersion?.trim() ?? "";
		if (!rawUrl) throw atlasError("atlas-url-invalid");
		if (!contentVersion) throw atlasError("atlas-version-missing");
		let url: URL;
		try {
			url = new URL(rawUrl, runtime.document.baseURI);
			const base = new URL(runtime.document.baseURI);
			if (
				!["http:", "https:"].includes(url.protocol) ||
				url.origin !== base.origin ||
				url.username ||
				url.password ||
				url.hash
			)
				throw new Error("atlas-url-invalid");
		} catch {
			throw atlasError("atlas-url-invalid");
		}
		const cacheKey = url.href;
		if (
			cache.url === cacheKey &&
			cache.contentVersion === contentVersion &&
			cache.atlas
		)
			return cache.atlas;
		if (typeof runtime.fetch !== "function")
			throw atlasError("atlas-fetch-unavailable");
		const response = await runtime.fetch(
			url.href,
			signal ? { signal } : undefined,
		);
		assertAtlasCurrent(signal, isCurrent);
		if (!response.ok) throw atlasError("atlas-response-invalid");
		const contentLength = response.headers.get("content-length");
		if (
			contentLength &&
			Number.isFinite(Number(contentLength)) &&
			Number(contentLength) > MAX_ATLAS_BYTES
		) {
			throw atlasError("atlas-response-invalid");
		}
		let bytes: ArrayBuffer;
		try {
			bytes = await response.arrayBuffer();
		} catch {
			throw atlasError("atlas-response-invalid");
		}
		assertAtlasCurrent(signal, isCurrent);
		if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATLAS_BYTES) {
			throw atlasError("atlas-response-invalid");
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw atlasError("atlas-invalid");
		}
		validateAtlasGraph(parsed);
		const atlas = freezeAtlas(parsed);
		cache.url = cacheKey;
		cache.contentVersion = contentVersion;
		cache.atlas = atlas;
		return atlas;
	};
}

export type WechatMathVectorPortableCapture = Readonly<{
	atlas: WechatMathVectorAtlas;
	measurement: AcquiredPreviewGeometryMeasurement;
	scenes: readonly WechatMathVectorCapturedScene[];
}>;

export type WechatMathVectorBoundScene = Readonly<{
	cloneOwner: Element;
	scene: WechatMathVectorCapturedScene;
	sourceOwner: Element;
}>;

export type WechatMathVectorBoundPlan = Readonly<{
	atlas: WechatMathVectorAtlas;
	entries: readonly WechatMathVectorBoundScene[];
	measurementOwners: ReadonlySet<Element>;
	sourceOwners: ReadonlySet<Element>;
}>;

function displayOf(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
): string {
	return runtime
		.getComputedStyle(element)
		.getPropertyValue("display")
		.trim()
		.toLowerCase();
}

function isVectorDisplay(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
): boolean {
	const display = displayOf(element, runtime);
	if ("inline-block" === display || "inline-flex" === display) return true;
	if ("block" !== display && "flow-root" !== display) return false;
	const role = mathCloneRole(element);
	if ("block" !== role) return false;
	const parent = element.parentElement;
	const formattingOwnerDisplay = parent ? displayOf(parent, runtime) : null;
	const decision = mathOuterAllocationDecision(
		element,
		runtime.getComputedStyle(element),
		runtime.getComputedStyle.bind(runtime),
		formattingOwnerDisplay,
		false,
	);
	return decision.authoredOuterWidthNeutral;
}

/** Returns only proven block/atomic owners; true inline remains portable. */
export function eligibleWechatMathVectorOwners(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
): readonly Element[] {
	const candidates: Element[] = [];
	if (visualRasterizationKind(preview) === "math") candidates.push(preview);
	candidates.push(
		...Array.from(
			preview.querySelectorAll(
				".easymde-math, .easymde-math-block, .easymde-math-inline, .katex",
			),
		),
	);
	const seen = new Set<Element>();
	return candidates.filter((candidate) => {
		if (
			seen.has(candidate) ||
			(seen.size && hasVisualRasterizationAncestor(candidate))
		)
			return false;
		seen.add(candidate);
		return (
			visualRasterizationKind(candidate) === "math" &&
			isVectorDisplay(candidate, runtime)
		);
	});
}

export function bindWechatMathVectorScenes(
	preview: HTMLElement,
	clone: HTMLElement,
	measurement: {
		lease: {
			measurementFor: (source: Element) => Element | null;
			sourceFor: (measurement: Element) => Element | null;
		};
	},
	cloneIdentity: ReadonlyMap<Element, Element>,
	capture: WechatMathVectorPortableCapture,
): WechatMathVectorBoundPlan {
	const entries = capture.scenes.map((scene) => {
		if (
			scene.sourceOwner !== scene.replacementShell ||
			!preview.contains(scene.sourceOwner)
		) {
			throw new Error("wechat-math-vector-source-identity-invalid");
		}
		const measurementOwner = measurement.lease.measurementFor(
			scene.sourceOwner,
		);
		if (
			!measurementOwner ||
			measurement.lease.sourceFor(measurementOwner) !== scene.sourceOwner
		) {
			throw new Error("wechat-math-vector-measurement-identity-invalid");
		}
		const sourceClone = cloneIdentity.get(scene.sourceOwner);
		const measurementClone = cloneIdentity.get(measurementOwner);
		const cloneOwner = sourceClone ?? measurementClone;
		if (
			!cloneOwner ||
			(sourceClone && measurementClone && sourceClone !== measurementClone) ||
			!clone.contains(cloneOwner)
		) {
			throw new Error("wechat-math-vector-clone-identity-missing");
		}
		return Object.freeze({ cloneOwner, scene, sourceOwner: scene.sourceOwner });
	});
	const sourceOwners = new Set(entries.map((entry) => entry.sourceOwner));
	const measurementOwners = new Set(
		entries
			.map((entry) => measurement.lease.measurementFor(entry.sourceOwner))
			.filter((value): value is Element => Boolean(value)),
	);
	return Object.freeze({
		atlas: capture.atlas,
		entries: Object.freeze(entries),
		measurementOwners,
		sourceOwners,
	});
}

function generatedSceneStyle(
	scene: SVGSVGElement,
	left: number,
	top: number,
): void {
	replaceDeclarations(
		scene,
		[
			"display:block",
			"position:absolute",
			`left:${Object.is(left, -0) ? 0 : left}px`,
			`top:${Object.is(top, -0) ? 0 : top}px`,
			"max-width:none",
		],
		true,
	);
	KATEX_VISUAL_NODES.add(scene);
}

function normalFlowSceneStyle(scene: SVGSVGElement): void {
	replaceDeclarations(
		scene,
		["display:block", "position:static", "left:auto", "top:auto", "max-width:none"],
		true,
	);
	KATEX_VISUAL_NODES.add(scene);
}

function finiteBlockAllocation(
	allocation: WechatMathVectorCapturedScene["allocation"],
): Readonly<{
	contentHeight: number;
	leading: number;
	trailing: number;
}> {
	const { edges, ownerRect, visualRect } = allocation;
	const values = [
		edges.borderBottom,
		edges.borderLeft,
		edges.borderRight,
		edges.borderTop,
		edges.marginLeft,
		edges.marginRight,
		edges.paddingBottom,
		edges.paddingLeft,
		edges.paddingRight,
		edges.paddingTop,
		ownerRect.height,
		ownerRect.width,
		visualRect.height,
		visualRect.width,
		visualRect.x,
		visualRect.y,
	];
	if (values.some((value) => !Number.isFinite(value)))
		throw new Error("wechat-math-vector-block-allocation-invalid");
	const contentWidth =
		ownerRect.width -
		edges.borderLeft -
		edges.borderRight -
		edges.paddingLeft -
		edges.paddingRight;
	const contentHeight =
		ownerRect.height -
		edges.borderTop -
		edges.borderBottom -
		edges.paddingTop -
		edges.paddingBottom;
	const leading = visualRect.y - edges.borderTop - edges.paddingTop;
	const trailing = contentHeight - leading - visualRect.height;
	if (
		!Number.isFinite(contentWidth) ||
		contentWidth <= 0 ||
		!Number.isFinite(contentHeight) ||
		!Number.isFinite(leading) ||
		!Number.isFinite(trailing) ||
		contentHeight <= 0 ||
		leading < 0 ||
		trailing < 0 ||
		visualRect.height > contentHeight
	)
		throw new Error("wechat-math-vector-block-allocation-invalid");
	return Object.freeze({ contentHeight, leading, trailing });
}

function inlineSceneWrapper(
	document: Document,
	target: Element,
	scene: SVGSVGElement,
	layout: WechatVisualInlineLayout,
	edges: WechatMathVectorCapturedScene["allocation"]["edges"],
): void {
	const targetStyle = (target as Element & { style?: CSSStyleDeclaration })
		.style;
	if (!targetStyle) throw new Error("wechat-math-vector-target-style-missing");
	const sourceMarginLeft = edges.marginLeft;
	const sourceMarginRight = edges.marginRight;
	const verticalAlign = inlineVerticalAlignValue(
		targetStyle,
		layout.baseline - layout.height,
	);
	const viewport = layout.viewport;
	if (!viewport) throw new Error("wechat-math-vector-inline-viewport-missing");
	const overflowX = inlineOverflowStyleValue(
		layout.overflowX,
		targetStyle,
		"overflow-x",
	);
	const overflowY = inlineOverflowStyleValue(
		layout.overflowY,
		targetStyle,
		"overflow-y",
	);
	const preservesViewport = usesInlineOverflowViewport(overflowX, overflowY);
	const wrapper = document.createElement("span");
	replaceDeclarations(
		target,
		[
			"display:block",
			"position:absolute",
			`left:${Object.is(viewport.offsetX, -0) ? 0 : viewport.offsetX}px`,
			`top:${Object.is(viewport.offsetY, -0) ? 0 : viewport.offsetY}px`,
			`width:${viewport.width}px`,
			`height:${viewport.height}px`,
			"box-sizing:border-box",
			"min-width:0",
			"min-height:0",
			"max-width:none",
			"max-height:none",
			"margin-top:0",
			"margin-right:0",
			"margin-bottom:0",
			"margin-left:0",
			`overflow-x:${preservesViewport ? overflowX : "visible"}`,
			`overflow-y:${preservesViewport ? overflowY : "visible"}`,
		],
		true,
	);
	replaceDeclarations(
		wrapper,
		[
			"display:inline-block",
			"position:relative",
			"overflow-x:visible",
			"overflow-y:visible",
			`width:${layout.width}px`,
			`height:${layout.height}px`,
			"box-sizing:border-box",
			"min-width:0",
			"min-height:0",
			"max-width:none",
			"max-height:none",
			"margin-top:0",
			`margin-right:${sourceMarginRight}px`,
			"margin-bottom:0",
			`margin-left:${sourceMarginLeft}px`,
			"padding:0",
			"border:0",
			`vertical-align:${verticalAlign}`,
		],
		true,
	);
	generatedSceneStyle(
		scene,
		layout.paintOffsetX - viewport.offsetX - edges.borderLeft,
		layout.paintOffsetY - viewport.offsetY - edges.borderTop,
	);
	target.replaceChildren(scene);
	const parent = target.parentNode;
	if (!parent) throw new Error("wechat-math-vector-target-parent-missing");
	parent.insertBefore(wrapper, target);
	wrapper.append(target);
}

function blockSceneWrapper(
	document: Document,
	target: Element,
	scene: SVGSVGElement,
	allocation: WechatMathVectorCapturedScene["allocation"],
): void {
	const { leading, trailing } = finiteBlockAllocation(allocation);
	replaceDeclarations(
		target,
		[
			"display:block",
			"width:100%",
			"max-width:100%",
			"height:auto",
			"box-sizing:border-box",
			"min-width:0",
			"min-height:0",
			"overflow-x:auto",
			"overflow-y:hidden",
		],
		true,
	);
	const carrier = document.createElement("section");
	carrier.setAttribute("data-easymde-wechat-math-vector-carrier", "");
	replaceDeclarations(
		carrier,
		[
			"display:block",
			`width:${allocation.visualRect.width}px`,
			"height:auto",
			"margin-top:0",
			"margin-right:auto",
			"margin-bottom:0",
			"margin-left:auto",
			`padding-top:${leading}px`,
			"padding-right:0",
			`padding-bottom:${trailing}px`,
			"padding-left:0",
			"border:0",
			"box-sizing:content-box",
			"min-width:0",
			"min-height:0",
			"max-width:none",
			"max-height:none",
			"overflow:visible",
		],
		true,
	);
	normalFlowSceneStyle(scene);
	target.replaceChildren(carrier);
	carrier.append(scene);
}

function restoreElement(
	target: Element,
	childNodes: readonly ChildNode[],
	style: string | null,
): void {
	target.setAttribute("style", style ?? "");
	if (style === null) target.removeAttribute("style");
	target.replaceChildren(...childNodes);
}

/**
 * Materializes all detached scenes only after the portable clone is finalized.
 * Scene creation and all target validation happen before the first target is
 * changed; any later installation error restores every target snapshot.
 */
export function materializeWechatMathVectorScenes(
	finalizedRoot: HTMLElement,
	plan: WechatMathVectorBoundPlan,
	document: Document,
): void {
	const targets = plan.entries.map((entry) => {
		const target =
			WECHAT_STRUCTURE_REPLACEMENTS.get(entry.cloneOwner) ?? entry.cloneOwner;
		if (!finalizedRoot.contains(target))
			throw new Error("wechat-math-vector-final-target-missing");
		return target;
	});
	const scenes = buildWechatMathVectorScenes(
		document,
		plan.entries.map((entry) => entry.scene.scene),
		plan.atlas,
	);
	const snapshots = targets.map((target) => ({
		children: Object.freeze(Array.from(target.childNodes)),
		parent: target.parentNode,
		parentChildren: Object.freeze(
			target.parentNode ? Array.from(target.parentNode.childNodes) : [],
		),
		style: target.getAttribute("style"),
		target,
	}));
	try {
		plan.entries.forEach((entry, index) => {
			const target = targets[index];
			const scene = scenes[index];
			if (!target || !scene)
				throw new Error("wechat-math-vector-materialization-missing");
			const inlineLayout = entry.scene.allocation.geometry.inlineLayout;
			if (inlineLayout) {
				inlineSceneWrapper(
					document,
					target,
					scene,
					inlineLayout,
					entry.scene.allocation.edges,
				);
			} else {
				blockSceneWrapper(
					document,
					target,
					scene,
					entry.scene.allocation,
				);
			}
		});
	} catch (error: unknown) {
		snapshots.forEach(({ target, children, parent, parentChildren, style }) => {
			if (parent && target.parentNode !== parent)
				parent.replaceChildren(...parentChildren);
			restoreElement(target, children, style);
		});
		scenes.forEach((scene) => {
			KATEX_VISUAL_NODES.delete(scene);
		});
		throw error;
	}
}
