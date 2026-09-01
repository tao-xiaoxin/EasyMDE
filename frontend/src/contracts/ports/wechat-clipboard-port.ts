import type { ImageUploadPort } from './image-upload-port';
import type { WechatVisualRasterizationPort } from './wechat-visual-rasterization-port';

export type WechatClipboardFailureCode =
  | 'wechat-clipboard-unsupported'
  | 'wechat-copy-failed'
  | 'wechat-preview-unavailable'
  | 'wechat-png-clipboard-failed'
  | 'wechat-png-limit-exceeded'
  | 'wechat-png-rasterization-cancelled'
  | 'wechat-png-rasterization-failed'
  | 'wechat-png-rasterization-timeout'
  | 'wechat-png-transaction-timeout'
  | 'wechat-png-upload-failed';

export type WechatClipboardFailureSideEffects = 'none' | 'uploads-may-remain';

export type WechatClipboardCopyOptions = Readonly<{
  imageUploadPort?: ImageUploadPort;
  isCurrent?: () => boolean;
  maxBytes?: number;
  pngConversionEnabled?: boolean;
  postId?: number;
  signal?: AbortSignal;
  visualRasterizationPort?: WechatVisualRasterizationPort;
}>;

export type WechatClipboardResult =
  | Readonly<{ status: 'copied'; method: 'clipboard' | 'legacy' }>
  | Readonly<{
      code: WechatClipboardFailureCode;
      sideEffects?: WechatClipboardFailureSideEffects;
      status: 'failed';
    }>;

export type WechatClipboardPreparationOptions = Readonly<{
  /** Background Preview notifications may be coalesced while a payload is preparing. */
  background?: boolean;
}>;

export type WechatClipboardPort = Readonly<{
  copy: (
    preview: HTMLElement,
    options?: WechatClipboardCopyOptions
  ) => Promise<WechatClipboardResult>;
  prepare?: (
    preview: HTMLElement,
    options?: WechatClipboardPreparationOptions
  ) => Promise<void>;
}>;
