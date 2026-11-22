import { markdownLineStarts } from "../../../shared/markdown/markdown-line-model";
import {
	defaultPreviewSurfaceStagingScheduler,
	stagingTime,
} from "./preview-enhancement-staging";
import { readCurrentSourceSnapshot } from "./preview-surface-runtime-helpers";
import {
	type MutablePreviewDocumentEndPin,
	type MutablePreviewWindowCommit,
	type MutableRefBox,
	PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS,
	type PreviewAcceptedWindowSnapshot,
	type PreviewHtmlState,
	type PreviewOwnedGap,
	type PreviewSurfaceRefs,
	type PreviewSurfaceRuntime,
	type PreviewSurfaceSetState,
	type PreviewSurfaceStagingScheduler,
	type PreviewWindowGeometryPreparation,
	PreviewWindowInstallFault,
	previewFailureCode,
	previewWindowGeometryEpochKey,
} from "./preview-surface-types";
import {
	certifiedTextTailGapSlice,
	createAcceptedWindowSnapshot,
	hasPreviewWindowLayoutBox,
	isFullMaterializedWindowSurface,
	pinAcceptedWindowBaselineNodes,
} from "./preview-window-baseline";
import {
	capturePreviewWindowFlowBoundary,
	measurePreviewWindowBlockGeometry,
	PREVIEW_WINDOW_SPACER_ATTRIBUTE,
	PreviewWindowDomError,
	type PreviewWindowNodeRepository,
	previewWindowBlockIndexForNode,
	publishPreviewWindowMeasuredBlock,
	validatePreviewWindowRepository,
	viewportForCanvas,
	windowNodes,
} from "./preview-window-dom";
import type { SafePreviewHtmlSinkWindowCommit } from "./SafePreviewHtmlSink";

export function collectPinnedWindowIndices(
	activeRepository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	documentRef: Document,
	documentEndPin: MutablePreviewDocumentEndPin | null,
): readonly number[] {
	const pins = new Set<number>();
	if (activeRepository.ownedGap) {
		pins.add(activeRepository.ownedGap.before);
		if (activeRepository.ownedGap.after !== null)
			pins.add(activeRepository.ownedGap.after);
	}
	const selection = documentRef.getSelection?.();
	if (
		selection &&
		1 === selection.rangeCount &&
		selection.anchorNode === surface &&
		selection.focusNode === surface
	) {
		const start = Math.min(selection.anchorOffset, selection.focusOffset);
		const end = Math.max(selection.anchorOffset, selection.focusOffset);
		for (let childIndex = start; childIndex < end; childIndex += 1) {
			const child = surface.childNodes[childIndex];
			const index = child
				? previewWindowBlockIndexForNode(activeRepository, surface, child)
				: null;
			if (null !== index) pins.add(index);
		}
	}
	const selectionIndex = previewWindowBlockIndexForNode(
		activeRepository,
		surface,
		selection?.anchorNode ?? null,
	);
	if (null !== selectionIndex) pins.add(selectionIndex);
	const focusIndex = previewWindowBlockIndexForNode(
		activeRepository,
		surface,
		selection?.focusNode ?? null,
	);
	if (null !== focusIndex) pins.add(focusIndex);
	const activeIndex = previewWindowBlockIndexForNode(
		activeRepository,
		surface,
		documentRef.activeElement,
	);
	if (null !== activeIndex) pins.add(activeIndex);
	if (
		selection?.isCollapsed &&
		selection.anchorNode === surface &&
		selection.focusNode === surface &&
		selection.anchorOffset === selection.focusOffset
	) {
		if (0 === selection.anchorOffset) pins.add(0);
		if (
			selection.anchorOffset === surface.childNodes.length &&
			activeRepository.nodes.length > 0
		) {
			pins.add(activeRepository.nodes.length - 1);
		}
	}
	if (
		documentEndPin?.generation === activeRepository.context.revision &&
		documentEndPin.signature === activeRepository.context.signature
	) {
		for (const targetIndex of documentEndPin.targetIndices) {
			pins.add(targetIndex);
		}
	}
	return [...pins].sort((left, right) => left - right);
}

