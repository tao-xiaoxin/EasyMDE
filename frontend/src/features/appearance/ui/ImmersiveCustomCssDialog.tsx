import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type {
  CustomCssDialogStrings,
  CustomCssVariable
} from '../../../contracts/bootstrap/appearance-bootstrap';
import type { CustomCssPreviewResult } from '../../../contracts/ports/appearance-port';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import {
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Code2,
  Info,
  Maximize,
  Minimize,
  RotateCcw,
  X
} from '../../../generated/lucide-icons';
import {
  EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS,
  EditorMessageAlert
} from '../../../shared/ui/EditorMessageAlert';
import {
  CodeEditor,
  PreviewContent,
  ThemeSparkIcon
} from './ImmersiveCustomCssDialogParts';
import {
  buildImmersiveCustomCss,
  buildPreviewStyle,
  CATEGORY_ORDER,
  CSS_TARGETS,
  type CustomCssSaveError,
  customCssPlaceholder,
  customThemeNameLength,
  DEFAULT_THEME_VARIABLES,
  handleTabKeyDown,
  isHexColor,
  isThemeVariableKey,
  limitCustomThemeName,
  type ThemeVariableCategory,
  type ThemeVariables
} from './immersive-custom-css-helpers';

export { buildImmersiveCustomCss };

type MessageAlertTimer = Pick<
  ImmersiveEnvironmentPort,
  'now' | 'schedule'
>;

type ImmersiveCustomCssDialogProps = Readonly<{
  initialCss: string;
  initialArticleThemeName: string;
  initialCodeThemeName: string;
  messageAlertTimer: MessageAlertTimer;
  onApply: (input: Readonly<{
    articleThemeName: string;
    codeThemeName: string;
    css: string;
  }>) => Promise<
    Readonly<{ status: 'saved' }> |
    Readonly<{
      status: 'failed';
      code: 'duplicate-name' | 'save-failed';
      message: string;
    }>
  >;
  onClose: () => void;
  onPreview: (
    css: string,
    signal: AbortSignal
  ) => Promise<CustomCssPreviewResult>;
  strings: CustomCssDialogStrings;
  title: string;
  variables: ReadonlyArray<CustomCssVariable>;
}>;

