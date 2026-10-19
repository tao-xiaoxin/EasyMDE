import {
	CODE_FRAME_HEADER_CLONES,
	EXPORT_TEXT_NORMALIZATIONS,
	FULL_WIDTH_TABLE_CLONES,
	GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
	HEADING_EMPTY_PSEUDO_FLOW_CLONES,
	HIDDEN_NODES,
	INLINE_TEXT_MARKER_CLONES,
	isBlockMathClone,
	isKaTeXVisualClone,
	isKaTeXVisualNode,
	isMermaidForeignObject,
	isMermaidSvgRoot,
	isSvgDefinition,
	isTaskListCheckbox,
	KATEX_VISUAL_NODES,
	KATEX_VISUAL_ROOTS,
	MATH_BLOCK_ROOTS,
	WECHAT_PNG_VISUAL_CLONES,
	registerMathCloneRole,
	markVisualRasterizationClone,
	MERMAID_FOREIGN_OBJECTS,
	MERMAID_SVG_ROOTS,
	TABLE_HEADER_BACKGROUND_METADATA,
	TABLE_SCROLL_OWNER_METADATA,
	TASK_LIST_CHECKBOX_CLONES,
	THEME_HEADING_SUFFIX_CLONES,
	THEME_IMAGE_CLONES,
	WECHAT_PNG_GENERATED_IMAGES,
} from "./wechat-clone-metadata";
import {
	type BackgroundAssetCache,
	appendThemeImages,
	dataImageLayersFromDeclarations,
	type ThemeImageLayer,
	hasRepeatingBackground,
	removeDataImageBackgroundDeclarations,
} from "./wechat-background-images";
import {
	WECHAT_COPY_TIMING_NAMES,
	throwIfBackgroundPreparationAborted,
	yieldSerializationBoundary,
	type BrowserWechatClipboardRuntime,
	type SerializationYield,
} from "./wechat-clipboard-runtime";
import type { WechatDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { preparedDimensionGeometrySignature } from "./wechat-fidelity-signature";
import {
	applyListMarkerGutter,
	fullWidthTableLayout,
	listMarkerDirection,
	listMarkerGutterMetadata,
	normalizePortableTables,
	tableHeaderBackgroundMetadata,
	tableHeaderBackgroundProjection,
	tableScrollOwnerMetadata,
} from "./wechat-list-table-layout";
import {
	assertPngConversionCurrent,
	type WechatPngConversionContext,
} from "./wechat-png-conversion-policy";
import {
	KATEX_VISUAL_LAYOUT_DECLARATIONS,
	MERMAID_LABEL_LAYOUT_DECLARATIONS,
	expandMermaidLabelGeometry,
	findKaTeXMathMl,
	materializeCodeLineBreaks,
	normalizeCodeFrames,
	normalizeCodeWhitespace,
	normalizeMathBlocks,
	preserveCodeLineWhitespace,
	preserveMermaidLabelWhitespace,
	wrapCodeLines,
	wrapCodeRows,
	wrapMermaidLabelContents,
} from "./wechat-portable-content";
import { previewMeasurementWidth } from "./wechat-preview-measurement";
import { normalizePortableMedia } from "./wechat-portable-media";
import {
	addPseudoElement,
	addPseudoElementSynchronously,
	assertHeadingEmptyPseudoFlows,
	generatedHeadingAfterContentIsEmpty,
	isVisiblePaintedThemeHeadingSuffix,
	styleDeclarations,
	styleDeclarationsSynchronously,
	type HeadingEmptyPseudoFlowCollector,
} from "./wechat-pseudo-elements";
import {
	appendDeclarations,
	removeTransientAttributes,
	rootExportComputedStyle,
} from "./wechat-style-policy";
import { replaceDeclarations } from "./wechat-style-declarations";
import {
	TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS,
	TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES,
	TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
	TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT,
	TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS,
	TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS,
	assertTaskCheckboxCaptionRuns,
	registerTaskCheckboxCaptionNormalizations,
} from "./wechat-task-caption";
import type { TaskCheckboxGeometryContext } from "./wechat-task-geometry";
import {
	assertTaskCheckboxAppearancePortable,
	assertTaskCheckboxStaticOwnerBase,
	assertTaskCheckboxStaticOwners,
	replaceTaskListCheckboxClones,
	restoreTaskListCheckboxOwnerState,
	taskCheckboxStaticPaintExpectationFor,
	taskCheckboxStaticPaintProperties,
	normalizeTaskCheckboxTransport,
} from "./wechat-task-paint";
import {
	assertTaskCheckboxStaticFlowAllocationsForRoot,
	normalizeTaskCheckboxStaticFlow,
	normalizeTaskCheckboxStaticFlowSynchronously,
} from "./wechat-task-static-flow";
import {
	normalizePortableTaskListMarkers,
	projectCompleteTaskListStructures,
} from "./wechat-task-list-projection";
import {
	type TaskCheckboxGeometryLease,
	createTaskCheckboxGeometryContext,
	taskCheckboxGeometryScopes,
} from "./wechat-task-geometry";
import { createDimensionSemanticsContext } from "./wechat-dimension-semantics";
import { replaceVisualObjects } from "./wechat-png-conversion";
import { runWechatSyncTiming } from "./wechat-timing";
import {
	createWechatSvgPortableIntegration,
	type WechatSvgPortableIntegration,
} from "./wechat-svg-portable-integration";
import { createWechatMarkupPreparationTimings } from "./wechat-copy-timing";
import {
	captureWechatMathStaticFlowSnapshot,
	applyWechatMathStaticFlow,
	planWechatMathStaticFlow,
	type WechatMathSourceAdmissionResult,
	type WechatMathStaticFlowGate,
	type WechatMathStaticFlowRuntime,
} from "./wechat-math-static-flow";
import {
	createWechatMathStaticFlowSourceCapture,
	type WechatMathStaticFlowSealedCapture,
} from "./wechat-math-static-flow-capture";

export type WechatMathSourceCaptureResult = Readonly<{
	runtime: WechatMathStaticFlowRuntime | null;
	sourceAdmission: WechatMathSourceAdmissionResult | null;
	sourceFingerprint: string;
	rawDimensionGeometrySignature: string;
}>;

export function hasWechatMathStaticFlowCandidate(
	sourceRoot: HTMLElement,
): boolean {
	return (
		sourceRoot.matches(
			".katex, .katex-display, .katex-html, .easymde-math-block, .easymde-math-inline, .vlist",
		) ||
		Boolean(
			sourceRoot.querySelector(
				".katex, .katex-display, .katex-html, .easymde-math-block, .easymde-math-inline, .vlist",
			),
		)
	);
}

function animationReaderFor(
	runtime: BrowserWechatClipboardRuntime,
): () => readonly Animation[] {
	const documentReader = (
		runtime.document as Document & {
			getAnimations?: () => readonly Animation[];
		}
	).getAnimations;
	if ("function" === typeof documentReader)
		return () => documentReader.call(runtime.document);
	throw new Error("wechat-math-static-flow-animation-reader-missing");
}

function emptyMathSourceCaptureResult(): WechatMathSourceCaptureResult {
	return {
		rawDimensionGeometrySignature: "",
		runtime: null,
		sourceAdmission: null,
		sourceFingerprint: "",
	};
}

function mathCaptureResultFromSealed(
	sealed: WechatMathStaticFlowSealedCapture,
	rawDimensionGeometrySignature: string,
): WechatMathSourceCaptureResult {
	return {
		rawDimensionGeometrySignature,
		runtime: sealed.capturedRuntime,
		sourceAdmission: sealed.sourceAdmission,
		sourceFingerprint: sealed.sourceFingerprint,
	};
}

function createMathSourceCapture(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
) {
	if (!hasWechatMathStaticFlowCandidate(sourceRoot)) return null;
	return createWechatMathStaticFlowSourceCapture({
		enabled: true,
		runtime: {
			document: runtime.document,
			getAnimations: animationReaderFor(runtime),
			getComputedStyle: runtime.getComputedStyle,
		},
		sourceRoot,
	});
}

function assertMathCaptureCurrent(
	signal?: AbortSignal,
	isCurrent?: () => boolean,
): void {
	throwIfBackgroundPreparationAborted(signal);
	if (isCurrent && !isCurrent()) throw new Error("wechat-copy-cancelled");
}

export async function captureWechatMathSourceAdmission(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	yieldToBrowser: SerializationYield | null = null,
	signal?: AbortSignal,
	isCurrent?: () => boolean,
	enabled = true,
	rawDimensionGeometrySignature = "",
): Promise<WechatMathSourceCaptureResult> {
	if (!enabled) return emptyMathSourceCaptureResult();
	const capture = createMathSourceCapture(sourceRoot, runtime);
	if (!capture) return emptyMathSourceCaptureResult();
	const elements = [
		sourceRoot,
		...Array.from(sourceRoot.querySelectorAll("*")),
	];
	for (const element of elements) {
		assertMathCaptureCurrent(signal, isCurrent);
		capture.observe(
			element,
			runtime.getComputedStyle(element),
			element.getBoundingClientRect(),
		);
		if (yieldToBrowser?.shouldYield()) {
			await yieldToBrowser();
			assertMathCaptureCurrent(signal, isCurrent);
			capture.updateCoordinateEpoch(sourceRoot.getBoundingClientRect());
		}
	}
	assertMathCaptureCurrent(signal, isCurrent);
	const sealed = capture.seal();
	if (!sealed) throw new Error("wechat-math-static-flow-capture-missing");
	return mathCaptureResultFromSealed(sealed, rawDimensionGeometrySignature);
}

export function captureWechatMathSourceAdmissionSynchronously(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	enabled = true,
	signal?: AbortSignal,
	isCurrent?: () => boolean,
	rawDimensionGeometrySignature = "",
): WechatMathSourceCaptureResult {
	if (!enabled) return emptyMathSourceCaptureResult();
	const capture = createMathSourceCapture(sourceRoot, runtime);
	if (!capture) return emptyMathSourceCaptureResult();
	const elements = [
		sourceRoot,
		...Array.from(sourceRoot.querySelectorAll("*")),
	];
	elements.forEach((element) => {
		assertMathCaptureCurrent(signal, isCurrent);
		capture.observe(
			element,
			runtime.getComputedStyle(element),
			element.getBoundingClientRect(),
		);
	});
	assertMathCaptureCurrent(signal, isCurrent);
	const sealed = capture.seal();
	if (!sealed) throw new Error("wechat-math-static-flow-capture-missing");
	return mathCaptureResultFromSealed(sealed, rawDimensionGeometrySignature);
}

type NodeFidelityResult = Readonly<{
	exportComputed: CSSStyleDeclaration;
	imageLayers: ThemeImageLayer[];
	preserveRepeatingBackground: boolean;
	registeredVisualRoot: boolean;
}>;

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
	if (source.matches(".katex")) KATEX_VISUAL_ROOTS.add(clone);
	if (source.matches(".easymde-math-block")) MATH_BLOCK_ROOTS.add(clone);
	if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
	if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
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
	const registeredVisualRoot = markVisualRasterizationClone(source, clone);
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
		);
	}
	if (isVisiblePaintedThemeHeadingSuffix(source, computed)) {
		THEME_HEADING_SUFFIX_CLONES.add(clone);
	}
	if (isKaTeXVisualNode(source)) {
		KATEX_VISUAL_NODES.add(clone);
		// WeChat applies `white-space:pre-wrap` and `overflow-wrap:break-word`
		// to pasted spans. KaTeX's vlist/table geometry relies on these values
		// remaining non-wrapping across every visual descendant.
		appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
		if (!source.childNodes.length && !source.textContent) {
			// WeChat drops empty KaTeX structure spans such as `.pstrut`. Keep a
			// zero-width word joiner so their copied dimensions remain in the
			// visual tree; the plain-text path strips this marker before writing.
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
): Promise<void> {
	throwIfBackgroundPreparationAborted(signal);
	if (!(source instanceof Element) || !(clone instanceof Element)) return;
	cloneIdentity?.set(source, clone);
	const computed = getComputedStyle(source);
	// SVG definition trees are commonly hidden by design, but visible shapes
	// still reference them through clip-path, mask, gradient, and filter URLs.
	// Preserve those reusable resources while removing unrelated hidden nodes.
	if (
		!root &&
		"none" === computed.getPropertyValue("display") &&
		!isSvgDefinition(source)
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
		Boolean(conversion),
	);
	if (conversion && fidelity.registeredVisualRoot) {
		await yieldToBrowser?.();
		assertPngConversionCurrent(conversion);
		return;
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
	);
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
): boolean {
	if (!(source instanceof Element) || !(clone instanceof Element)) return true;
	cloneIdentity?.set(source, clone);
	const computed = getComputedStyle(source);
	if (
		!root &&
		"none" === computed.getPropertyValue("display") &&
		!isSvgDefinition(source)
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
	);
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
		)
	)
		return false;
	appendThemeImages(
		clone,
		fidelity.preserveRepeatingBackground ? [] : fidelity.imageLayers,
		fidelity.exportComputed,
		!source.textContent?.trim() && !source.children.length,
	);
	return true;
}

