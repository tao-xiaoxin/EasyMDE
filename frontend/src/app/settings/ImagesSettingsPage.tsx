import {
	createElement,
	createPortal,
	Fragment,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "@wordpress/element";
import type {
	SettingsCenterBootstrap,
	SettingsCenterStringKey,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { ImageHostingSecretRevealPort } from "../../contracts/ports/image-hosting-secret-reveal-port";
import type {
	ImageHostingTarget,
	ImageUploadVerificationPort,
} from "../../contracts/ports/image-hosting-verification-port";
import type {
	ImageSettings,
	ImageUploadFormat,
} from "../../contracts/settings-center-settings";
import {
	DEFAULT_IMAGE_FILE_NAME_RULE,
	DEFAULT_IMAGE_STORAGE_PATH,
	DEFAULT_IMAGE_UPLOAD_FORMATS,
} from "../../contracts/settings-center-settings";
import { CircleAlert, Copy } from "../../generated/lucide-icons";
import { ImageFileNameRuleEditor } from "./ImageFileNameRuleEditor";
import {
	CompactSelect,
	ImageBehaviorRow,
	ImageField,
	ImageHostingProviderFields,
	ImageNumberInput,
	type SelectOption,
} from "./ImageHostingProviderFields";
import {
	DEFAULT_VERIFICATION_INVALIDATION_TOKENS,
	DuplicateImageHostDialog,
	hasDuplicateImageHostConfiguration,
	type ImageUploadVerificationStatus,
	UploadVerificationFeedbackDialog,
	type VerificationFeedback,
	type VerificationInvalidationTokens,
	VerificationRow,
	type VerificationState,
	verificationFingerprint,
} from "./ImageUploadVerification";
import { SettingsRow, SettingsToggle } from "./SettingsControls";
import { ImageLibraryIcon, SlidersIcon } from "./settings-center-icons";

export {
	DuplicateImageHostDialog,
	hasDuplicateImageHostConfiguration,
	type ImageUploadVerificationStatus,
};

type ImageSettingsDraft = ImageSettings;

export type ImageRuntimeCapabilities = Readonly<{
	compressImages: boolean;
}>;

const UPLOAD_FORMAT_OPTIONS: ReadonlyArray<
	Readonly<{
		key: ImageUploadFormat;
		label: SettingsCenterStringKey;
		accessibleLabel: SettingsCenterStringKey;
	}>
> = [
	{
		key: "webp",
		label: "uploadFormatWebp",
		accessibleLabel: "allowUploadWebp",
	},
	{ key: "png", label: "uploadFormatPng", accessibleLabel: "allowUploadPng" },
	{ key: "jpg", label: "uploadFormatJpg", accessibleLabel: "allowUploadJpg" },
	{
		key: "jpeg",
		label: "uploadFormatJpeg",
		accessibleLabel: "allowUploadJpeg",
	},
	{
		key: "jfif",
		label: "uploadFormatJfif",
		accessibleLabel: "allowUploadJfif",
	},
	{ key: "gif", label: "uploadFormatGif", accessibleLabel: "allowUploadGif" },
];

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
			imageHostingEnabled: false,
			wechatPngExportEnabled: false,
			service: "cloudflare-r2",
			endpoint: "",
			bucket: "easymde-assets",
			domain: draft.domain,
			accessKey: "",
			secretKey: "",
			storagePath: DEFAULT_IMAGE_STORAGE_PATH,
			fileNameRule: DEFAULT_IMAGE_FILE_NAME_RULE,
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
			uploadFormats: { ...DEFAULT_IMAGE_UPLOAD_FORMATS },
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
	const verificationGenerationRef = useRef(0);
	const verificationInvalidationTokensRef = useRef(
		verificationInvalidationTokens,
	);
	verificationInvalidationTokensRef.current = verificationInvalidationTokens;
	const rawSettings = externalSettings ?? localSettings;
	const settings = rawSettings;
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const clearImageHostingTransientState = useCallback(() => {
		verificationGenerationRef.current += 1;
		verificationAbortRef.current.primary?.abort();
		verificationAbortRef.current.backup?.abort();
		verificationAbortRef.current = {};
		setPrimaryVerification({ status: "pending" });
		setBackupVerification({ status: "pending" });
		setVerificationFeedback(null);
		setDuplicateTrigger(null);
	}, []);
	const previousImageHostingEnabledRef = useRef(settings.imageHostingEnabled);
	useEffect(() => {
		const previous = previousImageHostingEnabledRef.current;
		previousImageHostingEnabledRef.current = settings.imageHostingEnabled;
		if (previous && !settings.imageHostingEnabled) {
			clearImageHostingTransientState();
		}
	}, [clearImageHostingTransientState, settings.imageHostingEnabled]);
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
		const verificationGeneration = verificationGenerationRef.current;
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
			if (
				controller.signal.aborted ||
				verificationGenerationRef.current !== verificationGeneration ||
				!settingsRef.current.imageHostingEnabled
			)
				return;
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
			if (
				controller.signal.aborted ||
				verificationGenerationRef.current !== verificationGeneration ||
				!settingsRef.current.imageHostingEnabled
			)
				return;
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
					<ImageBehaviorRow
						label={strings.enableImageHosting}
						description={strings.enableImageHostingDescription}
					>
						<SettingsToggle
							label={strings.enableImageHosting}
							checked={settings.imageHostingEnabled}
							onChange={() =>
								setValue("imageHostingEnabled", !settings.imageHostingEnabled)
							}
						/>
					</ImageBehaviorRow>
					<Fragment>
						{settings.imageHostingEnabled ? (
							<div>
								<div>
									<ImageHostingProviderFields
										serviceLabel={strings.selectImageHostService}
										service={settings.service}
										providerOptions={imageHostOptions}
										invalidProviderError="settings-center-image-provider-invalid"
										onServiceChange={(value) =>
											setValues({
												service: value,
												endpoint: "",
											})
										}
										endpoint={settings.endpoint}
										onEndpointChange={(value) => setValue("endpoint", value)}
										bucketLabel={strings.bucket}
										bucket={settings.bucket}
										onBucketChange={(value) => setValue("bucket", value)}
										domainLabel={strings.imageFallbackDomain}
										domain={settings.domain}
										onDomainChange={(value) => setValue("domain", value)}
										credentialsConfigured={draft.primaryCredentialsConfigured}
										accessKeyLabel={strings.accessKey}
										accessKey={settings.accessKey}
										accessKeyShowLabel={strings.showSecret}
										accessKeyHideLabel={strings.hideSecret}
										onAccessKeyChange={(value) => setValue("accessKey", value)}
										secretKeyLabel={strings.secretKey}
										secretKey={settings.secretKey}
										secretKeyShowLabel={strings.showSecret}
										secretKeyHideLabel={strings.hideSecret}
										onSecretKeyChange={(value) => setValue("secretKey", value)}
										secretRevealPort={secretRevealPort}
										settingsRevision={settingsRevision}
										strings={strings}
										target="primary"
									/>
								</div>
							</div>
						) : null}
						<ImageFileNameRuleEditor
							strings={strings}
							storagePath={settings.storagePath}
							fileNameRule={settings.fileNameRule}
							uploadFormats={settings.uploadFormats}
							onChange={(field, value) => setValue(field, value)}
							onPresetChange={(pair) => setValues(pair)}
						/>
						{settings.imageHostingEnabled ? (
							<Fragment>
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
								{uploadVerificationPort ? (
									<VerificationRow
										disabled={uploadVerificationDisabled}
										target="primary"
										strings={strings}
										state={effectiveVerificationState(
											primaryVerification,
											"primary",
										)}
										onVerify={(trigger) =>
											void verifyUpload("primary", trigger)
										}
									/>
								) : null}
							</Fragment>
						) : null}
					</Fragment>
				</section>

				{settings.imageHostingEnabled ? (
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
								<ImageHostingProviderFields
									serviceLabel={strings.backupImageHostService}
									service={settings.backupService}
									providerOptions={backupHostOptions}
									invalidProviderError="settings-center-backup-image-provider-invalid"
									onServiceChange={(value) =>
										setValues({
											backupService: value,
											backupEndpoint: "",
										})
									}
									endpoint={settings.backupEndpoint}
									onEndpointChange={(value) =>
										setValue("backupEndpoint", value)
									}
									bucketLabel={strings.backupBucket}
									bucket={settings.backupBucket}
									onBucketChange={(value) => setValue("backupBucket", value)}
									domainLabel={strings.backupDomain}
									domain={settings.backupDomain}
									onDomainChange={(value) => setValue("backupDomain", value)}
									credentialsConfigured={draft.backupCredentialsConfigured}
									accessKeyLabel={strings.backupAccessKey}
									accessKey={settings.backupAccessKey}
									accessKeyShowLabel={strings.showBackupAccessKey}
									accessKeyHideLabel={strings.hideBackupAccessKey}
									onAccessKeyChange={(value) =>
										setValue("backupAccessKey", value)
									}
									secretKeyLabel={strings.backupSecretKey}
									secretKey={settings.backupSecretKey}
									secretKeyShowLabel={strings.showBackupSecretKey}
									secretKeyHideLabel={strings.hideBackupSecretKey}
									onSecretKeyChange={(value) =>
										setValue("backupSecretKey", value)
									}
									secretRevealPort={secretRevealPort}
									settingsRevision={settingsRevision}
									strings={strings}
									target="backup"
								/>
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
				) : null}

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
							label={strings.convertDiagramsAndFormulasToPng}
							description={strings.convertDiagramsAndFormulasToPngDescription}
						>
							<SettingsToggle
								label={strings.convertDiagramsAndFormulasToPng}
								checked={settings.wechatPngExportEnabled}
								onChange={() =>
									setValue(
										"wechatPngExportEnabled",
										!settings.wechatPngExportEnabled,
									)
								}
							/>
						</ImageBehaviorRow>
						{settings.imageHostingEnabled ? (
							<Fragment>
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
							</Fragment>
						) : null}
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
								{formatError ? (
									<small
										className="easymde-settings-center__upload-format-error"
										role="alert"
									>
										<CircleAlert size={15} strokeWidth={2} />
										<span>{strings.uploadFormatRequired}</span>
									</small>
								) : null}
							</div>
						</SettingsRow>
					</section>
				</div>
			</div>
			{duplicatePortal}
			{verificationFeedbackPortal}
		</div>
	);
}
