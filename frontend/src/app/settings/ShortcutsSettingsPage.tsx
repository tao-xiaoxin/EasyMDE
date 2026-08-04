import { createElement, useMemo, useState } from '@wordpress/element';

import { RotateCcw } from '../../generated/lucide-icons';
import type {
  SettingsCenterBootstrap,
  SettingsCenterCommand
} from '../../contracts/bootstrap/settings-center-bootstrap';
import { KeyboardIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];
type ShortcutValue = Readonly<{ win: string; mac: string }>;
type ShortcutValues = Readonly<Record<string, ShortcutValue>>;

function getInitialValues(
  commands: ReadonlyArray<SettingsCenterCommand>,
  stored: Readonly<Record<string, ShortcutValue>>
): ShortcutValues {
  return Object.fromEntries(commands.map((command) => {
    const current = stored[command.id];
    return [command.id, {
      win: current?.win ?? command.defaultShortcutWin,
      mac: current?.mac ?? command.defaultShortcutMac
    }];
  }));
}

function getDefaultValues(commands: ReadonlyArray<SettingsCenterCommand>): ShortcutValues {
  return Object.fromEntries(commands.map((command) => [command.id, {
    win: command.defaultShortcutWin,
    mac: command.defaultShortcutMac
  }]));
}

export function ShortcutsSettingsPage({
  commands,
  optionKey,
  settings,
  strings: s
}: {
  commands: ReadonlyArray<SettingsCenterCommand>;
  optionKey: string;
  settings: SettingsCenterBootstrap['settings'];
  strings: Strings;
}) {
  const visibleCommands = useMemo(
    () => commands.filter((command) => command.id !== 'ai'),
    [commands]
  );
  const [values, setValues] = useState<ShortcutValues>(() => (
    getInitialValues(visibleCommands, settings.shortcuts)
  ));

  const updateShortcut = (id: string, platform: keyof ShortcutValue, value: string) => {
    setValues((current) => {
      const existing = current[id];
      if (!existing) throw new Error(`settings-center-shortcut-${id}-state-missing`);
      return {
        ...current,
        [id]: {
          win: 'win' === platform ? value : existing.win,
          mac: 'mac' === platform ? value : existing.mac
        }
      };
    });
  };

  const resetDefaults = () => setValues(getDefaultValues(visibleCommands));

  return <div className="easymde-settings-center__shortcuts-settings">
    <section className="easymde-settings-center__shortcut-card">
      <div className="easymde-settings-center__shortcut-heading">
        <h2><KeyboardIcon size={25} />{s.shortcuts}</h2>
        <button type="button" onClick={resetDefaults}>
          <RotateCcw size={16} />{s.restoreDefaultShortcuts}
        </button>
      </div>
      <p className="easymde-settings-center__shortcut-description">{s.shortcutsDescription}</p>
      <div className="easymde-settings-center__shortcut-table-heading">
        <span>{s.shortcutFunction}</span>
        <span>{s.windowsLinux}</span>
        <span>{s.macOS}</span>
      </div>
      {visibleCommands.length > 0 ? visibleCommands.map((command) => {
        const value = values[command.id];
        if (!value) throw new Error(`settings-center-shortcut-${command.id}-state-missing`);
        const groupLabel = command.group || s.shortcutFunction;
        return <div key={command.id} className="easymde-settings-center__shortcut-row"
          data-setting-search={`${command.label} ${groupLabel} ${value.win} ${value.mac}`}
          data-setting-label={command.label}
          data-setting-description=""
          data-setting-group={groupLabel}>
          <span>{command.label}</span>
          <input
            aria-label={`${command.label} ${s.windowsLinux}`}
            name={`${optionKey}[shortcuts][${command.id}][win]`}
            value={value.win}
            onChange={(event) => updateShortcut(command.id, 'win', event.target.value)}
          />
          <input
            aria-label={`${command.label} ${s.macOS}`}
            name={`${optionKey}[shortcuts][${command.id}][mac]`}
            value={value.mac}
            onChange={(event) => updateShortcut(command.id, 'mac', event.target.value)}
          />
        </div>;
      }) : <p className="easymde-settings-center__pending">{s.sectionPending}</p>}
    </section>
  </div>;
}
