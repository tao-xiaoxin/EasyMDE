import { createElement, useEffect, useMemo, useRef, useState } from '@wordpress/element';

import { ChevronRight, X } from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap, SettingsCenterStringKey } from '../../contracts/bootstrap/settings-center-bootstrap';
import { AboutSettingsPage } from './AboutSettingsPage';
import { AiSettingsPage } from './AiSettingsPage';
import { GeneralSettingsPage } from './GeneralSettingsPage';
import { ImagesSettingsPage } from './ImagesSettingsPage';
import { MarkdownSettingsPage } from './MarkdownSettingsPage';
import { ShortcutsSettingsPage } from './ShortcutsSettingsPage';
import { SyncSettingsPage } from './SyncSettingsPage';
import { TransferSettingsPage } from './TransferSettingsPage';
import { AboutIcon, AiSparkIcon, ArticleSyncIcon, GeneralIcon, ImageLibraryIcon, ImportExportIcon, KeyboardIcon, MarkdownIcon, SearchIcon } from './settings-center-icons';

type NavId = 'general' | 'shortcuts' | 'images' | 'ai' | 'markdown' | 'sync' | 'transfer' | 'about';
type Icon = typeof GeneralIcon;
type SearchItem = Readonly<{
  key: string;
  kind: 'group' | 'setting';
  tabId: NavId;
  tabLabel: string;
  groupTitle: string;
  label: string;
  description: string;
  searchText: string;
  targetId: string;
}>;
type SearchGroup = Readonly<{ title: string; items: ReadonlyArray<SearchItem> }>;
type SearchSection = Readonly<{
  tabId: NavId;
  tabLabel: string;
  groups: ReadonlyArray<SearchGroup>;
}>;
const NAV_ITEMS: ReadonlyArray<Readonly<{
  id: NavId;
  label: SettingsCenterStringKey;
  title?: SettingsCenterStringKey;
  description: SettingsCenterStringKey;
  icon: Icon;
}>> = [
  { id: 'general', label: 'general', description: 'generalDescription', icon: GeneralIcon },
  { id: 'shortcuts', label: 'shortcuts', description: 'shortcutsDescription', icon: KeyboardIcon },
  { id: 'images', label: 'images', description: 'imagesDescription', icon: ImageLibraryIcon },
  { id: 'ai', label: 'ai', description: 'aiDescription', icon: AiSparkIcon },
  { id: 'markdown', label: 'markdown', description: 'markdownDescription', icon: MarkdownIcon },
  { id: 'sync', label: 'sync', description: 'syncDescription', icon: ArticleSyncIcon },
  { id: 'transfer', label: 'transfer', title: 'transferPageTitle', description: 'transferDescription', icon: ImportExportIcon },
  { id: 'about', label: 'about', description: 'aboutDescription', icon: AboutIcon }
];

function formatSinglePlaceholderParts(template: string, value: string): ReadonlyArray<string> {
  return template
    .split(/(%s)/g)
    .filter((part) => part !== '')
    .map((part) => part === '%s' ? value : part);
}

