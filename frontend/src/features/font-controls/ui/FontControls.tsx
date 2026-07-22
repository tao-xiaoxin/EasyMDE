import {
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

export function FontControls({
  bootstrap,
  port,
  onFailure,
  onReady,
  variant = 'default'
}: FontControlsProps) {
  const [state, setState] = useState<FontControlsState>(bootstrap.state);
  const [isOpen, setIsOpen] = useState(false);
  const activeRef = useRef(true);
  const stateRef = useRef(state);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
        <span
          className="easymde-toolbar-text-icon easymde-font-glyph"
          aria-hidden="true"
        >
          A
        </span>
        {'immersive' === variant ? (
          <span className="easymde-immersive-control-label">
            {bootstrap.strings.font}
          </span>
        ) : null}
        <span
          className="dashicons dashicons-arrow-down-alt2"
          aria-hidden="true"
        />
      </button>
      <div
        ref={panelRef}
        className="easymde-toolbar-popover easymde-toolbar-popover-font-panel"
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
        <p className="easymde-toolbar-help">
          {bootstrap.strings.fontStackHelp}
        </p>
      </div>
    </div>
  );
}
