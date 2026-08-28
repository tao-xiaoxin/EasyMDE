import {
  Fragment,
  createElement,
  createPortal,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import {
  Check,
  ChevronDown,
  Settings,
  X
} from '../../../generated/lucide-icons';
import type {
  ImmersiveSettings,
  ImmersiveStrings
} from './immersive-editor-ui-types';

type Position = Readonly<{ right: number; tailRight: number; top: number }>;

export function ImmersiveSettingsPopover({
  settings,
  strings,
  onChange
}: Readonly<{
  settings: ImmersiveSettings;
  strings: ImmersiveStrings;
  onChange: (settings: ImmersiveSettings) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const focusFirstItemRef = useRef(false);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) {
      throw new Error('immersive-settings-trigger-unavailable');
    }
    const rect = trigger.getBoundingClientRect();
    const windowRef = trigger.ownerDocument.defaultView;
    if (!windowRef) {
      throw new Error('immersive-settings-window-unavailable');
    }
    setPosition({
      right: windowRef.innerWidth - rect.right,
      tailRight: Math.max(14, Math.min(22, rect.width / 2 - 6)),
      top: rect.bottom + 10
    });
  };

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  useEffect(() => {
    if (open && position && focusFirstItemRef.current) {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('button[role="checkbox"]')
        ?.focus();
      focusFirstItemRef.current = false;
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    const windowRef = trigger?.ownerDocument.defaultView;
    if (!windowRef) {
      throw new Error('immersive-settings-window-unavailable');
    }
    const reposition = () => updatePosition();
    const closeForEscape = (event: KeyboardEvent) => {
      if ('Escape' !== event.key) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    windowRef.addEventListener('resize', reposition);
    windowRef.addEventListener('scroll', reposition, true);
    windowRef.addEventListener('keydown', closeForEscape, true);
    return () => {
      windowRef.removeEventListener('resize', reposition);
      windowRef.removeEventListener('scroll', reposition, true);
      windowRef.removeEventListener('keydown', closeForEscape, true);
    };
  }, [open]);

  const items: ReadonlyArray<Readonly<{
    description: string;
    key: keyof ImmersiveSettings;
    label: string;
  }>> = [
    { key: 'outline', label: strings.articleOutline, description: strings.outlineDescription },
    { key: 'splitPreview', label: strings.splitPreview, description: strings.splitPreviewDescription }
  ];
  const portalRoot = triggerRef.current?.closest<HTMLElement>(
    '[data-easymde-editor-owner="react"]'
  );

  return (
    <Fragment>
      <button
        ref={triggerRef}
        type="button"
        className={`easymde-immersive-settings-trigger${open ? ' is-active' : ''}`}
        title={strings.editorSettings}
        aria-label={strings.editorSettings}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          focusFirstItemRef.current = 0 === event.detail;
          setOpen((current) => !current);
        }}
      >
        <Settings size={14} strokeWidth={2} />
        <ChevronDown size={10} strokeWidth={2.5} />
      </button>
      {open && position && portalRoot
        ? createPortal(
            <Fragment>
              <div
                className="easymde-immersive-settings-catcher"
                aria-hidden="true"
                onClick={close}
              />
              <section
                ref={panelRef}
                className="easymde-immersive-settings-popover"
                role="dialog"
                aria-label={strings.editorSettings}
                style={{ right: position.right, top: position.top }}
              >
                <span
                  className="easymde-immersive-settings-tail"
                  aria-hidden="true"
                  style={{ right: position.tailRight }}
                />
                <header>
                  <strong>{strings.settings}</strong>
                  <button
                    type="button"
                    aria-label={strings.close}
                    onClick={close}
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </header>
                <div className="easymde-immersive-settings-list">
                  {items.map((item) => {
                    const checked = settings[item.key];
                    const descriptionId = `immersive-setting-${item.key}-description`;
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: The reference UI exposes each setting row as a checkbox button.
                      <button
                        key={item.key}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={item.label}
                        aria-describedby={descriptionId}
                        onClick={() => {
                          onChange({
                            ...settings,
                            [item.key]: !checked
                          });
                        }}
                      >
                        <span
                          className="easymde-immersive-settings-check"
                          aria-hidden="true"
                        >
                          {checked ? (
                            <Check size={20} strokeWidth={2.8} />
                          ) : null}
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small id={descriptionId}>{item.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </Fragment>,
            portalRoot
          )
        : null}
    </Fragment>
  );
}