export function wrapKaTeXVisualRoots(root: HTMLElement): void {
	const document = root.ownerDocument;
	Array.from(root.querySelectorAll("*"))
		.filter((element) => KATEX_VISUAL_ROOTS.has(element))
		.forEach((element) => {
			const wrapper = document.createElement("nobr");
			appendDeclarations(
				wrapper,
				[
					isBlockMathClone(element) ? "display:block" : "display:inline-block",
					...(isBlockMathClone(element) ? ["text-align:center"] : []),
					"word-break:normal",
					"overflow-wrap:normal",
				],
				true,
			);
			element.replaceWith(wrapper);
			wrapper.appendChild(element);
		});
}

export function normalizeStructure(clone: HTMLElement): HTMLElement {
	const document = clone.ownerDocument;
	const root = ["ARTICLE", "BLOCKQUOTE", "DIV"].includes(clone.tagName)
		? document.createElement("section")
		: clone;

	if (root !== clone) {
		if (TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.has(clone)) {
			TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.set(clone, root);
		}
		const ownerSequence = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(clone);
		if (ownerSequence)
			TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, ownerSequence);
		Array.from(clone.attributes).forEach((attribute) => {
			root.setAttribute(attribute.name, attribute.value);
		});
		while (clone.firstChild) root.appendChild(clone.firstChild);
	}

	root.querySelectorAll("blockquote, div").forEach((element) => {
		if (element.closest("svg")) return;
		const section = document.createElement("section");
		if (TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.has(element)) {
			TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.set(element, section);
		}
		Array.from(element.attributes).forEach((attribute) => {
			section.setAttribute(attribute.name, attribute.value);
		});
		while (element.firstChild) section.appendChild(element.firstChild);
		element.replaceWith(section);
	});

	return root;
}

