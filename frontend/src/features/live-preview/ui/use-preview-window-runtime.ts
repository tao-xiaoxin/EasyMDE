import { useLayoutEffect } from "@wordpress/element";
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from "../model/preview-window-model";
import {
	defaultPreviewSurfaceStagingScheduler,
	stagingTime,
} from "./preview-enhancement-staging";
import {
	clearDocumentEndPin,
	readCurrentSourceSnapshot,
	retainedWindowedCommit,
} from "./preview-surface-runtime-helpers";
import {
	type MutablePreviewWindowCommit,
	PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS,
	type PreviewHtmlState,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceSetState,
	type PreviewSurfaceState,
	type PreviewWindowCommitActions,
	type PreviewWindowMountedGeometryMeasurement,
	previewFailureCode,
	previewNeedsWindow,
	previewScrollCanvas,
	previewWindowGeometryEpochKey,
} from "./preview-surface-types";
import {
	captureAcceptedWindowBaseline,
	createAcceptedWindowSnapshot,
	hasMeasuredMountedPreviewWindowGeometry,
	hasPreviewWindowLayoutBox,
	pinAcceptedWindowBaselineNodes,
	verifyPreviewWindowFlowAnchor,
} from "./preview-window-baseline";
import {
	createPreviewWindowRepository,
	measurePreviewWindowBlockGeometry,
	PREVIEW_WINDOW_SPACER_ATTRIBUTE,
	PreviewWindowDomError,
	previewWindowBlockIndexForNode,
	previewWindowFlowDocumentCoordinate,
	publishPreviewWindowMeasuredBlock,
	resetPreviewWindowFlowGeometry,
	viewportForCanvas,
	windowNodes,
} from "./preview-window-dom";
import {
	adoptRetainedOwnedGapForWindow,
	collectPinnedWindowIndices,
	createBeginWindowGeometryPreparation,
	createRevealAcceptedWindowRow,
	installAcceptedWindowCommit,
} from "./preview-window-runtime-ops";

