import { createElement } from '@wordpress/element';

import type { SettingsCenterBootstrap } from '../../contracts/bootstrap/settings-center-bootstrap';
import { SlidersIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];

export function PendingSettingsPage({
  description,
  strings: s,
  title
}: {
  description: string;
  strings: Strings;
  title: string;
}) {
  return <div className="easymde-settings-center__pending-page">
    <section className="easymde-settings-center__pending">
      <h2><SlidersIcon size={24} /><span>{title}</span></h2>
      <p>{description}</p>
      <p>{s.sectionPendingDescription}</p>
      <div role="status">{s.sectionPending}</div>
    </section>
  </div>;
}