export function referencedFragmentIds(preview: HTMLElement): Set<string> {
	const ids = new Set<string>();
	preview.querySelectorAll('a[href^="#"]').forEach((link) => {
		const id = link.getAttribute("href")?.slice(1) ?? "";
		if (/^[A-Za-z][\w:.-]{0,120}$/.test(id)) ids.add(id);
	});
	return ids;
}

export function retainReferencedFragmentIds(
	root: HTMLElement,
	ids: Set<string>,
): void {
	root.querySelectorAll("[id]").forEach((element) => {
		if (element.closest("svg") || ids.has(element.id)) return;
		element.removeAttribute("id");
	});
	if (root.id && !ids.has(root.id) && !root.closest("svg"))
		root.removeAttribute("id");
}

export function wrapTextLeaves(root: HTMLElement): void {
	const document = root.ownerDocument;
	const walker = document.createTreeWalker(root, 4);
	const textNodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		textNodes.push(node as Text);
		node = walker.nextNode();
	}

	textNodes.forEach((textNode) => {
		const parent = textNode.parentElement;
		const value = textNode.nodeValue ?? "";
		if (
			!parent ||
			parent.closest("svg") ||
			parent.matches("span[leaf]") ||
			parent.matches('span[aria-hidden="true"]') ||
			(!value.trim() && !parent.closest("pre, code"))
		)
			return;
		const leaf = document.createElement("span");
		const previousSibling = textNode.previousSibling;
		const directTextNodes = Array.from(parent.childNodes).filter(
			(child): child is Text => child.nodeType === 3,
		);
		const taskCheckboxCaptionBinding =
			TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.get(textNode);
		// Native WeChat Save blockifies an inline wrapper placed directly after a
		// materialized task owner. Keep this one generation-owned caption run as a
		// direct text node so it remains in the LI's inline formatting context.
		// Nested formatting, authored text, and ambiguous siblings retain leaves.
		const directTaskCaptionText = Boolean(
			TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.has(textNode) &&
				previousSibling instanceof Element &&
				TASK_LIST_CHECKBOX_CLONES.has(previousSibling) &&
				previousSibling.parentElement === parent,
		);
		if (directTaskCaptionText) return;
		const inlineMarkerLeaf = Boolean(
			"LI" === parent.tagName &&
				parent.childNodes.length === 2 &&
				previousSibling instanceof Element &&
				INLINE_TEXT_MARKER_CLONES.has(previousSibling) &&
				directTextNodes.length === 1 &&
				directTextNodes[0] === textNode,
		);
		const taskCheckboxInlineLeaf = Boolean(
			taskCheckboxCaptionBinding ||
				TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.has(textNode),
		);
		if (!inlineMarkerLeaf && !taskCheckboxInlineLeaf)
			leaf.setAttribute("leaf", "");
		else leaf.style.setProperty("display", "inline");
		leaf.textContent = value;
		parent.replaceChild(leaf, textNode);
		if (taskCheckboxCaptionBinding) {
			TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS.add(leaf);
			const replacementText = leaf.firstChild;
			if (!(replacementText instanceof Text))
				throw new Error("wechat-task-checkbox-caption-record-missing");
			const normalizations = EXPORT_TEXT_NORMALIZATIONS.get(root);
			const normalization = normalizations?.get(textNode);
			taskCheckboxCaptionBinding.binding.cloneText = replacementText;
			TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.delete(textNode);
			TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.set(
				replacementText,
				taskCheckboxCaptionBinding,
			);
			if (normalizations && normalization) {
				normalizations.delete(textNode);
				normalizations.set(replacementText, normalization);
			}
		}
	});
}

