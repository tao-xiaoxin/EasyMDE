import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { ReactNode } from 'react';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type { ImmersiveI18nPort } from '../../../contracts/ports/immersive-i18n-port';
import type {
  ImmersivePreferences,
  ImmersivePreferencesPort
} from '../../../contracts/ports/immersive-preferences-port';
import type {
  NativeFeaturedImage,
  NativePublishDraft,
  NativePublishSnapshot
} from '../../../contracts/ports/native-publish-port';
import type { RevisionPort } from '../../../contracts/ports/revision-port';
import type { GeneralSettings } from '../../../contracts/settings-center-settings';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { EditorTableDialog } from '../../editor-context-menu/ui/EditorTableDialog';
import {
  type ImmersiveOutlineItem,
  type ImmersiveViewMode,
  separatedTableInsertion
} from '../immersive-editor';
import { ImmersiveHeader } from './ImmersiveHeader';
import { ImmersiveHistoryDialog } from './ImmersiveHistoryDialog';
import { ImmersiveOutline } from './ImmersiveOutline';
import { ImmersiveToolbar } from './ImmersiveToolbar';
import type {
  ImmersiveSettings,
  ImmersiveStrings
} from './immersive-editor-ui-types';
import type { WechatCopyStatusStore } from '../../wechat-export/wechat-copy-status';
import { LazyImmersivePublishDialog } from './LazyImmersivePublishDialog';
import { useImmersiveDocumentDerivations } from './use-immersive-document-derivations';

export type { ImmersiveStrings } from './immersive-editor-ui-types';
export { useImmersiveDocumentDerivations } from './use-immersive-document-derivations';

const COMPACT_OUTLINE_MAX_WIDTH = 782;

type Props = Readonly<{
  direction: 'ltr' | 'rtl';
  generalSettings: GeneralSettings;
  documentSession: EditorDocumentSession;
  environment: ImmersiveEnvironmentPort;
  immersivePreferencesPort: ImmersivePreferencesPort;
  i18n: ImmersiveI18nPort;
  initialPreferences?: ImmersivePreferences | null;
  visualPreviewEditable: boolean;
  focusVisualPreview: () => boolean;
  revisionPort: RevisionPort | null;
  restoreRevision: (restoreUrl: string) => void;
  styleControls: ReactNode;
  toolbar: ReactNode;
  wechatCopyStatus: WechatCopyStatusStore;
  onCopyWechat: () => Promise<boolean>;
  onBeforeSourceMutation: () => boolean;
  /**
   * Visual-mode delegates. `null` means no visual owner is mounted, so the
   * Source-mode path applies; a boolean is the visual owner's own result.
   */
  onInsertVisualTable?: (rows: number, columns: number) => boolean | null;
  onRevealVisualHeading?: (index: number, text: string) => boolean | null;
  onExit: () => void;
  onFailure: (code: string) => void;
  mode: ImmersiveViewMode;
  readPublishSnapshot: () => NativePublishSnapshot;
  onConfirmPublish: (
    draft: NativePublishDraft,
    original: NativePublishSnapshot
  ) => boolean;
  onSelectFeaturedImage: () => Promise<NativeFeaturedImage | null>;
  onViewModeChange: (mode: ImmersiveViewMode) => void;
  strings: ImmersiveStrings;
}>;

