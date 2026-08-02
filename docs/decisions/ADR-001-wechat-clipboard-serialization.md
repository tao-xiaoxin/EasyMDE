# ADR-001: Portable WeChat Clipboard Serialization

- Status: Accepted
- Date: 2026-08-02
- Owners: EasyMDE React browser integrations and Preview

## Context

EasyMDE's Preview is a browser document with theme CSS, computed layout,
Highlight.js token spans, KaTeX's visual and KaTeX MathML trees, pseudo-element
decorations, local theme images, tables, and code frames. WeChat does not share
that CSS or DOM environment. Copying `innerHTML` therefore loses theme details,
allows destination rules to reflow code and formulas, and can import both KaTeX
trees. Two independent copy implementations would also allow browser support
paths to drift.

Copy is an author-initiated compatibility operation. Markdown, WordPress
`post_content`, metadata, revisions, and publication remain server-owned and
must not be changed by it.

## Decision

`createBrowserWechatClipboard` is the single browser serializer. The
EditorRoot/session passes it only the current stable, sanitized, locally
enhanced Preview Safe HTML sink; the Adapter itself accepts an HTMLElement and
does not establish a second document authority. It builds one normalized clone.
Both the modern `navigator.clipboard.write` path and the legacy
`document.execCommand('copy')` compatibility path use the same HTML. The modern
path writes `text/plain` from that clone after removing exporter whitespace
markers and normalizing non-breaking spaces; the legacy path selects that same
HTML and lets the destination derive visible plain text.

The normalized payload:

- removes scripts, styles, interactive controls, CSS classes, and source/editor
  transient attributes; preserves only valid fragment IDs and SVG-internal IDs;
- validates URL and style values, and materializes only same-origin
  `/assets/images/` background assets as safe GIF/JPEG/PNG/WebP data images
  bounded by the fetched source blob limit `MAX_DATA_IMAGE_LENGTH` = 4,000,000;
  safe image `src`/`srcset`
  candidates and link URLs remain while unsafe URLs and non-allowlisted CSS
  background URLs are dropped;
- preserves approved computed typography, borders, quoted-literal pseudo-element
  decorations, code-frame geometry, table structure, responsive non-math SVG and
  media bounds, and KaTeX's visual SVG geometry while removing KaTeX MathML;
  exporter-owned `aria-hidden` decoration and `leaf` markers remain as
  structural exceptions;
- treats Mermaid HTML-label SVGs as a destination-font compatibility boundary:
  only Mermaid roots and their `foreignObject` labels receive visible overflow,
  semantic non-wrapping structure, and zero-width word-joiner markers. WeChat
  may remove the label CSS and `<nobr>` while sanitizing the paste, so the
  marker path is required for complete labels; modern `text/plain` removes the
  markers and ordinary SVG/KaTeX paths remain unchanged;
- normalizes article/div roots to portable section structure, wraps text leaves,
  preserves code and KaTeX whitespace markers, and sanitizes `srcset` and
  fragment IDs together with ordinary URL attributes;
- encodes code line breaks explicitly and keeps each source line non-wrapping;
- centers tables and display formulas in the destination column and applies
  horizontal-overflow rules to code, table, and formula frame boundaries;
  browser evidence identifies the actual owner and rejects nested vertical
  scrolling;
- keeps card height content-driven and does not create an article-wide height or
  vertical scroll container.

The legacy path is a compatibility branch inside the same explicit user action,
not a second renderer or a silent success. Clipboard failure remains a failure;
temporary fallback DOM, Selection, Focus, and Scroll are restored on every exit.

`createWechatExportSession` is the single session owner shared by the ordinary
and immersive editor surfaces. It checks the enabled/active state and current
Preview readiness before invoking the serializer, coalesces concurrent copy
requests, maps Adapter rejection to `wechat-copy-failed`, distinguishes
`wechat-clipboard-unsupported`, and suppresses status after teardown. Empty,
loading, or failed Preview surfaces return `wechat-preview-unavailable` without
touching Clipboard. A rejected same-origin theme-image fetch or data conversion
fails the operation rather than producing partial output.

## Alternatives Rejected

- Copying raw Preview `innerHTML`: destination CSS and duplicate KaTeX MathML
  make the result unstable and unsafe.
- Maintaining separate modern and legacy serializers: browser-dependent output
  drift would be invisible until a user pasted into WeChat.
- Rendering Markdown again in the browser: it would create a second content
  authority and diverge from the server Preview.
- Fixing WeChat with a global page height or overflow rule: that masks the
  owning boundary, clips legitimate long content, and confuses WeChat page
  navigation with copied article layout.

## Consequences

The HTML payload is larger because portability requires inline declarations and
explicit line structure. Changes to Preview enhancement, theme decoration,
KaTeX, code frames, tables, or scroll ownership require focused serializer
tests and fresh browser screenshots in an authorized local WeChat session.
The page-level scrollbar of a long WeChat editor is measured separately and is
not attributed to the exporter without a current-session article scroll owner.
All runtime assets remain local; no remote executable resource is introduced.

## Verification

The focused serializer tests cover unsafe input, pseudo elements, theme-image
materialization, Mermaid non-ASCII label preservation, code line preservation,
table/formula horizontal overflow, KaTeX MathML removal, modern/legacy HTML parity,
and an explicit failure result
with sandbox cleanup. The current suite still needs explicit cases for modern
rejection followed by legacy success, `ClipboardItem` construction failure,
unsupported legacy results, theme-image fetch/data-conversion failures, and
full Selection/Focus/Scroll restoration on every failure path. The companion
session tests cover concurrent single-flight, unsupported results, and late
teardown; disabled/inactive and all Preview-readiness variants remain required
boundary cases. The full frontend checks validate the compiled admin bundle and
manifest; release checks ensure the compiled runtime is self-contained.
Real-browser evidence uses the synthetic full-capability fixture, compares
source Preview with pasted WeChat screenshots, measures the actual scroll
owners, and never publishes or sends an article.
