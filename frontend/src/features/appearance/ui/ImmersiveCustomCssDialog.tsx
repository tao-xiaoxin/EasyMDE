import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
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
import {
  ChevronLeft,
  CheckCircle2,
  CircleAlert,
  Code2,
  Info,
  Link2,
  Maximize,
  Minimize,
  RotateCcw,
  X
} from '../../../generated/lucide-icons';

type ThemeVariableCategory = CustomCssVariable['category'];
type ThemeVariables = Record<CustomCssVariableId, string>;

type ImmersiveCustomCssDialogProps = Readonly<{
  initialCss: string;
  initialName: string;
  onApply: (input: Readonly<{ css: string; name: string }>) => Promise<boolean>;
  onClose: () => void;
  saveFailedMessage: string;
  strings: CustomCssDialogStrings;
  title: string;
  variables: ReadonlyArray<CustomCssVariable>;
}>;

const DEFAULT_THEME_VARIABLES: ThemeVariables = {
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

const CATEGORY_ORDER: ReadonlyArray<ThemeVariableCategory> = [
  'foundation',
  'blocks',
  'code',
  'alerts'
];
const CSS_TARGETS = ['article', 'code'] as const;

function handleTabKeyDown<T extends string>(
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

function isThemeVariableKey(value: string): value is CustomCssVariableId {
  return CUSTOM_CSS_VARIABLE_IDS.includes(value as CustomCssVariableId);
}

function isHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value);
}

function toCssVariableName(key: CustomCssVariableId): string {
  return `--easymde-${key.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`
  )}`;
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
.hljs-comment, .hljs-quote, .code-line-number { color: ${variables.codeCommentColor}; }`;

  return [
    appendCustomCss(articleCss, articleCustomCss),
    appendCustomCss(codeCss, codeCustomCss)
  ].join('\n\n');
}

function customCssPlaceholder(
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

function ThemeSparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" width="23" height="23">
      <path
        d="M13.1 1.8c.9 5.8 4.3 9.2 10.1 10.1-5.8.9-9.2 4.3-10.1 10.1C12.2 16.2 8.8 12.8 3 11.9c5.8-.9 9.2-4.3 10.1-10.1Z"
        fill="#5674F7"
      />
      <path
        d="M22.5 18.4c.35 2.25 1.7 3.6 3.95 3.95-2.25.35-3.6 1.7-3.95 3.95-.35-2.25-1.7-3.6-3.95-3.95 2.25-.35 3.6-1.7 3.95-3.95Z"
        fill="#8A67F7"
      />
    </svg>
  );
}

