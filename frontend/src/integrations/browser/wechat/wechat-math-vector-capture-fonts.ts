import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { FontFaceCandidate } from "./wechat-managed-fonts";
import {
	captureError,
	ELEMENT_NODE,
	isRecord,
	MATHML_NAMESPACE,
	RENDERER_STRUT,
	runtimeNumber,
	SHOW_TEXT,
	solidPaint,
	TEXT_NODE,
} from "./wechat-math-vector-capture-primitives";
import type { WechatMathVectorAtlas } from "./wechat-math-vector-scene";
import type { AcquiredPreviewGeometryMeasurement } from "./wechat-preview-geometry-cache";

export function textStream(root: Element): string {
	const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
	let value = "";
	let node = walker.nextNode();
	while (node) {
		value += node.textContent ?? "";
		node = walker.nextNode();
	}
	return value;
}

function isMathMlText(node: Text): boolean {
	let current: Element | null = node.parentElement;
	while (current) {
		if (
			current.classList.contains("katex-mathml") ||
			current.localName.toLowerCase() === "math" ||
			current.localName.toLowerCase() === "annotation" ||
			current.namespaceURI === MATHML_NAMESPACE
		)
			return true;
		current = current.parentElement;
	}
	return false;
}

export function isExactRendererStrut(
	sourceText: Text,
	measurementText: Text,
	lease: AcquiredPreviewGeometryMeasurement["lease"],
): boolean {
	if (
		sourceText.data !== RENDERER_STRUT ||
		measurementText.data !== RENDERER_STRUT
	)
		return false;
	const sourceS = sourceText.parentElement;
	const measurementS = measurementText.parentElement;
	const sourceR = sourceS?.parentElement;
	const measurementR = measurementS?.parentElement;
	const sourceT = sourceR?.parentElement;
	const measurementT = measurementR?.parentElement;
	if (
		!sourceS ||
		!measurementS ||
		!sourceR ||
		!measurementR ||
		!sourceT ||
		!measurementT
	)
		return false;
	if (
		!sourceS.classList.contains("vlist-s") ||
		sourceS.childNodes.length !== 1 ||
		sourceS.firstChild !== sourceText ||
		!measurementS.classList.contains("vlist-s") ||
		measurementS.childNodes.length !== 1 ||
		measurementS.firstChild !== measurementText ||
		!sourceR.classList.contains("vlist-r") ||
		!measurementR.classList.contains("vlist-r") ||
		!sourceT.classList.contains("vlist-t") ||
		!sourceT.classList.contains("vlist-t2") ||
		!measurementT.classList.contains("vlist-t") ||
		!measurementT.classList.contains("vlist-t2")
	)
		return false;
	return (
		lease.measurementFor(sourceS) === measurementS &&
		lease.sourceFor(measurementS) === sourceS &&
		lease.measurementFor(sourceR) === measurementR &&
		lease.sourceFor(measurementR) === sourceR &&
		lease.measurementFor(sourceT) === measurementT &&
		lease.sourceFor(measurementT) === sourceT
	);
}

export function codepoints(
	value: string,
): ReadonlyArray<Readonly<{ codepoint: number; end: number; start: number }>> {
	const result: Array<
		Readonly<{ codepoint: number; end: number; start: number }>
	> = [];
	for (let start = 0; start < value.length; ) {
		const codepoint = value.codePointAt(start);
		if (undefined === codepoint) throw captureError("source-text-mismatch");
		const end = start + (codepoint > 0xffff ? 2 : 1);
		result.push(Object.freeze({ codepoint, end, start }));
		start = end;
	}
	return result;
}

export function getPairedText(
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	sourceText: Text,
): Text {
	const sourceParent = sourceText.parentElement;
	if (!sourceParent) throw captureError("pairing-invalid");
	const measurementParent = lease.measurementFor(sourceParent);
	if (!measurementParent || lease.sourceFor(measurementParent) !== sourceParent)
		throw captureError("pairing-invalid");
	const index = Array.from(sourceParent.childNodes).indexOf(sourceText);
	const measurementNode = measurementParent.childNodes[index];
	if (
		!(measurementNode instanceof Text) ||
		measurementNode.data !== sourceText.data
	)
		throw captureError("source-text-mismatch");
	return measurementNode;
}

