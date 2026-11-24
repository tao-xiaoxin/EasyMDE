import {
	createElement,
	createPortal,
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "@wordpress/element";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import { ChevronRight, X } from "../../generated/lucide-icons";
import { EditorMessageAlert } from "../../shared/ui/EditorMessageAlert";
import { AboutDialog, AboutSettingsPage } from "./AboutSettingsPage";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import {
	DuplicateImageHostDialog,
	ImagesSettingsPage,
} from "./ImagesSettingsPage";
import { MarkdownSettingsPage } from "./MarkdownSettingsPage";
import {
	ShortcutConflictDialog,
	ShortcutsSettingsPage,
} from "./ShortcutsSettingsPage";
import { SearchIcon } from "./settings-center-icons";
import {
	NAV_ITEMS,
	type NavId,
	SettingsSearchResults,
	useSettingsCenterSearch,
} from "./settings-center-search";
import { formatSinglePlaceholder } from "./settings-center-utils";
import { TransferSettingsPage } from "./TransferSettingsPage";
import { useSettingsCenterNavigation } from "./use-settings-center-navigation";
import { useSettingsCenterPersistence } from "./use-settings-center-persistence";

const SETTINGS_IMAGE_RUNTIME_CAPABILITIES = { compressImages: true } as const;
const MemoizedGeneralSettingsPage = memo(GeneralSettingsPage);
const MemoizedShortcutsSettingsPage = memo(ShortcutsSettingsPage);
const MemoizedImagesSettingsPage = memo(ImagesSettingsPage);
const MemoizedMarkdownSettingsPage = memo(MarkdownSettingsPage);
const MemoizedTransferSettingsPage = memo(TransferSettingsPage);
const MemoizedAboutSettingsPage = memo(AboutSettingsPage);

export function SettingsCenterRoot({
	bootstrap,
	overlayRoot: providedOverlayRoot,
}: {
	bootstrap: SettingsCenterBootstrap;
	overlayRoot?: HTMLDivElement;
}) {
	const ownedOverlayRoot = useMemo(() => {
		if (providedOverlayRoot) return null;
		const element = document.createElement("div");
		element.dataset.settingsOverlayRoot = "";
		return element;
	}, [providedOverlayRoot]);
	const overlayRoot = providedOverlayRoot ?? ownedOverlayRoot;
	if (!overlayRoot) throw new Error("settings-center-overlay-root-missing");

	const [sidebarHelpOpen, setSidebarHelpOpen] = useState(false);
	const sidebarHelpTriggerRef = useRef<HTMLButtonElement>(null);
	const sidebarHelpWasOpenRef = useRef(false);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const navigationRef = useRef<HTMLElement>(null);
	const stickyHeaderRef = useRef<HTMLDivElement>(null);
	const saveBarRef = useRef<HTMLDivElement>(null);
	const sectionRefs = useRef<Partial<Record<NavId, HTMLElement | null>>>({});

	useEffect(() => {
		if (!ownedOverlayRoot) return;
		const owner = scrollContainerRef.current;
		if (!owner) throw new Error("settings-center-overlay-owner-missing");
		owner.append(ownedOverlayRoot);
		return () => ownedOverlayRoot.remove();
	}, [ownedOverlayRoot]);

	const strings = bootstrap.strings;
	const {
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
	} = useSettingsCenterPersistence({
		bootstrap,
		overlayRoot,
		scrollContainerRef,
	});

	const {
		ensureSearchIndex,
		normalizedQuery,
		normalizedQueryRef,
		query,
		searchResultCount,
		searchSections,
		setQuery,
	} = useSettingsCenterSearch({
		scrollContainerRef,
		strings,
	});

	const {
		current,
		handleSettingsScroll,
		highlightedNavId,
		navigateToSection,
		openSearchResult,
	} = useSettingsCenterNavigation({
		navigationRef,
		normalizedQuery,
		normalizedQueryRef,
		saveBarRef,
		saveBarVisible,
		scrollContainerRef,
		searchSections,
		sectionRefs,
		setQuery,
		stickyHeaderRef,
	});

	const brandSuffixLength = 3;
	const brandPrefix = strings.brandName.slice(0, -brandSuffixLength);
	const brandSuffix = strings.brandName.slice(-brandSuffixLength);
	const pageTitle = normalizedQuery
		? strings.searchPageTitle
		: strings[current.title ?? current.label];
	const pageDescription = normalizedQuery
		? formatSinglePlaceholder(strings.searchPageDescription, query.trim())
		: strings[current.description];

	useEffect(() => {
		if (!sidebarHelpOpen) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setSidebarHelpOpen(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [sidebarHelpOpen]);

	useEffect(() => {
		if (sidebarHelpOpen) {
			sidebarHelpWasOpenRef.current = true;
			return;
		}
		if (!sidebarHelpWasOpenRef.current) return;
		sidebarHelpWasOpenRef.current = false;
		sidebarHelpTriggerRef.current?.focus();
	}, [sidebarHelpOpen]);

	return (
		<div
			ref={scrollContainerRef}
			onScroll={handleSettingsScroll}
			className="easymde-settings-center"
		>
			<div className="easymde-settings-center__frame">
				<aside className="easymde-settings-center__sidebar">
					<div className="easymde-settings-center__brand-wrap">
						<div className="easymde-settings-center__brand">
							<img
								src={bootstrap.assets.brandMarkUrl}
								alt={strings.brandName}
							/>
							<div>
								<strong>
									{brandPrefix}
									<b>{brandSuffix}</b>
								</strong>
								<span>{strings.settingsCenter}</span>
							</div>
						</div>
					</div>
					<nav ref={navigationRef} aria-label={strings.settingsNavigation}>
						{NAV_ITEMS.map(({ id, icon: NavIcon, label }) => (
							<button
								key={id}
								type="button"
								data-nav-id={id}
								aria-current={highlightedNavId === id ? "page" : undefined}
								onClick={() => navigateToSection(id)}
							>
								<NavIcon size={25} />
								<span>{strings[label]}</span>
								<i aria-hidden="true" />
							</button>
						))}
					</nav>
					<section className="easymde-settings-center__help">
						<div>
							<span>
								<img src={bootstrap.assets.brandMarkUrl} alt="" />
							</span>
							<div>
								<h2>{strings.helpTitle}</h2>
								<p>{strings.helpDescription}</p>
							</div>
						</div>
						<button
							ref={sidebarHelpTriggerRef}
							type="button"
							onClick={() => setSidebarHelpOpen(true)}
						>
							{strings.openDocumentation}
							<ChevronRight size={12} />
						</button>
					</section>
				</aside>
				<main>
					<div
						ref={stickyHeaderRef}
						className="easymde-settings-center__sticky-header"
					>
						<div className="easymde-settings-center__header-scale">
							<header>
								<img src={bootstrap.assets.headerIllustrationUrl} alt="" />
								<a
									href={bootstrap.closeUrl}
									aria-label={strings.closeSettingsCenter}
								>
									<X size={23} strokeWidth={1.8} />
								</a>
								<div>
									<h1>{pageTitle}</h1>
									<p>{pageDescription}</p>
								</div>
							</header>
							<div className="easymde-settings-center__search">
								<SearchIcon size={20} />
								<input
									type="search"
									value={query}
									aria-label={strings.searchSettings}
									placeholder={strings.searchSettingsPlaceholder}
									onFocus={ensureSearchIndex}
									onChange={(event) => {
										if (event.target.value.trim()) ensureSearchIndex();
										setQuery(event.target.value);
									}}
								/>
								{query ? (
									<button
										type="button"
										aria-label={strings.clearSearch}
										onClick={() => setQuery("")}
									>
										<X size={17} />
									</button>
								) : null}
							</div>
						</div>
					</div>
					<div
						ref={saveBarRef}
						className={`easymde-settings-center__save-bar${saveBarVisible ? "" : " is-hidden"}`}
						aria-live="polite"
					>
						<span data-save-status={saveStatus}>
							{saveConflict
								? strings.settingsConflict
								: settingsDirty
									? strings.settingsUnsavedChanges
									: ""}
						</span>
						<button
							type="button"
							aria-busy={"saving" === saveStatus}
							disabled={
								"saving" === saveStatus || (!settingsDirty && !saveConflict)
							}
							onClick={(event) => {
								if (saveConflict) {
									void reloadLatestSettings();
								} else {
									void saveSettings(event.currentTarget);
								}
							}}
						>
							{"saving" === saveStatus
								? strings.savingSettings
								: saveConflict
									? strings.reloadSettings
									: strings.saveSettings}
						</button>
					</div>
					<div className="easymde-settings-center__content-scale">
						<div className="easymde-settings-center__content">
							{normalizedQuery ? (
								<SettingsSearchResults
									onOpenResult={openSearchResult}
									query={query}
									searchEmptyIllustrationUrl={
										bootstrap.assets.searchEmptyIllustrationUrl
									}
									searchResultCount={searchResultCount}
									searchSections={searchSections}
									strings={strings}
								/>
							) : null}
							<div
								className={`easymde-settings-center__sections${normalizedQuery ? " is-search-hidden" : ""}`}
							>
								<section
									id="settings-section-general"
									data-settings-section="general"
									ref={(element) => {
										sectionRefs.current.general = element;
									}}
									className="easymde-settings-center__settings-section"
								>
									<MemoizedGeneralSettingsPage
										embedded
										query=""
										searchEmptyIllustrationUrl={
											bootstrap.assets.searchEmptyIllustrationUrl
										}
										settings={settings.general}
										onChange={updateGeneralSettings}
										strings={strings}
									/>
								</section>
								<section
									id="settings-section-shortcuts"
									data-settings-section="shortcuts"
									ref={(element) => {
										sectionRefs.current.shortcuts = element;
									}}
									className="easymde-settings-center__settings-section"
								>
									<MemoizedShortcutsSettingsPage
										conflicts={shortcutConflicts}
										defaultValues={bootstrap.defaultSettings.shortcuts.values}
										settings={settings.shortcuts}
										onChange={updateShortcutSettings}
										strings={strings}
									/>
								</section>
								<section
									id="settings-section-images"
									data-settings-section="images"
									ref={(element) => {
										sectionRefs.current.images = element;
									}}
									className="easymde-settings-center__settings-section"
								>
									<MemoizedImagesSettingsPage
										brandMarkUrl={bootstrap.assets.brandMarkUrl}
										verificationInvalidationTokens={
											verificationInvalidationTokens
										}
										uploadVerificationPort={imageHostingVerificationPort}
										settingsRevision={settings.revision}
										secretRevealPort={imageHostingSecretRevealPort}
										runtimeCapabilities={SETTINGS_IMAGE_RUNTIME_CAPABILITIES}
										uploadLimits={bootstrap.uploadLimits}
										draft={imageDraft}
										overlayRoot={overlayRoot}
										settings={settings.images}
										onChange={updateImageSettings}
										strings={strings}
									/>
								</section>
								<section
									id="settings-section-markdown"
									data-settings-section="markdown"
									ref={(element) => {
										sectionRefs.current.markdown = element;
									}}
									className="easymde-settings-center__settings-section"
								>
									<MemoizedMarkdownSettingsPage
										applyEditorThemeToFrontend={
											settings.general.applyEditorThemeToFrontend
										}
										onApplyEditorThemeToFrontendChange={
											updateApplyEditorThemeToFrontend
										}
										settings={settings.markdown}
										onChange={updateMarkdownSettings}
										strings={strings}
									/>
								</section>
								<section
									id="settings-section-transfer"
									data-settings-section="transfer"
									ref={(element) => {
										sectionRefs.current.transfer = element;
									}}
									className="easymde-settings-center__settings-section"
								>
									<MemoizedTransferSettingsPage
										overlayRoot={overlayRoot}
										bootstrap={bootstrap}
										settings={settings}
										defaultSettings={bootstrap.defaultSettings}
										onSettingsChange={replaceSettingsDraft}
										onResetSettings={resetSettingsDraft}
									/>
								</section>
								<section
									id="settings-section-about"
									data-settings-section="about"
									ref={(element) => {
										sectionRefs.current.about = element;
									}}
									className="easymde-settings-center__settings-section"
								>
									<MemoizedAboutSettingsPage
										overlayRoot={overlayRoot}
										bootstrap={bootstrap}
									/>
								</section>
							</div>
						</div>
					</div>
					<div
						className="easymde-settings-center__content-footer-space"
						aria-hidden="true"
					/>
				</main>
			</div>
			{sidebarHelpOpen && overlayRoot
				? createPortal(
						<AboutDialog
							kind="help"
							strings={strings}
							documentationUrl={bootstrap.links.documentationUrl}
							onClose={() => setSidebarHelpOpen(false)}
						/>,
						overlayRoot,
					)
				: null}
			{duplicateSaveTrigger && overlayRoot
				? createPortal(
						<DuplicateImageHostDialog
							returnFocus={duplicateSaveTrigger}
							strings={strings}
							onClose={() => setDuplicateSaveTrigger(null)}
						/>,
						overlayRoot,
					)
				: null}
			{shortcutConflictDialog && overlayRoot
				? createPortal(
						<ShortcutConflictDialog
							conflicts={shortcutConflictDialog.conflicts}
							returnFocus={shortcutConflictDialog.returnFocus}
							strings={strings}
							onClose={() => setShortcutConflictDialog(null)}
						/>,
						overlayRoot,
					)
				: null}
			{saveFeedback && overlayRoot
				? createPortal(
						<div
							key={saveFeedback.id}
							className="easymde-editor-message-alert-host"
						>
							<EditorMessageAlert
								closeLabel={strings.closeSettingsFeedback}
								message={saveFeedback.message}
								onDismiss={() => setSaveFeedback(null)}
								onFocusChange={setSaveFeedbackFocused}
								type={saveFeedback.kind}
							/>
						</div>,
						overlayRoot,
					)
				: null}
		</div>
	);
}
