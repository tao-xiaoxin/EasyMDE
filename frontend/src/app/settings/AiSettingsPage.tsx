import {
  createElement,
  createPortal,
  Fragment,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { ReactNode } from 'react';

import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  Eye,
  Info,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Trash2,
  WandSparkles,
  X
} from '../../generated/lucide-icons';
import type { SettingsCenterBootstrap } from '../../contracts/bootstrap/settings-center-bootstrap';
import { SettingsRow, SettingsToggle } from './SettingsControls';
import { AiSparkIcon, KeyboardIcon, SlidersIcon } from './settings-center-icons';

type Strings = SettingsCenterBootstrap['strings'];
type AiDraftBootstrap = SettingsCenterBootstrap['drafts']['ai'];
type PromptCategory = 'writing' | 'polish' | 'summary' | 'translation' | 'custom';
type Prompt = Readonly<{
  id: string;
  name: string;
  category: PromptCategory;
  content: string;
}>;
type PromptEditor = Readonly<{
  mode: 'create' | 'edit';
  id: string | null;
  name: string;
  category: PromptCategory;
  content: string;
}>;
type Feedback = Readonly<{
  kind: 'success' | 'error' | 'info';
  message: string;
  presentation?: 'connection';
}>;

type AiSettingsDraft = {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  autoComplete: boolean;
  completionTrigger: string;
  completionTiming: string;
  minimumTriggerChars: string;
  suggestionCount: string;
  contextLines: string;
  displayPosition: string;
  autoInsertSingle: boolean;
  completeCodeBlocks: boolean;
  assistantSidebar: boolean;
  titleOptimization: boolean;
  summaryGeneration: boolean;
  tonePolish: boolean;
  continuationSuggestions: boolean;
  outlineGeneration: boolean;
  thinkingDepth: string;
  writingTone: string;
  outputLanguage: string;
  includeContext: boolean;
  readMetadata: boolean;
  saveLastPrompt: boolean;
};

function createDefaultSettings(strings: Strings, draft: AiDraftBootstrap): AiSettingsDraft {
  return {
    ...draft,
    autoComplete: true,
    completionTrigger: strings.completionTriggerTab,
    completionTiming: strings.completionTimingRealtime,
    minimumTriggerChars: '2',
    suggestionCount: '3',
    contextLines: '20',
    displayPosition: strings.displayPositionBelow,
    autoInsertSingle: true,
    completeCodeBlocks: true,
    assistantSidebar: true,
    titleOptimization: true,
    summaryGeneration: true,
    tonePolish: true,
    continuationSuggestions: true,
    outlineGeneration: false,
    thinkingDepth: strings.thinkingDepthStandard,
    writingTone: strings.writingToneGeneral,
    outputLanguage: strings.simplifiedChinese,
    includeContext: true,
    readMetadata: true,
    saveLastPrompt: false
  };
}

function createDefaultPrompts(strings: Strings): ReadonlyArray<Prompt> {
  return [
    {
      id: 'default-title',
      name: strings.defaultPromptTitleName,
      category: 'writing',
      content: strings.defaultPromptTitleContent
    },
    {
      id: 'default-polish',
      name: strings.defaultPromptPolishName,
      category: 'polish',
      content: strings.defaultPromptPolishContent
    },
    {
      id: 'default-summary',
      name: strings.defaultPromptSummaryName,
      category: 'summary',
      content: strings.defaultPromptSummaryContent
    }
  ];
}

function createPromptId(): string {
  return crypto.randomUUID();
}

function formatTemplate(template: string, value: string | number): string {
  return template.replace('%s', () => String(value));
}

function splitTemplate(template: string): readonly [string, string] {
  const parts = template.split('%s');
  if (parts.length !== 2) throw new Error('settings-center-prompt-template-invalid');
  return [parts[0] ?? '', parts[1] ?? ''];
}

function formatPaginationSummary(
  template: string,
  count: number,
  page: number,
  totalPages: number
): string {
  return template
    .replace('%1$s', () => String(count))
    .replace('%2$s', () => String(page))
    .replace('%3$s', () => String(totalPages));
}

