import {
	type BrowserWechatClipboardRuntime,
	type SerializationYield,
	throwIfBackgroundPreparationAborted,
} from "./wechat-clipboard-runtime";
import {
	createWechatTreePredicateCache,
	hasVisualRasterizationAncestor,
	isSvgElement,
	mathCloneRole,
	mathOuterAllocationDecision,
	visualRasterizationKind,
	type WechatTreePredicateCache,
} from "./wechat-clone-metadata";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { headingAfterPseudoFlowFreshnessSignature } from "./wechat-heading-pseudo-flow";
import {
	listMarkerSignature,
	tableHeaderPaintFreshnessSignature,
	tableScrollOwnerFreshnessSignature,
} from "./wechat-list-table-layout";
import {
	captureWechatInlinePseudoPaintInput,
	type WechatInlinePseudoPaintCssCapabilities,
} from "./wechat-inline-pseudo-paint";
import { mermaidAdmissionSignature } from "./wechat-mermaid-geometry";
import { WechatPngConversionError } from "./wechat-png-conversion-policy";
import { pseudoContent } from "./wechat-pseudo-content";
import { inlineTextMarkerFreshnessSignature } from "./wechat-pseudo-elements";
import { quotePseudoFlowFreshnessSignature } from "./wechat-quote-pseudo-flow";
import { nestedOrdinaryListProjectionSignature } from "./wechat-nested-list-projection";
import {
	COPY_STYLE_PROPERTIES,
	ORDINARY_DIMENSION_PROPERTIES,
	PREPARED_PSEUDO_ELEMENTS,
	rootExportComputedStyle,
	SEMANTIC_MARGIN_PROPERTY_SET,
	semanticMarginSignature,
	semanticMarginSource,
	semanticMarginValueForEligibleStyle,
	semanticPaddingSignature,
	semanticTransformOriginSignature,
	signatureStyleProperties,
	supportsSpecialLayout,
} from "./wechat-style-policy";
import { wechatTableNativeGridAuxiliarySignature } from "./wechat-table-native-grid-integration";
import { taskListCheckboxFreshnessSignature } from "./wechat-task-geometry";
import { isTaskSvgPseudoContent } from "./wechat-task-paint";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;

export function normalizeSignatureStyleValue(
	property: string,
	raw: string,
): string {
	if ("text-indent" === property) {
		const trimmed = raw.trim().toLowerCase();
		if (/^-?0(?:\.0+)?(?:px)?$/u.test(trimmed)) {
			return "0px";
		}
	}
	return raw;
}

function preparedPseudoStyleAndMarginSignature(
	element: Element,
	pseudoElement: (typeof PREPARED_PSEUDO_ELEMENTS)[number],
	runtime: BrowserWechatClipboardRuntime,
	root: boolean,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	projectRoot: boolean,
	predicates?: WechatTreePredicateCache,
): Readonly<{ childMargin: string; style: string }> {
	const computed = runtime.getComputedStyle(element, pseudoElement);
	const exported = projectRoot
		? rootExportComputedStyle(
				element,
				computed,
				dimensionSemantics,
				pseudoElement,
			)
		: computed;
	const rawContent = exported.getPropertyValue("content");
	const emittedContent = pseudoContent(rawContent);
	const isTaskSvg =
		null === emittedContent && isTaskSvgPseudoContent(element, rawContent);
	if (null === emittedContent && !isTaskSvg) {
		return {
			childMargin: "",
			style: `${pseudoElement}:content=${rawContent}`,
		};
	}
	const marginEligible =
		null !== dimensionSemantics &&
		semanticMarginSource(element, computed, pseudoElement, predicates);
	const semanticComputed =
		marginEligible && dimensionSemantics
			? projectRoot
				? exported
				: dimensionSemantics.getComputedStyle(element, pseudoElement)
			: null;
	const signature = `${pseudoElement}:${signatureStyleProperties(
		element,
		root,
		true,
		predicates,
	)
		.map((property) => {
			const rawValue =
				(marginEligible && SEMANTIC_MARGIN_PROPERTY_SET.has(property)
					? semanticMarginValueForEligibleStyle(property, semanticComputed)
					: null) ?? exported.getPropertyValue(property);
			return `${property}=${normalizeSignatureStyleValue(property, rawValue)}`;
		})
		.join(";")}`;
	const generatedHeadingVisibility =
		!root &&
		"::after" === pseudoElement &&
		["H1", "H2", "H3", "H4"].includes(element.tagName)
			? `;visibility=${exported.getPropertyValue("visibility")}`
			: "";
	let childMargin = "";
	if (!root && dimensionSemantics && null !== emittedContent && marginEligible) {
		const marginSignature = semanticMarginSignature(
			element,
			computed,
			dimensionSemantics,
			pseudoElement,
			semanticComputed,
			predicates,
		);
		childMargin = marginSignature ? `${pseudoElement}:${marginSignature}` : "";
	}
	return {
		childMargin,
		style: `${signature}${generatedHeadingVisibility}`,
	};
}

