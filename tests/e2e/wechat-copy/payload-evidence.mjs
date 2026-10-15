// Stable payload evidence exports. Implementation is grouped by reader, measurement, and fixture boundaries.
export { taskBlockRow, readNativeCodeSurfaceEvidence } from "./payload-reader-evidence.mjs";
export {
  decodeTaskMarkerPixelEvidence,
  readTaskMarkerPixelEvidence,
  readSourceTaskMarkerPixelEvidence
} from "./payload-marker-measurement.mjs";
export {
  readTaskMarkerSourceContentWidth,
  calibrateTaskMarkerSourceViewport
} from "./payload-source-measurement.mjs";
export { mutateMdmdtLinkPayload } from "./payload-fixture-mutation.mjs";
