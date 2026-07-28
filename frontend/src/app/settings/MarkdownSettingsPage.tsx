import { createElement, useState } from '@wordpress/element';
import type { ReactNode } from 'react';

import { ChevronDown, Code2, Puzzle } from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap } from '../../contracts/bootstrap/settings-center-bootstrap';
import { SettingsRow, SettingsToggle } from './SettingsControls';
import { EditPencilIcon, GeneralIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];

type MarkdownSettingsDraft = {
  livePreview: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  fixedToolbar: boolean;
  editorTheme: string;
  editorFontSize: string;
  editorFont: string;
  githubFlavor: boolean;
  smartPunctuation: boolean;
  tableAlignment: string;
  codeTheme: string;
  codeLineNumbers: string;
  taskLists: boolean;
  emoji: boolean;
  math: boolean;
  htmlRendering: boolean;
  tableExtension: boolean;
  footnotes: boolean;
  definitionLists: boolean;
  toc: boolean;
  imageSizeSyntax: boolean;
  pasteAsMarkdown: boolean;
  lineEnding: string;
  unorderedMarker: string;
  orderedStart: string;
  blockquoteStyle: string;
};

function createDefaultSettings(strings: Strings): MarkdownSettingsDraft {
  return {
    livePreview: true,
    wordWrap: true,
    lineNumbers: false,
    fixedToolbar: true,
    editorTheme: strings.automaticFollowSystem,
    editorFontSize: '14px',
    editorFont: strings.systemDefault,
    githubFlavor: true,
    smartPunctuation: true,
    tableAlignment: strings.autoAlignByContent,
    codeTheme: strings.lightCodeTheme,
    codeLineNumbers: strings.show,
    taskLists: true,
    emoji: true,
    math: true,
    htmlRendering: false,
    tableExtension: true,
    footnotes: true,
    definitionLists: true,
    toc: false,
    imageSizeSyntax: true,
    pasteAsMarkdown: true,
    lineEnding: strings.automaticFollowSystem,
    unorderedMarker: '-',
    orderedStart: '1',
    blockquoteStyle: strings.standardBlockquote
  };
}

function MarkdownSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<string>;
  value: string;
}) {
  return <div className="easymde-settings-center__compact-select">
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
    <ChevronDown size={15} />
  </div>;
}

