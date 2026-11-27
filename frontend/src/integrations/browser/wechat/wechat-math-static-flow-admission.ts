import {
	animationIntersects,
	CAPTURE_STYLE_PROPERTIES,
	deepFreezePlainRecord,
	elementKey,
	finitePixel,
	flowError,
	freezeMap,
	GEOMETRY_QUANTUM,
	HOLDER_EDGE_PROPERTIES,
	LOGICAL_INSETS,
	near,
	nodeEstablishesACB,
	nodeEvidenceSignature,
	nodeHasPaintedBorder,
	nodeSafeLayoutAndPaint,
	nodeSafePseudo,
	nodeStyleAllZero,
	nodeStyleIs,
	nodeStylePixels,
	nodeStyleValue,
	nodeStyleZero,
	nodeSvgOverflowIsSafe,
	nodeTypedKeywordAuto,
	nodeTypedPercent,
	nodeTypedPixel,
	nodeVisibleOverflow,
	PHYSICAL_INSETS,
	PSEUDO_ELEMENTS,
	pseudoContentIsAbsent,
	ROW_HORIZONTAL_MARGIN_PROPERTIES,
	ROW_NON_HORIZONTAL_EDGE_PROPERTIES,
	rectIsFinite,
	SVG_NAMESPACE,
	sameRect,
	TYPED_DIMENSION_PROPERTIES,
	typedToken,
	type WechatMathFrozenNode,
	type WechatMathRectEvidence,
	type WechatMathSourceAdmissionResult,
	type WechatMathSourceAdmissionWitness,
	type WechatMathSourceEmptyTransportAdmission,
	type WechatMathSourceGroupAdmission,
	type WechatMathSourceRowAdmission,
	type WechatMathSourceSvgAdmission,
	type WechatMathStaticFlowRuntime,
	type WechatMathTopologyContext,
	XHTML_NAMESPACE,
} from "./wechat-math-static-flow-model";

type TopologyInterval = Readonly<{ end: number; start: number }>;
type SafetyEvent = Readonly<{
	element: Element;
	nearestACB: Element | null;
}>;
type TopologySafetySummary = Readonly<{
	firstFixed: SafetyEvent | null;
	firstPseudo: SafetyEvent | null;
}>;
type TopologyIndex = Readonly<{
	absoluteByACB: ReadonlyMap<Element, readonly Element[]>;
	intervals: ReadonlyMap<Element, TopologyInterval>;
	nodes: ReadonlyMap<Element, WechatMathFrozenNode>;
	rowMembers: ReadonlyMap<Element, readonly Element[]>;
	safety: ReadonlyMap<Element, TopologySafetySummary>;
}>;

function evaluateSourceEmptyTransport(
	node: WechatMathFrozenNode,
): WechatMathSourceEmptyTransportAdmission | null {
	if (
		node.namespaceURI !== XHTML_NAMESPACE ||
		node.localName !== "span" ||
		node.orderedChildren.length !== 0 ||
		node.hasChildNodes ||
		node.animationIntersects ||
		!nodeSafePseudo(node) ||
		!nodeSafeLayoutAndPaint(node) ||
		!nodeVisibleOverflow(node) ||
		!nodeHasPaintedBorder(node) ||
		!nodeStyleIs(node, "display", "inline-block") ||
		!nodeStyleIs(node, "position", "static") ||
		!nodeStyleIs(node, "vertical-align", "baseline") ||
		!nodeStyleIs(node, "writing-mode", "horizontal-tb")
	)
		return null;
	const sourceBoxSizing = nodeStyleValue(node, "box-sizing");
	if (sourceBoxSizing !== "content-box" && sourceBoxSizing !== "border-box")
		return null;
	const width = nodeStylePixels(node, "width");
	const height = nodeStylePixels(node, "height");
	if (
		null === width ||
		null === height ||
		width < 0 ||
		height < 0 ||
		!rectIsFinite(node.rectEvidence.rawRect)
	)
		return null;
	return Object.freeze({ source: node.element, sourceBoxSizing });
}

