import {
  createElement,
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type {
  AppearanceBootstrap,
  AppearanceSnapshot,
  AppearanceState
} from '../../../contracts/bootstrap/appearance-bootstrap';
import type { AppearancePort } from '../../../contracts/ports/appearance-port';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import {
  ChevronDown,
  Palette,
  PenLine
} from '../../../generated/lucide-icons';
import type { EditorMessageAlertType } from '../../../shared/ui/EditorMessageAlert';
import { OrdinarySelect } from '../../../shared/ui/OrdinarySelect';
import {
  associatedCodeTheme,
  buildArticleThemeOptions,
  buildCodeThemeOptions,
  customCssCodeTheme,
  ImmersiveThemeSelect,
  resolveActiveArticleSwatch,
  selectedArticleValue,
  selectedCodeThemeValue,
  selectedCustomCss,
  ThemeSettingsIcon
} from './ImmersiveThemeSelect';
import { LazyImmersiveCustomCssDialog } from './LazyImmersiveCustomCssDialog';

type MessageAlertTimer = Pick<
  ImmersiveEnvironmentPort,
  'now' | 'schedule'
>;

export type AppearanceControlsSession = Readonly<{
  close: () => void;
  replaceSnapshot: (
    snapshot: AppearanceSnapshot,
    codeThemeExplicit: boolean
  ) => boolean;
}>;

export type AppearanceNotification = Readonly<{
  id: 'appearance-custom-css';
  message: string;
  type: EditorMessageAlertType;
}>;

type AppearanceControlsCommonProps = Readonly<{
  bootstrap: AppearanceBootstrap;
  port: AppearancePort;
  onFailure: () => void;
  onNotification?: (notification: AppearanceNotification) => void;
  onNotificationDismiss?: (id: AppearanceNotification['id']) => void;
  onReady: (session: AppearanceControlsSession) => void;
  immersiveLabel?: string;
  immersiveTitle?: string;
}>;
type AppearanceControlsProps = AppearanceControlsCommonProps & Readonly<
  | {
    messageAlertTimer: MessageAlertTimer;
    variant: 'immersive';
  }
  | {
    messageAlertTimer?: MessageAlertTimer;
    variant?: 'default' | 'embedded';
  }
>;

type ImmersivePanelPosition = Readonly<{
  left: number;
  top: number;
  width: number;
}>;

function requireMessageAlertTimer(
  timer: MessageAlertTimer | undefined
): MessageAlertTimer {
  if (!timer) throw new Error('custom-css-message-alert-timer-unavailable');
  return timer;
}

export function AppearanceControls({
  bootstrap,
  port,
  onFailure,
  onNotification,
  onNotificationDismiss,
  onReady,
  immersiveLabel,
  immersiveTitle,
  messageAlertTimer,
  variant = 'default'
}: AppearanceControlsProps) {
  const controlLabel =
    'immersive' === variant
      ? (immersiveLabel ?? bootstrap.strings.appearance)
      : bootstrap.strings.appearance;
  const panelLabel =
    'immersive' === variant
      ? (immersiveTitle ?? controlLabel)
      : bootstrap.strings.appearance;
  const codeThemeExplicitRef = useRef(bootstrap.codeThemeExplicit);
  const desiredCodeThemeExplicitRef = useRef(bootstrap.codeThemeExplicit);
  const [snapshot, setSnapshot] = useState<AppearanceSnapshot>({
    customCss: bootstrap.customCss,
    state: bootstrap.state
  });
  const [desiredState, setDesiredState] = useState(bootstrap.state);
  const [desiredCodeThemeExplicit, setDesiredCodeThemeExplicit] = useState(
    bootstrap.codeThemeExplicit
  );
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] =
    useState<ImmersivePanelPosition | null>(null);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customArticleThemeName, setCustomArticleThemeName] = useState('');
  const [customCodeThemeName, setCustomCodeThemeName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const desiredStateRef = useRef(snapshot.state);
  const applyRequestRef = useRef(0);
  const applyPendingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateImmersivePanelPosition = () => {
    if ('immersive' !== variant) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const windowRef = trigger?.ownerDocument.defaultView;
    if (!trigger || !panel || !windowRef) return;
    const viewportPadding = 12;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(248, windowRef.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width - 12),
      windowRef.innerWidth - width - viewportPadding
    );
    const below = rect.bottom + 8;
    const top =
      below + panel.offsetHeight > windowRef.innerHeight - viewportPadding
        ? Math.max(viewportPadding, rect.top - panel.offsetHeight - 8)
        : below;
    setPanelPosition({ left, top, width });
  };

  const replaceSnapshot = (
    nextSnapshot: AppearanceSnapshot,
    nextCodeThemeExplicit = codeThemeExplicitRef.current
  ): boolean => {
    if (!activeRef.current) {
      return false;
    }
    snapshotRef.current = nextSnapshot;
    desiredStateRef.current = nextSnapshot.state;
    codeThemeExplicitRef.current = nextCodeThemeExplicit;
    desiredCodeThemeExplicitRef.current = nextCodeThemeExplicit;
    setSnapshot(nextSnapshot);
    setDesiredState(nextSnapshot.state);
    setDesiredCodeThemeExplicit(nextCodeThemeExplicit);
    if (isCustomOpen) {
      const item = selectedCustomCss(nextSnapshot);
      setCustomArticleThemeName(item?.articleThemeName ?? '');
      setCustomCodeThemeName(item?.codeThemeName ?? '');
      setCustomCode(item?.css ?? '');
    }
    return true;
  };
  const replaceSnapshotRef = useRef(replaceSnapshot);
  replaceSnapshotRef.current = replaceSnapshot;
  const sessionRef = useRef<AppearanceControlsSession>({
    close: () => {
      if (activeRef.current) {
        setIsOpen(false);
        setIsCustomOpen(false);
      }
    },
    replaceSnapshot: (nextSnapshot, nextCodeThemeExplicit) =>
      replaceSnapshotRef.current(nextSnapshot, nextCodeThemeExplicit)
  });

  useLayoutEffect(() => {
    activeRef.current = true;
    onReady(sessionRef.current);

    return () => {
      activeRef.current = false;
      applyRequestRef.current += 1;
      applyPendingRef.current = false;
    };
  }, [onReady]);

  useLayoutEffect(() => {
    if (isOpen) updateImmersivePanelPosition();
  }, [isOpen, variant]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeForPointer = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (panelRef.current?.contains(target) ||
          triggerRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if ('Escape' !== event.key) {
        return;
      }
      if (panelRef.current?.querySelector('[role="listbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    const windowRef = triggerRef.current?.ownerDocument.defaultView;
    const reposition = () => updateImmersivePanelPosition();
    document.addEventListener('click', closeForPointer);
    windowRef?.addEventListener('resize', reposition);
    windowRef?.addEventListener('scroll', reposition, true);
    windowRef?.addEventListener('keydown', closeForEscape, true);
    return () => {
      document.removeEventListener('click', closeForPointer);
      windowRef?.removeEventListener('resize', reposition);
      windowRef?.removeEventListener('scroll', reposition, true);
      windowRef?.removeEventListener('keydown', closeForEscape, true);
    };
  }, [isOpen]);

  const applyState = async (
    nextState: AppearanceState,
    nextCodeThemeExplicit = desiredCodeThemeExplicitRef.current
  ): Promise<boolean> => {
    const request = applyRequestRef.current + 1;
    applyRequestRef.current = request;
    desiredStateRef.current = nextState;
    desiredCodeThemeExplicitRef.current = nextCodeThemeExplicit;
    setDesiredState(nextState);
    setDesiredCodeThemeExplicit(nextCodeThemeExplicit);
    const currentState = snapshotRef.current.state;
    if (
      !applyPendingRef.current
      && currentState.markdownTheme === nextState.markdownTheme
      && currentState.codeTheme === nextState.codeTheme
      && currentState.customCssId === nextState.customCssId
      && codeThemeExplicitRef.current === nextCodeThemeExplicit
    ) {
      return true;
    }
    applyPendingRef.current = true;
    try {
      if (!await port.applyState(nextState, nextCodeThemeExplicit)) {
        if (request === applyRequestRef.current) {
          applyPendingRef.current = false;
          desiredStateRef.current = snapshotRef.current.state;
          desiredCodeThemeExplicitRef.current = codeThemeExplicitRef.current;
          if (activeRef.current) {
            setDesiredState(snapshotRef.current.state);
            setDesiredCodeThemeExplicit(codeThemeExplicitRef.current);
          }
        }
        return false;
      }
    } catch {
      if (request === applyRequestRef.current) {
        applyPendingRef.current = false;
        desiredStateRef.current = snapshotRef.current.state;
        desiredCodeThemeExplicitRef.current = codeThemeExplicitRef.current;
        if (activeRef.current) {
          setDesiredState(snapshotRef.current.state);
          setDesiredCodeThemeExplicit(codeThemeExplicitRef.current);
          onFailure();
        }
      }
      return false;
    }

    if (!activeRef.current || request !== applyRequestRef.current) return false;

    applyPendingRef.current = false;
    codeThemeExplicitRef.current = nextCodeThemeExplicit;
    const nextSnapshot = { ...snapshotRef.current, state: nextState };
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    return true;
  };

  const openCustomPanel = () => {
    const nextOpen = !isCustomOpen;
    setIsCustomOpen(nextOpen);
    if ('immersive' === variant && nextOpen) {
      setIsOpen(false);
    }
    onNotificationDismiss?.('appearance-custom-css');
    if (nextOpen) {
      setCustomArticleThemeName('');
      setCustomCodeThemeName('');
      setCustomCode('');
    }
  };

  const saveCustomCss = async (
    input: Readonly<{
      articleThemeName: string;
      codeThemeName: string;
      css: string;
    }> = {
      articleThemeName: customArticleThemeName,
      codeThemeName: customCodeThemeName,
      css: customCode
    },
    requestedId?: string
  ): Promise<
    Readonly<{ status: 'saved' }> |
    Readonly<{
      status: 'failed';
      code: 'duplicate-name' | 'save-failed';
      message: string;
    }>
  > => {
    if (savingRef.current) {
      return {
        code: 'save-failed',
        status: 'failed',
        message: bootstrap.strings.cssSaveFailed
      };
    }
    savingRef.current = true;

    try {
      const result = await port.saveCustomCss({
        id: undefined !== requestedId
          ? requestedId
          : 'custom' === snapshotRef.current.state.markdownTheme
            ? snapshotRef.current.state.customCssId
            : '',
        articleThemeName: input.articleThemeName,
        codeThemeName: input.codeThemeName,
        css: input.css
      });
      if (!activeRef.current) {
        return 'saved' === result.status
          ? { status: 'saved' }
          : {
              code: 'duplicate-name' === result.code
                ? 'duplicate-name'
                : 'save-failed',
              status: 'failed',
              message: 'duplicate-name' === result.code
                ? bootstrap.strings.cssNameDuplicate
                : bootstrap.strings.cssSaveFailed
            };
      }
      if ('saved' === result.status) {
        const nextSnapshot = {
          ...result.snapshot,
          state: {
            ...result.snapshot.state,
            codeTheme: customCssCodeTheme(
              bootstrap,
              result.snapshot.state.codeTheme,
              codeThemeExplicitRef.current
            )
          }
        };
        const savedLibrarySnapshot = {
          customCss: nextSnapshot.customCss,
          state: snapshotRef.current.state
        };
        replaceSnapshot(savedLibrarySnapshot);
        if (!await applyState(nextSnapshot.state)) {
          if (onNotification) {
            onNotification({
              id: 'appearance-custom-css',
              message: bootstrap.strings.themeApplyFailed,
              type: 'error'
            });
          }
          return { status: 'saved' };
        }
        replaceSnapshot(nextSnapshot);
        if (onNotification) {
          onNotification({
            id: 'appearance-custom-css',
            message: bootstrap.strings.cssSaved,
            type: 'success'
          });
        }
        return { status: 'saved' };
      } else {
        const isDuplicate = 'duplicate-name' === result.code;
        const message = isDuplicate
          ? bootstrap.strings.cssNameDuplicate
          : bootstrap.strings.cssSaveFailed;
        if (onNotification && 'immersive' !== variant) {
          onNotification({
            id: 'appearance-custom-css',
            message,
            type: 'error'
          });
        }
        return {
          code: isDuplicate ? 'duplicate-name' : 'save-failed',
          status: 'failed',
          message
        };
      }
    } catch {
      if (activeRef.current) {
        if (onNotification && 'immersive' !== variant) {
          onNotification({
            id: 'appearance-custom-css',
            message: bootstrap.strings.cssSaveFailed,
            type: 'error'
          });
        }
        onFailure();
      }
      return {
        code: 'save-failed',
        status: 'failed',
        message: bootstrap.strings.cssSaveFailed
      };
    } finally {
      savingRef.current = false;
    }
  };
  const visibleSnapshot = { ...snapshot, state: desiredState };
  const articleOptions = buildArticleThemeOptions(bootstrap, snapshot.customCss);
  const selectedArticle = selectedArticleValue(visibleSnapshot);
  const activeArticleSwatch = resolveActiveArticleSwatch(
    desiredState.markdownTheme,
    selectedArticle,
    articleOptions
  );
  const codeOptions = buildCodeThemeOptions(bootstrap, snapshot.customCss);
  const selectArticleTheme = (value: string) => {
    if (value.startsWith('custom:')) {
      void applyState({
        ...desiredStateRef.current,
        markdownTheme: 'custom',
        codeTheme: customCssCodeTheme(
          bootstrap,
          desiredStateRef.current.codeTheme,
          desiredCodeThemeExplicitRef.current
        ),
        customCssId: value.slice(7)
      });
    } else {
      const markdownTheme = value.slice(6);
      void applyState({
        ...desiredStateRef.current,
        markdownTheme,
        codeTheme: desiredCodeThemeExplicitRef.current
          ? desiredStateRef.current.codeTheme
          : associatedCodeTheme(bootstrap, markdownTheme),
        customCssId: ''
      });
    }
  };
  const selectCodeTheme = (value: string) => {
    if (value.startsWith('custom:')) {
      // One customCssId owns the paired article and code CSS preset.
      void applyState(
        {
          ...desiredStateRef.current,
          markdownTheme: 'custom',
          codeTheme: associatedCodeTheme(bootstrap, 'default'),
          customCssId: value.slice(7)
        },
        false
      );
      return;
    }
    void applyState(
      {
        ...desiredStateRef.current,
        codeTheme: value.slice(6)
      },
      true
    );
  };
  const selectedCodeValue = selectedCodeThemeValue(
    visibleSnapshot,
    desiredCodeThemeExplicit
  );
  const ordinaryFields = (
    <Fragment>
      <label className="easymde-toolbar-control">
        <span className="easymde-toolbar-control-label">
          {bootstrap.strings.articleTheme}
        </span>
        <select
          className="easymde-theme-select"
          value={selectedArticle}
          onChange={(event) => selectArticleTheme(event.currentTarget.value)}
        >
          {bootstrap.articleThemes.map((theme) => (
            <option key={theme.id} value={`theme:${theme.id}`}>
              {theme.label}
            </option>
          ))}
          {snapshot.customCss.length > 0 ? (
            <optgroup label={bootstrap.strings.namedCustomCss}>
              {snapshot.customCss.map((item) => (
                <option key={item.id} value={`custom:${item.id}`}>
                  {item.articleThemeName}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <label className="easymde-toolbar-control">
        <span className="easymde-toolbar-control-label">
          {bootstrap.strings.codeTheme}
        </span>
        <select
          className="easymde-code-theme-select"
          value={selectedCodeValue}
          onChange={(event) => selectCodeTheme(event.currentTarget.value)}
        >
          {bootstrap.codeThemes.map((theme) => (
            <option key={theme.id} value={`theme:${theme.id}`}>
              {theme.label}
            </option>
          ))}
          {snapshot.customCss.map((item) => (
            <option key={item.id} value={`custom:${item.id}`}>
              {item.codeThemeName}
            </option>
          ))}
        </select>
      </label>
    </Fragment>
  );

  if ('embedded' === variant) {
    return (
      <section className="easymde-editor-settings-section is-appearance">
        <h3>{bootstrap.strings.appearance}</h3>
        <div className="easymde-editor-settings-fields">
          <div className="easymde-toolbar-control">
            <span className="easymde-toolbar-control-label">
              {bootstrap.strings.articleTheme}
            </span>
            <OrdinarySelect
              className="easymde-theme-select"
              label={bootstrap.strings.articleTheme}
              value={selectedArticle}
              options={articleOptions}
              onChange={selectArticleTheme}
            />
          </div>
          <div className="easymde-toolbar-control">
            <span className="easymde-toolbar-control-label">
              {bootstrap.strings.codeTheme}
            </span>
            <OrdinarySelect
              className="easymde-code-theme-select"
              label={bootstrap.strings.codeTheme}
              value={selectedCodeValue}
              options={codeOptions}
              onChange={selectCodeTheme}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div
      className={`easymde-toolbar-popover-anchor easymde-toolbar-popover-appearance${'immersive' === variant ? ' is-immersive' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact${isOpen ? ' is-active' : ''}`}
        title={controlLabel}
        aria-label={controlLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isOpen) {
            setIsOpen(false);
            triggerRef.current?.focus();
            return;
          }
          port.closeOtherPopovers();
          setIsOpen(true);
          triggerRef.current?.focus();
        }}
      >
        {'immersive' === variant ? (
          <Fragment>
            <Palette size={13} strokeWidth={2} aria-hidden="true" />
            <span className="easymde-immersive-control-label">
              {controlLabel}
            </span>
            <span
              className="easymde-immersive-theme-accent"
              data-theme={desiredState.markdownTheme}
              style={{ background: activeArticleSwatch }}
              aria-hidden="true"
            />
          </Fragment>
        ) : (
          <Fragment>
            <Palette
              className="easymde-toolbar-icon easymde-toolbar-icon-appearance"
              size={18}
              strokeWidth={2.1}
              aria-hidden="true"
            />
            <ChevronDown
              className="easymde-toolbar-chevron"
              size={12}
              strokeWidth={2.25}
              aria-hidden="true"
            />
          </Fragment>
        )}
      </button>
      <div
        ref={panelRef}
        className={`easymde-toolbar-popover easymde-toolbar-popover-appearance-panel${'immersive' === variant ? ' is-immersive-panel' : ''}`}
        style={
          'immersive' === variant
            ? {
                left: panelPosition?.left ?? -9999,
                top: panelPosition?.top ?? -9999,
                visibility: panelPosition ? 'visible' : 'hidden',
                width: panelPosition?.width ?? 248
              }
            : undefined
        }
        role="dialog"
        aria-label={panelLabel}
        hidden={!isOpen}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ('Escape' === event.key) {
            return;
          }
          event.stopPropagation();
          if ('immersive' !== variant || 'Tab' !== event.key) {
            return;
          }
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
            )
          ).filter((element) => !element.closest('[hidden]'));
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) {
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {'immersive' === variant ? (
          <Fragment>
            <div className="easymde-immersive-theme-panel-header">
              <span>
                <ThemeSettingsIcon />
                <strong>{immersiveTitle ?? bootstrap.strings.appearance}</strong>
              </span>
            </div>
            <div className="easymde-immersive-theme-panel-body">
              <ImmersiveThemeSelect
                label={bootstrap.strings.articleTheme}
                value={selectedArticle}
                options={articleOptions}
                onChange={selectArticleTheme}
              />
              <ImmersiveThemeSelect
                label={bootstrap.strings.codeTheme}
                value={selectedCodeValue}
                options={codeOptions}
                onChange={selectCodeTheme}
              />
              {bootstrap.canManageCustomCss ? (
                <div className="easymde-immersive-custom-css-action">
                  <button
                    type="button"
                    className="easymde-immersive-custom-css-trigger"
                    aria-expanded={isCustomOpen}
                    onClick={openCustomPanel}
                  >
                    <PenLine size={17} strokeWidth={2.1} aria-hidden="true" />
                    {bootstrap.strings.customCssTheme}
                  </button>
                </div>
              ) : null}
            </div>
          </Fragment>
        ) : (
          ordinaryFields
        )}
      </div>
      {'immersive' === variant &&
      bootstrap.canManageCustomCss &&
      isCustomOpen ? (
        <LazyImmersiveCustomCssDialog
          initialCss={customCode}
          initialArticleThemeName={customArticleThemeName}
          initialCodeThemeName={customCodeThemeName}
          messageAlertTimer={requireMessageAlertTimer(messageAlertTimer)}
          onApply={(input) => saveCustomCss(input, '')}
          onClose={() => {
            setIsCustomOpen(false);
            triggerRef.current?.focus();
          }}
          onLoadFailure={() => {
            if (!activeRef.current) return;
            setIsCustomOpen(false);
            const doc = triggerRef.current?.ownerDocument;
            const active = doc?.activeElement;
            if (
              !active ||
              active === doc?.body ||
              active === doc?.documentElement ||
              panelRef.current?.contains(active)
            ) {
              triggerRef.current?.focus();
            }
            onFailure();
          }}
          onPreview={port.previewCustomCss}
          strings={bootstrap.strings.customCssDialog}
          title={bootstrap.strings.customCssTheme}
          variables={bootstrap.customCssVariables}
        />
      ) : null}
    </div>
  );
}
