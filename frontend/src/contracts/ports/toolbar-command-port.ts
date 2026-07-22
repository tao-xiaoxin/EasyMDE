export type ToolbarCommandSelection = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

export type ToolbarCommandDocumentSnapshot = Readonly<{
  selection: ToolbarCommandSelection;
  value: string;
}>;

export interface ToolbarCommandDocumentPort {
  applyTextChange(change: ToolbarCommandDocumentSnapshot): void;
  focus(): void;
  getSnapshot(): ToolbarCommandDocumentSnapshot;
}
