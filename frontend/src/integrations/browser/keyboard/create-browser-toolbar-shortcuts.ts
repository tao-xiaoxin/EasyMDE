import type {
  ToolbarCommand,
  ToolbarShortcut
} from '../../../contracts/bootstrap/toolbar-bootstrap';
import type {
  PreparedToolbarShortcutBinding,
  ToolbarShortcutsPort
} from '../../../contracts/ports/toolbar-shortcuts-port';
import {
  canonicalizeKeyboardShortcut,
  keyboardShortcutFromEvent
} from '../../../shared/keyboard/keyboard-shortcut';

type ToolbarShortcutPlatform = 'mac' | 'win';

type ToolbarShortcutEventTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

type CreateBrowserToolbarShortcutsOptions = Readonly<{
  commands: ReadonlyArray<
    Pick<ToolbarCommand, 'id' | 'defaultShortcutWin' | 'defaultShortcutMac'>
  >;
  editorRoot: HTMLElement;
  eventTarget: ToolbarShortcutEventTarget;
  isOwnedTarget?: (target: Element) => boolean;
  platform: ToolbarShortcutPlatform;
  shortcuts: Readonly<Record<string, ToolbarShortcut>>;
  source: HTMLElement;
}>;

function shouldHandle(
  event: KeyboardEvent,
  editorRoot: HTMLElement,
  source: HTMLElement,
  isOwnedTarget?: (target: Element) => boolean
): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const ownedByRegisteredSurface = isOwnedTarget?.(target) ?? false;
  if (
    !ownedByRegisteredSurface
    && target !== editorRoot
    && !editorRoot.contains(target)
  ) return false;
  if (ownedByRegisteredSurface) return true;
  if (target === source) return true;
  return !target.matches('input, textarea, select');
}

function keyboardShortcutWithoutRepeat(
  event: KeyboardEvent,
  platform: ToolbarShortcutPlatform
): string | null {
  return keyboardShortcutFromEvent(
    {
      altKey: event.altKey,
      code: event.code,
      ctrlKey: event.ctrlKey,
      isComposing: event.isComposing,
      key: event.key,
      keyCode: event.keyCode,
      metaKey: event.metaKey,
      repeat: false,
      shiftKey: event.shiftKey
    },
    platform
  );
}

export function createBrowserToolbarShortcuts({
  commands,
  editorRoot,
  eventTarget,
  isOwnedTarget,
  platform,
  shortcuts,
  source
}: CreateBrowserToolbarShortcutsOptions): ToolbarShortcutsPort {
  if (
    !(editorRoot instanceof HTMLElement)
    || !(source instanceof HTMLElement)
    || 'function' !== typeof eventTarget?.addEventListener
    || 'function' !== typeof eventTarget.removeEventListener
  ) {
    throw new Error('toolbar-shortcut-surfaces-invalid');
  }
  const bindings = new Map<string, string>();
  const suppressedDefaults = new Set<string>();
  for (const { id, defaultShortcutMac, defaultShortcutWin } of commands) {
    const configuredShortcut = canonicalizeKeyboardShortcut(
      shortcuts[id]?.[platform] ?? '',
      platform
    );
    if (null === configuredShortcut) throw new Error('toolbar-shortcut-binding-invalid');

    const defaultShortcut = canonicalizeKeyboardShortcut(
      'mac' === platform ? (defaultShortcutMac ?? '') : (defaultShortcutWin ?? ''),
      platform
    );
    if (null === defaultShortcut) throw new Error('toolbar-shortcut-default-invalid');
    if (defaultShortcut && configuredShortcut !== defaultShortcut) {
      suppressedDefaults.add(defaultShortcut);
    }

    if (!configuredShortcut) continue;
    if (bindings.has(configuredShortcut)) {
      throw new Error('toolbar-shortcut-bindings-conflict');
    }
    bindings.set(configuredShortcut, id);
  }

  return {
    prepareBinding(executeCommand): PreparedToolbarShortcutBinding {
      if ('function' !== typeof executeCommand) {
        throw new Error('toolbar-shortcut-executor-invalid');
      }
      let activated = false;
      let active = false;
      let disposed = false;
      const onKeyDown = (event: KeyboardEvent) => {
        if (!active || !shouldHandle(event, editorRoot, source, isOwnedTarget)) return;
        const shortcut = keyboardShortcutFromEvent(event, platform);
        if (shortcut) {
          const commandId = bindings.get(shortcut);
          if (!commandId && !suppressedDefaults.has(shortcut)) return;
          event.preventDefault();
          event.stopPropagation();
          if (commandId) executeCommand(commandId);
          return;
        }
        if (!event.repeat) return;
        const repeatedShortcut = keyboardShortcutWithoutRepeat(event, platform);
        if (!repeatedShortcut) return;
        if (bindings.has(repeatedShortcut)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!suppressedDefaults.has(repeatedShortcut)) return;
        event.preventDefault();
        event.stopPropagation();
      };

      return {
        activate(): void {
          if (activated || disposed) {
            throw new Error('toolbar-shortcut-binding-already-activated');
          }
          activated = true;
          eventTarget.addEventListener('keydown', onKeyDown, true);
          active = true;
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          if (!active) return;
          active = false;
          eventTarget.removeEventListener('keydown', onKeyDown, true);
        }
      };
    }
  };
}