export function preparedPseudoStyleSignature(
	element: Element,
	pseudoElement: (typeof PREPARED_PSEUDO_ELEMENTS)[number],
	runtime: BrowserWechatClipboardRuntime,
	root = false,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	projectRoot = false,
	predicates?: WechatTreePredicateCache,
): string {
	return preparedPseudoStyleAndMarginSignature(
		element,
		pseudoElement,
		runtime,
		root,
		dimensionSemantics,
		projectRoot,
		predicates,
	).style;
}

export function preparedChildPseudoMarginSignature(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	predicates?: WechatTreePredicateCache,
): string {
	if (!dimensionSemantics) return "";
	return PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) => {
		const computed = runtime.getComputedStyle(element, pseudoElement);
		const content = computed.getPropertyValue("content");
		if (null === pseudoContent(content)) return "";
		const semantic = dimensionSemantics.getComputedStyle(
			element,
			pseudoElement,
		);
		const signature = semanticMarginSignature(
			element,
			computed,
			dimensionSemantics,
			pseudoElement,
			semantic,
			predicates,
		);
		return signature ? `${pseudoElement}:${signature}` : "";
	}).join("|");
}

export function preparedRootExportStyleSignature(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	predicates?: WechatTreePredicateCache,
): string {
	const computed = rootExportComputedStyle(
		element,
		runtime.getComputedStyle(element),
		dimensionSemantics,
	);
	const marginEligible =
		null !== dimensionSemantics &&
		semanticMarginSource(element, computed, undefined, predicates);
	const semanticComputed = marginEligible ? computed : null;
	const styles = COPY_STYLE_PROPERTIES.map((property) => {
		const rawValue =
			(marginEligible && SEMANTIC_MARGIN_PROPERTY_SET.has(property)
				? semanticMarginValueForEligibleStyle(property, semanticComputed)
				: null) ?? computed.getPropertyValue(property);
		return `${property}=${normalizeSignatureStyleValue(property, rawValue)}`;
	}).join(";");
	const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
		preparedPseudoStyleSignature(
			element,
			pseudoElement,
			runtime,
			true,
			dimensionSemantics,
			true,
			predicates,
		),
	).join("|");
	return `${styles}|${pseudoStyles}`;
}

type MathTypedStyleMap = Readonly<{
	get: (property: string) => unknown;
}>;

const MATH_TYPED_DIMENSION_PROPERTIES = [
	"inline-size",
	"min-inline-size",
	"max-inline-size",
	"width",
	"min-width",
	"max-width",
] as const;

function mathTypedDimensionValue(
	styleMap: MathTypedStyleMap,
	property: string,
): string {
	const candidate = styleMap.get(property);
	if (!candidate || "object" !== typeof candidate || !("value" in candidate))
		return "unknown";
	const value = (candidate as { value?: unknown }).value;
	if ("string" === typeof value) return value.trim().toLowerCase() || "unknown";
	const unit = (candidate as { unit?: unknown }).unit;
	if (
		"number" !== typeof value ||
		!Number.isFinite(value) ||
		"string" !== typeof unit
	)
		return "unknown";
	if ("number" === unit) return String(value);
	if ("percent" === unit) return `${value}%`;
	return `${value}${unit}`.toLowerCase();
}

