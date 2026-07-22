export type ImmersivePreferences = Readonly<{
  autoSave: boolean;
  outline: boolean;
  splitPreview: boolean;
  syncScroll: boolean;
  wordCount: boolean;
}>;

export type ImmersivePreferencesWriteResult =
  | Readonly<{ status: 'saved' }>
  | Readonly<{ code: string; status: 'unavailable' }>;

export type ImmersivePreferencesPort = Readonly<{
  read: () => ImmersivePreferences | null;
  write: (preferences: ImmersivePreferences) => ImmersivePreferencesWriteResult;
}>;
