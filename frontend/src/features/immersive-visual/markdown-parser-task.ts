import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	TASK_LIST_MARKER_PATTERN,
	visualMarkdownItParser,
} from "./markdown-it-config";
import { mapInlineTokens } from "./markdown-parser-inline";
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

export type TaskParagraphContext = Readonly<{
	env: Record<string, unknown>;
	paragraphRawContents: WeakMap<ProseMirrorNode, string>;
	preScan: PreScanResult;
	referenceBlocks: WeakSet<ProseMirrorNode>;
}>;

function reparseRemainderAfterTaskMarker(
	rawContent: string,
	context: TaskParagraphContext,
	stripLeadingSeparator: boolean,
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
		inlines = reparseRemainderAfterTaskMarker(rawContent, context, true);
	}
	return {
		checked,
		children: [
			...itemChildren.slice(0, firstContentIndex),
			visualEditorSchema.nodes.paragraph.create(null, inlines),
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
		// When a shortcut reference definition `[x]: /ref` caused markdown-it to
		// attach a bogus link mark to `[x]` (not an explicit `[x](...)` or
		// `[x][...]` link in source), consume the raw `[x]`/`[X]`/`[ ]` prefix
		// before inline parsing so edits never emit `[x](/ref)`.
		const afterMarkerChar = rawContent[3];
		const hasBogusShortcutLink =
			afterMarkerChar !== "(" &&
			afterMarkerChar !== "[" &&
			child.firstChild?.marks.some((mark) => mark.type.name === "link") ===
				true;
		if (hasBogusShortcutLink) {
			const prefixText = visualEditorSchema.text(rawContent.slice(0, 3));
			const remainderNodes = reparseRemainderAfterTaskMarker(
				rawContent,
				context,
				false,
			);
			return visualEditorSchema.nodes.paragraph.create(
				{ preserveRawTaskPrefix: true },
				[prefixText, ...remainderNodes],
				child.marks,
			);
		}
		return visualEditorSchema.nodes.paragraph.create(
			{ preserveRawTaskPrefix: true },
			child.content,
			child.marks,
		);
	});
}