export function SettingsCenterRoot({ bootstrap }: { bootstrap: SettingsCenterBootstrap }) {
  const [activeTab, setActiveTab] = useState<NavId>('general');
  const [query, setQuery] = useState('');
  const [searchItems, setSearchItems] = useState<ReadonlyArray<SearchItem>>([]);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<NavId, HTMLElement | null>>>({});
  const searchIndexSignatureRef = useRef('');
  const searchNavigationFrameRef = useRef<number | null>(null);
  const searchNavigationWindowRef = useRef<Window | null>(null);
  const strings = bootstrap.strings;
  const brandSuffixLength = 3;
  const brandPrefix = strings.brandName.slice(0, -brandSuffixLength);
  const brandSuffix = strings.brandName.slice(-brandSuffixLength);
  const current = NAV_ITEMS.find((item) => item.id === activeTab);
  if (!current) throw new Error('settings-center-active-tab-invalid');
  const normalizedQuery = query.trim().toLowerCase();
  const searchSections = useMemo<ReadonlyArray<SearchSection>>(() => {
    if (!normalizedQuery) return [];

    return NAV_ITEMS.flatMap((navItem) => {
      const groupMap = new Map<string, SearchItem[]>();
      for (const item of searchItems.filter((candidate) => candidate.tabId === navItem.id)) {
        const items = groupMap.get(item.groupTitle) ?? [];
        items.push(item);
        groupMap.set(item.groupTitle, items);
      }
      const groups = Array.from(groupMap, ([title, items]) => {
        const groupMatches = title.toLowerCase().includes(normalizedQuery);
        const matches = items.filter((item) => groupMatches || item.searchText.includes(normalizedQuery));
        const hasSetting = matches.some((item) => item.kind === 'setting');
        return {
          title,
          items: hasSetting ? matches.filter((item) => item.kind === 'setting') : matches
        };
      }).filter((group) => group.items.length > 0);

      return groups.length > 0
        ? [{ tabId: navItem.id, tabLabel: strings[navItem.label], groups }]
        : [];
    });
  }, [normalizedQuery, searchItems, strings]);
  const searchResultCount = searchSections.reduce(
    (total, section) => total + section.groups.reduce(
      (groupTotal, group) => groupTotal + group.items.length,
      0
    ),
    0
  );
  const pageTitle = normalizedQuery ? strings.searchPageTitle : strings[current.title ?? current.label];
  const pageDescription = normalizedQuery
    ? strings.searchPageDescription.replace('%s', () => query.trim())
    : strings[current.description];

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) throw new Error('settings-center-search-root-missing');
    const rebuildSearchIndex = () => {
      const indexedItems: SearchItem[] = [];
      const readHeadingTitle = (heading: HTMLElement) => (
        heading.dataset.settingsSearchTitle?.trim()
        || heading.textContent?.replace(/\s+/g, ' ').trim()
        || ''
      );

      for (const section of root.querySelectorAll<HTMLElement>('[data-settings-section]')) {
        const tabId = section.dataset.settingsSection as NavId | undefined;
        const navItem = NAV_ITEMS.find((item) => item.id === tabId);
        if (!tabId || !navItem) {
          throw new Error(`settings-center-search-section-${tabId ?? 'missing'}-invalid`);
        }
        const headings = Array.from(section.querySelectorAll<HTMLElement>('h2, h3'));
        headings.forEach((heading, headingIndex) => {
          const label = readHeadingTitle(heading);
          if (!label) throw new Error(`settings-center-search-heading-${tabId}-${headingIndex}-empty`);
          const targetId = heading.id || `settings-search-${tabId}-heading-${headingIndex}`;
          heading.id = targetId;
          const nextElement = heading.nextElementSibling;
          const description = nextElement?.tagName === 'P'
            ? nextElement.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            : '';
          indexedItems.push({
            key: `${tabId}:group:${headingIndex}`,
            kind: 'group',
            tabId,
            tabLabel: strings[navItem.label],
            groupTitle: label,
            label,
            description,
            searchText: `${label} ${description}`.toLowerCase(),
            targetId
          });
        });

        Array.from(section.querySelectorAll<HTMLElement>('[data-setting-search]'))
          .forEach((row, rowIndex) => {
            const label = row.dataset.settingLabel?.trim();
            if (!label) throw new Error(`settings-center-search-setting-${tabId}-${rowIndex}-label-missing`);
            const targetId = row.id || `settings-search-${tabId}-setting-${rowIndex}`;
            row.id = targetId;
            const groupContainer = row.closest<HTMLElement>('section') ?? section;
            const precedingHeadings = Array.from(
              groupContainer.querySelectorAll<HTMLElement>('h2, h3')
            ).filter((heading) => Boolean(
              heading.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
            ));
            const groupTitle = row.dataset.settingGroup?.trim()
              || (precedingHeadings.length
                ? readHeadingTitle(precedingHeadings[precedingHeadings.length - 1] as HTMLElement)
                : '')
              || strings[navItem.label];
            const description = row.dataset.settingDescription?.trim() ?? '';
            indexedItems.push({
              key: `${tabId}:setting:${rowIndex}`,
              kind: 'setting',
              tabId,
              tabLabel: strings[navItem.label],
              groupTitle,
              label,
              description,
              searchText: `${row.dataset.settingSearch ?? ''} ${groupTitle}`.toLowerCase(),
              targetId
            });
          });
      }

      const signature = JSON.stringify(indexedItems);
      if (signature === searchIndexSignatureRef.current) return;
      searchIndexSignatureRef.current = signature;
      setSearchItems(indexedItems);
    };

    const MutationObserverOwner = root.ownerDocument.defaultView?.MutationObserver;
    if (!MutationObserverOwner) throw new Error('settings-center-search-observer-missing');
    const observer = new MutationObserverOwner(rebuildSearchIndex);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-setting-search',
        'data-setting-label',
        'data-setting-description',
        'data-setting-group'
      ]
    });
    rebuildSearchIndex();
    return () => observer.disconnect();
  }, [strings]);

  useEffect(() => () => {
    const windowRef = searchNavigationWindowRef.current;
    if (windowRef && searchNavigationFrameRef.current !== null) {
      windowRef.cancelAnimationFrame(searchNavigationFrameRef.current);
    }
  }, []);

  const handleSettingsScroll = () => {
    if (normalizedQuery) return;
    const container = scrollContainerRef.current;
    if (!container) throw new Error('settings-center-scroll-container-missing');
    const activationLine = 252;
    let visibleTab: NavId = 'general';
    for (const item of NAV_ITEMS) {
      const section = sectionRefs.current[item.id];
      if (!section) throw new Error(`settings-center-section-${item.id}-missing`);
      if (section.getBoundingClientRect().top <= activationLine) visibleTab = item.id;
    }
    setActiveTab((currentTab) => currentTab === visibleTab ? currentTab : visibleTab);
  };

  const scheduleScrollToTarget = (tabId: NavId, targetId: string) => {
    const windowRef = scrollContainerRef.current?.ownerDocument.defaultView;
    if (!windowRef) throw new Error('settings-center-navigation-window-missing');
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
        if (!container || !target) throw new Error(`settings-center-navigation-target-${targetId}-missing`);
        const targetTop = container.scrollTop + target.getBoundingClientRect().top - 246;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
      });
    });
  };

  const navigateToSection = (id: NavId) => {
    if (normalizedQuery) {
      setQuery('');
      scheduleScrollToTarget(id, `settings-section-${id}`);
      return;
    }
    setQuery('');
    const container = scrollContainerRef.current;
    const section = sectionRefs.current[id];
    if (!container || !section) throw new Error(`settings-center-section-${id}-unavailable`);
    const targetTop = container.scrollTop + section.getBoundingClientRect().top - 246;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    setActiveTab(id);
  };

  const openSearchResult = (item: SearchItem) => {
    setQuery('');
    scheduleScrollToTarget(item.tabId, item.targetId);
  };

  return <div ref={scrollContainerRef} onScroll={handleSettingsScroll}
    className="easymde-settings-center">
    <div className="easymde-settings-center__frame">
      <aside className="easymde-settings-center__sidebar">
        <div className="easymde-settings-center__brand-wrap">
          <div className="easymde-settings-center__brand">
            <img src={bootstrap.assets.brandMarkUrl} alt={strings.brandName} />
            <div><strong>{brandPrefix}<b>{brandSuffix}</b></strong><span>{strings.settingsCenter}</span></div>
          </div>
        </div>
        <nav aria-label={strings.settingsNavigation}>
          {NAV_ITEMS.map(({ id, icon: NavIcon, label }) => <button key={id} type="button"
            data-nav-id={id} aria-current={normalizedQuery
              ? searchSections.length === 1 && searchSections[0]?.tabId === id ? 'page' : undefined
              : activeTab === id ? 'page' : undefined}
            onClick={() => navigateToSection(id)}>
            <NavIcon size={25} /><span>{strings[label]}</span><i aria-hidden="true" />
          </button>)}
        </nav>
        <section className="easymde-settings-center__help">
          <div><span><img src={bootstrap.assets.brandMarkUrl} alt="" /></span><div><h2>{strings.helpTitle}</h2><p>{strings.helpDescription}</p></div></div>
          <button type="button" onClick={() => navigateToSection('about')}>
            {strings.openDocumentation}<ChevronRight size={12} />
          </button>
        </section>
      </aside>
      <main>
        <div className="easymde-settings-center__sticky-header">
          <div className="easymde-settings-center__header-scale">
            <header>
              <img src={bootstrap.assets.headerIllustrationUrl} alt="" />
              <a href={bootstrap.closeUrl} aria-label={strings.closeSettingsCenter}><X size={23} strokeWidth={1.8} /></a>
              <div><h1>{pageTitle}</h1><p>{pageDescription}</p></div>
            </header>
            <div className="easymde-settings-center__search">
              <SearchIcon size={20} /><input type="search" value={query} aria-label={strings.searchSettings}
                placeholder={strings.searchSettingsPlaceholder} onChange={(event) => setQuery(event.target.value)} />
              {query ? <button type="button" aria-label={strings.clearSearch} onClick={() => setQuery('')}><X size={17} /></button> : null}
            </div>
          </div>
        </div>
        <div className="easymde-settings-center__content-scale">
          <div className="easymde-settings-center__content">
            {normalizedQuery ? <div className="easymde-settings-center__search-results" aria-live="polite">
              {searchResultCount === 0
                ? <div className="easymde-settings-center__no-results-body">
                  <div aria-hidden="true"><img src={bootstrap.assets.searchEmptyIllustrationUrl} alt="" /></div>
                  <h2>{strings.noSearchResults.replace('%s', () => query.trim())}</h2>
                  <p>{strings.noSearchResultsDescription}</p>
                </div>
                : <div>
                  <div className="easymde-settings-center__search-results-summary">
                    <span>{strings.searchResults}</span>
                    <span>{formatSinglePlaceholderParts(
                      strings.searchResultCount,
                      String(searchResultCount)
                    )}</span>
                  </div>
                  <div className="easymde-settings-center__search-results-sections">
                    {searchSections.map((section) => {
                      const navItem = NAV_ITEMS.find((item) => item.id === section.tabId);
                      if (!navItem) throw new Error(`settings-center-search-nav-${section.tabId}-missing`);
                      const SectionIcon = navItem.icon;
                      return <section key={section.tabId}>
                        <h2><SectionIcon size={24} />{section.tabLabel}</h2>
                        <div className="easymde-settings-center__search-result-groups">
                          {section.groups.map((group) => <div key={group.title}>
                            <h3>{group.title}</h3>
                            <div>{group.items.map((item) => <button key={item.key} type="button"
                              onClick={() => openSearchResult(item)}>
                              <span><strong>{item.label}</strong>
                                {item.description ? <small>{item.description}</small> : null}</span>
                              <ChevronRight size={17} />
                            </button>)}</div>
                          </div>)}
                        </div>
                      </section>;
                    })}
                  </div>
                </div>}
            </div> : null}
            <div className={`easymde-settings-center__sections${normalizedQuery ? ' is-search-hidden' : ''}`}>
              <section id="settings-section-general" data-settings-section="general"
                ref={(element) => { sectionRefs.current.general = element; }}
                className="easymde-settings-center__settings-section">
                <GeneralSettingsPage embedded query="" searchEmptyIllustrationUrl={bootstrap.assets.searchEmptyIllustrationUrl} strings={strings} />
              </section>
              <section id="settings-section-shortcuts" data-settings-section="shortcuts"
                ref={(element) => { sectionRefs.current.shortcuts = element; }}
                className="easymde-settings-center__settings-section">
                <ShortcutsSettingsPage strings={strings} />
              </section>
              <section id="settings-section-images" data-settings-section="images"
                ref={(element) => { sectionRefs.current.images = element; }}
                className="easymde-settings-center__settings-section">
                <ImagesSettingsPage draft={bootstrap.drafts.images} strings={strings} />
              </section>
              <section id="settings-section-ai" data-settings-section="ai"
                ref={(element) => { sectionRefs.current.ai = element; }}
                className="easymde-settings-center__settings-section">
                <AiSettingsPage draft={bootstrap.drafts.ai} overlayRoot={overlayRoot} strings={strings} />
              </section>
              <section id="settings-section-markdown" data-settings-section="markdown"
                ref={(element) => { sectionRefs.current.markdown = element; }}
                className="easymde-settings-center__settings-section">
                <MarkdownSettingsPage strings={strings} />
              </section>
              <section id="settings-section-sync" data-settings-section="sync"
                ref={(element) => { sectionRefs.current.sync = element; }}
                className="easymde-settings-center__settings-section">
                <SyncSettingsPage overlayRoot={overlayRoot} strings={strings} />
              </section>
              <section id="settings-section-transfer" data-settings-section="transfer"
                ref={(element) => { sectionRefs.current.transfer = element; }}
                className="easymde-settings-center__settings-section">
                <TransferSettingsPage overlayRoot={overlayRoot} bootstrap={bootstrap} />
              </section>
              <section id="settings-section-about" data-settings-section="about"
                ref={(element) => { sectionRefs.current.about = element; }}
                className="easymde-settings-center__settings-section">
                <AboutSettingsPage overlayRoot={overlayRoot} strings={strings} />
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
    <div ref={setOverlayRoot} data-settings-overlay-root="" />
  </div>;
}
