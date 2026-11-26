import type { Node as ProseMirrorNode } from "prosemirror-model";
import { alignContainerChildren } from "./markdown-container-preservation";
import { prepareListPreservation } from "./markdown-list-preservation";
import { isNestedList } from "./markdown-list-serialization";
import type {
	ParsedVisualBlockSource,
	ParsedVisualDocument,
} from "./markdown-parser";
import type { PreservationPlan } from "./markdown-refdef-liveness-state";

/**
 * Single pure, immutable Pass-1 prediction of the leading line a partially
 * preserved nested container (`list` / `blockquote`) emits at its parent
 * `depth`, shared by refdef liveness and `serializeContainerPreservingChildren`.
 *
 * The line depends ONLY on the cached baseline alignment (`plan.lists` /
 * `plan.containers`, computed and cached here on first use), never on which
 * wave invalidates a reference, so both callers evaluate `swallowRisk ||
 * indentedRisk` against the exact same text monotonically.
 */

function firstLine(text: string): string {
	const nl = text.indexOf("\n");
	return nl === -1 ? text : text.slice(0, nl);
}

function prefixLineAtDepth(line: string, depth: number): string {
	if (depth <= 0) return line;
	return line.length > 0
		? `${"> ".repeat(depth)}${line}`
		: `${"> ".repeat(depth - 1)}>`;
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
		return slice === undefined
			? null
			: prefixLineAtDepth(firstLine(slice), depth);
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
