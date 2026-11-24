import { useCallback } from "@wordpress/element";
import { discardEnhancementCandidate } from "./preview-enhancement-staging";
import { acceptedGeneratedPreviewFromCandidate } from "./preview-selection-block-map";
import { readCurrentSourceSnapshot } from "./preview-surface-runtime-helpers";
import {
	type PreviewStagedCommitActions,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceSetState,
	previewScrollCanvas,
} from "./preview-surface-types";

export function usePreviewStagedCommits(
	props: PreviewSurfaceOwnerProps,
	refs: PreviewSurfaceRefs,
	setState: PreviewSurfaceSetState,
): PreviewStagedCommitActions {
	const discardPendingWork = useCallback(() => {
		discardEnhancementCandidate(refs.enhancementCandidateRef.current);
		refs.enhancementCandidateRef.current = null;
	}, [refs]);

	const discardStaging = useCallback(() => {
		discardPendingWork();
		discardEnhancementCandidate(refs.committedEnhancementCandidateRef.current);
		refs.committedEnhancementCandidateRef.current = null;
	}, [discardPendingWork, refs]);

	const beforeStagedCommit = useCallback(
		(revision: number, hasInstalledHtml: boolean): boolean => {
			const current = refs.stateRef.current;
			if ("html" !== current.kind || "committing" !== current.phase) {
				return true;
			}
			if (!refs.currentSourceSnapshotRef.current) return true;
			if (
				!refs.ownerActiveRef.current ||
				refs.generationRef.current !== revision ||
				current.generation !== revision
			) {
				return false;
			}
			const candidate = refs.committedEnhancementCandidateRef.current;
			if (candidate?.generation === 0 && candidate.requestRevision === null) {
				return true;
			}
			const source = readCurrentSourceSnapshot(refs);
			if (
				candidate &&
				candidate.generation === revision &&
				current.signature === candidate.signature &&
				source?.value === candidate.markdown
			) {
				return true;
			}
			if (candidate?.generation === revision) {
				discardEnhancementCandidate(candidate);
				refs.committedEnhancementCandidateRef.current = null;
			}
			if (refs.stagedPreviewImageElementsRef.current?.generation === revision) {
				refs.stagedPreviewImageElementsRef.current = null;
			}
			if (refs.scrollSnapshotRef.current?.generation === revision) {
				refs.scrollSnapshotRef.current = null;
			}
			setState((prev) =>
				"html" === prev.kind &&
				prev.generation === revision &&
				prev.phase === "committing"
					? {
							...prev,
							phase: hasInstalledHtml ? "retained" : "loading",
							signature: "",
							stagedCommit: null,
						}
					: prev,
			);
			return false;
		},
		[refs, setState],
	);

	const onStagedCommit = useCallback(
		(revision: number) => {
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
				refs.ownerActiveRef.current &&
				refs.generationRef.current === revision &&
				"html" === committingState.kind &&
				committingState.generation === revision &&
				committingState.htmlRevision === revision &&
				"committing" === committingState.phase
			) {
				refs.acceptedHtmlRevisionRef.current = revision;
			}
			if (
				!refs.ownerActiveRef.current ||
				refs.generationRef.current !== revision
			) {
				return;
			}
			setState((current) =>
				"html" === current.kind &&
				current.generation === revision &&
				"committing" === current.phase &&
				current.stagedCommit?.revision === revision
					? { ...current, phase: "ready", stagedCommit: null }
					: current,
			);
		},
		[refs, setState],
	);

	const captureScroll = useCallback(
		(generation: number): void => {
			if (refs.surfaceRef.current) {
				refs.scrollSnapshotRef.current = {
					generation,
					snapshot: props.scrollPort.capture(
						previewScrollCanvas(refs.surfaceRef.current),
					),
				};
			}
		},
		[props.scrollPort, refs],
	);

	return {
		beforeStagedCommit,
		captureScroll,
		discardPendingWork,
		discardStaging,
		onStagedCommit,
	};
}
