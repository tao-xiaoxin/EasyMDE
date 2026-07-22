import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import {
  Bold,
  Braces,
  Code2,
  ChevronDown,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  type LucideIcon
} from '../../../generated/lucide-icons';

import type {
  ToolbarBootstrap,
  ToolbarCommand
} from '../../../contracts/bootstrap/toolbar-bootstrap';

export type ToolbarPlatform = 'mac' | 'win';

type EditorToolbarProps = Readonly<{
  bootstrap: ToolbarBootstrap;
  platform: ToolbarPlatform;
  executeCommand: (commandId: string) => void;
  onPopoverOpen?: () => void;
  onReady?: (session: EditorToolbarSession) => void;
  variant?: 'default' | 'immersive';
}>;

export type EditorToolbarSession = Readonly<{
  closePopovers: () => void;
}>;

type CommandButtonProps = Readonly<{
  command: ToolbarCommand;
  shortcut: string;
  executeCommand: (commandId: string) => void;
  variant: 'default' | 'immersive';
}>;

const IMMERSIVE_ICONS: Readonly<Record<string, LucideIcon>> = {
  bold: Bold,
  codefence: Braces,
  image: Image,
  inlinecode: Code2,
  italic: Italic,
  link: Link2,
  orderedlist: ListOrdered,
  quote: Quote,
  strike: Strikethrough,
  unorderedlist: List
};

function commandIcon(
  command: ToolbarCommand,
  variant: 'default' | 'immersive'
) {
  const ImmersiveIcon = IMMERSIVE_ICONS[command.id];
  if ('immersive' === variant && ImmersiveIcon) {
    return <ImmersiveIcon size={14} strokeWidth={2} aria-hidden="true" />;
  }
  if ('media-code' === command.icon || 'mediacode' === command.icon) {
    return (
      <span className="easymde-toolbar-text-icon" aria-hidden="true">
        {'</>'}
      </span>
    );
  }

  if ('heading' === command.icon) {
    return (
      <span className="easymde-toolbar-text-icon" aria-hidden="true">
        H
      </span>
    );
  }

  return (
    <span
      className={`dashicons dashicons-${command.icon}`}
      aria-hidden="true"
    />
  );
}

function CommandButton({
  command,
  shortcut,
  executeCommand,
  variant
}: CommandButtonProps) {
  const title = shortcut ? `${command.label} (${shortcut})` : command.label;

  return (
    <button
      type="button"
      className="easymde-toolbar-button easymde-toolbar-button-compact"
      data-easymde-command={command.id}
      aria-label={command.label}
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => executeCommand(command.id)}
    >
      {commandIcon(command, variant)}
    </button>
  );
}

type HeadingMenuProps = Readonly<{
  commands: ReadonlyArray<ToolbarCommand>;
  label: string;
  shortcuts: Readonly<Record<string, string>>;
  executeCommand: (commandId: string) => void;
  isOpen: boolean;
  onOpen: () => void;
  setIsOpen: (isOpen: boolean) => void;
}>;

