import { createElement, useEffect, useRef, useState } from '@wordpress/element';

import { ChevronDown, Copy, Eye, Info, RefreshCcw } from '../../generated/lucide-icons';
import type {
  SettingsCenterBootstrap,
  SettingsCenterStringKey
} from '../../contracts/bootstrap/settings-center-bootstrap';
import { SettingsRow, SettingsToggle } from './SettingsControls';
import { DocumentIcon, ImageLibraryIcon, SlidersIcon } from './settings-center-icons';

type UploadFormat = 'jpg' | 'png' | 'webp' | 'gif';
type ConnectionState = 'pending' | 'testing' | 'connected';

type ImageSettingsDraft = {
  service: string;
  bucket: string;
  domain: string;
  accessKey: string;
  secretKey: string;
  fileNameRule: string;
  backupEnabled: boolean;
  backupService: string;
  backupBucket: string;
  backupDomain: string;
  backupAccessKey: string;
  backupSecretKey: string;
  backupSameObjectKey: boolean;
  backupFailureMode: string;
  insertMarkdown: boolean;
  compressImages: boolean;
  preserveFileName: boolean;
  copyUrl: boolean;
  retryCount: string;
  maxImageSize: string;
  uploadFormats: Record<UploadFormat, boolean>;
  insertFormat: string;
  altSource: string;
  captionMode: string;
  featuredPlaceholder: boolean;
};

const FILE_NAME_RULE_PRESETS: ReadonlyArray<Readonly<{
  label: SettingsCenterStringKey;
  value: string;
}>> = [
  { label: 'fileNamePresetDate', value: '{date}/{uuid}.{ext}' },
  { label: 'fileNamePresetMd5', value: '{year}/{month}/{md5}.{ext}' },
  { label: 'fileNamePresetYearMonth', value: '{year}/{month}/{uuid}.{ext}' },
  { label: 'fileNamePresetOriginal', value: '{date}/{name}.{ext}' },
  { label: 'fileNamePresetArticle', value: '{post_id}/{name}.{ext}' },
  { label: 'fileNamePresetTime', value: '{date}/{time}.{ext}' }
];

const FILE_NAME_RULE_VARIABLES: ReadonlyArray<Readonly<{
  token: string;
  label: SettingsCenterStringKey;
}>> = [
  { token: '{year}', label: 'yearVariable' },
  { token: '{month}', label: 'monthVariable' },
  { token: '{day}', label: 'dayVariable' },
  { token: '{date}', label: 'fullDateVariable' },
  { token: '{time}', label: 'uploadTimeVariable' },
  { token: '{post_id}', label: 'postIdVariable' },
  { token: '{md5}', label: 'fileMd5Variable' },
  { token: '{uuid}', label: 'uuidVariable' },
  { token: '{name}', label: 'originalNameVariable' },
  { token: '{ext}', label: 'extensionVariable' }
];

const UPLOAD_FORMAT_OPTIONS: ReadonlyArray<Readonly<{
  key: UploadFormat;
  label: SettingsCenterStringKey;
  accessibleLabel: SettingsCenterStringKey;
}>> = [
  { key: 'jpg', label: 'uploadFormatJpg', accessibleLabel: 'allowUploadJpg' },
  { key: 'png', label: 'uploadFormatPng', accessibleLabel: 'allowUploadPng' },
  { key: 'webp', label: 'uploadFormatWebp', accessibleLabel: 'allowUploadWebp' },
  { key: 'gif', label: 'uploadFormatGif', accessibleLabel: 'allowUploadGif' }
];

function renderFileNameRuleExample(rule: string): string {
  const replacements: Readonly<Record<string, string>> = {
    '{year}': '2026',
    '{month}': '07',
    '{day}': '13',
    '{date}': '20260713',
    '{time}': '121930',
    '{post_id}': '128',
    '{md5}': '9f86d081884c7d659a2feaa0c55ad015',
    '{uuid}': 'a8f4c2d1',
    '{name}': 'header-image',
    '{ext}': 'webp'
  };

  return Object.entries(replacements).reduce(
    (example, [token, value]) => example.replaceAll(token, value),
    rule
  );
}

