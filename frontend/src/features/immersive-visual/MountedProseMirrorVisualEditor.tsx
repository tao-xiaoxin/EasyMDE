import { createElement, useMemo } from "@wordpress/element";
import type { CSSProperties } from "react";
import type {
	ImmersiveVisualEditorRuntime,
	VisualEditorGeneratedPreviewIdentity,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import {
	createCodeHighlightPlugin,
	createVisualNodeViews,
} from "./node-views/index";
import { ProseMirrorVisualEditor } from "./ProseMirrorVisualEditor";

export type MountedProseMirrorVisualEditorProps = Readonly<{
	className?: string;
	documentSession: EditorDocumentSession;
	editable?: boolean;
	getGeneratedPreviewIdentity?: () => VisualEditorGeneratedPreviewIdentity | null;
	imagePasteUploadEnabled?: boolean;
	imageUploadEnabled?: boolean;
	label?: string;
	onCanonicalDocumentChange?: (markdown: string) => void;
	onDispose?: (runtime: ImmersiveVisualEditorRuntime) => void;
	onFailure?: (code: string) => void;
	onImageDropFiles?: (files: ReadonlyArray<File>, event: DragEvent) => void;
	onImagePasteFiles?: (
		files: ReadonlyArray<File>,
		event: ClipboardEvent,
	) => void;
	onMarkdownChange?: (markdown: string) => void;
	onReady?: (runtime: ImmersiveVisualEditorRuntime) => void;
	style?: CSSProperties;
}>;

/**
 * Lazy-loaded entry component for EasyMDE's unified ProseMirror immersive
 * visual editor. Composes `ProseMirrorVisualEditor` with all custom NodeViews
 * (Mac code frames, resizable images, protected math/mermaid/TOC/footnote
 * atoms, task-list checkboxes, and theme-compatible table containers) plus the
 * incremental highlight.js decoration plugin inside one dynamic ESM chunk.
 */
export function MountedProseMirrorVisualEditor({
	className,
	documentSession,
	editable,
	getGeneratedPreviewIdentity,
	imagePasteUploadEnabled,
	imageUploadEnabled,
	label,
	onCanonicalDocumentChange,
	onDispose,
	onFailure,
	onImageDropFiles,
	onImagePasteFiles,
	onMarkdownChange,
	onReady,
	style,
}: MountedProseMirrorVisualEditorProps) {
	const nodeViews = useMemo(() => createVisualNodeViews(), []);
	const extraPlugins = useMemo(() => [createCodeHighlightPlugin()], []);

	return (
		<ProseMirrorVisualEditor
			documentSession={documentSession}
			extraPlugins={extraPlugins}
			nodeViews={nodeViews}
			{...(className !== undefined ? { className } : {})}
			{...(editable !== undefined ? { editable } : {})}
			{...(getGeneratedPreviewIdentity !== undefined
				? { getGeneratedPreviewIdentity }
				: {})}
			{...(imagePasteUploadEnabled !== undefined
				? { imagePasteUploadEnabled }
				: {})}
			{...(imageUploadEnabled !== undefined ? { imageUploadEnabled } : {})}
			{...(label !== undefined ? { label } : {})}
			{...(onCanonicalDocumentChange !== undefined
				? { onCanonicalDocumentChange }
				: {})}
			{...(onDispose !== undefined ? { onDispose } : {})}
			{...(onFailure !== undefined ? { onFailure } : {})}
			{...(onImageDropFiles !== undefined
				? { onImageDrop: onImageDropFiles }
				: {})}
			{...(onImagePasteFiles !== undefined
				? { onImagePaste: onImagePasteFiles }
				: {})}
			{...(onMarkdownChange !== undefined ? { onMarkdownChange } : {})}
			{...(onReady !== undefined ? { onReady } : {})}
			{...(style !== undefined ? { style } : {})}
		/>
	);
}

export default MountedProseMirrorVisualEditor;
