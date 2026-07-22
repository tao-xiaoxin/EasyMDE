import type {
  ToolbarCommand,
  ToolbarShortcut
} from '../../../contracts/bootstrap/toolbar-bootstrap';
import type {
  PreparedToolbarShortcutBinding,
  ToolbarShortcutsPort
} from '../../../contracts/ports/toolbar-shortcuts-port';

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

function normalizeKey(key: string): string {
  const namedKeys: Readonly<Record<string, string>> = {
    ' ': 'Space',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Esc: 'Escape',
    Escape: 'Escape',
    Home: 'Home',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Tab: 'Tab'
  };
  if (namedKeys[key]) return namedKeys[key];
  if (['Shift', 'Alt', 'Control', 'Meta'].includes(key)) return '';
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  if (1 !== key.length) return '';
  if (/[a-z]/i.test(key)) return key.toUpperCase();
  return '0123456789[]`\\/.,-='.includes(key) ? key : '';
}

function normalizeShortcut(event: KeyboardEvent, platform: ToolbarShortcutPlatform): string {
  const key = normalizeKey(event.key);
  if (!key) return '';
  const modifiers: Array<string> = [];
  if ('mac' === platform) {
    if (event.metaKey) modifiers.push('Cmd');
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Option');
    if (event.shiftKey) modifiers.push('Shift');
  } else {
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Meta');
  }
  return modifiers.length ? [...modifiers, key].join('+') : '';
}

function shouldHandle(
  event: KeyboardEvent,
  editorRoot: HTMLElement,
  source: HTMLElement
): boolean {
  const target = event.target;
  if (event.isComposing || 229 === event.keyCode || !(target instanceof Element)) return false;
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
  const bindings = commands.flatMap(({ id }) => {
    const shortcut = shortcuts[id]?.[platform] ?? '';
    return shortcut ? [{ commandId: id, shortcut }] : [];
  });

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
        const shortcut = normalizeShortcut(event, platform);
        if (!shortcut) return;
        const binding = bindings.find((candidate) => candidate.shortcut === shortcut);
        if (!binding) return;
        event.preventDefault();
        event.stopPropagation();
        executeCommand(binding.commandId);
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
