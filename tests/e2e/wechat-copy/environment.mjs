
export const intrinsicGeometryTolerance = 1 / 64;
export const taskMarkerSourceViewportBounds = { max: 4096, min: 1 };
export const pngWorkerResourcePattern = /\/assets\/wechat-png-encoder-[A-Za-z0-9_-]+\.js$/u;
export const bloomArticleThemeIds = [
  'bloom-petal',
  'bloom-mist',
  'bloom-verdant',
  'bloom-stone',
  'bloom-wheat',
  'bloom-ink',
  'bloom-amber',
  'bloom-lapis',
  'bloom-ripple',
  'bloom-cinnabar',
  'bloom-sage',
  'bloom-spring'
];
export const copyDiagnosticsEnabled = '1' === process.env.EASYMDE_E2E_COPY_DIAGNOSTICS;
export const finiteTransitionsProbeEnabled = '1' === process.env.EASYMDE_E2E_PROBE_FINITE_TRANSITIONS;
export const finitePreviewAnimationsProbeEnabled = '1' === process.env.EASYMDE_E2E_PROBE_FINITE_PREVIEW_ANIMATIONS;
export const positionStrippedFrameProbeEnabled = '1' === process.env.EASYMDE_E2E_PROBE_POSITION_STRIPPED_FRAME;
export const nativeClipboardSurfaceWidths = [375, 578, 760];
