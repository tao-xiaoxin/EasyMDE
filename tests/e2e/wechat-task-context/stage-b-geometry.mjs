// Stage B geometry facade.
// Existing callers keep importing this module; the implementation is split by
// responsibility into the CDP surface inventory, the geometry comparators, the
// measurement-side perturbations, the ready geometry probe, and the
// source-only CDP evidence contract/collector.

export { armStageBReadyGeometryProbe } from "./stage-b-ready-probe.mjs";
export { captureStageBLeaseMappings } from "./stage-b-inventory.mjs";
export { captureStageBSourceInventory } from "./stage-b-inventory.mjs";
export { collectSourceOnlyCdpEvidence } from "./source-only-collector.mjs";
export { collectSourceOnlyNodeGraph } from "./source-only-collector.mjs";
export { collectSourceOnlyPotentialBox } from "./source-only-collector.mjs";
export { collectStageBSurfaceInventory } from "./stage-b-inventory.mjs";
export { completeSourceOnlyCdpEvidence } from "./source-only-contract.mjs";
export { freezeSourceOnlyCleanup } from "./source-only-contract.mjs";
export { freezeSourceOnlyPrimary } from "./source-only-contract.mjs";
export { installStageBBeforePerturbation } from "./stage-b-perturbations.mjs";
export { installStageBWidthPerturbation } from "./stage-b-perturbations.mjs";
export { releaseStageBObjects } from "./stage-b-perturbations.mjs";
export { resolveStageBCdpObject } from "./stage-b-inventory.mjs";
export { restoreStageBPerturbation } from "./stage-b-perturbations.mjs";
export { runSourceOnlyCdpCleanup } from "./source-only-contract.mjs";
export { runSourceOnlyCleanupContract } from "./source-only-contract.mjs";
export { stableStageBCode } from "./stage-b-inventory.mjs";
export { stageBActualInputStyle } from "./stage-b-perturbations.mjs";
export { stageBCompareExcept } from "./stage-b-comparators.mjs";
export { stageBCompareInventory } from "./stage-b-comparators.mjs";
export { stageBExactBeforeTranslation } from "./stage-b-comparators.mjs";
export { stageBFragmentsEqual } from "./stage-b-comparators.mjs";
export { stageBGeometryEqual } from "./stage-b-comparators.mjs";
export { stageBGraphEqual } from "./stage-b-comparators.mjs";
export { stageBInputWidthDelta } from "./stage-b-comparators.mjs";
export { stageBNormalizedFragments } from "./stage-b-comparators.mjs";
export { stageBNormalizedRecord } from "./stage-b-comparators.mjs";
export { stageBPublicGraph } from "./stage-b-comparators.mjs";
export { stageBSurfaceUnchangedExcept } from "./stage-b-comparators.mjs";
