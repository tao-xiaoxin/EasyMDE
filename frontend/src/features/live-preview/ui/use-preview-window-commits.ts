import { useCallback, useLayoutEffect } from "@wordpress/element";
import { discardEnhancementCandidate } from "./preview-enhancement-staging";
import { acceptedGeneratedPreviewFromCandidate } from "./preview-selection-block-map";
import {
	clearDocumentEndPin,
	readCurrentSourceSnapshot,
	retainedWindowedCommit,
} from "./preview-surface-runtime-helpers";
import {
	type PendingAdoptedBlockMeasurements,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceSetState,
	type PreviewSurfaceState,
	type PreviewWindowCommitActions,
	previewFailureCode,
	previewNeedsWindow,
	previewScrollCanvas,
	previewWindowGeometryEpochKey,
} from "./preview-surface-types";
import {
	createAcceptedWindowSnapshot,
	hasMeasuredMountedPreviewWindowGeometry,
	isFullMaterializedWindowSurface,
	pinAcceptedWindowBaselineNodes,
	verifyPreviewWindowFlowAnchor,
} from "./preview-window-baseline";
import {
	fullMaterializedNodes,
	measurePreviewWindowAdoptedBlock,
	PREVIEW_WINDOW_SPACER_ATTRIBUTE,
	type PreviewWindowNodeRepository,
	reconcilePreviewWindowSpacerFlow,
	validatePreviewWindowRepository,
} from "./preview-window-dom";
import type { SafePreviewHtmlSinkMaterializeCommit } from "./SafePreviewHtmlSink";

