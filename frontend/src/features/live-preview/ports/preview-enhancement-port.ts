import type { PreviewFeatures } from '../../../contracts/ports/preview-request';
import type { VisualRuntimeFeature } from '../../../contracts/visual-editor';

export type PreviewEnhancementContext = Readonly<{
  codeTheme: string;
  signal: AbortSignal;
}>;

export type PreparedCodeTheme = Readonly<{
  cancel: () => void;
  commit: () => void;
}>;

export type PreviewRenderedStylesLease = Readonly<{
  dispose: () => void;
}>;

export type PreviewEnhancementFailureCode =
  | 'editor-stylesheet-apply-failed'
  | 'editor-stylesheet-import-unavailable'
  | 'editor-stylesheet-nested-rule-invalid'
  | 'editor-stylesheet-read-failed'
  | 'editor-stylesheet-rollback-failed'
  | 'editor-stylesheet-rule-invalid'
  | 'editor-stylesheet-scope-conflict'
  | 'editor-stylesheet-scope-empty'
  | 'editor-stylesheet-scope-invalid'
  | 'editor-stylesheet-scope-stale'
  | 'editor-stylesheet-selector-invalid'
  | 'editor-stylesheet-unavailable'
  | 'preview-enhancement-code-theme-missing'
  | 'preview-enhancement-document-head-missing'
  | 'preview-enhancement-failed'
  | 'preview-enhancement-mermaid-asset-contract-failed'
  | 'preview-enhancement-mermaid-runtime-unavailable'
  | 'preview-enhancement-render-failed'
  | 'preview-enhancement-resource-conflict'
  | 'preview-enhancement-resource-load-failed'
  | 'preview-enhancement-resource-stale'
  | 'preview-enhancement-rendered-style-read-failed'
  | 'preview-enhancement-rendered-style-rollback-failed'
  | 'preview-enhancement-rendered-style-scope-failed'
  | 'preview-enhancement-rendered-style-unavailable'
  | 'preview-enhancement-runtime-unavailable'
  | 'preview-enhancement-style-scope-failed'
  | 'preview-enhancement-visual-source-missing';

const failureCodes: ReadonlySet<string> = new Set<PreviewEnhancementFailureCode>([
  'editor-stylesheet-apply-failed',
  'editor-stylesheet-import-unavailable',
  'editor-stylesheet-nested-rule-invalid',
  'editor-stylesheet-read-failed',
  'editor-stylesheet-rollback-failed',
  'editor-stylesheet-rule-invalid',
  'editor-stylesheet-scope-conflict',
  'editor-stylesheet-scope-empty',
  'editor-stylesheet-scope-invalid',
  'editor-stylesheet-scope-stale',
  'editor-stylesheet-selector-invalid',
  'editor-stylesheet-unavailable',
  'preview-enhancement-code-theme-missing',
  'preview-enhancement-document-head-missing',
  'preview-enhancement-failed',
  'preview-enhancement-mermaid-asset-contract-failed',
  'preview-enhancement-mermaid-runtime-unavailable',
  'preview-enhancement-render-failed',
  'preview-enhancement-resource-conflict',
  'preview-enhancement-resource-load-failed',
  'preview-enhancement-resource-stale',
  'preview-enhancement-rendered-style-read-failed',
  'preview-enhancement-rendered-style-rollback-failed',
  'preview-enhancement-rendered-style-scope-failed',
  'preview-enhancement-rendered-style-unavailable',
  'preview-enhancement-runtime-unavailable',
  'preview-enhancement-style-scope-failed',
  'preview-enhancement-visual-source-missing'
]);

export function previewEnhancementFailureCode(error: unknown): PreviewEnhancementFailureCode {
  if (error instanceof Error && failureCodes.has(error.message)) {
    return error.message as PreviewEnhancementFailureCode;
  }
  return 'preview-enhancement-failed';
}

export type PreviewEnhancementRuntimeFeature = VisualRuntimeFeature;

export type PreviewEnhancementPort = Readonly<{
  dispose?: () => void;
  isFeatureReady?: (feature: PreviewEnhancementRuntimeFeature) => boolean;
  prepareCodeTheme: (
    context: PreviewEnhancementContext
  ) => Promise<PreparedCodeTheme>;
  scopeRenderedStyles: (surface: HTMLElement) => PreviewRenderedStylesLease;
  syncCodeFrameBackgrounds: (surface: HTMLElement) => void;
  enhance: (
    surface: HTMLElement,
    features: PreviewFeatures,
    isCurrent: () => boolean,
    context: PreviewEnhancementContext
  ) => Promise<void>;
}>;
