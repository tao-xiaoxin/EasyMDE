# EasyMDE Data And Compatibility Migration

This document records implemented data-model and compatibility transitions.
Browser ownership for the ordinary WordPress Editor is one React Editor Root
with no Legacy handoff, fallback, parallel DOM, or Focus Mode runtime. Browser
ownership inventories, characterization, deprecation, and removal evidence are
maintained by the EasyMDE Skill; this document records only implemented data
and compatibility facts.

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

Legacy library entries with one `name` expose that value as both the article
and code theme label without writing during Read. The next authorized Custom
CSS Save stores the entry with independent `article_theme_name` and
`code_theme_name` fields and the normalized `updated_at` timestamp.

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

## Settings Center PNG Export

`images.wechatPngExportEnabled` is a strict boolean and defaults to `false`.
Reading settings that predate the field returns `false` in memory without
writing or normalizing the stored option. Settings transfer schemas 1 through
9 import the field as `false`; schema 10 and later require an explicit boolean.
Schema 12 is the current transfer format and retains that PNG requirement. The next
authorized complete Settings Save establishes the field through the normal
Settings Center persistence path.

## Image Object-Key Rule Split

The canonical Image Hosting settings are:

```text
images.storagePath   = {year}/{month}
images.fileNameRule  = {md5}
images.uploadFormats = webp:true, png:true, jpg:true, jpeg:true, jfif:true, gif:true
```

`storagePath` is a directory template and `fileNameRule` is a suffix-free
basename stem. An explicitly empty `storagePath` targets the provider bucket or
WordPress upload root. It is distinct from a missing field. The ordered
extension registry is `webp`, `png`, `jpg`, `jpeg`, `jfif`, `gif`; every entry
defaults to enabled, canonical payloads require exactly these six boolean keys,
and at least one must remain enabled. JPG, JPEG, and JFIF are independent
choices even though JFIF uses the `image/jpeg` MIME family.

The Settings Center preview expands the path and stem, then appends the first
enabled registry entry. Its default example is exactly
`2026/07/a8f4c2d1.webp`; this presentation choice never changes the extension
of a real upload.

Existing settings may contain either one complete path template in
`images.fileNameRule` without `images.storagePath`, or the prior split pair
whose basename still ends in `.{ext}`. Reads split the single-field shape at
the last `/` and preserve an existing `storagePath`, then remove exactly one
terminal `.{ext}` from the basename. A legacy rule without `/` produces an
empty storage path. Only the terminal suffix is representable: `{ext}` in a
directory, in the middle, repeated, or reducing the stem to empty is an
explicit configuration/import error. No invalid legacy value is silently
repaired or routed to a fallback.
This projection is lazy and read-only: it does not write the option or change
its revision. The next legitimate Settings Save persists both canonical fields.
A legacy write payload from an already-open Settings page is accepted through
the same deterministic conversion. The old four-key `uploadFormats` map is
expanded by copying `jpg` to independent `jpg`, `jpeg`, and `jfif` entries;
PNG, WebP, and GIF values remain unchanged.

Transfer imports from schemas 1 through 11 receive this explicit conversion
before the normal validation path. Transfer export uses schema 12. The
Settings Center bootstrap is schema 4 and includes both split fields plus the
exact six-key format map. Schema 12 is strict and rejects missing or extra
canonical fields. No attachment, provider object, or historical path is
renamed or moved by this compatibility step.

`ObjectKeyBuilder` is the sole runtime owner of combining, validating, and
expanding `storagePath` plus the suffix-free basename stem. Image Hosting and
future EasyMDE local paste/drop uploads through `/easymde/v1/media` pass the
same pair and format map to that builder, so the selected upload owner cannot
produce a divergent key. After real MIME, exact source-extension, and checkbox
validation, it appends exactly one lowercased verified extension. Canonical
rules never contain `{ext}`. Changing either split field or the format map
invalidates the prior verification fingerprint and any stale completion.
JFIF receives only a scoped `jfif => image/jpeg` WordPress Core allowance for
the owned upload operation; the hook is removed on every exit and global MIME
behavior is unchanged.
