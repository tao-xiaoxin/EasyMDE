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
import type { ToolbarBootstrap } from '../../contracts/bootstrap/toolbar-bootstrap';
import type { WechatExportBootstrap } from '../../contracts/bootstrap/wechat-export-bootstrap';
import type { AppearancePort } from '../../contracts/ports/appearance-port';
import type { FontControlsPort } from '../../contracts/ports/font-controls-port';
import type { ImageUploadPort } from '../../contracts/ports/image-upload-port';
import type { ImmersiveEnvironmentPort } from '../../contracts/ports/immersive-environment-port';
import {
  protectedEditorOperationError,
  type EditorSessionOperation,
  type EditorSessionPort
} from '../../contracts/ports/editor-session-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type { NativeSubmissionPort } from '../../contracts/ports/native-submission-port';
import type {
  MediaPickerDocumentPort,
  MediaPickerFramePort
} from '../../contracts/ports/media-picker-port';
import type {
  PreviewRequest,
  PreviewRequestPort
} from '../../contracts/ports/preview-request';
import type { RevisionPort } from '../../contracts/ports/revision-port';
import type { ScrollSyncPort } from '../../contracts/ports/scroll-sync-port';
import type { ToolbarShortcutsPort } from '../../contracts/ports/toolbar-shortcuts-port';
import type { WechatClipboardPort } from '../../contracts/ports/wechat-clipboard-port';
import {
  AppearanceControls,
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
  createImageUploadSession,
  type ImageUploadStatus
} from '../../features/image-upload/image-upload-session';
import { EditorWorkspace } from '../../features/editor-layout/ui/EditorWorkspace';
import { useEditorSession } from '../../features/editor-session/use-editor-session';
import type { PreviewEnhancementPort } from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../../features/live-preview/ports/preview-scroll-port';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceRuntime
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { openMediaPickerSession } from '../../features/media-picker/media-picker-session';
import {
  createLocalDraftSession,
  type LocalDraftSession
} from '../../features/local-drafts/local-draft-session';
import { createToolbarCommandSession } from '../../features/toolbar/toolbar-command-session';
import {
  EditorToolbar,
  type EditorToolbarSession,
  type ToolbarPlatform
} from '../../features/toolbar/ui/EditorToolbar';
import { createWechatExportSession } from '../../features/wechat-export/wechat-export-session';
import {
  ImmersiveEditor,
  ImmersiveToggleIcon
} from '../../features/immersive-editor/ui/ImmersiveEditor';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';

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
  executeExternalCommand: EditorRootProps['executeExternalCommand'];
  platform: ToolbarPlatform;
  prepareToolbarShortcuts: EditorRootProps['prepareToolbarShortcuts'];
  onPopoverOpen: () => void;
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
  executeExternalCommand,
  platform,
  prepareToolbarShortcuts,
  onPopoverOpen,
  onReady,
  session,
  toolbar,
  variant = 'default'
}: ActiveToolbarProps) {
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
      if (commandSession.owns(commandId)) {
        commandSession.execute(commandId);
        return;
      }
      executeExternalCommand(commandId, session);
    },
    [commandSession, executeExternalCommand, session]
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

  return (
    <EditorToolbar
      bootstrap={toolbar}
      platform={platform}
      executeCommand={executeCommand}
      onPopoverOpen={onPopoverOpen}
      onReady={onReady}
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
  const toolbarSessionRef = useRef<EditorToolbarSession | null>(null);
  const previewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const previewRevisionRef = useRef(0);
  const previewAppearanceRef = useRef(props.appearance.state);
  const localDraftSessionRef = useRef<LocalDraftSession | null>(null);
  const mediaOperationRef = useRef<Promise<unknown> | null>(null);
  const rootActiveRef = useRef(true);
  const initialSubmissionStateRef = useRef({
    ...props.appearance.state,
    ...props.fonts.state
  });
  const submissionStateRef = useRef(initialSubmissionStateRef.current);
  const [documentSession, setDocumentSession] =
    useState<EditorDocumentSession | null>(null);
  const [draftCandidate, setDraftCandidate] = useState(false);
  const [draftUnreadable, setDraftUnreadable] = useState(false);
  const [editorStatus, setEditorStatus] = useState<ImageUploadStatus | null>(
    null
  );
  const [previewRuntimeReady, setPreviewRuntimeReady] = useState(false);
  const [appearanceState, setAppearanceState] = useState(
    props.appearance.state
  );
  const [fontState, setFontState] = useState(props.fonts.state);
  const [immersive, setImmersive] = useState(false);
  const [immersiveMode, setImmersiveMode] =
    useState<ImmersiveViewMode>('source');
  const sessionSnapshot = useEditorSession(props.sessionPort);
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
        getPreview: () => previewRuntimeRef.current?.surface ?? null,
        onDiagnostic: props.onFailure,
        onStatus: setEditorStatus,
        strings: props.wechatExport.strings
      }),
    [props.onFailure, props.wechatClipboard, props.wechatExport]
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
  const handlePreviewReady = useCallback((runtime: PreviewSurfaceRuntime) => {
    previewRuntimeRef.current = runtime;
    setPreviewRuntimeReady(true);
  }, []);
  const closeForToolbar = useCallback(() => {
    appearanceSessionRef.current?.close();
    fontControlsSessionRef.current?.close();
  }, []);
  const schedulePreview = useCallback(
    (immediate = false) => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) {
        throw new Error('preview-runtime-unavailable');
      }
      const revision = ++previewRevisionRef.current;
      runtime.session.schedule(
        previewRequest(
          props.submissionField.value,
          props.preview,
          previewAppearanceRef.current,
          revision
        ),
        immediate
      );
    },
    [props.preview, props.submissionField]
  );
  const appearancePort = useMemo<AppearancePort>(
    () => ({
      applyState: (state) => {
        props.appearancePort.applyState(state);
        setAppearanceState(state);
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
        previewAppearanceRef.current = state;
        const defaults = props.appearance.articleThemes.find(
          ({ id }) => id === state.markdownTheme
        )?.fontDefaults;
        if (defaults) {
          fontControlsSessionRef.current?.replaceState(defaults);
        }
        schedulePreview(true);
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        fontControlsSessionRef.current?.close();
        props.appearancePort.closeOtherPopovers();
      },
      saveCustomCss: async (input) => {
        const sessionError = protectedOperationError('authenticated');
        if (sessionError) throw sessionError;
        const result = await props.appearancePort.saveCustomCss(input);
        if ('saved' === result.status) {
          props.appearancePort.applyState(result.snapshot.state);
          setAppearanceState(result.snapshot.state);
          submissionStateRef.current = {
            ...submissionStateRef.current,
            ...result.snapshot.state
          };
          documentSession?.replaceSubmissionState(submissionStateRef.current);
          previewAppearanceRef.current = result.snapshot.state;
          schedulePreview(true);
        }
        return result;
      }
    }),
    [
      documentSession,
      props.appearance.articleThemes,
      props.appearancePort,
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
          setEditorStatus({
            message: props.mediaPickerFailureMessage,
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
      protectedOperationError
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
  const publish = useCallback(() => {
    if (!documentSession)
      throw new Error('immersive-publish-session-unavailable');
    const sessionError = protectedOperationError('post-write');
    if (sessionError) return;
    if (true !== props.publishPost(documentSession)) {
      props.onFailure('immersive-publish-command-unavailable');
    }
  }, [
    documentSession,
    props.onFailure,
    props.publishPost,
    protectedOperationError
  ]);
  const enterImmersive = useCallback(() => {
    closeForToolbar();
    toolbarSessionRef.current?.closePopovers();
    restoreImmersiveFocusRef.current = true;
    setImmersiveMode('source');
    setImmersive(true);
  }, [closeForToolbar]);
  const exitImmersive = useCallback(() => setImmersive(false), []);

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
    'custom' === appearanceState.markdownTheme
      ? 'easymde-custom-css-active'
      : '',
    previewFontStack ? 'easymde-font-overrides' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const previewStyle = (
    previewFontStack
      ? {
          '--easymde-content-font-family': previewFontStack
        }
      : {}
  ) as CSSProperties;

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
    return props.nativeSubmissionPort.subscribeBeforeSubmit(() => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) return 'blocked';
      documentSession.document.flush();
      return 'continue';
    });
  }, [documentSession, props.nativeSubmissionPort, protectedOperationError]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    return createImageUploadSession({
      document: documentPort(documentSession, () => rootActiveRef.current),
      enabled: props.imageUpload.enabled,
      maxBytes: props.imageUpload.maxBytes,
      onDiagnostic: props.onFailure,
      onStatus: setEditorStatus,
      postId: props.imageUpload.postId,
      strings: props.imageUpload.strings,
      target: documentSession.document.getInputElement(),
      upload: imageUploadPort
    });
  }, [documentSession, props.imageUpload, imageUploadPort, props.onFailure]);

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
      enabled: props.localDrafts.enabled,
      onCandidate: setDraftCandidate,
      onDiagnostic: props.onFailure,
      onUnreadable: setDraftUnreadable,
      onStatus: setEditorStatus,
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
    props.onFailure
  ]);

  useEffect(() => {
    const previewRuntime = previewRuntimeRef.current;
    if (!documentSession || !previewRuntime) {
      return;
    }
    const binding = props.scrollSyncPort.prepareBinding({
      preview: previewRuntime.surface,
      source: documentSession.document.getScrollElement()
    });
    binding.activate();
    return () => binding.dispose();
  }, [documentSession, previewRuntimeReady, props.scrollSyncPort]);

  useLayoutEffect(() => {
    if (!previewRuntimeRef.current) return;
    const handleInput = () => schedulePreview(false);
    props.submissionField.addEventListener('input', handleInput);
    schedulePreview(true);

    return () =>
      props.submissionField.removeEventListener('input', handleInput);
  }, [props.submissionField, schedulePreview]);

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
          onCopyWechat={() => void wechatSession.copy()}
          onExit={exitImmersive}
          onFailure={props.onFailure}
          onPublish={publish}
          onViewModeChange={setImmersiveMode}
          revisionPort={revisionPort}
          restoreRevision={restoreRevision}
          styleControls={
            <Fragment>
              <AppearanceControls
                bootstrap={props.appearance}
                onFailure={() =>
                  props.onFailure('react-editor-appearance-failed')
                }
                onReady={handleAppearanceReady}
                port={appearancePort}
                variant="immersive"
              />
              <FontControls
                bootstrap={props.fonts}
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
            <FontControls
              bootstrap={props.fonts}
              onFailure={() => props.onFailure('react-editor-fonts-failed')}
              onReady={handleFontControlsReady}
              port={fontControlsPort}
            />
            <AppearanceControls
              bootstrap={props.appearance}
              onFailure={() =>
                props.onFailure('react-editor-appearance-failed')
              }
              onReady={handleAppearanceReady}
              port={appearancePort}
            />
            <button
              ref={immersiveToggleRef}
              type="button"
              className="easymde-toolbar-button easymde-toolbar-button-compact easymde-immersive-toggle"
              aria-label={props.immersiveStrings.immersive}
              title={props.immersiveStrings.immersive}
              onClick={enterImmersive}
            >
              <ImmersiveToggleIcon />
            </button>
          </div>
        </div>
      ) : null}
      {editorStatus ? (
        <div
          className={`easymde-editor-flash is-${editorStatus.type}`}
          aria-live="polite"
        >
          {editorStatus.message}
        </div>
      ) : null}
      {draftCandidate ? (
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
      {draftUnreadable ? (
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
        source={
          <section
            className="easymde-pane easymde-pane-source"
            data-easymde-document-owner="react"
          >
            <header className="easymde-pane-header">
              {props.labels.source}
            </header>
            <div className="easymde-source easymde-source-react">
              <EditorDocumentSource
                editorLabel={props.document.editorLabel}
                onReady={handleDocumentReady}
                submissionField={props.submissionField}
                titleField={props.titleField}
              />
            </div>
          </section>
        }
        preview={
          <section className="easymde-pane easymde-pane-preview">
            <header className="easymde-pane-header">
              {props.labels.preview}
            </header>
            <PreviewSurfaceOwner
              className={previewClassName}
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
              onReady={handlePreviewReady}
              port={previewPort}
              scrollPort={props.scrollPort}
              style={previewStyle}
            />
          </section>
        }
      />
    </div>
  );
}
