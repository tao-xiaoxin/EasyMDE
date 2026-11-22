import {
	createElement,
	useLayoutEffect,
	useRef,
	useState,
} from "@wordpress/element";
import { previewEnhancementFailureCode } from "../ports/preview-enhancement-port";
import { assignGeneratedContentTargetHandlers } from "./preview-generated-content-targets";
import { assignImageTargetHandlers } from "./preview-image-targets";
import {
	type AcceptedGeneratedPreview,
	type AcceptedWindowBaseline,
	initialState,
	type MutablePreviewDocumentEndPin,
	type MutablePreviewWindowCommit,
	type PendingAdoptedBlockMeasurements,
	type PendingMaterialization,
	type PendingPreviewScrollRestore,
	type PendingWindowFlowAnchor,
	type PreviewAcceptedWindowSnapshot,
	type PreviewCompositionSurfaceLease,
	type PreviewEnhancementCandidate,
	type PreviewOwnedGap,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceRuntime,
	type PreviewSurfaceState,
	type PreviewWindowGeometryPreparation,
	previewWindowGeometryClassName,
	type StagedPreviewImageElements,
} from "./preview-surface-types";
import type { PreviewWindowNodeRepository } from "./preview-window-dom";
import {
	SafePreviewHtmlSink,
	type SafePreviewHtmlSinkCompositionGate,
	type SafePreviewHtmlSinkWindowController,
} from "./SafePreviewHtmlSink";
import { usePreviewEnhancementPipeline } from "./use-preview-enhancement-pipeline";
import { usePreviewRequestLifecycle } from "./use-preview-request-lifecycle";
import { usePreviewWindowAdoption } from "./use-preview-window-adoption";
import { usePreviewWindowCommits } from "./use-preview-window-commits";
import { usePreviewWindowRuntime } from "./use-preview-window-runtime";

export type {
	PreviewAcceptedWindowSnapshot,
	PreviewCompositionSurfaceLease,
	PreviewDocumentEndPinLease,
	PreviewGeneratedContentTargetForSelectionRequest,
	PreviewGeneratedContentTargetIndex,
	PreviewGeneratedContentTargetLease,
	PreviewGeneratedContentTargetPinLease,
	PreviewGeneratedContentTargetRequest,
	PreviewGeneratedContentTargetSelectionRequest,
	PreviewGeneratedPreviewIdentity,
	PreviewImageTargetLease,
	PreviewImageTargetPinLease,
	PreviewImageTargetRequest,
	PreviewImageTargetSelectionRequest,
	PreviewOwnedGap,
	PreviewSourceSelection,
	PreviewSourceSnapshot,
	PreviewSurfaceRuntime,
	PreviewSurfaceStagingScheduler,
	PreviewSurfaceStatus,
} from "./preview-surface-types";
export {
	isPreviewWindowInstallFault,
	PreviewWindowInstallFault,
} from "./preview-surface-types";

