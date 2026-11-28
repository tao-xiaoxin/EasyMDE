import { WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS } from "./wechat-clone-metadata";
import {
	collectWechatMathLiveTopology,
	evaluateWechatMathSourceAdmission,
} from "./wechat-math-static-flow-admission";
import {
	assertGate,
	CAPTURE_STYLE_PROPERTIES,
	type CapturedEmptyTransport,
	type CapturedGroup,
	type CapturedRow,
	type CapturedSvgTransition,
	deepFreezePlainRecord,
	elementKey,
	flowError,
	GEOMETRY_QUANTUM,
	LOGICAL_INSETS,
	PHYSICAL_INSETS,
	PSEUDO_ELEMENTS,
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
	type WechatMathStaticFlowApplyOptions,
	type WechatMathStaticFlowCaptureOptions,
	type WechatMathStaticFlowEmptyTransportTransition,
	WechatMathStaticFlowError,
	type WechatMathStaticFlowErrorCode,
	type WechatMathStaticFlowGate,
	type WechatMathStaticFlowPlan,
	type WechatMathStaticFlowPlanOptions,
	type WechatMathStaticFlowRect,
	type WechatMathStaticFlowRejectedGroup,
	type WechatMathStaticFlowRowTransition,
	type WechatMathStaticFlowRuntime,
	type WechatMathStaticFlowSnapshot,
	type WechatMathStaticFlowSvgTransition,
	type WechatMathStaticFlowTypedStyleMap,
	type WechatMathTopologyContext,
} from "./wechat-math-static-flow-model";
import { replaceDeclarations } from "./wechat-style-declarations";

export {
	CAPTURE_STYLE_PROPERTIES,
	collectWechatMathLiveTopology,
	deepFreezePlainRecord,
	evaluateWechatMathSourceAdmission,
	GEOMETRY_QUANTUM,
	LOGICAL_INSETS,
	PSEUDO_ELEMENTS,
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
	type WechatMathStaticFlowApplyOptions,
	type WechatMathStaticFlowCaptureOptions,
	type WechatMathStaticFlowEmptyTransportTransition,
	WechatMathStaticFlowError,
	type WechatMathStaticFlowErrorCode,
	type WechatMathStaticFlowGate,
	type WechatMathStaticFlowPlan,
	type WechatMathStaticFlowPlanOptions,
	type WechatMathStaticFlowRect,
	type WechatMathStaticFlowRejectedGroup,
	type WechatMathStaticFlowRowTransition,
	type WechatMathStaticFlowRuntime,
	type WechatMathStaticFlowSnapshot,
	type WechatMathStaticFlowSvgTransition,
	type WechatMathStaticFlowTypedStyleMap,
	type WechatMathTopologyContext,
};

/**
 * Bounded KaTeX vertical-list normalization for the WeChat serializer.
 *
 * The serializer captures a frozen source/clone identity graph, admits only
 * measured row and SVG-holder transitions, applies the plan to the normalized
 * SECTION clone, and rechecks source freshness before committing the payload.
 *
 * The only admitted row transition is the measured KaTeX pattern:
 *
 *   relative row + zero height + negative authored Typed OM and computed top:t
 *   + authored Typed OM bottom:auto (its computed used CSSOM bottom may be +t)
 *   + zero vertical margins, padding, and borders
 *   + finite horizontal margins preserved exactly
 *   + a direct positive inflow `.pstrut`
 *   -> static row + margin-top:t + margin-bottom:-t
 *
 * A group is all-or-nothing. A row-owned absolute SVG is admitted only through
 * an explicit inline-block holder with finite width/height, authored Typed OM
 * physical and logical insets equal to auto, and equal source SVG/holder
 * geometry. The SVG transition is applied before any row transition, and the
 * Source tree is never mutated.
 */

