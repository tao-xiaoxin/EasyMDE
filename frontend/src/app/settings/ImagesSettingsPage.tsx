import {
	createElement,
	createPortal,
	useEffect,
	useRef,
	useState,
} from "@wordpress/element";
import type {
	SettingsCenterBootstrap,
	SettingsCenterStringKey,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type {
	ImageConnectionTarget,
	ImageConnectionTestPort,
} from "../../contracts/ports/image-hosting-connection-port";
import type {
	ImageSettings,
	ImageUploadFormat,
} from "../../contracts/settings-center-settings";
import { Copy, Eye, Info, RefreshCcw, X } from "../../generated/lucide-icons";
import {
	SettingsRow,
	SettingsSelect,
	SettingsToggle,
} from "./SettingsControls";
import {
	DocumentIcon,
	ImageLibraryIcon,
	SlidersIcon,
} from "./settings-center-icons";

type ImageSettingsDraft = ImageSettings;

export type ImageConnectionStatus =
	| "pending"
	| "testing"
	| "connected"
	| "error"
	| "stale";

export type ImageRuntimeCapabilities = Readonly<{
	compressImages: boolean;
	insertAfterUpload: boolean;
	preserveOriginalFileName: boolean;
	maximumImageSize: boolean;
}>;

type ConnectionState = Readonly<{
	status: ImageConnectionStatus;
	testedAt?: string;
	testedFingerprint?: string;
	testedInvalidationToken?: number;
}>;

type ConnectionInvalidationTokens = Readonly<{
	primary: number;
	backup: number;
}>;

const DEFAULT_CONNECTION_INVALIDATION_TOKENS: ConnectionInvalidationTokens = {
	primary: 0,
	backup: 0,
};

const FILE_NAME_RULE_PRESETS: ReadonlyArray<
	Readonly<{
		label: SettingsCenterStringKey;
		value: string;
	}>
> = [
	{ label: "fileNamePresetDate", value: "{date}/{uuid}.{ext}" },
	{ label: "fileNamePresetMd5", value: "{year}/{month}/{md5}.{ext}" },
	{ label: "fileNamePresetYearMonth", value: "{year}/{month}/{uuid}.{ext}" },
	{ label: "fileNamePresetOriginal", value: "{date}/{name}.{ext}" },
	{ label: "fileNamePresetArticle", value: "{post_id}/{name}.{ext}" },
	{ label: "fileNamePresetTime", value: "{date}/{time}.{ext}" },
];

const FILE_NAME_RULE_VARIABLES: ReadonlyArray<
	Readonly<{
		token: string;
		label: SettingsCenterStringKey;
	}>
> = [
	{ token: "{year}", label: "yearVariable" },
	{ token: "{month}", label: "monthVariable" },
	{ token: "{day}", label: "dayVariable" },
	{ token: "{date}", label: "fullDateVariable" },
	{ token: "{time}", label: "uploadTimeVariable" },
	{ token: "{post_id}", label: "postIdVariable" },
	{ token: "{md5}", label: "fileMd5Variable" },
	{ token: "{uuid}", label: "uuidVariable" },
	{ token: "{name}", label: "originalNameVariable" },
	{ token: "{ext}", label: "extensionVariable" },
];

const UPLOAD_FORMAT_OPTIONS: ReadonlyArray<
	Readonly<{
		key: ImageUploadFormat;
		label: SettingsCenterStringKey;
		accessibleLabel: SettingsCenterStringKey;
	}>
> = [
	{ key: "jpg", label: "uploadFormatJpg", accessibleLabel: "allowUploadJpg" },
	{ key: "png", label: "uploadFormatPng", accessibleLabel: "allowUploadPng" },
	{
		key: "webp",
		label: "uploadFormatWebp",
		accessibleLabel: "allowUploadWebp",
	},
	{ key: "gif", label: "uploadFormatGif", accessibleLabel: "allowUploadGif" },
];
type SelectOption = Readonly<{
	disabled?: boolean;
	value: string;
	label: string;
}>;

const LEGACY_IMAGE_VALUE_ALIASES: Readonly<Record<string, string>> = {
	"Cloudflare R2": "cloudflare-r2",
	"Aliyun OSS": "aliyun-oss",
	"Tencent Cloud COS": "tencent-cos",
	"Qiniu Kodo": "qiniu-kodo",
	"Return primary URL on backup failure": "return-primary-url",
	"Fail entire upload": "fail-upload",
	"Do not retry": "none",
	"Retry once": "once",
	"Retry twice": "twice",
	"Retry three times": "three-times",
	"Original image size": "original",
	"1920px": "1920",
	"2560px": "2560",
	"3840px": "3840",
	"Markdown image": "markdown",
	"HTML image": "html",
	"URL only": "url",
	"Use file name": "filename",
	"Leave empty": "empty",
	"Fill on upload": "upload",
	"Do not insert": "none",
};

function normalizeImageValue(
	value: string,
	options: ReadonlyArray<SelectOption>,
	fallback: string,
): string {
	const legacyValue = LEGACY_IMAGE_VALUE_ALIASES[value] ?? value;
	return (
		options.find(
			(option) => option.value === legacyValue || option.label === value,
		)?.value ?? fallback
	);
}

function CompactSelect({
	label,
	onChange,
	options,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<SelectOption>;
	value: string;
}) {
	return (
		<SettingsSelect
			className="easymde-settings-center__compact-select"
			label={label}
			value={value}
			onChange={onChange}
			options={options}
		/>
	);
}

function ImageTextInput({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	value: string;
}) {
	return (
		<input
			className="easymde-settings-center__image-input"
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}

function SecretInput({
	configured,
	hideLabel,
	label,
	onChange,
	showLabel,
	value,
}: {
	configured: boolean;
	hideLabel: string;
	label: string;
	onChange: (value: string) => void;
	showLabel: string;
	value: string;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="easymde-settings-center__secret-input">
			<input
				aria-label={label}
				placeholder={configured && !value ? "••••••••••••" : undefined}
				type={visible ? "text" : "password"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
			<button
				type="button"
				aria-label={visible ? hideLabel : showLabel}
				onClick={() => setVisible((current) => !current)}
			>
				<Eye size={18} />
			</button>
		</div>
	);
}

function ImageField({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<SettingsRow label={label}>
			<div className="easymde-settings-center__image-field-control">
				{children}
			</div>
		</SettingsRow>
	);
}

function ImageBehaviorRow({
	children,
	description,
	label,
}: {
	children: React.ReactNode;
	description?: string;
	label: string;
}) {
	return (
		<SettingsRow
			label={label}
			minHeight={65}
			{...(description ? { description } : {})}
		>
			<div className="easymde-settings-center__image-field-control">
				{children}
			</div>
		</SettingsRow>
	);
}

function FileNameRuleEditor({
	onChange,
	strings,
	value,
}: {
	onChange: (value: string) => void;
	strings: SettingsCenterBootstrap["strings"];
	value: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const pendingCursorRef = useRef<number | null>(null);

	useEffect(() => {
		const cursor = pendingCursorRef.current;
		if (cursor === null) return;
		const input = inputRef.current;
		if (!input) throw new Error("settings-center-file-name-rule-input-missing");
		pendingCursorRef.current = null;
		input.focus();
		input.setSelectionRange(cursor, cursor);
	}, [value]);

	const insertVariable = (token: string) => {
		const input = inputRef.current;
		if (!input) throw new Error("settings-center-file-name-rule-input-missing");
		const start = input.selectionStart;
		const end = input.selectionEnd;
		if (start === null || end === null) {
			throw new Error("settings-center-file-name-rule-selection-unavailable");
		}
		pendingCursorRef.current = start + token.length;
		onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
	};

	const exampleValues: Readonly<Record<string, string>> = {
		"{year}": "2026",
		"{month}": "07",
		"{day}": "13",
		"{date}": "20260713",
		"{time}": "153042",
		"{post_id}": "128",
		"{md5}": "a8f4c2d1",
		"{uuid}": "a8f4c2d1",
		"{name}": "easymde-image",
		"{ext}": "webp",
	};
	const example = Object.entries(exampleValues).reduce(
		(current, [token, replacement]) => current.replaceAll(token, replacement),
		value,
	);
	return (
		<div className="easymde-settings-center__file-name-editor">
			<SettingsRow
				label={strings.fileNameRule}
				description={strings.fileNameRuleDescription}
				minHeight={60}
			>
				<div className="easymde-settings-center__image-field-control">
					<input
						ref={inputRef}
						className="easymde-settings-center__file-name-input"
						aria-label={strings.fileNameRule}
						value={value}
						onChange={(event) => onChange(event.target.value)}
					/>
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
							return (
								<button
									key={preset.value}
									type="button"
									aria-label={strings[preset.label]}
									aria-pressed={active}
									data-preset-index={index}
									onClick={() => onChange(preset.value)}
								>
									<span className="easymde-settings-center__preset-radio">
										{active ? <span /> : null}
									</span>
									<span>
										<span>{strings[preset.label]}</span>
										<code>{preset.value}</code>
									</span>
								</button>
							);
						})}
					</div>
					<div className="easymde-settings-center__file-name-variables">
						<span>{strings.availableVariables}</span>
						<div>
							{FILE_NAME_RULE_VARIABLES.map(({ label, token }) => (
								<button
									key={token}
									type="button"
									title={strings[label]}
									aria-label={`${strings.insertFileNameVariable.replace("%s", () => strings[label])} ${token}`}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => insertVariable(token)}
								>
									{token}
								</button>
							))}
						</div>
					</div>
					<div className="easymde-settings-center__file-name-preview">
						<span>{strings.examplePreview}</span>
						<code>{example || strings.enterFileNameRule}</code>
					</div>
				</div>
			</div>
		</div>
	);
}

