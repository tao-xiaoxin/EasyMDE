import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';

import type {
  ToolbarBootstrap,
  ToolbarCommand
} from '../../contracts/bootstrap/toolbar-bootstrap';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import {
  type ToolbarCommandPlan,
  createToolbarCommandSession
} from '../../features/toolbar/toolbar-command-session';
import {
  EditorToolbar,
  type EditorToolbarSession,
  type ToolbarPlatform
} from '../../features/toolbar/ui/EditorToolbar';
import { formatKeyboardShortcut } from '../../shared/keyboard/keyboard-shortcut';
import {
  useWechatCopyStatus,
  type WechatCopyStatusStore
} from '../../features/wechat-export/wechat-copy-status';
import type {
  EditorRootProps,
  VisualToolbarCommandResult
} from './editor-root-types';

const WECHAT_ICON_PATHS = [
  'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
  'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
  'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
] as const;

export type ActiveToolbarProps = Readonly<{
  editorRoot: HTMLElement;
  executeVisualCommand?: (
    command: ToolbarCommand,
    plan?: () => ToolbarCommandPlan | null
  ) => VisualToolbarCommandResult;
  executeExternalCommand: EditorRootProps['executeExternalCommand'];
  isOwnedShortcutTarget?: (target: Element) => boolean;
  platform: ToolbarPlatform;
  prepareToolbarShortcuts: EditorRootProps['prepareToolbarShortcuts'];
  onPopoverOpen: (focusTarget?: HTMLElement) => void;
  onExecuteCommandReady?: (
    execute: ((commandId: string) => void) | null
  ) => void;
  onReady: (session: EditorToolbarSession) => void;
  session: EditorDocumentSession;
  toolbar: ToolbarBootstrap;
  variant?: 'default' | 'immersive';
}>;

export type RootExportCommandsProps = Readonly<{
  executeCommand: (commandId: string) => void;
  platform: ToolbarPlatform;
  toolbar: ToolbarBootstrap;
  wechatCopyStatus: WechatCopyStatusStore;
}>;

function WechatIcon() {
  return (
    <span className="easymde-wechat-glyph" aria-hidden="true">
      <svg viewBox="0 0 40 40" focusable="false" aria-hidden="true">
        {WECHAT_ICON_PATHS.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    </span>
  );
}

export function RootExportCommands({
  executeCommand,
  platform,
  toolbar,
  wechatCopyStatus
}: RootExportCommandsProps) {
  const {
    pending: wechatCopyPending,
    unavailable: wechatCopyUnavailable
  } = useWechatCopyStatus(wechatCopyStatus);
  const commands = toolbar.commands.filter(
    (command) => 'main' === command.surface && 'export' === command.group
  );
  if (!commands.length) {
    return null;
  }

  return (
    <Fragment>
      {commands.map((command) => {
        const shortcut = formatKeyboardShortcut(
          toolbar.shortcuts[command.id]?.[platform] ?? ''
        );
        const title = shortcut
          ? `${command.label} (${shortcut})`
          : command.label;
        const isWechatCopy = 'copyWechat' === command.action;
        const wechatCopyBlocked =
          isWechatCopy && (wechatCopyPending || wechatCopyUnavailable);
        return (
          <button
            key={command.id}
            type="button"
            className={`easymde-toolbar-button easymde-toolbar-button-compact${isWechatCopy ? ' easymde-toolbar-copy-action' : ''}`}
            data-easymde-command={command.id}
            aria-label={command.label}
            aria-busy={isWechatCopy && wechatCopyPending ? 'true' : undefined}
            aria-disabled={wechatCopyBlocked ? 'true' : undefined}
            title={title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand(command.id)}
          >
            {isWechatCopy ? (
              <WechatIcon />
            ) : (
              <span
                className={`dashicons dashicons-${command.icon}`}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
      <span className="easymde-toolbar-divider" aria-hidden="true" />
    </Fragment>
  );
}

export function ActiveToolbar({
  editorRoot,
  executeVisualCommand,
  executeExternalCommand,
  isOwnedShortcutTarget,
  platform,
  prepareToolbarShortcuts,
  onPopoverOpen,
  onExecuteCommandReady,
  onReady,
  session,
  toolbar,
  variant = 'default'
}: ActiveToolbarProps) {
  const [canUndo, setCanUndo] = useState(() => session.document.canUndo());
  const commandSessionRef = useRef<ReturnType<
    typeof createToolbarCommandSession
  > | null>(null);
  if (!commandSessionRef.current) {
    commandSessionRef.current = createToolbarCommandSession({
      commands: toolbar.commands,
      document: {
        applyTextChange: session.document.applyTextChange,
        focus: session.document.focus,
        getSnapshot: () => ({
          selection: session.document.getSelection(),
          value: session.document.getValue()
        })
      },
      executeExternalCommand: (commandId) =>
        executeExternalCommand(commandId, session),
      linkText: toolbar.linkText
    });
  }
  const commandSession = commandSessionRef.current;
  const executeCommand = useCallback(
    (commandId: string) => {
      if (executeVisualCommand) {
        const command = toolbar.commands.find(({ id }) => id === commandId);
        if (!command) throw new Error('visual-toolbar-command-missing');
        if (
          'unsupported'
          !== executeVisualCommand(command, () =>
            commandSession.plan(commandId)
          )
        )
          return;
      }
      if (commandSession.owns(commandId)) {
        commandSession.execute(commandId);
        return;
      }
      executeExternalCommand(commandId, session);
    },
    [
      commandSession,
      executeExternalCommand,
      executeVisualCommand,
      session,
      toolbar.commands
    ]
  );

  useEffect(() => {
    const binding = prepareToolbarShortcuts({
      editorRoot,
      ...(isOwnedShortcutTarget
        ? { isOwnedTarget: isOwnedShortcutTarget }
        : {}),
      source: session.document.getInputElement()
    }).prepareBinding(executeCommand);
    binding.activate();

    return () => binding.dispose();
  }, [
    executeCommand,
    editorRoot,
    isOwnedShortcutTarget,
    prepareToolbarShortcuts
  ]);

  useEffect(() => {
    onExecuteCommandReady?.(executeCommand);
    return () => onExecuteCommandReady?.(null);
  }, [executeCommand, onExecuteCommandReady]);

  useEffect(() => () => commandSession.dispose(), [commandSession]);
  useEffect(
    () =>
      session.document.subscribe(() => {
        setCanUndo(session.document.canUndo());
      }),
    [session]
  );
  return (
    <EditorToolbar
      bootstrap={toolbar}
      canUndo={canUndo}
      platform={platform}
      executeCommand={executeCommand}
      onPopoverOpen={onPopoverOpen}
      onReady={onReady}
      undo={session.document.undo}
      variant={variant}
    />
  );
}
