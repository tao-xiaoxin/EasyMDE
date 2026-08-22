import {
	createElement,
	createPortal,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "@wordpress/element";
import type {
	SettingsCenterBootstrap,
	SettingsCenterStringKey,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { SettingsCenterSettings } from "../../contracts/settings-center-settings";
import { ChevronRight, X } from "../../generated/lucide-icons";
import { createWordPressSettingsPort } from "../../integrations/wordpress/settings/create-wordpress-settings-port";
import { AboutDialog, AboutSettingsPage } from "./AboutSettingsPage";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { ImagesSettingsPage } from "./ImagesSettingsPage";
import { MarkdownSettingsPage } from "./MarkdownSettingsPage";
import { ShortcutsSettingsPage } from "./ShortcutsSettingsPage";
import {
	AboutIcon,
	GeneralIcon,
	ImageLibraryIcon,
	ImportExportIcon,
	KeyboardIcon,
	MarkdownIcon,
	SearchIcon,
} from "./settings-center-icons";
import { formatSinglePlaceholder } from "./settings-center-utils";
import { TransferSettingsPage } from "./TransferSettingsPage";

type NavId =
	| "general"
	| "shortcuts"
	| "images"
	| "markdown"
	| "transfer"
	| "about";
type Icon = typeof GeneralIcon;

type SearchItem = Readonly<{
	key: string;
	kind: "group" | "setting";
	tabId: NavId;
	tabLabel: string;
	groupTitle: string;
	label: string;
	description: string;
	searchText: string;
	targetId: string;
}>;
type SearchGroup = Readonly<{
	title: string;
	items: ReadonlyArray<SearchItem>;
}>;
type SearchSection = Readonly<{
	tabId: NavId;
	tabLabel: string;
	groups: ReadonlyArray<SearchGroup>;
}>;
type SaveError = "conflict" | "invalid" | "network" | "rejected" | null;
const NAV_ITEMS: ReadonlyArray<
	Readonly<{
		id: NavId;
		label: SettingsCenterStringKey;
		title?: SettingsCenterStringKey;
		description: SettingsCenterStringKey;
		icon: Icon;
	}>
> = [
	{
		id: "general",
		label: "general",
		description: "generalDescription",
		icon: GeneralIcon,
	},
	{
		id: "shortcuts",
		label: "shortcuts",
		description: "shortcutsDescription",
		icon: KeyboardIcon,
	},
	{
		id: "images",
		label: "images",
		description: "imagesDescription",
		icon: ImageLibraryIcon,
	},
	{
		id: "markdown",
		label: "markdown",
		description: "markdownDescription",
		icon: MarkdownIcon,
	},
	{
		id: "transfer",
		label: "transfer",
		title: "transferPageTitle",
		description: "transferDescription",
		icon: ImportExportIcon,
	},
	{
		id: "about",
		label: "about",
		description: "aboutDescription",
		icon: AboutIcon,
	},
];

const SETTINGS_SAVE_CONFIRMATION_DURATION = 2000;
const SETTINGS_SECTION_ACTIVATION_OFFSET = 15;
const SETTINGS_SECTION_SCROLL_LEAD = 6;
const SETTINGS_SEARCH_RESULT_SCROLL_TRAIL = 18;
const SETTINGS_SEARCH_FOCUSABLE_CONTROL_SELECTOR = [
	'input:not([type="hidden"]):not(:disabled):not([aria-disabled="true"])',
	'select:not(:disabled):not([aria-disabled="true"])',
	'textarea:not(:disabled):not([aria-disabled="true"])',
	'button:not(:disabled):not([aria-disabled="true"])',
	'a[href]:not([aria-disabled="true"])',
].join(", ");
export function SettingsCenterRoot({
	bootstrap,
}: {
	bootstrap: SettingsCenterBootstrap;
}) {
	const [activeTab, setActiveTab] = useState<NavId>("general");
	const [settings, setSettings] = useState<SettingsCenterSettings>(
		bootstrap.settings,
	);
	const settingsRef = useRef<SettingsCenterSettings>(bootstrap.settings);
	const resetSecretsRef = useRef(false);
	const [savedSettings, setSavedSettings] = useState<SettingsCenterSettings>(
		bootstrap.settings,
	);
	const [saveStatus, setSaveStatus] = useState<
		"idle" | "saving" | "saved" | "error"
	>("idle");
	const [saveConflict, setSaveConflict] = useState(false);
	const [saveError, setSaveError] = useState<SaveError>(null);
	const [transferMutationUnavailable, setTransferMutationUnavailable] =
		useState(false);
	const saveControllerRef = useRef<AbortController | null>(null);
	const [query, setQuery] = useState("");
	const [searchItems, setSearchItems] = useState<ReadonlyArray<SearchItem>>([]);
	const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
	const [sidebarHelpOpen, setSidebarHelpOpen] = useState(false);
	const sidebarHelpTriggerRef = useRef<HTMLButtonElement>(null);
	const sidebarHelpWasOpenRef = useRef(false);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const stickyHeaderRef = useRef<HTMLDivElement>(null);
	const saveBarRef = useRef<HTMLDivElement>(null);
	const sectionRefs = useRef<Partial<Record<NavId, HTMLElement | null>>>({});
	const searchIndexSignatureRef = useRef("");
	const searchNavigationFrameRef = useRef<number | null>(null);
	const searchNavigationWindowRef = useRef<Window | null>(null);
	const strings = bootstrap.strings;
	const brandSuffixLength = 3;
	const brandPrefix = strings.brandName.slice(0, -brandSuffixLength);
	const brandSuffix = strings.brandName.slice(-brandSuffixLength);
	const current = NAV_ITEMS.find((item) => item.id === activeTab);
	if (!current) throw new Error("settings-center-active-tab-invalid");
	const normalizedQuery = query.trim().toLowerCase();
	const searchSections = useMemo<ReadonlyArray<SearchSection>>(() => {
		if (!normalizedQuery) return [];

		return NAV_ITEMS.flatMap((navItem) => {
			const groupMap = new Map<string, SearchItem[]>();
			for (const item of searchItems.filter(
				(candidate) => candidate.tabId === navItem.id,
			)) {
				const items = groupMap.get(item.groupTitle) ?? [];
				items.push(item);
				groupMap.set(item.groupTitle, items);
			}
			const groups = Array.from(groupMap, ([title, items]) => {
				const groupMatches = title.toLowerCase().includes(normalizedQuery);
				const matches = items.filter(
					(item) => groupMatches || item.searchText.includes(normalizedQuery),
				);
				const hasSetting = matches.some((item) => item.kind === "setting");
				return {
					title,
					items: hasSetting
						? matches.filter((item) => item.kind === "setting")
						: matches,
				};
			}).filter((group) => group.items.length > 0);

			return groups.length > 0
				? [{ tabId: navItem.id, tabLabel: strings[navItem.label], groups }]
				: [];
		});
	}, [normalizedQuery, searchItems, strings]);
	const searchResultCount = searchSections.reduce(
		(total, section) =>
			total +
			section.groups.reduce(
				(groupTotal, group) => groupTotal + group.items.length,
				0,
			),
		0,
	);
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

	useEffect(() => {
		const root = scrollContainerRef.current;
		if (!root) throw new Error("settings-center-search-root-missing");
		const rebuildSearchIndex = () => {
			const indexedItems: SearchItem[] = [];
			const readHeadingTitle = (heading: HTMLElement) =>
				heading.dataset.settingsSearchTitle?.trim() ||
				heading.textContent?.replace(/\s+/g, " ").trim() ||
				"";

			for (const section of root.querySelectorAll<HTMLElement>(
				"[data-settings-section]",
			)) {
				const tabId = section.dataset.settingsSection as NavId | undefined;
				const navItem = NAV_ITEMS.find((item) => item.id === tabId);
				if (!tabId || !navItem) {
					throw new Error(
						`settings-center-search-section-${tabId ?? "missing"}-invalid`,
					);
				}
				const headings = Array.from(
					section.querySelectorAll<HTMLElement>("h2, h3"),
				);
				headings.forEach((heading, headingIndex) => {
					const label = readHeadingTitle(heading);
					if (!label)
						throw new Error(
							`settings-center-search-heading-${tabId}-${headingIndex}-empty`,
						);
					const targetId =
						heading.id || `settings-search-${tabId}-heading-${headingIndex}`;
					heading.id = targetId;
					const nextElement = heading.nextElementSibling;
					const description =
						nextElement?.tagName === "P"
							? (nextElement.textContent?.replace(/\s+/g, " ").trim() ?? "")
							: "";
					indexedItems.push({
						key: `${tabId}:group:${headingIndex}`,
						kind: "group",
						tabId,
						tabLabel: strings[navItem.label],
						groupTitle: label,
						label,
						description,
						searchText: `${label} ${description}`.toLowerCase(),
						targetId,
					});
				});

				Array.from(
					section.querySelectorAll<HTMLElement>("[data-setting-search]"),
				).forEach((row, rowIndex) => {
					const label = row.dataset.settingLabel?.trim();
					if (!label)
						throw new Error(
							`settings-center-search-setting-${tabId}-${rowIndex}-label-missing`,
						);
					const targetId =
						row.id || `settings-search-${tabId}-setting-${rowIndex}`;
					row.id = targetId;
					const groupContainer = row.closest<HTMLElement>("section") ?? section;
					const precedingHeadings = Array.from(
						groupContainer.querySelectorAll<HTMLElement>("h2, h3"),
					).filter((heading) =>
						Boolean(
							heading.compareDocumentPosition(row) &
								Node.DOCUMENT_POSITION_FOLLOWING,
						),
					);
					const groupTitle =
						row.dataset.settingGroup?.trim() ||
						(precedingHeadings.length
							? readHeadingTitle(
									precedingHeadings[
										precedingHeadings.length - 1
									] as HTMLElement,
								)
							: "") ||
						strings[navItem.label];
					const description = row.dataset.settingDescription?.trim() ?? "";
					indexedItems.push({
						key: `${tabId}:setting:${rowIndex}`,
						kind: "setting",
						tabId,
						tabLabel: strings[navItem.label],
						groupTitle,
						label,
						description,
						searchText:
							`${row.dataset.settingSearch ?? ""} ${groupTitle}`.toLowerCase(),
						targetId,
					});
				});
			}

			const signature = JSON.stringify(indexedItems);
			if (signature === searchIndexSignatureRef.current) return;
			searchIndexSignatureRef.current = signature;
			setSearchItems(indexedItems);
		};

		const MutationObserverOwner =
			root.ownerDocument.defaultView?.MutationObserver;
		if (!MutationObserverOwner)
			throw new Error("settings-center-search-observer-missing");
		const observer = new MutationObserverOwner(rebuildSearchIndex);
		observer.observe(root, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: [
				"data-setting-search",
				"data-setting-label",
				"data-setting-description",
				"data-setting-group",
			],
		});
		rebuildSearchIndex();
		return () => observer.disconnect();
	}, [strings]);

	useEffect(
		() => () => {
			const windowRef = searchNavigationWindowRef.current;
			if (windowRef && searchNavigationFrameRef.current !== null) {
				windowRef.cancelAnimationFrame(searchNavigationFrameRef.current);
			}
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
	}, [saveStatus]);

	const navigationViewportTop = (container: HTMLDivElement) => {
		const stickyHeader = stickyHeaderRef.current;
		if (!stickyHeader)
			throw new Error("settings-center-navigation-header-missing");
		let viewportTop = Math.max(
			container.getBoundingClientRect().top,
			stickyHeader.getBoundingClientRect().bottom +
				SETTINGS_SECTION_ACTIVATION_OFFSET,
		);
		if (saveBarVisible) {
			const saveBar = saveBarRef.current;
			if (!saveBar)
				throw new Error("settings-center-navigation-save-bar-missing");
			viewportTop = Math.max(
				viewportTop,
				saveBar.getBoundingClientRect().bottom +
					SETTINGS_SECTION_ACTIVATION_OFFSET,
			);
		}
		return viewportTop;
	};

	const scrollTargetIntoView = (
		container: HTMLDivElement,
		target: HTMLElement,
		viewportOffset: number,
	) => {
		const targetTop =
			container.scrollTop +
			target.getBoundingClientRect().top -
			(navigationViewportTop(container) + viewportOffset);
		container.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
	};

	const handleSettingsScroll = () => {
		if (normalizedQuery) return;
		const container = scrollContainerRef.current;
		if (!container) throw new Error("settings-center-scroll-container-missing");
		const activationLine = navigationViewportTop(container);
		let visibleTab: NavId = "general";
		for (const item of NAV_ITEMS) {
			const section = sectionRefs.current[item.id];
			if (!section)
				throw new Error(`settings-center-section-${item.id}-missing`);
			if (section.getBoundingClientRect().top <= activationLine)
				visibleTab = item.id;
		}
		setActiveTab((currentTab) =>
			currentTab === visibleTab ? currentTab : visibleTab,
		);
	};

	const scheduleScrollToTarget = (
		tabId: NavId,
		targetId: string,
		{
			focusFirstControl = false,
			viewportOffset = -SETTINGS_SECTION_SCROLL_LEAD,
		}: {
			focusFirstControl?: boolean;
			viewportOffset?: number;
		} = {},
	) => {
		const windowRef = scrollContainerRef.current?.ownerDocument.defaultView;
		if (!windowRef)
			throw new Error("settings-center-navigation-window-missing");
		if (searchNavigationFrameRef.current !== null) {
			windowRef.cancelAnimationFrame(searchNavigationFrameRef.current);
		}
		searchNavigationWindowRef.current = windowRef;
		setActiveTab(tabId);
		searchNavigationFrameRef.current = windowRef.requestAnimationFrame(() => {
			searchNavigationFrameRef.current = windowRef.requestAnimationFrame(() => {
				searchNavigationFrameRef.current = null;
				const container = scrollContainerRef.current;
				const target = container?.querySelector<HTMLElement>(`#${targetId}`);
				if (!container || !target)
					throw new Error(
						`settings-center-navigation-target-${targetId}-missing`,
					);
				scrollTargetIntoView(container, target, viewportOffset);
				if (focusFirstControl) {
					const control = target.querySelector<HTMLElement>(
						SETTINGS_SEARCH_FOCUSABLE_CONTROL_SELECTOR,
					);
					const focusTarget = control ?? target;
					if (!control) target.tabIndex = -1;
					focusTarget.focus({ preventScroll: true });
					if (focusTarget.ownerDocument.activeElement !== focusTarget)
						throw new Error(
							`settings-center-navigation-focus-target-${targetId}-failed`,
						);
				}
			});
		});
	};

	const navigateToSection = (id: NavId) => {
		if (normalizedQuery) {
			setQuery("");
			scheduleScrollToTarget(id, `settings-section-${id}`);
			return;
		}
		setQuery("");
		const container = scrollContainerRef.current;
		const section = sectionRefs.current[id];
		if (!container || !section)
			throw new Error(`settings-center-section-${id}-unavailable`);
		scrollTargetIntoView(container, section, -SETTINGS_SECTION_SCROLL_LEAD);
		setActiveTab(id);
	};

	const openSearchResult = (item: SearchItem) => {
		setQuery("");
		scheduleScrollToTarget(item.tabId, item.targetId, {
			focusFirstControl: true,
			viewportOffset: SETTINGS_SEARCH_RESULT_SCROLL_TRAIL,
		});
	};
	const settingsPort = useMemo(
		() => createWordPressSettingsPort(bootstrap.api),
		[bootstrap.api],
	);
	const settingsDirty =
		resetSecretsRef.current ||
		JSON.stringify(settings) !== JSON.stringify(savedSettings);
	const saveBarVisible =
		settingsDirty ||
		"idle" !== saveStatus ||
		saveConflict ||
		transferMutationUnavailable;
	const updateSettingsSection = <Key extends keyof SettingsCenterSettings>(
		key: Key,
		value: SettingsCenterSettings[Key],
	) => {
		const previousSettings = settingsRef.current;
		const nextSettings: SettingsCenterSettings = {
			...previousSettings,
			[key]: value,
		};
		if ("images" === key && resetSecretsRef.current) {
			const secretKeys = [
				"accessKey",
				"secretKey",
				"backupAccessKey",
				"backupSecretKey",
			] as const;
			const changedSecret = secretKeys.some(
				(secretKey) =>
					nextSettings.images[secretKey] !==
						previousSettings.images[secretKey] &&
					"" !== nextSettings.images[secretKey].trim(),
			);
			if (changedSecret) resetSecretsRef.current = false;
		}
		settingsRef.current = nextSettings;
		setSettings(nextSettings);
		setSaveError(null);
		setSaveStatus((status) => ("saving" === status ? status : "idle"));
	};
	const replaceSettingsDraft = (nextSettings: SettingsCenterSettings) => {
		resetSecretsRef.current = false;
		setSaveConflict(false);
		setSaveError(null);
		setTransferMutationUnavailable(true);
		settingsRef.current = nextSettings;
		setSettings(nextSettings);
		setSaveStatus("idle");
	};
	const resetSettingsDraft = (nextSettings: SettingsCenterSettings) => {
		resetSecretsRef.current = true;
		setSaveConflict(false);
		setSaveError(null);
		setTransferMutationUnavailable(true);
		settingsRef.current = nextSettings;
		setSettings(nextSettings);
		setSaveStatus("idle");
	};
	const saveSettings = async () => {
		if (
			!settingsDirty ||
			"saving" === saveStatus ||
			saveConflict ||
			transferMutationUnavailable
		)
			return;
		saveControllerRef.current?.abort();
		const controller = new AbortController();
		const requestedSettings = settings;
		const resetSecrets = resetSecretsRef.current;
		saveControllerRef.current = controller;
		setSaveStatus("saving");
		try {
			const saved = await settingsPort.save(
				requestedSettings,
				controller.signal,
				{ resetSecrets },
			);
			if (controller.signal.aborted) return;
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
			setSaveError(null);
			setTransferMutationUnavailable(false);
			setSaveStatus(currentSettingsUnchanged ? "saved" : "idle");
		} catch (error) {
			if (!controller.signal.aborted) {
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
				setSaveError(nextError);
				setSaveStatus("error");
			}
		} finally {
			if (saveControllerRef.current === controller)
				saveControllerRef.current = null;
		}
	};
	const reloadLatestSettings = async () => {
		if ("saving" === saveStatus) return;
		saveControllerRef.current?.abort();
		const controller = new AbortController();
		saveControllerRef.current = controller;
		setSaveStatus("saving");
		try {
			const latest = await settingsPort.get(controller.signal);
			if (controller.signal.aborted) return;
			setSavedSettings(latest);
			settingsRef.current = latest;
			setSettings(latest);
			resetSecretsRef.current = false;
			setSaveConflict(false);
			setSaveError(null);
			setTransferMutationUnavailable(false);
			setSaveStatus("idle");
		} catch (error) {
			if (!controller.signal.aborted) {
				const code =
					error instanceof Error
						? error.message
						: "settings-center-get-rejected";
				setSaveError(
					code.endsWith("-network-failed")
						? "network"
						: code.endsWith("-response-invalid")
							? "invalid"
							: "rejected",
				);
				setSaveStatus("error");
			}
		} finally {
			if (saveControllerRef.current === controller)
				saveControllerRef.current = null;
		}
	};

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
					<nav aria-label={strings.settingsNavigation}>
						{NAV_ITEMS.map(({ id, icon: NavIcon, label }) => (
							<button
								key={id}
								type="button"
								data-nav-id={id}
								aria-current={
									normalizedQuery
										? searchSections.length === 1 &&
											searchSections[0]?.tabId === id
											? "page"
											: undefined
										: activeTab === id
											? "page"
											: undefined
								}
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
									onChange={(event) => setQuery(event.target.value)}
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
							{"error" === saveStatus
								? "conflict" === saveError
									? strings.settingsConflict
									: "network" === saveError
										? strings.settingsSaveNetworkFailed
										: "invalid" === saveError
											? strings.settingsSaveInvalid
											: strings.settingsSaveRejected
								: "saved" === saveStatus
									? strings.settingsSaved
									: transferMutationUnavailable
										? strings.settingsUnavailable
										: settingsDirty
											? strings.settingsUnsavedChanges
											: ""}
						</span>
						<button
							type="button"
							aria-busy={"saving" === saveStatus}
							disabled={
								"saving" === saveStatus ||
								transferMutationUnavailable ||
								(!settingsDirty && !saveConflict)
							}
							title={
								transferMutationUnavailable
									? strings.settingsUnavailableDescription
									: undefined
							}
							onClick={() => {
								if (saveConflict) {
									void reloadLatestSettings();
								} else {
									void saveSettings();
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
								<div
									className="easymde-settings-center__search-results"
									aria-live="polite"
								>
									{searchResultCount === 0 ? (
										<div className="easymde-settings-center__no-results-body">
											<div aria-hidden="true">
												<img
													src={bootstrap.assets.searchEmptyIllustrationUrl}
													alt=""
												/>
											</div>
											<h2>
												{formatSinglePlaceholder(
													strings.noSearchResults,
													query.trim(),
												)}
											</h2>
											<p>{strings.noSearchResultsDescription}</p>
										</div>
									) : (
										<div>
											<div className="easymde-settings-center__search-results-summary">
												<span>{strings.searchResults}</span>
												<span>
													{formatSinglePlaceholder(
														strings.searchResultCount,
														String(searchResultCount),
													)}
												</span>
											</div>
											<div className="easymde-settings-center__search-results-sections">
												{searchSections.map((section) => {
													const navItem = NAV_ITEMS.find(
														(item) => item.id === section.tabId,
													);
													if (!navItem)
														throw new Error(
															`settings-center-search-nav-${section.tabId}-missing`,
														);
													const SectionIcon = navItem.icon;
													return (
														<section key={section.tabId}>
															<h2>
																<SectionIcon size={24} />
																{section.tabLabel}
															</h2>
															<div className="easymde-settings-center__search-result-groups">
																{section.groups.map((group) => (
																	<div key={group.title}>
																		<h3>{group.title}</h3>
																		<div>
																			{group.items.map((item) => (
																				<button
																					key={item.key}
																					type="button"
																					onClick={() => openSearchResult(item)}
																				>
																					<span>
																						<strong>{item.label}</strong>
																						{item.description ? (
																							<small>{item.description}</small>
																						) : null}
																					</span>
																					<ChevronRight size={17} />
																				</button>
																			))}
																		</div>
																	</div>
																))}
															</div>
														</section>
													);
												})}
											</div>
										</div>
									)}
								</div>
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
									<GeneralSettingsPage
										embedded
										query=""
										searchEmptyIllustrationUrl={
											bootstrap.assets.searchEmptyIllustrationUrl
										}
										settings={settings.general}
										onChange={(value) =>
											updateSettingsSection("general", value)
										}
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
									<ShortcutsSettingsPage
										defaultValues={bootstrap.defaultSettings.shortcuts.values}
										settings={settings.shortcuts}
										onChange={(value) =>
											updateSettingsSection("shortcuts", value)
										}
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
									<ImagesSettingsPage
										draft={bootstrap.drafts.images}
										settings={settings.images}
										onChange={(value) => updateSettingsSection("images", value)}
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
									<MarkdownSettingsPage
										settings={settings.markdown}
										onChange={(value) =>
											updateSettingsSection("markdown", value)
										}
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
									<TransferSettingsPage
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
									<AboutSettingsPage
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
			<div ref={setOverlayRoot} data-settings-overlay-root="" />
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
		</div>
	);
}
