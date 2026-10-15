// Stable payload oracle exports. Implementation is grouped by code, task, pixel, and article boundaries.
export {
  assertNativeCodeSurface,
  assertNativeCodePayloadMatches,
  assertPositionStrippedCodeSurface
} from "./payload-code-oracle.mjs";
export {
  assertTaskMarkerSurface,
  assertTaskMarkerPositionStripped,
  assertTaskMarkerGeometryProjection,
  assertTaskMarkerOracleNegativeCases,
  createTaskMarkerLegalProjection
} from "./payload-task-oracle.mjs";
export {
  assertTaskMarkerPixelPaint,
  assertTaskMarkerPixelParity,
  assertTaskMarkerPixelParityNegativeCases
} from "./payload-pixel-oracle.mjs";
export {
  assertNativeArticleSurface,
  assertMdmdtLinkDecorationEvidence,
  assertNativeVisualSignatures
} from "./payload-article-oracle.mjs";
