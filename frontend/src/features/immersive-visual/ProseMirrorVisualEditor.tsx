import {
	createElement,
	useEffect,
	useLayoutEffect,
	useRef,
} from "@wordpress/element";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { Slice } from "prosemirror-model";
import { EditorState, type Plugin } from "prosemirror-state";
import { type EditorProps, EditorView } from "prosemirror-view";
import type { CSSProperties } from "react";
import type {
	ImmersiveVisualEditorRuntime,
	VisualEditorGeneratedPreviewIdentity,
	VisualEditorSelection,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { parseMarkdownWithBlockSources } from "./markdown-parser";
import {
	createMarkdownRoundTripGuard,
	type MarkdownRoundTripGuard,
} from "./markdown-serializer";
import { createVisualClipboardPlugin } from "./visual-clipboard-and-paste";
import { createVisualKeymapPlugins } from "./visual-commands";
import { createProseMirrorVisualRuntime } from "./visual-context-menu-adapter";
import { createVisualInputRulesPlugin } from "./visual-input-rules";
import { visualEditorSchema } from "./visual-schema";
import {
	computeVisualSelectionToMarkdownSelection,
	resolveMarkdownSelectionToVisualSelection,
} from "./visual-source-mapping";
import { createVisualTablePlugin } from "./visual-table-operations";

const CANONICAL_SYNC_TRANSACTION_META = "easymdeCanonicalSync";

export type ProseMirrorVisualEditorProps = Readonly<{
	articleThemeClass?: string;
	className?: string;
	documentSession: EditorDocumentSession;
	editable?: boolean;
	extraPlugins?: ReadonlyArray<Plugin>;
	getGeneratedPreviewIdentity?: () => VisualEditorGeneratedPreviewIdentity | null;
	imagePasteUploadEnabled?: boolean;
	imageUploadEnabled?: boolean;
	label?: string;
	nodeViews?: EditorProps["nodeViews"];
	onCanonicalDocumentChange?: (markdown: string) => void;
	onDispose?: (runtime: ImmersiveVisualEditorRuntime) => void;
	onFailure?: (code: string) => void;
	onImageDrop?: (files: ReadonlyArray<File>, event: DragEvent) => void;
	onImagePaste?: (files: ReadonlyArray<File>, event: ClipboardEvent) => void;
	onMarkdownChange?: (markdown: string) => void;
	onReady?: (runtime: ImmersiveVisualEditorRuntime) => void;
	style?: CSSProperties;
}>;

function appendUniqueClasses(target: string[], raw: string | undefined): void {
	if (!raw) {
		return;
	}
	for (const token of raw.trim().split(/\s+/)) {
		if (token.length > 0 && target.indexOf(token) < 0) {
			target.push(token);
		}
	}
}

function buildEditorAttributes(
	articleThemeClass: string | undefined,
	extraClassName: string | undefined,
	label: string | undefined,
): Record<string, string> {
	const classes: string[] = [];
	appendUniqueClasses(classes, "easymde-rendered-content");
	appendUniqueClasses(classes, articleThemeClass);
	appendUniqueClasses(classes, "easymde-code-mac easymde-prosemirror-surface");
	appendUniqueClasses(classes, extraClassName);
	appendUniqueClasses(
		classes,
		"easymde-prosemirror-editor easymde-immersive-visual-editor",
	);
	const normalizedClasses = classes.filter((token) => token !== "ProseMirror");
	return {
		class: normalizedClasses.join(" "),
		role: "textbox",
		"aria-multiline": "true",
		spellcheck: "true",
		...(label && label.length > 0 ? { "aria-label": label } : {}),
	};
}

/**
 * Unified ProseMirror visual editor host for immersive live editing.
 * Handles both short and large (>160-block) documents through one structured
 * in-memory projection over EasyMDE's article theme DOM while keeping canonical
 * Markdown owned by `EditorDocumentSession`.
 */
export function ProseMirrorVisualEditor(props: ProseMirrorVisualEditorProps) {
	const {
		articleThemeClass,
		className,
		documentSession,
		editable = true,
		extraPlugins,
		label,
		nodeViews,
		style,
	} = props;

	const hostRef = useRef<HTMLElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const latestPropsRef = useRef<ProseMirrorVisualEditorProps>(props);
	latestPropsRef.current = props;

	useLayoutEffect(() => {
		const container = hostRef.current;
		if (!container) {
			return;
		}

		let disposed = false;
		let isSelfWriting = false;
		let isComposing = false;
		let pendingCompositionSync = false;

		const disposeAbortController = new AbortController();
		const initialMarkdown = documentSession.document.getValue();
		const initialRevision = documentSession.document.getRevision();
		const initialParsed = parseMarkdownWithBlockSources(initialMarkdown);
		const initialDoc = initialParsed.doc;
		const initialSelection = resolveMarkdownSelectionToVisualSelection(
			initialDoc,
			initialMarkdown,
			documentSession.document.getSelection(),
		);

		let roundTripGuard: MarkdownRoundTripGuard = createMarkdownRoundTripGuard(
			initialMarkdown,
			initialParsed,
		);
		let lastSyncedDoc = initialDoc;
		let lastSyncedMarkdown = initialMarkdown;
		let lastSyncedRevision = initialRevision;

		const runWithEchoSuppressed = <T,>(fn: () => T): T => {
			const previous = isSelfWriting;
			isSelfWriting = true;
			try {
				return fn();
			} finally {
				isSelfWriting = previous;
			}
		};

		const clipboardPlugin = createVisualClipboardPlugin({
			imagePasteUploadEnabled: () =>
				latestPropsRef.current.imagePasteUploadEnabled ?? false,
			imageUploadEnabled: () =>
				latestPropsRef.current.imageUploadEnabled ?? false,
			onImageDrop: (files, event) => {
				latestPropsRef.current.onImageDrop?.(files, event);
			},
			onImagePaste: (files, event) => {
				latestPropsRef.current.onImagePaste?.(files, event);
			},
		});

		const plugins: Plugin[] = [
			history(),
			createVisualInputRulesPlugin(),
			clipboardPlugin,
			dropCursor(),
			gapCursor(),
			createVisualTablePlugin(),
			...createVisualKeymapPlugins(),
			...(extraPlugins ?? []),
		];

		const initialState = EditorState.create({
			doc: initialDoc,
			plugins,
			schema: visualEditorSchema,
			selection: initialSelection,
		});

		const commitProseMirrorDocToCanonical = (activeView: EditorView): void => {
			if (disposed) {
				return;
			}
			// Zero-write-on-read invariant: untouched documents never write back.
			if (
				activeView.state.doc === lastSyncedDoc ||
				activeView.state.doc.eq(lastSyncedDoc)
			) {
				return;
			}
			try {
				const nextMarkdown = roundTripGuard.serialize(activeView.state.doc);
				const currentCanonical = documentSession.document.getValue();
				if (
					nextMarkdown === lastSyncedMarkdown &&
					nextMarkdown === currentCanonical
				) {
					lastSyncedDoc = activeView.state.doc;
					return;
				}

				const nextSelection = computeVisualSelectionToMarkdownSelection(
					activeView.state.doc,
					activeView.state.selection,
					nextMarkdown,
				);

				runWithEchoSuppressed(() => {
					documentSession.document.applyTextChange({
						selection: nextSelection,
						value: nextMarkdown,
					});
					lastSyncedDoc = activeView.state.doc;
					lastSyncedMarkdown = documentSession.document.getValue();
					lastSyncedRevision = documentSession.document.getRevision();
				});

				latestPropsRef.current.onMarkdownChange?.(lastSyncedMarkdown);
				latestPropsRef.current.onCanonicalDocumentChange?.(lastSyncedMarkdown);
			} catch {
				latestPropsRef.current.onFailure?.("visual-editor-sync-failed");
			}
		};

		const view = new EditorView(
			{ mount: container },
			{
				attributes: () =>
					buildEditorAttributes(
						latestPropsRef.current.articleThemeClass,
						latestPropsRef.current.className,
						latestPropsRef.current.label,
					),
				dispatchTransaction(transaction) {
					if (disposed) {
						return;
					}
					const nextState = view.state.apply(transaction);
					view.updateState(nextState);

					if (!transaction.docChanged) {
						return;
					}
					if (transaction.getMeta(CANONICAL_SYNC_TRANSACTION_META) === true) {
						return;
					}
					if (isComposing || view.composing) {
						pendingCompositionSync = true;
						return;
					}
					pendingCompositionSync = false;
					commitProseMirrorDocToCanonical(view);
				},
				editable: () =>
					(latestPropsRef.current.editable ?? true) &&
					documentSession.document.isEditable(),
				...(nodeViews !== undefined ? { nodeViews } : {}),
				state: initialState,
			},
		);

		viewRef.current = view;

		const applyExternalCanonicalUpdate = (
			nextMarkdown: string,
			nextRevision: number,
			targetSelection: VisualEditorSelection,
		): void => {
			if (disposed) {
				return;
			}
			const activeEl = view.dom.ownerDocument.activeElement;
			const wasFocused =
				view.hasFocus() || (activeEl !== null && view.dom.contains(activeEl));

			const nextParsed = parseMarkdownWithBlockSources(nextMarkdown);
			const nextDoc = nextParsed.doc;
			roundTripGuard = createMarkdownRoundTripGuard(nextMarkdown, nextParsed);
			lastSyncedDoc = nextDoc;
			lastSyncedMarkdown = nextMarkdown;
			lastSyncedRevision = nextRevision;
			pendingCompositionSync = false;

			const tr = view.state.tr
				.replace(
					0,
					view.state.doc.content.size,
					new Slice(nextDoc.content, 0, 0),
				)
				.setMeta(CANONICAL_SYNC_TRANSACTION_META, true)
				.setMeta("addToHistory", false);

			const mappedSelection = resolveMarkdownSelectionToVisualSelection(
				tr.doc,
				nextMarkdown,
				targetSelection,
			);
			tr.setSelection(mappedSelection);
			view.dispatch(tr);

			if (wasFocused && view.dom.isConnected) {
				view.focus();
			}
		};

		const flushPendingSync = (): void => {
			if (disposed || isComposing || view.composing) {
				return;
			}
			if (pendingCompositionSync) {
				pendingCompositionSync = false;
				commitProseMirrorDocToCanonical(view);
				return;
			}
			commitProseMirrorDocToCanonical(view);
		};

		const handleCompositionStart = (): void => {
			isComposing = true;
		};

		const handleCompositionEnd = (): void => {
			isComposing = false;
			if (!disposed && pendingCompositionSync) {
				pendingCompositionSync = false;
				commitProseMirrorDocToCanonical(view);
			}
		};

		view.dom.addEventListener("compositionstart", handleCompositionStart);
		view.dom.addEventListener("compositionend", handleCompositionEnd);

		const unsubscribeDocument = documentSession.document.subscribe(() => {
			if (disposed || isSelfWriting) {
				return;
			}
			const nextRevision = documentSession.document.getRevision();
			const nextValue = documentSession.document.getValue();
			if (
				nextRevision === lastSyncedRevision &&
				nextValue === lastSyncedMarkdown
			) {
				return;
			}
			applyExternalCanonicalUpdate(
				nextValue,
				nextRevision,
				documentSession.document.getSelection(),
			);
		});

		const runtime = createProseMirrorVisualRuntime({
			applyExternalCanonicalUpdate,
			disposeSignal: disposeAbortController.signal,
			documentSession,
			flushPendingSync,
			getGeneratedPreviewIdentity: () =>
				latestPropsRef.current.getGeneratedPreviewIdentity?.() ?? null,
			isEditable: () => latestPropsRef.current.editable ?? true,
			onCanonicalDocumentChange: (markdown) => {
				latestPropsRef.current.onCanonicalDocumentChange?.(markdown);
			},
			onMarkdownChange: (markdown) => {
				latestPropsRef.current.onMarkdownChange?.(markdown);
			},
			runWithEchoSuppressed,
			view,
		});

		const teardown = (): void => {
			if (disposed) {
				return;
			}
			disposed = true;
			disposeAbortController.abort();
			unsubscribeDocument();
			view.dom.removeEventListener("compositionstart", handleCompositionStart);
			view.dom.removeEventListener("compositionend", handleCompositionEnd);
			if (viewRef.current === view) {
				viewRef.current = null;
			}
			try {
				latestPropsRef.current.onDispose?.(runtime);
			} finally {
				view.destroy();
			}
		};

		try {
			latestPropsRef.current.onReady?.(runtime);
		} catch (error) {
			disposed = true;
			disposeAbortController.abort();
			unsubscribeDocument();
			view.dom.removeEventListener("compositionstart", handleCompositionStart);
			view.dom.removeEventListener("compositionend", handleCompositionEnd);
			if (viewRef.current === view) {
				viewRef.current = null;
			}
			view.destroy();
			throw error;
		}

		return teardown;
	}, [documentSession, extraPlugins, nodeViews]);

	useEffect(() => {
		const activeView = viewRef.current;
		if (!activeView) {
			return;
		}
		activeView.setProps({
			attributes: () =>
				buildEditorAttributes(articleThemeClass, className, label),
			editable: () => editable && documentSession.document.isEditable(),
		});
	}, [articleThemeClass, className, documentSession, editable, label]);

	return (
		<article
			ref={hostRef}
			data-easymde-prosemirror-host="1"
			{...(style !== undefined ? { style } : {})}
		/>
	);
}