function firstSafetyEvent(
	current: SafetyEvent | null,
	candidate: SafetyEvent | null,
	order: ReadonlyMap<Element, TopologyInterval>,
): SafetyEvent | null {
	if (!current) return candidate;
	if (!candidate) return current;
	const currentInterval = order.get(current.element);
	const candidateInterval = order.get(candidate.element);
	if (!currentInterval || !candidateInterval) return current;
	return candidateInterval.start < currentInterval.start ? candidate : current;
}

function indexTopology(context: WechatMathTopologyContext): TopologyIndex {
	let timer = 0;
	const intervals = new Map<Element, TopologyInterval>();
	const nodes = new Map<Element, WechatMathFrozenNode>();
	const rowMembers = new Map<Element, Element[]>();
	const safety = new Map<Element, TopologySafetySummary>();
	const absoluteByACB = new Map<Element, Element[]>();
	const visited = new Set<Element>();

	function walk(
		element: Element,
		inheritedRow: Element | null,
		inheritedACB: Element | null,
	): void {
		if (visited.has(element)) return;
		visited.add(element);
		const node = context.getNode(element);
		if (!node) throw flowError("node-unobserved");
		nodes.set(element, node);
		const start = ++timer;
		const parentNode = node.parent ? nodes.get(node.parent) : undefined;
		const isRowRoot = Boolean(
			parentNode?.classList.has("vlist") &&
				node.namespaceURI === XHTML_NAMESPACE &&
				node.localName === "span" &&
				nodeStyleIs(node, "display", "block") &&
				nodeStyleIs(node, "position", "relative"),
		);
		const row = isRowRoot ? element : inheritedRow;
		if (row) {
			const members = rowMembers.get(row) ?? [];
			members.push(element);
			rowMembers.set(row, members);
		}
		const nearestACB = isRowRoot ? element : inheritedACB;
		const ownEvent: SafetyEvent = { element, nearestACB };
		if ("absolute" === node.styles.position && nearestACB) {
			const candidates = absoluteByACB.get(nearestACB) ?? [];
			candidates.push(element);
			absoluteByACB.set(nearestACB, candidates);
		}
		const ownFixed = "fixed" === node.styles.position ? ownEvent : null;
		const ownPseudo = PSEUDO_ELEMENTS.some(
			(pseudo) => !pseudoContentIsAbsent(node.pseudos[pseudo]?.content ?? ""),
		)
			? ownEvent
			: null;
		const childACB = nodeEstablishesACB(node) ? element : nearestACB;

		for (const child of node.orderedChildren) {
			walk(child, row, childACB);
		}

		const end = ++timer;
		intervals.set(element, { end, start });
		let firstFixed = ownFixed;
		let firstPseudo = ownPseudo;
		for (const child of node.orderedChildren) {
			const childSummary = safety.get(child);
			if (!childSummary) continue;
			firstFixed = firstSafetyEvent(
				firstFixed,
				childSummary.firstFixed,
				intervals,
			);
			firstPseudo = firstSafetyEvent(
				firstPseudo,
				childSummary.firstPseudo,
				intervals,
			);
		}
		safety.set(element, { firstFixed, firstPseudo });
	}

	walk(context.sourceRoot, null, null);
	return {
		absoluteByACB,
		intervals,
		nodes,
		rowMembers,
		safety,
	};
}

function nodeContains(
	intervals: ReadonlyMap<Element, TopologyInterval>,
	ancestor: Element,
	descendant: Element,
): boolean {
	const a = intervals.get(ancestor);
	const d = intervals.get(descendant);
	if (!a || !d) return false;
	return d.start >= a.start && d.end <= a.end;
}