function removeOmittedNodes(
	clone: HTMLElement,
	mathMlNodes: ReadonlySet<Element>,
	svgIntegration: WechatSvgPortableIntegration,
): void {
	const elements = Array.from(clone.querySelectorAll("*"));
	for (const element of elements) {
		if (!clone.contains(element)) continue;
		if (
			mathMlNodes.has(element) ||
			HIDDEN_NODES.has(element) ||
			[
				"script",
				"style",
				"button",
				"textarea",
				"select",
				"option",
				"form",
				"iframe",
				"object",
				"embed",
			].includes(element.localName.toLowerCase()) ||
			("input" === element.localName.toLowerCase() &&
				!TASK_LIST_CHECKBOX_CLONES.has(element))
		) {
			const source = svgIntegration.sourceForClone(element);
			svgIntegration.omitSubtree(source, element);
			element.remove();
		}
	}
}

export function finalizeMarkup(
	clone: HTMLElement,
	fragmentIds: Set<string>,
): HTMLElement {
	wrapKaTeXVisualRoots(clone);
	const themeHeadingSuffixClones: Element[] = [];
	const generatedEmptyHeadingSuffixClones: Element[] = [];
	clone.querySelectorAll("*").forEach((element) => {
		if (THEME_HEADING_SUFFIX_CLONES.has(element))
			themeHeadingSuffixClones.push(element);
		if (GENERATED_EMPTY_HEADING_SUFFIX_CLONES.has(element)) {
			generatedEmptyHeadingSuffixClones.push(element);
		}
	});
	restoreTaskListCheckboxOwnerState(clone);
	normalizeMathBlocks(clone);
	const normalized = normalizeStructure(clone);
	normalizePortableTaskListMarkers(normalized);
	projectCompleteTaskListStructures(normalized);
	retainReferencedFragmentIds(normalized, fragmentIds);
	appendDeclarations(normalized, ["max-width:100%", "margin:0 auto"]);
	normalized.querySelectorAll("img, video").forEach((element) => {
		const generatedVisualOwner =
			element.parentElement?.getAttribute("data-ignore-width") === "";
		if (
			THEME_IMAGE_CLONES.has(element) ||
			WECHAT_PNG_GENERATED_IMAGES.has(element) ||
			generatedVisualOwner
		)
			return;
		// Inline media keeps its captured width and display. Block media gets an
		// explicit responsive width and a natural-width cap because
		// WeChat may preserve a fixed width when only max-width/height:auto are
		// supplied.
		normalizePortableMedia(element);
	});
	normalized.querySelectorAll("svg").forEach((element) => {
		let rasterizationOwner: Element | null = element;
		let rasterizationOwned = false;
		while (rasterizationOwner) {
			if (WECHAT_PNG_VISUAL_CLONES.has(rasterizationOwner)) {
				rasterizationOwned = true;
				break;
			}
			rasterizationOwner = rasterizationOwner.parentElement;
		}
		if (rasterizationOwned) return;
		// KaTeX stretchy symbols use absolutely positioned SVGs whose intrinsic
		// height is part of the visual layout. A generic `height:auto` media rule
		// collapses those SVGs after paste, while non-math SVG illustrations still
		// need the portable responsive rule.
		if (MERMAID_SVG_ROOTS.has(element)) {
			// Mermaid HTML labels are rendered in fixed-size foreignObject boxes.
			// WeChat's fallback font can be wider than the preview font, so preserve
			// the label's overflow instead of clipping its final glyphs.
			appendDeclarations(
				element,
				["overflow:visible", "overflow-x:visible", "overflow-y:visible"],
				true,
			);
		}
		if (isKaTeXVisualClone(element)) return;
		replaceDeclarations(element, ["max-width:100%"], true);
		appendDeclarations(element, ["height:auto"]);
	});
	normalized.querySelectorAll("foreignObject").forEach((element) => {
		if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
		appendDeclarations(
			element,
			[
				...MERMAID_LABEL_LAYOUT_DECLARATIONS,
				"overflow:visible",
				"overflow-x:visible",
				"overflow-y:visible",
			],
			true,
		);
	});
	wrapMermaidLabelContents(normalized);
	expandMermaidLabelGeometry(normalized);
	preserveMermaidLabelWhitespace(normalized);
	let exportTextNormalizations =
		EXPORT_TEXT_NORMALIZATIONS.get(normalized) ??
		new Map<Text, Readonly<{ original: string; encoded: string }>>();
	registerTaskCheckboxCaptionNormalizations(
		normalized,
		exportTextNormalizations,
	);
	EXPORT_TEXT_NORMALIZATIONS.set(normalized, exportTextNormalizations);
	normalizeTaskCheckboxTransport(normalized, exportTextNormalizations);
	normalizePortableTables(normalized);
	normalizeCodeFrames(normalized);
	materializeCodeLineBreaks(normalized);
	wrapCodeLines(normalized);
	preserveCodeLineWhitespace(normalized);
	wrapTextLeaves(normalized);
	normalizeCodeWhitespace(normalized);
	wrapCodeRows(normalized);
	themeHeadingSuffixClones.forEach((element) => {
		if (!normalized.contains(element) || element.childNodes.length !== 0)
			return;
		const textNode = normalized.ownerDocument.createTextNode("\u2060");
		element.appendChild(textNode);
		exportTextNormalizations ??= new Map();
		exportTextNormalizations.set(textNode, { original: "", encoded: "\u2060" });
	});
	generatedEmptyHeadingSuffixClones.forEach((element) => {
		if (!normalized.contains(element)) return;
		const textNodes = Array.from(element.childNodes).filter(
			(node): node is Text => node.nodeType === 3,
		);
		const textNode = 1 === textNodes.length ? textNodes[0] : null;
		if (!textNode) return;
		// One transport owns the whole generated whitespace set: a marker whose
		// remaining text is a generated space, tab, or non-breaking space becomes
		// one U+2060 glyph, and the root-scoped record restores the parsed
		// `content` for connected plain-text measurement. A generated flow marker
		// keeps its empty plain-text authority.
		if (!generatedHeadingAfterContentIsEmpty(textNode.nodeValue ?? "")) return;
		const original = HEADING_EMPTY_PSEUDO_FLOW_CLONES.has(element)
			? ""
			: (textNode.nodeValue ?? "");
		textNode.nodeValue = "\u2060";
		exportTextNormalizations ??= new Map();
		exportTextNormalizations.set(textNode, { original, encoded: "\u2060" });
	});
	if (exportTextNormalizations)
		EXPORT_TEXT_NORMALIZATIONS.set(normalized, exportTextNormalizations);
	assertTaskCheckboxCaptionRuns(normalized, exportTextNormalizations);
	return normalized;
}

