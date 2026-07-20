export type PreviewScrollSnapshot = Readonly<{
  left: number;
  ratio: number;
  top: number;
}>;

export type PreviewScrollPort = Readonly<{
  capture: (surface: HTMLElement) => PreviewScrollSnapshot;
  restore: (surface: HTMLElement, snapshot: PreviewScrollSnapshot) => void;
}>;
