import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "@wordpress/element";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import {
	IMAGE_UPLOAD_EXTENSIONS,
	type SettingsCenterSettings,
} from "../../contracts/settings-center-settings";
import { createWordPressImageHostingSecretRevealPort } from "../../integrations/wordpress/settings/create-wordpress-image-hosting-secret-reveal-port";
import { createWordPressImageHostingVerificationPort } from "../../integrations/wordpress/settings/create-wordpress-image-hosting-verification-port";
import {
	createWordPressSettingsPort,
	SettingsShortcutConflictError,
} from "../../integrations/wordpress/settings/create-wordpress-settings-port";
import { hasDuplicateImageHostConfiguration } from "./ImagesSettingsPage";
import {
	findShortcutConflicts,
	type ShortcutConflict,
} from "./ShortcutsSettingsPage";

type SaveError = "conflict" | "invalid" | "network" | "rejected" | null;
export type SaveFeedback = Readonly<{
	id: number;
	kind: "error" | "success";
	message: string;
}>;
type ImageVerificationInvalidation = Readonly<{
	primary: boolean;
	backup: boolean;
}>;

const PRIMARY_VERIFICATION_SETTING_KEYS = [
	"storagePath",
	"fileNameRule",
	"service",
	"endpoint",
	"bucket",
	"domain",
	"accessKey",
	"secretKey",
] as const;

const BACKUP_VERIFICATION_SETTING_KEYS = [
	"storagePath",
	"fileNameRule",
	"domain",
	"backupEnabled",
	"backupService",
	"backupEndpoint",
	"backupBucket",
	"backupDomain",
	"backupAccessKey",
	"backupSecretKey",
] as const;

const SETTINGS_SAVE_CONFIRMATION_DURATION = 2000;

function reconcileSavedSettings(
	requested: SettingsCenterSettings,
	authoritative: SettingsCenterSettings,
): SettingsCenterSettings {
	const unchanged = <Value,>(requestedValue: Value, savedValue: Value) =>
		JSON.stringify(requestedValue) === JSON.stringify(savedValue);
	return {
		revision: authoritative.revision,
		general: unchanged(requested.general, authoritative.general)
			? requested.general
			: authoritative.general,
		shortcuts: unchanged(requested.shortcuts, authoritative.shortcuts)
			? requested.shortcuts
			: authoritative.shortcuts,
		images: unchanged(requested.images, authoritative.images)
			? requested.images
			: authoritative.images,
		markdown: unchanged(requested.markdown, authoritative.markdown)
			? requested.markdown
			: authoritative.markdown,
	};
}

function imageVerificationInvalidation(
	previous: SettingsCenterSettings["images"],
	requested: SettingsCenterSettings["images"],
	resetSecrets: boolean,
): ImageVerificationInvalidation {
	const uploadFormatsChanged = IMAGE_UPLOAD_EXTENSIONS.some(
		(extension) =>
			previous.uploadFormats[extension] !== requested.uploadFormats[extension],
	);
	return {
		primary:
			resetSecrets ||
			uploadFormatsChanged ||
			PRIMARY_VERIFICATION_SETTING_KEYS.some(
				(key) => previous[key] !== requested[key],
			),
		backup:
			resetSecrets ||
			uploadFormatsChanged ||
			BACKUP_VERIFICATION_SETTING_KEYS.some(
				(key) => previous[key] !== requested[key],
			),
	};
}

