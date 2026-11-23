import {
  createElement,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';

import type {
  AppearanceBootstrap,
  AppearanceSnapshot,
  CustomCssItem
} from '../../../contracts/bootstrap/appearance-bootstrap';
import { Check, ChevronDown } from '../../../generated/lucide-icons';
import type { OrdinarySelectSwatch } from '../../../shared/ui/OrdinarySelect';

export type ImmersiveThemeOption = Readonly<{
  id: string;
  label: string;
  swatch: OrdinarySelectSwatch;
}>;

export const CODE_THEME_SWATCHES: Readonly<
  Record<string, readonly [string, string]>
> = {
  github: ['#F6F8FA', '#24292E'],
  'github-dark': ['#0D1117', '#C9D1D9'],
  'atom-one-dark': ['#282C34', '#ABB2BF'],
  'atom-one-light': ['#FAFAFA', '#383A42'],
  monokai: ['#272822', '#F8F8F2'],
  vs2015: ['#1E1E1E', '#DCDCDC'],
  xcode: ['#FFFFFF', '#1D1D1F'],
  'fullstack-blue': ['#282C34', '#ABB2BF'],
  'terminal-noir': ['#0D1017', '#CAD1D9'],
  'wechat-inspired': ['#F4F4F4', '#333333']
};

export const DEFAULT_ARTICLE_THEME_SWATCH = '#333333';
export const CUSTOM_CSS_THEME_SWATCH = '#DC2626';

export function codeThemeSwatch(id: string): readonly [string, string] {
  return CODE_THEME_SWATCHES[id] ?? ['#F4F4F4', '#333333'];
}

export function ThemeSettingsIcon() {
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

export function ImmersiveThemeSwatch({
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

export function ImmersiveThemeSelect({
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

export function selectedCustomCss(
  snapshot: AppearanceSnapshot
): CustomCssItem | undefined {
  if ('custom' !== snapshot.state.markdownTheme) {
    return undefined;
  }

  return snapshot.customCss.find(({ id }) => id === snapshot.state.customCssId);
}

export function selectedArticleValue(snapshot: AppearanceSnapshot): string {
  const item = selectedCustomCss(snapshot);
  if (item) {
    return `custom:${item.id}`;
  }
  return 'custom' === snapshot.state.markdownTheme
    ? 'theme:default'
    : `theme:${snapshot.state.markdownTheme}`;
}

export function associatedCodeTheme(
  bootstrap: AppearanceBootstrap,
  markdownTheme: string
): string {
  const theme = bootstrap.articleThemes.find(({ id }) => id === markdownTheme);
  if (!theme) {
    throw new Error('appearance-associated-code-theme-missing');
  }

  return theme.defaultCodeTheme;
}

export function customCssCodeTheme(
  bootstrap: AppearanceBootstrap,
  currentCodeTheme: string,
  codeThemeExplicit: boolean
): string {
  return codeThemeExplicit
    ? currentCodeTheme
    : associatedCodeTheme(bootstrap, 'default');
}

export function buildArticleThemeOptions(
  bootstrap: AppearanceBootstrap,
  customCss: ReadonlyArray<CustomCssItem>
): ReadonlyArray<ImmersiveThemeOption> {
  return [
    ...bootstrap.articleThemes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      swatch: theme.swatch ?? DEFAULT_ARTICLE_THEME_SWATCH
    })),
    ...customCss.map((item) => ({
      id: `custom:${item.id}`,
      label: item.articleThemeName,
      swatch: CUSTOM_CSS_THEME_SWATCH
    }))
  ];
}

export function buildCodeThemeOptions(
  bootstrap: AppearanceBootstrap,
  customCss: ReadonlyArray<CustomCssItem>
): ReadonlyArray<ImmersiveThemeOption> {
  return [
    ...bootstrap.codeThemes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      swatch: codeThemeSwatch(theme.id)
    })),
    ...customCss.map((item) => ({
      id: `custom:${item.id}`,
      label: item.codeThemeName,
      swatch: CUSTOM_CSS_THEME_SWATCH
    }))
  ];
}

export function resolveActiveArticleSwatch(
  markdownTheme: string,
  selectedValue: string,
  articleOptions: ReadonlyArray<ImmersiveThemeOption>
): string {
  const selectedArticleSwatch = 'custom' === markdownTheme
    ? CUSTOM_CSS_THEME_SWATCH
    : articleOptions.find(({ id }) => id === selectedValue)?.swatch;
  return typeof selectedArticleSwatch === 'string'
    ? selectedArticleSwatch
    : DEFAULT_ARTICLE_THEME_SWATCH;
}

export function selectedCodeThemeValue(
  snapshot: AppearanceSnapshot,
  codeThemeExplicit: boolean
): string {
  return !codeThemeExplicit && selectedCustomCss(snapshot) !== undefined
    ? `custom:${snapshot.state.customCssId}`
    : `theme:${snapshot.state.codeTheme}`;
}