function mathShellDimensionSignature(
	element: Element,
	computed: CSSStyleDeclaration,
): string {
	if (
		!element.matches(
			".katex, .katex-html, .katex-display, .easymde-math-block, .easymde-math-inline",
		)
	)
		return "";
	const factory = (
		element as Element & { computedStyleMap?: () => MathTypedStyleMap }
	).computedStyleMap;
	const typed =
		"function" === typeof factory
			? (() => {
					const styleMap = factory.call(element);
					return MATH_TYPED_DIMENSION_PROPERTIES.map(
						(property) =>
							`${property}=${mathTypedDimensionValue(styleMap, property)}`,
					).join(";");
				})()
			: "typed-om=unavailable";
	const used = [
		"box-sizing",
		...ORDINARY_DIMENSION_PROPERTIES,
		...MATH_TYPED_DIMENSION_PROPERTIES,
	]
		.map((property) => `${property}=${computed.getPropertyValue(property)}`)
		.join(";");
	return `math-used=${used};math-typed=${typed}`;
}

export function ordinaryDimensionSemanticsSignature(
	element: Element,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	predicates?: WechatTreePredicateCache,
): string {
	if (!dimensionSemantics) return "";
	const computed = dimensionSemantics.getComputedStyle(element);
	if (!computed) return "";
	const role = mathCloneRole(element);
	const svg = predicates
		? predicates.isSvgElement(element)
		: isSvgElement(element);
	const special = predicates
		? predicates.supportsSpecialLayout(element)
		: supportsSpecialLayout(element);
	const dimensions = svg
		? ""
		: "katex" === role
			? mathShellDimensionSignature(element, computed)
			: role
				? ""
				: !special
					? ["box-sizing", ...ORDINARY_DIMENSION_PROPERTIES]
							.map(
								(property) =>
									`${property}=${computed.getPropertyValue(property)}`,
							)
							.join(";")
					: "";
	const outerAllocation =
		"html" === role
			? `math-outer-allocation=${
					mathOuterAllocationDecision(
						element,
						dimensionSemantics.getSourceComputedStyle(element),
						dimensionSemantics.getSourceComputedStyle,
						dimensionSemantics.getFormattingOwnerDisplay(element),
						dimensionSemantics.rasterizesVisualRoots,
						predicates,
					).signature
				}`
			: "";
	const margins = semanticMarginSignature(
		element,
		computed,
		dimensionSemantics,
		undefined,
		computed,
		predicates,
	);
	const padding = semanticPaddingSignature(
		element,
		computed,
		dimensionSemantics,
		computed,
		predicates,
	);
	// The portable payload transports the raw `transform-origin` semantics, so a
	// source semantic change with identical resolved pixels must still invalidate
	// a prepared payload instead of reusing the previous declaration.
	const transformOrigin = semanticTransformOriginSignature(
		element,
		computed,
		predicates,
	);
	return [dimensions, outerAllocation, margins, padding, transformOrigin]
		.filter(Boolean)
		.join(";");
}
function layoutViewportSignature(layoutPreview: HTMLElement): string {
	const viewport = layoutPreview.ownerDocument.defaultView;
	return viewport
		? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
		: "";
}

function mermaidAdmissionFreshnessSignature(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
	contentBoxInputsOnly = false,
): string {
	try {
		return mermaidAdmissionSignature(element, runtime, contentBoxInputsOnly);
	} catch (error: unknown) {
		if (error instanceof WechatPngConversionError) throw error;
		throw new WechatPngConversionError("wechat-png-rasterization-failed");
	}
}

function svgMarkerDecisionSignature(
	element: Element,
	computed: CSSStyleDeclaration,
	predicates?: WechatTreePredicateCache,
): string {
	if (!(predicates ? predicates.isSvgElement(element) : isSvgElement(element)))
		return "";
	return [
		"display",
		"visibility",
		"overflow",
		"color",
		"fill",
		"fill-opacity",
		"fill-rule",
		"opacity",
		"stroke",
		"stroke-dasharray",
		"stroke-dashoffset",
		"stroke-linecap",
		"stroke-linejoin",
		"stroke-miterlimit",
		"stroke-opacity",
		"stroke-width",
		"shape-rendering",
		"paint-order",
		"marker-start",
		"marker-mid",
		"marker-end",
		"transform",
		"transform-origin",
		"transform-box",
		"clip-path",
		"mask",
		"filter",
		"mix-blend-mode",
		"vector-effect",
	]
		.map((property) => `${property}=${computed.getPropertyValue(property)}`)
		.join(";");
}

