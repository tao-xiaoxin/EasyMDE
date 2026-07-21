import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type { DocumentSourceBootstrap } from '../../contracts/bootstrap/document-source-bootstrap';
import type { EditorRootPreviewBootstrap } from '../../contracts/bootstrap/editor-root-bootstrap';
import type {
  AppearanceBootstrap,
  AppearanceState
} from '../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../contracts/bootstrap/font-controls-bootstrap';
import type { ImageUploadBootstrap } from '../../contracts/bootstrap/image-upload-bootstrap';
import type { MediaPickerBootstrap } from '../../contracts/bootstrap/media-picker-bootstrap';
import type { ToolbarBootstrap } from '../../contracts/bootstrap/toolbar-bootstrap';
import type { AppearancePort } from '../../contracts/ports/appearance-port';
import type { FontControlsPort } from '../../contracts/ports/font-controls-port';
import type { ImageUploadPort } from '../../contracts/ports/image-upload-port';
import type {
  MediaPickerDocumentPort,
  MediaPickerFramePort
} from '../../contracts/ports/media-picker-port';
import type { PreviewRequest, PreviewRequestPort } from '../../contracts/ports/preview-request';
import type { ToolbarShortcutsPort } from '../../contracts/ports/toolbar-shortcuts-port';
import {
  AppearanceControls,
  type AppearanceControlsSession
} from '../../features/appearance/ui/AppearanceControls';
import { EditorDocumentSource, type EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import {
  FontControls,
  type FontControlsSession
} from '../../features/font-controls/ui/FontControls';
import {
  createImageUploadSession,
  type ImageUploadStatus
} from '../../features/image-upload/image-upload-session';
import type { PreviewEnhancementPort } from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../../features/live-preview/ports/preview-scroll-port';
import { PreviewSurfaceOwner, type PreviewSurfaceRuntime } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { openMediaPickerSession } from '../../features/media-picker/media-picker-session';
import { createToolbarCommandSession } from '../../features/toolbar/toolbar-command-session';
import {
  EditorToolbar,
  type EditorToolbarSession,
  type ToolbarPlatform
} from '../../features/toolbar/ui/EditorToolbar';

export type EditorRootProps = Readonly<{
  appearance: AppearanceBootstrap;
  appearancePort: AppearancePort;
  document: DocumentSourceBootstrap;
  enhancementPort: PreviewEnhancementPort;
  executeExternalCommand: (commandId: string, session: EditorDocumentSession) => unknown;
  fontControlsPort: FontControlsPort;
  fonts: FontControlsBootstrap;
  imageUpload: Pick<ImageUploadBootstrap, 'enabled' | 'maxBytes' | 'postId' | 'strings'>;
  imageUploadPort: ImageUploadPort;
  labels: Readonly<{
    preview: string;
    source: string;
    toolbar: string;
  }>;
  mediaPicker: MediaPickerBootstrap;
  mediaPickerFailureMessage: string;
  mediaPickerFrame: MediaPickerFramePort | null;
  onFailure: (code: string) => void;
  platform: ToolbarPlatform;
  prepareToolbarShortcuts: (surfaces: Readonly<{
    editorRoot: HTMLElement;
    source: HTMLElement;
  }>) => ToolbarShortcutsPort;
  preview: EditorRootPreviewBootstrap;
  previewPort: PreviewRequestPort;
  scrollPort: PreviewScrollPort;
  submissionField: HTMLTextAreaElement;
  titleField: HTMLInputElement;
  toolbar: ToolbarBootstrap;
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
}>;

function ActiveToolbar({
  editorRoot,
  executeExternalCommand,
  platform,
  prepareToolbarShortcuts,
  onPopoverOpen,
  onReady,
  session,
  toolbar
}: ActiveToolbarProps) {
  const commandSessionRef = useRef<ReturnType<typeof createToolbarCommandSession> | null>(null);
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
      executeExternalCommand: (commandId) => executeExternalCommand(commandId, session),
      linkText: toolbar.linkText
    });
  }
  const commandSession = commandSessionRef.current;
  const executeCommand = useCallback((commandId: string) => {
    if (commandSession.owns(commandId)) {
      commandSession.execute(commandId);
      return;
    }
    executeExternalCommand(commandId, session);
  }, [commandSession, executeExternalCommand, session]);

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
  return error instanceof Error && /^media-picker-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : 'media-picker-operation-failed';
}