function formatConnectionSuccess(template: string, provider: string, model: string): string {
  return template
    .replace('%1$s', () => provider)
    .replace('%2$s', () => model);
}

function CompactSelect({
  height = 39,
  label,
  onChange,
  options,
  value
}: {
  height?: 34 | 39;
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<Readonly<{ label: string; value: string }>>;
  value: string;
}) {
  return <div className="easymde-settings-center__compact-select"
    data-height={height}>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <ChevronDown size={15} />
  </div>;
}

function AiField({ children, label }: { children: ReactNode; label: string }) {
  return <SettingsRow label={label}>
    <div className="easymde-settings-center__ai-field-control">{children}</div>
  </SettingsRow>;
}

function AiBehaviorRow({
  children,
  description,
  label
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return <SettingsRow label={label} minHeight={65} {...(description ? { description } : {})}>
    <div className="easymde-settings-center__ai-field-control">{children}</div>
  </SettingsRow>;
}

function SecretInput({
  hideLabel,
  label,
  onChange,
  showLabel,
  value
}: {
  hideLabel: string;
  label: string;
  onChange: (value: string) => void;
  showLabel: string;
  value: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="easymde-settings-center__secret-input">
    <input aria-label={label} type={visible ? 'text' : 'password'} value={value}
      onChange={(event) => onChange(event.target.value)} />
    <button type="button" aria-label={visible ? hideLabel : showLabel}
      onClick={() => setVisible((current) => !current)}><Eye size={18} /></button>
  </div>;
}

function PromptFeedback({ feedback, onClose, strings }: {
  feedback: Feedback;
  onClose: () => void;
  strings: Strings;
}) {
  return <div role={feedback.kind === 'error' ? 'alert' : 'status'}
    className="easymde-settings-center__prompt-feedback" data-kind={feedback.kind}
    data-presentation={feedback.presentation}>
    {feedback.kind === 'error' ? <Info size={17} />
      : feedback.kind === 'info' ? <Info size={19} />
      : feedback.presentation === 'connection' ? <CircleCheck size={19} /> : <Check size={17} />}
    <span>{feedback.message}</span>
    {feedback.kind !== 'success' ? <button type="button" aria-label={strings.closePromptFeedback}
      onClick={onClose}><X size={feedback.presentation === 'connection' ? 16 : 15} /></button> : null}
  </div>;
}

function PromptEditorDialog({
  editor,
  error,
  onCancel,
  onChange,
  onSave,
  strings
}: {
  editor: PromptEditor;
  error: string;
  onCancel: () => void;
  onChange: (editor: PromptEditor) => void;
  onSave: () => void;
  strings: Strings;
}) {
  const title = editor.mode === 'create' ? strings.createPromptTitle : strings.editPromptTitle;
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = nameInputRef.current;
    if (!input) throw new Error('settings-center-prompt-name-input-missing');
    input.focus();
  }, []);
  return <div className="easymde-settings-center__dialog-layer" role="presentation">
    <form onSubmit={(event) => { event.preventDefault(); onSave(); }} role="dialog"
      aria-modal="true" aria-labelledby="easymde-prompt-editor-title"
      className="easymde-settings-center__prompt-editor-dialog">
      <header>
        <span><MessageSquare size={18} /></span>
        <div><h2 id="easymde-prompt-editor-title">{title}</h2><p>{strings.promptEditorDescription}</p></div>
        <button type="button" aria-label={strings.closePromptEditor} onClick={onCancel}><X size={19} /></button>
      </header>
      <div className="easymde-settings-center__prompt-editor-fields">
        <div>
          <label htmlFor="easymde-prompt-name">{strings.promptName} <span>{strings.requiredField}</span></label>
          <input ref={nameInputRef} id="easymde-prompt-name" value={editor.name}
            onChange={(event) => onChange({ ...editor, name: event.target.value })}
            placeholder={strings.promptNamePlaceholder} />
        </div>
        <div>
          <label htmlFor="easymde-prompt-category">{strings.promptCategory}</label>
          <div className="easymde-settings-center__prompt-editor-select">
            <select id="easymde-prompt-category" value={editor.category}
              onChange={(event) => onChange({ ...editor, category: event.target.value as PromptCategory })}>
              <option value="writing">{strings.promptCategoryWriting}</option>
              <option value="polish">{strings.promptCategoryPolish}</option>
              <option value="summary">{strings.promptCategorySummary}</option>
              <option value="translation">{strings.promptCategoryTranslation}</option>
              <option value="custom">{strings.promptCategoryCustom}</option>
            </select>
            <ChevronDown size={16} />
          </div>
        </div>
        <div>
          <div className="easymde-settings-center__prompt-content-label">
            <label htmlFor="easymde-prompt-content">{strings.promptContent} <span>{strings.requiredField}</span></label>
            <span>{strings.promptContentHelp}</span>
          </div>
          <textarea id="easymde-prompt-content" value={editor.content}
            onChange={(event) => onChange({ ...editor, content: event.target.value })}
            placeholder={strings.promptContentPlaceholder} />
        </div>
        {error ? <div role="alert" className="easymde-settings-center__prompt-editor-error">
          <Info size={15} />{error}
        </div> : null}
      </div>
      <footer>
        <button type="button" onClick={onCancel}>{strings.cancel}</button>
        <button type="submit">{strings.savePrompt}</button>
      </footer>
    </form>
  </div>;
}

