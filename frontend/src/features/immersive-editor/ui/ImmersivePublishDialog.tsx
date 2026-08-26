import { Fragment, createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type {
  NativeFeaturedImage,
  NativePublishCategory,
  NativePublishDraft,
  NativePublishSnapshot,
  NativePublishVisibility
} from '../../../contracts/ports/native-publish-port';
import type { GeneralSettings } from '../../../contracts/settings-center-settings';
import {
  CalendarCheck,
  Check,
  Eye,
  FileText,
  Hash,
  ListChecks,
  Minus,
  ShieldCheck,
  SquarePen,
  Trash2,
  X
} from '../../../generated/lucide-icons';
import { derivePublishExcerpt } from '../immersive-editor';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

const PUBLISH_EXCERPT_LIMIT = 160;

type PublishDefaults = Pick<
  GeneralSettings,
  'openPreviewAfterPublish' | 'publishVisibility' | 'summaryMode'
>;

function format(template: string, value: string | number): string {
  return template.replace('%s', String(value)).replace('%d', String(value));
}

function normalizeTag(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function excerptCodePoints(value: string): ReadonlyArray<string> {
  return Array.from(value);
}

function cloneDraft(
  snapshot: NativePublishSnapshot,
  defaults: PublishDefaults,
  markdown: string
): NativePublishDraft {
  const generatedExcerpt = snapshot.availableFields.excerpt
    ? derivePublishExcerpt(markdown, defaults.summaryMode)
    : null;
  return {
    categoryIds: [...snapshot.categoryIds],
    excerpt: generatedExcerpt ?? snapshot.excerpt,
    featuredImage: snapshot.featuredImage ? { ...snapshot.featuredImage } : null,
    openPreview: defaults.openPreviewAfterPublish,
    password: snapshot.password,
    sticky: snapshot.sticky,
    tags: [...snapshot.tags],
    visibility: snapshot.existing
      ? snapshot.visibility
      : defaults.publishVisibility as NativePublishVisibility
  };
}

function focusable(root: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden);
}

function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if ('Tab' !== event.key) return;
  const items = focusable(event.currentTarget);
  const first = items[0];
  const last = items[items.length - 1];
  const active = event.currentTarget.ownerDocument.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

function CategoryCheckbox({
  category,
  checked,
  disabled,
  indeterminate,
  onChange
}: Readonly<{
  category: NativePublishCategory;
  checked: boolean;
  disabled: boolean;
  indeterminate: boolean;
  onChange: () => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="easymde-publish-checkbox" aria-hidden="true">
        {indeterminate ? (
          <Minus size={11} strokeWidth={3.2} />
        ) : checked ? (
          <Check size={11} strokeWidth={3.2} />
        ) : null}
      </span>
      <span>{category.label}</span>
    </label>
  );
}

function CategoryTree({
  categories,
  collapseLabel,
  disabled,
  expandLabel,
  selected,
  onToggle
}: Readonly<{
  categories: ReadonlyArray<NativePublishCategory>;
  collapseLabel: string;
  disabled: boolean;
  expandLabel: string;
  selected: ReadonlySet<string>;
  onToggle: (ids: ReadonlyArray<string>, checked: boolean) => void;
}>) {
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>(
    {}
  );
  const descendantIds = (
    category: NativePublishCategory
  ): ReadonlyArray<string> =>
    category.children.flatMap((child) => [
      child.id,
      ...descendantIds(child)
    ]);
  const render = (
    category: NativePublishCategory,
    depth: number,
    isLast: boolean,
    ancestors: ReadonlyArray<Readonly<{ id: string; isLast: boolean }>>
  ) => {
    const hasChildren = category.children.length > 0;
    const checked = selected.has(category.id);
    const indeterminate =
      !checked && descendantIds(category).some((id) => selected.has(id));
    const isCollapsed = collapsed[category.id] ?? false;
    const disclosureLabel = `${isCollapsed ? expandLabel : collapseLabel} ${category.label}`;
    const toggleCollapse = () =>
      setCollapsed((current) => ({
        ...current,
        [category.id]: !isCollapsed
      }));
    return (
      <li key={category.id}>
        <div className="easymde-publish-category-row">
          {ancestors.map((ancestor) => (
            <span
              key={`${category.id}-ancestor-${ancestor.id}`}
              className={`easymde-publish-category-ancestor${ancestor.isLast ? ' is-last' : ''}`}
              aria-hidden="true"
            />
          ))}
          {depth > 0 ? (
            <span
              className={`easymde-publish-category-connector${isLast ? ' is-last' : ''}`}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={disclosureLabel}
                  disabled={disabled}
                  onClick={toggleCollapse}
                >
                  <span />
                  {isCollapsed ? <i /> : null}
                </button>
              ) : null}
            </span>
          ) : hasChildren ? (
            <button
              type="button"
              className="easymde-publish-category-root-toggle"
              aria-label={disclosureLabel}
              disabled={disabled}
              onClick={toggleCollapse}
            >
              <span />
              {isCollapsed ? <i /> : null}
            </button>
          ) : (
            <span className="easymde-publish-category-root-spacer" aria-hidden="true" />
          )}
          <CategoryCheckbox
            category={category}
            checked={checked}
            disabled={disabled}
            indeterminate={indeterminate}
            onChange={() => onToggle([category.id], !checked)}
          />
        </div>
        {hasChildren && !isCollapsed ? (
          <ul>
            {category.children.map((child, index) =>
              render(child, depth + 1, index === category.children.length - 1, [
                ...ancestors,
                { id: category.id, isLast }
              ])
            )}
          </ul>
        ) : null}
      </li>
    );
  };
  return (
    <ul className="easymde-publish-categories">
      {categories.map((item, index) =>
        render(item, 0, index === categories.length - 1, [])
      )}
    </ul>
  );
}