function evaluateSourceSvgTransition(
	svgEl: SVGSVGElement,
	rowEl: Element,
	index: TopologyIndex,
): Readonly<{
	evidence: string;
	reason: string | null;
	transition: WechatMathSourceSvgAdmission | null;
}> {
	const svgNode = index.nodes.get(svgEl);
	if (!svgNode)
		return { evidence: "svg-missing", reason: "svg-holder", transition: null };
	const holderEl = svgNode.parent;
	if (!holderEl)
		return {
			evidence: "holder-missing",
			reason: "svg-holder",
			transition: null,
		};
	const holderNode = index.nodes.get(holderEl);
	if (
		!holderNode ||
		holderNode.namespaceURI !== XHTML_NAMESPACE ||
		holderNode.localName !== "span"
	) {
		return {
			evidence: "holder-missing",
			reason: "svg-holder",
			transition: null,
		};
	}
	if (
		holderNode.orderedChildren.length !== 1 ||
		holderNode.orderedChildren[0] !== svgEl
	) {
		return {
			evidence: "holder-children",
			reason: "svg-holder",
			transition: null,
		};
	}
	if (holderNode.holderTextFlag) {
		return { evidence: "holder-text", reason: "svg-holder", transition: null };
	}

	const sourceChain: Element[] = [holderEl];
	let chainSource: Element = holderEl;
	while (chainSource !== rowEl) {
		const parentEl = index.nodes.get(chainSource)?.parent ?? null;
		if (!parentEl || !nodeContains(index.intervals, rowEl, parentEl)) {
			return { evidence: "identity", reason: "svg-identity", transition: null };
		}
		chainSource = parentEl;
		sourceChain.push(chainSource);
	}

	const serialized = `${nodeEvidenceSignature(holderNode)}|${nodeEvidenceSignature(svgNode)}`;
	if (holderNode.animationIntersects || svgNode.animationIntersects) {
		return { evidence: serialized, reason: "svg-animation", transition: null };
	}
	if (!nodeSafePseudo(holderNode) || !nodeSafePseudo(svgNode)) {
		return { evidence: serialized, reason: "svg-pseudo", transition: null };
	}
	if (!nodeSafeLayoutAndPaint(holderNode) || !nodeVisibleOverflow(holderNode)) {
		return { evidence: serialized, reason: "svg-safety", transition: null };
	}
	if (!nodeSafeLayoutAndPaint(svgNode) || !nodeSvgOverflowIsSafe(svgNode)) {
		return { evidence: serialized, reason: "svg-safety", transition: null };
	}
	if (
		!nodeStyleIs(holderNode, "display", "inline-block") ||
		!nodeStyleIs(holderNode, "position", "static")
	) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (!nodeStyleIs(holderNode, "vertical-align", "baseline")) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (!nodeStyleAllZero(holderNode, HOLDER_EDGE_PROPERTIES)) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	const holderWidth = nodeStylePixels(holderNode, "width");
	const holderHeight = nodeStylePixels(holderNode, "height");
	const holderTypedWidth = nodeTypedPixel(holderNode, "width");
	const holderTypedHeight = nodeTypedPixel(holderNode, "height");
	if (
		null === holderWidth ||
		null === holderHeight ||
		holderWidth <= 0 ||
		holderHeight <= 0 ||
		null === holderTypedWidth ||
		null === holderTypedHeight ||
		!near(holderWidth, holderTypedWidth, GEOMETRY_QUANTUM) ||
		!near(holderHeight, holderTypedHeight, GEOMETRY_QUANTUM) ||
		!rectIsFinite(holderNode.rectEvidence.rawRect) ||
		!near(
			holderNode.rectEvidence.rawRect.width,
			holderWidth,
			GEOMETRY_QUANTUM,
		) ||
		!near(
			holderNode.rectEvidence.rawRect.height,
			holderHeight,
			GEOMETRY_QUANTUM,
		)
	) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (
		!nodeStyleIs(svgNode, "position", "absolute") ||
		!nodeStyleIs(svgNode, "display", "block")
	) {
		return { evidence: serialized, reason: "svg-holder", transition: null };
	}
	if (
		![...PHYSICAL_INSETS, ...LOGICAL_INSETS].every((property) =>
			nodeTypedKeywordAuto(svgNode, property),
		)
	) {
		return { evidence: serialized, reason: "svg-inset", transition: null };
	}
	if (!nodeStyleAllZero(svgNode, HOLDER_EDGE_PROPERTIES)) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	const svgWidth = nodeStylePixels(svgNode, "width");
	const svgHeight = nodeStylePixels(svgNode, "height");
	if (
		null === svgWidth ||
		null === svgHeight ||
		svgWidth <= 0 ||
		svgHeight <= 0 ||
		!near(svgWidth, holderWidth, GEOMETRY_QUANTUM) ||
		!near(svgHeight, holderHeight, GEOMETRY_QUANTUM)
	) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	const typedSvgWidth =
		nodeTypedPixel(svgNode, "width") ?? nodeTypedPixel(svgNode, "inline-size");
	const typedSvgHeight =
		nodeTypedPixel(svgNode, "height") ?? nodeTypedPixel(svgNode, "block-size");
	const percentSvgWidth =
		nodeTypedPercent(svgNode, "width") ??
		nodeTypedPercent(svgNode, "inline-size");
	const keywordSvgHeight =
		svgNode.typedTokens.height === "keyword:inherit" ||
		svgNode.typedTokens["block-size"] === "keyword:inherit";
	if (
		(null === typedSvgWidth &&
			!(
				null !== percentSvgWidth && near(percentSvgWidth, 100, GEOMETRY_QUANTUM)
			)) ||
		(null === typedSvgHeight && !keywordSvgHeight) ||
		(null !== typedSvgWidth &&
			!near(typedSvgWidth, holderWidth, GEOMETRY_QUANTUM)) ||
		(null !== typedSvgHeight &&
			!near(typedSvgHeight, holderHeight, GEOMETRY_QUANTUM))
	) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	if (
		!sameRect(svgNode.rectEvidence.rawRect, holderNode.rectEvidence.rawRect) ||
		!rectIsFinite(svgNode.rectEvidence.rawRect)
	) {
		return { evidence: serialized, reason: "svg-geometry", transition: null };
	}
	return {
		evidence: serialized,
		reason: null,
		transition: Object.freeze({
			sourceChain: Object.freeze(sourceChain),
			sourceHolder: holderEl,
			sourceRow: rowEl,
			sourceSvg: svgEl,
		}),
	};
}

