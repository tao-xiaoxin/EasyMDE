import { useLayoutEffect } from "@wordpress/element";
import type { SafePreviewHtml } from "../../../contracts/ports/preview-request";
import { markdownLineStarts } from "../../../shared/markdown/markdown-line-model";
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from "../model/preview-window-model";
import {
	annotateEnhancedPreviewBlocks,
	annotateEnhancedVisualSources,
	capturePreviewBlockMarkers,
	captureVisualMarkdownSources,
	createEnhancementCandidate,
	defaultPreviewSurfaceStagingScheduler,
	measurePreviewWindowCandidateGeometry,
	populateEnhancementCandidate,
	removePreviewBlockMarkers,
	removeVisualMarkdownSourceMarkers,
} from "./preview-enhancement-staging";
import {
	capturePreviewImageElements,
	previewDocumentEndBlockIndex,
	previewSourceSelectionBlockIndices,
} from "./preview-selection-block-map";
import {
	clearDocumentEndPin,
	readCurrentSourceSnapshot,
	retainedWindowedCommit,
} from "./preview-surface-runtime-helpers";
import {
	type MutablePreviewWindowCommit,
	PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS,
	type PreviewOwnedGap,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceSetState,
	type PreviewSurfaceState,
	previewFailureCode,
	previewNeedsWindow,
	previewScrollCanvas,
	type VisualBlockMarker,
	type VisualMarkdownSourceMarker,
} from "./preview-surface-types";
import {
	captureAcceptedWindowBaseline,
	certifiedTextTailGapSlice,
	extendAcceptedWindowBaseline,
	pinAcceptedWindowBaselineNodes,
	readAcceptedWindowBaselineBlock,
} from "./preview-window-baseline";
import {
	createPreviewWindowRepository,
	PreviewWindowDomError,
	type PreviewWindowNodeRepository,
	VISUAL_BLOCK_ATTRIBUTE,
	viewportForCanvas,
	windowNodes,
} from "./preview-window-dom";
import type { SafePreviewHtmlSinkCommit } from "./SafePreviewHtmlSink";

