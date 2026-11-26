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
	semanticMarginSignature,
	semanticMarginSource,
	semanticMarginValue,
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

export function preparedPseudoStyleSignature(
	element: Element,
	pseudoElement: (typeof PREPARED_PSEUDO_ELEMENTS)[number],
	runtime: BrowserWechatClipboardRuntime,
	root = false,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	projectRoot = false,
	predicates?: WechatTreePredicateCache,
): string {
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
	if (
		null === pseudoContent(rawContent) &&
		!isTaskSvgPseudoContent(element, rawContent)
	) {
		return `${pseudoElement}:content=${rawContent}`;
	}
	const semanticComputed =
		dimensionSemantics &&
		semanticMarginSource(element, computed, pseudoElement, predicates)
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
		.map(
			(property) =>
				`${property}=${normalizeSignatureStyleValue(
					property,
					semanticMarginValue(
						property,
						element,
						computed,
						dimensionSemantics,
						pseudoElement,
						semanticComputed,
						predicates,
					) ?? exported.getPropertyValue(property),
				)}`,
		)
		.join(";")}`;
	const generatedHeadingVisibility =
		!root &&
		"::after" === pseudoElement &&
		["H1", "H2", "H3", "H4"].includes(element.tagName)
			? `;visibility=${exported.getPropertyValue("visibility")}`
			: "";
	return `${signature}${generatedHeadingVisibility}`;
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
	const semanticComputed =
		dimensionSemantics &&
		semanticMarginSource(element, computed, undefined, predicates)
			? computed
			: null;
	const styles = COPY_STYLE_PROPERTIES.map(
		(property) =>
			`${property}=${normalizeSignatureStyleValue(
				property,
				semanticMarginValue(
					property,
					element,
					computed,
					dimensionSemantics,
					undefined,
					semanticComputed,
					predicates,
				) ?? computed.getPropertyValue(property),
			)}`,
	).join(";");
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
		"html" === role && dimensionSemantics
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

function layoutDimensionEntrySignature(
	index: number,
	dimensionSemanticsSignature: string,
	childPseudoMarginSignature: string,
	rootExportStyleSignature: string,
	auxiliarySignature: string,
): string {
	return `${index}:${dimensionSemanticsSignature}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