export function verifyPairTree(
	lease: AcquiredPreviewGeometryMeasurement["lease"],
	source: Node,
	measurement: Node,
): void {
	if (source.nodeType !== measurement.nodeType)
		throw captureError("pairing-invalid");
	if (source.nodeType === TEXT_NODE) {
		if (source.textContent !== measurement.textContent)
			throw captureError("source-text-mismatch");
		return;
	}
	if (
		source.nodeType !== ELEMENT_NODE ||
		measurement.nodeType !== ELEMENT_NODE
	) {
		if (source.nodeValue !== measurement.nodeValue)
			throw captureError("pairing-invalid");
		return;
	}
	const sourceElement = source as Element;
	const measurementElement = measurement as Element;
	if (
		sourceElement.localName !== measurementElement.localName ||
		sourceElement.namespaceURI !== measurementElement.namespaceURI ||
		lease.measurementFor(sourceElement) !== measurementElement ||
		lease.sourceFor(measurementElement) !== sourceElement
	)
		throw captureError("pairing-invalid");
	const sourceChildren = Array.from(source.childNodes);
	const measurementChildren = Array.from(measurement.childNodes);
	if (sourceChildren.length !== measurementChildren.length)
		throw captureError("pairing-invalid");
	sourceChildren.forEach((child, index) => {
		const paired = measurementChildren[index];
		if (!paired) throw captureError("pairing-invalid");
		verifyPairTree(lease, child, paired);
	});
}

export function sourceTextNodes(owner: Element): Text[] {
	const walker = owner.ownerDocument.createTreeWalker(owner, SHOW_TEXT);
	const nodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		const text = node as Text;
		if (!isMathMlText(text)) nodes.push(text);
		node = walker.nextNode();
	}
	return nodes;
}