export function EditorRoot(props: EditorRootProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const appearanceSessionRef = useRef<AppearanceControlsSession | null>(null);
  const fontControlsSessionRef = useRef<FontControlsSession | null>(null);
  const toolbarSessionRef = useRef<EditorToolbarSession | null>(null);
  const previewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const previewRevisionRef = useRef(0);
  const previewAppearanceRef = useRef(props.appearance.state);
  const mediaOperationRef = useRef<Promise<unknown> | null>(null);
  const rootActiveRef = useRef(true);
  const [documentSession, setDocumentSession] = useState<EditorDocumentSession | null>(null);
  const [editorStatus, setEditorStatus] = useState<ImageUploadStatus | null>(null);
  const [, setPreviewRuntimeReady] = useState(false);

  const handleDocumentReady = useCallback((session: EditorDocumentSession) => {
    setDocumentSession(session);
  }, []);
  const handlePreviewReady = useCallback((runtime: PreviewSurfaceRuntime) => {
    previewRuntimeRef.current = runtime;
    setPreviewRuntimeReady(true);
  }, []);
  const closeForToolbar = useCallback(() => {
    appearanceSessionRef.current?.close();
    fontControlsSessionRef.current?.close();
  }, []);
  const schedulePreview = useCallback((immediate = false) => {
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
  }, [props.preview, props.submissionField]);
  const appearancePort = useMemo<AppearancePort>(() => ({
    applyState: (state) => {
      props.appearancePort.applyState(state);
      previewAppearanceRef.current = state;
      schedulePreview(true);
    },
    closeOtherPopovers: () => {
      toolbarSessionRef.current?.closePopovers();
      fontControlsSessionRef.current?.close();
      props.appearancePort.closeOtherPopovers();
    },
    saveCustomCss: async (input) => {
      const result = await props.appearancePort.saveCustomCss(input);
      if ('saved' === result.status) {
        previewAppearanceRef.current = result.snapshot.state;
        schedulePreview(true);
      }
      return result;
    }
  }), [props.appearancePort, schedulePreview]);
  const fontControlsPort = useMemo<FontControlsPort>(() => ({
    applyState: (state) => props.fontControlsPort.applyState(state),
    closeOtherPopovers: () => {
      toolbarSessionRef.current?.closePopovers();
      appearanceSessionRef.current?.close();
      props.fontControlsPort.closeOtherPopovers();
    }
  }), [props.fontControlsPort]);
  const handleAppearanceReady = useCallback((session: AppearanceControlsSession) => {
    appearanceSessionRef.current = session;
  }, []);
  const handleFontControlsReady = useCallback((session: FontControlsSession) => {
    fontControlsSessionRef.current = session;
  }, []);
  const handleToolbarReady = useCallback((session: EditorToolbarSession) => {
    toolbarSessionRef.current = session;
  }, []);
  const openMediaPicker = useCallback((session: EditorDocumentSession) => {
    if (mediaOperationRef.current) {
      return mediaOperationRef.current;
    }
    const operation = openMediaPickerSession({
      document: documentPort(session, () => rootActiveRef.current),
      frame: props.mediaPickerFrame,
      strings: props.mediaPicker
    });
    mediaOperationRef.current = operation;
    void operation.catch((error: unknown) => {
      if (!rootActiveRef.current) {
        return;
      }
      props.onFailure(mediaPickerFailureCode(error));
      setEditorStatus({ message: props.mediaPickerFailureMessage, type: 'error' });
    }).finally(() => {
      if (mediaOperationRef.current === operation) {
        mediaOperationRef.current = null;
      }
    });
    return operation;
  }, [props.mediaPicker, props.mediaPickerFailureMessage, props.mediaPickerFrame, props.onFailure]);
  const executeRootExternalCommand = useCallback((
    commandId: string,
    session: EditorDocumentSession
  ) => {
    if ('image' === props.toolbar.commands.find((command) => command.id === commandId)?.action) {
      void openMediaPicker(session);
      return true;
    }
    return props.executeExternalCommand(commandId, session);
  }, [openMediaPicker, props.executeExternalCommand, props.toolbar.commands]);

  useEffect(() => {
    rootActiveRef.current = true;
    return () => {
      rootActiveRef.current = false;
    };
  }, []);

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
      upload: props.imageUploadPort
    });
  }, [documentSession, props.imageUpload, props.imageUploadPort, props.onFailure]);

  useLayoutEffect(() => {
    if (!previewRuntimeRef.current) return;
    const handleInput = () => schedulePreview(false);
    props.submissionField.addEventListener('input', handleInput);
    schedulePreview(true);

    return () => props.submissionField.removeEventListener('input', handleInput);
  }, [props.submissionField, schedulePreview]);

  return (
    <div
      ref={rootRef}
      className="easymde-editor"
      data-easymde-editor-owner="react"
    >
      <div className="easymde-toolbar" role="toolbar" aria-label={props.labels.toolbar}>
        <div className="easymde-toolbar-section easymde-toolbar-section-main">
          {documentSession && rootRef.current ? (
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
          ) : null}
        </div>
        <div className="easymde-toolbar-section easymde-toolbar-section-secondary">
          <AppearanceControls
            bootstrap={props.appearance}
            onFailure={() => props.onFailure('react-editor-appearance-failed')}
            onReady={handleAppearanceReady}
            port={appearancePort}
          />
          <FontControls
            bootstrap={props.fonts}
            onFailure={() => props.onFailure('react-editor-fonts-failed')}
            onReady={handleFontControlsReady}
            port={fontControlsPort}
          />
        </div>
      </div>
      {editorStatus ? (
        <div
          className={`easymde-editor-flash is-${editorStatus.type}`}
          aria-live="polite"
        >
          {editorStatus.message}
        </div>
      ) : null}
      <div className="easymde-workspace">
        <section className="easymde-pane easymde-pane-source" data-easymde-document-owner="react">
          <header className="easymde-pane-header">{props.labels.source}</header>
          <div className="easymde-source easymde-source-react">
            <EditorDocumentSource
              editorLabel={props.document.editorLabel}
              onReady={handleDocumentReady}
              submissionField={props.submissionField}
              titleField={props.titleField}
            />
          </div>
        </section>
        <section className="easymde-pane easymde-pane-preview">
          <header className="easymde-pane-header">{props.labels.preview}</header>
          <PreviewSurfaceOwner
            enhancementPort={props.enhancementPort}
            initial={{
              features: props.preview.features,
              html: props.preview.html,
              signature: props.preview.signature
            }}
            initialRevision={0}
            messages={props.preview.messages}
            onReady={handlePreviewReady}
            port={props.previewPort}
            scrollPort={props.scrollPort}
          />
        </section>
      </div>
    </div>
  );
}
