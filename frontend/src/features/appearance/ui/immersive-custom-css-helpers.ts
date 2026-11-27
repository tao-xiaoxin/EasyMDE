import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent
} from 'react';

import type {
  CustomCssDialogStrings,
  CustomCssVariable,
  CustomCssVariableId
} from '../../../contracts/bootstrap/appearance-bootstrap';
import { CUSTOM_CSS_VARIABLE_IDS } from '../../../contracts/bootstrap/appearance-bootstrap';

export type ThemeVariableCategory = CustomCssVariable['category'];
export type ThemeVariables = Record<CustomCssVariableId, string>;
export type CustomCssSaveError = Readonly<{
  code: 'duplicate-name' | 'save-failed';
  message: string;
}>;

export const CUSTOM_THEME_NAME_MAX_LENGTH = 30;

export function limitCustomThemeName(value: string): string {
  return Array.from(value).slice(0, CUSTOM_THEME_NAME_MAX_LENGTH).join('');
}

export function customThemeNameLength(value: string): number {
  return Array.from(value).length;
}

export const DEFAULT_THEME_VARIABLES: ThemeVariables = {
  primaryColor: '#3B82F6',
  headingColor: '#6366F1',
  textColor: '#1F2937',
  mutedColor: '#6B7280',
  linkColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  borderColor: '#E5E7EB',
  emphasisBackground: '#FEF3C7',
  selectionBackground: '#DBEAFE',
  quoteColor: '#8B5CF6',
  quoteBackground: '#F5F3FF',
  tableHeaderBackground: '#EEF2FF',
  tableStripeBackground: '#F8FAFC',
  inlineCodeColor: '#10B981',
  inlineCodeBackground: '#F5F3FF',
  codeBlockTextColor: '#1F2937',
  codeBlockBackground: '#F8FAFC',
  codeKeywordColor: '#10B981',
  codeStringColor: '#F97316',
  codeCommentColor: '#6B7280',
  infoColor: '#2563EB',
  infoBackground: '#EFF6FF',
  successColor: '#059669',
  successBackground: '#ECFDF5',
  warningColor: '#D97706',
  warningBackground: '#FFFBEB',
  dangerColor: '#DC2626',
  dangerBackground: '#FEF2F2'
};

export const CATEGORY_ORDER: ReadonlyArray<ThemeVariableCategory> = [
  'foundation',
  'blocks',
  'code',
  'alerts'
];

export const CSS_TARGETS = ['article', 'code'] as const;

export function handleTabKeyDown<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  options: ReadonlyArray<T>,
  current: T,
  onSelect: (value: T) => void
) {
  const currentIndex = options.indexOf(current);
  let nextIndex: number;

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (currentIndex - 1 + options.length) % options.length;
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % options.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = options.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const next = options[nextIndex];
  if (undefined === next) {
    throw new Error('Tab keyboard navigation resolved an invalid index.');
  }
  onSelect(next);
  const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
    '[role="tab"]'
  );
  tabs?.[nextIndex]?.focus();
}

export function isThemeVariableKey(value: string): value is CustomCssVariableId {
  return CUSTOM_CSS_VARIABLE_IDS.includes(value as CustomCssVariableId);
}

export function isHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value);
}

export function toCssVariableName(key: CustomCssVariableId): string {
  return `--easymde-${key.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`
  )}`;
}

export function buildPreviewStyle(themeVariables: ThemeVariables): CSSProperties {
  const cssProperties: Record<string, string> = {};
  for (const key of CUSTOM_CSS_VARIABLE_IDS) {
    cssProperties[toCssVariableName(key)] = themeVariables[key];
  }
  return cssProperties as CSSProperties;
}

function themeVariableDeclarations(variables: ThemeVariables): string {
  return CUSTOM_CSS_VARIABLE_IDS.map(
    (key) => `  ${toCssVariableName(key)}: ${variables[key]};`
  ).join('\n');
}

function appendCustomCss(generatedCss: string, customCss: string): string {
  return customCss.trim()
    ? `${generatedCss}\n\n${customCss.trim()}`
    : generatedCss;
}

export function buildImmersiveCustomCss(
  variables: ThemeVariables,
  articleCustomCss: string,
  codeCustomCss: string
): string {
  const articleCss = `:root {
${themeVariableDeclarations(variables)}
  color: ${variables.textColor};
  background: ${variables.backgroundColor};
}

h1 { color: ${variables.primaryColor}; }
h2, h3, h4, h5, h6, strong, dt, summary { color: ${variables.headingColor}; }
p, li, td, details { color: ${variables.textColor}; }
a { color: ${variables.linkColor}; }
del, figcaption, .footnotes, .footnote-backref { color: ${variables.mutedColor}; }
mark { color: ${variables.textColor}; background: ${variables.emphasisBackground}; }
::selection { color: ${variables.textColor}; background: ${variables.selectionBackground}; }
blockquote {
  color: ${variables.textColor};
  border-left-color: ${variables.quoteColor};
  background: ${variables.quoteBackground};
}
li::marker { color: ${variables.primaryColor}; }
.task-item input[type="checkbox"] { accent-color: ${variables.successColor}; }
table, th, td, hr, details, .footnotes { border-color: ${variables.borderColor}; }
th { color: ${variables.headingColor}; background: ${variables.tableHeaderBackground}; }
td { background: ${variables.backgroundColor}; }
tr:nth-child(even) td { background: ${variables.tableStripeBackground}; }
.markdown-alert-note { border-left-color: ${variables.infoColor}; background: ${variables.infoBackground}; }
.markdown-alert-tip { border-left-color: ${variables.successColor}; background: ${variables.successBackground}; }
.markdown-alert-warning { border-left-color: ${variables.warningColor}; background: ${variables.warningBackground}; }
.markdown-alert-caution { border-left-color: ${variables.dangerColor}; background: ${variables.dangerBackground}; }`;

  const codeCss = `code:not(.hljs):not([class*="language-"]) {
  color: ${variables.inlineCodeColor};
  background: ${variables.inlineCodeBackground};
}
kbd {
  color: ${variables.inlineCodeColor};
  background: ${variables.inlineCodeBackground};
  border-color: ${variables.borderColor};
}
pre, pre > code.hljs {
  color: ${variables.codeBlockTextColor};
  background: ${variables.codeBlockBackground};
  border-color: ${variables.borderColor};
}
.hljs-keyword, .hljs-title, .hljs-built_in, .hljs-type, .hljs-selector-tag {
  color: ${variables.codeKeywordColor};
}
.hljs-string, .hljs-number, .hljs-attr, .hljs-attribute, .hljs-literal, .hljs-regexp {
  color: ${variables.codeStringColor};
}
.hljs-comment, .hljs-quote { color: ${variables.codeCommentColor}; }`;

  return [
    appendCustomCss(articleCss, articleCustomCss),
    appendCustomCss(codeCss, codeCustomCss)
  ].join('\n\n');
}

export function customCssPlaceholder(
  variables: ThemeVariables,
  strings: CustomCssDialogStrings
): string {
  return `/* ${strings.currentThemeVariablesComment} */
:root {
${themeVariableDeclarations(variables)}
}

/* ${strings.addCustomRulesComment} */
h2 {
  border-bottom-color: var(--easymde-primary-color);
}

a:hover {
  color: var(--easymde-heading-color);
}`;
}