function layoutElementSignature(
	index: number,
	width: number,
	height: number,
	styles: string,
	pseudoStyles: string,
	dimensionSemanticsSignature: string,
	rootExportStyleSignature: string,
	auxiliarySignature: string,
): string {
	return `${index}:${width},${height}:${styles}:${pseudoStyles}:${dimensionSemanticsSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

function dimensionGeometryEntrySignature(
	index: number,
	width: number,
	height: number,
	dimensions: string,
	childPseudoMarginSignature: string,
	rootExportStyleSignature: string,
	auxiliarySignature: string,
): string {
	return `${index}:${width},${height}:${dimensions}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

function dimensionSemanticsEntrySignature(
	index: number,
	dimensions: string,
	childPseudoMarginSignature: string,
	rootExportStyleSignature: string,
	auxiliarySignature: string,
): string {
	return `${index}:${dimensions}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

export function preparedLayoutSignature(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	layoutPreview: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	dimensionSignatureSink?: { value: string },
	conversionActive = false,
	contentBoxInputsOnly = false,
): string {
	const predicates = createWechatTreePredicateCache();
	const viewportSignature = layoutViewportSignature(layoutPreview);
	const elements = [
		layoutPreview,
		...Array.from(layoutPreview.querySelectorAll("*")).filter(
			(element) =>
				!conversionActive || !predicates.hasVisualRasterizationAncestor(element),
		),
	];
	const dimensionEntries: string[] = [];
	const signature = [
		viewportSignature,
		...elements.map((element, index) => {
			const rect = element.getBoundingClientRect?.();
			const computed = runtime.getComputedStyle(element);
			const root = 0 === index;
			const styles = signatureStyleProperties(element, root, false, predicates)
				.map(
					(property) =>
						`${property}=${normalizeSignatureStyleValue(property, computed.getPropertyValue(property))}`,
				)
				.join(";");
			const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
				preparedPseudoStyleSignature(
					element,
					pseudoElement,
					runtime,
					root,
					dimensionSemantics,
					root,
					predicates,
				),
			).join("|");
			const dimensionSemanticsSignature = ordinaryDimensionSemanticsSignature(
				element,
				dimensionSemantics,
				predicates,
			);
			const auxiliarySignature = auxiliaryFidelitySignature(
				element,
				runtime,
				dimensionSemantics,
				conversionActive,
				computed,
				contentBoxInputsOnly,
				predicates,
			);
			const childPseudoMarginSignature = root
				? ""
				: preparedChildPseudoMarginSignature(
						element,
						runtime,
						dimensionSemantics,
						predicates,
					);
			const rootExportStyleSignature = root
				? preparedRootExportStyleSignature(
						element,
						runtime,
						dimensionSemantics,
						predicates,
					)
				: "";
			dimensionEntries.push(
				layoutDimensionEntrySignature(
					index,
					dimensionSemanticsSignature,
					childPseudoMarginSignature,
					rootExportStyleSignature,
					auxiliarySignature,
				),
			);
			// `left`/`top`/`right`/`bottom` are viewport-relative and change when
			// the user scrolls, even though the exported markup and layout did not.
			// Only retain dimensions here; they can affect wrapping and image/text
			// geometry without invalidating a prepared payload on ordinary scroll.
			return layoutElementSignature(
				index,
				rect?.width ?? 0,
				rect?.height ?? 0,
				styles,
				pseudoStyles,
				dimensionSemanticsSignature,
				rootExportStyleSignature,
				auxiliarySignature,
			);
		}),
	].join("\u0001");
	if (dimensionSignatureSink)
		dimensionSignatureSink.value = dimensionEntries.join("\u0001");
	return signature;
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
): Promise<string> {
	throwIfBackgroundPreparationAborted(signal);
	const predicates = createWechatTreePredicateCache();
	const viewportSignature = layoutViewportSignature(layoutPreview);
	const entries: string[] = [];
	const dimensionEntries: string[] = [];
	const elements = [
		layoutPreview,
		...Array.from(layoutPreview.querySelectorAll("*")).filter(
			(element) =>
				!conversionActive || !predicates.hasVisualRasterizationAncestor(element),
		),
	];
	for (const [index, element] of elements.entries()) {
		throwIfBackgroundPreparationAborted(signal);
		const rect = element.getBoundingClientRect?.();
		const computed = runtime.getComputedStyle(element);
		const root = 0 === index;
		const styles: string[] = [];
		for (const property of signatureStyleProperties(
			element,
			root,
			false,
			predicates,
		)) {
			styles.push(
				`${property}=${normalizeSignatureStyleValue(property, computed.getPropertyValue(property))}`,
			);
			if (yieldToBrowser.shouldYield()) await yieldToBrowser();
		}
		const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
			preparedPseudoStyleSignature(
				element,
				pseudoElement,
				runtime,
				root,
				dimensionSemantics,
				root,
				predicates,
			),
		).join("|");
		const dimensionSemanticsSignature = ordinaryDimensionSemanticsSignature(
			element,
			dimensionSemantics,
			predicates,
		);
		const auxiliarySignature = auxiliaryFidelitySignature(
			element,
			runtime,
			dimensionSemantics,
			conversionActive,
			computed,
			contentBoxInputsOnly,
			predicates,
		);
		const childPseudoMarginSignature = root
			? ""
			: preparedChildPseudoMarginSignature(
					element,
					runtime,
					dimensionSemantics,
					predicates,
				);
		const rootExportStyleSignature = root
			? preparedRootExportStyleSignature(
					element,
					runtime,
					dimensionSemantics,
					predicates,
				)
			: "";
		dimensionEntries.push(
			layoutDimensionEntrySignature(
				index,
				dimensionSemanticsSignature,
				childPseudoMarginSignature,
				rootExportStyleSignature,
				auxiliarySignature,
			),
		);
		entries.push(
			layoutElementSignature(
				index,
				rect?.width ?? 0,
				rect?.height ?? 0,
				styles.join(";"),
				pseudoStyles,
				dimensionSemanticsSignature,
				rootExportStyleSignature,
				auxiliarySignature,
			),
		);
		await yieldToBrowser();
		throwIfBackgroundPreparationAborted(signal);
	}

	if (dimensionSignatureSink)
		dimensionSignatureSink.value = dimensionEntries.join("\u0001");
	return [viewportSignature, ...entries].join("\u0001");
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
	const elements = [
		layoutPreview,
		...Array.from(layoutPreview.querySelectorAll("*")),
	];
	for (const [index, element] of elements.entries()) {
		throwIfBackgroundPreparationAborted(signal);
		if (conversionActive && predicates.hasVisualRasterizationAncestor(element))
			continue;
		const rect = element.getBoundingClientRect?.();
		const dimensions = ordinaryDimensionSemanticsSignature(
			element,
			dimensionSemantics,
			predicates,
		);
		const auxiliarySignature = auxiliaryFidelitySignature(
			element,
			runtime,
			dimensionSemantics,
			conversionActive,
			undefined,
			false,
			predicates,
		);
		const childPseudoMarginSignature =
			0 === index
				? ""
				: preparedChildPseudoMarginSignature(
						element,
						runtime,
						dimensionSemantics,
						predicates,
					);
		const rootExportStyleSignature =
			0 === index
				? preparedRootExportStyleSignature(
						element,
						runtime,
						dimensionSemantics,
						predicates,
					)
				: "";
		entries.push(
			dimensionGeometryEntrySignature(
				index,
				rect?.width ?? 0,
				rect?.height ?? 0,
				dimensions,
				childPseudoMarginSignature,
				rootExportStyleSignature,
				auxiliarySignature,
			),
		);
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
	const elements = [
		layoutPreview,
		...Array.from(layoutPreview.querySelectorAll("*")),
	];
	const entries: string[] = [];
	elements.forEach((element, index) => {
		if (conversionActive && predicates.hasVisualRasterizationAncestor(element))
			return;
		const rect = element.getBoundingClientRect?.();
		const dimensions = ordinaryDimensionSemanticsSignature(
			element,
			dimensionSemantics,
			predicates,
		);
		const auxiliarySignature = auxiliaryFidelitySignature(
			element,
			runtime,
			dimensionSemantics,
			conversionActive,
			undefined,
			false,
			predicates,
		);
		const childPseudoMarginSignature =
			0 === index
				? ""
				: preparedChildPseudoMarginSignature(
						element,
						runtime,
						dimensionSemantics,
						predicates,
					);
		const rootExportStyleSignature =
			0 === index
				? preparedRootExportStyleSignature(
						element,
						runtime,
						dimensionSemantics,
						predicates,
					)
				: "";
		entries.push(
			dimensionGeometryEntrySignature(
				index,
				rect?.width ?? 0,
				rect?.height ?? 0,
				dimensions,
				childPseudoMarginSignature,
				rootExportStyleSignature,
				auxiliarySignature,
			),
		);
	});
	return [viewportSignature, ...entries].join("\u0001");
}

export function preparedDimensionSemanticsSignature(
	layoutPreview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
): string {
	const predicates = createWechatTreePredicateCache();
	const elements = [
		layoutPreview,
		...Array.from(layoutPreview.querySelectorAll("*")),
	];
	return elements
		.map((element, index) => {
			const auxiliarySignature = auxiliaryFidelitySignature(
				element,
				runtime,
				dimensionSemantics,
				false,
				undefined,
				false,
				predicates,
			);
			const rootExportStyleSignature =
				0 === index
					? preparedRootExportStyleSignature(
							element,
							runtime,
							dimensionSemantics,
							predicates,
						)
					: "";
			const childPseudoMarginSignature =
				0 === index
					? ""
					: preparedChildPseudoMarginSignature(
							element,
							runtime,
							dimensionSemantics,
							predicates,
						);
			const dimensions = ordinaryDimensionSemanticsSignature(
				element,
				dimensionSemantics,
				predicates,
			);
			return dimensionSemanticsEntrySignature(
				index,
				dimensions,
				childPseudoMarginSignature,
				rootExportStyleSignature,
				auxiliarySignature,
			);
		})
		.join("\u0001");
}