export function usePreviewEnhancementPipeline(
	props: PreviewSurfaceOwnerProps,
	refs: PreviewSurfaceRefs,
	state: PreviewSurfaceState,
	setState: PreviewSurfaceSetState,
	captureScroll: (generation: number) => void,
): void {
	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface || "html" !== state.kind || "enhancing" !== state.phase)
			return;
		const generation = state.generation;
		let candidate = refs.enhancementCandidateRef.current;
		if (!candidate && 0 === generation) {
			const candidateMarkup = createEnhancementCandidate(
				surface,
				state.html,
				!refs.windowedRef.current && !previewNeedsWindow(state.editMap),
			);
			candidate = {
				codeTheme: state.codeTheme,
				editMap: state.editMap,
				features: state.features,
				generation,
				markdown: "",
				requestRevision: null,
				serverHtml: state.html,
				signature: state.signature,
				sourceNodes: candidateMarkup.sourceNodes,
				surface: candidateMarkup.surface,
			};
			refs.enhancementCandidateRef.current = candidate;
		}
		if (!candidate || candidate.generation !== generation) return;
		const activeCandidate = candidate;
		const candidateSurface = activeCandidate.surface;
		const controller = new AbortController();
		let active = true;
		if (refs.generationRef.current !== generation) return;
		let visualSources: ReadonlyArray<VisualMarkdownSourceMarker> = [];
		let blockMarkers: ReadonlyArray<VisualBlockMarker> = [];
		const isCurrent = () => active && refs.generationRef.current === generation;

		const failEnhancement = (error: unknown) => {
			if (!isCurrent()) return;
			const documentEndPin = refs.documentEndPinRef.current;
			if (documentEndPin?.generation === generation) {
				clearDocumentEndPin(refs, documentEndPin, false);
			}
			if (refs.scrollSnapshotRef.current?.generation === generation) {
				refs.scrollSnapshotRef.current = null;
			}
			removeVisualMarkdownSourceMarkers(visualSources);
			removePreviewBlockMarkers(blockMarkers);
			candidateSurface.remove();
			props.onDiagnostic?.(previewFailureCode(error));
			refs.enhancementCandidateRef.current = null;
			refs.pendingWindowBaselineRef.current = null;
			if (
				refs.previewWindowRepositoryRef.current?.context.revision === generation
			) {
				refs.previewWindowRepositoryRef.current = null;
			}
			setState((current) => {
				if ("html" !== current.kind || current.generation !== generation) {
					return current;
				}
				const retainedWindow =
					refs.windowedRef.current && "paper" === refs.emptyModeRef.current
						? retainedWindowedCommit(refs, current)
						: null;
				if (retainedWindow) {
					return {
						...current,
						phase: "failed",
						signature: "",
						materializeCommit: null,
						stagedCommit: null,
						windowedCommit: retainedWindow,
						windowedFailure: false,
					};
				}
				return {
					...current,
					html: activeCandidate.serverHtml,
					htmlRevision: generation,
					phase: "failed",
					signature: "",
					materializeCommit: null,
					stagedCommit: null,
					windowedCommit: null,
					...(refs.windowedRef.current ? { windowedFailure: true } : {}),
				};
			});
		};

		const runEnhancement = async (): Promise<void> => {
			try {
				const scheduler =
					props.stagingScheduler ??
					defaultPreviewSurfaceStagingScheduler(candidateSurface.ownerDocument);
				if (
					!(await populateEnhancementCandidate(
						activeCandidate,
						scheduler,
						isCurrent,
						controller.signal,
					))
				) {
					candidateSurface.remove();
					return;
				}
				if (!isCurrent()) return;
				if (activeCandidate.editMap) {
					const markerCapture = capturePreviewBlockMarkers(
						candidateSurface,
						activeCandidate.editMap,
						scheduler,
						isCurrent,
						controller.signal,
					);
					const capturedMarkers =
						markerCapture instanceof Promise
							? await markerCapture
							: markerCapture;
					if (!capturedMarkers) {
						candidateSurface.remove();
						return;
					}
					blockMarkers = capturedMarkers;
				}
				visualSources = captureVisualMarkdownSources(candidateSurface);
				await props.enhancementPort.enhance(
					candidateSurface,
					activeCandidate.features,
					isCurrent,
					{ codeTheme: activeCandidate.codeTheme, signal: controller.signal },
				);
				if (!isCurrent()) return;
				if (
					refs.windowedRef.current &&
					previewNeedsWindow(activeCandidate.editMap)
				) {
					candidateSurface.style.display = "block";
					const activeSurface = refs.surfaceRef.current;
					if (!activeSurface) throw new Error("preview-surface-missing");
					previewScrollCanvas(activeSurface).append(candidateSurface);
				}
				try {
					if (blockMarkers.length > 0) {
						const annotation = annotateEnhancedPreviewBlocks(
							blockMarkers,
							scheduler,
							isCurrent,
							controller.signal,
						);
						const annotated =
							annotation instanceof Promise ? await annotation : annotation;
						if (!annotated) {
							candidateSurface.remove();
							return;
						}
					}
					annotateEnhancedVisualSources(visualSources);
				} catch (error) {
					failEnhancement(error);
					return;
				}
				if (
					activeCandidate.sourceNodes.length >
						PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS ||
					blockMarkers.length > PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS
				) {
					await scheduler.yield();
					if (!isCurrent() || controller.signal.aborted) {
						candidateSurface.remove();
						return;
					}
				}
				const largePreview = previewNeedsWindow(activeCandidate.editMap);
				const largeWindow = refs.windowedRef.current && largePreview;
				const preparedDocumentEndPin = refs.documentEndPinRef.current;
				let matchingDocumentEndPin =
					preparedDocumentEndPin &&
					preparedDocumentEndPin.generation === generation &&
					preparedDocumentEndPin.requestRevision ===
						activeCandidate.requestRevision &&
					preparedDocumentEndPin.signature === activeCandidate.signature
						? preparedDocumentEndPin
						: null;
				if (
					preparedDocumentEndPin?.generation === generation &&
					!matchingDocumentEndPin
				) {
					throw new PreviewWindowDomError(
						"preview-window-document-end-pin-identity-mismatch",
					);
				}
				if (matchingDocumentEndPin && !largeWindow) {
					clearDocumentEndPin(refs, matchingDocumentEndPin, false);
					matchingDocumentEndPin = null;
				}
				const enhancedHtml = largePreview
					? activeCandidate.serverHtml
					: (candidateSurface.innerHTML as SafePreviewHtml);
				let repository: PreviewWindowNodeRepository | null = null;
				let windowedCommit: MutablePreviewWindowCommit | null = null;
				let stagedCommit: SafePreviewHtmlSinkCommit | null = null;
				refs.stagedPreviewImageElementsRef.current =
					capturePreviewImageElements(
						candidateSurface,
						activeCandidate.editMap ?? null,
						generation,
					);
				if (
					refs.windowedRef.current &&
					previewNeedsWindow(activeCandidate.editMap)
				) {
					const candidateEditMap = activeCandidate.editMap;
					if (!candidateEditMap) {
						throw new Error("preview-window-edit-map-missing");
					}
					refs.previewWindowRepositoryRef.current =
						createPreviewWindowRepository(candidateSurface, candidateEditMap, {
							revision: generation,
							signature: activeCandidate.signature,
							styleEpoch: refs.windowStyleEpochRef.current,
							widthEpoch: refs.windowWidthEpochRef.current,
						});
					refs.windowGeometryRequiresMeasuredRef.current = false;
					repository = refs.previewWindowRepositoryRef.current;
					let ownedGap = refs.ownedGapRef.current;
					let gapBlank = false;
					if (
						ownedGap?.isLive() &&
						ownedGap.markdown === activeCandidate.markdown
					) {
						const retainedGap = ownedGap;
						const starts = markdownLineStarts(activeCandidate.markdown);
						const resolveBlockExtent = (
							extent: PreviewOwnedGap["before"],
						): Readonly<{
							index: number;
							range: PreviewOwnedGap["before"];
						}> | null => {
							const exact = candidateEditMap.blocks.flatMap((block, index) => {
								const start =
									starts[block.startLine] ?? activeCandidate.markdown.length;
								const end =
									starts[block.endLine] ?? activeCandidate.markdown.length;
								return start === extent.start &&
									end === extent.end &&
									activeCandidate.markdown.slice(start, end) === extent.source
									? [{ index, range: extent }]
									: [];
							});
							if (exact.length === 1 && exact[0]) return exact[0];
							if (
								extent.start !== retainedGap.before.start ||
								extent.end !== retainedGap.before.end ||
								extent.source !== retainedGap.before.source
							)
								return null;
							const rebound = candidateEditMap.blocks.flatMap(
								(block, index) => {
									const start =
										starts[block.startLine] ?? activeCandidate.markdown.length;
									const end =
										starts[block.endLine] ?? activeCandidate.markdown.length;
									const formalSource = activeCandidate.markdown.slice(
										start,
										end,
									);
									const suffix = activeCandidate.markdown.slice(
										extent.end,
										end,
									);
									return start === extent.start &&
										end > extent.end &&
										end <= retainedGap.after.start &&
										formalSource.startsWith(extent.source) &&
										/^(?:\r\n|\r|\n)$/u.test(suffix)
										? [{ index, range: { start, end, source: formalSource } }]
										: [];
								},
							);
							return rebound.length === 1 && rebound[0] ? rebound[0] : null;
						};
						const beforeMatch = resolveBlockExtent(ownedGap.before);
						if (!beforeMatch)
							throw new PreviewWindowDomError(
								"preview-owned-gap-source-range-stale",
							);
						if (beforeMatch.range !== ownedGap.before) {
							ownedGap = { ...ownedGap, before: beforeMatch.range };
							refs.ownedGapRef.current = ownedGap;
						}
						const matchExtentIndex = (
							extent: PreviewOwnedGap["before"],
						): number =>
							candidateEditMap.blocks.findIndex(
								(block) =>
									(starts[block.startLine] ??
										activeCandidate.markdown.length) === extent.start &&
									(starts[block.endLine] ?? activeCandidate.markdown.length) ===
										extent.end &&
									activeCandidate.markdown.slice(extent.start, extent.end) ===
										extent.source,
							);
						const before = matchExtentIndex(ownedGap.before);
						const mappedAfter = matchExtentIndex(ownedGap.after);
						const eofAfter =
							mappedAfter < 0 &&
							before === candidateEditMap.blocks.length - 1 &&
							ownedGap.after.start === activeCandidate.markdown.length &&
							ownedGap.after.end === activeCandidate.markdown.length &&
							"" === ownedGap.after.source;
						const after = eofAfter ? null : mappedAfter;
						// Same certificate predicate as the producer: a blank line, or the
						// tight adjacency where the following row starts at this row's end
						// (so the gap slice is only that row's own single line ending).
						gapBlank = certifiedTextTailGapSlice(
							activeCandidate.markdown.slice(
								ownedGap.before.end,
								ownedGap.after.start,
							),
							ownedGap.after.start <= ownedGap.before.end + 2,
						);
						if (before >= 0 && (eofAfter || after === before + 1) && gapBlank) {
							const clone = ownedGap.node.cloneNode(true) as HTMLElement;
							clone.removeAttribute(VISUAL_BLOCK_ATTRIBUTE);
							if (eofAfter) {
								const beforeNode = repository.nodes[before];
								if (!beforeNode)
									throw new PreviewWindowDomError(
										"preview-owned-gap-neighbor-missing",
									);
								beforeNode.after(clone);
							} else {
								if (after === null)
									throw new PreviewWindowDomError(
										"preview-owned-gap-neighbor-missing",
									);
								const afterNode = repository.nodes[after];
								if (!afterNode)
									throw new PreviewWindowDomError(
										"preview-owned-gap-neighbor-missing",
									);
								afterNode.before(clone);
							}
							repository.ownedGap = { node: clone, before, after };
						}
					}
					if (
						!(await measurePreviewWindowCandidateGeometry(
							repository,
							candidateSurface,
							scheduler,
							isCurrent,
							controller.signal,
						))
					) {
						candidateSurface.remove();
						return;
					}
					refs.pendingWindowBaselineRef.current = captureAcceptedWindowBaseline(
						repository,
						generation,
						activeCandidate.signature,
						activeCandidate.markdown ||
							(readCurrentSourceSnapshot(refs)?.value ?? null),
						readCurrentSourceSnapshot(refs)?.revision ?? null,
					);
					if (!refs.pendingWindowBaselineRef.current) {
						throw new PreviewWindowDomError(
							"preview-window-baseline-capture-failed",
						);
					}
					const pinnedIndices = matchingDocumentEndPin
						? matchingDocumentEndPin.sourceSelection
							? previewSourceSelectionBlockIndices(
									activeCandidate.markdown,
									candidateEditMap,
									activeCandidate.signature,
									matchingDocumentEndPin.sourceSelection,
								)
							: [
									previewDocumentEndBlockIndex(
										activeCandidate.markdown,
										candidateEditMap,
										activeCandidate.signature,
									),
								]
						: [];
					if (matchingDocumentEndPin) {
						matchingDocumentEndPin.targetIndices = pinnedIndices;
					}
					await scheduler.yield();
					if (!isCurrent() || controller.signal.aborted) {
						refs.previewWindowRepositoryRef.current = null;
						candidateSurface.remove();
						return;
					}
					if (repository.ownedGap && refs.compositionSurfaceHeldRef.current) {
						// Native preedit owns the real paragraph. Its existing lease
						// releases after composition settlement, never after ready.
						await new Promise<void>((resolve) => {
							const resume = (): void => {
								controller.signal.removeEventListener("abort", resume);
								if (refs.resumeDeferredEnhancementRef.current === resume)
									refs.resumeDeferredEnhancementRef.current = null;
								resolve();
							};
							refs.resumeDeferredEnhancementRef.current = resume;
							controller.signal.addEventListener("abort", resume, {
								once: true,
							});
						});
						if (!isCurrent() || controller.signal.aborted) {
							candidateSurface.remove();
							return;
						}
					}
					if (repository.ownedGap && !ownedGap?.isLive()) {
						const renewed = refs.ownedGapRef.current;
						// A new input capability may retain the same physical blank
						// while staging yields. Reconcile that exact presentation;
						// a different source epoch, shape or neighbor is still stale.
						if (
							!ownedGap ||
							!renewed?.isLive() ||
							renewed.node !== ownedGap.node ||
							renewed.surface !== ownedGap.surface ||
							renewed.surface !== surface ||
							renewed.historyState.undoDepth !==
								ownedGap.historyState.undoDepth ||
							renewed.historyState.redoDepth !==
								ownedGap.historyState.redoDepth ||
							renewed.sourceRevision !== ownedGap.sourceRevision ||
							renewed.markdown !== ownedGap.markdown ||
							renewed.html !== ownedGap.html ||
							renewed.node.innerHTML !== ownedGap.html ||
							renewed.before.start !== ownedGap.before.start ||
							renewed.before.end !== ownedGap.before.end ||
							renewed.before.source !== ownedGap.before.source ||
							renewed.after.start !== ownedGap.after.start ||
							renewed.after.end !== ownedGap.after.end ||
							renewed.after.source !== ownedGap.after.source
						) {
							throw new PreviewWindowDomError("preview-owned-gap-stale");
						}
						ownedGap = renewed;
					}
					const currentDocumentEndPin = refs.documentEndPinRef.current;
					const initialPinnedIndices =
						matchingDocumentEndPin &&
						currentDocumentEndPin === matchingDocumentEndPin &&
						matchingDocumentEndPin.generation === repository.context.revision &&
						matchingDocumentEndPin.signature === repository.context.signature &&
						matchingDocumentEndPin.targetIndices.length > 0
							? [...matchingDocumentEndPin.targetIndices]
							: [];
					if (repository.ownedGap && ownedGap?.isLive()) {
						initialPinnedIndices.push(repository.ownedGap.before);
						if (repository.ownedGap.after !== null) {
							initialPinnedIndices.push(repository.ownedGap.after);
						}
						repository.ownedGap.node.remove();
						ownedGap.node.removeAttribute(VISUAL_BLOCK_ATTRIBUTE);
						repository.ownedGap = {
							...repository.ownedGap,
							node: ownedGap.node,
						};
					}
					// A surviving accepted row is the native editing anchor, not a
					// pixel offset to repair after replacing its selection subtree.
					const native = surface.ownerDocument.defaultView?.getSelection();
					let selectedRoot: Node | null = native?.isCollapsed
						? native.anchorNode
						: null;
					while (selectedRoot && selectedRoot.parentNode !== surface)
						selectedRoot = selectedRoot.parentNode;
					const previousBaseline = refs.acceptedWindowBaselineRef.current;
					const previousBlock =
						selectedRoot instanceof HTMLElement
							? readAcceptedWindowBaselineBlock(previousBaseline, selectedRoot)
							: null;
					const previousRange = previousBlock?.sourceRange;
					const currentSource = readCurrentSourceSnapshot(refs);
					if (
						selectedRoot instanceof HTMLElement &&
						previousBlock &&
						previousRange &&
						previousBaseline &&
						currentSource &&
						currentSource.revision === previousBaseline.sourceRevision &&
						currentSource.value === previousBaseline.markdown &&
						currentSource.value === activeCandidate.markdown &&
						selectedRoot.innerHTML === previousBlock.innerHTML &&
						selectedRoot.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ===
							previousBlock.id
					) {
						const starts = markdownLineStarts(activeCandidate.markdown);
						const index = candidateEditMap.blocks.findIndex(
							(block) =>
								block.editable &&
								starts[block.startLine] === previousRange.start &&
								(starts[block.endLine] ?? activeCandidate.markdown.length) ===
									previousRange.end,
						);
						const candidateNode = repository.nodes[index];
						const candidateBlock = repository.blocks[index];
						if (
							candidateNode &&
							candidateBlock &&
							candidateNode.tagName === selectedRoot.tagName &&
							candidateNode.innerHTML === selectedRoot.innerHTML &&
							activeCandidate.markdown.slice(
								previousRange.start,
								previousRange.end,
							) ===
								previousBaseline.markdown?.slice(
									previousRange.start,
									previousRange.end,
								)
						) {
							const id = candidateBlock.map.id;
							selectedRoot.setAttribute(VISUAL_BLOCK_ATTRIBUTE, id);
							repository.nodes = repository.nodes.map((node, ordinal) =>
								ordinal === index ? (selectedRoot as HTMLElement) : node,
							);
							repository.blocks = repository.blocks.map((block, ordinal) =>
								ordinal === index
									? { ...block, node: selectedRoot as HTMLElement }
									: block,
							);
							if (refs.pendingWindowBaselineRef.current)
								refs.pendingWindowBaselineRef.current =
									extendAcceptedWindowBaseline(
										refs.pendingWindowBaselineRef.current,
										id,
										selectedRoot,
									);
							initialPinnedIndices.push(index);
						}
					}
					const initialWindow = repository.model.getWindow({
						context: repository.context,
						pinnedIndices: [...new Set(initialPinnedIndices)],
						...(initialPinnedIndices.length > 0
							? { maxMaterialized: DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED }
							: {}),
						viewport: viewportForCanvas(previewScrollCanvas(surface)),
					});
					windowedCommit = {
						key: ++refs.windowCommitKeyRef.current,
						nodes: [...windowNodes(repository, initialWindow)],
						revision: generation,
					};
					pinAcceptedWindowBaselineNodes(
						refs.pendingWindowBaselineRef.current,
						windowedCommit.nodes,
					);
					refs.windowCommitPendingRef.current = true;
					refs.acceptedWindowSnapshotRef.current = null;
					refs.installedWindowSnapshotRef.current = null;
					refs.pendingWindowCommitRef.current = windowedCommit;
				} else {
					stagedCommit = {
						nodes: Array.from(candidateSurface.childNodes),
						revision: generation,
					};
				}
				if (refs.scrollSnapshotRef.current?.generation === generation) {
					captureScroll(generation);
				}
				refs.enhancementCandidateRef.current = null;
				refs.committedEnhancementCandidateRef.current = activeCandidate;
				setState((current) =>
					"html" === current.kind && current.generation === generation
						? {
								...current,
								html: enhancedHtml,
								htmlRevision: generation,
								phase: "committing",
								signature: activeCandidate.signature,
								materializeCommit: null,
								stagedCommit,
								windowedCommit,
							}
						: current,
				);
			} catch (error) {
				failEnhancement(error);
			}
		};

		void runEnhancement();
		return () => {
			active = false;
			controller.abort();
			removeVisualMarkdownSourceMarkers(visualSources);
			removePreviewBlockMarkers(blockMarkers);
			if (
				refs.committedEnhancementCandidateRef.current?.generation !== generation
			) {
				candidateSurface.remove();
			}
		};
	}, [
		state,
		props.enhancementPort,
		props.featureOverrides,
		props.stagingScheduler,
	]);
}
