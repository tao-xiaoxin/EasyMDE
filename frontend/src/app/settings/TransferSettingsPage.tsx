import {
  createElement,
  createPortal,
  Fragment,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';

import {
  CircleCheck,
  CircleX,
  Copy,
  Download,
  FolderOpen,
  Info,
  RotateCcw,
  Trash2,
  Upload,
  X
} from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap } from '../../contracts/bootstrap/settings-center-bootstrap';

type Strings = SettingsCenterBootstrap['strings'];
type DialogKind = 'reset' | 'clear-cache' | 'directory' | 'status';
type ConfigurationCheck = Readonly<{
  label: string;
  valid: boolean;
  detail: string;
}>;

function createExportFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `easymde-config-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function TransferDialog({
  kind,
  onClose,
  onConfirm,
  onCopyStorageLocation,
  configurationChecks,
  strings
}: {
  kind: DialogKind;
  onClose: () => void;
  onConfirm: () => void;
  onCopyStorageLocation: () => void;
  configurationChecks: ReadonlyArray<ConfigurationCheck>;
  strings: Strings;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const destructive = kind === 'reset' || kind === 'clear-cache';
  const title = kind === 'reset' ? strings.transferResetCurrentConfiguration
    : kind === 'clear-cache' ? strings.transferClearLocalCache
      : kind === 'directory' ? strings.transferConfigurationDirectory
        : strings.transferConfigurationStatusCheck;
  const Icon = kind === 'reset' ? RotateCcw
    : kind === 'clear-cache' ? Trash2
      : kind === 'directory' ? FolderOpen
        : CircleCheck;

  useEffect(() => {
    const button = closeButtonRef.current;
    if (!button) throw new Error('settings-center-transfer-dialog-close-missing');
    button.focus();
  }, []);

  return <div className="easymde-settings-center__transfer-dialog-layer" role="presentation">
    <div role="dialog" aria-modal="true" aria-labelledby="easymde-transfer-dialog-title"
      className="easymde-settings-center__transfer-dialog">
      <header>
        <span className={destructive ? 'is-destructive' : ''}><Icon size={20} /></span>
        <div>
          <h2 id="easymde-transfer-dialog-title">{title}</h2>
          <p>{destructive
            ? strings.transferLocalStateChangeDescription
            : kind === 'directory'
              ? strings.transferConfigurationDirectoryDescription
              : strings.transferConfigurationStatusDescription}</p>
        </div>
        <button ref={closeButtonRef} type="button"
          aria-label={strings.transferCloseOperationDialog} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="easymde-settings-center__transfer-dialog-body">
        {kind === 'reset' || kind === 'clear-cache'
          ? <div className="easymde-settings-center__transfer-warning">
            {kind === 'reset' ? strings.transferResetWarning : strings.transferClearCacheWarning}
          </div>
          : kind === 'directory'
            ? <div className="easymde-settings-center__transfer-directory">
              <p>{strings.transferStorageLocationDescription}</p>
              <div>
                <code>{strings.transferStorageLocationValue}</code>
                <button type="button" onClick={onCopyStorageLocation}>
                  <Copy size={15} />{strings.transferCopyStorageLocation}
                </button>
              </div>
            </div>
            : <div className="easymde-settings-center__transfer-status-checks">
              <div>
                <span>{strings.transferChecksSummary
                  .replace('%s', () => String(configurationChecks.length))}</span>
                <strong>{strings.transferChecksPassed
                  .replace('%s', () => String(configurationChecks.filter((check) => check.valid).length))}</strong>
              </div>
              <section>
                {configurationChecks.map((check) => <div key={check.label}>
                  {check.valid
                    ? <CircleCheck size={18} />
                    : <CircleX size={18} className="is-invalid" />}
                  <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                </div>)}
              </section>
            </div>}
      </div>
      <footer>
        <button type="button" onClick={onClose}>
          {destructive ? strings.cancel : strings.transferClose}
        </button>
        {destructive ? <button type="button" onClick={onConfirm}>
          {kind === 'reset' ? strings.transferConfirmReset : strings.transferConfirmClear}
        </button> : null}
      </footer>
    </div>
  </div>;
}

export function TransferSettingsPage({
  overlayRoot,
  bootstrap
}: {
  overlayRoot: HTMLElement | null;
  bootstrap: SettingsCenterBootstrap;
}) {
  const { assets, drafts, strings } = bootstrap;
  const [exportFileName, setExportFileName] = useState(createExportFileName);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [dialog]);

  useEffect(() => {
    if (dialog) return;
    dialogTriggerRef.current?.focus();
    dialogTriggerRef.current = null;
  }, [dialog]);

  const showIntegrationPending = () => {
    setFeedback(strings.transferIntegrationPendingNotice);
  };
  const selectImportFile = (file: File | null) => {
    setImportFile(file);
    setFeedback(file
      ? strings.transferFileSelectedNotice.replace('%s', () => file.name)
      : null);
  };
  const openDialog = (kind: DialogKind, trigger: HTMLButtonElement) => {
    dialogTriggerRef.current = trigger;
    setDialog(kind);
  };
  const confirmDialog = () => {
    setDialog(null);
    showIntegrationPending();
  };
  const imageDraftReady = Boolean(drafts.images.domain.trim());
  const aiDraftReady = Boolean(
    drafts.ai.provider.trim()
    && drafts.ai.endpoint.trim()
    && drafts.ai.apiKey.trim()
    && drafts.ai.model.trim()
  );
  const configurationChecks: ReadonlyArray<ConfigurationCheck> = [
    {
      label: strings.transferCheckBootstrap,
      valid: true,
      detail: strings.transferCheckBootstrapReady
    },
    {
      label: strings.transferCheckRuntimeAssets,
      valid: Boolean(
        assets.brandMarkUrl.trim()
        && assets.headerIllustrationUrl.trim()
        && assets.searchEmptyIllustrationUrl.trim()
      ),
      detail: strings.transferCheckRuntimeAssetsReady
    },
    {
      label: strings.transferCheckImageDraft,
      valid: imageDraftReady,
      detail: imageDraftReady
        ? strings.transferCheckImageDraftReady
        : strings.transferCheckImageDraftIncomplete
    },
    {
      label: strings.transferCheckAiDraft,
      valid: aiDraftReady,
      detail: aiDraftReady
        ? strings.transferCheckAiDraftReady
        : strings.transferCheckAiDraftIncomplete
    },
    {
      label: strings.transferCheckPersistence,
      valid: false,
      detail: strings.transferCheckPersistencePending
    }
  ];
  const copyStorageLocation = async () => {
    try {
      await navigator.clipboard.writeText(strings.transferStorageLocationValue);
      setFeedback(strings.transferStorageLocationCopied);
    } catch {
      setFeedback(strings.transferStorageLocationCopyFailed);
    }
  };

  const dialogPortal = dialog && overlayRoot ? createPortal(
    <TransferDialog kind={dialog} strings={strings}
      configurationChecks={configurationChecks}
      onCopyStorageLocation={() => { void copyStorageLocation(); }}
      onClose={() => setDialog(null)} onConfirm={confirmDialog} />,
    overlayRoot
  ) : null;
  const feedbackPortal = feedback && overlayRoot ? createPortal(
    <div className="easymde-settings-center__transfer-feedback" role="status">
      <Info size={19} /><span>{feedback}</span>
      <button type="button" aria-label={strings.closeTransferFeedback}
        onClick={() => setFeedback(null)}><X size={16} /></button>
    </div>,
    overlayRoot
  ) : null;

  return <div className="easymde-settings-center__transfer-page">
    <div className="easymde-settings-center__transfer-primary-groups">
      <section className="easymde-settings-center__transfer-group is-export">
        <h2><Download size={29} />{strings.transferExportConfiguration}</h2>
        <p>{strings.transferExportConfigurationDescription}</p>
        <div className="easymde-settings-center__transfer-export-form">
          <label htmlFor="easymde-transfer-export-name">{strings.transferFileName}</label>
          <div>
            <input id="easymde-transfer-export-name" value={exportFileName}
              aria-label={strings.transferExportFileName}
              onChange={(event) => setExportFileName(event.target.value)} />
            <span>.json</span>
          </div>
          <button type="button" onClick={showIntegrationPending}>
            <Download size={17} />{strings.transferExportConfiguration}
          </button>
        </div>
      </section>

      <section className="easymde-settings-center__transfer-group is-import">
        <h2><Upload size={29} />{strings.transferImportConfiguration}</h2>
        <p>{strings.transferImportConfigurationDescription}</p>
        <div className="easymde-settings-center__transfer-import-actions">
          <button type="button" onClick={() => importFileRef.current?.click()}>
            <Upload size={17} />{strings.transferChooseConfigurationFile}
          </button>
          <input ref={importFileRef} type="file" accept="application/json,.json"
            aria-label={strings.transferChooseConfigurationFile}
            onChange={(event) => selectImportFile(event.target.files?.[0] ?? null)} />
          {importFile ? <Fragment>
            <span className="easymde-settings-center__transfer-file-chip">
              <CircleCheck size={16} /><span>{importFile.name}</span>
            </span>
            <button type="button" onClick={showIntegrationPending}>
              {strings.transferConfirmImport}
            </button>
          </Fragment> : null}
        </div>
        <div className="easymde-settings-center__transfer-instructions">
          <h3>{strings.transferImportInstructions}</h3>
          <div>
            {[
              strings.transferImportOverwriteNotice,
              strings.transferImportCompatibilityNotice,
              strings.transferImportScopeNotice
            ].map((item) => <p key={item}><Info size={15} />{item}</p>)}
          </div>
        </div>
      </section>
    </div>

    <section className="easymde-settings-center__transfer-management">
      <h2>{strings.transferConfigurationManagement}</h2>
      <p>{strings.transferConfigurationManagementDescription}</p>
      <div>
        {[
          {
            kind: 'reset' as const,
            label: strings.transferResetCurrentConfiguration,
            description: strings.transferResetCurrentConfigurationDescription,
            icon: RotateCcw
          },
          {
            kind: 'clear-cache' as const,
            label: strings.transferClearLocalCache,
            description: strings.transferClearLocalCacheDescription,
            icon: Trash2
          },
          {
            kind: 'directory' as const,
            label: strings.transferOpenConfigurationDirectory,
            description: strings.transferOpenConfigurationDirectoryDescription,
            icon: FolderOpen
          },
          {
            kind: 'status' as const,
            label: strings.transferViewConfigurationStatus,
            description: strings.transferViewConfigurationStatusDescription,
            icon: CircleCheck
          }
        ].map(({ kind, label, description, icon: Icon }) =>
          <button type="button" key={kind}
            onClick={(event) => openDialog(kind, event.currentTarget)}>
            <Icon size={25} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </button>)}
      </div>
    </section>
    {dialogPortal}
    {feedbackPortal}
  </div>;
}
