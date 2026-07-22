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

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      right: trigger.ownerDocument.defaultView
        ? trigger.ownerDocument.defaultView.innerWidth - rect.right
        : 0,
      tailRight: Math.max(14, Math.min(22, rect.width / 2 - 6)),
      top: rect.bottom + 10
    });
  };

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  useEffect(() => {
    if (open && position) {
      panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    const windowRef = trigger?.ownerDocument.defaultView;
    if (!windowRef) return undefined;
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
    { key: 'outline', label: strings.outline, description: strings.outlineDescription },
    { key: 'wordCount', label: strings.wordCount, description: strings.wordCountDescription },
    { key: 'splitPreview', label: strings.splitPreview, description: strings.splitPreviewDescription },
    { key: 'autoSave', label: strings.autoSave, description: strings.autoSaveDescription },
    { key: 'syncScroll', label: strings.syncScroll, description: strings.syncScrollDescription }
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
        onClick={() => setOpen((current) => !current)}
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
                  {items.map((item) => (
                    <label
                      key={item.key}
                    >
                      <input
                        type="checkbox"
                        checked={settings[item.key]}
                        aria-label={item.label}
                        onChange={(event) =>
                          onChange({
                            ...settings,
                            [item.key]: event.currentTarget.checked
                          })
                        }
                      />
                      <span className="easymde-immersive-settings-check" aria-hidden="true">
                        {settings[item.key] ? <Check size={20} strokeWidth={2.8} /> : null}
                      </span>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            </Fragment>,
            portalRoot
          )
        : null}
    </Fragment>
  );
}
