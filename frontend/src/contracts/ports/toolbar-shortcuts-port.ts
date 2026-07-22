export type PreparedToolbarShortcutBinding = Readonly<{
  activate: () => void;
  dispose: () => void;
}>;

export type ToolbarShortcutsPort = Readonly<{
  prepareBinding: (
    executeCommand: (commandId: string) => void
  ) => PreparedToolbarShortcutBinding;
}>;
