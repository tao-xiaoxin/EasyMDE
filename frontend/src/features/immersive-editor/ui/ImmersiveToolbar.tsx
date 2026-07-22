import { createElement } from '@wordpress/element';
import type { ReactNode } from 'react';
import {
  Eye,
  History,
  LayoutGrid,
  Maximize,
  SquarePen,
  Table2
} from '../../../generated/lucide-icons';
import type { ImmersiveViewMode } from '../immersive-editor';
import { ImmersiveSettingsPopover } from './ImmersiveSettingsPopover';
import type {
  ImmersiveSettings,
  ImmersiveStrings
} from './immersive-editor-ui-types';

function WeChatGlyph() {
  return (
    <span className="easymde-immersive-wechat-glyph" aria-hidden="true">
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c.2.1.4.1.6.2c8.7,2.9,13.3,12.3,10.4,21c-.8,2.3-2,4.3-3.5,6c1.9-.5,3.8-1.3,5.4-2.5c6.6-5.1,7.9-14.5,3.2-20.6z" />
        <path fill="currentColor" d="M17,10.4c.4-.3.7-.5,1.1-.8c.4-.2.8-.4,1.2-.7c.8-.4,1.6-.7,2.4-1c.5-.2,1-.3,1.4-.4c.5-.1,1-.2,1.4-.3c.5-.1,1-.1,1.6-.2c.5,0,1.1-.1,1.6-.1c2.1,0,4.3.4,6.2,1.1c-.2-.4-.4-.7-.4-.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c.3,2.3,1.6,5.4,3.5,7.3c.7-4.9,3.3-9.2,7.1-12z" />
        <path fill="currentColor" d="M20.6,30.9c-1.3,0-2.6-.2-3.8-.4c-.5-.1-1.1,0-1.5.3l-4,2.6c-.5.3-1.1-.1-1.1-.6c0-.2,0-.3.1-.5c0-.1.4-2,.7-3.2c.1-.5-.1-1-.6-1.3c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-.3,19.5-7.6c.3-.9.7-2.4.8-3.6c-2.9,2.1-6,3.1-10,3.1z" />
      </svg>
    </span>
  );
}

export function ImmersiveToolbar({
  historyAvailable,
  mode,
  settings,
  strings,
  styleControls,
  toolbar,
  wechatCopied,
  onCopyWechat,
  onExit,
  onHistory,
  onModeChange,
  onSettingsChange,
  onTable
}: Readonly<{
  historyAvailable: boolean;
  mode: ImmersiveViewMode;
  settings: ImmersiveSettings;
  strings: ImmersiveStrings;
  styleControls: ReactNode;
  toolbar: ReactNode;
  wechatCopied: boolean;
  onCopyWechat: () => void;
  onExit: () => void;
  onHistory: () => void;
  onModeChange: (mode: ImmersiveViewMode) => void;
  onSettingsChange: (settings: ImmersiveSettings) => void;
  onTable: () => void;
}>) {
  const modeControls = [
    { icon: SquarePen, label: strings.editMode, value: 'source' },
    { icon: LayoutGrid, label: strings.splitMode, value: 'split' },
    { icon: Eye, label: strings.previewMode, value: 'preview' }
  ] as const;

  return (
    <div className="easymde-immersive-toolbar-row">
      <div className="easymde-immersive-formatting">
        {toolbar}
        <button
          type="button"
          className="easymde-immersive-table-trigger"
          onClick={onTable}
          aria-label={strings.table}
          title={strings.table}
        >
          <Table2 size={14} strokeWidth={2} />
        </button>
        <span className="easymde-immersive-toolbar-divider" aria-hidden="true" />
        {modeControls.map(({ icon: Icon, label, value }) => (
          <button
            type="button"
            key={value}
            className={`easymde-immersive-mode-button${mode === value ? ' is-active' : ''}`}
            aria-label={label}
            title={label}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        ))}
        <button
          type="button"
          className="easymde-immersive-mode-button"
          onClick={onExit}
          aria-label={strings.exit}
          title={strings.exit}
        >
          <Maximize size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="easymde-immersive-secondary-actions">
        <button
          type="button"
          onClick={onCopyWechat}
          className="easymde-immersive-wechat"
        >
          <WeChatGlyph />
          <span>{wechatCopied ? strings.wechatCopied : strings.wechat}</span>
        </button>
        <button
          type="button"
          disabled={!historyAvailable}
          onClick={onHistory}
        >
          <History size={13} />
          <span>{strings.history}</span>
        </button>
        {styleControls}
        <ImmersiveSettingsPopover
          settings={settings}
          strings={strings}
          onChange={onSettingsChange}
        />
      </div>
    </div>
  );
}
