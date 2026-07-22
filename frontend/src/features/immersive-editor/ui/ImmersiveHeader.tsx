import { createElement } from '@wordpress/element';
import {
  Check,
  ChevronDown,
  Columns2,
  Eye,
  PenLine
} from '../../../generated/lucide-icons';
import type { DocumentStats, ImmersiveViewMode } from '../immersive-editor';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

function PublishArticleIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
    >
      <path
        d="M5.75 2.75H10.45L13.5 5.8V13.5C13.5 14.19 12.94 14.75 12.25 14.75H5.75C5.06 14.75 4.5 14.19 4.5 13.5V4C4.5 3.31 5.06 2.75 5.75 2.75Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.25 2.9V6.05H13.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12.6V8.35M7.25 10.1L9 8.35L10.75 10.1"
        stroke="#8DD7FF"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ImmersiveHeader({
  dirty,
  mode,
  showStats,
  stats,
  strings,
  title,
  onModeChange,
  onPublish,
  onTitleChange
}: Readonly<{
  dirty: boolean;
  mode: ImmersiveViewMode;
  showStats: boolean;
  stats: DocumentStats;
  strings: ImmersiveStrings;
  title: string;
  onModeChange: (mode: ImmersiveViewMode) => void;
  onPublish: () => void;
  onTitleChange: (title: string) => void;
}>) {
  return (
    <header className="easymde-immersive-header">
      <div className="easymde-immersive-brand">
        <span className="easymde-traffic-light is-red" />
        <span className="easymde-traffic-light is-yellow" />
        <span className="easymde-traffic-light is-green" />
        <PenLine size={15} strokeWidth={2.5} />
        <span className="easymde-immersive-brand-name">EasyMDE</span>
        <span className="easymde-immersive-brand-divider" aria-hidden="true">|</span>
      </div>
      <div className="easymde-immersive-title-wrap">
        <div className="easymde-immersive-title-field">
          <div className="easymde-immersive-title-measure">
            <span aria-hidden="true">{title || `${strings.title}…`}</span>
            <textarea
              rows={1}
              value={title}
              onChange={(event) => onTitleChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ('Enter' === event.key) event.preventDefault();
              }}
              aria-label={strings.title}
              placeholder={`${strings.title}…`}
            />
          </div>
          <ChevronDown size={14} strokeWidth={2} />
        </div>
        <span className={`easymde-immersive-save-state${dirty ? ' is-dirty' : ''}`}>
          <Check size={13} strokeWidth={2.5} />
          <span>{dirty ? strings.unsaved : strings.saved}</span>
        </span>
        {showStats ? (
          <span className="easymde-immersive-stats">
            <span>{stats.words} {strings.words}</span>
            <span>{stats.characters} {strings.characters}</span>
            <span>{strings.readingTime} {stats.minutes} {strings.minutes}</span>
          </span>
        ) : null}
      </div>
      <span className="easymde-immersive-header-spacer is-primary" />
      <fieldset className="easymde-immersive-view-switch">
        <legend className="screen-reader-text">{strings.viewModes}</legend>
        {([
          ['source', strings.edit, PenLine],
          ['split', strings.split, Columns2],
          ['preview', strings.preview, Eye]
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'is-active' : ''}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        ))}
      </fieldset>
      <span className="easymde-immersive-header-spacer is-secondary" />
      <div className="easymde-immersive-header-actions">
        <span className="easymde-immersive-ai-omission-spacer" aria-hidden="true" />
        <span className="easymde-immersive-header-divider" aria-hidden="true" />
        <button
          type="button"
          className="easymde-immersive-publish"
          onClick={onPublish}
          aria-label={strings.publish}
          title={strings.publish}
        >
          <span className="easymde-immersive-publish-shine" aria-hidden="true" />
          <span className="easymde-immersive-publish-icon"><PublishArticleIcon /></span>
          <span>{strings.publish}</span>
        </button>
      </div>
    </header>
  );
}
