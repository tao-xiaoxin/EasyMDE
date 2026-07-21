import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { ChangeEvent, CSSProperties, KeyboardEvent } from 'react';

import type { PublishingBootstrap } from '../../../contracts/bootstrap/publishing-bootstrap';
import type {
  PublishingDraft,
  PublishingPort,
  PublishingSchedule,
  PublishingVisibility
} from '../../../contracts/ports/publishing-port';
import {
  createPublishingDraft,
  orderPublishingCategories,
  updatePublishingVisibility,
  validatePublishingDraft
} from '../publish-draft';

export type PublishingControlsSession = Readonly<{ close: (restoreFocus?: boolean) => void }>;

type PublishingControlsProps = Readonly<{
  bootstrap: PublishingBootstrap;
  onDiagnostic: (code: string) => void;
  onOpen: () => void;
  onReady?: (session: PublishingControlsSession) => void;
  port: PublishingPort;
}>;

function failureCode(error: unknown): string {
  return error instanceof Error && /^publishing-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : 'publishing-operation-failed';
}

function scheduleDate(value: PublishingSchedule | null): string {
  return value
    ? `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
    : '';
}

function scheduleTime(value: PublishingSchedule | null): string {
  return value
    ? `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`
    : '';
}

function updateSchedule(
  current: PublishingSchedule | null,
  date: string,
  time: string
): PublishingSchedule | null {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return current;
  return {
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    month: Number(dateMatch[2]),
    year: Number(dateMatch[1])
  };
}

export function PublishingControls({
  bootstrap,
  onDiagnostic,
  onOpen,
  onReady,
  port
}: PublishingControlsProps) {
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(true);
  const selectionGenerationRef = useRef(0);
  const [draft, setDraft] = useState<PublishingDraft | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<PublishingPort['read']> | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const close = useCallback((restoreFocus = true) => {
    selectionGenerationRef.current += 1;
    setOpen(false);
    setPending(false);
    setError('');
    if (restoreFocus) openerRef.current?.focus();
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const session = { close };
    onReady?.(session);
    return () => {
      activeRef.current = false;
      selectionGenerationRef.current += 1;
    };
  }, [close, onReady]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const openDialog = () => {
    try {
      const nextSnapshot = port.read();
      setSnapshot(nextSnapshot);
      setDraft(createPublishingDraft(nextSnapshot));
      setPending(false);
      setError('');
      setOpen(true);
      onOpen();
    } catch (caught) {
      onDiagnostic(failureCode(caught));
      setError(bootstrap.strings.submitFailed);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ('Escape' === event.key && !pending) {
      event.preventDefault();
      close();
      return;
    }
    if ('Tab' !== event.key) return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
    ) ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = (action: 'primary' | 'save-draft') => {
    if (!draft || !snapshot || pending) return;
    const validation = validatePublishingDraft(draft, snapshot.statusOptions);
    if (validation) {
      setError('publishing-password-required' === validation
        ? bootstrap.strings.passwordRequired
        : bootstrap.strings.submitFailed);
      onDiagnostic(validation);
      return;
    }
    setPending(true);
    setError('');
    try {
      port.requestSubmit(draft, action);
    } catch (caught) {
      setPending(false);
      setError(bootstrap.strings.submitFailed);
      onDiagnostic(failureCode(caught));
    }
  };

  const selectFeaturedImage = async () => {
    const generation = ++selectionGenerationRef.current;
    try {
      const image = await port.selectFeaturedImage();
      if (activeRef.current && open && generation === selectionGenerationRef.current && image) {
        setDraft((current) => current ? { ...current, featuredImage: image } : current);
      }
    } catch (caught) {
      if (activeRef.current && open && generation === selectionGenerationRef.current) {
        setError(bootstrap.strings.submitFailed);
        onDiagnostic(failureCode(caught));
      }
    }
  };

  const categories = useMemo(
    () => orderPublishingCategories(bootstrap.categoryOptions),
    [bootstrap.categoryOptions]
  );

  return (
    <div className="easymde-publishing-owner">
      <button
        ref={openerRef}
        type="button"
        className="button button-primary easymde-publishing-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openDialog}
      >
        {bootstrap.strings.open}
      </button>
      {!open && error ? (
        <span className="easymde-publishing-inline-error" role="alert">{error}</span>
      ) : null}
      {open && draft && snapshot ? (
        <div className="easymde-publishing-backdrop">
          <div
            ref={dialogRef}
            className="easymde-publishing-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={pending}
            aria-labelledby="easymde-publishing-title"
            aria-describedby={error ? 'easymde-publishing-error' : undefined}
            onKeyDown={handleDialogKeyDown}
          >
            <header>
              <h2 id="easymde-publishing-title">{bootstrap.strings.title}</h2>
              <button
                ref={closeRef}
                type="button"
                className="easymde-publishing-close"
                aria-label={bootstrap.strings.close}
                disabled={pending}
                onClick={() => close()}
              >
                <span className="dashicons dashicons-no-alt" aria-hidden="true" />
              </button>
            </header>
            <div className="easymde-publishing-fields">
              <label>
                <span>{bootstrap.strings.status}</span>
                <select
                  value={draft.status}
                  disabled={pending}
                  onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value })}
                >
                  {snapshot.statusOptions.map((option) => (
                    <option key={option.id} value={option.id} disabled={option.disabled}>{option.label}</option>
                  ))}
                </select>
              </label>
              {draft.capabilities.visibility ? (
                <fieldset>
                  <legend>{bootstrap.strings.visibility}</legend>
                  {([
                    ['public', bootstrap.strings.publicVisibility],
                    ['password', bootstrap.strings.passwordVisibility],
                    ['private', bootstrap.strings.privateVisibility]
                  ] as const).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="easymde-publishing-visibility"
                        value={value}
                        checked={draft.visibility === value}
                        disabled={pending}
                        onChange={() => setDraft(updatePublishingVisibility(draft, value as PublishingVisibility))}
                      />
                      {label}
                    </label>
                  ))}
                  {'password' === draft.visibility ? (
                    <label>
                      <span>{bootstrap.strings.password}</span>
                      <input
                        type="text"
                        value={draft.password}
                        disabled={pending}
                        onChange={(event) => setDraft({ ...draft, password: event.currentTarget.value })}
                      />
                    </label>
                  ) : null}
                  {'public' === draft.visibility && draft.capabilities.sticky ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.sticky}
                        disabled={pending}
                        onChange={(event) => setDraft({ ...draft, sticky: event.currentTarget.checked })}
                      />
                      {bootstrap.strings.sticky}
                    </label>
                  ) : null}
                </fieldset>
              ) : null}
              {draft.capabilities.schedule && draft.schedule ? (
                <fieldset>
                  <legend>{bootstrap.strings.schedule}</legend>
                  <input
                    type="date"
                    aria-label={bootstrap.strings.schedule}
                    value={scheduleDate(draft.schedule)}
                    disabled={pending}
                    onChange={(event) => setDraft({
                      ...draft,
                      schedule: updateSchedule(draft.schedule, event.currentTarget.value, scheduleTime(draft.schedule))
                    })}
                  />
                  <input
                    type="time"
                    aria-label={`${bootstrap.strings.schedule} ${bootstrap.timeZone}`}
                    value={scheduleTime(draft.schedule)}
                    disabled={pending}
                    onChange={(event) => setDraft({
                      ...draft,
                      schedule: updateSchedule(draft.schedule, scheduleDate(draft.schedule), event.currentTarget.value)
                    })}
                  />
                </fieldset>
              ) : null}
              {draft.capabilities.categories && bootstrap.categoryOptions.length ? (
                <fieldset className="easymde-publishing-categories">
                  <legend>{bootstrap.strings.categories}</legend>
                  {categories.map(({ depth, option }) => (
                    <label key={option.id} style={{ '--easymde-category-depth': depth } as CSSProperties}>
                      <input
                        type="checkbox"
                        checked={draft.categories.includes(option.id)}
                        disabled={pending}
                        onChange={(event) => setDraft({
                          ...draft,
                          categories: event.currentTarget.checked
                            ? [...draft.categories, option.id]
                            : draft.categories.filter((id) => id !== option.id)
                        })}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {draft.capabilities.tags ? (
                <label>
                  <span>{bootstrap.strings.tags}</span>
                  <input
                    type="text"
                    value={draft.tags.join(', ')}
                    disabled={pending}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({
                      ...draft,
                      tags: event.currentTarget.value.split(/[,，\n]+/).map((tag) => tag.trim()).filter(Boolean)
                    })}
                  />
                </label>
              ) : null}
              {draft.capabilities.excerpt ? (
                <label>
                  <span>{bootstrap.strings.excerpt}</span>
                  <textarea
                    value={draft.excerpt}
                    disabled={pending}
                    onChange={(event) => setDraft({ ...draft, excerpt: event.currentTarget.value })}
                  />
                </label>
              ) : null}
              {draft.capabilities.featuredImage ? (
                <section className="easymde-publishing-featured">
                  <h3>{bootstrap.strings.featuredImage}</h3>
                  {draft.featuredImage ? (
                    <div>
                      {draft.featuredImage.url ? <img src={draft.featuredImage.url} alt={draft.featuredImage.alt} /> : null}
                      <button type="button" disabled={pending} onClick={() => setDraft({ ...draft, featuredImage: null })}>
                        {bootstrap.strings.removeFeaturedImage}
                      </button>
                    </div>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => void selectFeaturedImage()}>
                    {bootstrap.strings.selectFeaturedImage}
                  </button>
                </section>
              ) : null}
            </div>
            {error ? <p id="easymde-publishing-error" className="easymde-publishing-error" role="alert">{error}</p> : null}
            <footer>
              {snapshot.saveDraftActionLabel ? (
                <button type="button" className="button" disabled={pending} onClick={() => submit('save-draft')}>
                  {snapshot.saveDraftActionLabel}
                </button>
              ) : null}
              <button type="button" className="button button-primary" disabled={pending} onClick={() => submit('primary')}>
                {pending ? bootstrap.strings.submitting : snapshot.primaryActionLabel}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
