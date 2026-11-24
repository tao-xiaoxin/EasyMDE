import { createElement, Fragment } from "@wordpress/element";
import type { ReactNode } from "react";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import type { ImageHostingSecretRevealPort } from "../../contracts/ports/image-hosting-secret-reveal-port";
import type { ImageHostingTarget } from "../../contracts/ports/image-hosting-verification-port";
import type { ImageSettings } from "../../contracts/settings-center-settings";
import { Minus, Plus } from "../../generated/lucide-icons";
import { SecretCredentialInput } from "./SecretCredentialInput";
import { SettingsRow, SettingsSelect } from "./SettingsControls";

export type SelectOption = Readonly<{
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

export function isImageHostProvider(
	value: string,
): value is ImageSettings["service"] {
	return IMAGE_HOST_PROVIDERS.some((provider) => provider === value);
}

export function CompactSelect({
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

export function ImageTextInput({
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

export function ImageNumberInput({
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

export function ImageField({
	children,
	description,
	label,
}: {
	children: ReactNode;
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

export function ImageBehaviorRow({
	children,
	description,
	label,
}: {
	children: ReactNode;
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

export function ImageHostingProviderFields({
	accessKey,
	accessKeyHideLabel,
	accessKeyLabel,
	accessKeyShowLabel,
	bucket,
	bucketLabel,
	credentialsConfigured,
	domain,
	domainLabel,
	endpoint,
	invalidProviderError,
	onAccessKeyChange,
	onBucketChange,
	onDomainChange,
	onEndpointChange,
	onSecretKeyChange,
	onServiceChange,
	providerOptions,
	secretKey,
	secretKeyHideLabel,
	secretKeyLabel,
	secretKeyShowLabel,
	secretRevealPort,
	service,
	serviceLabel,
	settingsRevision,
	strings,
	target,
}: {
	accessKey: string;
	accessKeyHideLabel: string;
	accessKeyLabel: string;
	accessKeyShowLabel: string;
	bucket: string;
	bucketLabel: string;
	credentialsConfigured: boolean;
	domain: string;
	domainLabel: string;
	endpoint: string;
	invalidProviderError: string;
	onAccessKeyChange: (value: string) => void;
	onBucketChange: (value: string) => void;
	onDomainChange: (value: string) => void;
	onEndpointChange: (value: string) => void;
	onSecretKeyChange: (value: string) => void;
	onServiceChange: (value: ImageSettings["service"]) => void;
	providerOptions: ReadonlyArray<SelectOption>;
	secretKey: string;
	secretKeyHideLabel: string;
	secretKeyLabel: string;
	secretKeyShowLabel: string;
	secretRevealPort: ImageHostingSecretRevealPort | undefined;
	service: ImageSettings["service"];
	serviceLabel: string;
	settingsRevision: number;
	strings: SettingsCenterBootstrap["strings"];
	target: ImageHostingTarget;
}) {
	return (
		<Fragment>
			<ImageField label={serviceLabel}>
				<CompactSelect
					label={serviceLabel}
					value={service}
					options={providerOptions}
					onChange={(value) => {
						if (!isImageHostProvider(value)) {
							throw new Error(invalidProviderError);
						}
						onServiceChange(value);
					}}
				/>
			</ImageField>
			{service !== "qiniu-kodo" ? (
				<ImageField label={strings.customDomain}>
					<ImageTextInput
						label={strings.customDomain}
						value={endpoint}
						onChange={onEndpointChange}
					/>
				</ImageField>
			) : null}
			<ImageField label={bucketLabel}>
				<div>
					<ImageTextInput
						label={bucketLabel}
						value={bucket}
						onChange={onBucketChange}
					/>
					{service === "tencent-cos" ? (
						<small>{strings.cosBucketHint}</small>
					) : null}
				</div>
			</ImageField>
			<ImageField label={domainLabel}>
				<ImageTextInput
					label={domainLabel}
					value={domain}
					onChange={onDomainChange}
				/>
			</ImageField>
			<ImageField label={accessKeyLabel}>
				<SecretCredentialInput
					configured={credentialsConfigured}
					field="accessKey"
					label={accessKeyLabel}
					value={accessKey}
					showLabel={accessKeyShowLabel}
					hideLabel={accessKeyHideLabel}
					onChange={onAccessKeyChange}
					revealFailedLabel={strings.secretRevealFailed}
					revealPort={secretRevealPort}
					revealingLabel={strings.revealingSecret}
					revision={settingsRevision}
					target={target}
				/>
			</ImageField>
			<ImageField label={secretKeyLabel}>
				<SecretCredentialInput
					configured={credentialsConfigured}
					field="secretKey"
					label={secretKeyLabel}
					value={secretKey}
					showLabel={secretKeyShowLabel}
					hideLabel={secretKeyHideLabel}
					onChange={onSecretKeyChange}
					revealFailedLabel={strings.secretRevealFailed}
					revealPort={secretRevealPort}
					revealingLabel={strings.revealingSecret}
					revision={settingsRevision}
					target={target}
				/>
			</ImageField>
		</Fragment>
	);
}
