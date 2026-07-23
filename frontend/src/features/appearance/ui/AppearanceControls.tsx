import {
  Fragment,
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type {
  AppearanceBootstrap,
  AppearanceSnapshot,
  AppearanceState,
  CustomCssItem
} from '../../../contracts/bootstrap/appearance-bootstrap';
import type { AppearancePort } from '../../../contracts/ports/appearance-port';
import {
  Check,
  ChevronDown,
  Palette,
  PenLine
} from '../../../generated/lucide-icons';

export type AppearanceControlsSession = Readonly<{
  close: () => void;
  replaceSnapshot: (snapshot: AppearanceSnapshot) => boolean;
}>;

type AppearanceControlsProps = Readonly<{
  bootstrap: AppearanceBootstrap;
  port: AppearancePort;
  onFailure: () => void;
  onReady: (session: AppearanceControlsSession) => void;
  immersiveLabel?: string;
  immersiveTitle?: string;
  variant?: 'default' | 'immersive';
}>;

type ImmersiveThemeOption = Readonly<{
  id: string;
  label: string;
  swatch: string | readonly [string, string];
}>;

type ImmersivePanelPosition = Readonly<{
  left: number;
  top: number;
  width: number;
}>;

const ARTICLE_THEME_ACCENTS: Readonly<Record<string, string>> = {
  default: '#333333',
  'orange-heart': '#FF6200',
  'chazi-purple': '#8E44AD',
  'nenqing-green': '#00B4A6',
  'green-vitality': '#27AE60',
  'red-crimson': '#E74C3C',
  'blue-ying': '#1E90FF',
  lanqing: '#4A90E2',
  yamabuki: '#D4AC0D',
  'grid-black': '#6C63FF',
  'geek-black': '#00E676',
  'rose-purple': '#E91E8C',
  'ningye-purple': '#B39DDB',
  'tech-blue': '#29B6F6',
  'qingbi-liujin': '#009688',
  'qinghe-zhusha': '#C0392B',
  'cute-green': '#4CAF50',
  'fullstack-blue': '#1565C0',
  'minimal-black': '#212121',
  'orange-blue': '#FF6B35',
  'frontend-peak': '#4A90D9',
  'cupid-busy': '#FF4081'
};

const CODE_THEME_SWATCHES: Readonly<Record<string, readonly [string, string]>> = {
  github: ['#F6F8FA', '#24292E'],
  'github-dark': ['#0D1117', '#C9D1D9'],
  'atom-one-dark': ['#282C34', '#ABB2BF'],
  'atom-one-light': ['#FAFAFA', '#383A42'],
  monokai: ['#272822', '#F8F8F2'],
  vs2015: ['#1E1E1E', '#DCDCDC'],
  xcode: ['#FFFFFF', '#1D1D1F'],
  'wechat-inspired': ['#F4F4F4', '#333333']
};

function articleThemeAccent(id: string): string {
  return ARTICLE_THEME_ACCENTS[id] ?? '#DC2626';
}

function ThemeSettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
    >
      <path
        d="M11.45 14.15C9.35 11.75 6.8 10.65 4.45 10.55C4.55 15.35 6.85 18.65 10.55 19.45C12.15 17.95 12.55 16.15 11.45 14.15Z"
        stroke="#2CCB72"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.15 13.45C12.05 9.05 14.8 5.75 19.8 4.75C20 9.55 17.2 13.1 12.15 13.45Z"
        stroke="#2CCB72"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImmersiveThemeSwatch({
  swatch
}: Readonly<{ swatch: ImmersiveThemeOption['swatch'] }>) {
  return Array.isArray(swatch) ? (
    <span className="easymde-immersive-theme-swatch is-split" aria-hidden="true">
      <span style={{ background: swatch[0] }} />
      <span style={{ background: swatch[1] }} />
    </span>
  ) : (
    <span
      className="easymde-immersive-theme-swatch"
      aria-hidden="true"
      style={{ background: swatch as string }}
    />
  );
}

function ImmersiveThemeSelect({
  label,
  onChange,
  options,
  value
}: Readonly<{
  label: string;
  onChange: (id: string) => void;
  options: ReadonlyArray<ImmersiveThemeOption>;
  value: string;
}>) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(value);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.id === value);
  useEffect(() => {
    if (open) setActiveId(value);
  }, [open, value]);
  useEffect(() => {
    if (open) optionRefs.current[activeId]?.focus();
  }, [activeId, open]);
  const moveActive = (delta: number) => {
    const index = Math.max(0, options.findIndex((option) => option.id === activeId));
    const next = Math.min(options.length - 1, Math.max(0, index + delta));
    setActiveId(options[next]?.id ?? value);
  };

  return (
    <div className="easymde-immersive-theme-field">
      <span className="easymde-immersive-theme-field-label">{label}</span>
      <div className="easymde-immersive-theme-select">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if ('ArrowDown' === event.key || 'Enter' === event.key || ' ' === event.key) {
              event.preventDefault();
              setOpen(true);
            } else if ('ArrowUp' === event.key) {
              event.preventDefault();
              setOpen(true);
              moveActive(-1);
            }
          }}
        >
          <span>
            {selected ? <ImmersiveThemeSwatch swatch={selected.swatch} /> : null}
            <span>{selected?.label ?? ''}</span>
          </span>
          <ChevronDown size={13} strokeWidth={2.3} aria-hidden="true" />
        </button>
        {open ? (
          <div className="easymde-immersive-theme-options" role="listbox" aria-label={label}>
            {options.map((option) => {
              const active = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  id={`easymde-theme-option-${option.id}`}
                  ref={(element) => { optionRefs.current[option.id] = element; }}
                  tabIndex={activeId === option.id ? 0 : -1}
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  onKeyDown={(event) => {
                    if ('ArrowDown' === event.key) {
                      event.preventDefault();
                      moveActive(1);
                    } else if ('ArrowUp' === event.key) {
                      event.preventDefault();
                      moveActive(-1);
                    } else if ('Home' === event.key) {
                      event.preventDefault();
                      setActiveId(options[0]?.id ?? value);
                    } else if ('End' === event.key) {
                      event.preventDefault();
                      setActiveId(options[options.length - 1]?.id ?? value);
                    } else if ('Escape' === event.key) {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                      triggerRef.current?.focus();
                    } else if ('Enter' === event.key || ' ' === event.key) {
                      event.preventDefault();
                      onChange(option.id);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }
                  }}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <span className="easymde-immersive-theme-option-check">
                    {active ? <Check size={9} aria-hidden="true" /> : null}
                  </span>
                  <ImmersiveThemeSwatch swatch={option.swatch} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function selectedCustomCss(
  snapshot: AppearanceSnapshot
): CustomCssItem | undefined {
  if ('custom' !== snapshot.state.markdownTheme) {
    return undefined;
  }

  return snapshot.customCss.find(({ id }) => id === snapshot.state.customCssId);
}

function selectedArticleValue(snapshot: AppearanceSnapshot): string {
  const item = selectedCustomCss(snapshot);
  if (item) {
    return `custom:${item.id}`;
  }
  return 'custom' === snapshot.state.markdownTheme
    ? 'theme:default'
    : `theme:${snapshot.state.markdownTheme}`;
}

export function AppearanceControls({
  bootstrap,
  port,
  onFailure,
  onReady,
  immersiveLabel,
  immersiveTitle,
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
  const [snapshot, setSnapshot] = useState<AppearanceSnapshot>({
    customCss: bootstrap.customCss,
    state: bootstrap.state
  });
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] =
    useState<ImmersivePanelPosition | null>(null);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
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

  const replaceSnapshot = (nextSnapshot: AppearanceSnapshot): boolean => {
    if (!activeRef.current) {
      return false;
    }
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    if (isCustomOpen) {
      const item = selectedCustomCss(nextSnapshot);
      setCustomName(item?.name ?? '');
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
      }
    },
    replaceSnapshot: (nextSnapshot) => replaceSnapshotRef.current(nextSnapshot)
  });

  useLayoutEffect(() => {
    activeRef.current = true;
    onReady(sessionRef.current);

    return () => {
      activeRef.current = false;
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

  const applyState = (nextState: AppearanceState) => {
    try {
      port.applyState(nextState);
    } catch {
      onFailure();
      return;
    }

    const nextSnapshot = { ...snapshotRef.current, state: nextState };
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    setStatus('');
  };

  const openCustomPanel = () => {
    const nextOpen = !isCustomOpen;
    setIsCustomOpen(nextOpen);
    setStatus('');
    if (nextOpen) {
      const item = selectedCustomCss(snapshotRef.current);
      setCustomName(item?.name ?? '');
      setCustomCode(item?.css ?? '');
    }
  };

  const saveCustomCss = async () => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setStatus('');

    try {
      const result = await port.saveCustomCss({
        id:
          'custom' === snapshotRef.current.state.markdownTheme
            ? snapshotRef.current.state.customCssId
            : '',
        name: customName,
        css: customCode
      });
      if (!activeRef.current) {
        return;
      }
      if ('saved' === result.status) {
        replaceSnapshot(result.snapshot);
        setStatus(bootstrap.strings.cssSaved);
      } else {
        setStatus(bootstrap.strings.cssSaveFailed);
      }
    } catch {
      if (activeRef.current) {
        setStatus(bootstrap.strings.cssSaveFailed);
        onFailure();
      }
    } finally {
      savingRef.current = false;
      if (activeRef.current) {
        setIsSaving(false);
      }
    }
  };
  const articleOptions: ReadonlyArray<ImmersiveThemeOption> = [
    ...bootstrap.articleThemes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      swatch: articleThemeAccent(theme.id)
    })),
    ...snapshot.customCss.map((item) => ({
      id: `custom:${item.id}`,
      label: item.name,
      swatch: '#DC2626'
    }))
  ];
  const codeOptions: ReadonlyArray<ImmersiveThemeOption> = bootstrap.codeThemes.map(
    (theme) => ({
      id: theme.id,
      label: theme.label,
      swatch: CODE_THEME_SWATCHES[theme.id] ?? ['#F4F4F4', '#333333']
    })
  );

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
              data-theme={snapshot.state.markdownTheme}
              aria-hidden="true"
            />
          </Fragment>
        ) : (
          <Fragment>
            <span
              className="dashicons dashicons-admin-customizer"
              aria-hidden="true"
            />
            <span
              className="dashicons dashicons-arrow-down-alt2"
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
                value={selectedArticleValue(snapshot)}
                options={articleOptions}
                onChange={(value) => {
                  if (value.startsWith('custom:')) {
                    applyState({
                      ...snapshotRef.current.state,
                      markdownTheme: 'custom',
                      customCssId: value.slice(7)
                    });
                  } else {
                    applyState({
                      ...snapshotRef.current.state,
                      markdownTheme: value.slice(6),
                      customCssId: ''
                    });
                  }
                }}
              />
              <ImmersiveThemeSelect
                label={bootstrap.strings.codeTheme}
                value={snapshot.state.codeTheme}
                options={codeOptions}
                onChange={(codeTheme) =>
                  applyState({ ...snapshotRef.current.state, codeTheme })
                }
              />
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
            </div>
          </Fragment>
        ) : (
          <Fragment>
        <label className="easymde-toolbar-control">
          <span className="easymde-toolbar-control-label">
            {bootstrap.strings.articleTheme}
          </span>
          <select
            className="easymde-theme-select"
            value={selectedArticleValue(snapshot)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value.startsWith('custom:')) {
                applyState({
                  ...snapshotRef.current.state,
                  markdownTheme: 'custom',
                  customCssId: value.slice(7)
                });
              } else {
                applyState({
                  ...snapshotRef.current.state,
                  markdownTheme: value.slice(6),
                  customCssId: ''
                });
              }
            }}
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
                    {item.name}
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
            value={snapshot.state.codeTheme}
            onChange={(event) =>
              applyState({
                ...snapshotRef.current.state,
                codeTheme: event.currentTarget.value
              })
            }
          >
            {bootstrap.codeThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </select>
        </label>
        <div className="easymde-custom-css-toggle-row">
          <button
            type="button"
            className="button button-secondary easymde-custom-css-toggle"
            aria-expanded={isCustomOpen}
            onClick={openCustomPanel}
          >
            {bootstrap.strings.customCss}
          </button>
        </div>
          </Fragment>
        )}
        <div className="easymde-custom-css-panel" hidden={!isCustomOpen}>
          <div className="easymde-custom-css-row">
            <input
              type="text"
              className="regular-text easymde-custom-css-name"
              aria-label={bootstrap.strings.cssName}
              placeholder={bootstrap.strings.cssName}
              value={customName}
              onChange={(event) => setCustomName(event.currentTarget.value)}
            />
            <button
              type="button"
              className="button button-primary"
              disabled={isSaving}
              onClick={saveCustomCss}
            >
              {bootstrap.strings.saveCss}
            </button>
            <span className="easymde-custom-css-status" aria-live="polite">
              {status}
            </span>
          </div>
          <textarea
            className="easymde-custom-css-code"
            aria-label={bootstrap.strings.customCss}
            spellCheck={false}
            value={customCode}
            onChange={(event) => setCustomCode(event.currentTarget.value)}
          />
        </div>
      </div>
    </div>
  );
}
