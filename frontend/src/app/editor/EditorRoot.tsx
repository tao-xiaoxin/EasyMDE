import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { CSSProperties } from 'react';
import { MoreHorizontal } from '../../generated/lucide-icons';

import type { DocumentSourceBootstrap } from '../../contracts/bootstrap/document-source-bootstrap';
import type {
  EditorRootLocalDraftsBootstrap,
  EditorRootPreviewBootstrap
} from '../../contracts/bootstrap/editor-root-bootstrap';
import type {
  AppearanceBootstrap,
  AppearanceState
} from '../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../contracts/bootstrap/font-controls-bootstrap';
import type { ImageUploadBootstrap } from '../../contracts/bootstrap/image-upload-bootstrap';
import type { EditorLayoutBootstrap } from '../../contracts/bootstrap/editor-layout-bootstrap';
import type { MediaPickerBootstrap } from '../../contracts/bootstrap/media-picker-bootstrap';
import type {
  ToolbarBootstrap,
  ToolbarCommand
} from '../../contracts/bootstrap/toolbar-bootstrap';
import type { WechatExportBootstrap } from '../../contracts/bootstrap/wechat-export-bootstrap';
import type { AppearancePort } from '../../contracts/ports/appearance-port';
import type { FontControlsPort } from '../../contracts/ports/font-controls-port';
import type { ImageUploadPort } from '../../contracts/ports/image-upload-port';
import type { ImmersiveEnvironmentPort } from '../../contracts/ports/immersive-environment-port';
import type {
  ImmersivePreferencesPort,
  ImmersivePreferencesReadResult
} from '../../contracts/ports/immersive-preferences-port';
import {
  protectedEditorOperationError,
  type EditorSessionOperation,
  type EditorSessionPort
} from '../../contracts/ports/editor-session-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type { NativeSubmissionPort } from '../../contracts/ports/native-submission-port';
import type {
  NativeFeaturedImage,
  NativePublishDraft,
  NativePublishPort,
  NativePublishSnapshot
} from '../../contracts/ports/native-publish-port';
import type {
  MediaPickerDocumentPort,
  MediaPickerFramePort
} from '../../contracts/ports/media-picker-port';
import type {
  PreviewRequest,
  PreviewRequestPort,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { RevisionPort } from '../../contracts/ports/revision-port';
import type { ScrollSyncPort } from '../../contracts/ports/scroll-sync-port';
import type { ToolbarShortcutsPort } from '../../contracts/ports/toolbar-shortcuts-port';
import type { WechatClipboardPort } from '../../contracts/ports/wechat-clipboard-port';
import {
  AppearanceControls,
  type AppearanceNotification,
  type AppearanceControlsSession
} from '../../features/appearance/ui/AppearanceControls';
import {
  EditorDocumentSource,
  type EditorDocumentSession
} from '../../features/document-source/ui/EditorDocumentSource';
import {
  FontControls,
  type FontControlsSession
} from '../../features/font-controls/ui/FontControls';
import {
  OrdinaryEditorSettings,
  type OrdinaryEditorSettingsSession
} from '../../features/editor-settings/ui/OrdinaryEditorSettings';
import {
  createImageUploadSession,
  type ImageUploadStatus
} from '../../features/image-upload/image-upload-session';
import { EditorWorkspace } from '../../features/editor-layout/ui/EditorWorkspace';
import { useEditorSession } from '../../features/editor-session/use-editor-session';
import type { PreviewEnhancementPort } from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../../features/live-preview/ports/preview-scroll-port';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceRuntime,
  type PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { openMediaPickerSession } from '../../features/media-picker/media-picker-session';
import {
  createLocalDraftSession,
  type LocalDraftSession,
  type LocalDraftSessionStatus
} from '../../features/local-drafts/local-draft-session';
import { createToolbarCommandSession } from '../../features/toolbar/toolbar-command-session';
import {
  EditorToolbar,
  type EditorToolbarSession,
  type ToolbarPlatform
} from '../../features/toolbar/ui/EditorToolbar';
import {
  createWechatExportSession,
  type WechatExportStatus
} from '../../features/wechat-export/wechat-export-session';
import {
  ImmersiveEditor,
  ImmersiveToggleIcon
} from '../../features/immersive-editor/ui/ImmersiveEditor';
import { ImmersivePreviewSurface } from '../../features/immersive-editor/ui/ImmersivePreviewSurface';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime,
  type VisualPreviewSnapshot
} from '../../features/immersive-editor/ui/ImmersiveVisualEditor';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import { openFeaturedImagePicker } from '../../features/immersive-editor/open-featured-image-picker';
import {
  EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS,
  EditorMessageAlert
} from '../../shared/ui/EditorMessageAlert';
import type { EditorMessageAlertType } from '../../shared/ui/EditorMessageAlert';

type EditorStatus = Readonly<{
  id: string;
  message: string;
  owner: 'editor' | 'local-draft';
  type: EditorMessageAlertType;
}>;

export type EditorRootProps = Readonly<{
  appearance: AppearanceBootstrap;
  appearancePort: AppearancePort;
  document: DocumentSourceBootstrap;
  enhancementPort: PreviewEnhancementPort;
  executeExternalCommand: (
    commandId: string,
    session: EditorDocumentSession
  ) => unknown;
  fontControlsPort: FontControlsPort;
  fonts: FontControlsBootstrap;
  imageUpload: Pick<
    ImageUploadBootstrap,
    'enabled' | 'maxBytes' | 'postId' | 'strings'
  >;
  imageUploadPort: ImageUploadPort;
  immersiveEnvironment: ImmersiveEnvironmentPort;
  immersiveI18n: Parameters<typeof ImmersiveEditor>[0]['i18n'];
  immersivePreferencesPort: ImmersivePreferencesPort;
  immersiveStrings: Parameters<typeof ImmersiveEditor>[0]['strings'];
  layout: EditorLayoutBootstrap;
  localDrafts: EditorRootLocalDraftsBootstrap;
  localDraftStorage: LocalDraftStoragePort;
  labels: Readonly<{
    preview: string;
    source: string;
    toolbar: string;
  }>;
  mediaPicker: MediaPickerBootstrap;
  mediaPickerFailureMessage: string;
  mediaPickerFrame: MediaPickerFramePort | null;
  nativeSubmissionPort: NativeSubmissionPort;
  nativePublishPort: NativePublishPort;
  onDocumentOwnerChange: (owned: boolean) => void;
  onFailure: (code: string) => void;
  platform: ToolbarPlatform;
  publishPost: (session: EditorDocumentSession) => boolean;
  prepareToolbarShortcuts: (
    surfaces: Readonly<{
      editorRoot: HTMLElement;
      source: HTMLElement;
    }>
  ) => ToolbarShortcutsPort;
  preview: EditorRootPreviewBootstrap;
  previewPort: PreviewRequestPort;
  revisionPort: RevisionPort | null;
  restoreRevision: (restoreUrl: string) => void;
  scrollPort: PreviewScrollPort;
  scrollSyncPort: ScrollSyncPort;
  sessionPort: EditorSessionPort;
  submissionField: HTMLTextAreaElement;
  titleField: HTMLInputElement | null;
  toolbar: ToolbarBootstrap;
  wechatClipboard: WechatClipboardPort;
  wechatExport: WechatExportBootstrap;
}>;

