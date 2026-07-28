import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../../contracts/bootstrap/font-controls-bootstrap';
import type { AppearancePort } from '../../../contracts/ports/appearance-port';
import type { FontControlsPort } from '../../../contracts/ports/font-controls-port';
import { Settings } from '../../../generated/lucide-icons';
import {
  AppearanceControls,
  type AppearanceControlsSession
} from '../../appearance/ui/AppearanceControls';
import {
  FontControls,
  type FontControlsSession
} from '../../font-controls/ui/FontControls';

export type OrdinaryEditorSettingsSession = Readonly<{
  close: (focusTarget?: HTMLElement) => void;
}>;

type Props = Readonly<{
  appearance: AppearanceBootstrap;
  appearancePort: AppearancePort;
  fonts: FontControlsBootstrap;
  fontControlsPort: FontControlsPort;
  label: string;
  onAppearanceReady: (session: AppearanceControlsSession) => void;
  onFailure: (code: string) => void;
  onFontControlsReady: (session: FontControlsSession) => void;
  onOpen: () => void;
  onReady: (session: OrdinaryEditorSettingsSession) => void;
}>;

export function OrdinaryEditorSettings({
  appearance,
  appearancePort,
  fonts,
  fontControlsPort,
  label,
  onAppearanceReady,
  onFailure,
  onFontControlsReady,
  onOpen,
  onReady
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const activeRef = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef<OrdinaryEditorSettingsSession>({
    close: (focusTarget) => {
      if (!activeRef.current) return;
      const activeElement = panelRef.current?.ownerDocument.activeElement;
      if (activeElement && panelRef.current?.contains(activeElement)) {
        (focusTarget ?? triggerRef.current)?.focus();
      }
      setIsOpen(false);
    }
  });

  useLayoutEffect(() => {
    activeRef.current = true;
    onReady(sessionRef.current);
    return () => {
      activeRef.current = false;
    };
  }, [onReady]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const firstControl = panelRef.current?.querySelector<HTMLElement>(
      'select:not([disabled]), button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!firstControl) {
      throw new Error('ordinary-editor-settings-focus-target-unavailable');
    }
    firstControl.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const documentRef = triggerRef.current?.ownerDocument;
    const windowRef = documentRef?.defaultView;
    if (!documentRef || !windowRef) {
      throw new Error('ordinary-editor-settings-document-unavailable');
    }
    const closeForPointer = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node
        && (triggerRef.current?.contains(target)
          || panelRef.current?.contains(target))
      ) {
        return;
      }
      sessionRef.current.close();
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if ('Escape' !== event.key) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if ('Tab' !== event.key) return;

      const focusableControls = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'select:not([disabled]), button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (0 === focusableControls.length) {
        throw new Error('ordinary-editor-settings-focus-target-unavailable');
      }

      const firstControl = focusableControls[0];
      const lastControl = focusableControls[focusableControls.length - 1];
      if (
        (event.shiftKey && documentRef.activeElement === firstControl)
        || (!event.shiftKey && documentRef.activeElement === lastControl)
      ) {
        event.preventDefault();
        (event.shiftKey ? lastControl : firstControl)?.focus();
      }
    };

    documentRef.addEventListener('click', closeForPointer);
    windowRef.addEventListener('keydown', closeForEscape);
    windowRef.addEventListener('keydown', containKeyboardFocus, true);
    return () => {
      documentRef.removeEventListener('click', closeForPointer);
      windowRef.removeEventListener('keydown', closeForEscape);
      windowRef.removeEventListener('keydown', containKeyboardFocus, true);
    };
  }, [isOpen]);

  return (
    <div className="easymde-toolbar-popover-anchor easymde-toolbar-popover-settings">
      <button
        ref={triggerRef}
        type="button"
        className={`easymde-toolbar-button easymde-toolbar-button-compact easymde-toolbar-settings-trigger${isOpen ? ' is-active' : ''}`}
        title={label}
        aria-label={label}
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
          onOpen();
          setIsOpen(true);
        }}
      >
        <Settings
          className="easymde-toolbar-icon easymde-toolbar-icon-settings"
          size={16}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      <div
        ref={panelRef}
        className="easymde-toolbar-popover easymde-toolbar-popover-settings-panel"
        role="dialog"
        aria-label={label}
        hidden={!isOpen}
      >
        <div className="easymde-editor-settings-heading">
          <Settings size={15} strokeWidth={2} aria-hidden="true" />
          <strong>{label}</strong>
        </div>
        <AppearanceControls
          bootstrap={appearance}
          onFailure={() => onFailure('react-editor-appearance-failed')}
          onReady={onAppearanceReady}
          port={appearancePort}
          variant="embedded"
        />
        <FontControls
          bootstrap={fonts}
          onFailure={() => onFailure('react-editor-fonts-failed')}
          onReady={onFontControlsReady}
          port={fontControlsPort}
          variant="embedded"
        />
      </div>
    </div>
  );
}
