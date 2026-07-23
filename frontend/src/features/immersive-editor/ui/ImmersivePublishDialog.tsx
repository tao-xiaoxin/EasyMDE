import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Check,
  Eye,
  FileText,
  Hash,
  Image,
  ListChecks,
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

function CategoryTree({
  categories,
  disabled,
  selected,
  onToggle
}: Readonly<{
  categories: ReadonlyArray<NativePublishCategory>;
  disabled: boolean;
  selected: ReadonlySet<string>;
  onToggle: (ids: ReadonlyArray<string>, checked: boolean) => void;
}>) {
  const render = (category: NativePublishCategory, depth: number) => {
    const checked = selected.has(category.id);
    return (
      <li key={category.id}>
        <label style={{ '--easymde-category-depth': depth } as React.CSSProperties}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle([category.id], !checked)}
          />
          <span className="easymde-publish-checkbox" aria-hidden="true">
            {checked ? <Check size={10} strokeWidth={3.2} /> : null}
          </span>
          <span>{category.label}</span>
        </label>
        {category.children.length ? (
          <ul>{category.children.map((child) => render(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };
  return <ul className="easymde-publish-categories">{categories.map((item) => render(item, 0))}</ul>;
}

function FeaturedPlaceholder() {
  return (
    <span className="easymde-publish-featured-placeholder" aria-hidden="true">
      <span className="is-back" />
      <span className="is-middle" />
      <span className="is-front"><Image size={42} strokeWidth={1.5} /></span>
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
    setSubmitting(true);
    if (!onConfirm(draft, snapshot)) setSubmitting(false);
  };
  const submitLabel = snapshot.published ? strings.updateArticle : strings.publish;

  return (
    <div className="easymde-publish-backdrop">
      <section
        ref={dialogRef}
        className="easymde-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="easymde-publish-dialog-title"
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
          <button
            ref={closeRef}
            type="button"
            className="easymde-publish-dialog-close"
            aria-label={strings.closePublish}
            title={strings.close}
            disabled={submitting}
            onClick={onClose}
          ><X size={14} strokeWidth={2.2} /></button>
          <div className="easymde-publish-heading-icon"><SquarePen size={20} strokeWidth={2} /></div>
          <div>
            <div className="easymde-publish-title-row">
              <h2 id="easymde-publish-dialog-title">{submitLabel}</h2>
              <span>{snapshot.published ? strings.updateExisting : strings.preparingPublish}</span>
            </div>
            <p>{snapshot.published ? strings.updateDescription : strings.publishDescription}</p>
          </div>
        </header>

        <div className="easymde-publish-dialog-divider" aria-hidden="true" />

        <div className="easymde-publish-dialog-body">
          <div className="easymde-publish-dialog-primary">
            <section className="easymde-publish-field">
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
            </section>

            <section className="easymde-publish-field">
              <div className="easymde-publish-field-heading"><h3><FileText size={15} strokeWidth={2.2} />{strings.excerpt}</h3><span>{draft.excerpt.length} / 160</span></div>
              <textarea value={draft.excerpt} disabled={submitting} maxLength={160} placeholder={strings.excerptPlaceholder} onChange={(event) => update({ excerpt: event.currentTarget.value })} />
            </section>

            <section className="easymde-publish-field">
              <div className="easymde-publish-field-heading"><h3><ListChecks size={15} strokeWidth={2.2} />{strings.categories}</h3><span className="is-count">{format(strings.categoriesSelected, draft.categoryIds.length)}</span></div>
              <p>{strings.categoriesDescription}</p>
              <div className="easymde-publish-category-box">
                <CategoryTree
                  categories={snapshot.categories}
                  disabled={submitting}
                  selected={new Set(draft.categoryIds)}
                  onToggle={(ids, checked) => {
                    const selected = new Set(draft.categoryIds);
                    for (const id of ids) checked ? selected.add(id) : selected.delete(id);
                    update({ categoryIds: [...selected] });
                  }}
                />
              </div>
            </section>
          </div>

          <aside className="easymde-publish-dialog-aside">
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

            <section className="easymde-publish-visibility">
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
              {'public' === draft.visibility ? (
                <label className="easymde-publish-sticky">
                  <input type="checkbox" checked={draft.sticky} disabled={submitting} onChange={(event) => update({ sticky: event.currentTarget.checked })} />
                  <span aria-hidden="true">{draft.sticky ? <Check size={10} strokeWidth={3.2} /> : null}</span>{strings.sticky}
                </label>
              ) : null}
              {'password' === draft.visibility ? (
                <div className="easymde-publish-password">
                  <label htmlFor="easymde-publish-password">{strings.password}</label>
                  <input ref={passwordRef} id="easymde-publish-password" type="password" value={draft.password} aria-invalid={passwordError || undefined} aria-describedby={passwordError ? 'easymde-publish-password-error' : undefined} disabled={submitting} placeholder={strings.passwordPlaceholder} onChange={(event) => { update({ password: event.currentTarget.value }); if (event.currentTarget.value.trim()) setPasswordError(false); }} />
                  {passwordError ? <p id="easymde-publish-password-error" role="alert">{strings.passwordRequired}</p> : null}
                </div>
              ) : null}
              {'private' === draft.visibility ? <p className="easymde-publish-private-note">{strings.privateDescription}</p> : null}
            </section>
          </aside>
        </div>

        <div className="easymde-publish-dialog-divider" aria-hidden="true" />

        <footer className="easymde-publish-dialog-footer">
          <p><span><ShieldCheck size={12} strokeWidth={2.2} /></span>{strings.noWriteBeforeSubmit}</p>
          <div>
            <button type="button" disabled={submitting} onClick={onClose}>{strings.cancel}</button>
            <button type="button" className="is-primary" disabled={submitting || mediaPending} onClick={submit}>{submitLabel}<span aria-hidden="true">✦</span></button>
          </div>
        </footer>
      </section>
    </div>
  );
}
