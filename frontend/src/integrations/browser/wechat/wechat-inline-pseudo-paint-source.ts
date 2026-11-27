import {
	assertAnimationProof,
	circleRadiusEvidence,
	readCircle,
	readMaskSource,
} from "./wechat-inline-pseudo-paint-admission";
import {
	assertPaint,
	attributeSnapshot,
	canonicalSourceKey,
	canonicalSourceKeyParts,
	frozen,
	MASK_PROPERTY_NAMES,
	maskValues,
	OWNER_PROPERTIES,
	PSEUDO_ELEMENT,
	PSEUDO_PROPERTIES,
	styleKeyEntries,
	styleSnapshot,
	supportedStyleValue,
	wholeSourceKeyParts,
} from "./wechat-inline-pseudo-paint-core";
import type {
	WechatInlinePseudoPaintCapabilities,
	WechatInlinePseudoPaintCssCapabilities,
	WechatInlinePseudoPaintRawCapture,
	WechatInlinePseudoPaintReaderInput,
	WechatInlinePseudoPaintSource,
	WechatInlinePseudoPaintSourceEvidence,
	WechatInlinePseudoPaintSourcePaint,
} from "./wechat-inline-pseudo-paint-types";
import { pseudoContent } from "./wechat-pseudo-content";

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