function PublishHeaderDecoration() {
  return (
    <span className="easymde-publish-header-decoration">
      <svg className="easymde-publish-header-hills" viewBox="0 0 1120 82" fill="none" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="easymde-header-hill-back" x1="410" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#edf2fb" stopOpacity="0" />
            <stop offset="24%" stopColor="#edf2fb" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#edf2fb" stopOpacity="0.66" />
          </linearGradient>
          <linearGradient id="easymde-header-hill-mid" x1="460" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#e3eaf7" stopOpacity="0" />
            <stop offset="28%" stopColor="#e3eaf7" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#dce5f5" stopOpacity="0.62" />
          </linearGradient>
          <linearGradient id="easymde-header-hill-front" x1="500" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#d5e0f2" stopOpacity="0" />
            <stop offset="30%" stopColor="#d5e0f2" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#cbd9ee" stopOpacity="0.58" />
          </linearGradient>
        </defs>
        <path d="M390 82 C474 80 520 59 592 45 C665 31 718 53 778 55 C849 58 902 30 974 27 C1036 24 1081 38 1120 48 L1120 82Z" fill="url(#easymde-header-hill-back)" />
        <path d="M430 82 C515 81 573 66 650 58 C728 50 793 54 854 61 C918 68 965 45 1022 44 C1065 43 1096 51 1120 57 L1120 82Z" fill="url(#easymde-header-hill-mid)" />
        <path d="M470 82 C578 82 651 75 733 70 C817 65 882 67 940 72 C1005 77 1060 72 1120 68 L1120 82Z" fill="url(#easymde-header-hill-front)" />
      </svg>
      <svg className="easymde-publish-header-sparkle is-large" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 0C12 6.5 13 9.5 15 11.5C17.5 13.5 20 14 24 14C20 14 17.5 14.5 15 16.5C13 18.5 12 21.5 12 28C12 21.5 11 18.5 9 16.5C6.5 14.5 4 14 0 14C4 14 6.5 13.5 9 11.5C11 9.5 12 6.5 12 0Z" />
      </svg>
      <svg className="easymde-publish-header-sparkle is-small" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 0C12 6.5 13 9.5 15 11.5C17.5 13.5 20 14 24 14C20 14 17.5 14.5 15 16.5C13 18.5 12 21.5 12 28C12 21.5 11 18.5 9 16.5C6.5 14.5 4 14 0 14C4 14 6.5 13.5 9 11.5C11 9.5 12 6.5 12 0Z" />
      </svg>
    </span>
  );
}