function HeadingMenu({
  commands,
  label,
  shortcuts,
  executeCommand,
  isOpen,
  onOpen,
  setIsOpen
}: HeadingMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocus = useRef<'first' | 'last' | 'preserve'>('preserve');

  useLayoutEffect(() => {
    if (!isOpen || 'preserve' === initialFocus.current) {
      return;
    }

    const index = 'last' === initialFocus.current ? commands.length - 1 : 0;
    itemRefs.current[index]?.focus();
  }, [commands.length, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeForPointer = () => setIsOpen(false);
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

  if (!commands.length) {
    return null;
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(
      (item): item is HTMLButtonElement => null !== item
    );
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement
    );
    let nextIndex: number | null = null;

    if ('ArrowDown' === event.key) {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if ('ArrowUp' === event.key) {
      nextIndex =
        currentIndex < 0
          ? items.length - 1
          : (currentIndex - 1 + items.length) % items.length;
    } else if ('Home' === event.key) {
      nextIndex = 0;
    } else if ('End' === event.key) {
      nextIndex = items.length - 1;
    } else if ('Escape' === event.key) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    } else if ('Tab' === event.key) {
      setIsOpen(false);
      return;
    }

    if (null !== nextIndex) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  };

  return (
    <div className="easymde-toolbar-popover-anchor easymde-toolbar-popover-headings">
      <button
        ref={triggerRef}
        type="button"
        className={`easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact${isOpen ? ' is-active' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          const nextIsOpen = !isOpen;
          if (nextIsOpen) {
            onOpen();
            initialFocus.current = 0 === event.detail ? 'first' : 'preserve';
          }
          setIsOpen(nextIsOpen);
        }}
        onKeyDown={(event) => {
          if ('ArrowDown' !== event.key && 'ArrowUp' !== event.key) {
            return;
          }

          event.preventDefault();
          onOpen();
          initialFocus.current = 'ArrowUp' === event.key ? 'last' : 'first';
          setIsOpen(true);
        }}
      >
        <span className="easymde-toolbar-text-icon" aria-hidden="true">
          H
        </span>
        <ChevronDown size={9} strokeWidth={2.5} aria-hidden="true" />
      </button>
      <div
        className="easymde-toolbar-popover"
        role="menu"
        aria-label={label}
        hidden={!isOpen}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleMenuKeyDown}
      >
        {commands.map((command, index) => (
          <button
            key={command.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            className="easymde-popover-item"
            role="menuitem"
            tabIndex={-1}
            data-easymde-command={command.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setIsOpen(false);
              executeCommand(command.id);
            }}
          >
            <span className="easymde-popover-item-label">{command.label}</span>
            <span className="easymde-popover-item-shortcut">
              {shortcuts[command.id]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorToolbar({
  bootstrap,
  platform,
  executeCommand,
  onPopoverOpen,
  onReady,
  variant = 'default'
}: EditorToolbarProps) {
  const [isHeadingOpen, setIsHeadingOpen] = useState(false);
  const activeRef = useRef(false);
  const sessionRef = useRef<EditorToolbarSession>({
    closePopovers: () => {
      if (activeRef.current) {
        setIsHeadingOpen(false);
      }
    }
  });
  const shortcuts: Record<string, string> = {};
  for (const command of bootstrap.commands) {
    shortcuts[command.id] = bootstrap.shortcuts[command.id]?.[platform] ?? '';
  }

  const commandsFor = (surface: string, group: string) =>
    bootstrap.commands.filter(
      (command) => command.surface === surface && command.group === group
    );
  const formatCommands = commandsFor('main', 'format');
  const headingCommands = bootstrap.commands.filter(
    (command) => 'heading-menu' === command.surface
  );
  const blockCommands = commandsFor('main', 'block');
  const codeCommands = commandsFor('main', 'insert').filter(
    (command) => 'inlinecode' === command.id || 'codefence' === command.id
  );
  const insertCommands = commandsFor('main', 'insert').filter(
    (command) => 'inlinecode' !== command.id && 'codefence' !== command.id
  );

  useLayoutEffect(() => {
    activeRef.current = true;
    onReady?.(sessionRef.current);
    return () => {
      activeRef.current = false;
    };
  }, [onReady]);

  return (
    <div
      className={`easymde-react-toolbar-contents is-${variant}`}
      data-easymde-react-toolbar="ready"
    >
      {formatCommands.map((command) => (
        <CommandButton
          key={command.id}
          command={command}
          shortcut={shortcuts[command.id] ?? ''}
          executeCommand={executeCommand}
          variant={variant}
        />
      ))}
      {'immersive' === variant && headingCommands.length && blockCommands.length ? (
        <span className="easymde-toolbar-divider" aria-hidden="true" />
      ) : null}
      <HeadingMenu
        commands={headingCommands}
        label={bootstrap.headingsLabel}
        shortcuts={shortcuts}
        executeCommand={executeCommand}
        isOpen={isHeadingOpen}
        onOpen={() => onPopoverOpen?.()}
        setIsOpen={setIsHeadingOpen}
      />
      {'immersive' === variant && blockCommands.length ? (
        <span className="easymde-toolbar-divider is-after-heading" aria-hidden="true" />
      ) : null}
      {'immersive' !== variant && blockCommands.length ? (
        <span className="easymde-toolbar-divider" aria-hidden="true" />
      ) : null}
      {blockCommands.map((command) => (
        <CommandButton
          key={command.id}
          command={command}
          shortcut={shortcuts[command.id] ?? ''}
          executeCommand={executeCommand}
          variant={variant}
        />
      ))}
      {codeCommands.length ? (
        <span className="easymde-toolbar-divider" aria-hidden="true" />
      ) : null}
      {codeCommands.map((command) => (
        <CommandButton
          key={command.id}
          command={command}
          shortcut={shortcuts[command.id] ?? ''}
          executeCommand={executeCommand}
          variant={variant}
        />
      ))}
      {insertCommands.length ? (
        <span className="easymde-toolbar-divider" aria-hidden="true" />
      ) : null}
      {insertCommands.map((command) => (
        <CommandButton
          key={command.id}
          command={command}
          shortcut={shortcuts[command.id] ?? ''}
          executeCommand={executeCommand}
          variant={variant}
        />
      ))}
    </div>
  );
}
