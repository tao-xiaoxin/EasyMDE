import { createElement, useEffect, useRef } from "@wordpress/element";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import type {
	ImageHostingTarget,
	ImageUploadVerificationResult,
} from "../../contracts/ports/image-hosting-verification-port";
import {
	IMAGE_UPLOAD_EXTENSIONS,
	type ImageSettings,
} from "../../contracts/settings-center-settings";
import {
	CircleCheck,
	CircleX,
	ExternalLink,
	FolderOpen,
	Info,
	Link2,
	RefreshCcw,
	X,
} from "../../generated/lucide-icons";
import { SettingsRow } from "./SettingsControls";
import { useDialogFocusTrap } from "./settings-center-utils";

export type ImageUploadVerificationStatus =
	| "pending"
	| "verifying"
	| "verified"
	| "error"
	| "stale";

export type VerificationState = Readonly<{
	status: ImageUploadVerificationStatus;
	verifiedFingerprint?: string;
	verifiedInvalidationToken?: number;
}>;

export type VerificationFeedback =
	| Readonly<{
			kind: "success";
			result: ImageUploadVerificationResult;
			returnFocus: HTMLButtonElement;
	  }>
	| Readonly<{
			kind: "error";
			returnFocus: HTMLButtonElement;
	  }>;

export type VerificationInvalidationTokens = Readonly<{
	primary: number;
	backup: number;
}>;

export const DEFAULT_VERIFICATION_INVALIDATION_TOKENS: VerificationInvalidationTokens =
	{
		primary: 0,
		backup: 0,
	};

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

export function verificationFingerprint(
	settings: ImageSettings,
	target: ImageHostingTarget,
): string {
	const values =
		target === "primary"
			? [
					settings.storagePath,
					settings.fileNameRule,
					...IMAGE_UPLOAD_EXTENSIONS.map((extension) =>
						settings.uploadFormats[extension] ? "enabled" : "disabled",
					),
					settings.service,
					settings.endpoint,
					settings.bucket,
					settings.domain,
					settings.accessKey,
					settings.secretKey,
				]
			: [
					settings.storagePath,
					settings.fileNameRule,
					...IMAGE_UPLOAD_EXTENSIONS.map((extension) =>
						settings.uploadFormats[extension] ? "enabled" : "disabled",
					),
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
			if (returnFocus.isConnected) returnFocus.focus();
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

export function UploadVerificationFeedbackDialog({
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
			if (feedback.returnFocus.isConnected) feedback.returnFocus.focus();
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

export function VerificationRow({
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
