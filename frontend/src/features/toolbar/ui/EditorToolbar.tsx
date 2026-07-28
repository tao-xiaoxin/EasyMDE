import {
  Fragment,
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import {
  Bold,
  Code,
  Code2,
  ChevronDown,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Undo2,
  type LucideIcon
} from '../../../generated/lucide-icons';

import type {
  ToolbarBootstrap,
  ToolbarCommand
} from '../../../contracts/bootstrap/toolbar-bootstrap';

export type ToolbarPlatform = 'mac' | 'win';

type EditorToolbarProps = Readonly<{
  bootstrap: ToolbarBootstrap;
  canUndo?: boolean;
  platform: ToolbarPlatform;
  executeCommand: (commandId: string) => void;
  onPopoverOpen?: () => void;
  onReady?: (session: EditorToolbarSession) => void;
  undo?: () => void;
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
  codefence: Code2,
  image: Image,
  inlinecode: Code,
  italic: Italic,
  link: Link2,
  orderedlist: ListOrdered,
  quote: Quote,
  strike: Strikethrough,
  unorderedlist: List
};

type OrdinaryBuiltInIcon = Readonly<{
  sourceIcon: string;
  component: LucideIcon;
}>;

const ORDINARY_BUILT_IN_ICONS: Readonly<Record<string, OrdinaryBuiltInIcon>> = {
  bold: { sourceIcon: 'editor-bold', component: Bold },
  codefence: { sourceIcon: 'media-code', component: Code2 },
  image: { sourceIcon: 'format-image', component: Image },
  inlinecode: { sourceIcon: 'editor-code', component: Code },
  italic: { sourceIcon: 'editor-italic', component: Italic },
  link: { sourceIcon: 'admin-links', component: Link2 },
  orderedlist: { sourceIcon: 'editor-ol', component: ListOrdered },
  quote: { sourceIcon: 'format-quote', component: Quote },
  strike: { sourceIcon: 'editor-strikethrough', component: Strikethrough },
  unorderedlist: { sourceIcon: 'editor-ul', component: List }
};

function commandIcon(
  command: ToolbarCommand,
  variant: 'default' | 'immersive'
) {
  const ImmersiveIcon = IMMERSIVE_ICONS[command.id];
  if ('immersive' === variant && ImmersiveIcon) {
    const strokeWidth =
      'bold' === command.id || 'italic' === command.id ? 2.5 : 2;
    return (
      <ImmersiveIcon
        size={14}
        strokeWidth={strokeWidth}
        aria-hidden="true"
      />
    );
  }

  const builtInIcon =
    'default' === variant ? ORDINARY_BUILT_IN_ICONS[command.id] : undefined;
  if (builtInIcon?.sourceIcon === command.icon) {
    const Icon = builtInIcon.component;
    return (
      <Icon
        className={`easymde-toolbar-icon easymde-toolbar-icon-${command.id}`}
        size={16}
        strokeWidth={2.1}
        aria-hidden="true"
      />
    );
  }
  if ('media-code' === command.icon || 'mediacode' === command.icon) {
    return (
      <span
        className={`easymde-toolbar-text-icon${'default' === variant ? ' easymde-toolbar-glyph-code' : ''}`}
        aria-hidden="true"
      >
        {'</>'}
      </span>
    );
  }

  if ('heading' === command.icon) {
    return (
      <span
        className={`easymde-toolbar-text-icon${'default' === variant ? ' easymde-toolbar-glyph-heading' : ''}`}
        aria-hidden="true"
      >
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
  headingLabelFormat: string;
  headingLevelLabel: string;
  label: string;
  shortcuts: Readonly<Record<string, string>>;
  executeCommand: (commandId: string) => void;
  isOpen: boolean;
  onOpen: () => void;
  setIsOpen: (isOpen: boolean) => void;
  variant: 'default' | 'immersive';
}>;

type ImmersiveMenuPosition = Readonly<{
  left: number;
  top: number;
}>;

function HeadingMenu({
  commands,
  headingLabelFormat,
  headingLevelLabel,
  label,
  shortcuts,
  executeCommand,
  isOpen,
  onOpen,
  setIsOpen,
  variant
}: HeadingMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocus = useRef<'first' | 'last' | 'preserve'>('preserve');
  const [immersivePosition, setImmersivePosition] =
    useState<ImmersiveMenuPosition | null>(null);

  const positionImmersiveMenu = () => {
    if ('immersive' !== variant) {
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) {
      throw new Error('immersive-heading-trigger-unavailable');
    }
    const rect = trigger.getBoundingClientRect();
    setImmersivePosition({
      left: rect.left,
      top: rect.bottom + 6
    });
  };

  useLayoutEffect(() => {
    if (!isOpen || 'preserve' === initialFocus.current) {
      return;
    }

    const index = 'last' === initialFocus.current ? commands.length - 1 : 0;
    itemRefs.current[index]?.focus();
  }, [commands.length, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || 'immersive' !== variant) {
      return undefined;
    }

    positionImmersiveMenu();
    const windowRef = triggerRef.current?.ownerDocument.defaultView;
    if (!windowRef) {
      throw new Error('immersive-heading-window-unavailable');
    }
    const updatePosition = () => positionImmersiveMenu();
    windowRef.addEventListener('resize', updatePosition);
    windowRef.addEventListener('scroll', updatePosition, true);
    return () => {
      windowRef.removeEventListener('resize', updatePosition);
      windowRef.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, variant]);

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
            positionImmersiveMenu();
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
          positionImmersiveMenu();
          onOpen();
          initialFocus.current = 'ArrowUp' === event.key ? 'last' : 'first';
          setIsOpen(true);
        }}
      >
        <span
          className={`easymde-toolbar-text-icon${'default' === variant ? ' easymde-toolbar-glyph-heading' : ''}`}
          aria-hidden="true"
        >
          H
        </span>
        {'immersive' === variant ? (
          <ChevronDown size={9} strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <ChevronDown
            className="easymde-toolbar-chevron"
            size={12}
            strokeWidth={2.25}
            aria-hidden="true"
          />
        )}
      </button>
      <div
        className={`easymde-toolbar-popover${'immersive' === variant ? ' is-immersive-heading-menu' : ''}`}
        role="menu"
        aria-label={label}
        hidden={!isOpen}
        style={
          'immersive' === variant && immersivePosition
            ? {
                left: `${immersivePosition.left}px`,
                top: `${immersivePosition.top}px`
              }
            : undefined
        }
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleMenuKeyDown}
      >
        {'immersive' === variant ? (
          <div className="easymde-immersive-heading-menu-title">
            {headingLevelLabel}
          </div>
        ) : null}
        {commands.map((command, index) => (
          <button
            key={command.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            className={`easymde-popover-item${'immersive' === variant ? ' is-immersive-heading-item' : ''}`}
            role="menuitem"
            tabIndex={-1}
            data-easymde-command={command.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setIsOpen(false);
              executeCommand(command.id);
            }}
          >
            {'immersive' === variant &&
            'heading' === command.action &&
            'number' === typeof command.level ? (
              <Fragment>
                <span
                  className="easymde-immersive-heading-badge"
                  data-heading-level={command.level}
                  aria-hidden="true"
                >
                  H{command.level}
                </span>
                <span className="easymde-popover-item-label">
                  {command.usesLevelLabel
                    ? headingLabelFormat.replace('%s', String(command.level))
                    : command.label}
                </span>
                <span aria-hidden="true" />
              </Fragment>
            ) : (
              <Fragment>
                {'immersive' === variant ? (
                  <span
                    className="easymde-immersive-heading-badge is-command"
                    aria-hidden="true"
                  >
                    <span
                      className={`dashicons dashicons-${command.icon}`}
                    />
                  </span>
                ) : 'heading' === command.action &&
                  'number' === typeof command.level ? (
                  <span
                    className="easymde-heading-menu-badge"
                    data-heading-level={command.level}
                    aria-hidden="true"
                  >
                    H{command.level}
                  </span>
                ) : (
                  <span
                    className="easymde-heading-menu-badge is-command"
                    aria-hidden="true"
                  >
                    <span
                      className={`dashicons dashicons-${command.icon}`}
                    />
                  </span>
                )}
                <span className="easymde-popover-item-label">{command.label}</span>
                <span className="easymde-popover-item-shortcut">
                  {shortcuts[command.id]}
                </span>
              </Fragment>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorToolbar({
  bootstrap,
  canUndo = false,
  platform,
  executeCommand,
  onPopoverOpen,
  onReady,
  undo,
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
  const ordinaryHeadingCommands = headingCommands.filter(
    (command) => 'paragraph' !== command.action
  );
  const immersiveHeadingCommands = headingCommands.filter(
    (command) => 'paragraph' !== command.id
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
      {'default' === variant ? (
        <button
          type="button"
          className="easymde-toolbar-button easymde-toolbar-button-compact"
          aria-label={bootstrap.undoLabel}
          title={bootstrap.undoLabel}
          disabled={!canUndo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!undo) throw new Error('ordinary-toolbar-undo-unavailable');
            undo();
          }}
        >
          <Undo2
            className="easymde-toolbar-icon easymde-toolbar-icon-undo"
            size={16}
            strokeWidth={2.1}
            aria-hidden="true"
          />
        </button>
      ) : null}
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
        <Fragment>
          <span className="easymde-toolbar-divider" aria-hidden="true" />
          <span className="easymde-toolbar-divider" aria-hidden="true" />
        </Fragment>
      ) : null}
      <HeadingMenu
        commands={
          'immersive' === variant
            ? immersiveHeadingCommands
            : ordinaryHeadingCommands
        }
        headingLabelFormat={bootstrap.headingLabelFormat}
        headingLevelLabel={bootstrap.headingLevelLabel}
        label={bootstrap.headingsLabel}
        shortcuts={shortcuts}
        executeCommand={executeCommand}
        isOpen={isHeadingOpen}
        onOpen={() => onPopoverOpen?.()}
        setIsOpen={setIsHeadingOpen}
        variant={variant}
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
