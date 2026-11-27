import type {
	WechatPreviewMeasurementLease,
	WechatPreviewTransitionLease,
} from "./wechat-preview-measurement";
import type { ClipboardSourceFreshnessGuard } from "./wechat-source-freshness";

/**
 * Bounded Source→paint-plan→explicit clone-binding→detached-apply contract types.
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
