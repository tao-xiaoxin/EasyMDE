import {
	createElement,
	useEffect,
	useLayoutEffect,
	useRef,
} from "@wordpress/element";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { EditorState, type Plugin } from "prosemirror-state";
import { type EditorProps, EditorView } from "prosemirror-view";
import type { CSSProperties } from "react";
import type {
	ImmersiveVisualEditorRuntime,
	VisualEditorGeneratedPreviewIdentity,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { createAtomicSelectionAnchorPlugin } from "./visual-boundary-commands";
import {
	CANONICAL_SYNC_TRANSACTION_META,
	createVisualCanonicalSync,
} from "./visual-canonical-sync";
import { createVisualClipboardPlugin } from "./visual-clipboard-and-paste";
import {
	createVisualKeymapPlugins,
	type VisualHistoryCommands,
} from "./visual-commands";
import {
	createVisualCompositionSession,
	type VisualCompositionSession,
} from "./visual-composition-session";
import { createProseMirrorVisualRuntime } from "./visual-context-menu-adapter";
import { createVisualInputRulesPlugin } from "./visual-input-rules";
import { visualEditorSchema } from "./visual-schema";
import { createVisualTablePlugin } from "./visual-table-operations";

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
		let composition: VisualCompositionSession | null = null;
		const disposeAbortController = new AbortController();

		// The canonical CodeMirror document is the single history owner; the
		// projection keeps no ProseMirror history of its own.
		const sync = createVisualCanonicalSync({
			documentSession,
			isCompositionBusy: () => composition?.isBusy() ?? false,
			onCanonicalChange: (markdown) => {
				latestPropsRef.current.onMarkdownChange?.(markdown);
				latestPropsRef.current.onCanonicalDocumentChange?.(markdown);
			},
			onFailure: (code) => {
				latestPropsRef.current.onFailure?.(code);
			},
			onReconciled: () => {
				composition?.reset();
			},
		});

		// Undo/redo always consume the shortcut so browser-native history can
		// never mutate the ProseMirror DOM behind the canonical owner.
		const historyCommands: VisualHistoryCommands = {
			redo: () => {
				if (!disposed) sync.history("redo");
				return true;
			},
			undo: () => {
				if (!disposed) sync.history("undo");
				return true;
			},
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

		// Gap cursor and the atomic selection anchor precede the table plugin
		// (prosemirror-tables ordering contract) so atom-boundary navigation
		// gets its turn before broad table key/mouse handling.
		const plugins: Plugin[] = [
			createVisualInputRulesPlugin(),
			gapCursor(),
			createAtomicSelectionAnchorPlugin(),
			createVisualTablePlugin(),
			clipboardPlugin,
			dropCursor(),
			...createVisualKeymapPlugins(historyCommands),
			...(extraPlugins ?? []),
		];

		const initialState = EditorState.create({
			doc: sync.getAcceptedDoc(),
			plugins,
			schema: visualEditorSchema,
			selection: sync.getInitialSelection(),
		});

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
					const previousState = view.state;
					view.updateState(previousState.apply(transaction));
					if (transaction.getMeta(CANONICAL_SYNC_TRANSACTION_META) === true) {
						return;
					}
					if (!transaction.docChanged) {
						// A caret move or stored-mark toggle ends any typing run.
						if (
							transaction.storedMarksSet ||
							(transaction.selectionSet &&
								!transaction.selection.eq(previousState.selection))
						) {
							sync.breakHistoryGroup();
						}
						return;
					}
					sync.notePendingBase(previousState);
					if (composition?.phase() === "settling") {
						composition.noteSettlingTransaction();
						return;
					}
					if (composition?.isBusy()) {
						return;
					}
					sync.commitPending(transaction);
				},
				editable: () =>
					(latestPropsRef.current.editable ?? true) &&
					documentSession.document.isEditable(),
				handleDOMEvents: {
					beforeinput(_view, event) {
						const inputType = (event as InputEvent).inputType;
						if (inputType !== "historyUndo" && inputType !== "historyRedo") {
							return false;
						}
						event.preventDefault();
						if (!disposed) {
							sync.history(inputType === "historyUndo" ? "undo" : "redo");
						}
						return true;
					},
				},
				...(nodeViews !== undefined ? { nodeViews } : {}),
				state: initialState,
			},
		);

		viewRef.current = view;
		sync.attach(view);
		const activeComposition = createVisualCompositionSession({
			commit: () => sync.commitPending(),
			view,
		});
		composition = activeComposition;

		const settlePendingEdits = async (): Promise<boolean> => {
			if (disposed) return false;
			const settled = await activeComposition.settle();
			return settled && !disposed && sync.settleNow();
		};

		const unsubscribeDocument = documentSession.document.subscribe(() => {
			if (!disposed) sync.handleCanonicalNotification();
		});

		const runtime = createProseMirrorVisualRuntime({
			disposeSignal: disposeAbortController.signal,
			documentSession,
			getGeneratedPreviewIdentity: () =>
				latestPropsRef.current.getGeneratedPreviewIdentity?.() ?? null,
			historyCommands,
			isEditable: () => latestPropsRef.current.editable ?? true,
			settlePendingEdits,
			sync,
			view,
		});

		const release = (): void => {
			disposed = true;
			disposeAbortController.abort();
			unsubscribeDocument();
			activeComposition.dispose();
			sync.dispose();
			if (viewRef.current === view) {
				viewRef.current = null;
			}
		};

		const teardown = (): void => {
			if (disposed) {
				return;
			}
			// Settle a committed-but-unsynced edit before the projection goes away.
			if (!activeComposition.isBusy()) sync.commitPending();
			release();
			try {
				latestPropsRef.current.onDispose?.(runtime);
			} finally {
				view.destroy();
			}
		};

		try {
			latestPropsRef.current.onReady?.(runtime);
		} catch (error) {
			release();
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
