import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	endsWithBlankBlockquoteLine,
	isListSwallowingFollowingBlock,
	wouldBeLazilyAbsorbedByPrevious,
} from "./markdown-container-preservation";
import {
	isTightPartialTitleFollower,
	nodeCanLazilyContinue,
	type PartialTitleRefDefPredicate,
	refDefContinuationMode,
} from "./markdown-list-serialization";
import {
	inspectReferenceDefinitionBlock,
	type ParsedVisualBlockSource,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";

/**
 * Single authoritative container-slot separator decision shared by
 * `serializeContainerPreservingChildren` (final output) and the refdef
 * liveness analyzer (which must predict that output exactly), so the two can
 * never drift on inherited tight separators or lazy-continuation escalation.
 */

type ContainerSlotJoin = Readonly<{
	refDefMode: ReturnType<typeof refDefContinuationMode>;
	separator: string;
}>;

type ContainerSlotJoinInput = Readonly<{
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>;
	child: ProseMirrorNode;
	/** Blank separator for the container depth (`\n\n` or `\n>\n`). */
	defaultBlankSep: string;
	/** Effective baseline index of `child`, or `-1` when not inherited. */
	effIdx: number;
	/** Separator of an intact shared group starting at `child`. */
	groupSep: string | undefined;
	/** Depth-stripped Markdown that will be emitted for `child`. */
	innerText: string;
	isPartialTitleRefDef: PartialTitleRefDefPredicate | null;
	prevEffIdx: number;
	/** Lazily computes the depth-stripped Markdown emitted for `prevNode`. */
	prevInnerText: () => string;
	prevMatchedIdx: number;
	prevNode: ProseMirrorNode | null;
	prevWasMatchedAdjacent: boolean;
	/** Whether `child` is emitted from canonical serialization. */
	serializedIsNull: boolean;
}>;

function hasRefDefAbsorbRisk(
	prevNode: ProseMirrorNode,
	innerText: string,
): boolean {
	if (
		prevNode.type.name !== "protected_block" ||
		prevNode.attrs.kind !== "raw" ||
		typeof prevNode.attrs.rawMarkdown !== "string"
	) {
		return false;
	}
	const info = inspectReferenceDefinitionBlock(prevNode.attrs.rawMarkdown);
	return (
		info.isRefDef &&
		!info.lastHasTitle &&
		wouldReferenceDefinitionAbsorbFollowingBlock(info.lastRaw, innerText)
	);
}

/**
 * Whether a tight `\n` join after an unmatched (edited or inserted) previous
 * block would let CommonMark lazily absorb `child` into it.
 */
function shouldEscalateLazyContinuation(
	input: ContainerSlotJoinInput,
	prevNode: ProseMirrorNode,
): boolean {
	return (
		input.prevMatchedIdx < 0 &&
		nodeCanLazilyContinue(prevNode) &&
		!endsWithBlankBlockquoteLine(input.prevInnerText()) &&
		wouldBeLazilyAbsorbedByPrevious(input.child, input.innerText)
	);
}

export function resolveContainerSlotJoin(
	input: ContainerSlotJoinInput,
): ContainerSlotJoin {
	const { child, innerText, prevNode } = input;
	if (!prevNode) return { refDefMode: "none", separator: "" };
	const mode = refDefContinuationMode(prevNode, child, innerText);
	const tightPartialTitle =
		mode === "none" &&
		isTightPartialTitleFollower(
			prevNode,
			child,
			innerText,
			input.isPartialTitleRefDef,
		);
	if (mode !== "none" || tightPartialTitle) {
		return { refDefMode: mode, separator: "\n" };
	}
	const inherited =
		input.effIdx >= 0 &&
		input.prevEffIdx >= 0 &&
		input.effIdx === input.prevEffIdx + 1
			? (input.groupSep ?? input.baselineBlocks[input.effIdx]?.separatorBefore)
			: undefined;
	const separator = inherited ?? input.defaultBlankSep;
	if (separator !== "\n") return { refDefMode: mode, separator };
	const escalate =
		(input.serializedIsNull && hasRefDefAbsorbRisk(prevNode, innerText)) ||
		isListSwallowingFollowingBlock(
			prevNode,
			input.prevInnerText(),
			innerText,
			input.prevWasMatchedAdjacent,
		) ||
		shouldEscalateLazyContinuation(input, prevNode);
	return {
		refDefMode: mode,
		separator: escalate ? input.defaultBlankSep : separator,
	};
}

export function blankSeparatorAtDepth(depth: number): string {
	return depth <= 0 ? "\n\n" : `\n${"> ".repeat(depth - 1)}>\n`;
}
