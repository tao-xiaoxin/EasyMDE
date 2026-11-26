import {
	appendThemeImages,
	type BackgroundAssetCache,
	dataImageLayersFromDeclarations,
	hasRepeatingBackground,
	removeDataImageBackgroundDeclarations,
	type ThemeImageLayer,
} from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	type SerializationYield,
	throwIfBackgroundPreparationAborted,
} from "./wechat-clipboard-runtime";
import {
	createWechatTreePredicateCache,
	FULL_WIDTH_TABLE_CLONES,
	HIDDEN_NODES,
	isTaskListCheckbox,
	KATEX_VISUAL_NODES,
	KATEX_VISUAL_ROOTS,
	MATH_BLOCK_ROOTS,
	MERMAID_FOREIGN_OBJECTS,
	MERMAID_SVG_ROOTS,
	markVisualRasterizationClone,
	registerMathCloneRole,
	registerMathEmptyTransportCarrier,
	TABLE_HEADER_BACKGROUND_METADATA,
	TABLE_SCROLL_OWNER_METADATA,
	TASK_LIST_CHECKBOX_CLONES,
	THEME_HEADING_SUFFIX_CLONES,
	type WechatTreePredicateCache,
} from "./wechat-clone-metadata";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	captureWechatInlinePseudoPaintInput,
	type WechatInlinePseudoPaintRawCapture,
} from "./wechat-inline-pseudo-paint";
import {
	applyListMarkerGutter,
	fullWidthTableLayout,
	listMarkerDirection,
	listMarkerGutterMetadata,
	tableHeaderBackgroundMetadata,
	tableHeaderBackgroundProjection,
	tableScrollOwnerMetadata,
} from "./wechat-list-table-layout";
import {
	collectNestedOrdinaryListProjection,
	type WechatNestedListProjectionCapture,
} from "./wechat-nested-list-projection";
import {
	assertPngConversionCurrent,
	type WechatPngConversionContext,
} from "./wechat-png-conversion-policy";
import { KATEX_VISUAL_LAYOUT_DECLARATIONS } from "./wechat-portable-content";
import { inlinePseudoPaintCapabilities } from "./wechat-portable-serialization-pseudo-paint";
import {
	addPseudoElement,
	addPseudoElementSynchronously,
	type HeadingEmptyPseudoFlowCollector,
	isVisiblePaintedThemeHeadingSuffix,
	styleDeclarations,
	styleDeclarationsSynchronously,
} from "./wechat-pseudo-elements";
import type { QuotePseudoFlowCollector } from "./wechat-quote-pseudo-flow";
import {
	appendDeclarations,
	removeTransientAttributes,
	rootExportComputedStyle,
} from "./wechat-style-policy";
import type { TaskCheckboxGeometryContext } from "./wechat-task-geometry";
import {
	assertTaskCheckboxAppearancePortable,
	assertTaskCheckboxStaticOwnerBase,
	taskCheckboxStaticPaintExpectationFor,
	taskCheckboxStaticPaintProperties,
} from "./wechat-task-paint";

type NodeFidelityResult = Readonly<{
	exportComputed: CSSStyleDeclaration;
	imageLayers: ThemeImageLayer[];
	preserveRepeatingBackground: boolean;
	registeredVisualRoot: boolean;
}>;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function promotePortableSvgFilter(
	source: Element,
	clone: Element,
	portableDeclarations: readonly string[],
): void {
	if (
		source.namespaceURI !== SVG_NAMESPACE ||
		clone.namespaceURI !== SVG_NAMESPACE
	)
		return;
	const declaration = portableDeclarations.find((candidate) =>
		/^filter\s*:/iu.test(candidate.trim()),
	);
	if (!declaration) return;
	const value = declaration.trim().replace(/^filter\s*:/iu, "").trim();
	if (!value) throw new Error("wechat-svg-filter-declaration-empty");
	clone.setAttribute("filter", value);
	(clone as SVGElement).style.removeProperty("filter");
}

