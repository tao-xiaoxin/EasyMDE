import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { CSSProperties } from 'react';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../../contracts/bootstrap/font-controls-bootstrap';
import type { AppearancePort } from '../../../contracts/ports/appearance-port';
import type { FontControlsPort } from '../../../contracts/ports/font-controls-port';
import { Settings } from '../../../generated/lucide-icons';
import {
  AppearanceControls,
  type AppearanceNotification,
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
  onNotification?: (notification: AppearanceNotification) => void;
  onNotificationDismiss?: (id: AppearanceNotification['id']) => void;
  onFontControlsReady: (session: FontControlsSession) => void;
  onOpen: () => void;
  onReady: (session: OrdinaryEditorSettingsSession) => void;
}>;

type PanelPosition = Readonly<{
  left: number;
  maxHeight: number;
  placement: 'above' | 'below';
  tailLeft: number;
  tailTop: number;
  top: number;
  width: number;
}>;

function settingsPanelPosition(
  trigger: HTMLButtonElement,
  panel: HTMLDivElement
): PanelPosition {
  const windowRef = trigger.ownerDocument.defaultView;
  if (!windowRef) {
    throw new Error('ordinary-editor-settings-document-unavailable');
  }
  const viewportPadding = 12;
  const inlinePadding = 16;
  const gap = 8;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(468, windowRef.innerWidth - inlinePadding * 2);
  const left = Math.min(
    Math.max(inlinePadding, rect.right - width),
    windowRef.innerWidth - width - inlinePadding
  );
  const panelFrameHeight = panel.offsetHeight - panel.clientHeight;
  const desiredHeight = panel.scrollHeight + panelFrameHeight;
  const belowTop = rect.bottom + gap;
  const spaceBelow = windowRef.innerHeight - belowTop - viewportPadding;
  const spaceAbove = rect.top - gap - viewportPadding;
  const placeAbove = desiredHeight > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = Math.min(
    desiredHeight,
    Math.max(0, placeAbove ? spaceAbove : spaceBelow)
  );
  const top = placeAbove
    ? Math.max(viewportPadding, rect.top - gap - maxHeight)
    : belowTop;
  const tailLeft = Math.min(
    width - 30,
    Math.max(16, rect.left + rect.width / 2 - left - 7)
  );
  const tailTop = placeAbove ? top + maxHeight - 7 : top - 7;
  return {
    left,
    maxHeight,
    placement: placeAbove ? 'above' : 'below',
    tailLeft,
    tailTop,
    top,
    width
  };
}

function triggerIntersectsViewport(
  trigger: HTMLButtonElement,
  windowRef: Window
): boolean {
  const rect = trigger.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < windowRef.innerHeight &&
    rect.left < windowRef.innerWidth
  );
}

export function OrdinaryEditorSettings({
  appearance,
  appearancePort,
  fonts,
  fontControlsPort,
  label,
  onAppearanceReady,
  onFailure,
  onNotification,
  onNotificationDismiss,
  onFontControlsReady,
  onOpen,
  onReady
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
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
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!firstControl) {
      throw new Error('ordinary-editor-settings-focus-target-unavailable');
    }
    firstControl.focus();
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) {
      throw new Error('ordinary-editor-settings-position-owner-unavailable');
    }
    setPanelPosition(settingsPanelPosition(trigger, panel));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const documentRef = triggerRef.current?.ownerDocument;
    const windowRef = documentRef?.defaultView;
    if (!documentRef || !windowRef) {
      throw new Error('ordinary-editor-settings-document-unavailable');
    }
    const closeForPointer = (event: MouseEvent) => {
      const eventPath = event.composedPath();
      if (
        (triggerRef.current && eventPath.includes(triggerRef.current))
        || (panelRef.current && eventPath.includes(panelRef.current))
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
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.closest('[role="listbox"]'));
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
    const reposition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (trigger && panel) {
        if (!triggerIntersectsViewport(trigger, windowRef)) {
          setIsOpen(false);
          return;
        }
        setPanelPosition(settingsPanelPosition(trigger, panel));
      }
    };
    const repositionForScroll = (event: Event) => {
      if (event.target === panelRef.current) return;
      reposition();
    };

    documentRef.addEventListener('click', closeForPointer);
    documentRef.addEventListener('scroll', repositionForScroll, true);
    windowRef.addEventListener('keydown', closeForEscape);
    windowRef.addEventListener('keydown', containKeyboardFocus, true);
    windowRef.addEventListener('resize', reposition);
    return () => {
      documentRef.removeEventListener('click', closeForPointer);
      documentRef.removeEventListener('scroll', repositionForScroll, true);
      windowRef.removeEventListener('keydown', closeForEscape);
      windowRef.removeEventListener('keydown', containKeyboardFocus, true);
      windowRef.removeEventListener('resize', reposition);
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
      {isOpen && panelPosition ? (
        <span
          className={`easymde-editor-settings-tail is-${panelPosition.placement}`}
          aria-hidden="true"
          style={{
            left: panelPosition.left + panelPosition.tailLeft,
            top: panelPosition.tailTop
          }}
        />
      ) : null}
      <div
        ref={panelRef}
        className="easymde-toolbar-popover easymde-toolbar-popover-settings-panel"
        role="dialog"
        aria-label={label}
        hidden={!isOpen}
        style={{
          left: panelPosition?.left,
          maxHeight: panelPosition?.maxHeight,
          position: 'fixed',
          top: panelPosition?.top,
          width: panelPosition?.width
        } as CSSProperties}
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
          {...(onNotification ? { onNotification } : {})}
          {...(onNotificationDismiss ? { onNotificationDismiss } : {})}
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
