import {
	createElement,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "@wordpress/element";
import type { SafePreviewHtml } from "../../../contracts/ports/preview-request";
import {
	type PreviewRenderedStylesLease,
	previewEnhancementFailureCode,
} from "../ports/preview-enhancement-port";
import { discardEnhancementCandidate } from "./preview-enhancement-staging";
import { assignGeneratedContentTargetHandlers } from "./preview-generated-content-targets";
import { assignImageTargetHandlers } from "./preview-image-targets";
import {
	type AcceptedGeneratedPreview,
	initialState,
	type PendingPreviewScrollRestore,
	type PreviewEnhancementCandidate,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceRuntime,
	type PreviewSurfaceState,
	previewFailureCode,
	type StagedPreviewImageElements,
} from "./preview-surface-types";
import {
	SafePreviewHtmlSink,
	type SafePreviewHtmlSinkFailureOutcome,
} from "./SafePreviewHtmlSink";
import { usePreviewEnhancementPipeline } from "./use-preview-enhancement-pipeline";
import { usePreviewRequestLifecycle } from "./use-preview-request-lifecycle";
import { usePreviewStagedCommits } from "./use-preview-staged-commits";

export type {
	PreviewGeneratedContentTargetForSelectionRequest,
	PreviewGeneratedContentTargetIndex,
	PreviewGeneratedContentTargetLease,
	PreviewGeneratedContentTargetPinLease,
	PreviewGeneratedContentTargetRequest,
	PreviewGeneratedPreviewIdentity,
	PreviewImageTargetLease,
	PreviewImageTargetPinLease,
	PreviewImageTargetRequest,
	PreviewImageTargetSelectionRequest,
	PreviewSourceSelection,
	PreviewSourceSnapshot,
	PreviewSurfaceRuntime,
	PreviewSurfaceStagingScheduler,
	PreviewSurfaceStatus,
} from "./preview-surface-types";
export { PreviewSurfaceDomError } from "./preview-surface-types";

function previewRollbackFailureCode(error: unknown): string {
	const code = previewFailureCode(error);
	return "preview-enhancement-failed" === code
		? "preview-enhancement-rendered-style-rollback-failed"
		: code;
}

function usePreviewSurfaceRefs(
	props: PreviewSurfaceOwnerProps,
	state: PreviewSurfaceState,
): PreviewSurfaceRefs {
	const surfaceRef = useRef<HTMLElement | null>(null);
	const scrollSnapshotRef = useRef<PendingPreviewScrollRestore | null>(null);
	const generationRef = useRef(0);
	const enhancementCandidateRef = useRef<PreviewEnhancementCandidate | null>(
		null,
	);
	const committedEnhancementCandidateRef =
		useRef<PreviewEnhancementCandidate | null>(null);
	const acceptedHtmlRevisionRef = useRef<number | null>(null);
	const sourceRevisionRef = useRef<number | null>(props.sourceRevision ?? null);
	sourceRevisionRef.current = props.sourceRevision ?? null;
	const currentSourceSnapshotRef = useRef(props.currentSourceSnapshot);
	currentSourceSnapshotRef.current = props.currentSourceSnapshot;
	const acceptedGeneratedPreviewRef = useRef<AcceptedGeneratedPreview | null>(
		null,
	);
	const stagedPreviewImageElementsRef =
		useRef<StagedPreviewImageElements | null>(null);
	const ownerActiveRef = useRef(false);
	const prepareGeneratedContentTargetRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTarget"]
	>(() => null);
	const prepareGeneratedContentTargetForSelectionRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetForSelection"]
	>(() => null);
	const prepareImageTargetRef = useRef<
		PreviewSurfaceRuntime["prepareImageTarget"]
	>(() => null);
	const prepareImageTargetBySelectionRef = useRef<
		PreviewSurfaceRuntime["prepareImageTargetBySelection"]
	>(() => null);
	const getGeneratedPreviewIdentityRef = useRef<
		PreviewSurfaceRuntime["getGeneratedPreviewIdentity"]
	>(() => null);
	const layoutSyncedGenerationRef = useRef<number | null>(null);
	const emptyModeRef = useRef(props.emptyMode);
	emptyModeRef.current = props.emptyMode;
	const stateRef = useRef<PreviewSurfaceState>(state);
	stateRef.current = state;

	const refsBagRef = useRef<PreviewSurfaceRefs | null>(null);
	if (!refsBagRef.current) {
		refsBagRef.current = {
			acceptedGeneratedPreviewRef,
			acceptedHtmlRevisionRef,
			committedEnhancementCandidateRef,
			currentSourceSnapshotRef,
			emptyModeRef,
			enhancementCandidateRef,
			generationRef,
			getGeneratedPreviewIdentityRef,
			layoutSyncedGenerationRef,
			ownerActiveRef,
			prepareGeneratedContentTargetForSelectionRef,
			prepareGeneratedContentTargetRef,
			prepareImageTargetBySelectionRef,
			prepareImageTargetRef,
			scrollSnapshotRef,
			sourceRevisionRef,
			stagedPreviewImageElementsRef,
			stateRef,
			surfaceRef,
		};
	}
	return refsBagRef.current;
}

export function PreviewSurfaceOwner(props: PreviewSurfaceOwnerProps) {
	const [state, setState] = useState<PreviewSurfaceState>(() =>
		initialState(props),
	);
	const refs = usePreviewSurfaceRefs(props, state);
	const onDiagnosticRef = useRef(props.onDiagnostic);
	onDiagnosticRef.current = props.onDiagnostic;
	const renderedStylesLeaseRef = useRef<PreviewRenderedStylesLease | null>(
		null,
	);

	const readyHtml =
		"html" === state.kind && "ready" === state.phase ? state : null;

	const commits = usePreviewStagedCommits(props, refs, setState);

	assignGeneratedContentTargetHandlers(refs);
	assignImageTargetHandlers(refs);

	usePreviewRequestLifecycle(props, refs, state, readyHtml, setState, commits);

	usePreviewEnhancementPipeline(
		props,
		refs,
		state,
		setState,
		commits.captureScroll,
	);

	const failRenderedStyles = useCallback(
		(outcome: SafePreviewHtmlSinkFailureOutcome): void => {
			onDiagnosticRef.current?.(previewFailureCode(outcome.error));
			if ("unverified" === outcome.kind) {
				onDiagnosticRef.current?.(
					previewRollbackFailureCode(outcome.rollbackError),
				);
			}
			const generation = refs.generationRef.current;
			const stagedCandidate = refs.enhancementCandidateRef.current;
			if (stagedCandidate?.generation === generation) {
				discardEnhancementCandidate(stagedCandidate);
				refs.enhancementCandidateRef.current = null;
			}
			const committedCandidate = refs.committedEnhancementCandidateRef.current;
			if (committedCandidate?.generation === generation) {
				discardEnhancementCandidate(committedCandidate);
				refs.committedEnhancementCandidateRef.current = null;
			}
			setState((current) => {
				if ("html" !== current.kind) return current;
				const previous = "restored" === outcome.kind ? outcome.previous : null;
				if (!previous) {
					return {
						...current,
						html: "" as SafePreviewHtml,
						htmlRevision: current.generation,
						phase: "failed",
						signature: "",
						stagedCommit: null,
					};
				}
				return {
					...current,
					html: previous.html ?? ("" as SafePreviewHtml),
					htmlRevision: previous.htmlRevision,
					phase: "failed",
					signature: "",
					stagedCommit: null,
				};
			});
		},
		[refs],
	);

	const onDomMutation = useCallback(
		(surface: HTMLElement): undefined | Error => {
			let nextLease: PreviewRenderedStylesLease;
			try {
				nextLease = props.enhancementPort.scopeRenderedStyles(surface);
			} catch (error) {
				return new Error(previewFailureCode(error));
			}
			const previousLease = renderedStylesLeaseRef.current;
			renderedStylesLeaseRef.current = nextLease;
			try {
				previousLease?.dispose();
			} catch {
				return new Error("preview-enhancement-rendered-style-rollback-failed");
			}
			return undefined;
		},
		[props.enhancementPort],
	);

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");
		const initialStyleError = onDomMutation(surface);
		if (initialStyleError) {
			failRenderedStyles({
				error: initialStyleError,
				kind: "unverified",
				rollbackError: initialStyleError,
			});
		}
		return () => {
			const renderedStylesLease = renderedStylesLeaseRef.current;
			renderedStylesLeaseRef.current = null;
			try {
				renderedStylesLease?.dispose();
			} catch {
				onDiagnosticRef.current?.(
					"preview-enhancement-rendered-style-rollback-failed",
				);
			}
		};
	}, [failRenderedStyles, onDomMutation, refs]);

	useLayoutEffect(() => {
		if (
			"html" !== state.kind ||
			"ready" !== state.phase ||
			refs.layoutSyncedGenerationRef.current === state.generation
		) {
			return;
		}
		const surface = refs.surfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");
		if (!surface.querySelector("pre > code.hljs")) return;
		refs.layoutSyncedGenerationRef.current = state.generation;
		try {
			props.enhancementPort.syncCodeFrameBackgrounds(surface);
		} catch (error) {
			props.onDiagnostic?.(previewEnhancementFailureCode(error));
		}
	}, [state, props.enhancementPort, props.onDiagnostic, refs]);

	const busy =
		"loading" === state.kind ||
		("html" === state.kind &&
			["committing", "enhancing", "loading"].includes(state.phase));
	const failed = "html" === state.kind && "failed" === state.phase;

	return (
		<SafePreviewHtmlSink
			acceptedHtml={
				"html" === state.kind &&
				Boolean(state.html.trim()) &&
				"failed" !== state.phase &&
				refs.acceptedHtmlRevisionRef.current === state.htmlRevision
			}
			ariaBusy={busy}
			beforeStagedCommit={commits.beforeStagedCommit}
			error={failed}
			html={"html" === state.kind ? state.html : null}
			htmlRevision={
				"html" === state.kind ? state.htmlRevision : state.generation
			}
			onDomMutation={onDomMutation}
			onDomMutationFailure={failRenderedStyles}
			onStagedCommit={commits.onStagedCommit}
			phase={"html" === state.kind ? state.phase : state.kind}
			refreshing={busy}
			stagedCommit={"html" === state.kind ? state.stagedCommit : null}
			surfaceRef={refs.surfaceRef}
			{...("empty" === state.kind
				? {
						statusClassName: "easymde-preview-empty",
						statusMessage: props.messages.empty,
					}
				: {})}
			{...("error" === state.kind
				? {
						statusClassName: "easymde-preview-error",
						statusMessage: props.messages.error,
					}
				: {})}
			{...(("loading" === state.kind ||
				("html" === state.kind &&
					"enhancing" === state.phase &&
					!state.html.trim())) &&
			"paper" !== props.emptyMode
				? {
						statusClassName: "easymde-preview-pending",
						statusMessage: props.messages.loading,
						statusRole: "status",
					}
				: {})}
			{...(props.label ? { label: props.label } : {})}
			{...(props.role ? { role: props.role } : {})}
			{...(props.className ? { className: props.className } : {})}
			{...(props.style ? { style: props.style } : {})}
		/>
	);
}
