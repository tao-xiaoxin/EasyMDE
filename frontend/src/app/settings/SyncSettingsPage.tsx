import {
  createElement,
  createPortal,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';

import {
  BellRing,
  ChevronDown,
  ChevronRight,
  Chrome,
  CircleAlert,
  CircleCheck,
  CircleX,
  ExternalLink,
  Info,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  RefreshCcw,
  Send,
  UserRound,
  WandSparkles,
  X
} from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap } from '../../contracts/bootstrap/settings-center-bootstrap';
import { SettingsRow, SettingsToggle } from './SettingsControls';
import { ArticleSyncIcon, DocumentIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];
type PlatformId = 'zhihu' | 'juejin' | 'blogcn' | 'csdn' | 'segmentfault';
type PlatformStatus = 'logged-in' | 'expired' | 'unauthorized';
type TargetStatus = 'success' | 'failed' | 'syncing' | 'pending';
type HistoryStatus = 'synced' | 'syncing' | 'partial' | 'failed' | 'pending';
type SyncDialog =
  | Readonly<{ kind: 'extension' }>
  | Readonly<{ kind: 'platform'; platformId: PlatformId }>
  | Readonly<{ kind: 'history'; historyId: string }>;

type Platform = Readonly<{
  id: PlatformId;
  name: string;
  mark: string;
  color: string;
  status: PlatformStatus;
  lastSync: string;
}>;

type HistoryItem = Readonly<{
  id: string;
  title: string;
  targets: ReadonlyArray<Readonly<{ platform: PlatformId; status: TargetStatus }>>;
  syncedAt: string;
}>;

const DEFAULT_PLATFORMS: ReadonlyArray<Platform> = [
  { id: 'zhihu', name: '知乎', mark: '知', color: '#0878f9', status: 'logged-in', lastSync: '2025-07-11 10:30' },
  { id: 'juejin', name: '掘金', mark: '◆', color: '#1683ff', status: 'logged-in', lastSync: '2025-07-11 09:45' },
  { id: 'blogcn', name: '博客园', mark: '◒', color: '#43bf4f', status: 'expired', lastSync: '2025-07-10 18:20' },
  { id: 'csdn', name: 'CSDN', mark: 'C', color: '#ff4b16', status: 'logged-in', lastSync: '2025-07-11 10:05' },
  { id: 'segmentfault', name: '思否', mark: 'SF', color: '#171717', status: 'unauthorized', lastSync: '-' }
];

const HISTORY_SEEDS: ReadonlyArray<Omit<HistoryItem, 'id'>> = [
  {
    title: '如何优雅地使用 Markdown 写作',
    targets: DEFAULT_PLATFORMS.map((platform) => ({ platform: platform.id, status: 'success' as const })),
    syncedAt: '2025-07-11 10:30'
  },
  {
    title: 'AI 时代的开发者工具效率提升指南',
    targets: [
      { platform: 'zhihu', status: 'success' },
      { platform: 'juejin', status: 'success' },
      { platform: 'blogcn', status: 'success' },
      { platform: 'csdn', status: 'syncing' },
      { platform: 'segmentfault', status: 'pending' }
    ],
    syncedAt: '2025-07-11 10:28'
  },
  {
    title: 'WordPress 插件开发入门实战',
    targets: [
      { platform: 'juejin', status: 'success' },
      { platform: 'csdn', status: 'success' },
      { platform: 'blogcn', status: 'failed' }
    ],
    syncedAt: '2025-07-11 09:50'
  },
  {
    title: '我的 2025 技术学习路线图',
    targets: DEFAULT_PLATFORMS.map((platform) => ({ platform: platform.id, status: 'failed' as const })),
    syncedAt: '2025-07-10 23:10'
  },
  {
    title: '提升写作效率的 10 个小技巧',
    targets: DEFAULT_PLATFORMS.map((platform) => ({ platform: platform.id, status: 'pending' as const })),
    syncedAt: '2025-07-10 21:40'
  }
];

const DEFAULT_HISTORY: ReadonlyArray<HistoryItem> = Array.from({ length: 25 }, (_, index) => {
  const seed = HISTORY_SEEDS[index % HISTORY_SEEDS.length];
  if (!seed) throw new Error('settings-center-sync-history-seed-missing');
  const batch = Math.floor(index / HISTORY_SEEDS.length);
  return {
    ...seed,
    id: `sync-${index + 1}`,
    title: batch === 0 ? seed.title : `${seed.title}（历史记录 ${batch + 1}）`
  };
});