function DeletePromptDialog({
  onCancel,
  onConfirm,
  prompt,
  strings
}: {
  onCancel: () => void;
  onConfirm: () => void;
  prompt: Prompt;
  strings: Strings;
}) {
  const [confirmationBefore, confirmationAfter] = splitTemplate(
    strings.deletePromptConfirmation
  );
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = cancelButtonRef.current;
    if (!button) throw new Error('settings-center-delete-prompt-cancel-missing');
    button.focus();
  }, []);
  return <div className="easymde-settings-center__dialog-layer" role="presentation">
    <div role="dialog" aria-modal="true" aria-labelledby="easymde-delete-prompt-title"
      className="easymde-settings-center__delete-prompt-dialog">
      <div className="easymde-settings-center__delete-prompt-message">
        <span><Trash2 size={18} /></span>
        <div><h2 id="easymde-delete-prompt-title">{strings.deletePromptTitle}</h2>
          <p>{confirmationBefore}<strong>{prompt.name}</strong>{confirmationAfter}</p>
        </div>
      </div>
      <footer>
        <button ref={cancelButtonRef} type="button" onClick={onCancel}>{strings.cancel}</button>
        <button type="button" onClick={onConfirm}>{strings.confirmDelete}</button>
      </footer>
    </div>
  </div>;
}

