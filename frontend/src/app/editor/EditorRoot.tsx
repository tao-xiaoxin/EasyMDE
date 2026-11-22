import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useRef
} from '@wordpress/element';

import {
  AppearanceControls,
  type AppearanceControlsSession
} from '../../features/appearance/ui/AppearanceControls';
import { EditorDocumentSource } from '../../features/document-source/ui/EditorDocumentSource';
import { EditorContextMenuFeature } from '../../features/editor-context-menu/EditorContextMenuFeature';
import { EditorTableDialog } from '../../features/editor-context-menu/ui/EditorTableDialog';
import { EditorWorkspace } from '../../features/editor-layout/ui/EditorWorkspace';
import {
  OrdinaryEditorSettings,
  type OrdinaryEditorSettingsSession
} from '../../features/editor-settings/ui/OrdinaryEditorSettings';
import {
  FontControls,
  type FontControlsSession
} from '../../features/font-controls/ui/FontControls';
import {
  ImmersiveEditor,
  ImmersiveToggleIcon
} from '../../features/immersive-editor/ui/ImmersiveEditor';
import { ImmersivePreviewSurface } from '../../features/immersive-editor/ui/ImmersivePreviewSurface';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceRuntime
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { WordPressMediaPickerDialog } from '../../features/media-picker/ui/WordPressMediaPickerDialog';
import type { EditorToolbarSession } from '../../features/toolbar/ui/EditorToolbar';
import { MoreHorizontal } from '../../generated/lucide-icons';
import { formatKeyboardShortcut } from '../../shared/keyboard/keyboard-shortcut';
import { EditorMessageAlert } from '../../shared/ui/EditorMessageAlert';
import { ActiveToolbar, RootExportCommands } from './EditorRootToolbar';
import { ImmersiveVisualEditorHost } from './ImmersiveVisualEditorHost';
import { supportsEditorRichClipboard } from './editor-context-menu-helpers';
import type {
  CodeThemePreparation,
  EditorRootProps,
  ImmersiveVisualEditorRuntime
} from './editor-root-types';
import { useEditorAppearanceBridge } from './use-editor-appearance-bridge';
import { useEditorContextMenuBridge } from './use-editor-context-menu-bridge';
import { useEditorMediaUploadBridge } from './use-editor-media-upload-bridge';
import { useEditorSessionAndFormBridge } from './use-editor-session-and-form-bridge';
import { useEditorVisualPreviewBridge } from './use-editor-visual-preview-bridge';

export {
  focusVisualPreviewRuntime,
  isVisualPreviewWindowRequestCurrent,
  schedulePreviewWithDocumentEndPin,
  scheduleVisualWindowedHistoryBranchRelease,
  visualPreviewSourceHasEditableMap,
  visualPreviewSurfaceUsesWindowedOwner,
  visualPreviewSurfaceWindowedForVisibility,
  visualPreviewUsesWindowedOwner
} from './editor-root-helpers';
export type { EditorRootProps } from './editor-root-types';

