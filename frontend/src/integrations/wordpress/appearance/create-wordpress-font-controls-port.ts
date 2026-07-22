import type { FontControlsState } from '../../../contracts/bootstrap/font-controls-bootstrap';
import type { FontControlsPort } from '../../../contracts/ports/font-controls-port';

type FontFields = Readonly<Record<keyof FontControlsState, HTMLInputElement>>;

export function createWordPressFontControlsPort(fields: FontFields): FontControlsPort {
  if (Object.values(fields).some((field) => !(field instanceof HTMLInputElement))) {
    throw new Error('font-controls-native-fields-unavailable');
  }

  return {
    applyState(state) {
      fields.customFont.value = state.customFont;
      fields.windowsFont.value = state.windowsFont;
      fields.appleFont.value = state.appleFont;
      fields.serifFont.value = state.serifFont;
    },
    closeOtherPopovers: () => undefined
  };
}