function evaluateSourceRow(
	rowEl: Element,
	groupEl: Element,
	index: TopologyIndex,
): Readonly<{
	evidence: string;
	reason: string | null;
	row: WechatMathSourceRowAdmission | null;
}> {
	const rowNode = index.nodes.get(rowEl);
	if (!rowNode)
		return { evidence: "row-missing", reason: "row-shape", row: null };
	if (
		rowNode.namespaceURI !== XHTML_NAMESPACE ||
		"span" !== rowNode.localName ||
		rowNode.parent !== groupEl
	) {
		return { evidence: "row-shape", reason: "row-shape", row: null };
	}
	const serialized = nodeEvidenceSignature(rowNode);
	if (rowNode.animationIntersects)
		return { evidence: serialized, reason: "row-animation", row: null };
	if (!nodeSafePseudo(rowNode))
		return { evidence: serialized, reason: "row-pseudo", row: null };
	if (!nodeSafeLayoutAndPaint(rowNode) || !nodeVisibleOverflow(rowNode)) {
		return { evidence: serialized, reason: "row-safety", row: null };
	}
	if (
		!nodeStyleIs(rowNode, "display", "block") ||
		!nodeStyleIs(rowNode, "position", "relative") ||
		!["auto", "0px"].includes(nodeStyleValue(rowNode, "left")) ||
		!["auto", "0px"].includes(nodeStyleValue(rowNode, "right"))
	) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	if (!nodeTypedKeywordAuto(rowNode, "bottom")) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	if (
		!nodeStyleZero(rowNode, "height") ||
		!nodeStyleAllZero(rowNode, ROW_NON_HORIZONTAL_EDGE_PROPERTIES) ||
		!ROW_HORIZONTAL_MARGIN_PROPERTIES.every(
			(property) => null !== nodeStylePixels(rowNode, property),
		)
	) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	const rawTop = nodeStyleValue(rowNode, "top");
	if (!/^-(?:\d+(?:\.\d+)?|\.\d+)px$/iu.test(rawTop)) {
		return { evidence: serialized, reason: "row-top", row: null };
	}
	const top = finitePixel(rawTop);
	if (null === top || top >= 0) {
		return { evidence: serialized, reason: "row-top", row: null };
	}
	const typedTop = nodeTypedPixel(rowNode, "top");
	if (
		null === typedTop ||
		!Number.isFinite(typedTop) ||
		typedTop >= 0 ||
		!near(top, typedTop, GEOMETRY_QUANTUM)
	) {
		return { evidence: serialized, reason: "row-top", row: null };
	}
	const typedHeight = nodeTypedPixel(rowNode, "height");
	const typedBlockSize = nodeTypedPixel(rowNode, "block-size");
	if (
		(null === typedHeight || !near(typedHeight, 0, GEOMETRY_QUANTUM)) &&
		(null === typedBlockSize || !near(typedBlockSize, 0, GEOMETRY_QUANTUM))
	) {
		return { evidence: serialized, reason: "row-layout", row: null };
	}
	const pstrut = rowNode.orderedChildren.find((child) =>
		index.nodes.get(child)?.classList.has("pstrut"),
	);
	if (!pstrut) return { evidence: serialized, reason: "pstrut", row: null };
	const pstrutNode = index.nodes.get(pstrut);
	if (!pstrutNode) return { evidence: serialized, reason: "pstrut", row: null };
	const pstrutSerialized = `${serialized}|${nodeEvidenceSignature(pstrutNode)}`;
	if (pstrutNode.animationIntersects)
		return {
			evidence: pstrutSerialized,
			reason: "pstrut-animation",
			row: null,
		};
	if (!nodeSafePseudo(pstrutNode))
		return { evidence: pstrutSerialized, reason: "pstrut-pseudo", row: null };
	if (!nodeSafeLayoutAndPaint(pstrutNode))
		return { evidence: pstrutSerialized, reason: "pstrut", row: null };
	const pstrutHeight = nodeStylePixels(pstrutNode, "height");
	const pstrutTypedHeight = nodeTypedPixel(pstrutNode, "height");
	if (
		!nodeStyleIs(pstrutNode, "display", "inline-block") ||
		!["static", "relative"].includes(nodeStyleValue(pstrutNode, "position")) ||
		0 !== nodeStylePixels(pstrutNode, "width") ||
		null === pstrutHeight ||
		pstrutHeight <= 0 ||
		null === pstrutTypedHeight ||
		!near(pstrutHeight, pstrutTypedHeight, GEOMETRY_QUANTUM) ||
		!rectIsFinite(pstrutNode.rectEvidence.rawRect) ||
		pstrutNode.rectEvidence.rawRect.height <= 0
	) {
		return { evidence: pstrutSerialized, reason: "pstrut", row: null };
	}
	return {
		evidence: pstrutSerialized,
		reason: null,
		row: Object.freeze({
			pstrutSource: pstrut,
			rawTop,
			source: rowEl,
			top,
		}),
	};
}

