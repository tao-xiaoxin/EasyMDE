export type WechatPngEncodingFailureCode =
  | 'wechat-png-encode-failed'
  | 'wechat-png-rasterization-cancelled';

export type WechatPngEncodingRequest = Readonly<{
  canvas: HTMLCanvasElement;
  signal: AbortSignal;
}>;

export type WechatPngEncodingPort = Readonly<{
  encode: (request: WechatPngEncodingRequest) => Promise<Blob>;
}>;

export class WechatPngEncodingError extends Error {
  readonly code: WechatPngEncodingFailureCode;

  constructor(code: WechatPngEncodingFailureCode) {
    super(code);
    this.name = 'WechatPngEncodingError';
    this.code = code;
  }
}
