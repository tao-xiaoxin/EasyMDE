import { pseudoContent } from "./wechat-pseudo-content";
import type {
	WechatPreviewMeasurementLease,
	WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import type { ClipboardSourceFreshnessGuard } from "./wechat-source-freshness";
import { replaceDeclarations } from "./wechat-style-declarations";
import { SVGPathData } from "svg-pathdata";
import {
	pseudoSvgContent,
	SAFE_PSEUDO_SVG_ATTRIBUTES,
} from "./wechat-task-paint";
import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";

/**
 * Bounded Source→paint-plan→explicit clone-binding→detached-apply helper.
 */

export type WechatInlinePseudoPaintFailureReason =
	| "admission"
	| "binding"
	| "geometry"
	| "mask"
	| "stale"
	| "style"
	| "animation";

export type WechatInlinePseudoPaintSupportedProperty = Readonly<{
	support: "supported";
	value: string;
}>;

export type WechatInlinePseudoPaintUnsupportedProperty = Readonly<{
	support: "unsupported";
	value: null;
}>;

/**
 * A supported-but-empty property is unreadable and fails. Unsupported is an
 * observed state from `supports(property, 'initial')`, never an invented value.
 */
export type WechatInlinePseudoPaintProperty =
	| WechatInlinePseudoPaintSupportedProperty
	| WechatInlinePseudoPaintUnsupportedProperty;

export type WechatInlinePseudoPaintStyleSnapshot = Readonly<
	Record<string, WechatInlinePseudoPaintProperty>
>;

/**
 * `supports` has no one-argument form in this contract. Every property state is
 * queried as `supports(property, 'initial')`; the measured browser's unsupported
 * `-webkit-mask-mode` therefore produces an explicit unsupported state.
 */
export type WechatInlinePseudoPaintCssCapabilities = Readonly<{
	getComputedStyle: (
		element: Element,
		pseudoElement?: "::before",
	) => CSSStyleDeclaration;
	supports: (property: string, value: string) => boolean;
}>;

export type WechatInlinePseudoPaintAnimationKind =
	| "css-animation"
	| "css-transition"
	| "unknown";

/**
 * Inspection is required whenever a candidate declares a transition or its
 * computed animation fields differ from the initial none/zero policy. `endTime`
 * must be finite at runtime. A missing API, thrown inspection, non-finite end
 * time, pending/active unknown family, or CSS animation family outside the
 * explicitly proven scope fails with the `animation` reason.
 */
export type WechatInlinePseudoPaintAnimationInspection = Readonly<{
	endTime: number;
	kind: WechatInlinePseudoPaintAnimationKind;
	pending: boolean;
	playState: string;
	transitionProperty: string | null;
}>;

export type WechatInlinePseudoPaintAnimationCapabilities = Readonly<{
	inspectAnimations: (
		root: Element,
	) => readonly WechatInlinePseudoPaintAnimationInspection[];
}>;

export type WechatInlinePseudoPaintCapabilities = Readonly<{
	css: WechatInlinePseudoPaintCssCapabilities;
	animations: WechatInlinePseudoPaintAnimationCapabilities;
}>;

/**
 * Exactly one actual existing readiness owner is supplied. This contract does
 * not create or wrap a lease. Transition `isReady()` is necessary but is not
 * sufficient animation proof; it is augmented by actual animation inspection.
 */
export type WechatInlinePseudoPaintExistingReadiness =
	| Readonly<{
			kind: "measurement";
			lease: Pick<WechatPreviewMeasurementLease, "isReady">;
	  }>
	| Readonly<{
			kind: "transition";
			lease: Pick<WechatPreviewTransitionLease, "isReady">;
	  }>;

export type WechatInlinePseudoPaintReadiness = Readonly<{
	existing: WechatInlinePseudoPaintExistingReadiness;
	/**
	 * Existing transaction DOM/freshness guard. This is not a CSSOM Source-key
	 * reread and cannot replace the Blob or post-modern-write Source reads below.
	 */
	sourceFreshness: Pick<ClipboardSourceFreshnessGuard, "isCurrent">;
}>;

/**
 * Owned by the existing Clipboard transaction, not by this helper and not by a
 * new lease. Each checkpoint calls `read` again against live Source and compares
 * the complete canonical Source key, including late CSSOM changes.
 */
export type WechatInlinePseudoPaintTransactionFreshnessChecks = Readonly<{
	assertSourceKeyAtBlob: (sourceKey: string) => void;
	assertSourceKeyAfterModernWrite: (sourceKey: string) => void;
}>;

export type WechatInlinePseudoPaintBorderBox = Readonly<{
	height: number;
	width: number;
}>;

export type WechatInlinePseudoPaintMaskPropertyValues = Readonly<{
	clip: WechatInlinePseudoPaintProperty;
	composite: WechatInlinePseudoPaintProperty;
	image: WechatInlinePseudoPaintProperty;
	mode: WechatInlinePseudoPaintProperty;
	origin: WechatInlinePseudoPaintProperty;
	position: WechatInlinePseudoPaintProperty;
	repeat: WechatInlinePseudoPaintProperty;
	size: WechatInlinePseudoPaintProperty;

	prefixedClip: WechatInlinePseudoPaintProperty;
	prefixedComposite: WechatInlinePseudoPaintProperty;
	prefixedImage: WechatInlinePseudoPaintProperty;
	/** Explicitly unsupported on the measured browser via the required supports query. */
	prefixedMode: WechatInlinePseudoPaintProperty;
	prefixedOrigin: WechatInlinePseudoPaintProperty;
	prefixedPosition: WechatInlinePseudoPaintProperty;
	prefixedRepeat: WechatInlinePseudoPaintProperty;
	prefixedSize: WechatInlinePseudoPaintProperty;
}>;

export type WechatInlinePseudoPaintMaskSource = Readonly<{
	/** Original validated opaque alpha paths, before any Source-color replacement. */
	alphaPaths: readonly Readonly<{
		originalAttributes: readonly (readonly [string, string])[];
	}>[];
	intrinsicRatio: number;
	/** Zero padding, zero borders, no background image, and intrinsic ratio equality. */
	geometry: Readonly<{
		contentBoxHeight: number;
		contentBoxWidth: number;
		intrinsicRatioMatchesContentBox: true;
	}>;
	mask: WechatInlinePseudoPaintMaskPropertyValues;
	viewBox: string;
}>;

export type WechatInlinePseudoPaintCircleSource = Readonly<{
	borderColor: string;
	borderWidth: number;
	fill: string;
	height: number;
	width: number;
}>;

export type WechatInlinePseudoPaintSourcePaint =
	| Readonly<{ kind: "circle"; paint: WechatInlinePseudoPaintCircleSource }>
	| Readonly<{ kind: "mask"; paint: WechatInlinePseudoPaintMaskSource }>;

export type WechatInlinePseudoPaintLinkSource = Readonly<{
	kind: "text";
	text: string;
}>;

export type WechatInlinePseudoPaintCanonicalScalar =
	| string
	| boolean
	| null
	| number;

/**
 * Closed, bounded canonical domain: strings, booleans, null, finite validated
 * numbers, and readonly arrays of this same union. Runtime validation bounds
 * depth and total size, rejects undefined, functions, DOM nodes, symbols,
 * bigint, objects, sparse arrays, and non-finite numbers before serialization.
 * No value is mapped to an equivalent replacement.
 */
export type WechatInlinePseudoPaintSourceKeyValue =
	| WechatInlinePseudoPaintCanonicalScalar
	| readonly WechatInlinePseudoPaintSourceKeyValue[];

/**
 * Fixed order is encoded by construction. `sourceKey` is the collision-free
 * canonical stringification of exactly these parts; it is never a hash.
 */
export type WechatInlinePseudoPaintSourceKeyParts = readonly [
	"easymde-inline-pseudo-paint-source-v1",
	...WechatInlinePseudoPaintSourceKeyValue[],
];

export type WechatInlinePseudoPaintEvidenceKeyParts =
	WechatInlinePseudoPaintRawKeyParts;

/**
 * Frozen Source-only evidence. Clone roots, clone paths, clone children,
 * generated markers, portable clone styles, clone subtrees, and Source-path
 * reconstruction are forbidden here and in `sourceKey`.
 */
export type WechatInlinePseudoPaintSourceEvidence = Readonly<{
	borderBox: WechatInlinePseudoPaintBorderBox;
	/** Exact live Source identity; excluded from the canonical Source key. */
	source: Element;
	/** One raw-key path is shared by auxiliary signatures and ready evidence. */
	raw: WechatInlinePseudoPaintRawCapture;
	sourceKey: string;
	sourceKeyParts: WechatInlinePseudoPaintEvidenceKeyParts;
	link: WechatInlinePseudoPaintLinkSource | null;
	mask: WechatInlinePseudoPaintMaskPropertyValues;
	ownerStyle: WechatInlinePseudoPaintStyleSnapshot;
	paint: WechatInlinePseudoPaintSourcePaint;
	pseudoStyle: WechatInlinePseudoPaintStyleSnapshot;
}>;

export type WechatInlinePseudoPaintSource = Readonly<{
	sourceKey: string;
	sourceKeyParts: WechatInlinePseudoPaintSourceKeyParts;
	evidence: readonly WechatInlinePseudoPaintSourceEvidence[];
}>;

export type WechatInlinePseudoPaintReaderInput = Readonly<{
	capabilities: WechatInlinePseudoPaintCapabilities;
	readiness: WechatInlinePseudoPaintReadiness;
	source: HTMLElement;
}>;

/**
 * Lease-free, immutable raw inputs for one candidate owner. Capture deliberately
 * contains no readiness, animation inspection, SVG parse, or paint-plan output.
 * Live Source references are outside the canonical raw key.
 */
export type WechatInlinePseudoPaintRawCapture = Readonly<{
	attributes: WechatInlinePseudoPaintAttributeSnapshot;
	borderBox: WechatInlinePseudoPaintBorderBox;
	family: "circle" | "mask";
	mask: WechatInlinePseudoPaintMaskPropertyValues;
	ownerStyle: WechatInlinePseudoPaintStyleSnapshot;
	pseudoStyle: WechatInlinePseudoPaintStyleSnapshot;
	rawKey: string;
	rawKeyParts: WechatInlinePseudoPaintRawKeyParts;
	source: HTMLElement;
	textContent: string;
}>;

export type WechatInlinePseudoPaintRawPayload =
	| Readonly<{ family: "circle" }>
	| Readonly<{ family: "mask"; maskImage: string }>;

export type WechatInlinePseudoPaintRawKeyParts = readonly [
	"easymde-inline-pseudo-paint-source-v1",
	...WechatInlinePseudoPaintSourceKeyValue[],
];

export type WechatInlinePseudoPaintDetachedAttribute = readonly [
	name: string,
	value: string,
];

export type WechatInlinePseudoPaintDetachedNode = Readonly<{
	attributes: readonly WechatInlinePseudoPaintDetachedAttribute[];
	children: readonly WechatInlinePseudoPaintDetachedNode[];
	localName: string;
	namespace: "http://www.w3.org/2000/svg";
}>;

export type WechatInlinePseudoPaintPlanItem = Readonly<{
	evidenceIndex: number;
	paint: WechatInlinePseudoPaintDetachedNode;
	sourceKey: string;
}>;

export type WechatInlinePseudoLinkPlan = Readonly<{
	evidenceIndex: number;
	/** Starts empty. Current bound clone children are moved exactly once on apply. */
	innerSpan: Readonly<{
		attributes: readonly WechatInlinePseudoPaintDetachedAttribute[];
		children: readonly [];
		localName: "span";
		namespace: "http://www.w3.org/1999/xhtml";
	}>;
	outerAnchorContract: Readonly<{
		preserveAllOriginalAttributes: true;
		textDecoration: "none";
	}>;
	sourceKey: string;
}>;

export type WechatInlinePseudoPaintPlan = Readonly<{
	items: readonly WechatInlinePseudoPaintPlanItem[];
	links: readonly WechatInlinePseudoLinkPlan[];
	sourceKey: string;
}>;

/**
 * Exact attribute set. Absence of `style` is represented by absence of its
 * tuple; a present empty style is represented by `['style', '']`.
 */
export type WechatInlinePseudoPaintAttributeSnapshot =
	readonly WechatInlinePseudoPaintDetachedAttribute[];

export type WechatInlinePseudoPaintMarkerBinding = Readonly<{
	carrierText: " " | "\u2060";
	/** Finalized owner that contains the exact generated marker during apply. */
	clone: Element;
	evidenceIndex: number;
	/** Generated marker is a styled whitespace SPAN. */
	generatedMarker: HTMLSpanElement;
	generatedMarkerStyle: string;
	/** Exact original serialization clone registered as the marker owner. */
	originalClone: Element;
	source: Element;
	sourceKey: string;
}>;

export type WechatInlinePseudoLinkBinding = Readonly<{
	anchor: HTMLAnchorElement;
	clone: HTMLAnchorElement;
	evidenceIndex: number;
	generatedMarker: HTMLSpanElement;
	/** Actual inner SPAN created for this binding and empty before apply. */
	innerSpan: HTMLSpanElement;
	source: HTMLAnchorElement;
	sourceKey: string;
	visualStyleToTransfer: string;
}>;

export type WechatInlinePseudoPaintCloneBinding = Readonly<{
	links: readonly WechatInlinePseudoLinkBinding[];
	markers: readonly WechatInlinePseudoPaintMarkerBinding[];
	plan: WechatInlinePseudoPaintPlan;
}>;

/**
 * Captured inside `apply` immediately before its first mutation. These values
 * are never accepted from an earlier `bind` call.
 */
export type WechatInlinePseudoPaintApplyTimeSnapshot = Readonly<{
	anchors: readonly Readonly<{
		allOriginalAttributes: WechatInlinePseudoPaintAttributeSnapshot;
		anchor: HTMLAnchorElement;
		originalChildren: readonly ChildNode[];
	}>[];
	parents: readonly Readonly<{
		childNodes: readonly ChildNode[];
		parent: Node;
	}>[];
}>;

export type WechatInlinePseudoPaintDetachedBatch = Readonly<{
	bindings: WechatInlinePseudoPaintCloneBinding;
	/** Exact detached serialization root accepted by bind. */
	cloneRoot: HTMLElement;
	sourceKey: string;
}>;

export type WechatInlinePseudoPaintMarkerFinalInvariant = Readonly<{
	clone: Element;
	evidenceIndex: number;
	installedSVG: SVGSVGElement;
	kind: "paint";
	parent: Element;
	svgPaint: WechatInlinePseudoPaintDetachedNode;
}>;

export type WechatInlinePseudoLinkFinalInvariant = Readonly<{
	clone: HTMLAnchorElement;
	evidenceIndex: number;
	/** Captured at apply time, never from bind output. */
	expectedOriginalChildIdentities: readonly ChildNode[];
	expectedPlainText: string;
	installedSVG: SVGSVGElement;
	innerSpan: HTMLSpanElement;
	kind: "link";
	parent: Element;
}>;

/** One invariant per admitted owner, including all eight actual owners. */
export type WechatInlinePseudoPaintOwnerFinalInvariant =
	| WechatInlinePseudoPaintMarkerFinalInvariant
	| WechatInlinePseudoLinkFinalInvariant;

/**
 * Future implementation performance boundary:
 * - Existing per-Source callers use a pure one-element reader on data they are
 *   already walking. They must never call the recursive root reader per node.
 * - One full root read may be reused for the final Source-key guard; it must not
 *   become another per-node guard.
 * - Reuse computed values and capabilities supplied by the existing owner.
 *   Materialize heavy owner/pseudo fields only after candidate admission.
 * - No speculative global cache, observer, or additional API is part of this
 *   contract. Add one only if an existing caller later requires it.
 *
 * Stage ownership:
 * 1. `read` consumes Source, one existing readiness owner, and capabilities.
 * 2. Source evidence is immutable and contains no clone state.
 * 3. `plan` is pure and never rereads Source.
 * 4. `bind` explicitly attaches the plan to a distinct detached clone and
 *    verifies that the generated marker is the styled whitespace carrier.
 * 5. `apply` validates every binding, captures all parents and complete anchor
 *    attribute sets at apply time, performs one detached batch, restores exact
 *    identities/attributes including absent-versus-empty style on failure, and
 *    returns one actual-reference invariant per admitted owner.
 */
export type WechatInlinePseudoPaintApi = Readonly<{
	admitInput: (
		raw: WechatInlinePseudoPaintRawCapture,
		input: WechatInlinePseudoPaintReaderInput,
	) => WechatInlinePseudoPaintSourceEvidence;
	assemble: (
		input: WechatInlinePseudoPaintReaderInput,
		captures: readonly WechatInlinePseudoPaintRawCapture[],
	) => WechatInlinePseudoPaintSource;
	captureInput: (
		source: HTMLElement,
		css: WechatInlinePseudoPaintCssCapabilities,
	) => WechatInlinePseudoPaintRawCapture | null;
	apply: (
		batch: WechatInlinePseudoPaintDetachedBatch,
	) => readonly WechatInlinePseudoPaintOwnerFinalInvariant[];
	bind: (
		source: WechatInlinePseudoPaintSource,
		plan: WechatInlinePseudoPaintPlan,
		clone: HTMLElement,
		markerFor: (evidence: WechatInlinePseudoPaintSourceEvidence) => Readonly<{
			/** Original serialization clone registered as the marker owner. */
			clone: Element;
			generatedMarker: HTMLSpanElement;
			/** Final owner reached only through the canonical structure map. */
			parent: Element;
		}>,
	) => WechatInlinePseudoPaintDetachedBatch;
	plan: (source: WechatInlinePseudoPaintSource) => WechatInlinePseudoPaintPlan;
	read: (
		input: WechatInlinePseudoPaintReaderInput,
	) => WechatInlinePseudoPaintSource;
}>;

const PSEUDO_ELEMENT = "::before" as const;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg" as const;
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;
const MAX_SOURCE_KEY_DEPTH = 16;
const MAX_SOURCE_KEY_NODES = 4_096;
const MAX_SOURCE_KEY_STRING = 65_536;
const EPSILON = 1e-9;

const OWNER_PROPERTIES = [
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

const PSEUDO_PROPERTIES = [
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

const MASK_PROPERTY_NAMES = [
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

function paintFailure(reason: WechatInlinePseudoPaintFailureReason): Error {
	return new Error(`wechat-inline-pseudo-paint-${reason}`);
}

function assertPaint(
	condition: unknown,
	reason: WechatInlinePseudoPaintFailureReason,
): asserts condition {
	if (!condition) throw paintFailure(reason);
}

function frozen<T>(value: T): T {
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

function styleSnapshot(
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

function styleKeyEntries(
	snapshot: WechatInlinePseudoPaintStyleSnapshot,
): readonly (readonly [string, "supported" | "unsupported", string | null])[] {
	return Object.entries(snapshot).map(([property, state]) =>
		frozen([property, state.support, state.value] as const),
	);
}

function supportedStyleValue(
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
		assertPaint(Object.hasOwn(array, index), "stale");
		output.push(finiteSourceKey(array[index], depth + 1, state));
	}
	return frozen(output);
}

function canonicalSourceKey(parts: readonly unknown[]): string {
	return JSON.stringify(finiteSourceKey(parts));
}

function canonicalSourceKeyParts(
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

function wholeSourceKeyParts(
	values: readonly unknown[],
): WechatInlinePseudoPaintSourceKeyParts {
	return canonicalSourceKeyParts(
		"easymde-inline-pseudo-paint-source-v1",
		values,
	);
}

function finitePixels(value: string, allowZero = false): number {
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

function zeroPixels(value: string): boolean {
	return "0" === value || /^0(?:\.0+)?px$/u.test(value);
}

function opaqueColor(value: string): boolean {
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

function maskValues(
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

function assertAnimationProof(
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

function circleRadiusEvidence(value: string, cssSide: number): boolean {
	const normalized = value.trim().toLowerCase();
	if (["50%", "100%"].includes(normalized)) return true;
	if (!normalized.endsWith("px")) return false;
	const match = /^(?:\d+(?:\.\d+)?|\.\d+)px$/u.exec(normalized);
	return Boolean(match) && Number.parseFloat(normalized) >= cssSide / 2;
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

function assertNoOutline(pseudo: WechatInlinePseudoPaintStyleSnapshot): void {
	assertPaint(
		"none" === supportedStyleValue(pseudo, "outline-style").toLowerCase(),
		"admission",
	);
	finitePixels(supportedStyleValue(pseudo, "outline-width"), true);
}

function readCircle(
	pseudo: WechatInlinePseudoPaintStyleSnapshot,
): WechatInlinePseudoPaintCircleSource {
	return assertPostCommitCircleGeometry(pseudo);
}

function readMaskSource(
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

/**
 * Lease-free raw capture. This is the only per-element candidate read shared by
 * auxiliary signatures and ready admission. It performs no readiness, animation,
 * SVG parser, or paint-plan work.
 */
export function captureWechatInlinePseudoPaintInput(
	source: HTMLElement,
	css: WechatInlinePseudoPaintCssCapabilities,
): WechatInlinePseudoPaintRawCapture | null {
	const pseudoComputed = css.getComputedStyle(source, PSEUDO_ELEMENT);
	const rawContent = pseudoComputed.getPropertyValue("content");
	assertPaint(
		"string" === typeof rawContent && "" !== rawContent.trim(),
		"style",
	);
	const content = pseudoContent(rawContent);
	if (
		null === content ||
		"" !== content ||
		source.closest(
			"svg, math, .katex, .easymde-math-block, .easymde-math-inline, pre, code, .task-list, .task-list-item",
		)
	)
		return null;
	const ownerComputed = css.getComputedStyle(source);
	const cheap = (style: CSSStyleDeclaration, property: string): string =>
		style.getPropertyValue(property).trim().toLowerCase();
	if (
		"inline-block" !== cheap(pseudoComputed, "display") ||
		"static" !== cheap(pseudoComputed, "position") ||
		"none" !== cheap(pseudoComputed, "float") ||
		"none" !== cheap(pseudoComputed, "transform") ||
		"horizontal-tb" !== cheap(pseudoComputed, "writing-mode") ||
		"static" !== cheap(ownerComputed, "position") ||
		"none" !== cheap(ownerComputed, "float") ||
		"none" !== cheap(ownerComputed, "transform") ||
		"horizontal-tb" !== cheap(ownerComputed, "writing-mode") ||
		"none" !== cheap(ownerComputed, "background-image")
	)
		return null;
	const isLink = "A" === source.tagName;
	const ownerDisplay = cheap(ownerComputed, "display");
	const cheapLinkMask =
		!["", "none"].includes(cheap(pseudoComputed, "mask-image")) ||
		!["", "none"].includes(cheap(pseudoComputed, "-webkit-mask-image"));
	if (
		isLink
			? "inline" !== ownerDisplay || !cheapLinkMask
			: "block" !== ownerDisplay || cheapLinkMask
	) {
		return null;
	}
	if (!isLink) {
		const cssWidth = cheap(pseudoComputed, "width");
		const cssHeight = cheap(pseudoComputed, "height");
		if (
			cssWidth !== cssHeight ||
			!/^(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(cssWidth)
		)
			return null;
		const cssSide = Number.parseFloat(cssWidth);
		if (!Number.isFinite(cssSide) || cssSide <= 0) return null;
		const radii = [
			"border-top-left-radius",
			"border-top-right-radius",
			"border-bottom-right-radius",
			"border-bottom-left-radius",
		].map((property) => cheap(pseudoComputed, property));
		if (!radii.every((radius) => circleRadiusEvidence(radius, cssSide)))
			return null;
		for (const radius of radii) assertPaint("" !== radius, "style");
	}

	const pseudoStyle = styleSnapshot(css, pseudoComputed, PSEUDO_PROPERTIES);
	assertPaint(
		supportedStyleValue(pseudoStyle, "content") === rawContent.trim(),
		"stale",
	);
	const ownerStyle = styleSnapshot(css, ownerComputed, OWNER_PROPERTIES);
	const mask = maskValues(css, pseudoComputed);
	const family = isLink ? ("mask" as const) : ("circle" as const);
	const bounds = source.getBoundingClientRect();
	assertPaint(
		Number.isFinite(bounds.width) &&
			bounds.width >= 0 &&
			Number.isFinite(bounds.height) &&
			bounds.height >= 0,
		"geometry",
	);
	const borderBox = frozen({ height: bounds.height, width: bounds.width });
	const attributes = attributeSnapshot(source);
	const textContent = source.textContent ?? "";
	const parts = canonicalSourceKeyParts(
		"easymde-inline-pseudo-paint-source-v1",
		[
			source.namespaceURI ?? "",
			source.localName,
			attributes,
			ownerDisplay,
			textContent,
			borderBox.width,
			borderBox.height,
			family,
			styleKeyEntries(ownerStyle),
			styleKeyEntries(pseudoStyle),
			MASK_PROPERTY_NAMES.map(
				([key, property]) =>
					[property, mask[key].support, mask[key].value] as const,
			),
		],
	);
	return frozen({
		attributes,
		borderBox,
		family,
		mask,
		ownerStyle,
		pseudoStyle,
		rawKey: canonicalSourceKey(parts),
		rawKeyParts: parts,
		source,
		textContent,
	});
}

function assertRawCapture(raw: WechatInlinePseudoPaintRawCapture): void {
	assertPaint(
		raw.family === ("A" === raw.source.tagName ? "mask" : "circle"),
		"stale",
	);
	assertPaint(raw.source.isConnected, "stale");
	assertPaint(canonicalSourceKey(raw.rawKeyParts) === raw.rawKey, "stale");
	assertPaint(raw.rawKeyParts[1] === (raw.source.namespaceURI ?? ""), "stale");
	assertPaint(raw.rawKeyParts[2] === raw.source.localName, "stale");
	assertPaint(Array.isArray(raw.attributes), "stale");
}

function admissionPaint(
	raw: WechatInlinePseudoPaintRawCapture,
): WechatInlinePseudoPaintSourcePaint {
	if ("mask" === raw.family) {
		return frozen({
			kind: "mask" as const,
			paint: readMaskSource(raw.source, raw.mask, raw.pseudoStyle),
		});
	}
	return frozen({
		kind: "circle" as const,
		paint: readCircle(raw.pseudoStyle),
	});
}

export function admitWechatInlinePseudoPaintInput(
	raw: WechatInlinePseudoPaintRawCapture,
	input: WechatInlinePseudoPaintReaderInput,
): WechatInlinePseudoPaintSourceEvidence {
	return admitRawCapture(raw, input, false);
}

function admitRawCapture(
	raw: WechatInlinePseudoPaintRawCapture,
	input: WechatInlinePseudoPaintReaderInput,
	readinessChecked: boolean,
): WechatInlinePseudoPaintSourceEvidence {
	assertRawCapture(raw);
	assertPaint(raw.borderBox.width > 0 && raw.borderBox.height > 0, "geometry");
	if (!readinessChecked) {
		assertPaint(input.readiness.sourceFreshness.isCurrent(), "stale");
		assertPaint(input.readiness.existing.lease.isReady(), "animation");
	}
	const paint = admissionPaint(raw);
	return sourceAdmission(raw, paint, input.capabilities);
}

function sourceAdmission(
	raw: WechatInlinePseudoPaintRawCapture,
	paint: WechatInlinePseudoPaintSourcePaint,
	capabilities: WechatInlinePseudoPaintCapabilities,
): WechatInlinePseudoPaintSourceEvidence {
	const {
		borderBox,
		family,
		mask,
		ownerStyle,
		pseudoStyle,
		source,
		textContent,
	} = raw;
	const isLink = "mask" === family;
	const href = raw.attributes.find(
		([name]) => "href" === name.toLowerCase(),
	)?.[1];
	assertPaint(
		"visible" === supportedStyleValue(pseudoStyle, "visibility").toLowerCase(),
		"admission",
	);
	assertPaint("1" === supportedStyleValue(pseudoStyle, "opacity"), "admission");
	assertPaint(
		"none" === supportedStyleValue(pseudoStyle, "box-shadow").toLowerCase(),
		"admission",
	);
	assertPaint(
		"none" === supportedStyleValue(pseudoStyle, "filter").toLowerCase(),
		"admission",
	);
	assertPaint(
		"none" === supportedStyleValue(pseudoStyle, "clip-path").toLowerCase(),
		"admission",
	);
	assertAnimationProof(source, pseudoStyle, capabilities);
	if (isLink) assertPaint(Boolean(href?.trim()), "admission");
	const link = isLink
		? frozen({
				kind: "text" as const,
				text: textContent.trim(),
			})
		: null;
	if (link) assertPaint(link.text.length > 0, "admission");
	if (isLink) assertPaint(link?.text === textContent.trim(), "stale");
	else assertPaint(null === link, "stale");
	return frozen({
		borderBox,
		raw,
		source,
		sourceKey: raw.rawKey,
		sourceKeyParts: raw.rawKeyParts,
		link,
		mask,
		ownerStyle,
		paint,
		pseudoStyle,
	});
}

export function readWechatInlinePseudoPaintElement(
	input: WechatInlinePseudoPaintReaderInput,
	source: HTMLElement,
): WechatInlinePseudoPaintSourceEvidence | null {
	const raw = captureWechatInlinePseudoPaintInput(
		source,
		input.capabilities.css,
	);
	return raw ? admitRawCapture(raw, input, false) : null;
}

function readBatchElement(
	input: WechatInlinePseudoPaintReaderInput,
	source: HTMLElement,
): WechatInlinePseudoPaintRawCapture | null {
	return captureWechatInlinePseudoPaintInput(
		source,
		input.capabilities.css,
	);
}

/**
 * Builds the Source projection from an already ordered, owner-complete raw
 * inventory. Completeness is the collector's responsibility: this function
 * validates only supplied identities and order and never walks Source.
 */
export function assembleWechatInlinePseudoPaintSource(
	input: WechatInlinePseudoPaintReaderInput,
	captures: readonly WechatInlinePseudoPaintRawCapture[],
): WechatInlinePseudoPaintSource {
	assertPaint(input.readiness.sourceFreshness.isCurrent(), "stale");
	assertPaint(input.readiness.existing.lease.isReady(), "animation");
	assertPaint(Array.isArray(captures), "stale");
	const seen = new Set<Element>();
	let previous: Element | null = null;
	const evidence = captures.map((raw) => {
		const value = admitRawCapture(raw, input, true);
		assertPaint(
			canonicalSourceKey(raw.rawKeyParts[3]) ===
				canonicalSourceKey(raw.attributes),
			"stale",
		);
		assertPaint(
			(raw.source === input.source || input.source.contains(raw.source)) &&
				!seen.has(raw.source),
			"admission",
		);
		if (previous) {
			assertPaint(
				Boolean(
					previous.compareDocumentPosition(raw.source) &
						Node.DOCUMENT_POSITION_FOLLOWING,
				),
				"admission",
			);
		}
		seen.add(raw.source);
		previous = raw.source;
		return value;
	});
	const parts = wholeSourceKeyParts([
		input.source.namespaceURI ?? "",
		input.source.localName,
		evidence.map((item) => [
			item.source.namespaceURI ?? "",
			item.source.localName,
			item.sourceKey,
		]),
	]);
	assertPaint(input.readiness.sourceFreshness.isCurrent(), "stale");
	assertPaint(input.readiness.existing.lease.isReady(), "animation");
	return frozen({
		sourceKey: canonicalSourceKey(parts),
		sourceKeyParts: parts,
		evidence: frozen(evidence),
	});
}

export function readWechatInlinePseudoPaint(
	input: WechatInlinePseudoPaintReaderInput,
): WechatInlinePseudoPaintSource {
	const elements: HTMLElement[] = [
		input.source,
		...Array.from(input.source.querySelectorAll<HTMLElement>("*")),
	];
	const captures: WechatInlinePseudoPaintRawCapture[] = [];
	elements.forEach((element) => {
		const value = readBatchElement(input, element);
		if (value) captures.push(value);
	});
	return assembleWechatInlinePseudoPaintSource(input, captures);
}

function detachedAttributes(
	attributes: readonly (readonly [string, string])[],
): readonly WechatInlinePseudoPaintDetachedAttribute[] {
	return frozen(
		attributes.map(([name, value]) => frozen([name, value] as const)),
	);
}

function detachedElement(
	namespace: WechatInlinePseudoPaintDetachedNode["namespace"],
	localName: string,
	attributes: readonly (readonly [string, string])[],
	children: readonly WechatInlinePseudoPaintDetachedNode[] = [],
): WechatInlinePseudoPaintDetachedNode {
	return frozen({
		attributes: detachedAttributes(attributes),
		children: frozen(children),
		localName,
		namespace,
	});
}

function svgStyle(evidence: WechatInlinePseudoPaintSourceEvidence): string {
	const width =
		"circle" === evidence.paint.kind
			? evidence.paint.paint.width
			: evidence.paint.paint.geometry.contentBoxWidth;
	const height =
		"circle" === evidence.paint.kind
			? evidence.paint.paint.height
			: evidence.paint.paint.geometry.contentBoxHeight;
	const pseudo = evidence.pseudoStyle;
	const value = `${width}px`;
	const size = `${height}px`;
	return [
		"display:inline-block",
		"box-sizing:border-box",
		`width:${value}`,
		`min-width:${value}`,
		`max-width:${value}`,
		`height:${size}`,
		`min-height:${size}`,
		`max-height:${size}`,
		`vertical-align:${supportedStyleValue(pseudo, "vertical-align")}`,
		`margin-top:${supportedStyleValue(pseudo, "margin-top")}`,
		`margin-right:${supportedStyleValue(pseudo, "margin-right")}`,
		`margin-bottom:${supportedStyleValue(pseudo, "margin-bottom")}`,
		`margin-left:${supportedStyleValue(pseudo, "margin-left")}`,
		"overflow:visible",
	].join(";");
}

function planSvg(
	evidence: WechatInlinePseudoPaintSourceEvidence,
): WechatInlinePseudoPaintDetachedNode {
	const common = [
		["xmlns", SVG_NAMESPACE],
		["aria-hidden", "true"],
		[
			"width",
			"circle" === evidence.paint.kind
				? String(evidence.paint.paint.width)
				: String(evidence.paint.paint.geometry.contentBoxWidth),
		],
		[
			"height",
			"circle" === evidence.paint.kind
				? String(evidence.paint.paint.height)
				: String(evidence.paint.paint.geometry.contentBoxHeight),
		],
		[
			"viewBox",
			"circle" === evidence.paint.kind
				? `0 0 ${evidence.paint.paint.width} ${evidence.paint.paint.height}`
				: evidence.paint.paint.viewBox,
		],
		["style", svgStyle(evidence)],
	] as const;
	if ("circle" === evidence.paint.kind) {
		const circle = evidence.paint.paint;
		return detachedElement(SVG_NAMESPACE, "svg", common, [
			detachedElement(SVG_NAMESPACE, "circle", [
				["cx", String(circle.width / 2)],
				["cy", String(circle.height / 2)],
				["r", String((circle.width - circle.borderWidth) / 2)],
				["fill", circle.fill],
				["stroke", circle.borderColor],
				["stroke-width", String(circle.borderWidth)],
			]),
		]);
	}
	return detachedElement(
		SVG_NAMESPACE,
		"svg",
		common,
		evidence.paint.paint.alphaPaths.map((path) => {
			const attributes: (readonly [string, string])[] =
				path.originalAttributes.map(([name, value]) => [name, value] as const);
			const fillIndex = attributes.findIndex(
				([name]) => "fill" === name.toLowerCase(),
			);
			if (-1 === fillIndex)
				attributes.push([
					"fill",
					supportedStyleValue(evidence.pseudoStyle, "background-color"),
				]);
			else
				attributes[fillIndex] = [
					attributes[fillIndex]?.[0] ?? "fill",
					supportedStyleValue(evidence.pseudoStyle, "background-color"),
				];
			return detachedElement(SVG_NAMESPACE, "path", attributes);
		}),
	);
}

export function planWechatInlinePseudoPaint(
	source: WechatInlinePseudoPaintSource,
): WechatInlinePseudoPaintPlan {
	assertPaint(source.evidence.length <= MAX_SOURCE_KEY_NODES / 16, "admission");
	assertPaint(
		canonicalSourceKey(source.sourceKeyParts) === source.sourceKey,
		"stale",
	);
	assertPaint(
		new Set(source.evidence.map(({ source: element }) => element)).size ===
			source.evidence.length,
		"admission",
	);
	const items = source.evidence.map((evidence, evidenceIndex) => {
		assertPaint(
			canonicalSourceKey(evidence.sourceKeyParts) === evidence.sourceKey,
			"stale",
		);
		assertPaint(
			evidence.sourceKeyParts[1] === (evidence.source.namespaceURI ?? ""),
			"stale",
		);
		assertPaint(
			evidence.sourceKeyParts[2] === evidence.source.localName,
			"stale",
		);
		return frozen({
			evidenceIndex,
			paint: planSvg(evidence),
			sourceKey: evidence.sourceKey,
		});
	});
	const links = source.evidence.flatMap((evidence, evidenceIndex) => {
		if (!evidence.link) return [];
		if ("mask" !== evidence.paint.kind) throw paintFailure("binding");
		return [
			frozen({
				evidenceIndex,
				innerSpan: frozen({
					attributes: detachedAttributes([]),
					children: frozen([] as const),
					localName: "span" as const,
					namespace: XHTML_NAMESPACE,
				}),
				outerAnchorContract: frozen({
					preserveAllOriginalAttributes: true as const,
					textDecoration: "none" as const,
				}),
				sourceKey: evidence.sourceKey,
			}),
		];
	});
	return frozen({
		items: frozen(items),
		links: frozen(links),
		sourceKey: source.sourceKey,
	});
}

function attributeSnapshot(
	element: Element,
): WechatInlinePseudoPaintAttributeSnapshot {
	return frozen(
		Array.from(element.attributes).map(({ name, value }) =>
			frozen([name, value] as const),
		),
	);
}

function resolvedReplacementOwner(originalClone: Element): Element {
	let current = originalClone;
	const visited = new Set<Element>();
	while (true) {
		assertPaint(!visited.has(current), "binding");
		visited.add(current);
		const replacement = WECHAT_STRUCTURE_REPLACEMENTS.get(current);
		if (!replacement) return current;
		assertPaint(replacement !== current, "binding");
		current = replacement;
	}
}

function registeredPseudoOwner(
	marker: HTMLSpanElement,
	originalClone: Element,
): void {
	const owner = GENERATED_PSEUDO_CLONE_OWNERS.get(marker);
	assertPaint(
		owner?.owner === originalClone && "::before" === owner.pseudo,
		"binding",
	);
}

function markerCarrierText(marker: HTMLSpanElement): " " | "\u2060" {
	const value = marker.textContent ?? "";
	assertPaint(" " === value || "\u2060" === value, "binding");
	return value;
}

function assertDistinctDetachedClone(source: Element, clone: Element): void {
	assertPaint(source !== clone, "binding");
	assertPaint(source.isConnected && !clone.isConnected, "binding");
	assertPaint(!clone.contains(source) && !source.contains(clone), "binding");
}

function assertDetachedTarget(element: Element): void {
	assertPaint(!element.isConnected, "binding");
}

function assertApplyPreflight(
	batch: WechatInlinePseudoPaintDetachedBatch,
): void {
	const { bindings, cloneRoot } = batch;
	assertDetachedTarget(cloneRoot);
	const seenOriginalClones = new Set<Element>();
	const seenFinalOwners = new Set<Element>();
	bindings.markers.forEach((binding) => {
		assertPaint(!seenOriginalClones.has(binding.originalClone), "binding");
		assertPaint(!seenFinalOwners.has(binding.clone), "binding");
		seenOriginalClones.add(binding.originalClone);
		seenFinalOwners.add(binding.clone);
		assertDetachedTarget(binding.originalClone);
		assertDetachedTarget(binding.clone);
		assertDetachedTarget(binding.generatedMarker);
		assertPaint(cloneRoot.contains(binding.clone), "binding");
		if (binding.originalClone === binding.clone) {
			assertPaint(cloneRoot.contains(binding.originalClone), "binding");
		} else {
			assertPaint(null === binding.originalClone.parentNode, "binding");
		}
	});
	bindings.links.forEach((binding) => {
		assertDetachedTarget(binding.anchor);
		assertDetachedTarget(binding.innerSpan);
		assertPaint(cloneRoot.contains(binding.anchor), "binding");
	});
}

export function bindWechatInlinePseudoPaint(
	source: WechatInlinePseudoPaintSource,
	plan: WechatInlinePseudoPaintPlan,
	clone: HTMLElement,
	markerFor: (evidence: WechatInlinePseudoPaintSourceEvidence) => Readonly<{
		clone: Element;
		generatedMarker: HTMLSpanElement;
		parent: Element;
	}>,
): WechatInlinePseudoPaintDetachedBatch {
	assertPaint(plan.sourceKey === source.sourceKey, "stale");
	assertPaint(plan.items.length === source.evidence.length, "binding");
	assertDetachedTarget(clone);
	const markers: WechatInlinePseudoPaintMarkerBinding[] = [];
	const links: WechatInlinePseudoLinkBinding[] = [];
	const seenSources = new Set<Element>();
	const seenMarkers = new Set<Element>();
	const seenOriginalClones = new Set<Element>();
	const seenFinalOwners = new Set<Element>();
	plan.items.forEach((item, index) => {
		const evidence = source.evidence[item.evidenceIndex];
		assertPaint(evidence && item.evidenceIndex === index, "binding");
		assertPaint(item.sourceKey === evidence.sourceKey, "stale");
		assertPaint(
			canonicalSourceKey(evidence.sourceKeyParts) === evidence.sourceKey,
			"stale",
		);
		assertPaint(
			evidence.sourceKeyParts[1] === (evidence.source.namespaceURI ?? ""),
			"stale",
		);
		assertPaint(
			evidence.sourceKeyParts[2] === evidence.source.localName,
			"stale",
		);
		assertPaint(!seenSources.has(evidence.source), "binding");
		seenSources.add(evidence.source);
		const binding = markerFor(evidence);
		const originalClone = binding.clone;
		assertPaint(!seenOriginalClones.has(originalClone), "binding");
		seenOriginalClones.add(originalClone);
		assertDistinctDetachedClone(evidence.source, originalClone);
		assertPaint(originalClone !== clone, "binding");
		assertPaint(
			originalClone.localName === evidence.source.localName,
			"binding",
		);
		assertPaint(
			originalClone.namespaceURI === evidence.source.namespaceURI,
			"binding",
		);
		const finalizedOwner = resolvedReplacementOwner(originalClone);
		assertPaint(finalizedOwner === binding.parent, "binding");
		assertPaint(!seenFinalOwners.has(finalizedOwner), "binding");
		seenFinalOwners.add(finalizedOwner);
		assertDetachedTarget(finalizedOwner);
		if (finalizedOwner === originalClone) {
			assertPaint(clone.contains(originalClone), "binding");
		} else {
			assertPaint(null === originalClone.parentNode, "binding");
		}
		assertPaint(
			binding.parent !== clone && clone.contains(binding.parent),
			"binding",
		);
		assertPaint(
			binding.generatedMarker.parentElement === binding.parent,
			"binding",
		);
		registeredPseudoOwner(binding.generatedMarker, originalClone);
		assertPaint(!seenMarkers.has(binding.generatedMarker), "binding");
		seenMarkers.add(binding.generatedMarker);
		const markerStyle = binding.generatedMarker.getAttribute("style") ?? "";
		assertPaint(markerStyle.trim(), "binding");
		const marker: WechatInlinePseudoPaintMarkerBinding = frozen({
			carrierText: markerCarrierText(binding.generatedMarker),
			clone: binding.parent,
			evidenceIndex: item.evidenceIndex,
			generatedMarker: binding.generatedMarker,
			generatedMarkerStyle: markerStyle,
			originalClone,
			source: evidence.source,
			sourceKey: evidence.sourceKey,
		});
		markers.push(marker);
		if (evidence.link) {
			assertPaint("mask" === evidence.paint.kind, "binding");
			assertPaint(
				"a" === evidence.source.localName &&
					"a" === binding.parent.localName &&
					XHTML_NAMESPACE === binding.parent.namespaceURI,
				"binding",
			);
			const anchor = binding.parent as HTMLAnchorElement;
			const sourceAnchor = evidence.source as HTMLAnchorElement;
			assertPaint(
				anchor.getAttribute("href") === sourceAnchor.getAttribute("href"),
				"binding",
			);
			const innerSpan = clone.ownerDocument.createElement("span");
			assertPaint(
				innerSpan.parentNode === null && innerSpan.childNodes.length === 0,
				"binding",
			);
			links.push(
				frozen({
					anchor,
					clone: anchor,
					evidenceIndex: item.evidenceIndex,
					generatedMarker: binding.generatedMarker,
					innerSpan,
					source: sourceAnchor,
					sourceKey: evidence.sourceKey,
					visualStyleToTransfer: anchor.getAttribute("style") ?? "",
				}),
			);
		}
	});
	const linkIndexes = new Set(links.map(({ evidenceIndex }) => evidenceIndex));
	for (const linkPlan of plan.links) {
		assertPaint(linkIndexes.has(linkPlan.evidenceIndex), "binding");
	}
	assertPaint(
		new Set(plan.links.map(({ evidenceIndex }) => evidenceIndex)).size ===
			plan.links.length,
		"binding",
	);
	assertPaint(plan.links.length === links.length, "binding");
	return frozen({
		bindings: frozen({ links: frozen(links), markers: frozen(markers), plan }),
		cloneRoot: clone,
		sourceKey: source.sourceKey,
	});
}

function createSvgElement(
	node: WechatInlinePseudoPaintDetachedNode,
	document: Document,
): SVGSVGElement {
	assertPaint(
		"svg" === node.localName && SVG_NAMESPACE === node.namespace,
		"binding",
	);
	const root = document.createElementNS(SVG_NAMESPACE, "svg");
	node.attributes.forEach(([name, value]) => {
		root.setAttribute(name, value);
	});
	const append = (
		parent: Element,
		childNode: WechatInlinePseudoPaintDetachedNode,
	): void => {
		const child = document.createElementNS(SVG_NAMESPACE, childNode.localName);
		childNode.attributes.forEach(([name, value]) => {
			child.setAttribute(name, value);
		});
		childNode.children.forEach((descendant) => {
			append(child, descendant);
		});
		parent.append(child);
	};
	node.children.forEach((child) => {
		append(root, child);
	});
	return root;
}

function applyTimeAnchors(
	links: readonly WechatInlinePseudoLinkBinding[],
): readonly Readonly<{
	allOriginalAttributes: WechatInlinePseudoPaintAttributeSnapshot;
	anchor: HTMLAnchorElement;
	originalChildren: readonly ChildNode[];
}>[] {
	return frozen(
		links.map(({ anchor }) =>
			frozen({
				allOriginalAttributes: attributeSnapshot(anchor),
				anchor,
				originalChildren: frozen(Array.from(anchor.childNodes)),
			}),
		),
	);
}

function applyTimeParents(
	markers: readonly WechatInlinePseudoPaintMarkerBinding[],
	links: readonly WechatInlinePseudoLinkBinding[],
	innerSpans: readonly HTMLSpanElement[] = [],
): readonly Readonly<{ childNodes: readonly ChildNode[]; parent: Node }>[] {
	const parents = new Set<ParentNode>();
	markers.forEach(({ generatedMarker }) => {
		assertPaint(generatedMarker.parentNode, "binding");
		parents.add(generatedMarker.parentNode);
	});
	links.forEach(({ anchor }) => {
		assertPaint(anchor.parentNode, "binding");
		parents.add(anchor.parentNode);
	});
	innerSpans.forEach((innerSpan) => {
		parents.add(innerSpan);
	});
	return frozen(
		Array.from(parents).map((parent) =>
			frozen({
				childNodes: frozen(Array.from(parent.childNodes)),
				parent,
			}),
		),
	);
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

function restoreParentSequences(
	snapshots: readonly Readonly<{
		childNodes: readonly ChildNode[];
		parent: Node;
	}>[],
): void {
	snapshots.forEach(({ childNodes, parent }) => {
		const target = parent as ParentNode & {
			replaceChildren?: (...nodes: (Node | string)[]) => void;
		};
		if ("function" !== typeof target.replaceChildren)
			throw paintFailure("binding");
		target.replaceChildren(...childNodes);
	});
}

function restoreAnchorAttributes(
	snapshots: readonly Readonly<{
		allOriginalAttributes: WechatInlinePseudoPaintAttributeSnapshot;
		anchor: HTMLAnchorElement;
		originalChildren: readonly ChildNode[];
	}>[],
): void {
	snapshots.forEach(({ allOriginalAttributes, anchor, originalChildren }) => {
		Array.from(anchor.attributes).forEach(({ name }) => {
			anchor.removeAttribute(name);
		});
		allOriginalAttributes.forEach(([name, value]) => {
			anchor.setAttribute(name, value);
		});
		if (
			anchor.hasAttribute("style") !==
			allOriginalAttributes.some(([name]) => "style" === name)
		) {
			if (allOriginalAttributes.some(([name]) => "style" === name))
				anchor.setAttribute("style", "");
			else anchor.removeAttribute("style");
		}
		anchor.replaceChildren(...originalChildren);
	});
}

function replaceStyleProperty(
	element: Element,
	property: string,
	value: string,
): void {
	replaceDeclarations(element, [`${property}:${value}`]);
	const style = (element as HTMLElement).style;
	assertPaint(style?.getPropertyValue(property).trim() === value, "binding");
}

function assertDetachedSvg(
	svg: SVGSVGElement,
	paintNode: WechatInlinePseudoPaintDetachedNode,
): void {
	assertPaint(
		svg.namespaceURI === SVG_NAMESPACE && svg.localName === "svg",
		"binding",
	);
	const shapeCount = paintNode.children.length;
	assertPaint(svg.children.length === shapeCount, "binding");
	assertPaint(shapeCount > 0, "binding");
	assertPaint(
		Array.from(svg.querySelectorAll("circle, path")).length === shapeCount,
		"binding",
	);
}

function finalText(originalChildren: readonly ChildNode[]): string {
	return originalChildren.map((node) => node.textContent ?? "").join("");
}

export function applyWechatInlinePseudoPaintBatch(
	batch: WechatInlinePseudoPaintDetachedBatch,
): readonly WechatInlinePseudoPaintOwnerFinalInvariant[] {
	const { bindings, sourceKey } = batch;
	assertPaint(bindings.plan.sourceKey === sourceKey, "stale");
	assertApplyPreflight(batch);
	const markerBySource = new Map<
		Element,
		WechatInlinePseudoPaintMarkerBinding
	>();
	const sourceByMarker = new Map<
		Element,
		WechatInlinePseudoPaintMarkerBinding
	>();
	bindings.markers.forEach((binding) => {
		assertPaint(!markerBySource.has(binding.source), "binding");
		assertPaint(!sourceByMarker.has(binding.generatedMarker), "binding");
		const item = bindings.plan.items[binding.evidenceIndex];
		assertPaint(item && item.sourceKey === binding.sourceKey, "stale");
		assertPaint(
			binding.generatedMarker.parentElement === binding.clone,
			"binding",
		);
		assertPaint(
			binding.clone.ownerDocument === binding.generatedMarker.ownerDocument,
			"binding",
		);
		assertPaint(binding.generatedMarkerStyle.trim(), "binding");
		assertPaint(
			binding.generatedMarker.getAttribute("style") ===
				binding.generatedMarkerStyle,
			"binding",
		);
		assertPaint(binding.generatedMarker.childNodes.length === 1, "binding");
		assertPaint(
			binding.generatedMarker.textContent === binding.carrierText,
			"binding",
		);
		assertPaint(
			binding.generatedMarker.childNodes[0]?.nodeType === Node.TEXT_NODE,
			"binding",
		);
		markerBySource.set(binding.source, binding);
		sourceByMarker.set(binding.generatedMarker, binding);
	});
	const linkBySource = new Map<Element, WechatInlinePseudoLinkBinding>();
	bindings.links.forEach((binding) => {
		assertPaint(!linkBySource.has(binding.source), "binding");
		const item = bindings.plan.items[binding.evidenceIndex];
		assertPaint(item && item.sourceKey === binding.sourceKey, "stale");
		assertPaint(
			markerBySource.get(binding.source)?.generatedMarker ===
				binding.generatedMarker,
			"binding",
		);
		assertPaint(
			binding.innerSpan.parentNode === null &&
				binding.innerSpan.childNodes.length === 0,
			"binding",
		);
		assertPaint(binding.anchor.parentNode !== null, "binding");
		assertPaint(
			binding.anchor.firstElementChild?.hasAttribute("aria-hidden") === true,
			"binding",
		);
		assertPaint(
			(binding.anchor.getAttribute("style") ?? "") ===
				binding.visualStyleToTransfer,
			"binding",
		);
		linkBySource.set(binding.source, binding);
	});
	const anchorsBefore = applyTimeAnchors(bindings.links);
	const parentsBefore = applyTimeParents(
		bindings.markers,
		bindings.links,
		bindings.links.map(({ innerSpan }) => innerSpan),
	);
	const svgItems = bindings.plan.items.map((item) => {
		const marker = bindings.markers[item.evidenceIndex];
		assertPaint(
			marker && marker.evidenceIndex === item.evidenceIndex,
			"binding",
		);
		const paint = createSvgElement(
			item.paint,
			marker.generatedMarker.ownerDocument,
		);
		assertDetachedSvg(paint, item.paint);
		return frozen({ item, marker, paint, anchor: marker.clone });
	});
	assertPaint(svgItems.length === bindings.markers.length, "binding");
	// Every binding and every snapshot is proven before the first mutation.
	const invariantByEvidence = new Map<
		number,
		WechatInlinePseudoPaintOwnerFinalInvariant
	>();
	try {
		svgItems.forEach(({ item, marker, paint }) => {
			const currentParent = marker.generatedMarker.parentNode;
			assertPaint(currentParent === marker.clone, "binding");
			currentParent.replaceChild(paint, marker.generatedMarker);
			if (linkBySource.has(marker.source)) {
				const link = linkBySource.get(marker.source);
				assertPaint(link, "binding");
				assertPaint(paint.parentElement === marker.clone, "binding");
				const finalChildren = Array.from(link.anchor.childNodes);
				const markerIndex = finalChildren.indexOf(paint);
				assertPaint(
					markerIndex >= 0 &&
						finalChildren.indexOf(link.generatedMarker) === -1,
					"binding",
				);
				const applyTimeAnchor = anchorsBefore.find(
					({ anchor }) => anchor === link.anchor,
				);
				assertPaint(applyTimeAnchor, "binding");
				link.anchor.removeAttribute("style");
				if ("" !== link.visualStyleToTransfer.trim())
					link.innerSpan.setAttribute("style", link.visualStyleToTransfer);
				link.anchor.replaceChildren();
				link.innerSpan.replaceChildren(...finalChildren);
				replaceStyleProperty(link.anchor, "text-decoration", "none");
				link.anchor.replaceChildren(link.innerSpan);
				assertPaint(
					link.anchor.getAttribute("href") === link.source.getAttribute("href"),
					"binding",
				);
				invariantByEvidence.set(
					item.evidenceIndex,
					frozen({
						clone: link.clone,
						evidenceIndex: item.evidenceIndex,
						expectedOriginalChildIdentities: applyTimeAnchor.originalChildren,
						expectedPlainText: finalText(
							applyTimeAnchor.originalChildren.filter(
								(child) => child !== link.generatedMarker,
							),
						),
						installedSVG: paint,
						innerSpan: link.innerSpan,
						kind: "link",
						parent: link.clone,
					}),
				);
				return;
			}
			invariantByEvidence.set(
				item.evidenceIndex,
				frozen({
					clone: marker.clone,
					evidenceIndex: item.evidenceIndex,
					installedSVG: paint,
					kind: "paint",
					parent: marker.clone,
					svgPaint: item.paint,
				}),
			);
		});
		const invariants = bindings.markers.map(({ evidenceIndex }) => {
			const invariant = invariantByEvidence.get(evidenceIndex);
			assertPaint(invariant, "binding");
			return invariant;
		});
		assertPaint(invariants.length === bindings.markers.length, "binding");
		invariants.forEach((invariant) => {
			assertPaint(invariant.installedSVG.isConnected === false, "binding");
			assertPaint(invariant.parent.contains(invariant.installedSVG), "binding");
			if ("link" === invariant.kind) {
				const finalChildren = Array.from(invariant.innerSpan.childNodes);
				assertPaint(
					invariant.innerSpan.parentElement === invariant.clone,
					"binding",
				);
				assertPaint(
					finalChildren.length ===
						invariant.expectedOriginalChildIdentities.length,
					"binding",
				);
				const markerIndex = finalChildren.findIndex((child) => {
					if (child === invariant.installedSVG) return true;
					return !invariant.expectedOriginalChildIdentities.includes(
						child as ChildNode,
					);
				});
				assertPaint(markerIndex >= 0, "binding");
				assertPaint(
					finalChildren.every((child, index) =>
						index === markerIndex
							? child === invariant.installedSVG
							: child === invariant.expectedOriginalChildIdentities[index],
					),
					"binding",
				);
				assertPaint(
					invariant.clone.textContent === invariant.expectedPlainText &&
						finalText(invariant.expectedOriginalChildIdentities.slice(1)) ===
							invariant.expectedPlainText,
					"binding",
				);
				assertPaint(
					invariant.clone
						.getAttribute("style")
						?.includes("text-decoration:none") === true,
					"binding",
				);
			}
		});
		return frozen(invariants);
	} catch (error: unknown) {
		restoreParentSequences(parentsBefore);
		restoreAnchorAttributes(anchorsBefore);
		throw error;
	}
}