function sourceNodeFor(
	source: Element,
	options: WechatMathStaticFlowCaptureOptions,
): WechatMathFrozenNode {
	const node = options.sourceAdmission?.sourceNodes.get(source);
	if (!node) throw flowError("identity-missing");
	return node;
}

function validateChildOrder(
	sourceParent: Element,
	cloneParent: Element,
	options: WechatMathStaticFlowCaptureOptions,
): void {
	const sourceNodes = options.sourceAdmission?.sourceNodes;
	if (!sourceNodes) throw flowError("identity-missing");
	const sourceNode = sourceNodes.get(sourceParent);
	if (!sourceNode) throw flowError("identity-missing");
	const sourceChildren = sourceNode.orderedChildren;
	const cloneChildren = Array.from(cloneParent.children);
	if (sourceChildren.length !== cloneChildren.length)
		throw flowError("identity-mismatch");
	sourceChildren.forEach((sourceChild, index) => {
		const cloneChild = options.cloneIdentityFor(sourceChild);
		const childNode = sourceNodes.get(sourceChild);
		if (!cloneChild || !childNode) throw flowError("identity-missing");
		if (
			cloneChild.namespaceURI !== childNode.namespaceURI ||
			cloneChild.localName !== childNode.localName ||
			cloneChildren[index] !== cloneChild
		)
			throw flowError("identity-mismatch");
	});
}

function isCompatibleCloneRootName(
	sourceLocalName: string,
	cloneLocalName: string,
): boolean {
	return (
		sourceLocalName === cloneLocalName ||
		(["div", "article", "blockquote"].includes(sourceLocalName.toLowerCase()) &&
			"section" === cloneLocalName.toLowerCase())
	);
}

function pairElement(
	source: Element,
	options: WechatMathStaticFlowCaptureOptions,
): Readonly<{ clone: Element; source: Element }> {
	if (source === options.sourceRoot)
		return { clone: options.cloneRoot, source };
	const sourceNode = sourceNodeFor(source, options);
	const sourceNodes = options.sourceAdmission?.sourceNodes;
	if (!sourceNodes) throw flowError("identity-missing");
	const clone = options.cloneIdentityFor(source);
	if (!clone) throw flowError("identity-missing");
	if (
		clone === source ||
		clone.namespaceURI !== sourceNode.namespaceURI ||
		!isCompatibleCloneRootName(sourceNode.localName, clone.localName)
	)
		throw flowError("identity-mismatch");
	if (!sourceNodes.has(source) || !options.cloneRoot.contains(clone)) {
		throw flowError("identity-outside-root");
	}
	const sourceParent = sourceNode.parent;
	if (sourceParent && sourceNodes.has(sourceParent)) {
		const expectedParent =
			sourceParent === options.sourceRoot
				? options.cloneRoot
				: options.cloneIdentityFor(sourceParent);
		if (!expectedParent) throw flowError("identity-missing");
		if (clone.parentElement !== expectedParent)
			throw flowError("identity-mismatch");
	}
	return { clone, source };
}

