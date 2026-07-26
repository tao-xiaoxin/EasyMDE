import { createElement } from '@wordpress/element';
import type { ReactNode } from 'react';

type SearchField = ReadonlyArray<string | undefined>;

export function matchesSettingsQuery(query: string, field: SearchField): boolean {
  return !query || field.some((value) => value?.toLowerCase().includes(query));
}

export function SettingsToggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label}
    onClick={onChange} className="easymde-settings-center__switch">
    <span className="easymde-settings-center__switch-thumb" />
  </button>;
}

export function SettingsRow({
  children,
  description,
  label,
  minHeight,
  query = ''
}: {
  children: ReactNode;
  description?: string;
  label: string;
  minHeight?: 70 | 76 | 82;
  query?: string;
}) {
  if (!matchesSettingsQuery(query, [label, description])) return null;

  const className = [
    'easymde-settings-center__row',
    description ? 'has-description' : '',
    minHeight ? `is-height-${minHeight}` : ''
  ].filter(Boolean).join(' ');

  return <div className={className}>
    <div className="easymde-settings-center__row-label">
      <div>{label}</div>
      {description ? <p>{description}</p> : null}
    </div>
    <div className="easymde-settings-center__row-control">{children}</div>
  </div>;
}