export function EditorRoot(props: EditorRootProps) {
  const failureHandlerRef = useRef(props.onFailure);
  failureHandlerRef.current = props.onFailure;
  const reportFailure = useCallback(
    (code: string) => failureHandlerRef.current(code),
    []
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const rootActiveRef = useRef(true);
  useEffect(() => {
    rootActiveRef.current = true;
    return () => {
      rootActiveRef.current = false;
    };
  }, []);

  // Shared cross-bridge refs for runtime coordination without circular hooks.
  const previewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const visualEditorRuntimeRef = useRef<ImmersiveVisualEditorRuntime | null>(
    null
  );
  const visualPreviewEditingRef = useRef(false);
  const visualPreviewWindowRequestedRef = useRef(false);
  const previewAppearanceRef = useRef(props.appearance.state);
  const previewRefreshPendingRef = useRef(false);
  const codeThemePreparationRef = useRef<CodeThemePreparation | null>(null);
  const codeThemePreparationGenerationRef = useRef(0);
  const immersiveRef = useRef(false);
  const prepareSourceMutationRef = useRef<() => boolean>(() => true);
  const cancelVisualUnlockPreparationRef = useRef<() => void>(() => undefined);
  const releasePendingContextResourcesRef = useRef<
    (reason?: 'cancelled' | 'unavailable') => void
  >(() => undefined);

  const contextMenuReadinessListenersRef = useRef(new Set<() => void>());
  const subscribeContextMenuReadiness = useCallback(
    (listener: () => void): (() => void) => {
      contextMenuReadinessListenersRef.current.add(listener);
      return () => contextMenuReadinessListenersRef.current.delete(listener);
    },
    []
  );
  const notifyContextMenuReadiness = useCallback(() => {
    for (const listener of contextMenuReadinessListenersRef.current) listener();
  }, []);

  // Popover and toolbar session coordination refs.
  const appearanceSessionRef = useRef<AppearanceControlsSession | null>(null);
  const fontControlsSessionRef = useRef<FontControlsSession | null>(null);
  const ordinarySettingsSessionRef =
    useRef<OrdinaryEditorSettingsSession | null>(null);
  const toolbarSessionRef = useRef<EditorToolbarSession | null>(null);
  const contextMenuExecutorRef = useRef<((commandId: string) => void) | null>(
    null
  );

  const closeForToolbar = useCallback((focusTarget?: HTMLElement) => {
    appearanceSessionRef.current?.close();
    fontControlsSessionRef.current?.close();
    ordinarySettingsSessionRef.current?.close(focusTarget);
  }, []);
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
  const handleToolbarExecutorReady = useCallback(
    (execute: ((commandId: string) => void) | null) => {
      contextMenuExecutorRef.current = execute;
    },
    []
  );

  const session = useEditorSessionAndFormBridge({
    appearance: props.appearance,
    cancelVisualUnlockPreparationRef,
    codeThemePreparationRef,
    fonts: props.fonts,
    immersiveEnvironment: props.immersiveEnvironment,
    immersiveRef,
    isNewPost: props.isNewPost,
    localDraftStorage: props.localDraftStorage,
    localDrafts: props.localDrafts,
    nativePublishPort: props.nativePublishPort,
    nativeSubmissionPort: props.nativeSubmissionPort,
    onDocumentOwnerChange: props.onDocumentOwnerChange,
    prepareSourceMutationRef,
    previewPort: props.previewPort,
    publishPost: props.publishPost,
    reportFailure,
    restoreRevision: props.restoreRevision,
    revisionPort: props.revisionPort,
    sessionPort: props.sessionPort,
    settings: props.settings,
    visualEditorRuntimeRef,
    visualPreviewEditingRef
  });

  const visual = useEditorVisualPreviewBridge({
    cancelVisualUnlockPreparationRef,
    closeForToolbar,
    codeThemePreparationGenerationRef,
    codeThemePreparationRef,
    contextMenuStrings: props.contextMenuStrings,
    documentSession: session.documentSession,
    enhancementPort: props.enhancementPort,
    immersiveEnvironment: props.immersiveEnvironment,
    immersivePreferencesPort: props.immersivePreferencesPort,
    immersiveRef,
    notifyContextMenuReadiness,
    prepareSourceMutationRef,
    preview: props.preview,
    previewAppearanceRef,
    previewRefreshPendingRef,
    previewRuntimeRef,
    publishEditorStatus: session.publishEditorStatus,
    releasePendingContextResourcesRef,
    reportFailure,
    rootActiveRef,
    rootRef,
    scrollSyncPort: props.scrollSyncPort,
    setEditorStatusState: session.setEditorStatusState,
    settings: props.settings,
    submissionField: props.submissionField,
    toolbarSessionRef,
    visualEditorRuntimeRef,
    visualPreviewEditingRef,
    visualPreviewWindowRequestedRef,
    wechatClipboard: props.wechatClipboard,
    wechatExport: props.wechatExport
  });

  const appearance = useEditorAppearanceBridge({
    appearance: props.appearance,
    appearancePort: props.appearancePort,
    appearanceSessionRef,
    cancelVisualPreviewWindowUnlock: visual.cancelVisualPreviewWindowUnlock,
    cancelVisualUnlockPreparation: visual.cancelVisualUnlockPreparation,
    codeThemePreparationGenerationRef,
    codeThemePreparationRef,
    documentSession: session.documentSession,
    enhancementPort: props.enhancementPort,
    fontControlsPort: props.fontControlsPort,
    fontControlsSessionRef,
    fonts: props.fonts,
    ordinarySettingsSessionRef,
    prepareSourceMutationWithPreview: visual.prepareSourceMutationWithPreview,
    previewAppearanceRef,
    previewRefreshPendingRef,
    previewRuntimeRef,
    protectedOperationError: session.protectedOperationError,
    publishEditorStatus: session.publishEditorStatus,
    reportFailure,
    rootActiveRef,
    scheduleCurrentWechatPreviewPreparation:
      visual.scheduleCurrentWechatPreviewPreparation,
    schedulePreview: visual.schedulePreview,
    scheduleWechatPreviewPreparation: visual.scheduleWechatPreviewPreparation,
    setEditorStatusState: session.setEditorStatusState,
    submissionStateRef: session.submissionStateRef,
    toolbarSessionRef,
    visualEditorRuntimeRef,
    visualPreviewEditing: visual.visualPreviewEditing,
    visualPreviewEditingRef
  });

  const media = useEditorMediaUploadBridge({
    applyVisualCanonicalChange: visual.applyVisualCanonicalChange,
    documentSession: session.documentSession,
    executeExternalCommand: props.executeExternalCommand,
    imageUpload: props.imageUpload,
    imageUploadPort: props.imageUploadPort,
    immersiveStrings: props.immersiveStrings,
    leaveVisualPreview: visual.leaveVisualPreview,
    mediaPicker: props.mediaPicker,
    mediaPickerFailureMessage: props.mediaPickerFailureMessage,
    mediaPickerFrame: props.mediaPickerFrame,
    prepareVisualSource: visual.prepareVisualSource,
    previewRuntimeGeneration: visual.previewRuntimeGeneration,
    previewRuntimeRef,
    protectedOperationError: session.protectedOperationError,
    publishEditorStatus: session.publishEditorStatus,
    remoteImageImportPort: props.remoteImageImportPort,
    reportFailure,
    rootActiveRef,
    toolbar: props.toolbar,
    visualEditorRuntimeRef,
    visualEditorSurface: visual.visualEditorSurface,
    visualPreviewEditing: visual.visualPreviewEditing,
    visualPreviewEditingRef,
    visualPreviewWindowRequestedRef,
    wechatClipboard: props.wechatClipboard,
    wechatExport: props.wechatExport,
    wechatVisualRasterizationPort: props.wechatVisualRasterizationPort
  });

  const contextMenu = useEditorContextMenuBridge({
    appearance: props.appearance,
    applyVisualCanonicalChange: visual.applyVisualCanonicalChange,
    contextMenuExecutorRef,
    contextMenuStrings: props.contextMenuStrings,
    documentSession: session.documentSession,
    editorBlockIndexPort: props.editorBlockIndexPort,
    editorClipboardPort: props.editorClipboardPort,
    editorImagePixelsPort: props.editorImagePixelsPort,
    generatedContentExportSession: props.generatedContentExportSession,
    getNextPreviewRevision: visual.getNextPreviewRevision,
    imageUpload: props.imageUpload,
    immersiveEnvironment: props.immersiveEnvironment,
    immersiveRef,
    notifyContextMenuReadiness,
    openMediaPicker: media.openMediaPicker,
    prepareGeneratedSourceNavigation: visual.prepareGeneratedSourceNavigation,
    preview: props.preview,
    previewAppearanceRef,
    previewPort: session.previewPort,
    previewRuntimeGeneration: visual.previewRuntimeGeneration,
    previewRuntimeRef,
    previewSurfaceStatusRef: visual.previewSurfaceStatusRef,
    publishEditorStatus: session.publishEditorStatus,
    releasePendingContextResourcesRef,
    remoteImageImportPort: media.remoteImageImportPort,
    reportFailure,
    rootActiveRef,
    rootRef,
    simplifiedFormattingParser: props.simplifiedFormattingParser,
    submissionField: props.submissionField,
    subscribeContextMenuReadiness,
    toolbar: props.toolbar,
    visualEditorGeneration: visual.visualEditorGeneration,
    visualEditorRuntimeRef,
    visualEditorSurface: visual.visualEditorSurface,
    visualPreviewEditing: visual.visualPreviewEditing,
    visualPreviewWindowed: visual.visualPreviewWindowed
  });

  const documentSession = session.documentSession;
  const editorStatus = session.editorStatus;

  return (
    <div
      ref={rootRef}
      className={visual.immersiveLayoutClass}
      data-easymde-editor-owner="react"
      data-easymde-session-status={session.sessionSnapshot.status}
    >
      {visual.immersive && documentSession ? (
        <ImmersiveEditor
          documentSession={documentSession}
          environment={props.immersiveEnvironment}
          generalSettings={props.settings.general}
          immersivePreferencesPort={props.immersivePreferencesPort}
          i18n={props.immersiveI18n}
          initialPreferences={
            'loaded' === visual.immersivePreferences.status
              ? visual.immersivePreferences.preferences
              : null
          }
          visualPreviewEditable={
            visual.visualPreviewEditing
            && Boolean(visualEditorRuntimeRef.current?.surface.isConnected)
          }
          focusVisualPreview={visual.focusVisualPreview}
          mode={visual.immersiveMode}
          direction={props.layout.direction}
          onCopyWechat={media.copyWechatFromImmersive}
          onExit={visual.exitImmersive}
          onFailure={reportFailure}
          onBeforeSourceMutation={visual.prepareSourceMutation}
          onConfirmPublish={session.publish}
          onSelectFeaturedImage={media.selectFeaturedImage}
          readPublishSnapshot={props.nativePublishPort.read}
          onViewModeChange={visual.changeImmersiveMode}
          revisionPort={session.revisionPort}
          restoreRevision={session.restoreRevision}
          styleControls={
            <Fragment>
              <AppearanceControls
                bootstrap={appearance.currentAppearance}
                messageAlertTimer={props.immersiveEnvironment}
                onFailure={() =>
                  reportFailure('react-editor-appearance-failed')
                }
                onNotification={appearance.setAppearanceNotification}
                onNotificationDismiss={appearance.dismissAppearanceNotification}
                onReady={handleAppearanceReady}
                port={appearance.appearancePort}
                immersiveLabel={props.immersiveStrings.theme}
                immersiveTitle={props.immersiveStrings.themeSettings}
                variant="immersive"
              />
              <FontControls
                bootstrap={appearance.currentFonts}
                onFailure={() => reportFailure('react-editor-fonts-failed')}
                onReady={handleFontControlsReady}
                port={appearance.fontControlsPort}
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
                  {...(visual.visualPreviewEditing
                    ? {
                        executeVisualCommand: visual.executeVisualToolbarCommand
                      }
                    : {})}
                  executeExternalCommand={media.executeRootExternalCommand}
                  isOwnedShortcutTarget={contextMenu.isOwnedShortcutTarget}
                  onExecuteCommandReady={handleToolbarExecutorReady}
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
      {!visual.immersive ? (
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
                  executeExternalCommand={media.executeRootExternalCommand}
                  isOwnedShortcutTarget={contextMenu.isOwnedShortcutTarget}
                  onExecuteCommandReady={handleToolbarExecutorReady}
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
                  media.executeRootExternalCommand(commandId, documentSession)
                }
                platform={props.platform}
                toolbar={props.toolbar}
              />
            ) : null}
            <button
              ref={visual.immersiveToggleRef}
              type="button"
              className="easymde-toolbar-button easymde-toolbar-button-compact easymde-toolbar-immersive-toggle"
              aria-label={props.immersiveStrings.enter}
              aria-pressed="false"
              title={props.immersiveStrings.enter}
              onMouseDown={(event) => event.preventDefault()}
              onClick={visual.enterImmersive}
            >
              <ImmersiveToggleIcon />
            </button>
            <OrdinaryEditorSettings
              appearance={appearance.currentAppearance}
              appearancePort={appearance.appearancePort}
              fonts={appearance.currentFonts}
              fontControlsPort={appearance.fontControlsPort}
              label={props.immersiveStrings.editorSettings}
              messageAlertTimer={props.immersiveEnvironment}
              onAppearanceReady={handleAppearanceReady}
              onFailure={reportFailure}
              onNotification={appearance.setAppearanceNotification}
              onNotificationDismiss={appearance.dismissAppearanceNotification}
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
              session.setEditorStatusState((currentState) => ({
                focused: false,
                status:
                  currentState.status === editorStatus
                    ? null
                    : currentState.status
              }));
            }}
            onFocusChange={(focused) => {
              session.setEditorStatusState((currentState) =>
                currentState.focused === focused
                  ? currentState
                  : { ...currentState, focused }
              );
            }}
            type={editorStatus.type}
          />
        </div>
      ) : null}
      {!visual.immersive && session.draftCandidate ? (
        <div className="easymde-draft-notice">
          <span>{props.localDrafts.strings.available}</span>
          <button
            type="button"
            className="button button-small"
            onClick={() => session.localDraftSessionRef.current?.restore()}
          >
            {props.localDrafts.strings.restore}
          </button>
          <button
            type="button"
            className="button button-small"
            onClick={() => session.localDraftSessionRef.current?.discard()}
          >
            {props.localDrafts.strings.discard}
          </button>
        </div>
      ) : null}
      {!visual.immersive && session.draftUnreadable ? (
        <div className="easymde-draft-notice">
          <button
            type="button"
            className="button button-small"
            onClick={() => session.localDraftSessionRef.current?.discard()}
          >
            {props.localDrafts.strings.discard}
          </button>
        </div>
      ) : null}
      <EditorWorkspace
        direction={props.layout.direction}
        {...(!visual.immersive
          ? { mode: props.settings.general.editingMode }
          : {})}
        onLayoutChange={visual.scheduleCurrentWechatPreviewPreparation}
        statusBarMode={props.settings.general.statusBarMode}
        {...(!visual.immersive && documentSession
          ? {
              ordinaryStatus: {
                document: documentSession.document,
                lastEdited: props.layout.status.lastEdited,
                locale: props.localDrafts.locale,
                wordCountTemplate: props.layout.status.wordCount
              }
            }
          : {})}
        splitResizable={visual.immersive && 'split' === visual.immersiveMode}
        splitResizeLabel={props.immersiveStrings.resizeSplit}
        source={
          <section
            className="easymde-pane easymde-pane-source"
            data-easymde-document-owner="react"
          >
            {visual.immersive ? (
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
                settings={props.settings}
                onReady={session.handleDocumentReady}
                submissionField={props.submissionField}
                titleField={props.titleField}
              />
            </div>
            {visual.immersive ? (
              <footer className="easymde-immersive-statusbar">
                <span>
                  {`${props.immersiveStrings.line} ${session.cursorPosition.line}, ${props.immersiveStrings.column} ${session.cursorPosition.column}`}
                </span>
                <span>
                  {props.immersiveStrings.markdown}
                  {session.localDraftsEnabled ? (
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
            active={visual.immersive && 'preview' === visual.immersiveMode}
            canEdit={
              'ready' === visual.previewSurfaceStatus
              && null !== visual.visualPreviewSnapshot
              && visual.visualPreviewHasEditableMap
              && null !== documentSession
            }
            changed={visual.visualPreviewChanged}
            editable={visual.visualPreviewEditing}
            hasSnapshot={null !== visual.visualPreviewSnapshot}
            ordinaryLabel={visual.immersive ? props.labels.preview : null}
            unlocking={visual.visualPreviewUnlocking}
            onToggleEditable={() => {
              if (visual.visualPreviewEditing) {
                // Locking returns this same Preview to read-only; it does not
                // consume the accepted window as a result. Use the teardown
                // policy: the canonical source is already synchronized, a
                // not-ready render is acceptable, and the Preview owner's own
                // windowed release restores/retains the read-only surface.
                // Requesting full materialization here would turn a legitimate
                // loading readiness return into a page error.
                void visual.prepareSourceMutationWithPreview({
                  materialize: false
                });
                return;
              }
              visual.requestVisualPreviewUnlock();
            }}
            status={visual.previewSurfaceStatus}
            statusMessages={{
              empty: props.preview.messages.empty,
              error: props.preview.messages.error,
              loading: props.preview.messages.loading
            }}
            strings={props.immersiveStrings}
          >
            <PreviewSurfaceOwner
              className={appearance.previewClassName}
              emptyMode={
                visual.immersive && 'preview' === visual.immersiveMode
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
              onDiagnostic={reportFailure}
              onDispose={visual.handlePreviewDispose}
              onImageReadinessChange={visual.handlePreviewImageReadinessChange}
              onReady={visual.handlePreviewReady}
              onSnapshotReady={visual.handlePreviewSnapshotReady}
              onStatusChange={visual.handlePreviewStatusChange}
              onWindowReady={visual.handlePreviewWindowReady}
              port={session.previewPort}
              currentSourceSnapshot={() => {
                if (!documentSession) return null;
                const revision = documentSession.document.getRevision?.();
                return undefined === revision
                  ? null
                  : {
                      revision,
                      value: documentSession.document.getValue()
                    };
              }}
              scrollPort={props.scrollPort}
              sourceRevision={documentSession?.document.getRevision?.() ?? 0}
              style={appearance.previewStyle}
              {...(visual.visualPreviewEditing
                ? {
                    contentEditable: true,
                    label: props.immersiveStrings.previewEditorLabel,
                    role: 'textbox',
                    spellCheck: true
                  }
                : {})}
              windowed={visual.visualPreviewSurfaceWindowed}
            />
            {visual.visualPreviewEditing
            && visual.visualPreviewSnapshot
            && documentSession
            && previewRuntimeRef.current ? (
              <ImmersiveVisualEditorHost
                acceptedWindowSnapshotGeneration={
                  visual.acceptedWindowSnapshotGeneration
                }
                documentSession={documentSession}
                getAcceptedReferenceSource={visual.getAcceptedReferenceSource}
                getAcceptedWindowRow={visual.getAcceptedWindowRow}
                getAcceptedWindowSnapshot={visual.getAcceptedWindowSnapshot}
                getGeneratedPreviewIdentity={
                  visual.getVisualGeneratedPreviewIdentity
                }
                imagePasteUploadEnabled={
                  props.imageUpload.autoUploadPastedImages
                }
                imageUploadEnabled={props.imageUpload.enabled}
                onCanonicalDocumentChange={
                  visual.handleVisualCanonicalDocumentChange
                }
                onDiagnostic={reportFailure}
                onDispose={visual.handleVisualEditorDispose}
                onFailure={visual.handleVisualFailure}
                onMarkdownChange={visual.handleVisualMarkdownChange}
                onPendingChange={visual.handleVisualPendingChange}
                onReady={visual.handleVisualEditorReady}
                onTransferFailure={visual.handleVisualTransferFailure}
                pending={visual.visualPreviewPending}
                prepareGeneratedContentTarget={
                  visual.prepareVisualGeneratedContentTarget
                }
                prepareImageTarget={visual.prepareVisualImageTarget}
                prepareImageTargetBySelection={
                  visual.prepareVisualImageTargetBySelection
                }
                prepareWindowBlockAdoption={
                  visual.prepareVisualWindowBlockAdoption
                }
                previewSnapshot={visual.visualPreviewSnapshot}
                previewStatus={visual.previewSurfaceStatus}
                referenceLabelCaseFoldProfile={
                  props.referenceLabelCaseFoldProfile
                }
                requestPreview={visual.handleVisualPreviewRequest}
                requestPreviewAtDocumentEnd={
                  visual.handleVisualPreviewAtDocumentEnd
                }
                resumeCanonicalSelectionOnOwnerTransfer={
                  visual.visualOwnerSelectionTransferred
                }
                resumeCanonicalSelectionToken={
                  visual.visualResumeCanonicalToken
                }
                retainCompositionSurface={visual.retainCompositionSurface}
                revealAcceptedWindowRow={visual.revealAcceptedWindowRow}
                surface={previewRuntimeRef.current.surface}
                windowed={visual.visualPreviewWindowed}
              />
            ) : null}
          </ImmersivePreviewSurface>
        }
      />
      {props.contextMenuStrings && props.editorClipboardPort ? (
        <EditorContextMenuFeature
          clipboard={props.editorClipboardPort}
          canCopySimplified={Boolean(
            props.simplifiedFormattingParser
              && supportsEditorRichClipboard(props.editorClipboardPort)
          )}
          direction={props.layout.direction}
          imageShortcut={formatKeyboardShortcut(
            props.toolbar.shortcuts.image?.[props.platform] ?? ''
          )}
          labels={props.contextMenuStrings}
          heading={contextMenu.contextMenuHeading}
          onAction={contextMenu.contextMenuActionCoordinator.onAction}
          onFailure={(code) =>
            contextMenu.reportContextMenuFailure(
              code,
              props.contextMenuStrings?.statusActionFailed
            )
          }
          onPortalOwnerChange={contextMenu.registerContextMenuPortalOwner}
          shortcut={formatKeyboardShortcut(
            props.toolbar.shortcuts.bold?.[props.platform] ?? ''
          )}
          source={contextMenu.contextMenuSource}
          visual={contextMenu.contextMenuVisual}
        />
      ) : null}
      {contextMenu.contextMenuTableRequest ? (
        <EditorTableDialog
          environment={props.immersiveEnvironment}
          strings={props.immersiveStrings}
          onClose={contextMenu.closeContextMenuTableDialog}
          onInsert={contextMenu.insertContextMenuTable}
        />
      ) : null}
      {media.mediaPickerDialog && props.mediaPickerFrame ? (
        <WordPressMediaPickerDialog
          closeLabel={props.immersiveStrings.close}
          frame={props.mediaPickerFrame}
          label={
            'featured' === media.mediaPickerDialog
              ? props.immersiveStrings.selectFeaturedImage
              : props.mediaPicker.insertMedia
          }
          onAttachError={media.handleMediaPickerAttachError}
          onCancel={media.closeMediaPickerDialog}
        />
      ) : null}
    </div>
  );
}