export function normalizedPlainText(value: string): string {
	return value.replaceAll("\u2060", "").replaceAll("\u00a0", " ");
}

export function connectedPlainText(
	root: HTMLElement,
	source: HTMLElement,
): string {
	const document = root.ownerDocument;
	if (!document.body)
		throw new Error("wechat-plain-text-document-body-unavailable");
	const detachedCodeFrameHeaders: Array<
		Readonly<{ element: Element; parent: Node; nextSibling: ChildNode | null }>
	> = [];
	const normalizations = EXPORT_TEXT_NORMALIZATIONS.get(root) ?? new Map();
	const restoreCodeText = (property: "original" | "encoded"): void => {
		normalizations?.forEach((value, textNode) => {
			textNode.nodeValue = value[property];
		});
	};
	// The encoded clone is needed for the HTML Blob. Plain-text measurement must
	// see the original code bytes, while finally restoring the encoded clone
	// keeps repeated payload reads and cleanup deterministic.
	let host: HTMLDivElement | null = null;
	try {
		restoreCodeText("original");
		assertTaskCheckboxCaptionRuns(root, normalizations, "original");
		// Plain text does not need media resources. Remove their fetchable
		// attributes from the temporary measurement tree while leaving the HTML
		// payload untouched.
		root.querySelectorAll("img, video, source").forEach((element) => {
			element.removeAttribute("src");
			element.removeAttribute("srcset");
			element.removeAttribute("poster");
		});
		// A generated code-frame header is paint-only. Keeping it in the HTML
		// payload is required for layout, but its block boundary must not become
		// a line in the separate plain-text clipboard payload.
		Array.from(root.querySelectorAll("*"))
			.filter((element) => CODE_FRAME_HEADER_CLONES.has(element))
			.forEach((element) => {
				const parent = element.parentNode;
				if (!parent) return;
				detachedCodeFrameHeaders.push({
					element,
					parent,
					nextSibling: element.nextSibling,
				});
				parent.removeChild(element);
			});
		host = document.createElement("div");
		// `innerText` uses layout only while a node is connected. Keep this host
		// outside the viewport without using `display:none` or `visibility:hidden`,
		// either of which makes `innerText` empty or loses block boundaries.
		host.style.cssText = [
			"position:fixed",
			"left:-100000px",
			"top:0",
			"opacity:0",
			"pointer-events:none",
			"contain:layout",
		].join(";");
		const sourceWidth = previewMeasurementWidth(source);
		if (sourceWidth) {
			host.style.width = `${sourceWidth}px`;
			host.style.maxWidth = `${sourceWidth}px`;
		}
		document.body.append(host);
		host.append(root);
		const connectedText = normalizedPlainText(
			root.innerText || root.textContent || "",
		);
		// jsdom and other non-layout DOM implementations flatten a connected
		// clone too. When the real Preview exposes line-aware `innerText`, retain
		// those source boundaries only in that no-layout case; the normalized
		// clone remains the source for browsers that can perform layout.
		const sourceText = source.innerText;
		assertTaskCheckboxCaptionRuns(root, normalizations, "original");
		if (
			!connectedText.includes("\n") &&
			"string" === typeof sourceText &&
			sourceText.includes("\n")
		) {
			return normalizedPlainText(sourceText);
		}
		return connectedText;
	} finally {
		host?.remove();
		detachedCodeFrameHeaders
			.reverse()
			.forEach(({ element, parent, nextSibling }) => {
				if (nextSibling?.parentNode === parent)
					parent.insertBefore(element, nextSibling);
				else parent.appendChild(element);
			});
		restoreCodeText("encoded");
		assertTaskCheckboxCaptionRuns(root, normalizations, "encoded");
	}
}

