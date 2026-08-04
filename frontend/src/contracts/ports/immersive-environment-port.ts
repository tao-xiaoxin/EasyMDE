export type ImmersiveEnvironmentPort = Readonly<{
  activeElement: () => HTMLElement | null;
  activateFavicon: () => () => void;
  activateFocusBoundary: (boundary: HTMLElement) => () => void;
  hasOpenToolbarPopover: () => boolean;
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
  subscribeResize: (listener: () => void) => () => void;
  observePreviewLayout: (
    surface: HTMLElement,
    listener: () => void
  ) => () => void;
  subscribeKeydown: (listener: (event: KeyboardEvent) => void) => () => void;
}>;