function inlinePseudoPaintSignature(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
	computed?: CSSStyleDeclaration,
): string {
	if (XHTML_NAMESPACE !== element.namespaceURI) return "";
	const css: WechatInlinePseudoPaintCssCapabilities = {
		getComputedStyle: (source, pseudoElement) =>
			pseudoElement
				? runtime.getComputedStyle(source, pseudoElement)
				: (computed ?? runtime.getComputedStyle(source)),
		supports: (property, value) => CSS.supports(property, value),
	};
	const raw = captureWechatInlinePseudoPaintInput(element as HTMLElement, css);
	return null === raw ? "" : `${raw.family}:${raw.rawKey}`;
}

function auxiliaryFidelitySignature(
	element: Element,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	conversionActive = false,
	computed?: CSSStyleDeclaration,
	contentBoxInputsOnly = false,
	predicates?: WechatTreePredicateCache,
): string {
	const activeConversion =
		conversionActive || Boolean(dimensionSemantics?.rasterizesVisualRoots);
	if (
		activeConversion &&
		((predicates
			? predicates.visualRasterizationKind(element)
			: visualRasterizationKind(element)) ||
			(predicates
				? predicates.hasVisualRasterizationAncestor(element)
				: hasVisualRasterizationAncestor(element)))
	) {
		return "";
	}
	const inlinePseudoPaint = inlinePseudoPaintSignature(
		element,
		runtime,
		computed,
	);
	const markerSignature = ["OL", "UL"].includes(element.tagName)
		? listMarkerSignature(
				element,
				computed ?? runtime.getComputedStyle(element),
				runtime,
			)
		: "";
	const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(
		element,
		runtime,
	);
	const quotePseudoSignature =
		"BLOCKQUOTE" === element.tagName
			? quotePseudoFlowFreshnessSignature(element, runtime, dimensionSemantics)
			: "";
	const headingAfterPseudoSignature = ["H1", "H2", "H3", "H4"].includes(
		element.tagName,
	)
		? headingAfterPseudoFlowFreshnessSignature(element, runtime, computed)
		: "";
	const taskCheckboxSignature = taskListCheckboxFreshnessSignature(
		element,
		runtime,
		dimensionSemantics,
	);
	const tableHeaderSignature = tableHeaderPaintFreshnessSignature(
		element,
		runtime,
	);
	const tableScrollSignature = tableScrollOwnerFreshnessSignature(
		element,
		runtime,
	);
	const tableNativeGridSignature = wechatTableNativeGridAuxiliarySignature(
		element,
		runtime,
		computed,
	);
	const mermaidAdmission = dimensionSemantics?.rasterizesVisualRoots
		? ""
		: mermaidAdmissionFreshnessSignature(element, runtime, contentBoxInputsOnly);
	const svg = predicates
		? predicates.isSvgElement(element)
		: isSvgElement(element);
	const markerDecisions = svg
		? svgMarkerDecisionSignature(
				element,
				computed ?? runtime.getComputedStyle(element),
				predicates,
			)
		: "";
	const nestedListProjectionSignature =
		element instanceof HTMLElement
			? nestedOrdinaryListProjectionSignature(
					element,
					runtime,
					dimensionSemantics,
				)
			: "";
	return `${markerSignature}:${inlineMarkerSignature}:${quotePseudoSignature}:${headingAfterPseudoSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}:${tableNativeGridSignature}:${mermaidAdmission}:${markerDecisions}:${inlinePseudoPaint}:${nestedListProjectionSignature}`;
}

function previewElements(root: HTMLElement): Element[] {
	return [root, ...Array.from(root.querySelectorAll("*"))];
}

function dimensionEntrySignature(
	index: number,
	dimensions: string,
	childPseudoMargin: string,
	rootExportStyle: string,
	auxiliary: string,
): string {
	return `${index}:${dimensions}:${childPseudoMargin}:${rootExportStyle}:${auxiliary}`;
}

export type PreparedSignatureBundle = Readonly<{
	dimension: string;
	dimensionGeometry: string;
	layout: string;
}>;