type MathStaticFlowPlan = ReturnType<typeof planWechatMathStaticFlow>;

type MathOmissionIndex = Readonly<{
	ends: ReadonlyMap<Element, number>;
	prefix: readonly number[];
	starts: ReadonlyMap<Element, number>;
}>;

function createMathOmissionIndex(
	preview: Element,
	cloneIdentity: ReadonlyMap<Element, Element>,
): MathOmissionIndex {
	const starts = new Map<Element, number>();
	const ends = new Map<Element, number>();
	const omittedFlags: boolean[] = [];
	const visit = (element: Element, inheritedOmission: boolean): void => {
		const start = omittedFlags.length;
		starts.set(element, start);
		const omitted =
			inheritedOmission ||
			HIDDEN_NODES.has(cloneIdentity.get(element) ?? element);
		omittedFlags.push(omitted);
		for (const child of Array.from(element.children)) visit(child, omitted);
		ends.set(element, omittedFlags.length);
	};
	visit(preview, false);
	const prefix = [0];
	for (const omitted of omittedFlags) {
		prefix.push((prefix.at(-1) ?? 0) + (omitted ? 1 : 0));
	}
	return { ends, prefix, starts };
}

function mathGroupHasOmittedClone(
	group: WechatMathSourceAdmissionResult["groups"][number],
	omissionIndex: MathOmissionIndex,
): boolean {
	const start = omissionIndex.starts.get(group.source);
	const end = omissionIndex.ends.get(group.source);
	return (
		undefined !== start &&
		undefined !== end &&
		omissionIndex.prefix[end] !== omissionIndex.prefix[start]
	);
}

function createMathStaticFlowGate(
	conversion: WechatPngConversionContext | undefined,
	signal: AbortSignal | undefined,
	isCurrent: (() => boolean) | undefined,
): WechatMathStaticFlowGate {
	const gate: WechatMathStaticFlowGate = {
		isCancelled: () => Boolean(signal?.aborted || conversion?.signal.aborted),
		isCurrent: () =>
			Boolean(
				(!isCurrent || isCurrent()) &&
					(!conversion?.isCurrent || conversion.isCurrent()),
			),
	};
	const gateSignal = signal ?? conversion?.signal;
	return gateSignal ? { ...gate, signal: gateSignal } : gate;
}

function bindMathStaticFlowPlan(
	preview: HTMLElement,
	clone: HTMLElement,
	runtime: WechatMathStaticFlowRuntime | null,
	sourceAdmission: WechatMathSourceAdmissionResult | null,
	sourceFingerprint: string,
	rawDimensionGeometrySignature: string,
	cloneIdentity: ReadonlyMap<Element, Element>,
	svgIntegration: WechatSvgPortableIntegration,
	conversion: WechatPngConversionContext | undefined,
	signal: AbortSignal | undefined,
	isCurrent: (() => boolean) | undefined,
): MathStaticFlowPlan | null {
	if (
		!sourceAdmission ||
		!Array.isArray(sourceAdmission.groups) ||
		sourceAdmission.groups.length === 0
	)
		return null;
	if (sourceAdmission.sourceRoot !== preview) {
		throw new Error("wechat-math-static-flow-root-mismatch");
	}
	if (!runtime)
		throw new Error("wechat-math-static-flow-captured-runtime-missing");
	if (!sourceFingerprint)
		throw new Error("wechat-math-static-flow-source-fingerprint-missing");
	if (!rawDimensionGeometrySignature)
		throw new Error("wechat-math-static-flow-dimension-signature-missing");
	const gate = createMathStaticFlowGate(conversion, signal, isCurrent);
	const omissionIndex = createMathOmissionIndex(preview, cloneIdentity);
	const boundGroups = sourceAdmission.groups.filter(
		(group) => !mathGroupHasOmittedClone(group, omissionIndex),
	);
	if (!boundGroups.length) return null;
	const bindingSourceAdmission =
		boundGroups.length === sourceAdmission.groups.length
			? sourceAdmission
			: { ...sourceAdmission, groups: boundGroups };
	const snapshot = captureWechatMathStaticFlowSnapshot({
		cloneIdentityFor: (source) => {
			const target = cloneIdentity.get(source) ?? null;
			if (!target) return null;
			if (svgIntegration.sourceForClone(target) !== source) {
				throw new Error("wechat-math-static-flow-identity-mismatch");
			}
			return target;
		},
		cloneRoot: clone,
		gate,
		liveSourceAdmissionSignature: sourceFingerprint,
		rawDimensionGeometrySignature,
		runtime,
		sourceAdmission: bindingSourceAdmission,
		sourceRoot: preview,
	});
	return planWechatMathStaticFlow(snapshot, { gate });
}

