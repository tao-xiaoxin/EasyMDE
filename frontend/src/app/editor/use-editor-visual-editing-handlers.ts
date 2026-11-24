import { useCallback } from "@wordpress/element";

import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type { EditorDocumentSession } from "../../features/document-source/ui/EditorDocumentSource";
import { separatedTableInsertion } from "../../features/immersive-editor/immersive-editor";
import type { PreviewSurfaceStatus } from "../../features/live-preview/ui/PreviewSurfaceOwner";
import type { ToolbarCommandPlan } from "../../features/toolbar/toolbar-command-session";
import {
	focusVisualPreviewRuntime,
	isAcceptedDomInvalidatingFailure,
	isCancelledVisualTransferFailure,
	isPreviewRenderFailureCode,
	isSupersededVisualTransferFailure,
	isVisualEditorRuntimeFailureCode,
	syncCodeFrameBackgroundsSafely,
} from "./editor-root-helpers";
import type {
	EditorRootProps,
	EditorStatus,
	EditorStatusState,
	ImmersiveVisualEditorRuntime,
	SharedRef,
	VisualCanonicalChangeContext,
	VisualCanonicalChangeRequest,
	VisualToolbarCommandResult,
} from "./editor-root-types";

export type UseEditorVisualEditingHandlersOptions = Readonly<{
	cancelWechatBackgroundPreparation: () => void;
	contextMenuStrings: EditorRootProps["contextMenuStrings"];
	documentSession: EditorDocumentSession | null;
	enhancementPort: EditorRootProps["enhancementPort"];
	immersiveEnvironment: EditorRootProps["immersiveEnvironment"];
	lastVisualFailureRef: SharedRef<string | null>;
	leaveVisualPreview: (
		options?: Readonly<{ suppressRefresh?: boolean }>,
	) => boolean;
	leaveVisualPreviewRef: SharedRef<
		(options?: Readonly<{ suppressRefresh?: boolean }>) => boolean
	>;
	notifyContextMenuReadiness: () => void;
	preview: EditorRootProps["preview"];
	previewRefreshPendingRef: SharedRef<boolean>;
	previewSurfaceStatusRef: SharedRef<PreviewSurfaceStatus>;
	publishEditorStatus: (status: EditorStatus) => void;
	reportFailure: (code: string) => void;
	rootActiveRef: SharedRef<boolean>;
	rootRef: SharedRef<HTMLDivElement | null>;
	setEditorStatusState: (
		updater: (current: EditorStatusState) => EditorStatusState,
	) => void;
	setPreviewSurfaceStatus: (status: PreviewSurfaceStatus) => void;
	setVisualEditorGeneration: (updater: (generation: number) => number) => void;
	setVisualEditorSurface: (surface: HTMLElement | null) => void;
	setVisualPreviewChanged: (changed: boolean) => void;
	setVisualPreviewPending: (pending: boolean) => void;
	visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
}>;