/**
 * The window this surface installs has to contain the live presentation
 * of a retained empty-source gap: it is the consumer's own caret row and
 * owns no block. Materialization installs that ownership from a fresh
 * candidate; a gap retained for the value this surface already carries
 * (the document-end sink) never gets a candidate of its own, so a commit
 * that ignored it would delete the caret row the consumer just created.
 * The retained node is adopted only while its certificate still describes
 * the accepted source and its neighbors resolve in the accepted map.
 */
export function adoptRetainedOwnedGapForWindow(
	activeRepository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	refs: PreviewSurfaceRefs,
	adoptedOwnedGapState: MutableRefBox<HTMLElement | null>,
): void {
	const repository = activeRepository;
	if (
		repository.ownedGap &&
		repository.ownedGap.node !== adoptedOwnedGapState.current
	) {
		// Materialization owns this gap for a fresh candidate. It is not
		// this pass's to reinterpret.
		return;
	}
	const retained = refs.ownedGapRef.current;
	const live =
		retained && retained.surface === surface && retained.isLive()
			? retained
			: null;
	if (repository.ownedGap) {
		if (live && repository.ownedGap.node === live.node) return;
		// This pass adopted the node and the consumer has since retired the
		// certificate: the commit must not install the paragraph again.
		delete repository.ownedGap;
		adoptedOwnedGapState.current = null;
	}
	if (!live || live.node.parentNode !== surface) return;
	const markdown = refs.acceptedWindowBaselineRef.current?.markdown ?? null;
	if (
		null === markdown ||
		markdown !== live.markdown ||
		readCurrentSourceSnapshot(refs)?.value !== markdown
	)
		return;
	if (repository.nodes.includes(live.node)) return;
	const starts = markdownLineStarts(markdown);
	const extentIndex = (extent: PreviewOwnedGap["before"]): number | null => {
		let found: number | null = null;
		for (let index = 0; index < repository.blocks.length; index += 1) {
			const block = repository.blocks[index]?.map;
			if (!block) continue;
			const start = starts[block.startLine] ?? markdown.length;
			const end = starts[block.endLine] ?? markdown.length;
			if (
				start !== extent.start ||
				end !== extent.end ||
				markdown.slice(start, end) !== extent.source
			)
				continue;
			if (null !== found) return null;
			found = index;
		}
		return found;
	};
	const before = extentIndex(live.before);
	if (null === before) return;
	const after = extentIndex(live.after);
	const documentEnd =
		null === after &&
		before === repository.blocks.length - 1 &&
		live.after.start === markdown.length &&
		live.after.end === markdown.length &&
		"" === live.after.source;
	if (!documentEnd && (null === after || after !== before + 1)) return;
	// Same certificate predicate as the producer and the formal acceptance.
	if (
		!certifiedTextTailGapSlice(
			markdown.slice(live.before.end, live.after.start),
			live.after.start <= live.before.end + 2,
		)
	)
		return;
	repository.ownedGap = {
		node: live.node,
		before,
		after: documentEnd ? null : after,
	};
	adoptedOwnedGapState.current = live.node;
}

export type InstallAcceptedWindowCommitArgs = Readonly<{
	current: PreviewHtmlState;
	repository: PreviewWindowNodeRepository;
	commit: MutablePreviewWindowCommit;
	gapRequest?: Readonly<{ gap: HTMLElement; retainGap?: boolean }> | undefined;
	refs: PreviewSurfaceRefs;
	surface: HTMLElement;
	setState: PreviewSurfaceSetState;
	onDiagnostic?: ((code: string) => void) | undefined;
	onWindowReady?: (() => void) | undefined;
	reconcileInstalledWindowCommit: (
		repository: PreviewWindowNodeRepository,
		surface: HTMLElement,
		commit: Readonly<{ nodes: ReadonlyArray<Node>; revision: number }>,
	) => void;
}>;

