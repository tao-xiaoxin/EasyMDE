export type WechatVisualRasterizationKind = 'math' | 'mermaid';

export type WechatVisualRasterizationFailureCode =
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
  kind: WechatVisualRasterizationKind;
  maxPixels: number;
  scale: number;
  signal: AbortSignal;
  source: Element;
  width: number;
}>;

export type WechatVisualRasterizationResult = Readonly<{
  file: File;
  height: number;
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