export function usePreviewWindowRuntime(
	props: PreviewSurfaceOwnerProps,
	refs: PreviewSurfaceRefs,
	state: PreviewSurfaceState,
	readyHtml: PreviewHtmlState | null,
	setState: PreviewSurfaceSetState,
	compositionSurfaceVersion: number,
	commits: Pick<
		PreviewWindowCommitActions,
		| "cancelPendingAdoptedMeasurements"
		| "flushPendingAdoptedMeasurements"
		| "materialize"
		| "reconcileInstalledWindowCommit"
	>,
): void {
	const windowedEditing = Boolean(
		props.windowed &&
			("html" !== state.kind || previewNeedsWindow(state.editMap)),
	);

	useLayoutEffect(() => {
		if (!windowedEditing) {
			refs.materializedOverrideRef.current = false;
			void refs.materializeRef.current(false);
			return;
		}
		if (refs.materializationPendingRef.current) {
			// Sink completion clears readyHtml.materializeCommit and reruns this effect;
			// failure publishes the failed phase, cancelling a queued Root unlock.
			return;
		}
		if (refs.materializedOverrideRef.current) {
			// A consumer is using the full surface in this activation. A new windowed
			// activation releases this hold above, before a new unlock can wait here.
			return;
		}
		const surface = refs.surfaceRef.current;
		if (!surface || "html" !== state.kind || "ready" !== state.phase) {
			return;
		}
		let repository = refs.previewWindowRepositoryRef.current;
		if (repository && repository.context.revision !== state.generation) {
			refs.previewWindowRepositoryRef.current = null;
			refs.windowCommitPendingRef.current = false;
			repository = null;
		}
		if (!repository) {
			if (!state.editMap) {
				const documentEndPin = refs.documentEndPinRef.current;
				if (documentEndPin?.generation === state.generation) {
					clearDocumentEndPin(refs, documentEndPin, false);
				}
				props.onDiagnostic?.("preview-window-edit-map-missing");
				setState((current) =>
					"html" === current.kind && current.generation === state.generation
						? {
								...current,
								phase: "failed",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: null,
								windowedFailure: true,
							}
						: current,
				);
				return;
			}
			try {
				repository = createPreviewWindowRepository(surface, state.editMap, {
					revision: state.generation,
					signature: state.signature,
					styleEpoch: refs.windowStyleEpochRef.current,
					widthEpoch: refs.windowWidthEpochRef.current,
				});
				refs.windowGeometryRequiresMeasuredRef.current = false;
			} catch (error) {
				const documentEndPin = refs.documentEndPinRef.current;
				if (documentEndPin?.generation === state.generation) {
					clearDocumentEndPin(refs, documentEndPin, false);
				}
				props.onDiagnostic?.(previewFailureCode(error));
				setState((current) =>
					"html" === current.kind && current.generation === state.generation
						? {
								...current,
								phase: "failed",
								signature: "",
								materializeCommit: null,
								stagedCommit: null,
								windowedCommit: null,
								windowedFailure: true,
							}
						: current,
				);
				return;
			}
			refs.previewWindowRepositoryRef.current = repository;
			if (
				!refs.acceptedWindowBaselineRef.current ||
				refs.acceptedWindowBaselineRef.current.revision !== state.generation ||
				refs.acceptedWindowBaselineRef.current.signature !== state.signature
			) {
				const currentSourceMarkdown =
					refs.committedEnhancementCandidateRef.current?.generation ===
					state.generation
						? refs.committedEnhancementCandidateRef.current.markdown
						: refs.acceptedGeneratedPreviewRef.current?.generation ===
								state.generation
							? refs.acceptedGeneratedPreviewRef.current.markdown
							: (readCurrentSourceSnapshot(refs)?.value ?? null);
				refs.acceptedWindowBaselineRef.current = captureAcceptedWindowBaseline(
					repository,
					state.generation,
					state.signature,
					currentSourceMarkdown,
					readCurrentSourceSnapshot(refs)?.revision ?? null,
				);
				if (!refs.acceptedWindowBaselineRef.current) {
					props.onDiagnostic?.("preview-window-baseline-capture-failed");
					setState((current) =>
						"html" === current.kind && current.generation === state.generation
							? {
									...current,
									phase: "failed",
									signature: "",
									windowedCommit: null,
									windowedFailure: true,
									materializeCommit: null,
									stagedCommit: null,
								}
							: current,
					);
					return;
				}
			}
		}

		const activeRepository = repository;
		const canvas = previewScrollCanvas(surface);
		const documentRef = surface.ownerDocument;
		const windowRef = documentRef.defaultView;
		let frame: number | null = null;
		let disposed = false;
		let pendingMountedGeometry: PreviewWindowMountedGeometryMeasurement | null =
			null;
		if (
			activeRepository.context.styleEpoch !==
				refs.windowStyleEpochRef.current ||
			activeRepository.context.widthEpoch !== refs.windowWidthEpochRef.current
		) {
			const hadMeasuredGeometry =
				refs.installedWindowGeometryContextRef.current !== null;
			activeRepository.context = activeRepository.model.resetEpochs(
				activeRepository.context,
				{
					styleEpoch: refs.windowStyleEpochRef.current,
					widthEpoch: refs.windowWidthEpochRef.current,
				},
			);
			commits.cancelPendingAdoptedMeasurements();
			resetPreviewWindowFlowGeometry(activeRepository);
			if (hadMeasuredGeometry) {
				refs.windowGeometryRequiresMeasuredRef.current = true;
			}
			refs.installedWindowGeometryContextRef.current = null;
		}
		refs.windowWidthRef.current = surface.getBoundingClientRect().width;
		const geometryEpoch = () =>
			previewWindowGeometryEpochKey(activeRepository.context);
		const geometryScheduler =
			props.stagingScheduler ??
			defaultPreviewSurfaceStagingScheduler(surface.ownerDocument);

		const cancelFrame = () => {
			if (null === frame) return;
			if (windowRef?.cancelAnimationFrame) {
				windowRef.cancelAnimationFrame(frame);
			} else {
				windowRef?.clearTimeout(frame);
			}
			frame = null;
		};

		const pinnedIndices = (): readonly number[] =>
			collectPinnedWindowIndices(
				activeRepository,
				surface,
				documentRef,
				refs.documentEndPinRef.current,
			);

		const adoptedOwnedGapState = { current: null as HTMLElement | null };
		const adoptRetainedOwnedGap = (): void =>
			adoptRetainedOwnedGapForWindow(
				activeRepository,
				surface,
				refs,
				adoptedOwnedGapState,
			);

		const revealAcceptedWindowRow = createRevealAcceptedWindowRow({
			activeRepository,
			surface,
			canvas,
			refs,
			setState,
			isDisposed: () => disposed,
			pinnedIndices,
			adoptRetainedOwnedGap,
			onDiagnostic: props.onDiagnostic,
			onWindowReady: props.onWindowReady,
			flushPendingAdoptedMeasurements: commits.flushPendingAdoptedMeasurements,
			reconcileInstalledWindowCommit: commits.reconcileInstalledWindowCommit,
		});
		refs.revealAcceptedWindowRowRef.current = revealAcceptedWindowRow;

		const commitWindow = () => {
			frame = null;
			if (disposed || refs.windowCommitPendingRef.current) return;
			if (
				refs.materializationPendingRef.current ||
				refs.materializedOverrideRef.current
			) {
				// Do not race the sink or replace a consumer's full surface. Pending sink
				// completion restarts setup; a later activation releases a completed hold.
				return;
			}
			if (refs.compositionSurfaceHeldRef.current) {
				// A lease owns the surface: measuring the draft would certify its
				// preedit height. Release re-runs this effect with fresh props.
				return;
			}
			const readyState = refs.stateRef.current;
			const hasInstalledWindow =
				"html" === readyState.kind &&
				"ready" === readyState.phase &&
				Boolean(readyState.windowedCommit);
			const readySourceOwner = hasInstalledWindow
				? refs.currentSourceSnapshotRef.current
				: undefined;
			const readySource = readySourceOwner
				? readCurrentSourceSnapshot(refs)
				: null;
			const readyBaseline = refs.acceptedWindowBaselineRef.current;
			if (
				hasInstalledWindow &&
				(!refs.ownerActiveRef.current ||
					readyState.generation !== activeRepository.context.revision ||
					readyState.htmlRevision !== activeRepository.context.revision ||
					readyState.signature !== activeRepository.context.signature ||
					!readyBaseline ||
					readyBaseline.revision !== readyState.htmlRevision ||
					readyBaseline.signature !== readyState.signature ||
					(readySourceOwner &&
						(!readySource ||
							readySource.value !== readyBaseline.markdown ||
							(null !== readyBaseline.sourceRevision &&
								readySource.revision !== readyBaseline.sourceRevision))))
			) {
				// An existing window reorder is installable only against its accepted
				// DOM generation. A configured source owner must also be ready; an
				// absent optional owner is not the same as a provided null snapshot.
				return;
			}
			try {
				activeRepository.model.assertCurrent(activeRepository.context);
				commits.flushPendingAdoptedMeasurements(activeRepository, surface);
				adoptRetainedOwnedGap();
				if (
					pendingMountedGeometry &&
					pendingMountedGeometry.contextKey !== geometryEpoch()
				) {
					pendingMountedGeometry = null;
				}
				if (!pendingMountedGeometry) {
					const mountedIndices: number[] = [];
					for (const child of Array.from(surface.children)) {
						const index = previewWindowBlockIndexForNode(
							activeRepository,
							surface,
							child,
						);
						if (null !== index) mountedIndices.push(index);
					}
					pendingMountedGeometry = {
						anchorCorrection: 0,
						anchorGeometryMeasured: false,
						anchorIndex: mountedIndices[0] ?? 0,
						contextKey: geometryEpoch(),
						cursor: 0,
						indices: mountedIndices,
					};
				}
				const geometrySliceStartedAt = stagingTime(
					geometryScheduler,
					surface.ownerDocument,
				);
				while (
					pendingMountedGeometry.cursor < pendingMountedGeometry.indices.length
				) {
					const pending: PreviewWindowMountedGeometryMeasurement =
						pendingMountedGeometry;
					const index = pending.indices[pending.cursor];
					pending.cursor += 1;
					if (undefined === index) continue;
					const canReusePreparedGeometry =
						index !== pending.anchorIndex &&
						refs.installedWindowGeometryContextRef.current !==
							geometryEpoch() &&
						activeRepository.flowGeometryEpoch[index] === geometryEpoch() &&
						activeRepository.flowGapEpoch[index] === geometryEpoch();
					if (canReusePreparedGeometry) continue;
					const node = activeRepository.nodes[index];
					if (!node?.isConnected || node.parentNode !== surface) {
						throw new PreviewWindowDomError(
							"preview-window-flow-node-unavailable",
						);
					}
					const rect = node.getBoundingClientRect();
					const hasPositiveHeight =
						(Number.isFinite(rect.height) && rect.height > 0) ||
						node.offsetHeight > 0;
					if (!hasPreviewWindowLayoutBox(node, rect)) {
						if (
							refs.windowGeometryRequiresMeasuredRef.current &&
							activeRepository.flowGeometryEpoch[index] !== geometryEpoch()
						) {
							throw new PreviewWindowDomError(
								"preview-window-flow-measurement-unavailable",
							);
						}
						continue;
					}
					const previousGeometry = activeRepository.flowGeometry[index];
					if (!previousGeometry) {
						throw new PreviewWindowDomError(
							"preview-window-flow-geometry-missing",
						);
					}
					const measurement = measurePreviewWindowBlockGeometry(
						node,
						activeRepository.nodes[index + 1] ?? null,
						previousGeometry,
						activeRepository.ownedGap?.node,
						rect,
					);
					if (!measurement) {
						if (
							refs.windowGeometryRequiresMeasuredRef.current &&
							!hasPositiveHeight &&
							activeRepository.flowGeometryEpoch[index] !== geometryEpoch()
						) {
							throw new PreviewWindowDomError(
								"preview-window-flow-measurement-unavailable",
							);
						}
						if (activeRepository.flowGeometryEpoch[index] !== geometryEpoch()) {
							throw new PreviewWindowDomError(
								"preview-window-flow-transform-unmeasured",
							);
						}
						if (
							index === pending.anchorIndex &&
							activeRepository.flowGeometryEpoch[index] === geometryEpoch()
						)
							pending.anchorGeometryMeasured = true;
						continue;
					}
					if (index === pending.anchorIndex)
						pending.anchorGeometryMeasured = true;
					const publication = publishPreviewWindowMeasuredBlock(
						activeRepository,
						surface,
						index,
						measurement,
						pending.anchorIndex,
						rect,
					);
					pending.anchorCorrection += publication.anchorCorrection;
					if (
						stagingTime(geometryScheduler, surface.ownerDocument) -
							geometrySliceStartedAt >=
						PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS
					) {
						frame = null;
						scheduleWindow();
						return;
					}
				}
				if (
					pendingMountedGeometry.indices.length > 0 &&
					!pendingMountedGeometry.anchorGeometryMeasured
				) {
					// A hidden activation can expose connected roots before their first
					// layout metric. Keep the repository uncommitted; the existing resize
					// observer will re-enter this pass when the surface becomes measurable.
					pendingMountedGeometry.cursor = 0;
					pendingMountedGeometry.anchorCorrection = 0;
					return;
				}
				const anchorCorrection = pendingMountedGeometry.anchorCorrection;
				if (0 !== anchorCorrection) canvas.scrollTop += anchorCorrection;
				const documentEndPin = refs.documentEndPinRef.current;
				const documentEndPinApplies = Boolean(
					documentEndPin?.generation === activeRepository.context.revision &&
						documentEndPin.signature === activeRepository.context.signature &&
						documentEndPin.targetIndices.length > 0,
				);
				const result = activeRepository.model.getWindow({
					context: activeRepository.context,
					pinnedIndices: pinnedIndices(),
					...(documentEndPinApplies
						? { maxMaterialized: DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED }
						: {}),
					viewport: viewportForCanvas(canvas),
				});
				const commit: MutablePreviewWindowCommit = {
					key: ++refs.windowCommitKeyRef.current,
					nodes: [...windowNodes(activeRepository, result)],
					revision: activeRepository.context.revision,
				};
				const deferredAnchor = refs.pendingWindowFlowAnchorRef.current;
				const preserveDeferredAnchor = Boolean(
					deferredAnchor?.node.isConnected &&
						!refs.acceptedWindowSnapshotRef.current,
				);
				if (!preserveDeferredAnchor) {
					const survivingAnchor = commit.nodes.find(
						(node): node is HTMLElement =>
							node instanceof HTMLElement &&
							!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE) &&
							node.parentNode === surface,
					);
					if (survivingAnchor) {
						const anchorRect = survivingAnchor.getBoundingClientRect();
						if (!hasPreviewWindowLayoutBox(survivingAnchor, anchorRect)) {
							pendingMountedGeometry.cursor = 0;
							pendingMountedGeometry.anchorCorrection = 0;
							pendingMountedGeometry.anchorGeometryMeasured = false;
							return;
						}
						const anchorTop = anchorRect.top;
						const documentTop = previewWindowFlowDocumentCoordinate(
							surface,
							anchorTop,
							"preview-window-flow-anchor-invalid",
						);
						refs.pendingWindowFlowAnchorRef.current = Number.isFinite(
							documentTop,
						)
							? {
									documentTop,
									node: survivingAnchor,
								}
							: null;
					} else {
						refs.pendingWindowFlowAnchorRef.current = null;
					}
				}
				pendingMountedGeometry = null;
				if (
					commit.nodes.length === surface.childNodes.length &&
					commit.nodes.every(
						(node, index) => surface.childNodes[index] === node,
					)
				) {
					const pendingAnchor = refs.pendingWindowFlowAnchorRef.current;
					if (pendingAnchor?.node.isConnected) {
						if (
							!hasMeasuredMountedPreviewWindowGeometry(
								activeRepository,
								surface,
								pendingAnchor,
							)
						) {
							scheduleWindow();
							return;
						}
						verifyPreviewWindowFlowAnchor(surface, pendingAnchor);
					}
					refs.pendingWindowFlowAnchorRef.current = null;
					if (!refs.acceptedWindowSnapshotRef.current) {
						const currentState = refs.stateRef.current;
						if (
							"html" === currentState.kind &&
							(currentState.phase === "committing" ||
								currentState.phase === "ready") &&
							currentState.windowedCommit?.revision ===
								activeRepository.context.revision
						) {
							refs.acceptedWindowSnapshotRef.current =
								createAcceptedWindowSnapshot(
									surface,
									activeRepository,
									currentState.windowedCommit,
									currentState,
									refs.acceptedWindowBaselineRef.current,
								);
							refs.installedWindowGeometryContextRef.current =
								previewWindowGeometryEpochKey(activeRepository.context);
						}
					}
					if (refs.acceptedWindowSnapshotRef.current) {
						props.onWindowReady?.();
					}
					return;
				}
				if (hasInstalledWindow) {
					const snapshot = installAcceptedWindowCommit({
						current: readyState,
						repository: activeRepository,
						commit,
						gapRequest: activeRepository.ownedGap
							? { gap: activeRepository.ownedGap.node, retainGap: true }
							: undefined,
						refs,
						surface,
						setState,
						onDiagnostic: props.onDiagnostic,
						onWindowReady: props.onWindowReady,
						reconcileInstalledWindowCommit:
							commits.reconcileInstalledWindowCommit,
					});
					if (!snapshot) {
						throw new PreviewWindowDomError("preview-window-install-refused");
					}
				} else {
					// The first full-DOM to window transition keeps the existing staged
					// installation protocol. The synchronous sink path requires an
					// already installed commit to replace.
					pinAcceptedWindowBaselineNodes(
						refs.acceptedWindowBaselineRef.current,
						commit.nodes,
					);
					refs.windowCommitPendingRef.current = true;
					refs.acceptedWindowSnapshotRef.current = null;
					refs.installedWindowSnapshotRef.current = null;
					refs.pendingWindowCommitRef.current = commit;
					setState((current) =>
						"html" === current.kind &&
						current.generation === activeRepository.context.revision &&
						"ready" === current.phase
							? { ...current, windowedCommit: commit }
							: current,
					);
				}
			} catch (error) {
				refs.windowCommitPendingRef.current = false;
				refs.pendingWindowCommitRef.current = null;
				refs.previewWindowRepositoryRef.current = null;
				props.onDiagnostic?.(previewFailureCode(error));
				setState((current) =>
					"html" === current.kind &&
					current.generation === activeRepository.context.revision
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

		const scheduleWindow = () => {
			if (refs.compositionSurfaceHeldRef.current) return;
			if (disposed || refs.geometryPreparationRef.current || null !== frame)
				return;
			if (
				refs.materializationPendingRef.current ||
				refs.materializedOverrideRef.current
			) {
				// This is the same activation-scoped hold as commitWindow, not a dropped
				// unlock: completion retries setup, failure publishes error, reentry releases.
				return;
			}
			if (windowRef?.requestAnimationFrame) {
				frame = windowRef.requestAnimationFrame(commitWindow);
				return;
			}
			frame = windowRef
				? (windowRef.setTimeout(commitWindow, 0) as unknown as number)
				: (setTimeout(commitWindow, 0) as unknown as number);
		};

		refs.scheduleWindowRef.current = scheduleWindow;

		const onSelectionChange = () => scheduleWindow();
		const onResize = () => {
			const width = surface.getBoundingClientRect().width;
			const previousWidth = refs.windowWidthRef.current;
			if (
				Number.isFinite(width) &&
				width > 0 &&
				null !== previousWidth &&
				Math.abs(width - previousWidth) >= 0.5
			) {
				const hadMeasuredGeometry =
					refs.installedWindowGeometryContextRef.current !== null;
				refs.windowWidthRef.current = width;
				refs.windowWidthEpochRef.current += 1;
				activeRepository.context = activeRepository.model.resetEpochs(
					activeRepository.context,
					{
						styleEpoch: refs.windowStyleEpochRef.current,
						widthEpoch: refs.windowWidthEpochRef.current,
					},
				);
				commits.cancelPendingAdoptedMeasurements();
				resetPreviewWindowFlowGeometry(activeRepository);
				if (hadMeasuredGeometry) {
					refs.windowGeometryRequiresMeasuredRef.current = true;
				}
				refs.installedWindowGeometryContextRef.current = null;
			}
			scheduleWindow();
		};
		const beginGeometryPreparation = createBeginWindowGeometryPreparation({
			activeRepository,
			surface,
			refs,
			setState,
			isDisposed: () => disposed,
			stagingScheduler: props.stagingScheduler,
			onDiagnostic: props.onDiagnostic,
			scheduleWindow,
		});
		const resizeObserverConstructor = windowRef?.ResizeObserver;
		const resizeObserver = resizeObserverConstructor
			? new resizeObserverConstructor(onResize)
			: null;
		canvas.addEventListener("scroll", scheduleWindow, { passive: true });
		documentRef.addEventListener("selectionchange", onSelectionChange);
		windowRef?.addEventListener("resize", onResize);
		resizeObserver?.observe(canvas);
		resizeObserver?.observe(surface);
		if (!beginGeometryPreparation()) scheduleWindow();

		return () => {
			disposed = true;
			if (refs.revealAcceptedWindowRowRef.current === revealAcceptedWindowRow) {
				refs.revealAcceptedWindowRowRef.current = () => null;
			}
			pendingMountedGeometry = null;
			if (
				refs.geometryPreparationRef.current?.revision ===
				activeRepository.context.revision
			) {
				refs.geometryPreparationRef.current.controller.abort();
				refs.geometryPreparationRef.current = null;
			}
			cancelFrame();
			resizeObserver?.disconnect();
			if (refs.scheduleWindowRef.current === scheduleWindow) {
				refs.scheduleWindowRef.current = () => undefined;
			}
			canvas.removeEventListener("scroll", scheduleWindow);
			documentRef.removeEventListener("selectionchange", onSelectionChange);
			windowRef?.removeEventListener("resize", onResize);
		};
	}, [
		state.kind,
		state.generation,
		readyHtml?.editMap,
		readyHtml?.materializeCommit,
		readyHtml?.phase,
		readyHtml?.signature,
		windowedEditing,
		commits.cancelPendingAdoptedMeasurements,
		commits.flushPendingAdoptedMeasurements,
		commits.materialize,
		props.className,
		props.onDiagnostic,
		props.onWindowReady,
		props.style,
		// A suspended setup must wake for the lease's release with the current
		// props instead of staying asleep with stale measurement closures.
		compositionSurfaceVersion,
	]);
}
