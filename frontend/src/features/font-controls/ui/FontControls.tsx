import {
  Fragment,
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type {
  FontControlsBootstrap,
  FontControlsState,
  FontOption
} from '../../../contracts/bootstrap/font-controls-bootstrap';
import type { FontControlsPort } from '../../../contracts/ports/font-controls-port';
import {
  Check,
  ChevronDown,
  Type
} from '../../../generated/lucide-icons';

export type FontControlsSession = Readonly<{
  close: () => void;
  replaceState: (state: FontControlsState) => boolean;
}>;

type FontControlsProps = Readonly<{
  bootstrap: FontControlsBootstrap;
  port: FontControlsPort;
  onFailure: () => void;
  onReady: (session: FontControlsSession) => void;
  variant?: 'default' | 'immersive';
}>;

type FontSelectProps = Readonly<{
  className: string;
  label: string;
  options: ReadonlyArray<FontOption>;
  selected: string;
  onChange: (selected: string) => void;
}>;

type ImmersivePanelPosition = Readonly<{
  left: number;
  top: number;
  width: number;
}>;

function FontSelect({
  className,
  label,
  options,
  selected,
  onChange
}: FontSelectProps) {
  return (
    <label className="easymde-toolbar-control">
      <span className="easymde-toolbar-control-label">{label}</span>
      <select
        className={className}
        value={selected}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImmersiveFontSelect({
  label,
  onChange,
  options,
  selected
}: Omit<FontSelectProps, 'className'>) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(selected);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((option) => option.id === selected);
  useEffect(() => {
    if (open) setActiveId(selected);
  }, [open, selected]);
  useEffect(() => {
    if (open) optionRefs.current[activeId]?.focus();
  }, [activeId, open]);
  const moveActive = (delta: number) => {
    const index = Math.max(0, options.findIndex((option) => option.id === activeId));
    const next = Math.min(options.length - 1, Math.max(0, index + delta));
    setActiveId(options[next]?.id ?? selected);
  };

  return (
    <div className="easymde-immersive-font-field">
      <span>{label}</span>
      <div className="easymde-immersive-font-select">
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{ fontFamily: selectedOption?.fontFamily || undefined }}
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
          <span>{selectedOption?.label ?? ''}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {open ? (
          <div role="listbox" aria-label={label} className="easymde-immersive-font-options">
            {options.map((option) => {
              const active = option.id === selected;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  id={`easymde-font-option-${option.id}`}
                  ref={(element) => { optionRefs.current[option.id] = element; }}
                  tabIndex={activeId === option.id ? 0 : -1}
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  style={{ fontFamily: option.fontFamily || undefined }}
                  onKeyDown={(event) => {
                    if ('ArrowDown' === event.key) {
                      event.preventDefault();
                      moveActive(1);
                    } else if ('ArrowUp' === event.key) {
                      event.preventDefault();
                      moveActive(-1);
                    } else if ('Home' === event.key) {
                      event.preventDefault();
                      setActiveId(options[0]?.id ?? selected);
                    } else if ('End' === event.key) {
                      event.preventDefault();
                      setActiveId(options[options.length - 1]?.id ?? selected);
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
                  <span>{active ? <Check size={11} aria-hidden="true" /> : null}</span>
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

export function FontControls({
  bootstrap,
  port,
  onFailure,
  onReady,
  variant = 'default'
}: FontControlsProps) {
  const [state, setState] = useState<FontControlsState>(bootstrap.state);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] =
    useState<ImmersivePanelPosition | null>(null);
  const activeRef = useRef(true);
  const stateRef = useRef(state);
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
    const width = Math.min(360, windowRef.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      windowRef.innerWidth - width - viewportPadding
    );
    const below = rect.bottom + 8;
    const top =
      below + panel.offsetHeight > windowRef.innerHeight - viewportPadding
        ? Math.max(viewportPadding, rect.top - panel.offsetHeight - 8)
        : below;
    setPanelPosition({ left, top, width });
  };

  const replaceState = (nextState: FontControlsState): boolean => {
    if (!activeRef.current) {
      return false;
    }

    try {
      port.applyState(nextState);
    } catch {
      onFailure();
      return false;
    }

    stateRef.current = nextState;
    setState(nextState);
    return true;
  };
  const replaceStateRef = useRef(replaceState);
  replaceStateRef.current = replaceState;
  const sessionRef = useRef<FontControlsSession>({
    close: () => {
      if (activeRef.current) {
        setIsOpen(false);
      }
    },
    replaceState: (nextState) => replaceStateRef.current(nextState)
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

  const select = (key: keyof FontControlsState, selected: string) => {
    replaceState({ ...stateRef.current, [key]: selected });
  };

  return (
    <div
      className={`easymde-toolbar-popover-anchor easymde-toolbar-popover-font${'immersive' === variant ? ' is-immersive' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact${isOpen ? ' is-active' : ''}`}
        title={bootstrap.strings.font}
        aria-label={bootstrap.strings.font}
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
            <Type size={13} strokeWidth={2} aria-hidden="true" />
            <span className="easymde-immersive-control-label">
              {bootstrap.strings.font}
            </span>
          </Fragment>
        ) : (
          <Fragment>
            <span
              className="easymde-toolbar-text-icon easymde-font-glyph"
              aria-hidden="true"
            >
              A
            </span>
            <span
              className="dashicons dashicons-arrow-down-alt2"
              aria-hidden="true"
            />
          </Fragment>
        )}
      </button>
      <div
        ref={panelRef}
        className={`easymde-toolbar-popover easymde-toolbar-popover-font-panel${'immersive' === variant ? ' is-immersive-panel' : ''}`}
        style={
          'immersive' === variant
            ? {
                left: panelPosition?.left ?? -9999,
                top: panelPosition?.top ?? -9999,
                visibility: panelPosition ? 'visible' : 'hidden',
                width: panelPosition?.width ?? 360
              }
            : undefined
        }
        role="dialog"
        aria-label={bootstrap.strings.font}
        hidden={!isOpen}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            nextTarget instanceof Node &&
            !event.currentTarget.contains(nextTarget) &&
            nextTarget !== triggerRef.current
          ) {
            setIsOpen(false);
          }
        }}
      >
        {'immersive' === variant ? (
          <Fragment>
            <ImmersiveFontSelect
              label={bootstrap.strings.customFont}
              options={bootstrap.options.customFonts}
              selected={state.customFont}
              onChange={(selected) => select('customFont', selected)}
            />
            <ImmersiveFontSelect
              label={bootstrap.strings.windowsFont}
              options={bootstrap.options.windowsFonts}
              selected={state.windowsFont}
              onChange={(selected) => select('windowsFont', selected)}
            />
            <ImmersiveFontSelect
              label={bootstrap.strings.appleFont}
              options={bootstrap.options.appleFonts}
              selected={state.appleFont}
              onChange={(selected) => select('appleFont', selected)}
            />
            <ImmersiveFontSelect
              label={bootstrap.strings.serifFont}
              options={bootstrap.options.serifOptions}
              selected={state.serifFont}
              onChange={(selected) => select('serifFont', selected)}
            />
          </Fragment>
        ) : (
          <Fragment>
            <FontSelect
              className="easymde-custom-font-select"
              label={bootstrap.strings.customFont}
              options={bootstrap.options.customFonts}
              selected={state.customFont}
              onChange={(selected) => select('customFont', selected)}
            />
            <FontSelect
              className="easymde-windows-font-select"
              label={bootstrap.strings.windowsFont}
              options={bootstrap.options.windowsFonts}
              selected={state.windowsFont}
              onChange={(selected) => select('windowsFont', selected)}
            />
            <FontSelect
              className="easymde-apple-font-select"
              label={bootstrap.strings.appleFont}
              options={bootstrap.options.appleFonts}
              selected={state.appleFont}
              onChange={(selected) => select('appleFont', selected)}
            />
            <FontSelect
              className="easymde-serif-font-select"
              label={bootstrap.strings.serifFont}
              options={bootstrap.options.serifOptions}
              selected={state.serifFont}
              onChange={(selected) => select('serifFont', selected)}
            />
          </Fragment>
        )}
        <p className="easymde-toolbar-help">
          {bootstrap.strings.fontStackHelp}
        </p>
      </div>
    </div>
  );
}
