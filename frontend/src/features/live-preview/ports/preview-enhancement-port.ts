import type { PreviewFeatures } from '../../../contracts/ports/preview-request';

export type PreviewEnhancementContext = Readonly<{
  codeTheme: string;
  signal: AbortSignal;
}>;

export type PreviewEnhancementFailureCode =
  | 'preview-enhancement-code-theme-missing'
  | 'preview-enhancement-document-head-missing'
  | 'preview-enhancement-failed'
  | 'preview-enhancement-render-failed'
  | 'preview-enhancement-resource-conflict'
  | 'preview-enhancement-resource-load-failed'
  | 'preview-enhancement-resource-stale'
  | 'preview-enhancement-runtime-unavailable';

const failureCodes: ReadonlySet<string> = new Set<PreviewEnhancementFailureCode>([
  'preview-enhancement-code-theme-missing',
  'preview-enhancement-document-head-missing',
  'preview-enhancement-failed',
  'preview-enhancement-render-failed',
  'preview-enhancement-resource-conflict',
  'preview-enhancement-resource-load-failed',
  'preview-enhancement-resource-stale',
  'preview-enhancement-runtime-unavailable'
]);

export function previewEnhancementFailureCode(error: unknown): PreviewEnhancementFailureCode {
  if (error instanceof Error && failureCodes.has(error.message)) {
    return error.message as PreviewEnhancementFailureCode;
  }
  return 'preview-enhancement-failed';
}

export type PreviewEnhancementPort = Readonly<{
  dispose?: () => void;
  enhance: (
    surface: HTMLElement,
    features: PreviewFeatures,
    isCurrent: () => boolean,
    context: PreviewEnhancementContext
  ) => Promise<void>;
}>;