function historyStatus(item: HistoryItem): HistoryStatus {
  if (!item.targets.length) throw new Error(`settings-center-sync-history-${item.id}-empty`);
  const success = item.targets.filter((target) => target.status === 'success').length;
  const failed = item.targets.filter((target) => target.status === 'failed').length;
  const syncing = item.targets.filter((target) => target.status === 'syncing').length;
  const pending = item.targets.filter((target) => target.status === 'pending').length;
  if (success === item.targets.length) return 'synced';
  if (failed === item.targets.length) return 'failed';
  if (pending === item.targets.length) return 'pending';
  if (syncing > 0 || pending > 0) return 'syncing';
  if (success > 0 && failed > 0) return 'partial';
  throw new Error(`settings-center-sync-history-${item.id}-status-invalid`);
}

function formatHistorySummary(
  template: string,
  values: Readonly<[string, string, string]>
): ReadonlyArray<string> {
  const replacements: Readonly<Record<string, string>> = {
    '%1$s': values[0],
    '%2$s': values[1],
    '%3$s': values[2]
  };

  return template
    .split(/(%[123]\$s)/g)
    .filter((part) => part !== '')
    .map((part) => replacements[part] ?? part);
}

function formatSinglePlaceholder(template: string, value: string): ReadonlyArray<string> {
  return template
    .split(/(%s)/g)
    .filter((part) => part !== '')
    .map((part) => part === '%s' ? value : part);
}

function SyncSelect({
  className = '',
  label,
  value,
  options,
  width = 300,
  height = 40,
  onChange
}: {
  className?: string;
  label: string;
  value: string;
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  width?: number;
  height?: number;
  onChange: (value: string) => void;
}) {
  const sizeClassName = height === 40 ? 'is-default' : 'is-compact';
  return <span className={`easymde-settings-center__sync-select ${sizeClassName} ${className}`.trim()} style={{ width }}>
    <select aria-label={label} value={value} style={{ height }} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <ChevronDown size={15} strokeWidth={height === 40 ? 2.2 : 2} />
  </span>;
}

function PlatformLogo({ platform, size = 39 }: { platform: Platform; size?: number }) {
  const fontSize = platform.id === 'segmentfault' ? size * 0.3 : size * 0.48;
  return <span aria-hidden="true" className="easymde-settings-center__sync-platform-logo"
    style={{ width: size, height: size, background: platform.color, fontSize }}>{platform.mark}</span>;
}

function PlatformStatusBadge({ status, strings }: { status: PlatformStatus; strings: Strings }) {
  return <span className="easymde-settings-center__sync-platform-status" data-status={status}>
    {platformStatusLabel(status, strings)}
  </span>;
}

function platformStatusLabel(status: PlatformStatus, strings: Strings): string {
  return status === 'logged-in' ? strings.syncLoggedIn
    : status === 'expired' ? strings.syncLoginExpired : strings.syncUnauthorized;
}

function TargetBadge({
  target,
  platform,
  strings
}: {
  target: HistoryItem['targets'][number];
  platform: Platform;
  strings: Strings;
}) {
  const config = target.status === 'success'
    ? { icon: CircleCheck, label: strings.syncSynced }
    : target.status === 'failed'
      ? { icon: CircleX, label: strings.syncFailed }
      : target.status === 'syncing'
        ? { icon: RefreshCcw, label: strings.syncSyncing }
        : { icon: CircleAlert, label: strings.syncPending };
  const StatusIcon = config.icon;
  return <span role="img" aria-label={`${platform.name}: ${config.label}`}
    className="easymde-settings-center__sync-target" data-status={target.status}>
    <PlatformLogo platform={platform} size={30} />
    <span><StatusIcon size={17} strokeWidth={2.4} /></span>
  </span>;
}

function HistoryStatusView({ item, strings }: { item: HistoryItem; strings: Strings }) {
  const status = historyStatus(item);
  const successCount = item.targets.filter((target) => target.status === 'success').length;
  const config = status === 'synced'
    ? { icon: CircleCheck, label: strings.syncSynced }
    : status === 'syncing'
      ? { icon: RefreshCcw, label: strings.syncSyncing }
      : status === 'partial'
        ? { icon: CircleAlert, label: `${strings.syncPartialFailure}（${successCount}/${item.targets.length}）` }
        : status === 'failed'
          ? { icon: CircleX, label: strings.syncFailed }
          : { icon: CircleCheck, label: strings.syncPending };
  const StatusIcon = config.icon;
  return <span className="easymde-settings-center__sync-history-status" data-status={status}>
    <StatusIcon size={16} />{config.label}
  </span>;
}