export function ImmersiveEditor({
  direction,
  documentSession,
  environment,
  generalSettings,
  i18n,
  immersivePreferencesPort,
  initialPreferences = null,
  visualPreviewEditable,
  focusVisualPreview,
  revisionPort,
  restoreRevision,
  styleControls,
  toolbar,
  wechatCopyStatus,
  mode,
  onCopyWechat,
  onBeforeSourceMutation,
  onInsertVisualTable,
  onRevealVisualHeading,
  onExit,
  onFailure,
  readPublishSnapshot,
  onConfirmPublish,
  onSelectFeaturedImage,
  onViewModeChange,
  strings
}: Props) {
  const [markdown, setMarkdown] = useState(() =>
    documentSession.document.getValue()
  );
  const [title, setTitle] = useState(
    () => documentSession.title.getSnapshot().value
  );
  const [dirty, setDirty] = useState(() => documentSession.getSnapshot().dirty);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const previousVisualPreviewEditableRef = useRef(visualPreviewEditable);
  const responsivePreviewStateRef = useRef({ mode, visualPreviewEditable });
  const previousViewportCompactRef = useRef<boolean | null>(null);
  const outlineAutoClosedInCompactVisitRef = useRef(false);
  const [activeOutline, setActiveOutline] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [wechatCopied, setWechatCopied] = useState(false);
  const [publishSnapshot, setPublishSnapshot] =
    useState<NativePublishSnapshot | null>(null);
  const [initialPublishSnapshot] = useState(readPublishSnapshot);
  const [outlineEnabled, setOutlineEnabled] = useState(
    () => initialPreferences?.outline ?? true
  );
  const settings: ImmersiveSettings = {
    outline: outlineEnabled,
    splitPreview: 'split' === mode
  };
  const closeOutlineForCompactViewport = useCallback(() => {
    const activeElement = environment.activeElement();
    if (
      activeElement?.closest('.easymde-immersive-outline')
      && !focusVisualPreview()
    ) return false;
    setOutlineOpen(false);
    return true;
  }, [environment, focusVisualPreview]);

  useLayoutEffect(() => {
    responsivePreviewStateRef.current = { mode, visualPreviewEditable };
    const wasEditable = previousVisualPreviewEditableRef.current;
    previousVisualPreviewEditableRef.current = visualPreviewEditable;
    if (
      wasEditable
      || !visualPreviewEditable
      || 'preview' !== mode
    ) return;
    const isCompactViewport =
      environment.viewportWidth() <= COMPACT_OUTLINE_MAX_WIDTH;
    previousViewportCompactRef.current = isCompactViewport;
    if (!isCompactViewport) {
      outlineAutoClosedInCompactVisitRef.current = false;
      return;
    }
    if (outlineAutoClosedInCompactVisitRef.current) return;
    if (closeOutlineForCompactViewport()) {
      outlineAutoClosedInCompactVisitRef.current = true;
    }
  }, [
    closeOutlineForCompactViewport,
    environment,
    mode,
    visualPreviewEditable
  ]);

  useLayoutEffect(() => {
    const initialWidth = environment.viewportWidth();
    previousViewportCompactRef.current =
      initialWidth <= COMPACT_OUTLINE_MAX_WIDTH;
    if (initialWidth > COMPACT_OUTLINE_MAX_WIDTH) {
      outlineAutoClosedInCompactVisitRef.current = false;
    }

    return environment.subscribeResize(() => {
      const isCompactViewport =
        environment.viewportWidth() <= COMPACT_OUTLINE_MAX_WIDTH;
      const wasCompactViewport = previousViewportCompactRef.current;
      previousViewportCompactRef.current = isCompactViewport;
      if (!isCompactViewport) {
        outlineAutoClosedInCompactVisitRef.current = false;
        return;
      }
      if (
        false !== wasCompactViewport
        || outlineAutoClosedInCompactVisitRef.current
      ) return;

      const current = responsivePreviewStateRef.current;
      if (!current.visualPreviewEditable || 'preview' !== current.mode) return;

      if (closeOutlineForCompactViewport()) {
        outlineAutoClosedInCompactVisitRef.current = true;
      }
    });
  }, [closeOutlineForCompactViewport, environment]);

  useEffect(() => environment.activateFavicon(), [environment]);

  useEffect(() => {
    if (!wechatCopied) return undefined;
    return environment.schedule(() => setWechatCopied(false), 1800);
  }, [environment, wechatCopied]);

  useEffect(
    () =>
      documentSession.document.subscribe(() =>
        setMarkdown(documentSession.document.getSnapshot().value)
      ),
    [documentSession]
  );
  useEffect(
    () =>
      documentSession.subscribe(() =>
        setDirty(documentSession.getSnapshot().dirty)
      ),
    [documentSession]
  );
  useEffect(
    () =>
      documentSession.title.subscribe(() =>
        setTitle(documentSession.title.getSnapshot().value)
      ),
    [documentSession]
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A dialog that already handled this Escape owns it: the modal calls
      // preventDefault and stops React propagation, but this listener is a
      // native document listener, so the cancelled event must also stop here
      // instead of closing the surrounding mode as well. Safari reports an IME
      // composition Escape with `keyCode` 229 and `isComposing` false, so that
      // signal is checked at this same boundary rather than left to the dialog.
      if (
        'Escape' !== event.key
        || event.isComposing
        || 229 === event.keyCode
        || event.defaultPrevented
      ) return;
      if (environment.hasOpenToolbarPopover()) return;
      event.preventDefault();
      if (tableOpen) setTableOpen(false);
      else if (historyOpen) setHistoryOpen(false);
      else if (publishSnapshot) setPublishSnapshot(null);
      else onExit();
    };
    return environment.subscribeKeydown(handleKeyDown);
  }, [environment, historyOpen, onExit, publishSnapshot, tableOpen]);

  const { outline, resolveOutlineItem, stats } =
    useImmersiveDocumentDerivations(markdown, environment.schedule);
  const handleOutlineOpenChange = useCallback(
    (open: boolean) => setOutlineOpen(open),
    []
  );
  const handleOutlineSelect = useCallback(
    (item: ImmersiveOutlineItem) => {
      const current = resolveOutlineItem(item);
      setActiveOutline(current.index);
      // An unlocked visual editor owns navigation: focusing the hidden
      // CodeMirror source would leave the visible editing surface behind.
      const visual = onRevealVisualHeading?.(current.index, current.text);
      if (null !== visual && undefined !== visual) return;
      documentSession.document.revealPosition(current.position);
    },
    [documentSession, onRevealVisualHeading, resolveOutlineItem]
  );
  const changeMode = (next: ImmersiveViewMode) => {
    onViewModeChange(next);
  };
  const changeSettings = (next: ImmersiveSettings) => {
    if (next.outline !== outlineEnabled) {
      setOutlineEnabled(next.outline);
      const result = immersivePreferencesPort.write({
        outline: next.outline
      });
      if ('unavailable' === result.status) onFailure(result.code);
    }
    if (next.splitPreview !== settings.splitPreview) {
      changeMode(next.splitPreview ? 'split' : 'source');
    }
  };
  const changeTitle = (value: string) => {
    setTitle(value);
    documentSession.title.setValue(value);
  };
  const insertTable = (rows: number, columns: number) => {
    const visual = onInsertVisualTable?.(rows, columns);
    if (null !== visual && undefined !== visual) {
      // The unlocked visual editor applied (or explicitly reported) the
      // bounded canonical change itself and keeps its surface mounted.
      setTableOpen(false);
      return;
    }
    if (!onBeforeSourceMutation()) return;
    const snapshot = {
      selection: documentSession.document.getSelection(),
      value: documentSession.document.getValue()
    };
    const insertion = separatedTableInsertion(
      snapshot.value,
      snapshot.selection.start,
      snapshot.selection.end,
      rows,
      columns
    );
    const value =
      snapshot.value.slice(0, insertion.from) +
      insertion.insert +
      snapshot.value.slice(insertion.to);
    const caret = insertion.caret;
    documentSession.document.applyTextChange({
      value,
      selection: { direction: 'none', start: caret, end: caret }
    });
    setTableOpen(false);
    documentSession.document.focus();
  };
  const copyWechat = () => {
    const { pending, unavailable } = wechatCopyStatus.getSnapshot();
    if (pending || unavailable) return;
    setWechatCopied(false);
    void onCopyWechat().then((success) => {
      if (success) setWechatCopied(true);
    });
  };
  const openPublish = () => {
    if (!onBeforeSourceMutation()) return;
    setMarkdown(documentSession.document.getValue());
    setPublishSnapshot(readPublishSnapshot());
  };
  const handlePublishDialogLoadFailure = useCallback(
    (code: string) => {
      setPublishSnapshot(null);
      onFailure(code);
    },
    [onFailure]
  );

  return (
    <section
      className={`easymde-immersive-shell is-${mode}`}
      aria-label={strings.immersive}
    >
      {tableOpen ? (
        <EditorTableDialog
          environment={environment}
          strings={strings}
          onClose={() => setTableOpen(false)}
          onInsert={insertTable}
        />
      ) : null}
      {historyOpen && revisionPort ? (
        <ImmersiveHistoryDialog
          dirty={dirty}
          environment={environment}
          i18n={i18n}
          onFailure={onFailure}
          port={revisionPort}
          restoreRevision={restoreRevision}
          strings={strings}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {publishSnapshot ? (
        <LazyImmersivePublishDialog
          defaults={generalSettings}
          environment={environment}
          markdown={markdown}
          snapshot={publishSnapshot}
          strings={strings}
          onClose={() => setPublishSnapshot(null)}
          onConfirm={onConfirmPublish}
          onLoadFailure={handlePublishDialogLoadFailure}
          onSelectFeaturedImage={onSelectFeaturedImage}
        />
      ) : null}
      <ImmersiveHeader
        dirty={dirty}
        i18n={i18n}
        mode={mode}
        publishLabel={
          initialPublishSnapshot.existing
            ? strings.updateArticle
            : strings.publish
        }
        statusBarMode={generalSettings.statusBarMode}
        stats={stats}
        strings={strings}
        title={title}
        onModeChange={changeMode}
        onPublish={openPublish}
        onTitleChange={changeTitle}
      />
      <ImmersiveToolbar
        historyAvailable={null !== revisionPort}
        mode={mode}
        settings={settings}
        strings={strings}
        styleControls={styleControls}
        toolbar={toolbar}
        wechatCopyStatus={wechatCopyStatus}
        wechatCopied={wechatCopied}
        onCopyWechat={copyWechat}
        onExit={onExit}
        onHistory={() => {
          if (!onBeforeSourceMutation()) return;
          setHistoryOpen(true);
        }}
        onModeChange={changeMode}
        onSettingsChange={changeSettings}
        onTable={() => setTableOpen(true)}
      />
      {settings.outline ? (
        <ImmersiveOutline
          activeIndex={activeOutline}
          direction={direction}
          items={outline}
          open={outlineOpen}
          strings={strings}
          onOpenChange={handleOutlineOpenChange}
          onSelect={handleOutlineSelect}
        />
      ) : null}
    </section>
  );
}

export function ImmersiveToggleIcon() {
  return (
    <span
      className="dashicons dashicons-fullscreen-alt"
      aria-hidden="true"
    />
  );
}
