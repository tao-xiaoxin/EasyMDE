import { useLayoutEffect } from "@wordpress/element";
import type {
	PreviewAcceptedWindowRowRequest,
	PreviewRequestState,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import { createPreviewRequestSession } from "../model/create-preview-request-session";
import {
	createEnhancementCandidate,
	defaultPreviewSurfaceStagingScheduler,
} from "./preview-enhancement-staging";
import {
	bindDocumentEndPin,
	clearDocumentEndPin,
	prepareDocumentEndWindowPin,
	retainedWindowedCommit,
} from "./preview-surface-runtime-helpers";
import {
	type PreviewGeneratedContentTargetForSelectionRequest,
	type PreviewGeneratedContentTargetRequest,
	type PreviewGeneratedContentTargetSelectionRequest,
	type PreviewHtmlState,
	type PreviewImageTargetRequest,
	type PreviewImageTargetSelectionRequest,
	type PreviewSourceSelection,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceRuntime,
	type PreviewSurfaceSetState,
	type PreviewSurfaceState,
	type PreviewWindowCommitActions,
	previewFailureCode,
	previewNeedsWindow,
	previewScrollCanvas,
	surfaceStatus,
} from "./preview-surface-types";

export function usePreviewRequestLifecycle(
	props: PreviewSurfaceOwnerProps,
	refs: PreviewSurfaceRefs,
	state: PreviewSurfaceState,
	readyHtml: PreviewHtmlState | null,
	setState: PreviewSurfaceSetState,
	commits: Pick<
		PreviewWindowCommitActions,
		| "cancelPendingAdoptedMeasurements"
		| "captureScroll"
		| "discardPendingWork"
		| "discardStaging"
	>,
): void {
	function publishRequestState(requestState: PreviewRequestState): void {
		const generation = ++refs.generationRef.current;
		bindDocumentEndPin(refs, requestState, generation);
		// A pinned selection is a current edit: the editor's own anchor owns this
		// request's viewport. Re-applying the previous review ratio when the
		// formal render lands would displace the already-painted edited row a
		// second time (the same owner is used by native Undo/Redo and by Enter).
		const editOwnedViewport =
			refs.documentEndPinRef.current?.signature ===
			requestState.request.signature;
		// A review ratio must not be captured from a commit that is still painting
		// or enhancing: those phases carry the transient DOM/scroll restore in
		// flight, and replaying that transient ratio would become the next
		// request's final position. Initial/loading content and a ready accepted
		// render keep their existing capture contract.
		const viewportSettled = !(
			"html" === refs.stateRef.current.kind &&
			("committing" === refs.stateRef.current.phase ||
				"enhancing" === refs.stateRef.current.phase)
		);
		if (
			!editOwnedViewport &&
			viewportSettled &&
			("loading" === requestState.kind || "success" === requestState.kind)
		) {
			commits.captureScroll(generation);
		} else {
			refs.scrollSnapshotRef.current = null;
		}
		commits.discardPendingWork();
		refs.previewWindowRepositoryRef.current = null;

		if ("loading" === requestState.kind) {
			setState((current) =>
				"html" === current.kind
					? {
							...current,
							generation,
							phase: "loading",
							signature: "",
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: retainedWindowedCommit(refs, current),
							windowedFailure: false,
						}
					: "paper" === refs.emptyModeRef.current
						? {
								codeTheme: requestState.request.codeTheme,
								editMap: null,
								features: {},
								generation,
								html: "" as SafePreviewHtml,
								htmlRevision: generation,
								kind: "html",
								paperPlaceholder: true,
								phase: "loading",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: null,
								windowedFailure: false,
							}
						: { generation, kind: "loading" },
			);
			return;
		}
		if ("empty" === requestState.kind) {
			setState(
				"paper" === refs.emptyModeRef.current
					? {
							codeTheme: requestState.request.codeTheme,
							editMap: null,
							features: {},
							generation,
							// The empty string is the only HTML value that is intrinsically
							// safe without invoking the server renderer.
							html: "" as SafePreviewHtml,
							htmlRevision: generation,
							kind: "html",
							paperPlaceholder: true,
							phase: "ready",
							signature: requestState.request.signature,
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: null,
						}
					: { generation, kind: "empty" },
			);
			return;
		}
		if ("error" === requestState.kind) {
			setState((current) =>
				"paper" === refs.emptyModeRef.current && "html" === current.kind
					? {
							...current,
							generation,
							phase: "failed",
							signature: "",
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: retainedWindowedCommit(refs, current),
						}
					: { generation, kind: "error" },
			);
			return;
		}
		const activeSurface = refs.surfaceRef.current;
		if (!activeSurface) throw new Error("preview-surface-missing");
		const features = {
			...requestState.response.features,
			...props.featureOverrides,
		};
		const failCandidate = (error: unknown) => {
			if (
				!refs.ownerActiveRef.current ||
				refs.generationRef.current !== generation
			)
				return;
			const documentEndPin = refs.documentEndPinRef.current;
			if (documentEndPin?.generation === generation) {
				clearDocumentEndPin(refs, documentEndPin, false);
			}
			if (refs.scrollSnapshotRef.current?.generation === generation) {
				refs.scrollSnapshotRef.current = null;
			}
			props.onDiagnostic?.(previewFailureCode(error));
			setState((current) => {
				const previousHtml = "html" === current.kind ? current : null;
				return {
					codeTheme: requestState.request.codeTheme,
					editMap: null,
					features,
					generation,
					html: previousHtml?.html ?? ("" as SafePreviewHtml),
					htmlRevision: previousHtml?.htmlRevision ?? generation,
					kind: "html",
					phase: "failed",
					signature: "",
					materializeCommit: null,
					stagedCommit: null,
					windowedCommit: retainedWindowedCommit(refs, current),
					...(refs.windowedRef.current ? { windowedFailure: true } : {}),
				};
			});
		};
		const stageCandidate = () => {
			if (
				!refs.ownerActiveRef.current ||
				refs.generationRef.current !== generation
			)
				return;
			let candidateMarkup: Readonly<{
				sourceNodes: ReadonlyArray<Node>;
				surface: HTMLElement;
			}>;
			const largePreview = previewNeedsWindow(
				requestState.response.editMap ?? null,
			);
			try {
				candidateMarkup = createEnhancementCandidate(
					activeSurface,
					requestState.response.html,
					!refs.windowedRef.current && !largePreview,
					requestState.response.preparedMarkup?.sourceNodes,
				);
			} catch (error) {
				failCandidate(error);
				return;
			}
			refs.enhancementCandidateRef.current = {
				codeTheme: requestState.request.codeTheme,
				editMap: requestState.response.editMap ?? null,
				features,
				generation,
				markdown: requestState.request.markdown,
				requestRevision: requestState.revision,
				serverHtml: requestState.response.html,
				signature: requestState.request.signature,
				sourceNodes: candidateMarkup.sourceNodes,
				surface: candidateMarkup.surface,
			};
			setState((current) => {
				if (refs.generationRef.current !== generation) return current;
				// An installed empty paper placeholder is a presentation the editor
				// already certifies, even though its HTML is empty. Treating it as
				// "no current HTML" hands the sink a pre-acceptance first paint that
				// replaces that accepted surface behind the editor's ledger, so a
				// superseding candidate is qualified the same way while the formal
				// enhancement keeps running.
				const retainedPaper =
					"html" === current.kind && current.paperPlaceholder === true;
				const hasCurrentPresentation =
					retainedPaper ||
					("html" === current.kind && Boolean(current.html.trim()));
				return {
					codeTheme: requestState.request.codeTheme,
					editMap: requestState.response.editMap ?? null,
					features,
					generation,
					html:
						hasCurrentPresentation && "html" === current.kind
							? current.html
							: largePreview
								? ("" as SafePreviewHtml)
								: requestState.response.html,
					htmlRevision:
						hasCurrentPresentation && "html" === current.kind
							? current.htmlRevision
							: generation,
					kind: "html",
					phase: "enhancing",
					signature: "",
					...(retainedPaper ? { paperPlaceholder: true as const } : {}),
					materializeCommit: null,
					stagedCommit:
						!hasCurrentPresentation && !largePreview
							? {
									nodes: candidateMarkup.sourceNodes.map((node) =>
										node.cloneNode(true),
									),
									revision: generation,
								}
							: null,
					windowedCommit: retainedWindowedCommit(refs, current),
				};
			});
		};
		if (
			refs.windowedRef.current &&
			previewNeedsWindow(requestState.response.editMap ?? null)
		) {
			const scheduler =
				props.stagingScheduler ??
				defaultPreviewSurfaceStagingScheduler(activeSurface.ownerDocument);
			void scheduler.yield().then(stageCandidate, failCandidate);
			return;
		}
		stageCandidate();
	}

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");
		refs.ownerActiveRef.current = true;
		// This runtime belongs to exactly this owner activation. A later effect
		// restart replaces the activation, so an old runtime must not acquire a
		// lease against the new owner's surface.
		const runtimeActivation = refs.compositionSurfaceActivationRef.current;
		const session = createPreviewRequestSession({
			initialRevision: props.initialRevision,
			onState: publishRequestState,
			port: props.port,
		});
		const runtime: PreviewSurfaceRuntime = {
			getAcceptedReferenceSource: (
				request: Readonly<{ revision: number; signature: string }>,
			) => {
				const accepted = refs.acceptedGeneratedPreviewRef.current;
				const baseline = refs.acceptedWindowBaselineRef.current;
				return refs.ownerActiveRef.current &&
					runtimeActivation === refs.compositionSurfaceActivationRef.current &&
					refs.windowedRef.current &&
					surface.isConnected &&
					accepted &&
					baseline &&
					accepted.generation === request.revision &&
					baseline.revision === request.revision &&
					accepted.signature === request.signature &&
					baseline.signature === request.signature
					? accepted.markdown
					: null;
			},
			getAcceptedWindowSnapshot: () =>
				refs.getAcceptedWindowSnapshotRef.current(),
			getAcceptedWindowRow: (request: PreviewAcceptedWindowRowRequest) =>
				refs.getAcceptedWindowRowRef.current(request),
			revealAcceptedWindowRow: (
				request: Parameters<
					PreviewSurfaceRuntime["revealAcceptedWindowRow"]
				>[0],
			) => refs.revealAcceptedWindowRowRef.current(request),
			getGeneratedPreviewIdentity: () =>
				refs.getGeneratedPreviewIdentityRef.current(),
			materialize: () => refs.materializeRef.current(),
			prepareGeneratedContentTarget: (
				request: PreviewGeneratedContentTargetRequest,
			) => refs.prepareGeneratedContentTargetRef.current(request),
			prepareGeneratedContentTargetBySelection: (
				request: PreviewGeneratedContentTargetSelectionRequest,
			) => refs.prepareGeneratedContentTargetBySelectionRef.current(request),
			prepareGeneratedContentTargetForSelection: (
				request: PreviewGeneratedContentTargetForSelectionRequest,
			) => refs.prepareGeneratedContentTargetForSelectionRef.current(request),
			prepareImageTarget: (request: PreviewImageTargetRequest) =>
				refs.prepareImageTargetRef.current(request),
			prepareImageTargetBySelection: (
				request: PreviewImageTargetSelectionRequest,
			) => refs.prepareImageTargetBySelectionRef.current(request),
			prepareDocumentEndWindowPin: (
				signature: string,
				sourceSelection?: PreviewSourceSelection,
			) => prepareDocumentEndWindowPin(refs, signature, sourceSelection),
			prepareWindowBlockAdoption: (node: HTMLElement) =>
				refs.prepareWindowBlockAdoptionRef.current(node),
			retainCompositionSurface: () =>
				refs.retainCompositionSurfaceRef.current(runtimeActivation),
			session,
			surface,
		};
		try {
			props.onReady(runtime);
		} catch (error) {
			refs.ownerActiveRef.current = false;
			refs.acceptedWindowBaselineRef.current = null;
			refs.pendingWindowBaselineRef.current = null;
			session.destroy();
			throw error;
		}
		return () => {
			refs.ownerActiveRef.current = false;
			refs.compositionSurfaceActivationRef.current += 1;
			refs.compositionSurfaceLeasesRef.current = 0;
			refs.compositionSurfaceHeldRef.current = false;
			refs.acceptedWindowSnapshotRef.current = null;
			refs.installedWindowSnapshotRef.current = null;
			refs.acceptedGeneratedPreviewRef.current = null;
			refs.ownedGapRef.current = null;
			refs.stagedPreviewImageElementsRef.current = null;
			refs.documentEndPinRef.current = null;
			refs.scrollSnapshotRef.current = null;
			commits.discardStaging();
			props.onDispose?.(runtime);
			session.destroy();
		};
	}, [commits.discardStaging]);

	useLayoutEffect(() => {
		if (props.windowed) {
			// Release the previous activation's full-surface hold before window setup.
			// Do not release a consumer's hold on ordinary rerenders of this activation.
			refs.materializedOverrideRef.current = false;
			return;
		}
		commits.cancelPendingAdoptedMeasurements();
		refs.acceptedWindowSnapshotRef.current = null;
		refs.installedWindowSnapshotRef.current = null;
		const documentEndPin = refs.documentEndPinRef.current;
		if (documentEndPin) clearDocumentEndPin(refs, documentEndPin, false);
	}, [commits.cancelPendingAdoptedMeasurements, props.windowed, refs]);

	useLayoutEffect(() => {
		setState((current) => {
			if ("paper" === props.emptyMode) {
				if ("empty" === current.kind) {
					return {
						codeTheme: props.initial.codeTheme ?? "",
						editMap: props.initial.editMap ?? null,
						features: {},
						generation: current.generation,
						html: "" as SafePreviewHtml,
						htmlRevision: current.generation,
						kind: "html",
						paperPlaceholder: true,
						phase: "ready",
						signature: "",
						materializeCommit: null,
						stagedCommit: null,
						windowedCommit: null,
					};
				}
				if ("loading" === current.kind) {
					return {
						codeTheme: props.initial.codeTheme ?? "",
						editMap: props.initial.editMap ?? null,
						features: {},
						generation: current.generation,
						html: "" as SafePreviewHtml,
						htmlRevision: current.generation,
						kind: "html",
						paperPlaceholder: true,
						phase: "loading",
						signature: "",
						materializeCommit: null,
						stagedCommit: null,
						windowedCommit: null,
					};
				}
				return current;
			}
			if ("html" !== current.kind || !current.paperPlaceholder) {
				return current;
			}
			if ("ready" === current.phase) {
				return { generation: current.generation, kind: "empty" };
			}
			if ("failed" === current.phase) {
				return { generation: current.generation, kind: "error" };
			}
			return { generation: current.generation, kind: "loading" };
		});
	}, [props.emptyMode, props.initial.codeTheme]);

	useLayoutEffect(() => {
		if (!readyHtml) return;
		props.onHtmlChange?.(readyHtml.html);
		props.onSnapshotReady?.(
			readyHtml.html,
			readyHtml.signature,
			readyHtml.editMap,
		);
	}, [
		readyHtml?.html,
		readyHtml?.htmlRevision,
		readyHtml?.signature,
		props.onHtmlChange,
		props.onSnapshotReady,
	]);

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		const snapshot = refs.scrollSnapshotRef.current;
		if (
			surface &&
			snapshot &&
			"html" === state.kind &&
			"ready" === state.phase &&
			state.generation === snapshot.generation &&
			state.htmlRevision === snapshot.generation &&
			refs.acceptedHtmlRevisionRef.current === state.htmlRevision
		) {
			refs.scrollSnapshotRef.current = null;
			props.scrollPort.restore(previewScrollCanvas(surface), snapshot.snapshot);
		}
	}, [state]);

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface) return;
		surface.easymdePreviewSignature =
			"html" === state.kind && "ready" === state.phase ? state.signature : "";
	}, [refs, state]);

	useLayoutEffect(() => {
		props.onStatusChange?.(surfaceStatus(state));
	}, [state, props.onStatusChange]);

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface || !readyHtml || !surface.isConnected) {
			return;
		}
		const images = Array.from(
			surface.querySelectorAll<HTMLImageElement>("img"),
		);
		if (0 === images.length) return;
		const listeners = new Map<HTMLImageElement, () => void>();
		for (const image of images) {
			const notify = () => {
				if (!image.isConnected || !surface.contains(image)) return;
				props.onImageReadinessChange?.();
			};
			listeners.set(image, notify);
			image.addEventListener("load", notify);
			image.addEventListener("error", notify);
			if (image.complete && image.naturalWidth > 0) notify();
		}
		return () => {
			for (const image of images) {
				const notify = listeners.get(image);
				if (!notify) continue;
				image.removeEventListener("load", notify);
				image.removeEventListener("error", notify);
			}
		};
	}, [
		readyHtml?.generation,
		readyHtml?.htmlRevision,
		readyHtml?.signature,
		readyHtml?.stagedCommit?.revision,
		readyHtml?.windowedCommit?.key,
		readyHtml?.materializeCommit?.key,
		props.onImageReadinessChange,
		refs,
	]);
}
