import { createElement, useRef, useState } from '@wordpress/element';

import { ChevronRight, X } from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap, SettingsCenterStringKey } from '../../contracts/bootstrap/settings-center-bootstrap';
import { GeneralSettingsPage, matchesGeneralSettingsQuery } from './GeneralSettingsPage';
import { ImagesSettingsPage } from './ImagesSettingsPage';
import { ShortcutsSettingsPage } from './ShortcutsSettingsPage';
import { AboutIcon, AiSparkIcon, ArticleSyncIcon, GeneralIcon, ImageLibraryIcon, ImportExportIcon, KeyboardIcon, MarkdownIcon, SearchIcon } from './settings-center-icons';

type NavId = 'general' | 'shortcuts' | 'images' | 'ai' | 'markdown' | 'sync' | 'transfer' | 'about';
type Icon = typeof GeneralIcon;
const NAV_ITEMS: ReadonlyArray<Readonly<{ id: NavId; label: SettingsCenterStringKey; description: SettingsCenterStringKey; icon: Icon }>> = [
  { id: 'general', label: 'general', description: 'generalDescription', icon: GeneralIcon },
  { id: 'shortcuts', label: 'shortcuts', description: 'shortcutsDescription', icon: KeyboardIcon },
  { id: 'images', label: 'images', description: 'imagesDescription', icon: ImageLibraryIcon },
  { id: 'ai', label: 'ai', description: 'aiDescription', icon: AiSparkIcon },
  { id: 'markdown', label: 'markdown', description: 'markdownDescription', icon: MarkdownIcon },
  { id: 'sync', label: 'sync', description: 'syncDescription', icon: ArticleSyncIcon },
  { id: 'transfer', label: 'transfer', description: 'transferDescription', icon: ImportExportIcon },
  { id: 'about', label: 'about', description: 'aboutDescription', icon: AboutIcon }
];

export function SettingsCenterRoot({ bootstrap }: { bootstrap: SettingsCenterBootstrap }) {
  const [activeTab, setActiveTab] = useState<NavId>('general');
  const [query, setQuery] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<NavId, HTMLElement | null>>>({});
  const strings = bootstrap.strings;
  const brandSuffixLength = 3;
  const brandPrefix = strings.brandName.slice(0, -brandSuffixLength);
  const brandSuffix = strings.brandName.slice(-brandSuffixLength);
  const current = NAV_ITEMS.find((item) => item.id === activeTab);
  if (!current) throw new Error('settings-center-active-tab-invalid');
  const normalizedQuery = query.trim();
  const generalMatchesQuery = matchesGeneralSettingsQuery(normalizedQuery, strings);
  const pageTitle = normalizedQuery ? strings.searchPageTitle : strings[current.label];
  const pageDescription = normalizedQuery
    ? strings.searchPageDescription.replace('%s', () => normalizedQuery)
    : strings[current.description];

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

  const navigateToSection = (id: NavId) => {
    if (normalizedQuery) {
      setQuery('');
      setActiveTab(id);
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

  return <div ref={scrollContainerRef} onScroll={handleSettingsScroll} className="easymde-settings-center">
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
            data-nav-id={id} aria-current={activeTab === id && (!normalizedQuery || generalMatchesQuery) ? 'page' : undefined}
            onClick={() => navigateToSection(id)}>
            <NavIcon size={25} /><span>{strings[label]}</span><i aria-hidden="true" />
          </button>)}
        </nav>
        <section className="easymde-settings-center__help">
          <div><span><img src={bootstrap.assets.brandMarkUrl} alt="" /></span><div><h2>{strings.helpTitle}</h2><p>{strings.helpDescription}</p></div></div>
          <button type="button" onClick={() => setActiveTab('about')}>{strings.openDocumentation}<ChevronRight size={12} /></button>
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
        <div className="easymde-settings-center__content">
          {normalizedQuery ? <GeneralSettingsPage query={query}
            searchEmptyIllustrationUrl={bootstrap.assets.searchEmptyIllustrationUrl} strings={strings} /> : null}
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
                <ImagesSettingsPage strings={strings} />
              </section>
              {NAV_ITEMS.slice(3).map((item) => <section key={item.id}
                id={`settings-section-${item.id}`} data-settings-section={item.id}
                ref={(element) => { sectionRefs.current[item.id] = element; }}
                className="easymde-settings-center__settings-section">
                <div className="easymde-settings-center__section-placeholder">
                  <h2>{strings.sectionPending}</h2>
                  <p>{strings.sectionPendingDescription}</p>
                </div>
              </section>)}
          </div>
        </div>
      </main>
    </div>
  </div>;
}