export function usePreviewWindowCommits(
	props: PreviewSurfaceOwnerProps,
	refs: PreviewSurfaceRefs,
	state: PreviewSurfaceState,
	setState: PreviewSurfaceSetState,
): PreviewWindowCommitActions {
	const cancelPendingAdoptedMeasurements = useCallback(() => {
		const pending = refs.pendingAdoptedMeasurementsRef.current;
		if (!pending) return;
		if (null !== pending.frame) {
			if (pending.windowRef?.cancelAnimationFrame) {
				pending.windowRef.cancelAnimationFrame(pending.frame);
			} else if (pending.windowRef) {
				pending.windowRef.clearTimeout(pending.frame);
			} else {
				clearTimeout(pending.frame);
			}
		}
		refs.pendingAdoptedMeasurementsRef.current = null;
	}, [refs]);

	const flushPendingAdoptedMeasurements = useCallback(
		(repository?: PreviewWindowNodeRepository, surface?: HTMLElement): void => {
			const pending = refs.pendingAdoptedMeasurementsRef.current;
			if (!pending) return;
			if (
				(repository && pending.repository !== repository) ||
				(surface && pending.surface !== surface)
			) {
				cancelPendingAdoptedMeasurements();
				return;
			}
			cancelPendingAdoptedMeasurements();
			if (
				!refs.ownerActiveRef.current ||
				!refs.windowedRef.current ||
				refs.previewWindowRepositoryRef.current !== pending.repository ||
				refs.surfaceRef.current !== pending.surface ||
				!pending.surface.isConnected
			) {
				return;
			}
			const current = refs.stateRef.current;
			if (
				"html" !== current.kind ||
				current.generation !== pending.repository.context.revision ||
				current.htmlRevision !== pending.repository.context.revision ||
				current.signature !== pending.repository.context.signature
			) {
				return;
			}
			const indices = [...pending.indices].sort((left, right) => left - right);
			for (const index of indices) {
				measurePreviewWindowAdoptedBlock(
					pending.repository,
					pending.surface,
					index,
				);
			}
		},
		[cancelPendingAdoptedMeasurements, refs],
	);

	const scheduleAdoptedBlockMeasurement = useCallback(
		(
			repository: PreviewWindowNodeRepository,
			surface: HTMLElement,
			index: number,
		): void => {
			const existing = refs.pendingAdoptedMeasurementsRef.current;
			if (
				existing &&
				existing.repository === repository &&
				existing.surface === surface
			) {
				existing.indices.add(index);
				return;
			}
			cancelPendingAdoptedMeasurements();
			const windowRef = surface.ownerDocument.defaultView;
			const pending: PendingAdoptedBlockMeasurements = {
				frame: null,
				indices: new Set([index]),
				repository,
				surface,
				windowRef,
			};
			refs.pendingAdoptedMeasurementsRef.current = pending;
			const run = (): void => {
				if (refs.pendingAdoptedMeasurementsRef.current !== pending) return;
				pending.frame = null;
				if (refs.compositionSurfaceHeldRef.current) return;
				try {
					flushPendingAdoptedMeasurements(repository, surface);
				} catch (error) {
					if (
						!refs.ownerActiveRef.current ||
						refs.previewWindowRepositoryRef.current !== repository
					) {
						return;
					}
					refs.previewWindowRepositoryRef.current = null;
					refs.acceptedWindowSnapshotRef.current = null;
					refs.installedWindowSnapshotRef.current = null;
					props.onDiagnostic?.(previewFailureCode(error));
					setState((current) =>
						"html" === current.kind &&
						current.generation === repository.context.revision
							? {
									...current,
									phase: "failed",
									signature: "",
									materializeCommit: null,
									stagedCommit: null,
									windowedCommit: retainedWindowedCommit(refs, current),
									windowedFailure: true,
								}
							: current,
					);
				}
			};
			pending.frame = windowRef?.requestAnimationFrame
				? windowRef.requestAnimationFrame(run)
				: windowRef
					? (windowRef.setTimeout(run, 0) as unknown as number)
					: (setTimeout(run, 0) as unknown as number);
		},
		[
			cancelPendingAdoptedMeasurements,
			flushPendingAdoptedMeasurements,
			props.onDiagnostic,
			refs,
			setState,
		],
	);

	const discardPendingWork = useCallback(() => {
		cancelPendingAdoptedMeasurements();
		refs.geometryPreparationRef.current?.controller.abort();
		refs.geometryPreparationRef.current = null;
		const pendingMaterialization = refs.materializePendingRef.current;
		if (pendingMaterialization) {
			refs.materializePendingRef.current = null;
			refs.materializationPendingRef.current = false;
			pendingMaterialization.resolve(false);
		}
		refs.materializedOverrideRef.current = false;
		refs.pendingWindowCommitRef.current = null;
		refs.windowCommitPendingRef.current = false;
		refs.installedWindowGeometryContextRef.current = null;
		refs.pendingWindowFlowAnchorRef.current = null;
		refs.pendingWindowBaselineRef.current = null;
		refs.acceptedWindowSnapshotRef.current = null;
		refs.installedWindowSnapshotRef.current = null;
		discardEnhancementCandidate(refs.enhancementCandidateRef.current);
		refs.enhancementCandidateRef.current = null;
	}, [cancelPendingAdoptedMeasurements, refs]);

	const discardStaging = useCallback(() => {
		discardPendingWork();
		discardEnhancementCandidate(refs.committedEnhancementCandidateRef.current);
		refs.committedEnhancementCandidateRef.current = null;
		refs.previewWindowRepositoryRef.current = null;
	}, [discardPendingWork, refs]);

	const reconcileInstalledWindowCommit = useCallback(
		(
			repository: PreviewWindowNodeRepository,
			surface: HTMLElement,
			commit: Readonly<{ nodes: ReadonlyArray<Node>; revision: number }>,
		): void => {
			flushPendingAdoptedMeasurements(repository, surface);
			const epoch = previewWindowGeometryEpochKey(repository.context);
			for (const node of commit.nodes) {
				if (
					!(node instanceof HTMLElement) ||
					!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
				)
					continue;
				const reconciliation = reconcilePreviewWindowSpacerFlow(
					repository,
					surface,
					node,
					epoch,
				);
				if (!reconciliation) continue;
				repository.spacerContentHeights.set(
					`${reconciliation.range.start}:${reconciliation.range.end}`,
					{ epoch, height: reconciliation.contentHeight },
				);
			}
		},
		[flushPendingAdoptedMeasurements],
	);

	const beforeStagedCommit = useCallback(
		(revision: number, hasInstalledHtml: boolean): boolean => {
			const current = refs.stateRef.current;
			if ("html" !== current.kind || "committing" !== current.phase)
				return true;
			if (!refs.currentSourceSnapshotRef.current) return true;
			if (
				!refs.ownerActiveRef.current ||
				refs.generationRef.current !== revision ||
				current.generation !== revision
			)
				return false;
			const candidate = refs.committedEnhancementCandidateRef.current;
			if (candidate?.generation === 0 && candidate.requestRevision === null)
				return true;
			const source = readCurrentSourceSnapshot(refs);
			if (
				candidate &&
				candidate.generation === revision &&
				current.signature === candidate.signature &&
				source?.value === candidate.markdown
			)
				return true;
			if (candidate?.generation === revision) {
				discardEnhancementCandidate(candidate);
				refs.committedEnhancementCandidateRef.current = null;
			}
			if (refs.pendingWindowCommitRef.current?.revision === revision) {
				refs.pendingWindowCommitRef.current = null;
				refs.windowCommitPendingRef.current = false;
			}
			if (refs.pendingWindowBaselineRef.current?.revision === revision)
				refs.pendingWindowBaselineRef.current = null;
			if (refs.stagedPreviewImageElementsRef.current?.generation === revision)
				refs.stagedPreviewImageElementsRef.current = null;
			if (
				refs.previewWindowRepositoryRef.current?.context.revision === revision
			)
				refs.previewWindowRepositoryRef.current = null;
			if (refs.scrollSnapshotRef.current?.generation === revision)
				refs.scrollSnapshotRef.current = null;
			const pin = refs.documentEndPinRef.current;
			if (pin?.generation === revision) clearDocumentEndPin(refs, pin, false);
			setState((prev) =>
				"html" === prev.kind &&
				prev.generation === revision &&
				prev.phase === "committing"
					? {
							...prev,
							phase: hasInstalledHtml ? "retained" : "loading",
							signature: "",
							stagedCommit: null,
							windowedCommit: null,
							materializeCommit: null,
						}
					: prev,
			);
			return false;
		},
		[refs, setState],
	);

	const onStagedCommit = useCallback(
		(revision: number) => {
			refs.windowCommitPendingRef.current = false;
			if (refs.pendingWindowCommitRef.current?.revision === revision) {
				refs.pendingWindowCommitRef.current = null;
			}
			const repository = refs.previewWindowRepositoryRef.current;
			if (repository && repository.context.revision !== revision) {
				refs.previewWindowRepositoryRef.current = null;
			}
			const candidate = refs.committedEnhancementCandidateRef.current;
			if (candidate?.generation === revision) {
				const sourceRevision = refs.sourceRevisionRef.current;
				const sourceSnapshot = readCurrentSourceSnapshot(refs);
				if (
					refs.ownerActiveRef.current &&
					sourceSnapshot &&
					sourceSnapshot.value === candidate.markdown &&
					(sourceRevision === null ||
						sourceRevision === sourceSnapshot.revision) &&
					candidate.signature
				) {
					refs.acceptedGeneratedPreviewRef.current =
						acceptedGeneratedPreviewFromCandidate(
							candidate,
							sourceSnapshot.revision,
						);
				} else {
					refs.acceptedGeneratedPreviewRef.current = null;
				}
				candidate.surface.remove();
				refs.committedEnhancementCandidateRef.current = null;
			}
			const committingState = refs.stateRef.current;
			if (
				refs.windowedRef.current &&
				"html" === committingState.kind &&
				("committing" === committingState.phase ||
					"ready" === committingState.phase) &&
				committingState.windowedCommit?.revision === revision
			) {
				const pendingBaseline = refs.pendingWindowBaselineRef.current;
				if (
					pendingBaseline?.revision === revision &&
					pendingBaseline.signature === committingState.signature
				) {
					const installedSource = readCurrentSourceSnapshot(refs);
					// The formal frame may have waited behind a revoked IME lease.
					// Certify its exact source at installation; this renews content
					// ownership only, never the old input/history capability.
					refs.acceptedWindowBaselineRef.current =
						installedSource &&
						installedSource.value === pendingBaseline.markdown
							? Object.freeze({
									...pendingBaseline,
									sourceRevision: installedSource.revision,
								})
							: pendingBaseline;
					refs.pendingWindowBaselineRef.current = null;
				}
				const activeRepository = refs.previewWindowRepositoryRef.current;
				const surface = refs.surfaceRef.current;
				let deferAnchorVerification = false;
				if (activeRepository && surface) {
					try {
						reconcileInstalledWindowCommit(
							activeRepository,
							surface,
							committingState.windowedCommit,
						);
						const pendingAnchor = refs.pendingWindowFlowAnchorRef.current;
						if (
							pendingAnchor?.node.isConnected &&
							!hasMeasuredMountedPreviewWindowGeometry(
								activeRepository,
								surface,
								pendingAnchor,
							)
						) {
							deferAnchorVerification = true;
							refs.scheduleWindowRef.current();
						} else {
							refs.pendingWindowFlowAnchorRef.current = null;
							if (pendingAnchor) {
								verifyPreviewWindowFlowAnchor(surface, pendingAnchor);
							}
						}
					} catch (error) {
						refs.pendingWindowFlowAnchorRef.current = null;
						refs.acceptedWindowSnapshotRef.current = null;
						refs.installedWindowSnapshotRef.current = null;
						props.onDiagnostic?.(previewFailureCode(error));
						refs.previewWindowRepositoryRef.current = null;
						setState((current) =>
							"html" === current.kind && current.generation === revision
								? {
										...current,
										phase: "failed",
										signature: "",
										materializeCommit: null,
										stagedCommit: null,
										windowedCommit: retainedWindowedCommit(refs, current),
										windowedFailure: true,
									}
								: current,
						);
						return;
					}
				}
				refs.installedWindowSnapshotRef.current =
					activeRepository && surface
						? createAcceptedWindowSnapshot(
								surface,
								activeRepository,
								committingState.windowedCommit,
								committingState,
								refs.acceptedWindowBaselineRef.current,
							)
						: null;
				if (!deferAnchorVerification) {
					refs.acceptedWindowSnapshotRef.current =
						refs.installedWindowSnapshotRef.current;
					refs.installedWindowGeometryContextRef.current = activeRepository
						? previewWindowGeometryEpochKey(activeRepository.context)
						: null;
					if (refs.acceptedWindowSnapshotRef.current) {
						props.onWindowReady?.();
					}
				} else {
					refs.acceptedWindowSnapshotRef.current = null;
					refs.installedWindowGeometryContextRef.current = null;
				}
			} else {
				refs.acceptedWindowSnapshotRef.current = null;
				refs.installedWindowSnapshotRef.current = null;
				refs.installedWindowGeometryContextRef.current = null;
			}
			if (
				refs.ownerActiveRef.current &&
				refs.generationRef.current === revision &&
				"html" === committingState.kind &&
				committingState.generation === revision &&
				committingState.htmlRevision === revision &&
				"committing" === committingState.phase
			) {
				refs.acceptedHtmlRevisionRef.current = revision;
			}
			const finish = () => {
				if (
					!refs.ownerActiveRef.current ||
					refs.generationRef.current !== revision
				)
					return;
				setState((current) =>
					"html" === current.kind &&
					current.generation === revision &&
					"committing" === current.phase &&
					(current.stagedCommit?.revision === revision ||
						current.windowedCommit?.revision === revision)
						? { ...current, phase: "ready", stagedCommit: null }
						: current,
				);
				refs.scheduleWindowRef.current();
			};
			finish();
		},
		[
			props.onDiagnostic,
			props.onWindowReady,
			reconcileInstalledWindowCommit,
			refs,
			setState,
		],
	);

	const onMaterializeComplete = useCallback(
		(revision: number, key: number) => {
			const pending = refs.materializePendingRef.current;
			if (
				!refs.ownerActiveRef.current ||
				!pending ||
				pending.revision !== revision ||
				pending.key !== key
			)
				return;
			refs.materializePendingRef.current = null;
			refs.materializationPendingRef.current = false;
			refs.acceptedWindowSnapshotRef.current = null;
			refs.installedWindowSnapshotRef.current = null;
			pending.resolve(true);
			setState((current) =>
				"html" === current.kind &&
				current.generation === revision &&
				current.materializeCommit?.key === key
					? {
							...current,
							materializeCommit: null,
							stagedCommit: null,
							windowedCommit: null,
						}
					: current,
			);
		},
		[refs, setState],
	);

	const onMaterializeFailure = useCallback(
		(revision: number, key: number, error: unknown) => {
			const pending = refs.materializePendingRef.current;
			if (
				!refs.ownerActiveRef.current ||
				!pending ||
				pending.revision !== revision ||
				pending.key !== key
			)
				return;
			refs.materializePendingRef.current = null;
			refs.materializationPendingRef.current = false;
			refs.materializedOverrideRef.current = false;
			refs.windowCommitPendingRef.current = false;
			refs.acceptedWindowSnapshotRef.current = null;
			refs.installedWindowSnapshotRef.current = null;
			refs.previewWindowRepositoryRef.current = null;
			pending.resolve(false);
			props.onDiagnostic?.(previewFailureCode(error));
			setState((current) =>
				"html" === current.kind &&
				current.generation === revision &&
				current.materializeCommit?.key === key
					? {
							...current,
							materializeCommit: null,
							phase: "failed",
							signature: "",
							stagedCommit: null,
							windowedCommit: null,
							windowedFailure: true,
						}
					: current,
			);
		},
		[props.onDiagnostic, refs, setState],
	);

	const materialize = useCallback(
		(reportDiagnostics = true): Promise<boolean> => {
			if (!refs.ownerActiveRef.current) return Promise.resolve(false);
			const currentState = refs.stateRef.current;
			if ("html" !== currentState.kind || "ready" !== currentState.phase) {
				if (reportDiagnostics) {
					props.onDiagnostic?.("preview-window-materialize-not-ready");
				}
				return Promise.resolve(false);
			}
			const repository = refs.previewWindowRepositoryRef.current;
			if (!repository) {
				const surface = refs.surfaceRef.current;
				if (
					refs.materializationPendingRef.current ||
					surface?.querySelector(`[${PREVIEW_WINDOW_SPACER_ATTRIBUTE}]`) ||
					(refs.windowedRef.current && previewNeedsWindow(currentState.editMap))
				) {
					if (reportDiagnostics) {
						props.onDiagnostic?.(
							"preview-window-materialize-repository-unavailable",
						);
					}
					return Promise.resolve(false);
				}
				return Promise.resolve(true);
			}
			if (
				currentState.generation !== repository.context.revision ||
				currentState.htmlRevision !== repository.context.revision ||
				currentState.signature !== repository.context.signature
			) {
				discardPendingWork();
				refs.previewWindowRepositoryRef.current = null;
				if (reportDiagnostics) {
					props.onDiagnostic?.("preview-window-materialize-repository-stale");
				}
				return Promise.resolve(false);
			}
			try {
				validatePreviewWindowRepository(repository);
			} catch (error) {
				props.onDiagnostic?.(previewFailureCode(error));
				return Promise.resolve(false);
			}
			const surface = refs.surfaceRef.current;
			if (!surface) throw new Error("preview-surface-missing");
			const nodes = fullMaterializedNodes(repository);
			pinAcceptedWindowBaselineNodes(
				refs.acceptedWindowBaselineRef.current,
				nodes,
			);
			if (isFullMaterializedWindowSurface(surface, repository)) {
				refs.materializedOverrideRef.current = true;
				return Promise.resolve(true);
			}
			const pending = refs.materializePendingRef.current;
			if (pending?.revision === repository.context.revision) {
				return pending.promise;
			}
			if (pending) {
				refs.materializePendingRef.current = null;
				pending.resolve(false);
			}
			const key = ++refs.materializeCommitKeyRef.current;
			let resolveMaterialization: (completed: boolean) => void = () =>
				undefined;
			const promise = new Promise<boolean>((resolve) => {
				resolveMaterialization = resolve;
			});
			refs.materializePendingRef.current = {
				key,
				promise,
				resolve: resolveMaterialization,
				revision: repository.context.revision,
			};
			refs.materializationPendingRef.current = true;
			refs.materializedOverrideRef.current = true;
			refs.windowCommitPendingRef.current = false;
			refs.acceptedWindowSnapshotRef.current = null;
			refs.installedWindowSnapshotRef.current = null;
			const materializeCommit: SafePreviewHtmlSinkMaterializeCommit = {
				key,
				nodes,
				revision: repository.context.revision,
			};
			setState((current) =>
				"html" === current.kind &&
				"ready" === current.phase &&
				current.htmlRevision === repository.context.revision
					? {
							...current,
							materializeCommit,
							stagedCommit: null,
							windowedCommit: null,
						}
					: current,
			);
			return promise;
		},
		[discardPendingWork, props.onDiagnostic, refs, setState],
	);
	refs.materializeRef.current = materialize;

	useLayoutEffect(() => {
		const pending = refs.materializePendingRef.current;
		if (!pending) return;
		if (
			"html" === state.kind &&
			state.generation === pending.revision &&
			state.materializeCommit?.key === pending.key
		)
			return;
		refs.materializePendingRef.current = null;
		refs.materializationPendingRef.current = false;
		refs.materializedOverrideRef.current = false;
		pending.resolve(false);
	}, [refs, state]);

	const captureScroll = (generation: number): void => {
		if (refs.surfaceRef.current) {
			refs.scrollSnapshotRef.current = {
				generation,
				snapshot: props.scrollPort.capture(
					previewScrollCanvas(refs.surfaceRef.current),
				),
			};
		}
	};

	return {
		cancelPendingAdoptedMeasurements,
		flushPendingAdoptedMeasurements,
		scheduleAdoptedBlockMeasurement,
		discardPendingWork,
		discardStaging,
		reconcileInstalledWindowCommit,
		beforeStagedCommit,
		onStagedCommit,
		onMaterializeComplete,
		onMaterializeFailure,
		materialize,
		captureScroll,
	};
}
