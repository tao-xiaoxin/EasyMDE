import type {
  AppearanceSnapshot,
  AppearanceState
} from '../bootstrap/appearance-bootstrap';

export type CustomCssSaveInput = Readonly<{
  id: string;
  name: string;
  css: string;
}>;

export type CustomCssSaveResult =
  | Readonly<{ status: 'saved'; snapshot: AppearanceSnapshot }>
  | Readonly<{ status: 'failed'; code: string }>;

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
