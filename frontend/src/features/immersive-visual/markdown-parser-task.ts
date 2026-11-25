import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	TASK_LIST_MARKER_PATTERN,
	visualMarkdownItParser,
} from "./markdown-it-config";
import type { BuiltVisualBlockSources } from "./markdown-parser-block-sources";
import {
	type InlineReferenceCollectors,
	mapInlineTokens,
} from "./markdown-parser-inline";
import type { PreScanResult } from "./markdown-prescanner";
import { visualEditorSchema } from "./visual-schema";

/**
 * Feature-private PHP GFM task-list prefix helpers for `markdown-parser.ts`.
 *
 * PHP `League\CommonMark\Extension\TaskList\TaskListItemMarkerParser` runs at
 * inline priority 35 (before link parsing), so an unescaped `[x]`/`[X]`/`[ ]`
 * prefix on a list-item paragraph is consumed as a task marker even when a
 * shortcut reference definition like `[x]: /ref` exists in the document.
 */

export type ReferenceBlockLabelEntry = Readonly<{
	hasPhpPartialTitle: boolean;
	label: string;
}>;

export type TaskParagraphContext = Readonly<{
	blockquoteDepth: number;
	blockquoteSources: Map<ProseMirrorNode, BuiltVisualBlockSources>;
	env: Record<string, unknown>;
	linkOccurrences: Map<string, number>;
	listDepth: number;
	paragraphRawContents: WeakMap<ProseMirrorNode, string>;
	preScan: PreScanResult;
	referenceBlockLabels?: WeakMap<
		ProseMirrorNode,
		ReadonlyArray<ReferenceBlockLabelEntry>
	>;
	referenceBlocks: WeakSet<ProseMirrorNode>;
	referenceCollectors?: InlineReferenceCollectors;
}>;

function reparseRemainderAfterTaskMarker(
	rawContent: string,
	context: TaskParagraphContext,
	stripLeadingSeparator: boolean,
	blockRefLabels?: Set<string>,
): ProseMirrorNode[] {
	const rest = rawContent.slice(3);
	const remainder = stripLeadingSeparator
		? /^[ \t]* {2}\n/.test(rest)
			? rest.replace(/^[ \t]* {2}\n/, "  \n")
			: rest.replace(/^(?:[ \t]*\n|[ \t]+)/, "")
		: rest;
	const reparsedTokens = visualMarkdownItParser.parseInline(
		remainder,
		context.env,
	);
	return mapInlineTokens(
		reparsedTokens[0]?.children ?? null,
		context.preScan,
		false,
		context.referenceCollectors,
		blockRefLabels,
		context.linkOccurrences,
	);
}

export function stripTaskPrefix(
	itemChildren: ReadonlyArray<ProseMirrorNode>,
	context: TaskParagraphContext,
): Readonly<{ checked: boolean; children: ProseMirrorNode[] }> | null {
	let firstContentIndex = 0;
	while (firstContentIndex < itemChildren.length) {
		const candidate = itemChildren[firstContentIndex];
		if (
			candidate &&
			candidate.type === visualEditorSchema.nodes.protected_block &&
			context.referenceBlocks.has(candidate)
		) {
			firstContentIndex += 1;
			continue;
		}
		break;
	}
	const firstBlock = itemChildren[firstContentIndex];
	if (!firstBlock || firstBlock.type !== visualEditorSchema.nodes.paragraph) {
		return null;
	}
	const rawContent = context.paragraphRawContents.get(firstBlock) ?? "";
	const rawMatch = TASK_LIST_MARKER_PATTERN.exec(rawContent);
	if (!rawMatch?.[1]) {
		return null;
	}
	const checked = rawMatch[1].toLowerCase() === "x";
	let inlines: ProseMirrorNode[];
	let refLabels =
		context.referenceCollectors?.referencedLabelsByNode.get(firstBlock);
	const firstInline = firstBlock.firstChild;
	if (
		firstInline?.isText &&
		firstInline.marks.length === 0 &&
		/^\[[ xX]\]/.test(firstInline.text ?? "")
	) {
		const text = firstInline.text ?? "";
		// Strip `[x]` plus either horizontal whitespace or a single soft line
		// break (`- [x]\n  Task`); hard_break children (`- [x]  \n  Task` or
		// `- [x]\\\n  Task`) remain untouched as subsequent children.
		const prefixMatch = /^\[[ xX]\](?:[ \t]*\n|[ \t]*)/.exec(text);
		const remaining = text.slice(prefixMatch?.[0].length ?? 3);
		inlines = remaining.length > 0 ? [visualEditorSchema.text(remaining)] : [];
		for (let i = 1; i < firstBlock.childCount; i += 1) {
			inlines.push(firstBlock.child(i));
		}
	} else {
		// PHP TaskListItemMarkerParser (priority 35) consumes `[x]` before link
		// parsing (e.g. `- [x](url)` or `- [x][ref]`), so re-parse the tail while
		// preserving 2+ trailing spaces before `\n` as a CommonMark hard break.
		const reparsedLabels = context.referenceCollectors
			? new Set<string>()
			: undefined;
		inlines = reparseRemainderAfterTaskMarker(
			rawContent,
			context,
			true,
			reparsedLabels,
		);
		refLabels =
			reparsedLabels && reparsedLabels.size > 0 ? reparsedLabels : undefined;
	}
	const taskParagraph = visualEditorSchema.nodes.paragraph.create(
		null,
		inlines,
	);
	if (context.referenceCollectors && refLabels && refLabels.size > 0) {
		context.referenceCollectors.referencedLabelsByNode.set(
			taskParagraph,
			refLabels,
		);
	}
	return {
		checked,
		children: [
			...itemChildren.slice(0, firstContentIndex),
			taskParagraph,
			...itemChildren.slice(firstContentIndex + 1),
		],
	};
}

export function markPreservedTaskParagraphs(
	children: ReadonlyArray<ProseMirrorNode>,
	context: TaskParagraphContext,
): ProseMirrorNode[] {
	return children.map((child) => {
		if (
			child.type !== visualEditorSchema.nodes.paragraph ||
			child.attrs.preserveRawTaskPrefix === true
		) {
			return child;
		}
		const rawContent = context.paragraphRawContents.get(child) ?? "";
		if (!TASK_LIST_MARKER_PATTERN.test(rawContent)) {
			return child;
		}
		// PHP TaskListItemMarkerParser runs at inline priority 35 (ahead of
		// inline/reference link parsing and autolinks), so an unescaped
		// `[x]`/`[X]`/`[ ]` prefix on any direct list-item paragraph is always
		// consumed before parsing the tail (e.g. `1. [x][r]`, `1. [x](url)`,
		// `1. [x](not a link`, and 2nd-paragraph bullet items).
		const prefixText = visualEditorSchema.text(rawContent.slice(0, 3));
		const blockRefLabels = context.referenceCollectors
			? new Set<string>()
			: undefined;
		const remainderNodes = reparseRemainderAfterTaskMarker(
			rawContent,
			context,
			false,
			blockRefLabels,
		);
		const preservedParagraph = visualEditorSchema.nodes.paragraph.create(
			{ preserveRawTaskPrefix: true },
			[prefixText, ...remainderNodes],
			child.marks,
		);
		if (
			context.referenceCollectors &&
			blockRefLabels &&
			blockRefLabels.size > 0
		) {
			context.referenceCollectors.referencedLabelsByNode.set(
				preservedParagraph,
				blockRefLabels,
			);
		}
		return preservedParagraph;
	});
}