function SyncExtensionDialog({
  platforms,
  strings,
  onClose,
  onCheck
}: {
  platforms: ReadonlyArray<Platform>;
  strings: Strings;
  onClose: () => void;
  onCheck: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const authorizedCount = platforms.filter((platform) => platform.status === 'logged-in').length;

  useEffect(() => {
    const button = closeButtonRef.current;
    if (!button) throw new Error('settings-center-sync-extension-dialog-close-missing');
    button.focus();
  }, []);

  return <div className="easymde-settings-center__transfer-dialog-layer"
    role="presentation">
    <button type="button" className="easymde-settings-center__sync-dialog-backdrop"
      aria-label={strings.closeSyncOperationDialog} onClick={onClose} />
    <div role="dialog" aria-modal="true"
      aria-labelledby="easymde-sync-extension-dialog-title"
      className="easymde-settings-center__transfer-dialog easymde-settings-center__sync-extension-dialog">
      <header>
        <span><Puzzle size={20} /></span>
        <div>
          <h2 id="easymde-sync-extension-dialog-title">{strings.syncExtensionDialogTitle}</h2>
          <p>{strings.syncExtensionDialogDescription}</p>
        </div>
        <button ref={closeButtonRef} type="button"
          aria-label={strings.closeSyncOperationDialog} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="easymde-settings-center__transfer-dialog-body">
        <div className="easymde-settings-center__sync-extension-summary">
          <div><small>{strings.syncExtensionVersion}</small><strong>1.2.0</strong></div>
          <div><small>{strings.connectionStatus}</small><strong className="is-connected">{strings.syncConnectedBadge}</strong></div>
          <div><small>{strings.syncAuthorizedPlatforms}</small><strong>{authorizedCount} / {platforms.length}</strong></div>
        </div>
        <div className="easymde-settings-center__sync-extension-platforms">
          {platforms.map((platform) => <div key={platform.id}>
            <PlatformLogo platform={platform} size={28} />
            <strong>{platform.name}</strong>
            <span><PlatformStatusBadge status={platform.status} strings={strings} /></span>
          </div>)}
        </div>
        <p className="easymde-settings-center__sync-extension-privacy">
          {strings.syncExtensionCredentialsPrivacy}
        </p>
      </div>
      <footer>
        <button type="button" className="is-leading-action" onClick={onCheck}>
          <RefreshCcw size={15} />{strings.syncRecheckConnection}
        </button>
        <button type="button" onClick={onClose}>{strings.transferClose}</button>
      </footer>
    </div>
  </div>;
}

function SyncPlatformDialog({
  platform,
  strings,
  onClose,
  onCheck,
  onHistory,
  onRevoke
}: {
  platform: Platform;
  strings: Strings;
  onClose: () => void;
  onCheck: () => void;
  onHistory: () => void;
  onRevoke: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const button = closeButtonRef.current;
    if (!button) throw new Error('settings-center-sync-platform-dialog-close-missing');
    button.focus();
  }, []);

  return <div className="easymde-settings-center__transfer-dialog-layer" role="presentation">
    <button type="button" className="easymde-settings-center__sync-dialog-backdrop"
      aria-label={strings.closeSyncOperationDialog} onClick={onClose} />
    <div role="dialog" aria-modal="true"
      aria-labelledby="easymde-sync-platform-dialog-title"
      className="easymde-settings-center__transfer-dialog easymde-settings-center__sync-platform-dialog">
      <header>
        <span><MoreHorizontal size={21} /></span>
        <div>
          <h2 id="easymde-sync-platform-dialog-title">
            {strings.syncPlatformDialogTitle.replace('%s', () => platform.name)}
          </h2>
          <p>{strings.syncPlatformDialogDescription}</p>
        </div>
        <button ref={closeButtonRef} type="button"
          aria-label={strings.closeSyncOperationDialog} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="easymde-settings-center__transfer-dialog-body">
        <div>
          <div className="easymde-settings-center__sync-platform-dialog-summary">
            <PlatformLogo platform={platform} size={44} />
            <div><div>{platform.name}</div><div><PlatformStatusBadge status={platform.status} strings={strings} /></div></div>
            <div><div>{strings.syncRecentSync}</div><div>{platform.lastSync}</div></div>
          </div>
          <div className="easymde-settings-center__sync-platform-dialog-actions">
            <button type="button" onClick={onCheck}>
              <RefreshCcw size={18} />
              {platform.status === 'logged-in'
                ? strings.syncCheckCurrentAuthorization
                : strings.syncReauthorizePlatform}
              <ChevronRight className="is-chevron" size={16} />
            </button>
            <button type="button" onClick={onHistory}>
              <DocumentIcon size={18} />{strings.syncViewPlatformHistory}
              <ChevronRight className="is-chevron" size={16} />
            </button>
            {platform.status !== 'unauthorized' ? <button type="button" onClick={onRevoke}>
              <X size={18} />{strings.syncRevokeAuthorization}
            </button> : null}
          </div>
        </div>
      </div>
      <footer><button type="button" onClick={onClose}>{strings.transferClose}</button></footer>
    </div>
  </div>;
}

