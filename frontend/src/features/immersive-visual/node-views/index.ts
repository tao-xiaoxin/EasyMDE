import type { EditorProps } from "prosemirror-view";
import {
	type CodeBlockNodeViewOptions,
	type CodeHighlightPluginOptions,
	codeHighlightPluginKey,
	createCodeBlockNodeView,
	createCodeHighlightPlugin,
	type HighlightJsResult,
	type HighlightJsRuntime,
	parseHighlightedHtmlToTokenRanges,
} from "./code-block-node-view";
import {
	createImageNodeView,
	type ImageNodeViewOptions,
} from "./image-node-view";
import {
	createProtectedBlockNodeView,
	createProtectedInlineNodeView,
	extractBlockMathTex,
	extractInlineMathTex,
	extractMermaidSource,
	type KatexRenderOptions,
	type KatexRuntime,
	type MermaidRenderResult,
	type MermaidRuntime,
	type ProtectedAtomLabels,
	type ProtectedAtomNodeViewOptions,
	sanitizeMermaidSvg,
} from "./protected-atom-node-view";
import {
	createTableContainerNodeView,
	TableContainerNodeView,
	type TableContainerNodeViewOptions,
} from "./table-container-node-view";
import {
	createTaskItemNodeView,
	type TaskItemNodeViewOptions,
} from "./task-item-node-view";

export type VisualNodeViewsOptions = Readonly<{
	codeBlock?: CodeBlockNodeViewOptions;
	image?: ImageNodeViewOptions;
	protectedAtom?: ProtectedAtomNodeViewOptions;
	table?: TableContainerNodeViewOptions;
	taskItem?: TaskItemNodeViewOptions;
}>;

export function createVisualNodeViews(
	options: VisualNodeViewsOptions = {},
): NonNullable<EditorProps["nodeViews"]> {
	return {
		code_block: createCodeBlockNodeView(options.codeBlock),
		image: createImageNodeView(options.image),
		protected_block: createProtectedBlockNodeView(options.protectedAtom),
		protected_inline: createProtectedInlineNodeView(options.protectedAtom),
		task_item: createTaskItemNodeView(options.taskItem),
		table: createTableContainerNodeView(options.table),
	};
}

export {
	type CodeBlockNodeViewOptions,
	type CodeHighlightPluginOptions,
	codeHighlightPluginKey,
	createCodeBlockNodeView,
	createCodeHighlightPlugin,
	createImageNodeView,
	createProtectedBlockNodeView,
	createProtectedInlineNodeView,
	createTableContainerNodeView,
	createTaskItemNodeView,
	extractBlockMathTex,
	extractInlineMathTex,
	extractMermaidSource,
	type HighlightJsResult,
	type HighlightJsRuntime,
	type ImageNodeViewOptions,
	type KatexRenderOptions,
	type KatexRuntime,
	type MermaidRenderResult,
	type MermaidRuntime,
	type ProtectedAtomLabels,
	type ProtectedAtomNodeViewOptions,
	parseHighlightedHtmlToTokenRanges,
	sanitizeMermaidSvg,
	TableContainerNodeView,
	type TableContainerNodeViewOptions,
	type TaskItemNodeViewOptions,
};
