import {
	assertPaint,
	canonicalSourceKey,
	frozen,
	MAX_SOURCE_KEY_NODES,
	paintFailure,
	SVG_NAMESPACE,
	supportedStyleValue,
	XHTML_NAMESPACE,
} from "./wechat-inline-pseudo-paint-core";
import type {
	WechatInlinePseudoPaintDetachedAttribute,
	WechatInlinePseudoPaintDetachedNode,
	WechatInlinePseudoPaintPlan,
	WechatInlinePseudoPaintSource,
	WechatInlinePseudoPaintSourceEvidence,
} from "./wechat-inline-pseudo-paint-types";

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