export async function createMarkup(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	cache: BackgroundAssetCache,
	yieldToBrowser: SerializationYield | null = null,
	conversion?: WechatPngConversionContext,
	signal?: AbortSignal,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
): Promise<HTMLElement> {
	throwIfBackgroundPreparationAborted(signal);
	if (conversion) assertPngConversionCurrent(conversion);
	const mathCapture = sourceAdmission
		? null
		: await captureWechatMathSourceAdmission(
				preview,
				runtime,
				yieldToBrowser,
				signal ?? conversion?.signal,
				isCurrent,
				!conversion,
				conversion || !hasWechatMathStaticFlowCandidate(preview)
					? ""
					: preparedDimensionGeometrySignature(
							preview,
							runtime,
							dimensionSemantics,
						),
			);
	const effectiveSourceAdmission = conversion
		? null
		: (sourceAdmission ?? mathCapture?.sourceAdmission ?? null);
	const effectiveMathFingerprint =
		mathSourceFingerprint || mathCapture?.sourceFingerprint || "";
	const effectiveMathGeometrySignature =
		mathRawDimensionGeometrySignature ||
		mathCapture?.rawDimensionGeometrySignature ||
		"";
	const effectiveMathRuntime = mathRuntime ?? mathCapture?.runtime ?? null;
	const clone = preview.cloneNode(true) as HTMLElement;
	const cloneIdentity = new Map<Element, Element>();
	const svgIntegration = createWechatSvgPortableIntegration(
		preview,
		clone,
		runtime,
	);
	const sourceTaskInputs = replaceTaskListCheckboxClones(
		sourceRoot,
		preview,
		clone,
		runtime,
	);
	svgIntegration.reconcileTaskCheckboxes(preview, clone);
	const fragmentIds = referencedFragmentIds(preview);
	const mathMlNodes = findKaTeXMathMl(clone);
	if (
		taskCheckboxGeometryScopes(sourceRoot, runtime).length &&
		!taskGeometryLease
	) {
		throw new Error("wechat-task-checkbox-geometry-lease-missing");
	}
	const taskGeometry = createTaskCheckboxGeometryContext(
		taskGeometryLease,
		runtime,
		dimensionSemantics,
	);
	const headingFlowCollector: HeadingEmptyPseudoFlowCollector = {
		expectations: [],
	};
	const markupTimings = createWechatMarkupPreparationTimings(
		clone.ownerDocument.defaultView?.performance,
		Boolean(conversion),
	);
	try {
		await inlineStyles(
			preview,
			clone,
			runtime.getComputedStyle,
			true,
			runtime,
			cache,
			preview,
			sourceRoot,
			dimensionSemantics,
			yieldToBrowser,
			conversion,
			signal,
			taskGeometry,
			headingFlowCollector,
			cloneIdentity,
		);
		markupTimings.inlineStyles.finish("success");
		throwIfBackgroundPreparationAborted(signal);
		removeOmittedNodes(clone, mathMlNodes, svgIntegration);
		const mathPlan = bindMathStaticFlowPlan(
			preview,
			clone,
			effectiveMathRuntime,
			effectiveSourceAdmission,
			effectiveMathFingerprint,
			effectiveMathGeometrySignature,
			cloneIdentity,
			svgIntegration,
			conversion,
			signal,
			isCurrent,
		);
		svgIntegration.freezePlan(conversion ?? null);
		if (conversion) {
			assertPngConversionCurrent(conversion);
			await replaceVisualObjects(
				clone,
				conversion,
				runtime,
				cache,
				yieldToBrowser,
			);
			assertPngConversionCurrent(conversion);
		}
		await normalizeTaskCheckboxStaticFlow(
			clone,
			runtime,
			yieldToBrowser,
			conversion,
			signal,
			taskGeometryLease,
		);
		throwIfBackgroundPreparationAborted(signal);
		const finalized = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.finalizeMarkup,
			{ mode: "sync" },
			() => finalizeMarkup(clone, fragmentIds),
		);
		if (mathPlan) {
			applyWechatMathStaticFlow(mathPlan, {
				cloneRoot: finalized,
				gate: createMathStaticFlowGate(conversion, signal, isCurrent),
			});
		}
		svgIntegration.applyPlan();
		assertTaskCheckboxStaticOwners(sourceTaskInputs, finalized);
		assertTaskCheckboxStaticFlowAllocationsForRoot(finalized);
		assertHeadingEmptyPseudoFlows(headingFlowCollector.expectations, finalized);
		throwIfBackgroundPreparationAborted(signal);
		markupTimings.markupPreparation.finish("success");
		return finalized;
	} catch (error: unknown) {
		markupTimings.inlineStyles.finish("error");
		markupTimings.markupPreparation.finish("error");
		throw error;
	} finally {
		taskGeometry?.cleanup();
	}
}

