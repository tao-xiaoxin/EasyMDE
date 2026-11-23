import { useLayoutEffect, useRef } from "@wordpress/element";
import type { SafePreviewHtml } from "../../../contracts/ports/preview-request";
import {
	annotateEnhancedPreviewBlocks,
	annotateEnhancedVisualSources,
	capturePreviewBlockMarkers,
	captureVisualMarkdownSources,
	createEnhancementCandidate,
	defaultPreviewSurfaceStagingScheduler,
	populateEnhancementCandidate,
	removePreviewBlockMarkers,
	removeVisualMarkdownSourceMarkers,
} from "./preview-enhancement-staging";
import { capturePreviewImageElements } from "./preview-selection-block-map";
import {
	isLargePreviewDocument,
	PREVIEW_ATOMIC_COMMIT_BARRIER_MIN_BLOCKS,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceSetState,
	type PreviewSurfaceState,
	previewFailureCode,
	type VisualBlockMarker,
	type VisualMarkdownSourceMarker,
} from "./preview-surface-types";
import type { SafePreviewHtmlSinkCommit } from "./SafePreviewHtmlSink";

export function usePreviewEnhancementPipeline(
	props: PreviewSurfaceOwnerProps,
	refs: PreviewSurfaceRefs,
	state: PreviewSurfaceState,
	setState: PreviewSurfaceSetState,
	captureScroll: (generation: number) => void,
): void {
	const onDiagnosticRef = useRef(props.onDiagnostic);
	onDiagnosticRef.current = props.onDiagnostic;
	const captureScrollRef = useRef(captureScroll);
	captureScrollRef.current = captureScroll;

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface || "html" !== state.kind || "enhancing" !== state.phase) {
			return;
		}
		const generation = state.generation;
		let candidate = refs.enhancementCandidateRef.current;
		if (!candidate && 0 === generation) {
			const candidateMarkup = createEnhancementCandidate(
				surface,
				state.html,
				!isLargePreviewDocument(state.editMap),
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
			if (refs.scrollSnapshotRef.current?.generation === generation) {
				refs.scrollSnapshotRef.current = null;
			}
			removeVisualMarkdownSourceMarkers(visualSources);
			removePreviewBlockMarkers(blockMarkers);
			candidateSurface.remove();
			onDiagnosticRef.current?.(previewFailureCode(error));
			refs.enhancementCandidateRef.current = null;
			setState((current) => {
				if ("html" !== current.kind || current.generation !== generation) {
					return current;
				}
				return {
					...current,
					html: activeCandidate.serverHtml,
					htmlRevision: generation,
					phase: "failed",
					signature: "",
					stagedCommit: null,
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
				const largePreview = isLargePreviewDocument(activeCandidate.editMap);
				const enhancedHtml = largePreview
					? activeCandidate.serverHtml
					: (candidateSurface.innerHTML as SafePreviewHtml);
				refs.stagedPreviewImageElementsRef.current =
					capturePreviewImageElements(
						candidateSurface,
						activeCandidate.editMap ?? null,
						generation,
					);
				const stagedCommit: SafePreviewHtmlSinkCommit = {
					nodes: Array.from(candidateSurface.childNodes),
					revision: generation,
				};
				if (refs.scrollSnapshotRef.current?.generation === generation) {
					captureScrollRef.current(generation);
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
								stagedCommit,
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
	}, [props.enhancementPort, props.stagingScheduler, refs, setState, state]);
}