export function installAcceptedWindowCommit(
	args: InstallAcceptedWindowCommitArgs,
): PreviewAcceptedWindowSnapshot | null {
	const {
		current,
		repository,
		commit,
		gapRequest,
		refs,
		surface,
		setState,
		onDiagnostic,
		onWindowReady,
		reconcileInstalledWindowCommit,
	} = args;
	const prepared = (() => {
		try {
			const installedCommit = current.windowedCommit;
			if (!installedCommit) return null;
			const gap = gapRequest?.gap ?? null;
			const retainGap = gapRequest?.retainGap !== false;
			if (!retainGap && gap && !commit.nodes.includes(gap)) return null;
			const nextCommit = {
				...commit,
				nodes:
					retainGap || !gap
						? [...commit.nodes]
						: commit.nodes.filter((node) => node !== gap),
			} satisfies MutablePreviewWindowCommit;
			const baseline = refs.acceptedWindowBaselineRef.current;
			if (
				!baseline ||
				baseline.revision !== current.htmlRevision ||
				baseline.signature !== current.signature ||
				nextCommit.revision !== current.htmlRevision ||
				nextCommit.revision !== current.generation
			)
				throw new Error("preview-window-install-precommit-invalid");
			// Validate every owner-local fact the final snapshot depends on
			// while the previous DOM is still the installed one. Only the
			// post-commit surface comparison remains for
			// createAcceptedWindowSnapshot.
			validatePreviewWindowRepository(repository);
			pinAcceptedWindowBaselineNodes(baseline, nextCommit.nodes);
			return {
				gap,
				nextCommit,
				previous: {
					...installedCommit,
					nodes: Array.from(surface.childNodes),
				} satisfies SafePreviewHtmlSinkWindowCommit,
				retainGap,
			};
		} catch (error) {
			throw new PreviewWindowInstallFault(
				"precommit",
				previewFailureCode(error),
				error,
			);
		}
	})();
	if (!prepared) return null;
	const { gap, nextCommit, previous, retainGap } = prepared;
	let committed = false;
	try {
		committed =
			refs.windowControllerRef.current?.commit(previous, nextCommit) ?? false;
	} catch (error) {
		throw new PreviewWindowInstallFault(
			"installed",
			previewFailureCode(error),
			error,
		);
	}
	// Only a false return or a refusal is a confirmed non-install. Once the
	// sink has started its synchronous write, every later fault belongs to the
	// installed generation and must not be rolled back by the consumer.
	if (!committed) return null;
	const queued = refs.pendingWindowCommitRef.current;
	if (
		queued &&
		queued.key < nextCommit.key &&
		queued.revision === nextCommit.revision
	) {
		// The synchronous install owns this generation now. No older queued
		// window may later replay its node sequence over the installed DOM.
		refs.pendingWindowCommitRef.current = null;
	}
	refs.windowCommitPendingRef.current = false;
	try {
		if (!retainGap && gap) {
			// The temporary document-end caret paragraph is retired by the
			// synchronous sink commit that revealed its target row. It must not
			// survive in the repository or in the accepted snapshot behind the
			// publisher.
			if (refs.ownedGapRef.current?.node === gap)
				refs.ownedGapRef.current = null;
			if (repository.ownedGap?.node === gap) delete repository.ownedGap;
		}
		reconcileInstalledWindowCommit(repository, surface, nextCommit);
		const next: PreviewHtmlState = { ...current, windowedCommit: nextCommit };
		const snapshot = createAcceptedWindowSnapshot(
			surface,
			repository,
			nextCommit,
			next,
			refs.acceptedWindowBaselineRef.current,
		);
		if (!snapshot) throw new Error("preview-window-install-snapshot-invalid");
		refs.stateRef.current = next;
		refs.acceptedWindowSnapshotRef.current = snapshot;
		refs.installedWindowSnapshotRef.current = snapshot;
		refs.installedWindowGeometryContextRef.current =
			previewWindowGeometryEpochKey(repository.context);
		setState((state) => (state === current ? next : state));
		onWindowReady?.();
		return snapshot;
	} catch (error) {
		const code = previewFailureCode(error);
		// The sink already installed nextCommit. From this point on the fault
		// must retain that DOM owner even when certification, snapshot
		// publication, or readiness notification fails. Clearing the commit
		// would let the sink replace the installed nodes with the old HTML.
		const fault = new PreviewWindowInstallFault("installed", code, error);
		refs.acceptedWindowSnapshotRef.current = null;
		refs.installedWindowSnapshotRef.current = null;
		refs.installedWindowGeometryContextRef.current = null;
		refs.pendingWindowCommitRef.current = null;
		refs.windowCommitPendingRef.current = false;
		const failedState: PreviewHtmlState = {
			...current,
			phase: "failed",
			signature: "",
			materializeCommit: null,
			stagedCommit: null,
			windowedCommit: nextCommit,
			windowedFailure: true,
		};
		refs.stateRef.current = failedState;
		setState((state) =>
			"html" === state.kind && state.generation === current.generation
				? failedState
				: state,
		);
		try {
			onDiagnostic?.(code);
		} catch (diagnosticError) {
			// Keep the original installed-stage code and primary cause. The
			// callback failure is retained as metadata, never logged raw.
			throw new PreviewWindowInstallFault(
				"installed",
				code,
				error,
				diagnosticError,
			);
		}
		throw fault;
	}
}

