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
	ImageHostingSecretField,
	ImageHostingSecretRevealPort,
} from "../../contracts/ports/image-hosting-secret-reveal-port";
import type {
	ImageHostingTarget,
	ImageUploadVerificationPort,
	ImageUploadVerificationResult,
} from "../../contracts/ports/image-hosting-verification-port";
import type {
	ImageSettings,
	ImageUploadFormat,
} from "../../contracts/settings-center-settings";
import {
	CircleAlert,
	CircleCheck,
	CircleX,
	Copy,
	ExternalLink,
	Eye,
	FolderOpen,
	Info,
	Link2,
	Minus,
	Plus,
	RefreshCcw,
	X,
} from "../../generated/lucide-icons";
import {
	SettingsRow,
	SettingsSelect,
	SettingsToggle,
} from "./SettingsControls";
import { ImageLibraryIcon, SlidersIcon } from "./settings-center-icons";
import { useDialogFocusTrap } from "./settings-center-utils";

type ImageSettingsDraft = ImageSettings;

export type ImageUploadVerificationStatus =
	| "pending"
	| "verifying"
	| "verified"
	| "error"
	| "stale";

export type ImageRuntimeCapabilities = Readonly<{
	compressImages: boolean;
}>;

type VerificationState = Readonly<{
	status: ImageUploadVerificationStatus;
	verifiedFingerprint?: string;
	verifiedInvalidationToken?: number;
}>;

type VerificationFeedback =
	| Readonly<{
			kind: "success";
			result: ImageUploadVerificationResult;
			returnFocus: HTMLButtonElement;
	  }>
	| Readonly<{
			kind: "error";
			returnFocus: HTMLButtonElement;
	  }>;

type VerificationInvalidationTokens = Readonly<{
	primary: number;
	backup: number;
}>;

const DEFAULT_VERIFICATION_INVALIDATION_TOKENS: VerificationInvalidationTokens =
	{
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

const IMAGE_HOST_PROVIDERS = [
	"cloudflare-r2",
	"qiniu-kodo",
	"aliyun-oss",
	"tencent-cos",
] as const;

function isImageHostProvider(value: string): value is ImageSettings["service"] {
	return IMAGE_HOST_PROVIDERS.some((provider) => provider === value);
}

function normalizedIdentityValue(value: string): string {
	return value.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizedEndpointIdentity(
	service: ImageSettings["service"],
	value: string,
): string {
	const endpoint = normalizedIdentityValue(value);
	if (service === "aliyun-oss") {
		const match = endpoint.match(/^https:\/\/oss-([a-z0-9-]+)\.aliyuncs\.com$/);
		return match?.[1]?.replace(/-internal$/, "") ?? "";
	}
	if (service === "tencent-cos") {
		return (
			endpoint.match(/^https:\/\/cos\.([a-z0-9-]+)\.myqcloud\.com$/)?.[1] ?? ""
		);
	}
	return endpoint;
}

export function hasDuplicateImageHostConfiguration(
	settings: ImageSettings,
): boolean {
	if (!settings.backupEnabled || settings.service !== settings.backupService) {
		return false;
	}
	if (!settings.bucket.trim() || !settings.backupBucket.trim()) return false;
	if (
		normalizedIdentityValue(settings.bucket) !==
		normalizedIdentityValue(settings.backupBucket)
	) {
		return false;
	}
	if (settings.service !== "qiniu-kodo") {
		if (!settings.endpoint.trim() || !settings.backupEndpoint.trim()) {
			return false;
		}
		const primaryEndpoint = normalizedEndpointIdentity(
			settings.service,
			settings.endpoint,
		);
		const backupEndpoint = normalizedEndpointIdentity(
			settings.backupService,
			settings.backupEndpoint,
		);
		return (
			"" !== primaryEndpoint &&
			"" !== backupEndpoint &&
			primaryEndpoint === backupEndpoint
		);
	}
	return true;
}

export function DuplicateImageHostDialog({
	onClose,
	returnFocus,
	strings,
}: {
	onClose: () => void;
	returnFocus: HTMLElement;
	strings: SettingsCenterBootstrap["strings"];
}) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useDialogFocusTrap(dialogRef, closeButtonRef);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) throw new Error("settings-center-duplicate-dialog-missing");
		const ownerDocument = dialog.ownerDocument;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current();
		};
		ownerDocument.addEventListener("keydown", closeOnEscape);
		return () => {
			ownerDocument.removeEventListener("keydown", closeOnEscape);
			returnFocus.focus();
		};
	}, [returnFocus]);

	return (
		<div
			className="easymde-settings-center__transfer-dialog-layer"
			role="presentation"
		>
			<button
				type="button"
				className="easymde-settings-center__dialog-backdrop"
				aria-label={strings.cancel}
				onClick={onClose}
			/>
			<div
				ref={dialogRef}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="easymde-duplicate-image-host-title"
				aria-describedby="easymde-duplicate-image-host-description"
				className="easymde-settings-center__transfer-dialog"
			>
				<header>
					<span>
						<Info size={20} />
					</span>
					<div>
						<h2 id="easymde-duplicate-image-host-title">
							{strings.duplicateImageHostTitle}
						</h2>
						<p id="easymde-duplicate-image-host-description">
							{strings.duplicateImageHostDescription}
						</p>
					</div>
					<button
						ref={closeButtonRef}
						type="button"
						aria-label={strings.cancel}
						onClick={onClose}
					>
						<X size={20} />
					</button>
				</header>
			</div>
		</div>
	);
}