function usePreviewSurfaceRefs(
	props: PreviewSurfaceOwnerProps,
	state: PreviewSurfaceState,
): PreviewSurfaceRefs {
	const surfaceRef = useRef<HTMLElement | null>(null);
	const windowControllerRef =
		useRef<SafePreviewHtmlSinkWindowController | null>(null);
	const ownedGapRef = useRef<PreviewOwnedGap | null>(null);
	const resumeDeferredEnhancementRef = useRef<(() => void) | null>(null);
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
	const previewWindowRepositoryRef = useRef<PreviewWindowNodeRepository | null>(
		null,
	);
	const acceptedWindowBaselineRef = useRef<AcceptedWindowBaseline | null>(null);
	const pendingWindowBaselineRef = useRef<AcceptedWindowBaseline | null>(null);
	const pendingAdoptedMeasurementsRef =
		useRef<PendingAdoptedBlockMeasurements | null>(null);
	const acceptedWindowSnapshotRef =
		useRef<PreviewAcceptedWindowSnapshot | null>(null);
	const installedWindowSnapshotRef =
		useRef<PreviewAcceptedWindowSnapshot | null>(null);
	const pendingWindowCommitRef = useRef<MutablePreviewWindowCommit | null>(
		null,
	);
	const windowCommitKeyRef = useRef(0);
	const windowCommitPendingRef = useRef(false);
	const windowStyleEpochRef = useRef(0);
	const windowWidthEpochRef = useRef(0);
	const windowStyleSignatureRef = useRef("");
	const windowWidthRef = useRef<number | null>(null);
	const geometryPreparationKeyRef = useRef(0);
	const geometryPreparationRef =
		useRef<PreviewWindowGeometryPreparation | null>(null);
	const windowGeometryRequiresMeasuredRef = useRef(false);
	const installedWindowGeometryContextRef = useRef<string | null>(null);
	const pendingWindowFlowAnchorRef = useRef<PendingWindowFlowAnchor | null>(
		null,
	);
	const materializeCommitKeyRef = useRef(0);
	const materializePendingRef = useRef<PendingMaterialization | null>(null);
	const materializationPendingRef = useRef(false);
	const materializedOverrideRef = useRef(false);
	const ownerActiveRef = useRef(false);
	const documentEndPinRef = useRef<MutablePreviewDocumentEndPin | null>(null);
	const compositionSurfaceActivationRef = useRef(0);
	const compositionSurfaceLeasesRef = useRef(0);
	const compositionSurfaceHeldRef = useRef(false);
	const retainCompositionSurfaceRef = useRef<
		(activation: number) => PreviewCompositionSurfaceLease
	>(() => {
		throw new Error("preview-composition-surface-inactive");
	});
	const prepareWindowBlockAdoptionRef = useRef<
		(node: HTMLElement) => (() => boolean) | null
	>(() => null);
	const prepareGeneratedContentTargetRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTarget"]
	>(() => null);
	const prepareGeneratedContentTargetBySelectionRef = useRef<
		PreviewSurfaceRuntime["prepareGeneratedContentTargetBySelection"]
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
	const getAcceptedWindowSnapshotRef = useRef<
		PreviewSurfaceRuntime["getAcceptedWindowSnapshot"]
	>(() => null);
	const getAcceptedWindowRowRef = useRef<
		PreviewSurfaceRuntime["getAcceptedWindowRow"]
	>(() => null);
	const revealAcceptedWindowRowRef = useRef<
		PreviewSurfaceRuntime["revealAcceptedWindowRow"]
	>(() => null);
	const materializeRef = useRef<
		(reportDiagnostics?: boolean) => Promise<boolean>
	>(() => Promise.resolve(false));
	const scheduleWindowRef = useRef<() => void>(() => undefined);
	const windowedRef = useRef(Boolean(props.windowed));
	windowedRef.current = Boolean(props.windowed);
	const layoutSyncedGenerationRef = useRef<number | null>(null);
	const emptyModeRef = useRef(props.emptyMode);
	emptyModeRef.current = props.emptyMode;
	const stateRef = useRef<PreviewSurfaceState>(state);
	stateRef.current = state;

	const refsBagRef = useRef<PreviewSurfaceRefs | null>(null);
	if (!refsBagRef.current) {
		refsBagRef.current = {
			surfaceRef,
			windowControllerRef,
			ownedGapRef,
			resumeDeferredEnhancementRef,
			scrollSnapshotRef,
			generationRef,
			enhancementCandidateRef,
			committedEnhancementCandidateRef,
			acceptedHtmlRevisionRef,
			sourceRevisionRef,
			currentSourceSnapshotRef,
			acceptedGeneratedPreviewRef,
			stagedPreviewImageElementsRef,
			previewWindowRepositoryRef,
			acceptedWindowBaselineRef,
			pendingWindowBaselineRef,
			pendingAdoptedMeasurementsRef,
			acceptedWindowSnapshotRef,
			installedWindowSnapshotRef,
			pendingWindowCommitRef,
			windowCommitKeyRef,
			windowCommitPendingRef,
			windowStyleEpochRef,
			windowWidthEpochRef,
			windowStyleSignatureRef,
			windowWidthRef,
			geometryPreparationKeyRef,
			geometryPreparationRef,
			windowGeometryRequiresMeasuredRef,
			installedWindowGeometryContextRef,
			pendingWindowFlowAnchorRef,
			materializeCommitKeyRef,
			materializePendingRef,
			materializationPendingRef,
			materializedOverrideRef,
			ownerActiveRef,
			documentEndPinRef,
			compositionSurfaceActivationRef,
			compositionSurfaceLeasesRef,
			compositionSurfaceHeldRef,
			retainCompositionSurfaceRef,
			prepareWindowBlockAdoptionRef,
			prepareGeneratedContentTargetRef,
			prepareGeneratedContentTargetBySelectionRef,
			prepareGeneratedContentTargetForSelectionRef,
			prepareImageTargetRef,
			prepareImageTargetBySelectionRef,
			getGeneratedPreviewIdentityRef,
			getAcceptedWindowSnapshotRef,
			getAcceptedWindowRowRef,
			revealAcceptedWindowRowRef,
			materializeRef,
			scheduleWindowRef,
			windowedRef,
			layoutSyncedGenerationRef,
			emptyModeRef,
			stateRef,
		};
	}
	return refsBagRef.current;
}