function bindSvgTransitionToClone(
	transition: WechatMathSourceSvgAdmission,
	rowClone: Element,
	options: WechatMathStaticFlowCaptureOptions,
): Readonly<{
	reason: string | null;
	transition: CapturedSvgTransition | null;
}> {
	const holderPair = pairElement(transition.sourceHolder, options);
	const svgPair = pairElement(transition.sourceSvg, options);
	if (
		!(holderPair.clone instanceof Element) ||
		!(svgPair.clone instanceof SVGSVGElement)
	) {
		return { reason: "svg-identity", transition: null };
	}
	if (
		holderPair.clone.children.length !== 1 ||
		holderPair.clone.firstElementChild !== svgPair.clone
	) {
		return { reason: "svg-holder", transition: null };
	}
	if (
		Array.from(holderPair.clone.childNodes).some(
			(node) =>
				node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
		)
	) {
		return { reason: "svg-holder", transition: null };
	}
	if (svgPair.clone.parentElement !== holderPair.clone) {
		return { reason: "svg-identity", transition: null };
	}
	validateChildOrder(transition.sourceHolder, holderPair.clone, options);

	const cloneChain: Element[] = [holderPair.clone];
	for (let index = 1; index < transition.sourceChain.length; index += 1) {
		const sourceAncestor = transition.sourceChain[index];
		if (!sourceAncestor) continue;
		const ancestorPair = pairElement(sourceAncestor, options);
		if (
			cloneChain[cloneChain.length - 1]?.parentElement !== ancestorPair.clone
		) {
			return { reason: "svg-identity", transition: null };
		}
		cloneChain.push(ancestorPair.clone);
	}
	if (cloneChain[cloneChain.length - 1] !== rowClone) {
		return { reason: "svg-identity", transition: null };
	}
	return {
		reason: null,
		transition: Object.freeze({
			cloneChain: Object.freeze(cloneChain),
			cloneHolder: holderPair.clone,
			cloneRow: rowClone,
			cloneSvg: svgPair.clone,
			sourceHolder: transition.sourceHolder,
			sourceRow: transition.sourceRow,
			sourceSvg: transition.sourceSvg,
		}),
	};
}

function bindEmptyTransportToClone(
	transition: WechatMathSourceEmptyTransportAdmission,
	options: WechatMathStaticFlowCaptureOptions,
): CapturedEmptyTransport | null {
	const pair = pairElement(transition.source, options);
	const carrier = WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS.get(pair.clone);
	if (!carrier || carrier.source !== transition.source) return null;
	const childNodes = Array.from(pair.clone.childNodes);
	if (
		childNodes.length !== 1 ||
		childNodes[0]?.nodeType !== Node.TEXT_NODE ||
		childNodes[0].nodeValue !== "\u2060"
	)
		return null;
	const cloneParent = pair.clone.parentElement;
	if (!cloneParent) return null;
	return Object.freeze({
		clone: pair.clone,
		cloneParent,
		source: transition.source,
		sourceBoxSizing: transition.sourceBoxSizing,
	});
}

function bindRowToClone(
	row: WechatMathSourceRowAdmission,
	groupClone: Element,
	options: WechatMathStaticFlowCaptureOptions,
): Readonly<{ reason: string | null; row: CapturedRow | null }> {
	const rowPair = pairElement(row.source, options);
	if (rowPair.clone.parentElement !== groupClone)
		return { reason: "row-shape", row: null };
	validateChildOrder(row.source, rowPair.clone, options);
	const pstrutPair = pairElement(row.pstrutSource, options);
	return {
		reason: null,
		row: Object.freeze({
			clone: rowPair.clone,
			cloneParent: groupClone,
			pstrutClone: pstrutPair.clone,
			pstrutSource: row.pstrutSource,
			rawTop: row.rawTop,
			source: row.source,
			top: row.top,
		}),
	};
}