export function createRevealAcceptedWindowRow(
	args: Readonly<{
		activeRepository: PreviewWindowNodeRepository;
		surface: HTMLElement;
		canvas: HTMLElement;
		refs: PreviewSurfaceRefs;
		setState: PreviewSurfaceSetState;
		isDisposed: () => boolean;
		pinnedIndices: () => readonly number[];
		adoptRetainedOwnedGap: () => void;
		onDiagnostic?: ((code: string) => void) | undefined;
		onWindowReady?: (() => void) | undefined;
		flushPendingAdoptedMeasurements: (
			repository?: PreviewWindowNodeRepository,
			surface?: HTMLElement,
		) => void;
		reconcileInstalledWindowCommit: (
			repository: PreviewWindowNodeRepository,
			surface: HTMLElement,
			commit: Readonly<{ nodes: ReadonlyArray<Node>; revision: number }>,
		) => void;
	}>,
): PreviewSurfaceRuntime["revealAcceptedWindowRow"] {
	const {
		activeRepository,
		surface,
		canvas,
		refs,
		setState,
		isDisposed,
		pinnedIndices,
		adoptRetainedOwnedGap,
		onDiagnostic,
		onWindowReady,
		flushPendingAdoptedMeasurements,
		reconcileInstalledWindowCommit,
	} = args;
	return (request) => {
		const current = refs.stateRef.current;
		const source = readCurrentSourceSnapshot(refs);
		const native = surface.ownerDocument.defaultView?.getSelection();
		const retained = refs.ownedGapRef.current;
		const accepted =
			refs.acceptedWindowSnapshotRef.current ??
			refs.installedWindowSnapshotRef.current;
		const reject = (reason: string): null => {
			const children = Array.from(surface.childNodes);
			request.onRefusal?.(reason, {
				active: refs.ownerActiveRef.current,
				windowed: refs.windowedRef.current,
				disposed: isDisposed(),
				compositionHeld: refs.compositionSurfaceHeldRef.current,
				windowPending: refs.windowCommitPendingRef.current,
				materializationPending: refs.materializationPendingRef.current,
				materialized: refs.materializedOverrideRef.current,
				stateReady: "html" === current.kind && current.phase === "ready",
				epochMatches:
					"html" === current.kind &&
					current.generation === request.revision &&
					current.signature === request.signature,
				generationMatches: refs.generationRef.current === request.revision,
				sourceMatches: Boolean(source && source.value === request.source),
				sourceRevisionMatches: source?.revision === request.sourceRevision,
				acceptedPresent: Boolean(accepted),
				acceptedOwnedGapSame: accepted?.ownedGap === request.gap,
				acceptedContainsGap: accepted?.nodes.includes(request.gap) ?? false,
				currentCommitKey:
					"html" === current.kind ? (current.windowedCommit?.key ?? -1) : -1,
				acceptedKey: accepted?.key ?? -1,
				liveChildren: children.length,
				acceptedChildren: accepted?.nodes.length ?? -1,
				liveGapCount: children.filter((node) => node === request.gap).length,
				withoutGapChildren: children.filter((node) => node !== request.gap)
					.length,
				focused: surface.ownerDocument.activeElement === surface,
				inGap: Boolean(
					native?.anchorNode && request.gap.contains(native.anchorNode),
				),
			});
			return null;
		};
		// Formal candidate staging increments generationRef and clears the
		// accepted snapshot before it publishes a queued window for that new
		// generation. The supersession predicate therefore remains a defensive
		// guard, not a path synthesized by the current public lifecycle. The
		// generation check below rejects any reveal begun after that request.
		const queuedWindow = refs.pendingWindowCommitRef.current;
		const queuedWindowIsSupersedable = Boolean(
			queuedWindow &&
				queuedWindow.revision === request.revision &&
				accepted?.revision === request.revision &&
				accepted.signature === request.signature,
		);
		if (
			isDisposed() ||
			!refs.ownerActiveRef.current ||
			!refs.windowedRef.current ||
			refs.compositionSurfaceHeldRef.current ||
			(refs.windowCommitPendingRef.current && !queuedWindowIsSupersedable) ||
			refs.materializationPendingRef.current ||
			refs.materializedOverrideRef.current ||
			"html" !== current.kind ||
			current.phase !== "ready" ||
			!current.windowedCommit ||
			refs.generationRef.current !== request.revision ||
			current.generation !== request.revision ||
			current.signature !== request.signature
		)
			return reject("owner-state");
		if (
			!source ||
			source.value !== request.source ||
			source.revision !== request.sourceRevision
		)
			return reject("source-epoch");
		if (!accepted || accepted.key !== current.windowedCommit.key)
			return reject("accepted-commit");
		if (!refs.getAcceptedWindowRowRef.current(request))
			return reject("row-witness");
		if (
			!retained ||
			retained.node !== request.gap ||
			retained.markdown !== request.source ||
			retained.sourceRevision !== request.sourceRevision ||
			!retained.isLive()
		)
			return reject("gap-lease");
		if (
			surface.ownerDocument.activeElement !== surface ||
			!native?.isCollapsed ||
			!native.anchorNode ||
			!request.gap.contains(native.anchorNode)
		)
			return reject("native-gap");
		// A retained gap can be the caret address for more than one row reveal.
		// Once the first reveal commits, its accepted snapshot contains that gap
		// as owned presentation rather than as an accepted row; remove exactly
		// that node for the row-shape proof so the same live gap can reveal the
		// next accepted row.
		const acceptedRows =
			accepted.ownedGap === request.gap
				? accepted.nodes.filter((node) => node !== request.gap)
				: accepted.nodes;
		const currentWithoutGap = Array.from(surface.childNodes).filter(
			(node) => node !== request.gap,
		);
		if (
			currentWithoutGap.length !== acceptedRows.length ||
			currentWithoutGap.some((node, index) => node !== acceptedRows[index])
		)
			return reject("children-shape");
		adoptRetainedOwnedGap();
		if (activeRepository.ownedGap?.node !== request.gap)
			return reject("gap-adoption");
		const pins = new Set(pinnedIndices());
		pins.add(request.index);
		for (const node of currentWithoutGap) {
			const index = previewWindowBlockIndexForNode(
				activeRepository,
				surface,
				node,
			);
			if (index !== null) pins.add(index);
		}
		flushPendingAdoptedMeasurements(activeRepository, surface);
		const result = activeRepository.model.getWindow({
			context: activeRepository.context,
			pinnedIndices: [...pins],
			viewport: viewportForCanvas(canvas),
		});
		const commit: MutablePreviewWindowCommit = {
			key: ++refs.windowCommitKeyRef.current,
			nodes: [...windowNodes(activeRepository, result)],
			revision: request.revision,
		};
		if (
			!commit.nodes.includes(request.gap) ||
			!commit.nodes.includes(activeRepository.nodes[request.index] as Node) ||
			currentWithoutGap.some(
				(node) =>
					node instanceof HTMLElement &&
					!node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE) &&
					!commit.nodes.includes(node),
			)
		)
			return reject("window-plan");
		const snapshot = installAcceptedWindowCommit({
			current,
			repository: activeRepository,
			commit,
			gapRequest: { gap: request.gap, retainGap: request.retainGap !== false },
			refs,
			surface,
			setState,
			onDiagnostic,
			onWindowReady,
			reconcileInstalledWindowCommit,
		});
		return snapshot ?? reject("sink-commit");
	};
}