function evaluateSourceGroup(
	groupEl: Element,
	context: WechatMathTopologyContext,
	index: TopologyIndex,
): WechatMathSourceGroupAdmission {
	const groupNode = index.nodes.get(groupEl);
	if (!groupNode)
		return {
			evidence: "group-missing",
			reason: "group-layout",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};

	const parentEl =
		groupNode.parent ?? context.ancestorParents?.get(groupEl) ?? null;
	const parentClassList = parentEl
		? (index.nodes.get(parentEl)?.classList ??
			context.ancestorClassLists?.get(parentEl))
		: undefined;
	const grandparentEl = parentEl
		? (index.nodes.get(parentEl)?.parent ??
			context.ancestorParents?.get(parentEl) ??
			null)
		: null;
	const grandparentClassList = grandparentEl
		? (index.nodes.get(grandparentEl)?.classList ??
			context.ancestorClassLists?.get(grandparentEl))
		: undefined;

	if (
		groupNode.namespaceURI !== XHTML_NAMESPACE ||
		"span" !== groupNode.localName ||
		!parentClassList?.has("vlist-r") ||
		!grandparentClassList?.has("vlist-t")
	) {
		return {
			evidence: "group-shape",
			reason: "group-layout",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};
	}

	const groupSerialized = nodeEvidenceSignature(groupNode);
	if (
		!nodeStyleIs(groupNode, "display", "table-cell") ||
		!nodeStyleIs(groupNode, "position", "relative")
	) {
		return {
			evidence: groupSerialized,
			reason: "group-layout",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};
	}
	if (groupNode.animationIntersects) {
		return {
			evidence: groupSerialized,
			reason: "group-animation",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};
	}
	if (!nodeSafePseudo(groupNode)) {
		return {
			evidence: groupSerialized,
			reason: "group-pseudo",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};
	}
	if (!nodeSafeLayoutAndPaint(groupNode) || !nodeVisibleOverflow(groupNode)) {
		return {
			evidence: groupSerialized,
			reason: "group-safety",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};
	}

	const rowSources = groupNode.orderedChildren.filter(
		(child) => index.nodes.get(child)?.namespaceURI === XHTML_NAMESPACE,
	);
	if (
		!rowSources.length ||
		rowSources.length !== groupNode.orderedChildren.length
	) {
		return {
			evidence: groupSerialized,
			reason: "group-shape",
			rows: [],
			emptyTransport: [],
			source: groupEl,
			svgTransitions: [],
		};
	}

	const rows: WechatMathSourceRowAdmission[] = [];
	const rowEvidence: string[] = [];
	for (const rowSource of rowSources) {
		const captured = evaluateSourceRow(rowSource, groupEl, index);
		rowEvidence.push(captured.evidence);
		if (captured.reason || !captured.row) {
			return {
				evidence: [groupSerialized, ...rowEvidence].join("|"),
				reason: captured.reason ?? "row-shape",
				rows: [],
				emptyTransport: [],
				source: groupEl,
				svgTransitions: [],
			};
		}
		rows.push(captured.row);
	}

	const emptyTransport = rows.flatMap((row) =>
		(index.rowMembers.get(row.source) ?? [])
			.map((element) => {
				const node = index.nodes.get(element);
				return node ? evaluateSourceEmptyTransport(node) : null;
			})
			.filter(
				(admission): admission is WechatMathSourceEmptyTransportAdmission =>
					Boolean(admission),
			),
	);
	const emptyTransportEvidence = emptyTransport
		.map(({ source }) => {
			const node = index.nodes.get(source);
			return node ? nodeEvidenceSignature(node) : "empty-transport-missing";
		})
		.join("|");
	const svgTransitions: WechatMathSourceSvgAdmission[] = [];
	const svgEvidence: string[] = [];
	const seenSvg = new Set<Element>();
	const evidence = (): string =>
		[
			groupSerialized,
			...rowEvidence,
			emptyTransportEvidence,
			...svgEvidence,
		].join("|");
	const reject = (reason: string): WechatMathSourceGroupAdmission => ({
		evidence: evidence(),
		reason,
		rows: [],
		emptyTransport: [],
		source: groupEl,
		svgTransitions: [],
	});

	for (const row of rows) {
		const summary = index.safety.get(row.source);
		if (!summary) return reject("row-shape");

		// Pseudo checks are deliberately evaluated before position checks, matching
		// the original admission order while reading the indexed event once.
		const pseudoEvent = summary.firstPseudo;
		if (pseudoEvent) {
			const pseudoNode = index.nodes.get(pseudoEvent.element);
			if (!pseudoNode) return reject("row-pseudo");
			for (const pseudo of PSEUDO_ELEMENTS) {
				const pseudoContent = pseudoNode.pseudos[pseudo]?.content ?? "";
				if (pseudoContentIsAbsent(pseudoContent)) continue;
				const pseudoPosition = pseudoNode.pseudos[pseudo]?.position ?? "static";
				if (
					"fixed" === pseudoPosition ||
					("absolute" === pseudoPosition &&
						(pseudoEvent.element === row.source ||
							pseudoEvent.nearestACB === row.source))
				) {
					return reject("absolute-containing-block");
				}
				return reject("row-pseudo");
			}
		}

		const fixedEvent =
			summary.firstFixed?.element === row.source ? null : summary.firstFixed;
		const absoluteCandidates = index.absoluteByACB.get(row.source) ?? [];
		let absoluteIndex = 0;
		while (fixedEvent || absoluteIndex < absoluteCandidates.length) {
			const absolute = absoluteCandidates[absoluteIndex];
			const fixedStart = fixedEvent
				? index.intervals.get(fixedEvent.element)?.start
				: undefined;
			const absoluteStart = absolute
				? index.intervals.get(absolute)?.start
				: undefined;
			if (
				fixedEvent &&
				(undefined === absoluteStart ||
					(undefined !== fixedStart && fixedStart < absoluteStart))
			) {
				return reject("absolute-containing-block");
			}
			if (!absolute) break;
			absoluteIndex += 1;
			const node = index.nodes.get(absolute);
			if (!node) return reject("absolute-containing-block");
			if (node.namespaceURI !== SVG_NAMESPACE || "svg" !== node.localName) {
				return reject("absolute-containing-block");
			}
			if (seenSvg.has(absolute)) continue;
			seenSvg.add(absolute);
			const captured = evaluateSourceSvgTransition(
				absolute as SVGSVGElement,
				row.source,
				index,
			);
			svgEvidence.push(captured.evidence);
			if (captured.reason || !captured.transition)
				return reject(captured.reason ?? "svg-identity");
			svgTransitions.push(captured.transition);
		}
	}

	return {
		evidence: evidence(),
		reason: null,
		rows: Object.freeze(rows),
		emptyTransport: Object.freeze(emptyTransport),
		source: groupEl,
		svgTransitions: Object.freeze(svgTransitions),
	};
}