function bindSourceGroupToClone(
	group: WechatMathSourceGroupAdmission,
	options: WechatMathStaticFlowCaptureOptions,
): CapturedGroup {
	const pair = pairElement(group.source, options);
	if (group.reason !== null) {
		return {
			clone: pair.clone,
			evidence: group.evidence,
			reason: group.reason,
			rows: [],
			emptyTransport: [],
			source: group.source,
			svgTransitions: [],
		};
	}
	validateChildOrder(group.source, pair.clone, options);
	const rows: CapturedRow[] = [];
	for (const row of group.rows) {
		const boundRow = bindRowToClone(row, pair.clone, options);
		if (boundRow.reason || !boundRow.row) {
			return {
				clone: pair.clone,
				evidence: group.evidence,
				reason: boundRow.reason ?? "row-shape",
				rows: [],
				emptyTransport: [],
				source: group.source,
				svgTransitions: [],
			};
		}
		rows.push(boundRow.row);
	}
	const svgTransitions: CapturedSvgTransition[] = [];
	for (const transition of group.svgTransitions) {
		const rowPair = pairElement(transition.sourceRow, options);
		const boundSvg = bindSvgTransitionToClone(
			transition,
			rowPair.clone,
			options,
		);
		if (boundSvg.reason || !boundSvg.transition) {
			return {
				clone: pair.clone,
				evidence: group.evidence,
				reason: boundSvg.reason ?? "svg-identity",
				rows: [],
				emptyTransport: [],
				source: group.source,
				svgTransitions: [],
			};
		}
		svgTransitions.push(boundSvg.transition);
	}
	const emptyTransport: CapturedEmptyTransport[] = [];
	for (const transition of group.emptyTransport) {
		const bound = bindEmptyTransportToClone(transition, options);
		if (bound) emptyTransport.push(bound);
	}
	return {
		clone: pair.clone,
		evidence: group.evidence,
		reason: null,
		rows: Object.freeze(rows),
		emptyTransport: Object.freeze(emptyTransport),
		source: group.source,
		svgTransitions: Object.freeze(svgTransitions),
	};
}

export function captureWechatMathStaticFlowSnapshot(
	options: WechatMathStaticFlowCaptureOptions,
): WechatMathStaticFlowSnapshot {
	assertGate(options.gate);
	if (
		options.sourceAdmission &&
		options.sourceAdmission.sourceRoot !== options.sourceRoot
	) {
		throw flowError("root-mismatch");
	}
	if (
		!options.liveSourceAdmissionSignature ||
		!options.rawDimensionGeometrySignature
	) {
		throw flowError("signature-missing");
	}

	const sourceAdmission =
		options.sourceAdmission ??
		evaluateWechatMathSourceAdmission(
			options.sourceRoot,
			options.runtime,
			options.runtime.getAnimations(),
		);
	const sourceRootNode = sourceAdmission.sourceNodes.get(options.sourceRoot);
	if (!sourceRootNode) throw flowError("identity-missing");
	if (
		options.sourceRoot === options.cloneRoot ||
		sourceRootNode.namespaceURI !== options.cloneRoot.namespaceURI ||
		!isCompatibleCloneRootName(
			sourceRootNode.localName,
			options.cloneRoot.localName,
		)
	)
		throw flowError("root-mismatch");

	// Binding always receives the same frozen source topology that produced the
	// admission. Clone membership and child order remain live validation.
	const bindingOptions: WechatMathStaticFlowCaptureOptions = {
		...options,
		sourceAdmission,
	};
	const sourceKeyFor = (element: Element): string =>
		sourceAdmission.sourceNodes.get(element)?.key ?? "unobserved";
	const groups = sourceAdmission.groups.map((group) =>
		bindSourceGroupToClone(group, bindingOptions),
	);

	const payload = {
		cloneRoot: elementKey(options.cloneRoot),
		groups: groups.map((group) => ({
			evidence: group.evidence,
			reason: group.reason,
			rows: group.rows.map(({ source, top }) => ({
				source: sourceKeyFor(source),
				top,
			})),
			source: sourceKeyFor(group.source),
			emptyTransport: group.emptyTransport.map(
				({ source, sourceBoxSizing }) => ({
					source: sourceKeyFor(source),
					sourceBoxSizing,
				}),
			),
			svg: group.svgTransitions.map(({ sourceHolder, sourceSvg }) => ({
				holder: sourceKeyFor(sourceHolder),
				svg: sourceKeyFor(sourceSvg),
			})),
		})),
		liveSourceAdmissionSignature: options.liveSourceAdmissionSignature,
		rawDimensionGeometrySignature: options.rawDimensionGeometrySignature,
		sourceRoot: sourceKeyFor(options.sourceRoot),
		version: 1,
		witness: sourceAdmission.witness,
	};
	assertGate(options.gate);
	return deepFreezePlainRecord({
		cloneRoot: options.cloneRoot,
		groups,
		liveSourceAdmissionSignature: options.liveSourceAdmissionSignature,
		rawDimensionGeometrySignature: options.rawDimensionGeometrySignature,
		signature: JSON.stringify(payload),
		sourceRoot: options.sourceRoot,
		version: 1 as const,
	});
}