export type CollectPreparedSignaturesOptions = Readonly<{
	preview: HTMLElement;
	runtime: BrowserWechatClipboardRuntime;
	dimensionSemantics?: WechatDimensionSemanticsContext | null | undefined;
	conversionActive?: boolean | undefined;
	contentBoxInputsOnly?: boolean | undefined;
	includeDimension?: boolean | undefined;
	includeDimensionGeometry?: boolean | undefined;
}>;

export type CollectPreparedSignaturesWithYieldOptions =
	CollectPreparedSignaturesOptions &
		Readonly<{
			yieldToBrowser: SerializationYield;
			signal?: AbortSignal | undefined;
		}>;

type LayoutSignatureContext = Readonly<{
	runtime: BrowserWechatClipboardRuntime;
	dimensionSemantics: WechatDimensionSemanticsContext | null;
	conversionActive: boolean;
	contentBoxInputsOnly: boolean;
	includeDimension: boolean;
	includeDimensionGeometry: boolean;
	predicates: WechatTreePredicateCache;
}>;

type LayoutElementSignatureResult = Readonly<{
	dimensionEntry: string | null;
	dimensionGeometryEntry: string | null;
	layoutEntry: string;
}>;

function collectLayoutElementSignatures(
	element: Element,
	domIndex: number,
	index: number,
	ctx: LayoutSignatureContext,
): LayoutElementSignatureResult {
	const { runtime, dimensionSemantics, conversionActive, predicates } = ctx;
	const rect = element.getBoundingClientRect?.();
	const computed = runtime.getComputedStyle(element);
	const root = 0 === index;
	const styles = signatureStyleProperties(element, root, false, predicates)
		.map(
			(property) =>
				`${property}=${normalizeSignatureStyleValue(property, computed.getPropertyValue(property))}`,
		)
		.join(";");
	const pseudoEntries = PREPARED_PSEUDO_ELEMENTS.map((pseudo) =>
		preparedPseudoStyleAndMarginSignature(
			element,
			pseudo,
			runtime,
			root,
			dimensionSemantics,
			root,
			predicates,
		),
	);
	const pseudoStyles = pseudoEntries.map((entry) => entry.style).join("|");
	const dimensions = ordinaryDimensionSemanticsSignature(
		element,
		dimensionSemantics,
		predicates,
	);
	const auxiliary = auxiliaryFidelitySignature(
		element,
		runtime,
		dimensionSemantics,
		conversionActive,
		computed,
		ctx.contentBoxInputsOnly,
		predicates,
	);
	const childPseudoMargin =
		root || !dimensionSemantics
			? ""
			: pseudoEntries.map((entry) => entry.childMargin).join("|");
	const rootExportStyle = root
		? preparedRootExportStyleSignature(
				element,
				runtime,
				dimensionSemantics,
				predicates,
			)
		: "";
	const width = rect?.width ?? 0;
	const height = rect?.height ?? 0;
	const dimensionEntry = ctx.includeDimension
		? dimensionEntrySignature(
				index,
				dimensions,
				childPseudoMargin,
				rootExportStyle,
				auxiliary,
			)
		: null;
	let dimensionGeometryEntry: string | null = null;
	if (
		ctx.includeDimensionGeometry &&
		(0 < domIndex ||
			!conversionActive ||
			!predicates.hasVisualRasterizationAncestor(element))
	) {
		const geometryAuxiliary = ctx.contentBoxInputsOnly
			? auxiliaryFidelitySignature(
					element,
					runtime,
					dimensionSemantics,
					conversionActive,
					computed,
					false,
					predicates,
				)
			: auxiliary;
		dimensionGeometryEntry = `${domIndex}:${width},${height}:${dimensions}:${childPseudoMargin}:${rootExportStyle}:${geometryAuxiliary}`;
	}
	// `left`/`top`/`right`/`bottom` are viewport-relative and change when
	// the user scrolls, even though the exported markup and layout did not.
	// Only retain dimensions here; they can affect wrapping and image/text
	// geometry without invalidating a prepared payload on ordinary scroll.
	const layoutEntry = `${index}:${width},${height}:${styles}:${pseudoStyles}:${dimensions}:${rootExportStyle}:${auxiliary}`;
	return { dimensionEntry, dimensionGeometryEntry, layoutEntry };
}

