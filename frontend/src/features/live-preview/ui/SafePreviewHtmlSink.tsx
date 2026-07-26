import { createElement } from '@wordpress/element';
import type {
  CSSProperties,
  ClipboardEventHandler,
  DragEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  ReactNode,
  Ref
} from 'react';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';

type SafePreviewHtmlSinkProps = Readonly<{
  ariaBusy?: boolean;
  className?: string;
  error?: boolean;
  children?: ReactNode;
  contentEditable?: boolean;
  html: SafePreviewHtml | null;
  label?: string;
  onDrop?: DragEventHandler<HTMLElement>;
  onInput?: FormEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPaste?: ClipboardEventHandler<HTMLElement>;
  refreshing?: boolean;
  role?: string;
  spellCheck?: boolean;
  style?: CSSProperties;
  surfaceRef: Ref<HTMLElement>;
}>;

export function SafePreviewHtmlSink({
  ariaBusy = false,
  className,
  children,
  contentEditable,
  error = false,
  html,
  label,
  onDrop,
  onInput,
  onKeyDown,
  onPaste,
  refreshing = false,
  role,
  spellCheck,
  style,
  surfaceRef
}: SafePreviewHtmlSinkProps) {
  if (null !== html) return (
    <article
      aria-busy={ariaBusy ? 'true' : 'false'}
      aria-label={label}
      aria-live={contentEditable ? undefined : 'polite'}
      className={className}
      contentEditable={contentEditable}
      data-easymde-preview-error={error ? '1' : undefined}
      data-easymde-preview-html-sink="1"
      data-easymde-preview-refreshing={refreshing ? '1' : undefined}
      onDrop={onDrop}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: This is the sole sink for PHP-rendered, server-sanitized Preview HTML.
      dangerouslySetInnerHTML={{ __html: html }}
      ref={surfaceRef}
      role={role}
      spellCheck={spellCheck}
      style={style}
      suppressContentEditableWarning={contentEditable}
    />
  );
  return (
    <article
      aria-busy={ariaBusy ? 'true' : 'false'}
      aria-label={label}
      aria-live={contentEditable ? undefined : 'polite'}
      className={className}
      contentEditable={contentEditable}
      data-easymde-preview-error={error ? '1' : undefined}
      data-easymde-preview-refreshing={refreshing ? '1' : undefined}
      onDrop={onDrop}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      ref={surfaceRef}
      role={role}
      spellCheck={spellCheck}
      style={style}
      suppressContentEditableWarning={contentEditable}
    >
      {children}
    </article>
  );
}
