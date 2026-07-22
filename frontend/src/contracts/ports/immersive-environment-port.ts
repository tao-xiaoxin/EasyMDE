export type ImmersiveEnvironmentPort = Readonly<{
  activeElement: () => HTMLElement | null;
  activateFocusBoundary: (boundary: HTMLElement) => () => void;
  hasOpenToolbarPopover: () => boolean;
  subscribeKeydown: (listener: (event: KeyboardEvent) => void) => () => void;
}>;