export function useEditorVisualEditingHandlers({
	cancelWechatBackgroundPreparation,
	contextMenuStrings,
	documentSession,
	enhancementPort,
	immersiveEnvironment,
	lastVisualFailureRef,
	leaveVisualPreview,
	leaveVisualPreviewRef,
	notifyContextMenuReadiness,
	preview,
	previewRefreshPendingRef,
	previewSurfaceStatusRef,
	publishEditorStatus,
	reportFailure,
	rootActiveRef,
	rootRef,
	setEditorStatusState,
	setPreviewSurfaceStatus,
	setVisualEditorGeneration,
	setVisualEditorSurface,
	setVisualPreviewChanged,
	setVisualPreviewPending,
	visualEditorRuntimeRef,
}: UseEditorVisualEditingHandlersOptions) {
	const reportVisualTransferFailure = useCallback(
		(code: string | null) => {
			if (!code || isCancelledVisualTransferFailure(code)) return;
			const message =
				contextMenuStrings?.statusActionFailed ??
				(isPreviewRenderFailureCode(code) ||
				isVisualEditorRuntimeFailureCode(code)
					? preview.messages.error
					: undefined);
			if (!message) return;
			publishEditorStatus({
				id: "visual-transfer-failed",
				message,
				owner: "editor",
				type: "error",
			});
		},
		[
			contextMenuStrings?.statusActionFailed,
			preview.messages.error,
			publishEditorStatus,
		],
	);

	const clearVisualFailureState = useCallback(() => {
		lastVisualFailureRef.current = null;
		rootRef.current?.removeAttribute("data-easymde-visual-failure");
		setEditorStatusState((currentState) =>
			"visual-transfer-failed" === currentState.status?.id
				? { focused: false, status: null }
				: currentState,
		);
	}, [lastVisualFailureRef, rootRef, setEditorStatusState]);

	const handleVisualEditorReady = useCallback(
		(runtime: ImmersiveVisualEditorRuntime) => {
			visualEditorRuntimeRef.current = runtime;
			setVisualEditorSurface(runtime.surface);
			setVisualEditorGeneration((generation) => generation + 1);
			cancelWechatBackgroundPreparation();
			const active = immersiveEnvironment.activeElement();
			const shouldFocus =
				!active ||
				active === runtime.surface.ownerDocument.body ||
				Boolean(rootRef.current?.contains(active));
			if (shouldFocus && runtime.surface.isConnected) {
				if (runtime.focus) {
					runtime.focus();
				} else {
					runtime.surface.focus({ preventScroll: true });
				}
			}
			// One guarded code-frame synchronization per mounted surface. The
			// optional shared runtime may be absent on code-free posts.
			syncCodeFrameBackgroundsSafely(
				enhancementPort,
				runtime.surface,
				reportFailure,
				true,
			);
		},
		[
			cancelWechatBackgroundPreparation,
			enhancementPort,
			immersiveEnvironment,
			reportFailure,
			rootRef,
			setVisualEditorGeneration,
			setVisualEditorSurface,
			visualEditorRuntimeRef,
		],
	);

	const handleVisualEditorDispose = useCallback(
		(runtime: ImmersiveVisualEditorRuntime) => {
			cancelWechatBackgroundPreparation();
			if (visualEditorRuntimeRef.current === runtime) {
				visualEditorRuntimeRef.current = null;
				if (rootActiveRef.current) {
					setVisualEditorSurface(null);
					setVisualEditorGeneration((generation) => generation + 1);
				}
			}
		},
		[
			cancelWechatBackgroundPreparation,
			rootActiveRef,
			setVisualEditorGeneration,
			setVisualEditorSurface,
			visualEditorRuntimeRef,
		],
	);

	const focusVisualPreview = useCallback(() => {
		return focusVisualPreviewRuntime(
			visualEditorRuntimeRef.current,
			immersiveEnvironment.activeElement,
			reportFailure,
		);
	}, [immersiveEnvironment, reportFailure, visualEditorRuntimeRef]);

	const handleVisualFailure = useCallback(
		(code: string) => {
			lastVisualFailureRef.current = code;
			rootRef.current?.setAttribute("data-easymde-visual-failure", code);
			reportFailure(code);
			if (
				isPreviewRenderFailureCode(code) ||
				isVisualEditorRuntimeFailureCode(code)
			) {
				reportVisualTransferFailure(code);
			}
			if (
				isAcceptedDomInvalidatingFailure(code) ||
				"visual-editor-load-failed" === code
			) {
				// Leaving because the accepted DOM is gone - or never loaded - must
				// not schedule a refresh of the source the user was editing. The
				// leave owner is reached through the stable ref, and it also clears
				// the unlocking state so the user can retry the unlock cleanly.
				leaveVisualPreviewRef.current({ suppressRefresh: true });
			}
		},
		[
			lastVisualFailureRef,
			leaveVisualPreviewRef,
			reportFailure,
			reportVisualTransferFailure,
			rootRef,
		],
	);

	const handleVisualMarkdownChange = useCallback(() => {
		clearVisualFailureState();
		if (
			rootActiveRef.current &&
			"error" === previewSurfaceStatusRef.current &&
			!previewRefreshPendingRef.current
		) {
			previewSurfaceStatusRef.current = "ready";
			setPreviewSurfaceStatus("ready");
		}
		// Code-frame backgrounds are owned locally by the ProseMirror code
		// NodeViews; synchronizing them per keystroke would rescan the surface
		// and report the optional shared runtime as unavailable on code-free
		// posts. Readiness and code-theme commits own that synchronization.
		setVisualPreviewChanged(true);
	}, [
		clearVisualFailureState,
		previewRefreshPendingRef,
		previewSurfaceStatusRef,
		rootActiveRef,
		setPreviewSurfaceStatus,
		setVisualPreviewChanged,
	]);

	const handleVisualPendingChange = useCallback(
		(pending: boolean) => {
			if (!rootActiveRef.current) return;
			setVisualPreviewPending(pending);
			// A demand that arrived during the transfer is parked on readiness. The
			// accept effect clears the transfer without a Preview status or snapshot
			// change, so this settle notification is the only wake-up that rebuilds
			// the parked demand against the newly accepted edit map.
			if (!pending) notifyContextMenuReadiness();
		},
		[notifyContextMenuReadiness, rootActiveRef, setVisualPreviewPending],
	);

	const handleVisualCanonicalDocumentChange = useCallback(() => {
		setVisualPreviewChanged(true);
	}, [setVisualPreviewChanged]);

	const reportVisualToolbarFailure = useCallback(() => {
		const message = contextMenuStrings?.statusActionFailed;
		if (!message) return;
		publishEditorStatus({
			id: "visual-toolbar-command-failed",
			message,
			owner: "editor",
			type: "error",
		});
	}, [contextMenuStrings?.statusActionFailed, publishEditorStatus]);

	const reportVisualCanonicalChangeFailure = useCallback(() => {
		const message = contextMenuStrings?.statusActionFailed;
		if (!message) return;
		publishEditorStatus({
			id: "context-menu-visual-canonical-change-failed",
			message,
			owner: "editor",
			type: "error",
		});
	}, [contextMenuStrings?.statusActionFailed, publishEditorStatus]);

	const handleVisualTransferFailure = useCallback(() => {
		const code = lastVisualFailureRef.current;
		lastVisualFailureRef.current = null;
		// The canonical write and the visual transaction that turns it into a
		// stable accepted Preview are different completion owners. A transferred
		// value that already equals the document says nothing about the transfer
		// that failed afterwards, so only a transfer a newer accepted Preview
		// already superseded is the contract's normal re-synchronization path.
		// Every other failure - a rejected Preview, a stale map, a failed commit -
		// stays an explicit failure even when the canonical write of the same
		// request already landed.
		if (null !== code && isSupersededVisualTransferFailure(code)) {
			const runtime = visualEditorRuntimeRef.current;
			if (runtime?.surface.isConnected) {
				runtime.surface.focus({ preventScroll: true });
			}
			return;
		}
		if (null !== code && isPreviewRenderFailureCode(code)) {
			// A formal Preview request failure keeps canonical Markdown intact and
			// visual editing unlocked with a visible privacy-safe alert (already
			// reported by handleVisualFailure), and must not schedule an automatic
			// retry request.
			return;
		}
		reportVisualTransferFailure(code);
		// A terminal transfer failure must not schedule a refresh of the same
		// source: that would be an automatic retry of a protected mutation.
		leaveVisualPreview({ suppressRefresh: true });
	}, [
		lastVisualFailureRef,
		leaveVisualPreview,
		reportVisualTransferFailure,
		visualEditorRuntimeRef,
	]);

	const applyVisualCanonicalChange = useCallback(
		(
			captured: VisualCanonicalChangeContext,
			change: VisualCanonicalChangeRequest["change"],
		): boolean => {
			if ("visual" !== captured.surface) return false;
			const runtime = visualEditorRuntimeRef.current;
			if (!runtime || undefined === captured.revision) {
				reportVisualCanonicalChangeFailure();
				return false;
			}
			const result = runtime.applyCanonicalChange({
				change,
				expected: {
					revision: captured.revision,
					selection: captured.selection,
					value: captured.value,
				},
			});
			if ("handled" !== result) {
				// A blocked, failed, or unsupported transaction is an explicit
				// failure. Compare the canonical value only to decide nothing here:
				// the runtime may have written the request before its Preview
				// transfer or selection map failed, and that half-completed
				// transaction must not be announced as a completed command.
				reportVisualCanonicalChangeFailure();
				return false;
			}
			return true;
		},
		[reportVisualCanonicalChangeFailure, visualEditorRuntimeRef],
	);

	const executeVisualToolbarCommand = useCallback(
		(
			command: ToolbarCommand,
			plan?: () => ToolbarCommandPlan | null,
		): VisualToolbarCommandResult => {
			const runtime = visualEditorRuntimeRef.current;
			if (!runtime) {
				throw new Error("visual-editor-runtime-unavailable");
			}
			if ("image" === command.action) {
				if (!runtime.prepareMediaSelection()) {
					reportVisualToolbarFailure();
					return "blocked";
				}
				return "unsupported";
			}
			const result = runtime.executeCommand(command);
			if ("handled" === result) return result;
			if ("unsupported" !== result) {
				reportVisualToolbarFailure();
				return result;
			}
			if (!runtime.prepareMediaSelection()) {
				reportVisualToolbarFailure();
				return "blocked";
			}
			const planned = plan?.();
			const revision = documentSession?.document.getRevision?.();
			if (planned && undefined !== revision) {
				const canonicalResult = runtime.applyCanonicalChange({
					change: planned.change,
					expected: {
						revision,
						selection: planned.expected.selection,
						value: planned.expected.value,
					},
				});
				if ("handled" === canonicalResult) {
					return canonicalResult;
				}
				reportVisualToolbarFailure();
				return canonicalResult;
			}
			const prepared = runtime.prepareToolbarFallback();
			if (!prepared) {
				reportVisualToolbarFailure();
				return "blocked";
			}
			leaveVisualPreview();
			return "unsupported";
		},
		[
			documentSession,
			leaveVisualPreview,
			reportVisualToolbarFailure,
			visualEditorRuntimeRef,
		],
	);

	/**
	 * Insert an Immersive toolbar table into the mounted visual editor without
	 * leaving visual mode. `null` means no visual owner is mounted, so the
	 * caller keeps its Source-mode insertion path.
	 */
	const insertVisualTable = useCallback(
		(rows: number, columns: number): boolean | null => {
			const runtime = visualEditorRuntimeRef.current;
			if (!runtime || !documentSession) return null;
			if (!runtime.prepareMediaSelection()) {
				reportVisualToolbarFailure();
				return false;
			}
			const document = documentSession.document;
			const revision = document.getRevision?.();
			const value = document.getValue();
			const selection = document.getSelection();
			if (undefined === revision) {
				reportVisualToolbarFailure();
				return false;
			}
			let insertion: ReturnType<typeof separatedTableInsertion>;
			try {
				insertion = separatedTableInsertion(
					value,
					selection.start,
					selection.end,
					rows,
					columns,
				);
			} catch {
				reportVisualToolbarFailure();
				return false;
			}
			const result = runtime.applyCanonicalChange({
				change: {
					changes: {
						from: insertion.from,
						insert: insertion.insert,
						to: insertion.to,
					},
					selection: {
						direction: "none",
						end: insertion.caret,
						start: insertion.caret,
					},
					value:
						value.slice(0, insertion.from) +
						insertion.insert +
						value.slice(insertion.to),
				},
				expected: { revision, selection, value },
			});
			if ("handled" !== result) {
				reportVisualToolbarFailure();
				return false;
			}
			if (runtime.surface.isConnected) {
				if (runtime.focus) runtime.focus();
				else runtime.surface.focus({ preventScroll: true });
			}
			return true;
		},
		[documentSession, reportVisualToolbarFailure, visualEditorRuntimeRef],
	);

	/**
	 * Outline navigation inside the mounted visual editor: scroll the heading
	 * into view, focus the editable surface, and place the caret at the start of
	 * the heading. `null` means no visual owner is mounted.
	 */
	const revealVisualHeading = useCallback(
		(index: number, text: string): boolean | null => {
			const runtime = visualEditorRuntimeRef.current;
			if (!runtime) return null;
			const surface = runtime.surface;
			if (!surface.isConnected) return false;
			const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
			const wanted = normalize(text);
			const headings = Array.from(
				surface.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
			);
			const indexed = headings[index];
			const heading =
				indexed && normalize(indexed.textContent ?? "") === wanted
					? indexed
					: (headings.find(
							(candidate) => normalize(candidate.textContent ?? "") === wanted,
						) ?? indexed);
			if (!heading) return false;
			if (runtime.focus) runtime.focus();
			else surface.focus({ preventScroll: true });
			const ownerDocument = surface.ownerDocument;
			const selection = ownerDocument.defaultView?.getSelection();
			if (selection) {
				const range = ownerDocument.createRange();
				range.setStart(heading, 0);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			if ("function" === typeof heading.scrollIntoView) {
				heading.scrollIntoView({ block: "nearest" });
			}
			return true;
		},
		[visualEditorRuntimeRef],
	);

	return {
		applyVisualCanonicalChange,
		clearVisualFailureState,
		executeVisualToolbarCommand,
		focusVisualPreview,
		handleVisualCanonicalDocumentChange,
		handleVisualEditorDispose,
		handleVisualEditorReady,
		handleVisualFailure,
		handleVisualMarkdownChange,
		handleVisualPendingChange,
		handleVisualTransferFailure,
		insertVisualTable,
		revealVisualHeading,
	};
}
