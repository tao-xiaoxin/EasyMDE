export type ImmersiveWritingStrings = Readonly<{
  cancel: string;
  characters: string;
  columns: string;
  content: string;
  enter: string;
  escapeExit: string;
  exit: string;
  exitHint: string;
  insertTable: string;
  minutes: string;
  rows: string;
  startWriting: string;
  table: string;
  tableSize: string;
  untitled: string;
  words: string;
}>;

export type ImmersiveWritingBootstrap = Readonly<{
  strings: ImmersiveWritingStrings;
}>;

const STRING_KEYS: ReadonlyArray<keyof ImmersiveWritingStrings> = [
  'cancel',
  'characters',
  'columns',
  'content',
  'enter',
  'escapeExit',
  'exit',
  'exitHint',
  'insertTable',
  'minutes',
  'rows',
  'startWriting',
  'table',
  'tableSize',
  'untitled',
  'words'
];

export function parseImmersiveWritingBootstrap(value: unknown): ImmersiveWritingBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('immersive-writing-bootstrap-invalid');
  }
  const stringsValue = (value as Record<string, unknown>).strings;
  if (!stringsValue || 'object' !== typeof stringsValue || Array.isArray(stringsValue)) {
    throw new Error('immersive-writing-strings-invalid');
  }
  const source = stringsValue as Record<string, unknown>;
  const strings = {} as Record<keyof ImmersiveWritingStrings, string>;
  for (const key of STRING_KEYS) {
    const item = source[key];
    if ('string' !== typeof item || !item.trim() || item.length > 256) {
      throw new Error('immersive-writing-string-invalid');
    }
    strings[key] = item;
  }
  return { strings };
}
