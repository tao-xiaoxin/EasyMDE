import { createElement } from '@wordpress/element';
import type { CSSProperties, ReactNode, Ref } from 'react';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';

type SafePreviewHtmlSinkProps = Readonly<{
  ariaBusy?: boolean;
  className?: string;
  error?: boolean;
  children?: ReactNode;
  html: SafePreviewHtml | null;
  refreshing?: boolean;
  style?: CSSProperties;
  surfaceRef: Ref<HTMLElement>;
}>;

export function SafePreviewHtmlSink({
  ariaBusy = false,
  className,
  children,
  error = false,
  html,
  refreshing = false,
  style,
  surfaceRef
}: SafePreviewHtmlSinkProps) {
  if (null !== html) return (
    <article
      aria-busy={ariaBusy ? 'true' : 'false'}
      aria-live="polite"
      className={className}
      data-easymde-preview-error={error ? '1' : undefined}
      data-easymde-preview-html-sink="1"
      data-easymde-preview-refreshing={refreshing ? '1' : undefined}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: This is the sole sink for PHP-rendered, server-sanitized Preview HTML.
      dangerouslySetInnerHTML={{ __html: html }}
      ref={surfaceRef}
      style={style}
    />
  );
  return (
    <article
      aria-busy={ariaBusy ? 'true' : 'false'}
      aria-live="polite"
      className={className}
      data-easymde-preview-error={error ? '1' : undefined}
      data-easymde-preview-refreshing={refreshing ? '1' : undefined}
      ref={surfaceRef}
      style={style}
    >
      {children}
    </article>
  );
}
