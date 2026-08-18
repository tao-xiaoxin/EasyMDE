import { createElement, useState } from '@wordpress/element';

import { RotateCcw } from '../../generated/lucide-icons';
import type {
  SettingsCenterBootstrap,
  SettingsCenterStringKey
} from '../../contracts/bootstrap/settings-center-bootstrap';
import type {
  ShortcutId,
  ShortcutValue,
  ShortcutValues,
  ShortcutsSettings
} from '../../contracts/settings-center-settings';
import { SettingsRow, SettingsToggle } from './SettingsControls';
import { KeyboardIcon, SlidersIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];
type ShortcutRow = Readonly<{
  id: ShortcutId;
  label: SettingsCenterStringKey;
}>;
type ShortcutGroup = Readonly<{
  title: SettingsCenterStringKey;
  icon: 'keyboard' | 'type';
  rows: ReadonlyArray<ShortcutRow>;
}>;

const DEFAULT_SHORTCUTS: ShortcutValues = {
  save: { windows: 'Ctrl+S', mac: 'Cmd+S' },
  bold: { windows: 'Ctrl+B', mac: 'Cmd+B' },
  italic: { windows: 'Ctrl+I', mac: 'Cmd+I' },
  link: { windows: 'Ctrl+K', mac: 'Cmd+K' },
  image: { windows: 'Ctrl+Shift+I', mac: 'Cmd+Ctrl+I' },
  'heading-one': { windows: 'Ctrl+1', mac: 'Cmd+1' },
  'heading-two': { windows: 'Ctrl+2', mac: 'Cmd+2' },
  quote: { windows: 'Ctrl+Shift+Q', mac: 'Cmd+Option+Q' },
  'unordered-list': { windows: 'Ctrl+Shift+U', mac: 'Cmd+Option+U' },
  'ordered-list': { windows: 'Ctrl+Shift+O', mac: 'Cmd+Option+O' }
};

const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    title: 'commonShortcuts',
    icon: 'keyboard',
    rows: [
      { id: 'save', label: 'saveArticle' },
      { id: 'bold', label: 'bold' },
      { id: 'italic', label: 'italic' },
      { id: 'link', label: 'insertLink' },
      { id: 'image', label: 'insertImage' },
    ]
  },
  {
    title: 'headingAndFormatting',
    icon: 'type',
    rows: [
      { id: 'heading-one', label: 'headingOne' },
      { id: 'heading-two', label: 'headingTwo' },
      { id: 'quote', label: 'quote' },
      { id: 'unordered-list', label: 'unorderedList' },
      { id: 'ordered-list', label: 'orderedList' }
    ]
  }
];

function ShortcutCard({
  group,
  onChange,
  onReset,
  strings: s,
  values
}: {
  group: ShortcutGroup;
  onChange: (id: ShortcutId, platform: keyof ShortcutValue, value: string) => void;
  onReset: (() => void) | undefined;
  strings: Strings;
  values: ShortcutValues;
}) {
  return <section className="easymde-settings-center__shortcut-card">
    <div className="easymde-settings-center__shortcut-heading">
      <h2>
        {group.icon === 'keyboard'
          ? <KeyboardIcon size={25} />
          : <span aria-hidden="true">T</span>}
        {s[group.title]}
      </h2>
      {onReset ? <button type="button" onClick={onReset}>
        <RotateCcw size={16} />{s.restoreDefaultShortcuts}
      </button> : null}
    </div>
    <div className="easymde-settings-center__shortcut-table-heading">
      <span>{s.shortcutFunction}</span>
      <span>{s.windowsLinux}</span>
      <span>{s.macOS}</span>
    </div>
    {group.rows.map((row) => {
      const value = values[row.id];
      return <div key={row.id} className="easymde-settings-center__shortcut-row"
        data-setting-search={`${s[row.label]} ${s[group.title]} ${value.windows} ${value.mac}`}
        data-setting-label={s[row.label]}
        data-setting-description=""
        data-setting-group={s[group.title]}>
        <span>{s[row.label]}</span>
        <input aria-label={`${s[row.label]} ${s.windowsLinux}`} value={value.windows}
          onChange={(event) => onChange(row.id, 'windows', event.target.value)} />
        <input aria-label={`${s[row.label]} ${s.macOS}`} value={value.mac}
          onChange={(event) => onChange(row.id, 'mac', event.target.value)} />
      </div>;
    })}
  </section>;
}

export function ShortcutsSettingsPage({
  defaultValues,
  onChange,
  settings: externalSettings,
  strings: s
}: {
  defaultValues?: ShortcutValues;
  onChange?: (settings: ShortcutsSettings) => void;
  settings?: ShortcutsSettings;
  strings: Strings;
}) {
  const resetValues = defaultValues ?? DEFAULT_SHORTCUTS;
  const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(() => ({
    values: resetValues,
    showHints: true,
    detectConflicts: true,
    showSuggestions: true
  }));
  const settings = externalSettings ?? localSettings;
  const values = settings.values;
  const update = (next: ShortcutsSettings) => {
    if (onChange) onChange(next);
    else setLocalSettings(next);
  };
  const updateShortcut = (
    id: ShortcutId,
    platform: keyof ShortcutValue,
    value: string
  ) => {
    update({ ...settings, values: {
      ...values,
      [id]: { ...values[id], [platform]: value }
    }});
  };
  const resetGroup = (group: ShortcutGroup) => {
    const nextValues = { ...values };
    group.rows.forEach(({ id }) => {
      nextValues[id] = resetValues[id];
    });
    update({ ...settings, values: nextValues });
  };

  return <div className="easymde-settings-center__shortcuts-settings">
    <div className="easymde-settings-center__shortcut-groups">
      {SHORTCUT_GROUPS.map((group) => <ShortcutCard
        key={group.title}
        group={group}
        strings={s}
        values={values}
        onChange={updateShortcut}
        onReset={() => resetGroup(group)}
      />)}
    </div>
    <section className="easymde-settings-center__shortcut-behavior">
      <h2><SlidersIcon size={25} />{s.shortcutBehavior}</h2>
      <SettingsRow label={s.showShortcutHints} description={s.settingsUnavailableDescription}>
        <SettingsToggle label={s.showShortcutHints} checked={settings.showHints}
          disabled
          onChange={() => update({ ...settings, showHints: !settings.showHints })} />
      </SettingsRow>
      <SettingsRow label={s.detectShortcutConflicts} description={s.settingsUnavailableDescription}>
        <SettingsToggle label={s.detectShortcutConflicts} checked={settings.detectConflicts}
          disabled
          onChange={() => update({ ...settings, detectConflicts: !settings.detectConflicts })} />
      </SettingsRow>
      <SettingsRow label={s.customShortcutSuggestions} description={s.settingsUnavailableDescription}>
        <SettingsToggle label={s.customShortcutSuggestions} checked={settings.showSuggestions}
          disabled
          onChange={() => update({ ...settings, showSuggestions: !settings.showSuggestions })} />
      </SettingsRow>
    </section>
  </div>;
}
