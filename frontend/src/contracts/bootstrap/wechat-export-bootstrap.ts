export type WechatExportStrings = Readonly<{
  failed: string;
  success: string;
  unsupported: string;
}>;

export type WechatExportBootstrap = Readonly<{
  enabled: boolean;
  strings: WechatExportStrings;
}>;

function stringValue(value: unknown): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > 512) {
    throw new Error('wechat-export-string-invalid');
  }
  return value;
}

export function parseWechatExportBootstrap(value: unknown): WechatExportBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('wechat-export-bootstrap-invalid');
  }
  const bootstrap = value as Record<string, unknown>;
  if (!bootstrap.strings || 'object' !== typeof bootstrap.strings || Array.isArray(bootstrap.strings)) {
    throw new Error('wechat-export-strings-invalid');
  }
  const strings = bootstrap.strings as Record<string, unknown>;
  return {
    enabled: true === bootstrap.enabled,
    strings: {
      failed: stringValue(strings.failed),
      success: stringValue(strings.success),
      unsupported: stringValue(strings.unsupported)
    }
  };
}
