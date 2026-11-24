import type {
	WechatInlinePseudoPaintAttributeSnapshot,
	WechatInlinePseudoPaintCssCapabilities,
	WechatInlinePseudoPaintFailureReason,
	WechatInlinePseudoPaintMaskPropertyValues,
	WechatInlinePseudoPaintProperty,
	WechatInlinePseudoPaintSourceKeyParts,
	WechatInlinePseudoPaintSourceKeyValue,
	WechatInlinePseudoPaintStyleSnapshot,
} from "./wechat-inline-pseudo-paint-types";

export const PSEUDO_ELEMENT = "::before" as const;
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg" as const;
export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;
export const MAX_SOURCE_KEY_DEPTH = 16;
export const MAX_SOURCE_KEY_NODES = 4_096;
export const MAX_SOURCE_KEY_STRING = 65_536;
export const EPSILON = 1e-9;

export const OWNER_PROPERTIES = [
	"display",
	"position",
	"float",
	"transform",
	"writing-mode",
	"direction",
	"overflow",
	"overflow-x",
	"overflow-y",
	"contain",
	"content-visibility",
	"box-sizing",
	"width",
	"height",
	"min-width",
	"max-width",
	"min-height",
	"max-height",
	"inline-size",
	"block-size",
	"min-inline-size",
	"max-inline-size",
	"min-block-size",
	"max-block-size",
	"padding",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"margin",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"font-stretch",
	"font-variant",
	"line-height",
	"letter-spacing",
	"word-spacing",
	"text-align",
	"text-decoration",
	"text-decoration-line",
	"text-transform",
	"text-indent",
	"text-shadow",
	"background",
	"background-color",
	"background-image",
	"box-shadow",
	"filter",
	"clip",
	"clip-path",
	"mask",
	"mask-image",
	"mask-mode",
	"mask-size",
	"mask-repeat",
	"mask-position",
	"mask-composite",
	"mask-origin",
	"mask-clip",
	"-webkit-mask",
	"-webkit-mask-image",
	"-webkit-mask-mode",
	"-webkit-mask-size",
	"-webkit-mask-repeat",
	"-webkit-mask-position",
	"-webkit-mask-composite",
	"-webkit-mask-origin",
	"-webkit-mask-clip",
] as const;

export const PSEUDO_PROPERTIES = [
	"content",
	"display",
	"position",
	"float",
	"transform",
	"transform-origin",
	"writing-mode",
	"direction",
	"box-sizing",
	"width",
	"height",
	"min-width",
	"max-width",
	"min-height",
	"max-height",
	"inline-size",
	"block-size",
	"min-inline-size",
	"max-inline-size",
	"min-block-size",
	"max-block-size",
	"padding",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"margin",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"border",
	"border-width",
	"border-style",
	"border-color",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"border-left-style",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"border-radius",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-right-radius",
	"border-bottom-left-radius",
	"vertical-align",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"line-height",
	"letter-spacing",
	"word-spacing",
	"text-decoration",
	"text-decoration-line",
	"background",
	"background-color",
	"background-image",
	"outline",
	"outline-width",
	"outline-style",
	"outline-color",
	"box-shadow",
	"filter",
	"opacity",
	"visibility",
	"content-visibility",
	"clip",
	"clip-path",
	"animation-name",
	"animation-duration",
	"animation-delay",
	"animation-iteration-count",
	"transition-property",
	"transition-duration",
	"transition-delay",
	"transition-behavior",
	"mask",
	"mask-image",
	"mask-mode",
	"mask-size",
	"mask-repeat",
	"mask-position",
	"mask-composite",
	"mask-origin",
	"mask-clip",
	"-webkit-mask",
	"-webkit-mask-image",
	"-webkit-mask-mode",
	"-webkit-mask-size",
	"-webkit-mask-repeat",
	"-webkit-mask-position",
	"-webkit-mask-composite",
	"-webkit-mask-origin",
	"-webkit-mask-clip",
] as const;

export const MASK_PROPERTY_NAMES = [
	["image", "mask-image"],
	["mode", "mask-mode"],
	["size", "mask-size"],
	["repeat", "mask-repeat"],
	["position", "mask-position"],
	["composite", "mask-composite"],
	["origin", "mask-origin"],
	["clip", "mask-clip"],
	["prefixedImage", "-webkit-mask-image"],
	["prefixedMode", "-webkit-mask-mode"],
	["prefixedSize", "-webkit-mask-size"],
	["prefixedRepeat", "-webkit-mask-repeat"],
	["prefixedPosition", "-webkit-mask-position"],
	["prefixedComposite", "-webkit-mask-composite"],
	["prefixedOrigin", "-webkit-mask-origin"],
	["prefixedClip", "-webkit-mask-clip"],
] as const;

export function paintFailure(
	reason: WechatInlinePseudoPaintFailureReason,
): Error {
	return new Error(`wechat-inline-pseudo-paint-${reason}`);
}

export function assertPaint(
	condition: unknown,
	reason: WechatInlinePseudoPaintFailureReason,
): asserts condition {
	if (!condition) throw paintFailure(reason);
}

export function frozen<T>(value: T): T {
	return Object.freeze(value);
}

function readStyle(style: CSSStyleDeclaration, property: string): string {
	const value = style.getPropertyValue(property);
	assertPaint("string" === typeof value && "" !== value.trim(), "style");
	return value.trim();
}

function propertyState(
	capabilities: WechatInlinePseudoPaintCssCapabilities,
	style: CSSStyleDeclaration,
	property: string,
): WechatInlinePseudoPaintProperty {
	const supported = capabilities.supports(property, "initial");
	if (!supported) return frozen({ support: "unsupported", value: null });
	return frozen({ support: "supported", value: readStyle(style, property) });
}

