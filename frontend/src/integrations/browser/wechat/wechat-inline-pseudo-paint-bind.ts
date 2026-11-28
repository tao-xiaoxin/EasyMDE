import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import {
	assertDetachedTarget,
	assertPaint,
	canonicalSourceKey,
	frozen,
	XHTML_NAMESPACE,
} from "./wechat-inline-pseudo-paint-core";
import type {
	WechatInlinePseudoLinkBinding,
	WechatInlinePseudoPaintDetachedBatch,
	WechatInlinePseudoPaintMarkerBinding,
	WechatInlinePseudoPaintPlan,
	WechatInlinePseudoPaintSource,
	WechatInlinePseudoPaintSourceEvidence,
} from "./wechat-inline-pseudo-paint-types";

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
