# EasyMDE Data And Compatibility Migration

This document records implemented data-model and compatibility transitions.
Browser ownership for the ordinary WordPress Editor is no longer a staged
migration: Issue #91 uses one React Editor Root with no Legacy handoff,
fallback, parallel DOM, or Legacy Focus Mode runtime. Issue #123 adds a focused
immersive-writing presentation to that same React Root by transferring the
existing document surface; it does not reintroduce a Legacy owner. The temporary browser-removal
procedure remains in `.agents/skills/easymde-migration/SKILL.md` until its
separate deletion gate is approved.

## Editor Enablement

EasyMDE opens new and existing content for post types explicitly supported by
`easymde_supported_post_types` through normal WordPress editing when the current
user can edit or create that content. The defaults are `post` and `page`.

EasyMDE metadata describes document state and compatibility output; it does not
decide editor admission:

- `_easymde_enabled = 1` marks established EasyMDE document state.
- A post without `_easymde_enabled` but with an existing
  `_easymde_markdown` record is a legacy EasyMDE document-state post.
- Detection uses `metadata_exists()` so an existing empty Markdown record is
  distinct from an absent record.

Opening an ordinary supported post imports current `post_content` into Markdown
in memory. It does not write metadata, rewrite content, or create a revision.
On the next valid EasyMDE save, the plugin writes `_easymde_enabled = 1`, stores
the Markdown state, and writes rendered compatibility HTML. There is no bulk
upgrade migration.

## Markdown And Compatibility HTML

`_easymde_markdown` remains authoritative. `post_content` remains sanitized
rendered HTML for themes, feeds, search, plugins, visitors, and deactivation
compatibility.

Valid saves write `_easymde_render_signature`, an internal consistency marker
covering Markdown, article theme, and compatibility HTML. Stored HTML is reused
for initial Preview only when the marker still matches those inputs.

There is no fallback Markdown renderer. `league/commonmark`, through
`EasyMDE\Content\MarkdownRenderer`, is required. A development checkout without
Composer runtime dependencies shows a clear administrator notice and does not
generate inconsistent replacement HTML. Installable packages include the
required Composer runtime under `vendor/`.

## Revision Behavior

The following current metadata is copied to revisions and restored as one
consistent state:

```text
_easymde_enabled
_easymde_markdown
_easymde_markdown_theme
_easymde_code_theme
_easymde_custom_css_id
_easymde_custom_css_snapshot
_easymde_custom_font
_easymde_windows_font
_easymde_apple_font
_easymde_serif_font
_easymde_render_signature
```

For an EasyMDE revision, Markdown and appearance metadata are restored and
`post_content` is regenerated only when formal rendering succeeds. If the
renderer is unavailable or rendering fails, the revision's stored
`post_content` is restored without creating a new signature. A signature stored
on that revision is restored with the other metadata and remains subject to
normal consistency validation.

The restore path updates `post_content` directly and clears the post cache to
avoid recursive saves or duplicate revision loops. Restoring a pre-EasyMDE
revision removes current revisioned EasyMDE document-state metadata and restores
that revision's historical HTML; the browser does not fabricate Markdown for
that state.

## Fixed Mac Code Frame

The Mac-style source-code frame is a fixed rendering default, not saved
appearance state. New saves, defaults, Preview requests, and revisions do not
create or update Mac-frame state.

Existing `_easymde_code_mac_style` post/revision metadata and `codeMacStyle`
user-default entries are inactive historical data. EasyMDE preserves them
byte-for-byte without reading, writing, migrating, normalizing, copying, or
restoring them as active state.

## Custom CSS

Existing custom CSS library data remains readable from the current user's
`easymde_custom_css_library` user meta. Creating, updating, or deleting full
Custom CSS requires `unfiltered_html`.

`sabberworm/php-css-parser` owns parsing, normalization, selector scoping, and
safe output. The policy rejects `@import`, `@charset`, `@font-face`, `url(...)`,
`expression(...)`, `behavior`, `-moz-binding`, and `javascript:` while retaining
supported nested rules. If a legacy value cannot be parsed safely, its stored
value is retained but unsafe scoped output is omitted.

## Theme Assets

Article themes live under `assets/themes/article/`. Highlight.js vendor styles
live under `assets/vendor/highlight/styles/`. The EasyMDE-owned
`wechat-inspired` code theme lives at
`assets/themes/code/wechat-inspired.css`.

Existing active theme IDs are unchanged, so stored article theme, code theme,
and Custom CSS snapshot selections continue to resolve. Historical Mac-frame
values remain stored but do not affect rendering.
