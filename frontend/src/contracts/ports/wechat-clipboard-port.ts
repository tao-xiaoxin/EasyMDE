import type { ImageUploadPort } from './image-upload-port';
import type { WechatVisualRasterizationPort } from './wechat-visual-rasterization-port';

export type WechatClipboardFailureCode =
  | 'wechat-clipboard-unsupported'
  | 'wechat-copy-failed'
  | 'wechat-copy-unexpected-error'
  | 'wechat-preview-unavailable'
  | 'wechat-png-clipboard-failed'
  | 'wechat-png-limit-exceeded'
  | 'wechat-png-rasterization-cancelled'
  | 'wechat-png-rasterization-failed'
  | 'wechat-png-rasterization-timeout'
  | 'wechat-png-transaction-timeout'
  | 'wechat-png-upload-failed'
  | 'wechat-png-upload-nonce-invalid';

export type WechatClipboardCancellationCode = 'wechat-copy-cancelled';

export type WechatClipboardFailureSideEffects = 'none' | 'uploads-may-remain';

export type WechatClipboardCopyOptions = Readonly<{
  imageUploadPort?: ImageUploadPort;
  isCurrent?: () => boolean;
  maxBytes?: number;
  pngConversionEnabled?: boolean;
  postId?: number;
  resolvePreview?: () => Promise<HTMLElement | null>;
  signal?: AbortSignal;
  visualRasterizationPort?: WechatVisualRasterizationPort;
}>;

export type WechatClipboardResult =
  | Readonly<{ status: 'copied'; method: 'clipboard' | 'legacy' }>
  | Readonly<{
      code: WechatClipboardCancellationCode;
      sideEffects?: WechatClipboardFailureSideEffects;
      status: 'cancelled';
    }>
  | Readonly<{
      code: WechatClipboardFailureCode;
      sideEffects?: WechatClipboardFailureSideEffects;
      status: 'failed';
    }>;

export type WechatClipboardPreparationOptions = Readonly<{
  /** Background Preview notifications may be coalesced while a payload is preparing. */
  background?: boolean;
  /** Prepare only hidden-Preview geometry; do not serialize or upload a payload. */
  geometryOnly?: boolean;
  /** Cancels this background demand without canceling shared asset-cache work. */
  signal?: AbortSignal;
}>;

export type WechatClipboardPort = Readonly<{
  copy: (
    preview: HTMLElement,
    options?: WechatClipboardCopyOptions
  ) => Promise<WechatClipboardResult>;
  rememberPreviewWidth?: (preview: HTMLElement) => void;
  prepare?: (
    preview: HTMLElement,
    options?: WechatClipboardPreparationOptions
  ) => Promise<void>;
}>;
