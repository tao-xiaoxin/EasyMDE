import { useEffect } from "@wordpress/element";
import type { Dispatch, SetStateAction } from "react";
import { readCurrentSourceSnapshot } from "./preview-surface-runtime-helpers";
import {
	type PreviewHtmlState,
	type PreviewSurfaceRefs,
	type PreviewSurfaceSetState,
	type PreviewWindowCommitActions,
	previewWindowGeometryEpochKey,
} from "./preview-surface-types";
import {
	extendAcceptedWindowBaseline,
	hasExactSurfaceChildren,
	readAcceptedWindowBaselineBlock,
} from "./preview-window-baseline";
import {
	markPreviewWindowFlowGapMeasured,
	markPreviewWindowFlowGapUnknown,
	markPreviewWindowFlowGeometryMeasured,
	markPreviewWindowFlowGeometryUnknown,
	PREVIEW_WINDOW_SPACER_ATTRIBUTE,
	PreviewWindowDomError,
	VISUAL_BLOCK_ATTRIBUTE,
	validatePreviewWindowRepository,
	validatePreviewWindowRepositoryBlock,
	validatePreviewWindowRepositoryHeader,
} from "./preview-window-dom";

export function usePreviewWindowAdoption(
	refs: PreviewSurfaceRefs,
	setState: PreviewSurfaceSetState,
	setCompositionSurfaceVersion: Dispatch<SetStateAction<number>>,
	compositionSurfaceVersion: number,
	commits: Pick<
		PreviewWindowCommitActions,
		"flushPendingAdoptedMeasurements" | "scheduleAdoptedBlockMeasurement"
	>,
): void {
	refs.getAcceptedWindowSnapshotRef.current = () => {
		const accepted =
			refs.acceptedWindowSnapshotRef.current ??
			refs.installedWindowSnapshotRef.current;
		const surface = refs.surfaceRef.current;
		const current = refs.stateRef.current;
		const repository = refs.previewWindowRepositoryRef.current;
		const commit = "html" === current.kind ? current.windowedCommit : null;
		if (
			!accepted ||
			!surface?.isConnected ||
			!refs.ownerActiveRef.current ||
			!refs.windowedRef.current ||
			refs.windowCommitPendingRef.current ||
			refs.materializationPendingRef.current ||
			!repository ||
			!commit ||
			"html" !== current.kind ||
			!["ready", "committing"].includes(current.phase) ||
			("committing" === current.phase && refs.windowCommitPendingRef.current) ||
			current.generation !== accepted.revision ||
			current.htmlRevision !== accepted.revision ||
			current.signature !== accepted.signature ||
			refs.generationRef.current !== accepted.revision ||
			repository.context.revision !== accepted.revision ||
			repository.context.signature !== accepted.signature ||
			commit.key !== accepted.key ||
			commit.revision !== accepted.revision ||
			!hasExactSurfaceChildren(surface, accepted.nodes) ||
			!hasExactSurfaceChildren(surface, commit.nodes) ||
			accepted.nodes.length !== commit.nodes.length ||
			accepted.nodes.some((node, index) => commit.nodes[index] !== node)
		)
			return null;
		if (accepted.sourceRevision !== undefined) {
			const source = readCurrentSourceSnapshot(refs);
			// This certifies accepted content, not a live input lease.
			// Preserve its recorded epoch; input owners compare that epoch with
			// their current revision/history before authorizing any mutation.
			if (
				!source ||
				source.value !== refs.acceptedWindowBaselineRef.current?.markdown
			)
				return null;
		}
		try {
			validatePreviewWindowRepositoryHeader(repository);
		} catch {
			return null;
		}
		for (const block of accepted.blocks) {
			const index = repository.indexById.get(block.id);
			if (undefined === index) return null;
			try {
				validatePreviewWindowRepositoryBlock(repository, index);
			} catch {
				return null;
			}
			const currentBlock = repository.blocks[index];
			if (
				!currentBlock ||
				currentBlock.map.id !== block.id ||
				currentBlock.node !== block.node ||
				repository.nodes[index] !== block.node ||
				block.node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id
			)
				return null;
		}
		return accepted;
	};

	refs.getAcceptedWindowRowRef.current = (request) => {
		const baseline = refs.acceptedWindowBaselineRef.current;
		const repository = refs.previewWindowRepositoryRef.current;
		const surface = refs.surfaceRef.current;
		const reject = (reason: string): null => {
			request.onRefusal?.(reason, {
				active: refs.ownerActiveRef.current,
				windowed: refs.windowedRef.current,
				surfaceConnected: surface?.isConnected ?? false,
				baselinePresent: Boolean(baseline),
				repositoryPresent: Boolean(repository),
				sourceMapCurrent: baseline?.sourceMapCurrent ?? false,
				baselineSourcePresent:
					baseline?.markdown !== null && baseline?.markdown !== undefined,
				baselineSourceRevision: baseline?.sourceRevision ?? -1,
				baselineRevision: baseline?.revision ?? -1,
				repositoryRevision: repository?.context.revision ?? -1,
				requestRevision: request.revision,
				requestIndex: request.index,
				baselineSignatureMatches: baseline?.signature === request.signature,
				repositorySignatureMatches:
					repository?.context.signature === request.signature,
			});
			return null;
		};
		if (
			!refs.ownerActiveRef.current ||
			!refs.windowedRef.current ||
			!surface?.isConnected ||
			!baseline ||
			!repository ||
			!baseline.sourceMapCurrent ||
			baseline.markdown === null ||
			baseline.sourceRevision === null ||
			baseline.revision !== request.revision ||
			baseline.signature !== request.signature ||
			repository.context.revision !== request.revision ||
			repository.context.signature !== request.signature ||
			!Number.isInteger(request.index) ||
			request.index < 0
		)
			return reject("owner-epoch");
		const entry = repository.blocks[request.index];
		if (
			!entry ||
			entry.index !== request.index ||
			entry.map.id !== request.id ||
			!entry.map.editable ||
			repository.nodes[request.index] !== entry.node ||
			repository.indexById.get(request.id) !== request.index
		)
			return reject("row-binding");
		const block = readAcceptedWindowBaselineBlock(baseline, entry.node);
		const range = block?.sourceRange;
		if (
			!block ||
			block.id !== request.id ||
			!range ||
			range.start < 0 ||
			range.end < range.start ||
			range.end > baseline.markdown.length ||
			entry.node.innerHTML !== block.innerHTML ||
			!entry.node.cloneNode(false).isEqualNode(block.rootSnapshot)
		)
			return reject("row-content");
		return {
			root: entry.node.cloneNode(true) as HTMLElement,
			source: baseline.markdown,
			sourceRange: range,
			sourceRevision: baseline.sourceRevision,
		};
	};

	const prepareWindowBlockAdoption = (
		node: HTMLElement,
	): (() => boolean) | null => {
		if (!refs.ownerActiveRef.current || !refs.windowedRef.current) return null;
		const surface = refs.surfaceRef.current;
		const repository = refs.previewWindowRepositoryRef.current;
		const current = refs.stateRef.current;
		if (
			!surface?.isConnected ||
			!repository ||
			"html" !== current.kind ||
			"ready" !== current.phase ||
			current.generation !== repository.context.revision ||
			current.htmlRevision !== repository.context.revision ||
			current.signature !== repository.context.signature ||
			current.editMap?.signature !== repository.context.signature ||
			current.editMap?.blocks.length !== repository.nodes.length ||
			refs.generationRef.current !== repository.context.revision ||
			refs.materializationPendingRef.current ||
			!(node instanceof HTMLElement) ||
			node.ownerDocument !== surface.ownerDocument ||
			node.parentNode !== surface ||
			node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)
		)
			return null;

		try {
			validatePreviewWindowRepositoryHeader(repository);
		} catch {
			return null;
		}

		const id = node.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
		if (!id) return null;
		const index = repository.indexById.get(id);
		if (undefined === index) return null;
		const block = repository.blocks[index];
		if (
			!block ||
			block.index !== index ||
			block.map.id !== id ||
			repository.indexById.size !== repository.nodes.length
		)
			return null;
		try {
			validatePreviewWindowRepositoryBlock(repository, index);
		} catch {
			return null;
		}

		const mountedIndices = new Set<number>();
		let previousIndex = -1;
		const expectedChildren = Array.from(surface.children);
		const retainedGap = refs.ownedGapRef.current;
		const retainedGapNode =
			retainedGap && retainedGap.surface === surface && retainedGap.isLive()
				? retainedGap.node
				: null;
		for (const child of expectedChildren) {
			if (child.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE)) continue;
			const childId = child.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
			// The consumer's certified empty-source row owns no block: it is the
			// caret's own presentation (e.g. the document-end sink), not a foreign
			// row, so the scan keeps going instead of refusing the adoption.
			if (
				!childId &&
				(child === repository.ownedGap?.node || child === retainedGapNode)
			)
				continue;
			if (!childId) return null;
			const childIndex = repository.indexById.get(childId);
			if (undefined === childIndex || mountedIndices.has(childIndex)) {
				return null;
			}
			if (childIndex <= previousIndex) return null;
			previousIndex = childIndex;
			mountedIndices.add(childIndex);
			if (child !== node && repository.nodes[childIndex] !== child) {
				return null;
			}
			if (childIndex !== index) {
				try {
					validatePreviewWindowRepositoryBlock(repository, childIndex);
				} catch {
					return null;
				}
			}
		}
		if (!mountedIndices.has(index)) return null;

		const previousNode = repository.nodes[index];
		if (!previousNode) return null;
		const pendingCommit = refs.windowCommitPendingRef.current
			? refs.pendingWindowCommitRef.current
			: null;
		const pendingNodeIndex = pendingCommit?.nodes.indexOf(previousNode) ?? -1;
		if (
			refs.windowCommitPendingRef.current &&
			(!pendingCommit ||
				pendingCommit.revision !== repository.context.revision ||
				pendingNodeIndex < 0)
		)
			return null;
		const expectedContext = repository.context;
		let replacementAdopted = false;
		// A rejected adoption must leave the accepted window mounted: a
		// foreign replacement root this finalize refuses has no accepted
		// identity, so the row it claimed goes back to the node the repository
		// still names. Restoring here keeps the sink self-healing for every
		// refusal path without touching any accepting one.
		const restoreAcceptedNode = (): void => {
			if (
				node.isConnected &&
				node.parentNode === surface &&
				!previousNode.isConnected &&
				repository.nodes[index] === previousNode
			) {
				node.replaceWith(previousNode);
			}
		};
		return () => {
			if (!refs.ownerActiveRef.current || !refs.windowedRef.current) {
				restoreAcceptedNode();
				return false;
			}
			const currentSurface = refs.surfaceRef.current;
			const currentRepository = refs.previewWindowRepositoryRef.current;
			const currentState = refs.stateRef.current;
			if (
				currentSurface !== surface ||
				!surface.isConnected ||
				currentRepository !== repository ||
				"html" !== currentState.kind ||
				"ready" !== currentState.phase ||
				currentState.generation !== expectedContext.revision ||
				currentState.htmlRevision !== expectedContext.revision ||
				currentState.signature !== expectedContext.signature ||
				currentState.editMap?.signature !== expectedContext.signature ||
				currentState.editMap?.blocks.length !== repository.nodes.length ||
				refs.generationRef.current !== expectedContext.revision ||
				repository.context !== expectedContext ||
				refs.materializationPendingRef.current ||
				(pendingCommit &&
					refs.pendingWindowCommitRef.current !== pendingCommit) ||
				node.ownerDocument !== surface.ownerDocument ||
				node.parentNode !== surface ||
				node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== id ||
				node.hasAttribute(PREVIEW_WINDOW_SPACER_ATTRIBUTE) ||
				expectedChildren.length !== surface.children.length ||
				expectedChildren.some(
					(expectedChild, childIndex) =>
						surface.children[childIndex] !== expectedChild,
				)
			) {
				restoreAcceptedNode();
				return false;
			}

			try {
				validatePreviewWindowRepositoryHeader(repository);
				if (repository.indexById.size !== repository.nodes.length) {
					throw new PreviewWindowDomError(
						"preview-window-repository-count-mismatch",
					);
				}
				for (const mountedIndex of mountedIndices) {
					validatePreviewWindowRepositoryBlock(repository, mountedIndex);
				}
			} catch {
				restoreAcceptedNode();
				return false;
			}

			const currentBlock = repository.blocks[index];
			if (
				!currentBlock ||
				currentBlock.index !== index ||
				currentBlock.map.id !== id ||
				repository.indexById.get(id) !== index
			) {
				restoreAcceptedNode();
				return false;
			}
			if (currentBlock.node === node && repository.nodes[index] === node) {
				// A root-preserving local edit keeps the mounted node, so the
				// repository already names it and only its accepted content
				// moved. Advance exactly this block's baselines and retire the
				// published snapshot: re-reporting the previous content would
				// describe a DOM this owner no longer has, and every later
				// accepted-window registration would reject the live node.
				if (
					refs.acceptedWindowBaselineRef.current?.revision !==
						expectedContext.revision ||
					refs.acceptedWindowBaselineRef.current.signature !==
						expectedContext.signature
				) {
					restoreAcceptedNode();
					return false;
				}
				const sourceSnapshot = readCurrentSourceSnapshot(refs);
				refs.acceptedWindowBaselineRef.current = extendAcceptedWindowBaseline(
					refs.acceptedWindowBaselineRef.current,
					id,
					node,
					sourceSnapshot,
				);
				if (
					refs.pendingWindowBaselineRef.current?.revision ===
						expectedContext.revision &&
					refs.pendingWindowBaselineRef.current.signature ===
						expectedContext.signature
				) {
					refs.pendingWindowBaselineRef.current = extendAcceptedWindowBaseline(
						refs.pendingWindowBaselineRef.current,
						id,
						node,
						sourceSnapshot,
					);
				}
				// The retained root now describes accepted content the flow model
				// has not measured. Coalesce measurement onto the next animation
				// frame (or flush synchronously before any geometry reader) so
				// steady-state typing does not force a synchronous layout reflow
				// on every keystroke while keeping the boundary exact before any
				// spacer reconciliation compares them.
				// A second finalization after replacement adoption advances only
				// the canonical witness; the replacement geometry was invalidated
				// once by the pre-canonical DOM transaction below.
				if (!replacementAdopted) {
					commits.scheduleAdoptedBlockMeasurement(repository, surface, index);
				}
				refs.acceptedWindowSnapshotRef.current = null;
				refs.installedWindowSnapshotRef.current = null;
				return true;
			}
			if (
				currentBlock.node !== previousNode ||
				repository.nodes[index] !== previousNode
			) {
				restoreAcceptedNode();
				return false;
			}
			commits.flushPendingAdoptedMeasurements(repository, surface);

			// Repository adoption and the sink's accepted child list are one
			// transition. Otherwise loading rejects the old PRE identity and
			// remounts HTML, destroying the pending native selection lease.
			const acceptedCommit = currentState.windowedCommit;
			const acceptedNodes = acceptedCommit?.nodes.map((child) =>
				child === previousNode ? node : child,
			);
			if (
				acceptedCommit &&
				(acceptedCommit.revision !== expectedContext.revision ||
					!acceptedCommit.nodes.includes(previousNode) ||
					acceptedNodes?.length !== surface.childNodes.length ||
					acceptedNodes.some(
						(child, childIndex) => surface.childNodes[childIndex] !== child,
					))
			) {
				restoreAcceptedNode();
				return false;
			}

			const previousNodes = repository.nodes;
			const previousBlocks = repository.blocks;
			const previousFlowGeometry = repository.flowGeometry[index];
			const previousFlowEpoch = repository.flowGeometryEpoch[index] ?? null;
			const previousGapEpoch = repository.flowGapEpoch[index] ?? null;
			const previousPrecedingGeometry =
				index > 0 ? repository.flowGeometry[index - 1] : undefined;
			const previousPrecedingGapEpoch =
				index > 0 ? repository.flowGapEpoch[index - 1] : undefined;
			const geometryEpoch = previewWindowGeometryEpochKey(repository.context);
			const previousGeometryRequirement =
				refs.windowGeometryRequiresMeasuredRef.current;
			const replacementRequiresMeasurement =
				refs.installedWindowGeometryContextRef.current === geometryEpoch &&
				(repository.flowGeometryUnknownRanges
					? repository.flowGeometryUnknownRanges.length === 0
					: repository.flowGeometryEpoch.every(
							(value) => value === geometryEpoch,
						));
			const mutablePendingNodes = pendingCommit?.nodes;
			const previousPendingNode = mutablePendingNodes?.[pendingNodeIndex];
			const nextNodes = [...repository.nodes];
			nextNodes[index] = node;
			const nextBlocks = repository.blocks.map((entry, entryIndex) =>
				entryIndex === index ? { ...entry, node } : entry,
			);
			const replacementGeometry = repository.model.flowGeometries[index];
			if (!replacementGeometry) {
				restoreAcceptedNode();
				return false;
			}
			const nextAcceptedBaseline =
				refs.acceptedWindowBaselineRef.current?.revision ===
					expectedContext.revision &&
				refs.acceptedWindowBaselineRef.current.signature ===
					expectedContext.signature
					? extendAcceptedWindowBaseline(
							refs.acceptedWindowBaselineRef.current,
							id,
							node,
							readCurrentSourceSnapshot(refs),
						)
					: refs.acceptedWindowBaselineRef.current;
			const nextPendingBaseline =
				refs.pendingWindowBaselineRef.current?.revision ===
					expectedContext.revision &&
				refs.pendingWindowBaselineRef.current.signature ===
					expectedContext.signature
					? extendAcceptedWindowBaseline(
							refs.pendingWindowBaselineRef.current,
							id,
							node,
							readCurrentSourceSnapshot(refs),
						)
					: refs.pendingWindowBaselineRef.current;
			repository.nodes = nextNodes;
			repository.blocks = nextBlocks;
			repository.flowGeometry[index] = replacementGeometry;
			repository.flowGeometryEpoch[index] = null;
			repository.flowGapEpoch[index] = null;
			markPreviewWindowFlowGeometryUnknown(repository, index);
			markPreviewWindowFlowGapUnknown(repository, index);
			if (index > 0 && previousPrecedingGeometry) {
				repository.flowGeometry[index - 1] = {
					...previousPrecedingGeometry,
					gapAfter: 0,
				};
				repository.flowGapEpoch[index - 1] = null;
				markPreviewWindowFlowGapUnknown(repository, index - 1);
			}
			if (mutablePendingNodes) mutablePendingNodes[pendingNodeIndex] = node;
			try {
				validatePreviewWindowRepository(repository);
			} catch {
				repository.nodes = previousNodes;
				repository.blocks = previousBlocks;
				repository.flowGeometry[index] =
					previousFlowGeometry ?? replacementGeometry;
				repository.flowGeometryEpoch[index] = previousFlowEpoch;
				repository.flowGapEpoch[index] = previousGapEpoch;
				if (previousFlowEpoch === geometryEpoch) {
					markPreviewWindowFlowGeometryMeasured(repository, index);
				} else {
					markPreviewWindowFlowGeometryUnknown(repository, index);
				}
				if (previousGapEpoch === geometryEpoch) {
					markPreviewWindowFlowGapMeasured(repository, index);
				} else {
					markPreviewWindowFlowGapUnknown(repository, index);
				}
				refs.windowGeometryRequiresMeasuredRef.current =
					previousGeometryRequirement;
				if (index > 0 && previousPrecedingGeometry) {
					repository.flowGeometry[index - 1] = previousPrecedingGeometry;
					repository.flowGapEpoch[index - 1] =
						previousPrecedingGapEpoch ?? null;
					if (previousPrecedingGapEpoch === geometryEpoch) {
						markPreviewWindowFlowGapMeasured(repository, index - 1);
					} else {
						markPreviewWindowFlowGapUnknown(repository, index - 1);
					}
				}
				if (mutablePendingNodes && previousPendingNode) {
					mutablePendingNodes[pendingNodeIndex] = previousPendingNode;
				}
				restoreAcceptedNode();
				return false;
			}
			refs.acceptedWindowSnapshotRef.current = null;
			refs.installedWindowSnapshotRef.current = null;
			if (
				index === 0 ||
				index === repository.nodes.length - 1 ||
				!repository.flowBoundary
			) {
				repository.flowBoundary = null;
			}
			repository.spacerContentHeights.clear();
			if (replacementRequiresMeasurement) {
				refs.windowGeometryRequiresMeasuredRef.current = true;
			}
			refs.acceptedWindowBaselineRef.current = nextAcceptedBaseline;
			refs.pendingWindowBaselineRef.current = nextPendingBaseline;
			replacementAdopted = true;
			if (acceptedCommit && acceptedNodes) {
				const adoptedCommit = { ...acceptedCommit, nodes: acceptedNodes };
				if (
					pendingCommit?.key === acceptedCommit.key &&
					pendingCommit.revision === acceptedCommit.revision &&
					refs.pendingWindowCommitRef.current === pendingCommit
				) {
					// This adoption has made the queued node sequence current in the
					// repository and surface. The synchronous sink will not recertify
					// the already-installed key, so retire that exact queue entry and
					// let the normal owner pass measure and publish the adopted DOM.
					refs.pendingWindowCommitRef.current = null;
					refs.windowCommitPendingRef.current = false;
				}
				if (
					"html" === currentState.kind &&
					currentState.windowedCommit === acceptedCommit
				) {
					// Match the sink-owner protocol: publish the adopted owner state
					// synchronously, then let React follow with the same object. The
					// scheduled certification pass must never read the old node list.
					const adoptedState: PreviewHtmlState = {
						...currentState,
						windowedCommit: adoptedCommit,
					};
					refs.stateRef.current = adoptedState;
					setState((prev) => (prev === currentState ? adoptedState : prev));
					refs.scheduleWindowRef.current();
				}
			}
			return true;
		};
	};
	refs.prepareWindowBlockAdoptionRef.current = prepareWindowBlockAdoption;

	useEffect(() => {
		void compositionSurfaceVersion;
		if (!refs.compositionSurfaceHeldRef.current)
			refs.scheduleWindowRef.current();
	}, [compositionSurfaceVersion, refs]);

	refs.retainCompositionSurfaceRef.current = (activation) => {
		const surface = refs.surfaceRef.current;
		if (
			activation !== refs.compositionSurfaceActivationRef.current ||
			!refs.ownerActiveRef.current ||
			!surface ||
			!surface.isConnected
		) {
			// A runtime from a superseded activation must not lend the current
			// surface; only the live owner activation can hold its own lease.
			throw new Error("preview-composition-surface-inactive");
		}
		if (refs.materializationPendingRef.current) {
			// Gating future starts cannot stop a rollback already in flight; the
			// admission must refuse instead of holding over it.
			throw new Error("preview-composition-surface-busy");
		}
		refs.compositionSurfaceLeasesRef.current += 1;
		refs.compositionSurfaceHeldRef.current = true;
		setCompositionSurfaceVersion((version) => version + 1);
		let released = false;
		return {
			retainGap: (gap) => {
				if (
					released ||
					activation !== refs.compositionSurfaceActivationRef.current ||
					gap.surface !== surface ||
					gap.node.parentNode !== surface ||
					!gap.isLive()
				) {
					throw new Error("preview-owned-gap-stale");
				}
				refs.ownedGapRef.current = gap;
			},
			release: () => {
				// A late, duplicated, or pre-teardown release never lifts another
				// lease: only this activation may settle its own token.
				if (released) return;
				released = true;
				if (activation !== refs.compositionSurfaceActivationRef.current) return;
				refs.compositionSurfaceLeasesRef.current = Math.max(
					0,
					refs.compositionSurfaceLeasesRef.current - 1,
				);
				refs.compositionSurfaceHeldRef.current =
					refs.compositionSurfaceLeasesRef.current > 0;
				if (!refs.compositionSurfaceHeldRef.current)
					refs.resumeDeferredEnhancementRef.current?.();
				setCompositionSurfaceVersion((version) => version + 1);
			},
		};
	};
}