function collectDimensionGeometryElementSignature(
	element: Element,
	index: number,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	conversionActive: boolean,
	predicates: WechatTreePredicateCache,
	includeGeometry = true,
): string | null {
	if (conversionActive && predicates.hasVisualRasterizationAncestor(element)) {
		return null;
	}
	const rect = includeGeometry ? element.getBoundingClientRect?.() : undefined;
	const dimensions = ordinaryDimensionSemanticsSignature(
		element,
		dimensionSemantics,
		predicates,
	);
	const auxiliary = auxiliaryFidelitySignature(
		element,
		runtime,
		dimensionSemantics,
		conversionActive,
		undefined,
		false,
		predicates,
	);
	const childPseudoMargin =
		0 === index
			? ""
			: preparedChildPseudoMarginSignature(
					element,
					runtime,
					dimensionSemantics,
					predicates,
				);
	const rootExportStyle =
		0 === index
			? preparedRootExportStyleSignature(
					element,
					runtime,
					dimensionSemantics,
					predicates,
				)
			: "";
	if (!includeGeometry) {
		return dimensionEntrySignature(
			index,
			dimensions,
			childPseudoMargin,
			rootExportStyle,
			auxiliary,
		);
	}
	return `${index}:${rect?.width ?? 0},${rect?.height ?? 0}:${dimensions}:${childPseudoMargin}:${rootExportStyle}:${auxiliary}`;
}

function createPreparedSignatureCollector(
	options: CollectPreparedSignaturesOptions,
) {
	const ctx: LayoutSignatureContext = {
		runtime: options.runtime,
		dimensionSemantics: options.dimensionSemantics ?? null,
		conversionActive: options.conversionActive ?? false,
		contentBoxInputsOnly: options.contentBoxInputsOnly ?? false,
		includeDimension: options.includeDimension ?? true,
		includeDimensionGeometry: options.includeDimensionGeometry ?? false,
		predicates: createWechatTreePredicateCache(),
	};
	const viewportSignature = layoutViewportSignature(options.preview);
	const elements = previewElements(options.preview);
	const entries: string[] = [];
	const dimensionEntries: string[] = [];
	const dimensionGeometryEntries: string[] = [];
	let layoutIndex = 0;

	return {
		elements,
		shouldSkip: (domIndex: number, element: Element): boolean =>
			0 < domIndex &&
			ctx.conversionActive &&
			ctx.predicates.hasVisualRasterizationAncestor(element),
		visit(domIndex: number, element: Element): void {
			const result = collectLayoutElementSignatures(
				element,
				domIndex,
				layoutIndex,
				ctx,
			);
			layoutIndex += 1;
			if (null !== result.dimensionEntry)
				dimensionEntries.push(result.dimensionEntry);
			if (null !== result.dimensionGeometryEntry) {
				dimensionGeometryEntries.push(result.dimensionGeometryEntry);
			}
			entries.push(result.layoutEntry);
		},
		finish: (): PreparedSignatureBundle => ({
			dimension: ctx.includeDimension ? dimensionEntries.join("\u0001") : "",
			dimensionGeometry: ctx.includeDimensionGeometry
				? [viewportSignature, ...dimensionGeometryEntries].join("\u0001")
				: "",
			layout: [viewportSignature, ...entries].join("\u0001"),
		}),
	};
}

export function collectPreparedSignatures(
	options: CollectPreparedSignaturesOptions,
): PreparedSignatureBundle {
	const collector = createPreparedSignatureCollector(options);
	for (const [domIndex, element] of collector.elements.entries()) {
		if (collector.shouldSkip(domIndex, element)) continue;
		collector.visit(domIndex, element);
	}
	return collector.finish();
}

export async function collectPreparedSignaturesWithYield(
	options: CollectPreparedSignaturesWithYieldOptions,
): Promise<PreparedSignatureBundle> {
	const { yieldToBrowser, signal } = options;
	throwIfBackgroundPreparationAborted(signal);
	const collector = createPreparedSignatureCollector(options);
	for (const [domIndex, element] of collector.elements.entries()) {
		if (collector.shouldSkip(domIndex, element)) continue;
		throwIfBackgroundPreparationAborted(signal);
		collector.visit(domIndex, element);
		if (yieldToBrowser.shouldYield()) await yieldToBrowser();
		throwIfBackgroundPreparationAborted(signal);
	}
	return collector.finish();
}