export function ImmersiveCustomCssDialog({
  initialCss,
  initialArticleThemeName,
  initialCodeThemeName,
  messageAlertTimer,
  onApply,
  onClose,
  onPreview,
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
  const noticeId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  const restoreApplyFocusRef = useRef(false);
  const saveErrorTimerRef = useRef<{
    deadline: number | null;
    error: CustomCssSaveError | null;
    remaining: number;
  }>({
    deadline: null,
    error: null,
    remaining: EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS
  });
  const [articleName, setArticleName] = useState(
    initialArticleThemeName || strings.defaultArticleName
  );
  const [codeName, setCodeName] = useState(
    initialCodeThemeName || strings.defaultCodeName
  );
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
  const [saveError, setSaveError] = useState<CustomCssSaveError | null>(null);
  const [saveErrorFocused, setSaveErrorFocused] = useState(false);
  const [scopedPreviewCss, setScopedPreviewCss] = useState('');
  const [previewStatus, setPreviewStatus] =
    useState<'ready' | 'invalid' | 'unavailable'>('ready');

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isSaving && restoreApplyFocusRef.current) {
      restoreApplyFocusRef.current = false;
      applyButtonRef.current?.focus();
    }
  }, [isSaving]);

  useEffect(() => {
    const timerState = saveErrorTimerRef.current;
    if (!saveError) {
      timerState.deadline = null;
      timerState.error = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      return undefined;
    }
    if (timerState.error !== saveError) {
      timerState.deadline = null;
      timerState.error = saveError;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
    }
    if (saveErrorFocused) return undefined;

    const scheduledError = saveError;
    const delay = timerState.remaining;
    timerState.deadline = messageAlertTimer.now() + delay;
    const cancel = messageAlertTimer.schedule(() => {
      timerState.deadline = null;
      timerState.remaining = 0;
      setSaveErrorFocused(false);
      setSaveError((currentError) =>
        currentError === scheduledError ? null : currentError
      );
    }, delay);
    return () => {
      cancel();
      if (
        timerState.error === scheduledError &&
        null !== timerState.deadline
      ) {
        timerState.remaining = Math.max(
          0,
          timerState.deadline - messageAlertTimer.now()
        );
        timerState.deadline = null;
      }
    };
  }, [messageAlertTimer, saveError, saveErrorFocused]);

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
          onCloseRef.current();
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
  }, [cssEditorExpanded]);

  const hasInvalidColor = Object.values(themeVariables).some(
    (value) => !isHexColor(value)
  );
  const hasMissingName = !articleName.trim() || !codeName.trim();
  const hasFormError =
    hasInvalidColor || hasMissingName || 'invalid' === previewStatus;
  const categoryLabels: Readonly<Record<ThemeVariableCategory, string>> = {
    foundation: strings.foundationCategory,
    blocks: strings.blocksCategory,
    code: strings.codeCategory,
    alerts: strings.alertsCategory
  };
  const previewStyle = useMemo(
    () => buildPreviewStyle(themeVariables),
    [themeVariables]
  );
  const placeholder = useMemo(
    () => customCssPlaceholder(themeVariables, strings),
    [strings, themeVariables]
  );
  const previewCss = useMemo(
    () => buildImmersiveCustomCss(
      themeVariables,
      articleCustomCss,
      codeCustomCss
    ),
    [articleCustomCss, codeCustomCss, themeVariables]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void onPreview(previewCss, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setPreviewStatus(result.status);
            if ('ready' === result.status) {
              setScopedPreviewCss(result.scopedCss);
            }
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setPreviewStatus('unavailable');
        });
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [onPreview, previewCss]);

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
    setSaveErrorFocused(false);
    setSaveError(null);
  };

  const closeDialog = () => {
    if (!savingRef.current) onClose();
  };

  const applyCustomTheme = async () => {
    if (savingRef.current || hasFormError) return;
    restoreApplyFocusRef.current =
      dialogRef.current?.ownerDocument.activeElement === applyButtonRef.current;
    savingRef.current = true;
    setIsSaving(true);
    setSaveErrorFocused(false);
    setSaveError(null);
    try {
      const result = await onApply({
        articleThemeName: articleName.trim(),
        codeThemeName: codeName.trim(),
        css: buildImmersiveCustomCss(
          themeVariables,
          articleCustomCss,
          codeCustomCss
        )
      });
      if (!activeRef.current) return;
      if ('saved' === result.status) {
        onClose();
      } else {
        setSaveError(result);
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
        <header className={saveError ? 'has-message-alert' : undefined}>
          <div>
            <ThemeSparkIcon />
            <h1 id={titleId}>{title}</h1>
          </div>
          <p>{strings.description}</p>
          {saveError ? (
            <div className="easymde-editor-message-alert-host is-dialog-compact">
              <EditorMessageAlert
                closeLabel={strings.close}
                density="compact"
                message={saveError.message}
                messageId={noticeId}
                onDismiss={() => {
                  setSaveErrorFocused(false);
                  setSaveError(null);
                }}
                onFocusChange={setSaveErrorFocused}
                returnFocusTo={() => applyButtonRef.current}
                type="error"
              />
            </div>
          ) : null}
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
              aria-describedby={
                'duplicate-name' === saveError?.code ? noticeId : undefined
              }
              aria-invalid={
                'duplicate-name' === saveError?.code ? true : undefined
              }
              disabled={isSaving}
              value={articleName}
              placeholder={strings.articleNamePlaceholder}
              onChange={(event) => {
                setArticleName(limitCustomThemeName(event.currentTarget.value));
                setSaveError((current) =>
                  'duplicate-name' === current?.code ? null : current
                );
              }}
            />
            <span>{customThemeNameLength(articleName)}/30</span>
          </div>
          <label htmlFor={codeNameId}>{strings.codeThemeName}</label>
          <div>
            <input
              id={codeNameId}
              aria-describedby={
                'duplicate-name' === saveError?.code ? noticeId : undefined
              }
              aria-invalid={
                'duplicate-name' === saveError?.code ? true : undefined
              }
              disabled={isSaving}
              value={codeName}
              placeholder={strings.codeNamePlaceholder}
              onChange={(event) => {
                setCodeName(limitCustomThemeName(event.currentTarget.value));
                setSaveError((current) =>
                  'duplicate-name' === current?.code ? null : current
                );
              }}
            />
            <span>{customThemeNameLength(codeName)}/30</span>
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
                <style>{scopedPreviewCss}</style>
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
                      disabled={isSaving}
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
                      disabled={isSaving}
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
                      disabled={isSaving}
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
                    disabled={isSaving}
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
                        disabled={isSaving}
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
                      disabled={isSaving}
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
                        disabled={isSaving}
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
                                  disabled={isSaving}
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
                              disabled={isSaving}
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
                disabled={isSaving}
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
          {'invalid' === previewStatus || 'unavailable' === previewStatus ? (
            <div
              className="easymde-immersive-custom-css-notice is-info"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <Info size={18} strokeWidth={2} aria-hidden="true" />
              <span>
                {'invalid' === previewStatus
                  ? strings.previewInvalid
                  : strings.previewUnavailable}
              </span>
            </div>
          ) : null}
          <div className="easymde-immersive-custom-css-actions">
            <button type="button" disabled={isSaving} onClick={closeDialog}>
              {strings.cancel}
            </button>
            <button type="button" disabled={isSaving} onClick={resetAll}>
              {strings.resetAll}
            </button>
            <button
              ref={applyButtonRef}
              type="button"
              className="is-primary"
              disabled={hasFormError || isSaving}
              onClick={applyCustomTheme}
            >
              {strings.applyCustomTheme}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
