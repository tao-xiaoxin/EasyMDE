# EasyMDE Migration Notes

## Normal Editor Toolbar Ownership

The normal editor's main Markdown Toolbar is the first production React
migration unit. PHP `ToolbarRegistry` descriptors, command IDs, ordering,
translated labels, and shortcut configuration remain authoritative. React owns
the main Toolbar presentation, heading-menu interaction, and command intent
dispatch; the existing browser command engine continues to own the actual
Markdown selection transformations.

The PHP editor shell renders separate React, legacy-main, and legacy-secondary
containers. The legacy main Toolbar remains active while the React entry
validates bootstrap data and mounts. Readiness performs one visibility and
presentation-owner handoff. Startup failure leaves the legacy main Toolbar
usable, and teardown unmounts React before legacy code may clear or reuse its
container.

The secondary Toolbar and immersive workspace remain legacy-owned. This unit
does not transfer Preview, appearance, draft storage, WeChat export, immersive
writing, native submission, Save, Publish, or WordPress authority, and it
removes no legacy implementation.

## Normal Editor Document Session Ownership

The normal editor Markdown source and title session are the next React
migration unit. CodeMirror 6 owns the in-browser Markdown value, selection,
focus, undo history, and source scrolling after its readiness contract passes.
The native `#easymde-source` textarea stays in the WordPress form as a hidden,
synchronously updated submission bridge and as the compatibility boundary for
legacy Markdown commands. The native title input remains visible and
WordPress-owned; React observes it through a focused title session adapter
without creating another persisted title.

The PHP editor shell renders separate React and legacy source containers.
Startup keeps the textarea visible until the CodeMirror document session, title
session, native fields, and legacy consumers validate. Readiness switches one
explicit document owner, rebinds source scroll and paste/drop surfaces, and
hides the textarea. Startup failure keeps the legacy textarea usable. A failure
after handoff requires reload rather than switching two live document writers.
Native form submission flushes CodeMirror to the textarea before WordPress
serializes the open form.

PHP and WordPress continue to own Markdown and title persistence, rendering,
save, publish, permissions, nonces, revisions, autosave, and post locks. The
secondary Toolbar and immersive workspace remain legacy-owned, and this unit
does not migrate immersive writing.

## Editor Enablement

EasyMDE opens new and existing content for post types explicitly supported by `easymde_supported_post_types` in EasyMDE through normal WordPress editing when the current user can edit or create that content. The default supported post types are `post` and `page`.

EasyMDE metadata describes document state and compatibility output; it no longer decides editor admission. Existing EasyMDE posts remain compatible:

- `_easymde_enabled = 1` marks a post as having EasyMDE document state.
- If `_easymde_enabled` is missing but `_easymde_markdown` exists, the post is treated as a legacy EasyMDE document-state post.
- The legacy check uses `metadata_exists()` so an empty Markdown value still counts.

Opening an ordinary existing supported post without EasyMDE metadata imports
current `post_content` into Markdown in memory for the editor. It does not write
metadata, rewrite `post_content`, or create revisions. Legacy posts and ordinary
supported posts are migrated lazily. On the next valid EasyMDE save, the plugin
writes `_easymde_enabled = 1`, stores Markdown state, and writes rendered
compatibility HTML. It does not scan or update every post during upgrade.

## Markdown And HTML

`_easymde_markdown` remains the authoritative source. `post_content` remains the
rendered HTML compatibility output.

Valid EasyMDE saves also write `_easymde_render_signature`, an internal
consistency marker tying the current Markdown, article theme, and stored
compatibility HTML together. The marker lets the editor reuse stored HTML for a
fast initial preview only when it still matches the authoritative Markdown
state.

The fallback Markdown renderer has been removed. `league/commonmark` is required
for rendering. A development checkout without Composer dependencies shows an
admin notice and avoids writing newly rendered HTML.

Production release packages must include Composer dependencies in `vendor/`.

## Revision Behavior

The following meta keys are copied to new revisions and restored from revisions:

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

When a revision containing EasyMDE meta is restored, the restored Markdown and
theme state are copied back to the post. EasyMDE regenerates `post_content` and
stores a new render signature only when Markdown rendering succeeds. If the
renderer is unavailable or rendering fails, the restore path uses the
revision's stored `post_content` without generating a new signature. Any render
signature stored on that revision is restored with the other revisioned
metadata and remains subject to normal consistency validation.

The restore path updates `post_content` directly and clears the post cache to
avoid recursive save hooks or extra revision loops.

When a revision predates EasyMDE document state and contains none of the
revisioned EasyMDE metadata, restoring it removes the current revisioned
EasyMDE metadata and restores that revision's historical `post_content`. The
post then no longer has EasyMDE document state.

## Fixed Mac Code Frame

The Mac-style source-code frame is now a fixed rendering default rather than saved appearance state. New post saves, user defaults, preview requests, and revisions no longer create or update Mac-frame state.

Existing `_easymde_code_mac_style` post/revision meta and `codeMacStyle` entries in user defaults are retained byte-for-byte. EasyMDE does not migrate, delete, normalize, copy, restore, or consult those historical values. Saving other supported appearance defaults preserves unknown historical user-default fields while updating only the active fields.

## Custom CSS

Existing custom CSS library data remains readable from the current user's
`easymde_custom_css_library` user meta.

New, updated, and deleted full custom CSS requires `unfiltered_html`. CSS is parsed with
`sabberworm/php-css-parser` before storage or scoping. Unsafe features such as
`@import`, `@charset`, `@font-face`, `url(...)`, `expression(...)`,
`behavior`, `-moz-binding`, and `javascript:` are rejected.

If legacy CSS cannot be parsed safely, the stored value is retained but scoped
frontend output is omitted.

## Theme Assets

Article themes moved from the previous all-in-one stylesheet into
`assets/themes/article/`. Highlight.js vendor styles moved to
`assets/vendor/highlight/styles/`. The owned `wechat-inspired` code theme moved
to `assets/themes/code/wechat-inspired.css`.

Old active theme meta IDs are unchanged, so existing posts continue to resolve their selected article theme, code theme, and custom CSS snapshot. Historical Mac-frame values remain stored but no longer affect rendering.