function normalizeFamily(value: unknown): string {
	if ("string" !== typeof value) return "";
	const first = value.split(",")[0]?.trim() ?? "";
	return first
		.replace(/^("|')(.*)\1$/u, "$2")
		.trim()
		.toLowerCase();
}

function normalizeDescriptor(
	value: unknown,
	property: "font-style" | "font-weight" | "font-stretch",
): string {
	const normalized =
		"string" === typeof value ? value.trim().toLowerCase() : "";
	if (property === "font-weight") {
		if (!normalized || normalized === "normal") return "400";
		if (normalized === "bold") return "700";
	}
	if (property === "font-stretch") {
		if (!normalized || normalized === "normal" || normalized === "100%")
			return "normal";
	}
	return normalized || "normal";
}

function descriptor(face: FontFaceCandidate, property: string): string {
	const prefix = `${property}:`;
	return (
		face.descriptors
			.find((item) => item.trim().toLowerCase().startsWith(prefix))
			?.slice(prefix.length)
			.trim() ?? ""
	);
}

function basename(value: string): string {
	const withoutQuery = value.split(/[?#]/u)[0] ?? value;
	const slash = withoutQuery.lastIndexOf("/");
	return (
		slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery
	).toLowerCase();
}

function fontStem(value: string): string {
	return basename(value).replace(/\.[a-z0-9]+$/iu, "");
}

export function validateAtlas(atlas: WechatMathVectorAtlas): void {
	if (
		atlas?.schema !== "easymde-katex-glyph-atlas/1" ||
		atlas.serialization?.coordinateSystem !== "font-units-y-up" ||
		atlas.serialization?.decimalPlaces !== 6 ||
		atlas.serialization?.flipY !== false ||
		atlas.serialization?.optimize !== false ||
		!Array.isArray(atlas.fonts)
	)
		throw captureError("atlas-invalid");
}

function atlasFontForFace(
	face: FontFaceCandidate,
	atlas: WechatMathVectorAtlas,
): WechatMathVectorAtlas["fonts"][number] {
	const sourceNames = face.sources.map((source) => basename(source.url));
	const sourceStems = face.sources.map((source) => fontStem(source.url));
	const matches = atlas.fonts.filter((font) => {
		const file = basename(font.file);
		const stem = fontStem(font.file);
		return (
			sourceNames.includes(file) ||
			sourceNames.some(
				(source) => source.endsWith(file) || file.endsWith(source),
			) ||
			sourceStems.includes(stem)
		);
	});
	if (matches.length !== 1) throw captureError("font-face-missing");
	const font = matches[0];
	if (
		!font?.file ||
		!Number.isInteger(font.unitsPerEm) ||
		font.unitsPerEm <= 0 ||
		!Array.isArray(font.cmap) ||
		!Array.isArray(font.glyphs)
	) {
		throw captureError("atlas-invalid");
	}
	const glyphIds = new Set<number>();
	for (const glyph of font.glyphs) {
		if (
			!isRecord(glyph) ||
			"number" !== typeof glyph.id ||
			!Number.isInteger(glyph.id) ||
			glyphIds.has(glyph.id)
		)
			throw captureError("atlas-invalid");
		glyphIds.add(glyph.id);
	}
	const cmap = new Map<number, number>();
	for (const entry of font.cmap) {
		if (
			!isRecord(entry) ||
			!Number.isInteger(entry.codepoint) ||
			!Number.isInteger(entry.glyphId)
		) {
			throw captureError("atlas-invalid");
		}
		const codepoint = entry.codepoint;
		const glyphId = entry.glyphId;
		if (
			"number" !== typeof codepoint ||
			"number" !== typeof glyphId ||
			cmap.has(codepoint) ||
			!glyphIds.has(glyphId)
		)
			throw captureError("atlas-invalid");
		cmap.set(codepoint, glyphId);
	}
	return font;
}

function registeredFontFaces(
	document: Document,
): readonly Record<string, unknown>[] {
	const fonts = (document as Document & { fonts?: unknown }).fonts;
	if (!fonts || ("object" !== typeof fonts && "function" !== typeof fonts))
		return [];
	try {
		if (Symbol.iterator in Object(fonts))
			return Array.from(fonts as Iterable<unknown>).filter(isRecord);
	} catch {
		// The collection is an admission witness. An unreadable collection fails at the caller.
	}
	const result: Record<string, unknown>[] = [];
	const forEach = (fonts as { forEach?: unknown }).forEach;
	if ("function" === typeof forEach) {
		(forEach as (callback: (value: unknown) => void) => void).call(
			fonts,
			(value) => {
				if (isRecord(value)) result.push(value);
			},
		);
	}
	return result;
}

function assertFontTransformChain(
	measurementText: Text,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
): void {
	let current = measurementText.parentElement;
	while (current) {
		const transform = runtime
			.getComputedStyle(current)
			.getPropertyValue("transform")
			.trim()
			.toLowerCase();
		if (transform && transform !== "none")
			throw captureError("font-transform-unsupported");
		if (current === measurementRoot) return;
		current = current.parentElement;
	}
	throw captureError("pairing-invalid");
}

export function fontForText(
	measurementText: Text,
	measurementRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
	managedFaces: readonly FontFaceCandidate[],
	atlas: WechatMathVectorAtlas,
): {
	face: FontFaceCandidate;
	font: WechatMathVectorAtlas["fonts"][number];
	fontSize: number;
	fill: string;
} {
	const parent = measurementText.parentElement;
	if (!parent) throw captureError("font-face-missing");
	const style = runtime.getComputedStyle(parent);
	const family = normalizeFamily(style.getPropertyValue("font-family"));
	const expectedStyle = normalizeDescriptor(
		style.getPropertyValue("font-style"),
		"font-style",
	);
	const expectedWeight = normalizeDescriptor(
		style.getPropertyValue("font-weight"),
		"font-weight",
	);
	const expectedStretch = normalizeDescriptor(
		style.getPropertyValue("font-stretch"),
		"font-stretch",
	);
	assertFontTransformChain(measurementText, measurementRoot, runtime);
	const variation = style
		.getPropertyValue("font-variation-settings")
		.trim()
		.toLowerCase();
	if (variation && variation !== "normal" && variation !== "none")
		throw captureError("font-transform-unsupported");
	const candidates = managedFaces.filter(
		(face) =>
			face.familyKey === family &&
			face.sources.length > 0 &&
			normalizeDescriptor(descriptor(face, "font-style"), "font-style") ===
				expectedStyle &&
			normalizeDescriptor(descriptor(face, "font-weight"), "font-weight") ===
				expectedWeight &&
			normalizeDescriptor(descriptor(face, "font-stretch"), "font-stretch") ===
				expectedStretch,
	);
	if (candidates.length !== 1)
		throw captureError(
			candidates.length ? "font-face-ambiguous" : "font-face-missing",
		);
	const face = candidates[0];
	if (!face) throw captureError("font-face-missing");
	const witnesses = registeredFontFaces(runtime.document).filter(
		(registered) =>
			registered.status === "loaded" &&
			normalizeFamily(registered.family) === family &&
			normalizeDescriptor(registered.style, "font-style") === expectedStyle &&
			normalizeDescriptor(registered.weight, "font-weight") ===
				expectedWeight &&
			normalizeDescriptor(registered.stretch, "font-stretch") ===
				expectedStretch,
	);
	if (!witnesses.length) throw captureError("font-face-unloaded");
	if (witnesses.length !== 1) throw captureError("font-face-ambiguous");
	const font = atlasFontForFace(face, atlas);
	const fontSizeMatch = /^(?:[+-]?\d+(?:\.\d*)?|[+-]?\.\d+)px$/iu.exec(
		style.getPropertyValue("font-size").trim(),
	);
	if (!fontSizeMatch) throw captureError("font-face-missing");
	const fontSize = Number.parseFloat(fontSizeMatch[0]);
	if (!Number.isFinite(fontSize) || fontSize <= 0)
		throw captureError("font-face-missing");
	const color =
		style.getPropertyValue("color").trim() ||
		style.getPropertyValue("fill").trim();
	return {
		face,
		fill: solidPaint(color),
		font,
		fontSize: runtimeNumber(fontSize, "font-face-missing"),
	};
}

export function codepointMap(
	font: WechatMathVectorAtlas["fonts"][number],
): Map<number, number> {
	const map = new Map<number, number>();
	for (const entry of font.cmap) map.set(entry.codepoint, entry.glyphId);
	return map;
}