export function AiSettingsPage({
  draft,
  overlayRoot,
  strings
}: {
  draft: AiDraftBootstrap;
  overlayRoot: HTMLElement | null;
  strings: Strings;
}) {
  const defaultSettings = createDefaultSettings(strings, draft);
  const [settings, setSettings] = useState<AiSettingsDraft>(() => defaultSettings);
  const [testingConnection, setTestingConnection] = useState(false);
  const [prompts, setPrompts] = useState<ReadonlyArray<Prompt>>(() => createDefaultPrompts(strings));
  const [promptCategory, setPromptCategory] = useState<'all' | PromptCategory>('all');
  const [promptPageSize, setPromptPageSize] = useState(10);
  const [promptPage, setPromptPage] = useState(1);
  const [promptPageInput, setPromptPageInput] = useState('1');
  const [promptEditor, setPromptEditor] = useState<PromptEditor | null>(null);
  const [promptEditorError, setPromptEditorError] = useState('');
  const [promptToDelete, setPromptToDelete] = useState<Prompt | null>(null);
  const [promptFeedback, setPromptFeedback] = useState<Feedback | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<Feedback | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);
  const promptFeedbackTimeoutRef = useRef<number | null>(null);
  const connectionFeedbackTimeoutRef = useRef<number | null>(null);
  const promptImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
    if (promptFeedbackTimeoutRef.current !== null) window.clearTimeout(promptFeedbackTimeoutRef.current);
    if (connectionFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(connectionFeedbackTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!promptEditor && !promptToDelete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPromptEditor(null);
      setPromptEditorError('');
      setPromptToDelete(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [promptEditor, promptToDelete]);

  function setValue<K extends keyof AiSettingsDraft>(key: K, value: AiSettingsDraft[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const showFeedback = (nextFeedback: Feedback) => {
    if (promptFeedbackTimeoutRef.current !== null) window.clearTimeout(promptFeedbackTimeoutRef.current);
    setPromptFeedback(nextFeedback);
    if (nextFeedback.kind === 'success') {
      promptFeedbackTimeoutRef.current = window.setTimeout(() => {
        promptFeedbackTimeoutRef.current = null;
        setPromptFeedback(null);
      }, 2800);
    }
  };

  const showConnectionFeedback = (nextFeedback: Feedback) => {
    if (connectionFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(connectionFeedbackTimeoutRef.current);
    }
    setConnectionFeedback(nextFeedback);
    if (nextFeedback.kind === 'success') {
      connectionFeedbackTimeoutRef.current = window.setTimeout(() => {
        connectionFeedbackTimeoutRef.current = null;
        setConnectionFeedback(null);
      }, 2800);
    }
  };

  const testConnection = () => {
    if (testingConnection) return;
    setTestingConnection(true);
    showConnectionFeedback({
      kind: 'info',
      message: formatTemplate(strings.aiConnectionTesting, settings.provider),
      presentation: 'connection'
    });
    connectionTimeoutRef.current = window.setTimeout(() => {
      connectionTimeoutRef.current = null;
      setTestingConnection(false);
      showConnectionFeedback({
        kind: 'success',
        message: formatConnectionSuccess(
          strings.aiConnectionSuccess,
          settings.provider,
          settings.model
        ),
        presentation: 'connection'
      });
    }, 650);
  };

  const restoreAutocompleteDefaults = () => {
    setSettings((current) => ({
      ...defaultSettings,
      provider: current.provider,
      endpoint: current.endpoint,
      apiKey: current.apiKey,
      model: current.model
    }));
  };

  const categories: ReadonlyArray<Readonly<{ id: 'all' | PromptCategory; label: string }>> = [
    { id: 'all', label: strings.allPromptCategories },
    { id: 'writing', label: strings.promptCategoryWriting },
    { id: 'polish', label: strings.promptCategoryPolish },
    { id: 'summary', label: strings.promptCategorySummary },
    { id: 'translation', label: strings.promptCategoryTranslation },
    { id: 'custom', label: strings.promptCategoryCustom }
  ];
  const filteredPrompts = promptCategory === 'all'
    ? prompts
    : prompts.filter((prompt) => prompt.category === promptCategory);
  const totalPages = Math.max(1, Math.ceil(filteredPrompts.length / promptPageSize));
  const effectivePage = Math.min(promptPage, totalPages);
  const pageStart = (effectivePage - 1) * promptPageSize;
  const pagePrompts = filteredPrompts.slice(pageStart, pageStart + promptPageSize);

  const selectCategory = (category: 'all' | PromptCategory) => {
    setPromptCategory(category);
    setPromptPage(1);
    setPromptPageInput('1');
  };

  const changePage = (page: number) => {
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw new Error('settings-center-prompt-page-out-of-range');
    }
    setPromptPage(page);
    setPromptPageInput(String(page));
  };

  const jumpToPage = () => {
    const page = Number(promptPageInput);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      showFeedback({ kind: 'error', message: strings.promptPageInvalid });
      return;
    }
    changePage(page);
    setPromptFeedback(null);
  };

  const openPromptCreator = () => {
    setPromptEditor({ mode: 'create', id: null, name: '', category: 'writing', content: '' });
    setPromptEditorError('');
    setPromptFeedback(null);
  };

  const savePrompt = () => {
    if (!promptEditor) throw new Error('settings-center-prompt-editor-missing');
    const name = promptEditor.name.trim();
    const content = promptEditor.content.trim();
    if (!name || !content) {
      setPromptEditorError(!name && !content
        ? strings.promptNameAndContentRequired
        : !name ? strings.promptNameRequired : strings.promptContentRequired);
      return;
    }
    if (promptEditor.mode === 'create') {
      setPrompts((current) => [...current, {
        id: createPromptId(), name, category: promptEditor.category, content
      }]);
      setPromptCategory('all');
      setPromptPage(1);
      setPromptPageInput('1');
      showFeedback({ kind: 'success', message: formatTemplate(strings.promptCreated, name) });
    } else {
      if (!promptEditor.id || !prompts.some((prompt) => prompt.id === promptEditor.id)) {
        throw new Error('settings-center-prompt-to-edit-missing');
      }
      setPrompts((current) => current.map((prompt) => prompt.id === promptEditor.id
        ? { ...prompt, name, category: promptEditor.category, content }
        : prompt));
      showFeedback({ kind: 'success', message: formatTemplate(strings.promptSaved, name) });
    }
    setPromptEditor(null);
    setPromptEditorError('');
  };

  const duplicatePrompt = (prompt: Prompt) => {
    const copy = { ...prompt, id: createPromptId(), name: `${prompt.name} ${strings.promptCopySuffix}` };
    setPrompts((current) => [...current, copy]);
    showFeedback({
      kind: 'success',
      message: formatTemplate(strings.promptDuplicated, prompt.name)
    });
  };

  const confirmPromptDeletion = () => {
    if (!promptToDelete) throw new Error('settings-center-prompt-to-delete-missing');
    if (!prompts.some((prompt) => prompt.id === promptToDelete.id)) {
      throw new Error('settings-center-prompt-to-delete-stale');
    }
    setPrompts((current) => current.filter((prompt) => prompt.id !== promptToDelete.id));
    showFeedback({
      kind: 'success',
      message: formatTemplate(strings.promptDeleted, promptToDelete.name)
    });
    setPromptToDelete(null);
  };

  const importPrompts = async (file: File | null) => {
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error(strings.promptImportJsonOnly);
      const value: unknown = JSON.parse(await file.text());
      if (!Array.isArray(value)) throw new Error(strings.promptImportMustBeArray);
      const imported = value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(strings.promptImportInvalidItem);
        }
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.name !== 'string' || !candidate.name.trim()
          || typeof candidate.content !== 'string' || !candidate.content.trim()
          || typeof candidate.category !== 'string'
          || !['writing', 'polish', 'summary', 'translation', 'custom'].includes(candidate.category)) {
          throw new Error(strings.promptImportInvalidItem);
        }
        return {
          id: createPromptId(),
          name: candidate.name.trim(),
          category: candidate.category as PromptCategory,
          content: candidate.content.trim()
        };
      });
      if (imported.length === 0) throw new Error(strings.promptImportEmpty);
      setPrompts((current) => [...current, ...imported]);
      selectCategory('all');
      showFeedback({
        kind: 'success',
        message: formatTemplate(strings.promptImportSuccess, imported.length)
      });
    } catch (error) {
      showFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : strings.promptImportUnknownError
      });
    } finally {
      if (promptImportRef.current) promptImportRef.current.value = '';
    }
  };

  const selectOptions = (values: ReadonlyArray<string>) => values.map((value) => ({
    label: value,
    value
  }));

  return <div className="easymde-settings-center__ai-page">
    <div className="easymde-settings-center__ai-primary-groups">
      <section className="easymde-settings-center__ai-group is-service">
        <h2><AiSparkIcon size={25} />{strings.aiServiceConfiguration}</h2>
        <AiField label={strings.aiProvider}>
          <CompactSelect label={strings.aiProvider} value={settings.provider}
            options={selectOptions([strings.openAi, strings.azureOpenAi, strings.anthropic, strings.customAiService])}
            onChange={(value) => setValue('provider', value)} />
        </AiField>
        <AiField label={strings.aiEndpoint}>
          <input className="easymde-settings-center__ai-input" aria-label={strings.aiEndpoint}
            value={settings.endpoint} onChange={(event) => setValue('endpoint', event.target.value)} />
        </AiField>
        <AiField label={strings.apiKey}>
          <SecretInput label={strings.aiApiKey} value={settings.apiKey}
            showLabel={strings.showAiApiKey} hideLabel={strings.hideAiApiKey}
            onChange={(value) => setValue('apiKey', value)} />
        </AiField>
        <AiField label={strings.defaultModel}>
          <CompactSelect label={strings.defaultModel} value={settings.model}
            options={selectOptions(['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'o4-mini'])}
            onChange={(value) => setValue('model', value)} />
        </AiField>
        <div className="easymde-settings-center__ai-connection-divider">
          <SettingsRow label={strings.aiConnectionStatus} minHeight={70}>
            <div className="easymde-settings-center__connection-row">
              <span className="easymde-settings-center__connection-status"
                data-state={testingConnection ? 'testing' : 'connected'}>
                <span />{testingConnection ? strings.testing : strings.connected}
              </span>
              <button type="button" disabled={testingConnection} onClick={testConnection}>
                {testingConnection ? <RefreshCcw className="easymde-settings-center__connection-spinner" size={15} /> : null}
                {strings.testConnection}
              </button>
            </div>
          </SettingsRow>
        </div>
      </section>

      <section className="easymde-settings-center__ai-group is-autocomplete">
        <div className="easymde-settings-center__ai-heading-row">
          <div><h2><KeyboardIcon size={25} />{strings.aiAutocomplete}</h2>
            <p>{strings.aiAutocompleteDescription}</p></div>
          <button type="button" onClick={restoreAutocompleteDefaults}
            className="easymde-settings-center__ai-outline-button">
            <RotateCcw size={16} />{strings.restoreAutocompleteDefaults}
          </button>
        </div>
        <AiBehaviorRow label={strings.enableAiAutocomplete} description={strings.enableAiAutocompleteDescription}>
          <SettingsToggle label={strings.enableAiAutocomplete} checked={settings.autoComplete}
            onChange={() => setValue('autoComplete', !settings.autoComplete)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.completionTrigger} description={strings.completionTriggerDescription}>
          <CompactSelect label={strings.completionTrigger} value={settings.completionTrigger}
            options={selectOptions([strings.completionTriggerTab, strings.completionTriggerShortcut, strings.completionTriggerAuto])}
            onChange={(value) => setValue('completionTrigger', value)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.completionTiming} description={strings.completionTimingDescription}>
          <CompactSelect label={strings.completionTiming} value={settings.completionTiming}
            options={selectOptions([strings.completionTimingRealtime, strings.completionTimingPause, strings.completionTimingManual])}
            onChange={(value) => setValue('completionTiming', value)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.minimumTriggerChars} description={strings.minimumTriggerCharsDescription}>
          <CompactSelect label={strings.minimumTriggerChars} value={settings.minimumTriggerChars}
            options={selectOptions(['1', '2', '3', '5'])}
            onChange={(value) => setValue('minimumTriggerChars', value)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.suggestionCount} description={strings.suggestionCountDescription}>
          <CompactSelect label={strings.suggestionCount} value={settings.suggestionCount}
            options={selectOptions(['1', '2', '3', '5'])}
            onChange={(value) => setValue('suggestionCount', value)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.contextLines} description={strings.contextLinesDescription}>
          <CompactSelect label={strings.contextLines} value={settings.contextLines}
            options={selectOptions(['10', '20', '30', '50'])}
            onChange={(value) => setValue('contextLines', value)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.displayPosition} description={strings.displayPositionDescription}>
          <CompactSelect label={strings.displayPosition} value={settings.displayPosition}
            options={selectOptions([strings.displayPositionBelow, strings.displayPositionInline, strings.displayPositionSide])}
            onChange={(value) => setValue('displayPosition', value)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.autoInsertSingle} description={strings.autoInsertSingleDescription}>
          <SettingsToggle label={strings.autoInsertSingle} checked={settings.autoInsertSingle}
            onChange={() => setValue('autoInsertSingle', !settings.autoInsertSingle)} />
        </AiBehaviorRow>
        <AiBehaviorRow label={strings.completeCodeBlocks} description={strings.completeCodeBlocksDescription}>
          <SettingsToggle label={strings.completeCodeBlocks} checked={settings.completeCodeBlocks}
            onChange={() => setValue('completeCodeBlocks', !settings.completeCodeBlocks)} />
        </AiBehaviorRow>
      </section>

      <div className="easymde-settings-center__ai-secondary-groups">
        <section className="easymde-settings-center__ai-group">
          <h2><WandSparkles size={25} />{strings.writingAssistance}</h2>
          {([
            ['assistantSidebar', strings.assistantSidebar, strings.assistantSidebarDescription],
            ['titleOptimization', strings.titleOptimization, strings.titleOptimizationDescription],
            ['summaryGeneration', strings.summaryGeneration, strings.summaryGenerationDescription],
            ['tonePolish', strings.tonePolish, strings.tonePolishDescription],
            ['outlineGeneration', strings.outlineGeneration, strings.outlineGenerationDescription],
            ['continuationSuggestions', strings.continuationSuggestions, strings.continuationSuggestionsDescription]
          ] as const).map(([key, label, description]) => <AiBehaviorRow key={key} label={label} description={description}>
            <SettingsToggle label={label} checked={settings[key]}
              onChange={() => setValue(key, !settings[key])} />
          </AiBehaviorRow>)}
        </section>
        <section className="easymde-settings-center__ai-group is-generation">
          <h2><SlidersIcon size={25} />{strings.generationPreferences}</h2>
          <AiBehaviorRow label={strings.thinkingDepth}>
            <div className="easymde-settings-center__thinking-depth">
              {[strings.thinkingDepthOff, strings.thinkingDepthStandard, strings.thinkingDepthDeep]
                .map((depth) => <button type="button" key={depth}
                  aria-pressed={settings.thinkingDepth === depth}
                  onClick={() => setValue('thinkingDepth', depth)}>{depth}</button>)}
            </div>
          </AiBehaviorRow>
          <AiBehaviorRow label={strings.writingTone}>
            <CompactSelect label={strings.writingTone} value={settings.writingTone}
              options={selectOptions([strings.writingToneGeneral, strings.writingToneProfessional,
                strings.writingToneRelaxed, strings.writingToneConcise])}
              onChange={(value) => setValue('writingTone', value)} />
          </AiBehaviorRow>
          <AiBehaviorRow label={strings.outputLanguage}>
            <CompactSelect label={strings.outputLanguage} value={settings.outputLanguage}
              options={selectOptions([strings.simplifiedChinese, strings.traditionalChinese, strings.english])}
              onChange={(value) => setValue('outputLanguage', value)} />
          </AiBehaviorRow>
          {([
            ['includeContext', strings.includeContext],
            ['readMetadata', strings.readMetadata],
            ['saveLastPrompt', strings.saveLastPrompt]
          ] as const).map(([key, label]) => <AiBehaviorRow key={key} label={label}>
            <SettingsToggle label={label} checked={settings[key]}
              onChange={() => setValue(key, !settings[key])} />
          </AiBehaviorRow>)}
        </section>
      </div>
    </div>

    <section className="easymde-settings-center__ai-group is-prompts">
      <div className="easymde-settings-center__prompt-heading-row">
        <div><div><MessageSquare size={25} /><h2>{strings.promptManagement}</h2></div>
          <p>{strings.promptManagementDescription}</p></div>
        <div className="easymde-settings-center__prompt-heading-actions">
          <input ref={promptImportRef} type="file" accept=".json,application/json"
            onChange={(event) => void importPrompts(event.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => promptImportRef.current?.click()}>{strings.importPrompts}</button>
          <button type="button" onClick={openPromptCreator}><Plus size={17} />{strings.createPrompt}</button>
        </div>
      </div>
      <div className="easymde-settings-center__prompt-tabs">
        {categories.map((category) => <button type="button" key={category.id}
          aria-pressed={promptCategory === category.id}
          onClick={() => selectCategory(category.id)}>{category.label}</button>)}
      </div>
      <div className="easymde-settings-center__prompt-columns">
        <span>{strings.promptNameHeader}</span><span>{strings.promptContentPreview}</span>
        <span>{strings.actions}</span>
      </div>
      <div className="easymde-settings-center__prompt-table">
        {pagePrompts.length ? pagePrompts.map((prompt) => <div key={prompt.id}
          className="easymde-settings-center__prompt-row">
          <span>{prompt.name}</span><span>{prompt.content}</span>
          <div>
            <button type="button" aria-label={formatTemplate(strings.editPrompt, prompt.name)}
              onClick={() => { setPromptEditor({ mode: 'edit', ...prompt }); setPromptEditorError(''); }}>
              <Pencil size={18} />
            </button>
            <button type="button" aria-label={formatTemplate(strings.duplicatePrompt, prompt.name)}
              onClick={() => duplicatePrompt(prompt)}><Copy size={18} /></button>
            <button type="button" aria-label={formatTemplate(strings.deletePrompt, prompt.name)}
              onClick={() => setPromptToDelete(prompt)}><Trash2 size={18} /></button>
          </div>
        </div>) : <div role="status" className="easymde-settings-center__prompt-empty">
          {formatTemplate(
            strings.promptCategoryEmpty,
            categories.find((item) => item.id === promptCategory)?.label ?? ''
          )}
        </div>}
      </div>
      <div className="easymde-settings-center__prompt-pagination">
        <span>{formatPaginationSummary(
          strings.promptPaginationSummary,
          filteredPrompts.length,
          effectivePage,
          totalPages
        )}</span>
        <div>
          <button type="button" aria-label={strings.previousPromptPage} disabled={effectivePage === 1}
            onClick={() => changePage(effectivePage - 1)}><ChevronRight size={16} /></button>
          <button type="button" aria-current="page" onClick={() => changePage(effectivePage)}>{effectivePage}</button>
          <button type="button" aria-label={strings.nextPromptPage} disabled={effectivePage === totalPages}
            onClick={() => changePage(effectivePage + 1)}><ChevronRight size={16} /></button>
          <div>
            <CompactSelect height={34} label={strings.promptPageSize} value={String(promptPageSize)}
              options={[
                { value: '10', label: strings.promptItemsPerPage10 },
                { value: '20', label: strings.promptItemsPerPage20 },
                { value: '50', label: strings.promptItemsPerPage50 }
              ]} onChange={(value) => {
                const size = Number(value);
                if (![10, 20, 50].includes(size)) throw new Error('settings-center-prompt-page-size-invalid');
                setPromptPageSize(size); selectCategory(promptCategory);
              }} />
          </div>
          <span>{strings.jumpTo}</span>
          <input type="number" min={1} max={totalPages} value={promptPageInput}
            onChange={(event) => setPromptPageInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') jumpToPage(); }}
            aria-label={strings.jumpToPromptPage} />
          <button type="button" onClick={jumpToPage}>{strings.jump}</button>
        </div>
      </div>
    </section>

    {overlayRoot ? createPortal(<Fragment>
      {promptFeedback ? <PromptFeedback feedback={promptFeedback} strings={strings}
        onClose={() => setPromptFeedback(null)} /> : null}
      {connectionFeedback ? <PromptFeedback feedback={connectionFeedback} strings={strings}
        onClose={() => setConnectionFeedback(null)} /> : null}
      {promptEditor ? <PromptEditorDialog editor={promptEditor} error={promptEditorError}
        strings={strings} onChange={(nextEditor) => { setPromptEditor(nextEditor); setPromptEditorError(''); }}
        onSave={savePrompt} onCancel={() => { setPromptEditor(null); setPromptEditorError(''); }} /> : null}
      {promptToDelete ? <DeletePromptDialog prompt={promptToDelete} strings={strings}
        onCancel={() => setPromptToDelete(null)} onConfirm={confirmPromptDeletion} /> : null}
    </Fragment>, overlayRoot) : null}
  </div>;
}
