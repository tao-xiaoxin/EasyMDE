import { useEffect, useRef, useState } from "@wordpress/element";
import {
	NAV_ITEMS,
	type NavId,
	type SearchItem,
	type SearchSection,
} from "./settings-center-search";

const SETTINGS_SECTION_ACTIVATION_OFFSET = 15;
const SETTINGS_SECTION_ACTIVATION_HYSTERESIS = 18;
const SETTINGS_SECTION_SCROLL_LEAD = 6;
const SETTINGS_SEARCH_RESULT_SCROLL_TRAIL = 18;
const SETTINGS_SEARCH_FOCUSABLE_CONTROL_SELECTOR = [
	'input:not([type="hidden"]):not(:disabled):not([aria-disabled="true"])',
	'select:not(:disabled):not([aria-disabled="true"])',
	'textarea:not(:disabled):not([aria-disabled="true"])',
	'button:not(:disabled):not([aria-disabled="true"])',
	'a[href]:not([aria-disabled="true"])',
].join(", ");

export function useSettingsCenterNavigation({
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
}: {
	navigationRef: { readonly current: HTMLElement | null };
	normalizedQuery: string;
	normalizedQueryRef: { readonly current: string };
	saveBarRef: { readonly current: HTMLDivElement | null };
	saveBarVisible: boolean;
	scrollContainerRef: { readonly current: HTMLDivElement | null };
	searchSections: ReadonlyArray<SearchSection>;
	sectionRefs: { readonly current: Partial<Record<NavId, HTMLElement | null>> };
	setQuery: (value: string) => void;
	stickyHeaderRef: { readonly current: HTMLDivElement | null };
}) {
	const [activeTab, setActiveTab] = useState<NavId>("general");
	const searchNavigationFrameRef = useRef<number | null>(null);
	const searchNavigationWindowRef = useRef<Window | null>(null);
	const scrollSpyFrameRef = useRef<number | null>(null);
	const scrollSpyWindowRef = useRef<Window | null>(null);

	const current = NAV_ITEMS.find((item) => item.id === activeTab);
	if (!current) throw new Error("settings-center-active-tab-invalid");

	const highlightedNavId =
		normalizedQuery && searchSections.length === 1
			? searchSections[0]?.tabId
			: activeTab;

	useEffect(() => {
		const navigation = navigationRef.current;
		if (!navigation)
			throw new Error("settings-center-navigation-element-missing");
		if (
			navigation.scrollWidth <= navigation.clientWidth &&
			navigation.scrollHeight <= navigation.clientHeight
		)
			return;
		const activeItem = navigation.querySelector<HTMLElement>(
			`[data-nav-id="${highlightedNavId}"]`,
		);
		if (!activeItem)
			throw new Error("settings-center-active-navigation-item-missing");
		const navigationRect = navigation.getBoundingClientRect();
		const activeItemRect = activeItem.getBoundingClientRect();
		const horizontalScale =
			navigation.clientWidth > 0 && navigationRect.width > 0
				? navigationRect.width / navigation.clientWidth
				: 1;
		const verticalScale =
			navigation.clientHeight > 0 && navigationRect.height > 0
				? navigationRect.height / navigation.clientHeight
				: 1;
		const leftDelta =
			activeItemRect.left < navigationRect.left
				? activeItemRect.left - navigationRect.left
				: activeItemRect.right > navigationRect.right
					? activeItemRect.right - navigationRect.right
					: 0;
		const topDelta =
			activeItemRect.top < navigationRect.top
				? activeItemRect.top - navigationRect.top
				: activeItemRect.bottom > navigationRect.bottom
					? activeItemRect.bottom - navigationRect.bottom
					: 0;
		navigation.scrollTo({
			left: navigation.scrollLeft + leftDelta / horizontalScale,
			top: navigation.scrollTop + topDelta / verticalScale,
			behavior: "auto",
		});
	}, [highlightedNavId, navigationRef]);

	useEffect(
		() => () => {
			const windowRef = searchNavigationWindowRef.current;
			if (windowRef && searchNavigationFrameRef.current !== null) {
				windowRef.cancelAnimationFrame(searchNavigationFrameRef.current);
			}
			const scrollWindowRef = scrollSpyWindowRef.current;
			if (scrollWindowRef && scrollSpyFrameRef.current !== null) {
				scrollWindowRef.cancelAnimationFrame(scrollSpyFrameRef.current);
			}
		},
		[],
	);

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

	const updateActiveTabFromScroll = () => {
		if (normalizedQueryRef.current) return;
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
		setActiveTab((currentTab) => {
			if (currentTab === visibleTab) return currentTab;
			const currentIndex = NAV_ITEMS.findIndex(
				(item) => item.id === currentTab,
			);
			const visibleIndex = NAV_ITEMS.findIndex(
				(item) => item.id === visibleTab,
			);
			if (Math.abs(currentIndex - visibleIndex) !== 1) return visibleTab;
			const laterSection =
				sectionRefs.current[
					NAV_ITEMS[Math.max(currentIndex, visibleIndex)]?.id ?? visibleTab
				];
			if (!laterSection)
				throw new Error("settings-center-scrollspy-boundary-section-missing");
			return Math.abs(
				laterSection.getBoundingClientRect().top - activationLine,
			) <= SETTINGS_SECTION_ACTIVATION_HYSTERESIS
				? currentTab
				: visibleTab;
		});
	};

	const handleSettingsScroll = () => {
		if (normalizedQueryRef.current || scrollSpyFrameRef.current !== null)
			return;
		const windowRef = scrollContainerRef.current?.ownerDocument.defaultView;
		if (!windowRef) throw new Error("settings-center-scrollspy-window-missing");
		scrollSpyWindowRef.current = windowRef;
		scrollSpyFrameRef.current = windowRef.requestAnimationFrame(() => {
			scrollSpyFrameRef.current = null;
			updateActiveTabFromScroll();
		});
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

	return {
		current,
		handleSettingsScroll,
		highlightedNavId,
		navigateToSection,
		openSearchResult,
	};
}