function connectionFingerprint(
	settings: ImageSettings,
	target: ImageConnectionTarget,
): string {
	const values =
		target === "primary"
			? [
					settings.service,
					settings.accountId,
					settings.bucket,
					settings.domain,
					settings.accessKey,
					settings.secretKey,
				]
			: [
					settings.backupEnabled ? "enabled" : "disabled",
					settings.backupService,
					settings.backupBucket,
					settings.backupDomain,
					settings.backupAccessKey,
					settings.backupSecretKey,
				];
	return JSON.stringify(values);
}

function ConnectionRow({
	disabled,
	onTest,
	state,
	strings,
	target,
}: {
	disabled: boolean;
	onTest: () => void;
	state: ConnectionState;
	strings: SettingsCenterBootstrap["strings"];
	target: ImageConnectionTarget;
}) {
	const labelByStatus: Readonly<Record<ImageConnectionStatus, string>> = {
		pending: strings.connectionPending,
		testing: strings.testingConnection,
		connected: strings.connected,
		error: strings.connectionFailed,
		stale: strings.connectionStale,
	};
	const isTesting = state.status === "testing";
	return (
		<div
			className={`easymde-settings-center__${target === "backup" ? "backup-" : ""}connection-divider`}
		>
			<SettingsRow
				label={
					target === "backup"
						? strings.backupConnectionStatus
						: strings.connectionStatus
				}
				minHeight={target === "backup" ? 70 : 76}
			>
				<div className="easymde-settings-center__connection-row">
					<div
						className="easymde-settings-center__connection-status"
						data-state={state.status}
						role="status"
						aria-live="polite"
					>
						<span />
						{labelByStatus[state.status]}
					</div>
					{state.testedAt ? (
						<div className="easymde-settings-center__last-test">
							{strings.lastTested.split("%s")[0]}
							<span>{state.testedAt}</span>
							{strings.lastTested.split("%s")[1] ?? ""}
						</div>
					) : null}
					<button
						type="button"
						disabled={disabled || isTesting}
						onClick={onTest}
					>
						{isTesting ? (
							<RefreshCcw
								size={15}
								className="easymde-settings-center__connection-spinner"
							/>
						) : null}
						{target === "backup"
							? strings.testBackupConnection
							: strings.testPrimaryConnection}
					</button>
				</div>
			</SettingsRow>
		</div>
	);
}

