import {
	createElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "@wordpress/element";
import type {
	SettingsCenterBootstrap,
	SettingsCenterStringKey,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import { ChevronRight } from "../../generated/lucide-icons";
import {
	AboutIcon,
	GeneralIcon,
	ImageLibraryIcon,
	ImportExportIcon,
	KeyboardIcon,
	MarkdownIcon,
} from "./settings-center-icons";
import { formatSinglePlaceholder } from "./settings-center-utils";

export type NavId =
	| "general"
	| "shortcuts"
	| "images"
	| "markdown"
	| "transfer"
	| "about";

type Icon = typeof GeneralIcon;

export type SearchItem = Readonly<{
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

export type SearchGroup = Readonly<{
	title: string;
	items: ReadonlyArray<SearchItem>;
}>;

export type SearchSection = Readonly<{
	tabId: NavId;
	tabLabel: string;
	groups: ReadonlyArray<SearchGroup>;
}>;

export const NAV_ITEMS: ReadonlyArray<
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

function mutationAffectsSettingsSearch(mutation: MutationRecord): boolean {
	const element =
		mutation.target instanceof Element
			? mutation.target
			: mutation.target.parentElement;
	if (element?.closest("[data-settings-section]")) return true;
	if ("childList" !== mutation.type) return false;
	return [...mutation.addedNodes, ...mutation.removedNodes].some(
		(node) =>
			node instanceof Element &&
			(node.matches("[data-settings-section]") ||
				Boolean(node.querySelector("[data-settings-section]"))),
	);
}

export function useSettingsCenterSearch({
	scrollContainerRef,
	strings,
}: {
	scrollContainerRef: { readonly current: HTMLDivElement | null };
	strings: SettingsCenterBootstrap["strings"];
}) {
	const [query, setQuery] = useState("");
	const [searchItems, setSearchItems] = useState<ReadonlyArray<SearchItem>>([]);
	const searchIndexSignatureRef = useRef("");
	const searchIndexDirtyRef = useRef(true);
	const normalizedQueryRef = useRef("");

	const normalizedQuery = query.trim().toLowerCase();
	normalizedQueryRef.current = normalizedQuery;

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

	const rebuildSearchIndex = useCallback(() => {
		const root = scrollContainerRef.current;
		if (!root) throw new Error("settings-center-search-root-missing");
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
			if (tabId === "about") continue;
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
								precedingHeadings[precedingHeadings.length - 1] as HTMLElement,
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

		searchIndexDirtyRef.current = false;
		const signature = JSON.stringify(indexedItems);
		if (signature === searchIndexSignatureRef.current) return;
		searchIndexSignatureRef.current = signature;
		setSearchItems(indexedItems);
	}, [scrollContainerRef, strings]);

	const ensureSearchIndex = useCallback(() => {
		if (!searchIndexDirtyRef.current) return;
		rebuildSearchIndex();
	}, [rebuildSearchIndex]);

	useEffect(() => {
		const root = scrollContainerRef.current;
		if (!root) throw new Error("settings-center-search-root-missing");

		const MutationObserverOwner =
			root.ownerDocument.defaultView?.MutationObserver;
		if (!MutationObserverOwner)
			throw new Error("settings-center-search-observer-missing");
		const observer = new MutationObserverOwner((mutations) => {
			if (!mutations.some(mutationAffectsSettingsSearch)) return;
			searchIndexDirtyRef.current = true;
			if (normalizedQueryRef.current) rebuildSearchIndex();
		});
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
		return () => observer.disconnect();
	}, [rebuildSearchIndex, scrollContainerRef]);

	return {
		ensureSearchIndex,
		normalizedQuery,
		normalizedQueryRef,
		query,
		searchResultCount,
		searchSections,
		setQuery,
	};
}

export function SettingsSearchResults({
	onOpenResult,
	query,
	searchEmptyIllustrationUrl,
	searchResultCount,
	searchSections,
	strings,
}: {
	onOpenResult: (item: SearchItem) => void;
	query: string;
	searchEmptyIllustrationUrl: string;
	searchResultCount: number;
	searchSections: ReadonlyArray<SearchSection>;
	strings: SettingsCenterBootstrap["strings"];
}) {
	return (
		<div
			className="easymde-settings-center__search-results"
			aria-live="polite"
		>
			{searchResultCount === 0 ? (
				<div className="easymde-settings-center__no-results-body">
					<div aria-hidden="true">
						<img src={searchEmptyIllustrationUrl} alt="" />
					</div>
					<h2>
						{formatSinglePlaceholder(strings.noSearchResults, query.trim())}
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
															onClick={() => onOpenResult(item)}
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
	);
}