export function createBeginWindowGeometryPreparation(
	args: Readonly<{
		activeRepository: PreviewWindowNodeRepository;
		surface: HTMLElement;
		refs: PreviewSurfaceRefs;
		setState: PreviewSurfaceSetState;
		isDisposed: () => boolean;
		stagingScheduler?: PreviewSurfaceStagingScheduler | undefined;
		onDiagnostic?: ((code: string) => void) | undefined;
		scheduleWindow: () => void;
	}>,
): () => boolean {
	const {
		activeRepository,
		surface,
		refs,
		setState,
		isDisposed,
		stagingScheduler,
		onDiagnostic,
		scheduleWindow,
	} = args;
	const geometryEpoch = () =>
		previewWindowGeometryEpochKey(activeRepository.context);

	const beginGeometryPreparation = (): boolean => {
		if (refs.compositionSurfaceHeldRef.current) return false;
		const currentState = refs.stateRef.current;
		if (
			"html" !== currentState.kind ||
			"ready" !== currentState.phase ||
			currentState.windowedCommit ||
			!isFullMaterializedWindowSurface(surface, activeRepository)
		)
			return false;
		const hasLayoutBox = activeRepository.nodes.some((node) =>
			hasPreviewWindowLayoutBox(node, node.getBoundingClientRect()),
		);
		if (!hasLayoutBox) return false;
		const controller = new AbortController();
		const preparation: PreviewWindowGeometryPreparation = {
			controller,
			key: ++refs.geometryPreparationKeyRef.current,
			revision: activeRepository.context.revision,
			styleEpoch: activeRepository.context.styleEpoch,
			widthEpoch: activeRepository.context.widthEpoch,
		};
		refs.geometryPreparationRef.current = preparation;
		const scheduler =
			stagingScheduler ??
			defaultPreviewSurfaceStagingScheduler(surface.ownerDocument);
		const isCurrentPreparation = (): boolean => {
			const context = activeRepository.context;
			return Boolean(
				refs.geometryPreparationRef.current === preparation &&
					!controller.signal.aborted &&
					!refs.compositionSurfaceHeldRef.current &&
					refs.ownerActiveRef.current &&
					refs.previewWindowRepositoryRef.current === activeRepository &&
					refs.generationRef.current === preparation.revision &&
					context.revision === preparation.revision &&
					context.styleEpoch === preparation.styleEpoch &&
					context.widthEpoch === preparation.widthEpoch,
			);
		};
		const isCurrentFullSurface = (): boolean =>
			isCurrentPreparation() &&
			isFullMaterializedWindowSurface(surface, activeRepository);
		void (async () => {
			let sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
			for (let index = 0; index < activeRepository.nodes.length; index += 1) {
				if (!isCurrentPreparation()) return;
				const node = activeRepository.nodes[index];
				if (
					!node ||
					surface.children[index] !== node ||
					!node.isConnected ||
					node.parentNode !== surface ||
					node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
				) {
					throw new PreviewWindowDomError("preview-window-flow-node-missing");
				}
				const rect = node.getBoundingClientRect();
				const hasPositiveHeight =
					(Number.isFinite(rect.height) && rect.height > 0) ||
					node.offsetHeight > 0;
				if (!hasPreviewWindowLayoutBox(node, rect)) {
					throw new PreviewWindowDomError(
						"preview-window-flow-measurement-unavailable",
					);
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
						!hasPositiveHeight
					) {
						throw new PreviewWindowDomError(
							"preview-window-flow-measurement-unavailable",
						);
					}
					throw new PreviewWindowDomError(
						"preview-window-flow-transform-unmeasured",
					);
				}
				publishPreviewWindowMeasuredBlock(
					activeRepository,
					surface,
					index,
					measurement,
					0,
					rect,
				);
				if (
					stagingTime(scheduler, surface.ownerDocument) - sliceStartedAt >=
					PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS
				) {
					await scheduler.yield();
					if (!isCurrentPreparation()) return;
					sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
				}
			}
			if (!isCurrentFullSurface()) return;
			capturePreviewWindowFlowBoundary(
				activeRepository,
				surface,
				geometryEpoch(),
			);
			refs.windowGeometryRequiresMeasuredRef.current = false;
			refs.geometryPreparationRef.current = null;
			scheduleWindow();
		})()
			.catch((error: unknown) => {
				if (!isCurrentPreparation()) return;
				refs.geometryPreparationRef.current = null;
				refs.previewWindowRepositoryRef.current = null;
				onDiagnostic?.(previewFailureCode(error));
				setState((current) =>
					"html" === current.kind && current.generation === preparation.revision
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
			})
			.finally(() => {
				if (refs.geometryPreparationRef.current === preparation) {
					refs.geometryPreparationRef.current = null;
					if (!controller.signal.aborted && !isDisposed()) {
						if (!beginGeometryPreparation()) scheduleWindow();
					}
				}
			});
		return true;
	};

	return beginGeometryPreparation;
}