function MarkdownRow({
  children,
  description,
  label
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return <SettingsRow label={label} minHeight={65} {...(description ? { description } : {})}>
    <div className="easymde-settings-center__markdown-field-control">{children}</div>
  </SettingsRow>;
}

export function MarkdownSettingsPage({ strings }: { strings: Strings }) {
  const [settings, setSettings] = useState<MarkdownSettingsDraft>(() => createDefaultSettings(strings));

  function setValue<K extends keyof MarkdownSettingsDraft>(
    key: K,
    value: MarkdownSettingsDraft[K]
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return <div className="easymde-settings-center__markdown-page">
    <section className="easymde-settings-center__markdown-group">
      <h2><EditPencilIcon size={25} />{strings.markdownEditorSettings}</h2>
      {([
        ['livePreview', strings.markdownLivePreview, strings.livePreviewDescription],
        ['wordWrap', strings.wordWrap, strings.wordWrapDescription],
        ['lineNumbers', strings.showLineNumbers, strings.markdownLineNumbersDescription],
        ['fixedToolbar', strings.fixedToolbar, strings.fixedToolbarDescription]
      ] as const).map(([key, label, description]) => <MarkdownRow key={key}
        label={label} description={description}>
        <SettingsToggle label={label} checked={settings[key]}
          onChange={() => setValue(key, !settings[key])} />
      </MarkdownRow>)}
      <MarkdownRow label={strings.editorTheme}>
        <MarkdownSelect label={strings.editorTheme} value={settings.editorTheme}
          options={[strings.automaticFollowSystem, strings.light, strings.dark]}
          onChange={(value) => setValue('editorTheme', value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.editorFontSize}>
        <MarkdownSelect label={strings.editorFontSize} value={settings.editorFontSize}
          options={['12px', '13px', '14px', '15px', '16px', '18px']}
          onChange={(value) => setValue('editorFontSize', value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.editorFont}>
        <MarkdownSelect label={strings.editorFont} value={settings.editorFont}
          options={[strings.systemDefault, strings.monospaceFont, strings.sourceHanSans]}
          onChange={(value) => setValue('editorFont', value)} />
      </MarkdownRow>
    </section>

    <section className="easymde-settings-center__markdown-group">
      <h2><Code2 size={25} />{strings.markdownParsingRendering}</h2>
      {([
        ['githubFlavor', strings.githubFlavor, strings.githubFlavorDescription],
        ['smartPunctuation', strings.smartPunctuation, strings.smartPunctuationDescription]
      ] as const).map(([key, label, description]) => <MarkdownRow key={key}
        label={label} description={description}>
        <SettingsToggle label={label} checked={settings[key]}
          onChange={() => setValue(key, !settings[key])} />
      </MarkdownRow>)}
      <MarkdownRow label={strings.tableAlignment}>
        <MarkdownSelect label={strings.tableAlignment} value={settings.tableAlignment}
          options={[strings.autoAlignByContent, strings.alignLeft, strings.alignCenter]}
          onChange={(value) => setValue('tableAlignment', value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.codeBlockTheme}>
        <MarkdownSelect label={strings.codeBlockTheme} value={settings.codeTheme}
          options={[strings.lightCodeTheme, strings.darkCodeTheme, strings.followEditor]}
          onChange={(value) => setValue('codeTheme', value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.codeBlockLineNumbers}>
        <MarkdownSelect label={strings.codeBlockLineNumbers} value={settings.codeLineNumbers}
          options={[strings.show, strings.hide]}
          onChange={(value) => setValue('codeLineNumbers', value)} />
      </MarkdownRow>
      {([
        ['taskLists', strings.taskLists, strings.taskListsDescription],
        ['emoji', strings.emoji, strings.emojiDescription],
        ['math', strings.mathSupport, strings.mathSupportDescription],
        ['htmlRendering', strings.htmlRendering, strings.htmlRenderingDescription]
      ] as const).map(([key, label, description]) => <MarkdownRow key={key}
        label={label} description={description}>
        <SettingsToggle label={label} checked={settings[key]}
          onChange={() => setValue(key, !settings[key])} />
      </MarkdownRow>)}
    </section>

    <section className="easymde-settings-center__markdown-group is-compact-heading">
      <h2><Puzzle size={25} />{strings.markdownExtensions}</h2>
      {([
        ['tableExtension', strings.tableExtension, strings.tableExtensionDescription],
        ['footnotes', strings.footnotes, strings.footnotesDescription],
        ['definitionLists', strings.definitionLists, strings.definitionListsDescription],
        ['toc', strings.tocDirectory, strings.tocDirectoryDescription],
        ['imageSizeSyntax', strings.imageSizeSyntax, strings.imageSizeSyntaxDescription]
      ] as const).map(([key, label, description]) => <MarkdownRow key={key}
        label={label} description={description}>
        <SettingsToggle label={label} checked={settings[key]}
          onChange={() => setValue(key, !settings[key])} />
      </MarkdownRow>)}
    </section>

    <section className="easymde-settings-center__markdown-group is-compact-heading">
      <h2><GeneralIcon size={25} />{strings.otherSettings}</h2>
      <MarkdownRow label={strings.pasteAsMarkdown} description={strings.pasteAsMarkdownDescription}>
        <SettingsToggle label={strings.pasteAsMarkdown} checked={settings.pasteAsMarkdown}
          onChange={() => setValue('pasteAsMarkdown', !settings.pasteAsMarkdown)} />
      </MarkdownRow>
      <MarkdownRow label={strings.defaultLineEnding}>
        <MarkdownSelect label={strings.defaultLineEnding} value={settings.lineEnding}
          options={[strings.automaticFollowSystem, 'LF', 'CRLF']}
          onChange={(value) => setValue('lineEnding', value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.unorderedListMarker}>
        <input className="easymde-settings-center__markdown-input"
          aria-label={strings.unorderedListMarker} value={settings.unorderedMarker}
          onChange={(event) => setValue('unorderedMarker', event.target.value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.orderedListStart}>
        <input className="easymde-settings-center__markdown-input"
          aria-label={strings.orderedListStart} value={settings.orderedStart}
          onChange={(event) => setValue('orderedStart', event.target.value)} />
      </MarkdownRow>
      <MarkdownRow label={strings.blockquoteIndentStyle}>
        <MarkdownSelect label={strings.blockquoteIndentStyle} value={settings.blockquoteStyle}
          options={[strings.standardBlockquote, strings.spacedBlockquote]}
          onChange={(value) => setValue('blockquoteStyle', value)} />
      </MarkdownRow>
    </section>
  </div>;
}