export function createMarkupSynchronously(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
): HTMLElement | null {
	const mathCapture = sourceAdmission
		? null
		: captureWechatMathSourceAdmissionSynchronously(
				preview,
				runtime,
				true,
				undefined,
				isCurrent,
				hasWechatMathStaticFlowCandidate(preview)
					? preparedDimensionGeometrySignature(
							preview,
							runtime,
							dimensionSemantics,
						)
					: "",
			);
	const effectiveSourceAdmission =
		sourceAdmission ?? mathCapture?.sourceAdmission ?? null;
	const effectiveMathFingerprint =
		mathSourceFingerprint || mathCapture?.sourceFingerprint || "";
	const effectiveMathGeometrySignature =
		mathRawDimensionGeometrySignature ||
		mathCapture?.rawDimensionGeometrySignature ||
		"";
	const effectiveMathRuntime = mathRuntime ?? mathCapture?.runtime ?? null;
	const clone = preview.cloneNode(true) as HTMLElement;
	const cloneIdentity = new Map<Element, Element>();
	const svgIntegration = createWechatSvgPortableIntegration(
		preview,
		clone,
		runtime,
	);
	const sourceTaskInputs = replaceTaskListCheckboxClones(
		sourceRoot,
		preview,
		clone,
		runtime,
	);
	svgIntegration.reconcileTaskCheckboxes(preview, clone);
	const fragmentIds = referencedFragmentIds(preview);
	const mathMlNodes = findKaTeXMathMl(clone);
	if (
		taskCheckboxGeometryScopes(sourceRoot, runtime).length &&
		!taskGeometryLease
	) {
		throw new Error("wechat-task-checkbox-geometry-lease-missing");
	}
	const taskGeometry = createTaskCheckboxGeometryContext(
		taskGeometryLease,
		runtime,
		dimensionSemantics,
	);
	const headingFlowCollector: HeadingEmptyPseudoFlowCollector = {
		expectations: [],
	};
	try {
		if (
			!inlineStylesSynchronously(
				preview,
				clone,
				runtime.getComputedStyle,
				true,
				runtime,
				preview,
				sourceRoot,
				dimensionSemantics,
				taskGeometry,
				headingFlowCollector,
				cloneIdentity,
			)
		)
			return null;
		removeOmittedNodes(clone, mathMlNodes, svgIntegration);
		const mathPlan = bindMathStaticFlowPlan(
			preview,
			clone,
			effectiveMathRuntime,
			effectiveSourceAdmission,
			effectiveMathFingerprint,
			effectiveMathGeometrySignature,
			cloneIdentity,
			svgIntegration,
			undefined,
			undefined,
			isCurrent,
		);
		svgIntegration.freezePlan(null);
		normalizeTaskCheckboxStaticFlowSynchronously(
			clone,
			runtime,
			taskGeometryLease,
		);
		const finalized = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.finalizeMarkup,
			{ mode: "sync" },
			() => finalizeMarkup(clone, fragmentIds),
		);
		if (mathPlan) {
			applyWechatMathStaticFlow(mathPlan, {
				cloneRoot: finalized,
				gate: createMathStaticFlowGate(undefined, undefined, isCurrent),
			});
		}
		svgIntegration.applyPlan();
		assertTaskCheckboxStaticOwners(sourceTaskInputs, finalized);
		assertTaskCheckboxStaticFlowAllocationsForRoot(finalized);
		assertHeadingEmptyPseudoFlows(headingFlowCollector.expectations, finalized);
		return finalized;
	} finally {
		taskGeometry?.cleanup();
	}
}

export async function serializeClipboardPayload(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	cache: BackgroundAssetCache,
	yieldToBrowser: SerializationYield | null = null,
	conversion?: WechatPngConversionContext,
	signal?: AbortSignal,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
): Promise<SerializedClipboardPayload> {
	throwIfBackgroundPreparationAborted(signal);
	const ownedDimensionSemantics =
		dimensionSemantics ??
		createDimensionSemanticsContext(preview, sourceRoot, runtime);
	try {
		ownedDimensionSemantics.refresh();
		const clone = await createMarkup(
			preview,
			runtime,
			cache,
			yieldToBrowser,
			conversion,
			signal,
			sourceRoot,
			ownedDimensionSemantics,
			taskGeometryLease,
			sourceAdmission,
			mathSourceFingerprint,
			mathRawDimensionGeometrySignature,
			mathRuntime,
			isCurrent,
		);
		throwIfBackgroundPreparationAborted(signal);
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		const html = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.outerHtml,
			{ mode: "sync" },
			() => {
				const html = clone.outerHTML;
				assertTaskCheckboxCaptionRuns(
					clone,
					EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
					"encoded",
				);
				return html;
			},
		);
		await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
		throwIfBackgroundPreparationAborted(signal);
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		const text = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.connectedPlainText,
			{ mode: "sync" },
			() => connectedPlainText(clone, preview),
		);
		await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
		throwIfBackgroundPreparationAborted(signal);
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		return { html, text };
	} finally {
		if (!dimensionSemantics) ownedDimensionSemantics.cleanup();
	}
}

export function serializeClipboardPayloadSynchronously(
	preview: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	sourceRoot: HTMLElement = preview,
	dimensionSemantics: WechatDimensionSemanticsContext | null = null,
	taskGeometryLease: TaskCheckboxGeometryLease | null = null,
	sourceAdmission: WechatMathSourceAdmissionResult | null = null,
	mathSourceFingerprint = "",
	mathRawDimensionGeometrySignature = "",
	mathRuntime: WechatMathStaticFlowRuntime | null = null,
	isCurrent?: () => boolean,
): SerializedClipboardPayload | null {
	const ownedDimensionSemantics =
		dimensionSemantics ??
		createDimensionSemanticsContext(preview, sourceRoot, runtime);
	try {
		ownedDimensionSemantics.refresh();
		const clone = createMarkupSynchronously(
			preview,
			runtime,
			sourceRoot,
			ownedDimensionSemantics,
			taskGeometryLease,
			sourceAdmission,
			mathSourceFingerprint,
			mathRawDimensionGeometrySignature,
			mathRuntime,
			isCurrent,
		);
		if (!clone) return null;
		assertTaskCheckboxCaptionRuns(
			clone,
			EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
			"encoded",
		);
		const html = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.outerHtml,
			{ mode: "sync" },
			() => {
				const html = clone.outerHTML;
				assertTaskCheckboxCaptionRuns(
					clone,
					EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(),
					"encoded",
				);
				return html;
			},
		);
		const text = runWechatSyncTiming(
			clone.ownerDocument.defaultView?.performance,
			WECHAT_COPY_TIMING_NAMES.connectedPlainText,
			{ mode: "sync" },
			() => connectedPlainText(clone, preview),
		);
		return { html, text };
	} finally {
		if (!dimensionSemantics) ownedDimensionSemantics.cleanup();
	}
}

export type SerializedClipboardPayload = Readonly<{
	html: string;
	text: string;
}>;