function PreviewContent({
  strings,
  style
}: Readonly<{
  strings: CustomCssDialogStrings;
  style: CSSProperties;
}>) {
  return (
    <div className="easymde-custom-theme-preview" style={style}>
      <h1>{strings.previewHeadingOne}</h1>
      <h2>{strings.previewHeadingTwo}</h2>
      <p>{strings.previewBodyText}</p>
      <p>
        {strings.previewParagraph} <strong>{strings.previewBoldText}</strong>
        {strings.previewInlineSeparator}
        <em>{strings.previewItalicText}</em>
        {strings.previewInlineSeparator}
        <del>{strings.previewDeletedText}</del>
        {strings.previewInlineSeparator}
        <mark>{strings.previewHighlight}</mark>
        {strings.previewInlineSeparator}
        <code>{strings.previewInlineCode}</code>{' '}
        {strings.previewInlineConjunction}<kbd>Ctrl K</kbd>
        {strings.previewSentenceEnd}
      </p>
      <pre>
        <code className="code-block">
          <span className="code-preview-line">
            <span className="code-line-number">1</span>
            <span>
              <span className="token-keyword">const</span> message ={' '}
              <span className="token-string">&quot;Hello, EasyMDE!&quot;</span>
              {';'}
            </span>
          </span>
          <span className="code-preview-line">
            <span className="code-line-number">2</span>
            <span className="token-comment">
              {'// '}
              {strings.previewCodeComment}
            </span>
          </span>
          <span className="code-preview-line">
            <span className="code-line-number">3</span>
            <span>
              <span className="token-function">renderTheme</span>(message);
            </span>
          </span>
        </code>
      </pre>
      <blockquote>{strings.previewBlockquote}</blockquote>
      <div className="preview-list-grid">
        <ul>
          <li>{strings.previewUnorderedItem}</li>
          <li className="task-item">
            <input
              type="checkbox"
              checked
              readOnly
              aria-label={strings.previewCompletedTask}
            />
            {strings.previewCompletedTask}
          </li>
        </ul>
        <ol>
          <li>{strings.previewOrderedItem}</li>
          <li>{strings.previewSecondStep}</li>
        </ol>
      </div>
      <table>
        <thead>
          <tr>
            {[1, 2, 3].map((number) => (
              <th key={number}>{strings.previewTableHeader} {number}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {[1, 2, 3].map((number) => (
              <td key={number}>{strings.previewTableContent} {number}</td>
            ))}
          </tr>
          <tr>
            {[4, 5, 6].map((number) => (
              <td key={number}>{strings.previewTableContent} {number}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <a id="preview-link" href="#preview-link">
        <Link2 aria-hidden="true" size={15} />
        {strings.previewLink}
      </a>
      <div className="preview-alert-grid">
        <aside className="markdown-alert-note">
          <strong>{strings.previewNoteLabel}</strong>
          <span>{strings.previewInformation}</span>
        </aside>
        <aside className="markdown-alert-tip">
          <strong>{strings.previewTipLabel}</strong>
          <span>{strings.previewSuccess}</span>
        </aside>
        <aside className="markdown-alert-warning">
          <strong>{strings.previewWarningLabel}</strong>
          <span>{strings.previewWarning}</span>
        </aside>
        <aside className="markdown-alert-caution">
          <strong>{strings.previewCautionLabel}</strong>
          <span>{strings.previewDanger}</span>
        </aside>
      </div>
      <details open>
        <summary>{strings.previewDetails}</summary>
        <p>{strings.previewDetailsContent}</p>
      </details>
      <dl>
        <dt>{strings.previewDefinitionTerm}</dt>
        <dd>{strings.previewDefinitionDescription}</dd>
      </dl>
      <hr />
      <h3>{strings.previewSupplementalHeading}</h3>
      <p>
        {strings.previewSupplementalText}
        <sup>
          <a href="#preview-footnote">
            [1]
          </a>
        </sup>
      </p>
      <div id="preview-footnote" className="footnotes">
        {strings.previewFootnote}
      </div>
    </div>
  );
}

function CodeEditor({
  label,
  onChange,
  placeholder,
  value
}: Readonly<{
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}>) {
  const displayValue = value || placeholder;
  const lineCount = displayValue.split('\n').length;

  return (
    <div className="easymde-custom-css-code-editor">
      <div aria-hidden="true" className="easymde-custom-css-code-lines">
        {Array.from({ length: lineCount }, (_, index) => index + 1).map(
          (lineNumber) => (
            <span key={lineNumber}>{lineNumber}</span>
          )
        )}
      </div>
      <textarea
        aria-label={label}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

export function ImmersiveCustomCssDialog({
  initialCss,
  initialName,
  onApply,
  onClose,
  saveFailedMessage,
  strings,
  title,
  variables
}: ImmersiveCustomCssDialogProps) {
  const titleId = useId();
  const articleNameId = useId();
  const codeNameId = useId();
  const categoryTabId = useId();
  const categoryPanelId = useId();
  const cssTargetTabId = useId();
  const cssTargetPanelId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  const [articleName, setArticleName] = useState(
    initialName || strings.defaultArticleName
  );
  const [codeName, setCodeName] = useState(strings.defaultCodeName);
  const [themeVariables, setThemeVariables] = useState<ThemeVariables>({
    ...DEFAULT_THEME_VARIABLES
  });
  const [articleCustomCss, setArticleCustomCss] = useState(initialCss);
  const [codeCustomCss, setCodeCustomCss] = useState('');
  const [cssTarget, setCssTarget] = useState<'article' | 'code'>('article');
  const [activeCategory, setActiveCategory] =
    useState<ThemeVariableCategory>('foundation');
  const [showCssEditor, setShowCssEditor] = useState(false);
  const [cssEditorExpanded, setCssEditorExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.closest('[hidden]'));
    getFocusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if ('Escape' === event.key) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (savingRef.current) return;
        if (cssEditorExpanded) {
          setCssEditorExpanded(false);
        } else {
          onClose();
        }
        return;
      }
      const focusable = getFocusable();
      if ('Tab' !== event.key || 0 === focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const documentRef = dialog.ownerDocument;
    documentRef.addEventListener('keydown', onKeyDown, true);
    return () => documentRef.removeEventListener('keydown', onKeyDown, true);
  }, [cssEditorExpanded, onClose]);

  const hasInvalidColor = Object.values(themeVariables).some(
    (value) => !isHexColor(value)
  );
  const hasMissingName = !articleName.trim() || !codeName.trim();
  const hasFormError = hasInvalidColor || hasMissingName;
  const categoryLabels: Readonly<Record<ThemeVariableCategory, string>> = {
    foundation: strings.foundationCategory,
    blocks: strings.blocksCategory,
    code: strings.codeCategory,
    alerts: strings.alertsCategory
  };
  const previewStyle = useMemo(() => {
    const cssProperties: Record<string, string> = {};
    for (const key of CUSTOM_CSS_VARIABLE_IDS) {
      cssProperties[toCssVariableName(key)] = themeVariables[key];
    }
    return cssProperties as CSSProperties;
  }, [themeVariables]);
  const placeholder = useMemo(
    () => customCssPlaceholder(themeVariables, strings),
    [strings, themeVariables]
  );

  const resetAll = () => {
    setArticleName(strings.defaultArticleName);
    setCodeName(strings.defaultCodeName);
    setThemeVariables({ ...DEFAULT_THEME_VARIABLES });
    setArticleCustomCss('');
    setCodeCustomCss('');
    setCssTarget('article');
    setActiveCategory('foundation');
    setShowCssEditor(false);
    setCssEditorExpanded(false);
    setSaveError('');
  };

  const closeDialog = () => {
    if (!savingRef.current) onClose();
  };

  const applyCustomTheme = async () => {
    if (savingRef.current || hasFormError) return;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      const saved = await onApply({
        name: `${articleName.trim()} / ${codeName.trim()}`,
        css: buildImmersiveCustomCss(
          themeVariables,
          articleCustomCss,
          codeCustomCss
        )
      });
      if (!activeRef.current) return;
      if (saved) {
        onClose();
      } else {
        setSaveError(saveFailedMessage);
      }
    } finally {
      savingRef.current = false;
      if (activeRef.current) setIsSaving(false);
    }
  };

  return (
    <div className="easymde-immersive-custom-css-backdrop">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isSaving}
        className={`easymde-immersive-custom-css-dialog${
          cssEditorExpanded ? ' is-code-expanded' : ''
        }`}
      >
        <header>
          <div>
            <ThemeSparkIcon />
            <h1 id={titleId}>{title}</h1>
          </div>
          <p>{strings.description}</p>
          <button
            type="button"
            aria-label={strings.close}
            title={strings.closeTitle}
            disabled={isSaving}
            onClick={closeDialog}
          >
            <X size={24} strokeWidth={1.8} />
          </button>
        </header>

        <div className="easymde-immersive-custom-css-names">
          <label htmlFor={articleNameId}>{strings.articleThemeName}</label>
          <div>
            <input
              id={articleNameId}
              value={articleName}
              maxLength={30}
              placeholder={strings.articleNamePlaceholder}
              onChange={(event) => setArticleName(event.currentTarget.value)}
            />
            <span>{articleName.length}/30</span>
          </div>
          <label htmlFor={codeNameId}>{strings.codeThemeName}</label>
          <div>
            <input
              id={codeNameId}
              value={codeName}
              maxLength={30}
              placeholder={strings.codeNamePlaceholder}
              onChange={(event) => setCodeName(event.currentTarget.value)}
            />
            <span>{codeName.length}/30</span>
          </div>
          <div
            className={`easymde-immersive-custom-css-validity${
              hasFormError ? ' is-error' : ''
            }`}
          >
            {hasFormError ? (
              <CircleAlert size={18} strokeWidth={2} />
            ) : (
              <CheckCircle2 size={18} strokeWidth={2} />
            )}
            {hasInvalidColor
              ? strings.invalidColor
              : hasMissingName
                ? strings.missingName
                : strings.unsavedChanges}
          </div>
        </div>

        <div className="easymde-immersive-custom-css-main">
          <div className="easymde-immersive-custom-css-grid">
            <section className="easymde-immersive-custom-css-preview">
              <div>
                <span>
                  <h2>{strings.previewTitle}</h2>
                  <span className="easymde-immersive-custom-css-live">
                    {strings.livePreview}
                  </span>
                </span>
                <small title={strings.previewHelp}>
                  <Info size={13} />
                  <span>{strings.previewHelp}</span>
                </small>
              </div>
              <div>
                <PreviewContent strings={strings} style={previewStyle} />
              </div>
            </section>

            <section className="easymde-immersive-custom-css-controls">
              <div className="easymde-immersive-custom-css-controls-header">
                <h2>
                  {showCssEditor
                    ? strings.customCssCodeTitle
                    : strings.themeVariables}
                </h2>
                {showCssEditor ? (
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        'article' === cssTarget
                          ? setArticleCustomCss('')
                          : setCodeCustomCss('')
                      }
                    >
                      <RotateCcw size={15} strokeWidth={1.8} />
                      {strings.reset}
                    </button>
                    <button
                      type="button"
                      aria-label={
                        cssEditorExpanded
                          ? strings.shrinkCode
                          : strings.expandCode
                      }
                      title={
                        cssEditorExpanded
                          ? strings.shrinkCode
                          : strings.expandCode
                      }
                      onClick={() => setCssEditorExpanded((value) => !value)}
                    >
                      {cssEditorExpanded ? (
                        <Minimize size={15} strokeWidth={1.8} />
                      ) : (
                        <Maximize size={15} strokeWidth={1.8} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCssEditorExpanded(false);
                        setShowCssEditor(false);
                      }}
                    >
                      <ChevronLeft size={15} />
                      {strings.backToVariables}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setThemeVariables({ ...DEFAULT_THEME_VARIABLES })
                    }
                  >
                    <RotateCcw size={15} />
                    {strings.reset}
                  </button>
                )}
              </div>

              {showCssEditor ? (
                <div className="easymde-immersive-custom-css-code-panel">
                  <div
                    role="tablist"
                    aria-label={strings.saveTarget}
                    className="easymde-immersive-custom-css-targets"
                  >
                    {CSS_TARGETS.map((target) => (
                      <button
                        key={target}
                        id={`${cssTargetTabId}-${target}`}
                        type="button"
                        role="tab"
                        aria-selected={target === cssTarget}
                        aria-controls={`${cssTargetPanelId}-${target}`}
                        tabIndex={target === cssTarget ? 0 : -1}
                        onClick={() => setCssTarget(target)}
                        onKeyDown={(event) =>
                          handleTabKeyDown(
                            event,
                            CSS_TARGETS,
                            target,
                            setCssTarget
                          )
                        }
                      >
                        {'article' === target
                          ? strings.articleCss
                          : strings.codeCss}
                      </button>
                    ))}
                  </div>
                  <div
                    key={cssTarget}
                    id={`${cssTargetPanelId}-${cssTarget}`}
                    role="tabpanel"
                    aria-labelledby={`${cssTargetTabId}-${cssTarget}`}
                    className="easymde-immersive-custom-css-code-content"
                  >
                    <p>
                      <Info size={15} />
                      {'article' === cssTarget
                        ? strings.articleCssHelp
                        : strings.codeCssHelp}
                    </p>
                    <CodeEditor
                      label={strings.customCssCodeTitle}
                      value={
                        'article' === cssTarget
                          ? articleCustomCss
                          : codeCustomCss
                      }
                      onChange={
                        'article' === cssTarget
                          ? setArticleCustomCss
                          : setCodeCustomCss
                      }
                      placeholder={placeholder}
                    />
                  </div>
                </div>
              ) : (
                <div className="easymde-immersive-custom-css-variable-panel">
                  <div
                    role="tablist"
                    aria-label={strings.themeVariableCategories}
                    className="easymde-immersive-custom-css-categories"
                  >
                    {CATEGORY_ORDER.map((category) => (
                      <button
                        key={category}
                        id={`${categoryTabId}-${category}`}
                        type="button"
                        role="tab"
                        aria-selected={category === activeCategory}
                        aria-controls={`${categoryPanelId}-${category}`}
                        tabIndex={category === activeCategory ? 0 : -1}
                        onClick={() => setActiveCategory(category)}
                        onKeyDown={(event) =>
                          handleTabKeyDown(
                            event,
                            CATEGORY_ORDER,
                            category,
                            setActiveCategory
                          )
                        }
                      >
                        {categoryLabels[category]}
                      </button>
                    ))}
                  </div>
                  <div
                    key={activeCategory}
                    id={`${categoryPanelId}-${activeCategory}`}
                    role="tabpanel"
                    aria-label={strings.themeVariablePanelLabel.replace(
                      '%s',
                      categoryLabels[activeCategory]
                    )}
                    aria-labelledby={`${categoryTabId}-${activeCategory}`}
                    className="easymde-immersive-custom-css-variable-list"
                  >
                    {variables
                      .filter(
                        (variable) =>
                          variable.category === activeCategory &&
                          isThemeVariableKey(variable.id)
                      )
                      .map((variable) => {
                        if (!isThemeVariableKey(variable.id)) return null;
                        const value = themeVariables[variable.id];
                        const valid = isHexColor(value);
                        return (
                          <div key={variable.id}>
                            <div>
                              <label>
                                <span
                                  aria-hidden="true"
                                  style={valid ? { background: value } : undefined}
                                />
                                <input
                                  type="color"
                                  aria-label={strings.colorPickerLabel.replace(
                                    '%s',
                                    variable.label
                                  )}
                                  value={valid ? value : '#000000'}
                                  onChange={(event) => {
                                    const nextValue =
                                      event.currentTarget.value.toUpperCase();
                                    setThemeVariables((current) => ({
                                      ...current,
                                      [variable.id]: nextValue
                                    }));
                                  }}
                                />
                              </label>
                              <span className="easymde-immersive-custom-css-variable-label">
                                {variable.label}
                              </span>
                            </div>
                            <span>{variable.description}</span>
                            <input
                              aria-label={variable.label}
                              aria-invalid={!valid}
                              value={value}
                              maxLength={7}
                              onChange={(event) => {
                                const nextValue =
                                  event.currentTarget.value.toUpperCase();
                                setThemeVariables((current) => ({
                                  ...current,
                                  [variable.id]: nextValue
                                }));
                              }}
                            />
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="easymde-immersive-custom-css-code-toggle"
                onClick={() => {
                  if (showCssEditor) {
                    setCssEditorExpanded(false);
                    setShowCssEditor(false);
                  } else {
                    setShowCssEditor(true);
                  }
                }}
              >
                <span className="easymde-immersive-custom-css-code-toggle-label">
                  <Code2 size={18} strokeWidth={2} />
                  {showCssEditor
                    ? strings.backToThemeVariables
                    : strings.customCssCode}
                </span>
                <span className="easymde-immersive-custom-css-code-toggle-help">
                  {showCssEditor
                    ? strings.backToThemeVariables
                    : strings.customCssCodeHelp}
                </span>
              </button>
            </section>
          </div>
        </div>

        <footer>
          <span role="status" aria-live="polite">{saveError}</span>
          <button type="button" disabled={isSaving} onClick={closeDialog}>
            {strings.cancel}
          </button>
          <button type="button" onClick={resetAll}>
            {strings.resetAll}
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={hasFormError || isSaving}
            onClick={applyCustomTheme}
          >
            {strings.applyCustomTheme}
          </button>
        </footer>
      </section>
    </div>
  );
}
