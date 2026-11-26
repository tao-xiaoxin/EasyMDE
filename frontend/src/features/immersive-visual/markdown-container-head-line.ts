import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	alignContainerChildren,
	checkRawPreservationRisks,
	leadingIndentAtDepth,
	needsPrevInnerForRiskCheck,
	prefixAtDepth,
	stripAtDepth,
} from "./markdown-container-preservation";
import { resolveContainerSlotJoin } from "./markdown-container-slot-separator";
import { prepareListPreservation } from "./markdown-list-preservation";
import {
	isNestedList,
	type PartialTitleRefDefPredicate,
} from "./markdown-list-serialization";
import type {
	ParsedVisualBlockSource,
	ParsedVisualDocument,
} from "./markdown-parser";
import { firstLine } from "./markdown-prescanner-containers";
import type { PreservationPlan } from "./markdown-refdef-liveness-state";

/**
 * Single pure, immutable Pass-1 prediction of the leading line a partially
 * preserved nested container (`list` / `blockquote`) emits at its parent
 * `depth`, shared by refdef liveness and `serializeContainerPreservingChildren`,
 * plus the one authoritative raw-text slot risk evaluation both callers run
 * against it.
 *
 * The line depends ONLY on the cached baseline alignment (`plan.lists` /
 * `plan.containers`, computed and cached here on first use), never on which
 * wave invalidates a reference, so both callers evaluate `swallowRisk ||
 * indentedRisk` against the exact same text monotonically.
 */

type MatchedContainerHeadRiskInput = Readonly<{
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>;
	child: ProseMirrorNode;
	defaultBlankSep: string;
	depth: number;
	effIdx: number;
	groupSep: string | undefined;
	/** Raw emitted text (with `depth` quote prefixes) whose join is checked. */
	headLine: string;
	/**
	 * Live partial-title refdef predicate: the serializer's
	 * `resolveReferences.isPartialTitleRefDef` and liveness's current
	 * `st.partialTitleRefNodes`, so both resolve the same tight join.
	 */
	isPartialTitleRefDef: PartialTitleRefDefPredicate | null;
	prevEffIdx: number;
	/** Lazily computes the exact Markdown emitted for `prevNode` (with markers). */
	prevEmittedText: () => string;
	/** Lazily computes the depth-stripped Markdown emitted for `prevNode`. */
	prevInnerText: () => string;
	prevNode: ProseMirrorNode | null;
	prevWasVerbatimAdjacent: boolean;
}>;

/**
 * The one authoritative separator + `indentedRisk` / `swallowRisk` evaluation
 * for emitting raw text (an immutable matched container head line or a
 * verbatim raw candidate) at a container slot. A tight partial-title join
 * uses the caller's live `isPartialTitleRefDef`; liveness re-evaluates the
 * slot whenever that refdef later leaves `st.partialTitleRefNodes`
 * (`removePartialTitleRefNode`). Text with no leading indent at `depth` can
 * never form indented code or be swallowed by a preceding list.
 */
export function evaluateMatchedContainerHeadRisk(
	input: MatchedContainerHeadRiskInput,
): Readonly<{
	indentedRisk: boolean;
	separator: string;
	swallowRisk: boolean;
}> {
	const { child, depth, headLine, prevNode, prevWasVerbatimAdjacent } = input;
	const rawInner = stripAtDepth(headLine, depth);
	const { separator } = resolveContainerSlotJoin({
		baselineBlocks: input.baselineBlocks,
		child,
		defaultBlankSep: input.defaultBlankSep,
		depth,
		effIdx: input.effIdx,
		emittedText: headLine,
		groupSep: input.groupSep,
		innerText: rawInner,
		isPartialTitleRefDef: input.isPartialTitleRefDef,
		prevEffIdx: input.prevEffIdx,
		prevEmittedText: input.prevEmittedText,
		prevInnerText: input.prevInnerText,
		prevNode,
		prevWasVerbatimAdjacent,
		serializedIsNull: false,
	});
	const leadIndent = leadingIndentAtDepth(headLine, depth);
	if (leadIndent <= 0) {
		return { indentedRisk: false, separator, swallowRisk: false };
	}
	const prevInnerForRisk = needsPrevInnerForRiskCheck(
		child,
		leadIndent,
		separator,
		prevNode,
		prevWasVerbatimAdjacent,
	)
		? input.prevInnerText()
		: "";
	const { indentedRisk, swallowRisk } = checkRawPreservationRisks(
		child,
		depth,
		headLine,
		separator,
		prevNode,
		prevInnerForRisk,
		input.prevEmittedText,
		prevWasVerbatimAdjacent,
	);
	return { indentedRisk, separator, swallowRisk };
}

/**
 * Returns the raw leading line of the baseline item/block that `child`'s
 * first child is aligned with (matched, or recursively a paired nested
 * container), or `null` when `child 0` is emitted canonically at column 0
 * (edited, inserted, or not preservable).
 */
export function resolveMatchedContainerHeadLine(
	child: ProseMirrorNode,
	base: ParsedVisualBlockSource | undefined,
	depth: number,
	plan: PreservationPlan,
	parsed: ParsedVisualDocument,
): string | null {
	if (!base || child.childCount === 0) return null;
	if (isNestedList(child)) {
		if (base.raw === null) return null;
		let prepared = plan.lists.get(child);
		if (!prepared) {
			const fresh = prepareListPreservation(
				child,
				base,
				depth,
				parsed.envReferences,
			);
			if (!fresh) return null;
			plan.lists.set(child, fresh);
			prepared = fresh;
		}
		const matchedIdx = prepared.matched[0] ?? -1;
		const slice =
			matchedIdx >= 0 ? prepared.slices.items[matchedIdx] : undefined;
		return slice === undefined ? null : prefixAtDepth(firstLine(slice), depth);
	}
	if (
		child.type.name !== "blockquote" ||
		base.node.type.name !== "blockquote"
	) {
		return null;
	}
	const source = parsed.blockquoteSources?.get(base.node);
	if (!source || source.blocks.length !== base.node.childCount) return null;
	let alignment = plan.containers.get(child);
	if (!alignment) {
		alignment = alignContainerChildren(child, source.blocks);
		plan.containers.set(child, alignment);
	}
	const matchedIdx = alignment.matchedOrigIndex[0] ?? -1;
	if (matchedIdx === 0 && source.leadingPrefix.length > 0) {
		return firstLine(source.leadingPrefix);
	}
	const headIdx =
		matchedIdx >= 0 ? matchedIdx : (alignment.pairedOrigIndex[0] ?? -1);
	const headBlock = headIdx >= 0 ? source.blocks[headIdx] : undefined;
	if (!headBlock) return null;
	if (matchedIdx >= 0 && headBlock.raw !== null) {
		return firstLine(headBlock.raw);
	}
	return resolveMatchedContainerHeadLine(
		child.child(0),
		headBlock,
		depth + 1,
		plan,
		parsed,
	);
}
