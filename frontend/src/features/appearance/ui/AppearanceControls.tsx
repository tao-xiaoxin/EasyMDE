import {
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

export type AppearanceControlsSession = Readonly<{
  close: () => void;
  replaceSnapshot: (snapshot: AppearanceSnapshot) => boolean;
}>;

type AppearanceControlsProps = Readonly<{
  bootstrap: AppearanceBootstrap;
  port: AppearancePort;
  onFailure: () => void;
  onReady: (session: AppearanceControlsSession) => void;
}>;

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
  onReady
}: AppearanceControlsProps) {
  const [snapshot, setSnapshot] = useState<AppearanceSnapshot>({
    customCss: bootstrap.customCss,
    state: bootstrap.state
  });
  const [isOpen, setIsOpen] = useState(false);
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

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeForPointer = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (panelRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if ('Escape' !== event.key) {
        return;
      }
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('click', closeForPointer);
    document.addEventListener('keydown', closeForEscape);
    return () => {
      document.removeEventListener('click', closeForPointer);
      document.removeEventListener('keydown', closeForEscape);
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
        id: 'custom' === snapshotRef.current.state.markdownTheme
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

  return (
    <div className="easymde-toolbar-popover-anchor easymde-toolbar-popover-appearance">
      <button
        ref={triggerRef}
        type="button"
        className={`easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact${isOpen ? ' is-active' : ''}`}
        title={bootstrap.strings.appearance}
        aria-label={bootstrap.strings.appearance}
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
        <span className="dashicons dashicons-admin-customizer" aria-hidden="true" />
        <span className="dashicons dashicons-arrow-down-alt2" aria-hidden="true" />
      </button>
      <div
        ref={panelRef}
        className="easymde-toolbar-popover easymde-toolbar-popover-appearance-panel"
        role="dialog"
        aria-label={bootstrap.strings.appearance}
        hidden={!isOpen}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ('Escape' !== event.key) {
            event.stopPropagation();
          }
        }}
      >
        <label className="easymde-toolbar-control">
          <span className="easymde-toolbar-control-label">{bootstrap.strings.articleTheme}</span>
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
              <option key={theme.id} value={`theme:${theme.id}`}>{theme.label}</option>
            ))}
            {snapshot.customCss.length > 0 ? (
              <optgroup label={bootstrap.strings.namedCustomCss}>
                {snapshot.customCss.map((item) => (
                  <option key={item.id} value={`custom:${item.id}`}>{item.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className="easymde-toolbar-control">
          <span className="easymde-toolbar-control-label">{bootstrap.strings.codeTheme}</span>
          <select
            className="easymde-code-theme-select"
            value={snapshot.state.codeTheme}
            onChange={(event) => applyState({
              ...snapshotRef.current.state,
              codeTheme: event.currentTarget.value
            })}
          >
            {bootstrap.codeThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>{theme.label}</option>
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
            <span className="easymde-custom-css-status" aria-live="polite">{status}</span>
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