export function planWechatMathStaticFlow(
	snapshot: WechatMathStaticFlowSnapshot,
	options: WechatMathStaticFlowPlanOptions,
): WechatMathStaticFlowPlan {
	assertGate(options.gate);
	const accepted = snapshot.groups.filter((group) => null === group.reason);
	const plan: WechatMathStaticFlowPlan = deepFreezePlainRecord({
		cloneRoot: snapshot.cloneRoot,
		emptyTransportTransitions: accepted.flatMap((group) =>
			group.emptyTransport.map(
				({ clone, cloneParent, source, sourceBoxSizing }) => ({
					clone,
					cloneParent,
					source,
					sourceBoxSizing,
				}),
			),
		),
		rejectedGroups: snapshot.groups
			.filter(
				(group): group is CapturedGroup & { reason: string } =>
					null !== group.reason,
			)
			.map((group) => ({ reason: group.reason, source: group.source })),
		rowTransitions: accepted.flatMap((group) =>
			group.rows.map(
				({ clone, cloneParent, pstrutClone, rawTop, source, top }) => ({
					clone,
					cloneParent,
					pstrutClone,
					rawTop,
					source,
					top,
				}),
			),
		),
		snapshotSignature: snapshot.signature,
		svgTransitions: accepted.flatMap((group) =>
			group.svgTransitions.map((transition) => ({
				...transition,
				cloneChain: [...transition.cloneChain],
			})),
		),
	});
	assertGate(options.gate);
	return plan;
}

type AppliedStyle = Readonly<{ element: Element; original: string | null }>;

function declarationsForSvg(): readonly string[] {
	return [
		"position:static",
		...PHYSICAL_INSETS.map((property) => `${property}:auto`),
		...LOGICAL_INSETS.map((property) => `${property}:auto`),
	];
}

function declarationsForRow(rawTop: string): readonly string[] {
	if (!/^-(?:\d+(?:\.\d+)?|\.\d+)px$/i.test(rawTop))
		throw flowError("apply-style-rejected");
	const positiveBottom = rawTop.slice(1);
	return [
		"position:static",
		"top:auto",
		"bottom:auto",
		`margin-top:${rawTop}`,
		`margin-bottom:${positiveBottom}`,
	];
}

function declarationsForEmptyTransport(
	sourceBoxSizing: "border-box" | "content-box",
): readonly string[] {
	return [
		"overflow:hidden",
		"overflow-x:hidden",
		"overflow-y:hidden",
		`box-sizing:${sourceBoxSizing}`,
	];
}

function applyDeclarations(
	element: Element,
	declarations: readonly string[],
): void {
	try {
		replaceDeclarations(element, declarations, true);
		const style = (element as Element & { style?: CSSStyleDeclaration }).style;
		declarations.forEach((declaration) => {
			const property = declaration.slice(0, declaration.indexOf(":"));
			if (
				!style?.getPropertyValue(property).trim() ||
				"important" !== style.getPropertyPriority(property)
			) {
				throw flowError("apply-style-rejected");
			}
		});
	} catch (error: unknown) {
		if (error instanceof WechatMathStaticFlowError) throw error;
		throw flowError("apply-style-rejected", error);
	}
}

function restoreStyles(applied: readonly AppliedStyle[]): void {
	[...applied].reverse().forEach(({ element, original }) => {
		if (null === original) element.removeAttribute("style");
		else element.setAttribute("style", original);
	});
}

