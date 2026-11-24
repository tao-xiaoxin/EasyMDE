import {
	EXPORT_TEXT_NORMALIZATIONS,
	GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
	HEADING_EMPTY_PSEUDO_FLOW_CLONES,
	HIDDEN_NODES,
	INLINE_TEXT_MARKER_CLONES,
	isBlockMathClone,
	isKaTeXVisualClone,
	KATEX_VISUAL_ROOTS,
	MERMAID_FOREIGN_OBJECTS,
	MERMAID_SVG_ROOTS,
	TASK_LIST_CHECKBOX_CLONES,
	THEME_HEADING_SUFFIX_CLONES,
	THEME_IMAGE_CLONES,
	WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS,
	WECHAT_PNG_GENERATED_IMAGES,
	WECHAT_PNG_VISUAL_CLONES,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import { normalizePortableTables } from "./wechat-list-table-layout";
import {
	applyNestedOrdinaryListProjection,
	type WechatNestedListProjectionCapture,
} from "./wechat-nested-list-projection";
import {
	expandMermaidLabelGeometry,
	MERMAID_LABEL_LAYOUT_DECLARATIONS,
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
import { normalizePortableMedia } from "./wechat-portable-media";
import { generatedHeadingAfterContentIsEmpty } from "./wechat-pseudo-elements";
import { replaceDeclarations } from "./wechat-style-declarations";
import { appendDeclarations } from "./wechat-style-policy";
import type { WechatSvgPortableIntegration } from "./wechat-svg-portable-integration";
import {
	applyWechatTableNativeGridForSerialization,
	type WechatTableNativeGridSerializationPlan,
} from "./wechat-table-native-grid-integration";
import {
	assertTaskCheckboxCaptionRuns,
	registerTaskCheckboxCaptionNormalizations,
	TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS,
	TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES,
	TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
	TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT,
	TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS,
	TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS,
} from "./wechat-task-caption";
import {
	normalizePortableTaskListMarkers,
	projectCompleteTaskListStructures,
} from "./wechat-task-list-projection";
import {
	normalizeTaskCheckboxTransport,
	restoreTaskListCheckboxOwnerState,
} from "./wechat-task-paint";

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
		WECHAT_STRUCTURE_REPLACEMENTS.set(clone, root);
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
		WECHAT_STRUCTURE_REPLACEMENTS.set(element, section);
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
			parent &&
			WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS.has(parent) &&
			value === "\u2060" &&
			parent.childNodes.length === 1
		)
			return;
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

export function removeOmittedNodes(
	clone: HTMLElement,
	mathMlNodes: ReadonlySet<Element>,
	svgIntegration: WechatSvgPortableIntegration,
	omittedSources: Set<Element>,
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
			omittedSources.add(source);
			for (const descendant of Array.from(source.querySelectorAll("*")))
				omittedSources.add(descendant);
			svgIntegration.omitSubtree(source, element);
			element.remove();
		}
	}
}

export function finalizeMarkup(
	clone: HTMLElement,
	fragmentIds: Set<string>,
	tableNativeGridPlans: readonly WechatTableNativeGridSerializationPlan[] = [],
	nestedListProjectionCaptures: readonly WechatNestedListProjectionCapture[] = [],
	cloneIdentity: ReadonlyMap<Element, Element> = new Map(),
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
	applyNestedOrdinaryListProjection(
		normalized,
		nestedListProjectionCaptures,
		cloneIdentity,
	);
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
	applyWechatTableNativeGridForSerialization(normalized, tableNativeGridPlans);
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
