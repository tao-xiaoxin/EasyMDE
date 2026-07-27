import { Fragment, createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type {
  NativeFeaturedImage,
  NativePublishCategory,
  NativePublishDraft,
  NativePublishSnapshot,
  NativePublishVisibility
} from '../../../contracts/ports/native-publish-port';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

function format(template: string, value: string | number): string {
  return template.replace('%s', String(value)).replace('%d', String(value));
}

function normalizeTag(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function cloneDraft(snapshot: NativePublishSnapshot): NativePublishDraft {
  return {
    categoryIds: [...snapshot.categoryIds],
    excerpt: snapshot.excerpt,
    featuredImage: snapshot.featuredImage ? { ...snapshot.featuredImage } : null,
    openPreview: true,
    password: snapshot.password,
    sticky: snapshot.sticky,
    tags: [...snapshot.tags],
    visibility: snapshot.visibility
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

function FeaturedPlaceholder() {
  return (
    <svg
      className="easymde-publish-featured-placeholder"
      width="200"
      height="133"
      viewBox="0 0 240 160"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="easymde-featured-image-front-clip">
          <rect x="62" y="30" width="112" height="104" rx="12" />
        </clipPath>
        <linearGradient id="easymde-featured-mountain-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d5e3fc" />
          <stop offset="100%" stopColor="#a9c5f6" />
        </linearGradient>
        <linearGradient id="easymde-featured-mountain-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8c4f5" />
          <stop offset="100%" stopColor="#739eeb" />
        </linearGradient>
        <radialGradient id="easymde-featured-sun" cx="35%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#cfe0ff" />
          <stop offset="100%" stopColor="#7ea9f2" />
        </radialGradient>
        <linearGradient id="easymde-featured-cloud-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f4f7ff" />
        </linearGradient>
        <filter id="easymde-featured-frame-shadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#2563eb" floodOpacity="0.18" />
        </filter>
      </defs>
      <path d="M27 72 C27 82 20 89 10 89 C20 89 27 96 27 106 C27 96 34 89 44 89 C34 89 27 82 27 72 Z" fill="#22df67" transform="translate(27 89) scale(.6) translate(-27 -89)" />
      <circle cx="20" cy="134" r="3.2" fill="#86aef3" />
      <path d="M201 24 C201 34 194 41 184 41 C194 41 201 48 201 58 C201 48 208 41 218 41 C208 41 201 34 201 24 Z" fill="#f5b33f" transform="translate(201 41) scale(.6) translate(-201 -41)" />
      <circle cx="226" cy="83" r="5" stroke="#a9c2ee" strokeWidth="1.7" />
      <rect x="60" y="38" width="108" height="98" rx="11" fill="#ffffff" fillOpacity="0.62" stroke="#b8ccf4" strokeWidth="1.5" transform="rotate(-8 114 87)" />
      <rect x="75" y="23" width="108" height="100" rx="11" fill="#f8fbff" stroke="#a9c2f1" strokeWidth="1.5" transform="rotate(6 129 73)" />
      <g transform="rotate(12 118 82)" filter="url(#easymde-featured-frame-shadow)">
        <rect x="62" y="30" width="112" height="104" rx="12" fill="white" stroke="#2f6bef" strokeWidth="2" />
        <g clipPath="url(#easymde-featured-image-front-clip)">
          <circle cx="91" cy="57" r="9" fill="url(#easymde-featured-sun)" />
          <path d="M64 134 L105 76 L140 134 Z" fill="url(#easymde-featured-mountain-far)" />
          <path d="M92 134 L139 91 L174 134 Z" fill="url(#easymde-featured-mountain-near)" />
        </g>
      </g>
      <g transform="translate(142, 98) scale(4)" filter="url(#easymde-featured-frame-shadow)">
        <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383z" fill="url(#easymde-featured-cloud-fill)" stroke="#2f6bef" strokeWidth="0.7" strokeLinejoin="round" />
        <path d="M8 11 V5.2" stroke="#2f6bef" strokeWidth="0.85" strokeLinecap="round" />
        <path d="M5.6 7.6 L8 5.2 L10.4 7.6" stroke="#2f6bef" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
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
  environment,
  onClose,
  onConfirm,
  onSelectFeaturedImage,
  snapshot,
  strings
}: Readonly<{
  environment: ImmersiveEnvironmentPort;
  onClose: () => void;
  onConfirm: (draft: NativePublishDraft, original: NativePublishSnapshot) => boolean;
  onSelectFeaturedImage: () => Promise<NativeFeaturedImage | null>;
  snapshot: NativePublishSnapshot;
  strings: ImmersiveStrings;
}>) {
  const [draft, setDraft] = useState(() => cloneDraft(snapshot));
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
              <div className="easymde-publish-field-heading"><h3><FileText size={15} strokeWidth={2.2} />{strings.excerpt}</h3><span>{draft.excerpt.length} / 160</span></div>
              <textarea value={draft.excerpt} disabled={submitting} maxLength={160} placeholder={strings.excerptPlaceholder} onChange={(event) => update({ excerpt: event.currentTarget.value })} />
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
                <FeaturedPlaceholder />
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