function applyNodeFidelity(
	source: Element,
	clone: Element,
	computed: CSSStyleDeclaration,
	declarations: string[],
	root: boolean,
	runtime: BrowserWechatClipboardRuntime,
	previewRoot: HTMLElement,
	sourceRoot: HTMLElement,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	taskGeometry: TaskCheckboxGeometryContext | null,
	predicates: WechatTreePredicateCache,
	conversionActive = false,
): NodeFidelityResult {
	const imageLayers = dataImageLayersFromDeclarations(declarations);
	const exportComputed = root
		? rootExportComputedStyle(source, computed, dimensionSemantics)
		: computed;
	const preserveRepeatingBackground = hasRepeatingBackground(exportComputed);
	const portableDeclarations = removeDataImageBackgroundDeclarations(
		declarations,
		preserveRepeatingBackground,
	);
	if (portableDeclarations.length)
		clone.setAttribute("style", portableDeclarations.join(";"));
	else clone.removeAttribute("style");
	promotePortableSvgFilter(source, clone, portableDeclarations);
	if (isTaskListCheckbox(source)) {
		TASK_LIST_CHECKBOX_CLONES.add(clone);
		taskCheckboxStaticPaintExpectationFor(clone).baseProperties =
			taskCheckboxStaticPaintProperties(computed);
	}
	assertTaskCheckboxStaticOwnerBase(source, clone);
	taskGeometry?.validate(source, clone, computed);
	if ("THEAD" === source.tagName) {
		TABLE_HEADER_BACKGROUND_METADATA.set(
			clone,
			tableHeaderBackgroundMetadata(source, runtime),
		);
	}
	const projectedTableHeaderBackground =
		"TH" === source.tagName ? tableHeaderBackgroundProjection(clone) : null;
	if (projectedTableHeaderBackground) {
		appendDeclarations(clone, [
			`background-color:${projectedTableHeaderBackground}`,
		]);
	}
	if (["OL", "UL"].includes(source.tagName)) {
		const markerGutter = listMarkerGutterMetadata(source, computed, runtime);
		const direction = listMarkerDirection(source, computed);
		if (markerGutter && direction)
			applyListMarkerGutter(clone, markerGutter, direction);
	}
	if (source.hasAttribute("class")) {
		if (source.classList.contains("katex")) KATEX_VISUAL_ROOTS.add(clone);
		if (source.classList.contains("easymde-math-block"))
			MATH_BLOCK_ROOTS.add(clone);
	}
	if (predicates.isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
	if (predicates.isMermaidForeignObject(source))
		MERMAID_FOREIGN_OBJECTS.add(clone);
	if (
		"TABLE" === source.tagName &&
		fullWidthTableLayout(
			source,
			computed,
			runtime.getComputedStyle,
			previewRoot,
			sourceRoot,
		)
	) {
		FULL_WIDTH_TABLE_CLONES.add(clone);
	}
	if ("TABLE" === source.tagName) {
		const metadata = tableScrollOwnerMetadata(source, computed);
		if (metadata) TABLE_SCROLL_OWNER_METADATA.set(clone, metadata);
	}
	const registeredVisualRoot = markVisualRasterizationClone(
		source,
		clone,
		predicates,
	);
	// Register math source/clone roles while source classes still identify their
	// semantic owners. The final payload removes classes, so normalization must
	// consume this frozen record rather than re-querying a classless clone.
	if (!conversionActive) {
		registerMathCloneRole(
			source,
			clone,
			computed,
			runtime.getComputedStyle,
			dimensionSemantics?.getFormattingOwnerDisplay(source) ?? null,
			predicates,
		);
	}
	if (isVisiblePaintedThemeHeadingSuffix(source, computed)) {
		THEME_HEADING_SUFFIX_CLONES.add(clone);
	}
	if (predicates.isKaTeXVisualNode(source)) {
		KATEX_VISUAL_NODES.add(clone);
		// WeChat applies `white-space:pre-wrap` and `overflow-wrap:break-word`
		// to pasted spans. KaTeX's vlist/table geometry relies on these values
		// remaining non-wrapping across every visual descendant.
		appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
		if (!source.childNodes.length && !source.textContent) {
			// WeChat drops empty KaTeX structure spans such as `.pstrut`. Keep a
			// zero-width word joiner so their copied dimensions remain in the
			// visual tree; the plain-text path strips this marker before writing.
			registerMathEmptyTransportCarrier(source, clone);
			clone.textContent = "\u2060";
		}
	}
	clone.removeAttribute("class");
	removeTransientAttributes(clone);
	return {
		exportComputed,
		imageLayers,
		preserveRepeatingBackground,
		registeredVisualRoot,
	};
}

export async function inlineStyles(
	source: Node,
	clone: Node,
	getComputedStyle: BrowserWechatClipboardRuntime["getComputedStyle"],
	root = false,
	runtime: BrowserWechatClipboardRuntime,
	cache: BackgroundAssetCache,
	previewRoot: HTMLElement,
	sourceRoot: HTMLElement,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	yieldToBrowser: SerializationYield | null = null,
	conversion?: WechatPngConversionContext,
	signal?: AbortSignal,
	taskGeometry: TaskCheckboxGeometryContext | null = null,
	headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
	cloneIdentity?: Map<Element, Element>,
	quoteFlowCollector?: QuotePseudoFlowCollector,
	inlinePseudoPaintCaptures?: WechatInlinePseudoPaintRawCapture[],
	nestedListProjectionCaptures?: WechatNestedListProjectionCapture[],
	predicates?: WechatTreePredicateCache,
): Promise<void> {
	throwIfBackgroundPreparationAborted(signal);
	if (!(source instanceof Element) || !(clone instanceof Element)) return;
	const activePredicates = predicates ?? createWechatTreePredicateCache();
	cloneIdentity?.set(source, clone);
	const computed = getComputedStyle(source);
	// SVG definition trees are commonly hidden by design, but visible shapes
	// still reference them through clip-path, mask, gradient, and filter URLs.
	// Preserve those reusable resources while removing unrelated hidden nodes.
	if (
		!root &&
		"none" === computed.getPropertyValue("display") &&
		!activePredicates.isSvgDefinition(source)
	) {
		HIDDEN_NODES.add(clone);
		return;
	}
	assertTaskCheckboxAppearancePortable(source, computed);
	const declarations = await styleDeclarations(
		source,
		computed,
		false,
		root,
		runtime,
		cache,
		yieldToBrowser,
		signal,
		dimensionSemantics,
		undefined,
		activePredicates,
	);
	throwIfBackgroundPreparationAborted(signal);
	const fidelity = applyNodeFidelity(
		source,
		clone,
		computed,
		declarations,
		root,
		runtime,
		previewRoot,
		sourceRoot,
		dimensionSemantics,
		taskGeometry,
		activePredicates,
		Boolean(conversion),
	);
	if (conversion && fidelity.registeredVisualRoot) {
		await yieldToBrowser?.();
		assertPngConversionCurrent(conversion);
		return;
	}
	if (
		inlinePseudoPaintCaptures &&
		"http://www.w3.org/1999/xhtml" === source.namespaceURI
	) {
		const raw = captureWechatInlinePseudoPaintInput(
			source as HTMLElement,
			inlinePseudoPaintCapabilities(
				runtime,
				source,
				computed,
				getComputedStyle,
			).css,
		);
		if (raw) inlinePseudoPaintCaptures.push(raw);
	}
	for (const [index, child] of Array.from(source.childNodes).entries()) {
		const cloneChild = clone.childNodes.item(index);
		if (cloneChild) {
			await inlineStyles(
				child,
				cloneChild,
				getComputedStyle,
				false,
				runtime,
				cache,
				previewRoot,
				sourceRoot,
				dimensionSemantics,
				yieldToBrowser,
				conversion,
				signal,
				taskGeometry,
				headingFlowCollector,
				cloneIdentity,
				quoteFlowCollector,
				inlinePseudoPaintCaptures,
				nestedListProjectionCaptures,
				activePredicates,
			);
		}
	}
	await addPseudoElement(
		source,
		clone,
		"::before",
		getComputedStyle,
		root,
		runtime,
		cache,
		yieldToBrowser,
		signal,
		dimensionSemantics,
		headingFlowCollector,
		quoteFlowCollector,
		activePredicates,
	);
	await addPseudoElement(
		source,
		clone,
		"::after",
		getComputedStyle,
		root,
		runtime,
		cache,
		yieldToBrowser,
		signal,
		dimensionSemantics,
		headingFlowCollector,
		quoteFlowCollector,
		activePredicates,
	);
	if (nestedListProjectionCaptures && source instanceof HTMLElement) {
		collectNestedOrdinaryListProjection(
			source,
			runtime,
			dimensionSemantics,
			{ captures: nestedListProjectionCaptures },
		);
	}
	throwIfBackgroundPreparationAborted(signal);
	await yieldToBrowser?.();
	throwIfBackgroundPreparationAborted(signal);
	appendThemeImages(
		clone,
		fidelity.preserveRepeatingBackground ? [] : fidelity.imageLayers,
		fidelity.exportComputed,
		!source.textContent?.trim() && !source.children.length,
	);
}

export function inlineStylesSynchronously(
	source: Node,
	clone: Node,
	getComputedStyle: BrowserWechatClipboardRuntime["getComputedStyle"],
	root: boolean,
	runtime: BrowserWechatClipboardRuntime,
	previewRoot: HTMLElement,
	sourceRoot: HTMLElement,
	dimensionSemantics: WechatDimensionSemanticsContext | null,
	taskGeometry: TaskCheckboxGeometryContext | null = null,
	headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
	cloneIdentity?: Map<Element, Element>,
	quoteFlowCollector?: QuotePseudoFlowCollector,
	inlinePseudoPaintCaptures?: WechatInlinePseudoPaintRawCapture[],
	nestedListProjectionCaptures?: WechatNestedListProjectionCapture[],
	predicates?: WechatTreePredicateCache,
): boolean {
	if (!(source instanceof Element) || !(clone instanceof Element)) return true;
	const activePredicates = predicates ?? createWechatTreePredicateCache();
	cloneIdentity?.set(source, clone);
	const computed = getComputedStyle(source);
	if (
		!root &&
		"none" === computed.getPropertyValue("display") &&
		!activePredicates.isSvgDefinition(source)
	) {
		HIDDEN_NODES.add(clone);
		return true;
	}
	assertTaskCheckboxAppearancePortable(source, computed);
	const declarations = styleDeclarationsSynchronously(
		source,
		computed,
		false,
		root,
		runtime,
		dimensionSemantics,
		undefined,
		activePredicates,
	);
	if (null === declarations) return false;
	const fidelity = applyNodeFidelity(
		source,
		clone,
		computed,
		declarations,
		root,
		runtime,
		previewRoot,
		sourceRoot,
		dimensionSemantics,
		taskGeometry,
		activePredicates,
	);
	if (
		inlinePseudoPaintCaptures &&
		"http://www.w3.org/1999/xhtml" === source.namespaceURI
	) {
		const raw = captureWechatInlinePseudoPaintInput(
			source as HTMLElement,
			inlinePseudoPaintCapabilities(
				runtime,
				source,
				computed,
				getComputedStyle,
			).css,
		);
		if (raw) inlinePseudoPaintCaptures.push(raw);
	}
	for (const [index, child] of Array.from(source.childNodes).entries()) {
		const cloneChild = clone.childNodes.item(index);
		if (
			cloneChild &&
			!inlineStylesSynchronously(
				child,
				cloneChild,
				getComputedStyle,
				false,
				runtime,
				previewRoot,
				sourceRoot,
				dimensionSemantics,
				taskGeometry,
				headingFlowCollector,
				cloneIdentity,
				quoteFlowCollector,
				inlinePseudoPaintCaptures,
				nestedListProjectionCaptures,
				activePredicates,
			)
		)
			return false;
	}
	if (
		!addPseudoElementSynchronously(
			source,
			clone,
			"::before",
			getComputedStyle,
			root,
			runtime,
			dimensionSemantics,
			headingFlowCollector,
			quoteFlowCollector,
			activePredicates,
		)
	)
		return false;
	if (
		!addPseudoElementSynchronously(
			source,
			clone,
			"::after",
			getComputedStyle,
			root,
			runtime,
			dimensionSemantics,
			headingFlowCollector,
			quoteFlowCollector,
			activePredicates,
		)
	)
		return false;
	if (nestedListProjectionCaptures && source instanceof HTMLElement) {
		collectNestedOrdinaryListProjection(
			source,
			runtime,
			dimensionSemantics,
			{ captures: nestedListProjectionCaptures },
		);
	}
	appendThemeImages(
		clone,
		fidelity.preserveRepeatingBackground ? [] : fidelity.imageLayers,
		fidelity.exportComputed,
		!source.textContent?.trim() && !source.children.length,
	);
	return true;
}
