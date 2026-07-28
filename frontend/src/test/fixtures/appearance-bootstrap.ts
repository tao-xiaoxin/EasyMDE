import type {
  CustomCssDialogStrings,
  CustomCssVariable
} from '../../contracts/bootstrap/appearance-bootstrap';
import {
  CUSTOM_CSS_VARIABLE_IDS
} from '../../contracts/bootstrap/appearance-bootstrap';

export const customCssDialogStrings = {
  addCustomRulesComment: 'Add custom rules below',
  alertsCategory: 'Alerts',
  applyCustomTheme: 'Apply theme',
  articleCss: 'Article CSS',
  articleCssHelp: 'Article CSS help',
  articleNamePlaceholder: 'Article theme name',
  articleThemeName: 'Article theme name',
  backToThemeVariables: 'Back to theme variables',
  backToVariables: 'Back to variables',
  blocksCategory: 'Blocks',
  cancel: 'Cancel',
  close: 'Close',
  codeCategory: 'Code',
  codeCss: 'Code CSS',
  codeCssHelp: 'Code CSS help',
  codeNamePlaceholder: 'Code theme name',
  codeThemeName: 'Code theme name',
  colorPickerLabel: '%s color picker',
  closeTitle: 'Close',
  currentThemeVariablesComment: 'Current theme variables',
  customCssCode: 'Custom CSS code',
  customCssCodeHelp: 'Add detailed CSS rules',
  customCssCodeTitle: 'Custom CSS code',
  defaultArticleName: 'EasyMDE Blue',
  defaultCodeName: 'EasyMDE Blue Code',
  description: 'Create a custom theme.',
  expandCode: 'Expand code editor',
  foundationCategory: 'Foundation',
  invalidColor: 'Invalid color',
  livePreview: 'Live',
  missingName: 'Missing name',
  previewBlockquote: 'Blockquote preview',
  previewBodyText: 'Body text preview.',
  previewBoldText: 'bold text',
  previewCodeComment: 'Theme preview',
  previewCompletedTask: 'Completed task',
  previewDanger: 'Danger',
  previewDeletedText: 'deleted text',
  previewDetails: 'Additional details',
  previewDetailsContent: 'Supporting content.',
  previewDefinitionDescription: 'Definition description',
  previewDefinitionTerm: 'Definition list',
  previewFootnote: '[1] Footnote and supporting text color sample.',
  previewHeadingOne: 'Heading 1',
  previewHeadingTwo: 'Heading 2',
  previewHelp: 'Preview help',
  previewHighlight: 'highlight',
  previewInformation: 'Information',
  previewInlineConjunction: 'and ',
  previewInlineCode: 'inline code',
  previewInlineSeparator: ',',
  previewItalicText: 'italic text',
  previewLink: 'Link preview',
  previewNoteLabel: 'Localized note label',
  previewTipLabel: 'Localized tip label',
  previewWarningLabel: 'Localized warning label',
  previewCautionLabel: 'Localized caution label',
  previewOrderedItem: 'Ordered list item',
  previewParagraph: 'Theme preview with',
  previewSecondStep: 'Second step',
  previewSuccess: 'Success',
  previewSupplementalHeading: 'Tertiary heading and supporting content',
  previewSupplementalText: 'Images, math, and footnotes use body styles. Example footnote',
  previewTableContent: 'Content',
  previewTableHeader: 'Header',
  previewTitle: 'Preview',
  previewUnorderedItem: 'Unordered list item',
  previewWarning: 'Warning',
  previewSentenceEnd: '.',
  reset: 'Reset',
  resetAll: 'Reset all',
  saveTarget: 'CSS target',
  shrinkCode: 'Shrink code editor',
  themeVariables: 'Theme variables',
  themeVariableCategories: 'Theme variable categories',
  themeVariablePanelLabel: '%s theme variables',
  unsavedChanges: 'Changes have not been applied'
} satisfies CustomCssDialogStrings;

const blockVariableIds = new Set([
  'emphasisBackground',
  'selectionBackground',
  'quoteColor',
  'quoteBackground',
  'tableHeaderBackground',
  'tableStripeBackground'
]);
const codeVariableIds = new Set([
  'inlineCodeColor',
  'inlineCodeBackground',
  'codeBlockTextColor',
  'codeBlockBackground',
  'codeKeywordColor',
  'codeStringColor',
  'codeCommentColor'
]);
const alertVariableIds = new Set([
  'infoColor',
  'infoBackground',
  'successColor',
  'successBackground',
  'warningColor',
  'warningBackground',
  'dangerColor',
  'dangerBackground'
]);

export const customCssVariables: ReadonlyArray<CustomCssVariable> =
  CUSTOM_CSS_VARIABLE_IDS.map((id) => ({
    category: blockVariableIds.has(id)
      ? 'blocks'
      : codeVariableIds.has(id)
        ? 'code'
        : alertVariableIds.has(id)
          ? 'alerts'
          : 'foundation',
    description: `${id} description`,
    id,
    label: 'primaryColor' === id
      ? 'Primary color'
      : 'quoteColor' === id
        ? 'Quote accent'
        : 'codeBlockBackground' === id
          ? 'Code block background'
          : 'infoColor' === id
            ? 'Information accent'
            : id
  }));
