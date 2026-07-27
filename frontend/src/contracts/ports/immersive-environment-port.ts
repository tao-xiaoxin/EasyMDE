export type ImmersiveEnvironmentPort = Readonly<{
  activeElement: () => HTMLElement | null;
  activateFavicon: () => () => void;
  activateFocusBoundary: (boundary: HTMLElement) => () => void;
  hasOpenToolbarPopover: () => boolean;
  schedule: (callback: () => void, delay: number) => () => void;
  subscribeKeydown: (listener: (event: KeyboardEvent) => void) => () => void;
}>;
