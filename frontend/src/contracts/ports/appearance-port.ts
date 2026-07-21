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

export interface AppearancePort {
  applyState(state: AppearanceState): void;
  closeOtherPopovers(): void;
  saveCustomCss(input: CustomCssSaveInput): Promise<CustomCssSaveResult>;
}