export function collectWechatMathLiveTopology(
	sourceRoot: Element,
	runtime: WechatMathStaticFlowRuntime,
): WechatMathTopologyContext {
	const animations = runtime.getAnimations();
	const nodeMap = new Map<Element, WechatMathFrozenNode>();
	const observedSequence: Element[] = [];

	const rootRect = runtime.getRect(sourceRoot) ?? {
		bottom: 0,
		height: 0,
		left: 0,
		right: 0,
		top: 0,
		width: 0,
	};

	function visit(element: Element): void {
		if (nodeMap.has(element)) return;
		observedSequence.push(element);

		const style = runtime.getComputedStyle(element);
		const styles = Object.freeze(
			Object.fromEntries(
				CAPTURE_STYLE_PROPERTIES.map((property) => [
					property,
					style.getPropertyValue(property).trim().toLowerCase(),
				]),
			),
		);

		let typedTokens: Readonly<Record<string, string>> = Object.freeze({});
		try {
			const typedMap = runtime.getTypedStyleMap(element);
			typedTokens = Object.freeze(
				Object.fromEntries(
					TYPED_DIMENSION_PROPERTIES.map((property) => [
						property,
						typedToken(typedMap.get(property)),
					]),
				),
			);
		} catch {
			// Fall through
		}

		const pseudos = Object.freeze(
			Object.fromEntries(
				PSEUDO_ELEMENTS.map((pseudo) => {
					const pseudoStyle = runtime.getComputedStyle(element, pseudo);
					const content = pseudoStyle.getPropertyValue("content").trim();
					const position =
						pseudoStyle.getPropertyValue("position").trim().toLowerCase() ||
						"static";
					return [pseudo, Object.freeze({ content, position })];
				}),
			) as Record<
				(typeof PSEUDO_ELEMENTS)[number],
				Readonly<{ content: string; position: string }>
			>,
		);

		const rawRect = runtime.getRect(element) ?? {
			bottom: 0,
			height: 0,
			left: 0,
			right: 0,
			top: 0,
			width: 0,
		};
		const rectEvidence: WechatMathRectEvidence = Object.freeze({
			epochId: 0,
			rawRect,
			rootRectAtEpoch: rootRect,
		});

		const hasAnimation = animationIntersects(element, animations);

		const holderTextFlag = Array.from(element.childNodes).some(
			(node) =>
				node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
		);
		const hasChildNodes = element.childNodes.length !== 0;

		const orderedChildren = Object.freeze(Array.from(element.children));
		const classList = Object.freeze(
			new Set(Array.from(element.classList ?? [])),
		);

		const node: WechatMathFrozenNode = Object.freeze({
			animationIntersects: hasAnimation,
			key: elementKey(element),
			classList,
			element,
			hasChildNodes,
			holderTextFlag,
			localName: element.localName.toLowerCase(),
			namespaceURI: element.namespaceURI ?? "",
			orderedChildren,
			parent: element.parentElement,
			pseudos,
			rectEvidence,
			styles,
			typedTokens,
		});

		nodeMap.set(element, node);

		for (const child of orderedChildren) {
			visit(child);
		}
	}

	visit(sourceRoot);

	const ancestorClassLists = new Map<Element, ReadonlySet<string>>();
	const ancestorParents = new Map<Element, Element | null>();
	if (sourceRoot.parentElement) {
		ancestorParents.set(sourceRoot, sourceRoot.parentElement);
		ancestorClassLists.set(
			sourceRoot.parentElement,
			Object.freeze(
				new Set(Array.from(sourceRoot.parentElement.classList ?? [])),
			),
		);
		if (sourceRoot.parentElement.parentElement) {
			ancestorParents.set(
				sourceRoot.parentElement,
				sourceRoot.parentElement.parentElement,
			);
			ancestorClassLists.set(
				sourceRoot.parentElement.parentElement,
				Object.freeze(
					new Set(
						Array.from(sourceRoot.parentElement.parentElement.classList ?? []),
					),
				),
			);
		}
	}

	return Object.freeze({
		ancestorClassLists: Object.freeze(ancestorClassLists),
		ancestorParents: Object.freeze(ancestorParents),
		getNode: (el) => nodeMap.get(el),
		observedSequence: Object.freeze(observedSequence),
		sourceRoot,
	});
}

