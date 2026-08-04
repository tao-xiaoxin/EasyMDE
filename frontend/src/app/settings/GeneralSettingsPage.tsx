import { createElement } from '@wordpress/element';
import type { ReactNode } from 'react';

import { ChevronDown } from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap } from '../../contracts/bootstrap/settings-center-bootstrap';
import { matchesSettingsQuery, SettingsRow } from './SettingsControls';
import { SlidersIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];

function NativeSelect({ disabled = false, label, options, value }: {
  disabled?: boolean;
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
}) {
  return <span className="easymde-settings-center__select-wrap">
    <select aria-label={label} disabled={disabled} value={value} onChange={() => undefined}>
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>{optionLabel}</option>
      ))}
    </select>
    <ChevronDown size={15} strokeWidth={2.2} />
  </span>;
}

function SettingsSection({ children, icon: Icon, title }: {
  children: ReactNode;
  icon: typeof SlidersIcon;
  title: string;
}) {
  return <section className="easymde-settings-center__section">
    <h2><Icon size={24} /><span>{title}</span></h2>
    <div className="easymde-settings-center__section-body">{children}</div>
  </section>;
}

export function matchesGeneralSettingsQuery(query: string, s: Strings): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return matchesSettingsQuery(normalizedQuery, [
    s.toolbarLayout,
    s.toolbarLayoutDescription,
    s.hybridIconToolbar
  ]);
}

function formatNoResultsTitle(template: string, query: string): string {
  return template.replace('%s', () => query.trim());
}

export function GeneralSettingsPage({
  embedded = false,
  optionKey,
  query,
  searchEmptyIllustrationUrl,
  settings,
  strings: s
}: {
  embedded?: boolean;
  optionKey: string;
  query: string;
  searchEmptyIllustrationUrl: string;
  settings: SettingsCenterBootstrap['settings'];
  strings: Strings;
}) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery && !matchesGeneralSettingsQuery(normalizedQuery, s)) {
    return <section className="easymde-settings-center__no-results" aria-live="polite">
      <div className="easymde-settings-center__no-results-body">
        <div aria-hidden="true"><img src={searchEmptyIllustrationUrl} alt="" /></div>
        <h2>{formatNoResultsTitle(s.noSearchResults, query)}</h2>
        <p>{s.noSearchResultsDescription}</p>
      </div>
    </section>;
  }

  return <div className={embedded
    ? 'easymde-settings-center__general-settings'
    : 'easymde-settings-center__sections'}>
    <SettingsSection icon={SlidersIcon} title={s.basePreferences}>
      <SettingsRow
        label={s.toolbarLayout}
        description={s.toolbarLayoutDescription}
        query={normalizedQuery}
        searchGroup={s.basePreferences}
      >
        <NativeSelect
          disabled
          label={s.toolbarLayout}
          value={settings.toolbarLayout}
          options={[[settings.toolbarLayout, s.hybridIconToolbar]]}
        />
        <input type="hidden" name={`${optionKey}[toolbar_layout]`} value={settings.toolbarLayout} />
      </SettingsRow>
    </SettingsSection>
  </div>;
}
