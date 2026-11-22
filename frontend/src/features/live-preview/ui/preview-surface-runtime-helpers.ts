import type { PreviewRequestState } from "../../../contracts/ports/preview-request";
import type {
	AcceptedGeneratedPreview,
	MutablePreviewDocumentEndPin,
	PreviewDocumentEndPinLease,
	PreviewSourceSelection,
	PreviewSourceSnapshot,
	PreviewSurfaceRefs,
	PreviewSurfaceState,
} from "./preview-surface-types";
import type { SafePreviewHtmlSinkWindowCommit } from "./SafePreviewHtmlSink";

export function readCurrentSourceSnapshot(
	refs: PreviewSurfaceRefs,
): PreviewSourceSnapshot | null {
	const snapshot = refs.currentSourceSnapshotRef.current?.() ?? null;
	if (
		!snapshot ||
		!Number.isSafeInteger(snapshot.revision) ||
		snapshot.revision < 0 ||
		"string" !== typeof snapshot.value
	)
		return null;
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

export function retainedWindowedCommit(
	refs: PreviewSurfaceRefs,
	current: PreviewSurfaceState,
): SafePreviewHtmlSinkWindowCommit | null {
	if (!refs.windowedRef.current || "html" !== current.kind) return null;
	const commit = current.windowedCommit;
	const surface = refs.surfaceRef.current;
	if (!commit || commit.revision !== current.htmlRevision || !surface) {
		return null;
	}
	const currentNodes = Array.from(surface.childNodes);
	if (
		currentNodes.length !== commit.nodes.length ||
		!commit.nodes.every((node, index) => currentNodes[index] === node)
	) {
		return null;
	}
	return commit;
}

export function clearDocumentEndPin(
	refs: PreviewSurfaceRefs,
	pin: MutablePreviewDocumentEndPin,
	reconcile: boolean,
): void {
	if (refs.documentEndPinRef.current !== pin) return;
	refs.documentEndPinRef.current = null;
	const repository = refs.previewWindowRepositoryRef.current;
	if (
		reconcile &&
		refs.ownerActiveRef.current &&
		pin.targetIndices.length > 0 &&
		repository?.context.revision === pin.generation &&
		repository.context.signature === pin.signature
	) {
		refs.scheduleWindowRef.current();
	}
}

export function prepareDocumentEndWindowPin(
	refs: PreviewSurfaceRefs,
	signature: string,
	sourceSelection?: PreviewSourceSelection,
): PreviewDocumentEndPinLease {
	if (!refs.ownerActiveRef.current) {
		throw new Error("preview-window-document-end-owner-inactive");
	}
	if (!refs.windowedRef.current || !signature) {
		throw new Error("preview-window-document-end-pin-unavailable");
	}
	if (
		sourceSelection &&
		(!Number.isSafeInteger(sourceSelection.start) ||
			!Number.isSafeInteger(sourceSelection.end) ||
			sourceSelection.start < 0 ||
			sourceSelection.end < sourceSelection.start)
	) {
		throw new Error("preview-window-selection-range-invalid");
	}
	if (refs.documentEndPinRef.current) {
		throw new Error("preview-window-document-end-pin-already-active");
	}
	const pin: MutablePreviewDocumentEndPin = {
		generation: null,
		requestRevision: null,
		signature,
		sourceSelection: sourceSelection ?? null,
		targetIndices: [],
	};
	refs.documentEndPinRef.current = pin;
	let released = false;
	return {
		release: () => {
			if (released) return;
			released = true;
			clearDocumentEndPin(refs, pin, true);
		},
	};
}

export function bindDocumentEndPin(
	refs: PreviewSurfaceRefs,
	requestState: PreviewRequestState,
	generation: number,
): void {
	const pin = refs.documentEndPinRef.current;
	if (!pin) return;
	if (
		"loading" === requestState.kind &&
		null === pin.requestRevision &&
		requestState.request.signature === pin.signature
	) {
		pin.requestRevision = requestState.revision;
		pin.generation = generation;
		return;
	}
	if (
		"success" === requestState.kind &&
		pin.requestRevision === requestState.revision &&
		requestState.request.signature === pin.signature
	) {
		pin.generation = generation;
		return;
	}
	clearDocumentEndPin(refs, pin, false);
}
