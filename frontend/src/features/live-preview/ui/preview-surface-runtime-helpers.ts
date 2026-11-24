import type {
	AcceptedGeneratedPreview,
	PreviewSourceSnapshot,
	PreviewSurfaceRefs,
} from "./preview-surface-types";

export function readCurrentSourceSnapshot(
	refs: PreviewSurfaceRefs,
): PreviewSourceSnapshot | null {
	const snapshot = refs.currentSourceSnapshotRef.current?.() ?? null;
	if (
		!snapshot ||
		!Number.isSafeInteger(snapshot.revision) ||
		snapshot.revision < 0 ||
		"string" !== typeof snapshot.value
	) {
		return null;
	}
	return snapshot;
}

export function isCurrentAcceptedGeneratedPreview(
	refs: PreviewSurfaceRefs,
	accepted: AcceptedGeneratedPreview,
	surface: HTMLElement,
	verifySourceValue = false,
): boolean {
	const current = refs.stateRef.current;
	const sourceSnapshot = readCurrentSourceSnapshot(refs);
	return Boolean(
		refs.ownerActiveRef.current &&
			sourceSnapshot &&
			sourceSnapshot.revision === accepted.sourceRevision &&
			(!verifySourceValue || sourceSnapshot.value === accepted.markdown) &&
			(refs.sourceRevisionRef.current === null ||
				refs.sourceRevisionRef.current === sourceSnapshot.revision) &&
			"html" === current.kind &&
			"ready" === current.phase &&
			current.generation === accepted.generation &&
			current.signature === accepted.signature &&
			current.editMap?.signature === accepted.signature &&
			surface.isConnected,
	);
}