export function evaluateWechatMathSourceAdmission(
	contextOrRoot: WechatMathTopologyContext | Element,
	runtime?: WechatMathStaticFlowRuntime,
	_animations?: readonly Animation[],
	_observedElements?: readonly Element[],
): WechatMathSourceAdmissionResult {
	let context: WechatMathTopologyContext;
	if ("getNode" in contextOrRoot) {
		context = contextOrRoot;
	} else if (runtime) {
		context = collectWechatMathLiveTopology(contextOrRoot, runtime);
	} else {
		throw new Error("evaluateWechatMathSourceAdmission-missing-runtime");
	}

	const index = indexTopology(context);
	const candidateGroups: Element[] = [];
	const seen = new Set<Element>();
	for (const element of context.observedSequence) {
		if (!index.nodes.get(element)?.classList.has("vlist") || seen.has(element))
			continue;
		seen.add(element);
		candidateGroups.push(element);
	}

	const groups = candidateGroups.map((group) =>
		evaluateSourceGroup(group, context, index),
	);
	const keyFor = (element: Element): string =>
		index.nodes.get(element)?.key ?? "unobserved";
	const orderedObserved = context.observedSequence.map(keyFor);
	const groupWitness = groups.map((g) => ({
		reason: g.reason,
		source: keyFor(g.source),
	}));
	const rowWitness = groups.flatMap((g) =>
		g.rows.map((r) => ({
			rawTop: r.rawTop,
			source: keyFor(r.source),
			top: r.top,
		})),
	);
	const svgWitness = groups.flatMap((g) =>
		g.svgTransitions.map((s) => ({
			holder: keyFor(s.sourceHolder),
			row: keyFor(s.sourceRow),
			svg: keyFor(s.sourceSvg),
		})),
	);
	const witness: WechatMathSourceAdmissionWitness = {
		groups: groupWitness,
		orderedObserved,
		rows: rowWitness,
		svg: svgWitness,
		version: 1 as const,
	};

	return deepFreezePlainRecord({
		groups,
		sourceNodes: freezeMap(index.nodes),
		sourceRoot: context.sourceRoot,
		topology: context,
		witness,
		witnessSignature: JSON.stringify(witness),
	});
}
