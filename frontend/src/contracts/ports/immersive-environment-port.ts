export type ImmersiveEnvironmentPort = Readonly<{
  activeElement: () => HTMLElement | null;
  hasOpenToolbarPopover: () => boolean;
  subscribeKeydown: (listener: (event: KeyboardEvent) => void) => () => void;
}>;
