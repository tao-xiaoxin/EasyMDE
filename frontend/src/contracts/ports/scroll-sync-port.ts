export type ScrollSyncBindingOptions = Readonly<{
  preview: HTMLElement;
  source: HTMLElement;
}>;

export type PreparedScrollSyncBinding = Readonly<{
  activate: () => void;
  dispose: () => void;
}>;

export type ScrollSyncPort = Readonly<{
  prepareBinding: (options: ScrollSyncBindingOptions) => PreparedScrollSyncBinding;
}>;
