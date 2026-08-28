import {
	createElement,
	createPortal,
	Fragment,
	useEffect,
	useRef,
	useState,
} from "@wordpress/element";
import {
	parseSettingsCenterSettings,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { SettingsCenterSettings } from "../../contracts/settings-center-settings";
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
	X,
} from "../../generated/lucide-icons";
import { EditorMessageAlert } from "../../shared/ui/EditorMessageAlert";
import {
	formatSinglePlaceholder,
	useDialogFocusTrap,
} from "./settings-center-utils";

type Strings = SettingsCenterBootstrap["strings"];
type DialogKind = "reset" | "clear-cache" | "directory" | "status";
type ConfigurationCheck = Readonly<{
	label: string;
	valid: boolean;
	detail: string;
}>;

function createExportFileName(date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `easymde-config-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function createExportBaseName(value: string): string {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (
			character === "/" ||
			character === "\\" ||
			codePoint <= 0x1f ||
			(codePoint >= 0x7f && codePoint <= 0x9f)
		) {
			throw new Error("settings-center-transfer-export-name-invalid");
		}
	}
	const baseName = value.trim().replace(/\.json$/i, "");
	return baseName || createExportFileName();
}

function getLocalStorage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function clearEasyMdeLocalCache(): boolean {
	const storage = getLocalStorage();
	if (!storage) return false;
	try {
		const keys: string[] = [];
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (key?.startsWith("easymde:")) keys.push(key);
		}
		keys.forEach((key) => {
			storage.removeItem(key);
		});
		return true;
	} catch {
		return false;
	}
}

function redactImageSecrets(
	settings: SettingsCenterSettings,
): SettingsCenterSettings {
	return {
		...settings,
		images: {
			...settings.images,
			accessKey: "",
			secretKey: "",
			backupAccessKey: "",
			backupSecretKey: "",
		},
	};
}

async function readImportedSettings(
	file: File,
): Promise<SettingsCenterSettings> {
	if (file.size > 1024 * 1024)
		throw new Error("settings-center-transfer-import-too-large");
	const parsed: unknown = JSON.parse(await file.text());
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("settings-center-transfer-import-invalid");
	}
	const payload = parsed as Record<string, unknown>;
	if (
		payload.schemaVersion !== 1 &&
		payload.schemaVersion !== 2 &&
		payload.schemaVersion !== 3 &&
		payload.schemaVersion !== 4 &&
		payload.schemaVersion !== 5 &&
		payload.schemaVersion !== 6 &&
		payload.schemaVersion !== 7 &&
		payload.schemaVersion !== 8 &&
		payload.schemaVersion !== 9
	) {
		throw new Error("settings-center-transfer-import-version-invalid");
	}
	let importedSettings = payload.settings;
	if (payload.schemaVersion < 8) {
		if (
			!importedSettings ||
			typeof importedSettings !== "object" ||
			Array.isArray(importedSettings)
		) {
			throw new Error("settings-center-transfer-import-invalid");
		}
		const legacy = structuredClone(importedSettings) as Record<string, unknown>;
		const markdown = legacy.markdown as Record<string, unknown> | undefined;
		if (!markdown || Array.isArray(markdown)) {
			throw new Error("settings-center-transfer-import-invalid");
		}
		delete markdown.editorTheme;
		delete markdown.htmlRendering;
		const general = legacy.general as Record<string, unknown> | undefined;
		if (!general || Array.isArray(general)) {
			throw new Error("settings-center-transfer-import-invalid");
		}
		delete general.featuredImagePlaceholder;
		delete general.autoFocusEditor;
		if (general.statusBarMode === "words-reading-time") {
			general.statusBarMode = "detailed";
		} else if (general.statusBarMode === "words") {
			general.statusBarMode = "compact";
		}
		if (payload.schemaVersion < 4) {
			if (!("applyEditorThemeToFrontend" in general)) {
				general.applyEditorThemeToFrontend = true;
			}
			if (!("showPublishedCodeCopyButton" in general)) {
				general.showPublishedCodeCopyButton = true;
			}
			if (payload.schemaVersion < 3) {
				delete markdown.lineNumbers;
				if (payload.schemaVersion === 1) {
					const images = legacy.images as Record<string, unknown> | undefined;
					if (!images || Array.isArray(images)) {
						throw new Error("settings-center-transfer-import-invalid");
					}
					images.maxImageSizeMb = 5;
					images.titleDisplay =
						images.captionMode === "filename" ? "filename" : "none";
					for (const key of [
						"insertMarkdown",
						"preserveFileName",
						"copyUrl",
						"maxImageSize",
						"insertFormat",
						"altSource",
						"captionMode",
						"featuredPlaceholder",
					]) {
						delete images[key];
					}
					for (const key of [
						"lineEnding",
						"unorderedMarker",
						"orderedStart",
						"blockquoteStyle",
					]) {
						delete markdown[key];
					}
				}
			}
		}
		importedSettings = legacy;
	}
	return redactImageSecrets(parseSettingsCenterSettings(importedSettings));
}

function TransferDialog({
	kind,
	onClose,
	onConfirm,
	onCopyStorageLocation,
	configurationChecks,
	strings,
}: {
	kind: DialogKind;
	onClose: () => void;
	onConfirm: () => void;
	onCopyStorageLocation: () => void;
	configurationChecks: ReadonlyArray<ConfigurationCheck>;
	strings: Strings;
}) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const destructive = kind === "reset" || kind === "clear-cache";
	const title =
		kind === "reset"
			? strings.transferResetCurrentConfiguration
			: kind === "clear-cache"
				? strings.transferClearLocalCache
				: kind === "directory"
					? strings.transferConfigurationDirectory
					: strings.transferConfigurationStatusCheck;
	const Icon =
		kind === "reset"
			? RotateCcw
			: kind === "clear-cache"
				? Trash2
				: kind === "directory"
					? FolderOpen
					: CircleCheck;

	useDialogFocusTrap(dialogRef, closeButtonRef);

	return (
		<div
			className="easymde-settings-center__transfer-dialog-layer"
			role="presentation"
		>
			<button
				type="button"
				className="easymde-settings-center__dialog-backdrop"
				aria-label={strings.transferCloseOperationDialog}
				onClick={onClose}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="easymde-transfer-dialog-title"
				className="easymde-settings-center__transfer-dialog"
			>
				<header>
					<span className={destructive ? "is-destructive" : ""}>
						<Icon size={20} />
					</span>
					<div>
						<h2 id="easymde-transfer-dialog-title">{title}</h2>
						<p>
							{destructive
								? strings.transferLocalStateChangeDescription
								: kind === "directory"
									? strings.transferConfigurationDirectoryDescription
									: strings.transferConfigurationStatusDescription}
						</p>
					</div>
					<button
						ref={closeButtonRef}
						type="button"
						aria-label={strings.transferCloseOperationDialog}
						onClick={onClose}
					>
						<X size={20} />
					</button>
				</header>
				<div className="easymde-settings-center__transfer-dialog-body">
					{kind === "reset" || kind === "clear-cache" ? (
						<div className="easymde-settings-center__transfer-warning">
							{kind === "reset"
								? strings.transferResetWarning
								: strings.transferClearCacheWarning}
						</div>
					) : kind === "directory" ? (
						<div className="easymde-settings-center__transfer-directory">
							<p>{strings.transferStorageLocationDescription}</p>
							<div>
								<code>{strings.transferStorageLocationValue}</code>
								<button type="button" onClick={onCopyStorageLocation}>
									<Copy size={15} />
									{strings.transferCopyStorageLocation}
								</button>
							</div>
						</div>
					) : (
						<div className="easymde-settings-center__transfer-status-checks">
							<div>
								<span>
									{formatSinglePlaceholder(
										strings.transferChecksSummary,
										String(configurationChecks.length),
									)}
								</span>
								<strong>
									{formatSinglePlaceholder(
										strings.transferChecksPassed,
										String(
											configurationChecks.filter((check) => check.valid).length,
										),
									)}
								</strong>
							</div>
							<section>
								{configurationChecks.map((check) => (
									<div key={check.label}>
										{check.valid ? (
											<CircleCheck size={18} />
										) : (
											<CircleX size={18} className="is-invalid" />
										)}
										<span>
											<strong>{check.label}</strong>
											<small>{check.detail}</small>
										</span>
									</div>
								))}
							</section>
						</div>
					)}
				</div>
				<footer>
					<button type="button" onClick={onClose}>
						{destructive ? strings.cancel : strings.transferClose}
					</button>
					{destructive ? (
						<button type="button" onClick={onConfirm}>
							{kind === "reset"
								? strings.transferConfirmReset
								: strings.transferConfirmClear}
						</button>
					) : null}
				</footer>
			</div>
		</div>
	);
}

export function TransferSettingsPage({
	overlayRoot,
	bootstrap,
	settings,
	defaultSettings,
	onSettingsChange,
	onResetSettings,
}: {
	overlayRoot: HTMLElement | null;
	bootstrap: SettingsCenterBootstrap;
	settings: SettingsCenterSettings;
	defaultSettings: SettingsCenterSettings;
	onSettingsChange: (settings: SettingsCenterSettings) => void;
	onResetSettings: (settings: SettingsCenterSettings) => void;
}) {
	const { assets, strings } = bootstrap;
	const [exportFileName, setExportFileName] = useState(createExportFileName);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importing, setImporting] = useState(false);
	const [dialog, setDialog] = useState<DialogKind | null>(null);
	const [feedback, setFeedback] = useState<string | null>(null);
	const importFileRef = useRef<HTMLInputElement>(null);
	const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (!dialog) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setDialog(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [dialog]);

	useEffect(() => {
		if (dialog) return;
		dialogTriggerRef.current?.focus();
		dialogTriggerRef.current = null;
	}, [dialog]);

	const selectImportFile = (file: File | null) => {
		setImportFile(file);
		setFeedback(
			file
				? formatSinglePlaceholder(strings.transferFileSelectedNotice, file.name)
				: null,
		);
	};
	const openDialog = (kind: DialogKind, trigger: HTMLButtonElement) => {
		if (kind === "clear-cache")
			throw new Error("settings-center-transfer-mutation-unavailable");
		dialogTriggerRef.current = trigger;
		setDialog(kind);
	};
	const resetSettings = () => {
		onResetSettings({ ...defaultSettings, revision: settings.revision });
		setFeedback(strings.transferResetApplied);
	};
	const clearLocalCache = () => {
		setFeedback(
			clearEasyMdeLocalCache()
				? strings.transferLocalCacheCleared
				: strings.transferLocalCacheClearFailed,
		);
	};
	const confirmDialog = () => {
		if ("reset" === dialog) resetSettings();
		if ("clear-cache" === dialog) clearLocalCache();
		setDialog(null);
	};
	const exportConfiguration = () => {
		try {
			if (typeof URL.createObjectURL !== "function")
				throw new Error("settings-center-transfer-export-unavailable");
			const baseName = createExportBaseName(exportFileName);
			const blob = new Blob(
				[
					JSON.stringify(
						{ schemaVersion: 9, settings: redactImageSecrets(settings) },
						null,
						2,
					),
				],
				{ type: "application/json" },
			);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${baseName}.json`;
			anchor.rel = "noopener";
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
			setFeedback(strings.transferExportSuccess);
		} catch (error) {
			setFeedback(
				error instanceof Error &&
					error.message === "settings-center-transfer-export-name-invalid"
					? strings.transferExportNameInvalid
					: strings.transferExportFailed,
			);
		}
	};
	const importConfiguration = async () => {
		if (!importFile || importing) return;
		setImporting(true);
		try {
			const imported = await readImportedSettings(importFile);
			onSettingsChange({ ...imported, revision: settings.revision });
			setImportFile(null);
			if (importFileRef.current) importFileRef.current.value = "";
			setFeedback(strings.transferImportApplied);
		} catch {
			setFeedback(strings.transferImportInvalid);
		} finally {
			setImporting(false);
		}
	};
	const imageDraftReady = Boolean(settings.images.domain.trim());
	const configurationChecks: ReadonlyArray<ConfigurationCheck> = [
		{
			label: strings.transferCheckRuntimeAssets,
			valid: Boolean(
				assets.brandMarkUrl.trim() &&
					assets.headerIllustrationUrl.trim() &&
					assets.searchEmptyIllustrationUrl.trim(),
			),
			detail: strings.transferCheckRuntimeAssetsReady,
		},
		{
			label: strings.transferCheckImageDraft,
			valid: imageDraftReady,
			detail: imageDraftReady
				? strings.transferCheckImageDraftReady
				: strings.transferCheckImageDraftIncomplete,
		},
	];
	const copyStorageLocation = async () => {
		try {
			if (!navigator.clipboard?.writeText)
				throw new Error("settings-center-transfer-clipboard-unavailable");
			await navigator.clipboard.writeText(strings.transferStorageLocationValue);
			setFeedback(strings.transferStorageLocationCopied);
		} catch {
			setFeedback(strings.transferStorageLocationCopyFailed);
		}
	};

	const dialogPortal =
		dialog && overlayRoot
			? createPortal(
					<TransferDialog
						kind={dialog}
						strings={strings}
						configurationChecks={configurationChecks}
						onCopyStorageLocation={() => {
							void copyStorageLocation();
						}}
						onClose={() => setDialog(null)}
						onConfirm={confirmDialog}
					/>,
					overlayRoot,
				)
			: null;
	const feedbackPortal =
		feedback && overlayRoot
			? createPortal(
					<div className="easymde-editor-message-alert-host">
						<EditorMessageAlert
							closeLabel={strings.closeTransferFeedback}
							message={feedback}
							onDismiss={() => setFeedback(null)}
							type="info"
						/>
					</div>,
					overlayRoot,
				)
			: null;

	return (
		<div className="easymde-settings-center__transfer-page">
			<p
				id="easymde-transfer-unavailable"
				className="easymde-settings-center__transfer-unavailable-notice easymde-settings-center__visually-hidden"
				role="note"
			>
				{strings.transferUnavailableSettingsNotice}
			</p>
			<div className="easymde-settings-center__transfer-primary-groups">
				<section className="easymde-settings-center__transfer-group is-export">
					<h2>
						<Download size={29} />
						{strings.transferExportConfiguration}
					</h2>
					<p>{strings.transferExportConfigurationDescription}</p>
					<div className="easymde-settings-center__transfer-export-form">
						<label htmlFor="easymde-transfer-export-name">
							{strings.transferFileName}
						</label>
						<div>
							<input
								id="easymde-transfer-export-name"
								value={exportFileName}
								aria-label={strings.transferExportFileName}
								onChange={(event) => setExportFileName(event.target.value)}
							/>
							<span>.json</span>
						</div>
						<button type="button" onClick={exportConfiguration}>
							<Download size={17} />
							{strings.transferExportConfiguration}
						</button>
					</div>
				</section>

				<section className="easymde-settings-center__transfer-group is-import">
					<h2>
						<Upload size={29} />
						{strings.transferImportConfiguration}
					</h2>
					<p>{strings.transferImportConfigurationDescription}</p>
					<div className="easymde-settings-center__transfer-import-actions">
						<button
							type="button"
							onClick={() => importFileRef.current?.click()}
						>
							<Upload size={17} />
							{strings.transferChooseConfigurationFile}
						</button>
						<input
							ref={importFileRef}
							type="file"
							accept="application/json,.json"
							aria-label={strings.transferChooseConfigurationFile}
							onChange={(event) =>
								selectImportFile(event.target.files?.[0] ?? null)
							}
						/>
						{importFile ? (
							<Fragment>
								<span className="easymde-settings-center__transfer-file-chip">
									<CircleCheck size={16} />
									<span>{importFile.name}</span>
								</span>
								<button
									type="button"
									disabled={importing}
									aria-busy={importing}
									onClick={() => {
										void importConfiguration();
									}}
								>
									{importing
										? strings.savingSettings
										: strings.transferConfirmImport}
								</button>
							</Fragment>
						) : null}
					</div>
					<div className="easymde-settings-center__transfer-instructions">
						<h3>{strings.transferImportInstructions}</h3>
						<div>
							{[
								strings.transferImportOverwriteNotice,
								strings.transferImportCompatibilityNotice,
								strings.transferImportScopeNotice,
							].map((item) => (
								<p key={item}>
									<Info size={15} />
									{item}
								</p>
							))}
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
							kind: "reset" as const,
							label: strings.transferResetCurrentConfiguration,
							description: strings.transferResetCurrentConfigurationDescription,
							icon: RotateCcw,
						},
						{
							kind: "clear-cache" as const,
							label: strings.transferClearLocalCache,
							description: strings.transferClearLocalCacheDescription,
							icon: Trash2,
						},
						{
							kind: "directory" as const,
							label: strings.transferOpenConfigurationDirectory,
							description:
								strings.transferOpenConfigurationDirectoryDescription,
							icon: FolderOpen,
						},
						{
							kind: "status" as const,
							label: strings.transferViewConfigurationStatus,
							description: strings.transferViewConfigurationStatusDescription,
							icon: CircleCheck,
						},
					].map(({ kind, label, description, icon: Icon }) => (
						<button
							type="button"
							key={kind}
							disabled={kind === "clear-cache"}
							aria-describedby={
								kind === "clear-cache"
									? "easymde-transfer-unavailable"
									: undefined
							}
							title={
								kind === "clear-cache"
									? strings.transferUnavailableSettingsNotice
									: undefined
							}
							onClick={(event) => openDialog(kind, event.currentTarget)}
						>
							<Icon size={25} />
							<span>
								<strong>{label}</strong>
								<small>{description}</small>
							</span>
						</button>
					))}
				</div>
			</section>
			{dialogPortal}
			{feedbackPortal}
		</div>
	);
}