function SyncHistoryDialog({
  item,
  platforms,
  strings,
  onClose,
  onUpdate,
  onViewArticle
}: {
  item: HistoryItem;
  platforms: ReadonlyArray<Platform>;
  strings: Strings;
  onClose: () => void;
  onUpdate: (status: TargetStatus) => void;
  onViewArticle: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const status = historyStatus(item);
  const counts = {
    success: item.targets.filter((target) => target.status === 'success').length,
    failed: item.targets.filter((target) => target.status === 'failed').length,
    syncing: item.targets.filter((target) => target.status === 'syncing').length,
    pending: item.targets.filter((target) => target.status === 'pending').length
  };

  useEffect(() => {
    const button = closeButtonRef.current;
    if (!button) throw new Error('settings-center-sync-history-dialog-close-missing');
    button.focus();
  }, []);

  const targetPresentation = (targetStatus: TargetStatus) => {
    if (targetStatus === 'success') return {
      Icon: CircleCheck,
      label: strings.syncTargetSuccess,
      description: strings.syncTargetSuccessDescription
    };
    if (targetStatus === 'failed') return {
      Icon: CircleX,
      label: strings.syncTargetFailure,
      description: strings.syncTargetFailureDescription
    };
    if (targetStatus === 'syncing') return {
      Icon: RefreshCcw,
      label: strings.syncSyncing,
      description: strings.syncTargetSyncingDescription
    };
    return {
      Icon: CircleAlert,
      label: strings.syncPending,
      description: strings.syncTargetPendingDescription
    };
  };

  return <div className="easymde-settings-center__sync-history-dialog-layer" role="presentation">
    <button type="button" className="easymde-settings-center__sync-dialog-backdrop"
      aria-label={strings.closeSyncHistoryDetail} onClick={onClose} />
    <div role="dialog" aria-modal="true"
      aria-labelledby="easymde-sync-history-dialog-title"
      className="easymde-settings-center__sync-history-dialog">
      <header>
        <span><DocumentIcon size={21} /></span>
        <div>
          <h2 id="easymde-sync-history-dialog-title">{strings.syncHistoryDetailTitle}</h2>
          <p>{strings.syncHistoryDetailDescription}</p>
        </div>
        <button ref={closeButtonRef} type="button"
          aria-label={strings.closeSyncHistoryDetail} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="easymde-settings-center__sync-history-dialog-body">
        <section className="easymde-settings-center__sync-history-detail-heading">
          <div><small>{strings.syncArticleTitle}</small><strong>{item.title}</strong></div>
          <div><small>{strings.syncOverallStatus}</small><HistoryStatusView item={item} strings={strings} />
            <p>{strings.syncTime} {item.syncedAt}</p></div>
        </section>
        <section className="easymde-settings-center__sync-history-counts"
          aria-label={strings.syncResultSummary}>
          {[
            [strings.syncTargetSuccess, counts.success, 'success'],
            [strings.syncTargetFailure, counts.failed, 'failed'],
            [strings.syncSyncing, counts.syncing, 'syncing'],
            [strings.syncPending, counts.pending, 'pending']
          ].map(([label, count, countStatus]) => <div key={String(label)} data-status={countStatus}>
            <strong>{count}</strong><small>{label}</small>
          </div>)}
        </section>
        <section className="easymde-settings-center__sync-history-platform-results">
          <div><h3>{strings.syncPlatformResults}</h3><span>
            {formatSinglePlaceholder(strings.syncTargetPlatformCount, String(item.targets.length))}
          </span></div>
          <div>
            {item.targets.map((target) => {
              const platform = platforms.find((candidate) => candidate.id === target.platform);
              if (!platform) throw new Error(`settings-center-sync-platform-${target.platform}-missing`);
              const presentation = targetPresentation(target.status);
              const StatusIcon = presentation.Icon;
              return <article key={target.platform}>
                <div><PlatformLogo platform={platform} size={40} /><span>
                  <strong>{platform.name}</strong>
                  <small>{platformStatusLabel(platform.status, strings)}</small>
                </span></div>
                <span data-status={target.status}>
                  <StatusIcon size={17} />{presentation.label}
                </span>
                {target.status === 'success'
                  ? <div><span>{presentation.description}</span><button type="button" onClick={onViewArticle}>
                    {strings.syncViewArticle}<ExternalLink size={14} />
                  </button></div>
                  : target.status === 'failed'
                    ? <div className="is-failure"><strong>{strings.syncFailureReason}</strong>{presentation.description}</div>
                    : <div>{presentation.description}</div>}
              </article>;
            })}
          </div>
        </section>
      </div>
      <footer>
        <button type="button" onClick={onClose}>{strings.transferClose}</button>
        {status === 'failed' || status === 'partial' || status === 'pending'
          ? <button type="button" className="is-primary" onClick={() => onUpdate('syncing')}>
            {status === 'pending' ? strings.syncStartNow : strings.syncRetryFailedPlatforms}
          </button>
          : null}
        {status === 'syncing'
          ? <button type="button" className="is-cancel" onClick={() => onUpdate('pending')}>
            {strings.syncCancel}
          </button>
          : null}
      </footer>
    </div>
  </div>;
}

export function SyncSettingsPage({
  overlayRoot,
  strings
}: {
  overlayRoot: HTMLDivElement | null;
  strings: Strings;
}) {
  const [platforms, setPlatforms] = useState(DEFAULT_PLATFORMS);
  const [history, setHistory] = useState(DEFAULT_HISTORY);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationTrigger, setNotificationTrigger] = useState('failed-or-partial');
  const [notificationTiming, setNotificationTiming] = useState('article');
  const [messageTemplate, setMessageTemplate] = useState('platform-details');
  const [browserEnabled, setBrowserEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [dingTalkEnabled, setDingTalkEnabled] = useState(false);
  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [weComEnabled, setWeComEnabled] = useState(false);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageInput, setPageInput] = useState('1');
  const [dialog, setDialog] = useState<SyncDialog | null>(null);
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

  const showFeedback = (message: string) => setFeedback(message);
  const checkAllStatuses = () => {
    if (checking) return;
    setChecking(true);
    setPlatforms((current) => current.map((platform) => ({ ...platform, status: 'logged-in' })));
    setChecking(false);
    showFeedback(strings.syncStatusesChecked);
  };
  const authorizePlatform = (id: PlatformId) => {
    setPlatforms((current) => current.map((platform) => platform.id === id
      ? { ...platform, status: 'logged-in', lastSync: strings.syncJustNow }
      : platform));
    const platform = platforms.find((candidate) => candidate.id === id);
    if (!platform) throw new Error(`settings-center-sync-platform-${id}-missing`);
    showFeedback(strings.syncPlatformChecked.replace('%s', () => platform.name));
  };
  const openDialog = (nextDialog: SyncDialog, trigger: HTMLButtonElement) => {
    dialogTriggerRef.current = trigger;
    setDialog(nextDialog);
  };
  const closeDialog = () => setDialog(null);
  const revokePlatform = (id: PlatformId) => {
    const platform = platforms.find((candidate) => candidate.id === id);
    if (!platform) throw new Error(`settings-center-sync-platform-${id}-missing`);
    setPlatforms((current) => current.map((candidate) => candidate.id === id
      ? { ...candidate, status: 'unauthorized' }
      : candidate));
    setDialog(null);
    showFeedback(strings.syncPlatformRevoked.replace('%s', () => platform.name));
  };

  const filteredHistory = history.filter((item) => {
    const matchesPlatform = platformFilter === 'all'
      || item.targets.some((target) => target.platform === platformFilter);
    const matchesStatus = statusFilter === 'all' || historyStatus(item) === statusFilter;
    return matchesPlatform && matchesStatus;
  });
  const pageCount = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const effectivePage = Math.min(page, pageCount);
  const paginatedHistory = filteredHistory.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5);

  const changeFilters = (kind: 'platform' | 'status', value: string) => {
    if (kind === 'platform') setPlatformFilter(value);
    else setStatusFilter(value);
    setPage(1);
    setPageInput('1');
  };
  const changePage = (nextPage: number) => {
    const bounded = Math.max(1, Math.min(nextPage, pageCount));
    setPage(bounded);
    setPageInput(String(bounded));
  };
  const jumpToPage = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) throw new Error('settings-center-sync-page-invalid');
    changePage(parsed);
  };
  const updateHistoryStatus = (id: string, status: TargetStatus) => {
    setHistory((current) => current.map((item) => item.id === id
      ? { ...item, targets: item.targets.map((target) => ({ ...target, status })) }
      : item));
  };
  const selectedPlatform = dialog?.kind === 'platform'
    ? platforms.find((platform) => platform.id === dialog.platformId)
    : null;
  if (dialog?.kind === 'platform' && !selectedPlatform) {
    throw new Error(`settings-center-sync-platform-${dialog.platformId}-missing`);
  }
  const selectedHistory = dialog?.kind === 'history'
    ? history.find((item) => item.id === dialog.historyId)
    : null;
  if (dialog?.kind === 'history' && !selectedHistory) {
    throw new Error(`settings-center-sync-history-${dialog.historyId}-missing`);
  }

  const feedbackPortal = feedback && overlayRoot ? createPortal(
    <div className="easymde-settings-center__sync-feedback" role="status">
      <CircleCheck size={18} /><span>{feedback}</span>
      <button type="button" aria-label={strings.closeSyncFeedback} onClick={() => setFeedback(null)}><X size={15} /></button>
    </div>,
    overlayRoot
  ) : null;
  const dialogPortal = dialog && overlayRoot ? createPortal(
    dialog.kind === 'extension'
      ? <SyncExtensionDialog platforms={platforms} strings={strings}
        onClose={closeDialog}
        onCheck={() => {
          checkAllStatuses();
          closeDialog();
        }} />
      : dialog.kind === 'platform' && selectedPlatform
        ? <SyncPlatformDialog platform={selectedPlatform} strings={strings}
          onClose={closeDialog}
          onCheck={() => {
            authorizePlatform(selectedPlatform.id);
            closeDialog();
          }}
          onHistory={() => {
            changeFilters('platform', selectedPlatform.id);
            closeDialog();
            window.requestAnimationFrame(() => {
              document.getElementById('easymde-sync-history-heading')?.scrollIntoView({
                block: 'start'
              });
            });
          }}
          onRevoke={() => revokePlatform(selectedPlatform.id)} />
        : dialog.kind === 'history' && selectedHistory
          ? <SyncHistoryDialog item={selectedHistory} platforms={platforms} strings={strings}
            onClose={closeDialog}
            onUpdate={(status) => {
              updateHistoryStatus(selectedHistory.id, status);
              closeDialog();
            }}
            onViewArticle={() => showFeedback(strings.syncArticleLinkPending)} />
          : null,
    overlayRoot
  ) : null;

  return <div className="easymde-settings-center__sync-page">
    <section className="easymde-settings-center__sync-group is-extension">
      <div className="easymde-settings-center__sync-heading-row">
        <div>
          <h2><Puzzle size={24} />{strings.syncBrowserExtensionConnection}
            <span className="easymde-settings-center__sync-connected-badge">{strings.syncConnectedBadge}</span>
          </h2>
          <p>{strings.syncExtensionDescription}</p>
        </div>
        <div className="easymde-settings-center__sync-heading-actions">
          <button type="button" onClick={checkAllStatuses}>{strings.syncCheckConnection}</button>
          <button type="button" onClick={(event) => {
            openDialog({ kind: 'extension' }, event.currentTarget);
          }}>{strings.syncOpenExtensionSettings}</button>
        </div>
      </div>
      <div className="easymde-settings-center__sync-extension-facts">
        <div><ArticleSyncIcon size={25} /><span><small>{strings.syncExtensionVersion}</small><strong>{strings.syncExtensionVersionValue}</strong></span></div>
        <div><Chrome size={25} /><span><small>{strings.syncCurrentBrowser}</small><strong>{strings.syncCurrentBrowserValue}</strong></span></div>
        <div><UserRound size={25} /><span><small>{strings.syncConnectedDevice}</small><strong>{strings.syncConnectedDeviceValue}</strong></span></div>
        <div className="easymde-settings-center__sync-heartbeat">
          <i />{`${strings.syncLastHeartbeat} | ${strings.syncJustNow}`}
        </div>
      </div>
    </section>

    <section className="easymde-settings-center__sync-group is-platforms">
      <div className="easymde-settings-center__sync-heading-row">
        <div><h2><RefreshCcw size={24} className={checking ? 'easymde-settings-center__connection-spinner' : undefined} />{strings.syncPlatformStatus}</h2><p>{strings.syncPlatformStatusDescription}</p></div>
        <button type="button" className="easymde-settings-center__sync-check-all" disabled={checking} onClick={checkAllStatuses}>
          <RefreshCcw size={15} />{strings.syncCheckAllStatus}
        </button>
      </div>
      <div className="easymde-settings-center__sync-platform-list">
        {platforms.map((platform) => <article key={platform.id}>
          <div className="easymde-settings-center__sync-platform-name">
            <PlatformLogo platform={platform} />
            <div><h3>{platform.name}</h3><div><PlatformStatusBadge status={platform.status} strings={strings} /></div></div>
          </div>
          <div className="easymde-settings-center__sync-last-sync"><small>{strings.syncRecentSync}</small><span>{platform.lastSync}</span></div>
          <div className="easymde-settings-center__sync-platform-actions">
            <button type="button" onClick={() => authorizePlatform(platform.id)}>{platform.status === 'logged-in' ? strings.syncCheckStatus : platform.status === 'expired' ? strings.syncReauthorize : strings.syncAuthorize}</button>
            <button type="button" aria-label={strings.syncMoreActions.replace('%s', () => platform.name)}
              onClick={(event) => openDialog({
                kind: 'platform',
                platformId: platform.id
              }, event.currentTarget)}><MoreHorizontal size={17} /></button>
          </div>
        </article>)}
      </div>
      <p className="easymde-settings-center__sync-privacy-hint">{strings.syncPrivacyHint}</p>
    </section>

    <section className="easymde-settings-center__sync-group is-notifications">
      <div className="easymde-settings-center__sync-heading-row">
        <div><h2><BellRing size={24} />{strings.syncNotification}</h2><p>{strings.syncNotificationDescription}</p></div>
        <button type="button" className="easymde-settings-center__sync-test-message" onClick={() => showFeedback(strings.syncTestMessageSent)}><Send size={16} />{strings.syncSendTestMessage}</button>
      </div>
      <div className="easymde-settings-center__sync-settings-list">
        <SettingsRow minHeight={65} label={strings.syncEnableNotifications} description={strings.syncEnableNotificationsDescription}><SettingsToggle label={strings.syncEnableNotifications} checked={notificationsEnabled} onChange={() => setNotificationsEnabled(!notificationsEnabled)} /></SettingsRow>
        <SettingsRow label={strings.syncNotificationTrigger}><SyncSelect label={strings.syncNotificationTrigger} value={notificationTrigger} options={[
          { value: 'all', label: strings.syncAllResults },
          { value: 'failed-or-partial', label: strings.syncFailedOrPartial },
          { value: 'all-failed', label: strings.syncOnlyAllFailed }
        ]} onChange={setNotificationTrigger} /></SettingsRow>
        <SettingsRow label={strings.syncNotificationTiming}><SyncSelect label={strings.syncNotificationTiming} value={notificationTiming} options={[
          { value: 'article', label: strings.syncAfterEachArticle },
          { value: 'batch', label: strings.syncAfterBatch }
        ]} onChange={setNotificationTiming} /></SettingsRow>
        <div className="easymde-settings-center__sync-template-heading"><h3><WandSparkles size={18} />{strings.syncMessageTemplate}</h3><p>{strings.syncMessageTemplateDescription}</p></div>
        <SettingsRow label={strings.syncTemplateType} description={strings.syncTemplatePlatformDetailsDescription}><SyncSelect label={strings.syncTemplateType} value={messageTemplate} options={[
          { value: 'compact', label: strings.syncTemplateCompact },
          { value: 'platform-details', label: strings.syncTemplatePlatformDetails },
          { value: 'failure-alert', label: strings.syncTemplateFailureAlert },
          { value: 'custom', label: strings.syncTemplateCustom }
        ]} onChange={setMessageTemplate} /></SettingsRow>
        <SettingsRow minHeight={150} label={strings.syncExamplePreview} description={strings.syncExamplePreviewDescription}>
          <div className="easymde-settings-center__sync-template-preview"><div>{strings.syncTemplatePreviewTitle}</div><pre>{strings.syncTemplatePreviewBody}</pre></div>
        </SettingsRow>
        <SettingsRow minHeight={65} label={strings.syncBrowserNotification} description={strings.syncBrowserNotificationDescription}><SettingsToggle label={strings.syncBrowserNotification} checked={browserEnabled} onChange={() => setBrowserEnabled(!browserEnabled)} /></SettingsRow>
        <SettingsRow minHeight={65} label={strings.syncEmailNotification} description={strings.syncEmailNotificationDescription}><SettingsToggle label={strings.syncEmailNotification} checked={emailEnabled} onChange={() => setEmailEnabled(!emailEnabled)} /></SettingsRow>
        {emailEnabled ? <div className="easymde-settings-center__sync-inline-fields"><label>{strings.syncEmailNotification}<input type="email" aria-label={strings.syncEmailNotification} placeholder="receiver@example.com" /></label></div> : null}
        <SettingsRow minHeight={65} label={strings.syncCustomWebhook} description={strings.syncCustomWebhookDescription}><SettingsToggle label={strings.syncCustomWebhook} checked={webhookEnabled} onChange={() => setWebhookEnabled(!webhookEnabled)} /></SettingsRow>
        {webhookEnabled ? <div className="easymde-settings-center__sync-inline-fields"><label>{strings.syncCustomWebhook}<input type="url" aria-label={strings.syncCustomWebhook} placeholder={strings.syncWebhookPlaceholder} /></label></div> : null}
        <div className="easymde-settings-center__sync-template-heading"><h3><MessageSquare size={18} />{strings.syncGroupBotNotifications}</h3><p>{strings.syncGroupBotNotificationsDescription}</p></div>
        <SettingsRow minHeight={65} label={strings.syncDingTalk} description={strings.syncDingTalkDescription}><SettingsToggle label={strings.syncDingTalk} checked={dingTalkEnabled} onChange={() => setDingTalkEnabled(!dingTalkEnabled)} /></SettingsRow>
        <SettingsRow minHeight={65} label={strings.syncFeishu} description={strings.syncFeishuDescription}><SettingsToggle label={strings.syncFeishu} checked={feishuEnabled} onChange={() => setFeishuEnabled(!feishuEnabled)} /></SettingsRow>
        <SettingsRow minHeight={65} label={strings.syncWeCom} description={strings.syncWeComDescription}><SettingsToggle label={strings.syncWeCom} checked={weComEnabled} onChange={() => setWeComEnabled(!weComEnabled)} /></SettingsRow>
        <SettingsRow minHeight={65} label={strings.syncIncludeDetails} description={strings.syncIncludeDetailsDescription}><SettingsToggle label={strings.syncIncludeDetails} checked={includeDetails} onChange={() => setIncludeDetails(!includeDetails)} /></SettingsRow>
      </div>
      <div className="easymde-settings-center__sync-notification-note"><Info size={16} /><span>{strings.syncNotificationPrivacy}</span></div>
    </section>

    <section className="easymde-settings-center__sync-group is-history">
      <div className="easymde-settings-center__sync-heading-row">
        <div><h2 id="easymde-sync-history-heading"><DocumentIcon size={24} />{strings.syncHistory}</h2><p>{strings.syncHistoryDescription}</p></div>
        <div className="easymde-settings-center__sync-history-filters">
          <SyncSelect width={150} height={36} label={strings.syncFilterPlatform} value={platformFilter} options={[
            { value: 'all', label: strings.syncAllPlatforms },
            ...platforms.map((platform) => ({ value: platform.id, label: platform.name }))
          ]} onChange={(value) => changeFilters('platform', value)} />
          <SyncSelect width={150} height={36} label={strings.syncFilterStatus} value={statusFilter} options={[
            { value: 'all', label: strings.syncAllStatuses },
            { value: 'synced', label: strings.syncSynced },
            { value: 'syncing', label: strings.syncSyncing },
            { value: 'partial', label: strings.syncPartialFailure },
            { value: 'failed', label: strings.syncFailed },
            { value: 'pending', label: strings.syncPending }
          ]} onChange={(value) => changeFilters('status', value)} />
          <button type="button" onClick={() => showFeedback(strings.syncHistoryRefreshed)}><RefreshCcw size={16} />{strings.syncRefresh}</button>
        </div>
      </div>
      <div className="easymde-settings-center__sync-history-table">
        <div className="easymde-settings-center__sync-history-columns"><span>{strings.syncArticleTitle}</span><span>{strings.syncTargetPlatforms}</span><span>{strings.syncStatus}</span><span>{strings.syncTime}</span><span>{strings.syncActions}</span></div>
        {paginatedHistory.map((item) => {
          const status = historyStatus(item);
          return <div className="easymde-settings-center__sync-history-row" key={item.id}>
            <span title={item.title}>{item.title}</span>
            <span>{item.targets.map((target) => {
              const platform = platforms.find((candidate) => candidate.id === target.platform);
              if (!platform) throw new Error(`settings-center-sync-platform-${target.platform}-missing`);
              return <TargetBadge key={target.platform} target={target} platform={platform} strings={strings} />;
            })}</span>
            <HistoryStatusView item={item} strings={strings} />
            <span>{item.syncedAt}</span>
            <span className="easymde-settings-center__sync-history-actions">
              {status === 'syncing' ? <button type="button" onClick={() => updateHistoryStatus(item.id, 'pending')}>{strings.syncCancel}</button>
                : status === 'pending' ? <button type="button" onClick={() => updateHistoryStatus(item.id, 'syncing')}>{strings.syncStartNow}</button>
                  : status === 'synced' ? null : <button type="button" onClick={() => updateHistoryStatus(item.id, 'syncing')}>{strings.syncRetry}</button>}
              {status !== 'synced' ? <i>|</i> : null}
              <button type="button" onClick={(event) => openDialog({
                kind: 'history',
                historyId: item.id
              }, event.currentTarget)}>{strings.syncViewDetails}</button>
            </span>
          </div>;
        })}
      </div>
      <div className="easymde-settings-center__sync-pagination">
        <span>{formatHistorySummary(strings.syncHistorySummary, [
          String(filteredHistory.length),
          String(effectivePage),
          String(pageCount)
        ])}</span>
        <div>
          <button type="button" className="easymde-settings-center__sync-pagination-arrow"
            aria-label={strings.syncPreviousPage} disabled={effectivePage === 1}
            onClick={() => changePage(effectivePage - 1)}><ChevronRight size={16} /></button>
          {pageNumbers.map((pageNumber) => <button type="button" key={pageNumber} aria-current={pageNumber === effectivePage ? 'page' : undefined} onClick={() => changePage(pageNumber)}>{pageNumber}</button>)}
          <button type="button" className="easymde-settings-center__sync-pagination-arrow"
            aria-label={strings.syncNextPage} disabled={effectivePage === pageCount}
            onClick={() => changePage(effectivePage + 1)}><ChevronRight size={16} /></button>
          <SyncSelect className="is-page-size" width={118} height={34}
            label={strings.syncItemsPerPage} value={String(pageSize)}
            options={[
              { value: '10', label: strings.syncItemsPerPage10 },
              { value: '20', label: strings.syncItemsPerPage20 },
              { value: '50', label: strings.syncItemsPerPage50 }
            ]}
            onChange={(value) => { setPageSize(Number.parseInt(value, 10)); changePage(1); }} />
          <span className="easymde-settings-center__sync-jump-label">{strings.jumpTo}</span>
          <input type="number" min={1} max={pageCount} value={pageInput} aria-label={strings.syncJumpToPage} onChange={(event) => setPageInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') jumpToPage(); }} />
          <button type="button" className="easymde-settings-center__sync-jump-button" onClick={jumpToPage}>{strings.jump}</button>
        </div>
      </div>
    </section>
    {feedbackPortal}
    {dialogPortal}
  </div>;
}