export function PreviewSurfaceOwner(props: PreviewSurfaceOwnerProps) {
	const [compositionSurfaceVersion, setCompositionSurfaceVersion] = useState(0);
	const [state, setState] = useState<PreviewSurfaceState>(() =>
		initialState(props),
	);
	const refs = usePreviewSurfaceRefs(props, state);

	const compositionSurfaceGate: SafePreviewHtmlSinkCompositionGate = {
		isHeld: () => refs.compositionSurfaceHeldRef.current,
		version: compositionSurfaceVersion,
	};

	const windowStyleSignature = `${previewWindowGeometryClassName(
		props.className,
	)}:${JSON.stringify(props.style ?? {})}`;
	if (refs.windowStyleSignatureRef.current !== windowStyleSignature) {
		refs.windowStyleSignatureRef.current = windowStyleSignature;
		refs.windowStyleEpochRef.current += 1;
	}

	const readyHtml =
		"html" === state.kind && "ready" === state.phase ? state : null;

	const commits = usePreviewWindowCommits(props, refs, state, setState);

	usePreviewWindowAdoption(
		refs,
		setState,
		setCompositionSurfaceVersion,
		compositionSurfaceVersion,
		commits,
	);

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

	usePreviewWindowRuntime(
		props,
		refs,
		state,
		readyHtml,
		setState,
		compositionSurfaceVersion,
		commits,
	);

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
	const effectiveContentEditable =
		props.contentEditable && !("html" === state.kind && state.windowedFailure);

	return (
		<SafePreviewHtmlSink
			beforeStagedCommit={commits.beforeStagedCommit}
			windowControllerRef={refs.windowControllerRef}
			ariaBusy={busy}
			error={failed}
			html={"html" === state.kind ? state.html : null}
			htmlRevision={
				"html" === state.kind ? state.htmlRevision : state.generation
			}
			materializeCommit={"html" === state.kind ? state.materializeCommit : null}
			phase={"html" === state.kind ? state.phase : state.kind}
			{...(props.materializeScheduler
				? { materializeScheduler: props.materializeScheduler }
				: {})}
			onMaterializeComplete={commits.onMaterializeComplete}
			onMaterializeFailure={commits.onMaterializeFailure}
			onStagedCommit={commits.onStagedCommit}
			refreshing={busy}
			compositionGate={compositionSurfaceGate}
			acceptedEmpty={
				"html" === state.kind &&
				"" === state.html &&
				"ready" === state.phase &&
				state.paperPlaceholder === true
			}
			acceptedHtml={
				"html" === state.kind &&
				Boolean(state.html.trim()) &&
				"failed" !== state.phase &&
				refs.acceptedHtmlRevisionRef.current === state.htmlRevision
			}
			surfaceRef={refs.surfaceRef}
			stagedCommit={"html" === state.kind ? state.stagedCommit : null}
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
			{...(undefined !== props.contentEditable
				? { contentEditable: effectiveContentEditable }
				: {})}
			{...(props.label ? { label: props.label } : {})}
			{...(props.role ? { role: props.role } : {})}
			{...(undefined !== props.spellCheck
				? { spellCheck: props.spellCheck }
				: {})}
			{...(props.className ? { className: props.className } : {})}
			{...(props.style ? { style: props.style } : {})}
			windowedCommit={"html" === state.kind ? state.windowedCommit : null}
		/>
	);
}