export function useSettingsCenterPersistence({
	bootstrap,
	overlayRoot,
	scrollContainerRef,
}: {
	bootstrap: SettingsCenterBootstrap;
	overlayRoot: HTMLDivElement;
	scrollContainerRef: { readonly current: HTMLDivElement | null };
}) {
	const strings = bootstrap.strings;
	const [settings, setSettings] = useState<SettingsCenterSettings>(
		bootstrap.settings,
	);
	const [imageDraft, setImageDraft] = useState(bootstrap.drafts.images);
	const [verificationInvalidationTokens, setVerificationInvalidationTokens] =
		useState({ primary: 0, backup: 0 });
	const settingsRef = useRef<SettingsCenterSettings>(bootstrap.settings);
	const resetSecretsRef = useRef(false);
	const [savedSettings, setSavedSettings] = useState<SettingsCenterSettings>(
		bootstrap.settings,
	);
	const [saveStatus, setSaveStatus] = useState<
		"idle" | "saving" | "saved" | "error"
	>("idle");
	const [saveConflict, setSaveConflict] = useState(false);
	const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);
	const [saveFeedbackFocused, setSaveFeedbackFocused] = useState(false);
	const saveFeedbackIdRef = useRef(0);
	const saveControllerRef = useRef<AbortController | null>(null);
	const saveInFlightRef = useRef(false);
	const [duplicateSaveTrigger, setDuplicateSaveTrigger] =
		useState<HTMLButtonElement | null>(null);
	const [shortcutConflictDialog, setShortcutConflictDialog] =
		useState<Readonly<{
			conflicts: ReadonlyArray<ShortcutConflict>;
			returnFocus: HTMLButtonElement;
		}> | null>(null);

	const shortcutConflicts = useMemo(
		() =>
			findShortcutConflicts(
				settings.shortcuts.values,
				bootstrap.reservedShortcuts,
				strings,
			),
		[bootstrap.reservedShortcuts, settings.shortcuts.values, strings],
	);

	const showSaveFeedback = (kind: SaveFeedback["kind"], message: string) => {
		saveFeedbackIdRef.current += 1;
		setSaveFeedbackFocused(false);
		setSaveFeedback({ id: saveFeedbackIdRef.current, kind, message });
	};

	useEffect(
		() => () => {
			saveControllerRef.current?.abort();
		},
		[],
	);

	useEffect(() => {
		if ("saved" !== saveStatus) return;
		const windowRef = scrollContainerRef.current?.ownerDocument.defaultView;
		if (!windowRef)
			throw new Error("settings-center-save-confirmation-window-missing");
		const timeout = windowRef.setTimeout(() => {
			setSaveStatus((status) => ("saved" === status ? "idle" : status));
		}, SETTINGS_SAVE_CONFIRMATION_DURATION);
		return () => windowRef.clearTimeout(timeout);
	}, [saveStatus, scrollContainerRef]);

	useEffect(() => {
		if ("success" !== saveFeedback?.kind || saveFeedbackFocused) return;
		const windowRef = scrollContainerRef.current?.ownerDocument.defaultView;
		if (!windowRef)
			throw new Error("settings-center-save-feedback-window-missing");
		const feedbackId = saveFeedback.id;
		const timeout = windowRef.setTimeout(() => {
			setSaveFeedback((current) =>
				current?.id === feedbackId ? null : current,
			);
		}, SETTINGS_SAVE_CONFIRMATION_DURATION);
		return () => windowRef.clearTimeout(timeout);
	}, [saveFeedback, saveFeedbackFocused, scrollContainerRef]);

	const settingsPort = useMemo(
		() => createWordPressSettingsPort(bootstrap.api),
		[bootstrap.api],
	);
	const imageHostingVerificationPort = useMemo(
		() => createWordPressImageHostingVerificationPort(bootstrap.api),
		[bootstrap.api],
	);
	const imageHostingSecretRevealPort = useMemo(
		() => createWordPressImageHostingSecretRevealPort(bootstrap.api),
		[bootstrap.api],
	);

	const settingsDirty =
		resetSecretsRef.current ||
		JSON.stringify(settings) !== JSON.stringify(savedSettings);
	const saveBarVisible =
		settingsDirty || "saving" === saveStatus || saveConflict;

	const updateSettingsSection = useCallback(
		<Key extends keyof SettingsCenterSettings>(
			key: Key,
			value: SettingsCenterSettings[Key],
		) => {
			const previousSettings = settingsRef.current;
			const nextSettings: SettingsCenterSettings = {
				...previousSettings,
				[key]: value,
			};
			settingsRef.current = nextSettings;
			setSettings(nextSettings);
			setSaveFeedback(null);
			setSaveStatus((status) => ("saving" === status ? status : "idle"));
		},
		[],
	);
	const replaceSettingsDraft = useCallback(
		(nextSettings: SettingsCenterSettings) => {
			resetSecretsRef.current = false;
			setSaveConflict(false);
			setSaveFeedback(null);
			settingsRef.current = nextSettings;
			setSettings(nextSettings);
			setSaveStatus("idle");
		},
		[],
	);
	const resetSettingsDraft = useCallback(
		(nextSettings: SettingsCenterSettings) => {
			resetSecretsRef.current = true;
			setSaveConflict(false);
			setSaveFeedback(null);
			settingsRef.current = nextSettings;
			setSettings(nextSettings);
			setSaveStatus("idle");
		},
		[],
	);
	const updateGeneralSettings = useCallback(
		(value: SettingsCenterSettings["general"]) =>
			updateSettingsSection("general", value),
		[updateSettingsSection],
	);
	const updateShortcutSettings = useCallback(
		(value: SettingsCenterSettings["shortcuts"]) =>
			updateSettingsSection("shortcuts", value),
		[updateSettingsSection],
	);
	const updateImageSettings = useCallback(
		(value: SettingsCenterSettings["images"]) =>
			updateSettingsSection("images", value),
		[updateSettingsSection],
	);
	const updateMarkdownSettings = useCallback(
		(value: SettingsCenterSettings["markdown"]) =>
			updateSettingsSection("markdown", value),
		[updateSettingsSection],
	);
	const updateApplyEditorThemeToFrontend = useCallback(
		(value: boolean) =>
			updateSettingsSection("general", {
				...settingsRef.current.general,
				applyEditorThemeToFrontend: value,
			}),
		[updateSettingsSection],
	);

	const saveSettings = async (trigger: HTMLButtonElement) => {
		if (
			!settingsDirty ||
			"saving" === saveStatus ||
			saveConflict ||
			saveInFlightRef.current
		)
			return;
		if (shortcutConflicts.length > 0) {
			setShortcutConflictDialog({
				conflicts: shortcutConflicts,
				returnFocus: trigger,
			});
			return;
		}
		if (hasDuplicateImageHostConfiguration(settings.images)) {
			if (!overlayRoot) {
				throw new Error("settings-center-duplicate-dialog-root-missing");
			}
			setDuplicateSaveTrigger(trigger);
			return;
		}
		const controller = new AbortController();
		const requestedSettings = settings;
		const resetSecrets = resetSecretsRef.current;
		const verificationInvalidation = imageVerificationInvalidation(
			savedSettings.images,
			requestedSettings.images,
			resetSecrets,
		);
		saveInFlightRef.current = true;
		saveControllerRef.current?.abort();
		saveControllerRef.current = controller;
		setSaveFeedback(null);
		setSaveStatus("saving");
		try {
			const result = await settingsPort.save(
				requestedSettings,
				controller.signal,
				{ resetSecrets },
			);
			if (controller.signal.aborted) return;
			const saved = reconcileSavedSettings(requestedSettings, result.settings);
			setImageDraft((current) => {
				if (
					current.primaryCredentialsConfigured ===
						result.credentialStatus.primaryConfigured &&
					current.backupCredentialsConfigured ===
						result.credentialStatus.backupConfigured
				)
					return current;
				return {
					...current,
					primaryCredentialsConfigured:
						result.credentialStatus.primaryConfigured,
					backupCredentialsConfigured: result.credentialStatus.backupConfigured,
				};
			});
			if (verificationInvalidation.primary || verificationInvalidation.backup) {
				setVerificationInvalidationTokens((current) => ({
					primary: current.primary + (verificationInvalidation.primary ? 1 : 0),
					backup: current.backup + (verificationInvalidation.backup ? 1 : 0),
				}));
			}
			const currentSettingsUnchanged =
				JSON.stringify(settingsRef.current) ===
				JSON.stringify(requestedSettings);
			setSavedSettings(saved);
			if (currentSettingsUnchanged) {
				resetSecretsRef.current = false;
				settingsRef.current = saved;
				setSettings(saved);
			} else {
				const nextSettings = {
					...settingsRef.current,
					revision: saved.revision,
				};
				settingsRef.current = nextSettings;
				setSettings(nextSettings);
			}
			setSaveConflict(false);
			setSaveStatus(currentSettingsUnchanged ? "saved" : "idle");
			if (currentSettingsUnchanged) {
				showSaveFeedback("success", strings.settingsSaved);
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				if (error instanceof SettingsShortcutConflictError) {
					setShortcutConflictDialog({
						conflicts: [error.conflict],
						returnFocus: trigger,
					});
					showSaveFeedback("error", strings.settingsSaveRejected);
					setSaveStatus("error");
					return;
				}
				const code =
					error instanceof Error
						? error.message
						: "settings-center-save-rejected";
				const nextError: SaveError =
					"settings-center-save-conflict" === code
						? "conflict"
						: code.endsWith("-network-failed")
							? "network"
							: code.endsWith("-response-invalid")
								? "invalid"
								: "rejected";
				setSaveConflict("conflict" === nextError);
				setSaveStatus("error");
				if ("conflict" !== nextError) {
					showSaveFeedback(
						"error",
						"network" === nextError
							? strings.settingsSaveNetworkFailed
							: "invalid" === nextError
								? strings.settingsSaveInvalid
								: strings.settingsSaveRejected,
					);
				}
			}
		} finally {
			if (saveControllerRef.current === controller)
				saveControllerRef.current = null;
			saveInFlightRef.current = false;
		}
	};

	const reloadLatestSettings = async () => {
		if ("saving" === saveStatus) return;
		saveControllerRef.current?.abort();
		const controller = new AbortController();
		saveControllerRef.current = controller;
		setSaveFeedback(null);
		setSaveStatus("saving");
		try {
			const result = await settingsPort.get(controller.signal);
			if (controller.signal.aborted) return;
			const latest = result.settings;
			setSavedSettings(latest);
			settingsRef.current = latest;
			setSettings(latest);
			setImageDraft((current) => ({
				...current,
				primaryCredentialsConfigured: result.credentialStatus.primaryConfigured,
				backupCredentialsConfigured: result.credentialStatus.backupConfigured,
			}));
			setVerificationInvalidationTokens((current) => ({
				primary: current.primary + 1,
				backup: current.backup + 1,
			}));
			resetSecretsRef.current = false;
			setSaveConflict(false);
			setSaveStatus("idle");
		} catch (error) {
			if (!controller.signal.aborted) {
				const code =
					error instanceof Error
						? error.message
						: "settings-center-get-rejected";
				const nextError: Exclude<SaveError, "conflict" | null> = code.endsWith(
					"-network-failed",
				)
					? "network"
					: code.endsWith("-response-invalid")
						? "invalid"
						: "rejected";
				showSaveFeedback(
					"error",
					"network" === nextError
						? strings.settingsSaveNetworkFailed
						: "invalid" === nextError
							? strings.settingsSaveInvalid
							: strings.settingsSaveRejected,
				);
				setSaveStatus("error");
			}
		} finally {
			if (saveControllerRef.current === controller)
				saveControllerRef.current = null;
		}
	};

	return {
		duplicateSaveTrigger,
		imageDraft,
		imageHostingSecretRevealPort,
		imageHostingVerificationPort,
		reloadLatestSettings,
		replaceSettingsDraft,
		resetSettingsDraft,
		saveBarVisible,
		saveConflict,
		saveFeedback,
		saveSettings,
		saveStatus,
		setDuplicateSaveTrigger,
		setSaveFeedback,
		setSaveFeedbackFocused,
		setShortcutConflictDialog,
		settings,
		settingsDirty,
		shortcutConflictDialog,
		shortcutConflicts,
		updateApplyEditorThemeToFrontend,
		updateGeneralSettings,
		updateImageSettings,
		updateMarkdownSettings,
		updateShortcutSettings,
		verificationInvalidationTokens,
	};
}