function useConnectionTest(): readonly [ConnectionState, () => void] {
  const [state, setState] = useState<ConnectionState>('pending');

  useEffect(() => {
    if (state !== 'testing') return undefined;
    const timer = globalThis.setTimeout(() => setState('connected'), 650);
    return () => globalThis.clearTimeout(timer);
  }, [state]);

  return [state, () => setState('testing')] as const;
}

function CompactSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<string>;
  value: string;
}) {
  return <div className="easymde-settings-center__compact-select">
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>
    <ChevronDown size={15} />
  </div>;
}

function ImageTextInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <input className="easymde-settings-center__image-input" aria-label={label}
    value={value} onChange={(event) => onChange(event.target.value)} />;
}

function SecretInput({
  hideLabel,
  label,
  onChange,
  showLabel,
  value
}: {
  hideLabel: string;
  label: string;
  onChange: (value: string) => void;
  showLabel: string;
  value: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="easymde-settings-center__secret-input">
    <input aria-label={label} type={visible ? 'text' : 'password'} value={value}
      onChange={(event) => onChange(event.target.value)} />
    <button type="button" aria-label={visible ? hideLabel : showLabel}
      onClick={() => setVisible((current) => !current)}><Eye size={18} /></button>
  </div>;
}

function ImageField({ children, label }: { children: React.ReactNode; label: string }) {
  return <SettingsRow label={label}>
    <div className="easymde-settings-center__image-field-control">{children}</div>
  </SettingsRow>;
}

function ImageBehaviorRow({
  children,
  description,
  label
}: {
  children: React.ReactNode;
  description?: string;
  label: string;
}) {
  return <SettingsRow label={label} {...(description ? { description } : {})}>
    <div className="easymde-settings-center__image-field-control">{children}</div>
  </SettingsRow>;
}

function FileNameRuleEditor({
  onChange,
  strings,
  value
}: {
  onChange: (value: string) => void;
  strings: SettingsCenterBootstrap['strings'];
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCursorRef = useRef<number | null>(null);

  useEffect(() => {
    const cursor = pendingCursorRef.current;
    if (cursor === null) return;
    const input = inputRef.current;
    if (!input) throw new Error('settings-center-file-name-rule-input-missing');
    pendingCursorRef.current = null;
    input.focus();
    input.setSelectionRange(cursor, cursor);
  }, [value]);

  const insertVariable = (token: string) => {
    const input = inputRef.current;
    if (!input) throw new Error('settings-center-file-name-rule-input-missing');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start === null || end === null) {
      throw new Error('settings-center-file-name-rule-selection-unavailable');
    }
    pendingCursorRef.current = start + token.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  };

  const example = renderFileNameRuleExample(value);
  return <div className="easymde-settings-center__file-name-editor">
    <SettingsRow label={strings.fileNameRule} description={strings.fileNameRuleDescription}>
      <div className="easymde-settings-center__image-field-control">
        <input ref={inputRef} className="easymde-settings-center__file-name-input"
          aria-label={strings.fileNameRule} value={value}
          onChange={(event) => onChange(event.target.value)} />
      </div>
    </SettingsRow>
    <div className="easymde-settings-center__file-name-details">
      <div aria-hidden="true" />
      <div>
        <div className="easymde-settings-center__file-name-template-heading">
          <span>{strings.commonFileNameTemplates}</span>
          <span>{strings.selectTemplateToFillRule}</span>
        </div>
        <div className="easymde-settings-center__file-name-presets">
          {FILE_NAME_RULE_PRESETS.map((preset, index) => {
            const active = value === preset.value;
            return <button key={preset.value} type="button" aria-label={strings[preset.label]}
              aria-pressed={active}
              data-preset-index={index} onClick={() => onChange(preset.value)}>
              <span className="easymde-settings-center__preset-radio">
                {active ? <span /> : null}
              </span>
              <span><span>{strings[preset.label]}</span><code>{preset.value}</code></span>
            </button>;
          })}
        </div>
        <div className="easymde-settings-center__file-name-variables">
          <span>{strings.availableVariables}</span>
          <div>{FILE_NAME_RULE_VARIABLES.map(({ label, token }) => <button key={token}
            type="button" title={strings[label]}
            aria-label={`${strings.insertFileNameVariable.replace('%s', () => strings[label])} ${token}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => insertVariable(token)}>
            {token}
          </button>)}</div>
        </div>
        <div className="easymde-settings-center__file-name-preview">
          <span>{strings.examplePreview}</span>
          <code>{example || strings.enterFileNameRule}</code>
        </div>
      </div>
    </div>
  </div>;
}

function ConnectionStatusRow({
  buttonLabel,
  label,
  showLastTest,
  start,
  state,
  strings
}: {
  buttonLabel: string;
  label: string;
  showLastTest?: boolean;
  start: () => void;
  state: ConnectionState;
  strings: SettingsCenterBootstrap['strings'];
}) {
  const statusLabel = state === 'testing'
    ? strings.testingConnection
    : state === 'connected'
      ? strings.connected
      : strings.pendingTest;
  return <SettingsRow label={label} minHeight={showLastTest ? 76 : 70}>
    <div className="easymde-settings-center__connection-row">
      <span className="easymde-settings-center__connection-status" data-state={state}>
        <span />{statusLabel}
      </span>
      {showLastTest ? <span className="easymde-settings-center__last-test">
        {strings.lastTest}<span>2025-05-13 12:34</span>
      </span> : null}
      <button type="button" disabled={state === 'testing'} onClick={start}>
        {state === 'testing' ? <RefreshCcw size={15} /> : null}{buttonLabel}
      </button>
    </div>
  </SettingsRow>;
}

export function ImagesSettingsPage({
  strings
}: {
  strings: SettingsCenterBootstrap['strings'];
}) {
  const [settings, setSettings] = useState<ImageSettingsDraft>(() => ({
    service: strings.cloudflareR2,
    bucket: 'easymde-assets',
    domain: 'img.example.com',
    accessKey: 'easymde-access-key-example',
    secretKey: 'easymde-secret-key-example',
    fileNameRule: '{date}/{uuid}.{ext}',
    backupEnabled: true,
    backupService: strings.qiniuKodo,
    backupBucket: 'easymde-backup',
    backupDomain: 'backup.example.com',
    backupAccessKey: 'easymde-backup-access-key-example',
    backupSecretKey: 'easymde-backup-secret-key-example',
    backupSameObjectKey: true,
    backupFailureMode: strings.returnPrimaryUrlOnBackupFailure,
    insertMarkdown: true,
    compressImages: true,
    preserveFileName: false,
    copyUrl: false,
    retryCount: strings.retryTwice,
    maxImageSize: strings.imageSize2560,
    uploadFormats: { jpg: true, png: true, webp: true, gif: true },
    insertFormat: strings.markdownImage,
    altSource: strings.useFileName,
    captionMode: strings.doNotInsert,
    featuredPlaceholder: true
  }));
  const [primaryConnection, testPrimaryConnection] = useConnectionTest();
  const [backupConnection, testBackupConnection] = useConnectionTest();

  function setValue<K extends keyof ImageSettingsDraft>(
    key: K,
    value: ImageSettingsDraft[K]
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const imageHostOptions = [
    strings.cloudflareR2,
    strings.aliyunOss,
    strings.tencentCloudCos,
    strings.customUpload
  ];
  const backupHostOptions = [strings.qiniuKodo, ...imageHostOptions];
  const selectedFormats = UPLOAD_FORMAT_OPTIONS
    .filter(({ key }) => settings.uploadFormats[key])
    .map(({ label }) => strings[label]);

  return <div className="easymde-settings-center__images-page">
    <section className="easymde-settings-center__image-group is-host-service">
      <h2><ImageLibraryIcon size={25} />{strings.imageHostService}</h2>
      <ImageField label={strings.selectImageHostService}>
        <CompactSelect label={strings.selectImageHostService} value={settings.service}
          options={imageHostOptions} onChange={(value) => setValue('service', value)} />
      </ImageField>
      <ImageField label={strings.bucket}>
        <ImageTextInput label={strings.bucket} value={settings.bucket}
          onChange={(value) => setValue('bucket', value)} />
      </ImageField>
      <ImageField label={strings.customDomain}>
        <ImageTextInput label={strings.customDomain} value={settings.domain}
          onChange={(value) => setValue('domain', value)} />
      </ImageField>
      <ImageField label={strings.accessKey}>
        <SecretInput label={strings.accessKey} value={settings.accessKey}
          showLabel={strings.showSecret} hideLabel={strings.hideSecret}
          onChange={(value) => setValue('accessKey', value)} />
      </ImageField>
      <ImageField label={strings.secretKey}>
        <SecretInput label={strings.secretKey} value={settings.secretKey}
          showLabel={strings.showSecret} hideLabel={strings.hideSecret}
          onChange={(value) => setValue('secretKey', value)} />
      </ImageField>
      <FileNameRuleEditor strings={strings} value={settings.fileNameRule}
        onChange={(value) => setValue('fileNameRule', value)} />
      <div className="easymde-settings-center__connection-divider">
        <ConnectionStatusRow label={strings.connectionStatus} state={primaryConnection}
          showLastTest start={testPrimaryConnection} buttonLabel={strings.testConnection}
          strings={strings} />
      </div>
    </section>

    <section className="easymde-settings-center__image-group is-backup-host">
      <h2><Copy size={25} />{strings.backupImageHost}</h2>
      <p className="easymde-settings-center__backup-description">
        {strings.backupImageHostDescription}
      </p>
      <ImageBehaviorRow label={strings.enableBackupImageHost}
        description={strings.enableBackupImageHostDescription}>
        <SettingsToggle label={strings.enableBackupImageHost} checked={settings.backupEnabled}
          onChange={() => setValue('backupEnabled', !settings.backupEnabled)} />
      </ImageBehaviorRow>
      {settings.backupEnabled ? <div className="easymde-settings-center__backup-fields">
        <ImageField label={strings.backupImageHostService}>
          <CompactSelect label={strings.backupImageHostService} value={settings.backupService}
            options={backupHostOptions} onChange={(value) => setValue('backupService', value)} />
        </ImageField>
        <ImageField label={strings.backupBucket}>
          <ImageTextInput label={strings.backupBucket} value={settings.backupBucket}
            onChange={(value) => setValue('backupBucket', value)} />
        </ImageField>
        <ImageField label={strings.backupDomain}>
          <ImageTextInput label={strings.backupDomain} value={settings.backupDomain}
            onChange={(value) => setValue('backupDomain', value)} />
        </ImageField>
        <ImageField label={strings.backupAccessKey}>
          <SecretInput label={strings.backupAccessKey} value={settings.backupAccessKey}
            showLabel={strings.showBackupAccessKey} hideLabel={strings.hideBackupAccessKey}
            onChange={(value) => setValue('backupAccessKey', value)} />
        </ImageField>
        <ImageField label={strings.backupSecretKey}>
          <SecretInput label={strings.backupSecretKey} value={settings.backupSecretKey}
            showLabel={strings.showBackupSecretKey} hideLabel={strings.hideBackupSecretKey}
            onChange={(value) => setValue('backupSecretKey', value)} />
        </ImageField>
        <ImageBehaviorRow label={strings.keepSameObjectPath}
          description={strings.keepSameObjectPathDescription}>
          <SettingsToggle label={strings.keepSameObjectPath} checked={settings.backupSameObjectKey}
            onChange={() => setValue('backupSameObjectKey', !settings.backupSameObjectKey)} />
        </ImageBehaviorRow>
        <ImageBehaviorRow label={strings.backupFailureHandling}
          description={strings.backupFailureHandlingDescription}>
          <CompactSelect label={strings.backupFailureHandling}
            value={settings.backupFailureMode}
            options={[strings.returnPrimaryUrlOnBackupFailure, strings.failEntireUpload]}
            onChange={(value) => setValue('backupFailureMode', value)} />
        </ImageBehaviorRow>
        <div className="easymde-settings-center__backup-connection-divider">
          <ConnectionStatusRow label={strings.backupConnectionStatus} state={backupConnection}
            start={testBackupConnection} buttonLabel={strings.testBackupConnection}
            strings={strings} />
        </div>
      </div> : null}
    </section>

    <section className="easymde-settings-center__image-group is-upload-behavior">
      <h2><SlidersIcon size={25} />{strings.uploadBehavior}</h2>
      <ImageBehaviorRow label={strings.insertMarkdownAfterUpload}>
        <SettingsToggle label={strings.insertMarkdownAfterUpload} checked={settings.insertMarkdown}
          onChange={() => setValue('insertMarkdown', !settings.insertMarkdown)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.compressImages} description={strings.compressImagesDescription}>
        <SettingsToggle label={strings.compressImages} checked={settings.compressImages}
          onChange={() => setValue('compressImages', !settings.compressImages)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.preserveOriginalFileName}
        description={strings.preserveOriginalFileNameDescription}>
        <SettingsToggle label={strings.preserveOriginalFileName} checked={settings.preserveFileName}
          onChange={() => setValue('preserveFileName', !settings.preserveFileName)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.copyImageUrl} description={strings.copyImageUrlDescription}>
        <SettingsToggle label={strings.copyImageUrl} checked={settings.copyUrl}
          onChange={() => setValue('copyUrl', !settings.copyUrl)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.retryFailedUpload}>
        <CompactSelect label={strings.retryFailedUpload} value={settings.retryCount}
          options={[strings.doNotRetry, strings.retryOnce, strings.retryTwice, strings.retryThreeTimes]}
          onChange={(value) => setValue('retryCount', value)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.maximumImageSize}>
        <CompactSelect label={strings.maximumImageSize} value={settings.maxImageSize}
          options={[strings.originalImageSize, strings.imageSize1920, strings.imageSize2560, strings.imageSize3840]}
          onChange={(value) => setValue('maxImageSize', value)} />
      </ImageBehaviorRow>
      <SettingsRow label={strings.allowedUploadFormats}
        description={strings.allowedUploadFormatsDescription} minHeight={82}>
        <div className="easymde-settings-center__upload-formats">
          {UPLOAD_FORMAT_OPTIONS.map(({ accessibleLabel, key, label }) => {
            const checked = settings.uploadFormats[key];
            return <label key={key} data-checked={checked}>
              <input type="checkbox" aria-label={strings[accessibleLabel]} checked={checked}
                onChange={() => setValue('uploadFormats', {
                  ...settings.uploadFormats,
                  [key]: !checked
                })} />
              <span>{strings[label]}</span>
            </label>;
          })}
        </div>
      </SettingsRow>
    </section>

    <section className="easymde-settings-center__image-group is-default-insertion">
      <h2><DocumentIcon size={25} />{strings.defaultInsertion}</h2>
      <ImageBehaviorRow label={strings.defaultInsertFormat}>
        <CompactSelect label={strings.defaultInsertFormat} value={settings.insertFormat}
          options={[strings.markdownImage, strings.htmlImage, strings.urlOnly]}
          onChange={(value) => setValue('insertFormat', value)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.altTextSource}>
        <CompactSelect label={strings.altTextSource} value={settings.altSource}
          options={[strings.useFileName, strings.leaveEmpty, strings.fillOnUpload]}
          onChange={(value) => setValue('altSource', value)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.imageTitleField}>
        <CompactSelect label={strings.imageTitleField} value={settings.captionMode}
          options={[strings.doNotInsert, strings.useFileName, strings.fillOnUpload]}
          onChange={(value) => setValue('captionMode', value)} />
      </ImageBehaviorRow>
      <ImageBehaviorRow label={strings.featuredImagePlaceholder}
        description={strings.featuredImagePlaceholderDescription}>
        <SettingsToggle label={strings.featuredImagePlaceholder}
          checked={settings.featuredPlaceholder}
          onChange={() => setValue('featuredPlaceholder', !settings.featuredPlaceholder)} />
      </ImageBehaviorRow>
      <div className="easymde-settings-center__upload-summary">
        <div><Info size={17} />{strings.currentAllowedUploads.replace(
          '%s',
          () => selectedFormats.join(strings.uploadFormatSeparator)
        )}</div>
        <div>{strings.compressLargeImagesRecommendation}</div>
      </div>
    </section>
  </div>;
}
