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
  commands: ReadonlyArray<Pick<ToolbarCommand, 'id'>>;
  editorRoot: HTMLElement;
  eventTarget: ToolbarShortcutEventTarget;
  platform: ToolbarShortcutPlatform;
  shortcuts: Readonly<Record<string, ToolbarShortcut>>;
  source: HTMLElement;
}>;

function shouldHandle(
  event: KeyboardEvent,
  editorRoot: HTMLElement,
  source: HTMLElement
): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target !== editorRoot && !editorRoot.contains(target)) return false;
  if (target === source) return true;
  return !target.matches('input, textarea, select');
}

export function createBrowserToolbarShortcuts({
  commands,
  editorRoot,
  eventTarget,
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
  for (const { id } of commands) {
    const shortcut = canonicalizeKeyboardShortcut(
      shortcuts[id]?.[platform] ?? '',
      platform
    );
    if (null === shortcut) throw new Error('toolbar-shortcut-binding-invalid');
    if (!shortcut) continue;
    if (bindings.has(shortcut)) {
      throw new Error('toolbar-shortcut-bindings-conflict');
    }
    bindings.set(shortcut, id);
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
        if (!active || !shouldHandle(event, editorRoot, source)) return;
        const shortcut = keyboardShortcutFromEvent(event, platform);
        if (!shortcut) return;
        const commandId = bindings.get(shortcut);
        if (!commandId) return;
        event.preventDefault();
        event.stopPropagation();
        executeCommand(commandId);
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
