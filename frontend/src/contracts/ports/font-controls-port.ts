import type { FontControlsState } from '../bootstrap/font-controls-bootstrap';

export interface FontControlsPort {
  applyState(state: FontControlsState): void;
  closeOtherPopovers(): void;
}
