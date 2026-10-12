export type WechatVisualRasterizationKind = 'math' | 'mermaid';

export type WechatVisualRasterizationMermaidCapture =
  | 'intrinsic-viewport'
  | 'responsive-viewport';

/** Mermaid roles whose renderer-owned viewBox may become a local scroll width. */
export type WechatVisualRasterizationMermaidLayoutRole = 'gantt' | 'sequence' | 'timeline';

export type WechatVisualRasterizationYield = (() => Promise<void>) & {
  shouldYield: () => boolean;
};

export type WechatVisualRasterizationFailureCode =
  | 'wechat-png-baseline-failed'
  | 'wechat-png-decode-failed'
  | 'wechat-png-encode-failed'
  | 'wechat-png-font-failed'
  | 'wechat-png-image-failed'
  | 'wechat-png-rasterization-cancelled'
  | 'wechat-png-rasterization-unavailable'
  | 'wechat-png-rasterization-timeout'
  | 'wechat-png-size-invalid';

export type WechatVisualRasterizationRequest = Readonly<{
  height: number;
  /** Original Preview parent used to preserve inline line-box typography. */
  inlineParent?: Element;
  kind: WechatVisualRasterizationKind;
  /** Mermaid-only final display magnification; intrinsic local-scroll roles require 1. */
  layoutMagnification?: number;
  /** Clipboard-proven Mermaid SVG viewport capture mode. */
  mermaidCapture?: WechatVisualRasterizationMermaidCapture;
  maxPixels: number;
  scale: number;
  signal: AbortSignal;
  source: Element;
  /** Reuses the Clipboard owner's bounded task scheduler at safe raster stages. */
  yieldToBrowser?: WechatVisualRasterizationYield;
  width: number;
}>;

export type WechatVisualInlineLayout = Readonly<{
  baseline: number;
  height: number;
  overflowX?: WechatVisualInlineOverflow;
  overflowY?: WechatVisualInlineOverflow;
  paintOffsetX: number;
  paintOffsetY: number;
  viewport?: WechatVisualInlineViewport;
  width: number;
}>;

export type WechatVisualInlineOverflow = 'auto' | 'clip' | 'hidden' | 'scroll' | 'visible';

export type WechatVisualInlineViewport = Readonly<{
  height: number;
  offsetX: number;
  offsetY: number;
  width: number;
}>;

export type WechatVisualRasterizationResult = Readonly<{
  file: File;
  height: number;
  inlineLayout?: WechatVisualInlineLayout;
  pixelCount: number;
  width: number;
}>;

export type WechatVisualRasterizationPort = Readonly<{
  rasterize: (
    request: WechatVisualRasterizationRequest
  ) => Promise<WechatVisualRasterizationResult>;
}>;

export class WechatVisualRasterizationError extends Error {
  readonly code: WechatVisualRasterizationFailureCode;

  constructor(code: WechatVisualRasterizationFailureCode) {
    super(code);
    this.name = 'WechatVisualRasterizationError';
    this.code = code;
  }
}