function applyLegacySignatureSinks(
	result: PreparedSignatureBundle,
	dimensionSink?: { value: string },
	dimensionGeometrySink?: { value: string },
): string {
	if (dimensionSink) dimensionSink.value = result.dimension;
	if (dimensionGeometrySink) {
		dimensionGeometrySink.value = result.dimensionGeometry;
	}
	return result.layout;
}

export function preparedLayoutSignature(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	layoutPreview: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	dimensionSignatureSink?: { value: string },
	conversionActive = false,
	contentBoxInputsOnly = false,
	dimensionGeometrySignatureSink?: { value: string },
): string {
	return applyLegacySignatureSinks(
		collectPreparedSignatures({
			preview: layoutPreview,
			runtime,
			dimensionSemantics,
			conversionActive,
			contentBoxInputsOnly,
			includeDimension: Boolean(dimensionSignatureSink),
			includeDimensionGeometry: Boolean(dimensionGeometrySignatureSink),
		}),
		dimensionSignatureSink,
		dimensionGeometrySignatureSink,
	);
}

export async function preparedLayoutSignatureWithYield(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	yieldToBrowser: SerializationYield,
	signal?: AbortSignal,
	layoutPreview: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	dimensionSignatureSink?: { value: string },
	conversionActive = false,
	contentBoxInputsOnly = false,
	dimensionGeometrySignatureSink?: { value: string },
): Promise<string> {
	return applyLegacySignatureSinks(
		await collectPreparedSignaturesWithYield({
			preview: layoutPreview,
			runtime,
			yieldToBrowser,
			signal,
			dimensionSemantics,
			conversionActive,
			contentBoxInputsOnly,
			includeDimension: Boolean(dimensionSignatureSink),
			includeDimensionGeometry: Boolean(dimensionGeometrySignatureSink),
		}),
		dimensionSignatureSink,
		dimensionGeometrySignatureSink,
	);
}

export async function preparedDimensionGeometrySignatureWithYield(
	layoutPreview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	yieldToBrowser: SerializationYield,
	signal: AbortSignal | undefined,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	conversionActive = false,
): Promise<string> {
	throwIfBackgroundPreparationAborted(signal);
	const predicates = createWechatTreePredicateCache();
	const viewportSignature = layoutViewportSignature(layoutPreview);
	const entries: string[] = [];
	for (const [index, element] of previewElements(layoutPreview).entries()) {
		throwIfBackgroundPreparationAborted(signal);
		const entry = collectDimensionGeometryElementSignature(
			element,
			index,
			runtime,
			dimensionSemantics,
			conversionActive,
			predicates,
		);
		if (null === entry) continue;
		entries.push(entry);
		if (yieldToBrowser.shouldYield()) await yieldToBrowser();
		throwIfBackgroundPreparationAborted(signal);
	}
	return [viewportSignature, ...entries].join("\u0001");
}

export function preparedDimensionGeometrySignature(
	layoutPreview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	conversionActive = false,
): string {
	const predicates = createWechatTreePredicateCache();
	const viewportSignature = layoutViewportSignature(layoutPreview);
	const entries: string[] = [];
	for (const [index, element] of previewElements(layoutPreview).entries()) {
		const entry = collectDimensionGeometryElementSignature(
			element,
			index,
			runtime,
			dimensionSemantics,
			conversionActive,
			predicates,
		);
		if (null !== entry) entries.push(entry);
	}
	return [viewportSignature, ...entries].join("\u0001");
}

export function preparedDimensionSemanticsSignature(
	layoutPreview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): string {
	const predicates = createWechatTreePredicateCache();
	return previewElements(layoutPreview)
		.map(
			(element, index) =>
				collectDimensionGeometryElementSignature(
					element,
					index,
					runtime,
					dimensionSemantics,
					false,
					predicates,
					false,
				) ?? "",
		)
		.join("\u0001");
}
