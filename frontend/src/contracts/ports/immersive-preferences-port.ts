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

export type ImmersivePreferencesReadResult =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ preferences: ImmersivePreferences; status: 'loaded' }>
  | Readonly<{ code: string; status: 'failed' }>;

export type ImmersivePreferencesPort = Readonly<{
  read: () => ImmersivePreferencesReadResult;
  write: (preferences: ImmersivePreferences) => ImmersivePreferencesWriteResult;
}>;