type ActiveToolbarProps = Readonly<{
  editorRoot: HTMLElement;
  executeVisualCommand?: (command: ToolbarCommand) => boolean;
  executeExternalCommand: EditorRootProps['executeExternalCommand'];
  platform: ToolbarPlatform;
  prepareToolbarShortcuts: EditorRootProps['prepareToolbarShortcuts'];
  onPopoverOpen: (focusTarget?: HTMLElement) => void;
  onReady: (session: EditorToolbarSession) => void;
  session: EditorDocumentSession;
  toolbar: ToolbarBootstrap;
  variant?: 'default' | 'immersive';
}>;

type RootExportCommandsProps = Readonly<{
  executeCommand: (commandId: string) => void;
  platform: ToolbarPlatform;
  toolbar: ToolbarBootstrap;
}>;

const WECHAT_ICON_PATHS = [
  'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
  'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
  'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
] as const;

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

function RootExportCommands({
  executeCommand,
  platform,
  toolbar
}: RootExportCommandsProps) {
  const commands = toolbar.commands.filter(
    (command) => 'main' === command.surface && 'export' === command.group
  );
  if (!commands.length) {
    return null;
  }

  return (
    <Fragment>
      {commands.map((command) => {
        const shortcut = toolbar.shortcuts[command.id]?.[platform] ?? '';
        const title = shortcut
          ? `${command.label} (${shortcut})`
          : command.label;
        return (
          <button
            key={command.id}
            type="button"
            className={`easymde-toolbar-button easymde-toolbar-button-compact${'copyWechat' === command.action ? ' easymde-toolbar-copy-action' : ''}`}
            data-easymde-command={command.id}
            aria-label={command.label}
            title={title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand(command.id)}
          >
            {'copyWechat' === command.action ? (
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

function ActiveToolbar({
  editorRoot,
  executeVisualCommand,
  executeExternalCommand,
  platform,
  prepareToolbarShortcuts,
  onPopoverOpen,
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
        if (executeVisualCommand(command)) return;
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
      source: session.document.getInputElement()
    }).prepareBinding(executeCommand);
    binding.activate();

    return () => binding.dispose();
  }, [executeCommand, editorRoot, prepareToolbarShortcuts]);

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

function previewRequest(
  markdown: string,
  preview: EditorRootPreviewBootstrap,
  appearance: AppearanceState,
  revision: number
): PreviewRequest {
  return {
    markdown,
    postId: preview.postId,
    markdownTheme: appearance.markdownTheme,
    codeTheme: appearance.codeTheme,
    customCssId: appearance.customCssId,
    signature: `${revision}:${markdown.length}`
  };
}

function documentPort(
  session: EditorDocumentSession,
  isActive: () => boolean
): MediaPickerDocumentPort {
  return {
    applyTextChange: (change) => {
      if (!isActive()) {
        throw new Error('editor-root-document-session-inactive');
      }
      session.document.applyTextChange(change);
    },
    focus: () => {
      if (isActive()) {
        session.document.focus();
      }
    },
    getSnapshot: () => {
      if (!isActive()) {
        throw new Error('editor-root-document-session-inactive');
      }
      return {
        selection: session.document.getSelection(),
        value: session.document.getValue()
      };
    }
  };
}

function mediaPickerFailureCode(error: unknown): string {
  return error instanceof Error &&
    /^media-picker-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : 'media-picker-operation-failed';
}

function fontStack(
  bootstrap: FontControlsBootstrap,
  state: FontControlsBootstrap['state']
): string {
  const selections = [
    [bootstrap.options.customFonts, state.customFont],
    [bootstrap.options.windowsFonts, state.windowsFont],
    [bootstrap.options.appleFonts, state.appleFont],
    [bootstrap.options.serifOptions, state.serifFont]
  ] as const;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const [options, selected] of selections) {
    const family = options.find(({ id }) => id === selected)?.fontFamily ?? '';
    for (const part of family
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      const key = part.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(part);
      }
    }
  }
  return parts.join(', ');
}

export function EditorRoot(props: EditorRootProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const immersiveToggleRef = useRef<HTMLButtonElement>(null);
  const restoreImmersiveFocusRef = useRef(false);
  const appearanceSessionRef = useRef<AppearanceControlsSession | null>(null);
  const fontControlsSessionRef = useRef<FontControlsSession | null>(null);
  const ordinarySettingsSessionRef =
    useRef<OrdinaryEditorSettingsSession | null>(null);
  const toolbarSessionRef = useRef<EditorToolbarSession | null>(null);
  const previewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const visualEditorRuntimeRef =
    useRef<ImmersiveVisualEditorRuntime | null>(null);
  const scheduledPreviewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const previewRevisionRef = useRef(0);
  const previewAppearanceRef = useRef(props.appearance.state);
  const codeThemeExplicitRef = useRef(props.appearance.codeThemeExplicit);
  const localDraftSessionRef = useRef<LocalDraftSession | null>(null);
  const mediaOperationRef = useRef<Promise<unknown> | null>(null);
  const featuredImageOperationRef = useRef<Promise<NativeFeaturedImage | null> | null>(null);
  const imageUploadOperationSequenceRef = useRef(0);
  const rootActiveRef = useRef(true);
  const initialSubmissionStateRef = useRef({
    ...props.appearance.state,
    codeThemeExplicit: props.appearance.codeThemeExplicit,
    ...props.fonts.state
  });
  const submissionStateRef = useRef(initialSubmissionStateRef.current);
  const [documentSession, setDocumentSession] =
    useState<EditorDocumentSession | null>(null);
  const [immersivePreferences, setImmersivePreferences] =
    useState<ImmersivePreferencesReadResult>(() =>
      props.immersivePreferencesPort.read()
    );
  const [draftCandidate, setDraftCandidate] = useState(false);
  const [draftUnreadable, setDraftUnreadable] = useState(false);
  const [editorStatusState, setEditorStatusState] = useState<{
    focused: boolean;
    status: EditorStatus | null;
  }>({ focused: false, status: null });
  const editorStatus = editorStatusState.status;
  const editorStatusFocused = editorStatusState.focused;
  const editorStatusTimerRef = useRef<{
    deadline: number | null;
    remaining: number;
    status: EditorStatus | null;
  }>({
    deadline: null,
    remaining: EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS,
    status: null
  });
  const [previewRuntimeGeneration, setPreviewRuntimeGeneration] = useState(0);
  const [previewRefreshRevision, setPreviewRefreshRevision] = useState(0);
  const [previewSurfaceStatus, setPreviewSurfaceStatus] =
    useState<PreviewSurfaceStatus>('loading');
  const [visualPreviewSnapshot, setVisualPreviewSnapshot] = useState<
    (VisualPreviewSnapshot & { html: SafePreviewHtml }) | null
  >(null);
  const [visualPreviewEditing, setVisualPreviewEditing] = useState(false);
  const [visualPreviewPending, setVisualPreviewPending] = useState(false);
  const [visualEditorSurface, setVisualEditorSurface] =
    useState<HTMLElement | null>(null);
  const visualPreviewEditingRef = useRef(visualPreviewEditing);
  visualPreviewEditingRef.current = visualPreviewEditing;
  const [visualPreviewChanged, setVisualPreviewChanged] = useState(false);
  const [appearanceSnapshot, setAppearanceSnapshot] = useState(() => ({
    customCss: props.appearance.customCss,
    state: props.appearance.state
  }));
  const appearanceState = appearanceSnapshot.state;
  const [codeThemeExplicit, setCodeThemeExplicit] = useState(
    props.appearance.codeThemeExplicit
  );
  const currentAppearance = useMemo<AppearanceBootstrap>(
    () => ({
      ...props.appearance,
      ...appearanceSnapshot,
      codeThemeExplicit
    }),
    [appearanceSnapshot, codeThemeExplicit, props.appearance]
  );
  const [fontState, setFontState] = useState(props.fonts.state);
  const currentFonts = useMemo<FontControlsBootstrap>(
    () => ({ ...props.fonts, state: fontState }),
    [fontState, props.fonts]
  );
  const [immersive, setImmersive] = useState(false);
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;
  const [immersiveMode, setImmersiveMode] =
    useState<ImmersiveViewMode>(() =>
      'loaded' === immersivePreferences.status &&
      !immersivePreferences.preferences.splitPreview
        ? 'source'
        : 'split'
    );
  const immersiveModeRef = useRef(immersiveMode);
  immersiveModeRef.current = immersiveMode;
  const [localDraftsEnabled, setLocalDraftsEnabled] = useState(() =>
    'loaded' === immersivePreferences.status
      ? immersivePreferences.preferences.autoSave
      : props.localDrafts.enabled
  );
  const localDraftsEnabledRef = useRef(localDraftsEnabled);
  localDraftsEnabledRef.current = localDraftsEnabled;
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(() =>
    'loaded' === immersivePreferences.status
      ? immersivePreferences.preferences.syncScroll
      : true
  );
  useEffect(() => {
    if ('failed' === immersivePreferences.status) {
      props.onFailure(immersivePreferences.code);
    }
  }, [immersivePreferences, props.onFailure]);
  const [cursorPosition, setCursorPosition] = useState({ column: 1, line: 1 });
  const sessionSnapshot = useEditorSession(props.sessionPort);
  const publishEditorStatus = useCallback(
    (nextStatus: EditorStatus) =>
      setEditorStatusState((currentState) => {
        const next =
          'error' === currentState.status?.type &&
          currentState.status.id !== nextStatus.id &&
          'error' !== nextStatus.type
            ? currentState.status
            : nextStatus;
        return next === currentState.status
          ? currentState
          : { ...currentState, status: next };
      }),
    []
  );
  const setImageUploadStatus = useCallback(
    (status: ImageUploadStatus) => {
      publishEditorStatus({
        ...status,
        id: status.operationId,
        owner: 'editor'
      });
    },
    [publishEditorStatus]
  );
  const nextImageUploadOperationId = useCallback(
    () => `image-upload-${++imageUploadOperationSequenceRef.current}`,
    []
  );
  const setWechatStatus = useCallback(
    (status: WechatExportStatus) => {
      publishEditorStatus({
        ...status,
        id: 'wechat-export',
        owner: 'editor'
      });
    },
    [publishEditorStatus]
  );
  const setLocalDraftStatus = useCallback(
    (status: LocalDraftSessionStatus) => {
      if (immersiveRef.current && 'saved' === status.code) return;
      publishEditorStatus({
        ...status,
        id: 'local-draft',
        owner: 'local-draft'
      });
    },
    [publishEditorStatus]
  );
  useEffect(() => {
    const timerState = editorStatusTimerRef.current;
    if (!editorStatus) {
      timerState.deadline = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      timerState.status = null;
      return undefined;
    }
    if (timerState.status !== editorStatus) {
      timerState.deadline = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      timerState.status = editorStatus;
    }
    if (editorStatusFocused) return undefined;

    const scheduledStatus = editorStatus;
    const delay = timerState.remaining;
    timerState.deadline = props.immersiveEnvironment.now() + delay;
    const cancel = props.immersiveEnvironment.schedule(() => {
      timerState.deadline = null;
      timerState.remaining = 0;
      setEditorStatusState((currentState) =>
        currentState.status === scheduledStatus
          ? { focused: false, status: null }
          : currentState
      );
    }, delay);
    return () => {
      cancel();
      if (
        timerState.status === scheduledStatus &&
        null !== timerState.deadline
      ) {
        timerState.remaining = Math.max(
          0,
          timerState.deadline - props.immersiveEnvironment.now()
        );
        timerState.deadline = null;
      }
    };
  }, [editorStatus, editorStatusFocused, props.immersiveEnvironment]);
  const setAppearanceNotification = useCallback(
    (notification: AppearanceNotification) =>
      publishEditorStatus({ ...notification, owner: 'editor' }),
    [publishEditorStatus]
  );
  const dismissAppearanceNotification = useCallback(
    (id: AppearanceNotification['id']) => {
      setEditorStatusState((currentState) =>
        id === currentState.status?.id
          ? { focused: false, status: null }
          : currentState
      );
    },
    []
  );
  const protectedOperationError = useCallback(
    (operation: EditorSessionOperation) => {
      const error = protectedEditorOperationError(
        props.sessionPort.getSnapshot(),
        operation
      );
      if (error) props.onFailure(error.message);
      return error;
    },
    [props.onFailure, props.sessionPort]
  );
  const wechatSession = useMemo(
    () =>
      createWechatExportSession({
        clipboard: props.wechatClipboard,
        enabled: props.wechatExport.enabled,
        getPreview: () =>
          visualEditorRuntimeRef.current?.surface
          ?? previewRuntimeRef.current?.surface
          ?? null,
        onDiagnostic: props.onFailure,
        onStatus: setWechatStatus,
        strings: props.wechatExport.strings
      }),
    [
      props.onFailure,
      props.wechatClipboard,
      props.wechatExport,
      setWechatStatus
    ]
  );

  const handleDocumentReady = useCallback((session: EditorDocumentSession) => {
    session.registerSubmissionState(initialSubmissionStateRef.current);
    setDocumentSession(session);
  }, []);

  useLayoutEffect(() => {
    if (!documentSession) return;
    props.onDocumentOwnerChange(true);
    return () => props.onDocumentOwnerChange(false);
  }, [documentSession, props.onDocumentOwnerChange]);
  useEffect(
    () => () => props.enhancementPort.dispose?.(),
    [props.enhancementPort]
  );
  const handlePreviewReady = useCallback((runtime: PreviewSurfaceRuntime) => {
    previewRuntimeRef.current = runtime;
    setPreviewRuntimeGeneration((generation) => generation + 1);
  }, []);
  const handlePreviewDispose = useCallback((runtime: PreviewSurfaceRuntime) => {
    if (previewRuntimeRef.current === runtime) {
      previewRuntimeRef.current = null;
      setPreviewRuntimeGeneration((generation) => generation + 1);
    }
    if (scheduledPreviewRuntimeRef.current === runtime) {
      scheduledPreviewRuntimeRef.current = null;
    }
  }, []);
  const handlePreviewSnapshotReady = useCallback(
    (html: SafePreviewHtml, signature: string) => {
      setVisualPreviewSnapshot((current) => ({
        html,
        revision: (current?.revision ?? 0) + 1,
        signature
      }));
    },
    []
  );
  const handlePreviewStatusChange = useCallback(
    (status: PreviewSurfaceStatus) => {
      setPreviewSurfaceStatus(status);
      if ('empty' === status) setVisualPreviewSnapshot(null);
    },
    []
  );
  const handleVisualEditorReady = useCallback(
    (runtime: ImmersiveVisualEditorRuntime) => {
      visualEditorRuntimeRef.current = runtime;
      setVisualEditorSurface(runtime.surface);
    },
    []
  );
  const handleVisualEditorDispose = useCallback(
    (runtime: ImmersiveVisualEditorRuntime) => {
      if (visualEditorRuntimeRef.current === runtime) {
        visualEditorRuntimeRef.current = null;
        if (rootActiveRef.current) setVisualEditorSurface(null);
      }
    },
    []
  );
  const closeForToolbar = useCallback((focusTarget?: HTMLElement) => {
    appearanceSessionRef.current?.close();
    fontControlsSessionRef.current?.close();
    ordinarySettingsSessionRef.current?.close(focusTarget);
  }, []);
  const schedulePreviewMarkdown = useCallback(
    (markdown: string, immediate = false): string => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) {
        throw new Error('preview-runtime-unavailable');
      }
      const revision = ++previewRevisionRef.current;
      const request = previewRequest(
        markdown,
        props.preview,
        previewAppearanceRef.current,
        revision
      );
      runtime.session.schedule(request, immediate);
      return request.signature;
    },
    [props.preview]
  );
  const schedulePreview = useCallback(
    (immediate = false) => {
      schedulePreviewMarkdown(props.submissionField.value, immediate);
    },
    [props.submissionField, schedulePreviewMarkdown]
  );
  const handleVisualFailure = useCallback(
    (code: string) => {
      props.onFailure(code);
      setPreviewSurfaceStatus('error');
      publishEditorStatus({
        id: 'visual-preview',
        message: props.preview.messages.error,
        owner: 'editor',
        type: 'error'
      });
    },
    [props.onFailure, props.preview.messages.error, publishEditorStatus]
  );
  const handleVisualMarkdownChange = useCallback(
    () => setVisualPreviewChanged(true),
    []
  );
  const handleVisualPendingChange = useCallback((pending: boolean) => {
    if (rootActiveRef.current) setVisualPreviewPending(pending);
  }, []);
  const handleVisualPreviewRequest = useCallback(
    (markdown: string) => schedulePreviewMarkdown(markdown, true),
    [schedulePreviewMarkdown]
  );
  const leaveVisualPreview = useCallback(() => {
    if (!visualPreviewEditingRef.current) return false;
    visualPreviewEditingRef.current = false;
    setVisualPreviewEditing(false);
    setVisualPreviewPending(false);
    setVisualPreviewChanged(false);
    setPreviewRefreshRevision((revision) => revision + 1);
    return true;
  }, []);
  const handleVisualTransferFailure = useCallback(() => {
    leaveVisualPreview();
  }, [leaveVisualPreview]);
  const handleVisualCanonicalDocumentChange = useCallback(() => {
    props.onFailure('visual-editor-canonical-document-changed');
    leaveVisualPreview();
  }, [leaveVisualPreview, props.onFailure]);
  const prepareSourceMutation = useCallback(() => {
    if (!visualPreviewEditingRef.current) return true;
    const runtime = visualEditorRuntimeRef.current;
    if (!runtime) throw new Error('visual-editor-runtime-unavailable');
    if (!runtime.prepareToolbarFallback()) return false;
    leaveVisualPreview();
    return true;
  }, [leaveVisualPreview]);
  const appearancePort = useMemo<AppearancePort>(
    () => ({
      applyState: (state, codeThemeExplicit) => {
        const visualPreviewWasEditing = visualPreviewEditingRef.current;
        if (visualPreviewWasEditing && !prepareSourceMutation()) {
          throw new Error('visual-editor-source-sync-failed');
        }
        props.appearancePort.applyState(state, codeThemeExplicit);
        codeThemeExplicitRef.current = codeThemeExplicit;
        setCodeThemeExplicit(codeThemeExplicit);
        setAppearanceSnapshot((snapshot) => ({ ...snapshot, state }));
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state,
          codeThemeExplicit
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
        previewAppearanceRef.current = state;
        const defaults = props.appearance.articleThemes.find(
          ({ id }) => id === state.markdownTheme
        )?.fontDefaults;
        if (defaults) {
          fontControlsSessionRef.current?.replaceState(defaults);
        }
        if (!visualPreviewWasEditing) {
          schedulePreview(true);
        }
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        fontControlsSessionRef.current?.close();
        ordinarySettingsSessionRef.current?.close();
        props.appearancePort.closeOtherPopovers();
      },
      previewCustomCss: (css, signal) =>
        props.appearancePort.previewCustomCss(css, signal),
      saveCustomCss: async (input) => {
        const sessionError = protectedOperationError('authenticated');
        if (sessionError) throw sessionError;
        const visualPreviewWasEditing = visualPreviewEditingRef.current;
        if (visualPreviewWasEditing && !prepareSourceMutation()) {
          throw new Error('visual-editor-source-sync-failed');
        }
        const result = await props.appearancePort.saveCustomCss(input);
        if ('saved' === result.status) {
          props.appearancePort.applyState(
            result.snapshot.state,
            codeThemeExplicitRef.current
          );
          setAppearanceSnapshot(result.snapshot);
          submissionStateRef.current = {
            ...submissionStateRef.current,
            ...result.snapshot.state
          };
          documentSession?.replaceSubmissionState(submissionStateRef.current);
          previewAppearanceRef.current = result.snapshot.state;
          if (!visualPreviewWasEditing) {
            schedulePreview(true);
          }
        }
        return result;
      }
    }),
    [
      documentSession,
      props.appearance.articleThemes,
      props.appearancePort,
      prepareSourceMutation,
      protectedOperationError,
      schedulePreview
    ]
  );
  const fontControlsPort = useMemo<FontControlsPort>(
    () => ({
      applyState: (state) => {
        props.fontControlsPort.applyState(state);
        setFontState(state);
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        appearanceSessionRef.current?.close();
        ordinarySettingsSessionRef.current?.close();
        props.fontControlsPort.closeOtherPopovers();
      }
    }),
    [documentSession, props.fontControlsPort]
  );
  const handleAppearanceReady = useCallback(
    (session: AppearanceControlsSession) => {
      appearanceSessionRef.current = session;
    },
    []
  );
  const handleFontControlsReady = useCallback(
    (session: FontControlsSession) => {
      fontControlsSessionRef.current = session;
    },
    []
  );
  const handleOrdinarySettingsReady = useCallback(
    (session: OrdinaryEditorSettingsSession) => {
      ordinarySettingsSessionRef.current = session;
    },
    []
  );
  const handleToolbarReady = useCallback((session: EditorToolbarSession) => {
    toolbarSessionRef.current = session;
  }, []);
  const openMediaPicker = useCallback(
    (session: EditorDocumentSession) => {
      if (mediaOperationRef.current) {
        return mediaOperationRef.current;
      }
      const sessionError = protectedOperationError('authenticated');
      const operation = sessionError
        ? Promise.reject(sessionError)
        : openMediaPickerSession({
            document: documentPort(session, () => rootActiveRef.current),
            frame: props.mediaPickerFrame,
            strings: props.mediaPicker
          });
      mediaOperationRef.current = operation;
      void operation
        .catch((error: unknown) => {
          if (!rootActiveRef.current) {
            return;
          }
          props.onFailure(mediaPickerFailureCode(error));
          publishEditorStatus({
            id: 'media-picker',
            message: props.mediaPickerFailureMessage,
            owner: 'editor',
            type: 'error'
          });
        })
        .finally(() => {
          if (mediaOperationRef.current === operation) {
            mediaOperationRef.current = null;
          }
        });
      return operation;
    },
    [
      props.mediaPicker,
      props.mediaPickerFailureMessage,
      props.mediaPickerFrame,
      props.onFailure,
      protectedOperationError,
      publishEditorStatus
    ]
  );
  const imageUploadPort = useMemo<ImageUploadPort>(
    () => ({
      upload: (request) => {
        const sessionError = protectedOperationError('post-write');
        return sessionError
          ? Promise.resolve({ code: sessionError.message, status: 'failed' })
          : props.imageUploadPort.upload(request);
      }
    }),
    [props.imageUploadPort, protectedOperationError]
  );
  const previewPort = useMemo<PreviewRequestPort>(
    () => ({
      render: (request, signal) => {
        const sessionError = protectedOperationError('post-read');
        return sessionError
          ? Promise.reject(sessionError)
          : props.previewPort.render(request, signal);
      }
    }),
    [props.previewPort, protectedOperationError]
  );
  const revisionPort = useMemo<RevisionPort | null>(() => {
    const port = props.revisionPort;
    return port
      ? {
          get: (revisionId, signal) => {
            const sessionError = protectedOperationError('post-read');
            return sessionError
              ? Promise.reject(sessionError)
              : port.get(revisionId, signal);
          },
          list: (signal) => {
            const sessionError = protectedOperationError('post-read');
            return sessionError
              ? Promise.reject(sessionError)
              : port.list(signal);
          }
        }
      : null;
  }, [props.revisionPort, protectedOperationError]);
  const restoreRevision = useCallback(
    (restoreUrl: string) => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) throw sessionError;
      props.restoreRevision(restoreUrl);
    },
    [props.restoreRevision, protectedOperationError]
  );
  const executeRootExternalCommand = useCallback(
    (commandId: string, session: EditorDocumentSession) => {
      if (
        'image' ===
        props.toolbar.commands.find((command) => command.id === commandId)
          ?.action
      ) {
        void openMediaPicker(session);
        return true;
      }
      if (
        'copyWechat' ===
        props.toolbar.commands.find((command) => command.id === commandId)
          ?.action
      ) {
        void wechatSession.copy();
        return true;
      }
      return props.executeExternalCommand(commandId, session);
    },
    [
      openMediaPicker,
      props.executeExternalCommand,
      props.toolbar.commands,
      wechatSession
    ]
  );
  const publish = useCallback((
    draft: NativePublishDraft,
    original: NativePublishSnapshot
  ): boolean => {
    if (!documentSession)
      throw new Error('immersive-publish-session-unavailable');
    const sessionError = protectedOperationError('post-write');
    if (sessionError) return false;
    try {
      props.nativePublishPort.apply(draft);
    } catch {
      props.onFailure('immersive-publish-native-owner-unavailable');
      return false;
    }
    if (true !== props.publishPost(documentSession)) {
      try {
        props.nativePublishPort.apply(original);
      } catch {
        props.onFailure('immersive-publish-native-restore-unavailable');
        return false;
      }
      props.onFailure('immersive-publish-command-unavailable');
      return false;
    }
    return true;
  }, [
    documentSession,
    props.nativePublishPort,
    props.immersiveStrings.publishFailed,
    props.onFailure,
    props.publishPost,
    protectedOperationError
  ]);
  const selectFeaturedImage = useCallback(() => {
    if (featuredImageOperationRef.current) {
      return featuredImageOperationRef.current;
    }
    const sessionError = protectedOperationError('authenticated');
    const operation = sessionError
      ? Promise.reject(sessionError)
      : openFeaturedImagePicker(
          props.mediaPickerFrame,
          props.immersiveStrings.selectFeaturedImage
        );
    const reported = operation.catch((error: unknown) => {
      props.onFailure(
        error instanceof Error && /^featured-image-[a-z0-9-]+$/.test(error.message)
          ? error.message
          : 'featured-image-picker-failed'
      );
      return null;
    });
    featuredImageOperationRef.current = reported;
    void reported.finally(() => {
      if (featuredImageOperationRef.current === reported) {
        featuredImageOperationRef.current = null;
      }
    });
    return reported;
  }, [
    props.immersiveStrings.selectFeaturedImage,
    props.mediaPickerFrame,
    props.onFailure,
    protectedOperationError
  ]);
  const enterImmersive = useCallback(() => {
    closeForToolbar();
    toolbarSessionRef.current?.closePopovers();
    restoreImmersiveFocusRef.current = true;
    const preferences = props.immersivePreferencesPort.read();
    setImmersivePreferences(preferences);
    if ('loaded' === preferences.status) {
      setImmersiveMode(preferences.preferences.splitPreview ? 'split' : 'source');
      setLocalDraftsEnabled(preferences.preferences.autoSave);
      setScrollSyncEnabled(preferences.preferences.syncScroll);
    } else if ('missing' === preferences.status) {
      setImmersiveMode('split');
    }
    setEditorStatusState((currentState) => ({
      focused: false,
      status:
        'local-draft' === currentState.status?.owner &&
        'error' !== currentState.status.type
          ? null
          : currentState.status
    }));
    immersiveRef.current = true;
    setImmersive(true);
  }, [closeForToolbar, props.immersivePreferencesPort]);
  const exitImmersive = useCallback(() => {
    if (!prepareSourceMutation()) return;
    immersiveRef.current = false;
    setImmersive(false);
  }, [prepareSourceMutation]);
  const changeImmersiveMode = useCallback((mode: ImmersiveViewMode) => {
    if (mode === immersiveModeRef.current) return;
    if (!prepareSourceMutation()) return;
    setImmersiveMode(mode);
  }, [prepareSourceMutation]);
  const copyWechatFromImmersive = useCallback(async () => {
    return 'copied' === (await wechatSession.copy()).status;
  }, [wechatSession]);

  useEffect(() => {
    if (immersive || !restoreImmersiveFocusRef.current) return;
    restoreImmersiveFocusRef.current = false;
    immersiveToggleRef.current?.focus();
  }, [immersive]);

  useLayoutEffect(() => {
    if (!immersive || !documentSession || !rootRef.current) return;
    const releaseFocusBoundary =
      props.immersiveEnvironment.activateFocusBoundary(rootRef.current);
    documentSession.document.focus();
    return releaseFocusBoundary;
  }, [documentSession, immersive, props.immersiveEnvironment]);
  const previewFontStack = fontStack(props.fonts, fontState);
  const previewClassName = [
    'easymde-preview',
    'easymde-rendered-content',
    'easymde-code-mac',
    `easymde-markdown-theme-${appearanceState.markdownTheme}`,
    `easymde-code-theme-${appearanceState.codeTheme}`,
    visualPreviewEditing ? 'easymde-immersive-visual-editor' : '',
    'custom' === appearanceState.markdownTheme
      ? 'easymde-custom-css-active'
      : '',
    previewFontStack ? 'easymde-font-overrides' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const previewStyle = {
    ...(previewFontStack
      ? {
          '--easymde-content-font-family': previewFontStack
        }
      : {})
  } as CSSProperties;

  useEffect(() => {
    rootActiveRef.current = true;
    return () => {
      rootActiveRef.current = false;
    };
  }, []);

  useEffect(() => () => wechatSession.dispose(), [wechatSession]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    return props.sessionPort.subscribeBeforeAutosave(() => {
      if (visualPreviewEditingRef.current) {
        const runtime = visualEditorRuntimeRef.current;
        if (!runtime) throw new Error('visual-editor-runtime-unavailable');
        if (!runtime.prepareToolbarFallback()) return 'blocked';
      }
      documentSession.document.flush();
      return 'continue';
    });
  }, [documentSession, props.sessionPort]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    return props.nativeSubmissionPort.subscribeBeforeSubmit(() => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) return 'blocked';
      if (
        visualPreviewEditingRef.current
        && !prepareSourceMutation()
      ) {
        return 'blocked';
      }
      documentSession.document.flush();
      return 'continue';
    });
  }, [
    documentSession,
    prepareSourceMutation,
    props.nativeSubmissionPort,
    protectedOperationError
  ]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    const canonicalDocument = documentPort(
      documentSession,
      () => rootActiveRef.current
    );
    if (visualPreviewEditing && !visualEditorSurface) {
      return;
    }
    const visualRuntime = visualPreviewEditing
      ? visualEditorRuntimeRef.current
      : null;
    return createImageUploadSession({
      document: visualRuntime
        ? {
            applyTextChange: (change) => {
              canonicalDocument.applyTextChange(change);
              leaveVisualPreview();
            },
            focus: canonicalDocument.focus,
            getSnapshot: () => {
              if (!visualRuntime.prepareToolbarFallback()) {
                throw new Error('visual-editor-selection-map-failed');
              }
              return canonicalDocument.getSnapshot();
            }
          }
        : canonicalDocument,
      enabled: props.imageUpload.enabled,
      maxBytes: props.imageUpload.maxBytes,
      nextOperationId: nextImageUploadOperationId,
      onDiagnostic: props.onFailure,
      onStatus: setImageUploadStatus,
      postId: props.imageUpload.postId,
      strings: props.imageUpload.strings,
      target: visualEditorSurface
        ?? documentSession.document.getInputElement(),
      upload: imageUploadPort
    });
  }, [
    documentSession,
    props.imageUpload,
    imageUploadPort,
    leaveVisualPreview,
    nextImageUploadOperationId,
    props.onFailure,
    setImageUploadStatus,
    visualEditorSurface,
    visualPreviewEditing
  ]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    const session = createLocalDraftSession({
      delayMs: 500,
      document: {
        applyTextChange: documentSession.document.applyTextChange,
        focus: documentSession.document.focus,
        getValue: documentSession.document.getValue
      },
      enabled: localDraftsEnabledRef.current,
      onCandidate: setDraftCandidate,
      onDiagnostic: props.onFailure,
      onUnreadable: setDraftUnreadable,
      onStatus: setLocalDraftStatus,
      savedFingerprint: props.localDrafts.savedFingerprint,
      storage: props.localDraftStorage,
      strings: props.localDrafts.strings
    });
    localDraftSessionRef.current = session;
    const schedule = () => session.schedule();
    const unsubscribeDocument = documentSession.document.subscribe(schedule);
    session.reconcileSavedDraft();

    return () => {
      unsubscribeDocument();
      if (localDraftSessionRef.current === session) {
        localDraftSessionRef.current = null;
      }
      session.dispose();
    };
  }, [
    documentSession,
    props.localDraftStorage,
    props.localDrafts,
    props.onFailure,
    setLocalDraftStatus
  ]);

  useEffect(() => {
    localDraftSessionRef.current?.setEnabled(localDraftsEnabled);
  }, [localDraftsEnabled]);

  useEffect(() => {
    if (!documentSession) return undefined;
    const update = () =>
      setCursorPosition(documentSession.document.getCursorPosition());
    update();
    const unsubscribeDocument = documentSession.document.subscribe(update);
    const unsubscribeSelection =
      documentSession.document.subscribeSelection(update);
    return () => {
      unsubscribeDocument();
      unsubscribeSelection();
    };
  }, [documentSession]);

  useEffect(() => {
    const previewRuntime = previewRuntimeRef.current;
    if (!documentSession || !previewRuntime || !scrollSyncEnabled) {
      return;
    }
    const binding = props.scrollSyncPort.prepareBinding({
      preview: previewRuntime.surface,
      source: documentSession.document.getScrollElement()
    });
    binding.activate();
    return () => binding.dispose();
  }, [
    documentSession,
    previewRuntimeGeneration,
    props.scrollSyncPort,
    scrollSyncEnabled
  ]);

  useLayoutEffect(() => {
    const runtime = previewRuntimeRef.current;
    if (!runtime || visualPreviewEditing) return;
    const handleInput = () => schedulePreview(false);
    props.submissionField.addEventListener('input', handleInput);
    if (scheduledPreviewRuntimeRef.current !== runtime) {
      scheduledPreviewRuntimeRef.current = runtime;
      schedulePreview(true);
    }

    return () =>
      props.submissionField.removeEventListener('input', handleInput);
  }, [
    previewRuntimeGeneration,
    props.submissionField,
    schedulePreview,
    visualPreviewEditing
  ]);

  useLayoutEffect(() => {
    if (
      0 === previewRefreshRevision
      || visualPreviewEditing
      || !previewRuntimeRef.current
    ) {
      return;
    }
    setPreviewRefreshRevision(0);
    schedulePreview(true);
  }, [
    previewRefreshRevision,
    previewRuntimeGeneration,
    schedulePreview,
    visualPreviewEditing
  ]);

  return (
    <div
      ref={rootRef}
      className={`easymde-editor${immersive ? ' is-immersive' : ''}${immersive ? ` is-immersive-${immersiveMode}` : ''}`}
      data-easymde-editor-owner="react"
      data-easymde-session-status={sessionSnapshot.status}
    >
      {immersive && documentSession ? (
        <ImmersiveEditor
          documentSession={documentSession}
          environment={props.immersiveEnvironment}
          immersivePreferencesPort={props.immersivePreferencesPort}
          i18n={props.immersiveI18n}
          initialPreferences={
            'loaded' === immersivePreferences.status
              ? immersivePreferences.preferences
              : null
          }
          localDraftsEnabled={localDraftsEnabled}
          mode={immersiveMode}
          direction={props.layout.direction}
          onCopyWechat={copyWechatFromImmersive}
          onExit={exitImmersive}
          onFailure={props.onFailure}
          onLocalDraftsEnabledChange={setLocalDraftsEnabled}
          onBeforeSourceMutation={prepareSourceMutation}
          onConfirmPublish={publish}
          onSelectFeaturedImage={selectFeaturedImage}
          readPublishSnapshot={props.nativePublishPort.read}
          onScrollSyncEnabledChange={setScrollSyncEnabled}
          onViewModeChange={changeImmersiveMode}
          revisionPort={revisionPort}
          restoreRevision={restoreRevision}
          scrollSyncEnabled={scrollSyncEnabled}
          styleControls={
              <Fragment>
                <AppearanceControls
                  bootstrap={currentAppearance}
                onFailure={() =>
                  props.onFailure('react-editor-appearance-failed')
                }
                onNotification={setAppearanceNotification}
                onNotificationDismiss={dismissAppearanceNotification}
                onReady={handleAppearanceReady}
                port={appearancePort}
                immersiveLabel={props.immersiveStrings.theme}
                immersiveTitle={props.immersiveStrings.themeSettings}
                variant="immersive"
              />
              <FontControls
                bootstrap={currentFonts}
                onFailure={() => props.onFailure('react-editor-fonts-failed')}
                onReady={handleFontControlsReady}
                port={fontControlsPort}
                variant="immersive"
              />
            </Fragment>
          }
          toolbar={
            <div
              className="easymde-toolbar"
              role="toolbar"
              aria-label={props.labels.toolbar}
            >
              <div className="easymde-toolbar-section easymde-toolbar-section-main">
                <ActiveToolbar
                  editorRoot={rootRef.current as HTMLElement}
                  {...(visualPreviewEditing
                    ? {
                        executeVisualCommand: (command: ToolbarCommand) => {
                          const runtime = visualEditorRuntimeRef.current;
                          if (!runtime) {
                            throw new Error(
                              'visual-editor-runtime-unavailable'
                            );
                          }
                          if (runtime.executeCommand(command)) return true;
                          if (!runtime.prepareToolbarFallback()) return true;
                          leaveVisualPreview();
                          return false;
                        }
                      }
                    : {})}
                  executeExternalCommand={executeRootExternalCommand}
                  platform={props.platform}
                  prepareToolbarShortcuts={props.prepareToolbarShortcuts}
                  onPopoverOpen={closeForToolbar}
                  onReady={handleToolbarReady}
                  session={documentSession}
                  toolbar={props.toolbar}
                  variant="immersive"
                />
              </div>
            </div>
          }
          strings={props.immersiveStrings}
        />
      ) : null}
      {!immersive ? (
        <div
          className="easymde-toolbar"
          role="toolbar"
          aria-label={props.labels.toolbar}
        >
          <div className="easymde-toolbar-section easymde-toolbar-section-main">
            {documentSession && rootRef.current ? (
              <Fragment>
                <ActiveToolbar
                  editorRoot={rootRef.current}
                  executeExternalCommand={executeRootExternalCommand}
                  platform={props.platform}
                  prepareToolbarShortcuts={props.prepareToolbarShortcuts}
                  onPopoverOpen={closeForToolbar}
                  onReady={handleToolbarReady}
                  session={documentSession}
                  toolbar={props.toolbar}
                />
              </Fragment>
            ) : null}
          </div>
          <div className="easymde-toolbar-section easymde-toolbar-section-secondary">
            {documentSession ? (
              <RootExportCommands
                executeCommand={(commandId) =>
                  executeRootExternalCommand(commandId, documentSession)
                }
                platform={props.platform}
                toolbar={props.toolbar}
              />
            ) : null}
            <button
              ref={immersiveToggleRef}
              type="button"
              className="easymde-toolbar-button easymde-toolbar-button-compact easymde-toolbar-immersive-toggle"
              aria-label={props.immersiveStrings.enter}
              aria-pressed="false"
              title={props.immersiveStrings.enter}
              onMouseDown={(event) => event.preventDefault()}
              onClick={enterImmersive}
            >
              <ImmersiveToggleIcon />
            </button>
            <OrdinaryEditorSettings
              appearance={currentAppearance}
              appearancePort={appearancePort}
              fonts={currentFonts}
              fontControlsPort={fontControlsPort}
              label={props.immersiveStrings.editorSettings}
              onAppearanceReady={handleAppearanceReady}
              onFailure={props.onFailure}
              onNotification={setAppearanceNotification}
              onNotificationDismiss={dismissAppearanceNotification}
              onFontControlsReady={handleFontControlsReady}
              onOpen={() => {
                toolbarSessionRef.current?.closePopovers();
                props.appearancePort.closeOtherPopovers();
                props.fontControlsPort.closeOtherPopovers();
              }}
              onReady={handleOrdinarySettingsReady}
            />
          </div>
        </div>
      ) : null}
      {editorStatus ? (
        <div className="easymde-editor-message-alert-host">
          <EditorMessageAlert
            closeLabel={props.immersiveStrings.close}
            message={editorStatus.message}
            onDismiss={() => {
              setEditorStatusState((currentState) => ({
                focused: false,
                status:
                  currentState.status === editorStatus
                    ? null
                    : currentState.status
              }));
            }}
            onFocusChange={(focused) => {
              setEditorStatusState((currentState) =>
                currentState.focused === focused
                  ? currentState
                  : { ...currentState, focused }
              );
            }}
            type={editorStatus.type}
          />
        </div>
      ) : null}
      {!immersive && draftCandidate ? (
        <div className="easymde-draft-notice">
          <span>{props.localDrafts.strings.available}</span>
          <button
            type="button"
            className="button button-small"
            onClick={() => localDraftSessionRef.current?.restore()}
          >
            {props.localDrafts.strings.restore}
          </button>
          <button
            type="button"
            className="button button-small"
            onClick={() => localDraftSessionRef.current?.discard()}
          >
            {props.localDrafts.strings.discard}
          </button>
        </div>
      ) : null}
      {!immersive && draftUnreadable ? (
        <div className="easymde-draft-notice">
          <button
            type="button"
            className="button button-small"
            onClick={() => localDraftSessionRef.current?.discard()}
          >
            {props.localDrafts.strings.discard}
          </button>
        </div>
      ) : null}
      <EditorWorkspace
        direction={props.layout.direction}
        {...(!immersive && documentSession
          ? {
              ordinaryStatus: {
                document: documentSession.document,
                lastEdited: props.layout.status.lastEdited,
                locale: props.localDrafts.locale,
                wordCountTemplate: props.layout.status.wordCount
              }
            }
          : {})}
        splitResizable={immersive && 'split' === immersiveMode}
        splitResizeLabel={props.immersiveStrings.resizeSplit}
        source={
          <section
            className="easymde-pane easymde-pane-source"
            data-easymde-document-owner="react"
          >
            {immersive ? (
              <header className="easymde-pane-header">
                <span>{props.immersiveStrings.markdown.toUpperCase()}</span>
                <span
                  className="easymde-immersive-more-actions"
                  aria-hidden="true"
                  title={props.immersiveStrings.moreActions}
                >
                  <MoreHorizontal size={14} strokeWidth={2} />
                </span>
              </header>
            ) : null}
            <div className="easymde-source easymde-source-react">
              <EditorDocumentSource
                editorLabel={props.document.editorLabel}
                onReady={handleDocumentReady}
                submissionField={props.submissionField}
                titleField={props.titleField}
              />
            </div>
            {immersive ? (
              <footer className="easymde-immersive-statusbar">
                <span>
                  {`${props.immersiveStrings.line} ${cursorPosition.line}, ${props.immersiveStrings.column} ${cursorPosition.column}`}
                </span>
                <span>
                  {props.immersiveStrings.markdown}
                  {localDraftsEnabled ? (
                    <span className="easymde-immersive-autosave-state">
                      <span aria-hidden="true" />
                      {props.immersiveStrings.autoSaveEnabled}
                    </span>
                  ) : null}
                </span>
              </footer>
            ) : null}
          </section>
        }
        preview={
          <ImmersivePreviewSurface
            active={immersive && 'preview' === immersiveMode}
            canEdit={
              'ready' === previewSurfaceStatus
              && null !== visualPreviewSnapshot
              && null !== documentSession
            }
            changed={visualPreviewChanged}
            editable={visualPreviewEditing}
            hasSnapshot={null !== visualPreviewSnapshot}
            ordinaryLabel={immersive ? props.labels.preview : null}
            onToggleEditable={() => {
              if (visualPreviewEditing) {
                prepareSourceMutation();
                return;
              }
              if (!visualPreviewSnapshot || !documentSession) return;
              setPreviewSurfaceStatus('ready');
              setVisualPreviewChanged(false);
              setVisualPreviewPending(false);
              setVisualPreviewEditing(true);
            }}
            status={previewSurfaceStatus}
            statusMessages={{
              empty: props.preview.messages.empty,
              error: props.preview.messages.error
            }}
            strings={props.immersiveStrings}
          >
            <PreviewSurfaceOwner
              className={previewClassName}
              emptyMode={
                immersive && 'preview' === immersiveMode
                  ? 'paper'
                  : 'message'
              }
              enhancementPort={props.enhancementPort}
              initial={{
                codeTheme: props.appearance.state.codeTheme,
                features: props.preview.features,
                html: props.preview.html,
                signature: props.preview.signature
              }}
              initialRevision={0}
              messages={props.preview.messages}
              onDiagnostic={props.onFailure}
              onDispose={handlePreviewDispose}
              onReady={handlePreviewReady}
              onSnapshotReady={handlePreviewSnapshotReady}
              onStatusChange={handlePreviewStatusChange}
              port={previewPort}
              scrollPort={props.scrollPort}
              style={previewStyle}
              {...(visualPreviewEditing
                ? {
                    contentEditable: !visualPreviewPending,
                    label: props.immersiveStrings.previewEditorLabel,
                    role: 'textbox',
                    spellCheck: true
                  }
                : {})}
            />
            {visualPreviewEditing
            && visualPreviewSnapshot
            && documentSession
            && previewRuntimeRef.current ? (
              <ImmersiveVisualEditor
                documentSession={documentSession}
                imageUploadEnabled={props.imageUpload.enabled}
                onCanonicalDocumentChange={
                  handleVisualCanonicalDocumentChange
                }
                onDiagnostic={props.onFailure}
                onDispose={handleVisualEditorDispose}
                onFailure={handleVisualFailure}
                onMarkdownChange={handleVisualMarkdownChange}
                onPendingChange={handleVisualPendingChange}
                onReady={handleVisualEditorReady}
                onTransferFailure={handleVisualTransferFailure}
                pending={visualPreviewPending}
                previewSnapshot={visualPreviewSnapshot}
                previewStatus={previewSurfaceStatus}
                requestPreview={handleVisualPreviewRequest}
                surface={previewRuntimeRef.current.surface}
              />
            ) : null}
          </ImmersivePreviewSurface>
        }
      />
    </div>
  );
}
