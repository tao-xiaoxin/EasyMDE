export type ReferenceArticleTheme = Readonly<{
  accent: string;
  accentBackground: string;
  accentLight: string;
  dark?: boolean;
  proseBackground?: string;
  proseText?: string;
}>;

const DEFAULT_REFERENCE_ARTICLE_THEME: ReferenceArticleTheme = {
  accent: '#333333',
  accentLight: '#AAAAAA',
  accentBackground: '#F5F5F5'
};

const REFERENCE_ARTICLE_THEMES: Readonly<Record<string, ReferenceArticleTheme>> = {
  default: DEFAULT_REFERENCE_ARTICLE_THEME,
  'orange-heart': { accent: '#FF6200', accentLight: '#FFB380', accentBackground: '#FFF3E0' },
  'chazi-purple': { accent: '#8E44AD', accentLight: '#C39BD3', accentBackground: '#F5EEF8' },
  'nenqing-green': { accent: '#00B4A6', accentLight: '#7FD8D2', accentBackground: '#E0F7F5' },
  'green-vitality': { accent: '#27AE60', accentLight: '#82D9A8', accentBackground: '#EAFAF1' },
  'red-crimson': { accent: '#E74C3C', accentLight: '#F5A89E', accentBackground: '#FDEDEC' },
  'crimson-focus': { accent: '#E74C3C', accentLight: '#F5A89E', accentBackground: '#FDEDEC' },
  'blue-ying': { accent: '#1E90FF', accentLight: '#90C8FF', accentBackground: '#EBF5FB' },
  lanqing: { accent: '#4A90E2', accentLight: '#A4C8F0', accentBackground: '#EBF5FB' },
  yamabuki: { accent: '#D4AC0D', accentLight: '#EDD86A', accentBackground: '#FEF9E7' },
  'grid-black': {
    accent: '#6C63FF',
    accentLight: '#9D97FF',
    accentBackground: '#0D0D0D',
    dark: true,
    proseBackground: '#111118',
    proseText: '#E2E8F0'
  },
  'geek-black': {
    accent: '#00E676',
    accentLight: '#66FFAA',
    accentBackground: '#0D0D0D',
    dark: true,
    proseBackground: '#0D0D0D',
    proseText: '#D4D4D4'
  },
  'rose-purple': { accent: '#E91E8C', accentLight: '#F57FC0', accentBackground: '#FFF0F8' },
  'ningye-purple': {
    accent: '#B39DDB',
    accentLight: '#D1C4E9',
    accentBackground: '#1A1030',
    dark: true,
    proseBackground: '#1A1030',
    proseText: '#E8E0F5'
  },
  'tech-blue': {
    accent: '#29B6F6',
    accentLight: '#81D4FA',
    accentBackground: '#0D1B2A',
    dark: true,
    proseBackground: '#0D1B2A',
    proseText: '#CFE8FA'
  },
  'qingbi-liujin': { accent: '#009688', accentLight: '#80CBC4', accentBackground: '#E0F2F1' },
  'qinghe-zhusha': { accent: '#C0392B', accentLight: '#E59866', accentBackground: '#FDF0E0' },
  'cute-green': { accent: '#4CAF50', accentLight: '#A5D6A7', accentBackground: '#F1F8E9' },
  'fullstack-blue': { accent: '#1565C0', accentLight: '#90CAF9', accentBackground: '#E3F2FD' },
  'minimal-black': { accent: '#212121', accentLight: '#9E9E9E', accentBackground: '#FAFAFA' },
  'orange-blue': { accent: '#FF6B35', accentLight: '#FFAB8A', accentBackground: '#FFF3EE' },
  'frontend-peak': { accent: '#4A90D9', accentLight: '#A4C8F0', accentBackground: '#EBF5FB' },
  'cupid-busy': { accent: '#FF4081', accentLight: '#FF80AB', accentBackground: '#FCE4EC' }
};

export function referenceArticleTheme(id: string): ReferenceArticleTheme {
  return REFERENCE_ARTICLE_THEMES[id] ?? DEFAULT_REFERENCE_ARTICLE_THEME;
}