export function applyWechatMathStaticFlow(
	plan: WechatMathStaticFlowPlan,
	options: WechatMathStaticFlowApplyOptions,
): void {
	assertGate(options.gate);
	const cloneRoot = options.cloneRoot ?? plan.cloneRoot;

	const targets = [
		...plan.svgTransitions.flatMap((transition) => [
			transition.cloneSvg,
			transition.cloneHolder,
		]),
		...plan.emptyTransportTransitions.map((transition) => transition.clone),
		...plan.rowTransitions.flatMap((transition) => [
			transition.clone,
			transition.pstrutClone,
		]),
	];
	const seenTargets = new Set<Element>();
	for (const target of targets) {
		if (seenTargets.has(target)) throw flowError("apply-duplicate-target");
		seenTargets.add(target);
		if (
			!cloneRoot.contains(target) ||
			target.ownerDocument !== cloneRoot.ownerDocument
		) {
			throw flowError("apply-detached");
		}
	}
	for (const transition of plan.svgTransitions) {
		if (
			transition.cloneSvg.parentElement !== transition.cloneHolder ||
			transition.cloneChain[0] !== transition.cloneHolder ||
			transition.cloneChain[transition.cloneChain.length - 1] !==
				transition.cloneRow ||
			!cloneRoot.contains(transition.cloneHolder)
		)
			throw flowError("apply-parent-mismatch");
		for (let index = 1; index < transition.cloneChain.length; index += 1) {
			if (
				transition.cloneChain[index - 1]?.parentElement !==
				transition.cloneChain[index]
			) {
				throw flowError("apply-parent-mismatch");
			}
		}
		if (
			transition.cloneChain.some((element) => !cloneRoot.contains(element)) ||
			transition.cloneSvg.parentElement !== transition.cloneChain[0] ||
			transition.cloneChain[transition.cloneChain.length - 1] !==
				transition.cloneRow
		)
			throw flowError("apply-detached");
	}
	for (const transition of plan.rowTransitions) {
		const parent = transition.clone.parentElement;
		if (
			parent !== transition.cloneParent ||
			!cloneRoot.contains(transition.cloneParent)
		) {
			throw flowError("apply-parent-mismatch");
		}
		if (
			!transition.pstrutClone ||
			transition.pstrutClone.parentElement !== transition.clone ||
			!cloneRoot.contains(transition.pstrutClone)
		) {
			throw flowError("apply-parent-mismatch");
		}
	}
	for (const transition of plan.emptyTransportTransitions) {
		if (
			transition.clone.parentElement !== transition.cloneParent ||
			!cloneRoot.contains(transition.cloneParent) ||
			WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS.get(transition.clone)?.source !==
				transition.source
		) {
			throw flowError("apply-parent-mismatch");
		}
		const childNodes = Array.from(transition.clone.childNodes);
		if (
			childNodes.length !== 1 ||
			childNodes[0]?.nodeType !== Node.TEXT_NODE ||
			childNodes[0].nodeValue !== "\u2060"
		) {
			throw flowError("apply-parent-mismatch");
		}
	}

	const applied: AppliedStyle[] = targets.map((element) => ({
		element,
		original: element.getAttribute("style"),
	}));
	try {
		assertGate(options.gate);
		for (const transition of plan.svgTransitions) {
			applyDeclarations(transition.cloneSvg, declarationsForSvg());
		}
		for (const transition of plan.emptyTransportTransitions) {
			applyDeclarations(
				transition.clone,
				declarationsForEmptyTransport(transition.sourceBoxSizing),
			);
		}
		assertGate(options.gate);
		for (const transition of plan.rowTransitions) {
			applyDeclarations(
				transition.clone,
				declarationsForRow(transition.rawTop),
			);
		}
		assertGate(options.gate);
	} catch (error: unknown) {
		try {
			restoreStyles(applied);
		} catch (rollbackError: unknown) {
			throw flowError("apply-rollback-failed", rollbackError);
		}
		throw error;
	}
}
