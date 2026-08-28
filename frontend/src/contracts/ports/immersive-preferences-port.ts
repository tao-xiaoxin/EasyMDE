export type ImmersivePreferences = Readonly<{
  outline: boolean;
  splitPreview: boolean;
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
