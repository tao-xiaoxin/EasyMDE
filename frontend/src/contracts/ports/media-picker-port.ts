export type MediaPickerSelection = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

export type MediaPickerDocumentSnapshot = Readonly<{
  selection: MediaPickerSelection;
  value: string;
}>;

export type MediaPickerDocumentPort = Readonly<{
  applyTextChange: (change: MediaPickerDocumentSnapshot) => void;
  focus: () => void;
  getSnapshot: () => MediaPickerDocumentSnapshot;
}>;

export type MediaPickerFrameOptions = Readonly<{
  onClose: () => void;
  onError: (error: unknown) => void;
  onSelect: (attachment: unknown) => void;
  title: string;
}>;

export type MediaPickerFramePort = Readonly<{
  open: (options: MediaPickerFrameOptions) => void;
}>;