function PublishButtonSparkles() {
  return (
    <span className="easymde-publish-button-sparkles" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.5c0 6.351 4.65 11.5 11.5 11.5-6.85 0-11.5 5.149-11.5 11.5 0-6.351-4.65-11.5-11.5-11.5C7.35 13 12 7.851 12 1.5z" />
      </svg>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.5c0 6.351 4.65 11.5 11.5 11.5-6.85 0-11.5 5.149-11.5 11.5 0-6.351-4.65-11.5-11.5-11.5C7.35 13 12 7.851 12 1.5z" />
      </svg>
    </span>
  );
}

export function ImmersivePublishDialog({
  defaults,
  environment,
  markdown,
  onClose,
  onConfirm,
  onSelectFeaturedImage,
  snapshot,
  strings
}: Readonly<{
  defaults: PublishDefaults;
  environment: ImmersiveEnvironmentPort;
  markdown: string;
  onClose: () => void;
  onConfirm: (draft: NativePublishDraft, original: NativePublishSnapshot) => boolean;
  onSelectFeaturedImage: () => Promise<NativeFeaturedImage | null>;
  snapshot: NativePublishSnapshot;
  strings: ImmersiveStrings;
}>) {
  const [draft, setDraft] = useState(() =>
    cloneDraft(snapshot, defaults, markdown)
  );
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = environment.activeElement();
    closeRef.current?.focus();
    return () => previous?.focus();
  }, [environment]);

  const update = (patch: Partial<NativePublishDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const addTags = (raw: string) => {
    const incoming = raw.split(/[,，\n]/u).map(normalizeTag).filter(Boolean);
    if (!incoming.length) return;
    const seen = new Set(draft.tags.map((tag) => tag.toLocaleLowerCase()));
    const tags = [...draft.tags];
    for (const tag of incoming) {
      const key = tag.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(tag);
      }
    }
    update({ tags });
    setTagInput('');
  };
  const selectFeaturedImage = () => {
    if (mediaPending) return;
    setMediaPending(true);
    void onSelectFeaturedImage()
      .then((image) => {
        if (image) update({ featuredImage: image });
      })
      .finally(() => setMediaPending(false));
  };
  const changeVisibility = (visibility: NativePublishVisibility) => {
    setPasswordError(false);
    update({
      visibility,
      password: 'password' === visibility ? draft.password : '',
      sticky: 'public' === visibility && draft.sticky
    });
  };
  const submit = () => {
    if ('password' === draft.visibility && !draft.password.trim()) {
      setPasswordError(true);
      passwordRef.current?.focus();
      return;
    }
    setSubmitFailed(false);
    setSubmitting(true);
    if (!onConfirm(draft, snapshot)) {
      setSubmitFailed(true);
      setSubmitting(false);
    }
  };
  const submitLabel = snapshot.existing ? strings.updateArticle : strings.publish;

  return (
    <div className="easymde-publish-backdrop">
      <section
        ref={dialogRef}
        className="easymde-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="easymde-publish-dialog-title"
        aria-busy={submitting}
        onKeyDown={(event) => {
          trapFocus(event);
          if ('Escape' === event.key && !submitting) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="easymde-publish-dialog-header">
          <PublishHeaderDecoration />
          <button
            ref={closeRef}
            type="button"
            className="easymde-publish-dialog-close"
            aria-label={strings.closePublish}
            title={strings.close}
            disabled={submitting}
            onClick={onClose}
          ><X size={14} strokeWidth={2.2} /></button>
          <div className="easymde-publish-heading-icon">
            <SquarePen size={20} strokeWidth={2} />
            <svg
              className="easymde-publish-heading-sparkle"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 1.5c0 6.351 4.65 11.5 11.5 11.5-6.85 0-11.5 5.149-11.5 11.5 0-6.351-4.65-11.5-11.5-11.5C7.35 13 12 7.851 12 1.5z" />
            </svg>
          </div>
          <div>
            <div className="easymde-publish-title-row">
              <h2 id="easymde-publish-dialog-title">{submitLabel}</h2>
              <span>{snapshot.existing ? strings.updateExisting : strings.preparingPublish}</span>
            </div>
            <p>{snapshot.existing ? strings.updateDescription : strings.publishDescription}</p>
          </div>
        </header>

        <div className="easymde-publish-dialog-divider" aria-hidden="true" />

        <div className="easymde-publish-dialog-body">
          <div className="easymde-publish-dialog-primary">
            {snapshot.availableFields.tags ? <section className="easymde-publish-field is-tags">
              <h3><Hash size={15} strokeWidth={2.2} />{strings.tags}</h3>
              <p>{strings.tagsDescription}</p>
              <div className="easymde-publish-tags-input">
                {draft.tags.map((tag) => (
                  <span key={tag}>{tag}<button type="button" disabled={submitting} aria-label={format(strings.removeTag, tag)} onClick={() => update({ tags: draft.tags.filter((item) => item !== tag) })}><X size={10} strokeWidth={2.4} /></button></span>
                ))}
                <input
                  value={tagInput}
                  disabled={submitting}
                  aria-label={strings.addTags}
                  placeholder={draft.tags.length ? strings.continueAddingTags : strings.addTags}
                  onChange={(event) => setTagInput(event.currentTarget.value)}
                  onBlur={() => addTags(tagInput)}
                  onKeyDown={(event) => {
                    if (['Enter', ',', '，'].includes(event.key)) {
                      event.preventDefault();
                      addTags(tagInput);
                    } else if ('Backspace' === event.key && !tagInput && draft.tags.length) {
                      update({ tags: draft.tags.slice(0, -1) });
                    }
                  }}
                />
              </div>
            </section> : null}

            {snapshot.availableFields.excerpt ? <section className="easymde-publish-field is-excerpt">
              <div className="easymde-publish-field-heading"><h3><FileText size={15} strokeWidth={2.2} />{strings.excerpt}</h3><span>{excerptCodePoints(draft.excerpt).length} / {PUBLISH_EXCERPT_LIMIT}</span></div>
              <textarea value={draft.excerpt} disabled={submitting} placeholder={strings.excerptPlaceholder} onChange={(event) => update({ excerpt: excerptCodePoints(event.currentTarget.value).slice(0, PUBLISH_EXCERPT_LIMIT).join('') })} />
            </section> : null}

            {snapshot.availableFields.categories ? <section className="easymde-publish-field is-categories">
              <div className="easymde-publish-field-heading"><h3><ListChecks size={15} strokeWidth={2.2} />{strings.categories}</h3><span className="is-count">{format(strings.categoriesSelected, draft.categoryIds.length)}</span></div>
              <p>{strings.categoriesDescription}</p>
              <div className="easymde-publish-category-box">
                <CategoryTree
                  categories={snapshot.categories}
                  collapseLabel={strings.collapse}
                  disabled={submitting}
                  expandLabel={strings.expand}
                  selected={new Set(draft.categoryIds)}
                  onToggle={(ids, checked) => {
                    const selected = new Set(draft.categoryIds);
                    for (const id of ids) checked ? selected.add(id) : selected.delete(id);
                    update({ categoryIds: [...selected] });
                  }}
                />
              </div>
            </section> : null}
          </div>

          <aside className="easymde-publish-dialog-aside">
            {snapshot.availableFields.featuredImage ? <Fragment>
              <h3>{strings.featuredImage}</h3>
            {draft.featuredImage ? (
              <div className="easymde-publish-featured-selected">
                <div><img src={draft.featuredImage.url} alt={draft.featuredImage.alt} /></div>
                <footer><button type="button" disabled={submitting || mediaPending} onClick={selectFeaturedImage}>{strings.replace}</button><button type="button" disabled={submitting} onClick={() => update({ featuredImage: null })}><Trash2 size={12} />{strings.remove}</button></footer>
              </div>
            ) : (
              <button type="button" className="easymde-publish-featured-empty" disabled={submitting || mediaPending} onClick={selectFeaturedImage}>
                <strong>{strings.selectFeaturedImage}</strong>
                <span>{strings.imageRecommendation}</span>
                <small>{strings.imageRequirements}</small>
              </button>
            )}
            </Fragment> : null}

            {snapshot.availableFields.visibility ? <section className="easymde-publish-visibility">
              <h3><Eye size={16} strokeWidth={2} />{strings.visibility}</h3>
              <div role="radiogroup" aria-label={strings.visibility}>
                {([
                  ['public', strings.public],
                  ['password', strings.password],
                  ['private', strings.private]
                ] as const).map(([value, label]) => (
                  <label key={value} className={draft.visibility === value ? 'is-active' : ''}>
                    <input type="radio" name="easymde-publish-visibility" value={value} checked={draft.visibility === value} disabled={submitting} onChange={() => changeVisibility(value)} />
                    <span aria-hidden="true"><i /></span>{label}
                  </label>
                ))}
              </div>
              {'public' === draft.visibility && snapshot.availableFields.sticky ? (
                <label className="easymde-publish-sticky">
                  <input type="checkbox" checked={draft.sticky} disabled={submitting} onChange={(event) => update({ sticky: event.currentTarget.checked })} />
                  <span aria-hidden="true">{draft.sticky ? <Check size={10} strokeWidth={3.2} /> : null}</span>{strings.sticky}
                </label>
              ) : null}
              {'password' === draft.visibility ? (
                <div className="easymde-publish-password">
                  <label htmlFor="easymde-publish-password">{strings.password}</label>
                  <input ref={passwordRef} id="easymde-publish-password" type="password" value={draft.password} maxLength={255} aria-invalid={passwordError || undefined} aria-describedby={passwordError ? 'easymde-publish-password-error' : undefined} disabled={submitting} placeholder={strings.passwordPlaceholder} onChange={(event) => { update({ password: event.currentTarget.value }); if (event.currentTarget.value.trim()) setPasswordError(false); }} />
                  {passwordError ? <p id="easymde-publish-password-error" role="alert">{strings.passwordRequired}</p> : null}
                </div>
              ) : null}
              {'private' === draft.visibility ? <p className="easymde-publish-private-note">{strings.privateDescription}</p> : null}
            </section> : null}

            <section className="easymde-publish-options">
              <h3><CalendarCheck size={16} strokeWidth={2} />{strings.publishOptions}</h3>
              <label>
                <span>
                  <strong>{snapshot.existing ? strings.openAfterUpdate : strings.openAfterPublish}</strong>
                  <small>{strings.openAfterPublishDescription}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.openPreview}
                  disabled={submitting}
                  aria-checked={draft.openPreview}
                  aria-label={snapshot.existing ? strings.openAfterUpdate : strings.openAfterPublish}
                  onChange={(event) => update({ openPreview: event.currentTarget.checked })}
                />
                <span className="easymde-publish-switch" aria-hidden="true">
                  <i>{draft.openPreview ? <Check size={11} strokeWidth={3.4} /> : null}</i>
                </span>
              </label>
            </section>
          </aside>
        </div>

        <div className="easymde-publish-dialog-divider" aria-hidden="true" />

        <footer className="easymde-publish-dialog-footer">
          {submitFailed ? (
            <p className="is-error" role="alert">{strings.publishFailed}</p>
          ) : (
            <p><span><ShieldCheck size={12} strokeWidth={2.2} /></span>{strings.noWriteBeforeSubmit}</p>
          )}
          <div className="easymde-publish-progress" aria-live="polite">
            {submitting ? (
              <span>
                <span className="easymde-publish-progress-spinner" aria-hidden="true" />
                {strings.publishLoadingPreview}
              </span>
            ) : null}
          </div>
          <div className="easymde-publish-footer-actions">
            <button type="button" disabled={submitting} onClick={onClose}>{strings.cancel}</button>
            <button type="button" className="is-primary" disabled={submitting || mediaPending} onClick={submit}>
              {submitLabel}
              <PublishButtonSparkles />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
