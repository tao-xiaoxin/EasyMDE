import {
	Fragment,
	type Mark,
	type Node as ProseMirrorNode,
} from "prosemirror-model";
import {
	createInternalLinkBoundaryKey,
	visualEditorSchema,
} from "./visual-schema";

/**
 * Freshly parsed Markdown carries document-local link `boundaryKey`s (often
 * `null`) that can collide with an adjacent link already in the editor
 * (`[b](/u)` beside an existing `[c](/u)`) and merge the two once their
 * paragraphs join. Re-keys every distinct source link identity
 * `(href, title, boundaryKey)` inside `fragment` to ONE fresh session key, so
 * a single link spanning formatted runs stays one link while distinct links
 * never merge with each other or with links outside the fragment.
 *
 * Shared by Markdown paste and canonical reconcile splicing.
 */
export function remapLinkBoundaryKeys(fragment: Fragment): Fragment {
	const linkType = visualEditorSchema.marks.link;
	const freshKeys = new Map<string, string>();
	const remapMarks = (marks: readonly Mark[]): readonly Mark[] =>
		marks.map((mark) => {
			if (mark.type !== linkType) return mark;
			const identity = JSON.stringify([
				mark.attrs.href,
				mark.attrs.title,
				mark.attrs.boundaryKey,
			]);
			let boundaryKey = freshKeys.get(identity);
			if (boundaryKey === undefined) {
				boundaryKey = createInternalLinkBoundaryKey();
				freshKeys.set(identity, boundaryKey);
			}
			return linkType.create({ ...mark.attrs, boundaryKey });
		});
	const remapNode = (node: ProseMirrorNode): ProseMirrorNode => {
		let next = node;
		if (!node.isLeaf && node.childCount > 0) {
			next = node.copy(remapChildren(node.content));
		}
		return next.marks.length > 0 ? next.mark(remapMarks(next.marks)) : next;
	};
	const remapChildren = (content: Fragment): Fragment => {
		const children: ProseMirrorNode[] = [];
		content.forEach((child) => {
			children.push(remapNode(child));
		});
		return Fragment.from(children);
	};
	return remapChildren(fragment);
}