function UploadVerificationFeedbackDialog({
	feedback,
	onClose,
	strings,
}: {
	feedback: VerificationFeedback;
	onClose: () => void;
	strings: SettingsCenterBootstrap["strings"];
}) {
	const footerCloseButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useDialogFocusTrap(dialogRef, footerCloseButtonRef);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog)
			throw new Error("settings-center-upload-feedback-dialog-missing");
		const ownerDocument = dialog.ownerDocument;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current();
		};
		ownerDocument.addEventListener("keydown", closeOnEscape);
		return () => {
			ownerDocument.removeEventListener("keydown", closeOnEscape);
			feedback.returnFocus.focus();
		};
	}, [feedback.returnFocus]);
	const success = feedback.kind === "success";
	const title = success
		? strings.uploadVerificationSucceeded
		: strings.uploadVerificationFailed;
	const description = success
		? strings.uploadVerificationSuccessDescription
		: strings.uploadVerificationFailureDescription;
	const insecureViewingUrl =
		success && /^http:\/\//i.test(feedback.result.url.trim());
	const dialogAccessibility: Readonly<{
		"aria-describedby": string;
		"aria-labelledby": string;
		"aria-modal": "true";
		role: "alertdialog" | "dialog";
	}> = {
		"aria-describedby": "easymde-upload-verification-description",
		"aria-labelledby": "easymde-upload-verification-title",
		"aria-modal": "true",
		role: success ? "dialog" : "alertdialog",
	};

	return (
		<div
			className="easymde-settings-center__transfer-dialog-layer"
			role="presentation"
		>
			<button
				type="button"
				className="easymde-settings-center__dialog-backdrop"
				aria-label={strings.closeImageFeedback}
				onClick={onClose}
			/>
			<div
				ref={dialogRef}
				{...dialogAccessibility}
				className="easymde-settings-center__transfer-dialog easymde-settings-center__upload-verification-dialog"
			>
				<header>
					<span className={success ? "is-success" : "is-destructive"}>
						{success ? <CircleCheck size={22} /> : <CircleX size={22} />}
					</span>
					<div>
						<h2 id="easymde-upload-verification-title">{title}</h2>
						<p id="easymde-upload-verification-description">{description}</p>
					</div>
					<button
						type="button"
						aria-label={strings.closeImageFeedback}
						onClick={onClose}
					>
						<X size={20} />
					</button>
				</header>
				{success && feedback.kind === "success" ? (
					<div className="easymde-settings-center__transfer-dialog-body easymde-settings-center__upload-verification-result">
						<dl>
							<div>
								<dt>
									<FolderOpen size={17} />
									<span>{strings.uploadedObjectPath}</span>
								</dt>
								<dd>
									<code>{feedback.result.path}</code>
								</dd>
							</div>
							<div>
								<dt>
									<Link2 size={17} />
									<span>{strings.uploadedImageUrl}</span>
								</dt>
								<dd>
									<a
										href={feedback.result.url}
										target="_blank"
										rel="noopener noreferrer"
									>
										<span>{feedback.result.url}</span>
										<ExternalLink size={15} />
									</a>
								</dd>
							</div>
						</dl>
						{insecureViewingUrl ? (
							<p className="easymde-settings-center__upload-verification-warning">
								<Info size={17} />
								<span>{strings.insecureViewingDomainWarning}</span>
							</p>
						) : null}
					</div>
				) : (
					<div className="easymde-settings-center__transfer-dialog-body easymde-settings-center__upload-verification-failure">
						<p>{strings.uploadVerificationFailureHint}</p>
					</div>
				)}
				<footer>
					<button ref={footerCloseButtonRef} type="button" onClick={onClose}>
						{strings.closeImageFeedback}
					</button>
				</footer>
			</div>
		</div>
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

function ImageNumberInput({
	label,
	max,
	min,
	onChange,
	unit,
	value,
}: {
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	unit?: string;
	value: number;
}) {
	return (
		<div className="easymde-settings-center__image-number-stepper">
			<button
				type="button"
				aria-label={`${label} - 1`}
				disabled={value === min}
				onClick={() => onChange(value - 1)}
			>
				<Minus size={16} />
			</button>
			<span className="easymde-settings-center__image-number-value">
				<input
					className="easymde-settings-center__image-number-input"
					type="number"
					min={min}
					max={max}
					step={1}
					aria-label={label}
					value={value}
					onChange={(event) => {
						const input = event.currentTarget;
						const next = input.valueAsNumber;
						if (Number.isInteger(next) && next >= min && next <= max) {
							onChange(next);
							return;
						}
						input.value = String(value);
					}}
				/>
				{unit ? <span aria-hidden="true">{unit}</span> : null}
			</span>
			<button
				type="button"
				aria-label={`${label} + 1`}
				disabled={value === max}
				onClick={() => onChange(value + 1)}
			>
				<Plus size={16} />
			</button>
		</div>
	);
}

function SecretInput({
	configured,
	field,
	hideLabel,
	label,
	onChange,
	revealFailedLabel,
	revealPort,
	revealingLabel,
	revision,
	showLabel,
	target,
	value,
}: {
	configured: boolean;
	field: ImageHostingSecretField;
	hideLabel: string;
	label: string;
	onChange: (value: string) => void;
	revealFailedLabel: string;
	revealPort: ImageHostingSecretRevealPort | undefined;
	revealingLabel: string;
	revision: number;
	showLabel: string;
	target: ImageHostingTarget;
	value: string;
}) {
	const [visible, setVisible] = useState(false);
	const [revealedValue, setRevealedValue] = useState<string | null>(null);
	const [revealStatus, setRevealStatus] = useState<
		"idle" | "loading" | "error"
	>("idle");
	const revealAbortRef = useRef<AbortController | null>(null);
	const canReveal = configured && Boolean(revealPort);
	const displayValue = revealedValue ?? value;
	useEffect(() => {
		if (!canReveal) setVisible(false);
	}, [canReveal]);
	useEffect(() => {
		setRevealedValue(null);
		setVisible(false);
		setRevealStatus("idle");
		revealAbortRef.current?.abort();
	}, [configured, field, revision, target, value]);
	useEffect(
		() => () => {
			revealAbortRef.current?.abort();
		},
		[],
	);

	async function toggleVisibility() {
		if (revealedValue !== null) {
			setRevealedValue(null);
			setVisible(false);
			return;
		}
		if (value) {
			setVisible((current) => !current);
			return;
		}
		if (!configured || !revealPort || revealStatus === "loading") return;
		const controller = new AbortController();
		revealAbortRef.current?.abort();
		revealAbortRef.current = controller;
		setRevealStatus("loading");
		try {
			const result = await revealPort.revealSecret({
				field,
				revision,
				signal: controller.signal,
				target,
			});
			if (controller.signal.aborted) return;
			setRevealedValue(result.value);
			setVisible(true);
			setRevealStatus("idle");
		} catch {
			if (controller.signal.aborted) return;
			setRevealStatus("error");
		} finally {
			if (revealAbortRef.current === controller) revealAbortRef.current = null;
		}
	}
	return (
		<div className="easymde-settings-center__secret-field">
			<div className="easymde-settings-center__secret-input">
				<input
					aria-label={label}
					placeholder={configured && !value ? "••••••••••••" : undefined}
					readOnly={revealedValue !== null}
					type={displayValue && visible ? "text" : "password"}
					value={displayValue}
					onChange={(event) => {
						setRevealedValue(null);
						setVisible(false);
						setRevealStatus("idle");
						onChange(event.target.value);
					}}
				/>
				{canReveal ? (
					<button
						type="button"
						aria-label={
							revealStatus === "loading"
								? revealingLabel
								: visible
									? hideLabel
									: showLabel
						}
						disabled={revealStatus === "loading"}
						onClick={() => void toggleVisibility()}
					>
						{revealStatus === "loading" ? (
							<RefreshCcw
								size={17}
								className="easymde-settings-center__verification-spinner"
							/>
						) : (
							<Eye size={18} />
						)}
					</button>
				) : null}
			</div>
			{revealStatus === "error" ? (
				<div className="easymde-settings-center__credential-error" role="alert">
					<Info size={15} />
					<span>{revealFailedLabel}</span>
				</div>
			) : null}
		</div>
	);
}

function ImageField({
	children,
	description,
	label,
}: {
	children: React.ReactNode;
	description?: string;
	label: string;
}) {
	return (
		<SettingsRow label={label} {...(description ? { description } : {})}>
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

function verificationFingerprint(
	settings: ImageSettings,
	target: ImageHostingTarget,
): string {
	const values =
		target === "primary"
			? [
					settings.fileNameRule,
					settings.service,
					settings.endpoint,
					settings.bucket,
					settings.domain,
					settings.accessKey,
					settings.secretKey,
				]
			: [
					settings.fileNameRule,
					settings.domain,
					settings.backupEnabled ? "enabled" : "disabled",
					settings.backupService,
					settings.backupEndpoint,
					settings.backupBucket,
					settings.backupDomain,
					settings.backupAccessKey,
					settings.backupSecretKey,
				];
	return JSON.stringify(values);
}

function VerificationRow({
	disabled,
	onVerify,
	state,
	strings,
	target,
}: {
	disabled: boolean;
	onVerify: (trigger: HTMLButtonElement) => void;
	state: VerificationState;
	strings: SettingsCenterBootstrap["strings"];
	target: ImageHostingTarget;
}) {
	const labelByStatus: Readonly<Record<ImageUploadVerificationStatus, string>> =
		{
			pending: strings.uploadVerificationPending,
			verifying: strings.verifyingUpload,
			verified: strings.uploadVerified,
			error: strings.uploadVerificationFailed,
			stale: strings.uploadVerificationStale,
		};
	const isVerifying = state.status === "verifying";
	return (
		<div
			className={`easymde-settings-center__${target === "backup" ? "backup-" : ""}verification-divider`}
		>
			<SettingsRow
				label={
					target === "backup"
						? strings.backupVerificationStatus
						: strings.uploadVerificationStatus
				}
				minHeight={target === "backup" ? 70 : 76}
			>
				<div className="easymde-settings-center__verification-row">
					<div
						className="easymde-settings-center__verification-status"
						data-state={state.status}
						role="status"
						aria-live="polite"
					>
						<span />
						{labelByStatus[state.status]}
					</div>
					<button
						type="button"
						disabled={disabled || isVerifying}
						onClick={(event) => onVerify(event.currentTarget)}
					>
						{isVerifying ? (
							<RefreshCcw
								size={15}
								className="easymde-settings-center__verification-spinner"
							/>
						) : null}
						{target === "backup"
							? isVerifying
								? strings.verifyingUpload
								: strings.verifyBackupUpload
							: isVerifying
								? strings.verifyingUpload
								: strings.verifyPrimaryUpload}
					</button>
				</div>
			</SettingsRow>
		</div>
	);
}

export function ImagesSettingsPage({
	verificationInvalidationTokens = DEFAULT_VERIFICATION_INVALIDATION_TOKENS,
	uploadVerificationDisabled = false,
	uploadVerificationPort,
	draft,
	onChange,
	overlayRoot,
	settings: externalSettings,
	settingsRevision,
	strings,
	runtimeCapabilities,
	secretRevealPort,
	uploadLimits,
}: {
	brandMarkUrl: string;
	verificationInvalidationTokens?: VerificationInvalidationTokens;
	uploadVerificationDisabled?: boolean;
	uploadVerificationPort?: ImageUploadVerificationPort;
	draft: SettingsCenterBootstrap["drafts"]["images"];
	onChange?: (settings: ImageSettingsDraft) => void;
	overlayRoot: HTMLDivElement | null;
	settings?: ImageSettingsDraft;
	settingsRevision: number;
	strings: SettingsCenterBootstrap["strings"];
	runtimeCapabilities?: ImageRuntimeCapabilities;
	secretRevealPort?: ImageHostingSecretRevealPort;
	uploadLimits: SettingsCenterBootstrap["uploadLimits"];
}) {
	const imageHostOptions: ReadonlyArray<SelectOption> = [
		{ value: "cloudflare-r2", label: strings.cloudflareR2 },
		{ value: "qiniu-kodo", label: strings.qiniuKodo },
		{ value: "aliyun-oss", label: strings.aliyunOss },
		{ value: "tencent-cos", label: strings.tencentCloudCos },
	];
	const backupHostOptions = imageHostOptions;
	const titleDisplayOptions: ReadonlyArray<SelectOption> = [
		{ value: "filename", label: strings.useFileName },
		{ value: "none", label: strings.leaveEmpty },
	];
	const remoteImageUploadModeOptions: ReadonlyArray<SelectOption> = [
		{ value: "both", label: strings.remoteImageUploadBoth },
		{ value: "visual", label: strings.remoteImageUploadVisual },
		{ value: "source", label: strings.remoteImageUploadSource },
		{ value: "off", label: strings.remoteImageUploadOff },
	];
	const [localSettings, setLocalSettings] = useState<ImageSettingsDraft>(
		() => ({
			service: "cloudflare-r2",
			endpoint: "",
			bucket: "easymde-assets",
			domain: draft.domain,
			accessKey: "",
			secretKey: "",
			fileNameRule: "{year}/{month}/{md5}.{ext}",
			uploadRetryCount: 0,
			backupEnabled: true,
			backupService: "qiniu-kodo",
			backupEndpoint: "",
			backupBucket: "easymde-backup",
			backupDomain: draft.backupDomain,
			backupAccessKey: "",
			backupSecretKey: "",
			compressImages: true,
			autoUploadPastedImages: true,
			remoteImageUploadMode: "both",
			maxImageSizeMb: 5,
			uploadFormats: { jpg: true, png: true, webp: true, gif: true },
			titleDisplay: "none",
		}),
	);
	const [formatError, setFormatError] = useState(false);
	const [duplicateTrigger, setDuplicateTrigger] =
		useState<HTMLButtonElement | null>(null);
	const [verificationFeedback, setVerificationFeedback] =
		useState<VerificationFeedback | null>(null);
	const [primaryVerification, setPrimaryVerification] =
		useState<VerificationState>({
			status: "pending",
		});
	const [backupVerification, setBackupVerification] =
		useState<VerificationState>({
			status: "pending",
		});
	const verificationAbortRef = useRef<
		Partial<Record<ImageHostingTarget, AbortController>>
	>({});
	const verificationInvalidationTokensRef = useRef(
		verificationInvalidationTokens,
	);
	verificationInvalidationTokensRef.current = verificationInvalidationTokens;
	const rawSettings = externalSettings ?? localSettings;
	const settings = rawSettings;
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	useEffect(
		() => () => {
			verificationAbortRef.current.primary?.abort();
			verificationAbortRef.current.backup?.abort();
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
		setValues({ [key]: value });
	}
	function setValues(values: Partial<ImageSettingsDraft>) {
		const next = { ...settings, ...values };
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
	function effectiveVerificationState(
		state: VerificationState,
		target: ImageHostingTarget,
	): VerificationState {
		const invalidationToken = verificationInvalidationTokens[target];
		if (
			state.status !== "verifying" &&
			state.verifiedFingerprint &&
			(state.verifiedFingerprint !==
				verificationFingerprint(settings, target) ||
				state.verifiedInvalidationToken !== invalidationToken)
		) {
			return { ...state, status: "stale" };
		}
		return state;
	}
	async function verifyUpload(
		target: ImageHostingTarget,
		trigger: HTMLButtonElement,
	) {
		if (hasDuplicateImageHostConfiguration(settingsRef.current)) {
			if (!overlayRoot) {
				throw new Error("settings-center-duplicate-dialog-root-missing");
			}
			setDuplicateTrigger(trigger);
			return;
		}
		if (!uploadVerificationPort) {
			throw new Error("settings-center-image-verification-port-missing");
		}
		const activeController = verificationAbortRef.current[target];
		if (activeController && !activeController.signal.aborted) return;
		const controller = new AbortController();
		verificationAbortRef.current[target] = controller;
		const snapshot = settingsRef.current;
		const verifiedFingerprint = verificationFingerprint(snapshot, target);
		const verifiedInvalidationToken =
			verificationInvalidationTokensRef.current[target];
		const setState =
			target === "primary" ? setPrimaryVerification : setBackupVerification;
		setState({
			status: "verifying",
			verifiedFingerprint,
			verifiedInvalidationToken,
		});
		try {
			const result = await uploadVerificationPort.verifyUpload({
				revision: settingsRevision,
				target,
				settings: snapshot,
				signal: controller.signal,
			});
			if (controller.signal.aborted) return;
			setState({
				status:
					verificationFingerprint(settingsRef.current, target) ===
						verifiedFingerprint &&
					verificationInvalidationTokensRef.current[target] ===
						verifiedInvalidationToken
						? "verified"
						: "stale",
				verifiedFingerprint,
				verifiedInvalidationToken,
			});
			setVerificationFeedback({
				kind: "success",
				result,
				returnFocus: trigger,
			});
		} catch {
			if (controller.signal.aborted) return;
			console.error("[EasyMDE settings] Image upload verification failed", {
				target,
				reason: "upload-verification-rejected",
			});
			setState({
				status: "error",
				verifiedFingerprint,
				verifiedInvalidationToken,
			});
			setVerificationFeedback({
				kind: "error",
				returnFocus: trigger,
			});
		} finally {
			if (verificationAbortRef.current[target] === controller) {
				delete verificationAbortRef.current[target];
			}
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
	const duplicatePortal =
		duplicateTrigger && overlayRoot
			? createPortal(
					<DuplicateImageHostDialog
						returnFocus={duplicateTrigger}
						strings={strings}
						onClose={() => setDuplicateTrigger(null)}
					/>,
					overlayRoot,
				)
			: null;
	const verificationFeedbackPortal =
		verificationFeedback && overlayRoot
			? createPortal(
					<UploadVerificationFeedbackDialog
						feedback={verificationFeedback}
						onClose={() => setVerificationFeedback(null)}
						strings={strings}
					/>,
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
										if (!isImageHostProvider(value)) {
											throw new Error("settings-center-image-provider-invalid");
										}
										setValues({
											service: value,
											endpoint: "",
										});
									}}
								/>
							</ImageField>
							{settings.service !== "qiniu-kodo" ? (
								<ImageField label={strings.customDomain}>
									<ImageTextInput
										label={strings.customDomain}
										value={settings.endpoint}
										onChange={(value) => setValue("endpoint", value)}
									/>
								</ImageField>
							) : null}
							<ImageField label={strings.bucket}>
								<div>
									<ImageTextInput
										label={strings.bucket}
										value={settings.bucket}
										onChange={(value) => setValue("bucket", value)}
									/>
									{settings.service === "tencent-cos" ? (
										<small>{strings.cosBucketHint}</small>
									) : null}
								</div>
							</ImageField>
							<ImageField label={strings.imageFallbackDomain}>
								<ImageTextInput
									label={strings.imageFallbackDomain}
									value={settings.domain}
									onChange={(value) => setValue("domain", value)}
								/>
							</ImageField>
							<ImageField label={strings.accessKey}>
								<SecretInput
									configured={draft.primaryCredentialsConfigured}
									field="accessKey"
									label={strings.accessKey}
									value={settings.accessKey}
									showLabel={strings.showSecret}
									hideLabel={strings.hideSecret}
									onChange={(value) => setValue("accessKey", value)}
									revealFailedLabel={strings.secretRevealFailed}
									revealPort={secretRevealPort}
									revealingLabel={strings.revealingSecret}
									revision={settingsRevision}
									target="primary"
								/>
							</ImageField>
							<ImageField label={strings.secretKey}>
								<SecretInput
									configured={draft.primaryCredentialsConfigured}
									field="secretKey"
									label={strings.secretKey}
									value={settings.secretKey}
									showLabel={strings.showSecret}
									hideLabel={strings.hideSecret}
									onChange={(value) => setValue("secretKey", value)}
									revealFailedLabel={strings.secretRevealFailed}
									revealPort={secretRevealPort}
									revealingLabel={strings.revealingSecret}
									revision={settingsRevision}
									target="primary"
								/>
							</ImageField>
							<FileNameRuleEditor
								strings={strings}
								value={settings.fileNameRule}
								onChange={(value) => setValue("fileNameRule", value)}
							/>
							<ImageField
								label={strings.uploadRetryCount}
								description={strings.uploadRetryCountDescription}
							>
								<ImageNumberInput
									label={strings.uploadRetryCount}
									min={0}
									max={5}
									value={settings.uploadRetryCount}
									onChange={(value) => setValue("uploadRetryCount", value)}
								/>
							</ImageField>
						</div>
					</div>
					{uploadVerificationPort ? (
						<VerificationRow
							disabled={uploadVerificationDisabled}
							target="primary"
							strings={strings}
							state={effectiveVerificationState(primaryVerification, "primary")}
							onVerify={(trigger) => void verifyUpload("primary", trigger)}
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
										if (!isImageHostProvider(value)) {
											throw new Error(
												"settings-center-backup-image-provider-invalid",
											);
										}
										setValues({
											backupService: value,
											backupEndpoint: "",
										});
									}}
								/>
							</ImageField>
							{settings.backupService !== "qiniu-kodo" ? (
								<ImageField label={strings.customDomain}>
									<ImageTextInput
										label={strings.customDomain}
										value={settings.backupEndpoint}
										onChange={(value) => setValue("backupEndpoint", value)}
									/>
								</ImageField>
							) : null}
							<ImageField label={strings.backupBucket}>
								<div>
									<ImageTextInput
										label={strings.backupBucket}
										value={settings.backupBucket}
										onChange={(value) => setValue("backupBucket", value)}
									/>
									{settings.backupService === "tencent-cos" ? (
										<small>{strings.cosBucketHint}</small>
									) : null}
								</div>
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
									field="accessKey"
									label={strings.backupAccessKey}
									value={settings.backupAccessKey}
									showLabel={strings.showBackupAccessKey}
									hideLabel={strings.hideBackupAccessKey}
									onChange={(value) => setValue("backupAccessKey", value)}
									revealFailedLabel={strings.secretRevealFailed}
									revealPort={secretRevealPort}
									revealingLabel={strings.revealingSecret}
									revision={settingsRevision}
									target="backup"
								/>
							</ImageField>
							<ImageField label={strings.backupSecretKey}>
								<SecretInput
									configured={draft.backupCredentialsConfigured}
									field="secretKey"
									label={strings.backupSecretKey}
									value={settings.backupSecretKey}
									showLabel={strings.showBackupSecretKey}
									hideLabel={strings.hideBackupSecretKey}
									onChange={(value) => setValue("backupSecretKey", value)}
									revealFailedLabel={strings.secretRevealFailed}
									revealPort={secretRevealPort}
									revealingLabel={strings.revealingSecret}
									revision={settingsRevision}
									target="backup"
								/>
							</ImageField>
							{uploadVerificationPort ? (
								<VerificationRow
									disabled={uploadVerificationDisabled}
									target="backup"
									strings={strings}
									state={effectiveVerificationState(
										backupVerification,
										"backup",
									)}
									onVerify={(trigger) => void verifyUpload("backup", trigger)}
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
						<ImageBehaviorRow
							label={strings.autoUploadPastedImages}
							description={strings.autoUploadPastedImagesDescription}
						>
							<SettingsToggle
								label={strings.autoUploadPastedImages}
								checked={settings.autoUploadPastedImages}
								onChange={() =>
									setValue(
										"autoUploadPastedImages",
										!settings.autoUploadPastedImages,
									)
								}
							/>
						</ImageBehaviorRow>
						<ImageBehaviorRow
							label={strings.remoteImageUploadMode}
							description={strings.remoteImageUploadModeDescription}
						>
							<CompactSelect
								label={strings.remoteImageUploadMode}
								value={settings.remoteImageUploadMode}
								options={remoteImageUploadModeOptions}
								onChange={(value) => {
									if (
										value !== "both" &&
										value !== "visual" &&
										value !== "source" &&
										value !== "off"
									) {
										throw new Error(
											"settings-center-remote-image-upload-mode-invalid",
										);
									}
									setValue("remoteImageUploadMode", value);
								}}
							/>
						</ImageBehaviorRow>
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
						<ImageBehaviorRow label={strings.imageTitleDisplay}>
							<CompactSelect
								label={strings.imageTitleDisplay}
								value={settings.titleDisplay}
								options={titleDisplayOptions}
								onChange={(value) => {
									if (value !== "filename" && value !== "none") {
										throw new Error(
											"settings-center-image-title-display-invalid",
										);
									}
									setValue("titleDisplay", value);
								}}
							/>
						</ImageBehaviorRow>
						<ImageBehaviorRow
							label={strings.maximumImageSize}
							description={strings.maximumImageSizeDescription}
						>
							<div>
								<ImageNumberInput
									label={strings.maximumImageSize}
									min={1}
									max={10}
									unit="M"
									value={settings.maxImageSizeMb}
									onChange={(value) => setValue("maxImageSizeMb", value)}
								/>
								{settings.maxImageSizeMb * 1024 * 1024 >
								uploadLimits.systemMaxBytes ? (
									<small
										className="easymde-settings-center__image-size-warning"
										role="alert"
									>
										<CircleAlert size={15} strokeWidth={2} />
										<span>
											{strings.maximumImageSizeSystemLimitExceeded.replace(
												"%s",
												String(
													Math.floor(uploadLimits.systemMaxBytes / 1024 / 1024),
												),
											)}
										</span>
									</small>
								) : null}
							</div>
						</ImageBehaviorRow>
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
				</div>
			</div>
			{feedbackPortal}
			{duplicatePortal}
			{verificationFeedbackPortal}
		</div>
	);
}