export function styleSnapshot(
	capabilities: WechatInlinePseudoPaintCssCapabilities,
	style: CSSStyleDeclaration,
	properties: readonly string[],
): WechatInlinePseudoPaintStyleSnapshot {
	return frozen(
		Object.fromEntries(
			properties.map((property) => [
				property,
				propertyState(capabilities, style, property),
			]),
		),
	);
}

export function styleKeyEntries(
	snapshot: WechatInlinePseudoPaintStyleSnapshot,
): readonly (readonly [string, "supported" | "unsupported", string | null])[] {
	return Object.entries(snapshot).map(([property, state]) =>
		frozen([property, state.support, state.value] as const),
	);
}

export function supportedStyleValue(
	snapshot: WechatInlinePseudoPaintStyleSnapshot,
	property: string,
): string {
	const state = snapshot[property];
	assertPaint(state, "style");
	assertPaint("supported" === state.support, "style");
	return state.value;
}

function finiteSourceKey(
	value: unknown,
	depth = 0,
	state = { nodes: 0 },
): WechatInlinePseudoPaintSourceKeyValue {
	assertPaint(depth <= MAX_SOURCE_KEY_DEPTH, "stale");
	state.nodes += 1;
	assertPaint(state.nodes <= MAX_SOURCE_KEY_NODES, "stale");
	if (null === value || "boolean" === typeof value) return value;
	if ("number" === typeof value) {
		assertPaint(Number.isFinite(value), "stale");
		return Object.is(value, -0) ? 0 : value;
	}
	if ("string" === typeof value) {
		assertPaint(value.length <= MAX_SOURCE_KEY_STRING, "stale");
		return value;
	}
	assertPaint(Array.isArray(value), "stale");
	assertPaint(Object.getPrototypeOf(value) === Array.prototype, "stale");
	const array = value as readonly unknown[];
	assertPaint(array.length <= MAX_SOURCE_KEY_NODES, "stale");
	const output: WechatInlinePseudoPaintSourceKeyValue[] = [];
	for (let index = 0; index < array.length; index += 1) {
		assertPaint(
			// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
			Object.prototype.hasOwnProperty.call(array, index),
			"stale",
		);
		output.push(finiteSourceKey(array[index], depth + 1, state));
	}
	return frozen(output);
}

export function canonicalSourceKey(parts: readonly unknown[]): string {
	return JSON.stringify(finiteSourceKey(parts));
}

export function canonicalSourceKeyParts(
	label: "easymde-inline-pseudo-paint-source-v1",
	values: readonly unknown[],
): readonly [typeof label, ...WechatInlinePseudoPaintSourceKeyValue[]] {
	const validated = finiteSourceKey([label, ...values]);
	assertPaint(Array.isArray(validated) && validated[0] === label, "stale");
	return frozen(validated) as unknown as readonly [
		typeof label,
		...WechatInlinePseudoPaintSourceKeyValue[],
	];
}

export function wholeSourceKeyParts(
	values: readonly unknown[],
): WechatInlinePseudoPaintSourceKeyParts {
	return canonicalSourceKeyParts(
		"easymde-inline-pseudo-paint-source-v1",
		values,
	);
}

export function finitePixels(value: string, allowZero = false): number {
	const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(value);
	assertPaint(match?.[1], "geometry");
	const pixels = Number(match[1]);
	assertPaint(
		Number.isFinite(pixels) && pixels >= 0 && pixels <= 4_096,
		"geometry",
	);
	assertPaint(allowZero || pixels > 0, "geometry");
	return pixels;
}

export function zeroPixels(value: string): boolean {
	return "0" === value || /^0(?:\.0+)?px$/u.test(value);
}

export function opaqueColor(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized || ["transparent", "none"].includes(normalized)) return false;
	const shortHex = /^#([0-9a-f]{3,4})$/iu.exec(normalized);
	if (shortHex?.[1]) {
		return (
			3 === shortHex[1].length ||
			15 === Number.parseInt(shortHex[1][3] ?? "", 16)
		);
	}
	const longHex = /^#([0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(normalized);
	if (longHex?.[1]) {
		return (
			6 === longHex[1].length ||
			255 === Number.parseInt(longHex[1].slice(6), 16)
		);
	}
	const rgb = /^rgba?\((.*)\)$/u.exec(normalized)?.[1];
	if (rgb) {
		const commaParts = rgb
			.trim()
			.split(",")
			.map((part) => part.trim());
		if (3 === commaParts.length) return true;
		if (4 !== commaParts.length) return false;
		return 1 === Number(commaParts[3]);
	}
	const hsl = /^hsla?\((.*)\)$/u.exec(normalized)?.[1];
	if (hsl) {
		const slash = /\/\s*([^\s)]+)\s*$/u.exec(hsl)?.[1];
		return undefined === slash || 1 === Number(slash);
	}
	return true;
}

export function maskValues(
	capabilities: WechatInlinePseudoPaintCssCapabilities,
	style: CSSStyleDeclaration,
): WechatInlinePseudoPaintMaskPropertyValues {
	return frozen(
		Object.fromEntries(
			MASK_PROPERTY_NAMES.map(([key, property]) => [
				key,
				propertyState(capabilities, style, property),
			]),
		),
	) as WechatInlinePseudoPaintMaskPropertyValues;
}

export function attributeSnapshot(
	element: Element,
): WechatInlinePseudoPaintAttributeSnapshot {
	return frozen(
		Array.from(element.attributes).map(({ name, value }) =>
			frozen([name, value] as const),
		),
	);
}

export function assertDetachedTarget(element: Element): void {
	assertPaint(!element.isConnected, "binding");
}
