import { useLayoutEffect, useRef } from "@wordpress/element";
import type {
	PreviewRequestState,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import { createPreviewRequestSession } from "../model/create-preview-request-session";
import { createEnhancementCandidate } from "./preview-enhancement-staging";
import {
	isLargePreviewDocument,
	type PreviewGeneratedContentTargetForSelectionRequest,
	type PreviewGeneratedContentTargetRequest,
	type PreviewHtmlState,
	type PreviewImageTargetRequest,
	type PreviewImageTargetSelectionRequest,
	type PreviewStagedCommitActions,
	type PreviewSurfaceOwnerProps,
	type PreviewSurfaceRefs,
	type PreviewSurfaceRuntime,
	type PreviewSurfaceSetState,
	type PreviewSurfaceState,
	previewFailureCode,
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
		PreviewStagedCommitActions,
		"captureScroll" | "discardPendingWork" | "discardStaging"
	>,
): void {
	const propsRef = useRef(props);
	propsRef.current = props;
	const commitsRef = useRef(commits);
	commitsRef.current = commits;

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");
		refs.ownerActiveRef.current = true;

		const publishRequestState = (requestState: PreviewRequestState): void => {
			const currentProps = propsRef.current;
			const currentCommits = commitsRef.current;
			const generation = ++refs.generationRef.current;
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
				viewportSettled &&
				("loading" === requestState.kind || "success" === requestState.kind)
			) {
				currentCommits.captureScroll(generation);
			} else {
				refs.scrollSnapshotRef.current = null;
			}
			currentCommits.discardPendingWork();

			if ("loading" === requestState.kind) {
				setState((current) =>
					"html" === current.kind
						? {
								...current,
								generation,
								phase: "loading",
								signature: "",
								stagedCommit: null,
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
									stagedCommit: null,
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
								stagedCommit: null,
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
								stagedCommit: null,
							}
						: { generation, kind: "error" },
				);
				return;
			}
			const activeSurface = refs.surfaceRef.current;
			if (!activeSurface) throw new Error("preview-surface-missing");
			const features = {
				...requestState.response.features,
				...currentProps.featureOverrides,
			};
			const largePreview = isLargePreviewDocument(
				requestState.response.editMap ?? null,
			);
			let candidateMarkup: Readonly<{
				sourceNodes: ReadonlyArray<Node>;
				surface: HTMLElement;
			}>;
			try {
				candidateMarkup = createEnhancementCandidate(
					activeSurface,
					requestState.response.html,
					!largePreview,
					requestState.response.preparedMarkup?.sourceNodes,
				);
			} catch (error) {
				if (
					!refs.ownerActiveRef.current ||
					refs.generationRef.current !== generation
				) {
					return;
				}
				if (refs.scrollSnapshotRef.current?.generation === generation) {
					refs.scrollSnapshotRef.current = null;
				}
				currentProps.onDiagnostic?.(previewFailureCode(error));
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
						stagedCommit: null,
					};
				});
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
					stagedCommit:
						!hasCurrentPresentation && !largePreview
							? {
									nodes: candidateMarkup.sourceNodes.map((node) =>
										node.cloneNode(true),
									),
									revision: generation,
								}
							: null,
				};
			});
		};

		const session = createPreviewRequestSession({
			initialRevision: propsRef.current.initialRevision,
			onState: publishRequestState,
			port: propsRef.current.port,
		});
		const runtime: PreviewSurfaceRuntime = {
			getGeneratedPreviewIdentity: () =>
				refs.getGeneratedPreviewIdentityRef.current(),
			prepareGeneratedContentTarget: (
				request: PreviewGeneratedContentTargetRequest,
			) => refs.prepareGeneratedContentTargetRef.current(request),
			prepareGeneratedContentTargetForSelection: (
				request: PreviewGeneratedContentTargetForSelectionRequest,
			) => refs.prepareGeneratedContentTargetForSelectionRef.current(request),
			prepareImageTarget: (request: PreviewImageTargetRequest) =>
				refs.prepareImageTargetRef.current(request),
			prepareImageTargetBySelection: (
				request: PreviewImageTargetSelectionRequest,
			) => refs.prepareImageTargetBySelectionRef.current(request),
			session,
			surface,
		};
		try {
			propsRef.current.onReady(runtime);
		} catch (error) {
			refs.ownerActiveRef.current = false;
			session.destroy();
			throw error;
		}
		return () => {
			refs.ownerActiveRef.current = false;
			refs.acceptedGeneratedPreviewRef.current = null;
			refs.stagedPreviewImageElementsRef.current = null;
			refs.scrollSnapshotRef.current = null;
			commitsRef.current.discardStaging();
			propsRef.current.onDispose?.(runtime);
			session.destroy();
		};
	}, [commits.discardStaging, refs, setState]);

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
						stagedCommit: null,
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
						stagedCommit: null,
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
	}, [
		props.emptyMode,
		props.initial.codeTheme,
		props.initial.editMap,
		setState,
	]);

	const readyHtmlValue = readyHtml?.html;
	const readyHtmlRevision = readyHtml?.htmlRevision;
	const readyHtmlSignature = readyHtml?.signature;
	const readyHtmlEditMap = readyHtml?.editMap ?? null;
	useLayoutEffect(() => {
		if (undefined === readyHtmlValue || undefined === readyHtmlSignature) {
			return;
		}
		void readyHtmlRevision;
		props.onHtmlChange?.(readyHtmlValue);
		props.onSnapshotReady?.(
			readyHtmlValue,
			readyHtmlSignature,
			readyHtmlEditMap,
		);
	}, [
		readyHtmlEditMap,
		readyHtmlRevision,
		readyHtmlSignature,
		readyHtmlValue,
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
			propsRef.current.scrollPort.restore(
				previewScrollCanvas(surface),
				snapshot.snapshot,
			);
		}
	}, [refs, state]);

	useLayoutEffect(() => {
		const surface = refs.surfaceRef.current;
		if (!surface) return;
		surface.easymdePreviewSignature =
			"html" === state.kind && "ready" === state.phase ? state.signature : "";
	}, [refs, state]);

	useLayoutEffect(() => {
		props.onStatusChange?.(surfaceStatus(state));
	}, [props.onStatusChange, state]);

	const readyGeneration = readyHtml?.generation;
	const readyStagedRevision = readyHtml?.stagedCommit?.revision;
	useLayoutEffect(() => {
		void readyGeneration;
		void readyHtmlRevision;
		void readyHtmlSignature;
		void readyStagedRevision;
		const surface = refs.surfaceRef.current;
		if (!surface || undefined === readyGeneration || !surface.isConnected) {
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
		props.onImageReadinessChange,
		readyGeneration,
		readyHtmlRevision,
		readyHtmlSignature,
		readyStagedRevision,
		refs,
	]);
}
