import type {
  AppearanceSnapshot,
  AppearanceState
} from '../bootstrap/appearance-bootstrap';

export type CustomCssSaveInput = Readonly<{
  id: string;
  articleThemeName: string;
  codeThemeName: string;
  css: string;
}>;

export type CustomCssSaveResult =
  | Readonly<{ status: 'saved'; snapshot: AppearanceSnapshot }>
  | Readonly<{
    status: 'failed';
    code: 'easymde_duplicate_custom_css_name' | 'custom-css-save-failed';
  }>;

export type CustomCssPreviewResult =
  | Readonly<{ status: 'ready'; scopedCss: string }>
  | Readonly<{ status: 'invalid' }>;

export interface AppearancePort {
  applyState(state: AppearanceState, codeThemeExplicit: boolean): void;
  closeOtherPopovers(): void;
  previewCustomCss(
    css: string,
    signal: AbortSignal
  ): Promise<CustomCssPreviewResult>;
  saveCustomCss(input: CustomCssSaveInput): Promise<CustomCssSaveResult>;
}
