import {
	assertDetachedTarget,
	assertPaint,
	attributeSnapshot,
	frozen,
	paintFailure,
	SVG_NAMESPACE,
} from "./wechat-inline-pseudo-paint-core";
import type {
	WechatInlinePseudoLinkBinding,
	WechatInlinePseudoPaintAttributeSnapshot,
	WechatInlinePseudoPaintDetachedBatch,
	WechatInlinePseudoPaintDetachedNode,
	WechatInlinePseudoPaintMarkerBinding,
	WechatInlinePseudoPaintOwnerFinalInvariant,
} from "./wechat-inline-pseudo-paint-types";
import { replaceDeclarations } from "./wechat-style-declarations";

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