export function ImagesSettingsPage({
	connectionInvalidationTokens = DEFAULT_CONNECTION_INVALIDATION_TOKENS,
	connectionTestDisabled = false,
	connectionTestPort,
	draft,
	onChange,
	overlayRoot,
	settings: externalSettings,
	strings,
	runtimeCapabilities,
}: {
	connectionInvalidationTokens?: ConnectionInvalidationTokens;
	connectionTestDisabled?: boolean;
	connectionTestPort?: ImageConnectionTestPort;
	draft: SettingsCenterBootstrap["drafts"]["images"];
	onChange?: (settings: ImageSettingsDraft) => void;
	overlayRoot: HTMLDivElement | null;
	settings?: ImageSettingsDraft;
	strings: SettingsCenterBootstrap["strings"];
	runtimeCapabilities?: ImageRuntimeCapabilities;
}) {
	const imageHostOptions: ReadonlyArray<SelectOption> = [
		{ value: "cloudflare-r2", label: strings.cloudflareR2 },
		{ value: "aliyun-oss", label: strings.aliyunOss, disabled: true },
		{
			value: "tencent-cos",
			label: strings.tencentCloudCos,
			disabled: true,
		},
	];
	const backupHostOptions: ReadonlyArray<SelectOption> = [
		{ value: "qiniu-kodo", label: strings.qiniuKodo },
		...imageHostOptions.map((option) => ({ ...option, disabled: true })),
	];
	const backupFailureOptions: ReadonlyArray<SelectOption> = [
		{
			value: "return-primary-url",
			label: strings.returnPrimaryUrlOnBackupFailure,
		},
	];
	const maxImageSizeOptions: ReadonlyArray<SelectOption> = [
		{ value: "original", label: strings.originalImageSize },
		{ value: "1920", label: strings.imageSize1920 },
		{ value: "2560", label: strings.imageSize2560 },
		{ value: "3840", label: strings.imageSize3840 },
	];
	const insertFormatOptions: ReadonlyArray<SelectOption> = [
		{ value: "markdown", label: strings.markdownImage },
		{ value: "html", label: strings.htmlImage, disabled: true },
		{ value: "url", label: strings.urlOnly },
	];
	const altSourceOptions: ReadonlyArray<SelectOption> = [
		{ value: "filename", label: strings.useFileName },
		{ value: "empty", label: strings.leaveEmpty },
		{ value: "upload", label: strings.fillOnUpload, disabled: true },
	];
	const captionModeOptions: ReadonlyArray<SelectOption> = [
		{ value: "none", label: strings.doNotInsert },
		{ value: "filename", label: strings.useFileName },
		{ value: "upload", label: strings.fillOnUpload, disabled: true },
	];
	const [localSettings, setLocalSettings] = useState<ImageSettingsDraft>(
		() => ({
			service: "cloudflare-r2",
			accountId: "",
			bucket: "easymde-assets",
			domain: draft.domain,
			accessKey: "",
			secretKey: "",
			fileNameRule: "{date}/{uuid}.{ext}",
			backupEnabled: true,
			backupService: "qiniu-kodo",
			backupBucket: "easymde-backup",
			backupDomain: draft.backupDomain,
			backupAccessKey: "",
			backupSecretKey: "",
			backupSameObjectKey: true,
			backupFailureMode: "return-primary-url",
			insertMarkdown: true,
			compressImages: true,
			preserveFileName: false,
			copyUrl: false,
			retryCount: "none",
			maxImageSize: "2560",
			uploadFormats: { jpg: true, png: true, webp: true, gif: true },
			insertFormat: "markdown",
			altSource: "filename",
			captionMode: "none",
			featuredPlaceholder: true,
		}),
	);
	const [formatError, setFormatError] = useState(false);
	const [primaryConnection, setPrimaryConnection] = useState<ConnectionState>({
		status: "pending",
	});
	const [backupConnection, setBackupConnection] = useState<ConnectionState>({
		status: "pending",
	});
	const connectionAbortRef = useRef<
		Partial<Record<ImageConnectionTarget, AbortController>>
	>({});
	const connectionInvalidationTokensRef = useRef(connectionInvalidationTokens);
	connectionInvalidationTokensRef.current = connectionInvalidationTokens;
	const rawSettings = externalSettings ?? localSettings;
	const settings: ImageSettingsDraft = {
		...rawSettings,
		service: "cloudflare-r2",
		backupService: "qiniu-kodo",
		backupFailureMode: normalizeImageValue(
			rawSettings.backupFailureMode,
			[
				{
					value: "return-primary-url",
					label: strings.returnPrimaryUrlOnBackupFailure,
				},
			],
			"return-primary-url",
		),
		retryCount: "none",
		maxImageSize: normalizeImageValue(
			rawSettings.maxImageSize,
			maxImageSizeOptions,
			"2560",
		),
		insertFormat: normalizeImageValue(
			rawSettings.insertFormat,
			insertFormatOptions,
			"markdown",
		),
		altSource: normalizeImageValue(
			rawSettings.altSource,
			altSourceOptions.filter((option) => !option.disabled),
			"filename",
		),
		captionMode: normalizeImageValue(
			rawSettings.captionMode,
			captionModeOptions.filter((option) => !option.disabled),
			"none",
		),
	};
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	useEffect(
		() => () => {
			connectionAbortRef.current.primary?.abort();
			connectionAbortRef.current.backup?.abort();
		},
		[],
	);
	const selectedFormats = UPLOAD_FORMAT_OPTIONS.filter(
		({ key }) => settings.uploadFormats[key],
	).map(({ label }) => strings[label]);
	function setValue<K extends keyof ImageSettingsDraft>(
		key: K,
		value: ImageSettingsDraft[K],
	) {
		const next = { ...settings, [key]: value };
		if (onChange) onChange(next);
		else setLocalSettings(next);
	}
	function toggleUploadFormat(key: ImageUploadFormat) {
		const checked = settings.uploadFormats[key];
		if (checked && selectedFormats.length === 1) {
			setFormatError(true);
			console.error("[EasyMDE settings] Upload format change rejected", {
				format: key,
				reason: "no-upload-format",
			});
			return;
		}
		setFormatError(false);
		setValue("uploadFormats", {
			...settings.uploadFormats,
			[key]: !checked,
		});
	}
	function effectiveConnectionState(
		state: ConnectionState,
		target: ImageConnectionTarget,
	): ConnectionState {
		const invalidationToken = connectionInvalidationTokens[target];
		if (
			state.status !== "testing" &&
			state.testedFingerprint &&
			(state.testedFingerprint !== connectionFingerprint(settings, target) ||
				state.testedInvalidationToken !== invalidationToken)
		) {
			return { ...state, status: "stale" };
		}
		return state;
	}
	async function testConnection(target: ImageConnectionTarget) {
		if (!connectionTestPort) {
			throw new Error("settings-center-image-connection-port-missing");
		}
		connectionAbortRef.current[target]?.abort();
		const controller = new AbortController();
		connectionAbortRef.current[target] = controller;
		const snapshot = settingsRef.current;
		const testedFingerprint = connectionFingerprint(snapshot, target);
		const testedInvalidationToken =
			connectionInvalidationTokensRef.current[target];
		const setState =
			target === "primary" ? setPrimaryConnection : setBackupConnection;
		setState({
			status: "testing",
			testedFingerprint,
			testedInvalidationToken,
		});
		try {
			const result = await connectionTestPort.testConnection({
				target,
				settings: snapshot,
				signal: controller.signal,
			});
			if (controller.signal.aborted) return;
			setState({
				status:
					connectionFingerprint(settingsRef.current, target) ===
						testedFingerprint &&
					connectionInvalidationTokensRef.current[target] ===
						testedInvalidationToken
						? "connected"
						: "stale",
				testedAt: result.testedAt,
				testedFingerprint,
				testedInvalidationToken,
			});
		} catch {
			if (controller.signal.aborted) return;
			console.error("[EasyMDE settings] Image connection test failed", {
				target,
				reason: "connection-test-rejected",
			});
			setState({
				status: "error",
				testedFingerprint,
				testedInvalidationToken,
			});
		}
	}
	const feedbackPortal =
		formatError && overlayRoot
			? createPortal(
					<div
						className="easymde-settings-center__transfer-feedback is-error"
						role="alert"
					>
						<Info size={19} />
						<span>{strings.uploadFormatRequired}</span>
						<button
							type="button"
							aria-label={strings.closeImageFeedback}
							onClick={() => setFormatError(false)}
						>
							<X size={16} />
						</button>
					</div>,
					overlayRoot,
				)
			: null;

	return (
		<div className="easymde-settings-center__images-page">
			<div>
				<section className="easymde-settings-center__image-group is-host-service">
					<h2>
						<ImageLibraryIcon size={25} />
						{strings.imageHostService}
					</h2>
					<div>
						<div>
							<ImageField label={strings.selectImageHostService}>
								<CompactSelect
									label={strings.selectImageHostService}
									value={settings.service}
									options={imageHostOptions}
									onChange={(value) => {
										if (value === "cloudflare-r2") setValue("service", value);
									}}
								/>
							</ImageField>
							<ImageField label={strings.r2AccountId}>
								<ImageTextInput
									label={strings.r2AccountId}
									value={settings.accountId}
									onChange={(value) => setValue("accountId", value)}
								/>
							</ImageField>
							<ImageField label={strings.bucket}>
								<ImageTextInput
									label={strings.bucket}
									value={settings.bucket}
									onChange={(value) => setValue("bucket", value)}
								/>
							</ImageField>
							<ImageField label={strings.customDomain}>
								<ImageTextInput
									label={strings.customDomain}
									value={settings.domain}
									onChange={(value) => setValue("domain", value)}
								/>
							</ImageField>
							<ImageField label={strings.accessKey}>
								<SecretInput
									configured={draft.primaryCredentialsConfigured}
									label={strings.accessKey}
									value={settings.accessKey}
									showLabel={strings.showSecret}
									hideLabel={strings.hideSecret}
									onChange={(value) => setValue("accessKey", value)}
								/>
							</ImageField>
							<ImageField label={strings.secretKey}>
								<SecretInput
									configured={draft.primaryCredentialsConfigured}
									label={strings.secretKey}
									value={settings.secretKey}
									showLabel={strings.showSecret}
									hideLabel={strings.hideSecret}
									onChange={(value) => setValue("secretKey", value)}
								/>
							</ImageField>
							<FileNameRuleEditor
								strings={strings}
								value={settings.fileNameRule}
								onChange={(value) => setValue("fileNameRule", value)}
							/>
						</div>
					</div>
					{connectionTestPort ? (
						<ConnectionRow
							disabled={connectionTestDisabled}
							target="primary"
							strings={strings}
							state={effectiveConnectionState(primaryConnection, "primary")}
							onTest={() => void testConnection("primary")}
						/>
					) : null}
				</section>

				<section className="easymde-settings-center__image-group is-backup-host">
					<h2>
						<Copy size={25} />
						{strings.backupImageHost}
					</h2>
					<p className="easymde-settings-center__backup-description">
						{strings.backupImageHostDescription}
					</p>
					<ImageBehaviorRow
						label={strings.enableBackupImageHost}
						description={strings.enableBackupImageHostDescription}
					>
						<SettingsToggle
							label={strings.enableBackupImageHost}
							checked={settings.backupEnabled}
							onChange={() =>
								setValue("backupEnabled", !settings.backupEnabled)
							}
						/>
					</ImageBehaviorRow>
					{settings.backupEnabled ? (
						<div className="easymde-settings-center__backup-fields">
							<ImageField label={strings.backupImageHostService}>
								<CompactSelect
									label={strings.backupImageHostService}
									value={settings.backupService}
									options={backupHostOptions}
									onChange={(value) => {
										if (value === "qiniu-kodo") {
											setValue("backupService", value);
										}
									}}
								/>
							</ImageField>
							<ImageField label={strings.backupBucket}>
								<ImageTextInput
									label={strings.backupBucket}
									value={settings.backupBucket}
									onChange={(value) => setValue("backupBucket", value)}
								/>
							</ImageField>
							<ImageField label={strings.backupDomain}>
								<ImageTextInput
									label={strings.backupDomain}
									value={settings.backupDomain}
									onChange={(value) => setValue("backupDomain", value)}
								/>
							</ImageField>
							<ImageField label={strings.backupAccessKey}>
								<SecretInput
									configured={draft.backupCredentialsConfigured}
									label={strings.backupAccessKey}
									value={settings.backupAccessKey}
									showLabel={strings.showBackupAccessKey}
									hideLabel={strings.hideBackupAccessKey}
									onChange={(value) => setValue("backupAccessKey", value)}
								/>
							</ImageField>
							<ImageField label={strings.backupSecretKey}>
								<SecretInput
									configured={draft.backupCredentialsConfigured}
									label={strings.backupSecretKey}
									value={settings.backupSecretKey}
									showLabel={strings.showBackupSecretKey}
									hideLabel={strings.hideBackupSecretKey}
									onChange={(value) => setValue("backupSecretKey", value)}
								/>
							</ImageField>
							<fieldset
								disabled
								title={strings.settingsUnavailableDescription}
								className="easymde-settings-center__unavailable-fields"
							>
								<ImageBehaviorRow
									label={strings.keepSameObjectPath}
									description={strings.keepSameObjectPathDescription}
								>
									<SettingsToggle
										label={strings.keepSameObjectPath}
										checked
										onChange={() => undefined}
									/>
								</ImageBehaviorRow>
							</fieldset>
							<fieldset
								disabled
								title={strings.settingsUnavailableDescription}
								className="easymde-settings-center__unavailable-fields"
							>
								<ImageBehaviorRow
									label={strings.backupFailureHandling}
									description={strings.backupFailureHandlingDescription}
								>
									<CompactSelect
										label={strings.backupFailureHandling}
										value={settings.backupFailureMode}
										options={backupFailureOptions}
										onChange={(value) => setValue("backupFailureMode", value)}
									/>
								</ImageBehaviorRow>
							</fieldset>
							{connectionTestPort ? (
								<ConnectionRow
									disabled={connectionTestDisabled}
									target="backup"
									strings={strings}
									state={effectiveConnectionState(backupConnection, "backup")}
									onTest={() => void testConnection("backup")}
								/>
							) : null}
						</div>
					) : null}
				</section>

				<div className="easymde-settings-center__image-secondary-groups">
					<section className="easymde-settings-center__image-group is-upload-behavior">
						<h2>
							<SlidersIcon size={25} />
							{strings.uploadBehavior}
						</h2>
						<fieldset
							disabled={!runtimeCapabilities?.insertAfterUpload}
							title={
								runtimeCapabilities?.insertAfterUpload
									? undefined
									: strings.settingsUnavailableDescription
							}
							className="easymde-settings-center__unavailable-fields"
						>
							<ImageBehaviorRow label={strings.insertMarkdownAfterUpload}>
								<SettingsToggle
									label={strings.insertMarkdownAfterUpload}
									checked={settings.insertMarkdown}
									onChange={() =>
										setValue("insertMarkdown", !settings.insertMarkdown)
									}
								/>
							</ImageBehaviorRow>
						</fieldset>
						<fieldset
							disabled={!runtimeCapabilities?.compressImages}
							title={
								runtimeCapabilities?.compressImages
									? undefined
									: strings.settingsUnavailableDescription
							}
							className="easymde-settings-center__unavailable-fields"
						>
							<ImageBehaviorRow
								label={strings.compressImages}
								description={strings.compressImagesDescription}
							>
								<SettingsToggle
									label={strings.compressImages}
									checked={settings.compressImages}
									onChange={() =>
										setValue("compressImages", !settings.compressImages)
									}
								/>
							</ImageBehaviorRow>
						</fieldset>
						<fieldset
							disabled={!runtimeCapabilities?.preserveOriginalFileName}
							title={
								runtimeCapabilities?.preserveOriginalFileName
									? undefined
									: strings.settingsUnavailableDescription
							}
							className="easymde-settings-center__unavailable-fields"
						>
							<ImageBehaviorRow
								label={strings.preserveOriginalFileName}
								description={strings.preserveOriginalFileNameDescription}
							>
								<SettingsToggle
									label={strings.preserveOriginalFileName}
									checked={settings.preserveFileName}
									onChange={() =>
										setValue("preserveFileName", !settings.preserveFileName)
									}
								/>
							</ImageBehaviorRow>
						</fieldset>
						<fieldset
							disabled
							title={strings.settingsUnavailableDescription}
							className="easymde-settings-center__unavailable-fields"
						>
							<ImageBehaviorRow
								label={strings.copyImageUrl}
								description={strings.copyImageUrlDescription}
							>
								<SettingsToggle
									label={strings.copyImageUrl}
									checked={settings.copyUrl}
									onChange={() => setValue("copyUrl", !settings.copyUrl)}
								/>
							</ImageBehaviorRow>
						</fieldset>
						<fieldset
							disabled={!runtimeCapabilities?.maximumImageSize}
							title={
								runtimeCapabilities?.maximumImageSize
									? undefined
									: strings.settingsUnavailableDescription
							}
							className="easymde-settings-center__unavailable-fields"
						>
							<ImageBehaviorRow label={strings.maximumImageSize}>
								<CompactSelect
									label={strings.maximumImageSize}
									value={settings.maxImageSize}
									options={maxImageSizeOptions}
									onChange={(value) => setValue("maxImageSize", value)}
								/>
							</ImageBehaviorRow>
						</fieldset>
						<SettingsRow
							label={strings.allowedUploadFormats}
							description={strings.allowedUploadFormatsDescription}
							minHeight={82}
						>
							<div className="easymde-settings-center__upload-formats">
								{UPLOAD_FORMAT_OPTIONS.map(
									({ accessibleLabel, key, label }) => {
										const checked = settings.uploadFormats[key];
										return (
											<label key={key} data-checked={checked}>
												<input
													type="checkbox"
													aria-label={strings[accessibleLabel]}
													checked={checked}
													onChange={() => toggleUploadFormat(key)}
												/>
												<span>{strings[label]}</span>
											</label>
										);
									},
								)}
							</div>
						</SettingsRow>
					</section>

					<section className="easymde-settings-center__image-group is-default-insertion">
						<h2>
							<DocumentIcon size={25} />
							{strings.defaultInsertion}
						</h2>
						<ImageBehaviorRow label={strings.defaultInsertFormat}>
							<CompactSelect
								label={strings.defaultInsertFormat}
								value={settings.insertFormat}
								options={insertFormatOptions}
								onChange={(value) => setValue("insertFormat", value)}
							/>
						</ImageBehaviorRow>
						<ImageBehaviorRow label={strings.altTextSource}>
							<CompactSelect
								label={strings.altTextSource}
								value={settings.altSource}
								options={altSourceOptions}
								onChange={(value) => setValue("altSource", value)}
							/>
						</ImageBehaviorRow>
						<ImageBehaviorRow label={strings.imageTitleField}>
							<CompactSelect
								label={strings.imageTitleField}
								value={settings.captionMode}
								options={captionModeOptions}
								onChange={(value) => setValue("captionMode", value)}
							/>
						</ImageBehaviorRow>
						<fieldset
							disabled
							title={strings.settingsUnavailableDescription}
							className="easymde-settings-center__unavailable-fields"
						>
							<ImageBehaviorRow
								label={strings.imageFeaturedPlaceholder}
								description={strings.imageFeaturedPlaceholderDescription}
							>
								<SettingsToggle
									label={strings.imageFeaturedPlaceholder}
									checked={settings.featuredPlaceholder}
									onChange={() =>
										setValue(
											"featuredPlaceholder",
											!settings.featuredPlaceholder,
										)
									}
								/>
							</ImageBehaviorRow>
						</fieldset>
						<div className="easymde-settings-center__upload-summary">
							<div>
								<Info size={17} />
								{strings.currentAllowedUploads.replace("%s", () =>
									selectedFormats.join(strings.uploadFormatSeparator),
								)}
							</div>
							<div>{strings.compressLargeImagesRecommendation}</div>
						</div>
					</section>
				</div>
			</div>
			{feedbackPortal}
		</div>
	);
}
