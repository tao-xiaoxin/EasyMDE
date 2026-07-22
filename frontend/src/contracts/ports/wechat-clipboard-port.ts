export type WechatClipboardFailureCode =
  | 'wechat-clipboard-unsupported'
  | 'wechat-copy-failed'
  | 'wechat-preview-unavailable';

export type WechatClipboardResult =
  | Readonly<{ status: 'copied'; method: 'clipboard' | 'legacy' }>
  | Readonly<{ status: 'failed'; code: WechatClipboardFailureCode }>;

export type WechatClipboardPort = Readonly<{
  copy: (preview: HTMLElement) => Promise<WechatClipboardResult>;
}>;
